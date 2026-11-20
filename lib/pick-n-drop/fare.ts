import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { NextRequest } from 'next/server';

export const ALLOWED_TRIP_TYPES = ['one_way', 'two_way'] as const;
export type TripType = (typeof ALLOWED_TRIP_TYPES)[number];

export const ALLOWED_SERVICE_MODES = ['parcel', 'passenger', 'gas'] as const;
export type ServiceMode = (typeof ALLOWED_SERVICE_MODES)[number];

export const ALLOWED_CONTAINER_TYPES = [
  'envelope',
  'small_box',
  'medium_parcel',
  'fragile_crate',
  'bulk_sack',
] as const;
export type ContainerType = (typeof ALLOWED_CONTAINER_TYPES)[number];

export const CONTAINER_SURCHARGES_INR: Record<ContainerType, number> = {
  envelope: 0,
  small_box: 0,
  medium_parcel: 0,
  fragile_crate: 30,
  bulk_sack: 50,
};

export const EXTRA_CYLINDER_SURCHARGE_INR = 20;

export interface VehicleTypeRecord {
  id: string;
  slug: string;
  name: string;
  icon: string | null;
  base_fare_inr: number;
  per_km_rate_inr: number;
  wait_per_10min_inr: number;
  free_wait_minutes: number;
  two_way_multiplier: number;
  max_weight_kg: number;
  max_dimensions: string | null;
  supported_modes: ServiceMode[];
  is_active: boolean;
}

export interface FareBreakdown {
  vehicle_type_id: string;
  vehicle_type_slug: string;
  vehicle_type_name: string;
  service_mode: ServiceMode;
  base_fare_inr: number;
  per_km_rate_inr: number;
  distance_km: number;
  distance_source: 'google_distance_matrix' | 'haversine_fallback';
  distance_fare_inr: number;
  one_way_subtotal_inr: number;
  trip_type: TripType;
  two_way_multiplier: number;
  trip_fare_inr: number;
  container_type: ContainerType | null;
  container_surcharge_inr: number;
  cylinder_count: number;
  cylinder_surcharge_inr: number;
  surcharge_total_inr: number;
  one_way_fare_inr: number;
  two_way_fare_inr: number;
  total_fare_inr: number;
  free_wait_minutes: number;
  wait_per_10min_inr: number;
}

export interface FareQuoteResult {
  distance_km: number;
  one_way_fare_inr: number;
  two_way_fare_inr: number;
  total_fare_inr: number;
  breakdown: FareBreakdown;
  fare_breakdown: FareBreakdown;
  expires_at: string;
  vehicle_type: VehicleTypeRecord;
}

export const QUOTE_TTL_MS = 15 * 60 * 1000; // 15 minutes

const FALLBACK_SERVER_VEHICLES: VehicleTypeRecord[] = [
  {
    id: 'cycle_rickshaw',
    slug: 'cycle_rickshaw',
    name: 'Cycle Rickshaw',
    icon: 'bike',
    base_fare_inr: 30,
    per_km_rate_inr: 8,
    wait_per_10min_inr: 10,
    free_wait_minutes: 15,
    two_way_multiplier: 1.75,
    max_weight_kg: 80,
    max_dimensions: '90 x 70 x 70 cm',
    supported_modes: ['parcel', 'gas'],
    is_active: true,
  },
  {
    id: 'two_wheeler',
    slug: 'two_wheeler',
    name: 'Scooty / Two-Wheeler',
    icon: 'bike',
    base_fare_inr: 40,
    per_km_rate_inr: 10,
    wait_per_10min_inr: 15,
    free_wait_minutes: 15,
    two_way_multiplier: 1.75,
    max_weight_kg: 15,
    max_dimensions: '40 x 30 x 30 cm',
    supported_modes: ['parcel', 'passenger', 'gas'],
    is_active: true,
  },
  {
    id: 'e_rickshaw',
    slug: 'e_rickshaw',
    name: 'E-Rickshaw / Auto',
    icon: 'car-taxi-front',
    base_fare_inr: 70,
    per_km_rate_inr: 15,
    wait_per_10min_inr: 20,
    free_wait_minutes: 15,
    two_way_multiplier: 1.75,
    max_weight_kg: 150,
    max_dimensions: '100 x 80 x 80 cm',
    supported_modes: ['parcel', 'passenger', 'gas'],
    is_active: true,
  },
  {
    id: 'mini_van',
    slug: 'mini_van',
    name: 'Mini Van / Alto',
    icon: 'car',
    base_fare_inr: 120,
    per_km_rate_inr: 20,
    wait_per_10min_inr: 25,
    free_wait_minutes: 15,
    two_way_multiplier: 1.75,
    max_weight_kg: 300,
    max_dimensions: '130 x 100 x 90 cm',
    supported_modes: ['parcel', 'passenger'],
    is_active: true,
  },
  {
    id: 'pickup_truck',
    slug: 'pickup_truck',
    name: 'Pickup Truck / Bolero',
    icon: 'truck',
    base_fare_inr: 250,
    per_km_rate_inr: 30,
    wait_per_10min_inr: 40,
    free_wait_minutes: 20,
    two_way_multiplier: 1.75,
    max_weight_kg: 1000,
    max_dimensions: '220 x 150 x 120 cm',
    supported_modes: ['parcel', 'gas'],
    is_active: true,
  },
];

export function isValidCoordinate(lat: unknown, lng: unknown): boolean {
  if (typeof lat !== 'number' || typeof lng !== 'number') return false;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

export function isTripType(value: unknown): value is TripType {
  return (
    typeof value === 'string' &&
    (ALLOWED_TRIP_TYPES as readonly string[]).includes(value)
  );
}

export function isServiceMode(value: unknown): value is ServiceMode {
  return (
    typeof value === 'string' &&
    (ALLOWED_SERVICE_MODES as readonly string[]).includes(value)
  );
}

export function isContainerType(value: unknown): value is ContainerType {
  return (
    typeof value === 'string' &&
    (ALLOWED_CONTAINER_TYPES as readonly string[]).includes(value)
  );
}

/**
 * Creates a server-side Supabase client (preferring SUPABASE_SERVICE_ROLE_KEY when available).
 */
export function createServerSupabaseAdminClient(): SupabaseClient {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'Server Supabase configuration missing: NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required.'
    );
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

/**
 * Creates a server-side read client (service role if available, otherwise anon key).
 */
export function createServerSupabaseReadClient(): SupabaseClient | null {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !key) {
    return null;
  }

  return createClient(supabaseUrl, key, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

/**
 * Extracts Supabase access token from Authorization Bearer header or Supabase auth cookies.
 */
export function extractSupabaseAccessToken(req: NextRequest): string | null {
  const authHeader = req.headers.get('authorization') || '';
  if (authHeader.toLowerCase().startsWith('bearer ')) {
    const token = authHeader.slice(7).trim();
    if (token) return token;
  }

  const directToken =
    req.cookies.get('sb-access-token')?.value ||
    req.cookies.get('supabase-auth-token')?.value;
  if (directToken) return directToken;

  const allCookies = req.cookies.getAll();
  const sbCookie = allCookies.find(
    (c) => /^sb-.*-auth-token$/.test(c.name) && c.value
  );
  if (!sbCookie?.value) return null;

  try {
    const rawVal = sbCookie.value.startsWith('base64-')
      ? Buffer.from(sbCookie.value.slice(7), 'base64').toString('utf8')
      : decodeURIComponent(sbCookie.value);
    const parsed = JSON.parse(rawVal) as
      | { access_token?: string }
      | [string, ...unknown[]];
    if (Array.isArray(parsed) && typeof parsed[0] === 'string') {
      return parsed[0];
    }
    if (
      parsed &&
      !Array.isArray(parsed) &&
      typeof parsed.access_token === 'string'
    ) {
      return parsed.access_token;
    }
  } catch {
    // ignore malformed auth cookie
  }

  return null;
}

/**
 * Straight-line Haversine distance in kilometers (used for geofence radius validation).
 */
export function computeStraightLineDistanceKm(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number
): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthRadiusKm = 6371;

  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) *
      Math.cos(toRad(lat2)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);

  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return Number((earthRadiusKm * c).toFixed(3));
}

/**
 * Straight-line Haversine distance in kilometers multiplied by 1.25 road tortuosity factor
 * (Churachandpur hill/town road network fallback when Google Distance Matrix is unavailable).
 */
export function computeHaversineRoadDistanceKm(
  pickupLat: number,
  pickupLng: number,
  dropoffLat: number,
  dropoffLng: number
): number {
  const straightLineKm = computeStraightLineDistanceKm(
    pickupLat,
    pickupLng,
    dropoffLat,
    dropoffLng
  );
  const roadEstimateKm = straightLineKm * 1.25;

  return Math.max(0.5, Number(roadEstimateKm.toFixed(2)));
}

/**
 * Calculates driving distance using Google Distance Matrix API if a key is configured,
 * falling back seamlessly to Haversine * 1.25.
 */
export async function computeDrivingDistanceKm(
  pickupLat: number,
  pickupLng: number,
  dropoffLat: number,
  dropoffLng: number
): Promise<{
  distanceKm: number;
  source: 'google_distance_matrix' | 'haversine_fallback';
}> {
  const apiKey =
    process.env.GOOGLE_MAPS_PLATFORM_KEY ||
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;

  if (apiKey && apiKey.trim().length > 0) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 4500);
      const url = new URL(
        'https://maps.googleapis.com/maps/api/distancematrix/json'
      );
      url.searchParams.set('origins', `${pickupLat},${pickupLng}`);
      url.searchParams.set('destinations', `${dropoffLat},${dropoffLng}`);
      url.searchParams.set('mode', 'driving');
      url.searchParams.set('units', 'metric');
      url.searchParams.set('key', apiKey.trim());

      const res = await fetch(url.toString(), {
        method: 'GET',
        signal: controller.signal,
        cache: 'no-store',
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const json = (await res.json()) as {
          status?: string;
          rows?: Array<{
            elements?: Array<{
              status?: string;
              distance?: { value?: number };
            }>;
          }>;
        };

        const element = json?.rows?.[0]?.elements?.[0];
        const meters = element?.distance?.value;
        if (
          json.status === 'OK' &&
          element?.status === 'OK' &&
          typeof meters === 'number' &&
          Number.isFinite(meters) &&
          meters >= 0
        ) {
          return {
            distanceKm: Math.max(0.5, Number((meters / 1000).toFixed(2))),
            source: 'google_distance_matrix',
          };
        }
      }
    } catch {
      // Fallback gracefully to Haversine * 1.25
    }
  }

  return {
    distanceKm: computeHaversineRoadDistanceKm(
      pickupLat,
      pickupLng,
      dropoffLat,
      dropoffLng
    ),
    source: 'haversine_fallback',
  };
}

function normalizeSupportedModes(
  raw: unknown,
  slug: string
): ServiceMode[] {
  if (Array.isArray(raw)) {
    const valid = raw.filter((m): m is ServiceMode => isServiceMode(m));
    if (valid.length > 0) return valid;
  }
  const fallback = FALLBACK_SERVER_VEHICLES.find((v) => v.slug === slug);
  return fallback?.supported_modes || ['parcel', 'passenger', 'gas'];
}

/**
 * Fetches an active vehicle_type by UUID id or slug from Supabase (falling back to local tariff specs for quotes if DB hasn't been seeded yet).
 */
export async function resolveVehicleType(
  supabase: SupabaseClient | null,
  vehicleTypeIdOrSlug: string,
  allowFallback = false
): Promise<VehicleTypeRecord | null> {
  const cleanKey = (vehicleTypeIdOrSlug || '').trim();
  if (!cleanKey) return null;

  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
      cleanKey
    );

  if (supabase) {
    const query = supabase
      .from('vehicle_types')
      .select('*')
      .eq('is_active', true);

    const { data, error } = isUuid
      ? await query.eq('id', cleanKey).maybeSingle()
      : await query.eq('slug', cleanKey).maybeSingle();

    if (!error && data) {
      const slug = String(data.slug);
      return {
        id: String(data.id),
        slug,
        name: String(data.name),
        icon: data.icon ? String(data.icon) : null,
        base_fare_inr: Number(data.base_fare_inr),
        per_km_rate_inr: Number(data.per_km_rate_inr),
        wait_per_10min_inr: Number(data.wait_per_10min_inr),
        free_wait_minutes: Number(data.free_wait_minutes),
        two_way_multiplier: Number(data.two_way_multiplier || 1.75),
        max_weight_kg: Number(data.max_weight_kg),
        max_dimensions: data.max_dimensions
          ? String(data.max_dimensions)
          : null,
        supported_modes: normalizeSupportedModes(data.supported_modes, slug),
        is_active: Boolean(data.is_active),
      };
    }
  }

  if (allowFallback) {
    const matched = FALLBACK_SERVER_VEHICLES.find(
      (v) => v.id === cleanKey || v.slug === cleanKey
    );
    if (matched) return matched;
  }

  return null;
}

export interface DynamicFareSurcharges {
  fragile_crate_inr?: number;
  bulk_sack_inr?: number;
  extra_cylinder_inr?: number;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves a vehicle type with optional per-hub rate overrides from `hub_vehicle_rates`.
 * Rejects vehicle types explicitly disabled for the hub (`is_enabled_in_hub = false`).
 */
export async function resolveHubVehicleTypeAndSurcharges(params: {
  supabase: SupabaseClient | null;
  hubId?: string | null;
  vehicleTypeId: string;
  allowFallback?: boolean;
  globalSurcharges?: DynamicFareSurcharges;
}): Promise<{
  vehicleType: VehicleTypeRecord;
  mergedSurcharges: DynamicFareSurcharges;
  rateSource: 'hub_override' | 'global_default';
}> {
  const baseVehicle = await resolveVehicleType(
    params.supabase,
    params.vehicleTypeId,
    Boolean(params.allowFallback)
  );

  if (!baseVehicle) {
    throw new Error(
      'Selected vehicle type was not found or is currently inactive.'
    );
  }

  let effectiveVehicle: VehicleTypeRecord = { ...baseVehicle };
  const mergedSurcharges: DynamicFareSurcharges = {
    ...(params.globalSurcharges || {}),
  };
  let rateSource: 'hub_override' | 'global_default' = 'global_default';

  const cleanHubId = (params.hubId || '').trim();
  if (
    params.supabase &&
    UUID_PATTERN.test(cleanHubId) &&
    UUID_PATTERN.test(baseVehicle.id)
  ) {
    const { data: hubRate, error: hubRateErr } = await params.supabase
      .from('hub_vehicle_rates')
      .select(
        'is_enabled_in_hub, base_fare_inr, per_km_rate_inr, wait_per_10min_inr, free_wait_minutes, two_way_multiplier, surcharges_override'
      )
      .eq('hub_id', cleanHubId)
      .eq('vehicle_type_id', baseVehicle.id)
      .maybeSingle();

    if (!hubRateErr && hubRate) {
      if (hubRate.is_enabled_in_hub === false) {
        throw new Error(
          `${baseVehicle.name} is not enabled for Pick N Drop in this service hub.`
        );
      }

      rateSource = 'hub_override';
      effectiveVehicle = {
        ...baseVehicle,
        base_fare_inr: Number(hubRate.base_fare_inr ?? baseVehicle.base_fare_inr),
        per_km_rate_inr: Number(
          hubRate.per_km_rate_inr ?? baseVehicle.per_km_rate_inr
        ),
        wait_per_10min_inr: Number(
          hubRate.wait_per_10min_inr ?? baseVehicle.wait_per_10min_inr
        ),
        free_wait_minutes: Number(
          hubRate.free_wait_minutes ?? baseVehicle.free_wait_minutes
        ),
        two_way_multiplier: Number(
          hubRate.two_way_multiplier ?? baseVehicle.two_way_multiplier
        ),
      };

      const overrideObj =
        hubRate.surcharges_override &&
        typeof hubRate.surcharges_override === 'object' &&
        !Array.isArray(hubRate.surcharges_override)
          ? (hubRate.surcharges_override as Record<string, unknown>)
          : null;

      if (overrideObj) {
        if (
          overrideObj.fragile_crate_inr !== undefined &&
          Number.isFinite(Number(overrideObj.fragile_crate_inr))
        ) {
          mergedSurcharges.fragile_crate_inr = Math.max(
            0,
            Number(overrideObj.fragile_crate_inr)
          );
        }
        if (
          overrideObj.bulk_sack_inr !== undefined &&
          Number.isFinite(Number(overrideObj.bulk_sack_inr))
        ) {
          mergedSurcharges.bulk_sack_inr = Math.max(
            0,
            Number(overrideObj.bulk_sack_inr)
          );
        }
        if (
          overrideObj.extra_cylinder_inr !== undefined &&
          Number.isFinite(Number(overrideObj.extra_cylinder_inr))
        ) {
          mergedSurcharges.extra_cylinder_inr = Math.max(
            0,
            Number(overrideObj.extra_cylinder_inr)
          );
        }
      }
    }
  }

  return {
    vehicleType: effectiveVehicle,
    mergedSurcharges,
    rateSource,
  };
}

/**
 * Computes a server-authoritative Pick N Drop fare quote with strict One-Way vs Two-Way differentiation,
 * per-hub rate card overrides, and service-mode surcharges (parcel / passenger / gas).
 */
export async function calculateServerFareQuote(params: {
  supabase: SupabaseClient | null;
  hubId?: string | null;
  pickupLat: number;
  pickupLng: number;
  dropoffLat: number;
  dropoffLng: number;
  vehicleTypeId: string;
  tripType: TripType;
  serviceMode?: ServiceMode;
  containerType?: ContainerType | null;
  cylinderCount?: number;
  allowFallbackVehicle?: boolean;
  surcharges?: DynamicFareSurcharges;
}): Promise<FareQuoteResult> {
  const serviceMode: ServiceMode = params.serviceMode || 'parcel';

  const { vehicleType, mergedSurcharges } =
    await resolveHubVehicleTypeAndSurcharges({
      supabase: params.supabase,
      hubId: params.hubId,
      vehicleTypeId: params.vehicleTypeId,
      allowFallback: Boolean(params.allowFallbackVehicle),
      globalSurcharges: params.surcharges,
    });

  const { distanceKm, source } = await computeDrivingDistanceKm(
    params.pickupLat,
    params.pickupLng,
    params.dropoffLat,
    params.dropoffLng
  );

  const baseFare = Number(vehicleType.base_fare_inr.toFixed(2));
  const distanceFare = Number(
    (distanceKm * vehicleType.per_km_rate_inr).toFixed(2)
  );
  const baseComponent = baseFare + distanceFare;

  const multiplier =
    vehicleType.two_way_multiplier > 1 ? vehicleType.two_way_multiplier : 1.75;
  const oneWayTripFare = Math.round(baseComponent);
  const twoWayTripFare = Math.round(baseComponent * multiplier);

  const resolvedContainerSurcharges: Record<ContainerType, number> = {
    ...CONTAINER_SURCHARGES_INR,
    fragile_crate:
      typeof mergedSurcharges.fragile_crate_inr === 'number' &&
      Number.isFinite(mergedSurcharges.fragile_crate_inr)
        ? Math.max(0, mergedSurcharges.fragile_crate_inr)
        : CONTAINER_SURCHARGES_INR.fragile_crate,
    bulk_sack:
      typeof mergedSurcharges.bulk_sack_inr === 'number' &&
      Number.isFinite(mergedSurcharges.bulk_sack_inr)
        ? Math.max(0, mergedSurcharges.bulk_sack_inr)
        : CONTAINER_SURCHARGES_INR.bulk_sack,
  };

  const resolvedExtraCylinderInr =
    typeof mergedSurcharges.extra_cylinder_inr === 'number' &&
    Number.isFinite(mergedSurcharges.extra_cylinder_inr)
      ? Math.max(0, mergedSurcharges.extra_cylinder_inr)
      : EXTRA_CYLINDER_SURCHARGE_INR;

  const effectiveContainer: ContainerType | null =
    serviceMode === 'parcel' ? params.containerType || 'small_box' : null;
  const containerSurcharge =
    serviceMode === 'parcel' && effectiveContainer
      ? (resolvedContainerSurcharges[effectiveContainer] ?? 0)
      : 0;

  const normalizedCylinderCount =
    serviceMode === 'gas'
      ? Math.max(1, Math.min(10, Math.floor(params.cylinderCount ?? 1)))
      : 1;
  const cylinderSurcharge =
    serviceMode === 'gas'
      ? Math.max(0, normalizedCylinderCount - 1) * resolvedExtraCylinderInr
      : 0;

  const surchargeTotal = containerSurcharge + cylinderSurcharge;
  const oneWayFareInr = oneWayTripFare + surchargeTotal;
  const twoWayFareInr = twoWayTripFare + surchargeTotal;

  const tripFare =
    params.tripType === 'two_way' ? twoWayTripFare : oneWayTripFare;
  const totalFare =
    params.tripType === 'two_way' ? twoWayFareInr : oneWayFareInr;

  const expiresAt = new Date(Date.now() + QUOTE_TTL_MS).toISOString();

  const breakdown: FareBreakdown = {
    vehicle_type_id: vehicleType.id,
    vehicle_type_slug: vehicleType.slug,
    vehicle_type_name: vehicleType.name,
    service_mode: serviceMode,
    base_fare_inr: baseFare,
    per_km_rate_inr: vehicleType.per_km_rate_inr,
    distance_km: distanceKm,
    distance_source: source,
    distance_fare_inr: distanceFare,
    one_way_subtotal_inr: oneWayTripFare,
    trip_type: params.tripType,
    two_way_multiplier: params.tripType === 'two_way' ? multiplier : 1,
    trip_fare_inr: tripFare,
    container_type: effectiveContainer,
    container_surcharge_inr: containerSurcharge,
    cylinder_count: normalizedCylinderCount,
    cylinder_surcharge_inr: cylinderSurcharge,
    surcharge_total_inr: surchargeTotal,
    one_way_fare_inr: oneWayFareInr,
    two_way_fare_inr: twoWayFareInr,
    total_fare_inr: totalFare,
    free_wait_minutes: vehicleType.free_wait_minutes,
    wait_per_10min_inr: vehicleType.wait_per_10min_inr,
  };

  return {
    distance_km: distanceKm,
    one_way_fare_inr: oneWayFareInr,
    two_way_fare_inr: twoWayFareInr,
    total_fare_inr: totalFare,
    breakdown,
    fare_breakdown: breakdown,
    expires_at: expiresAt,
    vehicle_type: vehicleType,
  };
}
