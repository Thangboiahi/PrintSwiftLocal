// =============================================================================
// Phase 74-B: Commerce Server Helpers (Auth, Kill-Switches, Entitlements, OTP)
// =============================================================================

import { createHash, randomBytes, randomInt } from 'crypto';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';
import { getServerSessionContext } from '@/lib/auth-server';
import {
  createServerSupabaseAdminClient,
  extractSupabaseAccessToken,
} from '@/lib/pick-n-drop/fare';
import type {
  CommercePaymentPolicy,
  ListingRestaurantProfile,
  ListingShopProfile,
  MenuAddonOption,
  MenuDietType,
  MenuMealSlot,
  MenuVariantOption,
  RestaurantMenuItem,
} from '@/lib/commerce/types';

export interface AuthenticatedCommerceActor {
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

export class CommerceApiError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(message: string, statusCode = 400, code = 'COMMERCE_API_ERROR') {
    super(message);
    this.name = 'CommerceApiError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export const COMMERCE_HOLD_WINDOW_MS = 20 * 60 * 1000;

export function generatePickupOtp(): { otp: string; hash: string } {
  const otp = String(randomInt(1000, 10000));
  const hash = createHash('sha256').update(otp, 'utf8').digest('hex');
  return { otp, hash };
}

export function generateCommerceOrderCode(prefix: 'DDS' | 'DDF' | 'DDT'): string {
  const now = new Date();
  const yy = String(now.getUTCFullYear()).slice(-2);
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  const suffix = String(randomInt(1000, 10000));
  return `${prefix}-${yy}${mm}-${suffix}`;
}

export function generateCommercePaymentIntentCode(): string {
  const suffix = randomBytes(3).toString('hex').toUpperCase();
  return `PSL-${suffix}`;
}

export async function authenticateCommerceRequest(
  req: NextRequest
): Promise<AuthenticatedCommerceActor | null> {
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

  if (!userId) return null;

  const { data: profileRow } = await supabaseAdmin
    .from('profiles')
    .select('id, role, full_name, phone')
    .eq('id', userId)
    .maybeSingle();

  const role = String(profileRow?.role || 'visitor');

  return {
    supabaseAdmin,
    userToken: token,
    userId,
    actualRole: role,
    profile: {
      id: userId,
      role,
      full_name: profileRow?.full_name ? String(profileRow.full_name) : null,
      phone: profileRow?.phone ? String(profileRow.phone) : null,
    },
  };
}

export function createUserScopedSupabaseClient(
  accessToken: string
): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey || !accessToken) return null;
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
}

export async function assertCommerceModuleEnabledForHub(
  supabaseAdmin: SupabaseClient,
  hubId: string,
  vertical: 'shop_catalogue' | 'restaurant_food'
): Promise<void> {
  if (!hubId) return;
  const { data: hubRow } = await supabaseAdmin
    .from('service_hubs')
    .select('name, status, module_switches')
    .eq('id', hubId)
    .maybeSingle();

  if (!hubRow) return;
  const hubName = String(hubRow.name || 'this hub');
  if (String(hubRow.status || 'active') === 'paused') {
    throw new CommerceApiError(
      `Online ordering is currently paused in ${hubName}.`,
      503,
      'HUB_PAUSED'
    );
  }

  const switchKey = vertical === 'restaurant_food' ? 'food_orders' : 'shop_orders';
  const switches =
    hubRow.module_switches &&
    typeof hubRow.module_switches === 'object' &&
    !Array.isArray(hubRow.module_switches)
      ? (hubRow.module_switches as Record<string, unknown>)
      : {};
  const raw = switches[switchKey];

  if (raw === false) {
    throw new CommerceApiError(
      vertical === 'restaurant_food'
        ? `Restaurant & Café ordering is currently paused in ${hubName}.`
        : `Shop Catalogue ordering is currently paused in ${hubName}.`,
      503,
      'MODULE_PAUSED'
    );
  }

  if (
    raw &&
    typeof raw === 'object' &&
    !Array.isArray(raw) &&
    (raw as Record<string, unknown>).enabled === false
  ) {
    const customMsg = String(
      (raw as Record<string, unknown>).pause_message || ''
    ).trim();
    throw new CommerceApiError(
      customMsg ||
        (vertical === 'restaurant_food'
          ? `Restaurant & Café ordering is currently paused in ${hubName}.`
          : `Shop Catalogue ordering is currently paused in ${hubName}.`),
      503,
      'MODULE_PAUSED'
    );
  }
}

export async function assertListingHasCommerceEntitlement(
  supabaseAdmin: SupabaseClient,
  listingId: string,
  vertical: 'shop_catalogue' | 'restaurant_food'
): Promise<void> {
  const { data, error } = await supabaseAdmin.rpc(
    'has_active_commerce_entitlement',
    {
      p_listing_id: listingId,
      p_vertical: vertical,
    }
  );
  if (error || data !== true) {
    throw new CommerceApiError(
      vertical === 'restaurant_food'
        ? 'Online food ordering is not active for this restaurant yet.'
        : 'Online storefront ordering is not active for this shop yet.',
      403,
      'COMMERCE_ENTITLEMENT_REQUIRED'
    );
  }
}

export async function verifyIsCommerceOperatorForListing(params: {
  supabaseAdmin: SupabaseClient;
  userToken: string | null;
  userId: string;
  actualRole: string;
  listingId: string;
}): Promise<boolean> {
  const { supabaseAdmin, userToken, userId, actualRole, listingId } = params;
  if (actualRole.toLowerCase() === 'super_admin') return true;

  if (userToken) {
    const userClient = createUserScopedSupabaseClient(userToken);
    if (userClient) {
      const { data, error } = await userClient.rpc('is_commerce_operator_for', {
        p_listing_id: listingId,
      });
      if (!error && data === true) return true;
    }
  }

  const [listingRes, staffRes] = await Promise.all([
    supabaseAdmin
      .from('listings')
      .select('owner_id')
      .eq('id', listingId)
      .maybeSingle(),
    supabaseAdmin
      .from('staff_delegations')
      .select('id')
      .eq('listing_id', listingId)
      .eq('staff_id', userId)
      .eq('status', 'active')
      .maybeSingle(),
  ]);

  if (listingRes.data && String(listingRes.data.owner_id || '') === userId) {
    return true;
  }
  return Boolean(staffRes.data);
}

function normalizePaymentPolicy(
  raw: unknown,
  defaultCap: number
): CommercePaymentPolicy {
  const obj =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  return {
    allow_direct_pay: obj.allow_direct_pay !== false,
    direct_pay_max_inr: Number.isFinite(Number(obj.direct_pay_max_inr))
      ? Number(obj.direct_pay_max_inr)
      : defaultCap,
    allow_escrow: obj.allow_escrow !== false,
    shop_upi_id: obj.shop_upi_id ? String(obj.shop_upi_id) : null,
    shop_upi_name: obj.shop_upi_name ? String(obj.shop_upi_name) : null,
    shop_upi_verified: Boolean(obj.shop_upi_verified),
  };
}

export function normalizeShopProfileRow(
  row: Record<string, unknown>
): ListingShopProfile {
  return {
    listing_id: String(row.listing_id),
    hub_id: String(row.hub_id),
    is_accepting_orders: row.is_accepting_orders !== false,
    busy_until: row.busy_until ? String(row.busy_until) : null,
    allow_counter_pickup: row.allow_counter_pickup !== false,
    allow_pick_n_drop: row.allow_pick_n_drop !== false,
    min_order_inr: Number(row.min_order_inr || 0),
    packaging_fee_inr: Number(row.packaging_fee_inr || 0),
    prep_time_mins: Number(row.prep_time_mins || 15),
    payment_policy: normalizePaymentPolicy(row.payment_policy, 500),
    store_verified: Boolean(row.store_verified),
    pickup_instructions: row.pickup_instructions
      ? String(row.pickup_instructions)
      : null,
  };
}

export function normalizeRestaurantProfileRow(
  row: Record<string, unknown>
): ListingRestaurantProfile {
  return {
    listing_id: String(row.listing_id),
    hub_id: String(row.hub_id),
    cuisines: Array.isArray(row.cuisines)
      ? row.cuisines.map((c) => String(c))
      : ['Local'],
    avg_cost_for_two_inr: Number(row.avg_cost_for_two_inr || 300),
    is_pure_veg: Boolean(row.is_pure_veg),
    is_kitchen_open: row.is_kitchen_open !== false,
    kitchen_paused_until: row.kitchen_paused_until
      ? String(row.kitchen_paused_until)
      : null,
    prep_time_mins: Number(row.prep_time_mins || 25),
    allow_takeaway: row.allow_takeaway !== false,
    allow_pick_n_drop: row.allow_pick_n_drop !== false,
    allow_table_booking: Boolean(row.allow_table_booking),
    max_table_party_size: Number(row.max_table_party_size || 12),
    packaging_fee_inr: Number(row.packaging_fee_inr || 15),
    min_order_inr: Number(row.min_order_inr || 0),
    fssai_license_no: row.fssai_license_no
      ? String(row.fssai_license_no)
      : null,
    fssai_verified: Boolean(row.fssai_verified),
    payment_policy: normalizePaymentPolicy(row.payment_policy, 400),
    pickup_instructions: row.pickup_instructions
      ? String(row.pickup_instructions)
      : null,
  };
}

export function normalizeMenuItemRow(
  row: Record<string, unknown>
): RestaurantMenuItem {
  return {
    id: String(row.id),
    listing_id: String(row.listing_id),
    hub_id: String(row.hub_id),
    category_name: String(row.category_name || 'Mains'),
    name: String(row.name || 'Dish'),
    description: row.description ? String(row.description) : null,
    diet_type: (row.diet_type as MenuDietType) || 'non_veg',
    base_price_inr: Number(row.base_price_inr || 0),
    variants: Array.isArray(row.variants)
      ? (row.variants as MenuVariantOption[])
      : [],
    addons: Array.isArray(row.addons) ? (row.addons as MenuAddonOption[]) : [],
    meal_slot: (row.meal_slot as MenuMealSlot) || 'all_day',
    is_bestseller: Boolean(row.is_bestseller),
    is_spicy: Boolean(row.is_spicy),
    in_stock: row.in_stock !== false,
    image_url: row.image_url ? String(row.image_url) : null,
    sort_order: Number(row.sort_order || 0),
  };
}

/**
 * Creates a linked Pick N Drop delivery_orders row (+ delivery_order_secrets)
 * for bundled Shop or Hot-Food doorstep delivery.
 */
export async function createLinkedPickNDropDeliveryOrder(params: {
  supabaseAdmin: SupabaseClient;
  customerId: string;
  hubId: string;
  listingTitle: string;
  pickupAddress: string;
  pickupLat: number;
  pickupLng: number;
  senderPhone: string;
  dropoffAddress: string;
  dropoffLat: number;
  dropoffLng: number;
  recipientName: string;
  recipientPhone: string;
  distanceKm: number;
  deliveryFeeInr: number;
  declaredValueInr: number;
  isFoodOrder: boolean;
  linkedShopOrderId?: string | null;
  linkedRestaurantOrderId?: string | null;
  instructions?: string | null;
}): Promise<string> {
  const { supabaseAdmin } = params;

  // Pick a default two-wheeler / parcel vehicle type cleanly
  const { data: vtRow } = await supabaseAdmin
    .from('vehicle_types')
    .select('id')
    .eq('is_active', true)
    .order('sort_order', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!vtRow?.id) {
    throw new CommerceApiError(
      'No active Pick N Drop delivery vehicle type is configured in this hub.',
      503,
      'DELIVERY_FLEET_UNAVAILABLE'
    );
  }

  const deliveryCode = `PND-${String(randomInt(100000, 1000000))}`;
  const pickupOtp = String(randomInt(100000, 1000000));
  const dropoffOtp = String(randomInt(100000, 1000000));

  const { data: created, error } = await supabaseAdmin
    .from('delivery_orders')
    .insert({
      order_code: deliveryCode,
      customer_id: params.customerId,
      hub_id: params.hubId,
      vehicle_type_id: vtRow.id,
      service_mode: 'parcel',
      trip_type: 'one_way',
      container_type: params.isFoodOrder ? 'food_parcel' : 'standard_box',
      instructions: params.instructions || null,
      passenger_count: 1,
      cylinder_count: 1,
      pod_required: true,
      declared_value_inr: Math.max(0, Math.round(params.declaredValueInr)),
      prohibited_items_waiver: true,
      pickup_address: params.pickupAddress,
      pickup_landmark: params.listingTitle,
      pickup_point: `SRID=4326;POINT(${params.pickupLng} ${params.pickupLat})`,
      sender_phone: params.senderPhone || params.recipientPhone || '+910000000000',
      dropoff_address: params.dropoffAddress,
      dropoff_point: `SRID=4326;POINT(${params.dropoffLng} ${params.dropoffLat})`,
      recipient_name: params.recipientName || 'Customer',
      recipient_phone: params.recipientPhone || '+910000000000',
      distance_km: params.distanceKm,
      quoted_fare_inr: params.deliveryFeeInr,
      quote_expires_at: new Date(
        Date.now() + COMMERCE_HOLD_WINDOW_MS
      ).toISOString(),
      linked_shop_order_id: params.linkedShopOrderId ?? null,
      linked_restaurant_order_id: params.linkedRestaurantOrderId ?? null,
      is_food_order: params.isFoodOrder,
      status: 'awaiting_payment',
    })
    .select('id')
    .single();

  if (error || !created?.id) {
    throw new CommerceApiError(
      error?.message || 'Failed to create linked Pick N Drop delivery order.',
      500,
      'DELIVERY_CREATE_FAILED'
    );
  }

  await supabaseAdmin.from('delivery_order_secrets').insert({
    order_id: created.id,
    pickup_otp: pickupOtp,
    dropoff_otp: dropoffOtp,
  });

  return String(created.id);
}
