'use client';

import React from 'react';
import { AlertCircle, Loader2, RotateCcw, SearchX } from 'lucide-react';

export interface LoadingStateProps {
  title?: string;
  description?: string;
  compact?: boolean;
  className?: string;
  dataTestId?: string;
}

export function LoadingState({
  title = 'Loading directory listings…',
  description = 'Synchronizing map viewport and local records.',
  compact = false,
  className = '',
  dataTestId = 'loading-results-state',
}: LoadingStateProps) {
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid={dataTestId}
      className={`rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-center flex flex-col items-center justify-center ${
        compact ? 'p-5 space-y-2' : 'p-8 sm:p-10 space-y-3'
      } ${className}`}
    >
      <div className="w-10 h-10 rounded-xl bg-[var(--ps-surface-alt)] border border-[var(--ps-border)] flex items-center justify-center text-[var(--ps-accent)]">
        <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
      </div>
      <div className="space-y-1 max-w-md">
        <p
          className={`${
            compact ? 'text-xs' : 'text-xs sm:text-sm'
          } font-bold text-[var(--ps-text)]`}
        >
          {title}
        </p>
        {description && (
          <p className="text-xs text-[var(--ps-text-muted)] leading-relaxed">
            {description}
          </p>
        )}
      </div>
    </div>
  );
}

export interface EmptyStateProps {
  title?: string;
  description?: string;
  compact?: boolean;
  className?: string;
  dataTestId?: string;
  actions?: React.ReactNode;
  onResetFilters?: () => void;
  resetLabel?: string;
}

export function EmptyState({
  title = 'No listings found in this area. Try zooming out or clearing your filters.',
  description,
  compact = false,
  className = '',
  dataTestId = 'empty-results-state',
  actions,
  onResetFilters,
  resetLabel = 'Reset All Filters',
}: EmptyStateProps) {
  return (
    <div
      data-testid={dataTestId}
      className={`rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-center flex flex-col items-center justify-center ${
        compact ? 'p-5 space-y-2.5' : 'p-6 sm:p-10 space-y-3'
      } ${className}`}
    >
      <div className="w-10 h-10 rounded-xl bg-[var(--ps-surface-alt)] border border-[var(--ps-border)] flex items-center justify-center text-[var(--ps-text-muted)]">
        <SearchX className="w-5 h-5" aria-hidden="true" />
      </div>
      <div className="space-y-1 max-w-md">
        <p
          className={`${
            compact ? 'text-xs' : 'text-xs sm:text-sm'
          } font-bold text-[var(--ps-text)]`}
        >
          {title}
        </p>
        {description && (
          <p className="text-xs text-[var(--ps-text-muted)] leading-relaxed">
            {description}
          </p>
        )}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center justify-center gap-2 pt-0.5">
          {actions}
        </div>
      ) : onResetFilters ? (
        <div className="flex flex-wrap items-center justify-center gap-2 pt-0.5">
          <button
            type="button"
            onClick={onResetFilters}
            data-testid="empty-state-reset-filters-btn"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[40px] rounded-xl text-xs font-semibold bg-[var(--ps-surface-alt)] border border-[var(--ps-border)] text-[var(--ps-text)] hover:border-[var(--ps-accent)]/60 transition-colors"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{resetLabel}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}

export interface ErrorStateProps {
  title?: string;
  description?: string;
  retry?: () => void;
  onRetry?: () => void;
  retryLabel?: string;
  compact?: boolean;
  className?: string;
  dataTestId?: string;
}

export function ErrorState({
  title = 'Unable to load listings right now.',
  description = 'Please check your connection or retry refreshing the local directory view.',
  retry,
  onRetry,
  retryLabel = 'Try Again',
  compact = false,
  className = '',
  dataTestId = 'error-results-state',
}: ErrorStateProps) {
  const handleRetry = retry || onRetry;
  return (
    <div
      role="status"
      aria-live="polite"
      data-testid={dataTestId}
      className={`rounded-2xl border border-rose-500/30 bg-rose-500/5 text-center flex flex-col items-center justify-center ${
        compact ? 'p-5 space-y-2.5' : 'p-6 sm:p-10 space-y-3'
      } ${className}`}
    >
      <div className="w-10 h-10 rounded-xl bg-rose-500/10 border border-rose-500/30 flex items-center justify-center text-rose-600 dark:text-rose-400">
        <AlertCircle className="w-5 h-5" aria-hidden="true" />
      </div>
      <div className="space-y-1 max-w-md">
        <p
          className={`${
            compact ? 'text-xs' : 'text-xs sm:text-sm'
          } font-bold text-[var(--ps-text)]`}
        >
          {title}
        </p>
        {description && (
          <p className="text-xs text-[var(--ps-text-muted)] leading-relaxed">
            {description}
          </p>
        )}
      </div>
      {handleRetry && (
        <div className="pt-0.5">
          <button
            type="button"
            onClick={handleRetry}
            data-testid="error-state-retry-btn"
            className="inline-flex items-center gap-1.5 px-3.5 py-2 min-h-[40px] rounded-xl text-xs font-semibold bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] hover:opacity-95 transition-opacity"
          >
            <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
            <span>{retryLabel}</span>
          </button>
        </div>
      )}
    </div>
  );
}
