-- ============================================================================
-- Migration: 00013_disperse_coordinates.sql
-- Phase 41: Geospatial Data & Coordinate Dispersion Across Churachandpur
-- ============================================================================
-- INSTRUCTION: Run this script in the Supabase SQL Editor to ensure existing
-- sample/mock listings have distinct lat/lng coordinates spread across
-- Churachandpur neighborhoods (Tuibong, Rengkai, New Lamka, Hiangtam Lamka,
-- Zenhang Lamka, Bungmual, Pearsonmun, and Lanva) rather than stacking on the
-- exact same central coordinate (24.3335, 93.6978).
-- ============================================================================

-- 1. Ensure explicit lat and lng numeric columns exist alongside coordinates JSONB
ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS lat double precision DEFAULT 24.3335,
  ADD COLUMN IF NOT EXISTS lng double precision DEFAULT 93.6978,
  ADD COLUMN IF NOT EXISTS coordinates jsonb DEFAULT '{"lat": 24.3335, "lng": 93.6978}'::jsonb;

-- Backfill lat and lng from existing coordinates JSONB where available
UPDATE public.listings
SET
  lat = COALESCE((coordinates->>'lat')::double precision, lat, 24.3335),
  lng = COALESCE((coordinates->>'lng')::double precision, lng, 93.6978)
WHERE coordinates IS NOT NULL;

-- 2. Neighborhood-level base coordinate anchors across Churachandpur
-- Applies neighborhood offsets (+0.001 to +0.015 / -0.001 to -0.015 degrees)

-- Tuibong (North Churachandpur corridor: +0.0145 lat, +0.0042 lng)
UPDATE public.listings
SET
  lat = 24.3335 + 0.0145,
  lng = 93.6978 + 0.0042
WHERE locality ILIKE '%Tuibong%';

-- Rengkai (East/Southeast enclave: -0.0085 lat, +0.0135 lng)
UPDATE public.listings
SET
  lat = 24.3335 - 0.0085,
  lng = 93.6978 + 0.0135
WHERE locality ILIKE '%Rengkai%';

-- New Lamka (Central-South commercial sector: -0.0062 lat, +0.0038 lng)
UPDATE public.listings
SET
  lat = 24.3335 - 0.0062,
  lng = 93.6978 + 0.0038
WHERE locality ILIKE '%New Lamka%';

-- Hiangtam Lamka (Central-North hub: +0.0048 lat, -0.0032 lng)
UPDATE public.listings
SET
  lat = 24.3335 + 0.0048,
  lng = 93.6978 - 0.0032
WHERE locality ILIKE '%Hiangtam%';

-- Zenhang Lamka (West-Central ward: +0.0018 lat, -0.0075 lng)
UPDATE public.listings
SET
  lat = 24.3335 + 0.0018,
  lng = 93.6978 - 0.0075
WHERE locality ILIKE '%Zenhang%';

-- Bungmual (Southwest ridge: -0.0115 lat, -0.0125 lng)
UPDATE public.listings
SET
  lat = 24.3335 - 0.0115,
  lng = 93.6978 - 0.0125
WHERE locality ILIKE '%Bungmual%';

-- Pearsonmun (Northwest valley: +0.0095 lat, -0.0142 lng)
UPDATE public.listings
SET
  lat = 24.3335 + 0.0095,
  lng = 93.6978 - 0.0142
WHERE locality ILIKE '%Pearsonmun%';

-- Lanva (Southern crossing: -0.0148 lat, +0.0065 lng)
UPDATE public.listings
SET
  lat = 24.3335 - 0.0148,
  lng = 93.6978 + 0.0065
WHERE locality ILIKE '%Lanva%';

-- 3. Deterministic per-listing micro-dispersion (0.001 to 0.015 deg offsets)
-- Ensures listings within the same neighborhood or without a matched locality
-- never stack on the exact same coordinate.
WITH numbered_listings AS (
  SELECT
    id,
    ROW_NUMBER() OVER (ORDER BY created_at ASC, id ASC) AS rn,
    ROW_NUMBER() OVER (PARTITION BY COALESCE(locality, 'default') ORDER BY created_at ASC, id ASC) AS loc_rn
  FROM public.listings
)
UPDATE public.listings AS l
SET
  lat = ROUND(
    (
      COALESCE(l.lat, 24.3335) +
      ((CASE WHEN (n.rn % 2) = 0 THEN 1 ELSE -1 END) * (0.0012 + ((n.loc_rn % 11) * 0.0011)))
    )::numeric,
    6
  )::double precision,
  lng = ROUND(
    (
      COALESCE(l.lng, 93.6978) +
      ((CASE WHEN (n.rn % 3) = 0 THEN -1 ELSE 1 END) * (0.0014 + (((n.loc_rn + 3) % 11) * 0.0011)))
    )::numeric,
    6
  )::double precision
FROM numbered_listings AS n
WHERE l.id = n.id;

-- 4. Synchronize coordinates JSONB and PostGIS location geometry with dispersed lat/lng
UPDATE public.listings
SET
  coordinates = jsonb_build_object(
    'lat', ROUND(lat::numeric, 6),
    'lng', ROUND(lng::numeric, 6)
  ),
  location = ST_SetSRID(ST_MakePoint(lng, lat), 4326)
WHERE lat IS NOT NULL AND lng IS NOT NULL;
