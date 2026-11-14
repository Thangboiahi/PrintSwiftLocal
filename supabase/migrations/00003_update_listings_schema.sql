-- INSTRUCTION: Copy and run this entire file in your Supabase SQL Editor to alter public.listings to match the full schema.

CREATE EXTENSION IF NOT EXISTS postgis;

ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS category_id uuid REFERENCES public.categories(id),
  ADD COLUMN IF NOT EXISTS description text,
  ADD COLUMN IF NOT EXISTS address text,
  ADD COLUMN IF NOT EXISTS location geometry(Point, 4326),
  ADD COLUMN IF NOT EXISTS listing_type text,
  DROP COLUMN IF EXISTS category,
  DROP COLUMN IF EXISTS price;
