-- =============================================================================
-- DD OODLE — PASS V13-A: SAFE @USERNAME SEARCH & 360° MULTI-VIEW SUPPORT
-- =============================================================================
-- 100% IDEMPOTENT MIGRATION
-- 1. Ensures public.profiles has unique lowercase username + index + backfill
-- 2. Adds panoramas_360 jsonb array on public.listings (for Pass V13-B 360 views)
-- 3. Creates public.search_users_by_username(p_query, p_limit) returning ONLY
--    safe public profile identity columns (NEVER email or phone)
-- =============================================================================

-- 1. Ensure username column exists on public.profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS username text;

-- Backfill any null or blank usernames with deterministic lowercase handles
UPDATE public.profiles
SET username =
  CASE
    WHEN lower(email) = 'thangboiahi@gmail.com' THEN 'dd_thang'
    WHEN lower(email) = 'visitor.test@ddoodle.in' THEN 'test_visitor'
    WHEN lower(email) = 'owner.test@ddoodle.in' THEN 'test_owner'
    WHEN lower(email) = 'staff.test@ddoodle.in' THEN 'test_staff'
    WHEN lower(email) = 'driver.test@ddoodle.in' THEN 'test_driver'
    WHEN lower(email) = 'manager.lamka@ddoodle.in' THEN 'test_manager_lamka'
    ELSE
      COALESCE(
        NULLIF(
          regexp_replace(
            lower(COALESCE(split_part(email, '@', 1), full_name, 'user')),
            '[^a-z0-9_]',
            '',
            'g'
          ),
          ''
        ),
        'user'
      ) || '_' || substr(replace(id::text, '-', ''), 1, 6)
  END
WHERE username IS NULL OR length(trim(username)) = 0;

-- Case-insensitive unique index on profiles(lower(username))
CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_username_lower_unique
  ON public.profiles (lower(username))
  WHERE username IS NOT NULL AND length(trim(username)) > 0;

CREATE INDEX IF NOT EXISTS idx_profiles_username_trgm_prefix
  ON public.profiles (lower(username) text_pattern_ops);

-- 2. Add panoramas_360 jsonb array on public.listings for multi-room 360° views
ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS panoramas_360 jsonb NOT NULL DEFAULT '[]'::jsonb;

-- Backfill panoramas_360 from single panorama_url where panoramas_360 is empty
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'listings'
      AND column_name = 'panorama_url'
  ) THEN
    UPDATE public.listings
    SET panoramas_360 = jsonb_build_array(
      jsonb_build_object(
        'id', 'pano-primary',
        'label', 'Main 360° View',
        'url', panorama_url
      )
    )
    WHERE (panoramas_360 IS NULL OR panoramas_360 = '[]'::jsonb)
      AND panorama_url IS NOT NULL
      AND length(trim(panorama_url)) > 0;
  END IF;
END $$;

-- 3. Privacy-Preserving @username Search RPC
-- Never returns email, phone, or private metadata.
DROP FUNCTION IF EXISTS public.search_users_by_username(text, integer);

CREATE OR REPLACE FUNCTION public.search_users_by_username(
  p_query text,
  p_limit integer DEFAULT 8
)
RETURNS TABLE (
  id uuid,
  username text,
  full_name text,
  avatar_url text,
  home_hub_id uuid
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_clean text;
  v_cap integer;
BEGIN
  -- Require authenticated caller
  IF auth.uid() IS NULL THEN
    RETURN;
  END IF;

  v_clean := lower(trim(regexp_replace(COALESCE(p_query, ''), '^@+', '')));
  v_cap := LEAST(GREATEST(COALESCE(p_limit, 8), 1), 20);

  IF length(v_clean) < 1 THEN
    RETURN;
  END IF;

  RETURN QUERY
  SELECT
    p.id,
    COALESCE(
      NULLIF(trim(p.username), ''),
      'user_' || substr(replace(p.id::text, '-', ''), 1, 6)
    )::text AS username,
    COALESCE(NULLIF(trim(p.full_name), ''), 'DD oodle Member')::text AS full_name,
    p.avatar_url::text AS avatar_url,
    p.default_hub_id AS home_hub_id
  FROM public.profiles p
  WHERE
    lower(COALESCE(p.username, '')) LIKE v_clean || '%'
    OR lower(COALESCE(p.username, '')) LIKE '%' || v_clean || '%'
    OR lower(COALESCE(p.full_name, '')) LIKE '%' || v_clean || '%'
  ORDER BY
    CASE
      WHEN lower(COALESCE(p.username, '')) = v_clean THEN 0
      WHEN lower(COALESCE(p.username, '')) LIKE v_clean || '%' THEN 1
      WHEN lower(COALESCE(p.full_name, '')) LIKE v_clean || '%' THEN 2
      ELSE 3
    END,
    lower(COALESCE(p.username, p.full_name, '')) ASC
  LIMIT v_cap;
END;
$$;

REVOKE ALL ON FUNCTION public.search_users_by_username(text, integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.search_users_by_username(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.search_users_by_username(text, integer) TO service_role;
