-- INSTRUCTION: Copy and run this entire file in your Supabase SQL Editor to resolve the schema cache error.

CREATE TABLE IF NOT EXISTS public.listings (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  title text,
  category text,
  status text DEFAULT 'draft',
  price numeric,
  owner_id uuid,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.listings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow public read access to published listings"
  ON public.listings
  FOR SELECT
  USING (status = 'published');
