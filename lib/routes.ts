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
  zoom?: number;
  locality?: string;
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
  hat?:
    | 'customer'
    | 'business'
    | 'owner'
    | 'driver'
    | 'mediator'
    | 'hub_manager'
    | 'master_control'
    | 'staff'
    | 'advertiser';
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
  guides: '/guides',
  saved: '/saved',
  activity: '/activity',
  messages: '/messages',
  workspace: '/workspace',
  workspaceOwner: '/workspace/owner',
  workspaceStaff: '/workspace/staff',
  workspaceDriver: '/workspace/driver',
  workspaceMediator: '/workspace/mediator',
  workspaceHub: '/workspace/hub',
  workspaceAdvertiser: '/workspace/advertiser',
  admin: '/admin',
  onboarding: '/onboarding',
  profile: '/profile',
  profileEdit: '/profile/edit',
  settings: '/settings',
  login: '/login',
  signup: '/signup',
  about: '/about',
  contact: '/contact',
} as const;

export interface PrimaryNavLinkDef {
  id: 'home' | 'explore' | 'bookings' | 'market' | 'civic' | 'bulletin';
  label: string;
  href: string;
}

/**
 * Canonical primary navigation destinations across Desktop, Tablet, and Mobile bars.
 * Home (/) is strictly the first primary destination.
 */
export const PRIMARY_NAV_LINKS: readonly PrimaryNavLinkDef[] = [
  { id: 'home', label: 'Home', href: ROUTES.home },
  { id: 'explore', label: 'Explore', href: ROUTES.explore },
  { id: 'bookings', label: 'Bookings', href: ROUTES.bookings },
  { id: 'market', label: 'Shop & Food', href: ROUTES.marketplace },
  { id: 'civic', label: 'Civic', href: ROUTES.civic },
  { id: 'bulletin', label: 'Bulletin', href: ROUTES.bulletin },
] as const;

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
  if (typeof params.zoom === 'number' && Number.isFinite(params.zoom)) {
    search.set('zoom', String(Math.round(params.zoom)));
  }
  if (params.locality && params.locality.trim()) {
    search.set('locality', params.locality.trim());
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
  let base: string = ROUTES.workspace;
  if (params.hat === 'owner' || params.hat === 'business') {
    base = ROUTES.workspaceOwner;
  } else if (params.hat === 'staff') {
    base = ROUTES.workspaceStaff;
  } else if (params.hat === 'driver') {
    base = ROUTES.workspaceDriver;
  } else if (params.hat === 'mediator') {
    base = ROUTES.workspaceMediator;
  } else if (params.hat === 'hub_manager') {
    base = ROUTES.workspaceHub;
  } else if (params.hat === 'advertiser') {
    base = ROUTES.workspaceAdvertiser;
  } else if (params.hat === 'master_control') {
    base = ROUTES.admin;
  }
  const search = new URLSearchParams();
  if (params.tab) search.set('tab', params.tab);
  const qs = search.toString();
  return qs ? `${base}?${qs}` : base;
}

/**
 * Canonical 7 Quick Jump chips on the Hero search card — each maps to its exact distinct vertical & attribute filter.
 */
export const HERO_QUICK_JUMP_ROUTES = {
  // v21a (P0-23): only the 8 canonical `listings.listing_vertical` keys are routable
  pure_veg: buildExploreRoute({ vertical: 'restaurant_food', attr: 'pure_veg' }),
  open_24x7: buildExploreRoute({ vertical: 'public_civic', attr: 'is_24x7' }),
  turf_courts: buildExploreRoute({ vertical: 'booking_venue', attr: 'floodlights' }),
  guest_stays: buildExploreRoute({ vertical: 'hotel_stay' }),
  print_pro: buildExploreRoute({ vertical: 'print_digital', attr: 'color_laser' }),
  patta_land: buildExploreRoute({ vertical: 'real_estate', attr: 'patta_verified' }),
  pick_n_drop: ROUTES.pickNDrop,
} as const;

/**
 * Canonical 16 Service Launcher cards on the Homepage Launchpad.
 */
export const SERVICE_LAUNCHER_ROUTES = {
  food: buildExploreRoute({ vertical: 'restaurant_food' }),
  hotels: buildExploreRoute({ vertical: 'hotel_stay' }),
  turf: buildExploreRoute({ vertical: 'booking_venue' }),
  hospitals: buildExploreRoute({ vertical: 'public_civic', q: 'hospital' }),
  print: buildExploreRoute({ vertical: 'print_digital' }),
  atms: buildExploreRoute({ vertical: 'public_civic', q: 'atm' }),
  govt: buildExploreRoute({ vertical: 'public_civic', q: 'government office' }),
  emergency: ROUTES.civic,
  tourist: buildExploreRoute({ vertical: 'general', q: 'tourist' }),
  rentals: buildExploreRoute({ vertical: 'real_estate' }),
  schools: buildExploreRoute({ vertical: 'public_civic', q: 'school' }),
  EV_fuel: buildExploreRoute({ vertical: 'general', q: 'fuel' }),
  pick_n_drop: ROUTES.pickNDrop,
  vehicles: ROUTES.vehicles,
  bulletin: ROUTES.bulletin,
  marketplace: ROUTES.marketplace,
} as const;
