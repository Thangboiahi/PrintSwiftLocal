# DD oodle (PrintSwiftLocal) — Agent Operating Rules

> Always-on workspace rules for the DD oodle multi-hub local super-app (Churachandpur flagship).
> **Read before changing schema, routes, roles, or UI:**
> - **Live Truth:** [`docs/SYSTEM_BIBLE.md`](docs/SYSTEM_BIBLE.md) — canonical schema (88 tables, 61 migrations), 91 `SECURITY DEFINER` RPCs, RLS, 3-level taxonomy (`v16b`/`v17a`), monetization (`v17b`/`v17c`/`v20a`), all 8 role matrices, routes, UX primitives, PWA/telemetry & env contract.
> - **Sprint History:** [`docs/CHANGELOG.md`](docs/CHANGELOG.md) — chronological log (`4F-C` → `v20b`) + ordered migration manifest.
> - **Verified Gap Audit:** [`docs/AUDIT_FORMS_AND_ROLES.md`](docs/AUDIT_FORMS_AND_ROLES.md) — code/SQL-verified field tables, P0/P1/P2 bugs & fix checklist.

---

## 1. Tech Stack & Verification Commands
- **Stack:** Next.js 15.4.9 (App Router), React 19.2.1, TypeScript 5.9, Tailwind CSS v4 (`@tailwindcss/postcss`), Supabase (PostgreSQL + PostGIS + Storage + RLS + SSR PKCE `@supabase/ssr`), Google Maps (`@vis.gl/react-google-maps` + `terra-draw` + `@turf/turf`), `@dnd-kit`, `framer-motion` / `motion`, `next-intl`, `resend`.
- **Verification (run before committing code edits):**
  - Typecheck: `npx tsc --noEmit`
  - Lint: `npx eslint .` (or `npm run lint`)
  - Production build: `npm run build`

---

## 2. Non-Negotiable UI / UX Laws
1. **Minimalist Phase 45 Tokens & Scaling:**
   - Use `var(--ps-bg)`, `var(--ps-surface)`, `var(--ps-surface-alt)`, `var(--ps-border)`, `var(--ps-text)`, `var(--ps-text-muted)`, `var(--ps-accent)`, `var(--ps-accent-fg)`, `var(--ps-ring)` and semantic contrast vars (`--btn-primary-bg`, `--btn-primary-fg`) from `app/globals.css`.
   - Preserve the 5 `[data-theme-preset]` palettes (`neutral`, `ocean`, `forest`, `slate`, `clay`), `--ui-scale` root `rem` scaling (`16px` default), and orientation-locked mutually exclusive nav breakpoints (`.nav-bottom-responsive`, `.nav-vertical-responsive`, `.nav-top-responsive`).
2. **Touch Targets & Skeletal Loaders:**
   - Enforce **`44px+` (`min-h-[44px]` / `h-11 w-11`)** interactive targets across all buttons, inputs, tabs, and modal controls.
   - Use **`.dd-shimmer`** skeletal loaders (`components/shared/Skeletons.tsx`, honoring `prefers-reduced-motion: reduce`) — never jarring blank flashes or blocking spinners on feeds.
3. **Standard Modals, Dialogs & Zero Native Popups:**
   - Use **`<FormModal />`** (`components/ui/FormModal.tsx`) for all create/edit forms (built-in Hints drawer, dirty-close guard, pre-submit confirmation) and **`<ConfirmDialog />`** (`components/ui/ConfirmDialog.tsx`) for destructive/impactful actions. Never introduce new uses of legacy `<ConfirmActionModal />`.
   - **ZERO native browser popups:** `window.alert()`, `window.confirm()`, and `window.prompt()` are strictly forbidden everywhere.
   - **ZERO native `<select>` elements:** use **`<CustomSelectModal />`** (`components/ui/CustomSelectModal.tsx`, portaled at `z-[98]`).
   - Support Escape-key close, scroll-lock (`useModalLock`), and Android hardware/gesture back-button (`history.pushState` / `popstate`) across modals and drawers.
4. **Validation Timing Law:**
   - Field-level errors appear **strictly after user input or blur** (`touched`).
   - Form-level summary validation banners render **strictly on submit** (`submitAttempted` via `useFormModalValidation()`). Never show screaming red errors on fresh modal open.
5. **Unified Platform Primitives (Do Not Duplicate):**
   - **Coordinates & Polygons:** `<MapCoordinatePicker />` (`components/maps/MapCoordinatePicker.tsx`, `point` & `polygon` modes) — never raw lat/lng inputs or legacy `shared/MapCoordinatePicker.tsx` / `LocationPickerModal` forks for new forms.
   - **Phone Numbers:** `+91`-default `<PhoneInput />` (`components/ui/PhoneInput.tsx`) + `isValidCountryPhone()`.
   - **Workspaces:** `<WorkspaceNavShell />` (`components/workspaces/shared/WorkspaceNavShell.tsx`) for sticky mobile horizontal tabs + tablet/desktop collapsible rails. Lazy-load each hat via `next/dynamic` so roles remain chunk-isolated.
   - **Ordering & Hints:** `<SortablePreview />` (`components/ui/SortablePreview.tsx` with `useTouchSafeSensors()`) for drag-and-drop **strictly where display order matters**, `<AttributeHintsPopover />` for builder route/attr chips, and `<IconPicker />` (`lib/icons/registry.ts`).
6. **Media Compression & Lifecycle Hygiene:**
   - Compress images client-side to WebP before upload (`<=250KB` for Driver PODs via `lib/media/pod-compressor.ts`, `<=150KB` for Avatars, WebP canvas resize for galleries/banners/products).
   - Stage and track uploads via `/api/media/upload` + `public.media_assets` (`temp_draft` / `ephemeral_ttl`), and clean up abandoned blobs via `/api/media/discard-temp`. Never upload raw uncompressed camera files directly to public buckets.

---

## 3. Hard Database, Auth & Security Laws
1. **Exact Live `public.audit_logs` 13-Column Contract:**
   `id, timestamp, actor_id, actor_name, actor_role, workspace, action, target_id, target_name, details, target_table, metadata, created_at`
   - Immutable append-only table (`trg_audit_logs_immutable` blocks all `UPDATE`/`DELETE`). Cast UUIDs to `text` for `target_id`; put structured JSON in `metadata`; never use nonexistent `entity_type` or `entity_id` columns.
2. **Strict Role Separation & `super_admin` Dual-Lock:**
   - Global mutations (homepage containers, L1/L2/L3 canonical taxonomy merges, plans/pricing rules, payment policies, `service_hubs`, role promotions) require `is_super_admin()`.
   - Hardcoded Super-Admin accounts are protected by DB immutability triggers (`trg_guard_immutable_superadmin`) AND server/UI dual-lock (`isVerifiedSuperAdmin(email, dbRole)` in `lib/auth/super-admin.ts`). Never trust client cookies (`view_as_role`) without verified DB `super_admin` privilege.
   - Keep `hub_managers` strictly matched via `profile_id` (not `user_id`) and hub-scoped via `is_hub_manager_for(hub_id)`.
3. **Zero-Trust Asymmetric OTPs:**
   - Driver and Mediator UIs MUST **NEVER** query OTP secret tables (`delivery_order_secrets`, `vehicle_booking_otps`) or select plaintext OTP columns.
   - Read completion states only via `get_driver_trip_otp_milestones` / `get_mediator_otp_milestones`, and verify exclusively server-side via `driver_verify_handover_otp` (with 5-attempt lockout).
4. **Private Storage Buckets & 48h Purge:**
   - `delivery-pods` (48h auto-purge), `print-documents` (48h auto-purge), and `kyc-documents` MUST remain **private** (`public = false`) and be accessed solely via short-lived server/RLS signed URLs (`60s`–`300s`). Never place customer UPI receipts or KYC docs in public buckets.
5. **Authentication & Env Guardrails:**
   - Auth is **Google OAuth PKCE** (`/auth/callback` via `@supabase/ssr`) + **Email/Password** (NO SMS OTP).
   - Demo/test role shortcuts (`TestRoleShortcuts.tsx`) are strictly opt-in via `NEXT_PUBLIC_ENABLE_DEMO_AUTH=true` (defaults to `false` in production). Never expose `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, or payment secrets to client code.
6. **Monetization, UTR Replay & Soft-Expiry Integrity:**
   - Maintain a single immutable `is_default_free = true` plan (`default_free_tier`), one-time per-user trial (`profiles.trial_used_at`), partial unique active UTR replay indexes (`payment_intents`, `delivery_transactions`, `pay_per_orders`), and `is_monetized_item_publicly_visible(paid_until)` filtering across every public page, search query, and SSR route.
7. **SQL & Schema Truth:**
   - Ground truth is `supabase/migrations/*.sql`, never stale docs or memory. Verify exact column names (e.g., `delivery_orders` uses PostGIS `pickup_point`/`dropoff_point` & `instructions`; `vehicle_listings` uses `origin_hub_id`; `restaurant_menu_items` uses `category_name`/`diet_type`; `listing_restaurant_profiles` uses `allow_table_booking`).

---

## 4. Git & Milestone Workflow
- Commit cleanly at every completed milestone using Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `chore:`).
- **Mandatory auto-push at every verified milestone (permanent rule since `v21a`):** at the end of each verified milestone the agent MUST automatically run `git add`, `git commit` (Conventional Commit message), and **`git push origin main`** — no separate approval is needed for this push.
  - Before pushing: verification must be green for what the milestone touched (`npx tsc --noEmit`, `npx eslint` on changed files, `npm run build` for app code; idempotent execution/replay for SQL migrations) and `git status` must be clean apart from the milestone's own changes.
  - When working from a worktree/feature branch, push the verified tip as a fast-forward with `git push origin HEAD:main`; if `origin/main` has moved, fetch and rebase/merge first, re-verify, then push.
  - **Never force-push**, never rewrite published history, never skip hooks, and never discard untracked files.
- Source code and SQL migrations are off-limits during doc/audit-only passes.
