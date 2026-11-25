'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  GitMerge,
  Pencil,
  RefreshCw,
  Search,
  Sparkles,
  User,
  XCircle,
} from 'lucide-react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase/client';
import { normalizeIconKey } from '@/lib/icons/registry';
import { FormModal } from '@/components/ui/FormModal';
import { IconPicker } from '@/components/ui/IconPicker';
import { useConfirmDialogState } from '@/components/ui/ConfirmDialog';
import { notifyAppConfigUpdated } from '@/components/providers/AppConfigProvider';
import {
  slugifyCategory,
  type CategoryEntityType,
  type CategoryRecord,
} from '@/components/workspaces/superadmin/CategoryTreeRows';

export type CategoryReviewStatus =
  | 'official'
  | 'pending_review'
  | 'merged'
  | 'rejected';

export interface SuggestedCategoryRow {
  id: string;
  entity_type: CategoryEntityType;
  root_key: string;
  parent_id: string | null;
  depth: number;
  slug: string;
  display_name: string;
  icon_key: string;
  accent_color: string;
  is_active: boolean;
  review_status: CategoryReviewStatus;
  suggested_by: string | null;
  merged_into_category_id: string | null;
  review_notes: string | null;
  created_at: string | null;
}

interface EditRelinkDraft {
  id: string;
  entity_type: CategoryEntityType;
  root_key: string;
  display_name: string;
  slug: string;
  icon_key: string;
  accent_color: string;
  parent_id: string;
  review_notes: string;
}

interface SuggestedCategoriesReviewProps {
  officialCategories: CategoryRecord[];
  onResolved: () => Promise<void>;
  onNotice?: (notice: {
    type: 'success' | 'error' | 'info';
    text: string;
  }) => void;
}

const SLUG_REGEX = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const HEX_REGEX = /^#[0-9a-fA-F]{6}$/;

const ACCENT_PRESETS = [
  '#2563EB',
  '#059669',
  '#D97706',
  '#E11D48',
  '#7C3AED',
  '#0891B2',
];

export function SuggestedCategoriesReview({
  officialCategories,
  onResolved,
  onNotice,
}: SuggestedCategoriesReviewProps) {
  const { confirm, dialog } = useConfirmDialogState();

  const [statusFilter, setStatusFilter] = useState<
    'pending_review' | 'merged' | 'rejected'
  >('pending_review');
  const [searchQuery, setSearchQuery] = useState('');
  const [rows, setRows] = useState<SuggestedCategoryRow[]>([]);
  const [suggesterMap, setSuggesterMap] = useState<Map<string, string>>(
    new Map()
  );
  const [listingCountMap, setListingCountMap] = useState<Map<string, number>>(
    new Map()
  );
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Edit & Relink modal state
  const [editDraft, setEditDraft] = useState<EditRelinkDraft | null>(null);
  const [editTouched, setEditTouched] = useState<Record<string, boolean>>({});
  const [editSubmitted, setEditSubmitted] = useState(false);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);

  // Merge Into Existing modal state
  const [mergeSource, setMergeSource] = useState<SuggestedCategoryRow | null>(
    null
  );
  const [mergeSearch, setMergeSearch] = useState('');
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [mergeNotes, setMergeNotes] = useState('');
  const [mergeSubmitted, setMergeSubmitted] = useState(false);
  const [mergeSaving, setMergeSaving] = useState(false);
  const [mergeError, setMergeError] = useState<string | null>(null);

  // Reject modal state
  const [rejectSource, setRejectSource] = useState<SuggestedCategoryRow | null>(
    null
  );
  const [rejectNotes, setRejectNotes] = useState('');
  const [rejectSaving, setRejectSaving] = useState(false);
  const [rejectError, setRejectError] = useState<string | null>(null);

  const officialById = useMemo(
    () => new Map(officialCategories.map((c) => [c.id, c])),
    [officialCategories]
  );

  const fetchSuggestions = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('categories')
        .select(
          'id, entity_type, root_key, parent_id, depth, slug, display_name, icon_key, accent_color, is_active, review_status, suggested_by, merged_into_category_id, review_notes, created_at'
        )
        .in('review_status', ['pending_review', 'merged', 'rejected'])
        .order('created_at', { ascending: false });

      if (error) throw error;

      const list: SuggestedCategoryRow[] = ((data || []) as Array<Record<string, unknown>>)
        .filter((r) =>
          ['listing', 'product', 'bulletin', 'vehicle'].includes(
            String(r.entity_type || '')
          )
        )
        .map((r) => ({
          id: String(r.id),
          entity_type: String(r.entity_type) as CategoryEntityType,
          root_key: String(r.root_key || ''),
          parent_id: r.parent_id ? String(r.parent_id) : null,
          depth: Number(r.depth ?? 2),
          slug: String(r.slug || ''),
          display_name: String(r.display_name || r.slug || ''),
          icon_key: normalizeIconKey(
            typeof r.icon_key === 'string' && r.icon_key.trim()
              ? r.icon_key
              : 'tag'
          ),
          accent_color:
            typeof r.accent_color === 'string' && r.accent_color.trim()
              ? r.accent_color.trim()
              : '#D97706',
          is_active: Boolean(r.is_active ?? false),
          review_status: String(
            r.review_status || 'pending_review'
          ) as CategoryReviewStatus,
          suggested_by: r.suggested_by ? String(r.suggested_by) : null,
          merged_into_category_id: r.merged_into_category_id
            ? String(r.merged_into_category_id)
            : null,
          review_notes:
            typeof r.review_notes === 'string' ? r.review_notes : null,
          created_at: r.created_at ? String(r.created_at) : null,
        }));

      setRows(list);

      // Resolve suggester profiles & live listing impact counts in parallel
      const userIds = Array.from(
        new Set(list.map((r) => r.suggested_by).filter((id): id is string => Boolean(id)))
      );
      const catIds = list.map((r) => r.id);

      const [profilesRes, listingsRes] = await Promise.all([
        userIds.length > 0
          ? supabase
              .from('profiles')
              .select('id, full_name, email')
              .in('id', userIds)
          : Promise.resolve({ data: null }),
        catIds.length > 0
          ? supabase
              .from('listings')
              .select('category_id')
              .in('category_id', catIds)
          : Promise.resolve({ data: null }),
      ]);

      const nextSuggesters = new Map<string, string>();
      if (Array.isArray(profilesRes.data)) {
        for (const p of profilesRes.data as Array<Record<string, unknown>>) {
          const pid = String(p.id || '');
          const name =
            (typeof p.full_name === 'string' && p.full_name.trim()) ||
            (typeof p.email === 'string' && p.email.trim()) ||
            pid.slice(0, 8);
          if (pid) nextSuggesters.set(pid, name);
        }
      }
      setSuggesterMap(nextSuggesters);

      const nextCounts = new Map<string, number>();
      if (Array.isArray(listingsRes.data)) {
        for (const l of listingsRes.data as Array<Record<string, unknown>>) {
          const cid = l.category_id ? String(l.category_id) : '';
          if (cid) nextCounts.set(cid, (nextCounts.get(cid) || 0) + 1);
        }
      }
      setListingCountMap(nextCounts);
    } catch (err) {
      onNotice?.({
        type: 'error',
        text:
          err instanceof Error
            ? `Failed to load suggested categories: ${err.message}`
            : 'Failed to load suggested categories.',
      });
    } finally {
      setLoading(false);
    }
  }, [onNotice]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void fetchSuggestions();
    });
    return () => {
      active = false;
    };
  }, [fetchSuggestions]);

  const countsByStatus = useMemo(() => {
    let pending = 0;
    let merged = 0;
    let rejected = 0;
    for (const r of rows) {
      if (r.review_status === 'pending_review') pending += 1;
      else if (r.review_status === 'merged') merged += 1;
      else if (r.review_status === 'rejected') rejected += 1;
    }
    return { pending, merged, rejected };
  }, [rows]);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return rows.filter((r) => {
      if (r.review_status !== statusFilter) return false;
      if (!q) return true;
      const parentName = r.parent_id
        ? officialById.get(r.parent_id)?.display_name || ''
        : '';
      const suggester = r.suggested_by
        ? suggesterMap.get(r.suggested_by) || ''
        : '';
      return (
        r.display_name.toLowerCase().includes(q) ||
        r.slug.toLowerCase().includes(q) ||
        r.root_key.toLowerCase().includes(q) ||
        parentName.toLowerCase().includes(q) ||
        suggester.toLowerCase().includes(q)
      );
    });
  }, [officialById, rows, searchQuery, statusFilter, suggesterMap]);

  const buildParentBreadcrumb = useCallback(
    (row: SuggestedCategoryRow): string => {
      if (!row.parent_id) return row.root_key || 'Root';
      const parent = officialById.get(row.parent_id);
      if (!parent) return row.root_key || 'Root';
      if (parent.parent_id) {
        const grandParent = officialById.get(parent.parent_id);
        if (grandParent) {
          return `${grandParent.display_name} › ${parent.display_name}`;
        }
      }
      return parent.display_name;
    },
    [officialById]
  );

  // 1. Approve & Publish directly
  const handleQuickApprove = async (row: SuggestedCategoryRow) => {
    const refCount = listingCountMap.get(row.id) || 0;
    const ok = await confirm({
      title: `Approve & Publish "${row.display_name}"?`,
      description: `Promotes "/${row.slug}" to an official Level-${row.depth} category under ${buildParentBreadcrumb(row)} and makes it visible across Explore & Listing forms.`,
      impactSummary: [
        `Root: ${row.root_key}`,
        `Parent: ${buildParentBreadcrumb(row)}`,
        `${refCount} referencing listing${refCount === 1 ? '' : 's'} will remain linked`,
      ],
      confirmLabel: 'Approve & Publish',
      variant: 'info',
    });
    if (!ok) return;

    setBusyId(row.id);
    try {
      const { error } = await supabase.rpc('review_suggested_category', {
        p_category_id: row.id,
        p_action: 'approve',
      });
      if (error) throw new Error(error.message);

      notifyAppConfigUpdated();
      onNotice?.({
        type: 'success',
        text: `Approved & published "${row.display_name}" as an official category.`,
      });
      await Promise.all([fetchSuggestions(), onResolved()]);
    } catch (err) {
      onNotice?.({
        type: 'error',
        text:
          err instanceof Error ? err.message : 'Failed to approve category.',
      });
    } finally {
      setBusyId(null);
    }
  };

  // 2. Edit & Relink modal
  const openEditRelinkModal = (row: SuggestedCategoryRow) => {
    setEditDraft({
      id: row.id,
      entity_type: row.entity_type,
      root_key: row.root_key,
      display_name: row.display_name,
      slug: row.slug,
      icon_key: row.icon_key,
      accent_color: row.accent_color,
      parent_id: row.parent_id || '',
      review_notes: row.review_notes || '',
    });
    setEditTouched({});
    setEditSubmitted(false);
    setEditError(null);
  };

  const editParentOptions = useMemo(() => {
    if (!editDraft) return [];
    return officialCategories
      .filter(
        (c) =>
          c.entity_type === editDraft.entity_type &&
          c.root_key === editDraft.root_key &&
          c.is_active &&
          (c.depth === 1 || c.depth === 2)
      )
      .sort(
        (a, b) =>
          a.depth - b.depth ||
          a.sort_order - b.sort_order ||
          a.display_name.localeCompare(b.display_name)
      );
  }, [editDraft, officialCategories]);

  const editValidationErrors = useMemo(() => {
    const errs: Record<string, string> = {};
    if (!editDraft) return errs;
    const trimmedName = editDraft.display_name.trim();
    const trimmedSlug = editDraft.slug.trim().toLowerCase();
    if (trimmedName.length < 2) {
      errs.display_name = 'Display label must be at least 2 characters.';
    } else if (trimmedName.length > 60) {
      errs.display_name = 'Display label must be 60 characters or fewer.';
    }
    if (!trimmedSlug || !SLUG_REGEX.test(trimmedSlug)) {
      errs.slug =
        'Slug must use lowercase letters, numbers, hyphens, or underscores.';
    }
    if (!HEX_REGEX.test(editDraft.accent_color.trim())) {
      errs.accent_color = 'Use a valid 6-digit hex color (e.g. #2563EB).';
    }
    if (!editDraft.parent_id) {
      errs.parent_id = 'Select a parent category within the same root.';
    }
    return errs;
  }, [editDraft]);

  const handleSaveEditRelink = async () => {
    if (!editDraft) return;
    setEditSubmitted(true);
    if (Object.keys(editValidationErrors).length > 0) return;

    setEditSaving(true);
    setEditError(null);
    try {
      const { error } = await supabase.rpc('review_suggested_category', {
        p_category_id: editDraft.id,
        p_action: 'approve',
        p_display_name: editDraft.display_name.trim(),
        p_slug: editDraft.slug.trim().toLowerCase(),
        p_icon_key: editDraft.icon_key,
        p_accent_color: editDraft.accent_color.trim(),
        p_parent_id: editDraft.parent_id,
        p_review_notes: editDraft.review_notes.trim() || null,
      });
      if (error) throw new Error(error.message);

      notifyAppConfigUpdated();
      onNotice?.({
        type: 'success',
        text: `Revised & published "${editDraft.display_name.trim()}".`,
      });
      setEditDraft(null);
      await Promise.all([fetchSuggestions(), onResolved()]);
    } catch (err) {
      setEditError(
        err instanceof Error
          ? err.message
          : 'Failed to revise & publish category.'
      );
    } finally {
      setEditSaving(false);
    }
  };

  // 3. Merge Into Existing modal
  const openMergeModal = (row: SuggestedCategoryRow) => {
    setMergeSource(row);
    setMergeSearch('');
    setMergeTargetId('');
    setMergeNotes('');
    setMergeSubmitted(false);
    setMergeError(null);
  };

  const mergeCandidates = useMemo(() => {
    if (!mergeSource) return [];
    const q = mergeSearch.trim().toLowerCase();
    return officialCategories
      .filter(
        (c) =>
          c.entity_type === mergeSource.entity_type &&
          c.is_active &&
          c.id !== mergeSource.id &&
          c.depth >= 2
      )
      .filter((c) => {
        if (!q) return true;
        return (
          c.display_name.toLowerCase().includes(q) ||
          c.slug.toLowerCase().includes(q) ||
          c.root_key.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => {
        const aSameRoot = a.root_key === mergeSource.root_key ? 0 : 1;
        const bSameRoot = b.root_key === mergeSource.root_key ? 0 : 1;
        return (
          aSameRoot - bSameRoot ||
          a.depth - b.depth ||
          a.display_name.localeCompare(b.display_name)
        );
      });
  }, [mergeSearch, mergeSource, officialCategories]);

  const handleConfirmMerge = async () => {
    if (!mergeSource) return;
    setMergeSubmitted(true);
    if (!mergeTargetId) return;

    const targetNode = officialById.get(mergeTargetId);
    const refCount = listingCountMap.get(mergeSource.id) || 0;

    setMergeSaving(true);
    setMergeError(null);
    try {
      const { error } = await supabase.rpc('merge_suggested_category', {
        p_source_id: mergeSource.id,
        p_target_id: mergeTargetId,
        p_review_notes: mergeNotes.trim() || null,
      });
      if (error) throw new Error(error.message);

      notifyAppConfigUpdated();
      onNotice?.({
        type: 'success',
        text: `Merged "${mergeSource.display_name}" into "${targetNode?.display_name || 'official category'}" (${refCount} listing${refCount === 1 ? '' : 's'} reassigned).`,
      });
      setMergeSource(null);
      await Promise.all([fetchSuggestions(), onResolved()]);
    } catch (err) {
      setMergeError(
        err instanceof Error ? err.message : 'Failed to merge category.'
      );
    } finally {
      setMergeSaving(false);
    }
  };

  // 4. Reject modal
  const openRejectModal = (row: SuggestedCategoryRow) => {
    setRejectSource(row);
    setRejectNotes('');
    setRejectError(null);
  };

  const handleConfirmReject = async () => {
    if (!rejectSource) return;
    setRejectSaving(true);
    setRejectError(null);
    try {
      const { error } = await supabase.rpc('review_suggested_category', {
        p_category_id: rejectSource.id,
        p_action: 'reject',
        p_review_notes: rejectNotes.trim() || null,
      });
      if (error) throw new Error(error.message);

      notifyAppConfigUpdated();
      onNotice?.({
        type: 'info',
        text: `Rejected "${rejectSource.display_name}". Referencing listings safely reverted to parent category.`,
      });
      setRejectSource(null);
      await Promise.all([fetchSuggestions(), onResolved()]);
    } catch (err) {
      setRejectError(
        err instanceof Error ? err.message : 'Failed to reject category.'
      );
    } finally {
      setRejectSaving(false);
    }
  };

  return (
    <div data-testid="suggested-categories-review" className="space-y-4">
      {dialog}

      {/* Filter Toolbar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              {
                id: 'pending_review',
                label: 'Pending Review',
                count: countsByStatus.pending,
              },
              {
                id: 'merged',
                label: 'Merged',
                count: countsByStatus.merged,
              },
              {
                id: 'rejected',
                label: 'Rejected',
                count: countsByStatus.rejected,
              },
            ] as const
          ).map((tab) => {
            const active = statusFilter === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={`inline-flex min-h-[44px] items-center gap-2 rounded-xl border px-3.5 text-xs font-semibold transition-colors cursor-pointer ${
                  active
                    ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                    : 'border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                }`}
              >
                <span>{tab.label}</span>
                <span
                  className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
                    active
                      ? 'bg-[var(--ps-accent-fg)]/20 text-[var(--ps-accent-fg)]'
                      : 'bg-[var(--ps-surface-alt)] text-[var(--ps-text-muted)]'
                  }`}
                >
                  {tab.count}
                </span>
              </button>
            );
          })}
        </div>

        <div className="flex items-center gap-2">
          <div className="relative flex-1 sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ps-text-muted)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter suggestions..."
              aria-label="Filter suggested categories"
              className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] pl-9 pr-3 text-xs text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:border-[var(--ps-accent)] focus:outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() => void fetchSuggestions()}
            disabled={loading}
            aria-label="Refresh suggested categories"
            className="min-h-[44px] min-w-[44px] inline-flex items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Review List */}
      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className="h-28 rounded-2xl border border-[var(--ps-border)] dd-shimmer"
            />
          ))}
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-surface)] py-12 px-4 text-center">
          <Sparkles className="mx-auto h-7 w-7 text-[var(--ps-text-muted)] mb-2" />
          <p className="text-sm font-bold text-[var(--ps-text)]">
            No {statusFilter.replace('_', ' ')} category suggestions
          </p>
          <p className="mt-1 text-xs text-[var(--ps-text-muted)] max-w-md mx-auto">
            {statusFilter === 'pending_review'
              ? 'When listing owners suggest a new leaf category outside the official taxonomy, it appears here for approval, revision, merging, or rejection.'
              : 'Past resolved suggestions appear here for reference.'}
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {filteredRows.map((row) => {
            const refCount = listingCountMap.get(row.id) || 0;
            const suggesterLabel = row.suggested_by
              ? suggesterMap.get(row.suggested_by) || row.suggested_by.slice(0, 8)
              : 'Unknown user';
            const mergedTarget = row.merged_into_category_id
              ? officialById.get(row.merged_into_category_id)
              : null;
            const isBusy = busyId === row.id;

            return (
              <div
                key={row.id}
                data-testid={`suggested-category-card-${row.id}`}
                className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between"
              >
                <div className="min-w-0 space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-bold text-[var(--ps-text)]">
                      {row.display_name}
                    </span>
                    <span className="rounded-md border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--ps-text-muted)]">
                      /{row.slug}
                    </span>
                    <span className="rounded-md bg-[var(--ps-surface-alt)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--ps-text-muted)]">
                      Level-{row.depth}
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold ${
                        row.review_status === 'pending_review'
                          ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                          : row.review_status === 'merged'
                            ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300'
                            : 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
                      }`}
                    >
                      <Clock className="h-3 w-3" />
                      <span>
                        {row.review_status === 'pending_review'
                          ? 'Pending Review'
                          : row.review_status === 'merged'
                            ? 'Merged'
                            : 'Rejected'}
                      </span>
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--ps-text-muted)]">
                    <span>
                      Parent:{' '}
                      <strong className="text-[var(--ps-text)]">
                        {buildParentBreadcrumb(row)}
                      </strong>
                    </span>
                    <span>·</span>
                    <span className="inline-flex items-center gap-1">
                      <User className="h-3 w-3" />
                      <span>Suggested by {suggesterLabel}</span>
                    </span>
                    <span>·</span>
                    <span>
                      <strong className="text-[var(--ps-text)]">
                        {refCount}
                      </strong>{' '}
                      referencing listing{refCount === 1 ? '' : 's'}
                    </span>
                    {row.created_at && (
                      <>
                        <span>·</span>
                        <span>
                          {new Date(row.created_at).toLocaleDateString('en-IN')}
                        </span>
                      </>
                    )}
                  </div>

                  {mergedTarget && (
                    <p className="text-[11px] text-sky-700 dark:text-sky-300">
                      Merged into official category:{' '}
                      <strong>{mergedTarget.display_name}</strong> (/
                      {mergedTarget.slug})
                    </p>
                  )}

                  {row.review_notes && (
                    <p className="text-[11px] text-[var(--ps-text-muted)] italic">
                      Note: {row.review_notes}
                    </p>
                  )}
                </div>

                {row.review_status === 'pending_review' && (
                  <div className="flex flex-wrap items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => void handleQuickApprove(row)}
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50 cursor-pointer"
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span>Approve &amp; Publish</span>
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => openEditRelinkModal(row)}
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] disabled:opacity-50 cursor-pointer"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                      <span>Edit &amp; Relink</span>
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => openMergeModal(row)}
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-sky-500/35 bg-sky-500/10 px-3 text-xs font-semibold text-sky-700 dark:text-sky-300 hover:bg-sky-500/20 disabled:opacity-50 cursor-pointer"
                    >
                      <GitMerge className="h-3.5 w-3.5" />
                      <span>Merge</span>
                    </button>
                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() => openRejectModal(row)}
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-rose-500/35 bg-rose-500/10 px-3 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-500/20 disabled:opacity-50 cursor-pointer"
                    >
                      <XCircle className="h-3.5 w-3.5" />
                      <span>Reject</span>
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Edit & Relink Modal */}
      <FormModal
        isOpen={Boolean(editDraft)}
        onClose={() => !editSaving && setEditDraft(null)}
        title="Edit, Relink & Publish Category"
        subtitle="Revise label, slug, icon, or re-parent within the same immutable System Root before publishing."
        maxWidthClassName="max-w-lg"
        submitLabel="Review & Publish Official"
        isDirty={Boolean(editDraft)}
        isSubmitting={editSaving}
        isValid={Object.keys(editValidationErrors).length === 0}
        validationSummary={Object.values(editValidationErrors)}
        onSubmitAttempt={() => setEditSubmitted(true)}
        confirmSubmitTitle={
          editDraft
            ? `Publish "${editDraft.display_name.trim() || editDraft.slug}" as Official Category?`
            : undefined
        }
        confirmSubmitDescription="Promotes this suggested category to official active status, updates referencing listings, and writes an entry to public.audit_logs."
        confirmSubmitImpact={
          editDraft
            ? [
                `Root: ${editDraft.root_key}`,
                `Slug: /${editDraft.slug.trim().toLowerCase()}`,
              ]
            : undefined
        }
        confirmSubmitVariant="info"
        onSubmit={handleSaveEditRelink}
      >
        {editDraft && (
          <div className="space-y-4">
            {editError && (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
                {editError}
              </div>
            )}

            <div className="space-y-1">
              <label className="block text-xs font-semibold text-[var(--ps-text)]">
                Display Label *
              </label>
              <input
                type="text"
                value={editDraft.display_name}
                onChange={(e) => {
                  const val = e.target.value;
                  setEditDraft((prev) =>
                    prev
                      ? {
                          ...prev,
                          display_name: val,
                          slug: slugifyCategory(val) || prev.slug,
                        }
                      : prev
                  );
                  setEditTouched((prev) => ({ ...prev, display_name: true }));
                }}
                onBlur={() =>
                  setEditTouched((prev) => ({ ...prev, display_name: true }))
                }
                maxLength={60}
                className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-sm text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none"
              />
              {(editTouched.display_name || editSubmitted) &&
                editValidationErrors.display_name && (
                  <p className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
                    {editValidationErrors.display_name}
                  </p>
                )}
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-semibold text-[var(--ps-text)]">
                URL Slug *
              </label>
              <input
                type="text"
                value={editDraft.slug}
                onChange={(e) => {
                  setEditDraft((prev) =>
                    prev ? { ...prev, slug: e.target.value.toLowerCase() } : prev
                  );
                  setEditTouched((prev) => ({ ...prev, slug: true }));
                }}
                onBlur={() =>
                  setEditTouched((prev) => ({ ...prev, slug: true }))
                }
                className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 font-mono text-xs text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none"
              />
              {(editTouched.slug || editSubmitted) &&
                editValidationErrors.slug && (
                  <p className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
                    {editValidationErrors.slug}
                  </p>
                )}
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-semibold text-[var(--ps-text)]">
                Parent Category (Within &ldquo;{editDraft.root_key}&rdquo;) *
              </label>
              <select
                value={editDraft.parent_id}
                onChange={(e) => {
                  setEditDraft((prev) =>
                    prev ? { ...prev, parent_id: e.target.value } : prev
                  );
                  setEditTouched((prev) => ({ ...prev, parent_id: true }));
                }}
                className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none"
              >
                <option value="">Select parent…</option>
                {editParentOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.depth === 1
                      ? `${opt.display_name} (L1 Root → becomes L2)`
                      : `↳ ${opt.display_name} (L2 → becomes L3)`}
                  </option>
                ))}
              </select>
              {(editTouched.parent_id || editSubmitted) &&
                editValidationErrors.parent_id && (
                  <p className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
                    {editValidationErrors.parent_id}
                  </p>
                )}
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <label className="block text-xs font-semibold text-[var(--ps-text)]">
                  Icon
                </label>
                <IconPicker
                  value={editDraft.icon_key}
                  onChange={(nextIcon) =>
                    setEditDraft((prev) =>
                      prev ? { ...prev, icon_key: nextIcon } : prev
                    )
                  }
                />
              </div>

              <div className="space-y-1">
                <label className="block text-xs font-semibold text-[var(--ps-text)]">
                  Accent Color
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={editDraft.accent_color}
                    onChange={(e) => {
                      setEditDraft((prev) =>
                        prev ? { ...prev, accent_color: e.target.value } : prev
                      );
                      setEditTouched((prev) => ({ ...prev, accent_color: true }));
                    }}
                    className="min-h-[44px] flex-1 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 font-mono text-xs text-[var(--ps-text)]"
                  />
                  <div className="flex items-center gap-1">
                    {ACCENT_PRESETS.slice(0, 4).map((hex) => (
                      <button
                        key={hex}
                        type="button"
                        aria-label={`Select color ${hex}`}
                        onClick={() =>
                          setEditDraft((prev) =>
                            prev ? { ...prev, accent_color: hex } : prev
                          )
                        }
                        className="h-7 w-7 rounded-lg border border-black/15 cursor-pointer"
                        style={{ backgroundColor: hex }}
                      />
                    ))}
                  </div>
                </div>
                {(editTouched.accent_color || editSubmitted) &&
                  editValidationErrors.accent_color && (
                    <p className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
                      {editValidationErrors.accent_color}
                    </p>
                  )}
              </div>
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-semibold text-[var(--ps-text)]">
                Review Notes (Optional)
              </label>
              <textarea
                rows={2}
                value={editDraft.review_notes}
                onChange={(e) =>
                  setEditDraft((prev) =>
                    prev ? { ...prev, review_notes: e.target.value } : prev
                  )
                }
                placeholder="Internal audit note..."
                className="w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 text-xs text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none"
              />
            </div>
          </div>
        )}
      </FormModal>

      {/* Merge Into Existing Official Category Modal */}
      <FormModal
        isOpen={Boolean(mergeSource)}
        onClose={() => !mergeSaving && setMergeSource(null)}
        title={`Merge "${mergeSource?.display_name || ''}" Into Official Category`}
        subtitle="Atomically reassigns all referencing listings to the selected official category and archives this duplicate suggestion."
        maxWidthClassName="max-w-lg"
        submitLabel="Review & Merge Listings"
        isDirty={Boolean(mergeTargetId || mergeNotes.trim())}
        isSubmitting={mergeSaving}
        isValid={Boolean(mergeTargetId)}
        validationSummary={
          mergeTargetId
            ? []
            : ['Select an official target category to merge into.']
        }
        onSubmitAttempt={() => setMergeSubmitted(true)}
        confirmSubmitTitle={
          mergeSource
            ? `Merge "${mergeSource.display_name}" into "${officialById.get(mergeTargetId)?.display_name || 'Target'}"?`
            : undefined
        }
        confirmSubmitDescription="Atomically reassigns all referencing listings and archives the suggested category. Recorded in public.audit_logs."
        confirmSubmitImpact={
          mergeSource
            ? [
                `${listingCountMap.get(mergeSource.id) || 0} referencing listing${(listingCountMap.get(mergeSource.id) || 0) === 1 ? '' : 's'} will be reassigned`,
                `Target: ${officialById.get(mergeTargetId)?.display_name || 'Selected official category'}`,
              ]
            : undefined
        }
        confirmSubmitVariant="warning"
        onSubmit={handleConfirmMerge}
      >
        {mergeSource && (
          <div className="space-y-4">
            {mergeError && (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
                {mergeError}
              </div>
            )}

            <div className="rounded-xl border border-sky-500/30 bg-sky-500/10 p-3 text-xs text-sky-900 dark:text-sky-200">
              <p className="font-bold">Live Reassignment Impact</p>
              <p className="mt-0.5">
                <strong>{listingCountMap.get(mergeSource.id) || 0}</strong>{' '}
                listing
                {(listingCountMap.get(mergeSource.id) || 0) === 1 ? '' : 's'}{' '}
                currently linked to &ldquo;{mergeSource.display_name}&rdquo;
                will automatically move to your chosen target category.
              </p>
            </div>

            <div className="space-y-2">
              <label className="block text-xs font-semibold text-[var(--ps-text)]">
                Search Official Target Category *
              </label>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ps-text-muted)]" />
                <input
                  type="text"
                  value={mergeSearch}
                  onChange={(e) => setMergeSearch(e.target.value)}
                  placeholder="Type category name or slug..."
                  className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] pl-9 pr-3 text-xs text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none"
                />
              </div>

              <div className="max-h-56 overflow-y-auto rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] divide-y divide-[var(--ps-border)]">
                {mergeCandidates.length === 0 ? (
                  <p className="py-6 text-center text-xs text-[var(--ps-text-muted)]">
                    No matching official categories found.
                  </p>
                ) : (
                  mergeCandidates.map((cand) => {
                    const selected = mergeTargetId === cand.id;
                    const parentName = cand.parent_id
                      ? officialById.get(cand.parent_id)?.display_name
                      : null;
                    return (
                      <button
                        key={cand.id}
                        type="button"
                        onClick={() => setMergeTargetId(cand.id)}
                        className={`w-full min-h-[44px] px-3 py-2 text-left flex items-center justify-between gap-2 transition-colors cursor-pointer ${
                          selected
                            ? 'bg-[var(--ps-accent)]/12 text-[var(--ps-text)]'
                            : 'hover:bg-[var(--ps-surface-alt)] text-[var(--ps-text)]'
                        }`}
                      >
                        <div className="min-w-0">
                          <p className="text-xs font-semibold truncate">
                            {cand.display_name}
                          </p>
                          <p className="text-[10px] text-[var(--ps-text-muted)] truncate">
                            {parentName ? `${parentName} › ` : ''}/{cand.slug} ·
                            Root: {cand.root_key}
                          </p>
                        </div>
                        <span className="rounded-md bg-[var(--ps-surface-alt)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--ps-text-muted)] shrink-0">
                          L{cand.depth}
                        </span>
                      </button>
                    );
                  })
                )}
              </div>
              {mergeSubmitted && !mergeTargetId && (
                <p className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
                  Select an official target category to merge into.
                </p>
              )}
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-semibold text-[var(--ps-text)]">
                Merge Reason Note (Optional)
              </label>
              <textarea
                rows={2}
                value={mergeNotes}
                onChange={(e) => setMergeNotes(e.target.value)}
                placeholder="e.g. Duplicate of existing official category"
                className="w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 text-xs text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none"
              />
            </div>
          </div>
        )}
      </FormModal>

      {/* Reject Suggestion Modal */}
      <FormModal
        isOpen={Boolean(rejectSource)}
        onClose={() => !rejectSaving && setRejectSource(null)}
        title={`Reject "${rejectSource?.display_name || ''}"?`}
        subtitle="Marks this suggested category as rejected and hides it from the taxonomy."
        maxWidthClassName="max-w-md"
        submitLabel="Review & Reject"
        isDirty={Boolean(rejectNotes.trim())}
        isSubmitting={rejectSaving}
        isValid
        confirmSubmitTitle={
          rejectSource
            ? `Confirm Rejection of "${rejectSource.display_name}"?`
            : undefined
        }
        confirmSubmitDescription="Marks the suggestion rejected and safely moves any referencing listings back to the official parent category."
        confirmSubmitImpact={
          rejectSource
            ? [
                `${listingCountMap.get(rejectSource.id) || 0} referencing listing${(listingCountMap.get(rejectSource.id) || 0) === 1 ? '' : 's'} revert to ${buildParentBreadcrumb(rejectSource)}`,
              ]
            : undefined
        }
        confirmSubmitVariant="danger"
        onSubmit={handleConfirmReject}
      >
        {rejectSource && (
          <div className="space-y-4">
            {rejectError && (
              <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
                {rejectError}
              </div>
            )}

            <div className="flex items-start gap-2.5 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-900 dark:text-amber-200">
              <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5" />
              <p>
                <strong>{listingCountMap.get(rejectSource.id) || 0}</strong>{' '}
                referencing listing
                {(listingCountMap.get(rejectSource.id) || 0) === 1 ? '' : 's'}{' '}
                will safely revert to the official parent category (
                <strong>{buildParentBreadcrumb(rejectSource)}</strong>). No
                listings will be deleted.
              </p>
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-semibold text-[var(--ps-text)]">
                Rejection Reason (Recorded in Audit Log)
              </label>
              <textarea
                rows={3}
                value={rejectNotes}
                onChange={(e) => setRejectNotes(e.target.value)}
                placeholder="Optional explanation for audit trail..."
                className="w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 text-xs text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none"
              />
            </div>
          </div>
        )}
      </FormModal>
    </div>
  );
}

export default SuggestedCategoriesReview;
