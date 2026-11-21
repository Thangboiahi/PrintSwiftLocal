import React from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  CalendarDays,
  Layers,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import {
  formatBookingInr,
  getBookingUnitShortLabel,
} from '@/lib/bookings/client-helpers';
import type { ListingBookingResource } from '@/lib/bookings/types';

export interface BookingServiceCardProps {
  listingId: string;
  resources: ListingBookingResource[];
  hasActiveEntitlement: boolean;
}

export function BookingServiceCard({
  listingId,
  resources,
  hasActiveEntitlement,
}: BookingServiceCardProps) {
  if (resources.length === 0) return null;

  const minRate = Math.min(...resources.map((r) => r.base_rate_inr));
  const primaryUnit = getBookingUnitShortLabel(resources[0].booking_unit);

  return (
    <section
      data-testid="booking-service-card"
      className="rounded-2xl border border-emerald-500/30 bg-[var(--ps-surface)] p-5 shadow-xs space-y-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ps-border)] pb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-emerald-500/15 text-emerald-700 dark:text-emerald-300">
            <CalendarDays className="h-5 w-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-1.5">
              <h2 className="text-sm sm:text-base font-extrabold text-[var(--ps-text)]">
                Online Slot &amp; Venue Booking
              </h2>
              <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800 dark:text-emerald-300">
                <Layers className="h-3 w-3" />
                {resources.length}{' '}
                {resources.length === 1 ? 'Space' : 'Spaces'}
              </span>
            </div>
            <p className="text-xs text-[var(--ps-text-muted)]">
              Starting from{' '}
              <strong className="font-mono text-[var(--ps-text)]">
                {formatBookingInr(minRate)}/{primaryUnit}
              </strong>{' '}
              · Live availability &amp; instant OTP confirmation
            </p>
          </div>
        </div>

        <Link
          href={`/listing/${encodeURIComponent(listingId)}/book`}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-emerald-600 px-4 text-xs font-bold text-white shadow-xs transition hover:bg-emerald-700"
        >
          <span>
            {hasActiveEntitlement ? 'Check Slots & Book' : 'View Spaces'}
          </span>
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {/* Resource Preview Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
        {resources.slice(0, 6).map((res) => (
          <div
            key={res.id}
            className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3.5 space-y-1.5"
          >
            <div className="flex items-start justify-between gap-2">
              <p className="text-xs font-extrabold text-[var(--ps-text)] line-clamp-1">
                {res.name}
              </p>
              <span className="font-mono text-xs font-extrabold text-emerald-700 dark:text-emerald-300 shrink-0 tabular-nums">
                {formatBookingInr(res.base_rate_inr)}/
                {getBookingUnitShortLabel(res.booking_unit)}
              </span>
            </div>
            {res.description && (
              <p className="text-[11px] text-[var(--ps-text-muted)] line-clamp-2">
                {res.description}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2 pt-1 text-[10px] text-[var(--ps-text-muted)]">
              <span className="inline-flex items-center gap-0.5 font-semibold">
                <Users className="h-3 w-3" />
                Up to {res.max_guests}
              </span>
              {res.peak_rate_inr !== null && res.peak_start_hour !== null && (
                <span className="inline-flex items-center gap-0.5 rounded bg-amber-500/15 px-1.5 py-0.5 font-bold text-amber-800 dark:text-amber-300">
                  <Sparkles className="h-2.5 w-2.5" />
                  Peak {formatBookingInr(res.peak_rate_inr)}
                </span>
              )}
              <span className="inline-flex items-center gap-0.5 font-semibold text-emerald-700 dark:text-emerald-300">
                <ShieldCheck className="h-3 w-3" />
                {res.advance_percent}% advance
              </span>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

export default BookingServiceCard;
