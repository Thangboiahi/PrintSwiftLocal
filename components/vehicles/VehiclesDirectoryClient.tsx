'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowLeftRight,
  ArrowRight,
  BedDouble,
  Bookmark,
  Car,
  CheckCircle2,
  MapPin,
  RefreshCw,
  Route,
  Search,
  ShieldCheck,
  Users,
  X,
} from 'lucide-react';
import { useAppConfig } from '@/components/providers/AppConfigProvider';
import { ModulePausedGuard } from '@/components/shared/ModulePausedGuard';
import { useSavedInterests } from '@/lib/hooks/useSavedInterests';
import type {
  VehicleFixedRoute,
  VehicleListingRecord,
} from '@/lib/payments/types';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { resolveRemoteMediaUrl } from '@/lib/supabase/storage';

type VehicleTypeFilter =
  | 'all'
  | 'cruiser_sumo'
  | 'cab_sedan'
  | 'mini_van'
  | 'two_wheeler';

type RouteScopeFilter = 'all' | 'inter_hub' | 'per_seat' | 'full_vehicle';

const VEHICLE_TYPE_PILLS: Array<{ key: VehicleTypeFilter; label: string }> = [
  { key: 'all', label: 'All Vehicles' },
  { key: 'cruiser_sumo', label: 'Cruiser / Sumo' },
  { key: 'cab_sedan', label: 'Cab / Sedan' },
  { key: 'mini_van', label: 'Mini-Van / Shifting' },
  { key: 'two_wheeler', label: '2-Wheeler' },
];

const ROUTE_SCOPE_PILLS: Array<{ key: RouteScopeFilter; label: string }> = [
  { key: 'all', label: 'All Routes' },
  { key: 'inter_hub', label: 'Inter-Hub (CCPur ↔ Aizawl)' },
  { key: 'per_seat', label: 'Per-Seat Booking' },
  { key: 'full_vehicle', label: 'Full Vehicle Hire' },
];

interface EnrichedVehicleItem extends VehicleListingRecord {
  vehicleTypeSlug: string;
  vehicleTypeName: string;
}

function classifyVehicleType(item: EnrichedVehicleItem): VehicleTypeFilter {
  const haystack =
    `${item.vehicleTypeSlug} ${item.vehicleTypeName} ${item.title} ${(item.custom_tags || []).join(' ')}`.toLowerCase();
  if (
    haystack.includes('two_wheeler') ||
    haystack.includes('scooter') ||
    haystack.includes('bike') ||
    haystack.includes('2-wheeler') ||
    haystack.includes('activa')
  ) {
    return 'two_wheeler';
  }
  if (
    haystack.includes('mini_van') ||
    haystack.includes('pickup') ||
    haystack.includes('cargo') ||
    haystack.includes('shifting') ||
    haystack.includes('van') ||
    haystack.includes('bolero')
  ) {
    return 'mini_van';
  }
  if (
    haystack.includes('sumo') ||
    haystack.includes('cruiser') ||
    haystack.includes('suv') ||
    haystack.includes('force') ||
    item.total_seats >= 7
  ) {
    return 'cruiser_sumo';
  }
  return 'cab_sedan';
}

function formatStartingPrice(item: EnrichedVehicleItem): string {
  const routes = Array.isArray(item.fixed_routes) ? item.fixed_routes : [];
  if (routes.length > 0) {
    const minFare = Math.min(
      ...routes
        .map((r) => Number(r.fare_inr || 0))
        .filter((n) => Number.isFinite(n) && n > 0)
    );
    if (Number.isFinite(minFare) && minFare > 0) {
      return `From ₹${minFare.toLocaleString('en-IN')}${item.booking_mode === 'per_seat' ? '/seat' : '/trip'}`;
    }
  }
  if (item.rate_daily_inr && item.rate_daily_inr > 0) {
    return `₹${Number(item.rate_daily_inr).toLocaleString('en-IN')}/day`;
  }
  if (item.rate_hourly_inr && item.rate_hourly_inr > 0) {
    return `₹${Number(item.rate_hourly_inr).toLocaleString('en-IN')}/hr`;
  }
  if (item.rate_per_km_inr && item.rate_per_km_inr > 0) {
    return `₹${Number(item.rate_per_km_inr).toLocaleString('en-IN')}/km`;
  }
  return 'Call for fare';
}

export function VehiclesDirectoryClient() {
  const { activeHub, hubs } = useAppConfig();
  const activeHubId = activeHub?.id || '';
  const activeHubName = activeHub?.name || 'Churachandpur';
  const activeHubSlug = activeHub?.slug || 'churachandpur';
  const { isSaved, toggleSave } = useSavedInterests();

  const [vehicles, setVehicles] = useState<EnrichedVehicleItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<VehicleTypeFilter>('all');
  const [scopeFilter, setScopeFilter] = useState<RouteScopeFilter>('all');

  const hubNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const h of hubs) {
      map.set(h.id, h.name);
    }
    return map;
  }, [hubs]);

  const loadVehicles = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      if (!isSupabaseConfigured()) {
        setVehicles([]);
        return;
      }

      const { data, error } = await supabase
        .from('vehicle_listings')
        .select('*, vehicle_types(slug, name)')
        .eq('is_active', true)
        .order('is_verified', { ascending: false })
        .order('created_at', { ascending: false })
        .limit(80);

      if (error) {
        throw new Error(error.message || 'Unable to load scheduled vehicles.');
      }

      const mapped: EnrichedVehicleItem[] = (
        (data || []) as Array<Record<string, unknown>>
      ).map((row) => {
        const vtJoin = Array.isArray(row.vehicle_types)
          ? (row.vehicle_types[0] as Record<string, unknown> | undefined)
          : (row.vehicle_types as Record<string, unknown> | undefined);

        const fixedRoutes = Array.isArray(row.fixed_routes)
          ? (row.fixed_routes as VehicleFixedRoute[])
          : [];

        return {
          id: String(row.id || ''),
          origin_hub_id:
            typeof row.origin_hub_id === 'string' ? row.origin_hub_id : null,
          destination_hub_ids: Array.isArray(row.destination_hub_ids)
            ? (row.destination_hub_ids as string[])
            : [],
          category_id:
            typeof row.category_id === 'string' ? row.category_id : null,
          locality_id:
            typeof row.locality_id === 'string' ? row.locality_id : null,
          custom_tags: Array.isArray(row.custom_tags)
            ? (row.custom_tags as string[])
            : [],
          vehicle_id:
            typeof row.vehicle_id === 'string' ? row.vehicle_id : null,
          owner_id: String(row.owner_id || ''),
          driver_id: typeof row.driver_id === 'string' ? row.driver_id : null,
          vehicle_type_id: String(row.vehicle_type_id || ''),
          title: String(row.title || 'Scheduled Vehicle'),
          description:
            typeof row.description === 'string' ? row.description : null,
          stand_locality: String(row.stand_locality || activeHubName),
          lat: Number(row.lat ?? 0),
          lng: Number(row.lng ?? 0),
          booking_mode:
            row.booking_mode === 'per_seat'
              ? 'per_seat'
              : row.booking_mode === 'both'
                ? 'both'
                : 'full_vehicle',
          total_seats: Number(row.total_seats ?? 4),
          pricing_model: (String(
            row.pricing_model || 'daily'
          ) as VehicleListingRecord['pricing_model']),
          rate_hourly_inr:
            row.rate_hourly_inr !== null && row.rate_hourly_inr !== undefined
              ? Number(row.rate_hourly_inr)
              : null,
          rate_daily_inr:
            row.rate_daily_inr !== null && row.rate_daily_inr !== undefined
              ? Number(row.rate_daily_inr)
              : null,
          rate_per_km_inr:
            row.rate_per_km_inr !== null && row.rate_per_km_inr !== undefined
              ? Number(row.rate_per_km_inr)
              : null,
          fixed_routes: fixedRoutes,
          advance_percent: Number(row.advance_percent ?? 20),
          with_driver: row.with_driver !== false,
          features: Array.isArray(row.features)
            ? (row.features as string[])
            : [],
          thumbnail_url:
            typeof row.thumbnail_url === 'string'
              ? resolveRemoteMediaUrl(row.thumbnail_url)
              : null,
          image_urls: Array.isArray(row.image_urls)
            ? (row.image_urls as string[]).map((u) => resolveRemoteMediaUrl(u))
            : [],
          panorama_url:
            typeof row.panorama_url === 'string' ? row.panorama_url : null,
          is_active: row.is_active !== false,
          is_verified: Boolean(row.is_verified),
          created_at: String(row.created_at || ''),
          updated_at: String(row.updated_at || ''),
          vehicleTypeSlug: String(vtJoin?.slug || ''),
          vehicleTypeName: String(vtJoin?.name || 'Vehicle'),
        };
      });

      setVehicles(mapped);
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Could not load scheduled vehicles.'
      );
    } finally {
      setIsLoading(false);
    }
  }, [activeHubName]);

  useEffect(() => {
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (!cancelled) {
        void loadVehicles();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [loadVehicles]);

  // Pass V11-A: Hydrate ?type=, ?scope=, ?q= query params on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;
    let cancelled = false;
    void Promise.resolve().then(() => {
      if (cancelled) return;
      const params = new URLSearchParams(window.location.search);
      const t = params.get('type')?.trim().toLowerCase();
      if (
        t === 'all' ||
        t === 'cruiser_sumo' ||
        t === 'cab_sedan' ||
        t === 'mini_van' ||
        t === 'two_wheeler'
      ) {
        setTypeFilter(t);
      }
      const sc = params.get('scope')?.trim().toLowerCase();
      if (
        sc === 'all' ||
        sc === 'inter_hub' ||
        sc === 'per_seat' ||
        sc === 'full_vehicle'
      ) {
        setScopeFilter(sc);
      }
      const q = params.get('q')?.trim();
      if (q) {
        setSearchQuery(q);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const filteredVehicles = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return vehicles.filter((item) => {
      // Hub scoping: match origin_hub_id OR destination_hub_ids (inter-hub rides always surface in both hubs!)
      if (activeHubId && !activeHubId.startsWith('fallback-')) {
        const destIds = item.destination_hub_ids || [];
        const matchesOrigin =
          !item.origin_hub_id || item.origin_hub_id === activeHubId;
        const matchesDest = destIds.includes(activeHubId);
        if (!matchesOrigin && !matchesDest) {
          return false;
        }
      }

      if (typeFilter !== 'all' && classifyVehicleType(item) !== typeFilter) {
        return false;
      }

      if (scopeFilter === 'inter_hub') {
        const destIds = item.destination_hub_ids || [];
        const hasCrossHub =
          destIds.some((id) => id && id !== item.origin_hub_id) ||
          (item.fixed_routes || []).some((r) =>
            /(aizawl|imphal|ccpur|churachandpur|silchar)/i.test(
              `${r.origin} ${r.destination}`
            )
          );
        if (!hasCrossHub) return false;
      } else if (
        scopeFilter === 'per_seat' &&
        item.booking_mode !== 'per_seat' &&
        item.booking_mode !== 'both'
      ) {
        return false;
      } else if (
        scopeFilter === 'full_vehicle' &&
        item.booking_mode !== 'full_vehicle' &&
        item.booking_mode !== 'both'
      ) {
        return false;
      }

      if (q) {
        const routeText = (item.fixed_routes || [])
          .map((r) => `${r.origin} ${r.destination}`)
          .join(' ');
        const haystack =
          `${item.title} ${item.stand_locality} ${item.vehicleTypeName} ${item.description || ''} ${routeText} ${(item.features || []).join(' ')}`.toLowerCase();
        if (!haystack.includes(q)) return false;
      }

      return true;
    });
  }, [vehicles, activeHubId, typeFilter, scopeFilter, searchQuery]);

  return (
    <ModulePausedGuard module="vehicle_bookings">
      <div
        data-testid="vehicles-directory-page"
        className="mx-auto w-full max-w-6xl px-4 sm:px-6 py-5 sm:py-6 space-y-5 bg-[var(--ps-bg)] text-[var(--ps-text)]"
      >
        {/* Header & Search */}
        <section className="space-y-3 border-b border-[var(--ps-border)] pb-4">
          <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
            <div className="space-y-1 min-w-0">
              <div className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-[11px] font-bold bg-[var(--ps-accent)]/12 text-[var(--ps-accent)] border border-[var(--ps-accent)]/25">
                <ArrowLeftRight className="w-3 h-3" aria-hidden="true" />
                <span>Scheduled Rides &amp; Inter-Hub Fleet</span>
              </div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[var(--ps-text)] flex items-center gap-2">
                <Car className="w-5 h-5 text-[var(--ps-accent)] shrink-0" aria-hidden="true" />
                <span>{activeHubName} Vehicles &amp; Inter-Hub Rides</span>
              </h1>
              <p className="text-xs sm:text-sm text-[var(--ps-text-muted)]">
                Book Sumo/Cruiser seats, private cabs, shifting mini-vans, and inter-hub transfers across Churachandpur &amp; Aizawl.
              </p>
            </div>

            <div className="relative w-full sm:w-72 md:w-80 shrink-0">
              <Search
                className="w-4 h-4 text-[var(--ps-text-muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
                aria-hidden="true"
              />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search Sumo, Aizawl route, cab, stand..."
                aria-label="Search scheduled vehicles"
                data-testid="vehicles-search-input"
                className="w-full h-9 pl-9 pr-8 rounded-xl bg-[var(--ps-surface)] border border-[var(--ps-border)] text-sm text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-ring)]"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery('')}
                  aria-label="Clear vehicle search"
                  className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-md inline-flex items-center justify-center text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]"
                >
                  <X className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
              )}
            </div>
          </div>

          {/* Vehicle Type Filter Pills */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
            {VEHICLE_TYPE_PILLS.map((pill) => {
              const isActive = typeFilter === pill.key;
              return (
                <button
                  key={pill.key}
                  type="button"
                  onClick={() => setTypeFilter(pill.key)}
                  className={`h-8 px-3 rounded-full text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-2xs'
                      : 'bg-[var(--ps-surface)] text-[var(--ps-text-muted)] border border-[var(--ps-border)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                  }`}
                >
                  {pill.label}
                </button>
              );
            })}
          </div>

          {/* Route Scope Sub-Strip */}
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
            {ROUTE_SCOPE_PILLS.map((pill) => {
              const isActive = scopeFilter === pill.key;
              return (
                <button
                  key={pill.key}
                  type="button"
                  onClick={() => setScopeFilter(pill.key)}
                  className={`h-7 px-2.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-[var(--ps-accent)]/15 text-[var(--ps-accent)] border border-[var(--ps-accent)]/40'
                      : 'bg-[var(--ps-surface)] text-[var(--ps-text-muted)] border border-[var(--ps-border)] hover:text-[var(--ps-text)]'
                  }`}
                >
                  {pill.label}
                </button>
              );
            })}
          </div>
        </section>

        {/* Contextual Traveler Tip -> Hotel & Stays */}
        <div className="rounded-xl border border-indigo-500/25 bg-indigo-500/8 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="flex items-center gap-2 text-[var(--ps-text)]">
            <BedDouble
              className="w-4 h-4 text-indigo-500 shrink-0"
              aria-hidden="true"
            />
            <span>
              <strong className="font-semibold">Travelling inter-hub?</strong>{' '}
              Need a verified hotel, guesthouse, or homestay in {activeHubName} or Aizawl?
            </span>
          </div>
          <Link
            href={`/explore?hub=${encodeURIComponent(activeHubSlug)}&vertical=hotel_stay`}
            data-testid="vehicles-stay-tip-link"
            className="inline-flex items-center gap-1 font-bold text-indigo-600 dark:text-indigo-400 hover:underline whitespace-nowrap"
          >
            <span>Browse Stays &amp; Hotels</span>
            <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
          </Link>
        </div>

        {/* Vehicles Grid */}
        {isLoading ? (
          <div
            data-testid="vehicles-directory-shimmer"
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4"
          >
            {Array.from({ length: 6 }).map((_, idx) => (
              <div
                key={idx}
                className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] overflow-hidden"
              >
                <div className="dd-shimmer aspect-[16/10] w-full" />
                <div className="p-4 space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="space-y-1.5 flex-1">
                      <div className="dd-shimmer h-4 w-3/4 rounded" />
                      <div className="dd-shimmer h-3 w-1/2 rounded" />
                    </div>
                    <div className="dd-shimmer h-5 w-20 rounded" />
                  </div>
                  <div className="flex gap-1.5">
                    <div className="dd-shimmer h-5 w-16 rounded-md" />
                    <div className="dd-shimmer h-5 w-20 rounded-md" />
                    <div className="dd-shimmer h-5 w-20 rounded-md" />
                  </div>
                  <div className="dd-shimmer h-11 w-full rounded-xl" />
                </div>
              </div>
            ))}
          </div>
        ) : errorMessage && filteredVehicles.length === 0 ? (
          <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-8 text-center space-y-3">
            <p className="text-sm font-semibold text-[var(--ps-text)]">
              {errorMessage}
            </p>
            <button
              type="button"
              onClick={() => void loadVehicles()}
              className="min-h-[44px] px-4 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-bold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Retry</span>
            </button>
          </div>
        ) : filteredVehicles.length === 0 ? (
          <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-8 text-center space-y-2">
            <p className="text-sm font-semibold text-[var(--ps-text)]">
              No vehicles match your current filters in {activeHubName}.
            </p>
            <p className="text-xs text-[var(--ps-text-muted)]">
              Try switching to All Vehicles or All Routes.
            </p>
            {(searchQuery || typeFilter !== 'all' || scopeFilter !== 'all') && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setTypeFilter('all');
                  setScopeFilter('all');
                }}
                className="mt-2 h-8 px-3.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]"
              >
                Reset Filters
              </button>
            )}
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {filteredVehicles.map((item) => {
              const saved = isSaved('vehicle', item.id);
              const cover =
                item.thumbnail_url || item.image_urls[0] || '';
              const destNames = (item.destination_hub_ids || [])
                .filter((id) => id && id !== item.origin_hub_id)
                .map((id) => hubNameById.get(id))
                .filter(Boolean);
              const originName = item.origin_hub_id
                ? hubNameById.get(item.origin_hub_id) || activeHubName
                : activeHubName;

              return (
                <article
                  key={item.id}
                  data-testid={`vehicle-card-${item.id}`}
                  className="group rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] overflow-hidden flex flex-col justify-between shadow-2xs hover:border-[var(--ps-accent)]/50 transition-colors"
                >
                  <div>
                    <div className="relative aspect-[16/10] w-full bg-[var(--ps-surface-alt)] overflow-hidden border-b border-[var(--ps-border)]/70">
                      {cover ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={cover}
                          alt={item.title}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
                        />
                      ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center gap-1.5 text-[var(--ps-text-muted)]">
                          <Car className="w-8 h-8 opacity-60" aria-hidden="true" />
                          <span className="text-[11px] font-medium">
                            {item.vehicleTypeName}
                          </span>
                        </div>
                      )}

                      <div className="absolute top-2.5 left-2.5 flex flex-wrap items-center gap-1.5">
                        {item.is_verified && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-600/95 text-white shadow-xs">
                            <ShieldCheck className="w-3 h-3" aria-hidden="true" />
                            <span>Verified</span>
                          </span>
                        )}
                        {destNames.length > 0 && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-600/95 text-white shadow-xs">
                            <Route className="w-3 h-3" aria-hidden="true" />
                            <span>
                              {originName} ↔ {destNames[0]}
                            </span>
                          </span>
                        )}
                      </div>

                      <button
                        type="button"
                        onClick={() => void toggleSave('vehicle', item.id)}
                        aria-label={
                          saved ? 'Remove saved vehicle' : 'Save vehicle'
                        }
                        className={`absolute top-2.5 right-2.5 w-8 h-8 rounded-full flex items-center justify-center border backdrop-blur-sm transition-colors cursor-pointer ${
                          saved
                            ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] border-[var(--ps-accent)]'
                            : 'bg-black/45 text-white border-white/25 hover:bg-black/65'
                        }`}
                      >
                        <Bookmark
                          className={`w-3.5 h-3.5 ${saved ? 'fill-current' : ''}`}
                          aria-hidden="true"
                        />
                      </button>
                    </div>

                    <div className="p-3.5 space-y-2">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <h2 className="text-sm font-bold text-[var(--ps-text)] truncate">
                            {item.title}
                          </h2>
                          <p className="text-[11px] text-[var(--ps-text-muted)] flex items-center gap-1 mt-0.5 truncate">
                            <MapPin className="w-3 h-3 shrink-0" aria-hidden="true" />
                            <span className="truncate">{item.stand_locality}</span>
                          </p>
                        </div>
                        <div className="text-right shrink-0">
                          <div className="text-xs font-extrabold text-[var(--ps-accent)] tabular-nums">
                            {formatStartingPrice(item)}
                          </div>
                          <div className="text-[10px] font-semibold text-[var(--ps-text-muted)]">
                            {item.booking_mode === 'both'
                              ? 'Seat / Full Vehicle'
                              : item.booking_mode === 'per_seat'
                                ? 'Per-Seat Booking'
                                : 'Full-Vehicle Hire'}
                          </div>
                        </div>
                      </div>

                      {/* Transparent Per-Seat vs Full-Vehicle Rates & Advance % Strip */}
                      <div className="grid grid-cols-2 gap-1.5 rounded-xl border border-[var(--ps-border)]/70 bg-[var(--ps-bg)] px-2.5 py-2 text-[10.5px]">
                        <div>
                          <div className="text-[var(--ps-text-muted)]">
                            {item.booking_mode === 'per_seat' ||
                            item.booking_mode === 'both'
                              ? 'Seat / Full Vehicle'
                              : 'Hire Rate'}
                          </div>
                          <div className="font-bold text-[var(--ps-text)] tabular-nums truncate">
                            {item.rate_daily_inr
                              ? `₹${Number(item.rate_daily_inr).toLocaleString('en-IN')}/day`
                              : item.rate_hourly_inr
                                ? `₹${Number(item.rate_hourly_inr).toLocaleString('en-IN')}/hr`
                                : item.rate_per_km_inr
                                  ? `₹${Number(item.rate_per_km_inr).toLocaleString('en-IN')}/km`
                                  : formatStartingPrice(item)}
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-[var(--ps-text-muted)]">
                            Escrow Advance
                          </div>
                          <div className="font-extrabold text-emerald-700 dark:text-emerald-300 tabular-nums">
                            {Math.max(0, Number(item.advance_percent ?? 20))}% to hold
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--ps-text-muted)]">
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--ps-surface-alt)] border border-[var(--ps-border)]/70">
                          <Users className="w-3 h-3" aria-hidden="true" />
                          <span>{item.total_seats} seats</span>
                        </span>
                        {item.with_driver && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--ps-surface-alt)] border border-[var(--ps-border)]/70">
                            <CheckCircle2
                              className="w-3 h-3 text-emerald-500"
                              aria-hidden="true"
                            />
                            <span>With Driver</span>
                          </span>
                        )}
                        <span className="px-2 py-0.5 rounded-md bg-[var(--ps-surface-alt)] border border-[var(--ps-border)]/70">
                          {item.vehicleTypeName}
                        </span>
                      </div>

                      {item.fixed_routes && item.fixed_routes.length > 0 && (
                        <div className="pt-1 border-t border-[var(--ps-border)]/60 text-[11px] text-[var(--ps-text-muted)] truncate">
                          <span className="font-semibold text-[var(--ps-text)]">
                            Routes:{' '}
                          </span>
                          {item.fixed_routes
                            .slice(0, 2)
                            .map((r) => `${r.origin} → ${r.destination}`)
                            .join(' · ')}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="px-3.5 pb-3.5 pt-1">
                    <Link
                      href={`/vehicles/${encodeURIComponent(item.id)}`}
                      className="w-full min-h-[44px] rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-bold inline-flex items-center justify-center gap-1.5 hover:opacity-95 transition-opacity"
                    >
                      <span>View Schedule &amp; Book</span>
                      <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </div>
    </ModulePausedGuard>
  );
}

export default VehiclesDirectoryClient;
