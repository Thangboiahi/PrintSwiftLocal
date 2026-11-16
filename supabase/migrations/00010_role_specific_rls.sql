-- =============================================================================
-- Migration: 00010_role_specific_rls.sql
-- Phase 33: Role-Specific CRUD & Permissions (Owners vs. Delegated Staff RLS)
-- =============================================================================

-- 1. Enable Row Level Security on public.listings and public.listing_media
ALTER TABLE public.listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.listing_media ENABLE ROW LEVEL SECURITY;

-- 2. Helper functions for role & delegation verification
CREATE OR REPLACE FUNCTION public.is_listing_owner(target_listing_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.listings l
    WHERE l.id = target_listing_id
      AND l.owner_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.is_delegated_staff(target_listing_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.staff_delegations sd
    WHERE sd.listing_id = target_listing_id
      AND sd.staff_id = auth.uid()
  );
$$;

-- =============================================================================
-- 3. RLS Policies for public.listings
-- =============================================================================

-- Public read access for published listings (and full read for owner, delegated staff, or super_admin)
DROP POLICY IF EXISTS "Allow public read access to listings" ON public.listings;
CREATE POLICY "Allow public read access to listings"
  ON public.listings
  FOR SELECT
  USING (
    status = 'published'
    OR owner_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.staff_delegations sd
      WHERE sd.listing_id = public.listings.id
        AND sd.staff_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'super_admin'
    )
  );

-- Owners: Can INSERT listings where owner_id = auth.uid()
DROP POLICY IF EXISTS "Allow owners to insert own listings" ON public.listings;
CREATE POLICY "Allow owners to insert own listings"
  ON public.listings
  FOR INSERT
  TO authenticated
  WITH CHECK (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'super_admin'
    )
  );

-- Owners: Can UPDATE listings where owner_id = auth.uid() (or super_admin)
DROP POLICY IF EXISTS "Allow owners to update own listings" ON public.listings;
CREATE POLICY "Allow owners to update own listings"
  ON public.listings
  FOR UPDATE
  TO authenticated
  USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'super_admin'
    )
  )
  WITH CHECK (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'super_admin'
    )
  );

-- Staff: Can UPDATE listings ONLY IF their auth.uid() exists in staff_delegations linked to that listing_id
DROP POLICY IF EXISTS "Allow delegated staff to update assigned listings" ON public.listings;
CREATE POLICY "Allow delegated staff to update assigned listings"
  ON public.listings
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.staff_delegations sd
      WHERE sd.listing_id = public.listings.id
        AND sd.staff_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.staff_delegations sd
      WHERE sd.listing_id = public.listings.id
        AND sd.staff_id = auth.uid()
    )
  );

-- Owners ONLY (and super_admin): Can DELETE listings where owner_id = auth.uid().
-- Delegated Staff CANNOT delete listings.
DROP POLICY IF EXISTS "Allow owners to delete own listings" ON public.listings;
CREATE POLICY "Allow owners to delete own listings"
  ON public.listings
  FOR DELETE
  TO authenticated
  USING (
    owner_id = auth.uid()
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'super_admin'
    )
  );

-- =============================================================================
-- 4. RLS Policies for public.listing_media
-- =============================================================================

DROP POLICY IF EXISTS "Allow public read access to listing_media" ON public.listing_media;
CREATE POLICY "Allow public read access to listing_media"
  ON public.listing_media
  FOR SELECT
  USING (true);

-- Owners & Delegated Staff: Can INSERT listing_media for owned or delegated listings
DROP POLICY IF EXISTS "Allow owners and delegated staff to insert listing_media" ON public.listing_media;
CREATE POLICY "Allow owners and delegated staff to insert listing_media"
  ON public.listing_media
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.listings l
      WHERE l.id = public.listing_media.listing_id
        AND l.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.staff_delegations sd
      WHERE sd.listing_id = public.listing_media.listing_id
        AND sd.staff_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'super_admin'
    )
  );

-- Owners: Can UPDATE listing_media where they own the parent listing
DROP POLICY IF EXISTS "Allow owners to update listing_media" ON public.listing_media;
CREATE POLICY "Allow owners to update listing_media"
  ON public.listing_media
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.listings l
      WHERE l.id = public.listing_media.listing_id
        AND l.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'super_admin'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.listings l
      WHERE l.id = public.listing_media.listing_id
        AND l.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'super_admin'
    )
  );

-- Staff: Can UPDATE listing_media ONLY IF their auth.uid() exists in staff_delegations for that listing_id
DROP POLICY IF EXISTS "Allow delegated staff to update assigned listing_media" ON public.listing_media;
CREATE POLICY "Allow delegated staff to update assigned listing_media"
  ON public.listing_media
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.staff_delegations sd
      WHERE sd.listing_id = public.listing_media.listing_id
        AND sd.staff_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.staff_delegations sd
      WHERE sd.listing_id = public.listing_media.listing_id
        AND sd.staff_id = auth.uid()
    )
  );

-- Owners ONLY (and super_admin): Can DELETE listing_media where owner_id = auth.uid().
-- Delegated Staff CANNOT delete listing_media.
DROP POLICY IF EXISTS "Allow owners to delete listing_media" ON public.listing_media;
CREATE POLICY "Allow owners to delete listing_media"
  ON public.listing_media
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.listings l
      WHERE l.id = public.listing_media.listing_id
        AND l.owner_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'super_admin'
    )
  );
