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
      <div className="flex flex-col items-center justify-center text-center gap-4">
        <div
          data-testid="global-loading-logo"
          className="h-16 w-16 rounded-2xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-sm flex items-center justify-center animate-pulse"
        >
          <Compass className="h-8 w-8" aria-hidden="true" />
        </div>
        <div className="space-y-1">
          <p className="text-sm font-bold tracking-tight text-slate-900 dark:text-white">
            PrintSwift Local
          </p>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Churachandpur Directory
          </p>
        </div>
      </div>
    </div>
  );
}
