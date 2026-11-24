'use client';

import React, { useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  ArrowUpDown,
  Briefcase,
  Building2,
  Car,
  Check,
  ChevronDown,
  ChevronUp,
  Filter,
  Globe,
  Landmark,
  List,
  Loader2,
  Map as MapIcon,
  MapPin,
  Printer,
  RotateCcw,
  Store,
  Trophy,
  X,
} from 'lucide-react';
import {
  PRINT_CAPABILITY_FILTER_OPTIONS,
  type PrintCapabilityFilterKey,
} from '@/lib/print-orders/client-helpers';
import {
  EXPLORE_VERTICAL_PILLS,
  VERTICAL_ATTRIBUTE_CHIPS,
  type ExploreVerticalFilter,
} from '@/lib/verticals/filter-catalog';
import {
  CATEGORY_LABELS,
  PROPERTY_TYPE_LABELS,
} from '@/lib/rules';
import {
  PRICE_RANGE_LABELS,
  PriceRangeFilterOption,
} from './FilterDrawerModal';
import { CustomSelectModal } from '@/components/ui/CustomSelectModal';
import { getIconByKey } from '@/lib/icons/registry';
import {
  DiscoverySearchScope,
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
    shortLabel: 'Nearest',
    description: 'Closest to current map centre',
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

export function CategoryPillIcon({
  category,
  className = 'w-[1.2em] h-[1.2em]',
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
    case 'vehicles':
      return <Car className={className} aria-hidden="true" />;
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

export interface SubcategoryFilterPill {
  id: string;
  slug: string;
  display_name: string;
  depth: number;
  icon?: string;
  color_hex?: string;
  icon_key?: string | null;
  accent_color?: string | null;
}

export interface FilterBarProps {
  isDiscoveryCollapsed: boolean;
  isMobileLandscape: boolean;
  isCategoriesLoading: boolean;
  totalListingsCount: number;
  categories: CategoryFilterItem[];
  selectedCategory: ListingCategory | 'all' | 'vehicles';
  onSelectCategory: (cat: ListingCategory | 'all' | 'vehicles') => void;
  subcategories?: SubcategoryFilterPill[];
  selectedSubcategoryId?: string | null;
  onSelectSubcategory?: (subId: string | null) => void;
  activeRootCategoryLabel?: string;
  vehicleListingsCount?: number;
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
  hideDesktopPrimaryControls?: boolean;
  showPrintCapabilityBar?: boolean;
  selectedPrintCapability?: PrintCapabilityFilterKey;
  onSelectPrintCapability?: (key: PrintCapabilityFilterKey) => void;
  selectedVertical?: ExploreVerticalFilter;
  onSelectVertical?: (vertical: ExploreVerticalFilter) => void;
  activeVerticalAttributes?: string[];
  onToggleVerticalAttribute?: (attrKey: string) => void;
  moduleSwitches?: Partial<
    Record<string, boolean | { enabled?: boolean } | undefined>
  >;
  searchScope?: DiscoverySearchScope;
  onSwitchSearchScope?: (scope: DiscoverySearchScope) => void;
  onCollapsePanel?: () => void;
  activeHubName?: string;
}

export function FilterBar({
  isDiscoveryCollapsed,
  isCategoriesLoading,
  totalListingsCount,
  categories,
  selectedCategory,
  onSelectCategory,
  subcategories = [],
  selectedSubcategoryId = null,
  onSelectSubcategory,
  activeRootCategoryLabel,
  vehicleListingsCount = 0,
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
  hideDesktopPrimaryControls = false,
  showPrintCapabilityBar = false,
  selectedPrintCapability = 'all',
  onSelectPrintCapability,
  selectedVertical = 'all',
  onSelectVertical,
  activeVerticalAttributes = [],
  onToggleVerticalAttribute,
  moduleSwitches,
  searchScope = 'map_area',
  onSwitchSearchScope,
  onCollapsePanel,
}: FilterBarProps) {
  const [isActiveFiltersWrapped, setIsActiveFiltersWrapped] = useState(false);

  const activeCategory = selectedCategory;

  const sortedCategories = useMemo(
    () =>
      [...categories].sort((a, b) => {
        const aMatchesActive =
          activeCategory !== 'all' &&
          (a.catKey === activeCategory || a.cat.id === activeCategory);
        const bMatchesActive =
          activeCategory !== 'all' &&
          (b.catKey === activeCategory || b.cat.id === activeCategory);
        if (aMatchesActive && !bMatchesActive) return -1;
        if (!aMatchesActive && bMatchesActive) return 1;
        return b.count - a.count;
      }),
    [categories, activeCategory]
  );

  const activeSortOption = useMemo(
    () =>
      FILTER_BAR_SORT_OPTIONS.find((opt) => opt.id === sortBy) ||
      FILTER_BAR_SORT_OPTIONS[0],
    [sortBy]
  );

  const sortSelectOptions = useMemo(
    () =>
      FILTER_BAR_SORT_OPTIONS.map((opt) => ({
        value: opt.id,
        label: `Sort: ${opt.shortLabel}`,
        description: opt.description,
      })),
    []
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

  const hasContextualSubRow =
    (selectedCategory !== 'all' &&
      selectedCategory !== 'vehicles' &&
      subcategories.length > 0 &&
      Boolean(onSelectSubcategory)) ||
    (selectedVertical !== 'all' &&
      Boolean(onToggleVerticalAttribute) &&
      (VERTICAL_ATTRIBUTE_CHIPS[selectedVertical]?.length ?? 0) > 0) ||
    (showPrintCapabilityBar && Boolean(onSelectPrintCapability));

  const totalActiveFilterAndVerticalCount =
    activeFilterCount +
    (selectedVertical !== 'all' ? 1 : 0) +
    activeVerticalAttributes.length +
    (selectedCategory !== 'all' ? 1 : 0);

  const renderCategoryAndVerticalPills = (compact = false) => {
    const pillHeight = compact ? 'h-7 px-2.5 text-xs' : 'h-8 px-3 text-sm';
    const isAllActive =
      selectedCategory === 'all' && selectedVertical === 'all';

    return (
      <>
        <button
          type="button"
          role="tab"
          aria-selected={isAllActive}
          data-testid="category-chip-all"
          onClick={() => {
            onSelectCategory('all');
            onSelectVertical?.('all');
          }}
          className={`${pillHeight} font-medium flex items-center justify-center rounded-full leading-tight flex-shrink-0 gap-1.5 transition-colors whitespace-nowrap cursor-pointer ${
            isAllActive
              ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-2xs'
              : 'bg-[var(--ps-bg)] text-[var(--ps-text-muted)] border border-[var(--ps-border)]/80 hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
          }`}
        >
          <span>All</span>
          <span
            className={`px-1.5 py-0.2 rounded text-[10px] font-bold tabular-nums ${
              isAllActive
                ? 'bg-[var(--ps-accent-fg)]/15 text-[var(--ps-accent-fg)]'
                : 'bg-[var(--ps-surface-alt)] text-[var(--ps-text-muted)]'
            }`}
          >
            ({totalListingsCount})
          </span>
        </button>

        {/* Vertical Quick-Filter Pills in the same horizontal swipeable row */}
        {onSelectVertical &&
          EXPLORE_VERTICAL_PILLS.filter((pill) => pill.id !== 'all').map(
            (pill) => {
              const rawSwitch =
                pill.moduleSwitchKey && moduleSwitches
                  ? moduleSwitches[pill.moduleSwitchKey]
                  : undefined;
              const isPaused = Boolean(
                rawSwitch === false ||
                  (rawSwitch &&
                    typeof rawSwitch === 'object' &&
                    rawSwitch.enabled === false)
              );
              const isActive = selectedVertical === pill.id;
              return (
                <button
                  key={`vertical-${pill.id}`}
                  type="button"
                  disabled={isPaused}
                  aria-pressed={isActive}
                  data-testid={`vertical-pill-${pill.id}`}
                  title={
                    isPaused
                      ? `${pill.label} is paused in this hub`
                      : pill.label
                  }
                  onClick={() =>
                    onSelectVertical(isActive ? 'all' : pill.id)
                  }
                  className={`${pillHeight} font-semibold flex items-center justify-center rounded-full leading-tight flex-shrink-0 gap-1.5 transition-colors whitespace-nowrap ${
                    isPaused
                      ? 'bg-[var(--ps-surface-alt)] text-[var(--ps-text-muted)]/50 border border-[var(--ps-border)]/50 cursor-not-allowed line-through'
                      : isActive
                        ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-2xs cursor-pointer'
                        : 'bg-[var(--ps-bg)] text-[var(--ps-text-muted)] border border-[var(--ps-border)]/80 hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] cursor-pointer'
                  }`}
                >
                  <span>{pill.label}</span>
                </button>
              );
            }
          )}

        {isCategoriesLoading ? (
          <div
            data-testid="category-chips-loading"
            className={`${pillHeight} font-medium flex items-center justify-center rounded-full leading-tight flex-shrink-0 gap-1.5 bg-[var(--ps-bg)] border border-[var(--ps-border)]/80 text-[var(--ps-text-muted)]`}
          >
            <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--ps-accent)]" />
            <span>Loading...</span>
          </div>
        ) : (
          <>
            <button
              type="button"
              role="tab"
              aria-selected={selectedCategory === 'vehicles'}
              data-testid="category-chip-vehicles"
              data-category-count={vehicleListingsCount}
              onClick={() => onSelectCategory('vehicles')}
              className={`${pillHeight} font-medium flex items-center justify-center rounded-full leading-tight flex-shrink-0 gap-1.5 transition-colors whitespace-nowrap cursor-pointer ${
                selectedCategory === 'vehicles'
                  ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-2xs'
                  : 'bg-[var(--ps-bg)] text-[var(--ps-text-muted)] border border-[var(--ps-border)]/80 hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
              }`}
            >
              <Car className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Vehicles &amp; Rentals</span>
              <span
                data-testid="category-badge-vehicles"
                className={`px-1.5 py-0.2 rounded text-[10px] font-bold tabular-nums ${
                  selectedCategory === 'vehicles'
                    ? 'bg-[var(--ps-accent-fg)]/15 text-[var(--ps-accent-fg)]'
                    : 'bg-[var(--ps-surface-alt)] text-[var(--ps-text-muted)]'
                }`}
              >
                ({vehicleListingsCount})
              </span>
            </button>
            {sortedCategories.map(({ cat, catKey, catLabel, count }) => {
              const isActive =
                activeCategory === catKey || activeCategory === cat.id;
              return (
                <button
                  key={cat.id || catKey}
                  type="button"
                  role="tab"
                  aria-selected={isActive}
                  data-testid={`category-chip-${catKey}`}
                  data-category-count={count}
                  onClick={() => onSelectCategory(catKey)}
                  className={`${pillHeight} font-medium flex items-center justify-center rounded-full leading-tight flex-shrink-0 gap-1.5 transition-colors whitespace-nowrap cursor-pointer ${
                    isActive
                      ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-2xs'
                      : 'bg-[var(--ps-bg)] text-[var(--ps-text-muted)] border border-[var(--ps-border)]/80 hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                  }`}
                >
                  <CategoryPillIcon category={catKey} className="w-3.5 h-3.5" />
                  <span>{catLabel}</span>
                  <span
                    data-testid={`category-badge-${catKey}`}
                    className={`px-1.5 py-0.2 rounded text-[10px] font-bold tabular-nums ${
                      isActive
                        ? 'bg-[var(--ps-accent-fg)]/15 text-[var(--ps-accent-fg)]'
                        : 'bg-[var(--ps-surface-alt)] text-[var(--ps-text-muted)]'
                    }`}
                  >
                    ({count})
                  </span>
                </button>
              );
            })}
          </>
        )}
      </>
    );
  };

  const renderContextualSubRow = () => {
    if (!hasContextualSubRow) return null;

    return (
      <div
        data-testid="contextual-subcategories-attributes-row"
        className="flex items-center gap-1.5 overflow-x-auto hide-scrollbar no-scrollbar pt-1.5 pb-0.5 border-t border-[var(--ps-border)]/60"
      >
        {/* 1. Sub-categories when a root category is selected */}
        {selectedCategory !== 'all' &&
          selectedCategory !== 'vehicles' &&
          subcategories.length > 0 &&
          onSelectSubcategory && (
            <>
              <button
                type="button"
                onClick={() => onSelectSubcategory(null)}
                data-testid="subcategory-chip-all"
                className={`h-7 px-2.5 text-xs font-semibold rounded-full flex items-center justify-center shrink-0 whitespace-nowrap transition-colors cursor-pointer ${
                  !selectedSubcategoryId
                    ? 'bg-[var(--ps-accent)]/15 text-[var(--ps-accent)] border border-[var(--ps-accent)]/40'
                    : 'bg-[var(--ps-bg)] text-[var(--ps-text-muted)] border border-[var(--ps-border)]/70 hover:text-[var(--ps-text)]'
                }`}
              >
                All in{' '}
                {activeRootCategoryLabel ||
                  CATEGORY_LABELS[selectedCategory] ||
                  'Category'}
              </button>
              {subcategories.map((sub) => {
                const isSubActive =
                  selectedSubcategoryId === sub.id ||
                  selectedSubcategoryId === sub.slug;
                const SubIcon = getIconByKey(sub.icon_key || sub.icon);
                const subAccent = sub.accent_color || sub.color_hex;
                return (
                  <button
                    key={sub.id}
                    type="button"
                    onClick={() =>
                      onSelectSubcategory(isSubActive ? null : sub.id)
                    }
                    data-testid={`subcategory-chip-${sub.slug}`}
                    className={`h-7 px-2.5 text-xs font-medium rounded-full flex items-center justify-center gap-1.5 shrink-0 whitespace-nowrap transition-colors cursor-pointer ${
                      isSubActive
                        ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-2xs'
                        : 'bg-[var(--ps-bg)] text-[var(--ps-text-muted)] border border-[var(--ps-border)]/70 hover:text-[var(--ps-text)]'
                    }`}
                  >
                    <SubIcon
                      className="h-3 w-3 shrink-0"
                      style={!isSubActive && subAccent ? { color: subAccent } : undefined}
                      aria-hidden="true"
                    />
                    <span>
                      {sub.depth === 2
                        ? `↳ ${sub.display_name}`
                        : sub.display_name}
                    </span>
                  </button>
                );
              })}
            </>
          )}

        {/* 2. Dynamic vertical attribute chips when a vertical is active */}
        {selectedVertical !== 'all' &&
          onToggleVerticalAttribute &&
          (VERTICAL_ATTRIBUTE_CHIPS[selectedVertical]?.length ?? 0) > 0 &&
          VERTICAL_ATTRIBUTE_CHIPS[selectedVertical].map((chip) => {
            const active = activeVerticalAttributes.includes(chip.key);
            return (
              <button
                key={chip.key}
                type="button"
                aria-pressed={active}
                data-testid={`vertical-attr-${chip.key}`}
                onClick={() => onToggleVerticalAttribute(chip.key)}
                className={`h-7 px-2.5 rounded-full text-xs font-semibold whitespace-nowrap shrink-0 border transition-colors cursor-pointer ${
                  active
                    ? 'bg-[var(--ps-accent)]/15 text-[var(--ps-accent)] border-[var(--ps-accent)]/45'
                    : 'bg-[var(--ps-bg)] text-[var(--ps-text-muted)] border-[var(--ps-border)] hover:text-[var(--ps-text)]'
                }`}
              >
                {chip.label}
              </button>
            );
          })}

        {/* 3. Print capability chips when Print is selected */}
        {showPrintCapabilityBar && onSelectPrintCapability && (
          <>
            <span className="inline-flex h-7 items-center gap-1 rounded-full bg-theme-primary/10 px-2 text-[11px] font-bold text-theme-primary shrink-0 whitespace-nowrap">
              <Printer className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span>Print:</span>
            </span>
            {PRINT_CAPABILITY_FILTER_OPTIONS.map((opt) => {
              const isActive = selectedPrintCapability === opt.key;
              return (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() =>
                    onSelectPrintCapability(isActive ? 'all' : opt.key)
                  }
                  data-testid={`print-capability-chip-${opt.key}`}
                  className={`h-7 px-2.5 text-xs font-semibold rounded-full flex items-center justify-center shrink-0 whitespace-nowrap transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-theme-primary text-[hsl(var(--color-primary-foreground))] shadow-2xs'
                      : 'bg-[var(--ps-bg)] text-[var(--ps-text-muted)] border border-[var(--ps-border)]/80 hover:border-theme-primary/50 hover:text-[var(--ps-text)]'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </>
        )}
      </div>
    );
  };

  const renderActiveFilterChipsRow = () => {
    if (!hasActiveFilterChips) return null;
    return (
      <div className="relative pr-8 pt-1 border-t border-[var(--ps-border)]/50">
        <div
          data-testid="active-filter-chips-row"
          data-wrap-expanded={isActiveFiltersWrapped ? 'true' : 'false'}
          className={`flex items-center gap-1.5 ${
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
        </div>

        <button
          type="button"
          onClick={() => setIsActiveFiltersWrapped((prev) => !prev)}
          aria-expanded={isActiveFiltersWrapped}
          aria-label={
            isActiveFiltersWrapped
              ? 'Collapse active filters to single scrollable line'
              : 'Expand active filters to full wrap view'
          }
          data-testid="toggle-active-filters-wrap-btn"
          className="absolute right-0 top-1 w-6 h-6 rounded-md bg-[var(--ps-surface)]/95 border border-[var(--ps-border)]/70 text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] flex items-center justify-center shadow-2xs transition-colors z-10"
        >
          {isActiveFiltersWrapped ? (
            <ChevronUp className="w-3 h-3" />
          ) : (
            <ChevronDown className="w-3 h-3" />
          )}
        </button>
      </div>
    );
  };

  return (
    <div>
      {/* ===============================================================
          PASS V7: STREAMLINED EXPANDED PANEL (Mobile Tray + Desktop Strip)
          When `isDiscoveryCollapsed === true`, renders ZERO extra rows below
          the unified 1-row search bar!
         =============================================================== */}
      {!isDiscoveryCollapsed && (
        <>
          {/* 1. MOBILE EXPANDED COLLAPSIBLE TRAY (<lg) — max-h-[52vh] with internal scroll */}
          <div
            data-testid="mobile-expanded-filter-tray"
            className="lg:hidden mt-1.5 max-h-[52vh] overflow-y-auto overscroll-contain rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)]/98 p-2.5 shadow-lg space-y-2 backdrop-blur-md"
          >
            {/* Row A: Compact Utility Strip (Scope + Sort + Map/List + Advanced Filters) */}
            <div className="flex flex-wrap items-center justify-between gap-1.5">
              {/* Hub / Global Scope Toggle */}
              {onSwitchSearchScope && (
                <div
                  data-testid="mobile-tray-scope-toggle"
                  className="inline-flex items-center p-0.5 rounded-lg bg-[var(--ps-bg)] border border-[var(--ps-border)]/80 shrink-0"
                  role="group"
                  aria-label="Search scope"
                >
                  <button
                    type="button"
                    onClick={() => onSwitchSearchScope('map_area')}
                    aria-pressed={searchScope === 'map_area'}
                    className={`h-7 px-2 text-[11px] font-semibold rounded-md inline-flex items-center gap-1 transition-colors cursor-pointer ${
                      searchScope === 'map_area'
                        ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-2xs'
                        : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                    }`}
                  >
                    <MapPin className="w-3 h-3 shrink-0" />
                    <span>Hub Area</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onSwitchSearchScope('global')}
                    aria-pressed={searchScope === 'global'}
                    className={`h-7 px-2 text-[11px] font-semibold rounded-md inline-flex items-center gap-1 transition-colors cursor-pointer ${
                      searchScope === 'global'
                        ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-2xs'
                        : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                    }`}
                  >
                    <Globe className="w-3 h-3 shrink-0" />
                    <span>Global</span>
                  </button>
                </div>
              )}

              {/* Map / List Segmented Toggle */}
              <div
                data-testid="filter-bar-pinned-mode-toggle"
                className="inline-flex items-center p-0.5 rounded-lg bg-[var(--ps-bg)] border border-[var(--ps-border)]/80 shrink-0"
                role="group"
                aria-label="Discovery view mode"
              >
                <button
                  type="button"
                  onClick={() => onSelectDiscoveryMode('map')}
                  aria-pressed={discoveryMode === 'map'}
                  aria-label="Map View"
                  data-testid="mode-map-btn"
                  className={`h-7 px-2 text-[11px] leading-tight flex items-center justify-center gap-1 rounded-md font-semibold transition-colors whitespace-nowrap cursor-pointer ${
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
                  data-testid="mode-list-btn"
                  className={`h-7 px-2 text-[11px] leading-tight flex items-center justify-center gap-1 rounded-md font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                    discoveryMode === 'list'
                      ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-2xs'
                      : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                  }`}
                >
                  <List className="w-3.5 h-3.5 shrink-0" />
                  <span>List</span>
                </button>
              </div>

              {/* Sort Selector via CustomSelectModal */}
              <div className="min-w-[126px] flex-1">
                <CustomSelectModal
                  testId="explore-sort-trigger"
                  label=""
                  placeholder="Sort by"
                  value={sortBy}
                  options={sortSelectOptions}
                  onChange={(val) =>
                    onSelectSortBy(val as DiscoverySortOption)
                  }
                  className="[&_button]:min-h-[32px] [&_button]:h-8 [&_button]:px-2.5 [&_button]:py-1 [&_button]:rounded-lg [&_button]:text-[11px]"
                />
              </div>

              {/* Advanced Filters Drawer Button */}
              <button
                type="button"
                onClick={() => {
                  onCloseSortPopover();
                  onOpenFilterModal();
                }}
                aria-label={
                  activeFilterCount > 0
                    ? `Advanced Filters (${activeFilterCount} active)`
                    : 'Open Advanced Filters'
                }
                data-testid="open-filter-modal-btn"
                className={`h-8 px-2.5 text-[11px] font-semibold rounded-lg leading-tight flex-shrink-0 inline-flex items-center justify-center gap-1.5 border transition-colors whitespace-nowrap cursor-pointer ${
                  activeFilterCount > 0
                    ? 'bg-[var(--ps-surface-alt)] border-[var(--ps-accent)] text-[var(--ps-text)]'
                    : 'bg-[var(--ps-bg)] border-[var(--ps-border)]/80 text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                }`}
              >
                <Filter className="w-3.5 h-3.5 text-[var(--ps-accent)] shrink-0" />
                <span>Advanced</span>
                {activeFilterCount > 0 && (
                  <span
                    data-testid="active-filter-badge"
                    className="min-w-[16px] h-[16px] px-1 rounded-full bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-[10px] font-bold inline-flex items-center justify-center tabular-nums"
                  >
                    {activeFilterCount}
                  </span>
                )}
              </button>
            </div>

            {/* Row B: Single Swipeable Horizontal Verticals & Categories Strip */}
            <div
              role="tablist"
              aria-label="Discovery verticals and categories"
              data-testid="category-chips-row"
              className="flex items-center gap-1.5 overflow-x-auto flex-nowrap hide-scrollbar no-scrollbar py-0.5"
            >
              {renderCategoryAndVerticalPills(true)}
            </div>

            {/* Row C: Contextual Sub-Categories & Dynamic Attribute Chips (only when vertical/category active) */}
            {renderContextualSubRow()}

            {/* Row D: Removable Active Filter Chips (if any) */}
            {renderActiveFilterChipsRow()}

            {/* Row E: Compact Footer Action Row (Clear Filters + Apply / Collapse) */}
            <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-[var(--ps-border)]/70">
              <button
                type="button"
                onClick={() => {
                  onResetAllFilters();
                  onSelectVertical?.('all');
                }}
                disabled={totalActiveFilterAndVerticalCount === 0}
                data-testid="tray-clear-filters-btn"
                className="h-7 px-2.5 rounded-lg text-[11px] font-semibold inline-flex items-center gap-1 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 disabled:opacity-40 disabled:pointer-events-none transition-colors cursor-pointer"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Clear Filters</span>
              </button>

              <button
                type="button"
                onClick={() => onCollapsePanel?.()}
                data-testid="tray-apply-collapse-btn"
                className="h-7 px-3 rounded-lg bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-[11px] font-semibold inline-flex items-center gap-1 shadow-2xs hover:opacity-95 transition-opacity cursor-pointer"
              >
                <span>Apply &amp; Collapse</span>
                <ChevronUp className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* 2. DESKTOP HORIZONTAL STRIP (lg+) */}
          <div className="hidden lg:block space-y-1 pt-1">
            <div
              role="tablist"
              aria-label="Discovery filters, sort, and categories"
              data-testid="desktop-category-chips-row"
              className="flex items-center gap-2 overflow-x-auto flex-nowrap hide-scrollbar no-scrollbar py-0.5"
            >
              {!hideDesktopPrimaryControls && (
                <>
                  <button
                    type="button"
                    onClick={() => {
                      onCloseSortPopover();
                      onOpenFilterModal();
                    }}
                    className="h-8 px-3 text-sm font-medium rounded-full leading-tight flex-shrink-0 flex items-center justify-center gap-1.5 border bg-[var(--ps-bg)] border-[var(--ps-border)]/80 text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors whitespace-nowrap"
                  >
                    <Filter className="w-3.5 h-3.5 text-[var(--ps-accent)] shrink-0" />
                    <span>Filters</span>
                  </button>
                  <button
                    type="button"
                    onClick={onToggleSortPopover}
                    className="h-8 px-3 text-sm font-medium rounded-full leading-tight flex-shrink-0 flex items-center justify-center gap-1.5 border bg-[var(--ps-bg)] border-[var(--ps-border)]/80 text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors whitespace-nowrap"
                  >
                    <ArrowUpDown className="w-3.5 h-3.5 text-[var(--ps-accent)] shrink-0" />
                    <span>{activeSortOption.shortLabel}</span>
                  </button>
                </>
              )}
              {renderCategoryAndVerticalPills(false)}
            </div>

            {renderContextualSubRow()}
            {renderActiveFilterChipsRow()}
          </div>
        </>
      )}

      {/* Desktop Sort Dropdown Portal (z-[95] per strict modal hierarchy) */}
      {isSortPopoverOpen &&
        (() => {
          const closeSort = onCloseSortPopover;
          const sortPopupNode = (
            <>
              <div
                data-testid="explore-sort-backdrop"
                className="fixed inset-0 bg-black/50 z-[95]"
                onClick={closeSort}
              />
              <div
                role="listbox"
                aria-label="Sort discovery results"
                data-testid="explore-sort-popover"
                className="fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-[95] w-[90%] max-w-sm bg-[var(--ps-surface)] border border-[var(--ps-border)] rounded-xl shadow-2xl p-4 space-y-1 text-xs text-[var(--ps-text)]"
              >
                <div className="flex items-center justify-between px-2 pb-2 border-b border-[var(--ps-border)]">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                    Sort Directory Listings
                  </span>
                  <button
                    type="button"
                    onClick={closeSort}
                    aria-label="Close sort menu"
                    className="w-7 h-7 flex items-center justify-center rounded-lg text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors"
                  >
                    <X className="w-4 h-4" />
                  </button>
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
                        closeSort();
                      }}
                      className={`w-full px-3 py-2.5 rounded-xl text-left transition-colors flex items-center justify-between gap-2 ${
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
                              ? 'opacity-90'
                              : 'text-[var(--ps-text-muted)]'
                          }`}
                        >
                          {option.description}
                        </div>
                      </div>
                      {isSelected && (
                        <Check className="w-[1.2em] h-[1.2em] shrink-0" />
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          );
          return typeof document !== 'undefined'
            ? createPortal(sortPopupNode, document.body)
            : sortPopupNode;
        })()}
    </div>
  );
}

export default FilterBar;
