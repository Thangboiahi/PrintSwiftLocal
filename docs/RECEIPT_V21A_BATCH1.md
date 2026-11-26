# Execution Receipt — Sprint v21a (Batch 1: P0-01..P0-28)

> **Date:** 2026-11-26 · **Branch pushed:** `origin/main` (fast-forward only, no force-push)
> **Scope:** all P0 findings from [`docs/AUDIT_FORMS_AND_ROLES.md`](AUDIT_FORMS_AND_ROLES.md). P1-01..P1-20 and P2-01..P2-14 deferred.

---

## 1. Result

| Item | Status |
|---|---|
| P0 findings closed | **28 / 28** (each marked **[DONE]** with file/SQL references in the audit doc) |
| Adversarial review of the v21a change set | 41 agents, 18 findings → **17 fixed**, 1 refuted (unused constant) |
| Migrations ready for Supabase SQL Editor | **Yes** — 2 files, each wrapped in `BEGIN`/`COMMIT`, idempotent |
| Docs updated | `SYSTEM_BIBLE.md` (§9 Security Baseline), `CHANGELOG.md` (v21a, review hardening, R2 + manifest → 63), `AUDIT_FORMS_AND_ROLES.md`, `AGENTS.md` |

## 2. Commits (all on `origin/main`)

| Hash | Message |
|---|---|
| `c738ef2` | docs(agents): require auto-commit and push to origin main at every verified milestone |
| `ead8495` | fix(db): resolve P0 security, RLS, RPC, and schema audit findings (v21a) |
| `a9960fc` | fix(db): harden v21a escrow refund/release and cancellation guards (v21a) |
| `719fb5c` | fix(app): resolve P0 API, query, and role form audit findings (v21a) |
| `31196bf` | fix(db,app): restore owner profile lookups after v21a row-scoping (v21a-r2) |

## 3. Apply in the Supabase SQL Editor (in this order)

1. `supabase/migrations/20261126_pass_v21a_p0_security_rls_and_schema_fixes.sql` — 280 statements
2. `supabase/migrations/20261126_pass_v21a_r2_profile_scoped_lookups.sql` — 12 statements

Both are safe to re-run.

## 4. Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit` | 0 errors |
| `npx eslint` (changed files) | 0 errors (warnings only) |
| `npm run build` | exit 0 |
| Native popup grep (`window.alert/confirm/prompt`) | 0 |
| Full migration replay (PGlite Postgres 17 + PostGIS) | v21a: 280 stmts / 0 failed · R2: 12 stmts / 0 failed |
| Idempotency (second run) | 0 failed statements for both files |
| Role-impersonated behavioural checks | 47 checks (T00–T47); every allowed action succeeded, every forbidden one was refused with the expected message |

## 5. P0 status

| ID | Finding | Status |
|---|---|---|
| P0-01 | Driver job board & active trips crash | ✅ DONE |
| P0-02 | Pick N Drop OTP verification crash | ✅ DONE |
| P0-03 | Scheduled vehicle stuck escrow | ✅ DONE |
| P0-04 | Dedicated `mediator` role & `driver_update_trip_status` | ✅ DONE |
| P0-05 | `hub_managers.profile_id` bugs & Hub Manager queries | ✅ DONE |
| P0-06 | All 4 server entitlement RPCs | ✅ DONE |
| P0-07 | `ListingEditorModal` save crash | ✅ DONE |
| P0-08 | Owner Pro plan checkout 404 | ✅ DONE |
| P0-09 | Pay-Per quote mismatch (+ `review_pay_per_order` param fix in R2) | ✅ DONE |
| P0-10 | Bulletin Pay-Per CHECK failure | ✅ DONE |
| P0-11 | Advertiser `featured_requests` tab | ✅ DONE |
| P0-12 | Public query column crashes & `GetFeaturedModal` | ✅ DONE |
| P0-13 | `submit-utr` purposes, receipt upload & legacy console bypasses | ✅ DONE |
| P0-14 | Plaintext OTP & escalation RLS gaps | ✅ DONE |
| P0-15 | 5 broken SQL triggers & RPCs | ✅ DONE |
| P0-16 | Critical data/RLS leaks (`profiles`, plans, categories, reviews, …) | ✅ DONE |
| P0-17 | `purge-media` bucket & `/api/media/upload` security | ✅ DONE |
| P0-18 | Delegated staff permission lock & RLS scope bypass | ✅ DONE |
| P0-19 | `notifications` schema replay, `FeaturedPlacementsPanel` RLS | ✅ DONE |
| P0-20 | `CategoryBuilder` & `marketplace_products.seller_id` | ✅ DONE |
| P0-21 | `media_assets` / `notifications` replay + super-admin email sync | ✅ DONE |
| P0-22 | `useLiveNavBadges` queries | ✅ DONE |
| P0-23 | Homepage quick-jump verticals & `lib/routes.ts` | ✅ DONE |
| P0-24 | Fake contact & vehicle review forms | ✅ DONE |
| P0-25 | `get_owner_workspace_summary()` quota keys | ✅ DONE |
| P0-26 | POD purge, customer post-UPI cancel & >15 min dispatch SLA | ✅ DONE |
| P0-27 | `bulletin_post_passes` UTR replay | ✅ DONE |
| P0-28 | `get_user_operational_hats` IDOR & `set-view-role` | ✅ DONE |

## 6. Adversarial review fixes (post-implementation)

- Escrow refund/release require a verified customer payment; release also requires an assigned driver.
- Cancelling before UPI verification keeps the order in the verification queue (flagged for the mediator); duplicate requests blocked.
- Cancel/refund dialog no longer hidden behind the order tracker; now also works in the embedded Activity tracker.
- UTR submission never reuses an expired payment intent.
- Private receipt paths are no longer used as `<img>` sources.
- Hub Manager vehicles list sorts by `updated_at` (no `created_at` column).
- Owner Pick N Drop tab links to booking, not the Mediator Desk.
- `/api/auth/set-view-role` verifies the caller's Bearer token (browser sessions live in localStorage).
- Profile Hub Manager link shown to hub managers only.
- Contact form mirrors server length limits; vehicle review byline fits the 2–80 char constraint.
- Media purge skips disputed PODs and stamps `pod_purged_at`; purge cron accepts `CRON_SECRET`.
- Owner avatars/names fall back to `public_profiles`; staff lookup and fleet-calendar contacts use new owner-scoped RPCs (`lookup_user_for_delegation`, `get_vehicle_booking_contacts`).
- Pay-Per approve/reject now send `p_notes` (pre-existing bug).
- **Not fixed (refuted):** `open_24x7` route constant uses an attr the civic filter ignores — the constant is unused.

## 7. Decisions flagged for review (safest default applied)

1. Commerce entitlement comes from `online_payment`; Real Estate Pro from `real_estate_poly`.
2. The second super-admin email is hardcoded in both TypeScript and SQL.
3. Dedicated mediators and admins work across all hubs; hub managers only their own; hub-less rows reachable by platform-wide users only.
4. Vehicle reviews: any signed-in user, one per vehicle, excluding the owner and assigned drivers.
5. Contact messages are written only by the server route (honeypot + rate limit); `featured_requests` cannot target bulletins; advertiser stays a hat, not a role.
6. Real estate contact details appear only after a page reload once the request is accepted.
7. All media uploads require sign-in.
8. Per-km vehicle fares use client-supplied km, bounded to 5–2000.
9. Unverified-payment cancellations wait in the verification queue until the mediator verifies or rejects the proof.
10. Staff/contact lookup RPCs rely on exact matching and owner-only access; no rate limit.
11. Older migrations (`00014` seed, `phase72a`, `r1b`, …) still fail on a fresh-database replay — outside v21a; a baseline squash is recommended. Replay guards were added to `00011` and `pass_r1a`.
12. `package-lock.json` is out of sync with `package.json` (`npm ci` fails) — to regenerate separately.

## 8. Deferred — P1-01..P1-20 (Batch 2)

- **P1-01** Vertical profile data loss / overwrites
- **P1-02** Real estate `boundary_geojson` format drift & Sangam unit selector
- **P1-03** Separate staff & owner controls in `ListingEditorModal`
- **P1-04** Eliminate all raw uncompressed image uploads
- **P1-05** Driver vehicles form compliance
- **P1-06** Driver KYC missing fleet classes & `license_no`
- **P1-07** 4 vs 5 fleet cards & Aizawl re-injection
- **P1-08** Hub Manager schema & triage decoupling
- **P1-09** Standardize duplicate inputs (Phone, Map, Select, Confirm)
- **P1-10** Onboarding & auth flow gaps
- **P1-11** Query param hydration across public pages
- **P1-12** Owner enquiries & reviews persistence
- **P1-13** `OwnerBulletinsPanel` & `MarketplaceCatalogueManager` CSV/category gaps
- **P1-14** YouTube boost bypass & rich-text XSS
- **P1-15** UTR format rules & receipt proof preview
- **P1-16** `CivicDirectoryManager` label & `IconPicker` z-index
- **P1-17** Restaurant table booking timezone & phone validation
- **P1-18** `ShopStorefrontClient`, `VehiclesDirectoryClient`, profile fixes
- **P1-19** Delegations legacy key & `StaffDelegationManager` cleanup
- **P1-20** `AdminBulletinManager` `profiles.name` & category owner feedback

P2-01..P2-14 also deferred.
