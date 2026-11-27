-- =============================================================================
-- Migration: 20261127_pass_v21b_p1_role_solidification_and_hub_manager.sql
-- Purpose: Batch 2 (Sprint v21b) — Resolve P1 Database, Hub Manager Decoupling,
--   Driver KYC, 5-Tier Fleet Parity, Real Estate Area/Polygon, Enquiry/Review
--   Persistence, YouTube Boost Guard, and Owner Feedback Notifications.
--
-- Safety Rules:
--   - Wrapped in BEGIN / COMMIT and 100% idempotent (safe to re-run in SQL Editor).
--   - Never touches extension-owned functions (`pg_depend` deptype = 'e').
--   - Writes strictly to canonical 13-column `public.audit_logs`.
-- =============================================================================

BEGIN;

-- =============================================================================
-- 1. DB-AUTHORITATIVE `public.profiles.is_super_admin` (v21a Decision #2)
-- =============================================================================
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'is_super_admin'
  ) THEN
    ALTER TABLE public.profiles
      ADD COLUMN is_super_admin boolean
      GENERATED ALWAYS AS (role = 'super_admin') STORED;
  END IF;
END;
$$;

-- =============================================================================
-- 2. P1-08: HUB MANAGER SCHEMA & TRIAGE DECOUPLING
-- =============================================================================

-- 2A. Add `hub_id` + indexes to tables lacking hub scoping
ALTER TABLE public.pay_per_orders
  ADD COLUMN IF NOT EXISTS hub_id uuid REFERENCES public.service_hubs(id) ON DELETE SET NULL;

ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS hub_id uuid REFERENCES public.service_hubs(id) ON DELETE SET NULL;

ALTER TABLE public.popular_localities
  ADD COLUMN IF NOT EXISTS hub_id uuid REFERENCES public.service_hubs(id) ON DELETE SET NULL;

ALTER TABLE public.bulletin_post_passes
  ADD COLUMN IF NOT EXISTS hub_id uuid REFERENCES public.service_hubs(id) ON DELETE SET NULL;

ALTER TABLE public.bulletin_reports
  ADD COLUMN IF NOT EXISTS hub_id uuid REFERENCES public.service_hubs(id) ON DELETE SET NULL;

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS hub_id uuid REFERENCES public.service_hubs(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pay_per_orders_hub_status_v21b
  ON public.pay_per_orders (hub_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_hub_created_v21b
  ON public.audit_logs (hub_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_popular_localities_hub_sort_v21b
  ON public.popular_localities (hub_id, sort_order ASC);

CREATE INDEX IF NOT EXISTS idx_bulletin_post_passes_hub_status_v21b
  ON public.bulletin_post_passes (hub_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bulletin_reports_hub_status_v21b
  ON public.bulletin_reports (hub_id, status, created_at DESC);

-- Idempotent backfill of `hub_id` on newly hub-scoped tables
DO $$
DECLARE
  v_ccpur_id uuid;
BEGIN
  SELECT id INTO v_ccpur_id
  FROM public.service_hubs
  WHERE slug = 'churachandpur'
  LIMIT 1;

  -- Backfill pay_per_orders.hub_id from target entities, then user's default_hub_id
  UPDATE public.pay_per_orders ppo
  SET hub_id = l.hub_id
  FROM public.listings l
  WHERE ppo.hub_id IS NULL
    AND ppo.target_table = 'listings'
    AND l.id = ppo.target_id
    AND l.hub_id IS NOT NULL;

  UPDATE public.pay_per_orders ppo
  SET hub_id = b.hub_id
  FROM public.bulletins b
  WHERE ppo.hub_id IS NULL
    AND ppo.target_table = 'bulletins'
    AND b.id = ppo.target_id
    AND b.hub_id IS NOT NULL;

  UPDATE public.pay_per_orders ppo
  SET hub_id = mp.hub_id
  FROM public.marketplace_products mp
  WHERE ppo.hub_id IS NULL
    AND ppo.target_table IN ('marketplace_products', 'marketplace_items')
    AND mp.id = ppo.target_id
    AND mp.hub_id IS NOT NULL;

  UPDATE public.pay_per_orders ppo
  SET hub_id = p.default_hub_id
  FROM public.profiles p
  WHERE ppo.hub_id IS NULL
    AND p.id = ppo.user_id
    AND p.default_hub_id IS NOT NULL;

  -- Backfill popular_localities to Churachandpur flagship when unset
  IF v_ccpur_id IS NOT NULL THEN
    UPDATE public.popular_localities
    SET hub_id = v_ccpur_id
    WHERE hub_id IS NULL;
  END IF;

  -- Backfill bulletin_post_passes from profile default_hub_id
  UPDATE public.bulletin_post_passes bpp
  SET hub_id = p.default_hub_id
  FROM public.profiles p
  WHERE bpp.hub_id IS NULL
    AND p.id = bpp.user_id
    AND p.default_hub_id IS NOT NULL;

  -- Backfill bulletin_reports from parent bulletins
  UPDATE public.bulletin_reports br
  SET hub_id = b.hub_id
  FROM public.bulletins b
  WHERE br.hub_id IS NULL
    AND b.id = br.bulletin_id
    AND b.hub_id IS NOT NULL;

  -- Backfill audit_logs.hub_id where metadata->>'hub_id' is a valid UUID
  UPDATE public.audit_logs
  SET hub_id = (metadata->>'hub_id')::uuid
  WHERE hub_id IS NULL
    AND COALESCE(metadata->>'hub_id', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
END;
$$;

-- 2B. Categories Hub-Triage Columns (Stage-1 Hub Manager Triage before Superadmin Promote/Merge)
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS suggested_hub_id uuid REFERENCES public.service_hubs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS hub_triage_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS hub_triaged_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS hub_triaged_at timestamptz,
  ADD COLUMN IF NOT EXISTS hub_triage_notes text;

ALTER TABLE public.categories
  DROP CONSTRAINT IF EXISTS categories_hub_triage_status_check;
ALTER TABLE public.categories
  ADD CONSTRAINT categories_hub_triage_status_check
  CHECK (hub_triage_status IN ('pending', 'recommended_approve', 'recommended_merge', 'recommended_reject'));

CREATE INDEX IF NOT EXISTS idx_categories_suggested_hub_triage_v21b
  ON public.categories (suggested_hub_id, review_status, hub_triage_status)
  WHERE review_status = 'pending_review';

-- 2C. Escalated Disputes Table (Replaces client Zustand-only moderationCases)
CREATE TABLE IF NOT EXISTS public.escalated_disputes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id uuid REFERENCES public.service_hubs(id) ON DELETE SET NULL,
  entity_type text NOT NULL,
  entity_id uuid NOT NULL,
  tier smallint NOT NULL DEFAULT 1 CHECK (tier IN (1, 2)),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'investigating', 'escalated', 'resolved', 'dismissed')),
  opened_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  assigned_hub_manager_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  escalated_to_superadmin_at timestamptz,
  resolution_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_escalated_disputes_hub_tier_status_v21b
  ON public.escalated_disputes (hub_id, tier, status, created_at DESC);

ALTER TABLE public.escalated_disputes ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS escalated_disputes_hub_manager_select_v21b ON public.escalated_disputes;
CREATE POLICY escalated_disputes_hub_manager_select_v21b
  ON public.escalated_disputes
  FOR SELECT
  TO authenticated
  USING (
    public.is_pnd_admin(auth.uid())
    OR opened_by = auth.uid()
    OR (hub_id IS NOT NULL AND public.is_hub_manager_for(hub_id))
  );

DROP POLICY IF EXISTS escalated_disputes_hub_manager_insert_v21b ON public.escalated_disputes;
CREATE POLICY escalated_disputes_hub_manager_insert_v21b
  ON public.escalated_disputes
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND (
      public.is_pnd_admin(auth.uid())
      OR (hub_id IS NOT NULL AND public.is_hub_manager_for(hub_id))
      OR opened_by = auth.uid()
    )
  );

DROP POLICY IF EXISTS escalated_disputes_hub_manager_update_v21b ON public.escalated_disputes;
CREATE POLICY escalated_disputes_hub_manager_update_v21b
  ON public.escalated_disputes
  FOR UPDATE
  TO authenticated
  USING (
    public.is_pnd_admin(auth.uid())
    OR (hub_id IS NOT NULL AND public.is_hub_manager_for(hub_id) AND tier = 1)
  )
  WITH CHECK (
    public.is_pnd_admin(auth.uid())
    OR (hub_id IS NOT NULL AND public.is_hub_manager_for(hub_id))
  );

-- 2D. Hub Manager RLS Policies across Audit Logs, Pay-Per, Bulletins & Vehicle Listings
DROP POLICY IF EXISTS audit_logs_hub_manager_select_v21b ON public.audit_logs;
CREATE POLICY audit_logs_hub_manager_select_v21b
  ON public.audit_logs
  FOR SELECT
  TO authenticated
  USING (
    hub_id IS NOT NULL
    AND public.is_hub_manager_for(hub_id)
  );

DROP POLICY IF EXISTS pay_per_orders_hub_manager_select_v21b ON public.pay_per_orders;
CREATE POLICY pay_per_orders_hub_manager_select_v21b
  ON public.pay_per_orders
  FOR SELECT
  TO authenticated
  USING (
    hub_id IS NOT NULL
    AND public.is_hub_manager_for(hub_id)
  );

DROP POLICY IF EXISTS bulletin_reports_hub_manager_select_v21b ON public.bulletin_reports;
CREATE POLICY bulletin_reports_hub_manager_select_v21b
  ON public.bulletin_reports
  FOR SELECT
  TO authenticated
  USING (
    hub_id IS NOT NULL
    AND public.is_hub_manager_for(hub_id)
  );

DROP POLICY IF EXISTS bulletin_reports_hub_manager_update_v21b ON public.bulletin_reports;
CREATE POLICY bulletin_reports_hub_manager_update_v21b
  ON public.bulletin_reports
  FOR UPDATE
  TO authenticated
  USING (
    hub_id IS NOT NULL
    AND public.is_hub_manager_for(hub_id)
  )
  WITH CHECK (
    hub_id IS NOT NULL
    AND public.is_hub_manager_for(hub_id)
  );

DROP POLICY IF EXISTS bulletin_post_passes_hub_manager_select_v21b ON public.bulletin_post_passes;
CREATE POLICY bulletin_post_passes_hub_manager_select_v21b
  ON public.bulletin_post_passes
  FOR SELECT
  TO authenticated
  USING (
    hub_id IS NOT NULL
    AND public.is_hub_manager_for(hub_id)
  );

DROP POLICY IF EXISTS vehicle_listings_hub_manager_select_v21b ON public.vehicle_listings;
CREATE POLICY vehicle_listings_hub_manager_select_v21b
  ON public.vehicle_listings
  FOR SELECT
  TO authenticated
  USING (
    origin_hub_id IS NOT NULL
    AND public.is_hub_manager_for(origin_hub_id)
  );

DROP POLICY IF EXISTS vehicle_listings_hub_manager_update_v21b ON public.vehicle_listings;
CREATE POLICY vehicle_listings_hub_manager_update_v21b
  ON public.vehicle_listings
  FOR UPDATE
  TO authenticated
  USING (
    origin_hub_id IS NOT NULL
    AND public.is_hub_manager_for(origin_hub_id)
  )
  WITH CHECK (
    origin_hub_id IS NOT NULL
    AND public.is_hub_manager_for(origin_hub_id)
  );

-- 2E. Hub Manager RPCs (all log to canonical 13-column audit_logs with workspace = 'hub_manager')
CREATE OR REPLACE FUNCTION public.hub_triage_suggested_category(
  p_category_id uuid,
  p_hub_id uuid,
  p_recommendation text,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_rec text := lower(trim(COALESCE(p_recommendation, '')));
  v_notes text := NULLIF(trim(COALESCE(p_notes, '')), '');
  v_cat record;
BEGIN
  IF v_uid IS NULL OR (NOT public.is_super_admin() AND NOT public.is_hub_manager_for(p_hub_id)) THEN
    RAISE EXCEPTION 'Forbidden: only the assigned Hub Manager or Super-Admin may triage local category suggestions.'
      USING ERRCODE = '42501';
  END IF;

  IF v_rec NOT IN ('pending', 'recommended_approve', 'recommended_merge', 'recommended_reject') THEN
    RAISE EXCEPTION 'Invalid triage recommendation "%".', p_recommendation USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_cat
  FROM public.categories
  WHERE id = p_category_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Category not found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_cat.review_status <> 'pending_review' THEN
    RAISE EXCEPTION 'Only pending_review categories can be triaged.' USING ERRCODE = 'P0001';
  END IF;

  IF v_cat.suggested_hub_id IS NOT NULL AND v_cat.suggested_hub_id <> p_hub_id AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Forbidden: category suggestion belongs to a different hub.' USING ERRCODE = '42501';
  END IF;

  UPDATE public.categories
  SET
    suggested_hub_id = COALESCE(suggested_hub_id, p_hub_id),
    hub_triage_status = v_rec,
    hub_triaged_by = v_uid,
    hub_triaged_at = now(),
    hub_triage_notes = v_notes,
    updated_at = now()
  WHERE id = p_category_id;

  INSERT INTO public.audit_logs (
    actor_id, actor_role, workspace, hub_id, action, target_table, target_id, target_name, details, metadata, created_at
  )
  VALUES (
    v_uid,
    CASE WHEN public.is_super_admin() THEN 'super_admin' ELSE 'hub_manager' END,
    'hub_manager',
    p_hub_id,
    'hub_triage_suggested_category',
    'categories',
    p_category_id::text,
    v_cat.display_name,
    'Hub Manager triaged category suggestion as ' || v_rec,
    jsonb_build_object(
      'workspace', 'hub_manager',
      'hub_id', p_hub_id::text,
      'recommendation', v_rec,
      'notes', v_notes
    ),
    now()
  );

  RETURN jsonb_build_object(
    'ok', true,
    'category_id', p_category_id,
    'hub_triage_status', v_rec
  );
END;
$$;

REVOKE ALL ON FUNCTION public.hub_triage_suggested_category(uuid, uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hub_triage_suggested_category(uuid, uuid, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.hub_manager_verify_vehicle_listing(
  p_vehicle_listing_id uuid,
  p_is_active boolean,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_notes text := NULLIF(trim(COALESCE(p_notes, '')), '');
  v_veh record;
BEGIN
  SELECT * INTO v_veh
  FROM public.vehicle_listings
  WHERE id = p_vehicle_listing_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vehicle listing not found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_uid IS NULL OR (NOT public.is_super_admin() AND NOT public.is_hub_manager_for(v_veh.origin_hub_id)) THEN
    RAISE EXCEPTION 'Forbidden: only the Hub Manager for origin_hub_id or Super-Admin may moderate this vehicle listing.'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.vehicle_listings
  SET
    is_active = p_is_active,
    updated_at = now()
  WHERE id = p_vehicle_listing_id;

  INSERT INTO public.audit_logs (
    actor_id, actor_role, workspace, hub_id, action, target_table, target_id, target_name, details, metadata, created_at
  )
  VALUES (
    v_uid,
    CASE WHEN public.is_super_admin() THEN 'super_admin' ELSE 'hub_manager' END,
    'hub_manager',
    v_veh.origin_hub_id,
    CASE WHEN p_is_active THEN 'hub_verify_vehicle_listing' ELSE 'hub_pause_vehicle_listing' END,
    'vehicle_listings',
    p_vehicle_listing_id::text,
    v_veh.title,
    CASE WHEN p_is_active THEN 'Approved/activated vehicle listing' ELSE 'Paused vehicle listing' END,
    jsonb_build_object(
      'workspace', 'hub_manager',
      'hub_id', v_veh.origin_hub_id::text,
      'is_active', p_is_active,
      'notes', v_notes
    ),
    now()
  );

  RETURN jsonb_build_object(
    'ok', true,
    'vehicle_listing_id', p_vehicle_listing_id,
    'is_active', p_is_active
  );
END;
$$;

REVOKE ALL ON FUNCTION public.hub_manager_verify_vehicle_listing(uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hub_manager_verify_vehicle_listing(uuid, boolean, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.hub_manager_moderate_bulletin(
  p_bulletin_id uuid,
  p_status text,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_status text := lower(trim(COALESCE(p_status, '')));
  v_notes text := NULLIF(trim(COALESCE(p_notes, '')), '');
  v_bul record;
BEGIN
  IF v_status NOT IN ('published', 'archived', 'removed_by_admin') THEN
    RAISE EXCEPTION 'Invalid bulletin moderation status "%".', p_status USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_bul
  FROM public.bulletins
  WHERE id = p_bulletin_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bulletin not found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_uid IS NULL OR (NOT public.is_super_admin() AND NOT public.is_hub_manager_for(v_bul.hub_id)) THEN
    RAISE EXCEPTION 'Forbidden: only the Hub Manager for this hub or Super-Admin may moderate this bulletin.'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.bulletins
  SET
    status = v_status,
    updated_at = now()
  WHERE id = p_bulletin_id;

  IF v_status = 'removed_by_admin' THEN
    UPDATE public.bulletin_reports
    SET status = 'reviewed'
    WHERE bulletin_id = p_bulletin_id AND status = 'open';
  END IF;

  INSERT INTO public.audit_logs (
    actor_id, actor_role, workspace, hub_id, action, target_table, target_id, target_name, details, metadata, created_at
  )
  VALUES (
    v_uid,
    CASE WHEN public.is_super_admin() THEN 'super_admin' ELSE 'hub_manager' END,
    'hub_manager',
    v_bul.hub_id,
    'hub_moderate_bulletin_' || v_status,
    'bulletins',
    p_bulletin_id::text,
    v_bul.title,
    'Bulletin moderation updated to ' || v_status,
    jsonb_build_object(
      'workspace', 'hub_manager',
      'hub_id', v_bul.hub_id::text,
      'status', v_status,
      'notes', v_notes
    ),
    now()
  );

  RETURN jsonb_build_object(
    'ok', true,
    'bulletin_id', p_bulletin_id,
    'status', v_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.hub_manager_moderate_bulletin(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.hub_manager_moderate_bulletin(uuid, text, text) TO authenticated, service_role;

-- 2F. Upgrade suggest_leaf_category to stamp `suggested_hub_id` (3-arg overload with DEFAULT NULL)
DROP FUNCTION IF EXISTS public.suggest_leaf_category(uuid, text);
CREATE OR REPLACE FUNCTION public.suggest_leaf_category(
  p_parent_id uuid,
  p_name text,
  p_hub_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_clean_name text := regexp_replace(trim(COALESCE(p_name, '')), '\s+', ' ', 'g');
  v_base_slug text;
  v_candidate_slug text;
  v_pending_count int := 0;
  v_parent record;
  v_existing record;
  v_inserted record;
  v_suffix int := 1;
  v_hub_id uuid := p_hub_id;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required to suggest a new category.' USING ERRCODE = '42501';
  END IF;

  IF p_parent_id IS NULL THEN
    RAISE EXCEPTION 'A parent Level-1 System Root or Level-2 category is required.' USING ERRCODE = '22023';
  END IF;

  IF char_length(v_clean_name) < 2 OR char_length(v_clean_name) > 60 THEN
    RAISE EXCEPTION 'Category name must be between 2 and 60 characters.' USING ERRCODE = '22023';
  END IF;

  IF v_hub_id IS NULL THEN
    SELECT COALESCE(default_hub_id, home_hub_id) INTO v_hub_id
    FROM public.profiles
    WHERE id = v_uid;
  END IF;

  SELECT id, entity_type, root_key, depth, display_name, icon_key, accent_color, is_active, review_status
    INTO v_parent
  FROM public.categories
  WHERE id = p_parent_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected parent category does not exist.' USING ERRCODE = '23503';
  END IF;

  IF v_parent.is_active IS DISTINCT FROM true OR v_parent.review_status IS DISTINCT FROM 'official' THEN
    RAISE EXCEPTION 'Suggestions must be placed under an active official category.' USING ERRCODE = '22023';
  END IF;

  IF v_parent.depth IS NULL OR v_parent.depth NOT IN (1, 2) THEN
    RAISE EXCEPTION 'Maximum category depth is 3 levels. Choose a Level-1 System Root or Level-2 parent.' USING ERRCODE = '22023';
  END IF;

  v_base_slug := lower(regexp_replace(v_clean_name, '[^a-zA-Z0-9]+', '-', 'g'));
  v_base_slug := trim(both '-' FROM v_base_slug);
  IF char_length(v_base_slug) < 2 THEN
    v_base_slug := 'cat-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  END IF;
  v_base_slug := left(v_base_slug, 52);

  SELECT * INTO v_existing
  FROM public.categories c
  WHERE c.entity_type = v_parent.entity_type
    AND c.root_key = v_parent.root_key
    AND c.review_status = 'official'
    AND c.is_active = true
    AND (lower(trim(c.display_name)) = lower(v_clean_name) OR lower(c.slug) = v_base_slug)
  ORDER BY c.depth DESC, c.sort_order ASC
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'existing_official',
      'message', format('"%s" already exists under %s and has been selected.', v_existing.display_name, v_parent.root_key),
      'category', jsonb_build_object(
        'id', v_existing.id, 'slug', v_existing.slug, 'display_name', v_existing.display_name,
        'entity_type', v_existing.entity_type, 'root_key', v_existing.root_key,
        'parent_id', v_existing.parent_id, 'depth', v_existing.depth,
        'review_status', v_existing.review_status, 'is_active', v_existing.is_active
      )
    );
  END IF;

  SELECT * INTO v_existing
  FROM public.categories c
  WHERE c.entity_type = v_parent.entity_type
    AND c.root_key = v_parent.root_key
    AND c.review_status = 'pending_review'
    AND c.suggested_by = v_uid
    AND (lower(trim(c.display_name)) = lower(v_clean_name) OR lower(c.slug) = v_base_slug)
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'existing_pending',
      'message', format('Your pending suggestion "%s" has been selected.', v_existing.display_name),
      'category', jsonb_build_object(
        'id', v_existing.id, 'slug', v_existing.slug, 'display_name', v_existing.display_name,
        'entity_type', v_existing.entity_type, 'root_key', v_existing.root_key,
        'parent_id', v_existing.parent_id, 'depth', v_existing.depth,
        'review_status', v_existing.review_status, 'is_active', v_existing.is_active
      )
    );
  END IF;

  SELECT count(*) INTO v_pending_count
  FROM public.categories
  WHERE suggested_by = v_uid AND review_status = 'pending_review';

  IF v_pending_count >= 5 THEN
    RAISE EXCEPTION 'You already have 5 pending category suggestions awaiting review. Please wait for review or select an existing category.'
      USING ERRCODE = 'P0001';
  END IF;

  v_candidate_slug := v_base_slug;
  WHILE EXISTS (
    SELECT 1 FROM public.categories c
    WHERE c.entity_type = v_parent.entity_type AND lower(c.slug) = v_candidate_slug
  ) LOOP
    v_suffix := v_suffix + 1;
    v_candidate_slug := left(v_base_slug, 46) || '-' || v_suffix::text;
    IF v_suffix > 25 THEN
      v_candidate_slug := left(v_base_slug, 40) || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
      EXIT;
    END IF;
  END LOOP;

  INSERT INTO public.categories (
    entity_type, root_key, parent_id, depth, is_system_root,
    slug, display_name, icon, icon_key, color_hex, accent_color,
    sort_order, is_active, review_status, suggested_by, suggested_hub_id, hub_triage_status
  )
  VALUES (
    v_parent.entity_type, v_parent.root_key, v_parent.id, (v_parent.depth + 1)::smallint, false,
    v_candidate_slug, v_clean_name,
    COALESCE(v_parent.icon_key, 'tag'), COALESCE(v_parent.icon_key, 'tag'),
    COALESCE(v_parent.accent_color, '#2563EB'), COALESCE(v_parent.accent_color, '#2563EB'),
    999, false, 'pending_review', v_uid, v_hub_id, 'pending'
  )
  RETURNING * INTO v_inserted;

  RETURN jsonb_build_object(
    'status', 'created_pending',
    'message', format('Suggested "%s" under %s (pending review).', v_inserted.display_name, v_parent.display_name),
    'category', jsonb_build_object(
      'id', v_inserted.id, 'slug', v_inserted.slug, 'display_name', v_inserted.display_name,
      'entity_type', v_inserted.entity_type, 'root_key', v_inserted.root_key,
      'parent_id', v_inserted.parent_id, 'depth', v_inserted.depth,
      'review_status', v_inserted.review_status, 'is_active', v_inserted.is_active,
      'suggested_hub_id', v_inserted.suggested_hub_id
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.suggest_leaf_category(uuid, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.suggest_leaf_category(uuid, text, uuid) TO authenticated, service_role;

-- =============================================================================
-- 3. P1-06: DRIVER KYC (5 CANONICAL FLEET CLASSES + LICENSE NUMBER)
-- =============================================================================
ALTER TABLE public.partner_applications
  ADD COLUMN IF NOT EXISTS license_no text;

ALTER TABLE public.drivers
  DROP CONSTRAINT IF EXISTS drivers_vehicle_type_check;
ALTER TABLE public.drivers
  ADD CONSTRAINT drivers_vehicle_type_check
  CHECK (vehicle_type IN (
    'cycle_rickshaw',
    'two_wheeler',
    'e_rickshaw',
    'auto',
    'mini_van',
    'car',
    'pickup_truck'
  ));

CREATE OR REPLACE FUNCTION public.review_partner_application(
  p_application_id uuid,
  p_new_status text,
  p_reviewer_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_is_service boolean := (current_setting('role', true) = 'service_role');
  v_status text := lower(trim(COALESCE(p_new_status, '')));
  v_app record;
  v_hub record;
  v_driver_vehicle_type text;
  v_driver_license text;
  v_business_vertical text;
  v_created_listing_id uuid := NULL;
  v_referral_type text;
  v_referrer_id uuid;
  v_kyc_paths text[];
  v_notif_title text;
  v_notif_message text;
  v_notif_url text;
  v_default_credit numeric(10,2) := 50;
  v_workspace text := 'hub_manager';
BEGIN
  IF p_application_id IS NULL THEN
    RAISE EXCEPTION 'Application ID is required.' USING ERRCODE = '22023';
  END IF;

  IF v_status NOT IN ('submitted', 'under_review', 'changes_requested', 'approved', 'rejected') THEN
    RAISE EXCEPTION 'Invalid application status "%".', p_new_status USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_app
  FROM public.partner_applications
  WHERE id = p_application_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Partner application not found.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT v_is_service
     AND NOT public.is_super_admin()
     AND NOT public.is_hub_manager_for(v_app.hub_id) THEN
    RAISE EXCEPTION 'Forbidden: Only Super-Admin or the authorized Hub Manager for this hub can review this application.'
      USING ERRCODE = '42501';
  END IF;

  IF public.is_super_admin() THEN
    v_workspace := 'superadmin';
  END IF;

  UPDATE public.partner_applications
  SET
    status = v_status,
    reviewer_id = v_caller,
    reviewer_notes = p_reviewer_notes,
    reviewed_at = now(),
    updated_at = now()
  WHERE id = p_application_id;

  SELECT COALESCE(array_agg(DISTINCT elem->>'storage_path'), ARRAY[]::text[])
    INTO v_kyc_paths
  FROM jsonb_array_elements(COALESCE(v_app.kyc_documents, '[]'::jsonb)) elem
  WHERE COALESCE(elem->>'storage_path', '') <> '';

  IF v_status = 'approved' THEN
    IF v_app.application_type = 'driver' THEN
      v_driver_vehicle_type := CASE lower(trim(COALESCE(v_app.vehicle_type, '')))
        WHEN 'cycle_rickshaw' THEN 'cycle_rickshaw'
        WHEN 'rickshaw' THEN 'cycle_rickshaw'
        WHEN 'two_wheeler' THEN 'two_wheeler'
        WHEN 'bike' THEN 'two_wheeler'
        WHEN 'scooter' THEN 'two_wheeler'
        WHEN 'scooty' THEN 'two_wheeler'
        WHEN 'e_rickshaw' THEN 'e_rickshaw'
        WHEN 'auto' THEN 'e_rickshaw'
        WHEN 'auto_rickshaw' THEN 'e_rickshaw'
        WHEN 'mini_van' THEN 'mini_van'
        WHEN 'van' THEN 'mini_van'
        WHEN 'car' THEN 'mini_van'
        WHEN 'sedan' THEN 'mini_van'
        WHEN 'suv' THEN 'mini_van'
        WHEN 'pickup' THEN 'pickup_truck'
        WHEN 'pickup_truck' THEN 'pickup_truck'
        WHEN 'bolero' THEN 'pickup_truck'
        ELSE 'two_wheeler'
      END;

      v_driver_license := COALESCE(
        NULLIF(trim(COALESCE(v_app.license_no, '')), ''),
        NULLIF(trim(COALESCE(v_app.vehicle_reg_no, '')), ''),
        ''
      );

      INSERT INTO public.drivers (
        profile_id, full_name, phone, license_no, hub_id,
        vehicle_type, vehicle_reg_no, kyc_status, kyc_verified, is_active
      )
      VALUES (
        v_app.applicant_id,
        COALESCE(NULLIF(trim(v_app.full_name), ''), 'DD oodle Driver'),
        COALESCE(NULLIF(trim(v_app.phone), ''), '+919862000000'),
        v_driver_license,
        v_app.hub_id,
        v_driver_vehicle_type,
        NULLIF(trim(COALESCE(v_app.vehicle_reg_no, '')), ''),
        'verified',
        true,
        true
      )
      ON CONFLICT (profile_id) DO UPDATE
      SET
        full_name = COALESCE(NULLIF(EXCLUDED.full_name, ''), public.drivers.full_name),
        phone = COALESCE(NULLIF(EXCLUDED.phone, ''), public.drivers.phone),
        license_no = COALESCE(NULLIF(EXCLUDED.license_no, ''), public.drivers.license_no),
        hub_id = EXCLUDED.hub_id,
        vehicle_type = EXCLUDED.vehicle_type,
        vehicle_reg_no = COALESCE(EXCLUDED.vehicle_reg_no, public.drivers.vehicle_reg_no),
        kyc_status = 'verified',
        kyc_verified = true,
        is_active = true,
        updated_at = now();
    END IF;

    IF v_app.application_type = 'business_owner' THEN
      v_business_vertical := CASE lower(trim(COALESCE(v_app.business_vertical, '')))
        WHEN 'general' THEN 'general'
        WHEN 'print_digital' THEN 'print_digital'
        WHEN 'booking_venue' THEN 'booking_venue'
        WHEN 'shop_catalogue' THEN 'shop_catalogue'
        WHEN 'real_estate' THEN 'real_estate'
        WHEN 'restaurant_food' THEN 'restaurant_food'
        WHEN 'hotel_stay' THEN 'hotel_stay'
        ELSE 'general'
      END;

      SELECT l.id INTO v_created_listing_id
      FROM public.listings l
      WHERE l.owner_id = v_app.applicant_id
        AND lower(trim(COALESCE(l.title, ''))) = lower(trim(COALESCE(v_app.business_name, v_app.full_name)))
      LIMIT 1;

      IF v_created_listing_id IS NULL THEN
        SELECT center_lat, center_lng INTO v_hub
        FROM public.service_hubs WHERE id = v_app.hub_id LIMIT 1;

        INSERT INTO public.listings (
          owner_id, hub_id, title, category, listing_vertical, status,
          lifecycle_status, locality, lat, lng, owner_name
        )
        VALUES (
          v_app.applicant_id,
          v_app.hub_id,
          COALESCE(NULLIF(trim(v_app.business_name), ''), v_app.full_name || ' Business'),
          CASE v_business_vertical
            WHEN 'real_estate' THEN 'real_estate'
            WHEN 'print_digital' THEN 'service'
            ELSE 'business'
          END,
          v_business_vertical,
          'draft',
          'active',
          NULLIF(trim(COALESCE(v_app.locality, '')), ''),
          COALESCE(v_hub.center_lat, 24.3333),
          COALESCE(v_hub.center_lng, 93.6833),
          v_app.full_name
        )
        RETURNING id INTO v_created_listing_id;
      END IF;
    END IF;

    IF NULLIF(trim(COALESCE(v_app.referral_code_used, '')), '') IS NOT NULL THEN
      v_referral_type := CASE v_app.application_type
        WHEN 'driver' THEN 'driver_onboarding'
        WHEN 'advertiser' THEN 'advertiser_onboarding'
        ELSE 'partner_onboarding'
      END;

      SELECT p.id INTO v_referrer_id
      FROM public.profiles p
      WHERE upper(trim(p.referral_code)) = upper(trim(v_app.referral_code_used))
        AND p.id <> v_app.applicant_id
      LIMIT 1;

      IF v_referrer_id IS NOT NULL THEN
        SELECT COALESCE(NULLIF((value->>'default_referral_credit_inr')::numeric, NULL), 50)
          INTO v_default_credit
        FROM public.platform_settings WHERE key = 'onboarding_and_referrals' LIMIT 1;

        INSERT INTO public.referrals (
          referrer_id, referred_user_id, referral_code_used, hub_id,
          referral_type, status, reward_credit_inr, reviewed_by, qualified_at
        )
        VALUES (
          v_referrer_id, v_app.applicant_id, upper(trim(v_app.referral_code_used)),
          v_app.hub_id, v_referral_type, 'qualified', GREATEST(0, COALESCE(v_default_credit, 50)),
          v_caller, now()
        )
        ON CONFLICT (referred_user_id, referral_type) DO UPDATE
        SET
          status = CASE WHEN public.referrals.status = 'rewarded' THEN 'rewarded' ELSE 'qualified' END,
          hub_id = COALESCE(public.referrals.hub_id, EXCLUDED.hub_id),
          reviewed_by = COALESCE(v_caller, public.referrals.reviewed_by),
          qualified_at = COALESCE(public.referrals.qualified_at, now()),
          updated_at = now();
      END IF;
    END IF;
  END IF;

  IF v_status IN ('approved', 'rejected') THEN
    UPDATE public.media_assets
    SET
      status = 'active',
      entity_type = 'kyc_document',
      entity_id = p_application_id,
      retention_class = 'ephemeral_ttl',
      expires_at = now() + interval '30 days',
      updated_at = now()
    WHERE (
      (entity_type = 'kyc_document' AND entity_id = p_application_id)
      OR (array_length(v_kyc_paths, 1) IS NOT NULL AND storage_path = ANY(v_kyc_paths))
    )
      AND status <> 'purged';
  END IF;

  IF v_status = 'approved' THEN
    v_notif_title := 'Partner Application Approved';
    v_notif_message := 'Congratulations! Your ' || replace(v_app.application_type, '_', ' ') ||
      ' application (' || v_app.application_code || ') has been approved. Open your Workspace to get started.';
    v_notif_url := CASE v_app.application_type
      WHEN 'driver' THEN '/workspace?hat=driver'
      WHEN 'advertiser' THEN '/workspace?hat=advertiser'
      ELSE '/workspace?hat=owner'
    END;
  ELSIF v_status = 'changes_requested' THEN
    v_notif_title := 'Changes Requested on Your Application';
    v_notif_message := 'Your application (' || v_app.application_code || ') needs a quick update' ||
      CASE WHEN NULLIF(trim(COALESCE(p_reviewer_notes, '')), '') IS NOT NULL
        THEN ': ' || trim(p_reviewer_notes) ELSE '.' END;
    v_notif_url := '/onboarding';
  ELSIF v_status = 'rejected' THEN
    v_notif_title := 'Application Update (' || v_app.application_code || ')';
    v_notif_message := 'Your ' || replace(v_app.application_type, '_', ' ') || ' application was not approved at this time' ||
      CASE WHEN NULLIF(trim(COALESCE(p_reviewer_notes, '')), '') IS NOT NULL
        THEN ': ' || trim(p_reviewer_notes) ELSE '.' END;
    v_notif_url := '/onboarding';
  ELSE
    v_notif_title := 'Application Under Review';
    v_notif_message := 'Your application (' || v_app.application_code || ') is currently being reviewed by our local hub team.';
    v_notif_url := '/onboarding';
  END IF;

  PERFORM public.emit_notification(
    v_app.applicant_id,
    v_notif_title,
    v_notif_message,
    'system',
    v_notif_url,
    jsonb_build_object(
      'application_id', p_application_id,
      'application_code', v_app.application_code,
      'status', v_status,
      'hub_id', v_app.hub_id
    ),
    v_created_listing_id
  );

  INSERT INTO public.audit_logs (
    actor_id, actor_role, workspace, hub_id, action, target_table, target_id, target_name, details, metadata, created_at
  )
  VALUES (
    v_caller,
    CASE WHEN public.is_super_admin() THEN 'super_admin' ELSE 'hub_manager' END,
    v_workspace,
    v_app.hub_id,
    'partner_application_' || v_status,
    'partner_applications',
    p_application_id::text,
    COALESCE(NULLIF(trim(v_app.business_name), ''), v_app.full_name),
    'Reviewed partner application (' || v_status || ')',
    jsonb_build_object(
      'workspace', v_workspace,
      'hub_id', v_app.hub_id::text,
      'application_type', v_app.application_type,
      'status', v_status,
      'notes', p_reviewer_notes
    ),
    now()
  );

  RETURN jsonb_build_object(
    'ok', true,
    'application_id', p_application_id,
    'application_code', v_app.application_code,
    'status', v_status,
    'created_listing_id', v_created_listing_id,
    'reviewed_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.review_partner_application(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_partner_application(uuid, text, text) TO authenticated, service_role;

-- =============================================================================
-- 4. P1-07: 5-TIER CHURACHANDPUR FLEET PARITY (WITHOUT RE-ENABLING AIZAWL)
-- =============================================================================
INSERT INTO public.vehicle_types (
  slug, name, icon, base_fare_inr, per_km_rate_inr, wait_per_10min_inr,
  free_wait_minutes, two_way_multiplier, max_weight_kg, max_dimensions, supported_modes, is_active
)
VALUES
  ('cycle_rickshaw', 'Cycle Rickshaw', 'bike', 30.00, 8.00, 10.00, 15, 1.75, 80, '90 x 70 x 70 cm', ARRAY['parcel', 'gas'], true),
  ('two_wheeler', 'Scooty / Two-Wheeler', 'bike', 40.00, 10.00, 15.00, 15, 1.75, 15, '40 x 30 x 30 cm', ARRAY['parcel', 'passenger', 'gas'], true),
  ('e_rickshaw', 'E-Rickshaw / Auto', 'car-taxi-front', 70.00, 15.00, 20.00, 15, 1.75, 150, '100 x 80 x 80 cm', ARRAY['parcel', 'passenger', 'gas'], true),
  ('mini_van', 'Mini Van / Alto', 'car', 120.00, 20.00, 25.00, 15, 1.75, 300, '130 x 100 x 90 cm', ARRAY['parcel', 'passenger'], true),
  ('pickup_truck', 'Pickup Truck / Bolero', 'truck', 250.00, 30.00, 40.00, 20, 1.75, 1000, '220 x 150 x 120 cm', ARRAY['parcel', 'gas'], true)
ON CONFLICT (slug) DO UPDATE
SET
  name = EXCLUDED.name,
  icon = EXCLUDED.icon,
  supported_modes = EXCLUDED.supported_modes,
  is_active = true;

-- Enable all 5 tiers strictly on Churachandpur hub (never override Aizawl's disabled cycle_rickshaw)
INSERT INTO public.hub_vehicle_rates (
  hub_id, vehicle_type_id, is_enabled_in_hub, base_fare_inr, per_km_rate_inr,
  wait_per_10min_inr, free_wait_minutes, two_way_multiplier
)
SELECT
  sh.id,
  vt.id,
  true,
  vt.base_fare_inr,
  vt.per_km_rate_inr,
  vt.wait_per_10min_inr,
  vt.free_wait_minutes,
  vt.two_way_multiplier
FROM public.service_hubs sh
JOIN public.vehicle_types vt
  ON vt.slug IN ('cycle_rickshaw', 'two_wheeler', 'e_rickshaw', 'mini_van', 'pickup_truck')
WHERE sh.slug = 'churachandpur'
ON CONFLICT (hub_id, vehicle_type_id) DO UPDATE
SET
  is_enabled_in_hub = true,
  updated_at = now();

-- =============================================================================
-- 5. P1-01 & P1-02: VERTICAL PROFILE GUARDS, `service_details` & REAL ESTATE
-- =============================================================================

-- 5A. Ensure listings.service_details exists for 'general' vertical persistence
ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS service_details jsonb NOT NULL DEFAULT '{}'::jsonb;

-- 5B. Preserve `shop_upi_verified` and `shop_upi_name` when `shop_upi_id` is unchanged
CREATE OR REPLACE FUNCTION public.preserve_upi_verified_v21b()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_old_upi text := lower(trim(COALESCE(OLD.payment_policy->>'shop_upi_id', '')));
  v_new_upi text := lower(trim(COALESCE(NEW.payment_policy->>'shop_upi_id', '')));
  v_is_admin boolean := (auth.uid() IS NOT NULL AND (public.is_pnd_admin(auth.uid()) OR public.is_hub_manager_for(NEW.hub_id)));
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.payment_policy IS NOT NULL AND OLD.payment_policy IS NOT NULL THEN
    IF v_new_upi = v_old_upi THEN
      IF NOT v_is_admin THEN
        NEW.payment_policy := NEW.payment_policy || jsonb_build_object(
          'shop_upi_verified', COALESCE((OLD.payment_policy->>'shop_upi_verified')::boolean, false),
          'shop_upi_name', OLD.payment_policy->'shop_upi_name'
        );
      END IF;
    ELSIF NOT v_is_admin THEN
      NEW.payment_policy := NEW.payment_policy || '{"shop_upi_verified": false, "shop_upi_name": null}'::jsonb;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  v_tbl text;
BEGIN
  FOREACH v_tbl IN ARRAY ARRAY[
    'listing_shop_profiles',
    'listing_restaurant_profiles',
    'listing_print_profiles',
    'listing_hotel_profiles'
  ]
  LOOP
    IF to_regclass('public.' || v_tbl) IS NOT NULL THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_preserve_upi_verified_v21b ON public.%I', v_tbl);
      EXECUTE format(
        'CREATE TRIGGER trg_preserve_upi_verified_v21b BEFORE UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.preserve_upi_verified_v21b()',
        v_tbl
      );
    END IF;
  END LOOP;
END;
$$;

-- 5C. Real Estate explicit `area_unit` / `area_value` (including Sangam) + RFC 7946 closed GeoJSON Polygon normalization
ALTER TABLE public.listing_real_estate_profiles
  ADD COLUMN IF NOT EXISTS boundary_geojson jsonb,
  ADD COLUMN IF NOT EXISTS area_unit text NOT NULL DEFAULT 'sqft',
  ADD COLUMN IF NOT EXISTS area_value numeric(12,2);

ALTER TABLE public.listing_real_estate_profiles
  DROP CONSTRAINT IF EXISTS listing_real_estate_profiles_area_unit_check;
ALTER TABLE public.listing_real_estate_profiles
  ADD CONSTRAINT listing_real_estate_profiles_area_unit_check
  CHECK (area_unit IN ('sqft', 'sqm', 'sangam', 'acre'));

CREATE OR REPLACE FUNCTION public._normalize_geojson_polygon_v21b(p_raw jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_ring jsonb := '[]'::jsonb;
  v_pt jsonb;
  v_first jsonb;
  v_last jsonb;
BEGIN
  IF p_raw IS NULL THEN
    RETURN NULL;
  END IF;

  -- Accept GeoJSON Polygon directly
  IF jsonb_typeof(p_raw) = 'object' AND lower(COALESCE(p_raw->>'type', '')) = 'polygon'
     AND jsonb_typeof(p_raw->'coordinates') = 'array'
     AND jsonb_array_length(p_raw->'coordinates') > 0
     AND jsonb_typeof(p_raw->'coordinates'->0) = 'array' THEN
    v_ring := p_raw->'coordinates'->0;
  -- Accept legacy LatLngPoint[] array [{lat, lng}, ...]
  ELSIF jsonb_typeof(p_raw) = 'array' AND jsonb_array_length(p_raw) >= 3 THEN
    FOR v_pt IN SELECT value FROM jsonb_array_elements(p_raw)
    LOOP
      IF jsonb_typeof(v_pt) = 'object' AND (v_pt ? 'lng') AND (v_pt ? 'lat') THEN
        v_ring := v_ring || jsonb_build_array(
          jsonb_build_array((v_pt->>'lng')::numeric, (v_pt->>'lat')::numeric)
        );
      ELSIF jsonb_typeof(v_pt) = 'array' AND jsonb_array_length(v_pt) >= 2 THEN
        v_ring := v_ring || jsonb_build_array(v_pt);
      END IF;
    END LOOP;
  ELSE
    RETURN p_raw;
  END IF;

  IF jsonb_array_length(v_ring) < 3 THEN
    RETURN NULL;
  END IF;

  v_first := v_ring->0;
  v_last := v_ring->(jsonb_array_length(v_ring) - 1);
  IF v_first IS DISTINCT FROM v_last THEN
    v_ring := v_ring || jsonb_build_array(v_first);
  END IF;

  RETURN jsonb_build_object(
    'type', 'Polygon',
    'coordinates', jsonb_build_array(v_ring)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.normalize_real_estate_geometry_v21b()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF NEW.boundary_geojson IS NOT NULL THEN
    NEW.boundary_geojson := public._normalize_geojson_polygon_v21b(NEW.boundary_geojson);
  END IF;

  IF NEW.area_value IS NOT NULL AND NEW.area_value > 0 AND (NEW.area_sqft IS NULL OR NEW.area_sqft <= 0) THEN
    NEW.area_sqft := round(
      CASE NEW.area_unit
        WHEN 'sangam' THEN NEW.area_value * 10890.0
        WHEN 'acre' THEN NEW.area_value * 43560.0
        WHEN 'sqm' THEN NEW.area_value * 10.7639104
        ELSE NEW.area_value
      END
    )::integer;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_normalize_real_estate_geometry_v21b ON public.listing_real_estate_profiles;
CREATE TRIGGER trg_normalize_real_estate_geometry_v21b
  BEFORE INSERT OR UPDATE ON public.listing_real_estate_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_real_estate_geometry_v21b();

-- =============================================================================
-- 6. P1-12: OWNER ENQUIRY REPLY & REVIEW FLAG PERSISTENCE RPCs
-- =============================================================================
ALTER TABLE public.enquiries
  ADD COLUMN IF NOT EXISTS owner_reply text,
  ADD COLUMN IF NOT EXISTS replied_at timestamptz,
  ADD COLUMN IF NOT EXISTS replied_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sender_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS is_flagged boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS flag_reason text,
  ADD COLUMN IF NOT EXISTS flagged_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS flagged_at timestamptz;

CREATE OR REPLACE FUNCTION public.reply_to_enquiry(
  p_enquiry_id uuid,
  p_reply_text text,
  p_status text DEFAULT 'replied'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_reply text := trim(COALESCE(p_reply_text, ''));
  v_status text := lower(trim(COALESCE(p_status, 'replied')));
  v_enq record;
  v_listing record;
  v_customer_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  IF char_length(v_reply) < 2 THEN
    RAISE EXCEPTION 'Reply message must be at least 2 characters.' USING ERRCODE = '22023';
  END IF;

  IF v_status NOT IN ('new', 'open', 'read', 'replied', 'archived') THEN
    v_status := 'replied';
  END IF;

  SELECT * INTO v_enq
  FROM public.enquiries
  WHERE id = p_enquiry_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Enquiry not found.' USING ERRCODE = 'P0002';
  END IF;

  SELECT id, owner_id, title, hub_id INTO v_listing
  FROM public.listings
  WHERE id = v_enq.listing_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Parent listing not found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_listing.owner_id IS DISTINCT FROM v_uid
     AND NOT public.staff_has_listing_grant(v_listing.id, 'can_reply_enquiries', NULL, v_uid)
     AND NOT public.is_pnd_admin(v_uid) THEN
    RAISE EXCEPTION 'Forbidden: you do not have permission to reply to enquiries for this listing.'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.enquiries
  SET
    owner_reply = v_reply,
    replied_at = now(),
    replied_by = v_uid,
    status = v_status
  WHERE id = p_enquiry_id;

  v_customer_id := COALESCE(v_enq.sender_id, (to_jsonb(v_enq)->>'user_id')::uuid);
  IF v_customer_id IS NOT NULL THEN
    PERFORM public.emit_notification(
      v_customer_id,
      'Reply from ' || COALESCE(v_listing.title, 'Business'),
      left(v_reply, 240),
      'enquiry',
      '/messages?enquiry=' || p_enquiry_id::text,
      jsonb_build_object('enquiry_id', p_enquiry_id, 'listing_id', v_listing.id),
      v_listing.id
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'enquiry_id', p_enquiry_id,
    'status', v_status,
    'replied_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.reply_to_enquiry(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.reply_to_enquiry(uuid, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.flag_listing_review(
  p_review_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_reason text := trim(COALESCE(p_reason, ''));
  v_rev record;
  v_listing record;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  IF char_length(v_reason) < 4 THEN
    RAISE EXCEPTION 'Please provide a brief reason (at least 4 characters) when flagging a review.'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_rev
  FROM public.reviews
  WHERE id = p_review_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Review not found.' USING ERRCODE = 'P0002';
  END IF;

  SELECT id, owner_id, hub_id INTO v_listing
  FROM public.listings
  WHERE id = v_rev.listing_id;

  IF v_listing.owner_id IS DISTINCT FROM v_uid
     AND NOT public.staff_has_listing_grant(v_listing.id, 'can_reply_reviews', NULL, v_uid)
     AND NOT public.is_pnd_admin(v_uid)
     AND NOT public.is_hub_manager_for(v_listing.hub_id) THEN
    RAISE EXCEPTION 'Forbidden: only the business owner, authorized staff, or Hub Manager may flag this review.'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.reviews
  SET
    is_flagged = true,
    reported = true,
    flag_reason = v_reason,
    report_reason = v_reason,
    flagged_by = v_uid,
    flagged_at = now()
  WHERE id = p_review_id;

  RETURN jsonb_build_object(
    'ok', true,
    'review_id', p_review_id,
    'is_flagged', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.flag_listing_review(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.flag_listing_review(uuid, text) TO authenticated, service_role;

-- =============================================================================
-- 7. P1-14: SERVER-SIDE YOUTUBE BOOST ENTITLEMENT GUARD ON BULLETINS
-- =============================================================================
CREATE OR REPLACE FUNCTION public.guard_bulletin_youtube_entitlement_v21b()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := COALESCE(auth.uid(), NEW.author_id);
  v_ent jsonb;
  v_allow_yt boolean := false;
  v_has_paid_boost boolean := false;
BEGIN
  IF NEW.youtube_video_id IS NULL OR trim(NEW.youtube_video_id) = '' THEN
    RETURN NEW;
  END IF;

  IF COALESCE(NEW.status, 'published') <> 'published' THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NOT NULL AND (public.is_pnd_admin(auth.uid()) OR public.is_hub_manager_for(NEW.hub_id)) THEN
    RETURN NEW;
  END IF;

  -- 1. Check active subscription entitlement (features.youtube_embed or plan.allow_youtube)
  v_ent := public.get_effective_entitlements(COALESCE(NEW.author_id, v_uid), NEW.linked_listing_id);
  v_allow_yt := COALESCE((v_ent->'features'->>'youtube_embed')::boolean, false);

  IF NOT v_allow_yt THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.user_subscriptions us
      JOIN public.subscription_plans sp ON sp.id = us.plan_id
      WHERE us.user_id = COALESCE(NEW.author_id, v_uid)
        AND us.status IN ('active', 'trialing')
        AND COALESCE(us.ends_at, us.expires_at) > now()
        AND sp.is_active = true
        AND COALESCE(sp.allow_youtube, false) = true
    ) INTO v_allow_yt;
  END IF;

  IF v_allow_yt THEN
    RETURN NEW;
  END IF;

  -- 2. Check paid Pay-Per order containing 'youtube_boost' add-on
  SELECT EXISTS (
    SELECT 1
    FROM public.pay_per_orders ppo
    CROSS JOIN LATERAL jsonb_array_elements(
      CASE
        WHEN jsonb_typeof(ppo.quote_breakdown->'selected_addons') = 'array'
          THEN ppo.quote_breakdown->'selected_addons'
        ELSE '[]'::jsonb
      END
    ) AS addon
    WHERE ppo.target_table = 'bulletins'
      AND ppo.target_id = NEW.id
      AND ppo.status = 'paid'
      AND (addon->>'id') = 'youtube_boost'
  ) INTO v_has_paid_boost;

  IF v_has_paid_boost THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'YouTube video embeds require an eligible plan or the Pay-Per YouTube Video Embed Boost add-on.'
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_bulletin_youtube_entitlement_v21b ON public.bulletins;
CREATE TRIGGER trg_guard_bulletin_youtube_entitlement_v21b
  BEFORE INSERT OR UPDATE OF youtube_video_id, status ON public.bulletins
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_bulletin_youtube_entitlement_v21b();

-- =============================================================================
-- 8. P1-20: OWNER FEEDBACK NOTIFICATIONS ON SUGGESTED CATEGORIES & PAY-PER ORDERS
-- =============================================================================
CREATE OR REPLACE FUNCTION public.review_suggested_category(
  p_category_id uuid,
  p_action text,
  p_display_name text DEFAULT NULL,
  p_slug text DEFAULT NULL,
  p_icon_key text DEFAULT NULL,
  p_accent_color text DEFAULT NULL,
  p_parent_id uuid DEFAULT NULL,
  p_review_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_action text := lower(trim(COALESCE(p_action, '')));
  v_cat record;
  v_next_parent record;
  v_clean_name text;
  v_clean_slug text;
  v_reassigned_listings int := 0;
  v_updated record;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Forbidden: Only super_admin can review suggested categories.' USING ERRCODE = '42501';
  END IF;

  IF v_action NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'Invalid review action "%". Expected "approve" or "reject".', p_action USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_cat FROM public.categories WHERE id = p_category_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Category (%) not found.', p_category_id USING ERRCODE = '23503';
  END IF;
  IF v_cat.is_system_root = true THEN
    RAISE EXCEPTION 'Cannot review or reject a Level-1 System Root.' USING ERRCODE = '42501';
  END IF;

  IF v_action = 'approve' THEN
    v_clean_name := COALESCE(NULLIF(regexp_replace(trim(COALESCE(p_display_name, '')), '\s+', ' ', 'g'), ''), v_cat.display_name);
    v_clean_slug := COALESCE(NULLIF(lower(trim(COALESCE(p_slug, ''))), ''), v_cat.slug);

    IF char_length(v_clean_name) < 2 OR char_length(v_clean_name) > 64 THEN
      RAISE EXCEPTION 'Display label must be between 2 and 64 characters.' USING ERRCODE = '22023';
    END IF;
    IF v_clean_slug !~ '^[a-z0-9]+(?:[-_][a-z0-9]+)*$' THEN
      RAISE EXCEPTION 'Slug "%" must use lowercase letters, numbers, hyphens, or underscores only.', v_clean_slug USING ERRCODE = '22023';
    END IF;

    IF p_parent_id IS NOT NULL AND p_parent_id <> v_cat.parent_id THEN
      SELECT id, entity_type, root_key, depth, review_status INTO v_next_parent
      FROM public.categories WHERE id = p_parent_id;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Target parent category (%) does not exist.', p_parent_id USING ERRCODE = '23503';
      END IF;
      IF v_next_parent.entity_type <> v_cat.entity_type OR v_next_parent.root_key <> v_cat.root_key THEN
        RAISE EXCEPTION 'Relinked parent must stay within the same system root (%).', v_cat.root_key USING ERRCODE = '22023';
      END IF;
      IF v_next_parent.depth NOT IN (1, 2) OR v_next_parent.review_status <> 'official' THEN
        RAISE EXCEPTION 'Relinked parent must be an official Level-1 or Level-2 category.' USING ERRCODE = '22023';
      END IF;
    END IF;

    UPDATE public.categories
    SET
      display_name = v_clean_name,
      slug = v_clean_slug,
      icon_key = COALESCE(NULLIF(trim(COALESCE(p_icon_key, '')), ''), icon_key),
      icon = COALESCE(NULLIF(trim(COALESCE(p_icon_key, '')), ''), icon),
      accent_color = COALESCE(NULLIF(trim(COALESCE(p_accent_color, '')), ''), accent_color),
      color_hex = COALESCE(NULLIF(trim(COALESCE(p_accent_color, '')), ''), color_hex),
      parent_id = COALESCE(p_parent_id, parent_id),
      review_status = 'official',
      is_active = true,
      review_notes = NULLIF(trim(COALESCE(p_review_notes, '')), ''),
      updated_at = now()
    WHERE id = p_category_id
    RETURNING * INTO v_updated;

    UPDATE public.listings SET subcategory = v_updated.display_name WHERE category_id = p_category_id;

    PERFORM public.write_audit_log(
      v_actor, 'super_admin', 'approve_suggested_category', 'categories', p_category_id::text,
      jsonb_build_object(
        'display_name', v_updated.display_name, 'slug', v_updated.slug,
        'root_key', v_updated.root_key, 'suggested_by', v_cat.suggested_by,
        'review_notes', v_updated.review_notes
      )
    );

    IF v_cat.suggested_by IS NOT NULL THEN
      PERFORM public.emit_notification(
        v_cat.suggested_by,
        'Category Suggestion Approved',
        format('Your suggested category "%s" is now live and official across DD oodle.', v_updated.display_name),
        'system',
        '/workspace?hat=owner',
        jsonb_build_object('category_id', v_updated.id, 'action', 'approve')
      );
    END IF;

    RETURN jsonb_build_object(
      'action', 'approve', 'category_id', v_updated.id,
      'display_name', v_updated.display_name, 'slug', v_updated.slug, 'review_status', v_updated.review_status
    );
  END IF;

  IF v_cat.parent_id IS NOT NULL THEN
    UPDATE public.listings SET category_id = v_cat.parent_id WHERE category_id = p_category_id;
    GET DIAGNOSTICS v_reassigned_listings = ROW_COUNT;
  END IF;

  UPDATE public.categories
  SET
    review_status = 'rejected',
    is_active = false,
    review_notes = NULLIF(trim(COALESCE(p_review_notes, '')), ''),
    updated_at = now()
  WHERE id = p_category_id
  RETURNING * INTO v_updated;

  PERFORM public.write_audit_log(
    v_actor, 'super_admin', 'reject_suggested_category', 'categories', p_category_id::text,
    jsonb_build_object(
      'display_name', v_updated.display_name, 'slug', v_updated.slug,
      'reassigned_listings', v_reassigned_listings, 'suggested_by', v_cat.suggested_by,
      'review_notes', v_updated.review_notes
    )
  );

  IF v_cat.suggested_by IS NOT NULL THEN
    PERFORM public.emit_notification(
      v_cat.suggested_by,
      'Category Suggestion Update',
      format('Your suggested category "%s" was not approved%s', v_updated.display_name,
        CASE WHEN v_updated.review_notes IS NOT NULL THEN ': ' || v_updated.review_notes ELSE '.' END),
      'system',
      '/workspace?hat=owner',
      jsonb_build_object('category_id', v_updated.id, 'action', 'reject')
    );
  END IF;

  RETURN jsonb_build_object(
    'action', 'reject', 'category_id', v_updated.id,
    'fallback_parent_id', v_cat.parent_id, 'reassigned_listings', v_reassigned_listings,
    'review_status', v_updated.review_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.review_suggested_category(uuid, text, text, text, text, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_suggested_category(uuid, text, text, text, text, text, uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.merge_suggested_category(
  p_source_id uuid,
  p_target_id uuid,
  p_review_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_source record;
  v_target record;
  v_reassigned_listings int := 0;
  v_reassigned_products int := 0;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Forbidden: Only super_admin can merge suggested categories.' USING ERRCODE = '42501';
  END IF;

  IF p_source_id IS NULL OR p_target_id IS NULL OR p_source_id = p_target_id THEN
    RAISE EXCEPTION 'Distinct source and target category IDs are required for merge.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_source FROM public.categories WHERE id = p_source_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source category (%) not found.', p_source_id USING ERRCODE = '23503';
  END IF;
  IF v_source.is_system_root = true THEN
    RAISE EXCEPTION 'Cannot merge a Level-1 System Root.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_target FROM public.categories WHERE id = p_target_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target category (%) not found.', p_target_id USING ERRCODE = '23503';
  END IF;
  IF v_target.review_status <> 'official' OR v_target.is_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Merge target must be an active official category.' USING ERRCODE = '22023';
  END IF;
  IF v_source.entity_type <> v_target.entity_type THEN
    RAISE EXCEPTION 'Cannot merge categories across different entity types (% -> %).', v_source.entity_type, v_target.entity_type
      USING ERRCODE = '22023';
  END IF;

  UPDATE public.listings
  SET category_id = p_target_id, subcategory = v_target.display_name
  WHERE category_id = p_source_id;
  GET DIAGNOSTICS v_reassigned_listings = ROW_COUNT;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'marketplace_products' AND column_name = 'category_id'
  ) THEN
    EXECUTE 'UPDATE public.marketplace_products SET category_id = $1 WHERE category_id = $2'
      USING p_target_id, p_source_id;
    GET DIAGNOSTICS v_reassigned_products = ROW_COUNT;
  END IF;

  UPDATE public.categories
  SET
    review_status = 'merged',
    is_active = false,
    merged_into_category_id = p_target_id,
    review_notes = NULLIF(trim(COALESCE(p_review_notes, '')), ''),
    updated_at = now()
  WHERE id = p_source_id;

  PERFORM public.write_audit_log(
    v_actor, 'super_admin', 'merge_suggested_category', 'categories', p_source_id::text,
    jsonb_build_object(
      'source_name', v_source.display_name, 'target_id', p_target_id, 'target_name', v_target.display_name,
      'reassigned_listings', v_reassigned_listings, 'reassigned_products', v_reassigned_products,
      'suggested_by', v_source.suggested_by
    )
  );

  IF v_source.suggested_by IS NOT NULL THEN
    PERFORM public.emit_notification(
      v_source.suggested_by,
      'Category Suggestion Merged',
      format('Your suggested category "%s" was merged into "%s" and your listings were updated.', v_source.display_name, v_target.display_name),
      'system',
      '/workspace?hat=owner',
      jsonb_build_object('category_id', p_source_id, 'target_id', p_target_id, 'action', 'merge')
    );
  END IF;

  RETURN jsonb_build_object(
    'action', 'merge', 'source_id', p_source_id, 'target_id', p_target_id,
    'target_name', v_target.display_name, 'reassigned_listings', v_reassigned_listings,
    'reassigned_products', v_reassigned_products, 'review_status', 'merged'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.merge_suggested_category(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.merge_suggested_category(uuid, uuid, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.review_pay_per_order(
  p_order_id uuid,
  p_decision text,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_decision text := lower(trim(COALESCE(p_decision, '')));
  v_clean_notes text := NULLIF(trim(COALESCE(p_notes, '')), '');
  v_order public.pay_per_orders%ROWTYPE;
  v_paid_until timestamptz := NULL;
  v_selected_addons jsonb;
  v_has_featured boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  IF v_decision NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'Decision must be approve or reject.' USING ERRCODE = '22023';
  END IF;

  IF v_decision = 'reject' AND (v_clean_notes IS NULL OR length(v_clean_notes) < 4) THEN
    RAISE EXCEPTION 'A rejection reason note (at least 4 characters) is required.' USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_order FROM public.pay_per_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pay-per order not found.' USING ERRCODE = 'P0002';
  END IF;

  IF NOT public.is_pnd_admin(v_uid)
     AND NOT (v_order.hub_id IS NOT NULL AND public.is_hub_manager_for(v_order.hub_id)) THEN
    RAISE EXCEPTION 'Only Admin, Super-Admin, or the authorized Hub Manager can review pay-per orders.'
      USING ERRCODE = '42501';
  END IF;

  IF v_order.status <> 'pending_verification' THEN
    RAISE EXCEPTION 'Pay-per order % was already reviewed (status: %).', v_order.id, v_order.status USING ERRCODE = 'P0001';
  END IF;

  IF v_decision = 'approve' THEN
    v_paid_until := now() + (v_order.duration_days || ' days')::interval;
    v_selected_addons := COALESCE(v_order.quote_breakdown->'selected_addons', '[]'::jsonb);

    SELECT EXISTS (
      SELECT 1
      FROM jsonb_array_elements(
        CASE WHEN jsonb_typeof(v_selected_addons) = 'array' THEN v_selected_addons ELSE '[]'::jsonb END
      ) AS a
      WHERE (a->>'id') IN ('featured_spot', 'featured_pin', 're_featured_tag', 're_rent_featured')
    ) INTO v_has_featured;

    UPDATE public.pay_per_orders
    SET status = 'paid', paid_until = v_paid_until, reviewed_by = v_uid, review_notes = v_clean_notes, updated_at = now()
    WHERE id = p_order_id;

    IF v_order.target_table IN ('marketplace_items', 'marketplace_products') THEN
      IF to_regclass('public.marketplace_products') IS NOT NULL THEN
        UPDATE public.marketplace_products
        SET paid_until = GREATEST(COALESCE(paid_until, now()), now()) + (v_order.duration_days || ' days')::interval, is_active = true
        WHERE id = v_order.target_id;
      END IF;
      IF to_regclass('public.marketplace_items') IS NOT NULL THEN
        EXECUTE 'UPDATE public.marketplace_items SET paid_until = GREATEST(COALESCE(paid_until, now()), now()) + ($1 || '' days'')::interval, is_active = true WHERE id = $2'
          USING v_order.duration_days, v_order.target_id;
      END IF;
    ELSIF v_order.target_table = 'bulletins' THEN
      UPDATE public.bulletins
      SET
        paid_until = GREATEST(COALESCE(paid_until, now()), now()) + (v_order.duration_days || ' days')::interval,
        expires_at = GREATEST(COALESCE(expires_at, now()), now()) + (v_order.duration_days || ' days')::interval,
        status = 'published',
        is_pinned = CASE WHEN v_has_featured THEN true ELSE is_pinned END
      WHERE id = v_order.target_id;
    ELSIF v_order.target_table = 'listings' THEN
      UPDATE public.listings
      SET
        paid_until = GREATEST(COALESCE(paid_until, now()), now()) + (v_order.duration_days || ' days')::interval,
        status = CASE WHEN status IN ('pending', 'pending_verification', 'pending_payment', 'draft') THEN 'published' ELSE status END,
        is_featured = CASE WHEN v_has_featured THEN true ELSE is_featured END,
        updated_at = now()
      WHERE id = v_order.target_id;
    END IF;
  ELSE
    UPDATE public.pay_per_orders
    SET status = 'rejected', reviewed_by = v_uid, review_notes = v_clean_notes, updated_at = now()
    WHERE id = p_order_id;
  END IF;

  IF to_regclass('public.audit_logs') IS NOT NULL THEN
    INSERT INTO public.audit_logs (
      actor_id, actor_role, workspace, hub_id, action, target_table, target_id, details, metadata, created_at
    )
    VALUES (
      v_uid,
      CASE WHEN public.is_super_admin() THEN 'super_admin' ELSE 'hub_manager' END,
      CASE WHEN public.is_super_admin() THEN 'admin' ELSE 'hub_manager' END,
      v_order.hub_id,
      'review_pay_per_order_' || v_decision,
      'pay_per_orders',
      p_order_id::text,
      'Reviewed Pay-Per order (' || v_decision || ')',
      jsonb_build_object(
        'order_id', p_order_id::text, 'decision', v_decision,
        'module_key', v_order.module_key, 'target_table', v_order.target_table,
        'target_id', v_order.target_id::text, 'amount_inr', v_order.amount_inr,
        'paid_until', v_paid_until, 'notes', v_clean_notes
      ),
      now()
    );
  END IF;

  IF v_order.user_id IS NOT NULL THEN
    PERFORM public.emit_notification(
      v_order.user_id,
      CASE WHEN v_decision = 'approve' THEN 'Pay-Per Order Verified & Published' ELSE 'Pay-Per Payment Rejected' END,
      CASE WHEN v_decision = 'approve'
        THEN format('Your %s payment (Rs %s) was verified and is now live.', replace(v_order.module_key, '_', ' '), v_order.amount_inr)
        ELSE format('Your %s payment could not be verified: %s', replace(v_order.module_key, '_', ' '), COALESCE(v_clean_notes, 'Please check UTR and try again.'))
      END,
      'payment',
      CASE WHEN v_order.target_table = 'bulletins' THEN '/workspace?hat=advertiser' ELSE '/workspace?hat=owner' END,
      jsonb_build_object('order_id', p_order_id, 'decision', v_decision, 'target_table', v_order.target_table, 'target_id', v_order.target_id)
    );
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'order_id', p_order_id,
    'status', CASE WHEN v_decision = 'approve' THEN 'paid' ELSE 'rejected' END,
    'paid_until', v_paid_until
  );
END;
$$;

REVOKE ALL ON FUNCTION public.review_pay_per_order(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.review_pay_per_order(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.review_pay_per_order(uuid, text, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.populate_pay_per_order_hub_id_v21b()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.hub_id IS NULL THEN
    IF NEW.target_table = 'listings' THEN
      SELECT hub_id INTO NEW.hub_id FROM public.listings WHERE id = NEW.target_id LIMIT 1;
    ELSIF NEW.target_table = 'bulletins' THEN
      SELECT hub_id INTO NEW.hub_id FROM public.bulletins WHERE id = NEW.target_id LIMIT 1;
    ELSIF NEW.target_table IN ('marketplace_products', 'marketplace_items') AND to_regclass('public.marketplace_products') IS NOT NULL THEN
      SELECT hub_id INTO NEW.hub_id FROM public.marketplace_products WHERE id = NEW.target_id LIMIT 1;
    END IF;
    IF NEW.hub_id IS NULL AND NEW.user_id IS NOT NULL THEN
      SELECT COALESCE(default_hub_id, home_hub_id) INTO NEW.hub_id FROM public.profiles WHERE id = NEW.user_id LIMIT 1;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_populate_pay_per_order_hub_id_v21b ON public.pay_per_orders;
CREATE TRIGGER trg_populate_pay_per_order_hub_id_v21b
  BEFORE INSERT ON public.pay_per_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.populate_pay_per_order_hub_id_v21b();

COMMIT;
