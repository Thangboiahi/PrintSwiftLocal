/**
 * DD oodle — Pass V13-A: Idempotent Role Test Accounts Seeder
 *
 * Usage:
 *   node scripts/seed-test-role-accounts.mjs
 *
 * Reads `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` from `.env.local` or `.env`.
 * Creates/updates the 5 staging test role accounts (`visitor`, `owner`, `staff`, `driver`, `hub_manager`)
 * with confirmed emails, `@username` profiles, and genuine role links (Owner listing + composable
 * subscription, Staff delegation, Driver profile, and Lamka Hub Manager assignment).
 */

import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@supabase/supabase-js';

function loadEnvFiles() {
  const candidates = ['.env.local', '.env'];
  for (const rel of candidates) {
    const full = path.resolve(process.cwd(), rel);
    if (!fs.existsSync(full)) continue;
    const raw = fs.readFileSync(full, 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx <= 0) continue;
      const key = trimmed.slice(0, eqIdx).trim();
      let val = trimmed.slice(eqIdx + 1).trim();
      if (
        (val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))
      ) {
        val = val.slice(1, -1);
      }
      if (!process.env[key]) {
        process.env[key] = val;
      }
    }
  }
}

loadEnvFiles();

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const testPassword = process.env.NEXT_PUBLIC_DEV_TEST_PASSWORD || 'Test@1234';

if (!supabaseUrl || !serviceRoleKey) {
  console.warn(
    '[seed-test-role-accounts] Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local / .env. Skipping live Auth seed.'
  );
  process.exit(0);
}

const admin = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const TEST_ACCOUNTS = [
  {
    key: 'visitor',
    email: 'visitor.test@ddoodle.in',
    username: 'test_visitor',
    full_name: 'Liankhan Visitor (Test)',
    phone: '+919862010001',
    role: 'visitor',
  },
  {
    key: 'owner',
    email: 'owner.test@ddoodle.in',
    username: 'test_owner',
    full_name: 'Thangaihte Business Owner (Test)',
    phone: '+919862010002',
    role: 'owner',
  },
  {
    key: 'staff',
    email: 'staff.test@ddoodle.in',
    username: 'test_staff',
    full_name: 'Chingnu Delegated Staff (Test)',
    phone: '+919862010003',
    role: 'staff',
  },
  {
    key: 'driver',
    email: 'driver.test@ddoodle.in',
    username: 'test_driver',
    full_name: 'Paumin Driver Fleet (Test)',
    phone: '+919862010004',
    role: 'driver',
  },
  {
    key: 'hub_manager',
    email: 'manager.lamka@ddoodle.in',
    username: 'test_manager_lamka',
    full_name: 'Lamka Hub Manager (Test)',
    phone: '+919862010005',
    role: 'hub_manager',
  },
];

async function run() {
  console.log('[seed-test-role-accounts] Listing existing users...');
  const { data: usersList, error: listErr } = await admin.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (listErr) {
    throw new Error(`Failed to list users: ${listErr.message}`);
  }

  const existingByEmail = new Map();
  for (const u of usersList?.users || []) {
    if (u.email) {
      existingByEmail.set(u.email.toLowerCase(), u);
    }
  }

  // Resolve Lamka / Churachandpur hub ID
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
  console.log(
    `[seed-test-role-accounts] Target Lamka Hub: ${lamkaHub?.name || 'None'} (${lamkaHubId})`
  );

  const userIdsByKey = {};

  for (const acct of TEST_ACCOUNTS) {
    const emailLower = acct.email.toLowerCase();
    const existing = existingByEmail.get(emailLower);
    let userId = existing?.id || null;

    if (userId) {
      const { error: updErr } = await admin.auth.admin.updateUserById(userId, {
        password: testPassword,
        email_confirm: true,
        user_metadata: {
          full_name: acct.full_name,
          username: acct.username,
          phone: acct.phone,
          role: acct.role,
        },
      });
      if (updErr) {
        console.warn(
          `[seed-test-role-accounts] Warn updating ${acct.email}: ${updErr.message}`
        );
      } else {
        console.log(
          `[seed-test-role-accounts] Updated existing auth user: ${acct.email} (${userId})`
        );
      }
    } else {
      const { data: created, error: createErr } =
        await admin.auth.admin.createUser({
          email: acct.email,
          password: testPassword,
          email_confirm: true,
          user_metadata: {
            full_name: acct.full_name,
            username: acct.username,
            phone: acct.phone,
            role: acct.role,
          },
        });
      if (createErr) {
        throw new Error(
          `Failed to create ${acct.email}: ${createErr.message}`
        );
      }
      userId = created.user.id;
      console.log(
        `[seed-test-role-accounts] Created auth user: ${acct.email} (${userId})`
      );
    }

    userIdsByKey[acct.key] = userId;

    // Upsert public.profiles row
    const profilePayload = {
      id: userId,
      email: acct.email,
      username: acct.username,
      full_name: acct.full_name,
      name: acct.full_name,
      phone: acct.phone,
      role: acct.role,
      ...(lamkaHubId ? { default_hub_id: lamkaHubId } : {}),
    };

    const { error: profErr } = await admin
      .from('profiles')
      .upsert(profilePayload, { onConflict: 'id' });
    if (profErr) {
      // Fallback without default_hub_id if column missing
      const { default_hub_id: _dh, ...fallbackProfile } = profilePayload;
      await admin
        .from('profiles')
        .upsert(fallbackProfile, { onConflict: 'id' });
    }
  }

  // 1. Seed Owner test listing + active composable subscription
  const ownerId = userIdsByKey.owner;
  let ownerListingId = null;
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
      const { data: insertedListing, error: listInsertErr } = await admin
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
      if (!listInsertErr && insertedListing?.id) {
        ownerListingId = insertedListing.id;
      }
    }

    if (ownerListingId) {
      // Ensure restaurant profile exists
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

      // Attach an active subscription plan if any plan exists
      const { data: planRow } = await admin
        .from('subscription_plans')
        .select('id')
        .eq('is_active', true)
        .order('price_inr', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (planRow?.id) {
        const { data: existingSub } = await admin
          .from('user_subscriptions')
          .select('id')
          .eq('user_id', ownerId)
          .eq('listing_id', ownerListingId)
          .limit(1)
          .maybeSingle();

        if (!existingSub?.id) {
          await admin.from('user_subscriptions').insert({
            user_id: ownerId,
            listing_id: ownerListingId,
            plan_id: planRow.id,
            status: 'active',
            starts_at: new Date().toISOString(),
            expires_at: new Date(
              Date.now() + 90 * 24 * 3600 * 1000
            ).toISOString(),
          });
        }
      }
    }
  }

  // 2. Seed Delegated Staff assignment on Owner's listing
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

  // 3. Seed Verified Driver profile + vehicle
  const driverUserId = userIdsByKey.driver;
  if (driverUserId) {
    await admin.from('driver_profiles').upsert(
      {
        user_id: driverUserId,
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

    const { data: existingDriverRow } = await admin
      .from('drivers')
      .select('id')
      .eq('user_id', driverUserId)
      .limit(1)
      .maybeSingle();

    if (!existingDriverRow?.id) {
      await admin.from('drivers').insert({
        user_id: driverUserId,
        ...(lamkaHubId ? { hub_id: lamkaHubId } : {}),
        full_name: 'Paumin Driver Fleet (Test)',
        phone: '+919862010004',
        license_number: 'MN022026009911',
        kyc_verified: true,
        is_active: true,
      });
    }
  }

  // 4. Seed Lamka Hub Manager assignment
  const managerUserId = userIdsByKey.hub_manager;
  if (managerUserId && lamkaHubId) {
    await admin.from('hub_managers').upsert(
      {
        hub_id: lamkaHubId,
        profile_id: managerUserId,
        role_label: 'Lamka Branch Manager (Test)',
        can_confirm_manual_payments: true,
        can_edit_rates: true,
        is_active: true,
      },
      { onConflict: 'hub_id,profile_id' }
    );
  }

  console.log(
    '[seed-test-role-accounts] Successfully seeded all 5 test role accounts!'
  );
}

run().catch((err) => {
  console.error('[seed-test-role-accounts] Error:', err);
  process.exit(1);
});
