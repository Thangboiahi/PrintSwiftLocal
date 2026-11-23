'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Edit2,
  FolderTree,
  Inbox,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Tag,
  Trash2,
  X,
  XCircle,
} from 'lucide-react';
import { useConfirmDialog } from '@/components/ui/ConfirmActionModal';
import {
  CustomSelectModal,
  type CustomSelectOption,
} from '@/components/ui/CustomSelectModal';
import {
  ResponsiveTableScroll,
  WorkspaceTableToolbar,
} from '@/components/ui/ResponsiveTableWrapper';
import { useHub } from '@/components/providers/AppConfigProvider';
import { setAppStatus } from '@/lib/hooks/useAppStatus';
import type {
  CategoryEntityType,
  NestedCategoryNode,
} from '@/lib/config/types';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import type { MasterControlTabSharedProps } from './PaymentsGatewayTab';

interface CategoryDbRow {
  id: string;
  entity_type: CategoryEntityType;
  parent_id: string | null;
  depth: number;
  slug: string;
  display_name: string;
  icon: string;
  color_hex: string;
  sort_order: number;
  is_active: boolean;
}

interface CategorySuggestionDbRow {
  id: string;
  suggested_name: string;
  entity_type: CategoryEntityType;
  parent_id: string | null;
  hub_id: string | null;
  user_id: string | null;
  status: 'pending' | 'promoted' | 'rejected';
  created_at: string;
  hub?: {
    id: string;
    name: string;
  } | null;
}

const ENTITY_TYPE_OPTIONS: Array<{
  id: CategoryEntityType;
  label: string;
  description: string;
}> = [
  { id: 'listing', label: 'Listings & Explore', description: 'Business & local service directory' },
  { id: 'product', label: 'Marketplace Products', description: 'Classifieds, goods & trade' },
  { id: 'bulletin', label: 'Community Bulletins', description: 'Notices, events & announcements' },
  { id: 'vehicle', label: 'Fleet & Vehicles', description: 'Transit & delivery vehicle categories' },
];

const PRESET_COLORS = [
  '#2563EB', // Blue
  '#059669', // Emerald
  '#D97706', // Amber
  '#DC2626', // Red
  '#7C3AED', // Violet
  '#DB2777', // Pink
  '#0891B2', // Cyan
  '#4B5563', // Slate
];

const COMMON_ICONS = [
  'Tag',
  'Store',
  'ShoppingBag',
  'Smartphone',
  'Laptop',
  'Car',
  'Truck',
  'Utensils',
  'Wrench',
  'Home',
  'GraduationCap',
  'HeartPulse',
  'Sparkles',
  'Layers',
];

export function NestedCategoriesTab({
  onNotify,
  refreshGlobalConfig,
}: MasterControlTabSharedProps) {
  const { hubs } = useHub();

  const [selectedEntity, setSelectedEntity] = useState<CategoryEntityType>('listing');
  const [categories, setCategories] = useState<CategoryDbRow[]>([]);
  const [suggestions, setSuggestions] = useState<CategorySuggestionDbRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  // Search & Filter State
  const [catSearch, setCatSearch] = useState('');
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const [catStatusFilter, setCatStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [suggSearch, setSuggSearch] = useState('');
  const [suggHubFilter, setSuggHubFilter] = useState<string>('all');

  // Add / Edit Category State
  const [isAddingCategory, setIsAddingCategory] = useState(false);
  const [editingCategory, setEditingCategory] = useState<CategoryDbRow | null>(null);
  const [categoryForm, setCategoryForm] = useState<{
    display_name: string;
    slug: string;
    parent_id: string | null;
    icon: string;
    color_hex: string;
    sort_order: string;
    is_active: boolean;
  }>({
    display_name: '',
    slug: '',
    parent_id: null,
    icon: 'Tag',
    color_hex: '#2563EB',
    sort_order: '10',
    is_active: true,
  });

  // Promote Suggestion State
  const [promotingSuggestion, setPromotingSuggestion] = useState<CategorySuggestionDbRow | null>(null);
  const [promoteForm, setPromoteForm] = useState<{
    display_name: string;
    parent_id: string | null;
    icon: string;
    color_hex: string;
  }>({
    display_name: '',
    parent_id: null,
    icon: 'Tag',
    color_hex: '#2563EB',
  });

  // Load categories and suggestions
  const loadData = useCallback(async (silent = false) => {
    if (!isSupabaseConfigured()) {
      setIsLoading(false);
      return;
    }
    if (!silent) setIsLoading(true);
    else setIsRefreshing(true);

    try {
      const [catsRes, suggsRes] = await Promise.all([
        supabase
          .from('categories')
          .select('*')
          .eq('entity_type', selectedEntity)
          .order('depth', { ascending: true })
          .order('sort_order', { ascending: true })
          .order('display_name', { ascending: true }),
        supabase
          .from('category_suggestions')
          .select('*, hub:service_hubs(id, name)')
          .eq('entity_type', selectedEntity)
          .eq('status', 'pending')
          .order('created_at', { ascending: false }),
      ]);

      if (catsRes.data) {
        setCategories(catsRes.data as CategoryDbRow[]);
      }
      if (suggsRes.data) {
        setSuggestions(suggsRes.data as unknown as CategorySuggestionDbRow[]);
      }
    } catch (err) {
      console.error('Error loading categories:', err);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [selectedEntity]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadData(false);
    });
  }, [loadData]);

  // Group into tree hierarchy: L0 -> L1 -> L2
  const treeNodes = useMemo(() => {
    const roots: Array<CategoryDbRow & { children: Array<CategoryDbRow & { children: CategoryDbRow[] }> }> = [];
    const subsByParent = new Map<string, CategoryDbRow[]>();
    const microsByParent = new Map<string, CategoryDbRow[]>();

    for (const cat of categories) {
      if (cat.depth === 0 || !cat.parent_id) {
        roots.push({ ...cat, children: [] });
      } else if (cat.depth === 1) {
        const list = subsByParent.get(cat.parent_id) || [];
        list.push(cat);
        subsByParent.set(cat.parent_id, list);
      } else if (cat.depth === 2) {
        const list = microsByParent.get(cat.parent_id) || [];
        list.push(cat);
        microsByParent.set(cat.parent_id, list);
      }
    }

    for (const root of roots) {
      const subs = subsByParent.get(root.id) || [];
      root.children = subs.map((sub) => ({
        ...sub,
        children: microsByParent.get(sub.id) || [],
      }));
    }

    return roots;
  }, [categories]);

  // Filtered Category Tree (live search across L0/L1/L2 names & slugs + active/inactive filter)
  const { filteredTreeNodes, filteredCatCount } = useMemo(() => {
    const q = catSearch.trim().toLowerCase();
    const matchesStatus = (active: boolean) =>
      catStatusFilter === 'all' ||
      (catStatusFilter === 'active' ? active : !active);
    const matchesQuery = (cat: CategoryDbRow) =>
      !q ||
      cat.display_name.toLowerCase().includes(q) ||
      cat.slug.toLowerCase().includes(q);

    let count = 0;
    const result: typeof treeNodes = [];

    for (const root of treeNodes) {
      const rootDirectMatch = matchesQuery(root) && matchesStatus(root.is_active);
      const matchedSubs: typeof root.children = [];

      for (const sub of root.children) {
        const subDirectMatch = matchesQuery(sub) && matchesStatus(sub.is_active);
        const matchedMicros = sub.children.filter(
          (micro) =>
            (matchesQuery(micro) || subDirectMatch || rootDirectMatch) &&
            matchesStatus(micro.is_active)
        );
        if (subDirectMatch || matchedMicros.length > 0) {
          matchedSubs.push({ ...sub, children: matchedMicros });
          count += 1 + matchedMicros.length;
        }
      }

      if (rootDirectMatch || matchedSubs.length > 0) {
        result.push({ ...root, children: matchedSubs });
        count += 1;
      }
    }

    return { filteredTreeNodes: result, filteredCatCount: count };
  }, [treeNodes, catSearch, catStatusFilter]);

  // Filtered Category Suggestions
  const filteredSuggestions = useMemo(() => {
    const q = suggSearch.trim().toLowerCase();
    return suggestions.filter((sugg) => {
      if (suggHubFilter !== 'all' && (sugg.hub_id || 'local') !== suggHubFilter) {
        return false;
      }
      if (!q) return true;
      return (
        sugg.suggested_name.toLowerCase().includes(q) ||
        (sugg.hub?.name || '').toLowerCase().includes(q)
      );
    });
  }, [suggestions, suggSearch, suggHubFilter]);

  const hasActiveCatFilters = catSearch.trim() !== '' || catStatusFilter !== 'all';
  const hasActiveSuggFilters = suggSearch.trim() !== '' || suggHubFilter !== 'all';

  // Options for Parent Selector (Root L0 and Sub L1 only, depth < 2)
  const parentOptions: CustomSelectOption[] = useMemo(() => {
    const opts: CustomSelectOption[] = [
      { value: 'none', label: 'None (Root Level 0)', description: 'Top-level broad category' },
    ];
    for (const cat of categories) {
      if (cat.depth < 2) {
        const prefix = cat.depth === 0 ? 'L0' : '  ↳ L1';
        opts.push({
          value: cat.id,
          label: `${prefix} ${cat.display_name}`,
          description: `Depth ${cat.depth} · Slug: ${cat.slug}`,
        });
      }
    }
    return opts;
  }, [categories]);

  // Open Add modal with preset parent
  const handleOpenAdd = (presetParentId: string | null = null) => {
    setEditingCategory(null);
    setIsAddingCategory(true);
    setCategoryForm({
      display_name: '',
      slug: '',
      parent_id: presetParentId,
      icon: 'Tag',
      color_hex: '#2563EB',
      sort_order: '10',
      is_active: true,
    });
  };

  const handleOpenEdit = (cat: CategoryDbRow) => {
    setIsAddingCategory(false);
    setEditingCategory(cat);
    setCategoryForm({
      display_name: cat.display_name,
      slug: cat.slug,
      parent_id: cat.parent_id,
      icon: cat.icon || 'Tag',
      color_hex: cat.color_hex || '#2563EB',
      sort_order: String(cat.sort_order || 10),
      is_active: cat.is_active,
    });
  };

  // Save Category (Insert or Update)
  const handleSaveCategory = async () => {
    const name = categoryForm.display_name.trim();
    if (!name) {
      onNotify?.({ type: 'error', text: 'Category display name is required.' });
      return;
    }

    let slug = categoryForm.slug.trim().toLowerCase();
    if (!slug) {
      slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    }

    const parentId = categoryForm.parent_id === 'none' ? null : categoryForm.parent_id;

    // Calculate depth
    let depth = 0;
    if (parentId) {
      const parentCat = categories.find((c) => c.id === parentId);
      if (parentCat) {
        depth = Math.min(2, parentCat.depth + 1);
      }
    }

    const ok = await confirm({
      title: editingCategory
        ? `Save Category "${name}"?`
        : `Create Category "${name}"?`,
      description: `Save taxonomy node "${name}" (Level L${depth}, slug: ${slug}) under ${selectedEntity}?`,
      confirmLabel: editingCategory ? 'Save Category' : 'Create Category',
    });
    if (!ok) return;

    setBusyKey('save:cat');
    setAppStatus('saving', `Saving category "${name}"...`);

    try {
      if (editingCategory) {
        const { error } = await supabase
          .from('categories')
          .update({
            display_name: name,
            slug,
            icon: categoryForm.icon,
            color_hex: categoryForm.color_hex,
            sort_order: parseInt(categoryForm.sort_order, 10) || 10,
            is_active: categoryForm.is_active,
          })
          .eq('id', editingCategory.id);

        if (error) throw error;
      } else {
        const { error } = await supabase.from('categories').insert({
          entity_type: selectedEntity,
          parent_id: parentId,
          depth,
          display_name: name,
          slug,
          icon: categoryForm.icon,
          color_hex: categoryForm.color_hex,
          sort_order: parseInt(categoryForm.sort_order, 10) || 10,
          is_active: categoryForm.is_active,
        });

        if (error) throw error;
      }

      setAppStatus('success', `Category "${name}" saved.`);
      onNotify?.({ type: 'success', text: `Category "${name}" updated.` });
      setIsAddingCategory(false);
      setEditingCategory(null);
      await loadData(true);
      await refreshGlobalConfig();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to save category.';
      setAppStatus('error', msg);
      onNotify?.({ type: 'error', text: msg });
    } finally {
      setBusyKey(null);
    }
  };

  // Toggle category active/inactive
  const handleToggleActive = async (cat: CategoryDbRow) => {
    const nextVal = !cat.is_active;
    setBusyKey(`toggle:${cat.id}`);
    try {
      const { error } = await supabase
        .from('categories')
        .update({ is_active: nextVal })
        .eq('id', cat.id);

      if (error) throw error;

      setCategories((prev) =>
        prev.map((c) => (c.id === cat.id ? { ...c, is_active: nextVal } : c))
      );
      await refreshGlobalConfig();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to toggle category.';
      onNotify?.({ type: 'error', text: msg });
    } finally {
      setBusyKey(null);
    }
  };

  // Promote Category Suggestion via RPC
  const handlePromoteSuggestion = async () => {
    if (!promotingSuggestion) return;
    const name = promoteForm.display_name.trim();
    if (!name) {
      onNotify?.({ type: 'error', text: 'Display name is required.' });
      return;
    }

    const parentId = promoteForm.parent_id === 'none' ? null : promoteForm.parent_id;

    const ok = await confirm({
      title: `Promote "${name}" to Official Category?`,
      description: `Promote crowdsourced suggestion "${name}" into the official ${selectedEntity} category tree?`,
      confirmLabel: 'Promote Category',
    });
    if (!ok) return;

    setBusyKey('promote:sugg');
    setAppStatus('saving', `Promoting "${name}" to official category...`);

    try {
      const { error } = await supabase.rpc('promote_category_suggestion', {
        p_suggestion_id: promotingSuggestion.id,
        p_display_name: name,
        p_parent_id: parentId,
        p_icon: promoteForm.icon || 'Tag',
        p_color: promoteForm.color_hex || '#2563EB',
      });

      if (error) throw error;

      setAppStatus('success', `Promoted "${name}" to category.`);
      onNotify?.({
        type: 'success',
        text: `Suggestion promoted into official category tree.`,
      });
      setPromotingSuggestion(null);
      await loadData(true);
      await refreshGlobalConfig();
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to promote suggestion.';
      setAppStatus('error', msg);
      onNotify?.({ type: 'error', text: msg });
    } finally {
      setBusyKey(null);
    }
  };

  // Reject Category Suggestion
  const handleRejectSuggestion = async (suggId: string) => {
    const ok = await confirm({
      title: 'Reject Category Suggestion?',
      description: 'Mark this crowdsourced category suggestion as rejected?',
      confirmLabel: 'Reject Suggestion',
      variant: 'danger',
    });
    if (!ok) return;
    setBusyKey(`reject:${suggId}`);
    try {
      const { error } = await supabase
        .from('category_suggestions')
        .update({ status: 'rejected' })
        .eq('id', suggId);

      if (error) throw error;

      setSuggestions((prev) => prev.filter((s) => s.id !== suggId));
      onNotify?.({ type: 'info', text: 'Suggestion rejected.' });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to reject suggestion.';
      onNotify?.({ type: 'error', text: msg });
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="space-y-4">
      {/* Entity Selector Header */}
      <div className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 pb-2.5 dark:border-slate-800">
          <div>
            <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-900 dark:text-white">
              <Layers className="h-4 w-4 text-sky-600 dark:text-sky-400" />
              <span>3-Level Nested Category Tree &amp; Demand Queue</span>
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Manage Root (L0), Sub (L1), and Micro (L2) taxonomy across modules, and promote crowdsourced user tags in 1 click.
            </p>
          </div>
          <button
            type="button"
            disabled={isRefreshing || isLoading}
            onClick={() => void loadData(true)}
            className="inline-flex h-7 items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 text-xs font-semibold text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300"
          >
            <RefreshCw className={`h-3 w-3 ${isRefreshing ? 'animate-spin' : ''}`} />
            Refresh
          </button>
        </div>

        {/* Entity Tabs */}
        <div className="mt-2.5 flex items-center gap-1.5 overflow-x-auto">
          {ENTITY_TYPE_OPTIONS.map((ent) => {
            const active = selectedEntity === ent.id;
            return (
              <button
                key={ent.id}
                type="button"
                onClick={() => setSelectedEntity(ent.id)}
                className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition ${
                  active
                    ? 'bg-slate-900 text-white shadow-sm dark:bg-sky-600'
                    : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300 dark:hover:bg-slate-800'
                }`}
              >
                <FolderTree className="h-3.5 w-3.5" />
                <span>{ent.label}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Main Grid: Tree View (Left/Main) + Suggestions Queue (Right/Side) */}
      <div className="grid gap-4 lg:grid-cols-3 min-w-0">
        {/* LEFT 2 COLS: CATEGORY TREE */}
        <div className="space-y-3 lg:col-span-2 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
              Taxonomy Hierarchy ({categories.length} categories)
            </span>
            <button
              type="button"
              onClick={() => handleOpenAdd(null)}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-sky-600 px-3 text-xs font-semibold text-white hover:bg-sky-700"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add Root Category</span>
            </button>
          </div>

          <WorkspaceTableToolbar
            searchQuery={catSearch}
            onSearchChange={setCatSearch}
            searchPlaceholder="Search categories or slugs…"
            filteredCount={filteredCatCount}
            totalCount={categories.length}
            countLabel="nodes"
            hasActiveFilters={hasActiveCatFilters}
            onResetFilters={() => {
              setCatSearch('');
              setCatStatusFilter('all');
            }}
          >
            <div className="flex items-center gap-1">
              {(['all', 'active', 'inactive'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setCatStatusFilter(st)}
                  className={`inline-flex h-8 items-center rounded-lg px-2.5 text-[11px] font-semibold capitalize transition-colors ${
                    catStatusFilter === st
                      ? 'bg-slate-900 text-white dark:bg-sky-600'
                      : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>
          </WorkspaceTableToolbar>

          {/* Add / Edit Category Drawer */}
          {(isAddingCategory || editingCategory) && (
            <div className="rounded-xl border border-sky-300 bg-sky-50/50 p-4 shadow-sm dark:border-sky-900/60 dark:bg-sky-950/20">
              <div className="flex items-center justify-between border-b border-sky-200 pb-2 dark:border-sky-900">
                <h4 className="text-xs font-bold text-sky-950 dark:text-sky-200">
                  {editingCategory
                    ? `Edit Category: ${editingCategory.display_name}`
                    : 'Create New Category Node'}
                </h4>
                <button
                  type="button"
                  onClick={() => {
                    setIsAddingCategory(false);
                    setEditingCategory(null);
                  }}
                  className="rounded p-1 text-slate-500 hover:bg-sky-100 dark:hover:bg-sky-900"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
                <label className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase text-slate-600 dark:text-slate-400">
                    Display Name *
                  </span>
                  <input
                    type="text"
                    value={categoryForm.display_name}
                    onChange={(e) =>
                      setCategoryForm({ ...categoryForm, display_name: e.target.value })
                    }
                    placeholder="e.g. Fresh Groceries & Produce"
                    className="h-8 w-full rounded-md border border-slate-200 bg-white px-2.5 text-xs font-bold dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  />
                </label>

                <label className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase text-slate-600 dark:text-slate-400">
                    Slug
                  </span>
                  <input
                    type="text"
                    value={categoryForm.slug}
                    onChange={(e) =>
                      setCategoryForm({ ...categoryForm, slug: e.target.value.toLowerCase() })
                    }
                    placeholder="Auto-generated if empty"
                    className="h-8 w-full rounded-md border border-slate-200 bg-white px-2.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  />
                </label>

                {!editingCategory && (
                  <div className="space-y-1 sm:col-span-2">
                    <span className="text-[10px] font-semibold uppercase text-slate-600 dark:text-slate-400">
                      Parent Category (Depth 0–2)
                    </span>
                    <CustomSelectModal
                      label="Select Parent Category"
                      options={parentOptions}
                      value={categoryForm.parent_id || 'none'}
                      onChange={(v) =>
                        setCategoryForm({
                          ...categoryForm,
                          parent_id: v === 'none' ? null : v,
                        })
                      }
                    />
                  </div>
                )}

                <div className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase text-slate-600 dark:text-slate-400">
                    Icon Name (Lucide)
                  </span>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="text"
                      value={categoryForm.icon}
                      onChange={(e) =>
                        setCategoryForm({ ...categoryForm, icon: e.target.value })
                      }
                      placeholder="Tag"
                      className="h-8 w-full rounded-md border border-slate-200 bg-white px-2.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase text-slate-600 dark:text-slate-400">
                    Color Accent
                  </span>
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      value={categoryForm.color_hex}
                      onChange={(e) =>
                        setCategoryForm({ ...categoryForm, color_hex: e.target.value })
                      }
                      className="h-8 w-24 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                    />
                    <div className="flex items-center gap-1">
                      {PRESET_COLORS.map((c) => (
                        <button
                          key={c}
                          type="button"
                          onClick={() => setCategoryForm({ ...categoryForm, color_hex: c })}
                          style={{ backgroundColor: c }}
                          className={`h-6 w-6 rounded-full border transition ${
                            categoryForm.color_hex === c
                              ? 'scale-110 border-white ring-2 ring-sky-500'
                              : 'border-transparent'
                          }`}
                        />
                      ))}
                    </div>
                  </div>
                </div>

                <label className="space-y-1">
                  <span className="text-[10px] font-semibold uppercase text-slate-600 dark:text-slate-400">
                    Sort Order
                  </span>
                  <input
                    type="number"
                    value={categoryForm.sort_order}
                    onChange={(e) =>
                      setCategoryForm({ ...categoryForm, sort_order: e.target.value })
                    }
                    className="h-8 w-full rounded-md border border-slate-200 bg-white px-2.5 font-mono text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  />
                </label>

                <div className="flex items-center gap-2 pt-4">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={categoryForm.is_active}
                      onChange={(e) =>
                        setCategoryForm({ ...categoryForm, is_active: e.target.checked })
                      }
                      className="h-4 w-4 rounded border-slate-300 text-sky-600 focus:ring-sky-500"
                    />
                    <span className="text-xs font-bold text-slate-800 dark:text-slate-200">
                      Active (Visible to Users)
                    </span>
                  </label>
                </div>
              </div>

              <div className="mt-3 flex items-center justify-end gap-2 border-t border-sky-200 pt-2.5 dark:border-sky-900">
                <button
                  type="button"
                  onClick={() => {
                    setIsAddingCategory(false);
                    setEditingCategory(null);
                  }}
                  className="h-8 rounded-lg border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={busyKey === 'save:cat'}
                  onClick={() => void handleSaveCategory()}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-sky-600 px-4 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
                >
                  {busyKey === 'save:cat' ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  <span>Save Category</span>
                </button>
              </div>
            </div>
          )}

          {/* Tree Display */}
          {treeNodes.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-xs text-slate-400 dark:border-slate-800 dark:bg-slate-900/50">
              No categories configured for {selectedEntity}. Click &quot;Add Root Category&quot; to begin building your taxonomy tree.
            </div>
          ) : filteredTreeNodes.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900/50 space-y-2">
              <p>No categories match your current search or status filter.</p>
              <button
                type="button"
                onClick={() => {
                  setCatSearch('');
                  setCatStatusFilter('all');
                }}
                className="inline-flex h-7 items-center rounded-md border border-slate-300 bg-white px-2.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                Reset Filters
              </button>
            </div>
          ) : (
            <ResponsiveTableScroll
              minWidthClass="min-w-[540px]"
              wrapperClassName="border-none bg-transparent shadow-none"
              swipeHintLabel="Swipe ↔ to view taxonomy actions"
            >
            <div className="space-y-2">
              {filteredTreeNodes.map((root) => (
                <div
                  key={root.id}
                  className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900"
                >
                  {/* Root (L0) Row */}
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className="h-3 w-3 rounded-full shrink-0"
                        style={{ backgroundColor: root.color_hex || '#2563EB' }}
                      />
                      <span className="font-bold text-slate-900 dark:text-white">
                        {root.display_name}
                      </span>
                      <span className="rounded bg-sky-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-sky-800 dark:bg-sky-950/70 dark:text-sky-300">
                        L0 Root
                      </span>
                      <code className="text-[10px] text-slate-400">{root.slug}</code>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleOpenAdd(root.id)}
                        className="inline-flex h-6 items-center gap-1 rounded bg-slate-100 px-2 text-[10px] font-semibold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
                      >
                        <Plus className="h-2.5 w-2.5" />
                        <span>Sub</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => handleOpenEdit(root)}
                        className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                      >
                        <Edit2 className="h-3 w-3" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleToggleActive(root)}
                        className={`h-6 rounded px-1.5 text-[10px] font-bold ${
                          root.is_active
                            ? 'text-emerald-700 dark:text-emerald-400'
                            : 'text-slate-400 line-through'
                        }`}
                      >
                        {root.is_active ? 'Active' : 'Off'}
                      </button>
                    </div>
                  </div>

                  {/* Sub (L1) & Micro (L2) Children */}
                  {root.children && root.children.length > 0 && (
                    <div className="mt-2.5 space-y-2 border-l-2 border-slate-100 pl-3.5 dark:border-slate-800">
                      {root.children.map((sub) => (
                        <div key={sub.id} className="space-y-1.5">
                          <div className="flex items-center justify-between gap-2">
                            <div className="flex items-center gap-2">
                              <span
                                className="h-2.5 w-2.5 rounded-full shrink-0"
                                style={{ backgroundColor: sub.color_hex || '#059669' }}
                              />
                              <span className="text-xs font-semibold text-slate-800 dark:text-slate-200">
                                {sub.display_name}
                              </span>
                              <span className="rounded bg-emerald-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300">
                                L1 Sub
                              </span>
                              <code className="text-[10px] text-slate-400">{sub.slug}</code>
                            </div>

                            <div className="flex items-center gap-1.5">
                              <button
                                type="button"
                                onClick={() => handleOpenAdd(sub.id)}
                                className="inline-flex h-6 items-center gap-1 rounded bg-slate-100 px-1.5 text-[10px] font-semibold text-slate-700 hover:bg-slate-200 dark:bg-slate-800 dark:text-slate-300"
                              >
                                <Plus className="h-2.5 w-2.5" />
                                <span>Micro</span>
                              </button>
                              <button
                                type="button"
                                onClick={() => handleOpenEdit(sub)}
                                className="inline-flex h-6 w-6 items-center justify-center rounded text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800"
                              >
                                <Edit2 className="h-3 w-3" />
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleToggleActive(sub)}
                                className={`h-6 rounded px-1.5 text-[10px] font-bold ${
                                  sub.is_active
                                    ? 'text-emerald-700 dark:text-emerald-400'
                                    : 'text-slate-400 line-through'
                                }`}
                              >
                                {sub.is_active ? 'Active' : 'Off'}
                              </button>
                            </div>
                          </div>

                          {/* Micro (L2) Children */}
                          {sub.children && sub.children.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1.5 pl-3 border-l border-slate-200 dark:border-slate-800">
                              {sub.children.map((micro) => (
                                <div
                                  key={micro.id}
                                  className="flex items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] dark:border-slate-800 dark:bg-slate-900"
                                >
                                  <span
                                    className="h-1.5 w-1.5 rounded-full"
                                    style={{ backgroundColor: micro.color_hex || '#D97706' }}
                                  />
                                  <span
                                    className={`font-medium ${
                                      micro.is_active ? 'text-slate-700 dark:text-slate-300' : 'text-slate-400 line-through'
                                    }`}
                                  >
                                    {micro.display_name}
                                  </span>
                                  <button
                                    type="button"
                                    onClick={() => handleOpenEdit(micro)}
                                    className="text-slate-400 hover:text-slate-700 ml-1"
                                  >
                                    <Edit2 className="h-2.5 w-2.5" />
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
            </ResponsiveTableScroll>
          )}
        </div>

        {/* RIGHT COL: CROWDSOURCED CATEGORY SUGGESTIONS */}
        <div className="space-y-3 min-w-0">
          <div className="rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm dark:border-slate-800 dark:bg-slate-900 space-y-2.5">
            <div>
              <h4 className="flex items-center gap-1.5 text-xs font-bold text-slate-900 dark:text-white">
                <Sparkles className="h-3.5 w-3.5 text-amber-500" />
                <span>User Suggestions Queue ({suggestions.length})</span>
              </h4>
              <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                Tags suggested by customers when posting. Promote directly into the hierarchy to satisfy live search demand.
              </p>
            </div>

            {suggestions.length > 0 && (
              <WorkspaceTableToolbar
                searchQuery={suggSearch}
                onSearchChange={setSuggSearch}
                searchPlaceholder="Search suggested tags…"
                filteredCount={filteredSuggestions.length}
                totalCount={suggestions.length}
                countLabel="pending"
                hasActiveFilters={hasActiveSuggFilters}
                onResetFilters={() => {
                  setSuggSearch('');
                  setSuggHubFilter('all');
                }}
              >
                {hubs.length > 0 && (
                  <div className="flex items-center gap-1 overflow-x-auto">
                    <button
                      type="button"
                      onClick={() => setSuggHubFilter('all')}
                      className={`inline-flex h-7 shrink-0 items-center rounded-md px-2 text-[10px] font-semibold ${
                        suggHubFilter === 'all'
                          ? 'bg-sky-600 text-white'
                          : 'border border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
                      }`}
                    >
                      All Hubs
                    </button>
                    {hubs.map((h) => (
                      <button
                        key={h.id}
                        type="button"
                        onClick={() => setSuggHubFilter(h.id)}
                        className={`inline-flex h-7 shrink-0 items-center rounded-md px-2 text-[10px] font-semibold ${
                          suggHubFilter === h.id
                            ? 'bg-sky-600 text-white'
                            : 'border border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
                        }`}
                      >
                        {h.name}
                      </button>
                    ))}
                  </div>
                )}
              </WorkspaceTableToolbar>
            )}
          </div>

          {/* Promote Drawer / Modal */}
          {promotingSuggestion && (
            <div className="rounded-xl border border-amber-300 bg-amber-50/60 p-3.5 shadow-sm dark:border-amber-900/60 dark:bg-amber-950/20">
              <div className="flex items-center justify-between border-b border-amber-200 pb-2 dark:border-amber-900">
                <h5 className="text-xs font-bold text-amber-950 dark:text-amber-200">
                  Promote to Official Category
                </h5>
                <button
                  type="button"
                  onClick={() => setPromotingSuggestion(null)}
                  className="rounded p-0.5 text-slate-500"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>

              <div className="mt-2.5 space-y-2">
                <label className="space-y-0.5">
                  <span className="text-[10px] font-semibold uppercase text-slate-600 dark:text-slate-400">
                    Display Name
                  </span>
                  <input
                    type="text"
                    value={promoteForm.display_name}
                    onChange={(e) =>
                      setPromoteForm({ ...promoteForm, display_name: e.target.value })
                    }
                    className="h-8 w-full rounded-md border border-slate-200 bg-white px-2 text-xs font-bold dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                  />
                </label>

                <div className="space-y-0.5">
                  <span className="text-[10px] font-semibold uppercase text-slate-600 dark:text-slate-400">
                    Parent Category
                  </span>
                  <CustomSelectModal
                    label="Parent"
                    options={parentOptions}
                    value={promoteForm.parent_id || 'none'}
                    onChange={(v) =>
                      setPromoteForm({
                        ...promoteForm,
                        parent_id: v === 'none' ? null : v,
                      })
                    }
                  />
                </div>

                <div className="flex items-center justify-end gap-2 pt-2">
                  <button
                    type="button"
                    onClick={() => setPromotingSuggestion(null)}
                    className="h-7 rounded-md border border-slate-200 bg-white px-2.5 text-xs text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={busyKey === 'promote:sugg'}
                    onClick={() => void handlePromoteSuggestion()}
                    className="inline-flex h-7 items-center gap-1 rounded-md bg-amber-600 px-3 text-xs font-semibold text-white hover:bg-amber-700 disabled:opacity-50"
                  >
                    {busyKey === 'promote:sugg' ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Check className="h-3 w-3" />
                    )}
                    <span>Promote</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Suggestions List */}
          {suggestions.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-xs text-slate-400 dark:border-slate-800 dark:bg-slate-900/50">
              No pending category suggestions. Demand queue is clear.
            </div>
          ) : filteredSuggestions.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-slate-50 p-6 text-center text-xs text-slate-500 dark:border-slate-800 dark:bg-slate-900/50 space-y-2">
              <p>No suggestions match your search or hub filter.</p>
              <button
                type="button"
                onClick={() => {
                  setSuggSearch('');
                  setSuggHubFilter('all');
                }}
                className="inline-flex h-7 items-center rounded-md border border-slate-300 bg-white px-2.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
              >
                Reset Filters
              </button>
            </div>
          ) : (
            <ResponsiveTableScroll
              minWidthClass="min-w-[320px]"
              wrapperClassName="border-none bg-transparent shadow-none"
              showSwipeHint={false}
            >
            <div className="space-y-2">
              {filteredSuggestions.map((sugg) => (
                <div
                  key={sugg.id}
                  className="rounded-xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <Tag className="h-3 w-3 text-amber-500 shrink-0" />
                        <span className="font-bold text-slate-900 dark:text-white">
                          {sugg.suggested_name}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[10px] text-slate-500 dark:text-slate-400">
                        Hub: {sugg.hub?.name || 'Local'} · {new Date(sugg.created_at).toLocaleDateString()}
                      </p>
                    </div>

                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          setPromotingSuggestion(sugg);
                          setPromoteForm({
                            display_name: sugg.suggested_name,
                            parent_id: null,
                            icon: 'Tag',
                            color_hex: '#2563EB',
                          });
                        }}
                        className="inline-flex h-7 items-center gap-1 rounded-md bg-emerald-600 px-2 text-[10px] font-bold text-white hover:bg-emerald-700"
                      >
                        <Check className="h-3 w-3" />
                        <span>Promote</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => void handleRejectSuggestion(sugg.id)}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-rose-200 bg-white text-rose-600 hover:bg-rose-50 dark:border-rose-900 dark:bg-slate-900 dark:text-rose-400"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
            </ResponsiveTableScroll>
          )}
        </div>
      </div>

      {confirmDialog}
    </div>
  );
}

export default NestedCategoriesTab;
