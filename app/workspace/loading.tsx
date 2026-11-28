'use client';

import React, { useEffect, useState } from 'react';
import { Compass, Home, RotateCcw } from 'lucide-react';

export default function WorkspaceRouteLoading() {
  const [showRecovery, setShowRecovery] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      setShowRecovery(true);
    }, 5000);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading workspace"
      data-testid="workspace-route-skeleton"
      className="mx-auto w-full max-w-7xl px-4 py-6 space-y-5 bg-[var(--ps-bg)] text-[var(--ps-text)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="dd-shimmer h-10 w-56 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)]" />
        <div className="flex items-center gap-2">
          <div className="dd-shimmer h-10 w-28 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)]" />
          <div className="dd-shimmer h-10 w-28 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)]" />
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
        <div className="hidden lg:block lg:col-span-3 space-y-2.5">
          <div className="dd-shimmer h-11 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)]" />
          <div className="dd-shimmer h-11 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)]" />
          <div className="dd-shimmer h-11 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)]" />
          <div className="dd-shimmer h-11 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)]" />
        </div>
        <div className="lg:col-span-9 space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            <div className="dd-shimmer h-24 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)]" />
            <div className="dd-shimmer h-24 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)]" />
            <div className="dd-shimmer h-24 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] hidden sm:block" />
          </div>
          <div className="dd-shimmer h-64 w-full rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)]" />
        </div>
      </div>

      {showRecovery && (
        <div
          data-testid="workspace-loading-recovery"
          className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 flex flex-col sm:flex-row items-center justify-between gap-3"
        >
          <p className="text-xs font-medium text-[var(--ps-text-muted)]">
            Workspace is taking longer than expected to load.
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-4 text-xs font-bold text-[var(--ps-accent-fg)] cursor-pointer"
            >
              <RotateCcw className="h-4 w-4" aria-hidden="true" />
              <span>Retry</span>
            </button>
            <button
              type="button"
              onClick={() => window.location.assign('/')}
              className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-4 text-xs font-semibold text-[var(--ps-text)] cursor-pointer"
            >
              <Home className="h-4 w-4" aria-hidden="true" />
              <span>Go to Home</span>
            </button>
            <button
              type="button"
              onClick={() => window.location.assign('/explore')}
              className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-4 text-xs font-semibold text-[var(--ps-text)] cursor-pointer"
            >
              <Compass className="h-4 w-4" aria-hidden="true" />
              <span>Explore Map</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
