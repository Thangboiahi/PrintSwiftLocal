'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import Image from 'next/image';
import Link from 'next/link';
import { motion } from 'framer-motion';
import { useHydrated } from '@/hooks/useHydrated';
import {
  ArrowRight,
  BedDouble,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Clock,
  Compass,
  Info,
  MapPin,
  Phone,
  Share2,
  X,
} from 'lucide-react';
import {
  addDaysToYmd,
  diffYmdDays,
  formatBookingInr,
  getAmenityLabel,
  getHotelStayTypeLabel,
  getTodayIstYmd,
  type ApiAvailabilityResponse,
} from '@/lib/bookings/client-helpers';
import { supabaseMediaImageLoader } from '@/lib/supabase/storage';
import { useModalLock } from '@/hooks/useModalLock';
import { useShare } from '@/components/ui/ShareSheetModal';
import { buildListingSharePayload } from '@/lib/utils/share';
import { resolveListingLiveCapabilities } from '@/lib/verticals/capabilities';
import { DynamicListingLocationMap } from '@/components/maps/ListingLocationMapDynamic';
import { listingHas360Panorama } from '@/components/verticals/SummaryMediaStrip';
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
  const isHydrated = useHydrated();
  useModalLock(true, onClose);
  const { openShareSheet } = useShare();
  const has360 = useMemo(() => listingHas360Panorama(listing), [listing]);
  const liveCaps = resolveListingLiveCapabilities(listing);
  const todayYmd = useMemo(() => getTodayIstYmd(), []);
  const [checkIn, setCheckIn] = useState<string>(todayYmd);
  const [checkOut, setCheckOut] = useState<string>(() =>
    addDaysToYmd(todayYmd, 1)
  );
  const [photoIdx, setPhotoIdx] = useState(0);
  const [availability, setAvailability] =
    useState<ApiAvailabilityResponse | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const photos = useMemo(() => {
    const raw = [
      listing.coverImage?.trim(),
      ...(Array.isArray(listing.galleryImages) ? listing.galleryImages : []),
    ]
      .map((u) => String(u || '').trim())
      .filter(Boolean);
    return Array.from(new Set(raw));
  }, [listing.coverImage, listing.galleryImages]);

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
        const json = (await res.json().catch(() => ({}))) as ApiAvailabilityResponse;
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

  if (!isHydrated || typeof document === 'undefined') return null;

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

  return createPortal(
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`Quick stay summary for ${listing.title}`}
      data-testid="hotel-summary-modal"
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
        {/* Swipeable / Steppable Photo Header */}
        <div className="relative h-44 w-full bg-slate-900">
          {photos.length > 0 ? (
            <Image
              loader={supabaseMediaImageLoader}
              unoptimized={false}
              src={photos[photoIdx % photos.length]}
              alt={listing.title}
              fill
              sizes="(max-width: 640px) 100vw, 448px"
              referrerPolicy="no-referrer"
              className="object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-indigo-950 via-slate-900 to-slate-950 text-indigo-300">
              <BedDouble className="h-10 w-10 opacity-80" />
            </div>
          )}

          {/* Photo Controls */}
          {photos.length > 1 && (
            <>
              <button
                type="button"
                onClick={() =>
                  setPhotoIdx((prev) => (prev - 1 + photos.length) % photos.length)
                }
                aria-label="Previous photo"
                className="absolute left-2.5 top-1/2 -translate-y-1/2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-950/65 text-white hover:bg-slate-950"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => setPhotoIdx((prev) => (prev + 1) % photos.length)}
                aria-label="Next photo"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 inline-flex h-7 w-7 items-center justify-center rounded-full bg-slate-950/65 text-white hover:bg-slate-950"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex items-center gap-1 rounded-full bg-slate-950/60 px-2 py-1">
                {photos.slice(0, 6).map((_, idx) => (
                  <button
                    key={idx}
                    type="button"
                    aria-label={`Photo ${idx + 1}`}
                    onClick={() => setPhotoIdx(idx)}
                    className={`h-1.5 rounded-full transition-all ${
                      idx === photoIdx % photos.length
                        ? 'w-4 bg-white'
                        : 'w-1.5 bg-white/50'
                    }`}
                  />
                ))}
              </div>
            </>
          )}

          {/* Stay Type Badge + Share & Close */}
          <div className="absolute left-3 top-3 flex flex-wrap items-center gap-1.5 max-w-[65%]">
            <span className="inline-flex items-center gap-1 rounded-lg bg-indigo-600/95 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-white shadow-xs">
              <BedDouble className="h-3 w-3" />
              {stayTypeLabel}
            </span>
            {minNightlyRate !== null && (
              <span className="rounded-lg bg-slate-950/85 px-2 py-0.5 font-mono text-[10px] font-extrabold text-white tabular-nums">
                From {formatBookingInr(minNightlyRate)}/night
              </span>
            )}
          </div>

          <div className="absolute right-2.5 top-2.5 flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => openShareSheet(buildListingSharePayload(listing))}
              aria-label={`Share ${listing.title}`}
              data-testid="hotel-summary-share-btn"
              className="inline-flex min-h-[44px] min-w-[44px] h-11 w-11 items-center justify-center rounded-full bg-slate-950/75 text-white backdrop-blur-xs hover:bg-slate-950 cursor-pointer"
            >
              <Share2 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close hotel summary"
              className="inline-flex min-h-[44px] min-w-[44px] h-11 w-11 items-center justify-center rounded-full bg-slate-950/75 text-white backdrop-blur-xs hover:bg-slate-950 cursor-pointer"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="p-4 space-y-3.5">
          <div>
            <h3 className="text-base font-extrabold text-[var(--ps-text)] leading-snug">
              {listing.title}
            </h3>
            <p className="mt-0.5 flex items-center gap-1 text-xs text-[var(--ps-text-muted)]">
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              <span className="truncate">{listing.locality}</span>
            </p>
          </div>

          {has360 && (
            <Link
              href={`/listing/${encodeURIComponent(listing.id)}#media-360`}
              onClick={onClose}
              className="inline-flex min-h-[44px] h-11 w-full items-center justify-between gap-2 rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-3 text-xs font-bold text-indigo-700 transition hover:bg-indigo-500/15 dark:text-indigo-300"
            >
              <span className="inline-flex items-center gap-1.5">
                <Compass className="h-4 w-4 shrink-0" />
                <span>360° Room &amp; Property Tour</span>
              </span>
              <span className="rounded-md bg-indigo-600 px-2 py-0.5 text-[10px] font-extrabold text-white">
                View 360° →
              </span>
            </Link>
          )}

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
            <div className="dd-shimmer h-14 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)]" />
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

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2 pt-1">
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
              <span>Open Full Page</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>,
    document.body
  );
}

export default HotelSummaryModal;
