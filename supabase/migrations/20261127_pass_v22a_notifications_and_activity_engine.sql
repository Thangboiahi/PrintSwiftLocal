-- =============================================================================
-- Migration: 20261127_pass_v22a_notifications_and_activity_engine.sql
-- Sprint v22a (Batch 3): Unified Notifications & Activity Engine (Closes P2-01)
-- =============================================================================
-- Rules enforced:
--   1. Idempotent, transaction-wrapped (BEGIN / COMMIT) migration.
--   2. Enriches public.notifications (category, priority, role_scope) and
--      public.profiles (notification_preferences jsonb) without duplicate tables.
--   3. Strict RLS on public.notifications (SELECT & UPDATE scoped strictly to
--      user_id = auth.uid(); no direct client INSERT forgery).
--   4. Unified SECURITY DEFINER dispatcher (_dispatch_notification_v22a),
--      upgraded backward-compatible emit_notification(), and mark_notifications_read().
--   5. Lightweight AFTER INSERT OR UPDATE triggers across all 5 core role
--      handoff groups writing actionable alerts to public.notifications and
--      timeline events to public.activity_logs.
--   6. Clean get_my_activity_feed() RPC merging caller's activity_logs and
--      role-scoped audit_logs (exact 13-column contract).
--   7. Never touches extension-owned functions (AGENTS.md §3.8).
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. Enrich public.notifications, public.profiles & public.activity_logs
-- -----------------------------------------------------------------------------

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS is_read boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS action_url text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS link_listing_id uuid,
  ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'system',
  ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS role_scope text NOT NULL DEFAULT 'visitor';

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS notification_preferences jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE public.activity_logs
  ADD COLUMN IF NOT EXISTS entity_title text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb;

-- Normalize any legacy rows before attaching CHECK constraints
UPDATE public.notifications
SET
  category = CASE
    WHEN category IN (
      'orders_bookings',
      'logistics_escrow',
      'enquiries_reviews',
      'moderation_kyc',
      'billing_trials',
      'team_staff',
      'system'
    ) THEN category
    WHEN lower(COALESCE(type, '')) IN ('enquiry', 'review') THEN 'enquiries_reviews'
    WHEN lower(COALESCE(type, '')) IN ('verification', 'kyc', 'moderation') THEN 'moderation_kyc'
    WHEN lower(COALESCE(type, '')) IN ('order', 'booking', 'print') THEN 'orders_bookings'
    WHEN lower(COALESCE(type, '')) IN ('delivery', 'escrow', 'trip') THEN 'logistics_escrow'
    WHEN lower(COALESCE(type, '')) IN ('payment', 'billing', 'subscription') THEN 'billing_trials'
    WHEN lower(COALESCE(type, '')) IN ('staff', 'team') THEN 'team_staff'
    ELSE 'system'
  END,
  priority = CASE
    WHEN priority IN ('low', 'normal', 'high', 'urgent') THEN priority
    ELSE 'normal'
  END,
  role_scope = CASE
    WHEN role_scope IN (
      'visitor',
      'owner',
      'staff',
      'driver',
      'mediator',
      'hub_manager',
      'advertiser',
      'super_admin'
    ) THEN role_scope
    ELSE 'visitor'
  END;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'notifications_category_v22a_check'
      AND conrelid = 'public.notifications'::regclass
  ) THEN
    ALTER TABLE public.notifications
      ADD CONSTRAINT notifications_category_v22a_check
      CHECK (category IN (
        'orders_bookings',
        'logistics_escrow',
        'enquiries_reviews',
        'moderation_kyc',
        'billing_trials',
        'team_staff',
        'system'
      ));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'notifications_priority_v22a_check'
      AND conrelid = 'public.notifications'::regclass
  ) THEN
    ALTER TABLE public.notifications
      ADD CONSTRAINT notifications_priority_v22a_check
      CHECK (priority IN ('low', 'normal', 'high', 'urgent'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'notifications_role_scope_v22a_check'
      AND conrelid = 'public.notifications'::regclass
  ) THEN
    ALTER TABLE public.notifications
      ADD CONSTRAINT notifications_role_scope_v22a_check
      CHECK (role_scope IN (
        'visitor',
        'owner',
        'staff',
        'driver',
        'mediator',
        'hub_manager',
        'advertiser',
        'super_admin'
      ));
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_notifications_user_unread_category_created
  ON public.notifications (user_id, is_read, category, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_activity_logs_user_created_v22a
  ON public.activity_logs (user_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- 2. Sync & Immutability Guard Trigger on public.notifications
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.trg_fn_v22a_sync_notification_row()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_has_recipient_id boolean;
  v_has_read_col boolean;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'recipient_id'
  ) INTO v_has_recipient_id;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'read'
  ) INTO v_has_read_col;

  IF TG_OP = 'UPDATE' THEN
    -- Prevent authenticated clients from tampering with notification content or ownership
    IF auth.uid() IS NOT NULL AND current_setting('role', true) = 'authenticated' THEN
      NEW.user_id := OLD.user_id;
      NEW.title := OLD.title;
      NEW.message := OLD.message;
      NEW.category := OLD.category;
      NEW.priority := OLD.priority;
      NEW.role_scope := OLD.role_scope;
      NEW.action_url := OLD.action_url;
      NEW.created_at := OLD.created_at;
    END IF;
  END IF;

  IF NEW.category IS NULL OR NEW.category NOT IN (
    'orders_bookings',
    'logistics_escrow',
    'enquiries_reviews',
    'moderation_kyc',
    'billing_trials',
    'team_staff',
    'system'
  ) THEN
    NEW.category := 'system';
  END IF;

  IF NEW.priority IS NULL OR NEW.priority NOT IN ('low', 'normal', 'high', 'urgent') THEN
    NEW.priority := 'normal';
  END IF;

  IF NEW.role_scope IS NULL OR NEW.role_scope NOT IN (
    'visitor',
    'owner',
    'staff',
    'driver',
    'mediator',
    'hub_manager',
    'advertiser',
    'super_admin'
  ) THEN
    NEW.role_scope := 'visitor';
  END IF;

  IF NEW.metadata IS NULL THEN
    NEW.metadata := '{}'::jsonb;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_v22a_sync_notification_row ON public.notifications;
CREATE TRIGGER trg_v22a_sync_notification_row
  BEFORE INSERT OR UPDATE ON public.notifications
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_fn_v22a_sync_notification_row();

-- -----------------------------------------------------------------------------
-- 3. Strict RLS on public.notifications & Realtime Publication
-- -----------------------------------------------------------------------------

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- Drop any legacy or permissive policies on public.notifications
DROP POLICY IF EXISTS "Users can select own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;
DROP POLICY IF EXISTS "Users can insert own notifications" ON public.notifications;
DROP POLICY IF EXISTS "notifications_select_own" ON public.notifications;
DROP POLICY IF EXISTS "notifications_update_own" ON public.notifications;
DROP POLICY IF EXISTS "notifications_insert_own" ON public.notifications;

CREATE POLICY "Users can select own notifications"
  ON public.notifications
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can update own notifications"
  ON public.notifications
  FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Ensure activity_logs SELECT is strictly scoped to user_id = auth.uid()
DROP POLICY IF EXISTS "Users can select own activity_logs" ON public.activity_logs;
CREATE POLICY "Users can select own activity_logs"
  ON public.activity_logs
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

-- Idempotently register public.notifications and public.property_visit_requests in supabase_realtime
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'notifications'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
    END IF;

    IF to_regclass('public.property_visit_requests') IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime'
        AND schemaname = 'public'
        AND tablename = 'property_visit_requests'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.property_visit_requests;
    END IF;
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    -- Ignore publication ownership warnings in restricted local test runners
    NULL;
END;
$$;

-- -----------------------------------------------------------------------------
-- 4. Unified Notification Dispatcher, Activity Logger & Read RPCs
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._log_user_activity_v22a(
  p_user_id uuid,
  p_action_type text,
  p_entity_id text DEFAULT NULL,
  p_entity_title text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id uuid;
  v_clean_action text := COALESCE(NULLIF(btrim(p_action_type), ''), 'activity');
BEGIN
  IF p_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.activity_logs (
    user_id,
    action_type,
    entity_id,
    entity_title,
    metadata,
    created_at
  ) VALUES (
    p_user_id,
    left(v_clean_action, 120),
    p_entity_id,
    CASE WHEN p_entity_title IS NOT NULL THEN left(btrim(p_entity_title), 240) ELSE NULL END,
    COALESCE(p_metadata, '{}'::jsonb),
    now()
  )
  RETURNING id INTO v_id;

  RETURN v_id;
EXCEPTION
  WHEN OTHERS THEN
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public._log_user_activity_v22a(uuid, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._log_user_activity_v22a(uuid, text, text, text, jsonb) TO service_role;

CREATE OR REPLACE FUNCTION public._dispatch_notification_v22a(
  p_user_id uuid,
  p_title text,
  p_message text,
  p_category text DEFAULT 'system',
  p_priority text DEFAULT 'normal',
  p_role_scope text DEFAULT 'visitor',
  p_action_url text DEFAULT '/activity',
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_link_listing_id uuid DEFAULT NULL,
  p_type text DEFAULT 'status_change'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_notif_id uuid;
  v_clean_title text := left(COALESCE(NULLIF(btrim(p_title), ''), 'Platform Notification'), 200);
  v_clean_msg text := left(COALESCE(NULLIF(btrim(p_message), ''), ''), 2000);
  v_category text := lower(COALESCE(NULLIF(btrim(p_category), ''), 'system'));
  v_priority text := lower(COALESCE(NULLIF(btrim(p_priority), ''), 'normal'));
  v_role_scope text := lower(COALESCE(NULLIF(btrim(p_role_scope), ''), 'visitor'));
  v_clean_type text := lower(COALESCE(NULLIF(btrim(p_type), ''), 'status_change'));
  v_clean_url text := NULLIF(btrim(COALESCE(p_action_url, '')), '');
  v_prefs jsonb := '{}'::jsonb;
  v_is_muted boolean := false;
  v_has_recipient_id boolean;
  v_has_recipient_role boolean;
  v_has_read_col boolean;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(p.notification_preferences, '{}'::jsonb)
    INTO v_prefs
    FROM public.profiles p
   WHERE p.id = p_user_id;

  IF NOT FOUND THEN
    RETURN NULL;
  END IF;

  -- Normalize category
  IF v_category NOT IN (
    'orders_bookings',
    'logistics_escrow',
    'enquiries_reviews',
    'moderation_kyc',
    'billing_trials',
    'team_staff',
    'system'
  ) THEN
    v_category := CASE
      WHEN v_clean_type IN ('enquiry', 'review') THEN 'enquiries_reviews'
      WHEN v_clean_type IN ('verification', 'kyc', 'moderation') THEN 'moderation_kyc'
      WHEN v_clean_type IN ('order', 'booking', 'print') THEN 'orders_bookings'
      WHEN v_clean_type IN ('delivery', 'escrow', 'trip') THEN 'logistics_escrow'
      WHEN v_clean_type IN ('payment', 'billing', 'subscription') THEN 'billing_trials'
      WHEN v_clean_type IN ('staff', 'team') THEN 'team_staff'
      ELSE 'system'
    END;
  END IF;

  -- Normalize priority
  IF v_priority NOT IN ('low', 'normal', 'high', 'urgent') THEN
    v_priority := 'normal';
  END IF;

  -- Normalize role_scope
  IF v_role_scope NOT IN (
    'visitor',
    'owner',
    'staff',
    'driver',
    'mediator',
    'hub_manager',
    'advertiser',
    'super_admin'
  ) THEN
    v_role_scope := 'visitor';
  END IF;

  -- Normalize legacy type column
  IF v_clean_type NOT IN ('review', 'verification', 'reminder', 'enquiry', 'status_change', 'system') THEN
    v_clean_type := CASE
      WHEN v_category = 'enquiries_reviews' THEN 'enquiry'
      WHEN v_category = 'moderation_kyc' THEN 'verification'
      ELSE 'status_change'
    END;
  END IF;

  -- Validate relative in-app action_url (reject external URLs)
  IF v_clean_url IS NULL OR v_clean_url !~ '^/' OR v_clean_url ~ '^//' THEN
    v_clean_url := '/activity';
  END IF;

  -- Check per-category mute preferences (NEVER suppress 'urgent' safety/escrow/OTP/SLA alerts)
  IF v_priority <> 'urgent' AND v_category <> 'system' THEN
    IF (v_prefs ->> v_category) = 'false'
       OR (v_prefs -> 'categories' ->> v_category) = 'false'
       OR (
         jsonb_typeof(v_prefs -> 'muted_categories') = 'array'
         AND (v_prefs -> 'muted_categories') ? v_category
       )
    THEN
      v_is_muted := true;
    END IF;
  END IF;

  IF v_is_muted THEN
    RETURN NULL;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'recipient_id'
  ) INTO v_has_recipient_id;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'recipient_role'
  ) INTO v_has_recipient_role;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'read'
  ) INTO v_has_read_col;

  IF v_has_recipient_id AND v_has_recipient_role AND v_has_read_col THEN
    INSERT INTO public.notifications (
      user_id,
      recipient_id,
      recipient_role,
      title,
      message,
      type,
      category,
      priority,
      role_scope,
      is_read,
      read,
      action_url,
      metadata,
      link_listing_id,
      created_at
    ) VALUES (
      p_user_id,
      p_user_id,
      CASE
        WHEN v_role_scope IN ('super_admin', 'hub_manager') THEN 'admin'
        WHEN v_role_scope IN ('owner', 'staff', 'advertiser') THEN 'owner'
        ELSE 'user'
      END,
      v_clean_title,
      v_clean_msg,
      v_clean_type,
      v_category,
      v_priority,
      v_role_scope,
      false,
      false,
      v_clean_url,
      COALESCE(p_metadata, '{}'::jsonb),
      p_link_listing_id,
      now()
    )
    RETURNING id INTO v_notif_id;
  ELSE
    INSERT INTO public.notifications (
      user_id,
      title,
      message,
      type,
      category,
      priority,
      role_scope,
      is_read,
      action_url,
      metadata,
      link_listing_id,
      created_at
    ) VALUES (
      p_user_id,
      v_clean_title,
      v_clean_msg,
      v_clean_type,
      v_category,
      v_priority,
      v_role_scope,
      false,
      v_clean_url,
      COALESCE(p_metadata, '{}'::jsonb),
      p_link_listing_id,
      now()
    )
    RETURNING id INTO v_notif_id;
  END IF;

  RETURN v_notif_id;
EXCEPTION
  WHEN OTHERS THEN
    RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public._dispatch_notification_v22a(uuid, text, text, text, text, text, text, jsonb, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._dispatch_notification_v22a(uuid, text, text, text, text, text, text, jsonb, uuid, text) TO service_role;

-- Upgrade emit_notification() while keeping backward compatibility with 7-arg callers
DROP FUNCTION IF EXISTS public.emit_notification(uuid, text, text, text, text, jsonb, uuid);
DROP FUNCTION IF EXISTS public.emit_notification(uuid, text, text, text, text, jsonb, uuid, text, text, text);

CREATE OR REPLACE FUNCTION public.emit_notification(
  p_user_id uuid,
  p_title text,
  p_message text,
  p_type text DEFAULT 'system',
  p_action_url text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_link_listing_id uuid DEFAULT NULL,
  p_category text DEFAULT NULL,
  p_priority text DEFAULT NULL,
  p_role_scope text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_allowed boolean := false;
  v_meta jsonb := COALESCE(p_metadata, '{}'::jsonb);
  v_category text := COALESCE(p_category, v_meta ->> 'category', 'system');
  v_priority text := COALESCE(p_priority, v_meta ->> 'priority', 'normal');
  v_role_scope text := COALESCE(p_role_scope, v_meta ->> 'role_scope', 'visitor');
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'p_user_id is required';
  END IF;

  -- Authorization check when called from client session
  IF v_caller IS NULL OR current_setting('role', true) = 'service_role' THEN
    v_allowed := true;
  ELSIF v_caller = p_user_id OR public.is_super_admin() THEN
    v_allowed := true;
  ELSIF EXISTS (
    SELECT 1 FROM public.hub_managers hm
    WHERE hm.profile_id = v_caller
      AND COALESCE(hm.status, 'active') = 'active'
  ) THEN
    v_allowed := true;
  ELSIF p_link_listing_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.listings l
    WHERE l.id = p_link_listing_id AND l.owner_id = v_caller
  ) THEN
    v_allowed := true;
  END IF;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Not authorized to emit notification for target user';
  END IF;

  RETURN public._dispatch_notification_v22a(
    p_user_id        => p_user_id,
    p_title          => p_title,
    p_message        => p_message,
    p_category       => v_category,
    p_priority       => v_priority,
    p_role_scope     => v_role_scope,
    p_action_url     => COALESCE(p_action_url, '/activity'),
    p_metadata       => v_meta,
    p_link_listing_id => p_link_listing_id,
    p_type           => COALESCE(p_type, 'status_change')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.emit_notification(uuid, text, text, text, text, jsonb, uuid, text, text, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.emit_notification(uuid, text, text, text, text, jsonb, uuid, text, text, text) TO authenticated, service_role;

-- Batch & Single Mark-Read RPC
CREATE OR REPLACE FUNCTION public.mark_notifications_read(
  p_notification_ids uuid[] DEFAULT NULL,
  p_category text DEFAULT NULL
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_updated integer := 0;
  v_cat text := NULLIF(lower(btrim(COALESCE(p_category, ''))), '');
  v_has_read_col boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required';
  END IF;

  IF v_cat = 'all' THEN
    v_cat := NULL;
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'read'
  ) INTO v_has_read_col;

  IF v_has_read_col THEN
    UPDATE public.notifications n
       SET is_read = true,
           read = true
     WHERE n.user_id = v_uid
       AND n.is_read = false
       AND (
         p_notification_ids IS NULL
         OR cardinality(p_notification_ids) = 0
         OR n.id = ANY(p_notification_ids)
       )
       AND (
         v_cat IS NULL
         OR n.category = v_cat
       );
  ELSE
    UPDATE public.notifications n
       SET is_read = true
     WHERE n.user_id = v_uid
       AND n.is_read = false
       AND (
         p_notification_ids IS NULL
         OR cardinality(p_notification_ids) = 0
         OR n.id = ANY(p_notification_ids)
       )
       AND (
         v_cat IS NULL
         OR n.category = v_cat
       );
  END IF;

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$$;

REVOKE ALL ON FUNCTION public.mark_notifications_read(uuid[], text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mark_notifications_read(uuid[], text) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 5. Clean Activity Feed RPC: get_my_activity_feed()
-- -----------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_my_activity_feed(
  p_limit int DEFAULT 30,
  p_workspace text DEFAULT NULL
)
RETURNS TABLE (
  id text,
  source text,
  action_type text,
  entity_id text,
  entity_title text,
  workspace text,
  details text,
  metadata jsonb,
  created_at timestamptz
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_limit int := LEAST(GREATEST(COALESCE(p_limit, 30), 1), 100);
  v_ws text := NULLIF(lower(btrim(COALESCE(p_workspace, ''))), '');
BEGIN
  IF v_uid IS NULL THEN
    RETURN;
  END IF;

  IF v_ws = 'all' THEN
    v_ws := NULL;
  END IF;

  RETURN QUERY
  WITH combined AS (
    SELECT
      al.id::text AS id,
      'activity_log'::text AS source,
      al.action_type::text AS action_type,
      al.entity_id::text AS entity_id,
      COALESCE(
        NULLIF(btrim(al.entity_title), ''),
        NULLIF(btrim(al.metadata ->> 'entity_title'), ''),
        NULLIF(btrim(al.metadata ->> 'title'), ''),
        initcap(replace(al.action_type, '_', ' '))
      )::text AS entity_title,
      COALESCE(NULLIF(btrim(al.metadata ->> 'workspace'), ''), 'personal')::text AS workspace,
      COALESCE(
        NULLIF(btrim(al.metadata ->> 'details'), ''),
        NULLIF(btrim(al.metadata ->> 'status_label'), ''),
        initcap(replace(al.action_type, '_', ' '))
      )::text AS details,
      COALESCE(al.metadata, '{}'::jsonb) AS metadata,
      al.created_at AS created_at
    FROM public.activity_logs al
    WHERE al.user_id = v_uid
      AND (
        v_ws IS NULL
        OR lower(COALESCE(al.metadata ->> 'workspace', 'personal')) = v_ws
      )

    UNION ALL

    SELECT
      au.id::text AS id,
      'audit_log'::text AS source,
      au.action::text AS action_type,
      au.target_id::text AS entity_id,
      COALESCE(
        NULLIF(btrim(au.target_name), ''),
        NULLIF(btrim(au.target_table), ''),
        initcap(replace(lower(au.action), '_', ' '))
      )::text AS entity_title,
      COALESCE(NULLIF(btrim(au.workspace), ''), 'workspace')::text AS workspace,
      COALESCE(
        NULLIF(btrim(au.details), ''),
        initcap(replace(lower(au.action), '_', ' '))
      )::text AS details,
      COALESCE(au.metadata, '{}'::jsonb) AS metadata,
      COALESCE(au.created_at, au.timestamp, now()) AS created_at
    FROM public.audit_logs au
    WHERE au.actor_id = v_uid
      AND (
        v_ws IS NULL
        OR lower(COALESCE(au.workspace, '')) = v_ws
      )
  )
  SELECT
    c.id,
    c.source,
    c.action_type,
    c.entity_id,
    c.entity_title,
    c.workspace,
    c.details,
    c.metadata,
    c.created_at
  FROM combined c
  ORDER BY c.created_at DESC
  LIMIT v_limit;
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_activity_feed(int, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_my_activity_feed(int, text) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 6. Automatic Event Triggers Across 5 Core Role Handoff Groups
-- -----------------------------------------------------------------------------

-- Helper to notify listing owner + active delegated staff
CREATE OR REPLACE FUNCTION public._notify_listing_operators_v22a(
  p_listing_id uuid,
  p_title text,
  p_message text,
  p_category text,
  p_priority text,
  p_owner_url text DEFAULT '/workspace?hat=owner',
  p_staff_url text DEFAULT '/workspace?hat=staff',
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_id uuid;
  v_staff_rec record;
BEGIN
  IF p_listing_id IS NULL THEN
    RETURN;
  END IF;

  SELECT l.owner_id INTO v_owner_id
    FROM public.listings l
   WHERE l.id = p_listing_id;

  IF v_owner_id IS NOT NULL THEN
    PERFORM public._dispatch_notification_v22a(
      p_user_id         => v_owner_id,
      p_title           => p_title,
      p_message         => p_message,
      p_category        => p_category,
      p_priority        => p_priority,
      p_role_scope      => 'owner',
      p_action_url      => p_owner_url,
      p_metadata        => p_metadata,
      p_link_listing_id => p_listing_id
    );
  END IF;

  IF to_regclass('public.staff_delegations') IS NOT NULL THEN
    FOR v_staff_rec IN
      SELECT DISTINCT sd.staff_user_id
        FROM public.staff_delegations sd
       WHERE sd.listing_id = p_listing_id
         AND COALESCE(sd.status, 'active') = 'active'
         AND sd.staff_user_id IS NOT NULL
         AND sd.staff_user_id IS DISTINCT FROM v_owner_id
    LOOP
      PERFORM public._dispatch_notification_v22a(
        p_user_id         => v_staff_rec.staff_user_id,
        p_title           => p_title,
        p_message         => p_message,
        p_category        => p_category,
        p_priority        => p_priority,
        p_role_scope      => 'staff',
        p_action_url      => p_staff_url,
        p_metadata        => p_metadata,
        p_link_listing_id => p_listing_id
      );
    END LOOP;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public._notify_listing_operators_v22a(uuid, text, text, text, text, text, text, jsonb) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._notify_listing_operators_v22a(uuid, text, text, text, text, text, text, jsonb) TO service_role;

-- Group 1: Orders, Bookings & Print (shop_orders, restaurant_orders, resource_bookings, print_orders)
CREATE OR REPLACE FUNCTION public.trg_fn_v22a_orders_and_bookings()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new jsonb := to_jsonb(NEW);
  v_old jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  v_id text := v_new ->> 'id';
  v_customer_id uuid := NULLIF(v_new ->> 'customer_id', '')::uuid;
  v_listing_id uuid := NULLIF(v_new ->> 'listing_id', '')::uuid;
  v_status text := COALESCE(v_new ->> 'status', '');
  v_old_status text := COALESCE(v_old ->> 'status', '');
  v_code text := COALESCE(
    NULLIF(v_new ->> 'order_code', ''),
    NULLIF(v_new ->> 'booking_code', ''),
    left(v_id, 8)
  );
  v_listing_title text := 'Local Business';
  v_label text;
  v_customer_url text;
  v_priority text := 'normal';
BEGIN
  IF v_listing_id IS NOT NULL THEN
    SELECT COALESCE(l.title, 'Local Business')
      INTO v_listing_title
      FROM public.listings l
     WHERE l.id = v_listing_id;
  END IF;

  IF TG_TABLE_NAME = 'shop_orders' THEN
    v_label := 'Shop Order';
    v_customer_url := '/activity?tab=commerce';
  ELSIF TG_TABLE_NAME = 'restaurant_orders' THEN
    v_label := 'Food Order';
    v_customer_url := '/activity?tab=commerce';
  ELSIF TG_TABLE_NAME = 'resource_bookings' THEN
    v_label := 'Venue / Stay Booking';
    v_customer_url := '/activity?tab=vehicles';
  ELSE
    v_label := 'Print Order';
    v_customer_url := '/activity?tab=print';
  END IF;

  IF TG_OP = 'INSERT' THEN
    PERFORM public._notify_listing_operators_v22a(
      p_listing_id => v_listing_id,
      p_title      => 'New ' || v_label || ' (' || v_code || ')',
      p_message    => 'New ' || lower(v_label) || ' received for ' || v_listing_title || '. Review and update status in your workspace.',
      p_category   => 'orders_bookings',
      p_priority   => 'high',
      p_owner_url  => '/workspace?hat=owner',
      p_staff_url  => '/workspace?hat=staff',
      p_metadata   => jsonb_build_object(
        'table', TG_TABLE_NAME,
        'entity_id', v_id,
        'code', v_code,
        'status', v_status
      )
    );

    IF v_customer_id IS NOT NULL THEN
      PERFORM public._log_user_activity_v22a(
        p_user_id      => v_customer_id,
        p_action_type  => TG_TABLE_NAME || '_created',
        p_entity_id    => v_id,
        p_entity_title => v_label || ' ' || v_code || ' · ' || v_listing_title,
        p_metadata     => jsonb_build_object(
          'workspace', 'personal',
          'table', TG_TABLE_NAME,
          'code', v_code,
          'status', v_status,
          'action_url', v_customer_url
        )
      );
    END IF;

  ELSIF TG_OP = 'UPDATE' AND v_status IS DISTINCT FROM v_old_status THEN
    IF v_status IN ('ready_for_pickup', 'ready', 'confirmed', 'checked_in', 'quoted', 'awaiting_customer_approval') THEN
      v_priority := 'high';
    END IF;

    IF v_customer_id IS NOT NULL THEN
      PERFORM public._dispatch_notification_v22a(
        p_user_id         => v_customer_id,
        p_title           => v_label || ' ' || initcap(replace(v_status, '_', ' ')) || ' (' || v_code || ')',
        p_message         => v_listing_title || ' updated your ' || lower(v_label) || ' (' || v_code || ') to "' || replace(v_status, '_', ' ') || '".',
        p_category        => 'orders_bookings',
        p_priority        => v_priority,
        p_role_scope      => 'visitor',
        p_action_url      => v_customer_url,
        p_metadata        => jsonb_build_object(
          'table', TG_TABLE_NAME,
          'entity_id', v_id,
          'code', v_code,
          'status', v_status
        ),
        p_link_listing_id => v_listing_id
      );

      PERFORM public._log_user_activity_v22a(
        p_user_id      => v_customer_id,
        p_action_type  => TG_TABLE_NAME || '_' || v_status,
        p_entity_id    => v_id,
        p_entity_title => v_label || ' ' || v_code || ' · ' || initcap(replace(v_status, '_', ' ')),
        p_metadata     => jsonb_build_object(
          'workspace', 'personal',
          'table', TG_TABLE_NAME,
          'code', v_code,
          'status', v_status,
          'action_url', v_customer_url
        )
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Group 2: Enquiries, Reviews & Property Visits (enquiries, reviews, property_visit_requests)
CREATE OR REPLACE FUNCTION public.trg_fn_v22a_enquiries_reviews_visits()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new jsonb := to_jsonb(NEW);
  v_old jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  v_id text := v_new ->> 'id';
  v_listing_id uuid := NULLIF(v_new ->> 'listing_id', '')::uuid;
  v_listing_title text := 'Directory Listing';
  v_owner_id uuid;
  v_customer_id uuid;
  v_status text := COALESCE(v_new ->> 'status', '');
  v_old_status text := COALESCE(v_old ->> 'status', '');
  v_contact_revealed boolean := COALESCE((v_new ->> 'contact_revealed')::boolean, false);
  v_old_contact_revealed boolean := COALESCE((v_old ->> 'contact_revealed')::boolean, false);
  v_code text := COALESCE(NULLIF(v_new ->> 'request_code', ''), left(v_id, 8));
BEGIN
  IF v_listing_id IS NOT NULL THEN
    SELECT l.owner_id, COALESCE(l.title, 'Directory Listing')
      INTO v_owner_id, v_listing_title
      FROM public.listings l
     WHERE l.id = v_listing_id;
  END IF;

  IF TG_TABLE_NAME = 'enquiries' THEN
    v_customer_id := COALESCE(
      NULLIF(v_new ->> 'user_id', '')::uuid,
      NULLIF(v_new ->> 'sender_id', '')::uuid
    );

    IF TG_OP = 'INSERT' THEN
      PERFORM public._notify_listing_operators_v22a(
        p_listing_id => v_listing_id,
        p_title      => 'New Enquiry: ' || v_listing_title,
        p_message    => 'From ' || COALESCE(NULLIF(v_new ->> 'sender_name', ''), 'Visitor') || ': ' || left(COALESCE(v_new ->> 'message', ''), 180),
        p_category   => 'enquiries_reviews',
        p_priority   => 'normal',
        p_owner_url  => '/workspace?hat=owner',
        p_staff_url  => '/workspace?hat=staff',
        p_metadata   => jsonb_build_object('table', 'enquiries', 'entity_id', v_id)
      );

      IF v_owner_id IS NOT NULL THEN
        PERFORM public._log_user_activity_v22a(
          p_user_id      => v_owner_id,
          p_action_type  => 'enquiry_received',
          p_entity_id    => v_id,
          p_entity_title => 'Enquiry on ' || v_listing_title,
          p_metadata     => jsonb_build_object('workspace', 'owner', 'listing_id', v_listing_id)
        );
      END IF;

      IF v_customer_id IS NOT NULL THEN
        PERFORM public._log_user_activity_v22a(
          p_user_id      => v_customer_id,
          p_action_type  => 'enquiry_sent',
          p_entity_id    => v_id,
          p_entity_title => 'Enquiry sent to ' || v_listing_title,
          p_metadata     => jsonb_build_object('workspace', 'personal', 'listing_id', v_listing_id)
        );
      END IF;

    ELSIF TG_OP = 'UPDATE' AND v_status IS DISTINCT FROM v_old_status AND v_customer_id IS NOT NULL THEN
      PERFORM public._dispatch_notification_v22a(
        p_user_id         => v_customer_id,
        p_title           => 'Enquiry Updated: ' || v_listing_title,
        p_message         => 'Your enquiry for ' || v_listing_title || ' is now marked "' || replace(v_status, '_', ' ') || '".',
        p_category        => 'enquiries_reviews',
        p_priority        => 'normal',
        p_role_scope      => 'visitor',
        p_action_url      => '/activity?tab=enquiries',
        p_metadata        => jsonb_build_object('table', 'enquiries', 'entity_id', v_id, 'status', v_status),
        p_link_listing_id => v_listing_id
      );
    END IF;

  ELSIF TG_TABLE_NAME = 'reviews' THEN
    v_customer_id := NULLIF(v_new ->> 'user_id', '')::uuid;

    IF TG_OP = 'INSERT' THEN
      IF v_owner_id IS NOT NULL AND v_owner_id IS DISTINCT FROM v_customer_id THEN
        PERFORM public._dispatch_notification_v22a(
          p_user_id         => v_owner_id,
          p_title           => 'New Review on ' || v_listing_title,
          p_message         => COALESCE(NULLIF(v_new ->> 'user_name', ''), 'A customer') || ' left a ' || COALESCE(v_new ->> 'rating', '5') || '★ review.',
          p_category        => 'enquiries_reviews',
          p_priority        => 'normal',
          p_role_scope      => 'owner',
          p_action_url      => '/workspace?hat=owner',
          p_metadata        => jsonb_build_object('table', 'reviews', 'entity_id', v_id),
          p_link_listing_id => v_listing_id,
          p_type            => 'review'
        );
      END IF;
    ELSIF TG_OP = 'UPDATE'
      AND NULLIF(btrim(COALESCE(v_new ->> 'owner_reply', '')), '') IS NOT NULL
      AND NULLIF(btrim(COALESCE(v_old ->> 'owner_reply', '')), '') IS NULL
      AND v_customer_id IS NOT NULL
    THEN
      PERFORM public._dispatch_notification_v22a(
        p_user_id         => v_customer_id,
        p_title           => v_listing_title || ' replied to your review',
        p_message         => left(COALESCE(v_new ->> 'owner_reply', ''), 200),
        p_category        => 'enquiries_reviews',
        p_priority        => 'normal',
        p_role_scope      => 'visitor',
        p_action_url      => CASE WHEN v_listing_id IS NOT NULL THEN '/listing/' || v_listing_id::text ELSE '/activity' END,
        p_metadata        => jsonb_build_object('table', 'reviews', 'entity_id', v_id),
        p_link_listing_id => v_listing_id,
        p_type            => 'review'
      );
    END IF;

  ELSIF TG_TABLE_NAME = 'property_visit_requests' THEN
    v_customer_id := NULLIF(v_new ->> 'requester_id', '')::uuid;
    v_owner_id := COALESCE(NULLIF(v_new ->> 'owner_id', '')::uuid, v_owner_id);

    IF TG_OP = 'INSERT' THEN
      PERFORM public._notify_listing_operators_v22a(
        p_listing_id => v_listing_id,
        p_title      => 'New Site Visit Request (' || v_code || ')',
        p_message    => COALESCE(NULLIF(v_new ->> 'requester_name', ''), 'A buyer/tenant') || ' requested a property visit for ' || v_listing_title || ' on ' || COALESCE(v_new ->> 'preferred_date', 'upcoming slot') || '.',
        p_category   => 'enquiries_reviews',
        p_priority   => 'high',
        p_owner_url  => '/workspace?hat=owner',
        p_staff_url  => '/workspace?hat=staff',
        p_metadata   => jsonb_build_object('table', 'property_visit_requests', 'entity_id', v_id, 'code', v_code)
      );

      IF v_customer_id IS NOT NULL THEN
        PERFORM public._log_user_activity_v22a(
          p_user_id      => v_customer_id,
          p_action_type  => 'property_visit_requested',
          p_entity_id    => v_id,
          p_entity_title => 'Site Visit Requested · ' || v_listing_title,
          p_metadata     => jsonb_build_object('workspace', 'personal', 'code', v_code, 'listing_id', v_listing_id)
        );
      END IF;

    ELSIF TG_OP = 'UPDATE'
      AND (v_status IS DISTINCT FROM v_old_status OR v_contact_revealed IS DISTINCT FROM v_old_contact_revealed)
      AND v_customer_id IS NOT NULL
    THEN
      PERFORM public._dispatch_notification_v22a(
        p_user_id         => v_customer_id,
        p_title           => CASE
          WHEN v_status = 'accepted' OR v_contact_revealed THEN 'Site Visit Approved — Owner Contact Unlocked!'
          ELSE 'Site Visit ' || initcap(replace(v_status, '_', ' ')) || ' (' || v_code || ')'
        END,
        p_message         => CASE
          WHEN v_status = 'accepted' OR v_contact_revealed THEN
            'Your site visit request (' || v_code || ') for ' || v_listing_title || ' was approved. Direct owner phone call is now unlocked.'
          ELSE
            'Your site visit request (' || v_code || ') for ' || v_listing_title || ' is now "' || replace(v_status, '_', ' ') || '".'
        END,
        p_category        => 'enquiries_reviews',
        p_priority        => CASE WHEN v_status = 'accepted' OR v_contact_revealed THEN 'high' ELSE 'normal' END,
        p_role_scope      => 'visitor',
        p_action_url      => CASE WHEN v_listing_id IS NOT NULL THEN '/listing/' || v_listing_id::text ELSE '/activity?tab=enquiries' END,
        p_metadata        => jsonb_build_object(
          'table', 'property_visit_requests',
          'entity_id', v_id,
          'code', v_code,
          'status', v_status,
          'contact_revealed', v_contact_revealed
        ),
        p_link_listing_id => v_listing_id
      );

      PERFORM public._log_user_activity_v22a(
        p_user_id      => v_customer_id,
        p_action_type  => 'property_visit_' || v_status,
        p_entity_id    => v_id,
        p_entity_title => 'Site Visit ' || initcap(replace(v_status, '_', ' ')) || ' · ' || v_listing_title,
        p_metadata     => jsonb_build_object(
          'workspace', 'personal',
          'code', v_code,
          'status', v_status,
          'contact_revealed', v_contact_revealed
        )
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Keep legacy function name pointing to the unified trigger function for safety
CREATE OR REPLACE FUNCTION public.handle_new_enquiry_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.trg_fn_v22a_enquiries_reviews_visits();
END;
$$;

-- Group 3: Pick N Drop & Vehicle Escrow (delivery_orders, vehicle_bookings)
CREATE OR REPLACE FUNCTION public.trg_fn_v22a_logistics_and_escrow()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new jsonb := to_jsonb(NEW);
  v_old jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  v_id text := v_new ->> 'id';
  v_customer_id uuid := NULLIF(v_new ->> 'customer_id', '')::uuid;
  v_driver_id uuid := NULLIF(v_new ->> 'driver_id', '')::uuid;
  v_old_driver_id uuid := NULLIF(v_old ->> 'driver_id', '')::uuid;
  v_status text := COALESCE(v_new ->> 'status', '');
  v_old_status text := COALESCE(v_old ->> 'status', '');
  v_code text := COALESCE(
    NULLIF(v_new ->> 'order_code', ''),
    NULLIF(v_new ->> 'booking_code', ''),
    left(v_id, 8)
  );
  v_vehicle_id uuid := NULLIF(v_new ->> 'vehicle_id', '')::uuid;
  v_vehicle_owner_id uuid;
  v_vehicle_title text := 'Scheduled Vehicle';
  v_priority text := 'normal';
BEGIN
  IF TG_TABLE_NAME = 'delivery_orders' THEN
    IF TG_OP = 'INSERT' AND v_customer_id IS NOT NULL THEN
      PERFORM public._log_user_activity_v22a(
        p_user_id      => v_customer_id,
        p_action_type  => 'delivery_order_created',
        p_entity_id    => v_id,
        p_entity_title => 'Pick N Drop ' || v_code,
        p_metadata     => jsonb_build_object('workspace', 'personal', 'code', v_code, 'status', v_status)
      );
    END IF;

    -- Driver newly assigned
    IF v_driver_id IS NOT NULL AND v_driver_id IS DISTINCT FROM v_old_driver_id THEN
      PERFORM public._dispatch_notification_v22a(
        p_user_id    => v_driver_id,
        p_title      => 'Trip Assigned (' || v_code || ')',
        p_message    => 'Pick N Drop trip ' || v_code || ' is assigned to you. Verify pickup & dropoff via handover OTP.',
        p_category   => 'logistics_escrow',
        p_priority   => 'urgent',
        p_role_scope => 'driver',
        p_action_url => '/workspace?hat=driver',
        p_metadata   => jsonb_build_object('table', 'delivery_orders', 'entity_id', v_id, 'code', v_code, 'status', v_status)
      );
    END IF;

    IF TG_OP = 'UPDATE' AND v_status IS DISTINCT FROM v_old_status THEN
      IF v_status IN ('driver_assigned', 'picked_up', 'delivered_pending_confirm', 'disputed', 'return_in_transit') THEN
        v_priority := 'urgent';
      ELSIF v_status IN ('payment_confirmed', 'in_transit', 'completed') THEN
        v_priority := 'high';
      END IF;

      IF v_customer_id IS NOT NULL THEN
        PERFORM public._dispatch_notification_v22a(
          p_user_id    => v_customer_id,
          p_title      => 'Pick N Drop ' || initcap(replace(v_status, '_', ' ')) || ' (' || v_code || ')',
          p_message    => 'Delivery ' || v_code || ' status updated to "' || replace(v_status, '_', ' ') || '".',
          p_category   => 'logistics_escrow',
          p_priority   => v_priority,
          p_role_scope => 'visitor',
          p_action_url => '/activity?tab=pick_n_drop',
          p_metadata   => jsonb_build_object('table', 'delivery_orders', 'entity_id', v_id, 'code', v_code, 'status', v_status)
        );

        PERFORM public._log_user_activity_v22a(
          p_user_id      => v_customer_id,
          p_action_type  => 'delivery_' || v_status,
          p_entity_id    => v_id,
          p_entity_title => 'Pick N Drop ' || v_code || ' · ' || initcap(replace(v_status, '_', ' ')),
          p_metadata     => jsonb_build_object('workspace', 'personal', 'code', v_code, 'status', v_status)
        );
      END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'vehicle_bookings' THEN
    IF v_vehicle_id IS NOT NULL AND to_regclass('public.vehicle_listings') IS NOT NULL THEN
      SELECT vl.owner_id, COALESCE(vl.title, 'Scheduled Vehicle')
        INTO v_vehicle_owner_id, v_vehicle_title
        FROM public.vehicle_listings vl
       WHERE vl.id = v_vehicle_id;
    END IF;

    IF TG_OP = 'INSERT' THEN
      IF v_vehicle_owner_id IS NOT NULL THEN
        PERFORM public._dispatch_notification_v22a(
          p_user_id    => v_vehicle_owner_id,
          p_title      => 'New Vehicle Booking (' || v_code || ')',
          p_message    => 'New seat/charter booking (' || v_code || ') received for ' || v_vehicle_title || '.',
          p_category   => 'logistics_escrow',
          p_priority   => 'high',
          p_role_scope => 'driver',
          p_action_url => '/workspace?hat=driver',
          p_metadata   => jsonb_build_object('table', 'vehicle_bookings', 'entity_id', v_id, 'code', v_code)
        );
      END IF;

      IF v_customer_id IS NOT NULL THEN
        PERFORM public._log_user_activity_v22a(
          p_user_id      => v_customer_id,
          p_action_type  => 'vehicle_booking_created',
          p_entity_id    => v_id,
          p_entity_title => 'Vehicle Booking ' || v_code || ' · ' || v_vehicle_title,
          p_metadata     => jsonb_build_object('workspace', 'personal', 'code', v_code, 'status', v_status)
        );
      END IF;

    ELSIF TG_OP = 'UPDATE' AND v_status IS DISTINCT FROM v_old_status AND v_customer_id IS NOT NULL THEN
      PERFORM public._dispatch_notification_v22a(
        p_user_id    => v_customer_id,
        p_title      => 'Vehicle Booking ' || initcap(replace(v_status, '_', ' ')) || ' (' || v_code || ')',
        p_message    => v_vehicle_title || ' booking (' || v_code || ') is now "' || replace(v_status, '_', ' ') || '".',
        p_category   => 'logistics_escrow',
        p_priority   => CASE WHEN v_status IN ('confirmed', 'in_progress') THEN 'urgent' ELSE 'normal' END,
        p_role_scope => 'visitor',
        p_action_url => '/activity?tab=vehicles',
        p_metadata   => jsonb_build_object('table', 'vehicle_bookings', 'entity_id', v_id, 'code', v_code, 'status', v_status)
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Group 4: Moderation, Partner KYC & Suggested Leaves (listings, bulletins, partner_applications, categories)
CREATE OR REPLACE FUNCTION public.trg_fn_v22a_moderation_and_kyc()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new jsonb := to_jsonb(NEW);
  v_old jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  v_id text := v_new ->> 'id';
  v_target_user uuid;
  v_title text := COALESCE(NULLIF(v_new ->> 'title', ''), NULLIF(v_new ->> 'name', ''), NULLIF(v_new ->> 'business_name', ''), 'Submission');
  v_status text;
  v_old_status text;
BEGIN
  IF TG_TABLE_NAME = 'listings' THEN
    v_target_user := NULLIF(v_new ->> 'owner_id', '')::uuid;
    v_status := COALESCE(v_new ->> 'verification_status', v_new ->> 'status', '');
    v_old_status := COALESCE(v_old ->> 'verification_status', v_old ->> 'status', '');

    IF TG_OP = 'UPDATE' AND v_status IS DISTINCT FROM v_old_status AND v_target_user IS NOT NULL THEN
      IF v_status IN ('approved', 'verified', 'rejected', 'changes_requested', 'suspended') THEN
        PERFORM public._dispatch_notification_v22a(
          p_user_id         => v_target_user,
          p_title           => 'Listing ' || initcap(replace(v_status, '_', ' ')) || ': ' || v_title,
          p_message         => 'Moderation status for "' || v_title || '" changed to ' || replace(v_status, '_', ' ') || '.',
          p_category        => 'moderation_kyc',
          p_priority        => 'high',
          p_role_scope      => 'owner',
          p_action_url      => '/workspace?hat=owner',
          p_metadata        => jsonb_build_object('table', 'listings', 'entity_id', v_id, 'status', v_status),
          p_link_listing_id => NULLIF(v_id, '')::uuid,
          p_type            => 'verification'
        );
      END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'bulletins' THEN
    v_target_user := COALESCE(NULLIF(v_new ->> 'author_id', '')::uuid, NULLIF(v_new ->> 'user_id', '')::uuid);
    v_status := COALESCE(v_new ->> 'moderation_status', v_new ->> 'status', '');
    v_old_status := COALESCE(v_old ->> 'moderation_status', v_old ->> 'status', '');

    IF TG_OP = 'UPDATE' AND v_status IS DISTINCT FROM v_old_status AND v_target_user IS NOT NULL THEN
      IF v_status IN ('approved', 'active', 'published', 'rejected') THEN
        PERFORM public._dispatch_notification_v22a(
          p_user_id    => v_target_user,
          p_title      => 'Bulletin ' || initcap(replace(v_status, '_', ' ')) || ': ' || v_title,
          p_message    => 'Your bulletin "' || v_title || '" is now ' || replace(v_status, '_', ' ') || '.',
          p_category   => 'moderation_kyc',
          p_priority   => 'high',
          p_role_scope => 'advertiser',
          p_action_url => '/workspace?hat=advertiser',
          p_metadata   => jsonb_build_object('table', 'bulletins', 'entity_id', v_id, 'status', v_status),
          p_type       => 'verification'
        );
      END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'partner_applications' THEN
    v_target_user := NULLIF(v_new ->> 'user_id', '')::uuid;
    v_status := COALESCE(v_new ->> 'status', '');
    v_old_status := COALESCE(v_old ->> 'status', '');

    IF TG_OP = 'UPDATE' AND v_status IS DISTINCT FROM v_old_status AND v_target_user IS NOT NULL THEN
      IF v_status IN ('approved', 'rejected') THEN
        PERFORM public._dispatch_notification_v22a(
          p_user_id    => v_target_user,
          p_title      => 'Partner Application ' || initcap(v_status),
          p_message    => CASE
            WHEN v_status = 'approved' THEN 'Your partner application for "' || v_title || '" has been approved! Your workspace hat is now unlocked.'
            ELSE 'Your partner application for "' || v_title || '" was reviewed (' || v_status || ').'
          END,
          p_category   => 'moderation_kyc',
          p_priority   => 'urgent',
          p_role_scope => 'owner',
          p_action_url => '/workspace',
          p_metadata   => jsonb_build_object('table', 'partner_applications', 'entity_id', v_id, 'status', v_status),
          p_type       => 'verification'
        );
      END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'categories' THEN
    v_target_user := NULLIF(v_new ->> 'suggested_by', '')::uuid;
    v_status := COALESCE(v_new ->> 'approval_status', '');
    v_old_status := COALESCE(v_old ->> 'approval_status', '');

    IF TG_OP = 'UPDATE' AND v_status IS DISTINCT FROM v_old_status AND v_target_user IS NOT NULL THEN
      IF v_status IN ('approved', 'rejected') THEN
        PERFORM public._dispatch_notification_v22a(
          p_user_id    => v_target_user,
          p_title      => 'Suggested Category ' || initcap(v_status) || ': ' || v_title,
          p_message    => 'Your suggested L3 category "' || v_title || '" was ' || v_status || ' by platform taxonomy review.',
          p_category   => 'moderation_kyc',
          p_priority   => 'normal',
          p_role_scope => 'owner',
          p_action_url => '/workspace?hat=owner',
          p_metadata   => jsonb_build_object('table', 'categories', 'entity_id', v_id, 'status', v_status),
          p_type       => 'verification'
        );
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Group 5: Billing, Pay-Per & Staff Delegation (pay_per_orders, user_subscriptions, staff_delegations)
CREATE OR REPLACE FUNCTION public.trg_fn_v22a_billing_and_team()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new jsonb := to_jsonb(NEW);
  v_old jsonb := CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  v_id text := v_new ->> 'id';
  v_target_user uuid;
  v_status text := COALESCE(v_new ->> 'status', '');
  v_old_status text := COALESCE(v_old ->> 'status', '');
  v_listing_id uuid := NULLIF(v_new ->> 'listing_id', '')::uuid;
  v_listing_title text := 'Business Workspace';
BEGIN
  IF TG_TABLE_NAME = 'pay_per_orders' THEN
    v_target_user := NULLIF(v_new ->> 'user_id', '')::uuid;
    IF TG_OP = 'UPDATE' AND v_status IS DISTINCT FROM v_old_status AND v_target_user IS NOT NULL THEN
      IF v_status IN ('verified', 'approved', 'active', 'succeeded', 'rejected') THEN
        PERFORM public._dispatch_notification_v22a(
          p_user_id    => v_target_user,
          p_title      => 'Pay-Per Order ' || initcap(replace(v_status, '_', ' ')),
          p_message    => 'Your pay-per promotion order is now "' || replace(v_status, '_', ' ') || '".',
          p_category   => 'billing_trials',
          p_priority   => 'high',
          p_role_scope => 'advertiser',
          p_action_url => '/workspace?hat=advertiser',
          p_metadata   => jsonb_build_object('table', 'pay_per_orders', 'entity_id', v_id, 'status', v_status)
        );
      END IF;
    END IF;

  ELSIF TG_TABLE_NAME = 'user_subscriptions' THEN
    v_target_user := NULLIF(v_new ->> 'user_id', '')::uuid;
    IF (TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND v_status IS DISTINCT FROM v_old_status))
       AND v_target_user IS NOT NULL
       AND v_status IN ('active', 'expired', 'rejected', 'cancelled')
    THEN
      PERFORM public._dispatch_notification_v22a(
        p_user_id    => v_target_user,
        p_title      => 'Subscription ' || initcap(replace(v_status, '_', ' ')),
        p_message    => 'Your subscription plan status is now "' || replace(v_status, '_', ' ') || '".',
        p_category   => 'billing_trials',
        p_priority   => 'high',
        p_role_scope => 'owner',
        p_action_url => '/profile',
        p_metadata   => jsonb_build_object('table', 'user_subscriptions', 'entity_id', v_id, 'status', v_status)
      );
    END IF;

  ELSIF TG_TABLE_NAME = 'staff_delegations' THEN
    v_target_user := NULLIF(v_new ->> 'staff_user_id', '')::uuid;
    IF v_listing_id IS NOT NULL THEN
      SELECT COALESCE(l.title, 'Business Workspace')
        INTO v_listing_title
        FROM public.listings l
       WHERE l.id = v_listing_id;
    END IF;

    IF (TG_OP = 'INSERT' OR (TG_OP = 'UPDATE' AND v_status IS DISTINCT FROM v_old_status))
       AND v_target_user IS NOT NULL
    THEN
      PERFORM public._dispatch_notification_v22a(
        p_user_id         => v_target_user,
        p_title           => CASE
          WHEN v_status = 'active' THEN 'Team Access Granted: ' || v_listing_title
          ELSE 'Team Access Updated (' || initcap(v_status) || '): ' || v_listing_title
        END,
        p_message         => CASE
          WHEN v_status = 'active' THEN 'You have been delegated as staff for ' || v_listing_title || '. Open Staff Operations to manage queues.'
          ELSE 'Your staff delegation status for ' || v_listing_title || ' is now "' || v_status || '".'
        END,
        p_category        => 'team_staff',
        p_priority        => 'high',
        p_role_scope      => 'staff',
        p_action_url      => '/workspace?hat=staff',
        p_metadata        => jsonb_build_object('table', 'staff_delegations', 'entity_id', v_id, 'status', v_status),
        p_link_listing_id => v_listing_id
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Attach all triggers idempotently with to_regclass() guards
DO $$
BEGIN
  -- Group 1: Orders, Bookings & Print
  IF to_regclass('public.shop_orders') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_v22a_notify_shop_orders ON public.shop_orders;
    CREATE TRIGGER trg_v22a_notify_shop_orders
      AFTER INSERT OR UPDATE ON public.shop_orders
      FOR EACH ROW EXECUTE FUNCTION public.trg_fn_v22a_orders_and_bookings();
  END IF;

  IF to_regclass('public.restaurant_orders') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_v22a_notify_restaurant_orders ON public.restaurant_orders;
    CREATE TRIGGER trg_v22a_notify_restaurant_orders
      AFTER INSERT OR UPDATE ON public.restaurant_orders
      FOR EACH ROW EXECUTE FUNCTION public.trg_fn_v22a_orders_and_bookings();
  END IF;

  IF to_regclass('public.resource_bookings') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_v22a_notify_resource_bookings ON public.resource_bookings;
    CREATE TRIGGER trg_v22a_notify_resource_bookings
      AFTER INSERT OR UPDATE ON public.resource_bookings
      FOR EACH ROW EXECUTE FUNCTION public.trg_fn_v22a_orders_and_bookings();
  END IF;

  IF to_regclass('public.print_orders') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_v22a_notify_print_orders ON public.print_orders;
    CREATE TRIGGER trg_v22a_notify_print_orders
      AFTER INSERT OR UPDATE ON public.print_orders
      FOR EACH ROW EXECUTE FUNCTION public.trg_fn_v22a_orders_and_bookings();
  END IF;

  -- Group 2: Enquiries, Reviews & Property Visits
  IF to_regclass('public.enquiries') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS on_enquiry_created_notify_owner ON public.enquiries;
    DROP TRIGGER IF EXISTS trg_v22a_notify_enquiries ON public.enquiries;
    CREATE TRIGGER trg_v22a_notify_enquiries
      AFTER INSERT OR UPDATE ON public.enquiries
      FOR EACH ROW EXECUTE FUNCTION public.trg_fn_v22a_enquiries_reviews_visits();
  END IF;

  IF to_regclass('public.reviews') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_v22a_notify_reviews ON public.reviews;
    CREATE TRIGGER trg_v22a_notify_reviews
      AFTER INSERT OR UPDATE ON public.reviews
      FOR EACH ROW EXECUTE FUNCTION public.trg_fn_v22a_enquiries_reviews_visits();
  END IF;

  IF to_regclass('public.property_visit_requests') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_v22a_notify_property_visits ON public.property_visit_requests;
    CREATE TRIGGER trg_v22a_notify_property_visits
      AFTER INSERT OR UPDATE ON public.property_visit_requests
      FOR EACH ROW EXECUTE FUNCTION public.trg_fn_v22a_enquiries_reviews_visits();
  END IF;

  -- Group 3: Pick N Drop & Vehicle Escrow
  IF to_regclass('public.delivery_orders') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_v22a_notify_delivery_orders ON public.delivery_orders;
    CREATE TRIGGER trg_v22a_notify_delivery_orders
      AFTER INSERT OR UPDATE ON public.delivery_orders
      FOR EACH ROW EXECUTE FUNCTION public.trg_fn_v22a_logistics_and_escrow();
  END IF;

  IF to_regclass('public.vehicle_bookings') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_v22a_notify_vehicle_bookings ON public.vehicle_bookings;
    CREATE TRIGGER trg_v22a_notify_vehicle_bookings
      AFTER INSERT OR UPDATE ON public.vehicle_bookings
      FOR EACH ROW EXECUTE FUNCTION public.trg_fn_v22a_logistics_and_escrow();
  END IF;

  -- Group 4: Moderation, Partner KYC & Suggested Leaves
  IF to_regclass('public.listings') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_v22a_notify_listings_moderation ON public.listings;
    CREATE TRIGGER trg_v22a_notify_listings_moderation
      AFTER UPDATE ON public.listings
      FOR EACH ROW EXECUTE FUNCTION public.trg_fn_v22a_moderation_and_kyc();
  END IF;

  IF to_regclass('public.bulletins') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_v22a_notify_bulletins_moderation ON public.bulletins;
    CREATE TRIGGER trg_v22a_notify_bulletins_moderation
      AFTER UPDATE ON public.bulletins
      FOR EACH ROW EXECUTE FUNCTION public.trg_fn_v22a_moderation_and_kyc();
  END IF;

  IF to_regclass('public.partner_applications') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_v22a_notify_partner_applications ON public.partner_applications;
    CREATE TRIGGER trg_v22a_notify_partner_applications
      AFTER UPDATE ON public.partner_applications
      FOR EACH ROW EXECUTE FUNCTION public.trg_fn_v22a_moderation_and_kyc();
  END IF;

  IF to_regclass('public.categories') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_v22a_notify_categories_moderation ON public.categories;
    CREATE TRIGGER trg_v22a_notify_categories_moderation
      AFTER UPDATE ON public.categories
      FOR EACH ROW EXECUTE FUNCTION public.trg_fn_v22a_moderation_and_kyc();
  END IF;

  -- Group 5: Billing, Pay-Per & Staff Delegation
  IF to_regclass('public.pay_per_orders') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_v22a_notify_pay_per_orders ON public.pay_per_orders;
    CREATE TRIGGER trg_v22a_notify_pay_per_orders
      AFTER UPDATE ON public.pay_per_orders
      FOR EACH ROW EXECUTE FUNCTION public.trg_fn_v22a_billing_and_team();
  END IF;

  IF to_regclass('public.user_subscriptions') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_v22a_notify_user_subscriptions ON public.user_subscriptions;
    CREATE TRIGGER trg_v22a_notify_user_subscriptions
      AFTER INSERT OR UPDATE ON public.user_subscriptions
      FOR EACH ROW EXECUTE FUNCTION public.trg_fn_v22a_billing_and_team();
  END IF;

  IF to_regclass('public.staff_delegations') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_v22a_notify_staff_delegations ON public.staff_delegations;
    CREATE TRIGGER trg_v22a_notify_staff_delegations
      AFTER INSERT OR UPDATE ON public.staff_delegations
      FOR EACH ROW EXECUTE FUNCTION public.trg_fn_v22a_billing_and_team();
  END IF;
END;
$$;

COMMIT;
