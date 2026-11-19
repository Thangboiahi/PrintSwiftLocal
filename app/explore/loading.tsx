import React from 'react';

export default function ExploreLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading map workspace"
      data-testid="explore-loading-skeleton"
      className="relative min-h-dvh h-dvh w-full overflow-hidden bg-slate-100 dark:bg-slate-900 animate-pulse flex flex-col"
    >
      {/* Floating Skeletal Navbar Header (h-14) */}
      <div
        data-testid="explore-skeleton-navbar"
        className="h-14 w-full px-4 flex items-center justify-between bg-white/90 dark:bg-slate-950/90 border-b border-slate-200 dark:border-slate-800 shrink-0"
      >
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-800" />
          <div className="h-5 w-28 rounded-lg bg-slate-200 dark:bg-slate-800" />
        </div>
        <div className="flex items-center gap-2">
          <div className="h-9 w-9 rounded-xl bg-slate-200 dark:bg-slate-800" />
          <div className="h-9 w-24 rounded-xl bg-slate-200 dark:bg-slate-800" />
        </div>
      </div>

      {/* Floating Skeletal Map Control Pills (h-10 w-32) */}
      <div className="p-3 flex items-center gap-2 overflow-hidden shrink-0">
        <div className="h-10 w-32 rounded-full bg-slate-200 dark:bg-slate-800 shrink-0" />
        <div className="h-10 w-32 rounded-full bg-slate-200 dark:bg-slate-800 shrink-0" />
        <div className="h-10 w-32 rounded-full bg-slate-200 dark:bg-slate-800 shrink-0" />
      </div>

      {/* Main Map Canvas Area */}
      <div className="relative flex-1 w-full">
        {/* Centered Floating Search Pill */}
        <div className="absolute top-3 left-1/2 -translate-x-1/2 h-10 w-32 rounded-full bg-white/80 dark:bg-slate-800/80 shadow-sm" />

        {/* Right Floating Toolbar Skeleton */}
        <div className="absolute right-4 top-16 flex flex-col gap-2 p-1.5 rounded-xl bg-white/80 dark:bg-slate-950/80 shadow-sm">
          <div className="w-9 h-9 rounded-lg bg-slate-200 dark:bg-slate-800" />
          <div className="w-9 h-9 rounded-lg bg-slate-200 dark:bg-slate-800" />
          <div className="w-9 h-9 rounded-lg bg-slate-200 dark:bg-slate-800" />
          <div className="w-9 h-9 rounded-lg bg-slate-200 dark:bg-slate-800" />
        </div>
      </div>

      <span className="sr-only">Loading map...</span>
    </div>
  );
}
