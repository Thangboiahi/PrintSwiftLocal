import { createHash, randomBytes, randomInt } from 'crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import { getServerSessionContext } from '@/lib/auth-server';
import {
  createServerSupabaseAdminClient,
  extractSupabaseAccessToken,
} from '@/lib/pick-n-drop/fare';
import type {
  ListingPrintProfile,
  PrintCapabilities,
  PrintPaymentPolicy,
  PrintRateCard,
  PrintTurnaroundBadge,
  PrintVerifiedCapabilities,
} from '@/lib/print-orders/types';

export interface AuthenticatedPrintActor {
  supabaseAdmin: SupabaseClient;
  userToken: string | null;
  userId: string;
  actualRole: string;
  profile: {
    id: string;
    role: string;
    full_name: string | null;
    phone: string | null;
    phone_verified_at: string | null;
    print_no_show_count: number;
  };
}

export class PrintApiError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(message: string, statusCode = 400, code = 'PRINT_API_ERROR') {
    super(message);
    this.name = 'PrintApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

function asPlainObject(val: unknown): Record<string, unknown> {
  return val && typeof val === 'object' && !Array.isArray(val)
    ? (val as Record<string, unknown>)
    : {};
}

export function generatePrintOrderCode(): string {
  const now = new Date();
  const y = now.getUTCFullYear().toString().slice(-2);
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const suffix = randomBytes(3).toString('hex').toUpperCase();
  return `PRT-${y}${m}${d}-${suffix}`;
}

export function generatePaymentIntentCode(): string {
  const suffix = randomBytes(3).toString('hex').toUpperCase();
  return `PSL-${suffix}`;
}

export function generateCollectionOtp(): { otp: string; hash: string } {
  const otp = String(randomInt(1000, 10000));
  const hash = createHash('sha256').update(otp, 'utf8').digest('hex');
  return { otp, hash };
}

export function buildShopDirectUpiDetails(params: {
  shopUpiId: string | null | undefined;
  shopUpiName: string | null | undefined;
  orderCode: string;
  amountInr: number;
  verified?: boolean;
}): {
  upi_id: string;
  upi_payee_name: string;
  upi_deep_link: string;
  verified: boolean;
} | null {
  const upiId = (params.shopUpiId || '').trim();
  if (!upiId) return null;
  const payeeName = (params.shopUpiName || 'Print Shop').trim();
  const formattedAmount = Math.max(0, Number(params.amountInr) || 0).toFixed(2);
  const note = `Print ${params.orderCode}`.slice(0, 50);
  const deepLink = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(
    payeeName
  )}&am=${encodeURIComponent(formattedAmount)}&cu=INR&tn=${encodeURIComponent(
    note
  )}`;

  return {
    upi_id: upiId,
    upi_payee_name: payeeName,
    upi_deep_link: deepLink,
    verified: Boolean(params.verified),
  };
}

/**
 * Authenticates an API request using Authorization Bearer / Supabase cookies
 * with server-side session context (`lib/auth-server.ts`) fallback.
 */
export async function authenticatePrintRequest(
  req: NextRequest
): Promise<AuthenticatedPrintActor | null> {
  const supabaseAdmin = createServerSupabaseAdminClient();
  const token = extractSupabaseAccessToken(req);

  let userId: string | null = null;

  if (token) {
    const {
      data: { user },
      error,
    } = await supabaseAdmin.auth.getUser(token);
    if (!error && user?.id) {
      userId = user.id;
    }
  }

  if (!userId) {
    try {
      const serverSession = await getServerSessionContext();
      if (serverSession.profile?.id) {
        userId = String(serverSession.profile.id);
      }
    } catch {
      // Ignore cookie-context error outside request scope
    }
  }

  if (!userId) {
    return null;
  }

  const { data: profileRow, error: profileErr } = await supabaseAdmin
    .from('profiles')
    .select('id, role, full_name, phone, phone_verified_at, print_no_show_count')
    .eq('id', userId)
    .maybeSingle();

  if (profileErr || !profileRow) {
    return null;
  }

  const actualRole =
    String(profileRow.role || 'visitor')
      .trim()
      .toLowerCase() || 'visitor';

  return {
    supabaseAdmin,
    userToken: token,
    userId: String(profileRow.id),
    actualRole,
    profile: {
      id: String(profileRow.id),
      role: actualRole,
      full_name: profileRow.full_name ? String(profileRow.full_name) : null,
      phone: profileRow.phone ? String(profileRow.phone) : null,
      phone_verified_at: profileRow.phone_verified_at
        ? String(profileRow.phone_verified_at)
        : null,
      print_no_show_count: Number(profileRow.print_no_show_count ?? 0),
    },
  };
}

/**
 * Creates a user-scoped Supabase client (so RLS / auth.uid() RPCs run as the caller).
 */
export function createUserScopedSupabaseClient(
  accessToken: string
): SupabaseClient | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey || !accessToken) return null;

  return createClient(supabaseUrl, supabaseAnonKey, {
    global: {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    },
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export function normalizeListingPrintProfile(
  row: Record<string, unknown>
): ListingPrintProfile {
  const rawCaps = asPlainObject(row.capabilities);
  const capabilities: PrintCapabilities = {
    bw_a4: rawCaps.bw_a4 !== false,
    color_a4: Boolean(rawCaps.color_a4),
    duplex: Boolean(rawCaps.duplex),
    a3_large: Boolean(rawCaps.a3_large),
    spiral_binding: Boolean(rawCaps.spiral_binding),
    lamination: Boolean(rawCaps.lamination),
    custom_digital_jobs: Boolean(rawCaps.custom_digital_jobs),
    sealed_envelope: rawCaps.sealed_envelope !== false,
  };

  const rawVerified = asPlainObject(row.verified_capabilities);
  const verifiedCapabilities: PrintVerifiedCapabilities = {};
  for (const key of Object.keys(capabilities) as Array<keyof PrintCapabilities>) {
    if (typeof rawVerified[key] === 'boolean') {
      verifiedCapabilities[key] = rawVerified[key] as boolean;
    }
  }

  const rawPolicy = asPlainObject(row.payment_policy);
  const paymentPolicy: PrintPaymentPolicy = {
    allow_direct_pay: rawPolicy.allow_direct_pay !== false,
    direct_pay_max_inr: Number.isFinite(Number(rawPolicy.direct_pay_max_inr))
      ? Math.max(0, Number(rawPolicy.direct_pay_max_inr))
      : 300,
    allow_escrow: rawPolicy.allow_escrow !== false,
    shop_upi_id:
      typeof rawPolicy.shop_upi_id === 'string' && rawPolicy.shop_upi_id.trim()
        ? rawPolicy.shop_upi_id.trim()
        : null,
    shop_upi_name:
      typeof rawPolicy.shop_upi_name === 'string' &&
      rawPolicy.shop_upi_name.trim()
        ? rawPolicy.shop_upi_name.trim()
        : null,
    shop_upi_verified: Boolean(rawPolicy.shop_upi_verified),
  };

  const rawBadge = String(row.turnaround_badge || 'same_day');
  const turnaroundBadge: PrintTurnaroundBadge =
    rawBadge === 'express_30m' || rawBadge === 'next_day'
      ? rawBadge
      : 'same_day';

  const isOfficial = Boolean(
    row.is_official_printswift ?? row.is_first_party_printswift
  );

  const rawMatrix = asPlainObject(row.pricing_matrix);
  const rawRates = asPlainObject(row.rate_card);
  const combinedRates: Record<string, unknown> = {
    ...rawRates,
    ...rawMatrix,
  };
  const numOrUndef = (val: unknown): number | undefined => {
    if (val === null || val === undefined || val === '') return undefined;
    const n = Number(val);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  };
  const bwSingle = numOrUndef(
    combinedRates.bw_a4_single_inr ?? combinedRates.bw_a4_per_page
  );
  const colorSingle = numOrUndef(
    combinedRates.color_a4_single_inr ?? combinedRates.color_a4_per_page
  );
  const discountPct = numOrUndef(combinedRates.duplex_discount_pct) ?? 0;

  const normalizedRateCard: PrintRateCard = {
    ...(combinedRates as PrintRateCard),
    bw_a4_single_inr: bwSingle,
    bw_a4_duplex_inr:
      numOrUndef(combinedRates.bw_a4_duplex_inr) ??
      (bwSingle !== undefined && discountPct > 0
        ? Math.round(bwSingle * 2 * (1 - discountPct / 100) * 100) / 100
        : undefined),
    color_a4_single_inr: colorSingle,
    color_a4_duplex_inr:
      numOrUndef(combinedRates.color_a4_duplex_inr) ??
      (colorSingle !== undefined && discountPct > 0
        ? Math.round(colorSingle * 2 * (1 - discountPct / 100) * 100) / 100
        : undefined),
    a3_bw_inr: numOrUndef(combinedRates.a3_bw_inr),
    a3_bw_duplex_inr: numOrUndef(combinedRates.a3_bw_duplex_inr),
    a3_color_inr: numOrUndef(combinedRates.a3_color_inr),
    a3_color_duplex_inr: numOrUndef(combinedRates.a3_color_duplex_inr),
    legal_bw_single_inr: numOrUndef(combinedRates.legal_bw_single_inr),
    legal_bw_duplex_inr: numOrUndef(combinedRates.legal_bw_duplex_inr),
    legal_color_single_inr: numOrUndef(combinedRates.legal_color_single_inr),
    legal_color_duplex_inr: numOrUndef(combinedRates.legal_color_duplex_inr),
    spiral_binding_inr: numOrUndef(combinedRates.spiral_binding_inr),
    hard_binding_inr: numOrUndef(combinedRates.hard_binding_inr),
    lamination_per_sheet_inr: numOrUndef(
      combinedRates.lamination_per_sheet_inr ??
        combinedRates.lamination_inr ??
        combinedRates.lamination_a4_inr
    ),
    staple_inr: numOrUndef(combinedRates.staple_inr),
    sealed_envelope_inr: numOrUndef(combinedRates.sealed_envelope_inr),
    min_order_inr: numOrUndef(
      combinedRates.min_order_inr ?? combinedRates.minimum_order_inr
    ),
    platform_fee_inr: numOrUndef(combinedRates.platform_fee_inr),
    urgent_express_surcharge_type:
      combinedRates.urgent_express_surcharge_type === 'percent'
        ? 'percent'
        : 'flat',
    urgent_express_surcharge_value: numOrUndef(
      combinedRates.urgent_express_surcharge_value
    ),
  };

  const rawEta = Number(row.express_eta_mins);
  const expressEtaMins =
    Number.isFinite(rawEta) && rawEta >= 5
      ? Math.round(rawEta)
      : turnaroundBadge === 'express_30m'
        ? 30
        : turnaroundBadge === 'same_day'
          ? 180
          : 1440;

  return {
    listing_id: String(row.listing_id),
    hub_id: String(row.hub_id),
    is_official_printswift: isOfficial,
    is_first_party_printswift: isOfficial,
    is_accepting_orders: Boolean(row.is_accepting_orders),
    express_eta_mins: expressEtaMins,
    supports_pick_n_drop: row.supports_pick_n_drop !== false,
    busy_until: row.busy_until ? String(row.busy_until) : null,
    pricing_version: Number(row.pricing_version ?? 1),
    capabilities,
    verified_capabilities: verifiedCapabilities,
    rate_card: normalizedRateCard,
    pricing_matrix: normalizedRateCard,
    payment_policy: paymentPolicy,
    turnaround_badge: turnaroundBadge,
    pickup_instructions: row.pickup_instructions
      ? String(row.pickup_instructions)
      : null,
    max_file_size_mb: Number(row.max_file_size_mb ?? 25),
    created_at: row.created_at ? String(row.created_at) : undefined,
    updated_at: row.updated_at ? String(row.updated_at) : undefined,
  };
}

/**
 * Enforces hub kill-switch: `service_hubs.module_switches.print_orders !== false`.
 */
export async function assertPrintModuleEnabledForHub(
  supabaseAdmin: SupabaseClient,
  hubId: string
): Promise<void> {
  const { data: hubRow, error } = await supabaseAdmin
    .from('service_hubs')
    .select('id, name, status, module_switches')
    .eq('id', hubId)
    .maybeSingle();

  if (error || !hubRow) {
    throw new PrintApiError(
      'Associated service hub was not found.',
      404,
      'HUB_NOT_FOUND'
    );
  }

  if (String(hubRow.status || 'active') === 'paused') {
    throw new PrintApiError(
      `Online print ordering is currently paused in ${hubRow.name || 'this hub'}.`,
      503,
      'HUB_PAUSED'
    );
  }

  const switches = asPlainObject(hubRow.module_switches);
  const printSwitch = switches.print_orders;

  if (printSwitch === false) {
    throw new PrintApiError(
      `Print & Digital ordering is currently paused in ${hubRow.name || 'this hub'}.`,
      503,
      'PRINT_MODULE_DISABLED'
    );
  }

  if (
    printSwitch &&
    typeof printSwitch === 'object' &&
    !Array.isArray(printSwitch) &&
    (printSwitch as Record<string, unknown>).enabled === false
  ) {
    const pauseMsg = String(
      (printSwitch as Record<string, unknown>).pause_message || ''
    ).trim();
    throw new PrintApiError(
      pauseMsg ||
        `Print & Digital ordering is currently paused in ${hubRow.name || 'this hub'}.`,
      503,
      'PRINT_MODULE_DISABLED'
    );
  }
}

/**
 * Enforces `public.has_active_print_entitlement(listing_id)` via DB RPC.
 */
export async function assertListingHasPrintEntitlement(
  supabaseAdmin: SupabaseClient,
  listingId: string
): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc(
    'has_active_print_entitlement',
    {
      p_listing_id: listingId,
    }
  );

  if (error) {
    throw new PrintApiError(
      `Failed to verify shop print entitlement: ${error.message}`,
      500,
      'ENTITLEMENT_CHECK_FAILED'
    );
  }

  if (data !== true) {
    throw new PrintApiError(
      'This shop does not currently have an active Print & Digital Pro subscription.',
      403,
      'PRINT_ENTITLEMENT_REQUIRED'
    );
  }
}

/**
 * Loads `listing_print_profiles` and enforces hub kill-switch + Print Pro entitlement.
 */
export async function loadAndValidatePrintProfile(
  supabaseAdmin: SupabaseClient,
  listingId: string,
  options?: { requireAcceptingOrders?: boolean }
): Promise<ListingPrintProfile> {
  const { data: row, error } = await supabaseAdmin
    .from('listing_print_profiles')
    .select('*')
    .eq('listing_id', listingId)
    .maybeSingle();

  if (error || !row) {
    throw new PrintApiError(
      'Print profile not found for this shop listing.',
      404,
      'PRINT_PROFILE_NOT_FOUND'
    );
  }

  const profile = normalizeListingPrintProfile(row as Record<string, unknown>);

  await assertPrintModuleEnabledForHub(supabaseAdmin, profile.hub_id);
  if (!(profile.is_official_printswift || profile.is_first_party_printswift)) {
    await assertListingHasPrintEntitlement(supabaseAdmin, profile.listing_id);
  }

  if (options?.requireAcceptingOrders) {
    if (!profile.is_accepting_orders) {
      throw new PrintApiError(
        profile.is_first_party_printswift
          ? 'Official DD oodle Print is currently paused and not accepting new orders right now.'
          : 'This print shop is currently not accepting new online orders.',
        409,
        'SHOP_NOT_ACCEPTING_ORDERS'
      );
    }

    if (profile.busy_until) {
      const busyMs = Date.parse(profile.busy_until);
      if (!Number.isNaN(busyMs) && busyMs > Date.now()) {
        throw new PrintApiError(
          `This print shop is temporarily busy until ${new Date(busyMs).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Kolkata' })}.`,
          409,
          'SHOP_BUSY'
        );
      }
    }
  }

  return profile;
}

/**
 * Strictly mirrors `public.is_print_operator_for(listing_id)`!
 * Explicitly returns `false` for Hub Managers and general directory admins on third-party shops.
 */
export async function verifyIsPrintOperatorForListing(params: {
  supabaseAdmin: SupabaseClient;
  userToken: string | null;
  userId: string;
  actualRole: string;
  listingId: string;
}): Promise<boolean> {
  const { supabaseAdmin, userToken, userId, actualRole, listingId } = params;

  // Prefer calling the authoritative DB SECURITY DEFINER function under caller's JWT
  if (userToken) {
    const userClient = createUserScopedSupabaseClient(userToken);
    if (userClient) {
      const { data, error } = await userClient.rpc('is_print_operator_for', {
        p_listing_id: listingId,
      });
      if (!error && typeof data === 'boolean') {
        return data;
      }
    }
  }

  // Authoritative server fallback (strictly excludes hub_manager / general admin on 3P shops)
  const [listingRes, delegationRes, profileRes] = await Promise.all([
    supabaseAdmin
      .from('listings')
      .select('owner_id')
      .eq('id', listingId)
      .maybeSingle(),
    supabaseAdmin
      .from('staff_delegations')
      .select('id, listing_id, assigned_listing_ids, status')
      .eq('staff_id', userId),
    supabaseAdmin
      .from('listing_print_profiles')
      .select('is_first_party_printswift')
      .eq('listing_id', listingId)
      .maybeSingle(),
  ]);

  if (listingRes.data?.owner_id && String(listingRes.data.owner_id) === userId) {
    return true;
  }

  if (Array.isArray(delegationRes.data)) {
    for (const sd of delegationRes.data as Array<{
      listing_id?: string | null;
      assigned_listing_ids?: unknown;
      status?: string | null;
    }>) {
      if ((sd.status || 'active') !== 'active') continue;
      if (sd.listing_id && String(sd.listing_id) === listingId) {
        return true;
      }
      if (
        Array.isArray(sd.assigned_listing_ids) &&
        sd.assigned_listing_ids.some((id) => String(id) === listingId)
      ) {
        return true;
      }
    }
  }

  if (
    actualRole === 'super_admin' &&
    profileRes.data?.is_first_party_printswift === true
  ) {
    return true;
  }

  return false;
}
