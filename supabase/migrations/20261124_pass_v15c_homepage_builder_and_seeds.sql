-- =============================================================================
-- DD oodle — Pass v15c: Superadmin Homepage Builder, Audit Triggers & Seeds
-- =============================================================================
-- Order of execution:
--   1) 20261124_pass_v15a_superadmin_foundation.sql
--   2) 20261124_pass_v15b_subscriptions_and_payments.sql
--   3) 20261124_pass_v15c_homepage_builder_and_seeds.sql  (this file)
--
-- Scope:
--   1. Sanity-check v15b bidirectional sync triggers (BEFORE INSERT OR UPDATE).
--   2. Add featured_order + is_featured support to public.listings + audit log.
--   3. Harden public.vehicle_types write RLS strictly to super_admin + audit log,
--      and verify super_admin write RLS + audit logs on homepage_items,
--      popular_localities, and categories.
--   4. Idempotently seed 15 Shortcut Grid cards, 7 Quick Jump chips, 2 Featured
--      Banners into public.homepage_items, and Churachandpur hubs into
--      public.popular_localities.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. SANITY-CHECK v15b SYNC TRIGGERS (MUST BE BEFORE INSERT OR UPDATE)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_plans_before boolean;
  v_subs_before boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'subscription_plans'
      AND t.tgname = 'trg_subscription_plans_v15b_sync'
      AND NOT t.tgisinternal
      AND (t.tgtype & 2) = 2 -- BEFORE trigger bit
  ) INTO v_plans_before;

  IF NOT v_plans_before AND to_regprocedure('public.sync_subscription_plans_v15b()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_subscription_plans_v15b_sync ON public.subscription_plans;
    CREATE TRIGGER trg_subscription_plans_v15b_sync
      BEFORE INSERT OR UPDATE ON public.subscription_plans
      FOR EACH ROW
      EXECUTE FUNCTION public.sync_subscription_plans_v15b();
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'user_subscriptions'
      AND t.tgname = 'trg_user_subscriptions_v15b_sync'
      AND NOT t.tgisinternal
      AND (t.tgtype & 2) = 2 -- BEFORE trigger bit
  ) INTO v_subs_before;

  IF NOT v_subs_before AND to_regprocedure('public.sync_user_subscriptions_v15b()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_user_subscriptions_v15b_sync ON public.user_subscriptions;
    CREATE TRIGGER trg_user_subscriptions_v15b_sync
      BEFORE INSERT OR UPDATE ON public.user_subscriptions
      FOR EACH ROW
      EXECUTE FUNCTION public.sync_user_subscriptions_v15b();
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- 2. FEATURED ORDERING SUPPORT ON `public.listings`
-- -----------------------------------------------------------------------------
ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS featured_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_featured boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_listings_featured_order
  ON public.listings (status, is_featured DESC, featured_order ASC, rating DESC);

-- Audit Featured Places pin/unpin/reorder mutations into immutable public.audit_logs
CREATE OR REPLACE FUNCTION public.audit_listings_featured_v15c()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (NEW.featured_order IS DISTINCT FROM OLD.featured_order)
     OR (NEW.is_featured IS DISTINCT FROM OLD.is_featured) THEN
    PERFORM public.write_audit_log(
      'listings_featured_update',
      'listings',
      NEW.id::text,
      jsonb_build_object(
        'title', NEW.title,
        'old_is_featured', OLD.is_featured,
        'new_is_featured', NEW.is_featured,
        'old_featured_order', OLD.featured_order,
        'new_featured_order', NEW.featured_order
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_listings_featured_v15c ON public.listings;
CREATE TRIGGER trg_audit_listings_featured_v15c
  AFTER UPDATE OF featured_order, is_featured ON public.listings
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_listings_featured_v15c();

-- -----------------------------------------------------------------------------
-- 3. STRICT `super_admin` WRITE RLS & AUDIT TRIGGERS ON CONFIG + PnD FLEET RATES
-- -----------------------------------------------------------------------------

-- 3A. Canonical 5-tier Pick N Drop fleet rates (`public.vehicle_types`)
ALTER TABLE public.vehicle_types ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  v_pol record;
BEGIN
  FOR v_pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'vehicle_types'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.vehicle_types;', v_pol.policyname);
  END LOOP;
END;
$$;

CREATE POLICY vehicle_types_public_select_v15c
  ON public.vehicle_types
  FOR SELECT
  USING (is_active = true OR public.is_super_admin());

CREATE POLICY vehicle_types_superadmin_insert_v15c
  ON public.vehicle_types
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_super_admin());

CREATE POLICY vehicle_types_superadmin_update_v15c
  ON public.vehicle_types
  FOR UPDATE
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY vehicle_types_superadmin_delete_v15c
  ON public.vehicle_types
  FOR DELETE
  TO authenticated
  USING (public.is_super_admin());

DROP TRIGGER IF EXISTS trg_audit_vehicle_types_v15c ON public.vehicle_types;
CREATE TRIGGER trg_audit_vehicle_types_v15c
  AFTER INSERT OR UPDATE OR DELETE ON public.vehicle_types
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_superadmin_config_change();

-- 3B. Re-verify audit triggers on homepage_items, popular_localities, and categories
DROP TRIGGER IF EXISTS trg_audit_homepage_items_changes ON public.homepage_items;
CREATE TRIGGER trg_audit_homepage_items_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.homepage_items
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_superadmin_config_change();

DROP TRIGGER IF EXISTS trg_audit_popular_localities_changes ON public.popular_localities;
CREATE TRIGGER trg_audit_popular_localities_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.popular_localities
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_superadmin_config_change();

DROP TRIGGER IF EXISTS trg_audit_categories_changes ON public.categories;
CREATE TRIGGER trg_audit_categories_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.categories
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_superadmin_config_change();

-- Ensure strict super_admin write policies on categories (idempotent check)
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  v_pol record;
BEGIN
  FOR v_pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'categories'
      AND cmd IN ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      AND policyname NOT LIKE '%superadmin%'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.categories;', v_pol.policyname);
  END LOOP;
END;
$$;

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
  USING (public.is_super_admin());

-- -----------------------------------------------------------------------------
-- 4. DETERMINISTIC `item_key` & IDEMPOTENT DEFAULT SEEDS FOR `homepage_items`
-- -----------------------------------------------------------------------------
ALTER TABLE public.homepage_items
  ADD COLUMN IF NOT EXISTS item_key text;

CREATE UNIQUE INDEX IF NOT EXISTS idx_homepage_items_item_key
  ON public.homepage_items (item_key)
  WHERE item_key IS NOT NULL;

-- 4A. 15 Canonical Shortcut Grid Cards (`section = 'shortcut_grid'`)
INSERT INTO public.homepage_items (
  item_key,
  section,
  title,
  subtitle,
  container_style,
  icon_key,
  accent_color,
  route_key,
  query_params,
  sort_order,
  is_enabled
)
VALUES
  (
    'shortcut_print_digital',
    'shortcut_grid',
    'Print & Digital',
    'Upload PDFs & order prints',
    'card',
    'printer',
    '#2563EB',
    'explore',
    '{"vertical": "print_digital"}'::jsonb,
    10,
    true
  ),
  (
    'shortcut_pick_n_drop',
    'shortcut_grid',
    'Pick N Drop',
    'Parcel, taxi & LPG delivery',
    'card',
    'truck',
    '#EA580C',
    'explore',
    '{"mode": "pick_n_drop"}'::jsonb,
    20,
    true
  ),
  (
    'shortcut_food_restaurants',
    'shortcut_grid',
    'Food & Cafes',
    'Local kitchens & delivery',
    'card',
    'utensils',
    '#DC2626',
    'explore',
    '{"vertical": "restaurant_food"}'::jsonb,
    30,
    true
  ),
  (
    'shortcut_shops_groceries',
    'shortcut_grid',
    'Shops & Kirana',
    'Verified local retail stores',
    'card',
    'store',
    '#059669',
    'explore',
    '{"vertical": "shop_retail"}'::jsonb,
    40,
    true
  ),
  (
    'shortcut_marketplace',
    'shortcut_grid',
    'Marketplace',
    'Live shop catalogues & stock',
    'card',
    'shopping-bag',
    '#0284C7',
    'marketplace',
    '{}'::jsonb,
    50,
    true
  ),
  (
    'shortcut_vehicles_charters',
    'shortcut_grid',
    'Vehicles & Rides',
    'Taxis, SUVs & inter-hub seats',
    'card',
    'car',
    '#4F46E5',
    'vehicles',
    '{}'::jsonb,
    60,
    true
  ),
  (
    'shortcut_turfs_venues',
    'shortcut_grid',
    'Turfs & Venues',
    'Hourly futsal, halls & courts',
    'card',
    'trophy',
    '#16A34A',
    'explore',
    '{"vertical": "booking_venue"}'::jsonb,
    70,
    true
  ),
  (
    'shortcut_hotels_stays',
    'shortcut_grid',
    'Hotels & Stays',
    'Guest houses & homestays',
    'card',
    'bed-double',
    '#7C3AED',
    'explore',
    '{"vertical": "hotel_stay"}'::jsonb,
    80,
    true
  ),
  (
    'shortcut_real_estate',
    'shortcut_grid',
    'Real Estate',
    'Land plots, houses & rentals',
    'card',
    'home',
    '#D97706',
    'explore',
    '{"vertical": "real_estate"}'::jsonb,
    90,
    true
  ),
  (
    'shortcut_civic_directory',
    'shortcut_grid',
    'Civic & Help',
    'Hospitals, police & offices',
    'card',
    'shield-check',
    '#0F766E',
    'civic',
    '{}'::jsonb,
    100,
    true
  ),
  (
    'shortcut_bulletin_jobs',
    'shortcut_grid',
    'Bulletin & Jobs',
    'Notices, hiring & local events',
    'card',
    'megaphone',
    '#E11D48',
    'bulletin',
    '{}'::jsonb,
    110,
    true
  ),
  (
    'shortcut_clinics_health',
    'shortcut_grid',
    'Clinics & Meds',
    'Pharmacies & doctors nearby',
    'card',
    'stethoscope',
    '#0D9488',
    'explore',
    '{"vertical": "civic_public", "q": "clinic"}'::jsonb,
    120,
    true
  ),
  (
    'shortcut_local_services',
    'shortcut_grid',
    'Local Services',
    'Repairs, salons & technicians',
    'card',
    'wrench',
    '#64748B',
    'explore',
    '{"vertical": "general_service"}'::jsonb,
    130,
    true
  ),
  (
    'shortcut_lpg_refill',
    'shortcut_grid',
    'LPG Cylinder',
    'Doorstep gas swap & refill',
    'card',
    'flame',
    '#EA580C',
    'explore',
    '{"mode": "pick_n_drop", "serviceType": "gas"}'::jsonb,
    140,
    true
  ),
  (
    'shortcut_become_partner',
    'shortcut_grid',
    'List Business',
    'Join as shop, driver or host',
    'tinted',
    'sparkles',
    '#2563EB',
    'onboarding',
    '{"track": "business"}'::jsonb,
    150,
    true
  )
ON CONFLICT (item_key) WHERE item_key IS NOT NULL DO NOTHING;

-- 4B. 7 Canonical Quick Jump Chips (`section = 'quick_jump'`)
INSERT INTO public.homepage_items (
  item_key,
  section,
  title,
  subtitle,
  container_style,
  icon_key,
  accent_color,
  route_key,
  query_params,
  sort_order,
  is_enabled
)
VALUES
  (
    'qj_open_restaurants',
    'quick_jump',
    'Open Food Spots',
    'Restaurants with home delivery',
    'pill',
    'utensils',
    '#DC2626',
    'explore',
    '{"vertical": "restaurant_food", "openNow": "true"}'::jsonb,
    10,
    true
  ),
  (
    'qj_rent_houses',
    'quick_jump',
    'Houses for Rent',
    'Verified residential rentals',
    'pill',
    'home',
    '#D97706',
    'explore',
    '{"vertical": "real_estate", "attr": "for_rent"}'::jsonb,
    20,
    true
  ),
  (
    'qj_verified_print',
    'quick_jump',
    'Instant Print Shops',
    'Online PDF print & binding',
    'pill',
    'printer',
    '#2563EB',
    'explore',
    '{"vertical": "print_digital", "verified": "true"}'::jsonb,
    30,
    true
  ),
  (
    'qj_futsal_turfs',
    'quick_jump',
    'Futsal & Turfs',
    'Book hourly sports slots',
    'pill',
    'trophy',
    '#16A34A',
    'explore',
    '{"vertical": "booking_venue", "attr": "hourly_turf"}'::jsonb,
    40,
    true
  ),
  (
    'qj_send_parcel',
    'quick_jump',
    'Send Parcel Now',
    'Escrow-protected local rider',
    'pill',
    'package',
    '#EA580C',
    'explore',
    '{"mode": "pick_n_drop", "serviceType": "parcel"}'::jsonb,
    50,
    true
  ),
  (
    'qj_emergency_helplines',
    'quick_jump',
    '24x7 Helplines',
    'Police, hospital & ambulance',
    'pill',
    'phone-call',
    '#0F766E',
    'civic',
    '{"tab": "helplines"}'::jsonb,
    60,
    true
  ),
  (
    'qj_bulletin_plans',
    'quick_jump',
    'Post on Bulletin',
    'Jobs, notices & promo plans',
    'pill',
    'megaphone',
    '#E11D48',
    'bulletin',
    '{"plans": "1"}'::jsonb,
    70,
    true
  )
ON CONFLICT (item_key) WHERE item_key IS NOT NULL DO NOTHING;

-- 4C. 2 Canonical Featured Banners (`section = 'featured_banner'`)
INSERT INTO public.homepage_items (
  item_key,
  section,
  title,
  subtitle,
  container_style,
  icon_key,
  accent_color,
  route_key,
  query_params,
  sort_order,
  is_enabled
)
VALUES
  (
    'banner_official_print',
    'featured_banner',
    'Official Print & Digital Hub — 48h Private Vault',
    'Upload PDFs or phone photos, preview instant pricing, and collect with OTP or doorstep delivery.',
    'banner',
    'printer',
    '#2563EB',
    'explore',
    '{"vertical": "print_digital"}'::jsonb,
    10,
    true
  ),
  (
    'banner_escrow_pnd',
    'featured_banner',
    'Pick N Drop Escrow — 5 Verified Fleet Tiers',
    'From Cycle Rickshaw & Scooty to Bolero Pickup with transparent per-km rates and asymmetric OTP handovers.',
    'banner',
    'truck',
    '#059669',
    'explore',
    '{"mode": "pick_n_drop"}'::jsonb,
    20,
    true
  )
ON CONFLICT (item_key) WHERE item_key IS NOT NULL DO NOTHING;

-- -----------------------------------------------------------------------------
-- 5. IDEMPOTENT CHURACHANDPUR SEEDS FOR `public.popular_localities`
-- -----------------------------------------------------------------------------
INSERT INTO public.popular_localities (
  name,
  slug,
  icon_key,
  lat,
  lng,
  default_zoom,
  sort_order,
  is_enabled
)
VALUES
  ('Lamka', 'lamka-town', 'map-pin', 24.3335, 93.6946, 15, 10, true),
  ('Tuibong', 'tuibong', 'building-2', 24.3510, 93.6968, 15, 20, true),
  ('New Lamka', 'new-lamka', 'home', 24.3248, 93.6865, 15, 30, true),
  ('Rengkai', 'rengkai', 'landmark', 24.3292, 93.7042, 15, 40, true),
  ('Zenhang Lamka', 'zenhang-lamka', 'compass', 24.3372, 93.6880, 15, 50, true),
  ('Churachandpur Bazar', 'churachandpur-bazar', 'store', 24.3338, 93.6962, 16, 60, true)
ON CONFLICT (slug) DO NOTHING;

COMMIT;
