-- =============================================================================
-- Migration: 20261125_pass_v16b_three_level_category_taxonomy.sql
-- Pass v16b: 3-Level Fixed-Root Category Taxonomy & Interconnected Inheritance
--   1. Upgrade `public.categories` to a strict 3-level materialized hierarchy:
--      - `root_key text NOT NULL`
--      - `depth smallint NOT NULL CHECK (depth BETWEEN 1 AND 3)`
--      - `path_ids uuid[] NOT NULL DEFAULT '{}'` (+ GIN index)
--      - `is_system_root boolean NOT NULL DEFAULT false`
--      - `description text`
--      - `parent_id uuid REFERENCES public.categories(id) ON DELETE RESTRICT`
--      - Composite index `(root_key, depth, sort_order)`
--   2. Structural Triggers (`BEFORE INSERT OR UPDATE OR DELETE` + `AFTER UPDATE`):
--      - Immutable Level-1 System Roots (cannot delete or change root_key/slug/parent_id/depth/is_system_root)
--      - Same-root & max-depth (<= 3) guard preventing cross-root moves, L4 creation, or cycles
--      - Automatic `path_ids` & `depth` computation with L2 -> L3 descendant cascade
--      - `public.audit_logs` trigger verification
--   3. Canonical 11 Fixed Level-1 System Roots (8 Directory Listing verticals +
--      3 Platform Feature entity roots: marketplace, bulletin, vehicles) +
--      safe idempotent backfill of existing sub-categories to L2/L3.
--   4. Interconnected Sync (`listings.root_key` + trigger, `subscription_plans`
--      UUID/root_key scope arrays, `get_category_descendant_ids`,
--      `category_matches_plan_scope`, upgraded `get_effective_entitlements`
--      and `resolve_effective_payment_methods`).
--
-- Execution Order: v15a -> v15b -> v15c -> v15d -> v15e -> v15f -> v16b
-- 100% Idempotent: Safe to re-run without destructive side effects.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. PREPARE `public.categories` FOR 3-LEVEL FIXED-ROOT MATERIALIZED HIERARCHY
-- -----------------------------------------------------------------------------

-- Drop legacy depth trigger & check temporarily so 0..2 -> 1..3 backfill runs cleanly
DROP TRIGGER IF EXISTS trg_categories_enforce_depth ON public.categories;
DROP TRIGGER IF EXISTS trg_categories_v16b_guard ON public.categories;
DROP TRIGGER IF EXISTS trg_categories_v16b_cascade ON public.categories;

ALTER TABLE public.categories
  DROP CONSTRAINT IF EXISTS categories_depth_check,
  DROP CONSTRAINT IF EXISTS categories_v16b_root_structure_check;

-- Add new v16b columns idempotently
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS root_key text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS path_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS is_system_root boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS icon_key text DEFAULT 'tag',
  ADD COLUMN IF NOT EXISTS accent_color text DEFAULT '#2563EB',
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Ensure parent_id FK enforces ON DELETE RESTRICT (never silently cascade-deletes children)
DO $$
DECLARE
  v_fk record;
BEGIN
  FOR v_fk IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'categories'
      AND c.contype = 'f'
      AND pg_get_constraintdef(c.oid) ~* 'FOREIGN KEY \(parent_id\)'
  LOOP
    EXECUTE format('ALTER TABLE public.categories DROP CONSTRAINT IF EXISTS %I', v_fk.conname);
  END LOOP;

  ALTER TABLE public.categories
    ADD CONSTRAINT categories_parent_id_fkey
    FOREIGN KEY (parent_id)
    REFERENCES public.categories(id)
    ON DELETE RESTRICT;
END;
$$;

-- -----------------------------------------------------------------------------
-- 2. SEED ALL 11 CANONICAL FIXED LEVEL-1 SYSTEM ROOTS (IDEMPOTENT)
--    8 Listing Verticals (matching lib/verticals/types.ts & payment_feature_policies)
--    + 3 Platform Entity Roots (marketplace, bulletin, vehicles)
-- -----------------------------------------------------------------------------
INSERT INTO public.categories (
  entity_type,
  parent_id,
  root_key,
  depth,
  is_system_root,
  slug,
  display_name,
  description,
  icon,
  icon_key,
  color_hex,
  accent_color,
  sort_order,
  is_active
)
VALUES
  -- 8 Canonical Directory Listing Verticals
  (
    'listing', NULL, 'general', 1, true, 'general',
    'General Business & Services',
    'Local service professionals, repairs, clinics, coaching, salons, and general neighborhood businesses.',
    'briefcase', 'briefcase', '#2563EB', '#2563EB', 10, true
  ),
  (
    'listing', NULL, 'shop_catalogue', 1, true, 'shop_catalogue',
    'Retail & Local Shop Catalogue',
    'Local retail storefronts, pharmacies, electronics, groceries, hardware, and apparel shops.',
    'shopping-bag', 'shopping-bag', '#0D9488', '#0D9488', 20, true
  ),
  (
    'listing', NULL, 'restaurant_food', 1, true, 'restaurant_food',
    'Restaurants, Cafés & Bakeries',
    'Dining spots, local kitchens, cafés, fast food counters, tea stalls, and bakeries.',
    'utensils', 'utensils', '#EA580C', '#EA580C', 30, true
  ),
  (
    'listing', NULL, 'print_digital', 1, true, 'print_digital',
    'Print, Copy & Digital Services',
    'Xerox, photo printing, flex banners, CSC documentation counters, and digital print studios.',
    'printer', 'printer', '#4F46E5', '#4F46E5', 40, true
  ),
  (
    'listing', NULL, 'real_estate', 1, true, 'real_estate',
    'Real Estate & Land Plots',
    'Patta land plots, residential houses, rental flats, shops, and commercial spaces with map boundaries.',
    'home', 'home', '#D97706', '#D97706', 50, true
  ),
  (
    'listing', NULL, 'hotel_stay', 1, true, 'hotel_stay',
    'Hotels, Homestays & Lodging',
    'Verified hotels, guesthouses, homestays, lodges, and short-term stays.',
    'bed-double', 'bed-double', '#0284C7', '#0284C7', 60, true
  ),
  (
    'listing', NULL, 'booking_venue', 1, true, 'booking_venue',
    'Sports & Venue Bookings',
    'Futsal turfs, badminton courts, gyms, marriage halls, and hourly bookable event venues.',
    'trophy', 'trophy', '#16A34A', '#16A34A', 70, true
  ),
  (
    'listing', NULL, 'public_civic', 1, true, 'public_civic',
    'Public & Civic Institutions',
    'Government offices, emergency hospitals, police/fire stations, schools, churches, and public helplines.',
    'landmark', 'landmark', '#7C3AED', '#7C3AED', 80, true
  ),
  -- 3 Canonical Platform Entity Roots
  (
    'product', NULL, 'marketplace', 1, true, 'marketplace',
    'Marketplace & Shop Products',
    'Product catalog taxonomy for local shops, handloom wear, electronics, stationery, and produce.',
    'store', 'store', '#059669', '#059669', 10, true
  ),
  (
    'bulletin', NULL, 'bulletin', 1, true, 'bulletin',
    'Community Bulletins & Notices',
    'District announcements, job postings, advertisements, public notices, and community events.',
    'megaphone', 'megaphone', '#E11D48', '#E11D48', 10, true
  ),
  (
    'vehicle', NULL, 'vehicles', 1, true, 'vehicles',
    'Fleet & Vehicle Rentals',
    'City taxis, 4WD hill charters, inter-hub Winger/Sumo counters, and goods pickup vehicles.',
    'car', 'car', '#0891B2', '#0891B2', 10, true
  )
ON CONFLICT (entity_type, slug) DO UPDATE
SET
  root_key = EXCLUDED.root_key,
  parent_id = NULL,
  depth = 1,
  is_system_root = true,
  description = COALESCE(NULLIF(trim(public.categories.description), ''), EXCLUDED.description),
  updated_at = now();

-- -----------------------------------------------------------------------------
-- 3. BACKFILL & NORMALIZE EXISTING SUB-CATEGORIES TO L2/L3 UNDER CANONICAL ROOTS
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_root_general uuid;
  v_root_shop uuid;
  v_root_food uuid;
  v_root_print uuid;
  v_root_real_estate uuid;
  v_root_hotel uuid;
  v_root_venue uuid;
  v_root_civic uuid;
  v_root_marketplace uuid;
  v_root_bulletin uuid;
  v_root_vehicles uuid;

  v_legacy_businesses uuid;
  v_legacy_services uuid;
  v_legacy_public uuid;
  v_legacy_sports uuid;

  v_l2_id uuid;
BEGIN
  SELECT id INTO v_root_general     FROM public.categories WHERE entity_type = 'listing'  AND slug = 'general'         AND is_system_root = true LIMIT 1;
  SELECT id INTO v_root_shop        FROM public.categories WHERE entity_type = 'listing'  AND slug = 'shop_catalogue'  AND is_system_root = true LIMIT 1;
  SELECT id INTO v_root_food        FROM public.categories WHERE entity_type = 'listing'  AND slug = 'restaurant_food' AND is_system_root = true LIMIT 1;
  SELECT id INTO v_root_print       FROM public.categories WHERE entity_type = 'listing'  AND slug = 'print_digital'   AND is_system_root = true LIMIT 1;
  SELECT id INTO v_root_real_estate FROM public.categories WHERE entity_type = 'listing'  AND slug = 'real_estate'     AND is_system_root = true LIMIT 1;
  SELECT id INTO v_root_hotel       FROM public.categories WHERE entity_type = 'listing'  AND slug = 'hotel_stay'      AND is_system_root = true LIMIT 1;
  SELECT id INTO v_root_venue       FROM public.categories WHERE entity_type = 'listing'  AND slug = 'booking_venue'   AND is_system_root = true LIMIT 1;
  SELECT id INTO v_root_civic       FROM public.categories WHERE entity_type = 'listing'  AND slug = 'public_civic'    AND is_system_root = true LIMIT 1;
  SELECT id INTO v_root_marketplace FROM public.categories WHERE entity_type = 'product'  AND slug = 'marketplace'     AND is_system_root = true LIMIT 1;
  SELECT id INTO v_root_bulletin    FROM public.categories WHERE entity_type = 'bulletin' AND slug = 'bulletin'        AND is_system_root = true LIMIT 1;
  SELECT id INTO v_root_vehicles    FROM public.categories WHERE entity_type = 'vehicle'  AND slug = 'vehicles'        AND is_system_root = true LIMIT 1;

  -- Locate legacy Phase 67-A umbrella rows (listing)
  SELECT id INTO v_legacy_businesses FROM public.categories WHERE entity_type = 'listing' AND slug IN ('businesses_shops', 'business', 'retail_shopping') AND is_system_root = false LIMIT 1;
  SELECT id INTO v_legacy_services   FROM public.categories WHERE entity_type = 'listing' AND slug IN ('services', 'service', 'services_repairs')          AND is_system_root = false LIMIT 1;
  SELECT id INTO v_legacy_public     FROM public.categories WHERE entity_type = 'listing' AND slug IN ('public_community', 'public_place', 'public_places_institutions') AND is_system_root = false LIMIT 1;
  SELECT id INTO v_legacy_sports     FROM public.categories WHERE entity_type = 'listing' AND slug IN ('sports_recreation', 'sports')                       AND is_system_root = false LIMIT 1;

  -- Re-parent known cross-vertical L2 nodes from legacy `businesses_shops` to their exact vertical root
  UPDATE public.categories
  SET parent_id = v_root_print
  WHERE entity_type = 'listing'
    AND is_system_root = false
    AND slug IN ('printing_xerox', 'printing_digital', 'print_shops', 'csc_digital')
    AND v_root_print IS NOT NULL;

  UPDATE public.categories
  SET parent_id = v_root_food
  WHERE entity_type = 'listing'
    AND is_system_root = false
    AND slug IN ('cafes_restaurants', 'restaurants', 'bakeries_cafes', 'local_kitchens')
    AND v_root_food IS NOT NULL;

  -- Re-parent remaining children of legacy umbrella rows directly under canonical L1 roots
  IF v_legacy_businesses IS NOT NULL AND v_root_shop IS NOT NULL THEN
    UPDATE public.categories SET parent_id = v_root_shop WHERE parent_id = v_legacy_businesses AND id <> v_root_shop;
    UPDATE public.listings   SET category_id = v_root_shop WHERE category_id = v_legacy_businesses;
    UPDATE public.categories SET parent_id = v_root_shop, is_active = false WHERE id = v_legacy_businesses;
  END IF;

  IF v_legacy_services IS NOT NULL AND v_root_general IS NOT NULL THEN
    UPDATE public.categories SET parent_id = v_root_general WHERE parent_id = v_legacy_services AND id <> v_root_general;
    UPDATE public.listings   SET category_id = v_root_general WHERE category_id = v_legacy_services;
    UPDATE public.categories SET parent_id = v_root_general, is_active = false WHERE id = v_legacy_services;
  END IF;

  IF v_legacy_public IS NOT NULL AND v_root_civic IS NOT NULL THEN
    UPDATE public.categories SET parent_id = v_root_civic WHERE parent_id = v_legacy_public AND id <> v_root_civic;
    UPDATE public.listings   SET category_id = v_root_civic WHERE category_id = v_legacy_public;
    UPDATE public.categories SET parent_id = v_root_civic, is_active = false WHERE id = v_legacy_public;
  END IF;

  IF v_legacy_sports IS NOT NULL AND v_root_venue IS NOT NULL THEN
    UPDATE public.categories SET parent_id = v_root_venue WHERE parent_id = v_legacy_sports AND id <> v_root_venue;
    UPDATE public.listings   SET category_id = v_root_venue WHERE category_id = v_legacy_sports;
    UPDATE public.categories SET parent_id = v_root_venue, is_active = false WHERE id = v_legacy_sports;
  END IF;

  -- Any other stray non-system listing top-level rows become L2 under their best-fit canonical root
  UPDATE public.categories
  SET parent_id = CASE
    WHEN slug ~* '(print|xerox|csc|copy|photo)' THEN v_root_print
    WHEN slug ~* '(food|cafe|restaur|bakery|tea|dine|kitchen)' THEN v_root_food
    WHEN slug ~* '(hotel|stay|homestay|lodge|resort|hostel)' THEN v_root_hotel
    WHEN slug ~* '(sport|turf|futsal|venue|hall|court|gym)' THEN v_root_venue
    WHEN slug ~* '(real_estate|land|plot|house|rent|property)' THEN v_root_real_estate
    WHEN slug ~* '(civic|govt|public|hospital|school|church|police)' THEN v_root_civic
    WHEN slug ~* '(shop|store|mart|grocer|pharm|electr|hardw|fashion)' THEN v_root_shop
    ELSE v_root_general
  END
  WHERE entity_type = 'listing'
    AND is_system_root = false
    AND parent_id IS NULL;

  -- Re-parent non-system top-level product / bulletin / vehicle categories under their canonical L1 roots
  IF v_root_marketplace IS NOT NULL THEN
    -- First hoist any 3rd-tier grandchildren (depth >= 2 in old 0-indexed scheme) up to their L1 parent
    -- so that once L1 becomes L2 under `marketplace`, no row exceeds depth 3.
    UPDATE public.categories gc
    SET parent_id = p.parent_id
    FROM public.categories p
    WHERE gc.entity_type = 'product'
      AND gc.is_system_root = false
      AND gc.parent_id = p.id
      AND p.parent_id IS NOT NULL
      AND p.parent_id <> v_root_marketplace;

    UPDATE public.categories
    SET parent_id = v_root_marketplace
    WHERE entity_type = 'product'
      AND is_system_root = false
      AND parent_id IS NULL
      AND id <> v_root_marketplace;
  END IF;

  IF v_root_bulletin IS NOT NULL THEN
    UPDATE public.categories gc
    SET parent_id = p.parent_id
    FROM public.categories p
    WHERE gc.entity_type = 'bulletin'
      AND gc.is_system_root = false
      AND gc.parent_id = p.id
      AND p.parent_id IS NOT NULL
      AND p.parent_id <> v_root_bulletin;

    UPDATE public.categories
    SET parent_id = v_root_bulletin
    WHERE entity_type = 'bulletin'
      AND is_system_root = false
      AND parent_id IS NULL
      AND id <> v_root_bulletin;
  END IF;

  IF v_root_vehicles IS NOT NULL THEN
    UPDATE public.categories gc
    SET parent_id = p.parent_id
    FROM public.categories p
    WHERE gc.entity_type = 'vehicle'
      AND gc.is_system_root = false
      AND gc.parent_id = p.id
      AND p.parent_id IS NOT NULL
      AND p.parent_id <> v_root_vehicles;

    UPDATE public.categories
    SET parent_id = v_root_vehicles
    WHERE entity_type = 'vehicle'
      AND is_system_root = false
      AND parent_id IS NULL
      AND id <> v_root_vehicles;
  END IF;

  -- Seed helpful default L2 / L3 sub-categories for newly separated roots (idempotent)
  IF v_root_hotel IS NOT NULL THEN
    INSERT INTO public.categories (entity_type, parent_id, root_key, depth, is_system_root, slug, display_name, icon, icon_key, color_hex, accent_color, sort_order, is_active)
    VALUES
      ('listing', v_root_hotel, 'hotel_stay', 2, false, 'hotels_resorts', 'Hotels & Resorts', 'bed-double', 'bed-double', '#0284C7', '#0284C7', 10, true),
      ('listing', v_root_hotel, 'hotel_stay', 2, false, 'homestays_guesthouses', 'Homestays & Guesthouses', 'home', 'home', '#0369A1', '#0369A1', 20, true),
      ('listing', v_root_hotel, 'hotel_stay', 2, false, 'lodges_hostels', 'Lodges & Hostels', 'building-2', 'building-2', '#0EA5E9', '#0EA5E9', 30, true)
    ON CONFLICT (entity_type, slug) DO NOTHING;
  END IF;

  IF v_root_venue IS NOT NULL THEN
    INSERT INTO public.categories (entity_type, parent_id, root_key, depth, is_system_root, slug, display_name, icon, icon_key, color_hex, accent_color, sort_order, is_active)
    VALUES
      ('listing', v_root_venue, 'booking_venue', 2, false, 'futsal_turfs', 'Futsal & Football Turfs', 'trophy', 'trophy', '#16A34A', '#16A34A', 10, true),
      ('listing', v_root_venue, 'booking_venue', 2, false, 'indoor_courts_gyms', 'Indoor Courts & Gyms', 'dumbbell', 'dumbbell', '#15803D', '#15803D', 20, true),
      ('listing', v_root_venue, 'booking_venue', 2, false, 'event_community_halls', 'Event & Community Halls', 'calendar', 'calendar', '#059669', '#059669', 30, true)
    ON CONFLICT (entity_type, slug) DO NOTHING;
  END IF;

  IF v_root_food IS NOT NULL THEN
    INSERT INTO public.categories (entity_type, parent_id, root_key, depth, is_system_root, slug, display_name, icon, icon_key, color_hex, accent_color, sort_order, is_active)
    VALUES
      ('listing', v_root_food, 'restaurant_food', 2, false, 'cafes_restaurants', 'Cafés & Restaurants', 'utensils', 'utensils', '#EA580C', '#EA580C', 10, true),
      ('listing', v_root_food, 'restaurant_food', 2, false, 'bakeries_desserts', 'Bakeries & Desserts', 'coffee', 'coffee', '#D97706', '#D97706', 20, true),
      ('listing', v_root_food, 'restaurant_food', 2, false, 'fast_food_takeaway', 'Fast Food & Takeaway', 'flame', 'flame', '#DC2626', '#DC2626', 30, true)
    ON CONFLICT (entity_type, slug) DO NOTHING;

    SELECT id INTO v_l2_id FROM public.categories WHERE entity_type = 'listing' AND slug = 'cafes_restaurants' LIMIT 1;
    IF v_l2_id IS NOT NULL THEN
      INSERT INTO public.categories (entity_type, parent_id, root_key, depth, is_system_root, slug, display_name, icon, icon_key, color_hex, accent_color, sort_order, is_active)
      VALUES
        ('listing', v_l2_id, 'restaurant_food', 3, false, 'local_ethnic_cuisine', 'Local & Ethnic Cuisine', 'utensils', 'utensils', '#EA580C', '#EA580C', 10, true),
        ('listing', v_l2_id, 'restaurant_food', 3, false, 'coffee_tea_lounges', 'Coffee & Tea Lounges', 'coffee', 'coffee', '#C2410C', '#C2410C', 20, true)
      ON CONFLICT (entity_type, slug) DO NOTHING;
    END IF;
  END IF;

  IF v_root_print IS NOT NULL THEN
    INSERT INTO public.categories (entity_type, parent_id, root_key, depth, is_system_root, slug, display_name, icon, icon_key, color_hex, accent_color, sort_order, is_active)
    VALUES
      ('listing', v_root_print, 'print_digital', 2, false, 'printing_xerox', 'Printing & Xerox', 'printer', 'printer', '#4F46E5', '#4F46E5', 10, true),
      ('listing', v_root_print, 'print_digital', 2, false, 'csc_govt_documentation', 'CSC & Document Services', 'file-text', 'file-text', '#4338CA', '#4338CA', 20, true)
    ON CONFLICT (entity_type, slug) DO NOTHING;
  END IF;

  IF v_root_real_estate IS NOT NULL THEN
    SELECT id INTO v_l2_id FROM public.categories WHERE entity_type = 'listing' AND slug = 'land_plots' LIMIT 1;
    IF v_l2_id IS NOT NULL THEN
      INSERT INTO public.categories (entity_type, parent_id, root_key, depth, is_system_root, slug, display_name, icon, icon_key, color_hex, accent_color, sort_order, is_active)
      VALUES
        ('listing', v_l2_id, 'real_estate', 3, false, 'patta_residential_plots', 'Patta Residential Plots', 'map', 'map', '#D97706', '#D97706', 10, true),
        ('listing', v_l2_id, 'real_estate', 3, false, 'agricultural_hill_land', 'Agricultural & Hill Land', 'trees', 'trees', '#B45309', '#B45309', 20, true)
      ON CONFLICT (entity_type, slug) DO NOTHING;
    END IF;
  END IF;

  -- Safety pass: collapse any residual depth > 3 node to its L2 ancestor before materializing
  FOR i IN 1..3 LOOP
    WITH RECURSIVE tree AS (
      SELECT id, parent_id, 1 AS lvl, ARRAY[id] AS p
      FROM public.categories
      WHERE parent_id IS NULL
      UNION ALL
      SELECT c.id, c.parent_id, t.lvl + 1, t.p || c.id
      FROM public.categories c
      JOIN tree t ON c.parent_id = t.id
      WHERE NOT (c.id = ANY(t.p))
    )
    UPDATE public.categories c
    SET parent_id = t.p[2]
    FROM tree t
    WHERE c.id = t.id
      AND t.lvl > 3
      AND array_length(t.p, 1) >= 2;
  END LOOP;

  -- Materialize root_key, depth (1..3), and path_ids across ALL categories deterministically
  WITH RECURSIVE materialized AS (
    SELECT
      id,
      COALESCE(NULLIF(trim(root_key), ''), slug) AS calc_root_key,
      1::smallint AS calc_depth,
      ARRAY[id]::uuid[] AS calc_path_ids
    FROM public.categories
    WHERE parent_id IS NULL
    UNION ALL
    SELECT
      c.id,
      m.calc_root_key,
      (m.calc_depth + 1)::smallint AS calc_depth,
      (m.calc_path_ids || c.id)::uuid[] AS calc_path_ids
    FROM public.categories c
    JOIN materialized m ON c.parent_id = m.id
    WHERE NOT (c.id = ANY(m.calc_path_ids))
  )
  UPDATE public.categories c
  SET
    root_key = m.calc_root_key,
    depth = m.calc_depth,
    path_ids = m.calc_path_ids
  FROM materialized m
  WHERE c.id = m.id;
END;
$$;

-- Enforce strict column types, NOT NULLs, constraints, and indexes
ALTER TABLE public.categories
  ALTER COLUMN root_key SET NOT NULL,
  ALTER COLUMN depth TYPE smallint USING LEAST(3, GREATEST(1, COALESCE(depth, 1)))::smallint,
  ALTER COLUMN depth SET NOT NULL,
  ALTER COLUMN depth SET DEFAULT 2,
  ALTER COLUMN path_ids SET NOT NULL,
  ALTER COLUMN path_ids SET DEFAULT '{}',
  ALTER COLUMN is_system_root SET NOT NULL,
  ALTER COLUMN is_system_root SET DEFAULT false,
  ALTER COLUMN sort_order SET NOT NULL,
  ALTER COLUMN sort_order SET DEFAULT 0;

ALTER TABLE public.categories
  DROP CONSTRAINT IF EXISTS categories_depth_check;
ALTER TABLE public.categories
  ADD CONSTRAINT categories_depth_check
  CHECK (depth BETWEEN 1 AND 3);

ALTER TABLE public.categories
  DROP CONSTRAINT IF EXISTS categories_v16b_root_structure_check;
ALTER TABLE public.categories
  ADD CONSTRAINT categories_v16b_root_structure_check
  CHECK (
    (is_system_root = true AND parent_id IS NULL AND depth = 1)
    OR
    (is_system_root = false AND parent_id IS NOT NULL AND depth IN (2, 3))
  );

CREATE UNIQUE INDEX IF NOT EXISTS idx_categories_unique_system_root_key
  ON public.categories (entity_type, root_key)
  WHERE is_system_root = true;

CREATE INDEX IF NOT EXISTS idx_categories_path_ids_gin
  ON public.categories USING GIN (path_ids);

CREATE INDEX IF NOT EXISTS idx_categories_root_depth_sort
  ON public.categories (root_key, depth, sort_order);

-- -----------------------------------------------------------------------------
-- 4. STRUCTURAL INTEGRITY TRIGGERS ON `public.categories`
--    (1) Immutable System Roots
--    (2) Same-Root & Max-Depth (<= 3) Guard + Acyclic Check
--    (3) Auto-Maintained `path_ids` + L2 -> L3 Descendant Cascade
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_and_maintain_categories_v16b()
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
  -- 1. Block deleting any immutable Level-1 System Root
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_system_root = true THEN
      RAISE EXCEPTION 'System root category "%" (root_key=%) cannot be deleted.',
        OLD.display_name, OLD.root_key
        USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;

  -- Ensure NEW.id exists before building path_ids
  IF NEW.id IS NULL THEN
    NEW.id := gen_random_uuid();
  END IF;

  -- Normalize slug cleanly
  NEW.slug := trim(both '_-' FROM regexp_replace(lower(COALESCE(NEW.slug, NEW.display_name, '')), '[^a-z0-9_-]+', '-', 'g'));
  IF NEW.slug = '' THEN
    RAISE EXCEPTION 'Category slug cannot be empty.' USING ERRCODE = '22023';
  END IF;

  -- Keep legacy icon/color columns synced with icon_key/accent_color
  IF NEW.icon_key IS NOT NULL AND trim(NEW.icon_key) <> '' THEN
    NEW.icon := NEW.icon_key;
  ELSIF NEW.icon IS NOT NULL AND trim(NEW.icon) <> '' THEN
    NEW.icon_key := NEW.icon;
  END IF;

  IF NEW.accent_color IS NOT NULL AND trim(NEW.accent_color) <> '' THEN
    NEW.color_hex := NEW.accent_color;
  ELSIF NEW.color_hex IS NOT NULL AND trim(NEW.color_hex) <> '' THEN
    NEW.accent_color := NEW.color_hex;
  END IF;

  -- 2. Immutable System Root Rules on UPDATE
  IF TG_OP = 'UPDATE' AND OLD.is_system_root = true THEN
    IF NEW.is_system_root IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Cannot unset is_system_root on system root "%".', OLD.root_key USING ERRCODE = '42501';
    END IF;
    IF NEW.root_key IS DISTINCT FROM OLD.root_key THEN
      RAISE EXCEPTION 'Cannot change root_key on system root "%".', OLD.root_key USING ERRCODE = '42501';
    END IF;
    IF NEW.slug IS DISTINCT FROM OLD.slug THEN
      RAISE EXCEPTION 'Cannot change slug on system root "%".', OLD.slug USING ERRCODE = '42501';
    END IF;
    IF NEW.parent_id IS DISTINCT FROM NULL THEN
      RAISE EXCEPTION 'System root "%" cannot be moved under a parent.', OLD.root_key USING ERRCODE = '42501';
    END IF;
    IF NEW.depth IS DISTINCT FROM 1 THEN
      RAISE EXCEPTION 'System root "%" must remain at depth 1.', OLD.root_key USING ERRCODE = '42501';
    END IF;
    IF NEW.entity_type IS DISTINCT FROM OLD.entity_type THEN
      RAISE EXCEPTION 'Cannot change entity_type on system root "%".', OLD.root_key USING ERRCODE = '42501';
    END IF;

    NEW.parent_id := NULL;
    NEW.depth := 1;
    NEW.path_ids := ARRAY[NEW.id];
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  -- 3. System Root INSERT (allowed only via migrations/service bootstrap; cannot promote non-root via UPDATE)
  IF NEW.is_system_root = true THEN
    IF TG_OP = 'UPDATE' AND OLD.is_system_root = false THEN
      RAISE EXCEPTION 'Cannot promote a sub-category into a system root.' USING ERRCODE = '42501';
    END IF;
    IF NEW.parent_id IS NOT NULL THEN
      RAISE EXCEPTION 'System root must have parent_id = NULL.' USING ERRCODE = '22023';
    END IF;
    NEW.root_key := COALESCE(NULLIF(trim(NEW.root_key), ''), NEW.slug);
    NEW.depth := 1;
    NEW.path_ids := ARRAY[NEW.id];
    NEW.updated_at := now();
    RETURN NEW;
  END IF;

  -- 4. Non-System Nodes (L2 & L3): Must attach to an existing parent within the same root_key
  IF NEW.parent_id IS NULL THEN
    RAISE EXCEPTION 'Non-system categories must belong to a Level-1 System Root or Level-2 parent (parent_id required).'
      USING ERRCODE = '22023';
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.parent_id = NEW.id THEN
    RAISE EXCEPTION 'Category cannot be its own parent.' USING ERRCODE = '22023';
  END IF;

  SELECT id, entity_type, root_key, depth, path_ids
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

  -- Block cross-root moves on UPDATE
  IF TG_OP = 'UPDATE' AND OLD.root_key IS NOT NULL AND OLD.root_key <> v_parent.root_key THEN
    RAISE EXCEPTION 'Cannot move category across different system roots (% -> %). Moves are strictly limited within the same root_key.',
      OLD.root_key, v_parent.root_key
      USING ERRCODE = '22023';
  END IF;

  -- Derive root_key & depth strictly from parent
  NEW.root_key := v_parent.root_key;
  NEW.depth := (v_parent.depth + 1)::smallint;

  IF NEW.depth > 3 THEN
    RAISE EXCEPTION 'Maximum category depth is 3 levels (Level-1 Root -> Level-2 -> Level-3). Cannot nest under a Level-3 leaf.'
      USING ERRCODE = '22023';
  END IF;

  -- On UPDATE: verify acyclic ancestry and ensure existing descendants do not exceed depth 3
  IF TG_OP = 'UPDATE' THEN
    WITH RECURSIVE ancestors AS (
      SELECT id, parent_id
      FROM public.categories
      WHERE id = NEW.parent_id
      UNION ALL
      SELECT c.id, c.parent_id
      FROM public.categories c
      JOIN ancestors a ON c.id = a.parent_id
    )
    SELECT EXISTS (SELECT 1 FROM ancestors WHERE id = NEW.id)
      INTO v_has_cycle;

    IF v_has_cycle THEN
      RAISE EXCEPTION 'Circular category hierarchy detected.' USING ERRCODE = '22023';
    END IF;

    WITH RECURSIVE descendants AS (
      SELECT id, 1 AS rel_offset
      FROM public.categories
      WHERE parent_id = NEW.id
      UNION ALL
      SELECT c.id, d.rel_offset + 1
      FROM public.categories c
      JOIN descendants d ON c.parent_id = d.id
    )
    SELECT COALESCE(MAX(rel_offset), 0)
      INTO v_max_descendant_offset
    FROM descendants;

    IF NEW.depth + v_max_descendant_offset > 3 THEN
      RAISE EXCEPTION 'Cannot demote category "%" to Level 3 because it already has Level-3 sub-categories. Move or remove its children first.',
        NEW.display_name
        USING ERRCODE = '22023';
    END IF;
  END IF;

  NEW.path_ids := v_parent.path_ids || NEW.id;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_categories_v16b_guard ON public.categories;
CREATE TRIGGER trg_categories_v16b_guard
  BEFORE INSERT OR UPDATE OR DELETE ON public.categories
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_and_maintain_categories_v16b();

-- AFTER UPDATE trigger to cascade `path_ids`, `depth`, and `root_key` to direct L3 children when an L2 moves
CREATE OR REPLACE FUNCTION public.cascade_category_descendants_v16b()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (NEW.path_ids IS DISTINCT FROM OLD.path_ids)
     OR (NEW.depth IS DISTINCT FROM OLD.depth)
     OR (NEW.root_key IS DISTINCT FROM OLD.root_key) THEN
    UPDATE public.categories
    SET
      root_key = NEW.root_key,
      depth = (NEW.depth + 1)::smallint,
      path_ids = NEW.path_ids || id,
      updated_at = now()
    WHERE parent_id = NEW.id
      AND (
        path_ids IS DISTINCT FROM (NEW.path_ids || id)
        OR depth IS DISTINCT FROM (NEW.depth + 1)::smallint
        OR root_key IS DISTINCT FROM NEW.root_key
      );
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_categories_v16b_cascade ON public.categories;
CREATE TRIGGER trg_categories_v16b_cascade
  AFTER UPDATE OF parent_id, path_ids, depth, root_key ON public.categories
  FOR EACH ROW
  EXECUTE FUNCTION public.cascade_category_descendants_v16b();

-- Re-verify super_admin-only write RLS & audit trigger on public.categories
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS categories_public_read ON public.categories;
CREATE POLICY categories_public_read
  ON public.categories
  FOR SELECT
  USING (is_active = true OR public.is_super_admin());

DROP POLICY IF EXISTS categories_superadmin_insert_v15c ON public.categories;
CREATE POLICY categories_superadmin_insert_v15c
  ON public.categories
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS categories_superadmin_update_v15c ON public.categories;
CREATE POLICY categories_superadmin_update_v15c
  ON public.categories
  FOR UPDATE
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS categories_superadmin_delete_v15c ON public.categories;
CREATE POLICY categories_superadmin_delete_v15c
  ON public.categories
  FOR DELETE
  TO authenticated
  USING (public.is_super_admin() AND is_system_root = false);

DO $$
BEGIN
  IF to_regprocedure('public.audit_superadmin_config_change()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_audit_categories_changes ON public.categories;
    CREATE TRIGGER trg_audit_categories_changes
      AFTER INSERT OR UPDATE OR DELETE ON public.categories
      FOR EACH ROW
      EXECUTE FUNCTION public.audit_superadmin_config_change();
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- 5. INTERCONNECTED `public.listings` SYNC (`category_id` -> `root_key`)
-- -----------------------------------------------------------------------------
ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS root_key text;

-- Backfill listings.root_key from categories.root_key or listing_vertical / legacy category
UPDATE public.listings l
SET root_key = c.root_key
FROM public.categories c
WHERE l.category_id = c.id
  AND (l.root_key IS NULL OR l.root_key <> c.root_key);

UPDATE public.listings
SET root_key = CASE
  WHEN listing_vertical IN (
    'general','print_digital','booking_venue','shop_catalogue',
    'real_estate','restaurant_food','hotel_stay','public_civic'
  ) THEN listing_vertical
  WHEN is_civic_record = true OR category = 'public_place' THEN 'public_civic'
  WHEN category = 'real_estate' THEN 'real_estate'
  WHEN category = 'sports' THEN 'booking_venue'
  WHEN category = 'business' THEN 'shop_catalogue'
  ELSE 'general'
END
WHERE root_key IS NULL OR trim(root_key) = '';

-- Backfill NULL listings.category_id to their matching canonical Level-1 Root
UPDATE public.listings l
SET category_id = c.id
FROM public.categories c
WHERE l.category_id IS NULL
  AND c.entity_type = 'listing'
  AND c.is_system_root = true
  AND c.root_key = l.root_key;

ALTER TABLE public.listings
  ALTER COLUMN root_key SET DEFAULT 'general';

CREATE INDEX IF NOT EXISTS idx_listings_root_key
  ON public.listings (root_key);

CREATE INDEX IF NOT EXISTS idx_listings_category_id_root_key
  ON public.listings (category_id, root_key);

-- BEFORE INSERT OR UPDATE trigger keeping listings.root_key synchronized with categories.root_key
CREATE OR REPLACE FUNCTION public.sync_listing_root_key_v16b()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cat_root_key text;
  v_fallback_root text;
  v_root_cat_id uuid;
BEGIN
  IF NEW.category_id IS NOT NULL THEN
    SELECT c.root_key
      INTO v_cat_root_key
    FROM public.categories c
    WHERE c.id = NEW.category_id;

    IF v_cat_root_key IS NOT NULL AND trim(v_cat_root_key) <> '' THEN
      NEW.root_key := v_cat_root_key;
      IF v_cat_root_key IN (
        'general','print_digital','booking_venue','shop_catalogue',
        'real_estate','restaurant_food','hotel_stay','public_civic'
      ) THEN
        NEW.listing_vertical := v_cat_root_key;
        NEW.is_civic_record := (v_cat_root_key = 'public_civic');
      END IF;
      RETURN NEW;
    END IF;
  END IF;

  -- Fallback when category_id is NULL: derive root_key from listing_vertical / legacy category
  v_fallback_root := CASE
    WHEN NEW.root_key IN (
      'general','print_digital','booking_venue','shop_catalogue',
      'real_estate','restaurant_food','hotel_stay','public_civic'
    ) THEN NEW.root_key
    WHEN NEW.listing_vertical IN (
      'general','print_digital','booking_venue','shop_catalogue',
      'real_estate','restaurant_food','hotel_stay','public_civic'
    ) THEN NEW.listing_vertical
    WHEN COALESCE(NEW.is_civic_record, false) = true OR NEW.category = 'public_place' THEN 'public_civic'
    WHEN NEW.category = 'real_estate' THEN 'real_estate'
    WHEN NEW.category = 'sports' THEN 'booking_venue'
    ELSE 'general'
  END;

  NEW.root_key := v_fallback_root;
  IF NEW.category_id IS NULL THEN
    SELECT c.id
      INTO v_root_cat_id
    FROM public.categories c
    WHERE c.entity_type = 'listing'
      AND c.is_system_root = true
      AND c.root_key = v_fallback_root
    LIMIT 1;
    IF v_root_cat_id IS NOT NULL THEN
      NEW.category_id := v_root_cat_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_listings_sync_root_key_v16b ON public.listings;
CREATE TRIGGER trg_listings_sync_root_key_v16b
  BEFORE INSERT OR UPDATE OF category_id, listing_vertical, root_key ON public.listings
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_listing_root_key_v16b();

-- -----------------------------------------------------------------------------
-- 6. HIERARCHICAL SQL HELPERS (`get_category_descendant_ids` & `category_matches_plan_scope`)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_category_descendant_ids(p_category_id uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    ARRAY(
      SELECT c.id
      FROM public.categories c
      WHERE c.path_ids @> ARRAY[p_category_id]
      ORDER BY c.depth ASC, c.sort_order ASC, c.display_name ASC
    ),
    '{}'::uuid[]
  );
$$;

REVOKE ALL ON FUNCTION public.get_category_descendant_ids(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_category_descendant_ids(uuid) TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.category_matches_plan_scope(
  p_category_id uuid,
  p_allowed_category_ids uuid[],
  p_allowed_root_keys text[]
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_cat record;
BEGIN
  -- Wildcard root access covers every category
  IF p_allowed_root_keys IS NOT NULL AND ('*' = ANY(p_allowed_root_keys)) THEN
    RETURN true;
  END IF;

  IF p_category_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT id, root_key, path_ids
    INTO v_cat
  FROM public.categories
  WHERE id = p_category_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  -- Direct root_key match (L1 covers all L2 & L3 descendants)
  IF p_allowed_root_keys IS NOT NULL AND (v_cat.root_key = ANY(p_allowed_root_keys)) THEN
    RETURN true;
  END IF;

  -- Hierarchical path_ids overlap (if plan includes L1 UUID or L2 UUID, L3 matches automatically)
  IF p_allowed_category_ids IS NOT NULL
     AND array_length(p_allowed_category_ids, 1) IS NOT NULL
     AND (v_cat.path_ids && p_allowed_category_ids) THEN
    RETURN true;
  END IF;

  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.category_matches_plan_scope(uuid, uuid[], text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.category_matches_plan_scope(uuid, uuid[], text[]) TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 7. SUBSCRIPTION PLANS HIERARCHICAL TARGETING COLUMNS + BACKFILL
-- -----------------------------------------------------------------------------
ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS applicable_category_ids uuid[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS applicable_root_keys text[] NOT NULL DEFAULT ARRAY['*'];

-- Backfill applicable_root_keys & applicable_category_ids safely for existing plan rows
DO $$
DECLARE
  v_plan record;
  v_matched_roots text[];
  v_matched_ids uuid[];
BEGIN
  FOR v_plan IN
    SELECT id, applicable_categories, applicable_subcategories, applicable_root_keys, applicable_category_ids, entitlements
    FROM public.subscription_plans
  LOOP
    -- Preserve explicit v16b values if already populated with non-wildcard keys/ids
    IF array_length(v_plan.applicable_category_ids, 1) IS NOT NULL THEN
      CONTINUE;
    END IF;

    IF v_plan.applicable_categories IS NULL
       OR array_length(v_plan.applicable_categories, 1) IS NULL
       OR ('*' = ANY(v_plan.applicable_categories)) THEN
      UPDATE public.subscription_plans
      SET applicable_root_keys = ARRAY['*']
      WHERE id = v_plan.id
        AND (applicable_root_keys IS NULL OR array_length(applicable_root_keys, 1) IS NULL);
    ELSE
      SELECT
        COALESCE(array_agg(DISTINCT c.root_key), '{}'::text[]),
        COALESCE(array_agg(DISTINCT c.id), '{}'::uuid[])
      INTO v_matched_roots, v_matched_ids
      FROM public.categories c
      WHERE c.slug = ANY(v_plan.applicable_categories)
         OR c.root_key = ANY(v_plan.applicable_categories)
         OR (v_plan.applicable_subcategories IS NOT NULL AND c.slug = ANY(v_plan.applicable_subcategories));

      UPDATE public.subscription_plans
      SET
        applicable_root_keys = CASE
          WHEN array_length(v_matched_roots, 1) IS NOT NULL THEN v_matched_roots
          ELSE ARRAY['*']
        END,
        applicable_category_ids = COALESCE(v_matched_ids, '{}'::uuid[])
      WHERE id = v_plan.id;
    END IF;
  END LOOP;
END;
$$;

-- -----------------------------------------------------------------------------
-- 8. UPGRADE `get_effective_entitlements` (HIERARCHICAL CATEGORY & ROOT SCOPE)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_effective_entitlements(
  p_user_id uuid,
  p_listing_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_now timestamptz := now();
  v_sub record;
  v_active_count integer := 0;
  v_active_plan_ids jsonb := '[]'::jsonb;
  v_latest_status text := 'none';
  v_latest_ends_at timestamptz := NULL;

  v_listing_category_id uuid := NULL;
  v_listing_root_key text := NULL;

  -- Canonical v15b + v16b entitlement accumulators (safe free-tier baseline)
  v_allowed_listing_types jsonb := '["general","public_civic"]'::jsonb;
  v_allowed_root_keys text[] := ARRAY['general','public_civic'];
  v_allowed_category_ids uuid[] := '{}'::uuid[];
  v_has_wildcard_categories boolean := false;

  v_max_listings integer := 1;
  v_max_listings_unlimited boolean := false;
  v_max_marketplace_items integer := 3;
  v_max_marketplace_unlimited boolean := false;

  v_v15b_features jsonb := jsonb_build_object(
    'pnd_dispatch', jsonb_build_object('enabled', false, 'limit', 0),
    'online_payment', jsonb_build_object('enabled', false, 'limit', NULL),
    'print_order', jsonb_build_object('enabled', false, 'limit', 0),
    'real_estate_poly', jsonb_build_object('enabled', false, 'limit', 0),
    'staffing', jsonb_build_object('enabled', false, 'limit', 0),
    'bulletins', jsonb_build_object('enabled', false, 'limit', 0),
    'bookings', jsonb_build_object('enabled', false, 'limit', 0),
    'panorama_360', jsonb_build_object('enabled', false, 'limit', 0),
    'featured_boost', jsonb_build_object('enabled', false, 'limit', 0)
  );

  v_legacy_features jsonb := jsonb_build_object(
    'directory_card', true,
    'direct_call_whatsapp', true,
    'shop_catalogue', false,
    'restaurant_menu', false,
    'print_order', false,
    'booking_slots', false,
    'hotel_rooms', false,
    'real_estate_polygon', false,
    'panorama_360', false,
    'pnd_dispatch', false,
    'staff_delegation', false,
    'featured_boost', false,
    'online_payment', false
  );
  v_legacy_limits jsonb := jsonb_build_object(
    'max_listings', 1,
    'max_marketplace_items', 3,
    'max_media_per_listing', 6,
    'max_360_panoramas', 0,
    'max_staff_members', 0,
    'max_catalogue_items', 10,
    'max_menu_items', 10,
    'max_booking_resources', 1
  );

  v_src jsonb;
  v_ov jsonb;
  v_fk text;
  v_fkeys text[] := ARRAY[
    'pnd_dispatch',
    'online_payment',
    'print_order',
    'real_estate_poly',
    'staffing',
    'bulletins',
    'bookings',
    'panorama_360',
    'featured_boost'
  ];
  v_cur_feat jsonb;
  v_in_feat jsonb;
  v_cur_enabled boolean;
  v_in_enabled boolean;
  v_cur_limit integer;
  v_in_limit integer;
  v_key text;
  v_val jsonb;
  v_tmp_int integer;
  v_plan_matches_listing boolean := true;
  v_plan_roots text[];
  v_plan_cat_ids uuid[];
BEGIN
  IF p_listing_id IS NOT NULL THEN
    SELECT l.category_id, COALESCE(l.root_key, l.listing_vertical, 'general')
      INTO v_listing_category_id, v_listing_root_key
    FROM public.listings l
    WHERE l.id = p_listing_id;
  END IF;

  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'allowed_listing_types', v_allowed_listing_types,
      'allowed_root_keys', to_jsonb(v_allowed_root_keys),
      'allowed_category_ids', to_jsonb(v_allowed_category_ids),
      'max_listings', v_max_listings,
      'max_marketplace_items', v_max_marketplace_items,
      'pnd_dispatch', v_v15b_features->'pnd_dispatch',
      'online_payment', v_v15b_features->'online_payment',
      'print_order', v_v15b_features->'print_order',
      'real_estate_poly', v_v15b_features->'real_estate_poly',
      'staffing', v_v15b_features->'staffing',
      'bulletins', v_v15b_features->'bulletins',
      'bookings', v_v15b_features->'bookings',
      'panorama_360', v_v15b_features->'panorama_360',
      'featured_boost', v_v15b_features->'featured_boost',
      'is_free_baseline', true,
      'has_active_subscription', false,
      'subscription_status', 'none',
      'ends_at', NULL,
      'is_super_admin_bypass', false,
      'active_plan_ids', '[]'::jsonb,
      'features', v_legacy_features,
      'limits', v_legacy_limits
    );
  END IF;

  SELECT lower(trim(COALESCE(p.role, '')))
    INTO v_role
  FROM public.profiles p
  WHERE p.id = p_user_id;

  IF v_role = 'super_admin' THEN
    RETURN jsonb_build_object(
      'allowed_listing_types',
      '["general","print_digital","booking_venue","shop_catalogue","real_estate","restaurant_food","hotel_stay","public_civic"]'::jsonb,
      'allowed_root_keys', '["*"]'::jsonb,
      'allowed_category_ids', '[]'::jsonb,
      'max_listings', NULL,
      'max_marketplace_items', NULL,
      'pnd_dispatch', jsonb_build_object('enabled', true, 'limit', NULL),
      'online_payment', jsonb_build_object('enabled', true, 'limit', NULL),
      'print_order', jsonb_build_object('enabled', true, 'limit', NULL),
      'real_estate_poly', jsonb_build_object('enabled', true, 'limit', NULL),
      'staffing', jsonb_build_object('enabled', true, 'limit', NULL),
      'bulletins', jsonb_build_object('enabled', true, 'limit', NULL),
      'bookings', jsonb_build_object('enabled', true, 'limit', NULL),
      'panorama_360', jsonb_build_object('enabled', true, 'limit', NULL),
      'featured_boost', jsonb_build_object('enabled', true, 'limit', NULL),
      'is_free_baseline', false,
      'has_active_subscription', true,
      'subscription_status', 'active',
      'ends_at', NULL,
      'is_super_admin_bypass', true,
      'active_plan_ids', '[]'::jsonb,
      'features', jsonb_build_object(
        'directory_card', true,
        'direct_call_whatsapp', true,
        'shop_catalogue', true,
        'restaurant_menu', true,
        'print_order', true,
        'booking_slots', true,
        'hotel_rooms', true,
        'real_estate_polygon', true,
        'panorama_360', true,
        'pnd_dispatch', true,
        'staff_delegation', true,
        'featured_boost', true,
        'online_payment', true
      ),
      'limits', jsonb_build_object(
        'max_listings', 9999,
        'max_marketplace_items', 9999,
        'max_media_per_listing', 50,
        'max_360_panoramas', 25,
        'max_staff_members', 50,
        'max_catalogue_items', 1000,
        'max_menu_items', 1000,
        'max_booking_resources', 100
      )
    );
  END IF;

  SELECT us.status, COALESCE(us.ends_at, us.expires_at)
    INTO v_latest_status, v_latest_ends_at
  FROM public.user_subscriptions us
  WHERE us.user_id = p_user_id
    AND (us.listing_id IS NULL OR (p_listing_id IS NOT NULL AND us.listing_id = p_listing_id))
  ORDER BY us.updated_at DESC NULLS LAST, us.created_at DESC NULLS LAST
  LIMIT 1;

  FOR v_sub IN
    SELECT
      us.id,
      us.plan_id,
      us.status,
      COALESCE(us.ends_at, us.expires_at) AS effective_ends_at,
      us.entitlements_snapshot,
      COALESCE(us.custom_overrides, us.entitlement_overrides, '{}'::jsonb) AS merged_overrides,
      us.override_expires_at,
      sp.entitlements AS plan_entitlements,
      sp.features AS plan_legacy_features,
      sp.limits AS plan_legacy_limits,
      COALESCE(sp.applicable_root_keys, ARRAY['*']) AS plan_root_keys,
      COALESCE(sp.applicable_category_ids, '{}'::uuid[]) AS plan_category_ids
    FROM public.user_subscriptions us
    LEFT JOIN public.subscription_plans sp ON sp.id = us.plan_id
    WHERE us.user_id = p_user_id
      AND us.status IN ('active', 'trialing')
      AND (COALESCE(us.ends_at, us.expires_at) IS NULL OR COALESCE(us.ends_at, us.expires_at) > v_now)
      AND (us.listing_id IS NULL OR (p_listing_id IS NOT NULL AND us.listing_id = p_listing_id))
    ORDER BY us.created_at ASC
  LOOP
    v_plan_roots := COALESCE(v_sub.plan_root_keys, ARRAY['*']);
    v_plan_cat_ids := COALESCE(v_sub.plan_category_ids, '{}'::uuid[]);

    -- Hierarchical scope check when evaluating a specific listing
    v_plan_matches_listing := true;
    IF p_listing_id IS NOT NULL AND v_listing_category_id IS NOT NULL THEN
      IF NOT ('*' = ANY(v_plan_roots)) THEN
        v_plan_matches_listing := public.category_matches_plan_scope(
          v_listing_category_id,
          v_plan_cat_ids,
          v_plan_roots
        );
      END IF;
    ELSIF p_listing_id IS NOT NULL AND v_listing_root_key IS NOT NULL THEN
      IF NOT ('*' = ANY(v_plan_roots)) AND array_length(v_plan_roots, 1) IS NOT NULL THEN
        v_plan_matches_listing := (v_listing_root_key = ANY(v_plan_roots));
      END IF;
    END IF;

    IF NOT v_plan_matches_listing THEN
      CONTINUE;
    END IF;

    v_active_count := v_active_count + 1;
    IF v_sub.plan_id IS NOT NULL THEN
      v_active_plan_ids := v_active_plan_ids || to_jsonb(v_sub.plan_id);
    END IF;

    -- Accumulate hierarchical category & root scopes across active plans
    IF '*' = ANY(v_plan_roots) THEN
      v_has_wildcard_categories := true;
    ELSE
      SELECT COALESCE(array_agg(DISTINCT rk), v_allowed_root_keys)
        INTO v_allowed_root_keys
      FROM unnest(v_allowed_root_keys || v_plan_roots) AS rk;
    END IF;

    IF array_length(v_plan_cat_ids, 1) IS NOT NULL THEN
      SELECT COALESCE(array_agg(DISTINCT cid), v_allowed_category_ids)
        INTO v_allowed_category_ids
      FROM unnest(v_allowed_category_ids || v_plan_cat_ids) AS cid;
    END IF;

    v_src := COALESCE(NULLIF(v_sub.entitlements_snapshot, '{}'::jsonb), v_sub.plan_entitlements, '{}'::jsonb);

    IF jsonb_typeof(v_src->'allowed_listing_types') = 'array' THEN
      SELECT COALESCE(jsonb_agg(DISTINCT elem), v_allowed_listing_types)
        INTO v_allowed_listing_types
      FROM (
        SELECT jsonb_array_elements_text(v_allowed_listing_types) AS elem
        UNION
        SELECT jsonb_array_elements_text(v_src->'allowed_listing_types') AS elem
      ) u;
    END IF;

    IF v_src ? 'max_listings' THEN
      IF jsonb_typeof(v_src->'max_listings') = 'null' THEN
        v_max_listings_unlimited := true;
      ELSIF jsonb_typeof(v_src->'max_listings') = 'number' THEN
        v_tmp_int := (v_src->>'max_listings')::integer;
        IF v_tmp_int > v_max_listings THEN v_max_listings := v_tmp_int; END IF;
      END IF;
    END IF;

    IF v_src ? 'max_marketplace_items' THEN
      IF jsonb_typeof(v_src->'max_marketplace_items') = 'null' THEN
        v_max_marketplace_unlimited := true;
      ELSIF jsonb_typeof(v_src->'max_marketplace_items') = 'number' THEN
        v_tmp_int := (v_src->>'max_marketplace_items')::integer;
        IF v_tmp_int > v_max_marketplace_items THEN v_max_marketplace_items := v_tmp_int; END IF;
      END IF;
    END IF;

    FOREACH v_fk IN ARRAY v_fkeys LOOP
      IF v_src ? v_fk AND jsonb_typeof(v_src->v_fk) = 'object' THEN
        v_cur_feat := v_v15b_features->v_fk;
        v_in_feat := v_src->v_fk;
        v_cur_enabled := COALESCE((v_cur_feat->>'enabled')::boolean, false);
        v_in_enabled := COALESCE((v_in_feat->>'enabled')::boolean, false);

        IF v_in_enabled THEN
          v_cur_enabled := true;
        END IF;

        IF v_cur_feat->>'limit' IS NULL AND v_cur_enabled AND v_cur_feat ? 'limit' THEN
          v_cur_limit := NULL;
        ELSIF v_in_enabled AND (v_in_feat ? 'limit') AND jsonb_typeof(v_in_feat->'limit') = 'null' THEN
          v_cur_limit := NULL;
        ELSIF jsonb_typeof(v_in_feat->'limit') = 'number' THEN
          v_in_limit := (v_in_feat->>'limit')::integer;
          IF v_cur_feat->>'limit' IS NULL THEN
            v_cur_limit := v_in_limit;
          ELSE
            v_cur_limit := GREATEST((v_cur_feat->>'limit')::integer, v_in_limit);
          END IF;
        ELSE
          IF v_cur_feat->>'limit' IS NULL THEN
            v_cur_limit := NULL;
          ELSE
            v_cur_limit := (v_cur_feat->>'limit')::integer;
          END IF;
        END IF;

        v_v15b_features := jsonb_set(
          v_v15b_features,
          ARRAY[v_fk],
          jsonb_build_object('enabled', v_cur_enabled, 'limit', to_jsonb(v_cur_limit)),
          true
        );
      END IF;
    END LOOP;

    -- Legacy v12c features/limits union
    IF jsonb_typeof(v_sub.plan_legacy_features) = 'object' THEN
      FOR v_key, v_val IN SELECT * FROM jsonb_each(v_sub.plan_legacy_features) LOOP
        IF jsonb_typeof(v_val) = 'boolean' AND (v_val::text = 'true') THEN
          v_legacy_features := jsonb_set(v_legacy_features, ARRAY[v_key], 'true'::jsonb, true);
        END IF;
      END LOOP;
    END IF;

    IF jsonb_typeof(v_sub.plan_legacy_limits) = 'object' THEN
      FOR v_key, v_val IN SELECT * FROM jsonb_each(v_sub.plan_legacy_limits) LOOP
        IF jsonb_typeof(v_val) = 'number' THEN
          v_tmp_int := GREATEST(COALESCE((v_legacy_limits->>v_key)::integer, 0), (v_val::text)::integer);
          v_legacy_limits := jsonb_set(v_legacy_limits, ARRAY[v_key], to_jsonb(v_tmp_int), true);
        END IF;
      END LOOP;
    END IF;

    -- 2) Apply custom_overrides if not expired
    IF jsonb_typeof(v_sub.merged_overrides) = 'object'
       AND v_sub.merged_overrides <> '{}'::jsonb
       AND (v_sub.override_expires_at IS NULL OR v_sub.override_expires_at > v_now) THEN
      v_ov := v_sub.merged_overrides;

      IF jsonb_typeof(v_ov->'allowed_listing_types') = 'array' THEN
        v_allowed_listing_types := v_ov->'allowed_listing_types';
      END IF;

      IF v_ov ? 'max_listings' THEN
        IF jsonb_typeof(v_ov->'max_listings') = 'null' THEN
          v_max_listings_unlimited := true;
        ELSIF jsonb_typeof(v_ov->'max_listings') = 'number' THEN
          v_max_listings_unlimited := false;
          v_max_listings := (v_ov->>'max_listings')::integer;
        END IF;
      END IF;

      IF v_ov ? 'max_marketplace_items' THEN
        IF jsonb_typeof(v_ov->'max_marketplace_items') = 'null' THEN
          v_max_marketplace_unlimited := true;
        ELSIF jsonb_typeof(v_ov->'max_marketplace_items') = 'number' THEN
          v_max_marketplace_unlimited := false;
          v_max_marketplace_items := (v_ov->>'max_marketplace_items')::integer;
        END IF;
      END IF;

      FOREACH v_fk IN ARRAY v_fkeys LOOP
        IF v_ov ? v_fk THEN
          IF jsonb_typeof(v_ov->v_fk) = 'object' THEN
            v_cur_feat := v_v15b_features->v_fk;
            v_in_feat := v_ov->v_fk;
            v_v15b_features := jsonb_set(
              v_v15b_features,
              ARRAY[v_fk],
              jsonb_build_object(
                'enabled', COALESCE((v_in_feat->>'enabled')::boolean, (v_cur_feat->>'enabled')::boolean, false),
                'limit', CASE
                  WHEN v_in_feat ? 'limit' THEN v_in_feat->'limit'
                  ELSE v_cur_feat->'limit'
                END
              ),
              true
            );
          ELSIF jsonb_typeof(v_ov->v_fk) = 'boolean' THEN
            v_cur_feat := v_v15b_features->v_fk;
            v_v15b_features := jsonb_set(
              v_v15b_features,
              ARRAY[v_fk],
              jsonb_build_object('enabled', (v_ov->>v_fk)::boolean, 'limit', v_cur_feat->'limit'),
              true
            );
          END IF;
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  -- Sync legacy feature/limit flags from resolved v15b features
  v_legacy_features := v_legacy_features || jsonb_build_object(
    'online_payment', COALESCE((v_v15b_features->'online_payment'->>'enabled')::boolean, false),
    'print_order', COALESCE((v_v15b_features->'print_order'->>'enabled')::boolean, false),
    'real_estate_polygon', COALESCE((v_v15b_features->'real_estate_poly'->>'enabled')::boolean, false),
    'pnd_dispatch', COALESCE((v_v15b_features->'pnd_dispatch'->>'enabled')::boolean, false),
    'staff_delegation', COALESCE((v_v15b_features->'staffing'->>'enabled')::boolean, false),
    'booking_slots', COALESCE((v_v15b_features->'bookings'->>'enabled')::boolean, false),
    'hotel_rooms', COALESCE((v_v15b_features->'bookings'->>'enabled')::boolean, false),
    'panorama_360', COALESCE((v_v15b_features->'panorama_360'->>'enabled')::boolean, false),
    'featured_boost', COALESCE((v_v15b_features->'featured_boost'->>'enabled')::boolean, false)
  );

  v_legacy_limits := v_legacy_limits || jsonb_build_object(
    'max_listings', CASE WHEN v_max_listings_unlimited THEN 9999 ELSE v_max_listings END,
    'max_marketplace_items', CASE WHEN v_max_marketplace_unlimited THEN 9999 ELSE v_max_marketplace_items END
  );

  RETURN jsonb_build_object(
    'allowed_listing_types', v_allowed_listing_types,
    'allowed_root_keys', CASE
      WHEN v_has_wildcard_categories THEN '["*"]'::jsonb
      ELSE to_jsonb(v_allowed_root_keys)
    END,
    'allowed_category_ids', to_jsonb(v_allowed_category_ids),
    'max_listings', CASE WHEN v_max_listings_unlimited THEN NULL ELSE to_jsonb(v_max_listings) END,
    'max_marketplace_items', CASE WHEN v_max_marketplace_unlimited THEN NULL ELSE to_jsonb(v_max_marketplace_items) END,
    'pnd_dispatch', v_v15b_features->'pnd_dispatch',
    'online_payment', v_v15b_features->'online_payment',
    'print_order', v_v15b_features->'print_order',
    'real_estate_poly', v_v15b_features->'real_estate_poly',
    'staffing', v_v15b_features->'staffing',
    'bulletins', v_v15b_features->'bulletins',
    'bookings', v_v15b_features->'bookings',
    'panorama_360', v_v15b_features->'panorama_360',
    'featured_boost', v_v15b_features->'featured_boost',
    'is_free_baseline', (v_active_count = 0),
    'has_active_subscription', (v_active_count > 0),
    'subscription_status', CASE WHEN v_active_count > 0 THEN 'active' ELSE COALESCE(v_latest_status, 'none') END,
    'ends_at', v_latest_ends_at,
    'is_super_admin_bypass', false,
    'active_plan_ids', v_active_plan_ids,
    'features', v_legacy_features,
    'limits', v_legacy_limits
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_effective_entitlements(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_effective_entitlements(uuid, uuid) TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 9. UPGRADE `resolve_effective_payment_methods` (ROOT-ANCHORED INHERITANCE)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_effective_payment_methods(
  p_scope_key text,
  p_listing_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_scope text := NULLIF(lower(trim(COALESCE(p_scope_key, ''))), '');
  v_listing_owner_id uuid := NULL;
  v_listing_root_key text := NULL;
  v_listing_payment_mode text := NULL;
  v_cat_resolved_root text := NULL;

  v_policy record;
  v_policy_found boolean := false;
  v_sys_upi boolean := false;
  v_sys_manual boolean := true;
  v_escrow_required boolean := false;
  v_allow_override boolean := true;

  v_entitlements jsonb := NULL;
  v_sub_online_payment boolean := true;

  v_upi_allowed boolean := false;
  v_manual_allowed boolean := false;
  v_upi_reason text := NULL;
  v_manual_reason text := NULL;
  v_allowed_methods jsonb := '[]'::jsonb;
BEGIN
  IF p_listing_id IS NOT NULL THEN
    SELECT
      l.owner_id,
      COALESCE(NULLIF(lower(trim(l.root_key)), ''), c.root_key, NULLIF(lower(trim(l.listing_vertical)), ''), 'general'),
      COALESCE(l.payment_mode, 'manual')
      INTO v_listing_owner_id, v_listing_root_key, v_listing_payment_mode
    FROM public.listings l
    LEFT JOIN public.categories c ON c.id = l.category_id
    WHERE l.id = p_listing_id;
  END IF;

  IF v_scope IS NULL THEN
    v_scope := COALESCE(v_listing_root_key, 'general');
  END IF;

  -- LAYER 1: System Feature / Root-Anchored Listing Type Policy
  SELECT *
    INTO v_policy
  FROM public.payment_feature_policies p
  WHERE p.scope_key = v_scope;

  -- If caller passed an L2/L3 category slug or UUID, resolve upward to its fixed L1 root_key
  IF NOT FOUND THEN
    SELECT c.root_key
      INTO v_cat_resolved_root
    FROM public.categories c
    WHERE lower(c.slug) = v_scope
       OR c.id::text = v_scope
    LIMIT 1;

    IF v_cat_resolved_root IS NOT NULL THEN
      v_scope := v_cat_resolved_root;
      SELECT *
        INTO v_policy
      FROM public.payment_feature_policies p
      WHERE p.scope_key = v_scope;
    ELSIF v_listing_root_key IS NOT NULL THEN
      v_scope := v_listing_root_key;
      SELECT *
        INTO v_policy
      FROM public.payment_feature_policies p
      WHERE p.scope_key = v_scope;
    END IF;
  END IF;

  IF FOUND THEN
    v_policy_found := true;
    v_sys_upi := v_policy.upi_enabled;
    v_sys_manual := v_policy.manual_enabled;
    v_escrow_required := v_policy.escrow_required;
    v_allow_override := v_policy.allow_listing_override;
  END IF;

  -- LAYER 2: Owner Subscription Entitlement (`online_payment.enabled`)
  IF v_listing_owner_id IS NOT NULL THEN
    v_entitlements := public.get_effective_entitlements(v_listing_owner_id, p_listing_id);
    v_sub_online_payment := COALESCE((v_entitlements->'online_payment'->>'enabled')::boolean, false);
  ELSE
    v_sub_online_payment := true;
  END IF;

  -- Evaluate UPI across Layers 1 -> 2 -> 3
  IF NOT v_sys_upi THEN
    v_upi_allowed := false;
    v_upi_reason := 'disabled_by_system_policy';
  ELSIF NOT v_sub_online_payment THEN
    v_upi_allowed := false;
    v_upi_reason := 'blocked_by_owner_subscription';
  ELSIF p_listing_id IS NOT NULL AND v_allow_override AND v_listing_payment_mode NOT IN ('upi', 'both') THEN
    v_upi_allowed := false;
    v_upi_reason := 'disabled_by_listing_mode';
  ELSE
    v_upi_allowed := true;
  END IF;

  -- Evaluate Manual across Layers 1 -> 3
  IF NOT v_sys_manual THEN
    v_manual_allowed := false;
    v_manual_reason := 'disabled_by_system_policy';
  ELSIF p_listing_id IS NOT NULL AND v_allow_override AND v_listing_payment_mode NOT IN ('manual', 'both') THEN
    v_manual_allowed := false;
    v_manual_reason := 'disabled_by_listing_mode';
  ELSE
    v_manual_allowed := true;
  END IF;

  IF v_upi_allowed THEN
    v_allowed_methods := v_allowed_methods || '"upi"'::jsonb;
  END IF;
  IF v_manual_allowed THEN
    v_allowed_methods := v_allowed_methods || '"manual"'::jsonb;
  END IF;

  RETURN jsonb_build_object(
    'scope_key', v_scope,
    'resolved_root_key', COALESCE(v_listing_root_key, v_cat_resolved_root, v_scope),
    'listing_id', p_listing_id,
    'policy_found', v_policy_found,
    'allowed_methods', v_allowed_methods,
    'upi_allowed', v_upi_allowed,
    'manual_allowed', v_manual_allowed,
    'escrow_required', v_escrow_required,
    'allow_listing_override', v_allow_override,
    'listing_payment_mode', v_listing_payment_mode,
    'blocked_reasons', jsonb_build_object(
      'upi', v_upi_reason,
      'manual', v_manual_reason
    ),
    'layers', jsonb_build_object(
      'system', jsonb_build_object(
        'upi_enabled', v_sys_upi,
        'manual_enabled', v_sys_manual,
        'escrow_required', v_escrow_required,
        'allow_listing_override', v_allow_override
      ),
      'subscription', jsonb_build_object(
        'owner_id', v_listing_owner_id,
        'online_payment_enabled', v_sub_online_payment
      ),
      'listing', jsonb_build_object(
        'payment_mode', v_listing_payment_mode
      )
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.resolve_effective_payment_methods(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_effective_payment_methods(text, uuid) TO anon, authenticated, service_role;
