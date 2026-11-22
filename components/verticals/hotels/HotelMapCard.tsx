'use client';

import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  BedDouble,
  Bookmark,
  Crosshair,
  MapPin,
  Star,
} from 'lucide-react';
import {
  formatBookingInr,
  getAmenityLabel,
  getHotelStayTypeLabel,
} from '@/lib/bookings/client-helpers';
import { useSavedInterests } from '@/lib/hooks/useSavedInterests';
import { resolveListingLiveCapabilities } from '@/lib/verticals/capabilities';
import { supabaseMediaImageLoader } from '@/lib/supabase/storage';
import type { Listing } from '@/lib/types';

export interface HotelMapCardProps {
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

export function HotelMapCard({
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
}: HotelMapCardProps) {
  const summary = item.vertical_summary || {};
  const minRateInr =
    summary.min_rate_inr !== null &&
    summary.min_rate_inr !== undefined &&
    Number.isFinite(Number(summary.min_rate_inr))
      ? Number(summary.min_rate_inr)
      : null;
  const stayTypeLabel = getHotelStayTypeLabel(
    typeof summary.stay_type === 'string' ? summary.stay_type : 'hotel'
  );
  const topAmenities: string[] = Array.isArray(summary.top_amenities)
    ? summary.top_amenities
        .map((a) => String(a || '').trim())
        .filter(Boolean)
        .slice(0, 3)
    : [];
  const roomTypeCount = Math.max(0, Number(summary.resource_count || 0));
  const coverUrl = item.coverImage?.trim() || '';

  const { isSaved: isUnifiedSaved, toggleSave: toggleUnifiedSave } =
    useSavedInterests();
  const effectiveSaved = isSaved || isUnifiedSaved('listing', item.id);

  return (
    <div
      data-testid={`hotel-map-card-${item.id}`}
      data-listing-id={item.id}
      data-listing-vertical="hotel_stay"
      data-selected={isSelected ? 'true' : 'false'}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onOpenSummary}
      className={`group relative w-full max-w-[440px] mx-auto rounded-xl border transition-all duration-150 ease-out cursor-pointer ${
        isMobileLandscape ? 'p-2.5 gap-2' : 'p-3 gap-2.5'
      } flex flex-col justify-between bg-[var(--ps-surface)] ${
        isSelected
          ? 'border-indigo-600 dark:border-indigo-400 ring-1 ring-indigo-500/30 shadow-sm'
          : isHovered
            ? 'border-indigo-500/60 dark:border-indigo-500/50 shadow-sm'
            : 'border-[var(--ps-border)] hover:border-indigo-500/50 shadow-2xs'
      }`}
    >
      {/* Top Row: Property Photo / Bed Emblem + Stay Type + Price Pill + Locate/Save */}
      <div className="flex items-start gap-2.5">
        <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-xl border border-indigo-500/25 bg-indigo-500/10">
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
            <div className="flex h-full w-full items-center justify-center text-indigo-700 dark:text-indigo-300">
              <BedDouble className="h-6 w-6" aria-hidden="true" />
            </div>
          )}
          <span
            aria-hidden="true"
            className="absolute bottom-1 right-1 inline-flex h-5 w-5 items-center justify-center rounded-md bg-indigo-600 text-white shadow-xs"
          >
            <BedDouble className="h-3 w-3" />
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1.5">
            <div className="flex flex-wrap items-center gap-1 min-w-0">
              <span className="inline-flex items-center gap-1 rounded border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wider text-indigo-800 dark:text-indigo-300">
                <BedDouble className="h-2.5 w-2.5 shrink-0" />
                {stayTypeLabel}
              </span>

              {minRateInr !== null && (
                <span className="inline-flex items-center rounded bg-indigo-700 px-1.5 py-0.5 font-mono text-[10px] font-extrabold text-white dark:bg-indigo-500/30 dark:text-indigo-200 tabular-nums">
                  {formatBookingInr(minRateInr)}/night
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
                aria-label={effectiveSaved ? 'Remove from saved' : 'Save stay'}
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

          <h3 className="mt-1 line-clamp-1 text-xs sm:text-sm font-bold tracking-tight text-[var(--ps-text)] group-hover:text-indigo-700 dark:group-hover:text-indigo-300 transition-colors">
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
            {roomTypeCount > 0 && (
              <>
                <span className="opacity-40">·</span>
                <span className="text-[10px] font-semibold">
                  {roomTypeCount} {roomTypeCount === 1 ? 'room type' : 'room types'}
                </span>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Compact Amenity Badges (up to 3) */}
      {topAmenities.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {topAmenities.map((amenityKey) => (
            <span
              key={amenityKey}
              className="inline-flex items-center rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--ps-text-muted)]"
            >
              {getAmenityLabel(amenityKey)}
            </span>
          ))}
        </div>
      )}

      {/* Footer: Quick Availability + View Rooms CTA */}
      <div className="flex items-center gap-2 pt-2 border-t border-[var(--ps-border)]/80">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpenSummary();
          }}
          className="inline-flex h-8 items-center justify-center rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors"
        >
          Quick View
        </button>

        {resolveListingLiveCapabilities(item).canBookVenueOrStay ? (
          <Link
            href={`/listing/${encodeURIComponent(item.id)}/book`}
            onClick={(e) => e.stopPropagation()}
            data-testid={`hotel-quick-cta-${item.id}`}
            className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg bg-indigo-600 px-3 text-xs font-bold text-white shadow-2xs transition hover:bg-indigo-700 dark:bg-indigo-600 dark:hover:bg-indigo-500"
          >
            <BedDouble className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span>Book Room</span>
          </Link>
        ) : (
          <Link
            href={`/listing/${encodeURIComponent(item.id)}`}
            onClick={(e) => e.stopPropagation()}
            data-testid={`hotel-details-cta-${item.id}`}
            className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs font-bold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition"
          >
            <span>View Details</span>
          </Link>
        )}
      </div>
    </div>
  );
}

export default HotelMapCard;
