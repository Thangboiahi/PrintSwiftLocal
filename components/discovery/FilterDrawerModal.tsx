'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Check,
  ChevronDown,
  Filter,
  MapPin,
  RotateCcw,
  Star,
  X,
} from 'lucide-react';
import { ListingCategory, PropertyType } from '@/lib/types';
import { CATEGORY_LABELS, PROPERTY_TYPE_LABELS } from '@/lib/rules';

export type PriceRangeFilterOption =
  | 'all'
  | 'under_1k'
  | '1k_to_50k'
  | '50k_to_25l'
  | 'above_25l';

export const PRICE_RANGE_LABELS: Record<PriceRangeFilterOption, string> = {
  all: 'Any Price',
  under_1k: 'Under ₹1,000',
  '1k_to_50k': '₹1,000 – ₹50,000',
  '50k_to_25l': '₹50,000 – ₹25L',
  above_25l: 'Above ₹25L',
};

interface FilterDrawerModalProps {
  open: boolean;
  onClose: () => void;
  selectedCategory: ListingCategory | 'all';
  onSelectCategory: (cat: ListingCategory | 'all') => void;
  selectedLocality: string;
  onSelectLocality: (loc: string) => void;
  localities: string[];
  selectedPropertyType: PropertyType | 'all';
  onSelectPropertyType: (pt: PropertyType | 'all') => void;
  minRating: number;
  onChangeMinRating: (rating: number) => void;
  verifiedOnly: boolean;
  onChangeVerifiedOnly: (val: boolean) => void;
  priceRangeFilter: PriceRangeFilterOption;
  onChangePriceRangeFilter: (val: PriceRangeFilterOption) => void;
  availableOnly: boolean;
  onChangeAvailableOnly: (val: boolean) => void;
  has360Only: boolean;
  onChangeHas360Only: (val: boolean) => void;
  hasCatalogueOnly: boolean;
  onChangeHasCatalogueOnly: (val: boolean) => void;
  onClearAll: () => void;
  matchingCount: number;
}

export function FilterDrawerModal({
  open,
  onClose,
  selectedCategory,
  onSelectCategory,
  selectedLocality,
  onSelectLocality,
  localities,
  selectedPropertyType,
  onSelectPropertyType,
  minRating,
  onChangeMinRating,
  verifiedOnly,
  onChangeVerifiedOnly,
  priceRangeFilter,
  onChangePriceRangeFilter,
  availableOnly,
  onChangeAvailableOnly,
  has360Only,
  onChangeHas360Only,
  hasCatalogueOnly,
  onChangeHasCatalogueOnly,
  onClearAll,
  matchingCount,
}: FilterDrawerModalProps) {
  const [openDropdown, setOpenDropdown] = useState<
    'propertyType' | 'locality' | null
  >(null);
  const drawerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (openDropdown) {
          setOpenDropdown(null);
        } else {
          onClose();
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, openDropdown, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-xs flex items-end sm:items-stretch sm:justify-end"
      role="dialog"
      aria-modal="true"
      aria-label="Discovery Filters"
      data-testid="filter-drawer-modal"
    >
      {/* Backdrop click to close */}
      <div
        className="fixed inset-0 -z-10"
        onClick={() => {
          setOpenDropdown(null);
          onClose();
        }}
      />

      <div
        ref={drawerRef}
        className="w-full sm:w-[420px] max-h-[88dvh] sm:max-h-full sm:h-full rounded-t-3xl sm:rounded-none bg-[var(--ps-surface)] text-[var(--ps-text)] border-t sm:border-t-0 sm:border-l border-[var(--ps-border)] shadow-2xl flex flex-col overflow-hidden"
      >
        {/* Mobile drag handle indicator */}
        <div className="sm:hidden pt-2.5 pb-1 flex justify-center shrink-0">
          <div className="w-10 h-1.5 rounded-full bg-[var(--ps-border)]" />
        </div>

        {/* Header */}
        <div className="px-4 py-3 border-b border-[var(--ps-border)] bg-[var(--ps-surface-alt)] flex items-center justify-between gap-2 shrink-0">
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-[var(--ps-accent)]" />
            <h2 className="text-sm font-bold text-[var(--ps-text)]">
              Discovery Filters
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => {
                setOpenDropdown(null);
                onClearAll();
              }}
              data-testid="filter-modal-clear-all"
              className="text-xs font-semibold text-rose-600 hover:underline inline-flex items-center gap-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)] rounded"
            >
              <RotateCcw className="w-3 h-3" />
              <span>Clear all</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close filter dialog"
              data-testid="filter-modal-close"
              className="p-1.5 rounded-lg text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)]"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Filter Controls Body */}
        <div
          className="flex-1 overflow-y-auto p-4 space-y-5 text-xs"
          onClick={() => {
            if (openDropdown) setOpenDropdown(null);
          }}
        >
          {/* 1. Category */}
          <div className="space-y-2">
            <label className="block font-bold text-[var(--ps-text)]">
              Directory Category
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              <button
                type="button"
                onClick={() => onSelectCategory('all')}
                className={`px-3 py-2 rounded-xl border text-left font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)] ${
                  selectedCategory === 'all'
                    ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] border-[var(--ps-accent)]'
                    : 'bg-[var(--ps-bg)] text-[var(--ps-text)] border-[var(--ps-border)] hover:bg-[var(--ps-surface-alt)]'
                }`}
              >
                All Categories
              </button>
              {(Object.keys(CATEGORY_LABELS) as ListingCategory[]).map(
                (cat) => (
                  <button
                    key={cat}
                    type="button"
                    onClick={() => onSelectCategory(cat)}
                    className={`px-3 py-2 rounded-xl border text-left font-semibold transition-colors truncate focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)] ${
                      selectedCategory === cat
                        ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] border-[var(--ps-accent)]'
                        : 'bg-[var(--ps-bg)] text-[var(--ps-text)] border-[var(--ps-border)] hover:bg-[var(--ps-surface-alt)]'
                    }`}
                  >
                    {CATEGORY_LABELS[cat]}
                  </button>
                )
              )}
            </div>
          </div>

          {/* 2. Real Estate Property Type Custom Dropdown (when Real Estate or All is selected) */}
          {(selectedCategory === 'all' ||
            selectedCategory === 'real_estate') && (
            <div
              className="space-y-2 relative"
              onClick={(e) => e.stopPropagation()}
            >
              <span className="block font-bold text-[var(--ps-text)]">
                Real-Estate Property Subtype
              </span>
              <button
                type="button"
                onClick={() =>
                  setOpenDropdown((prev) =>
                    prev === 'propertyType' ? null : 'propertyType'
                  )
                }
                aria-haspopup="listbox"
                aria-expanded={openDropdown === 'propertyType'}
                data-testid="filter-property-type-select"
                className="w-full px-3 py-2.5 rounded-xl bg-[var(--ps-bg)] border border-[var(--ps-border)] hover:border-[var(--ps-accent)]/60 text-xs font-semibold text-[var(--ps-text)] flex items-center justify-between gap-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)]"
              >
                <span className="truncate">
                  {selectedPropertyType === 'all'
                    ? 'All Property Types'
                    : PROPERTY_TYPE_LABELS[selectedPropertyType]}
                </span>
                <ChevronDown
                  className={`w-4 h-4 text-[var(--ps-text-muted)] transition-transform shrink-0 ${
                    openDropdown === 'propertyType' ? 'rotate-180' : ''
                  }`}
                />
              </button>

              {openDropdown === 'propertyType' && (
                <div
                  role="listbox"
                  aria-label="Real-Estate Property Subtype"
                  className="absolute left-0 right-0 top-full mt-1.5 max-h-56 overflow-y-auto rounded-2xl bg-[var(--ps-surface)] border border-[var(--ps-border)] shadow-2xl p-1.5 z-30 space-y-0.5"
                >
                  <button
                    type="button"
                    role="option"
                    aria-selected={selectedPropertyType === 'all'}
                    onClick={() => {
                      onSelectPropertyType('all');
                      setOpenDropdown(null);
                    }}
                    className={`w-full px-3 py-2 rounded-xl text-left font-semibold flex items-center justify-between gap-2 transition-colors ${
                      selectedPropertyType === 'all'
                        ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                        : 'text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                    }`}
                  >
                    <span>All Property Types</span>
                    {selectedPropertyType === 'all' && (
                      <Check className="w-3.5 h-3.5 shrink-0" />
                    )}
                  </button>
                  {(Object.keys(PROPERTY_TYPE_LABELS) as PropertyType[]).map(
                    (pt) => {
                      const isSel = selectedPropertyType === pt;
                      return (
                        <button
                          key={pt}
                          type="button"
                          role="option"
                          aria-selected={isSel}
                          onClick={() => {
                            onSelectPropertyType(pt);
                            setOpenDropdown(null);
                          }}
                          className={`w-full px-3 py-2 rounded-xl text-left font-semibold flex items-center justify-between gap-2 transition-colors ${
                            isSel
                              ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                              : 'text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                          }`}
                        >
                          <span className="truncate">
                            {PROPERTY_TYPE_LABELS[pt]}
                          </span>
                          {isSel && <Check className="w-3.5 h-3.5 shrink-0" />}
                        </button>
                      );
                    }
                  )}
                </div>
              )}
            </div>
          )}

          {/* 3. Locality Custom Dropdown */}
          <div
            className="space-y-2 relative"
            onClick={(e) => e.stopPropagation()}
          >
            <span className="block font-bold text-[var(--ps-text)]">
              Churachandpur Locality
            </span>
            <button
              type="button"
              onClick={() =>
                setOpenDropdown((prev) =>
                  prev === 'locality' ? null : 'locality'
                )
              }
              aria-haspopup="listbox"
              aria-expanded={openDropdown === 'locality'}
              data-testid="filter-locality-select"
              className="w-full px-3 py-2.5 rounded-xl bg-[var(--ps-bg)] border border-[var(--ps-border)] hover:border-[var(--ps-accent)]/60 text-xs font-semibold text-[var(--ps-text)] flex items-center justify-between gap-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)]"
            >
              <span className="flex items-center gap-1.5 truncate">
                <MapPin className="w-3.5 h-3.5 text-[var(--ps-accent)] shrink-0" />
                <span className="truncate">
                  {selectedLocality === 'all'
                    ? 'All Churachandpur Localities'
                    : selectedLocality}
                </span>
              </span>
              <ChevronDown
                className={`w-4 h-4 text-[var(--ps-text-muted)] transition-transform shrink-0 ${
                  openDropdown === 'locality' ? 'rotate-180' : ''
                }`}
              />
            </button>

            {openDropdown === 'locality' && (
              <div
                role="listbox"
                aria-label="Churachandpur Locality"
                className="absolute left-0 right-0 top-full mt-1.5 max-h-56 overflow-y-auto rounded-2xl bg-[var(--ps-surface)] border border-[var(--ps-border)] shadow-2xl p-1.5 z-30 space-y-0.5"
              >
                {localities.map((loc) => {
                  const isSel = selectedLocality === loc;
                  return (
                    <button
                      key={loc}
                      type="button"
                      role="option"
                      aria-selected={isSel}
                      data-testid={`filter-locality-option-${loc}`}
                      onClick={() => {
                        onSelectLocality(loc);
                        setOpenDropdown(null);
                      }}
                      className={`w-full px-3 py-2 rounded-xl text-left font-semibold flex items-center justify-between gap-2 transition-colors ${
                        isSel
                          ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                          : 'text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                      }`}
                    >
                      <span className="truncate">
                        {loc === 'all' ? 'All Churachandpur Localities' : loc}
                      </span>
                      {isSel && <Check className="w-3.5 h-3.5 shrink-0" />}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* 4. Minimum Rating */}
          <div className="space-y-2">
            <label className="block font-bold text-[var(--ps-text)]">
              Minimum Rating
            </label>
            <div className="grid grid-cols-4 gap-1.5">
              {[
                { val: 0, label: 'Any' },
                { val: 3.5, label: '3.5+' },
                { val: 4.0, label: '4.0+' },
                { val: 4.5, label: '4.5+' },
              ].map((opt) => (
                <button
                  key={opt.val}
                  type="button"
                  onClick={() => onChangeMinRating(opt.val)}
                  data-testid={`filter-rating-${opt.val}`}
                  className={`py-2 px-2 rounded-xl border font-semibold inline-flex items-center justify-center gap-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)] ${
                    minRating === opt.val
                      ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] border-[var(--ps-accent)]'
                      : 'bg-[var(--ps-bg)] text-[var(--ps-text)] border-[var(--ps-border)] hover:bg-[var(--ps-surface-alt)]'
                  }`}
                >
                  {opt.val > 0 && (
                    <Star className="w-3 h-3 fill-current text-amber-400" />
                  )}
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          </div>

          {/* 5. Price Range */}
          <div className="space-y-2">
            <label className="block font-bold text-[var(--ps-text)]">
              Sample Price Range
            </label>
            <div className="grid grid-cols-2 gap-1.5">
              {(Object.keys(PRICE_RANGE_LABELS) as PriceRangeFilterOption[]).map(
                (opt) => (
                  <button
                    key={opt}
                    type="button"
                    onClick={() => onChangePriceRangeFilter(opt)}
                    className={`px-3 py-2 rounded-xl border text-left font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)] ${
                      priceRangeFilter === opt
                        ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] border-[var(--ps-accent)]'
                        : 'bg-[var(--ps-bg)] text-[var(--ps-text)] border-[var(--ps-border)] hover:bg-[var(--ps-surface-alt)]'
                    }`}
                  >
                    {PRICE_RANGE_LABELS[opt]}
                  </button>
                )
              )}
            </div>
          </div>

          {/* 6. Listing Attributes & Availability */}
          <div className="space-y-2">
            <label className="block font-bold text-[var(--ps-text)]">
              Listing Attributes &amp; Availability
            </label>
            <div className="space-y-1.5">
              {[
                {
                  id: 'verified',
                  label: 'Verified Demo Listings Only',
                  checked: verifiedOnly,
                  onChange: onChangeVerifiedOnly,
                },
                {
                  id: 'available',
                  label: 'Currently Available / In Stock Only',
                  checked: availableOnly,
                  onChange: onChangeAvailableOnly,
                },
                {
                  id: 'has360',
                  label: 'Includes 360° Equirectangular Panorama Tour',
                  checked: has360Only,
                  onChange: onChangeHas360Only,
                },
                {
                  id: 'hasCatalogue',
                  label: 'Includes Product Catalogue',
                  checked: hasCatalogueOnly,
                  onChange: onChangeHasCatalogueOnly,
                },
              ].map((attr) => (
                <button
                  key={attr.id}
                  type="button"
                  onClick={() => attr.onChange(!attr.checked)}
                  data-testid={`filter-attr-${attr.id}`}
                  className={`w-full px-3 py-2.5 rounded-xl border text-left font-semibold flex items-center justify-between transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)] ${
                    attr.checked
                      ? 'bg-[var(--ps-surface-alt)] border-[var(--ps-accent)] text-[var(--ps-text)]'
                      : 'bg-[var(--ps-bg)] border-[var(--ps-border)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                  }`}
                >
                  <span>{attr.label}</span>
                  <span
                    className={`w-4 h-4 rounded flex items-center justify-center border shrink-0 ${
                      attr.checked
                        ? 'bg-[var(--ps-accent)] border-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                        : 'border-[var(--ps-border)]'
                    }`}
                  >
                    {attr.checked && <Check className="w-3 h-3" />}
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Footer: Clear All & Apply Filters */}
        <div className="p-4 border-t border-[var(--ps-border)] bg-[var(--ps-surface-alt)] flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onClearAll}
            className="px-4 py-2.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-bg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)]"
          >
            Clear all
          </button>
          <button
            type="button"
            onClick={onClose}
            data-testid="filter-modal-apply"
            className="flex-1 py-2.5 px-4 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-bold hover:opacity-95 shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)]"
          >
            Apply filters ({matchingCount} results)
          </button>
        </div>
      </div>
    </div>
  );
}
