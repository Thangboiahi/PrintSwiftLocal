import { timingSafeEqual } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import {
  DEV_TEST_ACCOUNTS,
  ENABLE_DEV_ROLE_SHORTCUTS,
} from '@/lib/auth/dev-test-accounts';

export const dynamic = 'force-dynamic';

function normalizeEnvValue(raw: string | undefined): string {
  if (!raw) return '';
  let val = raw.trim();
  if (
    val.length >= 2 &&
    ((val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'")))
  ) {
    val = val.slice(1, -1).trim();
  }
  return val;
}

function hasValidSeedSecret(req: NextRequest): boolean {
  const configuredSecret = normalizeEnvValue(process.env.SEED_SECRET);
  if (!configuredSecret) return false;
  const providedSecret = req.headers.get('x-seed-secret')?.trim();
  if (!providedSecret) return false;
  const expectedBuf = Buffer.from(configuredSecret, 'utf8');
  const providedBuf = Buffer.from(providedSecret, 'utf8');
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

function classifySupabaseAdminKey(key: string): 'jwt' | 'sb_secret' | 'sb_publishable' | 'placeholder' | 'unknown' {
  if (!key || /^your[-_]|^MY_/i.test(key)) return 'placeholder';
  if (key.startsWith('sb_secret_')) return 'sb_secret';
  if (key.startsWith('sb_publishable_')) return 'sb_publishable';
  if (key.split('.').length === 3 && key.startsWith('eyJ')) return 'jwt';
  return 'unknown';
}

function decodeJwtRole(jwt: string): string | null {
  try {
    const parts = jwt.split('.');
    if (parts.length !== 3) return null;
    const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
    const payload = JSON.parse(payloadJson) as { role?: unknown };
    return typeof payload.role === 'string' ? payload.role : null;
  } catch {
    return null;
  }
}

/**
 * POST /api/dev/seed-test-accounts
 *
 * Dev/Test endpoint that idempotently provisions the 7 pre-configured role test accounts
 * against the real Supabase SQL schema using SUPABASE_SERVICE_ROLE_KEY (or SUPABASE_SECRET_KEY).
 *
 * Security Gate:
 * - Authorizes strictly via `x-seed-secret` matching `process.env.SEED_SECRET` via `timingSafeEqual`
 *   (no user Authorization Bearer session token is required).
 * - In production (NODE_ENV === 'production'), strictly rejected with 403 unless `x-seed-secret` matches.
 * - Outside production, requires either a valid `x-seed-secret` or `ENABLE_DEV_ROLE_SHORTCUTS`.
 */
export async function POST(req: NextRequest) {
  const isProd = process.env.NODE_ENV === 'production';
  const validSecret = hasValidSeedSecret(req);

  if (isProd && !validSecret) {
    return NextResponse.json(
      { error: 'Not authorized in production environment. Provide a valid x-seed-secret header.' },
      { status: 403 }
    );
  }

  if (!isProd && !ENABLE_DEV_ROLE_SHORTCUTS && !validSecret) {
    return NextResponse.json(
      { error: 'Demo role account provisioning is disabled in this environment.' },
      { status: 403 }
    );
  }

  const supabaseUrl = normalizeEnvValue(
    process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL
  );
  const serviceRoleKey = normalizeEnvValue(
    process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY
  );

  if (!supabaseUrl || !serviceRoleKey) {
    return NextResponse.json(
      {
        error: 'Demo account auto-provisioning requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY on the server.',
        missingServiceKey: true,
      },
      { status: 503 }
    );
  }

  const keyKind = classifySupabaseAdminKey(serviceRoleKey);
  if (keyKind === 'placeholder' || keyKind === 'sb_publishable' || keyKind === 'unknown') {
    return NextResponse.json(
      {
        error:
          'SUPABASE_SERVICE_ROLE_KEY is misconfigured on the server. Set it to your Supabase legacy service_role JWT (eyJ...) or Secret API Key (sb_secret_...) — not a publishable key or placeholder.',
        keyKind,
      },
      { status: 503 }
    );
  }

  if (keyKind === 'jwt') {
    const jwtRole = decodeJwtRole(serviceRoleKey);
    if (jwtRole && jwtRole !== 'service_role') {
      return NextResponse.json(
        {
          error: `SUPABASE_SERVICE_ROLE_KEY has JWT role "${jwtRole}" instead of "service_role". Set SUPABASE_SERVICE_ROLE_KEY to the Supabase service_role key.`,
          keyKind,
        },
        { status: 503 }
      );
    }
  }

  // New-format Supabase Secret Keys (sb_secret_...) are NOT JWTs and must be sent
  // via the `apikey` header without `Authorization: Bearer sb_secret_...`, otherwise
  // GoTrue /auth/v1/admin/* rejects them with "This endpoint requires a valid Bearer token".
  const adminFetch: typeof fetch =
    keyKind === 'sb_secret'
      ? (input, init) => {
          const headers = new Headers(init?.headers);
          const authHeader = headers.get('authorization');
          if (authHeader && authHeader.trim() === `Bearer ${serviceRoleKey}`) {
            headers.delete('authorization');
          }
          headers.set('apikey', serviceRoleKey);
          return fetch(input, { ...init, headers });
        }
      : fetch;

  const supabaseAdmin = createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
    global: {
      fetch: adminFetch,
    },
  });

  try {
    // 1. Ensure Churachandpur service hub exists
    let hubId: string | null = null;
    const { data: existingHub } = await supabaseAdmin
      .from('service_hubs')
      .select('id')
      .eq('slug', 'churachandpur')
      .maybeSingle();

    if (existingHub?.id) {
      hubId = existingHub.id;
    } else {
      const { data: createdHub } = await supabaseAdmin
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
        .maybeSingle();
      hubId = createdHub?.id ?? null;
    }

    // 2. Ensure 5th fleet tier (cycle_rickshaw) exists in vehicle_types & hub_vehicle_rates
    const { data: cycleVt } = await supabaseAdmin
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
      .maybeSingle();

    if (hubId && cycleVt?.id) {
      await supabaseAdmin.from('hub_vehicle_rates').upsert(
        {
          hub_id: hubId,
          vehicle_type_id: cycleVt.id,
          is_enabled_in_hub: true,
          base_fare_inr: 30.0,
          per_km_rate_inr: 8.0,
          wait_per_10min_inr: 10.0,
          free_wait_minutes: 15,
          two_way_multiplier: 1.75,
        },
        { onConflict: 'hub_id,vehicle_type_id' }
      );
    }

    const { data: listData, error: listErr } = await supabaseAdmin.auth.admin.listUsers({
      page: 1,
      perPage: 200,
    });
    if (listErr) throw listErr;

    const existingUsers = listData?.users || [];
    const results: Array<{ email: string; role: string; userId: string }> = [];
    const userIdByAccountId: Record<string, string> = {};

    for (const account of DEV_TEST_ACCOUNTS) {
      const existing = existingUsers.find(
        (u) => u.email?.toLowerCase() === account.email.toLowerCase()
      );

      let userId: string;
      if (existing) {
        const { data: updated, error: updateErr } =
          await supabaseAdmin.auth.admin.updateUserById(existing.id, {
            password: account.password,
            email_confirm: true,
            user_metadata: {
              ...(existing.user_metadata || {}),
              full_name: account.fullName,
              name: account.fullName,
              phone: account.phone,
            },
          });
        if (updateErr) throw updateErr;
        userId = updated.user.id;
      } else {
        const { data: created, error: createErr } =
          await supabaseAdmin.auth.admin.createUser({
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
        userId = created.user.id;
      }

      userIdByAccountId[account.id] = userId;

      const { error: profileErr } = await supabaseAdmin.from('profiles').upsert(
        {
          id: userId,
          email: account.email,
          full_name: account.fullName,
          phone: account.phone,
          role: account.dbRole,
          default_hub_id: hubId,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' }
      );

      if (profileErr) {
        throw new Error(`Profile upsert failed for ${account.email}: ${profileErr.message}`);
      }

      if (account.id === 'driver') {
        await supabaseAdmin.from('drivers').upsert(
          {
            profile_id: userId,
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
      }

      if (account.id === 'advertiser') {
        const { data: planRow } = await supabaseAdmin
          .from('subscription_plans')
          .select('id')
          .in('slug', ['business', 'agency', 'starter'])
          .eq('is_active', true)
          .order('price_inr', { ascending: false })
          .limit(1)
          .maybeSingle();

        if (planRow?.id) {
          const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
          const { data: existingSub } = await supabaseAdmin
            .from('user_subscriptions')
            .select('id')
            .eq('user_id', userId)
            .eq('status', 'active')
            .limit(1)
            .maybeSingle();

          if (existingSub?.id) {
            await supabaseAdmin
              .from('user_subscriptions')
              .update({ plan_id: planRow.id, expires_at: expiresAt })
              .eq('id', existingSub.id);
          } else {
            await supabaseAdmin.from('user_subscriptions').insert({
              user_id: userId,
              plan_id: planRow.id,
              status: 'active',
              starts_at: new Date().toISOString(),
              expires_at: expiresAt,
              payment_ref: 'TEST-SEED-SUB-2026',
            });
          }
        }
      }

      if (account.id === 'hub_manager' && hubId) {
        await supabaseAdmin.from('hub_managers').upsert(
          {
            profile_id: userId,
            hub_id: hubId,
            can_confirm_manual_payments: true,
            can_edit_rates: true,
            is_active: true,
          },
          { onConflict: 'profile_id,hub_id' }
        );
      }

      results.push({ email: account.email, role: account.dbRole, userId });
    }

    // Link owner & staff delegation
    const ownerUserId = userIdByAccountId['owner'];
    const staffUserId = userIdByAccountId['staff'];
    if (ownerUserId) {
      let targetListingId: string | null = null;
      const { data: existingOwnerListing } = await supabaseAdmin
        .from('listings')
        .select('id')
        .eq('owner_id', ownerUserId)
        .limit(1)
        .maybeSingle();

      if (existingOwnerListing?.id) {
        targetListingId = existingOwnerListing.id;
      } else if (hubId) {
        const { data: lamkaListing } = await supabaseAdmin
          .from('listings')
          .select('id')
          .eq('hub_id', hubId)
          .limit(1)
          .maybeSingle();
        if (lamkaListing?.id) {
          targetListingId = lamkaListing.id;
          await supabaseAdmin
            .from('listings')
            .update({ owner_id: ownerUserId })
            .eq('id', targetListingId);
        }
      }

      if (targetListingId && staffUserId) {
        const { data: existingDelegation } = await supabaseAdmin
          .from('staff_delegations')
          .select('id')
          .eq('listing_id', targetListingId)
          .eq('staff_id', staffUserId)
          .limit(1)
          .maybeSingle();

        const delegationPayload = {
          listing_id: targetListingId,
          staff_id: staffUserId,
          granted_by_owner_id: ownerUserId,
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

        if (existingDelegation?.id) {
          await supabaseAdmin
            .from('staff_delegations')
            .update(delegationPayload)
            .eq('id', existingDelegation.id);
        } else {
          await supabaseAdmin.from('staff_delegations').insert(delegationPayload);
        }
      }
    }

    const configuredSuperAdmins = String(process.env.SUPER_ADMIN_EMAILS || '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean);
    const superAdmin =
      configuredSuperAdmins.length > 0
        ? existingUsers.find(
            (u) =>
              u.email &&
              configuredSuperAdmins.includes(u.email.trim().toLowerCase())
          )
        : undefined;
    if (superAdmin?.email) {
      await supabaseAdmin.from('profiles').upsert(
        {
          id: superAdmin.id,
          email: superAdmin.email.trim().toLowerCase(),
          role: 'super_admin',
          is_super_admin: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'id' }
      );
    }

    return NextResponse.json({ ok: true, provisioned: results });
  } catch (err) {
    console.error('[seed-test-accounts] Error:', err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Failed to provision demo accounts' },
      { status: 500 }
    );
  }
}
