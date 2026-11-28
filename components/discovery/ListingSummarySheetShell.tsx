'use client';

import React, { useMemo } from 'react';
import { createPortal } from 'react-dom';
import { motion } from 'framer-motion';
import {
  BadgeCheck,
  Bookmark,
  MapPin,
  Share2,
  Star,
  X,
} from 'lucide-react';
import { useHydrated } from '@/hooks/useHydrated';
import { useModalLock } from '@/hooks/useModalLock';
import { useShare } from '@/components/ui/ShareSheetModal';
import {
  ListingMediaGallery,
  extractListingGalleryMedia,
} from '@/components/discovery/ListingMediaGallery';
import { useSavedInterests } from '@/lib/hooks/useSavedInterests';
import { CATEGORY_LABELS } from '@/lib/rules';
import { useAppStore } from '@/lib/store';
import type { Listing } from '@/lib/types';
import { splitSamplePrefix } from '@/lib/utils/display-title';
import { buildListingSharePayload, type SharePayload } from '@/lib/utils/share';

export interface ListingSummarySheetShellProps {
  listing: Listing;
  onClose: () => void;
  /** Optional override for vertical badge pill at top-left of media */
  verticalBadgeSlot?: React.ReactNode;
  /** Optional subtitle/category label override */
  categoryLabel?: string;
  /** Optional price or key metric highlight shown inline in identity strip */
  priceHighlight?: React.ReactNode;
  /** Optional string version of price for ShareSheetModal */
  sharePriceLabel?: string | null;
  /** Optional Share payload overrides */
  shareOverrides?: Partial<SharePayload>;
  /** Optional vertical badge string for ShareSheetModal */
  shareVerticalBadge?: string | null;
  /** Optional verified override */
  isVerifiedOverride?: boolean;
  /** Optional quick action row rendered directly under identity strip */
  quickActionsSlot?: React.ReactNode;
  /** Optional sticky footer bar (Primary vertical CTA + Open Full Details) */
  footerSlot?: React.ReactNode;
  /** Hide save bookmark button (e.g., for civic records if undesired) */
  hideSaveButton?: boolean;
  /** Optional extra header content inside identity block */
  identityExtraSlot?: React.ReactNode;
  /** Modal max-width class */
  maxWidthClassName?: string;
  testId?: string;
  ariaLabel?: string;
  children: React.ReactNode;
}

function computeDistanceLabel(
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
  return km < 1
    ? `${Math.max(50, Math.round(km * 1000))}m away`
    : `${km.toFixed(1)} km away`;
}

export function ListingSummarySheetShell({
  listing,
  onClose,
  verticalBadgeSlot,
  categoryLabel,
  priceHighlight,
  sharePriceLabel,
  shareOverrides,
  shareVerticalBadge,
  isVerifiedOverride,
  quickActionsSlot,
  footerSlot,
  hideSaveButton = false,
  identityExtraSlot,
  maxWidthClassName = 'max-w-lg',
  testId = 'listing-summary-sheet',
  ariaLabel,
  children,
}: ListingSummarySheetShellProps) {
  const isHydrated = useHydrated();
  useModalLock(true, onClose);
  const { openShareSheet } = useShare();
  const { customDefaultCenter, savedListingIds, toggleSavedListing } =
    useAppStore();
  const { isSaved: isUnifiedSaved, toggleSave: toggleUnifiedSave } =
    useSavedInterests();

  const { images, panoramas } = useMemo(
    () => extractListingGalleryMedia(listing),
    [listing]
  );

  const { title: cleanTitle, isSample } = splitSamplePrefix(listing.title);
  const isVerified =
    isVerifiedOverride !== undefined
      ? isVerifiedOverride
      : Boolean(
          listing.is_verified || listing.verificationStatus === 'verified_demo'
        );

  const effectiveSaved =
    savedListingIds.includes(listing.id) ||
    isUnifiedSaved('listing', listing.id);

  const resolvedCategory =
    categoryLabel ||
    listing.subcategory ||
    CATEGORY_LABELS[listing.category] ||
    'Directory';

  const distanceText = useMemo(
    () => computeDistanceLabel(customDefaultCenter, listing.coordinates),
    [customDefaultCenter, listing.coordinates]
  );

  const handleToggleSave = () => {
    toggleSavedListing(listing.id);
    void toggleUnifiedSave('listing', listing.id);
  };

  const handleShare = () => {
    const basePayload = buildListingSharePayload(listing, {
      title: cleanTitle,
      subtitle: [resolvedCategory, listing.locality].filter(Boolean).join(' · '),
      category: resolvedCategory,
      categoryLabel: resolvedCategory,
      verticalBadge: shareVerticalBadge ?? undefined,
      priceLabel: sharePriceLabel ?? undefined,
      priceText: sharePriceLabel ?? undefined,
      isVerified,
      verified: isVerified,
      ...shareOverrides,
    });
    openShareSheet(basePayload);
  };

  if (!isHydrated || typeof document === 'undefined') return null;

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.16 }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={ariaLabel || `Quick summary for ${cleanTitle}`}
      data-testid={testId}
      className="fixed inset-0 z-[85] flex items-end sm:items-center justify-center bg-slate-950/65 p-0 sm:p-4 backdrop-blur-xs"
    >
      <motion.div
        initial={{ opacity: 0, y: 28, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 24, scale: 0.985 }}
        transition={{ duration: 0.18, ease: 'easeOut' }}
        onClick={(e) => e.stopPropagation()}
        className={`flex w-full ${maxWidthClassName} max-h-[92dvh] sm:max-h-[88dvh] flex-col overflow-hidden rounded-t-3xl sm:rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text)] shadow-2xl`}
      >
        {/* Mobile Sheet Grab Indicator */}
        <div className="flex sm:hidden items-center justify-center pt-2 pb-1 bg-[var(--ps-surface)] shrink-0">
          <span className="h-1 w-10 rounded-full bg-[var(--ps-border)]" />
        </div>

        {/* Scrollable Content Region */}
        <div className="flex-1 overflow-y-auto overscroll-contain">
          {/* Top Full-Bleed Rounded Auto-Scrolling Photo Gallery + Lightbox + 360° */}
          <div className="px-2.5 pt-1 sm:px-0 sm:pt-0">
            <ListingMediaGallery
              images={images}
              panoramas={panoramas}
              title={cleanTitle}
              subtitle={`${resolvedCategory} · ${listing.locality}`}
              category={listing.category}
              listingVertical={listing.listing_vertical}
              coordinates={listing.coordinates}
              aspectClassName="aspect-[16/10]"
              roundedClassName="rounded-2xl sm:rounded-none"
              autoPlayMs={4000}
              topLeftSlot={verticalBadgeSlot}
              topRightSlot={
                <>
                  {!hideSaveButton && (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        handleToggleSave();
                      }}
                      aria-label={effectiveSaved ? 'Remove bookmark' : 'Save listing'}
                      title={effectiveSaved ? 'Saved' : 'Save listing'}
                      data-testid="summary-sheet-save-btn"
                      className={`inline-flex min-h-[44px] min-w-[44px] h-11 w-11 items-center justify-center rounded-full border backdrop-blur-md transition-colors cursor-pointer ${
                        effectiveSaved
                          ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                          : 'border-white/25 bg-slate-950/70 text-white hover:bg-slate-950/90'
                      }`}
                    >
                      <Bookmark
                        className={`h-4 w-4 ${effectiveSaved ? 'fill-current' : ''}`}
                      />
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleShare();
                    }}
                    aria-label={`Share ${cleanTitle}`}
                    title={`Share ${cleanTitle}`}
                    data-testid="summary-sheet-share-btn"
                    className="inline-flex min-h-[44px] min-w-[44px] h-11 w-11 items-center justify-center rounded-full border border-white/25 bg-slate-950/70 text-white backdrop-blur-md hover:bg-slate-950/90 transition-colors cursor-pointer"
                  >
                    <Share2 className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onClose();
                    }}
                    aria-label="Close summary sheet"
                    title="Close"
                    data-testid="summary-sheet-close-btn"
                    className="inline-flex min-h-[44px] min-w-[44px] h-11 w-11 items-center justify-center rounded-full border border-white/25 bg-slate-950/70 text-white backdrop-blur-md hover:bg-slate-950/90 transition-colors cursor-pointer"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </>
              }
            />
          </div>

          {/* Tight Identity & Vertical Specs Strip */}
          <div className="px-4 pt-3.5 pb-4 sm:px-5 space-y-3.5">
            <div className="space-y-1.5">
              <div className="flex flex-wrap items-center justify-between gap-1.5">
                <div className="flex flex-wrap items-center gap-1.5 min-w-0">
                  <span className="rounded-md bg-[var(--ps-surface-alt)] border border-[var(--ps-border)] px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)] truncate max-w-[180px]">
                    {resolvedCategory}
                  </span>
                  {isVerified && (
                    <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                      <BadgeCheck className="h-3 w-3 shrink-0" />
                      <span>Verified</span>
                    </span>
                  )}
                  {isSample && (
                    <span className="rounded-md border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-1.5 py-0.5 text-[9.5px] font-semibold uppercase tracking-wide text-[var(--ps-text-muted)]">
                      Sample
                    </span>
                  )}
                </div>

                {listing.rating > 0 && (
                  <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[11px] font-bold text-amber-700 dark:text-amber-300 tabular-nums shrink-0">
                    <Star className="h-3 w-3 fill-current" />
                    <span>{Number(listing.rating).toFixed(1)}</span>
                    {listing.reviewCount > 0 && (
                      <span className="opacity-75">({listing.reviewCount})</span>
                    )}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-base sm:text-lg font-extrabold tracking-tight text-[var(--ps-text)] leading-snug">
                  {cleanTitle}
                </h2>
                {priceHighlight}
              </div>

              <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--ps-text-muted)]">
                <span className="inline-flex items-center gap-1 min-w-0">
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-[var(--ps-accent)]" />
                  <span className="truncate font-medium">
                    {listing.address && listing.address !== listing.locality
                      ? `${listing.locality} · ${listing.address}`
                      : listing.locality}
                  </span>
                </span>
                {distanceText && (
                  <span className="rounded-md bg-[var(--ps-accent)]/12 px-1.5 py-0.5 text-[10px] font-bold text-[var(--ps-accent)] tabular-nums shrink-0">
                    {distanceText}
                  </span>
                )}
              </div>

              {identityExtraSlot}
            </div>

            {/* Vertical-Synced Quick Action Row */}
            {quickActionsSlot}

            {/* Main Vertical Body + Embedded Location Map */}
            {children}
          </div>
        </div>

        {/* Sticky Bottom Action Bar (Primary Vertical CTA + Open Full Details) */}
        {footerSlot && (
          <div className="shrink-0 border-t border-[var(--ps-border)] bg-[var(--ps-surface)]/95 backdrop-blur-md px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5">
            {footerSlot}
          </div>
        )}
      </motion.div>
    </motion.div>,
    document.body
  );
}

export default ListingSummarySheetShell;
