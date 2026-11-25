-- =============================================================================
-- Migration: 20261125_pass_v15e_builder_ordering.sql
-- Pass v15e: Platform Builders Ordering & Hardening
--   1. Ensure `public.categories` has `sort_order` & `is_active`, ordered index,
--      strict `super_admin`-only write RLS, and `public.audit_logs` trigger.
--   2. Ensure `public.subscription_plans` and `public.subscription_plan_prices`
--      have `sort_order` columns and ordered indexes for drag-and-drop sorting.
--   3. Add `sort_order` to canonical 5-tier Pick N Drop fleet table
--      (`public.vehicle_types`), backfill ordered by `base_fare_inr ASC`,
--      and verify `super_admin`-only write RLS + `public.audit_logs` trigger.
--
-- Execution Order: v15a -> v15b -> v15c -> v15d -> v15e
-- 100% Idempotent: Safe to re-run without destructive side effects.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. PUBLIC.CATEGORIES — ORDERING, ACTIVE FLAG, INDEX & AUDIT VERIFICATION
-- -----------------------------------------------------------------------------
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- Backfill sort_order cleanly per (entity_type, parent_id) group where all rows are 0
DO $$
DECLARE
  v_has_display_order boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'categories'
      AND column_name = 'display_order'
  ) INTO v_has_display_order;

  IF v_has_display_order THEN
    EXECUTE '
      UPDATE public.categories
      SET sort_order = COALESCE(display_order, 0)
      WHERE sort_order = 0
        AND display_order IS NOT NULL
        AND display_order <> 0
    ';
  END IF;

  -- Assign deterministic 10-step sort_order for siblings that still all share 0
  WITH ranked AS (
    SELECT
      id,
      (ROW_NUMBER() OVER (
        PARTITION BY COALESCE(entity_type, 'listing'), parent_id
        ORDER BY sort_order ASC, display_name ASC, created_at ASC, id ASC
      ) * 10)::integer AS next_order
    FROM public.categories
    WHERE sort_order = 0
  )
  UPDATE public.categories c
  SET sort_order = r.next_order
  FROM ranked r
  WHERE c.id = r.id
    AND c.sort_order = 0;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_categories_parent_sort_order
  ON public.categories (entity_type, parent_id, sort_order ASC, display_name ASC);

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

-- Re-verify super_admin-only write RLS & audit trigger (idempotent)
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
  USING (public.is_super_admin());

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
-- 2. SUBSCRIPTION PLANS & PLAN PRICES — DRAG-AND-DROP SORT ORDER
-- -----------------------------------------------------------------------------
ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

WITH ranked_plans AS (
  SELECT
    id,
    (ROW_NUMBER() OVER (
      ORDER BY sort_order ASC, updated_at ASC NULLS LAST, id ASC
    ) * 10)::integer AS next_order
  FROM public.subscription_plans
  WHERE sort_order = 0
)
UPDATE public.subscription_plans sp
SET sort_order = rp.next_order
FROM ranked_plans rp
WHERE sp.id = rp.id
  AND sp.sort_order = 0;

CREATE INDEX IF NOT EXISTS idx_subscription_plans_sort_order
  ON public.subscription_plans (sort_order ASC, is_active DESC);

ALTER TABLE public.subscription_plan_prices
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

WITH ranked_prices AS (
  SELECT
    id,
    (ROW_NUMBER() OVER (
      PARTITION BY plan_id
      ORDER BY sort_order ASC, duration_days ASC, price_inr ASC
    ) * 10)::integer AS next_order
  FROM public.subscription_plan_prices
  WHERE sort_order = 0
)
UPDATE public.subscription_plan_prices spp
SET sort_order = rp.next_order
FROM ranked_prices rp
WHERE spp.id = rp.id
  AND spp.sort_order = 0;

CREATE INDEX IF NOT EXISTS idx_subscription_plan_prices_plan_sort_order
  ON public.subscription_plan_prices (plan_id, sort_order ASC, duration_days ASC);

-- -----------------------------------------------------------------------------
-- 3. PICK N DROP 5-TIER FLEET (`public.vehicle_types`) — SORT ORDER & AUDIT
-- -----------------------------------------------------------------------------
ALTER TABLE public.vehicle_types
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0;

WITH ranked_tiers AS (
  SELECT
    id,
    (ROW_NUMBER() OVER (
      ORDER BY base_fare_inr ASC, name ASC, id ASC
    ) * 10)::integer AS next_order
  FROM public.vehicle_types
  WHERE sort_order = 0
)
UPDATE public.vehicle_types vt
SET sort_order = rt.next_order
FROM ranked_tiers rt
WHERE vt.id = rt.id
  AND vt.sort_order = 0;

CREATE INDEX IF NOT EXISTS idx_vehicle_types_sort_order
  ON public.vehicle_types (sort_order ASC, base_fare_inr ASC);

ALTER TABLE public.vehicle_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vehicle_types_public_select_v15c ON public.vehicle_types;
CREATE POLICY vehicle_types_public_select_v15c
  ON public.vehicle_types
  FOR SELECT
  USING (is_active = true OR public.is_super_admin());

DROP POLICY IF EXISTS vehicle_types_superadmin_insert_v15c ON public.vehicle_types;
CREATE POLICY vehicle_types_superadmin_insert_v15c
  ON public.vehicle_types
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS vehicle_types_superadmin_update_v15c ON public.vehicle_types;
CREATE POLICY vehicle_types_superadmin_update_v15c
  ON public.vehicle_types
  FOR UPDATE
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS vehicle_types_superadmin_delete_v15c ON public.vehicle_types;
CREATE POLICY vehicle_types_superadmin_delete_v15c
  ON public.vehicle_types
  FOR DELETE
  TO authenticated
  USING (public.is_super_admin());

DO $$
BEGIN
  IF to_regprocedure('public.audit_superadmin_config_change()') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_audit_vehicle_types_v15c ON public.vehicle_types;
    CREATE TRIGGER trg_audit_vehicle_types_v15c
      AFTER INSERT OR UPDATE OR DELETE ON public.vehicle_types
      FOR EACH ROW
      EXECUTE FUNCTION public.audit_superadmin_config_change();
  END IF;
END;
$$;
