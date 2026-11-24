'use client';

import { useCallback, useEffect, useState } from 'react';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { LISTING_VERTICALS, type ListingVertical } from '@/lib/verticals/types';

export interface FeatureToggleLimit {
  enabled: boolean;
  /** `null` represents Unlimited quota; `0` or positive integer is a hard cap */
  limit: number | null;
}

export type EntitlementFeatureKey =
  | 'pnd_dispatch'
  | 'online_payment'
  | 'print_order'
  | 'real_estate_poly'
  | 'staffing'
  | 'bulletins'
  | 'bookings'
  | 'panorama_360'
  | 'featured_boost';

export interface PlanEntitlements {
  allowed_listing_types: ListingVertical[];
  /** `null` = unlimited */
  max_listings: number | null;
  /** `null` = unlimited */
  max_marketplace_items: number | null;
  pnd_dispatch: FeatureToggleLimit;
  online_payment: FeatureToggleLimit;
  print_order: FeatureToggleLimit;
  real_estate_poly: FeatureToggleLimit;
  staffing: FeatureToggleLimit;
  bulletins: FeatureToggleLimit;
  bookings: FeatureToggleLimit;
  panorama_360: FeatureToggleLimit;
  featured_boost: FeatureToggleLimit;
}

export type PlanEntitlementsOverride = Partial<{
  allowed_listing_types: ListingVertical[];
  max_listings: number | null;
  max_marketplace_items: number | null;
  pnd_dispatch: Partial<FeatureToggleLimit>;
  online_payment: Partial<FeatureToggleLimit>;
  print_order: Partial<FeatureToggleLimit>;
  real_estate_poly: Partial<FeatureToggleLimit>;
  staffing: Partial<FeatureToggleLimit>;
  bulletins: Partial<FeatureToggleLimit>;
  bookings: Partial<FeatureToggleLimit>;
  panorama_360: Partial<FeatureToggleLimit>;
  featured_boost: Partial<FeatureToggleLimit>;
}>;

export interface EffectiveEntitlementsSnapshot extends PlanEntitlements {
  is_free_baseline: boolean;
  has_active_subscription: boolean;
  subscription_status: string;
  ends_at: string | null;
  is_super_admin_bypass: boolean;
  active_plan_ids: string[];
}

export interface EntitlementFeatureMeta {
  key: EntitlementFeatureKey;
  label: string;
  description: string;
  unitLabel: string;
  supportsNumericLimit: boolean;
}

export const CANONICAL_LISTING_TYPES: ListingVertical[] = [...LISTING_VERTICALS];

export const LISTING_VERTICAL_LABELS: Record<ListingVertical, string> = {
  general: 'General Business',
  print_digital: 'Print & Digital',
  booking_venue: 'Venue Bookings',
  shop_catalogue: 'Shop Catalogue',
  real_estate: 'Real Estate',
  restaurant_food: 'Food & Dining',
  hotel_stay: 'Hotels & Stays',
  public_civic: 'Public & Civic',
};

export const ENTITLEMENT_FEATURE_KEYS: EntitlementFeatureKey[] = [
  'pnd_dispatch',
  'online_payment',
  'print_order',
  'real_estate_poly',
  'staffing',
  'bulletins',
  'bookings',
  'panorama_360',
  'featured_boost',
];

export const ENTITLEMENT_FEATURE_META: EntitlementFeatureMeta[] = [
  {
    key: 'online_payment',
    label: 'Online UPI Checkout',
    description:
      'Allows listings owned by this subscriber to accept direct UPI payments (when enabled by system policy).',
    unitLabel: 'txns / mo',
    supportsNumericLimit: false,
  },
  {
    key: 'pnd_dispatch',
    label: 'Pick N Drop Dispatch',
    description: 'Attach instant district courier dispatch to orders and listings.',
    unitLabel: 'dispatches / mo',
    supportsNumericLimit: true,
  },
  {
    key: 'print_order',
    label: 'Print & Digital Ordering',
    description: 'Accept online document uploads, print specs, and fulfillment queues.',
    unitLabel: 'orders / mo',
    supportsNumericLimit: true,
  },
  {
    key: 'real_estate_poly',
    label: 'Real Estate Plot Polygons',
    description: 'Draw land boundary polygons with canonical m² / sq.ft measurements.',
    unitLabel: 'plots',
    supportsNumericLimit: true,
  },
  {
    key: 'staffing',
    label: 'Staff Delegation',
    description: 'Assign @username staff operators to manage listings and orders.',
    unitLabel: 'staff seats',
    supportsNumericLimit: true,
  },
  {
    key: 'bulletins',
    label: 'Community Bulletins',
    description: 'Publish announcements, offers, and notices to the District Bulletin Board.',
    unitLabel: 'active posts',
    supportsNumericLimit: true,
  },
  {
    key: 'bookings',
    label: 'Venue & Room Bookings',
    description: 'Enable slot calendars for sports venues, halls, hotels, and homestays.',
    unitLabel: 'resources',
    supportsNumericLimit: true,
  },
  {
    key: 'panorama_360',
    label: '360° Virtual Tours',
    description: 'Upload interactive equirectangular 360° panoramas on listings.',
    unitLabel: 'panoramas',
    supportsNumericLimit: true,
  },
  {
    key: 'featured_boost',
    label: 'Featured Spotlight Boost',
    description: 'Eligible for priority placement and featured badges in Explore.',
    unitLabel: 'boost slots',
    supportsNumericLimit: true,
  },
];

export const SUBSCRIPTION_ROLE_OPTIONS = [
  { id: 'visitor', label: 'Visitor' },
  { id: 'owner', label: 'Business Owner' },
  { id: 'staff', label: 'Staff' },
  { id: 'driver', label: 'Driver / Fleet' },
  { id: 'hub_manager', label: 'Hub Manager' },
  { id: 'admin', label: 'Admin' },
] as const;

export const FREE_BASELINE_ENTITLEMENTS: PlanEntitlements = {
  allowed_listing_types: ['general', 'public_civic'],
  max_listings: 1,
  max_marketplace_items: 3,
  pnd_dispatch: { enabled: false, limit: 0 },
  online_payment: { enabled: false, limit: null },
  print_order: { enabled: false, limit: 0 },
  real_estate_poly: { enabled: false, limit: 0 },
  staffing: { enabled: false, limit: 0 },
  bulletins: { enabled: false, limit: 0 },
  bookings: { enabled: false, limit: 0 },
  panorama_360: { enabled: false, limit: 0 },
  featured_boost: { enabled: false, limit: 0 },
};

export const FREE_BASELINE_SNAPSHOT: EffectiveEntitlementsSnapshot = {
  ...FREE_BASELINE_ENTITLEMENTS,
  is_free_baseline: true,
  has_active_subscription: false,
  subscription_status: 'none',
  ends_at: null,
  is_super_admin_bypass: false,
  active_plan_ids: [],
};

const VALID_VERTICAL_SET = new Set<string>(CANONICAL_LISTING_TYPES);

function parseNullableLimit(
  value: unknown,
  fallback: number | null
): number | null {
  if (value === null) return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return Math.max(0, Math.floor(value));
  }
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.max(0, Math.floor(parsed));
  }
  return fallback;
}

function parseFeatureToggleLimit(
  raw: unknown,
  fallback: FeatureToggleLimit
): FeatureToggleLimit {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) {
    const obj = raw as Record<string, unknown>;
    const enabled =
      typeof obj.enabled === 'boolean' ? obj.enabled : fallback.enabled;
    const limit =
      'limit' in obj
        ? parseNullableLimit(obj.limit, fallback.limit)
        : fallback.limit;
    return { enabled, limit };
  }
  if (typeof raw === 'boolean') {
    return { enabled: raw, limit: raw ? null : 0 };
  }
  return { ...fallback };
}

export function normalizePlanEntitlements(
  raw: unknown,
  fallback: PlanEntitlements = FREE_BASELINE_ENTITLEMENTS
): PlanEntitlements {
  const src =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};

  const rawTypes = Array.isArray(src.allowed_listing_types)
    ? src.allowed_listing_types
        .map((t) => String(t))
        .filter((t): t is ListingVertical => VALID_VERTICAL_SET.has(t))
    : fallback.allowed_listing_types;

  const allowed_listing_types =
    rawTypes.length > 0 ? Array.from(new Set(rawTypes)) : [...fallback.allowed_listing_types];

  return {
    allowed_listing_types,
    max_listings:
      'max_listings' in src
        ? parseNullableLimit(src.max_listings, fallback.max_listings)
        : fallback.max_listings,
    max_marketplace_items:
      'max_marketplace_items' in src
        ? parseNullableLimit(
            src.max_marketplace_items,
            fallback.max_marketplace_items
          )
        : fallback.max_marketplace_items,
    pnd_dispatch: parseFeatureToggleLimit(
      src.pnd_dispatch,
      fallback.pnd_dispatch
    ),
    online_payment: parseFeatureToggleLimit(
      src.online_payment,
      fallback.online_payment
    ),
    print_order: parseFeatureToggleLimit(src.print_order, fallback.print_order),
    real_estate_poly: parseFeatureToggleLimit(
      src.real_estate_poly,
      fallback.real_estate_poly
    ),
    staffing: parseFeatureToggleLimit(src.staffing, fallback.staffing),
    bulletins: parseFeatureToggleLimit(src.bulletins, fallback.bulletins),
    bookings: parseFeatureToggleLimit(src.bookings, fallback.bookings),
    panorama_360: parseFeatureToggleLimit(
      src.panorama_360,
      fallback.panorama_360
    ),
    featured_boost: parseFeatureToggleLimit(
      src.featured_boost,
      fallback.featured_boost
    ),
  };
}

export function mergeEntitlements(
  base: PlanEntitlements,
  overrides?: PlanEntitlementsOverride | Record<string, unknown> | null
): PlanEntitlements {
  if (!overrides || typeof overrides !== 'object') {
    return normalizePlanEntitlements(base);
  }
  const ov = overrides as Record<string, unknown>;
  const normalizedBase = normalizePlanEntitlements(base);
  const next: PlanEntitlements = { ...normalizedBase };

  if (Array.isArray(ov.allowed_listing_types)) {
    const filtered = ov.allowed_listing_types
      .map((t) => String(t))
      .filter((t): t is ListingVertical => VALID_VERTICAL_SET.has(t));
    if (filtered.length > 0) {
      next.allowed_listing_types = Array.from(new Set(filtered));
    }
  }

  if ('max_listings' in ov) {
    next.max_listings = parseNullableLimit(
      ov.max_listings,
      normalizedBase.max_listings
    );
  }
  if ('max_marketplace_items' in ov) {
    next.max_marketplace_items = parseNullableLimit(
      ov.max_marketplace_items,
      normalizedBase.max_marketplace_items
    );
  }

  for (const key of ENTITLEMENT_FEATURE_KEYS) {
    if (key in ov && ov[key] !== undefined) {
      next[key] = parseFeatureToggleLimit(ov[key], normalizedBase[key]);
    }
  }

  return next;
}

export function normalizeEffectiveSnapshot(
  raw: unknown
): EffectiveEntitlementsSnapshot {
  const src =
    raw && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};

  const entitlements = normalizePlanEntitlements(src);
  return {
    ...entitlements,
    is_free_baseline:
      typeof src.is_free_baseline === 'boolean' ? src.is_free_baseline : true,
    has_active_subscription:
      typeof src.has_active_subscription === 'boolean'
        ? src.has_active_subscription
        : false,
    subscription_status: String(src.subscription_status || 'none'),
    ends_at: typeof src.ends_at === 'string' ? src.ends_at : null,
    is_super_admin_bypass: Boolean(src.is_super_admin_bypass),
    active_plan_ids: Array.isArray(src.active_plan_ids)
      ? src.active_plan_ids.map((id) => String(id))
      : [],
  };
}

export async function fetchEffectiveEntitlements(
  userId: string | null | undefined,
  listingId?: string | null
): Promise<EffectiveEntitlementsSnapshot> {
  if (!userId || !isSupabaseConfigured()) {
    return FREE_BASELINE_SNAPSHOT;
  }

  try {
    const { data, error } = await supabase.rpc('get_effective_entitlements', {
      p_user_id: userId,
      p_listing_id: listingId ?? null,
    });

    if (error || !data) {
      return FREE_BASELINE_SNAPSHOT;
    }

    return normalizeEffectiveSnapshot(data);
  } catch {
    return FREE_BASELINE_SNAPSHOT;
  }
}

export interface UseEntitlementsResult {
  entitlements: EffectiveEntitlementsSnapshot;
  isLoading: boolean;
  error: string | null;
  hasFeature: (feature: EntitlementFeatureKey) => boolean;
  getLimit: (feature: EntitlementFeatureKey) => number | null;
  canCreateListingType: (vertical: ListingVertical) => boolean;
  refresh: () => Promise<void>;
}

export function useEntitlements(
  userId?: string | null,
  listingId?: string | null
): UseEntitlementsResult {
  const [entitlements, setEntitlements] =
    useState<EffectiveEntitlementsSnapshot>(FREE_BASELINE_SNAPSHOT);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!userId || !isSupabaseConfigured()) {
      setEntitlements(FREE_BASELINE_SNAPSHOT);
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const result = await fetchEffectiveEntitlements(userId, listingId);
      setEntitlements(result);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : 'Unable to load entitlements.'
      );
      setEntitlements(FREE_BASELINE_SNAPSHOT);
    } finally {
      setIsLoading(false);
    }
  }, [userId, listingId]);

  useEffect(() => {
    queueMicrotask(() => {
      void load();
    });
  }, [load]);

  const hasFeature = useCallback(
    (feature: EntitlementFeatureKey): boolean => {
      if (entitlements.is_super_admin_bypass) return true;
      return Boolean(entitlements[feature]?.enabled);
    },
    [entitlements]
  );

  const getLimit = useCallback(
    (feature: EntitlementFeatureKey): number | null => {
      if (entitlements.is_super_admin_bypass) return null;
      return entitlements[feature]?.limit ?? 0;
    },
    [entitlements]
  );

  const canCreateListingType = useCallback(
    (vertical: ListingVertical): boolean => {
      if (entitlements.is_super_admin_bypass) return true;
      return entitlements.allowed_listing_types.includes(vertical);
    },
    [entitlements]
  );

  return {
    entitlements,
    isLoading,
    error,
    hasFeature,
    getLimit,
    canCreateListingType,
    refresh: load,
  };
}
