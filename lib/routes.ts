/**
 * Centralized Typed Routes & Query-Builder Configuration for DD oodle
 * Single source of truth for all navigation tabs, 16 service cards, 7 quick-jump chips,
 * 4-pillar cards, partner onboarding CTAs, vehicle reservations, and deep-link filters.
 */

export type ExploreFilterParams = {
  q?: string;
  vertical?: string;
  sub?: string;
  attr?: string;
  openNow?: boolean;
  verified?: boolean;
  delivery?: boolean;
  featured?: boolean;
  pin?: string;
  lat?: number;
  lng?: number;
};

export type MarketplaceFilterParams = {
  q?: string;
  category?: string;
  shopId?: string;
  inStock?: boolean;
};

export type BulletinFilterParams = {
  category?: 'all' | 'announcement' | 'job' | 'event' | 'advertisement';
  compose?: boolean;
  plans?: boolean;
};

export type OnboardingParams = {
  role?: 'owner' | 'driver' | 'advertiser' | 'staff' | 'mediator';
  vertical?: string;
  intent?: string;
};

export type WorkspaceParams = {
  hat?: 'customer' | 'business' | 'driver' | 'hub_manager' | 'master_control' | 'staff' | 'advertiser';
  tab?: string;
};

export const ROUTES = {
  home: '/',
  explore: '/explore',
  marketplace: '/marketplace',
  pickNDrop: '/pick-n-drop',
  vehicles: '/vehicles',
  bulletin: '/bulletin',
  civic: '/civic',
  bookings: '/bookings',
  saved: '/saved',
  activity: '/activity',
  messages: '/messages',
  workspace: '/workspace',
  onboarding: '/onboarding',
  profile: '/profile',
  profileEdit: '/profile/edit',
  settings: '/settings',
  login: '/login',
  signup: '/signup',
  about: '/about',
  contact: '/contact',
} as const;

export function buildExploreRoute(params?: ExploreFilterParams): string {
  if (!params) return ROUTES.explore;
  const search = new URLSearchParams();
  if (params.q) search.set('q', params.q);
  if (params.vertical) search.set('vertical', params.vertical);
  if (params.sub) search.set('sub', params.sub);
  if (params.attr) search.set('attr', params.attr);
  if (params.openNow) search.set('open', 'true');
  if (params.verified) search.set('verified', 'true');
  if (params.delivery) search.set('delivery', 'true');
  if (params.featured) search.set('featured', 'true');
  if (params.pin) search.set('pin', params.pin);
  if (typeof params.lat === 'number' && Number.isFinite(params.lat)) {
    search.set('lat', String(params.lat));
  }
  if (typeof params.lng === 'number' && Number.isFinite(params.lng)) {
    search.set('lng', String(params.lng));
  }
  const qs = search.toString();
  return qs ? `${ROUTES.explore}?${qs}` : ROUTES.explore;
}

export function buildListingRoute(idOrSlug: string): string {
  return `/listing/${encodeURIComponent(idOrSlug)}`;
}

export function buildVehicleDetailRoute(id: string, action?: 'reserve' | 'charter'): string {
  const base = `${ROUTES.vehicles}/${encodeURIComponent(id)}`;
  return action ? `${base}?intent=${action}` : base;
}

export function buildMarketplaceRoute(params?: MarketplaceFilterParams): string {
  if (!params) return ROUTES.marketplace;
  const search = new URLSearchParams();
  if (params.q) search.set('q', params.q);
  if (params.category) search.set('category', params.category);
  if (params.shopId) search.set('shop', params.shopId);
  if (params.inStock) search.set('inStock', '1');
  const qs = search.toString();
  return qs ? `${ROUTES.marketplace}?${qs}` : ROUTES.marketplace;
}

export function buildBulletinRoute(params?: BulletinFilterParams): string {
  if (!params) return ROUTES.bulletin;
  const search = new URLSearchParams();
  if (params.category && params.category !== 'all') search.set('category', params.category);
  if (params.compose) search.set('compose', '1');
  if (params.plans) search.set('plans', '1');
  const qs = search.toString();
  return qs ? `${ROUTES.bulletin}?${qs}` : ROUTES.bulletin;
}

export function buildOnboardingRoute(params?: OnboardingParams): string {
  if (!params) return ROUTES.onboarding;
  const search = new URLSearchParams();
  if (params.role) search.set('role', params.role);
  if (params.vertical) search.set('vertical', params.vertical);
  if (params.intent) search.set('intent', params.intent);
  const qs = search.toString();
  return qs ? `${ROUTES.onboarding}?${qs}` : ROUTES.onboarding;
}

export function buildWorkspaceRoute(params?: WorkspaceParams): string {
  if (!params) return ROUTES.workspace;
  const search = new URLSearchParams();
  if (params.hat) search.set('hat', params.hat);
  if (params.tab) search.set('tab', params.tab);
  const qs = search.toString();
  return qs ? `${ROUTES.workspace}?${qs}` : ROUTES.workspace;
}

/**
 * Canonical 7 Quick Jump chips on the Hero search card — each maps to its exact distinct vertical & attribute filter.
 */
export const HERO_QUICK_JUMP_ROUTES = {
  pure_veg: buildExploreRoute({ vertical: 'restaurant_food', attr: 'pure_veg' }),
  open_24x7: buildExploreRoute({ vertical: 'healthcare', attr: 'is_24x7' }),
  turf_courts: buildExploreRoute({ vertical: 'sports_turf', attr: 'floodlights' }),
  guest_stays: buildExploreRoute({ vertical: 'hotel_stay' }),
  print_pro: buildExploreRoute({ vertical: 'print_studio', attr: 'color_laser' }),
  patta_land: buildExploreRoute({ vertical: 'property_rental', attr: 'patta_verified' }),
  pick_n_drop: ROUTES.pickNDrop,
} as const;

/**
 * Canonical 16 Service Launcher cards on the Homepage Launchpad.
 */
export const SERVICE_LAUNCHER_ROUTES = {
  food: buildExploreRoute({ vertical: 'restaurant_food' }),
  hotels: buildExploreRoute({ vertical: 'hotel_stay' }),
  turf: buildExploreRoute({ vertical: 'sports_turf' }),
  hospitals: buildExploreRoute({ vertical: 'healthcare' }),
  print: buildExploreRoute({ vertical: 'print_studio' }),
  atms: buildExploreRoute({ vertical: 'atm_bank' }),
  govt: buildExploreRoute({ vertical: 'govt_office' }),
  emergency: ROUTES.civic,
  tourist: buildExploreRoute({ vertical: 'tourist_spot' }),
  rentals: buildExploreRoute({ vertical: 'property_rental' }),
  schools: buildExploreRoute({ vertical: 'school_college' }),
  EV_fuel: buildExploreRoute({ vertical: 'fuel_ev' }),
  pick_n_drop: ROUTES.pickNDrop,
  vehicles: ROUTES.vehicles,
  bulletin: ROUTES.bulletin,
  marketplace: ROUTES.marketplace,
} as const;
