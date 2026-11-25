-- =============================================================================
-- PASS v19b: ZERO-TRUST DRIVER RPCs, PRIVATE POD DRIVER RLS & PAYOUT SUMMARY
-- =============================================================================
-- Scope:
--   1. Idempotent schema additions:
--      - public.delivery_orders.driver_substatus (intermediate non-OTP milestones)
--      - public.vehicle_listings.contact_phone (stand / driver contact number)
--   2. Canonical Driver Audit Logger (_log_driver_audit_v19b) matching exact
--      live public.audit_logs columns:
--      (actor_id, actor_name, actor_role, workspace, action, target_table,
--       target_id, target_name, details, metadata).
--   3. Four Zero-Trust SECURITY DEFINER Driver RPCs:
--      - public.driver_accept_job(p_booking_id uuid)
--      - public.driver_verify_handover_otp(p_booking_id uuid, p_stage text, p_otp_input text, p_pod_storage_path text DEFAULT NULL)
--      - public.driver_update_trip_status(p_booking_id uuid, p_status text, p_reason text DEFAULT NULL)
--      - public.get_driver_payout_summary()
--   4. Companion Zero-Secret Helper RPCs:
--      - public.get_driver_available_jobs()
--      - public.get_driver_trip_otp_milestones(p_order_ids uuid[], p_booking_ids uuid[])
--   5. Private delivery-pods Bucket Driver RLS (public = false):
--      - Scopes driver INSERT / UPDATE / SELECT strictly to orders/<booking_id>/...
--        where <booking_id> is a delivery_orders or vehicle_bookings trip actively
--        assigned to auth.uid()'s active driver profile.
--   6. Assigned Driver visibility on public.vehicle_bookings.
-- =============================================================================

-- =============================================================================
-- 1. IDEMPOTENT SCHEMA ADDITIONS
-- =============================================================================

ALTER TABLE public.delivery_orders
  ADD COLUMN IF NOT EXISTS driver_substatus text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'delivery_orders_driver_substatus_check'
      AND conrelid = 'public.delivery_orders'::regclass
  ) THEN
    ALTER TABLE public.delivery_orders
      ADD CONSTRAINT delivery_orders_driver_substatus_check
      CHECK (
        driver_substatus IS NULL
        OR driver_substatus IN (
          'arrived_pickup',
          'en_route_dropoff',
          'en_route_return'
        )
      );
  END IF;
END;
$$;

ALTER TABLE public.vehicle_listings
  ADD COLUMN IF NOT EXISTS contact_phone text;

-- Ensure assigned drivers can view their assigned scheduled vehicle bookings
DROP POLICY IF EXISTS "Customers vehicle managers and admins view bookings" ON public.vehicle_bookings;
CREATE POLICY "Customers vehicle managers and admins view bookings"
  ON public.vehicle_bookings
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = customer_id
    OR public.is_vehicle_listing_manager(vehicle_listing_id, auth.uid())
    OR public.is_pnd_mediator(auth.uid())
    OR EXISTS (
      SELECT 1
      FROM public.drivers d
      WHERE d.id = vehicle_bookings.assigned_driver_id
        AND d.profile_id = auth.uid()
        AND COALESCE(d.is_active, false) = true
    )
  );

-- =============================================================================
-- 2. INTERNAL HELPER: CANONICAL DRIVER AUDIT LOGGER
-- =============================================================================

CREATE OR REPLACE FUNCTION public._log_driver_audit_v19b(
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
  v_driver_name text;
BEGIN
  SELECT NULLIF(trim(d.full_name), '')
    INTO v_driver_name
  FROM public.drivers d
  WHERE d.profile_id = p_actor_id
  LIMIT 1;

  SELECT COALESCE(
    v_driver_name,
    NULLIF(trim(p.full_name), ''),
    NULLIF(trim(p.email), ''),
    'Local Driver'
  )
    INTO v_actor_name
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
    COALESCE(v_actor_name, 'Local Driver'),
    'driver',
    'driver',
    p_action,
    p_target_table,
    p_target_id,
    p_target_name,
    p_details,
    COALESCE(p_metadata, '{}'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public._log_driver_audit_v19b(uuid, text, text, text, text, text, jsonb) FROM PUBLIC;

-- Internal helper: canonicalize 5-tier fleet class slug
CREATE OR REPLACE FUNCTION public._canonical_fleet_slug_v19b(p_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(trim(COALESCE(p_raw, '')))
    WHEN 'auto' THEN 'e_rickshaw'
    WHEN 'auto_rickshaw' THEN 'e_rickshaw'
    WHEN 'car' THEN 'mini_van'
    WHEN 'sedan' THEN 'mini_van'
    WHEN 'suv' THEN 'mini_van'
    WHEN 'bike' THEN 'two_wheeler'
    WHEN 'scooter' THEN 'two_wheeler'
    WHEN 'pickup' THEN 'pickup_truck'
    WHEN 'truck' THEN 'pickup_truck'
    ELSE lower(trim(COALESCE(p_raw, '')))
  END;
$$;

REVOKE ALL ON FUNCTION public._canonical_fleet_slug_v19b(text) FROM PUBLIC;

-- =============================================================================
-- 3. ZERO-TRUST DRIVER RPC 1: driver_accept_job(p_booking_id uuid)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.driver_accept_job(
  p_booking_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_driver public.drivers%ROWTYPE;
  v_order public.delivery_orders%ROWTYPE;
  v_booking public.vehicle_bookings%ROWTYPE;
  v_listing public.vehicle_listings%ROWTYPE;
  v_escrow_required boolean := true;
  v_required_slug text;
  v_driver_slug text;
  v_vehicle_id uuid;
  v_claimed_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in required to accept a job.'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO v_driver
  FROM public.drivers
  WHERE profile_id = v_uid
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'No active driver profile is registered for your account.'
      USING ERRCODE = '42501';
  END IF;

  IF COALESCE(v_driver.is_active, false) = false
     OR (
       COALESCE(v_driver.kyc_verified, false) = false
       AND COALESCE(v_driver.kyc_status, 'pending') <> 'verified'
     ) THEN
    RAISE EXCEPTION 'Your driver KYC must be verified and active before accepting jobs.'
      USING ERRCODE = '42501';
  END IF;

  v_driver_slug := public._canonical_fleet_slug_v19b(v_driver.vehicle_type);

  -- ---- CASE A: PICK N DROP DELIVERY ORDER ----
  IF EXISTS (SELECT 1 FROM public.delivery_orders WHERE id = p_booking_id) THEN
    -- Atomic race-safe row lock (SKIP LOCKED prevents double-claim stalls)
    SELECT *
      INTO v_order
    FROM public.delivery_orders
    WHERE id = p_booking_id
    FOR UPDATE SKIP LOCKED;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'This job is currently being claimed by another driver. Please refresh the board.'
        USING ERRCODE = '40001';
    END IF;

    IF v_order.driver_id IS NOT NULL THEN
      IF v_order.driver_id = v_driver.id THEN
        RETURN jsonb_build_object(
          'ok', true,
          'already_assigned_to_you', true,
          'domain', 'pick_n_drop',
          'booking_id', v_order.id,
          'code', v_order.order_code,
          'status', v_order.status
        );
      END IF;
      RAISE EXCEPTION 'This job has already been accepted by another driver.'
        USING ERRCODE = 'P0001';
    END IF;

    SELECT COALESCE(p.escrow_required, true)
      INTO v_escrow_required
    FROM public.payment_feature_policies p
    WHERE p.scope_key = 'pnd';

    IF v_escrow_required AND v_order.status <> 'escrow_held' THEN
      RAISE EXCEPTION 'This Pick N Drop job is not escrow-funded yet (current status: "%").', v_order.status
        USING ERRCODE = 'P0001';
    ELSIF NOT v_escrow_required AND v_order.status NOT IN ('escrow_held', 'awaiting_payment', 'payment_submitted') THEN
      RAISE EXCEPTION 'This job is no longer available for acceptance (current status: "%").', v_order.status
        USING ERRCODE = 'P0001';
    END IF;

    SELECT public._canonical_fleet_slug_v19b(vt.slug)
      INTO v_required_slug
    FROM public.vehicle_types vt
    WHERE vt.id = v_order.vehicle_type_id;

    SELECT v.id
      INTO v_vehicle_id
    FROM public.vehicles v
    WHERE v.driver_id = v_driver.id
      AND v.vehicle_type_id = v_order.vehicle_type_id
    ORDER BY COALESCE(v.is_available, true) DESC, v.updated_at DESC
    LIMIT 1;

    IF v_required_slug IS NOT NULL
       AND v_driver_slug <> v_required_slug
       AND v_vehicle_id IS NULL THEN
      RAISE EXCEPTION 'Fleet class mismatch: this job requires "%" while your verified fleet class is "%".',
        v_required_slug, COALESCE(v_driver_slug, 'unassigned')
        USING ERRCODE = '22023';
    END IF;

    UPDATE public.delivery_orders
    SET
      driver_id = v_driver.id,
      vehicle_id = COALESCE(v_vehicle_id, vehicle_id),
      status = 'driver_assigned',
      driver_substatus = NULL,
      updated_at = now()
    WHERE id = v_order.id
      AND driver_id IS NULL
    RETURNING id INTO v_claimed_id;

    IF v_claimed_id IS NULL THEN
      RAISE EXCEPTION 'This job was just accepted by another driver.'
        USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.delivery_order_events (order_id, actor_id, event_type, payload)
    VALUES (
      v_order.id,
      v_uid,
      'driver_accepted_job',
      jsonb_build_object(
        'driver_id', v_driver.id,
        'driver_name', v_driver.full_name,
        'vehicle_id', v_vehicle_id,
        'fleet_class', v_driver_slug
      )
    );

    PERFORM public._log_driver_audit_v19b(
      v_uid,
      'driver_accept_job',
      'delivery_orders',
      v_order.id::text,
      v_order.order_code,
      'Accepted Pick N Drop job ' || v_order.order_code,
      jsonb_build_object(
        'domain', 'pick_n_drop',
        'order_code', v_order.order_code,
        'driver_id', v_driver.id,
        'vehicle_id', v_vehicle_id,
        'fleet_class', v_driver_slug,
        'quoted_fare_inr', v_order.quoted_fare_inr
      )
    );

    RETURN jsonb_build_object(
      'ok', true,
      'domain', 'pick_n_drop',
      'booking_id', v_order.id,
      'code', v_order.order_code,
      'status', 'driver_assigned',
      'driver_id', v_driver.id
    );
  END IF;

  -- ---- CASE B: SCHEDULED VEHICLE BOOKING ----
  IF EXISTS (SELECT 1 FROM public.vehicle_bookings WHERE id = p_booking_id) THEN
    SELECT *
      INTO v_booking
    FROM public.vehicle_bookings
    WHERE id = p_booking_id
    FOR UPDATE SKIP LOCKED;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'This booking is currently being claimed by another driver.'
        USING ERRCODE = '40001';
    END IF;

    IF v_booking.assigned_driver_id IS NOT NULL THEN
      IF v_booking.assigned_driver_id = v_driver.id THEN
        RETURN jsonb_build_object(
          'ok', true,
          'already_assigned_to_you', true,
          'domain', 'vehicle_booking',
          'booking_id', v_booking.id,
          'code', v_booking.booking_code,
          'status', v_booking.status
        );
      END IF;
      RAISE EXCEPTION 'This scheduled booking is already assigned to another driver.'
        USING ERRCODE = 'P0001';
    END IF;

    SELECT COALESCE(p.escrow_required, true)
      INTO v_escrow_required
    FROM public.payment_feature_policies p
    WHERE p.scope_key = 'vehicles';

    IF v_escrow_required AND v_booking.status <> 'confirmed' THEN
      RAISE EXCEPTION 'Vehicle booking % must be confirmed and escrow-funded before acceptance.', v_booking.booking_code
        USING ERRCODE = 'P0001';
    ELSIF NOT v_escrow_required AND v_booking.status NOT IN ('confirmed', 'pending_payment_confirm', 'soft_hold') THEN
      RAISE EXCEPTION 'Vehicle booking % cannot be accepted from status "%".', v_booking.booking_code, v_booking.status
        USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_listing FROM public.vehicle_listings WHERE id = v_booking.vehicle_listing_id;
    IF FOUND THEN
      SELECT public._canonical_fleet_slug_v19b(vt.slug)
        INTO v_required_slug
      FROM public.vehicle_types vt
      WHERE vt.id = v_listing.vehicle_type_id;

      IF v_listing.owner_id <> v_uid
         AND v_listing.driver_id IS DISTINCT FROM v_driver.id
         AND v_required_slug IS NOT NULL
         AND v_driver_slug <> v_required_slug THEN
        RAISE EXCEPTION 'Fleet class mismatch: this booking requires "%".', v_required_slug
          USING ERRCODE = '22023';
      END IF;
    END IF;

    UPDATE public.vehicle_bookings
    SET
      assigned_driver_id = v_driver.id,
      updated_at = now()
    WHERE id = v_booking.id
      AND assigned_driver_id IS NULL
    RETURNING id INTO v_claimed_id;

    IF v_claimed_id IS NULL THEN
      RAISE EXCEPTION 'This booking was just claimed by another driver.'
        USING ERRCODE = 'P0001';
    END IF;

    PERFORM public._log_driver_audit_v19b(
      v_uid,
      'driver_accept_job',
      'vehicle_bookings',
      v_booking.id::text,
      v_booking.booking_code,
      'Accepted scheduled vehicle booking ' || v_booking.booking_code,
      jsonb_build_object(
        'domain', 'vehicle_booking',
        'booking_code', v_booking.booking_code,
        'driver_id', v_driver.id,
        'total_fare_inr', v_booking.total_fare_inr
      )
    );

    RETURN jsonb_build_object(
      'ok', true,
      'domain', 'vehicle_booking',
      'booking_id', v_booking.id,
      'code', v_booking.booking_code,
      'status', v_booking.status,
      'driver_id', v_driver.id
    );
  END IF;

  RAISE EXCEPTION 'Job or booking not found.'
    USING ERRCODE = 'P0002';
END;
$$;

REVOKE ALL ON FUNCTION public.driver_accept_job(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.driver_accept_job(uuid) TO authenticated;

-- =============================================================================
-- 4. ZERO-TRUST DRIVER RPC 2: driver_verify_handover_otp(...)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.driver_verify_handover_otp(
  p_booking_id uuid,
  p_stage text,
  p_otp_input text,
  p_pod_storage_path text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_stage text := lower(trim(COALESCE(p_stage, '')));
  v_otp text := trim(COALESCE(p_otp_input, ''));
  v_pod_path text := NULLIF(trim(COALESCE(p_pod_storage_path, '')), '');
  v_driver public.drivers%ROWTYPE;
  v_order public.delivery_orders%ROWTYPE;
  v_secret public.delivery_order_secrets%ROWTYPE;
  v_booking public.vehicle_bookings%ROWTYPE;
  v_votp public.vehicle_booking_otps%ROWTYPE;
  v_expected_otp text;
  v_pod_required boolean := true;
  v_next_status text;
  v_new_attempts integer;
  v_expected_prefix text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in required to verify handover OTP.'
      USING ERRCODE = '42501';
  END IF;

  IF v_stage NOT IN ('pickup', 'dropoff', 'return') THEN
    RAISE EXCEPTION 'Invalid handover stage "%". Expected pickup, dropoff, or return.', p_stage
      USING ERRCODE = '22023';
  END IF;

  IF v_otp !~ '^[0-9]{4,6}$' THEN
    RAISE EXCEPTION 'Enter a valid 4 to 6 digit numeric OTP.'
      USING ERRCODE = '22023';
  END IF;

  -- Validate POD path format & confinement whenever supplied (prevent traversal or cross-trip spoofing)
  IF v_pod_path IS NOT NULL THEN
    v_expected_prefix := 'orders/' || p_booking_id::text || '/';
    IF position('..' IN v_pod_path) > 0
       OR left(v_pod_path, length(v_expected_prefix)) <> v_expected_prefix
       OR v_pod_path !~ '^orders/[0-9a-fA-F-]{36}/[A-Za-z0-9._-]+$' THEN
      RAISE EXCEPTION 'Invalid Proof-of-Delivery photo path for this booking.'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  SELECT *
    INTO v_driver
  FROM public.drivers
  WHERE profile_id = v_uid
    AND COALESCE(is_active, false) = true
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active driver account required to verify handover OTP.'
      USING ERRCODE = '42501';
  END IF;

  -- ---- CASE A: PICK N DROP DELIVERY ORDER ----
  SELECT * INTO v_order FROM public.delivery_orders WHERE id = p_booking_id FOR UPDATE;
  IF FOUND THEN
    IF v_order.driver_id IS DISTINCT FROM v_driver.id THEN
      RAISE EXCEPTION 'Forbidden: Only the driver assigned to % may verify its handover OTP.', v_order.order_code
        USING ERRCODE = '42501';
    END IF;

    IF v_order.status IN ('cancelled', 'completed', 'disputed') THEN
      RAISE EXCEPTION 'Order % is closed or disputed (status: "%") and cannot accept OTP verification.',
        v_order.order_code, v_order.status
        USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_secret FROM public.delivery_order_secrets WHERE order_id = v_order.id FOR UPDATE;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Handover OTP record is not initialized for order %.', v_order.order_code
        USING ERRCODE = 'P0002';
    END IF;

    IF v_secret.locked_until IS NOT NULL AND v_secret.locked_until > now() THEN
      RAISE EXCEPTION 'Too many incorrect OTP attempts. Handover verification is temporarily locked until %.',
        to_char(v_secret.locked_until AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM IST')
        USING ERRCODE = 'P0001';
    END IF;

    -- Stage order enforcement
    IF v_stage = 'pickup' THEN
      IF v_secret.pickup_verified_at IS NOT NULL THEN
        RAISE EXCEPTION 'Pickup OTP has already been verified for %.', v_order.order_code
          USING ERRCODE = 'P0001';
      END IF;
      v_expected_otp := v_secret.pickup_otp;
      v_next_status := 'picked_up';

    ELSIF v_stage = 'dropoff' THEN
      IF v_secret.pickup_verified_at IS NULL AND v_order.status NOT IN ('picked_up', 'in_transit', 'return_in_transit', 'delivered_pending_confirm') THEN
        RAISE EXCEPTION 'Pickup OTP must be verified before Dropoff OTP.'
          USING ERRCODE = 'P0001';
      END IF;
      IF v_secret.dropoff_verified_at IS NOT NULL THEN
        RAISE EXCEPTION 'Dropoff OTP has already been verified for %.', v_order.order_code
          USING ERRCODE = 'P0001';
      END IF;

      v_pod_required := COALESCE(v_order.pod_required, v_order.service_mode <> 'passenger');
      IF v_pod_required AND v_pod_path IS NULL THEN
        RAISE EXCEPTION 'Proof-of-Delivery photo is required to verify Dropoff handover.'
          USING ERRCODE = '22023';
      END IF;

      v_expected_otp := v_secret.dropoff_otp;
      v_next_status := CASE
        WHEN v_order.trip_type = 'two_way' THEN 'return_in_transit'
        ELSE 'delivered_pending_confirm'
      END;

    ELSE
      -- return stage
      IF v_order.trip_type <> 'two_way' OR v_secret.return_otp IS NULL THEN
        RAISE EXCEPTION 'Return OTP is only applicable for Two-Way / LPG Refill trips.'
          USING ERRCODE = 'P0001';
      END IF;
      IF v_secret.dropoff_verified_at IS NULL THEN
        RAISE EXCEPTION 'Dropoff OTP must be verified before Return OTP.'
          USING ERRCODE = 'P0001';
      END IF;
      IF v_secret.return_verified_at IS NOT NULL THEN
        RAISE EXCEPTION 'Return OTP has already been verified for %.', v_order.order_code
          USING ERRCODE = 'P0001';
      END IF;
      v_expected_otp := v_secret.return_otp;
      v_next_status := 'delivered_pending_confirm';
    END IF;

    -- Constant-style strict equality check (never returns raw OTP!)
    IF v_expected_otp IS NULL OR v_otp <> v_expected_otp THEN
      v_new_attempts := COALESCE(v_secret.failed_attempts, 0) + 1;
      UPDATE public.delivery_order_secrets
      SET
        failed_attempts = v_new_attempts,
        locked_until = CASE
          WHEN v_new_attempts >= 5 THEN now() + interval '15 minutes'
          ELSE locked_until
        END,
        updated_at = now()
      WHERE order_id = v_order.id;

      INSERT INTO public.delivery_order_events (order_id, actor_id, event_type, payload)
      VALUES (
        v_order.id,
        v_uid,
        'otp_verification_failed',
        jsonb_build_object(
          'stage', v_stage,
          'failed_attempts', v_new_attempts,
          'locked', (v_new_attempts >= 5)
        )
      );

      IF v_new_attempts >= 5 THEN
        RETURN jsonb_build_object(
          'ok', false,
          'verified', false,
          'locked', true,
          'attempts_remaining', 0,
          'message', 'Incorrect OTP. Maximum attempts reached — verification is locked for 15 minutes.'
        );
      END IF;

      RETURN jsonb_build_object(
        'ok', false,
        'verified', false,
        'locked', false,
        'attempts_remaining', GREATEST(0, 5 - v_new_attempts),
        'message', 'Incorrect ' || initcap(v_stage) || ' OTP. ' || GREATEST(0, 5 - v_new_attempts)::text || ' attempts remaining.'
      );
    END IF;

    -- OTP matched -> reset lockout, stamp stage verification, advance status
    UPDATE public.delivery_order_secrets
    SET
      failed_attempts = 0,
      locked_until = NULL,
      pickup_verified_at = CASE WHEN v_stage = 'pickup' THEN now() ELSE pickup_verified_at END,
      dropoff_verified_at = CASE WHEN v_stage = 'dropoff' THEN now() ELSE dropoff_verified_at END,
      return_verified_at = CASE WHEN v_stage = 'return' THEN now() ELSE return_verified_at END,
      updated_at = now()
    WHERE order_id = v_order.id;

    UPDATE public.delivery_orders
    SET
      status = v_next_status,
      driver_substatus = CASE
        WHEN v_stage = 'pickup' THEN 'en_route_dropoff'
        WHEN v_stage = 'dropoff' AND v_order.trip_type = 'two_way' THEN 'en_route_return'
        ELSE NULL
      END,
      pod_storage_path = COALESCE(v_pod_path, pod_storage_path),
      pod_uploaded_at = CASE WHEN v_pod_path IS NOT NULL THEN now() ELSE pod_uploaded_at END,
      pod_purge_at = CASE
        WHEN v_pod_path IS NOT NULL THEN now() + interval '48 hours'
        ELSE pod_purge_at
      END,
      updated_at = now()
    WHERE id = v_order.id;

    INSERT INTO public.delivery_order_events (order_id, actor_id, event_type, payload)
    VALUES (
      v_order.id,
      v_uid,
      v_stage || '_otp_verified',
      jsonb_build_object(
        'stage', v_stage,
        'next_status', v_next_status,
        'pod_attached', (v_pod_path IS NOT NULL)
      )
    );

    PERFORM public._log_driver_audit_v19b(
      v_uid,
      'driver_verify_' || v_stage || '_otp',
      'delivery_orders',
      v_order.id::text,
      v_order.order_code,
      'Verified ' || v_stage || ' OTP for ' || v_order.order_code,
      jsonb_build_object(
        'domain', 'pick_n_drop',
        'order_code', v_order.order_code,
        'stage', v_stage,
        'next_status', v_next_status,
        'pod_attached', (v_pod_path IS NOT NULL)
      )
    );

    RETURN jsonb_build_object(
      'ok', true,
      'verified', true,
      'domain', 'pick_n_drop',
      'booking_id', v_order.id,
      'code', v_order.order_code,
      'stage', v_stage,
      'status', v_next_status,
      'verified_at', now()
    );
  END IF;

  -- ---- CASE B: SCHEDULED VEHICLE BOOKING ----
  SELECT * INTO v_booking FROM public.vehicle_bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found.'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_booking.assigned_driver_id IS DISTINCT FROM v_driver.id
     AND NOT EXISTS (
       SELECT 1
       FROM public.vehicle_listings vl
       WHERE vl.id = v_booking.vehicle_listing_id
         AND (vl.owner_id = v_uid OR vl.driver_id = v_driver.id)
     ) THEN
    RAISE EXCEPTION 'Forbidden: Only the assigned driver or vehicle operator may verify booking OTP.'
      USING ERRCODE = '42501';
  END IF;

  IF v_booking.status IN ('cancelled', 'expired', 'completed', 'disputed') THEN
    RAISE EXCEPTION 'Vehicle booking % is closed or disputed (status: "%").',
      v_booking.booking_code, v_booking.status
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_votp FROM public.vehicle_booking_otps WHERE booking_id = v_booking.id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Handover OTP record is not initialized for booking %.', v_booking.booking_code
      USING ERRCODE = 'P0002';
  END IF;

  IF v_votp.locked_until IS NOT NULL AND v_votp.locked_until > now() THEN
    RAISE EXCEPTION 'Too many incorrect OTP attempts. Handover verification is temporarily locked until %.',
      to_char(v_votp.locked_until AT TIME ZONE 'Asia/Kolkata', 'HH12:MI AM IST')
      USING ERRCODE = 'P0001';
  END IF;

  IF v_stage = 'pickup' THEN
    IF v_votp.pickup_verified_at IS NOT NULL THEN
      RAISE EXCEPTION 'Trip start (Pickup) OTP has already been verified for %.', v_booking.booking_code
        USING ERRCODE = 'P0001';
    END IF;
    v_expected_otp := v_votp.pickup_otp;
    v_next_status := 'in_progress';
  ELSIF v_stage = 'dropoff' THEN
    IF v_votp.pickup_verified_at IS NULL AND v_booking.status <> 'in_progress' THEN
      RAISE EXCEPTION 'Trip start (Pickup) OTP must be verified before Dropoff OTP.'
        USING ERRCODE = 'P0001';
    END IF;
    IF v_votp.dropoff_verified_at IS NOT NULL THEN
      RAISE EXCEPTION 'Dropoff OTP has already been verified for %.', v_booking.booking_code
        USING ERRCODE = 'P0001';
    END IF;
    v_expected_otp := v_votp.dropoff_otp;
    v_next_status := 'completed';
  ELSE
    IF v_votp.return_otp IS NULL THEN
      RAISE EXCEPTION 'Return OTP is not configured for booking %.', v_booking.booking_code
        USING ERRCODE = 'P0001';
    END IF;
    IF v_votp.dropoff_verified_at IS NULL THEN
      RAISE EXCEPTION 'Dropoff OTP must be verified before Return OTP.'
        USING ERRCODE = 'P0001';
    END IF;
    v_expected_otp := v_votp.return_otp;
    v_next_status := 'completed';
  END IF;

  IF v_expected_otp IS NULL OR v_otp <> v_expected_otp THEN
    v_new_attempts := COALESCE(v_votp.failed_attempts, 0) + 1;
    UPDATE public.vehicle_booking_otps
    SET
      failed_attempts = v_new_attempts,
      locked_until = CASE
        WHEN v_new_attempts >= 5 THEN now() + interval '15 minutes'
        ELSE locked_until
      END,
      updated_at = now()
    WHERE booking_id = v_booking.id;

    IF v_new_attempts >= 5 THEN
      RETURN jsonb_build_object(
        'ok', false,
        'verified', false,
        'locked', true,
        'attempts_remaining', 0,
        'message', 'Incorrect OTP. Maximum attempts reached — verification is locked for 15 minutes.'
      );
    END IF;

    RETURN jsonb_build_object(
      'ok', false,
      'verified', false,
      'locked', false,
      'attempts_remaining', GREATEST(0, 5 - v_new_attempts),
      'message', 'Incorrect ' || initcap(v_stage) || ' OTP. ' || GREATEST(0, 5 - v_new_attempts)::text || ' attempts remaining.'
    );
  END IF;

  UPDATE public.vehicle_booking_otps
  SET
    failed_attempts = 0,
    locked_until = NULL,
    pickup_verified_at = CASE WHEN v_stage = 'pickup' THEN now() ELSE pickup_verified_at END,
    dropoff_verified_at = CASE WHEN v_stage = 'dropoff' THEN now() ELSE dropoff_verified_at END,
    return_verified_at = CASE WHEN v_stage = 'return' THEN now() ELSE return_verified_at END,
    updated_at = now()
  WHERE booking_id = v_booking.id;

  UPDATE public.vehicle_bookings
  SET
    assigned_driver_id = COALESCE(assigned_driver_id, v_driver.id),
    status = v_next_status,
    pod_storage_path = COALESCE(v_pod_path, pod_storage_path),
    pod_uploaded_at = CASE WHEN v_pod_path IS NOT NULL THEN now() ELSE pod_uploaded_at END,
    pod_purge_at = CASE
      WHEN v_pod_path IS NOT NULL THEN now() + interval '48 hours'
      ELSE pod_purge_at
    END,
    updated_at = now()
  WHERE id = v_booking.id;

  PERFORM public._log_driver_audit_v19b(
    v_uid,
    'driver_verify_' || v_stage || '_otp',
    'vehicle_bookings',
    v_booking.id::text,
    v_booking.booking_code,
    'Verified ' || v_stage || ' OTP for vehicle booking ' || v_booking.booking_code,
    jsonb_build_object(
      'domain', 'vehicle_booking',
      'booking_code', v_booking.booking_code,
      'stage', v_stage,
      'next_status', v_next_status,
      'pod_attached', (v_pod_path IS NOT NULL)
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'verified', true,
    'domain', 'vehicle_booking',
    'booking_id', v_booking.id,
    'code', v_booking.booking_code,
    'stage', v_stage,
    'status', v_next_status,
    'verified_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.driver_verify_handover_otp(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.driver_verify_handover_otp(uuid, text, text, text) TO authenticated;

-- =============================================================================
-- 5. ZERO-TRUST DRIVER RPC 3: driver_update_trip_status(...)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.driver_update_trip_status(
  p_booking_id uuid,
  p_status text,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_status text := lower(trim(COALESCE(p_status, '')));
  v_reason text := NULLIF(trim(COALESCE(p_reason, '')), '');
  v_driver public.drivers%ROWTYPE;
  v_order public.delivery_orders%ROWTYPE;
  v_booking public.vehicle_bookings%ROWTYPE;
  v_next_order_status text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in required to update trip status.'
      USING ERRCODE = '42501';
  END IF;

  IF v_status NOT IN ('arrived_pickup', 'en_route_dropoff', 'driver_cancelled') THEN
    RAISE EXCEPTION 'Invalid trip status "%". Expected arrived_pickup, en_route_dropoff, or driver_cancelled.', p_status
      USING ERRCODE = '22023';
  END IF;

  IF v_status = 'driver_cancelled' AND (v_reason IS NULL OR length(v_reason) < 5) THEN
    RAISE EXCEPTION 'A clear cancellation reason (at least 5 characters) is mandatory when releasing an assigned trip.'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_driver
  FROM public.drivers
  WHERE profile_id = v_uid
    AND COALESCE(is_active, false) = true
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active driver profile required.'
      USING ERRCODE = '42501';
  END IF;

  -- ---- CASE A: PICK N DROP DELIVERY ORDER ----
  SELECT * INTO v_order FROM public.delivery_orders WHERE id = p_booking_id FOR UPDATE;
  IF FOUND THEN
    IF v_order.driver_id IS DISTINCT FROM v_driver.id THEN
      RAISE EXCEPTION 'Forbidden: Only the assigned driver may update %.', v_order.order_code
        USING ERRCODE = '42501';
    END IF;

    IF v_status = 'arrived_pickup' THEN
      IF v_order.status <> 'driver_assigned' THEN
        RAISE EXCEPTION 'Arrived at Pickup can only be marked while awaiting Pickup OTP.'
          USING ERRCODE = 'P0001';
      END IF;

      UPDATE public.delivery_orders
      SET
        driver_substatus = 'arrived_pickup',
        updated_at = now()
      WHERE id = v_order.id;

      INSERT INTO public.delivery_order_events (order_id, actor_id, event_type, payload)
      VALUES (
        v_order.id,
        v_uid,
        'driver_arrived_pickup',
        jsonb_build_object('driver_id', v_driver.id)
      );

      PERFORM public._log_driver_audit_v19b(
        v_uid,
        'driver_arrived_pickup',
        'delivery_orders',
        v_order.id::text,
        v_order.order_code,
        'Marked arrived at pickup for ' || v_order.order_code,
        jsonb_build_object('order_code', v_order.order_code, 'driver_substatus', 'arrived_pickup')
      );

      RETURN jsonb_build_object(
        'ok', true,
        'domain', 'pick_n_drop',
        'booking_id', v_order.id,
        'status', v_order.status,
        'driver_substatus', 'arrived_pickup'
      );

    ELSIF v_status = 'en_route_dropoff' THEN
      IF v_order.status NOT IN ('picked_up', 'in_transit') THEN
        RAISE EXCEPTION 'Pickup OTP must be verified before marking En Route to Dropoff.'
          USING ERRCODE = 'P0001';
      END IF;

      UPDATE public.delivery_orders
      SET
        status = 'in_transit',
        driver_substatus = 'en_route_dropoff',
        updated_at = now()
      WHERE id = v_order.id;

      INSERT INTO public.delivery_order_events (order_id, actor_id, event_type, payload)
      VALUES (
        v_order.id,
        v_uid,
        'driver_en_route_dropoff',
        jsonb_build_object('driver_id', v_driver.id)
      );

      PERFORM public._log_driver_audit_v19b(
        v_uid,
        'driver_en_route_dropoff',
        'delivery_orders',
        v_order.id::text,
        v_order.order_code,
        'Marked en route to dropoff for ' || v_order.order_code,
        jsonb_build_object('order_code', v_order.order_code, 'status', 'in_transit')
      );

      RETURN jsonb_build_object(
        'ok', true,
        'domain', 'pick_n_drop',
        'booking_id', v_order.id,
        'status', 'in_transit',
        'driver_substatus', 'en_route_dropoff'
      );

    ELSE
      -- driver_cancelled: Only allowed BEFORE pickup OTP is verified; returns job cleanly to funded dispatch pool
      IF v_order.status <> 'driver_assigned' THEN
        RAISE EXCEPTION 'A trip cannot be released back to the dispatch pool after Pickup OTP verification. Contact the Dispatch Mediator for assistance.'
          USING ERRCODE = 'P0001';
      END IF;

      v_next_order_status := CASE
        WHEN v_order.payment_verified_at IS NOT NULL THEN 'escrow_held'
        ELSE 'escrow_held'
      END;

      UPDATE public.delivery_orders
      SET
        driver_id = NULL,
        vehicle_id = NULL,
        status = v_next_order_status,
        driver_substatus = NULL,
        updated_at = now()
      WHERE id = v_order.id;

      INSERT INTO public.delivery_order_events (order_id, actor_id, event_type, payload)
      VALUES (
        v_order.id,
        v_uid,
        'driver_cancelled_returned_to_pool',
        jsonb_build_object(
          'driver_id', v_driver.id,
          'reason', v_reason,
          'returned_status', v_next_order_status
        )
      );

      PERFORM public._log_driver_audit_v19b(
        v_uid,
        'driver_cancelled_assignment',
        'delivery_orders',
        v_order.id::text,
        v_order.order_code,
        'Released ' || v_order.order_code || ' back to dispatch pool: ' || v_reason,
        jsonb_build_object(
          'domain', 'pick_n_drop',
          'order_code', v_order.order_code,
          'reason', v_reason,
          'returned_status', v_next_order_status
        )
      );

      RETURN jsonb_build_object(
        'ok', true,
        'domain', 'pick_n_drop',
        'booking_id', v_order.id,
        'status', v_next_order_status,
        'returned_to_pool', true
      );
    END IF;
  END IF;

  -- ---- CASE B: SCHEDULED VEHICLE BOOKING ----
  SELECT * INTO v_booking FROM public.vehicle_bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found.'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_booking.assigned_driver_id IS DISTINCT FROM v_driver.id THEN
    RAISE EXCEPTION 'Forbidden: Only the assigned driver may update booking %.', v_booking.booking_code
      USING ERRCODE = '42501';
  END IF;

  IF v_status = 'driver_cancelled' THEN
    IF v_booking.status <> 'confirmed' THEN
      RAISE EXCEPTION 'Scheduled bookings can only be released before trip start.'
        USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.vehicle_bookings
    SET
      assigned_driver_id = NULL,
      updated_at = now()
    WHERE id = v_booking.id;

    PERFORM public._log_driver_audit_v19b(
      v_uid,
      'driver_cancelled_assignment',
      'vehicle_bookings',
      v_booking.id::text,
      v_booking.booking_code,
      'Released vehicle booking ' || v_booking.booking_code || ' back to dispatch pool: ' || v_reason,
      jsonb_build_object(
        'domain', 'vehicle_booking',
        'booking_code', v_booking.booking_code,
        'reason', v_reason
      )
    );

    RETURN jsonb_build_object(
      'ok', true,
      'domain', 'vehicle_booking',
      'booking_id', v_booking.id,
      'status', v_booking.status,
      'returned_to_pool', true
    );
  END IF;

  -- Non-cancelling milestone note on scheduled vehicle booking
  PERFORM public._log_driver_audit_v19b(
    v_uid,
    'driver_' || v_status,
    'vehicle_bookings',
    v_booking.id::text,
    v_booking.booking_code,
    'Updated booking ' || v_booking.booking_code || ' milestone to ' || v_status,
    jsonb_build_object(
      'domain', 'vehicle_booking',
      'booking_code', v_booking.booking_code,
      'milestone', v_status
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'domain', 'vehicle_booking',
    'booking_id', v_booking.id,
    'status', v_booking.status,
    'milestone', v_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.driver_update_trip_status(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.driver_update_trip_status(uuid, text, text) TO authenticated;

-- =============================================================================
-- 6. ZERO-TRUST DRIVER RPC 4: get_driver_payout_summary()
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_driver_payout_summary()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_driver public.drivers%ROWTYPE;
  v_today_start timestamptz := date_trunc('day', now() AT TIME ZONE 'Asia/Kolkata') AT TIME ZONE 'Asia/Kolkata';
  v_released_today numeric(12,2) := 0;
  v_released_total numeric(12,2) := 0;
  v_escrow_held numeric(12,2) := 0;
  v_completed_count integer := 0;
  v_disputed_count integer := 0;
  v_trips jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in required.'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO v_driver
  FROM public.drivers
  WHERE profile_id = v_uid
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'driver_found', false,
      'released_today_inr', 0,
      'released_total_inr', 0,
      'escrow_held_inr', 0,
      'completed_trips_count', 0,
      'disputed_count', 0,
      'trips', '[]'::jsonb
    );
  END IF;

  WITH pnd_rows AS (
    SELECT
      o.id,
      'pick_n_drop'::text AS domain,
      o.order_code AS code,
      o.service_mode,
      o.trip_type,
      o.pickup_address AS origin_label,
      o.dropoff_address AS destination_label,
      o.distance_km,
      o.quoted_fare_inr AS gross_fare_inr,
      COALESCE(
        (
          SELECT dt.amount_inr
          FROM public.delivery_transactions dt
          WHERE dt.order_id = o.id
            AND dt.tx_type = 'driver_payout'
          ORDER BY dt.created_at DESC
          LIMIT 1
        ),
        round(o.quoted_fare_inr * 0.85, 2)
      ) AS net_payout_inr,
      o.status AS trip_status,
      CASE
        WHEN o.status = 'completed' OR o.payout_released_at IS NOT NULL THEN 'released'
        WHEN o.status = 'disputed' THEN 'disputed'
        WHEN o.status = 'cancelled' THEN 'refunded'
        ELSE 'escrow_held'
      END AS escrow_state,
      o.payout_released_at,
      o.dispute_reason,
      o.created_at,
      o.updated_at
    FROM public.delivery_orders o
    WHERE o.driver_id = v_driver.id
  ),
  veh_rows AS (
    SELECT
      vb.id,
      'vehicle_booking'::text AS domain,
      vb.booking_code AS code,
      vb.booking_mode AS service_mode,
      'one_way'::text AS trip_type,
      vb.pickup_location AS origin_label,
      COALESCE(vb.dropoff_location, vl.stand_locality, 'Scheduled Trip') AS destination_label,
      NULL::numeric AS distance_km,
      vb.total_fare_inr AS gross_fare_inr,
      vb.advance_amount_inr AS net_payout_inr,
      vb.status AS trip_status,
      CASE
        WHEN vb.escrow_status = 'released' OR vb.payout_released_at IS NOT NULL THEN 'released'
        WHEN vb.status = 'disputed' OR vb.escrow_status = 'frozen_dispute' THEN 'disputed'
        WHEN vb.status IN ('cancelled', 'expired') OR vb.escrow_status = 'refunded' THEN 'refunded'
        ELSE 'escrow_held'
      END AS escrow_state,
      vb.payout_released_at,
      vb.dispute_reason,
      vb.created_at,
      vb.updated_at
    FROM public.vehicle_bookings vb
    LEFT JOIN public.vehicle_listings vl ON vl.id = vb.vehicle_listing_id
    WHERE (
      vb.assigned_driver_id = v_driver.id
      OR vl.driver_id = v_driver.id
      OR vl.owner_id = v_uid
    )
      AND vb.status IN ('confirmed', 'in_progress', 'completed', 'disputed', 'cancelled')
  ),
  combined AS (
    SELECT * FROM pnd_rows
    UNION ALL
    SELECT * FROM veh_rows
  )
  SELECT
    COALESCE(SUM(CASE WHEN escrow_state = 'released' AND COALESCE(payout_released_at, updated_at) >= v_today_start THEN net_payout_inr ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN escrow_state = 'released' THEN net_payout_inr ELSE 0 END), 0),
    COALESCE(SUM(CASE WHEN escrow_state = 'escrow_held' THEN net_payout_inr ELSE 0 END), 0),
    COUNT(*) FILTER (WHERE trip_status = 'completed' OR escrow_state = 'released'),
    COUNT(*) FILTER (WHERE escrow_state = 'disputed'),
    COALESCE(
      (
        SELECT jsonb_agg(
          jsonb_build_object(
            'id', c.id,
            'domain', c.domain,
            'code', c.code,
            'service_mode', c.service_mode,
            'trip_type', c.trip_type,
            'origin_label', c.origin_label,
            'destination_label', c.destination_label,
            'distance_km', c.distance_km,
            'gross_fare_inr', c.gross_fare_inr,
            'net_payout_inr', c.net_payout_inr,
            'trip_status', c.trip_status,
            'escrow_state', c.escrow_state,
            'payout_released_at', c.payout_released_at,
            'dispute_reason', c.dispute_reason,
            'created_at', c.created_at,
            'updated_at', c.updated_at
          )
          ORDER BY c.updated_at DESC
        )
        FROM (SELECT * FROM combined ORDER BY updated_at DESC LIMIT 60) c
      ),
      '[]'::jsonb
    )
  INTO
    v_released_today,
    v_released_total,
    v_escrow_held,
    v_completed_count,
    v_disputed_count,
    v_trips
  FROM combined;

  RETURN jsonb_build_object(
    'driver_found', true,
    'driver_id', v_driver.id,
    'released_today_inr', v_released_today,
    'released_total_inr', v_released_total,
    'escrow_held_inr', v_escrow_held,
    'completed_trips_count', v_completed_count,
    'disputed_count', v_disputed_count,
    'trips', v_trips
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_driver_payout_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_driver_payout_summary() TO authenticated;

-- =============================================================================
-- 7. COMPANION ZERO-SECRET DRIVER RPCs (AVAILABLE POOL & OTP MILESTONES)
-- =============================================================================

-- 7A. get_driver_available_jobs(): Returns funded, unassigned Pick N Drop jobs
-- matching the driver's fleet class WITHOUT leaking private phone/OTP secrets.
CREATE OR REPLACE FUNCTION public.get_driver_available_jobs()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_driver public.drivers%ROWTYPE;
  v_driver_slug text;
  v_escrow_required boolean := true;
  v_jobs jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in required.'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO v_driver
  FROM public.drivers
  WHERE profile_id = v_uid
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN '[]'::jsonb;
  END IF;

  v_driver_slug := public._canonical_fleet_slug_v19b(v_driver.vehicle_type);

  SELECT COALESCE(p.escrow_required, true)
    INTO v_escrow_required
  FROM public.payment_feature_policies p
  WHERE p.scope_key = 'pnd';

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', o.id,
        'order_code', o.order_code,
        'service_mode', o.service_mode,
        'trip_type', o.trip_type,
        'pickup_address', o.pickup_address,
        'dropoff_address', o.dropoff_address,
        'pickup_lat', o.pickup_lat,
        'pickup_lng', o.pickup_lng,
        'dropoff_lat', o.dropoff_lat,
        'dropoff_lng', o.dropoff_lng,
        'distance_km', o.distance_km,
        'quoted_fare_inr', o.quoted_fare_inr,
        'estimated_driver_payout_inr', round(o.quoted_fare_inr * 0.85, 2),
        'status', o.status,
        'escrow_funded', (o.status = 'escrow_held' OR o.payment_verified_at IS NOT NULL),
        'vehicle_type_slug', public._canonical_fleet_slug_v19b(vt.slug),
        'vehicle_type_name', COALESCE(vt.name, v_driver.vehicle_type),
        'pod_required', COALESCE(o.pod_required, o.service_mode <> 'passenger'),
        'notes', o.notes,
        'created_at', o.created_at
      )
      ORDER BY o.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_jobs
  FROM public.delivery_orders o
  LEFT JOIN public.vehicle_types vt ON vt.id = o.vehicle_type_id
  WHERE o.driver_id IS NULL
    AND (
      (v_escrow_required AND o.status = 'escrow_held')
      OR (NOT v_escrow_required AND o.status IN ('escrow_held', 'awaiting_payment', 'payment_submitted'))
    )
    AND (
      v_driver.hub_id IS NULL
      OR o.hub_id IS NULL
      OR o.hub_id = v_driver.hub_id
    )
    AND (
      vt.slug IS NULL
      OR public._canonical_fleet_slug_v19b(vt.slug) = v_driver_slug
      OR EXISTS (
        SELECT 1
        FROM public.vehicles v
        WHERE v.driver_id = v_driver.id
          AND v.vehicle_type_id = o.vehicle_type_id
      )
    );

  RETURN v_jobs;
END;
$$;

REVOKE ALL ON FUNCTION public.get_driver_available_jobs() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_driver_available_jobs() TO authenticated;

-- 7B. get_driver_trip_otp_milestones(): Returns strictly boolean/timestamp
-- verification progress for trips assigned to auth.uid() — NEVER raw OTPs.
CREATE OR REPLACE FUNCTION public.get_driver_trip_otp_milestones(
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
  v_driver_id uuid;
  v_delivery_milestones jsonb := '{}'::jsonb;
  v_vehicle_milestones jsonb := '{}'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in required.'
      USING ERRCODE = '42501';
  END IF;

  SELECT d.id
    INTO v_driver_id
  FROM public.drivers d
  WHERE d.profile_id = v_uid
  LIMIT 1;

  IF v_driver_id IS NULL THEN
    RETURN jsonb_build_object('delivery', '{}'::jsonb, 'vehicle', '{}'::jsonb);
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
          'return_required', (s.return_otp IS NOT NULL OR o.trip_type = 'two_way'),
          'return_verified', (s.return_verified_at IS NOT NULL),
          'return_verified_at', s.return_verified_at,
          'failed_attempts', s.failed_attempts,
          'is_locked', (s.locked_until IS NOT NULL AND s.locked_until > now()),
          'locked_until', s.locked_until
        )
      ),
      '{}'::jsonb
    )
    INTO v_delivery_milestones
    FROM public.delivery_order_secrets s
    JOIN public.delivery_orders o ON o.id = s.order_id
    WHERE s.order_id = ANY(p_order_ids)
      AND o.driver_id = v_driver_id;
  END IF;

  IF array_length(p_booking_ids, 1) IS NOT NULL THEN
    SELECT COALESCE(
      jsonb_object_agg(
        vo.booking_id::text,
        jsonb_build_object(
          'pickup_verified', (vo.pickup_verified_at IS NOT NULL),
          'pickup_verified_at', vo.pickup_verified_at,
          'dropoff_verified', (vo.dropoff_verified_at IS NOT NULL),
          'dropoff_verified_at', vo.dropoff_verified_at,
          'return_required', (vo.return_otp IS NOT NULL),
          'return_verified', (vo.return_verified_at IS NOT NULL),
          'return_verified_at', vo.return_verified_at,
          'failed_attempts', vo.failed_attempts,
          'is_locked', (vo.locked_until IS NOT NULL AND vo.locked_until > now()),
          'locked_until', vo.locked_until
        )
      ),
      '{}'::jsonb
    )
    INTO v_vehicle_milestones
    FROM public.vehicle_booking_otps vo
    JOIN public.vehicle_bookings vb ON vb.id = vo.booking_id
    LEFT JOIN public.vehicle_listings vl ON vl.id = vb.vehicle_listing_id
    WHERE vo.booking_id = ANY(p_booking_ids)
      AND (
        vb.assigned_driver_id = v_driver_id
        OR vl.driver_id = v_driver_id
        OR vl.owner_id = v_uid
      );
  END IF;

  RETURN jsonb_build_object(
    'delivery', v_delivery_milestones,
    'vehicle', v_vehicle_milestones
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_driver_trip_otp_milestones(uuid[], uuid[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_driver_trip_otp_milestones(uuid[], uuid[]) TO authenticated;

-- =============================================================================
-- 8. PRIVATE delivery-pods BUCKET DRIVER RLS (STRICTLY SCOPED TO ASSIGNED TRIPS)
-- =============================================================================

-- Re-assert bucket stays strictly private (public = false)
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

-- Helper used by storage RLS: checks whether auth.uid() is the active assigned driver
-- for the booking UUID in orders/<booking_id>/<filename>
CREATE OR REPLACE FUNCTION public.is_driver_assigned_to_pod_path(
  p_object_name text,
  p_uid uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parts text[];
  v_booking_uuid uuid;
BEGIN
  IF p_uid IS NULL OR p_object_name IS NULL THEN
    RETURN false;
  END IF;

  v_parts := storage.foldername(p_object_name);
  IF array_length(v_parts, 1) < 2 OR v_parts[1] <> 'orders' THEN
    RETURN false;
  END IF;

  BEGIN
    v_booking_uuid := v_parts[2]::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    RETURN false;
  END;

  -- Active assigned driver on Pick N Drop delivery_orders
  IF EXISTS (
    SELECT 1
    FROM public.delivery_orders o
    JOIN public.drivers d ON d.id = o.driver_id
    WHERE o.id = v_booking_uuid
      AND d.profile_id = p_uid
      AND COALESCE(d.is_active, false) = true
      AND o.status IN ('driver_assigned', 'picked_up', 'in_transit', 'return_in_transit', 'delivered_pending_confirm')
  ) THEN
    RETURN true;
  END IF;

  -- Active assigned driver / operator on scheduled vehicle_bookings
  IF EXISTS (
    SELECT 1
    FROM public.vehicle_bookings vb
    LEFT JOIN public.vehicle_listings vl ON vl.id = vb.vehicle_listing_id
    JOIN public.drivers d ON d.profile_id = p_uid AND COALESCE(d.is_active, false) = true
    WHERE vb.id = v_booking_uuid
      AND vb.status IN ('confirmed', 'in_progress')
      AND (
        vb.assigned_driver_id = d.id
        OR vl.driver_id = d.id
        OR vl.owner_id = p_uid
      )
  ) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.is_driver_assigned_to_pod_path(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_driver_assigned_to_pod_path(text, uuid) TO authenticated;

-- Tighten INSERT policy so drivers can ONLY upload inside orders/<their_assigned_booking_id>/...
DROP POLICY IF EXISTS "delivery_pods_authenticated_upload" ON storage.objects;
CREATE POLICY "delivery_pods_authenticated_upload"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'delivery-pods'
    AND (
      public.is_pnd_mediator(auth.uid())
      OR public.is_driver_assigned_to_pod_path(storage.objects.name, auth.uid())
    )
  );

-- Allow assigned driver to replace/upsert their POD photo while trip is still open
DROP POLICY IF EXISTS "delivery_pods_driver_update" ON storage.objects;
CREATE POLICY "delivery_pods_driver_update"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'delivery-pods'
    AND (
      public.is_pnd_mediator(auth.uid())
      OR public.is_driver_assigned_to_pod_path(storage.objects.name, auth.uid())
    )
  )
  WITH CHECK (
    bucket_id = 'delivery-pods'
    AND (
      public.is_pnd_mediator(auth.uid())
      OR public.is_driver_assigned_to_pod_path(storage.objects.name, auth.uid())
    )
  );

-- Preserve mediator/customer SELECT and add assigned-driver preview for both delivery_orders & vehicle_bookings
DROP POLICY IF EXISTS "delivery_pods_authorized_select" ON storage.objects;
CREATE POLICY "delivery_pods_authorized_select"
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'delivery-pods'
    AND (
      public.is_pnd_mediator(auth.uid())
      OR public.is_driver_assigned_to_pod_path(storage.objects.name, auth.uid())
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
      OR EXISTS (
        SELECT 1
        FROM public.vehicle_bookings vb
        LEFT JOIN public.drivers d ON d.id = vb.assigned_driver_id
        WHERE vb.pod_storage_path = storage.objects.name
          AND (
            vb.customer_id = auth.uid()
            OR vb.mediator_id = auth.uid()
            OR d.profile_id = auth.uid()
          )
      )
    )
  );
