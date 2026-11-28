'use client';

import React from 'react';
import dynamic from 'next/dynamic';
import type { ListingLocationMapProps } from '@/components/maps/ListingLocationMap';

const LazyListingLocationMap = dynamic<ListingLocationMapProps>(
  () =>
    import('@/components/maps/ListingLocationMap').then((mod) => ({
      default: mod.ListingLocationMap,
    })),
  {
    ssr: false,
    loading: () => (
      <div
        data-testid="listing-location-map-skeleton"
        className="overflow-hidden rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] shadow-xs"
      >
        <div className="flex items-center justify-between gap-2 border-b border-[var(--ps-border)] px-3.5 py-2.5">
          <div className="flex items-center gap-2.5">
            <div className="dd-shimmer h-8 w-8 rounded-xl bg-[var(--ps-surface-alt)]" />
            <div className="space-y-1.5">
              <div className="dd-shimmer h-3 w-28 rounded bg-[var(--ps-surface-alt)]" />
              <div className="dd-shimmer h-2.5 w-36 rounded bg-[var(--ps-surface-alt)]" />
            </div>
          </div>
          <div className="dd-shimmer h-5 w-20 rounded-lg bg-[var(--ps-surface-alt)]" />
        </div>
        <div className="dd-shimmer h-44 w-full bg-[var(--ps-surface-alt)]" />
        <div className="flex items-center justify-between gap-2 border-t border-[var(--ps-border)] px-3.5 py-2.5">
          <div className="dd-shimmer h-3.5 w-28 rounded bg-[var(--ps-surface-alt)]" />
          <div className="dd-shimmer h-11 w-28 rounded-xl bg-[var(--ps-surface-alt)]" />
        </div>
      </div>
    ),
  }
);

export function DynamicListingLocationMap(props: ListingLocationMapProps) {
  return <LazyListingLocationMap {...props} />;
}

export default DynamicListingLocationMap;
