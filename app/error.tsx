'use client';

import React, { useEffect } from 'react';
import { AlertTriangle, Compass, Home, RotateCcw } from 'lucide-react';

export default function AppRouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[app/error.tsx] Route error caught:', error);
  }, [error]);

  return (
    <div
      role="alert"
      aria-live="assertive"
      data-testid="app-route-error-fallback"
      className="flex min-h-[70dvh] w-full flex-col items-center justify-center bg-[var(--ps-bg)] px-4 py-12 text-center text-[var(--ps-text)]"
    >
      <div className="w-full max-w-md rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-rose-500/30 bg-rose-500/10 text-rose-500">
          <AlertTriangle className="h-6 w-6" aria-hidden="true" />
        </div>
        <h1 className="text-lg font-bold tracking-tight text-[var(--ps-text)]">
          We couldn&apos;t load this page
        </h1>
        <p className="mt-2 text-xs leading-relaxed text-[var(--ps-text-muted)]">
          {error?.message ||
            'An unexpected error interrupted this view. Try again or return to Home or Explore.'}
        </p>
        <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:justify-center">
          <button
            type="button"
            onClick={() => reset()}
            data-testid="route-error-retry-btn"
            className="inline-flex min-h-[44px] flex-1 sm:flex-initial items-center justify-center gap-2 rounded-xl bg-[var(--ps-accent)] px-4 py-2.5 text-xs font-bold text-[var(--ps-accent-fg)] shadow-xs transition hover:opacity-95 cursor-pointer"
          >
            <RotateCcw className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Try Again</span>
          </button>
          <button
            type="button"
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.location.assign('/');
              }
            }}
            data-testid="route-error-home-btn"
            className="inline-flex min-h-[44px] flex-1 sm:flex-initial items-center justify-center gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-4 py-2.5 text-xs font-semibold text-[var(--ps-text)] transition hover:bg-[var(--ps-surface-alt)] cursor-pointer"
          >
            <Home className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Go to Home</span>
          </button>
          <button
            type="button"
            onClick={() => {
              if (typeof window !== 'undefined') {
                window.location.assign('/explore');
              }
            }}
            data-testid="route-error-explore-btn"
            className="inline-flex min-h-[44px] flex-1 sm:flex-initial items-center justify-center gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-4 py-2.5 text-xs font-semibold text-[var(--ps-text)] transition hover:bg-[var(--ps-surface-alt)] cursor-pointer"
          >
            <Compass className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span>Explore Map</span>
          </button>
        </div>
      </div>
    </div>
  );
}
