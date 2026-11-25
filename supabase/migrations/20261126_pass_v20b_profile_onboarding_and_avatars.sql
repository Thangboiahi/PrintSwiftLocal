-- =============================================================================
-- Migration: 20261126_pass_v20b_profile_onboarding_and_avatars.sql
-- Sprint v20b: Profile Onboarding Columns, Google OAuth First-Sign-In Sync,
-- Anti-Escalation Profile Update Guard, and Public-Read / Owner-Write `avatars`
-- Storage Bucket Policies.
--
-- Idempotent & non-destructive: builds cleanly on top of existing
-- `trg_enforce_profile_role_governance` (pass_v14a) and
-- `trg_guard_immutable_superadmin` (pass_v15a).
-- =============================================================================

BEGIN;

-- 1. Ensure required profile & onboarding columns exist on public.profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS social_links jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS preferred_locality text,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS phone text;

-- Ensure existing NULL social_links are normalized to empty jsonb object
UPDATE public.profiles
SET social_links = '{}'::jsonb
WHERE social_links IS NULL;

ALTER TABLE public.profiles
  ALTER COLUMN social_links SET DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_profiles_onboarding_pending
  ON public.profiles (id)
  WHERE onboarding_completed_at IS NULL;

-- 2. Auth User -> Profile sync trigger (populates Google OAuth full_name & avatar_url
--    on first sign-in without ever overwriting existing user-edited profile values)
CREATE OR REPLACE FUNCTION public.handle_new_user_v20b()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meta jsonb := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  v_full_name text := NULLIF(
    TRIM(COALESCE(v_meta->>'full_name', v_meta->>'name', '')),
    ''
  );
  v_avatar_url text := NULLIF(
    TRIM(COALESCE(v_meta->>'avatar_url', v_meta->>'picture', '')),
    ''
  );
  v_phone text := NULLIF(
    TRIM(COALESCE(NEW.phone, v_meta->>'phone', '')),
    ''
  );
  v_fallback_name text := COALESCE(
    v_full_name,
    NULLIF(SPLIT_PART(COALESCE(NEW.email, ''), '@', 1), ''),
    'DD oodle Member'
  );
BEGIN
  INSERT INTO public.profiles (
    id,
    email,
    full_name,
    avatar_url,
    phone,
    social_links,
    updated_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    v_fallback_name,
    v_avatar_url,
    v_phone,
    '{}'::jsonb,
    now()
  )
  ON CONFLICT (id) DO UPDATE
  SET
    email = COALESCE(NULLIF(TRIM(public.profiles.email), ''), EXCLUDED.email),
    full_name = CASE
      WHEN NULLIF(TRIM(public.profiles.full_name), '') IS NULL THEN EXCLUDED.full_name
      ELSE public.profiles.full_name
    END,
    avatar_url = CASE
      WHEN NULLIF(TRIM(public.profiles.avatar_url), '') IS NULL THEN EXCLUDED.avatar_url
      ELSE public.profiles.avatar_url
    END,
    phone = CASE
      WHEN NULLIF(TRIM(public.profiles.phone), '') IS NULL THEN EXCLUDED.phone
      ELSE public.profiles.phone
    END,
    updated_at = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_handle_new_user_v20b ON auth.users;
CREATE TRIGGER trg_handle_new_user_v20b
  AFTER INSERT OR UPDATE OF raw_user_meta_data, email ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_v20b();

-- 3. Strict Profile Self-Update Guard:
--    Allows authenticated users to update ONLY their own safe profile columns
--    while blocking self-escalation of `role`, `trial_used_at`, or optional
--    `roles` / `is_super_admin` columns if present on `public.profiles`.
CREATE OR REPLACE FUNCTION public.guard_profile_sensitive_columns_v20b()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_service boolean := (current_setting('role', true) = 'service_role');
  v_is_admin boolean := false;
  v_old_json jsonb := to_jsonb(OLD);
  v_new_json jsonb := to_jsonb(NEW);
BEGIN
  IF v_is_service THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role IN ('admin', 'super_admin')
    )
    INTO v_is_admin;
  END IF;

  IF v_is_admin THEN
    RETURN NEW;
  END IF;

  -- Block non-admin mutations to sensitive governance / monetization columns
  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'Unauthorized: role cannot be modified by the profile owner.';
  END IF;

  IF (v_old_json ? 'roles') AND (v_new_json->'roles') IS DISTINCT FROM (v_old_json->'roles') THEN
    RAISE EXCEPTION 'Unauthorized: roles cannot be modified by the profile owner.';
  END IF;

  IF (v_old_json ? 'is_super_admin')
     AND (v_new_json->'is_super_admin') IS DISTINCT FROM (v_old_json->'is_super_admin') THEN
    RAISE EXCEPTION 'Unauthorized: is_super_admin cannot be modified by the profile owner.';
  END IF;

  IF (v_old_json ? 'trial_used_at')
     AND (v_new_json->'trial_used_at') IS DISTINCT FROM (v_old_json->'trial_used_at') THEN
    RAISE EXCEPTION 'Unauthorized: trial_used_at is system-managed and cannot be modified.';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_profile_sensitive_columns_v20b ON public.profiles;
CREATE TRIGGER trg_guard_profile_sensitive_columns_v20b
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_profile_sensitive_columns_v20b();

-- Ensure RLS is enabled and owner-only UPDATE policy exists on public.profiles
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "profiles_owner_safe_update_v20b" ON public.profiles;
CREATE POLICY "profiles_owner_safe_update_v20b"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- 4. Public-Read, Owner-Write `avatars` Storage Bucket & Strict Path Policies
--    Scoped strictly to `auth.uid()::text || '/%'`
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true,
  2097152, -- 2 MB max ceiling (client compresses to <= 150 KB WebP)
  ARRAY['image/webp', 'image/jpeg', 'image/png']
)
ON CONFLICT (id) DO UPDATE
SET
  public = true,
  file_size_limit = LEAST(COALESCE(storage.buckets.file_size_limit, 2097152), 2097152),
  allowed_mime_types = ARRAY['image/webp', 'image/jpeg', 'image/png'];

DROP POLICY IF EXISTS "avatars_public_read" ON storage.objects;
CREATE POLICY "avatars_public_read"
  ON storage.objects
  FOR SELECT
  TO anon, authenticated
  USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "avatars_owner_insert" ON storage.objects;
CREATE POLICY "avatars_owner_insert"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND name LIKE (auth.uid()::text || '/%')
  );

DROP POLICY IF EXISTS "avatars_owner_update" ON storage.objects;
CREATE POLICY "avatars_owner_update"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND name LIKE (auth.uid()::text || '/%')
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND name LIKE (auth.uid()::text || '/%')
  );

DROP POLICY IF EXISTS "avatars_owner_delete" ON storage.objects;
CREATE POLICY "avatars_owner_delete"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND name LIKE (auth.uid()::text || '/%')
  );

COMMIT;
