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
| `audit_logs` | `id (uuid)` | — (`actor_id text`, `target_id text`) | Created in `00005_sync_frontend_fields.sql:380-393` with RLS enabled, **zero RLS policies**, and **zero active writers** (orphaned). |
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
| 2 | **Delegated Staff RLS Parity** | **GAP** | Table is `marketplace_products` (not `marketplace_items`). Staff have RLS on `listings` (`SELECT`/`UPDATE`, `00014:35-99`) and `marketplace_products` (`SELECT`/`INSERT`/`UPDATE`/`DELETE`, `phase58:67-183`), **but**: (a) `enquiries` allows staff `SELECT` only (`00014:196-217`), omitting `staff_delegations` from `UPDATE`/`DELETE` (`00014:220-265`); (b) legacy `listings`/`enquiries`/`marketplace_products` policies omit `sd.status = 'active'`, so suspended/revoked delegations still match; (c) `staff_delegations` lacks owner `INSERT`/`UPDATE`/`DELETE` RLS policies (`00002:135-136`). |
| 3 | **Admin vs. Superadmin & Audit Trail** | **PARTIALLY REMEDIATED (v15a)** | `20261124_pass_v15a_superadmin_foundation.sql` adds: (a) `trg_guard_immutable_superadmin` (`BEFORE INSERT OR UPDATE OR DELETE` on `public.profiles`) blocking any `authenticated`/`anon` session from granting, revoking, mutating, or deleting `super_admin`; (b) hardened `superadmin_set_user_role` rejecting `super_admin` grants/revocations; (c) upgraded append-only `public.audit_logs` (`SELECT` only for `admin`/`super_admin`, zero `UPDATE`/`DELETE` policies + `trg_audit_logs_immutable`, `SECURITY DEFINER` `write_audit_log`, automatic audit triggers on `profiles`, `categories`, `homepage_items`, `popular_localities`, `partner_applications`). Remaining follow-up: tighten `vehicle_types_admin_manage` (`phase60:267-272`) from `is_pnd_admin` to `is_super_admin` in v15b/v15c. |
| 4 | **UPI Escrow Replay Protection** | **GAP** | `payment_intents` has partial unique index `idx_unique_succeeded_utr` (`phase63a:119-121`) covering `WHERE status = 'succeeded'`, and `app/api/payments/submit-utr/route.ts:150-166` only checks `status = 'succeeded'`. Concurrent duplicate UTR submissions in `pending_manual` are not blocked prior to approval, and `delivery_transactions.upi_utr_ref` (`phase60:130`) / `bulletin_post_passes.upi_utr_ref` have no `UNIQUE` constraint. |
| 5 | **Auth & Onboarding (Phases 18 & 46)** | **GAP** | `components/auth/AuthModal.tsx` (lines 285, 330, 381, 534; used by `/login` & `/signup`) is **Email + Password + Resend Email OTP only** (`app/api/auth/send-otp/route.ts:150-190`). Zero `signInWithOAuth` (Google) or `signInWithOtp` (Phone SMS) calls exist in UI/API (only passive `app/auth/callback/route.ts:9` exists). `/onboarding` (`app/onboarding/page.tsx:12-26`) is a live Partner/Driver/Advertiser KYC form (`partner_applications`), not a general user onboarding flow. |
| 6 | **Offline PWA Coverage (Phase 11)** | **GAP** | `public/sw.js:6-12` only precaches `/`, `/about`, `/contact`, `/manifest.json`, `/icon.svg` and skips cross-origin Supabase REST requests (`public/sw.js:117`). Zero `indexedDB` usage exists. `CivicDirectoryPageClient.tsx:171-183` fetches `listing_civic_profiles` live with no offline helpline persistence, and active customer OTPs (`vehicle_booking_otps` in `app/saved/page.tsx:622` / `ActivityPanel.tsx:623`; `delivery_order_secrets` in `ActivityPanel.tsx:748` / `OrderTrackerModal.tsx:134`) are online-only. |

---

## 6. Pass v15a Superadmin Foundation (`20261124_pass_v15a_superadmin_foundation.sql`)

### 6.1 Tables & Columns Added / Upgraded
- **`public.audit_logs` (Upgraded & Hardened):**
  - Canonical columns: `id uuid PK`, `actor_id uuid`, `actor_role text`, `action text NOT NULL`, `target_table text`, `target_id text`, `metadata jsonb NOT NULL DEFAULT '{}'::jsonb`, `created_at timestamptz NOT NULL DEFAULT now()`.
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



