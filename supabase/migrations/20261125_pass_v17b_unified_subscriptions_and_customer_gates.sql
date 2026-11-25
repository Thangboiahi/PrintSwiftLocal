-- =============================================================================
-- Pass v17b: Unified Subscriptions Overhaul, Default Free Baseline,
-- Free Trials, Targeted Plans & Customer-Facing Capability Gates
-- =============================================================================
-- Strictly idempotent migration:
--   1. Upgrades `public.subscription_plans` with Default Free Tier singleton,
--      trial settings, targeted audience (`public` vs `selected_users`), and
--      archival support.
--   2. Upserts the canonical Default Free Tier (`default-free-tier`), normalizes
--      legacy Bulletin & vertical plans into the unified entitlements schema,
--      and safely archives any redundant `General Business` plan after
--      migrating active subscribers.
--   3. Tightens RLS on `subscription_plans` and `subscription_plan_prices` so
--      targeted plans are visible ONLY to targeted users and `super_admin`.
--   4. Adds `profiles.trial_used_at`, ensures `user_subscriptions.status`
--      includes `'trialing'`, and creates `start_plan_trial`,
--      `reset_user_trial_eligibility`, and partner-approval auto-trial trigger.
--   5. Upgrades `get_effective_entitlements` (live Default Free fallback,
--      `staffing.max_staff` quota, `auto_verify_listings`, `auto_verify_bulletins`,
--      `trialing` support, v16b root/category inheritance).
--   6. Creates privacy-safe `get_listing_public_capabilities(p_listing_id)` RPC.
--   7. Adds server-side `BEFORE INSERT` auto-verify triggers on `listings` and
--      `bulletins` while preserving instant Admin/Superadmin moderation override.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. UPGRADE `public.subscription_plans` SCHEMA & CONSTRAINTS
-- -----------------------------------------------------------------------------
ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS is_default_free boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS trial_days integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS auto_trial_on_approval boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS target_scope text NOT NULL DEFAULT 'public',
  ADD COLUMN IF NOT EXISTS target_user_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  ADD COLUMN IF NOT EXISTS is_archived boolean NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.subscription_plans'::regclass
      AND conname = 'subscription_plans_trial_days_v17b_check'
  ) THEN
    ALTER TABLE public.subscription_plans
      ADD CONSTRAINT subscription_plans_trial_days_v17b_check
      CHECK (trial_days >= 0 AND trial_days <= 365);
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.subscription_plans'::regclass
      AND conname = 'subscription_plans_target_scope_v17b_check'
  ) THEN
    ALTER TABLE public.subscription_plans
      ADD CONSTRAINT subscription_plans_target_scope_v17b_check
      CHECK (target_scope IN ('public', 'selected_users'));
  END IF;
END;
$$;

-- Enforce exactly ONE canonical Default Free baseline plan across the catalog
CREATE UNIQUE INDEX IF NOT EXISTS idx_subscription_plans_single_default_free
  ON public.subscription_plans (is_default_free)
  WHERE is_default_free = true;

-- Fast lookup for targeted user plans in RLS & queries
CREATE INDEX IF NOT EXISTS idx_subscription_plans_target_user_ids_gin
  ON public.subscription_plans USING GIN (target_user_ids);

CREATE INDEX IF NOT EXISTS idx_subscription_plans_visibility_v17b
  ON public.subscription_plans (is_active, is_archived, target_scope, sort_order ASC);

-- Guard the Default Free Tier from accidental deletion, archival, deactivation, or targeting lock
CREATE OR REPLACE FUNCTION public.guard_default_free_plan_v17b()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.is_default_free THEN
      RAISE EXCEPTION 'The canonical Default Free Tier plan cannot be deleted.'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN OLD;
  END IF;

  IF OLD.is_default_free THEN
    IF NEW.is_default_free IS DISTINCT FROM true THEN
      RAISE EXCEPTION 'Cannot unset is_default_free on the canonical Default Free Tier plan.'
        USING ERRCODE = 'P0001';
    END IF;
    IF NEW.is_archived = true THEN
      RAISE EXCEPTION 'The canonical Default Free Tier plan cannot be archived.'
        USING ERRCODE = 'P0001';
    END IF;
    IF NEW.is_active = false THEN
      RAISE EXCEPTION 'The canonical Default Free Tier plan must remain active.'
        USING ERRCODE = 'P0001';
    END IF;
    NEW.target_scope := 'public';
    NEW.target_user_ids := '{}'::uuid[];
    NEW.price_inr := 0;
  END IF;

  -- Keep staffing.max_staff <-> staffing.limit synchronized inside entitlements JSONB
  IF NEW.entitlements IS NOT NULL AND jsonb_typeof(NEW.entitlements->'staffing') = 'object' THEN
    DECLARE
      v_staff jsonb := NEW.entitlements->'staffing';
      v_staff_enabled boolean := COALESCE((v_staff->>'enabled')::boolean, false);
      v_staff_limit jsonb := COALESCE(v_staff->'max_staff', v_staff->'limit', '0'::jsonb);
    BEGIN
      IF NOT v_staff_enabled THEN
        v_staff_limit := '0'::jsonb;
      END IF;
      NEW.entitlements := jsonb_set(
        NEW.entitlements,
        ARRAY['staffing'],
        jsonb_build_object(
          'enabled', v_staff_enabled,
          'max_staff', v_staff_limit,
          'limit', v_staff_limit
        ),
        true
      );
    END;
  END IF;

  -- Ensure auto_verify_listings & auto_verify_bulletins always exist as explicit booleans
  IF NEW.entitlements IS NOT NULL AND jsonb_typeof(NEW.entitlements) = 'object' THEN
    IF NOT (NEW.entitlements ? 'auto_verify_listings') THEN
      NEW.entitlements := jsonb_set(NEW.entitlements, ARRAY['auto_verify_listings'], 'false'::jsonb, true);
    END IF;
    IF NOT (NEW.entitlements ? 'auto_verify_bulletins') THEN
      NEW.entitlements := jsonb_set(NEW.entitlements, ARRAY['auto_verify_bulletins'], 'false'::jsonb, true);
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_default_free_plan_v17b ON public.subscription_plans;
CREATE TRIGGER trg_guard_default_free_plan_v17b
  BEFORE UPDATE OR DELETE ON public.subscription_plans
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_default_free_plan_v17b();

-- -----------------------------------------------------------------------------
-- 2. UPSERT DEFAULT FREE TIER + CONSOLIDATE LEGACY PLANS + ARCHIVE REDUNDANT
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_default_free_id uuid;
  v_fallback_business_plan_id uuid;
  v_redundant record;
  v_migrated_count integer := 0;
  v_default_free_entitlements jsonb := jsonb_build_object(
    'allowed_listing_types', jsonb_build_array(
      'general', 'business', 'service',
      'shop_catalogue', 'restaurant_food', 'booking_venue',
      'hotel_stay', 'print_digital', 'real_estate'
    ),
    'allowed_root_keys', jsonb_build_array(
      'general', 'shop_catalogue', 'restaurant_food',
      'booking_venue', 'hotel_stay', 'print_digital', 'real_estate'
    ),
    'allowed_category_ids', '[]'::jsonb,
    'max_listings', 1,
    'max_marketplace_items', 5,
    'pnd_dispatch', jsonb_build_object('enabled', false, 'limit', 0),
    'online_payment', jsonb_build_object('enabled', false, 'limit', null),
    'print_order', jsonb_build_object('enabled', false, 'limit', 0),
    'real_estate_poly', jsonb_build_object('enabled', false, 'limit', 0),
    'staffing', jsonb_build_object('enabled', false, 'max_staff', 0, 'limit', 0),
    'bulletins', jsonb_build_object('enabled', false, 'limit', 0),
    'bookings', jsonb_build_object('enabled', false, 'limit', 0),
    'panorama_360', jsonb_build_object('enabled', false, 'limit', 0),
    'featured_boost', jsonb_build_object('enabled', false, 'limit', 0),
    'auto_verify_listings', false,
    'auto_verify_bulletins', false
  );
BEGIN
  -- 2A. Ensure exactly one canonical Default Free Tier exists
  SELECT id INTO v_default_free_id
  FROM public.subscription_plans
  WHERE is_default_free = true
  LIMIT 1;

  IF v_default_free_id IS NULL THEN
    SELECT id INTO v_default_free_id
    FROM public.subscription_plans
    WHERE slug = 'default-free-tier'
    LIMIT 1;
  END IF;

  IF v_default_free_id IS NULL THEN
    INSERT INTO public.subscription_plans (
      slug,
      name,
      title,
      tagline,
      info,
      price_inr,
      max_active_bulletins,
      max_monthly_posts,
      max_images_per_post,
      allow_youtube,
      duration_days,
      is_active,
      is_archived,
      is_default_free,
      trial_days,
      auto_trial_on_approval,
      target_scope,
      target_user_ids,
      plan_scope,
      billing_cycle,
      is_addon,
      sort_order,
      display_order,
      applicable_roles,
      applicable_root_keys,
      applicable_category_ids,
      entitlements,
      features,
      limits
    )
    VALUES (
      'default-free-tier',
      'Default Free Tier',
      'Default Free Tier',
      'Baseline starter access for every registered DD oodle partner and expired subscriber.',
      'Baseline starter access for every registered DD oodle partner and expired subscriber.',
      0,
      0,
      0,
      3,
      false,
      3650,
      true,
      false,
      true,
      0,
      false,
      'public',
      '{}'::uuid[],
      'default_free',
      'free',
      false,
      0,
      0,
      ARRAY['user', 'owner', 'service_provider', 'partner', 'driver']::text[],
      ARRAY['general', 'shop_catalogue', 'restaurant_food', 'booking_venue', 'hotel_stay', 'print_digital', 'real_estate']::text[],
      '{}'::uuid[],
      v_default_free_entitlements,
      '{"online_payment":false,"pick_n_drop_dispatch":false,"print_online_orders":false,"booking_slots":false,"hotel_rooms":false,"panorama_360":false,"staff_delegation":false,"bulletin_posting":false}'::jsonb,
      '{"max_listings":1,"max_marketplace_items":5,"max_staff_members":0}'::jsonb
    )
    RETURNING id INTO v_default_free_id;
  ELSE
    UPDATE public.subscription_plans
    SET
      is_default_free = true,
      is_active = true,
      is_archived = false,
      target_scope = 'public',
      target_user_ids = '{}'::uuid[],
      price_inr = 0,
      sort_order = 0,
      display_order = 0,
      applicable_roles = CASE
        WHEN COALESCE(array_length(applicable_roles, 1), 0) = 0
        THEN ARRAY['user', 'owner', 'service_provider', 'partner', 'driver']::text[]
        ELSE applicable_roles
      END,
      applicable_root_keys = CASE
        WHEN COALESCE(array_length(applicable_root_keys, 1), 0) = 0
        THEN ARRAY['general', 'shop_catalogue', 'restaurant_food', 'booking_venue', 'hotel_stay', 'print_digital', 'real_estate']::text[]
        ELSE applicable_root_keys
      END,
      entitlements = v_default_free_entitlements || COALESCE(entitlements, '{}'::jsonb)
    WHERE id = v_default_free_id;
  END IF;

  -- 2B. Normalize fragmented legacy Bulletin-only plans ('starter', 'business', 'agency')
  --     into unified role-based plans with canonical entitlements JSONB
  UPDATE public.subscription_plans
  SET
    applicable_roles = CASE
      WHEN COALESCE(array_length(applicable_roles, 1), 0) = 0
      THEN ARRAY['user', 'owner', 'service_provider', 'partner']::text[]
      ELSE applicable_roles
    END,
    applicable_root_keys = CASE
      WHEN COALESCE(array_length(applicable_root_keys, 1), 0) = 0
      THEN ARRAY['general', 'shop_catalogue', 'restaurant_food', 'booking_venue', 'hotel_stay', 'print_digital', 'real_estate']::text[]
      ELSE applicable_root_keys
    END,
    entitlements = jsonb_build_object(
      'allowed_listing_types', COALESCE(entitlements->'allowed_listing_types', '["general","business","service"]'::jsonb),
      'allowed_root_keys', COALESCE(entitlements->'allowed_root_keys', '["general","shop_catalogue","restaurant_food","booking_venue","hotel_stay","print_digital","real_estate"]'::jsonb),
      'allowed_category_ids', COALESCE(entitlements->'allowed_category_ids', '[]'::jsonb),
      'max_listings', CASE
        WHEN slug = 'agency' THEN 10
        WHEN slug = 'business' THEN 3
        ELSE 1
      END,
      'max_marketplace_items', CASE
        WHEN slug = 'agency' THEN 50
        WHEN slug = 'business' THEN 20
        ELSE 10
      END,
      'pnd_dispatch', COALESCE(entitlements->'pnd_dispatch', jsonb_build_object('enabled', slug IN ('business', 'agency'), 'limit', NULL)),
      'online_payment', COALESCE(entitlements->'online_payment', jsonb_build_object('enabled', slug IN ('business', 'agency'), 'limit', NULL)),
      'print_order', COALESCE(entitlements->'print_order', jsonb_build_object('enabled', false, 'limit', 0)),
      'real_estate_poly', COALESCE(entitlements->'real_estate_poly', jsonb_build_object('enabled', slug = 'agency', 'limit', CASE WHEN slug = 'agency' THEN 5 ELSE 0 END)),
      'staffing', COALESCE(
        entitlements->'staffing',
        jsonb_build_object(
          'enabled', slug IN ('business', 'agency'),
          'max_staff', CASE WHEN slug = 'agency' THEN 10 WHEN slug = 'business' THEN 3 ELSE 0 END,
          'limit', CASE WHEN slug = 'agency' THEN 10 WHEN slug = 'business' THEN 3 ELSE 0 END
        )
      ),
      'bulletins', jsonb_build_object('enabled', true, 'limit', GREATEST(COALESCE(max_monthly_posts, 4), 1)),
      'bookings', COALESCE(entitlements->'bookings', jsonb_build_object('enabled', slug = 'agency', 'limit', NULL)),
      'panorama_360', COALESCE(entitlements->'panorama_360', jsonb_build_object('enabled', slug IN ('business', 'agency'), 'limit', CASE WHEN slug = 'agency' THEN 10 WHEN slug = 'business' THEN 3 ELSE 0 END)),
      'featured_boost', COALESCE(entitlements->'featured_boost', jsonb_build_object('enabled', slug = 'agency', 'limit', CASE WHEN slug = 'agency' THEN 3 ELSE 0 END)),
      'auto_verify_listings', COALESCE((entitlements->>'auto_verify_listings')::boolean, false),
      'auto_verify_bulletins', COALESCE((entitlements->>'auto_verify_bulletins')::boolean, false)
    ),
    trial_days = CASE
      WHEN slug = 'business' AND COALESCE(trial_days, 0) = 0 THEN 14
      ELSE COALESCE(trial_days, 0)
    END
  WHERE slug IN ('starter', 'business', 'agency')
    AND is_default_free = false;

  -- Give Merchant All-in-One a clean 14-day default trial if none set yet
  UPDATE public.subscription_plans
  SET trial_days = 14
  WHERE slug = 'merchant_all_in_one_monthly'
    AND COALESCE(trial_days, 0) = 0
    AND is_default_free = false;

  -- 2C. Normalize staffing.max_staff <-> staffing.limit & auto_verify booleans across ALL plans
  UPDATE public.subscription_plans
  SET entitlements = jsonb_set(
    jsonb_set(
      jsonb_set(
        COALESCE(entitlements, '{}'::jsonb),
        ARRAY['staffing'],
        jsonb_build_object(
          'enabled', COALESCE((entitlements->'staffing'->>'enabled')::boolean, (features->>'staff_delegation')::boolean, false),
          'max_staff', CASE
            WHEN COALESCE((entitlements->'staffing'->>'enabled')::boolean, (features->>'staff_delegation')::boolean, false) = false THEN '0'::jsonb
            ELSE COALESCE(entitlements->'staffing'->'max_staff', entitlements->'staffing'->'limit', limits->'max_staff_members', '3'::jsonb)
          END,
          'limit', CASE
            WHEN COALESCE((entitlements->'staffing'->>'enabled')::boolean, (features->>'staff_delegation')::boolean, false) = false THEN '0'::jsonb
            ELSE COALESCE(entitlements->'staffing'->'max_staff', entitlements->'staffing'->'limit', limits->'max_staff_members', '3'::jsonb)
          END
        ),
        true
      ),
      ARRAY['auto_verify_listings'],
      to_jsonb(COALESCE((entitlements->>'auto_verify_listings')::boolean, false)),
      true
    ),
    ARRAY['auto_verify_bulletins'],
    to_jsonb(COALESCE((entitlements->>'auto_verify_bulletins')::boolean, false)),
    true
  )
  WHERE is_default_free = false;

  -- 2D. Archive any redundant 'General Business' plan cleanly (migrating active subscribers first)
  SELECT id INTO v_fallback_business_plan_id
  FROM public.subscription_plans
  WHERE slug IN ('business', 'merchant_all_in_one_monthly', 'catalogue_pro_monthly')
    AND is_active = true
    AND is_archived = false
    AND is_default_free = false
  ORDER BY
    CASE slug
      WHEN 'business' THEN 1
      WHEN 'merchant_all_in_one_monthly' THEN 2
      ELSE 3
    END
  LIMIT 1;

  FOR v_redundant IN
    SELECT id, slug, name
    FROM public.subscription_plans
    WHERE is_default_free = false
      AND (
        lower(trim(slug)) IN (
          'general-business',
          'general_business',
          'general-business-monthly',
          'general_business_monthly',
          'general_business_plan'
        )
        OR lower(trim(COALESCE(name, title, ''))) IN (
          'general business',
          'general business & services',
          'general business plan'
        )
      )
  LOOP
    IF v_fallback_business_plan_id IS NOT NULL AND v_fallback_business_plan_id <> v_redundant.id THEN
      UPDATE public.user_subscriptions
      SET
        plan_id = v_fallback_business_plan_id,
        updated_at = now()
      WHERE plan_id = v_redundant.id
        AND status IN ('active', 'trialing')
        AND COALESCE(ends_at, expires_at) > now();

      GET DIAGNOSTICS v_migrated_count = ROW_COUNT;
    END IF;

    UPDATE public.subscription_plans
    SET
      is_active = false,
      is_archived = true,
      updated_at = now()
    WHERE id = v_redundant.id;

    IF to_regclass('public.audit_logs') IS NOT NULL THEN
      INSERT INTO public.audit_logs (
        actor_id,
        actor_role,
        workspace,
        action,
        target_table,
        target_id,
        details,
        metadata
      )
      VALUES (
        NULL,
        'system',
        'admin',
        'archive_redundant_plan',
        'subscription_plans',
        v_redundant.id::text,
        'Archived redundant subscription plan ' || COALESCE(v_redundant.name, v_redundant.slug),
        jsonb_build_object(
          'slug', v_redundant.slug,
          'name', v_redundant.name,
          'migrated_active_subscriptions', v_migrated_count,
          'target_plan_id', v_fallback_business_plan_id,
          'migration', 'v17b'
        )
      );
    END IF;
  END LOOP;
END;
$$;

-- -----------------------------------------------------------------------------
-- 3. UPDATED RLS ON `subscription_plans` & `subscription_plan_prices`
-- -----------------------------------------------------------------------------
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read active subscription plans" ON public.subscription_plans;
DROP POLICY IF EXISTS subscription_plans_select_policy ON public.subscription_plans;
DROP POLICY IF EXISTS subscription_plans_v15b_select ON public.subscription_plans;
DROP POLICY IF EXISTS subscription_plans_v17b_select ON public.subscription_plans;

CREATE POLICY subscription_plans_v17b_select
  ON public.subscription_plans
  FOR SELECT
  USING (
    public.is_super_admin()
    OR (
      is_active = true
      AND is_archived = false
      AND (
        target_scope = 'public'
        OR (
          auth.uid() IS NOT NULL
          AND target_scope = 'selected_users'
          AND auth.uid() = ANY(target_user_ids)
        )
      )
    )
  );

-- Prices inherit visibility strictly from their parent plan
ALTER TABLE public.subscription_plan_prices ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS subscription_plan_prices_select ON public.subscription_plan_prices;
DROP POLICY IF EXISTS subscription_plan_prices_v15b_select ON public.subscription_plan_prices;
DROP POLICY IF EXISTS subscription_plan_prices_v17b_select ON public.subscription_plan_prices;

CREATE POLICY subscription_plan_prices_v17b_select
  ON public.subscription_plan_prices
  FOR SELECT
  USING (
    public.is_super_admin()
    OR EXISTS (
      SELECT 1
      FROM public.subscription_plans sp
      WHERE sp.id = subscription_plan_prices.plan_id
        AND sp.is_active = true
        AND sp.is_archived = false
        AND (
          sp.target_scope = 'public'
          OR (
            auth.uid() IS NOT NULL
            AND sp.target_scope = 'selected_users'
            AND auth.uid() = ANY(sp.target_user_ids)
          )
        )
    )
  );

-- -----------------------------------------------------------------------------
-- 4. UPGRADE `public.user_subscriptions` & `public.profiles` FOR TRIALS
-- -----------------------------------------------------------------------------
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS trial_used_at timestamptz NULL;

DO $$
DECLARE
  v_con record;
BEGIN
  -- Normalize status check constraint so 'trialing' is guaranteed accepted
  FOR v_con IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.user_subscriptions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.user_subscriptions DROP CONSTRAINT IF EXISTS %I', v_con.conname);
  END LOOP;

  ALTER TABLE public.user_subscriptions
    ADD CONSTRAINT user_subscriptions_status_v17b_check
    CHECK (
      status IN (
        'trialing',
        'active',
        'suspended',
        'expired',
        'pending',
        'cancelled',
        'paused',
        'pending_payment'
      )
    );
END;
$$;

-- -----------------------------------------------------------------------------
-- 5. FREE TRIAL RPCs (`start_plan_trial`, `reset_user_trial_eligibility`)
--    & PARTNER APPROVAL AUTO-TRIAL TRIGGER
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_plan_trial(p_plan_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_profile record;
  v_plan record;
  v_existing_count integer := 0;
  v_starts_at timestamptz := now();
  v_ends_at timestamptz;
  v_sub_id uuid;
  v_ref text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required to start a free trial.'
      USING ERRCODE = '42501';
  END IF;

  IF p_plan_id IS NULL THEN
    RAISE EXCEPTION 'A valid plan ID is required.'
      USING ERRCODE = '22023';
  END IF;

  -- Lock profile row to prevent race-condition double trials
  SELECT id, trial_used_at, role
    INTO v_profile
  FROM public.profiles
  WHERE id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User profile not found.'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_profile.trial_used_at IS NOT NULL THEN
    RAISE EXCEPTION 'You have already used your one-time free trial.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Validate plan eligibility, visibility, and trial duration
  SELECT
    id,
    slug,
    COALESCE(title, name) AS plan_name,
    is_active,
    is_archived,
    is_default_free,
    trial_days,
    target_scope,
    target_user_ids,
    entitlements
  INTO v_plan
  FROM public.subscription_plans
  WHERE id = p_plan_id;

  IF NOT FOUND OR v_plan.is_active IS DISTINCT FROM true OR v_plan.is_archived = true THEN
    RAISE EXCEPTION 'Selected plan is not currently available.'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_plan.is_default_free = true THEN
    RAISE EXCEPTION 'The Default Free Tier does not require a trial.'
      USING ERRCODE = 'P0001';
  END IF;

  IF COALESCE(v_plan.trial_days, 0) <= 0 THEN
    RAISE EXCEPTION 'This plan does not offer a free trial.'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_plan.target_scope = 'selected_users'
     AND NOT (v_uid = ANY(COALESCE(v_plan.target_user_ids, '{}'::uuid[]))) THEN
    RAISE EXCEPTION 'You are not eligible for this targeted plan.'
      USING ERRCODE = '42501';
  END IF;

  -- Prevent duplicate active or trialing subscription on the same plan
  SELECT count(*)
    INTO v_existing_count
  FROM public.user_subscriptions us
  WHERE us.user_id = v_uid
    AND us.plan_id = p_plan_id
    AND us.status IN ('active', 'trialing')
    AND COALESCE(us.ends_at, us.expires_at) > now();

  IF v_existing_count > 0 THEN
    RAISE EXCEPTION 'You already have an active or trialing subscription on this plan.'
      USING ERRCODE = 'P0001';
  END IF;

  v_ends_at := v_starts_at + make_interval(days => v_plan.trial_days);
  v_ref := 'TRIAL-' || upper(substr(md5(v_uid::text || p_plan_id::text || clock_timestamp()::text), 1, 8));

  INSERT INTO public.user_subscriptions (
    user_id,
    plan_id,
    status,
    starts_at,
    ends_at,
    expires_at,
    entitlements_snapshot,
    custom_overrides,
    payment_ref
  )
  VALUES (
    v_uid,
    p_plan_id,
    'trialing',
    v_starts_at,
    v_ends_at,
    v_ends_at,
    COALESCE(v_plan.entitlements, '{}'::jsonb),
    '{}'::jsonb,
    v_ref
  )
  RETURNING id INTO v_sub_id;

  UPDATE public.profiles
  SET trial_used_at = v_starts_at
  WHERE id = v_uid;

  IF to_regclass('public.audit_logs') IS NOT NULL THEN
    INSERT INTO public.audit_logs (
      actor_id,
      actor_role,
      workspace,
      action,
      target_table,
      target_id,
      details,
      metadata
    )
    VALUES (
      v_uid,
      COALESCE(v_profile.role, 'user'),
      'subscriptions',
      'start_plan_trial',
      'user_subscriptions',
      v_sub_id::text,
      'Started free trial for plan ' || COALESCE(v_plan.plan_name, v_plan.slug),
      jsonb_build_object(
        'plan_id', p_plan_id::text,
        'plan_slug', v_plan.slug,
        'plan_name', v_plan.plan_name,
        'trial_days', v_plan.trial_days,
        'ends_at', v_ends_at,
        'payment_ref', v_ref
      )
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'subscription_id', v_sub_id,
    'plan_id', p_plan_id,
    'plan_name', v_plan.plan_name,
    'status', 'trialing',
    'trial_days', v_plan.trial_days,
    'starts_at', v_starts_at,
    'ends_at', v_ends_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.start_plan_trial(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.start_plan_trial(uuid) TO authenticated, service_role;

-- Superadmin helper RPC to reset a user's trial eligibility safely with audit logging
CREATE OR REPLACE FUNCTION public.reset_user_trial_eligibility(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only super_admin can reset trial eligibility.'
      USING ERRCODE = '42501';
  END IF;

  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Target user_id is required.'
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.profiles
  SET trial_used_at = NULL
  WHERE id = p_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target user profile not found.'
      USING ERRCODE = 'P0002';
  END IF;

  IF to_regclass('public.audit_logs') IS NOT NULL THEN
    INSERT INTO public.audit_logs (
      actor_id,
      actor_role,
      workspace,
      action,
      target_table,
      target_id,
      details,
      metadata
    )
    VALUES (
      auth.uid(),
      'super_admin',
      'admin',
      'reset_trial_eligibility',
      'profiles',
      p_user_id::text,
      'Reset free trial eligibility for user ' || p_user_id::text,
      jsonb_build_object('target_user_id', p_user_id::text)
    );
  END IF;

  RETURN jsonb_build_object('ok', true, 'user_id', p_user_id);
END;
$$;

REVOKE ALL ON FUNCTION public.reset_user_trial_eligibility(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reset_user_trial_eligibility(uuid) TO authenticated, service_role;

-- Optional Auto-Start Trial on Partner Approval trigger (`auto_trial_on_approval = true`)
DO $$
BEGIN
  IF to_regclass('public.partner_applications') IS NOT NULL THEN
    CREATE OR REPLACE FUNCTION public.handle_partner_approval_auto_trial_v17b()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $fn$
    DECLARE
      v_profile record;
      v_plan record;
      v_ends_at timestamptz;
      v_sub_id uuid;
    BEGIN
      IF OLD.status IS DISTINCT FROM 'approved' AND NEW.status = 'approved' AND NEW.applicant_id IS NOT NULL THEN
        SELECT id, role, trial_used_at
          INTO v_profile
        FROM public.profiles
        WHERE id = NEW.applicant_id
        FOR UPDATE;

        IF FOUND AND v_profile.trial_used_at IS NULL THEN
          SELECT id, slug, COALESCE(title, name) AS plan_name, trial_days, entitlements
            INTO v_plan
          FROM public.subscription_plans sp
          WHERE sp.is_active = true
            AND sp.is_archived = false
            AND sp.is_default_free = false
            AND sp.auto_trial_on_approval = true
            AND sp.trial_days > 0
            AND (
              sp.target_scope = 'public'
              OR NEW.applicant_id = ANY(COALESCE(sp.target_user_ids, '{}'::uuid[]))
            )
            AND (
              COALESCE(array_length(sp.applicable_roles, 1), 0) = 0
              OR lower(COALESCE(v_profile.role, 'owner')) = ANY(sp.applicable_roles)
              OR 'partner' = ANY(sp.applicable_roles)
              OR 'owner' = ANY(sp.applicable_roles)
            )
          ORDER BY sp.sort_order ASC, sp.created_at ASC
          LIMIT 1;

          IF FOUND THEN
            v_ends_at := now() + make_interval(days => v_plan.trial_days);

            INSERT INTO public.user_subscriptions (
              user_id,
              plan_id,
              status,
              starts_at,
              ends_at,
              expires_at,
              entitlements_snapshot,
              custom_overrides,
              payment_ref
            )
            VALUES (
              NEW.applicant_id,
              v_plan.id,
              'trialing',
              now(),
              v_ends_at,
              v_ends_at,
              COALESCE(v_plan.entitlements, '{}'::jsonb),
              '{}'::jsonb,
              'AUTO-TRIAL-' || upper(substr(md5(NEW.id::text || clock_timestamp()::text), 1, 8))
            )
            RETURNING id INTO v_sub_id;

            UPDATE public.profiles
            SET trial_used_at = now()
            WHERE id = NEW.applicant_id;

            IF to_regclass('public.audit_logs') IS NOT NULL THEN
              INSERT INTO public.audit_logs (
                actor_id,
                actor_role,
                workspace,
                action,
                target_table,
                target_id,
                details,
                metadata
              )
              VALUES (
                auth.uid(),
                'super_admin',
                'admin',
                'auto_trial_on_partner_approval',
                'user_subscriptions',
                v_sub_id::text,
                'Auto-started free trial on partner approval for ' || COALESCE(v_plan.plan_name, 'plan'),
                jsonb_build_object(
                  'application_id', NEW.id::text,
                  'applicant_id', NEW.applicant_id::text,
                  'plan_id', v_plan.id::text,
                  'plan_name', v_plan.plan_name,
                  'trial_days', v_plan.trial_days,
                  'ends_at', v_ends_at
                )
              );
            END IF;
          END IF;
        END IF;
      END IF;
      RETURN NEW;
    END;
    $fn$;

    DROP TRIGGER IF EXISTS trg_partner_approval_auto_trial_v17b ON public.partner_applications;
    CREATE TRIGGER trg_partner_approval_auto_trial_v17b
      AFTER UPDATE OF status ON public.partner_applications
      FOR EACH ROW
      EXECUTE FUNCTION public.handle_partner_approval_auto_trial_v17b();
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- 6. UPGRADE `public.get_effective_entitlements` (v17b: LIVE DEFAULT FREE TIER,
--    TRIALING STATUS, STAFFING MAX_STAFF, AUTO_VERIFY FLAGS, v16b INHERITANCE)
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
  v_role text := 'user';
  v_sub record;
  v_active_count integer := 0;
  v_has_paid_active boolean := false;
  v_has_trialing boolean := false;
  v_latest_status text := 'none';
  v_latest_ends_at timestamptz := NULL;

  -- Live Default Free baseline row
  v_free_plan record;
  v_free_ent jsonb := '{}'::jsonb;
  v_free_root_keys text[] := ARRAY[
    'general', 'shop_catalogue', 'restaurant_food',
    'booking_venue', 'hotel_stay', 'print_digital', 'real_estate'
  ]::text[];
  v_free_cat_ids text[] := ARRAY[]::text[];

  v_allowed_listing_types text[] := ARRAY['general', 'business', 'service']::text[];
  v_allowed_root_keys text[] := ARRAY[
    'general', 'shop_catalogue', 'restaurant_food',
    'booking_venue', 'hotel_stay', 'print_digital', 'real_estate'
  ]::text[];
  v_allowed_category_ids text[] := ARRAY[]::text[];

  v_max_listings integer := 1;
  v_max_listings_unlimited boolean := false;
  v_max_marketplace_items integer := 5;
  v_max_marketplace_unlimited boolean := false;

  v_auto_verify_listings boolean := false;
  v_auto_verify_bulletins boolean := false;

  v_v15b_features jsonb := jsonb_build_object(
    'pnd_dispatch', jsonb_build_object('enabled', false, 'limit', 0),
    'online_payment', jsonb_build_object('enabled', false, 'limit', null),
    'print_order', jsonb_build_object('enabled', false, 'limit', 0),
    'real_estate_poly', jsonb_build_object('enabled', false, 'limit', 0),
    'staffing', jsonb_build_object('enabled', false, 'max_staff', 0, 'limit', 0),
    'bulletins', jsonb_build_object('enabled', false, 'limit', 0),
    'bookings', jsonb_build_object('enabled', false, 'limit', 0),
    'panorama_360', jsonb_build_object('enabled', false, 'limit', 0),
    'featured_boost', jsonb_build_object('enabled', false, 'limit', 0)
  );

  v_legacy_features jsonb := '{}'::jsonb;
  v_legacy_limits jsonb := '{}'::jsonb;
  v_active_plan_ids jsonb := '[]'::jsonb;

  v_snap jsonb;
  v_ovr jsonb;
  v_eff jsonb;
  v_fk text;
  v_cur jsonb;
  v_inc jsonb;
  v_cur_en boolean;
  v_inc_en boolean;
  v_cur_lim integer;
  v_inc_lim integer;
  v_new_lim jsonb;
  v_val text;
  v_root_key text;
  v_cat_id text;
  v_key_list text[] := ARRAY[
    'pnd_dispatch', 'online_payment', 'print_order', 'real_estate_poly',
    'staffing', 'bulletins', 'bookings', 'panorama_360', 'featured_boost'
  ];
BEGIN
  -- 1. Load live Default Free Tier from subscription_plans so edits in Master Console take effect immediately
  SELECT entitlements, applicable_root_keys, applicable_category_ids
    INTO v_free_plan
  FROM public.subscription_plans
  WHERE is_default_free = true
  LIMIT 1;

  IF FOUND THEN
    v_free_ent := COALESCE(v_free_plan.entitlements, '{}'::jsonb);

    IF COALESCE(array_length(v_free_plan.applicable_root_keys, 1), 0) > 0 THEN
      v_free_root_keys := v_free_plan.applicable_root_keys;
    ELSIF jsonb_typeof(v_free_ent->'allowed_root_keys') = 'array' THEN
      SELECT COALESCE(array_agg(x), v_free_root_keys)
        INTO v_free_root_keys
      FROM jsonb_array_elements_text(v_free_ent->'allowed_root_keys') AS x;
    END IF;

    IF COALESCE(array_length(v_free_plan.applicable_category_ids, 1), 0) > 0 THEN
      SELECT COALESCE(array_agg(x::text), ARRAY[]::text[])
        INTO v_free_cat_ids
      FROM unnest(v_free_plan.applicable_category_ids) AS x;
    END IF;

    v_allowed_root_keys := v_free_root_keys;
    v_allowed_category_ids := v_free_cat_ids;

    IF jsonb_typeof(v_free_ent->'allowed_listing_types') = 'array' THEN
      SELECT COALESCE(array_agg(x), v_allowed_listing_types)
        INTO v_allowed_listing_types
      FROM jsonb_array_elements_text(v_free_ent->'allowed_listing_types') AS x;
    END IF;

    IF v_free_ent ? 'max_listings' THEN
      IF v_free_ent->'max_listings' = 'null'::jsonb THEN
        v_max_listings_unlimited := true;
      ELSIF jsonb_typeof(v_free_ent->'max_listings') = 'number' THEN
        v_max_listings := GREATEST(0, (v_free_ent->>'max_listings')::integer);
      END IF;
    END IF;

    IF v_free_ent ? 'max_marketplace_items' THEN
      IF v_free_ent->'max_marketplace_items' = 'null'::jsonb THEN
        v_max_marketplace_unlimited := true;
      ELSIF jsonb_typeof(v_free_ent->'max_marketplace_items') = 'number' THEN
        v_max_marketplace_items := GREATEST(0, (v_free_ent->>'max_marketplace_items')::integer);
      END IF;
    END IF;

    v_auto_verify_listings := COALESCE((v_free_ent->>'auto_verify_listings')::boolean, false);
    v_auto_verify_bulletins := COALESCE((v_free_ent->>'auto_verify_bulletins')::boolean, false);

    FOREACH v_fk IN ARRAY v_key_list LOOP
      IF jsonb_typeof(v_free_ent->v_fk) = 'object' THEN
        v_inc := v_free_ent->v_fk;
        v_inc_en := COALESCE((v_inc->>'enabled')::boolean, false);
        IF v_fk = 'staffing' THEN
          v_new_lim := COALESCE(v_inc->'max_staff', v_inc->'limit', CASE WHEN v_inc_en THEN 'null'::jsonb ELSE '0'::jsonb END);
          v_v15b_features := jsonb_set(
            v_v15b_features,
            ARRAY[v_fk],
            jsonb_build_object('enabled', v_inc_en, 'max_staff', v_new_lim, 'limit', v_new_lim),
            true
          );
        ELSE
          v_new_lim := COALESCE(v_inc->'limit', CASE WHEN v_inc_en THEN 'null'::jsonb ELSE '0'::jsonb END);
          v_v15b_features := jsonb_set(
            v_v15b_features,
            ARRAY[v_fk],
            jsonb_build_object('enabled', v_inc_en, 'limit', v_new_lim),
            true
          );
        END IF;
      END IF;
    END LOOP;
  END IF;

  -- Unauthenticated / null user returns the live Default Free Tier baseline
  IF p_user_id IS NULL THEN
    RETURN jsonb_build_object(
      'allowed_listing_types', to_jsonb(v_allowed_listing_types),
      'allowed_root_keys', to_jsonb(v_allowed_root_keys),
      'allowed_category_ids', to_jsonb(v_allowed_category_ids),
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
      'auto_verify_listings', v_auto_verify_listings,
      'auto_verify_bulletins', v_auto_verify_bulletins,
      'is_free_baseline', true,
      'has_active_subscription', false,
      'subscription_status', 'none',
      'ends_at', NULL,
      'is_super_admin_bypass', false,
      'active_plan_ids', '[]'::jsonb,
      'features', '{}'::jsonb,
      'limits', jsonb_build_object(
        'max_listings', CASE WHEN v_max_listings_unlimited THEN 9999 ELSE v_max_listings END,
        'max_marketplace_items', CASE WHEN v_max_marketplace_unlimited THEN 9999 ELSE v_max_marketplace_items END,
        'max_staff_members', COALESCE((v_v15b_features->'staffing'->>'max_staff')::integer, 0)
      )
    );
  END IF;

  SELECT lower(COALESCE(role, 'user'))
    INTO v_role
  FROM public.profiles
  WHERE id = p_user_id;

  -- Super admin bypass: full unlimited capabilities across all 8 canonical roots
  IF v_role = 'super_admin' THEN
    RETURN jsonb_build_object(
      'allowed_listing_types', jsonb_build_array(
        'general', 'business', 'service', 'real_estate', 'sports',
        'print_digital', 'booking_venue', 'shop_catalogue', 'restaurant_food', 'hotel_stay', 'public_civic'
      ),
      'allowed_root_keys', jsonb_build_array(
        'general', 'shop_catalogue', 'restaurant_food', 'booking_venue',
        'hotel_stay', 'print_digital', 'real_estate', 'public_civic'
      ),
      'allowed_category_ids', '[]'::jsonb,
      'max_listings', NULL,
      'max_marketplace_items', NULL,
      'pnd_dispatch', jsonb_build_object('enabled', true, 'limit', null),
      'online_payment', jsonb_build_object('enabled', true, 'limit', null),
      'print_order', jsonb_build_object('enabled', true, 'limit', null),
      'real_estate_poly', jsonb_build_object('enabled', true, 'limit', null),
      'staffing', jsonb_build_object('enabled', true, 'max_staff', null, 'limit', null),
      'bulletins', jsonb_build_object('enabled', true, 'limit', null),
      'bookings', jsonb_build_object('enabled', true, 'limit', null),
      'panorama_360', jsonb_build_object('enabled', true, 'limit', null),
      'featured_boost', jsonb_build_object('enabled', true, 'limit', null),
      'auto_verify_listings', true,
      'auto_verify_bulletins', true,
      'is_free_baseline', false,
      'has_active_subscription', true,
      'subscription_status', 'active',
      'ends_at', NULL,
      'is_super_admin_bypass', true,
      'active_plan_ids', '[]'::jsonb,
      'features', jsonb_build_object(
        'online_payment', true,
        'pick_n_drop_dispatch', true,
        'print_online_orders', true,
        'bulletin_posting', true,
        'real_estate_polygon', true,
        'staff_delegation', true,
        'booking_slots', true,
        'hotel_rooms', true,
        'panorama_360', true,
        'featured_boost', true
      ),
      'limits', jsonb_build_object(
        'max_listings', 9999,
        'max_marketplace_items', 9999,
        'max_staff_members', 9999
      )
    );
  END IF;

  -- Check latest subscription status (including expired/suspended/cancelled/trialing)
  SELECT us.status, COALESCE(us.ends_at, us.expires_at)
    INTO v_latest_status, v_latest_ends_at
  FROM public.user_subscriptions us
  WHERE us.user_id = p_user_id
    AND (p_listing_id IS NULL OR us.listing_id IS NULL OR us.listing_id = p_listing_id)
  ORDER BY COALESCE(us.ends_at, us.expires_at) DESC NULLS LAST, us.created_at DESC
  LIMIT 1;

  -- Iterate all non-expired active & trialing subscriptions
  FOR v_sub IN
    SELECT
      us.id,
      us.plan_id,
      us.status,
      COALESCE(us.ends_at, us.expires_at) AS effective_ends_at,
      us.entitlements_snapshot,
      us.custom_overrides,
      sp.entitlements AS plan_entitlements,
      sp.features AS plan_features,
      sp.limits AS plan_limits,
      sp.applicable_root_keys AS plan_root_keys,
      sp.applicable_category_ids AS plan_category_ids
    FROM public.user_subscriptions us
    LEFT JOIN public.subscription_plans sp ON sp.id = us.plan_id
    WHERE us.user_id = p_user_id
      AND us.status IN ('active', 'trialing')
      AND COALESCE(us.ends_at, us.expires_at) > now()
      AND (p_listing_id IS NULL OR us.listing_id IS NULL OR us.listing_id = p_listing_id)
    ORDER BY COALESCE(us.ends_at, us.expires_at) DESC
  LOOP
    v_active_count := v_active_count + 1;
    IF v_sub.status = 'active' THEN
      v_has_paid_active := true;
    ELSIF v_sub.status = 'trialing' THEN
      v_has_trialing := true;
    END IF;

    IF v_sub.plan_id IS NOT NULL THEN
      v_active_plan_ids := v_active_plan_ids || to_jsonb(v_sub.plan_id::text);
    END IF;
    IF v_latest_ends_at IS NULL OR (v_sub.effective_ends_at IS NOT NULL AND v_sub.effective_ends_at > v_latest_ends_at) THEN
      v_latest_ends_at := v_sub.effective_ends_at;
    END IF;

    -- Merge snapshot (fallback to plan entitlements) + custom_overrides
    v_snap := COALESCE(
      CASE
        WHEN v_sub.entitlements_snapshot IS NOT NULL AND v_sub.entitlements_snapshot <> '{}'::jsonb
        THEN v_sub.entitlements_snapshot
        ELSE NULL
      END,
      v_sub.plan_entitlements,
      '{}'::jsonb
    );
    v_ovr := COALESCE(v_sub.custom_overrides, '{}'::jsonb);
    v_eff := v_snap || v_ovr;

    -- Union allowed_listing_types
    IF jsonb_typeof(v_eff->'allowed_listing_types') = 'array' THEN
      FOR v_val IN SELECT jsonb_array_elements_text(v_eff->'allowed_listing_types') LOOP
        IF NOT (v_val = ANY(v_allowed_listing_types)) THEN
          v_allowed_listing_types := array_append(v_allowed_listing_types, v_val);
        END IF;
      END LOOP;
    END IF;

    -- Union allowed_root_keys (plan column + snapshot + overrides)
    IF v_sub.plan_root_keys IS NOT NULL THEN
      FOREACH v_root_key IN ARRAY v_sub.plan_root_keys LOOP
        IF v_root_key IS NOT NULL AND NOT (v_root_key = ANY(v_allowed_root_keys)) THEN
          v_allowed_root_keys := array_append(v_allowed_root_keys, v_root_key);
        END IF;
      END LOOP;
    END IF;
    IF jsonb_typeof(v_eff->'allowed_root_keys') = 'array' THEN
      FOR v_val IN SELECT jsonb_array_elements_text(v_eff->'allowed_root_keys') LOOP
        IF NOT (v_val = ANY(v_allowed_root_keys)) THEN
          v_allowed_root_keys := array_append(v_allowed_root_keys, v_val);
        END IF;
      END LOOP;
    END IF;

    -- Union allowed_category_ids (plan column + snapshot + overrides)
    IF v_sub.plan_category_ids IS NOT NULL THEN
      FOREACH v_cat_id IN ARRAY (SELECT COALESCE(array_agg(x::text), ARRAY[]::text[]) FROM unnest(v_sub.plan_category_ids) x) LOOP
        IF v_cat_id IS NOT NULL AND NOT (v_cat_id = ANY(v_allowed_category_ids)) THEN
          v_allowed_category_ids := array_append(v_allowed_category_ids, v_cat_id);
        END IF;
      END LOOP;
    END IF;
    IF jsonb_typeof(v_eff->'allowed_category_ids') = 'array' THEN
      FOR v_val IN SELECT jsonb_array_elements_text(v_eff->'allowed_category_ids') LOOP
        IF NOT (v_val = ANY(v_allowed_category_ids)) THEN
          v_allowed_category_ids := array_append(v_allowed_category_ids, v_val);
        END IF;
      END LOOP;
    END IF;

    -- Expand allowed_root_keys from legacy allowed_listing_types if needed
    FOREACH v_val IN ARRAY v_allowed_listing_types LOOP
      IF v_val IN ('general','shop_catalogue','restaurant_food','booking_venue','hotel_stay','print_digital','real_estate','public_civic')
         AND NOT (v_val = ANY(v_allowed_root_keys)) THEN
        v_allowed_root_keys := array_append(v_allowed_root_keys, v_val);
      END IF;
    END LOOP;

    -- Max listings
    IF v_eff ? 'max_listings' THEN
      IF v_eff->'max_listings' = 'null'::jsonb OR (jsonb_typeof(v_eff->'max_listings') = 'number' AND (v_eff->>'max_listings')::integer < 0) THEN
        v_max_listings_unlimited := true;
      ELSIF jsonb_typeof(v_eff->'max_listings') = 'number' THEN
        v_max_listings := GREATEST(v_max_listings, (v_eff->>'max_listings')::integer);
      END IF;
    END IF;

    -- Max marketplace items
    IF v_eff ? 'max_marketplace_items' THEN
      IF v_eff->'max_marketplace_items' = 'null'::jsonb OR (jsonb_typeof(v_eff->'max_marketplace_items') = 'number' AND (v_eff->>'max_marketplace_items')::integer < 0) THEN
        v_max_marketplace_unlimited := true;
      ELSIF jsonb_typeof(v_eff->'max_marketplace_items') = 'number' THEN
        v_max_marketplace_items := GREATEST(v_max_marketplace_items, (v_eff->>'max_marketplace_items')::integer);
      END IF;
    END IF;

    -- Auto-verify booleans (OR across active subs, explicit override can also disable per-subscriber)
    IF v_ovr ? 'auto_verify_listings' THEN
      v_auto_verify_listings := COALESCE((v_ovr->>'auto_verify_listings')::boolean, false);
    ELSIF COALESCE((v_eff->>'auto_verify_listings')::boolean, false) THEN
      v_auto_verify_listings := true;
    END IF;

    IF v_ovr ? 'auto_verify_bulletins' THEN
      v_auto_verify_bulletins := COALESCE((v_ovr->>'auto_verify_bulletins')::boolean, false);
    ELSIF COALESCE((v_eff->>'auto_verify_bulletins')::boolean, false) THEN
      v_auto_verify_bulletins := true;
    END IF;

    -- Merge each toggle+limit feature (including staffing.max_staff <-> limit)
    FOREACH v_fk IN ARRAY v_key_list LOOP
      IF jsonb_typeof(v_eff->v_fk) = 'object' THEN
        v_cur := v_v15b_features->v_fk;
        v_inc := v_eff->v_fk;

        v_cur_en := COALESCE((v_cur->>'enabled')::boolean, false);
        v_inc_en := COALESCE((v_inc->>'enabled')::boolean, false);

        IF v_ovr ? v_fk AND jsonb_typeof(v_ovr->v_fk) = 'object' THEN
          v_cur_en := COALESCE((v_ovr->v_fk->>'enabled')::boolean, v_cur_en);
          IF v_fk = 'staffing' THEN
            v_new_lim := COALESCE(v_ovr->v_fk->'max_staff', v_ovr->v_fk->'limit', v_cur->'max_staff', v_cur->'limit');
            v_v15b_features := jsonb_set(
              v_v15b_features,
              ARRAY[v_fk],
              jsonb_build_object('enabled', v_cur_en, 'max_staff', v_new_lim, 'limit', v_new_lim),
              true
            );
          ELSE
            v_new_lim := COALESCE(v_ovr->v_fk->'limit', v_cur->'limit');
            v_v15b_features := jsonb_set(
              v_v15b_features,
              ARRAY[v_fk],
              jsonb_build_object('enabled', v_cur_en, 'limit', v_new_lim),
              true
            );
          END IF;
        ELSIF v_inc_en THEN
          IF v_fk = 'staffing' THEN
            IF (v_cur_en AND COALESCE(v_cur->'max_staff', v_cur->'limit') = 'null'::jsonb)
               OR COALESCE(v_inc->'max_staff', v_inc->'limit') = 'null'::jsonb THEN
              v_new_lim := 'null'::jsonb;
            ELSE
              v_cur_lim := COALESCE((v_cur->>'max_staff')::integer, (v_cur->>'limit')::integer, 0);
              v_inc_lim := COALESCE((v_inc->>'max_staff')::integer, (v_inc->>'limit')::integer, 0);
              v_new_lim := to_jsonb(GREATEST(v_cur_lim, v_inc_lim));
            END IF;
            v_v15b_features := jsonb_set(
              v_v15b_features,
              ARRAY[v_fk],
              jsonb_build_object('enabled', true, 'max_staff', v_new_lim, 'limit', v_new_lim),
              true
            );
          ELSE
            IF (v_cur_en AND v_cur->'limit' = 'null'::jsonb) OR (v_inc->'limit' = 'null'::jsonb) THEN
              v_new_lim := 'null'::jsonb;
            ELSE
              v_cur_lim := COALESCE((v_cur->>'limit')::integer, 0);
              v_inc_lim := COALESCE((v_inc->>'limit')::integer, 0);
              v_new_lim := to_jsonb(GREATEST(v_cur_lim, v_inc_lim));
            END IF;
            v_v15b_features := jsonb_set(
              v_v15b_features,
              ARRAY[v_fk],
              jsonb_build_object('enabled', true, 'limit', v_new_lim),
              true
            );
          END IF;
        END IF;
      END IF;
    END LOOP;

    -- Preserve legacy features/limits compatibility
    IF v_sub.plan_features IS NOT NULL AND jsonb_typeof(v_sub.plan_features) = 'object' THEN
      v_legacy_features := v_legacy_features || v_sub.plan_features;
    END IF;
    IF v_sub.plan_limits IS NOT NULL AND jsonb_typeof(v_sub.plan_limits) = 'object' THEN
      v_legacy_limits := v_legacy_limits || v_sub.plan_limits;
    END IF;
  END LOOP;

  -- Sync legacy feature keys from unified features
  v_legacy_features := v_legacy_features || jsonb_build_object(
    'online_payment', COALESCE((v_v15b_features->'online_payment'->>'enabled')::boolean, false),
    'pick_n_drop_dispatch', COALESCE((v_v15b_features->'pnd_dispatch'->>'enabled')::boolean, false),
    'print_online_orders', COALESCE((v_v15b_features->'print_order'->>'enabled')::boolean, false),
    'bulletin_posting', COALESCE((v_v15b_features->'bulletins'->>'enabled')::boolean, false),
    'real_estate_polygon', COALESCE((v_v15b_features->'real_estate_poly'->>'enabled')::boolean, false),
    'staff_delegation', COALESCE((v_v15b_features->'staffing'->>'enabled')::boolean, false),
    'booking_slots', COALESCE((v_v15b_features->'bookings'->>'enabled')::boolean, false),
    'hotel_rooms', COALESCE((v_v15b_features->'bookings'->>'enabled')::boolean, false),
    'panorama_360', COALESCE((v_v15b_features->'panorama_360'->>'enabled')::boolean, false),
    'featured_boost', COALESCE((v_v15b_features->'featured_boost'->>'enabled')::boolean, false)
  );

  v_legacy_limits := v_legacy_limits || jsonb_build_object(
    'max_listings', CASE WHEN v_max_listings_unlimited THEN 9999 ELSE v_max_listings END,
    'max_marketplace_items', CASE WHEN v_max_marketplace_unlimited THEN 9999 ELSE v_max_marketplace_items END,
    'max_staff_members', CASE
      WHEN COALESCE((v_v15b_features->'staffing'->>'enabled')::boolean, false) = false THEN 0
      WHEN COALESCE(v_v15b_features->'staffing'->'max_staff', v_v15b_features->'staffing'->'limit') = 'null'::jsonb THEN 9999
      ELSE COALESCE((v_v15b_features->'staffing'->>'max_staff')::integer, (v_v15b_features->'staffing'->>'limit')::integer, 0)
    END
  );

  RETURN jsonb_build_object(
    'allowed_listing_types', to_jsonb(v_allowed_listing_types),
    'allowed_root_keys', to_jsonb(v_allowed_root_keys),
    'allowed_category_ids', to_jsonb(v_allowed_category_ids),
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
    'auto_verify_listings', v_auto_verify_listings,
    'auto_verify_bulletins', v_auto_verify_bulletins,
    'is_free_baseline', (v_active_count = 0),
    'has_active_subscription', (v_active_count > 0),
    'subscription_status', CASE
      WHEN v_has_paid_active THEN 'active'
      WHEN v_has_trialing THEN 'trialing'
      ELSE COALESCE(v_latest_status, 'none')
    END,
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
-- 7. PUBLIC CUSTOMER-FACING CAPABILITY RESOLVER RPC
--    `public.get_listing_public_capabilities(p_listing_id uuid)`
--    Privacy-safe: returns ONLY public boolean capability flags (zero billing/PII)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_listing_public_capabilities(p_listing_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_listing record;
  v_is_first_party_print boolean := false;
  v_root_key text := 'general';
  v_ent jsonb;
  v_pay jsonb;
  v_can_pay_upi boolean := false;
  v_can_pay_manual boolean := true;
  v_escrow_required boolean := false;
  v_can_book_online boolean := false;
  v_can_order_print boolean := false;
  v_can_dispatch_pnd boolean := false;
  v_can_show_360 boolean := false;
  v_can_show_marketplace boolean := true;
  v_has_auto_verified boolean := false;
  v_is_owner_plan_active boolean := false;
BEGIN
  IF p_listing_id IS NULL THEN
    RETURN jsonb_build_object(
      'can_pay_upi', false,
      'can_pay_manual', true,
      'escrow_required', false,
      'can_book_online', false,
      'can_order_print', false,
      'can_dispatch_pnd', false,
      'can_show_360', false,
      'can_show_marketplace', true,
      'has_auto_verified', false,
      'is_owner_plan_active', false
    );
  END IF;

  SELECT
    l.id,
    l.owner_id,
    l.root_key,
    l.listing_vertical,
    l.is_verified
  INTO v_listing
  FROM public.listings l
  WHERE l.id = p_listing_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'can_pay_upi', false,
      'can_pay_manual', true,
      'escrow_required', false,
      'can_book_online', false,
      'can_order_print', false,
      'can_dispatch_pnd', false,
      'can_show_360', false,
      'can_show_marketplace', false,
      'has_auto_verified', false,
      'is_owner_plan_active', false
    );
  END IF;

  v_root_key := COALESCE(
    NULLIF(lower(trim(v_listing.root_key)), ''),
    NULLIF(lower(trim(v_listing.listing_vertical)), ''),
    'general'
  );

  -- Preserve first-party PrintSwift capability flag
  IF to_regclass('public.listing_print_profiles') IS NOT NULL THEN
    SELECT COALESCE(is_first_party_printswift, false)
      INTO v_is_first_party_print
    FROM public.listing_print_profiles
    WHERE listing_id = p_listing_id
    LIMIT 1;
  END IF;

  v_ent := public.get_effective_entitlements(v_listing.owner_id, p_listing_id);
  v_pay := public.resolve_effective_payment_methods(v_root_key, p_listing_id);

  v_can_pay_upi := v_is_first_party_print OR COALESCE((v_pay->>'upi_allowed')::boolean, false);
  v_can_pay_manual := COALESCE((v_pay->>'manual_allowed')::boolean, true);
  v_escrow_required := COALESCE((v_pay->>'escrow_required')::boolean, false);

  v_can_book_online :=
    COALESCE((v_ent->'bookings'->>'enabled')::boolean, false)
    OR COALESCE((v_ent->'features'->>'booking_slots')::boolean, false)
    OR COALESCE((v_ent->'features'->>'hotel_rooms')::boolean, false)
    OR COALESCE((v_ent->'features'->>'hotel_multi_room')::boolean, false)
    OR COALESCE((v_ent->'features'->>'restaurant_table_booking')::boolean, false);

  v_can_order_print :=
    v_is_first_party_print
    OR COALESCE((v_ent->'print_order'->>'enabled')::boolean, false)
    OR COALESCE((v_ent->'features'->>'print_online_orders')::boolean, false);

  v_can_dispatch_pnd :=
    v_is_first_party_print
    OR COALESCE((v_ent->'pnd_dispatch'->>'enabled')::boolean, false)
    OR COALESCE((v_ent->'features'->>'pick_n_drop_dispatch')::boolean, false);

  v_can_show_360 :=
    COALESCE((v_ent->'panorama_360'->>'enabled')::boolean, false)
    OR COALESCE((v_ent->'features'->>'panorama_360')::boolean, false);

  v_can_show_marketplace :=
    (v_ent->'max_marketplace_items' = 'null'::jsonb)
    OR (COALESCE((v_ent->>'max_marketplace_items')::integer, 0) > 0);

  v_has_auto_verified :=
    COALESCE(v_listing.is_verified, false)
    OR COALESCE((v_ent->>'auto_verify_listings')::boolean, false);

  v_is_owner_plan_active :=
    v_is_first_party_print
    OR COALESCE((v_ent->>'has_active_subscription')::boolean, false)
    OR COALESCE((v_ent->>'is_super_admin_bypass')::boolean, false);

  RETURN jsonb_build_object(
    'can_pay_upi', v_can_pay_upi,
    'can_pay_manual', v_can_pay_manual,
    'escrow_required', v_escrow_required,
    'can_book_online', v_can_book_online,
    'can_order_print', v_can_order_print,
    'can_dispatch_pnd', v_can_dispatch_pnd,
    'can_show_360', v_can_show_360,
    'can_show_marketplace', v_can_show_marketplace,
    'has_auto_verified', v_has_auto_verified,
    'is_owner_plan_active', v_is_owner_plan_active
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_listing_public_capabilities(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_listing_public_capabilities(uuid) TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 8. SERVER-SIDE AUTO-VERIFY TRIGGERS ON `listings` & `bulletins`
--    + UPGRADE `enforce_bulletin_quota` TO ACCEPT `'trialing'` SUBSCRIPTIONS
-- -----------------------------------------------------------------------------
ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS is_verified boolean NOT NULL DEFAULT false;

ALTER TABLE public.bulletins
  ADD COLUMN IF NOT EXISTS is_verified boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.apply_listing_auto_verify_v17b()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_role text := 'user';
  v_ent jsonb;
  v_auto_verify boolean := false;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    SELECT lower(COALESCE(role, 'user'))
      INTO v_actor_role
    FROM public.profiles
    WHERE id = auth.uid();
  END IF;

  -- Admins & super_admins retain full manual verification / status control
  IF v_actor_role IN ('admin', 'super_admin') OR auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  -- Check owner's live server-side entitlements (never trust client-supplied is_verified)
  v_ent := public.get_effective_entitlements(COALESCE(NEW.owner_id, auth.uid()), NULL);
  v_auto_verify := COALESCE((v_ent->>'auto_verify_listings')::boolean, false);

  IF v_auto_verify THEN
    NEW.is_verified := true;
    IF COALESCE(lower(NEW.status), 'pending') IN ('pending', 'pending_approval', 'submitted') THEN
      NEW.status := 'published';
    END IF;
  ELSE
    NEW.is_verified := false;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_listings_auto_verify_v17b ON public.listings;
CREATE TRIGGER trg_listings_auto_verify_v17b
  BEFORE INSERT ON public.listings
  FOR EACH ROW
  EXECUTE FUNCTION public.apply_listing_auto_verify_v17b();

CREATE OR REPLACE FUNCTION public.apply_bulletin_auto_verify_v17b()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_role text := 'user';
  v_ent jsonb;
  v_auto_verify boolean := false;
BEGIN
  IF auth.uid() IS NOT NULL THEN
    SELECT lower(COALESCE(role, 'user'))
      INTO v_actor_role
    FROM public.profiles
    WHERE id = auth.uid();
  END IF;

  IF v_actor_role IN ('admin', 'super_admin') OR auth.uid() IS NULL THEN
    RETURN NEW;
  END IF;

  v_ent := public.get_effective_entitlements(COALESCE(NEW.author_id, auth.uid()), NEW.linked_listing_id);
  v_auto_verify := COALESCE((v_ent->>'auto_verify_bulletins')::boolean, false);

  IF v_auto_verify THEN
    NEW.is_verified := true;
    NEW.status := 'published';
  ELSE
    NEW.is_verified := false;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bulletins_auto_verify_v17b ON public.bulletins;
CREATE TRIGGER trg_bulletins_auto_verify_v17b
  BEFORE INSERT ON public.bulletins
  FOR EACH ROW
  EXECUTE FUNCTION public.apply_bulletin_auto_verify_v17b();

-- Upgrade enforce_bulletin_quota() to also accept active `'trialing'` subscriptions
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

  RAISE EXCEPTION 'Active subscription or verified Pay-Per-Post pass required.'
    USING ERRCODE = 'P0001';
END;
$$;
