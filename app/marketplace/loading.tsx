import React from 'react';

export default function MarketplaceLoading() {
  return (
    <div
      data-testid="marketplace-loading-skeleton"
      className="mx-auto w-full max-w-7xl px-4 sm:px-6 py-5 sm:py-6 space-y-5"
    >
      {/* Header & Compact Search Bar Skeleton */}
      <div className="space-y-3 border-b border-[var(--ps-border)] pb-4">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div className="space-y-2">
            <div className="h-6 w-48 rounded-lg bg-slate-200 dark:bg-slate-800 animate-pulse" />
            <div className="h-3.5 w-72 max-w-full rounded bg-slate-200/80 dark:bg-slate-800/80 animate-pulse" />
          </div>
          <div className="h-9 w-full sm:w-72 rounded-xl bg-slate-200 dark:bg-slate-800 animate-pulse" />
        </div>

        {/* Horizontal Category Filter Pills Skeleton */}
        <div className="flex items-center gap-2 overflow-hidden">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div
              key={idx}
              className="h-8 w-24 shrink-0 rounded-full bg-slate-200 dark:bg-slate-800 animate-pulse"
            />
          ))}
        </div>
      </div>

      {/* Responsive Product Card Skeleton Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, idx) => (
          <div
            key={idx}
            className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] overflow-hidden flex flex-col"
          >
            <div className="aspect-[4/3] w-full bg-slate-200 dark:bg-slate-800 animate-pulse" />
            <div className="p-3.5 space-y-2.5 flex-1 flex flex-col justify-between">
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <div className="h-3 w-24 rounded bg-slate-200 dark:bg-slate-800 animate-pulse" />
                  <div className="h-3 w-14 rounded bg-slate-200 dark:bg-slate-800 animate-pulse" />
                </div>
                <div className="h-4 w-4/5 rounded bg-slate-200 dark:bg-slate-800 animate-pulse" />
                <div className="h-5 w-24 rounded bg-slate-200 dark:bg-slate-800 animate-pulse" />
                <div className="h-3 w-3/5 rounded bg-slate-200/80 dark:bg-slate-800/80 animate-pulse" />
              </div>
              <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[var(--ps-border)]/70">
                <div className="h-8 rounded-lg bg-slate-200 dark:bg-slate-800 animate-pulse" />
                <div className="h-8 rounded-lg bg-slate-200 dark:bg-slate-800 animate-pulse" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
