'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { motion } from 'motion/react';
import { useHydrated } from '@/hooks/useHydrated';
import {
  ArrowRight,
  CalendarDays,
  Clock,
  Info,
  Layers,
  MapPin,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import {
  formatBookingInr,
  getBookingUnitShortLabel,
  getTodayIstYmd,
  type ApiAvailabilityResponse,
} from '@/lib/bookings/client-helpers';
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
  const isHydrated = useHydrated();
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
        const json = (await res.json().catch(() => ({}))) as ApiAvailabilityResponse;
        if (!res.ok) {
          throw new Error(json.error || 'Could not load live slot availability.');
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

  if (!isHydrated || typeof document === 'undefined') return null;

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
      (typeof summary.primary_unit === 'string' ? summary.primary_unit : 'hourly')
  );
  const advancePercent = primaryResource?.advancePercent ?? 30;
  const resourceCount =
    availability?.resources?.length || Number(summary.resource_count || 0);

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Quick booking summary for ${listing.title}`}
      data-testid="booking-summary-modal"
      className="fixed inset-0 z-[85] flex items-end sm:items-center justify-center bg-slate-950/65 p-0 sm:p-4 backdrop-blur-xs"
    >
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, y: 18, scale: 0.98 }}
        transition={{ duration: 0.16 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text)] shadow-2xl"
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2 border-b border-[var(--ps-border)] bg-[var(--ps-bg)]/70 px-4 py-3">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
                <CalendarDays className="h-3 w-3" />
                Bookable Venue
              </span>
              {minRateInr !== null && (
                <span className="rounded bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white dark:bg-emerald-500/20 dark:text-emerald-200 tabular-nums">
                  From {formatBookingInr(minRateInr)}/{unitLabel}
                </span>
              )}
              {resourceCount > 0 && (
                <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--ps-text-muted)]">
                  <Layers className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                  {resourceCount} {resourceCount === 1 ? 'Space' : 'Spaces'}
                </span>
              )}
            </div>
            <h3 className="mt-1 text-sm font-extrabold text-[var(--ps-text)] line-clamp-1">
              {listing.title}
            </h3>
            <p className="mt-0.5 flex items-center gap-1 text-[11px] text-[var(--ps-text-muted)]">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate">{listing.locality}</span>
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close booking summary"
            className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="p-4 space-y-3.5">
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
                    className="h-14 w-28 shrink-0 animate-pulse rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)]"
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
                    className={`flex flex-col justify-between shrink-0 min-w-[112px] rounded-xl border px-2.5 py-2 text-left transition ${
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
                          : 'bg-slate-200/70 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                      }`}
                    >
                      {res.isAvailable ? 'Available Today' : 'Unavailable'}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2.5 text-xs text-[var(--ps-text-muted)]">
                Check full booking calendar for upcoming dates and slot availability.
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

          {/* Actions */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 pt-1">
            <Link
              href={`/listing/${encodeURIComponent(listing.id)}/book`}
              onClick={onClose}
              data-testid="booking-summary-primary-cta"
              className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white shadow-xs transition hover:bg-emerald-700"
            >
              <span>Book Slot</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenFullDetailPage(listing.id);
              }}
              className="inline-flex h-9 items-center justify-center gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors"
            >
              <span>Full Venue Details</span>
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>,
    document.body
  );
}

export default BookingSummaryModal;
