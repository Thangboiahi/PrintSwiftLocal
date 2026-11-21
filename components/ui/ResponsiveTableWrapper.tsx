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
      className={`flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between ${className}`}
      data-testid="workspace-table-toolbar"
    >
      {/* Search and Filters Cluster */}
      <div className="flex flex-1 flex-wrap items-center gap-2">
        {onSearchChange && (
          <div className="relative min-w-[200px] flex-1 sm:max-w-xs">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400 dark:text-slate-500" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={searchPlaceholder}
              aria-label={searchPlaceholder}
              className="h-8 w-full rounded-lg border border-slate-200 bg-white pl-8 pr-7 text-xs text-slate-900 placeholder:text-slate-400 focus:border-theme-primary focus:outline-none focus:ring-1 focus:ring-theme-primary dark:border-slate-800 dark:bg-slate-950 dark:text-slate-100"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => onSearchChange('')}
                aria-label="Clear search"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 inline-flex h-5 w-5 items-center justify-center rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        )}

        {/* Filter Pills / Modals / Selectors Slot */}
        {children}

        {/* Reset Filters Button */}
        {hasActiveFilters && onResetFilters && (
          <button
            type="button"
            onClick={onResetFilters}
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-dashed border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/60 px-2.5 text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <RotateCcw className="h-3 w-3" />
            <span>Reset Filters</span>
          </button>
        )}
      </div>

      {/* Count Badge & Actions */}
      <div className="flex flex-wrap items-center justify-between sm:justify-end gap-2">
        {showCount && (
          <span className="inline-flex items-center rounded-md bg-slate-100 dark:bg-slate-800 px-2 py-1 text-[11px] font-semibold text-slate-600 dark:text-slate-300 tabular-nums">
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

        {actions && <div className="flex items-center gap-1.5">{actions}</div>}
      </div>
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
      className={`w-full max-w-full min-w-0 rounded-xl border border-slate-200/80 bg-white shadow-xs overflow-hidden dark:border-slate-800 dark:bg-slate-900/60 ${wrapperClassName}`}
      data-testid="responsive-table-scroll-wrapper"
    >
      {/* Mobile Swipe Indicator (Visible only on mobile/tablet) */}
      {showSwipeHint && (
        <div className="md:hidden flex items-center justify-between px-3 py-1 text-[11px] font-medium text-slate-500 dark:text-slate-400 bg-slate-50/90 dark:bg-slate-950/70 border-b border-slate-200/70 dark:border-slate-800/70 select-none">
          <span className="flex items-center gap-1.5">
            <ArrowLeftRight className="h-3 w-3 text-theme-primary shrink-0 animate-pulse" />
            <span>{swipeHintLabel}</span>
          </span>
          <span className="text-[10px] text-slate-400 dark:text-slate-500">
            Horizontal scroll
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
