'use client';

import React, { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import {
  AlertTriangle,
  ArrowRight,
  BedDouble,
  Building2,
  Calendar,
  Car,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Clock,
  Compass,
  Droplets,
  Flame,
  Gift,
  HeartPulse,
  Home,
  Landmark,
  MapPin,
  Megaphone,
  Package,
  Phone,
  Printer,
  Route,
  Search,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Store,
  Truck,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import { formatIndianPropertyPrice } from '@/lib/real-estate/helpers';
import {
  ROUTES,
  buildExploreRoute,
  buildListingRoute,
} from '@/lib/routes';
import { trackAppEvent } from '@/lib/analytics/track';
import { getIconByKey } from '@/lib/icons/registry';
import {
  DEFAULT_HOMEPAGE_CONTAINERS,
  buildPopularLocalityExploreHref,
  inferDefaultContainerSlugForItem,
  resolveHomepageItemHref,
  type HomepageContainerRecord,
  type HomepageItemRecord,
  type PopularLocalityRecord,
} from '@/lib/home/homepage-config';
import type {
  LandingCivicAlertItem,
  LandingCivicHighlightItem,
  LandingDishPreviewItem,
  LandingFoodShopItem,
  LandingRealEstateItem,
  LandingVenueStayItem,
} from '@/lib/home/landing-types';
import type {
  LandingListingPreview,
  LandingMarketPreview,
} from '@/components/home/LandingClient';

export type HubModuleSwitchesMap = Partial<
  Record<string, boolean | { enabled?: boolean } | undefined>
>;

export function isHubModuleEnabled(
  switches: HubModuleSwitchesMap | undefined,
  key?: string
): boolean {
  if (!key || !switches) return true;
  const raw = switches[key];
  if (raw === false) return false;
  if (raw && typeof raw === 'object' && raw.enabled === false) return false;
  return true;
}

type DeckCategoryFilter =
  | 'all'
  | 'daily_orders'
  | 'explore_book'
  | 'mobility_civic'
  | 'community_earn';

const DECK_FILTER_TABS: Array<{ id: DeckCategoryFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'daily_orders', label: 'Daily & Orders' },
  { id: 'explore_book', label: 'Explore & Book' },
  { id: 'mobility_civic', label: 'Mobility & Civic' },
  { id: 'community_earn', label: 'Community & Earn' },
];

const SERVICE_LAUNCHER_TILES: Array<{
  id: string;
  label: string;
  subtitle: string;
  href: string;
  icon: typeof Compass;
  tone: string;
  deckGroup: Exclude<DeckCategoryFilter, 'all'>;
  moduleKey?: string;
  requiresAuth?: boolean;
}> = [
  {
    id: 'explore',
    label: 'Explore Map',
    subtitle: 'Live directory',
    href: '/explore',
    icon: Compass,
    tone: 'bg-sky-500/12 text-sky-600 dark:text-sky-400',
    deckGroup: 'explore_book',
  },
  {
    id: 'pick_n_drop_parcel',
    label: 'Send a Parcel',
    subtitle: 'Same-day courier',
    href: '/explore?mode=pick_n_drop&serviceType=parcel',
    icon: Package,
    tone: 'bg-amber-500/12 text-amber-600 dark:text-amber-400',
    deckGroup: 'daily_orders',
    moduleKey: 'pick_n_drop',
  },
  {
    id: 'pick_n_drop_ride',
    label: 'Local Ride / Auto',
    subtitle: 'Instant pickup',
    href: '/explore?mode=pick_n_drop&serviceType=ride',
    icon: Truck,
    tone: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400',
    deckGroup: 'mobility_civic',
    moduleKey: 'pick_n_drop',
  },
  {
    id: 'pick_n_drop_lpg',
    label: 'LPG Gas Delivery',
    subtitle: 'Refill & return',
    href: '/explore?mode=pick_n_drop&serviceType=lpg',
    icon: Flame,
    tone: 'bg-rose-500/12 text-rose-600 dark:text-rose-400',
    deckGroup: 'daily_orders',
    moduleKey: 'pick_n_drop',
  },
  {
    id: 'print_digital',
    label: 'Print & Digital',
    subtitle: 'Upload & print',
    href: '/explore?vertical=print_digital',
    icon: Printer,
    tone: 'bg-teal-500/12 text-teal-600 dark:text-teal-400',
    deckGroup: 'daily_orders',
    moduleKey: 'print_orders',
  },
  {
    id: 'restaurant_food',
    label: 'Food & Cafés',
    subtitle: 'Hot delivery',
    href: '/explore?vertical=restaurant_food',
    icon: UtensilsCrossed,
    tone: 'bg-orange-500/12 text-orange-600 dark:text-orange-400',
    deckGroup: 'daily_orders',
    moduleKey: 'food_orders',
  },
  {
    id: 'shop_catalogue',
    label: 'Daily Shops',
    subtitle: 'Live stock',
    href: '/marketplace?tab=products',
    icon: ShoppingBag,
    tone: 'bg-blue-500/12 text-blue-600 dark:text-blue-400',
    deckGroup: 'daily_orders',
    moduleKey: 'shop_orders',
  },
  {
    id: 'booking_venue',
    label: 'Turfs & Halls',
    subtitle: 'Book slots',
    href: '/bookings?tab=venues',
    icon: Calendar,
    tone: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400',
    deckGroup: 'explore_book',
    moduleKey: 'booking_venues',
  },
  {
    id: 'hotel_stay',
    label: 'Hotels & Stays',
    subtitle: 'Verified rooms',
    href: '/bookings?tab=stays',
    icon: BedDouble,
    tone: 'bg-indigo-500/12 text-indigo-600 dark:text-indigo-400',
    deckGroup: 'explore_book',
    moduleKey: 'hotel_stays',
  },
  {
    id: 'real_estate',
    label: 'Real Estate',
    subtitle: 'Rent & sale',
    href: '/explore?vertical=real_estate',
    icon: Home,
    tone: 'bg-violet-500/12 text-violet-600 dark:text-violet-400',
    deckGroup: 'explore_book',
    moduleKey: 'real_estate',
  },
  {
    id: 'inter_hub_vehicles',
    label: 'Inter-Hub Rides',
    subtitle: 'Seat & charter',
    href: '/bookings?tab=vehicles',
    icon: Car,
    tone: 'bg-cyan-500/12 text-cyan-600 dark:text-cyan-400',
    deckGroup: 'mobility_civic',
    moduleKey: 'scheduled_vehicles',
  },
  {
    id: 'civic_directory',
    label: 'Civic & Helplines',
    subtitle: 'Public services',
    href: '/civic',
    icon: Landmark,
    tone: 'bg-slate-500/12 text-slate-700 dark:text-slate-300',
    deckGroup: 'mobility_civic',
  },
  {
    id: 'community_bulletin',
    label: 'Community Bulletin',
    subtitle: 'Local notices',
    href: '/bulletin',
    icon: Megaphone,
    tone: 'bg-fuchsia-500/12 text-fuchsia-600 dark:text-fuchsia-400',
    deckGroup: 'community_earn',
  },
  {
    id: 'hospitals_24x7',
    label: '24×7 Hospitals',
    subtitle: 'Emergency care',
    href: '/civic?category=emergency_medical&open247=1',
    icon: HeartPulse,
    tone: 'bg-rose-500/12 text-rose-600 dark:text-rose-400',
    deckGroup: 'mobility_civic',
  },
  {
    id: 'patta_verified',
    label: 'Patta Verified Land',
    subtitle: 'Verified plots',
    href: '/explore?vertical=real_estate&attr=patta_verified',
    icon: ShieldCheck,
    tone: 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-400',
    deckGroup: 'explore_book',
    moduleKey: 'real_estate',
  },
  {
    id: 'refer_earn',
    label: 'Refer & Earn',
    subtitle: 'Invite rewards',
    href: '/profile#referrals',
    icon: Gift,
    tone: 'bg-amber-500/12 text-amber-600 dark:text-amber-400',
    deckGroup: 'community_earn',
    requiresAuth: true,
  },
];

const PREFILLED_INTENT_SHORTCUTS: Array<{
  label: string;
  href: string;
}> = [
  {
    label: 'Pure Veg Food',
    href: buildExploreRoute({ vertical: 'restaurant_food', attr: 'pure_veg' }),
  },
  {
    label: 'Print + Delivery',
    href: buildExploreRoute({ vertical: 'print_digital', attr: 'order_online' }),
  },
  {
    label: 'Homes for Rent',
    href: buildExploreRoute({ vertical: 'real_estate', attr: 'rent' }),
  },
  {
    label: 'Table Booking',
    href: `${ROUTES.bookings}?tab=tables`,
  },
  {
    label: 'Shifting Mini-Van',
    href: `${ROUTES.bookings}?tab=vehicles&type=mini_van`,
  },
  {
    label: 'Govt Checklists',
    href: `${ROUTES.civic}?category=government_office`,
  },
  {
    label: 'Evening Turf',
    href: buildExploreRoute({ vertical: 'booking_venue', attr: 'hourly' }),
  },
];

const VERTICAL_SEARCH_TERMS = [
  { label: 'Print & Digital Shops', href: buildExploreRoute({ vertical: 'print_digital' }) },
  { label: 'Food & Cafés', href: buildExploreRoute({ vertical: 'restaurant_food' }) },
  { label: 'Local Daily Shops', href: ROUTES.marketplace },
  { label: 'Turfs & Community Halls', href: buildExploreRoute({ vertical: 'booking_venue' }) },
  { label: 'Hotels & Homestays', href: buildExploreRoute({ vertical: 'hotel_stay' }) },
  { label: 'Real Estate & Rentals', href: buildExploreRoute({ vertical: 'real_estate' }) },
  { label: 'Scheduled Vehicles & Rides', href: ROUTES.vehicles },
  { label: 'Emergency & Public Helplines', href: ROUTES.civic },
];

export interface HeroAutosuggestSearchProps {
  query: string;
  onQueryChange: (val: string) => void;
  placeholder: string;
  activeHubName: string;
  localities: string[];
  places: LandingListingPreview[];
  foodAndShops: LandingFoodShopItem[];
  venuesAndStays: LandingVenueStayItem[];
  realEstate: LandingRealEstateItem[];
  civicHighlights: LandingCivicHighlightItem[];
  products: LandingMarketPreview[];
  dishes: LandingDishPreviewItem[];
  onSubmitSearch: (e: React.FormEvent) => void;
}

export function HeroAutosuggestSearch({
  query,
  onQueryChange,
  placeholder,
  activeHubName,
  localities,
  places,
  foodAndShops,
  venuesAndStays,
  realEstate,
  civicHighlights,
  products,
  dishes,
  onSubmitSearch,
}: HeroAutosuggestSearchProps) {
  const router = useRouter();
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const trimmed = query.trim().toLowerCase();

  const groupedMatches = useMemo(() => {
    if (!trimmed) {
      return {
        places: [] as Array<{
          id: string;
          title: string;
          subtitle: string;
          href: string;
          badge?: string;
        }>,
        civic: [] as LandingCivicHighlightItem[],
        productsAndDishes: [] as Array<{
          id: string;
          title: string;
          subtitle: string;
          href: string;
          priceLabel: string;
        }>,
        localitiesAndVerticals: [] as Array<{ label: string; href: string }>,
      };
    }

    const placePool: Array<{
      id: string;
      title: string;
      subtitle: string;
      href: string;
      badge?: string;
    }> = [];
    const seenPlaceIds = new Set<string>();

    for (const item of foodAndShops) {
      if (
        `${item.title} ${item.locality} ${item.vertical}`
          .toLowerCase()
          .includes(trimmed)
      ) {
        seenPlaceIds.add(item.id);
        placePool.push({
          id: item.id,
          title: item.title,
          subtitle: item.locality,
          href: buildListingRoute(item.id),
          badge: item.vertical === 'restaurant_food' ? 'Menu' : 'Store',
        });
      }
    }
    for (const item of venuesAndStays) {
      if (
        !seenPlaceIds.has(item.id) &&
        `${item.title} ${item.locality} ${item.vertical}`
          .toLowerCase()
          .includes(trimmed)
      ) {
        seenPlaceIds.add(item.id);
        placePool.push({
          id: item.id,
          title: item.title,
          subtitle: item.locality,
          href:
            item.vertical === 'booking_venue'
              ? `${buildListingRoute(item.id)}/book`
              : buildListingRoute(item.id),
          badge: item.vertical === 'booking_venue' ? 'Book Slot' : 'Stay',
        });
      }
    }
    for (const item of realEstate) {
      if (
        !seenPlaceIds.has(item.id) &&
        `${item.title} ${item.locality} ${item.transactionType} real estate property rent sale patta`
          .toLowerCase()
          .includes(trimmed)
      ) {
        seenPlaceIds.add(item.id);
        placePool.push({
          id: item.id,
          title: item.title,
          subtitle: item.locality,
          href: buildListingRoute(item.id),
          badge: formatIndianPropertyPrice(item.priceInr, item.pricePeriod),
        });
      }
    }
    for (const item of places) {
      if (
        !seenPlaceIds.has(item.id) &&
        `${item.title} ${item.locality} ${item.category} ${item.subcategory}`
          .toLowerCase()
          .includes(trimmed)
      ) {
        seenPlaceIds.add(item.id);
        placePool.push({
          id: item.id,
          title: item.title,
          subtitle: item.locality,
          href: buildListingRoute(item.id),
        });
      }
    }

    const civicMatches = civicHighlights
      .filter((c) =>
        `${c.title} ${c.locality} ${c.departmentType} ${c.primaryPhone || ''} hospital police emergency govt`
          .toLowerCase()
          .includes(trimmed)
      )
      .slice(0, 3);

    const prodAndDishMatches: Array<{
      id: string;
      title: string;
      subtitle: string;
      href: string;
      priceLabel: string;
    }> = [];

    for (const d of dishes) {
      if (
        `${d.name} ${d.restaurantName} ${d.dietaryType}`
          .toLowerCase()
          .includes(trimmed)
      ) {
        prodAndDishMatches.push({
          id: `dish-${d.id}`,
          title: d.name,
          subtitle: d.restaurantName,
          href: `/listing/${encodeURIComponent(d.listingId)}`,
          priceLabel: `₹${Math.round(d.priceInr)}`,
        });
      }
    }
    for (const p of products) {
      if (
        `${p.title} ${p.shopName} ${p.category}`
          .toLowerCase()
          .includes(trimmed)
      ) {
        prodAndDishMatches.push({
          id: `prod-${p.id}`,
          title: p.title,
          subtitle: p.shopName,
          href: p.listingId
            ? `/listing/${encodeURIComponent(p.listingId)}`
            : `/marketplace?q=${encodeURIComponent(p.title)}`,
          priceLabel: `₹${Math.round(p.price)}`,
        });
      }
    }

    const locAndVert: Array<{ label: string; href: string }> = [];
    for (const loc of localities) {
      if (loc.toLowerCase().includes(trimmed)) {
        locAndVert.push({
          label: `${loc} (${activeHubName})`,
          href: `/explore?q=${encodeURIComponent(loc)}`,
        });
      }
    }
    for (const v of VERTICAL_SEARCH_TERMS) {
      if (v.label.toLowerCase().includes(trimmed)) {
        locAndVert.push(v);
      }
    }

    return {
      places: placePool.slice(0, 4),
      civic: civicMatches,
      productsAndDishes: prodAndDishMatches.slice(0, 4),
      localitiesAndVerticals: locAndVert.slice(0, 4),
    };
  }, [
    trimmed,
    places,
    foodAndShops,
    venuesAndStays,
    realEstate,
    civicHighlights,
    products,
    dishes,
    localities,
    activeHubName,
  ]);

  const hasAnySuggestion =
    groupedMatches.places.length > 0 ||
    groupedMatches.civic.length > 0 ||
    groupedMatches.productsAndDishes.length > 0 ||
    groupedMatches.localitiesAndVerticals.length > 0;

  return (
    <div ref={containerRef} data-tour="home-hero-search" className="relative w-full">
      <form
        onSubmit={(e) => {
          setIsOpen(false);
          if (query.trim()) {
            trackAppEvent({
              event_type: 'search_query',
              feature_area: 'home',
              target_id: query.trim().slice(0, 60),
            });
          }
          onSubmitSearch(e);
        }}
        className="flex flex-col sm:flex-row gap-2"
      >
        <div className="relative flex-1">
          <Search
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <input
            type="text"
            value={query}
            onFocus={() => setIsOpen(true)}
            onBlur={() => {
              window.setTimeout(() => setIsOpen(false), 160);
            }}
            onChange={(e) => {
              onQueryChange(e.target.value);
              setIsOpen(true);
            }}
            placeholder={placeholder}
            aria-label="Search places, dishes, helplines, and services"
            data-testid="landing-hero-search-input"
            className="h-11 w-full rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 pl-10 pr-9 text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-theme-primary shadow-xs"
          />
          {query && (
            <button
              type="button"
              onClick={() => onQueryChange('')}
              aria-label="Clear hero search"
              className="absolute right-2.5 top-1/2 -translate-y-1/2 w-6 h-6 rounded-md inline-flex items-center justify-center text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
        <button
          type="submit"
          data-testid="landing-hero-search-submit"
          className="h-11 px-5 rounded-xl bg-theme-primary text-[hsl(var(--color-primary-foreground))] text-sm font-bold inline-flex items-center justify-center gap-1.5 shadow-sm hover:opacity-95 transition-opacity shrink-0 cursor-pointer"
        >
          <span>Search {activeHubName}</span>
          <ArrowRight className="w-4 h-4" />
        </button>
      </form>

      {/* Grouped Instant Autosuggest Dropdown (z-[75]) */}
      {isOpen && trimmed.length > 0 && (
        <div
          role="listbox"
          aria-label="Grouped search suggestions"
          data-testid="landing-hero-autosuggest"
          className="absolute left-0 right-0 top-full mt-2 z-[75] rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shadow-2xl overflow-hidden divide-y divide-slate-100 dark:divide-slate-800 text-xs max-h-[380px] overflow-y-auto"
        >
          {!hasAnySuggestion ? (
            <button
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                setIsOpen(false);
                router.push(`/explore?q=${encodeURIComponent(query.trim())}`);
              }}
              className="w-full px-4 py-3 text-left flex items-center justify-between gap-2 hover:bg-slate-50 dark:hover:bg-slate-800/60 cursor-pointer"
            >
              <span className="text-slate-700 dark:text-slate-200 font-medium">
                Search all of {activeHubName} for &ldquo;{query.trim()}&rdquo;
              </span>
              <ArrowRight className="w-3.5 h-3.5 text-theme-primary shrink-0" />
            </button>
          ) : (
            <>
              {groupedMatches.places.length > 0 && (
                <div className="p-2 space-y-0.5">
                  <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Places &amp; Services
                  </div>
                  {groupedMatches.places.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setIsOpen(false);
                        router.push(item.href);
                      }}
                      className="w-full px-2.5 py-2 rounded-xl text-left flex items-center justify-between gap-2 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                    >
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-900 dark:text-white truncate">
                          {item.title}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate">
                          {item.subtitle}
                        </div>
                      </div>
                      {item.badge && (
                        <span className="px-2 py-0.5 rounded-md bg-theme-primary/10 text-theme-primary text-[10px] font-bold shrink-0">
                          {item.badge}
                        </span>
                      )}
                    </button>
                  ))}
                </div>
              )}

              {groupedMatches.civic.length > 0 && (
                <div className="p-2 space-y-0.5">
                  <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-rose-500">
                    Public &amp; Emergency Helplines
                  </div>
                  {groupedMatches.civic.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setIsOpen(false);
                        router.push(
                          `/explore?civic=${encodeURIComponent(item.id)}`
                        );
                      }}
                      className="w-full px-2.5 py-2 rounded-xl text-left flex items-center justify-between gap-2 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors cursor-pointer"
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <HeartPulse className="w-3.5 h-3.5 text-rose-600 shrink-0" />
                        <div className="min-w-0">
                          <div className="font-semibold text-slate-900 dark:text-white truncate">
                            {item.title}
                          </div>
                          <div className="text-[11px] text-slate-500 truncate">
                            {item.locality}
                            {item.primaryPhone ? ` · ${item.primaryPhone}` : ''}
                          </div>
                        </div>
                      </div>
                      <span className="text-[10px] font-bold text-rose-600 shrink-0">
                        Helpline →
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {groupedMatches.productsAndDishes.length > 0 && (
                <div className="p-2 space-y-0.5">
                  <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Dishes &amp; Shop Products
                  </div>
                  {groupedMatches.productsAndDishes.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setIsOpen(false);
                        router.push(item.href);
                      }}
                      className="w-full px-2.5 py-2 rounded-xl text-left flex items-center justify-between gap-2 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                    >
                      <div className="min-w-0">
                        <div className="font-semibold text-slate-900 dark:text-white truncate">
                          {item.title}
                        </div>
                        <div className="text-[11px] text-slate-500 truncate">
                          {item.subtitle}
                        </div>
                      </div>
                      <span className="font-bold text-slate-900 dark:text-white tabular-nums shrink-0">
                        {item.priceLabel}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {groupedMatches.localitiesAndVerticals.length > 0 && (
                <div className="p-2 space-y-0.5">
                  <div className="px-2 py-1 text-[10px] font-bold uppercase tracking-wider text-slate-400">
                    Localities &amp; Verticals
                  </div>
                  {groupedMatches.localitiesAndVerticals.map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      onMouseDown={(e) => {
                        e.preventDefault();
                        setIsOpen(false);
                        router.push(item.href);
                      }}
                      className="w-full px-2.5 py-1.5 rounded-xl text-left flex items-center justify-between gap-2 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                    >
                      <span className="inline-flex items-center gap-1.5 font-medium text-slate-700 dark:text-slate-200">
                        <MapPin className="w-3.5 h-3.5 text-theme-primary shrink-0" />
                        <span>{item.label}</span>
                      </span>
                      <ArrowRight className="w-3 h-3 text-slate-400 shrink-0" />
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function HubServiceLauncherAndCivicStrip({
  activeHubName,
  activeHubSlug = 'churachandpur',
  moduleSwitches,
  civicAlerts,
  homepageContainers,
  homepageShortcuts,
  homepageQuickJumps,
  homepageBanners,
  popularLocalities,
  isAuthenticated = false,
  onOpenAuthModal,
}: {
  activeHubName: string;
  activeHubSlug?: string;
  moduleSwitches?: HubModuleSwitchesMap;
  civicAlerts: LandingCivicAlertItem[];
  homepageContainers?: HomepageContainerRecord[];
  homepageShortcuts?: HomepageItemRecord[];
  homepageQuickJumps?: HomepageItemRecord[];
  homepageBanners?: HomepageItemRecord[];
  popularLocalities?: PopularLocalityRecord[];
  isAuthenticated?: boolean;
  onOpenAuthModal?: () => void;
}) {
  const [deckFilter, setDeckFilter] = useState<DeckCategoryFilter>('all');
  const [activeContainerSlug, setActiveContainerSlug] = useState<string>('');
  const [mobileExpanded, setMobileExpanded] = useState<boolean>(false);

  const hasDynamicShortcuts =
    Array.isArray(homepageShortcuts) && homepageShortcuts.length > 0;
  const hasDynamicQuickJumps =
    Array.isArray(homepageQuickJumps) && homepageQuickJumps.length > 0;

  const enabledShortcutContainers = useMemo(() => {
    const source =
      Array.isArray(homepageContainers) && homepageContainers.length > 0
        ? homepageContainers
        : DEFAULT_HOMEPAGE_CONTAINERS;
    const filtered = source
      .filter((c) => c.is_enabled && c.section_group === 'shortcut_grid')
      .sort((a, b) => a.sort_order - b.sort_order);

    const hasAllTab = filtered.some((c) => c.slug === 'all-services');
    if (hasAllTab) return filtered;

    const autoAllContainer: HomepageContainerRecord = {
      id: 'auto-all-services',
      slug: 'all-services',
      title: 'All',
      subtitle: 'All active services and shortcuts',
      icon_key: 'layout-grid',
      accent_color: '#2563EB',
      section_group: 'shortcut_grid',
      sort_order: 0,
      is_enabled: true,
    };
    return [autoAllContainer, ...filtered];
  }, [homepageContainers]);

  const effectiveContainerSlug = useMemo(() => {
    if (
      activeContainerSlug &&
      enabledShortcutContainers.some((c) => c.slug === activeContainerSlug)
    ) {
      return activeContainerSlug;
    }
    return enabledShortcutContainers[0]?.slug || 'all-services';
  }, [activeContainerSlug, enabledShortcutContainers]);

  const enabledDynamicBanners = useMemo(
    () =>
      (homepageBanners || [])
        .filter((b) => b.is_enabled)
        .sort((a, b) => a.sort_order - b.sort_order),
    [homepageBanners]
  );
  const enabledPopularLocalities = useMemo(
    () =>
      (popularLocalities || [])
        .filter((loc) => loc.is_enabled)
        .sort((a, b) => a.sort_order - b.sort_order),
    [popularLocalities]
  );

  const enabledTiles = useMemo(
    () =>
      SERVICE_LAUNCHER_TILES.filter((tile) =>
        isHubModuleEnabled(moduleSwitches, tile.moduleKey)
      ),
    [moduleSwitches]
  );

  const enabledDynamicShortcuts = useMemo(
    () =>
      (homepageShortcuts || [])
        .filter((s) => s.is_enabled)
        .sort((a, b) => a.sort_order - b.sort_order),
    [homepageShortcuts]
  );

  const validContainerIds = useMemo(
    () => new Set(enabledShortcutContainers.map((c) => c.id)),
    [enabledShortcutContainers]
  );

  const getShortcutsForContainer = useMemo(() => {
    return (container: HomepageContainerRecord): HomepageItemRecord[] => {
      const explicitMatches = enabledDynamicShortcuts.filter(
        (item) => item.container_id === container.id
      );

      // Special overview container ("all-services"): shows all enabled cards unless items are explicitly pinned to it
      if (container.slug === 'all-services' && explicitMatches.length === 0) {
        return enabledDynamicShortcuts;
      }

      const fallbackMatches = enabledDynamicShortcuts.filter((item) => {
        if (item.container_id && validContainerIds.has(item.container_id)) {
          return false;
        }
        return inferDefaultContainerSlugForItem(item) === container.slug;
      });

      return [...explicitMatches, ...fallbackMatches].sort(
        (a, b) => a.sort_order - b.sort_order
      );
    };
  }, [enabledDynamicShortcuts, validContainerIds]);

  const activeContainer = useMemo(
    () =>
      enabledShortcutContainers.find((c) => c.slug === effectiveContainerSlug) ||
      enabledShortcutContainers[0] ||
      null,
    [enabledShortcutContainers, effectiveContainerSlug]
  );

  const filteredDynamicShortcuts = useMemo(() => {
    if (!hasDynamicShortcuts) return [];
    if (!activeContainer) return enabledDynamicShortcuts;
    return getShortcutsForContainer(activeContainer);
  }, [
    hasDynamicShortcuts,
    activeContainer,
    enabledDynamicShortcuts,
    getShortcutsForContainer,
  ]);

  const filteredTiles = useMemo(() => {
    if (deckFilter === 'all') return enabledTiles;
    return enabledTiles.filter((t) => t.deckGroup === deckFilter);
  }, [enabledTiles, deckFilter]);

  const totalShortcutCount = hasDynamicShortcuts
    ? enabledDynamicShortcuts.length
    : enabledTiles.length;
  const activeGridLength = hasDynamicShortcuts
    ? filteredDynamicShortcuts.length
    : filteredTiles.length;

  const isViewingAllTab = hasDynamicShortcuts
    ? effectiveContainerSlug === 'all-services'
    : deckFilter === 'all';

  const topAlert = civicAlerts[0] || null;
  const shouldTruncateMobile =
    isViewingAllTab && !mobileExpanded && activeGridLength > 8;

  return (
    <section
      data-testid="landing-service-launcher"
      data-tour="home-service-launcher"
      className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8 pt-6 space-y-3"
    >
      {/* Dynamic Homepage Container Tabs (DB-Driven with Safe Fallback) */}
      <div
        role="tablist"
        aria-label="Filter services deck"
        className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar"
      >
        {hasDynamicShortcuts && enabledShortcutContainers.length > 0
          ? enabledShortcutContainers.map((container) => {
              const active = container.slug === effectiveContainerSlug;
              const TabIcon = getIconByKey(container.icon_key);
              const count = getShortcutsForContainer(container).length;
              return (
                <button
                  key={container.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  data-testid={`deck-container-tab-${container.slug}`}
                  onClick={() => setActiveContainerSlug(container.slug)}
                  className={`inline-flex min-h-[44px] sm:min-h-[36px] shrink-0 items-center gap-1.5 rounded-full px-3.5 text-xs font-semibold transition-all cursor-pointer ${
                    active
                      ? 'text-white shadow-2xs'
                      : 'border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:border-[var(--ps-accent)]/50 hover:text-[var(--ps-text)]'
                  }`}
                  style={
                    active
                      ? { backgroundColor: container.accent_color || 'var(--ps-accent)' }
                      : undefined
                  }
                >
                  <TabIcon
                    className="h-3.5 w-3.5 shrink-0"
                    style={
                      !active ? { color: container.accent_color } : undefined
                    }
                    aria-hidden="true"
                  />
                  <span>{container.title}</span>
                  <span className="text-[10px] opacity-80 tabular-nums">
                    ({count})
                  </span>
                </button>
              );
            })
          : DECK_FILTER_TABS.map((tab) => {
              const active = deckFilter === tab.id;
              const count =
                tab.id === 'all'
                  ? enabledTiles.length
                  : enabledTiles.filter((t) => t.deckGroup === tab.id).length;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  data-testid={`deck-filter-tab-${tab.id}`}
                  onClick={() => setDeckFilter(tab.id)}
                  className={`inline-flex min-h-[44px] sm:min-h-[36px] shrink-0 items-center gap-1.5 rounded-full px-3.5 text-xs font-semibold transition-all cursor-pointer ${
                    active
                      ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-2xs'
                      : 'border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:border-[var(--ps-accent)]/50 hover:text-[var(--ps-text)]'
                  }`}
                >
                  <span>{tab.label}</span>
                  <span className="text-[10px] opacity-80 tabular-nums">
                    ({count})
                  </span>
                </button>
              );
            })}
      </div>

      {/* Responsive Shortcut Grid (DB-Driven with Safe Fallback) */}
      <motion.div
        layout
        className="grid grid-cols-2 sm:grid-cols-4 gap-2.5"
      >
        {hasDynamicShortcuts
          ? filteredDynamicShortcuts.map((item, idx) => {
              const Icon = getIconByKey(item.icon_key);
              const href = resolveHomepageItemHref(
                item.route_key,
                item.query_params,
                activeHubSlug
              );
              const hiddenOnCollapsedMobile = shouldTruncateMobile && idx >= 8;
              const styleClass =
                item.container_style === 'elevated'
                  ? 'border-[var(--ps-border)] bg-[var(--ps-surface)] shadow-md hover:shadow-lg'
                  : item.container_style === 'tinted'
                    ? 'shadow-2xs'
                    : 'border-[var(--ps-border)] bg-[var(--ps-surface)] shadow-2xs';
              const tintedStyle =
                item.container_style === 'tinted'
                  ? {
                      backgroundColor: `${item.accent_color}12`,
                      borderColor: `${item.accent_color}3D`,
                    }
                  : undefined;

              return (
                <motion.div
                  key={item.id}
                  layout
                  whileHover={{ y: -2 }}
                  whileTap={{ scale: 0.98 }}
                  className={hiddenOnCollapsedMobile ? 'hidden sm:block' : 'block'}
                >
                  <Link
                    href={href}
                    data-testid={`launcher-tile-${item.item_key || item.id}`}
                    onClick={() =>
                      trackAppEvent({
                        event_type: 'shortcut_click',
                        feature_area: 'home',
                        target_id: item.title,
                        root_key: item.route_key,
                      })
                    }
                    style={tintedStyle}
                    className={`group h-full rounded-2xl border p-3 flex flex-col items-start gap-2 hover:border-[var(--ps-accent)]/50 transition-colors ${styleClass}`}
                  >
                    <div
                      className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                      style={{
                        backgroundColor: `${item.accent_color}1A`,
                        color: item.accent_color,
                      }}
                    >
                      <Icon className="w-4 h-4" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 w-full">
                      <div className="text-xs font-bold text-[var(--ps-text)] leading-tight truncate">
                        {item.title}
                      </div>
                      {item.subtitle && (
                        <div className="text-[10.5px] text-[var(--ps-text-muted)] truncate mt-0.5">
                          {item.subtitle}
                        </div>
                      )}
                    </div>
                  </Link>
                </motion.div>
              );
            })
          : filteredTiles.map((tile, idx) => {
              const Icon = tile.icon;
              const hiddenOnCollapsedMobile = shouldTruncateMobile && idx >= 8;
              const cardContent = (
                <>
                  <div
                    className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${tile.tone}`}
                  >
                    <Icon className="w-4 h-4" aria-hidden="true" />
                  </div>
                  <div className="min-w-0 w-full">
                    <div className="text-xs font-bold text-[var(--ps-text)] leading-tight truncate">
                      {tile.label}
                    </div>
                    <div className="text-[10.5px] text-[var(--ps-text-muted)] truncate mt-0.5">
                      {tile.subtitle}
                    </div>
                  </div>
                </>
              );

              const cardClassName = `group rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3 flex flex-col items-start gap-2 hover:border-[var(--ps-accent)]/50 transition-colors shadow-2xs ${
                hiddenOnCollapsedMobile ? 'hidden sm:flex' : 'flex'
              }`;

              if (tile.requiresAuth && !isAuthenticated && onOpenAuthModal) {
                return (
                  <motion.button
                    key={tile.id}
                    type="button"
                    layout
                    whileHover={{ y: -2 }}
                    whileTap={{ scale: 0.98 }}
                    onClick={onOpenAuthModal}
                    data-testid={`launcher-tile-${tile.id}`}
                    className={`${cardClassName} text-left cursor-pointer`}
                  >
                    {cardContent}
                  </motion.button>
                );
              }

              return (
                <motion.div
                  key={tile.id}
                  layout
                  whileHover={{ y: -2 }}
                  whileTap={{ scale: 0.98 }}
                  className={hiddenOnCollapsedMobile ? 'hidden sm:block' : 'block'}
                >
                  <Link
                    href={tile.href}
                    data-testid={`launcher-tile-${tile.id}`}
                    className={`${cardClassName} h-full`}
                  >
                    {cardContent}
                  </Link>
                </motion.div>
              );
            })}
      </motion.div>

      {/* Mobile Collapsible "Explore All Services" Toggle */}
      {isViewingAllTab && activeGridLength > 8 && (
        <div className="flex justify-center sm:hidden">
          <button
            type="button"
            onClick={() => setMobileExpanded((prev) => !prev)}
            data-testid="deck-mobile-toggle-all"
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-full border border-[var(--ps-border)] bg-[var(--ps-surface)] px-4 text-xs font-bold text-[var(--ps-text)] shadow-2xs hover:border-[var(--ps-accent)] transition-colors cursor-pointer"
          >
            {mobileExpanded ? (
              <>
                <span>Show Fewer Services</span>
                <ChevronUp className="h-3.5 w-3.5" />
              </>
            ) : (
              <>
                <span>Explore All {totalShortcutCount} Services</span>
                <ChevronDown className="h-3.5 w-3.5" />
              </>
            )}
          </button>
        </div>
      )}

      {/* Pre-Filled Quick-Search Shortcut Strip (DB-Driven with Safe Fallback) */}
      <div
        data-testid="landing-prefilled-intent-strip"
        className="flex items-center gap-1.5 overflow-x-auto flex-nowrap pb-1 no-scrollbar"
      >
        <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-extrabold uppercase tracking-wider text-[var(--ps-text-muted)] pr-1">
          <Sparkles className="h-3 w-3 text-[var(--ps-accent)]" />
          <span>Quick Jump:</span>
        </span>
        {hasDynamicQuickJumps
          ? (homepageQuickJumps || [])
              .filter((q) => q.is_enabled)
              .sort((a, b) => a.sort_order - b.sort_order)
              .map((chip) => {
                const Icon = getIconByKey(chip.icon_key);
                const href = resolveHomepageItemHref(
                  chip.route_key,
                  chip.query_params,
                  activeHubSlug
                );
                return (
                  <Link
                    key={chip.id}
                    href={href}
                    className="inline-flex h-7.5 shrink-0 items-center gap-1.5 rounded-full border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 text-[11px] font-semibold text-[var(--ps-text)] hover:border-[var(--ps-accent)] hover:text-[var(--ps-accent)] transition-colors whitespace-nowrap"
                  >
                    <Icon
                      className="h-3 w-3 shrink-0"
                      style={{ color: chip.accent_color }}
                      aria-hidden="true"
                    />
                    <span>{chip.title}</span>
                  </Link>
                );
              })
          : PREFILLED_INTENT_SHORTCUTS.map((chip) => (
              <Link
                key={chip.label}
                href={chip.href}
                className="inline-flex h-7 shrink-0 items-center gap-1 rounded-full border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 text-[11px] font-semibold text-[var(--ps-text)] hover:border-[var(--ps-accent)] hover:text-[var(--ps-accent)] transition-colors whitespace-nowrap"
              >
                <span>{chip.label}</span>
              </Link>
            ))}
      </div>

      {/* Popular Localities Quick-Pan Strip (clean text chips without icons) */}
      {enabledPopularLocalities.length > 0 && (
        <div
          data-testid="landing-popular-localities-strip"
          className="flex items-center gap-1.5 overflow-x-auto flex-nowrap pb-1 no-scrollbar"
        >
          <span className="inline-flex shrink-0 items-center text-[10px] font-extrabold uppercase tracking-wider text-[var(--ps-text-muted)] pr-1">
            Explore Hubs:
          </span>
          {enabledPopularLocalities.map((loc) => (
            <Link
              key={loc.id}
              href={buildPopularLocalityExploreHref(loc, activeHubSlug)}
              onClick={() =>
                trackAppEvent({
                  event_type: 'shortcut_click',
                  feature_area: 'home',
                  target_id: loc.slug,
                  locality: loc.name,
                })
              }
              className="inline-flex h-7.5 shrink-0 items-center rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 text-[11px] font-semibold text-[var(--ps-text)] hover:border-[var(--ps-accent)] hover:text-[var(--ps-accent)] transition-colors whitespace-nowrap"
            >
              {loc.name}
            </Link>
          ))}
        </div>
      )}

      {/* Superadmin-Configured Featured Spotlight Banners */}
      {enabledDynamicBanners.length > 0 && (
        <div
          data-testid="landing-featured-banners-strip"
          className="grid grid-cols-1 gap-2.5 md:grid-cols-2"
        >
          {enabledDynamicBanners.map((banner) => {
            const Icon = getIconByKey(banner.icon_key);
            const href = resolveHomepageItemHref(
              banner.route_key,
              banner.query_params,
              activeHubSlug
            );
            return (
              <Link
                key={banner.id}
                href={href}
                style={{
                  borderColor: `${banner.accent_color}38`,
                  backgroundColor: `${banner.accent_color}0D`,
                }}
                className="group flex items-center justify-between gap-3 rounded-2xl border p-3.5 transition-all hover:shadow-xs"
              >
                <div className="flex items-start gap-3 min-w-0">
                  <div
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white"
                    style={{ backgroundColor: banner.accent_color }}
                  >
                    <Icon className="h-4.5 w-4.5" aria-hidden="true" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-[var(--ps-text)] group-hover:text-[var(--ps-accent)] transition-colors">
                      {banner.title}
                    </p>
                    {banner.subtitle && (
                      <p className="mt-0.5 text-[11px] text-[var(--ps-text-muted)] line-clamp-2">
                        {banner.subtitle}
                      </p>
                    )}
                  </div>
                </div>
                <ArrowRight className="h-4 w-4 shrink-0 text-[var(--ps-text-muted)] group-hover:translate-x-0.5 group-hover:text-[var(--ps-accent)] transition-transform" />
              </Link>
            );
          })}
        </div>
      )}

      {/* Slim Emergency & Civic Helplines Strip */}
      <div
        data-testid="landing-civic-quick-bar"
        className="rounded-xl border border-rose-500/25 bg-rose-500/8 dark:bg-rose-950/30 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2 text-xs"
      >
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {topAlert ? (
            <>
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500 text-slate-950 text-[10px] font-extrabold shrink-0">
                <AlertTriangle className="w-3 h-3" />
                <span>LIVE ALERT</span>
              </span>
              <span className="font-semibold text-slate-900 dark:text-slate-100 truncate">
                {topAlert.title}: {topAlert.alertText}
              </span>
            </>
          ) : (
            <>
              <Phone className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
              <span className="font-medium text-slate-800 dark:text-slate-200">
                Need verified 24×7 hospitals, police, fire, or {activeHubName} govt helplines?
              </span>
            </>
          )}
        </div>
        <Link
          href="/civic"
          data-testid="landing-civic-directory-cta"
          className="inline-flex items-center gap-1 font-bold text-rose-700 dark:text-rose-300 hover:underline whitespace-nowrap shrink-0"
        >
          <span>Emergency &amp; Govt Directory</span>
          <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </section>
  );
}

export function HubVerticalSpotlights({
  activeHubName,
  moduleSwitches,
  foodAndShops,
  venuesAndStays,
  realEstate,
  isPartnerUser,
}: {
  activeHubName: string;
  moduleSwitches?: HubModuleSwitchesMap;
  foodAndShops: LandingFoodShopItem[];
  venuesAndStays: LandingVenueStayItem[];
  realEstate: LandingRealEstateItem[];
  isPartnerUser: boolean;
}) {
  const showFoodShops =
    (isHubModuleEnabled(moduleSwitches, 'food_orders') ||
      isHubModuleEnabled(moduleSwitches, 'shop_orders')) &&
    foodAndShops.length > 0;
  const showVenuesStays =
    (isHubModuleEnabled(moduleSwitches, 'booking_venues') ||
      isHubModuleEnabled(moduleSwitches, 'hotel_stays')) &&
    venuesAndStays.length > 0;
  const showRealEstate =
    isHubModuleEnabled(moduleSwitches, 'real_estate') && realEstate.length > 0;

  return (
    <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8 space-y-10 py-6">
      {/* 1. Order Local Food & Daily Shops */}
      {showFoodShops && (
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.15 }}
          transition={{ duration: 0.35 }}
          data-testid="landing-spotlight-food-shops"
          className="space-y-4"
        >
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="text-lg sm:text-xl font-extrabold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
                <UtensilsCrossed className="w-5 h-5 text-orange-500" />
                <span>Order Local Food &amp; Daily Shops</span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Live kitchens &amp; stocked neighborhood storefronts in {activeHubName}.
              </p>
            </div>
            <Link
              href="/marketplace"
              className="text-xs font-bold text-theme-primary hover:underline inline-flex items-center gap-1 whitespace-nowrap"
            >
              <span>View All</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            {foodAndShops.slice(0, 4).map((item) => (
              <Link
                key={item.id}
                href={`/listing/${encodeURIComponent(item.id)}`}
                className="group rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden hover:border-theme-primary/50 transition-all shadow-2xs flex flex-col justify-between"
              >
                <div>
                  <div className="aspect-[16/10] w-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    {item.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.imageUrl}
                        alt={item.title}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-slate-400">
                        {item.vertical === 'restaurant_food' ? (
                          <UtensilsCrossed className="w-7 h-7" />
                        ) : (
                          <Store className="w-7 h-7" />
                        )}
                      </div>
                    )}
                  </div>
                  <div className="p-3.5 space-y-2">
                    <div className="flex flex-wrap items-center gap-1 text-[10px] font-bold">
                      {item.isPureVeg && (
                        <span className="px-1.5 py-0.5 rounded bg-emerald-500/12 text-emerald-700 dark:text-emerald-300">
                          Pure Veg
                        </span>
                      )}
                      {item.fssaiVerified && (
                        <span className="px-1.5 py-0.5 rounded bg-sky-500/12 text-sky-700 dark:text-sky-300">
                          FSSAI
                        </span>
                      )}
                      {item.prepEtaMins && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                          <Clock className="w-2.5 h-2.5" />
                          {item.prepEtaMins}m
                        </span>
                      )}
                      {item.pickNDropReady && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-700 dark:text-amber-300">
                          <Truck className="w-2.5 h-2.5" />
                          Pick N Drop
                        </span>
                      )}
                    </div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white line-clamp-1">
                      {item.title}
                    </h3>
                    <p className="text-[11px] text-slate-500 flex items-center gap-1 truncate">
                      <MapPin className="w-3 h-3 shrink-0" />
                      <span className="truncate">{item.locality}</span>
                    </p>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </motion.section>
      )}

      {/* 2. Book Turfs, Halls & Stays */}
      {showVenuesStays && (
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.15 }}
          transition={{ duration: 0.35 }}
          data-testid="landing-spotlight-venues-stays"
          className="space-y-4"
        >
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="text-lg sm:text-xl font-extrabold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
                <Calendar className="w-5 h-5 text-emerald-500" />
                <span>Book Turfs, Halls &amp; Stays</span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Instant slot bookings &amp; verified rooms across {activeHubName}.
              </p>
            </div>
            <Link
              href="/explore?vertical=booking_venue"
              className="text-xs font-bold text-theme-primary hover:underline inline-flex items-center gap-1 whitespace-nowrap"
            >
              <span>View All</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            {venuesAndStays.slice(0, 4).map((item) => {
              const targetHref =
                item.vertical === 'booking_venue'
                  ? `/listing/${encodeURIComponent(item.id)}/book`
                  : `/listing/${encodeURIComponent(item.id)}`;
              return (
                <Link
                  key={item.id}
                  href={targetHref}
                  className="group rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden hover:border-theme-primary/50 transition-all shadow-2xs flex flex-col justify-between"
                >
                  <div>
                    <div className="aspect-[16/10] w-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                      {item.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={item.imageUrl}
                          alt={item.title}
                          referrerPolicy="no-referrer"
                          className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-slate-400">
                          {item.vertical === 'hotel_stay' ? (
                            <BedDouble className="w-7 h-7" />
                          ) : (
                            <Calendar className="w-7 h-7" />
                          )}
                        </div>
                      )}
                    </div>
                    <div className="p-3.5 space-y-1.5">
                      <div className="flex items-center justify-between gap-2 text-[10.5px]">
                        <span className="font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                          {item.vertical === 'hotel_stay'
                            ? 'Hotel & Stay'
                            : 'Turf / Hall'}
                        </span>
                        {item.startingRateInr > 0 && (
                          <span className="font-extrabold text-slate-900 dark:text-white tabular-nums">
                            ₹{item.startingRateInr.toLocaleString('en-IN')}
                            {item.rateUnit}
                          </span>
                        )}
                      </div>
                      <h3 className="text-sm font-bold text-slate-900 dark:text-white line-clamp-1">
                        {item.title}
                      </h3>
                      <p className="text-[11px] text-slate-500 flex items-center gap-1 truncate">
                        <MapPin className="w-3 h-3 shrink-0" />
                        <span className="truncate">{item.locality}</span>
                      </p>
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>
        </motion.section>
      )}

      {/* 3. Featured Verified Properties */}
      {showRealEstate && (
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, amount: 0.15 }}
          transition={{ duration: 0.35 }}
          data-testid="landing-spotlight-real-estate"
          className="space-y-4"
        >
          <div className="flex items-end justify-between gap-3">
            <div>
              <h2 className="text-lg sm:text-xl font-extrabold tracking-tight text-slate-900 dark:text-white flex items-center gap-2">
                <Building2 className="w-5 h-5 text-violet-500" />
                <span>Featured Verified Properties</span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                Fresh 30-day verified rentals, homes &amp; plots in {activeHubName}.
              </p>
            </div>
            <Link
              href="/explore?vertical=real_estate"
              className="text-xs font-bold text-theme-primary hover:underline inline-flex items-center gap-1 whitespace-nowrap"
            >
              <span>View All</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3.5">
            {realEstate.slice(0, 4).map((prop) => (
              <Link
                key={prop.id}
                href={`/listing/${encodeURIComponent(prop.id)}`}
                className="group rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 overflow-hidden hover:border-violet-500/60 transition-all shadow-2xs flex flex-col justify-between"
              >
                <div>
                  <div className="relative aspect-[16/10] w-full bg-slate-100 dark:bg-slate-800 overflow-hidden">
                    {prop.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={prop.imageUrl}
                        alt={prop.title}
                        referrerPolicy="no-referrer"
                        className="w-full h-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-slate-400">
                        <Home className="w-7 h-7" />
                      </div>
                    )}
                    <div className="absolute top-2 left-2 flex flex-wrap gap-1">
                      <span className="px-2 py-0.5 rounded-full bg-violet-700/95 text-white text-[10px] font-extrabold uppercase">
                        FOR {prop.transactionType || 'RENT'}
                      </span>
                      {prop.isBoosted && (
                        <span className="inline-flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-amber-400 text-slate-950 text-[10px] font-extrabold">
                          <Sparkles className="w-2.5 h-2.5" />
                          Featured
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="p-3.5 space-y-2">
                    <div className="text-base font-extrabold text-violet-700 dark:text-violet-300 tabular-nums">
                      {formatIndianPropertyPrice(
                        prop.priceInr,
                        prop.pricePeriod
                      )}
                    </div>
                    <h3 className="text-sm font-bold text-slate-900 dark:text-white line-clamp-1">
                      {prop.title}
                    </h3>
                    <p className="text-[11px] text-slate-500 flex items-center gap-1 truncate">
                      <MapPin className="w-3 h-3 shrink-0" />
                      <span className="truncate">{prop.locality}</span>
                    </p>
                    <div className="flex flex-wrap items-center gap-1 text-[10px] font-semibold">
                      {prop.pattaVerified && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-emerald-500/12 text-emerald-700 dark:text-emerald-300">
                          <ShieldCheck className="w-2.5 h-2.5" />
                          Patta Verified
                        </span>
                      )}
                      {prop.water24x7 && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-sky-500/12 text-sky-700 dark:text-sky-300">
                          <Droplets className="w-2.5 h-2.5" />
                          24×7 Water
                        </span>
                      )}
                      {prop.carRoad && (
                        <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                          <Car className="w-2.5 h-2.5" />
                          Car Road
                        </span>
                      )}
                    </div>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </motion.section>
      )}

      {/* 4. Partner Growth Footer Card */}
      <section
        data-testid="landing-partner-growth-card"
        className="rounded-2xl border border-theme-primary/25 bg-gradient-to-r from-theme-primary/10 via-white dark:via-slate-900 to-theme-primary/5 p-5 sm:p-6 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
      >
        <div className="space-y-1 max-w-2xl">
          <div className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-theme-primary">
            <CheckCircle2 className="w-3.5 h-3.5" />
            <span>Zero-Commission Local Partner Tools</span>
          </div>
          <h3 className="text-base sm:text-lg font-extrabold text-slate-900 dark:text-white">
            Own a shop, café, hotel, turf, or vehicle in {activeHubName}?
          </h3>
          <p className="text-xs sm:text-sm text-slate-600 dark:text-slate-400">
            Zero-commission local tools on DD oodle — online storefronts, live digital menus, slot calendars, and Pick N Drop dispatch built for hill-district businesses.
          </p>
        </div>
        <Link
          href={isPartnerUser ? '/workspace' : '/onboarding'}
          data-testid="landing-partner-growth-cta"
          className="h-10 px-5 rounded-xl bg-theme-primary text-[hsl(var(--color-primary-foreground))] text-xs sm:text-sm font-bold inline-flex items-center justify-center gap-2 hover:opacity-95 transition-opacity shrink-0 whitespace-nowrap"
        >
          <span>
            {isPartnerUser ? 'Open Partner Workspace' : 'List Your Business'}
          </span>
          <ArrowRight className="w-4 h-4" />
        </Link>
      </section>
    </div>
  );
}
