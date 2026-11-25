-- =============================================================================
-- DD oodle — Pass v15d: Homepage Containers (Interactive Tabs) & Backfill Seeds
-- =============================================================================
-- Order of execution:
--   1) 20261124_pass_v15a_superadmin_foundation.sql
--   2) 20261124_pass_v15b_subscriptions_and_payments.sql
--   3) 20261124_pass_v15c_homepage_builder_and_seeds.sql
--   4) 20261125_pass_v15d_homepage_containers.sql  (this file)
--
-- Scope:
--   1. Create public.homepage_containers with public SELECT (enabled rows),
--      super_admin-only writes, updated_at maintenance, and immutable audit_logs
--      trigger.
--   2. Add container_id FK (ON DELETE SET NULL) to public.homepage_items while
--      preserving existing section column for full backward compatibility.
--   3. Idempotently seed default Shortcut Grid tabs + Quick Jumps container and
--      backfill existing homepage_items.container_id rows so the live homepage
--      and builder never load blank.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. CREATE `public.homepage_containers`
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.homepage_containers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  title text NOT NULL,
  subtitle text,
  icon_key text NOT NULL DEFAULT 'layout-grid',
  accent_color text NOT NULL DEFAULT '#2563EB',
  section_group text NOT NULL DEFAULT 'shortcut_grid'
    CHECK (section_group IN ('shortcut_grid', 'quick_jump')),
  sort_order integer NOT NULL DEFAULT 0,
  is_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_homepage_containers_group_order
  ON public.homepage_containers (section_group, is_enabled, sort_order ASC);

-- Keep updated_at fresh automatically
CREATE OR REPLACE FUNCTION public.touch_homepage_containers_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_homepage_containers_updated_at ON public.homepage_containers;
CREATE TRIGGER trg_homepage_containers_updated_at
  BEFORE UPDATE ON public.homepage_containers
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_homepage_containers_updated_at();

-- Enable strict Row Level Security
ALTER TABLE public.homepage_containers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS homepage_containers_public_select_v15d ON public.homepage_containers;
CREATE POLICY homepage_containers_public_select_v15d
  ON public.homepage_containers
  FOR SELECT
  USING (is_enabled = true OR public.is_super_admin());

DROP POLICY IF EXISTS homepage_containers_superadmin_insert_v15d ON public.homepage_containers;
CREATE POLICY homepage_containers_superadmin_insert_v15d
  ON public.homepage_containers
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS homepage_containers_superadmin_update_v15d ON public.homepage_containers;
CREATE POLICY homepage_containers_superadmin_update_v15d
  ON public.homepage_containers
  FOR UPDATE
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS homepage_containers_superadmin_delete_v15d ON public.homepage_containers;
CREATE POLICY homepage_containers_superadmin_delete_v15d
  ON public.homepage_containers
  FOR DELETE
  TO authenticated
  USING (public.is_super_admin());

-- Attach immutable audit log trigger (uses canonical v15a function)
DROP TRIGGER IF EXISTS trg_audit_homepage_containers_v15d ON public.homepage_containers;
CREATE TRIGGER trg_audit_homepage_containers_v15d
  AFTER INSERT OR UPDATE OR DELETE ON public.homepage_containers
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_superadmin_config_change();

-- -----------------------------------------------------------------------------
-- 2. LINK `public.homepage_items.container_id` -> `public.homepage_containers`
-- -----------------------------------------------------------------------------
ALTER TABLE public.homepage_items
  ADD COLUMN IF NOT EXISTS container_id uuid
    REFERENCES public.homepage_containers(id)
    ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_homepage_items_container_order
  ON public.homepage_items (container_id, sort_order ASC);

-- -----------------------------------------------------------------------------
-- 3. IDEMPOTENT DEFAULT CONTAINER SEEDS
-- -----------------------------------------------------------------------------
INSERT INTO public.homepage_containers (
  slug,
  title,
  subtitle,
  icon_key,
  accent_color,
  section_group,
  sort_order,
  is_enabled
)
VALUES
  (
    'all-services',
    'All Services',
    'Complete district launchpad across every vertical',
    'layout-grid',
    '#2563EB',
    'shortcut_grid',
    10,
    true
  ),
  (
    'local-commerce',
    'Local Commerce',
    'Print hubs, food kitchens, daily kirana & marketplace',
    'shopping-bag',
    '#059669',
    'shortcut_grid',
    20,
    true
  ),
  (
    'logistics-rides',
    'Logistics & Rides',
    'Pick N Drop courier, LPG swap & inter-hub charters',
    'truck',
    '#EA580C',
    'shortcut_grid',
    30,
    true
  ),
  (
    'stays-venues',
    'Stays & Property',
    'Turfs, community halls, hotels & real estate',
    'building-2',
    '#7C3AED',
    'shortcut_grid',
    40,
    true
  ),
  (
    'civic-essential',
    'Civic & Essential',
    'Hospitals, 24x7 helplines, notices & local services',
    'shield-check',
    '#0F766E',
    'shortcut_grid',
    50,
    true
  ),
  (
    'quick-jumps',
    'Quick Jumps',
    '1-tap filtered shortcuts below the launchpad',
    'sparkles',
    '#2563EB',
    'quick_jump',
    10,
    true
  )
ON CONFLICT (slug) DO NOTHING;

-- -----------------------------------------------------------------------------
-- 4. BACKFILL `homepage_items.container_id` FOR EXISTING ROWS (IDEMPOTENT)
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_commerce_id uuid;
  v_logistics_id uuid;
  v_stays_id uuid;
  v_civic_id uuid;
  v_quick_jump_id uuid;
BEGIN
  SELECT id INTO v_commerce_id  FROM public.homepage_containers WHERE slug = 'local-commerce' LIMIT 1;
  SELECT id INTO v_logistics_id FROM public.homepage_containers WHERE slug = 'logistics-rides' LIMIT 1;
  SELECT id INTO v_stays_id     FROM public.homepage_containers WHERE slug = 'stays-venues' LIMIT 1;
  SELECT id INTO v_civic_id     FROM public.homepage_containers WHERE slug = 'civic-essential' LIMIT 1;
  SELECT id INTO v_quick_jump_id FROM public.homepage_containers WHERE slug = 'quick-jumps' LIMIT 1;

  -- Quick Jumps -> quick-jumps container
  IF v_quick_jump_id IS NOT NULL THEN
    UPDATE public.homepage_items
    SET container_id = v_quick_jump_id
    WHERE section = 'quick_jump'
      AND container_id IS NULL;
  END IF;

  -- Local Commerce shortcut items
  IF v_commerce_id IS NOT NULL THEN
    UPDATE public.homepage_items
    SET container_id = v_commerce_id
    WHERE section = 'shortcut_grid'
      AND container_id IS NULL
      AND (
        item_key IN (
          'shortcut_print_digital',
          'shortcut_food_restaurants',
          'shortcut_shops_groceries',
          'shortcut_marketplace'
        )
        OR route_key = 'marketplace'
        OR COALESCE(query_params->>'vertical', '') IN (
          'print_digital',
          'restaurant_food',
          'shop_retail',
          'shop_catalogue'
        )
      );
  END IF;

  -- Logistics & Rides shortcut items
  IF v_logistics_id IS NOT NULL THEN
    UPDATE public.homepage_items
    SET container_id = v_logistics_id
    WHERE section = 'shortcut_grid'
      AND container_id IS NULL
      AND (
        item_key IN (
          'shortcut_pick_n_drop',
          'shortcut_vehicles_charters',
          'shortcut_lpg_refill'
        )
        OR route_key IN ('vehicles', 'pickNDrop', 'pick_n_drop')
        OR COALESCE(query_params->>'mode', '') = 'pick_n_drop'
      );
  END IF;

  -- Stays, Venues & Property shortcut items
  IF v_stays_id IS NOT NULL THEN
    UPDATE public.homepage_items
    SET container_id = v_stays_id
    WHERE section = 'shortcut_grid'
      AND container_id IS NULL
      AND (
        item_key IN (
          'shortcut_turfs_venues',
          'shortcut_hotels_stays',
          'shortcut_real_estate'
        )
        OR COALESCE(query_params->>'vertical', '') IN (
          'booking_venue',
          'hotel_stay',
          'real_estate'
        )
      );
  END IF;

  -- Civic, Bulletin, Services & remaining shortcut items -> civic-essential
  IF v_civic_id IS NOT NULL THEN
    UPDATE public.homepage_items
    SET container_id = v_civic_id
    WHERE section = 'shortcut_grid'
      AND container_id IS NULL;
  END IF;
END;
$$;

COMMIT;
