-- =============================================================================
-- Migration: 20261128_pass_v24a_single_superadmin_google_merge_and_badges.sql
-- Sprint v24a — Production Stabilization Pass
--
-- 1. Single Hardcoded Superadmin (`thangboiahi@gmail.com` ONLY):
--    - Replaces `public.is_hardcoded_super_admin_email(p_email text)` to remove
--      `homeautomation.dd@gmail.com`.
--    - Allows trusted non-client migration/service contexts in
--      `public.enforce_profile_role_governance()` (matching `guard_immutable_superadmin`)
--      and safely demotes any existing `homeautomation.dd@gmail.com` profile row
--      back to `role = 'visitor'` with an immutable audit entry.
--
-- 2. Safe Google OAuth <-> Existing Email/Password Account Merge:
--    - Hardens `public.handle_new_user_v20b()` on `auth.users` so linking or
--      signing in with Google against an existing email/password account uses
--      `ON CONFLICT (id) DO UPDATE`, NEVER overwrites `role`, `username`, `phone`,
--      `preferred_locality`, `onboarding_completed_at`, or `trial_used_at`, only
--      backfills `full_name` and `avatar_url` when NULL/empty, and never throws
--      a unique-constraint failure on `profiles.email` or `profiles.username`.
--
-- 3. Unified Role-Scoped Actionable Badges RPC:
--    - Creates `public.get_my_actionable_badges()` (`SECURITY DEFINER`,
--      `GRANT EXECUTE TO authenticated`, `REVOKE FROM PUBLIC, anon`) returning
--      live, strictly unresolved counts for the authenticated caller's active
--      hats so every UI badge clears immediately upon resolution.
-- =============================================================================

BEGIN;

-- =============================================================================
-- §1. SINGLE HARDCODED SUPERADMIN (`thangboiahi@gmail.com` ONLY)
-- =============================================================================

-- 1A. Replace hardcoded superadmin email allowlist (in sync with lib/auth/super-admin.ts)
CREATE OR REPLACE FUNCTION public.is_hardcoded_super_admin_email(p_email text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT lower(trim(COALESCE(p_email, ''))) IN (
    'thangboiahi@gmail.com'
  );
$$;

-- 1B. Ensure `enforce_profile_role_governance` permits trusted non-client SQL
--     migration contexts (postgres / supabase_admin / service_role with no
--     client JWT) while keeping authenticated/anon client sessions strictly locked.
CREATE OR REPLACE FUNCTION public.enforce_profile_role_governance()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_jwt_role text := lower(
    COALESCE(
      NULLIF(current_setting('request.jwt.claim.role', true), ''),
      NULLIF(current_setting('role', true), ''),
      ''
    )
  );
  v_is_client_session boolean := v_jwt_role IN ('authenticated', 'anon');
  v_is_service boolean := (current_setting('role', true) = 'service_role');
BEGIN
  NEW.updated_at := COALESCE(NEW.updated_at, now());

  -- Hardcoded Super-Admin Rule (verified against auth.users; thangboiahi@gmail.com ONLY)
  IF public._v21a_is_hardcoded_super_admin_user(NEW.id) THEN
    NEW.role := 'super_admin';
    RETURN NEW;
  END IF;

  -- Trusted server/migration contexts (service_role or direct SQL Editor migration)
  IF v_is_service OR NOT v_is_client_session THEN
    NEW.role := COALESCE(NULLIF(TRIM(NEW.role), ''), 'visitor');
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    NEW.role := 'visitor';
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' AND NEW.role IS DISTINCT FROM OLD.role THEN
    IF NOT EXISTS (
      SELECT 1
      FROM public.profiles
      WHERE id = auth.uid()
        AND role IN ('admin', 'super_admin')
    ) THEN
      RAISE EXCEPTION 'Unauthorized: Only authorized administrators can modify user roles.';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- 1C. Idempotently demote any existing `homeautomation.dd@gmail.com` profile row
--     back to `visitor` (preserving account data) and log to `public.audit_logs`.
DO $$
DECLARE
  v_has_is_super_admin boolean := false;
  v_has_admin_role boolean := false;
  v_target_rec RECORD;
  v_demoted_count integer := 0;
BEGIN
  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'is_super_admin'
  ) INTO v_has_is_super_admin;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'profiles'
      AND column_name = 'admin_role'
  ) INTO v_has_admin_role;

  FOR v_target_rec IN
    SELECT DISTINCT p.id, p.role
    FROM public.profiles p
    LEFT JOIN auth.users u ON u.id = p.id
    WHERE (
      lower(trim(COALESCE(p.email, ''))) = 'homeautomation.dd@gmail.com'
      OR lower(trim(COALESCE(u.email, ''))) = 'homeautomation.dd@gmail.com'
    )
    AND lower(trim(COALESCE(p.role, ''))) IN ('super_admin', 'superadmin', 'admin')
  LOOP
    UPDATE public.profiles
    SET role = 'visitor',
        updated_at = now()
    WHERE id = v_target_rec.id;

    IF v_has_admin_role THEN
      EXECUTE 'UPDATE public.profiles SET admin_role = NULL WHERE id = $1'
      USING v_target_rec.id;
    END IF;

    IF v_has_is_super_admin THEN
      EXECUTE 'UPDATE public.profiles SET is_super_admin = false WHERE id = $1'
      USING v_target_rec.id;
    END IF;

    PERFORM public.write_audit_log(
      NULL,
      'system',
      'v24a_demote_secondary_superadmin',
      'profiles',
      v_target_rec.id::text,
      jsonb_build_object(
        'workspace', 'super_admin',
        'target_name', 'homeautomation.dd@gmail.com',
        'details', format('Demoted legacy secondary superadmin (%s -> visitor) in Sprint v24a', COALESCE(v_target_rec.role, 'unknown')),
        'previous_role', v_target_rec.role,
        'new_role', 'visitor'
      )
    );

    v_demoted_count := v_demoted_count + 1;
  END LOOP;
END;
$$;


-- =============================================================================
-- §2. SAFE GOOGLE OAUTH <-> EXISTING EMAIL/PASSWORD ACCOUNT MERGE
-- =============================================================================

CREATE OR REPLACE FUNCTION public.handle_new_user_v20b()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meta jsonb := COALESCE(NEW.raw_user_meta_data, '{}'::jsonb);
  v_full_name text := NULLIF(
    TRIM(COALESCE(v_meta->>'full_name', v_meta->>'name', '')),
    ''
  );
  v_avatar_url text := NULLIF(
    TRIM(COALESCE(v_meta->>'avatar_url', v_meta->>'picture', '')),
    ''
  );
  v_phone text := NULLIF(
    TRIM(COALESCE(NEW.phone, v_meta->>'phone', '')),
    ''
  );
  v_fallback_name text := COALESCE(
    v_full_name,
    NULLIF(SPLIT_PART(COALESCE(NEW.email, ''), '@', 1), ''),
    'DD oodle Member'
  );
  v_existing_profile boolean := false;
BEGIN
  -- Fast path: existing profile for this auth.users.id (e.g., Google OAuth linked
  -- or merged onto an existing email/password account). NEVER overwrite role,
  -- username, phone, preferred_locality, onboarding_completed_at, or trial_used_at.
  SELECT EXISTS (
    SELECT 1 FROM public.profiles WHERE id = NEW.id
  ) INTO v_existing_profile;

  IF v_existing_profile THEN
    UPDATE public.profiles
    SET
      full_name = CASE
        WHEN NULLIF(TRIM(COALESCE(public.profiles.full_name, '')), '') IS NULL
          AND v_full_name IS NOT NULL
        THEN v_full_name
        ELSE public.profiles.full_name
      END,
      avatar_url = CASE
        WHEN NULLIF(TRIM(COALESCE(public.profiles.avatar_url, '')), '') IS NULL
          AND v_avatar_url IS NOT NULL
        THEN v_avatar_url
        ELSE public.profiles.avatar_url
      END,
      email = CASE
        WHEN NULLIF(TRIM(COALESCE(public.profiles.email, '')), '') IS NULL
          AND NULLIF(TRIM(COALESCE(NEW.email, '')), '') IS NOT NULL
        THEN NEW.email
        ELSE public.profiles.email
      END,
      updated_at = now()
    WHERE id = NEW.id;

    RETURN NEW;
  END IF;

  -- First-time profile creation: safely upsert by id without ever throwing a
  -- unique-constraint error on email or username during concurrent OAuth syncs.
  BEGIN
    INSERT INTO public.profiles (
      id,
      email,
      full_name,
      avatar_url,
      phone,
      social_links,
      updated_at
    )
    VALUES (
      NEW.id,
      NEW.email,
      v_fallback_name,
      v_avatar_url,
      v_phone,
      '{}'::jsonb,
      now()
    )
    ON CONFLICT (id) DO UPDATE
    SET
      full_name = CASE
        WHEN NULLIF(TRIM(COALESCE(public.profiles.full_name, '')), '') IS NULL
          AND v_full_name IS NOT NULL
        THEN v_full_name
        ELSE public.profiles.full_name
      END,
      avatar_url = CASE
        WHEN NULLIF(TRIM(COALESCE(public.profiles.avatar_url, '')), '') IS NULL
          AND v_avatar_url IS NOT NULL
        THEN v_avatar_url
        ELSE public.profiles.avatar_url
      END,
      email = CASE
        WHEN NULLIF(TRIM(COALESCE(public.profiles.email, '')), '') IS NULL
          AND NULLIF(TRIM(COALESCE(EXCLUDED.email, '')), '') IS NOT NULL
        THEN EXCLUDED.email
        ELSE public.profiles.email
      END,
      updated_at = now();
  EXCEPTION
    WHEN unique_violation THEN
      -- Recover cleanly if an older row already holds the email/username value
      -- without aborting Supabase GoTrue sign-in or identity linking.
      BEGIN
        INSERT INTO public.profiles (
          id,
          full_name,
          avatar_url,
          social_links,
          updated_at
        )
        VALUES (
          NEW.id,
          v_fallback_name,
          v_avatar_url,
          '{}'::jsonb,
          now()
        )
        ON CONFLICT (id) DO UPDATE
        SET
          full_name = CASE
            WHEN NULLIF(TRIM(COALESCE(public.profiles.full_name, '')), '') IS NULL
              AND v_full_name IS NOT NULL
            THEN v_full_name
            ELSE public.profiles.full_name
          END,
          avatar_url = CASE
            WHEN NULLIF(TRIM(COALESCE(public.profiles.avatar_url, '')), '') IS NULL
              AND v_avatar_url IS NOT NULL
            THEN v_avatar_url
            ELSE public.profiles.avatar_url
          END,
          updated_at = now();
      EXCEPTION
        WHEN OTHERS THEN
          -- Never block GoTrue auth.users writes due to profile sync conflicts
          NULL;
      END;
  END;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_handle_new_user_v20b ON auth.users;
CREATE TRIGGER trg_handle_new_user_v20b
  AFTER INSERT OR UPDATE OF raw_user_meta_data, email ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user_v20b();


-- =============================================================================
-- §3. UNIFIED ROLE-SCOPED ACTIONABLE BADGES RPC (`get_my_actionable_badges`)
-- =============================================================================

CREATE OR REPLACE FUNCTION public.get_my_actionable_badges()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text := 'visitor';
  v_is_super boolean := false;
  v_is_admin_or_super boolean := false;
  v_is_mediator boolean := false;
  v_is_hub_manager boolean := false;

  v_driver_id uuid := NULL;
  v_driver_hub_id uuid := NULL;
  v_driver_verified boolean := false;

  v_managed_hub_ids uuid[] := ARRAY[]::uuid[];
  v_owned_listing_ids uuid[] := ARRAY[]::uuid[];
  v_staff_all_listing_ids uuid[] := ARRAY[]::uuid[];
  v_staff_order_listing_ids uuid[] := ARRAY[]::uuid[];
  v_staff_booking_listing_ids uuid[] := ARRAY[]::uuid[];
  v_staff_print_listing_ids uuid[] := ARRAY[]::uuid[];
  v_staff_visit_listing_ids uuid[] := ARRAY[]::uuid[];

  v_order_scope_ids uuid[] := ARRAY[]::uuid[];
  v_booking_scope_ids uuid[] := ARRAY[]::uuid[];
  v_print_scope_ids uuid[] := ARRAY[]::uuid[];
  v_visit_scope_ids uuid[] := ARRAY[]::uuid[];
  v_enquiry_scope_ids uuid[] := ARRAY[]::uuid[];
  v_owned_vehicle_ids uuid[] := ARRAY[]::uuid[];

  -- Output counters (strictly unresolved / in-flight items)
  c_notifications integer := 0;
  c_activity_active integer := 0;
  c_bookings_customer integer := 0;

  c_owner_orders integer := 0;
  c_owner_bookings integer := 0;
  c_owner_print integer := 0;
  c_owner_enquiries integer := 0;
  c_advertiser_actionable integer := 0;
  c_driver_actionable integer := 0;
  c_mediator_actionable integer := 0;
  c_hub_moderation integer := 0;
  c_admin_actionable integer := 0;

  -- Admin granular breakdown (populated ONLY for admin / super_admin)
  a_listings integer := 0;
  a_partner_apps integer := 0;
  a_pay_per_orders integer := 0;
  a_featured_requests integer := 0;
  a_categories integer := 0;
  a_bulletin_reports integer := 0;
  a_civic_reports integer := 0;
  a_contact_messages integer := 0;
  a_payment_intents integer := 0;

  -- Temp helpers
  t_count integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object(
      'notifications', 0,
      'activity_active', 0,
      'bookings_customer', 0,
      'owner_orders', 0,
      'owner_bookings', 0,
      'owner_print', 0,
      'owner_enquiries', 0,
      'advertiser_actionable', 0,
      'driver_actionable', 0,
      'mediator_actionable', 0,
      'hub_moderation', 0,
      'admin_actionable', 0,
      'admin_breakdown', '{}'::jsonb
    );
  END IF;

  -- Resolve role & superadmin status
  SELECT lower(trim(COALESCE(role, 'visitor')))
    INTO v_role
  FROM public.profiles
  WHERE id = v_uid;

  v_role := COALESCE(v_role, 'visitor');
  v_is_super := (v_role IN ('super_admin', 'superadmin')) OR public.is_super_admin();
  v_is_admin_or_super := v_is_super OR (v_role = 'admin');
  v_is_mediator := (v_role = 'mediator');

  -- Managed hubs
  SELECT COALESCE(array_agg(hm.hub_id), ARRAY[]::uuid[])
    INTO v_managed_hub_ids
  FROM public.hub_managers hm
  WHERE hm.profile_id = v_uid
    AND hm.is_active = true;

  v_is_hub_manager := (v_role = 'hub_manager') OR (COALESCE(array_length(v_managed_hub_ids, 1), 0) > 0);

  -- Driver profile
  SELECT d.id, d.hub_id, COALESCE(d.kyc_verified, false)
    INTO v_driver_id, v_driver_hub_id, v_driver_verified
  FROM public.drivers d
  WHERE d.profile_id = v_uid
    AND d.is_active = true
  LIMIT 1;

  -- Owned listings & vehicles
  SELECT COALESCE(array_agg(l.id), ARRAY[]::uuid[])
    INTO v_owned_listing_ids
  FROM public.listings l
  WHERE l.owner_id = v_uid
    AND COALESCE(l.lifecycle_status, 'active') <> 'archived_by_owner';

  SELECT COALESCE(array_agg(vl.id), ARRAY[]::uuid[])
    INTO v_owned_vehicle_ids
  FROM public.vehicle_listings vl
  WHERE vl.owner_id = v_uid;

  -- Active staff delegations (scoped per vertical)
  SELECT COALESCE(array_agg(DISTINCT sd.listing_id), ARRAY[]::uuid[])
    INTO v_staff_all_listing_ids
  FROM public.staff_delegations sd
  JOIN public.listings l ON l.id = sd.listing_id
  WHERE sd.staff_id = v_uid
    AND COALESCE(sd.status, 'active') = 'active'
    AND COALESCE(l.lifecycle_status, 'active') IN ('active', 'draining');

  SELECT COALESCE(array_agg(DISTINCT sd.listing_id), ARRAY[]::uuid[])
    INTO v_staff_order_listing_ids
  FROM public.staff_delegations sd
  JOIN public.listings l ON l.id = sd.listing_id
  WHERE sd.staff_id = v_uid
    AND COALESCE(sd.status, 'active') = 'active'
    AND COALESCE(l.lifecycle_status, 'active') IN ('active', 'draining')
    AND (
      sd.vertical_scopes IS NULL
      OR public._staff_scope_granted(sd.vertical_scopes, 'kitchen_shop_stock')
    );

  SELECT COALESCE(array_agg(DISTINCT sd.listing_id), ARRAY[]::uuid[])
    INTO v_staff_booking_listing_ids
  FROM public.staff_delegations sd
  JOIN public.listings l ON l.id = sd.listing_id
  WHERE sd.staff_id = v_uid
    AND COALESCE(sd.status, 'active') = 'active'
    AND COALESCE(l.lifecycle_status, 'active') IN ('active', 'draining')
    AND (
      sd.vertical_scopes IS NULL
      OR public._staff_scope_granted(sd.vertical_scopes, 'booking_checkin')
    );

  SELECT COALESCE(array_agg(DISTINCT sd.listing_id), ARRAY[]::uuid[])
    INTO v_staff_print_listing_ids
  FROM public.staff_delegations sd
  JOIN public.listings l ON l.id = sd.listing_id
  WHERE sd.staff_id = v_uid
    AND COALESCE(sd.status, 'active') = 'active'
    AND COALESCE(l.lifecycle_status, 'active') IN ('active', 'draining')
    AND (
      sd.vertical_scopes IS NULL
      OR public._staff_scope_granted(sd.vertical_scopes, 'print_queue')
    );

  SELECT COALESCE(array_agg(DISTINCT sd.listing_id), ARRAY[]::uuid[])
    INTO v_staff_visit_listing_ids
  FROM public.staff_delegations sd
  JOIN public.listings l ON l.id = sd.listing_id
  WHERE sd.staff_id = v_uid
    AND COALESCE(sd.status, 'active') = 'active'
    AND COALESCE(l.lifecycle_status, 'active') IN ('active', 'draining')
    AND (
      sd.vertical_scopes IS NULL
      OR public._staff_scope_granted(sd.vertical_scopes, 'property_visits')
    );

  v_order_scope_ids := v_owned_listing_ids || v_staff_order_listing_ids;
  v_booking_scope_ids := v_owned_listing_ids || v_staff_booking_listing_ids;
  v_print_scope_ids := v_owned_listing_ids || v_staff_print_listing_ids;
  v_visit_scope_ids := v_owned_listing_ids || v_staff_visit_listing_ids;
  v_enquiry_scope_ids := v_owned_listing_ids || v_staff_all_listing_ids;

  -- 1. Unread notifications
  SELECT COUNT(*)::integer INTO c_notifications
  FROM public.notifications
  WHERE user_id = v_uid
    AND COALESCE(is_read, false) = false;

  -- 2. Customer bookings (active / upcoming / pending)
  SELECT COUNT(*)::integer INTO t_count
  FROM public.vehicle_bookings
  WHERE customer_id = v_uid
    AND status IN ('soft_hold', 'pending_payment_confirm', 'confirmed', 'in_progress');
  c_bookings_customer := c_bookings_customer + t_count;

  SELECT COUNT(*)::integer INTO t_count
  FROM public.resource_bookings
  WHERE customer_id = v_uid
    AND booking_status IN ('pending_payment', 'confirmed', 'checked_in');
  c_bookings_customer := c_bookings_customer + t_count;

  SELECT COUNT(*)::integer INTO t_count
  FROM public.restaurant_table_reservations
  WHERE customer_id = v_uid
    AND status IN ('requested', 'confirmed', 'seated');
  c_bookings_customer := c_bookings_customer + t_count;

  SELECT COUNT(*)::integer INTO t_count
  FROM public.property_visit_requests
  WHERE requester_id = v_uid
    AND status IN ('requested', 'accepted', 'rescheduled');
  c_bookings_customer := c_bookings_customer + t_count;

  -- 3. Customer active in-flight activity (bookings + deliveries + shop/restaurant/print orders)
  c_activity_active := c_bookings_customer;

  SELECT COUNT(*)::integer INTO t_count
  FROM public.delivery_orders
  WHERE customer_id = v_uid
    AND status IN (
      'awaiting_payment', 'payment_submitted', 'escrow_held',
      'driver_assigned', 'picked_up', 'in_transit',
      'delivered_pending_confirm', 'return_in_transit', 'disputed'
    );
  c_activity_active := c_activity_active + t_count;

  SELECT COUNT(*)::integer INTO t_count
  FROM public.shop_orders
  WHERE customer_id = v_uid
    AND order_status IN ('pending_payment', 'confirmed', 'packing', 'ready_for_pickup', 'handed_to_rider');
  c_activity_active := c_activity_active + t_count;

  SELECT COUNT(*)::integer INTO t_count
  FROM public.restaurant_orders
  WHERE customer_id = v_uid
    AND kitchen_status IN ('pending_payment', 'new_order', 'preparing', 'ready_for_pickup', 'handed_to_rider');
  c_activity_active := c_activity_active + t_count;

  SELECT COUNT(*)::integer INTO t_count
  FROM public.print_orders
  WHERE customer_id = v_uid
    AND fulfillment_status IN ('draft', 'confirmed', 'printing', 'ready_for_pickup', 'handed_to_rider');
  c_activity_active := c_activity_active + t_count;

  -- 4. Owner / Delegated Staff queues
  IF COALESCE(array_length(v_order_scope_ids, 1), 0) > 0 THEN
    SELECT COUNT(*)::integer INTO t_count
    FROM public.shop_orders
    WHERE listing_id = ANY(v_order_scope_ids)
      AND order_status IN ('pending_payment', 'confirmed', 'packing', 'ready_for_pickup');
    c_owner_orders := c_owner_orders + t_count;

    SELECT COUNT(*)::integer INTO t_count
    FROM public.restaurant_orders
    WHERE listing_id = ANY(v_order_scope_ids)
      AND kitchen_status IN ('pending_payment', 'new_order', 'preparing', 'ready_for_pickup');
    c_owner_orders := c_owner_orders + t_count;
  END IF;

  IF COALESCE(array_length(v_booking_scope_ids, 1), 0) > 0 THEN
    SELECT COUNT(*)::integer INTO t_count
    FROM public.resource_bookings
    WHERE listing_id = ANY(v_booking_scope_ids)
      AND booking_status IN ('pending_payment', 'confirmed');
    c_owner_bookings := c_owner_bookings + t_count;

    SELECT COUNT(*)::integer INTO t_count
    FROM public.restaurant_table_reservations
    WHERE listing_id = ANY(v_booking_scope_ids)
      AND status = 'requested';
    c_owner_bookings := c_owner_bookings + t_count;
  END IF;

  IF COALESCE(array_length(v_visit_scope_ids, 1), 0) > 0 THEN
    SELECT COUNT(*)::integer INTO t_count
    FROM public.property_visit_requests
    WHERE listing_id = ANY(v_visit_scope_ids)
      AND status = 'requested';
    c_owner_bookings := c_owner_bookings + t_count;
  END IF;

  IF COALESCE(array_length(v_owned_vehicle_ids, 1), 0) > 0 THEN
    SELECT COUNT(*)::integer INTO t_count
    FROM public.vehicle_bookings
    WHERE vehicle_listing_id = ANY(v_owned_vehicle_ids)
      AND status IN ('soft_hold', 'pending_payment_confirm', 'confirmed');
    c_owner_bookings := c_owner_bookings + t_count;
  END IF;

  IF COALESCE(array_length(v_print_scope_ids, 1), 0) > 0 THEN
    SELECT COUNT(*)::integer INTO c_owner_print
    FROM public.print_orders
    WHERE listing_id = ANY(v_print_scope_ids)
      AND fulfillment_status IN ('draft', 'confirmed', 'printing', 'ready_for_pickup');
  END IF;

  IF COALESCE(array_length(v_enquiry_scope_ids, 1), 0) > 0 THEN
    SELECT COUNT(*)::integer INTO t_count
    FROM public.enquiries
    WHERE listing_id = ANY(v_enquiry_scope_ids)
      AND NULLIF(TRIM(COALESCE(owner_reply, '')), '') IS NULL
      AND COALESCE(status, 'open') NOT IN ('replied', 'resolved', 'closed', 'archived');
    c_owner_enquiries := c_owner_enquiries + t_count;

    SELECT COUNT(*)::integer INTO t_count
    FROM public.reviews
    WHERE listing_id = ANY(v_enquiry_scope_ids)
      AND NULLIF(TRIM(COALESCE(owner_reply, '')), '') IS NULL;
    c_owner_enquiries := c_owner_enquiries + t_count;
  END IF;

  -- 5. Advertiser actionable (pending pay-per verification, pending featured slots, expiring bulletins <=72h)
  SELECT COUNT(*)::integer INTO t_count
  FROM public.pay_per_orders
  WHERE user_id = v_uid
    AND status = 'pending_verification';
  c_advertiser_actionable := c_advertiser_actionable + t_count;

  SELECT COUNT(*)::integer INTO t_count
  FROM public.featured_requests
  WHERE requester_id = v_uid
    AND status IN ('submitted', 'under_review');
  c_advertiser_actionable := c_advertiser_actionable + t_count;

  SELECT COUNT(*)::integer INTO t_count
  FROM public.bulletins
  WHERE author_id = v_uid
    AND status = 'published'
    AND paid_until IS NOT NULL
    AND paid_until > now()
    AND paid_until <= now() + interval '72 hours';
  c_advertiser_actionable := c_advertiser_actionable + t_count;

  -- 6. Driver actionable (ONLY when active driver profile exists)
  IF v_driver_id IS NOT NULL THEN
    SELECT COUNT(*)::integer INTO t_count
    FROM public.delivery_orders
    WHERE driver_id = v_driver_id
      AND status IN ('driver_assigned', 'picked_up', 'in_transit', 'delivered_pending_confirm', 'return_in_transit');
    c_driver_actionable := c_driver_actionable + t_count;

    IF v_driver_verified THEN
      SELECT COUNT(*)::integer INTO t_count
      FROM public.delivery_orders
      WHERE driver_id IS NULL
        AND status = 'escrow_held'
        AND (v_driver_hub_id IS NULL OR hub_id = v_driver_hub_id);
      c_driver_actionable := c_driver_actionable + t_count;
    END IF;
  END IF;

  -- 7. Mediator actionable (role-gated: mediator / hub_manager / admin / super_admin)
  IF v_is_mediator OR v_is_hub_manager OR v_is_admin_or_super THEN
    IF v_is_admin_or_super OR COALESCE(array_length(v_managed_hub_ids, 1), 0) = 0 THEN
      SELECT COUNT(*)::integer INTO t_count
      FROM public.delivery_orders
      WHERE status IN ('payment_submitted', 'disputed')
         OR (status = 'escrow_held' AND driver_id IS NULL);
      c_mediator_actionable := c_mediator_actionable + t_count;

      SELECT COUNT(*)::integer INTO t_count
      FROM public.payment_intents
      WHERE status = 'pending_manual';
      c_mediator_actionable := c_mediator_actionable + t_count;

      SELECT COUNT(*)::integer INTO t_count
      FROM public.drivers
      WHERE kyc_status = 'pending'
        AND is_active = true;
      c_mediator_actionable := c_mediator_actionable + t_count;
    ELSE
      SELECT COUNT(*)::integer INTO t_count
      FROM public.delivery_orders
      WHERE hub_id = ANY(v_managed_hub_ids)
        AND (
          status IN ('payment_submitted', 'disputed')
          OR (status = 'escrow_held' AND driver_id IS NULL)
        );
      c_mediator_actionable := c_mediator_actionable + t_count;

      SELECT COUNT(*)::integer INTO t_count
      FROM public.payment_intents
      WHERE status = 'pending_manual';
      c_mediator_actionable := c_mediator_actionable + t_count;

      SELECT COUNT(*)::integer INTO t_count
      FROM public.drivers
      WHERE hub_id = ANY(v_managed_hub_ids)
        AND kyc_status = 'pending'
        AND is_active = true;
      c_mediator_actionable := c_mediator_actionable + t_count;
    END IF;
  END IF;

  -- 8. Hub Manager moderation queue (role-gated: hub_manager / admin / super_admin)
  IF v_is_hub_manager OR v_is_admin_or_super THEN
    IF v_is_admin_or_super OR COALESCE(array_length(v_managed_hub_ids, 1), 0) = 0 THEN
      SELECT COUNT(*)::integer INTO t_count FROM public.listings WHERE status = 'pending';
      c_hub_moderation := c_hub_moderation + t_count;

      SELECT COUNT(*)::integer INTO t_count FROM public.partner_applications WHERE status IN ('submitted', 'under_review');
      c_hub_moderation := c_hub_moderation + t_count;

      SELECT COUNT(*)::integer INTO t_count FROM public.bulletin_reports WHERE status = 'open';
      c_hub_moderation := c_hub_moderation + t_count;

      SELECT COUNT(*)::integer INTO t_count FROM public.civic_correction_reports WHERE status = 'open';
      c_hub_moderation := c_hub_moderation + t_count;

      SELECT COUNT(*)::integer INTO t_count FROM public.featured_requests WHERE status IN ('submitted', 'under_review');
      c_hub_moderation := c_hub_moderation + t_count;
    ELSE
      SELECT COUNT(*)::integer INTO t_count
      FROM public.listings
      WHERE status = 'pending'
        AND hub_id = ANY(v_managed_hub_ids);
      c_hub_moderation := c_hub_moderation + t_count;

      SELECT COUNT(*)::integer INTO t_count
      FROM public.partner_applications
      WHERE status IN ('submitted', 'under_review')
        AND hub_id = ANY(v_managed_hub_ids);
      c_hub_moderation := c_hub_moderation + t_count;

      SELECT COUNT(*)::integer INTO t_count
      FROM public.bulletin_reports br
      JOIN public.bulletins b ON b.id = br.bulletin_id
      WHERE br.status = 'open'
        AND b.hub_id = ANY(v_managed_hub_ids);
      c_hub_moderation := c_hub_moderation + t_count;

      SELECT COUNT(*)::integer INTO t_count
      FROM public.civic_correction_reports ccr
      JOIN public.listings l ON l.id = ccr.listing_id
      WHERE ccr.status = 'open'
        AND l.hub_id = ANY(v_managed_hub_ids);
      c_hub_moderation := c_hub_moderation + t_count;

      SELECT COUNT(*)::integer INTO t_count
      FROM public.featured_requests
      WHERE status IN ('submitted', 'under_review')
        AND hub_id = ANY(v_managed_hub_ids);
      c_hub_moderation := c_hub_moderation + t_count;
    END IF;
  END IF;

  -- 9. Admin / Superadmin actionable queues (strictly admin / super_admin ONLY)
  IF v_is_admin_or_super THEN
    SELECT COUNT(*)::integer INTO a_listings FROM public.listings WHERE status = 'pending';
    SELECT COUNT(*)::integer INTO a_partner_apps FROM public.partner_applications WHERE status IN ('submitted', 'under_review');
    SELECT COUNT(*)::integer INTO a_pay_per_orders FROM public.pay_per_orders WHERE status = 'pending_verification';
    SELECT COUNT(*)::integer INTO a_featured_requests FROM public.featured_requests WHERE status IN ('submitted', 'under_review');
    SELECT COUNT(*)::integer INTO a_categories FROM public.categories WHERE review_status = 'pending_review';
    SELECT COUNT(*)::integer INTO a_bulletin_reports FROM public.bulletin_reports WHERE status = 'open';
    SELECT COUNT(*)::integer INTO a_civic_reports FROM public.civic_correction_reports WHERE status = 'open';
    SELECT COUNT(*)::integer INTO a_contact_messages FROM public.contact_messages WHERE status = 'new';
    SELECT COUNT(*)::integer INTO a_payment_intents FROM public.payment_intents WHERE status = 'pending_manual';

    c_admin_actionable :=
      a_listings + a_partner_apps + a_pay_per_orders + a_featured_requests +
      a_categories + a_bulletin_reports + a_civic_reports + a_contact_messages + a_payment_intents;
  END IF;

  RETURN jsonb_build_object(
    'notifications', c_notifications,
    'activity_active', c_activity_active,
    'bookings_customer', c_bookings_customer,
    'owner_orders', c_owner_orders,
    'owner_bookings', c_owner_bookings,
    'owner_print', c_owner_print,
    'owner_enquiries', c_owner_enquiries,
    'advertiser_actionable', c_advertiser_actionable,
    'driver_actionable', c_driver_actionable,
    'mediator_actionable', c_mediator_actionable,
    'hub_moderation', c_hub_moderation,
    'admin_actionable', c_admin_actionable,
    'admin_breakdown', CASE
      WHEN v_is_admin_or_super THEN jsonb_build_object(
        'listings', a_listings,
        'partner_applications', a_partner_apps,
        'pay_per_orders', a_pay_per_orders,
        'featured_requests', a_featured_requests,
        'categories', a_categories,
        'bulletin_reports', a_bulletin_reports,
        'civic_reports', a_civic_reports,
        'contact_messages', a_contact_messages,
        'payment_intents', a_payment_intents
      )
      ELSE '{}'::jsonb
    END
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_my_actionable_badges() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.get_my_actionable_badges() FROM anon;
GRANT EXECUTE ON FUNCTION public.get_my_actionable_badges() TO authenticated;

COMMIT;
