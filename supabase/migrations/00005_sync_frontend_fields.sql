-- INSTRUCTION: Copy and run this entire file in your Supabase SQL Editor to synchronize all frontend TypeScript interfaces and Supabase queries with your PostgreSQL schema.
-- This migration is idempotent (safe to re-run) and preserves all existing tables and data.

-- ============================================================================
-- 1. SYNC public.listings (Restores dropped fields & adds all Listing fields)
-- ============================================================================
ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS category text DEFAULT 'business',
  ADD COLUMN IF NOT EXISTS subcategory text DEFAULT 'General',
  ADD COLUMN IF NOT EXISTS price numeric,
  ADD COLUMN IF NOT EXISTS short_description text DEFAULT '',
  ADD COLUMN IF NOT EXISTS locality text DEFAULT 'New Lamka',
  ADD COLUMN IF NOT EXISTS coordinates jsonb DEFAULT '{"lat": 24.3335, "lng": 93.6978}'::jsonb,
  ADD COLUMN IF NOT EXISTS owner_name text DEFAULT 'Listing Owner',
  ADD COLUMN IF NOT EXISTS contact_phone text DEFAULT '',
  ADD COLUMN IF NOT EXISTS contact_email text,
  ADD COLUMN IF NOT EXISTS cover_image text DEFAULT '',
  ADD COLUMN IF NOT EXISTS gallery_images jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS verification_status text DEFAULT 'unverified_sample',
  ADD COLUMN IF NOT EXISTS assigned_staff_ids jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS rating numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS review_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS views_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS map_impressions_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS detail_visits_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS follows_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS enquiries_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS direction_clicks_count integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS change_request_note text,
  ADD COLUMN IF NOT EXISTS is_featured_demo boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS custom_fields jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS business_details jsonb,
  ADD COLUMN IF NOT EXISTS service_details jsonb,
  ADD COLUMN IF NOT EXISTS real_estate_details jsonb,
  ADD COLUMN IF NOT EXISTS sports_details jsonb,
  ADD COLUMN IF NOT EXISTS public_place_details jsonb,
  ADD COLUMN IF NOT EXISTS version_history jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;

-- Ensure owner CRUD & read policies exist on public.listings
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'listings'
      AND policyname = 'Allow owners to read own listings'
  ) THEN
    CREATE POLICY "Allow owners to read own listings"
      ON public.listings
      FOR SELECT
      USING (auth.uid() = owner_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'listings'
      AND policyname = 'Allow owners to insert own listings'
  ) THEN
    CREATE POLICY "Allow owners to insert own listings"
      ON public.listings
      FOR INSERT
      WITH CHECK (auth.uid() = owner_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'listings'
      AND policyname = 'Allow owners to update own listings'
  ) THEN
    CREATE POLICY "Allow owners to update own listings"
      ON public.listings
      FOR UPDATE
      USING (auth.uid() = owner_id)
      WITH CHECK (auth.uid() = owner_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'listings'
      AND policyname = 'Allow owners to delete own listings'
  ) THEN
    CREATE POLICY "Allow owners to delete own listings"
      ON public.listings
      FOR DELETE
      USING (auth.uid() = owner_id);
  END IF;
END $$;

-- ============================================================================
-- 2. SYNC public.categories (UI Color Tokens, Short Codes, Icons, Ordering)
-- ============================================================================
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS color_bg text DEFAULT '#3b82f6',
  ADD COLUMN IF NOT EXISTS color_border text DEFAULT '#1d4ed8',
  ADD COLUMN IF NOT EXISTS color_text text DEFAULT '#ffffff',
  ADD COLUMN IF NOT EXISTS short_code text,
  ADD COLUMN IF NOT EXISTS icon_name text,
  ADD COLUMN IF NOT EXISTS is_active boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;

INSERT INTO public.categories (name, slug, description, type, color_bg, color_border, color_text, short_code, icon_name, sort_order)
VALUES
  ('Businesses & Shops', 'business', 'Local retail stores, eateries, print shops, and commercial enterprises.', 'business', '#0284c7', '#075985', '#ffffff', 'B', 'Briefcase', 1),
  ('Services', 'service', 'Skilled trades, home repairs, consultants, and local service providers.', 'service', '#7c3aed', '#4c1d95', '#ffffff', 'S', 'Wrench', 2),
  ('Real Estate', 'real_estate', 'Land plots, houses, apartments, commercial units, and PG rooms.', 'real_estate', '#059669', '#064e3b', '#ffffff', 'RE', 'Home', 3),
  ('Sports & Recreation', 'sports', 'Turf courts, stadiums, fitness complexes, and outdoor grounds.', 'sports', '#ea580c', '#9a3412', '#ffffff', 'SP', 'Trophy', 4),
  ('Public & Community Places', 'public_place', 'Hospitals, schools, government offices, community halls, and landmarks.', 'public_place', '#dc2626', '#991b1b', '#ffffff', 'P', 'Landmark', 5)
ON CONFLICT (slug) DO NOTHING;

-- ============================================================================
-- 3. SYNC public.profiles (UserAccount, Role Types, Saved Listings, Socials)
-- ============================================================================
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS role_type text DEFAULT 'visitor',
  ADD COLUMN IF NOT EXISTS admin_role text,
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS joined_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS avatar_label text,
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS saved_listing_ids jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS social_links jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS preferences jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- ============================================================================
-- 4. SYNC public.business_listings (BusinessDetails & Catalogue/Socials)
-- ============================================================================
ALTER TABLE public.business_listings
  ADD COLUMN IF NOT EXISTS subcategory text,
  ADD COLUMN IF NOT EXISTS opening_hours_text text,
  ADD COLUMN IF NOT EXISTS price_range text,
  ADD COLUMN IF NOT EXISTS delivery_info text,
  ADD COLUMN IF NOT EXISTS established_year integer,
  ADD COLUMN IF NOT EXISTS highlights jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS catalogue jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS social_links jsonb DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS whatsapp_number text;

-- ============================================================================
-- 5. SYNC public.service_listings (ServiceDetails)
-- ============================================================================
ALTER TABLE public.service_listings
  ADD COLUMN IF NOT EXISTS service_type text,
  ADD COLUMN IF NOT EXISTS areas_served jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS working_hours text,
  ADD COLUMN IF NOT EXISTS availability_status text DEFAULT 'Available Today',
  ADD COLUMN IF NOT EXISTS price_range_text text,
  ADD COLUMN IF NOT EXISTS experience_years integer,
  ADD COLUMN IF NOT EXISTS work_samples jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS certifications_label text;

-- ============================================================================
-- 6. SYNC public.real_estate_listings (Full RealEstateDetails Field Matrix)
-- ============================================================================
ALTER TABLE public.real_estate_listings
  ADD COLUMN IF NOT EXISTS has_associated_plot boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS availability text DEFAULT 'available',
  ADD COLUMN IF NOT EXISTS asking_price numeric,
  ADD COLUMN IF NOT EXISTS price_label text,
  ADD COLUMN IF NOT EXISTS plot_area_sqm numeric,
  ADD COLUMN IF NOT EXISTS built_up_area_sqm numeric,
  ADD COLUMN IF NOT EXISTS land_type text,
  ADD COLUMN IF NOT EXISTS boundary_polygon jsonb,
  ADD COLUMN IF NOT EXISTS dimensions_text text,
  ADD COLUMN IF NOT EXISTS road_access text,
  ADD COLUMN IF NOT EXISTS road_frontage_meters numeric,
  ADD COLUMN IF NOT EXISTS terrain_slope text,
  ADD COLUMN IF NOT EXISTS ownership_label text,
  ADD COLUMN IF NOT EXISTS floors integer,
  ADD COLUMN IF NOT EXISTS floor_number integer,
  ADD COLUMN IF NOT EXISTS total_floors integer,
  ADD COLUMN IF NOT EXISTS construction_status text,
  ADD COLUMN IF NOT EXISTS furnishing_status text,
  ADD COLUMN IF NOT EXISTS parking text,
  ADD COLUMN IF NOT EXISTS balcony boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS lift_available boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS property_age_years integer,
  ADD COLUMN IF NOT EXISTS maintenance_monthly numeric,
  ADD COLUMN IF NOT EXISTS commercial_use text,
  ADD COLUMN IF NOT EXISTS unit_type text,
  ADD COLUMN IF NOT EXISTS frontage_meters numeric,
  ADD COLUMN IF NOT EXISTS power_water_availability text,
  ADD COLUMN IF NOT EXISTS lease_terms text,
  ADD COLUMN IF NOT EXISTS room_type text,
  ADD COLUMN IF NOT EXISTS occupancy_capacity integer,
  ADD COLUMN IF NOT EXISTS attached_bathroom boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS payment_frequency text,
  ADD COLUMN IF NOT EXISTS house_rules jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS utilities jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS amenities jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS panoramas jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS street_view_available boolean DEFAULT false;

-- ============================================================================
-- 7. SYNC public.public_interest_listings (PublicPlaceDetails)
-- ============================================================================
ALTER TABLE public.public_interest_listings
  ADD COLUMN IF NOT EXISTS place_type text,
  ADD COLUMN IF NOT EXISTS public_info text,
  ADD COLUMN IF NOT EXISTS facilities jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS opening_hours text,
  ADD COLUMN IF NOT EXISTS verification_source_label text,
  ADD COLUMN IF NOT EXISTS accessibility_notes text,
  ADD COLUMN IF NOT EXISTS emergency_or_helpline_note text,
  ADD COLUMN IF NOT EXISTS verified boolean DEFAULT false;

-- ============================================================================
-- 8. CREATE public.sports_listings (SportsVenueDetails - Missing Sub-Table)
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.sports_listings (
  listing_id uuid PRIMARY KEY REFERENCES public.listings(id) ON DELETE CASCADE,
  sport_activity text,
  venue_category text,
  facilities jsonb DEFAULT '[]'::jsonb,
  capacity integer,
  opening_hours text,
  surface_type text,
  access_notes text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.sports_listings ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'sports_listings'
      AND policyname = 'Allow public read access to sports_listings'
  ) THEN
    CREATE POLICY "Allow public read access to sports_listings"
      ON public.sports_listings
      FOR SELECT
      USING (true);
  END IF;
END $$;

-- ============================================================================
-- 9. SYNC public.listing_media (PanoramaScene & Storage Metadata)
-- ============================================================================
ALTER TABLE public.listing_media
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS storage_path text,
  ADD COLUMN IF NOT EXISTS mime_type text,
  ADD COLUMN IF NOT EXISTS size_bytes bigint,
  ADD COLUMN IF NOT EXISTS sort_order integer DEFAULT 0,
  ADD COLUMN IF NOT EXISTS width integer,
  ADD COLUMN IF NOT EXISTS height integer,
  ADD COLUMN IF NOT EXISTS is_equirectangular boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS is_synthetic_demo boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS scene_type text,
  ADD COLUMN IF NOT EXISTS initial_yaw numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS initial_pitch numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;

-- ============================================================================
-- 10. SYNC public.staff_delegations (StaffDelegation)
-- ============================================================================
ALTER TABLE public.staff_delegations
  ADD COLUMN IF NOT EXISTS owner_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS staff_name text,
  ADD COLUMN IF NOT EXISTS staff_email text,
  ADD COLUMN IF NOT EXISTS assigned_listing_ids jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS status text DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS assigned_at timestamptz DEFAULT now();

-- ============================================================================
-- 11. CREATE MISSING APPLICATION WORKFLOW TABLES
-- ============================================================================

-- 11a. Catalogue Products (CatalogueProduct)
CREATE TABLE IF NOT EXISTS public.catalogue_products (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  listing_id uuid REFERENCES public.listings(id) ON DELETE CASCADE,
  name text NOT NULL,
  category text,
  description text,
  price numeric DEFAULT 0,
  variants jsonb DEFAULT '[]'::jsonb,
  availability text DEFAULT 'in_stock',
  image_url text,
  promotion_label text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.catalogue_products ENABLE ROW LEVEL SECURITY;

-- 11b. Reviews (ReviewRecord)
CREATE TABLE IF NOT EXISTS public.reviews (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  listing_id uuid REFERENCES public.listings(id) ON DELETE CASCADE,
  listing_title text,
  author_name text NOT NULL,
  rating numeric NOT NULL,
  comment text,
  owner_reply text,
  owner_reply_updated_at timestamptz,
  reported boolean DEFAULT false,
  report_reason text,
  moderation_status text DEFAULT 'approved',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

-- 11c. Enquiries (EnquiryRecord)
CREATE TABLE IF NOT EXISTS public.enquiries (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  listing_id uuid REFERENCES public.listings(id) ON DELETE CASCADE,
  listing_title text,
  owner_id uuid,
  sender_name text NOT NULL,
  sender_phone text,
  sender_email text,
  message text NOT NULL,
  source text DEFAULT 'Map Preview',
  status text DEFAULT 'open',
  owner_reply text,
  replied_at timestamptz,
  activity_log jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.enquiries ENABLE ROW LEVEL SECURITY;

-- 11d. Verification Requests (VerificationRequest)
CREATE TABLE IF NOT EXISTS public.verification_requests (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  listing_id uuid REFERENCES public.listings(id) ON DELETE CASCADE,
  listing_title text,
  category text,
  owner_id uuid,
  owner_name text,
  submitted_at timestamptz DEFAULT now(),
  evidence_summary text,
  status text DEFAULT 'pending',
  decision_reason text,
  decided_by text,
  decided_at timestamptz
);

ALTER TABLE public.verification_requests ENABLE ROW LEVEL SECURITY;

-- 11e. Moderation Cases (ModerationCase)
CREATE TABLE IF NOT EXISTS public.moderation_cases (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  target_type text NOT NULL,
  target_id text NOT NULL,
  target_title text,
  reason text NOT NULL,
  reported_by text,
  status text DEFAULT 'open',
  decision_note text,
  decided_by text,
  decided_at timestamptz,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.moderation_cases ENABLE ROW LEVEL SECURITY;

-- 11f. Notifications (NotificationItem)
CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  recipient_id uuid,
  recipient_role text NOT NULL,
  title text NOT NULL,
  message text NOT NULL,
  type text NOT NULL,
  read boolean DEFAULT false,
  link_listing_id uuid REFERENCES public.listings(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;

-- 11g. Audit Logs (AuditLogEntry)
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  timestamp timestamptz DEFAULT now(),
  actor_id text,
  actor_name text,
  actor_role text,
  workspace text,
  action text NOT NULL,
  target_id text,
  target_name text,
  details text
);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- 11h. Dynamic Field Definitions (DynamicFieldDefinition)
CREATE TABLE IF NOT EXISTS public.dynamic_field_definitions (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  category text NOT NULL,
  name text NOT NULL,
  label text NOT NULL,
  field_type text NOT NULL,
  required boolean DEFAULT false,
  public_visible boolean DEFAULT true,
  owner_editable boolean DEFAULT true,
  admin_only boolean DEFAULT false,
  filterable boolean DEFAULT false,
  options jsonb DEFAULT '[]'::jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.dynamic_field_definitions ENABLE ROW LEVEL SECURITY;

-- Public read policies for public-facing catalog, approved reviews, and field definitions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'catalogue_products'
      AND policyname = 'Allow public read access to catalogue_products'
  ) THEN
    CREATE POLICY "Allow public read access to catalogue_products"
      ON public.catalogue_products FOR SELECT USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'reviews'
      AND policyname = 'Allow public read access to approved reviews'
  ) THEN
    CREATE POLICY "Allow public read access to approved reviews"
      ON public.reviews FOR SELECT USING (moderation_status = 'approved');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'dynamic_field_definitions'
      AND policyname = 'Allow public read access to dynamic_field_definitions'
  ) THEN
    CREATE POLICY "Allow public read access to dynamic_field_definitions"
      ON public.dynamic_field_definitions FOR SELECT USING (public_visible = true);
  END IF;
END $$;
