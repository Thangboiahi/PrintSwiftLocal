'use client';

import React, { useMemo, useState } from 'react';
import {
  ArrowUpDown,
  Briefcase,
  Building2,
  Check,
  ChevronDown,
  ChevronUp,
  Filter,
  Landmark,
  List,
  Loader2,
  Map as MapIcon,
  Store,
  Trophy,
  X,
} from 'lucide-react';
import {
  CATEGORY_LABELS,
  PROPERTY_TYPE_LABELS,
} from '@/lib/rules';
import {
  PRICE_RANGE_LABELS,
  PriceRangeFilterOption,
} from './FilterDrawerModal';
import {
  DiscoverySortOption,
  DrawnShape,
  ListingCategory,
  PropertyType,
} from '@/lib/types';

export const FILTER_BAR_SORT_OPTIONS: Array<{
  id: DiscoverySortOption;
  label: string;
  shortLabel: string;
  description: string;
}> = [
  {
    id: 'relevance',
    label: 'Relevance',
    shortLabel: 'Relevance',
    description: 'Featured sample listings & highest community relevance',
  },
  {
    id: 'distance',
    label: 'Nearest Distance',
    shortLabel: 'Distance',
    description: 'Closest to current Churachandpur map centre',
  },
  {
    id: 'rating',
    label: 'Highest Rating',
    shortLabel: 'Top Rated',
    description: 'Ordered by star rating and review count',
  },
  {
    id: 'updated',
    label: 'Recently Updated',
    shortLabel: 'Updated',
    description: 'Newest directory modifications first',
  },
  {
    id: 'price_asc',
    label: 'Price: Low to High',
    shortLabel: 'Price ↑',
    description: 'Lowest sample price or starting rate first',
  },
  {
    id: 'price_desc',
    label: 'Price: High to Low',
    shortLabel: 'Price ↓',
    description: 'Highest sample property or item price first',
  },
];

function CategoryPillIcon({
  category,
  className = 'w-3.5 h-3.5',
}: {
  category: ListingCategory | string;
  className?: string;
}) {
  const normalized = String(category).replace(/-/g, '_');
  switch (normalized) {
    case 'real_estate':
      return <Building2 className={className} aria-hidden="true" />;
    case 'business':
      return <Store className={className} aria-hidden="true" />;
    case 'service':
      return <Briefcase className={className} aria-hidden="true" />;
    case 'sports':
      return <Trophy className={className} aria-hidden="true" />;
    case 'public_place':
    default:
      return <Landmark className={className} aria-hidden="true" />;
  }
}

export interface CategoryFilterItem {
  cat: {
    id: string;
    name: string;
    slug?: string | null;
    type?: string | null;
  };
  catKey: ListingCategory;
  catLabel: string;
  count: number;
}

export interface FilterBarProps {
  isDiscoveryCollapsed: boolean;
  isMobileLandscape: boolean;
  isCategoriesLoading: boolean;
  totalListingsCount: number;
  categories: CategoryFilterItem[];
  selectedCategory: ListingCategory | 'all';
  onSelectCategory: (cat: ListingCategory | 'all') => void;
  discoveryMode: 'map' | 'list';
  onSelectDiscoveryMode: (mode: 'map' | 'list') => void;
  onOpenFilterModal: () => void;
  sortBy: DiscoverySortOption;
  onSelectSortBy: (sort: DiscoverySortOption) => void;
  isSortPopoverOpen: boolean;
  onToggleSortPopover: () => void;
  onCloseSortPopover: () => void;
  selectedLocality: string;
  onClearLocality: () => void;
  selectedPropertyType: PropertyType | 'all';
  onClearPropertyType: () => void;
  minRating: number;
  onClearMinRating: () => void;
  priceRangeFilter: PriceRangeFilterOption;
  onClearPriceRange: () => void;
  verifiedOnly: boolean;
  onClearVerifiedOnly: () => void;
  has360Only: boolean;
  onClearHas360Only: () => void;
  hasCatalogueOnly: boolean;
  onClearHasCatalogueOnly: () => void;
  activeFilterShape: DrawnShape | null;
  onClearSpatialFilterShape: () => void;
  activeFilterCount: number;
  onResetAllFilters: () => void;
}

export function FilterBar({
  isDiscoveryCollapsed,
  isMobileLandscape,
  isCategoriesLoading,
  totalListingsCount,
  categories,
  selectedCategory,
  onSelectCategory,
  discoveryMode,
  onSelectDiscoveryMode,
  onOpenFilterModal,
  sortBy,
  onSelectSortBy,
  isSortPopoverOpen,
  onToggleSortPopover,
  onCloseSortPopover,
  selectedLocality,
  onClearLocality,
  selectedPropertyType,
  onClearPropertyType,
  minRating,
  onClearMinRating,
  priceRangeFilter,
  onClearPriceRange,
  verifiedOnly,
  onClearVerifiedOnly,
  has360Only,
  onClearHas360Only,
  hasCatalogueOnly,
  onClearHasCatalogueOnly,
  activeFilterShape,
  onClearSpatialFilterShape,
  activeFilterCount,
  onResetAllFilters,
}: FilterBarProps) {
  const [isCategoryRowWrapped, setIsCategoryRowWrapped] = useState(false);
  const [isActiveFiltersWrapped, setIsActiveFiltersWrapped] = useState(false);

  // Ensure categories are strictly sorted in descending order by quantity
  const sortedCategories = useMemo(
    () => [...categories].sort((a, b) => b.count - a.count),
    [categories]
  );

  const activeSortOption = useMemo(
    () =>
      FILTER_BAR_SORT_OPTIONS.find((opt) => opt.id === sortBy) ||
      FILTER_BAR_SORT_OPTIONS[0],
    [sortBy]
  );

  const hasActiveFilterChips =
    selectedLocality !== 'all' ||
    selectedPropertyType !== 'all' ||
    minRating > 0 ||
    priceRangeFilter !== 'all' ||
    verifiedOnly ||
    has360Only ||
    hasCatalogueOnly ||
    Boolean(activeFilterShape);

  return (
    <div className="space-y-1">
      {/* ===============================================================
          PHASE 39: SPLIT FIXED MAP/LIST TOGGLE + SCROLLABLE CATEGORY PILLS ROW
          Map/List toggle buttons are wrapped in a `shrink-0` fixed-width
          container pinned to the left; Category pills sit in an adjacent
          `flex-1 overflow-x-auto hide-scrollbar` container so swiping
          categories never hides the Map/List toggles.
         =============================================================== */}
      {!isDiscoveryCollapsed && (
        <div className="relative pr-8 flex items-start gap-1.5 min-w-0">
          {/* Pinned Left Container: Map / List Segmented Toggle (`shrink-0`) */}
          <div
            data-testid="filter-bar-pinned-mode-toggle"
            className="shrink-0 flex items-center py-0.5"
          >
            <div
              className={`inline-flex items-center ${
                isMobileLandscape ? 'h-7' : 'h-7'
              } p-0.5 rounded-lg bg-[var(--ps-bg)] border border-[var(--ps-border)]/80 shrink-0`}
              role="group"
              aria-label="Discovery view mode"
            >
              <button
                type="button"
                onClick={() => onSelectDiscoveryMode('map')}
                aria-pressed={discoveryMode === 'map'}
                aria-label="Map View"
                title="Map View"
                data-testid="mode-map-btn"
                className={`h-6 px-2 rounded-md inline-flex items-center justify-center gap-1 text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  discoveryMode === 'map'
                    ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-2xs'
                    : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                }`}
              >
                <MapIcon className="w-3.5 h-3.5 shrink-0" />
                <span>Map</span>
              </button>
              <button
                type="button"
                onClick={() => onSelectDiscoveryMode('list')}
                aria-pressed={discoveryMode === 'list'}
                aria-label="List View"
                title="List View"
                data-testid="mode-list-btn"
                className={`h-6 px-2 rounded-md inline-flex items-center justify-center gap-1 text-[11px] font-semibold transition-colors whitespace-nowrap shrink-0 ${
                  discoveryMode === 'list'
                    ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-2xs'
                    : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                }`}
              >
                <List className="w-3.5 h-3.5 shrink-0" />
                <span>List</span>
              </button>
            </div>
          </div>

          {/* Adjacent Scrollable Container: Filters, Sort, and Category Pills (`flex-1 overflow-x-auto hide-scrollbar`) */}
          <div
            role="tablist"
            aria-label="Discovery filters, sort, and categories"
            data-testid="category-chips-row"
            data-wrap-expanded={isCategoryRowWrapped ? 'true' : 'false'}
            className={`flex-1 min-w-0 flex items-center gap-1.5 py-0.5 ${
              isCategoryRowWrapped
                ? 'flex-wrap'
                : 'flex-nowrap overflow-x-auto hide-scrollbar no-scrollbar whitespace-nowrap'
            }`}
          >
            {/* 1. Filters Button */}
            <button
              type="button"
              onClick={() => {
                onCloseSortPopover();
                onOpenFilterModal();
              }}
              aria-label={
                activeFilterCount > 0
                  ? `Filters (${activeFilterCount} active)`
                  : 'Open Filters'
              }
              title="Open Discovery Filters"
              data-testid="open-filter-modal-btn"
              className={`h-7 px-2.5 rounded-lg border inline-flex items-center justify-center gap-1.5 text-[11px] sm:text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                activeFilterCount > 0
                  ? 'bg-[var(--ps-surface-alt)] border-[var(--ps-accent)] text-[var(--ps-text)]'
                  : 'bg-[var(--ps-bg)] border-[var(--ps-border)]/80 text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
              }`}
            >
              <Filter className="w-3.5 h-3.5 text-[var(--ps-accent)] shrink-0" />
              <span>Filters</span>
              {activeFilterCount > 0 && (
                <span
                  data-testid="active-filter-badge"
                  className="min-w-[16px] h-[16px] px-1 rounded-full bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-[10px] font-bold inline-flex items-center justify-center tabular-nums"
                >
                  {activeFilterCount}
                </span>
              )}
            </button>

            {/* 2. Sort Popover Trigger */}
            <button
              type="button"
              onClick={onToggleSortPopover}
              aria-haspopup="listbox"
              aria-expanded={isSortPopoverOpen}
              aria-label={`Sort discovery results (currently ${activeSortOption.label})`}
              title={`Sort: ${activeSortOption.label}`}
              data-testid="explore-sort-trigger"
              className={`h-7 px-2.5 rounded-lg border inline-flex items-center justify-center gap-1.5 text-[11px] sm:text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                isSortPopoverOpen || sortBy !== 'relevance'
                  ? 'bg-[var(--ps-surface-alt)] border-[var(--ps-accent)] text-[var(--ps-text)]'
                  : 'bg-[var(--ps-bg)] border-[var(--ps-border)]/80 text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
              }`}
            >
              <ArrowUpDown className="w-3.5 h-3.5 text-[var(--ps-accent)] shrink-0" />
              <span>{activeSortOption.shortLabel}</span>
            </button>

            {/* Subtle Divider separating filter/sort tools from Category Pills */}
            <span
              aria-hidden="true"
              className="h-4 w-px bg-[var(--ps-border)] shrink-0 mx-0.5"
            />

            {/* 3. Category Pills (Sorted Descending by Quantity) */}
            <button
              type="button"
              role="tab"
              aria-selected={selectedCategory === 'all'}
              data-testid="category-chip-all"
              onClick={() => onSelectCategory('all')}
              className={`inline-flex items-center gap-1.5 ${
                isMobileLandscape
                  ? 'px-2.5 py-1 text-[11px]'
                  : 'px-2.5 py-1 text-xs'
              } rounded-lg font-semibold transition-colors shrink-0 ${
                selectedCategory === 'all'
                  ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-2xs'
                  : 'bg-[var(--ps-bg)] text-[var(--ps-text-muted)] border border-[var(--ps-border)]/80 hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
              }`}
            >
              <span>All</span>
              <span
                className={`px-1.5 py-0.2 rounded text-[10px] font-bold tabular-nums ${
                  selectedCategory === 'all'
                    ? 'bg-white/20 text-white'
                    : 'bg-[var(--ps-surface-alt)] text-[var(--ps-text-muted)]'
                }`}
              >
                ({totalListingsCount})
              </span>
            </button>

            {isCategoriesLoading ? (
              <div
                data-testid="category-chips-loading"
                className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-[var(--ps-bg)] border border-[var(--ps-border)]/80 text-xs text-[var(--ps-text-muted)] shrink-0"
              >
                <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--ps-accent)]" />
                <span>Loading categories...</span>
              </div>
            ) : (
              sortedCategories.map(({ cat, catKey, catLabel, count }) => {
                const isActive = selectedCategory === catKey;
                return (
                  <button
                    key={cat.id || catKey}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    data-testid={`category-chip-${catKey}`}
                    data-category-count={count}
                    onClick={() => onSelectCategory(catKey)}
                    className={`inline-flex items-center gap-1.5 ${
                      isMobileLandscape
                        ? 'px-2.5 py-1 text-[11px]'
                        : 'px-2.5 py-1 text-xs'
                    } rounded-lg font-semibold transition-colors shrink-0 ${
                      isActive
                        ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-2xs'
                        : 'bg-[var(--ps-bg)] text-[var(--ps-text-muted)] border border-[var(--ps-border)]/80 hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                    }`}
                  >
                    <CategoryPillIcon
                      category={catKey}
                      className="w-3.5 h-3.5"
                    />
                    <span>{catLabel}</span>
                    <span
                      data-testid={`category-badge-${catKey}`}
                      className={`px-1.5 py-0.2 rounded text-[10px] font-bold tabular-nums ${
                        isActive
                          ? 'bg-white/20 text-white'
                          : 'bg-[var(--ps-surface-alt)] text-[var(--ps-text-muted)]'
                      }`}
                    >
                      ({count})
                    </span>
                  </button>
                );
              })
            )}
          </div>

          {/* Sort Popover Menu (rendered outside overflow-x-auto so it is never clipped) */}
          {isSortPopoverOpen && (
            <div
              role="listbox"
              aria-label="Sort discovery results"
              data-testid="explore-sort-popover"
              className="absolute top-full left-0 z-[9999] bg-slate-900 sm:left-28 mt-1.5 w-64 max-w-[calc(100vw-24px)] rounded-2xl bg-[var(--ps-surface)] border border-[var(--ps-border)] shadow-xl p-1.5 space-y-0.5 text-xs"
            >
              <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                Sort Directory Listings
              </div>
              {FILTER_BAR_SORT_OPTIONS.map((option) => {
                const isSelected = sortBy === option.id;
                return (
                  <button
                    key={option.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    data-testid={`sort-option-${option.id}`}
                    onClick={() => {
                      onSelectSortBy(option.id);
                      onCloseSortPopover();
                    }}
                    className={`w-full px-3 py-2 rounded-xl text-left transition-colors flex items-center justify-between gap-2 ${
                      isSelected
                        ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                        : 'text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                    }`}
                  >
                    <div className="min-w-0">
                      <div className="font-semibold truncate">
                        {option.label}
                      </div>
                      <div
                        className={`text-[10px] truncate ${
                          isSelected
                            ? 'opacity-85'
                            : 'text-[var(--ps-text-muted)]'
                        }`}
                      >
                        {option.description}
                      </div>
                    </div>
                    {isSelected && <Check className="w-3.5 h-3.5 shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}

          {/* Subtle absolute expand/collapse chevron button pinned to right edge */}
          <button
            type="button"
            onClick={() => setIsCategoryRowWrapped((prev) => !prev)}
            aria-expanded={isCategoryRowWrapped}
            aria-label={
              isCategoryRowWrapped
                ? 'Collapse categories to single scrollable line'
                : 'Expand categories to full wrap view'
            }
            title={
              isCategoryRowWrapped
                ? 'Single-line scroll view'
                : 'Wrap all categories'
            }
            data-testid="toggle-category-wrap-btn"
            className="absolute right-0 top-1 w-6 h-6 rounded-md bg-[var(--ps-surface)]/95 border border-[var(--ps-border)]/70 text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] inline-flex items-center justify-center shadow-2xs transition-colors z-10"
          >
            {isCategoryRowWrapped ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      )}

      {/* ===============================================================
          ACTIVE FILTER CHIPS ROW:
          Single-line horizontally scrollable (`overflow-x-auto flex-nowrap hide-scrollbar`)
          with right-pinned absolute chevron toggle for full wrap view
         =============================================================== */}
      {hasActiveFilterChips && (
        <div className="relative pr-8">
          <div
            data-testid="active-filter-chips-row"
            data-wrap-expanded={isActiveFiltersWrapped ? 'true' : 'false'}
            className={`flex items-center gap-1.5 pt-0.5 ${
              isActiveFiltersWrapped
                ? 'flex-wrap'
                : 'overflow-x-auto flex-nowrap hide-scrollbar no-scrollbar whitespace-nowrap'
            }`}
          >
            {selectedLocality !== 'all' && (
              <button
                type="button"
                onClick={onClearLocality}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--ps-surface-alt)]/80 text-[11px] font-medium text-[var(--ps-text)] border border-[var(--ps-border)]/70 hover:bg-[var(--ps-surface-alt)] whitespace-nowrap shrink-0 transition-colors"
              >
                <span>{selectedLocality}</span>
                <X className="w-3 h-3 text-[var(--ps-text-muted)]" />
              </button>
            )}
            {selectedPropertyType !== 'all' && (
              <button
                type="button"
                onClick={onClearPropertyType}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--ps-surface-alt)]/80 text-[11px] font-medium text-[var(--ps-text)] border border-[var(--ps-border)]/70 hover:bg-[var(--ps-surface-alt)] whitespace-nowrap shrink-0 transition-colors"
              >
                <span>{PROPERTY_TYPE_LABELS[selectedPropertyType]}</span>
                <X className="w-3 h-3 text-[var(--ps-text-muted)]" />
              </button>
            )}
            {minRating > 0 && (
              <button
                type="button"
                onClick={onClearMinRating}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--ps-surface-alt)]/80 text-[11px] font-medium text-[var(--ps-text)] border border-[var(--ps-border)]/70 hover:bg-[var(--ps-surface-alt)] whitespace-nowrap shrink-0 transition-colors"
              >
                <span>{minRating}+ ★</span>
                <X className="w-3 h-3 text-[var(--ps-text-muted)]" />
              </button>
            )}
            {priceRangeFilter !== 'all' && (
              <button
                type="button"
                onClick={onClearPriceRange}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--ps-surface-alt)]/80 text-[11px] font-medium text-[var(--ps-text)] border border-[var(--ps-border)]/70 hover:bg-[var(--ps-surface-alt)] whitespace-nowrap shrink-0 transition-colors"
              >
                <span>{PRICE_RANGE_LABELS[priceRangeFilter]}</span>
                <X className="w-3 h-3 text-[var(--ps-text-muted)]" />
              </button>
            )}
            {verifiedOnly && (
              <button
                type="button"
                onClick={onClearVerifiedOnly}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--ps-surface-alt)]/80 text-[11px] font-medium text-[var(--ps-text)] border border-[var(--ps-border)]/70 hover:bg-[var(--ps-surface-alt)] whitespace-nowrap shrink-0 transition-colors"
              >
                <span>Verified</span>
                <X className="w-3 h-3 text-[var(--ps-text-muted)]" />
              </button>
            )}
            {has360Only && (
              <button
                type="button"
                onClick={onClearHas360Only}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--ps-surface-alt)]/80 text-[11px] font-medium text-[var(--ps-text)] border border-[var(--ps-border)]/70 hover:bg-[var(--ps-surface-alt)] whitespace-nowrap shrink-0 transition-colors"
              >
                <span>360° Tour</span>
                <X className="w-3 h-3 text-[var(--ps-text-muted)]" />
              </button>
            )}
            {hasCatalogueOnly && (
              <button
                type="button"
                onClick={onClearHasCatalogueOnly}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--ps-surface-alt)]/80 text-[11px] font-medium text-[var(--ps-text)] border border-[var(--ps-border)]/70 hover:bg-[var(--ps-surface-alt)] whitespace-nowrap shrink-0 transition-colors"
              >
                <span>Catalogue</span>
                <X className="w-3 h-3 text-[var(--ps-text-muted)]" />
              </button>
            )}
            {activeFilterShape && (
              <button
                type="button"
                onClick={onClearSpatialFilterShape}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-emerald-600/90 text-white text-[11px] font-semibold whitespace-nowrap shrink-0"
              >
                <span>Inside {activeFilterShape.label}</span>
                <X className="w-3 h-3" />
              </button>
            )}
            {activeFilterCount > 0 && (
              <button
                type="button"
                onClick={onResetAllFilters}
                className="text-[11px] font-semibold text-rose-600 hover:underline px-1.5 whitespace-nowrap shrink-0"
              >
                Reset all
              </button>
            )}
          </div>

          {/* Subtle absolute positioned expand/collapse button pinned to right edge */}
          <button
            type="button"
            onClick={() => setIsActiveFiltersWrapped((prev) => !prev)}
            aria-expanded={isActiveFiltersWrapped}
            aria-label={
              isActiveFiltersWrapped
                ? 'Collapse active filters to single scrollable line'
                : 'Expand active filters to full wrap view'
            }
            title={
              isActiveFiltersWrapped
                ? 'Single-line scroll view'
                : 'Wrap all active filters'
            }
            data-testid="toggle-active-filters-wrap-btn"
            className="absolute right-0 top-0.5 w-6 h-6 rounded-md bg-[var(--ps-surface)]/95 border border-[var(--ps-border)]/70 text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] inline-flex items-center justify-center shadow-2xs transition-colors z-10"
          >
            {isActiveFiltersWrapped ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </button>
        </div>
      )}
    </div>
  );
}

export default FilterBar;
