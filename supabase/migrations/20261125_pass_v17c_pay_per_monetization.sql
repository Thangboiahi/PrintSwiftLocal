-- =============================================================================
-- Pass v17c: Pay-Per Monetization Engine (Marketplace, Bulletin, Real Estate)
-- =============================================================================
-- Strictly idempotent migration:
--   1. Creates `public.pay_per_pricing_configs` with Churachandpur starter
--      defaults for `marketplace_item`, `bulletin_post`, `real_estate_sale`,
--      and `real_estate_rent`, `super_admin`-only write RLS, and `audit_logs`
--      triggers.
--   2. Creates `public.pay_per_orders` ledger with a partial UNIQUE index on
--      `upper(trim(upi_utr_ref))` where active (`pending_verification`, `paid`)
--      to block UTR replay at the database layer.
--   3. Adds `paid_until timestamptz` (`IF NOT EXISTS`) on
--      `public.marketplace_products` (and `public.marketplace_items` if present),
--      `public.bulletins`, and `public.listings` so pay-per expiry works cleanly
--      without deleting user records.
--   4. Creates canonical `SECURITY DEFINER` RPCs:
--      - `public.calculate_pay_per_quote(...)`
--      - `public.submit_pay_per_order(...)`
--      - `public.review_pay_per_order(...)`
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. CONFIGURABLE PAY-PER PRICING RULES (`public.pay_per_pricing_configs`)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pay_per_pricing_configs (
  module_key text PRIMARY KEY
    CHECK (module_key IN ('marketplace_item', 'bulletin_post', 'real_estate_sale', 'real_estate_rent')),
  label text NOT NULL,
  is_enabled boolean NOT NULL DEFAULT true,
  duration_slabs jsonb NOT NULL DEFAULT '[]'::jsonb,
  addons jsonb NOT NULL DEFAULT '[]'::jsonb,
  price_bands jsonb NOT NULL DEFAULT '[]'::jsonb,
  area_bands_sqft jsonb NOT NULL DEFAULT '[]'::jsonb,
  min_cap_inr numeric(10,2) DEFAULT 0,
  max_cap_inr numeric(10,2) NULL,
  updated_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.touch_pay_per_pricing_configs_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  IF auth.uid() IS NOT NULL THEN
    NEW.updated_by := auth.uid();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pay_per_pricing_configs_updated_at ON public.pay_per_pricing_configs;
CREATE TRIGGER trg_pay_per_pricing_configs_updated_at
  BEFORE UPDATE ON public.pay_per_pricing_configs
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_pay_per_pricing_configs_updated_at();

ALTER TABLE public.pay_per_pricing_configs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pay_per_pricing_configs_public_select ON public.pay_per_pricing_configs;
CREATE POLICY pay_per_pricing_configs_public_select
  ON public.pay_per_pricing_configs
  FOR SELECT
  USING (is_enabled = true OR public.is_super_admin());

DROP POLICY IF EXISTS pay_per_pricing_configs_superadmin_insert ON public.pay_per_pricing_configs;
CREATE POLICY pay_per_pricing_configs_superadmin_insert
  ON public.pay_per_pricing_configs
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS pay_per_pricing_configs_superadmin_update ON public.pay_per_pricing_configs;
CREATE POLICY pay_per_pricing_configs_superadmin_update
  ON public.pay_per_pricing_configs
  FOR UPDATE
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS pay_per_pricing_configs_superadmin_delete ON public.pay_per_pricing_configs;
CREATE POLICY pay_per_pricing_configs_superadmin_delete
  ON public.pay_per_pricing_configs
  FOR DELETE
  TO authenticated
  USING (public.is_super_admin());

-- Attach immutable audit log trigger for Superadmin config changes
CREATE OR REPLACE FUNCTION public.audit_pay_per_pricing_configs_v17c()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text := COALESCE(NEW.module_key, OLD.module_key);
BEGIN
  IF to_regclass('public.audit_logs') IS NOT NULL THEN
    INSERT INTO public.audit_logs (
      actor_id,
      action,
      entity_type,
      entity_id,
      details
    )
    VALUES (
      auth.uid(),
      lower(TG_OP) || '_pay_per_pricing_config',
      'pay_per_pricing_configs',
      v_key,
      jsonb_build_object(
        'module_key', v_key,
        'is_enabled', CASE WHEN TG_OP = 'DELETE' THEN OLD.is_enabled ELSE NEW.is_enabled END,
        'min_cap_inr', CASE WHEN TG_OP = 'DELETE' THEN OLD.min_cap_inr ELSE NEW.min_cap_inr END,
        'max_cap_inr', CASE WHEN TG_OP = 'DELETE' THEN OLD.max_cap_inr ELSE NEW.max_cap_inr END
      )
    );
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_pay_per_pricing_configs_v17c ON public.pay_per_pricing_configs;
CREATE TRIGGER trg_audit_pay_per_pricing_configs_v17c
  AFTER INSERT OR UPDATE OR DELETE ON public.pay_per_pricing_configs
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_pay_per_pricing_configs_v17c();

-- Seed Churachandpur starter defaults idempotently (ON CONFLICT DO NOTHING)
INSERT INTO public.pay_per_pricing_configs (
  module_key,
  label,
  is_enabled,
  duration_slabs,
  addons,
  price_bands,
  area_bands_sqft,
  min_cap_inr,
  max_cap_inr
)
VALUES
  (
    'marketplace_item',
    'Marketplace Product (Pay-Per-Item)',
    true,
    '[
      {"id": "mp_7d", "label": "7 Days Showcase", "days": 7, "price_inr": 29, "is_popular": false},
      {"id": "mp_15d", "label": "15 Days Standard", "days": 15, "price_inr": 49, "is_popular": true},
      {"id": "mp_30d", "label": "30 Days Full Month", "days": 30, "price_inr": 79, "is_popular": false},
      {"id": "mp_60d", "label": "60 Days Extended", "days": 60, "price_inr": 129, "is_popular": false}
    ]'::jsonb,
    '[
      {"id": "featured_spot", "label": "Featured Marketplace Spotlight", "description": "Highlight badge in /marketplace feed", "price_inr": 39}
    ]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    19,
    499
  ),
  (
    'bulletin_post',
    'Community Bulletin Notice (Pay-Per-Post)',
    true,
    '[
      {"id": "bul_3d", "label": "3 Days Flash Notice", "days": 3, "price_inr": 49, "is_popular": false},
      {"id": "bul_7d", "label": "7 Days Weekly Notice", "days": 7, "price_inr": 79, "is_popular": true},
      {"id": "bul_15d", "label": "15 Days Campaign", "days": 15, "price_inr": 139, "is_popular": false},
      {"id": "bul_30d", "label": "30 Days Monthly Board", "days": 30, "price_inr": 229, "is_popular": false}
    ]'::jsonb,
    '[
      {"id": "featured_pin", "label": "Featured Top Pin", "description": "Pin notice near top of Bulletin feed", "price_inr": 49},
      {"id": "youtube_boost", "label": "YouTube Video Embed Boost", "description": "Include playable YouTube video on notice card", "price_inr": 29}
    ]'::jsonb,
    '[]'::jsonb,
    '[]'::jsonb,
    29,
    999
  ),
  (
    'real_estate_sale',
    'Real Estate — Property / Plot For Sale',
    true,
    '[
      {"id": "re_sale_15d", "label": "15 Days Listing", "days": 15, "price_inr": 199, "is_popular": false},
      {"id": "re_sale_30d", "label": "30 Days Standard", "days": 30, "price_inr": 299, "is_popular": true},
      {"id": "re_sale_60d", "label": "60 Days Extended", "days": 60, "price_inr": 499, "is_popular": false},
      {"id": "re_sale_90d", "label": "90 Days Quarter Pass", "days": 90, "price_inr": 699, "is_popular": false}
    ]'::jsonb,
    '[
      {"id": "re_featured_tag", "label": "Featured Property Badge", "description": "Priority highlight on Real Estate map & feed", "price_inr": 149}
    ]'::jsonb,
    '[
      {"id": "sale_p1", "label": "Up to ₹15 Lakh", "min_inr": 0, "max_inr": 1500000, "surcharge_inr": 0},
      {"id": "sale_p2", "label": "₹15 Lakh – ₹50 Lakh", "min_inr": 1500001, "max_inr": 5000000, "surcharge_inr": 100},
      {"id": "sale_p3", "label": "₹50 Lakh – ₹1.5 Crore", "min_inr": 5000001, "max_inr": 15000000, "surcharge_inr": 250},
      {"id": "sale_p4", "label": "Above ₹1.5 Crore", "min_inr": 15000001, "max_inr": null, "surcharge_inr": 450}
    ]'::jsonb,
    '[
      {"id": "sale_a1", "label": "Compact Plot / Flat (up to 2,400 sq.ft)", "min_sqft": 0, "max_sqft": 2400, "surcharge_inr": 0},
      {"id": "sale_a2", "label": "Standard Plot (2,401 – 10,890 sq.ft / ~0.25 Acre)", "min_sqft": 2401, "max_sqft": 10890, "surcharge_inr": 100},
      {"id": "sale_a3", "label": "Large Parcel (10,891 – 27,225 sq.ft / ~1 Sangam)", "min_sqft": 10891, "max_sqft": 27225, "surcharge_inr": 200},
      {"id": "sale_a4", "label": "Estate / Acreage (Above 1 Sangam / 27,225 sq.ft)", "min_sqft": 27226, "max_sqft": null, "surcharge_inr": 350}
    ]'::jsonb,
    199,
    1999
  ),
  (
    'real_estate_rent',
    'Real Estate — House / Shop / PG For Rent',
    true,
    '[
      {"id": "re_rent_15d", "label": "15 Days Rental Listing", "days": 15, "price_inr": 99, "is_popular": false},
      {"id": "re_rent_30d", "label": "30 Days Standard", "days": 30, "price_inr": 149, "is_popular": true},
      {"id": "re_rent_60d", "label": "60 Days Extended", "days": 60, "price_inr": 249, "is_popular": false}
    ]'::jsonb,
    '[
      {"id": "re_rent_featured", "label": "Featured Rental Highlight", "description": "Highlighted card in rental search", "price_inr": 79}
    ]'::jsonb,
    '[
      {"id": "rent_p1", "label": "Up to ₹8,000 / month", "min_inr": 0, "max_inr": 8000, "surcharge_inr": 0},
      {"id": "rent_p2", "label": "₹8,001 – ₹20,000 / month", "min_inr": 8001, "max_inr": 20000, "surcharge_inr": 50},
      {"id": "rent_p3", "label": "Above ₹20,000 / month", "min_inr": 20001, "max_inr": null, "surcharge_inr": 120}
    ]'::jsonb,
    '[
      {"id": "rent_a1", "label": "Room / Standard Unit (up to 1,500 sq.ft)", "min_sqft": 0, "max_sqft": 1500, "surcharge_inr": 0},
      {"id": "rent_a2", "label": "Large Commercial / Compound (> 1,500 sq.ft)", "min_sqft": 1501, "max_sqft": null, "surcharge_inr": 75}
    ]'::jsonb,
    99,
    999
  )
ON CONFLICT (module_key) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 2. PAY-PER ORDERS LEDGER (`public.pay_per_orders`) & `paid_until` COLUMNS
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.pay_per_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  module_key text NOT NULL
    CHECK (module_key IN ('marketplace_item', 'bulletin_post', 'real_estate_sale', 'real_estate_rent')),
  target_table text NOT NULL
    CHECK (target_table IN ('marketplace_items', 'marketplace_products', 'bulletins', 'listings')),
  target_id uuid NOT NULL,
  duration_days integer NOT NULL CHECK (duration_days > 0),
  quote_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb,
  amount_inr numeric(10,2) NOT NULL CHECK (amount_inr >= 0),
  payment_method text NOT NULL CHECK (payment_method IN ('upi', 'manual')),
  upi_utr_ref text NULL,
  status text NOT NULL DEFAULT 'pending_verification'
    CHECK (status IN ('pending_verification', 'paid', 'rejected', 'expired', 'refunded')),
  paid_until timestamptz NULL,
  reviewed_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  review_notes text NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Ensure target_table check constraint accepts both 'marketplace_items' and canonical 'marketplace_products'
DO $$
DECLARE
  v_con record;
BEGIN
  FOR v_con IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.pay_per_orders'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%target_table%'
  LOOP
    EXECUTE format('ALTER TABLE public.pay_per_orders DROP CONSTRAINT IF EXISTS %I', v_con.conname);
  END LOOP;

  ALTER TABLE public.pay_per_orders
    ADD CONSTRAINT pay_per_orders_target_table_v17c_check
    CHECK (target_table IN ('marketplace_items', 'marketplace_products', 'bulletins', 'listings'));
END;
$$;

-- UPI UTR Replay Guard: partial UNIQUE index on normalized UTR across active/pending orders
CREATE UNIQUE INDEX IF NOT EXISTS idx_pay_per_orders_unique_active_utr
  ON public.pay_per_orders (upper(trim(upi_utr_ref)))
  WHERE upi_utr_ref IS NOT NULL
    AND trim(upi_utr_ref) <> ''
    AND status IN ('pending_verification', 'paid');

CREATE INDEX IF NOT EXISTS idx_pay_per_orders_status_created
  ON public.pay_per_orders (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pay_per_orders_user_created
  ON public.pay_per_orders (user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_pay_per_orders_target
  ON public.pay_per_orders (target_table, target_id);

CREATE OR REPLACE FUNCTION public.touch_pay_per_orders_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pay_per_orders_updated_at ON public.pay_per_orders;
CREATE TRIGGER trg_pay_per_orders_updated_at
  BEFORE UPDATE ON public.pay_per_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_pay_per_orders_updated_at();

ALTER TABLE public.pay_per_orders ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pay_per_orders_owner_select ON public.pay_per_orders;
CREATE POLICY pay_per_orders_owner_select
  ON public.pay_per_orders
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_pnd_admin(auth.uid())
  );

DROP POLICY IF EXISTS pay_per_orders_owner_insert ON public.pay_per_orders;
CREATE POLICY pay_per_orders_owner_insert
  ON public.pay_per_orders
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND status = 'pending_verification'
    AND paid_until IS NULL
    AND reviewed_by IS NULL
  );

-- Add optional `paid_until timestamptz` column (`IF NOT EXISTS`) on target tables
ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS paid_until timestamptz NULL;

ALTER TABLE public.bulletins
  ADD COLUMN IF NOT EXISTS paid_until timestamptz NULL;

DO $$
BEGIN
  IF to_regclass('public.marketplace_products') IS NOT NULL THEN
    ALTER TABLE public.marketplace_products
      ADD COLUMN IF NOT EXISTS paid_until timestamptz NULL;
  END IF;

  IF to_regclass('public.marketplace_items') IS NOT NULL THEN
    ALTER TABLE public.marketplace_items
      ADD COLUMN IF NOT EXISTS paid_until timestamptz NULL;
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. CANONICAL RPC 1: `public.calculate_pay_per_quote`
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.calculate_pay_per_quote(
  p_module_key text,
  p_duration_days integer,
  p_property_price_inr numeric DEFAULT NULL,
  p_area_value numeric DEFAULT NULL,
  p_area_unit text DEFAULT 'sqft',
  p_addon_ids text[] DEFAULT '{}'::text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cfg public.pay_per_pricing_configs%ROWTYPE;
  v_unit text := lower(trim(COALESCE(p_area_unit, 'sqft')));
  v_normalized_sqft numeric := 0;
  v_slab jsonb := NULL;
  v_matched_slab jsonb := NULL;
  v_base_inr numeric(10,2) := 0;
  v_resolved_days integer := COALESCE(p_duration_days, 30);
  v_resolved_slab_label text := '';
  v_price_band jsonb := NULL;
  v_price_surcharge_inr numeric(10,2) := 0;
  v_price_band_label text := NULL;
  v_area_band jsonb := NULL;
  v_area_surcharge_inr numeric(10,2) := 0;
  v_area_band_label text := NULL;
  v_addon jsonb := NULL;
  v_addons_total_inr numeric(10,2) := 0;
  v_selected_addons jsonb := '[]'::jsonb;
  v_raw_total_inr numeric(10,2) := 0;
  v_final_total_inr numeric(10,2) := 0;
  v_cap_applied text := NULL;
BEGIN
  SELECT *
    INTO v_cfg
  FROM public.pay_per_pricing_configs
  WHERE module_key = trim(COALESCE(p_module_key, ''));

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invalid or unconfigured pay-per module_key: %', p_module_key
      USING ERRCODE = '22023';
  END IF;

  -- 1. Resolve matching duration slab (exact days match, or nearest slab fallback)
  IF jsonb_typeof(v_cfg.duration_slabs) = 'array' AND jsonb_array_length(v_cfg.duration_slabs) > 0 THEN
    FOR v_slab IN
      SELECT value FROM jsonb_array_elements(v_cfg.duration_slabs)
    LOOP
      IF COALESCE((v_slab->>'days')::integer, 0) = p_duration_days THEN
        v_matched_slab := v_slab;
        EXIT;
      END IF;
      IF v_matched_slab IS NULL THEN
        v_matched_slab := v_slab;
      END IF;
    END LOOP;
  END IF;

  IF v_matched_slab IS NOT NULL THEN
    v_base_inr := GREATEST(0, COALESCE((v_matched_slab->>'price_inr')::numeric, 0));
    v_resolved_days := GREATEST(1, COALESCE((v_matched_slab->>'days')::integer, COALESCE(p_duration_days, 30)));
    v_resolved_slab_label := COALESCE(v_matched_slab->>'label', v_resolved_days || ' Days');
  ELSE
    v_base_inr := 0;
    v_resolved_days := GREATEST(1, COALESCE(p_duration_days, 30));
    v_resolved_slab_label := v_resolved_days || ' Days';
  END IF;

  -- 2. Normalize area value -> sq.ft (sqft, sqm, acre, sangam)
  IF p_area_value IS NOT NULL AND p_area_value > 0 THEN
    IF v_unit IN ('sqm', 'sq.m', 'm2', 'sq_m') THEN
      v_normalized_sqft := round(p_area_value * 10.7639104, 2);
    ELSIF v_unit IN ('acre', 'acres') THEN
      v_normalized_sqft := round(p_area_value * 43560.0, 2);
    ELSIF v_unit IN ('sangam', 'sangams') THEN
      -- Standard Manipur / Churachandpur Sangam = 0.625 Acre = 27,225 sq.ft
      v_normalized_sqft := round(p_area_value * 27225.0, 2);
    ELSE
      v_normalized_sqft := round(p_area_value, 2);
    END IF;
  END IF;

  -- 3. Evaluate Real Estate Property Price Band surcharge
  IF p_property_price_inr IS NOT NULL
     AND p_property_price_inr >= 0
     AND jsonb_typeof(v_cfg.price_bands) = 'array' THEN
    FOR v_price_band IN
      SELECT value FROM jsonb_array_elements(v_cfg.price_bands)
    LOOP
      IF p_property_price_inr >= COALESCE((v_price_band->>'min_inr')::numeric, 0)
         AND (
           v_price_band->'max_inr' IS NULL
           OR v_price_band->'max_inr' = 'null'::jsonb
           OR (v_price_band->>'max_inr') = ''
           OR p_property_price_inr <= (v_price_band->>'max_inr')::numeric
         ) THEN
        v_price_surcharge_inr := GREATEST(0, COALESCE((v_price_band->>'surcharge_inr')::numeric, 0));
        v_price_band_label := COALESCE(v_price_band->>'label', 'Price Bracket');
        EXIT;
      END IF;
    END LOOP;
  END IF;

  -- 4. Evaluate Real Estate Land / Floor Area Band surcharge (in normalized sq.ft)
  IF v_normalized_sqft > 0
     AND jsonb_typeof(v_cfg.area_bands_sqft) = 'array' THEN
    FOR v_area_band IN
      SELECT value FROM jsonb_array_elements(v_cfg.area_bands_sqft)
    LOOP
      IF v_normalized_sqft >= COALESCE((v_area_band->>'min_sqft')::numeric, 0)
         AND (
           v_area_band->'max_sqft' IS NULL
           OR v_area_band->'max_sqft' = 'null'::jsonb
           OR (v_area_band->>'max_sqft') = ''
           OR v_normalized_sqft <= (v_area_band->>'max_sqft')::numeric
         ) THEN
        v_area_surcharge_inr := GREATEST(0, COALESCE((v_area_band->>'surcharge_inr')::numeric, 0));
        v_area_band_label := COALESCE(v_area_band->>'label', 'Area Bracket');
        EXIT;
      END IF;
    END LOOP;
  END IF;

  -- 5. Evaluate optional Add-ons
  IF COALESCE(array_length(p_addon_ids, 1), 0) > 0
     AND jsonb_typeof(v_cfg.addons) = 'array' THEN
    FOR v_addon IN
      SELECT value FROM jsonb_array_elements(v_cfg.addons)
    LOOP
      IF (v_addon->>'id') = ANY(p_addon_ids) THEN
        v_addons_total_inr := v_addons_total_inr + GREATEST(0, COALESCE((v_addon->>'price_inr')::numeric, 0));
        v_selected_addons := v_selected_addons || jsonb_build_array(
          jsonb_build_object(
            'id', v_addon->>'id',
            'label', COALESCE(v_addon->>'label', v_addon->>'id'),
            'price_inr', GREATEST(0, COALESCE((v_addon->>'price_inr')::numeric, 0))
          )
        );
      END IF;
    END LOOP;
  END IF;

  v_raw_total_inr := v_base_inr + v_price_surcharge_inr + v_area_surcharge_inr + v_addons_total_inr;
  v_final_total_inr := v_raw_total_inr;

  -- 6. Clamp between min_cap_inr and max_cap_inr
  IF v_cfg.min_cap_inr IS NOT NULL AND v_final_total_inr < v_cfg.min_cap_inr THEN
    v_final_total_inr := v_cfg.min_cap_inr;
    v_cap_applied := 'min_cap';
  END IF;

  IF v_cfg.max_cap_inr IS NOT NULL AND v_cfg.max_cap_inr > 0 AND v_final_total_inr > v_cfg.max_cap_inr THEN
    v_final_total_inr := v_cfg.max_cap_inr;
    v_cap_applied := 'max_cap';
  END IF;

  RETURN jsonb_build_object(
    'module_key', v_cfg.module_key,
    'module_label', v_cfg.label,
    'is_enabled', v_cfg.is_enabled,
    'duration_days', v_resolved_days,
    'duration_label', v_resolved_slab_label,
    'base_inr', round(v_base_inr, 2),
    'property_price_inr', p_property_price_inr,
    'price_band_label', v_price_band_label,
    'price_surcharge_inr', round(v_price_surcharge_inr, 2),
    'input_area_value', p_area_value,
    'input_area_unit', v_unit,
    'normalized_sqft', v_normalized_sqft,
    'area_band_label', v_area_band_label,
    'area_surcharge_inr', round(v_area_surcharge_inr, 2),
    'selected_addons', v_selected_addons,
    'addons_total_inr', round(v_addons_total_inr, 2),
    'raw_total_inr', round(v_raw_total_inr, 2),
    'min_cap_inr', v_cfg.min_cap_inr,
    'max_cap_inr', v_cfg.max_cap_inr,
    'cap_applied', v_cap_applied,
    'total_inr', round(v_final_total_inr, 2)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.calculate_pay_per_quote(text, integer, numeric, numeric, text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.calculate_pay_per_quote(text, integer, numeric, numeric, text, text[]) TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. CANONICAL RPC 2: `public.submit_pay_per_order`
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.submit_pay_per_order(
  p_module_key text,
  p_target_table text,
  p_target_id uuid,
  p_duration_days integer,
  p_payment_method text,
  p_upi_utr_ref text DEFAULT NULL,
  p_property_price_inr numeric DEFAULT NULL,
  p_area_value numeric DEFAULT NULL,
  p_area_unit text DEFAULT 'sqft',
  p_addon_ids text[] DEFAULT '{}'::text[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_method text := lower(trim(COALESCE(p_payment_method, 'upi')));
  v_clean_utr text := NULLIF(upper(trim(COALESCE(p_upi_utr_ref, ''))), '');
  v_target_table text := lower(trim(COALESCE(p_target_table, '')));
  v_policy_scope text;
  v_policy record;
  v_quote jsonb;
  v_amount_inr numeric(10,2);
  v_resolved_days integer;
  v_owner_ok boolean := false;
  v_order_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required to submit a pay-per order.'
      USING ERRCODE = '42501';
  END IF;

  IF p_target_id IS NULL THEN
    RAISE EXCEPTION 'Target item ID is required.'
      USING ERRCODE = '22023';
  END IF;

  IF v_target_table NOT IN ('marketplace_items', 'marketplace_products', 'bulletins', 'listings') THEN
    RAISE EXCEPTION 'Unsupported target_table: %', p_target_table
      USING ERRCODE = '22023';
  END IF;

  IF v_method NOT IN ('upi', 'manual') THEN
    RAISE EXCEPTION 'Payment method must be upi or manual.'
      USING ERRCODE = '22023';
  END IF;

  -- 1. Verify target ownership (or admin/super_admin privilege)
  IF public.is_pnd_admin(v_uid) THEN
    v_owner_ok := true;
  ELSIF v_target_table IN ('marketplace_items', 'marketplace_products') THEN
    IF to_regclass('public.marketplace_products') IS NOT NULL THEN
      SELECT EXISTS (
        SELECT 1
        FROM public.marketplace_products mp
        LEFT JOIN public.listings l ON l.id = mp.listing_id
        WHERE mp.id = p_target_id
          AND (mp.owner_id = v_uid OR l.owner_id = v_uid)
      ) INTO v_owner_ok;
    END IF;
    IF NOT v_owner_ok AND to_regclass('public.marketplace_items') IS NOT NULL THEN
      EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.marketplace_items WHERE id = $1 AND owner_id = $2)'
        INTO v_owner_ok
        USING p_target_id, v_uid;
    END IF;
  ELSIF v_target_table = 'bulletins' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.bulletins b WHERE b.id = p_target_id AND b.author_id = v_uid
    ) INTO v_owner_ok;
  ELSIF v_target_table = 'listings' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.listings l WHERE l.id = p_target_id AND l.owner_id = v_uid
    ) INTO v_owner_ok;
  END IF;

  IF NOT v_owner_ok THEN
    RAISE EXCEPTION 'Target record not found or you do not have permission to monetize it.'
      USING ERRCODE = '42501';
  END IF;

  -- 2. Verify payment method against `payment_feature_policies`
  v_policy_scope := CASE
    WHEN p_module_key = 'marketplace_item' THEN 'marketplace'
    WHEN p_module_key = 'bulletin_post' THEN 'bulletin'
    ELSE 'real_estate'
  END;

  IF to_regclass('public.payment_feature_policies') IS NOT NULL THEN
    SELECT upi_enabled, manual_enabled
      INTO v_policy
    FROM public.payment_feature_policies
    WHERE scope_key = v_policy_scope
    LIMIT 1;

    IF FOUND THEN
      IF v_method = 'upi' AND v_policy.upi_enabled IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Online UPI is currently disabled for this category. Please select Manual Payment.'
          USING ERRCODE = 'P0001';
      END IF;
      IF v_method = 'manual' AND v_policy.manual_enabled IS DISTINCT FROM true THEN
        RAISE EXCEPTION 'Manual payment is currently disabled for this category. Please pay via UPI.'
          USING ERRCODE = 'P0001';
      END IF;
    END IF;
  END IF;

  -- 3. Validate UTR format when payment_method = 'upi'
  IF v_method = 'upi' THEN
    IF v_clean_utr IS NULL OR length(v_clean_utr) < 8 OR length(v_clean_utr) > 32 OR v_clean_utr !~ '^[A-Z0-9_-]+$' THEN
      RAISE EXCEPTION 'Please enter a valid 8–32 character alphanumeric UPI UTR / Reference number.'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  -- 4. Recompute authoritative server-side quote via `calculate_pay_per_quote`
  v_quote := public.calculate_pay_per_quote(
    p_module_key,
    p_duration_days,
    p_property_price_inr,
    p_area_value,
    p_area_unit,
    p_addon_ids
  );

  IF COALESCE((v_quote->>'is_enabled')::boolean, false) = false THEN
    RAISE EXCEPTION 'Pay-Per publishing is currently disabled for %.', COALESCE(v_quote->>'module_label', p_module_key)
      USING ERRCODE = 'P0001';
  END IF;

  v_amount_inr := GREATEST(0, COALESCE((v_quote->>'total_inr')::numeric, 0));
  v_resolved_days := GREATEST(1, COALESCE((v_quote->>'duration_days')::integer, p_duration_days));

  -- 5. Insert order (catching 23505 duplicate UTR replay cleanly)
  BEGIN
    INSERT INTO public.pay_per_orders (
      user_id,
      module_key,
      target_table,
      target_id,
      duration_days,
      quote_breakdown,
      amount_inr,
      payment_method,
      upi_utr_ref,
      status
    )
    VALUES (
      v_uid,
      p_module_key,
      v_target_table,
      p_target_id,
      v_resolved_days,
      v_quote,
      v_amount_inr,
      v_method,
      v_clean_utr,
      'pending_verification'
    )
    RETURNING id INTO v_order_id;
  EXCEPTION
    WHEN unique_violation THEN
      RAISE EXCEPTION 'This UPI UTR reference (%) has already been submitted on another active or pending payment.', v_clean_utr
        USING ERRCODE = '23505';
  END;

  IF to_regclass('public.audit_logs') IS NOT NULL THEN
    INSERT INTO public.audit_logs (
      actor_id,
      action,
      entity_type,
      entity_id,
      details
    )
    VALUES (
      v_uid,
      'submit_pay_per_order',
      'pay_per_orders',
      v_order_id::text,
      jsonb_build_object(
        'module_key', p_module_key,
        'target_table', v_target_table,
        'target_id', p_target_id,
        'duration_days', v_resolved_days,
        'amount_inr', v_amount_inr,
        'payment_method', v_method,
        'upi_utr_ref', v_clean_utr
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'order_id', v_order_id,
    'status', 'pending_verification',
    'amount_inr', v_amount_inr,
    'duration_days', v_resolved_days,
    'quote_breakdown', v_quote
  );
END;
$$;

REVOKE ALL ON FUNCTION public.submit_pay_per_order(text, text, uuid, integer, text, text, numeric, numeric, text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_pay_per_order(text, text, uuid, integer, text, text, numeric, numeric, text, text[]) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. CANONICAL RPC 3: `public.review_pay_per_order`
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.review_pay_per_order(
  p_order_id uuid,
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
  v_clean_notes text := NULLIF(trim(COALESCE(p_notes, '')), '');
  v_order public.pay_per_orders%ROWTYPE;
  v_paid_until timestamptz := NULL;
  v_selected_addons jsonb;
  v_has_featured boolean := false;
BEGIN
  IF v_uid IS NULL OR NOT public.is_pnd_admin(v_uid) THEN
    RAISE EXCEPTION 'Only Admin or Super-Admin can review pay-per orders.'
      USING ERRCODE = '42501';
  END IF;

  IF v_decision NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'Decision must be approve or reject.'
      USING ERRCODE = '22023';
  END IF;

  IF v_decision = 'reject' AND (v_clean_notes IS NULL OR length(v_clean_notes) < 4) THEN
    RAISE EXCEPTION 'A rejection reason note (at least 4 characters) is required.'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_order
  FROM public.pay_per_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pay-per order not found.'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_decision = 'approve' THEN
    v_paid_until := now() + (v_order.duration_days || ' days')::interval;
    v_selected_addons := COALESCE(v_order.quote_breakdown->'selected_addons', '[]'::jsonb);

    SELECT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(v_selected_addons) = 'array' THEN v_selected_addons ELSE '[]'::jsonb END
      ) AS a
      WHERE (a->>'id') IN ('featured_spot', 'featured_pin', 're_featured_tag', 're_rent_featured')
    ) INTO v_has_featured;

    UPDATE public.pay_per_orders
    SET
      status = 'paid',
      paid_until = v_paid_until,
      reviewed_by = v_uid,
      review_notes = v_clean_notes,
      updated_at = now()
    WHERE id = p_order_id;

    -- Activate & stamp `paid_until` on the target record without deleting data on expiry
    IF v_order.target_table IN ('marketplace_items', 'marketplace_products') THEN
      IF to_regclass('public.marketplace_products') IS NOT NULL THEN
        UPDATE public.marketplace_products
        SET
          paid_until = GREATEST(COALESCE(paid_until, now()), now()) + (v_order.duration_days || ' days')::interval,
          is_active = true
        WHERE id = v_order.target_id;
      END IF;
      IF to_regclass('public.marketplace_items') IS NOT NULL THEN
        EXECUTE 'UPDATE public.marketplace_items SET paid_until = GREATEST(COALESCE(paid_until, now()), now()) + ($1 || '' days'')::interval, is_active = true WHERE id = $2'
          USING v_order.duration_days, v_order.target_id;
      END IF;
    ELSIF v_order.target_table = 'bulletins' THEN
      UPDATE public.bulletins
      SET
        paid_until = GREATEST(COALESCE(paid_until, now()), now()) + (v_order.duration_days || ' days')::interval,
        expires_at = GREATEST(COALESCE(expires_at, now()), now()) + (v_order.duration_days || ' days')::interval,
        status = 'published',
        is_pinned = CASE WHEN v_has_featured THEN true ELSE is_pinned END
      WHERE id = v_order.target_id;
    ELSIF v_order.target_table = 'listings' THEN
      UPDATE public.listings
      SET
        paid_until = GREATEST(COALESCE(paid_until, now()), now()) + (v_order.duration_days || ' days')::interval,
        status = CASE
          WHEN status IN ('pending', 'pending_verification', 'pending_payment', 'draft') THEN 'published'
          ELSE status
        END,
        is_featured = CASE WHEN v_has_featured THEN true ELSE is_featured END,
        updated_at = now()
      WHERE id = v_order.target_id;
    END IF;
  ELSE
    UPDATE public.pay_per_orders
    SET
      status = 'rejected',
      reviewed_by = v_uid,
      review_notes = v_clean_notes,
      updated_at = now()
    WHERE id = p_order_id;
  END IF;

  IF to_regclass('public.audit_logs') IS NOT NULL THEN
    INSERT INTO public.audit_logs (
      actor_id,
      action,
      entity_type,
      entity_id,
      details
    )
    VALUES (
      v_uid,
      'review_pay_per_order_' || v_decision,
      'pay_per_orders',
      p_order_id::text,
      jsonb_build_object(
        'order_id', p_order_id,
        'decision', v_decision,
        'module_key', v_order.module_key,
        'target_table', v_order.target_table,
        'target_id', v_order.target_id,
        'amount_inr', v_order.amount_inr,
        'paid_until', v_paid_until,
        'notes', v_clean_notes
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'order_id', p_order_id,
    'status', CASE WHEN v_decision = 'approve' THEN 'paid' ELSE 'rejected' END,
    'paid_until', v_paid_until
  );
END;
$$;

REVOKE ALL ON FUNCTION public.review_pay_per_order(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_pay_per_order(uuid, text, text) TO authenticated, service_role;

-- Also upgrade enforce_bulletin_quota() so owners publishing a bulletin for Pay-Per checkout
-- can either use active/trialing subscription quota, an available pass, or create a draft/pending
-- bulletin for immediate pay-per order attachment.
CREATE OR REPLACE FUNCTION public.enforce_bulletin_quota()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_author_role text;
  v_plan record;
  v_pass record;
  v_active_count integer := 0;
  v_monthly_count integer := 0;
  v_image_count integer := 0;
BEGIN
  PERFORM set_config('app.bulletin_pass_id', '', true);

  -- Allow non-published drafts/pending-payment rows to be created so submit_pay_per_order can attach to target_id
  IF COALESCE(NEW.status, 'published') <> 'published' THEN
    RETURN NEW;
  END IF;

  SELECT lower(coalesce(role, 'visitor'))
    INTO v_author_role
  FROM public.profiles
  WHERE id = NEW.author_id;

  IF v_author_role IN ('admin', 'super_admin') THEN
    RETURN NEW;
  END IF;

  -- Check for an active OR trialing subscription with remaining quota
  SELECT
    sp.id,
    sp.name,
    sp.max_active_bulletins,
    sp.max_monthly_posts,
    sp.max_images_per_post,
    sp.allow_youtube
  INTO v_plan
  FROM public.user_subscriptions us
  INNER JOIN public.subscription_plans sp ON sp.id = us.plan_id
  WHERE us.user_id = NEW.author_id
    AND us.status IN ('active', 'trialing')
    AND COALESCE(us.ends_at, us.expires_at) > now()
    AND sp.is_active = true
  ORDER BY COALESCE(us.ends_at, us.expires_at) DESC
  LIMIT 1;

  IF FOUND THEN
    SELECT count(*)
      INTO v_active_count
    FROM public.bulletins b
    WHERE b.author_id = NEW.author_id
      AND b.status = 'published'
      AND (b.expires_at IS NULL OR b.expires_at > now());

    SELECT count(*)
      INTO v_monthly_count
    FROM public.bulletins b
    WHERE b.author_id = NEW.author_id
      AND b.created_at >= date_trunc('month', now());

    IF v_active_count < GREATEST(COALESCE(v_plan.max_active_bulletins, 0), 0)
       AND v_monthly_count < GREATEST(COALESCE(v_plan.max_monthly_posts, 0), 0) THEN
      v_image_count := coalesce(array_length(NEW.image_urls, 1), 0);
      IF v_image_count > COALESCE(v_plan.max_images_per_post, 5) THEN
        RAISE EXCEPTION 'Image attachment limit exceeded: % plan allows at most % images per bulletin.',
          v_plan.name, v_plan.max_images_per_post
          USING ERRCODE = 'P0001';
      END IF;

      IF NEW.youtube_video_id IS NOT NULL AND coalesce(v_plan.allow_youtube, false) = false THEN
        RAISE EXCEPTION 'YouTube embeds are not included in your current % subscription plan.',
          v_plan.name
          USING ERRCODE = 'P0001';
      END IF;

      RETURN NEW;
    END IF;
  END IF;

  -- Fallback: Check for a verified 'available' Pay-Per-Post pass
  SELECT bp.id, bp.duration_days
    INTO v_pass
  FROM public.bulletin_post_passes bp
  WHERE bp.user_id = NEW.author_id
    AND bp.status = 'available'
    AND bp.used_bulletin_id IS NULL
  ORDER BY bp.created_at ASC
  LIMIT 1
  FOR UPDATE SKIP LOCKED;

  IF FOUND THEN
    NEW.expires_at := coalesce(
      NEW.expires_at,
      now() + (v_pass.duration_days || ' days')::interval
    );
    PERFORM set_config('app.bulletin_pass_id', v_pass.id::text, true);
    RETURN NEW;
  END IF;

  -- Allow if a paid pay_per_orders row already exists for this bulletin
  IF NEW.paid_until IS NOT NULL AND NEW.paid_until > now() THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Active subscription or verified Pay-Per-Post pass required.'
    USING ERRCODE = 'P0001';
END;
$$;
