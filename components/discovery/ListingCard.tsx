'use client';

import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  Bookmark,
  Crosshair,
  Expand,
  Heart,
  MapPin,
  Navigation,
  Package,
  Printer,
  Star,
  Truck,
  X,
  ZoomIn,
} from 'lucide-react';
import { useSavedInterests } from '@/lib/hooks/useSavedInterests';
import type { PrintProfileBadgeSummary } from '@/lib/print-orders/client-helpers';
import {
  CATEGORY_LABELS,
  formatArea,
  getListingPriceLabel,
  shouldShowPlotAndBoundary,
} from '@/lib/rules';
import { useLiveOwnerProfile } from '@/lib/supabase/profiles';
import { supabaseMediaImageLoader } from '@/lib/supabase/storage';
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
  const hasValid360Panorama =
    item.category === 'real_estate' &&
    (Boolean(re?.panoramaUrl?.trim()) ||
      (Array.isArray(re?.panoramas) &&
        re.panoramas.some((p) => Boolean(p?.imageUrl?.trim()))));
  const priceLabel = getListingPriceLabel(item);
  const { ownerName: liveOwnerName, ownerAvatarUrl: liveOwnerAvatarUrl } =
    useLiveOwnerProfile(item.ownerId, item.ownerName, item.ownerAvatarUrl);
  const {
    isSaved: isUnifiedSaved,
    toggleSave: toggleUnifiedSave,
    isFollowing,
    toggleFollow,
  } = useSavedInterests();
  const effectiveSaved = isSaved || isUnifiedSaved('listing', item.id);
  const followingShop = isFollowing('shop_listing', item.id);

  return (
    <div
      data-testid={`listing-card-${item.id}`}
      data-listing-id={item.id}
      data-selected={isSelected ? 'true' : 'false'}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onSelect}
      className={`group relative w-full max-w-[440px] mx-auto rounded-xl border bg-[var(--ps-surface)] transition-all duration-150 ease-out cursor-pointer ${
        isMobileLandscape ? 'p-2 gap-1.5' : 'p-2.5 sm:p-3 gap-2'
      } flex flex-col justify-between ${
        isSelected
          ? 'border-[var(--ps-accent)] ring-1 ring-[var(--ps-accent)]/35 shadow-sm bg-[var(--ps-surface-alt)]/25'
          : isHovered
            ? 'border-[var(--ps-accent)]/70 shadow-sm bg-[var(--ps-surface-alt)]/30'
            : 'border-gray-200/80 dark:border-gray-800/80 hover:border-[var(--ps-accent)]/50 shadow-2xs'
      }`}
    >
      <div className="flex items-stretch gap-2.5 sm:gap-3">
        {/* Aspect-locked Thumbnail with resilient category fallback */}
        <ListingThumbnail
          src={item.coverImage}
          alt={item.title}
          category={item.category}
          show360Badge={hasValid360Panorama}
          priority={false}
          imgClassName="group-hover:scale-105 transition-transform duration-300"
          className={
            isMobileLandscape
              ? 'w-18 h-18'
              : isCompactGrid
                ? 'w-20 h-20 sm:w-[88px] sm:h-[88px]'
                : 'w-20 h-20 sm:w-[92px] sm:h-[92px]'
          }
        />

        {/* Minimalist Editorial Card Content Hierarchy */}
        <div className="flex-1 min-w-0 flex flex-col justify-between">
          <div>
            {/* Row 1: Subtle Category Kicker & Tag Chips + Quick Action Controls */}
            <div className="flex items-center justify-between gap-1.5">
              <div className="flex items-center gap-1 min-w-0 text-[10px] leading-none">
                <span className="px-1.5 py-0.5 rounded bg-[var(--ps-surface-alt)]/70 text-[9px] font-semibold uppercase tracking-wider text-[var(--ps-text-muted)] truncate">
                  {CATEGORY_LABELS[item.category]}
                </span>
                <span className="font-medium text-[var(--ps-text-muted)]/85 truncate hidden sm:inline">
                  {item.subcategory}
                </span>
                {showOutsideViewportBadge && (
                  <span
                    data-testid={`outside-viewport-badge-${item.id}`}
                    className="text-[9px] font-medium px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-700 dark:text-amber-300 border border-amber-500/20 whitespace-nowrap shrink-0"
                  >
                    Outside Map View
                  </span>
                )}
              </div>

              <div className="flex items-center shrink-0 -my-2.5 -mr-1.5 gap-0.5">
                {isAcceptingPrintOnline && (
                  <Link
                    href={`/listing/${encodeURIComponent(item.id)}/print`}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Order print online from ${item.title}`}
                    title={
                      printProfile?.isFirstParty
                        ? 'Official PrintSwift — Start Print Order'
                        : 'Order Print Online'
                    }
                    data-testid={`order-print-listing-${item.id}`}
                    className="inline-flex h-7 items-center gap-1 rounded-full bg-theme-primary px-2 text-[11px] font-bold text-[hsl(var(--color-primary-foreground))] shadow-2xs transition-opacity hover:opacity-90 shrink-0 whitespace-nowrap"
                  >
                    <Printer className="w-3 h-3 shrink-0" aria-hidden="true" />
                    <span>Order Print</span>
                  </Link>
                )}
                {onStartPickNDrop ? (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onStartPickNDrop();
                    }}
                    aria-label={`Book Pick N Drop from ${item.title}`}
                    title="Book Pick N Drop from here"
                    data-testid={`pick-n-drop-listing-${item.id}`}
                    className="w-7 h-7 inline-flex items-center justify-center rounded-md text-[var(--ps-text-muted)] hover:text-[var(--ps-accent)] hover:bg-[var(--ps-surface-alt)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)]"
                  >
                    <Truck className="w-3.5 h-3.5" aria-hidden="true" />
                  </button>
                ) : (
                  <Link
                    href={`/explore?mode=pick_n_drop&pickupLat=${encodeURIComponent(
                      String(item.coordinates.lat)
                    )}&pickupLng=${encodeURIComponent(
                      String(item.coordinates.lng)
                    )}&pickupLabel=${encodeURIComponent(item.title)}`}
                    onClick={(e) => e.stopPropagation()}
                    aria-label={`Book Pick N Drop from ${item.title}`}
                    title="Book Pick N Drop from here"
                    data-testid={`pick-n-drop-listing-${item.id}`}
                    className="w-7 h-7 inline-flex items-center justify-center rounded-md text-[var(--ps-text-muted)] hover:text-[var(--ps-accent)] hover:bg-[var(--ps-surface-alt)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)]"
                  >
                    <Truck className="w-3.5 h-3.5" aria-hidden="true" />
                  </Link>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect();
                    onCenterOnMap();
                  }}
                  aria-label={
                    context === 'list-grid'
                      ? `Show ${item.title} on map`
                      : `Center map on ${item.title}`
                  }
                  title={
                    context === 'list-grid' ? 'Show on Map' : 'Center on Map'
                  }
                  data-testid={`center-on-map-${item.id}`}
                  className="w-7 h-7 inline-flex items-center justify-center rounded-md text-[var(--ps-text-muted)] hover:text-[var(--ps-accent)] hover:bg-[var(--ps-surface-alt)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)]"
                >
                  <Crosshair className="w-3.5 h-3.5" aria-hidden="true" />
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    void toggleFollow('shop_listing', item.id);
                  }}
                  aria-label={followingShop ? 'Unfollow place' : 'Follow place'}
                  title={followingShop ? 'Following' : 'Follow place'}
                  data-testid={`follow-listing-${item.id}`}
                  className="w-8 h-8 inline-flex items-center justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)]"
                >
                  <span
                    className={`w-6.5 h-6.5 rounded-md inline-flex items-center justify-center transition-colors ${
                      followingShop
                        ? 'text-rose-500 bg-rose-500/10'
                        : 'text-[var(--ps-text-muted)] hover:text-rose-500 hover:bg-[var(--ps-surface-alt)]'
                    }`}
                  >
                    <Heart
                      className={`w-3.5 h-3.5 ${followingShop ? 'fill-current' : ''}`}
                      aria-hidden="true"
                    />
                  </span>
                </button>
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
                  className="w-8 h-8 inline-flex items-center justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)]"
                >
                  <span
                    className={`w-6.5 h-6.5 rounded-md inline-flex items-center justify-center transition-colors ${
                      effectiveSaved
                        ? 'text-[var(--ps-accent)] bg-[var(--ps-surface-alt)]'
                        : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                    }`}
                  >
                    <Bookmark
                      className={`w-3.5 h-3.5 ${effectiveSaved ? 'fill-current' : ''}`}
                      aria-hidden="true"
                    />
                  </span>
                </button>
              </div>
            </div>

            {/* Row 2: Primary Listing Title */}
            <h3
              data-testid={
                isInlineHighlighted ? 'selected-listing-title' : undefined
              }
              className="text-xs sm:text-sm font-bold tracking-tight text-[var(--ps-text)] group-hover:text-[var(--ps-accent)] transition-colors leading-snug line-clamp-1 mt-1 pr-1"
            >
              {item.title}
            </h3>

            {/* Row 3: Unboxed Locality & Rating */}
            <div className="flex items-center gap-1 text-[11px] text-[var(--ps-text-muted)] mt-0.5 min-w-0 leading-tight">
              <MapPin
                className="w-3 h-3 shrink-0 text-[var(--ps-text-muted)]"
                aria-hidden="true"
              />
              <span className="truncate font-medium">{item.locality}</span>
              <span
                aria-hidden="true"
                className="text-[var(--ps-border)] shrink-0"
              >
                ·
              </span>
              <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-amber-500 tabular-nums shrink-0">
                <Star className="w-3 h-3 fill-current" aria-hidden="true" />
                <span>{item.rating}</span>
              </span>
            </div>
          </div>

          {/* Row 4: Supporting Price / Area / Catalogue Summary + Live Supabase Owner Profile Chip */}
          <div className="mt-1.5 pt-1.5 border-t border-gray-100 dark:border-gray-800/70 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 min-w-0 text-[11px] leading-tight">
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 min-w-0">
              {priceLabel ? (
                <span className="font-bold text-[var(--ps-text)] tabular-nums truncate max-w-full">
                  {priceLabel}
                </span>
              ) : (
                <span className="font-medium text-[var(--ps-text-muted)] truncate max-w-full">
                  {item.subcategory}
                </span>
              )}

              {item.category === 'real_estate' && re && (
                <span className="text-[10px] font-medium text-[var(--ps-text-muted)] tabular-nums shrink-0 whitespace-nowrap">
                  ·{' '}
                  {showPlot && re.plotAreaSqm
                    ? `Plot: ${formatArea(re.plotAreaSqm, areaUnit)}`
                    : re.builtUpAreaSqm
                      ? `Built: ${formatArea(re.builtUpAreaSqm, areaUnit)}`
                      : (re.propertyType || 'real_estate').replace(/_/g, ' ')}
                </span>
              )}

              {item.category === 'business' && item.businessDetails && (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[var(--ps-text-muted)] shrink-0 whitespace-nowrap">
                  ·
                  <Package
                    className="w-3 h-3 text-[var(--ps-text-muted)] shrink-0"
                    aria-hidden="true"
                  />
                  <span>
                    {Array.isArray(item.businessDetails.catalogue)
                      ? item.businessDetails.catalogue.length
                      : 0}{' '}
                    items
                  </span>
                </span>
              )}
            </div>

            <Link
              href={`/user/${encodeURIComponent(item.ownerId || 'owner-1')}`}
              onClick={(e) => e.stopPropagation()}
              title={`View public profile of ${liveOwnerName}`}
              aria-label={`View public profile of ${liveOwnerName}`}
              data-testid={`listing-card-owner-avatar-${item.id}`}
              className="inline-flex items-center gap-1 rounded-md border border-gray-200/70 dark:border-gray-800 bg-[var(--ps-surface-alt)]/50 px-1.5 py-0.5 text-[10px] font-medium text-[var(--ps-text-muted)] hover:border-[var(--ps-accent)]/50 hover:text-[var(--ps-text)] transition-colors max-w-[140px] shrink-0"
            >
              {liveOwnerAvatarUrl.trim() ? (
                <Image
                  loader={supabaseMediaImageLoader}
                  unoptimized={false}
                  src={liveOwnerAvatarUrl.trim()}
                  alt={liveOwnerName}
                  width={14}
                  height={14}
                  priority={false}
                  referrerPolicy="no-referrer"
                  className="h-3.5 w-3.5 rounded object-cover shrink-0"
                />
              ) : (
                <span className="flex h-3.5 w-3.5 items-center justify-center rounded bg-[var(--ps-accent)] text-[7px] font-bold text-[var(--ps-accent-fg)] shrink-0">
                  {(liveOwnerName || 'OW')
                    .split(' ')
                    .map((part) => part[0])
                    .join('')
                    .slice(0, 2)
                    .toUpperCase()}
                </span>
              )}
              <span className="truncate">{liveOwnerName}</span>
            </Link>
          </div>
        </div>
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
            className="w-full xl:w-auto xl:flex-1 min-h-[40px] h-10 px-3 rounded-lg bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-semibold hover:opacity-95 inline-flex items-center justify-center gap-1.5 shadow-2xs transition-opacity whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)]"
          >
            <Expand className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">Expand Details</span>
          </button>

          <div className="flex items-center justify-between xl:justify-end w-full xl:w-auto gap-1 shrink-0">
            <button
              type="button"
              onClick={onCenterOnMap}
              data-testid="center-on-map-btn"
              aria-label="Center map on selected listing"
              title="Center on Map"
              className="w-10 h-10 min-w-[40px] min-h-[40px] inline-flex items-center justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)]"
            >
              <span className="w-8 h-8 rounded-lg bg-[var(--ps-surface-alt)] border border-[var(--ps-border)]/80 text-[var(--ps-text)] hover:border-[var(--ps-accent)] inline-flex items-center justify-center transition-colors">
                <Crosshair
                  className="w-3.5 h-3.5 text-[var(--ps-accent)]"
                  aria-hidden="true"
                />
              </span>
            </button>

            <button
              type="button"
              onClick={onZoomToItem}
              data-testid="zoom-to-item-btn"
              aria-label={
                item.category === 'real_estate' &&
                item.realEstateDetails?.boundaryPolygon &&
                item.realEstateDetails.boundaryPolygon.length >= 3
                  ? 'Zoom to fit property boundary'
                  : 'Zoom in on listing location'
              }
              title={
                item.category === 'real_estate' &&
                item.realEstateDetails?.boundaryPolygon &&
                item.realEstateDetails.boundaryPolygon.length >= 3
                  ? 'Zoom to fit boundary geometry'
                  : 'Zoom to listing location'
              }
              className="w-10 h-10 min-w-[40px] min-h-[40px] inline-flex items-center justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)]"
            >
              <span className="w-8 h-8 rounded-lg bg-[var(--ps-surface-alt)] border border-[var(--ps-border)]/80 text-[var(--ps-text)] hover:border-[var(--ps-accent)] inline-flex items-center justify-center transition-colors">
                <ZoomIn
                  className="w-3.5 h-3.5 text-[var(--ps-accent)]"
                  aria-hidden="true"
                />
              </span>
            </button>

            <button
              type="button"
              onClick={onGetDirections}
              aria-label="Get Directions"
              title="Get Directions"
              data-testid="selected-card-directions-btn"
              className="min-h-[40px] h-10 px-2 inline-flex items-center justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)]"
            >
              <span className="h-8 px-2.5 rounded-lg bg-[var(--ps-surface-alt)] border border-[var(--ps-border)]/80 text-[var(--ps-text)] hover:border-[var(--ps-accent)] inline-flex items-center justify-center gap-1 text-[11px] font-semibold transition-colors">
                <Navigation
                  className="w-3.5 h-3.5 text-[var(--ps-accent)]"
                  aria-hidden="true"
                />
                <span>Get Directions</span>
              </span>
            </button>

            <button
              type="button"
              onClick={onClearSelection}
              aria-label="Close selected listing"
              title="Close selected listing"
              data-testid="close-selected-listing-btn"
              className="w-10 h-10 min-w-[40px] min-h-[40px] inline-flex items-center justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)]"
            >
              <span className="w-8 h-8 rounded-lg bg-[var(--ps-surface-alt)] border border-[var(--ps-border)]/80 text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:border-[var(--ps-accent)] inline-flex items-center justify-center transition-colors">
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </span>
            </button>
          </div>
          {activeRouteEstimate && (
            <div
              data-testid="inline-card-route-estimate"
              className="w-full rounded-lg border border-sky-500/25 bg-sky-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-sky-800 dark:text-sky-200 flex items-center justify-between"
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
