'use client';

import React, { useEffect } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import { useHydrated } from '@/hooks/useHydrated';
import { useModalLock } from '@/hooks/useModalLock';
import {
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Lock,
  MapPin,
  MessageCircle,
  Navigation,
  Phone,
  Printer,
  Share2,
  Sparkles,
  Star,
  Truck,
  X,
} from 'lucide-react';
import { useShare } from '@/components/ui/ShareSheetModal';
import { buildListingSharePayload } from '@/lib/utils/share';
import { buildContextualWhatsAppUrl } from '@/lib/utils/whatsapp';
import { DynamicListingLocationMap } from '@/components/maps/ListingLocationMapDynamic';
import { SummaryMediaStrip } from '@/components/verticals/SummaryMediaStrip';
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
  const isHydrated = useHydrated();
  const { openShareSheet } = useShare();

  const verticalForLock = listing
    ? resolveListingVertical(listing, Boolean(printProfile))
    : null;
  const usesOwnFallbackModal =
    Boolean(listing) &&
    (verticalForLock === 'print_digital' || verticalForLock === 'general');

  useModalLock(usesOwnFallbackModal, onClose);

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

  if (!isHydrated || typeof document === 'undefined') return null;

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
            className="w-full max-w-md max-h-[88vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text)] shadow-2xl"
          >
            <div className="sticky top-0 z-10 flex items-start justify-between gap-2 border-b border-[var(--ps-border)] bg-[var(--ps-surface)] px-4 py-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-1.5">
                  {isFirstParty ? (
                    <span className="inline-flex items-center gap-1 rounded bg-amber-500/20 px-1.5 py-0.5 text-[10px] font-extrabold uppercase text-amber-800 dark:text-amber-300">
                      <Sparkles className="h-3 w-3" />
                      Official DD oodle Print
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
                <h3 className="mt-1 text-sm font-extrabold text-[var(--ps-text)] line-clamp-2">
                  {listing.title}
                </h3>
                <p className="mt-0.5 flex items-center gap-1 text-[11px] text-[var(--ps-text-muted)]">
                  <MapPin className="h-3 w-3 shrink-0 text-[var(--ps-accent)]" />
                  <span className="truncate">{listing.locality}</span>
                </p>
              </div>
              <div className="flex items-center gap-1.5 shrink-0">
                <button
                  type="button"
                  onClick={() => {
                    openShareSheet(
                      buildListingSharePayload({
                        ...listing,
                        category: 'Print & Digital',
                        listingVertical: 'print_digital',
                        isVerified: Boolean(
                          listing.is_verified ||
                            listing.verificationStatus === 'verified_demo' ||
                            isFirstParty
                        ),
                        startingPriceLabel: isAccepting ? 'Express Print' : null,
                      })
                    );
                  }}
                  aria-label={`Share ${listing.title}`}
                  title="Share listing"
                  data-testid="print-summary-share-btn"
                  className="inline-flex min-h-[44px] min-w-[44px] h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
                >
                  <Share2 className="h-4 w-4" />
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close print summary"
                  className="inline-flex min-h-[44px] min-w-[44px] h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="p-4 space-y-3">
              <SummaryMediaStrip listing={listing} onNavigate360={onClose} />

              {verifiedCaps.length > 0 && (
                <div>
                  <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                    Verified Print Capabilities
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {verifiedCaps.map((cap) => (
                      <span
                        key={cap}
                        className="inline-flex items-center gap-1 rounded-md border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-2 py-0.5 text-[11px] font-semibold text-[var(--ps-text)]"
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

              <DynamicListingLocationMap
                listingId={listing.id}
                title={listing.title}
                locality={listing.locality}
                address={listing.address}
                coordinates={listing.coordinates}
                listingVertical="print_digital"
                compact
              />

              <div className="flex flex-wrap items-center gap-2 pt-1">
                {resolveListingLiveCapabilities(listing, printProfile)
                  .canOrderPrint && (
                  <Link
                    href={`/listing/${encodeURIComponent(listing.id)}/print`}
                    onClick={onClose}
                    className="inline-flex min-h-[44px] h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3.5 text-xs font-bold text-[var(--ps-accent-fg)] shadow-xs transition hover:opacity-95"
                  >
                    <Printer className="h-4 w-4" />
                    <span>Order Print →</span>
                  </Link>
                )}
                <Link
                  href={`/explore?mode=pick_n_drop&pickupListingId=${encodeURIComponent(listing.id)}`}
                  onClick={onClose}
                  className="inline-flex min-h-[44px] h-11 items-center justify-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-3 text-xs font-bold text-[var(--ps-text)] hover:border-[var(--ps-accent)]"
                >
                  <Truck className="h-4 w-4 text-[var(--ps-accent)]" />
                  <span>Pick N Drop</span>
                </Link>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenFullDetailPage(listing.id);
                  }}
                  className="inline-flex min-h-[44px] h-11 flex-1 items-center justify-center gap-1 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-3.5 text-xs font-bold text-[var(--ps-text)] hover:border-[var(--ps-accent)] cursor-pointer"
                >
                  <span>Open Full Page</span>
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

  // 3. All Other Verticals -> Clean Unified Quick Summary Sheet
  const priceLabel = getListingPriceLabel(listing);
  const whatsappUrl =
    listing.whatsapp || listing.contactPhone
      ? buildContextualWhatsAppUrl(
          listing.whatsapp || listing.contactPhone || '',
          {
            type: 'listing_enquiry',
            listingTitle: listing.title,
            locality: listing.locality,
            url:
              typeof window !== 'undefined'
                ? `${window.location.origin}/listing/${encodeURIComponent(listing.id)}`
                : `/listing/${encodeURIComponent(listing.id)}`,
          }
        )
      : null;

  const handleGeneralRichShare = () => {
    openShareSheet(
      buildListingSharePayload({
        ...listing,
        category: CATEGORY_LABELS[listing.category],
        listingVertical: vertical,
        isVerified: Boolean(
          listing.is_verified || listing.verificationStatus === 'verified_demo'
        ),
        startingPriceLabel: priceLabel || null,
      })
    );
  };

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
          className="w-full max-w-md max-h-[88vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text)] shadow-2xl"
        >
          <div className="sticky top-0 z-10 flex items-start justify-between gap-2 border-b border-[var(--ps-border)] bg-[var(--ps-surface)] px-4 py-3">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                <span className="rounded bg-[var(--ps-surface-alt)] px-1.5 py-0.5 font-bold uppercase text-[var(--ps-text-muted)]">
                  {CATEGORY_LABELS[listing.category]}
                </span>
                {listing.rating > 0 && (
                  <span className="inline-flex items-center gap-0.5 font-bold text-amber-500">
                    <Star className="h-3 w-3 fill-current" />
                    {listing.rating}
                  </span>
                )}
                {priceLabel && (
                  <span className="font-bold text-[var(--ps-text)]">
                    · {priceLabel}
                  </span>
                )}
              </div>
              <h3 className="mt-1 text-base font-extrabold text-[var(--ps-text)] leading-snug line-clamp-2">
                {listing.title}
              </h3>
              <p className="mt-0.5 flex items-center gap-1 text-xs text-[var(--ps-text-muted)]">
                <MapPin className="h-3.5 w-3.5 shrink-0 text-[var(--ps-accent)]" />
                <span className="truncate">
                  {listing.locality}
                  {listing.address ? ` · ${listing.address}` : ''}
                </span>
              </p>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={handleGeneralRichShare}
                aria-label={`Share ${listing.title}`}
                title="Share listing"
                data-testid="quick-summary-share-btn"
                className="inline-flex min-h-[44px] min-w-[44px] h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
              >
                <Share2 className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={onClose}
                aria-label="Close quick summary"
                className="inline-flex min-h-[44px] min-w-[44px] h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="p-4 space-y-3.5">
            <SummaryMediaStrip listing={listing} onNavigate360={onClose} />

            {(listing.shortDescription || listing.description) && (
              <p className="line-clamp-3 text-xs leading-relaxed text-[var(--ps-text-muted)]">
                {listing.shortDescription || listing.description}
              </p>
            )}

            {/* Shared Interactive Mini-Map Preview */}
            <DynamicListingLocationMap
              listingId={listing.id}
              title={listing.title}
              locality={listing.locality}
              address={listing.address}
              coordinates={listing.coordinates}
              listingVertical={vertical}
              compact
            />

            <div className="flex flex-wrap items-center gap-2 pt-1">
              {listing.contactPhone?.trim() && (
                <a
                  href={`tel:${listing.contactPhone.replace(/[^+\d]/g, '')}`}
                  className="inline-flex min-h-[44px] h-11 items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-3.5 text-xs font-bold text-[var(--ps-text)] hover:border-[var(--ps-accent)]"
                >
                  <Phone className="h-4 w-4 text-[var(--ps-accent)]" />
                  <span>Call</span>
                </a>
              )}
              {whatsappUrl && (
                <a
                  href={whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[44px] h-11 items-center gap-1.5 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3.5 text-xs font-bold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/15"
                >
                  <MessageCircle className="h-4 w-4" />
                  <span>WhatsApp</span>
                </a>
              )}
              {onGetDirections ? (
                <button
                  type="button"
                  onClick={() => {
                    onGetDirections(listing);
                    onClose();
                  }}
                  className="inline-flex min-h-[44px] h-11 items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-3.5 text-xs font-bold text-[var(--ps-text)] hover:border-[var(--ps-accent)] cursor-pointer"
                >
                  <Navigation className="h-4 w-4 text-[var(--ps-accent)]" />
                  <span>Directions</span>
                </button>
              ) : (
                <a
                  href={`https://www.google.com/maps/dir/?api=1&destination=${listing.coordinates.lat},${listing.coordinates.lng}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-[44px] h-11 items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-3.5 text-xs font-bold text-[var(--ps-text)] hover:border-[var(--ps-accent)]"
                >
                  <ExternalLink className="h-4 w-4 text-[var(--ps-accent)]" />
                  <span>Directions</span>
                </a>
              )}

              <Link
                href={`/explore?mode=pick_n_drop&pickupListingId=${encodeURIComponent(listing.id)}`}
                onClick={onClose}
                data-testid="quick-summary-pick-n-drop-btn"
                className="inline-flex min-h-[44px] h-11 items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-3.5 text-xs font-bold text-[var(--ps-text)] hover:border-[var(--ps-accent)]"
              >
                <Truck className="h-4 w-4 text-[var(--ps-accent)]" />
                <span>Pick N Drop</span>
              </Link>

              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenFullDetailPage(listing.id);
                }}
                className="inline-flex min-h-[44px] h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-4 text-xs font-bold text-[var(--ps-accent-fg)] shadow-xs transition hover:opacity-95 cursor-pointer"
              >
                <span>Open Full Page</span>
                <ArrowRight className="h-4 w-4" />
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

