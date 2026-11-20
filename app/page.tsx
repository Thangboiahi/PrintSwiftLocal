import { createClient } from '@supabase/supabase-js';
import LandingClient, {
  type LandingBulletinPreview,
  type LandingListingPreview,
  type LandingMarketPreview,
  type LandingSnapshot,
  type LandingVehiclePreview,
} from '@/components/home/LandingClient';
import {
  FALLBACK_VEHICLE_TYPES,
  type DeliveryServiceMode,
  type VehicleTypeItem,
} from '@/lib/pick-n-drop/types';
import { resolveRemoteMediaUrl } from '@/lib/supabase/storage';

export const dynamic = 'force-dynamic';

interface RawListingPreviewRow {
  id: string;
  title: string | null;
  category: string | null;
  subcategory: string | null;
  locality: string | null;
  address: string | null;
  rating: number | null;
  review_count: number | null;
  thumbnail_url: string | null;
  cover_image: string | null;
}

interface RawMarketProductRow {
  id: string;
  title: string | null;
  price: number | string | null;
  unit: string | null;
  category: string | null;
  in_stock: boolean | null;
  thumbnail_url: string | null;
  listings?:
    | { id?: string; title?: string | null; locality?: string | null }
    | Array<{ id?: string; title?: string | null; locality?: string | null }>
    | null;
}

interface RawBulletinRow {
  id: string;
  title: string | null;
  excerpt: string | null;
  category: string | null;
  is_pinned: boolean | null;
  youtube_video_id: string | null;
  created_at: string | null;
  profiles?:
    | { full_name?: string | null; name?: string | null }
    | Array<{ full_name?: string | null; name?: string | null }>
    | null;
}

interface RawVehicleTypeRow {
  id: string;
  slug: string;
  name: string;
  icon: string | null;
  base_fare_inr: number | string;
  per_km_rate_inr: number | string;
  wait_per_10min_inr: number | string | null;
  free_wait_minutes: number | null;
  two_way_multiplier: number | string | null;
  max_weight_kg: number | string | null;
  max_dimensions: string | null;
  supported_modes: string[] | null;
  is_active: boolean | null;
}

interface RawFixedRoute {
  origin?: string;
  destination?: string;
  fare_inr?: number | string | null;
  full_vehicle_fare_inr?: number | string | null;
}

interface RawVehicleListingRow {
  id: string;
  origin_hub_id?: string | null;
  destination_hub_ids?: string[] | null;
  title: string | null;
  stand_locality: string | null;
  booking_mode: string | null;
  total_seats: number | null;
  rate_hourly_inr: number | string | null;
  rate_daily_inr: number | string | null;
  rate_per_km_inr: number | string | null;
  fixed_routes: RawFixedRoute[] | null;
  advance_percent: number | null;
  with_driver: boolean | null;
  thumbnail_url: string | null;
  is_verified: boolean | null;
}

function resolveVehicleStartingRate(row: RawVehicleListingRow): {
  price: number;
  unit: string;
} {
  const routes = Array.isArray(row.fixed_routes) ? row.fixed_routes : [];
  const firstSeatFare = routes
    .map((r) => Number(r?.fare_inr))
    .find((n) => Number.isFinite(n) && n > 0);
  if (firstSeatFare && row.booking_mode !== 'full_vehicle') {
    return { price: Math.round(firstSeatFare), unit: '/seat' };
  }
  const hourly = Number(row.rate_hourly_inr);
  if (Number.isFinite(hourly) && hourly > 0) {
    return { price: Math.round(hourly), unit: '/hr' };
  }
  const daily = Number(row.rate_daily_inr);
  if (Number.isFinite(daily) && daily > 0) {
    return { price: Math.round(daily), unit: '/day' };
  }
  const perKm = Number(row.rate_per_km_inr);
  if (Number.isFinite(perKm) && perKm > 0) {
    return { price: Math.round(perKm), unit: '/km' };
  }
  const firstFullFare = routes
    .map((r) => Number(r?.full_vehicle_fare_inr))
    .find((n) => Number.isFinite(n) && n > 0);
  if (firstFullFare) {
    return { price: Math.round(firstFullFare), unit: '/trip' };
  }
  return { price: 0, unit: '' };
}

function normalizeModes(
  raw: string[] | null | undefined,
  slug: string
): DeliveryServiceMode[] {
  const valid: DeliveryServiceMode[] = ['parcel', 'passenger', 'gas'];
  if (Array.isArray(raw) && raw.length > 0) {
    const filtered = raw.filter((m): m is DeliveryServiceMode =>
      valid.includes(m as DeliveryServiceMode)
    );
    if (filtered.length > 0) return filtered;
  }
  const s = slug.toLowerCase();
  if (s.includes('cycle') || s.includes('scooty') || s.includes('e_rickshaw')) {
    return ['parcel', 'passenger', 'gas'];
  }
  if (s.includes('van') || s.includes('auto')) {
    return ['parcel', 'passenger'];
  }
  return ['parcel'];
}

function toMediaUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const resolved = resolveRemoteMediaUrl(raw);
  return resolved || null;
}

async function fetchLiveDistrictSnapshot(): Promise<LandingSnapshot> {
  const fallback: LandingSnapshot = {
    counts: {
      listings: 0,
      marketplaceProducts: 0,
      bulletins: 0,
      vehicleTypes: FALLBACK_VEHICLE_TYPES.length,
      vehicleListings: 0,
    },
    featuredListings: [],
    latestProducts: [],
    latestBulletins: [],
    featuredVehicles: [],
    vehicleTypes: FALLBACK_VEHICLE_TYPES,
  };

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return fallback;
  }

  try {
    const serverSupabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });

    const [{ data: launchRow }, { data: defaultHubRow }] = await Promise.all([
      serverSupabase
        .from('platform_settings')
        .select('value')
        .eq('key', 'hide_sample_data')
        .maybeSingle(),
      serverSupabase
        .from('service_hubs')
        .select('id, slug')
        .eq('is_default', true)
        .maybeSingle(),
    ]);

    const hideSamples = Boolean(
      (launchRow as { value?: { enabled?: boolean } | null } | null)?.value
        ?.enabled
    );
    const ssrHubId =
      (defaultHubRow as { id?: string } | null)?.id?.trim() || null;

    let listingsCountQuery = serverSupabase
      .from('listings')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'published');
    let marketCountQuery = serverSupabase
      .from('marketplace_products')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true);
    let bulletinsCountQuery = serverSupabase
      .from('bulletins')
      .select('id', { count: 'exact', head: true })
      .in('status', ['published', 'active']);
    let featuredListingsQuery = serverSupabase
      .from('listings')
      .select(
        'id, title, category, subcategory, locality, address, rating, review_count, thumbnail_url, cover_image'
      )
      .eq('status', 'published')
      .order('rating', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(4);
    let latestProductsQuery = serverSupabase
      .from('marketplace_products')
      .select(
        'id, title, price, unit, category, in_stock, thumbnail_url, listings(id, title, locality)'
      )
      .eq('is_active', true)
      .order('created_at', { ascending: false })
      .limit(4);
    let latestBulletinsQuery = serverSupabase
      .from('bulletins')
      .select(
        'id, title, excerpt, category, is_pinned, youtube_video_id, created_at, profiles:author_id(full_name, name)'
      )
      .in('status', ['published', 'active'])
      .order('is_pinned', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(3);

    let vehicleListingsCountQuery = serverSupabase
      .from('vehicle_listings')
      .select('id', { count: 'exact', head: true })
      .eq('is_active', true);
    let featuredVehiclesQuery = serverSupabase
      .from('vehicle_listings')
      .select(
        'id, origin_hub_id, destination_hub_ids, title, stand_locality, booking_mode, total_seats, rate_hourly_inr, rate_daily_inr, rate_per_km_inr, fixed_routes, advance_percent, with_driver, thumbnail_url, is_verified'
      )
      .eq('is_active', true)
      .order('is_verified', { ascending: false })
      .order('created_at', { ascending: false })
      .limit(4);

    if (ssrHubId) {
      listingsCountQuery = listingsCountQuery.eq('hub_id', ssrHubId);
      marketCountQuery = marketCountQuery.eq('hub_id', ssrHubId);
      bulletinsCountQuery = bulletinsCountQuery.or(
        `is_global.eq.true,target_hub_ids.cs.{${ssrHubId}}`
      );
      featuredListingsQuery = featuredListingsQuery.eq('hub_id', ssrHubId);
      latestProductsQuery = latestProductsQuery.eq('hub_id', ssrHubId);
      latestBulletinsQuery = latestBulletinsQuery.or(
        `is_global.eq.true,target_hub_ids.cs.{${ssrHubId}}`
      );
      vehicleListingsCountQuery = vehicleListingsCountQuery.or(
        `origin_hub_id.eq.${ssrHubId},destination_hub_ids.cs.{${ssrHubId}}`
      );
      featuredVehiclesQuery = featuredVehiclesQuery.or(
        `origin_hub_id.eq.${ssrHubId},destination_hub_ids.cs.{${ssrHubId}}`
      );
    }

    if (hideSamples) {
      listingsCountQuery = listingsCountQuery.not('title', 'ilike', '[SAMPLE]%');
      marketCountQuery = marketCountQuery.not('title', 'ilike', '[SAMPLE]%');
      bulletinsCountQuery = bulletinsCountQuery.not('title', 'ilike', '[SAMPLE]%');
      featuredListingsQuery = featuredListingsQuery.not('title', 'ilike', '[SAMPLE]%');
      latestProductsQuery = latestProductsQuery.not('title', 'ilike', '[SAMPLE]%');
      latestBulletinsQuery = latestBulletinsQuery.not('title', 'ilike', '[SAMPLE]%');
      vehicleListingsCountQuery = vehicleListingsCountQuery.not(
        'title',
        'ilike',
        '[SAMPLE]%'
      );
      featuredVehiclesQuery = featuredVehiclesQuery.not(
        'title',
        'ilike',
        '[SAMPLE]%'
      );
    }

    const [
      listingsCountRes,
      marketCountRes,
      bulletinsCountRes,
      vehiclesCountRes,
      featuredListingsRes,
      latestProductsRes,
      latestBulletinsRes,
      vehicleTypesRes,
      vehicleListingsCountRes,
      featuredVehiclesRes,
    ] = await Promise.allSettled([
      listingsCountQuery,
      marketCountQuery,
      bulletinsCountQuery,
      serverSupabase
        .from('vehicle_types')
        .select('id', { count: 'exact', head: true })
        .eq('is_active', true),
      featuredListingsQuery,
      latestProductsQuery,
      latestBulletinsQuery,
      serverSupabase
        .from('vehicle_types')
        .select(
          'id, slug, name, icon, base_fare_inr, per_km_rate_inr, wait_per_10min_inr, free_wait_minutes, two_way_multiplier, max_weight_kg, max_dimensions, supported_modes, is_active'
        )
        .eq('is_active', true)
        .order('base_fare_inr', { ascending: true }),
      vehicleListingsCountQuery,
      featuredVehiclesQuery,
    ]);

    const featuredListings: LandingListingPreview[] =
      featuredListingsRes.status === 'fulfilled' &&
      !featuredListingsRes.value.error &&
      Array.isArray(featuredListingsRes.value.data)
        ? (featuredListingsRes.value.data as RawListingPreviewRow[]).map(
            (row) => ({
              id: row.id,
              title: row.title || 'Local Place',
              category: row.category || 'business',
              subcategory: row.subcategory || 'General',
              locality: row.locality || 'Churachandpur',
              address: row.address || 'Churachandpur',
              rating:
                typeof row.rating === 'number' && Number.isFinite(row.rating)
                  ? row.rating
                  : 4.5,
              reviewCount:
                typeof row.review_count === 'number' &&
                Number.isFinite(row.review_count)
                  ? row.review_count
                  : 0,
              imageUrl: toMediaUrl(row.thumbnail_url || row.cover_image),
            })
          )
        : [];

    const latestProducts: LandingMarketPreview[] =
      latestProductsRes.status === 'fulfilled' &&
      !latestProductsRes.value.error &&
      Array.isArray(latestProductsRes.value.data)
        ? (latestProductsRes.value.data as RawMarketProductRow[]).map((row) => {
            const joinedShop = Array.isArray(row.listings)
              ? row.listings[0]
              : row.listings;
            return {
              id: row.id,
              title: row.title || 'Local Product',
              price: Number(row.price) || 0,
              unit: row.unit || 'piece',
              category: row.category || 'General',
              inStock: row.in_stock !== false,
              thumbnailUrl: toMediaUrl(row.thumbnail_url),
              shopName: joinedShop?.title || 'Local Shop',
              shopLocality: joinedShop?.locality || 'Churachandpur',
            };
          })
        : [];

    const latestBulletins: LandingBulletinPreview[] =
      latestBulletinsRes.status === 'fulfilled' &&
      !latestBulletinsRes.value.error &&
      Array.isArray(latestBulletinsRes.value.data)
        ? (latestBulletinsRes.value.data as RawBulletinRow[]).map((row) => {
            const authorProfile = Array.isArray(row.profiles)
              ? row.profiles[0]
              : row.profiles;
            return {
              id: row.id,
              title: row.title || 'Community Notice',
              excerpt: row.excerpt || '',
              category: row.category || 'announcement',
              isPinned: Boolean(row.is_pinned),
              hasVideo: Boolean(row.youtube_video_id),
              authorName:
                authorProfile?.full_name ||
                authorProfile?.name ||
                'Verified Publisher',
              createdAt: row.created_at || new Date().toISOString(),
            };
          })
        : [];

    const liveVehicleTypes: VehicleTypeItem[] =
      vehicleTypesRes.status === 'fulfilled' &&
      !vehicleTypesRes.value.error &&
      Array.isArray(vehicleTypesRes.value.data) &&
      vehicleTypesRes.value.data.length > 0
        ? (vehicleTypesRes.value.data as RawVehicleTypeRow[]).map((row) => ({
            id: row.id,
            slug: row.slug,
            name: row.name,
            icon: row.icon,
            base_fare_inr: Number(row.base_fare_inr) || 40,
            per_km_rate_inr: Number(row.per_km_rate_inr) || 12,
            wait_per_10min_inr: Number(row.wait_per_10min_inr) || 15,
            free_wait_minutes: Number(row.free_wait_minutes) || 10,
            two_way_multiplier: Number(row.two_way_multiplier) || 1.7,
            max_weight_kg: Number(row.max_weight_kg) || 25,
            max_dimensions: row.max_dimensions,
            supported_modes: normalizeModes(row.supported_modes, row.slug),
            is_active: row.is_active !== false,
          }))
        : FALLBACK_VEHICLE_TYPES;

    const listingsCount =
      listingsCountRes.status === 'fulfilled' &&
      !listingsCountRes.value.error &&
      typeof listingsCountRes.value.count === 'number'
        ? listingsCountRes.value.count
        : featuredListings.length;

    const marketCount =
      marketCountRes.status === 'fulfilled' &&
      !marketCountRes.value.error &&
      typeof marketCountRes.value.count === 'number'
        ? marketCountRes.value.count
        : latestProducts.length;

    const bulletinsCount =
      bulletinsCountRes.status === 'fulfilled' &&
      !bulletinsCountRes.value.error &&
      typeof bulletinsCountRes.value.count === 'number'
        ? bulletinsCountRes.value.count
        : latestBulletins.length;

    const vehiclesCount =
      vehiclesCountRes.status === 'fulfilled' &&
      !vehiclesCountRes.value.error &&
      typeof vehiclesCountRes.value.count === 'number' &&
      vehiclesCountRes.value.count > 0
        ? vehiclesCountRes.value.count
        : liveVehicleTypes.length;

    const featuredVehicles: LandingVehiclePreview[] =
      featuredVehiclesRes.status === 'fulfilled' &&
      !featuredVehiclesRes.value.error &&
      Array.isArray(featuredVehiclesRes.value.data)
        ? (featuredVehiclesRes.value.data as RawVehicleListingRow[]).map(
            (row) => {
              const rate = resolveVehicleStartingRate(row);
              return {
                id: row.id,
                originHubId: row.origin_hub_id || null,
                destinationHubIds: Array.isArray(row.destination_hub_ids)
                  ? row.destination_hub_ids.filter(
                      (id): id is string => typeof id === 'string'
                    )
                  : [],
                title: (row.title || 'Local Charter Vehicle').replace(
                  /^\[SAMPLE\]\s*/i,
                  ''
                ),
                standLocality: row.stand_locality || 'Lamka Stand',
                bookingMode:
                  row.booking_mode === 'per_seat'
                    ? 'per_seat'
                    : row.booking_mode === 'both'
                      ? 'both'
                      : 'full_vehicle',
                totalSeats: Number(row.total_seats) || 4,
                startingPriceInr: rate.price,
                startingPriceUnit: rate.unit,
                advancePercent: Number(row.advance_percent) || 20,
                withDriver: row.with_driver !== false,
                isVerified: Boolean(row.is_verified),
                thumbnailUrl: toMediaUrl(row.thumbnail_url),
              };
            }
          )
        : [];

    const vehicleListingsCount =
      vehicleListingsCountRes.status === 'fulfilled' &&
      !vehicleListingsCountRes.value.error &&
      typeof vehicleListingsCountRes.value.count === 'number'
        ? vehicleListingsCountRes.value.count
        : featuredVehicles.length;

    return {
      ssrHubId,
      counts: {
        listings: listingsCount,
        marketplaceProducts: marketCount,
        bulletins: bulletinsCount,
        vehicleTypes: vehiclesCount,
        vehicleListings: vehicleListingsCount,
      },
      featuredListings,
      latestProducts,
      latestBulletins,
      featuredVehicles,
      vehicleTypes: liveVehicleTypes,
    };
  } catch {
    return fallback;
  }
}

export default async function HomePage() {
  const snapshot = await fetchLiveDistrictSnapshot();
  return <LandingClient snapshot={snapshot} />;
}
