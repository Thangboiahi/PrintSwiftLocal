-- 00017_media_assets.sql
-- Universal media tracking and orphan cleanup

CREATE TABLE IF NOT EXISTS public.media_assets (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  bucket_id text NOT NULL DEFAULT 'media',
  storage_path text NOT NULL,
  public_url text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  is_temporary boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Index for lookup and cleanup
CREATE INDEX IF NOT EXISTS idx_media_assets_public_url ON public.media_assets(public_url);
CREATE INDEX IF NOT EXISTS idx_media_assets_temp ON public.media_assets(is_temporary, created_at);

-- Enable RLS
ALTER TABLE public.media_assets ENABLE ROW LEVEL SECURITY;

-- Allow public read access to media_assets
CREATE POLICY "Allow public read access to media_assets"
  ON public.media_assets
  FOR SELECT
  USING (true);

-- Allow service role full access
CREATE POLICY "Allow service role full access to media_assets"
  ON public.media_assets
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Cleanup RPC for wiping abandoned temporary uploads older than specified hours (default 24h)
CREATE OR REPLACE FUNCTION public.cleanup_temporary_media_assets(hours_old integer DEFAULT 24)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  deleted_count integer;
BEGIN
  DELETE FROM public.media_assets
  WHERE is_temporary = true
    AND created_at < now() - (hours_old || ' hours')::interval;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;
  RETURN deleted_count;
END;
$$;
