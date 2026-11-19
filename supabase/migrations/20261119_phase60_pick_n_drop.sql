-- =============================================================================
-- Migration: 20261119_phase60_pick_n_drop.sql
-- Phase 60-A: Vehicle Pool, Pick N Drop Delivery Orders, Escrow Ledger,
--             Asymmetric OTP Secrets, Private POD Bucket, SECURITY DEFINER RPCs,
--             Strict RLS Policies & Churachandpur Vehicle Type Seed
-- =============================================================================

-- 0. Required Extensions
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =============================================================================
-- 1. Vehicle Pool Tables (Standalone for Pick N Drop + future full vehicle booking)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.vehicle_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  icon text,
  base_fare_inr numeric(10,2) NOT NULL CHECK (base_fare_inr >= 0),
  per_km_rate_inr numeric(10,2) NOT NULL CHECK (per_km_rate_inr >= 0),
  wait_per_10min_inr numeric(10,2) NOT NULL DEFAULT 20 CHECK (wait_per_10min_inr >= 0),
  free_wait_minutes integer NOT NULL DEFAULT 15 CHECK (free_wait_minutes >= 0),
  two_way_multiplier numeric(4,2) NOT NULL DEFAULT 1.75 CHECK (two_way_multiplier >= 1.0),
  max_weight_kg integer NOT NULL CHECK (max_weight_kg > 0),
  max_dimensions text,
  is_active boolean DEFAULT true
);

CREATE TABLE IF NOT EXISTS public.drivers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid UNIQUE REFERENCES public.profiles(id) ON DELETE SET NULL,
  full_name text NOT NULL,
  phone text NOT NULL,
  license_no text NOT NULL,
  kyc_verified boolean DEFAULT false,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.vehicles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  vehicle_type_id uuid NOT NULL REFERENCES public.vehicle_types(id),
  plate_number text UNIQUE NOT NULL,
  rc_number text,
  model_name text,
  is_available boolean DEFAULT true,
  current_location geography(Point, 4326),
  updated_at timestamptz DEFAULT now()
);

-- =============================================================================
-- 2. Pick N Drop & Manual UPI Escrow Tables
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.delivery_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_code text UNIQUE NOT NULL,
  customer_id uuid NOT NULL REFERENCES public.profiles(id),
  mediator_id uuid REFERENCES public.profiles(id),
  driver_id uuid REFERENCES public.drivers(id),
  vehicle_id uuid REFERENCES public.vehicles(id),
  vehicle_type_id uuid NOT NULL REFERENCES public.vehicle_types(id),
  trip_type text NOT NULL CHECK (trip_type IN ('one_way', 'two_way')),
  container_type text NOT NULL CHECK (
    container_type IN ('envelope', 'small_box', 'medium_parcel', 'fragile_crate', 'bulk_sack')
  ),
  declared_value_inr numeric(10,2) DEFAULT 0 CHECK (declared_value_inr >= 0),
  prohibited_items_waiver boolean NOT NULL CHECK (prohibited_items_waiver = true),
  pickup_address text NOT NULL,
  pickup_landmark text,
  pickup_point geography(Point, 4326) NOT NULL,
  sender_phone text NOT NULL,
  dropoff_address text NOT NULL,
  dropoff_landmark text,
  dropoff_point geography(Point, 4326) NOT NULL,
  recipient_name text NOT NULL,
  recipient_phone text NOT NULL,
  distance_km numeric(8,2) NOT NULL CHECK (distance_km >= 0),
  quoted_fare_inr numeric(10,2) NOT NULL CHECK (quoted_fare_inr >= 0),
  quote_expires_at timestamptz NOT NULL,
  status text NOT NULL DEFAULT 'awaiting_payment' CHECK (
    status IN (
      'awaiting_payment',
      'payment_submitted',
      'escrow_held',
      'driver_assigned',
      'picked_up',
      'in_transit',
      'delivered_pending_confirm',
      'return_in_transit',
      'completed',
      'cancelled',
      'disputed'
    )
  ),
  pod_storage_path text,
  pod_uploaded_at timestamptz,
  pod_purge_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Strictly separated OTP secrets table: Drivers have ZERO SELECT access.
CREATE TABLE IF NOT EXISTS public.delivery_order_secrets (
  order_id uuid PRIMARY KEY REFERENCES public.delivery_orders(id) ON DELETE CASCADE,
  pickup_otp text NOT NULL,
  dropoff_otp text NOT NULL,
  return_otp text,
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until timestamptz
);

CREATE TABLE IF NOT EXISTS public.delivery_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.delivery_orders(id) ON DELETE CASCADE,
  tx_type text NOT NULL CHECK (
    tx_type IN (
      'upi_payment',
      'escrow_hold',
      'driver_payout',
      'platform_commission',
      'refund',
      'cancellation_fee'
    )
  ),
  amount_inr numeric(10,2) NOT NULL CHECK (amount_inr >= 0),
  upi_utr_ref text,
  payment_proof_path text,
  recorded_by uuid REFERENCES public.profiles(id),
  notes text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.delivery_order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES public.delivery_orders(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public.profiles(id),
  event_type text NOT NULL,
  payload jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

-- =============================================================================
-- 3. Performance & Geospatial Indexes
-- =============================================================================

CREATE INDEX IF NOT EXISTS idx_vehicles_type_available
  ON public.vehicles (vehicle_type_id, is_available);

CREATE INDEX IF NOT EXISTS idx_vehicles_driver_id
  ON public.vehicles (driver_id);

CREATE INDEX IF NOT EXISTS idx_vehicles_current_location_gist
  ON public.vehicles USING GIST (current_location);

CREATE INDEX IF NOT EXISTS idx_drivers_profile_id
  ON public.drivers (profile_id);

CREATE INDEX IF NOT EXISTS idx_delivery_orders_customer_created
  ON public.delivery_orders (customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_delivery_orders_driver_status
  ON public.delivery_orders (driver_id, status);

CREATE INDEX IF NOT EXISTS idx_delivery_orders_status_created
  ON public.delivery_orders (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_delivery_orders_pickup_gist
  ON public.delivery_orders USING GIST (pickup_point);

CREATE INDEX IF NOT EXISTS idx_delivery_orders_dropoff_gist
  ON public.delivery_orders USING GIST (dropoff_point);

CREATE INDEX IF NOT EXISTS idx_delivery_orders_pod_purge_due
  ON public.delivery_orders (pod_purge_at)
  WHERE pod_storage_path IS NOT NULL AND pod_purge_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_delivery_transactions_order_created
  ON public.delivery_transactions (order_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_delivery_order_events_order_created
  ON public.delivery_order_events (order_id, created_at DESC);

-- =============================================================================
-- 4. Updated-At Maintenance Triggers
-- =============================================================================

CREATE OR REPLACE FUNCTION public.set_pnd_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vehicles_updated_at ON public.vehicles;
CREATE TRIGGER trg_vehicles_updated_at
  BEFORE UPDATE ON public.vehicles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_pnd_updated_at();

DROP TRIGGER IF EXISTS trg_delivery_orders_updated_at ON public.delivery_orders;
CREATE TRIGGER trg_delivery_orders_updated_at
  BEFORE UPDATE ON public.delivery_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.set_pnd_updated_at();

-- =============================================================================
-- 5. Role Helper Functions (SECURITY DEFINER to avoid RLS recursion on profiles)
-- =============================================================================

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
-- 6. Row-Level Security (RLS) Policies
-- =============================================================================

ALTER TABLE public.vehicle_types ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.drivers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_order_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.delivery_order_events ENABLE ROW LEVEL SECURITY;

-- ---- vehicle_types ----
DROP POLICY IF EXISTS "vehicle_types_public_read" ON public.vehicle_types;
CREATE POLICY "vehicle_types_public_read"
  ON public.vehicle_types
  FOR SELECT
  USING (is_active = true OR public.is_pnd_admin(auth.uid()));

DROP POLICY IF EXISTS "vehicle_types_admin_manage" ON public.vehicle_types;
CREATE POLICY "vehicle_types_admin_manage"
  ON public.vehicle_types
  FOR ALL
  TO authenticated
  USING (public.is_pnd_admin(auth.uid()))
  WITH CHECK (public.is_pnd_admin(auth.uid()));

-- ---- drivers ----
DROP POLICY IF EXISTS "drivers_authenticated_select" ON public.drivers;
CREATE POLICY "drivers_authenticated_select"
  ON public.drivers
  FOR SELECT
  TO authenticated
  USING (
    (is_active = true AND kyc_verified = true)
    OR profile_id = auth.uid()
    OR public.is_pnd_mediator(auth.uid())
  );

DROP POLICY IF EXISTS "drivers_mediator_manage" ON public.drivers;
CREATE POLICY "drivers_mediator_manage"
  ON public.drivers
  FOR ALL
  TO authenticated
  USING (public.is_pnd_mediator(auth.uid()))
  WITH CHECK (public.is_pnd_mediator(auth.uid()));

-- ---- vehicles ----
DROP POLICY IF EXISTS "vehicles_authenticated_select" ON public.vehicles;
CREATE POLICY "vehicles_authenticated_select"
  ON public.vehicles
  FOR SELECT
  TO authenticated
  USING (
    is_available = true
    OR EXISTS (
      SELECT 1 FROM public.drivers d
      WHERE d.id = vehicles.driver_id
        AND d.profile_id = auth.uid()
    )
    OR public.is_pnd_mediator(auth.uid())
  );

DROP POLICY IF EXISTS "vehicles_mediator_manage" ON public.vehicles;
CREATE POLICY "vehicles_mediator_manage"
  ON public.vehicles
  FOR ALL
  TO authenticated
  USING (public.is_pnd_mediator(auth.uid()))
  WITH CHECK (public.is_pnd_mediator(auth.uid()));

DROP POLICY IF EXISTS "vehicles_driver_update_own" ON public.vehicles;
CREATE POLICY "vehicles_driver_update_own"
  ON public.vehicles
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.drivers d
      WHERE d.id = vehicles.driver_id
        AND d.profile_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.drivers d
      WHERE d.id = vehicles.driver_id
        AND d.profile_id = auth.uid()
    )
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

DROP POLICY IF EXISTS "delivery_orders_insert" ON public.delivery_orders;
CREATE POLICY "delivery_orders_insert"
  ON public.delivery_orders
  FOR INSERT
  TO authenticated
  WITH CHECK (
    customer_id = auth.uid()
    OR public.is_pnd_mediator(auth.uid())
  );

DROP POLICY IF EXISTS "delivery_orders_mediator_update" ON public.delivery_orders;
CREATE POLICY "delivery_orders_mediator_update"
  ON public.delivery_orders
  FOR UPDATE
  TO authenticated
  USING (
    mediator_id = auth.uid()
    OR public.is_pnd_mediator(auth.uid())
  )
  WITH CHECK (
    mediator_id = auth.uid()
    OR public.is_pnd_mediator(auth.uid())
  );

DROP POLICY IF EXISTS "delivery_orders_customer_payment_update" ON public.delivery_orders;
CREATE POLICY "delivery_orders_customer_payment_update"
  ON public.delivery_orders
  FOR UPDATE
  TO authenticated
  USING (
    customer_id = auth.uid()
    AND status IN ('awaiting_payment', 'payment_submitted')
  )
  WITH CHECK (
    customer_id = auth.uid()
    AND status IN ('awaiting_payment', 'payment_submitted', 'cancelled')
  );

DROP POLICY IF EXISTS "delivery_orders_admin_delete" ON public.delivery_orders;
CREATE POLICY "delivery_orders_admin_delete"
  ON public.delivery_orders
  FOR DELETE
  TO authenticated
  USING (public.is_pnd_admin(auth.uid()));

-- ---- delivery_order_secrets ----
-- CRITICAL: ONLY customer_id (sender) and Mediator/Owner/Admin/SuperAdmin can SELECT.
-- Assigned Drivers have ZERO SELECT/INSERT/UPDATE/DELETE access.
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

DROP POLICY IF EXISTS "delivery_order_secrets_admin_insert" ON public.delivery_order_secrets;
CREATE POLICY "delivery_order_secrets_admin_insert"
  ON public.delivery_order_secrets
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_pnd_admin(auth.uid()));

DROP POLICY IF EXISTS "delivery_order_secrets_admin_delete" ON public.delivery_order_secrets;
CREATE POLICY "delivery_order_secrets_admin_delete"
  ON public.delivery_order_secrets
  FOR DELETE
  TO authenticated
  USING (public.is_pnd_admin(auth.uid()));

-- ---- delivery_transactions ----
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
  );

DROP POLICY IF EXISTS "delivery_transactions_mediator_insert" ON public.delivery_transactions;
CREATE POLICY "delivery_transactions_mediator_insert"
  ON public.delivery_transactions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_pnd_mediator(auth.uid())
    OR (
      tx_type = 'upi_payment'
      AND recorded_by = auth.uid()
      AND EXISTS (
        SELECT 1
        FROM public.delivery_orders o
        WHERE o.id = delivery_transactions.order_id
          AND o.customer_id = auth.uid()
      )
    )
  );

DROP POLICY IF EXISTS "delivery_transactions_admin_update_delete" ON public.delivery_transactions;
CREATE POLICY "delivery_transactions_admin_update_delete"
  ON public.delivery_transactions
  FOR ALL
  TO authenticated
  USING (public.is_pnd_admin(auth.uid()))
  WITH CHECK (public.is_pnd_admin(auth.uid()));

-- ---- delivery_order_events ----
DROP POLICY IF EXISTS "delivery_order_events_select" ON public.delivery_order_events;
CREATE POLICY "delivery_order_events_select"
  ON public.delivery_order_events
  FOR SELECT
  TO authenticated
  USING (
    public.is_pnd_mediator(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.delivery_orders o
      LEFT JOIN public.drivers d ON d.id = o.driver_id
      WHERE o.id = delivery_order_events.order_id
        AND (
          o.customer_id = auth.uid()
          OR o.mediator_id = auth.uid()
          OR d.profile_id = auth.uid()
        )
    )
  );

DROP POLICY IF EXISTS "delivery_order_events_mediator_insert" ON public.delivery_order_events;
CREATE POLICY "delivery_order_events_mediator_insert"
  ON public.delivery_order_events
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_pnd_mediator(auth.uid()));

-- =============================================================================
-- 7. Private Storage Bucket for Proof of Delivery (POD) Images
-- =============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'delivery-pods',
  'delivery-pods',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

DROP POLICY IF EXISTS "delivery_pods_authenticated_upload" ON storage.objects;
CREATE POLICY "delivery_pods_authenticated_upload"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'delivery-pods'
    AND (
      public.is_pnd_mediator(auth.uid())
      OR EXISTS (
        SELECT 1
        FROM public.drivers d
        WHERE d.profile_id = auth.uid()
          AND d.is_active = true
      )
    )
  );

DROP POLICY IF EXISTS "delivery_pods_authorized_select" ON storage.objects;
CREATE POLICY "delivery_pods_authorized_select"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'delivery-pods'
    AND (
      public.is_pnd_mediator(auth.uid())
      OR EXISTS (
        SELECT 1
        FROM public.delivery_orders o
        LEFT JOIN public.drivers d ON d.id = o.driver_id
        WHERE o.pod_storage_path = storage.objects.name
          AND (
            o.customer_id = auth.uid()
            OR o.mediator_id = auth.uid()
            OR d.profile_id = auth.uid()
          )
      )
    )
  );

DROP POLICY IF EXISTS "delivery_pods_admin_delete" ON storage.objects;
CREATE POLICY "delivery_pods_admin_delete"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'delivery-pods'
    AND public.is_pnd_admin(auth.uid())
  );

-- =============================================================================
-- 8. Secure SECURITY DEFINER RPCs
-- =============================================================================

-- 8A. Asymmetric OTP Verification RPC
-- Drivers verify Pickup / Dropoff / Return OTPs exclusively here without ever
-- gaining SELECT access to delivery_order_secrets.
CREATE OR REPLACE FUNCTION public.verify_delivery_otp(
  p_order_id uuid,
  p_stage text,
  p_otp text,
  p_pod_path text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_order public.delivery_orders%ROWTYPE;
  v_secret public.delivery_order_secrets%ROWTYPE;
  v_is_assigned_driver boolean := false;
  v_is_mediator boolean := false;
  v_stage text := lower(trim(COALESCE(p_stage, '')));
  v_otp text := trim(COALESCE(p_otp, ''));
  v_pod_path text := NULLIF(trim(COALESCE(p_pod_path, '')), '');
  v_expected_otp text;
  v_next_status text;
  v_next_attempts integer;
  v_lock_until timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required to verify delivery OTP.';
  END IF;

  IF v_stage NOT IN ('pickup', 'dropoff', 'return') THEN
    RAISE EXCEPTION 'Invalid OTP verification stage "%". Must be pickup, dropoff, or return.', p_stage;
  END IF;

  SELECT *
  INTO v_order
  FROM public.delivery_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Delivery order not found.';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.drivers d
    WHERE d.id = v_order.driver_id
      AND d.profile_id = v_uid
  ) INTO v_is_assigned_driver;

  v_is_mediator := (v_order.mediator_id = v_uid) OR public.is_pnd_mediator(v_uid);

  IF NOT v_is_assigned_driver AND NOT v_is_mediator THEN
    RAISE EXCEPTION 'Forbidden: Only the assigned driver or an authorized mediator/admin can verify this OTP.';
  END IF;

  SELECT *
  INTO v_secret
  FROM public.delivery_order_secrets
  WHERE order_id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OTP secret record not found for this delivery order.';
  END IF;

  -- Enforce 5-attempt lockout window
  IF v_secret.locked_until IS NOT NULL AND v_secret.locked_until > now() THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'OTP_LOCKED',
      'error', 'Too many failed OTP attempts. Verification is temporarily locked.',
      'failed_attempts', v_secret.failed_attempts,
      'locked_until', v_secret.locked_until
    );
  END IF;

  -- Clear expired lockout counter
  IF v_secret.locked_until IS NOT NULL AND v_secret.locked_until <= now() THEN
    v_secret.failed_attempts := 0;
    v_secret.locked_until := NULL;
    UPDATE public.delivery_order_secrets
    SET failed_attempts = 0, locked_until = NULL
    WHERE order_id = p_order_id;
  END IF;

  -- Stage-specific precondition checks
  IF v_stage = 'pickup' THEN
    IF v_order.status NOT IN ('escrow_held', 'driver_assigned', 'picked_up') THEN
      RAISE EXCEPTION 'Order status "%" is not eligible for pickup OTP verification.', v_order.status;
    END IF;
    v_expected_otp := v_secret.pickup_otp;
    v_next_status := 'in_transit';

  ELSIF v_stage = 'dropoff' THEN
    IF v_order.status NOT IN ('picked_up', 'in_transit') THEN
      RAISE EXCEPTION 'Order status "%" is not eligible for dropoff OTP verification.', v_order.status;
    END IF;
    IF v_pod_path IS NULL THEN
      RAISE EXCEPTION 'A Proof of Delivery (POD) photo storage path is required for dropoff verification.';
    END IF;
    v_expected_otp := v_secret.dropoff_otp;
    IF v_order.trip_type = 'two_way' THEN
      v_next_status := 'return_in_transit';
    ELSE
      v_next_status := 'delivered_pending_confirm';
    END IF;

  ELSIF v_stage = 'return' THEN
    IF v_order.trip_type <> 'two_way' THEN
      RAISE EXCEPTION 'Return OTP verification is only valid for two_way orders.';
    END IF;
    IF v_order.status <> 'return_in_transit' THEN
      RAISE EXCEPTION 'Order status "%" is not eligible for return OTP verification.', v_order.status;
    END IF;
    IF v_secret.return_otp IS NULL THEN
      RAISE EXCEPTION 'Return OTP is not configured for this order.';
    END IF;
    v_expected_otp := v_secret.return_otp;
    v_next_status := 'delivered_pending_confirm';
  END IF;

  -- Validate OTP (persist failed_attempts + 15-minute lockout on 5th failure)
  IF v_otp = '' OR v_otp <> v_expected_otp THEN
    v_next_attempts := v_secret.failed_attempts + 1;
    v_lock_until := CASE
      WHEN v_next_attempts >= 5 THEN now() + interval '15 minutes'
      ELSE NULL
    END;

    UPDATE public.delivery_order_secrets
    SET
      failed_attempts = v_next_attempts,
      locked_until = v_lock_until
    WHERE order_id = p_order_id;

    INSERT INTO public.delivery_order_events (order_id, actor_id, event_type, payload)
    VALUES (
      p_order_id,
      v_uid,
      'otp_verification_failed',
      jsonb_build_object(
        'stage', v_stage,
        'failed_attempts', v_next_attempts,
        'locked', (v_lock_until IS NOT NULL),
        'locked_until', v_lock_until
      )
    );

    RETURN jsonb_build_object(
      'ok', false,
      'code', CASE WHEN v_lock_until IS NOT NULL THEN 'OTP_LOCKED' ELSE 'INVALID_OTP' END,
      'error', CASE
        WHEN v_lock_until IS NOT NULL THEN 'Maximum OTP attempts exceeded. Locked for 15 minutes.'
        ELSE 'Invalid OTP. Please verify the 6-digit code and try again.'
      END,
      'failed_attempts', v_next_attempts,
      'attempts_remaining', GREATEST(0, 5 - v_next_attempts),
      'locked_until', v_lock_until
    );
  END IF;

  -- OTP matched: reset attempt counters
  UPDATE public.delivery_order_secrets
  SET
    failed_attempts = 0,
    locked_until = NULL
  WHERE order_id = p_order_id;

  -- Transition order status & store POD if dropoff
  IF v_stage = 'dropoff' THEN
    UPDATE public.delivery_orders
    SET
      status = v_next_status,
      pod_storage_path = v_pod_path,
      pod_uploaded_at = now(),
      updated_at = now()
    WHERE id = p_order_id;
  ELSE
    UPDATE public.delivery_orders
    SET
      status = v_next_status,
      updated_at = now()
    WHERE id = p_order_id;
  END IF;

  INSERT INTO public.delivery_order_events (order_id, actor_id, event_type, payload)
  VALUES (
    p_order_id,
    v_uid,
    'otp_verified_' || v_stage,
    jsonb_build_object(
      'stage', v_stage,
      'previous_status', v_order.status,
      'new_status', v_next_status,
      'pod_recorded', (v_stage = 'dropoff' AND v_pod_path IS NOT NULL)
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'order_id', p_order_id,
    'stage', v_stage,
    'previous_status', v_order.status,
    'status', v_next_status,
    'pod_storage_path', CASE WHEN v_stage = 'dropoff' THEN v_pod_path ELSE v_order.pod_storage_path END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.verify_delivery_otp(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_delivery_otp(uuid, text, text, text) TO authenticated;

-- 8B. Mediator Delivery Confirmation & Escrow Settlement RPC
-- Strictly gated to admin, super_admin, and owner (mediators).
CREATE OR REPLACE FUNCTION public.mediator_confirm_delivery(
  p_order_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_order public.delivery_orders%ROWTYPE;
  v_commission_rate numeric(4,2) := 0.15;
  v_commission_inr numeric(10,2);
  v_driver_payout_inr numeric(10,2);
  v_purge_at timestamptz := now() + interval '48 hours';
BEGIN
  IF v_uid IS NULL OR NOT public.is_pnd_mediator(v_uid) THEN
    RAISE EXCEPTION 'Forbidden: Only authorized mediators (owner, admin, super_admin) can confirm delivery settlement.';
  END IF;

  SELECT *
  INTO v_order
  FROM public.delivery_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Delivery order not found.';
  END IF;

  IF v_order.status <> 'delivered_pending_confirm' THEN
    RAISE EXCEPTION 'Order "%" cannot be confirmed from status "%". Expected delivered_pending_confirm.', v_order.order_code, v_order.status;
  END IF;

  v_commission_inr := round(v_order.quoted_fare_inr * v_commission_rate, 2);
  v_driver_payout_inr := round(v_order.quoted_fare_inr - v_commission_inr, 2);

  UPDATE public.delivery_orders
  SET
    status = 'completed',
    mediator_id = COALESCE(mediator_id, v_uid),
    pod_purge_at = v_purge_at,
    updated_at = now()
  WHERE id = p_order_id;

  INSERT INTO public.delivery_transactions (
    order_id,
    tx_type,
    amount_inr,
    recorded_by,
    notes
  )
  VALUES
    (
      p_order_id,
      'driver_payout',
      v_driver_payout_inr,
      v_uid,
      'Escrow released to driver upon mediator delivery confirmation (85%)'
    ),
    (
      p_order_id,
      'platform_commission',
      v_commission_inr,
      v_uid,
      'Platform mediation commission upon delivery confirmation (15%)'
    );

  INSERT INTO public.delivery_order_events (order_id, actor_id, event_type, payload)
  VALUES (
    p_order_id,
    v_uid,
    'delivery_confirmed_completed',
    jsonb_build_object(
      'previous_status', v_order.status,
      'new_status', 'completed',
      'quoted_fare_inr', v_order.quoted_fare_inr,
      'driver_payout_inr', v_driver_payout_inr,
      'platform_commission_inr', v_commission_inr,
      'pod_purge_at', v_purge_at
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'order_id', p_order_id,
    'order_code', v_order.order_code,
    'status', 'completed',
    'driver_payout_inr', v_driver_payout_inr,
    'platform_commission_inr', v_commission_inr,
    'pod_purge_at', v_purge_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mediator_confirm_delivery(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mediator_confirm_delivery(uuid) TO authenticated;

-- =============================================================================
-- 9. Idempotent Seed: 4 Churachandpur Vehicle Types
-- =============================================================================

INSERT INTO public.vehicle_types (
  slug,
  name,
  icon,
  base_fare_inr,
  per_km_rate_inr,
  wait_per_10min_inr,
  free_wait_minutes,
  two_way_multiplier,
  max_weight_kg,
  max_dimensions,
  is_active
)
VALUES
  (
    'two_wheeler',
    'Two-Wheeler',
    'bike',
    40.00,
    10.00,
    15.00,
    15,
    1.75,
    15,
    '40 x 30 x 30 cm',
    true
  ),
  (
    'e_rickshaw',
    'E-Rickshaw / Auto',
    'car-taxi-front',
    70.00,
    15.00,
    20.00,
    15,
    1.75,
    150,
    '100 x 80 x 80 cm',
    true
  ),
  (
    'mini_van',
    'Mini Van / Alto',
    'car',
    120.00,
    20.00,
    25.00,
    15,
    1.75,
    300,
    '130 x 100 x 90 cm',
    true
  ),
  (
    'pickup_truck',
    'Pickup Truck / Bolero',
    'truck',
    250.00,
    30.00,
    40.00,
    20,
    1.75,
    1000,
    '220 x 150 x 120 cm',
    true
  )
ON CONFLICT (slug) DO NOTHING;
