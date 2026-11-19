-- =============================================================================
-- Migration: 20261119_phase61a_cleanup_and_driver_role.sql
-- Phase 61-A: Stacked [SAMPLE] Coordinate Cleanup, `driver` Role RBAC Sync,
--             Driver Self-Service RLS & Vehicle Status RPC, and Super-Admin
--             Rate Card / Subscription Plan / Fleet / Role Management Policies
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS postgis;

-- =============================================================================
-- 1. Remove Stacked [SAMPLE] Coordinate Pile (3+ [SAMPLE] rows sharing a
--    rounded 4-decimal lat/lng coordinate, e.g. Zogam Rd / Central Lamka pile)
--    Preserves all real non-sample listings and all dispersed sample listings.
--    Orphaned marketplace_products and child tables cascade automatically via
--    ON DELETE CASCADE.
-- =============================================================================
WITH stacked_coords AS (
  SELECT
    round(COALESCE(lat, (coordinates->>'lat')::double precision)::numeric, 4) AS lat_r,
    round(COALESCE(lng, (coordinates->>'lng')::double precision)::numeric, 4) AS lng_r
  FROM public.listings
  WHERE title ILIKE '[SAMPLE]%'
    AND COALESCE(lat, (coordinates->>'lat')::double precision) IS NOT NULL
    AND COALESCE(lng, (coordinates->>'lng')::double precision) IS NOT NULL
  GROUP BY 1, 2
  HAVING count(*) >= 3
)
DELETE FROM public.listings l
USING stacked_coords sc
WHERE l.title ILIKE '[SAMPLE]%'
  AND round(COALESCE(l.lat, (l.coordinates->>'lat')::double precision)::numeric, 4) = sc.lat_r
  AND round(COALESCE(l.lng, (l.coordinates->>'lng')::double precision)::numeric, 4) = sc.lng_r;

-- =============================================================================
-- 2. Add `driver` Role Support on public.profiles.role
-- =============================================================================
DO $$
DECLARE
  v_constraint record;
BEGIN
  -- Normalize legacy NULL / blank / 'user' values before updating CHECK constraint
  UPDATE public.profiles
  SET role = 'visitor'
  WHERE role IS NULL
     OR lower(trim(role)) IN ('', 'user');

  UPDATE public.profiles
  SET role = lower(trim(role))
  WHERE role IS DISTINCT FROM lower(trim(role));

  -- Drop any existing CHECK constraint on public.profiles referencing column `role`
  FOR v_constraint IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'profiles'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ~* '\brole\b'
  LOOP
    EXECUTE format('ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS %I', v_constraint.conname);
  END LOOP;
END;
$$;

ALTER TABLE public.profiles
  ALTER COLUMN role SET DEFAULT 'visitor';

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (
    role IN (
      'visitor',
      'driver',
      'staff',
      'owner',
      'admin',
      'super_admin'
    )
  ) NOT VALID;

-- Validate when all existing rows conform (safe & idempotent)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE role NOT IN ('visitor', 'driver', 'staff', 'owner', 'admin', 'super_admin')
  ) THEN
    ALTER TABLE public.profiles VALIDATE CONSTRAINT profiles_role_check;
  END IF;
END;
$$;

-- =============================================================================
-- 3. Role Helper Functions (SECURITY DEFINER to prevent RLS recursion)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.is_super_admin(p_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = p_uid
      AND p.role = 'super_admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_pnd_admin(p_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = p_uid
      AND p.role IN ('admin', 'super_admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_pnd_mediator(p_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = p_uid
      AND p.role IN ('owner', 'admin', 'super_admin')
  );
$$;

-- =============================================================================
-- 4. Driver Self-Service RLS Policies
--    - Drivers can SELECT their own `drivers` row, assigned `vehicles`,
--      assigned `delivery_orders`, and `delivery_transactions` ONLY where
--      `tx_type = 'driver_payout'` for their assigned orders.
--    - Drivers NEVER receive SELECT access on `delivery_order_secrets`.
-- =============================================================================

-- ---- drivers ----
DROP POLICY IF EXISTS "drivers_authenticated_select" ON public.drivers;
CREATE POLICY "drivers_authenticated_select"
  ON public.drivers
  FOR SELECT
  TO authenticated
  USING (
    profile_id = auth.uid()
    OR (is_active = true AND kyc_verified = true)
    OR public.is_pnd_mediator(auth.uid())
  );

-- ---- vehicles ----
DROP POLICY IF EXISTS "vehicles_authenticated_select" ON public.vehicles;
CREATE POLICY "vehicles_authenticated_select"
  ON public.vehicles
  FOR SELECT
  TO authenticated
  USING (
    is_available = true
    OR EXISTS (
      SELECT 1
      FROM public.drivers d
      WHERE d.id = vehicles.driver_id
        AND d.profile_id = auth.uid()
    )
    OR public.is_pnd_mediator(auth.uid())
  );

-- ---- delivery_orders ----
DROP POLICY IF EXISTS "delivery_orders_select" ON public.delivery_orders;
CREATE POLICY "delivery_orders_select"
  ON public.delivery_orders
  FOR SELECT
  TO authenticated
  USING (
    customer_id = auth.uid()
    OR mediator_id = auth.uid()
    OR public.is_pnd_mediator(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.drivers d
      WHERE d.id = delivery_orders.driver_id
        AND d.profile_id = auth.uid()
    )
  );

-- ---- delivery_transactions (allow drivers to view ONLY their own driver_payout rows) ----
DROP POLICY IF EXISTS "delivery_transactions_select" ON public.delivery_transactions;
CREATE POLICY "delivery_transactions_select"
  ON public.delivery_transactions
  FOR SELECT
  TO authenticated
  USING (
    public.is_pnd_mediator(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.delivery_orders o
      WHERE o.id = delivery_transactions.order_id
        AND (o.customer_id = auth.uid() OR o.mediator_id = auth.uid())
    )
    OR (
      delivery_transactions.tx_type = 'driver_payout'
      AND EXISTS (
        SELECT 1
        FROM public.delivery_orders o
        JOIN public.drivers d ON d.id = o.driver_id
        WHERE o.id = delivery_transactions.order_id
          AND d.profile_id = auth.uid()
      )
    )
  );

-- ---- delivery_order_secrets (strictly re-assert: ZERO driver SELECT access) ----
DROP POLICY IF EXISTS "delivery_order_secrets_sender_mediator_select" ON public.delivery_order_secrets;
CREATE POLICY "delivery_order_secrets_sender_mediator_select"
  ON public.delivery_order_secrets
  FOR SELECT
  TO authenticated
  USING (
    public.is_pnd_mediator(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.delivery_orders o
      WHERE o.id = delivery_order_secrets.order_id
        AND (o.customer_id = auth.uid() OR o.mediator_id = auth.uid())
    )
  );

-- =============================================================================
-- 5. Driver Vehicle Status & Live Location Ping RPC (SECURITY DEFINER)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.driver_update_vehicle_status(
  p_is_available boolean,
  p_lat double precision DEFAULT NULL,
  p_lng double precision DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_driver_id uuid;
  v_updated_count integer := 0;
  v_location_updated boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.'
      USING ERRCODE = '42501';
  END IF;

  SELECT d.id
    INTO v_driver_id
  FROM public.drivers d
  WHERE d.profile_id = v_uid
    AND d.is_active = true
  LIMIT 1;

  IF v_driver_id IS NULL THEN
    RAISE EXCEPTION 'Active driver profile not found for current user.'
      USING ERRCODE = '42501';
  END IF;

  IF (p_lat IS NOT NULL AND p_lng IS NULL) OR (p_lat IS NULL AND p_lng IS NOT NULL) THEN
    RAISE EXCEPTION 'Both p_lat and p_lng must be provided together.'
      USING ERRCODE = '22023';
  END IF;

  IF p_lat IS NOT NULL AND p_lng IS NOT NULL THEN
    IF p_lat < -90 OR p_lat > 90 OR p_lng < -180 OR p_lng > 180 THEN
      RAISE EXCEPTION 'Coordinates out of valid WGS84 range.'
        USING ERRCODE = '22023';
    END IF;
    v_location_updated := true;
  END IF;

  UPDATE public.vehicles v
  SET
    is_available = p_is_available,
    current_location = CASE
      WHEN v_location_updated THEN ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography
      ELSE v.current_location
    END,
    updated_at = now()
  WHERE v.driver_id = v_driver_id;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'driver_id', v_driver_id,
    'vehicles_updated', v_updated_count,
    'is_available', p_is_available,
    'location_updated', v_location_updated,
    'updated_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.driver_update_vehicle_status(boolean, double precision, double precision) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.driver_update_vehicle_status(boolean, double precision, double precision) TO authenticated;

-- =============================================================================
-- 6. Super-Admin & Admin RLS Policies for Rate Cards, Plans, Fleet & Profiles
-- =============================================================================

-- ---- vehicle_types ----
DROP POLICY IF EXISTS "vehicle_types_admin_manage" ON public.vehicle_types;
CREATE POLICY "vehicle_types_admin_manage"
  ON public.vehicle_types
  FOR ALL
  TO authenticated
  USING (public.is_pnd_admin(auth.uid()))
  WITH CHECK (public.is_pnd_admin(auth.uid()));

-- ---- subscription_plans (idempotent if Phase 59 table exists) ----
DO $$
BEGIN
  IF to_regclass('public.subscription_plans') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY';
    EXECUTE 'DROP POLICY IF EXISTS "subscription_plans_admin_manage" ON public.subscription_plans';
    EXECUTE $policy$
      CREATE POLICY "subscription_plans_admin_manage"
        ON public.subscription_plans
        FOR ALL
        TO authenticated
        USING (public.is_pnd_admin(auth.uid()))
        WITH CHECK (public.is_pnd_admin(auth.uid()))
    $policy$;
  END IF;
END;
$$;

-- ---- drivers ----
DROP POLICY IF EXISTS "drivers_mediator_manage" ON public.drivers;
CREATE POLICY "drivers_mediator_manage"
  ON public.drivers
  FOR ALL
  TO authenticated
  USING (public.is_pnd_mediator(auth.uid()))
  WITH CHECK (public.is_pnd_mediator(auth.uid()));

-- ---- vehicles ----
DROP POLICY IF EXISTS "vehicles_mediator_manage" ON public.vehicles;
CREATE POLICY "vehicles_mediator_manage"
  ON public.vehicles
  FOR ALL
  TO authenticated
  USING (public.is_pnd_mediator(auth.uid()))
  WITH CHECK (public.is_pnd_mediator(auth.uid()));

-- ---- profiles (Super-Admin role update policy without self-recursion) ----
DROP POLICY IF EXISTS "Allow super_admin to update any user role" ON public.profiles;
CREATE POLICY "Allow super_admin to update any user role"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- =============================================================================
-- 7. Super-Admin Secure Role Assignment RPC (SECURITY DEFINER)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.superadmin_set_user_role(
  p_target_user_id uuid,
  p_new_role text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_normalized_role text := lower(trim(COALESCE(p_new_role, '')));
  v_previous_role text;
BEGIN
  IF v_caller_id IS NULL OR NOT public.is_super_admin(v_caller_id) THEN
    RAISE EXCEPTION 'Permission denied: only super_admin can assign user roles.'
      USING ERRCODE = '42501';
  END IF;

  IF p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'Target user ID is required.'
      USING ERRCODE = '22023';
  END IF;

  IF v_normalized_role NOT IN (
    'visitor',
    'driver',
    'staff',
    'owner',
    'admin',
    'super_admin'
  ) THEN
    RAISE EXCEPTION 'Invalid role "%". Allowed roles: visitor, driver, staff, owner, admin, super_admin.',
      p_new_role
      USING ERRCODE = '22023';
  END IF;

  IF p_target_user_id = v_caller_id AND v_normalized_role <> 'super_admin' THEN
    RAISE EXCEPTION 'Super admins cannot demote their own account via this RPC.'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.role
    INTO v_previous_role
  FROM public.profiles p
  WHERE p.id = p_target_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target user profile not found.'
      USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.profiles
  SET role = v_normalized_role
  WHERE id = p_target_user_id;

  RETURN jsonb_build_object(
    'ok', true,
    'user_id', p_target_user_id,
    'previous_role', v_previous_role,
    'role', v_normalized_role,
    'updated_by', v_caller_id,
    'updated_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.superadmin_set_user_role(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.superadmin_set_user_role(uuid, text) TO authenticated;
