-- =============================================================================
-- Migration: 20261119_phase65a_banners_and_announcements.sql
-- Phase 65-A: Scheduled Ad Banners, Global App-Wide Festive/Offer Row,
--             Strict Schedule-Aware RLS & Telemetry RPC
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Ensure Super-Admin Helper Exists (Idempotent)
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

-- =============================================================================
-- 1. App-Wide Announcements / Offer / Festive Row (`public.app_announcements`)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.app_announcements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type text NOT NULL CHECK (
    type IN ('offer', 'festive', 'info', 'announcement', 'alert')
  ),
  badge_label text,
  message text NOT NULL,
  promo_code text,
  cta_label text,
  cta_url text,
  starts_at timestamptz DEFAULT now(),
  expires_at timestamptz,
  priority integer NOT NULL DEFAULT 0,
  is_dismissible boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_announcements_active_schedule
  ON public.app_announcements (is_active, priority DESC, created_at DESC);

ALTER TABLE public.app_announcements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read active scheduled announcements"
  ON public.app_announcements;
CREATE POLICY "Public can read active scheduled announcements"
  ON public.app_announcements
  FOR SELECT
  USING (
    is_active = true
    AND (starts_at IS NULL OR starts_at <= now())
    AND (expires_at IS NULL OR expires_at > now())
  );

DROP POLICY IF EXISTS "Super admin full access to announcements"
  ON public.app_announcements;
CREATE POLICY "Super admin full access to announcements"
  ON public.app_announcements
  FOR ALL
  TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- =============================================================================
-- 2. Placement-Targeted Promotional & Ad Banners (`public.app_banners`)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.app_banners (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL,
  subtitle text,
  badge_text text DEFAULT 'Sponsored',
  image_url text,
  cta_label text DEFAULT 'Learn More',
  target_url text NOT NULL,
  promo_code text,
  placement text NOT NULL CHECK (
    placement IN (
      'landing_top',
      'landing_mid',
      'explore_top',
      'marketplace_top',
      'bulletin_top'
    )
  ),
  theme_style text NOT NULL DEFAULT 'clean' CHECK (
    theme_style IN ('clean', 'primary', 'festive', 'dark')
  ),
  sponsor_name text,
  starts_at timestamptz DEFAULT now(),
  expires_at timestamptz,
  sort_order integer NOT NULL DEFAULT 0,
  impressions_count integer NOT NULL DEFAULT 0,
  clicks_count integer NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES public.profiles(id),
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_banners_placement_schedule
  ON public.app_banners (placement, is_active, sort_order ASC, created_at DESC);

ALTER TABLE public.app_banners ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read active scheduled banners"
  ON public.app_banners;
CREATE POLICY "Public can read active scheduled banners"
  ON public.app_banners
  FOR SELECT
  USING (
    is_active = true
    AND (starts_at IS NULL OR starts_at <= now())
    AND (expires_at IS NULL OR expires_at > now())
  );

DROP POLICY IF EXISTS "Super admin full access to banners"
  ON public.app_banners;
CREATE POLICY "Super admin full access to banners"
  ON public.app_banners
  FOR ALL
  TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- =============================================================================
-- 3. Lightweight Telemetry RPC (`public.track_banner_metric`)
--    Safely increments impressions_count or clicks_count without exposing
--    direct public UPDATE permissions on `public.app_banners`.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.track_banner_metric(
  p_banner_id uuid,
  p_metric text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_banner_id IS NULL THEN
    RETURN;
  END IF;

  IF p_metric = 'impression' THEN
    UPDATE public.app_banners
    SET impressions_count = impressions_count + 1
    WHERE id = p_banner_id
      AND is_active = true
      AND (starts_at IS NULL OR starts_at <= now())
      AND (expires_at IS NULL OR expires_at > now());
  ELSIF p_metric = 'click' THEN
    UPDATE public.app_banners
    SET clicks_count = clicks_count + 1
    WHERE id = p_banner_id
      AND is_active = true
      AND (starts_at IS NULL OR starts_at <= now())
      AND (expires_at IS NULL OR expires_at > now());
  ELSE
    RAISE EXCEPTION 'Invalid metric type: %. Allowed: impression, click', p_metric;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.track_banner_metric(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.track_banner_metric(uuid, text) TO anon, authenticated;
