'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import {
  ACCENT_COLOR_SWATCHES,
  getIconItemByKey,
  ICON_CATEGORIES,
  ICON_REGISTRY,
  normalizeIconKey,
  type IconCategoryId,
} from '@/lib/icons/registry';

export interface IconPickerProps {
  value?: string | null;
  onChange: (iconKey: string) => void;
  accentColor?: string | null;
  onAccentColorChange?: (hex: string) => void;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  testId?: string;
}

export function IconPicker({
  value,
  onChange,
  accentColor,
  onAccentColorChange,
  label,
  placeholder = 'Choose icon',
  disabled = false,
  className = '',
  testId,
}: IconPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [activeCategory, setActiveCategory] = useState<IconCategoryId | 'all'>(
    'all'
  );
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const selectedItem = useMemo(() => getIconItemByKey(value), [value]);
  const SelectedIcon = selectedItem.icon;
  const resolvedColor =
    accentColor && /^#[0-9a-fA-F]{3,8}$/.test(accentColor.trim())
      ? accentColor.trim()
      : '#2563EB';

  const filteredIcons = useMemo(() => {
    const q = search.trim().toLowerCase();
    return ICON_REGISTRY.filter((item) => {
      if (activeCategory !== 'all' && item.category !== activeCategory) {
        return false;
      }
      if (!q) return true;
      return (
        item.key.includes(q) ||
        item.label.toLowerCase().includes(q) ||
        item.keywords.some((kw) => kw.includes(q))
      );
    });
  }, [search, activeCategory]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    const timer = window.setTimeout(() => {
      searchInputRef.current?.focus();
    }, 30);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.clearTimeout(timer);
    };
  }, [isOpen]);

  const normalizedValue = normalizeIconKey(value);

  return (
    <div className={`w-full ${className}`}>
      {label && (
        <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-[var(--ps-text-muted)]">
          {label}
        </span>
      )}

      <button
        type="button"
        disabled={disabled}
        data-testid={testId}
        onClick={() => !disabled && setIsOpen(true)}
        className="flex min-h-[44px] w-full items-center justify-between gap-2.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 py-2 text-left text-xs transition hover:border-[var(--ps-accent)]/60 disabled:cursor-not-allowed disabled:opacity-55 cursor-pointer"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <span
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white"
            style={{ backgroundColor: resolvedColor }}
          >
            <SelectedIcon className="h-4 w-4" />
          </span>
          <span className="min-w-0">
            <span className="block truncate font-semibold text-[var(--ps-text)]">
              {selectedItem.label || placeholder}
            </span>
            <span className="block truncate font-mono text-[10px] text-[var(--ps-text-muted)]">
              {selectedItem.key}
              {onAccentColorChange ? ` · ${resolvedColor}` : ''}
            </span>
          </span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 text-[var(--ps-text-muted)]" />
      </button>

      {isOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-3 sm:p-4 backdrop-blur-[2px]"
          role="dialog"
          aria-modal="true"
          aria-label="Select icon"
          onClick={() => setIsOpen(false)}
        >
          <div
            className="flex max-h-[88vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-3 border-b border-[var(--ps-border)] px-4 py-3">
              <div className="flex min-w-0 items-center gap-2.5">
                <span
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-white"
                  style={{ backgroundColor: resolvedColor }}
                >
                  <SelectedIcon className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-bold text-[var(--ps-text)]">
                    Select Curated Icon
                  </h3>
                  <p className="truncate text-[11px] text-[var(--ps-text-muted)]">
                    {ICON_REGISTRY.length} district-curated Lucide icons ·{' '}
                    <code className="font-mono">{selectedItem.key}</code>
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                aria-label="Close icon picker"
                className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--ps-border)] text-[var(--ps-text-muted)] hover:bg-[var(--ps-surface-alt)] hover:text-[var(--ps-text)] cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            {/* Search + Category Filters */}
            <div className="space-y-2.5 border-b border-[var(--ps-border)] bg-[var(--ps-bg)] px-4 py-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ps-text-muted)]" />
                <input
                  ref={searchInputRef}
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search icons by name or use case (e.g. hospital, truck, bakery, lamka)…"
                  className="h-11 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] pl-9 pr-9 text-xs text-[var(--ps-text)] outline-none focus:border-[var(--ps-accent)]"
                />
                {search && (
                  <button
                    type="button"
                    onClick={() => setSearch('')}
                    aria-label="Clear icon search"
                    className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-[var(--ps-text-muted)] hover:bg-[var(--ps-surface-alt)]"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
                <button
                  type="button"
                  onClick={() => setActiveCategory('all')}
                  className={`inline-flex min-h-[36px] shrink-0 items-center rounded-lg px-3 text-xs font-semibold transition cursor-pointer ${
                    activeCategory === 'all'
                      ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                      : 'border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                  }`}
                >
                  All ({ICON_REGISTRY.length})
                </button>
                {ICON_CATEGORIES.map((cat) => {
                  const active = activeCategory === cat.id;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setActiveCategory(cat.id)}
                      className={`inline-flex min-h-[36px] shrink-0 items-center rounded-lg px-3 text-xs font-semibold transition cursor-pointer ${
                        active
                          ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                          : 'border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                      }`}
                    >
                      {cat.label}
                    </button>
                  );
                })}
              </div>

              {/* Optional Accent Color Swatches */}
              {onAccentColorChange && (
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <span className="text-[11px] font-semibold text-[var(--ps-text-muted)]">
                    Accent:
                  </span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {ACCENT_COLOR_SWATCHES.map((swatch) => {
                      const active =
                        resolvedColor.toLowerCase() ===
                        swatch.hex.toLowerCase();
                      return (
                        <button
                          key={swatch.hex}
                          type="button"
                          title={swatch.label}
                          aria-label={`Set accent color ${swatch.label}`}
                          onClick={() => onAccentColorChange(swatch.hex)}
                          style={{ backgroundColor: swatch.hex }}
                          className={`flex h-7 w-7 items-center justify-center rounded-full border transition cursor-pointer ${
                            active
                              ? 'scale-105 border-white ring-2 ring-[var(--ps-accent)]'
                              : 'border-black/15 opacity-90 hover:opacity-100'
                          }`}
                        >
                          {active && <Check className="h-3.5 w-3.5 text-white" />}
                        </button>
                      );
                    })}
                  </div>
                  <input
                    type="text"
                    value={accentColor || resolvedColor}
                    onChange={(e) => onAccentColorChange(e.target.value)}
                    aria-label="Custom hex color"
                    className="h-8 w-24 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2 font-mono text-[11px] text-[var(--ps-text)]"
                  />
                </div>
              )}
            </div>

            {/* Icon Grid */}
            <div className="flex-1 overflow-y-auto p-4">
              {filteredIcons.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-bg)] p-8 text-center text-xs text-[var(--ps-text-muted)]">
                  No icons match &ldquo;{search}&rdquo;. Try a broader keyword or clear filters.
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                  {filteredIcons.map((item) => {
                    const IconComp = item.icon;
                    const isSelected = item.key === normalizedValue;
                    return (
                      <button
                        key={item.key}
                        type="button"
                        onClick={() => {
                          onChange(item.key);
                          setIsOpen(false);
                        }}
                        className={`flex min-h-[72px] flex-col items-center justify-center gap-1.5 rounded-xl border p-2 text-center transition cursor-pointer ${
                          isSelected
                            ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)]/10 text-[var(--ps-text)]'
                            : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:border-[var(--ps-accent)]/50 hover:text-[var(--ps-text)]'
                        }`}
                      >
                        <span
                          className="flex h-8 w-8 items-center justify-center rounded-lg"
                          style={
                            isSelected
                              ? { backgroundColor: resolvedColor, color: '#FFFFFF' }
                              : undefined
                          }
                        >
                          <IconComp className="h-4 w-4" />
                        </span>
                        <span className="line-clamp-1 w-full text-[11px] font-medium">
                          {item.label}
                        </span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between gap-2 border-t border-[var(--ps-border)] bg-[var(--ps-bg)] px-4 py-2.5 text-[11px] text-[var(--ps-text-muted)]">
              <span>
                Showing <strong className="font-mono tabular-nums text-[var(--ps-text)]">{filteredIcons.length}</strong> of{' '}
                <span className="font-mono tabular-nums">{ICON_REGISTRY.length}</span> icons
              </span>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="inline-flex min-h-[36px] items-center rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] cursor-pointer"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default IconPicker;
