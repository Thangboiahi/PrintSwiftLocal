-- =============================================================================
-- DD oodle — PHASE 73-A: Universal Booking Engine & Hotels/Homestays Schema,
-- Atomic Overlap Locks, Check-In OTP Settlement Unlock & Curated Taxonomy
-- 100% Idempotent (Safe to run repeatedly in Supabase SQL Editor)
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- Shared updated_at trigger helper
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_phase73a_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- =============================================================================
-- A. Three New Isolated Vertical Tables
-- =============================================================================

-- -----------------------------------------------------------------------------
-- A1. public.listing_hotel_profiles (1-to-1 hospitality metadata for hotel_stay)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.listing_hotel_profiles (
  listing_id uuid PRIMARY KEY REFERENCES public.listings(id) ON DELETE CASCADE,
  hub_id uuid NOT NULL REFERENCES public.service_hubs(id) ON DELETE CASCADE,
  stay_type text NOT NULL DEFAULT 'hotel'
    CHECK (stay_type IN ('hotel', 'homestay', 'guest_house', 'lodge', 'resort', 'pg_hostel')),
  check_in_time text NOT NULL DEFAULT '12:00 PM',
  check_out_time text NOT NULL DEFAULT '11:00 AM',
  amenities jsonb NOT NULL DEFAULT '{"wifi":false,"parking":false,"hot_water":false,"power_backup":false,"ac":false,"heater":false,"in_house_kitchen":false,"early_checkin":false}'::jsonb,
  verified_amenities jsonb NOT NULL DEFAULT '{}'::jsonb,
  house_rules text,
  cancellation_policy text NOT NULL DEFAULT 'Free cancellation up to 24 hours before check-in.',
  id_requirement_note text NOT NULL DEFAULT 'Valid government photo ID is verified at reception upon check-in.',
  is_accepting_bookings boolean NOT NULL DEFAULT true,
  payment_policy jsonb NOT NULL DEFAULT '{"allow_direct_pay":false,"advance_percent":30,"allow_full_prepay":true,"shop_upi_id":null,"shop_upi_name":null,"shop_upi_verified":false}'::jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listing_hotel_profiles_hub_active
  ON public.listing_hotel_profiles (hub_id, is_accepting_bookings, stay_type);

DROP TRIGGER IF EXISTS trg_listing_hotel_profiles_updated_at ON public.listing_hotel_profiles;
CREATE TRIGGER trg_listing_hotel_profiles_updated_at
  BEFORE UPDATE ON public.listing_hotel_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.set_phase73a_updated_at();

-- Auto-sync hub_id from parent listing & guard verified_amenities to Hub Managers / Super-Admin
CREATE OR REPLACE FUNCTION public.guard_listing_hotel_profile_writes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent_hub_id uuid;
  v_is_privileged boolean;
BEGIN
  SELECT l.hub_id
    INTO v_parent_hub_id
  FROM public.listings l
  WHERE l.id = NEW.listing_id;

  IF v_parent_hub_id IS NOT NULL THEN
    NEW.hub_id := v_parent_hub_id;
  END IF;

  v_is_privileged :=
    current_setting('role', true) = 'service_role'
    OR public.is_super_admin()
    OR public.is_hub_manager_for(NEW.hub_id);

  IF NOT v_is_privileged THEN
    IF TG_OP = 'INSERT' THEN
      NEW.verified_amenities := '{}'::jsonb;
      IF NEW.payment_policy IS NOT NULL THEN
        NEW.payment_policy := NEW.payment_policy || '{"shop_upi_verified":false}'::jsonb;
      END IF;
    ELSIF TG_OP = 'UPDATE' THEN
      IF NEW.verified_amenities IS DISTINCT FROM OLD.verified_amenities THEN
        RAISE EXCEPTION 'Forbidden: Only Hub Managers or Super-Admin may update verified_amenities.'
          USING ERRCODE = '42501';
      END IF;
      IF COALESCE(NEW.payment_policy->>'shop_upi_verified', 'false')
         IS DISTINCT FROM COALESCE(OLD.payment_policy->>'shop_upi_verified', 'false') THEN
        NEW.payment_policy := COALESCE(NEW.payment_policy, '{}'::jsonb) ||
          jsonb_build_object(
            'shop_upi_verified',
            COALESCE((OLD.payment_policy->>'shop_upi_verified')::boolean, false)
          );
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_listing_hotel_profile_writes ON public.listing_hotel_profiles;
CREATE TRIGGER trg_guard_listing_hotel_profile_writes
  BEFORE INSERT OR UPDATE ON public.listing_hotel_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_listing_hotel_profile_writes();

-- -----------------------------------------------------------------------------
-- A2. public.listing_booking_resources (Turfs, Halls, Studios, Hotel Rooms)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.listing_booking_resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  hub_id uuid NOT NULL REFERENCES public.service_hubs(id) ON DELETE CASCADE,
  resource_vertical text NOT NULL
    CHECK (resource_vertical IN ('booking_venue', 'hotel_stay')),
  name text NOT NULL,
  description text,
  booking_unit text NOT NULL
    CHECK (booking_unit IN ('hourly', 'slot', 'half_day', 'full_day', 'weekly', 'nightly')),
  slot_duration_mins integer NOT NULL DEFAULT 60 CHECK (slot_duration_mins >= 15),
  open_hour integer NOT NULL DEFAULT 6 CHECK (open_hour BETWEEN 0 AND 23),
  close_hour integer NOT NULL DEFAULT 22 CHECK (close_hour BETWEEN 1 AND 24),
  total_units integer NOT NULL DEFAULT 1 CHECK (total_units >= 1),
  max_guests integer NOT NULL DEFAULT 2 CHECK (max_guests >= 1),
  base_rate_inr numeric(10,2) NOT NULL CHECK (base_rate_inr >= 0),
  peak_rate_inr numeric(10,2) CHECK (peak_rate_inr IS NULL OR peak_rate_inr >= 0),
  peak_start_hour integer CHECK (peak_start_hour IS NULL OR peak_start_hour BETWEEN 0 AND 23),
  advance_percent integer NOT NULL DEFAULT 30 CHECK (advance_percent BETWEEN 0 AND 100),
  addons jsonb NOT NULL DEFAULT '[]'::jsonb,
  photos jsonb NOT NULL DEFAULT '[]'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listing_booking_resources_listing_active
  ON public.listing_booking_resources (listing_id, is_active, sort_order);

CREATE INDEX IF NOT EXISTS idx_listing_booking_resources_hub_vertical
  ON public.listing_booking_resources (hub_id, resource_vertical, is_active);

DROP TRIGGER IF EXISTS trg_listing_booking_resources_updated_at ON public.listing_booking_resources;
CREATE TRIGGER trg_listing_booking_resources_updated_at
  BEFORE UPDATE ON public.listing_booking_resources
  FOR EACH ROW
  EXECUTE FUNCTION public.set_phase73a_updated_at();

-- Keep resource.hub_id aligned with parent listing
CREATE OR REPLACE FUNCTION public.sync_booking_resource_hub_id()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent_hub_id uuid;
BEGIN
  SELECT l.hub_id
    INTO v_parent_hub_id
  FROM public.listings l
  WHERE l.id = NEW.listing_id;

  IF v_parent_hub_id IS NOT NULL THEN
    NEW.hub_id := v_parent_hub_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_booking_resource_hub_id ON public.listing_booking_resources;
CREATE TRIGGER trg_sync_booking_resource_hub_id
  BEFORE INSERT OR UPDATE OF listing_id, hub_id ON public.listing_booking_resources
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_booking_resource_hub_id();

-- -----------------------------------------------------------------------------
-- Auto-Sync Trigger: sync_booking_vertical_summary
-- Refreshes listings.listing_vertical & listings.vertical_summary on changes to
-- listing_booking_resources or listing_hotel_profiles.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.refresh_listing_booking_vertical_summary(p_listing_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_hotel public.listing_hotel_profiles%ROWTYPE;
  v_has_hotel boolean := false;
  v_resource_count integer := 0;
  v_min_rate numeric(10,2);
  v_primary_unit text;
  v_primary_vertical text;
  v_top_amenities jsonb := '[]'::jsonb;
  v_is_accepting boolean := true;
  v_target_vertical text;
  v_summary jsonb;
BEGIN
  IF p_listing_id IS NULL THEN
    RETURN;
  END IF;

  SELECT *
    INTO v_hotel
  FROM public.listing_hotel_profiles
  WHERE listing_id = p_listing_id;
  v_has_hotel := FOUND;

  SELECT
    COUNT(*)::integer,
    MIN(base_rate_inr)
    INTO v_resource_count, v_min_rate
  FROM public.listing_booking_resources
  WHERE listing_id = p_listing_id
    AND is_active = true;

  SELECT r.booking_unit, r.resource_vertical
    INTO v_primary_unit, v_primary_vertical
  FROM public.listing_booking_resources r
  WHERE r.listing_id = p_listing_id
    AND r.is_active = true
  ORDER BY r.sort_order ASC, r.base_rate_inr ASC, r.created_at ASC
  LIMIT 1;

  IF v_has_hotel THEN
    v_target_vertical := 'hotel_stay';
    v_is_accepting := COALESCE(v_hotel.is_accepting_bookings, true);

    SELECT COALESCE(jsonb_agg(k), '[]'::jsonb)
      INTO v_top_amenities
    FROM (
      SELECT key AS k
      FROM jsonb_each_text(
        CASE
          WHEN jsonb_typeof(v_hotel.verified_amenities) = 'object'
               AND v_hotel.verified_amenities <> '{}'::jsonb
            THEN v_hotel.verified_amenities
          ELSE COALESCE(v_hotel.amenities, '{}'::jsonb)
        END
      )
      WHERE lower(value) = 'true'
      ORDER BY key ASC
      LIMIT 4
    ) sub;
  ELSIF v_primary_vertical IS NOT NULL THEN
    v_target_vertical := v_primary_vertical;
    v_is_accepting := (v_resource_count > 0);
  ELSE
    -- No hotel profile and no active resources remaining; preserve existing vertical if non-booking
    RETURN;
  END IF;

  v_summary := jsonb_build_object(
    'resource_count', COALESCE(v_resource_count, 0),
    'min_rate_inr', v_min_rate,
    'primary_unit', COALESCE(v_primary_unit, CASE WHEN v_target_vertical = 'hotel_stay' THEN 'nightly' ELSE 'hourly' END),
    'is_accepting_bookings', v_is_accepting,
    'top_amenities', COALESCE(v_top_amenities, '[]'::jsonb),
    'stay_type', CASE WHEN v_has_hotel THEN v_hotel.stay_type ELSE NULL END
  );

  UPDATE public.listings
  SET
    listing_vertical = v_target_vertical,
    vertical_summary = COALESCE(vertical_summary, '{}'::jsonb) || v_summary,
    updated_at = now()
  WHERE id = p_listing_id
    AND COALESCE(is_civic_record, false) = false;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_booking_vertical_summary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_listing_booking_vertical_summary(OLD.listing_id);
    RETURN OLD;
  ELSE
    PERFORM public.refresh_listing_booking_vertical_summary(NEW.listing_id);
    IF TG_OP = 'UPDATE' AND OLD.listing_id IS DISTINCT FROM NEW.listing_id THEN
      PERFORM public.refresh_listing_booking_vertical_summary(OLD.listing_id);
    END IF;
    RETURN NEW;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_booking_summary_from_resources ON public.listing_booking_resources;
CREATE TRIGGER trg_sync_booking_summary_from_resources
  AFTER INSERT OR UPDATE OR DELETE ON public.listing_booking_resources
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_booking_vertical_summary();

DROP TRIGGER IF EXISTS trg_sync_booking_summary_from_hotel_profile ON public.listing_hotel_profiles;
CREATE TRIGGER trg_sync_booking_summary_from_hotel_profile
  AFTER INSERT OR UPDATE OR DELETE ON public.listing_hotel_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_booking_vertical_summary();

-- -----------------------------------------------------------------------------
-- A3. public.resource_bookings (Customer Bookings + Walk-In Manual Blocks)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.resource_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_code text UNIQUE NOT NULL,
  hub_id uuid NOT NULL REFERENCES public.service_hubs(id),
  listing_id uuid NOT NULL REFERENCES public.listings(id) ON DELETE RESTRICT,
  resource_id uuid NOT NULL REFERENCES public.listing_booking_resources(id) ON DELETE RESTRICT,
  customer_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  booking_source text NOT NULL DEFAULT 'online'
    CHECK (booking_source IN ('online', 'walk_in_block')),
  guest_name text NOT NULL,
  guest_phone text,
  start_at timestamptz NOT NULL,
  end_at timestamptz NOT NULL,
  units_booked integer NOT NULL DEFAULT 1 CHECK (units_booked >= 1),
  guests_count integer NOT NULL DEFAULT 1 CHECK (guests_count >= 1),
  selected_addons jsonb NOT NULL DEFAULT '[]'::jsonb,
  price_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  total_amount_inr numeric(10,2) NOT NULL DEFAULT 0,
  advance_amount_inr numeric(10,2) NOT NULL DEFAULT 0,
  balance_at_venue_inr numeric(10,2) NOT NULL DEFAULT 0,
  convenience_fee_inr numeric(10,2) NOT NULL DEFAULT 0,
  payment_rail text NOT NULL DEFAULT 'platform_escrow'
    CHECK (payment_rail IN ('direct_counter', 'direct_shop_upi', 'platform_escrow', 'walk_in_manual')),
  payment_intent_id uuid REFERENCES public.payment_intents(id) ON DELETE SET NULL,
  checkin_otp_hash text,
  checkin_otp_display_for_customer text,
  booking_status text NOT NULL DEFAULT 'pending_payment'
    CHECK (booking_status IN ('pending_payment', 'confirmed', 'checked_in', 'completed', 'cancelled', 'no_show', 'blocked')),
  payment_status text NOT NULL DEFAULT 'unpaid'
    CHECK (payment_status IN ('unpaid', 'pending_manual_review', 'advance_escrow_held', 'fully_prepaid_escrow', 'paid_direct_confirmed', 'refunded', 'not_applicable')),
  settlement_status text NOT NULL DEFAULT 'not_applicable'
    CHECK (settlement_status IN ('not_applicable', 'locked', 'eligible', 'settled', 'reversed')),
  checked_in_at timestamptz,
  cancelled_at timestamptz,
  notes text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CONSTRAINT resource_bookings_time_order_check CHECK (end_at > start_at)
);

CREATE INDEX IF NOT EXISTS idx_resource_bookings_overlap_active
  ON public.resource_bookings (resource_id, start_at, end_at)
  WHERE booking_status IN ('pending_payment', 'confirmed', 'checked_in', 'blocked');

CREATE INDEX IF NOT EXISTS idx_resource_bookings_listing_start
  ON public.resource_bookings (listing_id, start_at DESC);

CREATE INDEX IF NOT EXISTS idx_resource_bookings_customer_created
  ON public.resource_bookings (customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_resource_bookings_hub_status
  ON public.resource_bookings (hub_id, booking_status);

DROP TRIGGER IF EXISTS trg_resource_bookings_updated_at ON public.resource_bookings;
CREATE TRIGGER trg_resource_bookings_updated_at
  BEFORE UPDATE ON public.resource_bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.set_phase73a_updated_at();

-- =============================================================================
-- B. Safe Interlink Alterations to Existing Tables
-- =============================================================================

-- B1. public.payment_intents: add resource_booking_id & expand purpose CHECK
ALTER TABLE public.payment_intents
  ADD COLUMN IF NOT EXISTS resource_booking_id uuid REFERENCES public.resource_bookings(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_payment_intents_resource_booking
  ON public.payment_intents (resource_booking_id)
  WHERE resource_booking_id IS NOT NULL;

DO $$
DECLARE
  v_con record;
BEGIN
  FOR v_con IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'payment_intents'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ~* '\bpurpose\b'
  LOOP
    EXECUTE format('ALTER TABLE public.payment_intents DROP CONSTRAINT IF EXISTS %I', v_con.conname);
  END LOOP;
END;
$$;

ALTER TABLE public.payment_intents
  ADD CONSTRAINT payment_intents_purpose_check
  CHECK (
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
      'stay_pro_subscription'
    )
  );

-- Extend payment_intents user-update guard to also protect resource_booking_id
CREATE OR REPLACE FUNCTION public.guard_payment_intent_user_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('role', true) = 'service_role'
     OR public.is_super_admin()
     OR public.can_confirm_hub_payment(OLD.hub_id) THEN
    RETURN NEW;
  END IF;

  IF OLD.status <> 'awaiting_payment' THEN
    RAISE EXCEPTION 'Payment intent can only be updated while awaiting payment.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.intent_code IS DISTINCT FROM OLD.intent_code
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.hub_id IS DISTINCT FROM OLD.hub_id
     OR NEW.purpose IS DISTINCT FROM OLD.purpose
     OR NEW.reference_id IS DISTINCT FROM OLD.reference_id
     OR NEW.print_order_id IS DISTINCT FROM OLD.print_order_id
     OR NEW.resource_booking_id IS DISTINCT FROM OLD.resource_booking_id
     OR NEW.amount_inr IS DISTINCT FROM OLD.amount_inr
     OR NEW.base_amount_inr IS DISTINCT FROM OLD.base_amount_inr
     OR NEW.discount_inr IS DISTINCT FROM OLD.discount_inr
     OR NEW.convenience_fee_inr IS DISTINCT FROM OLD.convenience_fee_inr
     OR NEW.promo_code_id IS DISTINCT FROM OLD.promo_code_id
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.provider_order_id IS DISTINCT FROM OLD.provider_order_id
     OR NEW.provider_payment_id IS DISTINCT FROM OLD.provider_payment_id
     OR NEW.verified_by IS DISTINCT FROM OLD.verified_by
     OR NEW.refund_utr_ref IS DISTINCT FROM OLD.refund_utr_ref
     OR NEW.refund_notes IS DISTINCT FROM OLD.refund_notes THEN
    RAISE EXCEPTION 'Unauthorized modification of protected payment intent fields.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.status NOT IN ('awaiting_payment', 'pending_manual') THEN
    RAISE EXCEPTION 'Users may only submit manual UTR proof (pending_manual).'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

-- B2. public.merchant_settlements: unify escrow ledger across Print, Bookings & Hotels
ALTER TABLE public.merchant_settlements
  ALTER COLUMN print_order_id DROP NOT NULL;

ALTER TABLE public.merchant_settlements
  ADD COLUMN IF NOT EXISTS resource_booking_id uuid UNIQUE REFERENCES public.resource_bookings(id) ON DELETE RESTRICT,
  ADD COLUMN IF NOT EXISTS settlement_source text NOT NULL DEFAULT 'print_order';

CREATE INDEX IF NOT EXISTS idx_merchant_settlements_resource_booking
  ON public.merchant_settlements (resource_booking_id)
  WHERE resource_booking_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_merchant_settlements_source_status
  ON public.merchant_settlements (settlement_source, status, created_at DESC);

-- B3. public.service_hubs: backfill module_switches for booking_venues & hotel_stays
UPDATE public.service_hubs
SET module_switches = COALESCE(module_switches, '{}'::jsonb) || '{"booking_venues": true}'::jsonb
WHERE NOT (COALESCE(module_switches, '{}'::jsonb) ? 'booking_venues');

UPDATE public.service_hubs
SET module_switches = COALESCE(module_switches, '{}'::jsonb) || '{"hotel_stays": true}'::jsonb
WHERE NOT (COALESCE(module_switches, '{}'::jsonb) ? 'hotel_stays');

-- =============================================================================
-- C. Atomic Concurrency-Safe Booking & Check-In RPCs (SECURITY DEFINER)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- C1. has_active_booking_entitlement(p_listing_id uuid, p_vertical text)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_active_booking_entitlement(
  p_listing_id uuid,
  p_vertical text DEFAULT 'booking_venue'
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p_listing_id IS NOT NULL
    AND (
      -- 1. Super-Admin owned official/demo listings are entitled
      EXISTS (
        SELECT 1
        FROM public.listings l
        JOIN public.profiles p ON p.id = l.owner_id
        WHERE l.id = p_listing_id
          AND lower(COALESCE(p.role, '')) = 'super_admin'
      )
      -- 2. Active listing-bound or owner-bound Booking Pro / Stay Pro / Merchant All-In-One subscription
      OR EXISTS (
        SELECT 1
        FROM public.user_subscriptions us
        JOIN public.subscription_plans sp ON sp.id = us.plan_id
        LEFT JOIN public.listings l ON l.id = p_listing_id
        WHERE us.status = 'active'
          AND us.expires_at > now()
          AND sp.plan_scope IN ('booking_pro', 'stay_pro', 'merchant_all_in_one', 'merchant_bundle')
          AND (
            (COALESCE(p_vertical, 'booking_venue') = 'booking_venue'
              AND COALESCE(sp.entitlements->>'booking_engine', 'false') = 'true')
            OR (COALESCE(p_vertical, 'booking_venue') = 'hotel_stay'
              AND COALESCE(sp.entitlements->>'hotel_stays', 'false') = 'true')
            OR sp.plan_scope = 'merchant_all_in_one'
          )
          AND (
            us.listing_id = p_listing_id
            OR (us.listing_id IS NULL AND l.owner_id IS NOT NULL AND us.user_id = l.owner_id)
          )
      )
    );
$$;

GRANT EXECUTE ON FUNCTION public.has_active_booking_entitlement(uuid, text)
  TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- C2. is_booking_operator_for(p_listing_id uuid)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_booking_operator_for(p_listing_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND p_listing_id IS NOT NULL
    AND (
      public.is_super_admin()
      OR EXISTS (
        SELECT 1
        FROM public.listings l
        WHERE l.id = p_listing_id
          AND l.owner_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1
        FROM public.staff_delegations sd
        WHERE sd.staff_id = auth.uid()
          AND COALESCE(sd.status, 'active') = 'active'
          AND (
            sd.listing_id = p_listing_id
            OR (
              jsonb_typeof(sd.assigned_listing_ids) = 'array'
              AND sd.assigned_listing_ids ? p_listing_id::text
            )
          )
      )
    );
$$;

GRANT EXECUTE ON FUNCTION public.is_booking_operator_for(uuid)
  TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- C3. create_atomic_resource_booking(...)
--     Locks listing_booking_resources row FOR UPDATE to serialize concurrent
--     slot/room bookings and guarantee zero double-bookings or overbookings.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.create_atomic_resource_booking(
  p_resource_id uuid,
  p_start_at timestamptz,
  p_end_at timestamptz,
  p_units_booked integer DEFAULT 1,
  p_guests_count integer DEFAULT 1,
  p_guest_name text DEFAULT 'Guest',
  p_guest_phone text DEFAULT NULL,
  p_customer_id uuid DEFAULT NULL,
  p_booking_source text DEFAULT 'online',
  p_selected_addons jsonb DEFAULT '[]'::jsonb,
  p_price_snapshot jsonb DEFAULT '{}'::jsonb,
  p_total_amount_inr numeric(10,2) DEFAULT 0,
  p_advance_amount_inr numeric(10,2) DEFAULT 0,
  p_balance_at_venue_inr numeric(10,2) DEFAULT 0,
  p_convenience_fee_inr numeric(10,2) DEFAULT 0,
  p_payment_rail text DEFAULT 'platform_escrow',
  p_booking_status text DEFAULT 'pending_payment',
  p_payment_status text DEFAULT 'unpaid',
  p_checkin_otp_hash text DEFAULT NULL,
  p_checkin_otp_display text DEFAULT NULL,
  p_notes text DEFAULT NULL,
  p_booking_code text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_uid uuid := auth.uid();
  v_is_service boolean := (current_setting('role', true) = 'service_role');
  v_resource public.listing_booking_resources%ROWTYPE;
  v_already_booked integer := 0;
  v_units integer := GREATEST(1, COALESCE(p_units_booked, 1));
  v_guests integer := GREATEST(1, COALESCE(p_guests_count, 1));
  v_code text;
  v_effective_customer_id uuid;
  v_effective_source text := COALESCE(NULLIF(trim(p_booking_source), ''), 'online');
  v_effective_booking_status text := COALESCE(NULLIF(trim(p_booking_status), ''), 'pending_payment');
  v_effective_payment_status text := COALESCE(NULLIF(trim(p_payment_status), ''), 'unpaid');
  v_effective_rail text := COALESCE(NULLIF(trim(p_payment_rail), ''), 'platform_escrow');
  v_inserted public.resource_bookings%ROWTYPE;
BEGIN
  IF p_start_at IS NULL OR p_end_at IS NULL OR p_end_at <= p_start_at THEN
    RAISE EXCEPTION 'Invalid booking time window: end_at must be strictly after start_at.'
      USING ERRCODE = '22023';
  END IF;

  -- Lock the exact turf/hall/room-type row to serialize concurrent availability checks
  SELECT *
    INTO v_resource
  FROM public.listing_booking_resources
  WHERE id = p_resource_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking resource not found.'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_resource.is_active = false AND v_effective_source = 'online' THEN
    RAISE EXCEPTION 'This resource is currently unavailable for online bookings.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Authorization check for manual walk-in blocks
  IF v_effective_source = 'walk_in_block' THEN
    IF NOT v_is_service AND NOT public.is_booking_operator_for(v_resource.listing_id) THEN
      RAISE EXCEPTION 'Forbidden: Only authorized venue/hotel operators may create walk-in blocks.'
        USING ERRCODE = '42501';
    END IF;
    v_effective_booking_status := 'blocked';
    v_effective_payment_status := 'not_applicable';
    v_effective_rail := 'walk_in_manual';
    v_effective_customer_id := NULL;
  ELSE
    IF NOT v_is_service AND v_caller_uid IS NULL THEN
      RAISE EXCEPTION 'Authentication required to create a booking.'
        USING ERRCODE = '42501';
    END IF;
    v_effective_customer_id := COALESCE(p_customer_id, v_caller_uid);
    IF NOT v_is_service AND v_effective_customer_id IS DISTINCT FROM v_caller_uid THEN
      RAISE EXCEPTION 'Forbidden: Cannot create an online booking on behalf of another user.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  -- Sum overlapping active reservations (confirmed/checked_in/blocked OR fresh <15min payment holds)
  SELECT COALESCE(SUM(rb.units_booked), 0)::integer
    INTO v_already_booked
  FROM public.resource_bookings rb
  WHERE rb.resource_id = v_resource.id
    AND rb.start_at < p_end_at
    AND rb.end_at > p_start_at
    AND (
      rb.booking_status IN ('confirmed', 'checked_in', 'blocked')
      OR (
        rb.booking_status = 'pending_payment'
        AND rb.created_at > now() - interval '15 minutes'
      )
    );

  IF (v_already_booked + v_units) > v_resource.total_units THEN
    RAISE EXCEPTION 'Selected time slot or room dates are no longer available'
      USING ERRCODE = 'P0001';
  END IF;

  v_code := COALESCE(
    NULLIF(trim(COALESCE(p_booking_code, '')), ''),
    'DDB-' || to_char(now(), 'YYMM') || '-' || lpad((floor(random() * 9000 + 1000))::int::text, 4, '0')
  );

  -- Ensure unique booking code in rare collision case
  IF EXISTS (SELECT 1 FROM public.resource_bookings WHERE booking_code = v_code) THEN
    v_code := 'DDB-' || to_char(now(), 'YYMM') || '-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 6));
  END IF;

  INSERT INTO public.resource_bookings (
    booking_code,
    hub_id,
    listing_id,
    resource_id,
    customer_id,
    booking_source,
    guest_name,
    guest_phone,
    start_at,
    end_at,
    units_booked,
    guests_count,
    selected_addons,
    price_snapshot,
    total_amount_inr,
    advance_amount_inr,
    balance_at_venue_inr,
    convenience_fee_inr,
    payment_rail,
    checkin_otp_hash,
    checkin_otp_display_for_customer,
    booking_status,
    payment_status,
    settlement_status,
    notes
  )
  VALUES (
    v_code,
    v_resource.hub_id,
    v_resource.listing_id,
    v_resource.id,
    v_effective_customer_id,
    v_effective_source,
    COALESCE(NULLIF(trim(COALESCE(p_guest_name, '')), ''), 'Walk-In Guest'),
    NULLIF(trim(COALESCE(p_guest_phone, '')), ''),
    p_start_at,
    p_end_at,
    v_units,
    v_guests,
    COALESCE(p_selected_addons, '[]'::jsonb),
    COALESCE(p_price_snapshot, '{}'::jsonb),
    COALESCE(p_total_amount_inr, 0),
    COALESCE(p_advance_amount_inr, 0),
    COALESCE(p_balance_at_venue_inr, 0),
    COALESCE(p_convenience_fee_inr, 0),
    v_effective_rail,
    p_checkin_otp_hash,
    p_checkin_otp_display,
    v_effective_booking_status,
    v_effective_payment_status,
    'not_applicable',
    NULLIF(trim(COALESCE(p_notes, '')), '')
  )
  RETURNING * INTO v_inserted;

  RETURN jsonb_build_object(
    'ok', true,
    'booking', to_jsonb(v_inserted),
    'remaining_units', GREATEST(0, v_resource.total_units - (v_already_booked + v_units))
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_atomic_resource_booking(
  uuid, timestamptz, timestamptz, integer, integer, text, text, uuid, text,
  jsonb, jsonb, numeric, numeric, numeric, numeric, text, text, text, text, text, text, text
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_atomic_resource_booking(
  uuid, timestamptz, timestamptz, integer, integer, text, text, uuid, text,
  jsonb, jsonb, numeric, numeric, numeric, numeric, text, text, text, text, text, text, text
) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- C4. verify_booking_checkin_otp(p_booking_id, p_otp, p_balance_collected)
--     Validates operator, compares SHA-256 OTP hash, marks checked_in, and
--     unlocks linked merchant_settlements row from 'locked' -> 'eligible'.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_booking_checkin_otp(
  p_booking_id uuid,
  p_otp text,
  p_balance_collected boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_is_service boolean := (current_setting('role', true) = 'service_role');
  v_booking public.resource_bookings%ROWTYPE;
  v_clean_otp text := trim(COALESCE(p_otp, ''));
  v_computed_hash text;
  v_next_payment_status text;
  v_next_settlement_status text;
  v_now timestamptz := now();
BEGIN
  IF v_clean_otp = '' THEN
    RAISE EXCEPTION 'Check-in OTP is required.'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_booking
  FROM public.resource_bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found.'
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT v_is_service AND NOT public.is_booking_operator_for(v_booking.listing_id) THEN
    RAISE EXCEPTION 'Forbidden: Only authorized venue or hotel operators may verify check-in OTP.'
      USING ERRCODE = '42501';
  END IF;

  IF v_booking.booking_status IN ('cancelled', 'no_show', 'completed') THEN
    RAISE EXCEPTION 'Cannot check in a booking with status "%".', v_booking.booking_status
      USING ERRCODE = 'P0001';
  END IF;

  IF v_booking.checkin_otp_hash IS NULL OR trim(v_booking.checkin_otp_hash) = '' THEN
    RAISE EXCEPTION 'No check-in OTP is configured for this booking.'
      USING ERRCODE = 'P0001';
  END IF;

  v_computed_hash := encode(digest(convert_to(v_clean_otp, 'UTF8'), 'sha256'), 'hex');
  IF lower(v_computed_hash) <> lower(trim(v_booking.checkin_otp_hash)) THEN
    RAISE EXCEPTION 'Invalid check-in OTP.'
      USING ERRCODE = '22023';
  END IF;

  v_next_payment_status := v_booking.payment_status;
  IF p_balance_collected = true THEN
    IF v_booking.payment_rail IN ('direct_counter', 'direct_shop_upi') THEN
      v_next_payment_status := 'paid_direct_confirmed';
    ELSIF v_booking.payment_status = 'advance_escrow_held' THEN
      v_next_payment_status := 'paid_direct_confirmed';
    END IF;
  END IF;

  v_next_settlement_status := v_booking.settlement_status;
  IF v_booking.payment_rail = 'platform_escrow' THEN
    UPDATE public.merchant_settlements
    SET
      status = 'eligible',
      updated_at = v_now
    WHERE resource_booking_id = v_booking.id
      AND status = 'locked';

    IF FOUND OR v_booking.settlement_status = 'locked' THEN
      v_next_settlement_status := 'eligible';
    END IF;
  END IF;

  UPDATE public.resource_bookings
  SET
    booking_status = 'checked_in',
    checked_in_at = COALESCE(checked_in_at, v_now),
    payment_status = v_next_payment_status,
    settlement_status = v_next_settlement_status,
    updated_at = v_now
  WHERE id = v_booking.id
  RETURNING * INTO v_booking;

  RETURN jsonb_build_object(
    'ok', true,
    'booking_id', v_booking.id,
    'booking_code', v_booking.booking_code,
    'booking_status', v_booking.booking_status,
    'payment_status', v_booking.payment_status,
    'settlement_status', v_booking.settlement_status,
    'checked_in_at', v_booking.checked_in_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.verify_booking_checkin_otp(uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_booking_checkin_otp(uuid, text, boolean) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- C5. Upgrade fulfill_payment_intent RPC
--     Preserves ALL existing purposes AND adds resource_booking,
--     booking_pro_subscription, and stay_pro_subscription.
-- -----------------------------------------------------------------------------
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
    RAISE EXCEPTION 'Payment intent not found.'
      USING ERRCODE = 'P0002';
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
    SET
      status = 'escrow_held',
      mediator_id = coalesce(mediator_id, v_caller_uid),
      updated_at = now()
    WHERE id = v_intent.reference_id
      AND status IN ('awaiting_payment', 'payment_submitted');

    INSERT INTO public.delivery_transactions (
      order_id, hub_id, tx_type, amount_inr, upi_utr_ref, payment_proof_path, recorded_by, notes
    )
    VALUES (
      v_intent.reference_id,
      v_intent.hub_id,
      'escrow_hold',
      v_intent.amount_inr,
      coalesce(v_intent.upi_utr_ref, v_effective_payment_id),
      v_intent.payment_proof_path,
      v_caller_uid,
      'Fulfilled via ' || v_intent.provider || ' intent ' || v_intent.intent_code
    );

    INSERT INTO public.delivery_order_events (order_id, actor_id, event_type, payload)
    VALUES (
      v_intent.reference_id,
      v_caller_uid,
      'escrow_held',
      jsonb_build_object(
        'intent_id', v_intent.id,
        'intent_code', v_intent.intent_code,
        'hub_id', v_intent.hub_id,
        'provider', v_intent.provider,
        'provider_payment_id', v_effective_payment_id,
        'amount_inr', v_intent.amount_inr,
        'discount_inr', v_intent.discount_inr,
        'convenience_fee_inr', v_intent.convenience_fee_inr
      )
    );

  -- 2. Scheduled Vehicle Bookings
  ELSIF v_intent.purpose = 'vehicle_booking' THEN
    UPDATE public.vehicle_bookings
    SET
      status = 'confirmed',
      hold_expires_at = NULL,
      updated_at = now()
    WHERE id = v_intent.reference_id;

  -- 3. Bulletin Subscription
  ELSIF v_intent.purpose = 'bulletin_subscription' THEN
    UPDATE public.user_subscriptions
    SET
      status = 'active',
      verified_by = coalesce(v_caller_uid, verified_by),
      payment_ref = coalesce(v_effective_payment_id, payment_ref)
    WHERE id = v_intent.reference_id;

  -- 4. Bulletin Single Post Pass
  ELSIF v_intent.purpose = 'bulletin_post_pass' THEN
    UPDATE public.bulletin_post_passes
    SET
      status = 'available',
      verified_by = coalesce(v_caller_uid, verified_by),
      upi_utr_ref = coalesce(v_intent.upi_utr_ref, v_effective_payment_id, upi_utr_ref)
    WHERE id = v_intent.reference_id;

  -- 5. Print & Digital Orders (with optional Pick N Drop)
  ELSIF v_intent.purpose IN ('print_order', 'print_order_with_delivery') THEN
    v_print_order_id := COALESCE(v_intent.print_order_id, v_intent.reference_id);

    UPDATE public.print_orders
    SET
      payment_status = 'escrow_held',
      fulfillment_status = CASE
        WHEN fulfillment_status IN ('draft', 'confirmed') THEN 'confirmed'
        ELSE fulfillment_status
      END,
      quote_status = CASE
        WHEN quote_status IN ('unquoted', 'awaiting_shop_quote', 'quoted', 'accepted') THEN 'accepted'
        ELSE quote_status
      END,
      settlement_status = CASE
        WHEN is_first_party_order = false THEN 'locked'
        ELSE 'not_applicable'
      END,
      payment_intent_id = COALESCE(payment_intent_id, v_intent.id),
      updated_at = now()
    WHERE id = v_print_order_id
    RETURNING * INTO v_print_order;

    IF FOUND THEN
      IF v_intent.purpose = 'print_order_with_delivery'
         AND v_print_order.linked_delivery_order_id IS NOT NULL THEN
        UPDATE public.delivery_orders
        SET
          status = 'escrow_held',
          mediator_id = COALESCE(mediator_id, v_caller_uid),
          updated_at = now()
        WHERE id = v_print_order.linked_delivery_order_id
          AND status IN ('awaiting_payment', 'payment_submitted');
      END IF;

      IF v_print_order.is_first_party_order = false THEN
        SELECT l.owner_id, l.hub_id
          INTO v_listing_owner_id, v_listing_hub_id
        FROM public.listings l
        WHERE l.id = v_print_order.listing_id;

        IF v_listing_owner_id IS NOT NULL THEN
          v_gross_inr := COALESCE(v_print_order.quoted_amount_inr, v_intent.amount_inr);
          v_fee_inr := COALESCE(v_print_order.platform_fee_inr, 0);
          v_net_inr := GREATEST(0, v_gross_inr - v_fee_inr);

          INSERT INTO public.merchant_settlements (
            hub_id, listing_id, owner_id, print_order_id, settlement_source,
            gross_amount_inr, platform_fee_inr, net_payable_inr, status
          )
          VALUES (
            COALESCE(v_print_order.hub_id, v_listing_hub_id, v_intent.hub_id),
            v_print_order.listing_id,
            v_listing_owner_id,
            v_print_order.id,
            'print_order',
            v_gross_inr,
            v_fee_inr,
            v_net_inr,
            'locked'
          )
          ON CONFLICT (print_order_id) DO UPDATE
          SET
            gross_amount_inr = EXCLUDED.gross_amount_inr,
            platform_fee_inr = EXCLUDED.platform_fee_inr,
            net_payable_inr = EXCLUDED.net_payable_inr,
            status = CASE
              WHEN public.merchant_settlements.status = 'settled' THEN 'settled'
              ELSE 'locked'
            END,
            updated_at = now();
        END IF;
      END IF;

      INSERT INTO public.print_order_events (print_order_id, actor_id, actor_role, event_type, metadata)
      VALUES (
        v_print_order.id,
        v_caller_uid,
        CASE
          WHEN v_is_service THEN 'payment_webhook'
          WHEN public.is_super_admin() THEN 'super_admin'
          ELSE 'hub_manager'
        END,
        'payment_escrow_confirmed',
        jsonb_build_object(
          'intent_id', v_intent.id,
          'intent_code', v_intent.intent_code,
          'purpose', v_intent.purpose,
          'provider', v_intent.provider,
          'provider_payment_id', v_effective_payment_id,
          'amount_inr', v_intent.amount_inr,
          'is_first_party_order', v_print_order.is_first_party_order
        )
      );
    END IF;

  -- 6. Print Pro Subscription
  ELSIF v_intent.purpose = 'print_pro_subscription' THEN
    SELECT
      us.id, us.listing_id, us.expires_at,
      COALESCE(sp.duration_days, 30) AS duration_days
      INTO v_sub_row
    FROM public.user_subscriptions us
    LEFT JOIN public.subscription_plans sp ON sp.id = us.plan_id
    WHERE us.id = v_intent.reference_id
    FOR UPDATE OF us;

    IF FOUND THEN
      UPDATE public.user_subscriptions
      SET
        status = 'active',
        starts_at = COALESCE(starts_at, now()),
        expires_at = CASE
          WHEN expires_at IS NULL OR expires_at <= now()
            THEN now() + make_interval(days => v_sub_row.duration_days)
          ELSE expires_at
        END,
        verified_by = COALESCE(v_caller_uid, verified_by),
        payment_ref = COALESCE(v_effective_payment_id, payment_ref)
      WHERE id = v_sub_row.id;

      IF v_sub_row.listing_id IS NOT NULL THEN
        SELECT l.hub_id INTO v_listing_hub_id
        FROM public.listings l
        WHERE l.id = v_sub_row.listing_id;

        IF v_listing_hub_id IS NOT NULL THEN
          INSERT INTO public.listing_print_profiles (listing_id, hub_id)
          VALUES (v_sub_row.listing_id, v_listing_hub_id)
          ON CONFLICT (listing_id) DO NOTHING;
        END IF;
      END IF;
    END IF;

  -- 7. Universal Resource Booking (Turfs, Halls, Rentals & Hotel Stays)
  ELSIF v_intent.purpose = 'resource_booking' THEN
    v_booking_id := COALESCE(v_intent.resource_booking_id, v_intent.reference_id);

    UPDATE public.resource_bookings
    SET
      booking_status = CASE
        WHEN booking_status IN ('pending_payment', 'confirmed') THEN 'confirmed'
        ELSE booking_status
      END,
      payment_status = CASE
        WHEN COALESCE(balance_at_venue_inr, 0) > 0 THEN 'advance_escrow_held'
        ELSE 'fully_prepaid_escrow'
      END,
      settlement_status = 'locked',
      payment_intent_id = COALESCE(payment_intent_id, v_intent.id),
      updated_at = now()
    WHERE id = v_booking_id
    RETURNING * INTO v_booking;

    IF FOUND THEN
      SELECT l.owner_id, l.hub_id
        INTO v_listing_owner_id, v_listing_hub_id
      FROM public.listings l
      WHERE l.id = v_booking.listing_id;

      IF v_listing_owner_id IS NOT NULL THEN
        v_gross_inr := COALESCE(v_booking.advance_amount_inr, v_intent.amount_inr);
        v_fee_inr := COALESCE(v_booking.convenience_fee_inr, 0);
        v_net_inr := COALESCE(v_booking.advance_amount_inr, GREATEST(0, v_gross_inr - v_fee_inr));

        INSERT INTO public.merchant_settlements (
          hub_id,
          listing_id,
          owner_id,
          resource_booking_id,
          settlement_source,
          gross_amount_inr,
          platform_fee_inr,
          net_payable_inr,
          status
        )
        VALUES (
          COALESCE(v_booking.hub_id, v_listing_hub_id, v_intent.hub_id),
          v_booking.listing_id,
          v_listing_owner_id,
          v_booking.id,
          'resource_booking',
          v_gross_inr,
          v_fee_inr,
          v_net_inr,
          'locked'
        )
        ON CONFLICT (resource_booking_id) DO UPDATE
        SET
          gross_amount_inr = EXCLUDED.gross_amount_inr,
          platform_fee_inr = EXCLUDED.platform_fee_inr,
          net_payable_inr = EXCLUDED.net_payable_inr,
          status = CASE
            WHEN public.merchant_settlements.status = 'settled' THEN 'settled'
            ELSE 'locked'
          END,
          updated_at = now();
      END IF;
    END IF;

  -- 8. Booking Pro & Stay Pro Merchant Subscriptions
  ELSIF v_intent.purpose IN ('booking_pro_subscription', 'stay_pro_subscription') THEN
    SELECT
      us.id, us.listing_id, us.expires_at,
      COALESCE(sp.duration_days, 30) AS duration_days
      INTO v_sub_row
    FROM public.user_subscriptions us
    LEFT JOIN public.subscription_plans sp ON sp.id = us.plan_id
    WHERE us.id = v_intent.reference_id
    FOR UPDATE OF us;

    IF FOUND THEN
      UPDATE public.user_subscriptions
      SET
        status = 'active',
        starts_at = COALESCE(starts_at, now()),
        expires_at = CASE
          WHEN expires_at IS NULL OR expires_at <= now()
            THEN now() + make_interval(days => v_sub_row.duration_days)
          ELSE expires_at + make_interval(days => v_sub_row.duration_days)
        END,
        verified_by = COALESCE(v_caller_uid, verified_by),
        payment_ref = COALESCE(v_effective_payment_id, payment_ref)
      WHERE id = v_sub_row.id;

      IF v_intent.purpose = 'stay_pro_subscription' AND v_sub_row.listing_id IS NOT NULL THEN
        SELECT l.hub_id INTO v_listing_hub_id
        FROM public.listings l
        WHERE l.id = v_sub_row.listing_id;

        IF v_listing_hub_id IS NOT NULL THEN
          INSERT INTO public.listing_hotel_profiles (listing_id, hub_id)
          VALUES (v_sub_row.listing_id, v_listing_hub_id)
          ON CONFLICT (listing_id) DO NOTHING;
        END IF;
      END IF;
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
-- D. Strict Least-Privilege Row Level Security (RLS) Policies
-- =============================================================================

ALTER TABLE public.listing_hotel_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.listing_booking_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.resource_bookings ENABLE ROW LEVEL SECURITY;

-- D1. public.listing_hotel_profiles
DROP POLICY IF EXISTS "Public can view hotel profiles" ON public.listing_hotel_profiles;
CREATE POLICY "Public can view hotel profiles"
  ON public.listing_hotel_profiles
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Operators and hub managers can insert hotel profiles" ON public.listing_hotel_profiles;
CREATE POLICY "Operators and hub managers can insert hotel profiles"
  ON public.listing_hotel_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_booking_operator_for(listing_id)
    OR public.is_hub_manager_for(hub_id)
    OR public.is_super_admin()
  );

DROP POLICY IF EXISTS "Operators and hub managers can update hotel profiles" ON public.listing_hotel_profiles;
CREATE POLICY "Operators and hub managers can update hotel profiles"
  ON public.listing_hotel_profiles
  FOR UPDATE
  TO authenticated
  USING (
    public.is_booking_operator_for(listing_id)
    OR public.is_hub_manager_for(hub_id)
    OR public.is_super_admin()
  )
  WITH CHECK (
    public.is_booking_operator_for(listing_id)
    OR public.is_hub_manager_for(hub_id)
    OR public.is_super_admin()
  );

DROP POLICY IF EXISTS "Operators can delete hotel profiles" ON public.listing_hotel_profiles;
CREATE POLICY "Operators can delete hotel profiles"
  ON public.listing_hotel_profiles
  FOR DELETE
  TO authenticated
  USING (
    public.is_booking_operator_for(listing_id)
    OR public.is_super_admin()
  );

-- D2. public.listing_booking_resources
DROP POLICY IF EXISTS "Public can view booking resources" ON public.listing_booking_resources;
CREATE POLICY "Public can view booking resources"
  ON public.listing_booking_resources
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Operators can insert booking resources" ON public.listing_booking_resources;
CREATE POLICY "Operators can insert booking resources"
  ON public.listing_booking_resources
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_booking_operator_for(listing_id));

DROP POLICY IF EXISTS "Operators can update booking resources" ON public.listing_booking_resources;
CREATE POLICY "Operators can update booking resources"
  ON public.listing_booking_resources
  FOR UPDATE
  TO authenticated
  USING (public.is_booking_operator_for(listing_id))
  WITH CHECK (public.is_booking_operator_for(listing_id));

DROP POLICY IF EXISTS "Operators can delete booking resources" ON public.listing_booking_resources;
CREATE POLICY "Operators can delete booking resources"
  ON public.listing_booking_resources
  FOR DELETE
  TO authenticated
  USING (public.is_booking_operator_for(listing_id));

-- D3. public.resource_bookings
DROP POLICY IF EXISTS "Customers operators and managers can view resource bookings" ON public.resource_bookings;
CREATE POLICY "Customers operators and managers can view resource bookings"
  ON public.resource_bookings
  FOR SELECT
  TO authenticated
  USING (
    customer_id = auth.uid()
    OR public.is_booking_operator_for(listing_id)
    OR public.is_hub_manager_for(hub_id)
    OR public.is_super_admin()
  );

DROP POLICY IF EXISTS "Customers and operators can insert resource bookings" ON public.resource_bookings;
CREATE POLICY "Customers and operators can insert resource bookings"
  ON public.resource_bookings
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (booking_source = 'online' AND customer_id = auth.uid())
    OR public.is_booking_operator_for(listing_id)
  );

DROP POLICY IF EXISTS "Operators can update resource bookings" ON public.resource_bookings;
CREATE POLICY "Operators can update resource bookings"
  ON public.resource_bookings
  FOR UPDATE
  TO authenticated
  USING (public.is_booking_operator_for(listing_id))
  WITH CHECK (public.is_booking_operator_for(listing_id));

-- =============================================================================
-- E. Seed Curated Taxonomy, Pro Plans & 4 Sample Listings (Idempotent)
-- =============================================================================

-- E1. Curated Taxonomy for Venues/Turfs & Hotels/Homestays
DO $$
DECLARE
  v_venues_root_id uuid;
  v_hotels_root_id uuid;
BEGIN
  -- Depth 0: Turfs, Halls & Rentals
  INSERT INTO public.categories (
    entity_type, parent_id, depth, slug, display_name, icon, color_hex, sort_order, is_active
  )
  VALUES (
    'listing', NULL, 0, 'venues_turfs_bookings', 'Turfs, Halls & Rentals', 'CalendarCheck', '#059669', 62, true
  )
  ON CONFLICT (entity_type, slug) DO NOTHING;

  SELECT id INTO v_venues_root_id
  FROM public.categories
  WHERE entity_type = 'listing' AND slug = 'venues_turfs_bookings'
  LIMIT 1;

  IF v_venues_root_id IS NOT NULL THEN
    INSERT INTO public.categories (
      entity_type, parent_id, depth, slug, display_name, icon, color_hex, sort_order, is_active
    )
    VALUES
      ('listing', v_venues_root_id, 1, 'football_turfs_sports', 'Football Turfs & Sports Courts', 'Trophy', '#059669', 10, true),
      ('listing', v_venues_root_id, 1, 'event_wedding_halls', 'Event & Wedding Halls', 'Sparkles', '#059669', 20, true),
      ('listing', v_venues_root_id, 1, 'studios_meeting_rooms', 'Studios & Meeting Rooms', 'Mic', '#059669', 30, true),
      ('listing', v_venues_root_id, 1, 'equipment_rentals', 'Equipment Rentals', 'Package', '#059669', 40, true)
    ON CONFLICT (entity_type, slug) DO NOTHING;
  END IF;

  -- Depth 0: Hotels & Homestays
  INSERT INTO public.categories (
    entity_type, parent_id, depth, slug, display_name, icon, color_hex, sort_order, is_active
  )
  VALUES (
    'listing', NULL, 0, 'hotels_homestays', 'Hotels & Homestays', 'BedDouble', '#4F46E5', 64, true
  )
  ON CONFLICT (entity_type, slug) DO NOTHING;

  SELECT id INTO v_hotels_root_id
  FROM public.categories
  WHERE entity_type = 'listing' AND slug = 'hotels_homestays'
  LIMIT 1;

  IF v_hotels_root_id IS NOT NULL THEN
    INSERT INTO public.categories (
      entity_type, parent_id, depth, slug, display_name, icon, color_hex, sort_order, is_active
    )
    VALUES
      ('listing', v_hotels_root_id, 1, 'hotels_lodges', 'Hotels & Lodges', 'Hotel', '#4F46E5', 10, true),
      ('listing', v_hotels_root_id, 1, 'homestays_guesthouses', 'Homestays & Guest Houses', 'Home', '#4F46E5', 20, true),
      ('listing', v_hotels_root_id, 1, 'resorts_retreats', 'Resorts & Retreats', 'Trees', '#4F46E5', 30, true)
    ON CONFLICT (entity_type, slug) DO NOTHING;
  END IF;
END;
$$;

-- E2. Seed Booking Pro & Stay Pro Subscription Plans
INSERT INTO public.subscription_plans (
  slug,
  name,
  price_inr,
  max_active_bulletins,
  max_monthly_posts,
  max_images_per_post,
  allow_youtube,
  duration_days,
  is_active,
  plan_scope,
  entitlements
)
VALUES
  (
    'booking_pro_monthly',
    'Monthly Booking Venue Pro',
    599,
    0,
    0,
    5,
    false,
    30,
    true,
    'booking_pro',
    '{"booking_engine":true,"walk_in_blocking":true,"escrow_advances":true}'::jsonb
  ),
  (
    'stay_pro_monthly',
    'Monthly Hotel & Homestay Pro',
    799,
    0,
    0,
    8,
    false,
    30,
    true,
    'stay_pro',
    '{"hotel_stays":true,"multi_room_inventory":true,"walk_in_blocking":true,"escrow_advances":true}'::jsonb
  )
ON CONFLICT (slug) DO NOTHING;

-- E3. Seed 4 Deterministic [SAMPLE] Booking & Hotel Listings + Resources
DO $$
DECLARE
  v_ccpur_id uuid;
  v_aizawl_id uuid;
  v_owner_id uuid;
  v_cat_turf_id uuid;
  v_cat_hall_id uuid;
  v_cat_hotel_id uuid;
  v_cat_homestay_id uuid;
  v_l_turf uuid := 'f0000000-0000-4000-8000-00000000b001';
  v_l_hall uuid := 'f0000000-0000-4000-8000-00000000b002';
  v_l_hotel uuid := 'f0000000-0000-4000-8000-00000000b003';
  v_l_homestay uuid := 'f0000000-0000-4000-8000-00000000b004';
  v_r_turf_5v5 uuid := 'f0000000-0000-4000-8000-00000000c001';
  v_r_turf_7v7 uuid := 'f0000000-0000-4000-8000-00000000c002';
  v_r_hall_full uuid := 'f0000000-0000-4000-8000-00000000c003';
  v_r_hall_half uuid := 'f0000000-0000-4000-8000-00000000c004';
  v_r_hotel_deluxe uuid := 'f0000000-0000-4000-8000-00000000c005';
  v_r_hotel_suite uuid := 'f0000000-0000-4000-8000-00000000c006';
  v_r_home_valley uuid := 'f0000000-0000-4000-8000-00000000c007';
  v_r_home_twin uuid := 'f0000000-0000-4000-8000-00000000c008';
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

  SELECT id INTO v_cat_turf_id FROM public.categories WHERE entity_type = 'listing' AND slug = 'football_turfs_sports' LIMIT 1;
  SELECT id INTO v_cat_hall_id FROM public.categories WHERE entity_type = 'listing' AND slug = 'event_wedding_halls' LIMIT 1;
  SELECT id INTO v_cat_hotel_id FROM public.categories WHERE entity_type = 'listing' AND slug = 'hotels_lodges' LIMIT 1;
  SELECT id INTO v_cat_homestay_id FROM public.categories WHERE entity_type = 'listing' AND slug = 'homestays_guesthouses' LIMIT 1;

  IF v_ccpur_id IS NOT NULL AND v_owner_id IS NOT NULL THEN
    -- 1. [SAMPLE] Lamka Arena 5v5 & 7v7 Football Turf (Churachandpur)
    INSERT INTO public.listings (
      id, owner_id, owner_name, title, category, subcategory, category_id, status,
      locality, address, short_description, description, price,
      contact_phone, phone, cover_image, gallery_images,
      coordinates, lat, lng, rating, review_count, hub_id,
      listing_vertical, is_civic_record
    ) VALUES (
      v_l_turf,
      v_owner_id,
      'Lamka Arena Sports',
      '[SAMPLE] Lamka Arena 5v5 & 7v7 Football Turf',
      'sports',
      'Football Turfs & Sports Courts',
      v_cat_turf_id,
      'published',
      'New Lamka',
      'Dorcas Road Extension, Near New Lamka Ground, Churachandpur, Manipur 795128',
      'FIFA-grade synthetic 5v5 and 7v7 football turf with LED floodlights, changing rooms, and online slot booking.',
      'Premier all-weather synthetic football turf in New Lamka featuring dedicated 5v5 and 7v7 pitches, bright evening LED floodlights, drinking water, spectator seating, and instant slot reservations.',
      800,
      '+91 98620 44101',
      '+91 98620 44101',
      'https://picsum.photos/seed/ddoodle-turf-lamka/960/640',
      '[]'::jsonb,
      '{"lat":24.3292,"lng":93.6815}'::jsonb,
      24.3292,
      93.6815,
      4.8,
      24,
      v_ccpur_id,
      'booking_venue',
      false
    ) ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.listing_booking_resources (
      id, listing_id, hub_id, resource_vertical, name, description,
      booking_unit, slot_duration_mins, open_hour, close_hour,
      total_units, max_guests, base_rate_inr, peak_rate_inr, peak_start_hour,
      advance_percent, addons, sort_order, is_active
    ) VALUES
      (
        v_r_turf_5v5, v_l_turf, v_ccpur_id, 'booking_venue',
        '5v5 Football Turf A',
        'High-density artificial grass 5-a-side turf with goal nets and bench shelter.',
        'hourly', 60, 6, 22,
        1, 12, 800, 1100, 17,
        30,
        '[{"key":"match_ball","label":"Match Football Rental","price_inr":100},{"key":"bibs_set","label":"Team Bibs Set (10 pcs)","price_inr":100},{"key":"water_crate","label":"Chilled Water Crate (12L)","price_inr":150}]'::jsonb,
        10, true
      ),
      (
        v_r_turf_7v7, v_l_turf, v_ccpur_id, 'booking_venue',
        '7v7 Championship Turf B',
        'Full-size 7-a-side synthetic arena with tournament-grade evening floodlights.',
        'hourly', 60, 6, 22,
        1, 18, 1200, 1600, 17,
        30,
        '[{"key":"referee","label":"Certified Match Referee","price_inr":400},{"key":"match_ball","label":"Match Football Rental","price_inr":100},{"key":"water_crate","label":"Chilled Water Crate (12L)","price_inr":150}]'::jsonb,
        20, true
      )
    ON CONFLICT (id) DO NOTHING;

    -- 2. [SAMPLE] Tuibong Community & Event Hall (Churachandpur)
    INSERT INTO public.listings (
      id, owner_id, owner_name, title, category, subcategory, category_id, status,
      locality, address, short_description, description, price,
      contact_phone, phone, cover_image, gallery_images,
      coordinates, lat, lng, rating, review_count, hub_id,
      listing_vertical, is_civic_record
    ) VALUES (
      v_l_hall,
      v_owner_id,
      'Tuibong Civic Events',
      '[SAMPLE] Tuibong Community & Event Hall',
      'business',
      'Event & Wedding Halls',
      v_cat_hall_id,
      'published',
      'Tuibong',
      'Main Highway Junction, Opposite Tuibong Market, Churachandpur, Manipur 795128',
      'Spacious 450-seat indoor hall for weddings, conferences, youth conventions, and receptions.',
      'Well-ventilated multi-purpose banquet and community hall with raised stage, generator backup, dedicated dining wing, and ample two-wheeler & car parking.',
      7500,
      '+91 98620 44102',
      '+91 98620 44102',
      'https://picsum.photos/seed/ddoodle-hall-tuibong/960/640',
      '[]'::jsonb,
      '{"lat":24.3441,"lng":93.6904}'::jsonb,
      24.3441,
      93.6904,
      4.6,
      15,
      v_ccpur_id,
      'booking_venue',
      false
    ) ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.listing_booking_resources (
      id, listing_id, hub_id, resource_vertical, name, description,
      booking_unit, slot_duration_mins, open_hour, close_hour,
      total_units, max_guests, base_rate_inr, peak_rate_inr, peak_start_hour,
      advance_percent, addons, sort_order, is_active
    ) VALUES
      (
        v_r_hall_full, v_l_hall, v_ccpur_id, 'booking_venue',
        'Main Banquet Hall (Full Day)',
        'Full-day access (7 AM – 9 PM) including 350 banquet chairs, raised stage, and dining bay.',
        'full_day', 840, 7, 21,
        1, 450, 12000, NULL, NULL,
        30,
        '[{"key":"pa_sound","label":"PA Sound System & 4 Mics","price_inr":2500},{"key":"stage_decor","label":"Basic Floral Stage Backdrop","price_inr":4000},{"key":"dg_backup","label":"Dedicated DG Generator Backup","price_inr":1800}]'::jsonb,
        10, true
      ),
      (
        v_r_hall_half, v_l_hall, v_ccpur_id, 'booking_venue',
        'Main Banquet Hall (Half Day Session)',
        'Morning or afternoon 5-hour session suitable for seminars, meetings, and engagements.',
        'half_day', 300, 7, 21,
        1, 300, 7500, NULL, NULL,
        30,
        '[{"key":"pa_sound","label":"PA Sound System & 4 Mics","price_inr":1500},{"key":"projector","label":"HD Projector & Screen","price_inr":1200}]'::jsonb,
        20, true
      )
    ON CONFLICT (id) DO NOTHING;

    -- 3. [SAMPLE] Hillcrest Heritage Hotel & Lodge (Churachandpur)
    INSERT INTO public.listings (
      id, owner_id, owner_name, title, category, subcategory, category_id, status,
      locality, address, short_description, description, price,
      contact_phone, phone, cover_image, gallery_images,
      coordinates, lat, lng, rating, review_count, hub_id,
      listing_vertical, is_civic_record
    ) VALUES (
      v_l_hotel,
      v_owner_id,
      'Hillcrest Hospitality',
      '[SAMPLE] Hillcrest Heritage Hotel & Lodge',
      'business',
      'Hotels & Lodges',
      v_cat_hotel_id,
      'published',
      'Rengkai',
      'Hillcrest View Road, Rengkai, Churachandpur, Manipur 795128',
      'Clean family-friendly hotel & lodge with hot water, high-speed WiFi, inverter power backup, and secure parking.',
      'Peaceful hillside hotel offering spotless double rooms and spacious family suites with 24-hour hot water, fiber WiFi, on-site home-style kitchen, and secure gated parking.',
      1800,
      '+91 98620 44103',
      '+91 98620 44103',
      'https://picsum.photos/seed/ddoodle-hotel-hillcrest/960/640',
      '[]'::jsonb,
      '{"lat":24.3315,"lng":93.6948}'::jsonb,
      24.3315,
      93.6948,
      4.7,
      31,
      v_ccpur_id,
      'hotel_stay',
      false
    ) ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.listing_hotel_profiles (
      listing_id, hub_id, stay_type, check_in_time, check_out_time,
      amenities, verified_amenities, house_rules, cancellation_policy,
      id_requirement_note, is_accepting_bookings, payment_policy
    ) VALUES (
      v_l_hotel,
      v_ccpur_id,
      'hotel',
      '12:00 PM',
      '11:00 AM',
      '{"wifi":true,"parking":true,"hot_water":true,"power_backup":true,"ac":true,"heater":true,"in_house_kitchen":true,"early_checkin":true}'::jsonb,
      '{"wifi":true,"parking":true,"hot_water":true,"power_backup":true}'::jsonb,
      'Quiet hours after 10:30 PM. Smoking is permitted only on open balconies.',
      'Free cancellation up to 24 hours before check-in.',
      'Valid government photo ID (Aadhaar, Voter ID, Driving License, or Passport) is verified at reception upon check-in.',
      true,
      '{"allow_direct_pay":false,"advance_percent":30,"allow_full_prepay":true,"shop_upi_id":null,"shop_upi_name":null,"shop_upi_verified":false}'::jsonb
    ) ON CONFLICT (listing_id) DO NOTHING;

    INSERT INTO public.listing_booking_resources (
      id, listing_id, hub_id, resource_vertical, name, description,
      booking_unit, slot_duration_mins, open_hour, close_hour,
      total_units, max_guests, base_rate_inr, peak_rate_inr, peak_start_hour,
      advance_percent, addons, sort_order, is_active
    ) VALUES
      (
        v_r_hotel_deluxe, v_l_hotel, v_ccpur_id, 'hotel_stay',
        'Deluxe Double Room',
        'Queen bed, attached western bath with geyser, work desk, WiFi, and hillside window.',
        'nightly', 1440, 0, 24,
        4, 2, 1800, NULL, NULL,
        30,
        '[{"key":"breakfast","label":"Local & Continental Breakfast","price_inr":250,"per_unit":true},{"key":"extra_mattress","label":"Extra Floor Mattress & Linen","price_inr":400,"per_unit":true}]'::jsonb,
        10, true
      ),
      (
        v_r_hotel_suite, v_l_hotel, v_ccpur_id, 'hotel_stay',
        'Family Suite',
        'Two interconnected queen beds, seating area, hot water geyser, heater/AC, and private balcony.',
        'nightly', 1440, 0, 24,
        2, 4, 3200, NULL, NULL,
        30,
        '[{"key":"breakfast","label":"Family Breakfast Pack (4 guests)","price_inr":700,"per_unit":true},{"key":"extra_mattress","label":"Extra Floor Mattress & Linen","price_inr":400,"per_unit":true}]'::jsonb,
        20, true
      )
    ON CONFLICT (id) DO NOTHING;
  END IF;

  IF v_aizawl_id IS NOT NULL AND v_owner_id IS NOT NULL THEN
    -- 4. [SAMPLE] Zarkawt Ridge Boutique Homestay (Aizawl)
    INSERT INTO public.listings (
      id, owner_id, owner_name, title, category, subcategory, category_id, status,
      locality, address, short_description, description, price,
      contact_phone, phone, cover_image, gallery_images,
      coordinates, lat, lng, rating, review_count, hub_id,
      listing_vertical, is_civic_record
    ) VALUES (
      v_l_homestay,
      v_owner_id,
      'Zarkawt Ridge Stays',
      '[SAMPLE] Zarkawt Ridge Boutique Homestay',
      'business',
      'Homestays & Guest Houses',
      v_cat_homestay_id,
      'published',
      'Zarkawt',
      'Upper Zarkawt Ridge Lane, Near Millennium Centre, Aizawl, Mizoram 796001',
      'Warm Mizo hospitality homestay overlooking the Aizawl valley with fiber WiFi, hot showers, and home-cooked meals.',
      'Boutique hillside homestay steps from Zarkawt main bazaar, featuring sunlit valley-view rooms, clean twin rooms for travelers, reliable hot water, power backup, and authentic home-cooked breakfasts.',
      1600,
      '+91 98630 55201',
      '+91 98630 55201',
      'https://picsum.photos/seed/ddoodle-homestay-zarkawt/960/640',
      '[]'::jsonb,
      '{"lat":23.7361,"lng":92.7176}'::jsonb,
      23.7361,
      92.7176,
      4.9,
      19,
      v_aizawl_id,
      'hotel_stay',
      false
    ) ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.listing_hotel_profiles (
      listing_id, hub_id, stay_type, check_in_time, check_out_time,
      amenities, verified_amenities, house_rules, cancellation_policy,
      id_requirement_note, is_accepting_bookings, payment_policy
    ) VALUES (
      v_l_homestay,
      v_aizawl_id,
      'homestay',
      '12:30 PM',
      '11:00 AM',
      '{"wifi":true,"parking":true,"hot_water":true,"power_backup":true,"ac":false,"heater":true,"in_house_kitchen":true,"early_checkin":true}'::jsonb,
      '{"wifi":true,"hot_water":true,"power_backup":true,"in_house_kitchen":true}'::jsonb,
      'Family-run homestay. Please inform reception in advance for late arrivals after 9:30 PM.',
      'Free cancellation up to 24 hours before check-in.',
      'Valid government photo ID and ILP (for non-resident visitors to Mizoram) are verified at check-in.',
      true,
      '{"allow_direct_pay":false,"advance_percent":30,"allow_full_prepay":true,"shop_upi_id":null,"shop_upi_name":null,"shop_upi_verified":false}'::jsonb
    ) ON CONFLICT (listing_id) DO NOTHING;

    INSERT INTO public.listing_booking_resources (
      id, listing_id, hub_id, resource_vertical, name, description,
      booking_unit, slot_duration_mins, open_hour, close_hour,
      total_units, max_guests, base_rate_inr, peak_rate_inr, peak_start_hour,
      advance_percent, addons, sort_order, is_active
    ) VALUES
      (
        v_r_home_valley, v_l_homestay, v_aizawl_id, 'hotel_stay',
        'Valley View Room',
        'Panoramic Aizawl hillside view with private balcony, queen bed, room heater, and hot shower.',
        'nightly', 1440, 0, 24,
        3, 2, 2200, NULL, NULL,
        30,
        '[{"key":"mizo_breakfast","label":"Home-Cooked Breakfast","price_inr":200,"per_unit":true},{"key":"dinner_thali","label":"Home-Style Dinner","price_inr":300,"per_unit":true}]'::jsonb,
        10, true
      ),
      (
        v_r_home_twin, v_l_homestay, v_aizawl_id, 'hotel_stay',
        'Standard Twin Room',
        'Cozy twin-bed room ideal for colleagues or friends visiting Aizawl, with fiber WiFi and hot water.',
        'nightly', 1440, 0, 24,
        5, 2, 1600, NULL, NULL,
        30,
        '[{"key":"mizo_breakfast","label":"Home-Cooked Breakfast","price_inr":200,"per_unit":true},{"key":"extra_mattress","label":"Extra Mattress","price_inr":350,"per_unit":true}]'::jsonb,
        20, true
      )
    ON CONFLICT (id) DO NOTHING;
  END IF;
END;
$$;
