-- =============================================================================
-- Migration: 00014_production_rls.sql
-- Phase 44: Production Launch & Security — Strict Row Level Security Lockdown
-- =============================================================================

-- 1. Strictly enable Row Level Security on all core public tables
ALTER TABLE public.listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.enquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- Ensure super_admin helper is present
CREATE OR REPLACE FUNCTION public.is_super_admin()
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
STABLE
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles
    WHERE id = auth.uid()
      AND role = 'super_admin'
  );
$$;

-- =============================================================================
-- 2. public.listings — Public SELECT for published, auth.uid() for mutations
-- =============================================================================
DROP POLICY IF EXISTS "Allow public read access to published listings" ON public.listings;
DROP POLICY IF EXISTS "Allow public read access to listings" ON public.listings;
CREATE POLICY "Allow public read access to listings"
  ON public.listings
  FOR SELECT
  USING (
    status = 'published'
    OR (
      auth.uid() IS NOT NULL
      AND (
        owner_id = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM public.staff_delegations sd
          WHERE sd.listing_id = public.listings.id
            AND sd.staff_id = auth.uid()
        )
        OR public.is_super_admin()
      )
    )
  );

DROP POLICY IF EXISTS "Allow owners to insert own listings" ON public.listings;
CREATE POLICY "Allow owners to insert own listings"
  ON public.listings
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND (
      owner_id = auth.uid()
      OR public.is_super_admin()
    )
  );

DROP POLICY IF EXISTS "Allow owners to update own listings" ON public.listings;
DROP POLICY IF EXISTS "Allow delegated staff to update assigned listings" ON public.listings;
CREATE POLICY "Allow owners to update own listings"
  ON public.listings
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND (
      owner_id = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM public.staff_delegations sd
        WHERE sd.listing_id = public.listings.id
          AND sd.staff_id = auth.uid()
      )
      OR public.is_super_admin()
    )
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND (
      owner_id = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM public.staff_delegations sd
        WHERE sd.listing_id = public.listings.id
          AND sd.staff_id = auth.uid()
      )
      OR public.is_super_admin()
    )
  );

DROP POLICY IF EXISTS "Allow owners to delete own listings" ON public.listings;
CREATE POLICY "Allow owners to delete own listings"
  ON public.listings
  FOR DELETE
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND (
      owner_id = auth.uid()
      OR public.is_super_admin()
    )
  );

-- =============================================================================
-- 3. public.profiles — Read access & strict auth.uid() self/super_admin writes
-- =============================================================================
DROP POLICY IF EXISTS "Allow public read access to profiles" ON public.profiles;
CREATE POLICY "Allow public read access to profiles"
  ON public.profiles
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Allow authenticated users to insert own profile" ON public.profiles;
CREATE POLICY "Allow authenticated users to insert own profile"
  ON public.profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Allow users to update own profile without role change" ON public.profiles;
CREATE POLICY "Allow users to update own profile without role change"
  ON public.profiles
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = id OR public.is_super_admin())
  WITH CHECK (
    (
      auth.uid() = id
      AND role IS NOT DISTINCT FROM (
        SELECT p.role FROM public.profiles p WHERE p.id = auth.uid()
      )
    )
    OR public.is_super_admin()
  );

DROP POLICY IF EXISTS "Allow super_admin to delete profiles" ON public.profiles;
CREATE POLICY "Allow super_admin to delete profiles"
  ON public.profiles
  FOR DELETE
  TO authenticated
  USING (auth.uid() IS NOT NULL AND public.is_super_admin());

-- =============================================================================
-- 4. public.categories — Public SELECT, Super Admin auth.uid() mutations only
-- =============================================================================
DROP POLICY IF EXISTS "Allow public read access to categories" ON public.categories;
CREATE POLICY "Allow public read access to categories"
  ON public.categories
  FOR SELECT
  USING (true);

DROP POLICY IF EXISTS "Allow super_admin to insert categories" ON public.categories;
CREATE POLICY "Allow super_admin to insert categories"
  ON public.categories
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL AND public.is_super_admin());

DROP POLICY IF EXISTS "Allow super_admin to update categories" ON public.categories;
CREATE POLICY "Allow super_admin to update categories"
  ON public.categories
  FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL AND public.is_super_admin())
  WITH CHECK (auth.uid() IS NOT NULL AND public.is_super_admin());

DROP POLICY IF EXISTS "Allow super_admin to delete categories" ON public.categories;
CREATE POLICY "Allow super_admin to delete categories"
  ON public.categories
  FOR DELETE
  TO authenticated
  USING (auth.uid() IS NOT NULL AND public.is_super_admin());

-- =============================================================================
-- 5. public.enquiries — Explicit auth.uid() checks on all reads & mutations
-- =============================================================================
DROP POLICY IF EXISTS "Allow public visitors to insert enquiries" ON public.enquiries;
DROP POLICY IF EXISTS "Allow authenticated users to insert enquiries" ON public.enquiries;
CREATE POLICY "Allow authenticated users to insert enquiries"
  ON public.enquiries
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Allow listing owners to read enquiries for their listings" ON public.enquiries;
CREATE POLICY "Allow listing owners to read enquiries for their listings"
  ON public.enquiries
  FOR SELECT
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.listings l
        WHERE l.id = public.enquiries.listing_id
          AND l.owner_id = auth.uid()
      )
      OR EXISTS (
        SELECT 1
        FROM public.staff_delegations sd
        WHERE sd.listing_id = public.enquiries.listing_id
          AND sd.staff_id = auth.uid()
      )
      OR public.is_super_admin()
    )
  );

DROP POLICY IF EXISTS "Allow listing owners to update enquiries" ON public.enquiries;
CREATE POLICY "Allow listing owners to update enquiries"
  ON public.enquiries
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.listings l
        WHERE l.id = public.enquiries.listing_id
          AND l.owner_id = auth.uid()
      )
      OR public.is_super_admin()
    )
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.listings l
        WHERE l.id = public.enquiries.listing_id
          AND l.owner_id = auth.uid()
      )
      OR public.is_super_admin()
    )
  );

DROP POLICY IF EXISTS "Allow listing owners to delete enquiries" ON public.enquiries;
CREATE POLICY "Allow listing owners to delete enquiries"
  ON public.enquiries
  FOR DELETE
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND (
      EXISTS (
        SELECT 1
        FROM public.listings l
        WHERE l.id = public.enquiries.listing_id
          AND l.owner_id = auth.uid()
      )
      OR public.is_super_admin()
    )
  );

-- =============================================================================
-- 6. public.notifications — Strict auth.uid() = user_id isolation
-- =============================================================================
DROP POLICY IF EXISTS "Users can select own notifications" ON public.notifications;
CREATE POLICY "Users can select own notifications"
  ON public.notifications
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert own notifications" ON public.notifications;
CREATE POLICY "Users can insert own notifications"
  ON public.notifications
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id OR public.is_super_admin());

DROP POLICY IF EXISTS "Users can update own notifications" ON public.notifications;
CREATE POLICY "Users can update own notifications"
  ON public.notifications
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete own notifications" ON public.notifications;
CREATE POLICY "Users can delete own notifications"
  ON public.notifications
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- =============================================================================
-- 7. public.activity_logs — Strict auth.uid() = user_id isolation
-- =============================================================================
DROP POLICY IF EXISTS "Users can select own activity_logs" ON public.activity_logs;
CREATE POLICY "Users can select own activity_logs"
  ON public.activity_logs
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR public.is_super_admin());

DROP POLICY IF EXISTS "Users can insert own activity_logs" ON public.activity_logs;
CREATE POLICY "Users can insert own activity_logs"
  ON public.activity_logs
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update own activity_logs" ON public.activity_logs;
CREATE POLICY "Users can update own activity_logs"
  ON public.activity_logs
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id OR public.is_super_admin())
  WITH CHECK (auth.uid() = user_id OR public.is_super_admin());

DROP POLICY IF EXISTS "Users can delete own activity_logs" ON public.activity_logs;
CREATE POLICY "Users can delete own activity_logs"
  ON public.activity_logs
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id OR public.is_super_admin());
