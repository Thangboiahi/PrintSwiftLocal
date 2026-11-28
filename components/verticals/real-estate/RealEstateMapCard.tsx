'use client';

import React from 'react';
import Image from 'next/image';
import { useHydrated } from '@/hooks/useHydrated';
import {
  BadgeCheck,
  Bookmark,
  Car,
  Crosshair,
  Droplets,
  Home,
  MapPin,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { useSavedInterests } from '@/lib/hooks/useSavedInterests';
import {
  formatIndianPropertyPrice,
  getFreshnessState,
} from '@/lib/real-estate/helpers';
import type {
  RealEstateAvailabilityStatus,
  RealEstateDealType,
  RealEstatePricePeriod,
  RealEstatePropertyType,
  RoadAccessType,
  WaterSupplyType,
} from '@/lib/real-estate/types';
import { supabaseMediaImageLoader } from '@/lib/supabase/storage';
import type { Listing } from '@/lib/types';

export interface RealEstateMapCardProps {
  item: Listing;
  isSaved: boolean;
  isHovered: boolean;
  isSelected: boolean;
  isMobileLandscape: boolean;
  showOutsideViewportBadge?: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onOpenSummary: () => void;
  onCenterOnMap: () => void;
  onToggleSave: () => void;
}

const DEAL_RIBBON_META: Record<
  RealEstateDealType,
  { label: string; cls: string }
> = {
  rent: {
    label: 'FOR RENT',
    cls: 'bg-violet-600 text-white',
  },
  sale: {
    label: 'FOR SALE',
    cls: 'bg-emerald-600 text-white',
  },
  lease: {
    label: 'FOR LEASE',
    cls: 'bg-sky-600 text-white',
  },
  pg_hostel: {
    label: 'PG / HOSTEL',
    cls: 'bg-amber-600 text-white',
  },
};

const PROPERTY_TYPE_SHORT: Record<RealEstatePropertyType, string> = {
  plot_land: 'Plot / Land',
  house: 'House',
  apartment: 'Apartment',
  commercial_shop: 'Commercial Shop',
  room_pg: 'Room / PG',
};

export function RealEstateMapCard({
  item,
  isSaved,
  isHovered,
  isSelected,
  isMobileLandscape,
  showOutsideViewportBadge = false,
  onMouseEnter,
  onMouseLeave,
  onOpenSummary,
  onCenterOnMap,
  onToggleSave,
}: RealEstateMapCardProps) {
  const summary = (item.vertical_summary || {}) as Record<string, unknown>;

  const dealType = (
    typeof summary.deal_type === 'string' &&
    summary.deal_type in DEAL_RIBBON_META
      ? summary.deal_type
      : 'rent'
  ) as RealEstateDealType;
  const propertyType = (
    typeof summary.property_type === 'string' &&
    summary.property_type in PROPERTY_TYPE_SHORT
      ? summary.property_type
      : 'house'
  ) as RealEstatePropertyType;
  const priceInr = Number(summary.price_inr ?? 0);
  const pricePeriod = (
    typeof summary.price_period === 'string'
      ? summary.price_period
      : dealType === 'sale'
        ? 'total'
        : 'monthly'
  ) as RealEstatePricePeriod;

  const bedrooms =
    summary.bedrooms !== null && summary.bedrooms !== undefined
      ? Number(summary.bedrooms)
      : null;
  const areaSqft =
    summary.area_sqft !== null && summary.area_sqft !== undefined
      ? Number(summary.area_sqft)
      : null;
  const landAreaText =
    typeof summary.land_area_text === 'string' && summary.land_area_text.trim()
      ? summary.land_area_text.trim()
      : null;

  const pattaVerified = Boolean(summary.patta_verified);
  const siteVerified = Boolean(summary.site_verified);
  const waterSupply = (
    typeof summary.water_supply === 'string' ? summary.water_supply : ''
  ) as WaterSupplyType | '';
  const roadAccess = (
    typeof summary.road_access === 'string' ? summary.road_access : ''
  ) as RoadAccessType | '';
  const availabilityStatus = (
    typeof summary.availability_status === 'string'
      ? summary.availability_status
      : 'available'
  ) as RealEstateAvailabilityStatus;

  const isHydrated = useHydrated();
  const boostExp =
    typeof summary.verified_boost_expires_at === 'string'
      ? summary.verified_boost_expires_at
      : null;
  const isBoosted = Boolean(
    isHydrated &&
      boostExp &&
      !Number.isNaN(Date.parse(boostExp)) &&
      Date.parse(boostExp) > Date.now()
  );

  const freshnessExp =
    typeof summary.freshness_expires_at === 'string'
      ? summary.freshness_expires_at
      : null;
  const freshnessState = isHydrated ? getFreshnessState(freshnessExp) : 'fresh';

  const specParts: string[] = [];
  if (bedrooms && bedrooms > 0) {
    specParts.push(`${bedrooms} BHK`);
  } else {
    specParts.push(PROPERTY_TYPE_SHORT[propertyType]);
  }
  if (landAreaText) {
    specParts.push(landAreaText);
  } else if (areaSqft && areaSqft > 0) {
    specParts.push(`${areaSqft.toLocaleString('en-IN')} sq.ft`);
  }

  const dealRibbon = DEAL_RIBBON_META[dealType];
  const priceLabel = formatIndianPropertyPrice(priceInr, pricePeriod);
  const coverUrl = item.coverImage?.trim() || '';

  const { isSaved: isUnifiedSaved, toggleSave: toggleUnifiedSave } =
    useSavedInterests();
  const effectiveSaved = isSaved || isUnifiedSaved('listing', item.id);

  return (
    <div
      data-testid={`real-estate-map-card-${item.id}`}
      data-listing-id={item.id}
      data-listing-vertical="real_estate"
      data-selected={isSelected ? 'true' : 'false'}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onOpenSummary}
      className={`group relative w-full max-w-[440px] mx-auto rounded-xl border transition-all duration-150 ease-out cursor-pointer ${
        isMobileLandscape ? 'p-2.5 gap-2' : 'p-3 gap-2.5'
      } flex flex-col justify-between bg-[var(--ps-surface)] ${
        isSelected
          ? 'border-violet-600 dark:border-violet-400 ring-1 ring-violet-500/30 shadow-sm'
          : isBoosted
            ? 'border-amber-500/50 dark:border-amber-400/40 hover:border-violet-500/60 shadow-xs'
            : isHovered
              ? 'border-violet-500/60 dark:border-violet-500/50 shadow-sm'
              : 'border-[var(--ps-border)] hover:border-violet-500/50 shadow-2xs'
      }`}
    >
      {/* Top Row: Thumbnail + Deal Ribbon + Price */}
      <div className="flex items-start gap-2.5">
        <div className="relative h-16 w-16 shrink-0 overflow-hidden rounded-xl border border-violet-500/25 bg-violet-500/10">
          {coverUrl ? (
            <Image
              loader={supabaseMediaImageLoader}
              src={coverUrl}
              alt={item.title}
              fill
              sizes="64px"
              className="object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-violet-600 dark:text-violet-400">
              <Home className="h-6 w-6" />
            </div>
          )}
          <span
            className={`absolute left-0 top-0 rounded-br-lg px-1.5 py-0.5 text-[8px] font-extrabold tracking-wider ${dealRibbon.cls}`}
          >
            {dealRibbon.label}
          </span>
        </div>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-start justify-between gap-1.5">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1">
                <span className="font-mono text-sm font-extrabold text-violet-700 dark:text-violet-300 tabular-nums">
                  {priceLabel}
                </span>
                {isBoosted && (
                  <span className="inline-flex items-center gap-0.5 rounded-md bg-gradient-to-r from-amber-500 to-violet-600 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-white">
                    <Sparkles className="h-2.5 w-2.5" />
                    FEATURED
                  </span>
                )}
                {availabilityStatus === 'sold_rented' && (
                  <span className="rounded-md bg-slate-200 dark:bg-slate-800 px-1.5 py-0.5 text-[9px] font-bold uppercase text-slate-600 dark:text-slate-400">
                    Sold / Rented
                  </span>
                )}
                {availabilityStatus !== 'sold_rented' &&
                  freshnessState === 'stale' && (
                    <span className="rounded-md border border-amber-500/35 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-semibold text-amber-800 dark:text-amber-300">
                      Confirm Availability
                    </span>
                  )}
              </div>
              <h3 className="mt-0.5 truncate text-[13px] font-bold leading-snug text-[var(--ps-text)] group-hover:text-violet-700 dark:group-hover:text-violet-300">
                {item.title.replace(/^\[SAMPLE\]\s*/i, '')}
              </h3>
            </div>

            <button
              type="button"
              aria-label={effectiveSaved ? 'Unsave property' : 'Save property'}
              onClick={(e) => {
                e.stopPropagation();
                onToggleSave();
                void toggleUnifiedSave('listing', item.id);
              }}
              className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-colors cursor-pointer ${
                effectiveSaved
                  ? 'border-amber-500/40 bg-amber-500/15 text-amber-600 dark:text-amber-400'
                  : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
              }`}
            >
              <Bookmark
                className={`h-3.5 w-3.5 ${effectiveSaved ? 'fill-current' : ''}`}
              />
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[var(--ps-text-muted)]">
            <span className="inline-flex items-center gap-1 truncate">
              <MapPin className="h-3 w-3 shrink-0 text-violet-500" />
              <span className="truncate">{item.locality}</span>
            </span>
            {specParts.length > 0 && (
              <span className="font-semibold text-[var(--ps-text)]">
                · {specParts.join(' · ')}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Regional Trust Badges Row */}
      <div className="flex flex-wrap items-center gap-1.5">
        {pattaVerified && (
          <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/35 bg-emerald-500/12 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
            <BadgeCheck className="h-3 w-3" />
            Patta Verified ✓
          </span>
        )}
        {siteVerified && (
          <span className="inline-flex items-center gap-1 rounded-md border border-violet-500/35 bg-violet-500/12 px-1.5 py-0.5 text-[10px] font-bold text-violet-700 dark:text-violet-300">
            <ShieldCheck className="h-3 w-3" />
            Site Verified ✓
          </span>
        )}
        {waterSupply === '24x7' && (
          <span className="inline-flex items-center gap-1 rounded-md border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-sky-700 dark:text-sky-300">
            <Droplets className="h-3 w-3" />
            24x7 Water
          </span>
        )}
        {roadAccess === 'car_accessible' && (
          <span className="inline-flex items-center gap-1 rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--ps-text-muted)]">
            <Car className="h-3 w-3" />
            Car Road
          </span>
        )}
        {showOutsideViewportBadge && (
          <span className="rounded-md border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
            Outside map view
          </span>
        )}
      </div>

      {/* Footer Actions */}
      <div className="flex items-center justify-between gap-2 border-t border-[var(--ps-border)]/70 pt-2">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onCenterOnMap();
          }}
          className="inline-flex h-7 items-center gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 text-[11px] font-semibold text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
        >
          <Crosshair className="h-3 w-3" />
          <span>Locate</span>
        </button>

        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenSummary();
          }}
          className="inline-flex h-7 items-center gap-1 rounded-lg bg-violet-600 px-3 text-[11px] font-bold text-white hover:bg-violet-700 shadow-2xs cursor-pointer"
        >
          <span>View / Visit</span>
        </button>
      </div>
    </div>
  );
}
