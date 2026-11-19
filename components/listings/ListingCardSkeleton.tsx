import React from 'react';

export interface ListingCardSkeletonProps {
  className?: string;
}

/**
 * Phase 50-B: Reusable Listing Card Skeleton for feed loading states.
 */
export function ListingCardSkeleton({ className = '' }: ListingCardSkeletonProps) {
  return (
    <div
      role="status"
      aria-label="Loading listing card"
      data-testid="listing-card-skeleton"
      className={`w-full h-28 sm:h-32 rounded-xl bg-slate-200 dark:bg-slate-800 animate-pulse mb-4 flex gap-4 p-3 ${className}`.trim()}
    >
      {/* Thumbnail skeleton box */}
      <div className="w-20 sm:w-24 h-full rounded-lg bg-slate-300 dark:bg-slate-700 shrink-0" />

      {/* Title & metadata skeletal bars */}
      <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
        <div className="space-y-2">
          <div className="h-4 w-3/4 rounded-md bg-slate-300 dark:bg-slate-700" />
          <div className="h-3 w-1/2 rounded-md bg-slate-300 dark:bg-slate-700" />
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="h-3 w-1/3 rounded-md bg-slate-300 dark:bg-slate-700" />
          <div className="h-5 w-16 rounded-md bg-slate-300 dark:bg-slate-700" />
        </div>
      </div>
      <span className="sr-only">Loading listing card</span>
    </div>
  );
}

export default ListingCardSkeleton;
