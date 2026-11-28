'use client';

import React, { useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  BadgeCheck,
  BedDouble,
  Bookmark,
  Calendar,
  Crosshair,
  Expand,
  FileCheck2,
  MapPin,
  MessageCircle,
  Navigation,
  Package,
  Pentagon,
  Phone,
  Printer,
  Share2,
  ShoppingBag,
  Star,
  Truck,
  UtensilsCrossed,
  X,
  Zap,
  ZoomIn,
} from 'lucide-react';
import { useSavedInterests } from '@/lib/hooks/useSavedInterests';
import { splitSamplePrefix } from '@/lib/utils/display-title';
import { useShare } from '@/components/ui/ShareSheetModal';
import { buildListingSharePayload } from '@/lib/utils/share';
import type { PrintProfileBadgeSummary } from '@/lib/print-orders/client-helpers';
import {
  CATEGORY_LABELS,
  formatArea,
  getListingPriceLabel,
  shouldShowPlotAndBoundary,
} from '@/lib/rules';
import { formatSangamArea, formatIndianPropertyPrice } from '@/lib/real-estate/helpers';
import { useLiveOwnerProfile } from '@/lib/supabase/profiles';
import { supabaseMediaImageLoader } from '@/lib/supabase/storage';
import { useAppStore } from '@/lib/store';
import { AreaUnit, Listing } from '@/lib/types';
import { ListingThumbnail } from './SelectedListingCard';

export interface ListingCardProps {
  item: Listing;
  isSaved: boolean;
  isHovered: boolean;
  isSelected: boolean;
  isInlineHighlighted: boolean;
  isMobileLandscape: boolean;
  isCompactGrid?: boolean;
  context?: 'desktop-sidebar' | 'mobile-sheet' | 'list-grid';
  areaUnit: AreaUnit;
  showOutsideViewportBadge?: boolean;
  activeRouteEstimate?: { distanceText: string; durationText: string } | null;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onSelect: () => void;
  onCenterOnMap: () => void;
  onToggleSave: () => void;
  onExpandDetails: () => void;
  onZoomToItem: () => void;
  onGetDirections: () => void;
  onStartPickNDrop?: () => void;
  onClearSelection: () => void;
  printProfile?: PrintProfileBadgeSummary | null;
}

function computeDistancePill(
  anchor: { lat: number; lng: number } | null | undefined,
  coords: { lat: number; lng: number } | undefined
): string | null {
  if (!anchor || !coords) return null;
  if (!Number.isFinite(anchor.lat) || !Number.isFinite(anchor.lng)) return null;
  if (!Number.isFinite(coords.lat) || !Number.isFinite(coords.lng)) return null;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(coords.lat - anchor.lat);
  const dLng = toRad(coords.lng - anchor.lng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(anchor.lat)) *
      Math.cos(toRad(coords.lat)) *
      Math.sin(dLng / 2) ** 2;
  const km = 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
  if (!Number.isFinite(km) || km > 500) return null;
  return km < 1 ? `${Math.max(50, Math.round(km * 1000))}m` : `${km.toFixed(1)}km`;
}

export function ListingCard({
  item,
  isSaved,
  isHovered,
  isSelected,
  isInlineHighlighted,
  isMobileLandscape,
  isCompactGrid = false,
  context = 'list-grid',
  areaUnit,
  showOutsideViewportBadge = false,
  activeRouteEstimate = null,
  onMouseEnter,
  onMouseLeave,
  onSelect,
  onCenterOnMap,
  onToggleSave,
  onExpandDetails,
  onZoomToItem,
  onGetDirections,
  onStartPickNDrop,
  onClearSelection,
  printProfile = null,
}: ListingCardProps) {
  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null);
  const { openShareSheet } = useShare();
  const { customDefaultCenter } = useAppStore();
  const locationAnchor = customDefaultCenter;

  const isAcceptingPrintOnline = Boolean(
    printProfile &&
      printProfile.hasActiveEntitlement &&
      printProfile.isAcceptingOrders &&
      !printProfile.isBusyPaused
  );
  const re = item.realEstateDetails;
  const showPlot = re
    ? shouldShowPlotAndBoundary(re.propertyType, re.hasAssociatedPlot)
    : false;
  const optionalMedia = (
    item as Listing & {
      listingMedia?: Array<{
        media_type?: string | null;
        is_equirectangular?: boolean | null;
        url?: string | null;
      }> | null;
    }
  ).listingMedia;
  const hasValid360Panorama =
    (Array.isArray(item.panoramas_360) &&
      item.panoramas_360.some((p) => Boolean(p?.url?.trim()))) ||
    (Array.isArray(optionalMedia) &&
      optionalMedia.some(
        (m) =>
          (m.media_type === 'panorama_360' || m.is_equirectangular === true) &&
          Boolean(m?.url?.trim())
      )) ||
    Boolean(re?.panoramaUrl?.trim()) ||
    (Array.isArray(re?.panoramas) &&
      re.panoramas.some((p) => Boolean(p?.imageUrl?.trim())));

  const vertical =
    item.is_civic_record || item.listing_vertical === 'public_civic'
      ? 'public_civic'
      : item.listing_vertical ||
        (item.category === 'real_estate'
          ? 'real_estate'
          : item.category === 'sports'
            ? 'booking_venue'
            : item.category === 'public_place'
              ? 'public_civic'
              : item.category === 'business'
                ? 'shop_catalogue'
                : 'general');

  const summary = useMemo(
    () => (item.vertical_summary || {}) as Record<string, unknown>,
    [item.vertical_summary]
  );

  const priceLabel = useMemo(() => {
    if (vertical === 'real_estate') {
      const p = Number(summary.price_inr ?? re?.askingPrice ?? 0);
      const period =
        summary.price_period === 'monthly' || summary.price_period === 'yearly'
          ? (summary.price_period as 'monthly' | 'yearly')
          : summary.deal_type === 'rent'
            ? 'monthly'
            : 'total';
      if (Number.isFinite(p) && p > 0) {
        return formatIndianPropertyPrice(p, period);
      }
    }
    if (vertical === 'hotel_stay') {
      const rate = Number(summary.min_rate_inr ?? summary.starting_price_inr ?? 0);
      if (Number.isFinite(rate) && rate > 0) {
        return `From ₹${rate.toLocaleString('en-IN')}/night`;
      }
    }
    if (vertical === 'booking_venue') {
      const rate = Number(summary.starting_price_inr ?? 0);
      if (Number.isFinite(rate) && rate > 0) {
        return `From ₹${rate.toLocaleString('en-IN')}/hr`;
      }
    }
    if (vertical === 'shop_catalogue') {
      const startPrice = Number(summary.starting_price_inr ?? 0);
      if (Number.isFinite(startPrice) && startPrice > 0) {
        return `From ₹${startPrice.toLocaleString('en-IN')}`;
      }
    }
    if (vertical === 'restaurant_food') {
      const avg = Number(summary.avg_cost_for_two_inr ?? 0);
      if (Number.isFinite(avg) && avg > 0) {
        return `₹${avg.toLocaleString('en-IN')} for two`;
      }
    }
    return getListingPriceLabel(item);
  }, [vertical, summary, re, item]);

  const distancePill = useMemo(
    () => computeDistancePill(locationAnchor, item.coordinates),
    [locationAnchor, item.coordinates]
  );

  const { ownerName: liveOwnerName, ownerAvatarUrl: liveOwnerAvatarUrl } =
    useLiveOwnerProfile(item.ownerId, item.ownerName, item.ownerAvatarUrl);
  const {
    isSaved: isUnifiedSaved,
    toggleSave: toggleUnifiedSave,
  } = useSavedInterests();
  const effectiveSaved = isSaved || isUnifiedSaved('listing', item.id);

  const cleanTitleObj = splitSamplePrefix(item.title);
  const cleanTitle = cleanTitleObj.title;

  const ownerInitials = useMemo(() => {
    return (liveOwnerName || 'OW')
      .split(/\s+/)
      .filter(Boolean)
      .map((part) => part[0])
      .join('')
      .slice(0, 2)
      .toUpperCase();
  }, [liveOwnerName]);

  const trimmedOwnerAvatar = liveOwnerAvatarUrl?.trim() || '';
  const hasValidOwnerAvatar = Boolean(
    trimmedOwnerAvatar && failedAvatarUrl !== trimmedOwnerAvatar
  );

  // Vertical-specific primary CTA configuration
  const primaryCta = useMemo(() => {
    const encodedId = encodeURIComponent(item.id);
    switch (vertical) {
      case 'shop_catalogue': {
        const canOrderUpi = Boolean(summary.can_pay_upi && summary.accepts_online_orders);
        return {
          label: canOrderUpi ? 'Order' : 'Browse Shop',
          href: `/listing/${encodedId}`,
          icon: ShoppingBag,
        };
      }
      case 'restaurant_food': {
        const allowTable = Boolean(summary.allow_table_booking);
        return {
          label: allowTable ? 'Book Table' : 'Menu & Order',
          href: `/listing/${encodedId}`,
          icon: UtensilsCrossed,
        };
      }
      case 'print_digital':
        return {
          label: 'Order Print',
          href: isAcceptingPrintOnline
            ? `/listing/${encodedId}/print`
            : `/listing/${encodedId}`,
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
          label: 'Check Rooms',
          href: `/listing/${encodedId}`,
          icon: BedDouble,
        };
      case 'real_estate':
        return {
          label: 'Request Visit',
          href: `/listing/${encodedId}#request-visit`,
          icon: Calendar,
        };
      case 'public_civic':
        return {
          label: item.contactPhone ? 'Call' : 'Contacts',
          href: item.contactPhone ? `tel:${item.contactPhone}` : null,
          icon: Phone,
          isExternalTel: Boolean(item.contactPhone),
        };
      default:
        return {
          label: 'Enquire',
          href: `/listing/${encodedId}`,
          icon: MessageCircle,
        };
    }
  }, [vertical, item.id, item.contactPhone, summary, isAcceptingPrintOnline]);

  const PrimaryCtaIcon = primaryCta.icon;

  // Real Estate Sangam / Polygon / Patta metadata
  const realEstateChips = useMemo(() => {
    if (vertical !== 'real_estate') return null;
    const areaSqft =
      Number(summary.area_sqft ?? 0) ||
      (re?.plotAreaSqm ? Math.round(re.plotAreaSqm * 10.7639) : 0) ||
      (re?.builtUpAreaSqm ? Math.round(re.builtUpAreaSqm * 10.7639) : 0);
    const sangamText =
      areaSqft > 0
        ? formatSangamArea(areaSqft)
        : showPlot && re?.plotAreaSqm
          ? formatArea(re.plotAreaSqm, areaUnit)
          : null;
    const hasPolygon =
      Boolean(summary.has_polygon) ||
      Boolean(
        Array.isArray(re?.boundaryPolygon) && re.boundaryPolygon.length >= 3
      );
    const pattaVerified =
      Boolean(summary.patta_verified) ||
      summary.patta_status === 'verified_patta' ||
      summary.patta_status === 'patta_available' ||
      summary.patta_status === 'dag_chitha_verified';
    return {
      sangamText,
      hasPolygon,
      pattaVerified,
      transactionType:
        String(summary.deal_type || summary.transaction_type || 'sale').toUpperCase(),
    };
  }, [vertical, summary, re, showPlot, areaUnit]);

  const handleOpenRichShare = (e: React.MouseEvent) => {
    e.stopPropagation();
    const categoryText = item.subcategory || CATEGORY_LABELS[item.category] || item.category;
    const payload = buildListingSharePayload(
      {
        id: item.id,
        title: cleanTitle,
        category: categoryText,
        listingVertical: vertical,
        locality: item.locality,
        images: [item.coverImage, ...(item.galleryImages || [])].filter(Boolean),
        rating: item.rating,
        isVerified: Boolean(item.is_verified || item.verificationStatus === 'verified_demo'),
        startingPriceLabel: priceLabel || null,
      },
      {
        subtitle: [categoryText, item.locality].filter(Boolean).join(' · '),
        category: categoryText,
        categoryLabel: categoryText,
        priceText: priceLabel || null,
        priceLabel: priceLabel || null,
        verified: Boolean(item.is_verified || item.verificationStatus === 'verified_demo'),
        url: `/listing/${encodeURIComponent(item.id)}`,
      }
    );
    openShareSheet(payload);
  };

  return (
    <div
      data-testid={`listing-card-${item.id}`}
      data-listing-id={item.id}
      data-selected={isSelected ? 'true' : 'false'}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onSelect}
      className={`group relative w-full max-w-[440px] mx-auto rounded-2xl border bg-[var(--ps-surface)] transition-all duration-150 ease-out cursor-pointer ${
        isMobileLandscape ? 'p-2.5 gap-2' : 'p-3 sm:p-3.5 gap-2.5'
      } flex flex-col justify-between ${
        isSelected
          ? 'border-[var(--ps-accent)] ring-1 ring-[var(--ps-accent)]/35 shadow-sm bg-[var(--ps-surface-alt)]/30'
          : isHovered
            ? 'border-[var(--ps-accent)]/70 shadow-sm bg-[var(--ps-surface-alt)]/25'
            : 'border-[var(--ps-border)] hover:border-[var(--ps-accent)]/50 shadow-2xs'
      }`}
    >
      {/* Top Body: Thumbnail + Primary Hierarchy */}
      <div className="flex items-start gap-3">
        <div className="relative shrink-0">
          <ListingThumbnail
            src={item.coverImage}
            alt={cleanTitle}
            category={item.category}
            show360Badge={hasValid360Panorama}
            priority={false}
            imgClassName="group-hover:scale-105 transition-transform duration-300"
            className={
              isMobileLandscape
                ? 'w-20 h-20'
                : isCompactGrid
                  ? 'w-22 h-22 sm:w-24 sm:h-24'
                  : 'w-24 h-24 sm:w-[100px] sm:h-[100px]'
            }
          />
          {(item.is_verified || item.verificationStatus === 'verified_demo') && (
            <span
              title="Verified on DD oodle"
              className="pointer-events-none absolute top-1.5 left-1.5 inline-flex h-5 w-5 items-center justify-center rounded-full bg-emerald-600 text-white shadow-xs ring-2 ring-[var(--ps-surface)]"
            >
              <BadgeCheck className="w-3 h-3" aria-hidden="true" />
            </span>
          )}
        </div>

        {/* Editorial Content Hierarchy */}
        <div className="flex-1 min-w-0 flex flex-col justify-between">
          <div>
            {/* Row 1: L2/L3 Category Pill + Rating */}
            <div className="flex items-center justify-between gap-1.5">
              <div className="flex items-center gap-1 min-w-0 overflow-hidden">
                <span className="px-1.5 py-0.5 rounded-md bg-[var(--ps-surface-alt)] text-[9.5px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)] truncate max-w-[140px]">
                  {item.subcategory || CATEGORY_LABELS[item.category]}
                </span>
                {showOutsideViewportBadge && (
                  <span
                    data-testid={`outside-viewport-badge-${item.id}`}
                    className="text-[9px] font-semibold px-1.5 py-0.5 rounded-md bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20 whitespace-nowrap shrink-0"
                  >
                    Outside Map
                  </span>
                )}
              </div>

              {item.rating > 0 && (
                <span className="inline-flex items-center gap-0.5 rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-bold text-amber-600 dark:text-amber-400 tabular-nums shrink-0">
                  <Star className="w-3 h-3 fill-current" aria-hidden="true" />
                  <span>{Number(item.rating).toFixed(1)}</span>
                </span>
              )}
            </div>

            {/* Row 2: Tight 2-line Listing Title */}
            <div className="mt-1 flex items-start gap-1.5 min-w-0">
              <h3
                data-testid={
                  isInlineHighlighted ? 'selected-listing-title' : undefined
                }
                className="text-sm font-bold tracking-tight text-[var(--ps-text)] group-hover:text-[var(--ps-accent)] transition-colors leading-snug line-clamp-2 min-w-0"
              >
                {cleanTitle}
              </h3>
              {cleanTitleObj.isSample && (
                <span className="shrink-0 mt-0.5 rounded border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--ps-text-muted)]">
                  Sample
                </span>
              )}
            </div>

            {/* Row 3: Locality + Inline Distance Pill */}
            <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[var(--ps-text-muted)] min-w-0">
              <MapPin
                className="w-3 h-3 shrink-0 text-[var(--ps-accent)]"
                aria-hidden="true"
              />
              <span className="truncate font-medium">{item.locality}</span>
              {distancePill && (
                <span className="shrink-0 rounded bg-[var(--ps-surface-alt)] px-1.5 py-0.5 text-[9.5px] font-bold text-[var(--ps-text)] tabular-nums">
                  {distancePill}
                </span>
              )}
            </div>

            {/* Row 4: Vertical-Aware Highlight Strip + Owner Avatar Pill */}
            <div className="mt-2 flex flex-wrap items-center justify-between gap-1.5">
              <div className="flex flex-wrap items-center gap-1 min-w-0">
                {priceLabel && (
                  <span className="inline-flex items-center rounded-md bg-[var(--ps-accent-soft)] px-2 py-0.5 text-[11px] font-bold text-[var(--ps-accent)] tabular-nums whitespace-nowrap">
                    {priceLabel}
                  </span>
                )}

                {/* Shop Metadata */}
                {vertical === 'shop_catalogue' && (
                  <span className="inline-flex items-center gap-1 rounded-md border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--ps-text-muted)] whitespace-nowrap">
                    <Package className="w-3 h-3 shrink-0" />
                    <span>
                      {Number(
                        summary.item_count ??
                          (Array.isArray(item.businessDetails?.catalogue)
                            ? item.businessDetails?.catalogue.length
                            : 0)
                      ) || 'In-store'}{' '}
                      items
                    </span>
                  </span>
                )}

                {/* Restaurant Metadata */}
                {vertical === 'restaurant_food' && (
                  <span
                    className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-bold whitespace-nowrap ${
                      summary.is_pure_veg
                        ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/20'
                        : 'bg-orange-500/10 text-orange-700 dark:text-orange-300 border border-orange-500/20'
                    }`}
                  >
                    <span>
                      {summary.is_pure_veg
                        ? 'Pure Veg'
                        : summary.is_kitchen_open !== false
                          ? 'Open Now'
                          : 'Fresh Menu'}
                    </span>
                  </span>
                )}

                {/* Print & Digital Metadata */}
                {(vertical === 'print_digital' || isAcceptingPrintOnline) && (
                  <span className="inline-flex items-center gap-1 rounded-md border border-teal-500/25 bg-teal-500/10 px-1.5 py-0.5 text-[10px] font-bold text-teal-700 dark:text-teal-300 whitespace-nowrap">
                    <Zap className="w-3 h-3 shrink-0" />
                    <span>Express 30m</span>
                  </span>
                )}

                {/* Real Estate Sangam / Patta / Polygon Metadata */}
                {realEstateChips && (
                  <>
                    {realEstateChips.sangamText && (
                      <span className="inline-flex items-center rounded-md border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--ps-text)] whitespace-nowrap">
                        {realEstateChips.sangamText}
                      </span>
                    )}
                    {realEstateChips.pattaVerified && (
                      <span className="inline-flex items-center gap-0.5 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300 whitespace-nowrap">
                        <FileCheck2 className="w-2.5 h-2.5" />
                        <span>Patta</span>
                      </span>
                    )}
                    {realEstateChips.hasPolygon && (
                      <span
                        title="Mapped Plot Polygon"
                        className="inline-flex items-center gap-0.5 rounded-md border border-violet-500/25 bg-violet-500/10 px-1.5 py-0.5 text-[10px] font-bold text-violet-700 dark:text-violet-300 whitespace-nowrap"
                      >
                        <Pentagon className="w-2.5 h-2.5" />
                        <span>Plot Map</span>
                      </span>
                    )}
                  </>
                )}

                {/* Public Civic 24x7 Tag */}
                {vertical === 'public_civic' && (
                  <span className="inline-flex items-center gap-1 rounded-md border border-rose-500/25 bg-rose-500/10 px-1.5 py-0.5 text-[10px] font-bold text-rose-700 dark:text-rose-300 whitespace-nowrap">
                    <span>
                      {summary.is_24x7 ? '24×7 Helpline' : 'Public Helpline'}
                    </span>
                  </span>
                )}
              </div>

              {/* Resilient Owner Profile Chip with Initials Fallback */}
              <Link
                href={`/user/${encodeURIComponent(item.ownerId || 'owner-1')}`}
                onClick={(e) => e.stopPropagation()}
                title={`View public profile of ${liveOwnerName}`}
                aria-label={`View public profile of ${liveOwnerName}`}
                data-testid={`listing-card-owner-avatar-${item.id}`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface-alt)]/60 px-2 py-0.5 text-[10px] font-semibold text-[var(--ps-text-muted)] hover:border-[var(--ps-accent)] hover:text-[var(--ps-text)] transition-colors max-w-[128px] shrink-0"
              >
                {hasValidOwnerAvatar ? (
                  <Image
                    loader={supabaseMediaImageLoader}
                    unoptimized={false}
                    src={trimmedOwnerAvatar}
                    alt={liveOwnerName}
                    width={16}
                    height={16}
                    priority={false}
                    referrerPolicy="no-referrer"
                    onError={() => setFailedAvatarUrl(trimmedOwnerAvatar)}
                    className="h-4 w-4 rounded-full object-cover shrink-0"
                  />
                ) : (
                  <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[var(--ps-accent)] text-[8px] font-bold text-[var(--ps-accent-fg)] shrink-0">
                    {ownerInitials}
                  </span>
                )}
                <span className="truncate">{liveOwnerName}</span>
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Consistent Bottom Action Row (44px+ Touch Targets, Zero-Overlap on Mobile): Share, Save, Map Center, Pick N Drop, and 1-Tap Primary CTA */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="mt-1 flex flex-wrap items-center justify-between gap-1.5 border-t border-[var(--ps-border)]/80 pt-2.5"
      >
        <div className="flex items-center gap-1">
          {/* Rich Share Button */}
          <button
            type="button"
            onClick={handleOpenRichShare}
            title={`Share ${cleanTitle}`}
            aria-label={`Share ${cleanTitle}`}
            data-testid={`share-listing-${item.id}`}
            className="inline-flex min-h-[44px] min-w-[44px] h-11 w-11 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)]/60 text-[var(--ps-text-muted)] hover:border-[var(--ps-accent)] hover:text-[var(--ps-accent)] transition-colors cursor-pointer shrink-0"
          >
            <Share2 className="w-4 h-4" aria-hidden="true" />
          </button>

          {/* Save / Bookmark Button */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleSave();
              void toggleUnifiedSave('listing', item.id);
            }}
            aria-label={effectiveSaved ? 'Remove from saved' : 'Save listing'}
            title={effectiveSaved ? 'Remove from saved' : 'Save listing'}
            data-testid={`save-listing-${item.id}`}
            className={`inline-flex min-h-[44px] min-w-[44px] h-11 w-11 items-center justify-center rounded-xl border transition-colors cursor-pointer shrink-0 ${
              effectiveSaved
                ? 'border-[var(--ps-accent)] bg-[var(--ps-accent-soft)] text-[var(--ps-accent)]'
                : 'border-[var(--ps-border)] bg-[var(--ps-surface-alt)]/60 text-[var(--ps-text-muted)] hover:border-[var(--ps-accent)] hover:text-[var(--ps-text)]'
            }`}
          >
            <Bookmark
              className={`w-4 h-4 ${effectiveSaved ? 'fill-current' : ''}`}
              aria-hidden="true"
            />
          </button>

          {/* Show / Center on Map */}
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onSelect();
              onCenterOnMap();
            }}
            aria-label={
              context === 'list-grid'
                ? `Show ${cleanTitle} on map`
                : `Center map on ${cleanTitle}`
            }
            title={context === 'list-grid' ? 'Show on Map' : 'Center on Map'}
            data-testid={`center-on-map-${item.id}`}
            className="inline-flex min-h-[44px] min-w-[44px] h-11 w-11 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)]/60 text-[var(--ps-text-muted)] hover:border-[var(--ps-accent)] hover:text-[var(--ps-accent)] transition-colors cursor-pointer shrink-0"
          >
            <Crosshair className="w-4 h-4" aria-hidden="true" />
          </button>

          {/* Pick N Drop Quick Dispatch */}
          {vertical !== 'public_civic' &&
            (onStartPickNDrop ? (
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onStartPickNDrop();
                }}
                aria-label={`Book Pick N Drop from ${cleanTitle}`}
                title="Book Pick N Drop from here"
                data-testid={`pick-n-drop-listing-${item.id}`}
                className="inline-flex min-h-[44px] min-w-[44px] h-11 w-11 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)]/60 text-[var(--ps-text-muted)] hover:border-[var(--ps-accent)] hover:text-[var(--ps-accent)] transition-colors cursor-pointer shrink-0"
              >
                <Truck className="w-4 h-4" aria-hidden="true" />
              </button>
            ) : (
              <Link
                href={`/explore?mode=pick_n_drop&pickupLat=${encodeURIComponent(
                  String(item.coordinates.lat)
                )}&pickupLng=${encodeURIComponent(
                  String(item.coordinates.lng)
                )}&pickupLabel=${encodeURIComponent(cleanTitle)}`}
                aria-label={`Book Pick N Drop from ${cleanTitle}`}
                title="Book Pick N Drop from here"
                data-testid={`pick-n-drop-listing-${item.id}`}
                className="inline-flex min-h-[44px] min-w-[44px] h-11 w-11 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)]/60 text-[var(--ps-text-muted)] hover:border-[var(--ps-accent)] hover:text-[var(--ps-accent)] transition-colors shrink-0"
              >
                <Truck className="w-4 h-4" aria-hidden="true" />
              </Link>
            ))}
        </div>

        {/* 1-Tap Primary Vertical CTA */}
        {primaryCta.isExternalTel && primaryCta.href ? (
          <a
            href={primaryCta.href}
            data-testid={`primary-cta-listing-${item.id}`}
            className="inline-flex min-h-[44px] h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3.5 text-xs font-bold text-[var(--ps-accent-fg)] shadow-2xs transition-opacity hover:opacity-95 whitespace-nowrap"
          >
            <PrimaryCtaIcon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>{primaryCta.label}</span>
          </a>
        ) : primaryCta.href ? (
          <Link
            href={primaryCta.href}
            data-testid={
              vertical === 'print_digital' || isAcceptingPrintOnline
                ? `order-print-listing-${item.id}`
                : `primary-cta-listing-${item.id}`
            }
            className="inline-flex min-h-[44px] h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3.5 text-xs font-bold text-[var(--ps-accent-fg)] shadow-2xs transition-opacity hover:opacity-95 whitespace-nowrap"
          >
            <PrimaryCtaIcon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>{primaryCta.label}</span>
          </Link>
        ) : (
          <button
            type="button"
            onClick={onExpandDetails}
            data-testid={`primary-cta-listing-${item.id}`}
            className="inline-flex min-h-[44px] h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3.5 text-xs font-bold text-[var(--ps-accent-fg)] shadow-2xs transition-opacity hover:opacity-95 whitespace-nowrap cursor-pointer"
          >
            <PrimaryCtaIcon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>{primaryCta.label}</span>
          </button>
        )}
      </div>

      {/* Inline Selected Listing Controls when highlighted in Split Sidebar or Expanded Mobile Sheet */}
      {isInlineHighlighted && (
        <div
          data-testid="selected-listing-card"
          data-listing-id={item.id}
          onClick={(e) => e.stopPropagation()}
          className="pt-2 mt-0.5 border-t border-[var(--ps-border)]/60 flex flex-wrap items-center justify-between gap-1.5"
        >
          <button
            type="button"
            onClick={onExpandDetails}
            data-testid="expand-details-btn"
            className="w-full xl:w-auto xl:flex-1 min-h-[44px] h-11 px-3 rounded-xl bg-[var(--ps-surface-alt)] border border-[var(--ps-border)] text-[var(--ps-text)] text-xs font-bold hover:border-[var(--ps-accent)] inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap cursor-pointer"
          >
            <Expand className="w-3.5 h-3.5 shrink-0 text-[var(--ps-accent)]" aria-hidden="true" />
            <span className="truncate">Quick Summary</span>
          </button>

          <div className="flex items-center justify-between xl:justify-end w-full xl:w-auto gap-1.5 shrink-0">
            <button
              type="button"
              onClick={onZoomToItem}
              data-testid="zoom-to-item-btn"
              aria-label="Zoom in on listing location"
              title="Zoom to listing location"
              className="w-11 h-11 min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-xl bg-[var(--ps-surface-alt)] border border-[var(--ps-border)] text-[var(--ps-text)] hover:border-[var(--ps-accent)] transition-colors cursor-pointer"
            >
              <ZoomIn className="w-4 h-4 text-[var(--ps-accent)]" aria-hidden="true" />
            </button>

            <button
              type="button"
              onClick={onGetDirections}
              aria-label="Get Directions"
              title="Get Directions"
              data-testid="selected-card-directions-btn"
              className="min-h-[44px] h-11 px-3 rounded-xl bg-[var(--ps-surface-alt)] border border-[var(--ps-border)] text-[var(--ps-text)] hover:border-[var(--ps-accent)] inline-flex items-center justify-center gap-1.5 text-xs font-semibold transition-colors cursor-pointer"
            >
              <Navigation className="w-3.5 h-3.5 text-[var(--ps-accent)]" aria-hidden="true" />
              <span>Directions</span>
            </button>

            <button
              type="button"
              onClick={onClearSelection}
              aria-label="Close selected listing"
              title="Close selected listing"
              data-testid="close-selected-listing-btn"
              className="w-11 h-11 min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-xl bg-[var(--ps-surface-alt)] border border-[var(--ps-border)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:border-[var(--ps-accent)] transition-colors cursor-pointer"
            >
              <X className="w-4 h-4" aria-hidden="true" />
            </button>
          </div>
          {activeRouteEstimate && (
            <div
              data-testid="inline-card-route-estimate"
              className="w-full rounded-xl border border-sky-500/25 bg-sky-500/10 px-3 py-1.5 text-[11px] font-semibold text-sky-800 dark:text-sky-200 flex items-center justify-between"
            >
              <span>Shortest Route:</span>
              <span>
                {activeRouteEstimate.distanceText} •{' '}
                {activeRouteEstimate.durationText}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default ListingCard;

