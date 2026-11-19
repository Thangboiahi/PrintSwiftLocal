import React from 'react';

export default function BulletinLoading() {
  return (
    <div
      data-testid="bulletin-loading-skeleton"
      className="mx-auto w-full max-w-6xl px-4 sm:px-6 py-5 sm:py-6 space-y-5"
    >
      {/* Header + Dense Search & Category Filter Skeleton */}
      <div className="space-y-3 border-b border-[var(--ps-border)] pb-4">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div className="space-y-2">
            <div className="h-6 w-64 max-w-full rounded-lg bg-slate-200 dark:bg-slate-800 animate-pulse" />
            <div className="h-4 w-80 max-w-full rounded bg-slate-200/80 dark:bg-slate-800/80 animate-pulse" />
          </div>
          <div className="h-9 w-full sm:w-72 rounded-xl bg-slate-200 dark:bg-slate-800 animate-pulse" />
        </div>

        <div className="flex items-center gap-1.5 overflow-hidden">
          {Array.from({ length: 6 }).map((_, idx) => (
            <div
              key={idx}
              className="h-8 w-24 rounded-xl bg-slate-200 dark:bg-slate-800 animate-pulse shrink-0"
            />
          ))}
        </div>
      </div>

      {/* Bulletin Cards Grid Skeleton */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {Array.from({ length: 4 }).map((_, idx) => (
          <div
            key={idx}
            className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3"
          >
            <div className="flex items-center justify-between gap-2">
              <div className="h-5 w-28 rounded-md bg-slate-200 dark:bg-slate-800 animate-pulse" />
              <div className="h-4 w-20 rounded bg-slate-200/80 dark:bg-slate-800/80 animate-pulse" />
            </div>
            <div className="h-5 w-5/6 rounded bg-slate-200 dark:bg-slate-800 animate-pulse" />
            <div className="space-y-1.5">
              <div className="h-3.5 w-full rounded bg-slate-200/80 dark:bg-slate-800/80 animate-pulse" />
              <div className="h-3.5 w-4/5 rounded bg-slate-200/80 dark:bg-slate-800/80 animate-pulse" />
            </div>
            <div className="pt-2 border-t border-[var(--ps-border)]/70 flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <div className="w-6 h-6 rounded-full bg-slate-200 dark:bg-slate-800 animate-pulse" />
                <div className="h-3.5 w-28 rounded bg-slate-200 dark:bg-slate-800 animate-pulse" />
              </div>
              <div className="h-3.5 w-20 rounded bg-slate-200/80 dark:bg-slate-800/80 animate-pulse" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
