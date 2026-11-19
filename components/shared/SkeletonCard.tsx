import React from 'react';
import { ListingCardSkeleton } from '@/components/listings/ListingCardSkeleton';

export interface SkeletonCardProps {
  compact?: boolean;
  className?: string;
}

/**
 * Minimalist Listing Card Skeleton delegating to Phase 50-B ListingCardSkeleton.
 */
export function SkeletonCard({
  className = '',
}: SkeletonCardProps) {
  return <ListingCardSkeleton className={className} />;
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
        <ListingCardSkeleton key={idx} className={compact ? 'mb-2' : 'mb-4'} />
      ))}
    </div>
  );
}

export default SkeletonCard;

