import React from 'react';
import { SkeletonCard } from '@/components/shared/SkeletonCard';

export default function GlobalRouteLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading PrintSwift Local"
      data-testid="global-route-loading"
      className="min-h-dvh bg-[var(--ps-bg)] text-[var(--ps-text)] flex flex-col"
    >
      {/* Header Skeleton */}
      <div className="h-14 border-b border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 sm:px-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 animate-pulse">
          <div className="w-9 h-9 rounded-xl bg-[var(--ps-surface-alt)]" />
          <div className="space-y-1.5">
            <div className="h-4 w-32 rounded-md bg-[var(--ps-surface-alt)]" />
            <div className="h-2.5 w-24 rounded-md bg-[var(--ps-surface-alt)]" />
          </div>
        </div>
        <div className="flex items-center gap-2 animate-pulse">
          <div className="h-9 w-24 rounded-xl bg-[var(--ps-surface-alt)]" />
          <div className="h-9 w-9 rounded-xl bg-[var(--ps-surface-alt)]" />
        </div>
      </div>

      {/* Main Content Grid of SkeletonCards */}
      <main className="flex-1 max-w-6xl w-full mx-auto px-3 sm:px-6 py-6 space-y-5">
        <div className="flex items-center justify-between gap-3 animate-pulse">
          <div className="space-y-2">
            <div className="h-5 w-48 rounded-lg bg-[var(--ps-surface-alt)]" />
            <div className="h-3.5 w-64 rounded-md bg-[var(--ps-surface-alt)]" />
          </div>
          <div className="h-9 w-28 rounded-xl bg-[var(--ps-surface-alt)]" />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5 items-start">
          {Array.from({ length: 6 }).map((_, index) => (
            <SkeletonCard key={index} />
          ))}
        </div>
      </main>
    </div>
  );
}
