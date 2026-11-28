-- ============================================================================
-- PASS V23-B (2026-11-27): HIGH-IMPACT COMPOSITE INDEXES, REVOKE FROM PUBLIC
-- HYGIENE & MEDIATOR ESCROW REFUND UTR / GATEWAY SUPPORT (P2-11 & P2-13)
-- ============================================================================
-- Closes P2-11:
--   1. Composite audit index on public.audit_logs (actor_id, workspace, created_at DESC)
--      for fast per-actor/per-workspace audit queries.
--   2. Composite pay-per lookup index on public.pay_per_orders (target_table, target_id, status)
--      for O(log n) active boosted/featured placement resolution.
--   3. Upgrades public.mediator_resolve_escrow_payout with optional p_refund_utr_ref
--      parameter so manual UPI / Razorpay refund UTR references are persisted in
--      delivery_transactions.gateway_payload, payment_intents.refund_notes,
--      delivery_order_events.payload, and immutable audit_logs.metadata.
--   4. Hosted-Supabase safe DO $$ sweep over pg_proc revoking PUBLIC execute on all
--      app-owned SECURITY DEFINER functions in schema public (strictly excluding
--      extension-owned functions per AGENTS.md §3.8).
-- ============================================================================

BEGIN;

-- ============================================================================
-- 1. HIGH-IMPACT COMPOSITE INDEXES
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_audit_logs_actor_workspace_created_v23b
  ON public.audit_logs (actor_id, workspace, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pay_per_orders_target_status_v23b
  ON public.pay_per_orders (target_table, target_id, status);

-- ============================================================================
-- 2. UPGRADE mediator_resolve_escrow_payout WITH OPTIONAL p_refund_utr_ref
-- ============================================================================

DROP FUNCTION IF EXISTS public.mediator_resolve_escrow_payout(uuid, text, text);

CREATE OR REPLACE FUNCTION public.mediator_resolve_escrow_payout(
  p_booking_id uuid,
  p_action text,
  p_reason text DEFAULT NULL,
  p_refund_utr_ref text DEFAULT NULL
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
  v_refund_utr text := NULLIF(trim(COALESCE(p_refund_utr_ref, '')), '');
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
    PERFORM public._v21a_assert_dispatch_hub_scope(v_uid, v_order.hub_id);

    IF v_order.status = 'cancelled' THEN
      RAISE EXCEPTION 'Order % is already cancelled/refunded; no further escrow action is possible.', v_order.order_code
        USING ERRCODE = 'P0001';
    END IF;
    IF v_order.payout_released_at IS NOT NULL THEN
      RAISE EXCEPTION 'Escrow payout for % was already released; escalate post-payout disputes to Super-Admin.', v_order.order_code
        USING ERRCODE = 'P0001';
    END IF;
    IF v_action IN ('refund_customer', 'release_to_driver')
       AND v_order.payment_verified_at IS NULL
       AND v_order.status NOT IN ('escrow_held', 'driver_assigned', 'picked_up', 'in_transit',
                                  'delivered_pending_confirm', 'return_in_transit')
       AND NOT EXISTS (
         SELECT 1 FROM public.payment_intents pi
         WHERE pi.purpose = 'pick_n_drop' AND pi.reference_id = v_order.id AND pi.status = 'succeeded'
       ) THEN
      RAISE EXCEPTION 'Order % has no verified customer payment (status: "%"). Verify or reject the UPI proof first.', v_order.order_code, v_order.status
        USING ERRCODE = 'P0001';
    END IF;
    IF v_action = 'release_to_driver' AND v_order.driver_id IS NULL THEN
      RAISE EXCEPTION 'Order % has no assigned driver; nothing can be paid out.', v_order.order_code
        USING ERRCODE = 'P0001';
    END IF;
    IF v_action = 'freeze_dispute' AND v_order.status IN ('completed', 'awaiting_payment') THEN
      RAISE EXCEPTION 'Order % cannot be frozen in status "%".', v_order.order_code, v_order.status
        USING ERRCODE = 'P0001';
    END IF;

    SELECT * INTO v_secret FROM public.delivery_order_secrets WHERE order_id = v_order.id;
    SELECT * INTO v_intent
    FROM public.payment_intents
    WHERE purpose = 'pick_n_drop' AND reference_id = v_order.id
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF v_action = 'release_to_driver' THEN
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

      INSERT INTO public.delivery_transactions (
        order_id,
        tx_type,
        amount_inr,
        recorded_by,
        status,
        notes,
        gateway_payload
      )
      VALUES (
        v_order.id,
        'refund',
        v_order.quoted_fare_inr,
        v_uid,
        'refunded',
        'Escrow refund approved by Dispatch Mediator: ' || v_reason ||
          CASE WHEN v_refund_utr IS NOT NULL THEN ' (UTR/Ref: ' || v_refund_utr || ')' ELSE '' END,
        jsonb_build_object(
          'refund_reason', v_reason,
          'refund_utr_ref', v_refund_utr,
          'refunded_at', now()
        )
      );

      IF v_intent.id IS NOT NULL THEN
        UPDATE public.payment_intents
        SET
          status = 'refunded',
          refund_notes = v_reason ||
            CASE WHEN v_refund_utr IS NOT NULL THEN ' [Refund UTR/Ref: ' || v_refund_utr || ']' ELSE '' END,
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
          'reason', v_reason,
          'refund_utr_ref', v_refund_utr
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
          'reason', v_reason,
          'refund_utr_ref', v_refund_utr
        )
      );

      RETURN jsonb_build_object(
        'ok', true,
        'domain', 'pick_n_drop',
        'booking_id', v_order.id,
        'code', v_order.order_code,
        'status', 'cancelled',
        'refunded', true,
        'refund_utr_ref', v_refund_utr
      );
    END IF;
  END IF;

  -- Check Scheduled Vehicle bookings
  SELECT * INTO v_booking FROM public.vehicle_bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found.'
      USING ERRCODE = 'P0002';
  END IF;

  PERFORM public._v21a_assert_dispatch_hub_scope(v_uid, v_booking.hub_id);

  IF COALESCE(v_booking.escrow_status, 'unpaid') IN ('released', 'refunded') THEN
    RAISE EXCEPTION 'Escrow for booking % is already %; no further escrow action is possible.',
      v_booking.booking_code, v_booking.escrow_status
      USING ERRCODE = 'P0001';
  END IF;
  IF v_action = 'refund_customer'
     AND v_booking.payment_verified_at IS NULL
     AND COALESCE(v_booking.escrow_status, 'unpaid') NOT IN ('escrow_held', 'frozen_dispute') THEN
    RAISE EXCEPTION 'Booking % has no verified customer payment to refund (status: "%"). Verify or reject the UPI proof first.',
      v_booking.booking_code, v_booking.status
      USING ERRCODE = 'P0001';
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
        refund_notes = v_reason ||
          CASE WHEN v_refund_utr IS NOT NULL THEN ' [Refund UTR/Ref: ' || v_refund_utr || ']' ELSE '' END,
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
        'reason', v_reason,
        'refund_utr_ref', v_refund_utr
      )
    );

    RETURN jsonb_build_object(
      'ok', true,
      'domain', 'vehicle_booking',
      'booking_id', v_booking.id,
      'code', v_booking.booking_code,
      'status', 'cancelled',
      'refunded', true,
      'refund_utr_ref', v_refund_utr
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.mediator_resolve_escrow_payout(uuid, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mediator_resolve_escrow_payout(uuid, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.mediator_resolve_escrow_payout(uuid, text, text, text) TO authenticated;

-- ============================================================================
-- 3. HOSTED-SUPABASE SAFE REVOKE FROM PUBLIC SWEEP ON APP-OWNED SECURITY DEFINER FUNCTIONS
--    (Strictly excludes extension functions and non-owned functions per AGENTS.md §3.8)
-- ============================================================================

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prosecdef = true
      AND p.prokind = 'f'
      AND NOT EXISTS (
        SELECT 1
        FROM pg_depend d
        WHERE d.classid = 'pg_proc'::regclass
          AND d.objid = p.oid
          AND d.deptype = 'e'
      )
      AND pg_has_role(current_user, p.proowner, 'MEMBER')
  LOOP
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', r.sig);
  END LOOP;
END;
$$;

COMMIT;
