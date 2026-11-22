-- =============================================================================
-- Migration: 20261122_pass_v6a_referrals_and_onboarding.sql
-- DD oodle — Pass V6-A:
--   1. Full Referral & Invite System (`profiles` referral columns + `referrals`)
--   2. Partner, Driver & Advertiser Onboarding Applications (`partner_applications`)
--   3. Private KYC Document Bucket (`kyc-documents`) & Media Asset Lifecycle
--   4. Secure `SECURITY DEFINER` RPCs:
--      - `ensure_user_referral_code`
--      - `apply_referral_code`
--      - `review_partner_application`
--   5. Public Platform Config Defaults (`onboarding_and_referrals`)
-- 100% IDEMPOTENT MIGRATION
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- -----------------------------------------------------------------------------
-- 0. Shared updated_at Trigger Function & Safe Notifications Column Sync
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_pass_v6a_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Ensure public.notifications has clickable action_url & modern columns cleanly
ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS type text DEFAULT 'system',
  ADD COLUMN IF NOT EXISTS is_read boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS action_url text,
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'notifications'
      AND column_name = 'recipient_role'
      AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE public.notifications ALTER COLUMN recipient_role DROP NOT NULL;
  END IF;
END;
$$;

-- =============================================================================
-- 1. Private KYC Document Storage Bucket (`kyc-documents`)
--    Strictly private (public = false), 10 MB ceiling, zero public SELECT policies.
--    All KYC views are minted strictly via 120s server-side signed URLs.
-- =============================================================================
INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'kyc-documents',
  'kyc-documents',
  false,
  10485760, -- 10 MB max per KYC document
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- Guarantee bucket remains strictly private even if created earlier
UPDATE storage.buckets
SET
  public = false,
  file_size_limit = COALESCE(file_size_limit, 10485760),
  allowed_mime_types = COALESCE(
    allowed_mime_types,
    ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
  )
WHERE id = 'kyc-documents';

-- Purge any accidental public/client SELECT policy on kyc-documents
DO $$
DECLARE
  v_pol record;
BEGIN
  FOR v_pol IN
    SELECT policyname
    FROM pg_policies
    WHERE schemaname = 'storage'
      AND tablename = 'objects'
      AND (
        lower(policyname) LIKE '%kyc-documents%'
        OR lower(policyname) LIKE '%kyc_documents%'
        OR COALESCE(qual, '') LIKE '%kyc-documents%'
      )
      AND cmd IN ('SELECT', 'ALL')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', v_pol.policyname);
  END LOOP;
END;
$$;

-- Allow Hub Managers to see kyc_document tracking metadata for their managed hub
-- (Actual file access still requires /api/onboarding/kyc-signed-url)
DROP POLICY IF EXISTS "Hub managers can view hub kyc media metadata" ON public.media_assets;
CREATE POLICY "Hub managers can view hub kyc media metadata"
  ON public.media_assets
  FOR SELECT
  TO authenticated
  USING (
    entity_type = 'kyc_document'
    AND hub_id IS NOT NULL
    AND public.is_hub_manager_for(hub_id)
  );

-- =============================================================================
-- 2. Referral System Schema (`public.profiles` columns + `public.referrals`)
-- =============================================================================

-- 2A. Add referral columns to public.profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS referral_code text,
  ADD COLUMN IF NOT EXISTS referred_by_user_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS referral_applied_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_referral_code_unique
  ON public.profiles (referral_code)
  WHERE referral_code IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_referred_by_user_id
  ON public.profiles (referred_by_user_id)
  WHERE referred_by_user_id IS NOT NULL;

-- Backfill unique referral_code (`DD-XXXXXX`) for existing profiles safely
DO $$
DECLARE
  v_prof record;
  v_candidate text;
  v_suffix integer;
BEGIN
  FOR v_prof IN
    SELECT id
    FROM public.profiles
    WHERE referral_code IS NULL OR trim(referral_code) = ''
  LOOP
    v_candidate := 'DD-' || upper(substr(replace(v_prof.id::text, '-', ''), 1, 6));
    v_suffix := 0;

    WHILE EXISTS (
      SELECT 1
      FROM public.profiles p2
      WHERE p2.referral_code = v_candidate
        AND p2.id <> v_prof.id
    ) LOOP
      v_suffix := v_suffix + 1;
      v_candidate := 'DD-' || upper(substr(md5(v_prof.id::text || '-' || v_suffix::text), 1, 6));
    END LOOP;

    UPDATE public.profiles
    SET referral_code = v_candidate
    WHERE id = v_prof.id;
  END LOOP;
END;
$$;

-- 2B. Create public.referrals
CREATE TABLE IF NOT EXISTS public.referrals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  referred_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  referral_code_used text NOT NULL,
  hub_id uuid REFERENCES public.service_hubs(id) ON DELETE SET NULL,
  referral_type text NOT NULL DEFAULT 'user_signup'
    CHECK (referral_type IN ('user_signup', 'partner_onboarding', 'driver_onboarding', 'advertiser_onboarding')),
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'qualified', 'rewarded', 'flagged', 'rejected')),
  reward_credit_inr numeric(10,2) NOT NULL DEFAULT 0 CHECK (reward_credit_inr >= 0),
  reward_note text,
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  qualified_at timestamptz,
  rewarded_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT referrals_no_self_referral CHECK (referrer_id <> referred_user_id),
  CONSTRAINT referrals_unique_user_type UNIQUE (referred_user_id, referral_type)
);

CREATE INDEX IF NOT EXISTS idx_referrals_referrer_status_created
  ON public.referrals (referrer_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_referrals_hub_status_created
  ON public.referrals (hub_id, status, created_at DESC);

DROP TRIGGER IF EXISTS trg_referrals_updated_at ON public.referrals;
CREATE TRIGGER trg_referrals_updated_at
  BEFORE UPDATE ON public.referrals
  FOR EACH ROW
  EXECUTE FUNCTION public.set_pass_v6a_updated_at();

ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Referrals participants managers and admins can select" ON public.referrals;
CREATE POLICY "Referrals participants managers and admins can select"
  ON public.referrals
  FOR SELECT
  TO authenticated
  USING (
    referrer_id = auth.uid()
    OR referred_user_id = auth.uid()
    OR (hub_id IS NOT NULL AND public.is_hub_manager_for(hub_id))
    OR public.is_super_admin()
  );

DROP POLICY IF EXISTS "Hub managers and super admin can update referrals" ON public.referrals;
CREATE POLICY "Hub managers and super admin can update referrals"
  ON public.referrals
  FOR UPDATE
  TO authenticated
  USING (
    (hub_id IS NOT NULL AND public.is_hub_manager_for(hub_id))
    OR public.is_super_admin()
  )
  WITH CHECK (
    (hub_id IS NOT NULL AND public.is_hub_manager_for(hub_id))
    OR public.is_super_admin()
  );

DROP POLICY IF EXISTS "Super admin full access to referrals" ON public.referrals;
CREATE POLICY "Super admin full access to referrals"
  ON public.referrals
  FOR ALL
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());

-- =============================================================================
-- 3. Partner, Driver & Advertiser Onboarding Applications (`partner_applications`)
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.partner_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_code text UNIQUE NOT NULL,
  applicant_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  hub_id uuid NOT NULL REFERENCES public.service_hubs(id),
  application_type text NOT NULL
    CHECK (application_type IN ('business_owner', 'driver', 'advertiser')),
  status text NOT NULL DEFAULT 'submitted'
    CHECK (status IN ('submitted', 'under_review', 'changes_requested', 'approved', 'rejected')),
  full_name text NOT NULL,
  phone text NOT NULL,
  whatsapp_number text,
  preferred_contact text NOT NULL DEFAULT 'whatsapp'
    CHECK (preferred_contact IN ('whatsapp', 'phone')),
  locality text,
  business_name text,
  business_vertical text,
  vehicle_type text,
  vehicle_reg_no text,
  organization_name text,
  registration_fee_inr numeric(10,2) NOT NULL DEFAULT 0 CHECK (registration_fee_inr >= 0),
  fee_acknowledged boolean NOT NULL DEFAULT false,
  referral_code_used text,
  kyc_documents jsonb NOT NULL DEFAULT '[]'::jsonb,
  applicant_notes text,
  reviewer_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewer_notes text,
  reviewed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_partner_applications_hub_status_created
  ON public.partner_applications (hub_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_partner_applications_applicant_created
  ON public.partner_applications (applicant_id, created_at DESC);

-- Guard non-privileged applicant writes so applicants cannot self-approve or alter reviewer fields
CREATE OR REPLACE FUNCTION public.guard_partner_application_writes()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_service boolean := (current_setting('role', true) = 'service_role');
  v_is_privileged boolean := false;
BEGIN
  NEW.updated_at := now();

  -- Auto-generate clean application_code (`DDA-YYMM-XXXX`) if missing on INSERT
  IF TG_OP = 'INSERT' AND (NEW.application_code IS NULL OR trim(NEW.application_code) = '') THEN
    NEW.application_code := 'DDA-' || to_char(now(), 'YYMM') || '-' ||
      upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 4));
  END IF;

  v_is_privileged :=
    v_is_service
    OR public.is_super_admin()
    OR (NEW.hub_id IS NOT NULL AND public.is_hub_manager_for(NEW.hub_id));

  IF v_is_privileged THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.applicant_id := auth.uid();
    NEW.status := 'submitted';
    NEW.reviewer_id := NULL;
    NEW.reviewer_notes := NULL;
    NEW.reviewed_at := NULL;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.status NOT IN ('submitted', 'changes_requested') THEN
      RAISE EXCEPTION 'Application cannot be modified once it is %.', OLD.status
        USING ERRCODE = '42501';
    END IF;
    -- Preserve reviewer & identity fields; re-submitting after changes_requested returns to submitted
    NEW.applicant_id := OLD.applicant_id;
    NEW.application_code := OLD.application_code;
    NEW.reviewer_id := OLD.reviewer_id;
    NEW.reviewer_notes := OLD.reviewer_notes;
    NEW.reviewed_at := OLD.reviewed_at;
    IF OLD.status = 'changes_requested' THEN
      NEW.status := 'submitted';
    ELSE
      NEW.status := OLD.status;
    END IF;
    RETURN NEW;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_partner_application_writes ON public.partner_applications;
CREATE TRIGGER trg_guard_partner_application_writes
  BEFORE INSERT OR UPDATE ON public.partner_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_partner_application_writes();

ALTER TABLE public.partner_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Partner applications select policy" ON public.partner_applications;
CREATE POLICY "Partner applications select policy"
  ON public.partner_applications
  FOR SELECT
  TO authenticated
  USING (
    applicant_id = auth.uid()
    OR public.is_hub_manager_for(hub_id)
    OR public.is_super_admin()
  );

DROP POLICY IF EXISTS "Applicants can submit partner applications" ON public.partner_applications;
CREATE POLICY "Applicants can submit partner applications"
  ON public.partner_applications
  FOR INSERT
  TO authenticated
  WITH CHECK (
    applicant_id = auth.uid()
    OR public.is_super_admin()
  );

DROP POLICY IF EXISTS "Applicants can update editable partner applications" ON public.partner_applications;
CREATE POLICY "Applicants can update editable partner applications"
  ON public.partner_applications
  FOR UPDATE
  TO authenticated
  USING (
    applicant_id = auth.uid()
    AND status IN ('submitted', 'changes_requested')
  )
  WITH CHECK (
    applicant_id = auth.uid()
    AND status IN ('submitted', 'changes_requested')
  );

DROP POLICY IF EXISTS "Hub managers and super admin can update partner applications" ON public.partner_applications;
CREATE POLICY "Hub managers and super admin can update partner applications"
  ON public.partner_applications
  FOR UPDATE
  TO authenticated
  USING (
    public.is_hub_manager_for(hub_id)
    OR public.is_super_admin()
  )
  WITH CHECK (
    public.is_hub_manager_for(hub_id)
    OR public.is_super_admin()
  );

-- =============================================================================
-- 4. Secure `SECURITY DEFINER` RPCs
-- =============================================================================

-- 4A. ensure_user_referral_code(p_user_id uuid default auth.uid()) returns text
CREATE OR REPLACE FUNCTION public.ensure_user_referral_code(
  p_user_id uuid DEFAULT auth.uid()
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_is_service boolean := (current_setting('role', true) = 'service_role');
  v_target_id uuid := COALESCE(p_user_id, auth.uid());
  v_existing text;
  v_candidate text;
  v_attempt integer := 0;
BEGIN
  IF v_target_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  IF NOT v_is_service
     AND v_caller IS DISTINCT FROM v_target_id
     AND NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Forbidden: You may only access your own referral code.'
      USING ERRCODE = '42501';
  END IF;

  SELECT p.referral_code
    INTO v_existing
  FROM public.profiles p
  WHERE p.id = v_target_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'User profile not found.' USING ERRCODE = 'P0002';
  END IF;

  IF v_existing IS NOT NULL AND trim(v_existing) <> '' THEN
    RETURN v_existing;
  END IF;

  v_candidate := 'DD-' || upper(substr(replace(v_target_id::text, '-', ''), 1, 6));
  WHILE EXISTS (
    SELECT 1
    FROM public.profiles p2
    WHERE p2.referral_code = v_candidate
      AND p2.id <> v_target_id
  ) LOOP
    v_attempt := v_attempt + 1;
    v_candidate := 'DD-' || upper(substr(md5(v_target_id::text || '-' || v_attempt::text || '-' || clock_timestamp()::text), 1, 6));
  END LOOP;

  UPDATE public.profiles
  SET referral_code = v_candidate
  WHERE id = v_target_id;

  RETURN v_candidate;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_user_referral_code(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_user_referral_code(uuid) TO authenticated, service_role;

-- 4B. apply_referral_code(p_code, p_referral_type, p_hub_id) returns jsonb
CREATE OR REPLACE FUNCTION public.apply_referral_code(
  p_code text,
  p_referral_type text DEFAULT 'user_signup',
  p_hub_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_clean_code text := upper(trim(COALESCE(p_code, '')));
  v_clean_type text := lower(trim(COALESCE(p_referral_type, 'user_signup')));
  v_referrer record;
  v_me record;
  v_resolved_hub_id uuid := p_hub_id;
  v_default_credit numeric(10,2) := 50;
  v_referral_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required to apply a referral code.'
      USING ERRCODE = '42501';
  END IF;

  IF v_clean_code = '' OR length(v_clean_code) < 4 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Please enter a valid referral code.');
  END IF;

  IF v_clean_type NOT IN (
    'user_signup',
    'partner_onboarding',
    'driver_onboarding',
    'advertiser_onboarding'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Unsupported referral type.');
  END IF;

  SELECT id, full_name, referral_code
    INTO v_referrer
  FROM public.profiles
  WHERE upper(trim(referral_code)) = v_clean_code
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Referral code not found. Please check and try again.');
  END IF;

  IF v_referrer.id = v_uid THEN
    RETURN jsonb_build_object('ok', false, 'error', 'You cannot use your own referral code.');
  END IF;

  SELECT id, referred_by_user_id, default_hub_id
    INTO v_me
  FROM public.profiles
  WHERE id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'User profile not found.');
  END IF;

  IF v_clean_type = 'user_signup' AND v_me.referred_by_user_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'A signup referral code has already been applied to your account.');
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.referrals r
    WHERE r.referred_user_id = v_uid
      AND r.referral_type = v_clean_type
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'A referral for this activity has already been recorded.');
  END IF;

  IF v_resolved_hub_id IS NULL THEN
    v_resolved_hub_id := v_me.default_hub_id;
  END IF;

  -- Read default referral credit from platform_settings if configured
  SELECT COALESCE(NULLIF((value->>'default_referral_credit_inr')::numeric, NULL), 50)
    INTO v_default_credit
  FROM public.platform_settings
  WHERE key = 'onboarding_and_referrals'
  LIMIT 1;

  IF v_me.referred_by_user_id IS NULL THEN
    UPDATE public.profiles
    SET
      referred_by_user_id = v_referrer.id,
      referral_applied_at = now()
    WHERE id = v_uid;
  END IF;

  INSERT INTO public.referrals (
    referrer_id,
    referred_user_id,
    referral_code_used,
    hub_id,
    referral_type,
    status,
    reward_credit_inr
  )
  VALUES (
    v_referrer.id,
    v_uid,
    v_referrer.referral_code,
    v_resolved_hub_id,
    v_clean_type,
    'pending',
    GREATEST(0, COALESCE(v_default_credit, 50))
  )
  RETURNING id INTO v_referral_id;

  RETURN jsonb_build_object(
    'ok', true,
    'referrer_name', COALESCE(NULLIF(trim(v_referrer.full_name), ''), 'DD oodle Member'),
    'referral_id', v_referral_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_referral_code(text, text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.apply_referral_code(text, text, uuid) TO authenticated, service_role;

-- 4C. review_partner_application(p_application_id, p_new_status, p_reviewer_notes) returns jsonb
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
  v_business_vertical text;
  v_created_listing_id uuid := NULL;
  v_referral_type text;
  v_referrer_id uuid;
  v_kyc_paths text[];
  v_notif_title text;
  v_notif_message text;
  v_notif_url text;
  v_default_credit numeric(10,2) := 50;
BEGIN
  IF p_application_id IS NULL THEN
    RAISE EXCEPTION 'Application ID is required.' USING ERRCODE = '22023';
  END IF;

  IF v_status NOT IN ('submitted', 'under_review', 'changes_requested', 'approved', 'rejected') THEN
    RAISE EXCEPTION 'Invalid application status "%".', p_new_status USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_app
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

  UPDATE public.partner_applications
  SET
    status = v_status,
    reviewer_id = v_caller,
    reviewer_notes = p_reviewer_notes,
    reviewed_at = now(),
    updated_at = now()
  WHERE id = p_application_id;

  -- Extract KYC storage paths from application JSONB
  SELECT COALESCE(array_agg(DISTINCT elem->>'storage_path'), ARRAY[]::text[])
    INTO v_kyc_paths
  FROM jsonb_array_elements(COALESCE(v_app.kyc_documents, '[]'::jsonb)) elem
  WHERE COALESCE(elem->>'storage_path', '') <> '';

  -- When approved, provision operational hat resources & qualify referral
  IF v_status = 'approved' THEN
    -- 1. Driver onboarding -> upsert public.driver_profiles
    IF v_app.application_type = 'driver' THEN
      v_driver_vehicle_type := CASE lower(trim(COALESCE(v_app.vehicle_type, '')))
        WHEN 'two_wheeler' THEN 'two_wheeler'
        WHEN 'bike' THEN 'two_wheeler'
        WHEN 'scooter' THEN 'two_wheeler'
        WHEN 'auto' THEN 'auto'
        WHEN 'auto_rickshaw' THEN 'auto'
        WHEN 'mini_van' THEN 'mini_van'
        WHEN 'pickup' THEN 'mini_van'
        WHEN 'van' THEN 'mini_van'
        WHEN 'car' THEN 'car'
        WHEN 'sedan' THEN 'car'
        WHEN 'suv' THEN 'car'
        ELSE 'two_wheeler'
      END;

      INSERT INTO public.driver_profiles (
        user_id,
        hub_id,
        vehicle_type,
        vehicle_reg_no,
        kyc_status,
        is_active
      )
      VALUES (
        v_app.applicant_id,
        v_app.hub_id,
        v_driver_vehicle_type,
        NULLIF(trim(COALESCE(v_app.vehicle_reg_no, '')), ''),
        'verified',
        true
      )
      ON CONFLICT (user_id) DO UPDATE
      SET
        hub_id = EXCLUDED.hub_id,
        vehicle_type = EXCLUDED.vehicle_type,
        vehicle_reg_no = COALESCE(EXCLUDED.vehicle_reg_no, public.driver_profiles.vehicle_reg_no),
        kyc_status = 'verified',
        is_active = true,
        updated_at = now();
    END IF;

    -- 2. Business Owner onboarding -> create starter listing if none exists with this business name
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

      SELECT l.id
        INTO v_created_listing_id
      FROM public.listings l
      WHERE l.owner_id = v_app.applicant_id
        AND lower(trim(COALESCE(l.title, ''))) = lower(trim(COALESCE(v_app.business_name, v_app.full_name)))
      LIMIT 1;

      IF v_created_listing_id IS NULL THEN
        SELECT center_lat, center_lng
          INTO v_hub
        FROM public.service_hubs
        WHERE id = v_app.hub_id
        LIMIT 1;

        INSERT INTO public.listings (
          owner_id,
          hub_id,
          title,
          category,
          listing_vertical,
          status,
          lifecycle_status,
          locality,
          lat,
          lng,
          owner_name
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

    -- 3. Qualify linked referral when referral_code_used was provided
    IF NULLIF(trim(COALESCE(v_app.referral_code_used, '')), '') IS NOT NULL THEN
      v_referral_type := CASE v_app.application_type
        WHEN 'driver' THEN 'driver_onboarding'
        WHEN 'advertiser' THEN 'advertiser_onboarding'
        ELSE 'partner_onboarding'
      END;

      SELECT p.id
        INTO v_referrer_id
      FROM public.profiles p
      WHERE upper(trim(p.referral_code)) = upper(trim(v_app.referral_code_used))
        AND p.id <> v_app.applicant_id
      LIMIT 1;

      IF v_referrer_id IS NOT NULL THEN
        SELECT COALESCE(NULLIF((value->>'default_referral_credit_inr')::numeric, NULL), 50)
          INTO v_default_credit
        FROM public.platform_settings
        WHERE key = 'onboarding_and_referrals'
        LIMIT 1;

        INSERT INTO public.referrals (
          referrer_id,
          referred_user_id,
          referral_code_used,
          hub_id,
          referral_type,
          status,
          reward_credit_inr,
          reviewed_by,
          qualified_at
        )
        VALUES (
          v_referrer_id,
          v_app.applicant_id,
          upper(trim(v_app.referral_code_used)),
          v_app.hub_id,
          v_referral_type,
          'qualified',
          GREATEST(0, COALESCE(v_default_credit, 50)),
          v_caller,
          now()
        )
        ON CONFLICT (referred_user_id, referral_type) DO UPDATE
        SET
          status = CASE
            WHEN public.referrals.status = 'rewarded' THEN 'rewarded'
            ELSE 'qualified'
          END,
          hub_id = COALESCE(public.referrals.hub_id, EXCLUDED.hub_id),
          reviewed_by = COALESCE(v_caller, public.referrals.reviewed_by),
          qualified_at = COALESCE(public.referrals.qualified_at, now()),
          updated_at = now();
      END IF;
    END IF;
  END IF;

  -- Schedule 30-day ephemeral TTL purge on reviewed KYC media_assets once approved or rejected
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

  -- Insert clickable applicant notification
  IF v_status = 'approved' THEN
    v_notif_title := 'Partner Application Approved';
    v_notif_message := 'Congratulations! Your ' || replace(v_app.application_type, '_', ' ') ||
      ' application (' || v_app.application_code || ') has been approved. Open your Workspace to get started.';
    v_notif_url := '/workspace';
  ELSIF v_status = 'changes_requested' THEN
    v_notif_title := 'Changes Requested on Your Application';
    v_notif_message := 'Your application (' || v_app.application_code || ') needs a quick update' ||
      CASE WHEN NULLIF(trim(COALESCE(p_reviewer_notes, '')), '') IS NOT NULL
        THEN ': ' || trim(p_reviewer_notes)
        ELSE '.'
      END;
    v_notif_url := '/onboarding';
  ELSIF v_status = 'rejected' THEN
    v_notif_title := 'Application Update (' || v_app.application_code || ')';
    v_notif_message := 'Your ' || replace(v_app.application_type, '_', ' ') || ' application was not approved at this time' ||
      CASE WHEN NULLIF(trim(COALESCE(p_reviewer_notes, '')), '') IS NOT NULL
        THEN ': ' || trim(p_reviewer_notes)
        ELSE '.'
      END;
    v_notif_url := '/onboarding';
  ELSE
    v_notif_title := 'Application Under Review';
    v_notif_message := 'Your application (' || v_app.application_code || ') is currently being reviewed by our local hub team.';
    v_notif_url := '/onboarding';
  END IF;

  INSERT INTO public.notifications (
    user_id,
    title,
    message,
    type,
    is_read,
    action_url,
    metadata
  )
  VALUES (
    v_app.applicant_id,
    v_notif_title,
    v_notif_message,
    'system',
    false,
    v_notif_url,
    jsonb_build_object(
      'application_id', p_application_id,
      'application_code', v_app.application_code,
      'status', v_status,
      'action_url', v_notif_url
    )
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
-- 5. Seed Platform Settings Defaults (`onboarding_and_referrals`)
-- =============================================================================
INSERT INTO public.platform_settings (key, value)
VALUES (
  'onboarding_and_referrals',
  '{
    "driver_registration_fee_inr": 199,
    "business_registration_fee_inr": 0,
    "advertiser_registration_fee_inr": 499,
    "registration_fee_note": "One-time manual KYC verification & onboarding fee. Collected only after initial document review.",
    "referrals_enabled": true,
    "referral_reward_summary": "Invite friends, drivers, or local shops to DD oodle and earn referral credit once they qualify.",
    "default_referral_credit_inr": 50
  }'::jsonb
)
ON CONFLICT (key) DO NOTHING;
