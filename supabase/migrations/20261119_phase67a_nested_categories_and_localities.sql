-- =============================================================================
-- Migration: 20261119_phase67a_nested_categories_and_localities.sql
-- Phase 67-A: Unified 3-Level Nested Category Tree (`categories` +
--             `category_suggestions`), Hub-Scoped Locality Pool (`hub_localities`
--             with pg_trgm fuzzy search & aliases), Legacy Data Migration &
--             Backfill, Atomic Merge/Promote RPCs, and Hub-Scoped RLS
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Required Extensions & Timestamp Helper (100% Idempotent)
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_namespace WHERE nspname = 'extensions') THEN
    CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;
  ELSE
    CREATE EXTENSION IF NOT EXISTS pg_trgm;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_phase67_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Ensure core RBAC helpers exist (no-op if Phase 66-A already deployed them)
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

-- =============================================================================
-- 1. Unified Nested Categories & Category Suggestions Tables
-- =============================================================================

-- 1a. public.categories (Upgrades legacy 00002_create_full_schema table safely if present)
CREATE TABLE IF NOT EXISTS public.categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL DEFAULT 'listing',
  parent_id uuid REFERENCES public.categories(id) ON DELETE CASCADE,
  depth integer NOT NULL DEFAULT 0,
  slug text NOT NULL,
  display_name text NOT NULL,
  icon text DEFAULT 'Tag',
  color_hex text DEFAULT '#2563EB',
  sort_order integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Add Phase 67-A columns idempotently in case legacy public.categories already existed
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS entity_type text DEFAULT 'listing',
  ADD COLUMN IF NOT EXISTS parent_id uuid REFERENCES public.categories(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS depth integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS slug text,
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS icon text DEFAULT 'Tag',
  ADD COLUMN IF NOT EXISTS color_hex text DEFAULT '#2563EB',
  ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Reconcile legacy columns (`name`, single-column `UNIQUE (slug)`) & enforce Phase 67-A constraints
DO $$
DECLARE
  v_has_name boolean;
  v_con record;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'categories'
      AND column_name = 'name'
  ) INTO v_has_name;

  IF v_has_name THEN
    EXECUTE 'ALTER TABLE public.categories ALTER COLUMN name DROP NOT NULL';
    EXECUTE '
      UPDATE public.categories
      SET display_name = COALESCE(NULLIF(trim(display_name), ''''), NULLIF(trim(name), ''''), slug, ''Category'')
      WHERE display_name IS NULL OR trim(display_name) = ''''
    ';
  ELSE
    UPDATE public.categories
    SET display_name = COALESCE(NULLIF(trim(display_name), ''), slug, 'Category')
    WHERE display_name IS NULL OR trim(display_name) = '';
  END IF;

  UPDATE public.categories
  SET entity_type = 'listing'
  WHERE entity_type IS NULL
     OR entity_type NOT IN ('listing', 'product', 'bulletin', 'vehicle');

  UPDATE public.categories
  SET slug = regexp_replace(lower(COALESCE(NULLIF(trim(slug), ''), display_name, id::text)), '[^a-z0-9]+', '_', 'g')
  WHERE slug IS NULL OR trim(slug) = '';

  UPDATE public.categories
  SET depth = 0
  WHERE depth IS NULL OR depth < 0 OR depth > 2;

  UPDATE public.categories
  SET sort_order = 0
  WHERE sort_order IS NULL;

  UPDATE public.categories
  SET is_active = true
  WHERE is_active IS NULL;

  -- Drop legacy single-column UNIQUE(slug) constraint if present so UNIQUE(entity_type, slug) works across entity types
  FOR v_con IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'categories'
      AND c.contype = 'u'
      AND array_length(c.conkey, 1) = 1
      AND pg_get_constraintdef(c.oid) ~* '\(slug\)'
  LOOP
    EXECUTE format('ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS %I', v_con.conname);
  END LOOP;
END;
$$;

ALTER TABLE public.categories
  ALTER COLUMN entity_type SET NOT NULL,
  ALTER COLUMN entity_type SET DEFAULT 'listing',
  ALTER COLUMN depth SET NOT NULL,
  ALTER COLUMN depth SET DEFAULT 0,
  ALTER COLUMN slug SET NOT NULL,
  ALTER COLUMN display_name SET NOT NULL,
  ALTER COLUMN sort_order SET NOT NULL,
  ALTER COLUMN sort_order SET DEFAULT 0,
  ALTER COLUMN is_active SET NOT NULL,
  ALTER COLUMN is_active SET DEFAULT true;

ALTER TABLE public.categories
  DROP CONSTRAINT IF EXISTS categories_entity_type_check;
ALTER TABLE public.categories
  ADD CONSTRAINT categories_entity_type_check
  CHECK (entity_type IN ('listing', 'product', 'bulletin', 'vehicle'));

ALTER TABLE public.categories
  DROP CONSTRAINT IF EXISTS categories_depth_check;
ALTER TABLE public.categories
  ADD CONSTRAINT categories_depth_check
  CHECK (depth BETWEEN 0 AND 2);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'categories'
      AND c.conname = 'categories_entity_type_slug_key'
  ) THEN
    ALTER TABLE public.categories
      ADD CONSTRAINT categories_entity_type_slug_key
      UNIQUE (entity_type, slug);
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_categories_entity_parent_active_sort
  ON public.categories (entity_type, parent_id, is_active, sort_order);

CREATE INDEX IF NOT EXISTS idx_categories_parent_id
  ON public.categories (parent_id);

-- BEFORE INSERT OR UPDATE trigger strictly enforcing depth (0..2), parent entity_type match & acyclic hierarchy
CREATE OR REPLACE FUNCTION public.enforce_category_depth()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_parent record;
  v_has_cycle boolean := false;
  v_max_descendant_offset integer := 0;
BEGIN
  NEW.slug := trim(both '_' FROM regexp_replace(lower(COALESCE(NEW.slug, NEW.display_name, '')), '[^a-z0-9]+', '_', 'g'));
  IF NEW.slug = '' THEN
    RAISE EXCEPTION 'Category slug cannot be empty.' USING ERRCODE = '22023';
  END IF;

  IF NEW.parent_id IS NULL THEN
    NEW.depth := 0;
  ELSE
    IF TG_OP = 'UPDATE' AND NEW.parent_id = NEW.id THEN
      RAISE EXCEPTION 'Category cannot be its own parent.' USING ERRCODE = '22023';
    END IF;

    SELECT id, entity_type, depth
      INTO v_parent
    FROM public.categories
    WHERE id = NEW.parent_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Parent category (%) does not exist.', NEW.parent_id USING ERRCODE = '23503';
    END IF;

    IF v_parent.entity_type <> NEW.entity_type THEN
      RAISE EXCEPTION 'Parent category entity_type (%) must match child entity_type (%).',
        v_parent.entity_type, NEW.entity_type
        USING ERRCODE = '22023';
    END IF;

    IF TG_OP = 'UPDATE' THEN
      -- Prevent circular references by walking upward from NEW.parent_id
      WITH RECURSIVE ancestors AS (
        SELECT id, parent_id
        FROM public.categories
        WHERE id = NEW.parent_id
        UNION ALL
        SELECT c.id, c.parent_id
        FROM public.categories c
        INNER JOIN ancestors a ON c.id = a.parent_id
      )
      SELECT EXISTS (SELECT 1 FROM ancestors WHERE id = NEW.id)
        INTO v_has_cycle;

      IF v_has_cycle THEN
        RAISE EXCEPTION 'Circular category hierarchy detected.' USING ERRCODE = '22023';
      END IF;
    END IF;

    NEW.depth := v_parent.depth + 1;
  END IF;

  IF NEW.depth > 2 THEN
    RAISE EXCEPTION 'Maximum category depth of 2 exceeded (computed depth: %).', NEW.depth
      USING ERRCODE = '22023';
  END IF;

  -- On UPDATE, verify existing descendants will not exceed max depth 2
  IF TG_OP = 'UPDATE' AND NEW.depth IS DISTINCT FROM OLD.depth THEN
    WITH RECURSIVE descendants AS (
      SELECT id, 1 AS rel_depth
      FROM public.categories
      WHERE parent_id = NEW.id
      UNION ALL
      SELECT c.id, d.rel_depth + 1
      FROM public.categories c
      INNER JOIN descendants d ON c.parent_id = d.id
    )
    SELECT COALESCE(MAX(rel_depth), 0)
      INTO v_max_descendant_offset
    FROM descendants;

    IF NEW.depth + v_max_descendant_offset > 2 THEN
      RAISE EXCEPTION 'Reparenting would push descendant categories beyond maximum depth of 2.'
        USING ERRCODE = '22023';
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_categories_enforce_depth ON public.categories;
CREATE TRIGGER trg_categories_enforce_depth
  BEFORE INSERT OR UPDATE ON public.categories
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_category_depth();

-- 1b. public.category_suggestions
CREATE TABLE IF NOT EXISTS public.category_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entity_type text NOT NULL CHECK (entity_type IN ('listing', 'product', 'bulletin', 'vehicle')),
  parent_category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  suggested_name text NOT NULL,
  normalized_name text NOT NULL,
  hub_id uuid REFERENCES public.service_hubs(id) ON DELETE SET NULL,
  submitted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  linked_entity_id uuid,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'promoted', 'rejected')),
  promoted_category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_category_suggestions_entity_status_norm
  ON public.category_suggestions (entity_type, status, normalized_name);

CREATE INDEX IF NOT EXISTS idx_category_suggestions_hub_status
  ON public.category_suggestions (hub_id, status);

CREATE OR REPLACE FUNCTION public.normalize_category_suggestion_name()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.suggested_name := trim(regexp_replace(COALESCE(NEW.suggested_name, ''), '\s+', ' ', 'g'));
  IF NEW.suggested_name = '' THEN
    RAISE EXCEPTION 'Suggested category name cannot be empty.' USING ERRCODE = '22023';
  END IF;
  NEW.normalized_name := lower(trim(regexp_replace(
    COALESCE(NULLIF(NEW.normalized_name, ''), NEW.suggested_name),
    '\s+',
    ' ',
    'g'
  )));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_category_suggestions_normalize ON public.category_suggestions;
CREATE TRIGGER trg_category_suggestions_normalize
  BEFORE INSERT OR UPDATE ON public.category_suggestions
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_category_suggestion_name();

-- =============================================================================
-- 2. Hub-Scoped Locality Pool (`public.hub_localities`)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.hub_localities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id uuid NOT NULL REFERENCES public.service_hubs(id) ON DELETE CASCADE,
  slug text NOT NULL,
  display_name text NOT NULL,
  aliases text[] NOT NULL DEFAULT '{}',
  lat double precision,
  lng double precision,
  point geography(Point, 4326),
  source text NOT NULL DEFAULT 'admin' CHECK (source IN ('admin', 'user_submitted', 'google_reference')),
  status text NOT NULL DEFAULT 'verified' CHECK (status IN ('verified', 'pending', 'merged')),
  merged_into_id uuid REFERENCES public.hub_localities(id) ON DELETE SET NULL,
  usage_count integer NOT NULL DEFAULT 0,
  submitted_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE (hub_id, slug)
);

CREATE OR REPLACE FUNCTION public.sync_hub_locality_point()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, extensions
AS $$
BEGIN
  NEW.display_name := trim(regexp_replace(COALESCE(NEW.display_name, ''), '\s+', ' ', 'g'));
  IF NEW.display_name = '' THEN
    RAISE EXCEPTION 'Locality display_name cannot be empty.' USING ERRCODE = '22023';
  END IF;

  IF NEW.slug IS NULL OR trim(NEW.slug) = '' THEN
    NEW.slug := trim(both '_' FROM regexp_replace(lower(NEW.display_name), '[^a-z0-9]+', '_', 'g'));
  END IF;

  IF NEW.lat IS NOT NULL AND NEW.lng IS NOT NULL THEN
    NEW.point := ST_SetSRID(ST_MakePoint(NEW.lng, NEW.lat), 4326)::geography;
  ELSE
    NEW.point := NULL;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_hub_localities_sync_point ON public.hub_localities;
CREATE TRIGGER trg_hub_localities_sync_point
  BEFORE INSERT OR UPDATE ON public.hub_localities
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_hub_locality_point();

CREATE INDEX IF NOT EXISTS idx_hub_localities_hub_status
  ON public.hub_localities (hub_id, status);

CREATE INDEX IF NOT EXISTS idx_hub_localities_aliases_gin
  ON public.hub_localities USING GIN (aliases);

CREATE INDEX IF NOT EXISTS idx_hub_localities_point_gist
  ON public.hub_localities USING GIST (point);

DO $$
BEGIN
  SET LOCAL search_path = public, extensions;
  CREATE INDEX IF NOT EXISTS idx_hub_localities_display_name_trgm
    ON public.hub_localities USING GIN (display_name gin_trgm_ops);
END;
$$;

-- =============================================================================
-- 3. Migrate Legacy Flat Data & Seed Nested Category Tree + Hub Localities
-- =============================================================================

-- 3a. Migrate existing `app_categories` rows into `categories` as depth = 0 root nodes
DO $$
BEGIN
  IF to_regclass('public.app_categories') IS NOT NULL THEN
    INSERT INTO public.categories (
      entity_type,
      parent_id,
      depth,
      slug,
      display_name,
      icon,
      color_hex,
      sort_order,
      is_active
    )
    SELECT
      CASE ac.module
        WHEN 'explore' THEN 'listing'
        WHEN 'marketplace' THEN 'product'
        WHEN 'bulletin' THEN 'bulletin'
        ELSE 'listing'
      END AS entity_type,
      NULL AS parent_id,
      0 AS depth,
      ac.slug,
      ac.display_name,
      COALESCE(ac.icon, 'Tag'),
      COALESCE(ac.color_hex, '#2563EB'),
      COALESCE(ac.sort_order, 0),
      COALESCE(ac.is_active, true)
    FROM public.app_categories ac
    ON CONFLICT (entity_type, slug) DO NOTHING;
  END IF;
END;
$$;

-- 3b. Ensure core root categories exist across all 4 entity_types & seed depth-1 / depth-2 nodes
INSERT INTO public.categories (entity_type, parent_id, depth, slug, display_name, icon, color_hex, sort_order, is_active)
VALUES
  -- Listing roots
  ('listing', NULL, 0, 'businesses_shops', 'Businesses & Shops', 'Store', '#2563EB', 10, true),
  ('listing', NULL, 0, 'services', 'Services', 'Wrench', '#0D9488', 20, true),
  ('listing', NULL, 0, 'real_estate', 'Real Estate', 'Home', '#D97706', 30, true),
  ('listing', NULL, 0, 'public_community', 'Public & Community', 'Landmark', '#7C3AED', 40, true),
  ('listing', NULL, 0, 'retail_shopping', 'Retail & Shopping', 'ShoppingBag', '#EC4899', 50, true),
  ('listing', NULL, 0, 'print_digital', 'Print & Digital', 'Printer', '#4F46E5', 60, true),
  ('listing', NULL, 0, 'vehicles_rentals', 'Vehicles & Rentals', 'Car', '#059669', 70, true),
  -- Product roots
  ('product', NULL, 0, 'electronics', 'Electronics', 'Smartphone', '#0284C7', 10, true),
  ('product', NULL, 0, 'fashion_traditional_wear', 'Fashion & Traditional Wear', 'Shirt', '#DB2777', 20, true),
  ('product', NULL, 0, 'home_kitchen', 'Home & Kitchen', 'UtensilsCrossed', '#EA580C', 30, true),
  ('product', NULL, 0, 'stationery_print', 'Stationery & Print', 'Printer', '#4F46E5', 40, true),
  ('product', NULL, 0, 'local_produce', 'Local Produce', 'Sprout', '#16A34A', 50, true),
  -- Bulletin roots
  ('bulletin', NULL, 0, 'announcement', 'Announcement', 'Megaphone', '#2563EB', 10, true),
  ('bulletin', NULL, 0, 'job', 'Job', 'Briefcase', '#059669', 20, true),
  ('bulletin', NULL, 0, 'advertisement', 'Advertisement', 'Sparkles', '#D97706', 30, true),
  ('bulletin', NULL, 0, 'notice', 'Notice', 'Bell', '#DC2626', 40, true),
  ('bulletin', NULL, 0, 'event', 'Event', 'Calendar', '#7C3AED', 50, true),
  -- Vehicle roots
  ('vehicle', NULL, 0, 'city_taxi_auto', 'City Taxi & Auto', 'CarTaxiFront', '#059669', 10, true),
  ('vehicle', NULL, 0, 'four_wd_hill_charter', '4WD & Hill Charter', 'Mountain', '#D97706', 20, true),
  ('vehicle', NULL, 0, 'inter_hub_winger_sumo', 'Inter-Hub Winger / Sumo', 'Bus', '#2563EB', 30, true),
  ('vehicle', NULL, 0, 'goods_pickup_truck', 'Goods & Pickup Truck', 'Truck', '#475569', 40, true)
ON CONFLICT (entity_type, slug) DO NOTHING;

-- Seed Depth-1 Subcategories & Depth-2 Micro-Categories idempotently
DO $$
DECLARE
  v_parent_id uuid;
  v_sub_id uuid;
BEGIN
  -- ---------------------------------------------------------------------------
  -- LISTING SUBCATEGORIES
  -- ---------------------------------------------------------------------------
  SELECT id INTO v_parent_id FROM public.categories WHERE entity_type = 'listing' AND slug = 'businesses_shops' LIMIT 1;
  IF v_parent_id IS NOT NULL THEN
    INSERT INTO public.categories (entity_type, parent_id, slug, display_name, icon, color_hex, sort_order)
    VALUES
      ('listing', v_parent_id, 'electronics_mobile', 'Electronics & Mobile', 'Smartphone', '#2563EB', 10),
      ('listing', v_parent_id, 'pharmacy_health', 'Pharmacy & Health', 'Pill', '#16A34A', 20),
      ('listing', v_parent_id, 'groceries_mart', 'Groceries & Mart', 'ShoppingBasket', '#0D9488', 30),
      ('listing', v_parent_id, 'printing_xerox', 'Printing & Xerox', 'Printer', '#4F46E5', 40),
      ('listing', v_parent_id, 'hardware_building', 'Hardware & Building', 'Hammer', '#475569', 50),
      ('listing', v_parent_id, 'cafes_restaurants', 'Cafes & Restaurants', 'UtensilsCrossed', '#EA580C', 60)
    ON CONFLICT (entity_type, slug) DO NOTHING;

    -- Depth-2 under Electronics & Mobile
    SELECT id INTO v_sub_id FROM public.categories WHERE entity_type = 'listing' AND slug = 'electronics_mobile' LIMIT 1;
    IF v_sub_id IS NOT NULL THEN
      INSERT INTO public.categories (entity_type, parent_id, slug, display_name, icon, color_hex, sort_order)
      VALUES
        ('listing', v_sub_id, 'phone_repair', 'Phone Repair', 'Wrench', '#2563EB', 10),
        ('listing', v_sub_id, 'laptop_computer_service', 'Laptop & Computer Service', 'Laptop', '#0284C7', 20),
        ('listing', v_sub_id, 'mobile_accessories', 'Mobile Accessories', 'Headphones', '#4F46E5', 30)
      ON CONFLICT (entity_type, slug) DO NOTHING;
    END IF;

    -- Depth-2 under Pharmacy & Health
    SELECT id INTO v_sub_id FROM public.categories WHERE entity_type = 'listing' AND slug = 'pharmacy_health' LIMIT 1;
    IF v_sub_id IS NOT NULL THEN
      INSERT INTO public.categories (entity_type, parent_id, slug, display_name, icon, color_hex, sort_order)
      VALUES
        ('listing', v_sub_id, 'medical_store', 'Medical Store & Chemist', 'Pill', '#16A34A', 10),
        ('listing', v_sub_id, 'diagnostic_lab', 'Diagnostic & Pathology Lab', 'Stethoscope', '#0D9488', 20)
      ON CONFLICT (entity_type, slug) DO NOTHING;
    END IF;

    -- Depth-2 under Printing & Xerox
    SELECT id INTO v_sub_id FROM public.categories WHERE entity_type = 'listing' AND slug = 'printing_xerox' LIMIT 1;
    IF v_sub_id IS NOT NULL THEN
      INSERT INTO public.categories (entity_type, parent_id, slug, display_name, icon, color_hex, sort_order)
      VALUES
        ('listing', v_sub_id, 'flex_banner_printing', 'Flex & Banner Printing', 'Image', '#4F46E5', 10),
        ('listing', v_sub_id, 'offset_book_binding', 'Offset & Book Binding', 'BookOpen', '#6366F1', 20)
      ON CONFLICT (entity_type, slug) DO NOTHING;
    END IF;
  END IF;

  SELECT id INTO v_parent_id FROM public.categories WHERE entity_type = 'listing' AND slug = 'services' LIMIT 1;
  IF v_parent_id IS NOT NULL THEN
    INSERT INTO public.categories (entity_type, parent_id, slug, display_name, icon, color_hex, sort_order)
    VALUES
      ('listing', v_parent_id, 'electrician_plumbing', 'Electrician & Plumbing', 'Zap', '#0D9488', 10),
      ('listing', v_parent_id, 'tuition_coaching', 'Tuition & Coaching', 'GraduationCap', '#2563EB', 20),
      ('listing', v_parent_id, 'auto_workshop', 'Auto Workshop', 'Wrench', '#475569', 30),
      ('listing', v_parent_id, 'salon_tailoring', 'Salon & Tailoring', 'Scissors', '#DB2777', 40)
    ON CONFLICT (entity_type, slug) DO NOTHING;

    SELECT id INTO v_sub_id FROM public.categories WHERE entity_type = 'listing' AND slug = 'auto_workshop' LIMIT 1;
    IF v_sub_id IS NOT NULL THEN
      INSERT INTO public.categories (entity_type, parent_id, slug, display_name, icon, color_hex, sort_order)
      VALUES
        ('listing', v_sub_id, 'two_wheeler_repair', 'Two-Wheeler Repair', 'Bike', '#475569', 10),
        ('listing', v_sub_id, 'car_4wd_mechanic', 'Car & 4WD Mechanic', 'Car', '#334155', 20)
      ON CONFLICT (entity_type, slug) DO NOTHING;
    END IF;
  END IF;

  SELECT id INTO v_parent_id FROM public.categories WHERE entity_type = 'listing' AND slug = 'real_estate' LIMIT 1;
  IF v_parent_id IS NOT NULL THEN
    INSERT INTO public.categories (entity_type, parent_id, slug, display_name, icon, color_hex, sort_order)
    VALUES
      ('listing', v_parent_id, 'land_plots', 'Land & Plots', 'Map', '#D97706', 10),
      ('listing', v_parent_id, 'house_flat_rentals', 'House & Flat Rentals', 'Home', '#EA580C', 20),
      ('listing', v_parent_id, 'commercial_space', 'Commercial Space', 'Building2', '#B45309', 30)
    ON CONFLICT (entity_type, slug) DO NOTHING;
  END IF;

  SELECT id INTO v_parent_id FROM public.categories WHERE entity_type = 'listing' AND slug = 'public_community' LIMIT 1;
  IF v_parent_id IS NOT NULL THEN
    INSERT INTO public.categories (entity_type, parent_id, slug, display_name, icon, color_hex, sort_order)
    VALUES
      ('listing', v_parent_id, 'schools_colleges', 'Schools & Colleges', 'GraduationCap', '#7C3AED', 10),
      ('listing', v_parent_id, 'churches_halls', 'Churches & Halls', 'Landmark', '#6D28D9', 20),
      ('listing', v_parent_id, 'hospitals_clinics', 'Hospitals & Clinics', 'Hospital', '#DC2626', 30),
      ('listing', v_parent_id, 'govt_offices', 'Government Offices', 'Building', '#4F46E5', 40)
    ON CONFLICT (entity_type, slug) DO NOTHING;
  END IF;

  -- ---------------------------------------------------------------------------
  -- PRODUCT SUBCATEGORIES
  -- ---------------------------------------------------------------------------
  SELECT id INTO v_parent_id FROM public.categories WHERE entity_type = 'product' AND slug = 'electronics' LIMIT 1;
  IF v_parent_id IS NOT NULL THEN
    INSERT INTO public.categories (entity_type, parent_id, slug, display_name, icon, color_hex, sort_order)
    VALUES
      ('product', v_parent_id, 'smartphones_gadgets', 'Smartphones & Gadgets', 'Smartphone', '#0284C7', 10),
      ('product', v_parent_id, 'solar_inverters', 'Solar & Inverters', 'Sun', '#D97706', 20)
    ON CONFLICT (entity_type, slug) DO NOTHING;
  END IF;

  SELECT id INTO v_parent_id FROM public.categories WHERE entity_type = 'product' AND slug = 'fashion_traditional_wear' LIMIT 1;
  IF v_parent_id IS NOT NULL THEN
    INSERT INTO public.categories (entity_type, parent_id, slug, display_name, icon, color_hex, sort_order)
    VALUES
      ('product', v_parent_id, 'puandum_handloom', 'Puandum & Handloom', 'Sparkles', '#DB2777', 10),
      ('product', v_parent_id, 'footwear', 'Footwear', 'Footprints', '#9333EA', 20)
    ON CONFLICT (entity_type, slug) DO NOTHING;

    SELECT id INTO v_sub_id FROM public.categories WHERE entity_type = 'product' AND slug = 'puandum_handloom' LIMIT 1;
    IF v_sub_id IS NOT NULL THEN
      INSERT INTO public.categories (entity_type, parent_id, slug, display_name, icon, color_hex, sort_order)
      VALUES
        ('product', v_sub_id, 'handwoven_shawls', 'Handwoven Shawls & Puan', 'Sparkles', '#BE185D', 10)
      ON CONFLICT (entity_type, slug) DO NOTHING;
    END IF;
  END IF;

  SELECT id INTO v_parent_id FROM public.categories WHERE entity_type = 'product' AND slug = 'home_kitchen' LIMIT 1;
  IF v_parent_id IS NOT NULL THEN
    INSERT INTO public.categories (entity_type, parent_id, slug, display_name, icon, color_hex, sort_order)
    VALUES
      ('product', v_parent_id, 'cookware_appliances', 'Cookware & Appliances', 'UtensilsCrossed', '#EA580C', 10),
      ('product', v_parent_id, 'home_decor', 'Home Decor', 'Lamp', '#D97706', 20)
    ON CONFLICT (entity_type, slug) DO NOTHING;
  END IF;

  SELECT id INTO v_parent_id FROM public.categories WHERE entity_type = 'product' AND slug = 'stationery_print' LIMIT 1;
  IF v_parent_id IS NOT NULL THEN
    INSERT INTO public.categories (entity_type, parent_id, slug, display_name, icon, color_hex, sort_order)
    VALUES
      ('product', v_parent_id, 'school_supplies', 'School & Office Supplies', 'BookOpen', '#4F46E5', 10),
      ('product', v_parent_id, 'custom_prints', 'Custom Prints & Banners', 'Printer', '#2563EB', 20)
    ON CONFLICT (entity_type, slug) DO NOTHING;
  END IF;

  SELECT id INTO v_parent_id FROM public.categories WHERE entity_type = 'product' AND slug = 'local_produce' LIMIT 1;
  IF v_parent_id IS NOT NULL THEN
    INSERT INTO public.categories (entity_type, parent_id, slug, display_name, icon, color_hex, sort_order)
    VALUES
      ('product', v_parent_id, 'organic_spices_honey', 'Organic Spices & Honey', 'Sprout', '#16A34A', 10),
      ('product', v_parent_id, 'fresh_farm_goods', 'Fresh Farm Goods', 'ShoppingBasket', '#15803D', 20)
    ON CONFLICT (entity_type, slug) DO NOTHING;
  END IF;

  -- ---------------------------------------------------------------------------
  -- BULLETIN SUBCATEGORIES
  -- ---------------------------------------------------------------------------
  SELECT id INTO v_parent_id FROM public.categories WHERE entity_type = 'bulletin' AND slug = 'job' LIMIT 1;
  IF v_parent_id IS NOT NULL THEN
    INSERT INTO public.categories (entity_type, parent_id, slug, display_name, icon, color_hex, sort_order)
    VALUES
      ('bulletin', v_parent_id, 'job_full_time', 'Full-Time', 'Briefcase', '#059669', 10),
      ('bulletin', v_parent_id, 'job_part_time', 'Part-Time', 'Clock', '#0D9488', 20),
      ('bulletin', v_parent_id, 'job_govt_contractual', 'Govt / Contractual', 'Landmark', '#2563EB', 30)
    ON CONFLICT (entity_type, slug) DO NOTHING;
  END IF;

  SELECT id INTO v_parent_id FROM public.categories WHERE entity_type = 'bulletin' AND slug = 'event' LIMIT 1;
  IF v_parent_id IS NOT NULL THEN
    INSERT INTO public.categories (entity_type, parent_id, slug, display_name, icon, color_hex, sort_order)
    VALUES
      ('bulletin', v_parent_id, 'community_festivals', 'Community & Festivals', 'Calendar', '#7C3AED', 10),
      ('bulletin', v_parent_id, 'workshops_sports', 'Workshops & Sports', 'Trophy', '#9333EA', 20)
    ON CONFLICT (entity_type, slug) DO NOTHING;
  END IF;

  SELECT id INTO v_parent_id FROM public.categories WHERE entity_type = 'bulletin' AND slug = 'notice' LIMIT 1;
  IF v_parent_id IS NOT NULL THEN
    INSERT INTO public.categories (entity_type, parent_id, slug, display_name, icon, color_hex, sort_order)
    VALUES
      ('bulletin', v_parent_id, 'public_advisory', 'Public Advisory', 'Bell', '#DC2626', 10),
      ('bulletin', v_parent_id, 'lost_and_found', 'Lost & Found', 'Search', '#EA580C', 20)
    ON CONFLICT (entity_type, slug) DO NOTHING;
  END IF;

  -- ---------------------------------------------------------------------------
  -- VEHICLE SUBCATEGORIES
  -- ---------------------------------------------------------------------------
  SELECT id INTO v_parent_id FROM public.categories WHERE entity_type = 'vehicle' AND slug = 'city_taxi_auto' LIMIT 1;
  IF v_parent_id IS NOT NULL THEN
    INSERT INTO public.categories (entity_type, parent_id, slug, display_name, icon, color_hex, sort_order)
    VALUES
      ('vehicle', v_parent_id, 'e_rickshaw_auto', 'E-Rickshaw & Auto', 'CarTaxiFront', '#059669', 10),
      ('vehicle', v_parent_id, 'local_cab_hatchback', 'Local Cab & Hatchback', 'Car', '#0D9488', 20)
    ON CONFLICT (entity_type, slug) DO NOTHING;
  END IF;

  SELECT id INTO v_parent_id FROM public.categories WHERE entity_type = 'vehicle' AND slug = 'four_wd_hill_charter' LIMIT 1;
  IF v_parent_id IS NOT NULL THEN
    INSERT INTO public.categories (entity_type, parent_id, slug, display_name, icon, color_hex, sort_order)
    VALUES
      ('vehicle', v_parent_id, 'bolero_scorpio_charter', 'Bolero / Scorpio Charter', 'Mountain', '#D97706', 10),
      ('vehicle', v_parent_id, 'gypsy_offroad', 'Off-Road & Village Charter', 'Compass', '#B45309', 20)
    ON CONFLICT (entity_type, slug) DO NOTHING;
  END IF;

  SELECT id INTO v_parent_id FROM public.categories WHERE entity_type = 'vehicle' AND slug = 'inter_hub_winger_sumo' LIMIT 1;
  IF v_parent_id IS NOT NULL THEN
    INSERT INTO public.categories (entity_type, parent_id, slug, display_name, icon, color_hex, sort_order)
    VALUES
      ('vehicle', v_parent_id, 'shared_per_seat', 'Shared Per-Seat Counter', 'Users', '#2563EB', 10),
      ('vehicle', v_parent_id, 'full_winger_charter', 'Full Winger / Tempo Charter', 'Bus', '#1D4ED8', 20)
    ON CONFLICT (entity_type, slug) DO NOTHING;
  END IF;

  SELECT id INTO v_parent_id FROM public.categories WHERE entity_type = 'vehicle' AND slug = 'goods_pickup_truck' LIMIT 1;
  IF v_parent_id IS NOT NULL THEN
    INSERT INTO public.categories (entity_type, parent_id, slug, display_name, icon, color_hex, sort_order)
    VALUES
      ('vehicle', v_parent_id, 'bolero_pickup_goods', 'Bolero Pickup & Mini Truck', 'Truck', '#475569', 10),
      ('vehicle', v_parent_id, 'heavy_cargo_carrier', 'Heavy Cargo Carrier', 'Package', '#334155', 20)
    ON CONFLICT (entity_type, slug) DO NOTHING;
  END IF;
END;
$$;

-- 3c. Migrate `app_localities` into `hub_localities` (Churachandpur) & Seed 8 Aizawl Localities
DO $$
DECLARE
  v_ccpur_id uuid;
  v_aizawl_id uuid;
BEGIN
  SELECT id INTO v_ccpur_id FROM public.service_hubs WHERE slug = 'churachandpur' LIMIT 1;
  SELECT id INTO v_aizawl_id FROM public.service_hubs WHERE slug = 'aizawl' LIMIT 1;

  IF v_ccpur_id IS NOT NULL AND to_regclass('public.app_localities') IS NOT NULL THEN
    INSERT INTO public.hub_localities (
      hub_id,
      slug,
      display_name,
      aliases,
      lat,
      lng,
      source,
      status
    )
    SELECT
      v_ccpur_id,
      al.slug,
      al.display_name,
      CASE al.slug
        WHEN 'central_lamka' THEN ARRAY['Lamka', 'CCPur Town', 'Bazar']
        WHEN 'new_lamka' THEN ARRAY['New Lamka Dorcas', 'Hebron']
        WHEN 'tuibong' THEN ARRAY['Tuibuong', 'Tuibong Bazar']
        WHEN 'rengkai' THEN ARRAY['Rengkai Road', 'Muolvaiphei']
        ELSE ARRAY[]::text[]
      END,
      al.lat,
      al.lng,
      'admin',
      'verified'
    FROM public.app_localities al
    ON CONFLICT (hub_id, slug) DO NOTHING;
  END IF;

  -- Seed 8 verified Aizawl localities with realistic coordinates & local aliases
  IF v_aizawl_id IS NOT NULL THEN
    INSERT INTO public.hub_localities (hub_id, slug, display_name, aliases, lat, lng, source, status)
    VALUES
      (v_aizawl_id, 'zarkawt', 'Zarkawt', ARRAY['Zarkawt Main Road', 'Millennium Centre'], 23.7327, 92.7176, 'admin', 'verified'),
      (v_aizawl_id, 'dawrpui', 'Dawrpui', ARRAY['Dawrpui Bazar', 'Bara Bazar'], 23.7294, 92.7192, 'admin', 'verified'),
      (v_aizawl_id, 'chanmari', 'Chanmari', ARRAY['Chanmari Junction', 'Chanmari West'], 23.7404, 92.7190, 'admin', 'verified'),
      (v_aizawl_id, 'khatla', 'Khatla', ARRAY['Khatla South', 'New Secretariat Road'], 23.7235, 92.7118, 'admin', 'verified'),
      (v_aizawl_id, 'bawngkawn', 'Bawngkawn', ARRAY['Bawngkawn Brigade', 'Bawngkawn Chhimveng'], 23.7518, 92.7248, 'admin', 'verified'),
      (v_aizawl_id, 'mission_veng', 'Mission Veng', ARRAY['Mission Vengthlang', 'Synod'], 23.7196, 92.7173, 'admin', 'verified'),
      (v_aizawl_id, 'kulikawn', 'Kulikawn', ARRAY['Kulikawn West', 'Tlangnuam Road'], 23.7131, 92.7186, 'admin', 'verified'),
      (v_aizawl_id, 'chaltlang', 'Chaltlang', ARRAY['Chaltlang Lily Veng', 'Chaltlang North'], 23.7458, 92.7219, 'admin', 'verified')
    ON CONFLICT (hub_id, slug) DO NOTHING;
  END IF;
END;
$$;

-- =============================================================================
-- 4. Interlink Existing Tables + Safe Non-Destructive Backfill
-- =============================================================================

-- 4a. Add nullable FK columns & custom_tags arrays with indexes
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS default_locality_id uuid REFERENCES public.hub_localities(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_profiles_default_locality_id
  ON public.profiles (default_locality_id);

ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS locality_id uuid REFERENCES public.hub_localities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS custom_tags text[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_listings_locality_id
  ON public.listings (locality_id);
CREATE INDEX IF NOT EXISTS idx_listings_category_id
  ON public.listings (category_id);
CREATE INDEX IF NOT EXISTS idx_listings_custom_tags_gin
  ON public.listings USING GIN (custom_tags);

ALTER TABLE public.marketplace_products
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS custom_tags text[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_marketplace_products_category_id
  ON public.marketplace_products (category_id);
CREATE INDEX IF NOT EXISTS idx_marketplace_products_custom_tags_gin
  ON public.marketplace_products USING GIN (custom_tags);

ALTER TABLE public.bulletins
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS custom_tags text[] NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS idx_bulletins_category_id
  ON public.bulletins (category_id);
CREATE INDEX IF NOT EXISTS idx_bulletins_custom_tags_gin
  ON public.bulletins USING GIN (custom_tags);

ALTER TABLE public.vehicle_listings
  ADD COLUMN IF NOT EXISTS locality_id uuid REFERENCES public.hub_localities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_vehicle_listings_locality_id
  ON public.vehicle_listings (locality_id);
CREATE INDEX IF NOT EXISTS idx_vehicle_listings_category_id
  ON public.vehicle_listings (category_id);

ALTER TABLE public.user_interests
  ADD COLUMN IF NOT EXISTS locality_id uuid REFERENCES public.hub_localities(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_user_interests_locality_id
  ON public.user_interests (locality_id);
CREATE INDEX IF NOT EXISTS idx_user_interests_category_id
  ON public.user_interests (category_id);

-- 4b. Safe Non-Destructive Backfill (matches legacy text strings to hub_localities & categories)
DO $$
DECLARE
  v_ccpur_id uuid;
BEGIN
  SELECT id INTO v_ccpur_id FROM public.service_hubs WHERE slug = 'churachandpur' LIMIT 1;

  -- Backfill listings.locality_id
  UPDATE public.listings l
  SET locality_id = hl.id
  FROM public.hub_localities hl
  WHERE l.locality_id IS NULL
    AND l.locality IS NOT NULL
    AND trim(l.locality) <> ''
    AND hl.hub_id = COALESCE(l.hub_id, v_ccpur_id)
    AND hl.status <> 'merged'
    AND (
      lower(trim(hl.display_name)) = lower(trim(l.locality))
      OR lower(hl.slug) = lower(trim(regexp_replace(l.locality, '[^a-zA-Z0-9]+', '_', 'g')))
      OR EXISTS (
        SELECT 1 FROM unnest(hl.aliases) a
        WHERE lower(trim(a)) = lower(trim(l.locality))
      )
    );

  -- Backfill listings.category_id (first check subcategory, then exact slug/display_name, then legacy aliases)
  UPDATE public.listings l
  SET category_id = c.id
  FROM public.categories c
  WHERE l.category_id IS NULL
    AND c.entity_type = 'listing'
    AND l.subcategory IS NOT NULL
    AND trim(l.subcategory) <> ''
    AND (
      lower(c.slug) = lower(trim(regexp_replace(l.subcategory, '[^a-zA-Z0-9]+', '_', 'g')))
      OR lower(trim(c.display_name)) = lower(trim(l.subcategory))
    );

  UPDATE public.listings l
  SET category_id = c.id
  FROM public.categories c
  WHERE l.category_id IS NULL
    AND c.entity_type = 'listing'
    AND l.category IS NOT NULL
    AND trim(l.category) <> ''
    AND (
      lower(c.slug) = lower(trim(regexp_replace(l.category, '[^a-zA-Z0-9]+', '_', 'g')))
      OR lower(trim(c.display_name)) = lower(trim(l.category))
      OR (lower(trim(l.category)) IN ('business', 'businesses', 'shop', 'shops') AND c.slug = 'businesses_shops')
      OR (lower(trim(l.category)) IN ('service', 'services') AND c.slug = 'services')
      OR (lower(trim(l.category)) IN ('real_estate', 'real estate', 'property') AND c.slug = 'real_estate')
      OR (lower(trim(l.category)) IN ('public_interest', 'public', 'community', 'public_community') AND c.slug = 'public_community')
      OR (lower(trim(l.category)) IN ('retail', 'shopping', 'retail_shopping') AND c.slug = 'retail_shopping')
      OR (lower(trim(l.category)) IN ('print', 'printing', 'print_digital') AND c.slug = 'print_digital')
      OR (lower(trim(l.category)) IN ('vehicle', 'vehicles', 'vehicles_rentals', 'transport') AND c.slug = 'vehicles_rentals')
    );

  -- Backfill marketplace_products.category_id
  UPDATE public.marketplace_products mp
  SET category_id = c.id
  FROM public.categories c
  WHERE mp.category_id IS NULL
    AND c.entity_type = 'product'
    AND mp.category IS NOT NULL
    AND trim(mp.category) <> ''
    AND (
      lower(c.slug) = lower(trim(regexp_replace(mp.category, '[^a-zA-Z0-9]+', '_', 'g')))
      OR lower(c.slug) = 'mkt_' || lower(trim(regexp_replace(mp.category, '[^a-zA-Z0-9]+', '_', 'g')))
      OR lower(trim(c.display_name)) = lower(trim(mp.category))
    );

  -- Backfill bulletins.category_id
  UPDATE public.bulletins b
  SET category_id = c.id
  FROM public.categories c
  WHERE b.category_id IS NULL
    AND c.entity_type = 'bulletin'
    AND b.category IS NOT NULL
    AND trim(b.category) <> ''
    AND (
      lower(c.slug) = lower(trim(regexp_replace(b.category, '[^a-zA-Z0-9]+', '_', 'g')))
      OR lower(trim(c.display_name)) = lower(trim(b.category))
    );

  -- Backfill vehicle_listings.locality_id from stand_locality
  UPDATE public.vehicle_listings vl
  SET locality_id = hl.id
  FROM public.hub_localities hl
  WHERE vl.locality_id IS NULL
    AND vl.stand_locality IS NOT NULL
    AND trim(vl.stand_locality) <> ''
    AND hl.hub_id = COALESCE(vl.origin_hub_id, v_ccpur_id)
    AND hl.status <> 'merged'
    AND (
      lower(trim(hl.display_name)) = lower(trim(vl.stand_locality))
      OR lower(hl.slug) = lower(trim(regexp_replace(vl.stand_locality, '[^a-zA-Z0-9]+', '_', 'g')))
      OR EXISTS (
        SELECT 1 FROM unnest(hl.aliases) a
        WHERE lower(trim(a)) = lower(trim(vl.stand_locality))
      )
    );

  -- Backfill vehicle_listings.category_id based on vehicle_types.slug / booking_mode
  UPDATE public.vehicle_listings vl
  SET category_id = c.id
  FROM public.vehicle_types vt, public.categories c
  WHERE vl.category_id IS NULL
    AND vl.vehicle_type_id = vt.id
    AND c.entity_type = 'vehicle'
    AND c.slug = CASE
      WHEN vt.slug IN ('pickup_truck', 'goods_truck') THEN 'goods_pickup_truck'
      WHEN vl.booking_mode = 'per_seat' THEN 'inter_hub_winger_sumo'
      WHEN vt.slug IN ('two_wheeler', 'cycle_rickshaw', 'e_rickshaw', 'auto', 'mini_van') THEN 'city_taxi_auto'
      ELSE 'four_wd_hill_charter'
    END;

  -- Backfill user_interests.locality_id & category_id
  UPDATE public.user_interests ui
  SET locality_id = hl.id
  FROM public.hub_localities hl
  WHERE ui.locality_id IS NULL
    AND ui.interest_type = 'locality'
    AND hl.hub_id = COALESCE(ui.hub_id, v_ccpur_id)
    AND hl.status <> 'merged'
    AND (
      lower(trim(hl.display_name)) = lower(trim(ui.interest_value))
      OR lower(hl.slug) = lower(trim(regexp_replace(ui.interest_value, '[^a-zA-Z0-9]+', '_', 'g')))
    );

  UPDATE public.user_interests ui
  SET category_id = c.id
  FROM public.categories c
  WHERE ui.category_id IS NULL
    AND ui.interest_type IN ('category', 'bulletin_tag')
    AND (
      lower(c.slug) = lower(trim(regexp_replace(ui.interest_value, '[^a-zA-Z0-9]+', '_', 'g')))
      OR lower(trim(c.display_name)) = lower(trim(ui.interest_value))
    );

  -- Sync initial usage_count on hub_localities from backfilled entities
  UPDATE public.hub_localities hl
  SET usage_count = GREATEST(
    hl.usage_count,
    (SELECT count(*)::integer FROM public.listings l WHERE l.locality_id = hl.id)
    + (SELECT count(*)::integer FROM public.vehicle_listings vl WHERE vl.locality_id = hl.id)
  )
  WHERE hl.status <> 'merged';
END;
$$;

-- =============================================================================
-- 5. Atomic SECURITY DEFINER RPCs
-- =============================================================================

-- 5a. get_category_subtree_ids(p_category_id uuid) -> uuid[]
CREATE OR REPLACE FUNCTION public.get_category_subtree_ids(p_category_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  WITH RECURSIVE subtree AS (
    SELECT c.id
    FROM public.categories c
    WHERE c.id = p_category_id
      AND c.is_active = true
    UNION ALL
    SELECT child.id
    FROM public.categories child
    INNER JOIN subtree s ON child.parent_id = s.id
    WHERE child.is_active = true
  )
  SELECT COALESCE(array_agg(id), ARRAY[]::uuid[])
  FROM subtree;
$$;

GRANT EXECUTE ON FUNCTION public.get_category_subtree_ids(uuid) TO anon, authenticated;

-- 5b. search_hub_localities(p_hub_id uuid, p_query text, p_limit integer default 10)
CREATE OR REPLACE FUNCTION public.search_hub_localities(
  p_hub_id uuid,
  p_query text DEFAULT '',
  p_limit integer DEFAULT 10
)
RETURNS TABLE (
  id uuid,
  hub_id uuid,
  slug text,
  display_name text,
  aliases text[],
  lat double precision,
  lng double precision,
  source text,
  status text,
  usage_count integer,
  match_score real
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_query text := trim(regexp_replace(COALESCE(p_query, ''), '\s+', ' ', 'g'));
  v_limit integer := GREATEST(1, LEAST(COALESCE(p_limit, 10), 50));
  v_is_manager boolean := false;
BEGIN
  IF p_hub_id IS NULL THEN
    RETURN;
  END IF;

  IF auth.uid() IS NOT NULL THEN
    v_is_manager := public.is_hub_manager_for(p_hub_id);
  END IF;

  IF v_query = '' THEN
    RETURN QUERY
    SELECT
      hl.id,
      hl.hub_id,
      hl.slug,
      hl.display_name,
      hl.aliases,
      hl.lat,
      hl.lng,
      hl.source,
      hl.status,
      hl.usage_count,
      1.0::real AS match_score
    FROM public.hub_localities hl
    WHERE hl.hub_id = p_hub_id
      AND hl.status <> 'merged'
      AND (
        hl.status = 'verified'
        OR v_is_manager
        OR (hl.status = 'pending' AND hl.submitted_by = auth.uid())
      )
    ORDER BY
      (hl.status = 'verified') DESC,
      hl.usage_count DESC,
      hl.display_name ASC
    LIMIT v_limit;
    RETURN;
  END IF;

  RETURN QUERY
  WITH scored AS (
    SELECT
      hl.id,
      hl.hub_id,
      hl.slug,
      hl.display_name,
      hl.aliases,
      hl.lat,
      hl.lng,
      hl.source,
      hl.status,
      hl.usage_count,
      GREATEST(
        similarity(lower(hl.display_name), lower(v_query)),
        COALESCE(
          (
            SELECT MAX(similarity(lower(a), lower(v_query)))
            FROM unnest(hl.aliases) a
          ),
          0::real
        ),
        CASE WHEN lower(hl.display_name) = lower(v_query) THEN 1.0::real ELSE 0::real END,
        CASE WHEN lower(hl.display_name) LIKE lower(v_query) || '%' THEN 0.85::real ELSE 0::real END
      )::real AS score,
      (
        hl.display_name ILIKE '%' || v_query || '%'
        OR hl.display_name % v_query
        OR EXISTS (
          SELECT 1
          FROM unnest(hl.aliases) a
          WHERE a ILIKE '%' || v_query || '%'
             OR a % v_query
        )
      ) AS is_match
    FROM public.hub_localities hl
    WHERE hl.hub_id = p_hub_id
      AND hl.status <> 'merged'
      AND (
        hl.status = 'verified'
        OR v_is_manager
        OR (hl.status = 'pending' AND hl.submitted_by = auth.uid())
      )
  )
  SELECT
    s.id,
    s.hub_id,
    s.slug,
    s.display_name,
    s.aliases,
    s.lat,
    s.lng,
    s.source,
    s.status,
    s.usage_count,
    s.score AS match_score
  FROM scored s
  WHERE s.is_match
  ORDER BY
    (s.status = 'verified') DESC,
    s.score DESC,
    s.usage_count DESC,
    s.display_name ASC
  LIMIT v_limit;
END;
$$;

GRANT EXECUTE ON FUNCTION public.search_hub_localities(uuid, text, integer) TO anon, authenticated;

-- 5c. submit_or_resolve_locality(...) -> public.hub_localities
CREATE OR REPLACE FUNCTION public.submit_or_resolve_locality(
  p_hub_id uuid,
  p_name text,
  p_lat double precision DEFAULT NULL,
  p_lng double precision DEFAULT NULL,
  p_source text DEFAULT 'user_submitted'
)
RETURNS public.hub_localities
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_clean_name text;
  v_source text;
  v_existing public.hub_localities;
  v_canonical public.hub_localities;
  v_base_slug text;
  v_candidate_slug text;
  v_suffix integer := 0;
  v_hops integer := 0;
  v_created public.hub_localities;
BEGIN
  IF auth.uid() IS NULL AND current_setting('role', true) <> 'service_role' THEN
    RAISE EXCEPTION 'Authentication required to submit or resolve a locality.'
      USING ERRCODE = '42501';
  END IF;

  IF p_hub_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.service_hubs WHERE id = p_hub_id) THEN
    RAISE EXCEPTION 'Valid hub_id is required.' USING ERRCODE = '22023';
  END IF;

  v_clean_name := trim(regexp_replace(COALESCE(p_name, ''), '\s+', ' ', 'g'));
  IF length(v_clean_name) < 2 OR length(v_clean_name) > 80 THEN
    RAISE EXCEPTION 'Locality name must be between 2 and 80 characters.'
      USING ERRCODE = '22023';
  END IF;

  v_source := CASE
    WHEN lower(trim(COALESCE(p_source, ''))) IN ('admin', 'user_submitted', 'google_reference')
      THEN lower(trim(p_source))
    ELSE 'user_submitted'
  END;

  -- 1. Check for exact case-insensitive match on display_name or any alias in this hub
  SELECT hl.*
    INTO v_existing
  FROM public.hub_localities hl
  WHERE hl.hub_id = p_hub_id
    AND (
      lower(trim(hl.display_name)) = lower(v_clean_name)
      OR EXISTS (
        SELECT 1
        FROM unnest(hl.aliases) a
        WHERE lower(trim(a)) = lower(v_clean_name)
      )
    )
  ORDER BY
    CASE hl.status
      WHEN 'verified' THEN 1
      WHEN 'pending' THEN 2
      ELSE 3
    END,
    hl.usage_count DESC
  LIMIT 1;

  IF FOUND THEN
    v_canonical := v_existing;

    -- Follow merged_into_id chain if matched row was merged
    WHILE v_canonical.status = 'merged' AND v_canonical.merged_into_id IS NOT NULL AND v_hops < 5 LOOP
      SELECT hl.*
        INTO v_canonical
      FROM public.hub_localities hl
      WHERE hl.id = v_canonical.merged_into_id;
      v_hops := v_hops + 1;
      EXIT WHEN NOT FOUND;
    END LOOP;

    UPDATE public.hub_localities
    SET
      usage_count = usage_count + 1,
      lat = COALESCE(lat, p_lat),
      lng = COALESCE(lng, p_lng)
    WHERE id = v_canonical.id
    RETURNING * INTO v_canonical;

    RETURN v_canonical;
  END IF;

  -- 2. Not found: generate clean unique slug within p_hub_id and insert as pending
  v_base_slug := trim(both '_' FROM regexp_replace(lower(v_clean_name), '[^a-z0-9]+', '_', 'g'));
  IF v_base_slug = '' THEN
    v_base_slug := 'locality';
  END IF;

  v_candidate_slug := v_base_slug;
  WHILE EXISTS (
    SELECT 1
    FROM public.hub_localities
    WHERE hub_id = p_hub_id
      AND slug = v_candidate_slug
  ) LOOP
    v_suffix := v_suffix + 1;
    v_candidate_slug := v_base_slug || '_' || v_suffix::text;
  END LOOP;

  INSERT INTO public.hub_localities (
    hub_id,
    slug,
    display_name,
    aliases,
    lat,
    lng,
    source,
    status,
    usage_count,
    submitted_by
  )
  VALUES (
    p_hub_id,
    v_candidate_slug,
    v_clean_name,
    ARRAY[]::text[],
    p_lat,
    p_lng,
    v_source,
    'pending',
    1,
    auth.uid()
  )
  RETURNING * INTO v_created;

  RETURN v_created;
END;
$$;

GRANT EXECUTE ON FUNCTION public.submit_or_resolve_locality(uuid, text, double precision, double precision, text) TO authenticated;

-- 5d. merge_locality_into_canonical(p_source_id uuid, p_target_id uuid)
CREATE OR REPLACE FUNCTION public.merge_locality_into_canonical(
  p_source_id uuid,
  p_target_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_source public.hub_localities;
  v_target public.hub_localities;
  v_listings_count integer := 0;
  v_vehicles_count integer := 0;
  v_profiles_count integer := 0;
  v_interests_count integer := 0;
  v_merged_aliases text[];
BEGIN
  IF p_source_id IS NULL OR p_target_id IS NULL THEN
    RAISE EXCEPTION 'Both p_source_id and p_target_id are required.' USING ERRCODE = '22023';
  END IF;

  IF p_source_id = p_target_id THEN
    RAISE EXCEPTION 'Cannot merge a locality into itself.' USING ERRCODE = '22023';
  END IF;

  -- Lock both rows in deterministic UUID order to prevent deadlocks
  PERFORM 1
  FROM public.hub_localities
  WHERE id IN (p_source_id, p_target_id)
  ORDER BY id
  FOR UPDATE;

  SELECT * INTO v_source FROM public.hub_localities WHERE id = p_source_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source locality not found.' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_target FROM public.hub_localities WHERE id = p_target_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target canonical locality not found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_source.hub_id <> v_target.hub_id THEN
    RAISE EXCEPTION 'Cannot merge localities belonging to different hubs.' USING ERRCODE = '22023';
  END IF;

  IF v_target.status = 'merged' THEN
    RAISE EXCEPTION 'Target locality is already merged into another canonical locality.' USING ERRCODE = '22023';
  END IF;

  IF current_setting('role', true) <> 'service_role'
     AND NOT public.is_hub_manager_for(v_source.hub_id) THEN
    RAISE EXCEPTION 'Only assigned Hub Managers or Super-Admin can merge localities in this hub.'
      USING ERRCODE = '42501';
  END IF;

  -- Reassign all referencing entities & preserve legacy text display compatibility
  UPDATE public.listings
  SET
    locality_id = p_target_id,
    locality = v_target.display_name
  WHERE locality_id = p_source_id;
  GET DIAGNOSTICS v_listings_count = ROW_COUNT;

  UPDATE public.vehicle_listings
  SET
    locality_id = p_target_id,
    stand_locality = v_target.display_name
  WHERE locality_id = p_source_id;
  GET DIAGNOSTICS v_vehicles_count = ROW_COUNT;

  UPDATE public.profiles
  SET default_locality_id = p_target_id
  WHERE default_locality_id = p_source_id;
  GET DIAGNOSTICS v_profiles_count = ROW_COUNT;

  UPDATE public.user_interests
  SET locality_id = p_target_id
  WHERE locality_id = p_source_id;
  GET DIAGNOSTICS v_interests_count = ROW_COUNT;

  -- Flatten any prior merges pointing to source so chains never lengthen
  UPDATE public.hub_localities
  SET merged_into_id = p_target_id
  WHERE merged_into_id = p_source_id;

  -- Deduplicate aliases case-insensitively (excluding target.display_name itself)
  SELECT COALESCE(array_agg(alias_val ORDER BY min_ord), ARRAY[]::text[])
    INTO v_merged_aliases
  FROM (
    SELECT
      (array_agg(raw_val ORDER BY ord))[1] AS alias_val,
      MIN(ord) AS min_ord
    FROM (
      SELECT trim(val) AS raw_val, ord
      FROM unnest(
        COALESCE(v_target.aliases, ARRAY[]::text[])
        || ARRAY[v_source.display_name]
        || COALESCE(v_source.aliases, ARRAY[]::text[])
      ) WITH ORDINALITY AS t(val, ord)
      WHERE val IS NOT NULL
        AND trim(val) <> ''
        AND lower(trim(val)) <> lower(trim(v_target.display_name))
    ) cleaned
    GROUP BY lower(raw_val)
  ) dedup;

  UPDATE public.hub_localities
  SET
    aliases = v_merged_aliases,
    usage_count = COALESCE(usage_count, 0) + COALESCE(v_source.usage_count, 0),
    lat = COALESCE(lat, v_source.lat),
    lng = COALESCE(lng, v_source.lng),
    status = 'verified'
  WHERE id = p_target_id
  RETURNING * INTO v_target;

  UPDATE public.hub_localities
  SET
    status = 'merged',
    merged_into_id = p_target_id
  WHERE id = p_source_id;

  RETURN jsonb_build_object(
    'success', true,
    'hub_id', v_target.hub_id,
    'source_id', p_source_id,
    'target_id', p_target_id,
    'target_display_name', v_target.display_name,
    'target_aliases', v_target.aliases,
    'target_usage_count', v_target.usage_count,
    'reassigned', jsonb_build_object(
      'listings', v_listings_count,
      'vehicle_listings', v_vehicles_count,
      'profiles', v_profiles_count,
      'user_interests', v_interests_count
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.merge_locality_into_canonical(uuid, uuid) TO authenticated;

-- 5e. promote_category_suggestion(...) -> jsonb (Strictly Super-Admin)
CREATE OR REPLACE FUNCTION public.promote_category_suggestion(
  p_suggestion_id uuid,
  p_display_name text,
  p_parent_id uuid,
  p_icon text DEFAULT 'Tag',
  p_color text DEFAULT '#2563EB'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_suggestion public.category_suggestions;
  v_clean_name text;
  v_base_slug text;
  v_candidate_slug text;
  v_suffix integer := 0;
  v_new_cat public.categories;
  v_relinked_count integer := 0;
  v_promoted_count integer := 0;
BEGIN
  IF current_setting('role', true) <> 'service_role'
     AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only Super-Admin can promote category suggestions into official categories.'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO v_suggestion
  FROM public.category_suggestions
  WHERE id = p_suggestion_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Category suggestion not found.' USING ERRCODE = 'P0002';
  END IF;

  v_clean_name := trim(regexp_replace(COALESCE(NULLIF(trim(p_display_name), ''), v_suggestion.suggested_name), '\s+', ' ', 'g'));
  IF length(v_clean_name) < 2 THEN
    RAISE EXCEPTION 'Category display name must be at least 2 characters.' USING ERRCODE = '22023';
  END IF;

  v_base_slug := trim(both '_' FROM regexp_replace(lower(v_clean_name), '[^a-z0-9]+', '_', 'g'));
  IF v_base_slug = '' THEN
    v_base_slug := 'category';
  END IF;

  v_candidate_slug := v_base_slug;
  WHILE EXISTS (
    SELECT 1
    FROM public.categories
    WHERE entity_type = v_suggestion.entity_type
      AND slug = v_candidate_slug
  ) LOOP
    v_suffix := v_suffix + 1;
    v_candidate_slug := v_base_slug || '_' || v_suffix::text;
  END LOOP;

  -- Insert new official category (trigger enforce_category_depth validates parent, entity_type & depth <= 2)
  INSERT INTO public.categories (
    entity_type,
    parent_id,
    slug,
    display_name,
    icon,
    color_hex,
    sort_order,
    is_active
  )
  VALUES (
    v_suggestion.entity_type,
    p_parent_id,
    v_candidate_slug,
    v_clean_name,
    COALESCE(NULLIF(trim(p_icon), ''), 'Tag'),
    COALESCE(NULLIF(trim(p_color), ''), '#2563EB'),
    50,
    true
  )
  RETURNING * INTO v_new_cat;

  -- Re-link existing entities whose custom_tags contain suggestion's normalized_name or match linked_entity_id
  IF v_suggestion.entity_type = 'listing' THEN
    UPDATE public.listings
    SET category_id = v_new_cat.id
    WHERE id = v_suggestion.linked_entity_id
       OR EXISTS (
         SELECT 1
         FROM unnest(custom_tags) t
         WHERE lower(trim(t)) = v_suggestion.normalized_name
       );
    GET DIAGNOSTICS v_relinked_count = ROW_COUNT;

  ELSIF v_suggestion.entity_type = 'product' THEN
    UPDATE public.marketplace_products
    SET category_id = v_new_cat.id
    WHERE id = v_suggestion.linked_entity_id
       OR EXISTS (
         SELECT 1
         FROM unnest(custom_tags) t
         WHERE lower(trim(t)) = v_suggestion.normalized_name
       );
    GET DIAGNOSTICS v_relinked_count = ROW_COUNT;

  ELSIF v_suggestion.entity_type = 'bulletin' THEN
    UPDATE public.bulletins
    SET category_id = v_new_cat.id
    WHERE id = v_suggestion.linked_entity_id
       OR EXISTS (
         SELECT 1
         FROM unnest(custom_tags) t
         WHERE lower(trim(t)) = v_suggestion.normalized_name
       );
    GET DIAGNOSTICS v_relinked_count = ROW_COUNT;

  ELSIF v_suggestion.entity_type = 'vehicle' THEN
    UPDATE public.vehicle_listings
    SET category_id = v_new_cat.id
    WHERE id = v_suggestion.linked_entity_id;
    GET DIAGNOSTICS v_relinked_count = ROW_COUNT;
  END IF;

  -- Mark all matching pending suggestions as promoted
  UPDATE public.category_suggestions
  SET
    status = 'promoted',
    promoted_category_id = v_new_cat.id
  WHERE entity_type = v_suggestion.entity_type
    AND normalized_name = v_suggestion.normalized_name
    AND status = 'pending';
  GET DIAGNOSTICS v_promoted_count = ROW_COUNT;

  -- Ensure the target suggestion row itself is marked promoted even if status differed
  UPDATE public.category_suggestions
  SET
    status = 'promoted',
    promoted_category_id = v_new_cat.id
  WHERE id = p_suggestion_id
    AND status <> 'promoted';

  RETURN jsonb_build_object(
    'success', true,
    'category_id', v_new_cat.id,
    'entity_type', v_new_cat.entity_type,
    'parent_id', v_new_cat.parent_id,
    'depth', v_new_cat.depth,
    'slug', v_new_cat.slug,
    'display_name', v_new_cat.display_name,
    'promoted_suggestions_count', GREATEST(v_promoted_count, 1),
    'relinked_entities_count', v_relinked_count
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.promote_category_suggestion(uuid, text, uuid, text, text) TO authenticated;

-- =============================================================================
-- 6. Strict Row-Level Security (RLS) Policies
-- =============================================================================

-- 6a. public.categories
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read access to categories" ON public.categories;
DROP POLICY IF EXISTS "Public can read active categories" ON public.categories;
CREATE POLICY "Public can read active categories"
  ON public.categories
  FOR SELECT
  USING (is_active = true);

DROP POLICY IF EXISTS "Super admin manages all categories" ON public.categories;
CREATE POLICY "Super admin manages all categories"
  ON public.categories
  FOR ALL
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- 6b. public.category_suggestions
ALTER TABLE public.category_suggestions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can submit own category suggestions" ON public.category_suggestions;
CREATE POLICY "Users can submit own category suggestions"
  ON public.category_suggestions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = submitted_by
    AND status = 'pending'
    AND promoted_category_id IS NULL
  );

DROP POLICY IF EXISTS "Users read own suggestions and hub managers read hub suggestions" ON public.category_suggestions;
CREATE POLICY "Users read own suggestions and hub managers read hub suggestions"
  ON public.category_suggestions
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = submitted_by
    OR public.is_super_admin()
    OR (hub_id IS NOT NULL AND public.is_hub_manager_for(hub_id))
  );

DROP POLICY IF EXISTS "Super admin manages all category suggestions" ON public.category_suggestions;
CREATE POLICY "Super admin manages all category suggestions"
  ON public.category_suggestions
  FOR ALL
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- 6c. public.hub_localities
ALTER TABLE public.hub_localities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read verified hub localities" ON public.hub_localities;
CREATE POLICY "Public can read verified hub localities"
  ON public.hub_localities
  FOR SELECT
  USING (status = 'verified');

DROP POLICY IF EXISTS "Users can read own pending locality submissions" ON public.hub_localities;
CREATE POLICY "Users can read own pending locality submissions"
  ON public.hub_localities
  FOR SELECT
  TO authenticated
  USING (
    status = 'pending'
    AND submitted_by = auth.uid()
  );

DROP POLICY IF EXISTS "Hub managers and super admin view all hub localities" ON public.hub_localities;
CREATE POLICY "Hub managers and super admin view all hub localities"
  ON public.hub_localities
  FOR SELECT
  TO authenticated
  USING (public.is_hub_manager_for(hub_id));

DROP POLICY IF EXISTS "Hub managers and super admin insert hub localities" ON public.hub_localities;
CREATE POLICY "Hub managers and super admin insert hub localities"
  ON public.hub_localities
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_hub_manager_for(hub_id));

DROP POLICY IF EXISTS "Hub managers and super admin update hub localities" ON public.hub_localities;
CREATE POLICY "Hub managers and super admin update hub localities"
  ON public.hub_localities
  FOR UPDATE
  TO authenticated
  USING (public.is_hub_manager_for(hub_id))
  WITH CHECK (public.is_hub_manager_for(hub_id));

DROP POLICY IF EXISTS "Super admin deletes hub localities" ON public.hub_localities;
CREATE POLICY "Super admin deletes hub localities"
  ON public.hub_localities
  FOR DELETE
  TO authenticated
  USING (public.is_super_admin());
