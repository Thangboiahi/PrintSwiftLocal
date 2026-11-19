# Completed Modules

### Step 4F-C: Simple Mode
**Status:** Completed
**Description:** Implemented persistent Simple Mode toggle hiding advanced Terra Draw tools.

### Step 4F-D1: Real Estate Mode Filtering
**Status:** Completed
**Description:** Implemented persistent Real Estate Mode toggle. Aggressively filters the discovery workspace to display only property listings, syncing both the map viewport and the side panel.

### Step 4F-D2: Real Estate Polygons & Labels
**Status:** Completed
**Description:** Implemented interactive property boundary polygons and on-map price/area labels for Real Estate Mode, fully synchronized with the listing selection state.

### Step 4F-E: Integrated Regression & Closure
**Status:** Completed
**Description:** Verified Step 4F features (Simple Mode, Real Estate Mode, Geolocation) against the accessibility and responsive baseline. Addressed `aria-current="page"` navigation semantics. Step 4F is now formally closed.

### Phase 1-A: Workflow State Management
**Status:** Completed
**Description:** Validated user journeys by implementing robust Loading, Empty, and Error state UI components in the discovery workspace, preparing the frontend for asynchronous backend latency.

### Phase 1-B: Simulated Async Fetching & Error Recovery
**Status:** Completed
**Description:** Validated frontend resilience by simulating backend network latency and failure conditions, successfully triggering and recovering from Loading and Error UI states.

### Phase 2: Product Data Model & Architecture
**Status:** Completed
**Description:** Drafted the formal relational database schema (Users, Listings, Media, Categories) and evaluated Supabase vs. Firebase for geospatial querying capabilities.

### Phase 3-A: Supabase Client Foundation
**Status:** Completed
**Description:** Established the Supabase client connection utility and basic authentication state management hooks, laying the groundwork for the production backend.

### Phase 3-B: Authentication UI
**Status:** Completed
**Description:** Built the frontend Authentication modal and integrated Supabase session listeners. The navigation header now dynamically reflects the user's logged-in status.

### Phase 3-C: Listing CRUD Operations
**Status:** Completed
**Description:** Built the backend service functions for creating, reading, updating, and deleting listings via Supabase, and wired them into the Owner workspace.

### Phase 3-D: Media Storage
**Status:** Completed
**Description:** Established Supabase storage integration for listing galleries and mandatory 360° panoramas, including client-side MIME type and size validation.

### Phase 4-A: Owner Dashboard & Analytics
**Status:** Completed
**Description:** Upgraded the Owner workspace with synthetic metric widgets (views, clicks) and a listing completeness indicator to guide owners toward publication requirements.

### Phase 4-B: Admin Workspace & Verification
**Status:** Completed
**Description:** Built the administrative moderation queue and verification controls (Approve, Reject, Request Changes) to manage listing lifecycles.

### Phase 5: Functional Integration & QA
**Status:** Completed
**Description:** Unified the frontend UI with the live Supabase backend. Connected the main discovery map to live published listings and fortified the application with a Global Error Boundary to gracefully handle network/rendering failures.

### Phase 6: Production Hardening
**Status:** Completed
**Description:** Hardened the application for production by finalizing SEO metadata, implementing strict environment variable validation, and documenting API key security protocols.

### Phase 8-A: Supplementary Public Pages
**Status:** Completed
**Description:** Built out essential consumer-facing static routes (About Us and Contact) for district information and support inquiries.

### Phase 8-B: User & Auth Pages
**Status:** Completed
**Description:** Built out the remaining supplementary routes for User Profile, Settings, and dedicated Authentication pages.

### Phase 9-A: UX Refinement Loop
**Status:** Completed
**Description:** Systematically optimized touch target accessibility across mobile toolbars and improved form validation and loading state feedback within core dialogs.

### Phase 10: Global Skeleton Loading
**Status:** Completed
**Description:** Integrated Tailwind `animate-pulse` skeletal shimmers and Next.js `loading.tsx` Suspense boundaries to provide seamless visual feedback during route transitions and data fetches.

### Phase 11-A: PWA & Offline Support
**Status:** Completed
**Description:** Upgraded the application to a Progressive Web App (PWA) with Service Worker caching and an offline notification banner to handle patchy rural connectivity.

### Phase 11-B: Geospatial Marker Clustering
**Status:** Completed
**Description:** Integrated dynamic map marker clustering to maintain high UI performance and clarity as the listing database scales across the district.

### Phase 11-C: Multilingual UI
**Status:** Completed
**Description:** Integrated `next-intl` to support English, Manipuri, and local dialects, establishing the foundation for full platform localization.

### Phase 11-D: Automated Verification Webhooks
**Status:** Completed
**Description:** Established the backend edge function infrastructure to trigger automated SMS/WhatsApp notifications to owners upon listing approval or rejection.

### Phase 12-A: Category-Specific Detail Pages
**Status:** Completed
**Description:** Established dynamic routing and conditional UI scaffolding for individual public listing pages, fetching live data directly from the Supabase backend.

### Phase 12-B: Conditional Real Estate Fields
**Status:** Completed
**Description:** Upgraded the dynamic listing detail page to render property-specific metrics, embedded 360° panoramas, and read-only property boundary maps exclusively for real estate entities.

### Phase 12-C: Business & Service Details
**Status:** Completed
**Description:** Finalized the dynamic listing page by building tailored UI sections for businesses, services, and public interest entities, ensuring all category-specific database fields are presented cleanly.

### Phase 13-A: Enquiries & Messaging
**Status:** Completed
**Description:** Established a direct communication channel allowing public visitors to send enquiries to listing owners, supported by a new secure Supabase table.

### Phase 13-B: Reviews & Owner Replies
**Status:** Completed
**Description:** Established a community feedback loop featuring 1-5 star ratings, public comments, and dedicated owner reply blocks, backed by a new secure Supabase table.

### Phase 13-C: Staff Delegation
**Status:** Completed
**Description:** Activated the staff delegation workspace, allowing listing owners to assign explicit, limited management permissions to local agents and team members.

### Phase 14-A: Reusable Management Tables
**Status:** Completed
**Description:** Standardized the administrative backend by building a responsive, multi-filter data table with sorting and pagination, replacing static lists in the Admin Workspace.

### Phase 14-B: Excel Import/Export
**Status:** Completed
**Description:** Established secure CSV data pipelines enabling administrators to export platform data for offline analysis and perform bulk imports/updates.

### Phase 15-A: PrintSwift Assistant Chatbot
**Status:** Completed
**Description:** Deployed a globally accessible, floating FAQ widget providing instant, deterministic platform guidance for visitors and administrators without requiring external AI API keys.

### Phase 16: Fluid Initialization
**Status:** Completed
**Description:** Eliminated rigid UI flashing by implementing framer-motion splash screens, dynamic map status pills, and fluid viewport transitions.

### Phase 17: Advanced Geospatial UX
**Status:** Completed
**Description:** Upgraded the mapping experience with custom geolocation permission flows and live turn-by-turn polyline routing to listings.

### Phase 18: Commercial Auth
**Status:** Completed
**Description:** Upgraded to enterprise-grade authentication (Google OAuth, Phone OTP) and established a multi-step user onboarding flow to capture distinct platform roles.

### Phase 19: User Profiles
**Status:** Completed
**Description:** Expanded the user data model and built a polished profile editing interface supporting avatars and JSONB social link management.

### Phase 20: Cross-Platform Interlinking
**Status:** Completed
**Description:** Acted as the 'glue' for the platform by unifying the AppShell routing context and embedding seamless deep links between discovery maps, workspaces, and public profiles.

### Phase 21: Assistant & Polish
**Status:** Completed
**Description:** Elevated the final product feel by transforming the support chatbot into a draggable widget and applying commercial-grade hover states, shadows, and scrollbar refinements.

### Phase 22: Minimalist Overhaul
**Status:** Completed
**Description:** Stripped away template cruft to enforce a modern minimalist aesthetic and implemented cohesive global loading skeletons.

### Phase 23: Auth & Onboarding Perfection
**Status:** Completed
**Description:** Upgraded the authentication and onboarding workflows with premium, minimalist UI and robust client-side validation.

### Phase 24: Deep Interlinking
**Status:** Completed
**Description:** Eliminated functional silos by deeply interlinking the map, user profiles, and workspaces via a unified global navigation architecture.

### Phase 25-A: Workspace Header & Layout UI
**Status:** Completed
**Description:** Decluttered the top hierarchy by unifying settings/profile menus, embedding directory toggles into the search block, and enforcing strict boundaries for the collapsible side panel.

### Phase 25-B: Map UX & Micro-Interactions
**Status:** Completed
**Description:** Polished map interactions by emulating Zillow's real estate price bubbles, slimming toolbars, securing draggable physics, and adding a center-pin fallback for directions.

### Phase 26: Mobile Search & Responsive Architecture
**Status:** Completed
**Description:** Polished the mobile-first search experience with smooth focus transitions and history suggestions, secured the workspace tab via role-based conditional rendering, and eliminated layout overflow.

### Phase 27: Filters, Lists & Data Synchronization
**Status:** Completed
**Description:** Polished category filters with quantity badges and horizontal scrolling, synchronized the global Saved items badge, and resolved mobile panel visual bleeding.

### Phase 28: Map States & Chatbot Physics
**Status:** Completed
**Description:** Resolved legacy Directions API routing errors for accurate road polyline drawing, enforced universal map loading states, and perfected the draggable chatbot widget physics.

### Phase 29: Filter Consolidation & Mobile UI Fixes
**Status:** Completed
**Description:** Consolidated the discovery toolbars into a single scrollable row, resolved vertical stacking bugs on the mobile bottom nav during keyboard focus, and refined listing card selection states.

### Phase 30: Live Users & Media
**Status:** Completed
**Description:** Eliminated demo owner data in favor of live Supabase profile fetches, established the remote image storage pipeline, and refined the Directions UX for editable origins.

### Phase 31: Auth Sync & RBAC
**Status:** Completed
**Description:** Secured the platform by syncing the user's Supabase profile role to the frontend state, enforcing strict UI visibility, and protecting operational workspaces from unauthorized access.

### Phase 32: Super Admin Governance
**Status:** Completed
**Description:** Empowered Super Admins with a dedicated dashboard to manage user roles, toggle platform-wide settings (like sample data visibility), and enforced strict backend Row Level Security.

### Phase 33: Role-Specific CRUD Operations
**Status:** Completed
**Description:** Locked down listing management via RLS, ensuring Owners retain full destructive rights while Staff are safely constrained to update-only permissions.

### Phase 34: Live Notifications & Activity Sync
**Status:** Completed
**Description:** Replaced static demo notifications with a live, database-driven alerts system powered by automated PostgreSQL triggers and real-time frontend state sync.

### Phase 35: Real-Time Subscriptions
**Status:** Completed
**Description:** Upgraded the application to real-time using Supabase WebSockets, enabling instant UI updates for incoming notifications and user enquiries without page reloads.

### Phase 36: Automated SEO & Dynamic Sitemaps
**Status:** Completed
**Description:** Ensured local listings rank on Google by automatically generating dynamic XML sitemaps and injecting rich OpenGraph social sharing images for every live listing.

### Phase 37: Advanced PWA Media Caching
**Status:** Completed
**Description:** Optimized the Progressive Web App by aggressively caching high-resolution images and 360° panoramas via Service Worker, drastically improving performance and offline resilience on patchy networks.

### Phase 38: Over-The-Air Localization
**Status:** Completed
**Description:** Shifted localization dictionaries to the database, empowering Super Admins to instantly update UI strings in English, Paite, and Meitei without redeploying code.

### Phase 39: Navigation & UI Refinements
**Status:** Completed
**Description:** Polished structural layouts by securing the header for authenticated users, pinning the Map/List toggles alongside scrollable filters, and implementing smart scroll-hiding for mobile navigation.

### Phase 39-B: Fluid Navigation Physics
**Status:** Completed
**Description:** Polished the smart sticky header by implementing scroll/drag thresholds to prevent accidental triggering, and introduced a smooth floating logo for map context when the header is hidden.

### Phase 40: Map UX & Routing
**Status:** Completed
**Description:** Resolved z-index clipping by transitioning the Sort menu to a fixed popup, enabled a draggable map toolbar, enforced safe header clearances for map overlays, and upgraded the directions UI with customizable origin and destination inputs.

### Phase 41: Geospatial Data & Clustering
**Status:** Completed
**Description:** Resolved map stacking issues by writing a SQL dispersion script for diverse coordinate placement, and upgraded the MarkerClusterer logic to dynamically isolate the currently selected listing.

### Phase 42: Hyper-Realistic Mega-Seeder
**Status:** Completed
**Description:** Engineered a programmatic data-seeding engine to populate the Supabase database with 50+ diverse, interrelated Churachandpur listings, reviews, and distinct geographic coordinates.

### Phase 44: Production Launch & Security
**Status:** Completed
**Description:** Finalized the platform for public deployment by locking down Row Level Security and restricting API keys.

### Phase 45: Minimalist Overhaul & Skeletons
**Status:** Completed
**Description:** Stripped away template cruft to enforce a strict minimalist aesthetic and integrated cohesive global loading skeletons.

### Phase 46: Auth & Onboarding Perfection
**Status:** Completed
**Description:** Upgraded the authentication and onboarding workflows with premium, minimalist UI (floating labels) and robust client-side validation.

### Phase 47: Profile & Authorization
**Status:** Completed
**Description:** Established the authenticated user profile view for managing saved data, and enforced client-side route protection to secure user-specific views.

### Performance Optimization: LCP Image Priority
**Status:** Completed
**Description:** Resolved Next.js Largest Contentful Paint (LCP) warnings by adding the `priority` attribute to above-the-fold listing hero images.

### Phase 48: Role-Based Workspaces & CRUD
**Status:** Completed
**Description:** Enforced strict role-based access control (RBAC) on operational routes and activated live Supabase CRUD capabilities for listing owners and administrators.

### Phase 49: Notifications & Activity Feeds
**Status:** Completed
**Description:** Wired the frontend UI to display live database notifications and activity logs, establishing the global alert bell and workspace activity timelines.

### Phase 49-A: Auth Validators, Role Governance & Avatar Cropper
**Status:** Completed
**Description:** Built the regex and error mapping engine, enforced visitor-by-default and hardcoded super-admin role governance in Postgres, and implemented an HTML5 canvas avatar cropper with WebP compression.

### Phase 49-B: Stepwise Email Auth & Recovery
**Status:** Completed
**Description:** Replaced third-party auth providers with a strict stepwise Email OTP + Password signup, login, and recovery modal featuring complete profile onboarding, granular error handling, default visitor roles, and hardcoded super-admin governance.

### Phase 49-C: Custom Server-Side Resend OTP API
**Status:** Completed
**Description:** Bypassed Supabase SMTP restrictions by implementing a direct Next.js API route using the Resend HTTP SDK and a secure temporary PostgreSQL table.

### Phase 49-D: Avatar Cropper UI & Storage Resilience
**Status:** Completed
**Description:** Refactored AvatarCropUploader into a clean vertical mobile-first layout eliminating slider/button clipping and added graceful skip fallback for storage errors.

### Phase 49-E: Service-Role Auth & Upload Hardening
**Status:** Completed
**Description:** Hardened authentication and avatar uploads using Next.js service-role endpoints and safe JSON fetch wrappers, eliminating client-side RLS and email confirmation blockers.

### Phase 49-F: OTP Verification Sync, Modal Header Layering & Country Code Phone Input
**Status:** Completed
**Description:** Synchronized custom Resend OTP verification across signup and recovery, fixed z-index layering between sticky modal headers and the avatar cropper, and implemented a country-code phone selector with India (+91) and timezone auto-detection.

### Phase 49-G: Stateless HMAC OTP Verification
**Status:** Completed
**Description:** Implemented cryptographically signed stateless OTP tokens using HMAC-SHA256, eliminating false expiry errors caused by RLS or sandbox environment limits.

### Phase 49-H: Anon-Compatible Verified Signup & Modal Event Isolation
**Status:** Completed
**Description:** Eliminated service-role Bearer token failures during signup via a SECURITY DEFINER Postgres RPC and implemented strict scroll/pointer containment across Auth and Settings modals so map interactions never bleed through.

### Phase 49-J: Auth Error Clarity & Half-Created Account Guard
**Status:** Completed
**Description:** Refined Supabase error mapping to distinguish unconfirmed or existing accounts from password mismatches and hardened complete-signup against partial test records.

### Phase 49-K: Direct RPC Password Reset
**Status:** Completed
**Description:** Connected password recovery completion to a SECURITY DEFINER Postgres RPC so password updates persist reliably across all environments.

### Phase 49-L: Direct RPC Verified User & Profile Creation
**Status:** Completed
**Description:** Eliminated Supabase confirmation mailer failures during signup by delegating verified user and profile creation to a single SECURITY DEFINER Postgres RPC.

### Phase 49-M: Signup Form Ergonomics, Welcome Popup, Draggable Route Card & Landscape Nav
**Status:** Completed
**Description:** Polished signup form field proportions and hints, added a post-signup welcome modal state, enabled free dragging on the map directions panel, and restored sticky-header-aligned vertical navigation on mobile landscape.

### Phase 49-N: Map Logo & Search Pill Geometric Alignment
**Status:** Completed
**Description:** Removed text from the floating map logo and locked a consistent 12px relative Y/X-axis offset inside the map canvas so the map logo and "Search This Area" pill stay strictly aligned across header and navigation orientation changes.

### Phase 49-O: Supabase Realtime Channel Lifecycle Fix
**Status:** Completed
**Description:** Eliminated duplicate channel subscription crashes on route transitions and Strict Mode mounts by enforcing unique channel instance IDs, try/catch guards, and proper `supabase.removeChannel()` cleanup.

### Phase 49-P: Layout Universality & Nav Sync
**Status:** Completed
**Description:** Stripped redundant page paddings in favor of a universal AppShell layout, fixed notification bell framing, and synchronized the bookmark badge counts via global events.

### Phase 49-Q: Profile Renovation & Workspace Fix
**Status:** Completed
**Description:** Built a centralized, minimalist Profile page that delegates bulky actions (bookmarks, activities, settings, workspace) to sub-pages, and resolved real workspace overlapping issues by deferring to AppShell padding.

### Phase 49-R: Dynamic Logo & Route Loading State
Status: Completed
Description: Merged the global status pill into the primary navbar logo. Intercepts local clicks to trigger a framer-motion spinning loop and smooth text replacement ("Loading...") during Next.js server component fetches.

### Phase 49-S: Navbar Z-Index & Mobile Popup Centering
**Status:** Completed
**Description:** Elevated the global Navbar z-index to 60 to prevent page content from blocking clicks on non-map pages, and refactored the Notification bell dropdown to be perfectly centered on mobile screens using fixed positioning.

### Phase 49-T: Avatar Rendering & Nav State Sync
**Status:** Completed
**Description:** Wired up the `avatar_url` from public.profiles to render real images (with initial fallbacks) across the Navbar and Profile page, and fixed the Bottom/Vertical navigation to accurately highlight the active route.

### Phase 49-U: Landing Page & Dockable Assistant
**Status:** Completed
**Description:** Graduated the app architecture by introducing a dedicated homepage, moving the discovery map to /explore, fixing storage public URL resolution for avatars, and upgrading the chatbot into a draggable edge toolbox.

### Phase 49-V: Global Media Tracking & Edit Profile Fix
**Status:** Completed
**Description:** Established a central public.media_assets tracker to link all bucket uploads to sources. Abandoned signup images are tagged as temporary for database auto-cleanup, and Edit Profile avatar uploads are now fully functional and instantly linked.

### Phase 49-W: Avatar Preview & Super User Role Toggle
**Status:** Completed
**Description:** Refactored the Edit Profile avatar component to function as a preview-only cropper that relies on standard form submission to persist. Engineered a secure, cookie-driven role override system allowing administrators to test subordinate UI experiences seamlessly.

### Phase 49-X: Edit Profile Permissions & Feedback
**Status:** Completed
**Description:** Resolved RLS "permission denied" errors during profile saves by correcting the Supabase table target from users to profiles. Added immediate visual success feedback banners upon successful form submission.

### Phase 49-Y: Custom Role Toggle & Interactive Map Preferences
**Status:** Completed
**Description:** Engineered a smooth framer-motion custom modal for super user role-switching, fixed server-side cookie evaluation so subordinate role perspectives persist cleanly on reload, and built a crosshair-guided interactive map location picker backed by user profile storage.

### Phase 49-Z: Advanced Role Override & Profile Loaders
**Status:** Completed
**Description:** Engineered a dual-role checking mechanism permitting Owners and Admins to safely preview subordinate perspectives. Standardized responsive modal containment preventing overflow on mobile screens and integrated Next.js loading skeletons for instantaneous layout rendering on the profile hub.

### Phase 50-A: Session Roles & App Suspense
**Status:** Completed
**Description:** Resolved persistent role testing by injecting an effective vs. actual role state directly into the server session. Deployed instantaneous visual skeletons across major route transitions.

### Phase 50-B: Data Optimization & Infinite Scroll
**Status:** Completed
**Description:** Drastically reduced bandwidth consumption by limiting bulk queries to brief summary fields, implementing range-based infinite scrolling, and fetching full listing details exclusively upon user selection.

### Phase 51-A: Universal Scaling & Dynamic CSS Color Engine
**Status:** Completed
**Description:** Implemented a root `rem` UI scaling engine (`--ui-scale`), a 3-tier HSL CSS variable color system (`--color-primary`, `--color-secondary`, `--color-accent`), strict nested flex/button containment rules in `app/globals.css`, and a global `ThemeScaleProvider` synced to `localStorage` and `document.documentElement.style`.

### Phase 51-B: Custom Settings UI & Universal Modal Select
**Status:** Completed
**Description:** Replaced native HTML `<select>` controls with a reusable Framer Motion `CustomSelectModal` bottom-sheet/modal component, and upgraded the Settings page with interactive UI Scale selectors (`Small (14px)`, `Medium (16px)`, `Large (18px)`) and 3-tier Hex-to-HSL color pickers (`--color-primary`, `--color-secondary`, `--color-accent`).

### Phase 52-A: Unified Settings & GPS Recenter
**Status:** Completed
**Description:** Merged fragmented preferences and settings into a single unified `/settings` interface. Engineered a dual-persistence hook (`useSettings`) that saves authenticated user choices to Supabase `public.profiles` while falling back to `localStorage` for unauthenticated visitors, and integrated native HTML5 Geolocation API to allow instant GPS-based default map recentering.

### Phase 52-B: Scroll Physics & Nested UI Uniformity
**Status:** Completed
**Description:** Upgraded sticky header scroll physics to require both distance (`scrollY > 300`) and velocity (`delta > 40px`) before hiding while revealing immediately on upward scroll, throttled `ListingFeed` `IntersectionObserver` `rootMargin` to `150px`, and added `.toolbar-container` and `.nested-ui` relative `em` scaling in `app/globals.css`.

### Phase 53-A: Scroll Physics, Centered Modals & Nested UI Refactor
**Status:** Completed
**Description:** Desensitized sticky header scroll triggers to require both `scrollY > 600` and velocity `delta > 120` before hiding while revealing immediately on any upward scroll, replaced fixed heights on nested map filter/toolbar buttons with uniform fluid padding (`py-1.5 px-3 text-sm leading-tight h-auto flex-shrink-0 flex items-center justify-center`), and enforced strict screen centering (`fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4` with `w-full max-w-sm max-h-[80dvh] overflow-y-auto`) on `CustomSelectModal`.

### Phase 53-B: Settings Consolidation, Spacing & Auth-Gating
**Status:** Completed
**Description:** Merged Website Appearance Mode and Custom Interface Colors into a unified "Theme & Appearance" section separated by a clean horizontal divider, improved Default Map Centre button stack spacing (`mb-4` coordinate readout and `flex flex-col gap-3 mt-5` button stack), and introduced auth-gated "Account & Security", "Notifications & Communications", and "Data & Privacy" (`Clear Local Cache`) panels in `app/settings/page.tsx`.

### Phase 54-A: 3-Axis Scaling Engine & Hook Overhaul
**Status:** Completed
**Description:** Replaced static single-variable scaling with a 3-axis CSS variable matrix (`--scale-text`, `--scale-pad`, `--scale-space`) and fluid component utilities (`.fluid-btn`, `.fluid-input`, `.fluid-card`, `.fluid-icon`) in `app/globals.css`, extended `tailwind.config.ts` with `fluid-gap` and `fluid-pad` spacing tokens, and upgraded `useSettings` with `{ text, pad, space }` state management and `setSmallPreset()`, `setMediumPreset()`, and `setLargePreset()` helpers.

### Phase 54-B: 3-Axis Scaling UI Interface
**Status:** Completed
**Description:** Upgraded `app/settings/page.tsx` with a "Global Interface Scale" panel featuring three master preset buttons ("Compact (Small)", "Standard (Medium)", "Relaxed (Large)") and an expandable "Advanced Tuning" `<details>` block containing real-time range sliders for Typography Base (`12`–`22`, step `1`), Internal Component Padding (`0.5`–`1.5`, step `0.1`), and Layout Spacing & Gaps (`0.5`–`1.5`, step `0.1`).

### Phase 54-C: Global Component Refactor
**Status:** Completed
**Description:** Surgically stripped hardcoded Tailwind heights, paddings, and icon dimensions from the global search bar, chevron controls, reload buttons, "Search This Area" pill, category filter chips, and floating map toolbar in favor of `.fluid-input`, `.fluid-btn`, `.fluid-icon`, and `gap-[var(--fluid-gap)]`.

### Phase 55-A: Settings Preview & Commit Engine
**Status:** Completed
**Description:** Refactored `useSettings` to maintain separate `savedScale` and `draftScale` states so live slider/preset changes update root CSS variables for real-time visual preview without thrashing storage, and added a floating Framer Motion confirmation bar ("Unsaved Interface Changes") with "Discard" (`discardChanges`) and "Confirm & Reload" (`commitChanges`) actions in `app/settings/page.tsx`.

### Phase 55-B: Universal Semantic Spacing Standardization
**Status:** Completed
**Description:** Enforced 100% universal UI uniformity by appending strict semantic CSS layout classes (`.ui-toolbar`, `.ui-element`, `.ui-pill`) to `app/globals.css` and stripping hardcoded Tailwind heights (`h-8`, `h-10`, `h-12`), paddings (`py-*`, `px-*`, `p-*`), and explicit parent container gaps across navigation headers, core search inputs, filter triggers, category filter pills, and the floating "Search This Area" pill.

### Phase 56-A: Next.js 15 Warnings & i18n TimeZone Fix
**Status:** Completed
**Description:** Resolved Next.js 15 smooth scroll deprecation warnings by adding `data-scroll-behavior="smooth"` to the root `<html>` tag in `app/layout.tsx` and scoping `html[data-scroll-behavior="smooth"] { scroll-behavior: smooth; }` in `app/globals.css`, and configured explicit `Asia/Kolkata` timezone fallbacks in `i18n.ts` and `NextIntlClientProvider` (`app/settings/page.tsx`).

### Phase 56-B: Logo Status Merge & Explore Spacing Refactor
**Status:** Completed
**Description:** Merged global map activity and visible listing counts (`({visibleCount} near you)`) directly into the PrintSwift Navbar logo cluster (`BrandLogoStatus.tsx` / `Navbar.tsx`), removed the standalone `<GlobalStatusPill />` and `"76 Listings Visible Map Area"` status pills, and replaced hardcoded margins, paddings, and absolute offsets (`top-*`, `right-*`) across Explore wrappers, reload controls, filter chevrons, and floating map toolbars with fluid CSS variable calculations (`calc(1rem * var(--scale-pad))` and `calc(1rem * var(--scale-space))`).

### Phase 57: Universal Hydration Immunity
**Status:** Completed
**Description:** Deployed a global hydration defense architecture by adding explicit `suppressHydrationWarning={true}` to `<html>` and `<body>` in `app/layout.tsx`, creating the universal `useIsMounted` hook (`lib/hooks/useIsMounted.ts`) and `<ClientOnly>` boundary wrapper (`components/ui/ClientOnly.tsx`), guarding `<SplashScreen />` and `useSettings()` against SSR client-storage mismatches, and wrapping the Settings scale sliders in `<ClientOnly>` with a pulse skeleton fallback.

### Phase 58: Ultimate Hydration Fix & Logo Clean-Up
**Status:** Completed
**Description:** Eliminated SSR hydration mismatches in the Navbar logo cluster by removing the visible listing count text (`({visibleCount} near you)`), confirming `suppressHydrationWarning={true}` on both root `<html>` and `<body>` tags in `app/layout.tsx`, and guarding the Framer Motion map status spinner with `useIsMounted()` and a fixed `w-8 h-8` placeholder when `!isMounted`.

### Phase 56-A: Hydration & GMP Fixes, Smooth Toolbar Drag, Bulletproof Nav & Default Scale
**Status:** Completed
**Description:** Locked global map status initialization strictly to `'idle'` across SSR/client hydration in `lib/store.tsx` and stabilized `BrandStatusLogo.tsx` with a static `aria-label="PrintSwift Local"` and mounted-only Framer Motion status rendering. Migrated `AdvancedMarkerElement` cluster click listeners in `DiscoveryWorkspace.tsx` to native `addEventListener('gmp-click')` with unmount cleanup. Enforced strict `'medium'` (`16px`) UI scale defaults across `ThemeScaleProvider.tsx`, `useSettings.ts`, and `app/globals.css`. Overhauled `FloatingMapToolbar.tsx` for zero-lag Framer Motion dragging (`dragMomentum={false}`, `dragElastic={0}`, `dragTransition={{ power: 0, timeConstant: 0 }}`, `touch-none select-none`, pointer propagation stop, no CSS transitions on the draggable wrapper, and `onDragEnd`-only persistence). Replaced fragmented breakpoint hiding with mutually exclusive orientation-locked navigation classes (`.nav-bottom-responsive`, `.nav-vertical-responsive`, `.nav-top-responsive`) and standardized both Explore search/filter collapse chevrons to identical `w-8 h-8 rounded-xl` buttons with `w-4 h-4` icons.

### Phase 56-B: One-in-All Global Status Hook & Auto-Hiding Logo Pill
**Status:** Completed
**Description:** Engineered a unified `useAppStatus` pub/sub status manager (`lib/hooks/useAppStatus.ts`, re-exported via `lib/store.tsx`) supporting map, listing, app, role, preference, and network states with auto-dismiss timers (`success`: 1500ms, `error`: 3000ms), automatic `window` `online`/`offline` listeners, and a 10-second safety fallback timeout for transient loading states. Overhauled `BrandStatusLogo.tsx` to strip all static subtext (`"directory"`, `"Visible Map Area"`) and smoothly animate a color-coded pill (`blue`/`emerald`/`amber`/`rose` with `Loader2`/`Check`/`WifiOff`/`AlertCircle` icons) via Framer Motion `<AnimatePresence>` only while active, wiring triggers across `DiscoveryWorkspace.tsx`, `ListingFeed.tsx`, `useSettings.ts`, and `RoleToggleModal.tsx`.

### Phase 57: Landscape Sticky Header, Status Loop Fix, Sleek Search Pill & Desktop Merge
**Status:** Completed
**Description:** Eliminated the infinite "Updating map" loop by removing raw `bounds_changed` triggers and tracking `lastBoundsRef` deltas (`> 0.0005` degrees or zoom change) strictly on genuine user `dragend`, `zoom_changed`, and "Search area" interactions with 250ms debouncing and guaranteed `clearAppStatus()` in `finally` blocks. Replaced inline `width: 0 -> 'auto'` logo pill animations in `BrandStatusLogo.tsx` with a zero-reflow fixed-height absolute slot animated purely via `opacity` and `y` transforms to stop horizontal header twitching. Restored GPU-accelerated Framer Motion sticky header collapse (`y: '-100%'`, spring `stiffness: 320, damping: 32`) across portrait and landscape orientations by listening to both `window` and `#explore-scroll-container` (`scrollTop > 400 && deltaY > 80` to hide; deliberate upward scroll to reveal) while keeping the Vertical Navigation Rail, Split-View Listings Panel, and Map Overlay Frame smoothly synced via measured `--header-visible-height` without triggering Google Maps resize loops. Redesigned the floating "Search area" pill to a compact, centered, non-colliding pill (`h-7 sm:h-8`, `max-w-[calc(100%-104px)]`, responsive label, count only when `> 0`, shown only when bounds are dirty) and merged active filters (`Map/List`, `Filters`, `Relevance`) into the primary Search row on `lg+` (`>= 1024px`) while preserving Categories on its own expandable row beneath.

### Phase 58: 4-Tab Navigation, Marketplace Backend & UI, and Card Layout Fix
**Status:** Completed
**Description:** Transitioned all three orientation-locked navigation surfaces (Portrait Bottom Bar `.nav-bottom-responsive`, Small Landscape Vertical Rail `.nav-vertical-responsive`, and Desktop Landscape Top Bar `.nav-top-responsive`) strictly to 4 public discovery tabs (`Home`, `Explore`, `Market`, `Bulletin`), moving user/utility links (`Profile`, `Saved`, `Activity`, RBAC-gated `Workspace`, `Settings`, `About & Contact`) into cleanly grouped User and Public sections inside the Hamburger/Profile drawer for authenticated users and guests. Created the `public.marketplace_products` Supabase migration (`20261119_phase58_marketplace.sql`) with strict RLS policies, performance indexes, and an idempotent 8-item local product seed; launched the live paginated `/marketplace` catalogue page with dense `h-8`/`h-9` search and category filters, `useAppStatus()` integration, `View Shop`, and WhatsApp `Enquire` CTAs; scaffolded `/bulletin` for Phase 59 with skeleton loading boundaries; added `/saved` and `/activity` route aliases; and resolved split-view listing card metadata truncation using `flex flex-wrap items-center justify-between gap-x-2 gap-y-1 min-w-0` with a `max-w-[140px] truncate shrink-0` owner badge.

### Phase 59-A: Bulletin Backend Schema, Quota Triggers & Live Feed
**Status:** Completed
**Description:** Engineered the Community Bulletin backend in `supabase/migrations/20261119_phase59_bulletin.sql` with 5 relational tables (`subscription_plans`, `user_subscriptions`, `bulletins`, `bulletin_reports`, `bulletin_audit_logs`), a `BEFORE INSERT` database-enforced subscription/quota trigger (`enforce_bulletin_quota` bypassing admins/super_admins while enforcing active subscription, active count, monthly quota, image count, and YouTube entitlements), an `AFTER INSERT OR UPDATE` audit trail trigger (`log_bulletin_audit`), strict RLS policies across all 5 tables, and an idempotent seed of 3 plans (`Starter`, `Business`, `Agency`) and 4 local Churachandpur bulletins. Built `components/bulletin/BulletinContentRenderer.tsx` to render structured Tiptap/ProseMirror JSON with zero `dangerouslySetInnerHTML`, strict URL protocol sanitization (`http://`, `https://`, `mailto:`, `tel:`), and a sandboxed `youtube-nocookie.com` embed validated against `/^[A-Za-z0-9_-]{11}$/`. Replaced the `/bulletin` placeholder with a live Supabase-backed paginated feed (`.range(offset, offset + 14)`), dense `h-8`/`h-9` search and category filter pills, author accountability badges, centered Framer Motion detail modal with external contact bar (`Call`, `WhatsApp`, `Email`, `Website`), optional linked listing deep link, moderation reporting to `bulletin_reports`, and `useAppStatus()` integration.

### Phase 59-B: Tiptap Rich Editor, Quota-Gated Composer & Admin Moderation
**Status:** Completed
**Description:** Installed `@tiptap/react`, `@tiptap/pm`, `@tiptap/starter-kit`, `@tiptap/extension-link`, and `@tiptap/extension-placeholder` and built the compact high-density `BulletinEditor.tsx` (`h-7` toolbar icons for Bold, Italic, H2/H3, Bullet List, Numbered List, Quote, and sanitized inline Link bar) emitting structured ProseMirror JSON. Built the paid-only quota-gated `BulletinComposerModal.tsx` wired to a compact `"Post Bulletin"` button on `/bulletin`: unpaid or quota-capped users see live plans from `subscription_plans` with a `"Request Activation via WhatsApp / Admin"` CTA, while eligible subscribers and admins see remaining active/monthly slot counts, `<CustomSelectModal />` category and owned-listing pickers, Supabase Storage multi-image uploads strictly capped at `plan.max_images_per_post`, validated YouTube URL parsing with live `youtube-nocookie.com` preview, required external contact inputs, 14-day default expiry, inline PostgreSQL trigger error handling, and `useAppStatus()` feedback. Added the `"Bulletins & Plans"` tab (`AdminBulletinManager.tsx`) in `AdminWorkspace.tsx` (strictly gated to `admin` / `super_admin`) featuring user search, `<CustomSelectModal />` plan selection, manual UPI `payment_ref` activation into `user_subscriptions`, and an open `bulletin_reports` queue with one-click `"Dismiss Report"` and `"Remove Bulletin"` (`status = 'removed_by_admin'`) actions.

### Phase 60-A: Vehicle Pool, Pick N Drop Schema, Asymmetric OTP RPCs & Fare Quote API
**Status:** Completed
**Description:** Engineered the backend foundation for PrintSwift Local's Pick N Drop delivery module and standalone Vehicle Pool in `supabase/migrations/20261119_phase60_pick_n_drop.sql`, enabling PostGIS and `pgcrypto`, creating 7 relational tables (`vehicle_types`, `drivers`, `vehicles`, `delivery_orders`, `delivery_order_secrets`, `delivery_transactions`, `delivery_order_events`), geospatial GiST and status/purge indexes, strict RLS policies guaranteeing Drivers have zero `SELECT` access to `delivery_order_secrets`, a private `delivery-pods` storage bucket, and an idempotent seed of 4 Churachandpur vehicle types (`Two-Wheeler`, `E-Rickshaw / Auto`, `Mini Van / Alto`, `Pickup Truck / Bolero`). Deployed two `SECURITY DEFINER` RPCs: `verify_delivery_otp` (enforcing driver/mediator authorization, 5-attempt lockout with 15-minute cooldown, mandatory POD path on dropoff, one-way/two-way stage transitions, and audit logging) and `mediator_confirm_delivery` (gated to `owner`/`admin`/`super_admin`, transitioning `delivered_pending_confirm` to `completed`, setting `pod_purge_at = now() + interval '48 hours'`, and recording 85% `driver_payout` and 15% `platform_commission` ledger entries). Added private POD helpers (`DELIVERY_PODS_BUCKET`, `uploadDeliveryPod` returning storage path only, and 5-minute `getSignedPodUrl`) to `lib/supabase/storage.ts`, created the shared server fare engine in `lib/pick-n-drop/fare.ts` (Google Distance Matrix API with Haversine × 1.25 road fallback, container surcharges `fragile_crate` +₹30 / `bulk_sack` +₹50, and `two_way_multiplier`), and launched three server API routes: `POST /api/pick-n-drop/quote`, authenticated `POST /api/pick-n-drop/orders` (strict server-side fare recalculation, cryptographic `crypto.randomInt` 6-digit OTPs, and manual UPI escrow payment instructions), and secret/admin-protected `/api/pick-n-drop/purge-pods` (deleting expired POD objects after 48 hours and logging `pod_auto_purged` audit events).

### Phase 60-B: Explore Map Pick N Drop UI, Order Tracker & Mediator Console
**Status:** Completed
**Description:** Integrated Pick N Drop directly into `/explore` (`FloatingMapToolbar.tsx`, `DiscoveryWorkspace.tsx`, `MapWorkspace.tsx`) with a dense `w-8 h-8` floating toolbar trigger, interactive map-tap Point A/B pin placement, `PickNDropRouteLayer.tsx` rendering A/B AdvancedMarkers and Google Directions polylines (with Lamka road fallback and `useAppStatus('routing')`), and a compact `PickNDropDrawer.tsx` featuring `"My Location"` geolocation, quick Churachandpur landmarks, `One-Way` vs `Two-Way` segmented toggle (`h-8`), live `vehicle_types` cards showing real-time `/api/pick-n-drop/quote` `₹` estimates, `<CustomSelectModal />` container nature selection (zero native `<select>`), mandatory Prohibited Items Waiver, and Manual UPI Prepaid Escrow checkout (UPI ID/QR block, `upi://pay` link, 12-digit UTR input, and optional payment receipt upload writing `'payment_submitted'` + `'upi_payment'`). Built `OrderTrackerModal.tsx` (accessible both as a modal from the drawer's `"Orders"` badge and embedded inside `/activity` via `ActivityPanel.tsx`) with a 6-step delivery progress bar, RLS-protected asymmetric Pickup/Dropoff/Return OTP cards, one-tap `"Share Dropoff OTP via WhatsApp"`, inline UPI UTR submission for unpaid orders, and 5-minute signed URL POD preview. Built `PickNDropConsole.tsx` wired as `"Pick N Drop & Fleet"` in both `AdminWorkspace.tsx` and `OwnerStaffWorkspace.tsx` with Fleet Management (drivers, vehicles, availability toggle via `<CustomSelectModal />`), Escrow & Dispatch Queue (`Verify UPI & Hold Escrow`, Driver/Vehicle assignment, `verify_delivery_otp` handover with mandatory private `'delivery-pods'` photo upload on dropoff), and Mediator Final Confirmation (`getSignedPodUrl` POD inspection + `mediator_confirm_delivery` settlement RPC starting the 48-hour auto-purge countdown).

### Phase 60-C: Panel-Docked Pick N Drop, Passenger/Gas Modes, Live Pricing & Logo Pulse
**Status:** Completed
**Description:** Docked Pick N Drop natively inside the Explore Listings panel (`PickNDropPanel.tsx` inside both `desktop-discovery-sidebar` and `mobile-listing-bottom-sheet` in `DiscoveryWorkspace.tsx`, removing floating map overlay positioning), auto-expanding the panel when activated from the floating map toolbar, preserving all collapse/expand toggles, auto-collapsing the mobile bottom sheet to peek height on Pin A/B selection and auto-expanding upon pin drop, and providing `"← Listings"` / `"X"` controls to reset pins and return to listings. Deployed additive Supabase migration (`20261119_phase60c_pick_n_drop_modes.sql`) adding `supported_modes` to `vehicle_types`, seeding `Cycle Rickshaw`, renaming `two_wheeler` to `Scooty / Two-Wheeler`, adding `service_mode`, `instructions`, `passenger_count`, `cylinder_count`, and `pod_required` to `delivery_orders` (making `container_type`, `recipient_name`, and `recipient_phone` nullable), and updating `verify_delivery_otp` to skip mandatory dropoff POD photos when `pod_required = false` (`passenger` rides). Upgraded `lib/pick-n-drop/fare.ts`, `/api/pick-n-drop/quote`, and `/api/pick-n-drop/orders` to return both `one_way_fare_inr` and `two_way_fare_inr` with immediate client/server differentiation, dynamic vehicle filtering across 3 Service Modes (`Parcel`, `Ride (Taxi)`, `LPG Gas` with Cycle Rickshaw/Scooty/E-Rickshaw & Two-Way default), unified `Instructions & Landmarks` textarea with quick-append chips, and mode-aware `OrderTrackerModal` / `PickNDropConsole` displays. Refined `BrandStatusLogo.tsx` by removing the redundant spinner icon inside status pills while keeping the icon ring spinner and smoothly pulsing the status text opacity (`[0.4, 1, 0.4]`, `1.4s` loop) during active loading states.







