-- =============================================================================
-- Pass v20a: Advertiser Workspace & Public Monetization Soft-Expiry Parity
-- =============================================================================
-- Strictly idempotent migration anchored to canonical tables:
--   `bulletins`, `marketplace_products` (and `marketplace_items` if present),
--   `listings`, `pay_per_orders`, `user_subscriptions`, `subscription_plans`,
--   and `public.audit_logs` (canonical live columns).
--
-- Deliverables:
--   1. Deterministic helper `public.is_monetized_item_publicly_visible(timestamptz)`
--      and aligned public SELECT RLS policies on `bulletins`,
--      `marketplace_products` (plus `marketplace_items` if present), and
--      `listings` so public/anon users never see expired `paid_until` items,
--      while authors/owners, active delegated staff, and admins ALWAYS retain
--      SELECT visibility on expired records for zero-data-loss Pay-Per renewal.
--   2. Optional venue columns (`venue_label`, `venue_lat`, `venue_lng`) on
--      `public.bulletins` (`ADD COLUMN IF NOT EXISTS`) for Event venue pin support.
--   3. `SECURITY DEFINER` RPC `public.get_advertiser_workspace_summary()`
--      returning live subscription/trial/Default Free status, remaining days,
--      `trial_used_at` eligibility, targeted VIP plans, trial-eligible plans,
--      monthly/active bulletin quota usage, `auto_verify_bulletins` status,
--      bulletin status/expiry counts, expiring/expired bulletin list, and recent
--      `pay_per_orders` for `module_key = 'bulletin_post'`.
--   4. Advertiser lifecycle audit trigger on `public.bulletins` logging
--      self-archive, unpublish, republish, and delete mutations cleanly into
--      `public.audit_logs` using exact live columns (`actor_role = 'advertiser'`,
--      `workspace = 'advertiser'`, `target_table`, `target_id::text`,
--      `target_name`, `details text`, `metadata jsonb`).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. IDEMPOTENT COLUMN GUARDRAILS (`paid_until`, `is_verified`, Event venue)
-- -----------------------------------------------------------------------------
ALTER TABLE public.bulletins
  ADD COLUMN IF NOT EXISTS paid_until timestamptz NULL,
  ADD COLUMN IF NOT EXISTS is_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS venue_label text NULL,
  ADD COLUMN IF NOT EXISTS venue_lat double precision NULL,
  ADD COLUMN IF NOT EXISTS venue_lng double precision NULL;

ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS paid_until timestamptz NULL,
  ADD COLUMN IF NOT EXISTS is_verified boolean NOT NULL DEFAULT false;

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

-- Helpful partial indexes for soft-expiry public visibility scans
CREATE INDEX IF NOT EXISTS idx_bulletins_paid_until_v20a
  ON public.bulletins (paid_until)
  WHERE paid_until IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_listings_paid_until_v20a
  ON public.listings (paid_until)
  WHERE paid_until IS NOT NULL;

DO $$
BEGIN
  IF to_regclass('public.marketplace_products') IS NOT NULL THEN
    CREATE INDEX IF NOT EXISTS idx_marketplace_products_paid_until_v20a
      ON public.marketplace_products (paid_until)
      WHERE paid_until IS NOT NULL;
  END IF;
END;
$$;

-- -----------------------------------------------------------------------------
-- 2. DETERMINISTIC SOFT-EXPIRY VISIBILITY HELPER & PUBLIC SELECT RLS ALIGNMENT
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_monetized_item_publicly_visible(
  p_paid_until timestamptz
)
RETURNS boolean
LANGUAGE sql
STABLE
AS $$
  SELECT p_paid_until IS NULL OR p_paid_until > now();
$$;

REVOKE ALL ON FUNCTION public.is_monetized_item_publicly_visible(timestamptz) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_monetized_item_publicly_visible(timestamptz) TO anon, authenticated, service_role;

-- 2A. Align `public.bulletins` SELECT RLS
ALTER TABLE public.bulletins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read published active bulletins" ON public.bulletins;
DROP POLICY IF EXISTS "Authors can read their own bulletins" ON public.bulletins;
DROP POLICY IF EXISTS bulletins_public_or_owner_select_v20a ON public.bulletins;

CREATE POLICY bulletins_public_or_owner_select_v20a
  ON public.bulletins
  FOR SELECT
  USING (
    (
      status = 'published'
      AND (expires_at IS NULL OR expires_at > now())
      AND public.is_monetized_item_publicly_visible(paid_until)
    )
    OR author_id = auth.uid()
    OR (
      linked_listing_id IS NOT NULL
      AND public.is_active_listing_staff(linked_listing_id, auth.uid())
    )
    OR public.is_pnd_admin(auth.uid())
  );

-- 2B. Align `public.marketplace_products` SELECT RLS
DO $$
BEGIN
  IF to_regclass('public.marketplace_products') IS NOT NULL THEN
    ALTER TABLE public.marketplace_products ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Public can read active marketplace products" ON public.marketplace_products;
    DROP POLICY IF EXISTS marketplace_products_public_or_owner_select_v20a ON public.marketplace_products;

    CREATE POLICY marketplace_products_public_or_owner_select_v20a
      ON public.marketplace_products
      FOR SELECT
      USING (
        (
          is_active = true
          AND public.is_monetized_item_publicly_visible(paid_until)
        )
        OR owner_id = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM public.listings l
          WHERE l.id = marketplace_products.listing_id
            AND l.owner_id = auth.uid()
        )
        OR (
          listing_id IS NOT NULL
          AND public.is_active_listing_staff(listing_id, auth.uid())
        )
        OR public.is_pnd_admin(auth.uid())
      );
  END IF;
END;
$$;

-- 2C. Align optional legacy `public.marketplace_items` SELECT RLS if present
DO $$
BEGIN
  IF to_regclass('public.marketplace_items') IS NOT NULL THEN
    ALTER TABLE public.marketplace_items ENABLE ROW LEVEL SECURITY;

    DROP POLICY IF EXISTS "Public can read active marketplace items" ON public.marketplace_items;
    DROP POLICY IF EXISTS marketplace_items_public_or_owner_select_v20a ON public.marketplace_items;

    CREATE POLICY marketplace_items_public_or_owner_select_v20a
      ON public.marketplace_items
      FOR SELECT
      USING (
        public.is_monetized_item_publicly_visible(paid_until)
        OR owner_id = auth.uid()
        OR public.is_pnd_admin(auth.uid())
      );
  END IF;
END;
$$;

-- 2D. Align `public.listings` SELECT RLS
ALTER TABLE public.listings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow public read access to listings" ON public.listings;
DROP POLICY IF EXISTS listings_public_or_owner_select_v20a ON public.listings;

CREATE POLICY listings_public_or_owner_select_v20a
  ON public.listings
  FOR SELECT
  USING (
    (
      status IN ('published', 'approved')
      AND public.is_monetized_item_publicly_visible(paid_until)
    )
    OR owner_id = auth.uid()
    OR public.is_active_listing_staff(id, auth.uid())
    OR public.is_pnd_admin(auth.uid())
  );

-- -----------------------------------------------------------------------------
-- 3. ADVERTISER WORKSPACE SUMMARY RPC (`public.get_advertiser_workspace_summary`)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_advertiser_workspace_summary()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_profile record;
  v_ent jsonb := '{}'::jsonb;
  v_active_sub record;
  v_default_free record;
  v_sub_json jsonb;
  v_days_remaining integer := NULL;

  v_auto_verify_bulletins boolean := false;
  v_monthly_used integer := 0;
  v_monthly_limit integer := NULL;
  v_active_used integer := 0;
  v_active_limit integer := NULL;
  v_allow_youtube boolean := false;
  v_max_images integer := 3;

  v_total_count integer := 0;
  v_published_count integer := 0;
  v_pending_count integer := 0;
  v_archived_count integer := 0;
  v_expiring_soon_count integer := 0;
  v_expired_count integer := 0;

  v_targeted_vip_plans jsonb := '[]'::jsonb;
  v_trial_eligible_plans jsonb := '[]'::jsonb;
  v_expiring_bulletins jsonb := '[]'::jsonb;
  v_recent_orders jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required to load Advertiser Workspace summary.'
      USING ERRCODE = '42501';
  END IF;

  -- 1. Load caller profile & trial eligibility
  SELECT id, full_name, username, role, trial_used_at
    INTO v_profile
  FROM public.profiles
  WHERE id = v_uid;

  -- 2. Resolve live effective entitlements via v17b canonical RPC
  v_ent := COALESCE(public.get_effective_entitlements(v_uid, NULL), '{}'::jsonb);
  v_auto_verify_bulletins := COALESCE((v_ent->>'auto_verify_bulletins')::boolean, false);

  -- 3. Resolve active / trialing subscription OR Default Free baseline
  SELECT
    us.id AS subscription_id,
    us.plan_id,
    us.status,
    us.starts_at,
    COALESCE(us.ends_at, us.expires_at) AS effective_ends_at,
    sp.slug AS plan_slug,
    COALESCE(sp.title, sp.name, 'Active Plan') AS plan_name,
    COALESCE(sp.info, sp.tagline, '') AS plan_info,
    COALESCE(sp.is_default_free, false) AS is_default_free,
    sp.max_monthly_posts,
    sp.max_active_bulletins,
    sp.max_images_per_post,
    sp.allow_youtube
  INTO v_active_sub
  FROM public.user_subscriptions us
  INNER JOIN public.subscription_plans sp ON sp.id = us.plan_id
  WHERE us.user_id = v_uid
    AND us.status IN ('active', 'trialing')
    AND (COALESCE(us.ends_at, us.expires_at) IS NULL OR COALESCE(us.ends_at, us.expires_at) > now())
  ORDER BY
    CASE WHEN us.status = 'active' THEN 1 ELSE 2 END,
    COALESCE(us.ends_at, us.expires_at) DESC NULLS LAST,
    us.created_at DESC
  LIMIT 1;

  IF FOUND THEN
    IF v_active_sub.effective_ends_at IS NOT NULL THEN
      v_days_remaining := GREATEST(
        0,
        ceil(EXTRACT(EPOCH FROM (v_active_sub.effective_ends_at - now())) / 86400.0)::integer
      );
    END IF;

    v_sub_json := jsonb_build_object(
      'subscription_id', v_active_sub.subscription_id,
      'plan_id', v_active_sub.plan_id,
      'plan_slug', v_active_sub.plan_slug,
      'plan_name', v_active_sub.plan_name,
      'plan_info', v_active_sub.plan_info,
      'status', v_active_sub.status,
      'is_trial', (v_active_sub.status = 'trialing'),
      'is_default_free', v_active_sub.is_default_free,
      'starts_at', v_active_sub.starts_at,
      'ends_at', v_active_sub.effective_ends_at,
      'days_remaining', v_days_remaining
    );

    v_monthly_limit := v_active_sub.max_monthly_posts;
    v_active_limit := v_active_sub.max_active_bulletins;
    v_allow_youtube := COALESCE(v_active_sub.allow_youtube, false);
    v_max_images := GREATEST(1, COALESCE(v_active_sub.max_images_per_post, 5));
  ELSE
    SELECT
      id,
      slug,
      COALESCE(title, name, 'Default Free Tier') AS plan_name,
      COALESCE(info, tagline, 'Baseline starter tier for DD oodle advertisers.') AS plan_info,
      max_monthly_posts,
      max_active_bulletins,
      max_images_per_post,
      allow_youtube
    INTO v_default_free
    FROM public.subscription_plans
    WHERE is_default_free = true
    LIMIT 1;

    v_sub_json := jsonb_build_object(
      'subscription_id', NULL,
      'plan_id', v_default_free.id,
      'plan_slug', COALESCE(v_default_free.slug, 'default-free-tier'),
      'plan_name', COALESCE(v_default_free.plan_name, 'Default Free Tier'),
      'plan_info', COALESCE(v_default_free.plan_info, 'Baseline community tier. Start a free trial or publish via Pay-Per anytime.'),
      'status', 'default_free',
      'is_trial', false,
      'is_default_free', true,
      'starts_at', NULL,
      'ends_at', NULL,
      'days_remaining', NULL
    );

    v_monthly_limit := COALESCE(v_default_free.max_monthly_posts, 0);
    v_active_limit := COALESCE(v_default_free.max_active_bulletins, 0);
    v_allow_youtube := COALESCE(v_default_free.allow_youtube, false);
    v_max_images := GREATEST(1, COALESCE(v_default_free.max_images_per_post, 3));
  END IF;

  -- Align monthly limit with canonical `entitlements->'bulletins'` if stricter/higher
  IF COALESCE((v_ent->>'is_super_admin_bypass')::boolean, false) THEN
    v_monthly_limit := NULL;
    v_active_limit := NULL;
    v_allow_youtube := true;
    v_max_images := 10;
  ELSIF jsonb_typeof(v_ent->'bulletins') = 'object' THEN
    IF COALESCE((v_ent->'bulletins'->>'enabled')::boolean, false) = false THEN
      v_monthly_limit := COALESCE(v_monthly_limit, 0);
    ELSIF v_ent->'bulletins'->'limit' = 'null'::jsonb THEN
      v_monthly_limit := NULL;
    ELSIF jsonb_typeof(v_ent->'bulletins'->'limit') = 'number' THEN
      v_monthly_limit := GREATEST(
        COALESCE(v_monthly_limit, 0),
        COALESCE((v_ent->'bulletins'->>'limit')::integer, 0)
      );
    END IF;
  END IF;

  -- 4. Compute advertiser bulletin counts & usage meters
  SELECT
    count(*)::integer,
    count(*) FILTER (
      WHERE status = 'published'
        AND (expires_at IS NULL OR expires_at > now())
        AND public.is_monetized_item_publicly_visible(paid_until)
    )::integer,
    count(*) FILTER (
      WHERE status IN ('pending', 'pending_review', 'pending_payment', 'draft')
    )::integer,
    count(*) FILTER (
      WHERE status IN ('archived', 'unpublished', 'rejected')
    )::integer,
    count(*) FILTER (
      WHERE paid_until IS NOT NULL
        AND paid_until > now()
        AND paid_until <= now() + interval '7 days'
    )::integer,
    count(*) FILTER (
      WHERE (paid_until IS NOT NULL AND paid_until <= now())
         OR (status = 'published' AND expires_at IS NOT NULL AND expires_at <= now())
    )::integer,
    count(*) FILTER (
      WHERE created_at >= date_trunc('month', now())
    )::integer
  INTO
    v_total_count,
    v_published_count,
    v_pending_count,
    v_archived_count,
    v_expiring_soon_count,
    v_expired_count,
    v_monthly_used
  FROM public.bulletins b
  WHERE b.author_id = v_uid;

  v_active_used := v_published_count;

  -- 5. Targeted VIP plans (`target_scope = 'selected_users'` targeting caller)
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', sp.id,
        'slug', sp.slug,
        'title', COALESCE(sp.title, sp.name, 'VIP Advertiser Plan'),
        'info', COALESCE(sp.info, sp.tagline, ''),
        'price_inr', COALESCE(sp.price_inr, 0),
        'duration_days', COALESCE(sp.duration_days, 30),
        'trial_days', COALESCE(sp.trial_days, 0),
        'target_scope', sp.target_scope,
        'max_monthly_posts', COALESCE(sp.max_monthly_posts, 0),
        'max_active_bulletins', COALESCE(sp.max_active_bulletins, 0),
        'allow_youtube', COALESCE(sp.allow_youtube, false),
        'auto_verify_bulletins', COALESCE((sp.entitlements->>'auto_verify_bulletins')::boolean, false)
      )
      ORDER BY sp.sort_order ASC, sp.price_inr ASC
    ),
    '[]'::jsonb
  )
  INTO v_targeted_vip_plans
  FROM public.subscription_plans sp
  WHERE sp.is_active = true
    AND sp.is_archived = false
    AND sp.is_default_free = false
    AND sp.target_scope = 'selected_users'
    AND v_uid = ANY(COALESCE(sp.target_user_ids, '{}'::uuid[]));

  -- 6. Trial-eligible plans accessible to caller (with bulletin entitlement or trial_days > 0)
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', sp.id,
        'slug', sp.slug,
        'title', COALESCE(sp.title, sp.name, 'Advertiser Plan'),
        'info', COALESCE(sp.info, sp.tagline, ''),
        'price_inr', COALESCE(sp.price_inr, 0),
        'duration_days', COALESCE(sp.duration_days, 30),
        'trial_days', COALESCE(sp.trial_days, 0),
        'target_scope', sp.target_scope,
        'max_monthly_posts', COALESCE(sp.max_monthly_posts, 0),
        'max_active_bulletins', COALESCE(sp.max_active_bulletins, 0),
        'allow_youtube', COALESCE(sp.allow_youtube, false),
        'auto_verify_bulletins', COALESCE((sp.entitlements->>'auto_verify_bulletins')::boolean, false)
      )
      ORDER BY
        CASE WHEN sp.target_scope = 'selected_users' THEN 0 ELSE 1 END,
        sp.sort_order ASC,
        sp.price_inr ASC
    ),
    '[]'::jsonb
  )
  INTO v_trial_eligible_plans
  FROM public.subscription_plans sp
  WHERE sp.is_active = true
    AND sp.is_archived = false
    AND sp.is_default_free = false
    AND COALESCE(sp.trial_days, 0) > 0
    AND (
      sp.target_scope = 'public'
      OR v_uid = ANY(COALESCE(sp.target_user_ids, '{}'::uuid[]))
    );

  -- 7. Expiring (<= 7d) or Soft-Expired bulletins for 1-tap Pay-Per Renewal
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', b.id,
        'title', b.title,
        'category', b.category,
        'status', b.status,
        'paid_until', b.paid_until,
        'expires_at', b.expires_at,
        'is_expired', (b.paid_until <= now()),
        'days_left', ceil(EXTRACT(EPOCH FROM (b.paid_until - now())) / 86400.0)::integer
      )
      ORDER BY b.paid_until ASC
    ),
    '[]'::jsonb
  )
  INTO v_expiring_bulletins
  FROM public.bulletins b
  WHERE b.author_id = v_uid
    AND b.paid_until IS NOT NULL
    AND b.paid_until <= now() + interval '7 days';

  -- 8. Recent Pay-Per Orders for `module_key = 'bulletin_post'`
  IF to_regclass('public.pay_per_orders') IS NOT NULL THEN
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', ppo.id,
          'target_id', ppo.target_id,
          'target_title', COALESCE(b.title, 'Bulletin Notice'),
          'module_key', ppo.module_key,
          'duration_days', ppo.duration_days,
          'amount_inr', ppo.amount_inr,
          'payment_method', ppo.payment_method,
          'upi_utr_ref', ppo.upi_utr_ref,
          'status', ppo.status,
          'paid_until', ppo.paid_until,
          'review_notes', ppo.review_notes,
          'quote_breakdown', ppo.quote_breakdown,
          'created_at', ppo.created_at,
          'updated_at', ppo.updated_at
        )
        ORDER BY ppo.created_at DESC
      ),
      '[]'::jsonb
    )
    INTO v_recent_orders
    FROM (
      SELECT *
      FROM public.pay_per_orders
      WHERE user_id = v_uid
        AND module_key = 'bulletin_post'
      ORDER BY created_at DESC
      LIMIT 25
    ) ppo
    LEFT JOIN public.bulletins b ON b.id = ppo.target_id;
  END IF;

  RETURN jsonb_build_object(
    'user_id', v_uid,
    'profile', jsonb_build_object(
      'id', v_uid,
      'full_name', COALESCE(v_profile.full_name, 'Advertiser'),
      'username', v_profile.username,
      'role', COALESCE(v_profile.role, 'user'),
      'trial_used_at', v_profile.trial_used_at,
      'is_trial_eligible', (v_profile.trial_used_at IS NULL)
    ),
    'active_subscription', v_sub_json,
    'auto_verify_bulletins', v_auto_verify_bulletins,
    'quota_usage', jsonb_build_object(
      'monthly_used', v_monthly_used,
      'monthly_limit', v_monthly_limit,
      'active_used', v_active_used,
      'active_limit', v_active_limit,
      'allow_youtube', v_allow_youtube,
      'max_images_per_post', v_max_images
    ),
    'bulletin_counts', jsonb_build_object(
      'total', v_total_count,
      'published', v_published_count,
      'pending', v_pending_count,
      'archived', v_archived_count,
      'expiring_soon', v_expiring_soon_count,
      'expired', v_expired_count
    ),
    'targeted_vip_plans', v_targeted_vip_plans,
    'trial_eligible_plans', v_trial_eligible_plans,
    'expiring_bulletins', v_expiring_bulletins,
    'recent_pay_per_orders', v_recent_orders
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_advertiser_workspace_summary() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_advertiser_workspace_summary() TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 4. ADVERTISER LIFECYCLE AUDIT TRIGGER (`public.audit_logs` CANONICAL COLUMNS)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.audit_advertiser_bulletin_lifecycle_v20a()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_actor_name text := 'Advertiser';
  v_action text := NULL;
  v_details text := NULL;
  v_target_id text;
  v_target_name text;
  v_meta jsonb;
BEGIN
  IF to_regclass('public.audit_logs') IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  -- Only record authenticated advertiser self-mutations (admin moderation logs separately)
  IF v_uid IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF OLD.author_id IS DISTINCT FROM v_uid THEN
      RETURN OLD;
    END IF;
    v_action := 'advertiser_delete_bulletin';
    v_target_id := OLD.id::text;
    v_target_name := COALESCE(OLD.title, 'Bulletin Notice');
    v_details := 'Advertiser deleted bulletin "' || v_target_name || '"';
    v_meta := jsonb_build_object(
      'category', OLD.category,
      'previous_status', OLD.status,
      'paid_until', OLD.paid_until,
      'expires_at', OLD.expires_at
    );
  ELSIF TG_OP = 'UPDATE' THEN
    IF OLD.author_id IS DISTINCT FROM v_uid THEN
      RETURN NEW;
    END IF;

    IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
      RETURN NEW;
    END IF;

    IF NEW.status IN ('archived', 'unpublished', 'draft') THEN
      v_action := CASE
        WHEN NEW.status = 'archived' THEN 'advertiser_archive_bulletin'
        ELSE 'advertiser_unpublish_bulletin'
      END;
    ELSIF NEW.status = 'published' AND OLD.status IN ('archived', 'unpublished', 'draft') THEN
      v_action := 'advertiser_republish_bulletin';
    ELSE
      RETURN NEW;
    END IF;

    v_target_id := NEW.id::text;
    v_target_name := COALESCE(NEW.title, OLD.title, 'Bulletin Notice');
    v_details := 'Advertiser changed bulletin "' || v_target_name || '" status from ' ||
      COALESCE(OLD.status, 'unknown') || ' to ' || COALESCE(NEW.status, 'unknown');
    v_meta := jsonb_build_object(
      'category', NEW.category,
      'previous_status', OLD.status,
      'next_status', NEW.status,
      'paid_until', NEW.paid_until,
      'expires_at', NEW.expires_at
    );
  ELSE
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT COALESCE(NULLIF(trim(full_name), ''), NULLIF(trim(username), ''), 'Advertiser')
    INTO v_actor_name
  FROM public.profiles
  WHERE id = v_uid;

  INSERT INTO public.audit_logs (
    actor_id,
    actor_name,
    actor_role,
    workspace,
    action,
    target_table,
    target_id,
    target_name,
    details,
    metadata
  )
  VALUES (
    v_uid,
    COALESCE(v_actor_name, 'Advertiser'),
    'advertiser',
    'advertiser',
    v_action,
    'bulletins',
    v_target_id,
    v_target_name,
    v_details,
    v_meta
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_advertiser_bulletin_lifecycle_v20a ON public.bulletins;
CREATE TRIGGER trg_audit_advertiser_bulletin_lifecycle_v20a
  AFTER UPDATE OF status OR DELETE ON public.bulletins
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_advertiser_bulletin_lifecycle_v20a();
