import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  DEV_TEST_ROLE_ACCOUNTS,
  DEV_TEST_ROLE_PASSWORD,
  ENABLE_DEV_ROLE_SHORTCUTS,
} from '@/lib/auth/dev-test-accounts';

/**
 * Pass V13-A: On-Demand Idempotent Staging Test Role Account Provisioner
 *
 * // REMOVE BEFORE LIVE PRODUCTION LAUNCH
 * Ensures the 5 test role accounts exist in Supabase Auth and `public.profiles`
 * with their real operational hats (Owner listing + plan, Staff delegation,
 * Driver profile, Lamka Hub Manager link) whenever a tester clicks a 1-tap role
 * shortcut on `/login` or `AuthModal`.
 */
export async function POST() {
  if (!ENABLE_DEV_ROLE_SHORTCUTS) {
    return NextResponse.json(
      { ok: false, error: 'Test role shortcuts are disabled.' },
      { status: 403 }
    );
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      {
        ok: false,
        error:
          'SUPABASE_SERVICE_ROLE_KEY is not configured on this server environment.',
      },
      { status: 503 }
    );
  }

  try {
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { data: usersList, error: listErr } =
      await admin.auth.admin.listUsers({
        page: 1,
        perPage: 1000,
      });
    if (listErr) {
      throw new Error(listErr.message);
    }

    const existingByEmail = new Map<string, { id: string }>();
    for (const u of usersList?.users || []) {
      if (u.email) {
        existingByEmail.set(u.email.toLowerCase(), { id: u.id });
      }
    }

    const { data: hubs } = await admin
      .from('service_hubs')
      .select('id, name, slug')
      .order('is_default', { ascending: false });

    const lamkaHub =
      (hubs || []).find((h) =>
        /churachandpur|lamka|ccpur/i.test(`${h.slug} ${h.name}`)
      ) ||
      (hubs || [])[0] ||
      null;
    const lamkaHubId = lamkaHub?.id || null;

    const userIdsByKey: Record<string, string> = {};
    const testRoleAccounts = DEV_TEST_ROLE_ACCOUNTS.filter(
      (a) => a.id !== 'super_admin'
    );

    for (const acct of testRoleAccounts) {
      const emailLower = acct.email.toLowerCase();
      const existing = existingByEmail.get(emailLower);
      let userId = existing?.id || '';

      if (userId) {
        await admin.auth.admin.updateUserById(userId, {
          password: DEV_TEST_ROLE_PASSWORD,
          email_confirm: true,
          user_metadata: {
            full_name: acct.fullName,
            username: acct.username,
            phone: acct.phone,
            role: acct.dbRole,
          },
        });
      } else {
        const { data: created, error: createErr } =
          await admin.auth.admin.createUser({
            email: acct.email,
            password: DEV_TEST_ROLE_PASSWORD,
            email_confirm: true,
            user_metadata: {
              full_name: acct.fullName,
              username: acct.username,
              phone: acct.phone,
              role: acct.dbRole,
            },
          });
        if (createErr || !created?.user?.id) {
          throw new Error(
            createErr?.message || `Failed to create ${acct.email}`
          );
        }
        userId = created.user.id;
      }

      userIdsByKey[acct.id] = userId;

      const profilePayload = {
        id: userId,
        email: acct.email,
        username: acct.username,
        full_name: acct.fullName,
        name: acct.fullName,
        phone: acct.phone,
        role: acct.dbRole,
        ...(lamkaHubId ? { default_hub_id: lamkaHubId } : {}),
      };
      const { error: profErr } = await admin
        .from('profiles')
        .upsert(profilePayload, { onConflict: 'id' });
      if (profErr) {
        const { default_hub_id: _dh, ...fallbackProfile } = profilePayload;
        await admin
          .from('profiles')
          .upsert(fallbackProfile, { onConflict: 'id' });
      }
    }

    // Seed Owner listing + plan
    const ownerId = userIdsByKey.owner;
    let ownerListingId: string | null = null;
    if (ownerId) {
      const { data: existingListing } = await admin
        .from('listings')
        .select('id')
        .eq('owner_id', ownerId)
        .limit(1)
        .maybeSingle();

      if (existingListing?.id) {
        ownerListingId = existingListing.id;
      } else {
        const { data: insertedListing } = await admin
          .from('listings')
          .insert({
            title: 'Lamka Heritage Kitchen & Store (Test Owner)',
            category: 'business',
            subcategory: 'Restaurant & Daily Store',
            listing_vertical: 'restaurant_food',
            short_description:
              'Full-featured test business listing for Owner & Delegated Staff role verification.',
            description:
              'Authentic Lamka hill cuisine and daily essentials. Used for staging verification of Owner and Staff operational hats.',
            locality: 'Zenhang Lamka',
            address: 'Tedim Road, Zenhang Lamka, Churachandpur',
            coordinates: { lat: 24.3328, lng: 93.6982 },
            status: 'published',
            lifecycle_status: 'active',
            is_verified: true,
            owner_id: ownerId,
            contact_phone: '+919862010002',
            ...(lamkaHubId ? { hub_id: lamkaHubId } : {}),
          })
          .select('id')
          .single();
        ownerListingId = insertedListing?.id || null;
      }

      if (ownerListingId) {
        await admin.from('listing_restaurant_profiles').upsert(
          {
            listing_id: ownerListingId,
            ...(lamkaHubId ? { hub_id: lamkaHubId } : {}),
            is_kitchen_open: true,
            cuisines: ['Tribal Cuisine', 'Fast Food', 'Beverages'],
            avg_cost_for_two_inr: 350,
            allow_takeaway: true,
            allow_pick_n_drop: true,
            allow_table_booking: true,
          },
          { onConflict: 'listing_id' }
        );
      }
    }

    // Seed Staff delegation
    const staffId = userIdsByKey.staff;
    if (staffId && ownerListingId && ownerId) {
      await admin.from('staff_delegations').upsert(
        {
          listing_id: ownerListingId,
          staff_id: staffId,
          staff_email: 'staff.test@ddoodle.in',
          staff_name: 'Chingnu Delegated Staff (Test)',
          granted_by_owner_id: ownerId,
          status: 'active',
          vertical_scopes: ['kitchen_shop_stock', 'enquiries'],
          permissions: {
            can_edit_details: true,
            can_manage_media: true,
            can_manage_catalogue: true,
            can_reply_enquiries: true,
            can_reply_reviews: true,
            can_view_analytics: true,
          },
        },
        { onConflict: 'listing_id,staff_id' }
      );
    }

    // Seed Driver profile
    const driverId = userIdsByKey.driver;
    if (driverId) {
      await admin.from('driver_profiles').upsert(
        {
          user_id: driverId,
          ...(lamkaHubId ? { hub_id: lamkaHubId } : {}),
          full_name: 'Paumin Driver Fleet (Test)',
          phone: '+919862010004',
          vehicle_type: 'two_wheeler',
          vehicle_plate_no: 'MN-02-T-2026',
          is_verified: true,
          is_online: true,
          status: 'active',
        },
        { onConflict: 'user_id' }
      );
    }

    // Seed Lamka Hub Manager
    const managerId = userIdsByKey.hub_manager;
    if (managerId && lamkaHubId) {
      await admin.from('hub_managers').upsert(
        {
          hub_id: lamkaHubId,
          profile_id: managerId,
          role_label: 'Lamka Branch Manager (Test)',
          can_confirm_manual_payments: true,
          can_edit_rates: true,
          is_active: true,
        },
        { onConflict: 'hub_id,profile_id' }
      );
    }

    return NextResponse.json({
      ok: true,
      seededRoles: Object.keys(userIdsByKey),
    });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : 'Failed to seed staging test role accounts.',
      },
      { status: 500 }
    );
  }
}
