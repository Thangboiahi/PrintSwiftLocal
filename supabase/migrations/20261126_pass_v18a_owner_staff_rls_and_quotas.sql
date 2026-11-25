-- =============================================================================
-- Migration: 20261126_pass_v18a_owner_staff_rls_and_quotas.sql
-- Sprint v18a:
--   1. Phase 13-C Active-Status Delegated Staff RLS Parity (`is_active_listing_staff`)
--      across `public.staff_delegations`, `public.listings`, `public.enquiries`,
--      and `public.marketplace_products` (plus `public.marketplace_items` if present).
--   2. Server-Side `max_staff` Quota Enforcement (`v17b` interconnection) +
--      Immutable `public.audit_logs` integration using canonical live columns.
--   3. Owner-Inherited Entitlements & Workspace Summary RPC
--      (`public.get_owner_workspace_summary`).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. NORMALIZE `public.staff_delegations` COLUMNS & STATUS CONSTRAINT
-- -----------------------------------------------------------------------------
ALTER TABLE public.staff_delegations
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS granted_by_owner_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS staff_name text,
  ADD COLUMN IF NOT EXISTS staff_email text,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS vertical_scopes jsonb NOT NULL DEFAULT '["enquiries"]'::jsonb,
  ADD COLUMN IF NOT EXISTS granted_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

DO $$
DECLARE
  v_conname text;
BEGIN
  FOR v_conname IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'staff_delegations'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.staff_delegations DROP CONSTRAINT IF EXISTS %I', v_conname);
  END LOOP;

  ALTER TABLE public.staff_delegations
    ADD CONSTRAINT staff_delegations_status_v18a_check CHECK (
      status IN (
        'active',
        'suspended',
        'suspended_parent_closed',
        'revoked',
        'frozen_by_transfer',
        'inactive'
      )
    );
END;
$$;

-- Backfill `owner_id` on existing `staff_delegations` rows from parent `listings`
UPDATE public.staff_delegations sd
SET
  owner_id = COALESCE(sd.owner_id, l.owner_id),
  granted_by_owner_id = COALESCE(sd.granted_by_owner_id, l.owner_id)
FROM public.listings l
WHERE l.id = sd.listing_id
  AND (sd.owner_id IS NULL OR sd.granted_by_owner_id IS NULL);

CREATE INDEX IF NOT EXISTS idx_staff_delegations_listing_staff_status
  ON public.staff_delegations (listing_id, staff_id, status);

CREATE INDEX IF NOT EXISTS idx_staff_delegations_staff_status
  ON public.staff_delegations (staff_id, status);

-- -----------------------------------------------------------------------------
-- 2. CANONICAL HELPER: `public.is_active_listing_staff`
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_active_listing_staff(
  p_listing_id uuid,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_listing_id IS NULL OR p_user_id IS NULL THEN false
    ELSE EXISTS (
      SELECT 1
      FROM public.staff_delegations sd
      JOIN public.listings l ON l.id = sd.listing_id
      WHERE sd.listing_id = p_listing_id
        AND sd.staff_id = p_user_id
        AND COALESCE(sd.status, 'active') = 'active'
        AND COALESCE(l.lifecycle_status, 'active') IN ('active', 'draining')
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.is_active_listing_staff(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_active_listing_staff(uuid, uuid) TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. RLS LOCKDOWN ON `public.staff_delegations`
--    (Owners & Superadmin manage staff; Staff can read their own rows only)
-- -----------------------------------------------------------------------------
ALTER TABLE public.staff_delegations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read access to staff_delegations" ON public.staff_delegations;
DROP POLICY IF EXISTS staff_delegations_v18a_select ON public.staff_delegations;
DROP POLICY IF EXISTS staff_delegations_v18a_insert ON public.staff_delegations;
DROP POLICY IF EXISTS staff_delegations_v18a_update ON public.staff_delegations;
DROP POLICY IF EXISTS staff_delegations_v18a_delete ON public.staff_delegations;

CREATE POLICY staff_delegations_v18a_select
  ON public.staff_delegations
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND (
      staff_id = auth.uid()
      OR owner_id = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM public.listings l
        WHERE l.id = public.staff_delegations.listing_id
          AND l.owner_id = auth.uid()
      )
      OR public.is_pnd_admin(auth.uid())
    )
  );

CREATE POLICY staff_delegations_v18a_insert
  ON public.staff_delegations
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.listings l
        WHERE l.id = public.staff_delegations.listing_id
          AND l.owner_id = auth.uid()
      )
      OR public.is_super_admin()
    )
  );

CREATE POLICY staff_delegations_v18a_update
  ON public.staff_delegations
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.listings l
        WHERE l.id = public.staff_delegations.listing_id
          AND l.owner_id = auth.uid()
      )
      OR public.is_super_admin()
    )
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.listings l
        WHERE l.id = public.staff_delegations.listing_id
          AND l.owner_id = auth.uid()
      )
      OR public.is_super_admin()
    )
  );

CREATE POLICY staff_delegations_v18a_delete
  ON public.staff_delegations
  FOR DELETE
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.listings l
        WHERE l.id = public.staff_delegations.listing_id
          AND l.owner_id = auth.uid()
      )
      OR public.is_super_admin()
    )
  );

-- -----------------------------------------------------------------------------
-- 4. SERVER-SIDE `max_staff` QUOTA ENFORCEMENT & AUDIT TRIGGER
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.enforce_and_audit_staff_delegation_v18a()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_listing_id uuid := COALESCE(NEW.listing_id, OLD.listing_id);
  v_owner_id uuid;
  v_listing_title text;
  v_ent jsonb;
  v_staffing_enabled boolean := true;
  v_raw_limit text;
  v_max_staff integer := NULL;
  v_current_active_staff integer := 0;
  v_is_activating boolean := false;
  v_actor_id uuid := auth.uid();
  v_actor_role text := 'owner';
BEGIN
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    SELECT l.owner_id, l.title
      INTO v_owner_id, v_listing_title
    FROM public.listings l
    WHERE l.id = NEW.listing_id;

    IF v_owner_id IS NULL THEN
      RAISE EXCEPTION 'Cannot assign staff to a non-existent listing.'
        USING ERRCODE = 'P0002';
    END IF;

    -- Prevent self-delegation by the listing owner
    IF NEW.staff_id = v_owner_id THEN
      RAISE EXCEPTION 'The listing owner already has full access and cannot be added as delegated staff.'
        USING ERRCODE = '22023';
    END IF;

    NEW.owner_id := v_owner_id;
    NEW.granted_by_owner_id := COALESCE(NEW.granted_by_owner_id, v_actor_id, v_owner_id);
    NEW.updated_at := now();

    v_is_activating :=
      COALESCE(NEW.status, 'active') = 'active'
      AND (
        TG_OP = 'INSERT'
        OR COALESCE(OLD.status, '') <> 'active'
        OR OLD.staff_id IS DISTINCT FROM NEW.staff_id
        OR OLD.listing_id IS DISTINCT FROM NEW.listing_id
      );

    IF v_is_activating AND NOT public.is_super_admin() THEN
      v_ent := public.get_effective_entitlements(v_owner_id, NEW.listing_id);

      v_staffing_enabled := COALESCE(
        (v_ent #>> '{staffing,enabled}')::boolean,
        (v_ent #>> '{features,staff_delegation}')::boolean,
        true
      );

      v_raw_limit := COALESCE(
        v_ent #>> '{staffing,max_staff}',
        v_ent #>> '{staffing,limit}',
        v_ent #>> '{limits,max_staff_members}'
      );

      IF v_raw_limit IS NOT NULL AND v_raw_limit ~ '^-?[0-9]+$' THEN
        v_max_staff := v_raw_limit::integer;
        IF v_max_staff < 0 THEN
          v_max_staff := NULL; -- Negative sentinel means unlimited
        END IF;
      END IF;

      IF NOT v_staffing_enabled OR (v_max_staff IS NOT NULL AND v_max_staff = 0) THEN
        RAISE EXCEPTION 'Delegated staff seats are not enabled on your current subscription plan. Upgrade your plan to add team members.'
          USING ERRCODE = 'P0001';
      END IF;

      IF v_max_staff IS NOT NULL THEN
        SELECT COUNT(DISTINCT sd.staff_id)::integer
          INTO v_current_active_staff
        FROM public.staff_delegations sd
        JOIN public.listings l ON l.id = sd.listing_id
        WHERE l.owner_id = v_owner_id
          AND COALESCE(sd.status, 'active') = 'active'
          AND sd.id IS DISTINCT FROM NEW.id
          AND sd.staff_id IS DISTINCT FROM NEW.staff_id;

        IF v_current_active_staff >= v_max_staff THEN
          RAISE EXCEPTION 'Staff seat quota reached (% / % active staff members across your account). Upgrade your subscription plan to add more delegated staff.',
            v_current_active_staff,
            v_max_staff
            USING ERRCODE = 'P0001';
        END IF;
      END IF;
    END IF;
  END IF;

  IF to_regclass('public.audit_logs') IS NOT NULL THEN
    IF public.is_super_admin() THEN
      v_actor_role := 'super_admin';
    END IF;

    INSERT INTO public.audit_logs (
      actor_id,
      actor_role,
      workspace,
      action,
      target_table,
      target_id,
      details,
      metadata
    )
    VALUES (
      v_actor_id,
      v_actor_role,
      'owner_workspace',
      CASE
        WHEN TG_OP = 'INSERT' THEN 'grant_staff_delegation'
        WHEN TG_OP = 'DELETE' THEN 'revoke_staff_delegation'
        WHEN COALESCE(NEW.status, 'active') <> 'active' THEN 'deactivate_staff_delegation'
        ELSE 'update_staff_delegation'
      END,
      'staff_delegations',
      COALESCE(NEW.id, OLD.id)::text,
      CASE
        WHEN TG_OP = 'INSERT' THEN 'Granted delegated staff access on listing ' || COALESCE(v_listing_title, v_listing_id::text)
        WHEN TG_OP = 'DELETE' THEN 'Removed delegated staff access on listing ' || COALESCE(v_listing_id::text, '')
        ELSE 'Updated delegated staff permissions/status on listing ' || COALESCE(v_listing_title, v_listing_id::text)
      END,
      jsonb_build_object(
        'listing_id', v_listing_id::text,
        'staff_id', COALESCE(NEW.staff_id, OLD.staff_id)::text,
        'status', CASE WHEN TG_OP = 'DELETE' THEN 'deleted' ELSE COALESCE(NEW.status, 'active') END,
        'permissions', CASE WHEN TG_OP = 'DELETE' THEN COALESCE(OLD.permissions, '{}'::jsonb) ELSE COALESCE(NEW.permissions, '{}'::jsonb) END,
        'vertical_scopes', CASE WHEN TG_OP = 'DELETE' THEN COALESCE(OLD.vertical_scopes, '[]'::jsonb) ELSE COALESCE(NEW.vertical_scopes, '[]'::jsonb) END
      )
    );
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_and_audit_staff_delegation_v18a ON public.staff_delegations;
CREATE TRIGGER trg_enforce_and_audit_staff_delegation_v18a
  BEFORE INSERT OR UPDATE OR DELETE ON public.staff_delegations
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_and_audit_staff_delegation_v18a();

-- -----------------------------------------------------------------------------
-- 5. PHASE 13-C ACTIVE-STATUS STAFF RLS PARITY ON `listings`, `enquiries`,
--    AND `marketplace_products`
-- -----------------------------------------------------------------------------

-- 5A. `public.listings` RLS + Staff Column Mutation Guard
DROP POLICY IF EXISTS "Allow public read access to listings" ON public.listings;
DROP POLICY IF EXISTS "Allow owners to insert own listings" ON public.listings;
DROP POLICY IF EXISTS "Allow owners to update own listings" ON public.listings;
DROP POLICY IF EXISTS "Allow delegated staff to update assigned listings" ON public.listings;
DROP POLICY IF EXISTS "Allow owners to delete own listings" ON public.listings;

CREATE POLICY "Allow public read access to listings"
  ON public.listings
  FOR SELECT
  USING (
    status IN ('published', 'approved')
    OR (
      auth.uid() IS NOT NULL
      AND (
        owner_id = auth.uid()
        OR public.is_active_listing_staff(public.listings.id, auth.uid())
        OR public.is_pnd_admin(auth.uid())
      )
    )
  );

CREATE POLICY "Allow owners to insert own listings"
  ON public.listings
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND (
      owner_id = auth.uid()
      OR public.is_super_admin()
    )
  );

CREATE POLICY "Allow owners to update own listings"
  ON public.listings
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND (
      owner_id = auth.uid()
      OR public.is_active_listing_staff(public.listings.id, auth.uid())
      OR public.is_pnd_admin(auth.uid())
    )
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND (
      owner_id = auth.uid()
      OR public.is_active_listing_staff(public.listings.id, auth.uid())
      OR public.is_pnd_admin(auth.uid())
    )
  );

CREATE POLICY "Allow owners to delete own listings"
  ON public.listings
  FOR DELETE
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND (
      owner_id = auth.uid()
      OR public.is_super_admin()
    )
  );

-- Guard sensitive Owner/Admin-only fields on `public.listings` when updated by Delegated Staff
CREATE OR REPLACE FUNCTION public.guard_staff_listing_mutations_v18a()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  -- Service role / SQL migrations bypass
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  -- Owner and Admin/Superadmin may perform full updates
  IF v_uid = OLD.owner_id OR public.is_pnd_admin(v_uid) THEN
    RETURN NEW;
  END IF;

  -- Active delegated staff cannot transfer ownership, archive business, or spoof featured/paid_until
  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    RAISE EXCEPTION 'Delegated staff cannot transfer listing ownership.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.lifecycle_status IS DISTINCT FROM OLD.lifecycle_status THEN
    RAISE EXCEPTION 'Only the business owner can pause, drain, or archive a business listing.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.is_featured IS DISTINCT FROM OLD.is_featured
     OR NEW.featured_order IS DISTINCT FROM OLD.featured_order
     OR NEW.paid_until IS DISTINCT FROM OLD.paid_until THEN
    RAISE EXCEPTION 'Delegated staff cannot modify featured placement or billing timestamps.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_staff_listing_mutations_v18a ON public.listings;
CREATE TRIGGER trg_guard_staff_listing_mutations_v18a
  BEFORE UPDATE ON public.listings
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_staff_listing_mutations_v18a();

-- 5B. `public.enquiries` RLS (Active staff can read & reply/update status; cannot delete)
DROP POLICY IF EXISTS "Allow listing owners to read enquiries for their listings" ON public.enquiries;
DROP POLICY IF EXISTS "Allow listing owners to update enquiries" ON public.enquiries;
DROP POLICY IF EXISTS "Allow listing owners to delete enquiries" ON public.enquiries;

CREATE POLICY "Allow listing owners to read enquiries for their listings"
  ON public.enquiries
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.listings l
        WHERE l.id = public.enquiries.listing_id
          AND l.owner_id = auth.uid()
      )
      OR public.is_active_listing_staff(public.enquiries.listing_id, auth.uid())
      OR public.is_pnd_admin(auth.uid())
    )
  );

CREATE POLICY "Allow listing owners to update enquiries"
  ON public.enquiries
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.listings l
        WHERE l.id = public.enquiries.listing_id
          AND l.owner_id = auth.uid()
      )
      OR public.is_active_listing_staff(public.enquiries.listing_id, auth.uid())
      OR public.is_pnd_admin(auth.uid())
    )
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.listings l
        WHERE l.id = public.enquiries.listing_id
          AND l.owner_id = auth.uid()
      )
      OR public.is_active_listing_staff(public.enquiries.listing_id, auth.uid())
      OR public.is_pnd_admin(auth.uid())
    )
  );

CREATE POLICY "Allow listing owners to delete enquiries"
  ON public.enquiries
  FOR DELETE
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.listings l
        WHERE l.id = public.enquiries.listing_id
          AND l.owner_id = auth.uid()
      )
      OR public.is_super_admin()
    )
  );

-- 5C. `public.marketplace_products` RLS + Owner Sync Trigger
CREATE OR REPLACE FUNCTION public.sync_marketplace_product_owner_v18a()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_listing_owner_id uuid;
  v_listing_hub_id uuid;
BEGIN
  SELECT l.owner_id, l.hub_id
    INTO v_listing_owner_id, v_listing_hub_id
  FROM public.listings l
  WHERE l.id = NEW.listing_id;

  IF v_listing_owner_id IS NOT NULL THEN
    NEW.owner_id := v_listing_owner_id;
  END IF;

  IF v_listing_hub_id IS NOT NULL AND NEW.hub_id IS NULL THEN
    NEW.hub_id := v_listing_hub_id;
  END IF;

  -- Prevent non-admin client edits from spoofing `paid_until`
  IF TG_OP = 'UPDATE'
     AND auth.uid() IS NOT NULL
     AND NOT public.is_pnd_admin(auth.uid())
     AND NEW.paid_until IS DISTINCT FROM OLD.paid_until THEN
    NEW.paid_until := OLD.paid_until;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_marketplace_product_owner_v18a ON public.marketplace_products;
CREATE TRIGGER trg_sync_marketplace_product_owner_v18a
  BEFORE INSERT OR UPDATE ON public.marketplace_products
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_marketplace_product_owner_v18a();

DROP POLICY IF EXISTS "Public can read active marketplace products" ON public.marketplace_products;
DROP POLICY IF EXISTS "Owners admins and staff can insert marketplace products" ON public.marketplace_products;
DROP POLICY IF EXISTS "Owners admins and staff can update marketplace products" ON public.marketplace_products;
DROP POLICY IF EXISTS "Owners admins and staff can delete marketplace products" ON public.marketplace_products;

CREATE POLICY "Public can read active marketplace products"
  ON public.marketplace_products
  FOR SELECT
  USING (
    (
      is_active = true
      AND (paid_until IS NULL OR paid_until > now())
    )
    OR (
      auth.uid() IS NOT NULL
      AND (
        auth.uid() = owner_id
        OR public.is_active_listing_staff(public.marketplace_products.listing_id, auth.uid())
        OR public.is_pnd_admin(auth.uid())
      )
    )
  );

CREATE POLICY "Owners admins and staff can insert marketplace products"
  ON public.marketplace_products
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND (
      auth.uid() = owner_id
      OR EXISTS (
        SELECT 1
        FROM public.listings l
        WHERE l.id = public.marketplace_products.listing_id
          AND l.owner_id = auth.uid()
      )
      OR public.is_active_listing_staff(public.marketplace_products.listing_id, auth.uid())
      OR public.is_pnd_admin(auth.uid())
    )
  );

CREATE POLICY "Owners admins and staff can update marketplace products"
  ON public.marketplace_products
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND (
      auth.uid() = owner_id
      OR public.is_active_listing_staff(public.marketplace_products.listing_id, auth.uid())
      OR public.is_pnd_admin(auth.uid())
    )
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND (
      auth.uid() = owner_id
      OR EXISTS (
        SELECT 1
        FROM public.listings l
        WHERE l.id = public.marketplace_products.listing_id
          AND l.owner_id = auth.uid()
      )
      OR public.is_active_listing_staff(public.marketplace_products.listing_id, auth.uid())
      OR public.is_pnd_admin(auth.uid())
    )
  );

-- Staff can toggle stock / edit products, while permanent product deletion is restricted to Owner or Admin
CREATE POLICY "Owners admins and staff can delete marketplace products"
  ON public.marketplace_products
  FOR DELETE
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND (
      auth.uid() = owner_id
      OR EXISTS (
        SELECT 1
        FROM public.listings l
        WHERE l.id = public.marketplace_products.listing_id
          AND l.owner_id = auth.uid()
      )
      OR public.is_pnd_admin(auth.uid())
    )
  );

-- -----------------------------------------------------------------------------
-- 6. OWNER-INHERITED ENTITLEMENTS & WORKSPACE SUMMARY RPC
--    `public.get_owner_workspace_summary(p_target_owner_id uuid DEFAULT NULL)`
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_owner_workspace_summary(
  p_target_owner_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_owner_id uuid := COALESCE(p_target_owner_id, auth.uid());
  v_is_admin boolean := false;
  v_is_staff_caller boolean := false;
  v_owner_profile record;
  v_ent jsonb;
  v_active_sub record;
  v_default_free record;
  v_subscription_summary jsonb;
  v_targeted_plans jsonb := '[]'::jsonb;
  v_trial_plans jsonb := '[]'::jsonb;
  v_expiring_items jsonb := '[]'::jsonb;
  v_staff_assignments jsonb := '[]'::jsonb;

  v_used_listings integer := 0;
  v_used_marketplace integer := 0;
  v_used_staff integer := 0;
  v_used_bulletins_month integer := 0;
  v_used_bulletins_active integer := 0;

  v_limit_listings integer := NULL;
  v_limit_marketplace integer := NULL;
  v_limit_staff integer := NULL;
  v_staffing_enabled boolean := true;
  v_limit_bulletins_month integer := NULL;
  v_limit_bulletins_active integer := NULL;
  v_raw text;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to load workspace summary.'
      USING ERRCODE = '42501';
  END IF;

  v_is_admin := public.is_pnd_admin(v_caller_id);

  IF v_caller_id <> v_owner_id AND NOT v_is_admin THEN
    -- Check if caller is an active delegated staff member for this owner
    SELECT EXISTS (
      SELECT 1
      FROM public.staff_delegations sd
      JOIN public.listings l ON l.id = sd.listing_id
      WHERE l.owner_id = v_owner_id
        AND sd.staff_id = v_caller_id
        AND COALESCE(sd.status, 'active') = 'active'
        AND COALESCE(l.lifecycle_status, 'active') IN ('active', 'draining')
    ) INTO v_is_staff_caller;

    IF NOT v_is_staff_caller THEN
      RAISE EXCEPTION 'You do not have active owner or delegated staff access for this business.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT
    p.id,
    COALESCE(p.full_name, p.name, p.username, 'Business Owner') AS full_name,
    p.username,
    COALESCE(p.role, 'owner') AS role,
    p.trial_used_at
  INTO v_owner_profile
  FROM public.profiles p
  WHERE p.id = v_owner_id;

  -- Resolve effective entitlements from the OWNER's subscription (staff inherit this!)
  v_ent := public.get_effective_entitlements(v_owner_id, NULL);

  -- Parse numeric quota limits from `v_ent` (NULL or < 0 means unlimited)
  v_raw := COALESCE(
    v_ent #>> '{listings,limit}',
    v_ent #>> '{limits,max_active_listings}'
  );
  IF v_raw IS NOT NULL AND v_raw ~ '^-?[0-9]+$' THEN
    v_limit_listings := CASE WHEN v_raw::integer < 0 THEN NULL ELSE v_raw::integer END;
  END IF;

  v_raw := COALESCE(
    v_ent #>> '{marketplace,limit}',
    v_ent #>> '{limits,max_catalogue_items}',
    v_ent #>> '{limits,max_menu_items}'
  );
  IF v_raw IS NOT NULL AND v_raw ~ '^-?[0-9]+$' THEN
    v_limit_marketplace := CASE WHEN v_raw::integer < 0 THEN NULL ELSE v_raw::integer END;
  END IF;

  v_staffing_enabled := COALESCE(
    (v_ent #>> '{staffing,enabled}')::boolean,
    (v_ent #>> '{features,staff_delegation}')::boolean,
    true
  );
  v_raw := COALESCE(
    v_ent #>> '{staffing,max_staff}',
    v_ent #>> '{staffing,limit}',
    v_ent #>> '{limits,max_staff_members}'
  );
  IF v_raw IS NOT NULL AND v_raw ~ '^-?[0-9]+$' THEN
    v_limit_staff := CASE WHEN v_raw::integer < 0 THEN NULL ELSE v_raw::integer END;
  END IF;

  v_raw := COALESCE(
    v_ent #>> '{bulletin,monthly_limit}',
    v_ent #>> '{bulletin,limit}',
    v_ent #>> '{limits,max_monthly_bulletins}'
  );
  IF v_raw IS NOT NULL AND v_raw ~ '^-?[0-9]+$' THEN
    v_limit_bulletins_month := CASE WHEN v_raw::integer < 0 THEN NULL ELSE v_raw::integer END;
  END IF;

  v_raw := COALESCE(
    v_ent #>> '{bulletin,max_active}',
    v_ent #>> '{limits,max_active_bulletins}'
  );
  IF v_raw IS NOT NULL AND v_raw ~ '^-?[0-9]+$' THEN
    v_limit_bulletins_active := CASE WHEN v_raw::integer < 0 THEN NULL ELSE v_raw::integer END;
  END IF;

  -- Live Quota Usage Counts for `v_owner_id`
  SELECT COUNT(*)::integer
    INTO v_used_listings
  FROM public.listings l
  WHERE l.owner_id = v_owner_id
    AND COALESCE(l.lifecycle_status, 'active') <> 'archived_by_owner'
    AND COALESCE(l.status, 'draft') NOT IN ('archived', 'rejected');

  SELECT COUNT(*)::integer
    INTO v_used_marketplace
  FROM public.marketplace_products mp
  WHERE mp.owner_id = v_owner_id
    AND COALESCE(mp.is_active, true) = true;

  SELECT COUNT(DISTINCT sd.staff_id)::integer
    INTO v_used_staff
  FROM public.staff_delegations sd
  JOIN public.listings l ON l.id = sd.listing_id
  WHERE l.owner_id = v_owner_id
    AND COALESCE(sd.status, 'active') = 'active';

  SELECT
    COUNT(*) FILTER (WHERE b.created_at >= date_trunc('month', now()))::integer,
    COUNT(*) FILTER (
      WHERE b.status = 'published'
        AND (b.expires_at IS NULL OR b.expires_at > now())
    )::integer
  INTO v_used_bulletins_month, v_used_bulletins_active
  FROM public.bulletins b
  WHERE b.author_id = v_owner_id
    AND b.status <> 'removed_by_admin';

  -- Resolve Active or Trialing Subscription (or Default Free Tier fallback)
  SELECT
    us.id AS subscription_id,
    us.plan_id,
    us.status,
    us.starts_at,
    COALESCE(us.ends_at, us.expires_at) AS ends_at,
    COALESCE(sp.title, sp.name, 'Active Plan') AS plan_name,
    sp.slug AS plan_slug,
    COALESCE(sp.info, sp.tagline, '') AS plan_info,
    COALESCE(sp.is_default_free, false) AS is_default_free,
    COALESCE(sp.trial_days, 0) AS trial_days,
    GREATEST(
      0,
      CEIL(EXTRACT(EPOCH FROM (COALESCE(us.ends_at, us.expires_at) - now())) / 86400.0)
    )::integer AS days_remaining
  INTO v_active_sub
  FROM public.user_subscriptions us
  JOIN public.subscription_plans sp ON sp.id = us.plan_id
  WHERE us.user_id = v_owner_id
    AND us.status IN ('active', 'trialing')
    AND (
      COALESCE(us.ends_at, us.expires_at) IS NULL
      OR COALESCE(us.ends_at, us.expires_at) > now()
    )
  ORDER BY
    CASE WHEN us.status = 'active' THEN 0 ELSE 1 END,
    COALESCE(us.ends_at, us.expires_at) DESC NULLS FIRST
  LIMIT 1;

  IF FOUND THEN
    v_subscription_summary := jsonb_build_object(
      'subscription_id', v_active_sub.subscription_id,
      'plan_id', v_active_sub.plan_id,
      'plan_slug', v_active_sub.plan_slug,
      'plan_name', v_active_sub.plan_name,
      'plan_info', v_active_sub.plan_info,
      'status', v_active_sub.status,
      'is_trial', (v_active_sub.status = 'trialing'),
      'is_default_free', v_active_sub.is_default_free,
      'starts_at', v_active_sub.starts_at,
      'ends_at', v_active_sub.ends_at,
      'days_remaining', v_active_sub.days_remaining
    );
  ELSE
    SELECT
      sp.id AS plan_id,
      sp.slug AS plan_slug,
      COALESCE(sp.title, sp.name, 'Default Free Tier') AS plan_name,
      COALESCE(sp.info, sp.tagline, 'Baseline community tier') AS plan_info
    INTO v_default_free
    FROM public.subscription_plans sp
    WHERE sp.is_default_free = true
    LIMIT 1;

    v_subscription_summary := jsonb_build_object(
      'subscription_id', NULL,
      'plan_id', v_default_free.plan_id,
      'plan_slug', COALESCE(v_default_free.plan_slug, 'default-free-tier'),
      'plan_name', COALESCE(v_default_free.plan_name, 'Default Free Tier'),
      'plan_info', COALESCE(v_default_free.plan_info, 'Baseline community tier'),
      'status', 'default_free',
      'is_trial', false,
      'is_default_free', true,
      'starts_at', NULL,
      'ends_at', NULL,
      'days_remaining', NULL
    );
  END IF;

  -- Targeted VIP Plans & Trial-Eligible Plans (Owner / Admin view only)
  IF NOT v_is_staff_caller THEN
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', sp.id,
          'slug', sp.slug,
          'title', COALESCE(sp.title, sp.name),
          'info', COALESCE(sp.info, sp.tagline, ''),
          'trial_days', COALESCE(sp.trial_days, 0),
          'price_inr', COALESCE(sp.price_inr, 0),
          'duration_days', COALESCE(sp.duration_days, 30),
          'target_scope', sp.target_scope
        )
        ORDER BY sp.sort_order ASC, sp.created_at ASC
      ),
      '[]'::jsonb
    )
    INTO v_targeted_plans
    FROM public.subscription_plans sp
    WHERE sp.is_active = true
      AND COALESCE(sp.is_archived, false) = false
      AND sp.target_scope = 'selected_users'
      AND v_owner_id = ANY(COALESCE(sp.target_user_ids, '{}'::uuid[]));

    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', sp.id,
          'slug', sp.slug,
          'title', COALESCE(sp.title, sp.name),
          'info', COALESCE(sp.info, sp.tagline, ''),
          'trial_days', sp.trial_days,
          'price_inr', COALESCE(sp.price_inr, 0),
          'duration_days', COALESCE(sp.duration_days, 30),
          'target_scope', sp.target_scope
        )
        ORDER BY sp.sort_order ASC, sp.created_at ASC
      ),
      '[]'::jsonb
    )
    INTO v_trial_plans
    FROM public.subscription_plans sp
    WHERE sp.is_active = true
      AND COALESCE(sp.is_archived, false) = false
      AND COALESCE(sp.is_default_free, false) = false
      AND COALESCE(sp.trial_days, 0) > 0
      AND (
        sp.target_scope = 'public'
        OR (
          sp.target_scope = 'selected_users'
          AND v_owner_id = ANY(COALESCE(sp.target_user_ids, '{}'::uuid[]))
        )
      );
  END IF;

  -- Expiring / Expired Pay-Per Items (`paid_until <= now() + 7 days`; soft-expired items stay visible!)
  WITH raw_expiring AS (
    SELECT
      mp.id,
      mp.title,
      'marketplace_products'::text AS target_table,
      'marketplace_item'::text AS module_key,
      mp.paid_until,
      COALESCE(mp.price, 0)::numeric AS price_inr,
      'shop_catalogue'::text AS listing_vertical
    FROM public.marketplace_products mp
    WHERE mp.owner_id = v_owner_id
      AND mp.paid_until IS NOT NULL
      AND mp.paid_until <= (now() + interval '7 days')

    UNION ALL

    SELECT
      b.id,
      b.title,
      'bulletins'::text AS target_table,
      'bulletin_post'::text AS module_key,
      b.paid_until,
      0::numeric AS price_inr,
      'bulletin'::text AS listing_vertical
    FROM public.bulletins b
    WHERE b.author_id = v_owner_id
      AND b.paid_until IS NOT NULL
      AND b.paid_until <= (now() + interval '7 days')
      AND b.status <> 'removed_by_admin'

    UNION ALL

    SELECT
      l.id,
      l.title,
      'listings'::text AS target_table,
      CASE
        WHEN COALESCE(l.subcategory, '') ILIKE '%rent%' OR COALESCE(l.subcategory, '') ILIKE '%lease%' OR COALESCE(l.subcategory, '') ILIKE '%pg%'
          THEN 'real_estate_rent'::text
        ELSE 'real_estate_sale'::text
      END AS module_key,
      l.paid_until,
      0::numeric AS price_inr,
      COALESCE(l.listing_vertical, 'real_estate')::text AS listing_vertical
    FROM public.listings l
    WHERE l.owner_id = v_owner_id
      AND l.paid_until IS NOT NULL
      AND l.paid_until <= (now() + interval '7 days')
      AND COALESCE(l.lifecycle_status, 'active') <> 'archived_by_owner'
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', r.id,
        'title', r.title,
        'target_table', r.target_table,
        'module_key', r.module_key,
        'paid_until', r.paid_until,
        'is_expired', (r.paid_until <= now()),
        'days_left', CEIL(EXTRACT(EPOCH FROM (r.paid_until - now())) / 86400.0)::integer,
        'price_inr', r.price_inr,
        'listing_vertical', r.listing_vertical
      )
      ORDER BY r.paid_until ASC
    ),
    '[]'::jsonb
  )
  INTO v_expiring_items
  FROM raw_expiring r;

  -- Active staff delegations for caller when `v_is_staff_caller = true` (or all active staff for owner)
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', sd.id,
        'listing_id', sd.listing_id,
        'listing_title', l.title,
        'listing_vertical', COALESCE(l.listing_vertical, 'general'),
        'parent_owner_id', l.owner_id,
        'parent_lifecycle_status', COALESCE(l.lifecycle_status, 'active'),
        'staff_id', sd.staff_id,
        'status', COALESCE(sd.status, 'active'),
        'permissions', COALESCE(sd.permissions, '{}'::jsonb),
        'vertical_scopes', COALESCE(sd.vertical_scopes, '["enquiries"]'::jsonb)
      )
      ORDER BY sd.granted_at DESC NULLS LAST
    ),
    '[]'::jsonb
  )
  INTO v_staff_assignments
  FROM public.staff_delegations sd
  JOIN public.listings l ON l.id = sd.listing_id
  WHERE l.owner_id = v_owner_id
    AND COALESCE(sd.status, 'active') = 'active'
    AND (NOT v_is_staff_caller OR sd.staff_id = v_caller_id);

  RETURN jsonb_build_object(
    'owner_id', v_owner_id,
    'caller_id', v_caller_id,
    'is_staff_caller', v_is_staff_caller,
    'owner_profile', jsonb_build_object(
      'id', v_owner_profile.id,
      'full_name', COALESCE(v_owner_profile.full_name, 'Business Owner'),
      'username', v_owner_profile.username,
      'role', COALESCE(v_owner_profile.role, 'owner'),
      'trial_used_at', CASE WHEN v_is_staff_caller THEN NULL ELSE v_owner_profile.trial_used_at END,
      'is_trial_eligible', CASE WHEN v_is_staff_caller THEN false ELSE (v_owner_profile.trial_used_at IS NULL) END
    ),
    'effective_entitlements', v_ent,
    'active_subscription', v_subscription_summary,
    'quota_usage', jsonb_build_object(
      'listings', jsonb_build_object(
        'used', v_used_listings,
        'limit', v_limit_listings
      ),
      'marketplace_items', jsonb_build_object(
        'used', v_used_marketplace,
        'limit', v_limit_marketplace
      ),
      'active_staff', jsonb_build_object(
        'used', v_used_staff,
        'limit', v_limit_staff,
        'enabled', v_staffing_enabled
      ),
      'bulletins_this_month', jsonb_build_object(
        'used', v_used_bulletins_month,
        'limit', v_limit_bulletins_month,
        'active_used', v_used_bulletins_active,
        'active_limit', v_limit_bulletins_active
      )
    ),
    'targeted_vip_plans', v_targeted_plans,
    'trial_eligible_plans', v_trial_plans,
    'expiring_pay_per_items', v_expiring_items,
    'staff_assignments', v_staff_assignments
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_owner_workspace_summary(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_owner_workspace_summary(uuid) TO authenticated, service_role;
