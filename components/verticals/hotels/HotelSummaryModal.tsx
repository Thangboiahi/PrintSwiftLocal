'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  BedDouble,
  CheckCircle2,
  Clock,
  Info,
  Phone,
} from 'lucide-react';
import { ListingSummarySheetShell } from '@/components/discovery/ListingSummarySheetShell';
import { DynamicListingLocationMap } from '@/components/maps/ListingLocationMapDynamic';
import {
  addDaysToYmd,
  diffYmdDays,
  formatBookingInr,
  getAmenityLabel,
  getHotelStayTypeLabel,
  getTodayIstYmd,
  type ApiAvailabilityResponse,
} from '@/lib/bookings/client-helpers';
import { resolveListingLiveCapabilities } from '@/lib/verticals/capabilities';
import type { Listing } from '@/lib/types';

export interface HotelSummaryModalProps {
  listing: Listing;
  onClose: () => void;
  onOpenFullDetailPage: (listingId: string) => void;
}

export function HotelSummaryModal({
  listing,
  onClose,
  onOpenFullDetailPage,
}: HotelSummaryModalProps) {
  const liveCaps = resolveListingLiveCapabilities(listing);
  const todayYmd = useMemo(() => getTodayIstYmd(), []);
  const [checkIn, setCheckIn] = useState<string>(todayYmd);
  const [checkOut, setCheckOut] = useState<string>(() =>
    addDaysToYmd(todayYmd, 1)
  );
  const [availability, setAvailability] =
    useState<ApiAvailabilityResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);
    setErrorMsg(null);

    const url = `/api/bookings/availability?listingId=${encodeURIComponent(
      listing.id
    )}&checkIn=${encodeURIComponent(checkIn)}&checkOut=${encodeURIComponent(
      checkOut
    )}`;

    fetch(url, { cache: 'no-store' })
      .then(async (res) => {
        const json = (await res
          .json()
          .catch(() => ({}))) as ApiAvailabilityResponse;
        if (!res.ok) {
          throw new Error(json.error || 'Could not load room availability.');
        }
        return json;
      })
      .then((data) => {
        if (!cancelled) setAvailability(data);
      })
      .catch((err) => {
        if (!cancelled) {
          setErrorMsg(
            err instanceof Error
              ? err.message
              : 'Live room availability temporarily unavailable.'
          );
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [listing.id, checkIn, checkOut]);

  const summary = listing.vertical_summary || {};
  const stayTypeLabel = getHotelStayTypeLabel(
    typeof summary.stay_type === 'string' ? summary.stay_type : 'hotel'
  );
  const amenities: string[] = Array.isArray(summary.top_amenities)
    ? summary.top_amenities.map((a) => String(a || '').trim()).filter(Boolean)
    : [];

  const totalRemainingRooms = (availability?.resources || []).reduce(
    (sum, r) => sum + Math.max(0, Number(r.remainingUnits ?? 0)),
    0
  );

  const minNightlyRate =
    availability?.resources && availability.resources.length > 0
      ? Math.min(...availability.resources.map((r) => r.baseRateInr))
      : summary.min_rate_inr !== null &&
          summary.min_rate_inr !== undefined &&
          Number.isFinite(Number(summary.min_rate_inr))
        ? Number(summary.min_rate_inr)
        : null;

  const nights = diffYmdDays(checkIn, checkOut);
  const isTonight = checkIn === todayYmd && nights === 1;
  const bookUrl = `/listing/${encodeURIComponent(
    listing.id
  )}/book?checkIn=${encodeURIComponent(checkIn)}&checkOut=${encodeURIComponent(
    checkOut
  )}`;

  const handleCheckInChange = (nextCheckIn: string) => {
    setCheckIn(nextCheckIn);
    if (nextCheckIn >= checkOut) {
      setCheckOut(addDaysToYmd(nextCheckIn, 1));
    }
  };

  const handleCheckOutChange = (nextCheckOut: string) => {
    if (nextCheckOut <= checkIn) {
      setCheckOut(addDaysToYmd(checkIn, 1));
    } else {
      setCheckOut(nextCheckOut);
    }
  };

  const rateText =
    minNightlyRate !== null
      ? `From ${formatBookingInr(minNightlyRate)}/night`
      : null;

  return (
    <ListingSummarySheetShell
      listing={listing}
      onClose={onClose}
      testId="hotel-summary-modal"
      ariaLabel={`Quick stay summary for ${listing.title}`}
      categoryLabel={stayTypeLabel}
      shareVerticalBadge="Stays & Hotels"
      sharePriceLabel={rateText}
      verticalBadgeSlot={
        <span className="inline-flex items-center gap-1 rounded-md bg-indigo-600/95 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-white shadow-xs backdrop-blur-sm">
          <BedDouble className="h-3 w-3" />
          {stayTypeLabel}
        </span>
      }
      priceHighlight={
        minNightlyRate !== null ? (
          <span className="font-mono text-sm font-extrabold text-indigo-700 dark:text-indigo-300 tabular-nums shrink-0">
            {formatBookingInr(minNightlyRate)}
            <span className="text-[10px] font-semibold opacity-75">/night</span>
          </span>
        ) : null
      }
      footerSlot={
        <div className="flex items-center gap-2">
          {liveCaps.canBookVenueOrStay ? (
            <Link
              href={bookUrl}
              onClick={onClose}
              data-testid="hotel-summary-primary-cta"
              className="inline-flex min-h-[44px] h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 text-xs font-bold text-white shadow-xs transition hover:bg-indigo-700"
            >
              <span>View Rooms &amp; Book</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          ) : listing.contactPhone?.trim() ? (
            <a
              href={`tel:${listing.contactPhone.replace(/[^+\d]/g, '')}`}
              className="inline-flex min-h-[44px] h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-indigo-600 px-3.5 text-xs font-bold text-white shadow-xs transition hover:bg-indigo-700"
            >
              <Phone className="h-3.5 w-3.5" />
              <span>Call for Rooms</span>
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
        {/* Compact Check-In / Check-Out Selector */}
        <div className="grid grid-cols-2 gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-2.5">
          <label className="space-y-1">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
              Check-In
            </span>
            <input
              type="date"
              min={todayYmd}
              value={checkIn}
              onChange={(e) => handleCheckInChange(e.target.value)}
              className="min-h-[44px] h-11 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 text-xs font-semibold text-[var(--ps-text)] focus:border-indigo-500 focus:outline-none"
            />
          </label>
          <label className="space-y-1">
            <span className="block text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
              Check-Out ({nights}n)
            </span>
            <input
              type="date"
              min={addDaysToYmd(checkIn, 1)}
              value={checkOut}
              onChange={(e) => handleCheckOutChange(e.target.value)}
              className="min-h-[44px] h-11 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 text-xs font-semibold text-[var(--ps-text)] focus:border-indigo-500 focus:outline-none"
            />
          </label>
        </div>

        {/* Live Rooms Available Strip */}
        {isLoading ? (
          <div className="dd-shimmer h-14 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)]" />
        ) : errorMsg ? (
          <div className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/8 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
            <Info className="h-4 w-4 shrink-0 mt-0.5" />
            <span>{errorMsg}</span>
          </div>
        ) : (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-indigo-500/25 bg-indigo-500/8 px-3 py-2.5">
            <div>
              <p className="text-xs font-extrabold text-indigo-900 dark:text-indigo-200">
                {totalRemainingRooms > 0
                  ? `${totalRemainingRooms} ${
                      totalRemainingRooms === 1 ? 'Room' : 'Rooms'
                    } Available ${isTonight ? 'Tonight' : 'for Dates'}`
                  : 'Sold Out for Selected Dates'}
              </p>
              {(availability?.checkInTime || availability?.checkOutTime) && (
                <p className="mt-0.5 flex items-center gap-1 text-[10px] font-medium text-indigo-800/80 dark:text-indigo-300/80">
                  <Clock className="h-3 w-3 shrink-0" />
                  Check-in {availability.checkInTime || '12:00 PM'} · Check-out{' '}
                  {availability.checkOutTime || '11:00 AM'}
                </p>
              )}
            </div>
            {minNightlyRate !== null && (
              <div className="text-right shrink-0">
                <span className="block font-mono text-sm font-extrabold text-indigo-800 dark:text-indigo-200 tabular-nums">
                  {formatBookingInr(minNightlyRate)}
                </span>
                <span className="block text-[9px] font-semibold uppercase text-indigo-700/80 dark:text-indigo-300/80">
                  per night
                </span>
              </div>
            )}
          </div>
        )}

        {/* Verified Amenity Pills */}
        {amenities.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {amenities.slice(0, 6).map((a) => (
              <span
                key={a}
                className="inline-flex items-center gap-1 rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-0.5 text-[10px] font-semibold text-[var(--ps-text)]"
              >
                <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                {getAmenityLabel(a)}
              </span>
            ))}
          </div>
        )}

        {/* Shared Location Mini-Map */}
        <DynamicListingLocationMap
          listingId={listing.id}
          title={listing.title}
          locality={listing.locality}
          address={listing.address}
          coordinates={listing.coordinates}
          listingVertical="hotel_stay"
          compact
        />
      </div>
    </ListingSummarySheetShell>
  );
}

export default HotelSummaryModal;
