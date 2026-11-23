'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeftRight,
  ArrowRight,
  BadgeCheck,
  Bike,
  Building2,
  Car,
  Clock,
  Compass,
  Flame,
  Globe,
  KeyRound,
  Languages,
  Lock,
  MapPin,
  Megaphone,
  Navigation,
  Package,
  Palette,
  Pin,
  PlayCircle,
  Printer,
  Search,
  ShieldCheck,
  ShoppingBag,
  Sliders,
  Sparkles,
  Star,
  Store,
  Truck,
  Users,
  Wallet,
  Wifi,
} from 'lucide-react';
import {
  FALLBACK_VEHICLE_TYPES,
  type DeliveryServiceMode,
  type VehicleTypeItem,
} from '@/lib/pick-n-drop/types';
import {
  ROUTES,
  buildBulletinRoute,
  buildVehicleDetailRoute,
} from '@/lib/routes';
import { useAppConfig, useHub } from '@/components/providers/AppConfigProvider';
import { PromoBannerSlot } from '@/components/ui/PromoBannerSlot';
import {
  GetFeaturedModal,
  type FeaturedSlotSection,
} from '@/components/home/GetFeaturedModal';
import { splitSamplePrefix } from '@/lib/utils/display-title';
import { DDoodleLogo } from '@/components/ui/DDoodleLogo';
import {
  formatStartingRateLabel,
  getVerifiedCapabilityChipLabels,
  isPrintProfileBusyPaused,
  normalizeClientPrintProfile,
  TURNAROUND_BADGE_LABELS,
  type PrintSpotlightItem,
} from '@/lib/print-orders/client-helpers';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { resolveRemoteMediaUrl } from '@/lib/supabase/storage';
import { useAuth } from '@/lib/store';
import type {
  LandingCivicAlertItem,
  LandingCivicHighlightItem,
  LandingDishPreviewItem,
  LandingFoodShopItem,
  LandingRealEstateItem,
  LandingVenueStayItem,
} from '@/lib/home/landing-types';
import { UniversalAppSearch } from '@/components/home/UniversalAppSearch';
import {
  HubServiceLauncherAndCivicStrip,
  HubVerticalSpotlights,
  isHubModuleEnabled,
} from '@/components/home/LandingLaunchpadSections';

export interface LandingListingPreview {
  id: string;
  title: string;
  category: string;
  subcategory: string;
  locality: string;
  address: string;
  rating: number;
  reviewCount: number;
  imageUrl: string | null;
}

export interface LandingMarketPreview {
  id: string;
  listingId?: string;
  title: string;
  price: number;
  unit: string;
  category: string;
  inStock: boolean;
  thumbnailUrl: string | null;
  shopName: string;
  shopLocality: string;
}

export interface LandingBulletinPreview {
  id: string;
  title: string;
  excerpt: string;
  category: string;
  isPinned: boolean;
  hasVideo: boolean;
  authorName: string;
  createdAt: string;
}

export interface LandingVehiclePreview {
  id: string;
  originHubId?: string | null;
  destinationHubIds?: string[];
  title: string;
  standLocality: string;
  bookingMode: 'full_vehicle' | 'per_seat' | 'both';
  totalSeats: number;
  startingPriceInr: number;
  startingPriceUnit: string;
  advancePercent: number;
  withDriver: boolean;
  isVerified: boolean;
  thumbnailUrl: string | null;
}

export interface LandingSnapshot {
  ssrHubId?: string | null;
  counts: {
    listings: number;
    marketplaceProducts: number;
    bulletins: number;
    vehicleTypes: number;
    vehicleListings?: number;
  };
  featuredListings: LandingListingPreview[];
  latestProducts: LandingMarketPreview[];
  latestBulletins: LandingBulletinPreview[];
  featuredVehicles?: LandingVehiclePreview[];
  vehicleTypes: VehicleTypeItem[];
  printSpotlight?: {
    officialPrintSwift: PrintSpotlightItem | null;
    printProShops: PrintSpotlightItem[];
  };
  civicAlerts?: LandingCivicAlertItem[];
  civicHighlights?: LandingCivicHighlightItem[];
  foodAndShops?: LandingFoodShopItem[];
  venuesAndStays?: LandingVenueStayItem[];
  featuredRealEstate?: LandingRealEstateItem[];
  popularDishes?: LandingDishPreviewItem[];
}

const EASE_OUT_EXPO: [number, number, number, number] = [0.16, 1, 0.3, 1];

const SECTION_VIEWPORT = { once: true, amount: 0.16 } as const;

const CONTAINER_VARIANTS = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: {
      staggerChildren: 0.07,
      delayChildren: 0.04,
    },
  },
};

const ITEM_VARIANTS = {
  hidden: { opacity: 0, y: 14 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.42,
      ease: EASE_OUT_EXPO,
    },
  },
};

const POPULAR_LOCALITIES = [
  'New Lamka',
  'Tuibong',
  'Rengkai',
  'Zenhang Lamka',
  'Central Lamka',
];

const PICK_N_DROP_MODES: {
  id: DeliveryServiceMode;
  label: string;
  shortDesc: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  {
    id: 'parcel',
    label: 'Parcel',
    shortDesc: 'Documents, shop orders, boxes & bulk sacks across town',
    icon: Package,
  },
  {
    id: 'passenger',
    label: 'Ride (Taxi)',
    shortDesc: 'Point-to-point passenger rides with transparent local fares',
    icon: Car,
  },
  {
    id: 'gas',
    label: 'LPG Gas',
    shortDesc: 'Safe domestic cylinder pickup, refill & return to doorstep',
    icon: Flame,
  },
];

function formatCategoryLabel(raw: string): string {
  return raw
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function formatShortDate(iso: string): string {
  try {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return 'Recent';
    return new Intl.DateTimeFormat('en-IN', {
      day: 'numeric',
      month: 'short',
    }).format(date);
  } catch {
    return 'Recent';
  }
}

function renderVehicleIcon(slug: string, className = 'h-4 w-4') {
  const s = slug.toLowerCase();
  if (s.includes('scooty') || s.includes('bike') || s.includes('cycle')) {
    return <Bike className={className} />;
  }
  if (s.includes('pickup') || s.includes('bolero') || s.includes('van')) {
    return <Truck className={className} />;
  }
  return <Car className={className} />;
}

interface ResilientThumbProps {
  src: string | null;
  alt: string;
  fallbackIcon: React.ReactNode;
  className?: string;
}

function ResilientThumb({
  src,
  alt,
  fallbackIcon,
  className = 'h-32 w-full',
}: ResilientThumbProps) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div
        className={`relative flex items-center justify-center overflow-hidden bg-slate-100 dark:bg-slate-800/80 text-slate-500 dark:text-slate-400 ${className}`}
      >
        <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200/80 dark:border-slate-700 bg-white dark:bg-slate-900 text-theme-primary shadow-xs">
          {fallbackIcon}
        </div>
      </div>
    );
  }

  return (
    <div
      className={`relative overflow-hidden bg-slate-100 dark:bg-slate-800 ${className}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        referrerPolicy="no-referrer"
        loading="lazy"
        onError={() => setFailed(true)}
        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
      />
    </div>
  );
}

export default function LandingClient({
  snapshot,
}: {
  snapshot: LandingSnapshot;
}) {
  const router = useRouter();
  const {
    identity,
    office,
    operations,
    localities: configLocalities,
    hubLocalities,
    hubVehicleRates,
  } = useAppConfig();
  const { activeHub, hubs } = useHub();
  const { user: authUser, role: authRole } = useAuth();
  const isPartnerRole =
    authRole === 'owner' ||
    authRole === 'staff' ||
    authRole === 'driver' ||
    authRole === 'hub_manager' ||
    authRole === 'admin' ||
    authRole === 'super_admin';
  const activeHubId = activeHub?.id || '';
  const activeHubName = activeHub?.name || 'Churachandpur';
  const activeHubSlug = activeHub?.slug || 'churachandpur';
  const activeHubState = activeHub?.state || 'Manipur';

  // Pass V9-A: Auth-aware partner hats, pending applications & Featured Modal state
  const [userHats, setUserHats] = useState<{
    hasOwnerHat: boolean;
    hasDriverHat: boolean;
  }>({ hasOwnerHat: false, hasDriverHat: false });
  const [pendingAppTracks, setPendingAppTracks] = useState<{
    business: boolean;
    driver: boolean;
    advertiser: boolean;
  }>({ business: false, driver: false, advertiser: false });
  const [featuredModalOpen, setFeaturedModalOpen] = useState(false);
  const [featuredModalSection, setFeaturedModalSection] =
    useState<FeaturedSlotSection>('featured_places');

  useEffect(() => {
    if (!authUser?.id || !isSupabaseConfigured()) {
      setUserHats({ hasOwnerHat: false, hasDriverHat: false });
      setPendingAppTracks({
        business: false,
        driver: false,
        advertiser: false,
      });
      return;
    }
    let active = true;
    const loadPartnerStatus = async () => {
      try {
        const [hatsRes, appsRes] = await Promise.all([
          supabase.rpc('get_user_operational_hats', {
            p_user_id: authUser.id,
          }),
          supabase
            .from('partner_applications')
            .select('application_type, status')
            .eq('applicant_id', authUser.id)
            .in('status', ['submitted', 'under_review', 'changes_requested']),
        ]);
        if (!active) return;

        const hatsObj =
          hatsRes.data && typeof hatsRes.data === 'object'
            ? (hatsRes.data as Record<string, unknown>)
            : {};
        const ownedCount = Number(hatsObj.owned_listings_count ?? 0);
        const hasDriver =
          hatsObj.is_driver === true ||
          String(authRole || '').toLowerCase() === 'driver';
        const hasOwner =
          ownedCount > 0 ||
          ['owner', 'hub_manager', 'admin', 'super_admin'].includes(
            String(authRole || '').toLowerCase()
          );
        setUserHats({ hasOwnerHat: hasOwner, hasDriverHat: hasDriver });

        const apps = Array.isArray(appsRes.data)
          ? (appsRes.data as Array<{ application_type?: string }>)
          : [];
        setPendingAppTracks({
          business: apps.some((a) => a.application_type === 'business_owner'),
          driver: apps.some((a) => a.application_type === 'driver'),
          advertiser: apps.some((a) => a.application_type === 'advertiser'),
        });
      } catch {
        // Non-blocking fallback
      }
    };
    void loadPartnerStatus();
    return () => {
      active = false;
    };
  }, [authUser?.id, authRole]);

  const [liveSnapshot, setLiveSnapshot] = useState<LandingSnapshot>(snapshot);
  const [heroQuery, setHeroQuery] = useState('');
  const [activePndMode, setActivePndMode] =
    useState<DeliveryServiceMode>('parcel');

  const hubNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const h of hubs) {
      map.set(h.id, h.name);
    }
    return map;
  }, [hubs]);

  const formatInterHubRouteBadge = useCallback(
    (originHubId?: string | null, destinationHubIds?: string[]) => {
      if (!Array.isArray(destinationHubIds) || destinationHubIds.length === 0) {
        return null;
      }
      const originName =
        (originHubId && hubNameById.get(originHubId)) || activeHubName;
      const destNames = destinationHubIds
        .map((id) => hubNameById.get(id))
        .filter((n): n is string => Boolean(n && n !== originName));
      if (destNames.length === 0) return null;
      return `${originName} ↔ ${destNames.join(' / ')}`;
    },
    [hubNameById, activeHubName]
  );

  // Convert hubVehicleRates to VehicleTypeItem[] and ensure Churachandpur includes all 5 fleet tiers (including cycle_rickshaw)
  const hubScopedVehicleTypes = useMemo<VehicleTypeItem[]>(() => {
    const enabledRates = hubVehicleRates.filter(
      (r) => r.is_enabled_in_hub !== false
    );
    let resolved: VehicleTypeItem[];
    if (enabledRates.length > 0) {
      resolved = enabledRates.map((r) => {
        const validModes: DeliveryServiceMode[] = ['parcel', 'passenger', 'gas'];
        const rawModes = Array.isArray(r.supported_modes)
          ? r.supported_modes.filter((m: string): m is DeliveryServiceMode =>
              validModes.includes(m as DeliveryServiceMode)
            )
          : [];
        return {
          id: r.vehicle_type_id || r.id,
          slug: r.slug,
          name: r.name,
          icon: r.icon,
          base_fare_inr: Number(r.base_fare_inr) || 40,
          per_km_rate_inr: Number(r.per_km_rate_inr) || 12,
          wait_per_10min_inr: Number(r.wait_per_10min_inr) || 15,
          free_wait_minutes: Number(r.free_wait_minutes) || 10,
          two_way_multiplier: Number(r.two_way_multiplier) || 1.7,
          max_weight_kg: Number(r.max_weight_kg) || 25,
          max_dimensions: r.max_dimensions,
          supported_modes: rawModes.length > 0 ? rawModes : ['parcel'],
          is_active: true,
        };
      });
    } else {
      resolved = liveSnapshot.vehicleTypes;
    }

    if (activeHubSlug === 'churachandpur' && resolved.length < FALLBACK_VEHICLE_TYPES.length) {
      const existingSlugs = new Set(resolved.map((v) => v.slug || v.id));
      const missing = FALLBACK_VEHICLE_TYPES.filter(
        (fb) => !existingSlugs.has(fb.slug) && !existingSlugs.has(fb.id)
      );
      resolved = [...resolved, ...missing].sort((a, b) => a.base_fare_inr - b.base_fare_inr);
    }
    return resolved;
  }, [hubVehicleRates, liveSnapshot.vehicleTypes, activeHubSlug]);

  // Client re-sync effect whenever activeHub.id changes from SSR hub
  useEffect(() => {
    if (!activeHubId || !isSupabaseConfigured()) return;
    if (snapshot.ssrHubId && activeHubId === snapshot.ssrHubId) {
      queueMicrotask(() => {
        setLiveSnapshot(snapshot);
      });
      return;
    }

    let cancelled = false;
    async function resyncForHub() {
      try {
        const hideSamples = Boolean(operations?.hide_sample_data);

        let listingsCountQ = supabase
          .from('listings')
          .select('id', { count: 'exact', head: true })
          .eq('status', 'published')
          .eq('hub_id', activeHubId);
        let marketCountQ = supabase
          .from('marketplace_products')
          .select('id', { count: 'exact', head: true })
          .eq('is_active', true)
          .eq('hub_id', activeHubId);
        let bulletinsCountQ = supabase
          .from('bulletins')
          .select('id', { count: 'exact', head: true })
          .in('status', ['published', 'active'])
          .or(`is_global.eq.true,target_hub_ids.cs.{${activeHubId}}`);
        let vehiclesCountQ = supabase
          .from('vehicle_listings')
          .select('id', { count: 'exact', head: true })
          .eq('is_active', true)
          .or(
            `origin_hub_id.eq.${activeHubId},destination_hub_ids.cs.{${activeHubId}}`
          );

        let featuredListingsQ = supabase
          .from('listings')
          .select(
            'id, title, category, subcategory, locality, address, rating, review_count, thumbnail_url, cover_image'
          )
          .eq('status', 'published')
          .eq('hub_id', activeHubId)
          .order('rating', { ascending: false, nullsFirst: false })
          .order('created_at', { ascending: false })
          .limit(4);

        let latestProductsQ = supabase
          .from('marketplace_products')
          .select(
            'id, title, price, unit, category, in_stock, thumbnail_url, listings(id, title, locality)'
          )
          .eq('is_active', true)
          .eq('hub_id', activeHubId)
          .order('created_at', { ascending: false })
          .limit(4);

        let latestBulletinsQ = supabase
          .from('bulletins')
          .select(
            'id, title, excerpt, category, is_pinned, youtube_video_id, created_at, profiles:author_id(full_name, name)'
          )
          .in('status', ['published', 'active'])
          .or(`is_global.eq.true,target_hub_ids.cs.{${activeHubId}}`)
          .order('is_pinned', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(3);

        let featuredVehiclesQ = supabase
          .from('vehicle_listings')
          .select(
            'id, origin_hub_id, destination_hub_ids, title, stand_locality, booking_mode, total_seats, rate_hourly_inr, rate_daily_inr, rate_per_km_inr, fixed_routes, advance_percent, with_driver, thumbnail_url, is_verified'
          )
          .eq('is_active', true)
          .or(
            `origin_hub_id.eq.${activeHubId},destination_hub_ids.cs.{${activeHubId}}`
          )
          .order('is_verified', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(4);

        if (hideSamples) {
          listingsCountQ = listingsCountQ.not('title', 'ilike', '[SAMPLE]%');
          marketCountQ = marketCountQ.not('title', 'ilike', '[SAMPLE]%');
          bulletinsCountQ = bulletinsCountQ.not('title', 'ilike', '[SAMPLE]%');
          vehiclesCountQ = vehiclesCountQ.not('title', 'ilike', '[SAMPLE]%');
          featuredListingsQ = featuredListingsQ.not('title', 'ilike', '[SAMPLE]%');
          latestProductsQ = latestProductsQ.not('title', 'ilike', '[SAMPLE]%');
          latestBulletinsQ = latestBulletinsQ.not('title', 'ilike', '[SAMPLE]%');
          featuredVehiclesQ = featuredVehiclesQ.not('title', 'ilike', '[SAMPLE]%');
        }

        const [
          lCount,
          mCount,
          bCount,
          vCount,
          fListings,
          lProducts,
          lBulletins,
          fVehicles,
        ] = await Promise.all([
          listingsCountQ,
          marketCountQ,
          bulletinsCountQ,
          vehiclesCountQ,
          featuredListingsQ,
          latestProductsQ,
          latestBulletinsQ,
          featuredVehiclesQ,
        ]);

        if (cancelled) return;

        const mappedListings: LandingListingPreview[] = Array.isArray(
          fListings.data
        )
          ? (fListings.data as Array<Record<string, unknown>>).map((row) => ({
              id: String(row.id || ''),
              title: String(row.title || 'Local Place'),
              category: String(row.category || 'business'),
              subcategory: String(row.subcategory || 'General'),
              locality: String(row.locality || activeHubName),
              address: String(row.address || activeHubName),
              rating:
                typeof row.rating === 'number' && Number.isFinite(row.rating)
                  ? row.rating
                  : 4.5,
              reviewCount:
                typeof row.review_count === 'number' ? row.review_count : 0,
              imageUrl:
                resolveRemoteMediaUrl(
                  typeof row.thumbnail_url === 'string'
                    ? row.thumbnail_url
                    : typeof row.cover_image === 'string'
                      ? row.cover_image
                      : ''
                ) || null,
            }))
          : [];

        const mappedProducts: LandingMarketPreview[] = Array.isArray(
          lProducts.data
        )
          ? (lProducts.data as Array<Record<string, unknown>>).map((row) => {
              const shopRaw = Array.isArray(row.listings)
                ? (row.listings[0] as Record<string, unknown> | undefined)
                : (row.listings as Record<string, unknown> | undefined);
              return {
                id: String(row.id || ''),
                title: String(row.title || 'Local Product'),
                price: Number(row.price) || 0,
                unit: String(row.unit || 'piece'),
                category: String(row.category || 'General'),
                inStock: row.in_stock !== false,
                thumbnailUrl:
                  resolveRemoteMediaUrl(
                    typeof row.thumbnail_url === 'string'
                      ? row.thumbnail_url
                      : ''
                  ) || null,
                shopName: String(shopRaw?.title || 'Local Shop'),
                shopLocality: String(shopRaw?.locality || activeHubName),
              };
            })
          : [];

        const mappedBulletins: LandingBulletinPreview[] = Array.isArray(
          lBulletins.data
        )
          ? (lBulletins.data as Array<Record<string, unknown>>).map((row) => {
              const authorRaw = Array.isArray(row.profiles)
                ? (row.profiles[0] as Record<string, unknown> | undefined)
                : (row.profiles as Record<string, unknown> | undefined);
              return {
                id: String(row.id || ''),
                title: String(row.title || 'Community Notice'),
                excerpt: String(row.excerpt || ''),
                category: String(row.category || 'announcement'),
                isPinned: Boolean(row.is_pinned),
                hasVideo: Boolean(row.youtube_video_id),
                authorName: String(
                  authorRaw?.full_name ||
                    authorRaw?.name ||
                    'Verified Publisher'
                ),
                createdAt: String(row.created_at || new Date().toISOString()),
              };
            })
          : [];

        const mappedVehicles: LandingVehiclePreview[] = Array.isArray(
          fVehicles.data
        )
          ? (fVehicles.data as Array<Record<string, unknown>>).map((row) => {
              const routes = Array.isArray(row.fixed_routes)
                ? (row.fixed_routes as Array<{
                    fare_inr?: number;
                    full_vehicle_fare_inr?: number;
                  }>)
                : [];
              const firstSeatFare = routes
                .map((r) => Number(r?.fare_inr))
                .find((n) => Number.isFinite(n) && n > 0);
              const hourly = Number(row.rate_hourly_inr);
              const daily = Number(row.rate_daily_inr);
              const perKm = Number(row.rate_per_km_inr);
              const firstFullFare = routes
                .map((r) => Number(r?.full_vehicle_fare_inr))
                .find((n) => Number.isFinite(n) && n > 0);

              let price = 0;
              let unit = '';
              if (firstSeatFare && row.booking_mode !== 'full_vehicle') {
                price = Math.round(firstSeatFare);
                unit = '/seat';
              } else if (Number.isFinite(hourly) && hourly > 0) {
                price = Math.round(hourly);
                unit = '/hr';
              } else if (Number.isFinite(daily) && daily > 0) {
                price = Math.round(daily);
                unit = '/day';
              } else if (Number.isFinite(perKm) && perKm > 0) {
                price = Math.round(perKm);
                unit = '/km';
              } else if (firstFullFare) {
                price = Math.round(firstFullFare);
                unit = '/trip';
              }

              return {
                id: String(row.id || ''),
                originHubId:
                  typeof row.origin_hub_id === 'string'
                    ? row.origin_hub_id
                    : null,
                destinationHubIds: Array.isArray(row.destination_hub_ids)
                  ? (row.destination_hub_ids as unknown[]).filter(
                      (id): id is string => typeof id === 'string'
                    )
                  : [],
                title: String(row.title || 'Local Charter Vehicle').replace(
                  /^\[SAMPLE\]\s*/i,
                  ''
                ),
                standLocality: String(row.stand_locality || activeHubName),
                bookingMode:
                  row.booking_mode === 'per_seat'
                    ? 'per_seat'
                    : row.booking_mode === 'both'
                      ? 'both'
                      : 'full_vehicle',
                totalSeats: Number(row.total_seats) || 4,
                startingPriceInr: price,
                startingPriceUnit: unit,
                advancePercent: Number(row.advance_percent) || 20,
                withDriver: row.with_driver !== false,
                isVerified: Boolean(row.is_verified),
                thumbnailUrl:
                  resolveRemoteMediaUrl(
                    typeof row.thumbnail_url === 'string'
                      ? row.thumbnail_url
                      : ''
                  ) || null,
              };
            })
          : [];

        // Phase 71-D: Re-sync hub-scoped Official PrintSwift + Print Pro spotlight
        let officialPrintSwift: PrintSpotlightItem | null = null;
        const printProShops: PrintSpotlightItem[] = [];
        try {
          const { data: rawPrintRows, error: printErr } = await supabase
            .from('listing_print_profiles')
            .select(
              'listing_id, hub_id, is_first_party_printswift, is_accepting_orders, busy_until, turnaround_badge, capabilities, verified_capabilities, rate_card, payment_policy, listings!inner(id, title, locality, address, hub_id, status, thumbnail_url, cover_image)'
            )
            .limit(20);

          if (
            !cancelled &&
            !printErr &&
            Array.isArray(rawPrintRows) &&
            rawPrintRows.length > 0
          ) {
            const nowMs = Date.now();
            const candidates: Array<{
              rawId: string;
              item: PrintSpotlightItem;
            }> = [];

            for (const row of rawPrintRows as Array<Record<string, unknown>>) {
              const joined = Array.isArray(row.listings)
                ? (row.listings[0] as Record<string, unknown> | undefined)
                : (row.listings as Record<string, unknown> | undefined);
              if (!joined) continue;
              const status = String(joined.status || '').toLowerCase();
              if (status !== 'published' && status !== 'active') continue;
              const listingHubId = joined.hub_id ? String(joined.hub_id) : null;
              if (listingHubId && listingHubId !== activeHubId) continue;
              const title = String(joined.title || 'Print Counter');
              if (
                hideSamples &&
                title.trim().toUpperCase().startsWith('[SAMPLE]')
              ) {
                continue;
              }
              const normalized = normalizeClientPrintProfile(row);
              if (!normalized) continue;
              candidates.push({
                rawId: normalized.listing_id,
                item: {
                  listingId: normalized.listing_id,
                  title: title.replace(/^\[SAMPLE\]\s*/i, ''),
                  locality: String(joined.locality || activeHubName),
                  address: joined.address ? String(joined.address) : null,
                  coverImage:
                    resolveRemoteMediaUrl(
                      String(joined.thumbnail_url || joined.cover_image || '')
                    ) || null,
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
              candidates.map(async ({ rawId, item }) => {
                if (item.isFirstParty) return { item, entitled: true };
                const rpcRes = await supabase.rpc(
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
              } else if (
                entitled &&
                item.isAcceptingOrders &&
                !item.isBusyPaused
              ) {
                if (printProShops.length < 4) {
                  printProShops.push(item);
                }
              }
            }
          }
        } catch {
          // Non-blocking if print tables are absent
        }

        if (cancelled) return;

        setLiveSnapshot((prev) => ({
          ...prev,
          ssrHubId: activeHubId,
          counts: {
            listings:
              typeof lCount.count === 'number'
                ? lCount.count
                : mappedListings.length,
            marketplaceProducts:
              typeof mCount.count === 'number'
                ? mCount.count
                : mappedProducts.length,
            bulletins:
              typeof bCount.count === 'number'
                ? bCount.count
                : mappedBulletins.length,
            vehicleTypes: hubScopedVehicleTypes.length,
            vehicleListings:
              typeof vCount.count === 'number'
                ? vCount.count
                : mappedVehicles.length,
          },
          featuredListings: mappedListings,
          latestProducts: mappedProducts,
          latestBulletins: mappedBulletins,
          featuredVehicles: mappedVehicles,
          printSpotlight: {
            officialPrintSwift,
            printProShops,
          },
        }));
      } catch {
        // Keep current snapshot on transient network error
      }
    }

    void resyncForHub();
    return () => {
      cancelled = true;
    };
  }, [
    activeHubId,
    activeHubName,
    snapshot,
    operations?.hide_sample_data,
    hubScopedVehicleTypes.length,
  ]);

  const footerLocalities = useMemo(() => {
    const verifiedHubLocs = hubLocalities
      .filter((loc) => loc.status === 'verified' && loc.display_name.trim())
      .slice(0, 6)
      .map((loc) => ({
        name: loc.display_name.trim(),
        slug: (loc.slug || loc.display_name).trim(),
      }));
    if (verifiedHubLocs.length > 0) return verifiedHubLocs;

    const active = configLocalities
      .filter((loc) => loc.is_active && loc.display_name.trim())
      .slice(0, 6)
      .map((loc) => ({
        name: loc.display_name.trim(),
        slug: (loc.slug || loc.display_name).trim(),
      }));
    if (active.length > 0) return active;
    return POPULAR_LOCALITIES.map((name) => ({
      name,
      slug: name.toLowerCase().replace(/[^a-z0-9]+/g, '-'),
    }));
  }, [hubLocalities, configLocalities]);

  const filteredVehicles = useMemo(() => {
    const matches = hubScopedVehicleTypes.filter((vehicle) =>
      Array.isArray(vehicle.supported_modes)
        ? vehicle.supported_modes.includes(activePndMode)
        : true
    );
    return matches.length > 0 ? matches : hubScopedVehicleTypes;
  }, [hubScopedVehicleTypes, activePndMode]);

  const activeModeMeta =
    PICK_N_DROP_MODES.find((m) => m.id === activePndMode) ??
    PICK_N_DROP_MODES[0];

  const liveStats = [
    {
      label: 'Verified Places',
      value: liveSnapshot.counts.listings,
      suffix: '+',
      icon: MapPin,
      href: `/explore?hub=${encodeURIComponent(activeHubSlug)}`,
    },
    {
      label: 'Market Items',
      value: liveSnapshot.counts.marketplaceProducts,
      suffix: '',
      icon: ShoppingBag,
      href: `/marketplace?hub=${encodeURIComponent(activeHubSlug)}`,
    },
    {
      label: 'Active Bulletins',
      value: liveSnapshot.counts.bulletins,
      suffix: '',
      icon: Megaphone,
      href: `/bulletin?hub=${encodeURIComponent(activeHubSlug)}`,
    },
    {
      label: 'Fleet Types',
      value: hubScopedVehicleTypes.length,
      suffix: '',
      icon: Truck,
      href: `/explore?hub=${encodeURIComponent(activeHubSlug)}&mode=pick_n_drop`,
    },
  ];

  return (
    <div className="w-full overflow-x-clip bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100">
      {/* ================================================================= */}
      {/* 1. HERO SECTION (ABOVE THE FOLD)                                   */}
      {/* ================================================================= */}
      <section className="relative z-30 overflow-visible border-b border-slate-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-950">
        {/* Subtle low-opacity ambient radial mesh glow — never a solid color wall */}
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 overflow-hidden"
        >
          <motion.div
            animate={{
              x: [0, 18, -10, 0],
              y: [0, -14, 10, 0],
              opacity: [0.7, 1, 0.7],
            }}
            transition={{
              duration: 14,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
            className="absolute -top-24 left-1/4 h-72 w-72 sm:h-96 sm:w-96 rounded-full bg-theme-primary/[0.06] dark:bg-theme-primary/[0.12] blur-3xl"
          />
          <motion.div
            animate={{
              x: [0, -20, 12, 0],
              y: [0, 16, -12, 0],
              opacity: [0.6, 0.95, 0.6],
            }}
            transition={{
              duration: 18,
              repeat: Infinity,
              ease: 'easeInOut',
            }}
            className="absolute -bottom-28 right-1/5 h-72 w-72 sm:h-96 sm:w-96 rounded-full bg-theme-accent/[0.06] dark:bg-theme-accent/[0.10] blur-3xl"
          />
        </div>

        <div className="relative mx-auto max-w-6xl px-4 pt-6 pb-8 sm:px-6 sm:pt-10 sm:pb-12 lg:px-8">
          <motion.div
            initial="hidden"
            animate="visible"
            variants={CONTAINER_VARIANTS}
            className="mx-auto max-w-3xl text-center"
          >
            {/* Live District Status Pill */}
            <motion.div
              variants={ITEM_VARIANTS}
              className="mb-4 flex justify-center"
            >
              <div
                data-testid="landing-hub-pulse-badge"
                className="inline-flex items-center gap-2 rounded-full border border-slate-200/80 dark:border-slate-800 bg-slate-100/90 dark:bg-slate-900 px-3 py-1 text-[11px] font-semibold text-slate-800 dark:text-slate-200 shadow-xs"
              >
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
                </span>
                <span>{activeHubName} Hub • Live</span>
              </div>
            </motion.div>

            {/* Editorial Display Headline */}
            <motion.h1
              variants={ITEM_VARIANTS}
              data-testid="landing-hero-headline"
              className="text-balance text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white sm:text-5xl sm:leading-[1.08]"
            >
              Discover, trade, and move across{' '}
              <span className="text-theme-primary">{activeHubName}</span>.
            </motion.h1>

            <motion.p
              variants={ITEM_VARIANTS}
              className="mx-auto mt-3 max-w-2xl text-pretty text-xs leading-relaxed text-slate-600 dark:text-slate-400 sm:text-sm"
            >
              {identity.tagline &&
              identity.tagline !==
                'Discover, trade, and move across Churachandpur.'
                ? identity.tagline
                : `One fast local platform uniting interactive neighborhood maps, verified shop catalogues, scheduled vehicles, community notices, and escrow-backed Pick N Drop delivery in ${activeHubName}.`}
            </motion.p>

            {/* Universal Live Zero-Submit Command Search */}
            <motion.div
              variants={ITEM_VARIANTS}
              className="relative z-30 mx-auto mt-5 max-w-2xl"
            >
              <UniversalAppSearch
                query={heroQuery}
                onQueryChange={setHeroQuery}
                placeholder={`Search features, places, items, helplines or settings in ${activeHubName}...`}
                activeHubId={activeHubId}
                activeHubName={activeHubName}
                activeHubSlug={activeHubSlug}
                localities={
                  hubLocalities && hubLocalities.length > 0
                    ? hubLocalities.map((l) => l.display_name)
                    : POPULAR_LOCALITIES
                }
                places={liveSnapshot.featuredListings}
                foodAndShops={liveSnapshot.foodAndShops || []}
                venuesAndStays={liveSnapshot.venuesAndStays || []}
                realEstate={liveSnapshot.featuredRealEstate || []}
                civicHighlights={liveSnapshot.civicHighlights || []}
                products={liveSnapshot.latestProducts}
                dishes={liveSnapshot.popularDishes || []}
                vehicles={liveSnapshot.featuredVehicles || []}
                bulletins={liveSnapshot.latestBulletins || []}
                moduleSwitches={activeHub?.module_switches}
                onOpenAuthModal={() => {
                  if (typeof window !== 'undefined') {
                    window.dispatchEvent(
                      new CustomEvent('printswift:open-auth-modal')
                    );
                  }
                }}
              />
            </motion.div>

            {/* Quick-Action Pills */}
            <motion.div
              variants={ITEM_VARIANTS}
              className="mt-3.5 flex flex-wrap items-center justify-center gap-2"
            >
              <Link
                href="/explore"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200/80 dark:border-slate-800 bg-slate-100/90 dark:bg-slate-900 px-3 text-xs font-semibold text-slate-800 dark:text-slate-200 transition-colors hover:border-theme-primary hover:text-theme-primary"
              >
                <Compass className="h-3.5 w-3.5 text-theme-primary" />
                <span>Explore Map</span>
              </Link>
              <Link
                href="/explore?mode=pick_n_drop"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200/80 dark:border-slate-800 bg-slate-100/90 dark:bg-slate-900 px-3 text-xs font-semibold text-slate-800 dark:text-slate-200 transition-colors hover:border-theme-primary hover:text-theme-primary"
              >
                <Truck className="h-3.5 w-3.5 text-theme-primary" />
                <span>Pick N Drop</span>
              </Link>
              <Link
                href="/marketplace"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200/80 dark:border-slate-800 bg-slate-100/90 dark:bg-slate-900 px-3 text-xs font-semibold text-slate-800 dark:text-slate-200 transition-colors hover:border-theme-primary hover:text-theme-primary"
              >
                <ShoppingBag className="h-3.5 w-3.5 text-theme-primary" />
                <span>Marketplace</span>
              </Link>
              <Link
                href={`/explore?hub=${encodeURIComponent(activeHubSlug)}&vertical=print_digital`}
                data-testid="landing-hero-print-digital-pill"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-theme-primary/35 bg-theme-primary/10 px-3 text-xs font-semibold text-theme-primary transition-colors hover:bg-theme-primary hover:text-[hsl(var(--color-primary-foreground))]"
              >
                <Printer className="h-3.5 w-3.5" />
                <span>Print &amp; Digital</span>
              </Link>
              <Link
                href="/vehicles"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200/80 dark:border-slate-800 bg-slate-100/90 dark:bg-slate-900 px-3 text-xs font-semibold text-slate-800 dark:text-slate-200 transition-colors hover:border-theme-primary hover:text-theme-primary"
              >
                <Car className="h-3.5 w-3.5 text-theme-primary" />
                <span>Vehicles</span>
              </Link>
              <Link
                href="/bulletin"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200/80 dark:border-slate-800 bg-slate-100/90 dark:bg-slate-900 px-3 text-xs font-semibold text-slate-800 dark:text-slate-200 transition-colors hover:border-theme-primary hover:text-theme-primary"
              >
                <Megaphone className="h-3.5 w-3.5 text-theme-primary" />
                <span>Bulletin</span>
              </Link>
            </motion.div>
          </motion.div>

          {/* Animated Live Stats Bar */}
          <motion.div
            initial="hidden"
            animate="visible"
            variants={CONTAINER_VARIANTS}
            className="mt-7 grid grid-cols-2 gap-2.5 sm:mt-9 lg:grid-cols-4"
          >
            {liveStats.map((stat) => {
              const Icon = stat.icon;
              return (
                <motion.div key={stat.label} variants={ITEM_VARIANTS}>
                  <Link
                    href={stat.href}
                    className="group flex items-center justify-between rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900/80 px-3.5 py-2.5 shadow-sm transition-all hover:border-theme-primary/40"
                  >
                    <div className="min-w-0">
                      <p className="text-[11px] font-medium text-slate-500 dark:text-slate-400">
                        {stat.label}
                      </p>
                      <p className="mt-0.5 text-lg font-extrabold tracking-tight tabular-nums text-slate-900 dark:text-white sm:text-xl">
                        {stat.value.toLocaleString('en-IN')}
                        {stat.suffix}
                      </p>
                    </div>
                    <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-theme-primary/10 text-theme-primary transition-transform duration-200 group-hover:scale-105">
                      <Icon className="h-4 w-4" />
                    </div>
                  </Link>
                </motion.div>
              );
            })}
          </motion.div>
        </div>
      </section>

      <PromoBannerSlot
        placement="landing_top"
        className="mx-auto max-w-6xl px-4 pt-6 sm:px-6 lg:px-8"
      />

      {/* Pass V11-A: Expanded 16-Tile Service Launcher + Pre-Filled Shortcuts + Emergency Helplines Strip */}
      <HubServiceLauncherAndCivicStrip
        activeHubName={activeHubName}
        moduleSwitches={activeHub?.module_switches}
        civicAlerts={liveSnapshot.civicAlerts || []}
        isAuthenticated={Boolean(authUser?.id)}
        onOpenAuthModal={() => {
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('printswift:open-auth-modal'));
          }
        }}
      />

      {/* Pass R4: Cohesive Hub Vertical Spotlights (Food/Shops, Venues/Stays, Real Estate, Partner CTA) */}
      <HubVerticalSpotlights
        activeHubName={activeHubName}
        moduleSwitches={activeHub?.module_switches}
        foodAndShops={liveSnapshot.foodAndShops || []}
        venuesAndStays={liveSnapshot.venuesAndStays || []}
        realEstate={liveSnapshot.featuredRealEstate || []}
        isPartnerUser={isPartnerRole}
      />

      {/* ================================================================= */}
      {/* 2. 4-PILLAR ASYMMETRIC BENTO FEATURE GRID                          */}
      {/* ================================================================= */}
      <section className="mx-auto max-w-6xl px-4 py-9 sm:px-6 sm:py-12 lg:px-8">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={SECTION_VIEWPORT}
          variants={CONTAINER_VARIANTS}
        >
          <motion.div
            variants={ITEM_VARIANTS}
            className="mb-5 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between"
          >
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-theme-primary">
                Core Platform
              </p>
              <h2 className="mt-0.5 text-xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-2xl">
                Four pillars built for everyday district life
              </h2>
            </div>
            <p className="text-xs text-slate-600 dark:text-slate-400">
              Real-time directory, commerce, announcements &amp; logistics
            </p>
          </motion.div>

          <div className="grid grid-cols-1 gap-3.5 lg:grid-cols-12">
            {/* Pillar 1: Interactive Discovery Map (7 cols) */}
            <motion.div
              variants={ITEM_VARIANTS}
              whileHover={{ y: -3 }}
              transition={{ type: 'spring', stiffness: 360, damping: 28 }}
              className="lg:col-span-7"
            >
              <Link
                href="/explore"
                className="group relative flex h-full flex-col justify-between overflow-hidden rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm transition-colors hover:border-theme-primary/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-theme-primary/10 text-theme-primary">
                      <Navigation className="h-4 w-4" />
                    </div>
                    <h3 className="mt-3 text-base font-semibold text-slate-900 dark:text-white sm:text-lg">
                      Interactive Discovery Map
                    </h3>
                    <p className="mt-1 max-w-md text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                      Explore clustered local shops, clinics, sports turfs, and
                      land plots with GPS routing, 360° panoramas, and drawn
                      real-estate polygons.
                    </p>
                  </div>
                  <span className="hidden sm:inline-flex shrink-0 items-center gap-1 rounded-md border border-slate-200/80 dark:border-slate-700/80 bg-slate-100 dark:bg-slate-800 px-2 py-1 text-[10px] font-semibold tabular-nums text-slate-700 dark:text-slate-300">
                    <MapPin className="h-3 w-3 text-theme-primary" />
                    {liveSnapshot.counts.listings} places
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
                  {[
                    'Live Clusters',
                    '360° Views',
                    'Land Polygons',
                    'GPS Routing',
                  ].map((item) => (
                    <div
                      key={item}
                      className="rounded-lg bg-slate-100 dark:bg-slate-800 px-2.5 py-1.5 text-[11px] font-medium text-slate-700 dark:text-slate-300"
                    >
                      {item}
                    </div>
                  ))}
                </div>

                <div className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-theme-primary group-hover:underline">
                  <span>Open Interactive Map</span>
                  <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                </div>
              </Link>
            </motion.div>

            {/* Pillar 2: Local Marketplace (5 cols) */}
            <motion.div
              variants={ITEM_VARIANTS}
              whileHover={{ y: -3 }}
              transition={{ type: 'spring', stiffness: 360, damping: 28 }}
              className="lg:col-span-5"
            >
              <Link
                href="/marketplace"
                className="group relative flex h-full flex-col justify-between overflow-hidden rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm transition-colors hover:border-theme-primary/40"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-theme-primary/10 text-theme-primary">
                      <ShoppingBag className="h-4 w-4" />
                    </div>
                    <span className="rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-slate-700 dark:text-slate-300">
                      {liveSnapshot.counts.marketplaceProducts} items
                    </span>
                  </div>
                  <h3 className="mt-3 text-base font-semibold text-slate-900 dark:text-white sm:text-lg">
                    Local Marketplace
                  </h3>
                  <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                    Browse direct shop catalogues with real-time stock status,
                    transparent unit pricing, and one-tap WhatsApp enquiry.
                  </p>
                </div>

                <div className="mt-4 flex flex-wrap gap-1.5 text-[11px] font-medium">
                  {['Shop Catalogues', 'Live Stock', 'WhatsApp Direct'].map(
                    (tag) => (
                      <span
                        key={tag}
                        className="rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-1 text-slate-700 dark:text-slate-300"
                      >
                        {tag}
                      </span>
                    )
                  )}
                </div>

                <div className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-theme-primary group-hover:underline">
                  <span>Browse Marketplace</span>
                  <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                </div>
              </Link>
            </motion.div>

            {/* Pillar 3: Community Bulletin (5 cols) */}
            <motion.div
              variants={ITEM_VARIANTS}
              whileHover={{ y: -3 }}
              transition={{ type: 'spring', stiffness: 360, damping: 28 }}
              className="lg:col-span-5"
            >
              <Link
                href="/bulletin"
                className="group relative flex h-full flex-col justify-between overflow-hidden rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm transition-colors hover:border-theme-primary/40"
              >
                <div>
                  <div className="flex items-center justify-between">
                    <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-theme-primary/10 text-theme-primary">
                      <Megaphone className="h-4 w-4" />
                    </div>
                    <span className="rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-slate-700 dark:text-slate-300">
                      {liveSnapshot.counts.bulletins} active
                    </span>
                  </div>
                  <h3 className="mt-3 text-base font-semibold text-slate-900 dark:text-white sm:text-lg">
                    Community Bulletin
                  </h3>
                  <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                    Accountable local announcements, verified job boards, event
                    flyers, and embedded YouTube video notices from subscribers.
                  </p>
                </div>

                <div className="mt-4 flex flex-wrap gap-1.5 text-[11px] font-medium">
                  {['Job Boards', 'Video Notices', 'Verified Authors'].map(
                    (tag) => (
                      <span
                        key={tag}
                        className="rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-1 text-slate-700 dark:text-slate-300"
                      >
                        {tag}
                      </span>
                    )
                  )}
                </div>

                <div className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-theme-primary group-hover:underline">
                  <span>Read District Bulletin</span>
                  <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                </div>
              </Link>
            </motion.div>

            {/* Pillar 4: Pick N Drop Logistics (7 cols) */}
            <motion.div
              variants={ITEM_VARIANTS}
              whileHover={{ y: -3 }}
              transition={{ type: 'spring', stiffness: 360, damping: 28 }}
              className="lg:col-span-7"
            >
              <Link
                href="/explore?mode=pick_n_drop"
                className="group relative flex h-full flex-col justify-between overflow-hidden rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm transition-colors hover:border-theme-primary/40"
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-theme-primary text-[hsl(var(--color-primary-foreground))]">
                      <Truck className="h-4 w-4" />
                    </div>
                    <h3 className="mt-3 text-base font-semibold text-slate-900 dark:text-white sm:text-lg">
                      Pick N Drop Logistics
                    </h3>
                    <p className="mt-1 max-w-md text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                      Pin Point A &amp; Point B right on the Explore map for
                      one-way or round-trip Parcel delivery, Taxi rides, or LPG
                      Gas cylinder refills with OTP-verified handovers.
                    </p>
                  </div>
                  <span className="hidden sm:inline-flex shrink-0 items-center gap-1 rounded-md bg-theme-primary/10 px-2 py-1 text-[10px] font-semibold text-theme-primary">
                    Escrow Protected
                  </span>
                </div>

                <div className="mt-4 grid grid-cols-3 gap-2">
                  <div className="flex items-center gap-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                    <Package className="h-3.5 w-3.5 text-theme-primary shrink-0" />
                    <span>Parcel</span>
                  </div>
                  <div className="flex items-center gap-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                    <Car className="h-3.5 w-3.5 text-theme-primary shrink-0" />
                    <span>Taxi Ride</span>
                  </div>
                  <div className="flex items-center gap-1.5 rounded-lg bg-slate-100 dark:bg-slate-800 px-2.5 py-1.5 text-[11px] font-semibold text-slate-700 dark:text-slate-300">
                    <Flame className="h-3.5 w-3.5 text-theme-primary shrink-0" />
                    <span>LPG Gas</span>
                  </div>
                </div>

                <div className="mt-4 inline-flex items-center gap-1.5 text-xs font-medium text-theme-primary group-hover:underline">
                  <span>Book Pick N Drop on Map</span>
                  <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" />
                </div>
              </Link>
            </motion.div>
          </div>
        </motion.div>
      </section>

      {/* ================================================================= */}
      {/* 2B. PRINT & DIGITAL HUB SPOTLIGHT (Auto-hides cleanly when empty or paused in hub) */}
      {/* ================================================================= */}
      {isHubModuleEnabled(activeHub?.module_switches, 'print_orders') &&
        (liveSnapshot.printSpotlight?.officialPrintSwift ||
          (liveSnapshot.printSpotlight?.printProShops?.length ?? 0) > 0) && (
        <section
          data-testid="landing-print-digital-spotlight"
          className="mx-auto max-w-6xl px-4 pb-9 sm:px-6 sm:pb-12 lg:px-8"
        >
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={SECTION_VIEWPORT}
            variants={CONTAINER_VARIANTS}
            className="space-y-4"
          >
            <motion.div
              variants={ITEM_VARIANTS}
              className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between"
            >
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-theme-primary">
                  Private Vault • 48h Auto-Delete
                </p>
                <h2 className="mt-0.5 text-xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-2xl">
                  Print &amp; Digital Hub in {activeHubName}
                </h2>
                <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                  Upload PDFs or phone photos, get instant quotes, and collect
                  with an OTP or Pick N Drop delivery.
                </p>
              </div>
              <Link
                href={`/explore?hub=${encodeURIComponent(activeHubSlug)}&vertical=print_digital`}
                className="inline-flex h-8 shrink-0 items-center gap-1.5 self-start rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 text-xs font-semibold text-slate-800 dark:text-slate-200 transition-colors hover:border-theme-primary hover:text-theme-primary sm:self-auto"
              >
                <Printer className="h-3.5 w-3.5 text-theme-primary" />
                <span>All Print Shops</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </motion.div>

            {/* Official First-Party PrintSwift Spotlight Card */}
            {liveSnapshot.printSpotlight?.officialPrintSwift &&
              (() => {
                const official =
                  liveSnapshot.printSpotlight!.officialPrintSwift!;
                const isLive =
                  official.isAcceptingOrders && !official.isBusyPaused;
                const caps = getVerifiedCapabilityChipLabels(
                  {
                    capabilities: official.capabilities,
                    verified_capabilities: official.verifiedCapabilities,
                    is_first_party_printswift: true,
                  },
                  false
                );
                const rateSummary = formatStartingRateLabel(official.rateCard);
                const turnaround =
                  TURNAROUND_BADGE_LABELS[official.turnaroundBadge];

                return (
                  <motion.div
                    variants={ITEM_VARIANTS}
                    data-testid="landing-official-printswift-card"
                    className="overflow-hidden rounded-2xl border-2 border-theme-primary/45 bg-white dark:bg-slate-900 shadow-sm"
                  >
                    <div className="flex flex-col justify-between gap-4 p-4 sm:p-5 lg:flex-row lg:items-center">
                      <div className="space-y-2.5 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-theme-primary/25 bg-slate-50 dark:bg-slate-950">
                            <DDoodleLogo variant="mark" size={22} />
                          </div>
                          <span className="inline-flex items-center gap-1 rounded-md bg-theme-primary px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-[hsl(var(--color-primary-foreground))]">
                            <BadgeCheck className="h-3 w-3" />
                            <span>OFFICIAL DD OODLE PRINT</span>
                          </span>
                          {isLive ? (
                            <span
                              className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold ${turnaround.className}`}
                            >
                              <Clock className="h-3 w-3" />
                              <span>{turnaround.label}</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/35 bg-amber-500/12 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                              <Clock className="h-3 w-3" />
                              <span>Pre-Launch Preview</span>
                            </span>
                          )}
                          <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
                            <Lock className="h-2.5 w-2.5" />
                            <span>48h Auto-Delete</span>
                          </span>
                        </div>

                        <div>
                          <h3 className="text-base font-bold text-slate-900 dark:text-white">
                            {official.title}
                          </h3>
                          <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-400">
                            {official.locality}
                            {rateSummary ? ` • ${rateSummary}` : ''}
                          </p>
                        </div>

                        {caps.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {caps.slice(0, 6).map((c) => (
                              <span
                                key={c}
                                className="rounded-md border border-theme-primary/20 bg-theme-primary/8 px-2 py-0.5 text-[10px] font-semibold text-slate-800 dark:text-slate-200"
                              >
                                {c}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        {isLive ? (
                          <Link
                            href={`/listing/${encodeURIComponent(official.listingId)}/print`}
                            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-theme-primary px-4 text-xs font-bold text-[hsl(var(--color-primary-foreground))] shadow-xs transition-opacity hover:opacity-90"
                          >
                            <Printer className="h-3.5 w-3.5" />
                            <span>Start a Print Order</span>
                            <ArrowRight className="h-3.5 w-3.5" />
                          </Link>
                        ) : (
                          <>
                            <span className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 text-xs font-bold text-amber-800 dark:text-amber-300">
                              <Clock className="h-3.5 w-3.5" />
                              <span>Ordering Opening Soon</span>
                            </span>
                            <Link
                              href={`/listing/${encodeURIComponent(official.listingId)}`}
                              className="inline-flex h-9 items-center gap-1 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 px-3 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:border-theme-primary hover:text-theme-primary"
                            >
                              <span>Preview</span>
                              <ArrowRight className="h-3.5 w-3.5" />
                            </Link>
                          </>
                        )}
                      </div>
                    </div>
                  </motion.div>
                );
              })()}

            {/* Local Subscribed Print Pro Shops Grid (up to 4) */}
            {(liveSnapshot.printSpotlight?.printProShops?.length ?? 0) > 0 && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                {liveSnapshot.printSpotlight!.printProShops.map((shop) => {
                  const turnaround =
                    TURNAROUND_BADGE_LABELS[shop.turnaroundBadge];
                  const chips = getVerifiedCapabilityChipLabels(
                    {
                      capabilities: shop.capabilities,
                      verified_capabilities: shop.verifiedCapabilities,
                      is_first_party_printswift: false,
                    },
                    false
                  );
                  const rateSummary = formatStartingRateLabel(shop.rateCard);

                  return (
                    <motion.div
                      key={shop.listingId}
                      variants={ITEM_VARIANTS}
                      className="flex flex-col justify-between rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-3.5 shadow-sm transition-colors hover:border-theme-primary/45"
                    >
                      <div className="space-y-2">
                        <div className="flex items-center justify-between gap-2">
                          <span
                            className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold ${turnaround.className}`}
                          >
                            <Clock className="h-2.5 w-2.5" />
                            <span>{turnaround.shortLabel}</span>
                          </span>
                          <span className="inline-flex items-center gap-1 text-[10px] font-bold text-theme-primary">
                            <Sparkles className="h-2.5 w-2.5" />
                            <span>Print Pro</span>
                          </span>
                        </div>

                        <div>
                          <h3 className="text-sm font-bold text-slate-900 dark:text-white line-clamp-1">
                            {shop.title}
                          </h3>
                          <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                            {shop.locality}
                          </p>
                        </div>

                        {rateSummary && (
                          <p className="text-[11px] font-semibold tabular-nums text-slate-700 dark:text-slate-300">
                            {rateSummary}
                          </p>
                        )}

                        {chips.length > 0 && (
                          <div className="flex flex-wrap gap-1">
                            {chips.slice(0, 4).map((chip) => (
                              <span
                                key={chip}
                                className="rounded-md bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-700 dark:text-slate-300"
                              >
                                {chip}
                              </span>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="mt-3 flex items-center justify-between gap-2 border-t border-slate-100 dark:border-slate-800 pt-2.5">
                        <Link
                          href={`/listing/${encodeURIComponent(shop.listingId)}`}
                          className="text-[11px] font-semibold text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white"
                        >
                          Shop Details
                        </Link>
                        <Link
                          href={`/listing/${encodeURIComponent(shop.listingId)}/print`}
                          className="inline-flex h-7 items-center gap-1 rounded-lg bg-theme-primary px-2.5 text-[11px] font-bold text-[hsl(var(--color-primary-foreground))] transition-opacity hover:opacity-90"
                        >
                          <span>Order Online</span>
                          <ArrowRight className="h-3 w-3" />
                        </Link>
                      </div>
                    </motion.div>
                  );
                })}
              </div>
            )}
          </motion.div>
        </section>
      )}

      {/* ================================================================= */}
      {/* 3. INTERACTIVE PICK N DROP MODE SHOWCASE                           */}
      {/* ================================================================= */}
      <section className="border-y border-slate-200/70 dark:border-slate-800/70 bg-white dark:bg-slate-900/40">
        <div className="mx-auto max-w-6xl px-4 py-9 sm:px-6 sm:py-12 lg:px-8">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={SECTION_VIEWPORT}
            variants={CONTAINER_VARIANTS}
          >
            <motion.div
              variants={ITEM_VARIANTS}
              className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between"
            >
              <div>
                <p className="text-[11px] font-bold uppercase tracking-wider text-theme-primary">
                  Live Vehicle Pool &amp; Rates
                </p>
                <h2 className="mt-0.5 text-xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-2xl">
                  Pick N Drop — Transparent Local Fares
                </h2>
                <p className="mt-1 text-xs text-slate-600 dark:text-slate-400">
                  {activeModeMeta.shortDesc}
                </p>
              </div>

              {/* 3-Tab Mode Switcher */}
              <div
                role="tablist"
                aria-label="Pick N Drop Service Modes"
                className="inline-flex rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-100/90 dark:bg-slate-900 p-1 shadow-xs"
              >
                {PICK_N_DROP_MODES.map((mode) => {
                  const Icon = mode.icon;
                  const isActive = activePndMode === mode.id;
                  return (
                    <button
                      key={mode.id}
                      type="button"
                      role="tab"
                      aria-selected={isActive}
                      onClick={() => setActivePndMode(mode.id)}
                      className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-all ${
                        isActive
                          ? 'bg-theme-primary text-[hsl(var(--color-primary-foreground))] shadow-xs'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                      }`}
                    >
                      <Icon className="h-3.5 w-3.5" />
                      <span>{mode.label}</span>
                    </button>
                  );
                })}
              </div>
            </motion.div>

            {/* Animated Vehicle Cards Grid */}
            <div className="mt-5">
              <AnimatePresence mode="wait">
                <motion.div
                  key={activePndMode}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.24, ease: EASE_OUT_EXPO }}
                  className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3"
                >
                  {filteredVehicles.map((vehicle) => {
                    const oneWayStart = Math.round(vehicle.base_fare_inr);
                    const twoWayStart = Math.round(
                      vehicle.base_fare_inr * (vehicle.two_way_multiplier || 1.7)
                    );
                    return (
                      <div
                        key={vehicle.id}
                        className="flex flex-col justify-between rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm transition-colors hover:border-theme-primary/40"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2.5">
                            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-theme-primary/10 text-theme-primary">
                              {renderVehicleIcon(vehicle.slug, 'h-4 w-4')}
                            </div>
                            <div>
                              <h3 className="text-sm font-semibold text-slate-900 dark:text-white">
                                {vehicle.name}
                              </h3>
                              <p className="text-[11px] text-slate-600 dark:text-slate-400 tabular-nums">
                                Up to {vehicle.max_weight_kg} kg • ₹
                                {vehicle.per_km_rate_inr}/km
                              </p>
                            </div>
                          </div>
                          {vehicle.max_dimensions && (
                            <span className="rounded-md bg-slate-100 dark:bg-slate-800 px-1.5 py-0.5 text-[10px] font-medium text-slate-700 dark:text-slate-300">
                              {vehicle.max_dimensions}
                            </span>
                          )}
                        </div>

                        <div className="mt-3.5 grid grid-cols-2 gap-2 border-t border-slate-200/70 dark:border-slate-800 pt-3">
                          <div className="rounded-lg bg-slate-100/90 dark:bg-slate-800/80 px-2.5 py-1.5">
                            <p className="text-[10px] font-medium uppercase tracking-wide text-slate-500 dark:text-slate-400">
                              One-Way Base
                            </p>
                            <p className="mt-0.5 text-sm font-extrabold tabular-nums text-slate-900 dark:text-white">
                              ₹{oneWayStart}
                            </p>
                          </div>
                          <div className="rounded-lg bg-theme-primary/10 px-2.5 py-1.5">
                            <p className="text-[10px] font-medium uppercase tracking-wide text-theme-primary">
                              Two-Way Base
                            </p>
                            <p className="mt-0.5 text-sm font-extrabold tabular-nums text-theme-primary">
                              ₹{twoWayStart}
                            </p>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </motion.div>
              </AnimatePresence>
            </div>

            <motion.div
              variants={ITEM_VARIANTS}
              className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200/80 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 px-4 py-3"
            >
              <p className="text-xs text-slate-600 dark:text-slate-400">
                Live distance quotes calculate automatically when you drop
                Point A &amp; Point B pins on the map.
              </p>
              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <Link
                  href="/explore?mode=pick_n_drop"
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-theme-primary px-3.5 text-xs font-semibold text-[hsl(var(--color-primary-foreground))] shadow-xs transition-opacity hover:opacity-90"
                >
                  <span>Book Pick N Drop</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
                <Link
                  href={`/explore?hub=${encodeURIComponent(activeHubSlug)}&mode=pick_n_drop&serviceType=${encodeURIComponent(activePndMode)}`}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-950 px-3 text-xs font-semibold text-slate-800 dark:text-slate-200 hover:border-theme-primary hover:text-theme-primary transition-colors"
                >
                  <MapPin className="h-3.5 w-3.5" />
                  <span>Pin on Map</span>
                </Link>
              </div>
            </motion.div>
          </motion.div>
        </div>
      </section>

      {/* ================================================================= */}
      {/* 4. LIVE DISTRICT FEED PREVIEWS                                     */}
      {/* ================================================================= */}
      <section className="mx-auto max-w-6xl space-y-9 px-4 py-9 sm:px-6 sm:py-12 lg:px-8">
        {/* 4A. Featured Places */}
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={SECTION_VIEWPORT}
          variants={CONTAINER_VARIANTS}
        >
          <motion.div
            variants={ITEM_VARIANTS}
            className="mb-3.5 flex items-center justify-between gap-2"
          >
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-theme-primary">
                Live Directory
              </p>
              <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white sm:text-xl">
                Featured Places
              </h2>
            </div>
            <Link
              href="/explore"
              className="inline-flex items-center gap-1 text-xs font-medium text-theme-primary hover:underline"
            >
              <span>View All</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </motion.div>

          {liveSnapshot.featuredListings.length > 0 ? (
            <div className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory md:grid md:grid-cols-2 lg:grid-cols-4 md:overflow-visible md:pb-0">
              {liveSnapshot.featuredListings.map((listing) => (
                <motion.div
                  key={listing.id}
                  variants={ITEM_VARIANTS}
                  className="w-[240px] shrink-0 snap-start md:w-auto"
                >
                  <Link
                    href={`/explore?hub=${encodeURIComponent(activeHubSlug)}&focusListing=${encodeURIComponent(listing.id)}`}
                    className="group flex h-full flex-col overflow-hidden rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm transition-colors hover:border-theme-primary/40"
                  >
                    <ResilientThumb
                      src={listing.imageUrl}
                      alt={listing.title}
                      fallbackIcon={<Building2 className="h-4 w-4" />}
                      className="h-28 w-full"
                    />
                    <div className="flex flex-1 flex-col justify-between p-3">
                      <div>
                        <div className="flex items-center justify-between gap-1.5">
                          <span className="truncate text-[10px] font-semibold uppercase tracking-wide text-theme-primary">
                            {formatCategoryLabel(listing.category)}
                          </span>
                          <span className="inline-flex shrink-0 items-center gap-0.5 text-[11px] font-bold tabular-nums text-slate-900 dark:text-white">
                            <Star className="h-3 w-3 fill-amber-400 text-amber-400" />
                            {listing.rating.toFixed(1)}
                          </span>
                        </div>
                        {(() => {
                          const clean = splitSamplePrefix(listing.title);
                          return (
                            <div className="mt-1 flex items-center gap-1.5 min-w-0">
                              <h3 className="line-clamp-1 text-xs font-semibold text-slate-900 dark:text-white sm:text-sm min-w-0 leading-snug">
                                {clean.title}
                              </h3>
                              {clean.isSample && (
                                <span className="shrink-0 rounded border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                  Sample
                                </span>
                              )}
                            </div>
                          );
                        })()}
                      </div>
                      <p className="mt-2 flex items-center gap-1 truncate text-[11px] text-slate-600 dark:text-slate-400">
                        <MapPin className="h-3 w-3 shrink-0 text-theme-primary" />
                        <span className="truncate">{listing.locality}</span>
                      </p>
                    </div>
                  </Link>
                </motion.div>
              ))}
            </div>
          ) : (
            <div
              data-testid="get-featured-places-empty-card"
              className="rounded-2xl border border-dashed border-amber-500/40 bg-amber-500/5 dark:bg-amber-500/8 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div className="space-y-1">
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                  <Sparkles className="w-3 h-3" />
                  <span>Get Featured in {activeHubName}</span>
                </span>
                <p className="text-xs text-slate-700 dark:text-slate-300">
                  Spotlight your verified business right at the top of the{' '}
                  {activeHubName} homepage.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setFeaturedModalSection('featured_places');
                  setFeaturedModalOpen(true);
                }}
                className="h-9 px-4 rounded-xl bg-theme-primary text-[hsl(var(--color-primary-foreground))] text-xs font-bold inline-flex items-center gap-1.5 shrink-0 hover:opacity-95"
              >
                <span>Get Featured</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </motion.div>

        {/* 4B. Fresh on Marketplace */}
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={SECTION_VIEWPORT}
          variants={CONTAINER_VARIANTS}
        >
          <motion.div
            variants={ITEM_VARIANTS}
            className="mb-3.5 flex items-center justify-between gap-2"
          >
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-theme-primary">
                Direct Shop Catalogues
              </p>
              <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white sm:text-xl">
                Fresh on Marketplace
              </h2>
            </div>
            <Link
              href={`/marketplace?hub=${encodeURIComponent(activeHubSlug)}`}
              className="inline-flex items-center gap-1 text-xs font-medium text-theme-primary hover:underline"
            >
              <span>View All</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </motion.div>

          {liveSnapshot.latestProducts.length > 0 ? (
            <div className="flex gap-3 overflow-x-auto pb-2 snap-x snap-mandatory md:grid md:grid-cols-2 lg:grid-cols-4 md:overflow-visible md:pb-0">
              {liveSnapshot.latestProducts.map((product) => (
                <motion.div
                  key={product.id}
                  variants={ITEM_VARIANTS}
                  className="w-[240px] shrink-0 snap-start md:w-auto"
                >
                  <Link
                    href={`/marketplace?hub=${encodeURIComponent(activeHubSlug)}`}
                    className="group flex h-full flex-col overflow-hidden rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm transition-colors hover:border-theme-primary/40"
                  >
                    <ResilientThumb
                      src={product.thumbnailUrl}
                      alt={product.title}
                      fallbackIcon={<ShoppingBag className="h-4 w-4" />}
                      className="h-28 w-full"
                    />
                    <div className="flex flex-1 flex-col justify-between p-3">
                      <div>
                        <div className="flex items-center justify-between gap-1.5">
                          <span className="truncate text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            {product.category}
                          </span>
                          <span
                            className={`text-[10px] font-semibold ${
                              product.inStock
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-amber-600 dark:text-amber-400'
                            }`}
                          >
                            {product.inStock ? 'In Stock' : 'Check Stock'}
                          </span>
                        </div>
                        {(() => {
                          const clean = splitSamplePrefix(product.title);
                          return (
                            <div className="mt-1 flex items-center gap-1.5 min-w-0">
                              <h3 className="line-clamp-1 text-xs font-semibold text-slate-900 dark:text-white sm:text-sm min-w-0 leading-snug">
                                {clean.title}
                              </h3>
                              {clean.isSample && (
                                <span className="shrink-0 rounded border border-slate-200 dark:border-slate-700 bg-slate-100 dark:bg-slate-800 px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                                  Sample
                                </span>
                              )}
                            </div>
                          );
                        })()}
                        <p className="mt-1 text-sm font-extrabold tabular-nums text-theme-primary leading-snug pb-0.5">
                          ₹{product.price.toLocaleString('en-IN')}
                          <span className="text-[11px] font-normal text-slate-500 dark:text-slate-400 leading-snug">
                            {' '}
                            / {product.unit}
                          </span>
                        </p>
                      </div>
                      <p className="mt-2 flex items-center gap-1 truncate text-[11px] text-slate-600 dark:text-slate-400">
                        <Store className="h-3 w-3 shrink-0 text-theme-primary" />
                        <span className="truncate">
                          {splitSamplePrefix(product.shopName).title} •{' '}
                          {product.shopLocality}
                        </span>
                      </p>
                    </div>
                  </Link>
                </motion.div>
              ))}
            </div>
          ) : (
            <div
              data-testid="get-featured-products-empty-card"
              className="rounded-2xl border border-dashed border-amber-500/40 bg-amber-500/5 dark:bg-amber-500/8 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
            >
              <div className="space-y-1">
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                  <Sparkles className="w-3 h-3" />
                  <span>Feature Your Products in {activeHubName}</span>
                </span>
                <p className="text-xs text-slate-700 dark:text-slate-300">
                  Put your best-selling shop items or menu dishes on the{' '}
                  {activeHubName} homepage spotlight.
                </p>
              </div>
              <button
                type="button"
                onClick={() => {
                  setFeaturedModalSection('featured_products');
                  setFeaturedModalOpen(true);
                }}
                className="h-9 px-4 rounded-xl bg-theme-primary text-[hsl(var(--color-primary-foreground))] text-xs font-bold inline-flex items-center gap-1.5 shrink-0 hover:opacity-95"
              >
                <span>Get Featured</span>
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </motion.div>

        {/* 4C. Latest Bulletins */}
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={SECTION_VIEWPORT}
          variants={CONTAINER_VARIANTS}
        >
          <motion.div
            variants={ITEM_VARIANTS}
            className="mb-3.5 flex items-center justify-between gap-2"
          >
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-theme-primary">
                Community Notices
              </p>
              <h2 className="text-lg font-bold tracking-tight text-slate-900 dark:text-white sm:text-xl">
                Latest Bulletins
              </h2>
            </div>
            <Link
              href={`/bulletin?hub=${encodeURIComponent(activeHubSlug)}`}
              className="inline-flex items-center gap-1 text-xs font-medium text-theme-primary hover:underline"
            >
              <span>View All</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </motion.div>

          {liveSnapshot.latestBulletins.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              {liveSnapshot.latestBulletins.map((bulletin) => (
                <motion.div key={bulletin.id} variants={ITEM_VARIANTS}>
                  <Link
                    href={`/bulletin?hub=${encodeURIComponent(activeHubSlug)}`}
                    className="group flex h-full flex-col justify-between rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm transition-colors hover:border-theme-primary/40"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5">
                          {bulletin.isPinned && (
                            <span className="inline-flex items-center gap-0.5 rounded bg-theme-primary/10 px-1.5 py-0.5 text-[10px] font-bold text-theme-primary">
                              <Pin className="h-2.5 w-2.5" />
                              Pinned
                            </span>
                          )}
                          <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500 dark:text-slate-400">
                            {formatCategoryLabel(bulletin.category)}
                          </span>
                        </div>
                        {bulletin.hasVideo && (
                          <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-theme-primary">
                            <PlayCircle className="h-3 w-3" />
                            Video
                          </span>
                        )}
                      </div>

                      <h3 className="mt-2 line-clamp-2 text-sm font-semibold text-slate-900 dark:text-white group-hover:text-theme-primary transition-colors">
                        {bulletin.title}
                      </h3>
                      {bulletin.excerpt && (
                        <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                          {bulletin.excerpt}
                        </p>
                      )}
                    </div>

                    <div className="mt-3 flex items-center justify-between border-t border-slate-200/70 dark:border-slate-800 pt-2.5 text-[11px] text-slate-500 dark:text-slate-400">
                      <span className="truncate font-medium">
                        {bulletin.authorName}
                      </span>
                      <span className="shrink-0 tabular-nums">
                        {formatShortDate(bulletin.createdAt)}
                      </span>
                    </div>
                  </Link>
                </motion.div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-5 text-center text-xs text-slate-600 dark:text-slate-400">
              Stay updated with verified job posts, district events, and
              official announcements on the Bulletin board.
            </div>
          )}
        </motion.div>

        {/* 4D. Scheduled Vehicles & Charters */}
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={SECTION_VIEWPORT}
          variants={CONTAINER_VARIANTS}
          data-testid="landing-scheduled-vehicles"
        >
          <motion.div
            variants={ITEM_VARIANTS}
            className="mb-3.5 flex items-end justify-between gap-3"
          >
            <div>
              <p className="text-[11px] font-bold uppercase tracking-wider text-theme-primary">
                Scheduled Vehicles &amp; Charters
              </p>
              <h2 className="mt-0.5 text-lg font-bold tracking-tight text-slate-900 dark:text-white sm:text-xl">
                Book verified taxis, SUVs &amp; inter-hub seats
                {(liveSnapshot.counts.vehicleListings ?? 0) > 0 && (
                  <span className="ml-2 text-xs font-semibold tabular-nums text-slate-500 dark:text-slate-400">
                    ({liveSnapshot.counts.vehicleListings} active)
                  </span>
                )}
              </h2>
            </div>
            <Link
              href="/vehicles"
              className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 px-3 text-xs font-semibold text-slate-700 dark:text-slate-200 transition-colors hover:border-theme-primary hover:text-theme-primary"
            >
              <span>Browse All Vehicles</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </motion.div>

          {liveSnapshot.featuredVehicles &&
          liveSnapshot.featuredVehicles.length > 0 ? (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {liveSnapshot.featuredVehicles.map((vehicle) => {
                const modeLabel =
                  vehicle.bookingMode === 'per_seat'
                    ? 'Per Seat'
                    : vehicle.bookingMode === 'both'
                      ? 'Full / Seat'
                      : 'Full Vehicle';
                const interHubBadge = formatInterHubRouteBadge(
                  vehicle.originHubId,
                  vehicle.destinationHubIds
                );
                return (
                  <motion.div key={vehicle.id} variants={ITEM_VARIANTS}>
                    <Link
                      href={buildVehicleDetailRoute(vehicle.id)}
                      className="group flex h-full flex-col overflow-hidden rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-theme-primary/40 hover:shadow-md"
                    >
                      <div className="relative">
                        <ResilientThumb
                          src={vehicle.thumbnailUrl}
                          alt={vehicle.title}
                          fallbackIcon={<Car className="h-4 w-4" />}
                          className="h-28 w-full"
                        />
                        <span className="absolute top-2 left-2 rounded-md bg-slate-950/75 px-2 py-0.5 text-[10px] font-bold text-white backdrop-blur-xs">
                          {modeLabel}
                        </span>
                        <span className="absolute top-2 right-2 rounded-md bg-emerald-600/90 px-1.5 py-0.5 text-[10px] font-bold tabular-nums text-white">
                          {vehicle.advancePercent}% adv
                        </span>
                      </div>
                      <div className="flex flex-1 flex-col p-3">
                        <div className="flex items-center justify-between gap-2 text-[10px] font-medium text-slate-500 dark:text-slate-400">
                          <span className="inline-flex items-center gap-1 truncate">
                            <MapPin className="h-3 w-3 shrink-0 text-theme-primary" />
                            <span className="truncate">{vehicle.standLocality}</span>
                          </span>
                          <span className="shrink-0 tabular-nums">
                            {vehicle.totalSeats} seats
                          </span>
                        </div>
                        {interHubBadge && (
                          <div className="mt-1.5">
                            <span
                              data-testid={`landing-vehicle-route-badge-${vehicle.id}`}
                              className="inline-flex items-center gap-1 rounded-md border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700 dark:text-indigo-300"
                            >
                              <ArrowLeftRight className="h-2.5 w-2.5 shrink-0" />
                              <span>{interHubBadge}</span>
                            </span>
                          </div>
                        )}
                        <h3 className="mt-1 line-clamp-1 text-sm font-semibold text-slate-900 dark:text-white group-hover:text-theme-primary transition-colors">
                          {vehicle.title}
                        </h3>
                        <div className="mt-auto flex items-center justify-between pt-2.5 text-xs">
                          {vehicle.startingPriceInr > 0 ? (
                            <span className="font-extrabold tabular-nums text-slate-900 dark:text-white">
                              ₹{vehicle.startingPriceInr.toLocaleString('en-IN')}
                              <span className="text-[10px] font-medium text-slate-500 dark:text-slate-400">
                                {vehicle.startingPriceUnit}
                              </span>
                            </span>
                          ) : (
                            <span className="text-[11px] font-semibold text-theme-primary">
                              View Rates
                            </span>
                          )}
                          <span className="text-[10px] font-semibold text-theme-primary">
                            Reserve →
                          </span>
                        </div>
                      </div>
                    </Link>
                  </motion.div>
                );
              })}
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 p-4 text-xs text-slate-600 dark:text-slate-400">
              <span>
                Reserve verified local taxis, Bolero charters, and inter-hub
                seats with instant calendar locks.
              </span>
              <Link
                href="/vehicles"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-theme-primary px-3 text-xs font-semibold text-[hsl(var(--color-primary-foreground))] hover:opacity-90"
              >
                <Car className="h-3.5 w-3.5" />
                <span>Open Vehicles Map</span>
              </Link>
            </div>
          )}
        </motion.div>
      </section>

      {/* ================================================================= */}
      {/* 5. TRUST, SECURITY & ESCROW BAND                                   */}
      {/* ================================================================= */}
      <section className="border-y border-slate-200/70 dark:border-slate-800/70 bg-white dark:bg-slate-900/40">
        <div className="mx-auto max-w-6xl px-4 py-9 sm:px-6 sm:py-11 lg:px-8">
          <motion.div
            initial="hidden"
            whileInView="visible"
            viewport={SECTION_VIEWPORT}
            variants={CONTAINER_VARIANTS}
          >
            <motion.div variants={ITEM_VARIANTS} className="mb-5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-theme-primary">
                Trust &amp; Accountability
              </p>
              <h2 className="mt-0.5 text-xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-2xl">
                Built on verified handovers and transparent local escrow
              </h2>
            </motion.div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                {
                  icon: BadgeCheck,
                  title: 'Verified Local Businesses',
                  desc: 'Listings tied to real Churachandpur owners, direct phone contacts, and accurate map pins.',
                },
                {
                  icon: KeyRound,
                  title: 'Asymmetric OTP Handovers',
                  desc: 'Distinct Pickup, Dropoff, and Return OTPs stay hidden from drivers until physical verification.',
                },
                {
                  icon: Wallet,
                  title: 'Mediator-Verified UPI Escrow',
                  desc: 'Prepaid UPI fares are verified by vetted dispatch bookers and released only on safe delivery.',
                },
                {
                  icon: ShieldCheck,
                  title: '48-Hour Private POD Audit',
                  desc: 'Proof-of-Delivery images live in private encrypted storage with automated 48-hour privacy purge.',
                },
              ].map((pillar) => {
                const Icon = pillar.icon;
                return (
                  <motion.div
                    key={pillar.title}
                    variants={ITEM_VARIANTS}
                    className="rounded-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-4 shadow-sm"
                  >
                    <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-theme-primary/10 text-theme-primary">
                      <Icon className="h-4 w-4" />
                    </div>
                    <h3 className="mt-2.5 text-sm font-semibold text-slate-900 dark:text-white">
                      {pillar.title}
                    </h3>
                    <p className="mt-1 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                      {pillar.desc}
                    </p>
                  </motion.div>
                );
              })}
            </div>
          </motion.div>
        </div>
      </section>

      <PromoBannerSlot
        placement="landing_mid"
        className="mx-auto max-w-6xl px-4 pt-8 sm:px-6 lg:px-8"
      />

      {/* ================================================================= */}
      {/* 6. PARTNER & ROLE FUNNELS ("BUILT FOR EVERY LOCAL ROLE")           */}
      {/* ================================================================= */}
      <section className="mx-auto max-w-6xl px-4 py-9 sm:px-6 sm:py-12 lg:px-8">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={SECTION_VIEWPORT}
          variants={CONTAINER_VARIANTS}
        >
          <motion.div variants={ITEM_VARIANTS} className="mb-5">
            <p className="text-[11px] font-bold uppercase tracking-wider text-theme-primary">
              Partner With DD oodle
            </p>
            <h2 className="mt-0.5 text-xl font-bold tracking-tight text-slate-900 dark:text-white sm:text-2xl">
              Built for every local role
            </h2>
          </motion.div>

          <div className="grid grid-cols-1 gap-3.5 md:grid-cols-3">
            {(() => {
              const isSignedIn = Boolean(authUser?.id);
              const ownerPrimary = !isSignedIn
                ? {
                    label: 'Sign In to List Business',
                    href: '/login?next=/onboarding?track=business',
                  }
                : userHats.hasOwnerHat
                  ? {
                      label: 'Open Business Workspace',
                      href: '/workspace?hat=owner',
                    }
                  : pendingAppTracks.business
                    ? {
                        label: 'View Application Status',
                        href: '/onboarding?track=business',
                      }
                    : {
                        label: 'Apply as Business Partner',
                        href: '/onboarding?track=business',
                      };

              const driverPrimary = !isSignedIn
                ? {
                    label: 'Sign In to Apply as Driver',
                    href: '/login?next=/onboarding?track=driver',
                  }
                : userHats.hasDriverHat
                  ? {
                      label: 'Open Driver Console',
                      href: '/workspace?hat=driver',
                    }
                  : pendingAppTracks.driver
                    ? {
                        label: 'Driver Application In Review',
                        href: '/onboarding?track=driver',
                      }
                    : {
                        label: 'Apply as Driver',
                        href: '/onboarding?track=driver',
                      };

              return [
                {
                  icon: Store,
                  badge: 'Businesses',
                  title: 'Shop & Business Owners',
                  desc: 'Launch your Local Map Storefront with direct Print, Food, Shop & Booking tools plus integrated Pick N Drop rider dispatch.',
                  primaryLabel: ownerPrimary.label,
                  primaryHref: ownerPrimary.href,
                  secondaryLabel: null as string | null,
                  secondaryHref: null as string | null,
                },
                {
                  icon: Truck,
                  badge: 'Fleet Pool',
                  title: 'Local Drivers & Riders',
                  desc: 'Join the DD oodle Vehicle Pool with your Scooty, Cycle Rickshaw, E-Rickshaw, Van, or Pickup for steady jobs and transparent payouts.',
                  primaryLabel: driverPrimary.label,
                  primaryHref: driverPrimary.href,
                  secondaryLabel: null as string | null,
                  secondaryHref: null as string | null,
                },
                {
                  icon: Users,
                  badge: 'Publishers',
                  title: 'Advertisers & Organizers',
                  desc: 'Publish structured rich-text notices, recruitment drives, and YouTube video updates directly to Community Bulletin readers.',
                  primaryLabel: 'Explore Bulletin Plans',
                  primaryHref: buildBulletinRoute({ plans: true }),
                  secondaryLabel: pendingAppTracks.advertiser
                    ? 'Application In Review'
                    : 'Apply as Advertiser',
                  secondaryHref: `${ROUTES.onboarding}?track=advertiser`,
                },
              ];
            })().map((role) => {
              const Icon = role.icon;
              return (
                <motion.div
                  key={role.title}
                  variants={ITEM_VARIANTS}
                  whileHover={{ y: -2 }}
                  transition={{ type: 'spring', stiffness: 360, damping: 28 }}
                  className="flex flex-col justify-between rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm transition-colors hover:border-theme-primary/40"
                >
                  <div>
                    <div className="flex items-center justify-between">
                      <div className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-theme-primary/10 text-theme-primary">
                        <Icon className="h-4 w-4" />
                      </div>
                      <span className="rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-slate-700 dark:text-slate-300">
                        {role.badge}
                      </span>
                    </div>
                    <h3 className="mt-3 text-base font-semibold text-slate-900 dark:text-white">
                      {role.title}
                    </h3>
                    <p className="mt-1.5 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                      {role.desc}
                    </p>
                  </div>

                  <div className="mt-4 flex flex-wrap items-center gap-2 pt-2">
                    <Link
                      href={role.primaryHref}
                      className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-theme-primary px-3 text-xs font-semibold text-[hsl(var(--color-primary-foreground))] transition-opacity hover:opacity-90"
                    >
                      <span>{role.primaryLabel}</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Link>
                    {role.secondaryLabel && role.secondaryHref && (
                      <Link
                        href={role.secondaryHref}
                        className="inline-flex h-8 items-center rounded-lg border border-slate-200 dark:border-slate-800 bg-slate-100/90 dark:bg-slate-800 px-3 text-xs font-semibold text-slate-800 dark:text-slate-200 transition-colors hover:border-theme-primary hover:text-theme-primary"
                      >
                        {role.secondaryLabel}
                      </Link>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </div>
        </motion.div>
      </section>

      {/* ================================================================= */}
      {/* 7. REGIONAL ACCESSIBILITY & CUSTOMIZATION STRIP                    */}
      {/* ================================================================= */}
      <section className="mx-auto max-w-6xl px-4 pb-9 sm:px-6 sm:pb-12 lg:px-8">
        <motion.div
          initial="hidden"
          whileInView="visible"
          viewport={SECTION_VIEWPORT}
          variants={ITEM_VARIANTS}
          className="rounded-2xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 p-5 shadow-sm"
        >
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="max-w-xl">
              <div className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-theme-primary">
                <Sparkles className="h-3.5 w-3.5" />
                <span>Designed for Local Accessibility</span>
              </div>
              <h2 className="mt-1 text-lg font-bold tracking-tight text-slate-900 dark:text-white">
                Your language, your palette, your reading density
              </h2>
              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                  <Languages className="h-3.5 w-3.5 shrink-0 text-theme-primary" />
                  <span>English, Manipuri &amp; Paite interface support</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                  <Palette className="h-3.5 w-3.5 shrink-0 text-theme-primary" />
                  <span>Unified 3-tier custom themes &amp; dark mode</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                  <Sliders className="h-3.5 w-3.5 shrink-0 text-theme-primary" />
                  <span>Adjustable root UI scaling for comfort</span>
                </div>
                <div className="flex items-center gap-2 text-xs text-slate-600 dark:text-slate-400">
                  <Wifi className="h-3.5 w-3.5 shrink-0 text-theme-primary" />
                  <span>Lightweight, resilient mobile performance</span>
                </div>
              </div>
            </div>

            <div className="flex shrink-0 items-center gap-2">
              <Link
                href="/settings"
                className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-100/90 dark:bg-slate-800 px-4 text-xs font-semibold text-slate-800 dark:text-slate-200 transition-colors hover:border-theme-primary hover:text-theme-primary"
              >
                <Palette className="h-3.5 w-3.5 text-theme-primary" />
                <span>Customize in Settings</span>
              </Link>
            </div>
          </div>
        </motion.div>
      </section>

      {/* ================================================================= */}
      {/* 8. COMMERCIAL DISTRICT FOOTER                                      */}
      {/* ================================================================= */}
      <footer className="border-t border-slate-200/80 dark:border-slate-800/80 bg-white dark:bg-slate-900/60 pt-8 pb-20 sm:pt-10 landscape:pb-8 lg:pb-10">
        <div className="mx-auto max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 gap-7 md:grid-cols-12">
            {/* Brand Block */}
            <div className="md:col-span-4">
              <DDoodleLogo variant="full" size={32} />
              <p className="mt-2.5 max-w-sm text-xs leading-relaxed text-slate-600 dark:text-slate-400">
                {identity.tagline ||
                  'Your daily regional discovery platform for local places, marketplace items, community bulletins, and fast Pick N Drop delivery.'}
              </p>
              {(office.address || office.phone) && (
                <p className="mt-2 text-[11px] text-slate-500 dark:text-slate-400">
                  {[office.address, office.phone]
                    .filter(Boolean)
                    .join(' • ')}
                </p>
              )}
            </div>

            {/* Quick Navigation */}
            <div className="md:col-span-2">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-900 dark:text-white">
                Navigation
              </h3>
              <ul className="mt-2.5 space-y-1.5 text-xs text-slate-600 dark:text-slate-400">
                {[
                  { label: 'Home', href: '/' },
                  { label: 'Explore Map', href: '/explore' },
                  { label: 'Marketplace', href: '/marketplace' },
                  { label: 'Community Bulletin', href: '/bulletin' },
                  { label: 'About Us', href: '/about' },
                  { label: 'Contact Us', href: '/contact' },
                ].map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="transition-colors hover:text-theme-primary"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Legal & Policies (Mandatory Razorpay-KYC links) */}
            <div className="md:col-span-2">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-900 dark:text-white">
                Policies
              </h3>
              <ul className="mt-2.5 space-y-1.5 text-xs text-slate-600 dark:text-slate-400">
                {[
                  { label: 'Terms & Conditions', href: '/legal/terms' },
                  { label: 'Privacy Policy', href: '/legal/privacy' },
                  {
                    label: 'Refund & Cancellation',
                    href: '/legal/refund-policy',
                  },
                  { label: 'Preferences', href: '/settings' },
                ].map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className="transition-colors hover:text-theme-primary"
                    >
                      {item.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            {/* Popular Localities */}
            <div className="md:col-span-4">
              <h3 className="text-[11px] font-bold uppercase tracking-wider text-slate-900 dark:text-white">
                Popular Localities ({activeHubName})
              </h3>
              <div className="mt-2.5 flex flex-wrap gap-1.5">
                {footerLocalities.map((locality) => (
                  <Link
                    key={locality.slug}
                    href={`/explore?hub=${encodeURIComponent(activeHubSlug)}&locality=${encodeURIComponent(locality.slug)}`}
                    className="inline-flex items-center gap-1 rounded-lg border border-slate-200/80 dark:border-slate-800 bg-slate-100/90 dark:bg-slate-900 px-2.5 py-1 text-xs font-medium text-slate-700 dark:text-slate-300 transition-colors hover:border-theme-primary hover:text-theme-primary"
                  >
                    <MapPin className="h-3 w-3 text-theme-primary" />
                    <span>{locality.name}</span>
                  </Link>
                ))}
              </div>
            </div>
          </div>

          <div className="mt-7 flex flex-col gap-2 border-t border-slate-200/70 dark:border-slate-800 pt-4 text-[11px] text-slate-500 dark:text-slate-400 sm:flex-row sm:items-center sm:justify-between">
            <p>
              © {new Date().getFullYear()}{' '}
              {identity.app_name || 'DD oodle'} • {activeHubName} Hub,{' '}
              {activeHubState}
            </p>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
              <Link href="/about" className="hover:text-theme-primary">
                About
              </Link>
              <Link href="/contact" className="hover:text-theme-primary">
                Contact
              </Link>
              <Link href="/legal/terms" className="hover:text-theme-primary">
                Terms
              </Link>
              <Link href="/legal/privacy" className="hover:text-theme-primary">
                Privacy
              </Link>
              <Link
                href="/legal/refund-policy"
                className="hover:text-theme-primary"
              >
                Refund Policy
              </Link>
            </div>
          </div>
        </div>
      </footer>

      <GetFeaturedModal
        open={featuredModalOpen}
        onClose={() => setFeaturedModalOpen(false)}
        hubId={activeHubId || null}
        hubName={activeHubName}
        defaultSection={featuredModalSection}
        onRequireSignIn={() => router.push('/login?next=/')}
      />
    </div>
  );
}
