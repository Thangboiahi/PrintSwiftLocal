-- =============================================================================
-- Migration: 20261124_pass_v15a_superadmin_foundation.sql
-- Purpose: Sprint 1 (v15a) Superadmin Console Foundation
--   1. Immutable `super_admin` guardrail trigger on `public.profiles` +
--      hardened `public.superadmin_set_user_role(...)` RPC.
--   2. Immutable append-only `public.audit_logs` table (upgraded cleanly from
--      00005), admin/super_admin SELECT-only RLS, SECURITY DEFINER writer, and
--      automatic governance audit triggers.
--   3. `icon_key` & `accent_color` columns + sync trigger + super_admin write
--      RLS on canonical nested `public.categories`.
--   4. `public.homepage_items` and `public.popular_localities` config tables
--      with public enabled-read / super_admin-write RLS + Churachandpur seeds.
-- =============================================================================

BEGIN;

-- -----------------------------------------------------------------------------
-- 1. IMMUTABLE `public.audit_logs` TABLE (Create or Idempotently Upgrade)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  actor_id uuid,
  actor_role text,
  action text NOT NULL,
  target_table text,
  target_id text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Upgrade legacy `public.audit_logs` from 00005_sync_frontend_fields.sql safely
ALTER TABLE public.audit_logs
  ADD COLUMN IF NOT EXISTS actor_role text,
  ADD COLUMN IF NOT EXISTS target_table text,
  ADD COLUMN IF NOT EXISTS target_id text,
  ADD COLUMN IF NOT EXISTS metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

-- Backfill `created_at` from legacy `timestamp` column if present
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'audit_logs'
      AND column_name = 'timestamp'
  ) THEN
    EXECUTE '
      UPDATE public.audit_logs
      SET created_at = COALESCE(created_at, "timestamp", now())
      WHERE "timestamp" IS NOT NULL
    ';
  END IF;
END;
$$;

-- Safely migrate legacy `actor_id text` -> `actor_id uuid` if needed
DO $$
DECLARE
  v_actor_type text;
BEGIN
  SELECT data_type
    INTO v_actor_type
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'audit_logs'
    AND column_name = 'actor_id';

  IF v_actor_type IS NULL THEN
    ALTER TABLE public.audit_logs ADD COLUMN actor_id uuid;
  ELSIF v_actor_type <> 'uuid' THEN
    ALTER TABLE public.audit_logs
      ALTER COLUMN actor_id TYPE uuid
      USING (
        CASE
          WHEN actor_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            THEN actor_id::uuid
          ELSE NULL
        END
      );
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at_desc
  ON public.audit_logs (created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_target_table_created
  ON public.audit_logs (target_table, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_audit_logs_action
  ON public.audit_logs (action);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Drop any legacy or accidental policies on public.audit_logs
DO $$
DECLARE
  v_pol record;
BEGIN
  FOR v_pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'public'
      AND tablename = 'audit_logs'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.audit_logs;', v_pol.policyname);
  END LOOP;
END;
$$;

-- SELECT permitted ONLY to admin and super_admin.
-- ZERO INSERT, UPDATE, or DELETE policies for authenticated/anon roles.
CREATE POLICY audit_logs_admin_select
  ON public.audit_logs
  FOR SELECT
  TO authenticated
  USING (public.is_pnd_admin(auth.uid()));

-- Defense-in-depth immutability trigger: block UPDATE and DELETE on audit_logs
CREATE OR REPLACE FUNCTION public.guard_audit_logs_immutable()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'Forbidden: public.audit_logs is strictly immutable (append-only). % is not permitted.',
    TG_OP
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_logs_immutable ON public.audit_logs;
CREATE TRIGGER trg_audit_logs_immutable
  BEFORE UPDATE OR DELETE ON public.audit_logs
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_audit_logs_immutable();

-- SECURITY DEFINER append helper (triggers & privileged RPCs only)
CREATE OR REPLACE FUNCTION public.write_audit_log(
  p_actor_id uuid,
  p_actor_role text,
  p_action text,
  p_target_table text,
  p_target_id text,
  p_metadata jsonb DEFAULT '{}'::jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_log_id uuid;
  v_resolved_actor_id uuid := COALESCE(p_actor_id, auth.uid());
  v_resolved_role text := NULLIF(trim(COALESCE(p_actor_role, '')), '');
BEGIN
  IF v_resolved_role IS NULL AND v_resolved_actor_id IS NOT NULL THEN
    SELECT p.role INTO v_resolved_role
    FROM public.profiles p
    WHERE p.id = v_resolved_actor_id;
  END IF;

  INSERT INTO public.audit_logs (
    actor_id,
    actor_role,
    action,
    target_table,
    target_id,
    metadata,
    created_at
  )
  VALUES (
    v_resolved_actor_id,
    COALESCE(v_resolved_role, 'system'),
    COALESCE(NULLIF(trim(p_action), ''), 'unknown_action'),
    p_target_table,
    p_target_id,
    COALESCE(p_metadata, '{}'::jsonb),
    now()
  )
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

REVOKE ALL ON FUNCTION public.write_audit_log(uuid, text, text, text, text, jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.write_audit_log(uuid, text, text, text, text, jsonb) FROM anon;
REVOKE ALL ON FUNCTION public.write_audit_log(uuid, text, text, text, text, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.write_audit_log(uuid, text, text, text, text, jsonb) TO service_role;

-- -----------------------------------------------------------------------------
-- 2. IMMUTABLE `super_admin` GUARDRAIL ON `public.profiles`
-- -----------------------------------------------------------------------------
-- Blocks ANY authenticated or anon session (even via SECURITY DEFINER RPCs)
-- from granting, revoking, mutating, or deleting the `super_admin` role.
-- Changes to `super_admin` are only possible via direct SQL (postgres/migration)
-- or service_role bootstrap.
CREATE OR REPLACE FUNCTION public.guard_immutable_superadmin()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_jwt_role text := lower(
    COALESCE(
      NULLIF(current_setting('request.jwt.claim.role', true), ''),
      NULLIF(current_setting('role', true), ''),
      ''
    )
  );
  v_is_client_session boolean := v_jwt_role IN ('authenticated', 'anon');
  v_old_role text := CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN lower(trim(COALESCE(OLD.role, ''))) ELSE '' END;
  v_new_role text := CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN lower(trim(COALESCE(NEW.role, ''))) ELSE '' END;
BEGIN
  IF NOT v_is_client_session THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF v_new_role IN ('super_admin', 'superadmin') THEN
      RAISE EXCEPTION 'Forbidden: super_admin role cannot be granted from authenticated or anon sessions.'
        USING ERRCODE = '42501';
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF v_old_role IN ('super_admin', 'superadmin')
       AND v_new_role IS DISTINCT FROM v_old_role THEN
      RAISE EXCEPTION 'Forbidden: super_admin role is immutable and cannot be revoked or mutated via client APIs.'
        USING ERRCODE = '42501';
    END IF;

    IF v_new_role IN ('super_admin', 'superadmin')
       AND v_new_role IS DISTINCT FROM v_old_role THEN
      RAISE EXCEPTION 'Forbidden: super_admin role cannot be granted via client APIs. Use direct SQL or service_role.'
        USING ERRCODE = '42501';
    END IF;

    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF v_old_role IN ('super_admin', 'superadmin') THEN
      RAISE EXCEPTION 'Forbidden: super_admin accounts cannot be deleted from client sessions.'
        USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_immutable_superadmin ON public.profiles;
CREATE TRIGGER trg_guard_immutable_superadmin
  BEFORE INSERT OR UPDATE OR DELETE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_immutable_superadmin();

-- Audit trigger for profile role mutations
CREATE OR REPLACE FUNCTION public.audit_profile_role_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.role IS DISTINCT FROM NEW.role THEN
    PERFORM public.write_audit_log(
      auth.uid(),
      NULL,
      'profile.role_changed',
      'profiles',
      NEW.id::text,
      jsonb_build_object(
        'previous_role', OLD.role,
        'new_role', NEW.role,
        'email', NEW.email
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_profile_role_change ON public.profiles;
CREATE TRIGGER trg_audit_profile_role_change
  AFTER UPDATE OF role ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_profile_role_change();

-- Harden `superadmin_set_user_role` so super_admin can never be granted or revoked via RPC
CREATE OR REPLACE FUNCTION public.superadmin_set_user_role(
  p_target_user_id uuid,
  p_new_role text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_normalized_role text := lower(trim(COALESCE(p_new_role, '')));
  v_previous_role text;
BEGIN
  IF v_caller_id IS NULL OR NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Permission denied: only super_admin can assign user roles.'
      USING ERRCODE = '42501';
  END IF;

  IF p_target_user_id IS NULL THEN
    RAISE EXCEPTION 'Target user ID is required.'
      USING ERRCODE = '22023';
  END IF;

  IF v_normalized_role IN ('super_admin', 'superadmin') THEN
    RAISE EXCEPTION 'Forbidden: super_admin role is immutable and cannot be granted via client RPC.'
      USING ERRCODE = '42501';
  END IF;

  IF v_normalized_role NOT IN (
    'visitor',
    'driver',
    'staff',
    'owner',
    'hub_manager',
    'admin'
  ) THEN
    RAISE EXCEPTION 'Invalid role "%". Allowed assignable roles: visitor, driver, staff, owner, hub_manager, admin.',
      p_new_role
      USING ERRCODE = '22023';
  END IF;

  SELECT p.role
    INTO v_previous_role
  FROM public.profiles p
  WHERE p.id = p_target_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target user profile not found.'
      USING ERRCODE = 'P0002';
  END IF;

  IF lower(trim(COALESCE(v_previous_role, ''))) IN ('super_admin', 'superadmin') THEN
    RAISE EXCEPTION 'Forbidden: super_admin accounts are read-only and cannot be modified via client RPC.'
      USING ERRCODE = '42501';
  END IF;

  IF p_target_user_id = v_caller_id THEN
    RAISE EXCEPTION 'Super admins cannot change their own role via this RPC.'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.profiles
  SET role = v_normalized_role
  WHERE id = p_target_user_id;

  RETURN jsonb_build_object(
    'ok', true,
    'user_id', p_target_user_id,
    'previous_role', v_previous_role,
    'role', v_normalized_role,
    'updated_by', v_caller_id,
    'updated_at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.superadmin_set_user_role(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.superadmin_set_user_role(uuid, text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 3. ICON & ACCENT COLUMNS ON `public.categories` (Root / Sub / Micro Tree)
-- -----------------------------------------------------------------------------
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS icon_key text DEFAULT 'tag',
  ADD COLUMN IF NOT EXISTS accent_color text DEFAULT '#2563EB';

-- Backfill `icon_key` (kebab-case) and `accent_color` from legacy columns
UPDATE public.categories
SET
  icon_key = COALESCE(
    NULLIF(trim(icon_key), ''),
    lower(regexp_replace(COALESCE(NULLIF(trim(icon), ''), 'Tag'), '([a-z0-9])([A-Z])', '\1-\2', 'g'))
  ),
  accent_color = COALESCE(
    NULLIF(trim(accent_color), ''),
    NULLIF(trim(color_hex), ''),
    '#2563EB'
  )
WHERE icon_key IS NULL
   OR icon_key = ''
   OR (icon_key = 'tag' AND icon IS NOT NULL AND lower(icon) <> 'tag')
   OR accent_color IS NULL
   OR accent_color = '';

-- Keep legacy `(icon, color_hex)` and canonical `(icon_key, accent_color)` in sync
CREATE OR REPLACE FUNCTION public.sync_category_icon_and_accent()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.icon_key IS NOT NULL AND trim(NEW.icon_key) <> '' THEN
      NEW.icon_key := lower(regexp_replace(trim(NEW.icon_key), '([a-z0-9])([A-Z])', '\1-\2', 'g'));
      NEW.icon := COALESCE(NULLIF(trim(NEW.icon), ''), NEW.icon_key);
    ELSE
      NEW.icon_key := lower(regexp_replace(COALESCE(NULLIF(trim(NEW.icon), ''), 'Tag'), '([a-z0-9])([A-Z])', '\1-\2', 'g'));
    END IF;

    NEW.accent_color := COALESCE(NULLIF(trim(NEW.accent_color), ''), NULLIF(trim(NEW.color_hex), ''), '#2563EB');
    NEW.color_hex := COALESCE(NULLIF(trim(NEW.color_hex), ''), NEW.accent_color);
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.icon_key IS DISTINCT FROM OLD.icon_key AND NEW.icon_key IS NOT NULL AND trim(NEW.icon_key) <> '' THEN
      NEW.icon_key := lower(regexp_replace(trim(NEW.icon_key), '([a-z0-9])([A-Z])', '\1-\2', 'g'));
      NEW.icon := NEW.icon_key;
    ELSIF NEW.icon IS DISTINCT FROM OLD.icon AND NEW.icon IS NOT NULL AND trim(NEW.icon) <> '' THEN
      NEW.icon_key := lower(regexp_replace(trim(NEW.icon), '([a-z0-9])([A-Z])', '\1-\2', 'g'));
    END IF;

    IF NEW.accent_color IS DISTINCT FROM OLD.accent_color AND NEW.accent_color IS NOT NULL AND trim(NEW.accent_color) <> '' THEN
      NEW.color_hex := NEW.accent_color;
    ELSIF NEW.color_hex IS DISTINCT FROM OLD.color_hex AND NEW.color_hex IS NOT NULL AND trim(NEW.color_hex) <> '' THEN
      NEW.accent_color := NEW.color_hex;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_categories_sync_icon_columns ON public.categories;
CREATE TRIGGER trg_categories_sync_icon_columns
  BEFORE INSERT OR UPDATE ON public.categories
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_category_icon_and_accent();

-- Confirm super_admin-only write RLS on public.categories
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS categories_public_read ON public.categories;
CREATE POLICY categories_public_read
  ON public.categories
  FOR SELECT
  USING (is_active = true OR public.is_super_admin());

DROP POLICY IF EXISTS categories_superadmin_write ON public.categories;
CREATE POLICY categories_superadmin_write
  ON public.categories
  FOR ALL
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- Generic audit trigger for superadmin configuration tables
CREATE OR REPLACE FUNCTION public.audit_superadmin_config_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row_id text;
  v_label text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    v_row_id := OLD.id::text;
    v_label := COALESCE(to_jsonb(OLD)->>'display_name', to_jsonb(OLD)->>'title', to_jsonb(OLD)->>'name', v_row_id);
  ELSE
    v_row_id := NEW.id::text;
    v_label := COALESCE(to_jsonb(NEW)->>'display_name', to_jsonb(NEW)->>'title', to_jsonb(NEW)->>'name', v_row_id);
  END IF;

  PERFORM public.write_audit_log(
    auth.uid(),
    NULL,
    TG_TABLE_NAME || '.' || lower(TG_OP),
    TG_TABLE_NAME,
    v_row_id,
    jsonb_build_object(
      'label', v_label,
      'op', TG_OP
    )
  );

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS trg_audit_categories_changes ON public.categories;
CREATE TRIGGER trg_audit_categories_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.categories
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_superadmin_config_change();

-- -----------------------------------------------------------------------------
-- 4. HOMEPAGE & LOCALITY CONFIG TABLES (`homepage_items`, `popular_localities`)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.homepage_items (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  section text NOT NULL CHECK (section IN ('shortcut_grid', 'quick_jump', 'featured_banner')),
  title text NOT NULL,
  subtitle text,
  container_style text DEFAULT 'card',
  icon_key text DEFAULT 'tag',
  accent_color text DEFAULT '#2563EB',
  route_key text NOT NULL,
  query_params jsonb NOT NULL DEFAULT '{}'::jsonb,
  sort_order integer NOT NULL DEFAULT 0,
  is_enabled boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_homepage_items_section_order
  ON public.homepage_items (section, sort_order ASC);

CREATE OR REPLACE FUNCTION public.touch_homepage_items_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_homepage_items_updated_at ON public.homepage_items;
CREATE TRIGGER trg_homepage_items_updated_at
  BEFORE UPDATE ON public.homepage_items
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_homepage_items_updated_at();

ALTER TABLE public.homepage_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS homepage_items_public_select ON public.homepage_items;
CREATE POLICY homepage_items_public_select
  ON public.homepage_items
  FOR SELECT
  USING (is_enabled = true OR public.is_super_admin());

DROP POLICY IF EXISTS homepage_items_superadmin_insert ON public.homepage_items;
CREATE POLICY homepage_items_superadmin_insert
  ON public.homepage_items
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS homepage_items_superadmin_update ON public.homepage_items;
CREATE POLICY homepage_items_superadmin_update
  ON public.homepage_items
  FOR UPDATE
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS homepage_items_superadmin_delete ON public.homepage_items;
CREATE POLICY homepage_items_superadmin_delete
  ON public.homepage_items
  FOR DELETE
  TO authenticated
  USING (public.is_super_admin());

DROP TRIGGER IF EXISTS trg_audit_homepage_items_changes ON public.homepage_items;
CREATE TRIGGER trg_audit_homepage_items_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.homepage_items
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_superadmin_config_change();

-- Popular Localities Config Table
CREATE TABLE IF NOT EXISTS public.popular_localities (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  icon_key text DEFAULT 'map-pin',
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  default_zoom integer NOT NULL DEFAULT 15,
  sort_order integer NOT NULL DEFAULT 0,
  is_enabled boolean NOT NULL DEFAULT true
);

CREATE INDEX IF NOT EXISTS idx_popular_localities_enabled_order
  ON public.popular_localities (is_enabled, sort_order ASC);

ALTER TABLE public.popular_localities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS popular_localities_public_select ON public.popular_localities;
CREATE POLICY popular_localities_public_select
  ON public.popular_localities
  FOR SELECT
  USING (is_enabled = true OR public.is_super_admin());

DROP POLICY IF EXISTS popular_localities_superadmin_insert ON public.popular_localities;
CREATE POLICY popular_localities_superadmin_insert
  ON public.popular_localities
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS popular_localities_superadmin_update ON public.popular_localities;
CREATE POLICY popular_localities_superadmin_update
  ON public.popular_localities
  FOR UPDATE
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

DROP POLICY IF EXISTS popular_localities_superadmin_delete ON public.popular_localities;
CREATE POLICY popular_localities_superadmin_delete
  ON public.popular_localities
  FOR DELETE
  TO authenticated
  USING (public.is_super_admin());

DROP TRIGGER IF EXISTS trg_audit_popular_localities_changes ON public.popular_localities;
CREATE TRIGGER trg_audit_popular_localities_changes
  AFTER INSERT OR UPDATE OR DELETE ON public.popular_localities
  FOR EACH ROW
  EXECUTE FUNCTION public.audit_superadmin_config_change();

-- Idempotently seed core Churachandpur localities
INSERT INTO public.popular_localities (name, slug, icon_key, lat, lng, default_zoom, sort_order, is_enabled)
VALUES
  ('Lamka Town', 'lamka-town', 'map-pin', 24.3335, 93.6975, 15, 10, true),
  ('New Lamka', 'new-lamka', 'building-2', 24.3422, 93.6942, 15, 20, true),
  ('Rengkai', 'rengkai', 'compass', 24.3278, 93.7044, 15, 30, true),
  ('Tuibong', 'tuibong', 'landmark', 24.3541, 93.6889, 15, 40, true),
  ('Hiangtam Lamka', 'hiangtam-lamka', 'store', 24.3304, 93.6938, 15, 50, true),
  ('Zenhang Lamka', 'zenhang-lamka', 'home', 24.3376, 93.7021, 15, 60, true)
ON CONFLICT (slug) DO NOTHING;

-- Optional audit hook on partner_applications status updates (if table exists)
DO $$
BEGIN
  IF to_regclass('public.partner_applications') IS NOT NULL THEN
    CREATE OR REPLACE FUNCTION public.audit_partner_application_review()
    RETURNS trigger
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public
    AS $fn$
    BEGIN
      IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
        PERFORM public.write_audit_log(
          auth.uid(),
          NULL,
          'partner_application.' || lower(COALESCE(NEW.status, 'updated')),
          'partner_applications',
          NEW.id::text,
          jsonb_build_object(
            'previous_status', OLD.status,
            'new_status', NEW.status,
            'applicant_id', NEW.user_id,
            'requested_role', NEW.requested_role
          )
        );
      END IF;
      RETURN NEW;
    END;
    $fn$;

    DROP TRIGGER IF EXISTS trg_audit_partner_application_review ON public.partner_applications;
    CREATE TRIGGER trg_audit_partner_application_review
      AFTER UPDATE OF status ON public.partner_applications
      FOR EACH ROW
      EXECUTE FUNCTION public.audit_partner_application_review();
  END IF;
END;
$$;

COMMIT;
