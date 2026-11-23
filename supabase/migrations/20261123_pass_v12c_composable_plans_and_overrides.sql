-- =============================================================================
-- Migration: 20261123_pass_v12c_composable_plans_and_overrides.sql
-- Pass V12-C: Full Composable Subscription Plan Builder, Manual Overrides,
--             and All-Workspace Schema Columns (100% Idempotent)
-- =============================================================================

-- 1. Extend public.subscription_plans with full merchant-facing identity & lifecycle columns
ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS target_verticals text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS original_price_inr integer,
  ADD COLUMN IF NOT EXISTS trial_days integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS grace_period_days integer NOT NULL DEFAULT 3,
  ADD COLUMN IF NOT EXISTS display_order integer NOT NULL DEFAULT 100,
  ADD COLUMN IF NOT EXISTS is_popular boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS tagline text,
  ADD COLUMN IF NOT EXISTS highlights text[] NOT NULL DEFAULT '{}'::text[];

-- Ensure plan_scope accepts 'custom_plan' & nullable fallback for flexible plans
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
      AND pg_get_constraintdef(c.oid) ILIKE '%plan_scope%'
  LOOP
    EXECUTE format('ALTER TABLE public.subscription_plans DROP CONSTRAINT IF EXISTS %I', v_conname);
  END LOOP;
END;
$$;

-- 2. Extend public.user_subscriptions with manual override reason & expiry
ALTER TABLE public.user_subscriptions
  ADD COLUMN IF NOT EXISTS override_reason text,
  ADD COLUMN IF NOT EXISTS override_expires_at timestamptz;

-- 3. Extend public.marketplace_products for Shop Stock form
ALTER TABLE public.marketplace_products
  ADD COLUMN IF NOT EXISTS stock_count integer,
  ADD COLUMN IF NOT EXISTS sku_variant_note text,
  ADD COLUMN IF NOT EXISTS supports_pick_n_drop boolean NOT NULL DEFAULT true;

-- 4. Extend public.restaurant_menu_items for Menu Dish form
ALTER TABLE public.restaurant_menu_items
  ADD COLUMN IF NOT EXISTS spice_level text NOT NULL DEFAULT 'medium',
  ADD COLUMN IF NOT EXISTS prep_time_mins integer NOT NULL DEFAULT 15,
  ADD COLUMN IF NOT EXISTS portion_note text;

-- 5. Extend public.vehicle_listings for Bookings Fleet form
ALTER TABLE public.vehicle_listings
  ADD COLUMN IF NOT EXISTS vehicle_reg_no text,
  ADD COLUMN IF NOT EXISTS operator_phone text,
  ADD COLUMN IF NOT EXISTS operator_whatsapp text,
  ADD COLUMN IF NOT EXISTS available_seats integer;

-- 6. Upgrade get_effective_entitlements() to support all 21+ composable features,
--    all 11+ numeric quotas (where JSON null OR -1 = Unlimited -1),
--    legacy-key aliasing, and Super-Admin override expiry & precedence.
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
  v_alias text;
  v_ov_exp timestamptz;
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

  IF COALESCE(v_user_role, '') = 'super_admin' OR COALESCE(v_owner_role, '') = 'super_admin' THEN
    RETURN jsonb_build_object(
      'features', jsonb_build_object(
        'verified_badge', true,
        'custom_logo_map_pin', true,
        'panorama_360_showcase', true,
        'whatsapp_direct_cta', true,
        'pick_n_drop_merchant_dispatch', true,
        'pick_n_drop_dispatch', true,
        'analytics_insights', true,
        'print_online_orders', true,
        'print_express_badge', true,
        'print_custom_digital', true,
        'booking_slots', true,
        'booking_walk_in_blocks', true,
        'hotel_multi_room', true,
        'shop_basket_checkout', true,
        'shop_live_inventory', true,
        'restaurant_menu_ordering', true,
        'restaurant_table_booking', true,
        'real_estate_polygon_overlay', true,
        'real_estate_boost_eligible', true,
        'real_estate_verified_boost', true,
        'real_estate_site_visit_queue', true,
        'staff_delegation', true,
        'bulletin_posting', true,
        'featured_slot_requests', true,
        'featured_map_pin', true,
        'counter_qr_posters', true
      ),
      'limits', jsonb_build_object(
        'max_active_listings', -1,
        'max_catalogue_items', -1,
        'max_menu_items', -1,
        'max_booking_resources', -1,
        'max_room_types', -1,
        'max_staff_members', -1,
        'max_monthly_bulletins', -1,
        'max_gallery_photos', -1,
        'max_media_per_listing', -1,
        'max_360_panoramas', -1,
        'max_featured_requests_per_month', -1,
        'active_boost_slots', -1,
        'max_vehicle_listings', -1
      ),
      'active_plan_ids', '[]'::jsonb,
      'is_super_admin_bypass', true
    );
  END IF;

  -- Pass 1: Merge Base & Add-on Plans
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
    WHERE us.status IN ('active', 'trialing')
      AND (us.expires_at IS NULL OR us.expires_at > now())
      AND (
        (v_effective_user_id IS NOT NULL AND us.user_id = v_effective_user_id AND us.listing_id IS NULL)
        OR (p_listing_id IS NOT NULL AND us.listing_id = p_listing_id)
      )
    ORDER BY sp.is_addon ASC, us.created_at ASC
  LOOP
    v_plan_ids := array_append(v_plan_ids, v_sub.plan_id);
    v_plan_features := v_sub.features;

    IF v_sub.plan_scope = 'merchant_all_in_one' THEN
      v_plan_features := jsonb_build_object(
        'verified_badge', true,
        'custom_logo_map_pin', true,
        'panorama_360_showcase', true,
        'whatsapp_direct_cta', true,
        'pick_n_drop_merchant_dispatch', true,
        'pick_n_drop_dispatch', true,
        'analytics_insights', true,
        'print_online_orders', true,
        'print_express_badge', true,
        'print_custom_digital', true,
        'booking_slots', true,
        'booking_walk_in_blocks', true,
        'hotel_multi_room', true,
        'shop_basket_checkout', true,
        'shop_live_inventory', true,
        'restaurant_menu_ordering', true,
        'restaurant_table_booking', true,
        'real_estate_polygon_overlay', true,
        'real_estate_boost_eligible', true,
        'real_estate_verified_boost', true,
        'real_estate_site_visit_queue', true,
        'staff_delegation', true,
        'bulletin_posting', true,
        'featured_slot_requests', true,
        'featured_map_pin', true,
        'counter_qr_posters', true
      ) || v_plan_features;
    ELSE
      IF v_sub.plan_scope IN ('print_pro', 'merchant_bundle')
         OR COALESCE(v_sub.legacy_entitlements->>'print_ordering', 'false') = 'true' THEN
        v_plan_features := v_plan_features || jsonb_build_object(
          'print_online_orders', true,
          'print_custom_digital', true,
          'counter_qr_posters', true
        );
      END IF;
      IF v_sub.plan_scope = 'booking_pro'
         OR COALESCE(v_sub.legacy_entitlements->>'booking_venues', 'false') = 'true' THEN
        v_plan_features := v_plan_features || jsonb_build_object(
          'booking_slots', true,
          'booking_walk_in_blocks', true
        );
      END IF;
      IF v_sub.plan_scope = 'stay_pro'
         OR COALESCE(v_sub.legacy_entitlements->>'hotel_stays', 'false') = 'true' THEN
        v_plan_features := v_plan_features || jsonb_build_object('hotel_multi_room', true);
      END IF;
      IF v_sub.plan_scope = 'catalogue_pro'
         OR COALESCE(v_sub.legacy_entitlements->>'catalogue_ordering', 'false') = 'true' THEN
        v_plan_features := v_plan_features || jsonb_build_object(
          'shop_basket_checkout', true,
          'shop_live_inventory', true,
          'pick_n_drop_dispatch', true,
          'pick_n_drop_merchant_dispatch', true,
          'counter_qr_posters', true
        );
      END IF;
      IF v_sub.plan_scope = 'restaurant_pro'
         OR COALESCE(v_sub.legacy_entitlements->>'restaurant_ordering', 'false') = 'true' THEN
        v_plan_features := v_plan_features || jsonb_build_object(
          'restaurant_menu_ordering', true,
          'restaurant_table_booking', true,
          'pick_n_drop_dispatch', true,
          'pick_n_drop_merchant_dispatch', true,
          'counter_qr_posters', true
        );
      END IF;
      IF v_sub.plan_scope IN ('agent_pro', 'real_estate_boost')
         OR COALESCE(v_sub.legacy_entitlements->>'real_estate_pro', 'false') = 'true' THEN
        v_plan_features := v_plan_features || jsonb_build_object(
          'real_estate_verified_boost', true,
          'real_estate_boost_eligible', true,
          'real_estate_polygon_overlay', true,
          'real_estate_site_visit_queue', true,
          'featured_map_pin', true,
          'featured_slot_requests', true
        );
      END IF;
      IF v_sub.plan_scope IN ('bulletin', 'merchant_bundle') THEN
        v_plan_features := v_plan_features || jsonb_build_object('bulletin_posting', true);
      END IF;
    END IF;

    -- Merge boolean features + sync aliases
    FOR v_k, v_val IN SELECT key, value FROM jsonb_each(v_plan_features) LOOP
      IF jsonb_typeof(v_val) = 'boolean' THEN
        v_alias := CASE v_k
          WHEN 'pick_n_drop_dispatch' THEN 'pick_n_drop_merchant_dispatch'
          WHEN 'pick_n_drop_merchant_dispatch' THEN 'pick_n_drop_dispatch'
          WHEN 'real_estate_verified_boost' THEN 'real_estate_boost_eligible'
          WHEN 'real_estate_boost_eligible' THEN 'real_estate_verified_boost'
          WHEN 'featured_map_pin' THEN 'featured_slot_requests'
          WHEN 'featured_slot_requests' THEN 'featured_map_pin'
          ELSE NULL
        END;
        IF (v_val::text = 'true') OR COALESCE((v_features->>v_k)::boolean, false) THEN
          v_features := jsonb_set(v_features, ARRAY[v_k], 'true'::jsonb, true);
          IF v_alias IS NOT NULL THEN
            v_features := jsonb_set(v_features, ARRAY[v_alias], 'true'::jsonb, true);
          END IF;
        ELSIF NOT (v_features ? v_k) THEN
          v_features := jsonb_set(v_features, ARRAY[v_k], 'false'::jsonb, true);
          IF v_alias IS NOT NULL AND NOT (v_features ? v_alias) THEN
            v_features := jsonb_set(v_features, ARRAY[v_alias], 'false'::jsonb, true);
          END IF;
        END IF;
      END IF;
    END LOOP;

    -- Merge numeric limits (null or -1 => -1 Unlimited)
    v_plan_limits := v_sub.limits;
    FOR v_k, v_val IN SELECT key, value FROM jsonb_each(v_plan_limits) LOOP
      IF jsonb_typeof(v_val) IN ('number', 'null') THEN
        v_incoming_num := CASE
          WHEN jsonb_typeof(v_val) = 'null' THEN -1
          ELSE (v_val::text)::numeric
        END;
        IF v_incoming_num < 0 THEN
          v_incoming_num := -1;
        END IF;

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

        v_alias := CASE v_k
          WHEN 'max_media_per_listing' THEN 'max_gallery_photos'
          WHEN 'max_gallery_photos' THEN 'max_media_per_listing'
          WHEN 'active_boost_slots' THEN 'max_featured_requests_per_month'
          WHEN 'max_featured_requests_per_month' THEN 'active_boost_slots'
          ELSE NULL
        END;
        IF v_alias IS NOT NULL THEN
          v_limits := jsonb_set(v_limits, ARRAY[v_alias], to_jsonb((v_limits->>v_k)::numeric), true);
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  -- Pass 2: Overlay active, non-expired Super-Admin manual entitlement_overrides
  FOR v_sub IN
    SELECT
      us.entitlement_overrides,
      us.override_expires_at
    FROM public.user_subscriptions us
    WHERE us.status IN ('active', 'trialing')
      AND (us.expires_at IS NULL OR us.expires_at > now())
      AND us.entitlement_overrides IS NOT NULL
      AND us.entitlement_overrides <> '{}'::jsonb
      AND (
        (v_effective_user_id IS NOT NULL AND us.user_id = v_effective_user_id AND us.listing_id IS NULL)
        OR (p_listing_id IS NOT NULL AND us.listing_id = p_listing_id)
      )
    ORDER BY us.created_at ASC
  LOOP
    v_ov_exp := COALESCE(
      v_sub.override_expires_at,
      NULLIF(v_sub.entitlement_overrides->>'expires_at', '')::timestamptz
    );
    IF v_ov_exp IS NOT NULL AND v_ov_exp <= now() THEN
      CONTINUE;
    END IF;

    IF jsonb_typeof(v_sub.entitlement_overrides->'features') = 'object' THEN
      FOR v_k, v_val IN SELECT key, value FROM jsonb_each(v_sub.entitlement_overrides->'features') LOOP
        IF jsonb_typeof(v_val) = 'boolean' THEN
          v_features := jsonb_set(v_features, ARRAY[v_k], v_val, true);
          v_alias := CASE v_k
            WHEN 'pick_n_drop_dispatch' THEN 'pick_n_drop_merchant_dispatch'
            WHEN 'pick_n_drop_merchant_dispatch' THEN 'pick_n_drop_dispatch'
            WHEN 'real_estate_verified_boost' THEN 'real_estate_boost_eligible'
            WHEN 'real_estate_boost_eligible' THEN 'real_estate_verified_boost'
            WHEN 'featured_map_pin' THEN 'featured_slot_requests'
            WHEN 'featured_slot_requests' THEN 'featured_map_pin'
            ELSE NULL
          END;
          IF v_alias IS NOT NULL THEN
            v_features := jsonb_set(v_features, ARRAY[v_alias], v_val, true);
          END IF;
        END IF;
      END LOOP;
    END IF;

    IF jsonb_typeof(v_sub.entitlement_overrides->'limits') = 'object' THEN
      FOR v_k, v_val IN SELECT key, value FROM jsonb_each(v_sub.entitlement_overrides->'limits') LOOP
        IF jsonb_typeof(v_val) IN ('number', 'null') THEN
          v_incoming_num := CASE
            WHEN jsonb_typeof(v_val) = 'null' OR (v_val::text)::numeric < 0 THEN -1
            ELSE (v_val::text)::numeric
          END;
          v_limits := jsonb_set(v_limits, ARRAY[v_k], to_jsonb(v_incoming_num), true);
          v_alias := CASE v_k
            WHEN 'max_media_per_listing' THEN 'max_gallery_photos'
            WHEN 'max_gallery_photos' THEN 'max_media_per_listing'
            WHEN 'active_boost_slots' THEN 'max_featured_requests_per_month'
            WHEN 'max_featured_requests_per_month' THEN 'active_boost_slots'
            ELSE NULL
          END;
          IF v_alias IS NOT NULL THEN
            v_limits := jsonb_set(v_limits, ARRAY[v_alias], to_jsonb(v_incoming_num), true);
          END IF;
        END IF;
      END LOOP;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'features', v_features,
    'limits', v_limits,
    'active_plan_ids', to_jsonb(v_plan_ids)
  );
END;
$$;
