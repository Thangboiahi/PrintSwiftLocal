-- =============================================================================
-- Migration: 20261126_pass_v21a_p0_security_rls_and_schema_fixes.sql
-- Sprint v21a (Batch 1) — Database, RLS, RPC security & schema P0 fixes
-- Source of findings: docs/AUDIT_FORMS_AND_ROLES.md (Section C, P0-01 .. P0-28)
--
-- Idempotent: every statement is CREATE OR REPLACE / IF [NOT] EXISTS / guarded
-- DO-block, so this file can be re-run safely in the Supabase SQL Editor.
--
-- Functions marked "[v21a] Re-issued from <file>:<line>" are byte-for-byte copies
-- of the latest live definition with small, explicitly-commented patches only.
--
-- Every new or patched audit write uses the exact live `public.audit_logs`
-- columns: actor_id, actor_name, actor_role, workspace, action, target_id,
-- target_name, details, target_table, metadata (+ defaults id/timestamp/created_at).
--
-- Section map
--   §1  Shared helpers (super-admin allowlist, staff grants, hub scope, plan scope)
--   §2  Role governance, `mediator` role, super-admin signup & trusted-trigger fixes
--   §3  Broken audit triggers (partner applications, featured listings)
--   §4  Driver RPCs & OTP vault schema (P0-01, P0-02, P0-04)
--   §5  Mediator hub scope & escrow state machine (P0-03, P0-14)
--   §6  Zero-trust OTP RLS & vertical order forgery locks (P0-14)
--   §7  Entitlement engine repair (P0-06)
--   §8  Delegated staff permission/scope RLS (P0-18)
--   §9  Data-leak closures: profiles, plans (target_user_ids), categories, reviews (P0-16)
--   §10 Media registry, bind_media_assets & private payment-proofs bucket (P0-15, P0-17, P0-21)
--   §11 Monetization: pay-per, bulletins, featured requests, quotas, UTR replay (P0-09..11, P0-25, P0-27)
--   §12 Notifications reconcile + emit_notification RPC (P0-19)
--   §13 Vehicle booking fare authority & operational hats IDOR (P0-15, P0-28)
--   §14 Customer cancellation, >15m dispatch SLA, POD purge (P0-26)
--   §15 Contact Us & vehicle reviews tables (P0-24)
--   §16 Function grant lockdown (email OTP, atomic booking, internal helpers) (P0-15)
-- =============================================================================

BEGIN;

-- =============================================================================
-- §1. SHARED HELPERS
-- =============================================================================

-- 1A. Hardcoded super-admin allowlist (MUST stay in sync with lib/auth/super-admin.ts)
CREATE OR REPLACE FUNCTION public.is_hardcoded_super_admin_email(p_email text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT lower(trim(COALESCE(p_email, ''))) IN (
    'thangboiahi@gmail.com',
    'homeautomation.dd@gmail.com'
  );
$$;

-- 1B. TRUE only when the account's GoTrue auth.users email is on the hardcoded allowlist.
--     Takes no email input, so it cannot be used to probe other users' emails.
CREATE OR REPLACE FUNCTION public._v21a_is_hardcoded_super_admin_user(p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, auth
AS $$
  SELECT p_user_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM auth.users u
      WHERE u.id = p_user_id
        AND public.is_hardcoded_super_admin_email(u.email)
    );
$$;

-- 1C. Delegated staff permission / scope helpers (accept legacy object & array JSON shapes)
CREATE OR REPLACE FUNCTION public._staff_permission_granted(p_permissions jsonb, p_permission text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_permission IS NULL THEN true
    WHEN p_permissions IS NULL THEN false
    WHEN jsonb_typeof(p_permissions) = 'object' THEN
      lower(COALESCE(
        p_permissions ->> p_permission,
        p_permissions ->> regexp_replace(p_permission, '^can_', ''),
        'false'
      )) IN ('true', '1', 'yes')
    WHEN jsonb_typeof(p_permissions) = 'array' THEN
      (p_permissions ? p_permission)
      OR (p_permissions ? regexp_replace(p_permission, '^can_', ''))
    ELSE false
  END;
$$;

CREATE OR REPLACE FUNCTION public._staff_scope_aliases(p_scope text)
RETURNS text[]
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE p_scope
    WHEN 'print_queue' THEN ARRAY['print_queue', 'print_ops']
    WHEN 'booking_checkin' THEN ARRAY['booking_checkin', 'booking_desk']
    WHEN 'kitchen_shop_stock' THEN ARRAY['kitchen_shop_stock', 'kitchen_shop']
    WHEN 'property_visits' THEN ARRAY['property_visits', 'visit_desk']
    ELSE ARRAY[p_scope]
  END;
$$;

CREATE OR REPLACE FUNCTION public._staff_scope_granted(p_scopes jsonb, p_scope text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN p_scope IS NULL THEN true
    WHEN p_scopes IS NULL THEN false
    WHEN jsonb_typeof(p_scopes) = 'array' THEN p_scopes ?| public._staff_scope_aliases(p_scope)
    WHEN jsonb_typeof(p_scopes) = 'object' THEN EXISTS (
      SELECT 1
      FROM unnest(public._staff_scope_aliases(p_scope)) AS k(scope_key)
      WHERE lower(COALESCE(p_scopes ->> k.scope_key, 'false')) IN ('true', '1', 'yes')
    )
    ELSE false
  END;
$$;

-- 1D. Canonical delegated-staff grant check: active delegation + live parent listing
--     (lifecycle active/draining) + optional permission key + optional vertical scope.
CREATE OR REPLACE FUNCTION public.staff_has_listing_grant(
  p_listing_id uuid,
  p_permission text DEFAULT NULL,
  p_scope text DEFAULT NULL,
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_listing_id IS NOT NULL
    AND p_user_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.staff_delegations sd
      JOIN public.listings l ON l.id = p_listing_id
      WHERE sd.staff_id = p_user_id
        AND COALESCE(sd.status, 'active') = 'active'
        AND (
          sd.listing_id = p_listing_id
          OR (
            jsonb_typeof(sd.assigned_listing_ids) = 'array'
            AND sd.assigned_listing_ids ? p_listing_id::text
          )
        )
        AND COALESCE(l.lifecycle_status, 'active') IN ('active', 'draining')
        AND public._staff_permission_granted(sd.permissions, p_permission)
        AND public._staff_scope_granted(sd.vertical_scopes, p_scope)
    );
$$;

-- 1E. Dispatch hub scope: admins, super_admins & dedicated (global) `mediator` accounts act
--     platform-wide; hub managers act ONLY on rows of hubs they actively manage.
CREATE OR REPLACE FUNCTION public._v21a_assert_dispatch_hub_scope(p_uid uuid, p_hub_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
BEGIN
  IF COALESCE(current_setting('role', true), '') = 'service_role' THEN
    RETURN;
  END IF;

  SELECT lower(COALESCE(p.role, ''))
    INTO v_role
  FROM public.profiles p
  WHERE p.id = p_uid;

  IF v_role IN ('admin', 'super_admin', 'mediator') THEN
    RETURN;
  END IF;

  -- Legacy hub-less rows stay reachable so they can be resolved (flagged for review)
  IF p_hub_id IS NULL THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.hub_managers hm
    WHERE hm.profile_id = p_uid
      AND hm.hub_id = p_hub_id
      AND hm.is_active = true
  ) THEN
    RETURN;
  END IF;

  RAISE EXCEPTION 'Forbidden: this booking belongs to a hub you do not manage.'
    USING ERRCODE = '42501';
END;
$$;

-- 1F. Listing-aware subscription plan scope (restores v16b hierarchical category scoping)
CREATE OR REPLACE FUNCTION public._v21a_plan_scope_matches_listing(
  p_listing_id uuid,
  p_root_keys text[],
  p_category_ids uuid[]
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_category_id uuid;
  v_root_key text;
BEGIN
  IF p_listing_id IS NULL THEN
    RETURN true;
  END IF;

  IF COALESCE(array_length(p_root_keys, 1), 0) = 0
     AND COALESCE(array_length(p_category_ids, 1), 0) = 0 THEN
    RETURN true;
  END IF;

  IF p_root_keys IS NOT NULL AND '*' = ANY(p_root_keys) THEN
    RETURN true;
  END IF;

  SELECT l.category_id, COALESCE(NULLIF(l.root_key, ''), l.listing_vertical)
    INTO v_category_id, v_root_key
  FROM public.listings l
  WHERE l.id = p_listing_id;

  IF NOT FOUND THEN
    RETURN false;
  END IF;

  IF v_category_id IS NOT NULL
     AND public.category_matches_plan_scope(v_category_id, p_category_ids, p_root_keys) THEN
    RETURN true;
  END IF;

  RETURN v_root_key IS NOT NULL
    AND p_root_keys IS NOT NULL
    AND v_root_key = ANY(p_root_keys);
END;
$$;

-- 1G. Canonical audit append helper (same 6-arg signature as v15a) — now also fills
--     actor_name / workspace / details / target_name from live columns.
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
  v_actor_name text;
  v_meta jsonb := COALESCE(p_metadata, '{}'::jsonb);
BEGIN
  IF v_resolved_actor_id IS NOT NULL THEN
    SELECT
      COALESCE(v_resolved_role, p.role),
      COALESCE(NULLIF(trim(p.full_name), ''), NULLIF(trim(p.username), ''), p.email)
    INTO v_resolved_role, v_actor_name
    FROM public.profiles p
    WHERE p.id = v_resolved_actor_id;
  END IF;

  INSERT INTO public.audit_logs (
    actor_id,
    actor_name,
    actor_role,
    workspace,
    action,
    target_id,
    target_name,
    details,
    target_table,
    metadata,
    created_at
  )
  VALUES (
    v_resolved_actor_id,
    v_actor_name,
    COALESCE(v_resolved_role, 'system'),
    COALESCE(NULLIF(v_meta ->> 'workspace', ''), 'system'),
    COALESCE(NULLIF(trim(p_action), ''), 'unknown_action'),
    p_target_id,
    NULLIF(v_meta ->> 'target_name', ''),
    NULLIF(v_meta ->> 'details', ''),
    p_target_table,
    v_meta,
    now()
  )
  RETURNING id INTO v_log_id;

  RETURN v_log_id;
END;
$$;

-- =============================================================================
-- §2. ROLE GOVERNANCE, DEDICATED `mediator` ROLE & SUPER-ADMIN SIGNUP (P0-04, P0-15, P0-21)
-- =============================================================================

-- 2A. Add `mediator` to profiles_role_check (superset of the phase66a constraint)
ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (
    role IN (
      'visitor',
      'driver',
      'staff',
      'owner',
      'hub_manager',
      'mediator',
      'admin',
      'super_admin'
    )
  ) NOT VALID;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE role NOT IN (
      'visitor', 'driver', 'staff', 'owner', 'hub_manager', 'mediator', 'admin', 'super_admin'
    )
  ) THEN
    ALTER TABLE public.profiles VALIDATE CONSTRAINT profiles_role_check;
  END IF;
END;
$$;

-- 2B. superadmin_set_user_role: `mediator` becomes assignable
-- [v21a] Re-issued from 20261124_pass_v15a_superadmin_foundation.sql:299 with targeted patches.
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
    'mediator',
    'admin'
  ) THEN
    RAISE EXCEPTION 'Invalid role "%". Allowed assignable roles: visitor, driver, staff, owner, hub_manager, mediator, admin.',
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
REVOKE ALL ON FUNCTION public.superadmin_set_user_role(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.superadmin_set_user_role(uuid, text) TO authenticated;

-- 2C. enforce_profile_role_governance: elevate hardcoded super-admins ONLY when the
--     account's verified auth.users email is allowlisted (editing profiles.email can no
--     longer self-elevate an account).
CREATE OR REPLACE FUNCTION public.enforce_profile_role_governance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_service boolean := (current_setting('role', true) = 'service_role');
BEGIN
  NEW.updated_at := COALESCE(NEW.updated_at, now());

  -- Hardcoded Super-Admin Rule (verified against auth.users)
  IF public._v21a_is_hardcoded_super_admin_user(NEW.id) THEN
    NEW.role := 'super_admin';
    RETURN NEW;
  END IF;

  IF v_is_service THEN
    NEW.role := COALESCE(NULLIF(TRIM(NEW.role), ''), 'visitor');
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.role := 'visitor';
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.role IS DISTINCT FROM OLD.role THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'super_admin')
    ) THEN
      RAISE EXCEPTION 'Unauthorized: Only authorized administrators can modify user roles.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 2D. guard_immutable_superadmin: keeps super_admin immutable from client sessions, but
--     no longer rejects the verified hardcoded super-admin's own signup/profile sync
--     (v14a trg_enforce_* fires before trg_guard_* and stamps super_admin first).
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
  v_is_verified_hardcoded boolean := false;
BEGIN
  IF NOT v_is_client_session THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    v_is_verified_hardcoded := public._v21a_is_hardcoded_super_admin_user(NEW.id);
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF v_new_role IN ('super_admin', 'superadmin') AND NOT v_is_verified_hardcoded THEN
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
       AND v_new_role IS DISTINCT FROM v_old_role
       AND NOT v_is_verified_hardcoded THEN
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

-- 2E. guard_profile_sensitive_columns_v20b → SECURITY INVOKER.
--     `current_user` is 'authenticated'/'anon' for direct client UPDATEs, but is the
--     function owner inside trusted SECURITY DEFINER RPCs/triggers (start_plan_trial,
--     trg_partner_approval_auto_trial_v17b, reset_trial...). Those writes are now trusted,
--     while direct client self-escalation stays blocked.
CREATE OR REPLACE FUNCTION public.guard_profile_sensitive_columns_v20b()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_old_json jsonb := to_jsonb(OLD);
  v_new_json jsonb := to_jsonb(NEW);
BEGIN
  -- Trusted contexts: service_role, postgres/migrations, SECURITY DEFINER RPCs & triggers
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NOT NULL AND public.is_pnd_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role THEN
    -- Allowed only for the verified hardcoded super-admin self-sync
    IF NOT (
      lower(COALESCE(NEW.role, '')) = 'super_admin'
      AND public._v21a_is_hardcoded_super_admin_user(NEW.id)
    ) THEN
      RAISE EXCEPTION 'Unauthorized: role cannot be modified by the profile owner.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF (v_old_json ? 'roles') AND (v_new_json->'roles') IS DISTINCT FROM (v_old_json->'roles') THEN
    RAISE EXCEPTION 'Unauthorized: roles cannot be modified by the profile owner.'
      USING ERRCODE = '42501';
  END IF;

  IF (v_old_json ? 'is_super_admin')
     AND (v_new_json->'is_super_admin') IS DISTINCT FROM (v_old_json->'is_super_admin') THEN
    RAISE EXCEPTION 'Unauthorized: is_super_admin cannot be modified by the profile owner.'
      USING ERRCODE = '42501';
  END IF;

  IF (v_old_json ? 'trial_used_at')
     AND (v_new_json->'trial_used_at') IS DISTINCT FROM (v_old_json->'trial_used_at') THEN
    RAISE EXCEPTION 'Unauthorized: trial_used_at is system-managed and cannot be modified.'
      USING ERRCODE = '42501';
  END IF;

  IF (v_old_json ? 'referral_code')
     AND (v_new_json->'referral_code') IS DISTINCT FROM (v_old_json->'referral_code')
     AND (v_old_json->>'referral_code') IS NOT NULL THEN
    RAISE EXCEPTION 'Unauthorized: referral_code is system-managed and cannot be modified.'
      USING ERRCODE = '42501';
  END IF;

  IF (v_old_json ? 'print_no_show_count')
     AND (v_new_json->'print_no_show_count') IS DISTINCT FROM (v_old_json->'print_no_show_count') THEN
    RAISE EXCEPTION 'Unauthorized: print_no_show_count is system-managed and cannot be modified.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

-- =============================================================================
-- §3. BROKEN AUDIT TRIGGERS (P0-15)
-- =============================================================================

-- 3A. trg_audit_partner_application_review read NEW.user_id / NEW.requested_role, which do not
--     exist on partner_applications (applicant_id / application_type). JSON access keeps it
--     schema-tolerant.
CREATE OR REPLACE FUNCTION public.audit_partner_application_review()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new jsonb := to_jsonb(NEW);
  v_old jsonb := to_jsonb(OLD);
BEGIN
  IF TG_OP = 'UPDATE' AND (v_old ->> 'status') IS DISTINCT FROM (v_new ->> 'status') THEN
    PERFORM public.write_audit_log(
      auth.uid(),
      NULL,
      'partner_application.' || lower(COALESCE(v_new ->> 'status', 'updated')),
      'partner_applications',
      NEW.id::text,
      jsonb_build_object(
        'workspace', 'governance',
        'details', 'Partner application status changed to ' || COALESCE(v_new ->> 'status', 'updated'),
        'previous_status', v_old ->> 'status',
        'new_status', v_new ->> 'status',
        'applicant_id', COALESCE(v_new ->> 'applicant_id', v_new ->> 'user_id'),
        'application_type', COALESCE(v_new ->> 'application_type', v_new ->> 'requested_role'),
        'hub_id', v_new ->> 'hub_id'
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.partner_applications') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_audit_partner_application_review ON public.partner_applications;
    CREATE TRIGGER trg_audit_partner_application_review
      AFTER UPDATE OF status ON public.partner_applications
      FOR EACH ROW
      EXECUTE FUNCTION public.audit_partner_application_review();
  END IF;
END;
$$;

-- 3B. trg_audit_listings_featured_v15c called write_audit_log() with 4 args (no such overload)
CREATE OR REPLACE FUNCTION public.audit_listings_featured_v15c()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF (NEW.featured_order IS DISTINCT FROM OLD.featured_order)
     OR (NEW.is_featured IS DISTINCT FROM OLD.is_featured) THEN
    PERFORM public.write_audit_log(
      auth.uid(),
      NULL,
      'listings_featured_update',
      'listings',
      NEW.id::text,
      jsonb_build_object(
        'workspace', 'superadmin',
        'target_name', NEW.title,
        'details', 'Featured placement changed for ' || COALESCE(NEW.title, NEW.id::text),
        'title', NEW.title,
        'old_is_featured', OLD.is_featured,
        'new_is_featured', NEW.is_featured,
        'old_featured_order', OLD.featured_order,
        'new_featured_order', NEW.featured_order
      )
    );
  END IF;
  RETURN NEW;
END;
$$;

-- =============================================================================
-- §4. DRIVER RPCs (P0-01, P0-02, P0-04)
-- =============================================================================

-- 4A. P0-02: driver_verify_handover_otp() updates delivery_order_secrets.updated_at,
--     which did not exist → every Pick N Drop OTP submission crashed.
ALTER TABLE public.delivery_order_secrets
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

-- 4B. POD purge bookkeeping columns used by §14
ALTER TABLE public.delivery_orders
  ADD COLUMN IF NOT EXISTS pod_purged_at timestamptz;
ALTER TABLE public.vehicle_bookings
  ADD COLUMN IF NOT EXISTS pod_purged_at timestamptz;

-- 4C. P0-01: available jobs feed (PostGIS points + `instructions`)
-- [v21a] Re-issued from 20261126_pass_v19b_driver_rpc_and_pod_rls.sql:1299 with targeted patches.
CREATE OR REPLACE FUNCTION public.get_driver_available_jobs()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_driver public.drivers%ROWTYPE;
  v_driver_slug text;
  v_escrow_required boolean := true;
  v_jobs jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in required.'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO v_driver
  FROM public.drivers
  WHERE profile_id = v_uid
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN '[]'::jsonb;
  END IF;

  v_driver_slug := public._canonical_fleet_slug_v19b(v_driver.vehicle_type);

  SELECT COALESCE(p.escrow_required, true)
    INTO v_escrow_required
  FROM public.payment_feature_policies p
  WHERE p.scope_key = 'pnd';

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', o.id,
        'order_code', o.order_code,
        'service_mode', o.service_mode,
        'trip_type', o.trip_type,
        'pickup_address', o.pickup_address,
        'dropoff_address', o.dropoff_address,
        'pickup_lat', CASE WHEN o.pickup_point IS NULL THEN NULL ELSE ST_Y(o.pickup_point::geometry) END,
        'pickup_lng', CASE WHEN o.pickup_point IS NULL THEN NULL ELSE ST_X(o.pickup_point::geometry) END,
        'dropoff_lat', CASE WHEN o.dropoff_point IS NULL THEN NULL ELSE ST_Y(o.dropoff_point::geometry) END,
        'dropoff_lng', CASE WHEN o.dropoff_point IS NULL THEN NULL ELSE ST_X(o.dropoff_point::geometry) END,
        'distance_km', o.distance_km,
        'quoted_fare_inr', o.quoted_fare_inr,
        'estimated_driver_payout_inr', round(o.quoted_fare_inr * 0.85, 2),
        'status', o.status,
        'escrow_funded', (o.status = 'escrow_held' OR o.payment_verified_at IS NOT NULL),
        'vehicle_type_slug', public._canonical_fleet_slug_v19b(vt.slug),
        'vehicle_type_name', COALESCE(vt.name, v_driver.vehicle_type),
        'pod_required', COALESCE(o.pod_required, o.service_mode <> 'passenger'),
        'notes', o.instructions,
        'instructions', o.instructions,
        'created_at', o.created_at
      )
      ORDER BY o.created_at DESC
    ),
    '[]'::jsonb
  )
  INTO v_jobs
  FROM public.delivery_orders o
  LEFT JOIN public.vehicle_types vt ON vt.id = o.vehicle_type_id
  WHERE o.driver_id IS NULL
    AND (
      (v_escrow_required AND o.status = 'escrow_held')
      OR (NOT v_escrow_required AND o.status IN ('escrow_held', 'awaiting_payment', 'payment_submitted'))
    )
    AND (
      v_driver.hub_id IS NULL
      OR o.hub_id IS NULL
      OR o.hub_id = v_driver.hub_id
    )
    AND (
      vt.slug IS NULL
      OR public._canonical_fleet_slug_v19b(vt.slug) = v_driver_slug
      OR EXISTS (
        SELECT 1
        FROM public.vehicles v
        WHERE v.driver_id = v_driver.id
          AND v.vehicle_type_id = o.vehicle_type_id
      )
    );

  RETURN v_jobs;
END;
$$;

REVOKE ALL ON FUNCTION public.get_driver_available_jobs() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_driver_available_jobs() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_driver_available_jobs() TO authenticated;

-- 4D. P0-01: active trips for the calling driver (zero OTP / zero secret columns)
CREATE OR REPLACE FUNCTION public.get_driver_active_orders()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_driver_id uuid;
  v_rows jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in required.'
      USING ERRCODE = '42501';
  END IF;

  SELECT d.id
    INTO v_driver_id
  FROM public.drivers d
  WHERE d.profile_id = v_uid
  LIMIT 1;

  IF v_driver_id IS NULL THEN
    RETURN '[]'::jsonb;
  END IF;

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', o.id,
        'order_code', o.order_code,
        'service_mode', o.service_mode,
        'trip_type', o.trip_type,
        'pickup_address', o.pickup_address,
        'pickup_landmark', o.pickup_landmark,
        'dropoff_address', o.dropoff_address,
        'dropoff_landmark', o.dropoff_landmark,
        'pickup_lat', CASE WHEN o.pickup_point IS NULL THEN NULL ELSE ST_Y(o.pickup_point::geometry) END,
        'pickup_lng', CASE WHEN o.pickup_point IS NULL THEN NULL ELSE ST_X(o.pickup_point::geometry) END,
        'dropoff_lat', CASE WHEN o.dropoff_point IS NULL THEN NULL ELSE ST_Y(o.dropoff_point::geometry) END,
        'dropoff_lng', CASE WHEN o.dropoff_point IS NULL THEN NULL ELSE ST_X(o.dropoff_point::geometry) END,
        'recipient_name', o.recipient_name,
        'distance_km', o.distance_km,
        'quoted_fare_inr', o.quoted_fare_inr,
        'status', o.status,
        'driver_substatus', o.driver_substatus,
        'pod_storage_path', o.pod_storage_path,
        'pod_uploaded_at', o.pod_uploaded_at,
        'pod_purge_at', o.pod_purge_at,
        'pod_required', COALESCE(o.pod_required, o.service_mode <> 'passenger'),
        'notes', o.instructions,
        'instructions', o.instructions,
        'created_at', o.created_at,
        'updated_at', o.updated_at
      )
      ORDER BY o.updated_at DESC NULLS LAST
    ),
    '[]'::jsonb
  )
  INTO v_rows
  FROM public.delivery_orders o
  WHERE o.driver_id = v_driver_id
    AND o.status IN (
      'driver_assigned', 'picked_up', 'in_transit',
      'delivered_pending_confirm', 'return_in_transit', 'disputed'
    );

  RETURN v_rows;
END;
$$;

REVOKE ALL ON FUNCTION public.get_driver_active_orders() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_driver_active_orders() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_driver_active_orders() TO authenticated;

-- 4E. P0-04: releasing an unpaid trip returns it to `awaiting_payment`, not `escrow_held`
-- [v21a] Re-issued from 20261126_pass_v19b_driver_rpc_and_pod_rls.sql:853 with targeted patches.
CREATE OR REPLACE FUNCTION public.driver_update_trip_status(
  p_booking_id uuid,
  p_status text,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_status text := lower(trim(COALESCE(p_status, '')));
  v_reason text := NULLIF(trim(COALESCE(p_reason, '')), '');
  v_driver public.drivers%ROWTYPE;
  v_order public.delivery_orders%ROWTYPE;
  v_booking public.vehicle_bookings%ROWTYPE;
  v_next_order_status text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in required to update trip status.'
      USING ERRCODE = '42501';
  END IF;

  IF v_status NOT IN ('arrived_pickup', 'en_route_dropoff', 'driver_cancelled') THEN
    RAISE EXCEPTION 'Invalid trip status "%". Expected arrived_pickup, en_route_dropoff, or driver_cancelled.', p_status
      USING ERRCODE = '22023';
  END IF;

  IF v_status = 'driver_cancelled' AND (v_reason IS NULL OR length(v_reason) < 5) THEN
    RAISE EXCEPTION 'A clear cancellation reason (at least 5 characters) is mandatory when releasing an assigned trip.'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_driver
  FROM public.drivers
  WHERE profile_id = v_uid
    AND COALESCE(is_active, false) = true
  LIMIT 1;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Active driver profile required.'
      USING ERRCODE = '42501';
  END IF;

  -- ---- CASE A: PICK N DROP DELIVERY ORDER ----
  SELECT * INTO v_order FROM public.delivery_orders WHERE id = p_booking_id FOR UPDATE;
  IF FOUND THEN
    IF v_order.driver_id IS DISTINCT FROM v_driver.id THEN
      RAISE EXCEPTION 'Forbidden: Only the assigned driver may update %.', v_order.order_code
        USING ERRCODE = '42501';
    END IF;

    IF v_status = 'arrived_pickup' THEN
      IF v_order.status <> 'driver_assigned' THEN
        RAISE EXCEPTION 'Arrived at Pickup can only be marked while awaiting Pickup OTP.'
          USING ERRCODE = 'P0001';
      END IF;

      UPDATE public.delivery_orders
      SET
        driver_substatus = 'arrived_pickup',
        updated_at = now()
      WHERE id = v_order.id;

      INSERT INTO public.delivery_order_events (order_id, actor_id, event_type, payload)
      VALUES (
        v_order.id,
        v_uid,
        'driver_arrived_pickup',
        jsonb_build_object('driver_id', v_driver.id)
      );

      PERFORM public._log_driver_audit_v19b(
        v_uid,
        'driver_arrived_pickup',
        'delivery_orders',
        v_order.id::text,
        v_order.order_code,
        'Marked arrived at pickup for ' || v_order.order_code,
        jsonb_build_object('order_code', v_order.order_code, 'driver_substatus', 'arrived_pickup')
      );

      RETURN jsonb_build_object(
        'ok', true,
        'domain', 'pick_n_drop',
        'booking_id', v_order.id,
        'status', v_order.status,
        'driver_substatus', 'arrived_pickup'
      );

    ELSIF v_status = 'en_route_dropoff' THEN
      IF v_order.status NOT IN ('picked_up', 'in_transit') THEN
        RAISE EXCEPTION 'Pickup OTP must be verified before marking En Route to Dropoff.'
          USING ERRCODE = 'P0001';
      END IF;

      UPDATE public.delivery_orders
      SET
        status = 'in_transit',
        driver_substatus = 'en_route_dropoff',
        updated_at = now()
      WHERE id = v_order.id;

      INSERT INTO public.delivery_order_events (order_id, actor_id, event_type, payload)
      VALUES (
        v_order.id,
        v_uid,
        'driver_en_route_dropoff',
        jsonb_build_object('driver_id', v_driver.id)
      );

      PERFORM public._log_driver_audit_v19b(
        v_uid,
        'driver_en_route_dropoff',
        'delivery_orders',
        v_order.id::text,
        v_order.order_code,
        'Marked en route to dropoff for ' || v_order.order_code,
        jsonb_build_object('order_code', v_order.order_code, 'status', 'in_transit')
      );

      RETURN jsonb_build_object(
        'ok', true,
        'domain', 'pick_n_drop',
        'booking_id', v_order.id,
        'status', 'in_transit',
        'driver_substatus', 'en_route_dropoff'
      );

    ELSE
      -- driver_cancelled: Only allowed BEFORE pickup OTP is verified; returns job cleanly to funded dispatch pool
      IF v_order.status <> 'driver_assigned' THEN
        RAISE EXCEPTION 'A trip cannot be released back to the dispatch pool after Pickup OTP verification. Contact the Dispatch Mediator for assistance.'
          USING ERRCODE = 'P0001';
      END IF;

      v_next_order_status := CASE
        WHEN v_order.payment_verified_at IS NOT NULL THEN 'escrow_held'
        WHEN EXISTS (
          SELECT 1
          FROM public.payment_intents pi
          WHERE pi.purpose = 'pick_n_drop'
            AND pi.reference_id = v_order.id
            AND pi.status = 'succeeded'
        ) THEN 'escrow_held'
        ELSE 'awaiting_payment'
      END;

      UPDATE public.delivery_orders
      SET
        driver_id = NULL,
        vehicle_id = NULL,
        status = v_next_order_status,
        driver_substatus = NULL,
        updated_at = now()
      WHERE id = v_order.id;

      INSERT INTO public.delivery_order_events (order_id, actor_id, event_type, payload)
      VALUES (
        v_order.id,
        v_uid,
        'driver_cancelled_returned_to_pool',
        jsonb_build_object(
          'driver_id', v_driver.id,
          'reason', v_reason,
          'returned_status', v_next_order_status
        )
      );

      PERFORM public._log_driver_audit_v19b(
        v_uid,
        'driver_cancelled_assignment',
        'delivery_orders',
        v_order.id::text,
        v_order.order_code,
        'Released ' || v_order.order_code || ' back to dispatch pool: ' || v_reason,
        jsonb_build_object(
          'domain', 'pick_n_drop',
          'order_code', v_order.order_code,
          'reason', v_reason,
          'returned_status', v_next_order_status
        )
      );

      RETURN jsonb_build_object(
        'ok', true,
        'domain', 'pick_n_drop',
        'booking_id', v_order.id,
        'status', v_next_order_status,
        'returned_to_pool', true
      );
    END IF;
  END IF;

  -- ---- CASE B: SCHEDULED VEHICLE BOOKING ----
  SELECT * INTO v_booking FROM public.vehicle_bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found.'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_booking.assigned_driver_id IS DISTINCT FROM v_driver.id THEN
    RAISE EXCEPTION 'Forbidden: Only the assigned driver may update booking %.', v_booking.booking_code
      USING ERRCODE = '42501';
  END IF;

  IF v_status = 'driver_cancelled' THEN
    IF v_booking.status <> 'confirmed' THEN
      RAISE EXCEPTION 'Scheduled bookings can only be released before trip start.'
        USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.vehicle_bookings
    SET
      assigned_driver_id = NULL,
      updated_at = now()
    WHERE id = v_booking.id;

    PERFORM public._log_driver_audit_v19b(
      v_uid,
      'driver_cancelled_assignment',
      'vehicle_bookings',
      v_booking.id::text,
      v_booking.booking_code,
      'Released vehicle booking ' || v_booking.booking_code || ' back to dispatch pool: ' || v_reason,
      jsonb_build_object(
        'domain', 'vehicle_booking',
        'booking_code', v_booking.booking_code,
        'reason', v_reason
      )
    );

    RETURN jsonb_build_object(
      'ok', true,
      'domain', 'vehicle_booking',
      'booking_id', v_booking.id,
      'status', v_booking.status,
      'returned_to_pool', true
    );
  END IF;

  -- Non-cancelling milestone note on scheduled vehicle booking
  PERFORM public._log_driver_audit_v19b(
    v_uid,
    'driver_' || v_status,
    'vehicle_bookings',
    v_booking.id::text,
    v_booking.booking_code,
    'Updated booking ' || v_booking.booking_code || ' milestone to ' || v_status,
    jsonb_build_object(
      'domain', 'vehicle_booking',
      'booking_code', v_booking.booking_code,
      'milestone', v_status
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'domain', 'vehicle_booking',
    'booking_id', v_booking.id,
    'status', v_booking.status,
    'milestone', v_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.driver_update_trip_status(uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.driver_update_trip_status(uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.driver_update_trip_status(uuid, text, text) TO authenticated;

-- =============================================================================
-- §5. MEDIATOR HUB SCOPE & ESCROW STATE MACHINE (P0-03, P0-14)
-- =============================================================================

-- [v21a] Re-issued from 20261126_pass_v19a_mediator_escrow_and_utr_guard.sql:635 with targeted patches.
CREATE OR REPLACE FUNCTION public.mediator_verify_upi_payment(
  p_booking_id uuid,
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
  v_notes text := NULLIF(trim(COALESCE(p_notes, '')), '');
  v_order public.delivery_orders%ROWTYPE;
  v_booking public.vehicle_bookings%ROWTYPE;
  v_intent public.payment_intents%ROWTYPE;
  v_utr_ref text;
  v_proof_path text;
  v_has_escrow_tx boolean := false;
  v_target_id uuid := p_booking_id;
  v_domain text := NULL;
BEGIN
  IF v_uid IS NULL OR NOT public.is_pnd_mediator(v_uid) THEN
    RAISE EXCEPTION 'Forbidden: Only authorized Dispatch Mediators, Hub Managers, or Admins may verify UPI payments.'
      USING ERRCODE = '42501';
  END IF;

  IF v_decision NOT IN ('verify', 'reject') THEN
    RAISE EXCEPTION 'Invalid decision "%". Expected verify or reject.', p_decision
      USING ERRCODE = '22023';
  END IF;

  IF v_decision = 'reject' AND (v_notes IS NULL OR length(v_notes) < 3) THEN
    RAISE EXCEPTION 'A rejection reason (at least 3 characters) is mandatory when rejecting a UPI payment.'
      USING ERRCODE = '22023';
  END IF;

  -- Resolve target domain: delivery_orders -> vehicle_bookings -> payment_intents
  SELECT * INTO v_order FROM public.delivery_orders WHERE id = v_target_id FOR UPDATE;
  IF FOUND THEN
    v_domain := 'delivery_orders';
  ELSE
    SELECT * INTO v_booking FROM public.vehicle_bookings WHERE id = v_target_id FOR UPDATE;
    IF FOUND THEN
      v_domain := 'vehicle_bookings';
    ELSE
      SELECT * INTO v_intent
      FROM public.payment_intents
      WHERE id = v_target_id
        AND purpose IN ('pick_n_drop', 'vehicle_booking')
      FOR UPDATE;

      IF FOUND THEN
        IF v_intent.purpose = 'pick_n_drop' THEN
          SELECT * INTO v_order FROM public.delivery_orders WHERE id = v_intent.reference_id FOR UPDATE;
          IF FOUND THEN
            v_domain := 'delivery_orders';
            v_target_id := v_order.id;
          END IF;
        ELSIF v_intent.purpose = 'vehicle_booking' THEN
          SELECT * INTO v_booking FROM public.vehicle_bookings WHERE id = v_intent.reference_id FOR UPDATE;
          IF FOUND THEN
            v_domain := 'vehicle_bookings';
            v_target_id := v_booking.id;
          END IF;
        END IF;
      END IF;
    END IF;
  END IF;

  IF v_domain IS NULL THEN
    RAISE EXCEPTION 'Booking or payment record not found.'
      USING ERRCODE = 'P0002';
  END IF;

  -- v21a: hub managers may only act inside the hubs they manage
  PERFORM public._v21a_assert_dispatch_hub_scope(
    v_uid,
    CASE WHEN v_domain = 'delivery_orders' THEN v_order.hub_id ELSE v_booking.hub_id END
  );

  -- ---- PICK N DROP DELIVERY ORDER ----
  IF v_domain = 'delivery_orders' THEN
    -- Locate linked payment intent if any
    IF v_intent.id IS NULL THEN
      SELECT * INTO v_intent
      FROM public.payment_intents
      WHERE purpose = 'pick_n_drop'
        AND reference_id = v_order.id
      ORDER BY created_at DESC
      LIMIT 1
      FOR UPDATE;
    END IF;

    SELECT dt.upi_utr_ref, dt.payment_proof_path
      INTO v_utr_ref, v_proof_path
    FROM public.delivery_transactions dt
    WHERE dt.order_id = v_order.id
      AND dt.tx_type = 'upi_payment'
      AND dt.status IN ('active', 'verified')
    ORDER BY dt.created_at DESC
    LIMIT 1;

    v_utr_ref := COALESCE(v_utr_ref, v_intent.upi_utr_ref);
    v_proof_path := COALESCE(v_proof_path, v_intent.payment_proof_path);

    IF v_decision = 'verify' THEN
      IF v_order.status NOT IN ('awaiting_payment', 'payment_submitted', 'escrow_held') THEN
        RAISE EXCEPTION 'Order % cannot be verified from status "%".', v_order.order_code, v_order.status
          USING ERRCODE = 'P0001';
      END IF;

      UPDATE public.delivery_orders
      SET
        status = 'escrow_held',
        mediator_id = COALESCE(mediator_id, v_uid),
        payment_verified_by = v_uid,
        payment_verified_at = now(),
        updated_at = now()
      WHERE id = v_order.id;

      UPDATE public.delivery_transactions
      SET status = 'verified'
      WHERE order_id = v_order.id
        AND tx_type = 'upi_payment'
        AND status = 'active';

      SELECT EXISTS (
        SELECT 1
        FROM public.delivery_transactions
        WHERE order_id = v_order.id
          AND tx_type = 'escrow_hold'
      ) INTO v_has_escrow_tx;

      IF NOT v_has_escrow_tx THEN
        INSERT INTO public.delivery_transactions (
          order_id, tx_type, amount_inr, upi_utr_ref, payment_proof_path, recorded_by, status, notes
        )
        VALUES (
          v_order.id,
          'escrow_hold',
          v_order.quoted_fare_inr,
          v_utr_ref,
          v_proof_path,
          v_uid,
          'verified',
          COALESCE(v_notes, 'UPI UTR verified and escrow funded by Dispatch Mediator')
        );
      END IF;

      IF v_intent.id IS NOT NULL AND v_intent.status <> 'succeeded' THEN
        UPDATE public.payment_intents
        SET
          status = 'succeeded',
          verified_by = v_uid,
          provider_payment_id = COALESCE(provider_payment_id, v_utr_ref),
          updated_at = now()
        WHERE id = v_intent.id;
      END IF;

      INSERT INTO public.delivery_order_events (order_id, actor_id, event_type, payload)
      VALUES (
        v_order.id,
        v_uid,
        'escrow_held',
        jsonb_build_object(
          'utr_ref', v_utr_ref,
          'amount_inr', v_order.quoted_fare_inr,
          'notes', v_notes
        )
      );

      PERFORM public._log_mediator_audit_v19a(
        v_uid,
        'mediator_verify_upi_payment',
        'delivery_orders',
        v_order.id::text,
        v_order.order_code,
        'Verified UPI payment and funded escrow for ' || v_order.order_code,
        jsonb_build_object(
          'decision', 'verify',
          'domain', 'pick_n_drop',
          'order_code', v_order.order_code,
          'amount_inr', v_order.quoted_fare_inr,
          'utr_ref', v_utr_ref,
          'notes', v_notes
        )
      );

      RETURN jsonb_build_object(
        'ok', true,
        'domain', 'pick_n_drop',
        'booking_id', v_order.id,
        'code', v_order.order_code,
        'status', 'escrow_held',
        'verified_at', now()
      );
    ELSE
      -- Reject manual UPI payment cleanly so UTR is never approved
      UPDATE public.delivery_orders
      SET
        status = 'awaiting_payment',
        mediator_id = COALESCE(mediator_id, v_uid),
        dispute_reason = v_notes,
        updated_at = now()
      WHERE id = v_order.id
        AND status IN ('awaiting_payment', 'payment_submitted');

      UPDATE public.delivery_transactions
      SET
        status = 'rejected',
        notes = COALESCE(notes || ' | ', '') || 'Rejected by Mediator: ' || v_notes
      WHERE order_id = v_order.id
        AND tx_type = 'upi_payment'
        AND status = 'active';

      IF v_intent.id IS NOT NULL AND v_intent.status IN ('awaiting_payment', 'pending_manual') THEN
        UPDATE public.payment_intents
        SET
          status = 'rejected',
          verified_by = v_uid,
          refund_notes = v_notes,
          updated_at = now()
        WHERE id = v_intent.id;
      END IF;

      INSERT INTO public.delivery_order_events (order_id, actor_id, event_type, payload)
      VALUES (
        v_order.id,
        v_uid,
        'upi_payment_rejected',
        jsonb_build_object(
          'utr_ref', v_utr_ref,
          'reason', v_notes
        )
      );

      PERFORM public._log_mediator_audit_v19a(
        v_uid,
        'mediator_reject_upi_payment',
        'delivery_orders',
        v_order.id::text,
        v_order.order_code,
        'Rejected UPI payment for ' || v_order.order_code || ': ' || v_notes,
        jsonb_build_object(
          'decision', 'reject',
          'domain', 'pick_n_drop',
          'order_code', v_order.order_code,
          'amount_inr', v_order.quoted_fare_inr,
          'utr_ref', v_utr_ref,
          'reason', v_notes
        )
      );

      RETURN jsonb_build_object(
        'ok', true,
        'domain', 'pick_n_drop',
        'booking_id', v_order.id,
        'code', v_order.order_code,
        'status', 'awaiting_payment',
        'rejected', true
      );
    END IF;
  END IF;

  -- ---- SCHEDULED VEHICLE BOOKING ----
  IF v_intent.id IS NULL THEN
    SELECT * INTO v_intent
    FROM public.payment_intents
    WHERE (v_booking.payment_intent_id IS NOT NULL AND id = v_booking.payment_intent_id)
       OR (purpose = 'vehicle_booking' AND reference_id = v_booking.id)
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;
  END IF;

  v_utr_ref := v_intent.upi_utr_ref;

  IF v_decision = 'verify' THEN
    IF v_booking.status NOT IN ('soft_hold', 'pending_payment_confirm', 'confirmed') THEN
      RAISE EXCEPTION 'Vehicle booking % cannot be verified from status "%".', v_booking.booking_code, v_booking.status
        USING ERRCODE = 'P0001';
    END IF;

    UPDATE public.vehicle_bookings
    SET
      status = 'confirmed',
      hold_expires_at = NULL,
      mediator_id = COALESCE(mediator_id, v_uid),
      payment_verified_by = v_uid,
      payment_verified_at = now(),
      escrow_status = 'escrow_held',
      updated_at = now()
    WHERE id = v_booking.id;

    IF v_intent.id IS NOT NULL AND v_intent.status <> 'succeeded' THEN
      UPDATE public.payment_intents
      SET
        status = 'succeeded',
        verified_by = v_uid,
        provider_payment_id = COALESCE(provider_payment_id, v_utr_ref),
        updated_at = now()
      WHERE id = v_intent.id;
    END IF;

    PERFORM public._log_mediator_audit_v19a(
      v_uid,
      'mediator_verify_upi_payment',
      'vehicle_bookings',
      v_booking.id::text,
      v_booking.booking_code,
      'Verified UPI advance and confirmed vehicle booking ' || v_booking.booking_code,
      jsonb_build_object(
        'decision', 'verify',
        'domain', 'vehicle_booking',
        'booking_code', v_booking.booking_code,
        'amount_inr', COALESCE(v_intent.amount_inr, v_booking.advance_amount_inr),
        'utr_ref', v_utr_ref,
        'notes', v_notes
      )
    );

    RETURN jsonb_build_object(
      'ok', true,
      'domain', 'vehicle_booking',
      'booking_id', v_booking.id,
      'code', v_booking.booking_code,
      'status', 'confirmed',
      'verified_at', now()
    );
  ELSE
    UPDATE public.vehicle_bookings
    SET
      status = 'cancelled',
      hold_expires_at = NULL,
      mediator_id = COALESCE(mediator_id, v_uid),
      escrow_status = 'rejected',
      dispute_reason = v_notes,
      updated_at = now()
    WHERE id = v_booking.id
      AND status IN ('soft_hold', 'pending_payment_confirm');

    IF v_intent.id IS NOT NULL AND v_intent.status IN ('awaiting_payment', 'pending_manual') THEN
      UPDATE public.payment_intents
      SET
        status = 'rejected',
        verified_by = v_uid,
        refund_notes = v_notes,
        updated_at = now()
      WHERE id = v_intent.id;
    END IF;

    PERFORM public._log_mediator_audit_v19a(
      v_uid,
      'mediator_reject_upi_payment',
      'vehicle_bookings',
      v_booking.id::text,
      v_booking.booking_code,
      'Rejected UPI payment for vehicle booking ' || v_booking.booking_code || ': ' || v_notes,
      jsonb_build_object(
        'decision', 'reject',
        'domain', 'vehicle_booking',
        'booking_code', v_booking.booking_code,
        'amount_inr', COALESCE(v_intent.amount_inr, v_booking.advance_amount_inr),
        'utr_ref', v_utr_ref,
        'reason', v_notes
      )
    );

    RETURN jsonb_build_object(
      'ok', true,
      'domain', 'vehicle_booking',
      'booking_id', v_booking.id,
      'code', v_booking.booking_code,
      'status', 'cancelled',
      'rejected', true
    );
  END IF;
END;
$$;

-- [v21a] Re-issued from 20261126_pass_v19a_mediator_escrow_and_utr_guard.sql:1015 with targeted patches.
CREATE OR REPLACE FUNCTION public.mediator_dispatch_driver(
  p_booking_id uuid,
  p_driver_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_reason text := NULLIF(trim(COALESCE(p_reason, '')), '');
  v_driver public.drivers%ROWTYPE;
  v_order public.delivery_orders%ROWTYPE;
  v_booking public.vehicle_bookings%ROWTYPE;
  v_listing public.vehicle_listings%ROWTYPE;
  v_required_slug text;
  v_driver_canonical_slug text;
  v_escrow_required boolean := true;
  v_vehicle_id uuid;
  v_is_reassignment boolean := false;
BEGIN
  IF v_uid IS NULL OR NOT public.is_pnd_mediator(v_uid) THEN
    RAISE EXCEPTION 'Forbidden: Only authorized Dispatch Mediators, Hub Managers, or Admins may dispatch drivers.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_driver
  FROM public.drivers
  WHERE id = p_driver_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected driver was not found.'
      USING ERRCODE = 'P0002';
  END IF;

  IF COALESCE(v_driver.is_active, false) = false
     OR (COALESCE(v_driver.kyc_verified, false) = false AND COALESCE(v_driver.kyc_status, 'pending') <> 'verified') THEN
    RAISE EXCEPTION 'Only active, KYC-verified drivers may be dispatched.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Canonicalize legacy driver vehicle_type aliases to the 5 fleet classes
  v_driver_canonical_slug := CASE lower(COALESCE(v_driver.vehicle_type, ''))
    WHEN 'auto' THEN 'e_rickshaw'
    WHEN 'car' THEN 'mini_van'
    ELSE lower(COALESCE(v_driver.vehicle_type, ''))
  END;

  -- Check Pick N Drop delivery_orders first
  SELECT * INTO v_order FROM public.delivery_orders WHERE id = p_booking_id FOR UPDATE;
  IF FOUND THEN
    PERFORM public._v21a_assert_dispatch_hub_scope(v_uid, v_order.hub_id);
    SELECT COALESCE(p.escrow_required, true)
      INTO v_escrow_required
    FROM public.payment_feature_policies p
    WHERE p.scope_key = 'pnd';

    IF v_escrow_required AND v_order.status NOT IN ('escrow_held', 'driver_assigned') THEN
      RAISE EXCEPTION 'Order % requires funded escrow before driver dispatch (current status: "%").',
        v_order.order_code, v_order.status
        USING ERRCODE = 'P0001';
    ELSIF NOT v_escrow_required AND v_order.status NOT IN ('awaiting_payment', 'payment_submitted', 'escrow_held', 'driver_assigned') THEN
      RAISE EXCEPTION 'Order % cannot be dispatched from status "%".', v_order.order_code, v_order.status
        USING ERRCODE = 'P0001';
    END IF;

    SELECT lower(vt.slug) INTO v_required_slug
    FROM public.vehicle_types vt
    WHERE vt.id = v_order.vehicle_type_id;

    -- Find a matching vehicle for this driver if registered
    SELECT v.id INTO v_vehicle_id
    FROM public.vehicles v
    WHERE v.driver_id = v_driver.id
      AND v.vehicle_type_id = v_order.vehicle_type_id
    ORDER BY COALESCE(v.is_available, true) DESC, v.updated_at DESC
    LIMIT 1;

    IF v_required_slug IS NOT NULL
       AND v_driver_canonical_slug <> v_required_slug
       AND v_vehicle_id IS NULL THEN
      RAISE EXCEPTION 'Driver fleet class (%) does not match required vehicle class (%).',
        v_driver.vehicle_type, v_required_slug
        USING ERRCODE = '22023';
    END IF;

    v_is_reassignment := (v_order.driver_id IS NOT NULL AND v_order.driver_id <> v_driver.id);

    UPDATE public.delivery_orders
    SET
      driver_id = v_driver.id,
      vehicle_id = COALESCE(v_vehicle_id, vehicle_id),
      mediator_id = COALESCE(mediator_id, v_uid),
      status = 'driver_assigned',
      updated_at = now()
    WHERE id = v_order.id;

    INSERT INTO public.delivery_order_events (order_id, actor_id, event_type, payload)
    VALUES (
      v_order.id,
      v_uid,
      CASE WHEN v_is_reassignment THEN 'driver_reassigned' ELSE 'driver_assigned' END,
      jsonb_build_object(
        'previous_driver_id', v_order.driver_id,
        'driver_id', v_driver.id,
        'driver_name', v_driver.full_name,
        'vehicle_id', v_vehicle_id,
        'reason', v_reason
      )
    );

    PERFORM public._log_mediator_audit_v19a(
      v_uid,
      CASE WHEN v_is_reassignment THEN 'mediator_reassign_driver' ELSE 'mediator_dispatch_driver' END,
      'delivery_orders',
      v_order.id::text,
      v_order.order_code,
      (CASE WHEN v_is_reassignment THEN 'Reassigned' ELSE 'Dispatched' END)
        || ' driver ' || v_driver.full_name || ' to ' || v_order.order_code,
      jsonb_build_object(
        'domain', 'pick_n_drop',
        'order_code', v_order.order_code,
        'previous_driver_id', v_order.driver_id,
        'driver_id', v_driver.id,
        'driver_name', v_driver.full_name,
        'vehicle_class', v_required_slug,
        'reason', v_reason
      )
    );

    RETURN jsonb_build_object(
      'ok', true,
      'domain', 'pick_n_drop',
      'booking_id', v_order.id,
      'code', v_order.order_code,
      'driver_id', v_driver.id,
      'driver_name', v_driver.full_name,
      'status', 'driver_assigned',
      'reassigned', v_is_reassignment
    );
  END IF;

  -- Check Scheduled Vehicle bookings
  SELECT * INTO v_booking FROM public.vehicle_bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found.'
      USING ERRCODE = 'P0002';
  END IF;

  PERFORM public._v21a_assert_dispatch_hub_scope(v_uid, v_booking.hub_id);

  SELECT COALESCE(p.escrow_required, true)
    INTO v_escrow_required
  FROM public.payment_feature_policies p
  WHERE p.scope_key = 'vehicles';

  IF v_escrow_required AND v_booking.status NOT IN ('confirmed', 'in_progress') THEN
    RAISE EXCEPTION 'Vehicle booking % must be funded and confirmed before driver dispatch (current status: "%").',
      v_booking.booking_code, v_booking.status
      USING ERRCODE = 'P0001';
  ELSIF NOT v_escrow_required AND v_booking.status NOT IN ('soft_hold', 'pending_payment_confirm', 'confirmed', 'in_progress') THEN
    RAISE EXCEPTION 'Vehicle booking % cannot be dispatched from status "%".', v_booking.booking_code, v_booking.status
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_listing FROM public.vehicle_listings WHERE id = v_booking.vehicle_listing_id;
  IF FOUND THEN
    SELECT lower(vt.slug) INTO v_required_slug
    FROM public.vehicle_types vt
    WHERE vt.id = v_listing.vehicle_type_id;

    SELECT v.id INTO v_vehicle_id
    FROM public.vehicles v
    WHERE v.driver_id = v_driver.id
      AND v.vehicle_type_id = v_listing.vehicle_type_id
    LIMIT 1;

    IF v_required_slug IS NOT NULL
       AND v_driver_canonical_slug <> v_required_slug
       AND v_vehicle_id IS NULL THEN
      RAISE EXCEPTION 'Driver fleet class (%) does not match required vehicle class (%).',
        v_driver.vehicle_type, v_required_slug
        USING ERRCODE = '22023';
    END IF;
  END IF;

  v_is_reassignment := (v_booking.assigned_driver_id IS NOT NULL AND v_booking.assigned_driver_id <> v_driver.id);

  UPDATE public.vehicle_bookings
  SET
    assigned_driver_id = v_driver.id,
    mediator_id = COALESCE(mediator_id, v_uid),
    updated_at = now()
  WHERE id = v_booking.id;

  PERFORM public._log_mediator_audit_v19a(
    v_uid,
    CASE WHEN v_is_reassignment THEN 'mediator_reassign_driver' ELSE 'mediator_dispatch_driver' END,
    'vehicle_bookings',
    v_booking.id::text,
    v_booking.booking_code,
    (CASE WHEN v_is_reassignment THEN 'Reassigned' ELSE 'Dispatched' END)
      || ' driver ' || v_driver.full_name || ' to vehicle booking ' || v_booking.booking_code,
    jsonb_build_object(
      'domain', 'vehicle_booking',
      'booking_code', v_booking.booking_code,
      'previous_driver_id', v_booking.assigned_driver_id,
      'driver_id', v_driver.id,
      'driver_name', v_driver.full_name,
      'vehicle_class', v_required_slug,
      'reason', v_reason
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'domain', 'vehicle_booking',
    'booking_id', v_booking.id,
    'code', v_booking.booking_code,
    'driver_id', v_driver.id,
    'driver_name', v_driver.full_name,
    'status', v_booking.status,
    'reassigned', v_is_reassignment
  );
END;
$$;

-- [v21a] Re-issued from 20261126_pass_v19a_mediator_escrow_and_utr_guard.sql:1245 with targeted patches.
CREATE OR REPLACE FUNCTION public.mediator_resolve_escrow_payout(
  p_booking_id uuid,
  p_action text,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_action text := lower(trim(COALESCE(p_action, '')));
  v_reason text := NULLIF(trim(COALESCE(p_reason, '')), '');
  v_order public.delivery_orders%ROWTYPE;
  v_secret public.delivery_order_secrets%ROWTYPE;
  v_booking public.vehicle_bookings%ROWTYPE;
  v_votp public.vehicle_booking_otps%ROWTYPE;
  v_intent public.payment_intents%ROWTYPE;
  v_otp_completed boolean := false;
  v_commission_rate numeric(4,2) := 0.15;
  v_commission_inr numeric(10,2);
  v_driver_payout_inr numeric(10,2);
  v_purge_at timestamptz := now() + interval '48 hours';
  v_already_paid boolean := false;
BEGIN
  IF v_uid IS NULL OR NOT public.is_pnd_mediator(v_uid) THEN
    RAISE EXCEPTION 'Forbidden: Only authorized Dispatch Mediators, Hub Managers, or Admins may resolve escrow payouts.'
      USING ERRCODE = '42501';
  END IF;

  IF v_action NOT IN ('release_to_driver', 'freeze_dispute', 'refund_customer') THEN
    RAISE EXCEPTION 'Invalid escrow action "%". Expected release_to_driver, freeze_dispute, or refund_customer.', p_action
      USING ERRCODE = '22023';
  END IF;

  IF v_action IN ('freeze_dispute', 'refund_customer') AND (v_reason IS NULL OR length(v_reason) < 3) THEN
    RAISE EXCEPTION 'A clear resolution reason (at least 3 characters) is mandatory for "%".', v_action
      USING ERRCODE = '22023';
  END IF;

  -- Check Pick N Drop delivery_orders first
  SELECT * INTO v_order FROM public.delivery_orders WHERE id = p_booking_id FOR UPDATE;
  IF FOUND THEN
    PERFORM public._v21a_assert_dispatch_hub_scope(v_uid, v_order.hub_id);

    -- v21a: escrow state-machine guards
    IF v_order.status = 'cancelled' THEN
      RAISE EXCEPTION 'Order % is already cancelled/refunded; no further escrow action is possible.', v_order.order_code
        USING ERRCODE = 'P0001';
    END IF;
    IF v_order.payout_released_at IS NOT NULL THEN
      RAISE EXCEPTION 'Escrow payout for % was already released; escalate post-payout disputes to Super-Admin.', v_order.order_code
        USING ERRCODE = 'P0001';
    END IF;
    -- Money is only refundable / releasable once the payment was actually verified
    IF v_action IN ('refund_customer', 'release_to_driver')
       AND v_order.payment_verified_at IS NULL
       AND v_order.status NOT IN ('escrow_held', 'driver_assigned', 'picked_up', 'in_transit',
                                  'delivered_pending_confirm', 'return_in_transit')
       AND NOT EXISTS (
         SELECT 1 FROM public.payment_intents pi
         WHERE pi.purpose = 'pick_n_drop' AND pi.reference_id = v_order.id AND pi.status = 'succeeded'
       ) THEN
      RAISE EXCEPTION 'Order % has no verified customer payment (status: "%"). Verify or reject the UPI proof first.', v_order.order_code, v_order.status
        USING ERRCODE = 'P0001';
    END IF;
    IF v_action = 'release_to_driver' AND v_order.driver_id IS NULL THEN
      RAISE EXCEPTION 'Order % has no assigned driver; nothing can be paid out.', v_order.order_code
        USING ERRCODE = 'P0001';
    END IF;
    IF v_action = 'freeze_dispute' AND v_order.status IN ('completed', 'awaiting_payment') THEN
      RAISE EXCEPTION 'Order % cannot be frozen in status "%".', v_order.order_code, v_order.status
        USING ERRCODE = 'P0001';
    END IF;
    SELECT * INTO v_secret FROM public.delivery_order_secrets WHERE order_id = v_order.id;
    SELECT * INTO v_intent
    FROM public.payment_intents
    WHERE purpose = 'pick_n_drop' AND reference_id = v_order.id
    ORDER BY created_at DESC
    LIMIT 1
    FOR UPDATE;

    IF v_action = 'release_to_driver' THEN
      -- Check handover OTP completion (NEVER exposes OTP codes)
      IF v_order.trip_type = 'two_way' THEN
        v_otp_completed := (
          (v_secret.dropoff_verified_at IS NOT NULL AND v_secret.return_verified_at IS NOT NULL)
          OR v_order.status = 'delivered_pending_confirm'
        );
      ELSE
        v_otp_completed := (
          v_secret.dropoff_verified_at IS NOT NULL
          OR v_order.status = 'delivered_pending_confirm'
        );
      END IF;

      IF NOT v_otp_completed THEN
        IF v_order.status = 'disputed' AND v_reason IS NOT NULL AND length(v_reason) >= 5 THEN
          -- Explicit reasoned dispute override permitted strictly on disputed bookings
          NULL;
        ELSE
          RAISE EXCEPTION 'Escrow payout cannot be released until dropoff/return OTP handover is verified (or an open dispute is resolved with a detailed override reason).'
            USING ERRCODE = 'P0001';
        END IF;
      END IF;

      SELECT EXISTS (
        SELECT 1
        FROM public.delivery_transactions
        WHERE order_id = v_order.id
          AND tx_type = 'driver_payout'
      ) INTO v_already_paid;

      v_commission_inr := round(v_order.quoted_fare_inr * v_commission_rate, 2);
      v_driver_payout_inr := round(v_order.quoted_fare_inr - v_commission_inr, 2);

      UPDATE public.delivery_orders
      SET
        status = 'completed',
        mediator_id = COALESCE(mediator_id, v_uid),
        payout_released_at = now(),
        pod_purge_at = COALESCE(pod_purge_at, v_purge_at),
        updated_at = now()
      WHERE id = v_order.id;

      IF NOT v_already_paid THEN
        INSERT INTO public.delivery_transactions (order_id, tx_type, amount_inr, recorded_by, status, notes)
        VALUES
          (
            v_order.id,
            'driver_payout',
            v_driver_payout_inr,
            v_uid,
            'verified',
            COALESCE(v_reason, 'Escrow released to driver upon verified handover (85%)')
          ),
          (
            v_order.id,
            'platform_commission',
            v_commission_inr,
            v_uid,
            'verified',
            'Platform mediation commission upon escrow release (15%)'
          );
      END IF;

      INSERT INTO public.delivery_order_events (order_id, actor_id, event_type, payload)
      VALUES (
        v_order.id,
        v_uid,
        'escrow_payout_released',
        jsonb_build_object(
          'previous_status', v_order.status,
          'driver_payout_inr', v_driver_payout_inr,
          'platform_commission_inr', v_commission_inr,
          'otp_verified_handover', v_otp_completed,
          'dispute_override', (NOT v_otp_completed),
          'reason', v_reason,
          'pod_purge_at', COALESCE(v_order.pod_purge_at, v_purge_at)
        )
      );

      PERFORM public._log_mediator_audit_v19a(
        v_uid,
        'mediator_release_escrow_payout',
        'delivery_orders',
        v_order.id::text,
        v_order.order_code,
        'Released escrow payout (₹' || v_driver_payout_inr::text || ') for ' || v_order.order_code,
        jsonb_build_object(
          'action', 'release_to_driver',
          'domain', 'pick_n_drop',
          'order_code', v_order.order_code,
          'driver_payout_inr', v_driver_payout_inr,
          'platform_commission_inr', v_commission_inr,
          'otp_verified_handover', v_otp_completed,
          'reason', v_reason,
          'pod_purge_at', COALESCE(v_order.pod_purge_at, v_purge_at)
        )
      );

      RETURN jsonb_build_object(
        'ok', true,
        'domain', 'pick_n_drop',
        'booking_id', v_order.id,
        'code', v_order.order_code,
        'status', 'completed',
        'driver_payout_inr', v_driver_payout_inr,
        'platform_commission_inr', v_commission_inr,
        'pod_purge_at', COALESCE(v_order.pod_purge_at, v_purge_at)
      );

    ELSIF v_action = 'freeze_dispute' THEN
      UPDATE public.delivery_orders
      SET
        status = 'disputed',
        mediator_id = COALESCE(mediator_id, v_uid),
        dispute_reason = v_reason,
        updated_at = now()
      WHERE id = v_order.id;

      INSERT INTO public.delivery_order_events (order_id, actor_id, event_type, payload)
      VALUES (
        v_order.id,
        v_uid,
        'escrow_frozen_dispute',
        jsonb_build_object(
          'previous_status', v_order.status,
          'reason', v_reason
        )
      );

      PERFORM public._log_mediator_audit_v19a(
        v_uid,
        'mediator_freeze_escrow_dispute',
        'delivery_orders',
        v_order.id::text,
        v_order.order_code,
        'Froze escrow under dispute for ' || v_order.order_code || ': ' || v_reason,
        jsonb_build_object(
          'action', 'freeze_dispute',
          'domain', 'pick_n_drop',
          'order_code', v_order.order_code,
          'previous_status', v_order.status,
          'reason', v_reason
        )
      );

      RETURN jsonb_build_object(
        'ok', true,
        'domain', 'pick_n_drop',
        'booking_id', v_order.id,
        'code', v_order.order_code,
        'status', 'disputed'
      );

    ELSE
      -- refund_customer
      UPDATE public.delivery_orders
      SET
        status = 'cancelled',
        mediator_id = COALESCE(mediator_id, v_uid),
        dispute_reason = v_reason,
        updated_at = now()
      WHERE id = v_order.id;

      INSERT INTO public.delivery_transactions (order_id, tx_type, amount_inr, recorded_by, status, notes)
      VALUES (
        v_order.id,
        'refund',
        v_order.quoted_fare_inr,
        v_uid,
        'refunded',
        'Escrow refund approved by Dispatch Mediator: ' || v_reason
      );

      IF v_intent.id IS NOT NULL THEN
        UPDATE public.payment_intents
        SET
          status = 'refunded',
          refund_notes = v_reason,
          verified_by = COALESCE(verified_by, v_uid),
          updated_at = now()
        WHERE id = v_intent.id;
      END IF;

      INSERT INTO public.delivery_order_events (order_id, actor_id, event_type, payload)
      VALUES (
        v_order.id,
        v_uid,
        'escrow_refunded_customer',
        jsonb_build_object(
          'previous_status', v_order.status,
          'refund_amount_inr', v_order.quoted_fare_inr,
          'reason', v_reason
        )
      );

      PERFORM public._log_mediator_audit_v19a(
        v_uid,
        'mediator_refund_escrow_customer',
        'delivery_orders',
        v_order.id::text,
        v_order.order_code,
        'Approved customer escrow refund (₹' || v_order.quoted_fare_inr::text || ') for ' || v_order.order_code,
        jsonb_build_object(
          'action', 'refund_customer',
          'domain', 'pick_n_drop',
          'order_code', v_order.order_code,
          'refund_amount_inr', v_order.quoted_fare_inr,
          'reason', v_reason
        )
      );

      RETURN jsonb_build_object(
        'ok', true,
        'domain', 'pick_n_drop',
        'booking_id', v_order.id,
        'code', v_order.order_code,
        'status', 'cancelled',
        'refunded', true
      );
    END IF;
  END IF;

  -- Check Scheduled Vehicle bookings
  SELECT * INTO v_booking FROM public.vehicle_bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found.'
      USING ERRCODE = 'P0002';
  END IF;

  PERFORM public._v21a_assert_dispatch_hub_scope(v_uid, v_booking.hub_id);

  -- v21a: escrow state-machine guards (completed charters stay releasable until escrow is released)
  IF COALESCE(v_booking.escrow_status, 'unpaid') IN ('released', 'refunded') THEN
    RAISE EXCEPTION 'Escrow for booking % is already %; no further escrow action is possible.',
      v_booking.booking_code, v_booking.escrow_status
      USING ERRCODE = 'P0001';
  END IF;
  IF v_action = 'refund_customer'
     AND v_booking.payment_verified_at IS NULL
     AND COALESCE(v_booking.escrow_status, 'unpaid') NOT IN ('escrow_held', 'frozen_dispute') THEN
    RAISE EXCEPTION 'Booking % has no verified customer payment to refund (status: "%"). Verify or reject the UPI proof first.',
      v_booking.booking_code, v_booking.status
      USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_votp FROM public.vehicle_booking_otps WHERE booking_id = v_booking.id;
  SELECT * INTO v_intent
  FROM public.payment_intents
  WHERE (v_booking.payment_intent_id IS NOT NULL AND id = v_booking.payment_intent_id)
     OR (purpose = 'vehicle_booking' AND reference_id = v_booking.id)
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_action = 'release_to_driver' THEN
    v_otp_completed := (
      v_votp.dropoff_verified_at IS NOT NULL
      OR v_booking.status = 'completed'
    );

    IF NOT v_otp_completed THEN
      IF v_booking.status = 'disputed' AND v_reason IS NOT NULL AND length(v_reason) >= 5 THEN
        NULL;
      ELSE
        RAISE EXCEPTION 'Vehicle booking payout cannot be released until dropoff OTP is verified (or an open dispute is resolved with a detailed override reason).'
          USING ERRCODE = 'P0001';
      END IF;
    END IF;

    UPDATE public.vehicle_bookings
    SET
      status = 'completed',
      escrow_status = 'released',
      mediator_id = COALESCE(mediator_id, v_uid),
      payout_released_at = now(),
      pod_purge_at = COALESCE(pod_purge_at, v_purge_at),
      updated_at = now()
    WHERE id = v_booking.id;

    PERFORM public._log_mediator_audit_v19a(
      v_uid,
      'mediator_release_escrow_payout',
      'vehicle_bookings',
      v_booking.id::text,
      v_booking.booking_code,
      'Released escrow advance payout (₹' || v_booking.advance_amount_inr::text || ') for ' || v_booking.booking_code,
      jsonb_build_object(
        'action', 'release_to_driver',
        'domain', 'vehicle_booking',
        'booking_code', v_booking.booking_code,
        'advance_amount_inr', v_booking.advance_amount_inr,
        'otp_verified_handover', v_otp_completed,
        'reason', v_reason
      )
    );

    RETURN jsonb_build_object(
      'ok', true,
      'domain', 'vehicle_booking',
      'booking_id', v_booking.id,
      'code', v_booking.booking_code,
      'status', 'completed',
      'escrow_status', 'released'
    );

  ELSIF v_action = 'freeze_dispute' THEN
    UPDATE public.vehicle_bookings
    SET
      status = 'disputed',
      escrow_status = 'frozen_dispute',
      mediator_id = COALESCE(mediator_id, v_uid),
      dispute_reason = v_reason,
      updated_at = now()
    WHERE id = v_booking.id;

    PERFORM public._log_mediator_audit_v19a(
      v_uid,
      'mediator_freeze_escrow_dispute',
      'vehicle_bookings',
      v_booking.id::text,
      v_booking.booking_code,
      'Froze vehicle escrow under dispute for ' || v_booking.booking_code || ': ' || v_reason,
      jsonb_build_object(
        'action', 'freeze_dispute',
        'domain', 'vehicle_booking',
        'booking_code', v_booking.booking_code,
        'previous_status', v_booking.status,
        'reason', v_reason
      )
    );

    RETURN jsonb_build_object(
      'ok', true,
      'domain', 'vehicle_booking',
      'booking_id', v_booking.id,
      'code', v_booking.booking_code,
      'status', 'disputed'
    );

  ELSE
    -- refund_customer
    UPDATE public.vehicle_bookings
    SET
      status = 'cancelled',
      escrow_status = 'refunded',
      mediator_id = COALESCE(mediator_id, v_uid),
      dispute_reason = v_reason,
      updated_at = now()
    WHERE id = v_booking.id;

    IF v_intent.id IS NOT NULL THEN
      UPDATE public.payment_intents
      SET
        status = 'refunded',
        refund_notes = v_reason,
        verified_by = COALESCE(verified_by, v_uid),
        updated_at = now()
      WHERE id = v_intent.id;
    END IF;

    PERFORM public._log_mediator_audit_v19a(
      v_uid,
      'mediator_refund_escrow_customer',
      'vehicle_bookings',
      v_booking.id::text,
      v_booking.booking_code,
      'Approved customer refund (₹' || v_booking.advance_amount_inr::text || ') for ' || v_booking.booking_code,
      jsonb_build_object(
        'action', 'refund_customer',
        'domain', 'vehicle_booking',
        'booking_code', v_booking.booking_code,
        'refund_amount_inr', v_booking.advance_amount_inr,
        'reason', v_reason
      )
    );

    RETURN jsonb_build_object(
      'ok', true,
      'domain', 'vehicle_booking',
      'booking_id', v_booking.id,
      'code', v_booking.booking_code,
      'status', 'cancelled',
      'refunded', true
    );
  END IF;
END;
$$;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN ('mediator_verify_upi_payment', 'mediator_dispatch_driver', 'mediator_resolve_escrow_payout')
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO authenticated', r.sig);
  END LOOP;
END;
$$;

-- =============================================================================
-- §6. ZERO-TRUST OTP RLS & VERTICAL ORDER FORGERY LOCKS (P0-14)
-- =============================================================================

-- 6A. Raw handover OTPs: ONLY the paying customer may read them (no mediator / operator)
DROP POLICY IF EXISTS "delivery_order_secrets_sender_mediator_select" ON public.delivery_order_secrets;
DROP POLICY IF EXISTS delivery_order_secrets_customer_select_v21a ON public.delivery_order_secrets;
CREATE POLICY delivery_order_secrets_customer_select_v21a
  ON public.delivery_order_secrets
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.delivery_orders o
      WHERE o.id = delivery_order_secrets.order_id
        AND o.customer_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "vehicle_booking_otps_customer_mediator_select" ON public.vehicle_booking_otps;
DROP POLICY IF EXISTS vehicle_booking_otps_customer_select_v21a ON public.vehicle_booking_otps;
CREATE POLICY vehicle_booking_otps_customer_select_v21a
  ON public.vehicle_booking_otps
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.vehicle_bookings vb
      WHERE vb.id = vehicle_booking_otps.booking_id
        AND vb.customer_id = auth.uid()
    )
  );

-- 6B. Mediators can no longer submit OTPs through the legacy verifier
-- [v21a] Re-issued from 20261126_pass_v19a_mediator_escrow_and_utr_guard.sql:207 with targeted patches.
CREATE OR REPLACE FUNCTION public.verify_delivery_otp(
  p_order_id uuid,
  p_stage text,
  p_otp text,
  p_pod_path text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_order public.delivery_orders%ROWTYPE;
  v_secret public.delivery_order_secrets%ROWTYPE;
  v_is_assigned_driver boolean := false;
  v_is_mediator boolean := false;
  v_stage text := lower(trim(COALESCE(p_stage, '')));
  v_otp text := trim(COALESCE(p_otp, ''));
  v_pod_path text := NULLIF(trim(COALESCE(p_pod_path, '')), '');
  v_expected_otp text;
  v_next_status text;
  v_next_attempts integer;
  v_lock_until timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required to verify delivery OTP.';
  END IF;

  IF v_stage NOT IN ('pickup', 'dropoff', 'return') THEN
    RAISE EXCEPTION 'Invalid OTP verification stage "%". Must be pickup, dropoff, or return.', p_stage;
  END IF;

  SELECT *
  INTO v_order
  FROM public.delivery_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Delivery order not found.';
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.drivers d
    WHERE d.id = v_order.driver_id
      AND d.profile_id = v_uid
  ) INTO v_is_assigned_driver;

  v_is_mediator := (v_order.mediator_id = v_uid) OR public.is_pnd_mediator(v_uid);

  -- v21a zero-trust: only the assigned driver may submit handover OTPs (mediators never see OTPs).
  IF NOT v_is_assigned_driver THEN
    RAISE EXCEPTION 'Forbidden: Only the assigned driver can verify handover OTPs.'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
  INTO v_secret
  FROM public.delivery_order_secrets
  WHERE order_id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OTP secret record not found for this delivery order.';
  END IF;

  IF v_secret.locked_until IS NOT NULL AND v_secret.locked_until > now() THEN
    RETURN jsonb_build_object(
      'ok', false,
      'code', 'OTP_LOCKED',
      'error', 'Too many failed OTP attempts. Verification is temporarily locked.',
      'failed_attempts', v_secret.failed_attempts,
      'locked_until', v_secret.locked_until
    );
  END IF;

  IF v_secret.locked_until IS NOT NULL AND v_secret.locked_until <= now() THEN
    v_secret.failed_attempts := 0;
    v_secret.locked_until := NULL;
    UPDATE public.delivery_order_secrets
    SET failed_attempts = 0, locked_until = NULL
    WHERE order_id = p_order_id;
  END IF;

  IF v_stage = 'pickup' THEN
    IF v_order.status NOT IN ('escrow_held', 'driver_assigned', 'picked_up') THEN
      RAISE EXCEPTION 'Order status "%" is not eligible for pickup OTP verification.', v_order.status;
    END IF;
    v_expected_otp := v_secret.pickup_otp;
    v_next_status := 'in_transit';

  ELSIF v_stage = 'dropoff' THEN
    IF v_order.status NOT IN ('picked_up', 'in_transit') THEN
      RAISE EXCEPTION 'Order status "%" is not eligible for dropoff OTP verification.', v_order.status;
    END IF;
    IF COALESCE(v_order.pod_required, true) = true AND v_pod_path IS NULL THEN
      RAISE EXCEPTION 'A Proof of Delivery (POD) photo storage path is required for dropoff verification.';
    END IF;
    v_expected_otp := v_secret.dropoff_otp;
    IF v_order.trip_type = 'two_way' THEN
      v_next_status := 'return_in_transit';
    ELSE
      v_next_status := 'delivered_pending_confirm';
    END IF;

  ELSIF v_stage = 'return' THEN
    IF v_order.trip_type <> 'two_way' THEN
      RAISE EXCEPTION 'Return OTP verification is only valid for two_way orders.';
    END IF;
    IF v_order.status <> 'return_in_transit' THEN
      RAISE EXCEPTION 'Order status "%" is not eligible for return OTP verification.', v_order.status;
    END IF;
    IF v_secret.return_otp IS NULL THEN
      RAISE EXCEPTION 'Return OTP is not configured for this order.';
    END IF;
    v_expected_otp := v_secret.return_otp;
    v_next_status := 'delivered_pending_confirm';
  END IF;

  IF v_otp = '' OR v_otp <> v_expected_otp THEN
    v_next_attempts := v_secret.failed_attempts + 1;
    v_lock_until := CASE
      WHEN v_next_attempts >= 5 THEN now() + interval '15 minutes'
      ELSE NULL
    END;

    UPDATE public.delivery_order_secrets
    SET
      failed_attempts = v_next_attempts,
      locked_until = v_lock_until
    WHERE order_id = p_order_id;

    INSERT INTO public.delivery_order_events (order_id, actor_id, event_type, payload)
    VALUES (
      p_order_id,
      v_uid,
      'otp_verification_failed',
      jsonb_build_object(
        'stage', v_stage,
        'failed_attempts', v_next_attempts,
        'locked', (v_lock_until IS NOT NULL),
        'locked_until', v_lock_until
      )
    );

    RETURN jsonb_build_object(
      'ok', false,
      'code', CASE WHEN v_lock_until IS NOT NULL THEN 'OTP_LOCKED' ELSE 'INVALID_OTP' END,
      'error', CASE
        WHEN v_lock_until IS NOT NULL THEN 'Maximum OTP attempts exceeded. Locked for 15 minutes.'
        ELSE 'Invalid OTP. Please verify the 6-digit code and try again.'
      END,
      'failed_attempts', v_next_attempts,
      'attempts_remaining', GREATEST(0, 5 - v_next_attempts),
      'locked_until', v_lock_until
    );
  END IF;

  -- OTP matched: reset attempt counters & stamp milestone verification timestamp
  UPDATE public.delivery_order_secrets
  SET
    failed_attempts = 0,
    locked_until = NULL,
    pickup_verified_at = CASE WHEN v_stage = 'pickup' THEN now() ELSE pickup_verified_at END,
    dropoff_verified_at = CASE WHEN v_stage = 'dropoff' THEN now() ELSE dropoff_verified_at END,
    return_verified_at = CASE WHEN v_stage = 'return' THEN now() ELSE return_verified_at END
  WHERE order_id = p_order_id;

  IF v_stage = 'dropoff' AND v_pod_path IS NOT NULL THEN
    UPDATE public.delivery_orders
    SET
      status = v_next_status,
      pod_storage_path = v_pod_path,
      pod_uploaded_at = now(),
      updated_at = now()
    WHERE id = p_order_id;
  ELSE
    UPDATE public.delivery_orders
    SET
      status = v_next_status,
      updated_at = now()
    WHERE id = p_order_id;
  END IF;

  INSERT INTO public.delivery_order_events (order_id, actor_id, event_type, payload)
  VALUES (
    p_order_id,
    v_uid,
    'otp_verified_' || v_stage,
    jsonb_build_object(
      'stage', v_stage,
      'service_mode', v_order.service_mode,
      'pod_required', v_order.pod_required,
      'previous_status', v_order.status,
      'new_status', v_next_status,
      'pod_recorded', (v_stage = 'dropoff' AND v_pod_path IS NOT NULL)
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'order_id', p_order_id,
    'stage', v_stage,
    'previous_status', v_order.status,
    'status', v_next_status,
    'pod_storage_path', CASE WHEN v_stage = 'dropoff' THEN v_pod_path ELSE v_order.pod_storage_path END
  );
END;
$$;

-- 6C. Customer-only OTP vault for vertical orders. Operators read print/shop/restaurant/
--     booking rows with `select('*')`; the plaintext display OTP now never lands on those
--     rows (a BEFORE trigger moves it into this RLS-protected vault and blanks the column).
CREATE TABLE IF NOT EXISTS public.vertical_order_customer_otps (
  order_table text NOT NULL CHECK (
    order_table IN ('print_orders', 'shop_orders', 'restaurant_orders', 'resource_bookings')
  ),
  order_id uuid NOT NULL,
  customer_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  otp_display text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (order_table, order_id)
);

CREATE INDEX IF NOT EXISTS idx_vertical_order_customer_otps_customer
  ON public.vertical_order_customer_otps (customer_id, order_table);

ALTER TABLE public.vertical_order_customer_otps ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vertical_order_customer_otps_customer_select ON public.vertical_order_customer_otps;
CREATE POLICY vertical_order_customer_otps_customer_select
  ON public.vertical_order_customer_otps
  FOR SELECT
  TO authenticated
  USING (customer_id = auth.uid());

REVOKE INSERT, UPDATE, DELETE ON public.vertical_order_customer_otps FROM anon, authenticated;

CREATE OR REPLACE FUNCTION public.vault_vertical_order_customer_otp_v21a()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_col text := TG_ARGV[0];
  v_new jsonb := to_jsonb(NEW);
  v_otp text := NULLIF(trim(COALESCE(v_new ->> v_col, '')), '');
  v_customer uuid := NULLIF(v_new ->> 'customer_id', '')::uuid;
BEGIN
  IF v_otp IS NULL THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.vertical_order_customer_otps (order_table, order_id, customer_id, otp_display)
  VALUES (TG_TABLE_NAME, NEW.id, v_customer, v_otp)
  ON CONFLICT (order_table, order_id) DO UPDATE
  SET
    otp_display = EXCLUDED.otp_display,
    customer_id = COALESCE(EXCLUDED.customer_id, public.vertical_order_customer_otps.customer_id),
    updated_at = now();

  NEW := jsonb_populate_record(NEW, jsonb_build_object(v_col, NULL));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_vault_print_order_otp_v21a ON public.print_orders;
CREATE TRIGGER trg_vault_print_order_otp_v21a
  BEFORE INSERT OR UPDATE OF collection_otp_display_for_customer ON public.print_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.vault_vertical_order_customer_otp_v21a('collection_otp_display_for_customer');

DROP TRIGGER IF EXISTS trg_vault_shop_order_otp_v21a ON public.shop_orders;
CREATE TRIGGER trg_vault_shop_order_otp_v21a
  BEFORE INSERT OR UPDATE OF pickup_otp_display_for_customer ON public.shop_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.vault_vertical_order_customer_otp_v21a('pickup_otp_display_for_customer');

DROP TRIGGER IF EXISTS trg_vault_restaurant_order_otp_v21a ON public.restaurant_orders;
CREATE TRIGGER trg_vault_restaurant_order_otp_v21a
  BEFORE INSERT OR UPDATE OF pickup_otp_display_for_customer ON public.restaurant_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.vault_vertical_order_customer_otp_v21a('pickup_otp_display_for_customer');

DROP TRIGGER IF EXISTS trg_vault_resource_booking_otp_v21a ON public.resource_bookings;
CREATE TRIGGER trg_vault_resource_booking_otp_v21a
  BEFORE INSERT OR UPDATE OF checkin_otp_display_for_customer ON public.resource_bookings
  FOR EACH ROW
  EXECUTE FUNCTION public.vault_vertical_order_customer_otp_v21a('checkin_otp_display_for_customer');

-- Backfill existing plaintext OTPs into the vault, then blank the operator-visible columns
INSERT INTO public.vertical_order_customer_otps (order_table, order_id, customer_id, otp_display)
SELECT 'print_orders', po.id, po.customer_id, po.collection_otp_display_for_customer
FROM public.print_orders po
WHERE NULLIF(trim(COALESCE(po.collection_otp_display_for_customer, '')), '') IS NOT NULL
ON CONFLICT (order_table, order_id) DO NOTHING;

INSERT INTO public.vertical_order_customer_otps (order_table, order_id, customer_id, otp_display)
SELECT 'shop_orders', so.id, so.customer_id, so.pickup_otp_display_for_customer
FROM public.shop_orders so
WHERE NULLIF(trim(COALESCE(so.pickup_otp_display_for_customer, '')), '') IS NOT NULL
ON CONFLICT (order_table, order_id) DO NOTHING;

INSERT INTO public.vertical_order_customer_otps (order_table, order_id, customer_id, otp_display)
SELECT 'restaurant_orders', ro.id, ro.customer_id, ro.pickup_otp_display_for_customer
FROM public.restaurant_orders ro
WHERE NULLIF(trim(COALESCE(ro.pickup_otp_display_for_customer, '')), '') IS NOT NULL
ON CONFLICT (order_table, order_id) DO NOTHING;

INSERT INTO public.vertical_order_customer_otps (order_table, order_id, customer_id, otp_display)
SELECT 'resource_bookings', rb.id, rb.customer_id, rb.checkin_otp_display_for_customer
FROM public.resource_bookings rb
WHERE NULLIF(trim(COALESCE(rb.checkin_otp_display_for_customer, '')), '') IS NOT NULL
ON CONFLICT (order_table, order_id) DO NOTHING;

UPDATE public.print_orders SET collection_otp_display_for_customer = NULL
WHERE collection_otp_display_for_customer IS NOT NULL;
UPDATE public.shop_orders SET pickup_otp_display_for_customer = NULL
WHERE pickup_otp_display_for_customer IS NOT NULL;
UPDATE public.restaurant_orders SET pickup_otp_display_for_customer = NULL
WHERE pickup_otp_display_for_customer IS NOT NULL;
UPDATE public.resource_bookings SET checkin_otp_display_for_customer = NULL
WHERE checkin_otp_display_for_customer IS NOT NULL;

-- Customer-only readers
CREATE OR REPLACE FUNCTION public.get_my_vertical_order_otp(p_order_table text, p_order_id uuid)
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT v.otp_display
  FROM public.vertical_order_customer_otps v
  WHERE auth.uid() IS NOT NULL
    AND v.order_table = p_order_table
    AND v.order_id = p_order_id
    AND v.customer_id = auth.uid();
$$;

REVOKE ALL ON FUNCTION public.get_my_vertical_order_otp(text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_vertical_order_otp(text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_vertical_order_otp(text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_my_print_collection_otp(p_order_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  RETURN public.get_my_vertical_order_otp('print_orders', p_order_id);
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_print_collection_otp(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_print_collection_otp(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_print_collection_otp(uuid) TO authenticated;

-- 6D. Forgery locks: customers can no longer INSERT vertical orders/requests directly
--     (all creation flows run server-side via service_role API routes / RPCs).
DROP POLICY IF EXISTS "Customers can create own print orders" ON public.print_orders;
DROP POLICY IF EXISTS "Customers can insert own shop orders" ON public.shop_orders;
DROP POLICY IF EXISTS "Customers can insert own restaurant orders" ON public.restaurant_orders;
DROP POLICY IF EXISTS "Customers can insert own table reservations" ON public.restaurant_table_reservations;
DROP POLICY IF EXISTS "Requesters can insert own property visit requests" ON public.property_visit_requests;

DROP POLICY IF EXISTS "Customers and operators can insert resource bookings" ON public.resource_bookings;
DROP POLICY IF EXISTS resource_bookings_operator_insert_v21a ON public.resource_bookings;
CREATE POLICY resource_bookings_operator_insert_v21a
  ON public.resource_bookings
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_booking_operator_for(listing_id));

-- Customer UPDATE paths may not touch money/settlement/identity columns.
-- SECURITY INVOKER so `current_user` distinguishes direct client writes from trusted RPCs.
CREATE OR REPLACE FUNCTION public.guard_vertical_order_customer_writes_v21a()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_operator_fn text := TG_ARGV[0];
  v_new jsonb := to_jsonb(NEW);
  v_old jsonb := to_jsonb(OLD);
  v_listing uuid := NULLIF(v_new ->> 'listing_id', '')::uuid;
  v_hub uuid := NULLIF(v_new ->> 'hub_id', '')::uuid;
  v_is_operator boolean := false;
  v_key text;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF public.is_super_admin() OR public.is_hub_manager_for(v_hub) THEN
    RETURN NEW;
  END IF;

  IF v_operator_fn IS NOT NULL THEN
    EXECUTE format('SELECT public.%I($1)', v_operator_fn)
      INTO v_is_operator
      USING v_listing;
    IF COALESCE(v_is_operator, false) THEN
      RETURN NEW;
    END IF;
  END IF;

  FOREACH v_key IN ARRAY ARRAY[
    'customer_id', 'listing_id', 'hub_id', 'payment_status', 'settlement_status',
    'payment_rail', 'payment_intent_id', 'quoted_amount_inr', 'platform_fee_inr',
    'quote_snapshot', 'quote_status', 'subtotal_inr', 'packaging_fee_inr', 'delivery_fee_inr',
    'total_amount_inr', 'advance_amount_inr', 'balance_at_venue_inr', 'convenience_fee_inr',
    'price_snapshot', 'collection_otp_hash', 'pickup_otp_hash', 'checkin_otp_hash',
    'order_status', 'kitchen_status', 'booking_status', 'is_first_party_order'
  ]
  LOOP
    IF (v_new -> v_key) IS DISTINCT FROM (v_old -> v_key) THEN
      RAISE EXCEPTION 'Forbidden: "%" can only be changed by the merchant or the platform.', v_key
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_print_order_customer_writes_v21a ON public.print_orders;
CREATE TRIGGER trg_guard_print_order_customer_writes_v21a
  BEFORE UPDATE ON public.print_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_vertical_order_customer_writes_v21a('is_print_operator_for');

-- Requester-side UPDATE on reservations / site visits: may ONLY cancel their own request.
CREATE OR REPLACE FUNCTION public.guard_requester_cancel_only_v21a()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_operator_fn text := TG_ARGV[0];
  v_new jsonb := to_jsonb(NEW);
  v_old jsonb := to_jsonb(OLD);
  v_listing uuid := NULLIF(v_new ->> 'listing_id', '')::uuid;
  v_is_operator boolean := false;
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF public.is_super_admin() THEN
    RETURN NEW;
  END IF;

  EXECUTE format('SELECT public.%I($1)', v_operator_fn)
    INTO v_is_operator
    USING v_listing;
  IF COALESCE(v_is_operator, false) THEN
    RETURN NEW;
  END IF;

  IF (v_new - ARRAY['status', 'updated_at']) IS DISTINCT FROM (v_old - ARRAY['status', 'updated_at']) THEN
    RAISE EXCEPTION 'Forbidden: requests can only be cancelled by the requester; contact the business to change details.'
      USING ERRCODE = '42501';
  END IF;

  IF (v_new ->> 'status') IS DISTINCT FROM (v_old ->> 'status')
     AND (v_new ->> 'status') <> 'cancelled' THEN
    RAISE EXCEPTION 'Forbidden: only the business can confirm, decline or complete this request.'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_table_reservation_requester_v21a ON public.restaurant_table_reservations;
CREATE TRIGGER trg_guard_table_reservation_requester_v21a
  BEFORE UPDATE ON public.restaurant_table_reservations
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_requester_cancel_only_v21a('is_commerce_operator_for');

DROP TRIGGER IF EXISTS trg_guard_property_visit_requester_v21a ON public.property_visit_requests;
CREATE TRIGGER trg_guard_property_visit_requester_v21a
  BEFORE UPDATE ON public.property_visit_requests
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_requester_cancel_only_v21a('is_real_estate_operator_for');

-- =============================================================================
-- §7. ENTITLEMENT ENGINE REPAIR (P0-06)
-- =============================================================================

-- [v21a] Re-issued from 20261125_pass_v17b_unified_subscriptions_and_customer_gates.sql:916 with targeted patches.
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
  -- v21a: listing-scoped server checks pass p_user_id = NULL; resolve the listing owner
  IF p_user_id IS NULL AND p_listing_id IS NOT NULL THEN
    SELECT l.owner_id
      INTO p_user_id
    FROM public.listings l
    WHERE l.id = p_listing_id;
  END IF;

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
      AND (COALESCE(us.ends_at, us.expires_at) IS NULL OR COALESCE(us.ends_at, us.expires_at) > now())
      AND (p_listing_id IS NULL OR us.listing_id IS NULL OR us.listing_id = p_listing_id)
      AND public._v21a_plan_scope_matches_listing(p_listing_id, sp.applicable_root_keys, sp.applicable_category_ids)
    ORDER BY COALESCE(us.ends_at, us.expires_at) DESC NULLS FIRST
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

-- 7A. Legacy plan_scope subscriptions (pre-v17b Pro plans) remain honoured, incl. lifetime subs
CREATE OR REPLACE FUNCTION public._v21a_has_legacy_scope_subscription(
  p_listing_id uuid,
  p_scopes text[]
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.listings l
    JOIN public.user_subscriptions us
      ON us.listing_id = l.id
      OR (us.listing_id IS NULL AND us.user_id = l.owner_id)
    JOIN public.subscription_plans sp ON sp.id = us.plan_id
    WHERE l.id = p_listing_id
      AND us.status IN ('active', 'trialing')
      AND (COALESCE(us.ends_at, us.expires_at) IS NULL OR COALESCE(us.ends_at, us.expires_at) > now())
      AND sp.plan_scope = ANY(p_scopes)
  );
$$;

-- 7B. Owner-resolved effective entitlements for a listing (+ super-admin owned demo bypass)
CREATE OR REPLACE FUNCTION public._v21a_listing_entitlements(p_listing_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE
    WHEN l.id IS NULL THEN '{}'::jsonb
    ELSE public.get_effective_entitlements(l.owner_id, l.id)
  END
  FROM (SELECT p_listing_id AS id) x
  LEFT JOIN public.listings l ON l.id = x.id;
$$;

CREATE OR REPLACE FUNCTION public.has_active_print_entitlement(p_listing_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_official boolean := false;
  v_ent jsonb;
BEGIN
  IF p_listing_id IS NULL THEN
    RETURN false;
  END IF;

  SELECT (COALESCE(is_official_printswift, false) OR COALESCE(is_first_party_printswift, false))
    INTO v_is_official
  FROM public.listing_print_profiles
  WHERE listing_id = p_listing_id;

  IF COALESCE(v_is_official, false) THEN
    RETURN true;
  END IF;

  v_ent := public._v21a_listing_entitlements(p_listing_id);

  RETURN COALESCE((v_ent ->> 'is_super_admin_bypass')::boolean, false)
    OR COALESCE((v_ent -> 'features' ->> 'print_online_orders')::boolean, false)
    OR COALESCE((v_ent -> 'print_order' ->> 'enabled')::boolean, false)
    OR public._v21a_has_legacy_scope_subscription(p_listing_id, ARRAY['print_pro', 'merchant_bundle', 'merchant_all_in_one']);
END;
$$;

CREATE OR REPLACE FUNCTION public.has_active_booking_entitlement(
  p_listing_id uuid,
  p_vertical text DEFAULT 'booking_venue'
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

  v_ent := public._v21a_listing_entitlements(p_listing_id);

  IF COALESCE((v_ent ->> 'is_super_admin_bypass')::boolean, false)
     OR COALESCE((v_ent -> 'bookings' ->> 'enabled')::boolean, false) THEN
    RETURN true;
  END IF;

  IF p_vertical = 'hotel_stay' THEN
    RETURN COALESCE((v_ent -> 'features' ->> 'hotel_multi_room')::boolean, false)
      OR COALESCE((v_ent -> 'features' ->> 'hotel_rooms')::boolean, false)
      OR public._v21a_has_legacy_scope_subscription(p_listing_id, ARRAY['stay_pro', 'merchant_all_in_one', 'merchant_bundle']);
  END IF;

  RETURN COALESCE((v_ent -> 'features' ->> 'booking_slots')::boolean, false)
    OR public._v21a_has_legacy_scope_subscription(p_listing_id, ARRAY['booking_pro', 'merchant_all_in_one', 'merchant_bundle']);
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

  v_ent := public._v21a_listing_entitlements(p_listing_id);

  IF COALESCE((v_ent ->> 'is_super_admin_bypass')::boolean, false) THEN
    RETURN true;
  END IF;

  IF p_vertical = 'restaurant_food' THEN
    IF COALESCE((v_ent -> 'features' ->> 'restaurant_menu_ordering')::boolean, false)
       OR COALESCE((v_ent -> 'features' ->> 'restaurant_ordering')::boolean, false) THEN
      RETURN true;
    END IF;
  ELSE
    IF COALESCE((v_ent -> 'features' ->> 'shop_basket_checkout')::boolean, false)
       OR COALESCE((v_ent -> 'features' ->> 'catalogue_ordering')::boolean, false) THEN
      RETURN true;
    END IF;
  END IF;

  -- v17b unified plans: online ordering rides on the `online_payment` capability
  RETURN COALESCE((v_ent -> 'online_payment' ->> 'enabled')::boolean, false)
    OR public._v21a_has_legacy_scope_subscription(
      p_listing_id,
      ARRAY['catalogue_pro', 'restaurant_pro', 'merchant_all_in_one']
    );
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

  SELECT rp.verified_boost_expires_at
    INTO v_boost_exp
  FROM public.listing_real_estate_profiles rp
  WHERE rp.listing_id = p_listing_id;

  IF v_boost_exp IS NOT NULL AND v_boost_exp > now() THEN
    RETURN true;
  END IF;

  v_ent := public._v21a_listing_entitlements(p_listing_id);

  RETURN COALESCE((v_ent ->> 'is_super_admin_bypass')::boolean, false)
    OR COALESCE((v_ent -> 'features' ->> 'real_estate_verified_boost')::boolean, false)
    OR COALESCE((v_ent -> 'real_estate_poly' ->> 'enabled')::boolean, false)
    OR public._v21a_has_legacy_scope_subscription(
      p_listing_id,
      ARRAY['agent_pro', 'real_estate_boost', 'merchant_all_in_one']
    );
END;
$$;

REVOKE ALL ON FUNCTION public.has_active_print_entitlement(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_active_booking_entitlement(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_active_commerce_entitlement(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.has_active_real_estate_pro(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_active_print_entitlement(uuid) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_active_booking_entitlement(uuid, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_active_commerce_entitlement(uuid, text) TO anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.has_active_real_estate_pro(uuid) TO anon, authenticated, service_role;

-- =============================================================================
-- §8. DELEGATED STAFF PERMISSION / SCOPE RLS (P0-18)
-- =============================================================================

-- 8A. Vertical operator helpers now enforce vertical_scopes + parent lifecycle for staff
CREATE OR REPLACE FUNCTION public.is_print_operator_for(p_listing_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND p_listing_id IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.listings l
        WHERE l.id = p_listing_id
          AND l.owner_id = auth.uid()
      )
      OR public.staff_has_listing_grant(p_listing_id, NULL, 'print_queue', auth.uid())
      OR (
        public.is_super_admin()
        AND EXISTS (
          SELECT 1
          FROM public.listing_print_profiles lpp
          WHERE lpp.listing_id = p_listing_id
            AND lpp.is_first_party_printswift = true
        )
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.is_booking_operator_for(p_listing_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND p_listing_id IS NOT NULL
    AND (
      public.is_super_admin()
      OR EXISTS (
        SELECT 1
        FROM public.listings l
        WHERE l.id = p_listing_id
          AND l.owner_id = auth.uid()
      )
      OR public.staff_has_listing_grant(p_listing_id, NULL, 'booking_checkin', auth.uid())
    );
$$;

CREATE OR REPLACE FUNCTION public.is_commerce_operator_for(p_listing_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF current_setting('role', true) = 'service_role' THEN
    RETURN true;
  END IF;

  IF v_uid IS NULL OR p_listing_id IS NULL THEN
    RETURN false;
  END IF;

  IF public.is_super_admin() THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.listings l WHERE l.id = p_listing_id AND l.owner_id = v_uid
  ) THEN
    RETURN true;
  END IF;

  RETURN public.staff_has_listing_grant(p_listing_id, NULL, 'kitchen_shop_stock', v_uid);
END;
$$;

CREATE OR REPLACE FUNCTION public.is_real_estate_operator_for(p_listing_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
BEGIN
  IF current_setting('role', true) = 'service_role' THEN
    RETURN true;
  END IF;

  IF v_uid IS NULL OR p_listing_id IS NULL THEN
    RETURN false;
  END IF;

  IF public.is_super_admin() THEN
    RETURN true;
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.listings l WHERE l.id = p_listing_id AND l.owner_id = v_uid
  ) THEN
    RETURN true;
  END IF;

  RETURN public.staff_has_listing_grant(p_listing_id, NULL, 'property_visits', v_uid);
END;
$$;

GRANT EXECUTE ON FUNCTION public.is_print_operator_for(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_booking_operator_for(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_commerce_operator_for(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_real_estate_operator_for(uuid) TO authenticated, service_role;

-- 8B. listings UPDATE: staff need can_edit_details or can_manage_media
DROP POLICY IF EXISTS "Allow owners to update own listings" ON public.listings;
CREATE POLICY "Allow owners to update own listings"
  ON public.listings
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND (
      owner_id = auth.uid()
      OR public.staff_has_listing_grant(public.listings.id, 'can_edit_details', NULL, auth.uid())
      OR public.staff_has_listing_grant(public.listings.id, 'can_manage_media', NULL, auth.uid())
      OR public.is_pnd_admin(auth.uid())
    )
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND (
      owner_id = auth.uid()
      OR public.staff_has_listing_grant(public.listings.id, 'can_edit_details', NULL, auth.uid())
      OR public.staff_has_listing_grant(public.listings.id, 'can_manage_media', NULL, auth.uid())
      OR public.is_pnd_admin(auth.uid())
    )
  );

-- 8C. Staff may not hijack payment rails, verticals, verification or hub placement
CREATE OR REPLACE FUNCTION public.guard_staff_listing_mutations_v18a()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_new jsonb := to_jsonb(NEW);
  v_old jsonb := to_jsonb(OLD);
  v_key text;
BEGIN
  IF v_uid IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_uid = OLD.owner_id OR public.is_pnd_admin(v_uid) THEN
    RETURN NEW;
  END IF;

  IF NEW.owner_id IS DISTINCT FROM OLD.owner_id THEN
    RAISE EXCEPTION 'Delegated staff cannot transfer listing ownership.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.lifecycle_status IS DISTINCT FROM OLD.lifecycle_status THEN
    RAISE EXCEPTION 'Only the business owner can pause, drain, or archive a business listing.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.is_featured IS DISTINCT FROM OLD.is_featured
     OR NEW.featured_order IS DISTINCT FROM OLD.featured_order
     OR NEW.paid_until IS DISTINCT FROM OLD.paid_until THEN
    RAISE EXCEPTION 'Delegated staff cannot modify featured placement or billing timestamps.'
      USING ERRCODE = '42501';
  END IF;

  FOREACH v_key IN ARRAY ARRAY[
    'payment_mode', 'listing_vertical', 'root_key', 'hub_id',
    'is_verified', 'is_official_printswift', 'is_civic_record'
  ]
  LOOP
    IF (v_new -> v_key) IS DISTINCT FROM (v_old -> v_key) THEN
      RAISE EXCEPTION 'Delegated staff cannot change "%" — only the business owner can.', v_key
        USING ERRCODE = '42501';
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$;

-- 8D. Vertical profile payment policies (shop UPI etc.) are owner/platform-only
CREATE OR REPLACE FUNCTION public.guard_staff_payment_policy_v21a()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_listing uuid := NULLIF(to_jsonb(NEW) ->> 'listing_id', '')::uuid;
  v_owner uuid;
  v_new_policy jsonb := to_jsonb(NEW) -> 'payment_policy';
BEGIN
  IF v_uid IS NULL OR COALESCE(current_setting('role', true), '') = 'service_role' THEN
    RETURN NEW;
  END IF;

  SELECT l.owner_id INTO v_owner FROM public.listings l WHERE l.id = v_listing;

  IF v_owner = v_uid OR public.is_pnd_admin(v_uid) THEN
    RETURN NEW;
  END IF;

  -- Only delegated staff are restricted here (hub-manager governance keeps its own policies)
  IF NOT EXISTS (
    SELECT 1
    FROM public.staff_delegations sd
    WHERE sd.staff_id = v_uid
      AND (
        sd.listing_id = v_listing
        OR (jsonb_typeof(sd.assigned_listing_ids) = 'array' AND sd.assigned_listing_ids ? v_listing::text)
      )
  ) THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND v_new_policy IS DISTINCT FROM (to_jsonb(OLD) -> 'payment_policy') THEN
    RAISE EXCEPTION 'Delegated staff cannot change payment settings (UPI / direct-pay / escrow).'
      USING ERRCODE = '42501';
  END IF;

  IF TG_OP = 'INSERT' AND NULLIF(trim(COALESCE(v_new_policy ->> 'shop_upi_id', '')), '') IS NOT NULL THEN
    RAISE EXCEPTION 'Delegated staff cannot configure payment settings (UPI / direct-pay / escrow).'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

DO $$
DECLARE
  v_table text;
BEGIN
  FOREACH v_table IN ARRAY ARRAY[
    'listing_print_profiles', 'listing_hotel_profiles', 'listing_shop_profiles', 'listing_restaurant_profiles'
  ]
  LOOP
    IF to_regclass('public.' || v_table) IS NOT NULL
       AND EXISTS (
         SELECT 1 FROM information_schema.columns
         WHERE table_schema = 'public' AND table_name = v_table AND column_name = 'payment_policy'
       ) THEN
      EXECUTE format('DROP TRIGGER IF EXISTS trg_guard_staff_payment_policy_v21a ON public.%I', v_table);
      EXECUTE format(
        'CREATE TRIGGER trg_guard_staff_payment_policy_v21a BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.guard_staff_payment_policy_v21a()',
        v_table
      );
    END IF;
  END LOOP;
END;
$$;

-- 8E. enquiries: staff need can_reply_enquiries or the `enquiries` scope
DROP POLICY IF EXISTS "Allow listing owners to read enquiries for their listings" ON public.enquiries;
CREATE POLICY "Allow listing owners to read enquiries for their listings"
  ON public.enquiries
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.listings l
        WHERE l.id = public.enquiries.listing_id
          AND l.owner_id = auth.uid()
      )
      OR public.staff_has_listing_grant(public.enquiries.listing_id, 'can_reply_enquiries', NULL, auth.uid())
      OR public.staff_has_listing_grant(public.enquiries.listing_id, NULL, 'enquiries', auth.uid())
      OR public.is_pnd_admin(auth.uid())
    )
  );

DROP POLICY IF EXISTS "Allow listing owners to update enquiries" ON public.enquiries;
CREATE POLICY "Allow listing owners to update enquiries"
  ON public.enquiries
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.listings l
        WHERE l.id = public.enquiries.listing_id
          AND l.owner_id = auth.uid()
      )
      OR public.staff_has_listing_grant(public.enquiries.listing_id, 'can_reply_enquiries', NULL, auth.uid())
      OR public.staff_has_listing_grant(public.enquiries.listing_id, NULL, 'enquiries', auth.uid())
      OR public.is_pnd_admin(auth.uid())
    )
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.listings l
        WHERE l.id = public.enquiries.listing_id
          AND l.owner_id = auth.uid()
      )
      OR public.staff_has_listing_grant(public.enquiries.listing_id, 'can_reply_enquiries', NULL, auth.uid())
      OR public.staff_has_listing_grant(public.enquiries.listing_id, NULL, 'enquiries', auth.uid())
      OR public.is_pnd_admin(auth.uid())
    )
  );

-- 8F. marketplace_products: insert needs can_manage_catalogue; quick price/stock updates
--     also allowed for the kitchen_shop_stock scope.
DROP POLICY IF EXISTS "Owners admins and staff can insert marketplace products" ON public.marketplace_products;
CREATE POLICY "Owners admins and staff can insert marketplace products"
  ON public.marketplace_products
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.listings l
        WHERE l.id = public.marketplace_products.listing_id
          AND l.owner_id = auth.uid()
      )
      OR (public.marketplace_products.listing_id IS NULL AND auth.uid() = owner_id)
      OR public.staff_has_listing_grant(public.marketplace_products.listing_id, 'can_manage_catalogue', NULL, auth.uid())
      OR public.is_pnd_admin(auth.uid())
    )
  );

DROP POLICY IF EXISTS "Owners admins and staff can update marketplace products" ON public.marketplace_products;
CREATE POLICY "Owners admins and staff can update marketplace products"
  ON public.marketplace_products
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND (
      auth.uid() = owner_id
      OR public.staff_has_listing_grant(public.marketplace_products.listing_id, 'can_manage_catalogue', NULL, auth.uid())
      OR public.staff_has_listing_grant(public.marketplace_products.listing_id, NULL, 'kitchen_shop_stock', auth.uid())
      OR public.is_pnd_admin(auth.uid())
    )
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND (
      auth.uid() = owner_id
      OR EXISTS (
        SELECT 1
        FROM public.listings l
        WHERE l.id = public.marketplace_products.listing_id
          AND l.owner_id = auth.uid()
      )
      OR public.staff_has_listing_grant(public.marketplace_products.listing_id, 'can_manage_catalogue', NULL, auth.uid())
      OR public.staff_has_listing_grant(public.marketplace_products.listing_id, NULL, 'kitchen_shop_stock', auth.uid())
      OR public.is_pnd_admin(auth.uid())
    )
  );

-- 8G. listing_media: legacy 00010 policies ignored delegation status/permissions
DROP POLICY IF EXISTS "Allow owners and delegated staff to insert listing_media" ON public.listing_media;
CREATE POLICY "Allow owners and delegated staff to insert listing_media"
  ON public.listing_media
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.listings l
      WHERE l.id = public.listing_media.listing_id
        AND l.owner_id = auth.uid()
    )
    OR public.staff_has_listing_grant(public.listing_media.listing_id, 'can_manage_media', NULL, auth.uid())
    OR public.is_super_admin()
  );

DROP POLICY IF EXISTS "Allow delegated staff to update assigned listing_media" ON public.listing_media;
CREATE POLICY "Allow delegated staff to update assigned listing_media"
  ON public.listing_media
  FOR UPDATE
  TO authenticated
  USING (public.staff_has_listing_grant(public.listing_media.listing_id, 'can_manage_media', NULL, auth.uid()))
  WITH CHECK (public.staff_has_listing_grant(public.listing_media.listing_id, 'can_manage_media', NULL, auth.uid()));

-- =============================================================================
-- §9. DATA-LEAK CLOSURES (P0-16)
-- =============================================================================

-- 9A. profiles: no more `USING (true)` PII dump (email / phone / referral / trial data).
DROP POLICY IF EXISTS "Allow public read access to profiles" ON public.profiles;
-- SECURITY DEFINER helper keeps the policy free of cross-table RLS expansion (no recursion)
CREATE OR REPLACE FUNCTION public._v21a_owner_can_view_staff_profile(p_profile_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT auth.uid() IS NOT NULL
    AND p_profile_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.staff_delegations sd
      WHERE sd.staff_id = p_profile_id
        AND (sd.owner_id = auth.uid() OR sd.granted_by_owner_id = auth.uid())
    );
$$;

DROP POLICY IF EXISTS profiles_scoped_select_v21a ON public.profiles;
CREATE POLICY profiles_scoped_select_v21a
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    id = auth.uid()
    OR public.is_pnd_admin(auth.uid())
    OR public.is_pnd_mediator(auth.uid())
    OR public._v21a_owner_can_view_staff_profile(id)
  );

-- Safe public directory (names / avatars / handles only) for feeds, author bylines & search
CREATE OR REPLACE VIEW public.public_profiles
WITH (security_barrier = true)
AS
SELECT
  p.id,
  p.username,
  p.full_name,
  p.name,
  p.avatar_url,
  p.bio,
  p.role,
  p.default_hub_id
FROM public.profiles p;

REVOKE ALL ON public.public_profiles FROM PUBLIC;
GRANT SELECT ON public.public_profiles TO anon, authenticated, service_role;

-- 9B. subscription_plans: drop stale v15b public policies that OR-leaked VIP plans
DROP POLICY IF EXISTS subscription_plans_public_select ON public.subscription_plans;
DROP POLICY IF EXISTS "Public can view active subscription plans" ON public.subscription_plans;
DROP POLICY IF EXISTS subscription_plan_prices_public_select ON public.subscription_plan_prices;

-- Targeting check WITHOUT exposing the array to the caller
CREATE OR REPLACE FUNCTION public._v21a_plan_targets_user(p_plan_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_user_id IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.subscription_plans sp
    WHERE sp.id = p_plan_id
      AND p_user_id = ANY(sp.target_user_ids)
  );
$$;

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
          AND public._v21a_plan_targets_user(id, auth.uid())
        )
      )
    )
  );

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
            AND public._v21a_plan_targets_user(sp.id, auth.uid())
          )
        )
    )
  );

-- Column-level lockdown: `target_user_ids` is never selectable by anon/authenticated.
-- (Super-admin UIs read full rows through superadmin_list_subscription_plans().)
REVOKE SELECT ON public.subscription_plans FROM anon, authenticated;
DO $$
DECLARE
  v_cols text;
BEGIN
  SELECT string_agg(quote_ident(c.column_name), ', ' ORDER BY c.ordinal_position)
    INTO v_cols
  FROM information_schema.columns c
  WHERE c.table_schema = 'public'
    AND c.table_name = 'subscription_plans'
    AND c.column_name <> 'target_user_ids';

  EXECUTE format('GRANT SELECT (%s) ON public.subscription_plans TO anon, authenticated', v_cols);
END;
$$;

-- Safe catalog: visible plans + `is_targeted_for_me`, never the raw targeting list
CREATE OR REPLACE FUNCTION public.get_visible_subscription_plans()
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(
    jsonb_agg(
      (to_jsonb(sp) - 'target_user_ids')
      || jsonb_build_object(
        'is_targeted_for_me',
        (auth.uid() IS NOT NULL AND sp.target_scope = 'selected_users' AND auth.uid() = ANY(sp.target_user_ids))
      )
      ORDER BY sp.sort_order NULLS LAST, sp.id
    ),
    '[]'::jsonb
  )
  FROM public.subscription_plans sp
  WHERE sp.is_active = true
    AND sp.is_archived = false
    AND (
      sp.target_scope = 'public'
      OR (auth.uid() IS NOT NULL AND sp.target_scope = 'selected_users' AND auth.uid() = ANY(sp.target_user_ids))
    );
$$;

REVOKE ALL ON FUNCTION public.get_visible_subscription_plans() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_visible_subscription_plans() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.superadmin_list_subscription_plans()
RETURNS SETOF public.subscription_plans
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only super_admin can list full subscription plan rows.'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY SELECT * FROM public.subscription_plans;
END;
$$;

REVOKE ALL ON FUNCTION public.superadmin_list_subscription_plans() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.superadmin_list_subscription_plans() FROM anon;
GRANT EXECUTE ON FUNCTION public.superadmin_list_subscription_plans() TO authenticated, service_role;

-- 9C. categories: stale phase67a policy exposed non-official / pending categories publicly
DROP POLICY IF EXISTS "Public can read active categories" ON public.categories;

-- 9D. reviews: no anonymous inserts, no unmoderated USING(true) reads, no forged owner replies
ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS moderation_status text DEFAULT 'approved',
  ADD COLUMN IF NOT EXISTS owner_reply_updated_at timestamptz;
ALTER TABLE public.reviews ALTER COLUMN user_id SET DEFAULT auth.uid();

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'reviews'
      AND column_name = 'author_name'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.reviews ALTER COLUMN author_name DROP NOT NULL;
  END IF;
END;
$$;

DROP POLICY IF EXISTS "Allow public read access to reviews" ON public.reviews;
DROP POLICY IF EXISTS "Allow public visitors to insert reviews" ON public.reviews;
DROP POLICY IF EXISTS "Allow public read access to approved reviews" ON public.reviews;
DROP POLICY IF EXISTS reviews_public_read_v21a ON public.reviews;
DROP POLICY IF EXISTS reviews_authenticated_insert_v21a ON public.reviews;

CREATE POLICY reviews_public_read_v21a
  ON public.reviews
  FOR SELECT
  USING (
    COALESCE(moderation_status, 'approved') = 'approved'
    OR (
      auth.uid() IS NOT NULL
      AND (
        user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.listings l
          WHERE l.id = public.reviews.listing_id AND l.owner_id = auth.uid()
        )
        OR public.is_pnd_admin(auth.uid())
      )
    )
  );

CREATE POLICY reviews_authenticated_insert_v21a
  ON public.reviews
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND user_id = auth.uid()
    AND owner_reply IS NULL
    AND COALESCE(moderation_status, 'approved') = 'approved'
    AND NOT EXISTS (
      SELECT 1 FROM public.listings l
      WHERE l.id = public.reviews.listing_id AND l.owner_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "Allow listing owners to update owner_reply on their listings" ON public.reviews;
CREATE POLICY "Allow listing owners to update owner_reply on their listings"
  ON public.reviews
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.listings l
      WHERE l.id = public.reviews.listing_id AND l.owner_id = auth.uid()
    )
    OR public.staff_has_listing_grant(public.reviews.listing_id, 'can_reply_reviews', NULL, auth.uid())
    OR public.is_pnd_admin(auth.uid())
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.listings l
      WHERE l.id = public.reviews.listing_id AND l.owner_id = auth.uid()
    )
    OR public.staff_has_listing_grant(public.reviews.listing_id, 'can_reply_reviews', NULL, auth.uid())
    OR public.is_pnd_admin(auth.uid())
  );

-- Owners/staff may only write the reply (never edit the customer's rating or text)
CREATE OR REPLACE FUNCTION public.guard_review_reply_only_v21a()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NOT NULL AND public.is_pnd_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF (to_jsonb(NEW) - ARRAY['owner_reply', 'owner_reply_updated_at', 'updated_at'])
     IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['owner_reply', 'owner_reply_updated_at', 'updated_at']) THEN
    RAISE EXCEPTION 'Only the owner reply can be edited on a customer review.'
      USING ERRCODE = '42501';
  END IF;

  NEW.owner_reply_updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_review_reply_only_v21a ON public.reviews;
CREATE TRIGGER trg_guard_review_reply_only_v21a
  BEFORE UPDATE ON public.reviews
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_review_reply_only_v21a();

-- =============================================================================
-- §10. MEDIA REGISTRY, bind_media_assets & PRIVATE PAYMENT PROOFS (P0-15, P0-17, P0-21)
-- =============================================================================

-- 10A. Reconcile 00017 → pass_r1a media_assets drift (idempotent column guards)
ALTER TABLE public.media_assets
  ADD COLUMN IF NOT EXISTS bucket_id text,
  ADD COLUMN IF NOT EXISTS public_url text,
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

-- 00017 left a public USING(true) read policy that exposed every upload path (incl. KYC/UTR)
DROP POLICY IF EXISTS "Allow public read access to media_assets" ON public.media_assets;

-- 10B. Ownership-aware media binding (no more purging a victim listing's media)
CREATE OR REPLACE FUNCTION public._v21a_can_manage_media_entity(
  p_uid uuid,
  p_entity_type text,
  p_entity_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_uid IS NULL OR p_entity_id IS NULL THEN
    RETURN false;
  END IF;

  CASE p_entity_type
    WHEN 'avatar' THEN
      RETURN p_entity_id = p_uid;
    WHEN 'listing_cover', 'listing_gallery' THEN
      RETURN EXISTS (SELECT 1 FROM public.listings l WHERE l.id = p_entity_id AND l.owner_id = p_uid)
        OR public.staff_has_listing_grant(p_entity_id, 'can_manage_media', NULL, p_uid)
        OR public.staff_has_listing_grant(p_entity_id, 'can_edit_details', NULL, p_uid);
    WHEN 'product_image' THEN
      RETURN EXISTS (
        SELECT 1
        FROM public.marketplace_products mp
        WHERE mp.id = p_entity_id
          AND (
            mp.owner_id = p_uid
            OR public.staff_has_listing_grant(mp.listing_id, 'can_manage_catalogue', NULL, p_uid)
          )
      );
    WHEN 'menu_item_image' THEN
      RETURN EXISTS (
        SELECT 1
        FROM public.restaurant_menu_items mi
        JOIN public.listings l ON l.id = mi.listing_id
        WHERE mi.id = p_entity_id
          AND (
            l.owner_id = p_uid
            OR public.staff_has_listing_grant(l.id, 'can_manage_catalogue', NULL, p_uid)
          )
      );
    WHEN 'resource_photo' THEN
      RETURN EXISTS (
        SELECT 1
        FROM public.listing_booking_resources r
        JOIN public.listings l ON l.id = r.listing_id
        WHERE r.id = p_entity_id
          AND l.owner_id = p_uid
      );
    WHEN 'bulletin_media' THEN
      RETURN EXISTS (SELECT 1 FROM public.bulletins b WHERE b.id = p_entity_id AND b.author_id = p_uid);
    WHEN 'banner_image' THEN
      RETURN public.is_pnd_admin(p_uid);
    ELSE
      -- kyc_document, payment_utr_proof, delivery_pod, print_document, civic_report_proof:
      -- bound exclusively by server routes (service_role).
      RETURN false;
  END CASE;
END;
$$;

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
  v_uid uuid := auth.uid();
  v_is_trusted boolean := COALESCE(current_setting('role', true), '') = 'service_role'
    OR public.is_super_admin();
  v_retention text := COALESCE(NULLIF(trim(p_retention_class), ''), 'permanent_bound');
  v_expires timestamptz := CASE
    WHEN p_ttl_hours IS NOT NULL AND p_ttl_hours > 0
      THEN now() + make_interval(hours => p_ttl_hours)
    ELSE NULL
  END;
  v_paths text[] := COALESCE(p_storage_paths, ARRAY[]::text[]);
BEGIN
  IF NOT v_is_trusted AND v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required to bind media.'
      USING ERRCODE = '42501';
  END IF;

  IF p_entity_type IS NULL OR p_entity_id IS NULL THEN
    RAISE EXCEPTION 'Entity type and entity id are required.'
      USING ERRCODE = '22023';
  END IF;

  IF v_retention NOT IN ('permanent_bound', 'ephemeral_ttl', 'temp_draft') THEN
    RAISE EXCEPTION 'Invalid retention class "%".', p_retention_class
      USING ERRCODE = '22023';
  END IF;

  IF NOT v_is_trusted AND NOT public._v21a_can_manage_media_entity(v_uid, p_entity_type, p_entity_id) THEN
    RAISE EXCEPTION 'Forbidden: you cannot attach media to this record.'
      USING ERRCODE = '42501';
  END IF;

  -- 1. Activate provided paths (non-trusted callers may only bind their OWN uploads)
  IF array_length(v_paths, 1) IS NOT NULL THEN
    UPDATE public.media_assets
    SET
      status = 'active',
      entity_type = p_entity_type,
      entity_id = p_entity_id,
      retention_class = v_retention,
      expires_at = v_expires,
      updated_at = now()
    WHERE storage_path = ANY(v_paths)
      AND (v_is_trusted OR uploaded_by = v_uid);
  END IF;

  -- 2. Mark previously active assets of this (authorized) entity that are no longer bound
  UPDATE public.media_assets
  SET
    status = 'marked_for_deletion',
    expires_at = now(),
    updated_at = now()
  WHERE entity_type = p_entity_type
    AND entity_id::text = p_entity_id::text
    AND status = 'active'
    AND NOT (storage_path = ANY(v_paths));
END;
$$;

REVOKE ALL ON FUNCTION public.bind_media_assets(text[], text, uuid, text, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.bind_media_assets(text[], text, uuid, text, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.bind_media_assets(text[], text, uuid, text, integer) TO authenticated, service_role;

-- 10C. Private UPI receipt bucket (replaces public `media` / ghost `listing-images` uploads)
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'payment-proofs',
  'payment-proofs',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf']
)
ON CONFLICT (id) DO UPDATE
SET
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

DROP POLICY IF EXISTS payment_proofs_owner_insert_v21a ON storage.objects;
CREATE POLICY payment_proofs_owner_insert_v21a
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'payment-proofs'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS payment_proofs_authorized_select_v21a ON storage.objects;
CREATE POLICY payment_proofs_authorized_select_v21a
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'payment-proofs'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR public.is_pnd_mediator(auth.uid())
      OR public.is_pnd_admin(auth.uid())
    )
  );

-- =============================================================================
-- §11. MONETIZATION INTEGRITY (P0-09, P0-10, P0-11, P0-25, P0-27)
-- =============================================================================

-- 11A. P0-09: review_pay_per_order idempotency
-- [v21a] Re-issued from 20261125_pass_v17c_pay_per_monetization.sql:772 with targeted patches.
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
  IF v_uid IS NULL OR NOT public.is_pnd_admin(v_uid) THEN
    RAISE EXCEPTION 'Only Admin or Super-Admin can review pay-per orders.'
      USING ERRCODE = '42501';
  END IF;

  IF v_decision NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'Decision must be approve or reject.'
      USING ERRCODE = '22023';
  END IF;

  IF v_decision = 'reject' AND (v_clean_notes IS NULL OR length(v_clean_notes) < 4) THEN
    RAISE EXCEPTION 'A rejection reason note (at least 4 characters) is required.'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_order
  FROM public.pay_per_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Pay-per order not found.'
      USING ERRCODE = 'P0002';
  END IF;

  -- v21a idempotency guard: only pending orders can be reviewed exactly once
  IF v_order.status <> 'pending_verification' THEN
    RAISE EXCEPTION 'Pay-per order % was already reviewed (status: %).', v_order.id, v_order.status
      USING ERRCODE = 'P0001';
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
    SET
      status = 'paid',
      paid_until = v_paid_until,
      reviewed_by = v_uid,
      review_notes = v_clean_notes,
      updated_at = now()
    WHERE id = p_order_id;

    -- Activate & stamp `paid_until` on the target record without deleting data on expiry
    IF v_order.target_table IN ('marketplace_items', 'marketplace_products') THEN
      IF to_regclass('public.marketplace_products') IS NOT NULL THEN
        UPDATE public.marketplace_products
        SET
          paid_until = GREATEST(COALESCE(paid_until, now()), now()) + (v_order.duration_days || ' days')::interval,
          is_active = true
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
        status = CASE
          WHEN status IN ('pending', 'pending_verification', 'pending_payment', 'draft') THEN 'published'
          ELSE status
        END,
        is_featured = CASE WHEN v_has_featured THEN true ELSE is_featured END,
        updated_at = now()
      WHERE id = v_order.target_id;
    END IF;
  ELSE
    UPDATE public.pay_per_orders
    SET
      status = 'rejected',
      reviewed_by = v_uid,
      review_notes = v_clean_notes,
      updated_at = now()
    WHERE id = p_order_id;
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
      v_uid,
      'super_admin',
      'admin',
      'review_pay_per_order_' || v_decision,
      'pay_per_orders',
      p_order_id::text,
      'Reviewed Pay-Per order (' || v_decision || ')',
      jsonb_build_object(
        'order_id', p_order_id::text,
        'decision', v_decision,
        'module_key', v_order.module_key,
        'target_table', v_order.target_table,
        'target_id', v_order.target_id::text,
        'amount_inr', v_order.amount_inr,
        'paid_until', v_paid_until,
        'notes', v_clean_notes
      )
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

-- Direct client INSERTs let payers set their own amount_inr; submit_pay_per_order()
-- (server-quoted SECURITY DEFINER RPC) is now the only creation path.
DROP POLICY IF EXISTS pay_per_orders_owner_insert ON public.pay_per_orders;

-- 11B. P0-10: bulletin lifecycle statuses for Pay-Per drafts & pending payment
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
      AND t.relname = 'bulletins'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%removed_by_admin%'
  LOOP
    EXECUTE format('ALTER TABLE public.bulletins DROP CONSTRAINT IF EXISTS %I', v_conname);
  END LOOP;

  ALTER TABLE public.bulletins
    ADD CONSTRAINT bulletins_status_check
    CHECK (
      status IN (
        'published',
        'archived',
        'removed_by_admin',
        'pending_payment',
        'draft',
        'pending_review'
      )
    );
END;
$$;

-- Auto-verify may verify, but must NEVER publish an unpaid Pay-Per draft
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
    IF COALESCE(NEW.status, 'published') NOT IN ('pending_payment', 'draft', 'pending_review') THEN
      NEW.status := 'published';
    END IF;
  ELSE
    NEW.is_verified := false;
  END IF;

  RETURN NEW;
END;
$$;

-- 11C. P0-11: featured_requests — requester cannot self-approve; can withdraw safely
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
      AND t.relname = 'featured_requests'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ILIKE '%under_review%'
  LOOP
    EXECUTE format('ALTER TABLE public.featured_requests DROP CONSTRAINT IF EXISTS %I', v_conname);
  END LOOP;

  ALTER TABLE public.featured_requests
    ADD CONSTRAINT featured_requests_status_check
    CHECK (status IN ('submitted', 'under_review', 'approved', 'rejected', 'expired', 'withdrawn'));
END;
$$;

DROP POLICY IF EXISTS "featured_requests_requester_insert" ON public.featured_requests;
CREATE POLICY "featured_requests_requester_insert"
  ON public.featured_requests
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = requester_id
    AND status = 'submitted'
    AND reviewer_id IS NULL
    AND reviewer_notes IS NULL
  );

CREATE OR REPLACE FUNCTION public.withdraw_featured_request(
  p_request_id uuid,
  p_reason text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_reason text := NULLIF(trim(COALESCE(p_reason, '')), '');
  v_req public.featured_requests%ROWTYPE;
  v_actor_name text;
  v_actor_role text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in required.' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_req FROM public.featured_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Featured request not found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_req.requester_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Forbidden: only the requester can withdraw this request.' USING ERRCODE = '42501';
  END IF;

  IF v_req.status NOT IN ('submitted', 'under_review') THEN
    RAISE EXCEPTION 'Request % can no longer be withdrawn (status: %).', v_req.request_code, v_req.status
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.featured_requests
  SET
    status = 'withdrawn',
    reviewer_notes = concat_ws(E'\n', reviewer_notes, 'Withdrawn by requester' || COALESCE(': ' || v_reason, '')),
    updated_at = now()
  WHERE id = v_req.id;

  SELECT COALESCE(NULLIF(trim(p.full_name), ''), p.username), p.role
    INTO v_actor_name, v_actor_role
  FROM public.profiles p WHERE p.id = v_uid;

  INSERT INTO public.audit_logs (
    actor_id, actor_name, actor_role, workspace, action,
    target_id, target_name, details, target_table, metadata
  )
  VALUES (
    v_uid, v_actor_name, COALESCE(v_actor_role, 'visitor'), 'advertiser', 'featured_request_withdrawn',
    v_req.id::text, v_req.request_code, 'Requester withdrew featured request ' || v_req.request_code,
    'featured_requests',
    jsonb_build_object('previous_status', v_req.status, 'reason', v_reason, 'slot_section', v_req.slot_section)
  );

  RETURN jsonb_build_object('ok', true, 'id', v_req.id, 'status', 'withdrawn');
END;
$$;

REVOKE ALL ON FUNCTION public.withdraw_featured_request(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.withdraw_featured_request(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.withdraw_featured_request(uuid, text) TO authenticated;

-- 11D. P0-25: owner quota meters read the live v17b keys
-- [v21a] Re-issued from 20261126_pass_v18a_owner_staff_rls_and_quotas.sql:675 with targeted patches.
CREATE OR REPLACE FUNCTION public.get_owner_workspace_summary(
  p_target_owner_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid := auth.uid();
  v_owner_id uuid := COALESCE(p_target_owner_id, auth.uid());
  v_is_admin boolean := false;
  v_is_staff_caller boolean := false;
  v_owner_profile record;
  v_ent jsonb;
  v_active_sub record;
  v_default_free record;
  v_subscription_summary jsonb;
  v_targeted_plans jsonb := '[]'::jsonb;
  v_trial_plans jsonb := '[]'::jsonb;
  v_expiring_items jsonb := '[]'::jsonb;
  v_staff_assignments jsonb := '[]'::jsonb;

  v_used_listings integer := 0;
  v_used_marketplace integer := 0;
  v_used_staff integer := 0;
  v_used_bulletins_month integer := 0;
  v_used_bulletins_active integer := 0;

  v_limit_listings integer := NULL;
  v_limit_marketplace integer := NULL;
  v_limit_staff integer := NULL;
  v_staffing_enabled boolean := true;
  v_limit_bulletins_month integer := NULL;
  v_limit_bulletins_active integer := NULL;
  v_raw text;
BEGIN
  IF v_caller_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to load workspace summary.'
      USING ERRCODE = '42501';
  END IF;

  v_is_admin := public.is_pnd_admin(v_caller_id);

  IF v_caller_id <> v_owner_id AND NOT v_is_admin THEN
    -- Check if caller is an active delegated staff member for this owner
    SELECT EXISTS (
      SELECT 1
      FROM public.staff_delegations sd
      JOIN public.listings l ON l.id = sd.listing_id
      WHERE l.owner_id = v_owner_id
        AND sd.staff_id = v_caller_id
        AND COALESCE(sd.status, 'active') = 'active'
        AND COALESCE(l.lifecycle_status, 'active') IN ('active', 'draining')
    ) INTO v_is_staff_caller;

    IF NOT v_is_staff_caller THEN
      RAISE EXCEPTION 'You do not have active owner or delegated staff access for this business.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  SELECT
    p.id,
    COALESCE(p.full_name, p.name, p.username, 'Business Owner') AS full_name,
    p.username,
    COALESCE(p.role, 'owner') AS role,
    p.trial_used_at
  INTO v_owner_profile
  FROM public.profiles p
  WHERE p.id = v_owner_id;

  -- Resolve effective entitlements from the OWNER's subscription (staff inherit this!)
  v_ent := public.get_effective_entitlements(v_owner_id, NULL);

  -- Parse numeric quota limits from `v_ent` (NULL or < 0 means unlimited)
  v_raw := COALESCE(
    v_ent #>> '{limits,max_listings}',
    v_ent ->> 'max_listings',
    v_ent #>> '{listings,limit}',
    v_ent #>> '{limits,max_active_listings}'
  );
  IF v_raw IS NOT NULL AND v_raw ~ '^-?[0-9]+$' THEN
    v_limit_listings := CASE WHEN v_raw::integer < 0 OR v_raw::integer >= 9999 THEN NULL ELSE v_raw::integer END;
  END IF;

  v_raw := COALESCE(
    v_ent #>> '{limits,max_marketplace_items}',
    v_ent ->> 'max_marketplace_items',
    v_ent #>> '{marketplace,limit}',
    v_ent #>> '{limits,max_catalogue_items}',
    v_ent #>> '{limits,max_menu_items}'
  );
  IF v_raw IS NOT NULL AND v_raw ~ '^-?[0-9]+$' THEN
    v_limit_marketplace := CASE WHEN v_raw::integer < 0 OR v_raw::integer >= 9999 THEN NULL ELSE v_raw::integer END;
  END IF;

  v_staffing_enabled := COALESCE(
    (v_ent #>> '{staffing,enabled}')::boolean,
    (v_ent #>> '{features,staff_delegation}')::boolean,
    true
  );
  v_raw := COALESCE(
    v_ent #>> '{staffing,max_staff}',
    v_ent #>> '{staffing,limit}',
    v_ent #>> '{limits,max_staff_members}'
  );
  IF v_raw IS NOT NULL AND v_raw ~ '^-?[0-9]+$' THEN
    v_limit_staff := CASE WHEN v_raw::integer < 0 OR v_raw::integer >= 9999 THEN NULL ELSE v_raw::integer END;
  END IF;

  v_raw := COALESCE(
    v_ent #>> '{bulletins,limit}',
    v_ent #>> '{bulletin,monthly_limit}',
    v_ent #>> '{bulletin,limit}',
    v_ent #>> '{limits,max_monthly_bulletins}'
  );
  IF v_raw IS NOT NULL AND v_raw ~ '^-?[0-9]+$' THEN
    v_limit_bulletins_month := CASE WHEN v_raw::integer < 0 THEN NULL ELSE v_raw::integer END;
  END IF;

  v_raw := COALESCE(
    v_ent #>> '{bulletin,max_active}',
    v_ent #>> '{limits,max_active_bulletins}'
  );
  IF v_raw IS NOT NULL AND v_raw ~ '^-?[0-9]+$' THEN
    v_limit_bulletins_active := CASE WHEN v_raw::integer < 0 THEN NULL ELSE v_raw::integer END;
  END IF;

  -- Live Quota Usage Counts for `v_owner_id`
  SELECT COUNT(*)::integer
    INTO v_used_listings
  FROM public.listings l
  WHERE l.owner_id = v_owner_id
    AND COALESCE(l.lifecycle_status, 'active') <> 'archived_by_owner'
    AND COALESCE(l.status, 'draft') NOT IN ('archived', 'rejected');

  SELECT COUNT(*)::integer
    INTO v_used_marketplace
  FROM public.marketplace_products mp
  WHERE mp.owner_id = v_owner_id
    AND COALESCE(mp.is_active, true) = true;

  SELECT COUNT(DISTINCT sd.staff_id)::integer
    INTO v_used_staff
  FROM public.staff_delegations sd
  JOIN public.listings l ON l.id = sd.listing_id
  WHERE l.owner_id = v_owner_id
    AND COALESCE(sd.status, 'active') = 'active';

  SELECT
    COUNT(*) FILTER (WHERE b.created_at >= date_trunc('month', now()))::integer,
    COUNT(*) FILTER (
      WHERE b.status = 'published'
        AND (b.expires_at IS NULL OR b.expires_at > now())
    )::integer
  INTO v_used_bulletins_month, v_used_bulletins_active
  FROM public.bulletins b
  WHERE b.author_id = v_owner_id
    AND b.status <> 'removed_by_admin';

  -- Resolve Active or Trialing Subscription (or Default Free Tier fallback)
  SELECT
    us.id AS subscription_id,
    us.plan_id,
    us.status,
    us.starts_at,
    COALESCE(us.ends_at, us.expires_at) AS ends_at,
    COALESCE(sp.title, sp.name, 'Active Plan') AS plan_name,
    sp.slug AS plan_slug,
    COALESCE(sp.info, sp.tagline, '') AS plan_info,
    COALESCE(sp.is_default_free, false) AS is_default_free,
    COALESCE(sp.trial_days, 0) AS trial_days,
    GREATEST(
      0,
      CEIL(EXTRACT(EPOCH FROM (COALESCE(us.ends_at, us.expires_at) - now())) / 86400.0)
    )::integer AS days_remaining
  INTO v_active_sub
  FROM public.user_subscriptions us
  JOIN public.subscription_plans sp ON sp.id = us.plan_id
  WHERE us.user_id = v_owner_id
    AND us.status IN ('active', 'trialing')
    AND (
      COALESCE(us.ends_at, us.expires_at) IS NULL
      OR COALESCE(us.ends_at, us.expires_at) > now()
    )
  ORDER BY
    CASE WHEN us.status = 'active' THEN 0 ELSE 1 END,
    COALESCE(us.ends_at, us.expires_at) DESC NULLS FIRST
  LIMIT 1;

  IF FOUND THEN
    v_subscription_summary := jsonb_build_object(
      'subscription_id', v_active_sub.subscription_id,
      'plan_id', v_active_sub.plan_id,
      'plan_slug', v_active_sub.plan_slug,
      'plan_name', v_active_sub.plan_name,
      'plan_info', v_active_sub.plan_info,
      'status', v_active_sub.status,
      'is_trial', (v_active_sub.status = 'trialing'),
      'is_default_free', v_active_sub.is_default_free,
      'starts_at', v_active_sub.starts_at,
      'ends_at', v_active_sub.ends_at,
      'days_remaining', v_active_sub.days_remaining
    );
  ELSE
    SELECT
      sp.id AS plan_id,
      sp.slug AS plan_slug,
      COALESCE(sp.title, sp.name, 'Default Free Tier') AS plan_name,
      COALESCE(sp.info, sp.tagline, 'Baseline community tier') AS plan_info
    INTO v_default_free
    FROM public.subscription_plans sp
    WHERE sp.is_default_free = true
    LIMIT 1;

    v_subscription_summary := jsonb_build_object(
      'subscription_id', NULL,
      'plan_id', v_default_free.plan_id,
      'plan_slug', COALESCE(v_default_free.plan_slug, 'default-free-tier'),
      'plan_name', COALESCE(v_default_free.plan_name, 'Default Free Tier'),
      'plan_info', COALESCE(v_default_free.plan_info, 'Baseline community tier'),
      'status', 'default_free',
      'is_trial', false,
      'is_default_free', true,
      'starts_at', NULL,
      'ends_at', NULL,
      'days_remaining', NULL
    );
  END IF;

  -- Targeted VIP Plans & Trial-Eligible Plans (Owner / Admin view only)
  IF NOT v_is_staff_caller THEN
    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', sp.id,
          'slug', sp.slug,
          'title', COALESCE(sp.title, sp.name),
          'info', COALESCE(sp.info, sp.tagline, ''),
          'trial_days', COALESCE(sp.trial_days, 0),
          'price_inr', COALESCE(sp.price_inr, 0),
          'duration_days', COALESCE(sp.duration_days, 30),
          'target_scope', sp.target_scope
        )
        ORDER BY sp.sort_order ASC, sp.created_at ASC
      ),
      '[]'::jsonb
    )
    INTO v_targeted_plans
    FROM public.subscription_plans sp
    WHERE sp.is_active = true
      AND COALESCE(sp.is_archived, false) = false
      AND sp.target_scope = 'selected_users'
      AND v_owner_id = ANY(COALESCE(sp.target_user_ids, '{}'::uuid[]));

    SELECT COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', sp.id,
          'slug', sp.slug,
          'title', COALESCE(sp.title, sp.name),
          'info', COALESCE(sp.info, sp.tagline, ''),
          'trial_days', sp.trial_days,
          'price_inr', COALESCE(sp.price_inr, 0),
          'duration_days', COALESCE(sp.duration_days, 30),
          'target_scope', sp.target_scope
        )
        ORDER BY sp.sort_order ASC, sp.created_at ASC
      ),
      '[]'::jsonb
    )
    INTO v_trial_plans
    FROM public.subscription_plans sp
    WHERE sp.is_active = true
      AND COALESCE(sp.is_archived, false) = false
      AND COALESCE(sp.is_default_free, false) = false
      AND COALESCE(sp.trial_days, 0) > 0
      AND (
        sp.target_scope = 'public'
        OR (
          sp.target_scope = 'selected_users'
          AND v_owner_id = ANY(COALESCE(sp.target_user_ids, '{}'::uuid[]))
        )
      );
  END IF;

  -- Expiring / Expired Pay-Per Items (`paid_until <= now() + 7 days`; soft-expired items stay visible!)
  WITH raw_expiring AS (
    SELECT
      mp.id,
      mp.title,
      'marketplace_products'::text AS target_table,
      'marketplace_item'::text AS module_key,
      mp.paid_until,
      COALESCE(mp.price, 0)::numeric AS price_inr,
      'shop_catalogue'::text AS listing_vertical
    FROM public.marketplace_products mp
    WHERE mp.owner_id = v_owner_id
      AND mp.paid_until IS NOT NULL
      AND mp.paid_until <= (now() + interval '7 days')

    UNION ALL

    SELECT
      b.id,
      b.title,
      'bulletins'::text AS target_table,
      'bulletin_post'::text AS module_key,
      b.paid_until,
      0::numeric AS price_inr,
      'bulletin'::text AS listing_vertical
    FROM public.bulletins b
    WHERE b.author_id = v_owner_id
      AND b.paid_until IS NOT NULL
      AND b.paid_until <= (now() + interval '7 days')
      AND b.status <> 'removed_by_admin'

    UNION ALL

    SELECT
      l.id,
      l.title,
      'listings'::text AS target_table,
      CASE
        WHEN COALESCE(l.subcategory, '') ILIKE '%rent%' OR COALESCE(l.subcategory, '') ILIKE '%lease%' OR COALESCE(l.subcategory, '') ILIKE '%pg%'
          THEN 'real_estate_rent'::text
        ELSE 'real_estate_sale'::text
      END AS module_key,
      l.paid_until,
      0::numeric AS price_inr,
      COALESCE(l.listing_vertical, 'real_estate')::text AS listing_vertical
    FROM public.listings l
    WHERE l.owner_id = v_owner_id
      AND l.paid_until IS NOT NULL
      AND l.paid_until <= (now() + interval '7 days')
      AND COALESCE(l.lifecycle_status, 'active') <> 'archived_by_owner'
  )
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', r.id,
        'title', r.title,
        'target_table', r.target_table,
        'module_key', r.module_key,
        'paid_until', r.paid_until,
        'is_expired', (r.paid_until <= now()),
        'days_left', CEIL(EXTRACT(EPOCH FROM (r.paid_until - now())) / 86400.0)::integer,
        'price_inr', r.price_inr,
        'listing_vertical', r.listing_vertical
      )
      ORDER BY r.paid_until ASC
    ),
    '[]'::jsonb
  )
  INTO v_expiring_items
  FROM raw_expiring r;

  -- Active staff delegations for caller when `v_is_staff_caller = true` (or all active staff for owner)
  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', sd.id,
        'listing_id', sd.listing_id,
        'listing_title', l.title,
        'listing_vertical', COALESCE(l.listing_vertical, 'general'),
        'parent_owner_id', l.owner_id,
        'parent_lifecycle_status', COALESCE(l.lifecycle_status, 'active'),
        'staff_id', sd.staff_id,
        'status', COALESCE(sd.status, 'active'),
        'permissions', COALESCE(sd.permissions, '{}'::jsonb),
        'vertical_scopes', COALESCE(sd.vertical_scopes, '["enquiries"]'::jsonb)
      )
      ORDER BY sd.granted_at DESC NULLS LAST
    ),
    '[]'::jsonb
  )
  INTO v_staff_assignments
  FROM public.staff_delegations sd
  JOIN public.listings l ON l.id = sd.listing_id
  WHERE l.owner_id = v_owner_id
    AND COALESCE(sd.status, 'active') = 'active'
    AND (NOT v_is_staff_caller OR sd.staff_id = v_caller_id);

  RETURN jsonb_build_object(
    'owner_id', v_owner_id,
    'caller_id', v_caller_id,
    'is_staff_caller', v_is_staff_caller,
    'owner_profile', jsonb_build_object(
      'id', v_owner_profile.id,
      'full_name', COALESCE(v_owner_profile.full_name, 'Business Owner'),
      'username', v_owner_profile.username,
      'role', COALESCE(v_owner_profile.role, 'owner'),
      'trial_used_at', CASE WHEN v_is_staff_caller THEN NULL ELSE v_owner_profile.trial_used_at END,
      'is_trial_eligible', CASE WHEN v_is_staff_caller THEN false ELSE (v_owner_profile.trial_used_at IS NULL) END
    ),
    'effective_entitlements', v_ent,
    'active_subscription', v_subscription_summary,
    'quota_usage', jsonb_build_object(
      'listings', jsonb_build_object(
        'used', v_used_listings,
        'limit', v_limit_listings
      ),
      'marketplace_items', jsonb_build_object(
        'used', v_used_marketplace,
        'limit', v_limit_marketplace
      ),
      'active_staff', jsonb_build_object(
        'used', v_used_staff,
        'limit', v_limit_staff,
        'enabled', v_staffing_enabled
      ),
      'bulletins_this_month', jsonb_build_object(
        'used', v_used_bulletins_month,
        'limit', v_limit_bulletins_month,
        'active_used', v_used_bulletins_active,
        'active_limit', v_limit_bulletins_active
      )
    ),
    'targeted_vip_plans', v_targeted_plans,
    'trial_eligible_plans', v_trial_plans,
    'expiring_pay_per_items', v_expiring_items,
    'staff_assignments', v_staff_assignments
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_owner_workspace_summary(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_owner_workspace_summary(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_owner_workspace_summary(uuid) TO authenticated, service_role;

-- 11E. P0-27: bulletin_post_passes UTR replay guard (dedupe legacy rows first)
DO $$
DECLARE
  v_dup record;
BEGIN
  IF to_regclass('public.bulletin_post_passes') IS NOT NULL THEN
    UPDATE public.bulletin_post_passes
    SET upi_utr_ref = upper(trim(upi_utr_ref))
    WHERE upi_utr_ref IS NOT NULL
      AND trim(upi_utr_ref) <> ''
      AND upi_utr_ref <> upper(trim(upi_utr_ref));

    FOR v_dup IN
      SELECT d.id
      FROM (
        SELECT
          bp.id,
          row_number() OVER (
            PARTITION BY upper(trim(bp.upi_utr_ref))
            ORDER BY bp.created_at ASC NULLS LAST, bp.id ASC
          ) AS rn
        FROM public.bulletin_post_passes bp
        WHERE bp.upi_utr_ref IS NOT NULL
          AND trim(bp.upi_utr_ref) <> ''
          AND bp.status IN ('pending_verification', 'available', 'used')
      ) d
      WHERE d.rn > 1
    LOOP
      UPDATE public.bulletin_post_passes
      SET upi_utr_ref = upi_utr_ref || '-DUP-' || left(v_dup.id::text, 8)
      WHERE id = v_dup.id;
    END LOOP;
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_bulletin_post_passes_active_utr_unique_v21a
  ON public.bulletin_post_passes (upper(trim(upi_utr_ref)))
  WHERE upi_utr_ref IS NOT NULL
    AND trim(upi_utr_ref) <> ''
    AND status IN ('pending_verification', 'available', 'used');

-- =============================================================================
-- §12. NOTIFICATIONS RECONCILE + emit_notification (P0-19)
-- =============================================================================

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS recipient_id uuid,
  ADD COLUMN IF NOT EXISTS type text DEFAULT 'system',
  ADD COLUMN IF NOT EXISTS is_read boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS read boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS link_listing_id uuid,
  ADD COLUMN IF NOT EXISTS action_url text,
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;

UPDATE public.notifications SET type = 'system' WHERE type IS NULL;
ALTER TABLE public.notifications ALTER COLUMN type SET DEFAULT 'system';
UPDATE public.notifications SET user_id = recipient_id WHERE user_id IS NULL AND recipient_id IS NOT NULL;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'notifications'
      AND column_name = 'recipient_role' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.notifications ALTER COLUMN recipient_role DROP NOT NULL;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_notifications_user_id_created_at
  ON public.notifications (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.emit_notification(
  p_user_id uuid,
  p_title text,
  p_message text,
  p_type text DEFAULT 'system',
  p_action_url text DEFAULT NULL,
  p_metadata jsonb DEFAULT '{}'::jsonb,
  p_link_listing_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_service boolean := COALESCE(current_setting('role', true), '') = 'service_role';
  v_title text := left(trim(COALESCE(p_title, '')), 160);
  v_message text := left(trim(COALESCE(p_message, '')), 2000);
  v_action_url text := NULLIF(trim(COALESCE(p_action_url, '')), '');
  v_id uuid;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE EXCEPTION 'Recipient user is required.' USING ERRCODE = '22023';
  END IF;

  IF v_title = '' OR v_message = '' THEN
    RAISE EXCEPTION 'Notification title and message are required.' USING ERRCODE = '22023';
  END IF;

  IF NOT v_is_service
     AND v_uid IS DISTINCT FROM p_user_id
     AND NOT public.is_pnd_admin(v_uid)
     AND NOT public.is_pnd_mediator(v_uid) THEN
    RAISE EXCEPTION 'Forbidden: you may not send notifications to other users.'
      USING ERRCODE = '42501';
  END IF;

  -- In-app relative links only (no off-site phishing targets)
  IF v_action_url IS NOT NULL AND (v_action_url !~ '^/' OR v_action_url ~ '^//') THEN
    RAISE EXCEPTION 'action_url must be an in-app relative path (e.g. /workspace?hat=owner).'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.notifications (
    user_id, recipient_id, title, message, type, is_read, read, action_url, metadata, link_listing_id
  )
  VALUES (
    p_user_id,
    p_user_id,
    v_title,
    v_message,
    COALESCE(NULLIF(trim(p_type), ''), 'system'),
    false,
    false,
    v_action_url,
    COALESCE(p_metadata, '{}'::jsonb) || jsonb_build_object('emitted_by', v_uid),
    p_link_listing_id
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.emit_notification(uuid, text, text, text, text, jsonb, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.emit_notification(uuid, text, text, text, text, jsonb, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.emit_notification(uuid, text, text, text, text, jsonb, uuid) TO authenticated, service_role;

-- Enquiry trigger omitted NOT NULL `type` (crashed on DBs created via 00005)
CREATE OR REPLACE FUNCTION public.handle_new_enquiry_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_id uuid;
  v_listing_title text;
BEGIN
  SELECT l.owner_id, l.title
    INTO v_owner_id, v_listing_title
  FROM public.listings l
  WHERE l.id = NEW.listing_id;

  IF v_owner_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.profiles p WHERE p.id = v_owner_id) THEN
    INSERT INTO public.notifications (
      user_id, recipient_id, title, message, type, is_read, read, action_url, metadata, created_at
    )
    VALUES (
      v_owner_id,
      v_owner_id,
      'New Listing Enquiry: ' || COALESCE(v_listing_title, 'Directory Listing'),
      'From ' || COALESCE(NEW.sender_name, 'Visitor') || ': ' || left(COALESCE(NEW.message, ''), 280),
      'enquiry',
      false,
      false,
      '/workspace?hat=owner&tab=enquiries',
      jsonb_build_object('enquiry_id', NEW.id, 'listing_id', NEW.listing_id),
      COALESCE(NEW.created_at, now())
    );

    INSERT INTO public.activity_logs (user_id, action_type, entity_id, created_at)
    VALUES (v_owner_id, 'enquiry_received', NEW.id::text, COALESCE(NEW.created_at, now()));
  END IF;

  RETURN NEW;
END;
$$;

-- =============================================================================
-- §13. VEHICLE BOOKING FARE AUTHORITY & OPERATIONAL HATS IDOR (P0-15, P0-28)
-- =============================================================================

-- The old 9-arg overload trusted p_total_fare_inr from the client — remove it entirely.
DROP FUNCTION IF EXISTS public.create_vehicle_booking_with_intent(
  uuid, text, integer, timestamptz, timestamptz, text, text, text, numeric
);

-- [v21a] Re-issued from 20261124_pass_v14b_schema_hardening.sql:717 with targeted patches.
CREATE OR REPLACE FUNCTION public.create_vehicle_booking_with_intent(
  p_vehicle_listing_id uuid,
  p_booking_mode text,
  p_seats_booked integer DEFAULT 1,
  p_start_time timestamptz DEFAULT NULL,
  p_end_time timestamptz DEFAULT NULL,
  p_pickup_location text DEFAULT '',
  p_dropoff_location text DEFAULT NULL,
  p_instructions text DEFAULT NULL,
  p_total_fare_inr numeric DEFAULT 0,
  p_pricing_key text DEFAULT NULL,
  p_estimated_km numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_customer_id uuid := auth.uid();
  v_listing public.vehicle_listings%ROWTYPE;
  v_effective_seats integer := GREATEST(1, COALESCE(p_seats_booked, 1));
  v_overlap_blocks integer := 0;
  v_overlap_full integer := 0;
  v_overlap_seats integer := 0;
  v_hours numeric;
  v_days numeric;
  v_total_fare numeric(10,2);
  v_advance_amount numeric(10,2);
  v_balance_due numeric(10,2);
  v_hold_until timestamptz := now() + interval '20 minutes';
  v_booking_code text;
  v_intent_code text;
  v_pickup_otp text;
  v_dropoff_otp text;
  v_booking public.vehicle_bookings%ROWTYPE;
  v_intent public.payment_intents%ROWTYPE;
  v_pricing_key text := lower(trim(COALESCE(p_pricing_key, '')));
  v_route jsonb;
  v_route_idx integer;
  v_route_count integer := 0;
  v_seat_divisor integer;
  v_km numeric;
  v_base numeric;
  v_adv_pct numeric;
BEGIN
  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to reserve a vehicle.' USING ERRCODE = '42501';
  END IF;

  IF p_start_time IS NULL OR p_end_time IS NULL OR p_end_time <= p_start_time THEN
    RAISE EXCEPTION 'End time must be after start time.' USING ERRCODE = '22023';
  END IF;

  IF nullif(trim(COALESCE(p_pickup_location, '')), '') IS NULL THEN
    RAISE EXCEPTION 'Pickup location is required.' USING ERRCODE = '22023';
  END IF;

  IF p_booking_mode NOT IN ('full_vehicle', 'per_seat') THEN
    RAISE EXCEPTION 'Invalid booking mode "%".', p_booking_mode USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_listing
  FROM public.vehicle_listings
  WHERE id = p_vehicle_listing_id
    AND is_active = true
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vehicle listing not found or inactive.' USING ERRCODE = 'P0002';
  END IF;

  IF v_listing.booking_mode <> 'both' AND v_listing.booking_mode <> p_booking_mode THEN
    RAISE EXCEPTION 'This vehicle only supports % booking mode.', v_listing.booking_mode USING ERRCODE = '22023';
  END IF;

  IF p_booking_mode = 'full_vehicle' THEN
    v_effective_seats := v_listing.total_seats;
  ELSIF v_effective_seats > v_listing.total_seats THEN
    RAISE EXCEPTION 'Requested seats (%) exceed capacity (%).', v_effective_seats, v_listing.total_seats USING ERRCODE = '22023';
  END IF;

  -- Expire stale soft holds on this vehicle first
  UPDATE public.vehicle_bookings
  SET status = 'expired', updated_at = now()
  WHERE vehicle_listing_id = p_vehicle_listing_id
    AND status = 'soft_hold'
    AND hold_expires_at IS NOT NULL
    AND hold_expires_at <= now();

  -- Check manual availability blocks
  SELECT COUNT(*) INTO v_overlap_blocks
  FROM public.vehicle_availability_blocks b
  WHERE b.vehicle_listing_id = p_vehicle_listing_id
    AND tstzrange(b.start_time, b.end_time, '[)') && tstzrange(p_start_time, p_end_time, '[)');

  IF v_overlap_blocks > 0 THEN
    RAISE EXCEPTION 'Vehicle is blocked for offline booking or maintenance during this slot.' USING ERRCODE = 'P0001';
  END IF;

  -- Check overlapping active bookings
  SELECT
    COUNT(*) FILTER (WHERE vb.booking_mode = 'full_vehicle'),
    COALESCE(SUM(vb.seats_booked), 0)
    INTO v_overlap_full, v_overlap_seats
  FROM public.vehicle_bookings vb
  WHERE vb.vehicle_listing_id = p_vehicle_listing_id
    AND vb.status IN ('soft_hold', 'pending_payment_confirm', 'confirmed', 'in_progress')
    AND tstzrange(vb.start_time, vb.end_time, '[)') && tstzrange(p_start_time, p_end_time, '[)');

  IF p_booking_mode = 'full_vehicle' AND (v_overlap_full > 0 OR v_overlap_seats > 0) THEN
    RAISE EXCEPTION 'Full vehicle is already reserved during the selected time window.' USING ERRCODE = 'P0001';
  END IF;

  IF p_booking_mode = 'per_seat' AND (v_overlap_full > 0 OR (v_overlap_seats + v_effective_seats) > v_listing.total_seats) THEN
    RAISE EXCEPTION 'Insufficient seats remaining for this time window.' USING ERRCODE = 'P0001';
  END IF;

  -- v21a: SERVER-AUTHORITATIVE fare (p_total_fare_inr is ignored; it is kept only for
  -- backwards-compatible call signatures). Mirrors VehicleDetailClient pricing options.
  v_hours := GREATEST(1, CEIL(EXTRACT(EPOCH FROM (p_end_time - p_start_time)) / 3600.0));
  v_days := GREATEST(1, CEIL(EXTRACT(EPOCH FROM (p_end_time - p_start_time)) / 86400.0));
  v_seat_divisor := GREATEST(1, COALESCE(v_listing.total_seats, 4));
  IF jsonb_typeof(v_listing.fixed_routes) = 'array' THEN
    v_route_count := jsonb_array_length(v_listing.fixed_routes);
  END IF;

  IF v_pricing_key = '' THEN
    v_pricing_key := CASE
      WHEN v_listing.pricing_model = 'fixed_route' AND v_route_count > 0 THEN 'route:0'
      WHEN v_listing.pricing_model = 'hourly' AND COALESCE(v_listing.rate_hourly_inr, 0) > 0 THEN 'rate:hourly'
      WHEN v_listing.pricing_model = 'per_km' AND COALESCE(v_listing.rate_per_km_inr, 0) > 0 THEN 'rate:per_km'
      WHEN COALESCE(v_listing.rate_daily_inr, 0) > 0 THEN 'rate:daily'
      WHEN v_route_count > 0 THEN 'route:0'
      WHEN COALESCE(v_listing.rate_hourly_inr, 0) > 0 THEN 'rate:hourly'
      WHEN COALESCE(v_listing.rate_per_km_inr, 0) > 0 THEN 'rate:per_km'
      ELSE 'rate:daily'
    END;
  END IF;

  IF v_pricing_key LIKE 'route:%' THEN
    IF v_pricing_key !~ '^route:[0-9]{1,4}$' THEN
      RAISE EXCEPTION 'Invalid fixed route selection.' USING ERRCODE = '22023';
    END IF;
    v_route_idx := substring(v_pricing_key FROM 7)::integer;
    IF v_route_idx >= v_route_count THEN
      RAISE EXCEPTION 'The selected fixed route is no longer offered by this vehicle.' USING ERRCODE = '22023';
    END IF;
    v_route := v_listing.fixed_routes -> v_route_idx;
    IF p_booking_mode = 'per_seat' THEN
      v_total_fare := ROUND(COALESCE(NULLIF(v_route->>'fare_inr', '')::numeric, 0) * v_effective_seats);
    ELSE
      v_total_fare := ROUND(
        COALESCE(
          NULLIF(NULLIF(v_route->>'full_vehicle_fare_inr', '')::numeric, 0),
          COALESCE(NULLIF(v_route->>'fare_inr', '')::numeric, 0) * v_seat_divisor
        )
      );
    END IF;
  ELSIF v_pricing_key = 'rate:hourly' THEN
    v_base := ROUND(COALESCE(NULLIF(v_listing.rate_hourly_inr, 0), 350) * v_hours);
    v_total_fare := CASE
      WHEN p_booking_mode = 'per_seat' THEN GREATEST(100, ROUND((v_base / v_seat_divisor) * v_effective_seats))
      ELSE v_base
    END;
  ELSIF v_pricing_key = 'rate:per_km' THEN
    v_km := GREATEST(5, LEAST(2000, COALESCE(NULLIF(p_estimated_km, 0), 20)));
    v_base := ROUND(COALESCE(NULLIF(v_listing.rate_per_km_inr, 0), 18) * v_km);
    v_total_fare := CASE
      WHEN p_booking_mode = 'per_seat' THEN GREATEST(100, ROUND((v_base / v_seat_divisor) * v_effective_seats))
      ELSE v_base
    END;
  ELSIF v_pricing_key = 'rate:daily' THEN
    v_base := ROUND(COALESCE(NULLIF(v_listing.rate_daily_inr, 0), 2500) * v_days);
    v_total_fare := CASE
      WHEN p_booking_mode = 'per_seat' THEN GREATEST(150, ROUND((v_base / v_seat_divisor) * v_effective_seats))
      ELSE v_base
    END;
  ELSE
    RAISE EXCEPTION 'Unknown pricing option "%".', p_pricing_key USING ERRCODE = '22023';
  END IF;

  IF v_total_fare IS NULL OR v_total_fare <= 0 THEN
    RAISE EXCEPTION 'This vehicle has no valid fare configured for the selected option.' USING ERRCODE = 'P0001';
  END IF;

  v_adv_pct := GREATEST(5, LEAST(100, COALESCE(NULLIF(v_listing.advance_percent, 0), 20)));
  v_advance_amount := GREATEST(1, ROUND(v_total_fare * v_adv_pct / 100.0));
  v_balance_due := GREATEST(0, v_total_fare - v_advance_amount);

  v_booking_code := 'VBK-' || upper(substr(md5(gen_random_uuid()::text || clock_timestamp()::text), 1, 6));
  v_intent_code := 'DDL-' || upper(substr(md5(random()::text || gen_random_uuid()::text), 1, 6));
  v_pickup_otp := public.generate_6digit_otp();
  v_dropoff_otp := public.generate_6digit_otp();

  INSERT INTO public.vehicle_bookings (
    booking_code,
    vehicle_listing_id,
    customer_id,
    booking_mode,
    seats_booked,
    start_time,
    end_time,
    pickup_location,
    dropoff_location,
    instructions,
    total_fare_inr,
    advance_amount_inr,
    balance_due_inr,
    status,
    hold_expires_at,
    hub_id
  )
  VALUES (
    v_booking_code,
    p_vehicle_listing_id,
    v_customer_id,
    p_booking_mode,
    v_effective_seats,
    p_start_time,
    p_end_time,
    trim(p_pickup_location),
    nullif(trim(COALESCE(p_dropoff_location, '')), ''),
    nullif(trim(COALESCE(p_instructions, '')), ''),
    v_total_fare,
    v_advance_amount,
    v_balance_due,
    'soft_hold',
    v_hold_until,
    v_listing.origin_hub_id
  )
  RETURNING * INTO v_booking;

  -- Store OTPs strictly in vehicle_booking_otps (never on vehicle_bookings)
  INSERT INTO public.vehicle_booking_otps (booking_id, pickup_otp, dropoff_otp)
  VALUES (v_booking.id, v_pickup_otp, v_dropoff_otp);

  INSERT INTO public.payment_intents (
    intent_code,
    user_id,
    purpose,
    reference_id,
    amount_inr,
    provider,
    status,
    expires_at,
    hub_id
  )
  VALUES (
    v_intent_code,
    v_customer_id,
    'vehicle_booking',
    v_booking.id,
    v_advance_amount,
    'manual_upi',
    'awaiting_payment',
    v_hold_until,
    v_listing.origin_hub_id
  )
  RETURNING * INTO v_intent;

  UPDATE public.vehicle_bookings
  SET payment_intent_id = v_intent.id
  WHERE id = v_booking.id
  RETURNING * INTO v_booking;

  -- Return OTPs directly to the creating customer in the response payload
  RETURN jsonb_build_object(
    'booking', to_jsonb(v_booking) || jsonb_build_object('start_otp', v_pickup_otp, 'end_otp', v_dropoff_otp),
    'payment_intent', to_jsonb(v_intent)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.create_vehicle_booking_with_intent(
  uuid, text, integer, timestamptz, timestamptz, text, text, text, numeric, text, numeric
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_vehicle_booking_with_intent(
  uuid, text, integer, timestamptz, timestamptz, text, text, text, numeric, text, numeric
) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_vehicle_booking_with_intent(
  uuid, text, integer, timestamptz, timestamptz, text, text, text, numeric, text, numeric
) TO authenticated;

-- Backfill hub_id on legacy vehicle bookings / intents from the vehicle's origin hub
UPDATE public.vehicle_bookings vb
SET hub_id = vl.origin_hub_id
FROM public.vehicle_listings vl
WHERE vl.id = vb.vehicle_listing_id
  AND vb.hub_id IS NULL
  AND vl.origin_hub_id IS NOT NULL;

-- [v21a] Re-issued from 20261124_pass_v14b_schema_hardening.sql:191 with targeted patches.
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
  -- v21a IDOR guard
  IF p_user_id IS NOT NULL
     AND p_user_id IS DISTINCT FROM auth.uid()
     AND COALESCE(current_setting('role', true), '') <> 'service_role'
     AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Forbidden: you may only load your own operational hats.'
      USING ERRCODE = '42501';
  END IF;

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

  SELECT jsonb_build_object(
    'id', d.id,
    'user_id', d.profile_id,
    'profile_id', d.profile_id,
    'hub_id', d.hub_id,
    'vehicle_type', d.vehicle_type,
    'vehicle_reg_no', d.vehicle_reg_no,
    'kyc_status', d.kyc_status,
    'kyc_verified', d.kyc_verified,
    'is_online', d.is_online,
    'is_active', d.is_active
  ) INTO v_driver_profile
  FROM public.drivers d
  WHERE d.profile_id = v_uid
    AND d.is_active = true
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
REVOKE ALL ON FUNCTION public.get_user_operational_hats(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_user_operational_hats(uuid) TO authenticated, service_role;

-- =============================================================================
-- §14. CUSTOMER CANCELLATION, >15m DISPATCH SLA & POD PURGE (P0-26)
-- =============================================================================

-- [v21a] Re-issued from 20261120_phase73a_booking_and_hotels.sql:423 with targeted patches.
CREATE OR REPLACE FUNCTION public.guard_payment_intent_user_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
BEGIN
  -- v21a: `current_user` is the function owner inside trusted SECURITY DEFINER RPCs
  IF current_user NOT IN ('authenticated', 'anon') THEN
    RETURN NEW;
  END IF;

  IF current_setting('role', true) = 'service_role'
     OR public.is_super_admin()
     OR public.can_confirm_hub_payment(OLD.hub_id) THEN
    RETURN NEW;
  END IF;

  IF OLD.status <> 'awaiting_payment' THEN
    RAISE EXCEPTION 'Payment intent can only be updated while awaiting payment.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.intent_code IS DISTINCT FROM OLD.intent_code
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.hub_id IS DISTINCT FROM OLD.hub_id
     OR NEW.purpose IS DISTINCT FROM OLD.purpose
     OR NEW.reference_id IS DISTINCT FROM OLD.reference_id
     OR NEW.print_order_id IS DISTINCT FROM OLD.print_order_id
     OR NEW.resource_booking_id IS DISTINCT FROM OLD.resource_booking_id
     OR NEW.amount_inr IS DISTINCT FROM OLD.amount_inr
     OR NEW.base_amount_inr IS DISTINCT FROM OLD.base_amount_inr
     OR NEW.discount_inr IS DISTINCT FROM OLD.discount_inr
     OR NEW.convenience_fee_inr IS DISTINCT FROM OLD.convenience_fee_inr
     OR NEW.promo_code_id IS DISTINCT FROM OLD.promo_code_id
     OR NEW.provider IS DISTINCT FROM OLD.provider
     OR NEW.provider_order_id IS DISTINCT FROM OLD.provider_order_id
     OR NEW.provider_payment_id IS DISTINCT FROM OLD.provider_payment_id
     OR NEW.verified_by IS DISTINCT FROM OLD.verified_by
     OR NEW.refund_utr_ref IS DISTINCT FROM OLD.refund_utr_ref
     OR NEW.refund_notes IS DISTINCT FROM OLD.refund_notes THEN
    RAISE EXCEPTION 'Unauthorized modification of protected payment intent fields.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.status NOT IN ('awaiting_payment', 'pending_manual') THEN
    RAISE EXCEPTION 'Users may only submit manual UTR proof (pending_manual).'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.customer_request_cancellation(
  p_booking_id uuid,
  p_reason text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_reason text := NULLIF(trim(COALESCE(p_reason, '')), '');
  v_order public.delivery_orders%ROWTYPE;
  v_booking public.vehicle_bookings%ROWTYPE;
  v_actor_name text;
  v_next_status text;
  v_refund_requested boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in required.' USING ERRCODE = '42501';
  END IF;

  IF v_reason IS NULL OR length(v_reason) < 5 THEN
    RAISE EXCEPTION 'Please give a cancellation reason (at least 5 characters).' USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(NULLIF(trim(p.full_name), ''), p.username)
    INTO v_actor_name
  FROM public.profiles p WHERE p.id = v_uid;

  -- ---- Pick N Drop ----
  SELECT * INTO v_order FROM public.delivery_orders WHERE id = p_booking_id FOR UPDATE;
  IF FOUND THEN
    IF v_order.customer_id IS DISTINCT FROM v_uid THEN
      RAISE EXCEPTION 'Forbidden: you can only cancel your own orders.' USING ERRCODE = '42501';
    END IF;

    IF v_order.status IN ('completed', 'cancelled') THEN
      RAISE EXCEPTION 'Order % is already closed.', v_order.order_code USING ERRCODE = 'P0001';
    END IF;

    IF v_order.status = 'disputed' THEN
      RAISE EXCEPTION 'Order % is already under Dispatch Mediator review.', v_order.order_code USING ERRCODE = 'P0001';
    END IF;

    IF v_order.status = 'payment_submitted'
       AND COALESCE(v_order.dispute_reason, '') LIKE 'Customer cancellation requested%' THEN
      RAISE EXCEPTION 'A cancellation request for % is already with the Dispatch Mediator.', v_order.order_code USING ERRCODE = 'P0001';
    END IF;

    IF v_order.status = 'awaiting_payment' THEN
      v_next_status := 'cancelled';
      UPDATE public.delivery_orders
      SET status = 'cancelled', dispute_reason = 'Cancelled by customer before payment: ' || v_reason, updated_at = now()
      WHERE id = v_order.id;

      UPDATE public.payment_intents
      SET status = 'failed', refund_notes = 'Cancelled by customer before payment: ' || v_reason, updated_at = now()
      WHERE purpose = 'pick_n_drop'
        AND reference_id = v_order.id
        AND status = 'awaiting_payment';
    ELSIF v_order.status = 'payment_submitted' THEN
      -- UTR not verified yet: keep it verifiable. The mediator verifies (then refunds) or rejects.
      v_next_status := 'payment_submitted';
      v_refund_requested := true;
      UPDATE public.delivery_orders
      SET dispute_reason = 'Customer cancellation requested before UPI verification: ' || v_reason, updated_at = now()
      WHERE id = v_order.id;
    ELSE
      -- Verified money is held: freeze for the mediator, who refunds via mediator_resolve_escrow_payout
      v_next_status := 'disputed';
      v_refund_requested := true;
      UPDATE public.delivery_orders
      SET status = 'disputed', dispute_reason = 'Customer cancellation & refund request: ' || v_reason, updated_at = now()
      WHERE id = v_order.id;
    END IF;

    INSERT INTO public.delivery_order_events (order_id, actor_id, event_type, payload)
    VALUES (
      v_order.id, v_uid,
      CASE WHEN v_refund_requested THEN 'customer_refund_requested' ELSE 'customer_cancelled_unpaid' END,
      jsonb_build_object('previous_status', v_order.status, 'reason', v_reason)
    );

    INSERT INTO public.audit_logs (
      actor_id, actor_name, actor_role, workspace, action,
      target_id, target_name, details, target_table, metadata
    )
    VALUES (
      v_uid, v_actor_name, 'customer', 'customer',
      CASE WHEN v_refund_requested THEN 'customer_refund_requested' ELSE 'customer_cancelled_unpaid' END,
      v_order.id::text, v_order.order_code,
      'Customer cancellation for ' || v_order.order_code || ': ' || v_reason,
      'delivery_orders',
      jsonb_build_object('previous_status', v_order.status, 'next_status', v_next_status, 'hub_id', v_order.hub_id)
    );

    RETURN jsonb_build_object(
      'ok', true, 'domain', 'pick_n_drop', 'booking_id', v_order.id, 'code', v_order.order_code,
      'status', v_next_status, 'refund_requested', v_refund_requested
    );
  END IF;

  -- ---- Scheduled vehicle bookings ----
  SELECT * INTO v_booking FROM public.vehicle_bookings WHERE id = p_booking_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Booking not found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_booking.customer_id IS DISTINCT FROM v_uid THEN
    RAISE EXCEPTION 'Forbidden: you can only cancel your own bookings.' USING ERRCODE = '42501';
  END IF;

  IF v_booking.status IN ('completed', 'cancelled', 'expired') THEN
    RAISE EXCEPTION 'Booking % is already closed.', v_booking.booking_code USING ERRCODE = 'P0001';
  END IF;

  IF v_booking.status = 'disputed' THEN
    RAISE EXCEPTION 'Booking % is already under Dispatch Mediator review.', v_booking.booking_code USING ERRCODE = 'P0001';
  END IF;

  IF v_booking.status = 'pending_payment_confirm'
     AND COALESCE(v_booking.dispute_reason, '') LIKE 'Customer cancellation requested%' THEN
    RAISE EXCEPTION 'A cancellation request for % is already with the Dispatch Mediator.', v_booking.booking_code USING ERRCODE = 'P0001';
  END IF;

  IF v_booking.status = 'soft_hold' THEN
    v_next_status := 'cancelled';
    UPDATE public.vehicle_bookings
    SET status = 'cancelled', dispute_reason = 'Cancelled by customer before payment: ' || v_reason, updated_at = now()
    WHERE id = v_booking.id;

    UPDATE public.payment_intents
    SET status = 'failed', refund_notes = 'Cancelled by customer before payment: ' || v_reason, updated_at = now()
    WHERE purpose = 'vehicle_booking'
      AND reference_id = v_booking.id
      AND status = 'awaiting_payment';
  ELSIF v_booking.status = 'pending_payment_confirm' THEN
    -- UTR not verified yet: keep it verifiable (mediator verifies then refunds, or rejects)
    v_next_status := 'pending_payment_confirm';
    v_refund_requested := true;
    UPDATE public.vehicle_bookings
    SET dispute_reason = 'Customer cancellation requested before UPI verification: ' || v_reason, updated_at = now()
    WHERE id = v_booking.id;
  ELSE
    v_next_status := 'disputed';
    v_refund_requested := true;
    UPDATE public.vehicle_bookings
    SET
      status = 'disputed',
      escrow_status = CASE WHEN escrow_status = 'escrow_held' THEN 'frozen_dispute' ELSE escrow_status END,
      dispute_reason = 'Customer cancellation & refund request: ' || v_reason,
      updated_at = now()
    WHERE id = v_booking.id;
  END IF;

  INSERT INTO public.audit_logs (
    actor_id, actor_name, actor_role, workspace, action,
    target_id, target_name, details, target_table, metadata
  )
  VALUES (
    v_uid, v_actor_name, 'customer', 'customer',
    CASE WHEN v_refund_requested THEN 'customer_refund_requested' ELSE 'customer_cancelled_unpaid' END,
    v_booking.id::text, v_booking.booking_code,
    'Customer cancellation for ' || v_booking.booking_code || ': ' || v_reason,
    'vehicle_bookings',
    jsonb_build_object('previous_status', v_booking.status, 'next_status', v_next_status, 'hub_id', v_booking.hub_id)
  );

  RETURN jsonb_build_object(
    'ok', true, 'domain', 'vehicle_booking', 'booking_id', v_booking.id, 'code', v_booking.booking_code,
    'status', v_next_status, 'refund_requested', v_refund_requested
  );
END;
$$;

REVOKE ALL ON FUNCTION public.customer_request_cancellation(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.customer_request_cancellation(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.customer_request_cancellation(uuid, text) TO authenticated;

-- Funded Pick N Drop jobs still unclaimed after N minutes (default 15), hub-scoped
CREATE OR REPLACE FUNCTION public.get_pnd_dispatch_sla_breaches(p_threshold_minutes integer DEFAULT 15)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_global boolean := false;
  v_threshold integer := GREATEST(1, LEAST(COALESCE(p_threshold_minutes, 15), 1440));
  v_rows jsonb := '[]'::jsonb;
BEGIN
  IF v_uid IS NULL OR NOT public.is_pnd_mediator(v_uid) THEN
    RAISE EXCEPTION 'Forbidden: Dispatch Mediator, Hub Manager or Admin access required.'
      USING ERRCODE = '42501';
  END IF;

  SELECT lower(COALESCE(p.role, '')) INTO v_role FROM public.profiles p WHERE p.id = v_uid;
  v_global := v_role IN ('admin', 'super_admin', 'mediator');

  SELECT COALESCE(
    jsonb_agg(
      jsonb_build_object(
        'id', o.id,
        'order_code', o.order_code,
        'hub_id', o.hub_id,
        'status', o.status,
        'service_mode', o.service_mode,
        'quoted_fare_inr', o.quoted_fare_inr,
        'funded_at', COALESCE(o.payment_verified_at, o.updated_at, o.created_at),
        'minutes_waiting', floor(
          extract(epoch FROM (now() - COALESCE(o.payment_verified_at, o.updated_at, o.created_at))) / 60
        )::integer
      )
      ORDER BY COALESCE(o.payment_verified_at, o.updated_at, o.created_at) ASC
    ),
    '[]'::jsonb
  )
  INTO v_rows
  FROM public.delivery_orders o
  WHERE o.status = 'escrow_held'
    AND o.driver_id IS NULL
    AND COALESCE(o.payment_verified_at, o.updated_at, o.created_at) <= now() - make_interval(mins => v_threshold)
    AND (
      v_global
      OR o.hub_id IS NULL
      OR EXISTS (
        SELECT 1 FROM public.hub_managers hm
        WHERE hm.profile_id = v_uid AND hm.is_active = true AND hm.hub_id = o.hub_id
      )
    );

  RETURN jsonb_build_object('threshold_minutes', v_threshold, 'checked_at', now(), 'breaches', v_rows);
END;
$$;

REVOKE ALL ON FUNCTION public.get_pnd_dispatch_sla_breaches(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_pnd_dispatch_sla_breaches(integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_pnd_dispatch_sla_breaches(integer) TO authenticated;

-- 48h POD purge now covers vehicle_bookings and NEVER purges evidence under dispute
CREATE OR REPLACE FUNCTION public.purge_expired_delivery_pods()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  v_order_paths text[];
  v_booking_paths text[];
  v_count integer := 0;
  v_rows integer := 0;
BEGIN
  SELECT COALESCE(array_agg(o.pod_storage_path), ARRAY[]::text[])
    INTO v_order_paths
  FROM public.delivery_orders o
  WHERE o.pod_storage_path IS NOT NULL
    AND o.pod_purge_at IS NOT NULL
    AND o.pod_purge_at <= now()
    AND o.status <> 'disputed';

  SELECT COALESCE(array_agg(vb.pod_storage_path), ARRAY[]::text[])
    INTO v_booking_paths
  FROM public.vehicle_bookings vb
  WHERE vb.pod_storage_path IS NOT NULL
    AND vb.pod_purge_at IS NOT NULL
    AND vb.pod_purge_at <= now()
    AND vb.status <> 'disputed'
    AND COALESCE(vb.escrow_status, '') <> 'frozen_dispute';

  IF array_length(v_order_paths, 1) IS NOT NULL THEN
    DELETE FROM storage.objects
    WHERE bucket_id = 'delivery-pods'
      AND name = ANY(v_order_paths);

    UPDATE public.delivery_orders
    SET pod_storage_path = NULL, pod_purged_at = now(), updated_at = now()
    WHERE pod_storage_path = ANY(v_order_paths);
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_count := v_count + v_rows;
  END IF;

  IF array_length(v_booking_paths, 1) IS NOT NULL THEN
    DELETE FROM storage.objects
    WHERE bucket_id = 'delivery-pods'
      AND name = ANY(v_booking_paths);

    UPDATE public.vehicle_bookings
    SET pod_storage_path = NULL, pod_purged_at = now(), updated_at = now()
    WHERE pod_storage_path = ANY(v_booking_paths);
    GET DIAGNOSTICS v_rows = ROW_COUNT;
    v_count := v_count + v_rows;
  END IF;

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_expired_delivery_pods() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.purge_expired_delivery_pods() FROM anon;
REVOKE ALL ON FUNCTION public.purge_expired_delivery_pods() FROM authenticated;
GRANT EXECUTE ON FUNCTION public.purge_expired_delivery_pods() TO service_role;

-- =============================================================================
-- §15. CONTACT US & VEHICLE REVIEWS (P0-24)
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.contact_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  hub_id uuid REFERENCES public.service_hubs(id) ON DELETE SET NULL,
  name text NOT NULL CHECK (char_length(trim(name)) BETWEEN 2 AND 120),
  email text NOT NULL CHECK (char_length(email) <= 254 AND email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  topic text NOT NULL DEFAULT 'general' CHECK (char_length(topic) <= 60),
  message text NOT NULL CHECK (char_length(trim(message)) BETWEEN 10 AND 4000),
  status text NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'in_progress', 'resolved', 'spam')),
  admin_notes text,
  resolved_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contact_messages_status_created
  ON public.contact_messages (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_contact_messages_email_created
  ON public.contact_messages (lower(email), created_at DESC);

ALTER TABLE public.contact_messages ENABLE ROW LEVEL SECURITY;

-- Inserts happen ONLY through POST /api/contact (service_role, validated + rate limited)
DROP POLICY IF EXISTS contact_messages_admin_select ON public.contact_messages;
CREATE POLICY contact_messages_admin_select
  ON public.contact_messages
  FOR SELECT
  TO authenticated
  USING (public.is_pnd_admin(auth.uid()) OR (user_id IS NOT NULL AND user_id = auth.uid()));

DROP POLICY IF EXISTS contact_messages_admin_update ON public.contact_messages;
CREATE POLICY contact_messages_admin_update
  ON public.contact_messages
  FOR UPDATE
  TO authenticated
  USING (public.is_pnd_admin(auth.uid()))
  WITH CHECK (public.is_pnd_admin(auth.uid()));

CREATE TABLE IF NOT EXISTS public.vehicle_reviews (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vehicle_listing_id uuid NOT NULL REFERENCES public.vehicle_listings(id) ON DELETE CASCADE,
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES public.profiles(id) ON DELETE CASCADE,
  reviewer_name text NOT NULL CHECK (char_length(trim(reviewer_name)) BETWEEN 2 AND 80),
  rating integer NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment text CHECK (comment IS NULL OR char_length(comment) <= 1000),
  moderation_status text NOT NULL DEFAULT 'approved' CHECK (moderation_status IN ('approved', 'hidden', 'flagged')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT vehicle_reviews_one_per_user UNIQUE (vehicle_listing_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_vehicle_reviews_listing_created
  ON public.vehicle_reviews (vehicle_listing_id, created_at DESC);

ALTER TABLE public.vehicle_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vehicle_reviews_public_select ON public.vehicle_reviews;
CREATE POLICY vehicle_reviews_public_select
  ON public.vehicle_reviews
  FOR SELECT
  USING (
    moderation_status = 'approved'
    OR (auth.uid() IS NOT NULL AND (user_id = auth.uid() OR public.is_pnd_admin(auth.uid())))
  );

DROP POLICY IF EXISTS vehicle_reviews_author_insert ON public.vehicle_reviews;
CREATE POLICY vehicle_reviews_author_insert
  ON public.vehicle_reviews
  FOR INSERT
  TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND moderation_status = 'approved'
    AND NOT EXISTS (
      SELECT 1
      FROM public.vehicle_listings vl
      LEFT JOIN public.drivers d ON d.id = vl.driver_id
      WHERE vl.id = vehicle_reviews.vehicle_listing_id
        AND (vl.owner_id = auth.uid() OR d.profile_id = auth.uid())
    )
  );

DROP POLICY IF EXISTS vehicle_reviews_author_delete ON public.vehicle_reviews;
CREATE POLICY vehicle_reviews_author_delete
  ON public.vehicle_reviews
  FOR DELETE
  TO authenticated
  USING (user_id = auth.uid() OR public.is_pnd_admin(auth.uid()));

DROP POLICY IF EXISTS vehicle_reviews_admin_update ON public.vehicle_reviews;
CREATE POLICY vehicle_reviews_admin_update
  ON public.vehicle_reviews
  FOR UPDATE
  TO authenticated
  USING (public.is_pnd_admin(auth.uid()))
  WITH CHECK (public.is_pnd_admin(auth.uid()));

-- =============================================================================
-- §16. FUNCTION GRANT LOCKDOWN (P0-15)
-- =============================================================================

DO $$
DECLARE
  r record;
BEGIN
  -- Server-only RPCs: email OTP storage/verification & atomic resource booking (API routes
  -- call these with the service_role client; anon/authenticated callers could forge OTPs,
  -- prices and payment states).
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'upsert_email_otp',
        'verify_email_otp',
        'create_atomic_resource_booking',
        'cleanup_temporary_media_assets'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;

  -- Internal helpers invoked only from SECURITY DEFINER code
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname IN (
        'is_hardcoded_super_admin_email',
        '_staff_permission_granted',
        '_staff_scope_aliases',
        '_staff_scope_granted',
        '_v21a_assert_dispatch_hub_scope',
        '_v21a_plan_scope_matches_listing',
        '_v21a_has_legacy_scope_subscription',
        '_v21a_listing_entitlements',
        '_v21a_can_manage_media_entity',
        'vault_vertical_order_customer_otp_v21a',
        'guard_staff_payment_policy_v21a'
      )
  LOOP
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM PUBLIC', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM anon', r.sig);
    EXECUTE format('REVOKE ALL ON FUNCTION %s FROM authenticated', r.sig);
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', r.sig);
  END LOOP;
END;
$$;

-- P0-15: functions that call pgcrypto (digest / gen_random_bytes / crypt / hmac ...) or PostGIS
-- (ST_*) but pin `search_path = public` fail on hosted Supabase, where both extensions live in
-- the `extensions` schema (e.g. verify_commerce_pickup_otp, generate_6digit_otp). Append
-- `extensions` to their pinned search_path (idempotent; untouched if already present).
DO $$
DECLARE
  r record;
  v_existing text;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig, p.proconfig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.prokind = 'f'
      AND p.prosrc ~* '(digest|gen_random_bytes|hmac|crypt|gen_salt|pgp_sym_encrypt|pgp_sym_decrypt|st_[a-z0-9_]+)\s*\('
      AND NOT EXISTS (
        SELECT 1
        FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) AS c(cfg)
        WHERE c.cfg ILIKE 'search_path=%extensions%'
      )
  LOOP
    SELECT substring(c.cfg FROM '^search_path=(.*)$')
      INTO v_existing
    FROM unnest(COALESCE(r.proconfig, ARRAY[]::text[])) AS c(cfg)
    WHERE c.cfg ILIKE 'search_path=%'
    LIMIT 1;

    EXECUTE format(
      'ALTER FUNCTION %s SET search_path = %s',
      r.sig,
      COALESCE(NULLIF(trim(v_existing), ''), 'public') || ', extensions'
    );
  END LOOP;
END;
$$;

-- Helpers evaluated by RLS policies / SECURITY INVOKER triggers in client sessions
REVOKE ALL ON FUNCTION public.staff_has_listing_grant(uuid, text, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.staff_has_listing_grant(uuid, text, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.staff_has_listing_grant(uuid, text, text, uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public._v21a_is_hardcoded_super_admin_user(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._v21a_is_hardcoded_super_admin_user(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public._v21a_is_hardcoded_super_admin_user(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public._v21a_owner_can_view_staff_profile(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._v21a_owner_can_view_staff_profile(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public._v21a_owner_can_view_staff_profile(uuid) TO authenticated, service_role;

REVOKE ALL ON FUNCTION public._v21a_plan_targets_user(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._v21a_plan_targets_user(uuid, uuid) TO anon, authenticated, service_role;

COMMIT;
