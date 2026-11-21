import React from 'react';
import Link from 'next/link';
import {
  ArrowRight,
  BedDouble,
  CheckCircle2,
  Clock,
  FileCheck2,
  ShieldCheck,
  Users,
} from 'lucide-react';
import {
  formatBookingInr,
  getAmenityLabel,
  getHotelStayTypeLabel,
} from '@/lib/bookings/client-helpers';
import type {
  ListingBookingResource,
  ListingHotelProfile,
} from '@/lib/bookings/types';

export interface HotelServiceCardProps {
  listingId: string;
  hotelProfile: ListingHotelProfile | null;
  rooms: ListingBookingResource[];
  hasActiveEntitlement: boolean;
}

export function HotelServiceCard({
  listingId,
  hotelProfile,
  rooms,
  hasActiveEntitlement,
}: HotelServiceCardProps) {
  if (!hotelProfile && rooms.length === 0) return null;

  const minRate =
    rooms.length > 0 ? Math.min(...rooms.map((r) => r.base_rate_inr)) : null;

  const activeAmenities = hotelProfile
    ? Object.entries(hotelProfile.amenities || {})
        .filter(([, enabled]) => Boolean(enabled))
        .map(([key]) => ({
          key,
          label: getAmenityLabel(key),
          verified: Boolean(hotelProfile.verified_amenities?.[key]),
        }))
    : [];

  return (
    <section
      data-testid="hotel-service-card"
      className="rounded-2xl border border-indigo-500/30 bg-[var(--ps-surface)] p-5 shadow-xs space-y-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ps-border)] pb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-700 dark:text-indigo-300">
            <BedDouble className="h-5 w-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-1.5">
              <h2 className="text-sm sm:text-base font-extrabold text-[var(--ps-text)]">
                Rooms &amp; Stay Reservation
              </h2>
              <span className="rounded bg-indigo-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-indigo-800 dark:text-indigo-300">
                {getHotelStayTypeLabel(hotelProfile?.stay_type)}
              </span>
            </div>
            <p className="text-xs text-[var(--ps-text-muted)]">
              {minRate !== null ? (
                <>
                  Nightly stays from{' '}
                  <strong className="font-mono text-[var(--ps-text)]">
                    {formatBookingInr(minRate)}/night
                  </strong>{' '}
                  · {rooms.length}{' '}
                  {rooms.length === 1 ? 'room type' : 'room types'}
                </>
              ) : (
                'Verified stay details & check-in rules'
              )}
            </p>
          </div>
        </div>

        <Link
          href={`/listing/${encodeURIComponent(listingId)}/book`}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-indigo-600 px-4 text-xs font-bold text-white shadow-xs transition hover:bg-indigo-700"
        >
          <span>
            {hasActiveEntitlement ? 'Check Rooms & Book' : 'View Rooms'}
          </span>
          <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>

      {/* Check-in / Check-out & ID Rules */}
      {hotelProfile && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 space-y-1">
            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase text-indigo-600 dark:text-indigo-400">
              <Clock className="h-3 w-3" />
              Check-In &amp; Check-Out
            </span>
            <p className="font-bold text-[var(--ps-text)]">
              Check-In: {hotelProfile.check_in_time} · Check-Out:{' '}
              {hotelProfile.check_out_time}
            </p>
            <p className="text-[11px] text-[var(--ps-text-muted)]">
              {hotelProfile.cancellation_policy}
            </p>
          </div>
          <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 space-y-1">
            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase text-indigo-600 dark:text-indigo-400">
              <FileCheck2 className="h-3 w-3" />
              Reception Photo-ID Policy
            </span>
            <p className="text-[11px] font-medium text-[var(--ps-text)]">
              {hotelProfile.id_requirement_note}
            </p>
          </div>
        </div>
      )}

      {/* Amenities */}
      {activeAmenities.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {activeAmenities.map((a) => (
            <span
              key={a.key}
              className="inline-flex items-center gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 py-1 text-[11px] font-semibold text-[var(--ps-text)]"
            >
              <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
              {a.label}
              {a.verified && (
                <ShieldCheck className="h-3 w-3 text-indigo-500" />
              )}
            </span>
          ))}
        </div>
      )}

      {/* Room Types Preview */}
      {rooms.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {rooms.slice(0, 6).map((room) => (
            <div
              key={room.id}
              className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3.5 space-y-1.5"
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-extrabold text-[var(--ps-text)] line-clamp-1">
                  {room.name}
                </p>
                <span className="font-mono text-xs font-extrabold text-indigo-700 dark:text-indigo-300 shrink-0 tabular-nums">
                  {formatBookingInr(room.base_rate_inr)}/night
                </span>
              </div>
              {room.description && (
                <p className="text-[11px] text-[var(--ps-text-muted)] line-clamp-2">
                  {room.description}
                </p>
              )}
              <div className="flex items-center gap-2 pt-1 text-[10px] text-[var(--ps-text-muted)]">
                <span className="inline-flex items-center gap-0.5 font-semibold">
                  <Users className="h-3 w-3" />
                  Up to {room.max_guests} guests
                </span>
                <span>·</span>
                <span className="font-semibold">
                  {room.total_units} {room.total_units === 1 ? 'unit' : 'units'}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export default HotelServiceCard;
