'use client';

import React, { useState } from 'react';
import {
  ArrowLeft,
  Bookmark,
  Briefcase,
  Building2,
  Compass,
  Crosshair,
  Expand,
  Landmark,
  MapPin,
  Navigation,
  PanelRightOpen,
  Star,
  Store,
  Trophy,
  X,
  ZoomIn,
} from 'lucide-react';
import {
  CATEGORY_LABELS,
  formatArea,
  getListingPriceLabel,
  shouldShowPlotAndBoundary,
} from '@/lib/rules';
import { useAppStore } from '@/lib/store';
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
  className?: string;
  imgClassName?: string;
  testId?: string;
}

export function ListingThumbnail({
  src,
  alt,
  category,
  show360Badge = false,
  className = 'w-[88px] h-[88px] sm:w-[92px] sm:h-[92px]',
  imgClassName = '',
  testId,
}: ListingThumbnailProps) {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);
  const trimmedSrc = src?.trim() || '';
  const showFallback = !trimmedSrc || failedSrc === trimmedSrc;

  return (
    <div
      data-testid={testId}
      data-image-fallback={showFallback ? 'true' : 'false'}
      className={`relative rounded-xl overflow-hidden bg-[var(--ps-surface-alt)] border border-[var(--ps-border)] shrink-0 select-none ${className}`}
    >
      {!showFallback ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={trimmedSrc}
          alt={alt}
          loading="lazy"
          decoding="async"
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
  onReopenDesktopSidebar?: () => void;
  showReopenSidebarAction?: boolean;
  variant?: 'desktop-sidebar' | 'mobile-overlay';
}

export function SelectedListingCard({
  listing,
  onClearSelection,
  onExpandDetails,
  onCenterOnMap,
  onZoomToItem,
  onReopenDesktopSidebar,
  showReopenSidebarAction = false,
  variant = 'desktop-sidebar',
}: SelectedListingCardProps) {
  const {
    savedListingIds,
    toggleSavedListing,
    recordListingInteraction,
    areaUnit,
  } = useAppStore();

  const isSaved = savedListingIds.includes(listing.id);
  const re = listing.realEstateDetails;
  const showPlot = re
    ? shouldShowPlotAndBoundary(re.propertyType, re.hasAssociatedPlot)
    : false;
  const priceLabel = getListingPriceLabel(listing);

  const googleDirectionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${listing.coordinates.lat},${listing.coordinates.lng}`;

  const secondaryMetricLabel = (() => {
    if (listing.category === 'real_estate' && re) {
      if (showPlot && re.plotAreaSqm) {
        return `Plot: ${formatArea(re.plotAreaSqm, areaUnit)}`;
      }
      if (re.builtUpAreaSqm) {
        return `Built: ${formatArea(re.builtUpAreaSqm, areaUnit)}`;
      }
      return re.propertyType.replace(/_/g, ' ');
    }
    if (listing.category === 'business' && listing.businessDetails) {
      return `${listing.businessDetails.catalogue.length} items`;
    }
    if (listing.category === 'service' && listing.serviceDetails) {
      return listing.serviceDetails.availabilityStatus;
    }
    if (listing.category === 'sports' && listing.sportsDetails) {
      return listing.sportsDetails.sportActivity;
    }
    return listing.subcategory;
  })();

  if (variant === 'mobile-overlay') {
    return (
      <div
        className="w-full rounded-2xl bg-[var(--ps-surface)]/98 backdrop-blur-md text-[var(--ps-text)] border border-[var(--ps-border)] shadow-2xl overflow-hidden"
        data-testid="selected-listing-card"
        data-listing-id={listing.id}
        role="region"
        aria-label={`Selected listing: ${listing.title}`}
      >
        <div className="p-3">
          {/* Top row: Locked-aspect Thumbnail + Aligned Content Hierarchy */}
          <div className="flex items-stretch gap-2.5 sm:gap-3">
            <ListingThumbnail
              testId="listing-thumbnail"
              src={listing.coverImage}
              alt={listing.title}
              category={listing.category}
              show360Badge={listing.category === 'real_estate'}
              className="w-[84px] h-[84px] sm:w-[92px] sm:h-[92px]"
            />

            <div className="flex-1 min-w-0 flex flex-col justify-between">
              <div>
                <div className="flex items-center justify-between gap-1.5">
                  <div className="flex items-center gap-1.5 min-w-0">
                    <span className="inline-block text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-[var(--ps-surface-alt)] text-[var(--ps-accent)] truncate">
                      {CATEGORY_LABELS[listing.category]}
                    </span>
                    <span className="text-[10px] font-medium text-[var(--ps-text-muted)] truncate hidden sm:inline">
                      {listing.subcategory}
                    </span>
                  </div>

                  <div className="flex items-center gap-0.5 shrink-0 -my-2.5 -mr-2">
                    {showReopenSidebarAction && onReopenDesktopSidebar && (
                      <button
                        type="button"
                        onClick={onReopenDesktopSidebar}
                        aria-label="Reopen listing sidebar"
                        title="Reopen contextual listing sidebar"
                        data-testid="reopen-sidebar-from-card-btn"
                        className="min-h-[36px] py-1 px-2 rounded-lg bg-[var(--ps-surface-alt)] border border-[var(--ps-border)] text-[var(--ps-text)] text-[10px] font-semibold hover:bg-[var(--ps-bg)] inline-flex items-center justify-center gap-1 shrink-0 transition-colors"
                      >
                        <PanelRightOpen
                          className="w-3 h-3 text-[var(--ps-accent)]"
                          aria-hidden="true"
                        />
                        <span>Open Sidebar</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={onClearSelection}
                      aria-label="Close selected listing"
                      title="Close selected listing"
                      data-testid="close-selected-listing-btn"
                      className="w-11 h-11 min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)]"
                    >
                      <span className="w-7 h-7 rounded-lg inline-flex items-center justify-center hover:bg-[var(--ps-surface-alt)] transition-colors">
                        <X className="w-4 h-4" aria-hidden="true" />
                      </span>
                    </button>
                  </div>
                </div>

                <h3
                  data-testid="selected-listing-title"
                  className="text-[13px] sm:text-sm font-bold text-[var(--ps-text)] leading-snug line-clamp-1 mt-0.5 pr-1"
                >
                  {listing.title}
                </h3>

                <div className="flex items-center gap-1 text-[11px] text-[var(--ps-text-muted)] mt-0.5 min-w-0">
                  <MapPin
                    className="w-3 h-3 shrink-0 text-[var(--ps-accent)]"
                    aria-hidden="true"
                  />
                  <span className="truncate">{listing.locality}</span>
                  <span aria-hidden="true" className="text-[var(--ps-border)] shrink-0">
                    ·
                  </span>
                  <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-amber-500 tabular-nums shrink-0">
                    <Star className="w-3 h-3 fill-current" aria-hidden="true" />
                    <span>{listing.rating}</span>
                  </span>
                </div>
              </div>

              {/* Supporting Price & Category Metric Strip */}
              <div className="mt-1.5 pt-1.5 border-t border-[var(--ps-border)]/70 flex items-center justify-between gap-2 text-[11px] leading-tight">
                {priceLabel ? (
                  <span className="font-bold text-[var(--ps-text)] tabular-nums truncate">
                    {priceLabel}
                  </span>
                ) : (
                  <span className="font-medium text-[var(--ps-text-muted)] truncate">
                    {listing.subcategory}
                  </span>
                )}
                {secondaryMetricLabel && (
                  <span className="text-[10px] font-medium text-[var(--ps-text-muted)] tabular-nums shrink-0 truncate max-w-[48%]">
                    {secondaryMetricLabel}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Responsive Action Bar: Prominent Expand Details CTA + Icon-Only Secondary Actions */}
          <div className="mt-2.5 pt-2 border-t border-[var(--ps-border)] flex flex-wrap sm:flex-nowrap items-center justify-between gap-1.5">
            <button
              type="button"
              onClick={onExpandDetails}
              data-testid="expand-details-btn"
              className="flex-1 min-w-[120px] min-h-[44px] h-11 px-3 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-semibold hover:opacity-95 inline-flex items-center justify-center gap-1.5 shadow-2xs transition-opacity whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)]"
            >
              <Expand className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">Expand Details</span>
            </button>

            <div className="flex items-center gap-1 shrink-0">
              {onCenterOnMap && (
                <button
                  type="button"
                  onClick={onCenterOnMap}
                  aria-label="Center map on selected listing"
                  title="Center map on this listing"
                  data-testid="center-on-map-btn"
                  className="w-11 h-11 min-w-[44px] min-h-[44px] rounded-xl bg-[var(--ps-bg)] border border-[var(--ps-border)] text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] hover:border-[var(--ps-accent)] inline-flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)]"
                >
                  <Crosshair
                    className="w-4 h-4 text-[var(--ps-accent)] shrink-0"
                    aria-hidden="true"
                  />
                </button>
              )}

              {onZoomToItem && (
                <button
                  type="button"
                  onClick={onZoomToItem}
                  aria-label={
                    listing.category === 'real_estate' &&
                    listing.realEstateDetails?.boundaryPolygon &&
                    listing.realEstateDetails.boundaryPolygon.length >= 3
                      ? 'Zoom to fit property boundary'
                      : 'Zoom in on listing location'
                  }
                  title={
                    listing.category === 'real_estate' &&
                    listing.realEstateDetails?.boundaryPolygon &&
                    listing.realEstateDetails.boundaryPolygon.length >= 3
                      ? 'Zoom to fit boundary geometry'
                      : 'Zoom to listing location'
                  }
                  data-testid="zoom-to-item-btn"
                  className="w-11 h-11 min-w-[44px] min-h-[44px] rounded-xl bg-[var(--ps-bg)] border border-[var(--ps-border)] text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] hover:border-[var(--ps-accent)] inline-flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)]"
                >
                  <ZoomIn
                    className="w-4 h-4 text-[var(--ps-accent)] shrink-0"
                    aria-hidden="true"
                  />
                </button>
              )}

              <button
                type="button"
                onClick={() => toggleSavedListing(listing.id)}
                aria-label={
                  isSaved ? 'Remove from saved listings' : 'Save listing'
                }
                title={isSaved ? 'Remove from saved listings' : 'Save listing'}
                data-testid="selected-card-save-btn"
                className={`w-11 h-11 min-w-[44px] min-h-[44px] rounded-xl border inline-flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)] ${
                  isSaved
                    ? 'bg-[var(--ps-surface-alt)] border-[var(--ps-accent)] text-[var(--ps-text)]'
                    : 'bg-[var(--ps-bg)] border-[var(--ps-border)] text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] hover:border-[var(--ps-accent)]'
                }`}
              >
                <Bookmark
                  className={`w-4 h-4 shrink-0 ${
                    isSaved
                      ? 'fill-current text-[var(--ps-accent)]'
                      : 'text-[var(--ps-text-muted)]'
                  }`}
                  aria-hidden="true"
                />
              </button>

              <a
                href={googleDirectionsUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() =>
                  recordListingInteraction(listing.id, 'directionClicksCount')
                }
                aria-label="Get directions"
                title="Get directions"
                data-testid="selected-card-directions-btn"
                className="w-11 h-11 min-w-[44px] min-h-[44px] rounded-xl bg-[var(--ps-bg)] border border-[var(--ps-border)] text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] hover:border-[var(--ps-accent)] inline-flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)]"
              >
                <Navigation
                  className="w-4 h-4 text-[var(--ps-accent)] shrink-0"
                  aria-hidden="true"
                />
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className="flex flex-col h-full bg-[var(--ps-surface)] text-[var(--ps-text)]"
      data-testid="selected-listing-card"
    >
      {/* Top Action Bar to Clear Selection and Return to List */}
      <div className="px-4 py-3 border-b border-[var(--ps-border)] bg-[var(--ps-surface-alt)] flex items-center justify-between gap-2 shrink-0">
        <button
          type="button"
          onClick={onClearSelection}
          className="inline-flex items-center gap-1.5 text-xs font-semibold text-[var(--ps-text)] hover:opacity-80"
        >
          <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Back to Results List</span>
        </button>

        <div className="flex items-center gap-1.5">
          <span className="text-[11px] text-[var(--ps-text-muted)]">
            Selected Listing
          </span>
          <button
            type="button"
            onClick={onClearSelection}
            aria-label="Clear selected listing"
            title="Clear selected listing"
            data-testid="close-selected-listing-btn"
            className="w-9 h-9 inline-flex items-center justify-center rounded-lg hover:bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Scrollable Card Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {/* Cover Image */}
        <div className="relative h-44 w-full rounded-xl overflow-hidden bg-slate-900 border border-[var(--ps-border)]">
          <ListingThumbnail
            testId="listing-thumbnail"
            src={listing.coverImage}
            alt={listing.title}
            category={listing.category}
            className="w-full h-full rounded-none border-0"
          />
          <div className="absolute top-2.5 left-2.5 bg-slate-950/85 backdrop-blur px-2.5 py-1 rounded-md border border-white/15 text-white text-[10px] font-bold uppercase tracking-wider">
            {CATEGORY_LABELS[listing.category]}
          </div>
          <div className="absolute top-2.5 right-2.5 flex items-center gap-1.5 bg-slate-950/85 backdrop-blur px-2.5 py-1 rounded-md border border-white/15 text-white text-xs">
            <span className="font-medium truncate max-w-[120px]">
              {listing.subcategory}
            </span>
            <span className="text-white/40">·</span>
            <span className="inline-flex items-center gap-1 text-amber-300 font-semibold tabular-nums shrink-0">
              <Star className="w-3.5 h-3.5 fill-current" aria-hidden="true" />
              {listing.rating} ({listing.reviewCount})
            </span>
          </div>
        </div>

        {/* Title, Locality & Summary */}
        <div className="space-y-1.5">
          <div className="flex items-center gap-1.5 text-xs text-[var(--ps-text-muted)]">
            <MapPin
              className="w-3.5 h-3.5 text-[var(--ps-accent)] shrink-0"
              aria-hidden="true"
            />
            <span className="font-medium text-[var(--ps-text)]">
              {listing.locality}
            </span>
            <span>·</span>
            <span className="capitalize">
              {listing.status.replace(/_/g, ' ')}
            </span>
          </div>
          <h3 className="text-base font-bold text-[var(--ps-text)] leading-snug">
            {listing.title}
          </h3>
          <p className="text-xs text-[var(--ps-text-muted)] leading-relaxed">
            {listing.shortDescription}
          </p>
        </div>

        {/* Category-Specific Key Parameters */}
        <div className="p-3.5 rounded-xl bg-[var(--ps-bg)] border border-[var(--ps-border)] space-y-2 text-xs">
          <div className="flex items-center gap-1.5 text-[var(--ps-text-muted)]">
            <MapPin className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{listing.address}</span>
          </div>

          {listing.category === 'real_estate' && re && (
            <div className="pt-2 border-t border-[var(--ps-border)] space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[var(--ps-text-muted)]">Sample Price:</span>
                <span className="font-bold text-[var(--ps-text)] tabular-nums">
                  {re.priceLabel}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--ps-text-muted)]">Availability:</span>
                <span className="font-medium text-[var(--ps-text)] capitalize">
                  {re.availability.replace(/_/g, ' ')}
                </span>
              </div>
              {showPlot && re.plotAreaSqm && (
                <div className="flex items-center justify-between">
                  <span className="text-[var(--ps-text-muted)]">Plot Area:</span>
                  <span className="font-semibold text-[var(--ps-text)] tabular-nums">
                    {formatArea(re.plotAreaSqm, areaUnit)}
                  </span>
                </div>
              )}
              {!showPlot && re.builtUpAreaSqm && (
                <div className="flex items-center justify-between">
                  <span className="text-[var(--ps-text-muted)]">
                    Built-Up Area:
                  </span>
                  <span className="font-semibold text-[var(--ps-text)] tabular-nums">
                    {formatArea(re.builtUpAreaSqm, areaUnit)}
                  </span>
                </div>
              )}
              {re.bedrooms !== undefined && (
                <div className="flex items-center justify-between">
                  <span className="text-[var(--ps-text-muted)]">
                    Configuration:
                  </span>
                  <span className="font-medium text-[var(--ps-text)]">
                    {re.bedrooms} BHK · {re.bathrooms || 1} Bath
                  </span>
                </div>
              )}
              <div className="pt-1 flex items-center gap-1.5 text-emerald-700 dark:text-emerald-400 font-medium">
                <Compass className="w-3.5 h-3.5" aria-hidden="true" />
                <span>
                  Includes {re.panoramas.length} Mandatory 360° Panorama Scene(s)
                </span>
              </div>
            </div>
          )}

          {listing.category === 'business' && listing.businessDetails && (
            <div className="pt-2 border-t border-[var(--ps-border)] space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[var(--ps-text-muted)]">Hours:</span>
                <span className="font-medium text-[var(--ps-text)]">
                  {listing.businessDetails.openingHours}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--ps-text-muted)]">
                  Catalogue Items:
                </span>
                <span className="font-semibold text-[var(--ps-text)] tabular-nums">
                  {listing.businessDetails.catalogue.length} sample products
                </span>
              </div>
            </div>
          )}

          {listing.category === 'service' && listing.serviceDetails && (
            <div className="pt-2 border-t border-[var(--ps-border)] space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[var(--ps-text-muted)]">Sample Rate:</span>
                <span className="font-semibold text-[var(--ps-text)] tabular-nums">
                  {listing.serviceDetails.priceRangeText}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--ps-text-muted)]">Availability:</span>
                <span className="font-medium text-[var(--ps-text)]">
                  {listing.serviceDetails.availabilityStatus}
                </span>
              </div>
            </div>
          )}

          {listing.category === 'sports' && listing.sportsDetails && (
            <div className="pt-2 border-t border-[var(--ps-border)] space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[var(--ps-text-muted)]">Activity:</span>
                <span className="font-medium text-[var(--ps-text)]">
                  {listing.sportsDetails.sportActivity}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span className="text-[var(--ps-text-muted)]">Capacity:</span>
                <span className="font-semibold text-[var(--ps-text)] tabular-nums">
                  {listing.sportsDetails.capacity} people
                </span>
              </div>
            </div>
          )}

          {listing.category === 'public_place' && listing.publicPlaceDetails && (
            <div className="pt-2 border-t border-[var(--ps-border)] space-y-1">
              <div className="text-[var(--ps-text-muted)]">
                {listing.publicPlaceDetails.openingHours}
              </div>
              <div className="text-[11px] text-amber-700 dark:text-amber-300">
                {listing.publicPlaceDetails.verificationSourceLabel}
              </div>
            </div>
          )}
        </div>

        {/* Action Buttons: Prominent Expand Details action + Icon-Only Secondary Actions */}
        <div className="space-y-2 pt-1 border-t border-[var(--ps-border)]">
          <button
            type="button"
            onClick={onExpandDetails}
            data-testid="expand-details-btn"
            className="w-full min-h-[44px] h-11 px-4 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-semibold hover:opacity-90 flex items-center justify-center gap-2 shadow-xs transition-opacity focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)]"
          >
            <Expand className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Expand Details</span>
          </button>

          <div className="grid grid-cols-4 gap-1.5">
            {onCenterOnMap && (
              <button
                type="button"
                onClick={onCenterOnMap}
                aria-label="Center map on selected listing"
                title="Center map on this listing"
                data-testid="center-on-map-btn"
                className="h-11 min-h-[44px] min-w-[44px] rounded-xl bg-[var(--ps-bg)] border border-[var(--ps-border)] text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] hover:border-[var(--ps-accent)] inline-flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)]"
              >
                <Crosshair
                  className="w-4 h-4 text-[var(--ps-accent)]"
                  aria-hidden="true"
                />
              </button>
            )}

            {onZoomToItem && (
              <button
                type="button"
                onClick={onZoomToItem}
                aria-label={
                  listing.category === 'real_estate' &&
                  listing.realEstateDetails?.boundaryPolygon &&
                  listing.realEstateDetails.boundaryPolygon.length >= 3
                    ? 'Zoom to fit property boundary'
                    : 'Zoom in on listing location'
                }
                title={
                  listing.category === 'real_estate' &&
                  listing.realEstateDetails?.boundaryPolygon &&
                  listing.realEstateDetails.boundaryPolygon.length >= 3
                    ? 'Zoom to fit boundary geometry'
                    : 'Zoom to listing location'
                }
                data-testid="zoom-to-item-btn"
                className="h-11 min-h-[44px] min-w-[44px] rounded-xl bg-[var(--ps-bg)] border border-[var(--ps-border)] text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] hover:border-[var(--ps-accent)] inline-flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)]"
              >
                <ZoomIn
                  className="w-4 h-4 text-[var(--ps-accent)]"
                  aria-hidden="true"
                />
              </button>
            )}

            <button
              type="button"
              onClick={() => toggleSavedListing(listing.id)}
              aria-label={
                isSaved ? 'Remove from saved listings' : 'Save listing'
              }
              title={isSaved ? 'Remove from saved listings' : 'Save listing'}
              data-testid="selected-card-save-btn"
              className={`h-11 min-h-[44px] min-w-[44px] rounded-xl border inline-flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)] ${
                isSaved
                  ? 'bg-[var(--ps-surface-alt)] border-[var(--ps-accent)] text-[var(--ps-text)]'
                  : 'bg-[var(--ps-bg)] border-[var(--ps-border)] text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
              }`}
            >
              <Bookmark
                className={`w-4 h-4 ${
                  isSaved
                    ? 'fill-current text-[var(--ps-accent)]'
                    : 'text-[var(--ps-text-muted)]'
                }`}
                aria-hidden="true"
              />
            </button>

            <a
              href={googleDirectionsUrl}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() =>
                recordListingInteraction(listing.id, 'directionClicksCount')
              }
              aria-label="Get directions"
              title="Get directions"
              data-testid="selected-card-directions-btn"
              className="h-11 min-h-[44px] min-w-[44px] rounded-xl bg-[var(--ps-bg)] border border-[var(--ps-border)] text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] hover:border-[var(--ps-accent)] inline-flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)]"
            >
              <Navigation
                className="w-4 h-4 text-[var(--ps-accent)]"
                aria-hidden="true"
              />
            </a>
          </div>
        </div>
      </div>
    </div>
  );
}

