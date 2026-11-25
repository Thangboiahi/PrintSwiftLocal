-- =============================================================================
-- Pass v17a: User-Suggested Leaf Categories + Superadmin Review & Atomic Merge
-- =============================================================================
-- Idempotent migration compatible with v16b 3-level fixed-root taxonomy triggers:
--   1. Extends `public.categories` with `review_status`, `suggested_by`,
--      `merged_into_category_id`, and `review_notes`, backfilling existing rows
--      to `review_status = 'official'`.
--   2. Updates `categories_public_read` RLS so `pending_review` rows are visible
--      only to `super_admin` / `admin` and the suggesting user (never polluting
--      public `/explore` filters), while still permitting that user's listings
--      to reference `category_id` and inherit `root_key`.
--   3. Adds `public.suggest_leaf_category(p_parent_id uuid, p_name text)`
--      (SECURITY DEFINER) with authentication check, rate limit (max 5 pending
--      per user), L1/L2 official parent enforcement (so suggestions land strictly
--      at L2 or L3, never L1 or L4), safe slug normalization, and case-insensitive
--      duplicate detection under the same `root_key`.
--   4. Adds `public.review_suggested_category(...)` and
--      `public.merge_suggested_category(...)` (SECURITY DEFINER, `super_admin`
--      only) with atomic listing reassignment and `public.audit_logs` entries.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. EXTEND `public.categories` WITH REVIEW / SUGGESTION METADATA
-- -----------------------------------------------------------------------------
ALTER TABLE public.categories
  ADD COLUMN IF NOT EXISTS review_status text NOT NULL DEFAULT 'official',
  ADD COLUMN IF NOT EXISTS suggested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS merged_into_category_id uuid REFERENCES public.categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS review_notes text;

-- Enforce allowed values for review_status idempotently
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = 'public.categories'::regclass
      AND conname = 'categories_review_status_check'
  ) THEN
    ALTER TABLE public.categories
      ADD CONSTRAINT categories_review_status_check
      CHECK (review_status IN ('official', 'pending_review', 'merged', 'rejected'));
  END IF;
END;
$$;

-- Backfill existing rows cleanly
UPDATE public.categories
SET review_status = 'official'
WHERE review_status IS NULL
   OR trim(review_status) = '';

CREATE INDEX IF NOT EXISTS idx_categories_pending_review
  ON public.categories (review_status, created_at DESC)
  WHERE review_status = 'pending_review';

CREATE INDEX IF NOT EXISTS idx_categories_suggested_by
  ON public.categories (suggested_by)
  WHERE suggested_by IS NOT NULL;

-- -----------------------------------------------------------------------------
-- 2. UPDATE `public.categories` SELECT RLS POLICY
-- -----------------------------------------------------------------------------
-- Public & general users see only official active categories.
-- Suggesting users also see their own pending_review rows so their listing
-- forms can select/render them immediately without exposing them to /explore.
-- Superadmins & admins see all rows for review and merge governance.
ALTER TABLE public.categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS categories_public_read ON public.categories;
CREATE POLICY categories_public_read
  ON public.categories
  FOR SELECT
  USING (
    (is_active = true AND review_status = 'official')
    OR (auth.uid() IS NOT NULL AND suggested_by = auth.uid() AND review_status = 'pending_review')
    OR public.is_super_admin()
    OR public.is_pnd_admin(auth.uid())
  );

-- -----------------------------------------------------------------------------
-- 3. SAFE USER SUGGESTION RPC: `public.suggest_leaf_category(p_parent_id, p_name)`
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.suggest_leaf_category(
  p_parent_id uuid,
  p_name text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_clean_name text := regexp_replace(trim(COALESCE(p_name, '')), '\s+', ' ', 'g');
  v_base_slug text;
  v_candidate_slug text;
  v_pending_count int := 0;
  v_parent record;
  v_existing record;
  v_inserted record;
  v_suffix int := 1;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Authentication required to suggest a new category.'
      USING ERRCODE = '42501';
  END IF;

  IF p_parent_id IS NULL THEN
    RAISE EXCEPTION 'A parent Level-1 System Root or Level-2 category is required.'
      USING ERRCODE = '22023';
  END IF;

  IF char_length(v_clean_name) < 2 OR char_length(v_clean_name) > 60 THEN
    RAISE EXCEPTION 'Category name must be between 2 and 60 characters.'
      USING ERRCODE = '22023';
  END IF;

  -- Parent must be an official, active L1 or L2 category (so suggestion lands strictly at L2 or L3)
  SELECT id, entity_type, root_key, depth, display_name, icon_key, accent_color, is_active, review_status
    INTO v_parent
  FROM public.categories
  WHERE id = p_parent_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Selected parent category does not exist.'
      USING ERRCODE = '23503';
  END IF;

  IF v_parent.is_active IS DISTINCT FROM true OR v_parent.review_status IS DISTINCT FROM 'official' THEN
    RAISE EXCEPTION 'Suggestions must be placed under an active official category.'
      USING ERRCODE = '22023';
  END IF;

  IF v_parent.depth IS NULL OR v_parent.depth NOT IN (1, 2) THEN
    RAISE EXCEPTION 'Maximum category depth is 3 levels. Choose a Level-1 System Root or Level-2 parent.'
      USING ERRCODE = '22023';
  END IF;

  -- Normalize URL slug safely
  v_base_slug := lower(regexp_replace(v_clean_name, '[^a-zA-Z0-9]+', '-', 'g'));
  v_base_slug := trim(both '-' FROM v_base_slug);
  IF char_length(v_base_slug) < 2 THEN
    v_base_slug := 'cat-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 8);
  END IF;
  v_base_slug := left(v_base_slug, 52);

  -- Case-insensitive duplicate check against official categories under the same root_key
  SELECT *
    INTO v_existing
  FROM public.categories c
  WHERE c.entity_type = v_parent.entity_type
    AND c.root_key = v_parent.root_key
    AND c.review_status = 'official'
    AND c.is_active = true
    AND (
      lower(trim(c.display_name)) = lower(v_clean_name)
      OR lower(c.slug) = v_base_slug
    )
  ORDER BY c.depth DESC, c.sort_order ASC
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'existing_official',
      'message', format('"%s" already exists under %s and has been selected.', v_existing.display_name, v_parent.root_key),
      'category', jsonb_build_object(
        'id', v_existing.id,
        'slug', v_existing.slug,
        'display_name', v_existing.display_name,
        'entity_type', v_existing.entity_type,
        'root_key', v_existing.root_key,
        'parent_id', v_existing.parent_id,
        'depth', v_existing.depth,
        'review_status', v_existing.review_status,
        'is_active', v_existing.is_active
      )
    );
  END IF;

  -- Check if caller already suggested the same name under this root_key
  SELECT *
    INTO v_existing
  FROM public.categories c
  WHERE c.entity_type = v_parent.entity_type
    AND c.root_key = v_parent.root_key
    AND c.review_status = 'pending_review'
    AND c.suggested_by = v_uid
    AND (
      lower(trim(c.display_name)) = lower(v_clean_name)
      OR lower(c.slug) = v_base_slug
    )
  LIMIT 1;

  IF FOUND THEN
    RETURN jsonb_build_object(
      'status', 'existing_pending',
      'message', format('Your pending suggestion "%s" has been selected.', v_existing.display_name),
      'category', jsonb_build_object(
        'id', v_existing.id,
        'slug', v_existing.slug,
        'display_name', v_existing.display_name,
        'entity_type', v_existing.entity_type,
        'root_key', v_existing.root_key,
        'parent_id', v_existing.parent_id,
        'depth', v_existing.depth,
        'review_status', v_existing.review_status,
        'is_active', v_existing.is_active
      )
    );
  END IF;

  -- Enforce rate limit: max 5 pending_review suggestions per authenticated user
  SELECT count(*)
    INTO v_pending_count
  FROM public.categories
  WHERE suggested_by = v_uid
    AND review_status = 'pending_review';

  IF v_pending_count >= 5 THEN
    RAISE EXCEPTION 'You already have 5 pending category suggestions awaiting Superadmin review. Please wait for review or select an existing category.'
      USING ERRCODE = 'P0001';
  END IF;

  -- Ensure slug uniqueness within entity_type (avoid collisions with rejected/merged or other-root slugs)
  v_candidate_slug := v_base_slug;
  WHILE EXISTS (
    SELECT 1
    FROM public.categories c
    WHERE c.entity_type = v_parent.entity_type
      AND lower(c.slug) = v_candidate_slug
  ) LOOP
    v_suffix := v_suffix + 1;
    v_candidate_slug := left(v_base_slug, 46) || '-' || v_suffix::text;
    IF v_suffix > 25 THEN
      v_candidate_slug := left(v_base_slug, 40) || '-' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 6);
      EXIT;
    END IF;
  END LOOP;

  -- Insert new pending leaf; v16b BEFORE INSERT trigger auto-derives depth, root_key, and path_ids
  INSERT INTO public.categories (
    entity_type,
    root_key,
    parent_id,
    depth,
    is_system_root,
    slug,
    display_name,
    icon,
    icon_key,
    color_hex,
    accent_color,
    sort_order,
    is_active,
    review_status,
    suggested_by
  )
  VALUES (
    v_parent.entity_type,
    v_parent.root_key,
    v_parent.id,
    (v_parent.depth + 1)::smallint,
    false,
    v_candidate_slug,
    v_clean_name,
    COALESCE(v_parent.icon_key, 'tag'),
    COALESCE(v_parent.icon_key, 'tag'),
    COALESCE(v_parent.accent_color, '#2563EB'),
    COALESCE(v_parent.accent_color, '#2563EB'),
    999,
    false,
    'pending_review',
    v_uid
  )
  RETURNING * INTO v_inserted;

  RETURN jsonb_build_object(
    'status', 'created_pending',
    'message', format('Suggested "%s" under %s (pending Superadmin review).', v_inserted.display_name, v_parent.display_name),
    'category', jsonb_build_object(
      'id', v_inserted.id,
      'slug', v_inserted.slug,
      'display_name', v_inserted.display_name,
      'entity_type', v_inserted.entity_type,
      'root_key', v_inserted.root_key,
      'parent_id', v_inserted.parent_id,
      'depth', v_inserted.depth,
      'review_status', v_inserted.review_status,
      'is_active', v_inserted.is_active
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.suggest_leaf_category(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.suggest_leaf_category(uuid, text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 4. SUPERADMIN REVIEW RPC: `public.review_suggested_category(...)`
-- -----------------------------------------------------------------------------
-- Handles:
--   - `p_action = 'approve'`: Approves & publishes (optionally revising name,
--     slug, icon_key, accent_color, or parent_id within v16b depth <= 3 rules).
--   - `p_action = 'reject'`: Reassigns referencing listings safely back to the
--     official parent_id, marks review_status = 'rejected', is_active = false.
CREATE OR REPLACE FUNCTION public.review_suggested_category(
  p_category_id uuid,
  p_action text,
  p_display_name text DEFAULT NULL,
  p_slug text DEFAULT NULL,
  p_icon_key text DEFAULT NULL,
  p_accent_color text DEFAULT NULL,
  p_parent_id uuid DEFAULT NULL,
  p_review_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_action text := lower(trim(COALESCE(p_action, '')));
  v_cat record;
  v_next_parent record;
  v_clean_name text;
  v_clean_slug text;
  v_reassigned_listings int := 0;
  v_updated record;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Forbidden: Only super_admin can review suggested categories.'
      USING ERRCODE = '42501';
  END IF;

  IF v_action NOT IN ('approve', 'reject') THEN
    RAISE EXCEPTION 'Invalid review action "%". Expected "approve" or "reject".', p_action
      USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_cat
  FROM public.categories
  WHERE id = p_category_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Category (%) not found.', p_category_id
      USING ERRCODE = '23503';
  END IF;

  IF v_cat.is_system_root = true THEN
    RAISE EXCEPTION 'Cannot review or reject a Level-1 System Root.'
      USING ERRCODE = '42501';
  END IF;

  IF v_action = 'approve' THEN
    v_clean_name := COALESCE(
      NULLIF(regexp_replace(trim(COALESCE(p_display_name, '')), '\s+', ' ', 'g'), ''),
      v_cat.display_name
    );
    v_clean_slug := COALESCE(
      NULLIF(lower(trim(COALESCE(p_slug, ''))), ''),
      v_cat.slug
    );

    IF char_length(v_clean_name) < 2 OR char_length(v_clean_name) > 64 THEN
      RAISE EXCEPTION 'Display label must be between 2 and 64 characters.'
        USING ERRCODE = '22023';
    END IF;

    IF v_clean_slug !~ '^[a-z0-9]+(?:[-_][a-z0-9]+)*$' THEN
      RAISE EXCEPTION 'Slug "%" must use lowercase letters, numbers, hyphens, or underscores only.', v_clean_slug
        USING ERRCODE = '22023';
    END IF;

    IF p_parent_id IS NOT NULL AND p_parent_id <> v_cat.parent_id THEN
      SELECT id, entity_type, root_key, depth, review_status
        INTO v_next_parent
      FROM public.categories
      WHERE id = p_parent_id;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Target parent category (%) does not exist.', p_parent_id
          USING ERRCODE = '23503';
      END IF;

      IF v_next_parent.entity_type <> v_cat.entity_type OR v_next_parent.root_key <> v_cat.root_key THEN
        RAISE EXCEPTION 'Relinked parent must stay within the same system root (%).', v_cat.root_key
          USING ERRCODE = '22023';
      END IF;

      IF v_next_parent.depth NOT IN (1, 2) THEN
        RAISE EXCEPTION 'Cannot relink under a Level-3 leaf (max depth is 3).'
          USING ERRCODE = '22023';
      END IF;

      IF v_next_parent.review_status <> 'official' THEN
        RAISE EXCEPTION 'Relinked parent must be an official category.'
          USING ERRCODE = '22023';
      END IF;
    END IF;

    UPDATE public.categories
    SET
      display_name = v_clean_name,
      slug = v_clean_slug,
      icon_key = COALESCE(NULLIF(trim(COALESCE(p_icon_key, '')), ''), icon_key),
      icon = COALESCE(NULLIF(trim(COALESCE(p_icon_key, '')), ''), icon),
      accent_color = COALESCE(NULLIF(trim(COALESCE(p_accent_color, '')), ''), accent_color),
      color_hex = COALESCE(NULLIF(trim(COALESCE(p_accent_color, '')), ''), color_hex),
      parent_id = COALESCE(p_parent_id, parent_id),
      review_status = 'official',
      is_active = true,
      review_notes = NULLIF(trim(COALESCE(p_review_notes, '')), ''),
      updated_at = now()
    WHERE id = p_category_id
    RETURNING * INTO v_updated;

    -- Keep referencing listings' subcategory label aligned with approved label
    UPDATE public.listings
    SET subcategory = v_updated.display_name
    WHERE category_id = p_category_id;

    PERFORM public.write_audit_log(
      v_actor,
      'super_admin',
      'approve_suggested_category',
      'categories',
      p_category_id::text,
      jsonb_build_object(
        'display_name', v_updated.display_name,
        'slug', v_updated.slug,
        'root_key', v_updated.root_key,
        'parent_id', v_updated.parent_id,
        'depth', v_updated.depth,
        'suggested_by', v_cat.suggested_by,
        'review_notes', v_updated.review_notes
      )
    );

    RETURN jsonb_build_object(
      'action', 'approve',
      'category_id', v_updated.id,
      'display_name', v_updated.display_name,
      'slug', v_updated.slug,
      'review_status', v_updated.review_status
    );
  END IF;

  -- REJECT PATH: Reassign any referencing listings safely back to official parent_id
  IF v_cat.parent_id IS NOT NULL THEN
    UPDATE public.listings
    SET category_id = v_cat.parent_id
    WHERE category_id = p_category_id;
    GET DIAGNOSTICS v_reassigned_listings = ROW_COUNT;
  END IF;

  UPDATE public.categories
  SET
    review_status = 'rejected',
    is_active = false,
    review_notes = NULLIF(trim(COALESCE(p_review_notes, '')), ''),
    updated_at = now()
  WHERE id = p_category_id
  RETURNING * INTO v_updated;

  PERFORM public.write_audit_log(
    v_actor,
    'super_admin',
    'reject_suggested_category',
    'categories',
    p_category_id::text,
    jsonb_build_object(
      'display_name', v_updated.display_name,
      'slug', v_updated.slug,
      'root_key', v_updated.root_key,
      'fallback_parent_id', v_cat.parent_id,
      'reassigned_listings', v_reassigned_listings,
      'suggested_by', v_cat.suggested_by,
      'review_notes', v_updated.review_notes
    )
  );

  RETURN jsonb_build_object(
    'action', 'reject',
    'category_id', v_updated.id,
    'fallback_parent_id', v_cat.parent_id,
    'reassigned_listings', v_reassigned_listings,
    'review_status', v_updated.review_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.review_suggested_category(uuid, text, text, text, text, text, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.review_suggested_category(uuid, text, text, text, text, text, uuid, text) TO authenticated;

-- -----------------------------------------------------------------------------
-- 5. SUPERADMIN ATOMIC MERGE RPC: `public.merge_suggested_category(...)`
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.merge_suggested_category(
  p_source_id uuid,
  p_target_id uuid,
  p_review_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_source record;
  v_target record;
  v_reassigned_listings int := 0;
  v_reassigned_products int := 0;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Forbidden: Only super_admin can merge suggested categories.'
      USING ERRCODE = '42501';
  END IF;

  IF p_source_id IS NULL OR p_target_id IS NULL OR p_source_id = p_target_id THEN
    RAISE EXCEPTION 'Distinct source and target category IDs are required for merge.'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_source
  FROM public.categories
  WHERE id = p_source_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Source category (%) not found.', p_source_id
      USING ERRCODE = '23503';
  END IF;

  IF v_source.is_system_root = true THEN
    RAISE EXCEPTION 'Cannot merge a Level-1 System Root.'
      USING ERRCODE = '42501';
  END IF;

  SELECT *
    INTO v_target
  FROM public.categories
  WHERE id = p_target_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target category (%) not found.', p_target_id
      USING ERRCODE = '23503';
  END IF;

  IF v_target.review_status <> 'official' OR v_target.is_active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Merge target must be an active official category.'
      USING ERRCODE = '22023';
  END IF;

  IF v_source.entity_type <> v_target.entity_type THEN
    RAISE EXCEPTION 'Cannot merge categories across different entity types (% -> %).',
      v_source.entity_type, v_target.entity_type
      USING ERRCODE = '22023';
  END IF;

  -- Atomically reassign all listings pointing to source -> target
  -- (v16b trg_listings_sync_category_v16b automatically keeps root_key & subcategory in sync)
  UPDATE public.listings
  SET
    category_id = p_target_id,
    subcategory = v_target.display_name
  WHERE category_id = p_source_id;
  GET DIAGNOSTICS v_reassigned_listings = ROW_COUNT;

  -- Also reassign marketplace_products if category_id column exists
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'marketplace_products'
      AND column_name = 'category_id'
  ) THEN
    EXECUTE 'UPDATE public.marketplace_products SET category_id = $1 WHERE category_id = $2'
      USING p_target_id, p_source_id;
    GET DIAGNOSTICS v_reassigned_products = ROW_COUNT;
  END IF;

  UPDATE public.categories
  SET
    review_status = 'merged',
    is_active = false,
    merged_into_category_id = p_target_id,
    review_notes = NULLIF(trim(COALESCE(p_review_notes, '')), ''),
    updated_at = now()
  WHERE id = p_source_id;

  PERFORM public.write_audit_log(
    v_actor,
    'super_admin',
    'merge_suggested_category',
    'categories',
    p_source_id::text,
    jsonb_build_object(
      'source_name', v_source.display_name,
      'source_slug', v_source.slug,
      'source_root_key', v_source.root_key,
      'target_id', p_target_id,
      'target_name', v_target.display_name,
      'target_slug', v_target.slug,
      'target_root_key', v_target.root_key,
      'reassigned_listings', v_reassigned_listings,
      'reassigned_products', v_reassigned_products,
      'suggested_by', v_source.suggested_by,
      'review_notes', NULLIF(trim(COALESCE(p_review_notes, '')), '')
    )
  );

  RETURN jsonb_build_object(
    'action', 'merge',
    'source_id', p_source_id,
    'target_id', p_target_id,
    'target_name', v_target.display_name,
    'reassigned_listings', v_reassigned_listings,
    'reassigned_products', v_reassigned_products,
    'review_status', 'merged'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.merge_suggested_category(uuid, uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.merge_suggested_category(uuid, uuid, text) TO authenticated;
