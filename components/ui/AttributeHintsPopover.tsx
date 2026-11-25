'use client';

import React, { useMemo, useState } from 'react';
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronUp,
  Copy,
  Search,
  Sparkles,
  Tag,
} from 'lucide-react';
import {
  HOMEPAGE_ROUTE_OPTIONS,
  type HomepageRouteOption,
} from '@/lib/home/homepage-config';
import {
  EXPLORE_VERTICAL_PILLS,
  VERTICAL_ATTRIBUTE_CHIPS,
} from '@/lib/verticals/filter-catalog';
import type { ListingVertical } from '@/lib/verticals/types';

export interface RoutePresetOption {
  id: string;
  label: string;
  description: string;
  route_key: string;
  query_params: Record<string, string>;
  icon_key: string;
  accent_color: string;
}

export const CANONICAL_HOMEPAGE_PRESETS: RoutePresetOption[] = [
  {
    id: 'preset_print_online',
    label: 'Instant Print Shops',
    description: 'Explore verified print & digital counters accepting online uploads',
    route_key: 'explore',
    query_params: { vertical: 'print_digital', attr: 'order_online' },
    icon_key: 'printer',
    accent_color: '#2563EB',
  },
  {
    id: 'preset_pure_veg_food',
    label: 'Pure Veg Food & Cafes',
    description: 'Restaurants with pure veg filter active',
    route_key: 'explore',
    query_params: { vertical: 'restaurant_food', attr: 'pure_veg' },
    icon_key: 'utensils',
    accent_color: '#DC2626',
  },
  {
    id: 'preset_pnd_parcel',
    label: 'Pick N Drop Parcel',
    description: 'Direct map drawer in Pick N Drop parcel mode',
    route_key: 'explore',
    query_params: { mode: 'pick_n_drop', serviceType: 'parcel' },
    icon_key: 'package',
    accent_color: '#EA580C',
  },
  {
    id: 'preset_pnd_gas',
    label: 'LPG Gas Doorstep Refill',
    description: 'Pick N Drop LPG cylinder swap flow',
    route_key: 'explore',
    query_params: { mode: 'pick_n_drop', serviceType: 'gas' },
    icon_key: 'flame',
    accent_color: '#EA580C',
  },
  {
    id: 'preset_rent_homes',
    label: 'Homes for Rent',
    description: 'Real estate filtered to verified rental properties',
    route_key: 'explore',
    query_params: { vertical: 'real_estate', attr: 'for_rent' },
    icon_key: 'home',
    accent_color: '#D97706',
  },
  {
    id: 'preset_patta_land',
    label: 'Patta Verified Plots',
    description: 'Real estate filtered by patta_verified',
    route_key: 'explore',
    query_params: { vertical: 'real_estate', attr: 'patta_verified' },
    icon_key: 'shield-check',
    accent_color: '#059669',
  },
  {
    id: 'preset_turfs',
    label: 'Hourly Futsal & Turfs',
    description: 'Booking venues filtered to hourly turfs',
    route_key: 'explore',
    query_params: { vertical: 'booking_venue', attr: 'hourly_turf' },
    icon_key: 'trophy',
    accent_color: '#16A34A',
  },
  {
    id: 'preset_civic_helplines',
    label: '24×7 Civic Helplines',
    description: 'Emergency medical, police & public directory',
    route_key: 'civic',
    query_params: { tab: 'helplines' },
    icon_key: 'phone-call',
    accent_color: '#0F766E',
  },
  {
    id: 'preset_bulletin_plans',
    label: 'Bulletin Plans Modal',
    description: 'Opens Community Bulletin with subscription plans drawer',
    route_key: 'bulletin',
    query_params: { plans: '1' },
    icon_key: 'megaphone',
    accent_color: '#E11D48',
  },
];

export interface LiveCategoryHintItem {
  id?: string;
  slug: string;
  name: string;
  parent_id?: string | null;
  root_key?: string | null;
  depth?: number;
  pathLabel?: string;
}

export interface AttributeHintsPopoverProps {
  activeRouteKey?: string;
  liveCategories?: LiveCategoryHintItem[];
  onApplyPreset?: (preset: RoutePresetOption) => void;
  onInsertParam?: (key: string, value: string) => void;
  onSelectRoute?: (routeKey: string) => void;
  defaultOpen?: boolean;
}

type HintTab = 'presets' | 'routes' | 'verticals' | 'categories';

export function AttributeHintsPopover({
  activeRouteKey = 'explore',
  liveCategories = [],
  onApplyPreset,
  onInsertParam,
  onSelectRoute,
  defaultOpen = false,
}: AttributeHintsPopoverProps) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [tab, setTab] = useState<HintTab>('presets');
  const [search, setSearch] = useState('');
  const [copiedToken, setCopiedToken] = useState<string | null>(null);

  const handleCopy = async (token: string) => {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(token);
      }
      setCopiedToken(token);
      window.setTimeout(() => {
        setCopiedToken((cur) => (cur === token ? null : cur));
      }, 1800);
    } catch {
      setCopiedToken(token);
      window.setTimeout(() => {
        setCopiedToken((cur) => (cur === token ? null : cur));
      }, 1800);
    }
  };

  const q = search.trim().toLowerCase();

  const filteredRoutes = useMemo<HomepageRouteOption[]>(() => {
    if (!q) return HOMEPAGE_ROUTE_OPTIONS;
    return HOMEPAGE_ROUTE_OPTIONS.filter(
      (r) =>
        r.key.toLowerCase().includes(q) ||
        r.label.toLowerCase().includes(q) ||
        r.basePath.toLowerCase().includes(q) ||
        r.suggestedParams.some(
          (p) =>
            p.key.toLowerCase().includes(q) ||
            p.label.toLowerCase().includes(q) ||
            (p.options || []).some(
              (o) =>
                o.value.toLowerCase().includes(q) ||
                o.label.toLowerCase().includes(q)
            )
        )
    );
  }, [q]);

  const verticalEntries = useMemo(() => {
    return EXPLORE_VERTICAL_PILLS.filter((p) => p.id !== 'all')
      .map((pill) => {
        const verticalId = pill.id as ListingVertical;
        const attrs = VERTICAL_ATTRIBUTE_CHIPS[verticalId] || [];
        return {
          vertical: verticalId,
          label: pill.label,
          attrs,
        };
      })
      .filter((entry) => {
        if (!q) return true;
        return (
          entry.vertical.toLowerCase().includes(q) ||
          entry.label.toLowerCase().includes(q) ||
          entry.attrs.some(
            (a) =>
              a.key.toLowerCase().includes(q) ||
              a.label.toLowerCase().includes(q)
          )
        );
      });
  }, [q]);

  const filteredCategories = useMemo(() => {
    if (!q) return liveCategories.slice(0, 80);
    return liveCategories
      .filter(
        (c) =>
          c.slug.toLowerCase().includes(q) ||
          c.name.toLowerCase().includes(q) ||
          (c.root_key || '').toLowerCase().includes(q) ||
          (c.pathLabel || '').toLowerCase().includes(q)
      )
      .slice(0, 80);
  }, [liveCategories, q]);

  const filteredPresets = useMemo(() => {
    if (!q) return CANONICAL_HOMEPAGE_PRESETS;
    return CANONICAL_HOMEPAGE_PRESETS.filter(
      (p) =>
        p.label.toLowerCase().includes(q) ||
        p.description.toLowerCase().includes(q) ||
        p.route_key.toLowerCase().includes(q) ||
        JSON.stringify(p.query_params).toLowerCase().includes(q)
    );
  }, [q]);

  const CopyChip = ({
    token,
    label,
    onQuickApply,
  }: {
    token: string;
    label?: string;
    onQuickApply?: () => void;
  }) => {
    const isCopied = copiedToken === token;
    return (
      <div className="inline-flex items-center overflow-hidden rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[11px]">
        {onQuickApply ? (
          <button
            type="button"
            onClick={onQuickApply}
            title={`Apply ${token}`}
            className="min-h-[34px] px-2.5 font-mono font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-accent)]/10 hover:text-[var(--ps-accent)] transition-colors cursor-pointer"
          >
            {label ? `${label} · ${token}` : token}
          </button>
        ) : (
          <span className="px-2.5 py-1.5 font-mono font-semibold text-[var(--ps-text)]">
            {label ? `${label} · ${token}` : token}
          </span>
        )}
        <button
          type="button"
          onClick={() => void handleCopy(token)}
          aria-label={`Copy ${token}`}
          title={isCopied ? 'Copied!' : `Copy "${token}"`}
          className={`flex min-h-[34px] min-w-[34px] items-center justify-center border-l border-[var(--ps-border)] px-2 transition-colors cursor-pointer ${
            isCopied
              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
              : 'text-[var(--ps-text-muted)] hover:bg-[var(--ps-bg)] hover:text-[var(--ps-text)]'
          }`}
        >
          {isCopied ? (
            <span className="inline-flex items-center gap-1 text-[10px] font-bold">
              <Check className="h-3 w-3" />
              <span>Copied</span>
            </span>
          ) : (
            <Copy className="h-3 w-3" />
          )}
        </button>
      </div>
    );
  };

  return (
    <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)]">
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        aria-expanded={isOpen}
        className="flex min-h-[44px] w-full items-center justify-between gap-2 px-3.5 py-2 text-left text-xs font-semibold text-[var(--ps-text)] transition-colors hover:bg-[var(--ps-surface-alt)]/60 cursor-pointer"
      >
        <span className="inline-flex items-center gap-2 min-w-0">
          <BookOpen className="h-4 w-4 shrink-0 text-[var(--ps-accent)]" />
          <span className="truncate">
            Route &amp; Attribute Hints (Copy Keys or Apply Preset)
          </span>
        </span>
        {isOpen ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-[var(--ps-text-muted)]" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-[var(--ps-text-muted)]" />
        )}
      </button>

      {isOpen && (
        <div className="border-t border-[var(--ps-border)] p-3 space-y-3">
          {/* Tabs + Search */}
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-1 overflow-x-auto no-scrollbar rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-1">
              {(
                [
                  { id: 'presets', label: 'Presets' },
                  { id: 'routes', label: 'Routes & Params' },
                  { id: 'verticals', label: 'Verticals & Attrs' },
                  {
                    id: 'categories',
                    label: `Categories (${liveCategories.length})`,
                  },
                ] as Array<{ id: HintTab; label: string }>
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setTab(t.id)}
                  className={`min-h-[36px] shrink-0 rounded-lg px-2.5 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                    tab === t.id
                      ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                      : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            <div className="relative sm:w-52">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ps-text-muted)]" />
              <input
                type="text"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Filter keys or values…"
                className="h-9 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] pl-8 pr-2.5 text-xs text-[var(--ps-text)] outline-none focus:border-[var(--ps-accent)]"
              />
            </div>
          </div>

          {/* Tab 1: Presets */}
          {tab === 'presets' && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 max-h-56 overflow-y-auto pr-0.5">
              {filteredPresets.map((preset) => (
                <div
                  key={preset.id}
                  className="flex items-center justify-between gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-2.5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-xs font-bold text-[var(--ps-text)]">
                      {preset.label}
                    </p>
                    <p className="truncate text-[11px] text-[var(--ps-text-muted)]">
                      {preset.description}
                    </p>
                    <p className="mt-1 truncate font-mono text-[10px] text-[var(--ps-accent)]">
                      {preset.route_key} ·{' '}
                      {Object.entries(preset.query_params)
                        .map(([k, v]) => `${k}=${v}`)
                        .join('&')}
                    </p>
                  </div>
                  {onApplyPreset && (
                    <button
                      type="button"
                      onClick={() => onApplyPreset(preset)}
                      className="inline-flex min-h-[36px] shrink-0 items-center gap-1 rounded-lg border border-[var(--ps-accent)]/40 bg-[var(--ps-accent)]/10 px-2.5 text-[11px] font-bold text-[var(--ps-accent)] hover:bg-[var(--ps-accent)] hover:text-[var(--ps-accent-fg)] transition-colors cursor-pointer"
                    >
                      <Sparkles className="h-3 w-3" />
                      <span>Apply</span>
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Tab 2: Routes & Allowed Query Parameters */}
          {tab === 'routes' && (
            <div className="space-y-2.5 max-h-60 overflow-y-auto pr-0.5">
              {filteredRoutes.map((route) => {
                const isCurrent = route.key === activeRouteKey;
                return (
                  <div
                    key={route.key}
                    className={`rounded-xl border p-2.5 space-y-2 ${
                      isCurrent
                        ? 'border-[var(--ps-accent)]/50 bg-[var(--ps-accent)]/5'
                        : 'border-[var(--ps-border)] bg-[var(--ps-surface)]'
                    }`}
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0">
                        <span className="text-xs font-bold text-[var(--ps-text)]">
                          {route.label}
                        </span>
                        {isCurrent && (
                          <span className="ml-2 text-[10px] font-semibold text-[var(--ps-accent)]">
                            · Selected
                          </span>
                        )}
                      </div>
                      <CopyChip
                        token={route.key}
                        onQuickApply={
                          onSelectRoute ? () => onSelectRoute(route.key) : undefined
                        }
                      />
                    </div>

                    {route.suggestedParams.length > 0 && (
                      <div className="space-y-1.5 pt-1 border-t border-[var(--ps-border)]/70">
                        {route.suggestedParams.map((param) => (
                          <div
                            key={`${route.key}-${param.key}`}
                            className="flex flex-wrap items-center gap-1.5"
                          >
                            <span className="text-[10px] font-semibold text-[var(--ps-text-muted)] min-w-[76px]">
                              {param.label}:
                            </span>
                            <CopyChip token={param.key} />
                            {(param.options || []).map((opt) => (
                              <CopyChip
                                key={opt.value}
                                token={opt.value}
                                onQuickApply={
                                  onInsertParam
                                    ? () => {
                                        onSelectRoute?.(route.key);
                                        onInsertParam(param.key, opt.value);
                                      }
                                    : undefined
                                }
                              />
                            ))}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Tab 3: Verticals (8 Fixed Level-1 root_keys) & Registered Attr Keys */}
          {tab === 'verticals' && (
            <div className="space-y-2.5 max-h-60 overflow-y-auto pr-0.5">
              <p className="text-[11px] text-[var(--ps-text-muted)]">
                Fixed Level-1 System Root keys (<code className="font-mono">vertical=&lt;root_key&gt;</code>) and vertical attribute chips (<code className="font-mono">attr=&lt;key&gt;</code>):
              </p>
              {verticalEntries.map((entry) => (
                <div
                  key={entry.vertical}
                  className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-2.5 space-y-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex items-center gap-1.5">
                      <span className="rounded bg-[var(--ps-accent)]/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-[var(--ps-accent)]">
                        L1 Root
                      </span>
                      <span className="text-xs font-bold text-[var(--ps-text)]">
                        {entry.label}
                      </span>
                    </div>
                    <CopyChip
                      token={entry.vertical}
                      label="root_key"
                      onQuickApply={
                        onInsertParam
                          ? () => {
                              onSelectRoute?.('explore');
                              onInsertParam('vertical', entry.vertical);
                            }
                          : undefined
                      }
                    />
                  </div>
                  {entry.attrs.length > 0 && (
                    <div className="flex flex-wrap items-center gap-1.5 pt-1 border-t border-[var(--ps-border)]/70">
                      <span className="text-[10px] font-semibold text-[var(--ps-text-muted)]">
                        attr:
                      </span>
                      {entry.attrs.map((attr) => (
                        <CopyChip
                          key={attr.key}
                          token={attr.key}
                          onQuickApply={
                            onInsertParam
                              ? () => {
                                  onSelectRoute?.('explore');
                                  onInsertParam('vertical', entry.vertical);
                                  onInsertParam('attr', attr.key);
                                }
                              : undefined
                          }
                        />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* Tab 4: Live L1/L2/L3 Category Presets from DB */}
          {tab === 'categories' && (
            <div className="max-h-56 overflow-y-auto pr-0.5 space-y-2">
              <p className="text-[11px] text-[var(--ps-text-muted)]">
                1-click copy or apply live Level-2 &amp; Level-3 category slugs (<code className="font-mono">sub=&lt;slug&gt;</code>) anchored to their parent <code className="font-mono">root_key</code>:
              </p>
              {filteredCategories.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 text-center text-xs text-[var(--ps-text-muted)]">
                  <Tag className="mx-auto mb-1.5 h-4 w-4 opacity-60" />
                  No matching live category slugs found.
                </div>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {filteredCategories.map((cat) => {
                    const levelBadge = cat.depth ? `L${cat.depth}` : cat.parent_id ? 'L2' : 'L1';
                    const displayLabel = cat.pathLabel
                      ? `${levelBadge} · ${cat.pathLabel}`
                      : `${levelBadge} · ${cat.name}`;
                    return (
                      <CopyChip
                        key={`${cat.id || cat.slug}-${cat.root_key || 'root'}`}
                        token={cat.slug}
                        label={displayLabel}
                        onQuickApply={
                          onInsertParam
                            ? () => {
                                onSelectRoute?.('explore');
                                if (cat.root_key) {
                                  onInsertParam('vertical', cat.root_key);
                                }
                                onInsertParam('sub', cat.slug);
                              }
                            : undefined
                        }
                      />
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default AttributeHintsPopover;
