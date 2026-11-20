-- =============================================================================
-- Migration: 20261119_phase64a_master_config_and_razorpay.sql
-- Phase 64-A: Master Config Backend, Editable Taxonomy & Helpbot CMS,
--             Promo Codes, Idempotent Fulfillment & Dual-Mode Razorpay Support
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 0. Idempotent Role & Updated-At Helpers
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.is_super_admin(p_uid uuid)
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
      AND p.role = 'super_admin'
  );
$$;

CREATE OR REPLACE FUNCTION public.set_phase64_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- =============================================================================
-- 1. Seed / Expand `public.platform_settings` JSONB Keys (Idempotent)
--    SECURITY: Never store RAZORPAY_KEY_SECRET or RAZORPAY_WEBHOOK_SECRET here.
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.platform_settings (
  key text PRIMARY KEY,
  value jsonb NOT NULL,
  updated_by uuid REFERENCES public.profiles(id),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE public.platform_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Public can read platform settings" ON public.platform_settings;
CREATE POLICY "Public can read platform settings"
  ON public.platform_settings
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Only super_admin can update platform settings" ON public.platform_settings;
CREATE POLICY "Only super_admin can update platform settings"
  ON public.platform_settings
  FOR UPDATE
  TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Only super_admin can insert platform settings" ON public.platform_settings;
CREATE POLICY "Only super_admin can insert platform settings"
  ON public.platform_settings
  FOR INSERT
  TO authenticated
  WITH CHECK (public.is_super_admin(auth.uid()));

DROP POLICY IF EXISTS "Only super_admin can delete platform settings" ON public.platform_settings;
CREATE POLICY "Only super_admin can delete platform settings"
  ON public.platform_settings
  FOR DELETE
  TO authenticated
  USING (public.is_super_admin(auth.uid()));

INSERT INTO public.platform_settings (key, value)
VALUES
  (
    'app_identity',
    '{
      "app_name": "PrintSwift Local",
      "short_name": "PrintSwift",
      "tagline": "Discover, trade, and move across Churachandpur.",
      "logo_light_url": null,
      "logo_dark_url": null,
      "favicon_url": null,
      "announcement_bar": {
        "enabled": false,
        "text": "",
        "link_url": "",
        "variant": "info"
      }
    }'::jsonb
  ),
  (
    'office_and_contact',
    '{
      "address": "Central Lamka, Churachandpur, Manipur 795128",
      "lat": 24.3333,
      "lng": 93.6833,
      "phone": "",
      "whatsapp": "",
      "email": "",
      "operating_hours": "Mon–Sat, 8:00 AM – 8:00 PM",
      "whatsapp_enquiry_template": "Hi, I found your listing on PrintSwift Local: {{title}}"
    }'::jsonb
  ),
  (
    'payment_config',
    '{
      "payment_mode": "manual_only",
      "razorpay_enabled": false,
      "manual_upi_enabled": true,
      "default_method": "manual_upi",
      "razorpay_key_id": "",
      "upi_id": "",
      "upi_payee_name": "PrintSwift Local",
      "online_convenience_fee_pct": 0,
      "pick_n_drop_commission_pct": 12,
      "vehicle_booking_commission_pct": 10,
      "default_advance_pct": 25,
      "soft_hold_minutes": 20,
      "pod_purge_hours": 48
    }'::jsonb
  ),
  (
    'operations_config',
    '{
      "hide_sample_data": false,
      "geofence": {
        "center_lat": 24.3333,
        "center_lng": 93.6833,
        "default_zoom": 14,
        "service_radius_km": 25
      },
      "search_placeholders": [
        "Search shops, pharmacies, Tuibong...",
        "Find Bolero rentals or LPG pickup..."
      ],
      "trending_suggestions": [
        "New Lamka",
        "Pharmacy",
        "Printing",
        "Real Estate",
        "Taxi"
      ],
      "prohibited_items": [
        "Cash & Jewelry",
        "Illegal or Restricted Substances",
        "Flammable Fuels (excluding sealed LPG)",
        "Live Animals"
      ],
      "module_switches": {
        "explore": { "enabled": true, "pause_message": "" },
        "marketplace": { "enabled": true, "pause_message": "" },
        "bulletin": { "enabled": true, "pause_message": "" },
        "pick_n_drop": { "enabled": true, "pause_message": "" },
        "vehicle_bookings": { "enabled": true, "pause_message": "" }
      }
    }'::jsonb
  ),
  (
    'pricing_surcharges',
    '{
      "fragile_crate_inr": 30,
      "bulk_sack_inr": 50,
      "extra_cylinder_inr": 20,
      "bulletin_single_post_inr": 79,
      "bulletin_single_post_days": 7
    }'::jsonb
  ),
  (
    'legal_pages',
    '{
      "terms_md": "# Terms & Conditions\n\nWelcome to **PrintSwift Local**, Churachandpur''s community discovery, marketplace, bulletin, and Pick N Drop platform.\n\n## 1. Platform Usage\n- Listings, marketplace products, bulletins, and vehicle charters must represent accurate local offerings within Churachandpur district.\n- Users must not list illegal, restricted, or misleading items.\n\n## 2. Pick N Drop & Vehicle Bookings\n- Fare quotes are calculated transparently based on route distance, vehicle class, and applicable surcharges.\n- Handover OTPs must be shared only in person during pickup and delivery confirmation.\n\n## 3. Payments & Verification\n- All platform payments are processed via verified Manual UPI escrow or authorized online payment gateways.\n- Fraudulent or reused UTR submissions result in immediate account suspension.",
      "privacy_md": "# Privacy Policy\n\nPrintSwift Local respects your privacy and minimizes data retention.\n\n## 1. Data Collected\n- Account profile details (name, email, phone) used to coordinate local enquiries, bookings, and deliveries.\n- Pickup/drop-off coordinates and contact details shared strictly with assigned drivers and administrators during active orders.\n\n## 2. Proof of Delivery & Payment Proofs\n- Delivery POD photos are automatically purged after the configured retention window (default 48 hours).\n- Payment receipts are stored privately for verification and dispute resolution.",
      "refund_policy_md": "# Refund & Cancellation Policy\n\n## 1. Pick N Drop Deliveries\n- Orders cancelled before driver assignment are eligible for a full refund via UPI or original payment source.\n- Disputed deliveries held in escrow are reviewed by our local Churachandpur support desk before payout or refund.\n\n## 2. Vehicle Bookings\n- Advance deposits secure your scheduled slot. Cancellations made at least 12 hours prior to trip start qualify for full advance refund.\n\n## 3. Bulletin Subscriptions & Passes\n- Unused single-post passes rejected during moderation are refunded in full. Active subscriptions are non-refundable once published quota is consumed.",
      "updated_at": "2026-11-19T00:00:00Z"
    }'::jsonb
  )
ON CONFLICT (key) DO NOTHING;

-- =============================================================================
-- 2. Editable Taxonomy, Helpbot CMS & Promo Tables
-- =============================================================================

-- 2a. public.app_categories
CREATE TABLE IF NOT EXISTS public.app_categories (
  slug text PRIMARY KEY,
  module text NOT NULL CHECK (module IN ('explore', 'marketplace', 'bulletin')),
  display_name text NOT NULL,
  icon text DEFAULT 'Tag',
  color_hex text DEFAULT '#2563EB',
  sort_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_categories_module_active_sort
  ON public.app_categories (module, is_active, sort_order);

DROP TRIGGER IF EXISTS trg_app_categories_updated_at ON public.app_categories;
CREATE TRIGGER trg_app_categories_updated_at
  BEFORE UPDATE ON public.app_categories
  FOR EACH ROW
  EXECUTE FUNCTION public.set_phase64_updated_at();

INSERT INTO public.app_categories (slug, module, display_name, icon, color_hex, sort_order, is_active)
VALUES
  -- Explore categories
  ('businesses_shops', 'explore', 'Businesses & Shops', 'Store', '#2563EB', 10, true),
  ('services', 'explore', 'Services', 'Wrench', '#0D9488', 20, true),
  ('real_estate', 'explore', 'Real Estate', 'Home', '#D97706', 30, true),
  ('public_community', 'explore', 'Public & Community', 'Landmark', '#7C3AED', 40, true),
  ('retail_shopping', 'explore', 'Retail & Shopping', 'ShoppingBag', '#EC4899', 50, true),
  ('print_digital', 'explore', 'Print & Digital', 'Printer', '#4F46E5', 60, true),
  ('vehicles_rentals', 'explore', 'Vehicles & Rentals', 'Car', '#059669', 70, true),
  -- Marketplace categories
  ('mkt_printing_signage', 'marketplace', 'Printing & Signage', 'Printer', '#4F46E5', 10, true),
  ('mkt_bakery_food', 'marketplace', 'Bakery & Food', 'UtensilsCrossed', '#EA580C', 20, true),
  ('mkt_hardware', 'marketplace', 'Hardware', 'Hammer', '#475569', 30, true),
  ('mkt_handloom_apparel', 'marketplace', 'Handloom & Apparel', 'Shirt', '#DB2777', 40, true),
  ('mkt_electronics_solar', 'marketplace', 'Electronics & Solar', 'Zap', '#0284C7', 50, true),
  ('mkt_furniture', 'marketplace', 'Furniture', 'Armchair', '#92400E', 60, true),
  ('mkt_books_stationery', 'marketplace', 'Books & Stationery', 'BookOpen', '#2563EB', 70, true),
  ('mkt_groceries_pantry', 'marketplace', 'Groceries & Pantry', 'ShoppingBasket', '#16A34A', 80, true),
  -- Bulletin categories
  ('announcement', 'bulletin', 'Announcement', 'Megaphone', '#2563EB', 10, true),
  ('job', 'bulletin', 'Job', 'Briefcase', '#059669', 20, true),
  ('advertisement', 'bulletin', 'Advertisement', 'Sparkles', '#D97706', 30, true),
  ('notice', 'bulletin', 'Notice', 'Bell', '#DC2626', 40, true),
  ('event', 'bulletin', 'Event', 'Calendar', '#7C3AED', 50, true)
ON CONFLICT (slug) DO NOTHING;

-- 2b. public.app_localities
CREATE TABLE IF NOT EXISTS public.app_localities (
  slug text PRIMARY KEY,
  display_name text NOT NULL,
  lat double precision NOT NULL,
  lng double precision NOT NULL,
  sort_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_localities_active_sort
  ON public.app_localities (is_active, sort_order);

DROP TRIGGER IF EXISTS trg_app_localities_updated_at ON public.app_localities;
CREATE TRIGGER trg_app_localities_updated_at
  BEFORE UPDATE ON public.app_localities
  FOR EACH ROW
  EXECUTE FUNCTION public.set_phase64_updated_at();

INSERT INTO public.app_localities (slug, display_name, lat, lng, sort_order, is_active)
VALUES
  ('central_lamka', 'Central Lamka', 24.3333, 93.6978, 10, true),
  ('new_lamka', 'New Lamka', 24.3412, 93.7024, 20, true),
  ('tuibong', 'Tuibong', 24.3515, 93.7082, 30, true),
  ('rengkai', 'Rengkai', 24.3358, 93.6815, 40, true),
  ('zenhang_lamka', 'Zenhang Lamka', 24.3248, 93.6942, 50, true),
  ('hebron_veng', 'Hebron Veng', 24.3446, 93.7061, 60, true),
  ('bijang', 'Bijang', 24.3472, 93.6924, 70, true),
  ('lanva', 'Lanva', 24.3195, 93.6890, 80, true)
ON CONFLICT (slug) DO NOTHING;

-- 2c. public.helpbot_faqs
CREATE TABLE IF NOT EXISTS public.helpbot_faqs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category text NOT NULL DEFAULT 'General',
  question text NOT NULL,
  answer text NOT NULL,
  keywords text[] DEFAULT '{}',
  deep_link_url text,
  sort_order integer DEFAULT 0,
  is_active boolean DEFAULT true,
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_helpbot_faqs_active_sort
  ON public.helpbot_faqs (is_active, sort_order);

DROP TRIGGER IF EXISTS trg_helpbot_faqs_updated_at ON public.helpbot_faqs;
CREATE TRIGGER trg_helpbot_faqs_updated_at
  BEFORE UPDATE ON public.helpbot_faqs
  FOR EACH ROW
  EXECUTE FUNCTION public.set_phase64_updated_at();

INSERT INTO public.helpbot_faqs (id, category, question, answer, keywords, deep_link_url, sort_order, is_active)
VALUES
  (
    'a6400000-0000-4000-8000-000000000001',
    'Explore',
    'How do I find verified shops, services, and rentals near me on the Explore Map?',
    'Open the Explore Map, pick a category pill such as Businesses & Shops, Real Estate, or Vehicles & Rentals, or search by locality like New Lamka or Tuibong. Tap any map pin or card to view hours, directions, WhatsApp contact, and 360° previews.',
    ARRAY['map', 'explore', 'shops', 'nearby', 'directions', 'locality', 'tuibong', 'lamka'],
    '/explore',
    10,
    true
  ),
  (
    'a6400000-0000-4000-8000-000000000002',
    'Pick N Drop',
    'How do Pick N Drop pickup and delivery OTPs protect my parcel or LPG order?',
    'Every Pick N Drop order generates two unique 6-digit OTPs: a Pickup OTP shared with the driver only when handing over the item, and a Delivery OTP shared by the recipient only after inspecting the delivered parcel or cylinder. Escrow funds release to the driver only after Delivery OTP confirmation.',
    ARRAY['otp', 'pick n drop', 'delivery', 'parcel', 'lpg', 'escrow', 'driver', 'safe'],
    '/pick-n-drop',
    20,
    true
  ),
  (
    'a6400000-0000-4000-8000-000000000003',
    'Payments',
    'How do Manual UPI and Razorpay online payments work on PrintSwift Local?',
    'At checkout, you can pay using Manual UPI (1-tap UPI app link or QR code followed by entering your 12-digit UTR reference for Super-Admin verification) or via Razorpay instant checkout whenever online gateway payments are enabled by the administrator.',
    ARRAY['upi', 'utr', 'razorpay', 'payment', 'qr', 'verify', 'refund', 'pay'],
    '/saved',
    30,
    true
  ),
  (
    'a6400000-0000-4000-8000-000000000004',
    'Vehicles',
    'How do I reserve a Bolero charter, local taxi, or Lamka–Imphal Winger seat?',
    'Filter Explore by Vehicles & Rentals, open a vehicle listing, choose Full Vehicle or Per-Seat mode, pick your route or hourly/daily tariff, and select your dates. Our scheduler blocks conflicts automatically and holds your slot for 20 minutes while you pay the partial advance deposit.',
    ARRAY['vehicle', 'bolero', 'winger', 'taxi', 'seat', 'imphal', 'rental', 'booking', 'charter'],
    '/explore?category=vehicles_rentals',
    40,
    true
  ),
  (
    'a6400000-0000-4000-8000-000000000005',
    'Bulletin',
    'What is the difference between a Bulletin Single Post Pass and a Monthly Plan?',
    'A Pay-Per-Post Single Pass lets you publish one community bulletin, job alert, or local advertisement (default ₹79 for 7 days) without a recurring plan. Monthly Subscription Plans are ideal for schools, churches, and businesses posting multiple updates with higher image limits and YouTube embeds.',
    ARRAY['bulletin', 'pass', 'post', 'subscription', 'job', 'announcement', 'price', '79'],
    '/bulletin',
    50,
    true
  ),
  (
    'a6400000-0000-4000-8000-000000000006',
    'Shop Owners',
    'How can I register my Churachandpur shop, products, or vehicle on PrintSwift Local?',
    'Sign in to your account and open the Workspace hub. Business owners can add map listings, upload Marketplace product catalogues, and assign staff; drivers and fleet owners can list vehicles, set fixed routes, and manage offline-booking calendar blocks.',
    ARRAY['register', 'owner', 'shop', 'list', 'onboarding', 'workspace', 'marketplace', 'driver'],
    '/workspace',
    60,
    true
  )
ON CONFLICT (id) DO NOTHING;

-- 2d. public.promo_codes
CREATE TABLE IF NOT EXISTS public.promo_codes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text UNIQUE NOT NULL,
  description text,
  discount_type text NOT NULL CHECK (discount_type IN ('flat', 'percent')),
  discount_value numeric(10,2) NOT NULL CHECK (discount_value > 0),
  max_discount_inr numeric(10,2),
  min_order_inr numeric(10,2) DEFAULT 0,
  applies_to text[] NOT NULL DEFAULT ARRAY[
    'pick_n_drop',
    'vehicle_booking',
    'bulletin_subscription',
    'bulletin_post_pass'
  ],
  max_uses integer,
  used_count integer NOT NULL DEFAULT 0,
  starts_at timestamptz DEFAULT now(),
  expires_at timestamptz,
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_promo_codes_code_upper
  ON public.promo_codes (upper(code));

CREATE INDEX IF NOT EXISTS idx_promo_codes_active_window
  ON public.promo_codes (is_active, starts_at, expires_at);

-- -----------------------------------------------------------------------------
-- 3. Row-Level Security on CMS & Promo Tables
-- -----------------------------------------------------------------------------
ALTER TABLE public.app_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_localities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.helpbot_faqs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.promo_codes ENABLE ROW LEVEL SECURITY;

-- app_categories
DROP POLICY IF EXISTS "Public reads active app categories" ON public.app_categories;
CREATE POLICY "Public reads active app categories"
  ON public.app_categories
  FOR SELECT
  USING (is_active = true);

DROP POLICY IF EXISTS "Super admin manages all app categories" ON public.app_categories;
CREATE POLICY "Super admin manages all app categories"
  ON public.app_categories
  FOR ALL
  TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- app_localities
DROP POLICY IF EXISTS "Public reads active app localities" ON public.app_localities;
CREATE POLICY "Public reads active app localities"
  ON public.app_localities
  FOR SELECT
  USING (is_active = true);

DROP POLICY IF EXISTS "Super admin manages all app localities" ON public.app_localities;
CREATE POLICY "Super admin manages all app localities"
  ON public.app_localities
  FOR ALL
  TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- helpbot_faqs
DROP POLICY IF EXISTS "Public reads active helpbot faqs" ON public.helpbot_faqs;
CREATE POLICY "Public reads active helpbot faqs"
  ON public.helpbot_faqs
  FOR SELECT
  USING (is_active = true);

DROP POLICY IF EXISTS "Super admin manages all helpbot faqs" ON public.helpbot_faqs;
CREATE POLICY "Super admin manages all helpbot faqs"
  ON public.helpbot_faqs
  FOR ALL
  TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- promo_codes (No public SELECT dump; authenticated users validate via RPC only)
DROP POLICY IF EXISTS "Super admin manages all promo codes" ON public.promo_codes;
CREATE POLICY "Super admin manages all promo codes"
  ON public.promo_codes
  FOR ALL
  TO authenticated
  USING (public.is_super_admin(auth.uid()))
  WITH CHECK (public.is_super_admin(auth.uid()));

-- =============================================================================
-- 4. Upgrade `public.payment_intents` & Atomic SECURITY DEFINER RPCs
-- =============================================================================
ALTER TABLE public.payment_intents
  ADD COLUMN IF NOT EXISTS base_amount_inr numeric(10,2),
  ADD COLUMN IF NOT EXISTS discount_inr numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS convenience_fee_inr numeric(10,2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS promo_code_id uuid REFERENCES public.promo_codes(id) ON DELETE SET NULL;

UPDATE public.payment_intents
SET base_amount_inr = amount_inr
WHERE base_amount_inr IS NULL;

CREATE INDEX IF NOT EXISTS idx_payment_intents_promo_code
  ON public.payment_intents (promo_code_id)
  WHERE promo_code_id IS NOT NULL;

-- Harden payment_intents user-update guard trigger to also protect new pricing/promo columns
CREATE OR REPLACE FUNCTION public.guard_payment_intent_user_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF current_setting('role', true) = 'service_role'
     OR public.is_super_admin(auth.uid()) THEN
    RETURN NEW;
  END IF;

  IF OLD.status <> 'awaiting_payment' THEN
    RAISE EXCEPTION 'Payment intent can only be updated while awaiting payment.'
      USING ERRCODE = '42501';
  END IF;

  IF NEW.intent_code IS DISTINCT FROM OLD.intent_code
     OR NEW.user_id IS DISTINCT FROM OLD.user_id
     OR NEW.purpose IS DISTINCT FROM OLD.purpose
     OR NEW.reference_id IS DISTINCT FROM OLD.reference_id
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

-- 4a. Strictly Idempotent fulfill_payment_intent(p_intent_id, p_provider_payment_id, p_provider)
-- Drop previous 2-argument signature first so 2-arg and 3-arg calls resolve cleanly without ambiguity.
DROP FUNCTION IF EXISTS public.fulfill_payment_intent(uuid, text);

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
BEGIN
  IF NOT v_is_service AND NOT public.is_super_admin(v_caller_uid) THEN
    RAISE EXCEPTION 'Forbidden: Only Super Admin or verified payment webhook may fulfill payment intents.'
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
      tx_type,
      amount_inr,
      upi_utr_ref,
      payment_proof_path,
      recorded_by,
      notes
    )
    VALUES (
      v_intent.reference_id,
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

-- 4b. Promo Validation RPC (`validate_and_apply_promo`)
CREATE OR REPLACE FUNCTION public.validate_and_apply_promo(
  p_intent_id uuid,
  p_code text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_uid uuid := auth.uid();
  v_clean_code text := upper(trim(coalesce(p_code, '')));
  v_intent public.payment_intents%ROWTYPE;
  v_promo public.promo_codes%ROWTYPE;
  v_base_amount numeric(10,2);
  v_discount numeric(10,2) := 0;
  v_net_amount numeric(10,2);
  v_final_amount numeric(10,2);
BEGIN
  IF v_caller_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required to apply a promo code.'
      USING ERRCODE = '42501';
  END IF;

  IF length(v_clean_code) < 2 THEN
    RAISE EXCEPTION 'Please enter a valid promo code.'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_intent
  FROM public.payment_intents
  WHERE id = p_intent_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Payment intent not found.'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_intent.user_id <> v_caller_uid THEN
    RAISE EXCEPTION 'Forbidden: You do not own this payment intent.'
      USING ERRCODE = '42501';
  END IF;

  IF v_intent.status <> 'awaiting_payment' THEN
    RAISE EXCEPTION 'Promo codes can only be applied while awaiting payment.'
      USING ERRCODE = 'P0001';
  END IF;

  IF v_intent.expires_at IS NOT NULL AND v_intent.expires_at < now() THEN
    RAISE EXCEPTION 'This payment session has expired.'
      USING ERRCODE = 'P0001';
  END IF;

  SELECT *
    INTO v_promo
  FROM public.promo_codes
  WHERE upper(code) = v_clean_code
  FOR UPDATE;

  IF NOT FOUND OR coalesce(v_promo.is_active, false) = false THEN
    RAISE EXCEPTION 'Promo code "%" is invalid or inactive.', v_clean_code
      USING ERRCODE = 'P0002';
  END IF;

  IF v_promo.starts_at IS NOT NULL AND v_promo.starts_at > now() THEN
    RAISE EXCEPTION 'Promo code "%" is not active yet.', v_clean_code
      USING ERRCODE = 'P0001';
  END IF;

  IF v_promo.expires_at IS NOT NULL AND v_promo.expires_at < now() THEN
    RAISE EXCEPTION 'Promo code "%" has expired.', v_clean_code
      USING ERRCODE = 'P0001';
  END IF;

  IF v_promo.max_uses IS NOT NULL AND v_promo.used_count >= v_promo.max_uses THEN
    RAISE EXCEPTION 'Promo code "%" has reached its redemption limit.', v_clean_code
      USING ERRCODE = 'P0001';
  END IF;

  IF NOT (v_intent.purpose = ANY(v_promo.applies_to)) THEN
    RAISE EXCEPTION 'Promo code "%" does not apply to this payment category.', v_clean_code
      USING ERRCODE = 'P0001';
  END IF;

  v_base_amount := coalesce(v_intent.base_amount_inr, v_intent.amount_inr);

  IF v_base_amount < coalesce(v_promo.min_order_inr, 0) THEN
    RAISE EXCEPTION 'Minimum order of ₹% is required for promo code "%".',
      trim(to_char(v_promo.min_order_inr, 'FM999999990.##')), v_clean_code
      USING ERRCODE = 'P0001';
  END IF;

  IF v_promo.discount_type = 'flat' THEN
    v_discount := round(v_promo.discount_value::numeric, 2);
  ELSE
    v_discount := round((v_base_amount * (v_promo.discount_value / 100.0))::numeric, 2);
  END IF;

  IF v_promo.max_discount_inr IS NOT NULL AND v_discount > v_promo.max_discount_inr THEN
    v_discount := round(v_promo.max_discount_inr::numeric, 2);
  END IF;

  IF v_discount > v_base_amount THEN
    v_discount := v_base_amount;
  END IF;

  v_discount := greatest(0, v_discount);
  v_net_amount := greatest(0, round((v_base_amount - v_discount)::numeric, 2));
  v_final_amount := round((v_net_amount + coalesce(v_intent.convenience_fee_inr, 0))::numeric, 2);

  UPDATE public.payment_intents
  SET
    base_amount_inr = v_base_amount,
    discount_inr = v_discount,
    promo_code_id = v_promo.id,
    amount_inr = v_final_amount,
    updated_at = now()
  WHERE id = p_intent_id
  RETURNING * INTO v_intent;

  RETURN jsonb_build_object(
    'ok', true,
    'intent_id', v_intent.id,
    'promo_code_id', v_promo.id,
    'code', v_promo.code,
    'description', v_promo.description,
    'base_amount_inr', v_base_amount,
    'discount_inr', v_discount,
    'convenience_fee_inr', v_intent.convenience_fee_inr,
    'amount_inr', v_final_amount,
    'payment_intent', to_jsonb(v_intent)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.validate_and_apply_promo(uuid, text) TO authenticated;

-- 4c. Super-Admin Subscription Override RPC (`superadmin_override_user_subscription`)
CREATE OR REPLACE FUNCTION public.superadmin_override_user_subscription(
  p_user_id uuid,
  p_plan_id uuid,
  p_starts_at timestamptz,
  p_expires_at timestamptz,
  p_status text,
  p_subscription_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_uid uuid := auth.uid();
  v_clean_status text := lower(trim(coalesce(p_status, '')));
  v_sub public.user_subscriptions%ROWTYPE;
BEGIN
  IF NOT public.is_super_admin(v_caller_uid) THEN
    RAISE EXCEPTION 'Forbidden: Only Super Admin may override user subscriptions.'
      USING ERRCODE = '42501';
  END IF;

  IF v_clean_status NOT IN ('pending_payment', 'active', 'expired', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid subscription status: %.', v_clean_status
      USING ERRCODE = '22023';
  END IF;

  IF p_starts_at IS NULL OR p_expires_at IS NULL OR p_expires_at <= p_starts_at THEN
    RAISE EXCEPTION 'Valid starts_at and expires_at (expires_at > starts_at) are required.'
      USING ERRCODE = '22023';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = p_user_id) THEN
    RAISE EXCEPTION 'Target user profile not found.'
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.subscription_plans WHERE id = p_plan_id) THEN
    RAISE EXCEPTION 'Target subscription plan not found.'
      USING ERRCODE = 'P0002';
  END IF;

  IF p_subscription_id IS NOT NULL THEN
    UPDATE public.user_subscriptions
    SET
      plan_id = p_plan_id,
      starts_at = p_starts_at,
      expires_at = p_expires_at,
      status = v_clean_status,
      verified_by = v_caller_uid
    WHERE id = p_subscription_id
      AND user_id = p_user_id
    RETURNING * INTO v_sub;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Subscription record not found for specified user.'
        USING ERRCODE = 'P0002';
    END IF;
  ELSE
    INSERT INTO public.user_subscriptions (
      user_id,
      plan_id,
      status,
      starts_at,
      expires_at,
      payment_ref,
      verified_by
    )
    VALUES (
      p_user_id,
      p_plan_id,
      v_clean_status,
      p_starts_at,
      p_expires_at,
      'SUPERADMIN_OVERRIDE',
      v_caller_uid
    )
    RETURNING * INTO v_sub;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'subscription', to_jsonb(v_sub)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.superadmin_override_user_subscription(
  uuid, uuid, timestamptz, timestamptz, text, uuid
) TO authenticated;
