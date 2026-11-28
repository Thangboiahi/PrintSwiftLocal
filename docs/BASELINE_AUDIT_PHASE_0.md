# PrintSwift Local — Phase 0: Post-Step-4F Baseline Audit Report

**Date:** 2026-11-12  
**Status:** Read-Only Baseline Audit Complete (Post-Step-4F Closure)  
**Target Branch:** `main` (`Thangboiahi/PrintSwiftLocal`)

---

## Architecture

PrintSwift Local is structured as a modular Next.js 15 App Router TypeScript application with strict separation between domain rules, deterministic synthetic seed generation, client-side state persistence, and responsive UI workspaces:

- **Application Shell & Routing (`app/`, `components/AppShell.tsx`)**:
  - `app/layout.tsx` & `app/page.tsx`: Root layout and dynamic entry point injecting Google Maps API configuration into `<AppShell />`.
  - `components/AppShell.tsx`: Coordinates the 5 primary destinations (`explore`, `saved`, `activity`, `workspace`, `profile`), responsive navigation postures (desktop top bar, mobile/tablet portrait bottom bar, mobile landscape vertical rail) with `aria-current="page"` semantics, locality quick-selector, and simulated multi-role account switching.
- **Discovery & Geospatial Workspace (`components/discovery/`)**:
  - `DiscoveryWorkspace.tsx`: Core split-screen and mobile bottom-sheet map/list discovery engine, viewport/global search scope synchronization, marker clustering, geolocation handler, and real-estate polygon/label rendering.
  - `FloatingMapToolbar.tsx`: Dockable 6-zone map control bar with base-map style popover, map legend, zoom controls, Locate Me, Return to Default Centre, Full-Screen toggle, and conditional Draw & Measure trigger.
  - `DrawMeasureToolbox.tsx`: Dockable geospatial drawing and measurement suite (Point, Line, Polygon, Rectangle, Circle) with canonical metric computation and "Create Listing Here" handoff.
  - `SelectedListingCard.tsx` & `FilterDrawerModal.tsx`: Responsive selected-listing preview card (44×44 px accessible icon actions, quick Zoom to Item, Center on Map) and category-aware filter modal.
- **Category Details & Real Estate Media (`components/listings/`, `components/real-estate/`)**:
  - `CategoryDetailView.tsx`: Full-page and modal detail view supporting all 5 categories (`business`, `service`, `real_estate`, `sports`, `public_place`).
  - `PanoramaViewer360.tsx` & `PropertyBoundaryMap.tsx`: Interactive 2:1 equirectangular 360° panorama viewer and dedicated plot boundary preview.
- **Role-Based Workspaces & Shared Primitives (`components/workspaces/`, `components/shared/`)**:
  - `OwnerStaffWorkspace.tsx`: Listing CRUD editor, 360° panorama validation, XLSX/CSV batch import, product catalogues, enquiries, reviews, analytics, and staff permission delegation.
  - `AdminWorkspace.tsx`: 7-role least-privilege administrative command centre, user/role matrix, verification/moderation queues, geographic QA, dynamic schema fields, and audit logs.
  - `InteractiveVectorMap.tsx`, `ThemeSettingsModal.tsx`, `DataTable.tsx`, `PrintSwiftAssistant.tsx`: Cloud-styled SVG fallback map renderer, theme/unit/mode preferences modal, sortable data table, and read-only contextual help assistant.
- **Domain Logic, State & Seed Data (`lib/`)**:
  - `types.ts`: Canonical TypeScript interfaces and domain enums.
  - `rules.ts` & `rules.test.ts`: Pure geospatial, unit-conversion (canonical `sqm`), 360° panorama validation, RBAC permission matrix, and responsive layout profile functions backed by 24 unit tests.
  - `store.tsx`: React Context state container and `useSyncExternalStore` hooks for concurrent-safe `localStorage` synchronization.
  - `seed-data.ts`, `media-generator.ts`, `map-cloud-styles.ts`, `excel-utils.ts`: 80 deterministic Churachandpur (Lamka) sample listings, procedural SVG/equirectangular data-URI generators, Google Cloud map style palettes, and spreadsheet import/export helpers.

---

## Feature Status

All Step 4A through Step 4F packages are implemented, verified, and active in the baseline:

1. **Responsive Cards, Toolbar & Sample Disclosure (Step 4F-A)**:
   - Prominent top prototype banner removed from the discovery viewport; non-intrusive synthetic data disclosure retained in `ThemeSettingsModal.tsx`.
   - `SelectedListingCard.tsx` refined across mobile, tablet, and desktop with 44×44 px icon-only secondary actions, accessible labels/titles, and distinct **Zoom to Item** vs **Center on Map** actions.
2. **On-Demand Geolocation & Configurable Default Map Centre (Step 4F-B)**:
   - Explicit user-triggered **Locate Me** control in `FloatingMapToolbar.tsx` and `DiscoveryWorkspace.tsx` using `navigator.geolocation.getCurrentPosition` (no background tracking or mount-time prompts) with accessible status/error feedback (`role="status"`).
   - Persistent custom default map centre (`printswift_local_custom_default_center_v1`) configurable in `ThemeSettingsModal.tsx` with **Use Current Map Centre** and **Reset to District Default** controls.
3. **Simple Mode (Step 4F-C)**:
   - Exported `useSimpleMode` (`printswift_local_simple_mode_v1`, default `false`) in `lib/store.tsx` using `useSyncExternalStore`.
   - Bound to the **Simple Mode** toggle in `ThemeSettingsModal.tsx`; when enabled, hides advanced drawing/measuring controls and `DrawMeasureToolbox` while preserving core map navigation actions at ≥44×44 px touch targets.
4. **Real Estate Mode — Filtering, Polygons & Labels (Step 4F-D1 & Step 4F-D2)**:
   - Exported `useRealEstateMode` (`printswift_local_real_estate_mode_v1`, default `false`) in `lib/store.tsx` and bound to the **Real Estate Mode** toggle in `ThemeSettingsModal.tsx`.
   - Filters active discovery listings exclusively to `category === 'real_estate'` across map markers, clusters, and side-panel results.
   - Renders interactive property boundary polygons and centroid Price / Plot Area labels on both `<GoogleMap>` and `<InteractiveVectorMap>` strictly for listings with valid boundary geometry (`shouldShowPlotAndBoundary` and `boundaryPolygon.length >= 3`), never fabricating geometry for point-only listings, and highlights the selected property polygon/label in sync with `selectedListing`.
5. **Accessibility & Integrated Regression Closure (Step 4F-E)**:
   - Dynamic `aria-current="page"` semantics applied across desktop global navigation, mobile bottom navigation, mobile landscape vertical rail, header quick-navigation buttons, and Owner/Staff/Admin workspace section navigation bars.

---

## Synthetic Data Compliance

The application strictly operates as a self-contained client-side prototype with zero live backend or external database dependencies:

- **100% Synthetic Seed Dataset**: All 80 Churachandpur listings, 12 simulated user accounts (Visitor, Owner, Staff, and 7 Admin roles), enquiries, reviews, notifications, verification requests, moderation cases, and audit logs originate deterministically from `lib/seed-data.ts` and `lib/media-generator.ts`.
- **Browser-Local Persistence Only**: All user mutations and preferences persist exclusively in browser `localStorage` under namespaced keys:
  - `printswift_local_demo_state_v1`
  - `printswift_local_drawn_shapes_v1`
  - `printswift_local_theme_v1`
  - `printswift_local_map_style_v1`
  - `printswift_local_map_cloud_config_v1`
  - `printswift_local_split_pct_v1`
  - `printswift_local_custom_default_center_v1`
  - `printswift_local_simple_mode_v1`
  - `printswift_local_real_estate_mode_v1`
- **No External Backend / API Mutations**: Aside from optional client-side Google Maps JS SDK tile rendering when `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` is provided (with automatic fallback to the local `InteractiveVectorMap` SVG renderer), no network requests, external databases, or server-side persistence layers are invoked.

---

## Technical Debt

1. **Large Monolithic Component Files**:
   - `components/discovery/DiscoveryWorkspace.tsx` (~4,870 lines), `components/workspaces/OwnerStaffWorkspace.tsx` (~3,080 lines), and `lib/store.tsx` (~1,900 lines) consolidate multiple sub-views, modals, and state handlers into single files. Future modular decomposition into smaller sub-components and domain hooks will improve maintainability.
2. **Full-State Serialization in `localStorage`**:
   - Persisting the entire 80-listing dataset (including procedural SVG data-URIs) inside a single `localStorage` JSON payload (`printswift_local_demo_state_v1`) is subject to browser ~5 MB storage quotas if users batch-import large numbers of custom listings or high-resolution base64 panoramas.
3. **Automated UI / E2E Test Coverage**:
   - Pure domain and layout rules in `lib/rules.test.ts` have comprehensive unit test coverage (24/24 passing), but interactive DOM flows (modal focus trapping, Google Maps vs. Vector Map polygon clicks, and `useSyncExternalStore` cross-tab synchronization) rely on manual/browser regression checks rather than automated component or Playwright tests.
