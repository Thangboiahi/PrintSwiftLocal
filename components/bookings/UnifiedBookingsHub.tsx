'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { motion, useReducedMotion } from 'framer-motion';
import {
  ArrowLeftRight,
  BedDouble,
  Bookmark,
  Calendar,
  CalendarCheck,
  Car,
  CheckCircle2,
  Compass,
  MapPin,
  Navigation,
  RefreshCw,
  Route,
  Search,
  ShieldCheck,
  Sparkles,
  Star,
  Truck,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import { useAppConfig } from '@/components/providers/AppConfigProvider';
import { CustomSelectModal } from '@/components/ui/CustomSelectModal';
import { ShareButton } from '@/components/ui/ShareButton';
import { BookingsGridSkeleton } from '@/components/shared/Skeletons';
import { useLiveNavBadges } from '@/lib/hooks/useLiveNavBadges';
import { useSavedInterests } from '@/lib/hooks/useSavedInterests';
import { useAuth } from '@/lib/store';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { resolveRemoteMediaUrl } from '@/lib/supabase/storage';
import { splitSamplePrefix } from '@/lib/utils/display-title';
import {
  resolveListingLiveCapabilities,
  type HubModuleSwitchFlags,
} from '@/lib/verticals/capabilities';
import type { Listing } from '@/lib/types';

export type BookingsHubTab =
  | 'all'
  | 'vehicles'
  | 'venues'
  | 'stays'
  | 'events'
  | 'tables';

type QuickDateFilter = 'any' | 'today' | 'tomorrow' | 'weekend';
type SortMode = 'featured' | 'lowest_price' | 'top_rated';
type VehicleSubTypeFilter =
  | 'all'
  | 'cruiser_sumo'
  | 'cab_sedan'
  | 'mini_van'
  | 'two_wheeler';

export interface UnifiedBookingsHubProps {
  initialTab?: BookingsHubTab;
  initialQuery?: string;
  initialType?: string;
}

interface UnifiedBookingCardItem {
  id: string;
  entityId: string;
  kind: 'vehicle' | 'venue' | 'stay' | 'event' | 'table' | 'visit';
  tabGroup: Exclude<BookingsHubTab, 'all'>;
  title: string;
  isSample: boolean;
  categoryPill: string;
  locality: string;
  routeLine: string | null;
  priceLabel: string;
  numericPrice: number;
  scheduleLine: string;
  rating: number;
  reviewCount: number;
  verified: boolean;
  thumbnailUrl: string | null;
  primaryCtaLabel: string;
  primaryHref: string;
  mapFocusHref: string | null;
  pickNDropHref: string | null;
  shareUrl: string;
  vehicleSubType?: VehicleSubTypeFilter;
  dateTimestamp?: number | null;
  sortRank: number;
}

function isHubSwitchActive(
  switches: HubModuleSwitchFlags | Record<string, unknown> | undefined | null,
  key: string
): boolean {
  if (!switches) return true;
  const raw = (switches as Record<string, unknown>)[key];
  if (raw === false) return false;
  if (raw && typeof raw === 'object' && (raw as { enabled?: unknown }).enabled === false) {
    return false;
  }
  return true;
}

function classifyVehicleSubType(
  slug: string,
  typeName: string,
  title: string,
  tags: string[],
  seats: number
): VehicleSubTypeFilter {
  const hay = `${slug} ${typeName} ${title} ${tags.join(' ')}`.toLowerCase();
  if (
    hay.includes('two_wheeler') ||
    hay.includes('scooter') ||
    hay.includes('bike') ||
    hay.includes('2-wheeler') ||
    hay.includes('activa')
  ) {
    return 'two_wheeler';
  }
  if (
    hay.includes('mini_van') ||
    hay.includes('pickup') ||
    hay.includes('cargo') ||
    hay.includes('shifting') ||
    hay.includes('van') ||
    hay.includes('bolero')
  ) {
    return 'mini_van';
  }
  if (
    hay.includes('sumo') ||
    hay.includes('cruiser') ||
    hay.includes('suv') ||
    hay.includes('force') ||
    seats >= 7
  ) {
    return 'cruiser_sumo';
  }
  return 'cab_sedan';
}

function computeVehiclePrice(row: Record<string, unknown>): {
  label: string;
  numeric: number;
} {
  const routes = Array.isArray(row.fixed_routes)
    ? (row.fixed_routes as Array<{ fare_inr?: number; full_vehicle_fare_inr?: number }>)
    : [];
  const bookingMode = String(row.booking_mode || 'full_vehicle');
  if (routes.length > 0) {
    const fares = routes
      .map((r) => Number(r.fare_inr || r.full_vehicle_fare_inr || 0))
      .filter((n) => Number.isFinite(n) && n > 0);
    if (fares.length > 0) {
      const minFare = Math.min(...fares);
      return {
        label: `From ₹${minFare.toLocaleString('en-IN')}${bookingMode === 'per_seat' ? '/seat' : '/trip'}`,
        numeric: minFare,
      };
    }
  }
  const daily = Number(row.rate_daily_inr ?? 0);
  if (Number.isFinite(daily) && daily > 0) {
    return { label: `₹${Math.round(daily).toLocaleString('en-IN')}/day`, numeric: daily };
  }
  const hourly = Number(row.rate_hourly_inr ?? 0);
  if (Number.isFinite(hourly) && hourly > 0) {
    return { label: `₹${Math.round(hourly).toLocaleString('en-IN')}/hr`, numeric: hourly };
  }
  const perKm = Number(row.rate_per_km_inr ?? 0);
  if (Number.isFinite(perKm) && perKm > 0) {
    return { label: `₹${Math.round(perKm).toLocaleString('en-IN')}/km`, numeric: perKm };
  }
  return { label: 'Quote on Request', numeric: 999999 };
}

function matchesQuickDateFilter(
  dateTimestamp: number | null | undefined,
  filter: QuickDateFilter
): boolean {
  if (filter === 'any') return true;
  if (!dateTimestamp) {
    // Ongoing daily bookable slots (vehicles, turfs, stays, tables) are available today/tomorrow/weekend
    return true;
  }
  const now = new Date();
  const startOfToday = new Date(
    now.getFullYear(),
    now.getMonth(),
    now.getDate()
  ).getTime();
  const dayMs = 86400000;
  if (filter === 'today') {
    return dateTimestamp >= startOfToday && dateTimestamp < startOfToday + dayMs;
  }
  if (filter === 'tomorrow') {
    return (
      dateTimestamp >= startOfToday + dayMs &&
      dateTimestamp < startOfToday + 2 * dayMs
    );
  }
  // This weekend (up to next Monday morning)
  const dayOfWeek = now.getDay();
  const daysToSat = (6 - dayOfWeek + 7) % 7;
  const satStart = startOfToday + daysToSat * dayMs;
  const monStart = satStart + 2 * dayMs;
  return dateTimestamp >= Math.min(startOfToday, satStart) && dateTimestamp < monStart;
}

function buildListingFromRow(raw: Record<string, unknown>): Listing {
  const lat = Number(raw.lat ?? 24.333);
  const lng = Number(raw.lng ?? 93.679);
  const summary =
    raw.vertical_summary && typeof raw.vertical_summary === 'object'
      ? (raw.vertical_summary as Listing['vertical_summary'])
      : null;

  return {
    id: String(raw.id || ''),
    hub_id: typeof raw.hub_id === 'string' ? raw.hub_id : null,
    category_id: typeof raw.category_id === 'string' ? raw.category_id : null,
    locality_id: typeof raw.locality_id === 'string' ? raw.locality_id : null,
    listing_vertical: (typeof raw.listing_vertical === 'string'
      ? raw.listing_vertical
      : 'general') as Listing['listing_vertical'],
    vertical_summary: summary,
    lifecycle_status: (typeof raw.lifecycle_status === 'string'
      ? raw.lifecycle_status
      : 'active') as Listing['lifecycle_status'],
    title: String(raw.title || 'Service'),
    category: (typeof raw.category === 'string'
      ? raw.category
      : 'business') as Listing['category'],
    subcategory: String(raw.subcategory || 'General'),
    status: 'published',
    locality: String(raw.locality || 'Central'),
    address: String(raw.address || raw.locality || ''),
    coordinates: {
      lat: Number.isFinite(lat) ? lat : 24.333,
      lng: Number.isFinite(lng) ? lng : 93.679,
    },
    shortDescription: String(raw.short_description || ''),
    description: String(raw.short_description || ''),
    verificationStatus: 'verified_demo',
    contactPhone: typeof raw.contact_phone === 'string' ? raw.contact_phone : '',
    contactEmail: '',
    ownerId: typeof raw.owner_id === 'string' ? raw.owner_id : '',
    ownerName: 'Partner',
    assignedStaffIds: [],
    coverImage: String(raw.thumbnail_url || raw.cover_image || ''),
    galleryImages: [],
    rating: Number(raw.rating ?? 0),
    reviewCount: Number(raw.review_count ?? 0),
    viewsCount: 0,
    mapImpressionsCount: 0,
    detailVisitsCount: 0,
    followsCount: 0,
    enquiriesCount: 0,
    directionClicksCount: 0,
    versionHistory: [],
    createdAt: String(raw.created_at || new Date().toISOString()),
    updatedAt: String(raw.created_at || new Date().toISOString()),
  };
}

export function UnifiedBookingsHub({
  initialTab = 'all',
  initialQuery = '',
  initialType = 'all',
}: UnifiedBookingsHubProps) {
  const { activeHub, hubs, hubLocalities } = useAppConfig();
  const activeHubId = activeHub?.id || '';
  const activeHubName = activeHub?.name || 'Churachandpur';
  const moduleSwitches = activeHub?.module_switches as
    | Record<string, unknown>
    | undefined;

  const { user } = useAuth();
  const prefersReducedMotion = useReducedMotion();
  const { isSaved, toggleSave } = useSavedInterests();
  const liveBadges = useLiveNavBadges({ userId: user?.id || null });

  const [activeTab, setActiveTab] = useState<BookingsHubTab>(initialTab);
  const [searchInput, setSearchInput] = useState<string>(initialQuery);
  const [debouncedQuery, setDebouncedQuery] = useState<string>(initialQuery);
  const [dateFilter, setDateFilter] = useState<QuickDateFilter>('any');
  const [localityFilter, setLocalityFilter] = useState<string>('all');
  const [sortMode, setSortMode] = useState<SortMode>('featured');
  const [vehicleSubFilter, setVehicleSubFilter] =
    useState<VehicleSubTypeFilter>(() => {
      const clean = (initialType || '').toLowerCase();
      if (
        clean === 'cruiser_sumo' ||
        clean === 'cab_sedan' ||
        clean === 'mini_van' ||
        clean === 'two_wheeler'
      ) {
        return clean;
      }
      return 'all';
    });

  const [items, setItems] = useState<UnifiedBookingCardItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Sync URL query params if initial props change
  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  // 160ms debounce for smooth typing
  useEffect(() => {
    const t = window.setTimeout(() => {
      setDebouncedQuery(searchInput);
    }, 160);
    return () => window.clearTimeout(t);
  }, [searchInput]);

  const hubNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const h of hubs) {
      map.set(h.id, h.name);
    }
    return map;
  }, [hubs]);

  const loadBookingsData = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);

    if (!isSupabaseConfigured()) {
      setItems([]);
      setIsLoading(false);
      return;
    }

    try {
      const hasHubFilter = Boolean(
        activeHubId && !activeHubId.startsWith('fallback-')
      );

      let vehiclesQ = supabase
        .from('vehicle_listings')
        .select('*, vehicle_types(slug, name)')
        .eq('is_active', true)
        .order('is_verified', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(60);

      let bookableListingsQ = supabase
        .from('listings')
        .select(
          'id, hub_id, category_id, locality_id, listing_vertical, vertical_summary, lifecycle_status, paid_until, title, category, subcategory, locality, address, short_description, contact_phone, price, lat, lng, thumbnail_url, cover_image, rating, review_count, owner_id, status, created_at'
        )
        .eq('status', 'published')
        .eq('lifecycle_status', 'active')
        .in('listing_vertical', [
          'booking_venue',
          'hotel_stay',
          'restaurant_food',
          'real_estate',
        ])
        .order('rating', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .limit(80);

      let eventsQ = supabase
        .from('bulletins')
        .select(
          'id, title, excerpt, category, image_urls, expires_at, paid_until, created_at, is_global, target_hub_ids, linked_listing_id'
        )
        .eq('category', 'event')
        .in('status', ['published', 'active'])
        .order('created_at', { ascending: false })
        .limit(30);

      if (hasHubFilter) {
        vehiclesQ = vehiclesQ.or(
          `origin_hub_id.eq.${activeHubId},destination_hub_ids.cs.{${activeHubId}}`
        );
        bookableListingsQ = bookableListingsQ.eq('hub_id', activeHubId);
        eventsQ = eventsQ.or(
          `is_global.eq.true,target_hub_ids.cs.{${activeHubId}}`
        );
      }

      const [vehRes, listRes, evtRes] = await Promise.allSettled([
        isHubSwitchActive(moduleSwitches, 'scheduled_vehicles')
          ? vehiclesQ
          : Promise.resolve({ data: [], error: null }),
        bookableListingsQ,
        eventsQ,
      ]);

      const nowMs = Date.now();
      const nextItems: UnifiedBookingCardItem[] = [];

      // 1. Vehicles (Bus & Inter-Hub Vehicles)
      if (
        vehRes.status === 'fulfilled' &&
        !vehRes.value.error &&
        Array.isArray(vehRes.value.data)
      ) {
        for (const raw of vehRes.value.data as Array<Record<string, unknown>>) {
          const id = String(raw.id || '');
          if (!id) continue;
          if (typeof raw.paid_until === 'string' && raw.paid_until) {
            const paidUntilMs = Date.parse(raw.paid_until);
            if (!Number.isNaN(paidUntilMs) && paidUntilMs <= nowMs) continue;
          }
          const vtJoin = Array.isArray(raw.vehicle_types)
            ? (raw.vehicle_types[0] as Record<string, unknown> | undefined)
            : (raw.vehicle_types as Record<string, unknown> | undefined);
          const slug = String(vtJoin?.slug || '');
          const typeName = String(vtJoin?.name || 'Vehicle');
          const { title, isSample } = splitSamplePrefix(
            String(raw.title || 'Scheduled Ride')
          );
          const standLoc = String(raw.stand_locality || activeHubName);
          const destIds = Array.isArray(raw.destination_hub_ids)
            ? (raw.destination_hub_ids as string[])
            : [];
          const originName =
            (typeof raw.origin_hub_id === 'string' &&
              hubNameById.get(raw.origin_hub_id)) ||
            activeHubName;
          const destNames = destIds
            .map((did) => hubNameById.get(did))
            .filter((n): n is string => Boolean(n && n !== originName));
          const routeLine =
            destNames.length > 0
              ? `${originName} ↔ ${destNames.join(' / ')}`
              : `${standLoc} Stand`;
          const price = computeVehiclePrice(raw);
          const seats = Number(raw.total_seats ?? 4);
          const bookingMode = String(raw.booking_mode || 'full_vehicle');
          const fixedRoutes = Array.isArray(raw.fixed_routes)
            ? (raw.fixed_routes as Array<{ departure_time?: string }>)
            : [];
          const firstDep =
            typeof fixedRoutes[0]?.departure_time === 'string' &&
            fixedRoutes[0].departure_time.trim()
              ? `Departs ${fixedRoutes[0].departure_time.trim()}`
              : bookingMode === 'per_seat'
                ? `${seats} seats · Daily schedule`
                : `${seats} seats · Full vehicle charter`;

          const lat = Number(raw.lat ?? NaN);
          const lng = Number(raw.lng ?? NaN);
          const hasCoords = Number.isFinite(lat) && Number.isFinite(lng) && (lat !== 0 || lng !== 0);

          nextItems.push({
            id: `veh-${id}`,
            entityId: id,
            kind: 'vehicle',
            tabGroup: 'vehicles',
            title,
            isSample,
            categoryPill: typeName,
            locality: standLoc,
            routeLine,
            priceLabel: price.label,
            numericPrice: price.numeric,
            scheduleLine: firstDep,
            rating: Number(raw.is_verified ? 4.8 : 4.5),
            reviewCount: 0,
            verified: Boolean(raw.is_verified),
            thumbnailUrl:
              typeof raw.thumbnail_url === 'string'
                ? resolveRemoteMediaUrl(raw.thumbnail_url)
                : null,
            primaryCtaLabel:
              bookingMode === 'per_seat' ? 'Book Seat →' : 'Book Vehicle →',
            primaryHref: `/vehicles/${encodeURIComponent(id)}`,
            mapFocusHref: hasCoords
              ? `/explore?focusLat=${encodeURIComponent(String(lat))}&focusLng=${encodeURIComponent(String(lng))}`
              : null,
            pickNDropHref: hasCoords
              ? `/explore?mode=pick_n_drop&dropoffLat=${encodeURIComponent(String(lat))}&dropoffLng=${encodeURIComponent(String(lng))}&dropoffLabel=${encodeURIComponent(title)}`
              : null,
            shareUrl: `/vehicles/${encodeURIComponent(id)}`,
            vehicleSubType: classifyVehicleSubType(
              slug,
              typeName,
              title,
              Array.isArray(raw.custom_tags) ? (raw.custom_tags as string[]) : [],
              seats
            ),
            sortRank: raw.is_verified ? 10 : 20,
          });
        }
      }

      // 2. Bookable Venues, Hotels/Stays, Table Booking Restaurants & Property Visits
      if (
        listRes.status === 'fulfilled' &&
        !listRes.value.error &&
        Array.isArray(listRes.value.data)
      ) {
        const rawRows = (listRes.value.data as Array<Record<string, unknown>>).filter(
          (row) => {
            if (typeof row.paid_until === 'string' && row.paid_until) {
              const paidUntilMs = Date.parse(row.paid_until);
              if (!Number.isNaN(paidUntilMs) && paidUntilMs <= nowMs) return false;
            }
            return true;
          }
        );
        const mappedListings = rawRows.map((row) => ({
          raw: row,
          listing: buildListingFromRow(row),
        }));

        // Verify live booking entitlement + active resources for booking_venue / hotel_stay
        const bookingCandidates = mappedListings.filter(
          ({ listing }) =>
            listing.listing_vertical === 'booking_venue' ||
            listing.listing_vertical === 'hotel_stay'
        );

        const activeResourceCounts = new Map<string, number>();
        const minRatesMap = new Map<string, { rate: number; unit: string }>();
        const bookingEntitledSet = new Set<string>();

        if (bookingCandidates.length > 0) {
          const candidateIds = bookingCandidates.map((c) => c.listing.id);
          const [resRows, entChecks] = await Promise.all([
            supabase
              .from('listing_booking_resources')
              .select('listing_id, base_rate_inr, booking_unit, is_active')
              .in('listing_id', candidateIds)
              .eq('is_active', true),
            Promise.allSettled(
              bookingCandidates.map(async ({ listing }) => {
                const v =
                  listing.listing_vertical === 'hotel_stay'
                    ? 'hotel_stay'
                    : 'booking_venue';
                const { data } = await supabase.rpc(
                  'has_active_booking_entitlement',
                  {
                    p_listing_id: listing.id,
                    p_vertical: v,
                  }
                );
                if (data === true) return { id: listing.id, ok: true };
                const summary = (listing.vertical_summary || {}) as Record<
                  string,
                  unknown
                >;
                if (
                  summary.has_active_entitlement === true ||
                  summary.booking_slots === true ||
                  summary.hotel_multi_room === true ||
                  summary.is_booking_enabled === true
                ) {
                  return { id: listing.id, ok: true };
                }
                return { id: listing.id, ok: false };
              })
            ),
          ]);

          if (Array.isArray(resRows.data)) {
            for (const rr of resRows.data as Array<Record<string, unknown>>) {
              const lid = String(rr.listing_id || '');
              if (!lid) continue;
              activeResourceCounts.set(
                lid,
                (activeResourceCounts.get(lid) || 0) + 1
              );
              const rate = Number(rr.base_rate_inr ?? 0);
              const unit = String(rr.booking_unit || 'slot');
              if (Number.isFinite(rate) && rate > 0) {
                const prev = minRatesMap.get(lid);
                if (!prev || rate < prev.rate) {
                  minRatesMap.set(lid, { rate, unit });
                }
              }
            }
          }

          for (const check of entChecks) {
            if (check.status === 'fulfilled' && check.value.ok) {
              bookingEntitledSet.add(check.value.id);
            }
          }
        }

        const restaurantCandidates = mappedListings.filter(
          ({ listing }) => listing.listing_vertical === 'restaurant_food'
        );
        const restaurantTableEnabled = new Set<string>();
        if (restaurantCandidates.length > 0) {
          const restIds = restaurantCandidates.map((r) => r.listing.id);
          const { data: restProfiles } = await supabase
            .from('listing_restaurant_profiles')
            .select('listing_id, allow_table_booking')
            .in('listing_id', restIds)
            .eq('allow_table_booking', true);
          if (Array.isArray(restProfiles)) {
            for (const rp of restProfiles as Array<Record<string, unknown>>) {
              if (rp.listing_id) {
                restaurantTableEnabled.add(String(rp.listing_id));
              }
            }
          }
        }

        const hubFlagInput = (moduleSwitches || null) as HubModuleSwitchFlags | null;

        for (const { listing } of mappedListings) {
          const { title, isSample } = splitSamplePrefix(listing.title);
          const summary = (listing.vertical_summary || {}) as Record<
            string,
            unknown
          >;
          const caps = resolveListingLiveCapabilities(listing, null, hubFlagInput);
          const img = listing.coverImage
            ? resolveRemoteMediaUrl(listing.coverImage) || null
            : null;
          const vert = listing.listing_vertical;

          if (
            vert === 'booking_venue' &&
            isHubSwitchActive(moduleSwitches, 'booking_venues')
          ) {
            const hasResources =
              (activeResourceCounts.get(listing.id) ??
                Number(summary.active_resources_count ?? 0)) > 0;
            const entitled =
              bookingEntitledSet.has(listing.id) || caps.canBookVenueOrStay;
            if (!entitled || !hasResources || summary.is_accepting_bookings === false) {
              continue;
            }
            const rateMeta = minRatesMap.get(listing.id);
            const fallbackRate = Number(summary.starting_rate_inr ?? 0);
            const rate = rateMeta?.rate ?? (fallbackRate > 0 ? fallbackRate : 0);
            const unitLabel = rateMeta?.unit === 'full_day' ? '/day' : '/hr';

            nextItems.push({
              id: `ven-${listing.id}`,
              entityId: listing.id,
              kind: 'venue',
              tabGroup: 'venues',
              title,
              isSample,
              categoryPill: listing.subcategory || 'Turf & Hall',
              locality: listing.locality,
              routeLine: listing.address || listing.locality,
              priceLabel:
                rate > 0
                  ? `From ₹${Math.round(rate).toLocaleString('en-IN')}${unitLabel}`
                  : 'Hourly / Slot Booking',
              numericPrice: rate > 0 ? rate : 999999,
              scheduleLine: 'Instant live slot calendar',
              rating: listing.rating || 4.6,
              reviewCount: listing.reviewCount || 0,
              verified: true,
              thumbnailUrl: img,
              primaryCtaLabel: 'Book Slot →',
              primaryHref: `/listing/${encodeURIComponent(listing.id)}/book`,
              mapFocusHref: `/explore?focusListing=${encodeURIComponent(listing.id)}`,
              pickNDropHref: `/explore?mode=pick_n_drop&dropoffListingId=${encodeURIComponent(listing.id)}`,
              shareUrl: `/listing/${encodeURIComponent(listing.id)}/book`,
              sortRank: 12,
            });
          } else if (
            vert === 'hotel_stay' &&
            isHubSwitchActive(moduleSwitches, 'hotel_stays')
          ) {
            const hasRooms =
              (activeResourceCounts.get(listing.id) ??
                Number(summary.active_resources_count ?? summary.room_count ?? 0)) >
              0;
            const entitled =
              bookingEntitledSet.has(listing.id) || caps.canBookVenueOrStay;
            if (!entitled || !hasRooms || summary.is_accepting_bookings === false) {
              continue;
            }
            const rateMeta = minRatesMap.get(listing.id);
            const fallbackRate = Number(summary.starting_rate_inr ?? 0);
            const rate = rateMeta?.rate ?? (fallbackRate > 0 ? fallbackRate : 0);

            nextItems.push({
              id: `stay-${listing.id}`,
              entityId: listing.id,
              kind: 'stay',
              tabGroup: 'stays',
              title,
              isSample,
              categoryPill: listing.subcategory || 'Hotel & Stay',
              locality: listing.locality,
              routeLine: listing.address || listing.locality,
              priceLabel:
                rate > 0
                  ? `From ₹${Math.round(rate).toLocaleString('en-IN')}/night`
                  : 'Check room rates',
              numericPrice: rate > 0 ? rate : 999999,
              scheduleLine: 'Instant check-in room dates',
              rating: listing.rating || 4.6,
              reviewCount: listing.reviewCount || 0,
              verified: true,
              thumbnailUrl: img,
              primaryCtaLabel: 'Book Room →',
              primaryHref: `/listing/${encodeURIComponent(listing.id)}/book`,
              mapFocusHref: `/explore?focusListing=${encodeURIComponent(listing.id)}`,
              pickNDropHref: `/explore?mode=pick_n_drop&dropoffListingId=${encodeURIComponent(listing.id)}`,
              shareUrl: `/listing/${encodeURIComponent(listing.id)}/book`,
              sortRank: 14,
            });
          } else if (
            vert === 'restaurant_food' &&
            isHubSwitchActive(moduleSwitches, 'food_orders')
          ) {
            const canTable =
              caps.canReserveTable ||
              (restaurantTableEnabled.has(listing.id) &&
                Boolean(
                  summary.has_active_entitlement === true ||
                    summary.restaurant_table_booking === true
                ));
            if (!canTable) continue;

            nextItems.push({
              id: `tbl-${listing.id}`,
              entityId: listing.id,
              kind: 'table',
              tabGroup: 'tables',
              title,
              isSample,
              categoryPill: 'Table Reservation',
              locality: listing.locality,
              routeLine: listing.address || listing.locality,
              priceLabel: 'Free Table Hold',
              numericPrice: 0,
              scheduleLine: 'Instant party size & time booking',
              rating: listing.rating || 4.5,
              reviewCount: listing.reviewCount || 0,
              verified: true,
              thumbnailUrl: img,
              primaryCtaLabel: 'Reserve Table →',
              primaryHref: `/listing/${encodeURIComponent(listing.id)}`,
              mapFocusHref: `/explore?focusListing=${encodeURIComponent(listing.id)}`,
              pickNDropHref: `/explore?mode=pick_n_drop&dropoffListingId=${encodeURIComponent(listing.id)}`,
              shareUrl: `/listing/${encodeURIComponent(listing.id)}`,
              sortRank: 16,
            });
          } else if (
            vert === 'real_estate' &&
            isHubSwitchActive(moduleSwitches, 'real_estate')
          ) {
            const acceptsVisits = summary.accepts_site_visits !== false;
            if (!acceptsVisits) continue;
            const rawPrice = Number(summary.price_inr ?? 0);
            nextItems.push({
              id: `vis-${listing.id}`,
              entityId: listing.id,
              kind: 'visit',
              tabGroup: 'tables',
              title,
              isSample,
              categoryPill: 'Property Site Visit',
              locality: listing.locality,
              routeLine: listing.address || listing.locality,
              priceLabel:
                rawPrice > 0
                  ? `₹${Math.round(rawPrice).toLocaleString('en-IN')}`
                  : 'Verified Property',
              numericPrice: rawPrice > 0 ? rawPrice : 999999,
              scheduleLine: 'Book guided property viewing slot',
              rating: listing.rating || 4.5,
              reviewCount: listing.reviewCount || 0,
              verified: Boolean(summary.patta_verified || summary.site_verified),
              thumbnailUrl: img,
              primaryCtaLabel: 'Schedule Visit →',
              primaryHref: `/listing/${encodeURIComponent(listing.id)}`,
              mapFocusHref: `/explore?focusListing=${encodeURIComponent(listing.id)}`,
              pickNDropHref: `/explore?mode=pick_n_drop&dropoffListingId=${encodeURIComponent(listing.id)}`,
              shareUrl: `/listing/${encodeURIComponent(listing.id)}`,
              sortRank: 24,
            });
          }
        }
      }

      // 3. Events & Tickets (Upcoming scheduled event bulletins)
      if (
        evtRes.status === 'fulfilled' &&
        !evtRes.value.error &&
        Array.isArray(evtRes.value.data)
      ) {
        const nowMs = Date.now();
        for (const raw of evtRes.value.data as Array<Record<string, unknown>>) {
          const id = String(raw.id || '');
          if (!id) continue;
          const expiresRaw =
            typeof raw.expires_at === 'string' ? raw.expires_at : null;
          const expiresMs = expiresRaw ? Date.parse(expiresRaw) : NaN;
          // Exclude clearly expired past events
          if (Number.isFinite(expiresMs) && expiresMs < nowMs) continue;

          const { title, isSample } = splitSamplePrefix(
            String(raw.title || 'Community Event')
          );
          const imgs = Array.isArray(raw.image_urls)
            ? (raw.image_urls as string[]).filter(Boolean)
            : [];
          const eventDateMs = Number.isFinite(expiresMs)
            ? expiresMs
            : Date.parse(String(raw.created_at || '')) || nowMs;
          const formattedDate = new Date(eventDateMs).toLocaleDateString('en-IN', {
            day: 'numeric',
            month: 'short',
            year: 'numeric',
            timeZone: 'Asia/Kolkata',
          });
          const linkedListing =
            typeof raw.linked_listing_id === 'string'
              ? raw.linked_listing_id
              : null;

          nextItems.push({
            id: `evt-${id}`,
            entityId: id,
            kind: 'event',
            tabGroup: 'events',
            title,
            isSample,
            categoryPill: 'Event & RSVP',
            locality: activeHubName,
            routeLine: String(raw.excerpt || `Hosted in ${activeHubName}`),
            priceLabel: 'Open Entry / RSVP',
            numericPrice: 0,
            scheduleLine: `Scheduled · ${formattedDate}`,
            rating: 4.8,
            reviewCount: 0,
            verified: true,
            thumbnailUrl: imgs[0] ? resolveRemoteMediaUrl(imgs[0]) : null,
            primaryCtaLabel: 'Event Details →',
            primaryHref: '/bulletin',
            mapFocusHref: linkedListing
              ? `/explore?focusListing=${encodeURIComponent(linkedListing)}`
              : null,
            pickNDropHref: linkedListing
              ? `/explore?mode=pick_n_drop&dropoffListingId=${encodeURIComponent(linkedListing)}`
              : null,
            shareUrl: '/bulletin',
            dateTimestamp: eventDateMs,
            sortRank: 15,
          });
        }
      }

      setItems(nextItems);
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : 'Unable to load bookings right now.'
      );
    } finally {
      setIsLoading(false);
    }
  }, [activeHubId, activeHubName, hubNameById, moduleSwitches]);

  useEffect(() => {
    void loadBookingsData();
  }, [loadBookingsData]);

  // Tab definitions auto-hidden when module switch is paused
  const availableTabs = useMemo(() => {
    const tabs: Array<{
      id: BookingsHubTab;
      label: string;
      icon: React.ComponentType<{ className?: string }>;
    }> = [
      { id: 'all', label: 'All', icon: Sparkles },
      ...(isHubSwitchActive(moduleSwitches, 'scheduled_vehicles')
        ? [{ id: 'vehicles' as const, label: 'Bus & Vehicles', icon: Car }]
        : []),
      ...(isHubSwitchActive(moduleSwitches, 'booking_venues')
        ? [{ id: 'venues' as const, label: 'Turfs & Venues', icon: Calendar }]
        : []),
      ...(isHubSwitchActive(moduleSwitches, 'hotel_stays')
        ? [{ id: 'stays' as const, label: 'Hotels & Stays', icon: BedDouble }]
        : []),
      { id: 'events', label: 'Events & Tickets', icon: CalendarCheck },
      { id: 'tables', label: 'Tables & Visits', icon: UtensilsCrossed },
    ];
    return tabs;
  }, [moduleSwitches]);

  const tabCounts = useMemo(() => {
    const counts: Record<BookingsHubTab, number> = {
      all: items.length,
      vehicles: 0,
      venues: 0,
      stays: 0,
      events: 0,
      tables: 0,
    };
    for (const item of items) {
      counts[item.tabGroup] += 1;
    }
    return counts;
  }, [items]);

  const localityOptions = useMemo(() => {
    const set = new Set<string>();
    for (const loc of hubLocalities || []) {
      if (loc.display_name) set.add(loc.display_name);
    }
    for (const item of items) {
      if (item.locality) set.add(item.locality);
    }
    return [
      { value: 'all', label: 'All Localities & Routes' },
      ...Array.from(set)
        .sort()
        .map((loc) => ({ value: loc, label: loc })),
    ];
  }, [hubLocalities, items]);

  const sortOptions = [
    { value: 'featured', label: 'Soonest / Featured' },
    { value: 'lowest_price', label: 'Lowest Price' },
    { value: 'top_rated', label: 'Top Rated' },
  ];

  const filteredItems = useMemo(() => {
    const q = debouncedQuery.trim().toLowerCase();
    const matched = items.filter((item) => {
      if (activeTab !== 'all' && item.tabGroup !== activeTab) return false;
      if (
        activeTab === 'vehicles' &&
        vehicleSubFilter !== 'all' &&
        item.vehicleSubType !== vehicleSubFilter
      ) {
        return false;
      }
      if (
        localityFilter !== 'all' &&
        item.locality.toLowerCase() !== localityFilter.toLowerCase() &&
        !(item.routeLine || '').toLowerCase().includes(localityFilter.toLowerCase())
      ) {
        return false;
      }
      if (!matchesQuickDateFilter(item.dateTimestamp, dateFilter)) {
        return false;
      }
      if (q) {
        const hay =
          `${item.title} ${item.categoryPill} ${item.locality} ${item.routeLine || ''} ${item.scheduleLine}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    return [...matched].sort((a, b) => {
      if (sortMode === 'lowest_price') return a.numericPrice - b.numericPrice;
      if (sortMode === 'top_rated') return b.rating - a.rating;
      return a.sortRank - b.sortRank;
    });
  }, [
    items,
    activeTab,
    vehicleSubFilter,
    localityFilter,
    dateFilter,
    debouncedQuery,
    sortMode,
  ]);

  const effectiveTab = availableTabs.some((t) => t.id === activeTab)
    ? activeTab
    : 'all';

  return (
    <main
      data-testid="unified-bookings-hub"
      className="min-h-screen w-full min-w-0 max-w-full overflow-x-clip bg-[var(--ps-bg)] text-[var(--ps-text)] px-3.5 sm:px-6 lg:px-8 pt-4 pb-24 sm:pb-12"
    >
      <div className="mx-auto max-w-6xl space-y-4">
        {/* Compact Responsive Header */}
        <header className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3.5 sm:p-5 shadow-2xs space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2.5">
            <div className="min-w-0 space-y-1">
              <div className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[var(--ps-accent)]">
                <CalendarCheck className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>Unified Bookings Hub</span>
              </div>
              <h1 className="text-lg sm:text-2xl font-extrabold tracking-tight text-[var(--ps-text)] leading-snug break-words">
                Scheduled Bookings in {activeHubName}
              </h1>
              <p className="text-xs text-[var(--ps-text-muted)] line-clamp-2 sm:line-clamp-none">
                Reserve inter-hub buses, Bolero &amp; Sumo seats, turfs, stays, upcoming events, and tables in one place.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-2 shrink-0">
              {Boolean(user?.id) && liveBadges.bookingsActive > 0 && (
                <Link
                  href="/activity?tab=bookings"
                  data-testid="bookings-active-count-pill"
                  className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-3 text-xs font-bold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/15 transition-colors"
                >
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  <span className="tabular-nums">
                    {liveBadges.bookingsActive} Upcoming
                  </span>
                </Link>
              )}

              <Link
                href="/explore"
                data-testid="bookings-switch-map-btn"
                className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] px-3 text-xs font-bold shadow-2xs hover:opacity-95 transition-opacity whitespace-nowrap"
              >
                <Compass className="h-3.5 w-3.5 shrink-0" />
                <span>Switch to Map View →</span>
              </Link>
            </div>
          </div>

          {/* Swipeable Category Tabs with layoutId active pill */}
          <div
            role="tablist"
            aria-label="Bookings categories"
            data-tour="bookings-tabs"
            className="flex items-center gap-1.5 overflow-x-auto flex-nowrap no-scrollbar pb-1"
          >
            {availableTabs.map((tab) => {
              const Icon = tab.icon;
              const isSelected = effectiveTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  data-testid={`bookings-tab-${tab.id}`}
                  onClick={() => setActiveTab(tab.id)}
                  className={`relative h-8.5 px-3 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 shrink-0 whitespace-nowrap transition-colors cursor-pointer ${
                    isSelected
                      ? 'text-[var(--ps-accent-fg)]'
                      : 'border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                  }`}
                >
                  {isSelected && (
                    <motion.span
                      layoutId={
                        prefersReducedMotion ? undefined : 'bookings-hub-active-tab'
                      }
                      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                      className="absolute inset-0 rounded-xl bg-[var(--ps-accent)] shadow-2xs"
                    />
                  )}
                  <Icon className="relative z-10 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span className="relative z-10">{tab.label}</span>
                  <span
                    className={`relative z-10 rounded-full px-1.5 py-0.5 text-[10px] font-extrabold tabular-nums ${
                      isSelected
                        ? 'bg-white/20 text-[var(--ps-accent-fg)]'
                        : 'bg-[var(--ps-surface-alt)] text-[var(--ps-text)]'
                    }`}
                  >
                    {tabCounts[tab.id]}
                  </span>
                </button>
              );
            })}
          </div>
        </header>

        {/* Zero-Overflow Smart Filter Toolbar */}
        <section
          data-tour="bookings-filters"
          className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3 sm:p-4 space-y-2.5 shadow-2xs"
        >
          <div className="w-full min-w-0 flex flex-col sm:flex-row sm:flex-wrap items-stretch sm:items-center gap-2">
            {/* Search input */}
            <div className="relative w-full min-w-0 sm:flex-1 sm:min-w-[200px]">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ps-text-muted)]" />
              <input
                type="search"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Search buses, routes, turfs, stays, events or restaurants…"
                aria-label="Search scheduled bookings"
                data-testid="bookings-search-input"
                className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] pl-8 pr-8 text-xs text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:border-[var(--ps-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-accent)]/20 [&::-webkit-search-cancel-button]:hidden"
              />
              {searchInput && (
                <button
                  type="button"
                  onClick={() => setSearchInput('')}
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 inline-flex h-5 w-5 items-center justify-center rounded-md text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            {/* Route/Locality & Sort CustomSelectModals */}
            <div className="grid grid-cols-2 sm:flex sm:items-center gap-2 w-full sm:w-auto min-w-0">
              <div className="min-w-0 sm:w-48">
                <CustomSelectModal
                  options={localityOptions}
                  value={localityFilter}
                  onChange={setLocalityFilter}
                  label=""
                  placeholder="All Localities"
                  testId="bookings-locality-select"
                />
              </div>
              <div className="min-w-0 sm:w-44">
                <CustomSelectModal
                  options={sortOptions}
                  value={sortMode}
                  onChange={(v) => setSortMode(v as SortMode)}
                  label=""
                  placeholder="Sort by"
                  testId="bookings-sort-select"
                />
              </div>
            </div>
          </div>

          {/* Quick Date Pills + Optional Vehicle Sub-Filters */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
            <div className="flex items-center gap-1.5 overflow-x-auto flex-nowrap no-scrollbar pb-0.5">
              {(
                [
                  { id: 'any', label: 'Any Date' },
                  { id: 'today', label: 'Today' },
                  { id: 'tomorrow', label: 'Tomorrow' },
                  { id: 'weekend', label: 'This Weekend' },
                ] as const
              ).map((pill) => {
                const active = dateFilter === pill.id;
                return (
                  <button
                    key={pill.id}
                    type="button"
                    onClick={() => setDateFilter(pill.id)}
                    className={`h-7 px-2.5 rounded-full text-[11px] font-semibold shrink-0 whitespace-nowrap transition-colors cursor-pointer ${
                      active
                        ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                        : 'border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                    }`}
                  >
                    {pill.label}
                  </button>
                );
              })}
            </div>

            {effectiveTab === 'vehicles' && (
              <div className="flex items-center gap-1.5 overflow-x-auto flex-nowrap no-scrollbar pb-0.5">
                {(
                  [
                    { id: 'all', label: 'All Vehicles' },
                    { id: 'cruiser_sumo', label: 'Cruiser / Sumo' },
                    { id: 'cab_sedan', label: 'Cab / Sedan' },
                    { id: 'mini_van', label: 'Mini-Van / Shifting' },
                    { id: 'two_wheeler', label: '2-Wheeler' },
                  ] as const
                ).map((vt) => {
                  const active = vehicleSubFilter === vt.id;
                  return (
                    <button
                      key={vt.id}
                      type="button"
                      onClick={() => setVehicleSubFilter(vt.id)}
                      className={`h-7 px-2.5 rounded-full text-[11px] font-semibold shrink-0 whitespace-nowrap transition-colors cursor-pointer ${
                        active
                          ? 'bg-sky-600 text-white'
                          : 'border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                      }`}
                    >
                      {vt.label}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </section>

        {/* Results Area */}
        <section data-tour="bookings-cards" className="min-w-0">
          {isLoading ? (
            <BookingsGridSkeleton count={6} />
          ) : errorMessage ? (
            <div className="rounded-2xl border border-rose-500/30 bg-rose-500/8 p-6 text-center space-y-3">
              <p className="text-xs font-semibold text-rose-700 dark:text-rose-300">
                {errorMessage}
              </p>
              <button
                type="button"
                onClick={() => void loadBookingsData()}
                className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3 text-xs font-bold text-[var(--ps-accent-fg)] cursor-pointer"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Retry</span>
              </button>
            </div>
          ) : filteredItems.length === 0 ? (
            <div
              data-testid="bookings-empty-state"
              className="rounded-2xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-surface)] p-8 text-center space-y-3"
            >
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--ps-surface-alt)] text-[var(--ps-accent)]">
                <CalendarCheck className="h-6 w-6" />
              </div>
              <div className="space-y-1">
                <h2 className="text-sm font-extrabold text-[var(--ps-text)]">
                  {effectiveTab === 'events'
                    ? `No upcoming events listed in ${activeHubName} yet`
                    : 'No matching scheduled bookings found'}
                </h2>
                <p className="text-xs text-[var(--ps-text-muted)] max-w-md mx-auto">
                  {effectiveTab === 'events'
                    ? 'Organizing a tournament, concert, workshop, or gathering? Post it to the community bulletin so residents can discover and RSVP.'
                    : 'Try clearing a filter, switching to All categories, or opening the live map directory.'}
                </p>
              </div>
              <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                {effectiveTab === 'events' ? (
                  <Link
                    href="/bulletin"
                    data-testid="bookings-list-event-cta"
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-4 text-xs font-bold text-[var(--ps-accent-fg)] shadow-2xs hover:opacity-95 transition-opacity"
                  >
                    <span>List Your Event →</span>
                  </Link>
                ) : (
                  <button
                    type="button"
                    onClick={() => {
                      setActiveTab('all');
                      setSearchInput('');
                      setLocalityFilter('all');
                      setDateFilter('any');
                      setVehicleSubFilter('all');
                    }}
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-4 text-xs font-bold text-[var(--ps-accent-fg)] cursor-pointer"
                  >
                    <span>Reset All Filters</span>
                  </button>
                )}
              </div>
            </div>
          ) : (
            <motion.div
              initial={prefersReducedMotion ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2 }}
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5"
            >
              {filteredItems.map((item) => {
                const KindIcon =
                  item.kind === 'vehicle'
                    ? Car
                    : item.kind === 'stay'
                      ? BedDouble
                      : item.kind === 'event'
                        ? CalendarCheck
                        : item.kind === 'table'
                          ? UtensilsCrossed
                          : item.kind === 'visit'
                            ? MapPin
                            : Calendar;

                const saved = isSaved(
                  item.kind === 'vehicle' ? 'vehicle' : 'listing',
                  item.entityId
                );

                return (
                  <article
                    key={item.id}
                    data-testid={`booking-card-${item.id}`}
                    className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 flex flex-col justify-between gap-3 shadow-2xs hover:border-[var(--ps-accent)]/50 transition-colors"
                  >
                    <div className="space-y-2.5">
                      <div className="flex items-start gap-3">
                        {item.thumbnailUrl ? (
                          <div className="relative h-16 w-16 rounded-xl overflow-hidden border border-[var(--ps-border)] shrink-0 bg-[var(--ps-surface-alt)]">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={item.thumbnailUrl}
                              alt={item.title}
                              loading="lazy"
                              className="h-full w-full object-cover"
                            />
                          </div>
                        ) : (
                          <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] text-[var(--ps-accent)]">
                            <KindIcon className="h-6 w-6" aria-hidden="true" />
                          </div>
                        )}

                        <div className="min-w-0 flex-1 space-y-1">
                          <div className="flex items-center justify-between gap-1.5">
                            <span className="inline-flex items-center gap-1 rounded-md bg-[var(--ps-surface-alt)] border border-[var(--ps-border)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--ps-text)] truncate">
                              {item.categoryPill}
                            </span>
                            <div className="flex items-center gap-1 shrink-0">
                              {item.verified && (
                                <ShieldCheck
                                  className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400"
                                  aria-label="Verified"
                                />
                              )}
                              {item.rating > 0 && (
                                <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-amber-600 dark:text-amber-400 tabular-nums">
                                  <Star className="h-3 w-3 fill-current" />
                                  {item.rating.toFixed(1)}
                                </span>
                              )}
                            </div>
                          </div>

                          <h2 className="text-sm font-extrabold text-[var(--ps-text)] leading-snug line-clamp-2">
                            {item.title}
                            {item.isSample && (
                              <span className="ml-1.5 inline-flex items-center rounded bg-[var(--ps-surface-alt)] px-1 py-0.2 text-[9px] font-semibold uppercase text-[var(--ps-text-muted)]">
                                Sample
                              </span>
                            )}
                          </h2>

                          <p className="flex items-center gap-1 text-[11px] text-[var(--ps-text-muted)] truncate">
                            <Route className="h-3 w-3 shrink-0 text-[var(--ps-accent)]" />
                            <span className="truncate">
                              {item.routeLine || item.locality}
                            </span>
                          </p>
                        </div>
                      </div>

                      <div className="rounded-xl bg-[var(--ps-bg)] border border-[var(--ps-border)]/80 px-2.5 py-1.5 flex items-center justify-between gap-2 text-[11px]">
                        <span className="font-medium text-[var(--ps-text-muted)] truncate">
                          {item.scheduleLine}
                        </span>
                        <span className="font-extrabold text-[var(--ps-text)] tabular-nums shrink-0 leading-snug pb-0.5">
                          {item.priceLabel}
                        </span>
                      </div>
                    </div>

                    {/* Actions Row: Utility Icons + Zero-Dead-End Primary CTA */}
                    <div className="flex items-center justify-between gap-2 pt-2 border-t border-[var(--ps-border)]/70">
                      <div className="flex items-center gap-1 shrink-0">
                        {item.mapFocusHref && (
                          <Link
                            href={item.mapFocusHref}
                            title="View on Map"
                            aria-label={`View ${item.title} on map`}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text)] hover:border-[var(--ps-accent)] hover:text-[var(--ps-accent)] transition-colors"
                          >
                            <Navigation className="h-3.5 w-3.5" />
                          </Link>
                        )}
                        {item.pickNDropHref && (
                          <Link
                            href={item.pickNDropHref}
                            title="Pick N Drop Here"
                            aria-label={`Book Pick N Drop to ${item.title}`}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-accent)] hover:border-[var(--ps-accent)] hover:bg-[var(--ps-surface-alt)] transition-colors"
                          >
                            <Truck className="h-3.5 w-3.5" />
                          </Link>
                        )}
                        <ShareButton
                          compact
                          title={item.title}
                          text={`${item.title} (${item.priceLabel}) on DD oodle Bookings Hub`}
                          url={item.shareUrl}
                          label={`Share ${item.title}`}
                          testId={`share-booking-${item.id}`}
                          className="h-8 w-8"
                        />
                        {item.kind !== 'event' && (
                          <button
                            type="button"
                            onClick={() =>
                              void toggleSave(
                                item.kind === 'vehicle' ? 'vehicle' : 'listing',
                                item.entityId
                              )
                            }
                            aria-label={saved ? 'Remove bookmark' : 'Save booking'}
                            title={saved ? 'Saved' : 'Save'}
                            className={`inline-flex h-8 w-8 items-center justify-center rounded-lg border transition-colors cursor-pointer ${
                              saved
                                ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)]/12 text-[var(--ps-accent)]'
                                : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                            }`}
                          >
                            <Bookmark
                              className={`h-3.5 w-3.5 ${saved ? 'fill-current' : ''}`}
                            />
                          </button>
                        )}
                      </div>

                      <Link
                        href={item.primaryHref}
                        data-testid={`booking-primary-cta-${item.id}`}
                        className="flex-1 inline-flex h-8 items-center justify-center rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] px-3 text-xs font-bold shadow-2xs hover:opacity-95 transition-opacity whitespace-nowrap"
                      >
                        {item.primaryCtaLabel}
                      </Link>
                    </div>
                  </article>
                );
              })}
            </motion.div>
          )}
        </section>
      </div>
    </main>
  );
}

export default UnifiedBookingsHub;
