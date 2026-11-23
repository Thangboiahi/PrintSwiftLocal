-- =============================================================================
-- Migration: 20261124_pass_v14a_auth_role_governance_and_pnd_mediator_fix.sql
-- Critical Blocking Fixes Only:
--   1. Allow `service_role` in `enforce_profile_role_governance()` so server-side
--      account provisioning / admin tools can assign non-visitor roles without
--      hitting `Unauthorized: Only authorized administrators can modify user roles`,
--      while preserving strict client-side signup & self-elevation locks.
--   2. Update `is_pnd_mediator(p_uid)` to grant Pick N Drop escrow/OTP mediation
--      to `hub_manager` (and active `hub_managers` rows) + `admin` + `super_admin`,
--      and revoke blanket `owner` access to `delivery_order_secrets`.
-- =============================================================================

-- 1. Fix enforce_profile_role_governance() for service_role compatibility
CREATE OR REPLACE FUNCTION public.enforce_profile_role_governance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_service boolean := (current_setting('role', true) = 'service_role');
BEGIN
  -- Keep updated_at current
  NEW.updated_at := COALESCE(NEW.updated_at, now());

  -- Hardcoded Super-Admin Rule
  IF NEW.email IS NOT NULL AND LOWER(TRIM(NEW.email)) IN ('thangboiahi@gmail.com', 'homeautomation.dd@gmail.com') THEN
    NEW.role := 'super_admin';
    RETURN NEW;
  END IF;

  -- Server-side service_role provisioning/admin updates are trusted (still constrained by profiles_role_check)
  IF v_is_service THEN
    NEW.role := COALESCE(NULLIF(TRIM(NEW.role), ''), 'visitor');
    RETURN NEW;
  END IF;

  -- Client Signup Default Rule (TG_OP = 'INSERT')
  IF TG_OP = 'INSERT' THEN
    NEW.role := 'visitor';
    RETURN NEW;
  END IF;

  -- Authorized Role Update Rule (TG_OP = 'UPDATE')
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

-- 2. Fix is_pnd_mediator(p_uid) to include hub_manager and remove blanket owner access
CREATE OR REPLACE FUNCTION public.is_pnd_mediator(p_uid uuid)
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
      AND p.role IN ('hub_manager', 'admin', 'super_admin')
  )
  OR EXISTS (
    SELECT 1
    FROM public.hub_managers hm
    WHERE hm.profile_id = p_uid
      AND hm.is_active = true
  );
$$;
