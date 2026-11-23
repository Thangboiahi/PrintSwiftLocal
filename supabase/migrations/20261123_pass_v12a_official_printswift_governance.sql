-- =============================================================================
-- Migration: 20261123_pass_v12a_official_printswift_governance.sql
-- Pass V12-A: Official PrintSwift Manager/Admin Governance, Print Ordering Fix
--             & Canonical Print Profile Schema / RLS Lockdown
-- 100% Idempotent (safe to re-run repeatedly)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Schema Extensions (public.listings & public.listing_print_profiles)
-- -----------------------------------------------------------------------------
ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS whatsapp text,
  ADD COLUMN IF NOT EXISTS is_verified boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS opening_hours text,
  ADD COLUMN IF NOT EXISTS logo_url text;

ALTER TABLE public.listing_print_profiles
  ADD COLUMN IF NOT EXISTS is_official_printswift boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS express_eta_mins integer NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS supports_pick_n_drop boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS pricing_matrix jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_listing_print_profiles_official
  ON public.listing_print_profiles (hub_id, is_official_printswift)
  WHERE is_official_printswift = true;

-- -----------------------------------------------------------------------------
-- 2. Official PrintSwift Predicate & Entitlement RPC
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_official_printswift_listing(
  p_listing_id uuid
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.listing_print_profiles lpp
    WHERE lpp.listing_id = p_listing_id
      AND (
        COALESCE(lpp.is_official_printswift, false) = true
        OR COALESCE(lpp.is_first_party_printswift, false) = true
      )
  );
$$;

REVOKE ALL ON FUNCTION public.is_official_printswift_listing(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_official_printswift_listing(uuid) TO anon, authenticated, service_role;

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

  SELECT (
    COALESCE(is_official_printswift, false)
    OR COALESCE(is_first_party_printswift, false)
  )
    INTO v_is_official
  FROM public.listing_print_profiles
  WHERE listing_id = p_listing_id;

  IF v_is_official THEN
    RETURN true;
  END IF;

  v_ent := public.get_effective_entitlements(NULL, p_listing_id);
  RETURN COALESCE((v_ent->'features'->>'print_online_orders')::boolean, false);
END;
$$;

GRANT EXECUTE ON FUNCTION public.has_active_print_entitlement(uuid) TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- 3. Sync & Strict Governance Triggers
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_and_guard_listing_print_profile()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_listing_hub_id uuid;
  v_default_hub_id uuid;
  v_is_service boolean := (current_setting('role', true) = 'service_role');
  v_can_manage_hub boolean;
  v_official boolean;
BEGIN
  -- 1. Always sync hub_id from parent listing
  SELECT l.hub_id
    INTO v_listing_hub_id
  FROM public.listings l
  WHERE l.id = NEW.listing_id;

  IF v_listing_hub_id IS NULL THEN
    SELECT h.id
      INTO v_default_hub_id
    FROM public.service_hubs h
    WHERE h.is_default = true
    ORDER BY h.sort_order ASC
    LIMIT 1;
    v_listing_hub_id := COALESCE(NEW.hub_id, v_default_hub_id);
  END IF;

  IF v_listing_hub_id IS NOT NULL THEN
    NEW.hub_id := v_listing_hub_id;
  END IF;

  -- 2. Bi-directionally mirror is_official_printswift <-> is_first_party_printswift
  IF TG_OP = 'INSERT' THEN
    v_official := COALESCE(NEW.is_official_printswift, false)
      OR COALESCE(NEW.is_first_party_printswift, false);
  ELSE
    IF NEW.is_official_printswift IS DISTINCT FROM OLD.is_official_printswift THEN
      v_official := COALESCE(NEW.is_official_printswift, false);
    ELSIF NEW.is_first_party_printswift IS DISTINCT FROM OLD.is_first_party_printswift THEN
      v_official := COALESCE(NEW.is_first_party_printswift, false);
    ELSE
      v_official := COALESCE(NEW.is_official_printswift, false)
        OR COALESCE(NEW.is_first_party_printswift, false);
    END IF;
  END IF;
  NEW.is_official_printswift := v_official;
  NEW.is_first_party_printswift := v_official;

  -- 3. Keep pricing_matrix and rate_card bi-directionally synchronized
  IF TG_OP = 'INSERT' THEN
    IF COALESCE(NEW.pricing_matrix, '{}'::jsonb) <> '{}'::jsonb
       AND COALESCE(NEW.rate_card, '{}'::jsonb) = '{}'::jsonb THEN
      NEW.rate_card := NEW.pricing_matrix;
    ELSIF COALESCE(NEW.rate_card, '{}'::jsonb) <> '{}'::jsonb
       AND COALESCE(NEW.pricing_matrix, '{}'::jsonb) = '{}'::jsonb THEN
      NEW.pricing_matrix := NEW.rate_card;
    ELSE
      NEW.pricing_matrix := COALESCE(NEW.rate_card, '{}'::jsonb)
        || COALESCE(NEW.pricing_matrix, '{}'::jsonb);
      NEW.rate_card := NEW.pricing_matrix;
    END IF;
  ELSE
    IF NEW.pricing_matrix IS DISTINCT FROM OLD.pricing_matrix THEN
      NEW.rate_card := COALESCE(NEW.pricing_matrix, '{}'::jsonb);
    ELSIF NEW.rate_card IS DISTINCT FROM OLD.rate_card THEN
      NEW.pricing_matrix := COALESCE(NEW.rate_card, '{}'::jsonb);
    END IF;
  END IF;

  NEW.express_eta_mins := GREATEST(5, COALESCE(NEW.express_eta_mins, 30));
  NEW.supports_pick_n_drop := COALESCE(NEW.supports_pick_n_drop, true);

  -- 4. Guard privileged fields & Official PrintSwift governance
  v_can_manage_hub := (
    v_is_service
    OR auth.uid() IS NULL
    OR public.is_super_admin()
    OR (NEW.hub_id IS NOT NULL AND public.is_hub_manager_for(NEW.hub_id))
  );

  IF NOT v_can_manage_hub THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.is_official_printswift = true OR NEW.is_first_party_printswift = true THEN
        RAISE EXCEPTION 'Forbidden: Only Super-Admin or Hub Manager can create or designate an Official PrintSwift hub.'
          USING ERRCODE = '42501';
      END IF;
      IF COALESCE(NEW.verified_capabilities, '{}'::jsonb) <> '{}'::jsonb THEN
        RAISE EXCEPTION 'Forbidden: Only Super-Admin or Hub Manager can set verified_capabilities.'
          USING ERRCODE = '42501';
      END IF;
    ELSIF TG_OP = 'UPDATE' THEN
      IF OLD.is_official_printswift = true
         OR OLD.is_first_party_printswift = true
         OR NEW.is_official_printswift = true
         OR NEW.is_first_party_printswift = true THEN
        RAISE EXCEPTION 'Forbidden: Official PrintSwift hubs can only be modified by authorized Hub Managers or Super-Admins.'
          USING ERRCODE = '42501';
      END IF;
      IF NEW.verified_capabilities IS DISTINCT FROM OLD.verified_capabilities THEN
        RAISE EXCEPTION 'Forbidden: Only Super-Admin or Hub Manager can modify verified_capabilities.'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  -- 5. Auto-increment pricing_version whenever rate_card or pricing_matrix changes
  IF TG_OP = 'UPDATE' AND (
    NEW.rate_card IS DISTINCT FROM OLD.rate_card
    OR NEW.pricing_matrix IS DISTINCT FROM OLD.pricing_matrix
  ) THEN
    NEW.pricing_version := COALESCE(OLD.pricing_version, 1) + 1;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_listing_print_profiles_sync_guard ON public.listing_print_profiles;
CREATE TRIGGER trg_listing_print_profiles_sync_guard
  BEFORE INSERT OR UPDATE ON public.listing_print_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_and_guard_listing_print_profile();

-- Sync Official PrintSwift / Print Profile summary onto public.listings
CREATE OR REPLACE FUNCTION public.sync_print_profile_to_listing_summary()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_official boolean := (
    COALESCE(NEW.is_official_printswift, false)
    OR COALESCE(NEW.is_first_party_printswift, false)
  );
BEGIN
  UPDATE public.listings
  SET
    listing_vertical = 'print_digital',
    is_verified = CASE
      WHEN v_is_official THEN true
      ELSE is_verified
    END,
    vertical_summary = COALESCE(vertical_summary, '{}'::jsonb) || jsonb_build_object(
      'is_official_printswift', v_is_official,
      'is_first_party_printswift', v_is_official,
      'is_accepting_orders', NEW.is_accepting_orders,
      'express_eta_mins', COALESCE(NEW.express_eta_mins, 30),
      'supports_pick_n_drop', COALESCE(NEW.supports_pick_n_drop, true),
      'turnaround_badge', NEW.turnaround_badge,
      'verified_capabilities', COALESCE(NEW.verified_capabilities, '{}'::jsonb),
      'has_active_entitlement', CASE
        WHEN v_is_official THEN true
        ELSE COALESCE((vertical_summary->>'has_active_entitlement')::boolean, false)
      END
    )
  WHERE id = NEW.listing_id;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_print_profile_to_listing_summary ON public.listing_print_profiles;
CREATE TRIGGER trg_sync_print_profile_to_listing_summary
  AFTER INSERT OR UPDATE OF
    is_official_printswift,
    is_first_party_printswift,
    is_accepting_orders,
    express_eta_mins,
    supports_pick_n_drop,
    turnaround_badge,
    verified_capabilities
  ON public.listing_print_profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_print_profile_to_listing_summary();

-- Guard public.listings rows linked to Official PrintSwift hubs from non-manager edits
CREATE OR REPLACE FUNCTION public.guard_official_printswift_listings_mutation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_is_service boolean := (current_setting('role', true) = 'service_role');
BEGIN
  IF auth.uid() IS NULL OR v_is_service OR public.is_super_admin() THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF TG_OP = 'DELETE' THEN
    IF public.is_official_printswift_listing(OLD.id) THEN
      RAISE EXCEPTION 'Forbidden: Official PrintSwift hub listings cannot be deleted by non-admin users.'
        USING ERRCODE = '42501';
    END IF;
    RETURN OLD;
  END IF;

  IF TG_OP = 'UPDATE' AND public.is_official_printswift_listing(OLD.id) THEN
    IF NOT (
      (OLD.hub_id IS NOT NULL AND public.is_hub_manager_for(OLD.hub_id))
      AND (NEW.hub_id IS NOT NULL AND public.is_hub_manager_for(NEW.hub_id))
    ) THEN
      RAISE EXCEPTION 'Forbidden: Official PrintSwift hub listings can only be updated by authorized Hub Managers or Super-Admins.'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_guard_official_printswift_listings_mutation ON public.listings;
CREATE TRIGGER trg_guard_official_printswift_listings_mutation
  BEFORE UPDATE OR DELETE ON public.listings
  FOR EACH ROW
  EXECUTE FUNCTION public.guard_official_printswift_listings_mutation();

-- -----------------------------------------------------------------------------
-- 4. Strict Governance RLS Policies (public.listing_print_profiles & public.listings)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Operators and hub managers can insert listing print profiles" ON public.listing_print_profiles;
CREATE POLICY "Operators and hub managers can insert listing print profiles"
  ON public.listing_print_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR public.is_hub_manager_for(hub_id)
    OR (
      COALESCE(is_official_printswift, false) = false
      AND COALESCE(is_first_party_printswift, false) = false
      AND public.is_print_operator_for(listing_id)
    )
  );

DROP POLICY IF EXISTS "Operators and hub managers can update listing print profiles" ON public.listing_print_profiles;
CREATE POLICY "Operators and hub managers can update listing print profiles"
  ON public.listing_print_profiles
  FOR UPDATE
  TO authenticated
  USING (
    public.is_super_admin()
    OR public.is_hub_manager_for(hub_id)
    OR (
      COALESCE(is_official_printswift, false) = false
      AND COALESCE(is_first_party_printswift, false) = false
      AND public.is_print_operator_for(listing_id)
    )
  )
  WITH CHECK (
    public.is_super_admin()
    OR public.is_hub_manager_for(hub_id)
    OR (
      COALESCE(is_official_printswift, false) = false
      AND COALESCE(is_first_party_printswift, false) = false
      AND public.is_print_operator_for(listing_id)
    )
  );

DROP POLICY IF EXISTS "Hub managers insert hub listings" ON public.listings;
CREATE POLICY "Hub managers insert hub listings"
  ON public.listings
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_super_admin()
    OR public.is_hub_manager_for(hub_id)
  );

DROP POLICY IF EXISTS "Allow owners to update own listings" ON public.listings;
CREATE POLICY "Allow owners to update own listings"
  ON public.listings
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND (
      public.is_super_admin()
      OR public.is_hub_manager_for(hub_id)
      OR (
        NOT public.is_official_printswift_listing(id)
        AND (
          owner_id = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM public.staff_delegations sd
            WHERE sd.listing_id = public.listings.id
              AND sd.staff_id = auth.uid()
          )
        )
      )
    )
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND (
      public.is_super_admin()
      OR public.is_hub_manager_for(hub_id)
      OR (
        NOT public.is_official_printswift_listing(id)
        AND (
          owner_id = auth.uid()
          OR EXISTS (
            SELECT 1
            FROM public.staff_delegations sd
            WHERE sd.listing_id = public.listings.id
              AND sd.staff_id = auth.uid()
          )
        )
      )
    )
  );

DROP POLICY IF EXISTS "Allow owners to delete own listings" ON public.listings;
CREATE POLICY "Allow owners to delete own listings"
  ON public.listings
  FOR DELETE
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND (
      public.is_super_admin()
      OR (
        NOT public.is_official_printswift_listing(id)
        AND owner_id = auth.uid()
      )
    )
  );

-- -----------------------------------------------------------------------------
-- 5. Idempotent Official PrintSwift Backfill & Legacy Cleanup
-- -----------------------------------------------------------------------------
DO $$
DECLARE
  v_admin_id uuid;
  v_print_cat_id uuid;
  v_hub RECORD;
  v_official_listing_id uuid;
  v_hub_slug_lc text;
  v_hub_name text;
  v_title text;
  v_locality text;
  v_address text;
  v_phone text;
  v_whatsapp text;
  v_seed_slug text;
  v_full_caps jsonb := '{"bw_a4":true,"color_a4":true,"duplex":true,"a3_large":true,"spiral_binding":true,"lamination":true,"custom_digital_jobs":true,"sealed_envelope":true}'::jsonb;
  v_default_matrix jsonb := jsonb_build_object(
    'bw_a4_single_inr', 3,
    'bw_a4_duplex_inr', 5,
    'color_a4_single_inr', 12,
    'color_a4_duplex_inr', 20,
    'a3_bw_inr', 15,
    'a3_bw_duplex_inr', 25,
    'a3_color_inr', 40,
    'a3_color_duplex_inr', 65,
    'legal_bw_single_inr', 4,
    'legal_bw_duplex_inr', 7,
    'legal_color_single_inr', 15,
    'legal_color_duplex_inr', 26,
    'spiral_binding_inr', 40,
    'hard_binding_inr', 120,
    'lamination_per_sheet_inr', 25,
    'staple_inr', 5,
    'sealed_envelope_inr', 10,
    'min_order_inr', 15,
    'urgent_express_surcharge_type', 'flat',
    'urgent_express_surcharge_value', 25,
    'platform_fee_inr', 0,
    'bulk_discounts', '[]'::jsonb
  );
  v_official_policy jsonb := jsonb_build_object(
    'allow_direct_pay', false,
    'direct_pay_max_inr', 0,
    'allow_escrow', true,
    'shop_upi_id', NULL,
    'shop_upi_name', 'PrintSwift Official',
    'shop_upi_verified', false
  );
BEGIN
  -- 5A. Resolve default admin & print category UUIDs
  SELECT id
    INTO v_admin_id
  FROM public.profiles
  WHERE role = 'super_admin'
  ORDER BY created_at ASC NULLS LAST
  LIMIT 1;

  IF v_admin_id IS NULL THEN
    SELECT id INTO v_admin_id FROM public.profiles ORDER BY created_at ASC NULLS LAST LIMIT 1;
  END IF;

  SELECT id
    INTO v_print_cat_id
  FROM public.categories
  WHERE lower(COALESCE(slug, '')) LIKE '%print%'
     OR lower(COALESCE(name, '')) LIKE '%print%'
     OR lower(COALESCE(slug, '')) = 'service'
  ORDER BY CASE
    WHEN lower(COALESCE(slug, '')) LIKE '%print%'
      OR lower(COALESCE(name, '')) LIKE '%print%' THEN 0
    ELSE 1
  END, sort_order ASC NULLS LAST
  LIMIT 1;

  -- 5B. Reclassify miscategorized PrintSwift listings
  UPDATE public.listings
  SET listing_vertical = 'print_digital'
  WHERE listing_vertical = 'general'
    AND title ILIKE '%PrintSwift%';

  -- 5C. Normalize existing listing_print_profiles columns & pricing keys
  UPDATE public.listing_print_profiles
  SET
    is_official_printswift = COALESCE(is_official_printswift, false)
      OR COALESCE(is_first_party_printswift, false),
    is_first_party_printswift = COALESCE(is_official_printswift, false)
      OR COALESCE(is_first_party_printswift, false),
    pricing_matrix = v_default_matrix
      || jsonb_strip_nulls(jsonb_build_object(
        'bw_a4_single_inr', COALESCE((rate_card->>'bw_a4_single_inr')::numeric, (pricing_matrix->>'bw_a4_single_inr')::numeric, (rate_card->>'bw_a4_per_page')::numeric),
        'color_a4_single_inr', COALESCE((rate_card->>'color_a4_single_inr')::numeric, (pricing_matrix->>'color_a4_single_inr')::numeric, (rate_card->>'color_a4_per_page')::numeric),
        'lamination_per_sheet_inr', COALESCE((rate_card->>'lamination_per_sheet_inr')::numeric, (pricing_matrix->>'lamination_per_sheet_inr')::numeric, (rate_card->>'lamination_inr')::numeric, (rate_card->>'lamination_a4_inr')::numeric),
        'min_order_inr', COALESCE((rate_card->>'min_order_inr')::numeric, (pricing_matrix->>'min_order_inr')::numeric, (rate_card->>'minimum_order_inr')::numeric)
      ))
      || COALESCE(rate_card, '{}'::jsonb)
      || COALESCE(pricing_matrix, '{}'::jsonb);

  UPDATE public.listing_print_profiles
  SET rate_card = pricing_matrix
  WHERE rate_card IS DISTINCT FROM pricing_matrix;

  -- 5D. Guarantee every active service hub has a real UUID Official PrintSwift Hub
  FOR v_hub IN
    SELECT *
    FROM public.service_hubs
    WHERE status = 'active'
    ORDER BY sort_order ASC, created_at ASC
  LOOP
    v_hub_slug_lc := lower(COALESCE(v_hub.slug, ''));
    v_hub_name := COALESCE(NULLIF(trim(v_hub.name), ''), 'Local Hub');

    IF v_hub_slug_lc IN ('ccpur', 'churachandpur', 'lamka')
       OR v_hub_name ILIKE '%churachandpur%'
       OR v_hub_name ILIKE '%lamka%' THEN
      v_title := 'PrintSwift Express Hub — Lamka';
      v_locality := 'Lamka Bazar';
      v_address := 'Tedim Road, Opposite Main Bazar, Churachandpur 795128';
      v_phone := COALESCE(NULLIF(v_hub.office_contact->>'phone', ''), '+91 98620 11001');
      v_seed_slug := 'lamka';
    ELSIF v_hub_slug_lc = 'aizawl' OR v_hub_name ILIKE '%aizawl%' THEN
      v_title := 'PrintSwift Express Hub — Aizawl';
      v_locality := 'Zarkawt';
      v_address := 'Zarkawt Main Road, Near Chanmari Junction, Aizawl 796007';
      v_phone := COALESCE(NULLIF(v_hub.office_contact->>'phone', ''), '+91 98630 11001');
      v_seed_slug := 'aizawl';
    ELSE
      v_title := 'PrintSwift Express Hub — ' || v_hub_name;
      v_locality := v_hub_name;
      v_address := COALESCE(NULLIF(v_hub.office_contact->>'address', ''), v_hub_name);
      v_phone := COALESCE(NULLIF(v_hub.office_contact->>'phone', ''), '+91 98620 11000');
      v_seed_slug := COALESCE(NULLIF(v_hub.slug, ''), v_hub.id::text);
    END IF;
    v_whatsapp := COALESCE(NULLIF(v_hub.office_contact->>'whatsapp', ''), v_phone);

    -- Check for an existing official PrintSwift listing in this hub
    SELECT l.id
      INTO v_official_listing_id
    FROM public.listings l
    LEFT JOIN public.listing_print_profiles lpp ON lpp.listing_id = l.id
    WHERE l.hub_id = v_hub.id
      AND (
        COALESCE(lpp.is_official_printswift, false) = true
        OR COALESCE(lpp.is_first_party_printswift, false) = true
        OR l.title ILIKE '%PrintSwift Express Hub%'
      )
    ORDER BY CASE
      WHEN COALESCE(lpp.is_official_printswift, false) OR COALESCE(lpp.is_first_party_printswift, false) THEN 0
      ELSE 1
    END, l.created_at ASC
    LIMIT 1;

    IF v_official_listing_id IS NOT NULL THEN
      UPDATE public.listings
      SET
        title = COALESCE(NULLIF(trim(regexp_replace(COALESCE(title, ''), '^\[SAMPLE\]\s*', '', 'i')), ''), v_title),
        listing_vertical = 'print_digital',
        category = COALESCE(NULLIF(category, ''), 'service'),
        subcategory = COALESCE(NULLIF(subcategory, ''), 'Document & Xerox Print'),
        category_id = COALESCE(category_id, v_print_cat_id),
        status = 'published',
        lifecycle_status = 'active',
        is_verified = true,
        verification_status = 'verified',
        is_featured_demo = false,
        whatsapp = COALESCE(NULLIF(whatsapp, ''), NULLIF(phone, ''), NULLIF(contact_phone, ''), v_whatsapp),
        phone = COALESCE(NULLIF(phone, ''), NULLIF(contact_phone, ''), v_phone),
        contact_phone = COALESCE(NULLIF(contact_phone, ''), NULLIF(phone, ''), v_phone),
        opening_hours = COALESCE(NULLIF(opening_hours, ''), 'Mon–Sat: 08:30 AM – 07:30 PM'),
        updated_at = now()
      WHERE id = v_official_listing_id;

      INSERT INTO public.listing_print_profiles (
        listing_id,
        hub_id,
        is_official_printswift,
        is_first_party_printswift,
        is_accepting_orders,
        express_eta_mins,
        supports_pick_n_drop,
        turnaround_badge,
        capabilities,
        verified_capabilities,
        pricing_matrix,
        rate_card,
        payment_policy,
        pickup_instructions
      ) VALUES (
        v_official_listing_id,
        v_hub.id,
        true,
        true,
        true,
        30,
        true,
        'express_30m',
        v_full_caps,
        v_full_caps,
        v_default_matrix,
        v_default_matrix,
        v_official_policy,
        'Show your 4-digit Collection OTP at the Official PrintSwift counter, or choose Pick N Drop door delivery.'
      )
      ON CONFLICT (listing_id) DO UPDATE SET
        hub_id = EXCLUDED.hub_id,
        is_official_printswift = true,
        is_first_party_printswift = true,
        is_accepting_orders = true,
        express_eta_mins = COALESCE(public.listing_print_profiles.express_eta_mins, 30),
        supports_pick_n_drop = COALESCE(public.listing_print_profiles.supports_pick_n_drop, true),
        turnaround_badge = 'express_30m',
        capabilities = v_full_caps || COALESCE(public.listing_print_profiles.capabilities, '{}'::jsonb),
        verified_capabilities = v_full_caps || COALESCE(public.listing_print_profiles.verified_capabilities, '{}'::jsonb),
        pricing_matrix = v_default_matrix || COALESCE(public.listing_print_profiles.pricing_matrix, '{}'::jsonb),
        rate_card = v_default_matrix || COALESCE(public.listing_print_profiles.rate_card, '{}'::jsonb),
        payment_policy = v_official_policy,
        pickup_instructions = COALESCE(
          NULLIF(public.listing_print_profiles.pickup_instructions, ''),
          EXCLUDED.pickup_instructions
        );
    ELSE
      INSERT INTO public.listings (
        id,
        owner_id,
        owner_name,
        title,
        category,
        subcategory,
        category_id,
        status,
        lifecycle_status,
        verification_status,
        is_verified,
        is_featured_demo,
        locality,
        address,
        short_description,
        description,
        price,
        contact_phone,
        phone,
        whatsapp,
        opening_hours,
        cover_image,
        gallery_images,
        coordinates,
        lat,
        lng,
        rating,
        review_count,
        hub_id,
        listing_vertical,
        is_civic_record
      ) VALUES (
        gen_random_uuid(),
        v_admin_id,
        'PrintSwift Official',
        v_title,
        'service',
        'Document & Xerox Print',
        v_print_cat_id,
        'published',
        'active',
        'verified',
        true,
        false,
        v_locality,
        v_address,
        'Official PrintSwift counter for express 30-min B&W/Color PDF printing, binding, lamination & Pick N Drop dispatch.',
        'First-party PrintSwift digital print hub managed by Hub Governance for fast document printing, binding, lamination, and sealed Pick N Drop delivery.',
        3,
        v_phone,
        v_phone,
        v_whatsapp,
        'Mon–Sat: 08:30 AM – 07:30 PM',
        'https://picsum.photos/seed/dd-print-official-' || v_seed_slug || '/960/640',
        '[]'::jsonb,
        jsonb_build_object('lat', v_hub.center_lat, 'lng', v_hub.center_lng),
        v_hub.center_lat,
        v_hub.center_lng,
        4.9,
        28,
        v_hub.id,
        'print_digital',
        false
      )
      RETURNING id INTO v_official_listing_id;

      INSERT INTO public.listing_print_profiles (
        listing_id,
        hub_id,
        is_official_printswift,
        is_first_party_printswift,
        is_accepting_orders,
        express_eta_mins,
        supports_pick_n_drop,
        turnaround_badge,
        capabilities,
        verified_capabilities,
        pricing_matrix,
        rate_card,
        payment_policy,
        pickup_instructions
      ) VALUES (
        v_official_listing_id,
        v_hub.id,
        true,
        true,
        true,
        30,
        true,
        'express_30m',
        v_full_caps,
        v_full_caps,
        v_default_matrix,
        v_default_matrix,
        v_official_policy,
        'Show your 4-digit Collection OTP at the Official PrintSwift counter, or choose Pick N Drop door delivery.'
      )
      ON CONFLICT (listing_id) DO NOTHING;
    END IF;
  END LOOP;

  -- 5E. Backfill any third-party print_digital listings missing a print profile row
  INSERT INTO public.listing_print_profiles (
    listing_id,
    hub_id,
    is_official_printswift,
    is_first_party_printswift,
    is_accepting_orders,
    express_eta_mins,
    supports_pick_n_drop,
    turnaround_badge,
    pricing_matrix,
    rate_card
  )
  SELECT
    l.id,
    l.hub_id,
    false,
    false,
    false,
    180,
    true,
    'same_day',
    v_default_matrix,
    v_default_matrix
  FROM public.listings l
  WHERE l.listing_vertical = 'print_digital'
    AND l.hub_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM public.listing_print_profiles lpp WHERE lpp.listing_id = l.id
    )
  ON CONFLICT (listing_id) DO NOTHING;

  -- 5F. Refresh vertical_summary cache & is_verified on all print listings
  UPDATE public.listings l
  SET
    listing_vertical = 'print_digital',
    is_verified = CASE
      WHEN (COALESCE(lpp.is_official_printswift, false) OR COALESCE(lpp.is_first_party_printswift, false))
        THEN true
      ELSE l.is_verified
    END,
    vertical_summary = COALESCE(l.vertical_summary, '{}'::jsonb) || jsonb_build_object(
      'is_official_printswift', COALESCE(lpp.is_official_printswift, false) OR COALESCE(lpp.is_first_party_printswift, false),
      'is_first_party_printswift', COALESCE(lpp.is_official_printswift, false) OR COALESCE(lpp.is_first_party_printswift, false),
      'is_accepting_orders', lpp.is_accepting_orders,
      'express_eta_mins', COALESCE(lpp.express_eta_mins, 30),
      'supports_pick_n_drop', COALESCE(lpp.supports_pick_n_drop, true),
      'turnaround_badge', lpp.turnaround_badge,
      'verified_capabilities', COALESCE(lpp.verified_capabilities, '{}'::jsonb),
      'has_active_entitlement', CASE
        WHEN (COALESCE(lpp.is_official_printswift, false) OR COALESCE(lpp.is_first_party_printswift, false)) THEN true
        ELSE COALESCE((l.vertical_summary->>'has_active_entitlement')::boolean, false)
      END
    )
  FROM public.listing_print_profiles lpp
  WHERE lpp.listing_id = l.id;
END;
$$;
