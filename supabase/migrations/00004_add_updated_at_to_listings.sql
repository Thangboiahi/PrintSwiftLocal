ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();
