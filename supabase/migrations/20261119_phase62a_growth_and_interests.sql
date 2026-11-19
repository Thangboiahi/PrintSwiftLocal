-- =============================================================================
-- Migration: 20261119_phase62a_growth_and_interests.sql
-- Phase 62-A: Pay-Per-Post Bulletin Passes, Unified Saved/Follows/Interests,
--             Legacy Bookmark Migration & Super-Admin Platform Launch Settings
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Idempotent Role Helpers (SECURITY DEFINER to avoid RLS recursion)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_super_admin(p_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = p_uid
      AND p.role = 'super_admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_pnd_admin(p_uid uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = p_uid
      AND p.role IN ('admin', 'super_admin')
  );
$$;

-- =============================================================================
-- 1. Pay-Per-Post Bulletin Passes (`public.bulletin_post_passes`)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.bulletin_post_passes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  price_inr integer NOT NULL DEFAULT 79,
  duration_days integer NOT NULL DEFAULT 7,
  upi_utr_ref text,
  status text NOT NULL DEFAULT 'pending_verification'
    CHECK (status IN ('pending_verification', 'available', 'used', 'rejected')),
  used_bulletin_id uuid REFERENCES public.bulletins(id) ON DELETE SET NULL,
  verified_by uuid REFERENCES public.profiles(id),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bulletin_post_passes_user_status_created
  ON public.bulletin_post_passes (user_id, status, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_bulletin_post_passes_status_created
  ON public.bulletin_post_passes (status, created_at DESC);

ALTER TABLE public.bulletin_post_passes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users view own passes and admins view all" ON public.bulletin_post_passes;
CREATE POLICY "Users view own passes and admins view all"
  ON public.bulletin_post_passes
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id
    OR public.is_pnd_admin(auth.uid())
  );

DROP POLICY IF EXISTS "Users can request own pending bulletin pass" ON public.bulletin_post_passes;
CREATE POLICY "Users can request own pending bulletin pass"
  ON public.bulletin_post_passes
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND status = 'pending_verification'
    AND used_bulletin_id IS NULL
    AND verified_by IS NULL
  );

DROP POLICY IF EXISTS "Only admins can verify or reject bulletin passes" ON public.bulletin_post_passes;
CREATE POLICY "Only admins can verify or reject bulletin passes"
  ON public.bulletin_post_passes
  FOR UPDATE
  TO authenticated
  USING (public.is_pnd_admin(auth.uid()))
  WITH CHECK (
    public.is_pnd_admin(auth.uid())
    AND status IN ('pending_verification', 'available', 'used', 'rejected')
  );

-- =============================================================================
-- 2. Updated Bulletin Quota Enforcement Trigger & Pass Consumption Trigger
-- =============================================================================
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
  -- Clear any transaction-local pass marker before evaluating this insert
  PERFORM set_config('app.bulletin_pass_id', '', true);

  -- 1. Admins and super_admins bypass subscription and pass quotas
  SELECT lower(coalesce(role, 'visitor'))
    INTO v_author_role
  FROM public.profiles
  WHERE id = NEW.author_id;

  IF v_author_role IN ('admin', 'super_admin') THEN
    RETURN NEW;
  END IF;

  -- 2. Check for an active paid subscription with remaining quota
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
    AND us.status = 'active'
    AND us.expires_at > now()
    AND sp.is_active = true
  ORDER BY us.expires_at DESC
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

    IF v_active_count < v_plan.max_active_bulletins
       AND v_monthly_count < v_plan.max_monthly_posts THEN
      v_image_count := coalesce(array_length(NEW.image_urls, 1), 0);
      IF v_image_count > v_plan.max_images_per_post THEN
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

  -- 3. Fallback: Check for a verified 'available' Pay-Per-Post pass
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

  -- 4. Neither active subscription with quota nor available Pay-Per-Post pass found
  RAISE EXCEPTION 'Active subscription or verified Pay-Per-Post pass required.'
    USING ERRCODE = 'P0001';
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_bulletin_quota ON public.bulletins;
CREATE TRIGGER trg_enforce_bulletin_quota
  BEFORE INSERT ON public.bulletins
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_bulletin_quota();

CREATE OR REPLACE FUNCTION public.consume_bulletin_post_pass()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_pass_id_text text;
  v_pass_id uuid;
BEGIN
  v_pass_id_text := nullif(current_setting('app.bulletin_pass_id', true), '');

  IF v_pass_id_text IS NOT NULL THEN
    v_pass_id := v_pass_id_text::uuid;

    UPDATE public.bulletin_post_passes
    SET
      status = 'used',
      used_bulletin_id = NEW.id
    WHERE id = v_pass_id
      AND user_id = NEW.author_id
      AND status = 'available';

    PERFORM set_config('app.bulletin_pass_id', '', true);
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_consume_bulletin_post_pass ON public.bulletins;
CREATE TRIGGER trg_consume_bulletin_post_pass
  AFTER INSERT ON public.bulletins
  FOR EACH ROW
  EXECUTE FUNCTION public.consume_bulletin_post_pass();

-- =============================================================================
-- 3. Unified Saved, Follows & Interests Tables
-- =============================================================================

-- 3a. user_saved_items
CREATE TABLE IF NOT EXISTS public.user_saved_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  item_type text NOT NULL CHECK (item_type IN ('listing', 'product', 'bulletin')),
  item_id uuid NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (user_id, item_type, item_id)
);

CREATE INDEX IF NOT EXISTS idx_user_saved_items_user_type_created
  ON public.user_saved_items (user_id, item_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_saved_items_item
  ON public.user_saved_items (item_type, item_id);

-- 3b. user_follows
CREATE TABLE IF NOT EXISTS public.user_follows (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  follower_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('shop_listing', 'author')),
  target_id uuid NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (follower_id, target_type, target_id)
);

CREATE INDEX IF NOT EXISTS idx_user_follows_follower_type_created
  ON public.user_follows (follower_id, target_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_user_follows_target
  ON public.user_follows (target_type, target_id);

-- 3c. user_interests
CREATE TABLE IF NOT EXISTS public.user_interests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  interest_type text NOT NULL CHECK (interest_type IN ('category', 'locality', 'bulletin_tag')),
  interest_value text NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE (user_id, interest_type, interest_value)
);

CREATE INDEX IF NOT EXISTS idx_user_interests_user_type
  ON public.user_interests (user_id, interest_type);

-- Enable RLS & strict self-only policies on all 3 tables
ALTER TABLE public.user_saved_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_interests ENABLE ROW LEVEL SECURITY;

-- user_saved_items policies
DROP POLICY IF EXISTS "Users can view own saved items" ON public.user_saved_items;
CREATE POLICY "Users can view own saved items"
  ON public.user_saved_items
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own saved items" ON public.user_saved_items;
CREATE POLICY "Users can insert own saved items"
  ON public.user_saved_items
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own saved items" ON public.user_saved_items;
CREATE POLICY "Users can delete own saved items"
  ON public.user_saved_items
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- user_follows policies
DROP POLICY IF EXISTS "Users can view own follows" ON public.user_follows;
CREATE POLICY "Users can view own follows"
  ON public.user_follows
  FOR SELECT
  TO authenticated
  USING (auth.uid() = follower_id);

DROP POLICY IF EXISTS "Users can insert own follows" ON public.user_follows;
CREATE POLICY "Users can insert own follows"
  ON public.user_follows
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = follower_id);

DROP POLICY IF EXISTS "Users can delete own follows" ON public.user_follows;
CREATE POLICY "Users can delete own follows"
  ON public.user_follows
  FOR DELETE
  TO authenticated
  USING (auth.uid() = follower_id);

-- user_interests policies
DROP POLICY IF EXISTS "Users can view own interests" ON public.user_interests;
CREATE POLICY "Users can view own interests"
  ON public.user_interests
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own interests" ON public.user_interests;
CREATE POLICY "Users can insert own interests"
  ON public.user_interests
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own interests" ON public.user_interests;
CREATE POLICY "Users can delete own interests"
  ON public.user_interests
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- =============================================================================
-- 4. Idempotent Legacy Bookmarks Migration -> `public.user_saved_items`
-- =============================================================================
DO $$
BEGIN
  -- 4a. Migrate from legacy `public.bookmarks` table if present
  IF to_regclass('public.bookmarks') IS NOT NULL
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'bookmarks' AND column_name = 'user_id'
     )
     AND EXISTS (
       SELECT 1 FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = 'bookmarks' AND column_name = 'listing_id'
     ) THEN
    EXECUTE $mig$
      INSERT INTO public.user_saved_items (user_id, item_type, item_id, created_at)
      SELECT
        b.user_id,
        'listing',
        b.listing_id,
        coalesce(b.created_at, now())
      FROM public.bookmarks b
      INNER JOIN public.profiles p ON p.id = b.user_id
      WHERE b.user_id IS NOT NULL
        AND b.listing_id IS NOT NULL
      ON CONFLICT (user_id, item_type, item_id) DO NOTHING
    $mig$;
  END IF;

  -- 4b. Migrate from `public.profiles.saved_listing_ids` jsonb array if present
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'saved_listing_ids'
  ) THEN
    INSERT INTO public.user_saved_items (user_id, item_type, item_id)
    SELECT
      p.id,
      'listing',
      elem::uuid
    FROM public.profiles p
    CROSS JOIN LATERAL jsonb_array_elements_text(
      CASE
        WHEN jsonb_typeof(p.saved_listing_ids) = 'array' THEN p.saved_listing_ids
        ELSE '[]'::jsonb
      END
    ) AS elem
    WHERE elem ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    ON CONFLICT (user_id, item_type, item_id) DO NOTHING;
  END IF;
END;
$$;

-- =============================================================================
-- 5. Platform Launch Settings (`public.platform_settings`)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.platform_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_by uuid REFERENCES public.profiles(id),
  updated_at timestamptz DEFAULT now()
);

-- Seed default launch switch and pay-per-post pricing (never overwrite live values)
INSERT INTO public.platform_settings (key, value)
VALUES
  ('hide_sample_data', '{"enabled": false}'::jsonb),
  ('bulletin_pay_per_post', '{"price_inr": 79, "duration_days": 7}'::jsonb)
ON CONFLICT (key) DO NOTHING;

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read platform settings" ON public.platform_settings;
CREATE POLICY "Public can read platform settings"
  ON public.platform_settings
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Only super_admin can update platform settings" ON public.platform_settings;
CREATE POLICY "Only super_admin can update platform settings"
  ON public.platform_settings
  FOR UPDATE
  TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Only super_admin can insert platform settings" ON public.platform_settings;
CREATE POLICY "Only super_admin can insert platform settings"
  ON public.platform_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid()));
