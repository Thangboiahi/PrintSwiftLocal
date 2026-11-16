-- =============================================================================
-- Migration: 00009_admin_rls_settings.sql
-- Phase 32: Super Admin Platform Governance — app_settings Table & Strict RLS
-- =============================================================================

-- 1. Create global platform configuration table: public.app_settings
CREATE TABLE IF NOT EXISTS public.app_settings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  setting_key text UNIQUE NOT NULL,
  setting_value text NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.app_settings IS 'Global platform governance toggles and configuration key-value store managed exclusively by Super Admins.';
COMMENT ON COLUMN public.app_settings.setting_key IS 'Unique setting identifier (e.g., show_sample_data).';
COMMENT ON COLUMN public.app_settings.setting_value IS 'Serialized setting value (e.g., true / false).';

-- Seed default show_sample_data toggle
INSERT INTO public.app_settings (setting_key, setting_value, updated_at)
VALUES ('show_sample_data', 'true', now())
ON CONFLICT (setting_key) DO NOTHING;

-- 2. Enable Row Level Security on public.app_settings and public.profiles
ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Helper function to check whether the current authenticated user is a super_admin
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'super_admin'
  );
$$;

-- 3. RLS Policies for public.app_settings
-- Anyone (including anonymous public map visitors) can read global app settings
DROP POLICY IF EXISTS "Allow public read access to app_settings" ON public.app_settings;
CREATE POLICY "Allow public read access to app_settings"
  ON public.app_settings
  FOR SELECT
  USING (true);

-- ONLY users with role = 'super_admin' in public.profiles can insert/update/delete app_settings
DROP POLICY IF EXISTS "Allow super_admin to insert app_settings" ON public.app_settings;
CREATE POLICY "Allow super_admin to insert app_settings"
  ON public.app_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = auth.uid()
        AND role = 'super_admin'
    )
  );

DROP POLICY IF EXISTS "Allow super_admin to update app_settings" ON public.app_settings;
CREATE POLICY "Allow super_admin to update app_settings"
  ON public.app_settings
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = auth.uid()
        AND role = 'super_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = auth.uid()
        AND role = 'super_admin'
    )
  );

DROP POLICY IF EXISTS "Allow super_admin to delete app_settings" ON public.app_settings;
CREATE POLICY "Allow super_admin to delete app_settings"
  ON public.app_settings
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = auth.uid()
        AND role = 'super_admin'
    )
  );

-- 4. RLS Policies for public.profiles Role Governance
-- Public visitors and authenticated users can view profiles
DROP POLICY IF EXISTS "Allow public read access to profiles" ON public.profiles;
CREATE POLICY "Allow public read access to profiles"
  ON public.profiles
  FOR SELECT
  USING (true);

-- Users can update their own profile details ONLY if they do not escalate/alter their own role
DROP POLICY IF EXISTS "Allow users to update own profile without role change" ON public.profiles;
CREATE POLICY "Allow users to update own profile without role change"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND (
      role IS NOT DISTINCT FROM (
        SELECT p.role FROM public.profiles p WHERE p.id = auth.uid()
      )
      OR public.is_super_admin()
    )
  );

-- ONLY users with role = 'super_admin' can update any user's profile and role
DROP POLICY IF EXISTS "Allow super_admin to update any user role" ON public.profiles;
CREATE POLICY "Allow super_admin to update any user role"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = auth.uid()
        AND role = 'super_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = auth.uid()
        AND role = 'super_admin'
    )
  );
