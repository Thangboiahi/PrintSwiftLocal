-- =============================================================================
-- Migration: 20261119_phase59_bulletin.sql
-- Phase 59-A: Community Bulletin Schema, Subscription Plans, Quota Triggers,
--             Audit Logging, RLS Policies & Idempotent Seed
-- =============================================================================

-- 1. Subscription Plans Table
CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text UNIQUE NOT NULL,
  name text NOT NULL,
  price_inr integer NOT NULL,
  max_active_bulletins integer NOT NULL,
  max_monthly_posts integer NOT NULL,
  max_images_per_post integer NOT NULL DEFAULT 3,
  allow_youtube boolean DEFAULT true,
  duration_days integer NOT NULL DEFAULT 30,
  is_active boolean DEFAULT true
);

-- 2. User Subscriptions Table
CREATE TABLE IF NOT EXISTS public.user_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  plan_id uuid NOT NULL REFERENCES public.subscription_plans(id),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'cancelled')),
  starts_at timestamptz DEFAULT now(),
  expires_at timestamptz NOT NULL,
  payment_ref text,
  verified_by uuid REFERENCES public.profiles(id),
  created_at timestamptz DEFAULT now()
);

-- 3. Bulletins Table
CREATE TABLE IF NOT EXISTS public.bulletins (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  linked_listing_id uuid REFERENCES public.listings(id) ON DELETE SET NULL,
  category text NOT NULL CHECK (category IN ('announcement', 'job', 'advertisement', 'notice', 'event')),
  title text NOT NULL,
  content_json jsonb NOT NULL,
  excerpt text,
  image_urls text[] DEFAULT '{}',
  youtube_video_id text CHECK (youtube_video_id IS NULL OR youtube_video_id ~ '^[A-Za-z0-9_-]{11}$'),
  contact_channels jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'archived', 'removed_by_admin')),
  is_pinned boolean DEFAULT false,
  expires_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 4. Bulletin Reports Table
CREATE TABLE IF NOT EXISTS public.bulletin_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bulletin_id uuid NOT NULL REFERENCES public.bulletins(id) ON DELETE CASCADE,
  reporter_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewed', 'dismissed')),
  created_at timestamptz DEFAULT now()
);

-- 5. Bulletin Audit Logs Table
CREATE TABLE IF NOT EXISTS public.bulletin_audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bulletin_id uuid NOT NULL REFERENCES public.bulletins(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public.profiles(id),
  action text NOT NULL,
  snapshot jsonb,
  created_at timestamptz DEFAULT now()
);

-- =============================================================================
-- Performance Indexes
-- =============================================================================
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user_active_expires
  ON public.user_subscriptions (user_id, status, expires_at DESC);

CREATE INDEX IF NOT EXISTS idx_bulletins_feed_status_pinned_created
  ON public.bulletins (status, is_pinned DESC, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bulletins_category_status_created
  ON public.bulletins (category, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bulletins_author_created
  ON public.bulletins (author_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bulletin_reports_bulletin_status
  ON public.bulletin_reports (bulletin_id, status);

CREATE INDEX IF NOT EXISTS idx_bulletin_audit_logs_bulletin_created
  ON public.bulletin_audit_logs (bulletin_id, created_at DESC);

-- =============================================================================
-- Updated-At Maintenance Trigger
-- =============================================================================
CREATE OR REPLACE FUNCTION public.set_bulletins_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bulletins_updated_at ON public.bulletins;
CREATE TRIGGER trg_bulletins_updated_at
  BEFORE UPDATE ON public.bulletins
  FOR EACH ROW
  EXECUTE FUNCTION public.set_bulletins_updated_at();

-- =============================================================================
-- Database-Enforced Subscription & Quota Trigger (BEFORE INSERT on bulletins)
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
  v_active_count integer;
  v_monthly_count integer;
  v_image_count integer;
BEGIN
  -- 1. Check author role: admins and super_admins bypass subscription quotas
  SELECT lower(coalesce(role, 'visitor'))
    INTO v_author_role
  FROM public.profiles
  WHERE id = NEW.author_id;

  IF v_author_role IN ('admin', 'super_admin') THEN
    RETURN NEW;
  END IF;

  -- 2. Require an active paid subscription
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

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active paid subscription required to post bulletins.'
      USING ERRCODE = 'P0001';
  END IF;

  -- 3. Enforce active published bulletin limit
  SELECT count(*)
    INTO v_active_count
  FROM public.bulletins b
  WHERE b.author_id = NEW.author_id
    AND b.status = 'published'
    AND (b.expires_at IS NULL OR b.expires_at > now());

  IF v_active_count >= v_plan.max_active_bulletins THEN
    RAISE EXCEPTION 'Active bulletin limit reached for % plan (% / % active).',
      v_plan.name, v_active_count, v_plan.max_active_bulletins
      USING ERRCODE = 'P0001';
  END IF;

  -- 4. Enforce monthly posting quota
  SELECT count(*)
    INTO v_monthly_count
  FROM public.bulletins b
  WHERE b.author_id = NEW.author_id
    AND b.created_at >= date_trunc('month', now());

  IF v_monthly_count >= v_plan.max_monthly_posts THEN
    RAISE EXCEPTION 'Monthly bulletin posting quota reached for % plan (% / % this month).',
      v_plan.name, v_monthly_count, v_plan.max_monthly_posts
      USING ERRCODE = 'P0001';
  END IF;

  -- 5. Enforce image count per post
  v_image_count := coalesce(array_length(NEW.image_urls, 1), 0);
  IF v_image_count > v_plan.max_images_per_post THEN
    RAISE EXCEPTION 'Image attachment limit exceeded: % plan allows at most % images per bulletin.',
      v_plan.name, v_plan.max_images_per_post
      USING ERRCODE = 'P0001';
  END IF;

  -- 6. Enforce YouTube embed entitlement
  IF NEW.youtube_video_id IS NOT NULL AND coalesce(v_plan.allow_youtube, false) = false THEN
    RAISE EXCEPTION 'YouTube embeds are not included in your current % subscription plan.',
      v_plan.name
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_bulletin_quota ON public.bulletins;
CREATE TRIGGER trg_enforce_bulletin_quota
  BEFORE INSERT ON public.bulletins
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_bulletin_quota();

-- =============================================================================
-- Audit Trail Trigger (AFTER INSERT OR UPDATE on bulletins)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.log_bulletin_audit()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_action text;
  v_actor uuid;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_action := 'created';
  ELSIF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    v_action := 'status_' || NEW.status;
  ELSE
    v_action := 'updated';
  END IF;

  v_actor := coalesce(auth.uid(), NEW.author_id);

  INSERT INTO public.bulletin_audit_logs (
    bulletin_id,
    actor_id,
    action,
    snapshot
  )
  VALUES (
    NEW.id,
    v_actor,
    v_action,
    to_jsonb(NEW)
  );

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_bulletin_audit_log ON public.bulletins;
CREATE TRIGGER trg_bulletin_audit_log
  AFTER INSERT OR UPDATE ON public.bulletins
  FOR EACH ROW
  EXECUTE FUNCTION public.log_bulletin_audit();

-- =============================================================================
-- Row Level Security (RLS) Policies
-- =============================================================================
ALTER TABLE public.subscription_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bulletins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bulletin_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bulletin_audit_logs ENABLE ROW LEVEL SECURITY;

-- subscription_plans: Public SELECT where is_active = true; admins full access
DROP POLICY IF EXISTS "Public can view active subscription plans" ON public.subscription_plans;
CREATE POLICY "Public can view active subscription plans"
  ON public.subscription_plans
  FOR SELECT
  USING (
    is_active = true
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'super_admin')
    )
  );

DROP POLICY IF EXISTS "Admins can manage subscription plans" ON public.subscription_plans;
CREATE POLICY "Admins can manage subscription plans"
  ON public.subscription_plans
  FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'super_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'super_admin')
    )
  );

-- user_subscriptions: Users can SELECT their own rows; only admins can INSERT / UPDATE
DROP POLICY IF EXISTS "Users can view own subscriptions and admins view all" ON public.user_subscriptions;
CREATE POLICY "Users can view own subscriptions and admins view all"
  ON public.user_subscriptions
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'super_admin')
    )
  );

DROP POLICY IF EXISTS "Only admins can insert user subscriptions" ON public.user_subscriptions;
CREATE POLICY "Only admins can insert user subscriptions"
  ON public.user_subscriptions
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'super_admin')
    )
  );

DROP POLICY IF EXISTS "Only admins can update user subscriptions" ON public.user_subscriptions;
CREATE POLICY "Only admins can update user subscriptions"
  ON public.user_subscriptions
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'super_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'super_admin')
    )
  );

-- bulletins: Public SELECT published non-expired; authors/admins see own/all; INSERT auth.uid() = author_id; UPDATE/DELETE author or admin
DROP POLICY IF EXISTS "Public can read published active bulletins" ON public.bulletins;
CREATE POLICY "Public can read published active bulletins"
  ON public.bulletins
  FOR SELECT
  USING (
    (status = 'published' AND (expires_at IS NULL OR expires_at > now()))
    OR (
      auth.uid() IS NOT NULL
      AND (
        auth.uid() = author_id
        OR EXISTS (
          SELECT 1
          FROM public.profiles p
          WHERE p.id = auth.uid()
            AND p.role IN ('admin', 'super_admin')
        )
      )
    )
  );

DROP POLICY IF EXISTS "Authenticated users can insert own bulletins" ON public.bulletins;
CREATE POLICY "Authenticated users can insert own bulletins"
  ON public.bulletins
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = author_id
  );

DROP POLICY IF EXISTS "Authors and admins can update bulletins" ON public.bulletins;
CREATE POLICY "Authors and admins can update bulletins"
  ON public.bulletins
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = author_id
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'super_admin')
    )
  )
  WITH CHECK (
    auth.uid() = author_id
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'super_admin')
    )
  );

DROP POLICY IF EXISTS "Authors and admins can delete bulletins" ON public.bulletins;
CREATE POLICY "Authors and admins can delete bulletins"
  ON public.bulletins
  FOR DELETE
  TO authenticated
  USING (
    auth.uid() = author_id
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'super_admin')
    )
  );

-- bulletin_reports: Authenticated users can INSERT; only admins can SELECT / UPDATE
DROP POLICY IF EXISTS "Authenticated users can report bulletins" ON public.bulletin_reports;
CREATE POLICY "Authenticated users can report bulletins"
  ON public.bulletin_reports
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND (reporter_id IS NULL OR reporter_id = auth.uid())
  );

DROP POLICY IF EXISTS "Only admins can view bulletin reports" ON public.bulletin_reports;
CREATE POLICY "Only admins can view bulletin reports"
  ON public.bulletin_reports
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'super_admin')
    )
  );

DROP POLICY IF EXISTS "Only admins can update bulletin reports" ON public.bulletin_reports;
CREATE POLICY "Only admins can update bulletin reports"
  ON public.bulletin_reports
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'super_admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'super_admin')
    )
  );

-- bulletin_audit_logs: Only admins (and bulletin authors for their own posts) can read audit logs
DROP POLICY IF EXISTS "Admins and authors can read bulletin audit logs" ON public.bulletin_audit_logs;
CREATE POLICY "Admins and authors can read bulletin audit logs"
  ON public.bulletin_audit_logs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'super_admin')
    )
    OR EXISTS (
      SELECT 1
      FROM public.bulletins b
      WHERE b.id = public.bulletin_audit_logs.bulletin_id
        AND b.author_id = auth.uid()
    )
  );

-- =============================================================================
-- Idempotent Seed: 3 Subscription Plans & 4 Sample Local Bulletins
-- =============================================================================
INSERT INTO public.subscription_plans (
  slug, name, price_inr, max_active_bulletins, max_monthly_posts, max_images_per_post, allow_youtube, duration_days, is_active
)
VALUES
  ('starter', 'Starter', 199, 2, 4, 2, true, 30, true),
  ('business', 'Business', 499, 5, 15, 5, true, 30, true),
  ('agency', 'Agency', 999, 15, 50, 8, true, 30, true)
ON CONFLICT (slug) DO UPDATE SET
  name = EXCLUDED.name,
  price_inr = EXCLUDED.price_inr,
  max_active_bulletins = EXCLUDED.max_active_bulletins,
  max_monthly_posts = EXCLUDED.max_monthly_posts,
  max_images_per_post = EXCLUDED.max_images_per_post,
  allow_youtube = EXCLUDED.allow_youtube,
  duration_days = EXCLUDED.duration_days,
  is_active = EXCLUDED.is_active;

DO $$
DECLARE
  v_seed_author uuid;
  v_author_role text;
  v_agency_plan_id uuid;
  v_listing_business uuid;
  v_listing_print uuid;
BEGIN
  -- Prefer an existing super_admin/admin so quota trigger passes cleanly, otherwise fallback to earliest profile
  SELECT id, lower(coalesce(role, 'visitor'))
    INTO v_seed_author, v_author_role
  FROM public.profiles
  ORDER BY
    CASE
      WHEN lower(coalesce(role, '')) = 'super_admin' THEN 1
      WHEN lower(coalesce(role, '')) = 'admin' THEN 2
      WHEN lower(coalesce(role, '')) = 'owner' THEN 3
      ELSE 4
    END,
    created_at ASC
  LIMIT 1;

  IF v_seed_author IS NULL THEN
    RETURN;
  END IF;

  -- If fallback seed author is not admin/super_admin, ensure they have an active Agency subscription for seeding
  IF v_author_role NOT IN ('admin', 'super_admin') THEN
    SELECT id INTO v_agency_plan_id FROM public.subscription_plans WHERE slug = 'agency' LIMIT 1;
    IF v_agency_plan_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.user_subscriptions
      WHERE user_id = v_seed_author AND status = 'active' AND expires_at > now()
    ) THEN
      INSERT INTO public.user_subscriptions (user_id, plan_id, status, starts_at, expires_at, payment_ref)
      VALUES (v_seed_author, v_agency_plan_id, 'active', now(), now() + interval '365 days', 'SEED-AGENCY-ACTIVE');
    END IF;
  END IF;

  -- Resolve optional published listings for deep linking
  SELECT id INTO v_listing_print
  FROM public.listings
  WHERE status = 'published' AND category = 'business'
  ORDER BY created_at ASC
  LIMIT 1;

  SELECT id INTO v_listing_business
  FROM public.listings
  WHERE status = 'published' AND category = 'business' AND id IS DISTINCT FROM v_listing_print
  ORDER BY created_at ASC
  LIMIT 1;

  INSERT INTO public.bulletins (
    id,
    author_id,
    linked_listing_id,
    category,
    title,
    content_json,
    excerpt,
    image_urls,
    youtube_video_id,
    contact_channels,
    status,
    is_pinned,
    expires_at
  )
  VALUES
    (
      'b0000000-0000-4000-8000-000000000001',
      v_seed_author,
      NULL,
      'announcement',
      'Lamka Main Road Drainage Maintenance & Morning Traffic Advisory',
      '{
        "type": "doc",
        "content": [
          {
            "type": "paragraph",
            "content": [
              { "type": "text", "text": "Public Works and local ward committees will carry out scheduled storm-drain clearing along " },
              { "type": "text", "text": "Tedim Road (New Bazaar to Tuibong Junction)", "marks": [{ "type": "bold" }] },
              { "type": "text", "text": " from 6:00 AM to 10:30 AM this week." }
            ]
          },
          {
            "type": "heading",
            "attrs": { "level": 3 },
            "content": [{ "type": "text", "text": "Commuter Guidelines" }]
          },
          {
            "type": "bulletList",
            "content": [
              { "type": "listItem", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Heavy commercial vehicles are advised to use the Pearsonmun bypass during morning clearing hours." }] }] },
              { "type": "listItem", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Shopkeepers along Main Road are requested to keep curbside parking clear before 6:00 AM." }] }] },
              { "type": "listItem", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Emergency ambulances and school buses retain priority passage throughout." }] }] }
            ]
          },
          {
            "type": "blockquote",
            "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "For urgent civic queries or blocked culvert reporting, reach the district coordination desk directly using the contact options below." }] }]
          }
        ]
      }'::jsonb,
      'Scheduled morning storm-drain clearing along Tedim Road (New Bazaar to Tuibong Junction) between 6:00 AM and 10:30 AM. Please plan alternate routes.',
      '{}',
      NULL,
      '{"phone": "+919862011223", "email": "desk@printswiftlocal.in", "website": "https://churachandpur.nic.in"}'::jsonb,
      'published',
      true,
      now() + interval '45 days'
    ),
    (
      'b0000000-0000-4000-8000-000000000002',
      v_seed_author,
      v_listing_print,
      'job',
      'Hiring: Full-Time Graphic Designer & Large-Format Print Operator',
      '{
        "type": "doc",
        "content": [
          {
            "type": "paragraph",
            "content": [
              { "type": "text", "text": "We are expanding our production desk in " },
              { "type": "text", "text": "New Lamka, Churachandpur", "marks": [{ "type": "bold" }] },
              { "type": "text", "text": " and looking for a reliable, detail-oriented designer and print operator to join immediately." }
            ]
          },
          {
            "type": "heading",
            "attrs": { "level": 3 },
            "content": [{ "type": "text", "text": "Key Responsibilities & Requirements" }]
          },
          {
            "type": "orderedList",
            "content": [
              { "type": "listItem", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Proficiency in CorelDRAW, Adobe Photoshop, or Illustrator for flex banners, invitations, and signage." }] }] },
              { "type": "listItem", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Ability to prepare CMYK print-ready files and manage customer walk-in revisions calmly." }] }] },
              { "type": "listItem", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Fluent in English and Paite/Thadou-Kuki/Hmar or Meitei." }] }] }
            ]
          },
          {
            "type": "paragraph",
            "content": [
              { "type": "text", "text": "Compensation: ", "marks": [{ "type": "bold" }] },
              { "type": "text", "text": "₹14,000 – ₹20,000/month based on portfolio and machine experience. Send your CV or sample works via WhatsApp or Email." }
            ]
          }
        ]
      }'::jsonb,
      'Immediate full-time opening in New Lamka for a CorelDRAW/Photoshop designer & flex print operator. Competitive local salary ₹14,000–₹20,000/mo.',
      '{}',
      NULL,
      '{"phone": "+919862044556", "whatsapp": "+919862044556", "email": "careers@printswiftlocal.in"}'::jsonb,
      'published',
      false,
      now() + interval '30 days'
    ),
    (
      'b0000000-0000-4000-8000-000000000003',
      v_seed_author,
      COALESCE(v_listing_business, v_listing_print),
      'advertisement',
      'Highland Solar & Inverter Clearance — Up to 20% Off Home Backup Kits',
      '{
        "type": "doc",
        "content": [
          {
            "type": "paragraph",
            "content": [
              { "type": "text", "text": "Prepare for monsoon power outages with certified " },
              { "type": "text", "text": "LiFePO4 solar inverter batteries and mono-PERC panels", "marks": [{ "type": "bold" }] },
              { "type": "text", "text": " with same-week installation across Lamka, Rengkai, Tuibong, and Zenhang Lamka." }
            ]
          },
          {
            "type": "bulletList",
            "content": [
              { "type": "listItem", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Free rooftop site survey within 10 km of Churachandpur town centre." }] }] },
              { "type": "listItem", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "5-year on-site warranty with direct local technician support." }] }] },
              { "type": "listItem", "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Watch our quick installation walkthrough video below before booking." }] }] }
            ]
          }
        ]
      }'::jsonb,
      'Seasonal clearance on lithium solar home backup systems with free rooftop inspection and 5-year local warranty across Churachandpur.',
      '{}',
      'M7lc1UVf-VE',
      '{"phone": "+919862077889", "whatsapp": "+919862077889", "website": "https://printswiftlocal.in"}'::jsonb,
      'published',
      false,
      now() + interval '25 days'
    ),
    (
      'b0000000-0000-4000-8000-000000000004',
      v_seed_author,
      NULL,
      'notice',
      'Voluntary Blood Donation Camp & Free General Health Checkup — Rengkai',
      '{
        "type": "doc",
        "content": [
          {
            "type": "paragraph",
            "content": [
              { "type": "text", "text": "Local youth volunteers in partnership with District Hospital Blood Bank are organizing a " },
              { "type": "text", "text": "Voluntary Blood Donation Camp & Free BP/Sugar Screening", "marks": [{ "type": "bold" }] },
              { "type": "text", "text": " at Rengkai Community Hall this Saturday from 9:00 AM to 2:30 PM." }
            ]
          },
          {
            "type": "blockquote",
            "content": [{ "type": "paragraph", "content": [{ "type": "text", "text": "Every single unit donated directly strengthens emergency reserves for Churachandpur District Hospital. Refreshments and donor certificates will be provided." }] }]
          },
          {
            "type": "paragraph",
            "content": [
              { "type": "text", "text": "Healthy adults aged 18–60 (weight above 45 kg) are warmly invited to register early via WhatsApp or walk in directly." }
            ]
          }
        ]
      }'::jsonb,
      'Join the Saturday morning voluntary blood donation drive and free BP/blood-sugar screening at Rengkai Community Hall (9:00 AM – 2:30 PM).',
      '{}',
      NULL,
      '{"phone": "+919862099100", "whatsapp": "+919862099100"}'::jsonb,
      'published',
      false,
      now() + interval '20 days'
    )
  ON CONFLICT (id) DO NOTHING;
END $$;
