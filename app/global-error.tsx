'use client';

import React, { useEffect } from 'react';
import { AlertTriangle, Compass, Home, RotateCcw } from 'lucide-react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[app/global-error.tsx] Root error caught:', error);
  }, [error]);

  return (
    <html lang="en">
      <body className="min-h-dvh bg-[#f8fafc] text-[#0f172a] dark:bg-[#090d16] dark:text-[#f8fafc] antialiased font-sans">
        <div
          role="alert"
          aria-live="assertive"
          data-testid="app-global-error-fallback"
          className="flex min-h-dvh w-full flex-col items-center justify-center px-4 py-12 text-center"
        >
          <div className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 p-6 shadow-sm">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-2xl border border-rose-500/30 bg-rose-500/10 text-rose-500">
              <AlertTriangle className="h-6 w-6" aria-hidden="true" />
            </div>
            <h1 className="text-lg font-bold tracking-tight">
              Something went wrong
            </h1>
            <p className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-400">
              {error?.message ||
                'An unexpected error occurred while rendering DD oodle. Reload or jump directly back to Home or Explore.'}
            </p>
            <div className="mt-6 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:justify-center">
              <button
                type="button"
                onClick={() => {
                  try {
                    reset();
                  } catch {
                    if (typeof window !== 'undefined') {
                      window.location.reload();
                    }
                  }
                }}
                data-testid="global-error-retry-btn"
                className="inline-flex min-h-[44px] flex-1 sm:flex-initial items-center justify-center gap-2 rounded-xl bg-[#1D7578] px-4 py-2.5 text-xs font-bold text-white shadow-xs transition hover:opacity-95 cursor-pointer"
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
                data-testid="global-error-home-btn"
                className="inline-flex min-h-[44px] flex-1 sm:flex-initial items-center justify-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-4 py-2.5 text-xs font-semibold transition hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
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
                data-testid="global-error-explore-btn"
                className="inline-flex min-h-[44px] flex-1 sm:flex-initial items-center justify-center gap-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-transparent px-4 py-2.5 text-xs font-semibold transition hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <Compass className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>Explore Map</span>
              </button>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
