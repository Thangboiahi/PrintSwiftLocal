-- =============================================================================
-- DD OODLE — PHASE 75-A: LIGHTWEIGHT REAL ESTATE PRO SCHEMA,
-- REGIONAL TRUST FIELDS, 30-DAY FRESHNESS & PAID VERIFIED BOOSTS
-- 100% IDEMPOTENT MIGRATION
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =============================================================================
-- A. Two Isolated Real Estate Tables
-- =============================================================================

-- A1. public.listing_real_estate_profiles (1-to-1 extension for real_estate listings)
CREATE TABLE IF NOT EXISTS public.listing_real_estate_profiles (
  listing_id uuid PRIMARY KEY REFERENCES public.listings(id) ON DELETE CASCADE,
  hub_id uuid NOT NULL REFERENCES public.service_hubs(id) ON DELETE CASCADE,
  deal_type text NOT NULL DEFAULT 'rent'
    CHECK (deal_type IN ('rent', 'sale', 'lease', 'pg_hostel')),
  property_type text NOT NULL DEFAULT 'house'
    CHECK (property_type IN ('plot_land', 'house', 'apartment', 'commercial_shop', 'room_pg')),
  price_inr numeric(12,2) NOT NULL DEFAULT 0,
  price_period text NOT NULL DEFAULT 'monthly'
    CHECK (price_period IN ('total', 'monthly', 'yearly')),
  deposit_inr numeric(12,2),
  is_negotiable boolean NOT NULL DEFAULT true,
  bedrooms integer,
  bathrooms integer,
  area_sqft integer,
  land_area_text text,
  furnishing text NOT NULL DEFAULT 'unfurnished'
    CHECK (furnishing IN ('unfurnished', 'semi_furnished', 'furnished', 'not_applicable')),
  -- Regional Trust Fields (Churachandpur / Aizawl hill-district essentials)
  patta_status text NOT NULL DEFAULT 'not_applicable'
    CHECK (patta_status IN ('verified_patta', 'village_authority', 'leasehold', 'not_applicable')),
  water_supply text NOT NULL DEFAULT 'municipal'
    CHECK (water_supply IN ('24x7', 'municipal', 'borewell', 'tanker', 'seasonal')),
  road_access text NOT NULL DEFAULT 'car_accessible'
    CHECK (road_access IN ('car_accessible', 'two_wheeler_only', 'footpath')),
  power_backup boolean NOT NULL DEFAULT false,
  parking_available boolean NOT NULL DEFAULT false,
  -- Privacy, Verification & Monetization
  listed_by_role text NOT NULL DEFAULT 'owner'
    CHECK (listed_by_role IN ('owner', 'agent', 'builder')),
  show_exact_pin boolean NOT NULL DEFAULT false,
  contact_reveal_policy text NOT NULL DEFAULT 'after_visit_accept'
    CHECK (contact_reveal_policy IN ('direct_call', 'after_visit_accept')),
  optional_tour_url text,
  patta_verified boolean NOT NULL DEFAULT false,
  site_verified boolean NOT NULL DEFAULT false,
  verified_boost_expires_at timestamptz,
  -- 30-Day Freshness Lifecycle
  availability_status text NOT NULL DEFAULT 'available'
    CHECK (availability_status IN ('available', 'under_offer', 'sold_rented', 'paused')),
  last_confirmed_available_at timestamptz NOT NULL DEFAULT now(),
  freshness_expires_at timestamptz NOT NULL DEFAULT (now() + interval '30 days'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_re_profiles_hub_deal_avail
  ON public.listing_real_estate_profiles (hub_id, deal_type, availability_status);

CREATE INDEX IF NOT EXISTS idx_re_profiles_hub_boost
  ON public.listing_real_estate_profiles (hub_id, verified_boost_expires_at DESC);

-- A2. public.property_visit_requests (Lightweight Site Visit Request & Controlled Contact Reveal)
CREATE TABLE IF NOT EXISTS public.property_visit_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_code text UNIQUE NOT NULL,
  hub_id uuid NOT NULL REFERENCES public.service_hubs(id),
  listing_id uuid NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  requester_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  requester_name text NOT NULL,
  requester_phone text NOT NULL,
  preferred_date date NOT NULL,
  preferred_slot text NOT NULL DEFAULT 'morning'
    CHECK (preferred_slot IN ('morning', 'afternoon', 'evening')),
  message text,
  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'accepted', 'rescheduled', 'completed', 'declined', 'cancelled')),
  owner_note text,
  contact_revealed boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_property_visits_listing_status_created
  ON public.property_visit_requests (listing_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_property_visits_requester_created
  ON public.property_visit_requests (requester_id, created_at DESC);

-- =============================================================================
-- B. Safe Interlink Alterations to Existing Tables
-- =============================================================================

-- B1. public.payment_intents: add real_estate_listing_id + idempotent purpose CHECK
ALTER TABLE public.payment_intents
  ADD COLUMN IF NOT EXISTS real_estate_listing_id uuid REFERENCES public.listings(id) ON DELETE SET NULL;

ALTER TABLE public.payment_intents
  DROP CONSTRAINT IF EXISTS payment_intents_purpose_check;

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
      AND t.relname = 'payment_intents'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%purpose%'
  LOOP
    EXECUTE format('ALTER TABLE public.payment_intents DROP CONSTRAINT IF EXISTS %I', v_conname);
  END LOOP;

  ALTER TABLE public.payment_intents
    ADD CONSTRAINT payment_intents_purpose_check CHECK (
      purpose IN (
        'pick_n_drop',
        'vehicle_booking',
        'bulletin_subscription',
        'bulletin_post_pass',
        'print_order',
        'print_order_with_delivery',
        'print_pro_subscription',
        'resource_booking',
        'booking_pro_subscription',
        'stay_pro_subscription',
        'shop_order',
        'shop_order_with_delivery',
        'restaurant_order',
        'restaurant_order_with_delivery',
        'catalogue_pro_subscription',
        'restaurant_pro_subscription',
        'real_estate_boost_30d',
        'agent_pro_subscription'
      )
    );
END;
$$;

-- B2. public.subscription_plans: ensure plan_scope CHECK (if present) allows real_estate_boost & agent_pro
DO $$
DECLARE
  v_conname text;
  v_had_check boolean := false;
BEGIN
  FOR v_conname IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'subscription_plans'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%plan_scope%'
  LOOP
    v_had_check := true;
    EXECUTE format('ALTER TABLE public.subscription_plans DROP CONSTRAINT IF EXISTS %I', v_conname);
  END LOOP;

  IF v_had_check THEN
    ALTER TABLE public.subscription_plans
      ADD CONSTRAINT subscription_plans_plan_scope_check CHECK (
        plan_scope IN (
          'bulletin',
          'print_pro',
          'merchant_bundle',
          'booking_pro',
          'stay_pro',
          'catalogue_pro',
          'restaurant_pro',
          'real_estate_boost',
          'agent_pro',
          'merchant_all_in_one'
        )
      );
  END IF;
END;
$$;

-- B3. public.service_hubs: backfill module_switches with real_estate = true where missing
UPDATE public.service_hubs
SET module_switches = COALESCE(module_switches, '{}'::jsonb)
  || CASE
       WHEN NOT (COALESCE(module_switches, '{}'::jsonb) ? 'real_estate')
         THEN '{"real_estate": true}'::jsonb
       ELSE '{}'::jsonb
     END;

-- =============================================================================
-- C. Triggers: Privilege Guard + Vertical Summary Auto-Sync
-- =============================================================================

-- C1. Guard patta_verified, site_verified, and verified_boost_expires_at on listing_real_estate_profiles
CREATE OR REPLACE FUNCTION public.guard_real_estate_profile_privileged_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_service boolean := (current_setting('role', true) = 'service_role');
  v_can_verify boolean := false;
  v_listing_hub_id uuid;
BEGIN
  -- Auto-sync hub_id from parent listing when available
  SELECT l.hub_id INTO v_listing_hub_id
  FROM public.listings l
  WHERE l.id = NEW.listing_id;

  IF v_listing_hub_id IS NOT NULL THEN
    NEW.hub_id := v_listing_hub_id;
  END IF;

  NEW.updated_at := now();

  IF v_is_service THEN
    RETURN NEW;
  END IF;

  v_can_verify := public.is_super_admin() OR public.is_hub_manager_for(NEW.hub_id);

  IF NOT v_can_verify THEN
    IF TG_OP = 'INSERT' THEN
      NEW.patta_verified := false;
      NEW.site_verified := false;
      NEW.verified_boost_expires_at := NULL;
    ELSE
      NEW.patta_verified := OLD.patta_verified;
      NEW.site_verified := OLD.site_verified;
      NEW.verified_boost_expires_at := OLD.verified_boost_expires_at;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_real_estate_profile_privileged ON public.listing_real_estate_profiles;
CREATE TRIGGER trg_guard_real_estate_profile_privileged
  BEFORE INSERT OR UPDATE ON public.listing_real_estate_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_real_estate_profile_privileged_fields();

-- C2. Auto-sync listings.listing_vertical = 'real_estate' & listings.vertical_summary
CREATE OR REPLACE FUNCTION public.sync_real_estate_vertical_summary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.listings
  SET
    listing_vertical = 'real_estate',
    vertical_summary = COALESCE(vertical_summary, '{}'::jsonb) || jsonb_build_object(
      'deal_type', NEW.deal_type,
      'property_type', NEW.property_type,
      'price_inr', NEW.price_inr,
      'price_period', NEW.price_period,
      'bedrooms', NEW.bedrooms,
      'area_sqft', NEW.area_sqft,
      'land_area_text', NEW.land_area_text,
      'patta_status', NEW.patta_status,
      'patta_verified', NEW.patta_verified,
      'site_verified', NEW.site_verified,
      'water_supply', NEW.water_supply,
      'road_access', NEW.road_access,
      'availability_status', NEW.availability_status,
      'listed_by_role', NEW.listed_by_role,
      'verified_boost_expires_at', NEW.verified_boost_expires_at,
      'freshness_expires_at', NEW.freshness_expires_at
    ),
    updated_at = now()
  WHERE id = NEW.listing_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_real_estate_vertical_summary ON public.listing_real_estate_profiles;
CREATE TRIGGER trg_sync_real_estate_vertical_summary
  AFTER INSERT OR UPDATE ON public.listing_real_estate_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_real_estate_vertical_summary();

-- =============================================================================
-- D. Helper RPCs & fulfill_payment_intent Upgrade (SECURITY DEFINER)
-- =============================================================================

-- D1. is_real_estate_operator_for
CREATE OR REPLACE FUNCTION public.is_real_estate_operator_for(p_listing_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_owner_id uuid;
BEGIN
  IF current_setting('role', true) = 'service_role' THEN
    RETURN true;
  END IF;

  IF v_uid IS NULL OR p_listing_id IS NULL THEN
    RETURN false;
  END IF;

  IF public.is_super_admin() THEN
    RETURN true;
  END IF;

  SELECT l.owner_id INTO v_owner_id
  FROM public.listings l
  WHERE l.id = p_listing_id;

  IF v_owner_id = v_uid THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.staff_delegations sd
    WHERE sd.listing_id = p_listing_id
      AND sd.staff_id = v_uid
      AND COALESCE(sd.status, 'active') = 'active'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.is_real_estate_operator_for(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_real_estate_operator_for(uuid) TO authenticated, service_role;

-- D2. has_active_real_estate_pro
CREATE OR REPLACE FUNCTION public.has_active_real_estate_pro(p_listing_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_id uuid;
  v_boost_exp timestamptz;
BEGIN
  IF p_listing_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT l.owner_id, rp.verified_boost_expires_at
    INTO v_owner_id, v_boost_exp
  FROM public.listings l
  LEFT JOIN public.listing_real_estate_profiles rp ON rp.listing_id = l.id
  WHERE l.id = p_listing_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_boost_exp IS NOT NULL AND v_boost_exp > now() THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.user_subscriptions us
    JOIN public.subscription_plans sp ON sp.id = us.plan_id
    WHERE us.status = 'active'
      AND us.expires_at > now()
      AND sp.plan_scope IN ('agent_pro', 'real_estate_boost', 'merchant_all_in_one')
      AND (
        us.listing_id = p_listing_id
        OR (us.listing_id IS NULL AND us.user_id = v_owner_id)
      )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.has_active_real_estate_pro(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_active_real_estate_pro(uuid) TO anon, authenticated, service_role;

-- D3. confirm_property_freshness
CREATE OR REPLACE FUNCTION public.confirm_property_freshness(
  p_listing_id uuid,
  p_availability_status text DEFAULT 'available'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean_status text := lower(trim(COALESCE(p_availability_status, 'available')));
  v_updated public.listing_real_estate_profiles%ROWTYPE;
BEGIN
  IF p_listing_id IS NULL THEN
    RAISE EXCEPTION 'listing_id is required.' USING ERRCODE = '22023';
  END IF;

  IF v_clean_status NOT IN ('available', 'under_offer', 'sold_rented', 'paused') THEN
    RAISE EXCEPTION 'Invalid availability_status: %', v_clean_status USING ERRCODE = '22023';
  END IF;

  IF NOT public.is_real_estate_operator_for(p_listing_id) THEN
    RAISE EXCEPTION 'Forbidden: Only authorized property operators may confirm freshness.'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.listing_real_estate_profiles
  SET
    availability_status = v_clean_status,
    last_confirmed_available_at = now(),
    freshness_expires_at = now() + interval '30 days',
    updated_at = now()
  WHERE listing_id = p_listing_id
  RETURNING * INTO v_updated;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Real estate profile not found for listing.' USING ERRCODE = 'P0002';
  END IF;

  RETURN to_jsonb(v_updated);
END;
$$;

REVOKE ALL ON FUNCTION public.confirm_property_freshness(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.confirm_property_freshness(uuid, text) TO authenticated, service_role;

-- D4. Upgrade fulfill_payment_intent RPC (preserves ALL prior Phase 63-74 branches + adds Real Estate Boost & Agent Pro)
CREATE OR REPLACE FUNCTION public.fulfill_payment_intent(
  p_intent_id uuid,
  p_provider_payment_id text DEFAULT NULL,
  p_provider text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_uid uuid := auth.uid();
  v_is_service boolean := (current_setting('role', true) = 'service_role');
  v_intent public.payment_intents%ROWTYPE;
  v_effective_payment_id text;
  v_effective_provider text;
  v_print_order_id uuid;
  v_print_order public.print_orders%ROWTYPE;
  v_booking_id uuid;
  v_booking public.resource_bookings%ROWTYPE;
  v_shop_order_id uuid;
  v_shop_order public.shop_orders%ROWTYPE;
  v_rest_order_id uuid;
  v_rest_order public.restaurant_orders%ROWTYPE;
  v_re_listing_id uuid;
  v_listing_owner_id uuid;
  v_listing_hub_id uuid;
  v_gross_inr numeric(10,2);
  v_fee_inr numeric(10,2);
  v_net_inr numeric(10,2);
  v_sub_row record;
BEGIN
  IF NOT v_is_service AND NOT public.is_super_admin() AND NOT EXISTS (
    SELECT 1
    FROM public.hub_managers hm
    WHERE hm.profile_id = v_caller_uid
      AND hm.is_active = true
      AND hm.can_confirm_manual_payments = true
  ) THEN
    RAISE EXCEPTION 'Forbidden: Only Super Admin, delegated Hub Manager, or verified payment webhook may fulfill payment intents.'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO v_intent
  FROM public.payment_intents
  WHERE id = p_intent_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment intent not found.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT v_is_service
     AND NOT public.is_super_admin()
     AND NOT public.can_confirm_hub_payment(v_intent.hub_id) THEN
    RAISE EXCEPTION 'Forbidden: You do not have manual payment confirmation authority for this hub.'
      USING ERRCODE = '42501';
  END IF;

  IF v_intent.status = 'succeeded' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'already_fulfilled', true,
      'intent_id', p_intent_id,
      'payment_intent', to_jsonb(v_intent)
    );
  END IF;

  IF v_intent.status = 'refunded' THEN
    RAISE EXCEPTION 'Cannot fulfill a payment intent that has already been refunded.'
      USING ERRCODE = 'P0001';
  END IF;

  v_effective_provider := coalesce(
    nullif(trim(coalesce(p_provider, '')), ''),
    v_intent.provider,
    'manual_upi'
  );
  IF v_effective_provider NOT IN ('manual_upi', 'razorpay') THEN
    v_effective_provider := v_intent.provider;
  END IF;

  v_effective_payment_id := coalesce(
    nullif(trim(coalesce(p_provider_payment_id, '')), ''),
    v_intent.upi_utr_ref,
    v_intent.provider_payment_id
  );

  UPDATE public.payment_intents
  SET
    provider = v_effective_provider,
    status = 'succeeded',
    verified_by = coalesce(v_caller_uid, verified_by),
    provider_payment_id = v_effective_payment_id,
    updated_at = now()
  WHERE id = p_intent_id
  RETURNING * INTO v_intent;

  IF v_intent.promo_code_id IS NOT NULL THEN
    UPDATE public.promo_codes
    SET used_count = used_count + 1
    WHERE id = v_intent.promo_code_id;
  END IF;

  -- 1. Pick N Drop Delivery
  IF v_intent.purpose = 'pick_n_drop' THEN
    UPDATE public.delivery_orders
    SET status = 'escrow_held', mediator_id = coalesce(mediator_id, v_caller_uid), updated_at = now()
    WHERE id = v_intent.reference_id
      AND status IN ('awaiting_payment', 'payment_submitted');

    INSERT INTO public.delivery_transactions (
      order_id, hub_id, tx_type, amount_inr, upi_utr_ref, payment_proof_path, recorded_by, notes
    ) VALUES (
      v_intent.reference_id, v_intent.hub_id, 'escrow_hold', v_intent.amount_inr,
      coalesce(v_intent.upi_utr_ref, v_effective_payment_id), v_intent.payment_proof_path,
      v_caller_uid, 'Fulfilled via ' || v_intent.provider || ' intent ' || v_intent.intent_code
    );

    INSERT INTO public.delivery_order_events (order_id, actor_id, event_type, payload)
    VALUES (
      v_intent.reference_id, v_caller_uid, 'escrow_held',
      jsonb_build_object(
        'intent_id', v_intent.id, 'intent_code', v_intent.intent_code,
        'hub_id', v_intent.hub_id, 'provider', v_intent.provider,
        'provider_payment_id', v_effective_payment_id, 'amount_inr', v_intent.amount_inr
      )
    );

  -- 2. Scheduled Vehicle Bookings
  ELSIF v_intent.purpose = 'vehicle_booking' THEN
    UPDATE public.vehicle_bookings
    SET status = 'confirmed', hold_expires_at = NULL, updated_at = now()
    WHERE id = v_intent.reference_id;

  -- 3. Bulletin Subscription
  ELSIF v_intent.purpose = 'bulletin_subscription' THEN
    UPDATE public.user_subscriptions
    SET status = 'active', verified_by = coalesce(v_caller_uid, verified_by),
        payment_ref = coalesce(v_effective_payment_id, payment_ref)
    WHERE id = v_intent.reference_id;

  -- 4. Bulletin Single Post Pass
  ELSIF v_intent.purpose = 'bulletin_post_pass' THEN
    UPDATE public.bulletin_post_passes
    SET status = 'available', verified_by = coalesce(v_caller_uid, verified_by),
        upi_utr_ref = coalesce(v_intent.upi_utr_ref, v_effective_payment_id, upi_utr_ref)
    WHERE id = v_intent.reference_id;

  -- 5. Print & Digital Orders
  ELSIF v_intent.purpose IN ('print_order', 'print_order_with_delivery') THEN
    v_print_order_id := COALESCE(v_intent.print_order_id, v_intent.reference_id);

    UPDATE public.print_orders
    SET
      payment_status = 'escrow_held',
      fulfillment_status = CASE WHEN fulfillment_status IN ('draft', 'confirmed') THEN 'confirmed' ELSE fulfillment_status END,
      quote_status = CASE WHEN quote_status IN ('unquoted', 'awaiting_shop_quote', 'quoted', 'accepted') THEN 'accepted' ELSE quote_status END,
      settlement_status = CASE WHEN is_first_party_order = false THEN 'locked' ELSE 'not_applicable' END,
      payment_intent_id = COALESCE(payment_intent_id, v_intent.id),
      updated_at = now()
    WHERE id = v_print_order_id
    RETURNING * INTO v_print_order;

    IF FOUND THEN
      IF v_intent.purpose = 'print_order_with_delivery' AND v_print_order.linked_delivery_order_id IS NOT NULL THEN
        UPDATE public.delivery_orders
        SET status = 'escrow_held', mediator_id = COALESCE(mediator_id, v_caller_uid), updated_at = now()
        WHERE id = v_print_order.linked_delivery_order_id
          AND status IN ('awaiting_payment', 'payment_submitted');
      END IF;

      IF v_print_order.is_first_party_order = false THEN
        SELECT l.owner_id, l.hub_id INTO v_listing_owner_id, v_listing_hub_id
        FROM public.listings l WHERE l.id = v_print_order.listing_id;

        IF v_listing_owner_id IS NOT NULL THEN
          v_gross_inr := COALESCE(v_print_order.quoted_amount_inr, v_intent.amount_inr);
          v_fee_inr := COALESCE(v_print_order.platform_fee_inr, 0);
          v_net_inr := GREATEST(0, v_gross_inr - v_fee_inr);

          INSERT INTO public.merchant_settlements (
            hub_id, listing_id, owner_id, print_order_id, settlement_source,
            gross_amount_inr, platform_fee_inr, net_payable_inr, status
          ) VALUES (
            COALESCE(v_print_order.hub_id, v_listing_hub_id, v_intent.hub_id),
            v_print_order.listing_id, v_listing_owner_id, v_print_order.id, 'print_order',
            v_gross_inr, v_fee_inr, v_net_inr, 'locked'
          )
          ON CONFLICT (print_order_id) DO UPDATE
          SET gross_amount_inr = EXCLUDED.gross_amount_inr,
              platform_fee_inr = EXCLUDED.platform_fee_inr,
              net_payable_inr = EXCLUDED.net_payable_inr,
              status = CASE WHEN public.merchant_settlements.status = 'settled' THEN 'settled' ELSE 'locked' END,
              updated_at = now();
        END IF;
      END IF;
    END IF;

  -- 6. Print Pro Subscription
  ELSIF v_intent.purpose = 'print_pro_subscription' THEN
    SELECT us.id, us.listing_id, us.expires_at, COALESCE(sp.duration_days, 30) AS duration_days
      INTO v_sub_row
    FROM public.user_subscriptions us
    LEFT JOIN public.subscription_plans sp ON sp.id = us.plan_id
    WHERE us.id = v_intent.reference_id
    FOR UPDATE OF us;

    IF FOUND THEN
      UPDATE public.user_subscriptions
      SET status = 'active', starts_at = COALESCE(starts_at, now()),
          expires_at = CASE WHEN expires_at IS NULL OR expires_at <= now() THEN now() + make_interval(days => v_sub_row.duration_days) ELSE expires_at END,
          verified_by = COALESCE(v_caller_uid, verified_by),
          payment_ref = COALESCE(v_effective_payment_id, payment_ref)
      WHERE id = v_sub_row.id;

      IF v_sub_row.listing_id IS NOT NULL THEN
        SELECT l.hub_id INTO v_listing_hub_id FROM public.listings l WHERE l.id = v_sub_row.listing_id;
        IF v_listing_hub_id IS NOT NULL THEN
          INSERT INTO public.listing_print_profiles (listing_id, hub_id)
          VALUES (v_sub_row.listing_id, v_listing_hub_id)
          ON CONFLICT (listing_id) DO NOTHING;
        END IF;
      END IF;
    END IF;

  -- 7. Universal Resource Booking (Turfs, Halls & Hotel Stays)
  ELSIF v_intent.purpose = 'resource_booking' THEN
    v_booking_id := COALESCE(v_intent.resource_booking_id, v_intent.reference_id);

    UPDATE public.resource_bookings
    SET
      booking_status = CASE WHEN booking_status IN ('pending_payment', 'confirmed') THEN 'confirmed' ELSE booking_status END,
      payment_status = CASE WHEN COALESCE(balance_at_venue_inr, 0) > 0 THEN 'advance_escrow_held' ELSE 'fully_prepaid_escrow' END,
      settlement_status = 'locked',
      payment_intent_id = COALESCE(payment_intent_id, v_intent.id),
      updated_at = now()
    WHERE id = v_booking_id
    RETURNING * INTO v_booking;

    IF FOUND THEN
      SELECT l.owner_id, l.hub_id INTO v_listing_owner_id, v_listing_hub_id
      FROM public.listings l WHERE l.id = v_booking.listing_id;

      IF v_listing_owner_id IS NOT NULL THEN
        v_gross_inr := COALESCE(v_booking.advance_amount_inr, v_intent.amount_inr);
        v_fee_inr := COALESCE(v_booking.convenience_fee_inr, 0);
        v_net_inr := COALESCE(v_booking.advance_amount_inr, GREATEST(0, v_gross_inr - v_fee_inr));

        INSERT INTO public.merchant_settlements (
          hub_id, listing_id, owner_id, resource_booking_id, settlement_source,
          gross_amount_inr, platform_fee_inr, net_payable_inr, status
        ) VALUES (
          COALESCE(v_booking.hub_id, v_listing_hub_id, v_intent.hub_id),
          v_booking.listing_id, v_listing_owner_id, v_booking.id, 'resource_booking',
          v_gross_inr, v_fee_inr, v_net_inr, 'locked'
        )
        ON CONFLICT (resource_booking_id) DO UPDATE
        SET gross_amount_inr = EXCLUDED.gross_amount_inr,
            platform_fee_inr = EXCLUDED.platform_fee_inr,
            net_payable_inr = EXCLUDED.net_payable_inr,
            status = CASE WHEN public.merchant_settlements.status = 'settled' THEN 'settled' ELSE 'locked' END,
            updated_at = now();
      END IF;
    END IF;

  -- 8. Booking Pro & Stay Pro Subscriptions
  ELSIF v_intent.purpose IN ('booking_pro_subscription', 'stay_pro_subscription') THEN
    SELECT us.id, us.listing_id, us.expires_at, COALESCE(sp.duration_days, 30) AS duration_days
      INTO v_sub_row
    FROM public.user_subscriptions us
    LEFT JOIN public.subscription_plans sp ON sp.id = us.plan_id
    WHERE us.id = v_intent.reference_id
    FOR UPDATE OF us;

    IF FOUND THEN
      UPDATE public.user_subscriptions
      SET status = 'active', starts_at = COALESCE(starts_at, now()),
          expires_at = CASE WHEN expires_at IS NULL OR expires_at <= now() THEN now() + make_interval(days => v_sub_row.duration_days) ELSE expires_at + make_interval(days => v_sub_row.duration_days) END,
          verified_by = COALESCE(v_caller_uid, verified_by),
          payment_ref = COALESCE(v_effective_payment_id, payment_ref)
      WHERE id = v_sub_row.id;

      IF v_intent.purpose = 'stay_pro_subscription' AND v_sub_row.listing_id IS NOT NULL THEN
        SELECT l.hub_id INTO v_listing_hub_id FROM public.listings l WHERE l.id = v_sub_row.listing_id;
        IF v_listing_hub_id IS NOT NULL THEN
          INSERT INTO public.listing_hotel_profiles (listing_id, hub_id)
          VALUES (v_sub_row.listing_id, v_listing_hub_id)
          ON CONFLICT (listing_id) DO NOTHING;
        END IF;
      END IF;
    END IF;

  -- 9. Shop Catalogue Orders (Counter Pickup or Pick N Drop)
  ELSIF v_intent.purpose IN ('shop_order', 'shop_order_with_delivery') THEN
    v_shop_order_id := COALESCE(v_intent.shop_order_id, v_intent.reference_id);

    UPDATE public.shop_orders
    SET
      payment_status = 'escrow_held',
      order_status = CASE WHEN order_status = 'pending_payment' THEN 'confirmed' ELSE order_status END,
      settlement_status = 'locked',
      payment_intent_id = COALESCE(payment_intent_id, v_intent.id),
      updated_at = now()
    WHERE id = v_shop_order_id
    RETURNING * INTO v_shop_order;

    IF FOUND THEN
      IF v_intent.purpose = 'shop_order_with_delivery' AND v_shop_order.linked_delivery_order_id IS NOT NULL THEN
        UPDATE public.delivery_orders
        SET status = 'escrow_held', mediator_id = COALESCE(mediator_id, v_caller_uid), updated_at = now()
        WHERE id = v_shop_order.linked_delivery_order_id
          AND status IN ('awaiting_payment', 'payment_submitted');
      END IF;

      SELECT l.owner_id, l.hub_id INTO v_listing_owner_id, v_listing_hub_id
      FROM public.listings l WHERE l.id = v_shop_order.listing_id;

      IF v_listing_owner_id IS NOT NULL THEN
        v_net_inr := COALESCE(v_shop_order.subtotal_inr, 0) + COALESCE(v_shop_order.packaging_fee_inr, 0);
        v_gross_inr := COALESCE(v_shop_order.total_amount_inr, v_intent.amount_inr);
        v_fee_inr := GREATEST(0, COALESCE(v_intent.convenience_fee_inr, 0));

        INSERT INTO public.merchant_settlements (
          hub_id, listing_id, owner_id, shop_order_id, settlement_source,
          gross_amount_inr, platform_fee_inr, net_payable_inr, status
        ) VALUES (
          COALESCE(v_shop_order.hub_id, v_listing_hub_id, v_intent.hub_id),
          v_shop_order.listing_id, v_listing_owner_id, v_shop_order.id, 'shop_order',
          v_gross_inr, v_fee_inr, v_net_inr, 'locked'
        )
        ON CONFLICT (shop_order_id) DO UPDATE
        SET gross_amount_inr = EXCLUDED.gross_amount_inr,
            platform_fee_inr = EXCLUDED.platform_fee_inr,
            net_payable_inr = EXCLUDED.net_payable_inr,
            status = CASE WHEN public.merchant_settlements.status = 'settled' THEN 'settled' ELSE 'locked' END,
            updated_at = now();
      END IF;
    END IF;

  -- 10. Restaurant & Café Orders (Takeaway or Pick N Drop Hot-Food)
  ELSIF v_intent.purpose IN ('restaurant_order', 'restaurant_order_with_delivery') THEN
    v_rest_order_id := COALESCE(v_intent.restaurant_order_id, v_intent.reference_id);

    UPDATE public.restaurant_orders
    SET
      payment_status = 'escrow_held',
      kitchen_status = CASE WHEN kitchen_status = 'pending_payment' THEN 'new_order' ELSE kitchen_status END,
      settlement_status = 'locked',
      payment_intent_id = COALESCE(payment_intent_id, v_intent.id),
      updated_at = now()
    WHERE id = v_rest_order_id
    RETURNING * INTO v_rest_order;

    IF FOUND THEN
      IF v_intent.purpose = 'restaurant_order_with_delivery' AND v_rest_order.linked_delivery_order_id IS NOT NULL THEN
        UPDATE public.delivery_orders
        SET status = 'escrow_held', mediator_id = COALESCE(mediator_id, v_caller_uid), updated_at = now()
        WHERE id = v_rest_order.linked_delivery_order_id
          AND status IN ('awaiting_payment', 'payment_submitted');
      END IF;

      SELECT l.owner_id, l.hub_id INTO v_listing_owner_id, v_listing_hub_id
      FROM public.listings l WHERE l.id = v_rest_order.listing_id;

      IF v_listing_owner_id IS NOT NULL THEN
        v_net_inr := COALESCE(v_rest_order.subtotal_inr, 0) + COALESCE(v_rest_order.packaging_fee_inr, 0);
        v_gross_inr := COALESCE(v_rest_order.total_amount_inr, v_intent.amount_inr);
        v_fee_inr := GREATEST(0, COALESCE(v_intent.convenience_fee_inr, 0));

        INSERT INTO public.merchant_settlements (
          hub_id, listing_id, owner_id, restaurant_order_id, settlement_source,
          gross_amount_inr, platform_fee_inr, net_payable_inr, status
        ) VALUES (
          COALESCE(v_rest_order.hub_id, v_listing_hub_id, v_intent.hub_id),
          v_rest_order.listing_id, v_listing_owner_id, v_rest_order.id, 'restaurant_order',
          v_gross_inr, v_fee_inr, v_net_inr, 'locked'
        )
        ON CONFLICT (restaurant_order_id) DO UPDATE
        SET gross_amount_inr = EXCLUDED.gross_amount_inr,
            platform_fee_inr = EXCLUDED.platform_fee_inr,
            net_payable_inr = EXCLUDED.net_payable_inr,
            status = CASE WHEN public.merchant_settlements.status = 'settled' THEN 'settled' ELSE 'locked' END,
            updated_at = now();
      END IF;
    END IF;

  -- 11. Catalogue Pro & Restaurant Pro Subscriptions
  ELSIF v_intent.purpose IN ('catalogue_pro_subscription', 'restaurant_pro_subscription') THEN
    SELECT us.id, us.listing_id, us.expires_at, COALESCE(sp.duration_days, 30) AS duration_days
      INTO v_sub_row
    FROM public.user_subscriptions us
    LEFT JOIN public.subscription_plans sp ON sp.id = us.plan_id
    WHERE us.id = v_intent.reference_id
    FOR UPDATE OF us;

    IF FOUND THEN
      UPDATE public.user_subscriptions
      SET status = 'active', starts_at = COALESCE(starts_at, now()),
          expires_at = CASE WHEN expires_at IS NULL OR expires_at <= now() THEN now() + make_interval(days => v_sub_row.duration_days) ELSE expires_at + make_interval(days => v_sub_row.duration_days) END,
          verified_by = COALESCE(v_caller_uid, verified_by),
          payment_ref = COALESCE(v_effective_payment_id, payment_ref)
      WHERE id = v_sub_row.id;

      IF v_sub_row.listing_id IS NOT NULL THEN
        SELECT l.hub_id INTO v_listing_hub_id FROM public.listings l WHERE l.id = v_sub_row.listing_id;
        IF v_listing_hub_id IS NOT NULL THEN
          IF v_intent.purpose = 'catalogue_pro_subscription' THEN
            INSERT INTO public.listing_shop_profiles (listing_id, hub_id)
            VALUES (v_sub_row.listing_id, v_listing_hub_id)
            ON CONFLICT (listing_id) DO NOTHING;
          ELSE
            INSERT INTO public.listing_restaurant_profiles (listing_id, hub_id)
            VALUES (v_sub_row.listing_id, v_listing_hub_id)
            ON CONFLICT (listing_id) DO NOTHING;
          END IF;
        END IF;
      END IF;
    END IF;

  -- 12. Real Estate 30-Day Verified Property Boost Pass
  ELSIF v_intent.purpose = 'real_estate_boost_30d' THEN
    v_re_listing_id := COALESCE(
      v_intent.real_estate_listing_id,
      NULLIF(v_intent.metadata->>'listing_id', '')::uuid,
      v_intent.reference_id
    );

    IF v_re_listing_id IS NOT NULL THEN
      UPDATE public.listing_real_estate_profiles
      SET
        verified_boost_expires_at = GREATEST(COALESCE(verified_boost_expires_at, now()), now()) + interval '30 days',
        last_confirmed_available_at = now(),
        freshness_expires_at = GREATEST(COALESCE(freshness_expires_at, now()), now() + interval '30 days'),
        updated_at = now()
      WHERE listing_id = v_re_listing_id;
    END IF;

  -- 13. Real Estate Agent Pro Monthly Subscription
  ELSIF v_intent.purpose = 'agent_pro_subscription' THEN
    SELECT us.id, us.listing_id, us.expires_at, COALESCE(sp.duration_days, 30) AS duration_days
      INTO v_sub_row
    FROM public.user_subscriptions us
    LEFT JOIN public.subscription_plans sp ON sp.id = us.plan_id
    WHERE us.id = v_intent.reference_id
    FOR UPDATE OF us;

    IF FOUND THEN
      UPDATE public.user_subscriptions
      SET status = 'active', starts_at = COALESCE(starts_at, now()),
          expires_at = CASE WHEN expires_at IS NULL OR expires_at <= now() THEN now() + make_interval(days => v_sub_row.duration_days) ELSE expires_at + make_interval(days => v_sub_row.duration_days) END,
          verified_by = COALESCE(v_caller_uid, verified_by),
          payment_ref = COALESCE(v_effective_payment_id, payment_ref)
      WHERE id = v_sub_row.id;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'already_fulfilled', false,
    'intent_id', v_intent.id,
    'purpose', v_intent.purpose,
    'reference_id', v_intent.reference_id,
    'payment_intent', to_jsonb(v_intent)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fulfill_payment_intent(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fulfill_payment_intent(uuid, text, text) TO service_role;

-- =============================================================================
-- E. Strict Least-Privilege Row Level Security (RLS) Policies
-- =============================================================================

ALTER TABLE public.listing_real_estate_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.property_visit_requests ENABLE ROW LEVEL SECURITY;

-- E1. listing_real_estate_profiles
DROP POLICY IF EXISTS "Public can view real estate profiles" ON public.listing_real_estate_profiles;
CREATE POLICY "Public can view real estate profiles"
  ON public.listing_real_estate_profiles FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Operators and managers can insert real estate profiles" ON public.listing_real_estate_profiles;
CREATE POLICY "Operators and managers can insert real estate profiles"
  ON public.listing_real_estate_profiles FOR INSERT TO authenticated
  WITH CHECK (
    public.is_real_estate_operator_for(listing_id)
    OR public.is_hub_manager_for(hub_id)
    OR public.is_super_admin()
  );

DROP POLICY IF EXISTS "Operators and managers can update real estate profiles" ON public.listing_real_estate_profiles;
CREATE POLICY "Operators and managers can update real estate profiles"
  ON public.listing_real_estate_profiles FOR UPDATE TO authenticated
  USING (
    public.is_real_estate_operator_for(listing_id)
    OR public.is_hub_manager_for(hub_id)
    OR public.is_super_admin()
  )
  WITH CHECK (
    public.is_real_estate_operator_for(listing_id)
    OR public.is_hub_manager_for(hub_id)
    OR public.is_super_admin()
  );

DROP POLICY IF EXISTS "Operators can delete real estate profiles" ON public.listing_real_estate_profiles;
CREATE POLICY "Operators can delete real estate profiles"
  ON public.listing_real_estate_profiles FOR DELETE TO authenticated
  USING (public.is_real_estate_operator_for(listing_id) OR public.is_super_admin());

-- E2. property_visit_requests
DROP POLICY IF EXISTS "Requesters operators and managers can view property visit requests" ON public.property_visit_requests;
CREATE POLICY "Requesters operators and managers can view property visit requests"
  ON public.property_visit_requests FOR SELECT TO authenticated
  USING (
    requester_id = auth.uid()
    OR public.is_real_estate_operator_for(listing_id)
    OR public.is_hub_manager_for(hub_id)
    OR public.is_super_admin()
  );

DROP POLICY IF EXISTS "Requesters can insert own property visit requests" ON public.property_visit_requests;
CREATE POLICY "Requesters can insert own property visit requests"
  ON public.property_visit_requests FOR INSERT TO authenticated
  WITH CHECK (requester_id = auth.uid());

DROP POLICY IF EXISTS "Requesters and operators can update property visit requests" ON public.property_visit_requests;
CREATE POLICY "Requesters and operators can update property visit requests"
  ON public.property_visit_requests FOR UPDATE TO authenticated
  USING (
    requester_id = auth.uid()
    OR public.is_real_estate_operator_for(listing_id)
    OR public.is_super_admin()
  )
  WITH CHECK (
    requester_id = auth.uid()
    OR public.is_real_estate_operator_for(listing_id)
    OR public.is_super_admin()
  );

-- =============================================================================
-- F. Seed Curated Real Estate Taxonomy, Monetization Plans & 4 Sample Properties
-- =============================================================================

-- F1. Curated Taxonomy
DO $$
DECLARE
  v_re_root_id uuid;
BEGIN
  INSERT INTO public.categories (
    entity_type, parent_id, depth, slug, display_name, icon, color_hex, sort_order, is_active
  ) VALUES (
    'listing', NULL, 0, 'real_estate_properties', 'Real Estate & Properties', 'Home', '#7C3AED', 70, true
  ) ON CONFLICT (entity_type, slug) DO NOTHING;

  SELECT id INTO v_re_root_id
  FROM public.categories
  WHERE entity_type = 'listing' AND slug = 'real_estate_properties'
  LIMIT 1;

  IF v_re_root_id IS NOT NULL THEN
    INSERT INTO public.categories (
      entity_type, parent_id, depth, slug, display_name, icon, color_hex, sort_order, is_active
    ) VALUES
      ('listing', v_re_root_id, 1, 'houses_apartments_rent', 'Houses & Apartments for Rent', 'Home', '#7C3AED', 10, true),
      ('listing', v_re_root_id, 1, 'plots_land_sale', 'Plots & Land for Sale', 'Map', '#7C3AED', 20, true),
      ('listing', v_re_root_id, 1, 'commercial_shops_lease', 'Commercial Shops & Lease', 'Building2', '#7C3AED', 30, true),
      ('listing', v_re_root_id, 1, 'pg_hostel_rooms', 'PG & Hostel Rooms', 'BedDouble', '#7C3AED', 40, true)
    ON CONFLICT (entity_type, slug) DO NOTHING;
  END IF;
END;
$$;

-- F2. Seed Monetization Plans (30-Day Verified Boost Pass & Agent Pro Monthly)
INSERT INTO public.subscription_plans (
  slug, name, price_inr, max_active_bulletins, max_monthly_posts,
  max_images_per_post, allow_youtube, duration_days, is_active, plan_scope, entitlements
) VALUES
  (
    'real_estate_boost_30d',
    '30-Day Verified Property Boost Pass',
    299,
    0,
    0,
    8,
    false,
    30,
    true,
    'real_estate_boost',
    '{"verified_boost_pin":true,"duration_days":30}'::jsonb
  ),
  (
    'agent_pro_monthly',
    'Agent Pro Monthly (Up to 15 Active Listings)',
    799,
    0,
    0,
    10,
    false,
    30,
    true,
    'agent_pro',
    '{"real_estate_pro":true,"max_active_properties":15,"priority_verified_pin":true}'::jsonb
  )
ON CONFLICT (slug) DO NOTHING;

-- F3. Seed 4 Deterministic [SAMPLE] Properties (Churachandpur & Aizawl)
DO $$
DECLARE
  v_ccpur_id uuid;
  v_aizawl_id uuid;
  v_owner_id uuid;
  v_cat_rent_id uuid;
  v_cat_plot_id uuid;
  v_cat_comm_id uuid;
  v_p1 uuid := 'f0000000-0000-4000-8000-00000000e001';
  v_p2 uuid := 'f0000000-0000-4000-8000-00000000e002';
  v_p3 uuid := 'f0000000-0000-4000-8000-00000000e003';
  v_p4 uuid := 'f0000000-0000-4000-8000-00000000e004';
BEGIN
  SELECT id INTO v_ccpur_id FROM public.service_hubs WHERE slug = 'churachandpur' LIMIT 1;
  SELECT id INTO v_aizawl_id FROM public.service_hubs WHERE slug = 'aizawl' LIMIT 1;

  SELECT id INTO v_owner_id
  FROM public.profiles
  WHERE lower(COALESCE(role, '')) IN ('super_admin', 'admin')
  ORDER BY CASE WHEN lower(COALESCE(role, '')) = 'super_admin' THEN 0 ELSE 1 END, created_at ASC
  LIMIT 1;

  IF v_owner_id IS NULL THEN
    SELECT id INTO v_owner_id FROM public.profiles ORDER BY created_at ASC LIMIT 1;
  END IF;

  SELECT id INTO v_cat_rent_id FROM public.categories WHERE entity_type = 'listing' AND slug = 'houses_apartments_rent' LIMIT 1;
  SELECT id INTO v_cat_plot_id FROM public.categories WHERE entity_type = 'listing' AND slug = 'plots_land_sale' LIMIT 1;
  SELECT id INTO v_cat_comm_id FROM public.categories WHERE entity_type = 'listing' AND slug = 'commercial_shops_lease' LIMIT 1;

  IF v_ccpur_id IS NOT NULL AND v_owner_id IS NOT NULL THEN
    -- 1. [SAMPLE] 2 BHK Family House near Tuibong Main Road
    INSERT INTO public.listings (
      id, owner_id, owner_name, title, category, subcategory, category_id, status,
      locality, address, short_description, description, price,
      contact_phone, phone, cover_image, gallery_images,
      coordinates, lat, lng, rating, review_count, hub_id,
      listing_vertical, is_civic_record
    ) VALUES (
      v_p1, v_owner_id, 'Tuibong Homeowner',
      '[SAMPLE] 2 BHK Family House near Tuibong Main Road',
      'real_estate', 'Houses & Apartments for Rent', v_cat_rent_id, 'published',
      'Tuibong', 'Near Tuibong Main Road, Churachandpur 795128',
      'Bright 2 BHK family residence with 24x7 water supply, car-accessible lane, and dedicated parking.',
      'Well-ventilated 2 BHK independent ground-floor house 150m off Tuibong Main Road. Features 24x7 overhead tank water supply, inverter power backup, car parking, and peaceful residential neighborhood.',
      11000, '+91 98620 77101', '+91 98620 77101',
      'https://picsum.photos/seed/ddoodle-re-tuibong-2bhk/960/640', '[]'::jsonb,
      '{"lat":24.3452,"lng":93.6958}'::jsonb, 24.3452, 93.6958, 4.8, 7,
      v_ccpur_id, 'real_estate', false
    ) ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.listing_real_estate_profiles (
      listing_id, hub_id, deal_type, property_type, price_inr, price_period,
      deposit_inr, is_negotiable, bedrooms, bathrooms, area_sqft, land_area_text,
      furnishing, patta_status, water_supply, road_access, power_backup,
      parking_available, listed_by_role, show_exact_pin, contact_reveal_policy,
      patta_verified, site_verified, verified_boost_expires_at,
      availability_status, last_confirmed_available_at, freshness_expires_at
    ) VALUES (
      v_p1, v_ccpur_id, 'rent', 'house', 11000, 'monthly',
      15000, true, 2, 2, 1050, '1,050 sq.ft',
      'semi_furnished', 'not_applicable', '24x7', 'car_accessible', true,
      true, 'owner', false, 'after_visit_accept',
      false, true, now() + interval '30 days',
      'available', now(), now() + interval '30 days'
    ) ON CONFLICT (listing_id) DO NOTHING;

    -- 2. [SAMPLE] Clear Patta Residential Plot — Lamka Hill View
    INSERT INTO public.listings (
      id, owner_id, owner_name, title, category, subcategory, category_id, status,
      locality, address, short_description, description, price,
      contact_phone, phone, cover_image, gallery_images,
      coordinates, lat, lng, rating, review_count, hub_id,
      listing_vertical, is_civic_record
    ) VALUES (
      v_p2, v_owner_id, 'Lamka Land Trust',
      '[SAMPLE] Clear Patta Residential Plot — Lamka Hill View',
      'real_estate', 'Plots & Land for Sale', v_cat_plot_id, 'published',
      'New Lamka', 'Hill View Lane, New Lamka, Churachandpur 795128',
      'Clear Patta 40x60 ft residential plot with car-accessible approach road and gentle hill view.',
      'Ready-to-build 40 x 60 ft residential land parcel in New Lamka with Hub-verified Clear Patta documentation, blacktopped car-accessible road frontage, and municipal water line nearby.',
      2850000, '+91 98620 77102', '+91 98620 77102',
      'https://picsum.photos/seed/ddoodle-re-lamka-plot/960/640', '[]'::jsonb,
      '{"lat":24.3296,"lng":93.6761}'::jsonb, 24.3296, 93.6761, 4.9, 5,
      v_ccpur_id, 'real_estate', false
    ) ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.listing_real_estate_profiles (
      listing_id, hub_id, deal_type, property_type, price_inr, price_period,
      deposit_inr, is_negotiable, bedrooms, bathrooms, area_sqft, land_area_text,
      furnishing, patta_status, water_supply, road_access, power_backup,
      parking_available, listed_by_role, show_exact_pin, contact_reveal_policy,
      patta_verified, site_verified, verified_boost_expires_at,
      availability_status, last_confirmed_available_at, freshness_expires_at
    ) VALUES (
      v_p2, v_ccpur_id, 'sale', 'plot_land', 2850000, 'total',
      NULL, true, NULL, NULL, 2400, '40 x 60 ft',
      'not_applicable', 'verified_patta', 'municipal', 'car_accessible', false,
      true, 'owner', false, 'after_visit_accept',
      true, true, NULL,
      'available', now(), now() + interval '30 days'
    ) ON CONFLICT (listing_id) DO NOTHING;
  END IF;

  IF v_aizawl_id IS NOT NULL AND v_owner_id IS NOT NULL THEN
    -- 3. [SAMPLE] Ground Floor Commercial Shop — Dawrpui Market
    INSERT INTO public.listings (
      id, owner_id, owner_name, title, category, subcategory, category_id, status,
      locality, address, short_description, description, price,
      contact_phone, phone, cover_image, gallery_images,
      coordinates, lat, lng, rating, review_count, hub_id,
      listing_vertical, is_civic_record
    ) VALUES (
      v_p3, v_owner_id, 'Dawrpui Commercial Estates',
      '[SAMPLE] Ground Floor Commercial Shop — Dawrpui Market',
      'real_estate', 'Commercial Shops & Lease', v_cat_comm_id, 'published',
      'Dawrpui', 'Bara Bazar Main Street, Dawrpui, Aizawl 796001',
      'High-footfall 380 sq.ft ground-floor retail shop on Dawrpui Main Street with shutter & power backup.',
      'Prime ground-floor commercial shop space suitable for pharmacy, boutique, café counter, or electronics showroom in busy Dawrpui Market. Site verified by Hub Manager.',
      18000, '+91 98630 88201', '+91 98630 88201',
      'https://picsum.photos/seed/ddoodle-re-dawrpui-shop/960/640', '[]'::jsonb,
      '{"lat":23.7285,"lng":92.7191}'::jsonb, 23.7285, 92.7191, 4.7, 9,
      v_aizawl_id, 'real_estate', false
    ) ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.listing_real_estate_profiles (
      listing_id, hub_id, deal_type, property_type, price_inr, price_period,
      deposit_inr, is_negotiable, bedrooms, bathrooms, area_sqft, land_area_text,
      furnishing, patta_status, water_supply, road_access, power_backup,
      parking_available, listed_by_role, show_exact_pin, contact_reveal_policy,
      patta_verified, site_verified, verified_boost_expires_at,
      availability_status, last_confirmed_available_at, freshness_expires_at
    ) VALUES (
      v_p3, v_aizawl_id, 'lease', 'commercial_shop', 18000, 'monthly',
      36000, true, NULL, 1, 380, '380 sq.ft',
      'unfurnished', 'leasehold', 'municipal', 'car_accessible', true,
      false, 'agent', true, 'direct_call',
      false, true, NULL,
      'available', now(), now() + interval '30 days'
    ) ON CONFLICT (listing_id) DO NOTHING;

    -- 4. [SAMPLE] Semi-Furnished 1 BHK Flat — Khatla
    INSERT INTO public.listings (
      id, owner_id, owner_name, title, category, subcategory, category_id, status,
      locality, address, short_description, description, price,
      contact_phone, phone, cover_image, gallery_images,
      coordinates, lat, lng, rating, review_count, hub_id,
      listing_vertical, is_civic_record
    ) VALUES (
      v_p4, v_owner_id, 'Khatla Residency',
      '[SAMPLE] Semi-Furnished 1 BHK Flat — Khatla',
      'real_estate', 'Houses & Apartments for Rent', v_cat_rent_id, 'published',
      'Khatla', 'Secretariat Link Lane, Khatla, Aizawl 796001',
      'Cozy semi-furnished 1 BHK flat with 24x7 water supply, wardrobes, and quiet two-wheeler lane.',
      'Ideal for working professionals or couples near New Secretariat, Khatla. Includes 24x7 water storage, modular kitchen counter, and clean balcony views.',
      9500, '+91 98630 88202', '+91 98630 88202',
      'https://picsum.photos/seed/ddoodle-re-khatla-1bhk/960/640', '[]'::jsonb,
      '{"lat":23.7212,"lng":92.7134}'::jsonb, 23.7212, 92.7134, 4.6, 6,
      v_aizawl_id, 'real_estate', false
    ) ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.listing_real_estate_profiles (
      listing_id, hub_id, deal_type, property_type, price_inr, price_period,
      deposit_inr, is_negotiable, bedrooms, bathrooms, area_sqft, land_area_text,
      furnishing, patta_status, water_supply, road_access, power_backup,
      parking_available, listed_by_role, show_exact_pin, contact_reveal_policy,
      patta_verified, site_verified, verified_boost_expires_at,
      availability_status, last_confirmed_available_at, freshness_expires_at
    ) VALUES (
      v_p4, v_aizawl_id, 'rent', 'apartment', 9500, 'monthly',
      10000, true, 1, 1, 560, '560 sq.ft',
      'semi_furnished', 'not_applicable', '24x7', 'two_wheeler_only', false,
      false, 'owner', false, 'after_visit_accept',
      false, false, NULL,
      'available', now(), now() + interval '30 days'
    ) ON CONFLICT (listing_id) DO NOTHING;
  END IF;
END;
$$;
