import React from 'react';
import { Compass } from 'lucide-react';

export default function GlobalRouteLoading() {
  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading PrintSwift Local"
      data-testid="global-route-loading"
      className="min-h-dvh w-full bg-white dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col items-center justify-center p-6"
    >
      <div className="flex flex-col items-center justify-center text-center gap-4 animate-pulse">
        <div
          data-testid="global-loading-logo"
          className="h-16 w-16 rounded-2xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-sm flex items-center justify-center"
        >
          <Compass className="h-8 w-8" aria-hidden="true" />
        </div>
        <div className="space-y-2 flex flex-col items-center">
          <div className="h-4 w-32 rounded bg-slate-200 dark:bg-slate-800" />
          <div className="h-3 w-24 rounded bg-slate-100 dark:bg-slate-900" />
        </div>
      </div>
      <span className="sr-only">Loading route...</span>
    </div>
  );
}
