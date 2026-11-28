# DD oodle — System Bible (Canonical Current-State Source of Truth)

> **Status:** Ground-truth architectural, database, security, route, and UX specification as of **Pass v23b** (Batch 6 Final Architectural Sprint — Strict Workspace Route/Bundle Isolation, Clean Mount/Unmount Teardown, Public Bundle Purity, DB Indexes & 62/62 Audit Closure; see **§9–§14**).
> **Repo Verification Scope:** `app/` (**34** page routes incl. `/workspace/{owner,staff,driver,mediator,hub,advertiser}` & `/admin`, **55** API routes incl. `/api/payments/refund`, `/api/contact`, `/auth/callback`), `middleware.ts`, `components/`, `lib/`, `public/`, `vercel.json` (3 purge crons), and `supabase/` (**66** SQL migrations + `seed_demo_content.sql` + `functions/notify-owner`).
> **Companion Docs:** [`AGENTS.md`](../AGENTS.md) (always-on engineering laws) · [`docs/CHANGELOG.md`](CHANGELOG.md) (sprint history + ordered migration manifest) · [`docs/AUDIT_FORMS_AND_ROLES.md`](AUDIT_FORMS_AND_ROLES.md) (verified 62/62 closed P0/P1/P2 audit items).

---

## Table of Contents

1. [Platform Overview, Verticals, ADR Summary & Tech Stack](#1-platform-overview-verticals-adr-summary--tech-stack)
2. [Canonical Database Schema](#2-canonical-database-schema)
3. [RLS Policies & `SECURITY DEFINER` RPC Registry](#3-rls-policies--security-definer-rpc-registry)
4. [3-Level Fixed-Root Category Taxonomy (`v16b`) & User-Suggested Leaves (`v17a`)](#4-3-level-fixed-root-category-taxonomy-v16b--user-suggested-leaves-v17a)
5. [Unified Monetization Engine (`v17b`, `v17c`, `v20a`)](#5-unified-monetization-engine-v17b-v17c-v20a)
6. [Role & Hat Permissions Matrix (All 8 Roles)](#6-role--hat-permissions-matrix-all-8-roles)
7. [Complete App Route Map, Workspace Architecture & Shared UX Primitives](#7-complete-app-route-map-workspace-architecture--shared-ux-primitives)
8. [Offline PWA, Privacy-Safe Telemetry, Env Security & Operations Contract](#8-offline-pwa-privacy-safe-telemetry-env-security--operations-contract)
9. [v21a Security Baseline (Batch 1 P0 Closure)](#9-v21a-security-baseline-batch-1-p0-closure)
10. [v21b Role Solidification & Hub Manager Decoupling (Batch 2 P1 Closure)](#10-v21b-role-solidification--hub-manager-decoupling-batch-2-p1-closure)
11. [v22a Unified Notifications & Activity Engine (Batch 3 P2-01 Closure)](#11-v22a-unified-notifications--activity-engine-batch-3-p2-01-closure)
12. [v22b Public Pages Reflection, Routing, Back-Button & WhatsApp OpenGraph Cards (Batch 4 P2 Closure)](#12-v22b-public-pages-reflection-routing-back-button--whatsapp-opengraph-cards-batch-4-p2-closure)
13. [v23a All-Role Interactive Guides, Contextual Workspace Help (`?`) & Assistant Knowledge Sync (Batch 5 P2-14 Closure)](#13-v23a-all-role-interactive-guides-contextual-workspace-help---assistant-knowledge-sync-batch-5-p2-14-closure)
14. [v23b Strict Workspace Route/Bundle Isolation, Public Bundle Purity, DB Indexes & Dead-Code Cleanup (Batch 6 Final P2 Closure)](#14-v23b-strict-workspace-routebundle-isolation-public-bundle-purity-db-indexes--dead-code-cleanup-batch-6-final-p2-closure)

---

## 1. Platform Overview, Verticals, ADR Summary & Tech Stack

**DD oodle** (rebranded from *PrintSwift Local* in Phase 72 / commit `e8906f9`) is a multi-hub local super-app built initially for **Churachandpur (Lamka), Manipur** and architected for multi-city hub expansion (e.g., Aizawl, Imphal).

### 1.1 Active Platform Verticals & Domains
1. **8 Polymorphic Listing Verticals (`public.listings.listing_vertical`):**
   - `general` — General local businesses & trades/services
   - `shop_catalogue` — Retail shops & kirana with 0%-commission basket ordering + Pick N Drop link
   - `restaurant_food` — Restaurants, cafés & bakeries with menu variants/add-ons, table reservations & kitchen queue
   - `print_digital` — Digital print, Xerox & CSC centers with server-verified PDF pages, encrypted private `print-documents`, dual-rail escrow & Official PrintSwift first-party governance
   - `real_estate` — Land plots, rentals, sales & PG/hostels with Terra Draw boundary polygons, Manipur Sangam/acre/sq.ft conversion, Patta/road/water trust fields, privacy pin & site visit requests
   - `hotel_stay` — Hotels, homestays & lodges with multi-room booking calendars & Check-In OTP
   - `booking_venue` — Sports turfs, futsal courts & community halls with atomic `FOR UPDATE` slot locking
   - `public_civic` — Emergency helplines, hospitals, schools, govt offices & banks (with offline PWA caching & public correction reports)
2. **Marketplace (`public.marketplace_products`):** Cross-shop local product catalogue synced to parent `listings`.
3. **Community Bulletin (`public.bulletins`):** Local notices, jobs, events (with venue coordinates), YouTube video announcements & ads.
4. **Pick N Drop (`public.delivery_orders`):** Intra-hub parcel, passenger ride & LPG gas logistics across 5 fleet tiers with manual UPI/Razorpay escrow, asymmetric 6-digit OTP vaults & private 48h WebP Proof-of-Delivery (`delivery-pods`).
5. **Scheduled Vehicles & Inter-Hub Charters (`public.vehicle_listings` / `vehicle_bookings`):** Per-seat & full-vehicle scheduled reservations with conflict-free date/seat locking and asymmetric OTP handover.

### 1.2 Backend Architecture Decision Record (Phase 2 Summary)
DD oodle selected **Supabase (PostgreSQL + PostGIS + Storage + RLS)** over Firebase/Firestore because local super-app discovery and real estate plots require native `GEOGRAPHY(Point, 4326)` / `GIST` viewport bounding-box & `ST_DWithin` queries, relational integrity across 8 verticals, atomic `FOR UPDATE` slot/job locking, and declarative row-level security across multi-tenant owners, delegated staff, drivers, hub managers, and admins without client over-fetching or N+1 rule reads. **Note:** No PostgreSQL `CREATE TYPE ... AS ENUM` types are used; all enumerations are `text` columns constrained by `CHECK (...)` clauses.

### 1.3 Verified Tech Stack (`package.json`)
| Layer | Packages & Versions |
| :--- | :--- |
| **Framework & Language** | `next` `^15.4.9` (App Router), `react` `^19.2.1`, `react-dom` `^19.2.1`, `typescript` `5.9.3` |
| **Styling & Motion** | `tailwindcss` `4.1.11`, `@tailwindcss/postcss` `4.1.11`, `@tailwindcss/typography` `^0.5.19`, `clsx`, `tailwind-merge`, `class-variance-authority`, `framer-motion` `^14.14.0`, `motion` `^12.23.24`, `lucide-react` `^0.553.0` |
| **Backend & Auth** | `@supabase/supabase-js` `^2.119.0`, `@supabase/ssr` `^0.12.7` (PKCE OAuth + SSR cookies) |
| **Maps & Geometry** | `@vis.gl/react-google-maps` `^1.10.2`, `@googlemaps/markerclusterer` `^2.6.2`, `terra-draw` `^1.39.0`, `terra-draw-google-maps-adapter` `^1.7.0`, `@turf/turf` `^7.4.0` |
| **Editors, DnD, Charts, i18n, AI & Comms** | `@tiptap/react` + StarterKit `^3.34.0`, `@dnd-kit/core` `^6.3.1` + `@dnd-kit/sortable` `^10.0.0`, `recharts` `^3.11.1`, `next-intl` `^4.15.1`, `@google/genai` `^2.4.0`, `resend` `^6.38.1`, `xlsx` `^0.18.5`, `@hookform/resolvers` `^5.2.1` |
| **Tooling** | `eslint` `9.39.1`, `eslint-config-next` `16.0.8`, `playwright` `^1.65.0`, `firebase-tools` `^15.0.0` |

---

## 2. Canonical Database Schema

> There are **88 active tables** in `public` across **61** migrations (`00001` through `v20b`). `public.driver_profiles` was merged into `public.drivers` and dropped in `v14b:114`. Non-existent phantom names sometimes mentioned in older notes (`marketplace_items`, `pick_n_drop_orders`, `scheduled_vehicles`, `payment_transactions`, `hubs`) do **not** exist.

### 2.1 Critical Table Contracts (Exact Verified Columns)

#### `public.audit_logs` (`00005_sync_frontend_fields.sql:380` + `20261124_pass_v15a_superadmin_foundation.sql:20-95`)
Immutable append-only governance ledger. **Exact 13 live columns:**

| # | Column | Type | Nullability / Default | Notes |
| :--- | :--- | :--- | :--- | :--- |
| 1 | `id` | `uuid` | `PRIMARY KEY DEFAULT gen_random_uuid()` | — |
| 2 | `timestamp` | `timestamptz` | nullable, `DEFAULT now()` | From `00005` (preserved alongside `created_at`) |
| 3 | `actor_id` | `uuid` | nullable | Migrated `text → uuid` in `v15a:58-84`; no FK |
| 4 | `actor_name` | `text` | nullable | From `00005` |
| 5 | `actor_role` | `text` | nullable | Added/ensured in `00005` & `v15a:33` |
| 6 | `workspace` | `text` | nullable | From `00005` (`'mediator'`, `'driver'`, `'superadmin'`, etc.) |
| 7 | `action` | `text` | `NOT NULL` | Action key |
| 8 | `target_id` | `text` | nullable | Always cast UUIDs to `text` (`::text`) |
| 9 | `target_name` | `text` | nullable | From `00005` |
| 10 | `details` | `text` | nullable | Human-readable summary (never pass raw `jsonb`) |
| 11 | `target_table` | `text` | nullable | Added in `v15a:34` (**never** use `entity_type`/`entity_id`) |
| 12 | `metadata` | `jsonb` | `NOT NULL DEFAULT '{}'::jsonb` | Structured audit JSON payload (`v15a:36`) |
| 13 | `created_at` | `timestamptz` | `NOT NULL DEFAULT now()` | Backfilled from `"timestamp"` (`v15a:37-56`) |

- **Trigger:** `trg_audit_logs_immutable` (`BEFORE UPDATE OR DELETE`) calls `guard_audit_logs_immutable()`, raising `42501` unconditionally even for `service_role`.
- **Indexes:** `idx_audit_logs_created_at_desc`, `idx_audit_logs_target_table_created`, `idx_audit_logs_action`. *(Note: Missing `hub_id` column and missing `(actor_id, workspace, created_at DESC)` index — see `AUDIT_FORMS_AND_ROLES.md`.)*

#### `public.profiles` (Latest additions in `v20b:15-20`, `v17b:63`, `pass_v6a:130`, `phase66a:315`)
- `id uuid PK → auth.users(id)`, `email text`, `full_name text`, `username text UNIQUE` (case-insensitive index), `role text CHECK IN ('visitor','driver','staff','owner','hub_manager','mediator','admin','super_admin')` (`v21a` adds `mediator`), `phone text`, `whatsapp text`, `bio text`, `avatar_url text`, `social_links jsonb NOT NULL DEFAULT '{}'::jsonb`, `preferred_locality text`, `onboarding_completed_at timestamptz` *(Note: timestamp, NOT boolean `onboarding_completed`)*, `map_settings jsonb`, `default_hub_id uuid → service_hubs`, `home_hub_id uuid → service_hubs`, `default_locality_id uuid → hub_localities`, `referral_code text UNIQUE`, `referred_by_user_id uuid → profiles`, `referral_applied_at timestamptz`, `trial_used_at timestamptz`.
- **Triggers:** `trg_enforce_profile_role_governance` (`00015`/`v14a`, `v21a`: elevates only when the **auth.users** email is allowlisted), `trg_guard_immutable_superadmin` (`v15a`/`v21a`), `trg_audit_profile_role_change` (`v15a`), `trg_guard_profile_sensitive_columns_v20b` (`v21a`: `SECURITY INVOKER`, trusts definer-context RPCs such as `start_plan_trial`), plus `auth.users` sync `trg_handle_new_user_v20b` (`v20b:102`).
- **Read access (`v21a`):** `SELECT` is row-scoped (`profiles_scoped_select_v21a`: own row, admins, mediators/hub managers, owners → their delegated staff). Public names/avatars come from the **`public.public_profiles`** view (`id, username, full_name, name, avatar_url, bio, role, default_hub_id`) — `lib/supabase/public-profiles.ts`.

#### `public.delivery_orders` & `public.delivery_order_secrets` (`phase60:58-114`, `phase60c`, `phase66a`, `phase74a`, `v19a`, `v19b`)
- `delivery_orders`: `id`, `order_code UNIQUE`, `customer_id`, `mediator_id`, `driver_id → drivers(id)`, `vehicle_id`, `vehicle_type_id`, `hub_id → service_hubs(id)`, `service_mode`/`delivery_mode`, `trip_type CHECK ('one_way','two_way')`, `container_type`, `declared_value_inr`, `prohibited_items_waiver`, `pickup_address`, `pickup_landmark`, `pickup_point geography(Point,4326)`, `sender_phone`, `dropoff_address`, `dropoff_landmark`, `dropoff_point geography(Point,4326)`, `recipient_name`, `recipient_phone`, `instructions text`, `distance_km`, `quoted_fare_inr`, `commission_inr`, `driver_payout_inr`, `status CHECK ('awaiting_payment','payment_submitted','escrow_held','driver_assigned','picked_up','in_transit','delivered_pending_confirm','return_in_transit','completed','cancelled','disputed')`, `driver_substatus`, `escrow_required`, `payment_verified_at`, `pod_storage_path`, `pod_uploaded_at`, `pod_purge_at`, `pod_purged_at`, `linked_print_order_id`, `linked_shop_order_id`, `linked_restaurant_order_id`, `is_food_order`. *(No `pickup_lat`, `pickup_lng`, `dropoff_lat`, `dropoff_lng`, or `notes` columns exist!)*
- `delivery_order_secrets`: `order_id PK → delivery_orders`, `pickup_otp text`, `dropoff_otp text`, `return_otp text`, `failed_attempts int`, `locked_until timestamptz`, `pickup_verified_at timestamptz`, `dropoff_verified_at timestamptz`, `return_verified_at timestamptz`, `updated_at timestamptz` (`v21a`). `SELECT` is **customer-only** (`delivery_order_secrets_customer_select_v21a`); mediators and drivers never read OTPs.
- `delivery_orders.pod_purged_at` & `vehicle_bookings.pod_purged_at` (`v21a`) record 48h POD purges.

### 2.2 Complete Active Tables Inventory (91 Tables by Domain)

> **`v21a` additions:** `contact_messages` (Contact Us inbox, service-role inserts via `/api/contact`), `vehicle_reviews` (rider reviews, one per user per vehicle), `vertical_order_customer_otps` (customer-only vault for print/shop/restaurant/booking display OTPs). Schema notes corrected by v21a testing: `pay_per_orders` has **no** `order_code`; `subscription_plans` has **no** `auto_verify` column (auto-verify lives in `entitlements`).

| Domain | Table | PK & Key FKs / Constraints | Key Triggers | `hub_id`? |
| :--- | :--- | :--- | :--- | :--- |
| **Auth & Governance (11)** | `profiles` | `id → auth.users`; `role CHECK (7 roles)` | `trg_enforce_profile_role_governance`, `trg_guard_immutable_superadmin`, `trg_audit_profile_role_change`, `trg_guard_profile_sensitive_columns_v20b` | `default_hub_id`, `home_hub_id` |
| | `email_otps` | `id`; `email, otp, expires_at, used` | — | No |
| | `staff_delegations` | `id`; `listing_id → listings`, `owner_id/granted_by_owner_id/staff_id → profiles`, `vertical_scopes jsonb`, `permissions jsonb`, `status CHECK ('active','suspended_parent_closed','revoked')`; partial UNIQUE `(listing_id, staff_id) WHERE status='active'` | `trg_enforce_and_audit_staff_delegation_v18a` | No |
| | `verification_requests` | `id`; `listing_id`, `owner_id`, `status` | — | No |
| | `moderation_cases` | `id`; `target_type`, `target_id`, `status` | — | No |
| | `audit_logs` | `id`; immutable 13 columns | `trg_audit_logs_immutable` | No |
| | `app_settings` | `key PK`; `value jsonb` (legacy toggles e.g. `show_sample_data`) | — | No |
| | `platform_settings` | `key PK`; `value jsonb` (`app_identity`, `office_and_contact`, `payment_config`, `operations_config`, `pricing_surcharges`, `legal_pages`, `onboarding_and_referrals`, `homepage_builder_config`, `monetization_config`) | `trg_audit_platform_settings_changes` | No |
| | `translations` | `id`; `UNIQUE(lang, key)` | `trg_translations_updated_at` | No |
| | `dynamic_field_definitions` | `id`; `category`, `field_key`, `options jsonb` | — | No |
| | `app_analytics_events` | `id`; `event_type CHECK (11 values)` (note API allows 10 client types), `session_id`, `user_id`, `metadata jsonb`, `created_at` | `pg_cron` 90d purge | No |
| **Multi-Hub & Taxonomy (11)** | `service_hubs` | `id`; `slug UNIQUE`, `center_point geography(Point,4326)`, `status CHECK ('active','coming_soon','paused')`, `office_contact jsonb`, `module_switches jsonb` | `trg_service_hubs_center_point`, `trg_guard_service_hub_manager_update` | PK `id` |
| | `hub_managers` | `id`; `hub_id → service_hubs`, `profile_id → profiles`; `UNIQUE(hub_id, profile_id)`; `can_confirm_manual_payments`, `can_edit_rates`, `is_active` | — | Yes |
| | `hub_requests` | `id`; `user_id → profiles`, `status CHECK ('open','reviewed','planned','launched')` | — | No |
| | `hub_vehicle_rates` | `id`; `UNIQUE(hub_id, vehicle_type_id)` | — | Yes |
| | `categories` | `id`; `entity_type CHECK ('listing','product','bulletin','vehicle')`, `parent_id → categories`, `root_key`, `depth CHECK (1..3)`, `is_system_root`, `path_slugs text[]`, `review_status CHECK ('official','pending_review','rejected','merged')`, `suggested_by`, `merged_into_id`; `UNIQUE(entity_type, slug)` | `trg_categories_v16b_guard`, `trg_categories_v16b_cascade`, `trg_audit_categories_changes`, `trg_categories_sync_icon_columns` | No |
| | `category_suggestions` | `id`; legacy `phase67a` queue (`status CHECK ('pending','promoted','rejected')`) | `trg_category_suggestions_normalize` | Yes |
| | `hub_localities` | `id`; `UNIQUE(hub_id, slug)`, `aliases text[]`, `point geography(Point,4326)`, `source`, `status` | `trg_hub_localities_sync_point` | Yes |
| | `app_categories` | `slug PK`; legacy flat CMS categories | `trg_app_categories_updated_at` | No |
| | `app_localities` | `slug PK`; legacy flat CMS localities | `trg_app_localities_updated_at` | No |
| | `popular_localities` | `id`; `slug UNIQUE`, `lat/lng`, `default_zoom`, `is_featured` | `trg_audit_popular_localities_changes` | No |
| | `helpbot_faqs` | `id`; `keywords text[]`, `deep_link_url` | `trg_helpbot_faqs_updated_at` | No |
| **Core Listings & Legacy (11)** | `listings` | `id`; `owner_id → profiles`, `hub_id → service_hubs`, `category_id → categories`, `root_key`, `locality_id → hub_localities`, `listing_vertical CHECK (8 roots)`, `vertical_summary jsonb`, `lifecycle_status CHECK ('active','paused','draining','archived_by_owner','custody_admin')`, `paid_until`, `is_featured`, `featured_order`, `is_verified`, `is_official_printswift`, `is_civic_record`, `panoramas_360 jsonb` *(No `thumbnail_url` column!)* | `trg_guard_civic_listings_mutation`, `trg_cascade_listing_hub_id_to_products`, `trg_audit_listings_featured_v15c`, `trg_listings_sync_root_key_v16b`, `trg_apply_listing_auto_verify_v17b`, `trg_guard_listing_quota_v18a`, `trg_guard_staff_listing_mutations_v18a` | Yes |
| | `business_listings`, `service_listings`, `real_estate_listings`, `public_interest_listings`, `sports_listings`, `catalogue_products` | Legacy `00002`/`00005` 1:1 sub-tables (`→ listings`) | — | No |
| | `listing_media` | `id`; `listing_id → listings`, `media_url`, `media_type`, `sort_order` | — | No |
| | `media_assets` | `id`; `storage_path UNIQUE`, `entity_type CHECK`, `retention_class`, `status`, `expires_at`, `purged_at` *(Note `00017` vs `pass_r1a` replay hazard)* | — | Yes |
| | `reviews` | `id`; `listing_id → listings`, `user_id`, `rating CHECK (1..5)`, `owner_reply`, `status` | — | No |
| | `enquiries` | `id`; `listing_id → listings`, `sender_id/user_id`, `sender_name`, `sender_contact`, `sender_phone`, `sender_email`, `message`, `owner_reply`, `status` | `trg_notify_owner_on_new_enquiry` | No |
| **Marketplace, Bulletins & CMS (14)** | `marketplace_products` | `id`; `listing_id → listings`, `owner_id → profiles`, `hub_id`, `category_id`, `price/price_inr`, `in_stock`, `stock_count`, `paid_until`, `is_active` | `trg_sync_shop_summary_from_products`, `trg_guard_marketplace_quota_v18a`, `trg_marketplace_products_sync_hub_id` | Yes |
| | `bulletins` | `id`; `author_id → profiles`, `hub_id`, `linked_listing_id → listings`, `category_id`, `status CHECK ('published','archived','removed_by_admin')`, `youtube_video_id`, `venue_label`, `venue_lat`, `venue_lng`, `expires_at`, `paid_until` | `trg_enforce_bulletin_quota`, `trg_bulletins_auto_verify_v17b`, `trg_bulletins_audit` | Yes |
| | `bulletin_reports`, `bulletin_audit_logs` | `id`; `bulletin_id → bulletins` | — | No |
| | `bulletin_post_passes` | `id`; `user_id → profiles`, `price_inr/amount_inr`, `upi_utr_ref` *(no unique index)*, `status` | — | No |
| | `user_saved_items`, `user_follows`, `user_interests` | Polymorphic bookmark (`listing`/`product`/`bulletin`/`vehicle`), follows & interests | — | `user_interests` only |
| | `app_announcements`, `app_banners` | `id`; `hub_id` (nullable = global), `paid_until` (`app_banners`) | — | Yes |
| | `homepage_containers`, `homepage_items` | `id`; `container_key UNIQUE`, `layout_type CHECK (8 types)`, `container_id → homepage_containers`, `section`, `route_key`, `query_params jsonb` | `trg_audit_homepage_containers_v15d`, `trg_audit_homepage_items_changes` | No |
| | `featured_slots`, `featured_requests` | `id`; `hub_id`, `requester_id → profiles`, `slot_section`, `entity_type`, `entity_id`, `duration_days`, `quoted_fee_inr`, `status CHECK ('submitted','under_review','approved','rejected','expired')` (`pass_v9a`) | — | Yes |
| **Notifications, Referrals & KYC (4)** | `notifications` | `id`; `user_id`, `recipient_id`, `recipient_role`, `title`, `message`, `type NOT NULL`, `read`, `is_read`, `link_listing_id`, `action_url`, `metadata jsonb` | — | No |
| | `activity_logs` | `id`; `user_id`, `action_type`, `entity_id`, `entity_title`, `metadata jsonb` | — | No |
| | `referrals` | `id`; `referrer_id`, `referred_user_id`, `hub_id`, `referral_type CHECK (4)`, `status CHECK (4)`, `reward_credit_inr` | `trg_referrals_updated_at` | Yes |
| | `partner_applications` | `id`; `applicant_id → profiles`, `hub_id`, `application_type CHECK (4)`, `kyc_documents jsonb`, `status CHECK (5)` | `trg_guard_partner_application_writes`, `trg_audit_partner_application_review` *(broken)*, `trg_partner_approval_auto_trial_v17b` | Yes |
| **Monetization & Payments (8)** | `subscription_plans` | `id`; `slug UNIQUE`, `is_default_free`, `trial_days CHECK (0..365)`, `auto_verify`, `max_staff CHECK (>=-1)`, `target_scope CHECK ('all_users','selected_users')`, `target_user_ids uuid[]`, `entitlements jsonb`, `allowed_category_ids uuid[]`, `allowed_root_keys text[]` | `trg_subscription_plans_v15b_sync`, `trg_audit_subscription_plans_v15b`, `trg_guard_default_free_plan_v17b` | No |
| | `subscription_plan_prices` | `id`; `plan_id → subscription_plans`, `billing_period CHECK (6)`, `duration_days`, `price_inr` | `trg_audit_subscription_plan_prices_v15b` | No |
| | `user_subscriptions` | `id`; `user_id → profiles`, `plan_id`, `price_id`, `listing_id`, `status CHECK ('active','pending_payment','expired','cancelled','paused_listing_archived','trialing')`, `starts_at`, `expires_at`, `ends_at`, `is_trial`, `entitlement_overrides jsonb` | `trg_user_subscriptions_v15b_sync`, `trg_audit_user_subscriptions_v15b` | No |
| | `payment_feature_policies` | `id`; `scope_key UNIQUE`, `allow_manual_upi`, `allow_razorpay`, `allow_cash_counter`, `allow_direct_shop_upi`, `manual_upi_id`, `category_overrides jsonb` | `trg_audit_payment_feature_policies_v15b` | No |
| | `payment_intents` | `id`; `intent_code UNIQUE`, `user_id`, `hub_id`, `purpose CHECK (18 purposes)`, `provider CHECK ('manual_upi','razorpay')`, `status CHECK (6)`; partial UNIQUE active UTR index (`v19a:160`) | `trg_guard_payment_intent_user_update` | Yes |
| | `promo_codes` | `id`; `code UNIQUE`, `hub_id`, `discount_type CHECK ('flat','percent')`, `applies_to text[]` | — | Yes |
| | `pay_per_pricing_configs` | `id`; `module_key UNIQUE CHECK (4)`, `pricing_mode CHECK (3)`, `min_cap_inr numeric(10,2)`, `max_cap_inr numeric(10,2)`, `area_tiers jsonb`, `duration_options jsonb`, `addons jsonb` | `trg_audit_pay_per_pricing_configs_v17c` | No |
| | `pay_per_orders` | `id`; `order_code UNIQUE`, `user_id → auth.users`, `module_key`, `target_table CHECK (4)`, `target_id`, `paid_until`, `status CHECK ('pending_verification','paid','rejected','refunded')`, `review_notes`; partial UNIQUE active UTR index (`v17c:304`) | `trg_pay_per_orders_updated_at` | No |
| **Logistics & Charters (11)** | `vehicle_types` | `id`; `slug UNIQUE` (`cycle_rickshaw`, `two_wheeler`, `e_rickshaw`, `mini_van`, `pickup_truck`), `base_fare_inr`, `per_km_rate_inr`, `two_way_multiplier` | `trg_audit_vehicle_types_v15c` | No |
| | `drivers` | `id`; `profile_id UNIQUE → profiles`, `hub_id`, `vehicle_type`, `vehicle_reg_no`, `license_no`, `kyc_status CHECK ('pending','verified','suspended')`, `is_online`, `is_active` | `trg_guard_canonical_drivers_writes` | Yes |
| | `vehicles` | `id`; `driver_id → drivers`, `vehicle_type_id`, `hub_id`, `is_available`, `current_location` | `trg_vehicles_updated_at` | Yes |
| | `delivery_orders`, `delivery_order_secrets` | See §2.1 above | — | `delivery_orders` Yes |
| | `delivery_transactions` | `id`; `order_id → delivery_orders`, `hub_id`, `tx_type`, `upi_utr_ref`, `payment_proof_path`; partial UNIQUE active UTR index (`v19a:168`) | — | Yes |
| | `delivery_order_events` | `id`; `order_id → delivery_orders`, append-only event log | — | No |
| | `vehicle_listings` | `id`; `owner_id`, `driver_id`, `vehicle_type_id`, `origin_hub_id → service_hubs`, `destination_hub_ids uuid[]`, `stand_point geography(Point,4326)`, `booking_mode`, `total_seats`, `fixed_routes jsonb`, `is_active` *(No `hub_id` column!)* | `trg_vehicle_listings_stand_point` | `origin_hub_id` |
| | `vehicle_availability_blocks` | `id`; `vehicle_listing_id`, `start_time`, `end_time` | — | No |
| | `vehicle_bookings`, `vehicle_booking_otps` | `vehicle_bookings`: `booking_code UNIQUE`, `vehicle_listing_id`, `customer_id`, `driver_id`, `hub_id`, `booking_mode`, `status`, `escrow_status`, `pod_storage_path`, `pod_purge_at`; `vehicle_booking_otps`: `booking_id PK`, `pickup_otp`, `dropoff_otp`, `return_otp`, `updated_at` | `trg_vehicle_bookings_updated_at` | `vehicle_bookings` Yes |
| **Vertical Suites (19)** | **Print (`phase71a`/`v12a`)**: `listing_print_profiles`, `print_orders`, `print_order_files`, `print_order_events`, `merchant_settlements` | `listing_print_profiles`: `rate_card`, `pricing_matrix`, `is_official_printswift`, `is_first_party_printswift`; `print_order_files`: masked keys, 48h purge; `print_order_events`: append-only; `merchant_settlements`: 4 vertical sources (`locked`/`eligible`/`settled`/`reversed`) | `trg_listing_print_profiles_sync_guard`, `trg_guard_official_printswift_listings_mutation` | Yes (except `files`/`events`) |
| | **Civic (`phase72a`)**: `listing_civic_profiles`, `civic_correction_reports` | `department_type CHECK (7)`, `is_24x7`, `helplines jsonb`, `document_checklists jsonb`, `live_civic_alert`; reports `status CHECK ('pending','approved','rejected')` | `trg_before_upsert_listing_civic_profile`, `trg_sync_civic_profile_to_listing_summary` | Yes |
| | **Bookings & Hotels (`phase73a`)**: `listing_hotel_profiles`, `listing_booking_resources`, `resource_bookings` | `booking_unit CHECK (6)`, `resource_bookings`: `start_at`/`end_at`, `checkin_otp_hash`, `checkin_otp_display_for_customer` | `trg_guard_listing_hotel_profile_writes`, `trg_sync_booking_summary_*` | Yes |
| | **Shops & Restaurants (`phase74a`)**: `listing_shop_profiles`, `shop_orders`, `listing_restaurant_profiles`, `restaurant_menu_items`, `restaurant_orders`, `restaurant_table_reservations` | `listing_restaurant_profiles.allow_table_booking` *(NOT `accepts_table_reservations`)*; `restaurant_menu_items.category_name` & `diet_type` *(NOT `category`/`dietary_type`)*; `table_reservations.party_size CHECK (1..30)` | `trg_guard_*_privileged`, `trg_sync_shop_summary_*`, `trg_sync_restaurant_summary_*` | Yes |
| | **Real Estate (`phase75a`)**: `listing_real_estate_profiles`, `property_visit_requests` | `deal_type CHECK (4)`, `property_type CHECK (5)`, `patta_status`, `show_exact_pin`, `contact_reveal_policy`, `availability_status CHECK (4)`, `freshness_expires_at`, `verified_boost_expires_at` | `trg_guard_real_estate_profile_privileged`, `trg_sync_real_estate_vertical_summary` | Yes |

### 2.3 Supabase Storage Buckets & Purge Posture

| Bucket ID | Provisioned In | Public? | Ceiling | Allowed MIME Types | Storage RLS & Access | Purge Mechanism |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **`delivery-pods`** | `phase60:22`, `v19b:1474` | **Private** (`false`) | `5 MB` | `image/jpeg`, `image/png`, `image/webp` | Driver `INSERT` strictly requires `is_driver_assigned_to_pod_path(name, auth.uid())`; `SELECT` restricted to customer, assigned driver, mediator/admin. | 48h TTL for `delivery_orders` **and** `vehicle_bookings` (`v21a`), never while `disputed`/`frozen_dispute` (`purge_expired_delivery_pods()`, `/api/pick-n-drop/purge-pods`; Vercel cron `15 */6 * * *`). |
| **`print-documents`** | `phase71a:68` | **Private** (`false`) | `25 MB` | `application/pdf`, `image/jpeg`, `image/png`, `image/webp` | Zero client `SELECT` policies; server `service_role` upload (`/api/print-orders/upload`) & 5-min signed URLs (`/api/print-orders/[id]/files/[fileId]/signed-url`). | 48h TTL via `/api/print-orders/purge-expired` (cron `30 */6 * * *`) and `/api/system/purge-media` (cron `45 2 * * *`, `v21a` fixed `'print-vault'` → `'print-documents'`). |
| **`payment-proofs`** | `v21a` | **Private** (`false`) | `5 MB` | `image/jpeg`, `image/png`, `image/webp`, `application/pdf` | Uploads only via authenticated `/api/media/upload` (`entityType=payment_utr_proof`, magic-byte sniffed) into `<uid>/…`; `SELECT` = owner folder or mediator/admin; mediators open 120s signed URLs. | `media_assets` `ephemeral_ttl` (90 days). |
| **`kyc-documents`** | `pass_v6a:58` | **Private** (`false`) | `10 MB` | `application/pdf`, `image/jpeg`, `image/png`, `image/webp` | Zero client `SELECT` policies; server upload (`/api/media/upload`) & 120s signed URLs (`/api/onboarding/kyc-signed-url`). | Deleted on rejection via `/api/onboarding/review`. |
| **`avatars`** | `v14b:1203`, `v20b:183` | **Public** (`true`) | `2 MB` *(v20b)* | `image/webp`, `image/jpeg`, `image/png` | Public `SELECT`; owner-only `INSERT/UPDATE/DELETE` strictly scoped to `name LIKE (auth.uid()::text || '/%')`. | Replaced in place / owner delete. |
| **`media`** | Runtime (`app/api/media/upload`) | **Public** (`true`) | `10 MB` (`v21a`) | JPEG/PNG/WebP/GIF only (magic-byte sniffed, `v21a`) | **Authenticated** uploads only via `service_role` (`/api/media/upload`), tracked in `media_assets`; `delivery_pod`/`print_document` rejected (private pipelines). | `/api/media/discard-temp` & `/api/system/purge-media`. |
| **`listing-images`**, **`bulletin-images`** | Legacy runtime clients | **Public** (`true`) | App-enforced | Legacy direct uploads (`storage.ts:uploadImage`, `BulletinComposerModal`) | Used by unmigrated callers; target consolidation into `media` / private buckets for receipts. | Manual / unpurged (tracked in audit). |

---

## 3. RLS Policies & `SECURITY DEFINER` RPC Registry

DD oodle defined **91 active non-trigger `SECURITY DEFINER` functions** at v20b; **v21a** adds the RPCs listed in **§9.3** and re-issues/locks the grants listed in **§9.4**. `SECURITY INVOKER` functions: `generate_6digit_otp()`, `is_monetized_item_publicly_visible(timestamptz)`, plus v21a trusted-context trigger guards (`guard_profile_sensitive_columns_v20b`, `guard_payment_intent_user_update`, `guard_vertical_order_customer_writes_v21a`, `guard_requester_cancel_only_v21a`, `guard_review_reply_only_v21a`). *(Known RLS, grant, trigger, and replay defects discovered during the code/SQL audit are cataloged in [`docs/AUDIT_FORMS_AND_ROLES.md` §B.1](AUDIT_FORMS_AND_ROLES.md).)*

### 3.1 Auth, Roles, Permissions & Ownership Helpers (20 RPCs)
| Function Signature | Latest Def | Auth Gate / Behavior | Mutates |
| :--- | :--- | :--- | :--- |
| `is_super_admin()` / `is_super_admin(p_uid uuid)` | `phase72a:27` / `phase65a:10` | `profiles.role = 'super_admin'` | None |
| `is_pnd_admin(p_uid uuid)` | `phase63a:30` | `role IN ('admin','super_admin')` | None |
| `is_pnd_mediator(p_uid uuid)` | `v19a:33` | `role IN ('super_admin','admin','hub_manager','mediator')` OR active `hub_managers` | None |
| `is_hub_manager_for(p_hub_id uuid)` | `phase72a:42` | `is_super_admin()` OR active `hub_managers(profile_id=auth.uid(), hub_id)` | None |
| `can_confirm_hub_payment(p_hub_id uuid)` / `can_edit_hub_rates(p_hub_id uuid)` | `phase66a:602,625` | `is_super_admin()` OR `hub_managers` boolean flags | None |
| `can_manage_civic_hub(p_hub_id uuid)` | `phase72a:277` | `super_admin`/`admin`/`hub_manager` OR civic staff with `manage_civic` | None |
| `is_listing_owner(target_listing_id uuid)` / `is_delegated_staff(target_listing_id uuid)` | `00010:11,26` | Owner / legacy `staff_delegations` | None |
| `is_active_listing_staff(p_listing_id uuid, p_user_id uuid DEFAULT auth.uid(), p_permission text DEFAULT NULL)` | `v18a:75` | Active `staff_delegations` (`status='active'`) + optional permission | None |
| `is_print_operator_for(p_listing_id uuid)` / `is_official_printswift_listing(p_listing_id uuid)` | `phase71a:699` / `v12a:30` | Owner, active staff, or `super_admin` (if first-party) | None |
| `is_booking_operator_for(p_listing_id uuid)` / `is_commerce_operator_for(p_listing_id uuid)` / `is_real_estate_operator_for(p_listing_id uuid)` | `phase73a:554` / `phase74a:683` / `phase75a:298` | `service_role`, `super_admin`, owner, or active staff | None |
| `is_vehicle_listing_manager(p_listing_id uuid, p_uid uuid)` | `phase63a:433` | Owner, linked `drivers.profile_id`, or `is_pnd_admin` | None |
| `is_driver_assigned_to_pod_path(p_object_name text, p_uid uuid DEFAULT auth.uid())` | `v19b:1515` | Verifies POD path belongs to `delivery_orders` / `vehicle_bookings` assigned to driver | None |
| `upsert_email_otp(p_email text, p_otp text, p_expires_at timestamptz)` / `verify_email_otp(p_email text, p_otp text, p_consume boolean DEFAULT false)` | `00016:50,71` | Legacy Resend email OTP store — **`service_role` only** (`v21a` revoked PUBLIC/anon/authenticated) | `email_otps` |
| `staff_has_listing_grant(p_listing_id uuid, p_permission text DEFAULT NULL, p_scope text DEFAULT NULL, p_user_id uuid DEFAULT auth.uid())` | `v21a` | Active delegation + parent `lifecycle_status IN ('active','draining')` + `permissions` key + `vertical_scopes` (legacy object/array shapes and `print_ops`/`booking_desk`/`kitchen_shop`/`visit_desk` aliases) | None |
| `is_hardcoded_super_admin_email(text)` / `_v21a_is_hardcoded_super_admin_user(uuid)` | `v21a` | SQL allowlist mirrored by `lib/auth/super-admin.ts` (`thangboiahi@gmail.com`, `homeautomation.dd@gmail.com`) | None |

### 3.2 SuperAdmin, Audit, Telemetry, Taxonomy & Localities (16 RPCs)
| Function Signature | Latest Def | Auth Gate / Behavior | Mutates |
| :--- | :--- | :--- | :--- |
| `write_audit_log(p_actor_id uuid, p_actor_role text, p_action text, p_target_table text, p_target_id text, p_metadata jsonb DEFAULT '{}')` | `v15a:142` | `service_role` or `is_pnd_admin(auth.uid())` | `audit_logs` |
| `superadmin_set_user_role(p_target_user_id uuid, p_new_role text)` | `v15a:299` | `is_super_admin()` only; blocks mutating immutable `super_admin` | `profiles`, `audit_logs` |
| `get_command_center_metrics(p_days integer DEFAULT 30)` | `v15f:77` | `is_pnd_admin(auth.uid())` | None |
| `purge_old_app_analytics_events(p_retention_days integer DEFAULT 90)` | `v15f:470` | `service_role` or `is_super_admin()` | `app_analytics_events`, `audit_logs` |
| `search_users_by_username(p_query text, p_limit integer DEFAULT 8)` | `v13a:81` | `auth.uid() IS NOT NULL`; returns public handle fields only | None |
| `detect_nearest_hub(p_lat double precision, p_lng double precision)` | `phase66a:653` | Public PostGIS `ST_Distance` lookup | None |
| `get_category_subtree_ids(p_category_id uuid)` / `get_category_descendant_ids(p_category_id uuid)` | `phase67a:970` / `v16b:860` | Public recursive category tree resolution | None |
| `category_matches_plan_scope(p_category_id uuid, p_allowed_category_ids uuid[], p_allowed_root_keys text[])` | `v16b:881` | Public plan-to-category scope matcher | None |
| `suggest_leaf_category(p_parent_id uuid, p_name text)` | `v17a:84` | `auth.uid() IS NOT NULL`; L2 parent only, 5/24h rate limit, dedupe | `categories`, `audit_logs` |
| `review_suggested_category(p_category_id uuid, p_action text, p_display_name text DEFAULT NULL, p_slug text DEFAULT NULL, p_icon_key text DEFAULT NULL, p_accent_color text DEFAULT NULL, p_parent_id uuid DEFAULT NULL, p_review_notes text DEFAULT NULL)` | `v17a:307` | `is_super_admin()` | `categories`, `audit_logs` |
| `merge_suggested_category(p_source_id uuid, p_target_id uuid, p_review_notes text DEFAULT NULL)` | `v17a:502` | `is_super_admin()` | `categories`, `listings`, `marketplace_products`, `bulletins`, `audit_logs` |
| `search_hub_localities(p_hub_id uuid, p_query text DEFAULT '', p_limit integer DEFAULT 10)` | `phase67a:995` | Public `pg_trgm` fuzzy search | None |
| `submit_or_resolve_locality(p_hub_id uuid, p_name text, p_lat double precision DEFAULT NULL, p_lng double precision DEFAULT NULL, p_source text DEFAULT 'user_submitted')` | `phase67a:1131` | `auth.uid() IS NOT NULL` or `service_role` | `hub_localities` |
| `merge_locality_into_canonical(p_source_id uuid, p_target_id uuid)` | `phase67a:1271` | `service_role` or `is_hub_manager_for(hub_id)` | `hub_localities`, `listings`, `vehicle_listings`, `profiles`, `user_interests` |
| `promote_category_suggestion(p_suggestion_id uuid, p_display_name text, p_parent_id uuid, p_icon text DEFAULT 'Tag', p_color text DEFAULT '#2563EB')` | `phase67a:1416` | `service_role` or `is_super_admin()` (legacy queue) | `category_suggestions`, `categories` |

### 3.3 Monetization, Entitlements, Subscriptions, Pay-Per & Payments (18 RPCs)
| Function Signature | Latest Def | Auth Gate / Behavior | Mutates |
| :--- | :--- | :--- | :--- |
| `get_effective_entitlements(p_user_id uuid, p_listing_id uuid DEFAULT NULL)` | `v17b:916` | Public; merges active/trialing plans + default free fallback | None |
| `get_listing_public_capabilities(p_listing_id uuid)` | `v17b:1435` | Public; privacy-safe customer-facing capability flags | None |
| `start_plan_trial(p_plan_id uuid)` | `v17b:563` | Authenticated; enforces `trial_used_at IS NULL` & targeting | `user_subscriptions`, `profiles`, `audit_logs` |
| `reset_user_trial_eligibility(p_user_id uuid)` | `v17b:735` | `is_super_admin()` | `profiles`, `audit_logs` |
| `superadmin_override_user_subscription(p_user_id uuid, p_plan_id uuid, p_starts_at timestamptz, p_expires_at timestamptz, p_status text, p_subscription_id uuid DEFAULT NULL)` | `phase64a:822` | `is_super_admin(auth.uid())` | `user_subscriptions` |
| `resolve_effective_payment_methods(p_scope_key text, p_listing_id uuid DEFAULT NULL)` | `v16b:1448` | Public; intersects `payment_feature_policies` with category overrides | None |
| `calculate_pay_per_quote(p_module_key text, p_duration_days integer, p_property_price_inr numeric DEFAULT NULL, p_area_value numeric DEFAULT NULL, p_area_unit text DEFAULT 'sqft', p_addon_ids text[] DEFAULT '{}')` | `v17c:366` | Public Manipur Sangam/acre/sq.m/sq.ft + price-band calculator | None |
| `submit_pay_per_order(p_module_key text, p_target_table text, p_target_id uuid, p_duration_days integer, p_payment_method text, p_upi_utr_ref text DEFAULT NULL, p_property_price_inr numeric DEFAULT NULL, p_area_value numeric DEFAULT NULL, p_area_unit text DEFAULT 'sqft', p_addon_ids text[] DEFAULT '{}')` | `v17c:556` | Authenticated + owns `target_id` | `pay_per_orders`, `audit_logs` |
| `review_pay_per_order(p_order_id uuid, p_decision text, p_notes text DEFAULT NULL)` | `v17c:772` | `is_pnd_admin(auth.uid())` | `pay_per_orders`, target table, `audit_logs` |
| `fulfill_payment_intent(p_intent_id uuid, p_provider_payment_id text DEFAULT NULL, p_provider text DEFAULT NULL)` | `phase75a:438` | `service_role`, `is_super_admin()`, or `can_confirm_hub_payment(hub_id)` | `payment_intents`, `promo_codes`, domain targets, `merchant_settlements` |
| `refund_payment_intent(p_intent_id uuid, p_refund_utr text, p_notes text DEFAULT NULL)` | `phase63a:980` | `service_role` or `is_pnd_admin(auth.uid())` | `payment_intents`, domain targets |
| `validate_and_apply_promo(p_intent_id uuid, p_code text)` | `phase64a:682` | `auth.uid() = intent.user_id` | `payment_intents` |
| `has_active_print_entitlement(p_listing_id uuid)` | `v12a:53` | Public; delegates to `is_official_printswift_listing` + `get_effective_entitlements` | None |
| `has_active_booking_entitlement(p_listing_id uuid, p_vertical text)` | `pass_r1a:369` | Public; delegates to `get_effective_entitlements` | None |
| `has_active_commerce_entitlement(p_listing_id uuid, p_vertical text)` | `phase74a:624` | *(Overwrote `pass_r1a:394` due to filename sort — see audit)* | None |
| `has_active_real_estate_pro(p_listing_id uuid)` | `phase75a:343` | *(Overwrote `pass_r1a:419` due to filename sort — see audit)* | None |
| `get_owner_workspace_summary(p_target_owner_id uuid DEFAULT NULL)` | `v18a:675` | Self or `is_super_admin()` | None |
| `get_advertiser_workspace_summary()` | `v20a:195` | `auth.uid() IS NOT NULL` | None |

### 3.4 Pick N Drop, Vehicle Bookings, Mediator & Driver Suite (19 RPCs)
| Function Signature | Latest Def | Auth Gate / Behavior | Mutates |
| :--- | :--- | :--- | :--- |
| `create_vehicle_booking_with_intent(...)` (9 params) | `v14b:717` | Authenticated; row locks, creates booking + OTP vault + intent | `vehicle_bookings`, `vehicle_booking_otps`, `payment_intents` |
| `verify_vehicle_booking_otp(p_booking_id uuid, p_stage text, p_otp text)` | `v14b:931` | Legacy manager/mediator OTP verifier | `vehicle_booking_otps`, `vehicle_bookings` |
| `verify_delivery_otp(p_order_id uuid, p_stage text, p_otp text, p_pod_path text DEFAULT NULL)` | `v19a:207` | Legacy driver/mediator verifier (5-attempt lockout) | `delivery_order_secrets`, `delivery_orders`, `delivery_order_events`, `audit_logs` |
| `mediator_confirm_delivery(p_order_id uuid)` | `phase60:795` | Legacy `is_pnd_mediator` delivery confirm + 85/15 split | `delivery_orders`, `delivery_transactions`, `delivery_order_events` |
| `get_mediator_otp_milestones(p_order_ids uuid[] DEFAULT '{}', p_booking_ids uuid[] DEFAULT '{}')` | `v19a:496` | `is_pnd_mediator(auth.uid())`; booleans/timestamps ONLY | None |
| `_log_mediator_audit_v19a(...)` / `_log_driver_audit_v19b(...)` | `v19a:576` / `v19b:82` | `service_role` internal audit writers | `audit_logs` |
| `mediator_verify_upi_payment(p_booking_id uuid, p_decision text, p_notes text DEFAULT NULL)` | `v19a:635` | `is_pnd_mediator(auth.uid())`; approves/rejects UPI across PnD & vehicles | `delivery_orders`/`vehicle_bookings`, `payment_intents`, `delivery_transactions`, `delivery_order_events`, `audit_logs` |
| `mediator_dispatch_driver(p_booking_id uuid, p_driver_id uuid, p_reason text DEFAULT NULL)` | `v19a:1015` | `is_pnd_mediator(auth.uid())`; assigns/reassigns verified driver | `delivery_orders`/`vehicle_bookings`, `delivery_order_events`, `audit_logs` |
| `mediator_resolve_escrow_payout(p_booking_id uuid, p_action text, p_reason text DEFAULT NULL)` | `v19a:1245` | `is_pnd_mediator(auth.uid())`; release / freeze dispute / refund | `delivery_orders`/`vehicle_bookings`, `delivery_transactions`, `payment_intents`, `delivery_order_events`, `audit_logs` |
| `_canonical_fleet_slug_v19b(p_raw text)` | `v19b:146` | Pure fleet slug normalizer | None |
| `driver_update_vehicle_status(p_is_available boolean, p_lat double precision DEFAULT NULL, p_lng double precision DEFAULT NULL)` | `phase61a:244` (`v19b:119` overload) | Verified driver (`drivers.profile_id = auth.uid()`) | `vehicles`, `drivers` |
| `driver_accept_job(p_booking_id uuid)` | `v19b:171` | Verified online driver matching hub + fleet (`FOR UPDATE`) | `delivery_orders`/`vehicle_bookings`, `delivery_order_events`, `audit_logs` |
| `driver_verify_handover_otp(p_booking_id uuid, p_stage text, p_otp_input text, p_pod_storage_path text DEFAULT NULL)` | `v19b:444` | Assigned driver only; 5-attempt lockout; checks POD path regex | `delivery_order_secrets`, `vehicle_booking_otps`, `delivery_orders`/`vehicle_bookings`, `delivery_order_events`, `audit_logs` |
| `driver_update_trip_status(p_booking_id uuid, p_status text, p_reason text DEFAULT NULL)` | `v19b:853` | Assigned driver only | `delivery_orders`/`vehicle_bookings`, `delivery_order_events`, `audit_logs` |
| `get_driver_payout_summary()` / `get_driver_available_jobs()` / `get_driver_trip_otp_milestones(...)` | `v19b:1121,1299,1396` | Verified/assigned driver only; zero plaintext OTPs returned | None |
| `purge_expired_delivery_pods()` | `v14b:1150` | `service_role` or `is_super_admin()` (`pg_cron` 6h job) | `delivery_orders`, `storage.objects` |

### 3.5 Vertical Suites, Lifecycle, Media, Referrals & Banners (18 RPCs)
| Function Signature | Latest Def | Auth Gate / Behavior | Mutates |
| :--- | :--- | :--- | :--- |
| `get_my_print_collection_otp(p_order_id uuid)` / `verify_print_collection_otp(p_order_id uuid, p_otp text, p_direct_payment_confirmed boolean DEFAULT false)` | `phase71a:749,778` | Customer read / `is_print_operator_for(listing_id)` verify | `print_orders`, `merchant_settlements`, `print_order_events` |
| `create_atomic_resource_booking(...)` (22 params) / `verify_booking_checkin_otp(p_booking_id uuid, p_otp text, p_balance_collected boolean DEFAULT false)` | `phase73a:596,793` | Atomic `FOR UPDATE` slot lock / `is_booking_operator_for` OTP | `resource_bookings`, `merchant_settlements` |
| `verify_commerce_pickup_otp(p_order_type text, p_order_id uuid, p_otp text, p_direct_payment_confirmed boolean DEFAULT false)` | `phase74a:728` | `is_commerce_operator_for(listing_id)` | `shop_orders`/`restaurant_orders`, `merchant_settlements` |
| `confirm_property_freshness(p_listing_id uuid, p_availability_status text DEFAULT 'available')` | `phase75a:391` | `is_real_estate_operator_for(listing_id)` | `listing_real_estate_profiles` |
| `refresh_listing_booking_vertical_summary(uuid)` / `refresh_listing_shop_vertical_summary(uuid)` / `refresh_listing_restaurant_vertical_summary(uuid)` | `phase73a:189` / `phase74a:460,540` | Trigger/sync helpers | `listings.vertical_summary` |
| `bind_media_assets(p_storage_paths text[], p_entity_type text, p_entity_id uuid, p_retention_class text DEFAULT 'permanent_bound', p_ttl_hours integer DEFAULT NULL)` | `pass_r1a:665` | Binds/schedules temp media cleanup | `media_assets` |
| `cleanup_temporary_media_assets(hours_old integer DEFAULT 24)` | `00017:38` | Marks expired temp assets | `media_assets` |
| `archive_business_listing(p_listing_id uuid, p_reason text DEFAULT NULL)` | `pass_r1a:719` | `service_role`, `is_super_admin()`, or owner | `listings`, `staff_delegations`, `notifications`, `user_subscriptions`, `media_assets` |
| `transfer_business_ownership(p_listing_id uuid, p_new_owner_id uuid, p_reactivate_staff boolean DEFAULT false, p_transfer_subscriptions boolean DEFAULT true)` | `pass_r1a:864` | `service_role` or `is_super_admin()` | `listings`, `staff_delegations`, `user_subscriptions` |
| `get_user_operational_hats(p_user_id uuid)` | `v14b:191` | Aggregates role, listings, vehicles, `staff_delegations`, `drivers`, `hub_managers` | None |
| `review_partner_application(p_application_id uuid, p_new_status text, p_reviewer_notes text DEFAULT NULL)` | `v14b:294` | `service_role`, `is_super_admin()`, or `is_hub_manager_for(hub_id)` | `partner_applications`, `drivers`, `listings`, `referrals`, `notifications` |
| `ensure_user_referral_code(p_user_id uuid DEFAULT auth.uid())` / `apply_referral_code(p_code text, p_referral_type text DEFAULT 'user_signup', p_hub_id uuid DEFAULT NULL)` | `pass_v6a:408,472` | Generates `DD-XXXXXX` / records qualified referral | `profiles`, `referrals` |
| `track_banner_metric(p_banner_id uuid, p_metric text)` | `phase65a:137` | Public impressions/clicks incrementer | `app_banners` |

### 3.6 Surviving RLS Highlights
- **`listings` (`v18a`, `v20a`, `phase66a`, `v12a`):** Public `SELECT` requires `status = 'published' AND is_monetized_item_publicly_visible(paid_until)` (`v20a:179`); owners, `is_active_listing_staff(id)`, `hub_managers`, and admins read/update within role bounds; staff cannot delete listings or set `owner_id`/`paid_until`/`lifecycle_status`; non-superadmin cannot mutate `is_official_printswift`.
- **`marketplace_products` / `bulletins` / `app_banners` (`v20a:101-160`, `v18a:606`):** Public `SELECT` filtered by `is_monetized_item_publicly_visible(paid_until)` (plus `bulletins.status = 'published' AND (expires_at IS NULL OR expires_at > now())`); active delegated staff with permission manage `marketplace_products`.
- **`staff_delegations` & `enquiries` (`v18a:259-480`):** Enforces `status = 'active'` and server-side `max_staff` limit via `trg_enforce_and_audit_staff_delegation_v18a`.
- **`delivery_orders`, `vehicle_bookings`, `payment_intents` (`v19a`, `v19b`):** Drivers have strict read-only access to assigned rows and must transition state exclusively through `v19b` RPCs; `delivery-pods` storage inserts require `is_driver_assigned_to_pod_path()`.
- **`audit_logs` (`v15a`, `v19a`):** `SELECT` allowed only for `is_pnd_admin` or mediator's own `workspace='mediator'` rows; zero client `INSERT`/`UPDATE`/`DELETE` policies.

---

## 4. 3-Level Fixed-Root Category Taxonomy (`v16b`) & User-Suggested Leaves (`v17a`)

### 4.1 11 Immutable Level-1 System Roots (`20261125_pass_v16b_three_level_category_taxonomy.sql:86-178`)
Depth uses **`1..3`** (`CHECK (depth BETWEEN 1 AND 3)`): **L1 (`depth=1`, `is_system_root=true`)** → **L2 (`depth=2`)** → **L3 (`depth=3` leaf)**.

| # | `entity_type` | `slug` / `root_key` | `display_name` | `icon_key` | `accent_color` | `sort_order` | Platform Mapping |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| 1 | `listing` | `general` | General Business & Services | `briefcase` | `#2563EB` | 10 | `listings.listing_vertical = 'general'` |
| 2 | `listing` | `shop_catalogue` | Retail & Local Shop Catalogue | `shopping-bag` | `#0D9488` | 20 | `listings.listing_vertical = 'shop_catalogue'` |
| 3 | `listing` | `restaurant_food` | Restaurants, Cafés & Bakeries | `utensils` | `#EA580C` | 30 | `listings.listing_vertical = 'restaurant_food'` |
| 4 | `listing` | `print_digital` | Print, Copy & Digital Services | `printer` | `#4F46E5` | 40 | `listings.listing_vertical = 'print_digital'` |
| 5 | `listing` | `real_estate` | Real Estate & Land Plots | `home` | `#D97706` | 50 | `listings.listing_vertical = 'real_estate'` |
| 6 | `listing` | `hotel_stay` | Hotels, Homestays & Lodging | `bed-double` | `#0284C7` | 60 | `listings.listing_vertical = 'hotel_stay'` |
| 7 | `listing` | `booking_venue` | Sports & Venue Bookings | `trophy` | `#16A34A` | 70 | `listings.listing_vertical = 'booking_venue'` |
| 8 | `listing` | `public_civic` | Public & Civic Institutions | `landmark` | `#7C3AED` | 80 | `listings.listing_vertical = 'public_civic'` |
| 9 | `product` | `marketplace` | Marketplace & Shop Products | `store` | `#059669` | 10 | `marketplace_products` |
| 10 | `bulletin` | `bulletin` | Community Bulletins & Notices | `megaphone` | `#E11D48` | 10 | `bulletins` |
| 11 | `vehicle` | `vehicles` | Fleet & Vehicle Rentals | `car` | `#0891B2` | 10 | `vehicle_listings` |

- **Actual Triggers (`v16b:620-795`):**
  - `trg_categories_v16b_guard` (`guard_and_maintain_categories_v16b`): Blocks deletes and structural mutations (`slug`, `root_key`, `entity_type`, `parent_id`, `depth`, `is_system_root`) on `is_system_root = true` rows across **all** sessions, blocks creating new L1 roots, enforces `depth <= 3`, computes `root_key` & `path_slugs`, and prevents cycles.
  - `trg_categories_v16b_cascade` (`cascade_category_descendants_v16b`): Cascades `depth`, `root_key`, and `path_slugs` updates down to L2/L3 descendants.
  - `trg_listings_sync_root_key_v16b` (`sync_listing_root_key_v16b`): Syncs `listings.root_key` (and `listing_vertical` if `'general'`) from `categories.root_key` on `category_id` / `listing_vertical` writes.

### 4.2 User-Suggested L3 Leaf Categories (`20261125_pass_v17a_user_suggested_leaf_categories.sql`)
- Extends `public.categories` with `review_status CHECK ('official','pending_review','rejected','merged')`, `suggested_by`, `suggested_at`, `reviewed_by`, `reviewed_at`, `review_notes`, `merged_into_id` + indexes `idx_categories_pending_review` and `idx_categories_suggested_by`.
- **Owner/User Flow:** `suggest_leaf_category(p_parent_id, p_name)` verifies an active `official` **L2** parent, enforces a **5 suggestions per user per 24h** rate limit, deduplicates matching siblings, and inserts an inactive `pending_review` L3 leaf returning `{ status, message, category }`.
- **Superadmin Triage (`SuggestedCategoriesReview.tsx`):** `review_suggested_category(...)` (`approve` / `reject`, optional edits to name/slug/icon/color/parent) or `merge_suggested_category(...)` (re-links `listings`, `marketplace_products`, and `bulletins` `category_id` to target leaf, marks source `merged`, and writes `audit_logs`).

---

## 5. Unified Monetization Engine (`v17b`, `v17c`, `v20a`)

### 5.1 Subscription Engine (`20261125_pass_v17b_unified_subscriptions_and_customer_gates.sql`)
- **Single Immutable Default Free Tier:** `subscription_plans.is_default_free = true` (partial UNIQUE index `idx_subscription_plans_single_default_free`) guarded by `trg_guard_default_free_plan_v17b` (`BEFORE UPDATE OR DELETE`). `get_effective_entitlements()` falls back to `default_free_tier` whenever an owner/user has no active paid or trial subscription.
- **One-Time Trial Lock:** `subscription_plans.trial_days` (`0..365`) + `profiles.trial_used_at`. Users activate a trial once via `start_plan_trial(p_plan_id)` (status `'trialing'`, `is_trial = true`); only `super_admin` may reset via `reset_user_trial_eligibility(p_user_id)`. Partner approval trigger `trg_partner_approval_auto_trial_v17b` auto-starts eligible trials.
- **Targeted VIP Plans:** `target_scope CHECK ('all_users','selected_users')`, `target_user_ids uuid[]` (GIN-indexed `idx_subscription_plans_target_user_ids_gin`).
- **Staff Cap & Auto-Verify:** `subscription_plans.max_staff` (`-1` = unlimited) enforced server-side by `trg_enforce_and_audit_staff_delegation_v18a`. `auto_verify = true` promotes `listings.is_verified = true` / `status = 'published'` (`trg_apply_listing_auto_verify_v17b`) and auto-publishes bulletins (`trg_bulletins_auto_verify_v17b`).
- **Privacy-Safe Customer Gates:** Public surfaces query `get_listing_public_capabilities(p_listing_id)` rather than exposing owner billing rows, gating `can_accept_print_orders`, `can_accept_bookings`, `can_accept_shop_orders`, `can_accept_food_orders`, `can_accept_table_reservations`, `can_receive_enquiries`, and `is_verified_partner`.

### 5.2 Pay-Per Monetization, Manipur Land Units & UTR Replay Guard (`v17c`, `v19a`)
- **4 Pay-Per Modules (`pay_per_pricing_configs`):**
  1. `bulletin_post` (`flat_duration`, default ₹79) → `bulletins`
  2. `marketplace_item` (`flat_duration`, default ₹49) → `marketplace_products`
  3. `real_estate_listing` (`price_percentage` / `area_tier`, `min_cap_inr`/`max_cap_inr` `numeric(10,2)`) → `listings`
  4. `banner_ad` (`flat_duration`, default ₹199) → `app_banners`
- **Manipur Land Area Conversions (`calculate_pay_per_quote` `v17c:366`):** Converts `sqft`, `sqm` (`1 sq.m = 10.7639104 sq.ft`), `acre` (`1 acre = 43,560 sq.ft`), and **Manipur `sangam` (`1 sangam = 10,890 sq.ft = 0.25 acre`)** cleanly into `sq.ft` before evaluating `area_tiers` (`{ min_sqft, max_sqft, surcharge_inr }`) and price slabs (`{ min_inr, max_inr, surcharge_inr }`).
- **UTR Replay Protection (Partial UNIQUE Indexes on `upper(trim(upi_utr_ref))`):**
  - `pay_per_orders`: `idx_pay_per_orders_unique_active_utr` (`v17c:304`, `WHERE status IN ('pending_verification', 'paid')`)
  - `payment_intents`: `idx_payment_intents_unique_active_utr_v19a` (`v19a:160`, `WHERE status NOT IN ('failed','expired','refunded')`)
  - `delivery_transactions`: `idx_delivery_transactions_unique_active_utr_v19a` (`v19a:168`, `WHERE tx_type = 'escrow_hold'`)
  - *(Audit gap: `bulletin_post_passes.upi_utr_ref` still lacks a unique index — see `AUDIT_FORMS_AND_ROLES.md`.)*
- **Dual-Rail Payment Policy Resolver:** `payment_feature_policies` (`v15b:945`) intersected with category overrides via `resolve_effective_payment_methods(scope_key, listing_id)` (`v16b:1448`), paired with global Razorpay + Manual UPI kill switches in `platform_settings.payment_config`.

### 5.3 Soft-Expiry Visibility Parity (`20261126_pass_v20a_advertiser_and_public_expiry_parity.sql`)
- `public.is_monetized_item_publicly_visible(p_paid_until timestamptz)` returns `true` when `p_paid_until IS NULL OR p_paid_until > now()`.
- Enforced at RLS `SELECT` on `bulletins`, `marketplace_products`, `app_banners`, and `listings` (`*_public_or_owner_select_v20a`), while owners/admins retain workspace visibility to renew via `PayPerCheckoutModal`.

---

## 6. Role & Hat Permissions Matrix (All 8 Roles)

### 6.1 Canonical `profiles.role` & Multi-Hat Resolution
- **DB `profiles_role_check` (`v21a`):** `('visitor', 'driver', 'staff', 'owner', 'hub_manager', 'mediator', 'admin', 'super_admin')`. `mediator` is assignable via `superadmin_set_user_role` / `UsersDriversManagersTab`; `advertiser` remains a workspace **hat** (derived from bulletin activity), not a DB role.
- **Multi-Hat Entry (`/workspace?hat=...` in `WorkspaceHatShell.tsx`):** Reads `get_user_operational_hats(userId)` + active `staff_delegations` + `drivers` + `hub_managers` and normalizes `?hat=`: `business → owner`, `admin → master_control`, `bulletin(s) → advertiser`, `dispatch_mediator → mediator`.

| # | Role / Hat | Primary Surface / `?hat=` | Core Capabilities | Strict Boundaries |
| :--- | :--- | :--- | :--- | :--- |
| 1 | **Visitor / Customer** | Public routes (`/`, `/explore`, `/marketplace`, `/bookings`, `/vehicles`, `/bulletin`, `/civic`, `/listing/[id]`, `/activity`, `/saved`, `/profile`, `/settings`, `/onboarding`) | Browse hub-scoped public content, submit enquiries/reviews/corrections, place shop/food/print/booking/vehicle/PnD orders, pay via Razorpay or UPI UTR, view own OTPs offline (`pwa-store.ts`), apply for Partner KYC. | Zero admin/workspace access unless delegated or approved; sees active/unexpired `paid_until` items only. |
| 2 | **Business Owner** | `/workspace?hat=owner` (`OwnerStaffWorkspace`) | Create/edit listings across all 7 non-civic L1 roots (`ListingEditorModal`), suggest L3 leaves, manage Print/Commerce/Bookings/Real Estate desks, manage catalogue, reply enquiries & reviews, delegate staff up to `max_staff`, start trial / subscribe / pay-per. | Cannot create/edit `public_civic` or `is_official_printswift` listings; cannot self-verify or bypass subscription/pay-per gates. |
| 3 | **Delegated Staff** | `/workspace?hat=staff` (`StaffWorkspace` → `OwnerStaffWorkspace`) | Operate assigned listings (`staff_delegations.status = 'active'`) within granted `vertical_scopes` & `permissions` (edit details, media, catalogue, enquiries, live print/kitchen/booking/visit queues). | Blocked from deleting listings, transferring `owner_id`, archiving parent business, spoofing `paid_until`, managing `staff_delegations`, or changing billing/subscriptions. |
| 4 | **Local Driver** | `/workspace?hat=driver` (`DriverWorkspace`) | Toggle online/offline + GPS (`driver_update_vehicle_status`), claim funded PnD jobs (`driver_accept_job` `FOR UPDATE`), update trip milestone (`driver_update_trip_status`), verify asymmetric handover OTP + upload WebP POD (`driver_verify_handover_otp` → `delivery-pods`), manage own `vehicle_listings`, view payout ledger. | **Zero `SELECT` access** to `delivery_order_secrets` or `vehicle_booking_otps`; must pass KYC (`kyc_verified && is_active`) before claiming jobs; path-confined storage uploads. |
| 5 | **Dispatch Mediator** | `/workspace?hat=mediator` (`MediatorWorkspace`) | Verify/reject pending UPI UTRs (`mediator_verify_upi_payment`), dispatch/reassign verified drivers (`mediator_dispatch_driver`), inspect private 48h POD via 60s signed URLs, release escrow / freeze dispute / refund (`mediator_resolve_escrow_payout`), view own `audit_logs`. | **Zero access** to plaintext OTPs in UI **and DB** (`v21a` revoked mediator `SELECT` on `delivery_order_secrets`/`vehicle_booking_otps` and mediator OTP verification). Dedicated `mediator` role + admins act platform-wide; hub managers are hub-scoped inside all 3 mediator RPCs (`_v21a_assert_dispatch_hub_scope`). Escrow state machine blocks double payout and refund-after-payout. Legacy `PickNDropConsole` / `UnifiedPaymentsQueue` are unmounted (`MediatorDeskRedirectCard`). |
| 6 | **Hub Manager** | `/workspace?hat=hub_manager` (`HubManagerWorkspace`) | **Zone-scoped governance (`hub_managers` matched on `profile_id` + `hub_id`):** verify local listings (`/api/listings/review`), review local Partner/Driver KYC (`/api/onboarding/review`), moderate local bulletins/civic/print/real-estate/featured slots, manage `hub_localities` & `hub_vehicle_rates` (`can_edit_rates`), confirm local UPI (`can_confirm_manual_payments`). | Restricted strictly to assigned `hub_id`(s); cannot grant `super_admin`, alter global L1/L2 taxonomy, edit global payment gateways/homepage containers, or mutate Official PrintSwift beyond hub policies. |
| 7 | **Advertiser** | `/workspace?hat=advertiser` (`AdvertiserWorkspace`) | Compose & manage bulletins (`BulletinComposerModal`: announcements, jobs, events with venue pin, YouTube notices), purchase Pay-Per passes (`PayPerCheckoutModal`), activate trial / bulletin plans, track `paid_until` expiry & spend. | Subject to `bulletins_status_check`, quota triggers, and `paid_until` visibility parity. |
| 8 | **Superadmin** | `/workspace?hat=master_control` (`/admin` redirects here) (`AdminWorkspace` + `SuperAdminPanel` + `MasterControlConsole`) | Global command center telemetry (`get_command_center_metrics`), `HomepageBuilder`, canonical 3-level `CategoryBuilder` & suggested leaf approve/merge, `SubscriptionPlansBuilder`, `SubscribersManager`, `PaymentMethodsMatrix`, `PayPerMonetizationStudio`, `ServiceHubs` & `hub_managers` assignment, Official PrintSwift, `merchant_settlements`, `AuditLogsViewer`, role assignment (`superadmin_set_user_role`). | Hardcoded dual-lock (`isVerifiedSuperAdmin`: email allowlist + `role = 'super_admin'`). Immutable `super_admin` profiles cannot be demoted/deleted via client RPCs. |

### 6.2 Hub Manager Scope: Current Overlap vs. Target Scaled Separation
- **Current Overlap:** `AdminWorkspace` currently mounts redundant local moderation panels (`listings`, `AdminBulletinManager`, `PickNDropConsole`, `UnifiedPaymentsQueue`, `UsersDriversManagersTab` driver KYC, `CivicDirectoryManager`) alongside global Superadmin builders, while several tables (`pay_per_orders`, `audit_logs`, `popular_localities`, `categories.suggested_by`, `bulletin_post_passes`, `bulletin_reports`, `user_subscriptions`, `notifications`) lack `hub_id` columns and `v19a` mediator RPCs lack `is_hub_manager_for(hub_id)` checks.
- **Target Scaled Separation:**
  - **Hub Manager (`hub_id`-scoped execution):** Local listing verification, local bulletin & report moderation, local driver/partner KYC & fleet verification, Stage-1 local suggested-leaf category triage (`suggested_hub_id`), local civic/stand/`hub_localities` curation, Tier-1 local PnD/payment dispatch & disputes.
  - **Superadmin (global platform & cross-hub escalation):** `service_hubs` & `hub_managers` provisioning, global Brand/Legal/Payment/Kill Switches, `HomepageBuilder`, canonical Taxonomy promotion/merge (`CategoryBuilder`), Subscription/Pay-Per pricing studio, `merchant_settlements` payouts, global media purge, Tier-2 escalated disputes, and global `AuditLogsViewer`.

---

## 7. Complete App Route Map, Workspace Architecture & Shared UX Primitives

### 7.1 App Router Page Map (`app/**/page.tsx` — **28 Files** + **4** Redirects + Auth Callback)
- **Public Discovery & Verticals (11):** `/` (`app/page.tsx`), `/explore`, `/marketplace`, `/bookings`, `/vehicles`, `/vehicles/[id]`, `/bulletin`, `/civic`, `/listing/[id]`, `/listing/[id]/book`, `/listing/[id]/print`
- **Redirect Page Route (1):** `/pick-n-drop` (`app/pick-n-drop/page.tsx` — Server Component forwarding all query params + `mode=pick_n_drop` → `/explore`)
- **User & Role Operations (9):** `/workspace` (`WorkspaceHatShell` supporting `owner`, `staff`, `driver`, `mediator`, `advertiser`, `hub_manager`, `master_control`), `/onboarding`, `/activity`, `/saved`, `/messages`, `/profile`, `/profile/edit`, `/user/[id]`, `/settings`
- **Auth, Info & Legal (7):** `/login`, `/signup`, `/about`, `/contact`, `/legal/privacy`, `/legal/refund-policy`, `/legal/terms`
- **Config Redirects (`next.config.ts:91-114`):** `/admin` → `/workspace?hat=master_control` · `/driver` → `/workspace?hat=driver` · `/activities` → `/activity` · `/bookmarks` → `/saved`
- **Auth Callback (`app/auth/callback/route.ts`):** `@supabase/ssr` PKCE `exchangeCodeForSession` + onboarding redirect check (`sanitizeRelativeNextPath`).
- **Metadata / Crawlers:** `app/robots.ts`, `app/sitemap.ts`. *(No root `error.tsx` / `not-found.tsx`.)*

### 7.2 API Route Inventory (`app/api/**/route.ts` — **54 Routes**)

> **`v21a`:** new `POST /api/contact` (validated, honeypot, per-IP + per-email rate limit, service-role insert into `contact_messages`). `/api/media/upload` now requires auth for every upload, MIME allow-lists + magic-byte sniffing + size caps, and stores UTR receipts in the private `payment-proofs` bucket. `/api/payments/submit-utr` fans out to all 18 payment purposes. `/api/auth/set-view-role` rejects unauthenticated callers (401). `/api/system/purge-media` accepts `GET` for Vercel Cron.
| Domain (Count) | Route Paths |
| :--- | :--- |
| **Admin / Config / Dev / Telemetry (7)** | `/api/admin/payment-env-status`, `/api/admin/revalidate-homepage`, `/api/config/public`, `/api/dev/seed-test-accounts`, `/api/seed`, `/api/system/purge-media`, `/api/telemetry/track` |
| **Auth & Profile (7)** | `/api/auth/complete-signup`, `/api/auth/reset-password`, `/api/auth/send-otp`, `/api/auth/set-view-role`, `/api/auth/upload-avatar`, `/api/auth/verify-otp`, `/api/profile/update-map-settings` |
| **Bookings (4)** | `/api/bookings/availability`, `/api/bookings/create`, `/api/bookings/[id]/owner-action`, `/api/bookings/walk-in-block` |
| **Commerce (5)** | `/api/commerce/restaurant-orders/create`, `/api/commerce/restaurant-orders/[id]/kitchen-action`, `/api/commerce/shop-orders/create`, `/api/commerce/shop-orders/[id]/owner-action`, `/api/commerce/table-reservations` |
| **Real Estate (3)** | `/api/real-estate/boost/create-intent`, `/api/real-estate/freshness`, `/api/real-estate/visit-requests` |
| **Directory / Civic / Hubs / Media / Onboarding (12)** | `/api/categories/suggest`, `/api/civic/manage`, `/api/civic/report-correction`, `/api/hubs/detect`, `/api/hubs/request-city`, `/api/listings/review`, `/api/localities/resolve`, `/api/localities/suggest`, `/api/media/discard-temp`, `/api/media/upload`, `/api/onboarding/kyc-signed-url`, `/api/onboarding/review` |
| **Payments (5)** | `/api/payments/create-intent`, `/api/payments/submit-utr`, `/api/payments/razorpay/create-order`, `/api/payments/razorpay/verify`, `/api/payments/razorpay/webhook` |
| **Pick N Drop (3)** | `/api/pick-n-drop/orders`, `/api/pick-n-drop/purge-pods`, `/api/pick-n-drop/quote` |
| **Print Orders (7)** | `/api/print-orders/create`, `/api/print-orders/quote`, `/api/print-orders/upload`, `/api/print-orders/purge-expired`, `/api/print-orders/[id]/shop-action`, `/api/print-orders/[id]/request-delivery`, `/api/print-orders/[id]/files/[fileId]/signed-url` |

### 7.3 Design System (`app/globals.css`) & Shared UX Primitives
- **CSS Variables:**
  - Surface/Text/Accent: `--ps-bg`, `--ps-surface`, `--ps-surface-alt`, `--ps-border`, `--ps-text`, `--ps-text-muted`, `--ps-accent`, `--ps-accent-fg`, `--ps-accent-soft`, `--ps-ring` across 5 `[data-theme-preset]` palettes (`neutral`, `ocean`, `forest`, `slate`, `clay`) + `.dark`.
  - Dynamic HSL & Scale: `--ui-scale` (`16px`), `--color-primary` / `--color-primary-foreground` / `--color-secondary` / `--color-accent`, `--btn-primary-bg` / `--btn-primary-fg`, `--app-header-height`, `--header-visible-height`.
  - Z-Index Ladder: `--z-map: 10`, `--z-map-controls: 30`, `--z-explore-sheet: 35`, `--z-subnav: 40`, `--z-chrome: 50`, `--z-assistant: 55`, `--z-dropdown: 70`, `--z-drawer: 80`, `--z-modal: 85`, `--z-modal-top: 90`, `--z-select-confirm: 95`, `--z-toast: 100` (with `FormModal` at `z-[100]`, `ConfirmDialog` at `z-[120]`).
  - Orientation-Locked Nav: Portrait → `.nav-bottom-responsive`; Landscape `< 840px` → `.nav-vertical-responsive`; Landscape `>= 840px` → `.nav-top-responsive`.
- **8 Canonical Shared UX Primitives:**
  1. `components/ui/FormModal.tsx` — Portaled modal with Hints drawer, dirty-close `<ConfirmDialog />`, pre-submit confirmation, and `useFormModalValidation()` (`submitAttempted`).
  2. `components/ui/ConfirmDialog.tsx` — Portaled `info | warning | danger` confirmation dialog + `useConfirmDialogState()`.
  3. `components/ui/PhoneInput.tsx` (wrapping `PhoneInputWithCountry.tsx`) — `+91`-default E.164 input across 11 countries with `CustomSelectModal` country picker & `isValidCountryPhone`.
  4. `components/maps/MapCoordinatePicker.tsx` — Unified Google Maps `point` (6-decimal crosshair, GPS, locality snap, manual lat/lng) & `polygon` (`terra-draw` + `@turf/turf` geodesic area/Sangam/centroid sync) picker.
  5. `components/workspaces/shared/WorkspaceNavShell.tsx` — Mobile horizontal tab strips (`< 768px`), Tablet collapsed sticky rail (`768–1023px`), Desktop expanded sticky rail (`>= 1024px`), `min-h-[44px]`.
  6. `components/ui/SortablePreview.tsx` — Touch-safe `@dnd-kit` drag-and-drop (`PointerSensor` 6px, `TouchSensor` 180ms, `KeyboardSensor`) + mobile Up/Down buttons.
  7. `components/ui/AttributeHintsPopover.tsx` — 4-tab clickable chip reference (`Presets`, `Routes & Params`, `Verticals & Attrs`, `Categories`).
  8. `components/ui/IconPicker.tsx` — Curated searchable 102-icon Lucide picker backed by `lib/icons/registry.ts`.

---

## 8. Offline PWA, Privacy-Safe Telemetry, Env Security & Operations Contract

### 8.1 Offline PWA & Service Worker (`v20b`)
- **IndexedDB (`lib/offline/pwa-store.ts`, DB `ddoodle_offline_pwa_v1`):**
  1. `civic_emergency_cache`: Caches up to **120** `OfflineCivicRecord` helplines under `churachandpur_civic_v1` with IST `syncedAt`.
  2. `customer_active_otps`: Caches up to **20** active `pick_n_drop` / `vehicle_booking` customer OTPs (auto-prunes completed/cancelled/expired/refunded; purged on sign-out; never read by Driver/Mediator).
- **Service Worker (`public/sw.js`, `ddoodle-pwa-v3`):** Precaches 7 core shell/civic/profile routes; applies `CacheFirst` (30d, 100 entries) to Supabase public media & `/_next/static/*`, `NetworkFirst` to HTML navigations (offline fallback `/civic`, `/profile`, `/`), and strictly bypasses `/auth/callback` & `/api/*`.
- **UI (`components/shared/OfflineBanner.tsx`):** Registers `/sw.js`, surfaces offline helpline/OTP shortcuts, and handles Chromium install + iOS A2HS modal.

### 8.2 Privacy-Safe Telemetry (`v15f`)
- **Client (`lib/analytics/track.ts`):** Emits 10 allowlisted `AppAnalyticsEventType` events (`page_view`, `listing_click`, `shortcut_click`, `search_query`, `whatsapp_click`, `enquiry_submit`, `pnd_quote`, `booking_create`, `escrow_verified`, `bulletin_view`) via `navigator.sendBeacon('/api/telemetry/track', ...)`.
- **Server (`app/api/telemetry/track/route.ts`):** Enforces `4096 B` cap, strict event/device allowlists, regex email/phone PII redaction, server SHA-256 `session_hash`, server-verified JWT `user_id`, inserts via `service_role` into `app_analytics_events` (90d `pg_cron` retention), returns non-fatal HTTP `202`.

### 8.3 Environment Variables & Security Contract
- **Declared in `.env.example` (25 vars):** `GEMINI_API_KEY`, `APP_URL`, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `GOOGLE_MAPS_PLATFORM_KEY`, `GOOGLE_MAPS_SERVER_KEY`, `NEXT_PUBLIC_GOOGLE_MAPS_MAP_ID`, `NEXT_PUBLIC_GOOGLE_MAPS_LIGHT_MAP_ID`, `NEXT_PUBLIC_GOOGLE_MAPS_DARK_MAP_ID`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_SECRET_KEY`, `RESEND_API_KEY`, `RESEND_FROM_EMAIL`, `CRON_SECRET`, `PICK_N_DROP_PURGE_SECRET`, `PICK_N_DROP_UPI_ID`, `PICK_N_DROP_UPI_NAME`, `PLATFORM_UPI_ID`, `PLATFORM_UPI_PAYEE_NAME`, `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`, `NEXT_PUBLIC_ENABLE_DEMO_AUTH` (`"false"`), `SEED_SECRET`.
- **Additional Code-Referenced Vars:** `SUPER_ADMIN_EMAILS` (server-only in `lib/auth/super-admin.ts`; note `NEXT_PUBLIC_SUPER_ADMIN_EMAILS` does **not** exist), `NEXT_PUBLIC_DEV_TEST_PASSWORD`, `NEXT_PUBLIC_SITE_URL`, `PRINT_PURGE_SECRET`, `SUPABASE_URL`, `GOOGLE_MAPS_API_KEY`, `VITE_GOOGLE_MAPS_API_KEY`, `GOOGLE_MAPS_MAP_ID`, `TWILIO_ACCOUNT_SID`/`TWILIO_AUTH_TOKEN`/`TWILIO_FROM_NUMBER` (Deno Edge Function).
- **`lib/env.ts` Guard:** Non-fatal build audit (`auditPublicEnv()`/`enforceBuildEnv()`) logs a `console.warn` on missing public keys; `isDemoAuthEnabled()` strictly checks `NEXT_PUBLIC_ENABLE_DEMO_AUTH.trim() === 'true'`; `sanitizeRelativeNextPath()` blocks open redirects.

### 8.4 Production Deployment Checklist (Consolidated & Reconciled from `DEPLOYMENT_CHECKLIST.md`)
1. **Vercel Domain & Env Vars:** Set `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (+ light/dark Map IDs), `APP_URL` / `NEXT_PUBLIC_SITE_URL`, `RAZORPAY_*`, `RESEND_*`, `CRON_SECRET`, `PICK_N_DROP_PURGE_SECRET`, `PRINT_PURGE_SECRET`, and enforce **`NEXT_PUBLIC_ENABLE_DEMO_AUTH=false`**.
2. **Google Cloud Console:** Restrict browser key HTTP referrers strictly to production domain + `localhost:3000` (`Maps JavaScript API`, `Places API`, `Directions API`, `Geolocation API`); restrict `GOOGLE_MAPS_SERVER_KEY` by server IP/API; configure billing alerts.
3. **Supabase Auth, SQL & Storage:**
   - Configure **Authentication → URL Configuration** Site URL & PKCE Redirect URL (`https://<domain>/auth/callback` + `https://<domain>/**`); enable Google OAuth provider.
   - Apply all **61** SQL migrations in `supabase/migrations/` in chronological order (`00001` → `v20b`) — paying attention to known alphabetical filename hazards documented in `docs/CHANGELOG.md`.
   - Confirm RLS enabled on all 88 tables, `pg_cron` enabled for `ddoodle_purge_expired_delivery_pods_48h` (`0 */6 * * *`) & `90d` analytics purge, and external scheduler / `vercel.json` cron hitting `/api/pick-n-drop/purge-pods`, `/api/print-orders/purge-expired`, and `/api/system/purge-media`.
   - Confirm buckets `delivery-pods` (5 MB private), `print-documents` (25 MB private), `kyc-documents` (10 MB private), `avatars` (2 MB public), and `media`.
4. **Pre-Launch Checks:** `npx tsc --noEmit`, `npx eslint .`, `npm run build`, `node --test lib/rules.test.ts`, and verify OpenGraph social sharing cards.

### 8.5 Supabase Automated Verification Webhook (`notify-owner`, Preserved from `WEBHOOK_SETUP.md`)
`supabase/functions/notify-owner/index.ts` sends automated SMS/WhatsApp notifications when `public.listings.status` transitions to `'published'` or `'rejected'`:
1. **Deploy Edge Function:** `supabase functions deploy notify-owner`
2. **Set Secrets (runs in `twilio-mock` preview mode if unset):**
   `supabase secrets set TWILIO_ACCOUNT_SID="..." TWILIO_AUTH_TOKEN="..." TWILIO_FROM_NUMBER="whatsapp:+14155238886"`
3. **Configure Supabase Database Webhook:** **Database → Webhooks → Create new hook** (`notify_owner_on_listing_moderation`) on `public.listings` (`UPDATE` events only) → Edge Function `notify-owner` (`POST`) with headers `Content-Type: application/json` and `Authorization: Bearer <YOUR_SUPABASE_SERVICE_ROLE_KEY>`. Transitions outside `'published'` / `'rejected'` safely return `{ skipped: true }`.

### 8.6 Preserved Legacy Identifiers, Storage Keys & CustomEvents (Do Not Rename)
- **DB Legacy Identifiers:** `listing_print_profiles.is_first_party_printswift`, `listing_print_profiles.is_official_printswift`, `is_official_printswift_listing(uuid)`, `guard_official_printswift_listings_mutation()`, `print_order_events` role `'printswift_operator'`.
- **`localStorage` / `sessionStorage` Keys:** `printswift_local_auth_session_v1`, `printswift_local_demo_state_v1`, `printswift_local_drawn_shapes_v1`, `printswift_local_theme_v1`, `printswift_local_map_style_v1`, `printswift_local_map_cloud_config_v1`, `printswift_local_split_pct_v1`, `printswift_local_custom_default_center_v1`, `printswift_local_simple_mode_v1`, `printswift_local_real_estate_mode_v1`, `printswift_local_app_settings_v1`, `printswift_platform_settings_v1`, `printswift_ota_translations_v1`, `printswift_local_locale_v1`, `printswift_unified_settings_v1`, `printswift_local_map_settings_prompt_dismissed_v1`, `printswift_active_hub_slug_v1`, `printswift_saved_interests_v1`, `printswift_dismissed_announcements_v1`, `printswift_banner_imp_` (prefix), `printswift-local-otp-secret` (fallback constant), `dd_listing_draft_*`, `ddoodle_ios_install_dismissed_v1`, `ddoodle_telemetry_sid_v1`, `dd_view_as_role`, `view_as_role`, `psl_view_as_role`, `psl_preview_hub_slug`.
- **DOM CustomEvents:** `printswift:map-settings-updated`, `printswift:app-settings-updated`, `printswift:platform-settings-updated`, `printswift:profile-updated`, `printswift:locale-changed`, `printswift:notifications-updated`, `printswift:translations-updated`, `printswift:reset-demo-data`, `printswift:focus-map-listing`, `printswift:unmount-overlays`, `printswift:pnd-orders-updated`, `printswift:app-config-updated`, `printswift:hub-switched`, `printswift:open-workspace-enquiries`.

---

## 9. v21a Security Baseline (Batch 1 P0 Closure)

> Source: `supabase/migrations/20261126_pass_v21a_p0_security_rls_and_schema_fixes.sql` (280 idempotent statements, wrapped in one transaction; verified by replaying all 62 migrations on Postgres 17 + PostGIS (PGlite), re-running v21a twice with 0 failures, and 38 role-impersonated behavioural checks). Functions marked "[v21a] Re-issued" are byte-for-byte copies of the latest live definition with explicitly commented patches.

### 9.1 Data Exposure Rules
- **`profiles`:** no anonymous reads; authenticated reads are row-scoped (own row, `is_pnd_admin`, `is_pnd_mediator`, owner → delegated staff via `_v21a_owner_can_view_staff_profile`). Public bylines/search use **`public_profiles`**. `app/user/[id]` never renders email/phone; `/vehicles/[id]` shows the vehicle's `contact_phone`/`operator_phone`, never the owner's private profile phone.
- **`subscription_plans`:** column `target_user_ids` is not selectable by `anon`/`authenticated` (column-level grants; `select('*')` is denied). Clients use **`get_visible_subscription_plans()`** (visible plans + `is_targeted_for_me`, never the array) and Superadmin screens use **`superadmin_list_subscription_plans()`**. Targeting checks inside RLS use `_v21a_plan_targets_user(plan_id, user_id)`. *(New columns added to `subscription_plans` later must be granted explicitly.)*
- **Vertical order OTPs:** `*_otp_display_for_customer` columns on `print_orders`/`shop_orders`/`restaurant_orders`/`resource_bookings` are always blanked by `vault_vertical_order_customer_otp_v21a`; the plaintext lives in `vertical_order_customer_otps` (customer-only RLS; `get_my_vertical_order_otp`, `get_my_print_collection_otp`). API create routes return the OTP in their response body; `ActivityPanel` hydrates from the vault.
- **Real estate contact:** `/listing/[id]` strips owner phone/email from the server payload unless `contact_reveal_policy = 'direct_call'` or the viewer's visit is `accepted` + `contact_revealed`.
- **`media_assets`:** the `00017` public `USING (true)` read policy is dropped.

### 9.2 Write-Path Locks
- Customers can no longer `INSERT` vertical orders/requests directly (`print_orders`, `shop_orders`, `restaurant_orders`, `restaurant_table_reservations`, `property_visit_requests`); `resource_bookings` inserts are operator-only; `pay_per_orders` inserts only via `submit_pay_per_order`. All creation goes through service-role API routes/RPCs.
- Customer `UPDATE` on `print_orders` cannot touch money/settlement/identity columns (`guard_vertical_order_customer_writes_v21a`); requesters may only cancel reservations/site visits (`guard_requester_cancel_only_v21a`).
- Delegated staff: listing `UPDATE` needs `can_edit_details`/`can_manage_media`; enquiries need `can_reply_enquiries` or the `enquiries` scope; catalogue inserts need `can_manage_catalogue` (stock/price updates also via `kitchen_shop_stock`); `listing_media` needs `can_manage_media`; review replies need `can_reply_reviews` (reply-only trigger). Staff cannot change `payment_mode`, `listing_vertical`, `root_key`, `hub_id`, verification flags, or any vertical `payment_policy` (shop UPI). Vertical operator helpers require the matching scope (`print_queue`, `booking_checkin`, `kitchen_shop_stock`, `property_visits`) and a live parent listing.
- Reviews require auth (`user_id DEFAULT auth.uid()`), no forged owner replies, no self-reviews; `featured_requests` inserts must be `submitted` with no reviewer fields (withdraw via `withdraw_featured_request`).
- `bind_media_assets` binds only the caller's own uploads to entities the caller may manage (`_v21a_can_manage_media_entity`).
- `create_vehicle_booking_with_intent` ignores the client fare: it recomputes from the vehicle's rates using `p_pricing_key` (`route:N`, `rate:hourly|daily|per_km`) and `p_estimated_km` (5–2000), and stamps `hub_id` on the booking and payment intent. The old 9-arg overload was dropped.

### 9.3 New RPCs (v21a)
`get_driver_active_orders()`, `get_visible_subscription_plans()`, `superadmin_list_subscription_plans()`, `get_my_vertical_order_otp(text, uuid)`, `emit_notification(uuid, text, text, text, text, jsonb, uuid)` (self, or admin/mediator → others; in-app relative `action_url` only), `withdraw_featured_request(uuid, text)`, `customer_request_cancellation(uuid, text)` (unpaid → cancel; UPI proof still unverified (`payment_submitted` / `pending_payment_confirm`) → status kept, cancellation note + `refund_requested` flagged in the mediator verification queue, duplicate requests blocked; funded → `disputed` refund request for the mediator), `get_pnd_dispatch_sla_breaches(integer DEFAULT 15)` (hub-scoped >15-minute unclaimed funded jobs), `lookup_user_for_delegation(text)` and `get_vehicle_booking_contacts(uuid[])` (v21a-r2: narrow owner lookups that replace direct reads of the row-scoped `profiles` table), plus helpers `staff_has_listing_grant`, `_staff_*`, `_v21a_*`.

### 9.4 Repaired / Re-issued Functions
`get_driver_available_jobs` (PostGIS lat/lng + `instructions`), `driver_update_trip_status` (unpaid release → `awaiting_payment`), `verify_delivery_otp` (assigned driver only), `mediator_verify_upi_payment` / `mediator_dispatch_driver` / `mediator_resolve_escrow_payout` (hub scope + escrow guards: refund/release require a verified payment — `payment_verified_at`, funded escrow status or succeeded intent — and release requires an assigned driver; vehicle refunds require verified or held escrow), `get_effective_entitlements` (resolves listing owner, lifetime subs, category scope), `has_active_{print,booking,commerce}_entitlement` + `has_active_real_estate_pro` (composable, owner-resolved, legacy `plan_scope` honoured), `review_pay_per_order` (exactly-once), `get_owner_workspace_summary` (real quota keys), `get_user_operational_hats` (IDOR guard), `superadmin_set_user_role` (`mediator`), `write_audit_log` (fills `actor_name`/`workspace`/`details`/`target_name`), `audit_partner_application_review`, `audit_listings_featured_v15c`, `guard_immutable_superadmin`, `enforce_profile_role_governance`, `guard_profile_sensitive_columns_v20b`, `guard_payment_intent_user_update` (trusted RPC context), `apply_bulletin_auto_verify_v17b` (never publishes unpaid drafts), `handle_new_enquiry_notification`, `purge_expired_delivery_pods`, `bind_media_assets`, `create_vehicle_booking_with_intent`, `is_{print,booking,commerce,real_estate}_operator_for`, `guard_staff_listing_mutations_v18a`. All public functions that call pgcrypto/PostGIS now pin `search_path` including `extensions` (fixes `verify_commerce_pickup_otp`, `generate_6digit_otp`).

### 9.5 Grants
`upsert_email_otp`, `verify_email_otp`, `create_atomic_resource_booking`, `cleanup_temporary_media_assets`, and internal `_v21a_*`/`_staff_*` helpers are `service_role`-only (helpers called from definer code). `staff_has_listing_grant`, `_v21a_is_hardcoded_super_admin_user`, `_v21a_owner_can_view_staff_profile` stay executable by `authenticated` (RLS/invoker triggers); `_v21a_plan_targets_user` by `anon`+`authenticated` (plan RLS).

### 9.6 Constraints & Indexes
`bulletins_status_check` adds `pending_payment`, `draft`, `pending_review`; `featured_requests` adds `expired`, `withdrawn`; unique `idx_bulletin_post_passes_active_utr_unique_v21a` on `upper(trim(upi_utr_ref))` for `pending_verification`/`available`/`used`; `notifications.type` defaults to `'system'` and `recipient_role` is nullable.

### 9.7 Known Follow-ups (Not in v21a)
- A full **fresh replay** of the historical chain still fails in older files unrelated to v21a/v21b (e.g., `00014_mega_seed` vs `reviews.author_name`, duplicate `profiles_role_check` adds in `phase61a`/`phase66a`, `phase72a` syntax at line 927, `r1b` seed ordering). v21a fixes the two replay hazards named in P0-21 (`00011`, `pass_r1a`) and both v21a/v21b are idempotent; a squashed baseline is recommended for new environments.
- `package-lock.json` was regenerated and synced in `v21b` (`npm install --package-lock-only` / `npm install`) so `npm ci` works cleanly.

---

## 10. v21b Role Solidification & Hub Manager Decoupling (Batch 2 P1 Closure)

> Source: `supabase/migrations/20261127_pass_v21b_p1_role_solidification_and_hub_manager.sql` (idempotent transaction-wrapped migration closing `P1-01..P1-20`).

### 10.1 Super-Admin & Hub Manager Decoupling
- **DB/Server-Authoritative Super-Admin (`v21b`):** Personal email addresses were removed from client-bundled TypeScript (`lib/auth/super-admin.ts`, `lib/auth/dev-test-accounts.ts`, `lib/validators.ts`, `lib/role-override.ts`, `lib/auth.ts`, `Header.tsx`, `app/profile/page.tsx`, `RoleToggleModal.tsx`). Super-Admin privilege is verified against `profiles.role === 'super_admin' || profiles.is_super_admin === true`, with optional server-only `process.env.SUPER_ADMIN_EMAILS` cross-check in `lib/auth-server.ts` / API routes.
- **Hub Manager Scoping (`P1-08`):** Added hub-scoped triage RPCs and RLS decoupling in `HubManagerWorkspace.tsx` & SQL (`hub_triage_suggested_category`, `hub_manager_verify_vehicle_listing`, `hub_manager_moderate_bulletin`, `escalated_disputes`), allowing Hub Managers to moderate local listings, suggested leaf categories, bulletins, vehicle stands, driver KYC, and escalated disputes strictly within their assigned `hub_id` (`audit_logs.workspace = 'hub_manager'`).

### 10.2 Media Compression, UTR Guard & Form Compliance (`P1-01..P1-20`)
- **Universal WebP Media Pipeline (`P1-04`):** Added `lib/media/image-compressor.ts` alongside `lib/media/pod-compressor.ts` so every client image upload (avatars `<= 150 KB`, PODs `<= 250 KB`, listing galleries / marketplace products / bulletin flyers `<= 350 KB`, 360° panoramas high-res bounded WebP) compresses before hitting `/api/media/upload`.
- **Canonical UTR Normalization & Replay Guard:** Added `lib/payments/utr.ts` (`normalizeUpiUtr`, `isValidUpiUtr`) across `OrderTrackerModal.tsx`, `UniversalPaymentModal.tsx`, `PayPerCheckoutModal.tsx`, and `/api/payments/submit-utr` alongside DB partial unique replay indexes.
- **Listing Verticals, Real Estate, Fleet & Bookings:**
  - `listings.service_details` & `listingVerticalProfiles.ts` partial-update guards (`P1-01`); `listing_real_estate_profiles` explicit `area_unit` (`sangam` / `sqft` / `sqm` / `acre`), `area_value`, and normalized `boundary_geojson` (`P1-02`); strict owner vs staff field locks inside `ListingEditorModal.tsx` (`P1-03`).
  - Driver `<FormModal />` + `<ConfirmDialog />` refactor (`P1-05`), `partner_applications.license_no` + 5-tier Churachandpur fleet activation (`P1-06`, `P1-07`: `Scooty`, `Cycle Rickshaw`, `E-Rickshaw`, `Mini Van`, `Pickup Truck` without Aizawl re-injection), and `preserve_upi_verified_v21b` / `guard_bulletin_youtube_entitlement_v21b` triggers (`P1-14`, `P1-15`).
  - Enquiry reply persistence via `reply_to_enquiry` + review flagging via `flag_listing_review` (`P1-12`), IST `reservedFor` formatting + E.164 phone checks (`P1-17`), `effectiveHandoverMode` / `'both'` `booking_mode` / owner-scoped enquiries & `trialing` subscriptions (`P1-18`), and `?hub=` query-param preservation (`P1-11`).

---

## 11. v22a Unified Notifications & Activity Engine (Batch 3 P2-01 Closure)

> Source: `supabase/migrations/20261127_pass_v22a_notifications_and_activity_engine.sql` (idempotent transaction-wrapped migration closing `P2-01` and `v21a` Decision #6).

### 11.1 Schema & Per-Category Mute Preferences
- **`public.notifications` Enrichment:** Added `category` (`'orders_bookings' | 'logistics_escrow' | 'enquiries_reviews' | 'moderation_kyc' | 'billing_trials' | 'team_staff' | 'system'`), `priority` (`'low' | 'normal' | 'high' | 'urgent'`), and `role_scope` (`'visitor' | 'owner' | 'staff' | 'driver' | 'mediator' | 'hub_manager' | 'advertiser' | 'super_admin'`) with CHECK constraints, composite index `idx_notifications_user_unread_category_created (user_id, is_read, category, created_at DESC)`, and `trg_v22a_sync_notification_row` preventing client tampering with ownership or content on `UPDATE`.
- **`public.profiles.notification_preferences`:** JSONB object (`push_enabled`, `email_enabled`, `orders_bookings`, `logistics_escrow`, `enquiries_reviews`, `moderation_kyc`, `billing_trials`, `team_staff`) synced directly with `/settings#notifications`.
- **Strict RLS & Realtime Publication:** `public.notifications` allows only `SELECT` and `UPDATE` where `user_id = auth.uid()` (zero client `INSERT` policy — only DB triggers and `SECURITY DEFINER` RPCs emit notifications). Both `public.notifications` and `public.property_visit_requests` are registered in `supabase_realtime`.

### 11.2 Unified Dispatcher, Triggers & Activity Feed RPCs
- **`_dispatch_notification_v22a(...)` & `emit_notification(...)`:** Internal `SECURITY DEFINER` dispatcher checks `profiles.notification_preferences` (skipping muted non-urgent categories while **always** delivering `'urgent'` safety, escrow, handover OTP, and SLA alerts), enforces relative in-app `action_url` (`^/` and not `^//`), and inserts into `public.notifications`. `emit_notification` delegates to `_dispatch_notification_v22a` while maintaining backward compatibility with 7-arg and 10-arg callers.
- **`mark_notifications_read(p_notification_ids uuid[] DEFAULT NULL, p_category text DEFAULT NULL)`:** `SECURITY DEFINER` RPC (`GRANT EXECUTE TO authenticated`) marking single, batch, or category-filtered notifications read for `auth.uid()`.
- **5 Core Role Handoff Trigger Groups (`AFTER INSERT OR UPDATE`):**
  1. *Orders, Bookings & Print:* `shop_orders`, `restaurant_orders`, `resource_bookings`, `print_orders` (`trg_fn_v22a_orders_and_bookings`).
  2. *Enquiries, Reviews & Property Visits:* `enquiries`, `reviews`, `property_visit_requests` (`trg_fn_v22a_enquiries_reviews_visits`, emitting instant `'Site Visit Approved — Owner Contact Unlocked!'` alert + Realtime refresh closing `v21a` Decision #6).
  3. *Pick N Drop & Vehicle Escrow:* `delivery_orders`, `vehicle_bookings` (`trg_fn_v22a_logistics_and_escrow`).
  4. *Moderation, Partner KYC & Suggested Leaves:* `listings`, `bulletins`, `partner_applications`, `categories` (`trg_fn_v22a_moderation_and_kyc`).
  5. *Billing, Pay-Per & Staff Delegation:* `pay_per_orders`, `user_subscriptions`, `staff_delegations` (`trg_fn_v22a_billing_and_team`).
- **`get_my_activity_feed(p_limit int DEFAULT 30, p_workspace text DEFAULT NULL)`:** `SECURITY DEFINER` RPC merging the caller's `public.activity_logs` and caller-authored `public.audit_logs` (using the exact 13-column `audit_logs` contract) in reverse chronological order without leaking other users' records.

### 11.3 Frontend Bell Inbox, Realtime Contact Reveal & Settings Wiring
- **`NotificationBell.tsx` + `NotificationInboxDrawer.tsx` (mounted in `Header.tsx`):** 44px+ touch target Bell trigger with live unread count pill subscribed via Supabase Realtime (`INSERT` & `UPDATE` on `notifications:user_id=eq.<uid>`), category filter chips (`All`, `Orders`, `Logistics & Escrow`, `Enquiries`, `Moderation`, `Billing`, `Team`), `Unread` toggle, `.dd-shimmer` skeleton loader, pulsing `'urgent'` priority indicator, relative IST timestamp (`Asia/Kolkata`), 1-tap deep-link navigation (auto-marking read), and category-aware **"Mark all read"**.
- **Live Real Estate Visit Contact Unlock (`RealEstateDetailClient.tsx` & `ActivityPanel.tsx`):** Subscribes via `useRealtimeTableRefresh('property_visit_requests', ...)` so owner acceptance immediately unlocks the `"Call Owner"` button without manual page reload.

---

## 12. v22b Public Pages Reflection, Routing, Back-Button & WhatsApp OpenGraph Cards (Batch 4 P2 Closure)

> Closes `P2-02`, `P2-03`, `P2-04`, `P2-08`, `P2-09`, `P2-10`, and `P2-12` in [`docs/AUDIT_FORMS_AND_ROLES.md`](AUDIT_FORMS_AND_ROLES.md).

### 12.1 LIFO Android Back-Button (`popstate`) & Body Scroll-Lock (`P2-03`)
- **`hooks/useModalLock.ts`:** Implements a centralized LIFO `modalBackStack` that pushes `{ __ddModalId: id }` onto `window.history.state` when any modal/drawer opens and intercepts browser/Android hardware `popstate` events to close the top-most active overlay instead of navigating away from the current page. When closed programmatically (X button, backdrop click, or Escape key), it pops the synthetic history entry cleanly via `window.history.back()`.
- **Universal Overlay Coverage:** Wired across `FormModal`, `ConfirmDialog`, `CustomSelectModal`, `AuthModal`, `ShareSheetModal`, `UniversalPaymentModal`, `GetFeaturedModal`, `OrderTrackerModal`, `CivicSummaryModal`, `NotificationInboxDrawer`, `Header` hamburger drawer, `UniversalAppSearch` mobile overlay, and the `/bulletin` detail modal.

### 12.2 Homepage Routing, Hamburger Drawer Hats & Public Deep-Link Parity (`P2-08`, `P2-09`, `P2-12`)
- **Zero Map Chrome on `/`:** `Header.tsx` mounts `#unified-header-discovery-slot` strictly when `isExploreUnifiedControlsVisible` (`pathname === '/explore'`), keeping the `/` landing DOM completely free of map controls or hidden discovery slots.
- **Canonical Deep Links & Onboarding CTAs:**
  - `List Your Business` routes directly to `/onboarding?track=business`; `Apply as Advertiser` routes guests to `/login?next=%2Fonboarding%3Ftrack%3Dadvertiser` (or `/workspace?hat=advertiser` for active advertisers).
  - Landing Featured Places cards link directly to `/listing/[id]`, Marketplace product cards link to `/listing/[listingId]` (with `/marketplace?hub=...&q=...` fallback), and Bulletin cards + `UniversalAppSearch` results link to `/bulletin?hub=...&post=[id]` (auto-opening the detail modal on `/bulletin` via `?post=` query param hydration).
  - `Header.tsx` mobile drawer includes `Advertiser Desk` (`/workspace?hat=advertiser`), `Dispatch Mediator Desk` (`/workspace?hat=mediator`), and `Apply as Bulletin Advertiser` (`/onboarding?track=advertiser`) with strict `min-h-[44px]` / `h-11 w-11` touch targets, and Landing footer navigation includes `/bookings`, `/vehicles`, `/pick-n-drop`, and `/civic`.
  - Removed redundant `<AppProvider>` wrappers from `app/profile/page.tsx`, `app/profile/edit/page.tsx`, and `app/settings/page.tsx`.

### 12.3 Public Soft-Expiry (`paid_until` & `expires_at`) & Dynamic WhatsApp OpenGraph Share Cards (`P2-02`, `P2-04`)
- **Soft-Expiry & Lifecycle Filtering (`P2-04`):** Enforced `paid_until IS NULL OR paid_until > now()`, `expires_at`, and `lifecycle_status = 'active'` across `app/page.tsx`, `LandingClient.tsx`, `lib/supabase/listings.ts` (`fetchPublishedListings`), `app/marketplace/page.tsx` (products, restaurant dishes & print shops), `UnifiedBookingsHub.tsx`, `VehiclesDirectoryClient.tsx`, `app/vehicles/[id]/page.tsx`, `UniversalAppSearch.tsx`, and `app/sitemap.ts` (including `/explore`, `/marketplace`, `/bookings`, `/vehicles`, `/bulletin`, `/civic`, and active `vehicle_listings`).
- **WhatsApp & Social OpenGraph Cards (`P2-02`):** Configured `metadataBase` and `/icons/icon-512x512.png` OpenGraph/Twitter card defaults in `app/layout.tsx`, guaranteed brand image fallback on `app/listing/[id]/page.tsx`, added dynamic `generateMetadata` on `app/vehicles/[id]/page.tsx` (vehicle title, fare summary, stand locality, and primary image), and exported server-side `openGraph` + `twitter` (`summary_large_image`) metadata across `/`, `/explore`, `/vehicles`, `/civic`, `/bookings`, `/marketplace`, `/bulletin`, `/about`, and `/contact`.

---

## 13. v23a All-Role Interactive Guides, Contextual Workspace Help (`?`) & Assistant Knowledge Sync (Batch 5 P2-14 Closure)

> Closes `P2-14` in [`docs/AUDIT_FORMS_AND_ROLES.md`](AUDIT_FORMS_AND_ROLES.md).

### 13.1 Single Canonical 8-Role Guide Registry (`lib/guides/role-guides.ts`)
- **Zero-Import Public Isolation:** `lib/guides/role-guides.ts` is a pure-data TypeScript module with **zero** imports from `components/workspaces/**` or `components/admin/**` so public routes (`/guides`, `AssistantWidget`) stay completely decoupled from workspace bundles.
- **Complete 8-Role Coverage:** Documents real, verified DD oodle workflows (`quickChecklist`, `workflows[]`, `rulesAndSafety[]`, `faqs[]`) for:
  1. `visitor` — Visitor & Customer (`/explore`, `/marketplace`, `/bookings`, `/vehicles`, `/bulletin`, `/civic`, offline active OTPs & post-UPI cancel/refund flow).
  2. `owner` — Business Owner (`/workspace?hat=owner`, 4-step `<ListingEditorModal />`, Sangam/Sq.Ft/Sq.M/Acre Real Estate polygons & Realtime site-visit contact reveal, L3 leaf suggestions, Default Free Tier + one-time trial + Pay-Per + Pro subscriptions, `@username` staff delegation).
  3. `staff` — Delegated Staff (`/workspace?hat=staff`, strictly scoped to owner-granted `permissions` and `vertical_scopes` across live orders, print jobs, room/venue check-ins, enquiries, and property visits; blocked from billing/UPI/ownership changes).
  4. `driver` — Pick N Drop & Fleet Driver (`/workspace?hat=driver`, online toggle, `driver_accept_job`, zero-secret `driver_verify_handover_otp` with 5-attempt lockout, `<= 250 KB` WebP POD upload to private 48h `delivery-pods`, and vehicle charter management).
  5. `mediator` — Dispatch Mediator (`/workspace?hat=mediator`, UTR verification against active replay indexes, driver assignment & >15m SLA breach monitoring, zero-secret milestone view, and `mediator_resolve_escrow_payout` release/refund/freeze).
  6. `hub_manager` — Hub Manager (`/workspace?hat=hub_manager`, hub-scoped via `is_hub_manager_for(hub_id)` & `hub_managers.profile_id` across partner KYC review with 120s signed URLs, listing/vehicle/bulletin moderation, suggested leaf triage via `hub_triage_suggested_category`, featured slots, Official PrintSwift counter, and `escalated_disputes`).
  7. `advertiser` — Advertiser & Seller (`/workspace?hat=advertiser`, bulletin flyers, marketplace items, Homepage/Explore featured requests via `GetFeaturedModal` & `withdraw_featured_request`, and `paid_until` soft-expiry renewals).
  8. `super_admin` — Super-Admin (`/admin` & `/workspace?hat=master_control`, dual-locked `is_super_admin()`, Homepage Container Studio, 11-root L1/L2/L3 Category Taxonomy & canonical leaf merges, Subscription Plans & Pay-Per Studio, Payment Feature Policies, Multi-Hub & Fleet Rate Matrix, Role Promotions via `superadmin_set_user_role`, and immutable 13-column `audit_logs`).

### 13.2 Interactive Public Role Guides Hub (`app/guides/page.tsx` + `app/guides/layout.tsx`)
- **Deep-Linkable & Role-Aware:** Supports `?role=<role_id>` and `?q=<search>`, defaulting to the signed-in user's active role (or `visitor` for guests) with a `"Your Role"` highlight badge on the horizontal 44px+ Role Switcher Strip.
- **Interactive Checklists & Expandable Workflows:** Persists per-role Quick-Start Checklist completion in `localStorage` (`ddoodle_role_guide_checklist_v23a`, showing `"X of Y completed"` progress + 1-tap Reset), renders expandable step-by-step workflow cards with numbered flow badges (`Step 1 -> Step 2 -> ...`) and 44px+ deep-link CTAs, highlights security/escrow guardrails, and provides instant search across either the active role or all 8 roles.
- **SSR OpenGraph & Entry Links:** Exported server-rendered OpenGraph & Twitter share card metadata in `app/guides/layout.tsx` and wired `/guides` links into `Header.tsx` drawer, `LandingClient.tsx` footer, `app/onboarding/page.tsx`, `app/profile/page.tsx`, `app/about/page.tsx`, and `app/sitemap.ts`.

### 13.3 Contextual In-Workspace Help Drawer & Assistant Sync (`components/guides/WorkspaceHelpDrawer.tsx`, `AssistantWidget.tsx`)
- **`<WorkspaceHelpDrawer />` & `<WorkspaceHelpButton />`:** Mounted in `WorkspaceNavShell.tsx`, `SuperadminNavShell.tsx`, and `WorkspaceHatShell.tsx`. Clicking the 44px+ `Role Guide` (`?`) button opens a themed slide-over drawer wired with `useModalLock(isOpen, onClose)` (supporting Escape key, body scroll lock, and Android hardware Back-button dismissal) displaying the active workspace hat's interactive checklist, top workflows, escrow/security rules, FAQs, and a direct link to `/guides?role=<active_hat>`.
- **Assistant & Tutorial Sync:** `components/shared/AssistantWidget.tsx` pulls role-aware quick-prompt chips, workflows, and FAQs directly from `lib/guides/role-guides.ts` (replacing outdated prototype copy), and `lib/tutorials/tutorial-registry.ts` aligns its `'workspace'` tour steps with the 8-role Hat Switcher and contextual `Role Guide` (`?`) drawer trigger.

---

## 14. v23b Strict Workspace Route/Bundle Isolation, Public Bundle Purity, DB Indexes & Dead-Code Cleanup (Batch 6 Final P2 Closure)

> Closes `P2-05`, `P2-06`, `P2-07`, `P2-11`, and `P2-13` in [`docs/AUDIT_FORMS_AND_ROLES.md`](AUDIT_FORMS_AND_ROLES.md), completing **62/62** audit items (`28/28 P0`, `20/20 P1`, `14/14 P2`).

### 14.1 Physical `/workspace/<hat>` & `/admin` Route Splitting & Server-Side Role Guards (`P2-05`)
- **Eliminated Monolithic `WorkspaceHatShell.tsx`:** Removed `components/workspaces/WorkspaceHatShell.tsx` and split every role workspace into its own isolated App Router route segment:
  - `/workspace/owner` (`app/workspace/owner/page.tsx` → `OwnerWorkspaceRouteClient.tsx` → `dynamic(() => import('@/components/workspaces/OwnerStaffWorkspace'))`)
  - `/workspace/staff` (`app/workspace/staff/page.tsx` → `StaffWorkspaceRouteClient.tsx` → `dynamic(() => import('@/components/workspaces/StaffWorkspace'))`)
  - `/workspace/driver` (`app/workspace/driver/page.tsx` → `DriverWorkspaceRouteClient.tsx` → `dynamic(() => import('@/components/workspaces/driver/DriverWorkspace'))`)
  - `/workspace/mediator` (`app/workspace/mediator/page.tsx` → `MediatorWorkspaceRouteClient.tsx` → `dynamic(() => import('@/components/workspaces/mediator/MediatorWorkspace'))`)
  - `/workspace/hub` (`app/workspace/hub/page.tsx` → `HubWorkspaceRouteClient.tsx` → `dynamic(() => import('@/components/workspaces/HubManagerWorkspace'))`)
  - `/workspace/advertiser` (`app/workspace/advertiser/page.tsx` → `AdvertiserWorkspaceRouteClient.tsx` → `dynamic(() => import('@/components/workspaces/advertiser/AdvertiserWorkspace'))`)
  - `/admin` (`app/admin/page.tsx` → `AdminWorkspaceRouteClient.tsx` → `dynamic(() => import('@/components/workspaces/AdminWorkspace'))`)
- **Edge & Server Role Guards (`middleware.ts` & `lib/auth/workspace-guard.ts`):**
  - `middleware.ts` protects `/admin/:path*` and `/workspace/:path*`, redirecting unauthenticated visitors without a Supabase session cookie (`sb-access-token` synced by `lib/auth.ts` or `@supabase/ssr` `sb-*-auth-token`) to `/login?next=<encoded_path>`.
  - `requireWorkspaceAccess(allowedHats, nextPath)` resolves the authenticated user on the server via `get_user_operational_hats` + `isVerifiedSuperAdmin()`, redirecting unauthenticated requests to `/login?next=...` and unauthorized hats to `/workspace?denied=<hat>`.
- **Zero-Workspace-Import `/workspace` Dispatcher & `<WorkspaceRouteHeaderBar />`:**
  - `app/workspace/page.tsx` is a pure Server Component with **zero** imports from `components/workspaces/**` or `components/admin/**`. Legacy `?hat=<hat>` query links redirect server-side (`?hat=owner` → `/workspace/owner`, `?hat=hub_manager` → `/workspace/hub`, `?hat=super_admin|admin|master_control` → `/admin`), while visiting `/workspace` renders the lightweight Workspace Hat Launcher.
  - `components/workspaces/shared/WorkspaceRouteHeaderBar.tsx` renders 44px+ Next.js `<Link>` tabs across the caller's authorized hats so switching hats performs a clean App Router route transition that unmounts the previous workspace and tears down its Realtime channels and intervals.

### 14.2 Public Visitor Bundle Purity & Sub-Tab Dynamic Chunking (`P2-05`, `P2-06`, `P2-07`)
- **Public Route Isolation:**
  - `components/AppShell.tsx` loads `DiscoveryWorkspace` and `CategoryDetailView` via `next/dynamic(..., { ssr: false })` strictly on `/explore`, and prunes ~450 lines of dead legacy internal SPA views (`saved`, `activity`, `workspace`, `profile` 12-role demo switcher, and reset modal).
  - `app/bulletin/page.tsx` loads `BulletinComposerModal` via `next/dynamic(..., { ssr: false })` only when `isComposerOpen` is true (keeping `MapCoordinatePicker` & `terra-draw` out of initial `/bulletin` visitor loads).
  - `components/home/LandingClient.tsx` loads `GetFeaturedModal` via `next/dynamic(..., { ssr: false })` only when `featuredModalOpen` is true.
- **Intra-Workspace Dynamic Chunking & Deduplication (`P2-05`, `P2-06`):**
  - `MasterControlConsole.tsx` (16 sub-tabs), `AdminWorkspace.tsx` (13 sub-tabs), `HubManagerWorkspace.tsx` (8 governance panels), and `OwnerStaffWorkspace.tsx` (10 vertical managers + `ListingEditorModal`) load all sub-tab modules via `next/dynamic(..., { ssr: false })` with `.dd-shimmer` skeletal loaders.
  - `AdminWorkspace.tsx` consolidates `users_roles` onto the single live Supabase Role & Team Manager (`MasterControlConsole controlledSubTab="users_drivers_managers"`), `subscription_plans` onto `SubscriptionPlansBuilder`, and `categories_icons` onto the 3-level `CategoryBuilder`, eliminating all dead Zustand-only prototype blocks (`verificationRequests`, `moderationCases`, `dynamicFields`, `geographic` stub, and duplicate `settings` stub).
- **15 Dead/Duplicate Files Removed (`P2-07`, `P2-13`):** Deleted `components/real-estate/PanoramaViewer360.tsx` (unified into `components/verticals/Panorama360Viewer.tsx`), `components/workspaces/ListingEditor.tsx`, `components/workspaces/OwnerWorkspace.tsx`, `components/workspaces/OwnerEntitlementBanner.tsx`, `components/auth/PhoneCountryInput.tsx`, `components/layout/BottomNav.tsx`, `components/discovery/InteractiveVectorMap.tsx`, `components/assistant/AssistantWidget.tsx`, `components/ui/BrandLogoStatus.tsx`, `components/bulletin/BulletinEditor.tsx`, `components/workspaces/superadmin/ComingSoonBuilderCard.tsx`, `components/workspaces/master-control/NestedCategoriesTab.tsx`, `components/workspaces/shared/MapCoordinatePicker.tsx`, `components/shared/MediaUploader.tsx`, and `components/shared/NotificationDropdown.tsx`.

### 14.3 Composite Indexes, Hosted-Supabase `REVOKE FROM PUBLIC` Sweep & Refund API (`P2-11`)
- **Migration #66 (`supabase/migrations/20261127_pass_v23b_indexes_revoke_and_refund_hygiene.sql`):**
  - Adds `idx_audit_logs_actor_workspace_created_v23b` on `public.audit_logs (actor_id, workspace, created_at DESC)` and `idx_pay_per_orders_target_status_v23b` on `public.pay_per_orders (target_table, target_id, status)`.
  - Upgrades `public.mediator_resolve_escrow_payout(p_booking_id uuid, p_action text, p_reason text DEFAULT NULL, p_refund_utr_ref text DEFAULT NULL)` to persist manual UPI / Razorpay refund UTR references across `delivery_transactions.gateway_payload`, `payment_intents.refund_notes`, `delivery_order_events.payload`, and `audit_logs.metadata`.
  - Executes a hosted-Supabase safe `DO $$` loop over `pg_proc` revoking `PUBLIC` execute on all app-owned `SECURITY DEFINER` functions in `public` (filtering out extension-owned functions via `pg_depend.deptype = 'e'` and `pg_has_role(current_user, p.proowner, 'MEMBER')` per `AGENTS.md` §3.8).
- **Escrow Refund Endpoint (`POST /api/payments/refund`):** Validates caller JWT, optionally initiates an automated Razorpay refund when `razorpayPaymentId` + server Razorpay credentials are present, and delegates settlement & audit logging to `public.mediator_resolve_escrow_payout`.

### 14.4 Legacy `00002` / `00005` Sub-Tables Deprecation & Archive Roadmap (`P2-13`)
- **Live Canonical Vertical Profile Tables (Phases 71a–75a):** All live reads and writes use `public.listing_print_profiles` (`71a`), `public.listing_civic_profiles` (`72a`), `public.listing_hotel_profiles` & `public.listing_booking_resources` (`73a`), `public.listing_shop_profiles` & `public.listing_restaurant_profiles` (`74a`), and `public.listing_real_estate_profiles` (`75a`), alongside `public.listings.service_details` (`v21b`) for `general` listings.
- **Deprecated Early-Prototype Tables (`00002_create_full_schema.sql` & `00005_sync_frontend_fields.sql`):**
  - Early 1:1 sub-tables from `00002` (`real_estate_listings`, `business_listings`, `service_listings`, `public_interest_listings`) and prototype moderation queues from `00005` (`verification_requests`, `moderation_cases`) have **zero** active frontend or RPC writers as of `v23b` (following deletion of `ListingEditor.tsx` and the Zustand prototype blocks in `AdminWorkspace.tsx`).
  - **Safe Archive Policy:** Tables remain untouched in historical migrations `00002`/`00005` so sequential migration replay (`00001` → `v23b`) stays 100% deterministic; no new code or queries may reference them.


