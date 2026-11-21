// =============================================================================
// Phase 73-B: Booking & Hotel Server Helpers (Auth, Entitlements, Kill-Switches)
// =============================================================================

import { createHash, randomBytes, randomInt } from 'crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import { getServerSessionContext } from '@/lib/auth-server';
import {
  createServerSupabaseAdminClient,
  extractSupabaseAccessToken,
} from '@/lib/pick-n-drop/fare';
import {
  isValidBookingUnit,
  isValidHotelStayType,
  type HotelAmenities,
  type HotelPaymentPolicy,
  type ListingBookingResource,
  type ListingHotelProfile,
  type ResourceAddon,
  type ResourceVertical,
} from '@/lib/bookings/types';

export interface AuthenticatedBookingActor {
  supabaseAdmin: SupabaseClient;
  userToken: string | null;
  userId: string;
  actualRole: string;
  profile: {
    id: string;
    role: string;
    full_name: string | null;
    phone: string | null;
  };
}

export class BookingApiError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(message: string, statusCode = 400, code = 'BOOKING_API_ERROR') {
    super(message);
    this.name = 'BookingApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export const BOOKING_HOLD_WINDOW_MS = 15 * 60 * 1000; // 15 minutes

function asPlainObject(val: unknown): Record<string, unknown> {
  return val && typeof val === 'object' && !Array.isArray(val)
    ? (val as Record<string, unknown>)
    : {};
}

export function generateCheckinOtp(): { otp: string; hash: string } {
  const otp = String(randomInt(1000, 10000));
  const hash = createHash('sha256').update(otp, 'utf8').digest('hex');
  return { otp, hash };
}

export function generateBookingPaymentIntentCode(): string {
  const suffix = randomBytes(3).toString('hex').toUpperCase();
  return `PSL-${suffix}`;
}

/**
 * Authenticates an API request using Authorization Bearer / Supabase cookies
 * with server-side session context (`lib/auth-server.ts`) fallback.
 */
export async function authenticateBookingRequest(
  req: NextRequest
): Promise<AuthenticatedBookingActor | null> {
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
      // Ignore cookie-context errors outside active request scope
    }
  }

  if (!userId) {
    return null;
  }

  const { data: profileRow, error: profileErr } = await supabaseAdmin
    .from('profiles')
    .select('id, role, full_name, phone')
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
    },
  };
}

/**
 * Creates a user-scoped Supabase client so SECURITY DEFINER RPCs run under caller's JWT.
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

export function normalizeBookingResourceRow(
  row: Record<string, unknown>
): ListingBookingResource {
  const rawVertical = String(row.resource_vertical || 'booking_venue');
  const resourceVertical: ResourceVertical =
    rawVertical === 'hotel_stay' ? 'hotel_stay' : 'booking_venue';

  const rawUnit = row.booking_unit;
  const bookingUnit = isValidBookingUnit(rawUnit)
    ? rawUnit
    : resourceVertical === 'hotel_stay'
      ? 'nightly'
      : 'hourly';

  const rawAddons = Array.isArray(row.addons) ? row.addons : [];
  const addons: ResourceAddon[] = rawAddons
    .map((item) => {
      const obj = asPlainObject(item);
      const key = String(obj.key || '').trim();
      const label = String(obj.label || '').trim();
      const priceInr = Number(obj.price_inr ?? 0);
      if (!key || !label || !Number.isFinite(priceInr)) return null;
      return {
        key,
        label,
        price_inr: Math.max(0, priceInr),
        per_unit: Boolean(obj.per_unit),
      } as ResourceAddon;
    })
    .filter((a): a is ResourceAddon => a !== null);

  const photos = Array.isArray(row.photos)
    ? row.photos.map((p) => String(p).trim()).filter(Boolean)
    : [];

  return {
    id: String(row.id),
    listing_id: String(row.listing_id),
    hub_id: String(row.hub_id),
    resource_vertical: resourceVertical,
    name: String(row.name || 'Resource'),
    description: row.description ? String(row.description) : null,
    booking_unit: bookingUnit,
    slot_duration_mins: Math.max(15, Math.floor(Number(row.slot_duration_mins ?? 60))),
    open_hour: Math.min(23, Math.max(0, Math.floor(Number(row.open_hour ?? 6)))),
    close_hour: Math.min(24, Math.max(1, Math.floor(Number(row.close_hour ?? 22)))),
    total_units: Math.max(1, Math.floor(Number(row.total_units ?? 1))),
    max_guests: Math.max(1, Math.floor(Number(row.max_guests ?? 2))),
    base_rate_inr: Math.max(0, Number(row.base_rate_inr ?? 0)),
    peak_rate_inr:
      row.peak_rate_inr !== null &&
      row.peak_rate_inr !== undefined &&
      Number.isFinite(Number(row.peak_rate_inr))
        ? Math.max(0, Number(row.peak_rate_inr))
        : null,
    peak_start_hour:
      row.peak_start_hour !== null &&
      row.peak_start_hour !== undefined &&
      Number.isFinite(Number(row.peak_start_hour))
        ? Math.min(23, Math.max(0, Math.floor(Number(row.peak_start_hour))))
        : null,
    advance_percent: Math.min(
      100,
      Math.max(0, Math.round(Number(row.advance_percent ?? 30)))
    ),
    addons,
    photos,
    is_active: row.is_active !== false,
    sort_order: Number(row.sort_order ?? 0),
    created_at: row.created_at ? String(row.created_at) : undefined,
    updated_at: row.updated_at ? String(row.updated_at) : undefined,
  };
}

export function normalizeHotelProfileRow(
  row: Record<string, unknown>
): ListingHotelProfile {
  const rawAmenities = asPlainObject(row.amenities);
  const amenities: HotelAmenities = {
    wifi: Boolean(rawAmenities.wifi),
    parking: Boolean(rawAmenities.parking),
    hot_water: Boolean(rawAmenities.hot_water),
    power_backup: Boolean(rawAmenities.power_backup),
    ac: Boolean(rawAmenities.ac),
    heater: Boolean(rawAmenities.heater),
    in_house_kitchen: Boolean(rawAmenities.in_house_kitchen),
    early_checkin: Boolean(rawAmenities.early_checkin),
  };

  const rawVerified = asPlainObject(row.verified_amenities);
  const verifiedAmenities: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(rawVerified)) {
    if (typeof v === 'boolean') {
      verifiedAmenities[k] = v;
    }
  }

  const rawPolicy = asPlainObject(row.payment_policy);
  const paymentPolicy: HotelPaymentPolicy = {
    allow_direct_pay: Boolean(rawPolicy.allow_direct_pay),
    advance_percent: Math.min(
      100,
      Math.max(0, Math.round(Number(rawPolicy.advance_percent ?? 30)))
    ),
    allow_full_prepay: rawPolicy.allow_full_prepay !== false,
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

  return {
    listing_id: String(row.listing_id),
    hub_id: String(row.hub_id),
    stay_type: isValidHotelStayType(row.stay_type) ? row.stay_type : 'hotel',
    check_in_time: String(row.check_in_time || '12:00 PM'),
    check_out_time: String(row.check_out_time || '11:00 AM'),
    amenities,
    verified_amenities: verifiedAmenities,
    house_rules: row.house_rules ? String(row.house_rules) : null,
    cancellation_policy: String(
      row.cancellation_policy ||
        'Free cancellation up to 24 hours before check-in.'
    ),
    id_requirement_note: String(
      row.id_requirement_note ||
        'Valid government photo ID is verified at reception upon check-in.'
    ),
    is_accepting_bookings: row.is_accepting_bookings !== false,
    payment_policy: paymentPolicy,
    created_at: row.created_at ? String(row.created_at) : undefined,
    updated_at: row.updated_at ? String(row.updated_at) : undefined,
  };
}

/**
 * Enforces hub kill-switch for `booking_venues` or `hotel_stays` in `service_hubs.module_switches`.
 */
export async function assertBookingModuleEnabledForHub(
  supabaseAdmin: SupabaseClient,
  hubId: string,
  vertical: ResourceVertical
): Promise<void> {
  const { data: hubRow, error } = await supabaseAdmin
    .from('service_hubs')
    .select('id, name, status, module_switches')
    .eq('id', hubId)
    .maybeSingle();

  if (error || !hubRow) {
    throw new BookingApiError(
      'Associated service hub was not found.',
      404,
      'HUB_NOT_FOUND'
    );
  }

  const hubName = String(hubRow.name || 'this hub');
  const label =
    vertical === 'hotel_stay' ? 'Hotel & Homestay bookings' : 'Venue & Slot bookings';

  if (String(hubRow.status || 'active') === 'paused') {
    throw new BookingApiError(
      `${label} are currently paused in ${hubName}.`,
      503,
      'HUB_PAUSED'
    );
  }

  const switchKey = vertical === 'hotel_stay' ? 'hotel_stays' : 'booking_venues';
  const switches = asPlainObject(hubRow.module_switches);
  const rawSwitch = switches[switchKey];

  if (rawSwitch === false) {
    throw new BookingApiError(
      `${label} are currently paused in ${hubName}.`,
      503,
      vertical === 'hotel_stay'
        ? 'HOTEL_STAYS_MODULE_DISABLED'
        : 'BOOKING_VENUES_MODULE_DISABLED'
    );
  }

  if (
    rawSwitch &&
    typeof rawSwitch === 'object' &&
    !Array.isArray(rawSwitch) &&
    (rawSwitch as Record<string, unknown>).enabled === false
  ) {
    const pauseMsg = String(
      (rawSwitch as Record<string, unknown>).pause_message || ''
    ).trim();
    throw new BookingApiError(
      pauseMsg || `${label} are currently paused in ${hubName}.`,
      503,
      vertical === 'hotel_stay'
        ? 'HOTEL_STAYS_MODULE_DISABLED'
        : 'BOOKING_VENUES_MODULE_DISABLED'
    );
  }
}

/**
 * Enforces `public.has_active_booking_entitlement(listing_id, vertical)` via DB RPC.
 */
export async function assertListingHasBookingEntitlement(
  supabaseAdmin: SupabaseClient,
  listingId: string,
  vertical: ResourceVertical
): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc(
    'has_active_booking_entitlement',
    {
      p_listing_id: listingId,
      p_vertical: vertical,
    }
  );

  if (error) {
    throw new BookingApiError(
      `Failed to verify booking entitlement: ${error.message}`,
      500,
      'ENTITLEMENT_CHECK_FAILED'
    );
  }

  if (data !== true) {
    throw new BookingApiError(
      vertical === 'hotel_stay'
        ? 'This property does not currently have an active Stay Pro subscription for online bookings.'
        : 'This venue does not currently have an active Booking Pro subscription for online reservations.',
      403,
      'BOOKING_ENTITLEMENT_REQUIRED'
    );
  }
}

/**
 * Strictly mirrors `public.is_booking_operator_for(listing_id)`!
 * Returns true ONLY for super_admin, the listing's owner, or active delegated staff.
 */
export async function verifyIsBookingOperatorForListing(params: {
  supabaseAdmin: SupabaseClient;
  userToken: string | null;
  userId: string;
  actualRole: string;
  listingId: string;
}): Promise<boolean> {
  const { supabaseAdmin, userToken, userId, actualRole, listingId } = params;

  if (userToken) {
    const userClient = createUserScopedSupabaseClient(userToken);
    if (userClient) {
      const { data, error } = await userClient.rpc('is_booking_operator_for', {
        p_listing_id: listingId,
      });
      if (!error && typeof data === 'boolean') {
        return data;
      }
    }
  }

  if (actualRole === 'super_admin') {
    return true;
  }

  const [listingRes, delegationRes] = await Promise.all([
    supabaseAdmin
      .from('listings')
      .select('owner_id')
      .eq('id', listingId)
      .maybeSingle(),
    supabaseAdmin
      .from('staff_delegations')
      .select('id, listing_id, assigned_listing_ids, status')
      .eq('staff_id', userId),
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

  return false;
}

// =============================================================================
// IST (+05:30) Date & Time Normalization Helpers
// =============================================================================

export const YMD_DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Parses a clock string like "12:00 PM" or "11:00 AM" or "14:30" into minutes from midnight.
 */
export function parseClockTimeToMinutes(
  timeStr: string | null | undefined,
  fallbackMinutes: number
): number {
  const clean = String(timeStr || '').trim();
  if (!clean) return fallbackMinutes;

  const amPmMatch = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(clean);
  if (amPmMatch) {
    let hour = Number(amPmMatch[1]);
    const mins = Number(amPmMatch[2]);
    const period = amPmMatch[3].toUpperCase();
    if (hour >= 1 && hour <= 12 && mins >= 0 && mins <= 59) {
      if (period === 'AM') {
        hour = hour === 12 ? 0 : hour;
      } else {
        hour = hour === 12 ? 12 : hour + 12;
      }
      return hour * 60 + mins;
    }
  }

  const h24Match = /^(\d{1,2}):(\d{2})$/.exec(clean);
  if (h24Match) {
    const hour = Number(h24Match[1]);
    const mins = Number(h24Match[2]);
    if (hour >= 0 && hour <= 23 && mins >= 0 && mins <= 59) {
      return hour * 60 + mins;
    }
  }

  return fallbackMinutes;
}

/**
 * Builds an ISO-8601 UTC timestamp for a given YYYY-MM-DD date + minutes from midnight in IST (+05:30).
 */
export function buildIstIsoForYmdAndMinutes(
  ymd: string,
  minutesFromMidnight: number
): string {
  if (!YMD_DATE_REGEX.test(ymd)) {
    throw new BookingApiError(
      `Invalid date "${ymd}". Expected YYYY-MM-DD format.`,
      400,
      'INVALID_DATE'
    );
  }
  const [y, m, d] = ymd.split('-').map(Number);
  // Start of day in IST (00:00+05:30) in UTC ms
  const baseUtcMs = Date.UTC(y, m - 1, d, 0, 0, 0, 0) - 330 * 60 * 1000;
  const targetMs = baseUtcMs + minutesFromMidnight * 60 * 1000;
  const dt = new Date(targetMs);
  if (Number.isNaN(dt.getTime())) {
    throw new BookingApiError(`Invalid calendar date "${ymd}".`, 400, 'INVALID_DATE');
  }
  return dt.toISOString();
}

/**
 * Formats a minute-of-day pair (e.g. 1020 -> 1080) as "05:00 PM – 06:00 PM".
 */
export function formatMinutesToClockLabel(totalMinutes: number): string {
  const normalized = ((totalMinutes % 1440) + 1440) % 1440;
  const hours24 = Math.floor(normalized / 60);
  const mins = normalized % 60;
  const period = hours24 >= 12 ? 'PM' : 'AM';
  const hours12 = hours24 % 12 === 0 ? 12 : hours24 % 12;
  return `${String(hours12).padStart(2, '0')}:${String(mins).padStart(2, '0')} ${period}`;
}

export function formatSlotRangeLabel(startMinutes: number, endMinutes: number): string {
  return `${formatMinutesToClockLabel(startMinutes)} – ${formatMinutesToClockLabel(endMinutes)}`;
}

/**
 * Normalizes a date or ISO timestamp input into an ISO string.
 * If bare YYYY-MM-DD is provided, applies the supplied IST minutes-from-midnight.
 */
export function normalizeBookingTimestampInput(
  raw: unknown,
  fallbackIstMinutes: number,
  fieldLabel: string
): string {
  const value = String(raw ?? '').trim();
  if (!value) {
    throw new BookingApiError(`${fieldLabel} is required.`, 400, 'MISSING_TIMESTAMP');
  }
  if (YMD_DATE_REGEX.test(value)) {
    return buildIstIsoForYmdAndMinutes(value, fallbackIstMinutes);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new BookingApiError(
      `${fieldLabel} must be a valid ISO timestamp or YYYY-MM-DD date.`,
      400,
      'INVALID_TIMESTAMP'
    );
  }
  return parsed.toISOString();
}

/**
 * Filters a list of booking rows down to active overlapping holds
 * (`confirmed`, `checked_in`, `blocked`, or `pending_payment` created < 15 mins ago).
 */
export function isActiveOccupancyBooking(
  row: { booking_status?: unknown; created_at?: unknown },
  nowMs = Date.now()
): boolean {
  const status = String(row.booking_status || '');
  if (status === 'confirmed' || status === 'checked_in' || status === 'blocked') {
    return true;
  }
  if (status === 'pending_payment') {
    const createdMs = row.created_at ? Date.parse(String(row.created_at)) : NaN;
    return !Number.isNaN(createdMs) && nowMs - createdMs < BOOKING_HOLD_WINDOW_MS;
  }
  return false;
}
