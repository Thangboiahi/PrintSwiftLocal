-- =============================================================================
-- DD OODLE — PASS R1-A: CORE UNIFICATION SCHEMA
-- Pillar 1: Composable Feature & Quota Subscription Engine
-- Pillar 2: Multi-Role "Operational Hats" & Safe Business Lifecycle ("Pause & Drain")
-- Pillar 3: Zero-Orphan Media Asset Registry & TTL Lifecycle
-- 100% IDEMPOTENT MIGRATION
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- =============================================================================
-- PILLAR 1: COMPOSABLE FEATURE & QUOTA SUBSCRIPTION ENGINE
-- =============================================================================

-- 1A. Upgrade public.subscription_plans
ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS features jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS limits jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS billing_cycle text NOT NULL DEFAULT 'monthly',
  ADD COLUMN IF NOT EXISTS is_addon boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_custom_plan boolean NOT NULL DEFAULT false;

ALTER TABLE public.subscription_plans
  DROP CONSTRAINT IF EXISTS subscription_plans_billing_cycle_check;

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
      AND t.relname = 'subscription_plans'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%billing_cycle%'
  LOOP
    EXECUTE format('ALTER TABLE public.subscription_plans DROP CONSTRAINT IF EXISTS %I', v_conname);
  END LOOP;

  ALTER TABLE public.subscription_plans
    ADD CONSTRAINT subscription_plans_billing_cycle_check CHECK (
      billing_cycle IN ('7d', '30d', '90d', '365d', 'one_time', 'monthly', 'quarterly', 'yearly')
    );
END;
$$;

-- Ensure plan_scope CHECK (if present) allows addon_pack as well
DO $$
DECLARE
  v_conname text;
  v_had_check boolean := false;
BEGIN
  FOR v_conname IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'subscription_plans'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%plan_scope%'
  LOOP
    v_had_check := true;
    EXECUTE format('ALTER TABLE public.subscription_plans DROP CONSTRAINT IF EXISTS %I', v_conname);
  END LOOP;

  IF v_had_check THEN
    ALTER TABLE public.subscription_plans
      ADD CONSTRAINT subscription_plans_plan_scope_check CHECK (
        plan_scope IN (
          'bulletin',
          'print_pro',
          'merchant_bundle',
          'booking_pro',
          'stay_pro',
          'catalogue_pro',
          'restaurant_pro',
          'real_estate_boost',
          'agent_pro',
          'addon_pack',
          'custom_plan',
          'merchant_all_in_one'
        )
      );
  END IF;
END;
$$;

-- 1B. Upgrade public.user_subscriptions
ALTER TABLE public.user_subscriptions
  ADD COLUMN IF NOT EXISTS listing_id uuid REFERENCES public.listings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS entitlement_overrides jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.user_subscriptions
  DROP CONSTRAINT IF EXISTS user_subscriptions_status_check;

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
      AND t.relname = 'user_subscriptions'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.user_subscriptions DROP CONSTRAINT IF EXISTS %I', v_conname);
  END LOOP;

  ALTER TABLE public.user_subscriptions
    ADD CONSTRAINT user_subscriptions_status_check CHECK (
      status IN ('active', 'pending_payment', 'expired', 'cancelled', 'paused_listing_archived')
    );
END;
$$;

-- 1C. Composable Entitlement Merger RPC: get_effective_entitlements
CREATE OR REPLACE FUNCTION public.get_effective_entitlements(
  p_user_id uuid,
  p_listing_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_effective_user_id uuid := p_user_id;
  v_listing_owner_id uuid;
  v_user_role text;
  v_owner_role text;
  v_features jsonb := '{}'::jsonb;
  v_limits jsonb := '{}'::jsonb;
  v_plan_ids uuid[] := ARRAY[]::uuid[];
  v_sub record;
  v_k text;
  v_val jsonb;
  v_existing_num numeric;
  v_incoming_num numeric;
  v_plan_features jsonb;
  v_plan_limits jsonb;
BEGIN
  IF p_listing_id IS NOT NULL THEN
    SELECT l.owner_id INTO v_listing_owner_id
    FROM public.listings l
    WHERE l.id = p_listing_id;

    IF v_effective_user_id IS NULL THEN
      v_effective_user_id := v_listing_owner_id;
    END IF;
  END IF;

  IF v_effective_user_id IS NOT NULL THEN
    SELECT lower(COALESCE(role, '')) INTO v_user_role
    FROM public.profiles WHERE id = v_effective_user_id;
  END IF;

  IF v_listing_owner_id IS NOT NULL THEN
    SELECT lower(COALESCE(role, '')) INTO v_owner_role
    FROM public.profiles WHERE id = v_listing_owner_id;
  END IF;

  -- Super-Admin accounts (and super_admin-owned demo listings) receive full testing entitlements
  IF COALESCE(v_user_role, '') = 'super_admin' OR COALESCE(v_owner_role, '') = 'super_admin' THEN
    RETURN jsonb_build_object(
      'features', jsonb_build_object(
        'print_online_orders', true,
        'print_custom_digital', true,
        'booking_slots', true,
        'hotel_multi_room', true,
        'shop_basket_checkout', true,
        'restaurant_menu_ordering', true,
        'restaurant_table_booking', true,
        'pick_n_drop_dispatch', true,
        'real_estate_verified_boost', true,
        'bulletin_posting', true,
        'counter_qr_posters', true,
        'staff_delegation', true,
        'featured_map_pin', true
      ),
      'limits', jsonb_build_object(
        'max_active_listings', -1,
        'max_catalogue_items', -1,
        'max_menu_items', -1,
        'max_booking_resources', -1,
        'max_staff_members', -1,
        'max_monthly_bulletins', -1,
        'max_media_per_listing', 20,
        'active_boost_slots', -1
      ),
      'active_plan_ids', '[]'::jsonb,
      'is_super_admin_bypass', true
    );
  END IF;

  -- Pass 1: Merge Base Plans (OR features, MAX limits with -1 = unlimited)
  FOR v_sub IN
    SELECT
      us.id AS sub_id,
      us.plan_id,
      us.entitlement_overrides,
      sp.plan_scope,
      sp.is_addon,
      COALESCE(sp.features, '{}'::jsonb) AS features,
      COALESCE(sp.limits, '{}'::jsonb) AS limits,
      COALESCE(sp.entitlements, '{}'::jsonb) AS legacy_entitlements
    FROM public.user_subscriptions us
    JOIN public.subscription_plans sp ON sp.id = us.plan_id
    WHERE us.status = 'active'
      AND (us.expires_at IS NULL OR us.expires_at > now())
      AND (
        (v_effective_user_id IS NOT NULL AND us.user_id = v_effective_user_id AND us.listing_id IS NULL)
        OR (p_listing_id IS NOT NULL AND us.listing_id = p_listing_id)
      )
    ORDER BY sp.is_addon ASC, us.created_at ASC
  LOOP
    v_plan_ids := array_append(v_plan_ids, v_sub.plan_id);

    -- Backwards-compatible legacy scope/entitlements mapping into composable features
    v_plan_features := v_sub.features;
    IF v_sub.plan_scope = 'merchant_all_in_one' THEN
      v_plan_features := jsonb_build_object(
        'print_online_orders', true,
        'print_custom_digital', true,
        'booking_slots', true,
        'hotel_multi_room', true,
        'shop_basket_checkout', true,
        'restaurant_menu_ordering', true,
        'restaurant_table_booking', true,
        'pick_n_drop_dispatch', true,
        'real_estate_verified_boost', true,
        'bulletin_posting', true,
        'counter_qr_posters', true,
        'staff_delegation', true,
        'featured_map_pin', true
      ) || v_plan_features;
    ELSE
      IF v_sub.plan_scope IN ('print_pro', 'merchant_bundle')
         OR COALESCE(v_sub.legacy_entitlements->>'print_ordering', 'false') = 'true' THEN
        v_plan_features := v_plan_features || jsonb_build_object('print_online_orders', true, 'print_custom_digital', true, 'counter_qr_posters', true);
      END IF;
      IF v_sub.plan_scope = 'booking_pro'
         OR COALESCE(v_sub.legacy_entitlements->>'booking_venues', 'false') = 'true' THEN
        v_plan_features := v_plan_features || jsonb_build_object('booking_slots', true);
      END IF;
      IF v_sub.plan_scope = 'stay_pro'
         OR COALESCE(v_sub.legacy_entitlements->>'hotel_stays', 'false') = 'true' THEN
        v_plan_features := v_plan_features || jsonb_build_object('hotel_multi_room', true);
      END IF;
      IF v_sub.plan_scope = 'catalogue_pro'
         OR COALESCE(v_sub.legacy_entitlements->>'catalogue_ordering', 'false') = 'true' THEN
        v_plan_features := v_plan_features || jsonb_build_object('shop_basket_checkout', true, 'pick_n_drop_dispatch', true, 'counter_qr_posters', true);
      END IF;
      IF v_sub.plan_scope = 'restaurant_pro'
         OR COALESCE(v_sub.legacy_entitlements->>'restaurant_ordering', 'false') = 'true' THEN
        v_plan_features := v_plan_features || jsonb_build_object('restaurant_menu_ordering', true, 'restaurant_table_booking', true, 'pick_n_drop_dispatch', true, 'counter_qr_posters', true);
      END IF;
      IF v_sub.plan_scope IN ('agent_pro', 'real_estate_boost')
         OR COALESCE(v_sub.legacy_entitlements->>'real_estate_pro', 'false') = 'true' THEN
        v_plan_features := v_plan_features || jsonb_build_object('real_estate_verified_boost', true, 'featured_map_pin', true);
      END IF;
      IF v_sub.plan_scope IN ('bulletin', 'merchant_bundle') THEN
        v_plan_features := v_plan_features || jsonb_build_object('bulletin_posting', true);
      END IF;
    END IF;

    -- Logical OR for boolean features
    FOR v_k, v_val IN SELECT key, value FROM jsonb_each(v_plan_features) LOOP
      IF jsonb_typeof(v_val) = 'boolean' THEN
        IF (v_val::text = 'true') OR COALESCE((v_features->>v_k)::boolean, false) THEN
          v_features := jsonb_set(v_features, ARRAY[v_k], 'true'::jsonb, true);
        ELSIF NOT (v_features ? v_k) THEN
          v_features := jsonb_set(v_features, ARRAY[v_k], 'false'::jsonb, true);
        END IF;
      END IF;
    END LOOP;

    -- Merge numeric limits (MAX for base plans, +delta for add-ons, -1 = unlimited)
    v_plan_limits := v_sub.limits;
    FOR v_k, v_val IN SELECT key, value FROM jsonb_each(v_plan_limits) LOOP
      IF jsonb_typeof(v_val) = 'number' THEN
        v_incoming_num := (v_val::text)::numeric;
        IF NOT (v_limits ? v_k) THEN
          v_limits := jsonb_set(v_limits, ARRAY[v_k], to_jsonb(v_incoming_num), true);
        ELSE
          v_existing_num := (v_limits->>v_k)::numeric;
          IF v_existing_num = -1 OR v_incoming_num = -1 THEN
            v_limits := jsonb_set(v_limits, ARRAY[v_k], to_jsonb(-1), true);
          ELSIF v_sub.is_addon = true AND v_incoming_num > 0 THEN
            v_limits := jsonb_set(v_limits, ARRAY[v_k], to_jsonb(v_existing_num + v_incoming_num), true);
          ELSE
            v_limits := jsonb_set(v_limits, ARRAY[v_k], to_jsonb(GREATEST(v_existing_num, v_incoming_num)), true);
          END IF;
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- Pass 2: Overlay per-subscription Super-Admin entitlement_overrides
  FOR v_sub IN
    SELECT us.entitlement_overrides
    FROM public.user_subscriptions us
    WHERE us.status = 'active'
      AND (us.expires_at IS NULL OR us.expires_at > now())
      AND us.entitlement_overrides IS NOT NULL
      AND us.entitlement_overrides <> '{}'::jsonb
      AND (
        (v_effective_user_id IS NOT NULL AND us.user_id = v_effective_user_id AND us.listing_id IS NULL)
        OR (p_listing_id IS NOT NULL AND us.listing_id = p_listing_id)
      )
    ORDER BY us.created_at ASC
  LOOP
    IF jsonb_typeof(v_sub.entitlement_overrides->'features') = 'object' THEN
      v_features := v_features || (v_sub.entitlement_overrides->'features');
    END IF;
    IF jsonb_typeof(v_sub.entitlement_overrides->'limits') = 'object' THEN
      v_limits := v_limits || (v_sub.entitlement_overrides->'limits');
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'features', v_features,
    'limits', v_limits,
    'active_plan_ids', to_jsonb(v_plan_ids)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_effective_entitlements(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_effective_entitlements(uuid, uuid) TO anon, authenticated, service_role;

-- 1D. Refactor existing entitlement RPCs into clean wrappers delegating to get_effective_entitlements()
CREATE OR REPLACE FUNCTION public.has_active_print_entitlement(p_listing_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_first_party boolean := false;
  v_ent jsonb;
BEGIN
  IF p_listing_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT COALESCE(is_first_party_printswift, false) INTO v_is_first_party
  FROM public.listing_print_profiles
  WHERE listing_id = p_listing_id;

  IF v_is_first_party THEN
    RETURN true;
  END IF;

  v_ent := public.get_effective_entitlements(NULL, p_listing_id);
  RETURN COALESCE((v_ent->'features'->>'print_online_orders')::boolean, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.has_active_booking_entitlement(
  p_listing_id uuid,
  p_vertical text DEFAULT 'booking_venue' -- [v21a P0-21] keep phase73a default (replay-safe)
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_ent jsonb;
BEGIN
  IF p_listing_id IS NULL THEN
    RETURN false;
  END IF;

  v_ent := public.get_effective_entitlements(NULL, p_listing_id);
  IF p_vertical = 'hotel_stay' THEN
    RETURN COALESCE((v_ent->'features'->>'hotel_multi_room')::boolean, false);
  END IF;
  RETURN COALESCE((v_ent->'features'->>'booking_slots')::boolean, false);
END;
$$;

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
  v_ent jsonb;
BEGIN
  IF p_listing_id IS NULL THEN
    RETURN false;
  END IF;

  v_ent := public.get_effective_entitlements(NULL, p_listing_id);
  IF p_vertical = 'restaurant_food' THEN
    RETURN COALESCE((v_ent->'features'->>'restaurant_menu_ordering')::boolean, false);
  END IF;
  RETURN COALESCE((v_ent->'features'->>'shop_basket_checkout')::boolean, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.has_active_real_estate_pro(p_listing_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_boost_exp timestamptz;
  v_ent jsonb;
BEGIN
  IF p_listing_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT verified_boost_expires_at INTO v_boost_exp
  FROM public.listing_real_estate_profiles
  WHERE listing_id = p_listing_id;

  IF v_boost_exp IS NOT NULL AND v_boost_exp > now() THEN
    RETURN true;
  END IF;

  v_ent := public.get_effective_entitlements(NULL, p_listing_id);
  RETURN COALESCE((v_ent->'features'->>'real_estate_verified_boost')::boolean, false);
END;
$$;

-- =============================================================================
-- PILLAR 2: MULTI-ROLE "OPERATIONAL HATS" & SAFE BUSINESS LIFECYCLE
-- =============================================================================

-- 2A. Independent public.driver_profiles (Driver Hat)
CREATE TABLE IF NOT EXISTS public.driver_profiles (
  user_id uuid PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  hub_id uuid NOT NULL REFERENCES public.service_hubs(id),
  vehicle_type text NOT NULL DEFAULT 'two_wheeler'
    CHECK (vehicle_type IN ('two_wheeler', 'auto', 'mini_van', 'car')),
  vehicle_reg_no text,
  kyc_status text NOT NULL DEFAULT 'pending'
    CHECK (kyc_status IN ('pending', 'verified', 'suspended')),
  is_online boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_driver_profiles_hub_online
  ON public.driver_profiles (hub_id, is_active, is_online);

ALTER TABLE public.driver_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Drivers managers and admins can view driver profiles" ON public.driver_profiles;
CREATE POLICY "Drivers managers and admins can view driver profiles"
  ON public.driver_profiles FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_hub_manager_for(hub_id)
    OR public.is_super_admin()
  );

DROP POLICY IF EXISTS "Managers and admins can insert driver profiles" ON public.driver_profiles;
CREATE POLICY "Managers and admins can insert driver profiles"
  ON public.driver_profiles FOR INSERT TO authenticated
  WITH CHECK (
    public.is_hub_manager_for(hub_id)
    OR public.is_super_admin()
  );

DROP POLICY IF EXISTS "Drivers managers and admins can update driver profiles" ON public.driver_profiles;
CREATE POLICY "Drivers managers and admins can update driver profiles"
  ON public.driver_profiles FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    OR public.is_hub_manager_for(hub_id)
    OR public.is_super_admin()
  )
  WITH CHECK (
    user_id = auth.uid()
    OR public.is_hub_manager_for(hub_id)
    OR public.is_super_admin()
  );

-- Guard non-privileged driver updates to only is_online
CREATE OR REPLACE FUNCTION public.guard_driver_profile_writes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_service boolean := (current_setting('role', true) = 'service_role');
BEGIN
  NEW.updated_at := now();
  IF v_is_service OR public.is_super_admin() OR public.is_hub_manager_for(NEW.hub_id) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    NEW.hub_id := OLD.hub_id;
    NEW.vehicle_type := OLD.vehicle_type;
    NEW.vehicle_reg_no := OLD.vehicle_reg_no;
    NEW.kyc_status := OLD.kyc_status;
    NEW.is_active := OLD.is_active;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_driver_profile_writes ON public.driver_profiles;
CREATE TRIGGER trg_guard_driver_profile_writes
  BEFORE INSERT OR UPDATE ON public.driver_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_driver_profile_writes();

-- 2B. Upgrade public.staff_delegations
ALTER TABLE public.staff_delegations
  ADD COLUMN IF NOT EXISTS granted_by_owner_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vertical_scopes jsonb NOT NULL DEFAULT '{"print_ops":true,"booking_desk":true,"kitchen_shop":true,"visit_desk":true,"enquiries":true}'::jsonb,
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'active';

ALTER TABLE public.staff_delegations
  DROP CONSTRAINT IF EXISTS staff_delegations_status_check;

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
      AND t.relname = 'staff_delegations'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.staff_delegations DROP CONSTRAINT IF EXISTS %I', v_conname);
  END LOOP;

  ALTER TABLE public.staff_delegations
    ADD CONSTRAINT staff_delegations_status_check CHECK (
      status IN ('active', 'suspended_parent_closed', 'revoked')
    );
END;
$$;

-- 2C. Upgrade public.listings with safe lifecycle_status ("Pause & Drain")
ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS lifecycle_status text NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS archive_reason text;

ALTER TABLE public.listings
  DROP CONSTRAINT IF EXISTS listings_lifecycle_status_check;

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
      AND t.relname = 'listings'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%lifecycle_status%'
  LOOP
    EXECUTE format('ALTER TABLE public.listings DROP CONSTRAINT IF EXISTS %I', v_conname);
  END LOOP;

  ALTER TABLE public.listings
    ADD CONSTRAINT listings_lifecycle_status_check CHECK (
      lifecycle_status IN ('active', 'paused', 'draining', 'archived_by_owner', 'custody_admin')
    );
END;
$$;

CREATE INDEX IF NOT EXISTS idx_listings_lifecycle_status
  ON public.listings (lifecycle_status, hub_id);

-- =============================================================================
-- PILLAR 3: ZERO-ORPHAN MEDIA ASSET REGISTRY & TTL LIFECYCLE
-- (Created before archive_business_listing RPC so archive can cascade to media_assets)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.media_assets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bucket_id text NOT NULL,
  storage_path text UNIQUE NOT NULL,
  public_url text,
  uploaded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  hub_id uuid REFERENCES public.service_hubs(id) ON DELETE SET NULL,
  file_size_bytes bigint NOT NULL DEFAULT 0,
  mime_type text,
  entity_type text NOT NULL
    CHECK (entity_type IN (
      'avatar', 'listing_cover', 'listing_gallery', 'product_image',
      'menu_item_image', 'resource_photo', 'bulletin_media', 'print_document',
      'delivery_pod', 'payment_utr_proof', 'civic_report_proof',
      'kyc_document', 'banner_image'
    )),
  entity_id uuid,
  retention_class text NOT NULL DEFAULT 'permanent_bound'
    CHECK (retention_class IN ('permanent_bound', 'ephemeral_ttl', 'temp_draft')),
  status text NOT NULL DEFAULT 'pending_attach'
    CHECK (status IN ('pending_attach', 'active', 'marked_for_deletion', 'purged')),
  expires_at timestamptz,
  purged_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- [v21a P0-21] Fresh-replay guard: 00017 already created `media_assets` (public_url NOT NULL,
-- is_temporary, no lifecycle columns), so the CREATE above is a no-op on sequential replays.
-- Reconcile idempotently (no-op on already-migrated databases).
ALTER TABLE public.media_assets
  ADD COLUMN IF NOT EXISTS uploaded_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS hub_id uuid REFERENCES public.service_hubs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS file_size_bytes bigint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS mime_type text,
  ADD COLUMN IF NOT EXISTS retention_class text NOT NULL DEFAULT 'permanent_bound',
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'pending_attach',
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS purged_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'media_assets'
      AND column_name = 'public_url' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.media_assets ALTER COLUMN public_url DROP NOT NULL;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_media_assets_status_expires
  ON public.media_assets (status, expires_at);

CREATE INDEX IF NOT EXISTS idx_media_assets_entity
  ON public.media_assets (entity_type, entity_id);

ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Uploaders and admins can view media assets" ON public.media_assets;
CREATE POLICY "Uploaders and admins can view media assets"
  ON public.media_assets FOR SELECT TO authenticated
  USING (uploaded_by = auth.uid() OR public.is_super_admin());

DROP POLICY IF EXISTS "Authenticated users can insert own media assets" ON public.media_assets;
CREATE POLICY "Authenticated users can insert own media assets"
  ON public.media_assets FOR INSERT TO authenticated
  WITH CHECK (uploaded_by = auth.uid() OR public.is_super_admin());

DROP POLICY IF EXISTS "Super admin can update media assets" ON public.media_assets;
CREATE POLICY "Super admin can update media assets"
  ON public.media_assets FOR UPDATE TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS "Super admin can delete media assets" ON public.media_assets;
CREATE POLICY "Super admin can delete media assets"
  ON public.media_assets FOR DELETE TO authenticated
  USING (public.is_super_admin());

-- 3B. bind_media_assets RPC (Zero-Orphan Replacement)
CREATE OR REPLACE FUNCTION public.bind_media_assets(
  p_storage_paths text[],
  p_entity_type text,
  p_entity_id uuid,
  p_retention_class text DEFAULT 'permanent_bound',
  p_ttl_hours integer DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_expires timestamptz := CASE
    WHEN p_ttl_hours IS NOT NULL AND p_ttl_hours > 0
      THEN now() + make_interval(hours => p_ttl_hours)
    ELSE NULL
  END;
  v_paths text[] := COALESCE(p_storage_paths, ARRAY[]::text[]);
BEGIN
  -- 1. Activate provided storage paths
  IF array_length(v_paths, 1) IS NOT NULL THEN
    UPDATE public.media_assets
    SET
      status = 'active',
      entity_type = p_entity_type,
      entity_id = p_entity_id,
      retention_class = COALESCE(p_retention_class, 'permanent_bound'),
      expires_at = v_expires,
      updated_at = now()
    WHERE storage_path = ANY(v_paths);
  END IF;

  -- 2. Mark previously active assets for this same entity that are no longer bound for immediate cleanup
  UPDATE public.media_assets
  SET
    status = 'marked_for_deletion',
    expires_at = now(),
    updated_at = now()
  WHERE entity_type = p_entity_type
    AND entity_id = p_entity_id
    AND status = 'active'
    AND NOT (storage_path = ANY(v_paths));
END;
$$;

REVOKE ALL ON FUNCTION public.bind_media_assets(text[], text, uuid, text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.bind_media_assets(text[], text, uuid, text, integer) TO authenticated, service_role;

-- =============================================================================
-- PILLAR 2D: SAFE BUSINESS LIFECYCLE & MULTI-ROLE HATS RPCs
-- =============================================================================

-- archive_business_listing (Pause & Drain vs Safe Cascade Archive)
CREATE OR REPLACE FUNCTION public.archive_business_listing(
  p_listing_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_service boolean := (current_setting('role', true) = 'service_role');
  v_listing record;
  v_print_cnt integer := 0;
  v_booking_cnt integer := 0;
  v_shop_cnt integer := 0;
  v_rest_cnt integer := 0;
  v_settle_cnt integer := 0;
  v_staff record;
BEGIN
  SELECT id, title, owner_id, hub_id, lifecycle_status
    INTO v_listing
  FROM public.listings
  WHERE id = p_listing_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Listing not found.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT v_is_service AND NOT public.is_super_admin() AND v_listing.owner_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Forbidden: Only the listing owner or Super Admin may archive this business.'
      USING ERRCODE = '42501';
  END IF;

  -- Check 5 in-flight operational & financial obligations
  SELECT COUNT(*)::integer INTO v_print_cnt
  FROM public.print_orders
  WHERE listing_id = p_listing_id
    AND fulfillment_status NOT IN ('collected', 'cancelled');

  SELECT COUNT(*)::integer INTO v_booking_cnt
  FROM public.resource_bookings
  WHERE listing_id = p_listing_id
    AND booking_status IN ('confirmed', 'checked_in')
    AND end_at > now();

  SELECT COUNT(*)::integer INTO v_shop_cnt
  FROM public.shop_orders
  WHERE listing_id = p_listing_id
    AND order_status NOT IN ('completed', 'cancelled');

  SELECT COUNT(*)::integer INTO v_rest_cnt
  FROM public.restaurant_orders
  WHERE listing_id = p_listing_id
    AND kitchen_status NOT IN ('completed', 'rejected', 'cancelled');

  SELECT COUNT(*)::integer INTO v_settle_cnt
  FROM public.merchant_settlements
  WHERE listing_id = p_listing_id
    AND status IN ('locked', 'eligible');

  IF (v_print_cnt + v_booking_cnt + v_shop_cnt + v_rest_cnt + v_settle_cnt) > 0 THEN
    UPDATE public.listings
    SET lifecycle_status = 'draining', updated_at = now()
    WHERE id = p_listing_id;

    RETURN jsonb_build_object(
      'outcome', 'draining',
      'blocking_counts', jsonb_build_object(
        'print_orders', v_print_cnt,
        'resource_bookings', v_booking_cnt,
        'shop_orders', v_shop_cnt,
        'restaurant_orders', v_rest_cnt,
        'merchant_settlements', v_settle_cnt
      )
    );
  END IF;

  -- Zero in-flight obligations -> Safe Archive & Cascade
  UPDATE public.listings
  SET
    lifecycle_status = 'archived_by_owner',
    archived_at = now(),
    archive_reason = p_reason,
    updated_at = now()
  WHERE id = p_listing_id;

  -- Suspend linked staff delegations + notify affected staff
  FOR v_staff IN
    UPDATE public.staff_delegations
    SET status = 'suspended_parent_closed'
    WHERE listing_id = p_listing_id
      AND status = 'active'
    RETURNING staff_id
  LOOP
    IF v_staff.staff_id IS NOT NULL THEN
      INSERT INTO public.notifications (user_id, title, message, type, is_read)
      VALUES (
        v_staff.staff_id,
        'Staff Assignment Paused',
        'Your delegated access for "' || COALESCE(v_listing.title, 'Business') || '" was paused because the owner archived the listing.',
        'system',
        false
      );
    END IF;
  END LOOP;

  -- Deactivate vertical inventory & availability
  UPDATE public.marketplace_products SET in_stock = false WHERE listing_id = p_listing_id;
  UPDATE public.restaurant_menu_items SET in_stock = false WHERE listing_id = p_listing_id;
  UPDATE public.listing_booking_resources SET is_active = false WHERE listing_id = p_listing_id;
  UPDATE public.listing_real_estate_profiles SET availability_status = 'paused', updated_at = now() WHERE listing_id = p_listing_id;
  UPDATE public.listing_print_profiles SET is_accepting_orders = false, updated_at = now() WHERE listing_id = p_listing_id;
  UPDATE public.listing_shop_profiles SET is_accepting_orders = false, updated_at = now() WHERE listing_id = p_listing_id;
  UPDATE public.listing_restaurant_profiles SET is_kitchen_open = false, updated_at = now() WHERE listing_id = p_listing_id;
  UPDATE public.listing_hotel_profiles SET is_accepting_bookings = false, updated_at = now() WHERE listing_id = p_listing_id;

  -- Pause listing-scoped active subscriptions
  UPDATE public.user_subscriptions
  SET status = 'paused_listing_archived'
  WHERE listing_id = p_listing_id
    AND status = 'active';

  -- Mark bound media assets for 14-day grace deletion
  UPDATE public.media_assets
  SET
    status = 'marked_for_deletion',
    expires_at = now() + interval '14 days',
    updated_at = now()
  WHERE entity_id = p_listing_id
    AND entity_type IN ('listing_cover', 'listing_gallery')
    AND status = 'active';

  RETURN jsonb_build_object(
    'outcome', 'archived',
    'cascaded', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.archive_business_listing(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.archive_business_listing(uuid, text) TO authenticated, service_role;

-- transfer_business_ownership (Super-Admin only)
CREATE OR REPLACE FUNCTION public.transfer_business_ownership(
  p_listing_id uuid,
  p_new_owner_id uuid,
  p_reactivate_staff boolean DEFAULT false,
  p_transfer_subscriptions boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_service boolean := (current_setting('role', true) = 'service_role');
  v_new_owner_name text;
BEGIN
  IF NOT v_is_service AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Forbidden: Only Super Admin may transfer business ownership.'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(full_name, email, 'Business Owner') INTO v_new_owner_name
  FROM public.profiles
  WHERE id = p_new_owner_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target owner profile not found.' USING ERRCODE = 'P0002';
  END IF;

  UPDATE public.listings
  SET
    owner_id = p_new_owner_id,
    owner_name = v_new_owner_name,
    lifecycle_status = 'active',
    archived_at = NULL,
    archive_reason = NULL,
    updated_at = now()
  WHERE id = p_listing_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Listing not found.' USING ERRCODE = 'P0002';
  END IF;

  IF p_reactivate_staff THEN
    UPDATE public.staff_delegations
    SET granted_by_owner_id = p_new_owner_id, status = 'active'
    WHERE listing_id = p_listing_id
      AND status IN ('active', 'suspended_parent_closed');
  ELSE
    UPDATE public.staff_delegations
    SET granted_by_owner_id = p_new_owner_id
    WHERE listing_id = p_listing_id;
  END IF;

  IF p_transfer_subscriptions THEN
    UPDATE public.user_subscriptions
    SET
      user_id = p_new_owner_id,
      status = CASE WHEN status = 'paused_listing_archived' AND expires_at > now() THEN 'active' ELSE status END
    WHERE listing_id = p_listing_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'listing_id', p_listing_id,
    'new_owner_id', p_new_owner_id,
    'reactivated_staff', p_reactivate_staff,
    'transferred_subscriptions', p_transfer_subscriptions
  );
END;
$$;

REVOKE ALL ON FUNCTION public.transfer_business_ownership(uuid, uuid, boolean, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.transfer_business_ownership(uuid, uuid, boolean, boolean) TO authenticated, service_role;

-- get_user_operational_hats (Single fast RPC for /workspace & Drawer)
CREATE OR REPLACE FUNCTION public.get_user_operational_hats(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := COALESCE(p_user_id, auth.uid());
  v_role text := 'visitor';
  v_owned_listings integer := 0;
  v_owned_vehicles integer := 0;
  v_staff_assignments jsonb := '[]'::jsonb;
  v_driver_profile jsonb := NULL;
  v_managed_hubs jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object(
      'platform_role', 'visitor',
      'owned_listings_count', 0,
      'owned_vehicles_count', 0,
      'active_staff_assignments', '[]'::jsonb,
      'driver_profile', NULL,
      'managed_hubs', '[]'::jsonb
    );
  END IF;

  SELECT lower(COALESCE(role, 'visitor')) INTO v_role
  FROM public.profiles WHERE id = v_uid;

  SELECT COUNT(*)::integer INTO v_owned_listings
  FROM public.listings
  WHERE owner_id = v_uid
    AND COALESCE(lifecycle_status, 'active') <> 'archived_by_owner';

  SELECT COUNT(*)::integer INTO v_owned_vehicles
  FROM public.vehicle_listings
  WHERE owner_id = v_uid;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'id', sd.id,
      'listing_id', sd.listing_id,
      'listing_title', l.title,
      'listing_vertical', l.listing_vertical,
      'vertical_scopes', sd.vertical_scopes,
      'status', sd.status
    )
  ), '[]'::jsonb)
    INTO v_staff_assignments
  FROM public.staff_delegations sd
  JOIN public.listings l ON l.id = sd.listing_id
  WHERE sd.staff_id = v_uid
    AND COALESCE(sd.status, 'active') = 'active'
    AND COALESCE(l.lifecycle_status, 'active') IN ('active', 'draining');

  SELECT to_jsonb(dp) INTO v_driver_profile
  FROM public.driver_profiles dp
  WHERE dp.user_id = v_uid
    AND dp.is_active = true
  LIMIT 1;

  SELECT COALESCE(jsonb_agg(
    jsonb_build_object(
      'hub_id', hm.hub_id,
      'hub_name', sh.name,
      'hub_slug', sh.slug,
      'can_confirm_manual_payments', hm.can_confirm_manual_payments,
      'can_edit_rates', hm.can_edit_rates
    )
  ), '[]'::jsonb)
    INTO v_managed_hubs
  FROM public.hub_managers hm
  JOIN public.service_hubs sh ON sh.id = hm.hub_id
  WHERE hm.profile_id = v_uid
    AND hm.is_active = true;

  RETURN jsonb_build_object(
    'platform_role', COALESCE(v_role, 'visitor'),
    'owned_listings_count', v_owned_listings,
    'owned_vehicles_count', v_owned_vehicles,
    'active_staff_assignments', v_staff_assignments,
    'driver_profile', v_driver_profile,
    'managed_hubs', v_managed_hubs
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_user_operational_hats(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_operational_hats(uuid) TO authenticated, service_role;
