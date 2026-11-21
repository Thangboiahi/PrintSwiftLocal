'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowLeft,
  BedDouble,
  Bookmark,
  Briefcase,
  Building2,
  Calendar,
  Compass,
  Crosshair,
  Expand,
  Landmark,
  Loader2,
  MapPin,
  Navigation,
  PanelRightOpen,
  Phone,
  Printer,
  ShoppingBag,
  Star,
  Store,
  Trophy,
  Truck,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import { CATEGORY_LABELS, getListingPriceLabel } from '@/lib/rules';
import { formatIndianPropertyPrice } from '@/lib/real-estate/helpers';
import { useAppStore } from '@/lib/store';
import { supabaseMediaImageLoader } from '@/lib/supabase/storage';
import { Listing, ListingCategory } from '@/lib/types';

function CategoryFallbackIcon({
  category,
  className = 'w-5 h-5',
}: {
  category: ListingCategory;
  className?: string;
}) {
  switch (category) {
    case 'real_estate':
      return <Building2 className={className} aria-hidden="true" />;
    case 'business':
      return <Store className={className} aria-hidden="true" />;
    case 'service':
      return <Briefcase className={className} aria-hidden="true" />;
    case 'sports':
      return <Trophy className={className} aria-hidden="true" />;
    case 'public_place':
    default:
      return <Landmark className={className} aria-hidden="true" />;
  }
}

export interface ListingThumbnailProps {
  src?: string;
  alt: string;
  category: ListingCategory;
  show360Badge?: boolean;
  priority?: boolean;
  className?: string;
  imgClassName?: string;
  testId?: string;
}

export function ListingThumbnail({
  src,
  alt,
  category,
  show360Badge = false,
  priority = false,
  className = 'w-24 h-24 sm:w-[100px] sm:h-[100px]',
  imgClassName = '',
  testId,
}: ListingThumbnailProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const trimmedSrc = src?.trim() || null;
  const showFallback = !trimmedSrc || failedSrc === trimmedSrc;

  return (
    <div
      data-testid={testId}
      data-image-fallback={showFallback ? 'true' : 'false'}
      className={`relative rounded-xl overflow-hidden bg-[var(--ps-surface-alt)] border border-[var(--ps-border)] shrink-0 select-none ${className}`}
    >
      {!showFallback && trimmedSrc ? (
        <Image
          loader={supabaseMediaImageLoader}
          unoptimized={false}
          src={trimmedSrc}
          alt={alt}
          fill
          priority={priority}
          sizes="(max-width: 640px) 96px, 160px"
          loading={priority ? undefined : 'lazy'}
          referrerPolicy="no-referrer"
          onError={() => setFailedSrc(trimmedSrc)}
          className={`w-full h-full object-cover object-center ${imgClassName}`}
        />
      ) : (
        <div
          role="img"
          aria-label={alt}
          className="w-full h-full flex flex-col items-center justify-center gap-1 p-1.5 text-center bg-gradient-to-br from-[var(--ps-surface-alt)] to-[var(--ps-bg)] text-[var(--ps-text-muted)]"
        >
          <CategoryFallbackIcon
            category={category}
            className="w-5 h-5 text-[var(--ps-accent)]/80 shrink-0"
          />
          <span className="text-[9px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)] leading-tight line-clamp-1 max-w-full">
            {CATEGORY_LABELS[category]}
          </span>
        </div>
      )}

      {show360Badge && category === 'real_estate' && (
        <span className="absolute bottom-1 left-1 px-1.5 py-0.5 rounded-md bg-slate-950/85 backdrop-blur-2xs text-emerald-300 text-[9px] font-bold leading-none inline-flex items-center gap-0.5 shadow-2xs pointer-events-none">
          <Compass className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
          <span>360°</span>
        </span>
      )}
    </div>
  );
}

interface SelectedListingCardProps {
  listing: Listing;
  onClearSelection: () => void;
  onExpandDetails: () => void;
  onOpenFullPage?: (listingId: string) => void;
  onCenterOnMap?: () => void;
  onZoomToItem?: () => void;
  onGetDirections?: (listing: Listing) => void;
  routeEstimate?: { distanceText: string; durationText: string } | null;
  onReopenDesktopSidebar?: () => void;
  showReopenSidebarAction?: boolean;
  variant?: 'desktop-sidebar' | 'mobile-overlay';
  isLoadingDetails?: boolean;
}

function getVerticalPrimaryAction(listing: Listing): {
  label: string;
  href: string | null;
  icon: typeof Expand;
  isSummaryOnly?: boolean;
} {
  const vertical =
    listing.is_civic_record || listing.listing_vertical === 'public_civic'
      ? 'public_civic'
      : listing.listing_vertical || 'general';
  const encodedId = encodeURIComponent(listing.id);

  switch (vertical) {
    case 'public_civic':
      return {
        label: 'View Contacts',
        href: null,
        icon: Phone,
        isSummaryOnly: true,
      };
    case 'print_digital':
      return {
        label: 'Order Print',
        href: `/listing/${encodedId}/print`,
        icon: Printer,
      };
    case 'booking_venue':
      return {
        label: 'Book Slot',
        href: `/listing/${encodedId}/book`,
        icon: Calendar,
      };
    case 'hotel_stay':
      return {
        label: 'Book Stay',
        href: `/listing/${encodedId}`,
        icon: BedDouble,
      };
    case 'restaurant_food':
      return {
        label: 'View Menu',
        href: `/listing/${encodedId}`,
        icon: UtensilsCrossed,
      };
    case 'shop_catalogue':
      return {
        label: 'View Store',
        href: `/listing/${encodedId}`,
        icon: ShoppingBag,
      };
    default:
      return {
        label: 'Full Details',
        href: `/listing/${encodedId}`,
        icon: Expand,
      };
  }
}

function getQuickBadgeLabel(listing: Listing): string {
  const s = (listing.vertical_summary || {}) as Record<string, unknown>;
  if (listing.listing_vertical === 'real_estate') {
    const p = Number(s.price_inr ?? 0);
    const period =
      s.price_period === 'monthly' || s.price_period === 'yearly'
        ? s.price_period
        : 'total';
    if (Number.isFinite(p) && p > 0) {
      return formatIndianPropertyPrice(p, period);
    }
  }
  if (listing.listing_vertical === 'hotel_stay') {
    const rate = Number(s.min_rate_inr ?? s.starting_price_inr ?? 0);
    if (Number.isFinite(rate) && rate > 0) {
      return `From ₹${rate.toLocaleString('en-IN')}/night`;
    }
  }
  return getListingPriceLabel(listing) || CATEGORY_LABELS[listing.category];
}

export function SelectedListingCard({
  listing,
  onClearSelection,
  onExpandDetails,
  onCenterOnMap,
  onGetDirections,
  routeEstimate,
  onReopenDesktopSidebar,
  showReopenSidebarAction = false,
  variant = 'desktop-sidebar',
  isLoadingDetails = false,
}: SelectedListingCardProps) {
  const { savedListingIds, toggleSavedListing } = useAppStore();
  const isSaved = savedListingIds.includes(listing.id);
  const isCivic = Boolean(
    listing.is_civic_record || listing.listing_vertical === 'public_civic'
  );
  const primaryAction = getVerticalPrimaryAction(listing);
  const PrimaryIcon = primaryAction.icon;
  const quickBadge = getQuickBadgeLabel(listing);

  return (
    <div
      data-testid="selected-listing-preview-card"
      data-variant={variant}
      className="w-full rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)]/98 backdrop-blur-md shadow-xl p-3 space-y-2.5 text-xs"
    >
      {/* Top Row: Thumbnail + Title + Quick Controls */}
      <div className="flex items-start gap-2.5">
        <ListingThumbnail
          src={listing.coverImage}
          alt={listing.title}
          category={listing.category}
          className="w-16 h-16 shrink-0"
        />

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-start justify-between gap-1.5">
            <h3 className="text-sm font-bold text-[var(--ps-text)] leading-snug line-clamp-1">
              {listing.title}
            </h3>
            <div className="flex items-center gap-1 shrink-0">
              {showReopenSidebarAction && onReopenDesktopSidebar && (
                <button
                  type="button"
                  onClick={onReopenDesktopSidebar}
                  title="Show listings sidebar"
                  aria-label="Show listings sidebar"
                  className="w-7 h-7 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] flex items-center justify-center text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
                >
                  <PanelRightOpen className="w-3.5 h-3.5" />
                </button>
              )}
              <button
                type="button"
                onClick={() => toggleSavedListing(listing.id)}
                title={isSaved ? 'Remove bookmark' : 'Save listing'}
                aria-label={isSaved ? 'Remove bookmark' : 'Save listing'}
                className={`w-7 h-7 rounded-lg border flex items-center justify-center transition-colors cursor-pointer ${
                  isSaved
                    ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] border-[var(--ps-accent)]'
                    : 'bg-[var(--ps-bg)] text-[var(--ps-text-muted)] border-[var(--ps-border)] hover:text-[var(--ps-text)]'
                }`}
              >
                <Bookmark
                  className={`w-3.5 h-3.5 ${isSaved ? 'fill-current' : ''}`}
                />
              </button>
              <button
                type="button"
                onClick={onClearSelection}
                title="Close preview"
                aria-label="Close selected listing preview"
                data-testid="selected-listing-close-btn"
                className="w-7 h-7 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] flex items-center justify-center text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
              >
                {variant === 'desktop-sidebar' ? (
                  <ArrowLeft className="w-3.5 h-3.5" />
                ) : (
                  <X className="w-3.5 h-3.5" />
                )}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--ps-text-muted)]">
            <span className="inline-flex items-center gap-0.5 truncate max-w-[150px]">
              <MapPin className="w-3 h-3 text-[var(--ps-accent)] shrink-0" />
              <span className="truncate">{listing.locality}</span>
            </span>
            {quickBadge && (
              <span className="px-1.5 py-0.5 rounded-md bg-[var(--ps-accent)]/12 text-[var(--ps-accent)] font-bold">
                {quickBadge}
              </span>
            )}
            {listing.rating > 0 && (
              <span className="inline-flex items-center gap-0.5 font-semibold text-amber-600 dark:text-amber-400">
                <Star className="w-3 h-3 fill-current" />
                <span>{listing.rating.toFixed(1)}</span>
              </span>
            )}
            {routeEstimate && (
              <span className="text-[10.5px] font-semibold text-emerald-600 dark:text-emerald-400">
                {routeEstimate.distanceText} · {routeEstimate.durationText}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Action Bar: Expand Summary + Primary Vertical CTA + Pick N Drop + Directions */}
      <div className="flex flex-wrap items-center gap-1.5">
        <button
          type="button"
          onClick={onExpandDetails}
          disabled={isLoadingDetails}
          data-testid="selected-listing-expand-summary-btn"
          className="flex-1 min-w-[110px] h-8 px-2.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] hover:bg-[var(--ps-surface-alt)] text-[var(--ps-text)] font-semibold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
        >
          {isLoadingDetails ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Expand className="w-3.5 h-3.5 text-[var(--ps-accent)]" />
          )}
          <span>Expand Summary</span>
        </button>

        {primaryAction.isSummaryOnly || !primaryAction.href ? (
          <button
            type="button"
            onClick={onExpandDetails}
            data-testid="selected-listing-primary-cta"
            className="flex-1 min-w-[110px] h-8 px-2.5 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] font-bold inline-flex items-center justify-center gap-1.5 hover:opacity-95 transition-opacity cursor-pointer"
          >
            <PrimaryIcon className="w-3.5 h-3.5" />
            <span>{primaryAction.label}</span>
          </button>
        ) : (
          <Link
            href={primaryAction.href}
            data-testid="selected-listing-primary-cta"
            className="flex-1 min-w-[110px] h-8 px-2.5 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] font-bold inline-flex items-center justify-center gap-1.5 hover:opacity-95 transition-opacity"
          >
            <PrimaryIcon className="w-3.5 h-3.5" />
            <span>{primaryAction.label}</span>
          </Link>
        )}

        {!isCivic && (
          <Link
            href={`/pick-n-drop?pickupListingId=${encodeURIComponent(listing.id)}`}
            title="Pick N Drop From Here"
            aria-label="Book Pick N Drop from this location"
            data-testid="selected-listing-pnd-btn"
            className="h-8 px-2.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)]/70 hover:border-[var(--ps-accent)] text-[var(--ps-text)] font-semibold inline-flex items-center justify-center gap-1 transition-colors"
          >
            <Truck className="w-3.5 h-3.5 text-[var(--ps-accent)]" />
            <span className="hidden sm:inline">Pick N Drop</span>
          </Link>
        )}

        {onGetDirections && (
          <button
            type="button"
            onClick={() => onGetDirections(listing)}
            title="Get Directions"
            aria-label="Get directions to listing"
            className="w-8 h-8 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] hover:bg-[var(--ps-surface-alt)] text-[var(--ps-text)] inline-flex items-center justify-center transition-colors cursor-pointer shrink-0"
          >
            <Navigation className="w-3.5 h-3.5" />
          </button>
        )}

        {onCenterOnMap && (
          <button
            type="button"
            onClick={onCenterOnMap}
            title="Center on Map"
            aria-label="Center listing on map"
            className="w-8 h-8 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] hover:bg-[var(--ps-surface-alt)] text-[var(--ps-text)] inline-flex items-center justify-center transition-colors cursor-pointer shrink-0"
          >
            <Crosshair className="w-3.5 h-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}

export default SelectedListingCard;
