# PrintSwift Local — Phase 2: Data Model & Architecture Decision Record

**Date:** 2026-11-12  
**Status:** Approved Architecture Decision Record (ADR)  
**Target Branch:** `main` (`Thangboiahi/PrintSwiftLocal`)

---

## Section 1: Backend Selection — Firebase (Firestore) vs. Supabase (PostgreSQL + PostGIS)

### 1.1 Evaluation Criteria
PrintSwift Local requires a production backend capable of handling:
1. **Geospatial Bounding-Box & Radius Queries**: Real-time filtering of Churachandpur listings within the active map viewport (`north`, `south`, `east`, `west`) and distance sorting.
2. **Property Polygon Storage & Spatial Validation**: Native storage, area/perimeter computation (canonical `m²`), and spatial indexing of multi-vertex real-estate plot boundaries (`POLYGON((lng lat, ...))`).
3. **Granular Multi-Role Access Control**: Enforcing ownership boundaries for `owner` accounts, fine-grained delegated permissions (`edit_details`, `manage_media`, `manage_catalogue`, `reply_enquiries`, `reply_reviews`, `view_analytics`) for `staff` accounts, and the 7 least-privilege `admin` roles.
4. **Relational Integrity & Mandatory Media Rules**: Guaranteeing that `real_estate` listings cannot transition to `published` without at least one validated 2:1 equirectangular 360° panorama (`width >= 2048`, `height >= 1024`).

### 1.2 Technical Comparison

| Capability | Firebase (Firestore) | Supabase (PostgreSQL + PostGIS) |
| :--- | :--- | :--- |
| **Geospatial Viewport Queries** | Limited to geohash prefix range workarounds; requires client-side over-fetching and post-filtering for arbitrary bounding boxes. | Native **PostGIS** `ST_MakeEnvelope` and `GIST` spatial indexes execute exact viewport bounding-box and `ST_DWithin` radius queries in `<5ms`. |
| **Property Polygon Geometry** | Stored as untyped arrays of `{lat, lng}` maps; no server-side polygon validity, intersection, or geodesic area (`ST_Area`) calculation. | Native `GEOGRAPHY(POLYGON, 4326)` and `GEOGRAPHY(POINT, 4326)` types with server-enforced `ST_IsValid` and canonical `ST_Area` (`m²`) triggers. |
| **Row-Level Security (RLS)** | Declarative Security Rules become brittle and expensive (billed per `get()` call) when joining across `staff_delegations` and 7 admin roles. | Native PostgreSQL **Row-Level Security (RLS)** policies with SQL helper functions (`auth.uid()`, role/delegation joins) evaluated directly in the query planner. |
| **Relational & Workflow Constraints** | No foreign keys or cross-collection transactions for enforcing mandatory 360° panoramas on `real_estate` publication. | Strict foreign keys, `CHECK` constraints, and `BEFORE UPDATE` triggers prevent publishing `real_estate` rows lacking a valid 360° panorama in `media`. |
| **Dynamic Category Attributes** | Flexible schemaless documents, but lacks schema validation without custom rule boilerplate. | Combines strict relational columns with indexed `JSONB` for category-specific dynamic attributes validated against the `categories` schema table. |

### 1.3 Recommendation: **Supabase (PostgreSQL 16 + PostGIS)**
**Decision:** Adopt **Supabase (PostgreSQL + PostGIS)** as the target production backend for PrintSwift Local.
- **Why:** PostGIS provides first-class spatial indexing (`GIST`) for both point markers and Real Estate Mode boundary polygons (`GEOGRAPHY(POLYGON, 4326)`), eliminating client-side bounding-box over-fetching. PostgreSQL Row-Level Security (RLS) directly models PrintSwift Local's Owner, Delegated Staff, and 7-Role Admin permission matrix without N+1 rule reads, while SQL triggers enforce mandatory 360° equirectangular panorama rules at the database layer.

---

## Section 2: Database Schema (Relational Data Model)

```sql
-- Enable PostGIS for geospatial point & polygon indexing
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- 1. ENUMS
-- ============================================================================
CREATE TYPE user_role_type AS ENUM ('visitor', 'owner', 'staff', 'admin');

CREATE TYPE admin_role_type AS ENUM (
  'super_admin',
  'listing_moderator',
  'verification_officer',
  'community_moderator',
  'customer_support',
  'finance_admin',
  'analytics_viewer'
);

CREATE TYPE listing_category AS ENUM (
  'business',
  'service',
  'real_estate',
  'sports',
  'public_place'
);

CREATE TYPE listing_status AS ENUM (
  'draft',
  'submitted',
  'pending_verification',
  'published',
  'changes_requested',
  'rejected',
  'suspended',
  'archived',
  'expired'
);

CREATE TYPE property_type AS ENUM (
  'plot_land',
  'house_with_plot',
  'house_without_plot',
  'villa_with_land',
  'apartment',
  'commercial',
  'room_pg'
);

CREATE TYPE media_kind AS ENUM (
  'cover_image',
  'gallery_image',
  'panorama_360',
  'catalogue_product_image'
);

-- ============================================================================
-- 2. USERS TABLE (Roles: Visitor, Owner, Staff, Admin)
-- ============================================================================
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  avatar_label TEXT NOT NULL,
  role_type user_role_type NOT NULL DEFAULT 'visitor',
  admin_role admin_role_type NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT chk_admin_role_consistency CHECK (
    (role_type = 'admin' AND admin_role IS NOT NULL) OR
    (role_type <> 'admin' AND admin_role IS NULL)
  )
);

-- Staff delegation join table for granular per-listing staff permissions
CREATE TABLE staff_delegations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  staff_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  listing_id UUID NOT NULL, -- FK added after listings table creation
  permissions TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (staff_user_id, listing_id)
);

-- ============================================================================
-- 3. CATEGORIES TABLE (Dynamic Attributes & Category Schema Definitions)
-- ============================================================================
CREATE TABLE categories (
  slug listing_category PRIMARY KEY,
  display_name TEXT NOT NULL,
  requires_360_panorama BOOLEAN NOT NULL DEFAULT FALSE,
  supports_boundary_polygon BOOLEAN NOT NULL DEFAULT FALSE,
  subcategories TEXT[] NOT NULL DEFAULT '{}',
  -- JSON Schema / dynamic attribute definitions (key, label, fieldType, required, options)
  dynamic_attributes JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ============================================================================
-- 4. LISTINGS TABLE (ID, Title, Category, Status, Price, Geolocation/Polygon)
-- ============================================================================
CREATE TABLE listings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  owner_id UUID NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  category listing_category NOT NULL REFERENCES categories(slug),
  subcategory TEXT NOT NULL,
  status listing_status NOT NULL DEFAULT 'draft',
  title TEXT NOT NULL,
  short_description TEXT NOT NULL,
  full_description TEXT NOT NULL,
  locality TEXT NOT NULL,
  address TEXT NOT NULL,
  phone TEXT NOT NULL,
  whatsapp TEXT,
  verified BOOLEAN NOT NULL DEFAULT FALSE,
  featured BOOLEAN NOT NULL DEFAULT FALSE,

  -- Pricing & Canonical Area (strictly stored in square metres / m²)
  price_numeric NUMERIC(14, 2) NULL,
  price_label TEXT NULL,
  property_type property_type NULL,
  has_associated_plot BOOLEAN NOT NULL DEFAULT FALSE,
  plot_area_sqm NUMERIC(12, 2) NULL CHECK (plot_area_sqm IS NULL OR plot_area_sqm > 0),
  built_up_area_sqm NUMERIC(12, 2) NULL CHECK (built_up_area_sqm IS NULL OR built_up_area_sqm > 0),

  -- PostGIS Geolocation Point & Optional Property Boundary Polygon (SRID 4326)
  location GEOGRAPHY(POINT, 4326) NOT NULL,
  boundary_polygon GEOGRAPHY(POLYGON, 4326) NULL,

  -- Category-specific structured details & dynamic custom attributes
  category_details JSONB NOT NULL DEFAULT '{}'::jsonb,
  custom_attributes JSONB NOT NULL DEFAULT '{}'::jsonb,

  -- Engagement counters
  views_count INTEGER NOT NULL DEFAULT 0,
  enquiries_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Conditional Rule #28: Boundary polygons & plot area only permitted on plot-bearing real estate
  CONSTRAINT chk_real_estate_polygon_rule CHECK (
    boundary_polygon IS NULL OR (
      category = 'real_estate' AND (
        property_type = 'plot_land' OR
        (property_type IN ('house_with_plot', 'villa_with_land') AND has_associated_plot = TRUE)
      )
    )
  )
);

ALTER TABLE staff_delegations
  ADD CONSTRAINT fk_staff_delegations_listing
  FOREIGN KEY (listing_id) REFERENCES listings(id) ON DELETE CASCADE;

-- Spatial GIST indexes for fast viewport bounding-box and polygon queries
CREATE INDEX idx_listings_location_gist ON listings USING GIST (location);
CREATE INDEX idx_listings_boundary_polygon_gist ON listings USING GIST (boundary_polygon)
  WHERE boundary_polygon IS NOT NULL;
CREATE INDEX idx_listings_category_status ON listings (category, status);

-- ============================================================================
-- 5. MEDIA TABLE (Images & Mandatory 2:1 Equirectangular 360° Panoramas)
-- ============================================================================
CREATE TABLE media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  listing_id UUID NOT NULL REFERENCES listings(id) ON DELETE CASCADE,
  kind media_kind NOT NULL,
  scene_name TEXT NOT NULL,
  storage_url TEXT NOT NULL,
  width_px INTEGER NOT NULL CHECK (width_px > 0),
  height_px INTEGER NOT NULL CHECK (height_px > 0),
  is_equirectangular BOOLEAN NOT NULL DEFAULT FALSE,
  is_primary BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  initial_yaw NUMERIC(6, 2) DEFAULT 0,
  initial_pitch NUMERIC(6, 2) DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Enforce strict 2:1 equirectangular dimensions (>= 2048x1024) on all 360° panoramas
  CONSTRAINT chk_panorama_360_dimensions CHECK (
    kind <> 'panorama_360' OR (
      is_equirectangular = TRUE AND
      width_px >= 2048 AND
      height_px >= 1024 AND
      width_px = (height_px * 2)
    )
  )
);

CREATE INDEX idx_media_listing_kind ON media (listing_id, kind);
```
