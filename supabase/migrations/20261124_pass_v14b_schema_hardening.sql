-- =============================================================================
-- Migration: 20261124_pass_v14b_schema_hardening.sql
-- Pass V14-B: Deferred Schema Hardening (100% Idempotent)
--
-- 1. Unify `public.driver_profiles` and `public.drivers` into ONE canonical
--    table (`public.drivers`), migrating all data, updating `get_user_operational_hats`
--    and `review_partner_application`, and dropping `public.driver_profiles`.
-- 2. Split OTP fields out of `public.vehicle_bookings` into `public.vehicle_booking_otps`
--    with strict RLS explicitly blocking drivers from reading Pickup/Dropoff/Return OTPs,
--    and add `verify_vehicle_booking_otp(...)` SECURITY DEFINER RPC.
-- 3. Provision `avatars` Storage bucket (owner-only upload/update, public read) and
--    harden private `delivery-pods` bucket + 48-hour auto-purge function & pg_cron job.
-- 4. Reconcile all 5 canonical Pick N Drop Fleet Tiers (including `cycle_rickshaw`)
--    in `public.vehicle_types` and `public.hub_vehicle_rates` for Churachandpur.
-- 5. Clean legacy "PrintSwift Local" brand strings in `public.platform_settings`.
-- =============================================================================

-- =============================================================================
-- 1. UNIFY public.driver_profiles INTO CANONICAL public.drivers
-- =============================================================================

ALTER TABLE public.drivers
  ADD COLUMN IF NOT EXISTS hub_id uuid REFERENCES public.service_hubs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS vehicle_type text NOT NULL DEFAULT 'two_wheeler',
  ADD COLUMN IF NOT EXISTS vehicle_reg_no text,
  ADD COLUMN IF NOT EXISTS kyc_status text NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS is_online boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE public.drivers
  ALTER COLUMN license_no SET DEFAULT '',
  ALTER COLUMN license_no DROP NOT NULL;

-- Expand vehicle_type & kyc_status constraints to include all 5+ fleet tiers (including cycle_rickshaw)
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

ALTER TABLE public.drivers
  DROP CONSTRAINT IF EXISTS drivers_kyc_status_check;
ALTER TABLE public.drivers
  ADD CONSTRAINT drivers_kyc_status_check
  CHECK (kyc_status IN ('pending', 'verified', 'suspended'));

-- Sync kyc_status from legacy kyc_verified boolean for existing rows
UPDATE public.drivers
SET kyc_status = 'verified'
WHERE kyc_verified = true
  AND kyc_status = 'pending';

-- Migrate any existing rows from public.driver_profiles into canonical public.drivers
DO $$
BEGIN
  IF to_regclass('public.driver_profiles') IS NOT NULL THEN
    INSERT INTO public.drivers (
      profile_id,
      full_name,
      phone,
      license_no,
      hub_id,
      vehicle_type,
      vehicle_reg_no,
      kyc_status,
      kyc_verified,
      is_online,
      is_active,
      created_at,
      updated_at
    )
    SELECT
      dp.user_id,
      COALESCE(NULLIF(trim(p.full_name), ''), p.email, 'DD oodle Driver'),
      COALESCE(NULLIF(trim(p.phone), ''), '+919862000000'),
      '',
      dp.hub_id,
      CASE
        WHEN dp.vehicle_type IN ('cycle_rickshaw', 'two_wheeler', 'e_rickshaw', 'auto', 'mini_van', 'car', 'pickup_truck')
          THEN dp.vehicle_type
        ELSE 'two_wheeler'
      END,
      dp.vehicle_reg_no,
      dp.kyc_status,
      (dp.kyc_status = 'verified'),
      dp.is_online,
      dp.is_active,
      dp.created_at,
      dp.updated_at
    FROM public.driver_profiles dp
    LEFT JOIN public.profiles p ON p.id = dp.user_id
    ON CONFLICT (profile_id) DO UPDATE
    SET
      hub_id = COALESCE(EXCLUDED.hub_id, public.drivers.hub_id),
      vehicle_type = COALESCE(EXCLUDED.vehicle_type, public.drivers.vehicle_type),
      vehicle_reg_no = COALESCE(EXCLUDED.vehicle_reg_no, public.drivers.vehicle_reg_no),
      kyc_status = CASE
        WHEN public.drivers.kyc_status = 'verified' OR EXCLUDED.kyc_status = 'verified' THEN 'verified'
        ELSE EXCLUDED.kyc_status
      END,
      kyc_verified = (public.drivers.kyc_verified OR EXCLUDED.kyc_verified),
      is_online = COALESCE(EXCLUDED.is_online, public.drivers.is_online),
      is_active = COALESCE(EXCLUDED.is_active, public.drivers.is_active),
      updated_at = now();

    DROP TABLE public.driver_profiles CASCADE;
  END IF;
END;
$$;

CREATE INDEX IF NOT EXISTS idx_drivers_hub_online
  ON public.drivers (hub_id, is_active, is_online);

-- Keep kyc_verified & kyc_status synchronized and guard non-privileged self-updates
CREATE OR REPLACE FUNCTION public.guard_canonical_drivers_writes()
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

  -- Mirror kyc_status <-> kyc_verified
  IF TG_OP = 'INSERT' THEN
    IF NEW.kyc_verified = true AND NEW.kyc_status = 'pending' THEN
      NEW.kyc_status := 'verified';
    ELSIF NEW.kyc_status = 'verified' THEN
      NEW.kyc_verified := true;
    END IF;
  ELSE
    IF NEW.kyc_status IS DISTINCT FROM OLD.kyc_status THEN
      NEW.kyc_verified := (NEW.kyc_status = 'verified');
    ELSIF NEW.kyc_verified IS DISTINCT FROM OLD.kyc_verified THEN
      NEW.kyc_status := CASE WHEN NEW.kyc_verified THEN 'verified' ELSE 'pending' END;
    END IF;
  END IF;

  v_is_privileged :=
    v_is_service
    OR public.is_super_admin(auth.uid())
    OR public.is_pnd_mediator(auth.uid())
    OR (NEW.hub_id IS NOT NULL AND public.is_hub_manager_for(NEW.hub_id));

  IF v_is_privileged THEN
    RETURN NEW;
  END IF;

  -- Non-privileged drivers may only toggle their own online availability
  IF TG_OP = 'UPDATE' AND OLD.profile_id = auth.uid() THEN
    NEW.profile_id := OLD.profile_id;
    NEW.hub_id := OLD.hub_id;
    NEW.kyc_status := OLD.kyc_status;
    NEW.kyc_verified := OLD.kyc_verified;
    NEW.is_active := OLD.is_active;
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Forbidden: Only Hub Managers or Admins may manage driver records.'
    USING ERRCODE = '42501';
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_canonical_drivers_writes ON public.drivers;
CREATE TRIGGER trg_guard_canonical_drivers_writes
  BEFORE INSERT OR UPDATE ON public.drivers
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_canonical_drivers_writes();

-- Allow drivers to toggle their own is_online status via RLS (trigger protects privileged fields)
DROP POLICY IF EXISTS "drivers_self_update_online" ON public.drivers;
CREATE POLICY "drivers_self_update_online"
  ON public.drivers
  FOR UPDATE
  TO authenticated
  USING (profile_id = auth.uid())
  WITH CHECK (profile_id = auth.uid());

-- Update get_user_operational_hats to read from canonical public.drivers
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
GRANT EXECUTE ON FUNCTION public.get_user_operational_hats(uuid) TO authenticated, service_role;

-- Update review_partner_application to upsert canonical public.drivers (supporting cycle_rickshaw & all 5 tiers)
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

  SELECT COALESCE(array_agg(DISTINCT elem->>'storage_path'), ARRAY[]::text[])
    INTO v_kyc_paths
  FROM jsonb_array_elements(COALESCE(v_app.kyc_documents, '[]'::jsonb)) elem
  WHERE COALESCE(elem->>'storage_path', '') <> '';

  IF v_status = 'approved' THEN
    -- 1. Driver onboarding -> upsert canonical public.drivers
    IF v_app.application_type = 'driver' THEN
      v_driver_vehicle_type := CASE lower(trim(COALESCE(v_app.vehicle_type, '')))
        WHEN 'cycle_rickshaw' THEN 'cycle_rickshaw'
        WHEN 'rickshaw' THEN 'cycle_rickshaw'
        WHEN 'two_wheeler' THEN 'two_wheeler'
        WHEN 'bike' THEN 'two_wheeler'
        WHEN 'scooter' THEN 'two_wheeler'
        WHEN 'scooty' THEN 'two_wheeler'
        WHEN 'e_rickshaw' THEN 'e_rickshaw'
        WHEN 'auto' THEN 'auto'
        WHEN 'auto_rickshaw' THEN 'auto'
        WHEN 'mini_van' THEN 'mini_van'
        WHEN 'van' THEN 'mini_van'
        WHEN 'pickup' THEN 'pickup_truck'
        WHEN 'pickup_truck' THEN 'pickup_truck'
        WHEN 'bolero' THEN 'pickup_truck'
        WHEN 'car' THEN 'car'
        WHEN 'sedan' THEN 'car'
        WHEN 'suv' THEN 'car'
        ELSE 'two_wheeler'
      END;

      INSERT INTO public.drivers (
        profile_id,
        full_name,
        phone,
        license_no,
        hub_id,
        vehicle_type,
        vehicle_reg_no,
        kyc_status,
        kyc_verified,
        is_active
      )
      VALUES (
        v_app.applicant_id,
        COALESCE(NULLIF(trim(v_app.full_name), ''), 'DD oodle Driver'),
        COALESCE(NULLIF(trim(v_app.phone), ''), '+919862000000'),
        COALESCE(NULLIF(trim(v_app.vehicle_reg_no), ''), ''),
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
        hub_id = EXCLUDED.hub_id,
        vehicle_type = EXCLUDED.vehicle_type,
        vehicle_reg_no = COALESCE(EXCLUDED.vehicle_reg_no, public.drivers.vehicle_reg_no),
        kyc_status = 'verified',
        kyc_verified = true,
        is_active = true,
        updated_at = now();
    END IF;

    -- 2. Business Owner onboarding -> create starter listing if none exists
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
    user_id, title, message, type, is_read, action_url, metadata
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
-- 2. SPLIT VEHICLE BOOKING OTPs INTO public.vehicle_booking_otps + STRICT RLS
-- =============================================================================

CREATE TABLE IF NOT EXISTS public.vehicle_booking_otps (
  booking_id uuid PRIMARY KEY REFERENCES public.vehicle_bookings(id) ON DELETE CASCADE,
  pickup_otp text NOT NULL,
  dropoff_otp text NOT NULL,
  return_otp text,
  failed_attempts integer NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
  locked_until timestamptz,
  pickup_verified_at timestamptz,
  dropoff_verified_at timestamptz,
  return_verified_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Migrate legacy inline start_otp / end_otp from vehicle_bookings and drop inline columns
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'vehicle_bookings'
      AND column_name = 'start_otp'
  ) THEN
    INSERT INTO public.vehicle_booking_otps (booking_id, pickup_otp, dropoff_otp)
    SELECT
      vb.id,
      COALESCE(NULLIF(trim(vb.start_otp), ''), public.generate_6digit_otp()),
      COALESCE(NULLIF(trim(vb.end_otp), ''), public.generate_6digit_otp())
    FROM public.vehicle_bookings vb
    ON CONFLICT (booking_id) DO NOTHING;

    ALTER TABLE public.vehicle_bookings
      DROP COLUMN IF EXISTS start_otp,
      DROP COLUMN IF EXISTS end_otp;
  END IF;
END;
$$;

ALTER TABLE public.vehicle_booking_otps ENABLE ROW LEVEL SECURITY;

-- CRITICAL RLS: Drivers and vehicle operators have ZERO SELECT access to Pickup/Dropoff/Return OTPs.
-- Only the booking customer or an authorized Hub Mediator / Admin / Super-Admin may read OTPs.
DROP POLICY IF EXISTS "vehicle_booking_otps_customer_mediator_select" ON public.vehicle_booking_otps;
CREATE POLICY "vehicle_booking_otps_customer_mediator_select"
  ON public.vehicle_booking_otps
  FOR SELECT
  TO authenticated
  USING (
    (
      public.is_pnd_mediator(auth.uid())
      OR EXISTS (
        SELECT 1
        FROM public.vehicle_bookings vb
        WHERE vb.id = vehicle_booking_otps.booking_id
          AND vb.customer_id = auth.uid()
      )
    )
    AND NOT EXISTS (
      SELECT 1
      FROM public.vehicle_bookings vb
      JOIN public.vehicle_listings vl ON vl.id = vb.vehicle_listing_id
      LEFT JOIN public.drivers d ON d.id = vl.driver_id
      WHERE vb.id = vehicle_booking_otps.booking_id
        AND vb.customer_id <> auth.uid()
        AND NOT public.is_pnd_mediator(auth.uid())
        AND (d.profile_id = auth.uid() OR vl.owner_id = auth.uid())
    )
  );

-- Block all direct client-side INSERT / UPDATE / DELETE on vehicle_booking_otps (RPC-only)
DROP POLICY IF EXISTS "vehicle_booking_otps_block_client_insert" ON public.vehicle_booking_otps;
CREATE POLICY "vehicle_booking_otps_block_client_insert"
  ON public.vehicle_booking_otps
  FOR INSERT
  TO authenticated
  WITH CHECK (false);

DROP POLICY IF EXISTS "vehicle_booking_otps_block_client_update" ON public.vehicle_booking_otps;
CREATE POLICY "vehicle_booking_otps_block_client_update"
  ON public.vehicle_booking_otps
  FOR UPDATE
  TO authenticated
  USING (false)
  WITH CHECK (false);

DROP POLICY IF EXISTS "vehicle_booking_otps_block_client_delete" ON public.vehicle_booking_otps;
CREATE POLICY "vehicle_booking_otps_block_client_delete"
  ON public.vehicle_booking_otps
  FOR DELETE
  TO authenticated
  USING (false);

-- Update create_vehicle_booking_with_intent to store OTPs in vehicle_booking_otps
CREATE OR REPLACE FUNCTION public.create_vehicle_booking_with_intent(
  p_vehicle_listing_id uuid,
  p_booking_mode text,
  p_seats_booked integer,
  p_start_time timestamptz,
  p_end_time timestamptz,
  p_pickup_location text,
  p_dropoff_location text DEFAULT NULL,
  p_instructions text DEFAULT NULL,
  p_fixed_route_fare_inr numeric DEFAULT NULL
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
BEGIN
  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'Authentication required to reserve a vehicle.' USING ERRCODE = '42501';
  END IF;

  IF p_end_time <= p_start_time THEN
    RAISE EXCEPTION 'End time must be after start time.' USING ERRCODE = '22023';
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

  -- Fare calculation
  v_hours := GREATEST(1, CEIL(EXTRACT(EPOCH FROM (p_end_time - p_start_time)) / 3600.0));
  v_days := GREATEST(1, CEIL(v_hours / 24.0));

  IF p_fixed_route_fare_inr IS NOT NULL AND p_fixed_route_fare_inr > 0 THEN
    v_total_fare := ROUND(
      CASE WHEN p_booking_mode = 'per_seat' THEN p_fixed_route_fare_inr * v_effective_seats ELSE p_fixed_route_fare_inr END,
      2
    );
  ELSIF v_listing.pricing_model = 'hourly' AND v_listing.rate_hourly_inr IS NOT NULL THEN
    v_total_fare := ROUND(v_listing.rate_hourly_inr * v_hours, 2);
  ELSIF v_listing.rate_daily_inr IS NOT NULL THEN
    v_total_fare := ROUND(v_listing.rate_daily_inr * v_days, 2);
  ELSE
    v_total_fare := ROUND(COALESCE(v_listing.rate_hourly_inr, 500) * v_hours, 2);
  END IF;

  v_advance_amount := ROUND(v_total_fare * (COALESCE(v_listing.advance_percent, 25) / 100.0));
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
    hold_expires_at
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
    v_hold_until
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
    expires_at
  )
  VALUES (
    v_intent_code,
    v_customer_id,
    'vehicle_booking',
    v_booking.id,
    v_advance_amount,
    'manual_upi',
    'awaiting_payment',
    v_hold_until
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

GRANT EXECUTE ON FUNCTION public.create_vehicle_booking_with_intent(
  uuid, text, integer, timestamptz, timestamptz, text, text, text, numeric
) TO authenticated;

-- Strict SECURITY DEFINER RPC for Driver/Owner/Mediator OTP verification (drivers NEVER read OTPs)
CREATE OR REPLACE FUNCTION public.verify_vehicle_booking_otp(
  p_booking_id uuid,
  p_stage text,
  p_otp text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller uuid := auth.uid();
  v_stage text := lower(trim(COALESCE(p_stage, '')));
  v_clean_otp text := regexp_replace(COALESCE(p_otp, ''), '[^0-9]', '', 'g');
  v_booking public.vehicle_bookings%ROWTYPE;
  v_listing public.vehicle_listings%ROWTYPE;
  v_secret public.vehicle_booking_otps%ROWTYPE;
  v_is_assigned_driver boolean := false;
  v_expected text;
  v_next_status text;
  v_new_attempts integer;
BEGIN
  IF v_caller IS NULL THEN
    RAISE EXCEPTION 'Authentication required to verify booking OTP.' USING ERRCODE = '42501';
  END IF;

  IF length(v_clean_otp) <> 6 THEN
    RAISE EXCEPTION 'A valid 6-digit OTP is required.' USING ERRCODE = '22023';
  END IF;

  IF v_stage NOT IN ('pickup', 'start', 'dropoff', 'end', 'return') THEN
    RAISE EXCEPTION 'Invalid OTP stage "%".', p_stage USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_booking
  FROM public.vehicle_bookings
  WHERE id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Vehicle booking not found.' USING ERRCODE = 'P0002';
  END IF;

  SELECT * INTO v_listing
  FROM public.vehicle_listings
  WHERE id = v_booking.vehicle_listing_id;

  IF v_listing.driver_id IS NOT NULL THEN
    SELECT EXISTS (
      SELECT 1 FROM public.drivers d
      WHERE d.id = v_listing.driver_id
        AND d.profile_id = v_caller
        AND d.is_active = true
    ) INTO v_is_assigned_driver;
  END IF;

  IF NOT (
    v_is_assigned_driver
    OR v_listing.owner_id = v_caller
    OR public.is_pnd_mediator(v_caller)
  ) THEN
    RAISE EXCEPTION 'Forbidden: Only the assigned driver, vehicle owner, or hub mediator may verify booking OTPs.'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_secret
  FROM public.vehicle_booking_otps
  WHERE booking_id = p_booking_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'OTP record not found for this booking.' USING ERRCODE = 'P0002';
  END IF;

  IF v_secret.locked_until IS NOT NULL AND v_secret.locked_until > now() THEN
    RAISE EXCEPTION 'Too many failed OTP attempts. Please retry after %.', to_char(v_secret.locked_until, 'HH24:MI TZ')
      USING ERRCODE = 'P0001';
  END IF;

  IF v_stage IN ('pickup', 'start') THEN
    v_expected := v_secret.pickup_otp;
    v_next_status := 'in_progress';
  ELSIF v_stage IN ('dropoff', 'end') THEN
    v_expected := v_secret.dropoff_otp;
    v_next_status := 'completed';
  ELSE
    v_expected := v_secret.return_otp;
    v_next_status := 'completed';
  END IF;

  IF v_expected IS NULL OR v_clean_otp <> v_expected THEN
    v_new_attempts := v_secret.failed_attempts + 1;
    UPDATE public.vehicle_booking_otps
    SET
      failed_attempts = v_new_attempts,
      locked_until = CASE WHEN v_new_attempts >= 5 THEN now() + interval '15 minutes' ELSE NULL END,
      updated_at = now()
    WHERE booking_id = p_booking_id;

    RAISE EXCEPTION 'Incorrect % OTP for booking %.', v_stage, v_booking.booking_code
      USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.vehicle_booking_otps
  SET
    failed_attempts = 0,
    locked_until = NULL,
    pickup_verified_at = CASE WHEN v_stage IN ('pickup', 'start') THEN now() ELSE pickup_verified_at END,
    dropoff_verified_at = CASE WHEN v_stage IN ('dropoff', 'end') THEN now() ELSE dropoff_verified_at END,
    return_verified_at = CASE WHEN v_stage = 'return' THEN now() ELSE return_verified_at END,
    updated_at = now()
  WHERE booking_id = p_booking_id;

  UPDATE public.vehicle_bookings
  SET
    status = v_next_status,
    updated_at = now()
  WHERE id = p_booking_id
  RETURNING * INTO v_booking;

  RETURN jsonb_build_object(
    'ok', true,
    'booking_id', v_booking.id,
    'booking_code', v_booking.booking_code,
    'stage', v_stage,
    'status', v_booking.status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.verify_vehicle_booking_otp(uuid, text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_vehicle_booking_otp(uuid, text, text) TO authenticated, service_role;

-- =============================================================================
-- 3. STORAGE BUCKETS: `avatars` (PUBLIC READ, OWNER UPLOAD/UPDATE) & `delivery-pods` (PRIVATE + 48H PURGE)
-- =============================================================================

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'avatars',
  'avatars',
  true,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET
  public = true,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

DROP POLICY IF EXISTS "avatars_public_read" ON storage.objects;
CREATE POLICY "avatars_public_read"
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'avatars');

DROP POLICY IF EXISTS "avatars_owner_insert" ON storage.objects;
CREATE POLICY "avatars_owner_insert"
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'avatars'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR (storage.foldername(name))[2] = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS "avatars_owner_update" ON storage.objects;
CREATE POLICY "avatars_owner_update"
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR (storage.foldername(name))[2] = auth.uid()::text
    )
  )
  WITH CHECK (
    bucket_id = 'avatars'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR (storage.foldername(name))[2] = auth.uid()::text
    )
  );

DROP POLICY IF EXISTS "avatars_owner_delete" ON storage.objects;
CREATE POLICY "avatars_owner_delete"
  ON storage.objects
  FOR DELETE
  TO authenticated
  USING (
    bucket_id = 'avatars'
    AND (
      (storage.foldername(name))[1] = auth.uid()::text
      OR (storage.foldername(name))[2] = auth.uid()::text
      OR public.is_pnd_admin(auth.uid())
    )
  );

-- Confirm private Proof-of-Delivery (`delivery-pods`) bucket & 48-hour auto-purge function/cron
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'delivery-pods',
  'delivery-pods',
  false,
  5242880,
  ARRAY['image/jpeg', 'image/png', 'image/webp']
)
ON CONFLICT (id) DO UPDATE
SET
  public = false,
  file_size_limit = 5242880,
  allowed_mime_types = ARRAY['image/jpeg', 'image/png', 'image/webp'];

CREATE OR REPLACE FUNCTION public.purge_expired_delivery_pods()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, storage
AS $$
DECLARE
  v_paths text[];
  v_purged_count integer := 0;
BEGIN
  SELECT COALESCE(array_agg(pod_storage_path), ARRAY[]::text[])
    INTO v_paths
  FROM public.delivery_orders
  WHERE pod_storage_path IS NOT NULL
    AND pod_purge_at IS NOT NULL
    AND pod_purge_at <= now();

  IF array_length(v_paths, 1) IS NOT NULL THEN
    DELETE FROM storage.objects
    WHERE bucket_id = 'delivery-pods'
      AND name = ANY(v_paths);

    UPDATE public.delivery_orders
    SET
      pod_storage_path = NULL,
      updated_at = now()
    WHERE pod_storage_path = ANY(v_paths);

    GET DIAGNOSTICS v_purged_count = ROW_COUNT;
  END IF;

  RETURN v_purged_count;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_expired_delivery_pods() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.purge_expired_delivery_pods() TO service_role;

-- Schedule 48-hour POD purge cron job every 6 hours if pg_cron extension is enabled
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    IF NOT EXISTS (
      SELECT 1 FROM cron.job WHERE jobname = 'ddoodle_purge_expired_delivery_pods_48h'
    ) THEN
      PERFORM cron.schedule(
        'ddoodle_purge_expired_delivery_pods_48h',
        '0 */6 * * *',
        'SELECT public.purge_expired_delivery_pods();'
      );
    END IF;
  END IF;
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'pg_cron scheduling skipped (%): rely on /api/pick-n-drop/purge-pods cron trigger.', SQLERRM;
END;
$$;

-- =============================================================================
-- 4. RECONCILE ALL 5 CANONICAL FLEET TIERS (INCLUDING CYCLE RICKSHAW)
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
  base_fare_inr = EXCLUDED.base_fare_inr,
  per_km_rate_inr = EXCLUDED.per_km_rate_inr,
  wait_per_10min_inr = EXCLUDED.wait_per_10min_inr,
  free_wait_minutes = EXCLUDED.free_wait_minutes,
  two_way_multiplier = EXCLUDED.two_way_multiplier,
  max_weight_kg = EXCLUDED.max_weight_kg,
  max_dimensions = EXCLUDED.max_dimensions,
  supported_modes = EXCLUDED.supported_modes,
  is_active = true;

-- Ensure Churachandpur hub has all 5 vehicle types enabled in hub_vehicle_rates
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
JOIN public.vehicle_types vt ON vt.is_active = true
WHERE sh.slug = 'churachandpur'
ON CONFLICT (hub_id, vehicle_type_id) DO UPDATE
SET
  is_enabled_in_hub = true,
  base_fare_inr = EXCLUDED.base_fare_inr,
  per_km_rate_inr = EXCLUDED.per_km_rate_inr,
  updated_at = now();

-- =============================================================================
-- 5. CLEAN LEGACY "PrintSwift Local" BRAND STRINGS IN platform_settings
-- =============================================================================

UPDATE public.platform_settings
SET value = jsonb_set(
  jsonb_set(value, '{app_name}', '"DD oodle"', true),
  '{short_name}', '"DD oodle"', true
)
WHERE key = 'brand_identity'
  AND (
    COALESCE(value->>'app_name', '') ILIKE '%printswift%'
    OR COALESCE(value->>'short_name', '') ILIKE '%printswift%'
  );

UPDATE public.platform_settings
SET value = jsonb_set(value, '{upi_payee_name}', '"DD oodle"', true)
WHERE key = 'payment_config'
  AND COALESCE(value->>'upi_payee_name', '') ILIKE '%printswift%';
