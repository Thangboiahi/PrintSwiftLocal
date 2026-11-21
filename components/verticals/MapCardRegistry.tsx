'use client';

import React from 'react';
import Link from 'next/link';
import { Home, Printer, Sparkles, Timer } from 'lucide-react';
import {
  ListingCard,
  type ListingCardProps,
} from '@/components/discovery/ListingCard';
import { BookingMapCard } from '@/components/verticals/bookings/BookingMapCard';
import { CivicMapCard } from '@/components/verticals/civic/CivicMapCard';
import { HotelMapCard } from '@/components/verticals/hotels/HotelMapCard';
import type { Listing } from '@/lib/types';
import type { ListingVertical } from '@/lib/verticals/types';

export interface MapCardRegistryProps extends ListingCardProps {
  onOpenSummary: (listing: Listing) => void;
}

const TURNAROUND_LABELS: Record<string, string> = {
  express_30m: 'Express 30m',
  same_day: 'Same-Day',
  next_day: 'Next-Day',
};

export function resolveListingVertical(
  listing: Listing,
  hasPrintProfile: boolean
): ListingVertical {
  if (listing.is_civic_record || listing.listing_vertical === 'public_civic') {
    return 'public_civic';
  }
  if (listing.listing_vertical && listing.listing_vertical !== 'general') {
    return listing.listing_vertical;
  }
  if (hasPrintProfile) return 'print_digital';
  if (listing.category === 'real_estate') return 'real_estate';
  return 'general';
}

export function MapCardRegistry({
  onOpenSummary,
  ...cardProps
}: MapCardRegistryProps) {
  const { item, printProfile } = cardProps;
  const vertical = resolveListingVertical(item, Boolean(printProfile));

  // 1. Public & Government Services (`public_civic`) -> Terminal Civic Card
  if (vertical === 'public_civic') {
    return (
      <CivicMapCard
        item={item}
        isSaved={cardProps.isSaved}
        isHovered={cardProps.isHovered}
        isSelected={cardProps.isSelected}
        isMobileLandscape={cardProps.isMobileLandscape}
        showOutsideViewportBadge={cardProps.showOutsideViewportBadge}
        onMouseEnter={cardProps.onMouseEnter}
        onMouseLeave={cardProps.onMouseLeave}
        onOpenCivicSummary={() => onOpenSummary(item)}
        onCenterOnMap={cardProps.onCenterOnMap}
        onToggleSave={cardProps.onToggleSave}
      />
    );
  }

  // 2. Print & Digital Services (`print_digital`) -> Enhanced Print-aware card
  if (vertical === 'print_digital') {
    const summary = item.vertical_summary || {};
    const isFirstParty = Boolean(
      printProfile?.isFirstParty ?? summary.is_first_party_printswift
    );
    const isAccepting = Boolean(
      printProfile
        ? printProfile.hasActiveEntitlement &&
            printProfile.isAcceptingOrders &&
            !printProfile.isBusyPaused
        : summary.is_accepting_orders
    );
    const turnaroundKey =
      printProfile?.turnaroundBadge ||
      (typeof summary.turnaround_badge === 'string'
        ? summary.turnaround_badge
        : '');
    const turnaroundLabel = TURNAROUND_LABELS[turnaroundKey] || null;
    const verifiedCaps =
      printProfile?.verifiedCapabilities ||
      (summary.verified_capabilities as Record<string, boolean> | undefined) ||
      {};
    const verifiedCount = Object.values(verifiedCaps).filter(Boolean).length;

    return (
      <div className="w-full max-w-[440px] mx-auto space-y-1">
        {(isFirstParty || isAccepting || turnaroundLabel || verifiedCount > 0) && (
          <div className="flex flex-wrap items-center justify-between gap-1.5 rounded-lg border border-teal-500/20 bg-teal-500/6 px-2.5 py-1 text-[10px]">
            <div className="flex flex-wrap items-center gap-1.5 min-w-0">
              {isFirstParty ? (
                <span className="inline-flex items-center gap-1 rounded bg-amber-500/20 px-1.5 py-0.5 font-extrabold uppercase tracking-wide text-amber-800 dark:text-amber-300">
                  <Sparkles className="h-2.5 w-2.5" />
                  Official PrintSwift
                </span>
              ) : (
                <span className="inline-flex items-center gap-1 font-bold text-teal-800 dark:text-teal-300">
                  <Printer className="h-3 w-3" />
                  Print &amp; Digital
                </span>
              )}
              {turnaroundLabel && (
                <span className="inline-flex items-center gap-0.5 rounded bg-white/80 px-1.5 py-0.5 font-semibold text-slate-700 dark:bg-slate-900/80 dark:text-slate-300">
                  <Timer className="h-2.5 w-2.5" />
                  {turnaroundLabel}
                </span>
              )}
              {verifiedCount > 0 && (
                <span className="inline-flex items-center gap-1 text-slate-600 dark:text-slate-400">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                  {verifiedCount} verified
                </span>
              )}
            </div>
            {isAccepting && (
              <Link
                href={`/listing/${encodeURIComponent(item.id)}/print`}
                onClick={(e) => e.stopPropagation()}
                className="font-bold text-teal-700 hover:underline dark:text-teal-300 shrink-0"
              >
                Order Print →
              </Link>
            )}
          </div>
        )}
        <ListingCard
          {...cardProps}
          onExpandDetails={() => onOpenSummary(item)}
        />
      </div>
    );
  }

  // 3. Real Estate (`real_estate`) -> Compact Property/Locality Ribbon + Card
  if (vertical === 'real_estate') {
    const details = item.realEstateDetails;
    const isRental =
      details?.propertyType === 'room_pg' ||
      details?.availability === 'rented' ||
      Boolean(details?.paymentFrequency) ||
      Boolean(details?.leaseTerms);
    const dealBadge = isRental ? 'Rent / Lease' : 'Property';
    const priceSnippet = details?.priceLabel?.trim();

    return (
      <div className="w-full max-w-[440px] mx-auto space-y-1">
        <div className="flex items-center justify-between gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/6 px-2.5 py-1 text-[10px]">
          <span className="inline-flex items-center gap-1 font-bold text-emerald-800 dark:text-emerald-300">
            <Home className="h-3 w-3" />
            Real Estate · {dealBadge}
          </span>
          <span className="truncate font-medium text-slate-600 dark:text-slate-400">
            {priceSnippet || item.locality}
          </span>
        </div>
        <ListingCard
          {...cardProps}
          onExpandDetails={() => onOpenSummary(item)}
        />
      </div>
    );
  }

  // 4. Bookable Venues & Turfs (`booking_venue`) -> Distinct Emerald Calendar Card
  if (vertical === 'booking_venue') {
    return (
      <BookingMapCard
        item={item}
        isSaved={cardProps.isSaved}
        isHovered={cardProps.isHovered}
        isSelected={cardProps.isSelected}
        isMobileLandscape={cardProps.isMobileLandscape}
        showOutsideViewportBadge={cardProps.showOutsideViewportBadge}
        onMouseEnter={cardProps.onMouseEnter}
        onMouseLeave={cardProps.onMouseLeave}
        onOpenSummary={() => onOpenSummary(item)}
        onCenterOnMap={cardProps.onCenterOnMap}
        onToggleSave={cardProps.onToggleSave}
      />
    );
  }

  // 5. Hotels, Homestays & Lodges (`hotel_stay`) -> Distinct Indigo Nightly Stay Card
  if (vertical === 'hotel_stay') {
    return (
      <HotelMapCard
        item={item}
        isSaved={cardProps.isSaved}
        isHovered={cardProps.isHovered}
        isSelected={cardProps.isSelected}
        isMobileLandscape={cardProps.isMobileLandscape}
        showOutsideViewportBadge={cardProps.showOutsideViewportBadge}
        onMouseEnter={cardProps.onMouseEnter}
        onMouseLeave={cardProps.onMouseLeave}
        onOpenSummary={() => onOpenSummary(item)}
        onCenterOnMap={cardProps.onCenterOnMap}
        onToggleSave={cardProps.onToggleSave}
      />
    );
  }

  // 6. All other verticals (general, restaurant_food, shop_catalogue)
  return (
    <ListingCard {...cardProps} onExpandDetails={() => onOpenSummary(item)} />
  );
}

export default MapCardRegistry;
