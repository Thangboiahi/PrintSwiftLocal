import React from 'react';

export interface ListingCardSkeletonProps {
  compact?: boolean;
  className?: string;
}

/**
 * Minimalist Listing Card Skeleton that mimics the exact dimensions and
 * content hierarchy of the Discovery & Directory Listing Cards.
 */
export function ListingCardSkeleton({
  compact = false,
  className = '',
}: ListingCardSkeletonProps) {
  return (
    <div
      role="status"
      aria-label="Loading listing card"
      data-testid="skeleton-listing-card"
      className={`w-full max-w-[440px] mx-auto rounded-2xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-surface)] ${
        compact ? 'p-2.5 gap-2' : 'p-3.5 gap-3'
      } flex flex-col justify-between shadow-sm animate-pulse ${className}`}
    >
      <div className="flex items-stretch gap-3 sm:gap-3.5">
        {/* Aspect-Locked Thumbnail Placeholder */}
        <div
          className={`${
            compact
              ? 'w-20 h-20'
              : 'w-24 h-24 sm:w-[100px] sm:h-[100px]'
          } rounded-xl bg-[var(--ps-surface-alt)] border border-gray-200/70 dark:border-gray-800/70 shrink-0`}
        />

        {/* Editorial Content Hierarchy Placeholders */}
        <div className="flex-1 min-w-0 flex flex-col justify-between">
          <div>
            {/* Row 1: Unboxed Kicker + Quick Actions */}
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <div className="h-3 w-16 rounded bg-[var(--ps-surface-alt)]" />
                <div className="h-3 w-12 rounded bg-[var(--ps-surface-alt)] hidden sm:block" />
              </div>
              <div className="flex items-center gap-1 shrink-0">
                <div className="w-6 h-6 rounded-lg bg-[var(--ps-surface-alt)]" />
                <div className="w-6 h-6 rounded-lg bg-[var(--ps-surface-alt)]" />
              </div>
            </div>

            {/* Row 2: Primary Listing Title */}
            <div className="h-4 w-4/5 rounded-md bg-[var(--ps-surface-alt)] mt-2" />

            {/* Row 3: Locality & Rating Line */}
            <div className="flex items-center gap-1.5 mt-2">
              <div className="h-3 w-24 rounded bg-[var(--ps-surface-alt)]" />
              <div className="h-3 w-10 rounded bg-[var(--ps-surface-alt)]" />
            </div>
          </div>

          {/* Row 4: Price / Metric Strip + Owner Chip */}
          <div className="mt-2 pt-2 border-t border-gray-200/70 dark:border-gray-800/70 flex items-center justify-between gap-2">
            <div className="h-3.5 w-20 rounded bg-[var(--ps-surface-alt)]" />
            <div className="h-5 w-16 rounded-lg bg-[var(--ps-surface-alt)]" />
          </div>
        </div>
      </div>
      <span className="sr-only">Loading listing…</span>
    </div>
  );
}

export function ListingCardSkeletonGrid({
  count = 6,
  compact = false,
  className = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 items-start',
}: {
  count?: number;
  compact?: boolean;
  className?: string;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="loading-results-state"
      className={className}
    >
      {Array.from({ length: count }).map((_, idx) => (
        <ListingCardSkeleton key={idx} compact={compact} />
      ))}
    </div>
  );
}

/**
 * Profile Skeleton that mimics the exact layout of the Profile & Profile Edit views.
 */
export function ProfileSkeleton({ className = '' }: { className?: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading profile"
      data-testid="profile-skeleton"
      className={`rounded-2xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-surface)] p-6 shadow-sm space-y-6 animate-pulse ${className}`}
    >
      {/* Header & Avatar Row */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-4">
          <div className="h-20 w-20 rounded-2xl bg-[var(--ps-surface-alt)] border border-gray-200/70 dark:border-gray-800/70 shrink-0" />
          <div className="space-y-2.5">
            <div className="h-5 w-48 rounded-lg bg-[var(--ps-surface-alt)]" />
            <div className="h-3.5 w-64 rounded-md bg-[var(--ps-surface-alt)]" />
            <div className="h-9 w-56 rounded-xl bg-[var(--ps-surface-alt)]" />
          </div>
        </div>
        <div className="h-16 w-44 rounded-xl bg-[var(--ps-surface-alt)] shrink-0" />
      </div>

      {/* Form Fields / Details Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pt-4 border-t border-gray-200/70 dark:border-gray-800/70">
        <div className="space-y-2">
          <div className="h-3 w-24 rounded bg-[var(--ps-surface-alt)]" />
          <div className="h-10 w-full rounded-xl bg-[var(--ps-surface-alt)]" />
        </div>
        <div className="space-y-2">
          <div className="h-3 w-28 rounded bg-[var(--ps-surface-alt)]" />
          <div className="h-10 w-full rounded-xl bg-[var(--ps-surface-alt)]" />
        </div>
      </div>

      {/* Social Links Section Placeholder */}
      <div className="space-y-3 pt-4 border-t border-gray-200/70 dark:border-gray-800/70">
        <div className="h-3.5 w-36 rounded bg-[var(--ps-surface-alt)]" />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="h-10 rounded-xl bg-[var(--ps-surface-alt)]" />
          <div className="h-10 rounded-xl bg-[var(--ps-surface-alt)]" />
        </div>
      </div>
      <span className="sr-only">Loading profile…</span>
    </div>
  );
}

/**
 * Category Filter Pills Skeleton that mimics the horizontal category chip bar or grid.
 */
export function CategoryChipsSkeleton({
  count = 4,
  variant = 'row',
}: {
  count?: number;
  variant?: 'row' | 'grid';
}) {
  if (variant === 'grid') {
    return (
      <>
        {Array.from({ length: count }).map((_, idx) => (
          <div
            key={idx}
            data-testid="category-grid-skeleton"
            className="h-9 rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-surface-alt)] animate-pulse"
          />
        ))}
      </>
    );
  }

  return (
    <div
      data-testid="category-chips-loading"
      className="inline-flex items-center gap-1.5 shrink-0"
    >
      {Array.from({ length: count }).map((_, idx) => (
        <div
          key={idx}
          className="h-7 w-24 rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-surface-alt)] animate-pulse shrink-0"
        />
      ))}
    </div>
  );
}

/**
 * Review Section Skeleton that mimics community review cards.
 */
export function ReviewListSkeleton({ count = 2 }: { count?: number }) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="reviews-loading-state"
      className="space-y-3"
    >
      {Array.from({ length: count }).map((_, idx) => (
        <div
          key={idx}
          className="rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-surface)] p-4 space-y-2.5 shadow-sm animate-pulse"
        >
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="h-7 w-7 rounded-full bg-[var(--ps-surface-alt)]" />
              <div className="h-3.5 w-28 rounded bg-[var(--ps-surface-alt)]" />
            </div>
            <div className="h-3.5 w-16 rounded bg-[var(--ps-surface-alt)]" />
          </div>
          <div className="h-3 w-full rounded bg-[var(--ps-surface-alt)]" />
          <div className="h-3 w-3/4 rounded bg-[var(--ps-surface-alt)]" />
        </div>
      ))}
      <span className="sr-only">Loading community reviews…</span>
    </div>
  );
}

/**
 * Staff Delegation List Skeleton that mimics assigned team member rows.
 */
export function StaffDelegationSkeleton({ count = 2 }: { count?: number }) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="delegations-loading"
      className="space-y-2"
    >
      {Array.from({ length: count }).map((_, idx) => (
        <div
          key={idx}
          className="rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-surface)] p-3.5 flex items-center justify-between gap-3 shadow-sm animate-pulse"
        >
          <div className="space-y-1.5">
            <div className="h-3.5 w-36 rounded bg-[var(--ps-surface-alt)]" />
            <div className="h-3 w-48 rounded bg-[var(--ps-surface-alt)]" />
          </div>
          <div className="h-7 w-16 rounded-lg bg-[var(--ps-surface-alt)]" />
        </div>
      ))}
      <span className="sr-only">Loading assigned staff…</span>
    </div>
  );
}
