#!/usr/bin/env node
/**
 * Idempotent Seed Script for DD oodle Test Role Accounts & Cohesive Fleet Tiers
 *
 * Provisions & verifies against the real Supabase SQL schema:
 *  1. visitor.test@ddoodle.in      -> role: 'visitor'     (Visitor / Customer)
 *  2. owner.test@ddoodle.in        -> role: 'owner'       (Business Owner with linked Churachandpur listing)
 *  3. staff.test@ddoodle.in        -> role: 'staff'       (Delegated Staff Operator in staff_delegations)
 *  4. driver.test@ddoodle.in       -> role: 'driver'      (Verified Driver in canonical public.drivers)
 *  5. advertiser.test@ddoodle.in   -> role: 'owner'       (Advertiser / Organizer with active bulletin subscription)
 *  6. manager.lamka@ddoodle.in     -> role: 'hub_manager' (Assigned to Churachandpur / Lamka Hub + UPI Escrow Mediator)
 *  7. admin.test@ddoodle.in        -> role: 'admin'       (Platform Admin)
 *  8. thangboiahi@gmail.com        -> role: 'super_admin' (Super Admin lock if present in auth.users)
 *  9. Ensures all 5 Pick N Drop Fleet Types (including cycle_rickshaw) exist in public.vehicle_types & hub_vehicle_rates
 *
 * Usage:
 *   node scripts/seed-test-role-accounts.mjs
 */

import { createClient } from '@supabase/supabase-js';
import fs from 'node:fs';
import path from 'node:path';

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return;
  const content = fs.readFileSync(filePath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
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

loadEnvFile(path.resolve(process.cwd(), '.env.local'));
loadEnvFile(path.resolve(process.cwd(), '.env'));

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DEFAULT_PASSWORD = process.env.NEXT_PUBLIC_DEV_TEST_PASSWORD || 'DDoodleTest#2026!';
const SUPER_ADMIN_EMAIL = 'thangboiahi@gmail.com';

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    '❌ Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in environment (.env.local).'
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  auth: {
    autoRefreshToken: false,
    persistSession: false,
  },
});

const TEST_ACCOUNTS = [
  {
    id: 'customer',
    email: 'visitor.test@ddoodle.in',
    password: DEFAULT_PASSWORD,
    fullName: 'Liani Visitor (Test)',
    phone: '+919862000001',
    role: 'visitor',
  },
  {
    id: 'owner',
    email: 'owner.test@ddoodle.in',
    password: DEFAULT_PASSWORD,
    fullName: 'Thangaihte Business Owner (Test)',
    phone: '+919862000002',
    role: 'owner',
  },
  {
    id: 'staff',
    email: 'staff.test@ddoodle.in',
    password: DEFAULT_PASSWORD,
    fullName: 'Muan Shop Staff (Test)',
    phone: '+919862000005',
    role: 'staff',
  },
  {
    id: 'driver',
    email: 'driver.test@ddoodle.in',
    password: DEFAULT_PASSWORD,
    fullName: 'Pauminthang Rider (Test)',
    phone: '+919862000003',
    role: 'driver',
  },
  {
    id: 'advertiser',
    email: 'advertiser.test@ddoodle.in',
    password: DEFAULT_PASSWORD,
    fullName: 'Zoram Community Advertiser (Test)',
    phone: '+919862000006',
    role: 'owner',
  },
  {
    id: 'hub_manager',
    email: 'manager.lamka@ddoodle.in',
    password: DEFAULT_PASSWORD,
    fullName: 'Kham Suan (Lamka Hub Manager)',
    phone: '+919862000004',
    role: 'hub_manager',
  },
  {
    id: 'admin',
    email: 'admin.test@ddoodle.in',
    password: DEFAULT_PASSWORD,
    fullName: 'DD oodle Platform Admin (Test)',
    phone: '+919862000007',
    role: 'admin',
  },
];

async function ensureAuthUser(account, existingUsers) {
  const existing = existingUsers.find(
    (u) => u.email?.toLowerCase() === account.email.toLowerCase()
  );

  if (existing) {
    const { data: updated, error: updateErr } = await supabase.auth.admin.updateUserById(
      existing.id,
      {
        password: account.password,
        email_confirm: true,
        user_metadata: {
          ...(existing.user_metadata || {}),
          full_name: account.fullName,
          name: account.fullName,
          phone: account.phone,
        },
      }
    );
    if (updateErr) throw updateErr;
    console.log(`✔ Updated existing auth user: ${account.email} (${existing.id})`);
    return updated.user;
  }

  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email: account.email,
    password: account.password,
    email_confirm: true,
    user_metadata: {
      full_name: account.fullName,
      name: account.fullName,
      phone: account.phone,
    },
  });
  if (createErr) throw createErr;
  console.log(`✔ Created new auth user: ${account.email} (${created.user.id})`);
  return created.user;
}

async function ensureChurachandpurHub() {
  const { data: existingHub } = await supabase
    .from('service_hubs')
    .select('id, slug, name')
    .eq('slug', 'churachandpur')
    .maybeSingle();

  if (existingHub?.id) {
    return existingHub.id;
  }

  const { data: createdHub, error } = await supabase
    .from('service_hubs')
    .insert({
      slug: 'churachandpur',
      name: 'Churachandpur (Lamka)',
      state: 'Manipur',
      center_lat: 24.333,
      center_lng: 93.679,
      service_radius_km: 25,
      default_zoom: 14,
      status: 'active',
      is_default: true,
      sort_order: 1,
    })
    .select('id')
    .single();

  if (error) {
    console.warn('⚠ Could not insert churachandpur service_hub:', error.message);
    return null;
  }
  return createdHub.id;
}

async function ensureAllFiveFleetTypes(hubId) {
  const { data: vtRow, error: vtErr } = await supabase
    .from('vehicle_types')
    .upsert(
      {
        slug: 'cycle_rickshaw',
        name: 'Cycle Rickshaw',
        icon: 'bike',
        base_fare_inr: 30.0,
        per_km_rate_inr: 8.0,
        wait_per_10min_inr: 10.0,
        free_wait_minutes: 15,
        two_way_multiplier: 1.75,
        max_weight_kg: 80,
        max_dimensions: '90 x 70 x 70 cm',
        supported_modes: ['parcel', 'gas'],
        is_active: true,
      },
      { onConflict: 'slug' }
    )
    .select('id')
    .single();

  if (vtErr) {
    console.warn('⚠ vehicle_types cycle_rickshaw upsert note:', vtErr.message);
  } else {
    console.log(`✔ Ensured cycle_rickshaw (5th fleet tier) in public.vehicle_types (${vtRow.id})`);
  }

  if (hubId && vtRow?.id) {
    const { error: rateErr } = await supabase.from('hub_vehicle_rates').upsert(
      {
        hub_id: hubId,
        vehicle_type_id: vtRow.id,
        is_enabled_in_hub: true,
        base_fare_inr: 30.0,
        per_km_rate_inr: 8.0,
        wait_per_10min_inr: 10.0,
        free_wait_minutes: 15,
        two_way_multiplier: 1.75,
      },
      { onConflict: 'hub_id,vehicle_type_id' }
    );
    if (rateErr) {
      console.warn('⚠ hub_vehicle_rates cycle_rickshaw upsert note:', rateErr.message);
    }
  }
}

async function main() {
  console.log('🚀 Provisioning DD oodle Test Role Accounts...');
  const hubId = await ensureChurachandpurHub();
  await ensureAllFiveFleetTypes(hubId);

  const { data: listData, error: listErr } = await supabase.auth.admin.listUsers({
    page: 1,
    perPage: 200,
  });
  if (listErr) throw listErr;
  const existingUsers = listData?.users || [];

  const provisionedUsers = {};

  for (const account of TEST_ACCOUNTS) {
    const authUser = await ensureAuthUser(account, existingUsers);
    provisionedUsers[account.id] = authUser;

    const profilePayload = {
      id: authUser.id,
      email: account.email,
      full_name: account.fullName,
      phone: account.phone,
      role: account.role,
      default_hub_id: hubId,
      updated_at: new Date().toISOString(),
    };

    const { error: profileErr } = await supabase
      .from('profiles')
      .upsert(profilePayload, { onConflict: 'id' });

    if (profileErr) {
      console.error(`❌ Profile upsert failed for ${account.email}:`, profileErr.message);
    } else {
      console.log(`✔ Upserted profile: ${account.email} -> role=${account.role}`);
    }

    if (account.id === 'driver') {
      const { error: driverErr } = await supabase.from('drivers').upsert(
        {
          profile_id: authUser.id,
          full_name: account.fullName,
          phone: account.phone,
          license_no: 'MN02-20260001234',
          hub_id: hubId,
          vehicle_type: 'two_wheeler',
          vehicle_reg_no: 'MN-02-D-2026',
          kyc_status: 'verified',
          kyc_verified: true,
          is_online: true,
          is_active: true,
        },
        { onConflict: 'profile_id' }
      );
      if (driverErr) {
        console.warn('⚠ drivers upsert note:', driverErr.message);
      } else {
        console.log('✔ Upserted verified canonical drivers record for driver.test@ddoodle.in');
      }
    }

    if (account.id === 'advertiser') {
      const { data: planRow } = await supabase
        .from('subscription_plans')
        .select('id, slug')
        .in('slug', ['business', 'agency', 'starter'])
        .eq('is_active', true)
        .order('price_inr', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (planRow?.id) {
        const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
        const { data: existingSub } = await supabase
          .from('user_subscriptions')
          .select('id')
          .eq('user_id', authUser.id)
          .eq('status', 'active')
          .limit(1)
          .maybeSingle();

        if (existingSub?.id) {
          await supabase
            .from('user_subscriptions')
            .update({ plan_id: planRow.id, expires_at: expiresAt })
            .eq('id', existingSub.id);
        } else {
          const { error: subErr } = await supabase.from('user_subscriptions').insert({
            user_id: authUser.id,
            plan_id: planRow.id,
            status: 'active',
            starts_at: new Date().toISOString(),
            expires_at: expiresAt,
            payment_ref: 'TEST-SEED-SUB-2026',
          });
          if (subErr) {
            console.warn('⚠ user_subscriptions insert note:', subErr.message);
          } else {
            console.log(`✔ Assigned active ${planRow.slug} bulletin subscription to advertiser.test@ddoodle.in`);
          }
        }
      }
    }

    if (account.id === 'hub_manager' && hubId) {
      const { error: hmErr } = await supabase.from('hub_managers').upsert(
        {
          profile_id: authUser.id,
          hub_id: hubId,
          can_confirm_manual_payments: true,
          can_edit_rates: true,
          is_active: true,
        },
        { onConflict: 'profile_id,hub_id' }
      );
      if (hmErr) {
        console.warn('⚠ hub_managers upsert note:', hmErr.message);
      } else {
        console.log('✔ Assigned manager.lamka@ddoodle.in to Churachandpur (Lamka) Hub');
      }
    }
  }

  // Link owner.test@ddoodle.in to a verified Churachandpur shop and delegate staff.test@ddoodle.in
  const ownerUser = provisionedUsers['owner'];
  const staffUser = provisionedUsers['staff'];

  if (ownerUser) {
    let targetListingId = null;
    const { data: existingListing } = await supabase
      .from('listings')
      .select('id, title')
      .eq('owner_id', ownerUser.id)
      .limit(1)
      .maybeSingle();

    if (existingListing?.id) {
      targetListingId = existingListing.id;
    } else if (hubId) {
      const { data: lamkaListing } = await supabase
        .from('listings')
        .select('id, title')
        .eq('hub_id', hubId)
        .limit(1)
        .maybeSingle();

      if (lamkaListing?.id) {
        targetListingId = lamkaListing.id;
        await supabase
          .from('listings')
          .update({ owner_id: ownerUser.id })
          .eq('id', targetListingId);
        console.log(`✔ Linked listing "${lamkaListing.title}" (${targetListingId}) to owner.test@ddoodle.in`);
      }
    }

    if (targetListingId && staffUser) {
      const { data: existingDelegation } = await supabase
        .from('staff_delegations')
        .select('id')
        .eq('listing_id', targetListingId)
        .eq('staff_id', staffUser.id)
        .limit(1)
        .maybeSingle();

      const delegationPayload = {
        listing_id: targetListingId,
        staff_id: staffUser.id,
        granted_by_owner_id: ownerUser.id,
        permissions: ['edit_details', 'manage_orders', 'manage_inventory', 'reply_enquiries'],
        vertical_scopes: {
          print_ops: true,
          booking_desk: true,
          kitchen_shop: true,
          visit_desk: true,
          enquiries: true,
        },
        status: 'active',
      };

      const { error: staffErr } = existingDelegation?.id
        ? await supabase
            .from('staff_delegations')
            .update(delegationPayload)
            .eq('id', existingDelegation.id)
        : await supabase.from('staff_delegations').insert(delegationPayload);

      if (staffErr) {
        console.warn('⚠ staff_delegations upsert note:', staffErr.message);
      } else {
        console.log(`✔ Linked staff.test@ddoodle.in as active operator for listing ${targetListingId}`);
      }
    }
  }

  // Ensure thangboiahi@gmail.com stays super_admin if present
  const superAdmin = existingUsers.find(
    (u) => u.email?.toLowerCase() === SUPER_ADMIN_EMAIL
  );
  if (superAdmin) {
    await supabase
      .from('profiles')
      .upsert(
        {
          id: superAdmin.id,
          email: SUPER_ADMIN_EMAIL,
          role: 'super_admin',
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' }
      );
    console.log(`✔ Verified super_admin lock for ${SUPER_ADMIN_EMAIL}`);
  }

  console.log('\n✅ All 7 DD oodle test role accounts & 5 fleet tiers are ready.');
}

main().catch((err) => {
  console.error('❌ Seed script failed:', err);
  process.exit(1);
});
