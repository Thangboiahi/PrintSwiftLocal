import React from 'react';
import { Compass } from 'lucide-react';
import { ListingCardSkeletonGrid } from '@/components/shared/Skeletons';

export default function GlobalRouteLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading PrintSwift Local"
      data-testid="global-route-loading"
      className="min-h-dvh bg-[var(--ps-bg)] text-[var(--ps-text)] flex flex-col"
    >
      {/* Minimalist Header Skeleton */}
      <div className="h-14 border-b border-gray-200 dark:border-gray-800 bg-[var(--ps-surface)] px-4 sm:px-6 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] flex items-center justify-center shadow-sm animate-pulse">
            <Compass className="w-4 h-4" />
          </div>
          <div className="space-y-1.5 animate-pulse">
            <div className="h-3.5 w-24 rounded bg-[var(--ps-surface-alt)]" />
            <div className="h-2.5 w-20 rounded bg-[var(--ps-surface-alt)]" />
          </div>
        </div>
        <div className="flex items-center gap-2 animate-pulse">
          <div className="h-8 w-24 rounded-xl bg-[var(--ps-surface-alt)]" />
          <div className="h-8 w-8 rounded-xl bg-[var(--ps-surface-alt)]" />
        </div>
      </div>

      {/* Centered Pulsing Breathing PrintSwift Logo Indicator + Structured Skeletons */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-4 sm:px-6 py-8 space-y-8">
        <div className="flex flex-col items-center justify-center text-center py-4">
          <div className="relative flex items-center justify-center">
            <span className="absolute h-16 w-16 rounded-2xl bg-[var(--ps-accent)]/10 animate-ping" />
            <div className="relative flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-sm animate-pulse">
              <Compass className="h-6 w-6" />
            </div>
          </div>
          <p className="mt-3 text-xs font-semibold tracking-tight text-[var(--ps-text)]">
            PrintSwift Local
          </p>
          <p className="text-[11px] text-[var(--ps-text-muted)]">
            Churachandpur Directory &amp; Geospatial Platform
          </p>
        </div>

        <ListingCardSkeletonGrid
          count={6}
          className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 items-start"
        />
      </main>
    </div>
  );
}
