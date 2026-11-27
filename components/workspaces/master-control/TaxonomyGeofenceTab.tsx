'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Compass,
  FolderTree,
  Loader2,
  MapPin,
  Plus,
  RefreshCw,
  Save,
  Search,
  X,
} from 'lucide-react';
import { setAppStatus } from '@/lib/hooks/useAppStatus';
import { MapCoordinatePicker } from '@/components/maps/MapCoordinatePicker';
import { CHURACHANDPUR_FALLBACK_CENTER } from '@/lib/maps/coordinates';
import { supabase } from '@/lib/supabase/client';
import {
  normalizeOperationsConfig,
  type AppCategoryModule,
  type AppCategoryRecord,
  type AppLocalityRecord,
  type OperationsConfig,
} from '@/lib/config/types';
import type { MasterControlTabSharedProps } from './PaymentsGatewayTab';

interface TaxonomyGeofenceTabProps extends MasterControlTabSharedProps {
  initialOperations: OperationsConfig;
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 48);
}

export function TaxonomyGeofenceTab({
  initialOperations,
  onSavePlatformSetting,
  onNotify,
  refreshGlobalConfig,
}: TaxonomyGeofenceTabProps) {
  const [opsForm, setOpsForm] = useState<OperationsConfig>(() =>
    normalizeOperationsConfig(initialOperations)
  );
  const [categories, setCategories] = useState<AppCategoryRecord[]>([]);
  const [localities, setLocalities] = useState<AppLocalityRecord[]>([]);
  const [catModuleFilter, setCatModuleFilter] =
    useState<AppCategoryModule>('explore');
  const [isLoading, setIsLoading] = useState(true);
  const [savingKey, setSavingKey] = useState<string | null>(null);

  // Add new category form
  const [newCatName, setNewCatName] = useState('');
  const [newCatIcon, setNewCatIcon] = useState('Store');
  const [newCatColor, setNewCatColor] = useState('#0284c7');
  const [newCatSort, setNewCatSort] = useState(100);

  // Add new locality form
  const [newLocName, setNewLocName] = useState('');
  const [newLocLat, setNewLocLat] = useState('24.3333');
  const [newLocLng, setNewLocLng] = useState('93.6833');
  const [newLocSort, setNewLocSort] = useState(100);
  const [showNewLocMapPicker, setShowNewLocMapPicker] = useState(false);
  const [editingLocSlug, setEditingLocSlug] = useState<string | null>(null);

  // Chip quick-add inputs for Operations arrays
  const [placeholderInput, setPlaceholderInput] = useState('');
  const [trendingInput, setTrendingInput] = useState('');
  const [prohibitedInput, setProhibitedInput] = useState('');

  useEffect(() => {
    queueMicrotask(() => {
      setOpsForm(normalizeOperationsConfig(initialOperations));
    });
  }, [initialOperations]);

  const loadTaxonomy = useCallback(async () => {
    setIsLoading(true);
    try {
      const [catsRes, locsRes] = await Promise.all([
        supabase
          .from('app_categories')
          .select('*')
          .order('module', { ascending: true })
          .order('sort_order', { ascending: true }),
        supabase
          .from('app_localities')
          .select('*')
          .order('sort_order', { ascending: true }),
      ]);
      if (catsRes.error) throw new Error(catsRes.error.message);
      if (locsRes.error) throw new Error(locsRes.error.message);
      setCategories((catsRes.data || []) as AppCategoryRecord[]);
      setLocalities((locsRes.data || []) as AppLocalityRecord[]);
    } catch (err) {
      onNotify?.({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to load taxonomy.',
      });
    } finally {
      setIsLoading(false);
    }
  }, [onNotify]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadTaxonomy();
    });
  }, [loadTaxonomy]);

  const filteredCategories = useMemo(
    () => categories.filter((c) => c.module === catModuleFilter),
    [categories, catModuleFilter]
  );

  const handleAddCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    const displayName = newCatName.trim();
    const slug = slugify(displayName);
    if (!displayName || !slug) return;

    setSavingKey('add-cat');
    setAppStatus('saving', 'Adding category…');
    try {
      const { error } = await supabase.from('app_categories').insert({
        slug,
        module: catModuleFilter,
        display_name: displayName,
        icon: newCatIcon.trim() || 'Store',
        color_hex: newCatColor || '#0284c7',
        sort_order: Number(newCatSort) || 100,
        is_active: true,
        updated_at: new Date().toISOString(),
      });
      if (error) throw new Error(error.message);

      setNewCatName('');
      await loadTaxonomy();
      await refreshGlobalConfig();
      setAppStatus('success', 'Category added');
      onNotify?.({
        type: 'success',
        text: `Added category "${displayName}" (${slug}) under ${catModuleFilter}.`,
      });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Could not add category.';
      setAppStatus('error', 'Add category failed');
      onNotify?.({ type: 'error', text: msg });
    } finally {
      setSavingKey(null);
    }
  };

  const handleSaveCategory = async (cat: AppCategoryRecord) => {
    setSavingKey(`cat:${cat.slug}`);
    setAppStatus('saving', `Saving ${cat.display_name}…`);
    try {
      const { error } = await supabase
        .from('app_categories')
        .update({
          display_name: cat.display_name.trim() || cat.slug,
          icon: cat.icon.trim() || 'Store',
          color_hex: cat.color_hex.trim() || '#0284c7',
          sort_order: Number(cat.sort_order) || 0,
          is_active: Boolean(cat.is_active),
          updated_at: new Date().toISOString(),
        })
        .eq('slug', cat.slug);
      if (error) throw new Error(error.message);

      await refreshGlobalConfig();
      setAppStatus('success', 'Category saved');
      onNotify?.({
        type: 'success',
        text: `Updated category "${cat.display_name}".`,
      });
    } catch (err) {
      setAppStatus('error', 'Save failed');
      onNotify?.({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to save category.',
      });
    } finally {
      setSavingKey(null);
    }
  };

  const handleAddLocality = async (e: React.FormEvent) => {
    e.preventDefault();
    const displayName = newLocName.trim();
    const slug = slugify(displayName);
    if (!displayName || !slug) return;

    setSavingKey('add-loc');
    setAppStatus('saving', 'Adding locality…');
    try {
      const { error } = await supabase.from('app_localities').insert({
        slug,
        display_name: displayName,
        lat: Number(newLocLat) || 24.3333,
        lng: Number(newLocLng) || 93.6833,
        sort_order: Number(newLocSort) || 100,
        is_active: true,
        updated_at: new Date().toISOString(),
      });
      if (error) throw new Error(error.message);

      setNewLocName('');
      await loadTaxonomy();
      await refreshGlobalConfig();
      setAppStatus('success', 'Locality added');
      onNotify?.({
        type: 'success',
        text: `Added locality "${displayName}".`,
      });
    } catch (err) {
      setAppStatus('error', 'Add locality failed');
      onNotify?.({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to add locality.',
      });
    } finally {
      setSavingKey(null);
    }
  };

  const handleSaveLocality = async (loc: AppLocalityRecord) => {
    setSavingKey(`loc:${loc.slug}`);
    setAppStatus('saving', `Saving ${loc.display_name}…`);
    try {
      const { error } = await supabase
        .from('app_localities')
        .update({
          display_name: loc.display_name.trim() || loc.slug,
          lat: Number(loc.lat) || 24.3333,
          lng: Number(loc.lng) || 93.6833,
          sort_order: Number(loc.sort_order) || 0,
          is_active: Boolean(loc.is_active),
          updated_at: new Date().toISOString(),
        })
        .eq('slug', loc.slug);
      if (error) throw new Error(error.message);

      await refreshGlobalConfig();
      setAppStatus('success', 'Locality saved');
      onNotify?.({
        type: 'success',
        text: `Updated locality "${loc.display_name}".`,
      });
    } catch (err) {
      setAppStatus('error', 'Save failed');
      onNotify?.({
        type: 'error',
        text: err instanceof Error ? err.message : 'Failed to save locality.',
      });
    } finally {
      setSavingKey(null);
    }
  };

  const handleSaveSearchAndGeofence = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingKey('ops-geo');
    const normalized = normalizeOperationsConfig(opsForm);
    setOpsForm(normalized);
    await onSavePlatformSetting(
      'operations_config',
      normalized,
      'Search placeholders, trending suggestions, prohibited items, and geofence saved.'
    );
    setSavingKey(null);
  };

  const appendChip = (
    field: 'search_placeholders' | 'trending_suggestions' | 'prohibited_items',
    raw: string,
    clearFn: (v: string) => void
  ) => {
    const val = raw.trim();
    if (!val) return;
    setOpsForm((prev) => ({
      ...prev,
      [field]: prev[field].includes(val) ? prev[field] : [...prev[field], val],
    }));
    clearFn('');
  };

  const removeChip = (
    field: 'search_placeholders' | 'trending_suggestions' | 'prohibited_items',
    idx: number
  ) => {
    setOpsForm((prev) => ({
      ...prev,
      [field]: prev[field].filter((_, i) => i !== idx),
    }));
  };

  return (
    <div className="space-y-4">
      {/* 1. Categories Manager (app_categories) */}
      <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <FolderTree className="w-4 h-4 text-[var(--ps-accent)]" />
            <h3 className="text-sm font-bold text-[var(--ps-text)]">
              Categories Manager ({filteredCategories.length})
            </h3>
          </div>
          <div className="flex items-center gap-1.5">
            {(['explore', 'marketplace', 'bulletin'] as const).map((mod) => (
              <button
                key={mod}
                type="button"
                onClick={() => setCatModuleFilter(mod)}
                className={`h-7 px-2.5 rounded-lg text-[11px] font-bold capitalize border transition-colors ${
                  catModuleFilter === mod
                    ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] border-[var(--ps-accent)]'
                    : 'bg-[var(--ps-bg)] text-[var(--ps-text-muted)] border-[var(--ps-border)]'
                }`}
              >
                {mod}
              </button>
            ))}
            <button
              type="button"
              onClick={() => void loadTaxonomy()}
              aria-label="Reload taxonomy"
              className="h-7 w-7 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] inline-flex items-center justify-center text-[var(--ps-text-muted)]"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Add Category Strip */}
        <form
          onSubmit={handleAddCategory}
          className="grid grid-cols-1 sm:grid-cols-12 gap-2 p-2.5 rounded-xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-bg)]"
        >
          <input
            type="text"
            value={newCatName}
            onChange={(e) => setNewCatName(e.target.value)}
            placeholder={`New ${catModuleFilter} category name…`}
            className="sm:col-span-4 h-8 px-2.5 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] text-xs text-[var(--ps-text)]"
          />
          <input
            type="text"
            value={newCatIcon}
            onChange={(e) => setNewCatIcon(e.target.value)}
            placeholder="Lucide icon (e.g. Store)"
            className="sm:col-span-3 h-8 px-2.5 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] text-xs font-mono text-[var(--ps-text)]"
          />
          <div className="sm:col-span-2 flex items-center gap-1.5">
            <input
              type="color"
              value={newCatColor}
              onChange={(e) => setNewCatColor(e.target.value)}
              className="h-8 w-9 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] p-0.5 cursor-pointer"
            />
            <input
              type="number"
              value={newCatSort}
              onChange={(e) => setNewCatSort(Number(e.target.value) || 0)}
              title="Sort order"
              className="w-full h-8 px-2 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] text-xs tabular-nums"
            />
          </div>
          <button
            type="submit"
            disabled={!newCatName.trim() || savingKey === 'add-cat'}
            className="sm:col-span-3 h-8 px-3 rounded-lg bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-bold inline-flex items-center justify-center gap-1 disabled:opacity-50"
          >
            {savingKey === 'add-cat' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Plus className="w-3.5 h-3.5" />
            )}
            <span>Add Category</span>
          </button>
        </form>

        {isLoading ? (
          <div className="py-6 text-center text-xs text-[var(--ps-text-muted)]">
            Loading categories…
          </div>
        ) : (
          <div className="space-y-2 max-h-80 overflow-y-auto pr-1">
            {filteredCategories.map((cat) => (
              <div
                key={cat.slug}
                className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-2"
              >
                <div className="sm:col-span-2 font-mono text-[10px] text-[var(--ps-text-muted)] truncate px-1">
                  {cat.slug}
                </div>
                <input
                  type="text"
                  value={cat.display_name}
                  onChange={(e) =>
                    setCategories((prev) =>
                      prev.map((c) =>
                        c.slug === cat.slug
                          ? { ...c, display_name: e.target.value }
                          : c
                      )
                    )
                  }
                  className="sm:col-span-3 h-8 px-2 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] text-xs"
                />
                <input
                  type="text"
                  value={cat.icon}
                  onChange={(e) =>
                    setCategories((prev) =>
                      prev.map((c) =>
                        c.slug === cat.slug ? { ...c, icon: e.target.value } : c
                      )
                    )
                  }
                  className="sm:col-span-2 h-8 px-2 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] text-xs font-mono"
                />
                <div className="sm:col-span-2 flex items-center gap-1.5">
                  <input
                    type="color"
                    value={cat.color_hex || '#0284c7'}
                    onChange={(e) =>
                      setCategories((prev) =>
                        prev.map((c) =>
                          c.slug === cat.slug
                            ? { ...c, color_hex: e.target.value }
                            : c
                        )
                      )
                    }
                    className="h-8 w-8 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] p-0.5 cursor-pointer shrink-0"
                  />
                  <input
                    type="number"
                    value={cat.sort_order}
                    onChange={(e) =>
                      setCategories((prev) =>
                        prev.map((c) =>
                          c.slug === cat.slug
                            ? { ...c, sort_order: Number(e.target.value) || 0 }
                            : c
                        )
                      )
                    }
                    className="w-full h-8 px-2 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] text-xs tabular-nums"
                  />
                </div>
                <div className="sm:col-span-3 flex items-center justify-end gap-1.5">
                  <button
                    type="button"
                    onClick={() =>
                      setCategories((prev) =>
                        prev.map((c) =>
                          c.slug === cat.slug
                            ? { ...c, is_active: !c.is_active }
                            : c
                        )
                      )
                    }
                    className={`h-8 px-2.5 rounded-lg text-[11px] font-bold border ${
                      cat.is_active
                        ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-700 dark:text-emerald-300'
                        : 'bg-[var(--ps-surface)] border-[var(--ps-border)] text-[var(--ps-text-muted)]'
                    }`}
                  >
                    {cat.is_active ? 'Active' : 'Hidden'}
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleSaveCategory(cat)}
                    disabled={savingKey === `cat:${cat.slug}`}
                    className="h-8 px-2.5 rounded-lg bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-bold inline-flex items-center gap-1 disabled:opacity-60"
                  >
                    {savingKey === `cat:${cat.slug}` ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <Save className="w-3 h-3" />
                    )}
                    <span>Save</span>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* 2. Localities Manager (app_localities) */}
      <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3">
        <div className="flex items-center gap-1.5">
          <MapPin className="w-4 h-4 text-[var(--ps-accent)]" />
          <h3 className="text-sm font-bold text-[var(--ps-text)]">
            Localities Manager ({localities.length})
          </h3>
        </div>

        <form
          onSubmit={handleAddLocality}
          className="space-y-3 p-3 rounded-xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-bg)]"
        >
          <div className="grid grid-cols-1 sm:grid-cols-12 gap-2">
            <input
              type="text"
              value={newLocName}
              onChange={(e) => setNewLocName(e.target.value)}
              placeholder="Locality name (e.g., Bungmual)"
              className="sm:col-span-4 min-h-[44px] px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-xs"
            />
            <button
              type="button"
              onClick={() => setShowNewLocMapPicker((p) => !p)}
              className="sm:col-span-4 min-h-[44px] px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-xs font-semibold text-[var(--ps-text)] inline-flex items-center justify-center gap-1.5 hover:border-[var(--ps-accent)] cursor-pointer"
            >
              <MapPin className="w-3.5 h-3.5 text-[var(--ps-accent)]" />
              <span className="font-mono">
                {newLocLat && newLocLng
                  ? `${Number(newLocLat).toFixed(4)}, ${Number(newLocLng).toFixed(4)}`
                  : 'Pick Pin on Map'}
              </span>
            </button>
            <input
              type="number"
              value={newLocSort}
              onChange={(e) => setNewLocSort(Number(e.target.value) || 0)}
              placeholder="Sort"
              className="sm:col-span-1 min-h-[44px] px-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-xs tabular-nums"
            />
            <button
              type="submit"
              disabled={!newLocName.trim() || savingKey === 'add-loc'}
              className="sm:col-span-3 min-h-[44px] px-3 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-bold inline-flex items-center justify-center gap-1 disabled:opacity-50 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Locality</span>
            </button>
          </div>
          {showNewLocMapPicker && (
            <MapCoordinatePicker
              mode="point"
              label="New Locality Coordinates"
              coordinates={{
                lat: Number.isFinite(Number.parseFloat(newLocLat))
                  ? Number.parseFloat(newLocLat)
                  : CHURACHANDPUR_FALLBACK_CENTER.lat,
                lng: Number.isFinite(Number.parseFloat(newLocLng))
                  ? Number.parseFloat(newLocLng)
                  : CHURACHANDPUR_FALLBACK_CENTER.lng,
              }}
              onChangeCoordinates={(next) => {
                setNewLocLat(next.lat.toFixed(6));
                setNewLocLng(next.lng.toFixed(6));
              }}
            />
          )}
        </form>

        <div className="space-y-2 max-h-72 overflow-y-auto pr-1">
          {localities.map((loc) => (
            <div
              key={loc.slug}
              className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-2"
            >
              <input
                type="text"
                value={loc.display_name}
                onChange={(e) =>
                  setLocalities((prev) =>
                    prev.map((l) =>
                      l.slug === loc.slug
                        ? { ...l, display_name: e.target.value }
                        : l
                    )
                  )
                }
                className="sm:col-span-4 h-8 px-2 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] text-xs font-semibold"
              />
              <div className="sm:col-span-4 flex items-center justify-between gap-2 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 py-1.5 text-[11px]">
                <span className="font-mono text-[var(--ps-text-muted)] truncate">
                  {Number(loc.lat || 0).toFixed(5)}, {Number(loc.lng || 0).toFixed(5)}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setEditingLocSlug((prev) =>
                      prev === loc.slug ? null : loc.slug
                    )
                  }
                  className="inline-flex min-h-[28px] shrink-0 items-center gap-1 rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 text-[11px] font-semibold text-theme-primary hover:bg-[var(--ps-surface-alt)]"
                >
                  <MapPin className="h-3 w-3" />
                  <span>{editingLocSlug === loc.slug ? 'Hide Map' : 'Pick on Map'}</span>
                </button>
              </div>
              {editingLocSlug === loc.slug && (
                <div className="sm:col-span-12 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-2.5">
                  <MapCoordinatePicker
                    mode="point"
                    coordinates={{
                      lat: Number(loc.lat) || CHURACHANDPUR_FALLBACK_CENTER.lat,
                      lng: Number(loc.lng) || CHURACHANDPUR_FALLBACK_CENTER.lng,
                    }}
                    onChangeCoordinates={(pt) =>
                      setLocalities((prev) =>
                        prev.map((l) =>
                          l.slug === loc.slug
                            ? { ...l, lat: pt.lat, lng: pt.lng }
                            : l
                        )
                      )
                    }
                    label={`Pin location for ${loc.display_name}`}
                  />
                </div>
              )}
              <input
                type="number"
                value={loc.sort_order}
                onChange={(e) =>
                  setLocalities((prev) =>
                    prev.map((l) =>
                      l.slug === loc.slug
                        ? { ...l, sort_order: Number(e.target.value) || 0 }
                        : l
                    )
                  )
                }
                className="sm:col-span-1 h-8 px-2 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] text-xs tabular-nums"
              />
              <div className="sm:col-span-3 flex items-center justify-end gap-1.5">
                <button
                  type="button"
                  onClick={() =>
                    setLocalities((prev) =>
                      prev.map((l) =>
                        l.slug === loc.slug
                          ? { ...l, is_active: !l.is_active }
                          : l
                      )
                    )
                  }
                  className={`h-8 px-2.5 rounded-lg text-[11px] font-bold border ${
                    loc.is_active
                      ? 'bg-emerald-500/15 border-emerald-500/35 text-emerald-700 dark:text-emerald-300'
                      : 'bg-[var(--ps-surface)] border-[var(--ps-border)] text-[var(--ps-text-muted)]'
                  }`}
                >
                  {loc.is_active ? 'Active' : 'Hidden'}
                </button>
                <button
                  type="button"
                  onClick={() => void handleSaveLocality(loc)}
                  disabled={savingKey === `loc:${loc.slug}`}
                  className="h-8 px-2.5 rounded-lg bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-bold inline-flex items-center gap-1 disabled:opacity-60"
                >
                  {savingKey === `loc:${loc.slug}` ? (
                    <Loader2 className="w-3 h-3 animate-spin" />
                  ) : (
                    <Save className="w-3 h-3" />
                  )}
                  <span>Save</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* 3. Search Prompts, Prohibited Items & Geofence */}
      <form
        onSubmit={handleSaveSearchAndGeofence}
        className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1.5">
            <Compass className="w-4 h-4 text-[var(--ps-accent)]" />
            <h3 className="text-sm font-bold text-[var(--ps-text)]">
              Search UX, Prohibited Items &amp; District Geofence
            </h3>
          </div>
          <button
            type="submit"
            disabled={savingKey === 'ops-geo'}
            className="h-8 px-3.5 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-bold inline-flex items-center gap-1.5 disabled:opacity-60"
          >
            {savingKey === 'ops-geo' ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            <span>Save Search &amp; Geofence</span>
          </button>
        </div>

        {/* Geofence Center Map Picker + Radius */}
        <div className="space-y-3">
          <MapCoordinatePicker
            mode="point"
            label="District Geofence Map Center & Default Zoom"
            helperText="Align the crosshair on the regional service center and set the default Explore map zoom."
            coordinates={{
              lat: opsForm.geofence.center_lat,
              lng: opsForm.geofence.center_lng,
            }}
            zoom={opsForm.geofence.default_zoom}
            showZoomControl={true}
            onChangeCoordinates={(next) =>
              setOpsForm((p) => ({
                ...p,
                geofence: {
                  ...p.geofence,
                  center_lat: next.lat,
                  center_lng: next.lng,
                },
              }))
            }
            onChangeZoom={(nextZoom) =>
              setOpsForm((p) => ({
                ...p,
                geofence: {
                  ...p.geofence,
                  default_zoom: Math.min(18, Math.max(10, Math.round(nextZoom))),
                },
              }))
            }
          />
          <div className="max-w-xs">
            <label className="block text-[11px] font-semibold text-[var(--ps-text-muted)] mb-1">
              Pick N Drop Radius (km)
            </label>
            <input
              type="number"
              min={1}
              max={200}
              value={opsForm.geofence.service_radius_km}
              onChange={(e) =>
                setOpsForm((p) => ({
                  ...p,
                  geofence: {
                    ...p.geofence,
                    service_radius_km: Number(e.target.value) || 25,
                  },
                }))
              }
              className="w-full h-9 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs tabular-nums"
            />
          </div>
        </div>

        {/* Chip List Editors */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          {(
            [
              {
                field: 'search_placeholders' as const,
                title: 'Search Bar Placeholders',
                placeholder: 'Add rotating prompt…',
                value: placeholderInput,
                setter: setPlaceholderInput,
              },
              {
                field: 'trending_suggestions' as const,
                title: 'Trending Search Chips',
                placeholder: 'Add trending term…',
                value: trendingInput,
                setter: setTrendingInput,
              },
              {
                field: 'prohibited_items' as const,
                title: 'Prohibited Courier Items',
                placeholder: 'Add prohibited item…',
                value: prohibitedInput,
                setter: setProhibitedInput,
              },
            ] as const
          ).map((group) => (
            <div
              key={group.field}
              className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 space-y-2"
            >
              <div className="flex items-center gap-1.5 text-xs font-bold text-[var(--ps-text)]">
                <Search className="w-3.5 h-3.5 text-[var(--ps-accent)]" />
                <span>{group.title}</span>
              </div>
              <div className="flex items-center gap-1.5">
                <input
                  type="text"
                  value={group.value}
                  onChange={(e) => group.setter(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      appendChip(group.field, group.value, group.setter);
                    }
                  }}
                  placeholder={group.placeholder}
                  className="flex-1 h-8 px-2.5 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] text-xs"
                />
                <button
                  type="button"
                  onClick={() =>
                    appendChip(group.field, group.value, group.setter)
                  }
                  className="h-8 px-2.5 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] text-xs font-bold hover:border-[var(--ps-accent)]"
                >
                  Add
                </button>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {opsForm[group.field].map((item, idx) => (
                  <span
                    key={`${group.field}-${idx}`}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--ps-surface)] border border-[var(--ps-border)] text-[11px] text-[var(--ps-text)]"
                  >
                    <span className="max-w-[180px] truncate">{item}</span>
                    <button
                      type="button"
                      onClick={() => removeChip(group.field, idx)}
                      aria-label={`Remove ${item}`}
                      className="text-[var(--ps-text-muted)] hover:text-rose-500"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      </form>
    </div>
  );
}
