-- =============================================================================
-- Migration: 00015_auth_profiles_sync.sql
-- Phase 49-A: Auth Schema, Hardcoded Super-Admin Trigger & Profile Sync
-- =============================================================================

-- 1. Ensure all required signup and profile columns exist on public.profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username text UNIQUE,
  ADD COLUMN IF NOT EXISTS full_name text,
  ADD COLUMN IF NOT EXISTS email text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS role text DEFAULT 'visitor',
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS bio text,
  ADD COLUMN IF NOT EXISTS social_links jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Ensure role defaults to 'visitor' and normalize any legacy role values before constraint check
ALTER TABLE public.profiles
  ALTER COLUMN role SET DEFAULT 'visitor';

UPDATE public.profiles
SET role = 'visitor'
WHERE role IS NULL
   OR role NOT IN ('visitor', 'owner', 'staff', 'super_admin');

-- Drop existing role check constraint if present and enforce strict role check constraint
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_check
  CHECK (role IN ('visitor', 'owner', 'staff', 'super_admin'));

-- 2. PostgreSQL trigger function for hardcoded super-admin & signup role governance
CREATE OR REPLACE FUNCTION public.enforce_profile_role_governance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Keep updated_at current
  NEW.updated_at := COALESCE(NEW.updated_at, now());

  -- Hardcoded Super-Admin Rule
  IF NEW.email IS NOT NULL AND LOWER(TRIM(NEW.email)) IN ('thangboiahi@gmail.com', 'homeautomation.dd@gmail.com') THEN
    NEW.role := 'super_admin';
    RETURN NEW;
  END IF;

  -- Signup Default Rule (TG_OP = 'INSERT')
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
        AND role = 'super_admin'
    ) THEN
      RAISE EXCEPTION 'Unauthorized: Only authorized administrators can modify user roles.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_profile_role_governance ON public.profiles;

CREATE TRIGGER trg_enforce_profile_role_governance
  BEFORE INSERT OR UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_profile_role_governance();

-- 3. Immediate sync statement for hardcoded super-admin accounts
UPDATE public.profiles
SET role = 'super_admin'
WHERE LOWER(TRIM(email)) IN ('thangboiahi@gmail.com', 'homeautomation.dd@gmail.com');
