-- =============================================================================
-- DD OODLE — PHASE 74-A: SHOP CATALOGUE PRO & RESTAURANTS/CAFÉS SCHEMA,
-- PICK N DROP BRIDGES, OTP RPCs & TAXONOMY
-- 100% IDEMPOTENT MIGRATION
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =============================================================================
-- A. Safe Alterations to Existing Tables
-- =============================================================================

-- A1. public.marketplace_products
ALTER TABLE public.marketplace_products
  ADD COLUMN IF NOT EXISTS in_stock boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS unit_label text,
  ADD COLUMN IF NOT EXISTS shop_category_tag text,
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_marketplace_products_listing_stock_sort
  ON public.marketplace_products (listing_id, in_stock, sort_order);

-- A2. public.delivery_orders (Pick N Drop bridges for Shop & Hot-Food Orders)
ALTER TABLE public.delivery_orders
  ADD COLUMN IF NOT EXISTS linked_shop_order_id uuid,
  ADD COLUMN IF NOT EXISTS linked_restaurant_order_id uuid,
  ADD COLUMN IF NOT EXISTS is_food_order boolean NOT NULL DEFAULT false;

-- A3. public.payment_intents (add shop_order_id & restaurant_order_id + expand purpose CHECK)
ALTER TABLE public.payment_intents
  ADD COLUMN IF NOT EXISTS shop_order_id uuid,
  ADD COLUMN IF NOT EXISTS restaurant_order_id uuid;

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
        'restaurant_pro_subscription'
      )
    );
END;
$$;

-- A4. public.merchant_settlements (add shop_order_id & restaurant_order_id)
ALTER TABLE public.merchant_settlements
  ADD COLUMN IF NOT EXISTS shop_order_id uuid,
  ADD COLUMN IF NOT EXISTS restaurant_order_id uuid;

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
      AND t.relname = 'merchant_settlements'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%settlement_source%'
  LOOP
    EXECUTE format('ALTER TABLE public.merchant_settlements DROP CONSTRAINT IF EXISTS %I', v_conname);
  END LOOP;

  ALTER TABLE public.merchant_settlements
    ADD CONSTRAINT merchant_settlements_source_check CHECK (
      settlement_source IN (
        'print_order',
        'resource_booking',
        'shop_order',
        'restaurant_order'
      )
    );
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_merchant_settlements_shop_order_unique
  ON public.merchant_settlements (shop_order_id)
  WHERE shop_order_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_merchant_settlements_restaurant_order_unique
  ON public.merchant_settlements (restaurant_order_id)
  WHERE restaurant_order_id IS NOT NULL;

-- A5. public.service_hubs: backfill module_switches for shop_orders & food_orders
UPDATE public.service_hubs
SET module_switches = COALESCE(module_switches, '{}'::jsonb)
  || CASE
       WHEN NOT (COALESCE(module_switches, '{}'::jsonb) ? 'shop_orders')
         THEN '{"shop_orders": true}'::jsonb
       ELSE '{}'::jsonb
     END
  || CASE
       WHEN NOT (COALESCE(module_switches, '{}'::jsonb) ? 'food_orders')
         THEN '{"food_orders": true}'::jsonb
       ELSE '{}'::jsonb
     END;

-- =============================================================================
-- B. Six Clean Vertical Tables
-- =============================================================================

-- B1. public.listing_shop_profiles
CREATE TABLE IF NOT EXISTS public.listing_shop_profiles (
  listing_id uuid PRIMARY KEY REFERENCES public.listings(id) ON DELETE CASCADE,
  hub_id uuid NOT NULL REFERENCES public.service_hubs(id) ON DELETE CASCADE,
  is_accepting_orders boolean NOT NULL DEFAULT true,
  busy_until timestamptz,
  allow_counter_pickup boolean NOT NULL DEFAULT true,
  allow_pick_n_drop boolean NOT NULL DEFAULT true,
  min_order_inr numeric(10,2) NOT NULL DEFAULT 0 CHECK (min_order_inr >= 0),
  packaging_fee_inr numeric(10,2) NOT NULL DEFAULT 0 CHECK (packaging_fee_inr >= 0),
  prep_time_mins integer NOT NULL DEFAULT 15 CHECK (prep_time_mins BETWEEN 1 AND 240),
  payment_policy jsonb NOT NULL DEFAULT '{"allow_direct_pay":true,"direct_pay_max_inr":500,"allow_escrow":true,"shop_upi_id":null,"shop_upi_name":null,"shop_upi_verified":false}'::jsonb,
  store_verified boolean NOT NULL DEFAULT false,
  pickup_instructions text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listing_shop_profiles_hub_active
  ON public.listing_shop_profiles (hub_id, is_accepting_orders, store_verified);

-- B2. public.shop_orders
CREATE TABLE IF NOT EXISTS public.shop_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_code text UNIQUE NOT NULL,
  hub_id uuid NOT NULL REFERENCES public.service_hubs(id),
  listing_id uuid NOT NULL REFERENCES public.listings(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  items_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  subtotal_inr numeric(10,2) NOT NULL CHECK (subtotal_inr >= 0),
  packaging_fee_inr numeric(10,2) NOT NULL DEFAULT 0 CHECK (packaging_fee_inr >= 0),
  delivery_fee_inr numeric(10,2) NOT NULL DEFAULT 0 CHECK (delivery_fee_inr >= 0),
  total_amount_inr numeric(10,2) NOT NULL CHECK (total_amount_inr >= 0),
  handover_mode text NOT NULL DEFAULT 'counter_pickup'
    CHECK (handover_mode IN ('counter_pickup', 'pick_n_drop')),
  linked_delivery_order_id uuid REFERENCES public.delivery_orders(id) ON DELETE SET NULL,
  payment_rail text NOT NULL DEFAULT 'platform_escrow'
    CHECK (payment_rail IN ('direct_counter', 'direct_shop_upi', 'platform_escrow')),
  payment_intent_id uuid REFERENCES public.payment_intents(id) ON DELETE SET NULL,
  pickup_otp_hash text,
  pickup_otp_display_for_customer text,
  customer_note text,
  dropoff_address text,
  dropoff_lat double precision,
  dropoff_lng double precision,
  order_status text NOT NULL DEFAULT 'pending_payment'
    CHECK (order_status IN ('pending_payment', 'confirmed', 'packing', 'ready_for_pickup', 'handed_to_rider', 'completed', 'cancelled')),
  payment_status text NOT NULL DEFAULT 'unpaid'
    CHECK (payment_status IN ('unpaid', 'pending_manual_review', 'escrow_held', 'paid_direct_confirmed', 'refunded')),
  settlement_status text NOT NULL DEFAULT 'not_applicable'
    CHECK (settlement_status IN ('not_applicable', 'locked', 'eligible', 'settled', 'reversed')),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_shop_orders_listing_status
  ON public.shop_orders (listing_id, order_status);
CREATE INDEX IF NOT EXISTS idx_shop_orders_customer_created
  ON public.shop_orders (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_shop_orders_hub_status
  ON public.shop_orders (hub_id, order_status);

-- B3. public.listing_restaurant_profiles
CREATE TABLE IF NOT EXISTS public.listing_restaurant_profiles (
  listing_id uuid PRIMARY KEY REFERENCES public.listings(id) ON DELETE CASCADE,
  hub_id uuid NOT NULL REFERENCES public.service_hubs(id) ON DELETE CASCADE,
  cuisines text[] NOT NULL DEFAULT ARRAY['Local']::text[],
  avg_cost_for_two_inr integer NOT NULL DEFAULT 300 CHECK (avg_cost_for_two_inr >= 0),
  is_pure_veg boolean NOT NULL DEFAULT false,
  is_kitchen_open boolean NOT NULL DEFAULT true,
  kitchen_paused_until timestamptz,
  prep_time_mins integer NOT NULL DEFAULT 25 CHECK (prep_time_mins BETWEEN 1 AND 240),
  allow_takeaway boolean NOT NULL DEFAULT true,
  allow_pick_n_drop boolean NOT NULL DEFAULT true,
  allow_table_booking boolean NOT NULL DEFAULT false,
  max_table_party_size integer NOT NULL DEFAULT 12 CHECK (max_table_party_size BETWEEN 1 AND 50),
  packaging_fee_inr numeric(10,2) NOT NULL DEFAULT 15 CHECK (packaging_fee_inr >= 0),
  min_order_inr numeric(10,2) NOT NULL DEFAULT 0 CHECK (min_order_inr >= 0),
  fssai_license_no text,
  fssai_verified boolean NOT NULL DEFAULT false,
  payment_policy jsonb NOT NULL DEFAULT '{"allow_direct_pay":true,"direct_pay_max_inr":400,"allow_escrow":true,"shop_upi_id":null,"shop_upi_name":null,"shop_upi_verified":false}'::jsonb,
  pickup_instructions text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listing_restaurant_profiles_hub_open
  ON public.listing_restaurant_profiles (hub_id, is_kitchen_open, fssai_verified);

-- B4. public.restaurant_menu_items
CREATE TABLE IF NOT EXISTS public.restaurant_menu_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  hub_id uuid NOT NULL REFERENCES public.service_hubs(id) ON DELETE CASCADE,
  category_name text NOT NULL DEFAULT 'Mains',
  name text NOT NULL,
  description text,
  diet_type text NOT NULL DEFAULT 'non_veg'
    CHECK (diet_type IN ('veg', 'non_veg', 'egg')),
  base_price_inr numeric(10,2) NOT NULL CHECK (base_price_inr >= 0),
  variants jsonb NOT NULL DEFAULT '[]'::jsonb,
  addons jsonb NOT NULL DEFAULT '[]'::jsonb,
  meal_slot text NOT NULL DEFAULT 'all_day'
    CHECK (meal_slot IN ('all_day', 'breakfast', 'lunch', 'dinner')),
  is_bestseller boolean NOT NULL DEFAULT false,
  is_spicy boolean NOT NULL DEFAULT false,
  in_stock boolean NOT NULL DEFAULT true,
  image_url text,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_menu_items_listing_stock_sort
  ON public.restaurant_menu_items (listing_id, in_stock, sort_order);

-- B5. public.restaurant_orders
CREATE TABLE IF NOT EXISTS public.restaurant_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_code text UNIQUE NOT NULL,
  hub_id uuid NOT NULL REFERENCES public.service_hubs(id),
  listing_id uuid NOT NULL REFERENCES public.listings(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  items_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  subtotal_inr numeric(10,2) NOT NULL CHECK (subtotal_inr >= 0),
  packaging_fee_inr numeric(10,2) NOT NULL DEFAULT 0 CHECK (packaging_fee_inr >= 0),
  delivery_fee_inr numeric(10,2) NOT NULL DEFAULT 0 CHECK (delivery_fee_inr >= 0),
  total_amount_inr numeric(10,2) NOT NULL CHECK (total_amount_inr >= 0),
  fulfillment_mode text NOT NULL DEFAULT 'takeaway'
    CHECK (fulfillment_mode IN ('takeaway', 'pick_n_drop')),
  linked_delivery_order_id uuid REFERENCES public.delivery_orders(id) ON DELETE SET NULL,
  payment_rail text NOT NULL DEFAULT 'platform_escrow'
    CHECK (payment_rail IN ('direct_counter', 'direct_shop_upi', 'platform_escrow')),
  payment_intent_id uuid REFERENCES public.payment_intents(id) ON DELETE SET NULL,
  estimated_prep_mins integer NOT NULL DEFAULT 25,
  pickup_otp_hash text,
  pickup_otp_display_for_customer text,
  cooking_instructions text,
  dropoff_address text,
  dropoff_lat double precision,
  dropoff_lng double precision,
  kitchen_status text NOT NULL DEFAULT 'pending_payment'
    CHECK (kitchen_status IN ('pending_payment', 'new_order', 'preparing', 'ready_for_pickup', 'handed_to_rider', 'completed', 'rejected', 'cancelled')),
  payment_status text NOT NULL DEFAULT 'unpaid'
    CHECK (payment_status IN ('unpaid', 'pending_manual_review', 'escrow_held', 'paid_direct_confirmed', 'refunded')),
  settlement_status text NOT NULL DEFAULT 'not_applicable'
    CHECK (settlement_status IN ('not_applicable', 'locked', 'eligible', 'settled', 'reversed')),
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_orders_listing_status
  ON public.restaurant_orders (listing_id, kitchen_status);
CREATE INDEX IF NOT EXISTS idx_restaurant_orders_customer_created
  ON public.restaurant_orders (customer_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_restaurant_orders_hub_status
  ON public.restaurant_orders (hub_id, kitchen_status);

-- B6. public.restaurant_table_reservations
CREATE TABLE IF NOT EXISTS public.restaurant_table_reservations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reservation_code text UNIQUE NOT NULL,
  hub_id uuid NOT NULL REFERENCES public.service_hubs(id),
  listing_id uuid NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  guest_name text NOT NULL,
  guest_phone text,
  party_size integer NOT NULL CHECK (party_size BETWEEN 1 AND 30),
  reserved_for timestamptz NOT NULL,
  special_request text,
  status text NOT NULL DEFAULT 'requested'
    CHECK (status IN ('requested', 'confirmed', 'seated', 'completed', 'declined', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_restaurant_table_reservations_listing_time
  ON public.restaurant_table_reservations (listing_id, reserved_for DESC);
CREATE INDEX IF NOT EXISTS idx_restaurant_table_reservations_customer
  ON public.restaurant_table_reservations (customer_id, created_at DESC);

-- Add deferred FKs cleanly (idempotent)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_payment_intents_shop_order') THEN
    ALTER TABLE public.payment_intents
      ADD CONSTRAINT fk_payment_intents_shop_order
      FOREIGN KEY (shop_order_id) REFERENCES public.shop_orders(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_payment_intents_restaurant_order') THEN
    ALTER TABLE public.payment_intents
      ADD CONSTRAINT fk_payment_intents_restaurant_order
      FOREIGN KEY (restaurant_order_id) REFERENCES public.restaurant_orders(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_delivery_orders_shop_order') THEN
    ALTER TABLE public.delivery_orders
      ADD CONSTRAINT fk_delivery_orders_shop_order
      FOREIGN KEY (linked_shop_order_id) REFERENCES public.shop_orders(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_delivery_orders_restaurant_order') THEN
    ALTER TABLE public.delivery_orders
      ADD CONSTRAINT fk_delivery_orders_restaurant_order
      FOREIGN KEY (linked_restaurant_order_id) REFERENCES public.restaurant_orders(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_merchant_settlements_shop_order') THEN
    ALTER TABLE public.merchant_settlements
      ADD CONSTRAINT fk_merchant_settlements_shop_order
      FOREIGN KEY (shop_order_id) REFERENCES public.shop_orders(id) ON DELETE SET NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'fk_merchant_settlements_restaurant_order') THEN
    ALTER TABLE public.merchant_settlements
      ADD CONSTRAINT fk_merchant_settlements_restaurant_order
      FOREIGN KEY (restaurant_order_id) REFERENCES public.restaurant_orders(id) ON DELETE SET NULL;
  END IF;
END;
$$;

-- =============================================================================
-- C. Privilege Guards & Auto-Sync Triggers for listings.vertical_summary
-- =============================================================================

-- C1. Guard store_verified & shop_upi_verified on listing_shop_profiles
CREATE OR REPLACE FUNCTION public.guard_shop_profile_privileged_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_service boolean := (current_setting('role', true) = 'service_role');
  v_can_verify boolean := false;
BEGIN
  IF v_is_service THEN
    RETURN NEW;
  END IF;

  v_can_verify := public.is_super_admin() OR public.is_hub_manager_for(NEW.hub_id);

  IF NOT v_can_verify THEN
    IF TG_OP = 'INSERT' THEN
      NEW.store_verified := false;
      NEW.payment_policy := jsonb_set(
        COALESCE(NEW.payment_policy, '{}'::jsonb),
        '{shop_upi_verified}',
        'false'::jsonb,
        true
      );
    ELSE
      NEW.store_verified := OLD.store_verified;
      NEW.payment_policy := jsonb_set(
        COALESCE(NEW.payment_policy, '{}'::jsonb),
        '{shop_upi_verified}',
        COALESCE(OLD.payment_policy->'shop_upi_verified', 'false'::jsonb),
        true
      );
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_shop_profile_privileged ON public.listing_shop_profiles;
CREATE TRIGGER trg_guard_shop_profile_privileged
  BEFORE INSERT OR UPDATE ON public.listing_shop_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_shop_profile_privileged_fields();

-- C2. Guard fssai_verified & shop_upi_verified on listing_restaurant_profiles
CREATE OR REPLACE FUNCTION public.guard_restaurant_profile_privileged_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_service boolean := (current_setting('role', true) = 'service_role');
  v_can_verify boolean := false;
BEGIN
  IF v_is_service THEN
    RETURN NEW;
  END IF;

  v_can_verify := public.is_super_admin() OR public.is_hub_manager_for(NEW.hub_id);

  IF NOT v_can_verify THEN
    IF TG_OP = 'INSERT' THEN
      NEW.fssai_verified := false;
      NEW.payment_policy := jsonb_set(
        COALESCE(NEW.payment_policy, '{}'::jsonb),
        '{shop_upi_verified}',
        'false'::jsonb,
        true
      );
    ELSE
      NEW.fssai_verified := OLD.fssai_verified;
      NEW.payment_policy := jsonb_set(
        COALESCE(NEW.payment_policy, '{}'::jsonb),
        '{shop_upi_verified}',
        COALESCE(OLD.payment_policy->'shop_upi_verified', 'false'::jsonb),
        true
      );
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_restaurant_profile_privileged ON public.listing_restaurant_profiles;
CREATE TRIGGER trg_guard_restaurant_profile_privileged
  BEFORE INSERT OR UPDATE ON public.listing_restaurant_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_restaurant_profile_privileged_fields();

-- C3. Refresh shop_catalogue vertical_summary
CREATE OR REPLACE FUNCTION public.refresh_listing_shop_vertical_summary(p_listing_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.listing_shop_profiles%ROWTYPE;
  v_item_count integer := 0;
  v_in_stock_count integer := 0;
BEGIN
  IF p_listing_id IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_profile
  FROM public.listing_shop_profiles
  WHERE listing_id = p_listing_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT
    COUNT(*)::integer,
    COUNT(*) FILTER (WHERE COALESCE(in_stock, true) = true)::integer
    INTO v_item_count, v_in_stock_count
  FROM public.marketplace_products
  WHERE listing_id = p_listing_id
    AND COALESCE(is_active, true) = true;

  UPDATE public.listings
  SET
    listing_vertical = 'shop_catalogue',
    vertical_summary = COALESCE(vertical_summary, '{}'::jsonb) || jsonb_build_object(
      'item_count', v_item_count,
      'in_stock_count', v_in_stock_count,
      'is_accepting_orders', v_profile.is_accepting_orders,
      'allow_pick_n_drop', v_profile.allow_pick_n_drop,
      'prep_time_mins', v_profile.prep_time_mins,
      'store_verified', v_profile.store_verified
    ),
    updated_at = now()
  WHERE id = p_listing_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_shop_vertical_summary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_listing_shop_vertical_summary(OLD.listing_id);
    RETURN OLD;
  ELSE
    PERFORM public.refresh_listing_shop_vertical_summary(NEW.listing_id);
    IF TG_OP = 'UPDATE' AND OLD.listing_id IS DISTINCT FROM NEW.listing_id THEN
      PERFORM public.refresh_listing_shop_vertical_summary(OLD.listing_id);
    END IF;
    RETURN NEW;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_shop_summary_from_profile ON public.listing_shop_profiles;
CREATE TRIGGER trg_sync_shop_summary_from_profile
  AFTER INSERT OR UPDATE OR DELETE ON public.listing_shop_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_shop_vertical_summary();

DROP TRIGGER IF EXISTS trg_sync_shop_summary_from_products ON public.marketplace_products;
CREATE TRIGGER trg_sync_shop_summary_from_products
  AFTER INSERT OR UPDATE OR DELETE ON public.marketplace_products
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_shop_vertical_summary();

-- C4. Refresh restaurant_food vertical_summary
CREATE OR REPLACE FUNCTION public.refresh_listing_restaurant_vertical_summary(p_listing_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile public.listing_restaurant_profiles%ROWTYPE;
  v_menu_count integer := 0;
BEGIN
  IF p_listing_id IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO v_profile
  FROM public.listing_restaurant_profiles
  WHERE listing_id = p_listing_id;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  SELECT COUNT(*)::integer
    INTO v_menu_count
  FROM public.restaurant_menu_items
  WHERE listing_id = p_listing_id
    AND in_stock = true;

  UPDATE public.listings
  SET
    listing_vertical = 'restaurant_food',
    vertical_summary = COALESCE(vertical_summary, '{}'::jsonb) || jsonb_build_object(
      'cuisines', to_jsonb(v_profile.cuisines),
      'avg_cost_for_two_inr', v_profile.avg_cost_for_two_inr,
      'is_pure_veg', v_profile.is_pure_veg,
      'is_kitchen_open', v_profile.is_kitchen_open,
      'prep_time_mins', v_profile.prep_time_mins,
      'allow_pick_n_drop', v_profile.allow_pick_n_drop,
      'allow_table_booking', v_profile.allow_table_booking,
      'fssai_verified', v_profile.fssai_verified,
      'menu_item_count', v_menu_count
    ),
    updated_at = now()
  WHERE id = p_listing_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_restaurant_vertical_summary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.refresh_listing_restaurant_vertical_summary(OLD.listing_id);
    RETURN OLD;
  ELSE
    PERFORM public.refresh_listing_restaurant_vertical_summary(NEW.listing_id);
    IF TG_OP = 'UPDATE' AND OLD.listing_id IS DISTINCT FROM NEW.listing_id THEN
      PERFORM public.refresh_listing_restaurant_vertical_summary(OLD.listing_id);
    END IF;
    RETURN NEW;
  END IF;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_restaurant_summary_from_profile ON public.listing_restaurant_profiles;
CREATE TRIGGER trg_sync_restaurant_summary_from_profile
  AFTER INSERT OR UPDATE OR DELETE ON public.listing_restaurant_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_restaurant_vertical_summary();

DROP TRIGGER IF EXISTS trg_sync_restaurant_summary_from_menu ON public.restaurant_menu_items;
CREATE TRIGGER trg_sync_restaurant_summary_from_menu
  AFTER INSERT OR UPDATE OR DELETE ON public.restaurant_menu_items
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_restaurant_vertical_summary();

-- =============================================================================
-- D. Entitlement Helpers, OTP Handover RPCs & fulfill_payment_intent Upgrade
-- =============================================================================

-- D1. has_active_commerce_entitlement
CREATE OR REPLACE FUNCTION public.has_active_commerce_entitlement(
  p_listing_id uuid,
  p_vertical text
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_id uuid;
  v_owner_role text;
BEGIN
  IF p_listing_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT l.owner_id, lower(COALESCE(p.role, ''))
    INTO v_owner_id, v_owner_role
  FROM public.listings l
  LEFT JOIN public.profiles p ON p.id = l.owner_id
  WHERE l.id = p_listing_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Allow super_admin-owned demo/sample listings
  IF v_owner_role = 'super_admin' THEN
    RETURN true;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.user_subscriptions us
    JOIN public.subscription_plans sp ON sp.id = us.plan_id
    WHERE us.status = 'active'
      AND us.expires_at > now()
      AND sp.plan_scope IN ('catalogue_pro', 'restaurant_pro', 'merchant_all_in_one')
      AND (
        (COALESCE(p_vertical, 'shop_catalogue') = 'shop_catalogue'
          AND COALESCE(sp.entitlements->>'catalogue_ordering', 'false') = 'true')
        OR (p_vertical = 'restaurant_food'
          AND COALESCE(sp.entitlements->>'restaurant_ordering', 'false') = 'true')
        OR sp.plan_scope = 'merchant_all_in_one'
      )
      AND (
        us.listing_id = p_listing_id
        OR (us.listing_id IS NULL AND us.user_id = v_owner_id)
      )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.has_active_commerce_entitlement(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_active_commerce_entitlement(uuid, text) TO anon, authenticated, service_role;

-- D2. is_commerce_operator_for
CREATE OR REPLACE FUNCTION public.is_commerce_operator_for(p_listing_id uuid)
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

REVOKE ALL ON FUNCTION public.is_commerce_operator_for(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_commerce_operator_for(uuid) TO authenticated, service_role;

-- D3. verify_commerce_pickup_otp
CREATE OR REPLACE FUNCTION public.verify_commerce_pickup_otp(
  p_order_type text,
  p_order_id uuid,
  p_otp text,
  p_direct_payment_confirmed boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := now();
  v_clean_otp text := trim(COALESCE(p_otp, ''));
  v_otp_hash text;
  v_shop public.shop_orders%ROWTYPE;
  v_rest public.restaurant_orders%ROWTYPE;
  v_next_status text;
  v_next_payment_status text;
  v_next_settlement_status text;
BEGIN
  IF p_order_type NOT IN ('shop_order', 'restaurant_order') THEN
    RAISE EXCEPTION 'Invalid order_type. Must be shop_order or restaurant_order.'
      USING ERRCODE = '22023';
  END IF;

  IF length(v_clean_otp) < 4 THEN
    RAISE EXCEPTION 'A valid 4-digit Pickup OTP is required.'
      USING ERRCODE = '22023';
  END IF;

  v_otp_hash := encode(digest(v_clean_otp, 'sha256'), 'hex');

  IF p_order_type = 'shop_order' THEN
    SELECT * INTO v_shop
    FROM public.shop_orders
    WHERE id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Shop order not found.' USING ERRCODE = 'P0002';
    END IF;

    IF NOT public.is_commerce_operator_for(v_shop.listing_id) THEN
      RAISE EXCEPTION 'Forbidden: Only authorized shop operators may verify pickup OTP.'
        USING ERRCODE = '42501';
    END IF;

    IF v_shop.order_status IN ('completed', 'cancelled') THEN
      RAISE EXCEPTION 'Order is already % and cannot be handed over.', v_shop.order_status
        USING ERRCODE = 'P0001';
    END IF;

    IF v_shop.pickup_otp_hash IS NULL OR lower(v_shop.pickup_otp_hash) <> lower(v_otp_hash) THEN
      RAISE EXCEPTION 'Invalid Pickup OTP.' USING ERRCODE = 'P0001';
    END IF;

    v_next_status := CASE
      WHEN v_shop.handover_mode = 'pick_n_drop' THEN 'handed_to_rider'
      ELSE 'completed'
    END;

    v_next_payment_status := v_shop.payment_status;
    IF p_direct_payment_confirmed = true
       AND v_shop.payment_rail IN ('direct_counter', 'direct_shop_upi') THEN
      v_next_payment_status := 'paid_direct_confirmed';
    END IF;

    v_next_settlement_status := v_shop.settlement_status;
    IF v_shop.payment_rail = 'platform_escrow' THEN
      UPDATE public.merchant_settlements
      SET status = 'eligible', updated_at = v_now
      WHERE shop_order_id = v_shop.id
        AND status = 'locked';
      IF FOUND OR v_shop.settlement_status = 'locked' THEN
        v_next_settlement_status := 'eligible';
      END IF;
    END IF;

    UPDATE public.shop_orders
    SET
      order_status = v_next_status,
      payment_status = v_next_payment_status,
      settlement_status = v_next_settlement_status,
      completed_at = CASE WHEN v_next_status = 'completed' THEN COALESCE(completed_at, v_now) ELSE completed_at END,
      updated_at = v_now
    WHERE id = v_shop.id
    RETURNING * INTO v_shop;

    RETURN jsonb_build_object(
      'ok', true,
      'order_type', 'shop_order',
      'order_id', v_shop.id,
      'order_code', v_shop.order_code,
      'order_status', v_shop.order_status,
      'payment_status', v_shop.payment_status,
      'settlement_status', v_shop.settlement_status
    );
  ELSE
    SELECT * INTO v_rest
    FROM public.restaurant_orders
    WHERE id = p_order_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Restaurant order not found.' USING ERRCODE = 'P0002';
    END IF;

    IF NOT public.is_commerce_operator_for(v_rest.listing_id) THEN
      RAISE EXCEPTION 'Forbidden: Only authorized kitchen operators may verify pickup OTP.'
        USING ERRCODE = '42501';
    END IF;

    IF v_rest.kitchen_status IN ('completed', 'rejected', 'cancelled') THEN
      RAISE EXCEPTION 'Order is already % and cannot be handed over.', v_rest.kitchen_status
        USING ERRCODE = 'P0001';
    END IF;

    IF v_rest.pickup_otp_hash IS NULL OR lower(v_rest.pickup_otp_hash) <> lower(v_otp_hash) THEN
      RAISE EXCEPTION 'Invalid Pickup OTP.' USING ERRCODE = 'P0001';
    END IF;

    v_next_status := CASE
      WHEN v_rest.fulfillment_mode = 'pick_n_drop' THEN 'handed_to_rider'
      ELSE 'completed'
    END;

    v_next_payment_status := v_rest.payment_status;
    IF p_direct_payment_confirmed = true
       AND v_rest.payment_rail IN ('direct_counter', 'direct_shop_upi') THEN
      v_next_payment_status := 'paid_direct_confirmed';
    END IF;

    v_next_settlement_status := v_rest.settlement_status;
    IF v_rest.payment_rail = 'platform_escrow' THEN
      UPDATE public.merchant_settlements
      SET status = 'eligible', updated_at = v_now
      WHERE restaurant_order_id = v_rest.id
        AND status = 'locked';
      IF FOUND OR v_rest.settlement_status = 'locked' THEN
        v_next_settlement_status := 'eligible';
      END IF;
    END IF;

    UPDATE public.restaurant_orders
    SET
      kitchen_status = v_next_status,
      payment_status = v_next_payment_status,
      settlement_status = v_next_settlement_status,
      completed_at = CASE WHEN v_next_status = 'completed' THEN COALESCE(completed_at, v_now) ELSE completed_at END,
      updated_at = v_now
    WHERE id = v_rest.id
    RETURNING * INTO v_rest;

    RETURN jsonb_build_object(
      'ok', true,
      'order_type', 'restaurant_order',
      'order_id', v_rest.id,
      'order_code', v_rest.order_code,
      'kitchen_status', v_rest.kitchen_status,
      'payment_status', v_rest.payment_status,
      'settlement_status', v_rest.settlement_status
    );
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.verify_commerce_pickup_otp(text, uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_commerce_pickup_otp(text, uuid, text, boolean) TO authenticated, service_role;

-- D4. Upgrade fulfill_payment_intent RPC (preserves ALL prior purposes + adds Shop & Restaurant orders/subs)
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

ALTER TABLE public.listing_shop_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.shop_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.listing_restaurant_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_menu_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.restaurant_table_reservations ENABLE ROW LEVEL SECURITY;

-- E1. listing_shop_profiles
DROP POLICY IF EXISTS "Public can view shop profiles" ON public.listing_shop_profiles;
CREATE POLICY "Public can view shop profiles"
  ON public.listing_shop_profiles FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Operators and managers can insert shop profiles" ON public.listing_shop_profiles;
CREATE POLICY "Operators and managers can insert shop profiles"
  ON public.listing_shop_profiles FOR INSERT TO authenticated
  WITH CHECK (
    public.is_commerce_operator_for(listing_id)
    OR public.is_hub_manager_for(hub_id)
    OR public.is_super_admin()
  );

DROP POLICY IF EXISTS "Operators and managers can update shop profiles" ON public.listing_shop_profiles;
CREATE POLICY "Operators and managers can update shop profiles"
  ON public.listing_shop_profiles FOR UPDATE TO authenticated
  USING (
    public.is_commerce_operator_for(listing_id)
    OR public.is_hub_manager_for(hub_id)
    OR public.is_super_admin()
  )
  WITH CHECK (
    public.is_commerce_operator_for(listing_id)
    OR public.is_hub_manager_for(hub_id)
    OR public.is_super_admin()
  );

DROP POLICY IF EXISTS "Operators can delete shop profiles" ON public.listing_shop_profiles;
CREATE POLICY "Operators can delete shop profiles"
  ON public.listing_shop_profiles FOR DELETE TO authenticated
  USING (public.is_commerce_operator_for(listing_id) OR public.is_super_admin());

-- E2. listing_restaurant_profiles
DROP POLICY IF EXISTS "Public can view restaurant profiles" ON public.listing_restaurant_profiles;
CREATE POLICY "Public can view restaurant profiles"
  ON public.listing_restaurant_profiles FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Operators and managers can insert restaurant profiles" ON public.listing_restaurant_profiles;
CREATE POLICY "Operators and managers can insert restaurant profiles"
  ON public.listing_restaurant_profiles FOR INSERT TO authenticated
  WITH CHECK (
    public.is_commerce_operator_for(listing_id)
    OR public.is_hub_manager_for(hub_id)
    OR public.is_super_admin()
  );

DROP POLICY IF EXISTS "Operators and managers can update restaurant profiles" ON public.listing_restaurant_profiles;
CREATE POLICY "Operators and managers can update restaurant profiles"
  ON public.listing_restaurant_profiles FOR UPDATE TO authenticated
  USING (
    public.is_commerce_operator_for(listing_id)
    OR public.is_hub_manager_for(hub_id)
    OR public.is_super_admin()
  )
  WITH CHECK (
    public.is_commerce_operator_for(listing_id)
    OR public.is_hub_manager_for(hub_id)
    OR public.is_super_admin()
  );

DROP POLICY IF EXISTS "Operators can delete restaurant profiles" ON public.listing_restaurant_profiles;
CREATE POLICY "Operators can delete restaurant profiles"
  ON public.listing_restaurant_profiles FOR DELETE TO authenticated
  USING (public.is_commerce_operator_for(listing_id) OR public.is_super_admin());

-- E3. restaurant_menu_items
DROP POLICY IF EXISTS "Public can view restaurant menu items" ON public.restaurant_menu_items;
CREATE POLICY "Public can view restaurant menu items"
  ON public.restaurant_menu_items FOR SELECT TO anon, authenticated USING (true);

DROP POLICY IF EXISTS "Operators can insert restaurant menu items" ON public.restaurant_menu_items;
CREATE POLICY "Operators can insert restaurant menu items"
  ON public.restaurant_menu_items FOR INSERT TO authenticated
  WITH CHECK (public.is_commerce_operator_for(listing_id));

DROP POLICY IF EXISTS "Operators can update restaurant menu items" ON public.restaurant_menu_items;
CREATE POLICY "Operators can update restaurant menu items"
  ON public.restaurant_menu_items FOR UPDATE TO authenticated
  USING (public.is_commerce_operator_for(listing_id))
  WITH CHECK (public.is_commerce_operator_for(listing_id));

DROP POLICY IF EXISTS "Operators can delete restaurant menu items" ON public.restaurant_menu_items;
CREATE POLICY "Operators can delete restaurant menu items"
  ON public.restaurant_menu_items FOR DELETE TO authenticated
  USING (public.is_commerce_operator_for(listing_id));

-- E4. shop_orders
DROP POLICY IF EXISTS "Customers operators and managers can view shop orders" ON public.shop_orders;
CREATE POLICY "Customers operators and managers can view shop orders"
  ON public.shop_orders FOR SELECT TO authenticated
  USING (
    customer_id = auth.uid()
    OR public.is_commerce_operator_for(listing_id)
    OR public.is_hub_manager_for(hub_id)
    OR public.is_super_admin()
  );

DROP POLICY IF EXISTS "Customers can insert own shop orders" ON public.shop_orders;
CREATE POLICY "Customers can insert own shop orders"
  ON public.shop_orders FOR INSERT TO authenticated
  WITH CHECK (customer_id = auth.uid());

DROP POLICY IF EXISTS "Operators can update shop orders" ON public.shop_orders;
CREATE POLICY "Operators can update shop orders"
  ON public.shop_orders FOR UPDATE TO authenticated
  USING (public.is_commerce_operator_for(listing_id))
  WITH CHECK (public.is_commerce_operator_for(listing_id));

-- E5. restaurant_orders
DROP POLICY IF EXISTS "Customers operators and managers can view restaurant orders" ON public.restaurant_orders;
CREATE POLICY "Customers operators and managers can view restaurant orders"
  ON public.restaurant_orders FOR SELECT TO authenticated
  USING (
    customer_id = auth.uid()
    OR public.is_commerce_operator_for(listing_id)
    OR public.is_hub_manager_for(hub_id)
    OR public.is_super_admin()
  );

DROP POLICY IF EXISTS "Customers can insert own restaurant orders" ON public.restaurant_orders;
CREATE POLICY "Customers can insert own restaurant orders"
  ON public.restaurant_orders FOR INSERT TO authenticated
  WITH CHECK (customer_id = auth.uid());

DROP POLICY IF EXISTS "Operators can update restaurant orders" ON public.restaurant_orders;
CREATE POLICY "Operators can update restaurant orders"
  ON public.restaurant_orders FOR UPDATE TO authenticated
  USING (public.is_commerce_operator_for(listing_id))
  WITH CHECK (public.is_commerce_operator_for(listing_id));

-- E6. restaurant_table_reservations
DROP POLICY IF EXISTS "Customers operators and managers can view table reservations" ON public.restaurant_table_reservations;
CREATE POLICY "Customers operators and managers can view table reservations"
  ON public.restaurant_table_reservations FOR SELECT TO authenticated
  USING (
    customer_id = auth.uid()
    OR public.is_commerce_operator_for(listing_id)
    OR public.is_hub_manager_for(hub_id)
    OR public.is_super_admin()
  );

DROP POLICY IF EXISTS "Customers can insert own table reservations" ON public.restaurant_table_reservations;
CREATE POLICY "Customers can insert own table reservations"
  ON public.restaurant_table_reservations FOR INSERT TO authenticated
  WITH CHECK (customer_id = auth.uid());

DROP POLICY IF EXISTS "Operators and customers can update table reservations" ON public.restaurant_table_reservations;
CREATE POLICY "Operators and customers can update table reservations"
  ON public.restaurant_table_reservations FOR UPDATE TO authenticated
  USING (
    public.is_commerce_operator_for(listing_id)
    OR customer_id = auth.uid()
  )
  WITH CHECK (
    public.is_commerce_operator_for(listing_id)
    OR customer_id = auth.uid()
  );

-- =============================================================================
-- F. Seed Curated Taxonomy, Pro Plans & 4 Deterministic [SAMPLE] Listings
-- =============================================================================

-- F1. Curated Taxonomy
DO $$
DECLARE
  v_rest_root_id uuid;
  v_shops_root_id uuid;
BEGIN
  INSERT INTO public.categories (
    entity_type, parent_id, depth, slug, display_name, icon, color_hex, sort_order, is_active
  ) VALUES (
    'listing', NULL, 0, 'restaurants_cafes', 'Restaurants & Cafés', 'UtensilsCrossed', '#EA580C', 66, true
  ) ON CONFLICT (entity_type, slug) DO NOTHING;

  SELECT id INTO v_rest_root_id
  FROM public.categories
  WHERE entity_type = 'listing' AND slug = 'restaurants_cafes' LIMIT 1;

  IF v_rest_root_id IS NOT NULL THEN
    INSERT INTO public.categories (
      entity_type, parent_id, depth, slug, display_name, icon, color_hex, sort_order, is_active
    ) VALUES
      ('listing', v_rest_root_id, 1, 'local_restaurants', 'Local Restaurants', 'UtensilsCrossed', '#EA580C', 10, true),
      ('listing', v_rest_root_id, 1, 'cafes_bakeries', 'Cafés & Bakeries', 'Coffee', '#EA580C', 20, true),
      ('listing', v_rest_root_id, 1, 'fast_food_momos', 'Fast Food & Momos', 'Flame', '#EA580C', 30, true),
      ('listing', v_rest_root_id, 1, 'cloud_home_kitchens', 'Cloud & Home Kitchens', 'ChefHat', '#EA580C', 40, true)
    ON CONFLICT (entity_type, slug) DO NOTHING;
  END IF;

  INSERT INTO public.categories (
    entity_type, parent_id, depth, slug, display_name, icon, color_hex, sort_order, is_active
  ) VALUES (
    'listing', NULL, 0, 'shops_catalogues', 'Shops & Daily Stores', 'ShoppingBag', '#0284C7', 68, true
  ) ON CONFLICT (entity_type, slug) DO NOTHING;

  SELECT id INTO v_shops_root_id
  FROM public.categories
  WHERE entity_type = 'listing' AND slug = 'shops_catalogues' LIMIT 1;

  IF v_shops_root_id IS NOT NULL THEN
    INSERT INTO public.categories (
      entity_type, parent_id, depth, slug, display_name, icon, color_hex, sort_order, is_active
    ) VALUES
      ('listing', v_shops_root_id, 1, 'groceries_kirana', 'Groceries & Kirana', 'ShoppingBasket', '#0284C7', 10, true),
      ('listing', v_shops_root_id, 1, 'pharmacy_medical', 'Pharmacy & Medical', 'Pill', '#0284C7', 20, true),
      ('listing', v_shops_root_id, 1, 'electronics_mobile', 'Electronics & Mobile', 'Smartphone', '#0284C7', 30, true),
      ('listing', v_shops_root_id, 1, 'clothing_lifestyle', 'Clothing & Lifestyle', 'Shirt', '#0284C7', 40, true)
    ON CONFLICT (entity_type, slug) DO NOTHING;
  END IF;
END;
$$;

-- F2. Seed Catalogue Pro & Restaurant Pro Plans
INSERT INTO public.subscription_plans (
  slug, name, price_inr, max_active_bulletins, max_monthly_posts,
  max_images_per_post, allow_youtube, duration_days, is_active, plan_scope, entitlements
) VALUES
  (
    'catalogue_pro_monthly',
    'Monthly Shop Catalogue Pro',
    499,
    0,
    0,
    6,
    false,
    30,
    true,
    'catalogue_pro',
    '{"catalogue_ordering":true,"pick_n_drop_dispatch":true,"unlimited_items":true}'::jsonb
  ),
  (
    'restaurant_pro_monthly',
    'Monthly Restaurant & Café Pro',
    699,
    0,
    0,
    8,
    false,
    30,
    true,
    'restaurant_pro',
    '{"restaurant_ordering":true,"table_reservations":true,"pick_n_drop_dispatch":true,"table_qr_menu":true}'::jsonb
  )
ON CONFLICT (slug) DO NOTHING;

-- F3. Seed 4 Deterministic [SAMPLE] Restaurants & Shops + Menu Items / Products
DO $$
DECLARE
  v_ccpur_id uuid;
  v_aizawl_id uuid;
  v_owner_id uuid;
  v_cat_momo_id uuid;
  v_cat_cafe_id uuid;
  v_cat_grocery_id uuid;
  v_cat_elec_id uuid;
  v_l_zobite uuid := 'f0000000-0000-4000-8000-00000000d001';
  v_l_bistro uuid := 'f0000000-0000-4000-8000-00000000d002';
  v_l_mart uuid := 'f0000000-0000-4000-8000-00000000d003';
  v_l_khatla uuid := 'f0000000-0000-4000-8000-00000000d004';
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

  SELECT id INTO v_cat_momo_id FROM public.categories WHERE entity_type = 'listing' AND slug = 'fast_food_momos' LIMIT 1;
  SELECT id INTO v_cat_cafe_id FROM public.categories WHERE entity_type = 'listing' AND slug = 'cafes_bakeries' LIMIT 1;
  SELECT id INTO v_cat_grocery_id FROM public.categories WHERE entity_type = 'listing' AND slug = 'groceries_kirana' LIMIT 1;
  SELECT id INTO v_cat_elec_id FROM public.categories WHERE entity_type = 'listing' AND slug = 'electronics_mobile' LIMIT 1;

  -- 1. [SAMPLE] Zo-Bite Café & Momo Kitchen (Churachandpur, restaurant_food)
  IF v_ccpur_id IS NOT NULL AND v_owner_id IS NOT NULL THEN
    INSERT INTO public.listings (
      id, owner_id, owner_name, title, category, subcategory, category_id, status,
      locality, address, short_description, description, price,
      contact_phone, phone, cover_image, gallery_images,
      coordinates, lat, lng, rating, review_count, hub_id,
      listing_vertical, is_civic_record
    ) VALUES (
      v_l_zobite, v_owner_id, 'Zo-Bite Kitchen',
      '[SAMPLE] Zo-Bite Café & Momo Kitchen',
      'business', 'Fast Food & Momos', v_cat_momo_id, 'published',
      'New Lamka', 'Tedim Road, Near New Lamka Bazar, Churachandpur 795128',
      'Steaming pork & veg momos, smoky thukpa, fried rice, and freshly brewed local coffee with table booking.',
      'Popular Lamka café serving hand-folded steamed & pan-fried momos, spicy hill thukpa, pork chowmein, and artisan iced coffee for dine-in, takeaway, and hot Pick N Drop delivery.',
      250, '+91 98620 55101', '+91 98620 55101',
      'https://picsum.photos/seed/ddoodle-zobite-cafe/960/640', '[]'::jsonb,
      '{"lat":24.3318,"lng":93.6794}'::jsonb, 24.3318, 93.6794, 4.8, 42,
      v_ccpur_id, 'restaurant_food', false
    ) ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.listing_restaurant_profiles (
      listing_id, hub_id, cuisines, avg_cost_for_two_inr, is_pure_veg,
      is_kitchen_open, prep_time_mins, allow_takeaway, allow_pick_n_drop,
      allow_table_booking, max_table_party_size, packaging_fee_inr, min_order_inr,
      fssai_license_no, fssai_verified, pickup_instructions
    ) VALUES (
      v_l_zobite, v_ccpur_id, ARRAY['Local', 'Momos', 'Café', 'Tibetan']::text[],
      350, false, true, 20, true, true, true, 12, 15, 100,
      '21524001000481', true, 'Collect from the front café takeaway window near Tedim Road.'
    ) ON CONFLICT (listing_id) DO NOTHING;

    INSERT INTO public.restaurant_menu_items (
      id, listing_id, hub_id, category_name, name, description, diet_type,
      base_price_inr, variants, addons, meal_slot, is_bestseller, is_spicy, in_stock, sort_order
    ) VALUES
      ('f0000000-0000-4000-8000-00000000e101', v_l_zobite, v_ccpur_id, 'Momo & Noodles', 'Steamed Pork Momo', 'Juicy hand-folded pork dumplings with fiery Raja mirchi chutney.', 'non_veg', 110, '[{"key":"half","label":"Half (5 pcs)","price_inr":110},{"key":"full","label":"Full (10 pcs)","price_inr":200}]'::jsonb, '[{"key":"extra_chutney","label":"Extra Chilli Chutney","price_inr":20}]'::jsonb, 'all_day', true, true, true, 10),
      ('f0000000-0000-4000-8000-00000000e102', v_l_zobite, v_ccpur_id, 'Momo & Noodles', 'Steamed Veg Momo', 'Fresh cabbage, carrot, and ginger dumplings with sesame dip.', 'veg', 90, '[{"key":"half","label":"Half (5 pcs)","price_inr":90},{"key":"full","label":"Full (10 pcs)","price_inr":160}]'::jsonb, '[{"key":"extra_chutney","label":"Extra Chilli Chutney","price_inr":20}]'::jsonb, 'all_day', false, false, true, 20),
      ('f0000000-0000-4000-8000-00000000e103', v_l_zobite, v_ccpur_id, 'Momo & Noodles', 'Smoked Pork Thukpa', 'Hearty hill noodle soup with smoked pork strips and greens.', 'non_veg', 180, '[]'::jsonb, '[{"key":"boiled_egg","label":"Add Boiled Egg","price_inr":25}]'::jsonb, 'all_day', true, true, true, 30),
      ('f0000000-0000-4000-8000-00000000e104', v_l_zobite, v_ccpur_id, 'Rice & Thali', 'Egg Fried Rice', 'Wok-tossed basmati rice with double egg and spring onions.', 'egg', 140, '[{"key":"half","label":"Half","price_inr":140},{"key":"full","label":"Full","price_inr":240}]'::jsonb, '[]'::jsonb, 'lunch', false, false, true, 40),
      ('f0000000-0000-4000-8000-00000000e105', v_l_zobite, v_ccpur_id, 'Starters', 'Crispy Chilli Chicken', 'Boneless chicken tossed in garlic chilli sauce.', 'non_veg', 220, '[]'::jsonb, '[]'::jsonb, 'dinner', true, true, true, 50),
      ('f0000000-0000-4000-8000-00000000e106', v_l_zobite, v_ccpur_id, 'Beverages', 'Lamka Iced Americano', 'Cold-brewed regional Arabica coffee over ice.', 'veg', 120, '[]'::jsonb, '[{"key":"oat_milk","label":"Add Sweet Cream","price_inr":30}]'::jsonb, 'all_day', false, false, true, 60)
    ON CONFLICT (id) DO NOTHING;

    -- 3. [SAMPLE] Tuibong Daily Mart & Pharmacy (Churachandpur, shop_catalogue)
    INSERT INTO public.listings (
      id, owner_id, owner_name, title, category, subcategory, category_id, status,
      locality, address, short_description, description, price,
      contact_phone, phone, cover_image, gallery_images,
      coordinates, lat, lng, rating, review_count, hub_id,
      listing_vertical, is_civic_record
    ) VALUES (
      v_l_mart, v_owner_id, 'Tuibong Daily Mart',
      '[SAMPLE] Tuibong Daily Mart & Pharmacy',
      'business', 'Groceries & Kirana', v_cat_grocery_id, 'published',
      'Tuibong', 'Main Bazar Road, Opposite DC Junction, Tuibong 795128',
      'Daily groceries, organic hill staples, and OTC pharmacy essentials with 15-min pickup or Pick N Drop.',
      'Neighborhood supermarket and OTC wellness counter in Tuibong offering live stock visibility, counter pickup, and rapid doorstep delivery via Pick N Drop.',
      150, '+91 98620 55103', '+91 98620 55103',
      'https://picsum.photos/seed/ddoodle-tuibong-mart/960/640', '[]'::jsonb,
      '{"lat":24.3441,"lng":93.6942}'::jsonb, 24.3441, 93.6942, 4.7, 31,
      v_ccpur_id, 'shop_catalogue', false
    ) ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.listing_shop_profiles (
      listing_id, hub_id, is_accepting_orders, allow_counter_pickup,
      allow_pick_n_drop, min_order_inr, packaging_fee_inr, prep_time_mins,
      store_verified, pickup_instructions
    ) VALUES (
      v_l_mart, v_ccpur_id, true, true, true, 50, 10, 15, true,
      'Show your 4-digit Pickup OTP at Billing Counter 2.'
    ) ON CONFLICT (listing_id) DO NOTHING;

    INSERT INTO public.marketplace_products (
      id, listing_id, owner_id, hub_id, title, description, price, unit, unit_label,
      category, shop_category_tag, in_stock, is_active, sort_order
    ) VALUES
      ('f0000000-0000-4000-8000-00000000f101', v_l_mart, v_owner_id, v_ccpur_id, 'Local Sticky Rice (Chak-Hao)', 'Aromatic black/white sticky rice harvested locally.', 160, 'kg', '1 kg', 'Groceries', 'Groceries', true, true, 10),
      ('f0000000-0000-4000-8000-00000000f102', v_l_mart, v_owner_id, v_ccpur_id, 'Organic Hill Forest Honey', 'Unfiltered raw honey in sealed glass jar.', 380, 'bottle', '500g Jar', 'Groceries', 'Groceries', true, true, 20),
      ('f0000000-0000-4000-8000-00000000f103', v_l_mart, v_owner_id, v_ccpur_id, 'Mustard Cooking Oil (Kachi Ghani)', 'Pure cold-pressed mustard oil.', 185, 'litre', '1 Litre', 'Groceries', 'Groceries', true, true, 30),
      ('f0000000-0000-4000-8000-00000000f104', v_l_mart, v_owner_id, v_ccpur_id, 'ORS Hydration Pack (5 Sachets)', 'WHO-formula oral rehydration salts.', 110, 'pack', 'Pack of 5', 'Health', 'Medicines', true, true, 40),
      ('f0000000-0000-4000-8000-00000000f105', v_l_mart, v_owner_id, v_ccpur_id, 'First-Aid Antiseptic & Bandage Kit', 'Compact home & travel first-aid pouch.', 240, 'kit', '1 Kit', 'Health', 'Medicines', true, true, 50)
    ON CONFLICT (id) DO NOTHING;
  END IF;

  -- 2. [SAMPLE] Dawrpui Highland Bistro & Bakery (Aizawl, restaurant_food)
  IF v_aizawl_id IS NOT NULL AND v_owner_id IS NOT NULL THEN
    INSERT INTO public.listings (
      id, owner_id, owner_name, title, category, subcategory, category_id, status,
      locality, address, short_description, description, price,
      contact_phone, phone, cover_image, gallery_images,
      coordinates, lat, lng, rating, review_count, hub_id,
      listing_vertical, is_civic_record
    ) VALUES (
      v_l_bistro, v_owner_id, 'Highland Bistro',
      '[SAMPLE] Dawrpui Highland Bistro & Bakery',
      'business', 'Cafés & Bakeries', v_cat_cafe_id, 'published',
      'Dawrpui', 'Bara Bazar Main Street, Dawrpui, Aizawl, Mizoram 796001',
      'Artisan sourdough pastries, Mizo Bai platters, grilled chicken bowls, and specialty espresso.',
      'Cozy hill bistro and bakery in Dawrpui offering freshly baked croissants, traditional Mizo Bai rice bowls, and hot takeaway or Pick N Drop delivery.',
      400, '+91 98630 66201', '+91 98630 66201',
      'https://picsum.photos/seed/ddoodle-dawrpui-bistro/960/640', '[]'::jsonb,
      '{"lat":23.7279,"lng":92.7196}'::jsonb, 23.7279, 92.7196, 4.9, 36,
      v_aizawl_id, 'restaurant_food', false
    ) ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.listing_restaurant_profiles (
      listing_id, hub_id, cuisines, avg_cost_for_two_inr, is_pure_veg,
      is_kitchen_open, prep_time_mins, allow_takeaway, allow_pick_n_drop,
      allow_table_booking, max_table_party_size, packaging_fee_inr, min_order_inr,
      fssai_license_no, fssai_verified, pickup_instructions
    ) VALUES (
      v_l_bistro, v_aizawl_id, ARRAY['Bakery', 'Café', 'Mizo Local', 'Continental']::text[],
      450, false, true, 25, true, true, true, 10, 20, 120,
      '21824001000219', true, 'Pickup at the bakery counter on Ground Floor.'
    ) ON CONFLICT (listing_id) DO NOTHING;

    INSERT INTO public.restaurant_menu_items (
      id, listing_id, hub_id, category_name, name, description, diet_type,
      base_price_inr, variants, addons, meal_slot, is_bestseller, is_spicy, in_stock, sort_order
    ) VALUES
      ('f0000000-0000-4000-8000-00000000e201', v_l_bistro, v_aizawl_id, 'Rice & Thali', 'Mizo Smoked Pork & Bai Platter', 'Steamed local rice with bamboo-shoot Bai and smoky pork.', 'non_veg', 260, '[]'::jsonb, '[{"key":"extra_rice","label":"Extra Steamed Rice","price_inr":40}]'::jsonb, 'lunch', true, true, true, 10),
      ('f0000000-0000-4000-8000-00000000e202', v_l_bistro, v_aizawl_id, 'Bakery', 'Butter Croissant (Fresh Baked)', 'Flaky French-style laminated pastry baked every morning.', 'egg', 110, '[]'::jsonb, '[]'::jsonb, 'breakfast', true, false, true, 20),
      ('f0000000-0000-4000-8000-00000000e203', v_l_bistro, v_aizawl_id, 'Bakery', 'Blueberry Cheesecake Slice', 'Creamy baked cheesecake topped with hill berry compote.', 'veg', 180, '[]'::jsonb, '[]'::jsonb, 'all_day', true, false, true, 30),
      ('f0000000-0000-4000-8000-00000000e204', v_l_bistro, v_aizawl_id, 'Mains', 'Herb Grilled Chicken Bowl', 'Grilled chicken breast with roasted veggies and garlic rice.', 'non_veg', 290, '[]'::jsonb, '[]'::jsonb, 'all_day', false, false, true, 40),
      ('f0000000-0000-4000-8000-00000000e205', v_l_bistro, v_aizawl_id, 'Beverages', 'Mizoram Single-Origin Cappuccino', 'Double espresso with velvety steamed milk.', 'veg', 140, '[]'::jsonb, '[]'::jsonb, 'all_day', false, false, true, 50)
    ON CONFLICT (id) DO NOTHING;

    -- 4. [SAMPLE] Khatla Fresh & Electronics Store (Aizawl, shop_catalogue)
    INSERT INTO public.listings (
      id, owner_id, owner_name, title, category, subcategory, category_id, status,
      locality, address, short_description, description, price,
      contact_phone, phone, cover_image, gallery_images,
      coordinates, lat, lng, rating, review_count, hub_id,
      listing_vertical, is_civic_record
    ) VALUES (
      v_l_khatla, v_owner_id, 'Khatla Fresh & Tech',
      '[SAMPLE] Khatla Fresh & Electronics Store',
      'business', 'Electronics & Mobile', v_cat_elec_id, 'published',
      'Khatla', 'New Secretariat Road, Khatla, Aizawl 796001',
      'Mobile accessories, power banks, fast chargers, and daily pantry essentials with quick pickup.',
      'Trusted Khatla convenience and mobile electronics store featuring live stock counts, counter pickup, and Pick N Drop dispatch across Aizawl.',
      299, '+91 98630 66204', '+91 98630 66204',
      'https://picsum.photos/seed/ddoodle-khatla-store/960/640', '[]'::jsonb,
      '{"lat":23.7204,"lng":92.7128}'::jsonb, 23.7204, 92.7128, 4.6, 19,
      v_aizawl_id, 'shop_catalogue', false
    ) ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.listing_shop_profiles (
      listing_id, hub_id, is_accepting_orders, allow_counter_pickup,
      allow_pick_n_drop, min_order_inr, packaging_fee_inr, prep_time_mins,
      store_verified, pickup_instructions
    ) VALUES (
      v_l_khatla, v_aizawl_id, true, true, true, 100, 10, 15, true,
      'Pickup at the express desk near the main entrance.'
    ) ON CONFLICT (listing_id) DO NOTHING;

    INSERT INTO public.marketplace_products (
      id, listing_id, owner_id, hub_id, title, description, price, unit, unit_label,
      category, shop_category_tag, in_stock, is_active, sort_order
    ) VALUES
      ('f0000000-0000-4000-8000-00000000f201', v_l_khatla, v_owner_id, v_aizawl_id, '33W USB-C Fast Wall Charger', 'BIS-certified 33W PD charger with braided cable.', 599, 'piece', '1 Unit', 'Electronics', 'Accessories', true, true, 10),
      ('f0000000-0000-4000-8000-00000000f202', v_l_khatla, v_owner_id, v_aizawl_id, '10,000 mAh Slim Power Bank', 'Dual USB-A + Type-C fast power bank for hill travel.', 1099, 'piece', '1 Unit', 'Electronics', 'Accessories', true, true, 20),
      ('f0000000-0000-4000-8000-00000000f203', v_l_khatla, v_owner_id, v_aizawl_id, 'Mizo Arabica Ground Coffee', 'Medium-roast Mizoram hill coffee beans, freshly ground.', 320, 'pack', '250g Pack', 'Groceries', 'Groceries', true, true, 30),
      ('f0000000-0000-4000-8000-00000000f204', v_l_khatla, v_owner_id, v_aizawl_id, 'Surge-Protected 4-Socket Extension', 'Heavy-duty spike guard with 2m cord.', 450, 'piece', '1 Piece', 'Electronics', 'Accessories', true, true, 40)
    ON CONFLICT (id) DO NOTHING;
  END IF;
END;
$$;
