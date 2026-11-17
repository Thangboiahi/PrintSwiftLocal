import React from 'react';

export interface SkeletonCardProps {
  compact?: boolean;
  className?: string;
}

/**
 * Minimalist Listing Card Skeleton mimicking a standard listing card:
 * gray box for the image and two thin gray bars for title & subtitle.
 */
export function SkeletonCard({
  compact = false,
  className = '',
}: SkeletonCardProps) {
  return (
    <div
      role="status"
      aria-label="Loading listing card"
      data-testid="skeleton-listing-card"
      className={`w-full max-w-[440px] mx-auto rounded-2xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-slate-900 shadow-sm ${
        compact ? 'p-3' : 'p-4'
      } ${className}`}
    >
      <div className="flex items-center gap-3.5">
        <div
          className={`${
            compact ? 'w-20 h-20' : 'w-24 h-24'
          } shrink-0 animate-pulse bg-gray-200 dark:bg-slate-800 rounded-md`}
        />
        <div className="flex-1 min-w-0 space-y-2.5">
          <div className="h-4 w-3/4 animate-pulse bg-gray-200 dark:bg-slate-800 rounded-md" />
          <div className="h-3 w-1/2 animate-pulse bg-gray-200 dark:bg-slate-800 rounded-md" />
        </div>
      </div>
      <span className="sr-only">Loading listing card</span>
    </div>
  );
}

export function SkeletonCardList({
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
        <SkeletonCard key={idx} compact={compact} />
      ))}
    </div>
  );
}

export default SkeletonCard;
