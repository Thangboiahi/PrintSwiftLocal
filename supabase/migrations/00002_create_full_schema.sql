-- INSTRUCTION: Copy and run this entire file in your Supabase SQL Editor to create all remaining PrintSwift Local relational tables and RLS policies.

-- 1. Profiles Table
CREATE TABLE IF NOT EXISTS public.profiles (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  full_name text,
  email text,
  phone text,
  role text DEFAULT 'user',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to profiles"
  ON public.profiles
  FOR SELECT
  USING (true);

-- 2. Categories Table
CREATE TABLE IF NOT EXISTS public.categories (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  slug text UNIQUE,
  description text,
  type text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to categories"
  ON public.categories
  FOR SELECT
  USING (true);

-- 3. Business Listings Sub-Table
CREATE TABLE IF NOT EXISTS public.business_listings (
  listing_id uuid PRIMARY KEY REFERENCES public.listings(id) ON DELETE CASCADE,
  opening_hours jsonb DEFAULT '{}'::jsonb,
  website_url text,
  contact_phone text,
  verified boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.business_listings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to business_listings"
  ON public.business_listings
  FOR SELECT
  USING (true);

-- 4. Service Listings Sub-Table
CREATE TABLE IF NOT EXISTS public.service_listings (
  listing_id uuid PRIMARY KEY REFERENCES public.listings(id) ON DELETE CASCADE,
  service_radius_km numeric,
  pricing_model text,
  starting_price numeric,
  emergency_service boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.service_listings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to service_listings"
  ON public.service_listings
  FOR SELECT
  USING (true);

-- 5. Real Estate Listings Sub-Table
CREATE TABLE IF NOT EXISTS public.real_estate_listings (
  listing_id uuid PRIMARY KEY REFERENCES public.listings(id) ON DELETE CASCADE,
  property_type text,
  price numeric,
  bedrooms integer,
  bathrooms integer,
  area_sqft numeric,
  is_rental boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.real_estate_listings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to real_estate_listings"
  ON public.real_estate_listings
  FOR SELECT
  USING (true);

-- 6. Public Interest Listings Sub-Table
CREATE TABLE IF NOT EXISTS public.public_interest_listings (
  listing_id uuid PRIMARY KEY REFERENCES public.listings(id) ON DELETE CASCADE,
  organization_type text,
  is_emergency_facility boolean DEFAULT false,
  helpline_number text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.public_interest_listings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to public_interest_listings"
  ON public.public_interest_listings
  FOR SELECT
  USING (true);

-- 7. Listing Media Table
CREATE TABLE IF NOT EXISTS public.listing_media (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  listing_id uuid REFERENCES public.listings(id) ON DELETE CASCADE,
  media_type text,
  url text,
  is_primary boolean DEFAULT false,
  caption text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.listing_media ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to listing_media"
  ON public.listing_media
  FOR SELECT
  USING (true);

-- 8. Staff Delegations Table
CREATE TABLE IF NOT EXISTS public.staff_delegations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  listing_id uuid REFERENCES public.listings(id) ON DELETE CASCADE,
  staff_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  permissions jsonb DEFAULT '[]'::jsonb,
  granted_at timestamptz DEFAULT now()
);

ALTER TABLE public.staff_delegations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to staff_delegations"
  ON public.staff_delegations
  FOR SELECT
  USING (true);
