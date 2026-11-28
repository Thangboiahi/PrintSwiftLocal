'use client';

import React from 'react';
import Link from 'next/link';
import { AnimatePresence } from 'framer-motion';
import {
  ArrowRight,
  CheckCircle2,
  ExternalLink,
  Lock,
  MessageCircle,
  Navigation,
  Phone,
  Printer,
  Sparkles,
  Truck,
} from 'lucide-react';
import { ListingSummarySheetShell } from '@/components/discovery/ListingSummarySheetShell';
import { DynamicListingLocationMap } from '@/components/maps/ListingLocationMapDynamic';
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
import { buildContextualWhatsAppUrl } from '@/lib/utils/whatsapp';
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
  if (!listing) return null;

  const vertical = resolveListingVertical(listing, Boolean(printProfile));

  // 1. Public & Government Services (`public_civic`)
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

  // 1B. Bookable Venues & Turfs (`booking_venue`)
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

  // 1C. Hotels, Homestays & Lodges (`hotel_stay`)
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

  // 1D. Local Storefronts (`shop_catalogue`)
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

  // 1E. Restaurants & Cafés (`restaurant_food`)
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

  // 1F. Real Estate & Properties (`real_estate`)
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

  // 2. Print & Digital Services (`print_digital`)
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
    const canOrderPrint = resolveListingLiveCapabilities(
      listing,
      printProfile
    ).canOrderPrint;

    return (
      <AnimatePresence>
        <ListingSummarySheetShell
          key={listing.id}
          listing={listing}
          onClose={onClose}
          testId="print-summary-modal"
          ariaLabel={`Print counter summary for ${listing.title}`}
          categoryLabel="Print & Digital"
          shareVerticalBadge="Print & Digital"
          sharePriceLabel={isAccepting ? 'Express Print' : null}
          isVerifiedOverride={Boolean(
            listing.is_verified ||
              listing.verificationStatus === 'verified_demo' ||
              isFirstParty
          )}
          verticalBadgeSlot={
            isFirstParty ? (
              <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/95 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-white shadow-xs backdrop-blur-sm">
                <Sparkles className="h-3 w-3" />
                Official DD oodle Print
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 rounded-md bg-teal-600/95 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-white shadow-xs backdrop-blur-sm">
                <Printer className="h-3 w-3" />
                Print &amp; Digital
              </span>
            )
          }
          identityExtraSlot={
            <div className="pt-0.5">
              <span
                className={`inline-flex rounded-md px-2 py-0.5 text-[10px] font-bold ${
                  isAccepting
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                    : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                }`}
              >
                {isAccepting ? 'Accepting Online Orders' : 'Preview / Paused'}
              </span>
            </div>
          }
          quickActionsSlot={
            <div className="flex flex-wrap items-center gap-2">
              {listing.contactPhone?.trim() && (
                <a
                  href={`tel:${listing.contactPhone.replace(/[^+\d]/g, '')}`}
                  className="inline-flex min-h-[44px] h-11 items-center justify-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-3.5 text-xs font-bold text-[var(--ps-text)] hover:border-[var(--ps-accent)]"
                >
                  <Phone className="h-4 w-4 text-[var(--ps-accent)]" />
                  <span>Call</span>
                </a>
              )}
              <Link
                href={`/explore?mode=pick_n_drop&pickupListingId=${encodeURIComponent(listing.id)}`}
                onClick={onClose}
                className="inline-flex min-h-[44px] h-11 items-center justify-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-3.5 text-xs font-bold text-[var(--ps-text)] hover:border-[var(--ps-accent)]"
              >
                <Truck className="h-4 w-4 text-[var(--ps-accent)]" />
                <span>Pick N Drop</span>
              </Link>
            </div>
          }
          footerSlot={
            <div className="flex items-center gap-2">
              {canOrderPrint && (
                <Link
                  href={`/listing/${encodeURIComponent(listing.id)}/print`}
                  onClick={onClose}
                  className="inline-flex min-h-[44px] h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3.5 text-xs font-bold text-[var(--ps-accent-fg)] shadow-xs transition hover:opacity-95"
                >
                  <Printer className="h-4 w-4" />
                  <span>Order Print</span>
                  <ArrowRight className="h-3.5 w-3.5" />
                </Link>
              )}
              <button
                type="button"
                onClick={() => {
                  onClose();
                  onOpenFullDetailPage(listing.id);
                }}
                className={`inline-flex min-h-[44px] h-11 flex-1 items-center justify-center gap-1 rounded-xl px-3.5 text-xs font-bold transition-colors cursor-pointer ${
                  canOrderPrint
                    ? 'border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] text-[var(--ps-text)] hover:border-[var(--ps-accent)]'
                    : 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] hover:opacity-95'
                }`}
              >
                <span>Open Full Details</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            </div>
          }
        >
          <div className="space-y-3">
            {verifiedCaps.length > 0 && (
              <div>
                <div className="mb-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                  Verified Print Capabilities
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {verifiedCaps.map((cap) => (
                    <span
                      key={cap}
                      className="inline-flex items-center gap-1 rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-0.5 text-[11px] font-semibold text-[var(--ps-text)]"
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
          </div>
        </ListingSummarySheetShell>
      </AnimatePresence>
    );
  }

  // 3. General & All Other Verticals -> Unified Quick Summary Sheet
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

  return (
    <AnimatePresence>
      <ListingSummarySheetShell
        key={listing.id}
        listing={listing}
        onClose={onClose}
        testId="quick-summary-modal"
        ariaLabel={`Quick summary for ${listing.title}`}
        categoryLabel={listing.subcategory || CATEGORY_LABELS[listing.category]}
        shareVerticalBadge={CATEGORY_LABELS[listing.category]}
        sharePriceLabel={priceLabel || null}
        priceHighlight={
          priceLabel ? (
            <span className="font-mono text-sm font-extrabold text-[var(--ps-accent)] tabular-nums shrink-0">
              {priceLabel}
            </span>
          ) : null
        }
        quickActionsSlot={
          <div className="flex flex-wrap items-center gap-2">
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
          </div>
        }
        footerSlot={
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenFullDetailPage(listing.id);
            }}
            className="inline-flex min-h-[44px] h-11 w-full items-center justify-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-4 text-xs font-bold text-[var(--ps-accent-fg)] shadow-xs transition hover:opacity-95 cursor-pointer"
          >
            <span>Open Full Details</span>
            <ArrowRight className="h-4 w-4" />
          </button>
        }
      >
        <div className="space-y-3">
          {(listing.shortDescription || listing.description) && (
            <p className="line-clamp-3 text-xs leading-relaxed text-[var(--ps-text-muted)]">
              {listing.shortDescription || listing.description}
            </p>
          )}

          <DynamicListingLocationMap
            listingId={listing.id}
            title={listing.title}
            locality={listing.locality}
            address={listing.address}
            coordinates={listing.coordinates}
            listingVertical={vertical}
            compact
          />
        </div>
      </ListingSummarySheetShell>
    </AnimatePresence>
  );
}

export default SummaryModalRegistry;
