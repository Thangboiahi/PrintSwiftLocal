-- =============================================================================
-- Migration: 20261120_phase71a_print_digital_suite.sql
-- Phase 71-A: Isolated Print & Digital Ordering Suite Schema, Private Vault
--             (`print-documents`), Dual-Rail Payments, Curated 3-Level
--             Taxonomy & Print Pro Plans, OTP Verification & Fulfillment RPCs,
--             and Strict Least-Privilege RLS (Hub-Manager File Blindness)
-- =============================================================================
-- STRICT IDEMPOTENCY GUARANTEE:
--   Every extension, bucket, table, column, index, constraint, trigger,
--   function, policy, and seed INSERT is safe to re-run without errors.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Required Extensions & Updated-At Helper
-- -----------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.set_phase71a_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Ensure core RBAC helpers exist (no-op if Phase 66-A already deployed them)
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
-- A. Private Storage Bucket (`print-documents`)
-- =============================================================================
INSERT INTO storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
VALUES (
  'print-documents',
  'print-documents',
  false,
  26214400, -- 25 MB hard ceiling
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/webp'
  ]
)
ON CONFLICT (id) DO NOTHING;

-- Guarantee bucket remains private even if pre-created manually
UPDATE storage.buckets
SET
  public = false,
  file_size_limit = COALESCE(file_size_limit, 26214400),
  allowed_mime_types = COALESCE(
    allowed_mime_types,
    ARRAY['application/pdf', 'image/jpeg', 'image/png', 'image/webp']
  )
WHERE id = 'print-documents';

-- Explicitly purge any accidental public/client SELECT policy on print-documents.
-- All file downloads are minted strictly via server-side 5-minute signed URLs.
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
        lower(policyname) LIKE '%print-documents%'
        OR lower(policyname) LIKE '%print_documents%'
        OR COALESCE(qual, '') LIKE '%print-documents%'
      )
      AND cmd IN ('SELECT', 'ALL')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON storage.objects', v_pol.policyname);
  END LOOP;
END;
$$;

-- =============================================================================
-- B. Five Isolated Print & Digital Tables
-- =============================================================================

-- -----------------------------------------------------------------------------
-- B1. public.listing_print_profiles
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.listing_print_profiles (
  listing_id uuid PRIMARY KEY REFERENCES public.listings(id) ON DELETE CASCADE,
  hub_id uuid NOT NULL REFERENCES public.service_hubs(id) ON DELETE CASCADE,
  is_first_party_printswift boolean NOT NULL DEFAULT false,
  is_accepting_orders boolean NOT NULL DEFAULT false,
  busy_until timestamptz,
  pricing_version integer NOT NULL DEFAULT 1,
  capabilities jsonb NOT NULL DEFAULT '{"bw_a4":true,"color_a4":false,"duplex":false,"a3_large":false,"spiral_binding":false,"lamination":false,"custom_digital_jobs":false,"sealed_envelope":true}'::jsonb,
  verified_capabilities jsonb NOT NULL DEFAULT '{}'::jsonb,
  rate_card jsonb NOT NULL DEFAULT '{}'::jsonb,
  payment_policy jsonb NOT NULL DEFAULT '{"allow_direct_pay":true,"direct_pay_max_inr":300,"allow_escrow":true,"shop_upi_id":null,"shop_upi_name":null,"shop_upi_verified":false}'::jsonb,
  turnaround_badge text NOT NULL DEFAULT 'same_day'
    CHECK (turnaround_badge IN ('express_30m', 'same_day', 'next_day')),
  pickup_instructions text,
  max_file_size_mb integer NOT NULL DEFAULT 25,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_listing_print_profiles_hub_accepting
  ON public.listing_print_profiles (hub_id, is_accepting_orders)
  WHERE is_accepting_orders = true;

CREATE INDEX IF NOT EXISTS idx_listing_print_profiles_first_party
  ON public.listing_print_profiles (hub_id, is_first_party_printswift)
  WHERE is_first_party_printswift = true;

-- Auto-sync hub_id from listings.hub_id, bump pricing_version on rate_card changes,
-- and guard privileged columns (is_first_party_printswift & verified_capabilities).
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

  -- 2. Guard privileged fields: only Hub Manager (for hub) or Super-Admin may set
  --    is_first_party_printswift or verified_capabilities
  v_can_manage_hub := (
    v_is_service
    OR public.is_super_admin()
    OR public.is_hub_manager_for(NEW.hub_id)
  );

  IF NOT v_can_manage_hub THEN
    IF TG_OP = 'INSERT' THEN
      IF NEW.is_first_party_printswift = true THEN
        RAISE EXCEPTION 'Forbidden: Only Super-Admin or Hub Manager can mark a profile as First-Party PrintSwift.'
          USING ERRCODE = '42501';
      END IF;
      IF COALESCE(NEW.verified_capabilities, '{}'::jsonb) <> '{}'::jsonb THEN
        RAISE EXCEPTION 'Forbidden: Only Super-Admin or Hub Manager can set verified_capabilities.'
          USING ERRCODE = '42501';
      END IF;
    ELSIF TG_OP = 'UPDATE' THEN
      IF NEW.is_first_party_printswift IS DISTINCT FROM OLD.is_first_party_printswift THEN
        RAISE EXCEPTION 'Forbidden: Only Super-Admin or Hub Manager can modify is_first_party_printswift.'
          USING ERRCODE = '42501';
      END IF;
      IF NEW.verified_capabilities IS DISTINCT FROM OLD.verified_capabilities THEN
        RAISE EXCEPTION 'Forbidden: Only Super-Admin or Hub Manager can modify verified_capabilities.'
          USING ERRCODE = '42501';
      END IF;
    END IF;
  END IF;

  -- 3. Auto-increment pricing_version whenever rate_card changes
  IF TG_OP = 'UPDATE' AND NEW.rate_card IS DISTINCT FROM OLD.rate_card THEN
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

-- -----------------------------------------------------------------------------
-- B2. public.print_orders
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.print_orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_code text UNIQUE NOT NULL,
  hub_id uuid NOT NULL REFERENCES public.service_hubs(id),
  listing_id uuid NOT NULL REFERENCES public.listings(id) ON DELETE RESTRICT,
  customer_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  is_first_party_order boolean NOT NULL DEFAULT false,
  job_mode text NOT NULL
    CHECK (job_mode IN ('instant_print', 'custom_digital')),
  service_category_slug text,
  customer_instructions text,
  quote_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  quoted_amount_inr numeric(10,2),
  platform_fee_inr numeric(10,2) NOT NULL DEFAULT 0,
  payment_rail text NOT NULL DEFAULT 'platform_escrow'
    CHECK (payment_rail IN ('direct_counter', 'direct_shop_upi', 'platform_escrow')),
  payment_intent_id uuid REFERENCES public.payment_intents(id) ON DELETE SET NULL,
  handover_mode text NOT NULL DEFAULT 'walk_in_pickup'
    CHECK (handover_mode IN ('walk_in_pickup', 'pick_n_drop')),
  linked_delivery_order_id uuid REFERENCES public.delivery_orders(id) ON DELETE SET NULL,
  sealed_envelope_requested boolean NOT NULL DEFAULT false,
  phone_otp_verified_at timestamptz,
  collection_otp_hash text,
  collection_otp_display_for_customer text,
  -- Separate Independent State Lifecycles
  quote_status text NOT NULL DEFAULT 'unquoted'
    CHECK (quote_status IN ('unquoted', 'awaiting_shop_quote', 'quoted', 'accepted', 'expired')),
  payment_status text NOT NULL DEFAULT 'not_required_yet'
    CHECK (payment_status IN ('not_required_yet', 'unpaid', 'pending_manual_review', 'escrow_held', 'paid_direct_confirmed', 'refunded')),
  fulfillment_status text NOT NULL DEFAULT 'draft'
    CHECK (fulfillment_status IN ('draft', 'confirmed', 'printing', 'ready_for_pickup', 'handed_to_rider', 'collected', 'cancelled')),
  settlement_status text NOT NULL DEFAULT 'not_applicable'
    CHECK (settlement_status IN ('not_applicable', 'locked', 'eligible', 'settled', 'reversed')),
  purge_status text NOT NULL DEFAULT 'active'
    CHECK (purge_status IN ('active', 'scheduled', 'purged')),
  collected_at timestamptz,
  purge_scheduled_at timestamptz,
  files_purged_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_print_orders_hub_fulfillment
  ON public.print_orders (hub_id, fulfillment_status);

CREATE INDEX IF NOT EXISTS idx_print_orders_listing_fulfillment
  ON public.print_orders (listing_id, fulfillment_status);

CREATE INDEX IF NOT EXISTS idx_print_orders_customer_created
  ON public.print_orders (customer_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_print_orders_purge_queue
  ON public.print_orders (purge_status, purge_scheduled_at);

DROP TRIGGER IF EXISTS trg_print_orders_updated_at ON public.print_orders;
CREATE TRIGGER trg_print_orders_updated_at
  BEFORE UPDATE ON public.print_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.set_phase71a_updated_at();

-- -----------------------------------------------------------------------------
-- B3. public.print_order_files
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.print_order_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  print_order_id uuid NOT NULL REFERENCES public.print_orders(id) ON DELETE CASCADE,
  storage_object_key text NOT NULL,
  display_label_masked text NOT NULL,
  mime_type text NOT NULL,
  file_size_bytes bigint NOT NULL,
  server_verified_pages integer NOT NULL DEFAULT 1,
  print_options jsonb NOT NULL DEFAULT '{}'::jsonb,
  purge_status text NOT NULL DEFAULT 'active'
    CHECK (purge_status IN ('active', 'purged')),
  purged_at timestamptz,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_print_order_files_order_purge
  ON public.print_order_files (print_order_id, purge_status);

-- -----------------------------------------------------------------------------
-- B4. public.print_order_events
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.print_order_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  print_order_id uuid NOT NULL REFERENCES public.print_orders(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  actor_role text NOT NULL,
  event_type text NOT NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_print_order_events_order_created
  ON public.print_order_events (print_order_id, created_at DESC);

-- -----------------------------------------------------------------------------
-- B5. public.merchant_settlements
-- -----------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.merchant_settlements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  hub_id uuid NOT NULL REFERENCES public.service_hubs(id),
  listing_id uuid NOT NULL REFERENCES public.listings(id) ON DELETE RESTRICT,
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  print_order_id uuid UNIQUE NOT NULL REFERENCES public.print_orders(id) ON DELETE RESTRICT,
  gross_amount_inr numeric(10,2) NOT NULL,
  platform_fee_inr numeric(10,2) NOT NULL DEFAULT 0,
  net_payable_inr numeric(10,2) NOT NULL,
  status text NOT NULL DEFAULT 'locked'
    CHECK (status IN ('locked', 'eligible', 'settled', 'reversed')),
  payout_reference text,
  settled_by uuid REFERENCES public.profiles(id),
  settled_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_merchant_settlements_hub_status
  ON public.merchant_settlements (hub_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_merchant_settlements_owner_status
  ON public.merchant_settlements (owner_id, status, created_at DESC);

DROP TRIGGER IF EXISTS trg_merchant_settlements_updated_at ON public.merchant_settlements;
CREATE TRIGGER trg_merchant_settlements_updated_at
  BEFORE UPDATE ON public.merchant_settlements
  FOR EACH ROW
  EXECUTE FUNCTION public.set_phase71a_updated_at();

-- =============================================================================
-- C. Safe Interlink Alterations to Existing Tables
-- =============================================================================

-- C1. public.subscription_plans
ALTER TABLE public.subscription_plans
  ADD COLUMN IF NOT EXISTS plan_scope text NOT NULL DEFAULT 'bulletin',
  ADD COLUMN IF NOT EXISTS entitlements jsonb NOT NULL DEFAULT '{}'::jsonb;

-- C2. public.user_subscriptions
ALTER TABLE public.user_subscriptions
  ADD COLUMN IF NOT EXISTS listing_id uuid REFERENCES public.listings(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_listing_active
  ON public.user_subscriptions (listing_id, status, expires_at DESC)
  WHERE listing_id IS NOT NULL;

-- C3. public.payment_intents
ALTER TABLE public.payment_intents
  ADD COLUMN IF NOT EXISTS print_order_id uuid REFERENCES public.print_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_payment_intents_print_order
  ON public.payment_intents (print_order_id)
  WHERE print_order_id IS NOT NULL;

-- Dynamically drop any existing CHECK constraint on payment_intents.purpose
-- and recreate it with all existing + Print & Digital purposes
DO $$
DECLARE
  v_con record;
BEGIN
  FOR v_con IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'payment_intents'
      AND c.contype = 'c'
      AND pg_get_constraintdef(c.oid) ~* '\bpurpose\b'
  LOOP
    EXECUTE format('ALTER TABLE public.payment_intents DROP CONSTRAINT IF EXISTS %I', v_con.conname);
  END LOOP;
END;
$$;

ALTER TABLE public.payment_intents
  ADD CONSTRAINT payment_intents_purpose_check
  CHECK (
    purpose IN (
      'pick_n_drop',
      'vehicle_booking',
      'bulletin_subscription',
      'bulletin_post_pass',
      'print_order',
      'print_order_with_delivery',
      'print_pro_subscription'
    )
  );

-- Extend payment_intents update guard to also protect print_order_id from tampering
CREATE OR REPLACE FUNCTION public.guard_payment_intent_user_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
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

-- C4. public.delivery_orders
ALTER TABLE public.delivery_orders
  ADD COLUMN IF NOT EXISTS linked_print_order_id uuid REFERENCES public.print_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS sealed_package_required boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_delivery_orders_linked_print_order
  ON public.delivery_orders (linked_print_order_id)
  WHERE linked_print_order_id IS NOT NULL;

-- C5. public.profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS phone_verified_at timestamptz,
  ADD COLUMN IF NOT EXISTS print_no_show_count integer NOT NULL DEFAULT 0;

-- C6. public.service_hubs module_switches backfill
UPDATE public.service_hubs
SET module_switches = COALESCE(module_switches, '{}'::jsonb) || '{"print_orders": true}'::jsonb
WHERE NOT (COALESCE(module_switches, '{}'::jsonb) ? 'print_orders');

-- =============================================================================
-- D. Seed Curated 3-Level Printing & Digital Services Taxonomy & Print Pro Plans
-- =============================================================================
DO $$
DECLARE
  v_root_id uuid;
  v_sub_print_id uuid;
  v_sub_doc_id uuid;
  v_sub_digital_id uuid;
BEGIN
  -- Depth 0 Root
  INSERT INTO public.categories (
    entity_type, parent_id, depth, slug, display_name, icon, color_hex, sort_order, is_active
  )
  VALUES (
    'listing', NULL, 0, 'printing_digital_services', 'Printing & Digital Services', 'Printer', '#0F766E', 55, true
  )
  ON CONFLICT (entity_type, slug) DO NOTHING;

  SELECT id INTO v_root_id
  FROM public.categories
  WHERE entity_type = 'listing' AND slug = 'printing_digital_services'
  LIMIT 1;

  IF v_root_id IS NOT NULL THEN
    -- Depth 1 Sub 1: Printing Services
    INSERT INTO public.categories (
      entity_type, parent_id, depth, slug, display_name, icon, color_hex, sort_order, is_active
    )
    VALUES (
      'listing', v_root_id, 1, 'printing_services', 'Printing Services', 'Printer', '#0F766E', 10, true
    )
    ON CONFLICT (entity_type, slug) DO NOTHING;

    SELECT id INTO v_sub_print_id
    FROM public.categories
    WHERE entity_type = 'listing' AND slug = 'printing_services'
    LIMIT 1;

    -- Depth 1 Sub 2: Document & Office
    INSERT INTO public.categories (
      entity_type, parent_id, depth, slug, display_name, icon, color_hex, sort_order, is_active
    )
    VALUES (
      'listing', v_root_id, 1, 'document_office_services', 'Document & Office', 'FileText', '#0D9488', 20, true
    )
    ON CONFLICT (entity_type, slug) DO NOTHING;

    SELECT id INTO v_sub_doc_id
    FROM public.categories
    WHERE entity_type = 'listing' AND slug = 'document_office_services'
    LIMIT 1;

    -- Depth 1 Sub 3: Digital & Computer
    INSERT INTO public.categories (
      entity_type, parent_id, depth, slug, display_name, icon, color_hex, sort_order, is_active
    )
    VALUES (
      'listing', v_root_id, 1, 'digital_computer_services', 'Digital & Computer', 'Monitor', '#0284C7', 30, true
    )
    ON CONFLICT (entity_type, slug) DO NOTHING;

    SELECT id INTO v_sub_digital_id
    FROM public.categories
    WHERE entity_type = 'listing' AND slug = 'digital_computer_services'
    LIMIT 1;

    -- Depth 2 Micros under Printing Services
    IF v_sub_print_id IS NOT NULL THEN
      INSERT INTO public.categories (
        entity_type, parent_id, depth, slug, display_name, icon, color_hex, sort_order, is_active
      )
      VALUES
        ('listing', v_sub_print_id, 2, 'document_printing', 'Document Printing', 'FileText', '#0F766E', 10, true),
        ('listing', v_sub_print_id, 2, 'color_printing', 'Color Printing', 'Palette', '#0F766E', 20, true),
        ('listing', v_sub_print_id, 2, 'bulk_student_printing', 'Bulk & Student Printing', 'BookOpen', '#0F766E', 30, true),
        ('listing', v_sub_print_id, 2, 'large_format_flex', 'Large Format & Flex', 'Maximize2', '#0F766E', 40, true),
        ('listing', v_sub_print_id, 2, 'photo_printing', 'Photo Printing', 'Image', '#0F766E', 50, true)
      ON CONFLICT (entity_type, slug) DO NOTHING;
    END IF;

    -- Depth 2 Micros under Document & Office
    IF v_sub_doc_id IS NOT NULL THEN
      INSERT INTO public.categories (
        entity_type, parent_id, depth, slug, display_name, icon, color_hex, sort_order, is_active
      )
      VALUES
        ('listing', v_sub_doc_id, 2, 'typing_formatting', 'Typing & Formatting', 'Type', '#0D9488', 10, true),
        ('listing', v_sub_doc_id, 2, 'scanning_photocopying', 'Scanning & Photocopying', 'ScanLine', '#0D9488', 20, true),
        ('listing', v_sub_doc_id, 2, 'binding_lamination', 'Binding & Lamination', 'BookMarked', '#0D9488', 30, true)
      ON CONFLICT (entity_type, slug) DO NOTHING;
    END IF;

    -- Depth 2 Micros under Digital & Computer
    IF v_sub_digital_id IS NOT NULL THEN
      INSERT INTO public.categories (
        entity_type, parent_id, depth, slug, display_name, icon, color_hex, sort_order, is_active
      )
      VALUES
        ('listing', v_sub_digital_id, 2, 'graphic_banner_design', 'Graphic & Banner Design', 'PenTool', '#0284C7', 10, true),
        ('listing', v_sub_digital_id, 2, 'online_form_assistance', 'Online Form Assistance', 'Globe', '#0284C7', 20, true),
        ('listing', v_sub_digital_id, 2, 'file_conversion_dtp', 'File Conversion & DTP', 'FileCode', '#0284C7', 30, true),
        ('listing', v_sub_digital_id, 2, 'cyber_cafe_internet', 'Cyber Cafe & Internet', 'Wifi', '#0284C7', 40, true)
      ON CONFLICT (entity_type, slug) DO NOTHING;
    END IF;
  END IF;
END;
$$;

-- Seed 2 Print Pro subscription plans (idempotent)
INSERT INTO public.subscription_plans (
  slug,
  name,
  price_inr,
  max_active_bulletins,
  max_monthly_posts,
  max_images_per_post,
  allow_youtube,
  duration_days,
  is_active,
  plan_scope,
  entitlements
)
VALUES
  (
    'print_pro_monthly',
    'Monthly Print & Digital Pro',
    499,
    0,
    0,
    3,
    false,
    30,
    true,
    'print_pro',
    '{"print_ordering":true,"custom_digital_quotes":true,"escrow_enabled":true,"max_monthly_orders":500}'::jsonb
  ),
  (
    'print_pro_quarterly',
    'Quarterly Print & Digital Pro',
    1299,
    0,
    0,
    3,
    false,
    90,
    true,
    'print_pro',
    '{"print_ordering":true,"custom_digital_quotes":true,"escrow_enabled":true,"max_monthly_orders":2000}'::jsonb
  )
ON CONFLICT (slug) DO NOTHING;

-- =============================================================================
-- E. Helper Functions, OTP Verification RPC & Payment Bridge (SECURITY DEFINER)
-- =============================================================================

-- -----------------------------------------------------------------------------
-- E1. has_active_print_entitlement(p_listing_id uuid)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.has_active_print_entitlement(p_listing_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    p_listing_id IS NOT NULL
    AND (
      -- 1. First-party Official PrintSwift profile is always entitled
      EXISTS (
        SELECT 1
        FROM public.listing_print_profiles lpp
        WHERE lpp.listing_id = p_listing_id
          AND lpp.is_first_party_printswift = true
      )
      -- 2. Active listing-bound OR owner-bound Print Pro / Merchant Bundle subscription
      OR EXISTS (
        SELECT 1
        FROM public.user_subscriptions us
        JOIN public.subscription_plans sp ON sp.id = us.plan_id
        LEFT JOIN public.listings l ON l.id = p_listing_id
        WHERE us.status = 'active'
          AND us.expires_at > now()
          AND sp.plan_scope IN ('print_pro', 'merchant_bundle')
          AND COALESCE(sp.entitlements->>'print_ordering', 'false') = 'true'
          AND (
            us.listing_id = p_listing_id
            OR (us.listing_id IS NULL AND l.owner_id IS NOT NULL AND us.user_id = l.owner_id)
          )
      )
    );
$$;

GRANT EXECUTE ON FUNCTION public.has_active_print_entitlement(uuid) TO anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- E2. is_print_operator_for(p_listing_id uuid)
--     CRITICAL: Strictly returns false for hub_manager or general admin on
--               third-party listings!
-- -----------------------------------------------------------------------------
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
      -- 1. Direct listing owner
      EXISTS (
        SELECT 1
        FROM public.listings l
        WHERE l.id = p_listing_id
          AND l.owner_id = auth.uid()
      )
      -- 2. Active delegated staff member on public.staff_delegations
      OR EXISTS (
        SELECT 1
        FROM public.staff_delegations sd
        WHERE sd.staff_id = auth.uid()
          AND COALESCE(sd.status, 'active') = 'active'
          AND (
            sd.listing_id = p_listing_id
            OR (
              jsonb_typeof(sd.assigned_listing_ids) = 'array'
              AND sd.assigned_listing_ids ? p_listing_id::text
            )
          )
      )
      -- 3. Super-Admin ONLY when operating a First-Party Official PrintSwift listing
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

GRANT EXECUTE ON FUNCTION public.is_print_operator_for(uuid) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- E2b. Customer-only OTP Display Reader (RLS helper RPC)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_my_print_collection_otp(p_order_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_otp text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication required.' USING ERRCODE = '42501';
  END IF;

  SELECT po.collection_otp_display_for_customer
    INTO v_otp
  FROM public.print_orders po
  WHERE po.id = p_order_id
    AND po.customer_id = auth.uid();

  RETURN v_otp;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_print_collection_otp(uuid) TO authenticated;

-- -----------------------------------------------------------------------------
-- E3. verify_print_collection_otp(p_order_id, p_otp, p_direct_payment_confirmed)
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.verify_print_collection_otp(
  p_order_id uuid,
  p_otp text,
  p_direct_payment_confirmed boolean DEFAULT false
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_caller_uid uuid := auth.uid();
  v_is_service boolean := (current_setting('role', true) = 'service_role');
  v_order public.print_orders%ROWTYPE;
  v_clean_otp text := trim(COALESCE(p_otp, ''));
  v_computed_hash text;
  v_actor_role text := 'operator';
  v_next_fulfillment text;
  v_next_payment text;
  v_next_settlement text;
  v_now timestamptz := now();
  v_purge_at timestamptz := now() + interval '48 hours';
BEGIN
  IF v_clean_otp = '' THEN
    RAISE EXCEPTION 'Collection OTP is required.'
      USING ERRCODE = '22023';
  END IF;

  -- Lock print order row
  SELECT *
    INTO v_order
  FROM public.print_orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Print order not found.'
      USING ERRCODE = 'P0002';
  END IF;

  -- Verify operator authority (Hub Managers & general Admins are rejected on 3P shops)
  IF NOT v_is_service AND NOT public.is_print_operator_for(v_order.listing_id) THEN
    RAISE EXCEPTION 'Forbidden: Only authorized shop operators may verify collection OTP.'
      USING ERRCODE = '42501';
  END IF;

  IF v_order.fulfillment_status IN ('collected', 'cancelled') THEN
    RAISE EXCEPTION 'Order is already finalized (%).', v_order.fulfillment_status
      USING ERRCODE = 'P0001';
  END IF;

  IF v_order.collection_otp_hash IS NULL OR trim(v_order.collection_otp_hash) = '' THEN
    RAISE EXCEPTION 'No collection OTP is registered for this order.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Compare SHA-256 hex digest against stored hash
  v_computed_hash := encode(digest(convert_to(v_clean_otp, 'UTF8'), 'sha256'), 'hex');
  IF lower(v_computed_hash) <> lower(trim(v_order.collection_otp_hash)) THEN
    RAISE EXCEPTION 'Invalid collection OTP.'
      USING ERRCODE = '22023';
  END IF;

  -- Resolve actor role label for immutable audit log
  IF v_is_service THEN
    v_actor_role := 'system';
  ELSIF public.is_super_admin() AND v_order.is_first_party_order THEN
    v_actor_role := 'printswift_operator';
  ELSE
    SELECT COALESCE(p.role, 'operator')
      INTO v_actor_role
    FROM public.profiles p
    WHERE p.id = v_caller_uid;
  END IF;

  -- Compute next lifecycle states based on handover_mode and payment_rail
  v_next_payment := v_order.payment_status;
  v_next_settlement := v_order.settlement_status;

  IF v_order.handover_mode = 'pick_n_drop' THEN
    v_next_fulfillment := 'handed_to_rider';
  ELSE
    v_next_fulfillment := 'collected';
    IF v_order.payment_rail IN ('direct_counter', 'direct_shop_upi')
       AND p_direct_payment_confirmed = true THEN
      v_next_payment := 'paid_direct_confirmed';
    END IF;
  END IF;

  -- Unlock merchant settlement to 'eligible' if funded via Platform Escrow on 3P shop
  IF v_order.payment_rail = 'platform_escrow' AND NOT v_order.is_first_party_order THEN
    v_next_settlement := 'eligible';
    UPDATE public.merchant_settlements
    SET
      status = 'eligible',
      updated_at = v_now
    WHERE print_order_id = v_order.id
      AND status = 'locked';
  END IF;

  UPDATE public.print_orders
  SET
    fulfillment_status = v_next_fulfillment,
    payment_status = v_next_payment,
    settlement_status = v_next_settlement,
    collected_at = v_now,
    purge_scheduled_at = v_purge_at,
    purge_status = 'scheduled',
    updated_at = v_now
  WHERE id = v_order.id
  RETURNING * INTO v_order;

  INSERT INTO public.print_order_events (
    print_order_id,
    actor_id,
    actor_role,
    event_type,
    metadata
  )
  VALUES (
    v_order.id,
    v_caller_uid,
    COALESCE(v_actor_role, 'operator'),
    'otp_verified_handover',
    jsonb_build_object(
      'handover_mode', v_order.handover_mode,
      'fulfillment_status', v_order.fulfillment_status,
      'payment_status', v_order.payment_status,
      'settlement_status', v_order.settlement_status,
      'direct_payment_confirmed', p_direct_payment_confirmed,
      'purge_scheduled_at', v_purge_at
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'order_id', v_order.id,
    'order_code', v_order.order_code,
    'handover_mode', v_order.handover_mode,
    'fulfillment_status', v_order.fulfillment_status,
    'payment_status', v_order.payment_status,
    'settlement_status', v_order.settlement_status,
    'purge_status', v_order.purge_status,
    'collected_at', v_order.collected_at,
    'purge_scheduled_at', v_order.purge_scheduled_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.verify_print_collection_otp(uuid, text, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.verify_print_collection_otp(uuid, text, boolean) TO authenticated, service_role;

-- -----------------------------------------------------------------------------
-- E4. Upgrade fulfill_payment_intent RPC
--     Preserves all existing purposes AND adds print_order,
--     print_order_with_delivery, and print_pro_subscription fulfillment.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.fulfill_payment_intent(
  p_intent_id uuid,
  p_provider_payment_id text DEFAULT NULL,
  p_provider text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_uid uuid := auth.uid();
  v_is_service boolean := (current_setting('role', true) = 'service_role');
  v_intent public.payment_intents%ROWTYPE;
  v_effective_payment_id text;
  v_effective_provider text;
  v_print_order_id uuid;
  v_print_order public.print_orders%ROWTYPE;
  v_listing_owner_id uuid;
  v_listing_hub_id uuid;
  v_gross_inr numeric(10,2);
  v_fee_inr numeric(10,2);
  v_net_inr numeric(10,2);
  v_sub_row record;
BEGIN
  -- Pre-flight privilege gate so unprivileged callers cannot probe arbitrary intent UUIDs
  IF NOT v_is_service AND NOT public.is_super_admin() AND NOT EXISTS (
    SELECT 1
    FROM public.hub_managers hm
    WHERE hm.profile_id = v_caller_uid
      AND hm.is_active = true
      AND hm.can_confirm_manual_payments = true
  ) THEN
    RAISE EXCEPTION 'Forbidden: Only Super Admin, delegated Hub Manager, or verified payment webhook may fulfill payment intents.'
      USING ERRCODE = '42501';
  END IF;

  -- Row-level lock guarantees strict idempotency between browser verify and webhook retries
  SELECT *
    INTO v_intent
  FROM public.payment_intents
  WHERE id = p_intent_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment intent not found.'
      USING ERRCODE = 'P0002';
  END IF;

  -- Strictly verify per-hub manual payment confirmation delegation for this intent's hub
  IF NOT v_is_service
     AND NOT public.is_super_admin()
     AND NOT public.can_confirm_hub_payment(v_intent.hub_id) THEN
    RAISE EXCEPTION 'Forbidden: You do not have manual payment confirmation authority for this hub.'
      USING ERRCODE = '42501';
  END IF;

  IF v_intent.status = 'succeeded' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'already_fulfilled', true,
      'intent_id', p_intent_id,
      'payment_intent', to_jsonb(v_intent)
    );
  END IF;

  IF v_intent.status = 'refunded' THEN
    RAISE EXCEPTION 'Cannot fulfill a payment intent that has already been refunded.'
      USING ERRCODE = 'P0001';
  END IF;

  v_effective_provider := coalesce(
    nullif(trim(coalesce(p_provider, '')), ''),
    v_intent.provider,
    'manual_upi'
  );

  IF v_effective_provider NOT IN ('manual_upi', 'razorpay') THEN
    v_effective_provider := v_intent.provider;
  END IF;

  v_effective_payment_id := coalesce(
    nullif(trim(coalesce(p_provider_payment_id, '')), ''),
    v_intent.upi_utr_ref,
    v_intent.provider_payment_id
  );

  UPDATE public.payment_intents
  SET
    provider = v_effective_provider,
    status = 'succeeded',
    verified_by = coalesce(v_caller_uid, verified_by),
    provider_payment_id = v_effective_payment_id,
    updated_at = now()
  WHERE id = p_intent_id
  RETURNING * INTO v_intent;

  -- Atomically increment promo code redemption count once on transition to succeeded
  IF v_intent.promo_code_id IS NOT NULL THEN
    UPDATE public.promo_codes
    SET used_count = used_count + 1
    WHERE id = v_intent.promo_code_id;
  END IF;

  -- Atomically fulfill downstream domain target
  IF v_intent.purpose = 'pick_n_drop' THEN
    UPDATE public.delivery_orders
    SET
      status = 'escrow_held',
      mediator_id = coalesce(mediator_id, v_caller_uid),
      updated_at = now()
    WHERE id = v_intent.reference_id
      AND status IN ('awaiting_payment', 'payment_submitted');

    INSERT INTO public.delivery_transactions (
      order_id,
      hub_id,
      tx_type,
      amount_inr,
      upi_utr_ref,
      payment_proof_path,
      recorded_by,
      notes
    )
    VALUES (
      v_intent.reference_id,
      v_intent.hub_id,
      'escrow_hold',
      v_intent.amount_inr,
      coalesce(v_intent.upi_utr_ref, v_effective_payment_id),
      v_intent.payment_proof_path,
      v_caller_uid,
      'Fulfilled via ' || v_intent.provider || ' intent ' || v_intent.intent_code
    );

    INSERT INTO public.delivery_order_events (
      order_id,
      actor_id,
      event_type,
      payload
    )
    VALUES (
      v_intent.reference_id,
      v_caller_uid,
      'escrow_held',
      jsonb_build_object(
        'intent_id', v_intent.id,
        'intent_code', v_intent.intent_code,
        'hub_id', v_intent.hub_id,
        'provider', v_intent.provider,
        'provider_payment_id', v_effective_payment_id,
        'amount_inr', v_intent.amount_inr,
        'discount_inr', v_intent.discount_inr,
        'convenience_fee_inr', v_intent.convenience_fee_inr
      )
    );

  ELSIF v_intent.purpose = 'vehicle_booking' THEN
    UPDATE public.vehicle_bookings
    SET
      status = 'confirmed',
      hold_expires_at = NULL,
      updated_at = now()
    WHERE id = v_intent.reference_id;

  ELSIF v_intent.purpose = 'bulletin_subscription' THEN
    UPDATE public.user_subscriptions
    SET
      status = 'active',
      verified_by = coalesce(v_caller_uid, verified_by),
      payment_ref = coalesce(v_effective_payment_id, payment_ref)
    WHERE id = v_intent.reference_id;

  ELSIF v_intent.purpose = 'bulletin_post_pass' THEN
    UPDATE public.bulletin_post_passes
    SET
      status = 'available',
      verified_by = coalesce(v_caller_uid, verified_by),
      upi_utr_ref = coalesce(v_intent.upi_utr_ref, v_effective_payment_id, upi_utr_ref)
    WHERE id = v_intent.reference_id;

  ELSIF v_intent.purpose IN ('print_order', 'print_order_with_delivery') THEN
    v_print_order_id := COALESCE(v_intent.print_order_id, v_intent.reference_id);

    UPDATE public.print_orders
    SET
      payment_status = 'escrow_held',
      fulfillment_status = CASE
        WHEN fulfillment_status IN ('draft', 'confirmed') THEN 'confirmed'
        ELSE fulfillment_status
      END,
      quote_status = CASE
        WHEN quote_status IN ('unquoted', 'awaiting_shop_quote', 'quoted', 'accepted') THEN 'accepted'
        ELSE quote_status
      END,
      settlement_status = CASE
        WHEN is_first_party_order = false THEN 'locked'
        ELSE 'not_applicable'
      END,
      payment_intent_id = COALESCE(payment_intent_id, v_intent.id),
      updated_at = now()
    WHERE id = v_print_order_id
    RETURNING * INTO v_print_order;

    IF FOUND THEN
      -- If bundled with Pick N Drop delivery, unlock linked delivery order escrow as well
      IF v_intent.purpose = 'print_order_with_delivery'
         AND v_print_order.linked_delivery_order_id IS NOT NULL THEN
        UPDATE public.delivery_orders
        SET
          status = 'escrow_held',
          mediator_id = COALESCE(mediator_id, v_caller_uid),
          updated_at = now()
        WHERE id = v_print_order.linked_delivery_order_id
          AND status IN ('awaiting_payment', 'payment_submitted');
      END IF;

      -- Upsert locked merchant settlement for third-party shops
      IF v_print_order.is_first_party_order = false THEN
        SELECT l.owner_id, l.hub_id
          INTO v_listing_owner_id, v_listing_hub_id
        FROM public.listings l
        WHERE l.id = v_print_order.listing_id;

        IF v_listing_owner_id IS NOT NULL THEN
          v_gross_inr := COALESCE(v_print_order.quoted_amount_inr, v_intent.amount_inr);
          v_fee_inr := COALESCE(v_print_order.platform_fee_inr, 0);
          v_net_inr := GREATEST(0, v_gross_inr - v_fee_inr);

          INSERT INTO public.merchant_settlements (
            hub_id,
            listing_id,
            owner_id,
            print_order_id,
            gross_amount_inr,
            platform_fee_inr,
            net_payable_inr,
            status
          )
          VALUES (
            COALESCE(v_print_order.hub_id, v_listing_hub_id, v_intent.hub_id),
            v_print_order.listing_id,
            v_listing_owner_id,
            v_print_order.id,
            v_gross_inr,
            v_fee_inr,
            v_net_inr,
            'locked'
          )
          ON CONFLICT (print_order_id) DO UPDATE
          SET
            gross_amount_inr = EXCLUDED.gross_amount_inr,
            platform_fee_inr = EXCLUDED.platform_fee_inr,
            net_payable_inr = EXCLUDED.net_payable_inr,
            status = CASE
              WHEN public.merchant_settlements.status = 'settled' THEN 'settled'
              ELSE 'locked'
            END,
            updated_at = now();
        END IF;
      END IF;

      -- Log immutable escrow confirmation event
      INSERT INTO public.print_order_events (
        print_order_id,
        actor_id,
        actor_role,
        event_type,
        metadata
      )
      VALUES (
        v_print_order.id,
        v_caller_uid,
        CASE
          WHEN v_is_service THEN 'payment_webhook'
          WHEN public.is_super_admin() THEN 'super_admin'
          ELSE 'hub_manager'
        END,
        'payment_escrow_confirmed',
        jsonb_build_object(
          'intent_id', v_intent.id,
          'intent_code', v_intent.intent_code,
          'purpose', v_intent.purpose,
          'provider', v_intent.provider,
          'provider_payment_id', v_effective_payment_id,
          'amount_inr', v_intent.amount_inr,
          'is_first_party_order', v_print_order.is_first_party_order
        )
      );
    END IF;

  ELSIF v_intent.purpose = 'print_pro_subscription' THEN
    SELECT
      us.id,
      us.listing_id,
      us.expires_at,
      COALESCE(sp.duration_days, 30) AS duration_days
      INTO v_sub_row
    FROM public.user_subscriptions us
    LEFT JOIN public.subscription_plans sp ON sp.id = us.plan_id
    WHERE us.id = v_intent.reference_id
    FOR UPDATE OF us;

    IF FOUND THEN
      UPDATE public.user_subscriptions
      SET
        status = 'active',
        starts_at = COALESCE(starts_at, now()),
        expires_at = CASE
          WHEN expires_at IS NULL OR expires_at <= now()
            THEN now() + make_interval(days => v_sub_row.duration_days)
          ELSE expires_at
        END,
        verified_by = COALESCE(v_caller_uid, verified_by),
        payment_ref = COALESCE(v_effective_payment_id, payment_ref)
      WHERE id = v_sub_row.id;

      -- Ensure a listing_print_profiles row exists for the linked listing
      IF v_sub_row.listing_id IS NOT NULL THEN
        SELECT l.hub_id
          INTO v_listing_hub_id
        FROM public.listings l
        WHERE l.id = v_sub_row.listing_id;

        IF v_listing_hub_id IS NOT NULL THEN
          INSERT INTO public.listing_print_profiles (
            listing_id,
            hub_id
          )
          VALUES (
            v_sub_row.listing_id,
            v_listing_hub_id
          )
          ON CONFLICT (listing_id) DO NOTHING;
        END IF;
      END IF;
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'already_fulfilled', false,
    'intent_id', v_intent.id,
    'purpose', v_intent.purpose,
    'reference_id', v_intent.reference_id,
    'payment_intent', to_jsonb(v_intent)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.fulfill_payment_intent(uuid, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.fulfill_payment_intent(uuid, text, text) TO service_role;

-- =============================================================================
-- F. Strict Least-Privilege Row Level Security (RLS) Policies
-- =============================================================================

ALTER TABLE public.listing_print_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.print_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.print_order_files ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.print_order_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_settlements ENABLE ROW LEVEL SECURITY;

-- -----------------------------------------------------------------------------
-- F1. public.listing_print_profiles RLS
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Public can view listing print profiles" ON public.listing_print_profiles;
CREATE POLICY "Public can view listing print profiles"
  ON public.listing_print_profiles
  FOR SELECT
  TO anon, authenticated
  USING (true);

DROP POLICY IF EXISTS "Operators and hub managers can insert listing print profiles" ON public.listing_print_profiles;
CREATE POLICY "Operators and hub managers can insert listing print profiles"
  ON public.listing_print_profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.is_print_operator_for(listing_id)
    OR public.is_hub_manager_for(hub_id)
    OR public.is_super_admin()
  );

DROP POLICY IF EXISTS "Operators and hub managers can update listing print profiles" ON public.listing_print_profiles;
CREATE POLICY "Operators and hub managers can update listing print profiles"
  ON public.listing_print_profiles
  FOR UPDATE
  TO authenticated
  USING (
    public.is_print_operator_for(listing_id)
    OR public.is_hub_manager_for(hub_id)
    OR public.is_super_admin()
  )
  WITH CHECK (
    public.is_print_operator_for(listing_id)
    OR public.is_hub_manager_for(hub_id)
    OR public.is_super_admin()
  );

DROP POLICY IF EXISTS "Super admin can delete listing print profiles" ON public.listing_print_profiles;
CREATE POLICY "Super admin can delete listing print profiles"
  ON public.listing_print_profiles
  FOR DELETE
  TO authenticated
  USING (public.is_super_admin());

-- -----------------------------------------------------------------------------
-- F2. public.print_orders RLS
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authorized actors can view print orders metadata" ON public.print_orders;
CREATE POLICY "Authorized actors can view print orders metadata"
  ON public.print_orders
  FOR SELECT
  TO authenticated
  USING (
    customer_id = auth.uid()
    OR public.is_print_operator_for(listing_id)
    OR public.is_hub_manager_for(hub_id)
    OR public.is_super_admin()
  );

DROP POLICY IF EXISTS "Customers can create own print orders" ON public.print_orders;
CREATE POLICY "Customers can create own print orders"
  ON public.print_orders
  FOR INSERT
  TO authenticated
  WITH CHECK (
    customer_id = auth.uid()
  );

DROP POLICY IF EXISTS "Operators can update shop print orders" ON public.print_orders;
CREATE POLICY "Operators can update shop print orders"
  ON public.print_orders
  FOR UPDATE
  TO authenticated
  USING (
    public.is_print_operator_for(listing_id)
    OR (customer_id = auth.uid() AND fulfillment_status = 'draft')
  )
  WITH CHECK (
    public.is_print_operator_for(listing_id)
    OR (customer_id = auth.uid() AND fulfillment_status IN ('draft', 'cancelled'))
  );

-- -----------------------------------------------------------------------------
-- F3. public.print_order_files RLS (ZERO HUB MANAGER / MODERATOR ACCESS)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Strict customer and active shop operator file read" ON public.print_order_files;
CREATE POLICY "Strict customer and active shop operator file read"
  ON public.print_order_files
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.print_orders po
      WHERE po.id = print_order_files.print_order_id
        AND (
          po.customer_id = auth.uid()
          OR (
            public.is_print_operator_for(po.listing_id)
            AND po.fulfillment_status IN ('confirmed', 'printing', 'ready_for_pickup')
            AND po.files_purged_at IS NULL
          )
        )
    )
  );

DROP POLICY IF EXISTS "Customer can attach files to own draft or confirmed print order" ON public.print_order_files;
CREATE POLICY "Customer can attach files to own draft or confirmed print order"
  ON public.print_order_files
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.print_orders po
      WHERE po.id = print_order_files.print_order_id
        AND po.customer_id = auth.uid()
        AND po.fulfillment_status IN ('draft', 'confirmed')
        AND po.files_purged_at IS NULL
    )
  );

-- Note: No UPDATE/DELETE policies for client roles on print_order_files;
--       48h automated purge runs via service_role server job.

-- -----------------------------------------------------------------------------
-- F4. public.print_order_events RLS (Immutable Append-Only Audit Log)
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Authorized actors can view print order events" ON public.print_order_events;
CREATE POLICY "Authorized actors can view print order events"
  ON public.print_order_events
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.print_orders po
      WHERE po.id = print_order_events.print_order_id
        AND (
          po.customer_id = auth.uid()
          OR public.is_print_operator_for(po.listing_id)
          OR public.is_hub_manager_for(po.hub_id)
          OR public.is_super_admin()
        )
    )
  );

DROP POLICY IF EXISTS "Authorized actors can append print order events" ON public.print_order_events;
CREATE POLICY "Authorized actors can append print order events"
  ON public.print_order_events
  FOR INSERT
  TO authenticated
  WITH CHECK (
    actor_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.print_orders po
      WHERE po.id = print_order_events.print_order_id
        AND (
          po.customer_id = auth.uid()
          OR public.is_print_operator_for(po.listing_id)
          OR public.is_hub_manager_for(po.hub_id)
          OR public.is_super_admin()
        )
    )
  );

-- Zero UPDATE / DELETE policies on print_order_events (immutable audit trail)

-- -----------------------------------------------------------------------------
-- F5. public.merchant_settlements RLS
-- -----------------------------------------------------------------------------
DROP POLICY IF EXISTS "Owners hub managers and super admin can view settlements" ON public.merchant_settlements;
CREATE POLICY "Owners hub managers and super admin can view settlements"
  ON public.merchant_settlements
  FOR SELECT
  TO authenticated
  USING (
    owner_id = auth.uid()
    OR public.is_hub_manager_for(hub_id)
    OR public.is_super_admin()
  );

DROP POLICY IF EXISTS "Super admin full access to merchant settlements" ON public.merchant_settlements;
CREATE POLICY "Super admin full access to merchant settlements"
  ON public.merchant_settlements
  FOR ALL
  TO authenticated
  USING (public.is_super_admin())
  WITH CHECK (public.is_super_admin());
