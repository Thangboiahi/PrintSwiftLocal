'use client';

import React from 'react';
import Image from 'next/image';
import Link from 'next/link';
import {
  Bookmark,
  Crosshair,
  MapPin,
  Share2,
  ShieldCheck,
  Star,
  Truck,
  UtensilsCrossed,
} from 'lucide-react';
import { useSavedInterests } from '@/lib/hooks/useSavedInterests';
import { useShare } from '@/components/ui/ShareSheetModal';
import { splitSamplePrefix } from '@/lib/utils/display-title';
import { supabaseMediaImageLoader } from '@/lib/supabase/storage';
import type { Listing } from '@/lib/types';

export interface RestaurantMapCardProps {
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

export function RestaurantMapCard({
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
}: RestaurantMapCardProps) {
  const { openShareSheet } = useShare();
  const summary = (item.vertical_summary || {}) as Record<string, unknown>;
  const cuisines: string[] = Array.isArray(summary.cuisines)
    ? summary.cuisines
        .map((c) => String(c || '').trim())
        .filter(Boolean)
        .slice(0, 3)
    : Array.isArray(summary.cuisine_tags)
      ? summary.cuisine_tags
          .map((c) => String(c || '').trim())
          .filter(Boolean)
          .slice(0, 3)
      : [];
  const avgCost = Math.max(0, Number(summary.avg_cost_for_two_inr ?? 300));
  const isPureVeg = Boolean(summary.is_pure_veg);
  const isKitchenOpen = summary.is_kitchen_open !== false;
  const allowTableBooking = Boolean(summary.allow_table_booking);
  const prepTimeMins = Math.max(5, Number(summary.prep_time_mins ?? 25));
  const fssaiVerified = Boolean(
    summary.fssai_verified ||
      item.is_verified ||
      item.verificationStatus === 'verified_demo'
  );
  const allowDelivery = summary.allow_pick_n_drop !== false;
  const coverUrl = item.coverImage?.trim() || '';
  const cleanTitle = splitSamplePrefix(item.title).title;

  const { isSaved: isUnifiedSaved, toggleSave: toggleUnifiedSave } =
    useSavedInterests();
  const effectiveSaved = isSaved || isUnifiedSaved('listing', item.id);

  const handleShare = (e: React.MouseEvent) => {
    e.stopPropagation();
    openShareSheet({
      title: cleanTitle,
      text: `Order food or book a table at ${cleanTitle} in ${item.locality} on DD oodle`,
      url: `/listing/${encodeURIComponent(item.id)}`,
      imageUrl: coverUrl || null,
      verticalBadge: 'Food & Dining',
      categoryLabel: isPureVeg ? 'Pure Veg' : cuisines[0] || 'Restaurant',
      locality: item.locality,
      priceLabel: avgCost > 0 ? `₹${avgCost} for two` : null,
      rating: Number(item.rating || 0) > 0 ? Number(item.rating) : null,
      isVerified: fssaiVerified,
    });
  };

  return (
    <div
      data-testid={`restaurant-map-card-${item.id}`}
      data-listing-id={item.id}
      data-listing-vertical="restaurant_food"
      data-selected={isSelected ? 'true' : 'false'}
      onMouseEnter={onMouseEnter}
      onMouseLeave={onMouseLeave}
      onClick={onOpenSummary}
      className={`group relative w-full max-w-[440px] mx-auto rounded-2xl border transition-all duration-150 ease-out cursor-pointer ${
        isMobileLandscape ? 'p-2.5 gap-2' : 'p-3 sm:p-3.5 gap-2.5'
      } flex flex-col justify-between bg-[var(--ps-surface)] ${
        isSelected
          ? 'border-orange-600 dark:border-orange-400 ring-1 ring-orange-500/30 shadow-sm'
          : isHovered
            ? 'border-orange-500/60 dark:border-orange-500/50 shadow-sm'
            : 'border-[var(--ps-border)] hover:border-orange-500/50 shadow-2xs'
      }`}
    >
      {/* Top Row */}
      <div className="flex items-start gap-3">
        <div className="relative h-20 w-20 shrink-0 overflow-hidden rounded-xl border border-orange-500/25 bg-orange-500/10">
          {coverUrl ? (
            <Image
              loader={supabaseMediaImageLoader}
              unoptimized={false}
              src={coverUrl}
              alt={cleanTitle}
              fill
              sizes="80px"
              referrerPolicy="no-referrer"
              className="object-cover"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-orange-700 dark:text-orange-300">
              <UtensilsCrossed className="h-6 w-6" aria-hidden="true" />
            </div>
          )}
          <span
            aria-hidden="true"
            className="absolute bottom-1 right-1 inline-flex h-5 w-5 items-center justify-center rounded-md bg-orange-600 text-white shadow-xs"
          >
            <UtensilsCrossed className="h-3 w-3" />
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-1.5">
            <div className="flex flex-wrap items-center gap-1 min-w-0">
              <span
                className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[9.5px] font-extrabold ${
                  isKitchenOpen
                    ? 'bg-emerald-500/12 text-emerald-800 dark:text-emerald-300'
                    : 'bg-amber-500/15 text-amber-800 dark:text-amber-300'
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    isKitchenOpen
                      ? 'bg-emerald-500 animate-pulse'
                      : 'bg-amber-500'
                  }`}
                />
                {isKitchenOpen
                  ? `Open · ~${prepTimeMins}m`
                  : 'Kitchen Paused'}
              </span>

              {isPureVeg && (
                <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/40 bg-emerald-500/10 px-1.5 py-0.5 text-[9.5px] font-bold text-emerald-800 dark:text-emerald-300">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-600" />
                  Pure Veg
                </span>
              )}

              {fssaiVerified && (
                <span className="inline-flex items-center gap-0.5 rounded-md bg-orange-500/12 px-1.5 py-0.5 text-[9.5px] font-bold text-orange-800 dark:text-orange-300">
                  <ShieldCheck className="h-2.5 w-2.5" />
                  FSSAI ✓
                </span>
              )}

              {showOutsideViewportBadge && (
                <span className="rounded-md border border-amber-500/20 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-medium text-amber-700 dark:text-amber-300">
                  Outside View
                </span>
              )}
            </div>

            {Number(item.rating || 0) > 0 && (
              <span className="inline-flex items-center gap-0.5 rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[11px] font-bold text-amber-600 dark:text-amber-400 shrink-0">
                <Star className="h-3 w-3 fill-current" />
                {Number(item.rating).toFixed(1)}
              </span>
            )}
          </div>

          <h3 className="mt-1 line-clamp-1 text-sm font-bold tracking-tight text-[var(--ps-text)] group-hover:text-orange-700 dark:group-hover:text-orange-300 transition-colors">
            {cleanTitle}
          </h3>

          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[var(--ps-text-muted)]">
            <span className="inline-flex items-center gap-1 min-w-0">
              <MapPin className="h-3 w-3 shrink-0 text-orange-600 dark:text-orange-400" />
              <span className="truncate font-medium">{item.locality}</span>
            </span>
            {avgCost > 0 && (
              <>
                <span className="opacity-40">·</span>
                <span className="font-mono text-[10.5px] font-bold text-[var(--ps-text)]">
                  Avg ₹{avgCost} for 2
                </span>
              </>
            )}
          </div>

          {/* Cuisines + Delivery Ready */}
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[10px]">
            {cuisines.map((c) => (
              <span
                key={c}
                className="rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-1.5 py-0.5 font-semibold text-[var(--ps-text-muted)]"
              >
                {c}
              </span>
            ))}
            {allowDelivery && (
              <span className="inline-flex items-center gap-1 rounded-md border border-orange-500/30 bg-orange-500/10 px-1.5 py-0.5 font-bold text-orange-800 dark:text-orange-300">
                <Truck className="h-3 w-3" />
                Delivery Ready
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Consistent 44px+ Bottom Action Row */}
      <div
        onClick={(e) => e.stopPropagation()}
        className="flex items-center justify-between gap-1.5 pt-2.5 border-t border-[var(--ps-border)]/80"
      >
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={handleShare}
            aria-label={`Share ${cleanTitle}`}
            title="Share restaurant"
            data-testid={`share-restaurant-${item.id}`}
            className="inline-flex min-h-[44px] min-w-[44px] h-11 w-11 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)]/60 text-[var(--ps-text-muted)] hover:border-orange-500 hover:text-orange-600 transition-colors cursor-pointer"
          >
            <Share2 className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleSave();
              void toggleUnifiedSave('listing', item.id);
            }}
            aria-label={effectiveSaved ? 'Remove from saved' : 'Save restaurant'}
            title={effectiveSaved ? 'Saved' : 'Save'}
            className={`inline-flex min-h-[44px] min-w-[44px] h-11 w-11 items-center justify-center rounded-xl border transition-colors cursor-pointer ${
              effectiveSaved
                ? 'border-orange-500 bg-orange-500/10 text-orange-600 dark:text-orange-300'
                : 'border-[var(--ps-border)] bg-[var(--ps-surface-alt)]/60 text-[var(--ps-text-muted)] hover:border-orange-500 hover:text-[var(--ps-text)]'
            }`}
          >
            <Bookmark
              className={`h-4 w-4 ${effectiveSaved ? 'fill-current' : ''}`}
            />
          </button>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onCenterOnMap();
            }}
            aria-label={`Locate ${cleanTitle} on map`}
            title="Locate on Map"
            className="inline-flex min-h-[44px] min-w-[44px] h-11 w-11 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)]/60 text-[var(--ps-text-muted)] hover:border-orange-500 hover:text-[var(--ps-text)] transition-colors cursor-pointer"
          >
            <Crosshair className="h-4 w-4" />
          </button>
        </div>

        <Link
          href={`/listing/${encodeURIComponent(item.id)}`}
          data-testid={`restaurant-quick-cta-${item.id}`}
          className="inline-flex min-h-[44px] h-11 flex-1 items-center justify-center gap-1.5 rounded-xl bg-orange-600 px-3.5 text-xs font-bold text-white shadow-2xs transition hover:bg-orange-700 whitespace-nowrap"
        >
          <UtensilsCrossed className="h-4 w-4 shrink-0" />
          <span>{allowTableBooking ? 'Book Table' : 'Menu & Order'}</span>
        </Link>
      </div>
    </div>
  );
}

export default RestaurantMapCard;

