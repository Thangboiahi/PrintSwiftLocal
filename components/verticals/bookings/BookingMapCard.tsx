'use client';

import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  Bookmark,
  CalendarDays,
  Crosshair,
  Layers,
  MapPin,
  Star,
} from 'lucide-react';
import {
  formatBookingInr,
  getBookingUnitShortLabel,
} from '@/lib/bookings/client-helpers';
import { useSavedInterests } from '@/lib/hooks/useSavedInterests';
import { resolveListingLiveCapabilities } from '@/lib/verticals/capabilities';
import { ShareButton } from '@/components/ui/ShareButton';
import { splitSamplePrefix } from '@/lib/utils/display-title';
import { supabaseMediaImageLoader } from '@/lib/supabase/storage';
import type { Listing } from '@/lib/types';

export interface BookingMapCardProps {
  item: Listing;
  isSaved: boolean;
  isHovered: boolean;
  isSelected: boolean;
  isMobileLandscape: boolean;
  showOutsideViewportBadge?: boolean;
  onMouseEnter: () => void;
  onMouseLeave: () => void;
  onOpenSummary: () => void;
  onCenterOnMap: () => void;
  onToggleSave: () => void;
}

export function BookingMapCard({
  item,
  isSaved,
  isHovered,
  isSelected,
  isMobileLandscape,
  showOutsideViewportBadge = false,
  onMouseEnter,
  onMouseLeave,
  onOpenSummary,
  onCenterOnMap,
  onToggleSave,
}: BookingMapCardProps) {
  const summary = item.vertical_summary || {};
  const minRateInr =
    summary.min_rate_inr !== null &&
    summary.min_rate_inr !== undefined &&
    Number.isFinite(Number(summary.min_rate_inr))
      ? Number(summary.min_rate_inr)
      : null;
  const unitLabel = getBookingUnitShortLabel(
    typeof summary.primary_unit === 'string' ? summary.primary_unit : 'hourly'
  );
  const resourceCount = Math.max(0, Number(summary.resource_count || 0));
  const isAccepting = summary.is_accepting_bookings !== false;
  const coverUrl = item.coverImage?.trim() || '';

  const { isSaved: isUnifiedSaved, toggleSave: toggleUnifiedSave } =
    useSavedInterests();
  const effectiveSaved = isSaved || isUnifiedSaved('listing', item.id);

  return (
    <div
      data-testid={`booking-map-card-${item.id}`}
      data-listing-id={item.id}
      data-listing-vertical="booking_venue"
      data-selected={isSelected ? 'true' : 'false'}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onOpenSummary}
      className={`group relative w-full max-w-[440px] mx-auto rounded-xl border transition-all duration-150 ease-out cursor-pointer ${
        isMobileLandscape ? 'p-2.5 gap-2' : 'p-3 gap-2.5'
      } flex flex-col justify-between bg-[var(--ps-surface)] ${
        isSelected
          ? 'border-emerald-600 dark:border-emerald-400 ring-1 ring-emerald-500/30 shadow-sm'
          : isHovered
            ? 'border-emerald-500/60 dark:border-emerald-500/50 shadow-sm'
            : 'border-[var(--ps-border)] hover:border-emerald-500/50 shadow-2xs'
      }`}
    >
      {/* Top Row: Thumbnail / Calendar Emblem + Badges + Rate Pill + Locate/Save */}
      <div className="flex items-start gap-2.5">
        <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-emerald-500/25 bg-emerald-500/10">
          {coverUrl ? (
            <Image
              loader={supabaseMediaImageLoader}
              unoptimized={false}
              src={coverUrl}
              alt={item.title}
              fill
              sizes="56px"
              referrerPolicy="no-referrer"
              className="object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-emerald-700 dark:text-emerald-300">
              <CalendarDays className="h-6 w-6" aria-hidden="true" />
            </div>
          )}
          <span
            aria-hidden="true"
            className="absolute bottom-1 right-1 inline-flex h-5 w-5 items-center justify-center rounded-md bg-emerald-600 text-white shadow-xs"
          >
            <CalendarDays className="h-3 w-3" />
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1.5">
            <div className="flex flex-wrap items-center gap-1 min-w-0">
              <span className="inline-flex items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/10 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
                <CalendarDays className="h-2.5 w-2.5 shrink-0" />
                Bookable Venue
              </span>

              {minRateInr !== null && (
                <span className="inline-flex items-center rounded bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] font-extrabold text-white dark:bg-emerald-500/20 dark:text-emerald-200 tabular-nums">
                  {formatBookingInr(minRateInr)}/{unitLabel}
                </span>
              )}

              {showOutsideViewportBadge && (
                <span className="rounded border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-medium text-amber-700 dark:text-amber-300">
                  Outside View
                </span>
              )}
            </div>

            <div className="flex items-center shrink-0 gap-0.5 -mr-1 -mt-0.5">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onCenterOnMap();
                }}
                aria-label={`Locate ${item.title} on map`}
                title="Locate on Map"
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--ps-text-muted)] hover:bg-[var(--ps-surface-alt)] hover:text-[var(--ps-text)] transition-colors"
              >
                <Crosshair className="h-3.5 w-3.5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  onToggleSave();
                  void toggleUnifiedSave('listing', item.id);
                }}
                aria-label={effectiveSaved ? 'Remove from saved' : 'Save venue'}
                title={effectiveSaved ? 'Saved' : 'Save'}
                className="inline-flex h-7 w-7 items-center justify-center rounded-md text-[var(--ps-text-muted)] hover:bg-[var(--ps-surface-alt)] hover:text-[var(--ps-text)] transition-colors"
              >
                <Bookmark
                  className={`h-3.5 w-3.5 ${
                    effectiveSaved
                      ? 'fill-current text-[var(--ps-accent)]'
                      : ''
                  }`}
                  aria-hidden="true"
                />
              </button>
            </div>
          </div>

          <h3 className="mt-1 line-clamp-1 text-xs sm:text-sm font-bold tracking-tight text-[var(--ps-text)] group-hover:text-emerald-700 dark:group-hover:text-emerald-300 transition-colors">
            {item.title}
          </h3>

          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[var(--ps-text-muted)]">
            <span className="inline-flex items-center gap-1 min-w-0">
              <MapPin className="h-3 w-3 shrink-0" />
              <span className="truncate font-medium">{item.locality}</span>
            </span>
            {Number(item.rating || 0) > 0 && (
              <>
                <span className="opacity-40">·</span>
                <span className="inline-flex items-center gap-0.5 font-bold text-amber-500">
                  <Star className="h-3 w-3 fill-current" />
                  {item.rating}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Resource Count + Instant Booking Live Indicator */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[10px]">
        <div className="flex flex-wrap items-center gap-2 text-[var(--ps-text-muted)]">
          {resourceCount > 0 && (
            <span className="inline-flex items-center gap-1 font-semibold text-[var(--ps-text)]">
              <Layers className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
              {resourceCount}{' '}
              {resourceCount === 1 ? 'Bookable Space' : 'Bookable Spaces'}
            </span>
          )}
          <span className="inline-flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-300">
            <span
              className={`h-1.5 w-1.5 rounded-full ${
                isAccepting ? 'bg-emerald-500 animate-pulse' : 'bg-amber-500'
              }`}
            />
            {isAccepting ? 'Instant Slot Booking' : 'Slots Paused'}
          </span>
        </div>
      </div>

      {/* Footer: Quick Summary Trigger + Share + Book Slot CTA */}
      <div className="flex items-center gap-2 pt-2 border-t border-[var(--ps-border)]/80">
        <ShareButton
          compact
          title={splitSamplePrefix(item.title).title}
          text={`${splitSamplePrefix(item.title).title} in ${item.locality} on DD oodle`}
          url={`/listing/${encodeURIComponent(item.id)}`}
          label={`Share ${splitSamplePrefix(item.title).title}`}
          testId={`share-booking-${item.id}`}
          className="h-8 w-8"
        />
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenSummary();
          }}
          className="inline-flex h-8 items-center justify-center rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors"
        >
          Quick Slots
        </button>

        {resolveListingLiveCapabilities(item).canBookVenueOrStay ? (
          <Link
            href={`/listing/${encodeURIComponent(item.id)}/book`}
            onClick={(e) => e.stopPropagation()}
            data-testid={`booking-quick-cta-${item.id}`}
            className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white shadow-2xs transition hover:bg-emerald-700 dark:bg-emerald-600 dark:hover:bg-emerald-500"
          >
            <CalendarDays className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>Book Slot</span>
          </Link>
        ) : (
          <Link
            href={`/listing/${encodeURIComponent(item.id)}`}
            onClick={(e) => e.stopPropagation()}
            data-testid={`booking-details-cta-${item.id}`}
            className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs font-bold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition"
          >
            <span>View Details</span>
          </Link>
        )}
      </div>
    </div>
  );
}

export default BookingMapCard;
