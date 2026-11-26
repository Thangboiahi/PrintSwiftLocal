-- =====================================================================================
-- PASS V21-A · R2 — Narrow profile lookups after the v21a `profiles` row-scoping
-- =====================================================================================
-- v21a (§9A) made `public.profiles` readable only to the row owner, platform admins,
-- dispatch mediators and owners viewing their own delegated staff. Two legitimate owner
-- flows read other users' private columns directly and silently broke:
--
--   1. StaffDelegationManager "Lookup by +91 phone / email" — owners must find a
--      not-yet-delegated registered user by an exact contact value.
--   2. VehicleFleetCalendarManager — vehicle owners must see the name & phone of the
--      customers who booked THEIR vehicles.
--
-- Both are restored with SECURITY DEFINER RPCs that return only the minimum columns,
-- use exact matching (no wildcard enumeration), and authorize the caller server-side.
-- Idempotent: safe to run repeatedly in the Supabase SQL Editor.
-- =====================================================================================

BEGIN;

-- -------------------------------------------------------------------------------------
-- 1. lookup_user_for_delegation(p_contact text)
--    Exact email (case-insensitive), exact last-10-digit phone, or exact @username.
--    Caller must own at least one business listing or vehicle listing (or be an admin).
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.lookup_user_for_delegation(p_contact text)
RETURNS TABLE (
  id uuid,
  username text,
  full_name text,
  avatar_url text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_clean text := trim(COALESCE(p_contact, ''));
  v_digits text;
  v_last10 text;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in required.' USING ERRCODE = '42501';
  END IF;

  IF NOT (
    EXISTS (SELECT 1 FROM public.listings l WHERE l.owner_id = v_uid)
    OR EXISTS (SELECT 1 FROM public.vehicle_listings vl WHERE vl.owner_id = v_uid)
    OR public.is_pnd_admin(v_uid)
  ) THEN
    RAISE EXCEPTION 'Only business owners can look up staff candidates.' USING ERRCODE = '42501';
  END IF;

  IF length(v_clean) < 3 OR length(v_clean) > 254 THEN
    RETURN;
  END IF;

  IF position('@' IN v_clean) > 1 THEN
    -- Email: exact, case-insensitive (profiles.email or the auth account email)
    RETURN QUERY
    SELECT p.id, p.username, p.full_name, p.avatar_url
    FROM public.profiles p
    LEFT JOIN auth.users u ON u.id = p.id
    WHERE lower(trim(COALESCE(p.email, ''))) = lower(v_clean)
       OR lower(trim(COALESCE(u.email, ''))) = lower(v_clean)
    ORDER BY p.created_at NULLS LAST
    LIMIT 1;
    RETURN;
  END IF;

  v_digits := regexp_replace(v_clean, '\D', '', 'g');
  IF length(v_digits) >= 10 AND v_clean !~ '[A-Za-z_]' THEN
    v_last10 := right(v_digits, 10);
    RETURN QUERY
    SELECT p.id, p.username, p.full_name, p.avatar_url
    FROM public.profiles p
    WHERE right(regexp_replace(COALESCE(p.phone, ''), '\D', '', 'g'), 10) = v_last10
    ORDER BY p.created_at NULLS LAST
    LIMIT 1;
    RETURN;
  END IF;

  -- @username: exact, case-insensitive
  RETURN QUERY
  SELECT p.id, p.username, p.full_name, p.avatar_url
  FROM public.profiles p
  WHERE lower(COALESCE(p.username, '')) = lower(regexp_replace(v_clean, '^@+', ''))
  LIMIT 1;
END;
$$;

REVOKE ALL ON FUNCTION public.lookup_user_for_delegation(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lookup_user_for_delegation(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.lookup_user_for_delegation(text) TO authenticated, service_role;

COMMENT ON FUNCTION public.lookup_user_for_delegation(text) IS
  'v21a-r2: exact email / last-10-digit phone / @username lookup for staff delegation. Owners & admins only; returns id, username, full_name, avatar_url.';

-- -------------------------------------------------------------------------------------
-- 2. get_vehicle_booking_contacts(p_booking_ids uuid[])
--    Customer name + phone for bookings on vehicles the caller owns (or admin/mediator).
-- -------------------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.get_vehicle_booking_contacts(p_booking_ids uuid[])
RETURNS TABLE (
  booking_id uuid,
  customer_id uuid,
  customer_name text,
  customer_phone text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_is_platform boolean;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Sign in required.' USING ERRCODE = '42501';
  END IF;

  IF p_booking_ids IS NULL OR cardinality(p_booking_ids) = 0 THEN
    RETURN;
  END IF;

  IF cardinality(p_booking_ids) > 500 THEN
    RAISE EXCEPTION 'Too many bookings requested (max 500).' USING ERRCODE = '22023';
  END IF;

  v_is_platform := public.is_pnd_admin(v_uid) OR public.is_pnd_mediator(v_uid);

  RETURN QUERY
  SELECT
    vb.id,
    vb.customer_id,
    COALESCE(NULLIF(trim(p.full_name), ''), NULLIF(trim(p.name), ''), 'Customer')::text,
    COALESCE(NULLIF(trim(p.phone), ''), '')::text
  FROM public.vehicle_bookings vb
  JOIN public.vehicle_listings vl ON vl.id = vb.vehicle_listing_id
  LEFT JOIN public.profiles p ON p.id = vb.customer_id
  WHERE vb.id = ANY (p_booking_ids)
    AND (v_is_platform OR vl.owner_id = v_uid);
END;
$$;

REVOKE ALL ON FUNCTION public.get_vehicle_booking_contacts(uuid[]) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_vehicle_booking_contacts(uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.get_vehicle_booking_contacts(uuid[]) TO authenticated, service_role;

COMMENT ON FUNCTION public.get_vehicle_booking_contacts(uuid[]) IS
  'v21a-r2: customer name/phone for vehicle_bookings on vehicles owned by the caller (admins & dispatch mediators: all). Max 500 ids.';

COMMIT;
