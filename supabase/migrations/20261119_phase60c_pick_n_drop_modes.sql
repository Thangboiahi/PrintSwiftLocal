-- =============================================================================
-- Migration: 20261119_phase60c_pick_n_drop_modes.sql
-- Phase 60-C: Service Modes (parcel / passenger / gas), Cycle Rickshaw Seed,
--             Unified Instructions, Nullable Ride Fields & Conditional POD RPC
-- =============================================================================

-- 1. Extend public.vehicle_types with supported_modes
ALTER TABLE public.vehicle_types
  ADD COLUMN IF NOT EXISTS supported_modes text[] NOT NULL
    DEFAULT ARRAY['parcel', 'passenger', 'gas'];

-- Seed Cycle Rickshaw and update supported_modes + display names idempotently
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
  supported_modes,
  is_active
)
VALUES (
  'cycle_rickshaw',
  'Cycle Rickshaw',
  'bike',
  30.00,
  8.00,
  10.00,
  15,
  1.75,
  80,
  '90 x 70 x 70 cm',
  ARRAY['parcel', 'gas'],
  true
)
ON CONFLICT (slug) DO UPDATE
SET
  name = EXCLUDED.name,
  base_fare_inr = EXCLUDED.base_fare_inr,
  per_km_rate_inr = EXCLUDED.per_km_rate_inr,
  two_way_multiplier = EXCLUDED.two_way_multiplier,
  max_weight_kg = EXCLUDED.max_weight_kg,
  supported_modes = EXCLUDED.supported_modes,
  is_active = true;

UPDATE public.vehicle_types
SET
  name = 'Scooty / Two-Wheeler',
  supported_modes = ARRAY['parcel', 'passenger', 'gas']
WHERE slug = 'two_wheeler';

UPDATE public.vehicle_types
SET supported_modes = ARRAY['parcel', 'passenger', 'gas']
WHERE slug IN ('e_rickshaw', 'auto');

UPDATE public.vehicle_types
SET supported_modes = ARRAY['parcel', 'passenger']
WHERE slug IN ('mini_van', 'alto');

UPDATE public.vehicle_types
SET supported_modes = ARRAY['parcel', 'gas']
WHERE slug IN ('pickup_truck', 'bolero');

-- 2. Extend public.delivery_orders for Parcel, Passenger Ride & LPG Gas modes
ALTER TABLE public.delivery_orders
  ADD COLUMN IF NOT EXISTS service_mode text NOT NULL DEFAULT 'parcel'
    CHECK (service_mode IN ('parcel', 'passenger', 'gas')),
  ADD COLUMN IF NOT EXISTS instructions text,
  ADD COLUMN IF NOT EXISTS passenger_count integer DEFAULT 1
    CHECK (passenger_count IS NULL OR passenger_count >= 1),
  ADD COLUMN IF NOT EXISTS cylinder_count integer DEFAULT 1
    CHECK (cylinder_count IS NULL OR cylinder_count >= 1),
  ADD COLUMN IF NOT EXISTS pod_required boolean NOT NULL DEFAULT true;

-- Make parcel/recipient-specific columns nullable for Passenger rides
ALTER TABLE public.delivery_orders
  ALTER COLUMN container_type DROP NOT NULL,
  ALTER COLUMN recipient_name DROP NOT NULL,
  ALTER COLUMN recipient_phone DROP NOT NULL;

-- Ensure container_type check constraint allows NULL cleanly
DO $$
DECLARE
  v_constraint_name text;
BEGIN
  SELECT conname
  INTO v_constraint_name
  FROM pg_constraint
  WHERE conrelid = 'public.delivery_orders'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) ILIKE '%container_type%'
  LIMIT 1;

  IF v_constraint_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.delivery_orders DROP CONSTRAINT %I', v_constraint_name);
  END IF;
END;
$$;

ALTER TABLE public.delivery_orders
  ADD CONSTRAINT delivery_orders_container_type_check
  CHECK (
    container_type IS NULL
    OR container_type IN ('envelope', 'small_box', 'medium_parcel', 'fragile_crate', 'bulk_sack')
  );

CREATE INDEX IF NOT EXISTS idx_delivery_orders_service_mode_status
  ON public.delivery_orders (service_mode, status, created_at DESC);

-- 3. Update verify_delivery_otp RPC so POD photo is only mandatory when order.pod_required = true
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
    -- Phase 60-C: Only require POD photo when pod_required = true (skip for passenger rides)
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

  -- Transition order status & store POD if provided at dropoff
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
    'pod_storage_path', CASE WHEN v_stage = 'dropoff' AND v_pod_path IS NOT NULL THEN v_pod_path ELSE v_order.pod_storage_path END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.verify_delivery_otp(uuid, text, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_delivery_otp(uuid, text, text, text) TO authenticated;
