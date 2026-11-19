-- =============================================================================
-- Migration: 00018_profile_map_settings.sql
-- Phase 49-Y: Persistent Default Map Preferences on public.profiles
-- =============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS map_settings jsonb DEFAULT '{"lat": 24.3335, "lng": 93.6978, "zoom": 13}'::jsonb;

COMMENT ON COLUMN public.profiles.map_settings IS 'User default map center and zoom preferences ({ lat, lng, zoom, configured }).';
