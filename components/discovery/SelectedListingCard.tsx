'use client';

import React, { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  ArrowLeft,
  ArrowUpRight,
  BadgeCheck,
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
  Share2,
  ShoppingBag,
  Star,
  Store,
  Trophy,
  Truck,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import { useShare } from '@/components/ui/ShareSheetModal';
import { isUuid } from '@/lib/payments/types';
import type { PrintProfileBadgeSummary } from '@/lib/print-orders/client-helpers';
import { CATEGORY_LABELS, getListingPriceLabel } from '@/lib/rules';
import { formatIndianPropertyPrice } from '@/lib/real-estate/helpers';
import { useAppStore } from '@/lib/store';
import { supabaseMediaImageLoader } from '@/lib/supabase/storage';
import { splitSamplePrefix } from '@/lib/utils/display-title';
import { buildListingSharePayload } from '@/lib/utils/share';
import { resolveListingLiveCapabilities } from '@/lib/verticals/capabilities';
import { Listing, ListingCategory } from '@/lib/types';

function computeSelectedDistancePill(
  anchor: { lat: number; lng: number } | null | undefined,
  target: { lat: number; lng: number } | null | undefined
): string | null {
  if (!anchor || !target) return null;
  if (
    !Number.isFinite(anchor.lat) ||
    !Number.isFinite(anchor.lng) ||
    !Number.isFinite(target.lat) ||
    !Number.isFinite(target.lng) ||
    (target.lat === 0 && target.lng === 0)
  ) {
    return null;
  }
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(target.lat - anchor.lat);
  const dLng = toRad(target.lng - anchor.lng);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(anchor.lat)) *
      Math.cos(toRad(target.lat)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const km = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  if (!Number.isFinite(km) || km > 200) return null;
  if (km < 1) return `${Math.max(50, Math.round(km * 1000))}m`;
  return `${km.toFixed(1)} km`;
}

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

      {show360Badge && (
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
  printProfile?: PrintProfileBadgeSummary | null;
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

function getVerticalPrimaryAction(
  listing: Listing,
  printProfile?: PrintProfileBadgeSummary | null
): {
  label: string;
  href: string | null;
  icon: typeof Expand;
  isSummaryOnly?: boolean;
} {
  const vertical =
    listing.is_civic_record || listing.listing_vertical === 'public_civic'
      ? 'public_civic'
      : listing.listing_vertical ||
        (listing.category === 'real_estate'
          ? 'real_estate'
          : listing.category === 'sports'
            ? 'booking_venue'
            : listing.category === 'public_place'
              ? 'public_civic'
              : listing.category === 'business'
                ? 'shop_catalogue'
                : 'general');
  const encodedId = encodeURIComponent(listing.id);
  const summary = (listing.vertical_summary || {}) as Record<string, unknown>;

  switch (vertical) {
    case 'public_civic':
      return {
        label: listing.contactPhone ? 'Call Now' : 'View Contacts',
        href: listing.contactPhone ? `tel:${listing.contactPhone}` : null,
        icon: Phone,
        isSummaryOnly: !listing.contactPhone,
      };
    case 'print_digital': {
      const canOrderPrint =
        isUuid(listing.id) &&
        resolveListingLiveCapabilities(listing, printProfile).canOrderPrint;
      return canOrderPrint
        ? {
            label: 'Order Print',
            href: `/listing/${encodedId}/print`,
            icon: Printer,
          }
        : {
            label: 'Order Print',
            href: `/listing/${encodedId}`,
            icon: Printer,
          };
    }
    case 'booking_venue':
      return {
        label: 'Book Slot',
        href: `/listing/${encodedId}/book`,
        icon: Calendar,
      };
    case 'hotel_stay':
      return {
        label: 'Check Rooms',
        href: `/listing/${encodedId}`,
        icon: BedDouble,
      };
    case 'restaurant_food':
      return {
        label: summary.allow_table_booking ? 'Book Table' : 'Menu & Order',
        href: `/listing/${encodedId}`,
        icon: UtensilsCrossed,
      };
    case 'shop_catalogue':
      return {
        label:
          summary.can_pay_upi && summary.accepts_online_orders
            ? 'Order'
            : 'Browse Shop',
        href: `/listing/${encodedId}`,
        icon: ShoppingBag,
      };
    case 'real_estate':
      return {
        label: 'Request Visit',
        href: `/listing/${encodedId}#request-visit`,
        icon: Calendar,
      };
    default:
      return {
        label: 'Enquire',
        href: `/listing/${encodedId}`,
        icon: Expand,
      };
  }
}

function getQuickBadgeLabel(listing: Listing): string {
  const s = (listing.vertical_summary || {}) as Record<string, unknown>;
  if (
    listing.listing_vertical === 'real_estate' ||
    listing.category === 'real_estate'
  ) {
    const p = Number(s.price_inr ?? listing.realEstateDetails?.askingPrice ?? 0);
    const period =
      s.price_period === 'monthly' || s.price_period === 'yearly'
        ? (s.price_period as 'monthly' | 'yearly')
        : s.deal_type === 'rent'
          ? 'monthly'
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
  if (listing.listing_vertical === 'booking_venue') {
    const rate = Number(s.starting_price_inr ?? 0);
    if (Number.isFinite(rate) && rate > 0) {
      return `From ₹${rate.toLocaleString('en-IN')}/hr`;
    }
  }
  if (listing.listing_vertical === 'shop_catalogue') {
    const rate = Number(s.starting_price_inr ?? 0);
    if (Number.isFinite(rate) && rate > 0) {
      return `From ₹${rate.toLocaleString('en-IN')}`;
    }
  }
  return getListingPriceLabel(listing) || CATEGORY_LABELS[listing.category];
}

export function SelectedListingCard({
  listing,
  printProfile,
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
  const { savedListingIds, toggleSavedListing, customDefaultCenter } =
    useAppStore();
  const { openShareSheet } = useShare();
  const isSaved = savedListingIds.includes(listing.id);
  const isCivic = Boolean(
    listing.is_civic_record || listing.listing_vertical === 'public_civic'
  );
  const primaryAction = getVerticalPrimaryAction(listing, printProfile);
  const PrimaryIcon = primaryAction.icon;
  const quickBadge = getQuickBadgeLabel(listing);
  const { title: cleanTitle, isSample } = splitSamplePrefix(listing.title);
  const isVerified = Boolean(
    listing.is_verified || listing.verificationStatus === 'verified_demo'
  );
  const optionalMedia = (
    listing as Listing & {
      listingMedia?: Array<{
        media_type?: string | null;
        is_equirectangular?: boolean | null;
        url?: string | null;
      }> | null;
    }
  ).listingMedia;
  const has360 =
    (Array.isArray(listing.panoramas_360) &&
      listing.panoramas_360.some((p) => Boolean(p?.url?.trim()))) ||
    (Array.isArray(optionalMedia) &&
      optionalMedia.some(
        (m) =>
          (m.media_type === 'panorama_360' || m.is_equirectangular === true) &&
          Boolean(m?.url?.trim())
      )) ||
    Boolean(listing.realEstateDetails?.panoramaUrl?.trim()) ||
    (Array.isArray(listing.realEstateDetails?.panoramas) &&
      listing.realEstateDetails.panoramas.some((p) => Boolean(p?.imageUrl?.trim())));

  const distanceText =
    routeEstimate?.distanceText ||
    computeSelectedDistancePill(customDefaultCenter, listing.coordinates);

  const handleRichShare = () => {
    const path = isCivic
      ? `/civic?focus=${encodeURIComponent(listing.id)}`
      : `/listing/${encodeURIComponent(listing.id)}`;
    openShareSheet(
      buildListingSharePayload(listing, {
        title: cleanTitle,
        url: path,
        priceLabel: quickBadge,
        isVerified,
      })
    );
  };

  return (
    <div
      data-testid="selected-listing-preview-card"
      data-variant={variant}
      className="w-full rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)]/98 backdrop-blur-md shadow-xl p-3 sm:p-3.5 space-y-2.5 text-xs"
    >
      {/* Top Row: Thumbnail + Title + Quick Controls */}
      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          <ListingThumbnail
            src={listing.coverImage}
            alt={cleanTitle}
            category={listing.category}
            show360Badge={has360}
            className="w-18 h-18 shrink-0"
          />
          {isVerified && (
            <span
              title="Verified on DD oodle"
              className="pointer-events-none absolute top-1 right-1 inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-white shadow-xs"
            >
              <BadgeCheck className="h-3 w-3" aria-hidden="true" />
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex items-start justify-between gap-1.5">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1">
                <span className="inline-block rounded-md bg-[var(--ps-surface-alt)] px-1.5 py-0.5 text-[9.5px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)] truncate max-w-[130px]">
                  {listing.subcategory || CATEGORY_LABELS[listing.category]}
                </span>
                {distanceText && (
                  <span className="rounded-md bg-emerald-500/12 px-1.5 py-0.5 text-[9.5px] font-bold text-emerald-700 dark:text-emerald-300 tabular-nums shrink-0">
                    {distanceText}
                    {routeEstimate?.durationText
                      ? ` · ${routeEstimate.durationText}`
                      : ''}
                  </span>
                )}
              </div>
              <div className="mt-0.5 flex items-start gap-1">
                <h3 className="text-sm font-bold text-[var(--ps-text)] leading-snug line-clamp-2 min-w-0">
                  {cleanTitle}
                </h3>
                {isSample && (
                  <span className="shrink-0 mt-0.5 rounded px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide bg-[var(--ps-surface-alt)] text-[var(--ps-text-muted)] border border-[var(--ps-border)]">
                    Sample
                  </span>
                )}
              </div>
            </div>

            <div className="flex items-center gap-1 shrink-0">
              {showReopenSidebarAction && onReopenDesktopSidebar && (
                <button
                  type="button"
                  onClick={onReopenDesktopSidebar}
                  title="Show listings sidebar"
                  aria-label="Show listings sidebar"
                  className="min-h-[44px] min-w-[44px] w-11 h-11 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] flex items-center justify-center text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
                >
                  <PanelRightOpen className="w-4 h-4" />
                </button>
              )}
              <button
                type="button"
                onClick={handleRichShare}
                title="Share listing"
                aria-label={`Share ${cleanTitle}`}
                data-testid="selected-listing-share-btn"
                className="min-h-[44px] min-w-[44px] w-11 h-11 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] flex items-center justify-center text-[var(--ps-text-muted)] hover:border-[var(--ps-accent)] hover:text-[var(--ps-accent)] transition-colors cursor-pointer"
              >
                <Share2 className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={() => toggleSavedListing(listing.id)}
                title={isSaved ? 'Remove bookmark' : 'Save listing'}
                aria-label={isSaved ? 'Remove bookmark' : 'Save listing'}
                className={`min-h-[44px] min-w-[44px] w-11 h-11 rounded-xl border flex items-center justify-center transition-colors cursor-pointer ${
                  isSaved
                    ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] border-[var(--ps-accent)]'
                    : 'bg-[var(--ps-bg)] text-[var(--ps-text-muted)] border-[var(--ps-border)] hover:text-[var(--ps-text)]'
                }`}
              >
                <Bookmark
                  className={`w-4 h-4 ${isSaved ? 'fill-current' : ''}`}
                />
              </button>
              <button
                type="button"
                onClick={onClearSelection}
                title="Close preview"
                aria-label="Close selected listing preview"
                data-testid="selected-listing-close-btn"
                className="min-h-[44px] min-w-[44px] w-11 h-11 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] flex items-center justify-center text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
              >
                {variant === 'desktop-sidebar' ? (
                  <ArrowLeft className="w-4 h-4" />
                ) : (
                  <X className="w-4 h-4" />
                )}
              </button>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--ps-text-muted)]">
            <span className="inline-flex items-center gap-0.5 truncate max-w-[155px]">
              <MapPin className="w-3 h-3 text-[var(--ps-accent)] shrink-0" />
              <span className="truncate">{listing.locality}</span>
            </span>
            {quickBadge && (
              <span className="px-2 py-0.5 rounded-md bg-[var(--ps-accent)]/12 text-[var(--ps-accent)] font-bold tabular-nums">
                {quickBadge}
              </span>
            )}
            {listing.rating > 0 && (
              <span className="inline-flex items-center gap-0.5 font-bold text-amber-600 dark:text-amber-400 tabular-nums">
                <Star className="w-3 h-3 fill-current" />
                <span>{listing.rating.toFixed(1)}</span>
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Action Bar (44px+ Touch Targets): Primary CTA + Summary + Full Details + Utility */}
      <div className="flex flex-wrap items-center gap-1.5">
        {primaryAction.isSummaryOnly || !primaryAction.href ? (
          <button
            type="button"
            onClick={onExpandDetails}
            data-testid="selected-listing-primary-cta"
            className="flex-1 min-w-[116px] min-h-[44px] h-11 px-3 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] font-bold inline-flex items-center justify-center gap-1.5 hover:opacity-95 transition-opacity cursor-pointer whitespace-nowrap"
          >
            <PrimaryIcon className="w-4 h-4 shrink-0" />
            <span>{primaryAction.label}</span>
          </button>
        ) : primaryAction.href.startsWith('tel:') ? (
          <a
            href={primaryAction.href}
            data-testid="selected-listing-primary-cta"
            className="flex-1 min-w-[116px] min-h-[44px] h-11 px-3 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] font-bold inline-flex items-center justify-center gap-1.5 hover:opacity-95 transition-opacity whitespace-nowrap"
          >
            <PrimaryIcon className="w-4 h-4 shrink-0" />
            <span>{primaryAction.label}</span>
          </a>
        ) : (
          <Link
            href={primaryAction.href}
            data-testid="selected-listing-primary-cta"
            className="flex-1 min-w-[116px] min-h-[44px] h-11 px-3 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] font-bold inline-flex items-center justify-center gap-1.5 hover:opacity-95 transition-opacity whitespace-nowrap"
          >
            <PrimaryIcon className="w-4 h-4 shrink-0" />
            <span>{primaryAction.label}</span>
          </Link>
        )}

        <button
          type="button"
          onClick={onExpandDetails}
          disabled={isLoadingDetails}
          data-testid="selected-listing-expand-summary-btn"
          className="min-h-[44px] h-11 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] hover:bg-[var(--ps-surface-alt)] text-[var(--ps-text)] font-bold inline-flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
        >
          {isLoadingDetails ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Expand className="w-4 h-4 text-[var(--ps-accent)] shrink-0" />
          )}
          <span>Summary</span>
        </button>

        {!isCivic && (
          <Link
            href={`/listing/${encodeURIComponent(listing.id)}`}
            data-testid="selected-listing-full-details-link"
            className="min-h-[44px] h-11 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] hover:border-[var(--ps-accent)] hover:text-[var(--ps-accent)] text-[var(--ps-text)] font-semibold inline-flex items-center justify-center gap-1 transition-colors whitespace-nowrap"
          >
            <span>Details</span>
            <ArrowUpRight className="w-3.5 h-3.5 shrink-0" />
          </Link>
        )}

        {!isCivic && (
          <Link
            href={`/explore?mode=pick_n_drop&pickupListingId=${encodeURIComponent(listing.id)}`}
            title="Pick N Drop From Here"
            aria-label="Book Pick N Drop from this location"
            data-testid="selected-listing-pnd-btn"
            className="min-h-[44px] min-w-[44px] h-11 w-11 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)]/70 hover:border-[var(--ps-accent)] text-[var(--ps-text)] inline-flex items-center justify-center transition-colors shrink-0"
          >
            <Truck className="w-4 h-4 text-[var(--ps-accent)]" />
          </Link>
        )}

        {onGetDirections && (
          <button
            type="button"
            onClick={() => onGetDirections(listing)}
            title="Get Directions"
            aria-label="Get directions to listing"
            className="min-h-[44px] min-w-[44px] w-11 h-11 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] hover:bg-[var(--ps-surface-alt)] text-[var(--ps-text)] inline-flex items-center justify-center transition-colors cursor-pointer shrink-0"
          >
            <Navigation className="w-4 h-4" />
          </button>
        )}

        {onCenterOnMap && (
          <button
            type="button"
            onClick={onCenterOnMap}
            title="Center on Map"
            aria-label="Center listing on map"
            className="min-h-[44px] min-w-[44px] w-11 h-11 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] hover:bg-[var(--ps-surface-alt)] text-[var(--ps-text)] inline-flex items-center justify-center transition-colors cursor-pointer shrink-0"
          >
            <Crosshair className="w-4 h-4" />
          </button>
        )}
      </div>
    </div>
  );
}

export default SelectedListingCard;

