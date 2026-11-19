-- =============================================================================
-- Migration: 20261119_phase58_marketplace.sql
-- Phase 58: Marketplace Products Table, Indexes, RLS Policies & Sample Seed
-- =============================================================================

-- Ensure public.listings exposes a `phone` column synced from `contact_phone`
-- so marketplace product joins (`listings(id, title, locality, phone)`) work cleanly.
ALTER TABLE public.listings
  ADD COLUMN IF NOT EXISTS phone text;

UPDATE public.listings
SET phone = contact_phone
WHERE (phone IS NULL OR phone = '')
  AND contact_phone IS NOT NULL
  AND contact_phone <> '';

-- 1. Create public.marketplace_products table linked to listings and profiles
CREATE TABLE IF NOT EXISTS public.marketplace_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id uuid NOT NULL REFERENCES public.listings(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title text NOT NULL,
  description text,
  price numeric(10,2) NOT NULL CHECK (price >= 0),
  unit text DEFAULT 'piece',
  category text NOT NULL,
  in_stock boolean DEFAULT true,
  thumbnail_url text,
  image_urls text[] DEFAULT '{}',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- 2. Performance Indexes
CREATE INDEX IF NOT EXISTS idx_marketplace_products_category_active
  ON public.marketplace_products (category, is_active);

CREATE INDEX IF NOT EXISTS idx_marketplace_products_listing_id
  ON public.marketplace_products (listing_id);

CREATE INDEX IF NOT EXISTS idx_marketplace_products_created_at_desc
  ON public.marketplace_products (created_at DESC);

-- Auto-update updated_at timestamp on row modifications
CREATE OR REPLACE FUNCTION public.set_marketplace_products_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_marketplace_products_updated_at ON public.marketplace_products;
CREATE TRIGGER trg_marketplace_products_updated_at
  BEFORE UPDATE ON public.marketplace_products
  FOR EACH ROW
  EXECUTE FUNCTION public.set_marketplace_products_updated_at();

-- 3. Row Level Security (RLS)
ALTER TABLE public.marketplace_products ENABLE ROW LEVEL SECURITY;

-- SELECT: Publicly readable where is_active = true (plus full read for owner, admin/super_admin, or delegated staff)
DROP POLICY IF EXISTS "Public can read active marketplace products" ON public.marketplace_products;
CREATE POLICY "Public can read active marketplace products"
  ON public.marketplace_products
  FOR SELECT
  USING (
    is_active = true
    OR (
      auth.uid() IS NOT NULL
      AND (
        auth.uid() = owner_id
        OR EXISTS (
          SELECT 1
          FROM public.profiles p
          WHERE p.id = auth.uid()
            AND p.role IN ('admin', 'super_admin')
        )
        OR EXISTS (
          SELECT 1
          FROM public.staff_delegations sd
          WHERE sd.listing_id = public.marketplace_products.listing_id
            AND sd.staff_id = auth.uid()
        )
      )
    )
  );

-- INSERT: Allowed only for owner_id = auth.uid(), actual admin/super_admin, or delegated staff for listing_id
DROP POLICY IF EXISTS "Owners admins and staff can insert marketplace products" ON public.marketplace_products;
CREATE POLICY "Owners admins and staff can insert marketplace products"
  ON public.marketplace_products
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND (
      auth.uid() = owner_id
      OR EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.role IN ('admin', 'super_admin')
      )
      OR EXISTS (
        SELECT 1
        FROM public.staff_delegations sd
        WHERE sd.listing_id = public.marketplace_products.listing_id
          AND sd.staff_id = auth.uid()
      )
    )
  );

-- UPDATE: Allowed only for owner_id = auth.uid(), actual admin/super_admin, or delegated staff for listing_id
DROP POLICY IF EXISTS "Owners admins and staff can update marketplace products" ON public.marketplace_products;
CREATE POLICY "Owners admins and staff can update marketplace products"
  ON public.marketplace_products
  FOR UPDATE
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND (
      auth.uid() = owner_id
      OR EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.role IN ('admin', 'super_admin')
      )
      OR EXISTS (
        SELECT 1
        FROM public.staff_delegations sd
        WHERE sd.listing_id = public.marketplace_products.listing_id
          AND sd.staff_id = auth.uid()
      )
    )
  )
  WITH CHECK (
    auth.uid() IS NOT NULL
    AND (
      auth.uid() = owner_id
      OR EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.role IN ('admin', 'super_admin')
      )
      OR EXISTS (
        SELECT 1
        FROM public.staff_delegations sd
        WHERE sd.listing_id = public.marketplace_products.listing_id
          AND sd.staff_id = auth.uid()
      )
    )
  );

-- DELETE: Allowed only for owner_id = auth.uid(), actual admin/super_admin, or delegated staff for listing_id
DROP POLICY IF EXISTS "Owners admins and staff can delete marketplace products" ON public.marketplace_products;
CREATE POLICY "Owners admins and staff can delete marketplace products"
  ON public.marketplace_products
  FOR DELETE
  TO authenticated
  USING (
    auth.uid() IS NOT NULL
    AND (
      auth.uid() = owner_id
      OR EXISTS (
        SELECT 1
        FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.role IN ('admin', 'super_admin')
      )
      OR EXISTS (
        SELECT 1
        FROM public.staff_delegations sd
        WHERE sd.listing_id = public.marketplace_products.listing_id
          AND sd.staff_id = auth.uid()
      )
    )
  );

-- 4. Idempotent Sample Seed (8 Local Churachandpur Shop Products)
-- Dynamically resolves existing shop listings & valid profile owners so the seed
-- never fails on FK constraints across clean or pre-seeded environments.
DO $$
DECLARE
  v_fallback_owner uuid;
  v_listing_1 uuid;
  v_owner_1 uuid;
  v_listing_2 uuid;
  v_owner_2 uuid;
  v_listing_3 uuid;
  v_owner_3 uuid;
  v_listing_4 uuid;
  v_owner_4 uuid;
  v_listing_5 uuid;
  v_owner_5 uuid;
  v_listing_6 uuid;
  v_owner_6 uuid;
  v_listing_7 uuid;
  v_owner_7 uuid;
  v_listing_8 uuid;
  v_owner_8 uuid;
BEGIN
  -- Ensure at least one fallback profile exists if sample listings reference an unseeded owner
  SELECT id INTO v_fallback_owner FROM public.profiles ORDER BY created_at ASC LIMIT 1;

  IF v_fallback_owner IS NULL THEN
    RETURN;
  END IF;

  -- Helper resolution against mega-seeded sample business listings (fallback to any published business listing)
  SELECT l.id, COALESCE(p.id, v_fallback_owner)
    INTO v_listing_1, v_owner_1
  FROM public.listings l
  LEFT JOIN public.profiles p ON p.id = l.owner_id
  WHERE l.id = 'f0000000-0000-4000-8000-000000000001'
     OR (l.category = 'business' AND l.status = 'published')
  ORDER BY (l.id = 'f0000000-0000-4000-8000-000000000001') DESC, l.created_at ASC
  LIMIT 1;

  SELECT l.id, COALESCE(p.id, v_fallback_owner)
    INTO v_listing_2, v_owner_2
  FROM public.listings l
  LEFT JOIN public.profiles p ON p.id = l.owner_id
  WHERE l.id = 'f0000000-0000-4000-8000-000000000002'
     OR (l.category = 'business' AND l.status = 'published')
  ORDER BY (l.id = 'f0000000-0000-4000-8000-000000000002') DESC, l.created_at ASC
  LIMIT 1;

  SELECT l.id, COALESCE(p.id, v_fallback_owner)
    INTO v_listing_3, v_owner_3
  FROM public.listings l
  LEFT JOIN public.profiles p ON p.id = l.owner_id
  WHERE l.id = 'f0000000-0000-4000-8000-000000000003'
     OR (l.category = 'business' AND l.status = 'published')
  ORDER BY (l.id = 'f0000000-0000-4000-8000-000000000003') DESC, l.created_at ASC
  LIMIT 1;

  SELECT l.id, COALESCE(p.id, v_fallback_owner)
    INTO v_listing_4, v_owner_4
  FROM public.listings l
  LEFT JOIN public.profiles p ON p.id = l.owner_id
  WHERE l.id = 'f0000000-0000-4000-8000-000000000004'
     OR (l.category = 'business' AND l.status = 'published')
  ORDER BY (l.id = 'f0000000-0000-4000-8000-000000000004') DESC, l.created_at ASC
  LIMIT 1;

  SELECT l.id, COALESCE(p.id, v_fallback_owner)
    INTO v_listing_5, v_owner_5
  FROM public.listings l
  LEFT JOIN public.profiles p ON p.id = l.owner_id
  WHERE l.id = 'f0000000-0000-4000-8000-000000000007'
     OR (l.category = 'business' AND l.status = 'published')
  ORDER BY (l.id = 'f0000000-0000-4000-8000-000000000007') DESC, l.created_at ASC
  LIMIT 1;

  SELECT l.id, COALESCE(p.id, v_fallback_owner)
    INTO v_listing_6, v_owner_6
  FROM public.listings l
  LEFT JOIN public.profiles p ON p.id = l.owner_id
  WHERE l.id = 'f0000000-0000-4000-8000-000000000008'
     OR (l.category = 'business' AND l.status = 'published')
  ORDER BY (l.id = 'f0000000-0000-4000-8000-000000000008') DESC, l.created_at ASC
  LIMIT 1;

  SELECT l.id, COALESCE(p.id, v_fallback_owner)
    INTO v_listing_7, v_owner_7
  FROM public.listings l
  LEFT JOIN public.profiles p ON p.id = l.owner_id
  WHERE l.id = 'f0000000-0000-4000-8000-000000000009'
     OR (l.category = 'business' AND l.status = 'published')
  ORDER BY (l.id = 'f0000000-0000-4000-8000-000000000009') DESC, l.created_at ASC
  LIMIT 1;

  SELECT l.id, COALESCE(p.id, v_fallback_owner)
    INTO v_listing_8, v_owner_8
  FROM public.listings l
  LEFT JOIN public.profiles p ON p.id = l.owner_id
  WHERE l.id = 'f0000000-0000-4000-8000-00000000000b'
     OR (l.category = 'business' AND l.status = 'published')
  ORDER BY (l.id = 'f0000000-0000-4000-8000-00000000000b') DESC, l.created_at ASC
  LIMIT 1;

  IF v_listing_1 IS NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.marketplace_products (
    id, listing_id, owner_id, title, description, price, unit, category, in_stock, thumbnail_url, is_active
  )
  VALUES
    (
      'c0000000-0000-4000-8000-000000000001',
      v_listing_1,
      v_owner_1,
      'Heavy-Duty UV Star Flex Banner (6x4 ft)',
      'Weatherproof outdoor shop signboard & church event flex banner with metal eyelets and same-day printing.',
      650.00,
      'banner',
      'Printing & Signage',
      true,
      NULL,
      true
    ),
    (
      'c0000000-0000-4000-8000-000000000002',
      COALESCE(v_listing_2, v_listing_1),
      COALESCE(v_owner_2, v_owner_1),
      'Manipur Hill Arabica Roast Coffee Beans',
      'Small-batch medium roast whole beans sourced from Churachandpur highlands, freshly packed.',
      420.00,
      '250g pack',
      'Bakery & Food',
      true,
      NULL,
      true
    ),
    (
      'c0000000-0000-4000-8000-000000000003',
      COALESCE(v_listing_3, v_listing_1),
      COALESCE(v_owner_3, v_owner_1),
      'Color-Coated GI Roofing Sheet (0.45mm)',
      'Rust-resistant galvanized iron corrugated roofing sheet ideal for hill monsoon weather.',
      780.00,
      'sheet',
      'Hardware',
      true,
      NULL,
      true
    ),
    (
      'c0000000-0000-4000-8000-000000000004',
      COALESCE(v_listing_4, v_listing_1),
      COALESCE(v_owner_4, v_owner_1),
      'Handwoven Traditional Puandum Wrap',
      'Authentic loom-woven cotton Puandum crafted by local Rengkai and Lamka artisans.',
      1850.00,
      'piece',
      'Handloom & Apparel',
      true,
      NULL,
      true
    ),
    (
      'c0000000-0000-4000-8000-000000000005',
      COALESCE(v_listing_5, v_listing_1),
      COALESCE(v_owner_5, v_owner_1),
      '12V 100Ah Lithium Solar Inverter Battery',
      'Fast-charging LiFePO4 backup battery compatible with home solar charge controllers.',
      14500.00,
      'unit',
      'Electronics & Solar',
      true,
      NULL,
      true
    ),
    (
      'c0000000-0000-4000-8000-000000000006',
      COALESCE(v_listing_6, v_listing_1),
      COALESCE(v_owner_6, v_owner_1),
      'Seasoned Teak Study & Office Desk (4x2 ft)',
      'Hand-finished solid teak wood desk with dual lockable storage drawers.',
      9200.00,
      'piece',
      'Furniture',
      false,
      NULL,
      true
    ),
    (
      'c0000000-0000-4000-8000-000000000007',
      COALESCE(v_listing_7, v_listing_1),
      COALESCE(v_owner_7, v_owner_1),
      'MPSC & UPSC Prelims Complete Study Bundle',
      'Latest edition NCERT summary pack, Manipur GK handbook, and practice OMR booklets.',
      1150.00,
      'set',
      'Books & Stationery',
      true,
      NULL,
      true
    ),
    (
      'c0000000-0000-4000-8000-000000000008',
      COALESCE(v_listing_8, v_listing_1),
      COALESCE(v_owner_8, v_owner_1),
      'Organic Smoked Hill Bamboo Shoot & King Chilli Pack',
      'Hygienically vacuum-sealed local Churachandpur hill pantry combo.',
      340.00,
      '500g combo',
      'Groceries & Pantry',
      true,
      NULL,
      true
    )
  ON CONFLICT (id) DO NOTHING;
END $$;
