-- =============================================================================
-- Migration: 20261119_phase66a_multi_hub_core.sql
-- Phase 66-A: Multi-Hub Core Schema (`service_hubs`, `hub_managers`,
--             `hub_requests`, `hub_vehicle_rates`), Safe Churachandpur Backfill,
--             PostGIS `detect_nearest_hub` RPC, Hub-Scoped RBAC/RLS &
--             Delegated Payment Fulfillment
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Required Extensions & Timestamp Helper
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.set_phase66_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- =============================================================================
-- 1. Core Multi-Hub Tables
-- =============================================================================

-- 1a. public.service_hubs
CREATE TABLE IF NOT EXISTS public.service_hubs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  state text NOT NULL,
  center_lat double precision NOT NULL,
  center_lng double precision NOT NULL,
  center_point geography(Point, 4326),
  service_radius_km numeric(6,2) NOT NULL DEFAULT 25 CHECK (service_radius_km > 0),
  default_zoom integer NOT NULL DEFAULT 14 CHECK (default_zoom BETWEEN 3 AND 20),
  supported_languages text[] NOT NULL DEFAULT ARRAY['en'],
  default_language text NOT NULL DEFAULT 'en',
  office_contact jsonb NOT NULL DEFAULT '{}'::jsonb,
  manual_upi_override jsonb,
  module_switches jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active' CHECK (
    status IN ('active', 'coming_soon', 'paused')
  ),
  is_default boolean NOT NULL DEFAULT false,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.sync_service_hub_center_point()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  IF NEW.center_lat IS NOT NULL AND NEW.center_lng IS NOT NULL THEN
    NEW.center_point := ST_SetSRID(ST_MakePoint(NEW.center_lng, NEW.center_lat), 4326)::geography;
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_service_hubs_center_point ON public.service_hubs;
CREATE TRIGGER trg_service_hubs_center_point
  BEFORE INSERT OR UPDATE ON public.service_hubs
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_service_hub_center_point();

CREATE INDEX IF NOT EXISTS idx_service_hubs_status_sort
  ON public.service_hubs (status, sort_order ASC);

CREATE INDEX IF NOT EXISTS idx_service_hubs_center_point_gist
  ON public.service_hubs USING GIST (center_point);

-- 1b. public.hub_managers
CREATE TABLE IF NOT EXISTS public.hub_managers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  hub_id uuid NOT NULL REFERENCES public.service_hubs(id) ON DELETE CASCADE,
  can_confirm_manual_payments boolean NOT NULL DEFAULT false,
  can_edit_rates boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  assigned_by uuid REFERENCES public.profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (profile_id, hub_id)
);

DROP TRIGGER IF EXISTS trg_hub_managers_updated_at ON public.hub_managers;
CREATE TRIGGER trg_hub_managers_updated_at
  BEFORE UPDATE ON public.hub_managers
  FOR EACH ROW
  EXECUTE FUNCTION public.set_phase66_updated_at();

CREATE INDEX IF NOT EXISTS idx_hub_managers_profile_active
  ON public.hub_managers (profile_id, is_active);

CREATE INDEX IF NOT EXISTS idx_hub_managers_hub_active
  ON public.hub_managers (hub_id, is_active);

-- 1c. public.hub_requests (Out-of-Area Expansion Demand Capture)
CREATE TABLE IF NOT EXISTS public.hub_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  requested_city text NOT NULL,
  state text,
  lat double precision,
  lng double precision,
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  contact_info text,
  notes text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hub_requests_created_at
  ON public.hub_requests (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_hub_requests_city_lower
  ON public.hub_requests (lower(requested_city));

-- 1d. public.hub_vehicle_rates (Per-Hub Fleet Pricing & Availability Overrides)
CREATE TABLE IF NOT EXISTS public.hub_vehicle_rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id uuid NOT NULL REFERENCES public.service_hubs(id) ON DELETE CASCADE,
  vehicle_type_id uuid NOT NULL REFERENCES public.vehicle_types(id) ON DELETE CASCADE,
  is_enabled_in_hub boolean NOT NULL DEFAULT true,
  base_fare_inr numeric(10,2) NOT NULL CHECK (base_fare_inr >= 0),
  per_km_rate_inr numeric(10,2) NOT NULL CHECK (per_km_rate_inr >= 0),
  wait_per_10min_inr numeric(10,2) NOT NULL DEFAULT 20 CHECK (wait_per_10min_inr >= 0),
  free_wait_minutes integer NOT NULL DEFAULT 15 CHECK (free_wait_minutes >= 0),
  two_way_multiplier numeric(4,2) NOT NULL DEFAULT 1.75 CHECK (two_way_multiplier >= 1.0),
  surcharges_override jsonb DEFAULT '{}'::jsonb,
  updated_at timestamptz DEFAULT now(),
  UNIQUE (hub_id, vehicle_type_id)
);

DROP TRIGGER IF EXISTS trg_hub_vehicle_rates_updated_at ON public.hub_vehicle_rates;
CREATE TRIGGER trg_hub_vehicle_rates_updated_at
  BEFORE UPDATE ON public.hub_vehicle_rates
  FOR EACH ROW
  EXECUTE FUNCTION public.set_phase66_updated_at();

CREATE INDEX IF NOT EXISTS idx_hub_vehicle_rates_hub_enabled
  ON public.hub_vehicle_rates (hub_id, is_enabled_in_hub);

-- =============================================================================
-- 2. Seed Initial Hubs & Hub Vehicle Rates (Idempotent)
-- =============================================================================

INSERT INTO public.service_hubs (
  slug,
  name,
  state,
  center_lat,
  center_lng,
  service_radius_km,
  default_zoom,
  supported_languages,
  default_language,
  office_contact,
  module_switches,
  status,
  is_default,
  sort_order
)
VALUES
  (
    'churachandpur',
    'Churachandpur',
    'Manipur',
    24.3333,
    93.6833,
    25.00,
    14,
    ARRAY['en', 'paite', 'manipuri'],
    'en',
    '{
      "address": "Central Lamka, Churachandpur, Manipur 795128",
      "operating_hours": "Mon–Sat, 8:00 AM – 8:00 PM"
    }'::jsonb,
    '{}'::jsonb,
    'active',
    true,
    1
  ),
  (
    'aizawl',
    'Aizawl',
    'Mizoram',
    23.7271,
    92.7176,
    25.00,
    14,
    ARRAY['en', 'mizo'],
    'en',
    '{
      "address": "Zarkawt, Aizawl, Mizoram 796007",
      "operating_hours": "Mon–Sat, 8:00 AM – 8:00 PM"
    }'::jsonb,
    '{}'::jsonb,
    'active',
    false,
    2
  ),
  (
    'imphal',
    'Imphal',
    'Manipur',
    24.8170,
    93.9368,
    30.00,
    13,
    ARRAY['en', 'manipuri'],
    'en',
    '{
      "address": "Paona Bazar, Imphal, Manipur 795001",
      "operating_hours": "Mon–Sat, 8:00 AM – 8:00 PM"
    }'::jsonb,
    '{}'::jsonb,
    'coming_soon',
    false,
    3
  )
ON CONFLICT (slug) DO NOTHING;

-- Seed hub_vehicle_rates from existing vehicle_types for Churachandpur & Aizawl
DO $$
DECLARE
  v_ccpur_id uuid;
  v_aizawl_id uuid;
BEGIN
  SELECT id INTO v_ccpur_id FROM public.service_hubs WHERE slug = 'churachandpur' LIMIT 1;
  SELECT id INTO v_aizawl_id FROM public.service_hubs WHERE slug = 'aizawl' LIMIT 1;

  IF v_ccpur_id IS NOT NULL THEN
    INSERT INTO public.hub_vehicle_rates (
      hub_id,
      vehicle_type_id,
      is_enabled_in_hub,
      base_fare_inr,
      per_km_rate_inr,
      wait_per_10min_inr,
      free_wait_minutes,
      two_way_multiplier,
      surcharges_override
    )
    SELECT
      v_ccpur_id,
      vt.id,
      true,
      vt.base_fare_inr,
      vt.per_km_rate_inr,
      vt.wait_per_10min_inr,
      vt.free_wait_minutes,
      vt.two_way_multiplier,
      '{}'::jsonb
    FROM public.vehicle_types vt
    ON CONFLICT (hub_id, vehicle_type_id) DO NOTHING;
  END IF;

  IF v_aizawl_id IS NOT NULL THEN
    INSERT INTO public.hub_vehicle_rates (
      hub_id,
      vehicle_type_id,
      is_enabled_in_hub,
      base_fare_inr,
      per_km_rate_inr,
      wait_per_10min_inr,
      free_wait_minutes,
      two_way_multiplier,
      surcharges_override
    )
    SELECT
      v_aizawl_id,
      vt.id,
      CASE WHEN vt.slug = 'cycle_rickshaw' THEN false ELSE true END,
      round((vt.base_fare_inr * 1.10)::numeric, 2),
      round((vt.per_km_rate_inr * 1.25)::numeric, 2),
      vt.wait_per_10min_inr,
      vt.free_wait_minutes,
      vt.two_way_multiplier,
      '{"hill_terrain_factor": 1.25}'::jsonb
    FROM public.vehicle_types vt
    ON CONFLICT (hub_id, vehicle_type_id) DO NOTHING;
  END IF;
END;
$$;

-- =============================================================================
-- 3. Interlink All Existing Tables to `service_hubs` & Safe Backfill
-- =============================================================================

-- 3a. Expand public.profiles.role CHECK constraint to include 'hub_manager'
--     and add default_hub_id
DO $$
DECLARE
  v_constraint record;
BEGIN
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
  ADD CONSTRAINT profiles_role_check
  CHECK (
    role IN (
      'visitor',
      'driver',
      'staff',
      'owner',
      'hub_manager',
      'admin',
      'super_admin'
    )
  ) NOT VALID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE role NOT IN (
      'visitor', 'driver', 'staff', 'owner', 'hub_manager', 'admin', 'super_admin'
    )
  ) THEN
    ALTER TABLE public.profiles VALIDATE CONSTRAINT profiles_role_check;
  END IF;
END;
$$;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS default_hub_id uuid REFERENCES public.service_hubs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_default_hub_id
  ON public.profiles (default_hub_id);

-- 3b. Add hub_id (with indexes) to core single-hub tables
ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS hub_id uuid REFERENCES public.service_hubs(id);
CREATE INDEX IF NOT EXISTS idx_listings_hub_id
  ON public.listings (hub_id);

ALTER TABLE public.marketplace_products
  ADD COLUMN IF NOT EXISTS hub_id uuid REFERENCES public.service_hubs(id);
CREATE INDEX IF NOT EXISTS idx_marketplace_products_hub_id
  ON public.marketplace_products (hub_id);

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS hub_id uuid REFERENCES public.service_hubs(id);
CREATE INDEX IF NOT EXISTS idx_drivers_hub_id
  ON public.drivers (hub_id);

ALTER TABLE public.vehicles
  ADD COLUMN IF NOT EXISTS hub_id uuid REFERENCES public.service_hubs(id);
CREATE INDEX IF NOT EXISTS idx_vehicles_hub_id
  ON public.vehicles (hub_id);

ALTER TABLE public.delivery_orders
  ADD COLUMN IF NOT EXISTS hub_id uuid REFERENCES public.service_hubs(id);
CREATE INDEX IF NOT EXISTS idx_delivery_orders_hub_id
  ON public.delivery_orders (hub_id);

ALTER TABLE public.payment_intents
  ADD COLUMN IF NOT EXISTS hub_id uuid REFERENCES public.service_hubs(id);
CREATE INDEX IF NOT EXISTS idx_payment_intents_hub_id
  ON public.payment_intents (hub_id);

ALTER TABLE public.delivery_transactions
  ADD COLUMN IF NOT EXISTS hub_id uuid REFERENCES public.service_hubs(id);
CREATE INDEX IF NOT EXISTS idx_delivery_transactions_hub_id
  ON public.delivery_transactions (hub_id);

ALTER TABLE public.user_interests
  ADD COLUMN IF NOT EXISTS hub_id uuid REFERENCES public.service_hubs(id);
CREATE INDEX IF NOT EXISTS idx_user_interests_hub_id
  ON public.user_interests (hub_id);

-- 3c. Add multi-hub targeting columns to Bulletins, Vehicles, Bookings, Banners, Announcements & Promos
ALTER TABLE public.bulletins
  ADD COLUMN IF NOT EXISTS hub_id uuid REFERENCES public.service_hubs(id),
  ADD COLUMN IF NOT EXISTS target_hub_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS is_global boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_bulletins_hub_id
  ON public.bulletins (hub_id);
CREATE INDEX IF NOT EXISTS idx_bulletins_target_hub_ids_gin
  ON public.bulletins USING GIN (target_hub_ids);

ALTER TABLE public.vehicle_listings
  ADD COLUMN IF NOT EXISTS origin_hub_id uuid REFERENCES public.service_hubs(id),
  ADD COLUMN IF NOT EXISTS destination_hub_ids uuid[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_vehicle_listings_origin_hub_id
  ON public.vehicle_listings (origin_hub_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_listings_dest_hub_ids_gin
  ON public.vehicle_listings USING GIN (destination_hub_ids);

ALTER TABLE public.vehicle_bookings
  ADD COLUMN IF NOT EXISTS hub_id uuid REFERENCES public.service_hubs(id);

CREATE INDEX IF NOT EXISTS idx_vehicle_bookings_hub_id
  ON public.vehicle_bookings (hub_id);

ALTER TABLE public.app_banners
  ADD COLUMN IF NOT EXISTS target_hub_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS is_global boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_app_banners_target_hub_ids_gin
  ON public.app_banners USING GIN (target_hub_ids);

ALTER TABLE public.app_announcements
  ADD COLUMN IF NOT EXISTS target_hub_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS is_global boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_app_announcements_target_hub_ids_gin
  ON public.app_announcements USING GIN (target_hub_ids);

ALTER TABLE public.promo_codes
  ADD COLUMN IF NOT EXISTS target_hub_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS is_global boolean NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS idx_promo_codes_target_hub_ids_gin
  ON public.promo_codes USING GIN (target_hub_ids);

-- 3d. Safe Backfill: Assign all existing NULL hub rows to Churachandpur hub (zero data loss)
DO $$
DECLARE
  v_ccpur_id uuid;
BEGIN
  SELECT id INTO v_ccpur_id
  FROM public.service_hubs
  WHERE slug = 'churachandpur'
  LIMIT 1;

  IF v_ccpur_id IS NULL THEN
    RETURN;
  END IF;

  UPDATE public.listings
    SET hub_id = v_ccpur_id
    WHERE hub_id IS NULL;

  UPDATE public.marketplace_products mp
    SET hub_id = COALESCE(
      (SELECT l.hub_id FROM public.listings l WHERE l.id = mp.listing_id),
      v_ccpur_id
    )
    WHERE mp.hub_id IS NULL;

  UPDATE public.drivers
    SET hub_id = v_ccpur_id
    WHERE hub_id IS NULL;

  UPDATE public.vehicles
    SET hub_id = v_ccpur_id
    WHERE hub_id IS NULL;

  UPDATE public.delivery_orders
    SET hub_id = v_ccpur_id
    WHERE hub_id IS NULL;

  UPDATE public.payment_intents
    SET hub_id = v_ccpur_id
    WHERE hub_id IS NULL;

  UPDATE public.delivery_transactions
    SET hub_id = v_ccpur_id
    WHERE hub_id IS NULL;

  UPDATE public.user_interests
    SET hub_id = v_ccpur_id
    WHERE hub_id IS NULL;

  UPDATE public.bulletins
    SET hub_id = v_ccpur_id
    WHERE hub_id IS NULL;

  UPDATE public.bulletins
    SET target_hub_ids = ARRAY[COALESCE(hub_id, v_ccpur_id)]
    WHERE target_hub_ids IS NULL OR cardinality(target_hub_ids) = 0;

  UPDATE public.vehicle_listings
    SET origin_hub_id = v_ccpur_id
    WHERE origin_hub_id IS NULL;

  UPDATE public.vehicle_bookings vb
    SET hub_id = COALESCE(
      (SELECT vl.origin_hub_id FROM public.vehicle_listings vl WHERE vl.id = vb.vehicle_listing_id),
      v_ccpur_id
    )
    WHERE vb.hub_id IS NULL;
END;
$$;

-- 3e. Auto-Sync Trigger on marketplace_products (always inherits parent listing's hub_id)
CREATE OR REPLACE FUNCTION public.sync_marketplace_product_hub_id()
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

  NEW.hub_id := v_parent_hub_id;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_marketplace_products_sync_hub_id ON public.marketplace_products;
CREATE TRIGGER trg_marketplace_products_sync_hub_id
  BEFORE INSERT OR UPDATE ON public.marketplace_products
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_marketplace_product_hub_id();

-- Keep marketplace_products.hub_id in sync if a listing's hub_id is later reassigned
CREATE OR REPLACE FUNCTION public.cascade_listing_hub_id_to_products()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.hub_id IS DISTINCT FROM OLD.hub_id THEN
    UPDATE public.marketplace_products
    SET hub_id = NEW.hub_id
    WHERE listing_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_listings_cascade_hub_id ON public.listings;
CREATE TRIGGER trg_listings_cascade_hub_id
  AFTER UPDATE OF hub_id ON public.listings
  FOR EACH ROW
  EXECUTE FUNCTION public.cascade_listing_hub_id_to_products();

-- =============================================================================
-- 4. Helper SQL Functions, Spatial Hub Detection RPC & Upgraded RPCs
-- =============================================================================

-- 4a. Zero-argument is_super_admin() (coexists cleanly with existing 1-arg overload)
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'super_admin'
  );
$$;

-- 4b. is_hub_manager_for(p_hub_id uuid)
CREATE OR REPLACE FUNCTION public.is_hub_manager_for(p_hub_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_super_admin()
    OR (
      p_hub_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.hub_managers hm
        WHERE hm.profile_id = auth.uid()
          AND hm.hub_id = p_hub_id
          AND hm.is_active = true
      )
    );
$$;

-- 4c. can_confirm_hub_payment(p_hub_id uuid)
CREATE OR REPLACE FUNCTION public.can_confirm_hub_payment(p_hub_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_super_admin()
    OR (
      p_hub_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.hub_managers hm
        WHERE hm.profile_id = auth.uid()
          AND hm.hub_id = p_hub_id
          AND hm.is_active = true
          AND hm.can_confirm_manual_payments = true
      )
    );
$$;

-- 4d. can_edit_hub_rates(p_hub_id uuid)
CREATE OR REPLACE FUNCTION public.can_edit_hub_rates(p_hub_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_super_admin()
    OR (
      p_hub_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.hub_managers hm
        WHERE hm.profile_id = auth.uid()
          AND hm.hub_id = p_hub_id
          AND hm.is_active = true
          AND hm.can_edit_rates = true
      )
    );
$$;

GRANT EXECUTE ON FUNCTION public.is_super_admin() TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_hub_manager_for(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_confirm_hub_payment(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.can_edit_hub_rates(uuid) TO authenticated;

-- 4e. Spatial Hub Detection RPC: detect_nearest_hub(p_lat, p_lng)
CREATE OR REPLACE FUNCTION public.detect_nearest_hub(
  p_lat double precision,
  p_lng double precision
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_user_point geography(Point, 4326);
  v_nearest record;
  v_distance_km numeric(10,2);
  v_is_within boolean := false;
  v_hub_json jsonb;
BEGIN
  IF p_lat IS NULL OR p_lng IS NULL
     OR p_lat < -90 OR p_lat > 90
     OR p_lng < -180 OR p_lng > 180 THEN
    RAISE EXCEPTION 'Valid WGS84 coordinates (p_lat, p_lng) are required.'
      USING ERRCODE = '22023';
  END IF;

  v_user_point := ST_SetSRID(ST_MakePoint(p_lng, p_lat), 4326)::geography;

  SELECT
    h.id,
    h.slug,
    h.name,
    h.state,
    h.center_lat,
    h.center_lng,
    h.service_radius_km,
    h.default_zoom,
    h.supported_languages,
    h.default_language,
    h.office_contact,
    h.module_switches,
    h.status,
    h.is_default,
    h.sort_order,
    round(
      (
        ST_Distance(
          COALESCE(h.center_point, ST_SetSRID(ST_MakePoint(h.center_lng, h.center_lat), 4326)::geography),
          v_user_point
        ) / 1000.0
      )::numeric,
      2
    ) AS dist_km
  INTO v_nearest
  FROM public.service_hubs h
  WHERE h.status = 'active'
  ORDER BY dist_km ASC, h.sort_order ASC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'matched_hub', NULL,
      'nearest_hub', NULL,
      'distance_km', NULL,
      'is_within_service_area', false
    );
  END IF;

  v_distance_km := v_nearest.dist_km;
  v_is_within := (v_distance_km <= v_nearest.service_radius_km);

  v_hub_json := jsonb_build_object(
    'id', v_nearest.id,
    'slug', v_nearest.slug,
    'name', v_nearest.name,
    'state', v_nearest.state,
    'center_lat', v_nearest.center_lat,
    'center_lng', v_nearest.center_lng,
    'service_radius_km', v_nearest.service_radius_km,
    'default_zoom', v_nearest.default_zoom,
    'supported_languages', v_nearest.supported_languages,
    'default_language', v_nearest.default_language,
    'office_contact', v_nearest.office_contact,
    'module_switches', v_nearest.module_switches,
    'status', v_nearest.status,
    'is_default', v_nearest.is_default,
    'sort_order', v_nearest.sort_order
  );

  RETURN jsonb_build_object(
    'matched_hub', CASE WHEN v_is_within THEN v_hub_json ELSE NULL END,
    'nearest_hub', v_hub_json,
    'distance_km', v_distance_km,
    'is_within_service_area', v_is_within
  );
END;
$$;

REVOKE ALL ON FUNCTION public.detect_nearest_hub(double precision, double precision) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.detect_nearest_hub(double precision, double precision) TO anon, authenticated;

-- 4f. Protect payment_intents.hub_id from tampering by non-admin users
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

-- 4g. Upgrade fulfill_payment_intent to support delegated Hub Managers
--     (service_role OR is_super_admin() OR can_confirm_hub_payment(intent.hub_id))
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
BEGIN
  -- Pre-flight privilege gate so unprivileged callers cannot probe arbitrary intent UUIDs
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

  -- Row-level lock guarantees strict idempotency between browser verify and webhook retries
  SELECT *
    INTO v_intent
  FROM public.payment_intents
  WHERE id = p_intent_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment intent not found.'
      USING ERRCODE = 'P0002';
  END IF;

  -- Strictly verify per-hub manual payment confirmation delegation for this intent's hub
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

  -- Atomically increment promo code redemption count once on transition to succeeded
  IF v_intent.promo_code_id IS NOT NULL THEN
    UPDATE public.promo_codes
    SET used_count = used_count + 1
    WHERE id = v_intent.promo_code_id;
  END IF;

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
      hub_id,
      tx_type,
      amount_inr,
      upi_utr_ref,
      payment_proof_path,
      recorded_by,
      notes
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
        'hub_id', v_intent.hub_id,
        'provider', v_intent.provider,
        'provider_payment_id', v_effective_payment_id,
        'amount_inr', v_intent.amount_inr,
        'discount_inr', v_intent.discount_inr,
        'convenience_fee_inr', v_intent.convenience_fee_inr
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
    'intent_id', v_intent.id,
    'purpose', v_intent.purpose,
    'reference_id', v_intent.reference_id,
    'payment_intent', to_jsonb(v_intent)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fulfill_payment_intent(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fulfill_payment_intent(uuid, text, text) TO service_role;

-- 4h. Upgrade superadmin_set_user_role RPC to allow assigning 'hub_manager'
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
  IF v_caller_id IS NULL OR NOT public.is_super_admin() THEN
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
    'hub_manager',
    'admin',
    'super_admin'
  ) THEN
    RAISE EXCEPTION 'Invalid role "%". Allowed roles: visitor, driver, staff, owner, hub_manager, admin, super_admin.',
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

-- =============================================================================
-- 5. Row-Level Security Policies (New Multi-Hub Tables & Hub-Scoped Governance)
-- =============================================================================

-- 5a. service_hubs RLS + column-level guard trigger for hub_manager updates
CREATE OR REPLACE FUNCTION public.guard_service_hub_manager_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('role', true) = 'service_role'
     OR public.is_super_admin() THEN
    RETURN NEW;
  END IF;

  -- Non-super_admin hub managers may ONLY update office_contact and module_switches
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.slug IS DISTINCT FROM OLD.slug
     OR NEW.name IS DISTINCT FROM OLD.name
     OR NEW.state IS DISTINCT FROM OLD.state
     OR NEW.center_lat IS DISTINCT FROM OLD.center_lat
     OR NEW.center_lng IS DISTINCT FROM OLD.center_lng
     OR NEW.service_radius_km IS DISTINCT FROM OLD.service_radius_km
     OR NEW.default_zoom IS DISTINCT FROM OLD.default_zoom
     OR NEW.supported_languages IS DISTINCT FROM OLD.supported_languages
     OR NEW.default_language IS DISTINCT FROM OLD.default_language
     OR NEW.manual_upi_override IS DISTINCT FROM OLD.manual_upi_override
     OR NEW.status IS DISTINCT FROM OLD.status
     OR NEW.is_default IS DISTINCT FROM OLD.is_default
     OR NEW.sort_order IS DISTINCT FROM OLD.sort_order THEN
    RAISE EXCEPTION 'Hub managers may only edit office_contact and module_switches on their assigned hub.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_service_hub_manager_update ON public.service_hubs;
CREATE TRIGGER trg_guard_service_hub_manager_update
  BEFORE UPDATE ON public.service_hubs
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_service_hub_manager_update();

ALTER TABLE public.service_hubs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public reads active and coming soon service hubs" ON public.service_hubs;
CREATE POLICY "Public reads active and coming soon service hubs"
  ON public.service_hubs
  FOR SELECT
  USING (status IN ('active', 'coming_soon'));

DROP POLICY IF EXISTS "Super admin manages all service hubs" ON public.service_hubs;
CREATE POLICY "Super admin manages all service hubs"
  ON public.service_hubs
  FOR ALL
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "Hub managers view assigned service hub" ON public.service_hubs;
CREATE POLICY "Hub managers view assigned service hub"
  ON public.service_hubs
  FOR SELECT
  TO authenticated
  USING (public.is_hub_manager_for(id));

DROP POLICY IF EXISTS "Hub managers update assigned hub contact and module switches" ON public.service_hubs;
CREATE POLICY "Hub managers update assigned hub contact and module switches"
  ON public.service_hubs
  FOR UPDATE
  TO authenticated
  USING (public.is_hub_manager_for(id))
  WITH CHECK (public.is_hub_manager_for(id));

-- 5b. hub_managers RLS
ALTER TABLE public.hub_managers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own hub manager assignments" ON public.hub_managers;
CREATE POLICY "Users view own hub manager assignments"
  ON public.hub_managers
  FOR SELECT
  TO authenticated
  USING (profile_id = auth.uid());

DROP POLICY IF EXISTS "Super admin manages all hub managers" ON public.hub_managers;
CREATE POLICY "Super admin manages all hub managers"
  ON public.hub_managers
  FOR ALL
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- 5c. hub_requests RLS
ALTER TABLE public.hub_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone can submit hub expansion requests" ON public.hub_requests;
CREATE POLICY "Anyone can submit hub expansion requests"
  ON public.hub_requests
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (user_id IS NULL OR user_id = auth.uid());

DROP POLICY IF EXISTS "Super admin views hub expansion requests" ON public.hub_requests;
CREATE POLICY "Super admin views hub expansion requests"
  ON public.hub_requests
  FOR SELECT
  TO authenticated
  USING (public.is_super_admin());

DROP POLICY IF EXISTS "Super admin deletes hub expansion requests" ON public.hub_requests;
CREATE POLICY "Super admin deletes hub expansion requests"
  ON public.hub_requests
  FOR DELETE
  TO authenticated
  USING (public.is_super_admin());

-- 5d. hub_vehicle_rates RLS
ALTER TABLE public.hub_vehicle_rates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public reads hub vehicle rates" ON public.hub_vehicle_rates;
CREATE POLICY "Public reads hub vehicle rates"
  ON public.hub_vehicle_rates
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Super admin manages all hub vehicle rates" ON public.hub_vehicle_rates;
CREATE POLICY "Super admin manages all hub vehicle rates"
  ON public.hub_vehicle_rates
  FOR ALL
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "Delegated hub managers update hub vehicle rates" ON public.hub_vehicle_rates;
CREATE POLICY "Delegated hub managers update hub vehicle rates"
  ON public.hub_vehicle_rates
  FOR UPDATE
  TO authenticated
  USING (public.can_edit_hub_rates(hub_id))
  WITH CHECK (public.can_edit_hub_rates(hub_id));

-- 5e. Hub-Scoped RLS Policies for hub_manager across Core Domain Tables

-- listings
DROP POLICY IF EXISTS "Hub managers view hub listings" ON public.listings;
CREATE POLICY "Hub managers view hub listings"
  ON public.listings
  FOR SELECT
  TO authenticated
  USING (public.is_hub_manager_for(hub_id));

DROP POLICY IF EXISTS "Hub managers update hub listings" ON public.listings;
CREATE POLICY "Hub managers update hub listings"
  ON public.listings
  FOR UPDATE
  TO authenticated
  USING (public.is_hub_manager_for(hub_id))
  WITH CHECK (public.is_hub_manager_for(hub_id));

-- marketplace_products
DROP POLICY IF EXISTS "Hub managers view hub marketplace products" ON public.marketplace_products;
CREATE POLICY "Hub managers view hub marketplace products"
  ON public.marketplace_products
  FOR SELECT
  TO authenticated
  USING (public.is_hub_manager_for(hub_id));

DROP POLICY IF EXISTS "Hub managers update hub marketplace products" ON public.marketplace_products;
CREATE POLICY "Hub managers update hub marketplace products"
  ON public.marketplace_products
  FOR UPDATE
  TO authenticated
  USING (public.is_hub_manager_for(hub_id))
  WITH CHECK (public.is_hub_manager_for(hub_id));

-- drivers
DROP POLICY IF EXISTS "Hub managers view hub drivers" ON public.drivers;
CREATE POLICY "Hub managers view hub drivers"
  ON public.drivers
  FOR SELECT
  TO authenticated
  USING (public.is_hub_manager_for(hub_id));

DROP POLICY IF EXISTS "Hub managers update hub drivers" ON public.drivers;
CREATE POLICY "Hub managers update hub drivers"
  ON public.drivers
  FOR UPDATE
  TO authenticated
  USING (public.is_hub_manager_for(hub_id))
  WITH CHECK (public.is_hub_manager_for(hub_id));

-- vehicles
DROP POLICY IF EXISTS "Hub managers view hub vehicles" ON public.vehicles;
CREATE POLICY "Hub managers view hub vehicles"
  ON public.vehicles
  FOR SELECT
  TO authenticated
  USING (public.is_hub_manager_for(hub_id));

DROP POLICY IF EXISTS "Hub managers update hub vehicles" ON public.vehicles;
CREATE POLICY "Hub managers update hub vehicles"
  ON public.vehicles
  FOR UPDATE
  TO authenticated
  USING (public.is_hub_manager_for(hub_id))
  WITH CHECK (public.is_hub_manager_for(hub_id));

-- delivery_orders
DROP POLICY IF EXISTS "Hub managers view hub delivery orders" ON public.delivery_orders;
CREATE POLICY "Hub managers view hub delivery orders"
  ON public.delivery_orders
  FOR SELECT
  TO authenticated
  USING (public.is_hub_manager_for(hub_id));

DROP POLICY IF EXISTS "Hub managers update hub delivery orders" ON public.delivery_orders;
CREATE POLICY "Hub managers update hub delivery orders"
  ON public.delivery_orders
  FOR UPDATE
  TO authenticated
  USING (public.is_hub_manager_for(hub_id))
  WITH CHECK (public.is_hub_manager_for(hub_id));

-- vehicle_listings
DROP POLICY IF EXISTS "Hub managers view hub vehicle listings" ON public.vehicle_listings;
CREATE POLICY "Hub managers view hub vehicle listings"
  ON public.vehicle_listings
  FOR SELECT
  TO authenticated
  USING (public.is_hub_manager_for(origin_hub_id));

DROP POLICY IF EXISTS "Hub managers update hub vehicle listings" ON public.vehicle_listings;
CREATE POLICY "Hub managers update hub vehicle listings"
  ON public.vehicle_listings
  FOR UPDATE
  TO authenticated
  USING (public.is_hub_manager_for(origin_hub_id))
  WITH CHECK (public.is_hub_manager_for(origin_hub_id));

-- vehicle_bookings
DROP POLICY IF EXISTS "Hub managers view hub vehicle bookings" ON public.vehicle_bookings;
CREATE POLICY "Hub managers view hub vehicle bookings"
  ON public.vehicle_bookings
  FOR SELECT
  TO authenticated
  USING (public.is_hub_manager_for(hub_id));

DROP POLICY IF EXISTS "Hub managers update hub vehicle bookings" ON public.vehicle_bookings;
CREATE POLICY "Hub managers update hub vehicle bookings"
  ON public.vehicle_bookings
  FOR UPDATE
  TO authenticated
  USING (public.is_hub_manager_for(hub_id))
  WITH CHECK (public.is_hub_manager_for(hub_id));

-- bulletins
DROP POLICY IF EXISTS "Hub managers view hub bulletins" ON public.bulletins;
CREATE POLICY "Hub managers view hub bulletins"
  ON public.bulletins
  FOR SELECT
  TO authenticated
  USING (public.is_hub_manager_for(hub_id));

DROP POLICY IF EXISTS "Hub managers update hub bulletins" ON public.bulletins;
CREATE POLICY "Hub managers update hub bulletins"
  ON public.bulletins
  FOR UPDATE
  TO authenticated
  USING (public.is_hub_manager_for(hub_id))
  WITH CHECK (public.is_hub_manager_for(hub_id));

-- bulletin_reports
DROP POLICY IF EXISTS "Hub managers view hub bulletin reports" ON public.bulletin_reports;
CREATE POLICY "Hub managers view hub bulletin reports"
  ON public.bulletin_reports
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.bulletins b
      WHERE b.id = bulletin_reports.bulletin_id
        AND public.is_hub_manager_for(b.hub_id)
    )
  );

DROP POLICY IF EXISTS "Hub managers update hub bulletin reports" ON public.bulletin_reports;
CREATE POLICY "Hub managers update hub bulletin reports"
  ON public.bulletin_reports
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.bulletins b
      WHERE b.id = bulletin_reports.bulletin_id
        AND public.is_hub_manager_for(b.hub_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.bulletins b
      WHERE b.id = bulletin_reports.bulletin_id
        AND public.is_hub_manager_for(b.hub_id)
    )
  );

-- payment_intents (read-only SELECT for assigned hub; confirmation strictly via fulfill_payment_intent RPC)
DROP POLICY IF EXISTS "Hub managers view hub payment intents" ON public.payment_intents;
CREATE POLICY "Hub managers view hub payment intents"
  ON public.payment_intents
  FOR SELECT
  TO authenticated
  USING (public.is_hub_manager_for(hub_id));
