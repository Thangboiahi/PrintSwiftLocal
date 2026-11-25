import { ROUTES, buildExploreRoute } from '@/lib/routes';

export type HomepageSection = 'shortcut_grid' | 'quick_jump' | 'featured_banner';

export type HomepageContainerGroup = 'shortcut_grid' | 'quick_jump';

export type HomepageContainerStyle =
  | 'card'
  | 'elevated'
  | 'tinted'
  | 'pill'
  | 'banner';

export interface HomepageContainerRecord {
  id: string;
  slug: string;
  title: string;
  subtitle: string | null;
  icon_key: string;
  accent_color: string;
  section_group: HomepageContainerGroup;
  sort_order: number;
  is_enabled: boolean;
  updated_at?: string | null;
}

export interface HomepageItemRecord {
  id: string;
  item_key?: string | null;
  container_id?: string | null;
  section: HomepageSection;
  title: string;
  subtitle: string | null;
  container_style: HomepageContainerStyle;
  icon_key: string;
  accent_color: string;
  route_key: string;
  query_params: Record<string, string>;
  sort_order: number;
  is_enabled: boolean;
  updated_at?: string | null;
}

export interface PopularLocalityRecord {
  id: string;
  name: string;
  slug: string;
  icon_key: string;
  lat: number;
  lng: number;
  default_zoom: number;
  sort_order: number;
  is_enabled: boolean;
}

export interface HomepageRouteOption {
  key: keyof typeof ROUTES;
  label: string;
  basePath: string;
  suggestedParams: Array<{
    key: string;
    label: string;
    placeholder: string;
    options?: Array<{ value: string; label: string }>;
  }>;
}

export const HOMEPAGE_CONTAINER_STYLE_OPTIONS: Array<{
  value: HomepageContainerStyle;
  label: string;
  description: string;
}> = [
  { value: 'card', label: 'Clean Card', description: 'Standard 1px bordered surface' },
  { value: 'elevated', label: 'Elevated Card', description: 'Subtle shadow + hover lift' },
  { value: 'tinted', label: 'Accent Tinted', description: 'Soft accent wash + colored border' },
  { value: 'pill', label: 'Compact Pill', description: 'Rounded chip for Quick Jumps' },
  { value: 'banner', label: 'Spotlight Banner', description: 'Full-width editorial promo strip' },
];

/**
 * Strict allowlisted route catalog backed exclusively by `lib/routes.ts`.
 * Prevents arbitrary, external, or broken URLs in Homepage Builder items.
 */
export const HOMEPAGE_ROUTE_OPTIONS: HomepageRouteOption[] = [
  {
    key: 'explore',
    label: 'Explore Map & Directory (/explore)',
    basePath: ROUTES.explore,
    suggestedParams: [
      {
        key: 'vertical',
        label: 'Vertical',
        placeholder: 'print_digital',
        options: [
          { value: 'print_digital', label: 'Print & Digital' },
          { value: 'restaurant_food', label: 'Food & Cafes' },
          { value: 'shop_retail', label: 'Shops & Retail' },
          { value: 'booking_venue', label: 'Turfs & Venues' },
          { value: 'hotel_stay', label: 'Hotels & Stays' },
          { value: 'real_estate', label: 'Real Estate' },
          { value: 'civic_public', label: 'Civic & Public' },
          { value: 'general_service', label: 'Local Services' },
        ],
      },
      {
        key: 'mode',
        label: 'Map Mode',
        placeholder: 'pick_n_drop',
        options: [{ value: 'pick_n_drop', label: 'Pick N Drop Logistics' }],
      },
      {
        key: 'serviceType',
        label: 'Pick N Drop Service',
        placeholder: 'parcel',
        options: [
          { value: 'parcel', label: 'Parcel Delivery' },
          { value: 'passenger', label: 'Taxi Ride' },
          { value: 'gas', label: 'LPG Gas Refill' },
        ],
      },
      { key: 'attr', label: 'Attribute Filter', placeholder: 'for_rent or hourly_turf' },
      { key: 'q', label: 'Search Query', placeholder: 'clinic, pizza, turf' },
      {
        key: 'openNow',
        label: 'Open Now',
        placeholder: 'true',
        options: [{ value: 'true', label: 'Yes (true)' }],
      },
      {
        key: 'verified',
        label: 'Verified Only',
        placeholder: 'true',
        options: [{ value: 'true', label: 'Yes (true)' }],
      },
      { key: 'locality', label: 'Locality Slug', placeholder: 'tuibong' },
    ],
  },
  {
    key: 'marketplace',
    label: 'Local Marketplace (/marketplace)',
    basePath: ROUTES.marketplace,
    suggestedParams: [
      { key: 'category', label: 'Category', placeholder: 'electronics, groceries' },
      { key: 'q', label: 'Search Query', placeholder: 'rice, stationery' },
    ],
  },
  {
    key: 'vehicles',
    label: 'Scheduled Vehicles (/vehicles)',
    basePath: ROUTES.vehicles,
    suggestedParams: [
      { key: 'q', label: 'Route / Stand Search', placeholder: 'Imphal, Lamka' },
    ],
  },
  {
    key: 'bulletin',
    label: 'Community Bulletin (/bulletin)',
    basePath: ROUTES.bulletin,
    suggestedParams: [
      {
        key: 'plans',
        label: 'Open Plans Modal',
        placeholder: '1',
        options: [{ value: '1', label: 'Open Bulletin Plans (1)' }],
      },
      { key: 'category', label: 'Bulletin Category', placeholder: 'jobs, events, notices' },
    ],
  },
  {
    key: 'civic',
    label: 'Civic Directory & Helplines (/civic)',
    basePath: ROUTES.civic,
    suggestedParams: [
      {
        key: 'tab',
        label: 'Civic Tab',
        placeholder: 'helplines',
        options: [
          { value: 'helplines', label: 'Emergency Helplines' },
          { value: 'directory', label: 'Public Offices' },
        ],
      },
    ],
  },
  {
    key: 'pickNDrop',
    label: 'Pick N Drop Direct (/pick-n-drop)',
    basePath: ROUTES.pickNDrop,
    suggestedParams: [
      {
        key: 'serviceType',
        label: 'Service Type',
        placeholder: 'parcel',
        options: [
          { value: 'parcel', label: 'Parcel' },
          { value: 'passenger', label: 'Taxi Ride' },
          { value: 'gas', label: 'LPG Gas' },
        ],
      },
    ],
  },
  {
    key: 'onboarding',
    label: 'Partner Onboarding (/onboarding)',
    basePath: ROUTES.onboarding,
    suggestedParams: [
      {
        key: 'track',
        label: 'Partner Track',
        placeholder: 'business',
        options: [
          { value: 'business', label: 'Business Owner' },
          { value: 'driver', label: 'Driver / Fleet' },
          { value: 'advertiser', label: 'Bulletin Advertiser' },
        ],
      },
    ],
  },
  {
    key: 'workspace',
    label: 'Partner Workspace (/workspace)',
    basePath: ROUTES.workspace,
    suggestedParams: [
      {
        key: 'hat',
        label: 'Workspace Role Tab',
        placeholder: 'owner',
        options: [
          { value: 'owner', label: 'Business Owner' },
          { value: 'driver', label: 'Driver Console' },
          { value: 'advertiser', label: 'Advertiser Studio' },
        ],
      },
    ],
  },
  {
    key: 'bookings',
    label: 'My Bookings (/bookings)',
    basePath: ROUTES.bookings,
    suggestedParams: [],
  },
  {
    key: 'activity',
    label: 'My Activity & Orders (/activity)',
    basePath: ROUTES.activity,
    suggestedParams: [],
  },
  {
    key: 'saved',
    label: 'Saved Places (/saved)',
    basePath: ROUTES.saved,
    suggestedParams: [],
  },
  {
    key: 'contact',
    label: 'Contact Support (/contact)',
    basePath: ROUTES.contact,
    suggestedParams: [],
  },
];

const ALLOWED_ROUTE_MAP: Record<string, string> = {
  home: ROUTES.home,
  explore: ROUTES.explore,
  marketplace: ROUTES.marketplace,
  pickNDrop: ROUTES.pickNDrop,
  pick_n_drop: ROUTES.pickNDrop,
  vehicles: ROUTES.vehicles,
  bulletin: ROUTES.bulletin,
  civic: ROUTES.civic,
  bookings: ROUTES.bookings,
  saved: ROUTES.saved,
  activity: ROUTES.activity,
  messages: ROUTES.messages,
  workspace: ROUTES.workspace,
  onboarding: ROUTES.onboarding,
  profile: ROUTES.profile,
  settings: ROUTES.settings,
  about: ROUTES.about,
  contact: ROUTES.contact,
};

export function normalizeQueryParamsRecord(
  raw: unknown
): Record<string, string> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    const cleanKey = k.trim();
    if (!cleanKey || !/^[a-zA-Z0-9_-]{1,40}$/.test(cleanKey)) continue;
    if (v === null || v === undefined) continue;
    const cleanVal = String(v).trim();
    if (!cleanVal) continue;
    result[cleanKey] = cleanVal.slice(0, 120);
  }
  return result;
}

export function normalizeContainerStyle(
  raw: unknown,
  fallback: HomepageContainerStyle = 'card'
): HomepageContainerStyle {
  const val = String(raw || '').trim().toLowerCase();
  if (
    val === 'card' ||
    val === 'elevated' ||
    val === 'tinted' ||
    val === 'pill' ||
    val === 'banner'
  ) {
    return val;
  }
  return fallback;
}

/**
 * Resolves a stored `(route_key, query_params)` pair to a safe internal App Router href.
 * Strictly validates `route_key` against `ROUTES` in `lib/routes.ts` and blocks
 * external URLs, `javascript:`, `data:`, and malformed paths.
 */
export function resolveHomepageItemHref(
  routeKey: string | null | undefined,
  queryParams?: Record<string, string> | null,
  activeHubSlug?: string | null
): string {
  const cleanKey = String(routeKey || '').trim();
  const basePath = ALLOWED_ROUTE_MAP[cleanKey] || ROUTES.explore;
  const params = new URLSearchParams();

  if (
    activeHubSlug &&
    activeHubSlug.trim() &&
    (basePath === ROUTES.explore ||
      basePath === ROUTES.marketplace ||
      basePath === ROUTES.bulletin)
  ) {
    params.set('hub', activeHubSlug.trim());
  }

  const normalized = normalizeQueryParamsRecord(queryParams);
  for (const [k, v] of Object.entries(normalized)) {
    params.set(k, v);
  }

  const qs = params.toString();
  return qs ? `${basePath}?${qs}` : basePath;
}

/**
 * Builds the canonical Explore map deep-link for a Popular Locality chip.
 */
export function buildPopularLocalityExploreHref(
  locality: Pick<PopularLocalityRecord, 'slug' | 'lat' | 'lng' | 'default_zoom'>,
  activeHubSlug?: string | null
): string {
  const base = buildExploreRoute({
    locality: locality.slug,
    lat: locality.lat,
    lng: locality.lng,
    zoom: locality.default_zoom,
  });
  if (!activeHubSlug || !activeHubSlug.trim()) return base;
  const sep = base.includes('?') ? '&' : '?';
  return `${base}${sep}hub=${encodeURIComponent(activeHubSlug.trim())}`;
}

export const DEFAULT_HOMEPAGE_SHORTCUTS: HomepageItemRecord[] = [
  {
    id: 'default-shortcut-print',
    item_key: 'shortcut_print_digital',
    section: 'shortcut_grid',
    title: 'Print & Digital',
    subtitle: 'Upload PDFs & order prints',
    container_style: 'card',
    icon_key: 'printer',
    accent_color: '#2563EB',
    route_key: 'explore',
    query_params: { vertical: 'print_digital' },
    sort_order: 10,
    is_enabled: true,
  },
  {
    id: 'default-shortcut-pnd',
    item_key: 'shortcut_pick_n_drop',
    section: 'shortcut_grid',
    title: 'Pick N Drop',
    subtitle: 'Parcel, taxi & LPG delivery',
    container_style: 'card',
    icon_key: 'truck',
    accent_color: '#EA580C',
    route_key: 'explore',
    query_params: { mode: 'pick_n_drop' },
    sort_order: 20,
    is_enabled: true,
  },
  {
    id: 'default-shortcut-food',
    item_key: 'shortcut_food_restaurants',
    section: 'shortcut_grid',
    title: 'Food & Cafes',
    subtitle: 'Local kitchens & delivery',
    container_style: 'card',
    icon_key: 'utensils',
    accent_color: '#DC2626',
    route_key: 'explore',
    query_params: { vertical: 'restaurant_food' },
    sort_order: 30,
    is_enabled: true,
  },
  {
    id: 'default-shortcut-shops',
    item_key: 'shortcut_shops_groceries',
    section: 'shortcut_grid',
    title: 'Shops & Kirana',
    subtitle: 'Verified local retail stores',
    container_style: 'card',
    icon_key: 'store',
    accent_color: '#059669',
    route_key: 'explore',
    query_params: { vertical: 'shop_retail' },
    sort_order: 40,
    is_enabled: true,
  },
  {
    id: 'default-shortcut-marketplace',
    item_key: 'shortcut_marketplace',
    section: 'shortcut_grid',
    title: 'Marketplace',
    subtitle: 'Live shop catalogues & stock',
    container_style: 'card',
    icon_key: 'shopping-bag',
    accent_color: '#0284C7',
    route_key: 'marketplace',
    query_params: {},
    sort_order: 50,
    is_enabled: true,
  },
  {
    id: 'default-shortcut-vehicles',
    item_key: 'shortcut_vehicles_charters',
    section: 'shortcut_grid',
    title: 'Vehicles & Rides',
    subtitle: 'Taxis, SUVs & inter-hub seats',
    container_style: 'card',
    icon_key: 'car',
    accent_color: '#4F46E5',
    route_key: 'vehicles',
    query_params: {},
    sort_order: 60,
    is_enabled: true,
  },
  {
    id: 'default-shortcut-turfs',
    item_key: 'shortcut_turfs_venues',
    section: 'shortcut_grid',
    title: 'Turfs & Venues',
    subtitle: 'Hourly futsal, halls & courts',
    container_style: 'card',
    icon_key: 'trophy',
    accent_color: '#16A34A',
    route_key: 'explore',
    query_params: { vertical: 'booking_venue' },
    sort_order: 70,
    is_enabled: true,
  },
  {
    id: 'default-shortcut-hotels',
    item_key: 'shortcut_hotels_stays',
    section: 'shortcut_grid',
    title: 'Hotels & Stays',
    subtitle: 'Guest houses & homestays',
    container_style: 'card',
    icon_key: 'bed-double',
    accent_color: '#7C3AED',
    route_key: 'explore',
    query_params: { vertical: 'hotel_stay' },
    sort_order: 80,
    is_enabled: true,
  },
  {
    id: 'default-shortcut-realestate',
    item_key: 'shortcut_real_estate',
    section: 'shortcut_grid',
    title: 'Real Estate',
    subtitle: 'Land plots, houses & rentals',
    container_style: 'card',
    icon_key: 'home',
    accent_color: '#D97706',
    route_key: 'explore',
    query_params: { vertical: 'real_estate' },
    sort_order: 90,
    is_enabled: true,
  },
  {
    id: 'default-shortcut-civic',
    item_key: 'shortcut_civic_directory',
    section: 'shortcut_grid',
    title: 'Civic & Help',
    subtitle: 'Hospitals, police & offices',
    container_style: 'card',
    icon_key: 'shield-check',
    accent_color: '#0F766E',
    route_key: 'civic',
    query_params: {},
    sort_order: 100,
    is_enabled: true,
  },
  {
    id: 'default-shortcut-bulletin',
    item_key: 'shortcut_bulletin_jobs',
    section: 'shortcut_grid',
    title: 'Bulletin & Jobs',
    subtitle: 'Notices, hiring & local events',
    container_style: 'card',
    icon_key: 'megaphone',
    accent_color: '#E11D48',
    route_key: 'bulletin',
    query_params: {},
    sort_order: 110,
    is_enabled: true,
  },
  {
    id: 'default-shortcut-clinics',
    item_key: 'shortcut_clinics_health',
    section: 'shortcut_grid',
    title: 'Clinics & Meds',
    subtitle: 'Pharmacies & doctors nearby',
    container_style: 'card',
    icon_key: 'stethoscope',
    accent_color: '#0D9488',
    route_key: 'explore',
    query_params: { vertical: 'civic_public', q: 'clinic' },
    sort_order: 120,
    is_enabled: true,
  },
  {
    id: 'default-shortcut-services',
    item_key: 'shortcut_local_services',
    section: 'shortcut_grid',
    title: 'Local Services',
    subtitle: 'Repairs, salons & technicians',
    container_style: 'card',
    icon_key: 'wrench',
    accent_color: '#64748B',
    route_key: 'explore',
    query_params: { vertical: 'general_service' },
    sort_order: 130,
    is_enabled: true,
  },
  {
    id: 'default-shortcut-lpg',
    item_key: 'shortcut_lpg_refill',
    section: 'shortcut_grid',
    title: 'LPG Cylinder',
    subtitle: 'Doorstep gas swap & refill',
    container_style: 'card',
    icon_key: 'flame',
    accent_color: '#EA580C',
    route_key: 'explore',
    query_params: { mode: 'pick_n_drop', serviceType: 'gas' },
    sort_order: 140,
    is_enabled: true,
  },
  {
    id: 'default-shortcut-partner',
    item_key: 'shortcut_become_partner',
    section: 'shortcut_grid',
    title: 'List Business',
    subtitle: 'Join as shop, driver or host',
    container_style: 'tinted',
    icon_key: 'sparkles',
    accent_color: '#2563EB',
    route_key: 'onboarding',
    query_params: { track: 'business' },
    sort_order: 150,
    is_enabled: true,
  },
];

export const DEFAULT_HOMEPAGE_QUICK_JUMPS: HomepageItemRecord[] = [
  {
    id: 'default-qj-food',
    item_key: 'qj_open_restaurants',
    section: 'quick_jump',
    title: 'Open Food Spots',
    subtitle: 'Restaurants with home delivery',
    container_style: 'pill',
    icon_key: 'utensils',
    accent_color: '#DC2626',
    route_key: 'explore',
    query_params: { vertical: 'restaurant_food', openNow: 'true' },
    sort_order: 10,
    is_enabled: true,
  },
  {
    id: 'default-qj-rent',
    item_key: 'qj_rent_houses',
    section: 'quick_jump',
    title: 'Houses for Rent',
    subtitle: 'Verified residential rentals',
    container_style: 'pill',
    icon_key: 'home',
    accent_color: '#D97706',
    route_key: 'explore',
    query_params: { vertical: 'real_estate', attr: 'for_rent' },
    sort_order: 20,
    is_enabled: true,
  },
  {
    id: 'default-qj-print',
    item_key: 'qj_verified_print',
    section: 'quick_jump',
    title: 'Instant Print Shops',
    subtitle: 'Online PDF print & binding',
    container_style: 'pill',
    icon_key: 'printer',
    accent_color: '#2563EB',
    route_key: 'explore',
    query_params: { vertical: 'print_digital', verified: 'true' },
    sort_order: 30,
    is_enabled: true,
  },
  {
    id: 'default-qj-turf',
    item_key: 'qj_futsal_turfs',
    section: 'quick_jump',
    title: 'Futsal & Turfs',
    subtitle: 'Book hourly sports slots',
    container_style: 'pill',
    icon_key: 'trophy',
    accent_color: '#16A34A',
    route_key: 'explore',
    query_params: { vertical: 'booking_venue', attr: 'hourly_turf' },
    sort_order: 40,
    is_enabled: true,
  },
  {
    id: 'default-qj-parcel',
    item_key: 'qj_send_parcel',
    section: 'quick_jump',
    title: 'Send Parcel Now',
    subtitle: 'Escrow-protected local rider',
    container_style: 'pill',
    icon_key: 'package',
    accent_color: '#EA580C',
    route_key: 'explore',
    query_params: { mode: 'pick_n_drop', serviceType: 'parcel' },
    sort_order: 50,
    is_enabled: true,
  },
  {
    id: 'default-qj-helplines',
    item_key: 'qj_emergency_helplines',
    section: 'quick_jump',
    title: '24x7 Helplines',
    subtitle: 'Police, hospital & ambulance',
    container_style: 'pill',
    icon_key: 'phone-call',
    accent_color: '#0F766E',
    route_key: 'civic',
    query_params: { tab: 'helplines' },
    sort_order: 60,
    is_enabled: true,
  },
  {
    id: 'default-qj-bulletin',
    item_key: 'qj_bulletin_plans',
    section: 'quick_jump',
    title: 'Post on Bulletin',
    subtitle: 'Jobs, notices & promo plans',
    container_style: 'pill',
    icon_key: 'megaphone',
    accent_color: '#E11D48',
    route_key: 'bulletin',
    query_params: { plans: '1' },
    sort_order: 70,
    is_enabled: true,
  },
];

export const DEFAULT_HOMEPAGE_BANNERS: HomepageItemRecord[] = [
  {
    id: 'default-banner-print',
    item_key: 'banner_official_print',
    section: 'featured_banner',
    title: 'Official Print & Digital Hub — 48h Private Vault',
    subtitle:
      'Upload PDFs or phone photos, preview instant pricing, and collect with OTP or doorstep delivery.',
    container_style: 'banner',
    icon_key: 'printer',
    accent_color: '#2563EB',
    route_key: 'explore',
    query_params: { vertical: 'print_digital' },
    sort_order: 10,
    is_enabled: true,
  },
  {
    id: 'default-banner-pnd',
    item_key: 'banner_escrow_pnd',
    section: 'featured_banner',
    title: 'Pick N Drop Escrow — 5 Verified Fleet Tiers',
    subtitle:
      'From Cycle Rickshaw & Scooty to Bolero Pickup with transparent per-km rates and asymmetric OTP handovers.',
    container_style: 'banner',
    icon_key: 'truck',
    accent_color: '#059669',
    route_key: 'explore',
    query_params: { mode: 'pick_n_drop' },
    sort_order: 20,
    is_enabled: true,
  },
];

export const DEFAULT_POPULAR_LOCALITIES: PopularLocalityRecord[] = [
  {
    id: 'default-loc-lamka',
    name: 'Lamka',
    slug: 'lamka-town',
    icon_key: 'map-pin',
    lat: 24.3335,
    lng: 93.6946,
    default_zoom: 15,
    sort_order: 10,
    is_enabled: true,
  },
  {
    id: 'default-loc-tuibong',
    name: 'Tuibong',
    slug: 'tuibong',
    icon_key: 'building-2',
    lat: 24.351,
    lng: 93.6968,
    default_zoom: 15,
    sort_order: 20,
    is_enabled: true,
  },
  {
    id: 'default-loc-new-lamka',
    name: 'New Lamka',
    slug: 'new-lamka',
    icon_key: 'home',
    lat: 24.3248,
    lng: 93.6865,
    default_zoom: 15,
    sort_order: 30,
    is_enabled: true,
  },
  {
    id: 'default-loc-rengkai',
    name: 'Rengkai',
    slug: 'rengkai',
    icon_key: 'landmark',
    lat: 24.3292,
    lng: 93.7042,
    default_zoom: 15,
    sort_order: 40,
    is_enabled: true,
  },
  {
    id: 'default-loc-zenhang',
    name: 'Zenhang Lamka',
    slug: 'zenhang-lamka',
    icon_key: 'compass',
    lat: 24.3372,
    lng: 93.688,
    default_zoom: 15,
    sort_order: 50,
    is_enabled: true,
  },
  {
    id: 'default-loc-bazar',
    name: 'Churachandpur Bazar',
    slug: 'churachandpur-bazar',
    icon_key: 'store',
    lat: 24.3338,
    lng: 93.6962,
    default_zoom: 16,
    sort_order: 60,
    is_enabled: true,
  },
];

export const DEFAULT_HOMEPAGE_CONTAINERS: HomepageContainerRecord[] = [
  {
    id: 'default-container-all',
    slug: 'all-services',
    title: 'All Services',
    subtitle: 'Complete district launchpad across every vertical',
    icon_key: 'layout-grid',
    accent_color: '#2563EB',
    section_group: 'shortcut_grid',
    sort_order: 10,
    is_enabled: true,
  },
  {
    id: 'default-container-commerce',
    slug: 'local-commerce',
    title: 'Local Commerce',
    subtitle: 'Print hubs, food kitchens, daily kirana & marketplace',
    icon_key: 'shopping-bag',
    accent_color: '#059669',
    section_group: 'shortcut_grid',
    sort_order: 20,
    is_enabled: true,
  },
  {
    id: 'default-container-logistics',
    slug: 'logistics-rides',
    title: 'Logistics & Rides',
    subtitle: 'Pick N Drop courier, LPG swap & inter-hub charters',
    icon_key: 'truck',
    accent_color: '#EA580C',
    section_group: 'shortcut_grid',
    sort_order: 30,
    is_enabled: true,
  },
  {
    id: 'default-container-stays',
    slug: 'stays-venues',
    title: 'Stays & Property',
    subtitle: 'Turfs, community halls, hotels & real estate',
    icon_key: 'building-2',
    accent_color: '#7C3AED',
    section_group: 'shortcut_grid',
    sort_order: 40,
    is_enabled: true,
  },
  {
    id: 'default-container-civic',
    slug: 'civic-essential',
    title: 'Civic & Essential',
    subtitle: 'Hospitals, 24x7 helplines, notices & local services',
    icon_key: 'shield-check',
    accent_color: '#0F766E',
    section_group: 'shortcut_grid',
    sort_order: 50,
    is_enabled: true,
  },
  {
    id: 'default-container-quick-jumps',
    slug: 'quick-jumps',
    title: 'Quick Jumps',
    subtitle: '1-tap filtered shortcuts below the launchpad',
    icon_key: 'sparkles',
    accent_color: '#2563EB',
    section_group: 'quick_jump',
    sort_order: 10,
    is_enabled: true,
  },
];

/**
 * Infers the default container slug for a shortcut item that hasn't been assigned
 * an explicit `container_id` yet (used for zero-blank graceful fallbacks).
 */
export function inferDefaultContainerSlugForItem(
  item: Pick<HomepageItemRecord, 'section' | 'route_key' | 'query_params' | 'item_key'>
): string {
  if (item.section === 'quick_jump') return 'quick-jumps';
  const v = String(item.query_params?.vertical || '').toLowerCase();
  const rk = String(item.route_key || '').toLowerCase();
  const key = String(item.item_key || '').toLowerCase();

  if (
    rk === 'marketplace' ||
    v === 'print_digital' ||
    v === 'restaurant_food' ||
    v === 'shop_retail' ||
    v === 'shop_catalogue' ||
    key.includes('print') ||
    key.includes('food') ||
    key.includes('shop') ||
    key.includes('marketplace')
  ) {
    return 'local-commerce';
  }
  if (
    rk === 'vehicles' ||
    rk === 'pickndrop' ||
    rk === 'pick_n_drop' ||
    item.query_params?.mode === 'pick_n_drop' ||
    key.includes('pick_n_drop') ||
    key.includes('lpg') ||
    key.includes('vehicle')
  ) {
    return 'logistics-rides';
  }
  if (
    v === 'booking_venue' ||
    v === 'hotel_stay' ||
    v === 'real_estate' ||
    key.includes('turf') ||
    key.includes('hotel') ||
    key.includes('real_estate')
  ) {
    return 'stays-venues';
  }
  return 'civic-essential';
}

// =============================================================================
// REAL-TIME FIELD VALIDATION REGISTRY (Superadmin Builders)
// =============================================================================

export const REGISTERED_VERTICAL_VALUES = new Set<string>([
  'print_digital',
  'restaurant_food',
  'shop_catalogue',
  'shop_retail',
  'booking_venue',
  'hotel_stay',
  'real_estate',
  'public_civic',
  'civic_public',
  'general',
  'general_service',
  'healthcare',
  'sports_turf',
  'print_studio',
  'property_rental',
  'atm_bank',
  'govt_office',
  'tourist_spot',
  'school_college',
  'fuel_ev',
]);

export const REGISTERED_ATTR_VALUES = new Set<string>([
  // Print & Digital
  'order_online',
  'verified_color',
  'duplex',
  'binding',
  'custom_digital',
  'color_laser',
  // Restaurant & Food
  'pure_veg',
  'delivery_ready',
  'table_booking',
  'fssai_verified',
  'open_now',
  // Shops
  'pick_n_drop_ready',
  'verified_store',
  // Venues & Turfs
  'hourly_turf',
  'hourly',
  'hall_day',
  'instant_book',
  'floodlights',
  // Hotels
  'wifi',
  'hot_water',
  'power_backup',
  'parking',
  // Real Estate
  'for_rent',
  'rent',
  'for_sale',
  'sale',
  'for_lease',
  'lease',
  'patta_verified',
  'water_24x7',
  'car_road',
  'featured',
  // Public & Civic
  'open_24x7',
  'is_24x7',
  'emergency_medical',
  'government_office',
  'utility_power_water',
  'active_alert',
]);

export const ALLOWED_QUERY_KEYS_BY_ROUTE: Record<string, Set<string>> = {
  explore: new Set([
    'vertical',
    'sub',
    'attr',
    'q',
    'open',
    'openNow',
    'verified',
    'delivery',
    'featured',
    'pin',
    'lat',
    'lng',
    'zoom',
    'locality',
    'mode',
    'serviceType',
    'category',
    'hub',
  ]),
  marketplace: new Set(['q', 'category', 'shop', 'inStock', 'tab', 'hub']),
  vehicles: new Set(['q', 'type', 'hub']),
  bulletin: new Set(['category', 'compose', 'plans', 'hub']),
  civic: new Set(['tab', 'category', 'open247', 'q']),
  pickNDrop: new Set(['serviceType', 'mode']),
  pick_n_drop: new Set(['serviceType', 'mode']),
  onboarding: new Set(['role', 'track', 'vertical', 'intent']),
  workspace: new Set(['hat', 'tab']),
  bookings: new Set(['tab', 'type']),
  activity: new Set(['tab']),
  saved: new Set(['tab']),
  messages: new Set(['thread']),
  profile: new Set(['tab']),
  settings: new Set(['tab']),
  home: new Set([]),
  about: new Set([]),
  contact: new Set([]),
};

const ENUM_VALUES_BY_PARAM: Record<string, Set<string>> = {
  mode: new Set(['pick_n_drop']),
  serviceType: new Set(['parcel', 'passenger', 'gas', 'ride', 'lpg']),
  openNow: new Set(['true', 'false', '1']),
  open: new Set(['true', 'false', '1']),
  verified: new Set(['true', 'false', '1']),
  delivery: new Set(['true', 'false', '1']),
  featured: new Set(['true', 'false', '1']),
  inStock: new Set(['1', 'true']),
  plans: new Set(['1', 'true']),
  compose: new Set(['1', 'true']),
  open247: new Set(['1', 'true']),
  track: new Set(['business', 'driver', 'advertiser']),
  role: new Set(['owner', 'driver', 'advertiser', 'staff', 'mediator']),
  hat: new Set([
    'customer',
    'owner',
    'business',
    'driver',
    'hub_manager',
    'master_control',
    'staff',
    'advertiser',
  ]),
};

export interface ValidationResult {
  isValid: boolean;
  fieldErrors: Record<string, string>;
  paramErrors: Record<string, string>;
}

const HEX_COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const UNSAFE_VALUE_RE = /[<>"'`]|javascript:|data:/i;

export function isRegisteredRouteKey(routeKey: string): boolean {
  return Object.prototype.hasOwnProperty.call(
    ALLOWED_ROUTE_MAP,
    String(routeKey || '').trim()
  );
}

export function validateHomepageItemDraft(
  draft: {
    title: string;
    subtitle?: string;
    route_key: string;
    accent_color: string;
    query_params: Record<string, string>;
  },
  liveCategorySlugs?: string[]
): ValidationResult {
  const fieldErrors: Record<string, string> = {};
  const paramErrors: Record<string, string> = {};

  const title = draft.title.trim();
  if (!title) {
    fieldErrors.title = 'Title is required.';
  } else if (title.length > 72) {
    fieldErrors.title = 'Keep title under 72 characters so cards never clip.';
  }

  if (draft.subtitle && draft.subtitle.trim().length > 160) {
    fieldErrors.subtitle = 'Keep subtitle under 160 characters.';
  }

  const routeKey = String(draft.route_key || '').trim();
  if (!routeKey || !isRegisteredRouteKey(routeKey)) {
    fieldErrors.route_key =
      'Route must be a registered internal path from lib/routes.ts.';
  }

  const accent = String(draft.accent_color || '').trim();
  if (!HEX_COLOR_RE.test(accent)) {
    fieldErrors.accent_color = 'Use a 6-digit hex color like #2563EB.';
  }

  const allowedKeys = ALLOWED_QUERY_KEYS_BY_ROUTE[routeKey] || new Set<string>();
  const categorySlugSet = new Set(
    (liveCategorySlugs || []).map((s) => s.trim().toLowerCase()).filter(Boolean)
  );

  for (const [rawKey, rawVal] of Object.entries(draft.query_params || {})) {
    const key = rawKey.trim();
    const val = String(rawVal ?? '').trim();

    if (!key) {
      paramErrors[rawKey] = 'Parameter key cannot be empty.';
      continue;
    }
    if (!/^[a-zA-Z0-9_-]{1,40}$/.test(key)) {
      paramErrors[key] = 'Key may only contain letters, numbers, _ or -.';
      continue;
    }
    if (allowedKeys.size > 0 && !allowedKeys.has(key)) {
      paramErrors[key] = `"${key}" is not a registered parameter for route "${routeKey}". Open Attribute Hints to copy valid keys.`;
      continue;
    }
    if (!val) {
      paramErrors[key] = `Value for "${key}" cannot be empty.`;
      continue;
    }
    if (UNSAFE_VALUE_RE.test(val) || val.length > 120) {
      paramErrors[key] = `Value for "${key}" contains disallowed characters or exceeds 120 chars.`;
      continue;
    }

    if (key === 'vertical' && !REGISTERED_VERTICAL_VALUES.has(val)) {
      paramErrors[key] = `Unknown vertical "${val}". Copy a valid vertical from Attribute Hints.`;
    } else if (key === 'attr' && !REGISTERED_ATTR_VALUES.has(val)) {
      paramErrors[key] = `Unknown attribute "${val}". Copy a valid attr key from Attribute Hints.`;
    } else if (
      (key === 'sub' || key === 'category') &&
      categorySlugSet.size > 0 &&
      routeKey === 'explore' &&
      !categorySlugSet.has(val.toLowerCase()) &&
      !REGISTERED_VERTICAL_VALUES.has(val.toLowerCase())
    ) {
      paramErrors[key] = `Unknown category slug "${val}". Pick a live category slug from Attribute Hints.`;
    } else if (ENUM_VALUES_BY_PARAM[key] && !ENUM_VALUES_BY_PARAM[key].has(val)) {
      const allowedList = Array.from(ENUM_VALUES_BY_PARAM[key]).join(', ');
      paramErrors[key] = `Invalid value "${val}" for "${key}". Allowed: ${allowedList}.`;
    } else if (key === 'lat') {
      const n = Number(val);
      if (!Number.isFinite(n) || n < -90 || n > 90) {
        paramErrors[key] = 'Latitude must be between -90 and 90.';
      }
    } else if (key === 'lng') {
      const n = Number(val);
      if (!Number.isFinite(n) || n < -180 || n > 180) {
        paramErrors[key] = 'Longitude must be between -180 and 180.';
      }
    } else if (key === 'zoom') {
      const n = Number(val);
      if (!Number.isFinite(n) || n < 10 || n > 20) {
        paramErrors[key] = 'Zoom must be between 10 and 20.';
      }
    }
  }

  return {
    isValid:
      Object.keys(fieldErrors).length === 0 &&
      Object.keys(paramErrors).length === 0,
    fieldErrors,
    paramErrors,
  };
}

export function validateHomepageContainerDraft(
  draft: {
    id?: string;
    title: string;
    slug: string;
    accent_color: string;
    section_group: HomepageContainerGroup;
  },
  existingContainers: Array<{ id: string; slug: string }>
): ValidationResult {
  const fieldErrors: Record<string, string> = {};
  const title = draft.title.trim();
  const slug = draft.slug.trim().toLowerCase();

  if (!title) {
    fieldErrors.title = 'Container tab title is required.';
  } else if (title.length > 42) {
    fieldErrors.title = 'Keep tab title under 42 characters so tabs stay single-line.';
  }

  if (!slug) {
    fieldErrors.slug = 'URL-safe slug is required (e.g. local-commerce).';
  } else if (!SLUG_RE.test(slug)) {
    fieldErrors.slug = 'Slug must use lowercase letters, numbers, and hyphens only.';
  } else if (
    existingContainers.some(
      (c) => c.slug.toLowerCase() === slug && c.id !== draft.id
    )
  ) {
    fieldErrors.slug = `Slug "${slug}" is already used by another container.`;
  }

  if (!HEX_COLOR_RE.test(String(draft.accent_color || '').trim())) {
    fieldErrors.accent_color = 'Use a 6-digit hex color like #2563EB.';
  }

  if (
    draft.section_group !== 'shortcut_grid' &&
    draft.section_group !== 'quick_jump'
  ) {
    fieldErrors.section_group = 'Choose Shortcut Grid or Quick Jump.';
  }

  return {
    isValid: Object.keys(fieldErrors).length === 0,
    fieldErrors,
    paramErrors: {},
  };
}

export function validatePopularLocalityDraft(
  draft: {
    id?: string;
    name: string;
    slug: string;
    lat: string;
    lng: string;
    default_zoom: string;
  },
  existingLocalities: Array<{ id: string; slug: string }>
): ValidationResult {
  const fieldErrors: Record<string, string> = {};
  const name = draft.name.trim();
  const slug = draft.slug.trim().toLowerCase();
  const lat = Number.parseFloat(draft.lat);
  const lng = Number.parseFloat(draft.lng);
  const zoom = Number.parseInt(draft.default_zoom, 10);

  if (!name) fieldErrors.name = 'Locality name is required.';
  if (!slug) {
    fieldErrors.slug = 'Slug is required.';
  } else if (!SLUG_RE.test(slug)) {
    fieldErrors.slug = 'Slug must use lowercase letters, numbers, and hyphens only.';
  } else if (
    existingLocalities.some(
      (l) => l.slug.toLowerCase() === slug && l.id !== draft.id
    )
  ) {
    fieldErrors.slug = `Slug "${slug}" already exists.`;
  }

  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    fieldErrors.lat = 'Latitude must be between -90 and 90.';
  }
  if (!Number.isFinite(lng) || lng < -180 || lng > 180) {
    fieldErrors.lng = 'Longitude must be between -180 and 180.';
  }
  if (!Number.isFinite(zoom) || zoom < 11 || zoom > 19) {
    fieldErrors.default_zoom = 'Default zoom must be between 11 and 19.';
  }

  return {
    isValid: Object.keys(fieldErrors).length === 0,
    fieldErrors,
    paramErrors: {},
  };
}

