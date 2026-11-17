-- =============================================================================
-- Migration: 00016_email_otps_table.sql
-- Phase 49-C: Temporary Server-Side Email OTP Table & Restrictive RLS Policies
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.email_otps (
  email text PRIMARY KEY,
  otp text NOT NULL,
  expires_at timestamptz NOT NULL,
  created_at timestamptz DEFAULT now()
);

-- Enable Row-Level Security
ALTER TABLE public.email_otps ENABLE ROW LEVEL SECURITY;

-- Restrictive RLS policies: Deny anonymous/authenticated direct access;
-- only service_role or super_admin server functions can read/write.
DROP POLICY IF EXISTS "Service role full access on email_otps" ON public.email_otps;
CREATE POLICY "Service role full access on email_otps"
  ON public.email_otps
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS "Super admin access on email_otps" ON public.email_otps;
CREATE POLICY "Super admin access on email_otps"
  ON public.email_otps
  FOR ALL
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

-- Secure SECURITY DEFINER RPC functions so server routes can store and verify OTPs
-- even when only the anon key is configured in local/preview environments
CREATE OR REPLACE FUNCTION public.upsert_email_otp(
  p_email text,
  p_otp text,
  p_expires_at timestamptz
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.email_otps (email, otp, expires_at, created_at)
  VALUES (LOWER(TRIM(p_email)), TRIM(p_otp), p_expires_at, now())
  ON CONFLICT (email)
  DO UPDATE SET
    otp = EXCLUDED.otp,
    expires_at = EXCLUDED.expires_at,
    created_at = now();
END;
$$;

CREATE OR REPLACE FUNCTION public.verify_email_otp(
  p_email text,
  p_otp text,
  p_consume boolean DEFAULT false
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_valid boolean := false;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM public.email_otps
    WHERE email = LOWER(TRIM(p_email))
      AND otp = TRIM(p_otp)
      AND expires_at > now()
  ) INTO v_valid;

  IF v_valid AND p_consume THEN
    DELETE FROM public.email_otps
    WHERE email = LOWER(TRIM(p_email));
  END IF;

  RETURN v_valid;
END;
$$;
