# DD oodle — Schema & Route Dictionary (Repo Ground Truth)

> **Audit Scope:** Strictly read-only inspection of `app/`, `components/`, `lib/`, `public/`, and all 47 files in `supabase/` (`45` SQL migrations + `seed_demo_content.sql` + `functions/purge-expired-pods`).  
> **Status:** Ground-truth snapshot as of Pass V14-B (`20261124_pass_v14b_schema_hardening.sql`).

---

## 1. App Router Inventory

### 1.1 Page Routes (`app/**/page.tsx` — 28 routes)

| Route | Dedicated vs. Explore Mode | Purpose / Primary Domain |
| :--- | :--- | :--- |
| `/` | Dedicated | Homepage (Hero, Quick Jump, Service Grid, Featured Listings, Fleet Preview, Bulletin Preview) |
| `/explore` | Unified Map + Feed | Interactive Discovery Workspace (Directory map/list, vertical filters, integrated Pick N Drop drawer & Activity panel) |
| `/marketplace` | **Dedicated route** (+ `/explore` links) | Local Shop Marketplace product catalogue (`public.marketplace_products`) |
| `/pick-n-drop` | **Dedicated route** (+ `/explore` panel) | Pick N Drop parcel, passenger ride & LPG gas logistics booking (`public.delivery_orders`). *Note: `/logistics` does **not** exist.* |
| `/vehicles` | Dedicated | Scheduled vehicle charter / per-seat booking directory (`public.vehicle_listings`) |
| `/vehicles/[id]` | Dedicated | Single vehicle booking detail + reservation flow (`create_vehicle_booking_with_intent`) |
| `/bulletin` | Dedicated | Community Bulletin feed, composer & subscription plans (`?plans=1` auto-opens plans modal) |
| `/civic` | Dedicated | Public & Civic Services Directory (helplines, checklists, 24x7 offices, correction reports) |
| `/listing/[id]` | Dedicated | Polymorphic Listing Detail (Business, Service, Real Estate, Hotel/Turf, Shop, Restaurant, Print, Civic) |
| `/listing/[id]/book` | Dedicated | Resource & Hotel/Turf slot booking flow (`public.resource_bookings`) |
| `/listing/[id]/print` | Dedicated | Digital Print & CSC order composer (`public.print_orders`) |
| `/workspace` | Dedicated (Hat-switched) | Unified Multi-Hat Workspace (`?hat=owner`/`business` alias, `staff`, `driver`, `hub_manager`, `master_control`) |
| `/onboarding` | Dedicated | Partner, Driver & Advertiser KYC Application Center (`public.partner_applications`) |
| `/activity` | Dedicated | User activity timeline & orders/bookings tracker |
| `/bookings` | Dedicated | User resource & vehicle bookings overview |
| `/saved` | Dedicated | Saved listings/items & active booking OTP viewer |
| `/messages` | Dedicated | Enquiries & messages inbox |
| `/profile` | Dedicated | Authenticated user profile & operational hats |
| `/profile/edit` | Dedicated | Profile details & avatar editor |
| `/user/[id]` | Dedicated | Public user profile page |
| `/settings` | Dedicated | Hub switcher, map style, locale, notification & display settings |
| `/login` | Dedicated | Renders `AuthModal` (`initialView="login"`) |
| `/signup` | Dedicated | Renders `AuthModal` (`initialView="signup"`) |
| `/about` | Dedicated | About DD oodle |
| `/contact` | Dedicated | Contact & support page |
| `/legal/privacy` | Dedicated | Privacy Policy |
| `/legal/refund-policy` | Dedicated | Cancellation & Refund Policy |
| `/legal/terms` | Dedicated | Terms of Service |

**Configured Redirects (`next.config.ts:91-114`):**
- `/activities` → `/activity`
- `/bookmarks` → `/saved`
- `/admin` → `/workspace?hat=master_control`
- `/driver` → `/workspace?hat=driver`

**Auth Callback Route (non-page):**
- `/auth/callback` (`app/auth/callback/route.ts`) — Calls `supabase.auth.exchangeCodeForSession(code)` and redirects to `/`.

---

### 1.2 API Routes (`app/api/**/route.ts` — 51 routes)

| Group | Route Paths |
| :--- | :--- |
| **Admin / System / Dev (5)** | `/api/admin/payment-env-status`, `/api/config/public`, `/api/dev/seed-test-accounts`, `/api/seed`, `/api/system/purge-media` |
| **Auth & Profile (7)** | `/api/auth/complete-signup`, `/api/auth/reset-password`, `/api/auth/send-otp`, `/api/auth/set-view-role`, `/api/auth/upload-avatar`, `/api/auth/verify-otp`, `/api/profile/update-map-settings` |
| **Bookings (4)** | `/api/bookings/availability`, `/api/bookings/create`, `/api/bookings/[id]/owner-action`, `/api/bookings/walk-in-block` |
| **Commerce (5)** | `/api/commerce/restaurant-orders/create`, `/api/commerce/restaurant-orders/[id]/kitchen-action`, `/api/commerce/shop-orders/create`, `/api/commerce/shop-orders/[id]/owner-action`, `/api/commerce/table-reservations` |
| **Real Estate (3)** | `/api/real-estate/boost/create-intent`, `/api/real-estate/freshness`, `/api/real-estate/visit-requests` |
| **Directory / Civic / Hubs / Media (11)** | `/api/categories/suggest`, `/api/civic/manage`, `/api/civic/report-correction`, `/api/hubs/detect`, `/api/hubs/request-city`, `/api/listings/review`, `/api/localities/resolve`, `/api/localities/suggest`, `/api/media/discard-temp`, `/api/media/upload` *(10)* + `/api/onboarding/kyc-signed-url`, `/api/onboarding/review` *(2)* |
| **Payments (5)** | `/api/payments/create-intent`, `/api/payments/submit-utr`, `/api/payments/razorpay/create-order`, `/api/payments/razorpay/verify`, `/api/payments/razorpay/webhook` |
| **Pick N Drop (3)** | `/api/pick-n-drop/orders`, `/api/pick-n-drop/purge-pods`, `/api/pick-n-drop/quote` |
| **Print Orders (7)** | `/api/print-orders/create`, `/api/print-orders/quote`, `/api/print-orders/upload`, `/api/print-orders/purge-expired`, `/api/print-orders/[id]/shop-action`, `/api/print-orders/[id]/request-delivery`, `/api/print-orders/[id]/files/[fileId]/signed-url` |

---

## 2. Canonical Database Tables, Foreign Keys & Status Columns

> All tables reside in schema `public` unless stated otherwise. No PostgreSQL `CREATE TYPE ... AS ENUM` types are used; all enumerations are enforced via `text` + `CHECK (...)` constraints.

### 2.1 Identity, Roles, Governance & Multi-Hub

| Table | Primary Key | Key Foreign Keys | Role / Status Constraints & Notes |
| :--- | :--- | :--- | :--- |
| `profiles` | `id (uuid)` | `auth.users(id)` (synced), `default_hub_id → service_hubs(id)` | `role IN ('visitor', 'driver', 'staff', 'owner', 'hub_manager', 'admin', 'super_admin')` (`phase66a:338`). Has `username`, `phone`, `phone_verified_at`, `referral_code`, `referred_by`. Trigger `trg_enforce_profile_role_governance` locks client signup to `visitor` and pins superadmin emails. |
| `hub_managers` | `id (uuid)` | `hub_id → service_hubs(id)`, `profile_id → profiles(id)` | `UNIQUE (hub_id, profile_id)`. Granular flags: `is_active`, `can_confirm_manual_payments`, `can_edit_rates`. |
| `service_hubs` | `id (uuid)` | — | Multi-city hubs (`slug` unique, e.g. `churachandpur`, `aizawl`, `imphal`). Center lat/lng, radius, `is_active`. |
| `hub_localities` | `id (uuid)` | `hub_id → service_hubs(id)` | Curated & user-submitted localities (`status` pending/verified). |
| `hub_requests` | `id (uuid)` | `user_id → profiles(id)` | City expansion requests from public/authenticated users. |
| `partner_applications` | `id (uuid)` | `applicant_id → profiles(id)`, `hub_id → service_hubs(id)`, `reviewer_id → profiles(id)` | `application_type IN ('business_owner', 'driver', 'advertiser')`; `status IN ('submitted', 'under_review', 'changes_requested', 'approved', 'rejected')`. `kyc_documents jsonb`. |
| `staff_delegations` | `id (uuid)` | `listing_id → listings(id)`, `staff_id → profiles(id)` | Upgraded in `pass_r1a` with `status CHECK (status IN ('active', 'suspended', 'revoked', 'frozen_by_transfer'))` and `vertical_scopes text[]`. |
| `referrals` | `id (uuid)` | `referrer_id → profiles(id)`, `referee_id → profiles(id)`, `hub_id → service_hubs(id)` | Tracks referral codes and conversion rewards. |
| `email_otps` | `email (text)` | — | Best-effort persistence for Resend email signup/recovery OTPs (stateless HMAC token is primary). |
| `notifications` | `id (uuid)` | `user_id → profiles(id)`, `link_listing_id → listings(id)` | Per-user notifications (`read boolean`). |
| `activity_logs` | `id (uuid)` | `user_id → profiles(id)` | Per-user activity history. |
| `audit_logs` | `id (uuid)` | — (`actor_id uuid`, `target_id text`) | **Exact canonical column list:** `id, timestamp, actor_id, actor_name, actor_role, workspace, action, target_id, target_name, details, target_table, metadata, created_at` (`target_table text`, `target_id text`, `details text`, `metadata jsonb`, `actor_role text`, `workspace text` — **never** `entity_type` or `entity_id`). Append-only (`trg_audit_logs_immutable`); `SELECT` restricted to `admin`/`super_admin`. |
| `app_settings`, `platform_settings`, `translations`, `helpbot_faqs`, `promo_codes`, `app_announcements`, `app_banners`, `featured_slots`, `featured_requests` | `id (uuid)` / `key (text)` | `hub_id → service_hubs(id)` (where hub-scoped) | Global & hub-level configuration, UPI/Razorpay settings, i18n, promo banners, featured homepage/explore placements. |

### 2.2 Directory, Verticals & Media

| Table | Primary Key | Key Foreign Keys | Key Enums / Statuses |
| :--- | :--- | :--- | :--- |
| `listings` | `id (uuid)` | `owner_id → profiles(id)`, `hub_id → service_hubs(id)`, `category_id → categories(id)` | `status` (`draft`, `published`, `pending_review`, etc.); `lifecycle_status` (`active`, `draining`, `archived_by_owner`); `listing_vertical` (polymorphic vertical key + `vertical_summary jsonb`); `is_civic_record`. |
| `categories` | `id (uuid)` | `parent_id → categories(id)` | Hierarchical nested categories (`phase67a`), plus `category_suggestions` (`status`: pending/approved/rejected). Legacy flat tables `app_categories` / `app_localities` also exist (`phase64a`). |
| `listing_media` | `id (uuid)` | `listing_id → listings(id)` | Listing photo gallery rows. |
| `media_assets` | `id (uuid)` | `owner_id → profiles(id)` | Unified media asset lifecycle table (`retention_class`, `ttl_hours`, `bound_entity_type`, `bound_entity_id`) for orphan/temp purge. |
| `enquiries` | `id (uuid)` | `listing_id → listings(id)` | `status` default `'new'` (customer-to-listing enquiries). |
| `reviews` | `id (uuid)` | `listing_id → listings(id)`, `user_id → profiles(id)` | `moderation_status` (`pending`, `approved`, `rejected`). |
| `verification_requests`, `moderation_cases`, `dynamic_field_definitions` | `id (uuid)` | `listing_id → listings(id)` | Verification queue, moderation reports, dynamic schema metadata. |
| `user_saved_items`, `user_follows`, `user_interests` | `id (uuid)` | `user_id → profiles(id)` | Polymorphic saves, listing/creator follows, interest tags. |
| **Legacy Subtype Tables (`00002` / `00005`)** | `listing_id` / `id` | `listing_id → listings(id)` | `business_listings`, `service_listings`, `real_estate_listings`, `public_interest_listings`, `sports_listings`, `catalogue_products`. |
| **Vertical Profile & Transaction Tables (Phases 71–75)** | | | |
| `listing_print_profiles`, `print_orders`, `print_order_files`, `print_order_events`, `merchant_settlements` | `listing_id` / `id` | `listing_id → listings(id)`, `hub_id → service_hubs(id)`, `print_order_id → print_orders(id)` | Print & CSC suite (`is_first_party_printswift`, `is_official_printswift`). `print_order_events` is strictly append-only (no `UPDATE`/`DELETE` policies). |
| `listing_civic_profiles`, `civic_correction_reports` | `listing_id` / `id` | `listing_id → listings(id)`, `hub_id → service_hubs(id)` | `department_type`, `is_24x7`, `helplines jsonb`, `document_checklists jsonb`, `live_civic_alert`. |
| `listing_hotel_profiles`, `listing_booking_resources`, `resource_bookings` | `listing_id` / `id` | `listing_id → listings(id)`, `resource_id → listing_booking_resources(id)` | Hotels, homestays, sports turfs, halls. Check-in OTP verified via `verify_booking_checkin_otp`. |
| `listing_shop_profiles`, `shop_orders` | `listing_id` / `id` | `listing_id → listings(id)`, `customer_id → profiles(id)` | Local retail pickup/delivery orders (`pickup_otp_hash`, `pickup_otp_display_for_customer`). |
| `listing_restaurant_profiles`, `restaurant_menu_items`, `restaurant_orders`, `restaurant_table_reservations` | `listing_id` / `id` | `listing_id → listings(id)`, `customer_id → profiles(id)` | Food orders & table reservations (`verify_commerce_pickup_otp`). |
| `listing_real_estate_profiles`, `property_visit_requests` | `listing_id` / `id` | `listing_id → listings(id)`, `requester_id → profiles(id)` | Real estate freshness confirmations & visit requests. |

### 2.3 Marketplace & Bulletins

| Table | Primary Key | Key Foreign Keys | Key Enums / Statuses |
| :--- | :--- | :--- | :--- |
| `marketplace_products` | `id (uuid)` | `listing_id → listings(id) ON DELETE CASCADE`, `owner_id → profiles(id) ON DELETE CASCADE`, `hub_id → service_hubs(id)`, `category_id → categories(id)` | **Canonical marketplace table** (note: `marketplace_items` does **not** exist). `in_stock`, `is_active`, `price >= 0`. Auto-syncs `hub_id` from parent `listings` via trigger. |
| `subscription_plans` | `id (uuid)` | — | Composable / bulletin plans (`slug` unique, `price_inr`, `max_active_bulletins`, `max_monthly_posts`, `duration_days`, `is_active`). |
| `user_subscriptions` | `id (uuid)` | `user_id → profiles(id)`, `plan_id → subscription_plans(id)`, `verified_by → profiles(id)` | `status IN ('active', 'expired', 'cancelled')`, `payment_ref`. |
| `bulletin_post_passes` | `id (uuid)` | `user_id → profiles(id)`, `hub_id → service_hubs(id)` | Pay-per-post bulletin passes (`upi_utr_ref`, `status`). |
| `bulletins` | `id (uuid)` | `author_id → profiles(id)`, `linked_listing_id → listings(id)`, `hub_id → service_hubs(id)` | `category IN ('announcement', 'job', 'advertisement', 'notice', 'event')`; `status IN ('published', 'archived', 'removed_by_admin')`; `is_pinned`, `expires_at`. |
| `bulletin_reports` | `id (uuid)` | `bulletin_id → bulletins(id)`, `reporter_id → profiles(id)` | `status IN ('open', 'reviewed', 'dismissed')`. |
| `bulletin_audit_logs` | `id (uuid)` | `bulletin_id → bulletins(id)`, `actor_id → profiles(id)` | Snapshot audit history for bulletin moderation/edits. |

### 2.4 Fleet, Logistics (Pick N Drop), Payments & OTP Vaults

| Table | Primary Key | Key Foreign Keys | Key Enums / Statuses |
| :--- | :--- | :--- | :--- |
| `vehicle_types` | `id (uuid)` | — | **5 canonical fleet tiers** (`slug` unique): `cycle_rickshaw`, `two_wheeler`, `e_rickshaw`, `mini_van`, `pickup_truck` (`pass_v14b:1212-1234`). `supported_modes text[]` (`parcel`, `passenger`, `gas`). |
| `hub_vehicle_rates` | `id (uuid)` | `hub_id → service_hubs(id)`, `vehicle_type_id → vehicle_types(id)` | `UNIQUE (hub_id, vehicle_type_id)`. Per-hub fare overrides; all 5 tiers seeded for `churachandpur`. |
| `drivers` | `id (uuid)` | `profile_id → profiles(id) UNIQUE`, `hub_id → service_hubs(id)` | **Unified canonical driver table** (`pass_v14b` merged and dropped legacy `driver_profiles`). `vehicle_type IN ('cycle_rickshaw','two_wheeler','e_rickshaw','auto','mini_van','car','pickup_truck')`; `kyc_status IN ('pending','verified','suspended')` synced with `kyc_verified`; `is_online`, `is_active`. |
| `vehicles` | `id (uuid)` | `driver_id → drivers(id)`, `vehicle_type_id → vehicle_types(id)` | Fleet vehicle registry (`plate_number` unique, `current_location geography(Point,4326)`, `is_available`). |
| `vehicle_listings` | `id (uuid)` | `owner_id → profiles(id)`, `driver_id → drivers(id)`, `vehicle_type_id → vehicle_types(id)`, `hub_id → service_hubs(id)` | Bookable charter/shared vehicles (`booking_mode`: `full_vehicle` / `per_seat` / `both`; `pricing_model`: `hourly` / `daily`). |
| `vehicle_availability_blocks` | `id (uuid)` | `vehicle_listing_id → vehicle_listings(id)` | Owner offline maintenance / walk-in calendar blocks. |
| `vehicle_bookings` | `id (uuid)` | `vehicle_listing_id → vehicle_listings(id)`, `customer_id → profiles(id)`, `payment_intent_id → payment_intents(id)` | `booking_code` unique; `booking_mode IN ('full_vehicle','per_seat')`; `status`: `soft_hold`, `pending_payment_confirm`, `confirmed`, `in_progress`, `completed`, `cancelled`, `expired`. Inline `start_otp`/`end_otp` columns dropped in `pass_v14b:651-653`. |
| `vehicle_booking_otps` | `booking_id (uuid)` | `booking_id → vehicle_bookings(id) ON DELETE CASCADE` | **Driver-blocked OTP vault** for `vehicle_bookings` (`pickup_otp`, `dropoff_otp`, `return_otp`, `failed_attempts`, `locked_until`, `*_verified_at`). Direct client `INSERT`/`UPDATE`/`DELETE` blocked (`false`); drivers/owners blocked from `SELECT`. |
| `delivery_orders` | `id (uuid)` | `customer_id → profiles(id)`, `mediator_id → profiles(id)`, `driver_id → drivers(id)`, `vehicle_id → vehicles(id)`, `vehicle_type_id → vehicle_types(id)`, `hub_id → service_hubs(id)` | Pick N Drop orders (`order_code` unique). `service_mode IN ('parcel','passenger','gas')`; `trip_type IN ('one_way','two_way')`; `status IN ('awaiting_payment','payment_submitted','escrow_held','driver_assigned','picked_up','in_transit','delivered_pending_confirm','return_in_transit','completed','cancelled','disputed')`. Holds `pod_storage_path`, `pod_uploaded_at`, `pod_purge_at`. Zero inline OTP columns. |
| `delivery_order_secrets` | `order_id (uuid)` | `order_id → delivery_orders(id) ON DELETE CASCADE` | **Driver-blocked OTP vault** for `delivery_orders` (`pickup_otp`, `dropoff_otp`, `return_otp`, `failed_attempts`, `locked_until`). Only `customer_id`, `mediator_id`, and `is_pnd_mediator(auth.uid())` may `SELECT`. |
| `delivery_transactions` | `id (uuid)` | `order_id → delivery_orders(id) ON DELETE CASCADE`, `recorded_by → profiles(id)` | Pick N Drop escrow ledger (`tx_type IN ('upi_payment','escrow_hold','driver_payout','platform_commission','refund','cancellation_fee')`, `upi_utr_ref`, `payment_proof_path`). *No `UNIQUE` index on `upi_utr_ref`.* |
| `delivery_order_events` | `id (uuid)` | `order_id → delivery_orders(id) ON DELETE CASCADE`, `actor_id → profiles(id)` | Chronological event log for Pick N Drop orders (OTP failures/verifications, assignment, confirmation, POD purge). |
| `payment_intents` | `id (uuid)` | `user_id → profiles(id)`, `hub_id → service_hubs(id)`, `verified_by → profiles(id)` | Central payment engine (`intent_code` unique). `purpose` covers `pick_n_drop`, `vehicle_booking`, `bulletin_subscription`, `bulletin_post_pass`, plus print/commerce/booking/RE boost intents. `provider IN ('manual_upi','razorpay')`; `status IN ('awaiting_payment','pending_manual','succeeded','failed','rejected','refunded')`. Partial unique index `idx_unique_succeeded_utr` on `(upi_utr_ref) WHERE status = 'succeeded' AND upi_utr_ref IS NOT NULL`. |

---

## 3. RPC Functions, Triggers, Cron Jobs & Storage Buckets

### 3.1 Core `SECURITY DEFINER` RPCs & `GRANT` Posture

| Function Signature (Latest Definition) | Security Mode | `GRANT EXECUTE` | Role / Purpose |
| :--- | :--- | :--- | :--- |
| `public.get_user_operational_hats(p_user_id uuid) → jsonb` (`pass_v14b:191-291`) | `SECURITY DEFINER` | `authenticated`, `service_role` | Aggregates `platform_role`, owned listings/vehicles counts, active `staff_delegations`, canonical `drivers` profile, and active `hub_managers` hubs. |
| `public.review_partner_application(p_application_id uuid, p_new_status text, p_reviewer_notes text DEFAULT NULL) → jsonb` (`pass_v14b:294-613`) | `SECURITY DEFINER` | `authenticated`, `service_role` | Hub-manager / super-admin approval workflow; promotes role and upserts canonical `public.drivers` for driver applications. |
| `public.superadmin_set_user_role(p_target_user_id uuid, p_new_role text) → jsonb` (`phase66a:991-1060`) | `SECURITY DEFINER` | `authenticated` | Strictly gated to `is_super_admin(auth.uid())`; sets `profiles.role` across all 7 roles including `hub_manager` and `admin`. |
| `public.create_vehicle_booking_with_intent(p_vehicle_listing_id uuid, p_booking_mode text, p_seats_booked integer DEFAULT 1, p_start_time timestamptz DEFAULT NULL, p_end_time timestamptz DEFAULT NULL, p_pickup_location text DEFAULT '', p_dropoff_location text DEFAULT NULL, p_instructions text DEFAULT NULL, p_total_fare_inr numeric DEFAULT 0) → jsonb` (`pass_v14b:717-928`) | `SECURITY DEFINER` | `authenticated` | Locks `vehicle_listings`, expires stale soft holds, checks overlap blocks/seats, creates `vehicle_bookings` + `vehicle_booking_otps` + `payment_intents`. |
| `public.verify_vehicle_booking_otp(p_booking_id uuid, p_stage text, p_otp text) → jsonb` (`pass_v14b:931-1062`) | `SECURITY DEFINER` | `authenticated`, `service_role` | Driver/owner/mediator verification against `vehicle_booking_otps` (`pickup`/`start`, `dropoff`/`end`, `return`); 5-attempt / 15-min lockout; advances booking status. |
| `public.verify_delivery_otp(p_order_id uuid, p_stage text, p_otp text, p_pod_path text DEFAULT NULL) → jsonb` (`phase60c:116-330`) | `SECURITY DEFINER` | `authenticated` | Assigned driver or `is_pnd_mediator` verification against `delivery_order_secrets` (`pickup`, `dropoff`, `return`); conditional POD requirement (`pod_required`); 5-attempt / 15-min lockout. |
| `public.mediator_confirm_delivery(p_order_id uuid) → jsonb` (`phase60:795-891`) | `SECURITY DEFINER` | `authenticated` | Gated to `is_pnd_mediator(auth.uid())`; marks `delivery_orders.status = 'completed'`, records 85% `driver_payout` + 15% `platform_commission` in `delivery_transactions`, schedules `pod_purge_at = now() + 48h`. |
| `public.fulfill_payment_intent(p_intent_id uuid, p_provider_payment_id text DEFAULT NULL, p_provider text DEFAULT NULL) → jsonb` (`phase75a:438-908`) | `SECURITY DEFINER` | `service_role` (earlier versions also `authenticated` for super_admin / delegated hub_manager checks inside body) | Atomically fulfills `payment_intents` across all purposes (`pick_n_drop`, `vehicle_booking`, `bulletin_*`, `print_order`, `resource_booking`, `shop_order`, `restaurant_order`, `real_estate_boost`). |
| `public.refund_payment_intent(...)` (`phase63a:980+`) | `SECURITY DEFINER` | `authenticated` (gated to `is_super_admin`) | Records refund UTR & updates linked order/booking. |
| `public.purge_expired_delivery_pods() → integer` (`pass_v14b:1150-1186`) | `SECURITY DEFINER` | `service_role` | Deletes expired objects from `storage.objects` (`bucket_id = 'delivery-pods'`) where `pod_purge_at <= now()` and nulls `delivery_orders.pod_storage_path`. |
| `public.verify_booking_checkin_otp(...)` (`phase73a:793`) & `public.verify_commerce_pickup_otp(...)` (`phase74a:728`) | `SECURITY DEFINER` | `authenticated`, `service_role` | Operator-side OTP verification for hotel/turf bookings and shop/restaurant pickup orders. |
| `public.get_effective_entitlements(p_user_id uuid, p_listing_id uuid DEFAULT NULL)` (`pass_v12c:65`) | `SECURITY DEFINER` | `authenticated`, `service_role` | Resolves active subscription + override entitlements per user/listing. |
| `public.is_super_admin([p_uid uuid])`, `public.is_pnd_admin(p_uid uuid)`, `public.is_pnd_mediator(p_uid uuid)`, `public.is_hub_manager_for(p_hub_id uuid)`, `public.can_edit_hub_rates(p_hub_id uuid)` | `SECURITY DEFINER` | Helper functions in RLS | Non-recursive RLS role helpers (`pass_v14a:61-80` updated `is_pnd_mediator` to `hub_manager`/`admin`/`super_admin` + active `hub_managers`). |
| `public.is_official_printswift_listing(p_listing_id uuid)` & `public.has_active_print_entitlement(p_listing_id uuid)` (`pass_v12a:30-85`) | `SECURITY DEFINER` | `anon`, `authenticated`, `service_role` | First-party PrintSwift governance helpers. |

### 3.2 Key Governance Triggers

| Trigger | Table | Function (`SECURITY DEFINER`) | Purpose |
| :--- | :--- | :--- | :--- |
| `trg_enforce_profile_role_governance` | `public.profiles` | `enforce_profile_role_governance()` (`pass_v14a:14-58`) | Pins hardcoded superadmin emails, allows `service_role` provisioning, forces client `INSERT` to `visitor`, blocks non-admin role `UPDATE`. |
| `trg_guard_canonical_drivers_writes` | `public.drivers` | `guard_canonical_drivers_writes()` (`pass_v14b:123-179`) | Syncs `kyc_status ↔ kyc_verified`; restricts self-update by drivers to `is_online` only. |
| `trg_guard_partner_application_writes` | `public.partner_applications` | `guard_partner_application_writes()` (`pass_v6a:287-347`) | Prevents applicants from modifying `status` or reviewer fields. |
| `trg_guard_payment_intent_user_update` | `public.payment_intents` | `guard_payment_intent_user_update()` (`phase63a:143`) | Prevents non-admin mutation of `amount_inr`, `purpose`, `reference_id`, `verified_by`, `refund_*`. |
| `trg_marketplace_products_sync_hub_id` | `public.marketplace_products` | Sync trigger (`phase66a:530-535`) | Ensures `marketplace_products.hub_id` always inherits parent `listings.hub_id`. |
| `trg_listing_print_profiles_sync_guard` & `trg_guard_official_printswift_listings_mutation` | `listing_print_profiles`, `listings` | `sync_and_guard_listing_print_profile()`, `guard_official_printswift_listings_mutation()` (`pass_v12a:90-309`) | Guards official first-party PrintSwift flags and listing mutations. |

### 3.3 Cron Jobs & Scheduled Purge Mechanisms

| Job / Mechanism | Schedule | Target | Notes |
| :--- | :--- | :--- | :--- |
| `ddoodle_purge_expired_delivery_pods_48h` (`pg_cron`, `pass_v14b:1191-1205`) | `0 */6 * * *` (every 6 hours) | `SELECT public.purge_expired_delivery_pods();` | Conditionally scheduled if `pg_cron` extension is enabled; falls back cleanly to HTTP cron endpoints below. |
| `POST /api/pick-n-drop/purge-pods` + `supabase/functions/purge-expired-pods/index.ts` | External / manual cron | `delivery-pods` bucket + `delivery_orders` + `delivery_order_events` | HTTP & Edge Function fallback for 48-hour POD deletion. |
| `POST /api/print-orders/purge-expired` & `POST /api/system/purge-media` | External / manual cron | `print-documents` / `print-vault` / `delivery-pods` / `media_assets` | Purges expired print documents and unbound temp media. *(Note: `purge-media/route.ts:159` references bucket `'print-vault'` whereas `phase71a:76` provisions `'print-documents'`.)* |

### 3.4 Supabase Storage Buckets

| Bucket ID | Visibility | Max File Size | Allowed MIME Types | Access / RLS Posture |
| :--- | :--- | :--- | :--- | :--- |
| `avatars` (`pass_v14b:1068-1133`) | **Public read** (`public = true`) | 5 MB | `image/jpeg`, `image/png`, `image/webp` | Public `SELECT`; owner-only `INSERT`/`UPDATE`/`DELETE` scoped to `storage.foldername(name)[1 or 2] = auth.uid()::text` (+ admin delete). |
| `delivery-pods` (`phase60:508-571`, `pass_v14b:1136-1148`) | **Private** (`public = false`) | 5 MB | `image/jpeg`, `image/png`, `image/webp` | Active drivers & mediators `INSERT`; `SELECT` restricted to order customer, assigned driver, or mediator; admin `DELETE`; 48-hour auto-purge after completion. |
| `print-documents` (`phase71a:68-115`) | **Private** (`public = false`) | 25 MB | `application/pdf`, `image/jpeg`, `image/png`, `image/webp` | Zero public/client `SELECT` policies; downloaded strictly via 5-minute server-side signed URLs (`/api/print-orders/[id]/files/[fileId]/signed-url`). |
| `kyc-documents` (`pass_v6a:58-105`) | **Private** (`public = false`) | 10 MB | `application/pdf`, `image/jpeg`, `image/png`, `image/webp` | Zero public/client `SELECT` policies; viewed strictly via 120-second server-side signed URLs (`/api/onboarding/kyc-signed-url`). |
| `media` (`app/api/media/upload/route.ts:6, 307-325`) | **Public** (uploaded via `service_role`, `getPublicUrl`) | App-enforced | Listing covers/galleries, products, bulletins, banners, payment proofs | *Note: Referenced by `/api/media/upload` (`BUCKET_NAME = 'media'`), not provisioned via SQL `INSERT INTO storage.buckets` in migrations.* |

---

## 4. Preserved Legacy Identifiers (Do Not Rename or Duplicate)

> Retained intentionally for backward compatibility with existing browser sessions, triggers, RPCs, and cross-component event buses.

### 4.1 Database Columns, Functions & Triggers
- `public.listing_print_profiles.is_first_party_printswift` (`boolean`, `phase71a:133`)
- `public.listing_print_profiles.is_official_printswift` (`boolean`, `pass_v12a`)
- `public.is_official_printswift_listing(uuid)` (`pass_v12a:30`)
- `public.guard_official_printswift_listings_mutation()` & trigger `trg_guard_official_printswift_listings_mutation` (`pass_v12a:270-309`)
- `print_order_events` actor role string `'printswift_operator'` (`phase71a:845`)

### 4.2 Browser Storage Keys (`localStorage` / `sessionStorage`) & Cache Names
- `printswift_local_auth_session_v1` (`lib/auth.ts:22`)
- `printswift_local_demo_state_v1`, `printswift_local_drawn_shapes_v1`, `printswift_local_theme_v1`, `printswift_local_map_style_v1`, `printswift_local_map_cloud_config_v1`, `printswift_local_split_pct_v1`, `printswift_local_custom_default_center_v1`, `printswift_local_simple_mode_v1`, `printswift_local_real_estate_mode_v1` (`lib/store.tsx:61-71`)
- `printswift_local_app_settings_v1` (`lib/supabase/admin.ts:32`)
- `printswift_platform_settings_v1` (`lib/supabase/platform-settings.ts:18`)
- `printswift_ota_translations_v1` (`lib/supabase/translations.ts:39`)
- `printswift_local_locale_v1`, `printswift_unified_settings_v1` (`lib/hooks/useSettings.ts:49-50`)
- `printswift_local_map_settings_prompt_dismissed_v1` (`lib/map-settings.ts:17`)
- `printswift_active_hub_slug_v1` (`lib/auth.ts:131`)
- `printswift_saved_interests_v1` (`lib/hooks/useSavedInterests.ts:57`)
- `printswift_dismissed_announcements_v1` (`components/ui/GlobalAnnouncementBar.tsx:23`)
- `printswift_banner_imp_` (sessionStorage prefix, `components/ui/PromoBannerSlot.tsx:30`)
- `printswift-local-pwa-v2` (Service Worker cache name, `public/sw.js:1`)
- `printswift-local-otp-secret` (fallback HMAC secret constant, `lib/otp-token.ts:7`)

### 4.3 DOM CustomEvents (`window.dispatchEvent` / `addEventListener`)
- `printswift:map-settings-updated`
- `printswift:app-settings-updated`
- `printswift:platform-settings-updated`
- `printswift:profile-updated`
- `printswift:locale-changed`
- `printswift:notifications-updated`
- `printswift:translations-updated`
- `printswift:reset-demo-data`
- `printswift:focus-map-listing`
- `printswift:unmount-overlays`
- `printswift:pnd-orders-updated`
- `printswift:app-config-updated`
- `printswift:hub-switched`
- `printswift:open-workspace-enquiries`

---

## 5. High-Risk Architecture Audit Summary

| # | Area | Verdict | Ground Truth & Exact File/Line References |
| :--- | :--- | :--- | :--- |
| 1 | **Pick N Drop OTP Isolation** | **PASS** | Standalone Pick N Drop orders (`delivery_orders`, `phase60:58-104`) have zero inline OTP columns. OTPs live in `delivery_order_secrets` (`phase60:107-114`, written in `app/api/pick-n-drop/orders/route.ts:365-373`) with driver-blocking `SELECT` RLS (`phase60:405-417` + `pass_v14a:61-80`) and `SECURITY DEFINER` RPC `verify_delivery_otp` (`phase60c:116-330`). Vehicle bookings use parallel vault `vehicle_booking_otps` + `verify_vehicle_booking_otp` (`pass_v14b:619-710, 931-1062`). |
| 2 | **Delegated Staff RLS Parity** | **REMEDIATED (v18a)** | Closed in `20261126_pass_v18a_owner_staff_rls_and_quotas.sql`: (a) created canonical `public.is_active_listing_staff(p_listing_id uuid, p_user_id uuid DEFAULT auth.uid())` enforcing `sd.status = 'active'`; (b) added `staff_delegations` RLS policies for owner `INSERT`/`UPDATE`/`DELETE` and staff/owner/admin `SELECT`; (c) updated `listings`, `enquiries`, and `marketplace_products` RLS so active delegated staff can `SELECT`/`UPDATE` operational fields, edit/toggle products, and reply to `enquiries` while revoked/inactive staff have zero access; (d) added `trg_guard_staff_listing_mutations_v18a` blocking staff from transferring `owner_id`, deleting listings, archiving business `lifecycle_status`, or spoofing `paid_until`. |
| 3 | **Admin vs. Superadmin & Audit Trail** | **PARTIALLY REMEDIATED (v15a)** | `20261124_pass_v15a_superadmin_foundation.sql` adds: (a) `trg_guard_immutable_superadmin` (`BEFORE INSERT OR UPDATE OR DELETE` on `public.profiles`) blocking any `authenticated`/`anon` session from granting, revoking, mutating, or deleting `super_admin`; (b) hardened `superadmin_set_user_role` rejecting `super_admin` grants/revocations; (c) upgraded append-only `public.audit_logs` (`SELECT` only for `admin`/`super_admin`, zero `UPDATE`/`DELETE` policies + `trg_audit_logs_immutable`, `SECURITY DEFINER` `write_audit_log`, automatic audit triggers on `profiles`, `categories`, `homepage_items`, `popular_localities`, `partner_applications`). Remaining follow-up: tighten `vehicle_types_admin_manage` (`phase60:267-272`) from `is_pnd_admin` to `is_super_admin` in v15b/v15c. |
| 4 | **UPI Escrow Replay Protection** | **GAP** | `payment_intents` has partial unique index `idx_unique_succeeded_utr` (`phase63a:119-121`) covering `WHERE status = 'succeeded'`, and `app/api/payments/submit-utr/route.ts:150-166` only checks `status = 'succeeded'`. Concurrent duplicate UTR submissions in `pending_manual` are not blocked prior to approval, and `delivery_transactions.upi_utr_ref` (`phase60:130`) / `bulletin_post_passes.upi_utr_ref` have no `UNIQUE` constraint. |
| 5 | **Auth & Onboarding (Phases 18 & 46)** | **GAP** | `components/auth/AuthModal.tsx` (lines 285, 330, 381, 534; used by `/login` & `/signup`) is **Email + Password + Resend Email OTP only** (`app/api/auth/send-otp/route.ts:150-190`). Zero `signInWithOAuth` (Google) or `signInWithOtp` (Phone SMS) calls exist in UI/API (only passive `app/auth/callback/route.ts:9` exists). `/onboarding` (`app/onboarding/page.tsx:12-26`) is a live Partner/Driver/Advertiser KYC form (`partner_applications`), not a general user onboarding flow. |
| 6 | **Offline PWA Coverage (Phase 11)** | **GAP** | `public/sw.js:6-12` only precaches `/`, `/about`, `/contact`, `/manifest.json`, `/icon.svg` and skips cross-origin Supabase REST requests (`public/sw.js:117`). Zero `indexedDB` usage exists. `CivicDirectoryPageClient.tsx:171-183` fetches `listing_civic_profiles` live with no offline helpline persistence, and active customer OTPs (`vehicle_booking_otps` in `app/saved/page.tsx:622` / `ActivityPanel.tsx:623`; `delivery_order_secrets` in `ActivityPanel.tsx:748` / `OrderTrackerModal.tsx:134`) are online-only. |

---

## 6. Pass v15a Superadmin Foundation (`20261124_pass_v15a_superadmin_foundation.sql`)

### 6.1 Tables & Columns Added / Upgraded
- **`public.audit_logs` (Upgraded & Hardened — Live Column Contract):**
  - **Exact live column list:** `id, timestamp, actor_id, actor_name, actor_role, workspace, action, target_id, target_name, details, target_table, metadata, created_at`.
  - **Column types & insert rule:** `target_table text`, `target_id text` (always cast UUIDs with `::text`), `details text` (human-readable summary), `metadata jsonb NOT NULL DEFAULT '{}'::jsonb` (structured JSON payload via `jsonb_build_object(...)`), `actor_role text`, `workspace text`. **Never** use `entity_type` or `entity_id` on `public.audit_logs`, and never pass `jsonb` into `details`.
  - RLS: `audit_logs_admin_select` (`FOR SELECT TO authenticated USING (public.is_pnd_admin(auth.uid()))`); zero `INSERT`/`UPDATE`/`DELETE` client policies.
  - Trigger: `trg_audit_logs_immutable` (`BEFORE UPDATE OR DELETE`) rejects all mutations.
- **`public.categories` (Extended):**
  - Added `icon_key text DEFAULT 'tag'` and `accent_color text DEFAULT '#2563EB'` (backfilled and kept bidirectionally synchronized with legacy `icon` and `color_hex` via `trg_categories_sync_icon_columns`).
  - Confirmed `super_admin`-only write RLS (`categories_superadmin_write`).
- **`public.homepage_items` (New):**
  - Columns: `id uuid PK`, `section text CHECK (section IN ('shortcut_grid', 'quick_jump', 'featured_banner'))`, `title text NOT NULL`, `subtitle text`, `container_style text DEFAULT 'card'`, `icon_key text DEFAULT 'tag'`, `accent_color text DEFAULT '#2563EB'`, `route_key text NOT NULL`, `query_params jsonb NOT NULL DEFAULT '{}'::jsonb`, `sort_order integer NOT NULL DEFAULT 0`, `is_enabled boolean NOT NULL DEFAULT true`, `updated_at timestamptz NOT NULL DEFAULT now()`.
  - RLS: Public `SELECT` where `is_enabled = true` (plus `super_admin` sees all); `super_admin`-only `INSERT`/`UPDATE`/`DELETE`.
- **`public.popular_localities` (New):**
  - Columns: `id uuid PK`, `name text NOT NULL`, `slug text UNIQUE NOT NULL`, `icon_key text DEFAULT 'map-pin'`, `lat double precision NOT NULL`, `lng double precision NOT NULL`, `default_zoom integer NOT NULL DEFAULT 15`, `sort_order integer NOT NULL DEFAULT 0`, `is_enabled boolean NOT NULL DEFAULT true`.
  - RLS: Public `SELECT` where `is_enabled = true` (plus `super_admin` sees all); `super_admin`-only `INSERT`/`UPDATE`/`DELETE`.
  - Seeded idempotently with 6 Churachandpur localities (`lamka-town`, `new-lamka`, `rengkai`, `tuibong`, `hiangtam-lamka`, `zenhang-lamka`).

### 6.2 Security Triggers & RPCs Added / Hardened
- `public.guard_immutable_superadmin()` + `trg_guard_immutable_superadmin` (`BEFORE INSERT OR UPDATE OR DELETE ON public.profiles`): blocks `authenticated`/`anon` sessions (including inside `SECURITY DEFINER` RPCs) from granting, revoking, mutating, or deleting `super_admin`.
- `public.superadmin_set_user_role(p_target_user_id uuid, p_new_role text)`: hardened to allow only `visitor | driver | staff | owner | hub_manager | admin` and strictly reject modifying `super_admin` profiles.
- `public.write_audit_log(...)` (`SECURITY DEFINER`, revoked from `PUBLIC`/`anon`/`authenticated`): appends immutable records into `public.audit_logs`.
- Automatic audit triggers: `trg_audit_profile_role_change`, `trg_audit_categories_changes`, `trg_audit_homepage_items_changes`, `trg_audit_popular_localities_changes`, `trg_audit_partner_application_review`.

---

## 7. Pass v15b Subscriptions, Entitlements & 3-Tier Payment Matrix (`20261124_pass_v15b_subscriptions_and_payments.sql`)

### 7.1 Tables & Columns Retrofitted / Created
- **`public.subscription_plans` (Retrofitted In-Place — Zero Breakage to `/bulletin?plans=1`):**
  - Added columns: `slug text`, `title text`, `info text`, `applicable_roles text[]`, `applicable_categories text[] DEFAULT ARRAY['*']`, `applicable_subcategories text[] DEFAULT ARRAY['*']`, `entitlements jsonb DEFAULT '{}'::jsonb`, `is_active boolean DEFAULT true`, `sort_order integer DEFAULT 0`, `updated_at timestamptz`.
  - Bidirectional sync trigger (`trg_subscription_plans_v15b_sync`) keeps `title <-> name`, `sort_order <-> display_order`, and `info <-> tagline` aligned so `/bulletin?plans=1` (`BulletinComposerModal.tsx`) continues rendering live active plans for signed-out & signed-in visitors.
  - RLS: Public `SELECT` where `is_active = true OR public.is_super_admin()`; `INSERT`/`UPDATE`/`DELETE` strictly `public.is_super_admin()`.
- **`public.subscription_plan_prices` (New Child Table):**
  - Columns: `id uuid PK`, `plan_id uuid FK -> subscription_plans(id) ON DELETE CASCADE`, `duration_label text`, `duration_days integer`, `price_inr numeric(10,2)`, `compare_at_inr numeric(10,2)`, `is_default boolean`, `is_active boolean`, `sort_order integer`, `created_at`, `updated_at`.
  - Backfilled with 1 default row per existing plan. Public `SELECT` on active rows; `super_admin`-only writes.
- **`public.user_subscriptions` (Upgraded In-Place):**
  - Added columns: `price_id uuid FK -> subscription_plan_prices(id)`, `starts_at timestamptz`, `ends_at timestamptz`, `entitlements_snapshot jsonb`, `custom_overrides jsonb DEFAULT '{}'::jsonb`, `admin_notes text`, `updated_by uuid`, `updated_at timestamptz`.
  - Expanded `status` CHECK constraint to `('active','suspended','expired','pending','cancelled','trialing','paused','pending_payment')`.
  - Sync trigger (`trg_user_subscriptions_v15b_sync`) keeps `ends_at <-> expires_at` and `custom_overrides <-> entitlement_overrides` synchronized.
  - RLS: Users read own rows and may only submit `pending`/`pending_payment` requests without overrides; all `UPDATE`/`DELETE` status, renewal, plan switch, and `custom_overrides` mutations are strictly `public.is_super_admin()`.
- **`public.payment_feature_policies` (New 3-Tier System Policy Table):**
  - Columns: `scope_key text PK`, `scope_type text CHECK (scope_type IN ('feature','listing_type'))`, `label text`, `upi_enabled boolean`, `manual_enabled boolean`, `escrow_required boolean`, `allow_listing_override boolean`, `updated_at timestamptz`.
  - Seeded with 5 features (`pnd`, `bulletin`, `vehicles`, `print_order`, `marketplace`; `escrow_required = true` for `pnd` and `vehicles`) and 8 listing types (`general`, `print_digital`, `booking_venue`, `shop_catalogue`, `real_estate`, `restaurant_food`, `hotel_stay`, `public_civic`).
  - RLS: Public `SELECT`; `super_admin`-only writes.
- **`public.listings` (Extended):**
  - Added `payment_mode text NOT NULL DEFAULT 'manual' CHECK (payment_mode IN ('upi','manual','both'))`.

### 7.2 Security RPCs, Audit Triggers & TypeScript Helpers
- **`public.get_effective_entitlements(p_user_id uuid, p_listing_id uuid DEFAULT NULL) RETURNS jsonb` (`SECURITY DEFINER`):**
  - Preserves optional 2nd parameter `p_listing_id DEFAULT NULL` for backward compatibility with `has_active_print_entitlement` & `useEffectiveEntitlements`.
  - Merges active non-expired `entitlements_snapshot` (or plan `entitlements`) + `custom_overrides`, or soft-freezes to a safe free-tier baseline when expired/suspended/cancelled without deleting customer data.
- **`public.resolve_effective_payment_methods(p_scope_key text, p_listing_id uuid DEFAULT NULL) RETURNS jsonb` (`SECURITY DEFINER`):**
  - Enforces the 3-tier cascade: Layer 1 (`payment_feature_policies`) → Layer 2 (owner's `get_effective_entitlements` → `online_payment.enabled`) → Layer 3 (`listings.payment_mode` when `allow_listing_override = true`).
- **Audit Triggers:** `trg_audit_subscription_plans_v15b`, `trg_audit_subscription_plan_prices_v15b`, `trg_audit_user_subscriptions_v15b`, `trg_audit_payment_feature_policies_v15b` write all mutations to `public.audit_logs` via `public.write_audit_log(...)`.
- **Typed Helpers & UI Panels:**
  - `lib/subscriptions/entitlements.ts` (`PlanEntitlements`, `mergeEntitlements`, `fetchEffectiveEntitlements`, `useEntitlements`)
  - `lib/payments/resolver.ts` (`computeEffectivePaymentMethods`, `fetchPaymentPolicyForScope`, `resolveEffectivePaymentMethods`)
  - `components/workspaces/superadmin/SubscriptionPlansBuilder.tsx`, `SubscribersManager.tsx`, `PaymentMethodsMatrix.tsx` (wired into `AdminWorkspace.tsx`), and listing-level `payment_mode` selector in `ListingEditorModal.tsx`.

---

## 8. Pass v15c Homepage Builder, Fleet Rates Hardening & Public Hydration (`20261124_pass_v15c_homepage_builder_and_seeds.sql`)

### 8.1 Tables, Columns & Triggers Added / Hardened
- **`v15b` Sync Trigger Sanity Check:** Verified `trg_subscription_plans_v15b_sync` and `trg_user_subscriptions_v15b_sync` run strictly as `BEFORE INSERT OR UPDATE` triggers (zero recursion risk).
- **`public.listings` (Extended for Featured Places Control):**
  - Added columns: `featured_order integer NOT NULL DEFAULT 0`, `is_featured boolean NOT NULL DEFAULT false`.
  - Added index `idx_listings_featured_order (status, is_featured DESC, featured_order ASC, rating DESC)`.
  - Attached `trg_audit_listings_featured_v15c` (`AFTER UPDATE OF featured_order, is_featured`) logging pin/unpin/reorder mutations into immutable `public.audit_logs`.
- **`public.vehicle_types` (Canonical 5-Tier PnD Fleet Rates Hardened):**
  - Tightened write RLS policies (`INSERT`, `UPDATE`, `DELETE`) strictly to `public.is_super_admin()` (closing the `is_pnd_admin` follow-up) while preserving public `SELECT` where `is_active = true OR public.is_super_admin()`.
  - Attached `trg_audit_vehicle_types_v15c` writing all rate/tier updates into `public.audit_logs`.
- **`public.homepage_items` & `public.popular_localities` (Deterministic Idempotent Seeds):**
  - Added `item_key text` + partial unique index `idx_homepage_items_item_key` on `public.homepage_items`.
  - Seeded idempotently (`ON CONFLICT DO NOTHING`): 15 Shortcut Grid cards (`section = 'shortcut_grid'`), 7 Quick Jump chips (`section = 'quick_jump'`), and 2 Featured Banners (`section = 'featured_banner'`).
  - Seeded idempotently (`ON CONFLICT (slug) DO NOTHING`) Churachandpur hubs into `public.popular_localities` (`lamka-town`, `tuibong`, `new-lamka`, `rengkai`, `zenhang-lamka`, `churachandpur-bazar`).
  - Re-verified `super_admin`-only write RLS and `audit_superadmin_config_change()` audit triggers across `homepage_items`, `popular_localities`, and `categories`.

### 8.2 Revalidation API, Live Hydration, Public Category Icons & `<PhoneInput />` Sweep
- **Cache Revalidation API (`app/api/admin/revalidate-homepage/route.ts`):** Server-authenticated `POST` route verifying Supabase Bearer JWT + `profiles.role === 'super_admin'`, calling `revalidatePath('/')` and `revalidateTag('homepage-config')` automatically on every save in `HomepageBuilder.tsx`.
- **Homepage Builder UI (`components/workspaces/superadmin/HomepageBuilder.tsx`):** Wired into `AdminWorkspace.tsx` under Platform Builders → Homepage Builder with 4 tabs (Shortcut Cards & Quick Jumps with live preview + strict `lib/routes.ts` allowlist picker + Reset Defaults confirmation; Featured Places pin/order + Spotlight Banners; Popular Localities with coordinates/zoom; Pick N Drop 5-Tier Rates editor on `vehicle_types` with disable confirmation).
- **Live Homepage & Explore Hydration:**
  - `lib/home/homepage-config.ts` (`resolveHomepageItemHref`, `buildPopularLocalityExploreHref`, canonical defaults).
  - `app/page.tsx`, `LandingClient.tsx`, and `LandingLaunchpadSections.tsx` render live `homepage_items`, `popular_localities`, `featured_order`-sorted Featured Places, and active `vehicle_types` with safe fallbacks.
  - `lib/routes.ts` (`buildExploreRoute`) + `DiscoveryWorkspace.tsx` support `?lat=...&lng=...&zoom=...&locality=...` direct map panning.
  - `lib/config/server.ts`, `lib/config/types.ts`, `DiscoveryWorkspace.tsx`, and `FilterBar.tsx` fetch and render curated `icon_key` + `accent_color` via `lib/icons/registry.ts` (`getIconByKey`).
- **App-Wide `<PhoneInput />` Sweep:** Upgraded remaining raw `type="tel"` / phone / WhatsApp inputs outside `/admin` (`RealEstateDetailClient`, `BookingFlowClient`, `RestaurantMenuClient`, `ActivityPrintOrdersSection`, `BulletinComposerModal`, `OwnerBookingManager`, `OfficialPrintSwiftManager`, `HubManagerWorkspace`) to standardized `+91` E.164 `<PhoneInput />`.

---

## 9. Pass v15d Preview-First Homepage Builder, Containers & Shared UX Primitives (`20261125_pass_v15d_homepage_containers.sql`)

### 9.1 Database Schema & RLS
- **`public.homepage_containers` (New Table):**
  - Columns: `id uuid PK DEFAULT gen_random_uuid()`, `slug text NOT NULL UNIQUE`, `title text NOT NULL`, `subtitle text`, `icon_key text NOT NULL DEFAULT 'layout-grid'`, `accent_color text NOT NULL DEFAULT '#2563EB'`, `section_group text NOT NULL DEFAULT 'shortcut_grid' CHECK (section_group IN ('shortcut_grid','quick_jump'))`, `sort_order integer NOT NULL DEFAULT 0`, `is_enabled boolean NOT NULL DEFAULT true`, `updated_at timestamptz NOT NULL DEFAULT now()`.
  - Index: `idx_homepage_containers_group_order (section_group, is_enabled, sort_order)`.
  - RLS: Public `SELECT` where `is_enabled = true OR public.is_super_admin()`; `INSERT`/`UPDATE`/`DELETE` strictly `public.is_super_admin()`.
  - Triggers: `trg_homepage_containers_updated_at` (`BEFORE UPDATE`) and `trg_audit_homepage_containers_v15d` (`AFTER INSERT OR UPDATE OR DELETE` → `public.audit_superadmin_config_change()` → `public.audit_logs`).
  - Idempotent Seeds (`ON CONFLICT (slug) DO NOTHING`): `all-services`, `local-commerce`, `logistics-rides`, `stays-venues`, `civic-essential` (`shortcut_grid`) and `quick-jumps` (`quick_jump`).
- **`public.homepage_items` (Extended):**
  - Added nullable FK column `container_id uuid REFERENCES public.homepage_containers(id) ON DELETE SET NULL` plus index `idx_homepage_items_container_order (container_id, sort_order)`.
  - Existing `section` column remains intact for backward compatibility; existing rows idempotently backfilled with matching `container_id`.

### 9.2 Shared Workspace UX Primitives & Real-Time Validators
- **`components/ui/ConfirmDialog.tsx` (`ConfirmDialog`, `useConfirmDialogState`):** In-app confirmation modal (`info` | `warning` | `danger`), caution callout, impact summary list, loading state, and 44px+ touch targets. Zero native browser popups (`window.alert`/`confirm`/`prompt`).
- **`components/ui/FormModal.tsx` (`FormModal`):** Modal-only editor wrapper with collapsible Hints & Cautions slot (`hints`, `cautions`, `hintsSlot`), automatic dirty-state close guard (`<ConfirmDialog variant="warning" />`), real-time validation gating (`isValid` + inline summary), and automatic pre-submit confirmation (`<ConfirmDialog />`).
- **`components/ui/AttributeHintsPopover.tsx` (`AttributeHintsPopover`):** Dynamic reference popover sourcing live routes (`lib/routes.ts`), verticals/attributes (`lib/verticals/filter-catalog.ts`), and live DB `categories` slugs, with 1-click Copy to Clipboard (`Copied` confirmation), Insert Param, and Apply Preset.
- **`components/ui/SortablePreview.tsx` (`useTouchSafeSensors`, `SortablePreviewItem`, `DragHandleButton`, `MobileOrderButtons`, `DroppableContainerZone`):** Touch-safe `@dnd-kit` drag-and-drop helpers (`PointerSensor` 6px distance, `TouchSensor` 180ms hold / 8px tolerance, `KeyboardSensor`) with explicit `⠿` drag handles and accessible Up/Down step buttons.
- **`lib/home/homepage-config.ts`:** Added `HomepageContainerRecord`, `DEFAULT_HOMEPAGE_CONTAINERS`, `inferDefaultContainerSlugForItem`, and real-time validators (`validateHomepageItemDraft`, `validateHomepageContainerDraft`, `validatePopularLocalityDraft`, `REGISTERED_VERTICAL_VALUES`, `REGISTERED_ATTR_VALUES`, `ALLOWED_QUERY_KEYS_BY_ROUTE`).

### 9.3 Navigation, Preview-First Homepage Builder & Live Consumption
- **Header Primary Navigation (`lib/routes.ts`, `components/navigation/Header.tsx`, `components/AppShell.tsx`):** Added **Home (`/`)** as the first primary navigation link across Desktop, Tablet, and Mobile bars/drawers with exact `aria-current="page"` active styling and horizontal scroll overflow handling.
- **Preview-First Homepage Builder (`components/workspaces/superadmin/HomepageBuilder.tsx` & `HomepageBuilderModals.tsx`):**
  - Modal-only Add/Edit across all 4 tabs (`Containers & Shortcuts`, `Banners & Featured`, `Popular Localities`, `Pick N Drop Rates`) with Phase 10 `.dd-shimmer` skeletal loaders.
  - Drag-and-drop sequence ordering for Container Tabs, Shortcut Cards (within and between containers + mobile "Move to Tab" selector), Quick Jumps, Spotlight Banners, Featured Places (`featured_order`), and Popular Localities.
  - Sticky **"Unsaved Sequence Changes"** bar batches all staged order/container changes into a single confirmed save + `POST /api/admin/revalidate-homepage` call, with tab-switch unsaved guard.
- **Live Homepage Hydration (`app/page.tsx`, `components/home/LandingClient.tsx`, `components/home/LandingLaunchpadSections.tsx`):** Queries enabled `homepage_containers` and renders them as interactive homepage tabs displaying their ordered items with safe fallback to `DEFAULT_HOMEPAGE_CONTAINERS`.

---

## 10. Pass v15e Platform Builders Standardization (`20261125_pass_v15e_builder_ordering.sql`)

### 10.1 Database Schema & Ordering Migration (`20261125_pass_v15e_builder_ordering.sql`)
- **`public.categories` (Verified & Indexed):** Ensures `sort_order integer NOT NULL DEFAULT 0` and `is_active boolean NOT NULL DEFAULT true`, backfills deterministic 10-step `sort_order` per `(entity_type, parent_id)` group (respecting legacy `display_order` if present), adds `idx_categories_parent_sort_order (entity_type, parent_id, sort_order ASC, display_name ASC)`, and verifies `super_admin`-only write RLS + `trg_audit_categories_changes`.
- **`public.subscription_plans` & `public.subscription_plan_prices` (Indexed):** Ensures `sort_order integer NOT NULL DEFAULT 0` on both tables, backfills 10-step ordering where `0`, and creates `idx_subscription_plans_sort_order` and `idx_subscription_plan_prices_plan_sort_order`.
- **`public.vehicle_types` (Extended):** Adds `sort_order integer NOT NULL DEFAULT 0` to the canonical 5-tier Pick N Drop fleet rates table, backfills sequential `10..50` ordering by `base_fare_inr ASC` where `0`, adds `idx_vehicle_types_sort_order`, and verifies `super_admin`-only write RLS + `trg_audit_vehicle_types_v15c`.

### 10.2 Renovated Category & Sub-Category Builder (`components/workspaces/superadmin/CategoryBuilder.tsx`)
- Wired into `components/workspaces/AdminWorkspace.tsx` (`categories_icons` tab for `super_admin`).
- **Preview-First Responsive Cards:** Collapsible parent-category preview cards showing curated Lucide icon (`getIconByKey`), accent color badge, monospace slug pill, active/archived status, and live linked-listings counts, with nested sortable sub-category preview rows and mobile horizontal-scroll entity scope tabs (`listing`, `product`, `bulletin`, `vehicle`).
- **Touch-Safe Drag-and-Drop (`SortablePreview`):** Reorder parent categories AND nested sub-categories within their parent (plus accessible Up/Down step buttons) with a sticky **"Unsaved Order Changes (Save Order / Discard)"** bar backed by `<ConfirmDialog />` and entity-switch unsaved guard.
- **Modal-Only Create/Edit (`FormModal`) & Strict Slug Guardrails:**
  - Enforces format `^[a-z0-9]+(?:[-_][a-z0-9]+)*$`, length 2–60 chars, uniqueness per `entity_type`, and blocks reserved slugs (`all`, `admin`, `api`, `explore`, `civic`, `settings`, `workspace`).
  - On Edit, fetches live reference counts across `public.listings`, `public.subscription_plans`, `public.homepage_items`, and `public.payment_feature_policies`. Locks `slug` by default when `totalRefs > 0` and requires an explicit **"Unlock Slug"** action gated by `<ConfirmDialog variant="danger" />`.
  - Supports safe sub-category parent reassignment inside the modal.
  - On Delete, blocks deletion if child sub-categories exist or live `listings` reference that category/sub-category (advising Archive/Disable or Reassignment first); otherwise requires `<ConfirmDialog variant="danger" />`.

### 10.3 Standardized Platform Builders
- **`components/workspaces/superadmin/SubscriptionPlansBuilder.tsx`:** Upgraded from inline workbench + legacy `ConfirmActionModal` to preview-first sortable plan cards (`@dnd-kit` + sticky Save Order bar), `.dd-shimmer` skeletons, modal-only Create/Edit inside `<FormModal />` (strict slug validation, Hints & Cautions, dirty-state guard, confirm-on-submit), and `<ConfirmDialog />` for Activate/Deactivate/Delete.
- **`components/workspaces/superadmin/SubscribersManager.tsx`:** Upgraded to `.dd-shimmer` skeletons, `<FormModal />` per-customer overrides editor (dirty-state guard + soft-freeze Hints & Cautions + confirm-on-submit), `<ConfirmDialog />` confirmations for Quick `+30d` / Activate / Suspend / Cancel, and 44px+ touch targets.
- **`components/workspaces/superadmin/PaymentMethodsMatrix.tsx`:** Upgraded to `.dd-shimmer` skeletons, `<ConfirmDialog />` caution & impact summaries for disabling UPI, disabling Manual, toggling Escrow Required, locking Listing Overrides, and Global UPI Kill-Switch, with 44px+ switch targets across Mobile & Desktop.
- **`components/workspaces/superadmin/HomepageBuilder.tsx` (Tab 4: PnD Fleet Rates) & `app/page.tsx`:** Added touch-safe `@dnd-kit` drag-and-drop `sort_order` sequencing for `vehicle_types` cards wired into the batched **"Unsaved Sequence Changes"** bar, with safe fallback sorting on `app/page.tsx` (`sort_order ASC, base_fare_inr ASC`).

---

## 11. Pass v15f Final Admin Console Standardization & SQL Sync

### 11.1 `v15e` Migration Sync (`20261125_pass_v15e_builder_ordering.sql`)
- Synced repo migration with live Supabase schema by ensuring `ALTER TABLE public.categories` and `ALTER TABLE public.subscription_plans` guard `created_at timestamptz NOT NULL DEFAULT now()` (and `updated_at timestamptz NOT NULL DEFAULT now()` on `subscription_plans`) cleanly via comma-separated `ADD COLUMN IF NOT EXISTS` clauses.
- Updated `ranked_plans` deterministic backfill ordering to `ORDER BY sort_order ASC, updated_at ASC NULLS LAST, id ASC` (avoiding dependency on legacy tables lacking `created_at`).

### 11.2 Standardized Operations, Governance & Data Panels (`/admin` & `MasterControlConsole`)
- **Zero Legacy Modals & Zero Native Popups Across Admin Scope:** Every `/admin` and `MasterControlConsole` panel (`AdminWorkspace`, `SuperAdminPanel`, `UsersDriversManagersTab`, `StaffDelegationManager`, `AuditLogsViewer`, `ListingReviewsPanel`, `PartnerApplicationsPanel`, `AdminBulletinManager`, `CivicDirectoryManager`, `PickNDropConsole`, `UnifiedPaymentsQueue`, `FeaturedPlacementsPanel`, `ReferralsTrackingPanel`, `BrandOfficeLegalTab`, `BannersOffersTab`, `PricingSubsPromosTab`, `NestedCategoriesTab`, `ComposablePlanBuilderSection`, `HubsAndRatesTab`) is standardized on `v15d` `<ConfirmDialog />` (`useConfirmDialogState`), `<FormModal />`, `.dd-shimmer` skeletal loaders, and `44px+` touch targets.
- **Required Reason Notes & Destructive Safeguards:** Reject/Request Changes in `AdminWorkspace` & `ListingReviewsPanel`, Takedown/Reject in `AdminBulletinManager`, Reject Payment in `UnifiedPaymentsQueue`, Reject Citizen Report in `CivicDirectoryManager`, and Hide/Action Content in `AdminWorkspace` Moderation strictly require a non-empty reason note (`>= 4` chars) before confirmation.
- **Role Governance Immutability & Mobile Cards:** `SuperAdminUsersRolesSection`, `UsersDriversManagersTab`, and `SuperAdminGovernanceSection` lock `super_admin` rows with `"Managed via SQL migration only"`, gate all role grants (`warning`), demotions (`danger`), and driver KYC actions behind `<ConfirmDialog />`, and render responsive mobile stacked cards (`md:hidden`) alongside desktop tables.
- **CSV Import Preview Gate & System Health Readiness (`AdminWorkspace` & `SuperAdminSystemAuditSection`):**
  - Uploading a CSV parses and validates rows into an interactive **CSV Import Preview Summary Card** (`data-testid="csv-import-preview-card"`) showing valid row count, validation warnings, and sample rows, gating Supabase writes behind `<ConfirmDialog variant="warning" />`.
  - `SuperAdminSystemAuditSection` renders a **System Readiness & Launch Health** card (`data-testid="superadmin-system-readiness-card"`) surfacing `NEXT_PUBLIC_ENABLE_DEMO_AUTH` status (warning badge if `'true'`), live pending moderation queue counts (`listings`, `partner_applications`, `bulletins`, `delivery_orders`), and a 48-hour POD `pg_cron` verification checklist.

### 11.3 Command Center Telemetry, Responsive Navigation & UX Refinements (`20261125_pass_v15f_command_center_telemetry.sql`)
- **Telemetry Ledger (`public.app_analytics_events`):**
  - Privacy-safe, PII-free event table (`id uuid PK`, `event_type text` CHECK IN `('page_view','listing_click','shortcut_click','search_query','whatsapp_click','enquiry_submit','pnd_quote','booking_create','escrow_verified','bulletin_view')`, `feature_area`, `target_id`, `root_key`, `locality`, `session_hash`, `user_id`, `device_type`, `created_at`) with indexes `(created_at DESC, event_type)`, `(feature_area, created_at DESC)`, and `(session_hash, created_at DESC)`.
  - RLS: `SELECT` strictly restricted to `admin`/`super_admin` (`public.is_pnd_admin(auth.uid())`); `INSERT` permitted for `anon`/`authenticated` without `user_id` spoofing; `UPDATE`/`DELETE` revoked from client roles.
- **Metrics RPC & Retention Cron:**
  - `public.get_command_center_metrics(p_days integer DEFAULT 30) RETURNS jsonb` (`SECURITY DEFINER`, gated strictly to `public.is_pnd_admin(auth.uid())`) aggregates live KPIs, daily traffic/clicks/transactions series, 4-pillar transaction breakdown (`pick_n_drop`, `vehicles`, `subscriptions_bulletins`, `marketplace_leads`), feature traffic distribution, discovery-to-booking funnel, top shortcuts & localities, and 48h POD purge readiness.
  - `public.purge_old_app_analytics_events(p_retention_days integer DEFAULT 90)` (`SECURITY DEFINER`, `service_role` only) + conditional `pg_cron` daily job `ddoodle_purge_analytics_events_90d` (`0 3 * * *`).
- **Telemetry Ingestion API & Non-Blocking Client (`app/api/telemetry/track/route.ts`, `lib/analytics/track.ts`):**
  - `POST /api/telemetry/track` validates strict `event_type`/`device_type` allow-lists, enforces 4 KB payload cap, redacts accidental emails/phone numbers, SHA-256 hashes anonymous session tokens, and derives `user_id` only from a verified Bearer JWT if present.
  - `trackAppEvent()` uses `navigator.sendBeacon` with `fetch(..., { keepalive: true })` fallback across `AppShell`, `LandingLaunchpadSections`, `LandingClient`, `EnquiryForm`, `PickNDropPanel`, `VehicleDetailClient`, and listing/WhatsApp clicks.
- **Command Center Dashboard (`components/workspaces/superadmin/CommandCenterOverview.tsx`):**
  - Replaces legacy overview cards & removes `<SuperAdminGovernanceSection />` (Users management stays exclusively in `People & Governance → Users & Roles`).
  - Renders `7d / 30d / 90d` selector, 4 live KPI cards with direct queue jumps, Recharts `AreaChart` (Daily Visits & Clicks), Stacked `BarChart` (Transactions by Pillar), Donut `PieChart` (Feature Traffic Distribution), Horizontal Funnel `BarChart`, Top Shortcuts/Localities lists, and compact System Health Strip.
- **Responsive Superadmin Navigation (`components/workspaces/superadmin/SuperadminNavShell.tsx`):**
  - Mobile (`< md`): Dual horizontally scrollable tab strips (Row 1: 5 main groups; Row 2: nested child tabs), `44px+` touch targets, zero `<select>` dropdowns.
  - Tablet (`md` to `< lg`): Unified nested collapsible sidebar defaulting to collapsed icon-only (`w-16`) with tooltips, expandable in-place to `w-64` (replaces modal slide-over rail).
  - Desktop (`lg+`): Unified nested collapsible sidebar defaulting to expanded (`w-64`), collapsible to `w-16`.
- **Global Touched/Pre-Submit Validation & Homepage Builder Cleanups:**
  - `FormModal.tsx` exports `useFormModalValidation()` + `onSubmitAttempt` and gates validation summary banners and per-field inline errors across `CategoryBuilder`, `SubscriptionPlansBuilder`, `HomepageBuilderModals`, `SubscribersManager`, `AdminBulletinManager`, and `AdminWorkspace` strictly on field blur/change (`touched`) OR Submit click (`submitAttempted`) — zero premature red errors on fresh modal open.
  - `HomepageBuilder.tsx` & `HomepageBuilderModals.tsx` hide default `all-services` container from Superadmin CRUD while `LandingLaunchpadSections.tsx` guarantees an automatic `"All"` aggregate tab first on the live homepage.
  - Removed `icon_key` picker & icon badges from Popular Localities across `HomepageBuilderModals`, `HomepageBuilder`, `LandingLaunchpadSections`, and `LandingClient`.

---

## 12. Pass v16a Unified Map Coordinate Picker, Hold-to-Copy & Pick N Drop Map UX

### 12.1 Shared Coordinate & Projection Utilities (`lib/maps/coordinates.ts`)
- Centralizes `CHURACHANDPUR_FALLBACK_CENTER` (`24.3335, 93.6946`), `HIGH_ACCURACY_GPS_OPTIONS` (`enableHighAccuracy: true, maximumAge: 0, timeout: 10000`), `roundCoord`, `normalizeLatLng`, `formatCoordinates` (6-decimal `lat, lng`), `copyTextToClipboard` (Clipboard API with textarea fallback), `validateLatLngStrings` (for touched/blur/submit validation), `computePolygonGeometry` (`@turf/turf` area in sq. m / sq. ft / acres / Sangam, perimeter, centroid), `resolvePixelOffsetLatLng` (Web Mercator pixel-offset coordinate projection for dock-compensated crosshairs), and `resolveClientPointToLatLng` (pixel-accurate screen-to-map lat/lng resolution).

### 12.2 Unified `<MapCoordinatePicker />` (`components/maps/MapCoordinatePicker.tsx`)
- Canonical shared coordinate picker component (re-exported via `components/workspaces/shared/MapCoordinatePicker.tsx` for backward compatibility) supporting two explicit modes:
  - **`mode="point"`:** Centered visual crosshair pin (`50% / 50%` tip anchor) committing exact `{ lat, lng }` on map `idle` (never overwritten by reverse-geocoding), high-accuracy GPS locate button with Churachandpur fallback, quick-jump locality selector (`hubLocalities` + custom presets), exact 6-decimal readout with 1-click Copy button, manual lat/lng (+ optional zoom) inputs validated strictly on touch/blur/submit, touch-safe mobile canvas (`touch-none`, `gestureHandling="greedy"`), and tablet/desktop expandable portal modal.
  - **`mode="polygon"`:** Interactive Land Boundary editor integrating `terra-draw` + `terra-draw-google-maps-adapter` (`TerraDrawPolygonMode`, `TerraDrawSelectMode`) + `@turf/turf` live sq. ft / sq. m / Sangam / acres / perimeter / centroid readouts, `+ Starter 4-Corner Box`, history-backed `Undo`, and `Clear Boundary` gated via `<ConfirmDialog variant="warning" />` (ZERO native popups), with interactive fallback when Google Maps JS is unavailable.
- **Wired Across All 11 Coordinate Forms & Modals:**
  1. `components/map/LocationPickerModal.tsx` (used by `/settings` and Explore location selectors; `app/settings/page.tsx` also upgraded to `HIGH_ACCURACY_GPS_OPTIONS`)
  2. `components/workspaces/superadmin/HomepageBuilderModals.tsx` (`LocalityFormModal` — Popular Localities)
  3. `components/workspaces/shared/ListingEditorModal.tsx` (Vendor & Admin listing editor — point + real estate polygon)
  4. `components/workspaces/real-estate/OwnerRealEstateManager.tsx` (Real Estate parcel editor — point + polygon)
  5. `components/workspaces/civic/CivicDirectoryManager.tsx` (Civic Directory editor)
  6. `components/workspaces/AdminWorkspace.tsx` (Admin Geography tab)
  7. `components/workspaces/master-control/BrandOfficeLegalTab.tsx` (Brand / Office coordinates)
  8. `components/workspaces/master-control/TaxonomyGeofenceTab.tsx` (Geofence map center + Add Locality form)
  9. `components/workspaces/master-control/HubsAndRatesTab.tsx` (Service Hub map center & default zoom)
  10. `components/workspaces/print/OfficialPrintSwiftManager.tsx` (Official PrintSwift store coordinates)

### 12.3 `/explore` Hold-to-Copy Coordinates & Pick N Drop Map UX Polish
- **Hold-to-Copy Coordinates (`MapLongPressMenu.tsx`, `DiscoveryWorkspace.tsx`):**
  - Long-press (mobile/tablet) or right-click (desktop) on the `/explore` map resolves pixel-accurate coordinates (`resolveClientPointToLatLng`) and presents **"Copy Coordinates"** (`data-testid="long-press-copy-coords-btn"`) alongside Pin A, Pin B, and Directions.
  - Copies exact 6-decimal `lat, lng` via `copyTextToClipboard()`, displays a non-blocking toast (`data-testid="map-copy-coords-toast"`), and suppresses trailing click events (`suppressNextMapClickAfterLongPressRef` + `onClickCapture`) so finger lift never triggers an unintended listing card open.
- **Pick N Drop Dual-Pin Persistence, Crosshair Accuracy, Routing Loading & Top-Layer Hints (`PickNDropCrosshairPicker.tsx`, `PickNDropRouteLayer.tsx`, `PickNDropPanel.tsx`, `MapJourneyStudio.tsx`, `DiscoveryWorkspace.tsx`):**
  - **Dual-Pin Persistence:** Point A stays visibly anchored while selecting B, and Point B stays visible while re-editing A; 1-tap switching via dock pills or marker taps pans smoothly to the active pin without clearing the opposite pin.
  - **Pixel-Accurate Tip & GPS:** Crosshair pin tip is anchored at exact `(50%, 50% + verticalOffsetPx)` compensated for the bottom dock via Web Mercator projection (`resolvePixelOffsetLatLng`); GPS locate uses `HIGH_ACCURACY_GPS_OPTIONS`, and reverse-geocoding updates only human-readable labels without mutating exact coordinates.
  - **Routing Loading & Recovery:** `PickNDropRouteLayer` prefers modern `Route.computeRoutes` (with `DirectionsService` and road-graph fallbacks), shows a non-blocking `"Calculating route & live fare..."` pill (`data-testid="pnd-routing-loading-pill"`), renders `.dd-shimmer` fare placeholders in `PickNDropPanel` and `MapJourneyStudio`, and surfaces an inline Retry banner (`data-testid="pnd-routing-error-recovery"`) on route/quote errors.
  - **Top-Layer Non-Blocking Guidance:** Crosshair instruction hints render in a fixed top-safe overlay (`z-[70]`) with `pointer-events-none` on wrapper/card and `pointer-events-auto` strictly on dismiss buttons, paired with `fitBounds` top padding (`116px`) so pins and routes never collide with HUD overlays.

---

## 13. Pass v16b 3-Level Fixed-Root Category Taxonomy & Interconnected Inheritance (`20261125_pass_v16b_three_level_category_taxonomy.sql`)

### 13.1 3-Level Materialized Hierarchy on `public.categories`
- **Columns Added/Normalized (`public.categories`):**
  - `root_key text NOT NULL` — canonical Level-1 System Root identifier inherited automatically by all Level-2 and Level-3 descendants.
  - `depth smallint NOT NULL CHECK (depth BETWEEN 1 AND 3)` — 1-indexed depth (`1` = Fixed System Root, `2` = Sub-Category, `3` = Leaf Sub-Category).
  - `path_ids uuid[] NOT NULL DEFAULT '{}'` — materialized ancestor-to-self UUID array (`[root_id]`, `[root_id, l2_id]`, `[root_id, l2_id, l3_id]`) with a GIN index (`idx_categories_path_ids_gin`) and `(root_key, depth, sort_order)` index.
  - `is_system_root boolean NOT NULL DEFAULT false` — marks the **11 locked Level-1 System Roots**.
  - `description text`, `icon_key text`, `accent_color text`, `sort_order int NOT NULL DEFAULT 0`, `is_active boolean NOT NULL DEFAULT true`.
  - `parent_id uuid REFERENCES public.categories(id) ON DELETE RESTRICT` (blocks accidental cascade deletion of parents that still have child categories).
- **11 Locked Level-1 System Roots (`depth = 1, is_system_root = true, parent_id IS NULL`):**
  - **8 Directory Listing Verticals (`entity_type = 'listing'`):**
    1. `general` (*General Business & Services*)
    2. `shop_catalogue` (*Retail & Local Shop Catalogue*)
    3. `restaurant_food` (*Restaurants, Cafés & Bakeries*)
    4. `print_digital` (*Print, Copy & Digital Services*)
    5. `real_estate` (*Real Estate & Land Plots*)
    6. `hotel_stay` (*Hotels, Homestays & Lodging*)
    7. `booking_venue` (*Sports & Venue Bookings*)
    8. `public_civic` (*Public & Civic Institutions*)
  - **3 Platform Entity Roots:**
    9. `marketplace` (`entity_type = 'product'`, *Marketplace & Shop Products*)
    10. `bulletin` (`entity_type = 'bulletin'`, *Community Bulletins & Notices*)
    11. `vehicles` (`entity_type = 'vehicle'`, *Fleet & Vehicle Rentals*)
- **Database Guardrails & Materialized Path Triggers:**
  - `public.trg_categories_enforce_hierarchy()` (`BEFORE INSERT OR UPDATE OR DELETE`):
    - Blocks `DELETE` on any `is_system_root = true` row (`depth = 1`) and blocks deleting any category that has child categories or referencing `listings`.
    - Blocks mutating `root_key`, `slug`, `entity_type`, `parent_id`, `depth`, or `is_system_root` on Level-1 System Roots from `anon`/`authenticated` sessions (while permitting `display_name`, `description`, `icon_key`, `accent_color`, `sort_order`, and `is_active` updates by `super_admin`).
    - Automatically computes `depth` (`parent.depth + 1`, max `3`), inherits `root_key` and `entity_type` from the parent, blocks cross-root moves (`NEW.root_key <> OLD.root_key`), blocks demoting an L2 category that already has L3 children, and populates `path_ids = parent.path_ids || NEW.id`.
  - `public.trg_categories_cascade_descendant_paths()` (`AFTER UPDATE OF parent_id, path_ids, depth, root_key`): cascades updated `depth`, `root_key`, and `path_ids` to L3 children when an L2 node is moved within the same root.
  - RLS: Public `SELECT`; `INSERT`/`UPDATE`/`DELETE` strictly restricted to `public.is_super_admin()` with `public.audit_logs` triggers attached.

### 13.2 Interconnected Tables, Triggers & Helper RPCs
- **`public.listings` Sync Trigger (`trg_listings_sync_category_taxonomy`):**
  - Adds `root_key text` to `public.listings` and automatically synchronizes `root_key`, `listing_vertical`, and `subcategory` from `categories` whenever `category_id`, `listing_vertical`, or `subcategory` is inserted or updated.
- **`public.subscription_plans` Hierarchical Category Scope:**
  - Adds `applicable_category_ids uuid[] NOT NULL DEFAULT '{}'` and `applicable_root_keys text[] NOT NULL DEFAULT ARRAY['*']` alongside backward-compatible `applicable_categories` / `applicable_subcategories` slug arrays.
- **Helper RPCs & Upgraded Resolution Functions:**
  - `public.get_category_descendant_ids(p_category_id uuid) RETURNS uuid[]` — returns all categories whose `path_ids` contain `p_category_id`.
  - `public.category_matches_plan_scope(p_category_id uuid, p_plan_id uuid) RETURNS boolean` — evaluates `path_ids && applicable_category_ids` or `root_key = ANY(applicable_root_keys)` so selecting a Root or Level-2 category automatically covers all sub-categories underneath it.
  - `public.get_effective_entitlements(p_user_id uuid, p_listing_id uuid DEFAULT NULL) RETURNS jsonb` — returns `allowed_root_keys` and `allowed_category_ids` in addition to `allowed_listing_types` and feature limits.
  - `public.resolve_effective_payment_methods(p_scope_key text, p_listing_id uuid DEFAULT NULL) RETURNS jsonb` — resolves any L2/L3 category slug, category UUID, or `p_listing_id` upward to its Level-1 `root_key` before evaluating Layer 1 (`payment_feature_policies`), Layer 2 (`online_payment.enabled`), and Layer 3 (`listings.payment_mode`).

## 14. Pass v17a User-Suggested Leaf Categories, Validation Standard & Master Console Refinements (`20261125_pass_v17a_user_suggested_leaf_categories.sql`)

### 14.1 User-Suggested Leaf Categories on `public.categories`
- **Columns Added (`public.categories`):**
  - `review_status text NOT NULL DEFAULT 'official' CHECK (review_status IN ('official', 'pending_review', 'merged', 'rejected'))` — separates official directory taxonomy from user-suggested leaf categories awaiting Superadmin moderation.
  - `suggested_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL` — tracks the authenticated owner who suggested a leaf category.
  - `merged_into_category_id uuid NULL REFERENCES public.categories(id) ON DELETE SET NULL` — records the canonical official target when a duplicate suggestion is merged.
  - `review_notes text NULL` — optional Superadmin review/audit note recorded on approve, relink, merge, or reject.
- **Indexes:**
  - `idx_categories_review_status_pending` (`(review_status, created_at DESC) WHERE review_status = 'pending_review'`)
  - `idx_categories_suggested_by_pending` (`(suggested_by, review_status) WHERE review_status = 'pending_review'`)
- **Updated RLS (`categories_public_read`):**
  - Public (`anon` / `authenticated`) sees rows where `(is_active = true AND review_status = 'official')`.
  - Suggesting user (`suggested_by = auth.uid()`) also sees their own `pending_review` rows so they can immediately attach and submit listings unblocked.
  - `super_admin` / `admin` sees all rows across every `review_status`.
  - Server config (`lib/config/server.ts`) additionally filters `review_status === 'official'` defensively before populating public `categoriesFlat`.

### 14.2 RPCs (`SECURITY DEFINER`, `public.audit_logs` Integrated)
- **`public.suggest_leaf_category(p_parent_id uuid, p_name text) RETURNS jsonb`:**
  - Authenticated users only (`auth.uid() IS NOT NULL`).
  - Validates `p_name` (2–60 chars), verifies `p_parent_id` is an active `'official'` category at `depth IN (1, 2)` (resulting leaf lands strictly at `depth = 2` or `depth = 3` within the parent's immutable `root_key`).
  - Case-insensitive duplicate check under the same parent/entity returns existing official or pending row cleanly instead of creating duplicates; enforces max 5 `pending_review` suggestions per user.
  - Inserts `review_status = 'pending_review'`, `is_active = false`, `suggested_by = auth.uid()`, and returns `{ created, already_existed, category }`.
- **`public.review_suggested_category(p_category_id uuid, p_action text, p_display_name text DEFAULT NULL, p_slug text DEFAULT NULL, p_icon_key text DEFAULT NULL, p_accent_color text DEFAULT NULL, p_parent_id uuid DEFAULT NULL, p_review_notes text DEFAULT NULL) RETURNS jsonb`:**
  - Strictly `public.is_super_admin()` gated.
  - `'approve'`: optionally updates label, slug, icon, accent color, and re-parents strictly within the same `root_key` (depth 1..2 parent), promotes to `review_status = 'official'`, `is_active = true`, syncs referencing `listings.subcategory`, and writes `public.audit_logs`.
  - `'reject'`: marks `review_status = 'rejected'`, `is_active = false`, safely reassigns referencing `listings` back to the official `parent_id` (zero listing loss), and writes `public.audit_logs`.
- **`public.merge_suggested_category(p_source_id uuid, p_target_id uuid, p_review_notes text DEFAULT NULL) RETURNS jsonb`:**
  - Strictly `public.is_super_admin()` gated.
  - Atomically reassigns referencing `listings` (`category_id`, `subcategory`, `root_key`, `listing_vertical`) and `marketplace_products` to `p_target_id` (active `'official'` target of matching `entity_type`), marks source `'merged'`, `is_active = false`, `merged_into_category_id = p_target_id`, and writes `public.audit_logs`.

### 14.3 Master Console Sidebar, Validation Timing & Featured List DnD
- **Sidebar (`SuperadminNavShell.tsx`):** Independently scrollable viewport-height rail (`h-[calc(100dvh-5.5rem)]`, `overflow-y-auto`), sticky collapse header (`sticky top-0 z-10`), and full `var(--ps-*)` theme token parity across Desktop, Tablet, and Mobile.
- **Validation Standard (`FormModal.tsx` & v17a forms):** Field-level errors appear only after field interaction (`touched`/`blur`) and clear immediately when valid; full-form validation summary runs strictly on submission attempt (`submitAttempted`) before `<ConfirmDialog />`.
- **Featured List DnD (`FeaturedPlacementsPanel.tsx`):** Replaced hardcoded numeric `priority` input and static table with draggable live preview cards (`SortablePreview` + `MobileOrderButtons`) grouped by section with sticky batched `Save Order` persistence.

## 15. Pass v17b Unified Subscriptions Overhaul, Default Free Baseline, Free Trials, Targeted Plans & Customer-Facing Capability Gates (`20261125_pass_v17b_unified_subscriptions_and_customer_gates.sql`)

### 15.1 Schema Upgrades on `public.subscription_plans`, `public.profiles` & `public.user_subscriptions`
- **`public.subscription_plans` New Columns & Guardrails:**
  - `is_default_free boolean NOT NULL DEFAULT false` — enforced by partial unique index `idx_subscription_plans_single_default_free` (`WHERE is_default_free = true`) guaranteeing exactly ONE canonical **Default Free Tier** (`slug = 'default-free-tier'`).
  - `trial_days integer NOT NULL DEFAULT 0 CHECK (trial_days >= 0 AND trial_days <= 365)` — configurable free trial duration per plan.
  - `auto_trial_on_approval boolean NOT NULL DEFAULT false` — when `true`, automatically starts a trial upon `partner_applications` approval for eligible users.
  - `target_scope text NOT NULL DEFAULT 'public' CHECK (target_scope IN ('public', 'selected_users'))` & `target_user_ids uuid[] NOT NULL DEFAULT '{}'` (GIN-indexed via `idx_subscription_plans_target_user_ids`) — enables private/invite-only plans visible strictly to targeted `auth.uid()` users and `super_admin`.
  - `is_archived boolean NOT NULL DEFAULT false` — hides legacy/redundant plans (e.g. archived `General Business`) without breaking historical `user_subscriptions` FK integrity.
  - `trg_guard_default_free_plan_v17b` (`BEFORE INSERT OR UPDATE OR DELETE`): prevents deleting, archiving, or deactivating the Default Free Tier and keeps `entitlements.staffing.max_staff` and `entitlements.staffing.limit` synchronized.
- **Unified `entitlements` JSONB Extensions:**
  - `staffing: { enabled: boolean, limit: number | null, max_staff: number | null }` (explicit staff seat quota enforced in builder + entitlements resolver).
  - `auto_verify_listings: boolean` and `auto_verify_bulletins: boolean` (default `false` on Default Free Tier; server-side enforced via `BEFORE INSERT` triggers on `public.listings` and `public.bulletins`).
- **Updated RLS on `public.subscription_plans` & `public.subscription_plan_prices`:**
  - `super_admin` sees and manages all rows (including archived and `selected_users`).
  - `anon` sees only `is_active = true AND is_archived = false AND target_scope = 'public'`.
  - `authenticated` sees public active plans PLUS `target_scope = 'selected_users' AND auth.uid() = ANY(target_user_ids)`.
- **Single-Trial Integrity (`public.profiles` & `public.user_subscriptions`):**
  - Added `profiles.trial_used_at timestamptz NULL` to guarantee one free trial per account unless explicitly reset by a `super_admin`.
  - Ensured `user_subscriptions.status` CHECK constraint accepts `'trialing'` alongside `'active'`, `'expired'`, `'cancelled'`, and `'pending'`.

### 15.2 RPCs & Server-Side Enforcement Triggers
- **`public.start_plan_trial(p_plan_id uuid) RETURNS jsonb` (`SECURITY DEFINER`, `SET search_path = public`):**
  - Requires `auth.uid() IS NOT NULL`; locks `profiles` row `FOR UPDATE` to prevent double-trial race conditions; checks `trial_used_at IS NULL`, active/non-archived plan with `trial_days > 0`, and `selected_users` target authorization; inserts `user_subscriptions (status = 'trialing', expires_at = now() + trial_days)`, stamps `profiles.trial_used_at = now()`, and writes `public.audit_logs`.
- **`public.reset_user_trial_eligibility(p_user_id uuid) RETURNS jsonb` (`SECURITY DEFINER`):**
  - Strictly `public.is_super_admin()` gated; clears `profiles.trial_used_at = NULL` and records `public.audit_logs`.
- **`trg_partner_approval_auto_trial_v17b` on `public.partner_applications`:**
  - When status transitions to `'approved'`, checks for an eligible matching `auto_trial_on_approval = true` plan for users with `trial_used_at IS NULL` and grants a `'trialing'` subscription automatically.
- **`public.get_effective_entitlements(p_user_id uuid, p_listing_id uuid DEFAULT NULL) RETURNS jsonb`:**
  - Dynamically inherits live limits from the canonical `is_default_free = true` row as baseline, merges active AND `'trialing'` subscriptions (taking `GREATEST` / `NULL = unlimited` for numeric quotas including `staffing.max_staff` and `OR` for booleans including `auto_verify_listings` / `auto_verify_bulletins`), and preserves `v16b` `allowed_root_keys` / `allowed_category_ids`.
- **`public.get_listing_public_capabilities(p_listing_id uuid) RETURNS jsonb` (`SECURITY DEFINER`):**
  - Privacy-safe public resolver returning strictly non-sensitive booleans: `{ can_pay_upi, can_pay_manual, escrow_required, can_book_online, can_order_print, can_dispatch_pnd, can_show_360, can_show_marketplace, has_auto_verified, is_owner_plan_active }` — zero owner plan names, prices, expiry dates, or billing PII exposed.
- **Auto-Verify Triggers (`trg_listings_auto_verify_v17b`, `trg_bulletins_auto_verify_v17b`) & Bulletin Quota:**
  - Automatically sets initial status to `'approved'` / `'published'` on insert when the user's effective entitlements include `auto_verify_listings` / `auto_verify_bulletins`, while preserving Admin/Superadmin overrides (`moderation_status` / `status`).
  - Upgraded `enforce_bulletin_quota()` to treat `'trialing'` subscriptions identically to `'active'` while keeping Pay-Per-Post pass fallback intact.

### 15.3 Master Console & Customer-Facing Surface Integration
- **Master Console (`SubscriptionPlansBuilder.tsx`, `TargetUsersPicker.tsx`, `SubscribersManager.tsx`):**
  - Pinned **Default Free Tier** baseline editor at top (protected from delete/archive/deactivate; ₹0 locked), `"Show Archived"` toggle, Target Audience picker (`Public` vs `Selected Individuals` role-filtered search), Free Trial controls, Staffing Seat Quota input, Auto-Verify toggles with moderation caution callout, and `Trialing` subscriber management (`+7d Trial`, `Convert`, `Suspend`, `Reset Trial`) via `<ConfirmDialog />`.
- **Customer-Facing Capability Gates (`lib/subscriptions/public-capabilities.ts`, `app/listing/[id]/page.tsx`, `ShopStorefrontClient.tsx`, `RestaurantMenuClient.tsx`, `BulletinComposerModal.tsx`):**
  - Listing detail dynamically gates 360° viewer, Pick N Drop dispatch CTAs, Online Print/Booking/Hotel/Shop actions, and UPI vs Manual counter payment rails via `get_listing_public_capabilities()` while preserving basic discovery info, contact details, map pin, reviews, and enquiries.
  - `/bulletin?plans=1` hides Default Free & archived tiers, displays `"Special Plan for You"` badges on targeted plans, and enables 1-click Free Trial activation via `<ConfirmDialog />` + `start_plan_trial`.

---

## 16. Pass v17c Pay-Per Monetization Engine — Marketplace, Bulletin & Real Estate (`20261125_pass_v17c_pay_per_monetization.sql`)

### 16.1 Configurable Pay-Per Pricing Rules (`public.pay_per_pricing_configs`)
- **Columns & Constraints:**
  - `module_key text PRIMARY KEY CHECK (module_key IN ('marketplace_item','bulletin_post','real_estate_sale','real_estate_rent'))`
  - `label text NOT NULL`
  - `is_enabled boolean NOT NULL DEFAULT true`
  - `duration_slabs jsonb NOT NULL DEFAULT '[]'::jsonb` — array of `{ id, label, days, price_inr, is_popular? }`
  - `addons jsonb NOT NULL DEFAULT '[]'::jsonb` — array of `{ id, label, price_inr, description? }`
  - `price_bands jsonb NOT NULL DEFAULT '[]'::jsonb` — Real Estate property value tiers: `{ id, label, min_price_inr, max_price_inr, fee_inr }`
  - `area_bands_sqft jsonb NOT NULL DEFAULT '[]'::jsonb` — Real Estate land/plot area tiers normalized to `sq.ft`: `{ id, label, min_sqft, max_sqft, fee_inr }`
  - `min_cap_inr integer NOT NULL DEFAULT 0 CHECK (min_cap_inr >= 0)` & `max_cap_inr integer CHECK (max_cap_inr IS NULL OR max_cap_inr >= min_cap_inr)`
  - `updated_at timestamptz NOT NULL DEFAULT now()`, `updated_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL`
- **RLS & Audit Trail:**
  - Public `SELECT` (`anon`, `authenticated`); `INSERT / UPDATE / DELETE` strictly restricted to `public.is_super_admin()`.
  - `trg_audit_pay_per_pricing_configs_v17c`, `submit_pay_per_order`, and `review_pay_per_order` log all events to `public.audit_logs` using canonical columns `(actor_id, actor_role, workspace, action, target_table, target_id, details, metadata)`.
- **Manipur / Churachandpur Land Area Conversion Standards (`lib/monetization/pay-per.ts` & SQL RPC):**
  - `1 sq.m (sqm)` = `10.7639104 sq.ft`
  - `1 acre` = `43,560 sq.ft`
  - `1 sangam` = `0.625 acre` = `27,225 sq.ft`

### 16.2 Pay-Per Orders Ledger (`public.pay_per_orders`) & Active Window Columns
- **`public.pay_per_orders` Columns & Constraints:**
  - `id uuid PRIMARY KEY DEFAULT gen_random_uuid()`
  - `user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE`
  - `module_key text NOT NULL REFERENCES public.pay_per_pricing_configs(module_key)`
  - `target_table text NOT NULL CHECK (target_table IN ('marketplace_items','marketplace_products','bulletins','listings'))`
  - `target_id uuid NOT NULL`
  - `duration_days integer NOT NULL CHECK (duration_days BETWEEN 1 AND 365)`
  - `quote_breakdown jsonb NOT NULL DEFAULT '{}'::jsonb`
  - `amount_inr integer NOT NULL CHECK (amount_inr >= 0)`
  - `payment_method text NOT NULL CHECK (payment_method IN ('upi','manual'))`
  - `upi_utr_ref text NULL` — guarded by partial `UNIQUE` index `idx_pay_per_orders_unique_active_utr` on `upper(trim(upi_utr_ref))` `WHERE upi_utr_ref IS NOT NULL AND status IN ('pending_verification','paid')` to block duplicate active UTR replay
  - `status text NOT NULL DEFAULT 'pending_verification' CHECK (status IN ('pending_verification','paid','rejected','expired'))`
  - `rejection_reason text`, `reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL`, `reviewed_at timestamptz`, `starts_at timestamptz`, `ends_at timestamptz`, `created_at timestamptz`, `updated_at timestamptz`
- **Active Pay-Per Window Stamp (`paid_until timestamptz`):**
  - Added `paid_until timestamptz NULL` (`IF NOT EXISTS`) on `public.marketplace_products` (and `public.marketplace_items` if present), `public.bulletins`, and `public.listings`.
- **RLS:** Users `SELECT` and `INSERT` only their own orders (`auth.uid() = user_id`); `super_admin` has full read/write access.

### 16.3 Canonical Quote & Order Lifecycle RPCs (`SECURITY DEFINER`, `SET search_path = public`)
- **`public.calculate_pay_per_quote(p_module_key, p_duration_days, p_property_price_inr, p_area_value, p_area_unit, p_addon_ids) RETURNS jsonb`:**
  - Deterministically computes `{ base_slab_inr, price_band_inr, area_band_inr, addons_inr, normalized_area_sqft, min_cap_inr, max_cap_inr, total_inr }` from `public.pay_per_pricing_configs`.
- **`public.submit_pay_per_order(...) RETURNS jsonb`:**
  - Requires `auth.uid() IS NOT NULL`; verifies caller owns the target row in `marketplace_products`, `bulletins`, or `listings`; re-computes `calculate_pay_per_quote` server-side (never trusting client totals); validates `upi_utr_ref` (`8–32` alphanumeric chars) when `p_payment_method = 'upi'`; inserts `public.pay_per_orders` (`status = 'pending_verification'`); and writes `public.audit_logs`.
- **`public.review_pay_per_order(p_order_id uuid, p_decision text, p_rejection_reason text DEFAULT NULL) RETURNS jsonb`:**
  - Strictly `public.is_super_admin()` gated; on `'approve'`, marks order `'paid'`, stamps `starts_at = now()` and `ends_at = now() + duration_days`, activates the target record (`marketplace_products.is_active = true`, `bulletins.status = 'published'`, `listings.status = 'approved'`, plus `paid_until = ends_at` and `featured = true` when a featured add-on was purchased); on `'reject'`, requires `length(trim(p_rejection_reason)) >= 4`; writes `public.audit_logs`.

### 16.4 Master Console Studio & Seamless Owner Creation Handoffs
- **Master Console (`components/workspaces/superadmin/PayPerMonetizationStudio.tsx` under `Platform Builders` in `AdminWorkspace.tsx`):**
  - 4 views: `Marketplace Products`, `Bulletin Posts`, `Real Estate (Sale & Rent)` (with built-in **Live Quote Simulator** supporting `sqft`, `sqm`, `acre`, `sangam`), and `Pay-Per Orders Queue` (`<ConfirmDialog />`-gated Approve & Activate + `<FormModal />` Reject with required reason).
- **Reusable `<PayPerCheckoutModal />` (`components/monetization/PayPerCheckoutModal.tsx`) & Creation Flows:**
  - Wired into `MarketplaceCatalogueManager.tsx`, `BulletinComposerModal.tsx`, and `ListingEditorModal.tsx` (`vertical === 'real_estate'`), showing `"Included in your [Plan Name] (X remaining)"` when within plan quota and seamlessly launching `<PayPerCheckoutModal />` when quota is reached or Pay-Per Pass is chosen.

---

## 17. Pass v18a Owner & Delegated Staff Workspace Shell, Active-Status Staff RLS Parity, Server-Side `max_staff` Quota & Workspace Summary RPC (`20261126_pass_v18a_owner_staff_rls_and_quotas.sql`)

### 17.1 Active-Status Delegated Staff RLS Parity (Closes Phase 13-C Gap)
- **`public.is_active_listing_staff(p_listing_id uuid, p_user_id uuid DEFAULT auth.uid()) RETURNS boolean` (`SECURITY DEFINER`, `STABLE`, `SET search_path = public`):**
  - Returns `true` if and only if a row exists in `public.staff_delegations` for `(listing_id = p_listing_id, staff_id = COALESCE(p_user_id, auth.uid()))` with `COALESCE(status, 'active') = 'active'` and parent `listings.lifecycle_status IN ('active', 'draining')`.
- **`public.staff_delegations` RLS Lockdown:**
  - Normalized `owner_id`, `granted_by_owner_id`, `staff_name`, `staff_email`, `status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','suspended','suspended_parent_closed','revoked','frozen_by_transfer','inactive'))`, `vertical_scopes jsonb NOT NULL DEFAULT '["enquiries"]'::jsonb`, `granted_at`, and `updated_at`.
  - `staff_delegations_v18a_select`: staff member (`staff_id = auth.uid()`), listing owner, or `admin`/`super_admin`.
  - `staff_delegations_v18a_insert` / `staff_delegations_v18a_update` / `staff_delegations_v18a_delete`: listing owner (`listings.owner_id = auth.uid()`) or `public.is_super_admin()` only. Delegated staff cannot add, escalate, or delete staff delegations.
- **`public.listings`, `public.enquiries`, and `public.marketplace_products` Active-Staff Policies:**
  - Replaced legacy policies that omitted `sd.status = 'active'` on `listings` (`"Allow public read access to listings"`, `"Allow owners to insert own listings"`, `"Allow owners to update own listings"`, `"Allow owners to delete own listings"` — staff strictly blocked from `DELETE`), `enquiries` (`"Allow listing owners to read enquiries for their listings"`, `"Allow listing owners to update enquiries"`, `"Allow listing owners to delete enquiries"` — active staff can read and reply, cannot delete), and `marketplace_products` (`"Public can read active marketplace products"`, `"Owners admins and staff can insert/update/delete marketplace products"` — permanent delete restricted to Owner/Admin).
  - Added `trg_guard_staff_listing_mutations_v18a` (`BEFORE UPDATE ON public.listings`) blocking non-owner delegated staff from mutating `owner_id`, `lifecycle_status`, `is_featured`, `featured_order`, or `paid_until`.
  - Added `trg_sync_marketplace_product_owner_v18a` (`BEFORE INSERT OR UPDATE ON public.marketplace_products`) ensuring staff-created products always stamp the listing's canonical `owner_id` and blocking non-admin edits to `paid_until`.

### 17.2 Server-Side `max_staff` Quota Enforcement & Audit Trigger (`v17b` Interconnection)
- **`public.enforce_and_audit_staff_delegation_v18a()` (`trg_enforce_and_audit_staff_delegation_v18a` `BEFORE INSERT OR UPDATE OR DELETE ON public.staff_delegations`):**
  - When inserting an `'active'` staff seat or transitioning an existing seat to `'active'`, resolves `v_owner_id` from `public.listings`, calls `public.get_effective_entitlements(v_owner_id, NEW.listing_id)`, checks `staffing.enabled` and `staffing.max_staff` (`NULL` or `< 0` = unlimited, `0` or `enabled = false` = blocked), counts distinct active `staff_id` seats across all listings owned by `v_owner_id`, and raises a descriptive exception if adding/activating the seat would exceed `max_staff`.
  - Writes every staff grant, update, deactivation, and deletion to `public.audit_logs` using exact live columns (`actor_id, actor_role, workspace, action, target_table, target_id, details, metadata`).

### 17.3 Owner-Inherited Entitlements & Workspace Summary RPC
- **`public.get_owner_workspace_summary(p_target_owner_id uuid DEFAULT NULL) RETURNS jsonb` (`SECURITY DEFINER`, `SET search_path = public`, `GRANT EXECUTE TO authenticated`):**
  - Verifies the caller is either `v_owner_id`, an active delegated staff member (`status = 'active'`) on at least one listing owned by `v_owner_id`, or `admin`/`super_admin`.
  - Resolves `public.get_effective_entitlements(v_owner_id)` (ensuring Delegated Staff automatically inherit the **Owner's** plan capabilities rather than their own personal profile), active/trialing subscription metadata, remaining days, `trial_used_at` eligibility, targeted VIP plans (`target_user_ids @> ARRAY[v_owner_id]`), trial-eligible plans, live quota meters (`listings`, `marketplace_items`, `active_staff`, `bulletins_this_month`), and expiring/expired `paid_until` items across `listings`, `marketplace_products`, and `bulletins`.

### 17.4 Responsive `WorkspaceNavShell` & Renovated Owner/Staff Workspace
- **`components/workspaces/shared/WorkspaceNavShell.tsx`:**
  - Dual horizontally scrollable mobile tab strips (`< md`: Row 1 primary groups, Row 2 nested child tabs) with 44px+ touch targets and zero dropdown group switchers; Tablet (`md` to `< lg`) 64px default icon-only rail with sticky collapse header; Desktop (`lg+`) expanded 256px rail with sticky collapse header; full `var(--ps-*)` theme token compliance and `contextSwitcherSlot`.
- **`components/workspaces/OwnerStaffWorkspace.tsx` & `components/workspaces/shared/OwnerOverviewAndPlanPanel.tsx`:**
  - Organizes Owner (`hat=owner`) and Delegated Staff (`hat=staff`) workspaces into 7 clean nested groups (`Overview & Plan`, `My Listings & Real Estate`, `Marketplace Catalogue`, `Orders & Bookings`, `Enquiries & Reviews`, `Team & Staff`, `Plans, Trials & Pay-Per`), renders live quota meters with `.dd-shimmer` skeletons, `<ConfirmDialog />`-gated 1-click Free Trial activation (`start_plan_trial`), VIP plan cards, Pay-Per soft-expiry alerts with 1-tap `<PayPerCheckoutModal />` renewal, and scoped Delegated Staff mode (`"Acting as Delegated Staff for [Business Name]"`) hiding Billing/Plans, Staff Management, and Delete controls.

---

## 18. Pass v19a Dispatch Mediator / UPI Escrow Workspace & Duplicate UTR Guard (`20261126_pass_v19a_mediator_escrow_and_utr_guard.sql`)

### 18.1 Deferred `pending_manual` UPI UTR Uniqueness Guard
- **`public.payment_intents` Partial Unique Index (`idx_payment_intents_unique_active_utr_v19a`):**
  - Enforces case-insensitive trimmed uniqueness on `upper(trim(upi_utr_ref))` across `WHERE status IN ('pending_manual', 'succeeded') AND upi_utr_ref IS NOT NULL AND trim(upi_utr_ref) <> ''` (closing the gap where `pending_manual` rows were previously excluded). Pre-deduplicates legacy test duplicates safely before index creation.
- **`public.delivery_transactions` Status Tracking & Partial Unique Index (`idx_delivery_transactions_unique_active_utr_v19a`):**
  - Adds `status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','verified','rejected','refunded'))` to `public.delivery_transactions` and creates a partial `UNIQUE` index on `upper(trim(upi_utr_ref))` `WHERE tx_type = 'upi_payment' AND status IN ('active', 'verified') AND upi_utr_ref IS NOT NULL AND trim(upi_utr_ref) <> ''`.
- **Friendly `23505` Handling on Customer Checkout:**
  - `app/api/payments/submit-utr/route.ts` normalizes UTRs uppercase, pre-checks active `pending_manual` + `succeeded` `payment_intents` and `active`/`verified` `delivery_transactions`, catches PostgreSQL `23505` unique violations (rolling back `payment_intents` cleanly if `delivery_transactions` conflicts), and returns HTTP `409` with exact friendly message `"This UPI UTR reference has already been submitted. Please check your transaction ID or contact support."`.
  - Direct Pick N Drop checkout flows (`components/pickndrop/PickNDropPanel.tsx`, `components/pickndrop/OrderTrackerModal.tsx`) also normalize UTRs and map `23505` via `mapDuplicateUtrError` (`lib/mediator/types.ts`).

### 18.2 Role-Guarded Mediator Escrow RPCs & Zero-Secret OTP Milestones
- **Mediator Role Helper (`public.is_pnd_mediator(p_uid uuid)`):**
  - Grants access to `profiles.role IN ('mediator', 'hub_manager', 'admin', 'super_admin')` OR active `public.hub_managers` rows.
- **Zero-Secret OTP Milestones (`public.get_mediator_otp_milestones(p_order_ids uuid[], p_booking_ids uuid[]) RETURNS jsonb`):**
  - `delivery_order_secrets` now stores `pickup_verified_at`, `dropoff_verified_at`, `return_verified_at` (synced by `verify_delivery_otp` and backfilled from `delivery_order_events`). `get_mediator_otp_milestones` returns strictly boolean/timestamp verification status without ever exposing raw Pickup/Dropoff/Return OTP codes to the Mediator UI.
- **3 Role-Guarded Mediator Escrow RPCs (`SECURITY DEFINER`, `SET search_path = public`, `GRANT EXECUTE TO authenticated`):**
  1. `public.mediator_verify_upi_payment(p_booking_id uuid, p_decision text, p_notes text DEFAULT NULL) RETURNS jsonb`: Supports Pick N Drop (`delivery_orders`), Scheduled Vehicles (`vehicle_bookings`), and `payment_intents`. `'verify'` funds escrow (`escrow_held` / `confirmed` / `succeeded`), stamps `payment_verified_by` + `payment_verified_at`, and appends to `public.audit_logs` (`workspace = 'mediator'`); `'reject'` mandates non-empty `p_notes`, marks payment rejected so UTR is never approved, and logs to `public.audit_logs`.
  2. `public.mediator_dispatch_driver(p_booking_id uuid, p_driver_id uuid, p_reason text DEFAULT NULL) RETURNS jsonb`: Checks `payment_feature_policies.escrow_required` (`pnd` / `vehicles`), enforces active KYC-verified driver matching the 5-tier fleet class, assigns/reassigns on `delivery_orders` or `vehicle_bookings.assigned_driver_id`, and writes to `public.audit_logs`.
  3. `public.mediator_resolve_escrow_payout(p_booking_id uuid, p_action text, p_reason text DEFAULT NULL) RETURNS jsonb`: Supports `'release_to_driver'`, `'freeze_dispute'`, and `'refund_customer'`. Enforces completed OTP handover (`dropoff_verified_at` / `return_verified_at`) before releasing payout unless resolving an open `'disputed'` record with an explicit override reason; stamps `pod_purge_at = now() + interval '48 hours'`; expands `vehicle_bookings.status` to include `'disputed'`; logs every settlement to `public.audit_logs` using exact canonical columns (`actor_id, actor_name, actor_role, workspace, action, target_table, target_id, target_name, details, metadata`).

### 18.3 Private POD Access, Mediator Audit Policy & Workspace UI
- **Private `delivery-pods` Bucket (`public = false`):** Re-asserted `delivery_pods_authorized_select` RLS policy allowing `is_pnd_mediator(auth.uid())` to request 60-second signed URLs via `createSignedUrl`.
- **Mediator Own-Audit Policy (`audit_logs_mediator_own_select`):** Allows `is_pnd_mediator(auth.uid())` to `SELECT` strictly `actor_id = auth.uid() AND workspace = 'mediator'` rows in `public.audit_logs` while keeping `audit_logs_admin_select` and `trg_audit_logs_immutable` intact.
- **Renovated `/workspace?hat=mediator` (`components/workspaces/mediator/MediatorWorkspace.tsx` mounted via `WorkspaceHatShell.tsx`):**
  - Built on `<WorkspaceNavShell />` with 5 nested groups: `Overview & SLA Pulse`, `UPI Verification Queue` (live 10-minute SLA timer badge `<5m` / `5–10m` amber / `>10m` red urgent, `<ConfirmDialog />` Verify, `<FormModal />` Reject), `Live Dispatch & Fleet Assignment` (5-tier KYC-verified driver picker in `<FormModal />`), `Escrow Payouts, POD Audit & Disputes` (zero-secret OTP milestone badges, 60s signed private POD modal with `"Purged automatically after 48 hours per privacy policy"` state, `<ConfirmDialog />`/`<FormModal />` settlements), and `Audit History`.

---

## 19. Pass v19b Local Driver & Vehicles Console, Zero-Trust Driver RPCs, Private POD Driver RLS & WebP Compressor (`20261126_pass_v19b_driver_rpc_and_pod_rls.sql`)

### 19.1 Schema Additions & Assigned-Driver Visibility
- **`public.delivery_orders.driver_substatus`:** Added idempotently with check constraint `IN ('arrived_pickup', 'en_route_dropoff', 'en_route_return')` to track non-OTP driver progress milestones cleanly without mutating canonical `delivery_orders_status_check`.
- **`public.vehicle_listings.contact_phone`:** Added idempotently for stand/driver E.164 contact numbers (`+91` default).
- **`public.vehicle_bookings` Driver RLS:** Expanded `"Customers vehicle managers and admins view bookings"` so active drivers assigned via `assigned_driver_id` can read their assigned scheduled vehicle bookings.

### 19.2 Zero-Trust Driver RPCs (`SECURITY DEFINER`, `SET search_path = public`, `GRANT EXECUTE TO authenticated`)
All mutations derive identity strictly from `auth.uid()` -> `public.drivers` and write to `public.audit_logs` via `public._log_driver_audit_v19b(...)` using exact live columns `(actor_id, actor_name, actor_role = 'driver', workspace = 'driver', action, target_table, target_id::text, target_name, details, metadata)`:
1. **`public.driver_accept_job(p_booking_id uuid) RETURNS jsonb`:**
   - Enforces active, KYC-approved driver (`is_active = true`, `kyc_verified = true OR kyc_status = 'verified'`), checks `payment_feature_policies.escrow_required` (`pnd` / `vehicles`), atomically claims unassigned trips with `FOR UPDATE SKIP LOCKED` + `WHERE driver_id IS NULL` (preventing double-claim race conditions), verifies 5-tier canonical fleet class match (`cycle_rickshaw`, `two_wheeler`, `e_rickshaw`, `mini_van`, `pickup_truck` with legacy `auto`/`car` aliases), and logs to `delivery_order_events` and `public.audit_logs`.
2. **`public.driver_verify_handover_otp(p_booking_id uuid, p_stage text, p_otp_input text, p_pod_storage_path text DEFAULT NULL) RETURNS jsonb`:**
   - Supports `p_stage IN ('pickup','dropoff','return')` across `delivery_orders` (`delivery_order_secrets`) and `vehicle_bookings` (`vehicle_booking_otps`). Enforces assigned driver authorization, strict stage order (blocks Dropoff before Pickup and Return before Dropoff), 5-attempt / 15-minute lockout, strict `p_pod_storage_path` format & booking confinement (`^orders/<booking_uuid>/[A-Za-z0-9._-]+$`), mandatory Dropoff POD when `pod_required` applies, stamps `*_verified_at` and `pod_purge_at = now() + interval '48 hours'`, and **NEVER** returns raw OTP values.
3. **`public.driver_update_trip_status(p_booking_id uuid, p_status text, p_reason text DEFAULT NULL) RETURNS jsonb`:**
   - Supports `'arrived_pickup'`, `'en_route_dropoff'`, and reasoned `'driver_cancelled'` (pre-pickup only; mandates `length(p_reason) >= 5` and returns the funded trip cleanly to the dispatch pool with `driver_id = NULL` and `status = 'escrow_held'`).
4. **`public.get_driver_payout_summary() RETURNS jsonb`:**
   - Returns authenticated driver's `{ released_today_inr, released_total_inr, escrow_held_inr, completed_trips_count, disputed_count, trips }` across Pick N Drop and Scheduled Vehicles without leaking private customer PII or raw OTP secrets.
5. **Companion Zero-Secret Helper RPCs:**
   - `public.get_driver_available_jobs() RETURNS jsonb`: Returns unassigned, escrow-funded (per `payment_feature_policies`) Pick N Drop jobs matching the driver's verified fleet tier without exposing recipient phones or OTPs before acceptance.
   - `public.get_driver_trip_otp_milestones(p_order_ids uuid[], p_booking_ids uuid[]) RETURNS jsonb`: Returns strictly boolean/timestamp OTP verification status for jobs assigned to `auth.uid()` — never raw OTP strings.

### 19.3 Private `delivery-pods` Bucket Driver RLS & Client-Side WebP Compressor
- **`public.is_driver_assigned_to_pod_path(p_object_name text, p_uid uuid)` + `storage.objects` RLS:**
  - Keeps `delivery-pods` strictly private (`public = false`). Tightens `delivery_pods_authenticated_upload` (`INSERT`), `delivery_pods_driver_update` (`UPDATE`), and `delivery_pods_authorized_select` (`SELECT`) so drivers can upload and preview **only** inside `orders/<booking_id>/...` where `<booking_id>` is an open trip assigned to their active driver account.
- **Client-Side WebP POD Compressor (`lib/media/pod-compressor.ts`):**
  - Dependency-free `compressPodImageToWebp(file)` validates MIME type & 15 MB raw ceiling, resizes large mobile camera captures to max `1280px` longest edge, and iteratively encodes to `image/webp` (with safe `image/jpeg` fallback on older WebViews) targeting `<= 250 KB`.
- **Renovated `/workspace?hat=driver` (`components/workspaces/DriverWorkspace.tsx` + `components/workspaces/driver/*`):**
  - Built on `<WorkspaceNavShell />` with 5 nested groups (`Overview & Active Trip`, `Available Job Board`, `OTP & POD Handovers`, `Scheduled Vehicles`, `Payouts & History`), Online/Offline availability toggle + GPS ping in `contextSwitcherSlot`, non-blocking KYC Readiness Banner, `<FormModal />`-based `DriverOtpPodModal` & Scheduled Vehicle Create/Edit (`<MapCoordinatePicker mode="point" />`, `<PhoneInput />`), `<ConfirmDialog />`-gated job acceptance/transitions/pauses/deletions, `.dd-shimmer` loaders, and zero client OTP secret queries.

---

## 20. Pass v20a Advertiser Workspace Renovation & Public Discovery/Monetization Soft-Expiry Parity (`20261126_pass_v20a_advertiser_and_public_expiry_parity.sql`)

### 20.1 Soft-Expiry Public Visibility Parity (`paid_until`)
- **Schema Columns & Indexes:** Idempotently ensures `paid_until timestamptz` (with partial indexes) on `public.bulletins`, `public.marketplace_products`, `public.listings` (plus `public.marketplace_items` if present), along with `is_verified boolean` and optional Event venue fields (`venue_label`, `venue_lat`, `venue_lng`) on `public.bulletins`.
- **Deterministic Helper (`public.is_monetized_item_publicly_visible(p_paid_until timestamptz) RETURNS boolean LANGUAGE sql STABLE`):**
  - Returns `(p_paid_until IS NULL OR p_paid_until > now())`; granted to `anon`, `authenticated`, and `service_role`.
- **Aligned `SELECT` RLS Policies:**
  - `public.bulletins` (`bulletins_select_public_and_owner_v20a`): Public/anon users only see `status = 'approved'` bulletins where `is_monetized_item_publicly_visible(paid_until)` is true; authors and `is_pnd_admin(auth.uid())` always retain `SELECT` visibility on expired rows (`paid_until <= now()`) for 1-tap Pay-Per renewal.
  - `public.marketplace_products` (`marketplace_products_select_public_and_owner_v20a`) + optional `public.marketplace_items`: Public/anon users only see active items where both the product and its parent listing pass `is_monetized_item_publicly_visible(paid_until)`; owners, active delegated staff (`is_active_listing_staff`), and admins always retain visibility on expired items.
  - `public.listings` (`listings_select_public_and_owner_v20a`): Public/anon users only see approved/active listings passing `is_monetized_item_publicly_visible(paid_until)`; owners, active delegated staff, and admins always retain visibility on expired listings.

### 20.2 Advertiser Workspace Summary RPC & Lifecycle Audit
- **`public.get_advertiser_workspace_summary() RETURNS jsonb` (`SECURITY DEFINER`, `SET search_path = public`, `GRANT EXECUTE TO authenticated, service_role`):**
  - Resolves `auth.uid()` active/trialing subscription (or Default Free baseline), remaining days, `trial_used_at` trial eligibility, `auto_verify_bulletins` capability, monthly bulletin usage vs. `bulletins` quota limit, counts of published / pending / expiring-soon (`<= 7d`) / expired bulletins, targeted VIP plans (`target_scope = 'selected_users'`), trial-eligible public plans, expiring/expired bulletin alerts, and recent `pay_per_orders` (`module_key = 'bulletin_post'`).
- **Advertiser Lifecycle Audit Trigger (`trg_audit_advertiser_bulletin_lifecycle_v20a`):**
  - Logs advertiser self-archive, unpublish, republish, and delete mutations on `public.bulletins` directly to `public.audit_logs` using exact canonical columns (`actor_id, actor_name, actor_role = 'advertiser', workspace = 'advertiser', action, target_table = 'bulletins', target_id::text, target_name, details, metadata`).

### 20.3 Renovated Advertiser Workspace & Public Discovery Parity
- **Advertiser Workspace (`/workspace?hat=advertiser`, `components/workspaces/advertiser/AdvertiserWorkspace.tsx` mounted in `WorkspaceHatShell.tsx`):**
  - Built on `<WorkspaceNavShell />` with 4 nested tabs across 2 groups: `Overview & Plan Quota` (KPI cards with `.dd-shimmer`, Active Plan/Trial card with `<ConfirmDialog />`-gated 1-click Free Trial, `"Special Plan for You"` VIP plan callouts, 1-tap Renew Pay-Per alerts), `My Bulletins & Notices` (responsive desktop table / mobile collapsible cards, status & type filters, `paid_until` countdown / `"Expired — Hidden Publicly"` pill, `<FormModal />`-based `BulletinComposerModal` with strict YouTube sanitizer, `+91` `<PhoneInput />`, `<MapCoordinatePicker mode="point" />`, `<ConfirmDialog />` Archive/Unpublish/Delete), `Plans, Trials & Pay-Per Orders` (live `pay_per_pricing_configs` slabs + `pay_per_orders` ledger with rejection notes), and `Featured & Promo Requests` (`public.featured_requests`).
- **Public Discovery & Monetization Parity:**
  - **`/bulletin` (`app/bulletin/page.tsx`):** Soft-expiry `paid_until` query & client filter, `.dd-shimmer` loaders, `min-h-[44px]` touch targets, `"Auto-Verified"` author badge, and deep-links to `/bulletin?plans=1` and `/workspace?hat=advertiser`.
  - **`/marketplace` (`app/marketplace/page.tsx`):** Soft-expiry `paid_until` filter on products & joined listings; hydrates `fetchListingPublicCapabilities(shopId)` (`get_listing_public_capabilities`) per listing so **Online UPI Checkout** appears strictly when `can_pay_upi` is true, falling back cleanly to **Direct WhatsApp / Manual Enquiry** when `can_pay_manual` is true.
  - **`/vehicles` & `/vehicles/[id]` (`VehiclesDirectoryClient.tsx`, `VehicleDetailClient.tsx`, `UniversalPaymentModal.tsx`):** `.dd-shimmer` loading skeleton grid, transparent per-seat vs. full-vehicle rate + escrow advance % strip, `payment_feature_policies` (`scope_key = 'vehicles'`) Escrow Protection Callout, standardized `<FormModal />` + `<ConfirmDialog />` reservation confirmation with `+91` `<PhoneInput />`, and friendly HTTP `409` / PostgreSQL `23505` duplicate-UTR error mapping via `mapDuplicateUtrError`.

---

## 21. Pass v20b Google OAuth PKCE, 2-Step Onboarding, Profile WebP Avatars, Offline PWA Resilience & Production Env Guard (`20261126_pass_v20b_profile_onboarding_and_avatars.sql`)

### 21.1 `public.profiles` Columns, OAuth Sync & Anti-Escalation Guard
- **Columns (`IF NOT EXISTS` on `public.profiles`):**
  - `avatar_url text`, `social_links jsonb NOT NULL DEFAULT '{}'::jsonb`, `preferred_locality text`, `onboarding_completed_at timestamptz`, and `phone text` (+ partial index `idx_profiles_onboarding_pending` on `id WHERE onboarding_completed_at IS NULL`).
- **Google OAuth Sync Trigger (`handle_new_user_v20b` on `auth.users`):**
  - Populates `full_name` (`raw_user_meta_data->>'full_name'` / `'name'`) and `avatar_url` (`'avatar_url'` / `'picture'`) on first sign-in without overwriting user-edited values on subsequent sign-ins.
- **Anti-Escalation Trigger & Owner Update RLS (`trg_guard_profile_sensitive_columns_v20b`, `profiles_owner_safe_update_v20b`):**
  - Allows authenticated users to `UPDATE` strictly their own safe profile columns while blocking any client-side self-escalation of `role`, `roles` (if present), `is_super_admin` (if present), or `trial_used_at` (except `service_role` / verified `super_admin`).
- **`avatars` Storage Bucket Policies:**
  - Public-read (`avatars_public_read_v20b`) and strict owner-scoped write/update/delete (`name LIKE (auth.uid()::text || '/%')`) on `storage.objects` for bucket `avatars`.

### 21.2 Auth Flow, `@supabase/ssr` PKCE Callback, 2-Step Onboarding & Profile Renovation
- **Server-Side PKCE Callback (`app/auth/callback/route.ts`):**
  - Uses `@supabase/ssr` `createServerClient` to validate safe relative `next` paths (`sanitizeRelativeNextPath`), run `exchangeCodeForSession(code)` preserving all `Set-Cookie` headers across redirects, inspect `profiles.onboarding_completed_at`, and redirect new users to `/onboarding?next=...` or returning users to `next` (default `/`); redirects failures to `/login?error=oauth`.
- **Unified Auth (`components/auth/AuthModal.tsx`, `/login`, `/signup`):**
  - Standardized on **Google OAuth** primary 1-tap CTA + **Email & Password** fallback (with Supabase email password reset); zero Phone SMS OTP login UI.
  - **Phase 44 Demo Auth Lock (`lib/env.ts`, `lib/auth/dev-test-accounts.ts`):** Demo Auth shortcuts render strictly when `process.env.NEXT_PUBLIC_ENABLE_DEMO_AUTH === 'true'` (hidden and disabled in production by default).
- **2-Step Churachandpur Guided `/onboarding` (`app/onboarding/page.tsx`):**
  - Step 1 collects Google-prefilled display name, `@username`, `+91` `<PhoneInput />`, and preferred Churachandpur locality; Step 2 lets users choose their primary intent (`Explore & Book`, `List My Business / Shop`, `Register as Driver / Vehicle`, or `Post Bulletins & Ads`), stamping `onboarding_completed_at = now()`, with a non-trapping "Skip for now" action.
- **Profile & Edit Profile (`app/profile/page.tsx`, `app/profile/edit/page.tsx`, `components/profile/ProfileSkeleton.tsx`):**
  - `.dd-shimmer` skeletons, workspace quick-launch hat cards, Offline-Ready Active Booking OTPs card (`#offline-otps`), `<ConfirmDialog />`-gated Sign Out (purging offline OTP cache), `<= 150 KB` WebP avatar compression (`compressAvatarToWebp` in `lib/media/pod-compressor.ts` -> `avatars/<uid>/...`), `+91` `<PhoneInput />`, strictly validated `https://` `social_links`, and dirty-state unsaved-leave guard (`<ConfirmDialog />` + `beforeunload`).

### 21.3 Offline PWA Resilience & Phase 44 Production Env Guard
- **IndexedDB Offline Store (`lib/offline/pwa-store.ts`, DB `ddoodle_offline_pwa_v1`):**
  - Strictly two bounded stores: `civic_emergency_cache` (wired into `CivicDirectoryPageClient.tsx` with `"Last synced [time]"` badge + automatic offline fallback) and `customer_active_otps` (strictly keyed by `userId`, wired into `OrderTrackerModal.tsx` and `/profile#offline-otps`, auto-excluding completed/cancelled trips, purged immediately on global `signOut` in `lib/auth.ts`, never read by Driver or Mediator consoles).
- **Service Worker & Offline Banner (`public/sw.js` `ddoodle-pwa-v3`, `components/shared/OfflineBanner.tsx`):**
  - Precaches `/`, `/civic`, `/profile`, `/manifest.json`, `/icon.svg`; uses CacheFirst for static build assets & Supabase media and NetworkFirst with cached fallback for pages while bypassing `/auth/callback`. Offline banner exposes quick links to `/civic` and `/profile#offline-otps` plus a guided iOS Safari "Add to Home Screen" fallback modal.
- **Phase 44 Public Env Guard (`lib/env.ts`):**
  - Typed public-only `NEXT_PUBLIC_*` accessor + `auditPublicEnv()` runtime audit + `sanitizeRelativeNextPath()` open-redirect guard (zero server secrets exposed).



