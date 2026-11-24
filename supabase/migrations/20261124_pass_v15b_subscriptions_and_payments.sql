-- =============================================================================
-- Migration: 20261124_pass_v15b_subscriptions_and_payments.sql
-- Purpose: Sprint 2 (v15b) — Subscriptions, Composable Entitlements & 3-Tier
--          Payment Method Matrix
--   1. Retrofit `public.subscription_plans` in-place (zero breakage to
--      `/bulletin?plans=1` for signed-out & signed-in visitors) + multi-duration
--      `public.subscription_plan_prices` child table.
--   2. Upgrade `public.user_subscriptions` in-place with `price_id`, `starts_at`,
--      `ends_at`, `entitlements_snapshot`, `custom_overrides`, `admin_notes`,
--      `updated_by` + bidirectional sync triggers & super_admin-only mutation RLS.
--   3. Upgrade `public.get_effective_entitlements(p_user_id, p_listing_id DEFAULT NULL)`
--      merging snapshot + custom_overrides for active non-expired subscriptions
--      and soft-freezing to a safe free-tier baseline when expired/suspended.
--   4. Create `public.payment_feature_policies` (Features + Listing Verticals),
--      add `listings.payment_mode` ('upi' | 'manual' | 'both'), and implement
--      `public.resolve_effective_payment_methods(p_scope_key, p_listing_id DEFAULT NULL)`
--      enforcing the 3-tier System -> Subscription -> Listing cascade.
--   5. Attach audit triggers writing every plan, pricing, subscription, and
--      payment policy mutation into immutable `public.audit_logs`.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. RETROFIT `public.subscription_plans` IN-PLACE (ZERO BREAKAGE)
-- -----------------------------------------------------------------------------
ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS slug text,
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS info text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS applicable_roles text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS applicable_categories text[] NOT NULL DEFAULT ARRAY['*']::text[],
  ADD COLUMN IF NOT EXISTS applicable_subcategories text[] NOT NULL DEFAULT ARRAY['*']::text[],
  ADD COLUMN IF NOT EXISTS entitlements jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS sort_order integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Backfill canonical v15b fields from existing rows without disturbing legacy columns
UPDATE public.subscription_plans sp
SET
  slug = COALESCE(
    NULLIF(trim(sp.slug), ''),
    lower(regexp_replace(COALESCE(NULLIF(trim(sp.title), ''), NULLIF(trim(sp.name), ''), 'plan'), '[^a-zA-Z0-9]+', '-', 'g'))
      || '-' || substr(sp.id::text, 1, 6)
  ),
  title = COALESCE(NULLIF(trim(sp.title), ''), NULLIF(trim(sp.name), ''), 'Subscription Plan'),
  info = CASE
    WHEN NULLIF(trim(sp.info), '') IS NOT NULL THEN sp.info
    ELSE COALESCE(
      NULLIF(trim(to_jsonb(sp)->>'tagline'), ''),
      NULLIF(trim(to_jsonb(sp)->>'description'), ''),
      ''
    )
  END,
  sort_order = CASE
    WHEN sp.sort_order <> 0 THEN sp.sort_order
    ELSE COALESCE((to_jsonb(sp)->>'display_order')::integer, 0)
  END,
  applicable_roles = CASE
    WHEN sp.applicable_roles IS NOT NULL AND cardinality(sp.applicable_roles) > 0
      THEN sp.applicable_roles
    WHEN COALESCE(to_jsonb(sp)->>'plan_scope', '') = 'bulletin'
      THEN ARRAY['owner', 'visitor', 'staff']::text[]
    ELSE ARRAY['owner']::text[]
  END,
  applicable_categories = CASE
    WHEN sp.applicable_categories IS NOT NULL AND cardinality(sp.applicable_categories) > 0
      THEN sp.applicable_categories
    ELSE ARRAY['*']::text[]
  END,
  applicable_subcategories = CASE
    WHEN sp.applicable_subcategories IS NOT NULL AND cardinality(sp.applicable_subcategories) > 0
      THEN sp.applicable_subcategories
    ELSE ARRAY['*']::text[]
  END,
  entitlements = CASE
    WHEN sp.entitlements IS NOT NULL
      AND sp.entitlements <> '{}'::jsonb
      AND (sp.entitlements ? 'allowed_listing_types' OR sp.entitlements ? 'online_payment')
      THEN sp.entitlements
    ELSE jsonb_build_object(
      'allowed_listing_types',
      CASE
        WHEN jsonb_typeof(to_jsonb(sp)->'target_verticals') = 'array'
          AND jsonb_array_length(to_jsonb(sp)->'target_verticals') > 0
          THEN to_jsonb(sp)->'target_verticals'
        ELSE '["general","print_digital","booking_venue","shop_catalogue","real_estate","restaurant_food","hotel_stay","public_civic"]'::jsonb
      END,
      'max_listings',
      COALESCE(
        NULLIF((to_jsonb(sp)->'limits'->>'max_listings'), '')::integer,
        3
      ),
      'max_marketplace_items',
      COALESCE(
        NULLIF((to_jsonb(sp)->'limits'->>'max_marketplace_items'), '')::integer,
        10
      ),
      'pnd_dispatch',
      jsonb_build_object(
        'enabled', COALESCE((to_jsonb(sp)->'features'->>'pnd_dispatch')::boolean, false),
        'limit', NULL
      ),
      'online_payment',
      jsonb_build_object(
        'enabled',
        COALESCE(
          (to_jsonb(sp)->'features'->>'online_payment')::boolean,
          (to_jsonb(sp)->'features'->>'online_upi_checkout')::boolean,
          (sp.price_inr > 0)
        ),
        'limit', NULL
      ),
      'print_order',
      jsonb_build_object(
        'enabled', COALESCE((to_jsonb(sp)->'features'->>'print_order')::boolean, false),
        'limit', NULL
      ),
      'real_estate_poly',
      jsonb_build_object(
        'enabled', COALESCE((to_jsonb(sp)->'features'->>'real_estate_polygon')::boolean, false),
        'limit', NULL
      ),
      'staffing',
      jsonb_build_object(
        'enabled', COALESCE((to_jsonb(sp)->'features'->>'staff_delegation')::boolean, false),
        'limit', COALESCE(NULLIF((to_jsonb(sp)->'limits'->>'max_staff_members'), '')::integer, 2)
      ),
      'bulletins',
      jsonb_build_object(
        'enabled', COALESCE((sp.max_active_bulletins > 0), true),
        'limit', COALESCE(NULLIF(sp.max_active_bulletins, 0), 5)
      ),
      'bookings',
      jsonb_build_object(
        'enabled',
        COALESCE(
          (to_jsonb(sp)->'features'->>'booking_slots')::boolean,
          (to_jsonb(sp)->'features'->>'hotel_rooms')::boolean,
          false
        ),
        'limit', NULL
      ),
      'panorama_360',
      jsonb_build_object(
        'enabled', COALESCE((to_jsonb(sp)->'features'->>'panorama_360')::boolean, false),
        'limit', COALESCE(NULLIF((to_jsonb(sp)->'limits'->>'max_360_panoramas'), '')::integer, 2)
      ),
      'featured_boost',
      jsonb_build_object(
        'enabled', COALESCE((to_jsonb(sp)->'features'->>'featured_boost')::boolean, false),
        'limit', COALESCE(NULLIF((to_jsonb(sp)->'limits'->>'featured_slots'), '')::integer, 1)
      )
    )
  END,
  updated_at = COALESCE(sp.updated_at, now());

-- Keep legacy `name`/`display_order`/`tagline` synchronized with canonical `title`/`sort_order`/`info`
CREATE OR REPLACE FUNCTION public.sync_subscription_plans_v15b()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.title := COALESCE(NULLIF(trim(NEW.title), ''), NULLIF(trim(NEW.name), ''), 'Untitled Plan');
    NEW.name := COALESCE(NULLIF(trim(NEW.name), ''), NEW.title);
    NEW.slug := COALESCE(
      NULLIF(trim(NEW.slug), ''),
      lower(regexp_replace(NEW.title, '[^a-zA-Z0-9]+', '-', 'g')) || '-' || substr(gen_random_uuid()::text, 1, 6)
    );
    IF NEW.sort_order = 0 AND COALESCE(NEW.display_order, 0) <> 0 THEN
      NEW.sort_order := NEW.display_order;
    ELSE
      NEW.display_order := NEW.sort_order;
    END IF;
    IF NULLIF(trim(COALESCE(NEW.tagline, '')), '') IS NULL AND NULLIF(trim(COALESCE(NEW.info, '')), '') IS NOT NULL THEN
      NEW.tagline := NEW.info;
    ELSIF NULLIF(trim(COALESCE(NEW.info, '')), '') IS NULL AND NULLIF(trim(COALESCE(NEW.tagline, '')), '') IS NOT NULL THEN
      NEW.info := NEW.tagline;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.title IS DISTINCT FROM OLD.title AND NULLIF(trim(NEW.title), '') IS NOT NULL THEN
      NEW.name := NEW.title;
    ELSIF NEW.name IS DISTINCT FROM OLD.name AND NULLIF(trim(NEW.name), '') IS NOT NULL THEN
      NEW.title := NEW.name;
    END IF;

    IF NEW.sort_order IS DISTINCT FROM OLD.sort_order THEN
      NEW.display_order := NEW.sort_order;
    ELSIF NEW.display_order IS DISTINCT FROM OLD.display_order THEN
      NEW.sort_order := COALESCE(NEW.display_order, 0);
    END IF;

    IF NEW.info IS DISTINCT FROM OLD.info THEN
      NEW.tagline := NEW.info;
    ELSIF NEW.tagline IS DISTINCT FROM OLD.tagline AND NEW.tagline IS NOT NULL THEN
      NEW.info := NEW.tagline;
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_subscription_plans_v15b_sync ON public.subscription_plans;
CREATE TRIGGER trg_subscription_plans_v15b_sync
  BEFORE INSERT OR UPDATE ON public.subscription_plans
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_subscription_plans_v15b();

CREATE INDEX IF NOT EXISTS idx_subscription_plans_active_sort
  ON public.subscription_plans (is_active, sort_order ASC, price_inr ASC);

ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;

-- Replace any existing write policies so ONLY super_admin can mutate subscription_plans,
-- while signed-out and signed-in users can read active plans (preserves `/bulletin?plans=1`).
DO $$
DECLARE
  v_pol record;
BEGIN
  FOR v_pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'subscription_plans'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.subscription_plans;', v_pol.policyname);
  END LOOP;
END;
$$;

CREATE POLICY subscription_plans_public_select
  ON public.subscription_plans
  FOR SELECT
  USING (is_active = true OR public.is_super_admin());

CREATE POLICY subscription_plans_superadmin_insert
  ON public.subscription_plans
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_super_admin());

CREATE POLICY subscription_plans_superadmin_update
  ON public.subscription_plans
  FOR UPDATE
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY subscription_plans_superadmin_delete
  ON public.subscription_plans
  FOR DELETE
  TO authenticated
  USING (public.is_super_admin());

-- -----------------------------------------------------------------------------
-- 2. MULTI-DURATION PRICING TABLE `public.subscription_plan_prices`
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.subscription_plan_prices (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  plan_id uuid NOT NULL REFERENCES public.subscription_plans(id) ON DELETE CASCADE,
  duration_label text NOT NULL,
  duration_days integer NOT NULL CHECK (duration_days > 0),
  price_inr numeric(10, 2) NOT NULL DEFAULT 0 CHECK (price_inr >= 0),
  compare_at_inr numeric(10, 2) CHECK (compare_at_inr IS NULL OR compare_at_inr >= 0),
  is_default boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_subscription_plan_prices_plan_sort
  ON public.subscription_plan_prices (plan_id, sort_order ASC, duration_days ASC);

CREATE OR REPLACE FUNCTION public.touch_subscription_plan_prices_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_subscription_plan_prices_updated_at ON public.subscription_plan_prices;
CREATE TRIGGER trg_subscription_plan_prices_updated_at
  BEFORE UPDATE ON public.subscription_plan_prices
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_subscription_plan_prices_updated_at();

-- Backfill one default price row for every existing plan that lacks rows in subscription_plan_prices
INSERT INTO public.subscription_plan_prices (
  plan_id,
  duration_label,
  duration_days,
  price_inr,
  compare_at_inr,
  is_default,
  is_active,
  sort_order
)
SELECT
  sp.id,
  CASE
    WHEN COALESCE(sp.duration_days, 30) <= 7 THEN 'Weekly'
    WHEN COALESCE(sp.duration_days, 30) <= 35 THEN 'Monthly'
    WHEN COALESCE(sp.duration_days, 30) <= 100 THEN 'Quarterly'
    WHEN COALESCE(sp.duration_days, 30) <= 200 THEN 'Half-Yearly'
    WHEN COALESCE(sp.duration_days, 30) >= 360 THEN 'Annual'
    ELSE COALESCE(sp.duration_days, 30)::text || ' Days'
  END,
  GREATEST(COALESCE(sp.duration_days, 30), 1),
  GREATEST(COALESCE(sp.price_inr, 0)::numeric(10, 2), 0),
  CASE
    WHEN (to_jsonb(sp)->>'original_price_inr') IS NOT NULL
      AND NULLIF(to_jsonb(sp)->>'original_price_inr', '')::numeric > 0
      THEN (to_jsonb(sp)->>'original_price_inr')::numeric(10, 2)
    ELSE NULL
  END,
  true,
  COALESCE(sp.is_active, true),
  0
FROM public.subscription_plans sp
WHERE NOT EXISTS (
  SELECT 1
  FROM public.subscription_plan_prices spp
  WHERE spp.plan_id = sp.id
);

ALTER TABLE public.subscription_plan_prices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS subscription_plan_prices_public_select ON public.subscription_plan_prices;
CREATE POLICY subscription_plan_prices_public_select
  ON public.subscription_plan_prices
  FOR SELECT
  USING (is_active = true OR public.is_super_admin());

DROP POLICY IF EXISTS subscription_plan_prices_superadmin_insert ON public.subscription_plan_prices;
CREATE POLICY subscription_plan_prices_superadmin_insert
  ON public.subscription_plan_prices
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS subscription_plan_prices_superadmin_update ON public.subscription_plan_prices;
CREATE POLICY subscription_plan_prices_superadmin_update
  ON public.subscription_plan_prices
  FOR UPDATE
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS subscription_plan_prices_superadmin_delete ON public.subscription_plan_prices;
CREATE POLICY subscription_plan_prices_superadmin_delete
  ON public.subscription_plan_prices
  FOR DELETE
  TO authenticated
  USING (public.is_super_admin());

-- -----------------------------------------------------------------------------
-- 3. UPGRADE `public.user_subscriptions` IN-PLACE
-- -----------------------------------------------------------------------------
ALTER TABLE public.user_subscriptions
  ADD COLUMN IF NOT EXISTS price_id uuid REFERENCES public.subscription_plan_prices(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS starts_at timestamptz,
  ADD COLUMN IF NOT EXISTS ends_at timestamptz,
  ADD COLUMN IF NOT EXISTS entitlements_snapshot jsonb,
  ADD COLUMN IF NOT EXISTS custom_overrides jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS admin_notes text,
  ADD COLUMN IF NOT EXISTS updated_by uuid,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- Expand status CHECK constraint to include canonical v15b statuses + legacy statuses
DO $$
DECLARE
  v_con record;
BEGIN
  FOR v_con IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.user_subscriptions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.user_subscriptions DROP CONSTRAINT IF EXISTS %I;', v_con.conname);
  END LOOP;
END;
$$;

ALTER TABLE public.user_subscriptions
  ADD CONSTRAINT user_subscriptions_status_v15b_check
  CHECK (status IN (
    'active',
    'suspended',
    'expired',
    'pending',
    'cancelled',
    'trialing',
    'paused',
    'pending_payment'
  ));

-- Backfill starts_at, ends_at, custom_overrides, and entitlements_snapshot
UPDATE public.user_subscriptions us
SET
  starts_at = COALESCE(us.starts_at, us.created_at, now()),
  ends_at = COALESCE(us.ends_at, us.expires_at),
  custom_overrides = CASE
    WHEN us.custom_overrides IS NOT NULL AND us.custom_overrides <> '{}'::jsonb
      THEN us.custom_overrides
    WHEN us.entitlement_overrides IS NOT NULL AND us.entitlement_overrides <> '{}'::jsonb
      THEN us.entitlement_overrides
    ELSE '{}'::jsonb
  END,
  entitlements_snapshot = COALESCE(
    us.entitlements_snapshot,
    (SELECT sp.entitlements FROM public.subscription_plans sp WHERE sp.id = us.plan_id)
  ),
  updated_at = COALESCE(us.updated_at, now());

-- Keep `ends_at <-> expires_at` and `custom_overrides <-> entitlement_overrides` synced
CREATE OR REPLACE FUNCTION public.sync_user_subscriptions_v15b()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    NEW.starts_at := COALESCE(NEW.starts_at, now());
    IF NEW.ends_at IS NULL AND NEW.expires_at IS NOT NULL THEN
      NEW.ends_at := NEW.expires_at;
    ELSIF NEW.expires_at IS NULL AND NEW.ends_at IS NOT NULL THEN
      NEW.expires_at := NEW.ends_at;
    END IF;

    IF (NEW.custom_overrides IS NULL OR NEW.custom_overrides = '{}'::jsonb)
       AND NEW.entitlement_overrides IS NOT NULL
       AND NEW.entitlement_overrides <> '{}'::jsonb THEN
      NEW.custom_overrides := NEW.entitlement_overrides;
    ELSIF NEW.custom_overrides IS NOT NULL AND NEW.custom_overrides <> '{}'::jsonb THEN
      NEW.entitlement_overrides := NEW.custom_overrides;
    END IF;

    IF NEW.entitlements_snapshot IS NULL AND NEW.plan_id IS NOT NULL THEN
      SELECT sp.entitlements
        INTO NEW.entitlements_snapshot
      FROM public.subscription_plans sp
      WHERE sp.id = NEW.plan_id;
    END IF;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.ends_at IS DISTINCT FROM OLD.ends_at THEN
      NEW.expires_at := NEW.ends_at;
    ELSIF NEW.expires_at IS DISTINCT FROM OLD.expires_at THEN
      NEW.ends_at := NEW.expires_at;
    END IF;

    IF NEW.custom_overrides IS DISTINCT FROM OLD.custom_overrides THEN
      NEW.entitlement_overrides := COALESCE(NEW.custom_overrides, '{}'::jsonb);
    ELSIF NEW.entitlement_overrides IS DISTINCT FROM OLD.entitlement_overrides THEN
      NEW.custom_overrides := COALESCE(NEW.entitlement_overrides, '{}'::jsonb);
    END IF;

    IF NEW.plan_id IS DISTINCT FROM OLD.plan_id AND NEW.entitlements_snapshot IS NOT DISTINCT FROM OLD.entitlements_snapshot THEN
      SELECT sp.entitlements
        INTO NEW.entitlements_snapshot
      FROM public.subscription_plans sp
      WHERE sp.id = NEW.plan_id;
    END IF;
  END IF;

  NEW.updated_by := COALESCE(NEW.updated_by, auth.uid());
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_subscriptions_v15b_sync ON public.user_subscriptions;
CREATE TRIGGER trg_user_subscriptions_v15b_sync
  BEFORE INSERT OR UPDATE ON public.user_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_user_subscriptions_v15b();

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_status_ends
  ON public.user_subscriptions (user_id, status, ends_at DESC);

ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  v_pol record;
BEGIN
  FOR v_pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'user_subscriptions'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.user_subscriptions;', v_pol.policyname);
  END LOOP;
END;
$$;

-- Users read their own subscriptions; super_admin reads all.
CREATE POLICY user_subscriptions_select_own_or_superadmin
  ON public.user_subscriptions
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR public.is_super_admin());

-- Super_admin can insert any subscription; users can only submit pending payment requests for themselves without overrides.
CREATE POLICY user_subscriptions_insert_policy
  ON public.user_subscriptions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR (
      auth.uid() = user_id
      AND status IN ('pending', 'pending_payment')
      AND COALESCE(custom_overrides, '{}'::jsonb) = '{}'::jsonb
      AND COALESCE(entitlement_overrides, '{}'::jsonb) = '{}'::jsonb
    )
  );

-- Status changes, renewals, plan switches, and custom_overrides are strictly super_admin-only.
CREATE POLICY user_subscriptions_superadmin_update
  ON public.user_subscriptions
  FOR UPDATE
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

CREATE POLICY user_subscriptions_superadmin_delete
  ON public.user_subscriptions
  FOR DELETE
  TO authenticated
  USING (public.is_super_admin());

-- -----------------------------------------------------------------------------
-- 4. UPGRADED `public.get_effective_entitlements(p_user_id, p_listing_id DEFAULT NULL)`
-- -----------------------------------------------------------------------------
-- Keeps optional 2nd parameter `p_listing_id DEFAULT NULL` so BOTH 1-arg callers
-- (`get_effective_entitlements(uid)`) and 2-arg legacy callers (`has_active_print_entitlement`,
-- `useEffectiveEntitlements`) remain 100% compatible.
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

  -- Canonical v15b entitlement accumulators (safe free-tier baseline)
  v_allowed_listing_types jsonb := '["general","public_civic"]'::jsonb;
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

  -- Legacy v12c compatibility maps
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
BEGIN
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'allowed_listing_types', v_allowed_listing_types,
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

  -- Super Admin full platform bypass
  IF v_role = 'super_admin' THEN
    RETURN jsonb_build_object(
      'allowed_listing_types',
      '["general","print_digital","booking_venue","shop_catalogue","real_estate","restaurant_food","hotel_stay","public_civic"]'::jsonb,
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

  -- Record most recent subscription status for informative soft-freeze reporting
  SELECT us.status, COALESCE(us.ends_at, us.expires_at)
    INTO v_latest_status, v_latest_ends_at
  FROM public.user_subscriptions us
  WHERE us.user_id = p_user_id
    AND (us.listing_id IS NULL OR (p_listing_id IS NOT NULL AND us.listing_id = p_listing_id))
  ORDER BY us.updated_at DESC NULLS LAST, us.created_at DESC NULLS LAST
  LIMIT 1;

  -- Merge all active, non-expired subscriptions for this user (and optional listing)
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
      sp.limits AS plan_legacy_limits
    FROM public.user_subscriptions us
    LEFT JOIN public.subscription_plans sp ON sp.id = us.plan_id
    WHERE us.user_id = p_user_id
      AND us.status IN ('active', 'trialing')
      AND (COALESCE(us.ends_at, us.expires_at) IS NULL OR COALESCE(us.ends_at, us.expires_at) > v_now)
      AND (us.listing_id IS NULL OR (p_listing_id IS NOT NULL AND us.listing_id = p_listing_id))
    ORDER BY us.created_at ASC
  LOOP
    v_active_count := v_active_count + 1;
    IF v_sub.plan_id IS NOT NULL THEN
      v_active_plan_ids := v_active_plan_ids || to_jsonb(v_sub.plan_id);
    END IF;

    -- 1) Apply plan snapshot (or live plan entitlements fallback)
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
      IF jsonb_typeof(v_src->v_fk) = 'object' THEN
        v_cur_feat := v_v15b_features->v_fk;
        v_in_feat := v_src->v_fk;
        v_cur_enabled := COALESCE((v_cur_feat->>'enabled')::boolean, false);
        v_in_enabled := COALESCE((v_in_feat->>'enabled')::boolean, false);

        IF v_in_enabled THEN
          IF v_in_feat ? 'limit' AND jsonb_typeof(v_in_feat->'limit') = 'null' THEN
            v_v15b_features := jsonb_set(v_v15b_features, ARRAY[v_fk], jsonb_build_object('enabled', true, 'limit', NULL));
          ELSIF jsonb_typeof(v_in_feat->'limit') = 'number' THEN
            v_in_limit := (v_in_feat->>'limit')::integer;
            IF v_cur_enabled AND jsonb_typeof(v_cur_feat->'limit') = 'null' THEN
              -- Already unlimited
              v_v15b_features := jsonb_set(v_v15b_features, ARRAY[v_fk], jsonb_build_object('enabled', true, 'limit', NULL));
            ELSE
              v_cur_limit := COALESCE((v_cur_feat->>'limit')::integer, 0);
              v_v15b_features := jsonb_set(
                v_v15b_features,
                ARRAY[v_fk],
                jsonb_build_object('enabled', true, 'limit', GREATEST(v_cur_limit, v_in_limit))
              );
            END IF;
          ELSE
            v_v15b_features := jsonb_set(v_v15b_features, ARRAY[v_fk, 'enabled'], 'true'::jsonb);
          END IF;
        END IF;
      END IF;
    END LOOP;

    -- Merge legacy plan features & limits
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
          v_tmp_int := (v_val::text)::integer;
          IF COALESCE((v_legacy_limits->>v_key)::integer, 0) < v_tmp_int THEN
            v_legacy_limits := jsonb_set(v_legacy_limits, ARRAY[v_key], to_jsonb(v_tmp_int), true);
          END IF;
        END IF;
      END LOOP;
    END IF;

    -- 2) Apply per-customer custom_overrides (authoritative override if not expired)
    v_ov := COALESCE(v_sub.merged_overrides, '{}'::jsonb);
    IF v_ov <> '{}'::jsonb
       AND (v_sub.override_expires_at IS NULL OR v_sub.override_expires_at > v_now) THEN
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
        IF jsonb_typeof(v_ov->v_fk) = 'object' THEN
          v_in_feat := v_ov->v_fk;
          v_v15b_features := jsonb_set(
            v_v15b_features,
            ARRAY[v_fk],
            jsonb_build_object(
              'enabled', COALESCE((v_in_feat->>'enabled')::boolean, (v_v15b_features->v_fk->>'enabled')::boolean, false),
              'limit', CASE
                WHEN v_in_feat ? 'limit' THEN v_in_feat->'limit'
                ELSE v_v15b_features->v_fk->'limit'
              END
            )
          );
        END IF;
      END LOOP;

      -- Legacy nested `features` / `limits` override support
      IF jsonb_typeof(v_ov->'features') = 'object' THEN
        FOR v_key, v_val IN SELECT * FROM jsonb_each(v_ov->'features') LOOP
          IF jsonb_typeof(v_val) = 'boolean' THEN
            v_legacy_features := jsonb_set(v_legacy_features, ARRAY[v_key], v_val, true);
          END IF;
        END LOOP;
      END IF;

      IF jsonb_typeof(v_ov->'limits') = 'object' THEN
        FOR v_key, v_val IN SELECT * FROM jsonb_each(v_ov->'limits') LOOP
          IF jsonb_typeof(v_val) = 'number' THEN
            v_legacy_limits := jsonb_set(v_legacy_limits, ARRAY[v_key], v_val, true);
          END IF;
        END LOOP;
      END IF;
    END IF;
  END LOOP;

  -- Mirror canonical v15b feature flags into legacy `features`/`limits` maps for seamless v12c callers
  v_legacy_features := v_legacy_features
    || jsonb_build_object(
      'pnd_dispatch', COALESCE((v_v15b_features->'pnd_dispatch'->>'enabled')::boolean, false),
      'online_payment', COALESCE((v_v15b_features->'online_payment'->>'enabled')::boolean, false),
      'print_order', COALESCE((v_v15b_features->'print_order'->>'enabled')::boolean, false),
      'real_estate_polygon', COALESCE((v_v15b_features->'real_estate_poly'->>'enabled')::boolean, false),
      'staff_delegation', COALESCE((v_v15b_features->'staffing'->>'enabled')::boolean, false),
      'booking_slots', COALESCE((v_v15b_features->'bookings'->>'enabled')::boolean, false),
      'hotel_rooms', COALESCE((v_v15b_features->'bookings'->>'enabled')::boolean, false),
      'panorama_360', COALESCE((v_v15b_features->'panorama_360'->>'enabled')::boolean, false),
      'featured_boost', COALESCE((v_v15b_features->'featured_boost'->>'enabled')::boolean, false)
    );

  IF v_max_listings_unlimited THEN
    v_legacy_limits := jsonb_set(v_legacy_limits, ARRAY['max_listings'], '9999'::jsonb, true);
  ELSE
    v_legacy_limits := jsonb_set(v_legacy_limits, ARRAY['max_listings'], to_jsonb(v_max_listings), true);
  END IF;

  IF v_max_marketplace_unlimited THEN
    v_legacy_limits := jsonb_set(v_legacy_limits, ARRAY['max_marketplace_items'], '9999'::jsonb, true);
  ELSE
    v_legacy_limits := jsonb_set(v_legacy_limits, ARRAY['max_marketplace_items'], to_jsonb(v_max_marketplace_items), true);
  END IF;

  IF jsonb_typeof(v_v15b_features->'panorama_360'->'limit') = 'number' THEN
    v_legacy_limits := jsonb_set(
      v_legacy_limits,
      ARRAY['max_360_panoramas'],
      v_v15b_features->'panorama_360'->'limit',
      true
    );
  END IF;

  IF jsonb_typeof(v_v15b_features->'staffing'->'limit') = 'number' THEN
    v_legacy_limits := jsonb_set(
      v_legacy_limits,
      ARRAY['max_staff_members'],
      v_v15b_features->'staffing'->'limit',
      true
    );
  END IF;

  RETURN jsonb_build_object(
    'allowed_listing_types', v_allowed_listing_types,
    'max_listings', CASE WHEN v_max_listings_unlimited THEN NULL ELSE v_max_listings END,
    'max_marketplace_items', CASE WHEN v_max_marketplace_unlimited THEN NULL ELSE v_max_marketplace_items END,
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
-- 5. 3-TIER PAYMENT METHOD MATRIX (`payment_feature_policies` + `listings.payment_mode`)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.payment_feature_policies (
  scope_key text PRIMARY KEY,
  scope_type text NOT NULL CHECK (scope_type IN ('feature', 'listing_type')),
  label text NOT NULL,
  upi_enabled boolean NOT NULL DEFAULT true,
  manual_enabled boolean NOT NULL DEFAULT true,
  escrow_required boolean NOT NULL DEFAULT false,
  allow_listing_override boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION public.touch_payment_feature_policies_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_payment_feature_policies_updated_at ON public.payment_feature_policies;
CREATE TRIGGER trg_payment_feature_policies_updated_at
  BEFORE UPDATE ON public.payment_feature_policies
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_payment_feature_policies_updated_at();

-- Idempotently seed canonical Features (5) and Listing Verticals (8)
INSERT INTO public.payment_feature_policies (
  scope_key,
  scope_type,
  label,
  upi_enabled,
  manual_enabled,
  escrow_required,
  allow_listing_override
)
VALUES
  -- Platform Features
  ('pnd', 'feature', 'Pick N Drop Logistics', true, true, true, false),
  ('bulletin', 'feature', 'Community Bulletins & Notices', true, true, false, false),
  ('vehicles', 'feature', 'Vehicle Rental & Fleet Bookings', true, true, true, false),
  ('print_order', 'feature', 'Print & Digital Orders', true, true, false, true),
  ('marketplace', 'feature', 'Marketplace Classifieds & Deals', true, true, false, true),
  -- Canonical Listing Types (matching lib/verticals/types.ts)
  ('general', 'listing_type', 'General Business & Services', true, true, false, true),
  ('print_digital', 'listing_type', 'Print, Copy & Digital Services', true, true, false, true),
  ('booking_venue', 'listing_type', 'Sports & Venue Bookings', true, true, false, true),
  ('shop_catalogue', 'listing_type', 'Retail & Local Shop Catalogue', true, true, false, true),
  ('real_estate', 'listing_type', 'Real Estate & Land Plots', true, true, false, true),
  ('restaurant_food', 'listing_type', 'Restaurants, Cafés & Bakeries', true, true, false, true),
  ('hotel_stay', 'listing_type', 'Hotels, Homestays & Lodging', true, true, false, true),
  ('public_civic', 'listing_type', 'Public & Civic Institutions', false, true, false, false)
ON CONFLICT (scope_key) DO NOTHING;

ALTER TABLE public.payment_feature_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_feature_policies_public_select ON public.payment_feature_policies;
CREATE POLICY payment_feature_policies_public_select
  ON public.payment_feature_policies
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS payment_feature_policies_superadmin_insert ON public.payment_feature_policies;
CREATE POLICY payment_feature_policies_superadmin_insert
  ON public.payment_feature_policies
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS payment_feature_policies_superadmin_update ON public.payment_feature_policies;
CREATE POLICY payment_feature_policies_superadmin_update
  ON public.payment_feature_policies
  FOR UPDATE
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS payment_feature_policies_superadmin_delete ON public.payment_feature_policies;
CREATE POLICY payment_feature_policies_superadmin_delete
  ON public.payment_feature_policies
  FOR DELETE
  TO authenticated
  USING (public.is_super_admin());

-- Add listing-level payment_mode ('upi' | 'manual' | 'both') to public.listings
ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS payment_mode text NOT NULL DEFAULT 'manual';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.listings'::regclass
      AND conname = 'listings_payment_mode_check'
  ) THEN
    ALTER TABLE public.listings
      ADD CONSTRAINT listings_payment_mode_check
      CHECK (payment_mode IN ('upi', 'manual', 'both'));
  END IF;
END;
$$;

-- 3-Tier Cascade Resolver RPC: System Policy -> Owner Subscription -> Listing Mode
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
  v_listing_vertical text := NULL;
  v_listing_payment_mode text := NULL;

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
    SELECT l.owner_id, l.listing_vertical, COALESCE(l.payment_mode, 'manual')
      INTO v_listing_owner_id, v_listing_vertical, v_listing_payment_mode
    FROM public.listings l
    WHERE l.id = p_listing_id;
  END IF;

  IF v_scope IS NULL THEN
    v_scope := COALESCE(NULLIF(lower(trim(v_listing_vertical)), ''), 'general');
  END IF;

  -- LAYER 1: System Feature / Listing Type Policy
  SELECT *
    INTO v_policy
  FROM public.payment_feature_policies p
  WHERE p.scope_key = v_scope;

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
    -- Platform-collected feature checkouts (e.g., PnD, Bulletin, Vehicles without a listing owner)
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

-- -----------------------------------------------------------------------------
-- 6. IMMUTABLE AUDIT LOG TRIGGERS FOR ALL v15b TABLES
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_v15b_subscriptions_and_payments()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_target_id text;
  v_action text;
  v_meta jsonb;
BEGIN
  IF TG_TABLE_NAME = 'payment_feature_policies' THEN
    v_target_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.scope_key ELSE NEW.scope_key END;
    v_action := 'payment_policy.' || lower(TG_OP);
    v_meta := jsonb_build_object(
      'scope_key', v_target_id,
      'scope_type', CASE WHEN TG_OP = 'DELETE' THEN OLD.scope_type ELSE NEW.scope_type END,
      'previous', CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN jsonb_build_object(
        'upi_enabled', OLD.upi_enabled,
        'manual_enabled', OLD.manual_enabled,
        'escrow_required', OLD.escrow_required,
        'allow_listing_override', OLD.allow_listing_override
      ) ELSE NULL END,
      'next', CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN jsonb_build_object(
        'upi_enabled', NEW.upi_enabled,
        'manual_enabled', NEW.manual_enabled,
        'escrow_required', NEW.escrow_required,
        'allow_listing_override', NEW.allow_listing_override
      ) ELSE NULL END
    );
  ELSIF TG_TABLE_NAME = 'user_subscriptions' THEN
    v_target_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id::text ELSE NEW.id::text END;
    v_action := CASE
      WHEN TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status
        THEN 'user_subscription.status_' || lower(COALESCE(NEW.status, 'updated'))
      WHEN TG_OP = 'UPDATE' AND OLD.custom_overrides IS DISTINCT FROM NEW.custom_overrides
        THEN 'user_subscription.overrides_updated'
      WHEN TG_OP = 'UPDATE' AND OLD.plan_id IS DISTINCT FROM NEW.plan_id
        THEN 'user_subscription.plan_switched'
      ELSE 'user_subscription.' || lower(TG_OP)
    END;
    v_meta := jsonb_build_object(
      'user_id', CASE WHEN TG_OP = 'DELETE' THEN OLD.user_id ELSE NEW.user_id END,
      'plan_id', CASE WHEN TG_OP = 'DELETE' THEN OLD.plan_id ELSE NEW.plan_id END,
      'previous_status', CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN OLD.status ELSE NULL END,
      'new_status', CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN NEW.status ELSE NULL END,
      'ends_at', CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN NEW.ends_at ELSE OLD.ends_at END,
      'has_custom_overrides', CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN (COALESCE(NEW.custom_overrides, '{}'::jsonb) <> '{}'::jsonb) ELSE false END
    );
  ELSIF TG_TABLE_NAME = 'subscription_plan_prices' THEN
    v_target_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id::text ELSE NEW.id::text END;
    v_action := 'subscription_plan_price.' || lower(TG_OP);
    v_meta := jsonb_build_object(
      'plan_id', CASE WHEN TG_OP = 'DELETE' THEN OLD.plan_id ELSE NEW.plan_id END,
      'duration_label', CASE WHEN TG_OP = 'DELETE' THEN OLD.duration_label ELSE NEW.duration_label END,
      'duration_days', CASE WHEN TG_OP = 'DELETE' THEN OLD.duration_days ELSE NEW.duration_days END,
      'price_inr', CASE WHEN TG_OP = 'DELETE' THEN OLD.price_inr ELSE NEW.price_inr END
    );
  ELSE
    -- subscription_plans
    v_target_id := CASE WHEN TG_OP = 'DELETE' THEN OLD.id::text ELSE NEW.id::text END;
    v_action := 'subscription_plan.' || lower(TG_OP);
    v_meta := jsonb_build_object(
      'slug', CASE WHEN TG_OP = 'DELETE' THEN OLD.slug ELSE NEW.slug END,
      'title', CASE WHEN TG_OP = 'DELETE' THEN COALESCE(OLD.title, OLD.name) ELSE COALESCE(NEW.title, NEW.name) END,
      'is_active', CASE WHEN TG_OP = 'DELETE' THEN OLD.is_active ELSE NEW.is_active END,
      'applicable_roles', CASE WHEN TG_OP = 'DELETE' THEN OLD.applicable_roles ELSE NEW.applicable_roles END
    );
  END IF;

  PERFORM public.write_audit_log(
    auth.uid(),
    NULL,
    v_action,
    TG_TABLE_NAME,
    v_target_id,
    v_meta
  );

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_subscription_plans_v15b ON public.subscription_plans;
CREATE TRIGGER trg_audit_subscription_plans_v15b
  AFTER INSERT OR UPDATE OR DELETE ON public.subscription_plans
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_v15b_subscriptions_and_payments();

DROP TRIGGER IF EXISTS trg_audit_subscription_plan_prices_v15b ON public.subscription_plan_prices;
CREATE TRIGGER trg_audit_subscription_plan_prices_v15b
  AFTER INSERT OR UPDATE OR DELETE ON public.subscription_plan_prices
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_v15b_subscriptions_and_payments();

DROP TRIGGER IF EXISTS trg_audit_user_subscriptions_v15b ON public.user_subscriptions;
CREATE TRIGGER trg_audit_user_subscriptions_v15b
  AFTER INSERT OR UPDATE OR DELETE ON public.user_subscriptions
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_v15b_subscriptions_and_payments();

DROP TRIGGER IF EXISTS trg_audit_payment_feature_policies_v15b ON public.payment_feature_policies;
CREATE TRIGGER trg_audit_payment_feature_policies_v15b
  AFTER INSERT OR UPDATE OR DELETE ON public.payment_feature_policies
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_v15b_subscriptions_and_payments();

COMMIT;
