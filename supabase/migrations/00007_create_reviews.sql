-- INSTRUCTION: Copy and run this entire file in your Supabase SQL Editor to create/update the reviews table and Row-Level Security (RLS) policies.

CREATE TABLE IF NOT EXISTS public.reviews (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  listing_id uuid REFERENCES public.listings(id) ON DELETE CASCADE,
  reviewer_name text NOT NULL,
  rating integer NOT NULL CHECK (rating >= 1 AND rating <= 5),
  comment text,
  owner_reply text,
  created_at timestamptz DEFAULT now()
);

-- Ensure reviewer_name, owner_reply, and 1-5 rating check constraint exist if table was created earlier
ALTER TABLE public.reviews
  ADD COLUMN IF NOT EXISTS reviewer_name text,
  ADD COLUMN IF NOT EXISTS comment text,
  ADD COLUMN IF NOT EXISTS owner_reply text,
  ADD COLUMN IF NOT EXISTS created_at timestamptz DEFAULT now();

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'reviews_rating_check'
  ) THEN
    ALTER TABLE public.reviews
      ADD CONSTRAINT reviews_rating_check CHECK (rating >= 1 AND rating <= 5);
  END IF;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.reviews ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'reviews'
      AND policyname = 'Allow public read access to reviews'
  ) THEN
    CREATE POLICY "Allow public read access to reviews"
      ON public.reviews
      FOR SELECT
      USING (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'reviews'
      AND policyname = 'Allow public visitors to insert reviews'
  ) THEN
    CREATE POLICY "Allow public visitors to insert reviews"
      ON public.reviews
      FOR INSERT
      WITH CHECK (true);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'reviews'
      AND policyname = 'Allow listing owners to update owner_reply on their listings'
  ) THEN
    CREATE POLICY "Allow listing owners to update owner_reply on their listings"
      ON public.reviews
      FOR UPDATE
      USING (
        EXISTS (
          SELECT 1
          FROM public.listings
          WHERE public.listings.id = public.reviews.listing_id
            AND public.listings.owner_id = auth.uid()
        )
      )
      WITH CHECK (
        EXISTS (
          SELECT 1
          FROM public.listings
          WHERE public.listings.id = public.reviews.listing_id
            AND public.listings.owner_id = auth.uid()
        )
      );
  END IF;
END $$;
