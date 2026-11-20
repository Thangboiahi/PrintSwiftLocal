-- =============================================================================
-- Migration: 20261119_phase63a_payments_and_vehicle_bookings.sql
-- Phase 63-A: Unified Payment Engine (Manual UPI -> Razorpay Ready),
--             Vehicle Listings, Availability Blocks, Conflict-Free Scheduling,
--             Atomic SECURITY DEFINER RPCs & Idempotent Churachandpur Seed
-- =============================================================================

-- 0. Required Extensions
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 1. Role & Timestamp Helpers (Idempotent)
-- -----------------------------------------------------------------------------
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

CREATE OR REPLACE FUNCTION public.set_phase63_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Helper: Generate cryptographic 6-digit numeric OTP using pgcrypto
CREATE OR REPLACE FUNCTION public.generate_6digit_otp()
RETURNS text
LANGUAGE plpgsql
VOLATILE
AS $$
DECLARE
  v_bytes bytea;
  v_num bigint;
BEGIN
  v_bytes := gen_random_bytes(4);
  v_num := (
    (get_byte(v_bytes, 0)::bigint << 24) |
    (get_byte(v_bytes, 1)::bigint << 16) |
    (get_byte(v_bytes, 2)::bigint << 8) |
    get_byte(v_bytes, 3)::bigint
  );
  RETURN lpad((100000 + (abs(v_num) % 900000))::text, 6, '0');
END;
$$;

-- =============================================================================
-- 2. Unified Payment Engine (`public.payment_intents`)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.payment_intents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intent_code text UNIQUE NOT NULL,
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (
    purpose IN (
      'pick_n_drop',
      'vehicle_booking',
      'bulletin_subscription',
      'bulletin_post_pass'
    )
  ),
  reference_id uuid NOT NULL,
  amount_inr numeric(10,2) NOT NULL CHECK (amount_inr >= 0),
  provider text NOT NULL DEFAULT 'manual_upi' CHECK (
    provider IN ('manual_upi', 'razorpay')
  ),
  provider_order_id text,
  provider_payment_id text,
  upi_utr_ref text,
  payment_proof_path text,
  status text NOT NULL DEFAULT 'awaiting_payment' CHECK (
    status IN (
      'awaiting_payment',
      'pending_manual',
      'succeeded',
      'failed',
      'rejected',
      'refunded'
    )
  ),
  refund_utr_ref text,
  refund_notes text,
  verified_by uuid REFERENCES public.profiles(id),
  expires_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Partial Unique Index preventing duplicate UTR reuse once a payment succeeds
CREATE UNIQUE INDEX IF NOT EXISTS idx_unique_succeeded_utr
  ON public.payment_intents (upi_utr_ref)
  WHERE status = 'succeeded' AND upi_utr_ref IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_payment_intents_user_created
  ON public.payment_intents (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_intents_status_created
  ON public.payment_intents (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_payment_intents_purpose_ref
  ON public.payment_intents (purpose, reference_id);

CREATE INDEX IF NOT EXISTS idx_payment_intents_provider_order
  ON public.payment_intents (provider_order_id)
  WHERE provider_order_id IS NOT NULL;

DROP TRIGGER IF EXISTS trg_payment_intents_updated_at ON public.payment_intents;
CREATE TRIGGER trg_payment_intents_updated_at
  BEFORE UPDATE ON public.payment_intents
  FOR EACH ROW
  EXECUTE FUNCTION public.set_phase63_updated_at();

-- Guard trigger: prevent non-admin authenticated users from tampering with immutable intent fields during UTR submission
CREATE OR REPLACE FUNCTION public.guard_payment_intent_user_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('role', true) = 'service_role'
     OR public.is_super_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF OLD.status <> 'awaiting_payment' THEN
    RAISE EXCEPTION 'Payment intent can only be updated while awaiting payment.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.intent_code IS DISTINCT FROM OLD.intent_code
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.purpose IS DISTINCT FROM OLD.purpose
     OR NEW.reference_id IS DISTINCT FROM OLD.reference_id
     OR NEW.amount_inr IS DISTINCT FROM OLD.amount_inr
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

DROP TRIGGER IF EXISTS trg_guard_payment_intent_user_update ON public.payment_intents;
CREATE TRIGGER trg_guard_payment_intent_user_update
  BEFORE UPDATE ON public.payment_intents
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_payment_intent_user_update();

ALTER TABLE public.payment_intents ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own payment intents and admins view all" ON public.payment_intents;
CREATE POLICY "Users view own payment intents and admins view all"
  ON public.payment_intents
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id
    OR public.is_pnd_admin(auth.uid())
  );

DROP POLICY IF EXISTS "Users submit manual UTR while awaiting payment" ON public.payment_intents;
CREATE POLICY "Users submit manual UTR while awaiting payment"
  ON public.payment_intents
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = user_id
    AND status = 'awaiting_payment'
  )
  WITH CHECK (
    auth.uid() = user_id
    AND status = 'pending_manual'
    AND verified_by IS NULL
    AND refund_utr_ref IS NULL
    AND refund_notes IS NULL
  );

-- Expand user_subscriptions.status CHECK constraint to allow 'pending_payment'
DO $$
DECLARE
  v_constraint_name text;
BEGIN
  IF to_regclass('public.user_subscriptions') IS NOT NULL THEN
    SELECT c.conname
      INTO v_constraint_name
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'user_subscriptions'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%status%';

    IF v_constraint_name IS NOT NULL THEN
      EXECUTE format(
        'ALTER TABLE public.user_subscriptions DROP CONSTRAINT %I',
        v_constraint_name
      );
    END IF;

    ALTER TABLE public.user_subscriptions
      ADD CONSTRAINT user_subscriptions_status_check
      CHECK (status IN ('pending_payment', 'active', 'expired', 'cancelled'));
  END IF;
END;
$$;

-- =============================================================================
-- 3. Vehicle Listings, Availability Blocks & Bookings
-- =============================================================================

-- 3a. public.vehicle_listings
CREATE TABLE IF NOT EXISTS public.vehicle_listings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_id uuid REFERENCES public.vehicles(id) ON DELETE SET NULL,
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  driver_id uuid REFERENCES public.drivers(id) ON DELETE SET NULL,
  vehicle_type_id uuid NOT NULL REFERENCES public.vehicle_types(id),
  title text NOT NULL,
  description text,
  stand_locality text NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  stand_point geography(Point, 4326),
  booking_mode text NOT NULL DEFAULT 'full_vehicle' CHECK (
    booking_mode IN ('full_vehicle', 'per_seat', 'both')
  ),
  total_seats integer NOT NULL DEFAULT 4 CHECK (total_seats >= 1),
  pricing_model text NOT NULL DEFAULT 'daily' CHECK (
    pricing_model IN ('hourly', 'daily', 'per_km', 'fixed_route')
  ),
  rate_hourly_inr numeric(10,2) CHECK (rate_hourly_inr IS NULL OR rate_hourly_inr >= 0),
  rate_daily_inr numeric(10,2) CHECK (rate_daily_inr IS NULL OR rate_daily_inr >= 0),
  rate_per_km_inr numeric(10,2) CHECK (rate_per_km_inr IS NULL OR rate_per_km_inr >= 0),
  fixed_routes jsonb NOT NULL DEFAULT '[]'::jsonb,
  advance_percent integer NOT NULL DEFAULT 25 CHECK (advance_percent BETWEEN 0 AND 100),
  with_driver boolean NOT NULL DEFAULT true,
  features text[] DEFAULT '{}',
  thumbnail_url text,
  image_urls text[] DEFAULT '{}',
  panorama_url text,
  is_active boolean DEFAULT true,
  is_verified boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.sync_vehicle_listing_stand_point()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.lat IS NOT NULL AND NEW.lng IS NOT NULL THEN
    NEW.stand_point := ST_SetSRID(ST_MakePoint(NEW.lng, NEW.lat), 4326)::geography;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vehicle_listings_stand_point ON public.vehicle_listings;
CREATE TRIGGER trg_vehicle_listings_stand_point
  BEFORE INSERT OR UPDATE ON public.vehicle_listings
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_vehicle_listing_stand_point();

CREATE INDEX IF NOT EXISTS idx_vehicle_listings_active_locality
  ON public.vehicle_listings (is_active, stand_locality);

CREATE INDEX IF NOT EXISTS idx_vehicle_listings_owner
  ON public.vehicle_listings (owner_id);

CREATE INDEX IF NOT EXISTS idx_vehicle_listings_driver
  ON public.vehicle_listings (driver_id);

CREATE INDEX IF NOT EXISTS idx_vehicle_listings_type
  ON public.vehicle_listings (vehicle_type_id);

CREATE INDEX IF NOT EXISTS idx_vehicle_listings_stand_point_gist
  ON public.vehicle_listings USING GIST (stand_point);

-- 3b. public.vehicle_availability_blocks
CREATE TABLE IF NOT EXISTS public.vehicle_availability_blocks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_listing_id uuid NOT NULL REFERENCES public.vehicle_listings(id) ON DELETE CASCADE,
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  reason text NOT NULL DEFAULT 'offline_booking' CHECK (
    reason IN ('offline_booking', 'maintenance', 'personal')
  ),
  notes text,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz DEFAULT now(),
  CHECK (end_time > start_time)
);

CREATE INDEX IF NOT EXISTS idx_vehicle_blocks_listing_window
  ON public.vehicle_availability_blocks (vehicle_listing_id, start_time, end_time);

-- 3c. public.vehicle_bookings
CREATE TABLE IF NOT EXISTS public.vehicle_bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  booking_code text UNIQUE NOT NULL,
  vehicle_listing_id uuid NOT NULL REFERENCES public.vehicle_listings(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.profiles(id),
  payment_intent_id uuid REFERENCES public.payment_intents(id),
  booking_mode text NOT NULL CHECK (booking_mode IN ('full_vehicle', 'per_seat')),
  seats_booked integer NOT NULL DEFAULT 1 CHECK (seats_booked >= 1),
  start_time timestamptz NOT NULL,
  end_time timestamptz NOT NULL,
  pickup_location text NOT NULL,
  dropoff_location text,
  instructions text,
  total_fare_inr numeric(10,2) NOT NULL CHECK (total_fare_inr >= 0),
  advance_amount_inr numeric(10,2) NOT NULL CHECK (advance_amount_inr >= 0),
  balance_due_inr numeric(10,2) NOT NULL CHECK (balance_due_inr >= 0),
  status text NOT NULL DEFAULT 'soft_hold' CHECK (
    status IN (
      'soft_hold',
      'pending_payment_confirm',
      'confirmed',
      'in_progress',
      'completed',
      'cancelled',
      'expired'
    )
  ),
  hold_expires_at timestamptz,
  start_otp text,
  end_otp text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  CHECK (end_time > start_time)
);

DROP TRIGGER IF EXISTS trg_vehicle_bookings_updated_at ON public.vehicle_bookings;
CREATE TRIGGER trg_vehicle_bookings_updated_at
  BEFORE UPDATE ON public.vehicle_bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.set_phase63_updated_at();

CREATE INDEX IF NOT EXISTS idx_vehicle_bookings_listing_status_window
  ON public.vehicle_bookings (vehicle_listing_id, status, start_time, end_time);

CREATE INDEX IF NOT EXISTS idx_vehicle_bookings_customer_created
  ON public.vehicle_bookings (customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_vehicle_bookings_intent
  ON public.vehicle_bookings (payment_intent_id);

CREATE INDEX IF NOT EXISTS idx_vehicle_bookings_soft_hold_expiry
  ON public.vehicle_bookings (hold_expires_at)
  WHERE status = 'soft_hold' AND hold_expires_at IS NOT NULL;

-- =============================================================================
-- 4. Expand `user_saved_items.item_type` CHECK Constraint to Include 'vehicle'
-- =============================================================================
DO $$
DECLARE
  v_constraint_name text;
BEGIN
  IF to_regclass('public.user_saved_items') IS NOT NULL THEN
    SELECT c.conname
      INTO v_constraint_name
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'user_saved_items'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%item_type%';

    IF v_constraint_name IS NOT NULL THEN
      EXECUTE format(
        'ALTER TABLE public.user_saved_items DROP CONSTRAINT %I',
        v_constraint_name
      );
    END IF;

    ALTER TABLE public.user_saved_items
      ADD CONSTRAINT user_saved_items_item_type_check
      CHECK (item_type IN ('listing', 'product', 'bulletin', 'vehicle'));
  END IF;
END;
$$;

-- =============================================================================
-- 5. Row-Level Security for Vehicle Listings, Blocks & Bookings
-- =============================================================================

-- Helper: Does user own or drive a given vehicle_listing?
CREATE OR REPLACE FUNCTION public.is_vehicle_listing_manager(
  p_listing_id uuid,
  p_uid uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.vehicle_listings vl
    LEFT JOIN public.drivers d ON d.id = vl.driver_id
    WHERE vl.id = p_listing_id
      AND (
        vl.owner_id = p_uid
        OR d.profile_id = p_uid
        OR public.is_pnd_admin(p_uid)
      )
  );
$$;

ALTER TABLE public.vehicle_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_availability_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vehicle_bookings ENABLE ROW LEVEL SECURITY;

-- 5a. vehicle_listings RLS
DROP POLICY IF EXISTS "Public views active vehicle listings" ON public.vehicle_listings;
CREATE POLICY "Public views active vehicle listings"
  ON public.vehicle_listings
  FOR SELECT
  USING (
    is_active = true
    OR auth.uid() = owner_id
    OR EXISTS (
      SELECT 1 FROM public.drivers d
      WHERE d.id = vehicle_listings.driver_id
        AND d.profile_id = auth.uid()
    )
    OR public.is_pnd_admin(auth.uid())
  );

DROP POLICY IF EXISTS "Owners drivers and admins can insert vehicle listings" ON public.vehicle_listings;
CREATE POLICY "Owners drivers and admins can insert vehicle listings"
  ON public.vehicle_listings
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = owner_id
    OR public.is_pnd_admin(auth.uid())
  );

DROP POLICY IF EXISTS "Owners drivers and admins can update own vehicle listings" ON public.vehicle_listings;
CREATE POLICY "Owners drivers and admins can update own vehicle listings"
  ON public.vehicle_listings
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = owner_id
    OR EXISTS (
      SELECT 1 FROM public.drivers d
      WHERE d.id = vehicle_listings.driver_id
        AND d.profile_id = auth.uid()
    )
    OR public.is_pnd_admin(auth.uid())
  )
  WITH CHECK (
    auth.uid() = owner_id
    OR EXISTS (
      SELECT 1 FROM public.drivers d
      WHERE d.id = vehicle_listings.driver_id
        AND d.profile_id = auth.uid()
    )
    OR public.is_pnd_admin(auth.uid())
  );

DROP POLICY IF EXISTS "Owners and admins can delete vehicle listings" ON public.vehicle_listings;
CREATE POLICY "Owners and admins can delete vehicle listings"
  ON public.vehicle_listings
  FOR DELETE
  TO authenticated
  USING (
    auth.uid() = owner_id
    OR public.is_pnd_admin(auth.uid())
  );

-- 5b. vehicle_availability_blocks RLS
DROP POLICY IF EXISTS "Public reads vehicle availability blocks" ON public.vehicle_availability_blocks;
CREATE POLICY "Public reads vehicle availability blocks"
  ON public.vehicle_availability_blocks
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Vehicle managers insert availability blocks" ON public.vehicle_availability_blocks;
CREATE POLICY "Vehicle managers insert availability blocks"
  ON public.vehicle_availability_blocks
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_vehicle_listing_manager(vehicle_listing_id, auth.uid())
  );

DROP POLICY IF EXISTS "Vehicle managers delete availability blocks" ON public.vehicle_availability_blocks;
CREATE POLICY "Vehicle managers delete availability blocks"
  ON public.vehicle_availability_blocks
  FOR DELETE
  TO authenticated
  USING (
    public.is_vehicle_listing_manager(vehicle_listing_id, auth.uid())
  );

-- 5c. vehicle_bookings RLS
DROP POLICY IF EXISTS "Customers vehicle managers and admins view bookings" ON public.vehicle_bookings;
CREATE POLICY "Customers vehicle managers and admins view bookings"
  ON public.vehicle_bookings
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = customer_id
    OR public.is_vehicle_listing_manager(vehicle_listing_id, auth.uid())
  );

DROP POLICY IF EXISTS "Vehicle managers and admins update booking lifecycle" ON public.vehicle_bookings;
CREATE POLICY "Vehicle managers and admins update booking lifecycle"
  ON public.vehicle_bookings
  FOR UPDATE
  TO authenticated
  USING (
    public.is_vehicle_listing_manager(vehicle_listing_id, auth.uid())
  )
  WITH CHECK (
    public.is_vehicle_listing_manager(vehicle_listing_id, auth.uid())
  );

-- =============================================================================
-- 6. Atomic SECURITY DEFINER RPC Functions
-- =============================================================================

-- 6a. create_vehicle_booking_with_intent(...)
CREATE OR REPLACE FUNCTION public.create_vehicle_booking_with_intent(
  p_vehicle_listing_id uuid,
  p_booking_mode text,
  p_seats_booked integer DEFAULT 1,
  p_start_time timestamptz DEFAULT NULL,
  p_end_time timestamptz DEFAULT NULL,
  p_pickup_location text DEFAULT '',
  p_dropoff_location text DEFAULT NULL,
  p_instructions text DEFAULT NULL,
  p_total_fare_inr numeric DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id uuid := auth.uid();
  v_listing record;
  v_requested_range tstzrange;
  v_has_block boolean := false;
  v_has_full_conflict boolean := false;
  v_existing_seats integer := 0;
  v_effective_seats integer := 1;
  v_total_fare numeric(10,2);
  v_advance_amount numeric(10,2);
  v_balance_due numeric(10,2);
  v_hold_until timestamptz := now() + interval '20 minutes';
  v_booking_code text;
  v_intent_code text;
  v_start_otp text;
  v_end_otp text;
  v_booking public.vehicle_bookings%ROWTYPE;
  v_intent public.payment_intents%ROWTYPE;
BEGIN
  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to book a vehicle.'
      USING ERRCODE = '42501';
  END IF;

  IF p_start_time IS NULL OR p_end_time IS NULL OR p_end_time <= p_start_time THEN
    RAISE EXCEPTION 'Valid start_time and end_time (end_time > start_time) are required.'
      USING ERRCODE = '22023';
  END IF;

  IF nullif(trim(coalesce(p_pickup_location, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Pickup location is required.'
      USING ERRCODE = '22023';
  END IF;

  IF p_booking_mode NOT IN ('full_vehicle', 'per_seat') THEN
    RAISE EXCEPTION 'booking_mode must be full_vehicle or per_seat.'
      USING ERRCODE = '22023';
  END IF;

  IF coalesce(p_seats_booked, 0) < 1 THEN
    RAISE EXCEPTION 'At least 1 seat must be booked.'
      USING ERRCODE = '22023';
  END IF;

  v_total_fare := round(coalesce(p_total_fare_inr, 0)::numeric, 2);
  IF v_total_fare < 0 THEN
    RAISE EXCEPTION 'Total fare cannot be negative.'
      USING ERRCODE = '22023';
  END IF;

  -- Lock vehicle listing row to serialize concurrent bookings on the same vehicle
  SELECT *
    INTO v_listing
  FROM public.vehicle_listings vl
  WHERE vl.id = p_vehicle_listing_id
  FOR UPDATE;

  IF NOT FOUND OR coalesce(v_listing.is_active, false) = false THEN
    RAISE EXCEPTION 'Vehicle listing not found or currently inactive.'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_listing.booking_mode <> 'both' AND v_listing.booking_mode <> p_booking_mode THEN
    RAISE EXCEPTION 'This vehicle only accepts % bookings.', v_listing.booking_mode
      USING ERRCODE = 'P0001';
  END IF;

  -- Step 1: Expire stale soft_hold bookings past their 20-minute hold window
  UPDATE public.vehicle_bookings
  SET
    status = 'expired',
    updated_at = now()
  WHERE status = 'soft_hold'
    AND hold_expires_at IS NOT NULL
    AND hold_expires_at < now();

  UPDATE public.payment_intents pi
  SET
    status = 'failed',
    updated_at = now()
  FROM public.vehicle_bookings vb
  WHERE pi.id = vb.payment_intent_id
    AND vb.status = 'expired'
    AND pi.status = 'awaiting_payment';

  v_requested_range := tstzrange(p_start_time, p_end_time, '[)');

  -- Step 2: Check manual offline-booking / maintenance availability blocks
  SELECT EXISTS (
    SELECT 1
    FROM public.vehicle_availability_blocks vab
    WHERE vab.vehicle_listing_id = p_vehicle_listing_id
      AND tstzrange(vab.start_time, vab.end_time, '[)') && v_requested_range
  )
  INTO v_has_block;

  IF v_has_block THEN
    RAISE EXCEPTION 'Vehicle is unavailable during the selected time window.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Step 3: Check active overlapping bookings
  IF p_booking_mode = 'full_vehicle' THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.vehicle_bookings vb
      WHERE vb.vehicle_listing_id = p_vehicle_listing_id
        AND vb.status IN ('soft_hold', 'pending_payment_confirm', 'confirmed', 'in_progress')
        AND tstzrange(vb.start_time, vb.end_time, '[)') && v_requested_range
    )
    INTO v_has_full_conflict;

    IF v_has_full_conflict THEN
      RAISE EXCEPTION 'Vehicle is unavailable during the selected time window.'
        USING ERRCODE = 'P0001';
    END IF;

    v_effective_seats := v_listing.total_seats;
  ELSE
    -- Per-seat mode: reject if any full_vehicle booking overlaps
    SELECT EXISTS (
      SELECT 1
      FROM public.vehicle_bookings vb
      WHERE vb.vehicle_listing_id = p_vehicle_listing_id
        AND vb.booking_mode = 'full_vehicle'
        AND vb.status IN ('soft_hold', 'pending_payment_confirm', 'confirmed', 'in_progress')
        AND tstzrange(vb.start_time, vb.end_time, '[)') && v_requested_range
    )
    INTO v_has_full_conflict;

    IF v_has_full_conflict THEN
      RAISE EXCEPTION 'Vehicle is unavailable during the selected time window.'
        USING ERRCODE = 'P0001';
    END IF;

    SELECT coalesce(sum(vb.seats_booked), 0)
      INTO v_existing_seats
    FROM public.vehicle_bookings vb
    WHERE vb.vehicle_listing_id = p_vehicle_listing_id
      AND vb.booking_mode = 'per_seat'
      AND vb.status IN ('soft_hold', 'pending_payment_confirm', 'confirmed', 'in_progress')
      AND tstzrange(vb.start_time, vb.end_time, '[)') && v_requested_range;

    IF (v_existing_seats + p_seats_booked) > v_listing.total_seats THEN
      RAISE EXCEPTION 'Only % seat(s) available during the selected time window.',
        greatest(0, v_listing.total_seats - v_existing_seats)
        USING ERRCODE = 'P0001';
    END IF;

    v_effective_seats := p_seats_booked;
  END IF;

  -- Step 4: Compute partial advance deposit and balance due
  v_advance_amount := round(v_total_fare * (coalesce(v_listing.advance_percent, 25) / 100.0));
  v_balance_due := greatest(0, v_total_fare - v_advance_amount);

  -- Step 5: Generate unique codes & cryptographic 6-digit Start/End OTPs
  v_booking_code := 'VBK-' || upper(substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 6));
  v_intent_code := 'PSL-' || upper(substr(md5(random()::text || gen_random_uuid()::text), 1, 6));
  v_start_otp := public.generate_6digit_otp();
  v_end_otp := public.generate_6digit_otp();

  -- Step 6: Insert soft-locked vehicle booking
  INSERT INTO public.vehicle_bookings (
    booking_code,
    vehicle_listing_id,
    customer_id,
    booking_mode,
    seats_booked,
    start_time,
    end_time,
    pickup_location,
    dropoff_location,
    instructions,
    total_fare_inr,
    advance_amount_inr,
    balance_due_inr,
    status,
    hold_expires_at,
    start_otp,
    end_otp
  )
  VALUES (
    v_booking_code,
    p_vehicle_listing_id,
    v_customer_id,
    p_booking_mode,
    v_effective_seats,
    p_start_time,
    p_end_time,
    trim(p_pickup_location),
    nullif(trim(coalesce(p_dropoff_location, '')), ''),
    nullif(trim(coalesce(p_instructions, '')), ''),
    v_total_fare,
    v_advance_amount,
    v_balance_due,
    'soft_hold',
    v_hold_until,
    v_start_otp,
    v_end_otp
  )
  RETURNING * INTO v_booking;

  -- Step 7: Insert linked central payment_intents row
  INSERT INTO public.payment_intents (
    intent_code,
    user_id,
    purpose,
    reference_id,
    amount_inr,
    provider,
    status,
    expires_at
  )
  VALUES (
    v_intent_code,
    v_customer_id,
    'vehicle_booking',
    v_booking.id,
    v_advance_amount,
    'manual_upi',
    'awaiting_payment',
    v_hold_until
  )
  RETURNING * INTO v_intent;

  -- Step 8: Link payment_intent_id back to booking
  UPDATE public.vehicle_bookings
  SET payment_intent_id = v_intent.id
  WHERE id = v_booking.id
  RETURNING * INTO v_booking;

  RETURN jsonb_build_object(
    'booking', to_jsonb(v_booking),
    'payment_intent', to_jsonb(v_intent)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.create_vehicle_booking_with_intent(
  uuid, text, integer, timestamptz, timestamptz, text, text, text, numeric
) TO authenticated;

-- 6b. fulfill_payment_intent(p_intent_id uuid, p_provider_payment_id text default null)
CREATE OR REPLACE FUNCTION public.fulfill_payment_intent(
  p_intent_id uuid,
  p_provider_payment_id text DEFAULT NULL
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
BEGIN
  IF NOT v_is_service AND NOT public.is_super_admin(v_caller_uid) THEN
    RAISE EXCEPTION 'Forbidden: Only Super Admin or verified payment webhook may fulfill payment intents.'
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

  -- Idempotency guard for webhook retries
  IF v_intent.status = 'succeeded' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'already_fulfilled', true,
      'payment_intent', to_jsonb(v_intent)
    );
  END IF;

  IF v_intent.status = 'refunded' THEN
    RAISE EXCEPTION 'Cannot fulfill a payment intent that has already been refunded.'
      USING ERRCODE = 'P0001';
  END IF;

  v_effective_payment_id := coalesce(
    nullif(trim(coalesce(p_provider_payment_id, '')), ''),
    v_intent.upi_utr_ref,
    v_intent.provider_payment_id
  );

  UPDATE public.payment_intents
  SET
    status = 'succeeded',
    verified_by = v_caller_uid,
    provider_payment_id = v_effective_payment_id,
    updated_at = now()
  WHERE id = p_intent_id
  RETURNING * INTO v_intent;

  -- Atomically fulfill downstream domain target
  IF v_intent.purpose = 'pick_n_drop' THEN
    UPDATE public.delivery_orders
    SET
      status = 'escrow_held',
      mediator_id = coalesce(mediator_id, v_caller_uid),
      updated_at = now()
    WHERE id = v_intent.reference_id
      AND status IN ('awaiting_payment', 'payment_submitted');

    INSERT INTO public.delivery_transactions (
      order_id,
      tx_type,
      amount_inr,
      upi_utr_ref,
      payment_proof_path,
      recorded_by,
      notes
    )
    VALUES (
      v_intent.reference_id,
      'escrow_hold',
      v_intent.amount_inr,
      coalesce(v_intent.upi_utr_ref, v_effective_payment_id),
      v_intent.payment_proof_path,
      v_caller_uid,
      'Fulfilled via payment intent ' || v_intent.intent_code
    );

    INSERT INTO public.delivery_order_events (
      order_id,
      actor_id,
      event_type,
      payload
    )
    VALUES (
      v_intent.reference_id,
      v_caller_uid,
      'escrow_held',
      jsonb_build_object(
        'intent_id', v_intent.id,
        'intent_code', v_intent.intent_code,
        'provider', v_intent.provider,
        'provider_payment_id', v_effective_payment_id,
        'amount_inr', v_intent.amount_inr
      )
    );

  ELSIF v_intent.purpose = 'vehicle_booking' THEN
    UPDATE public.vehicle_bookings
    SET
      status = 'confirmed',
      hold_expires_at = NULL,
      updated_at = now()
    WHERE id = v_intent.reference_id;

  ELSIF v_intent.purpose = 'bulletin_subscription' THEN
    UPDATE public.user_subscriptions
    SET
      status = 'active',
      verified_by = coalesce(v_caller_uid, verified_by),
      payment_ref = coalesce(v_effective_payment_id, payment_ref)
    WHERE id = v_intent.reference_id;

  ELSIF v_intent.purpose = 'bulletin_post_pass' THEN
    UPDATE public.bulletin_post_passes
    SET
      status = 'available',
      verified_by = coalesce(v_caller_uid, verified_by),
      upi_utr_ref = coalesce(v_intent.upi_utr_ref, v_effective_payment_id, upi_utr_ref)
    WHERE id = v_intent.reference_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'already_fulfilled', false,
    'purpose', v_intent.purpose,
    'reference_id', v_intent.reference_id,
    'payment_intent', to_jsonb(v_intent)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fulfill_payment_intent(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fulfill_payment_intent(uuid, text) TO service_role;

-- 6c. refund_payment_intent(p_intent_id uuid, p_refund_utr text, p_notes text default null)
CREATE OR REPLACE FUNCTION public.refund_payment_intent(
  p_intent_id uuid,
  p_refund_utr text,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_uid uuid := auth.uid();
  v_clean_utr text := trim(coalesce(p_refund_utr, ''));
  v_intent public.payment_intents%ROWTYPE;
BEGIN
  IF NOT public.is_super_admin(v_caller_uid) THEN
    RAISE EXCEPTION 'Forbidden: Only Super Admin may issue refunds.'
      USING ERRCODE = '42501';
  END IF;

  IF length(v_clean_utr) < 4 THEN
    RAISE EXCEPTION 'A valid refund UTR / reference is required.'
      USING ERRCODE = '22023';
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

  UPDATE public.payment_intents
  SET
    status = 'refunded',
    refund_utr_ref = v_clean_utr,
    refund_notes = nullif(trim(coalesce(p_notes, '')), ''),
    verified_by = coalesce(verified_by, v_caller_uid),
    updated_at = now()
  WHERE id = p_intent_id
  RETURNING * INTO v_intent;

  IF v_intent.purpose = 'vehicle_booking' THEN
    UPDATE public.vehicle_bookings
    SET
      status = 'cancelled',
      hold_expires_at = NULL,
      updated_at = now()
    WHERE id = v_intent.reference_id;

  ELSIF v_intent.purpose = 'pick_n_drop' THEN
    UPDATE public.delivery_orders
    SET
      status = 'cancelled',
      updated_at = now()
    WHERE id = v_intent.reference_id;

    INSERT INTO public.delivery_transactions (
      order_id,
      tx_type,
      amount_inr,
      upi_utr_ref,
      recorded_by,
      notes
    )
    VALUES (
      v_intent.reference_id,
      'refund',
      v_intent.amount_inr,
      v_clean_utr,
      v_caller_uid,
      coalesce(nullif(trim(coalesce(p_notes, '')), ''), 'Refund issued via Super Admin')
    );

    INSERT INTO public.delivery_order_events (
      order_id,
      actor_id,
      event_type,
      payload
    )
    VALUES (
      v_intent.reference_id,
      v_caller_uid,
      'payment_refunded',
      jsonb_build_object(
        'intent_id', v_intent.id,
        'intent_code', v_intent.intent_code,
        'refund_utr_ref', v_clean_utr,
        'refund_notes', nullif(trim(coalesce(p_notes, '')), '')
      )
    );

  ELSIF v_intent.purpose = 'bulletin_subscription' THEN
    UPDATE public.user_subscriptions
    SET status = 'cancelled'
    WHERE id = v_intent.reference_id;

  ELSIF v_intent.purpose = 'bulletin_post_pass' THEN
    UPDATE public.bulletin_post_passes
    SET status = 'rejected'
    WHERE id = v_intent.reference_id
      AND status <> 'used';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'payment_intent', to_jsonb(v_intent)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.refund_payment_intent(uuid, text, text) TO authenticated;

-- =============================================================================
-- 7. Idempotent Seed: 3 Sample Churachandpur Vehicle Listings
-- =============================================================================
DO $$
DECLARE
  v_seed_owner_id uuid;
  v_bolero_type_id uuid;
  v_van_type_id uuid;
  v_taxi_type_id uuid;
  v_any_type_id uuid;
BEGIN
  -- Resolve an existing profile to own seeded sample vehicles
  SELECT p.id
    INTO v_seed_owner_id
  FROM public.profiles p
  ORDER BY
    CASE p.role
      WHEN 'super_admin' THEN 1
      WHEN 'admin' THEN 2
      WHEN 'owner' THEN 3
      WHEN 'driver' THEN 4
      ELSE 5
    END,
    p.created_at ASC
  LIMIT 1;

  IF v_seed_owner_id IS NULL THEN
    RETURN;
  END IF;

  SELECT id INTO v_any_type_id FROM public.vehicle_types WHERE is_active = true LIMIT 1;
  IF v_any_type_id IS NULL THEN
    RETURN;
  END IF;

  SELECT coalesce(
    (SELECT id FROM public.vehicle_types WHERE slug = 'pickup_truck' LIMIT 1),
    v_any_type_id
  ) INTO v_bolero_type_id;

  SELECT coalesce(
    (SELECT id FROM public.vehicle_types WHERE slug = 'mini_van' LIMIT 1),
    v_any_type_id
  ) INTO v_van_type_id;

  SELECT coalesce(
    (SELECT id FROM public.vehicle_types WHERE slug = 'mini_van' LIMIT 1),
    (SELECT id FROM public.vehicle_types WHERE slug = 'e_rickshaw' LIMIT 1),
    v_any_type_id
  ) INTO v_taxi_type_id;

  -- Seed 1: Tuibong Stand Bolero 4WD Charter
  IF NOT EXISTS (
    SELECT 1 FROM public.vehicle_listings
    WHERE title = '[SAMPLE] Tuibong Stand Bolero 4WD Charter'
  ) THEN
    INSERT INTO public.vehicle_listings (
      owner_id,
      vehicle_type_id,
      title,
      description,
      stand_locality,
      lat,
      lng,
      booking_mode,
      total_seats,
      pricing_model,
      rate_hourly_inr,
      rate_daily_inr,
      rate_per_km_inr,
      fixed_routes,
      advance_percent,
      with_driver,
      features,
      thumbnail_url,
      image_urls,
      is_active,
      is_verified
    )
    VALUES (
      v_seed_owner_id,
      v_bolero_type_id,
      '[SAMPLE] Tuibong Stand Bolero 4WD Charter',
      'Hill-ready Mahindra Bolero 4WD stationed at Tuibong Bazaar Stand for full-day family charters, Singngat/Thanlon hill trips, and Imphal Airport transfers with experienced local driver.',
      'Tuibong',
      24.3515,
      93.7082,
      'full_vehicle',
      7,
      'daily',
      500.00,
      3200.00,
      18.00,
      '[
        {"origin": "Tuibong Stand", "destination": "Imphal Airport (Bir Tikendrajit)", "fare_inr": 2600, "duration_label": "2h 15m"},
        {"origin": "Tuibong Stand", "destination": "Imphal Keishampat", "fare_inr": 2800, "duration_label": "2h 30m"},
        {"origin": "Tuibong Stand", "destination": "Singngat Sub-Division", "fare_inr": 2400, "duration_label": "1h 45m"}
      ]'::jsonb,
      25,
      true,
      ARRAY['4WD Hill Ready', 'Roof Carrier', 'AC Cabin', 'Experienced Local Driver'],
      'https://images.unsplash.com/photo-1519641471654-76ce0107ad1b?auto=format&fit=crop&w=900&q=80',
      ARRAY['https://images.unsplash.com/photo-1519641471654-76ce0107ad1b?auto=format&fit=crop&w=900&q=80'],
      true,
      true
    );
  END IF;

  -- Seed 2: Lamka <-> Imphal Daily Winger Seat Service
  IF NOT EXISTS (
    SELECT 1 FROM public.vehicle_listings
    WHERE title = '[SAMPLE] Lamka ↔ Imphal Daily Winger Seat Service'
  ) THEN
    INSERT INTO public.vehicle_listings (
      owner_id,
      vehicle_type_id,
      title,
      description,
      stand_locality,
      lat,
      lng,
      booking_mode,
      total_seats,
      pricing_model,
      rate_hourly_inr,
      rate_daily_inr,
      rate_per_km_inr,
      fixed_routes,
      advance_percent,
      with_driver,
      features,
      thumbnail_url,
      image_urls,
      is_active,
      is_verified
    )
    VALUES (
      v_seed_owner_id,
      v_van_type_id,
      '[SAMPLE] Lamka ↔ Imphal Daily Winger Seat Service',
      'Reliable 12-seater Tata Winger departing Central Lamka Main Stand daily. Book individual seats for Imphal commutes or reserve the full vehicle for group travel and hospital trips.',
      'Central Lamka',
      24.3335,
      93.6978,
      'both',
      12,
      'fixed_route',
      650.00,
      4500.00,
      22.00,
      '[
        {"origin": "Lamka Main Stand", "destination": "Imphal Keishampat", "fare_inr": 300, "full_vehicle_fare_inr": 3600, "duration_label": "2h 15m"},
        {"origin": "Lamka Main Stand", "destination": "Imphal Airport (Drop)", "fare_inr": 350, "full_vehicle_fare_inr": 3800, "duration_label": "2h 00m"},
        {"origin": "Lamka Main Stand", "destination": "RIMS / Shija Hospital Imphal", "fare_inr": 380, "full_vehicle_fare_inr": 4200, "duration_label": "2h 40m"}
      ]'::jsonb,
      25,
      true,
      ARRAY['Per-Seat & Full Charter', 'Pushback Seats', 'Luggage Rack', 'Morning & Afternoon Departures'],
      'https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?auto=format&fit=crop&w=900&q=80',
      ARRAY['https://images.unsplash.com/photo-1544620347-c4fd4a3d5957?auto=format&fit=crop&w=900&q=80'],
      true,
      true
    );
  END IF;

  -- Seed 3: New Lamka City Alto / Taxi
  IF NOT EXISTS (
    SELECT 1 FROM public.vehicle_listings
    WHERE title = '[SAMPLE] New Lamka City Alto/Taxi'
  ) THEN
    INSERT INTO public.vehicle_listings (
      owner_id,
      vehicle_type_id,
      title,
      description,
      stand_locality,
      lat,
      lng,
      booking_mode,
      total_seats,
      pricing_model,
      rate_hourly_inr,
      rate_daily_inr,
      rate_per_km_inr,
      fixed_routes,
      advance_percent,
      with_driver,
      features,
      thumbnail_url,
      image_urls,
      is_active,
      is_verified
    )
    VALUES (
      v_seed_owner_id,
      v_taxi_type_id,
      '[SAMPLE] New Lamka City Alto/Taxi',
      'Clean, fuel-efficient Alto K10 local taxi stationed near New Lamka Central for hourly errands, District Hospital visits, Tuibong DC Office rounds, and Rengkai drops.',
      'New Lamka',
      24.3412,
      93.7024,
      'full_vehicle',
      4,
      'hourly',
      350.00,
      2200.00,
      16.00,
      '[
        {"origin": "New Lamka Central", "destination": "District Hospital Churachandpur", "fare_inr": 200, "duration_label": "15m"},
        {"origin": "New Lamka Central", "destination": "Tuibong DC Office", "fare_inr": 250, "duration_label": "20m"},
        {"origin": "New Lamka Central", "destination": "Rengkai Bazar", "fare_inr": 220, "duration_label": "18m"}
      ]'::jsonb,
      20,
      true,
      ARRAY['AC', 'Fast Local Pickup', 'Hourly & Point-to-Point', 'UPI Accepted'],
      'https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?auto=format&fit=crop&w=900&q=80',
      ARRAY['https://images.unsplash.com/photo-1549317661-bd32c8ce0db2?auto=format&fit=crop&w=900&q=80'],
      true,
      true
    );
  END IF;
END;
$$;
