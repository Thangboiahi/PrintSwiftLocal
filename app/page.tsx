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
import {
  isPrintProfileBusyPaused,
  normalizeClientPrintProfile,
  type PrintSpotlightItem,
} from '@/lib/print-orders/client-helpers';
import type {
  LandingCivicAlertItem,
  LandingCivicHighlightItem,
  LandingDishPreviewItem,
  LandingFoodShopItem,
  LandingRealEstateItem,
  LandingVenueStayItem,
} from '@/lib/home/landing-types';
import { isRealEstateBoostActive } from '@/lib/verticals/filter-catalog';
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
  slug?: string | null;
  name?: string | null;
  display_name?: string | null;
  icon?: string | null;
  icon_name?: string | null;
  base_fare_inr: number | string;
  per_km_rate_inr: number | string;
  wait_per_10min_inr?: number | string | null;
  waiting_charge_per_min_inr?: number | string | null;
  free_wait_minutes?: number | null;
  free_waiting_mins?: number | null;
  two_way_multiplier?: number | string | null;
  max_weight_kg: number | string | null;
  max_dimensions?: string | null;
  capacity_label?: string | null;
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
  if (s.includes('cycle')) {
    return ['parcel', 'gas'];
  }
  if (s.includes('two_wheeler') || s.includes('scooty') || s.includes('e_rickshaw')) {
    return ['parcel', 'passenger', 'gas'];
  }
  if (s.includes('van') || s.includes('auto')) {
    return ['parcel', 'passenger'];
  }
  return ['parcel', 'gas'];
}

function toMediaUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const resolved = resolveRemoteMediaUrl(raw);
  return resolved || null;
}

const CHURACHANDPUR_FALLBACK_FEATURED_LISTINGS: LandingListingPreview[] = [
  {
    id: '00000000-0000-4000-a000-000000000101',
    title: 'DD oodle Print & Digital Hub (Tedim Road)',
    category: 'print_digital',
    subcategory: 'Print & Document Center',
    locality: 'Tedim Road, Lamka',
    address: 'Near Police Station, Tedim Road, Churachandpur',
    rating: 4.9,
    reviewCount: 48,
    imageUrl: null,
  },
  {
    id: '00000000-0000-4000-a000-000000000201',
    title: 'Lamka Hills Café & Smoke Kitchen',
    category: 'restaurant_food',
    subcategory: 'Café & Grill',
    locality: 'New Lamka',
    address: 'Hebron Veng, New Lamka, Churachandpur',
    rating: 4.8,
    reviewCount: 64,
    imageUrl: null,
  },
  {
    id: '00000000-0000-4000-a000-000000000301',
    title: 'Zogam SuperMart & Daily Needs',
    category: 'shop_catalogue',
    subcategory: 'Supermarket & Grocery',
    locality: 'Zenhang Lamka',
    address: 'Main Bazaar, Zenhang Lamka, Churachandpur',
    rating: 4.7,
    reviewCount: 39,
    imageUrl: null,
  },
  {
    id: '00000000-0000-4000-a000-000000000401',
    title: 'Lamka Arena 5v5 Astro Turf',
    category: 'booking_venue',
    subcategory: 'Sports Turf',
    locality: 'Rengkai Road',
    address: 'Rengkai Bridge Junction, Churachandpur',
    rating: 4.9,
    reviewCount: 52,
    imageUrl: null,
  },
];

const CHURACHANDPUR_FALLBACK_PRODUCTS: LandingMarketPreview[] = [
  {
    id: '00000000-0000-4000-b200-000000000001',
    listingId: '00000000-0000-4000-a000-000000000301',
    title: 'Chak-Hao Manipur Black Rice (Premium 1 kg)',
    price: 180,
    unit: '1 kg pack',
    category: 'Groceries',
    inStock: true,
    thumbnailUrl: null,
    shopName: 'Zogam SuperMart & Daily Needs',
    shopLocality: 'Zenhang Lamka',
  },
  {
    id: '00000000-0000-4000-b200-000000000002',
    listingId: '00000000-0000-4000-a000-000000000301',
    title: 'Lamka Wild Forest Honey (Raw Unfiltered)',
    price: 450,
    unit: '500 ml bottle',
    category: 'Organic',
    inStock: true,
    thumbnailUrl: null,
    shopName: 'Zogam SuperMart & Daily Needs',
    shopLocality: 'Zenhang Lamka',
  },
  {
    id: '00000000-0000-4000-b200-000000000011',
    listingId: '00000000-0000-4000-a000-000000000102',
    title: 'JK Cedar 100 GSM Color Laser Paper Ream (500 Sheets)',
    price: 420,
    unit: 'ream',
    category: 'Stationery & Print',
    inStock: true,
    thumbnailUrl: null,
    shopName: 'Zogam Cyber & Laser Copy Center',
    shopLocality: 'New Lamka',
  },
  {
    id: '00000000-0000-4000-b200-000000000012',
    listingId: '00000000-0000-4000-a000-000000000303',
    title: 'Singngat Hill King Chilli (U-Morok) Pickle Jar',
    price: 220,
    unit: '250g jar',
    category: 'Local Spices',
    inStock: true,
    thumbnailUrl: null,
    shopName: 'Tuibong Corner Kirana & Provision',
    shopLocality: 'Tuibong',
  },
];

const CHURACHANDPUR_FALLBACK_BULLETINS: LandingBulletinPreview[] = [
  {
    id: '00000000-0000-4000-f100-000000000001',
    title: 'Lamka Night Football 5v5 Cup — Registration Open',
    excerpt: '16-team floodlit knockout tournament at Lamka Arena Astro Turf, Rengkai Road.',
    category: 'event',
    isPinned: true,
    hasVideo: true,
    authorName: 'Lamka Arena Sports Committee',
    createdAt: new Date().toISOString(),
  },
  {
    id: '00000000-0000-4000-f100-000000000005',
    title: 'Hiring Counter DTP Operator & Pick N Drop Dispatch Riders (Lamka)',
    excerpt: 'Immediate openings in New Lamka & Tuibong for full-time DTP operators and 2-wheeler riders.',
    category: 'job',
    isPinned: true,
    hasVideo: false,
    authorName: 'DD oodle Lamka Hub',
    createdAt: new Date().toISOString(),
  },
  {
    id: '00000000-0000-4000-f100-000000000006',
    title: 'Same-Day Academic Thesis Printing & Hardcover Gold Embossing',
    excerpt: '2-hour express binding and doorstep Pick N Drop delivery across Churachandpur.',
    category: 'advertisement',
    isPinned: false,
    hasVideo: true,
    authorName: 'Zogam Cyber & Laser Copy Center',
    createdAt: new Date().toISOString(),
  },
];

const CHURACHANDPUR_FALLBACK_VEHICLES: LandingVehiclePreview[] = [
  {
    id: '00000000-0000-4000-c000-000000000001',
    originHubId: '00000000-0000-4000-8000-000000000001',
    destinationHubIds: ['00000000-0000-4000-8000-000000000002'],
    title: 'Lamka ↔ Aizawl Express Sumo Cruiser',
    standLocality: 'New Lamka Sumo Counter',
    bookingMode: 'both',
    totalSeats: 9,
    startingPriceInr: 1200,
    startingPriceUnit: '/seat',
    advancePercent: 20,
    withDriver: true,
    isVerified: true,
    thumbnailUrl: null,
  },
  {
    id: '00000000-0000-4000-c000-000000000002',
    originHubId: '00000000-0000-4000-8000-000000000001',
    destinationHubIds: [],
    title: 'Tuibong Town Shifting Mini-Van (Eeco Cargo)',
    standLocality: 'Tuibong Bazaar Stand',
    bookingMode: 'full_vehicle',
    totalSeats: 2,
    startingPriceInr: 450,
    startingPriceUnit: '/hr',
    advancePercent: 20,
    withDriver: true,
    isVerified: true,
    thumbnailUrl: null,
  },
  {
    id: '00000000-0000-4000-c000-000000000005',
    originHubId: '00000000-0000-4000-8000-000000000001',
    destinationHubIds: ['00000000-0000-4000-8000-000000000003'],
    title: 'Lamka ↔ Imphal Airport Express Innova Crysta',
    standLocality: 'Tedim Road Police Point',
    bookingMode: 'both',
    totalSeats: 6,
    startingPriceInr: 350,
    startingPriceUnit: '/seat',
    advancePercent: 20,
    withDriver: true,
    isVerified: true,
    thumbnailUrl: null,
  },
  {
    id: '00000000-0000-4000-c000-000000000006',
    originHubId: '00000000-0000-4000-8000-000000000001',
    destinationHubIds: [],
    title: 'Khuga Dam & Singngat Day Charter Bolero Camper',
    standLocality: 'Zenhang Lamka Stand',
    bookingMode: 'full_vehicle',
    totalSeats: 5,
    startingPriceInr: 2200,
    startingPriceUnit: '/day',
    advancePercent: 25,
    withDriver: true,
    isVerified: true,
    thumbnailUrl: null,
  },
];

async function fetchLiveDistrictSnapshot(): Promise<LandingSnapshot> {
  const fallback: LandingSnapshot = {
    counts: {
      listings: 14,
      marketplaceProducts: 8,
      bulletins: 4,
      vehicleTypes: FALLBACK_VEHICLE_TYPES.length,
      vehicleListings: 4,
    },
    featuredListings: CHURACHANDPUR_FALLBACK_FEATURED_LISTINGS,
    latestProducts: CHURACHANDPUR_FALLBACK_PRODUCTS,
    latestBulletins: CHURACHANDPUR_FALLBACK_BULLETINS,
    featuredVehicles: CHURACHANDPUR_FALLBACK_VEHICLES,
    vehicleTypes: FALLBACK_VEHICLE_TYPES,
    printSpotlight: {
      officialPrintSwift: null,
      printProShops: [],
    },
    civicAlerts: [],
    civicHighlights: [],
    foodAndShops: [],
    venuesAndStays: [],
    featuredRealEstate: [],
    popularDishes: [],
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
      .eq('status', 'published')
      .eq('lifecycle_status', 'active');
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
      .eq('lifecycle_status', 'active')
      .order('rating', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false })
      .limit(6);
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
      featuredListingsQuery,
      latestProductsQuery,
      latestBulletinsQuery,
      serverSupabase
        .from('vehicle_types')
        .select('*')
        .eq('is_active', true)
        .order('base_fare_inr', { ascending: true }),
      vehicleListingsCountQuery,
      featuredVehiclesQuery,
    ]);

    const featuredListings: LandingListingPreview[] =
      featuredListingsRes.status === 'fulfilled' &&
      !featuredListingsRes.value.error &&
      Array.isArray(featuredListingsRes.value.data) &&
      featuredListingsRes.value.data.length > 0
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
        : CHURACHANDPUR_FALLBACK_FEATURED_LISTINGS;

    const latestProducts: LandingMarketPreview[] =
      latestProductsRes.status === 'fulfilled' &&
      !latestProductsRes.value.error &&
      Array.isArray(latestProductsRes.value.data) &&
      latestProductsRes.value.data.length > 0
        ? (latestProductsRes.value.data as RawMarketProductRow[]).map((row) => {
            const joinedShop = Array.isArray(row.listings)
              ? row.listings[0]
              : row.listings;
            return {
              id: row.id,
              listingId: joinedShop?.id || undefined,
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
        : CHURACHANDPUR_FALLBACK_PRODUCTS;

    const latestBulletins: LandingBulletinPreview[] =
      latestBulletinsRes.status === 'fulfilled' &&
      !latestBulletinsRes.value.error &&
      Array.isArray(latestBulletinsRes.value.data) &&
      latestBulletinsRes.value.data.length > 0
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
        : CHURACHANDPUR_FALLBACK_BULLETINS;

    const rawMappedVehicleTypes: VehicleTypeItem[] =
      vehicleTypesRes.status === 'fulfilled' &&
      !vehicleTypesRes.value.error &&
      Array.isArray(vehicleTypesRes.value.data) &&
      vehicleTypesRes.value.data.length > 0
        ? (vehicleTypesRes.value.data as RawVehicleTypeRow[]).map((row) => {
            const resolvedSlug = row.slug || row.id;
            return {
              id: row.id,
              slug: resolvedSlug,
              name: row.name || row.display_name || resolvedSlug,
              icon: row.icon || row.icon_name || 'Truck',
              base_fare_inr: Number(row.base_fare_inr) || 40,
              per_km_rate_inr: Number(row.per_km_rate_inr) || 12,
              wait_per_10min_inr:
                Number(row.wait_per_10min_inr) ||
                (Number(row.waiting_charge_per_min_inr)
                  ? Number(row.waiting_charge_per_min_inr) * 10
                  : 15),
              free_wait_minutes:
                row.free_wait_minutes ?? row.free_waiting_mins ?? 10,
              two_way_multiplier: Number(row.two_way_multiplier) || 1.7,
              max_weight_kg: Number(row.max_weight_kg) || 25,
              max_dimensions: row.max_dimensions || row.capacity_label || null,
              supported_modes: normalizeModes(row.supported_modes, resolvedSlug),
              is_active: row.is_active !== false,
            };
          })
        : FALLBACK_VEHICLE_TYPES;

    const existingFleetSlugs = new Set(
      rawMappedVehicleTypes.map((vt) => vt.slug || vt.id)
    );
    const liveVehicleTypes: VehicleTypeItem[] = [
      ...rawMappedVehicleTypes,
      ...FALLBACK_VEHICLE_TYPES.filter(
        (fb) => !existingFleetSlugs.has(fb.slug) && !existingFleetSlugs.has(fb.id)
      ),
    ].sort((a, b) => a.base_fare_inr - b.base_fare_inr);

    const listingsCount =
      listingsCountRes.status === 'fulfilled' &&
      !listingsCountRes.value.error &&
      typeof listingsCountRes.value.count === 'number' &&
      listingsCountRes.value.count > 0
        ? listingsCountRes.value.count
        : Math.max(14, featuredListings.length);

    const marketCount =
      marketCountRes.status === 'fulfilled' &&
      !marketCountRes.value.error &&
      typeof marketCountRes.value.count === 'number' &&
      marketCountRes.value.count > 0
        ? marketCountRes.value.count
        : Math.max(8, latestProducts.length);

    const bulletinsCount =
      bulletinsCountRes.status === 'fulfilled' &&
      !bulletinsCountRes.value.error &&
      typeof bulletinsCountRes.value.count === 'number' &&
      bulletinsCountRes.value.count > 0
        ? bulletinsCountRes.value.count
        : Math.max(4, latestBulletins.length);

    const vehiclesCount = liveVehicleTypes.length;

    const featuredVehicles: LandingVehiclePreview[] =
      featuredVehiclesRes.status === 'fulfilled' &&
      !featuredVehiclesRes.value.error &&
      Array.isArray(featuredVehiclesRes.value.data) &&
      featuredVehiclesRes.value.data.length > 0
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
        : CHURACHANDPUR_FALLBACK_VEHICLES;

    const vehicleListingsCount =
      vehicleListingsCountRes.status === 'fulfilled' &&
      !vehicleListingsCountRes.value.error &&
      typeof vehicleListingsCountRes.value.count === 'number' &&
      vehicleListingsCountRes.value.count > 0
        ? vehicleListingsCountRes.value.count
        : featuredVehicles.length;

    // Phase 71-D: Fetch hub-scoped Official PrintSwift + up to 4 active Print Pro shops
    let officialPrintSwift: PrintSpotlightItem | null = null;
    const printProShops: PrintSpotlightItem[] = [];
    try {
      const { data: rawPrintRows, error: printErr } = await serverSupabase
        .from('listing_print_profiles')
        .select(
          'listing_id, hub_id, is_first_party_printswift, is_accepting_orders, busy_until, turnaround_badge, capabilities, verified_capabilities, rate_card, payment_policy, listings!inner(id, title, locality, address, hub_id, status, thumbnail_url, cover_image)'
        )
        .limit(20);

      if (!printErr && Array.isArray(rawPrintRows) && rawPrintRows.length > 0) {
        const nowMs = Date.now();
        const candidateItems: Array<{
          item: PrintSpotlightItem;
          rawId: string;
        }> = [];

        for (const row of rawPrintRows as Array<Record<string, unknown>>) {
          const joined = Array.isArray(row.listings)
            ? (row.listings[0] as Record<string, unknown> | undefined)
            : (row.listings as Record<string, unknown> | undefined);
          if (!joined) continue;
          const status = String(joined.status || '').toLowerCase();
          if (status !== 'published' && status !== 'active') continue;
          const listingHubId = joined.hub_id ? String(joined.hub_id) : null;
          if (ssrHubId && listingHubId && listingHubId !== ssrHubId) continue;
          const title = String(joined.title || 'Print Counter');
          if (hideSamples && title.trim().toUpperCase().startsWith('[SAMPLE]')) {
            continue;
          }

          const normalized = normalizeClientPrintProfile(row);
          if (!normalized) continue;

          candidateItems.push({
            rawId: normalized.listing_id,
            item: {
              listingId: normalized.listing_id,
              title: title.replace(/^\[SAMPLE\]\s*/i, ''),
              locality: String(joined.locality || 'Churachandpur'),
              address: joined.address ? String(joined.address) : null,
              coverImage: toMediaUrl(
                (joined.thumbnail_url as string | null) ||
                  (joined.cover_image as string | null)
              ),
              hubId: listingHubId,
              isFirstParty: normalized.is_first_party_printswift,
              isAcceptingOrders: normalized.is_accepting_orders,
              isBusyPaused: isPrintProfileBusyPaused(
                normalized.busy_until,
                nowMs
              ),
              turnaroundBadge: normalized.turnaround_badge,
              capabilities: normalized.capabilities,
              verifiedCapabilities: normalized.verified_capabilities,
              rateCard: normalized.rate_card,
              directPayMaxInr: normalized.payment_policy.direct_pay_max_inr,
              allowEscrow: normalized.payment_policy.allow_escrow,
            },
          });
        }

        const entitlementChecks = await Promise.allSettled(
          candidateItems.map(async ({ rawId, item }) => {
            if (item.isFirstParty) return { item, entitled: true };
            const rpcRes = await serverSupabase.rpc(
              'has_active_print_entitlement',
              { p_listing_id: rawId }
            );
            return {
              item,
              entitled:
                typeof rpcRes.data === 'boolean'
                  ? rpcRes.data
                  : item.isAcceptingOrders,
            };
          })
        );

        for (const check of entitlementChecks) {
          if (check.status !== 'fulfilled') continue;
          const { item, entitled } = check.value;
          if (item.isFirstParty) {
            if (!officialPrintSwift) officialPrintSwift = item;
          } else if (entitled && item.isAcceptingOrders && !item.isBusyPaused) {
            if (printProShops.length < 4) {
              printProShops.push(item);
            }
          }
        }
      }
    } catch {
      // Non-blocking fallback when table/RPC is not yet present
    }

    // Pass R4: Fetch hub-scoped active verticals (Food/Shops, Venues/Stays, Real Estate, Civic & Dishes)
    const civicAlerts: LandingCivicAlertItem[] = [];
    const civicHighlights: LandingCivicHighlightItem[] = [];
    const foodAndShops: LandingFoodShopItem[] = [];
    const venuesAndStays: LandingVenueStayItem[] = [];
    const featuredRealEstate: LandingRealEstateItem[] = [];
    const popularDishes: LandingDishPreviewItem[] = [];

    try {
      let verticalListingsQuery = serverSupabase
        .from('listings')
        .select(
          'id, hub_id, title, locality, listing_vertical, vertical_summary, thumbnail_url, cover_image, lifecycle_status'
        )
        .eq('status', 'published')
        .eq('lifecycle_status', 'active')
        .in('listing_vertical', [
          'restaurant_food',
          'shop_catalogue',
          'booking_venue',
          'hotel_stay',
          'real_estate',
        ])
        .order('created_at', { ascending: false })
        .limit(40);

      let civicQuery = serverSupabase
        .from('listing_civic_profiles')
        .select(
          'listing_id, department_type, is_24x7, helplines, live_civic_alert, listings!inner(id, hub_id, title, locality, status, lifecycle_status)'
        )
        .order('is_24x7', { ascending: false })
        .limit(12);

      const dishesQuery = serverSupabase
        .from('restaurant_menu_items')
        .select(
          'id, listing_id, name, base_price_inr, dietary_type, listings!inner(id, hub_id, title, lifecycle_status)'
        )
        .eq('in_stock', true)
        .limit(20);

      if (ssrHubId) {
        verticalListingsQuery = verticalListingsQuery.eq('hub_id', ssrHubId);
        civicQuery = civicQuery.eq('listings.hub_id', ssrHubId);
      }

      const [vertRes, civicRes, dishesRes] = await Promise.allSettled([
        verticalListingsQuery,
        civicQuery,
        dishesQuery,
      ]);

      const nowMs = Date.now();

      if (
        vertRes.status === 'fulfilled' &&
        !vertRes.value.error &&
        Array.isArray(vertRes.value.data)
      ) {
        for (const row of vertRes.value.data as Array<Record<string, unknown>>) {
          const title = String(row.title || 'Local Place');
          if (hideSamples && title.trim().toUpperCase().startsWith('[SAMPLE]')) {
            continue;
          }
          const cleanTitle = title.replace(/^\[SAMPLE\]\s*/i, '');
          const id = String(row.id || '');
          const locality = String(row.locality || 'Churachandpur');
          const vertical = String(row.listing_vertical || '');
          const s = (
            row.vertical_summary && typeof row.vertical_summary === 'object'
              ? row.vertical_summary
              : {}
          ) as Record<string, unknown>;
          const img = toMediaUrl(
            (row.thumbnail_url as string | null) ||
              (row.cover_image as string | null)
          );

          if (vertical === 'restaurant_food' || vertical === 'shop_catalogue') {
            foodAndShops.push({
              id,
              title: cleanTitle,
              vertical,
              locality,
              imageUrl: img,
              isPureVeg: Boolean(s.is_pure_veg || s.pure_veg),
              fssaiVerified: Boolean(s.fssai_verified || s.fssai_license_no),
              prepEtaMins:
                typeof s.prep_time_mins === 'number'
                  ? s.prep_time_mins
                  : null,
              pickNDropReady: Boolean(
                s.supports_pick_n_drop || s.delivery_ready
              ),
              inStockCount: Number(s.in_stock_count ?? 0),
            });
          } else if (vertical === 'booking_venue' || vertical === 'hotel_stay') {
            const rawRate = Number(
              s.min_rate_inr ?? s.starting_price_inr ?? s.hourly_rate_inr ?? 0
            );
            venuesAndStays.push({
              id,
              title: cleanTitle,
              vertical,
              locality,
              imageUrl: img,
              startingRateInr: Number.isFinite(rawRate) ? rawRate : 0,
              rateUnit: vertical === 'hotel_stay' ? '/night' : '/hr',
            });
          } else if (vertical === 'real_estate') {
            const rawPrice = Number(s.price_inr ?? 0);
            const period =
              s.price_period === 'monthly' || s.price_period === 'yearly'
                ? s.price_period
                : 'total';
            featuredRealEstate.push({
              id,
              title: cleanTitle,
              locality,
              imageUrl: img,
              priceInr: Number.isFinite(rawPrice) ? rawPrice : 0,
              pricePeriod: period,
              transactionType: String(s.transaction_type || 'rent'),
              pattaVerified: Boolean(
                s.patta_verified || s.land_title_type === 'patta'
              ),
              water24x7: Boolean(
                s.water_24x7 || s.water_supply === '24x7_piped'
              ),
              carRoad: Boolean(
                s.road_access === 'car_accessible' ||
                  s.road_access === 'highway_front' ||
                  s.car_road_access
              ),
              isBoosted: isRealEstateBoostActive(s, nowMs),
            });
          }
        }

        // Prioritize verified boosted properties first
        featuredRealEstate.sort(
          (a, b) => Number(b.isBoosted) - Number(a.isBoosted)
        );
      }

      if (
        civicRes.status === 'fulfilled' &&
        !civicRes.value.error &&
        Array.isArray(civicRes.value.data)
      ) {
        for (const row of civicRes.value.data as Array<Record<string, unknown>>) {
          const joined = Array.isArray(row.listings)
            ? (row.listings[0] as Record<string, unknown> | undefined)
            : (row.listings as Record<string, unknown> | undefined);
          if (!joined) continue;
          if (joined.lifecycle_status && joined.lifecycle_status !== 'active') {
            continue;
          }
          const listingId = String(row.listing_id || joined.id || '');
          const title = String(joined.title || 'Public Service');
          const dept = String(row.department_type || 'government_office');
          const helplines = Array.isArray(row.helplines)
            ? (row.helplines as Array<{ phone?: string }>)
            : [];
          const primaryPhone =
            typeof helplines[0]?.phone === 'string'
              ? helplines[0].phone
              : null;

          civicHighlights.push({
            id: listingId,
            title,
            locality: String(joined.locality || 'Central'),
            departmentType: dept,
            is24x7: Boolean(row.is_24x7),
            primaryPhone,
          });

          if (
            typeof row.live_civic_alert === 'string' &&
            row.live_civic_alert.trim().length > 0
          ) {
            civicAlerts.push({
              listingId,
              title,
              alertText: row.live_civic_alert.trim(),
              isEmergency: dept === 'emergency_medical',
            });
          }
        }
      }

      if (
        dishesRes.status === 'fulfilled' &&
        !dishesRes.value.error &&
        Array.isArray(dishesRes.value.data)
      ) {
        for (const row of dishesRes.value.data as Array<Record<string, unknown>>) {
          const joined = Array.isArray(row.listings)
            ? (row.listings[0] as Record<string, unknown> | undefined)
            : (row.listings as Record<string, unknown> | undefined);
          if (!joined) continue;
          if (joined.lifecycle_status && joined.lifecycle_status !== 'active') {
            continue;
          }
          if (ssrHubId && joined.hub_id && String(joined.hub_id) !== ssrHubId) {
            continue;
          }
          popularDishes.push({
            id: String(row.id || ''),
            listingId: String(row.listing_id || joined.id || ''),
            name: String(row.name || 'Dish'),
            priceInr: Number(row.base_price_inr ?? 0),
            restaurantName: String(joined.title || 'Local Restaurant'),
            dietaryType: String(row.dietary_type || 'veg'),
          });
        }
      }
    } catch {
      // Non-blocking
    }

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
      printSpotlight: {
        officialPrintSwift,
        printProShops,
      },
      civicAlerts,
      civicHighlights,
      foodAndShops: foodAndShops.slice(0, 6),
      venuesAndStays: venuesAndStays.slice(0, 6),
      featuredRealEstate: featuredRealEstate.slice(0, 6),
      popularDishes: popularDishes.slice(0, 16),
    };
  } catch {
    return fallback;
  }
}

export default async function HomePage() {
  const snapshot = await fetchLiveDistrictSnapshot();
  return <LandingClient snapshot={snapshot} />;
}
