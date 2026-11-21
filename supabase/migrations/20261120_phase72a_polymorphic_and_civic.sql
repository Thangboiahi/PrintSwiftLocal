-- =============================================================================
-- Migration: 20261120_phase72a_polymorphic_and_civic.sql
-- Phase 72-A: Polymorphic Listing Core (`listing_vertical`, `vertical_summary`,
--             `is_civic_record`), Public & Government Services (`public_civic`)
--             Tables (`listing_civic_profiles`, `civic_correction_reports`),
--             Strict Civic Governance RLS & Mutation Guards, Curated Taxonomy,
--             and 4 Idempotent Sample Civic Records (Churachandpur & Aizawl)
-- =============================================================================
-- STRICT IDEMPOTENCY GUARANTEE:
--   Every table, column, index, constraint, function, trigger, policy, and
--   seed INSERT is 100% idempotent and safe to re-run in Supabase SQL Editor.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Ensure Core Updated-At & RBAC Helpers Exist
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_phase72a_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    WHERE p.id = auth.uid()
      AND p.role = 'super_admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_hub_manager_for(p_hub_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    public.is_super_admin()
    OR (
      p_hub_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.hub_managers hm
        WHERE hm.profile_id = auth.uid()
          AND hm.hub_id = p_hub_id
          AND hm.is_active = true
      )
    );
$$;

-- =============================================================================
-- A. Polymorphic Columns on public.listings
-- =============================================================================
ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS listing_vertical text NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS vertical_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS is_civic_record boolean NOT NULL DEFAULT false;

-- Safe idempotent CHECK constraint on public.listings.listing_vertical
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'listings_listing_vertical_check'
      AND conrelid = 'public.listings'::regclass
  ) THEN
    ALTER TABLE public.listings
      DROP CONSTRAINT listings_listing_vertical_check;
  END IF;

  ALTER TABLE public.listings
    ADD CONSTRAINT listings_listing_vertical_check
    CHECK (
      listing_vertical IN (
        'general',
        'print_digital',
        'booking_venue',
        'shop_catalogue',
        'real_estate',
        'restaurant_food',
        'hotel_stay',
        'public_civic'
      )
    );
END;
$$;

CREATE INDEX IF NOT EXISTS idx_listings_hub_vertical_status
  ON public.listings (hub_id, listing_vertical, status);

-- -----------------------------------------------------------------------------
-- A1. Idempotent Backfill for Existing Listings
-- -----------------------------------------------------------------------------
DO $$
BEGIN
  -- Print & Digital listings (via listing_print_profiles or subcategory hint)
  IF to_regclass('public.listing_print_profiles') IS NOT NULL THEN
    UPDATE public.listings l
    SET listing_vertical = 'print_digital'
    WHERE l.listing_vertical = 'general'
      AND (
        l.id IN (SELECT listing_id FROM public.listing_print_profiles)
        OR COALESCE(l.subcategory, '') ILIKE '%print%'
      );

    -- Populate vertical_summary cache for all existing listing_print_profiles
    UPDATE public.listings l
    SET
      listing_vertical = 'print_digital',
      vertical_summary = jsonb_build_object(
        'is_first_party_printswift', lpp.is_first_party_printswift,
        'is_accepting_orders', lpp.is_accepting_orders,
        'turnaround_badge', lpp.turnaround_badge,
        'verified_capabilities', COALESCE(lpp.verified_capabilities, '{}'::jsonb)
      )
    FROM public.listing_print_profiles lpp
    WHERE lpp.listing_id = l.id;
  ELSE
    UPDATE public.listings l
    SET listing_vertical = 'print_digital'
    WHERE l.listing_vertical = 'general'
      AND COALESCE(l.subcategory, '') ILIKE '%print%';
  END IF;

  -- Real Estate listings
  UPDATE public.listings l
  SET listing_vertical = 'real_estate'
  WHERE l.listing_vertical = 'general'
    AND lower(COALESCE(l.category, '')) = 'real_estate';
END;
$$;

-- -----------------------------------------------------------------------------
-- A2. Auto-Sync Trigger: public.listing_print_profiles -> public.listings.vertical_summary
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_print_profile_to_listing_summary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.listings
  SET
    listing_vertical = 'print_digital',
    vertical_summary = jsonb_build_object(
      'is_first_party_printswift', NEW.is_first_party_printswift,
      'is_accepting_orders', NEW.is_accepting_orders,
      'turnaround_badge', NEW.turnaround_badge,
      'verified_capabilities', COALESCE(NEW.verified_capabilities, '{}'::jsonb)
    )
  WHERE id = NEW.listing_id;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  IF to_regclass('public.listing_print_profiles') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_sync_print_profile_to_listing_summary
      ON public.listing_print_profiles;

    CREATE TRIGGER trg_sync_print_profile_to_listing_summary
      AFTER INSERT OR UPDATE OF
        is_first_party_printswift,
        is_accepting_orders,
        turnaround_badge,
        verified_capabilities
      ON public.listing_print_profiles
      FOR EACH ROW
      EXECUTE FUNCTION public.sync_print_profile_to_listing_summary();
  END IF;
END;
$$;

-- =============================================================================
-- B. Two New Civic Tables
-- =============================================================================

-- -----------------------------------------------------------------------------
-- B1. public.listing_civic_profiles (1-to-1 extension for public_civic listings)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.listing_civic_profiles (
  listing_id uuid PRIMARY KEY REFERENCES public.listings(id) ON DELETE CASCADE,
  hub_id uuid NOT NULL REFERENCES public.service_hubs(id) ON DELETE CASCADE,
  department_type text NOT NULL DEFAULT 'government_office'
    CHECK (
      department_type IN (
        'emergency_medical',
        'police_fire',
        'government_office',
        'utility_power_water',
        'public_transport_hub',
        'community_religious',
        'education_public'
      )
    ),
  is_24x7 boolean NOT NULL DEFAULT false,
  office_hours_text text,
  helplines jsonb NOT NULL DEFAULT '[]'::jsonb,
  document_checklists jsonb NOT NULL DEFAULT '[]'::jsonb,
  important_notes text,
  live_civic_alert text,
  live_civic_alert_expires_at timestamptz,
  official_website text,
  show_nearby_print_helper boolean NOT NULL DEFAULT true,
  last_verified_at timestamptz DEFAULT now(),
  last_verified_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listing_civic_profiles_hub_dept
  ON public.listing_civic_profiles (hub_id, department_type);

CREATE INDEX IF NOT EXISTS idx_listing_civic_profiles_hub_24x7
  ON public.listing_civic_profiles (hub_id, is_24x7)
  WHERE is_24x7 = true;

-- -----------------------------------------------------------------------------
-- B2. public.civic_correction_reports (Crowdsourced Accuracy Loop)
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.civic_correction_reports (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id uuid NOT NULL REFERENCES public.service_hubs(id) ON DELETE CASCADE,
  listing_id uuid NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  reporter_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reporter_contact text,
  issue_type text NOT NULL
    CHECK (
      issue_type IN (
        'wrong_phone',
        'wrong_hours',
        'wrong_location',
        'outdated_checklist',
        'closed_relocated',
        'other'
      )
    ),
  suggested_correction text NOT NULL,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  reviewer_note text,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_civic_correction_reports_hub_status_created
  ON public.civic_correction_reports (hub_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_civic_correction_reports_listing
  ON public.civic_correction_reports (listing_id, created_at DESC);

-- =============================================================================
-- C. Strict Civic Governance Helper, Auto-Sync Triggers & RLS Policies
-- =============================================================================

-- -----------------------------------------------------------------------------
-- C1. SECURITY DEFINER Helper: can_manage_civic_hub(p_hub_id uuid)
--     Strictly returns false for regular customers, listing owners, & drivers.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_manage_civic_hub(p_hub_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    auth.uid() IS NOT NULL
    AND (
      public.is_super_admin()
      OR (p_hub_id IS NOT NULL AND public.is_hub_manager_for(p_hub_id))
      OR EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.role = 'admin'
      )
      OR (
        p_hub_id IS NOT NULL
        AND EXISTS (
          SELECT 1
          FROM public.staff_delegations sd
          JOIN public.listings l ON l.id = sd.listing_id
          WHERE sd.staff_id = auth.uid()
            AND COALESCE(sd.status, 'active') = 'active'
            AND l.hub_id = p_hub_id
            AND l.is_civic_record = true
            AND (
              (jsonb_typeof(sd.permissions) = 'array' AND sd.permissions ? 'manage_civic')
              OR (
                jsonb_typeof(sd.permissions) = 'object'
                AND COALESCE((sd.permissions ->> 'manage_civic')::boolean, false) = true
              )
            )
        )
      )
    );
$$;

GRANT EXECUTE ON FUNCTION public.can_manage_civic_hub(uuid) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- C2. Auto-Sync Triggers on public.listing_civic_profiles
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.before_upsert_listing_civic_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_listing_hub_id uuid;
  v_default_hub_id uuid;
BEGIN
  SELECT l.hub_id
    INTO v_listing_hub_id
  FROM public.listings l
  WHERE l.id = NEW.listing_id;

  IF v_listing_hub_id IS NULL THEN
    SELECT h.id
      INTO v_default_hub_id
    FROM public.service_hubs h
    WHERE h.is_default = true
    LIMIT 1;
    NEW.hub_id := COALESCE(NEW.hub_id, v_default_hub_id);
  ELSE
    NEW.hub_id := v_listing_hub_id;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_before_upsert_listing_civic_profile
  ON public.listing_civic_profiles;
CREATE TRIGGER trg_before_upsert_listing_civic_profile
  BEFORE INSERT OR UPDATE ON public.listing_civic_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.before_upsert_listing_civic_profile();

CREATE OR REPLACE FUNCTION public.sync_civic_profile_to_listing_summary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_helplines jsonb := CASE
    WHEN jsonb_typeof(NEW.helplines) = 'array' THEN NEW.helplines
    ELSE '[]'::jsonb
  END;
  v_checklists jsonb := CASE
    WHEN jsonb_typeof(NEW.document_checklists) = 'array' THEN NEW.document_checklists
    ELSE '[]'::jsonb
  END;
  v_primary_phone text;
  v_helpline_count integer := jsonb_array_length(v_helplines);
  v_checklist_count integer := jsonb_array_length(v_checklists);
  v_has_active_alert boolean := (
    NULLIF(trim(COALESCE(NEW.live_civic_alert, '')), '') IS NOT NULL
    AND (
      NEW.live_civic_alert_expires_at IS NULL
      OR NEW.live_civic_alert_expires_at > now()
    )
  );
BEGIN
  -- Prefer first emergency helpline phone, otherwise first helpline phone
  SELECT elem ->> 'phone'
    INTO v_primary_phone
  FROM jsonb_array_elements(v_helplines) AS elem
  WHERE COALESCE((elem ->> 'is_emergency')::boolean, false) = true
    AND NULLIF(trim(COALESCE(elem ->> 'phone', '')), '') IS NOT NULL
  LIMIT 1;

  IF v_primary_phone IS NULL AND v_helpline_count > 0 THEN
    v_primary_phone := NULLIF(trim(COALESCE(v_helplines -> 0 ->> 'phone', '')), '');
  END IF;

  UPDATE public.listings
  SET
    listing_vertical = 'public_civic',
    is_civic_record = true,
    vertical_summary = jsonb_build_object(
      'department_type', NEW.department_type,
      'is_24x7', NEW.is_24x7,
      'primary_phone', COALESCE(v_primary_phone, contact_phone, phone),
      'helpline_count', v_helpline_count,
      'checklist_count', v_checklist_count,
      'has_active_alert', v_has_active_alert
    )
  WHERE id = NEW.listing_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_civic_profile_to_listing_summary
  ON public.listing_civic_profiles;
CREATE TRIGGER trg_sync_civic_profile_to_listing_summary
  AFTER INSERT OR UPDATE ON public.listing_civic_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_civic_profile_to_listing_summary();

-- -----------------------------------------------------------------------------
-- C3. Civic Mutation Protection Trigger on public.listings
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.guard_civic_listings_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_service boolean := (current_setting('role', true) = 'service_role');
BEGIN
  -- Skip guard for SQL Editor migrations (auth.uid() IS NULL) and service_role
  IF auth.uid() IS NULL OR v_is_service THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    IF OLD.is_civic_record = true OR OLD.listing_vertical = 'public_civic' THEN
      IF NOT public.can_manage_civic_hub(OLD.hub_id) THEN
        RAISE EXCEPTION 'Public and government listings can only be modified by authorized hub managers or administrators'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    IF NEW.is_civic_record = true OR NEW.listing_vertical = 'public_civic' THEN
      IF NOT public.can_manage_civic_hub(NEW.hub_id) THEN
        RAISE EXCEPTION 'Public and government listings can only be modified by authorized hub managers or administrators'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_civic_listings_mutation ON public.listings;
CREATE TRIGGER trg_guard_civic_listings_mutation
  BEFORE INSERT OR UPDATE OR DELETE ON public.listings
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_civic_listings_mutation();

-- -----------------------------------------------------------------------------
-- C4. RLS Policies: public.listing_civic_profiles
-- -----------------------------------------------------------------------------
ALTER TABLE public.listing_civic_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Civic profiles readable by everyone"
  ON public.listing_civic_profiles;
CREATE POLICY "Civic profiles readable by everyone"
  ON public.listing_civic_profiles
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Civic profiles insertable by civic hub managers"
  ON public.listing_civic_profiles;
CREATE POLICY "Civic profiles insertable by civic hub managers"
  ON public.listing_civic_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (public.can_manage_civic_hub(hub_id));

DROP POLICY IF EXISTS "Civic profiles updatable by civic hub managers"
  ON public.listing_civic_profiles;
CREATE POLICY "Civic profiles updatable by civic hub managers"
  ON public.listing_civic_profiles
  FOR UPDATE
  TO authenticated
  USING (public.can_manage_civic_hub(hub_id))
  WITH CHECK (public.can_manage_civic_hub(hub_id));

DROP POLICY IF EXISTS "Civic profiles deletable by civic hub managers"
  ON public.listing_civic_profiles;
CREATE POLICY "Civic profiles deletable by civic hub managers"
  ON public.listing_civic_profiles
  FOR DELETE
  TO authenticated
  USING (public.can_manage_civic_hub(hub_id));

-- -----------------------------------------------------------------------------
-- C5. RLS Policies: public.civic_correction_reports
-- -----------------------------------------------------------------------------
ALTER TABLE public.civic_correction_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Authenticated users can submit civic correction reports"
  ON public.civic_correction_reports;
CREATE POLICY "Authenticated users can submit civic correction reports"
  ON public.civic_correction_reports
  FOR INSERT
  TO authenticated
  WITH CHECK (
    reporter_id IS NULL OR reporter_id = auth.uid()
  );

DROP POLICY IF EXISTS "Users can view their own civic correction reports"
  ON public.civic_correction_reports;
CREATE POLICY "Users can view their own civic correction reports"
  ON public.civic_correction_reports
  FOR SELECT
  TO authenticated
  USING (reporter_id = auth.uid());

DROP POLICY IF EXISTS "Civic managers can view hub correction reports"
  ON public.civic_correction_reports;
CREATE POLICY "Civic managers can view hub correction reports"
  ON public.civic_correction_reports
  FOR SELECT
  TO authenticated
  USING (public.can_manage_civic_hub(hub_id));

DROP POLICY IF EXISTS "Civic managers can review hub correction reports"
  ON public.civic_correction_reports;
CREATE POLICY "Civic managers can review hub correction reports"
  ON public.civic_correction_reports
  FOR UPDATE
  TO authenticated
  USING (public.can_manage_civic_hub(hub_id))
  WITH CHECK (public.can_manage_civic_hub(hub_id));

-- =============================================================================
-- D. Seed Curated Public & Government Taxonomy + 4 Sample Civic Records
-- =============================================================================
DO $$
DECLARE
  v_civic_root_id uuid;
  v_cat_emergency_id uuid;
  v_cat_govt_id uuid;
  v_cat_utility_id uuid;

  v_ccpur_id uuid;
  v_aizawl_id uuid;
  v_admin_owner_id uuid;

  -- Deterministic sample civic listing UUIDs
  v_civic_1 uuid := 'f0000000-0000-4000-8000-00000000c001';
  v_civic_2 uuid := 'f0000000-0000-4000-8000-00000000c002';
  v_civic_3 uuid := 'f0000000-0000-4000-8000-00000000c003';
  v_civic_4 uuid := 'f0000000-0000-4000-8000-00000000c004';
BEGIN
  -- ---------------------------------------------------------------------------
  -- D1. Curated Taxonomy (`public_govt_services` + 5 Depth-1 Subcategories)
  -- ---------------------------------------------------------------------------
  INSERT INTO public.categories (
    entity_type, parent_id, depth, slug, display_name, icon, color_hex, sort_order, is_active
  )
  VALUES (
    'listing', NULL, 0, 'public_govt_services', 'Public & Govt Services', 'Landmark', '#334155', 75, true
  )
  ON CONFLICT (entity_type, slug) DO NOTHING;

  SELECT id INTO v_civic_root_id
  FROM public.categories
  WHERE entity_type = 'listing' AND slug = 'public_govt_services'
  LIMIT 1;

  IF v_civic_root_id IS NOT NULL THEN
    INSERT INTO public.categories (
      entity_type, parent_id, depth, slug, display_name, icon, color_hex, sort_order, is_active
    )
    VALUES
      ('listing', v_civic_root_id, 1, 'emergency_hospitals', 'Emergency & Hospitals', 'Hospital', '#DC2626', 10, true),
      ('listing', v_civic_root_id, 1, 'police_fire_rescue', 'Police, Fire & Rescue', 'ShieldAlert', '#1D4ED8', 20, true),
      ('listing', v_civic_root_id, 1, 'govt_civic_offices', 'Government Offices', 'Landmark', '#334155', 30, true),
      ('listing', v_civic_root_id, 1, 'utilities_power_water', 'Electricity & Water', 'Zap', '#D97706', 40, true),
      ('listing', v_civic_root_id, 1, 'community_public_places', 'Community & Public Halls', 'Building2', '#0F766E', 50, true)
    ON CONFLICT (entity_type, slug) DO NOTHING;
  END IF;

  SELECT id INTO v_cat_emergency_id
  FROM public.categories
  WHERE entity_type = 'listing' AND slug = 'emergency_hospitals'
  LIMIT 1;

  SELECT id INTO v_cat_govt_id
  FROM public.categories
  WHERE entity_type = 'listing' AND slug = 'govt_civic_offices'
  LIMIT 1;

  SELECT id INTO v_cat_utility_id
  FROM public.categories
  WHERE entity_type = 'listing' AND slug = 'utilities_power_water'
  LIMIT 1;

  -- ---------------------------------------------------------------------------
  -- D2. Resolve Hubs & Admin Owner Profile
  -- ---------------------------------------------------------------------------
  SELECT id INTO v_ccpur_id FROM public.service_hubs WHERE slug = 'churachandpur' LIMIT 1;
  SELECT id INTO v_aizawl_id FROM public.service_hubs WHERE slug = 'aizawl' LIMIT 1;

  SELECT id INTO v_admin_owner_id
  FROM public.profiles
  WHERE role IN ('super_admin', 'admin', 'hub_manager')
  ORDER BY CASE WHEN role = 'super_admin' THEN 1 WHEN role = 'admin' THEN 2 ELSE 3 END
  LIMIT 1;

  IF v_admin_owner_id IS NULL THEN
    SELECT id INTO v_admin_owner_id FROM public.profiles LIMIT 1;
  END IF;

  -- ---------------------------------------------------------------------------
  -- D3. Seed 4 Sample Civic Records (2 Churachandpur, 2 Aizawl)
  -- ---------------------------------------------------------------------------
  IF v_ccpur_id IS NOT NULL AND v_admin_owner_id IS NOT NULL THEN
    -- 1. Churachandpur District Hospital (Emergency & OPD)
    INSERT INTO public.listings (
      id, owner_id, owner_name, title, category, subcategory, category_id, status,
      locality, address, short_description, description, price,
      contact_phone, phone, cover_image, gallery_images,
      coordinates, lat, lng, rating, review_count, hub_id,
      listing_vertical, is_civic_record
    ) VALUES (
      v_civic_1,
      v_admin_owner_id,
      'DD oodle Civic Directory',
      '[SAMPLE] Churachandpur District Hospital (Emergency & OPD)',
      'public_interest',
      'Emergency & Hospitals',
      COALESCE(v_cat_emergency_id, v_civic_root_id),
      'published',
      'Tuibong',
      'IB Road, Near Tuibong Main Junction, Churachandpur, Manipur 795128',
      '24x7 Casualty, Emergency Trauma Desk, Blood Bank, and District OPD Counter.',
      'Primary government district hospital serving Churachandpur with 24x7 emergency trauma care, ambulance dispatch, maternity ward, blood bank, and daily outpatient counters.',
      0,
      '+91 3874 233108',
      '+91 3874 233108',
      'https://picsum.photos/seed/ddoodle-civic-ccpur-hosp/960/640',
      '[]'::jsonb,
      '{"lat":24.3368,"lng":93.6882}'::jsonb,
      24.3368,
      93.6882,
      0,
      0,
      v_ccpur_id,
      'public_civic',
      true
    ) ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.listing_civic_profiles (
      listing_id, hub_id, department_type, is_24x7, office_hours_text,
      helplines, document_checklists, important_notes,
      live_civic_alert, live_civic_alert_expires_at,
      official_website, show_nearby_print_helper, last_verified_at, last_verified_by
    ) VALUES (
      v_civic_1,
      v_ccpur_id,
      'emergency_medical',
      true,
      'Emergency & Casualty: Open 24x7 | OPD Registration: Mon–Sat 8:30 AM – 1:00 PM',
      '[
        {"label":"24x7 Casualty & Trauma Desk","phone":"+91 3874 233108","is_emergency":true},
        {"label":"National Ambulance Helpline","phone":"108","is_emergency":true},
        {"label":"Blood Bank Counter","phone":"+91 3874 233210","is_emergency":false}
      ]'::jsonb,
      '[
        {
          "service_title":"OPD & Ayushman / CMHT Cashless Registration",
          "required_docs":["Aadhaar Card or Valid Govt Photo ID","CMHT / PM-JAY Health Card (if applicable)","Previous Referral Slip (for follow-ups)"],
          "fee_note":"Nominal OPD ticket ₹10",
          "processing_time":"10–15 mins at Counter 1"
        },
        {
          "service_title":"Birth / Medical Fitness Certificate Copy",
          "required_docs":["Hospital Discharge Summary","Parents Aadhaar / Voter ID Photocopies","Filled Application Slip"],
          "fee_note":"No fee for initial birth record slip",
          "processing_time":"2–3 working days"
        }
      ]'::jsonb,
      'Carry photocopies of CMHT/PM-JAY and Aadhaar cards for faster cashless admission.',
      NULL,
      NULL,
      'https://churachandpur.nic.in',
      true,
      now(),
      v_admin_owner_id
    ) ON CONFLICT (listing_id) DO NOTHING;

    -- 2. Mini Secretariat & DC Office Helpdesk
    INSERT INTO public.listings (
      id, owner_id, owner_name, title, category, subcategory, category_id, status,
      locality, address, short_description, description, price,
      contact_phone, phone, cover_image, gallery_images,
      coordinates, lat, lng, rating, review_count, hub_id,
      listing_vertical, is_civic_record
    ) VALUES (
      v_civic_2,
      v_admin_owner_id,
      'DD oodle Civic Directory',
      '[SAMPLE] Mini Secretariat & DC Office Helpdesk',
      'public_interest',
      'Government Offices',
      COALESCE(v_cat_govt_id, v_civic_root_id),
      'published',
      'Tuibong',
      'Mini Secretariat Complex, Tuibong, Churachandpur, Manipur 795128',
      'District Commissioner Office, e-District Citizen Counter, Income & Domicile Certificates.',
      'Central district administration hub for citizen certificates, revenue records, election roll updates, and public grievance facilitation.',
      0,
      '+91 3874 233101',
      '+91 3874 233101',
      'https://picsum.photos/seed/ddoodle-civic-ccpur-dc/960/640',
      '[]'::jsonb,
      '{"lat":24.3469,"lng":93.6932}'::jsonb,
      24.3469,
      93.6932,
      0,
      0,
      v_ccpur_id,
      'public_civic',
      true
    ) ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.listing_civic_profiles (
      listing_id, hub_id, department_type, is_24x7, office_hours_text,
      helplines, document_checklists, important_notes,
      live_civic_alert, live_civic_alert_expires_at,
      official_website, show_nearby_print_helper, last_verified_at, last_verified_by
    ) VALUES (
      v_civic_2,
      v_ccpur_id,
      'government_office',
      false,
      'Mon–Fri: 9:30 AM – 4:30 PM | 1st & 3rd Sat: 10:00 AM – 2:00 PM (Closed 2nd/4th Sat & Sun)',
      '[
        {"label":"DC Office Citizen Helpdesk","phone":"+91 3874 233101","is_emergency":false},
        {"label":"District Emergency Control Room","phone":"1077","is_emergency":true}
      ]'::jsonb,
      '[
        {
          "service_title":"Income Certificate (e-District)",
          "required_docs":["Aadhaar Card / Voter ID Photocopy","Village Chief / Local Authority Verification Letter","2 Passport-size Photographs","Self-Declaration / Affidavit Form"],
          "fee_note":"Govt portal fee ₹30–₹50",
          "processing_time":"7–10 working days"
        },
        {
          "service_title":"Domicile / Permanent Residence Certificate (PRC)",
          "required_docs":["Aadhaar Card & Electoral Roll Extract","School Leaving / Birth Certificate","Local Authority Residence Verification","2 Passport-size Photographs"],
          "fee_note":"Govt portal fee ₹50",
          "processing_time":"10–14 working days"
        }
      ]'::jsonb,
      'Keep both original documents and one clear photocopy set ready before token submission.',
      'e-District Counter 2 token distribution closes at 2:30 PM this week due to server maintenance.',
      now() + interval '14 days',
      'https://churachandpur.nic.in',
      true,
      now(),
      v_admin_owner_id
    ) ON CONFLICT (listing_id) DO NOTHING;
  END IF;

  IF v_aizawl_id IS NOT NULL AND v_admin_owner_id IS NOT NULL THEN
    -- 3. Aizawl Civil Hospital Emergency Desk
    INSERT INTO public.listings (
      id, owner_id, owner_name, title, category, subcategory, category_id, status,
      locality, address, short_description, description, price,
      contact_phone, phone, cover_image, gallery_images,
      coordinates, lat, lng, rating, review_count, hub_id,
      listing_vertical, is_civic_record
    ) VALUES (
      v_civic_3,
      v_admin_owner_id,
      'DD oodle Civic Directory',
      '[SAMPLE] Aizawl Civil Hospital Emergency Desk',
      'public_interest',
      'Emergency & Hospitals',
      COALESCE(v_cat_emergency_id, v_civic_root_id),
      'published',
      'Dawrpui',
      'Civil Hospital Road, Dawrpui, Aizawl, Mizoram 796001',
      '24x7 Emergency Casualty, Trauma Care, Ambulance Dispatch, and Blood Bank.',
      'State referral government hospital in central Aizawl offering 24x7 emergency medical care, diagnostic labs, blood bank, and specialist outpatient clinics.',
      0,
      '+91 389 2322318',
      '+91 389 2322318',
      'https://picsum.photos/seed/ddoodle-civic-aizawl-hosp/960/640',
      '[]'::jsonb,
      '{"lat":23.7308,"lng":92.7195}'::jsonb,
      23.7308,
      92.7195,
      0,
      0,
      v_aizawl_id,
      'public_civic',
      true
    ) ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.listing_civic_profiles (
      listing_id, hub_id, department_type, is_24x7, office_hours_text,
      helplines, document_checklists, important_notes,
      live_civic_alert, live_civic_alert_expires_at,
      official_website, show_nearby_print_helper, last_verified_at, last_verified_by
    ) VALUES (
      v_civic_3,
      v_aizawl_id,
      'emergency_medical',
      true,
      'Casualty & Emergency: Open 24x7 | OPD Registration: Mon–Fri 9:00 AM – 1:30 PM',
      '[
        {"label":"24x7 Casualty & Emergency","phone":"+91 389 2322318","is_emergency":true},
        {"label":"Emergency Ambulance","phone":"108","is_emergency":true},
        {"label":"Blood Bank Desk","phone":"+91 389 2322320","is_emergency":false}
      ]'::jsonb,
      '[
        {
          "service_title":"Mizoram Health Care Scheme (MHCS) / AB-PMJAY Desk",
          "required_docs":["Aadhaar Card Photocopy","Active MHCS / Golden Card","Doctor Admission Advice Slip"],
          "fee_note":"Cashless for eligible scheme holders",
          "processing_time":"15–20 mins at Helpdesk"
        }
      ]'::jsonb,
      'Use the Dawrpui main gate ramp for immediate emergency stretcher access.',
      NULL,
      NULL,
      'https://health.mizoram.gov.in',
      true,
      now(),
      v_admin_owner_id
    ) ON CONFLICT (listing_id) DO NOTHING;

    -- 4. P&E Department Billing & Fault Helpline (Aizawl)
    INSERT INTO public.listings (
      id, owner_id, owner_name, title, category, subcategory, category_id, status,
      locality, address, short_description, description, price,
      contact_phone, phone, cover_image, gallery_images,
      coordinates, lat, lng, rating, review_count, hub_id,
      listing_vertical, is_civic_record
    ) VALUES (
      v_civic_4,
      v_admin_owner_id,
      'DD oodle Civic Directory',
      '[SAMPLE] P&E Department Billing & Fault Helpline (Aizawl)',
      'public_interest',
      'Electricity & Water',
      COALESCE(v_cat_utility_id, v_civic_root_id),
      'published',
      'Khatla',
      'Power & Electricity Complex, New Secretariat Road, Khatla, Aizawl, Mizoram 796001',
      '24x7 Power Fault Reporting, New Meter Connection Checklist, and Consumer Billing Counter.',
      'Power & Electricity Department Aizawl consumer service desk handling power outage fault tickets, meter testing, bill corrections, and domestic/commercial new connections.',
      0,
      '1912',
      '+91 389 2334420',
      'https://picsum.photos/seed/ddoodle-civic-aizawl-pe/960/640',
      '[]'::jsonb,
      '{"lat":23.7204,"lng":92.7128}'::jsonb,
      23.7204,
      92.7128,
      0,
      0,
      v_aizawl_id,
      'public_civic',
      true
    ) ON CONFLICT (id) DO NOTHING;

    INSERT INTO public.listing_civic_profiles (
      listing_id, hub_id, department_type, is_24x7, office_hours_text,
      helplines, document_checklists, important_notes,
      live_civic_alert, live_civic_alert_expires_at,
      official_website, show_nearby_print_helper, last_verified_at, last_verified_by
    ) VALUES (
      v_civic_4,
      v_aizawl_id,
      'utility_power_water',
      true,
      'Fault Helpline: 24x7 | Billing & New Connection Counter: Mon–Fri 9:30 AM – 4:00 PM',
      '[
        {"label":"24x7 Electricity Fault Helpline","phone":"1912","is_emergency":true},
        {"label":"Khatla Sub-Division Billing Desk","phone":"+91 389 2334420","is_emergency":false}
      ]'::jsonb,
      '[
        {
          "service_title":"New Domestic Power Connection",
          "required_docs":["Aadhaar Card / Voter ID Photocopy","Land Pass / LSC / House Ownership Proof","2 Passport-size Photographs","Licensed Wireman Test Report"],
          "fee_note":"Security deposit + meter fee as per sanctioned load",
          "processing_time":"7–15 working days after site inspection"
        },
        {
          "service_title":"Meter Name Transfer / Load Revision",
          "required_docs":["Latest Paid Electricity Bill Copy","Applicant Photo ID","Ownership / NOC Supporting Document"],
          "fee_note":"Processing fee ₹100",
          "processing_time":"5–7 working days"
        }
      ]'::jsonb,
      'Keep your Consumer ID / Meter Number ready when calling 1912 for rapid fault ticket dispatch.',
      NULL,
      NULL,
      'https://power.mizoram.gov.in',
      true,
      now(),
      v_admin_owner_id
    ) ON CONFLICT (listing_id) DO NOTHING;
  END IF;
END;
$$;
]g