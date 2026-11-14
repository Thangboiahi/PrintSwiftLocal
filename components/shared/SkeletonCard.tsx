import React from 'react';

export interface SkeletonCardProps {
  compact?: boolean;
  className?: string;
}

export function SkeletonCard({
  compact = false,
  className = '',
}: SkeletonCardProps) {
  return (
    <div
      role="status"
      aria-label="Loading listing card"
      data-testid="skeleton-listing-card"
      className={`w-full max-w-[440px] mx-auto rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] ${
        compact ? 'p-2.5 gap-2' : 'p-3 gap-2.5'
      } flex flex-col justify-between shadow-2xs animate-pulse ${className}`}
    >
      <div className="flex items-stretch gap-2.5 sm:gap-3">
        {/* Thumbnail Image Placeholder */}
        <div
          className={`${
            compact
              ? 'w-20 h-20'
              : 'w-[88px] h-[88px] sm:w-[92px] sm:h-[92px]'
          } rounded-xl bg-[var(--ps-surface-alt)] border border-[var(--ps-border)]/60 shrink-0`}
        />

        {/* Card Content Hierarchy Placeholders */}
        <div className="flex-1 min-w-0 flex flex-col justify-between">
          <div>
            {/* Row 1: Category Badge + Quick Action Controls */}
            <div className="flex items-center justify-between gap-1.5">
              <div className="h-4 w-20 rounded-md bg-[var(--ps-surface-alt)]" />
              <div className="flex items-center gap-1 shrink-0">
                <div className="w-6 h-6 rounded-lg bg-[var(--ps-surface-alt)]" />
                <div className="w-6 h-6 rounded-lg bg-[var(--ps-surface-alt)]" />
              </div>
            </div>

            {/* Row 2: Primary Listing Title Block */}
            <div className="h-4 w-4/5 rounded-md bg-[var(--ps-surface-alt)] mt-2" />

            {/* Row 3: Locality & Rating Metadata Line */}
            <div className="flex items-center gap-1.5 mt-1.5">
              <div className="h-3 w-24 rounded-md bg-[var(--ps-surface-alt)]" />
              <div className="h-3 w-10 rounded-md bg-[var(--ps-surface-alt)]" />
            </div>
          </div>

          {/* Row 4: Supporting Price / Area / Catalogue Summary Line */}
          <div className="mt-1.5 pt-1.5 border-t border-[var(--ps-border)]/70 flex items-center justify-between gap-2">
            <div className="h-3.5 w-20 rounded-md bg-[var(--ps-surface-alt)]" />
            <div className="h-3 w-16 rounded-md bg-[var(--ps-surface-alt)]" />
          </div>
        </div>
      </div>
      <span className="sr-only">Loading listing…</span>
    </div>
  );
}

export function SkeletonCardList({
  count = 4,
  compact = false,
  className = '',
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
