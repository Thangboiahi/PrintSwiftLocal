-- INSTRUCTION: Copy and run this entire file in your Supabase SQL Editor to create/update the enquiries table and Row-Level Security (RLS) policies.

CREATE TABLE IF NOT EXISTS public.enquiries (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  listing_id uuid REFERENCES public.listings(id) ON DELETE CASCADE,
  sender_name text NOT NULL,
  sender_contact text NOT NULL,
  message text NOT NULL,
  status text DEFAULT 'new',
  created_at timestamptz DEFAULT now()
);

-- Ensure sender_contact and default 'new' status exist if table was created earlier
ALTER TABLE public.enquiries
  ADD COLUMN IF NOT EXISTS sender_contact text,
  ALTER COLUMN status SET DEFAULT 'new';

ALTER TABLE public.enquiries ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'enquiries'
      AND policyname = 'Allow public visitors to insert enquiries'
  ) THEN
    CREATE POLICY "Allow public visitors to insert enquiries"
      ON public.enquiries
      FOR INSERT
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'enquiries'
      AND policyname = 'Allow listing owners to read enquiries for their listings'
  ) THEN
    CREATE POLICY "Allow listing owners to read enquiries for their listings"
      ON public.enquiries
      FOR SELECT
      USING (
        EXISTS (
          SELECT 1
          FROM public.listings
          WHERE public.listings.id = public.enquiries.listing_id
            AND public.listings.owner_id = auth.uid()
        )
      );
  END IF;
END $$;
