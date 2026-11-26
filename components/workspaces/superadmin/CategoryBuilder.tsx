'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import {
  AlertTriangle,
  ArrowLeftRight,
  Layers,
  Loader2,
  Lock,
  RefreshCw,
  Save,
  Search,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  Undo2,
  Unlock,
} from 'lucide-react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase/client';
import { normalizeIconKey } from '@/lib/icons/registry';
import {
  CANONICAL_ALL_SYSTEM_ROOTS,
  normalizeCategoryDepth,
} from '@/lib/taxonomy/categories';
import { IconPicker } from '@/components/ui/IconPicker';
import { FormModal } from '@/components/ui/FormModal';
import { useConfirmDialogState } from '@/components/ui/ConfirmDialog';
import { useTouchSafeSensors } from '@/components/ui/SortablePreview';
import { notifyAppConfigUpdated } from '@/components/providers/AppConfigProvider';
import {
  CategoryBuilderSkeleton,
  RootSortableCard,
  normalizeTreeRecords,
  slugifyCategory,
  type CategoryEntityType,
  type CategoryRecord,
} from '@/components/workspaces/superadmin/CategoryTreeRows';
import { SuggestedCategoriesReview } from '@/components/workspaces/superadmin/SuggestedCategoriesReview';

export type { CategoryEntityType, CategoryRecord };

interface CategoryReferenceCounts {
  listings: number;
  subscriptionPlans: number;
  homepageItems: number;
  paymentPolicies: number;
  childCount: number;
  total: number;
}

interface CategoryDraft {
  id?: string;
  entity_type: CategoryEntityType;
  root_key: string;
  parent_id: string | null;
  depth: 1 | 2 | 3;
  is_system_root: boolean;
  display_name: string;
  description: string;
  slug: string;
  icon_key: string;
  accent_color: string;
  sort_order: number;
  is_active: boolean;
  originalSlug?: string;
}

interface MoveModalState {
  category: CategoryRecord;
  targetParentId: string;
}

interface CategoryBuilderProps {
  onNotice?: (notice: {
    type: 'success' | 'error' | 'info';
    text: string;
  }) => void;
}

const ENTITY_TYPE_TABS: Array<{
  id: CategoryEntityType;
  label: string;
}> = [
  { id: 'listing', label: 'Directory Listings' },
  { id: 'product', label: 'Marketplace' },
  { id: 'bulletin', label: 'Bulletins' },
  { id: 'vehicle', label: 'Fleet & Vehicles' },
];

const RESERVED_SLUGS = new Set([
  'all',
  'admin',
  'api',
  'explore',
  'civic',
  'settings',
  'workspace',
]);

const SLUG_REGEX = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const HEX_REGEX = /^#[0-9a-fA-F]{6}$/;

const ACCENT_PRESETS = [
  '#2563EB',
  '#059669',
  '#D97706',
  '#E11D48',
  '#7C3AED',
  '#0891B2',
  '#EA580C',
  '#4F46E5',
];

function validateCategoryDraft(
  draft: CategoryDraft,
  existingCategories: CategoryRecord[]
): Record<string, string> {
  const errors: Record<string, string> = {};
  const trimmedName = draft.display_name.trim();
  const trimmedSlug = draft.slug.trim().toLowerCase();
  const trimmedDesc = draft.description.trim();

  if (trimmedName.length < 2) {
    errors.display_name = 'Display label must be at least 2 characters.';
  } else if (trimmedName.length > 64) {
    errors.display_name = 'Display label must be 64 characters or fewer.';
  }

  if (trimmedDesc.length > 240) {
    errors.description = 'Description must be 240 characters or fewer.';
  }

  if (!draft.is_system_root) {
    if (!trimmedSlug) {
      errors.slug = 'URL slug is required.';
    } else if (!SLUG_REGEX.test(trimmedSlug)) {
      errors.slug =
        'Use lowercase letters, numbers, hyphens, or underscores only (e.g. hardware-tools).';
    } else if (RESERVED_SLUGS.has(trimmedSlug)) {
      errors.slug = `"${trimmedSlug}" is a reserved route slug. Choose another identifier.`;
    } else {
      const duplicate = existingCategories.find(
        (c) =>
          c.entity_type === draft.entity_type &&
          c.slug.toLowerCase() === trimmedSlug &&
          c.id !== draft.id
      );
      if (duplicate) {
        errors.slug = `Slug "${trimmedSlug}" is already used by "${duplicate.display_name}".`;
      }
    }
  }

  if (!HEX_REGEX.test(draft.accent_color.trim())) {
    errors.accent_color =
      'Accent color must be a valid 6-digit hex code (e.g. #2563EB).';
  }

  return errors;
}

export function CategoryBuilder({ onNotice }: CategoryBuilderProps) {
  const rootSensors = useTouchSafeSensors();
  const { confirm, dialog } = useConfirmDialogState();

  const [activeViewMode, setActiveViewMode] = useState<'tree' | 'suggestions'>(
    'tree'
  );
  const [entityTab, setEntityTab] = useState<CategoryEntityType>('listing');
  const [searchQuery, setSearchQuery] = useState('');
  const [dbCategories, setDbCategories] = useState<CategoryRecord[]>([]);
  const [draftCategories, setDraftCategories] = useState<CategoryRecord[]>([]);
  const [pendingSuggestionsCount, setPendingSuggestionsCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [savingOrder, setSavingOrder] = useState(false);

  const [expandedRootIds, setExpandedRootIds] = useState<Set<string>>(
    new Set()
  );
  const [expandedL2Ids, setExpandedL2Ids] = useState<Set<string>>(new Set());

  const [modalOpen, setModalOpen] = useState(false);
  const [draft, setDraft] = useState<CategoryDraft | null>(null);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [slugUnlocked, setSlugUnlocked] = useState(false);
  const [autoSlug, setAutoSlug] = useState(true);
  const [refCounts, setRefCounts] = useState<CategoryReferenceCounts | null>(
    null
  );
  const [loadingRefs, setLoadingRefs] = useState(false);
  const [savingModal, setSavingModal] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const [moveModal, setMoveModal] = useState<MoveModalState | null>(null);

  const fetchCategories = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('categories')
        .select('*')
        .order('depth', { ascending: true })
        .order('sort_order', { ascending: true })
        .order('display_name', { ascending: true });

      if (error) throw error;

      const rawList = Array.isArray(data)
        ? (data as Array<Record<string, unknown>>)
        : [];

      // Pass v17a: Track pending user suggestions separately and keep official tree clean
      const pendingCount = rawList.filter(
        (r) => String(r.review_status || 'official') === 'pending_review'
      ).length;
      setPendingSuggestionsCount(pendingCount);

      const mapped: CategoryRecord[] = rawList
        .filter(
          (r) =>
            ['listing', 'product', 'bulletin', 'vehicle'].includes(
              String(r.entity_type || '')
            ) && String(r.review_status || 'official') === 'official'
        )
        .map((r) => {
          const parentId = r.parent_id ? String(r.parent_id) : null;
          const slug = String(r.slug || '');
          const rootKey =
            typeof r.root_key === 'string' && r.root_key.trim()
              ? r.root_key.trim()
              : !parentId
                ? slug
                : '';
          const iconKey = normalizeIconKey(
            typeof r.icon_key === 'string' && r.icon_key.trim()
              ? r.icon_key
              : typeof r.icon === 'string' && r.icon.trim()
                ? r.icon
                : 'tag'
          );
          const accentColor =
            typeof r.accent_color === 'string' && r.accent_color.trim()
              ? r.accent_color.trim()
              : typeof r.color_hex === 'string' && r.color_hex.trim()
                ? r.color_hex.trim()
                : '#2563EB';
          const pathIds = Array.isArray(r.path_ids)
            ? r.path_ids.map((id) => String(id)).filter(Boolean)
            : [];
          return {
            id: String(r.id),
            entity_type: String(r.entity_type) as CategoryEntityType,
            root_key: rootKey,
            parent_id: parentId,
            depth: normalizeCategoryDepth({
              depth: Number(r.depth ?? 1),
              parent_id: parentId,
              path_ids: pathIds,
            }),
            path_ids: pathIds,
            is_system_root: Boolean(r.is_system_root ?? false),
            slug,
            display_name: String(r.display_name || slug),
            description:
              typeof r.description === 'string' ? r.description : '',
            icon_key: iconKey,
            accent_color: accentColor,
            sort_order: Number(r.sort_order ?? 0),
            is_active: Boolean(r.is_active ?? true),
          };
        });

      const normalized = normalizeTreeRecords(mapped);
      setDbCategories(normalized);
      setDraftCategories(normalized);

      setExpandedRootIds((prev) => {
        if (prev.size > 0) return prev;
        const firstRoots = normalized
          .filter((c) => c.depth === 1)
          .slice(0, 2)
          .map((c) => c.id);
        return new Set(firstRoots);
      });
    } catch (err) {
      onNotice?.({
        type: 'error',
        text:
          err instanceof Error
            ? `Failed to load categories: ${err.message}`
            : 'Failed to load categories.',
      });
    } finally {
      setLoading(false);
    }
  }, [onNotice]);

  useEffect(() => {
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        void fetchCategories();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [fetchCategories]);

  const entityCategories = useMemo(
    () => draftCategories.filter((c) => c.entity_type === entityTab),
    [draftCategories, entityTab]
  );

  const taxonomyIndex = useMemo(() => {
    const roots = entityCategories
      .filter((c) => c.depth === 1 || !c.parent_id)
      .sort(
        (a, b) =>
          a.sort_order - b.sort_order ||
          a.display_name.localeCompare(b.display_name)
      );

    const l2ByRootId = new Map<string, CategoryRecord[]>();
    const l3ByL2Id = new Map<string, CategoryRecord[]>();

    for (const c of entityCategories) {
      if (c.depth === 2 && c.parent_id) {
        const list = l2ByRootId.get(c.parent_id) || [];
        list.push(c);
        l2ByRootId.set(c.parent_id, list);
      } else if (c.depth === 3 && c.parent_id) {
        const list = l3ByL2Id.get(c.parent_id) || [];
        list.push(c);
        l3ByL2Id.set(c.parent_id, list);
      }
    }

    for (const list of l2ByRootId.values()) {
      list.sort(
        (a, b) =>
          a.sort_order - b.sort_order ||
          a.display_name.localeCompare(b.display_name)
      );
    }
    for (const list of l3ByL2Id.values()) {
      list.sort(
        (a, b) =>
          a.sort_order - b.sort_order ||
          a.display_name.localeCompare(b.display_name)
      );
    }

    return { roots, l2ByRootId, l3ByL2Id };
  }, [entityCategories]);

  const filteredTaxonomy = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) {
      return taxonomyIndex;
    }

    const matchesNode = (c: CategoryRecord) =>
      c.display_name.toLowerCase().includes(q) ||
      c.slug.toLowerCase().includes(q) ||
      c.root_key.toLowerCase().includes(q) ||
      c.description.toLowerCase().includes(q);

    const nextL2ByRoot = new Map<string, CategoryRecord[]>();
    const nextL3ByL2 = new Map<string, CategoryRecord[]>();
    const visibleRoots: CategoryRecord[] = [];

    for (const root of taxonomyIndex.roots) {
      const rootMatches = matchesNode(root);
      const allL2s = taxonomyIndex.l2ByRootId.get(root.id) || [];
      const matchingL2s: CategoryRecord[] = [];

      for (const l2 of allL2s) {
        const l2Matches = matchesNode(l2);
        const allL3s = taxonomyIndex.l3ByL2Id.get(l2.id) || [];
        const matchingL3s =
          rootMatches || l2Matches
            ? allL3s
            : allL3s.filter((l3) => matchesNode(l3));

        if (rootMatches || l2Matches || matchingL3s.length > 0) {
          matchingL2s.push(l2);
          nextL3ByL2.set(l2.id, matchingL3s);
        }
      }

      if (rootMatches || matchingL2s.length > 0) {
        visibleRoots.push(root);
        nextL2ByRoot.set(root.id, matchingL2s);
      }
    }

    return {
      roots: visibleRoots,
      l2ByRootId: nextL2ByRoot,
      l3ByL2Id: nextL3ByL2,
    };
  }, [searchQuery, taxonomyIndex]);

  const stats = useMemo(() => {
    const l1 = entityCategories.filter((c) => c.depth === 1).length;
    const l2 = entityCategories.filter((c) => c.depth === 2).length;
    const l3 = entityCategories.filter((c) => c.depth === 3).length;
    const activeCount = entityCategories.filter((c) => c.is_active).length;
    return { l1, l2, l3, activeCount, total: entityCategories.length };
  }, [entityCategories]);

  const pendingDiff = useMemo(() => {
    const dbById = new Map(dbCategories.map((c) => [c.id, c]));
    const changed: CategoryRecord[] = [];
    let moveCount = 0;
    let orderCount = 0;

    for (const item of draftCategories) {
      const orig = dbById.get(item.id);
      if (!orig) continue;
      const parentChanged =
        (orig.parent_id ?? null) !== (item.parent_id ?? null);
      const orderChanged = orig.sort_order !== item.sort_order;
      if (parentChanged || orderChanged) {
        changed.push(item);
        if (parentChanged) moveCount += 1;
        if (orderChanged) orderCount += 1;
      }
    }
    return { changed, count: changed.length, moveCount, orderCount };
  }, [dbCategories, draftCategories]);

  const applySiblingReorder = useCallback(
    (parentId: string | null, orderedIds: string[]) => {
      const rankMap = new Map(
        orderedIds.map((id, idx) => [id, (idx + 1) * 10])
      );
      setDraftCategories((prev) =>
        normalizeTreeRecords(
          prev.map((item) => {
            if (
              item.entity_type === entityTab &&
              (item.parent_id ?? null) === parentId &&
              rankMap.has(item.id)
            ) {
              return { ...item, sort_order: rankMap.get(item.id)! };
            }
            return item;
          })
        )
      );
    },
    [entityTab]
  );

  const reparentWithinRoot = useCallback(
    (nodeId: string, newParentId: string) => {
      setDraftCategories((prev) => {
        const byId = new Map(prev.map((c) => [c.id, c]));
        const moving = byId.get(nodeId);
        const targetParent = byId.get(newParentId);
        if (!moving || !targetParent) return prev;
        if (moving.is_system_root || moving.depth === 1) return prev;
        if (moving.root_key !== targetParent.root_key) return prev;
        if (moving.id === targetParent.id) return prev;
        if (targetParent.depth >= 3) return prev;

        const hasChildren = prev.some((c) => c.parent_id === moving.id);
        if (targetParent.depth === 2 && hasChildren) {
          onNotice?.({
            type: 'error',
            text: `Cannot demote "${moving.display_name}" to Level-3 while it still has Level-3 sub-categories. Move its children first.`,
          });
          return prev;
        }

        const existingSiblings = prev
          .filter((c) => c.parent_id === newParentId && c.id !== moving.id)
          .sort((a, b) => a.sort_order - b.sort_order);
        const nextSortOrder =
          existingSiblings.length > 0
            ? existingSiblings[existingSiblings.length - 1].sort_order + 10
            : 10;

        const updated = prev.map((c) =>
          c.id === moving.id
            ? {
                ...c,
                parent_id: newParentId,
                depth: (targetParent.depth + 1) as 1 | 2 | 3,
                sort_order: nextSortOrder,
              }
            : c
        );
        return normalizeTreeRecords(updated);
      });

      setExpandedL2Ids((prev) => new Set([...prev, newParentId]));
    },
    [onNotice]
  );

  const handleRootDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const activeId = String(active.id).replace(/^root:/, '');
      const overId = String(over.id).replace(/^root:/, '');
      const ids = taxonomyIndex.roots.map((r) => r.id);
      const oldIdx = ids.indexOf(activeId);
      const newIdx = ids.indexOf(overId);
      if (oldIdx === -1 || newIdx === -1) return;
      applySiblingReorder(null, arrayMove(ids, oldIdx, newIdx));
    },
    [applySiblingReorder, taxonomyIndex.roots]
  );

  const handleWithinRootDragEnd = useCallback(
    (root: CategoryRecord, event: DragEndEvent) => {
      const { active, over } = event;
      if (!over) return;

      const activeRaw = String(active.id);
      const overRaw = String(over.id);
      if (!activeRaw.startsWith('node:')) return;
      const activeId = activeRaw.slice(5);

      const activeNode = draftCategories.find((c) => c.id === activeId);
      if (!activeNode || activeNode.root_key !== root.root_key) return;

      if (overRaw === `promote-to-l2:${root.id}`) {
        if (activeNode.depth === 3) {
          reparentWithinRoot(activeNode.id, root.id);
          onNotice?.({
            type: 'info',
            text: `Staged promotion of "${activeNode.display_name}" to Level-2 under ${root.display_name}. Save Order & Structure to persist.`,
          });
        }
        return;
      }

      if (overRaw.startsWith('drop-into-l2:')) {
        const targetL2Id = overRaw.slice('drop-into-l2:'.length);
        const targetL2 = draftCategories.find((c) => c.id === targetL2Id);
        if (
          !targetL2 ||
          targetL2.root_key !== root.root_key ||
          targetL2.id === activeNode.id ||
          activeNode.parent_id === targetL2.id
        ) {
          return;
        }
        reparentWithinRoot(activeNode.id, targetL2.id);
        onNotice?.({
          type: 'info',
          text: `Staged move of "${activeNode.display_name}" under "${targetL2.display_name}". Save Order & Structure to persist.`,
        });
        return;
      }

      if (overRaw.startsWith('node:')) {
        const overId = overRaw.slice(5);
        if (activeId === overId) return;
        const overNode = draftCategories.find((c) => c.id === overId);
        if (!overNode || overNode.root_key !== root.root_key) return;

        if (activeNode.parent_id === overNode.parent_id) {
          const siblings = draftCategories
            .filter(
              (c) =>
                c.entity_type === entityTab &&
                c.parent_id === activeNode.parent_id
            )
            .sort((a, b) => a.sort_order - b.sort_order);
          const ids = siblings.map((s) => s.id);
          const oldIdx = ids.indexOf(activeId);
          const newIdx = ids.indexOf(overId);
          if (oldIdx !== -1 && newIdx !== -1) {
            applySiblingReorder(
              activeNode.parent_id,
              arrayMove(ids, oldIdx, newIdx)
            );
          }
          return;
        }

        if (
          activeNode.depth === 3 &&
          overNode.depth === 3 &&
          overNode.parent_id
        ) {
          reparentWithinRoot(activeNode.id, overNode.parent_id);
        }
      }
    },
    [
      applySiblingReorder,
      draftCategories,
      entityTab,
      onNotice,
      reparentWithinRoot,
    ]
  );

  const handleMoveSiblingDirection = useCallback(
    (parentId: string | null, itemId: string, direction: 'up' | 'down') => {
      const siblings = draftCategories
        .filter(
          (c) =>
            c.entity_type === entityTab && (c.parent_id ?? null) === parentId
        )
        .sort(
          (a, b) =>
            a.sort_order - b.sort_order ||
            a.display_name.localeCompare(b.display_name)
        );
      const ids = siblings.map((s) => s.id);
      const idx = ids.indexOf(itemId);
      if (idx === -1) return;
      const targetIdx = direction === 'up' ? idx - 1 : idx + 1;
      if (targetIdx < 0 || targetIdx >= ids.length) return;
      applySiblingReorder(parentId, arrayMove(ids, idx, targetIdx));
    },
    [applySiblingReorder, draftCategories, entityTab]
  );

  const handleSaveOrderAndStructure = useCallback(async () => {
    if (pendingDiff.count === 0) return;
    setSavingOrder(true);
    try {
      const orderedUpdates = [...pendingDiff.changed].sort(
        (a, b) => a.depth - b.depth || a.sort_order - b.sort_order
      );

      for (const item of orderedUpdates) {
        const updatePayload: Record<string, unknown> = {
          sort_order: item.sort_order,
        };
        if (!item.is_system_root && item.depth > 1) {
          updatePayload.parent_id = item.parent_id;
          updatePayload.depth = item.depth;
        }

        const { error } = await supabase
          .from('categories')
          .update(updatePayload)
          .eq('id', item.id);

        if (error) {
          throw new Error(
            `Failed updating "${item.display_name}": ${error.message}`
          );
        }
      }

      onNotice?.({
        type: 'success',
        text: `Saved ${pendingDiff.count} category order & structure change${pendingDiff.count === 1 ? '' : 's'}.`,
      });
      notifyAppConfigUpdated();
      await fetchCategories();
    } catch (err) {
      onNotice?.({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Unable to save category structure changes.',
      });
    } finally {
      setSavingOrder(false);
    }
  }, [fetchCategories, onNotice, pendingDiff]);

  const fetchReferenceCounts = useCallback(
    async (category: CategoryRecord): Promise<CategoryReferenceCounts> => {
      const childCount = draftCategories.filter(
        (c) => c.parent_id === category.id
      ).length;

      if (!isSupabaseConfigured()) {
        return {
          listings: 0,
          subscriptionPlans: 0,
          homepageItems: 0,
          paymentPolicies: 0,
          childCount,
          total: childCount,
        };
      }

      let listingsCount = 0;
      let plansCount = 0;
      let homepageCount = 0;
      let paymentCount = 0;

      try {
        const [listByIdRes, listBySubRes, plansRes, homeRes, payRes] =
          await Promise.all([
            supabase
              .from('listings')
              .select('id', { count: 'exact', head: true })
              .eq('category_id', category.id),
            supabase
              .from('listings')
              .select('id', { count: 'exact', head: true })
              .eq('subcategory', category.slug),
            supabase
              .from('subscription_plans')
              .select(
                'id, applicable_categories, applicable_subcategories, applicable_category_ids'
              ),
            supabase
              .from('homepage_items')
              .select('id', { count: 'exact', head: true })
              .ilike('target_url', `%${category.slug}%`),
            // v21a (P0-20): payment_feature_policies is keyed by `scope_key` (no id/feature_key)
            supabase
              .from('payment_feature_policies')
              .select('scope_key', { count: 'exact', head: true })
              .eq('scope_key', category.root_key),
          ]);

        listingsCount = Math.max(
          listByIdRes.count ?? 0,
          listBySubRes.count ?? 0
        );
        homepageCount = homeRes.count ?? 0;
        paymentCount = category.is_system_root ? (payRes.count ?? 0) : 0;

        if (!plansRes.error && Array.isArray(plansRes.data)) {
          plansCount = plansRes.data.filter((p) => {
            const cats = Array.isArray(p.applicable_categories)
              ? p.applicable_categories.map(String)
              : [];
            const subs = Array.isArray(p.applicable_subcategories)
              ? p.applicable_subcategories.map(String)
              : [];
            const ids = Array.isArray(p.applicable_category_ids)
              ? p.applicable_category_ids.map(String)
              : [];
            return (
              cats.includes(category.slug) ||
              subs.includes(category.slug) ||
              ids.includes(category.id)
            );
          }).length;
        }
      } catch {
        // Non-fatal
      }

      return {
        listings: listingsCount,
        subscriptionPlans: plansCount,
        homepageItems: homepageCount,
        paymentPolicies: paymentCount,
        childCount,
        total:
          listingsCount +
          plansCount +
          homepageCount +
          paymentCount +
          childCount,
      };
    },
    [draftCategories]
  );

  const openCreateModal = useCallback(
    (parentNode: CategoryRecord) => {
      if (parentNode.depth >= 3) {
        onNotice?.({
          type: 'error',
          text: 'Maximum taxonomy depth is 3 levels (Root → Level-2 → Level-3).',
        });
        return;
      }
      const nextDepth = (parentNode.depth + 1) as 2 | 3;
      const existingSiblings = draftCategories.filter(
        (c) => c.parent_id === parentNode.id
      );
      const nextSort =
        existingSiblings.length > 0
          ? Math.max(...existingSiblings.map((s) => s.sort_order)) + 10
          : 10;

      setDraft({
        entity_type: parentNode.entity_type,
        root_key: parentNode.root_key,
        parent_id: parentNode.id,
        depth: nextDepth,
        is_system_root: false,
        display_name: '',
        description: '',
        slug: '',
        icon_key: parentNode.icon_key,
        accent_color: parentNode.accent_color,
        sort_order: nextSort,
        is_active: true,
      });
      setTouched({});
      setSubmitAttempted(false);
      setSlugUnlocked(true);
      setAutoSlug(true);
      setRefCounts(null);
      setModalError(null);
      setModalOpen(true);
    },
    [draftCategories, onNotice]
  );

  const openEditModal = useCallback(
    (category: CategoryRecord) => {
      setDraft({
        id: category.id,
        entity_type: category.entity_type,
        root_key: category.root_key,
        parent_id: category.parent_id,
        depth: category.depth,
        is_system_root: category.is_system_root || category.depth === 1,
        display_name: category.display_name,
        description: category.description || '',
        slug: category.slug,
        icon_key: category.icon_key,
        accent_color: category.accent_color,
        sort_order: category.sort_order,
        is_active: category.is_active,
        originalSlug: category.slug,
      });
      setTouched({});
      setSubmitAttempted(false);
      setSlugUnlocked(false);
      setAutoSlug(false);
      setModalError(null);
      setRefCounts(null);
      setModalOpen(true);

      if (!category.is_system_root && category.depth > 1) {
        setLoadingRefs(true);
        void fetchReferenceCounts(category).then((counts) => {
          setRefCounts(counts);
          if (counts.total === 0) setSlugUnlocked(true);
          setLoadingRefs(false);
        });
      }
    },
    [fetchReferenceCounts]
  );

  const handleRequestSlugUnlock = useCallback(async () => {
    if (!draft) return;
    const totalRefs = refCounts?.total ?? 0;
    const ok = await confirm({
      title: 'Unlock referenced category slug?',
      description: `Changing the slug "${draft.slug}" affects ${totalRefs} live reference${totalRefs === 1 ? '' : 's'}. Existing deep links using "/explore?sub=${draft.slug}" may stop matching unless updated.`,
      confirmLabel: 'Unlock Slug Field',
      cancelLabel: 'Keep Locked',
      variant: 'danger',
    });
    if (ok) setSlugUnlocked(true);
  }, [confirm, draft, refCounts]);

  const draftErrors = useMemo(() => {
    if (!draft) return {};
    return validateCategoryDraft(draft, draftCategories);
  }, [draft, draftCategories]);

  const handleSaveModal = useCallback(async () => {
      if (!draft) return;
      setSubmitAttempted(true);
      setModalError(null);

      const errors = validateCategoryDraft(draft, draftCategories);
      if (Object.keys(errors).length > 0) return;

      setSavingModal(true);
      try {
        const cleanIcon = normalizeIconKey(draft.icon_key);
        const cleanColor = draft.accent_color.trim();
        const cleanName = draft.display_name.trim();
        const cleanDesc = draft.description.trim();

        if (draft.id) {
          const basePayload: Record<string, unknown> = {
            display_name: cleanName,
            description: cleanDesc || null,
            icon: cleanIcon,
            icon_key: cleanIcon,
            color_hex: cleanColor,
            accent_color: cleanColor,
            is_active: draft.is_active,
          };

          if (!draft.is_system_root) {
            basePayload.slug = draft.slug.trim().toLowerCase();
          }

          let { error } = await supabase
            .from('categories')
            .update(basePayload)
            .eq('id', draft.id);

          if (error && /description/i.test(error.message)) {
            delete basePayload.description;
            const retry = await supabase
              .from('categories')
              .update(basePayload)
              .eq('id', draft.id);
            error = retry.error;
          }

          if (error) throw error;
          onNotice?.({
            type: 'success',
            text: `Updated "${cleanName}" successfully.`,
          });
        } else {
          const insertPayload: Record<string, unknown> = {
            entity_type: draft.entity_type,
            root_key: draft.root_key,
            parent_id: draft.parent_id,
            depth: draft.depth,
            is_system_root: false,
            slug: draft.slug.trim().toLowerCase(),
            display_name: cleanName,
            description: cleanDesc || null,
            icon: cleanIcon,
            icon_key: cleanIcon,
            color_hex: cleanColor,
            accent_color: cleanColor,
            sort_order: draft.sort_order,
            is_active: draft.is_active,
          };

          let { error } = await supabase
            .from('categories')
            .insert(insertPayload);

          if (
            error &&
            /(root_key|description|is_system_root)/i.test(error.message)
          ) {
            delete insertPayload.root_key;
            delete insertPayload.description;
            delete insertPayload.is_system_root;
            insertPayload.depth = Math.max(0, draft.depth - 1);
            const retry = await supabase
              .from('categories')
              .insert(insertPayload);
            error = retry.error;
          }

          if (error) throw error;

          if (draft.parent_id) {
            setExpandedRootIds((prev) => new Set([...prev, draft.parent_id!]));
            setExpandedL2Ids((prev) => new Set([...prev, draft.parent_id!]));
          }

          onNotice?.({
            type: 'success',
            text: `Created Level-${draft.depth} category "${cleanName}".`,
          });
        }

        setModalOpen(false);
        setDraft(null);
        notifyAppConfigUpdated();
        await fetchCategories();
      } catch (err) {
        setModalError(
          err instanceof Error
            ? err.message
            : 'Unable to save category. Check permissions and try again.'
        );
      } finally {
        setSavingModal(false);
      }
    },
    [draft, draftCategories, fetchCategories, onNotice]
  );

  const handleToggleActive = useCallback(
    async (category: CategoryRecord) => {
      setBusyId(category.id);
      try {
        const nextActive = !category.is_active;
        const { error } = await supabase
          .from('categories')
          .update({ is_active: nextActive })
          .eq('id', category.id);
        if (error) throw error;

        onNotice?.({
          type: 'success',
          text: `${category.display_name} is now ${nextActive ? 'visible' : 'hidden'}.`,
        });
        notifyAppConfigUpdated();
        await fetchCategories();
      } catch (err) {
        onNotice?.({
          type: 'error',
          text:
            err instanceof Error
              ? err.message
              : 'Failed to toggle category visibility.',
        });
      } finally {
        setBusyId(null);
      }
    },
    [fetchCategories, onNotice]
  );

  const handleDeleteCategory = useCallback(
    async (category: CategoryRecord) => {
      if (category.is_system_root || category.depth === 1) {
        onNotice?.({
          type: 'error',
          text: 'Level-1 System Roots cannot be deleted.',
        });
        return;
      }

      setBusyId(category.id);
      try {
        const counts = await fetchReferenceCounts(category);
        if (counts.childCount > 0) {
          onNotice?.({
            type: 'error',
            text: `Cannot delete "${category.display_name}" while it has ${counts.childCount} Level-3 sub-categor${counts.childCount === 1 ? 'y' : 'ies'}. Move or delete its children first.`,
          });
          setBusyId(null);
          return;
        }

        if (counts.listings > 0 || counts.subscriptionPlans > 0) {
          const shouldHide = await confirm({
            title: `Cannot hard-delete "${category.display_name}"`,
            description: `This category is referenced by ${counts.listings} listing(s) and ${counts.subscriptionPlans} subscription plan(s). Hide it instead to preserve live records.`,
            confirmLabel: 'Hide Category Instead',
            cancelLabel: 'Cancel',
            variant: 'warning',
          });
          if (shouldHide && category.is_active) {
            await handleToggleActive(category);
          }
          setBusyId(null);
          return;
        }

        const ok = await confirm({
          title: `Delete "${category.display_name}"?`,
          description: `This permanently removes Level-${category.depth} category "/${category.slug}" from ${category.root_key}. This action is recorded in audit logs.`,
          confirmLabel: 'Delete Category',
          cancelLabel: 'Cancel',
          variant: 'danger',
        });

        if (!ok) {
          setBusyId(null);
          return;
        }

        const { error } = await supabase
          .from('categories')
          .delete()
          .eq('id', category.id);
        if (error) throw error;

        onNotice?.({
          type: 'success',
          text: `Deleted "${category.display_name}".`,
        });
        notifyAppConfigUpdated();
        await fetchCategories();
      } catch (err) {
        onNotice?.({
          type: 'error',
          text:
            err instanceof Error ? err.message : 'Failed to delete category.',
        });
      } finally {
        setBusyId(null);
      }
    },
    [
      confirm,
      fetchCategories,
      fetchReferenceCounts,
      handleToggleActive,
      onNotice,
    ]
  );

  const openMoveWithinRootModal = useCallback((category: CategoryRecord) => {
    if (category.is_system_root || category.depth === 1) return;
    setMoveModal({
      category,
      targetParentId: category.parent_id || '',
    });
  }, []);

  const moveModalContext = useMemo(() => {
    if (!moveModal) return null;
    const cat = moveModal.category;
    const rootNode = draftCategories.find(
      (c) =>
        c.entity_type === cat.entity_type &&
        c.root_key === cat.root_key &&
        c.depth === 1
    );
    const sameRootL2s = draftCategories
      .filter(
        (c) =>
          c.entity_type === cat.entity_type &&
          c.root_key === cat.root_key &&
          c.depth === 2 &&
          c.id !== cat.id
      )
      .sort((a, b) => a.sort_order - b.sort_order);

    const hasChildren = draftCategories.some((c) => c.parent_id === cat.id);
    return { rootNode, sameRootL2s, hasChildren };
  }, [draftCategories, moveModal]);

  const handleConfirmMoveWithinRoot = useCallback(() => {
    if (!moveModal || !moveModal.targetParentId) return;
    if (moveModal.targetParentId === moveModal.category.parent_id) {
      setMoveModal(null);
      return;
    }
    reparentWithinRoot(moveModal.category.id, moveModal.targetParentId);
    onNotice?.({
      type: 'info',
      text: `Staged move for "${moveModal.category.display_name}". Click Save Order & Structure to persist.`,
    });
    setMoveModal(null);
  }, [moveModal, onNotice, reparentWithinRoot]);

  const activeParentNode = useMemo(() => {
    if (!draft?.parent_id) return null;
    return draftCategories.find((c) => c.id === draft.parent_id) ?? null;
  }, [draft, draftCategories]);

  return (
    <div className="space-y-5 pb-24">
      {dialog}

      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="text-lg font-bold tracking-tight text-[var(--ps-text)]">
              3-Level Category Taxonomy Builder
            </h2>
            <span className="inline-flex items-center gap-1 rounded-md border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-2 py-0.5 text-[11px] font-semibold text-[var(--ps-text-muted)]">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>
                {CANONICAL_ALL_SYSTEM_ROOTS.length} Locked System Roots
              </span>
            </span>
          </div>
          <p className="mt-1 text-xs text-[var(--ps-text-muted)] max-w-2xl">
            Level-1 System Roots anchor listing forms, detail layouts, and
            payment policies. Add, edit, or reorder Level-2 &amp; Level-3
            sub-categories freely within each root.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void fetchCategories()}
          disabled={loading}
          className="inline-flex min-h-[44px] items-center gap-1.5 self-start rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3.5 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors cursor-pointer disabled:opacity-50"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`}
          />
          <span>Refresh</span>
        </button>
      </div>

      {/* Entity Type Tabs + Suggested Categories Review Queue */}
      <div className="flex flex-wrap items-center gap-2 border-b border-[var(--ps-border)] pb-3">
        {ENTITY_TYPE_TABS.map((tab) => {
          const isActive =
            activeViewMode === 'tree' && entityTab === tab.id;
          const count = draftCategories.filter(
            (c) => c.entity_type === tab.id
          ).length;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => {
                setActiveViewMode('tree');
                setEntityTab(tab.id);
              }}
              className={`inline-flex min-h-[44px] items-center gap-2 rounded-xl border px-3.5 text-xs font-semibold transition-colors cursor-pointer ${
                isActive
                  ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                  : 'border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
              }`}
            >
              <span>{tab.label}</span>
              <span
                className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
                  isActive
                    ? 'bg-[var(--ps-accent-fg)]/20 text-[var(--ps-accent-fg)]'
                    : 'bg-[var(--ps-surface-alt)] text-[var(--ps-text-muted)]'
                }`}
              >
                {count}
              </span>
            </button>
          );
        })}

        <button
          type="button"
          data-testid="category-builder-suggested-tab"
          onClick={() => setActiveViewMode('suggestions')}
          className={`inline-flex min-h-[44px] items-center gap-2 rounded-xl border px-3.5 text-xs font-semibold transition-colors cursor-pointer sm:ml-auto ${
            activeViewMode === 'suggestions'
              ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
              : pendingSuggestionsCount > 0
                ? 'border-amber-500/40 bg-amber-500/10 text-amber-800 dark:text-amber-300 hover:bg-amber-500/15'
                : 'border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
          }`}
        >
          <Sparkles className="h-3.5 w-3.5 shrink-0" />
          <span>Suggested Categories</span>
          <span
            className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
              activeViewMode === 'suggestions'
                ? 'bg-[var(--ps-accent-fg)]/20 text-[var(--ps-accent-fg)]'
                : pendingSuggestionsCount > 0
                  ? 'bg-amber-500 text-white'
                  : 'bg-[var(--ps-surface-alt)] text-[var(--ps-text-muted)]'
            }`}
          >
            {pendingSuggestionsCount}
          </span>
        </button>
      </div>

      {activeViewMode === 'suggestions' ? (
        <SuggestedCategoriesReview
          officialCategories={dbCategories}
          onResolved={fetchCategories}
          onNotice={onNotice}
        />
      ) : (
        <>

      {/* Summary Stats */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3">
          <p className="text-[11px] font-medium text-[var(--ps-text-muted)]">
            L1 System Roots
          </p>
          <p className="mt-1 text-xl font-bold tabular-nums text-[var(--ps-text)]">
            {stats.l1}
          </p>
        </div>
        <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3">
          <p className="text-[11px] font-medium text-[var(--ps-text-muted)]">
            L2 Categories
          </p>
          <p className="mt-1 text-xl font-bold tabular-nums text-[var(--ps-text)]">
            {stats.l2}
          </p>
        </div>
        <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3">
          <p className="text-[11px] font-medium text-[var(--ps-text-muted)]">
            L3 Sub-Categories
          </p>
          <p className="mt-1 text-xl font-bold tabular-nums text-[var(--ps-text)]">
            {stats.l3}
          </p>
        </div>
        <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3">
          <p className="text-[11px] font-medium text-[var(--ps-text-muted)]">
            Active Visible
          </p>
          <p className="mt-1 text-xl font-bold tabular-nums text-[var(--ps-text)]">
            {stats.activeCount} / {stats.total}
          </p>
        </div>
      </div>

      {/* Filter & Tree Expand Controls */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ps-text-muted)]" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Filter by root_key, label, or slug..."
            aria-label="Filter categories"
            className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] pl-10 pr-3.5 text-sm text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:border-[var(--ps-accent)] focus:outline-none"
          />
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setExpandedRootIds(new Set(taxonomyIndex.roots.map((r) => r.id)));
              const allL2Ids: string[] = [];
              for (const list of taxonomyIndex.l2ByRootId.values()) {
                for (const l2 of list) allL2Ids.push(l2.id);
              }
              setExpandedL2Ids(new Set(allL2Ids));
            }}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] cursor-pointer"
          >
            <Layers className="h-3.5 w-3.5" />
            <span>Expand All</span>
          </button>
          <button
            type="button"
            onClick={() => {
              setExpandedRootIds(new Set());
              setExpandedL2Ids(new Set());
            }}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] cursor-pointer"
          >
            <span>Collapse All</span>
          </button>
        </div>
      </div>

      {/* Main 3-Level Tree */}
      {loading ? (
        <CategoryBuilderSkeleton />
      ) : filteredTaxonomy.roots.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-surface)] px-6 py-10 text-center">
          <p className="text-sm font-semibold text-[var(--ps-text)]">
            No matching categories found.
          </p>
          <p className="mt-1 text-xs text-[var(--ps-text-muted)]">
            {searchQuery.trim()
              ? 'Try clearing your search filter.'
              : 'Run the v16b SQL migration to seed the 11 locked Level-1 System Roots.'}
          </p>
        </div>
      ) : (
        <DndContext
          sensors={rootSensors}
          collisionDetection={closestCenter}
          onDragEnd={handleRootDragEnd}
        >
          <SortableContext
            items={filteredTaxonomy.roots.map((r) => `root:${r.id}`)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-3.5">
              {filteredTaxonomy.roots.map((root, rootIdx) => {
                const isRootExpanded =
                  Boolean(searchQuery.trim()) || expandedRootIds.has(root.id);
                return (
                  <RootSortableCard
                    key={root.id}
                    root={root}
                    l2Nodes={filteredTaxonomy.l2ByRootId.get(root.id) || []}
                    l3ByParentId={filteredTaxonomy.l3ByL2Id}
                    index={rootIdx}
                    total={filteredTaxonomy.roots.length}
                    isExpanded={isRootExpanded}
                    expandedL2Ids={
                      searchQuery.trim()
                        ? new Set(
                            (filteredTaxonomy.l2ByRootId.get(root.id) || []).map(
                              (l2) => l2.id
                            )
                          )
                        : expandedL2Ids
                    }
                    onToggleExpandRoot={() =>
                      setExpandedRootIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(root.id)) next.delete(root.id);
                        else next.add(root.id);
                        return next;
                      })
                    }
                    onToggleExpandL2={(l2Id) =>
                      setExpandedL2Ids((prev) => {
                        const next = new Set(prev);
                        if (next.has(l2Id)) next.delete(l2Id);
                        else next.add(l2Id);
                        return next;
                      })
                    }
                    onMoveRootUp={() =>
                      handleMoveSiblingDirection(null, root.id, 'up')
                    }
                    onMoveRootDown={() =>
                      handleMoveSiblingDirection(null, root.id, 'down')
                    }
                    onMoveL2={(l2Id, dir) =>
                      handleMoveSiblingDirection(root.id, l2Id, dir)
                    }
                    onMoveL3={(l3Id, dir) => {
                      const l3 = draftCategories.find((c) => c.id === l3Id);
                      if (l3?.parent_id) {
                        handleMoveSiblingDirection(l3.parent_id, l3Id, dir);
                      }
                    }}
                    onWithinRootDragEnd={handleWithinRootDragEnd}
                    onAddL2={() => openCreateModal(root)}
                    onAddL3={(parentL2) => openCreateModal(parentL2)}
                    onOpenMoveModal={openMoveWithinRootModal}
                    onEdit={openEditModal}
                    onToggleActive={(node) => void handleToggleActive(node)}
                    onDelete={(node) => void handleDeleteCategory(node)}
                    busyId={busyId}
                  />
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      )}
        </>
      )}

      {/* Create / Edit Category Modal */}
      {modalOpen && draft && (
        <FormModal
          isOpen={modalOpen}
          onClose={() => {
            if (!savingModal) {
              setModalOpen(false);
              setDraft(null);
            }
          }}
          title={
            draft.id
              ? draft.is_system_root
                ? `Edit System Root — ${draft.root_key}`
                : `Edit Level-${draft.depth} Category`
              : `Add Level-${draft.depth} Category`
          }
          subtitle={
            draft.is_system_root
              ? 'System Root structure and root_key are locked. Update display label, description, icon, color, or visibility.'
              : activeParentNode
                ? `Parent: ${activeParentNode.display_name} · Root: ${draft.root_key}`
                : `Root: ${draft.root_key}`
          }
          isDirty={
            Boolean(draft.display_name.trim()) ||
            Boolean(draft.description.trim()) ||
            Boolean(draft.id)
          }
          isValid={Object.keys(draftErrors).length === 0}
          validationSummary={Object.values(draftErrors)}
          onSubmitAttempt={() => setSubmitAttempted(true)}
          submitLabel={draft.id ? 'Review & Save Category' : 'Review & Create Category'}
          confirmSubmitTitle={
            draft.id
              ? `Save changes to "${draft.display_name.trim() || draft.root_key}"?`
              : `Create Level-${draft.depth} category "${draft.display_name.trim() || 'New Category'}"?`
          }
          confirmSubmitDescription="Writes to public.categories under super_admin RLS, triggers materialized path updates, and logs to public.audit_logs."
          confirmSubmitImpact={[
            `System Root: ${draft.root_key} (Level ${draft.depth})`,
            `Slug: /${draft.slug || 'auto'}`,
            `Visibility: ${draft.is_active ? 'Active in Directory' : 'Hidden'}`,
          ]}
          confirmSubmitVariant="info"
          isSubmitting={savingModal}
          maxWidthClassName="max-w-2xl"
          onSubmit={handleSaveModal}
        >
          <div className="space-y-4">
            {modalError && (
              <div className="flex items-start gap-2 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3.5 py-2.5 text-xs text-rose-700 dark:text-rose-300">
                <ShieldAlert className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{modalError}</span>
              </div>
            )}

            {draft.is_system_root && (
              <div className="flex items-start gap-2.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-3.5 py-3 text-xs text-[var(--ps-text-muted)]">
                <Lock className="h-4 w-4 shrink-0 mt-0.5 text-[var(--ps-text)]" />
                <div>
                  <p className="font-semibold text-[var(--ps-text)]">
                    Immutable System Root ({draft.root_key})
                  </p>
                  <p className="mt-0.5">
                    <code>root_key</code>, URL slug, entity type, and depth are
                    enforced at the database level so vertical forms, detail
                    pages, and payment policies never break.
                  </p>
                </div>
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-[var(--ps-text)]">
                  Display Label <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={draft.display_name}
                  onChange={(e) => {
                    const nextName = e.target.value;
                    setDraft((prev) => {
                      if (!prev) return prev;
                      return {
                        ...prev,
                        display_name: nextName,
                        slug:
                          !prev.is_system_root && autoSlug && !prev.id
                            ? slugifyCategory(nextName)
                            : prev.slug,
                      };
                    });
                  }}
                  onBlur={() =>
                    setTouched((prev) => ({ ...prev, display_name: true }))
                  }
                  placeholder="e.g. Hardware & Tools"
                  className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 text-sm text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none"
                />
                {(touched.display_name || submitAttempted) &&
                  draftErrors.display_name && (
                    <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">
                      {draftErrors.display_name}
                    </p>
                  )}
              </div>

              <div>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <label className="text-xs font-semibold text-[var(--ps-text)]">
                    URL Slug{' '}
                    {!draft.is_system_root && (
                      <span className="text-rose-500">*</span>
                    )}
                  </label>
                  {!draft.is_system_root && draft.id && !slugUnlocked && (
                    <button
                      type="button"
                      onClick={() => void handleRequestSlugUnlock()}
                      className="inline-flex items-center gap-1 text-[11px] font-semibold text-amber-700 dark:text-amber-300 hover:underline cursor-pointer"
                    >
                      <Unlock className="h-3 w-3" />
                      <span>Unlock</span>
                    </button>
                  )}
                </div>
                <div className="relative">
                  <input
                    type="text"
                    value={draft.slug}
                    disabled={draft.is_system_root || !slugUnlocked}
                    onChange={(e) => {
                      setAutoSlug(false);
                      setDraft((prev) =>
                        prev
                          ? { ...prev, slug: e.target.value.toLowerCase() }
                          : prev
                      );
                    }}
                    onBlur={() =>
                      setTouched((prev) => ({ ...prev, slug: true }))
                    }
                    placeholder="hardware-tools"
                    className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 font-mono text-sm text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none disabled:cursor-not-allowed disabled:bg-[var(--ps-surface-alt)] disabled:text-[var(--ps-text-muted)]"
                  />
                  {(draft.is_system_root || !slugUnlocked) && (
                    <Lock className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ps-text-muted)]" />
                  )}
                </div>
                {loadingRefs && (
                  <p className="mt-1 text-[11px] text-[var(--ps-text-muted)]">
                    Checking live references...
                  </p>
                )}
                {!loadingRefs && refCounts && refCounts.total > 0 && (
                  <p className="mt-1 text-[11px] text-amber-700 dark:text-amber-300">
                    Referenced by {refCounts.listings} listing(s),{' '}
                    {refCounts.subscriptionPlans} plan(s),{' '}
                    {refCounts.childCount} child(ren).
                  </p>
                )}
                {(touched.slug || submitAttempted) && draftErrors.slug && (
                  <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">
                    {draftErrors.slug}
                  </p>
                )}
              </div>
            </div>

            <div>
              <label className="mb-1.5 block text-xs font-semibold text-[var(--ps-text)]">
                Short Description (optional)
              </label>
              <textarea
                rows={2}
                value={draft.description}
                onChange={(e) =>
                  setDraft((prev) =>
                    prev ? { ...prev, description: e.target.value } : prev
                  )
                }
                onBlur={() =>
                  setTouched((prev) => ({ ...prev, description: true }))
                }
                placeholder="Brief helper copy shown in admin builders and tooltips..."
                className="w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 py-2.5 text-sm text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none"
              />
              {(touched.description || submitAttempted) &&
                draftErrors.description && (
                  <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">
                    {draftErrors.description}
                  </p>
                )}
            </div>

            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className="mb-1.5 block text-xs font-semibold text-[var(--ps-text)]">
                  Icon
                </label>
                <IconPicker
                  value={draft.icon_key}
                  onChange={(nextKey) =>
                    setDraft((prev) =>
                      prev ? { ...prev, icon_key: nextKey } : prev
                    )
                  }
                />
              </div>

              <div>
                <label className="mb-1.5 block text-xs font-semibold text-[var(--ps-text)]">
                  Accent Color
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={
                      HEX_REGEX.test(draft.accent_color)
                        ? draft.accent_color
                        : '#2563EB'
                    }
                    onChange={(e) =>
                      setDraft((prev) =>
                        prev ? { ...prev, accent_color: e.target.value } : prev
                      )
                    }
                    className="h-11 w-11 shrink-0 cursor-pointer rounded-xl border border-[var(--ps-border)] bg-transparent p-1"
                    aria-label="Pick accent color"
                  />
                  <input
                    type="text"
                    value={draft.accent_color}
                    onChange={(e) =>
                      setDraft((prev) =>
                        prev ? { ...prev, accent_color: e.target.value } : prev
                      )
                    }
                    onBlur={() =>
                      setTouched((prev) => ({ ...prev, accent_color: true }))
                    }
                    className="min-h-[44px] flex-1 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 font-mono text-sm text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none"
                  />
                </div>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {ACCENT_PRESETS.map((hex) => (
                    <button
                      key={hex}
                      type="button"
                      onClick={() =>
                        setDraft((prev) =>
                          prev ? { ...prev, accent_color: hex } : prev
                        )
                      }
                      className={`h-7 w-7 rounded-lg border transition-transform cursor-pointer ${
                        draft.accent_color.toLowerCase() === hex.toLowerCase()
                          ? 'scale-110 border-[var(--ps-text)] ring-2 ring-[var(--ps-accent)]/40'
                          : 'border-[var(--ps-border)]'
                      }`}
                      style={{ backgroundColor: hex }}
                      aria-label={`Select color ${hex}`}
                    />
                  ))}
                </div>
                {(touched.accent_color || submitAttempted) &&
                  draftErrors.accent_color && (
                    <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">
                      {draftErrors.accent_color}
                    </p>
                  )}
              </div>
            </div>

            <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 py-2.5">
              <div>
                <p className="text-xs font-semibold text-[var(--ps-text)]">
                  Active &amp; Visible in Directory
                </p>
                <p className="text-[11px] text-[var(--ps-text-muted)]">
                  Hidden categories remain preserved for historical listings but
                  are excluded from new listing pickers.
                </p>
              </div>
              <input
                type="checkbox"
                checked={draft.is_active}
                onChange={(e) =>
                  setDraft((prev) =>
                    prev ? { ...prev, is_active: e.target.checked } : prev
                  )
                }
                className="h-5 w-5 accent-[var(--ps-accent)] cursor-pointer"
              />
            </label>

          </div>
        </FormModal>
      )}

      {/* Move Within Root Modal */}
      {moveModal && moveModalContext && (
        <FormModal
          isOpen={Boolean(moveModal)}
          onClose={() => setMoveModal(null)}
          title={`Move "${moveModal.category.display_name}" Within Root`}
          subtitle={`Strictly scoped to System Root: ${moveModal.category.root_key}. Cross-root moves are disabled to protect vertical listing schemas.`}
          isDirty={
            Boolean(moveModal.targetParentId) &&
            moveModal.targetParentId !== moveModal.category.parent_id
          }
          isValid={
            Boolean(moveModal.targetParentId) &&
            !(moveModal.category.depth === 2 && moveModalContext.hasChildren)
          }
          validationSummary={
            moveModal.category.depth === 2 && moveModalContext.hasChildren
              ? [
                  'Move or promote Level-3 children before demoting this Level-2 category.',
                ]
              : undefined
          }
          submitLabel="Stage Move"
          confirmSubmitTitle={`Stage move for "${moveModal.category.display_name}"?`}
          confirmSubmitDescription="Stages this intra-root move locally. Click Save Order & Structure in the bottom bar to persist to Supabase."
          confirmSubmitVariant="info"
          maxWidthClassName="max-w-lg"
          onSubmit={handleConfirmMoveWithinRoot}
        >
          <div className="space-y-4">
            {moveModal.category.depth === 2 && moveModalContext.hasChildren ? (
              <div className="flex items-start gap-2.5 rounded-xl border border-amber-400/50 bg-amber-500/10 p-3.5 text-xs text-amber-800 dark:text-amber-300">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
                <div>
                  <p className="font-semibold">
                    Cannot demote this Level-2 category yet
                  </p>
                  <p className="mt-1">
                    <strong>{moveModal.category.display_name}</strong> currently
                    contains Level-3 sub-categories. Promote or move its Level-3
                    children to another Level-2 parent first so max depth stays
                    within 3 levels.
                  </p>
                </div>
              </div>
            ) : (
              <div className="space-y-2.5">
                <label className="block text-xs font-semibold text-[var(--ps-text)]">
                  Select New Parent Inside{' '}
                  <span className="font-mono">
                    {moveModal.category.root_key}
                  </span>
                </label>

                <div className="space-y-2">
                  {moveModalContext.rootNode && (
                    <label
                      className={`flex min-h-[48px] cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2.5 transition-colors ${
                        moveModal.targetParentId ===
                        moveModalContext.rootNode.id
                          ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)]/8'
                          : 'border-[var(--ps-border)] bg-[var(--ps-bg)] hover:bg-[var(--ps-surface-alt)]'
                      }`}
                    >
                      <input
                        type="radio"
                        name="moveTargetParent"
                        checked={
                          moveModal.targetParentId ===
                          moveModalContext.rootNode.id
                        }
                        onChange={() =>
                          setMoveModal((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  targetParentId: moveModalContext.rootNode!.id,
                                }
                              : null
                          )
                        }
                        className="h-4 w-4 accent-[var(--ps-accent)]"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-[var(--ps-text)]">
                          {moveModalContext.rootNode.display_name} (Promote to
                          Level-2)
                        </p>
                        <p className="text-[11px] text-[var(--ps-text-muted)]">
                          Places this category directly under the Level-1 System
                          Root.
                        </p>
                      </div>
                    </label>
                  )}

                  {moveModalContext.sameRootL2s.map((siblingL2) => (
                    <label
                      key={siblingL2.id}
                      className={`flex min-h-[48px] cursor-pointer items-center gap-3 rounded-xl border px-3.5 py-2.5 transition-colors ${
                        moveModal.targetParentId === siblingL2.id
                          ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)]/8'
                          : 'border-[var(--ps-border)] bg-[var(--ps-bg)] hover:bg-[var(--ps-surface-alt)]'
                      }`}
                    >
                      <input
                        type="radio"
                        name="moveTargetParent"
                        checked={moveModal.targetParentId === siblingL2.id}
                        onChange={() =>
                          setMoveModal((prev) =>
                            prev
                              ? { ...prev, targetParentId: siblingL2.id }
                              : null
                          )
                        }
                        className="h-4 w-4 accent-[var(--ps-accent)]"
                      />
                      <div className="min-w-0 flex-1">
                        <p className="text-xs font-semibold text-[var(--ps-text)]">
                          ↳ {siblingL2.display_name}{' '}
                          <span className="font-normal text-[var(--ps-text-muted)]">
                            (Nest as Level-3)
                          </span>
                        </p>
                        <p className="font-mono text-[11px] text-[var(--ps-text-muted)]">
                          /{siblingL2.slug}
                        </p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>
            )}

          </div>
        </FormModal>
      )}

      {/* Sticky Batched Save Bar */}
      {pendingDiff.count > 0 && (
        <div
          role="region"
          aria-label="Unsaved category order and structure changes"
          className="fixed bottom-4 left-4 right-4 z-[80] mx-auto max-w-3xl rounded-2xl border border-[var(--ps-accent)]/45 bg-[var(--ps-surface)]/95 p-3 shadow-2xl backdrop-blur-md sm:px-4"
        >
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-bold text-[var(--ps-text)]">
                Unsaved Structure &amp; Order Changes ({pendingDiff.count})
              </p>
              <p className="text-[11px] text-[var(--ps-text-muted)]">
                {pendingDiff.moveCount > 0
                  ? `${pendingDiff.moveCount} reparent move${pendingDiff.moveCount === 1 ? '' : 's'} & `
                  : ''}
                {pendingDiff.orderCount} sort update
                {pendingDiff.orderCount === 1 ? '' : 's'} staged locally. Save
                to persist to Supabase.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setDraftCategories(dbCategories)}
                disabled={savingOrder}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] disabled:opacity-50 cursor-pointer"
              >
                <Undo2 className="h-3.5 w-3.5" />
                <span>Discard</span>
              </button>
              <button
                type="button"
                onClick={() => void handleSaveOrderAndStructure()}
                disabled={savingOrder}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-4 text-xs font-bold text-[var(--ps-accent-fg)] shadow-xs hover:opacity-95 disabled:opacity-50 cursor-pointer"
              >
                {savingOrder ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                <span>Save Order &amp; Structure</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
