'use client';

import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import Link from 'next/link';
import { AnimatePresence, motion } from 'motion/react';
import {
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Lock,
  MapPin,
  Navigation,
  Phone,
  Printer,
  Sparkles,
  Star,
  X,
} from 'lucide-react';
import { BookingSummaryModal } from '@/components/verticals/bookings/BookingSummaryModal';
import { CivicSummaryModal } from '@/components/verticals/civic/CivicSummaryModal';
import { HotelSummaryModal } from '@/components/verticals/hotels/HotelSummaryModal';
import { RealEstateSummaryModal } from '@/components/verticals/real-estate/RealEstateSummaryModal';
import { RestaurantSummaryModal } from '@/components/verticals/restaurants/RestaurantSummaryModal';
import { ShopSummaryModal } from '@/components/verticals/shops/ShopSummaryModal';
import { resolveListingVertical } from '@/components/verticals/MapCardRegistry';
import type { PrintProfileBadgeSummary } from '@/lib/print-orders/client-helpers';
import { resolveListingLiveCapabilities } from '@/lib/verticals/capabilities';
import { CATEGORY_LABELS, getListingPriceLabel } from '@/lib/rules';
import { supabaseMediaImageLoader } from '@/lib/supabase/storage';
import type { Listing } from '@/lib/types';

export interface SummaryModalRegistryProps {
  listing: Listing | null;
  printProfile?: PrintProfileBadgeSummary | null;
  onClose: () => void;
  onOpenFullDetailPage: (listingId: string) => void;
  onCenterOnMap?: (listing: Listing) => void;
  onGetDirections?: (listing: Listing) => void;
}

const CAPABILITY_LABELS: Record<string, string> = {
  bw_a4: 'B&W A4',
  color_a4: 'Color A4',
  duplex: 'Duplex',
  a3_large: 'A3 Large',
  spiral_binding: 'Spiral Binding',
  lamination: 'Lamination',
  custom_digital_jobs: 'Custom Digital',
  sealed_envelope: 'Sealed Envelope',
};

export function SummaryModalRegistry({
  listing,
  printProfile = null,
  onClose,
  onOpenFullDetailPage,
  onCenterOnMap,
  onGetDirections,
}: SummaryModalRegistryProps) {
  useEffect(() => {
    if (!listing) return;
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [listing, onClose]);

  if (!listing) return null;

  const vertical = resolveListingVertical(listing, Boolean(printProfile));

  // 1. Public & Government Services (`public_civic`) -> Terminal Civic Summary Modal
  if (vertical === 'public_civic') {
    return (
      <AnimatePresence>
        <CivicSummaryModal
          key={listing.id}
          listing={listing}
          onClose={onClose}
          onCenterOnMap={onCenterOnMap}
          onGetDirections={onGetDirections}
        />
      </AnimatePresence>
    );
  }

  // 1B. Bookable Venues & Turfs (`booking_venue`) -> Live Today's Quick Slots Modal
  if (vertical === 'booking_venue') {
    return (
      <AnimatePresence>
        <BookingSummaryModal
          key={listing.id}
          listing={listing}
          onClose={onClose}
          onOpenFullDetailPage={onOpenFullDetailPage}
        />
      </AnimatePresence>
    );
  }

  // 1C. Hotels, Homestays & Lodges (`hotel_stay`) -> Live Room Availability Modal
  if (vertical === 'hotel_stay') {
    return (
      <AnimatePresence>
        <HotelSummaryModal
          key={listing.id}
          listing={listing}
          onClose={onClose}
          onOpenFullDetailPage={onOpenFullDetailPage}
        />
      </AnimatePresence>
    );
  }

  // 1D. Local Storefronts (`shop_catalogue`) -> Live Storefront Preview Modal
  if (vertical === 'shop_catalogue') {
    return (
      <AnimatePresence>
        <ShopSummaryModal
          key={listing.id}
          listing={listing}
          onClose={onClose}
          onOpenFullDetailPage={onOpenFullDetailPage}
        />
      </AnimatePresence>
    );
  }

  // 1E. Restaurants & Cafés (`restaurant_food`) -> Live Popular Dishes Modal
  if (vertical === 'restaurant_food') {
    return (
      <AnimatePresence>
        <RestaurantSummaryModal
          key={listing.id}
          listing={listing}
          onClose={onClose}
          onOpenFullDetailPage={onOpenFullDetailPage}
        />
      </AnimatePresence>
    );
  }

  // 1F. Real Estate & Properties (`real_estate`) -> Lightweight Property Summary Modal
  if (vertical === 'real_estate') {
    return (
      <AnimatePresence>
        <RealEstateSummaryModal
          key={listing.id}
          listing={listing}
          onClose={onClose}
          onOpenFullDetailPage={onOpenFullDetailPage}
        />
      </AnimatePresence>
    );
  }

  if (typeof document === 'undefined') return null;

  // 2. Print & Digital Services (`print_digital`) -> Compact Print Summary Sheet
  if (vertical === 'print_digital') {
    const summary = listing.vertical_summary || {};
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
    const verifiedMap =
      printProfile?.verifiedCapabilities ||
      (summary.verified_capabilities as Record<string, boolean> | undefined) ||
      {};
    const verifiedCaps = Object.entries(verifiedMap)
      .filter(([, ok]) => Boolean(ok))
      .map(([key]) => CAPABILITY_LABELS[key] || key.replace(/_/g, ' '));

    return createPortal(
      <AnimatePresence>
        <motion.div
          key={listing.id}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          role="dialog"
          aria-modal="true"
          aria-label={`Print counter summary for ${listing.title}`}
          data-testid="print-summary-modal"
          className="fixed inset-0 z-[85] flex items-end sm:items-center justify-center bg-slate-950/65 p-0 sm:p-4 backdrop-blur-xs"
        >
          <motion.div
            initial={{ opacity: 0, y: 18, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.98 }}
            transition={{ duration: 0.16 }}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md overflow-hidden rounded-t-2xl sm:rounded-2xl border border-slate-200 bg-[var(--ps-surface)] text-[var(--ps-text)] shadow-2xl dark:border-slate-800"
          >
            <div className="flex items-start justify-between gap-2 border-b border-slate-200/80 bg-slate-50/80 px-4 py-3 dark:border-slate-800 dark:bg-slate-900/90">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  {isFirstParty ? (
                    <span className="inline-flex items-center gap-1 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-extrabold uppercase text-amber-800 dark:text-amber-300">
                      <Sparkles className="h-3 w-3" />
                      Official PrintSwift
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded bg-teal-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-teal-800 dark:text-teal-300">
                      <Printer className="h-3 w-3" />
                      Print &amp; Digital Counter
                    </span>
                  )}
                  <span
                    className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                      isAccepting
                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                        : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                    }`}
                  >
                    {isAccepting ? 'Accepting Online Orders' : 'Preview / Paused'}
                  </span>
                </div>
                <h3 className="mt-1 text-sm font-extrabold text-slate-900 dark:text-white line-clamp-1">
                  {listing.title}
                </h3>
                <p className="mt-0.5 flex items-center gap-1 text-[11px] text-slate-500 dark:text-slate-400">
                  <MapPin className="h-3 w-3 shrink-0" />
                  <span className="truncate">{listing.locality}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close print summary"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 hover:text-slate-900 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="p-4 space-y-3">
              {verifiedCaps.length > 0 && (
                <div>
                  <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:text-slate-400">
                    Verified Print Capabilities
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {verifiedCaps.map((cap) => (
                      <span
                        key={cap}
                        className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                      >
                        <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                        {cap}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/8 px-3 py-2 text-[11px] font-medium text-emerald-800 dark:text-emerald-300">
                <Lock className="h-3.5 w-3.5 shrink-0" />
                <span>
                  Encrypted private vault · Customer files auto-delete 48 hours
                  after collection.
                </span>
              </div>

              <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1">
                {resolveListingLiveCapabilities(listing, printProfile)
                  .canOrderPrint && (
                  <Link
                    href={`/listing/${encodeURIComponent(listing.id)}/print`}
                    onClick={onClose}
                    className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-theme-primary px-3 text-xs font-bold text-[hsl(var(--color-primary-foreground))] shadow-xs transition hover:opacity-95"
                  >
                    <Printer className="h-3.5 w-3.5" />
                    <span>Upload &amp; Order Print →</span>
                  </Link>
                )}
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenFullDetailPage(listing.id);
                  }}
                  className="inline-flex h-9 flex-1 items-center justify-center gap-1 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                >
                  <span>Full Profile →</span>
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      </AnimatePresence>,
      document.body
    );
  }

  // 3. All Other Verticals -> Clean Unified Quick Summary Sheet
  const priceLabel = getListingPriceLabel(listing);

  return createPortal(
    <AnimatePresence>
      <motion.div
        key={listing.id}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
        role="dialog"
        aria-modal="true"
        aria-label={`Quick summary for ${listing.title}`}
        data-testid="quick-summary-modal"
        className="fixed inset-0 z-[85] flex items-end sm:items-center justify-center bg-slate-950/65 p-0 sm:p-4 backdrop-blur-xs"
      >
        <motion.div
          initial={{ opacity: 0, y: 18, scale: 0.98 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 18, scale: 0.98 }}
          transition={{ duration: 0.16 }}
          onClick={(e) => e.stopPropagation()}
          className="w-full max-w-md overflow-hidden rounded-t-2xl sm:rounded-2xl border border-slate-200 bg-[var(--ps-surface)] text-[var(--ps-text)] shadow-2xl dark:border-slate-800"
        >
          {listing.coverImage?.trim() && (
            <div className="relative h-40 w-full bg-slate-200 dark:bg-slate-800">
              <Image
                loader={supabaseMediaImageLoader}
                unoptimized={false}
                src={listing.coverImage.trim()}
                alt={listing.title}
                fill
                referrerPolicy="no-referrer"
                className="object-cover"
              />
              <button
                type="button"
                onClick={onClose}
                aria-label="Close quick summary"
                className="absolute right-3 top-3 inline-flex h-8 w-8 items-center justify-center rounded-full bg-slate-950/70 text-white backdrop-blur-xs hover:bg-slate-950"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}

          <div className="p-4 space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 font-bold uppercase text-slate-600 dark:bg-slate-800 dark:text-slate-300">
                    {CATEGORY_LABELS[listing.category]}
                  </span>
                  <span className="inline-flex items-center gap-0.5 font-bold text-amber-500">
                    <Star className="h-3 w-3 fill-current" />
                    {listing.rating}
                  </span>
                  {priceLabel && (
                    <span className="font-bold text-slate-800 dark:text-slate-100">
                      · {priceLabel}
                    </span>
                  )}
                </div>
                <h3 className="mt-1 text-base font-extrabold text-slate-900 dark:text-white leading-snug">
                  {listing.title}
                </h3>
                <p className="mt-0.5 flex items-center gap-1 text-xs text-slate-500 dark:text-slate-400">
                  <MapPin className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">
                    {listing.locality}
                    {listing.address ? ` · ${listing.address}` : ''}
                  </span>
                </p>
              </div>
              {!listing.coverImage?.trim() && (
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close quick summary"
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-800"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>

            {(listing.shortDescription || listing.description) && (
              <p className="line-clamp-3 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
                {listing.shortDescription || listing.description}
              </p>
            )}

            <div className="flex flex-wrap items-center gap-2 pt-1">
              {listing.contactPhone?.trim() && (
                <a
                  href={`tel:${listing.contactPhone.replace(/[^+\d]/g, '')}`}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                >
                  <Phone className="h-3.5 w-3.5" />
                  <span>Call</span>
                </a>
              )}
              {onGetDirections ? (
                <button
                  type="button"
                  onClick={() => {
                    onGetDirections(listing);
                    onClose();
                  }}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                >
                  <Navigation className="h-3.5 w-3.5" />
                  <span>Directions</span>
                </button>
              ) : (
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${listing.coordinates.lat},${listing.coordinates.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  <span>Directions</span>
                </a>
              )}

              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenFullDetailPage(listing.id);
                }}
                className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg bg-theme-primary px-3 text-xs font-bold text-[hsl(var(--color-primary-foreground))] shadow-xs transition hover:opacity-95"
              >
                <span>View Full Details</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
}

export default SummaryModalRegistry;
