-- =============================================================================
-- Migration: 00008_expand_profiles.sql
-- Phase 19: Expand public.profiles with avatar_url and social_links JSONB
-- =============================================================================

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avatar_url text,
  ADD COLUMN IF NOT EXISTS phone text,
  ADD COLUMN IF NOT EXISTS social_links jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN public.profiles.avatar_url IS 'Public URL to user avatar image stored in Supabase Storage.';
COMMENT ON COLUMN public.profiles.social_links IS 'JSONB dictionary or array of social links (WhatsApp, Instagram, Facebook, etc.).';
