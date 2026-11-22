'use client';

import React from 'react';
import { ArrowLeftRight, RotateCcw, Search, X } from 'lucide-react';

// =============================================================================
// 1. WORKSPACE TABLE TOOLBAR
// =============================================================================
export interface WorkspaceTableToolbarProps {
  searchQuery?: string;
  onSearchChange?: (val: string) => void;
  searchPlaceholder?: string;
  filteredCount?: number;
  totalCount?: number;
  countLabel?: string;
  onResetFilters?: () => void;
  hasActiveFilters?: boolean;
  children?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}

export function WorkspaceTableToolbar({
  searchQuery = '',
  onSearchChange,
  searchPlaceholder = 'Search records…',
  filteredCount,
  totalCount,
  countLabel = 'records',
  onResetFilters,
  hasActiveFilters = false,
  children,
  actions,
  className = '',
}: WorkspaceTableToolbarProps) {
  const showCount = typeof filteredCount === 'number';

  return (
    <div
      className={`w-full max-w-full min-w-0 flex flex-col gap-2.5 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between ${className}`}
      data-testid="workspace-table-toolbar"
    >
      {/* Search and Filters Cluster */}
      <div className="w-full min-w-0 flex flex-col sm:flex-row sm:flex-1 sm:flex-wrap sm:items-center gap-2">
        {onSearchChange && (
          <div className="relative w-full min-w-0 sm:flex-1 sm:min-w-[200px] sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ps-text-muted)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="h-8 w-full min-w-0 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] pl-8 pr-7 text-xs text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:border-[var(--ps-accent)] focus:outline-none focus:ring-1 focus:ring-[var(--ps-accent)]"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => onSearchChange('')}
                aria-label="Clear search"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex h-5 w-5 items-center justify-center rounded-md text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        )}

        {/* Filter Pills / Modals / Selectors Slot (scroll-safe on 360px portrait) */}
        {children && (
          <div className="w-full sm:w-auto max-w-full min-w-0 flex items-center flex-wrap sm:flex-nowrap gap-1.5">
            {children}
          </div>
        )}

        {/* Reset Filters Button */}
        {hasActiveFilters && onResetFilters && (
          <button
            type="button"
            onClick={onResetFilters}
            className="inline-flex h-8 shrink-0 items-center gap-1 rounded-lg border border-dashed border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-2.5 text-[11px] font-semibold text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] transition-colors cursor-pointer"
          >
            <RotateCcw className="h-3 w-3" />
            <span>Reset Filters</span>
          </button>
        )}
      </div>

      {/* Count Badge & Actions */}
      <div className="w-full sm:w-auto min-w-0 flex flex-wrap items-center justify-between sm:justify-end gap-2">
        {showCount && (
          <span className="inline-flex items-center rounded-md bg-[var(--ps-surface-alt)] px-2 py-1 text-[11px] font-semibold text-[var(--ps-text-muted)] tabular-nums shrink-0">
            {typeof totalCount === 'number' && filteredCount !== totalCount ? (
              <span>
                Showing {filteredCount} of {totalCount} {countLabel}
              </span>
            ) : (
              <span>
                {filteredCount} {countLabel}
              </span>
            )}
          </span>
        )}

        {actions && (
          <div className="grid grid-cols-2 sm:flex sm:flex-wrap items-center gap-1.5 w-full sm:w-auto min-w-0">
            {actions}
          </div>
        )}
      </div>
    </div>
  );
}

export function WorkspaceFilterPillRail({
  children,
  className = '',
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={`w-full sm:w-auto max-w-full overflow-x-auto flex items-center flex-nowrap gap-1.5 no-scrollbar pb-0.5 ${className}`}
    >
      {children}
    </div>
  );
}

// =============================================================================
// 2. RESPONSIVE TABLE SCROLL WRAPPER
// =============================================================================
export interface ResponsiveTableScrollProps {
  children: React.ReactNode;
  minWidthClass?: string;
  showSwipeHint?: boolean;
  swipeHintLabel?: string;
  className?: string;
  wrapperClassName?: string;
}

export function ResponsiveTableScroll({
  children,
  minWidthClass = 'min-w-[640px]',
  showSwipeHint = true,
  swipeHintLabel = 'Swipe ↔ to view all columns',
  className = '',
  wrapperClassName = '',
}: ResponsiveTableScrollProps) {
  return (
    <div
      className={`w-full max-w-full min-w-0 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] shadow-xs overflow-hidden ${wrapperClassName}`}
      data-testid="responsive-table-scroll-wrapper"
    >
      {/* Mobile Swipe Indicator (Visible only on mobile/tablet) */}
      {showSwipeHint && (
        <div className="md:hidden flex items-center justify-between px-3 py-1 text-[11px] font-medium text-[var(--ps-text-muted)] bg-[var(--ps-bg)] border-b border-[var(--ps-border)] select-none">
          <span className="flex items-center gap-1.5">
            <ArrowLeftRight className="h-3 w-3 text-theme-primary shrink-0" />
            <span>{swipeHintLabel}</span>
          </span>
          <span className="text-[10px] text-[var(--ps-text-muted)] shrink-0">
            Swipe →
          </span>
        </div>
      )}

      {/* Inner Scroll Container with Smooth Touch Momentum */}
      <div
        className={`w-full max-w-full overflow-x-auto overscroll-x-contain [-webkit-overflow-scrolling:touch] custom-scrollbar ${className}`}
      >
        <div className={`w-full ${minWidthClass}`}>{children}</div>
      </div>
    </div>
  );
}

export default ResponsiveTableScroll;
