'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  CalendarDays,
  Clock,
  Info,
  Layers,
  Phone,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import { ListingSummarySheetShell } from '@/components/discovery/ListingSummarySheetShell';
import { DynamicListingLocationMap } from '@/components/maps/ListingLocationMapDynamic';
import {
  formatBookingInr,
  getBookingUnitShortLabel,
  getTodayIstYmd,
  type ApiAvailabilityResponse,
} from '@/lib/bookings/client-helpers';
import { resolveListingLiveCapabilities } from '@/lib/verticals/capabilities';
import type { Listing } from '@/lib/types';

export interface BookingSummaryModalProps {
  listing: Listing;
  onClose: () => void;
  onOpenFullDetailPage: (listingId: string) => void;
}

export function BookingSummaryModal({
  listing,
  onClose,
  onOpenFullDetailPage,
}: BookingSummaryModalProps) {
  const [availability, setAvailability] =
    useState<ApiAvailabilityResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const todayYmd = useMemo(() => getTodayIstYmd(), []);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setErrorMsg(null);

    const url = `/api/bookings/availability?listingId=${encodeURIComponent(
      listing.id
    )}&date=${encodeURIComponent(todayYmd)}`;

    fetch(url, { cache: 'no-store' })
      .then(async (res) => {
        const json = (await res
          .json()
          .catch(() => ({}))) as ApiAvailabilityResponse;
        if (!res.ok) {
          throw new Error(
            json.error || 'Could not load live slot availability.'
          );
        }
        return json;
      })
      .then((data) => {
        if (!cancelled) {
          setAvailability(data);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setErrorMsg(
            err instanceof Error
              ? err.message
              : 'Live availability temporarily unavailable.'
          );
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [listing.id, todayYmd]);

  const summary = listing.vertical_summary || {};
  const primaryResource = availability?.resources?.[0] || null;
  const slots = primaryResource?.slots || [];
  const hasSlotGrid =
    primaryResource &&
    (primaryResource.bookingUnit === 'hourly' ||
      primaryResource.bookingUnit === 'slot') &&
    slots.length > 0;

  const minRateInr =
    primaryResource?.baseRateInr ??
    (summary.min_rate_inr !== null && summary.min_rate_inr !== undefined
      ? Number(summary.min_rate_inr)
      : null);
  const unitLabel = getBookingUnitShortLabel(
    primaryResource?.bookingUnit ||
      (typeof summary.primary_unit === 'string'
        ? summary.primary_unit
        : 'hourly')
  );
  const advancePercent = primaryResource?.advancePercent ?? 30;
  const resourceCount =
    availability?.resources?.length || Number(summary.resource_count || 0);

  const liveCaps = resolveListingLiveCapabilities(listing);
  const rateText =
    minRateInr !== null
      ? `From ${formatBookingInr(minRateInr)}/${unitLabel}`
      : null;

  return (
    <ListingSummarySheetShell
      listing={listing}
      onClose={onClose}
      testId="booking-summary-modal"
      ariaLabel={`Quick booking summary for ${listing.title}`}
      categoryLabel="Bookable Venue"
      shareVerticalBadge="Bookable Venue"
      sharePriceLabel={rateText}
      verticalBadgeSlot={
        <span className="inline-flex items-center gap-1 rounded-md bg-emerald-600/95 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-white shadow-xs backdrop-blur-sm">
          <CalendarDays className="h-3 w-3" />
          Bookable Venue
        </span>
      }
      priceHighlight={
        minRateInr !== null ? (
          <span className="font-mono text-sm font-extrabold text-emerald-700 dark:text-emerald-300 tabular-nums shrink-0">
            {formatBookingInr(minRateInr)}
            <span className="text-[10px] font-semibold opacity-75">
              /{unitLabel}
            </span>
          </span>
        ) : null
      }
      identityExtraSlot={
        resourceCount > 0 ? (
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-[var(--ps-text-muted)]">
            <Layers className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
            <span>
              {resourceCount}{' '}
              {resourceCount === 1 ? 'Bookable Space' : 'Bookable Spaces'}
            </span>
          </div>
        ) : null
      }
      footerSlot={
        <div className="flex items-center gap-2">
          {liveCaps.canBookVenueOrStay ? (
            <Link
              href={`/listing/${encodeURIComponent(listing.id)}/book`}
              onClick={onClose}
              data-testid="booking-summary-primary-cta"
              className="inline-flex min-h-[44px] h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-xs font-bold text-white shadow-xs transition hover:bg-emerald-700"
            >
              <span>Book Slot</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          ) : listing.contactPhone?.trim() ? (
            <a
              href={`tel:${listing.contactPhone.replace(/[^+\d]/g, '')}`}
              data-testid="booking-summary-call-cta"
              className="inline-flex min-h-[44px] h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-xs font-bold text-white shadow-xs transition hover:bg-emerald-700"
            >
              <Phone className="h-3.5 w-3.5" />
              <span>Call to Enquire</span>
            </a>
          ) : null}
          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenFullDetailPage(listing.id);
            }}
            className="inline-flex min-h-[44px] h-11 flex-1 items-center justify-center gap-1 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-3.5 text-xs font-bold text-[var(--ps-text)] hover:border-[var(--ps-accent)] transition-colors cursor-pointer"
          >
            <span>Open Full Details</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      }
    >
      <div className="space-y-3">
        {/* Today's Quick Slots */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-2">
            <span className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
              <Clock className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              Today&apos;s Quick Slots
            </span>
            {primaryResource && (
              <span className="text-[11px] font-semibold text-[var(--ps-text-muted)] truncate max-w-[180px]">
                {primaryResource.resourceName}
              </span>
            )}
          </div>

          {isLoading ? (
            <div
              data-testid="booking-summary-skeleton"
              className="flex gap-2 overflow-hidden"
            >
              {Array.from({ length: 4 }).map((_, idx) => (
                <div
                  key={idx}
                  className="dd-shimmer h-14 w-28 shrink-0 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)]"
                />
              ))}
            </div>
          ) : errorMsg ? (
            <div className="rounded-xl border border-amber-500/30 bg-amber-500/8 px-3 py-2.5 text-xs text-amber-800 dark:text-amber-300 flex items-start gap-2">
              <Info className="h-4 w-4 shrink-0 mt-0.5" />
              <span>{errorMsg}</span>
            </div>
          ) : hasSlotGrid ? (
            <div className="flex gap-2 overflow-x-auto pb-1 scrollbar-thin">
              {slots.map((slot) => (
                <Link
                  key={slot.startAt}
                  href={`/listing/${encodeURIComponent(listing.id)}/book`}
                  onClick={(e) => {
                    if (!slot.isAvailable) {
                      e.preventDefault();
                      return;
                    }
                    onClose();
                  }}
                  className={`flex flex-col justify-between shrink-0 min-w-[112px] min-h-[44px] rounded-xl border px-2.5 py-2 text-left transition ${
                    slot.isAvailable
                      ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-900 hover:bg-emerald-500/15 dark:text-emerald-200'
                      : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] opacity-60 cursor-not-allowed'
                  }`}
                >
                  <span className="text-[10px] font-bold leading-tight whitespace-nowrap">
                    {slot.label}
                  </span>
                  <div className="mt-1 flex items-center justify-between gap-1">
                    <span className="font-mono text-[10px] font-extrabold tabular-nums">
                      {formatBookingInr(slot.rateInr)}
                    </span>
                    {slot.isAvailable ? (
                      slot.isPeak ? (
                        <span className="inline-flex items-center gap-0.5 rounded bg-amber-500/20 px-1 py-0.5 text-[8px] font-extrabold uppercase text-amber-800 dark:text-amber-300">
                          <Sparkles className="h-2 w-2" />
                          Peak
                        </span>
                      ) : (
                        <span className="text-[9px] font-bold text-emerald-700 dark:text-emerald-300">
                          Open
                        </span>
                      )
                    ) : (
                      <span className="text-[9px] font-semibold">
                        {slot.isPast ? 'Past' : 'Booked'}
                      </span>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          ) : availability && availability.resources.length > 0 ? (
            <div className="space-y-1.5">
              {availability.resources.slice(0, 3).map((res) => (
                <div
                  key={res.resourceId}
                  className="flex items-center justify-between gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 text-xs"
                >
                  <div className="min-w-0">
                    <p className="font-bold text-[var(--ps-text)] truncate">
                      {res.resourceName}
                    </p>
                    <p className="text-[10px] text-[var(--ps-text-muted)]">
                      {formatBookingInr(res.baseRateInr)}/
                      {getBookingUnitShortLabel(res.bookingUnit)}
                    </p>
                  </div>
                  <span
                    className={`shrink-0 rounded-md px-2 py-0.5 text-[10px] font-bold ${
                      res.isAvailable
                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                        : 'bg-[var(--ps-surface-alt)] text-[var(--ps-text-muted)]'
                    }`}
                  >
                    {res.isAvailable ? 'Available Today' : 'Unavailable'}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2.5 text-xs text-[var(--ps-text-muted)]">
              Check full booking calendar for upcoming dates and slot
              availability.
            </div>
          )}
        </div>

        {/* Advance Deposit Note */}
        <div className="flex items-center gap-2 rounded-xl border border-emerald-500/25 bg-emerald-500/8 px-3 py-2 text-[11px] font-medium text-emerald-800 dark:text-emerald-300">
          <ShieldCheck className="h-4 w-4 shrink-0" />
          <span>
            {advancePercent > 0
              ? `Lock your slot with ${advancePercent}% advance via DD oodle Escrow · Pay balance at venue.`
              : 'Direct instant booking · Pay directly at the venue counter.'}
          </span>
        </div>

        {/* Shared Location Mini-Map */}
        <DynamicListingLocationMap
          listingId={listing.id}
          title={listing.title}
          locality={listing.locality}
          address={listing.address}
          coordinates={listing.coordinates}
          listingVertical="booking_venue"
          compact
        />
      </div>
    </ListingSummarySheetShell>
  );
}

export default BookingSummaryModal;
