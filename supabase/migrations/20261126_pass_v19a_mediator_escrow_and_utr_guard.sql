-- =============================================================================
-- Migration: 20261126_pass_v19a_mediator_escrow_and_utr_guard.sql
-- Sprint v19a: Dispatch Mediator / UPI Escrow Workspace & Duplicate UTR Guard
-- 100% Idempotent — Safe to re-run
--
-- Scope:
--   1. Align `is_pnd_mediator(uuid)` to support `mediator`, `hub_manager`,
--      `admin`, `super_admin`, and active `hub_managers` rows.
--   2. Close the deferred `pending_manual` UPI UTR uniqueness gap on
--      `public.payment_intents` (covering `pending_manual` + `succeeded`) and
--      `public.delivery_transactions` (`tx_type = 'upi_payment'`, non-rejected)
--      with safe pre-index deduplication of any legacy test duplicates.
--   3. Add OTP verification milestone timestamps to `delivery_order_secrets`
--      (plus backfill & `verify_delivery_otp` sync) and a zero-secret RPC
--      `get_mediator_otp_milestones` so Mediator UI never receives raw OTPs.
--   4. Add escrow/dispute/dispatch columns & mediator SELECT policies on
--      `delivery_orders`, `vehicle_bookings`, and `payment_intents`.
--   5. Provision 3 role-guarded SECURITY DEFINER Mediator Escrow RPCs:
--      - `mediator_verify_upi_payment(p_booking_id, p_decision, p_notes)`
--      - `mediator_dispatch_driver(p_booking_id, p_driver_id, p_reason)`
--      - `mediator_resolve_escrow_payout(p_booking_id, p_action, p_reason)`
--      Every mutation writes to `public.audit_logs` using exact canonical columns:
--      (actor_id, actor_name, actor_role, workspace, action, target_table,
--       target_id, target_name, details, metadata).
--   6. Re-assert private `delivery-pods` bucket (`public = false`) signed-URL
--      RLS for mediators and add `audit_logs_mediator_own_select` RLS policy.
-- =============================================================================

-- =============================================================================
-- 1. CANONICAL DISPATCH MEDIATOR ROLE HELPER
-- =============================================================================

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
      AND lower(COALESCE(p.role, '')) IN ('mediator', 'hub_manager', 'admin', 'super_admin')
  )
  OR EXISTS (
    SELECT 1
    FROM public.hub_managers hm
    WHERE hm.profile_id = p_uid
      AND hm.is_active = true
  );
$$;

-- =============================================================================
-- 2. CLOSE DEFERRED UPI UTR UNIQUENESS GAP (payment_intents + delivery_transactions)
-- =============================================================================

-- 2a. Normalize & safely deduplicate any legacy test duplicate UTRs on payment_intents
--     across active (`pending_manual`, `succeeded`) rows before adding partial UNIQUE index.
DO $$
DECLARE
  v_dup record;
BEGIN
  IF to_regclass('public.payment_intents') IS NOT NULL THEN
    -- Trim whitespace on non-empty UTRs
    UPDATE public.payment_intents
    SET upi_utr_ref = upper(trim(upi_utr_ref))
    WHERE upi_utr_ref IS NOT NULL
      AND trim(upi_utr_ref) <> ''
      AND upi_utr_ref <> upper(trim(upi_utr_ref));

    -- Deduplicate older duplicate rows in (pending_manual, succeeded) so index creation is idempotent
    FOR v_dup IN
      SELECT id
      FROM (
        SELECT
          id,
          row_number() OVER (
            PARTITION BY upper(trim(upi_utr_ref))
            ORDER BY
              CASE status WHEN 'succeeded' THEN 1 ELSE 2 END ASC,
              created_at ASC,
              id ASC
          ) AS rn
        FROM public.payment_intents
        WHERE status IN ('pending_manual', 'succeeded')
          AND upi_utr_ref IS NOT NULL
          AND trim(upi_utr_ref) <> ''
      ) ranked
      WHERE ranked.rn > 1
    LOOP
      UPDATE public.payment_intents
      SET
        upi_utr_ref = upi_utr_ref || '-DEDUP-' || left(id::text, 6),
        updated_at = now()
      WHERE id = v_dup.id;
    END LOOP;
  END IF;
END;
$$;

-- Partial UNIQUE index blocking duplicate UTR submission even while pending manual verification
CREATE UNIQUE INDEX IF NOT EXISTS idx_payment_intents_unique_active_utr_v19a
  ON public.payment_intents (upper(trim(upi_utr_ref)))
  WHERE status IN ('pending_manual', 'succeeded')
    AND upi_utr_ref IS NOT NULL
    AND trim(upi_utr_ref) <> '';

-- 2b. Add status tracking on delivery_transactions so rejected UTRs can be excluded safely
ALTER TABLE public.delivery_transactions
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.delivery_transactions'::regclass
      AND conname = 'delivery_transactions_status_check'
  ) THEN
    ALTER TABLE public.delivery_transactions
      ADD CONSTRAINT delivery_transactions_status_check
      CHECK (status IN ('active', 'verified', 'rejected', 'refunded'));
  END IF;
END;
$$;

-- Normalize & safely deduplicate any legacy test duplicate UTRs on delivery_transactions
DO $$
DECLARE
  v_dup record;
BEGIN
  IF to_regclass('public.delivery_transactions') IS NOT NULL THEN
    UPDATE public.delivery_transactions
    SET upi_utr_ref = upper(trim(upi_utr_ref))
    WHERE upi_utr_ref IS NOT NULL
      AND trim(upi_utr_ref) <> ''
      AND upi_utr_ref <> upper(trim(upi_utr_ref));

    FOR v_dup IN
      SELECT id
      FROM (
        SELECT
          id,
          row_number() OVER (
            PARTITION BY upper(trim(upi_utr_ref))
            ORDER BY
              CASE status WHEN 'verified' THEN 1 ELSE 2 END ASC,
              created_at ASC,
              id ASC
          ) AS rn
        FROM public.delivery_transactions
        WHERE tx_type = 'upi_payment'
          AND status IN ('active', 'verified')
          AND upi_utr_ref IS NOT NULL
          AND trim(upi_utr_ref) <> ''
      ) ranked
      WHERE ranked.rn > 1
    LOOP
      UPDATE public.delivery_transactions
      SET upi_utr_ref = upi_utr_ref || '-DEDUP-' || left(id::text, 6)
      WHERE id = v_dup.id;
    END LOOP;
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_delivery_transactions_unique_active_utr_v19a
  ON public.delivery_transactions (upper(trim(upi_utr_ref)))
  WHERE tx_type = 'upi_payment'
    AND status IN ('active', 'verified')
    AND upi_utr_ref IS NOT NULL
    AND trim(upi_utr_ref) <> '';

-- =============================================================================
-- 3. ESCROW / DISPUTE COLUMNS & OTP MILESTONE TIMESTAMPS
-- =============================================================================

ALTER TABLE public.delivery_orders
  ADD COLUMN IF NOT EXISTS payment_verified_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS dispute_reason text,
  ADD COLUMN IF NOT EXISTS payout_released_at timestamptz;

ALTER TABLE public.delivery_order_secrets
  ADD COLUMN IF NOT EXISTS pickup_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS dropoff_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS return_verified_at timestamptz;

-- Backfill OTP milestone timestamps from historical delivery_order_events
UPDATE public.delivery_order_secrets s
SET
  pickup_verified_at = COALESCE(
    s.pickup_verified_at,
    (SELECT max(e.created_at) FROM public.delivery_order_events e WHERE e.order_id = s.order_id AND e.event_type = 'otp_verified_pickup')
  ),
  dropoff_verified_at = COALESCE(
    s.dropoff_verified_at,
    (SELECT max(e.created_at) FROM public.delivery_order_events e WHERE e.order_id = s.order_id AND e.event_type = 'otp_verified_dropoff')
  ),
  return_verified_at = COALESCE(
    s.return_verified_at,
    (SELECT max(e.created_at) FROM public.delivery_order_events e WHERE e.order_id = s.order_id AND e.event_type = 'otp_verified_return')
  );

-- Update verify_delivery_otp to also stamp *_verified_at on delivery_order_secrets
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

  IF v_secret.locked_until IS NOT NULL AND v_secret.locked_until > now() THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'OTP_LOCKED',
      'error', 'Too many failed OTP attempts. Verification is temporarily locked.',
      'failed_attempts', v_secret.failed_attempts,
      'locked_until', v_secret.locked_until
    );
  END IF;

  IF v_secret.locked_until IS NOT NULL AND v_secret.locked_until <= now() THEN
    v_secret.failed_attempts := 0;
    v_secret.locked_until := NULL;
    UPDATE public.delivery_order_secrets
    SET failed_attempts = 0, locked_until = NULL
    WHERE order_id = p_order_id;
  END IF;

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
    IF COALESCE(v_order.pod_required, true) = true AND v_pod_path IS NULL THEN
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

  -- OTP matched: reset attempt counters & stamp milestone verification timestamp
  UPDATE public.delivery_order_secrets
  SET
    failed_attempts = 0,
    locked_until = NULL,
    pickup_verified_at = CASE WHEN v_stage = 'pickup' THEN now() ELSE pickup_verified_at END,
    dropoff_verified_at = CASE WHEN v_stage = 'dropoff' THEN now() ELSE dropoff_verified_at END,
    return_verified_at = CASE WHEN v_stage = 'return' THEN now() ELSE return_verified_at END
  WHERE order_id = p_order_id;

  IF v_stage = 'dropoff' AND v_pod_path IS NOT NULL THEN
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
      'service_mode', v_order.service_mode,
      'pod_required', v_order.pod_required,
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

-- Vehicle bookings escrow/dispute/dispatch columns
ALTER TABLE public.vehicle_bookings
  ADD COLUMN IF NOT EXISTS assigned_driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS mediator_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_verified_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS escrow_status text NOT NULL DEFAULT 'unpaid',
  ADD COLUMN IF NOT EXISTS dispute_reason text,
  ADD COLUMN IF NOT EXISTS payout_released_at timestamptz,
  ADD COLUMN IF NOT EXISTS pod_storage_path text,
  ADD COLUMN IF NOT EXISTS pod_uploaded_at timestamptz,
  ADD COLUMN IF NOT EXISTS pod_purge_at timestamptz;

-- Expand vehicle_bookings.status CHECK constraint idempotently to include 'disputed'
DO $$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT c.conname
    INTO v_constraint_name
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'vehicle_bookings'
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) ILIKE '%soft_hold%';

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.vehicle_bookings DROP CONSTRAINT %I', v_constraint_name);
  END IF;

  ALTER TABLE public.vehicle_bookings
    ADD CONSTRAINT vehicle_bookings_status_check
    CHECK (
      status IN (
        'soft_hold',
        'pending_payment_confirm',
        'confirmed',
        'in_progress',
        'completed',
        'cancelled',
        'expired',
        'disputed'
      )
    );
END;
$$;

-- Allow dispatch mediators to view logistics/vehicle payment intents and vehicle bookings
DROP POLICY IF EXISTS "Users view own payment intents and admins view all" ON public.payment_intents;
CREATE POLICY "Users view own payment intents and admins view all"
  ON public.payment_intents
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id
    OR public.is_pnd_admin(auth.uid())
    OR (
      public.is_pnd_mediator(auth.uid())
      AND purpose IN ('pick_n_drop', 'vehicle_booking')
    )
  );

DROP POLICY IF EXISTS "Customers vehicle managers and admins view bookings" ON public.vehicle_bookings;
CREATE POLICY "Customers vehicle managers and admins view bookings"
  ON public.vehicle_bookings
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = customer_id
    OR public.is_vehicle_listing_manager(vehicle_listing_id, auth.uid())
    OR public.is_pnd_mediator(auth.uid())
  );

-- =============================================================================
-- 4. ZERO-SECRET OTP MILESTONE READ RPC (NEVER RETURNS RAW OTP CODES)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_mediator_otp_milestones(
  p_order_ids uuid[] DEFAULT ARRAY[]::uuid[],
  p_booking_ids uuid[] DEFAULT ARRAY[]::uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_delivery_milestones jsonb := '{}'::jsonb;
  v_vehicle_milestones jsonb := '{}'::jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.is_pnd_mediator(v_uid) THEN
    RAISE EXCEPTION 'Forbidden: Authorized Dispatch Mediator or Admin role required.'
      USING ERRCODE = '42501';
  END IF;

  IF array_length(p_order_ids, 1) IS NOT NULL THEN
    SELECT COALESCE(
      jsonb_object_agg(
        s.order_id::text,
        jsonb_build_object(
          'pickup_verified', (s.pickup_verified_at IS NOT NULL),
          'pickup_verified_at', s.pickup_verified_at,
          'dropoff_verified', (s.dropoff_verified_at IS NOT NULL),
          'dropoff_verified_at', s.dropoff_verified_at,
          'return_required', (s.return_otp IS NOT NULL),
          'return_verified', (s.return_verified_at IS NOT NULL),
          'return_verified_at', s.return_verified_at,
          'failed_attempts', s.failed_attempts,
          'is_locked', (s.locked_until IS NOT NULL AND s.locked_until > now())
        )
      ),
      '{}'::jsonb
    )
    INTO v_delivery_milestones
    FROM public.delivery_order_secrets s
    WHERE s.order_id = ANY(p_order_ids);
  END IF;

  IF array_length(p_booking_ids, 1) IS NOT NULL THEN
    SELECT COALESCE(
      jsonb_object_agg(
        o.booking_id::text,
        jsonb_build_object(
          'pickup_verified', (o.pickup_verified_at IS NOT NULL),
          'pickup_verified_at', o.pickup_verified_at,
          'dropoff_verified', (o.dropoff_verified_at IS NOT NULL),
          'dropoff_verified_at', o.dropoff_verified_at,
          'return_required', (o.return_otp IS NOT NULL),
          'return_verified', (o.return_verified_at IS NOT NULL),
          'return_verified_at', o.return_verified_at,
          'failed_attempts', o.failed_attempts,
          'is_locked', (o.locked_until IS NOT NULL AND o.locked_until > now())
        )
      ),
      '{}'::jsonb
    )
    INTO v_vehicle_milestones
    FROM public.vehicle_booking_otps o
    WHERE o.booking_id = ANY(p_booking_ids);
  END IF;

  RETURN jsonb_build_object(
    'delivery', v_delivery_milestones,
    'vehicle', v_vehicle_milestones
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_mediator_otp_milestones(uuid[], uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_mediator_otp_milestones(uuid[], uuid[]) TO authenticated;

-- =============================================================================
-- 5. INTERNAL HELPER: CANONICAL MEDIATOR AUDIT LOGGER
-- =============================================================================

CREATE OR REPLACE FUNCTION public._log_mediator_audit_v19a(
  p_actor_id uuid,
  p_action text,
  p_target_table text,
  p_target_id text,
  p_target_name text,
  p_details text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_name text;
  v_actor_role text;
BEGIN
  SELECT
    COALESCE(NULLIF(trim(p.full_name), ''), NULLIF(trim(p.email), ''), 'Dispatch Mediator'),
    COALESCE(NULLIF(trim(p.role), ''), 'mediator')
  INTO v_actor_name, v_actor_role
  FROM public.profiles p
  WHERE p.id = p_actor_id;

  INSERT INTO public.audit_logs (
    actor_id,
    actor_name,
    actor_role,
    workspace,
    action,
    target_table,
    target_id,
    target_name,
    details,
    metadata
  )
  VALUES (
    p_actor_id,
    COALESCE(v_actor_name, 'Dispatch Mediator'),
    COALESCE(v_actor_role, 'mediator'),
    'mediator',
    p_action,
    p_target_table,
    p_target_id,
    p_target_name,
    p_details,
    COALESCE(p_metadata, '{}'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public._log_mediator_audit_v19a(uuid, text, text, text, text, text, jsonb) FROM PUBLIC;

-- =============================================================================
-- 6. ROLE-GUARDED MEDIATOR ESCROW RPCs
-- =============================================================================

-- 6A. mediator_verify_upi_payment(p_booking_id uuid, p_decision text, p_notes text DEFAULT NULL)
CREATE OR REPLACE FUNCTION public.mediator_verify_upi_payment(
  p_booking_id uuid,
  p_decision text,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_decision text := lower(trim(COALESCE(p_decision, '')));
  v_notes text := NULLIF(trim(COALESCE(p_notes, '')), '');
  v_order public.delivery_orders%ROWTYPE;
  v_booking public.vehicle_bookings%ROWTYPE;
  v_intent public.payment_intents%ROWTYPE;
  v_utr_ref text;
  v_proof_path text;
  v_has_escrow_tx boolean := false;
  v_target_id uuid := p_booking_id;
  v_domain text := NULL;
BEGIN
  IF v_uid IS NULL OR NOT public.is_pnd_mediator(v_uid) THEN
    RAISE EXCEPTION 'Forbidden: Only authorized Dispatch Mediators, Hub Managers, or Admins may verify UPI payments.'
      USING ERRCODE = '42501';
  END IF;

  IF v_decision NOT IN ('verify', 'reject') THEN
    RAISE EXCEPTION 'Invalid decision "%". Expected verify or reject.', p_decision
      USING ERRCODE = '22023';
  END IF;

  IF v_decision = 'reject' AND (v_notes IS NULL OR length(v_notes) < 3) THEN
    RAISE EXCEPTION 'A rejection reason (at least 3 characters) is mandatory when rejecting a UPI payment.'
      USING ERRCODE = '22023';
  END IF;

  -- Resolve target domain: delivery_orders -> vehicle_bookings -> payment_intents
  SELECT * INTO v_order FROM public.delivery_orders WHERE id = v_target_id FOR UPDATE;
  IF FOUND THEN
    v_domain := 'delivery_orders';
  ELSE
    SELECT * INTO v_booking FROM public.vehicle_bookings WHERE id = v_target_id FOR UPDATE;
    IF FOUND THEN
      v_domain := 'vehicle_bookings';
    ELSE
      SELECT * INTO v_intent
      FROM public.payment_intents
      WHERE id = v_target_id
        AND purpose IN ('pick_n_drop', 'vehicle_booking')
      FOR UPDATE;

      IF FOUND THEN
        IF v_intent.purpose = 'pick_n_drop' THEN
          SELECT * INTO v_order FROM public.delivery_orders WHERE id = v_intent.reference_id FOR UPDATE;
          IF FOUND THEN
            v_domain := 'delivery_orders';
            v_target_id := v_order.id;
          END IF;
        ELSIF v_intent.purpose = 'vehicle_booking' THEN
          SELECT * INTO v_booking FROM public.vehicle_bookings WHERE id = v_intent.reference_id FOR UPDATE;
          IF FOUND THEN
            v_domain := 'vehicle_bookings';
            v_target_id := v_booking.id;
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;

  IF v_domain IS NULL THEN
    RAISE EXCEPTION 'Booking or payment record not found.'
      USING ERRCODE = 'P0002';
  END IF;

  -- ---- PICK N DROP DELIVERY ORDER ----
  IF v_domain = 'delivery_orders' THEN
    -- Locate linked payment intent if any
    IF v_intent.id IS NULL THEN
      SELECT * INTO v_intent
      FROM public.payment_intents
      WHERE purpose = 'pick_n_drop'
        AND reference_id = v_order.id
      ORDER BY created_at DESC
      LIMIT 1
      FOR UPDATE;
    END IF;

    SELECT dt.upi_utr_ref, dt.payment_proof_path
      INTO v_utr_ref, v_proof_path
    FROM public.delivery_transactions dt
    WHERE dt.order_id = v_order.id
      AND dt.tx_type = 'upi_payment'
      AND dt.status IN ('active', 'verified')
    ORDER BY dt.created_at DESC
    LIMIT 1;

    v_utr_ref := COALESCE(v_utr_ref, v_intent.upi_utr_ref);
    v_proof_path := COALESCE(v_proof_path, v_intent.payment_proof_path);

    IF v_decision = 'verify' THEN
      IF v_order.status NOT IN ('awaiting_payment', 'payment_submitted', 'escrow_held') THEN
        RAISE EXCEPTION 'Order % cannot be verified from status "%".', v_order.order_code, v_order.status
          USING ERRCODE = 'P0001';
      END IF;

      UPDATE public.delivery_orders
      SET
        status = 'escrow_held',
        mediator_id = COALESCE(mediator_id, v_uid),
        payment_verified_by = v_uid,
        payment_verified_at = now(),
        updated_at = now()
      WHERE id = v_order.id;

      UPDATE public.delivery_transactions
      SET status = 'verified'
      WHERE order_id = v_order.id
        AND tx_type = 'upi_payment'
        AND status = 'active';

      SELECT EXISTS (
        SELECT 1
        FROM public.delivery_transactions
        WHERE order_id = v_order.id
          AND tx_type = 'escrow_hold'
      ) INTO v_has_escrow_tx;

      IF NOT v_has_escrow_tx THEN
        INSERT INTO public.delivery_transactions (
          order_id, tx_type, amount_inr, upi_utr_ref, payment_proof_path, recorded_by, status, notes
        )
        VALUES (
          v_order.id,
          'escrow_hold',
          v_order.quoted_fare_inr,
          v_utr_ref,
          v_proof_path,
          v_uid,
          'verified',
          COALESCE(v_notes, 'UPI UTR verified and escrow funded by Dispatch Mediator')
        );
      END IF;

      IF v_intent.id IS NOT NULL AND v_intent.status <> 'succeeded' THEN
        UPDATE public.payment_intents
        SET
          status = 'succeeded',
          verified_by = v_uid,
          provider_payment_id = COALESCE(provider_payment_id, v_utr_ref),
          updated_at = now()
        WHERE id = v_intent.id;
      END IF;

      INSERT INTO public.delivery_order_events (order_id, actor_id, event_type, payload)
      VALUES (
        v_order.id,
        v_uid,
        'escrow_held',
        jsonb_build_object(
          'utr_ref', v_utr_ref,
          'amount_inr', v_order.quoted_fare_inr,
          'notes', v_notes
        )
      );

      PERFORM public._log_mediator_audit_v19a(
        v_uid,
        'mediator_verify_upi_payment',
        'delivery_orders',
        v_order.id::text,
        v_order.order_code,
        'Verified UPI payment and funded escrow for ' || v_order.order_code,
        jsonb_build_object(
          'decision', 'verify',
          'domain', 'pick_n_drop',
          'order_code', v_order.order_code,
          'amount_inr', v_order.quoted_fare_inr,
          'utr_ref', v_utr_ref,
          'notes', v_notes
        )
      );

      RETURN jsonb_build_object(
        'ok', true,
        'domain', 'pick_n_drop',
        'booking_id', v_order.id,
        'code', v_order.order_code,
        'status', 'escrow_held',
        'verified_at', now()
      );
    ELSE
      -- Reject manual UPI payment cleanly so UTR is never approved
      UPDATE public.delivery_orders
      SET
        status = 'awaiting_payment',
        mediator_id = COALESCE(mediator_id, v_uid),
        dispute_reason = v_notes,
        updated_at = now()
      WHERE id = v_order.id
        AND status IN ('awaiting_payment', 'payment_submitted');

      UPDATE public.delivery_transactions
      SET
        status = 'rejected',
        notes = COALESCE(notes || ' | ', '') || 'Rejected by Mediator: ' || v_notes
      WHERE order_id = v_order.id
        AND tx_type = 'upi_payment'
        AND status = 'active';

      IF v_intent.id IS NOT NULL AND v_intent.status IN ('awaiting_payment', 'pending_manual') THEN
        UPDATE public.payment_intents
        SET
          status = 'rejected',
          verified_by = v_uid,
          refund_notes = v_notes,
          updated_at = now()
        WHERE id = v_intent.id;
      END IF;

      INSERT INTO public.delivery_order_events (order_id, actor_id, event_type, payload)
      VALUES (
        v_order.id,
        v_uid,
        'upi_payment_rejected',
        jsonb_build_object(
          'utr_ref', v_utr_ref,
          'reason', v_notes
        )
      );

      PERFORM public._log_mediator_audit_v19a(
        v_uid,
        'mediator_reject_upi_payment',
        'delivery_orders',
        v_order.id::text,
        v_order.order_code,
        'Rejected UPI payment for ' || v_order.order_code || ': ' || v_notes,
        jsonb_build_object(
          'decision', 'reject',
          'domain', 'pick_n_drop',
          'order_code', v_order.order_code,
          'amount_inr', v_order.quoted_fare_inr,
          'utr_ref', v_utr_ref,
          'reason', v_notes
        )
      );

      RETURN jsonb_build_object(
        'ok', true,
        'domain', 'pick_n_drop',
        'booking_id', v_order.id,
        'code', v_order.order_code,
        'status', 'awaiting_payment',
        'rejected', true
      );
    END IF;
  END IF;

  -- ---- SCHEDULED VEHICLE BOOKING ----
  IF v_intent.id IS NULL THEN
    SELECT * INTO v_intent
    FROM public.payment_intents
    WHERE (v_booking.payment_intent_id IS NOT NULL AND id = v_booking.payment_intent_id)
       OR (purpose = 'vehicle_booking' AND reference_id = v_booking.id)
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;
  END IF;

  v_utr_ref := v_intent.upi_utr_ref;

  IF v_decision = 'verify' THEN
    IF v_booking.status NOT IN ('soft_hold', 'pending_payment_confirm', 'confirmed') THEN
      RAISE EXCEPTION 'Vehicle booking % cannot be verified from status "%".', v_booking.booking_code, v_booking.status
        USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.vehicle_bookings
    SET
      status = 'confirmed',
      hold_expires_at = NULL,
      mediator_id = COALESCE(mediator_id, v_uid),
      payment_verified_by = v_uid,
      payment_verified_at = now(),
      escrow_status = 'escrow_held',
      updated_at = now()
    WHERE id = v_booking.id;

    IF v_intent.id IS NOT NULL AND v_intent.status <> 'succeeded' THEN
      UPDATE public.payment_intents
      SET
        status = 'succeeded',
        verified_by = v_uid,
        provider_payment_id = COALESCE(provider_payment_id, v_utr_ref),
        updated_at = now()
      WHERE id = v_intent.id;
    END IF;

    PERFORM public._log_mediator_audit_v19a(
      v_uid,
      'mediator_verify_upi_payment',
      'vehicle_bookings',
      v_booking.id::text,
      v_booking.booking_code,
      'Verified UPI advance and confirmed vehicle booking ' || v_booking.booking_code,
      jsonb_build_object(
        'decision', 'verify',
        'domain', 'vehicle_booking',
        'booking_code', v_booking.booking_code,
        'amount_inr', COALESCE(v_intent.amount_inr, v_booking.advance_amount_inr),
        'utr_ref', v_utr_ref,
        'notes', v_notes
      )
    );

    RETURN jsonb_build_object(
      'ok', true,
      'domain', 'vehicle_booking',
      'booking_id', v_booking.id,
      'code', v_booking.booking_code,
      'status', 'confirmed',
      'verified_at', now()
    );
  ELSE
    UPDATE public.vehicle_bookings
    SET
      status = 'cancelled',
      hold_expires_at = NULL,
      mediator_id = COALESCE(mediator_id, v_uid),
      escrow_status = 'rejected',
      dispute_reason = v_notes,
      updated_at = now()
    WHERE id = v_booking.id
      AND status IN ('soft_hold', 'pending_payment_confirm');

    IF v_intent.id IS NOT NULL AND v_intent.status IN ('awaiting_payment', 'pending_manual') THEN
      UPDATE public.payment_intents
      SET
        status = 'rejected',
        verified_by = v_uid,
        refund_notes = v_notes,
        updated_at = now()
      WHERE id = v_intent.id;
    END IF;

    PERFORM public._log_mediator_audit_v19a(
      v_uid,
      'mediator_reject_upi_payment',
      'vehicle_bookings',
      v_booking.id::text,
      v_booking.booking_code,
      'Rejected UPI payment for vehicle booking ' || v_booking.booking_code || ': ' || v_notes,
      jsonb_build_object(
        'decision', 'reject',
        'domain', 'vehicle_booking',
        'booking_code', v_booking.booking_code,
        'amount_inr', COALESCE(v_intent.amount_inr, v_booking.advance_amount_inr),
        'utr_ref', v_utr_ref,
        'reason', v_notes
      )
    );

    RETURN jsonb_build_object(
      'ok', true,
      'domain', 'vehicle_booking',
      'booking_id', v_booking.id,
      'code', v_booking.booking_code,
      'status', 'cancelled',
      'rejected', true
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.mediator_verify_upi_payment(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mediator_verify_upi_payment(uuid, text, text) TO authenticated;

-- 6B. mediator_dispatch_driver(p_booking_id uuid, p_driver_id uuid, p_reason text DEFAULT NULL)
CREATE OR REPLACE FUNCTION public.mediator_dispatch_driver(
  p_booking_id uuid,
  p_driver_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_reason text := NULLIF(trim(COALESCE(p_reason, '')), '');
  v_driver public.drivers%ROWTYPE;
  v_order public.delivery_orders%ROWTYPE;
  v_booking public.vehicle_bookings%ROWTYPE;
  v_listing public.vehicle_listings%ROWTYPE;
  v_required_slug text;
  v_driver_canonical_slug text;
  v_escrow_required boolean := true;
  v_vehicle_id uuid;
  v_is_reassignment boolean := false;
BEGIN
  IF v_uid IS NULL OR NOT public.is_pnd_mediator(v_uid) THEN
    RAISE EXCEPTION 'Forbidden: Only authorized Dispatch Mediators, Hub Managers, or Admins may dispatch drivers.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_driver
  FROM public.drivers
  WHERE id = p_driver_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected driver was not found.'
      USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_driver.is_active, false) = false
     OR (COALESCE(v_driver.kyc_verified, false) = false AND COALESCE(v_driver.kyc_status, 'pending') <> 'verified') THEN
    RAISE EXCEPTION 'Only active, KYC-verified drivers may be dispatched.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Canonicalize legacy driver vehicle_type aliases to the 5 fleet classes
  v_driver_canonical_slug := CASE lower(COALESCE(v_driver.vehicle_type, ''))
    WHEN 'auto' THEN 'e_rickshaw'
    WHEN 'car' THEN 'mini_van'
    ELSE lower(COALESCE(v_driver.vehicle_type, ''))
  END;

  -- Check Pick N Drop delivery_orders first
  SELECT * INTO v_order FROM public.delivery_orders WHERE id = p_booking_id FOR UPDATE;
  IF FOUND THEN
    SELECT COALESCE(p.escrow_required, true)
      INTO v_escrow_required
    FROM public.payment_feature_policies p
    WHERE p.scope_key = 'pnd';

    IF v_escrow_required AND v_order.status NOT IN ('escrow_held', 'driver_assigned') THEN
      RAISE EXCEPTION 'Order % requires funded escrow before driver dispatch (current status: "%").',
        v_order.order_code, v_order.status
        USING ERRCODE = 'P0001';
    ELSIF NOT v_escrow_required AND v_order.status NOT IN ('awaiting_payment', 'payment_submitted', 'escrow_held', 'driver_assigned') THEN
      RAISE EXCEPTION 'Order % cannot be dispatched from status "%".', v_order.order_code, v_order.status
        USING ERRCODE = 'P0001';
    END IF;

    SELECT lower(vt.slug) INTO v_required_slug
    FROM public.vehicle_types vt
    WHERE vt.id = v_order.vehicle_type_id;

    -- Find a matching vehicle for this driver if registered
    SELECT v.id INTO v_vehicle_id
    FROM public.vehicles v
    WHERE v.driver_id = v_driver.id
      AND v.vehicle_type_id = v_order.vehicle_type_id
    ORDER BY COALESCE(v.is_available, true) DESC, v.updated_at DESC
    LIMIT 1;

    IF v_required_slug IS NOT NULL
       AND v_driver_canonical_slug <> v_required_slug
       AND v_vehicle_id IS NULL THEN
      RAISE EXCEPTION 'Driver fleet class (%) does not match required vehicle class (%).',
        v_driver.vehicle_type, v_required_slug
        USING ERRCODE = '22023';
    END IF;

    v_is_reassignment := (v_order.driver_id IS NOT NULL AND v_order.driver_id <> v_driver.id);

    UPDATE public.delivery_orders
    SET
      driver_id = v_driver.id,
      vehicle_id = COALESCE(v_vehicle_id, vehicle_id),
      mediator_id = COALESCE(mediator_id, v_uid),
      status = 'driver_assigned',
      updated_at = now()
    WHERE id = v_order.id;

    INSERT INTO public.delivery_order_events (order_id, actor_id, event_type, payload)
    VALUES (
      v_order.id,
      v_uid,
      CASE WHEN v_is_reassignment THEN 'driver_reassigned' ELSE 'driver_assigned' END,
      jsonb_build_object(
        'previous_driver_id', v_order.driver_id,
        'driver_id', v_driver.id,
        'driver_name', v_driver.full_name,
        'vehicle_id', v_vehicle_id,
        'reason', v_reason
      )
    );

    PERFORM public._log_mediator_audit_v19a(
      v_uid,
      CASE WHEN v_is_reassignment THEN 'mediator_reassign_driver' ELSE 'mediator_dispatch_driver' END,
      'delivery_orders',
      v_order.id::text,
      v_order.order_code,
      (CASE WHEN v_is_reassignment THEN 'Reassigned' ELSE 'Dispatched' END)
        || ' driver ' || v_driver.full_name || ' to ' || v_order.order_code,
      jsonb_build_object(
        'domain', 'pick_n_drop',
        'order_code', v_order.order_code,
        'previous_driver_id', v_order.driver_id,
        'driver_id', v_driver.id,
        'driver_name', v_driver.full_name,
        'vehicle_class', v_required_slug,
        'reason', v_reason
      )
    );

    RETURN jsonb_build_object(
      'ok', true,
      'domain', 'pick_n_drop',
      'booking_id', v_order.id,
      'code', v_order.order_code,
      'driver_id', v_driver.id,
      'driver_name', v_driver.full_name,
      'status', 'driver_assigned',
      'reassigned', v_is_reassignment
    );
  END IF;

  -- Check Scheduled Vehicle bookings
  SELECT * INTO v_booking FROM public.vehicle_bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found.'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT COALESCE(p.escrow_required, true)
    INTO v_escrow_required
  FROM public.payment_feature_policies p
  WHERE p.scope_key = 'vehicles';

  IF v_escrow_required AND v_booking.status NOT IN ('confirmed', 'in_progress') THEN
    RAISE EXCEPTION 'Vehicle booking % must be funded and confirmed before driver dispatch (current status: "%").',
      v_booking.booking_code, v_booking.status
      USING ERRCODE = 'P0001';
  ELSIF NOT v_escrow_required AND v_booking.status NOT IN ('soft_hold', 'pending_payment_confirm', 'confirmed', 'in_progress') THEN
    RAISE EXCEPTION 'Vehicle booking % cannot be dispatched from status "%".', v_booking.booking_code, v_booking.status
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_listing FROM public.vehicle_listings WHERE id = v_booking.vehicle_listing_id;
  IF FOUND THEN
    SELECT lower(vt.slug) INTO v_required_slug
    FROM public.vehicle_types vt
    WHERE vt.id = v_listing.vehicle_type_id;

    SELECT v.id INTO v_vehicle_id
    FROM public.vehicles v
    WHERE v.driver_id = v_driver.id
      AND v.vehicle_type_id = v_listing.vehicle_type_id
    LIMIT 1;

    IF v_required_slug IS NOT NULL
       AND v_driver_canonical_slug <> v_required_slug
       AND v_vehicle_id IS NULL THEN
      RAISE EXCEPTION 'Driver fleet class (%) does not match required vehicle class (%).',
        v_driver.vehicle_type, v_required_slug
        USING ERRCODE = '22023';
    END IF;
  END IF;

  v_is_reassignment := (v_booking.assigned_driver_id IS NOT NULL AND v_booking.assigned_driver_id <> v_driver.id);

  UPDATE public.vehicle_bookings
  SET
    assigned_driver_id = v_driver.id,
    mediator_id = COALESCE(mediator_id, v_uid),
    updated_at = now()
  WHERE id = v_booking.id;

  PERFORM public._log_mediator_audit_v19a(
    v_uid,
    CASE WHEN v_is_reassignment THEN 'mediator_reassign_driver' ELSE 'mediator_dispatch_driver' END,
    'vehicle_bookings',
    v_booking.id::text,
    v_booking.booking_code,
    (CASE WHEN v_is_reassignment THEN 'Reassigned' ELSE 'Dispatched' END)
      || ' driver ' || v_driver.full_name || ' to vehicle booking ' || v_booking.booking_code,
    jsonb_build_object(
      'domain', 'vehicle_booking',
      'booking_code', v_booking.booking_code,
      'previous_driver_id', v_booking.assigned_driver_id,
      'driver_id', v_driver.id,
      'driver_name', v_driver.full_name,
      'vehicle_class', v_required_slug,
      'reason', v_reason
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'domain', 'vehicle_booking',
    'booking_id', v_booking.id,
    'code', v_booking.booking_code,
    'driver_id', v_driver.id,
    'driver_name', v_driver.full_name,
    'status', v_booking.status,
    'reassigned', v_is_reassignment
  );
END;
$$;

REVOKE ALL ON FUNCTION public.mediator_dispatch_driver(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mediator_dispatch_driver(uuid, uuid, text) TO authenticated;

-- 6C. mediator_resolve_escrow_payout(p_booking_id uuid, p_action text, p_reason text)
CREATE OR REPLACE FUNCTION public.mediator_resolve_escrow_payout(
  p_booking_id uuid,
  p_action text,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_action text := lower(trim(COALESCE(p_action, '')));
  v_reason text := NULLIF(trim(COALESCE(p_reason, '')), '');
  v_order public.delivery_orders%ROWTYPE;
  v_secret public.delivery_order_secrets%ROWTYPE;
  v_booking public.vehicle_bookings%ROWTYPE;
  v_votp public.vehicle_booking_otps%ROWTYPE;
  v_intent public.payment_intents%ROWTYPE;
  v_otp_completed boolean := false;
  v_commission_rate numeric(4,2) := 0.15;
  v_commission_inr numeric(10,2);
  v_driver_payout_inr numeric(10,2);
  v_purge_at timestamptz := now() + interval '48 hours';
  v_already_paid boolean := false;
BEGIN
  IF v_uid IS NULL OR NOT public.is_pnd_mediator(v_uid) THEN
    RAISE EXCEPTION 'Forbidden: Only authorized Dispatch Mediators, Hub Managers, or Admins may resolve escrow payouts.'
      USING ERRCODE = '42501';
  END IF;

  IF v_action NOT IN ('release_to_driver', 'freeze_dispute', 'refund_customer') THEN
    RAISE EXCEPTION 'Invalid escrow action "%". Expected release_to_driver, freeze_dispute, or refund_customer.', p_action
      USING ERRCODE = '22023';
  END IF;

  IF v_action IN ('freeze_dispute', 'refund_customer') AND (v_reason IS NULL OR length(v_reason) < 3) THEN
    RAISE EXCEPTION 'A clear resolution reason (at least 3 characters) is mandatory for "%".', v_action
      USING ERRCODE = '22023';
  END IF;

  -- Check Pick N Drop delivery_orders first
  SELECT * INTO v_order FROM public.delivery_orders WHERE id = p_booking_id FOR UPDATE;
  IF FOUND THEN
    SELECT * INTO v_secret FROM public.delivery_order_secrets WHERE order_id = v_order.id;
    SELECT * INTO v_intent
    FROM public.payment_intents
    WHERE purpose = 'pick_n_drop' AND reference_id = v_order.id
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF v_action = 'release_to_driver' THEN
      -- Check handover OTP completion (NEVER exposes OTP codes)
      IF v_order.trip_type = 'two_way' THEN
        v_otp_completed := (
          (v_secret.dropoff_verified_at IS NOT NULL AND v_secret.return_verified_at IS NOT NULL)
          OR v_order.status = 'delivered_pending_confirm'
        );
      ELSE
        v_otp_completed := (
          v_secret.dropoff_verified_at IS NOT NULL
          OR v_order.status = 'delivered_pending_confirm'
        );
      END IF;

      IF NOT v_otp_completed THEN
        IF v_order.status = 'disputed' AND v_reason IS NOT NULL AND length(v_reason) >= 5 THEN
          -- Explicit reasoned dispute override permitted strictly on disputed bookings
          NULL;
        ELSE
          RAISE EXCEPTION 'Escrow payout cannot be released until dropoff/return OTP handover is verified (or an open dispute is resolved with a detailed override reason).'
            USING ERRCODE = 'P0001';
        END IF;
      END IF;

      SELECT EXISTS (
        SELECT 1
        FROM public.delivery_transactions
        WHERE order_id = v_order.id
          AND tx_type = 'driver_payout'
      ) INTO v_already_paid;

      v_commission_inr := round(v_order.quoted_fare_inr * v_commission_rate, 2);
      v_driver_payout_inr := round(v_order.quoted_fare_inr - v_commission_inr, 2);

      UPDATE public.delivery_orders
      SET
        status = 'completed',
        mediator_id = COALESCE(mediator_id, v_uid),
        payout_released_at = now(),
        pod_purge_at = COALESCE(pod_purge_at, v_purge_at),
        updated_at = now()
      WHERE id = v_order.id;

      IF NOT v_already_paid THEN
        INSERT INTO public.delivery_transactions (order_id, tx_type, amount_inr, recorded_by, status, notes)
        VALUES
          (
            v_order.id,
            'driver_payout',
            v_driver_payout_inr,
            v_uid,
            'verified',
            COALESCE(v_reason, 'Escrow released to driver upon verified handover (85%)')
          ),
          (
            v_order.id,
            'platform_commission',
            v_commission_inr,
            v_uid,
            'verified',
            'Platform mediation commission upon escrow release (15%)'
          );
      END IF;

      INSERT INTO public.delivery_order_events (order_id, actor_id, event_type, payload)
      VALUES (
        v_order.id,
        v_uid,
        'escrow_payout_released',
        jsonb_build_object(
          'previous_status', v_order.status,
          'driver_payout_inr', v_driver_payout_inr,
          'platform_commission_inr', v_commission_inr,
          'otp_verified_handover', v_otp_completed,
          'dispute_override', (NOT v_otp_completed),
          'reason', v_reason,
          'pod_purge_at', COALESCE(v_order.pod_purge_at, v_purge_at)
        )
      );

      PERFORM public._log_mediator_audit_v19a(
        v_uid,
        'mediator_release_escrow_payout',
        'delivery_orders',
        v_order.id::text,
        v_order.order_code,
        'Released escrow payout (₹' || v_driver_payout_inr::text || ') for ' || v_order.order_code,
        jsonb_build_object(
          'action', 'release_to_driver',
          'domain', 'pick_n_drop',
          'order_code', v_order.order_code,
          'driver_payout_inr', v_driver_payout_inr,
          'platform_commission_inr', v_commission_inr,
          'otp_verified_handover', v_otp_completed,
          'reason', v_reason,
          'pod_purge_at', COALESCE(v_order.pod_purge_at, v_purge_at)
        )
      );

      RETURN jsonb_build_object(
        'ok', true,
        'domain', 'pick_n_drop',
        'booking_id', v_order.id,
        'code', v_order.order_code,
        'status', 'completed',
        'driver_payout_inr', v_driver_payout_inr,
        'platform_commission_inr', v_commission_inr,
        'pod_purge_at', COALESCE(v_order.pod_purge_at, v_purge_at)
      );

    ELSIF v_action = 'freeze_dispute' THEN
      UPDATE public.delivery_orders
      SET
        status = 'disputed',
        mediator_id = COALESCE(mediator_id, v_uid),
        dispute_reason = v_reason,
        updated_at = now()
      WHERE id = v_order.id;

      INSERT INTO public.delivery_order_events (order_id, actor_id, event_type, payload)
      VALUES (
        v_order.id,
        v_uid,
        'escrow_frozen_dispute',
        jsonb_build_object(
          'previous_status', v_order.status,
          'reason', v_reason
        )
      );

      PERFORM public._log_mediator_audit_v19a(
        v_uid,
        'mediator_freeze_escrow_dispute',
        'delivery_orders',
        v_order.id::text,
        v_order.order_code,
        'Froze escrow under dispute for ' || v_order.order_code || ': ' || v_reason,
        jsonb_build_object(
          'action', 'freeze_dispute',
          'domain', 'pick_n_drop',
          'order_code', v_order.order_code,
          'previous_status', v_order.status,
          'reason', v_reason
        )
      );

      RETURN jsonb_build_object(
        'ok', true,
        'domain', 'pick_n_drop',
        'booking_id', v_order.id,
        'code', v_order.order_code,
        'status', 'disputed'
      );

    ELSE
      -- refund_customer
      UPDATE public.delivery_orders
      SET
        status = 'cancelled',
        mediator_id = COALESCE(mediator_id, v_uid),
        dispute_reason = v_reason,
        updated_at = now()
      WHERE id = v_order.id;

      INSERT INTO public.delivery_transactions (order_id, tx_type, amount_inr, recorded_by, status, notes)
      VALUES (
        v_order.id,
        'refund',
        v_order.quoted_fare_inr,
        v_uid,
        'refunded',
        'Escrow refund approved by Dispatch Mediator: ' || v_reason
      );

      IF v_intent.id IS NOT NULL THEN
        UPDATE public.payment_intents
        SET
          status = 'refunded',
          refund_notes = v_reason,
          verified_by = COALESCE(verified_by, v_uid),
          updated_at = now()
        WHERE id = v_intent.id;
      END IF;

      INSERT INTO public.delivery_order_events (order_id, actor_id, event_type, payload)
      VALUES (
        v_order.id,
        v_uid,
        'escrow_refunded_customer',
        jsonb_build_object(
          'previous_status', v_order.status,
          'refund_amount_inr', v_order.quoted_fare_inr,
          'reason', v_reason
        )
      );

      PERFORM public._log_mediator_audit_v19a(
        v_uid,
        'mediator_refund_escrow_customer',
        'delivery_orders',
        v_order.id::text,
        v_order.order_code,
        'Approved customer escrow refund (₹' || v_order.quoted_fare_inr::text || ') for ' || v_order.order_code,
        jsonb_build_object(
          'action', 'refund_customer',
          'domain', 'pick_n_drop',
          'order_code', v_order.order_code,
          'refund_amount_inr', v_order.quoted_fare_inr,
          'reason', v_reason
        )
      );

      RETURN jsonb_build_object(
        'ok', true,
        'domain', 'pick_n_drop',
        'booking_id', v_order.id,
        'code', v_order.order_code,
        'status', 'cancelled',
        'refunded', true
      );
    END IF;
  END IF;

  -- Check Scheduled Vehicle bookings
  SELECT * INTO v_booking FROM public.vehicle_bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found.'
      USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_votp FROM public.vehicle_booking_otps WHERE booking_id = v_booking.id;
  SELECT * INTO v_intent
  FROM public.payment_intents
  WHERE (v_booking.payment_intent_id IS NOT NULL AND id = v_booking.payment_intent_id)
     OR (purpose = 'vehicle_booking' AND reference_id = v_booking.id)
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_action = 'release_to_driver' THEN
    v_otp_completed := (
      v_votp.dropoff_verified_at IS NOT NULL
      OR v_booking.status = 'completed'
    );

    IF NOT v_otp_completed THEN
      IF v_booking.status = 'disputed' AND v_reason IS NOT NULL AND length(v_reason) >= 5 THEN
        NULL;
      ELSE
        RAISE EXCEPTION 'Vehicle booking payout cannot be released until dropoff OTP is verified (or an open dispute is resolved with a detailed override reason).'
          USING ERRCODE = 'P0001';
      END IF;
    END IF;

    UPDATE public.vehicle_bookings
    SET
      status = 'completed',
      escrow_status = 'released',
      mediator_id = COALESCE(mediator_id, v_uid),
      payout_released_at = now(),
      pod_purge_at = COALESCE(pod_purge_at, v_purge_at),
      updated_at = now()
    WHERE id = v_booking.id;

    PERFORM public._log_mediator_audit_v19a(
      v_uid,
      'mediator_release_escrow_payout',
      'vehicle_bookings',
      v_booking.id::text,
      v_booking.booking_code,
      'Released escrow advance payout (₹' || v_booking.advance_amount_inr::text || ') for ' || v_booking.booking_code,
      jsonb_build_object(
        'action', 'release_to_driver',
        'domain', 'vehicle_booking',
        'booking_code', v_booking.booking_code,
        'advance_amount_inr', v_booking.advance_amount_inr,
        'otp_verified_handover', v_otp_completed,
        'reason', v_reason
      )
    );

    RETURN jsonb_build_object(
      'ok', true,
      'domain', 'vehicle_booking',
      'booking_id', v_booking.id,
      'code', v_booking.booking_code,
      'status', 'completed',
      'escrow_status', 'released'
    );

  ELSIF v_action = 'freeze_dispute' THEN
    UPDATE public.vehicle_bookings
    SET
      status = 'disputed',
      escrow_status = 'frozen_dispute',
      mediator_id = COALESCE(mediator_id, v_uid),
      dispute_reason = v_reason,
      updated_at = now()
    WHERE id = v_booking.id;

    PERFORM public._log_mediator_audit_v19a(
      v_uid,
      'mediator_freeze_escrow_dispute',
      'vehicle_bookings',
      v_booking.id::text,
      v_booking.booking_code,
      'Froze vehicle escrow under dispute for ' || v_booking.booking_code || ': ' || v_reason,
      jsonb_build_object(
        'action', 'freeze_dispute',
        'domain', 'vehicle_booking',
        'booking_code', v_booking.booking_code,
        'previous_status', v_booking.status,
        'reason', v_reason
      )
    );

    RETURN jsonb_build_object(
      'ok', true,
      'domain', 'vehicle_booking',
      'booking_id', v_booking.id,
      'code', v_booking.booking_code,
      'status', 'disputed'
    );

  ELSE
    -- refund_customer
    UPDATE public.vehicle_bookings
    SET
      status = 'cancelled',
      escrow_status = 'refunded',
      mediator_id = COALESCE(mediator_id, v_uid),
      dispute_reason = v_reason,
      updated_at = now()
    WHERE id = v_booking.id;

    IF v_intent.id IS NOT NULL THEN
      UPDATE public.payment_intents
      SET
        status = 'refunded',
        refund_notes = v_reason,
        verified_by = COALESCE(verified_by, v_uid),
        updated_at = now()
      WHERE id = v_intent.id;
    END IF;

    PERFORM public._log_mediator_audit_v19a(
      v_uid,
      'mediator_refund_escrow_customer',
      'vehicle_bookings',
      v_booking.id::text,
      v_booking.booking_code,
      'Approved customer refund (₹' || v_booking.advance_amount_inr::text || ') for ' || v_booking.booking_code,
      jsonb_build_object(
        'action', 'refund_customer',
        'domain', 'vehicle_booking',
        'booking_code', v_booking.booking_code,
        'refund_amount_inr', v_booking.advance_amount_inr,
        'reason', v_reason
      )
    );

    RETURN jsonb_build_object(
      'ok', true,
      'domain', 'vehicle_booking',
      'booking_id', v_booking.id,
      'code', v_booking.booking_code,
      'status', 'cancelled',
      'refunded', true
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.mediator_resolve_escrow_payout(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.mediator_resolve_escrow_payout(uuid, text, text) TO authenticated;

-- =============================================================================
-- 7. PRIVATE POD SIGNED-URL RLS & MEDIATOR AUDIT HISTORY POLICY
-- =============================================================================

-- Re-assert delivery-pods remains strictly private (public = false)
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

-- Allow authenticated mediators to read strictly their own `workspace = 'mediator'` audit rows
-- (preserves `audit_logs_admin_select` and `trg_audit_logs_immutable` unchanged)
DROP POLICY IF EXISTS audit_logs_mediator_own_select ON public.audit_logs;
CREATE POLICY audit_logs_mediator_own_select
  ON public.audit_logs
  FOR SELECT
  TO authenticated
  USING (
    public.is_pnd_mediator(auth.uid())
    AND actor_id = auth.uid()
    AND workspace = 'mediator'
  );
