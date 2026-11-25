'use client';

import React, { useCallback, useMemo, useState } from 'react';
import {
  DndContext,
  closestCenter,
  useDroppable,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import {
  AlertTriangle,
  ArrowLeftRight,
  ArrowUpRight,
  ChevronDown,
  ChevronRight,
  CornerDownRight,
  Edit3,
  Eye,
  EyeOff,
  FolderPlus,
  Loader2,
  Lock,
  Plus,
  Trash2,
} from 'lucide-react';
import { getIconByKey } from '@/lib/icons/registry';
import { CANONICAL_SYSTEM_ROOT_META_BY_KEY } from '@/lib/taxonomy/categories';
import {
  DragHandleButton,
  MobileOrderButtons,
  SortablePreviewItem,
  useTouchSafeSensors,
} from '@/components/ui/SortablePreview';

export type CategoryEntityType = 'listing' | 'product' | 'bulletin' | 'vehicle';

export interface CategoryRecord {
  id: string;
  entity_type: CategoryEntityType;
  root_key: string;
  parent_id: string | null;
  depth: 1 | 2 | 3;
  path_ids: string[];
  is_system_root: boolean;
  slug: string;
  display_name: string;
  description: string;
  icon_key: string;
  accent_color: string;
  sort_order: number;
  is_active: boolean;
}

export function renderRegistryIcon(
  iconKey: string,
  className: string,
  style?: React.CSSProperties
) {
  const IconComp = getIconByKey(iconKey);
  return React.createElement(IconComp, {
    className,
    style,
    'aria-hidden': true,
  });
}

export function slugifyCategory(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/[-_]{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 60);
}

export function normalizeTreeRecords(rows: CategoryRecord[]): CategoryRecord[] {
  const byId = new Map<string, CategoryRecord>();
  for (const r of rows) {
    byId.set(r.id, { ...r });
  }

  const computePathAndRoot = (
    node: CategoryRecord
  ): { depth: 1 | 2 | 3; pathIds: string[]; rootKey: string } => {
    const chain: CategoryRecord[] = [];
    const seen = new Set<string>();
    let curr: CategoryRecord | undefined = node;
    while (curr && !seen.has(curr.id) && chain.length < 4) {
      seen.add(curr.id);
      chain.unshift(curr);
      curr = curr.parent_id ? byId.get(curr.parent_id) : undefined;
    }
    const rootNode = chain[0] || node;
    const depth = Math.min(3, Math.max(1, chain.length)) as 1 | 2 | 3;
    const pathIds = chain.map((c) => c.id);
    const rootKey =
      rootNode.root_key ||
      (!rootNode.parent_id ? rootNode.slug : node.root_key || node.slug);
    return { depth, pathIds, rootKey };
  };

  return rows.map((row) => {
    const { depth, pathIds, rootKey } = computePathAndRoot(row);
    const isSystemRoot =
      Boolean(row.is_system_root) ||
      (depth === 1 && Boolean(CANONICAL_SYSTEM_ROOT_META_BY_KEY[rootKey]));
    return {
      ...row,
      depth,
      path_ids: pathIds,
      root_key: rootKey,
      is_system_root: isSystemRoot,
    };
  });
}

export function CategoryBuilderSkeleton() {
  return (
    <div className="space-y-4" aria-label="Loading 3-level category taxonomy">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[1, 2, 3, 4].map((idx) => (
          <div
            key={idx}
            className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3.5"
          >
            <div className="dd-shimmer h-3 w-24 rounded" />
            <div className="dd-shimmer mt-2.5 h-6 w-12 rounded" />
          </div>
        ))}
      </div>
      {[1, 2, 3].map((idx) => (
        <div
          key={idx}
          className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3"
        >
          <div className="flex items-center gap-3">
            <div className="dd-shimmer h-10 w-10 rounded-xl shrink-0" />
            <div className="flex-1 space-y-2">
              <div className="dd-shimmer h-4 w-48 rounded" />
              <div className="dd-shimmer h-3 w-72 rounded" />
            </div>
          </div>
          <div className="pl-6 space-y-2">
            <div className="dd-shimmer h-11 w-full rounded-xl" />
            <div className="dd-shimmer h-11 w-full rounded-xl" />
          </div>
        </div>
      ))}
    </div>
  );
}

function RootPromoteDropzone({
  rootId,
  rootLabel,
  active,
}: {
  rootId: string;
  rootLabel: string;
  active: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `promote-to-l2:${rootId}`,
  });

  if (!active) return null;

  return (
    <div
      ref={setNodeRef}
      className={`mb-2.5 flex min-h-[44px] items-center justify-center gap-2 rounded-xl border-2 border-dashed px-3 py-2 text-xs font-semibold transition-colors ${
        isOver
          ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)]/12 text-[var(--ps-accent)]'
          : 'border-[var(--ps-border)] bg-[var(--ps-bg)]/80 text-[var(--ps-text-muted)]'
      }`}
    >
      <ArrowUpRight className="h-4 w-4 shrink-0" />
      <span>
        Drop here to promote Level-3 sub-category directly to Level-2 under{' '}
        <strong>{rootLabel}</strong>
      </span>
    </div>
  );
}

function L2DropTargetStrip({
  l2Id,
  l2Label,
  visible,
}: {
  l2Id: string;
  l2Label: string;
  visible: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `drop-into-l2:${l2Id}`,
  });

  if (!visible) return null;

  return (
    <div
      ref={setNodeRef}
      className={`mt-2 flex min-h-[38px] items-center gap-2 rounded-lg border border-dashed px-3 py-1.5 text-[11px] font-medium transition-colors ${
        isOver
          ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)]/12 text-[var(--ps-accent)]'
          : 'border-[var(--ps-border)] bg-[var(--ps-bg)]/70 text-[var(--ps-text-muted)]'
      }`}
    >
      <CornerDownRight className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">
        Drop here to nest under &ldquo;{l2Label}&rdquo; (Level-3)
      </span>
    </div>
  );
}

function L3SortableRow({
  item,
  index,
  total,
  inheritedIconKey,
  inheritedAccentColor,
  onMoveUp,
  onMoveDown,
  onOpenMoveModal,
  onEdit,
  onToggleActive,
  onDelete,
  busyId,
}: {
  item: CategoryRecord;
  index: number;
  total: number;
  inheritedIconKey: string;
  inheritedAccentColor: string;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onOpenMoveModal: () => void;
  onEdit: () => void;
  onToggleActive: () => void;
  onDelete: () => void;
  busyId: string | null;
}) {
  const effectiveIcon = item.icon_key || inheritedIconKey;
  const effectiveColor = item.accent_color || inheritedAccentColor;
  const isBusy = busyId === item.id;

  return (
    <SortablePreviewItem
      id={`node:${item.id}`}
      className={`rounded-xl border transition-colors ${
        item.is_active
          ? 'border-[var(--ps-border)] bg-[var(--ps-surface)]'
          : 'border-[var(--ps-border)]/60 bg-[var(--ps-bg)]/60 opacity-70'
      }`}
    >
      {({ dragHandleProps, isDragging }) => (
        <div
          className={`flex flex-wrap items-center gap-2 px-2.5 py-2 sm:flex-nowrap sm:px-3 ${
            isDragging ? 'ring-2 ring-[var(--ps-accent)] rounded-xl' : ''
          }`}
        >
          <DragHandleButton handleProps={dragHandleProps} compact />
          <div
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-[var(--ps-border)]/70"
            style={{
              backgroundColor: `${effectiveColor}15`,
              color: effectiveColor,
            }}
          >
            {renderRegistryIcon(effectiveIcon, 'h-4 w-4')}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="truncate text-xs font-semibold text-[var(--ps-text)]">
                {item.display_name}
              </span>
              <span className="rounded bg-[var(--ps-surface-alt)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--ps-text-muted)]">
                L3
              </span>
              {!item.is_active && (
                <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                  Hidden
                </span>
              )}
            </div>
            <p className="truncate text-[11px] font-mono text-[var(--ps-text-muted)]">
              /{item.slug}
              {item.description ? ` · ${item.description}` : ''}
            </p>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <MobileOrderButtons
              canMoveUp={index > 0}
              canMoveDown={index < total - 1}
              onMoveUp={onMoveUp}
              onMoveDown={onMoveDown}
              itemLabel={item.display_name}
            />
            <button
              type="button"
              onClick={onOpenMoveModal}
              disabled={isBusy}
              title="Move or promote within same root"
              aria-label={`Move ${item.display_name} within root`}
              className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:border-[var(--ps-accent)] hover:text-[var(--ps-accent)] transition-colors cursor-pointer disabled:opacity-40"
            >
              <ArrowLeftRight className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onEdit}
              disabled={isBusy}
              title={`Edit ${item.display_name}`}
              aria-label={`Edit ${item.display_name}`}
              className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:border-[var(--ps-accent)] hover:text-[var(--ps-accent)] transition-colors cursor-pointer disabled:opacity-40"
            >
              <Edit3 className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={onToggleActive}
              disabled={isBusy}
              title={item.is_active ? 'Hide sub-category' : 'Show sub-category'}
              aria-label={
                item.is_active
                  ? `Hide ${item.display_name}`
                  : `Show ${item.display_name}`
              }
              className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:border-[var(--ps-accent)] hover:text-[var(--ps-accent)] transition-colors cursor-pointer disabled:opacity-40"
            >
              {isBusy ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : item.is_active ? (
                <Eye className="h-4 w-4" />
              ) : (
                <EyeOff className="h-4 w-4" />
              )}
            </button>
            <button
              type="button"
              onClick={onDelete}
              disabled={isBusy}
              title={`Delete ${item.display_name}`}
              aria-label={`Delete ${item.display_name}`}
              className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:border-rose-500/60 hover:text-rose-600 transition-colors cursor-pointer disabled:opacity-40"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </SortablePreviewItem>
  );
}

function L2SortableCard({
  l2,
  l3Children,
  index,
  total,
  rootAccentColor,
  rootIconKey,
  isExpanded,
  onToggleExpand,
  activeDragNode,
  onMoveUp,
  onMoveDown,
  onMoveL3,
  onAddL3,
  onOpenMoveModal,
  onEdit,
  onToggleActive,
  onDelete,
  busyId,
}: {
  l2: CategoryRecord;
  l3Children: CategoryRecord[];
  index: number;
  total: number;
  rootAccentColor: string;
  rootIconKey: string;
  isExpanded: boolean;
  onToggleExpand: () => void;
  activeDragNode: CategoryRecord | null;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onMoveL3: (l3Id: string, direction: 'up' | 'down') => void;
  onAddL3: () => void;
  onOpenMoveModal: (node: CategoryRecord) => void;
  onEdit: (node: CategoryRecord) => void;
  onToggleActive: (node: CategoryRecord) => void;
  onDelete: (node: CategoryRecord) => void;
  busyId: string | null;
}) {
  const effectiveIcon = l2.icon_key || rootIconKey;
  const effectiveColor = l2.accent_color || rootAccentColor;
  const isBusy = busyId === l2.id;

  const showDropTarget = Boolean(
    activeDragNode &&
      ((activeDragNode.depth === 3 && activeDragNode.parent_id !== l2.id) ||
        (activeDragNode.depth === 2 && activeDragNode.id !== l2.id))
  );

  return (
    <SortablePreviewItem
      id={`node:${l2.id}`}
      className={`rounded-xl border transition-colors ${
        l2.is_active
          ? 'border-[var(--ps-border)] bg-[var(--ps-bg)]/80'
          : 'border-[var(--ps-border)]/60 bg-[var(--ps-bg)]/40 opacity-75'
      }`}
    >
      {({ dragHandleProps, isDragging }) => (
        <div
          className={`p-3 ${
            isDragging ? 'ring-2 ring-[var(--ps-accent)] rounded-xl' : ''
          }`}
        >
          <div className="flex flex-wrap items-center gap-2 sm:flex-nowrap">
            <DragHandleButton handleProps={dragHandleProps} compact />
            <button
              type="button"
              onClick={onToggleExpand}
              aria-expanded={isExpanded}
              aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${l2.display_name}`}
              className="inline-flex h-11 w-9 shrink-0 items-center justify-center rounded-lg text-[var(--ps-text-muted)] hover:bg-[var(--ps-surface-alt)] hover:text-[var(--ps-text)] cursor-pointer"
            >
              {isExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>

            <div
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--ps-border)]/70"
              style={{
                backgroundColor: `${effectiveColor}15`,
                color: effectiveColor,
              }}
            >
              {renderRegistryIcon(effectiveIcon, 'h-4 w-4')}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="truncate text-sm font-semibold text-[var(--ps-text)]">
                  {l2.display_name}
                </span>
                <span className="rounded bg-[var(--ps-surface-alt)] px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--ps-text-muted)]">
                  L2
                </span>
                <span className="rounded bg-[var(--ps-surface)] px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-[var(--ps-text-muted)] border border-[var(--ps-border)]">
                  {l3Children.length} sub
                </span>
                {!l2.is_active && (
                  <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                    Hidden
                  </span>
                )}
              </div>
              <p className="truncate text-xs font-mono text-[var(--ps-text-muted)]">
                /{l2.slug}
                {l2.description ? ` · ${l2.description}` : ''}
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-1 shrink-0">
              <MobileOrderButtons
                canMoveUp={index > 0}
                canMoveDown={index < total - 1}
                onMoveUp={onMoveUp}
                onMoveDown={onMoveDown}
                itemLabel={l2.display_name}
              />
              <button
                type="button"
                onClick={onAddL3}
                disabled={isBusy}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 text-xs font-semibold text-[var(--ps-text)] hover:border-[var(--ps-accent)] hover:text-[var(--ps-accent)] transition-colors cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                <span className="hidden md:inline">Add L3</span>
              </button>
              <button
                type="button"
                onClick={() => onOpenMoveModal(l2)}
                disabled={isBusy}
                title="Move or demote within same root"
                aria-label={`Move ${l2.display_name} within root`}
                className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:border-[var(--ps-accent)] hover:text-[var(--ps-accent)] transition-colors cursor-pointer disabled:opacity-40"
              >
                <ArrowLeftRight className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => onEdit(l2)}
                disabled={isBusy}
                title={`Edit ${l2.display_name}`}
                aria-label={`Edit ${l2.display_name}`}
                className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:border-[var(--ps-accent)] hover:text-[var(--ps-accent)] transition-colors cursor-pointer disabled:opacity-40"
              >
                <Edit3 className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => onToggleActive(l2)}
                disabled={isBusy}
                title={l2.is_active ? 'Hide category' : 'Show category'}
                aria-label={
                  l2.is_active
                    ? `Hide ${l2.display_name}`
                    : `Show ${l2.display_name}`
                }
                className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:border-[var(--ps-accent)] hover:text-[var(--ps-accent)] transition-colors cursor-pointer disabled:opacity-40"
              >
                {isBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : l2.is_active ? (
                  <Eye className="h-4 w-4" />
                ) : (
                  <EyeOff className="h-4 w-4" />
                )}
              </button>
              <button
                type="button"
                onClick={() => onDelete(l2)}
                disabled={isBusy}
                title={`Delete ${l2.display_name}`}
                aria-label={`Delete ${l2.display_name}`}
                className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:border-rose-500/60 hover:text-rose-600 transition-colors cursor-pointer disabled:opacity-40"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>

          <L2DropTargetStrip
            l2Id={l2.id}
            l2Label={l2.display_name}
            visible={showDropTarget}
          />

          {isExpanded && (
            <div className="mt-2.5 ml-4 sm:ml-8 border-l-2 border-[var(--ps-border)] pl-3 space-y-2">
              {l3Children.length === 0 ? (
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-dashed border-[var(--ps-border)] bg-[var(--ps-surface)]/50 px-3 py-2 text-xs text-[var(--ps-text-muted)]">
                  <span>No Level-3 sub-categories yet.</span>
                  <button
                    type="button"
                    onClick={onAddL3}
                    className="inline-flex min-h-[36px] items-center gap-1 font-semibold text-[var(--ps-accent)] hover:underline cursor-pointer"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>Add Level-3</span>
                  </button>
                </div>
              ) : (
                <SortableContext
                  items={l3Children.map((c) => `node:${c.id}`)}
                  strategy={verticalListSortingStrategy}
                >
                  {l3Children.map((l3, l3Idx) => (
                    <L3SortableRow
                      key={l3.id}
                      item={l3}
                      index={l3Idx}
                      total={l3Children.length}
                      inheritedIconKey={effectiveIcon}
                      inheritedAccentColor={effectiveColor}
                      onMoveUp={() => onMoveL3(l3.id, 'up')}
                      onMoveDown={() => onMoveL3(l3.id, 'down')}
                      onOpenMoveModal={() => onOpenMoveModal(l3)}
                      onEdit={() => onEdit(l3)}
                      onToggleActive={() => onToggleActive(l3)}
                      onDelete={() => onDelete(l3)}
                      busyId={busyId}
                    />
                  ))}
                </SortableContext>
              )}
            </div>
          )}
        </div>
      )}
    </SortablePreviewItem>
  );
}

export interface RootSortableCardProps {
  root: CategoryRecord;
  l2Nodes: CategoryRecord[];
  l3ByParentId: Map<string, CategoryRecord[]>;
  index: number;
  total: number;
  isExpanded: boolean;
  expandedL2Ids: Set<string>;
  onToggleExpandRoot: () => void;
  onToggleExpandL2: (l2Id: string) => void;
  onMoveRootUp: () => void;
  onMoveRootDown: () => void;
  onMoveL2: (l2Id: string, direction: 'up' | 'down') => void;
  onMoveL3: (l3Id: string, direction: 'up' | 'down') => void;
  onWithinRootDragEnd: (root: CategoryRecord, event: DragEndEvent) => void;
  onAddL2: () => void;
  onAddL3: (parentL2: CategoryRecord) => void;
  onOpenMoveModal: (node: CategoryRecord) => void;
  onEdit: (node: CategoryRecord) => void;
  onToggleActive: (node: CategoryRecord) => void;
  onDelete: (node: CategoryRecord) => void;
  busyId: string | null;
}

export function RootSortableCard({
  root,
  l2Nodes,
  l3ByParentId,
  index,
  total,
  isExpanded,
  expandedL2Ids,
  onToggleExpandRoot,
  onToggleExpandL2,
  onMoveRootUp,
  onMoveRootDown,
  onMoveL2,
  onMoveL3,
  onWithinRootDragEnd,
  onAddL2,
  onAddL3,
  onOpenMoveModal,
  onEdit,
  onToggleActive,
  onDelete,
  busyId,
}: RootSortableCardProps) {
  const sensors = useTouchSafeSensors();
  const [activeInnerNodeId, setActiveInnerNodeId] = useState<string | null>(
    null
  );

  const l3Total = useMemo(
    () =>
      l2Nodes.reduce(
        (sum, l2) => sum + (l3ByParentId.get(l2.id)?.length ?? 0),
        0
      ),
    [l2Nodes, l3ByParentId]
  );

  const activeInnerNode = useMemo(() => {
    if (!activeInnerNodeId) return null;
    const foundL2 = l2Nodes.find((n) => n.id === activeInnerNodeId);
    if (foundL2) return foundL2;
    for (const kids of l3ByParentId.values()) {
      const foundL3 = kids.find((n) => n.id === activeInnerNodeId);
      if (foundL3) return foundL3;
    }
    return null;
  }, [activeInnerNodeId, l2Nodes, l3ByParentId]);

  const activeInnerHasChildren = useMemo(() => {
    if (!activeInnerNode || activeInnerNode.depth !== 2) return false;
    return (l3ByParentId.get(activeInnerNode.id)?.length ?? 0) > 0;
  }, [activeInnerNode, l3ByParentId]);

  const handleInnerDragStart = useCallback((event: DragStartEvent) => {
    const rawId = String(event.active.id);
    if (rawId.startsWith('node:')) {
      setActiveInnerNodeId(rawId.slice(5));
    }
  }, []);

  const handleInnerDragEnd = useCallback(
    (event: DragEndEvent) => {
      setActiveInnerNodeId(null);
      onWithinRootDragEnd(root, event);
    },
    [onWithinRootDragEnd, root]
  );

  const isBusy = busyId === root.id;

  return (
    <SortablePreviewItem
      id={`root:${root.id}`}
      className={`rounded-2xl border transition-colors ${
        root.is_active
          ? 'border-[var(--ps-border)] bg-[var(--ps-surface)]'
          : 'border-[var(--ps-border)]/60 bg-[var(--ps-surface)]/60 opacity-75'
      }`}
    >
      {({ dragHandleProps, isDragging }) => (
        <div
          className={`${
            isDragging ? 'ring-2 ring-[var(--ps-accent)] rounded-2xl' : ''
          }`}
        >
          <div className="flex flex-wrap items-center gap-2.5 p-3.5 sm:flex-nowrap sm:p-4">
            <DragHandleButton handleProps={dragHandleProps} compact />
            <button
              type="button"
              onClick={onToggleExpandRoot}
              aria-expanded={isExpanded}
              aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${root.display_name}`}
              className="inline-flex h-11 w-9 shrink-0 items-center justify-center rounded-xl text-[var(--ps-text-muted)] hover:bg-[var(--ps-surface-alt)] hover:text-[var(--ps-text)] cursor-pointer"
            >
              {isExpanded ? (
                <ChevronDown className="h-4 w-4" />
              ) : (
                <ChevronRight className="h-4 w-4" />
              )}
            </button>

            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--ps-border)]/70"
              style={{
                backgroundColor: `${root.accent_color}18`,
                color: root.accent_color,
              }}
            >
              {renderRegistryIcon(root.icon_key, 'h-5 w-5')}
            </div>

            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="truncate text-sm font-bold text-[var(--ps-text)]">
                  {root.display_name}
                </h3>
                <span className="inline-flex items-center gap-1 rounded-md border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-2 py-0.5 text-[10px] font-semibold text-[var(--ps-text-muted)]">
                  <Lock className="h-3 w-3" />
                  <span>System Root (Locked Structure)</span>
                </span>
                {!root.is_active && (
                  <span className="rounded-md bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                    Hidden
                  </span>
                )}
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-[var(--ps-text-muted)]">
                <span className="font-mono text-[11px]">
                  root_key:{' '}
                  <strong className="text-[var(--ps-text)]">
                    {root.root_key}
                  </strong>
                </span>
                <span className="tabular-nums">
                  {l2Nodes.length} L2 · {l3Total} L3
                </span>
                {root.description && (
                  <span className="truncate max-w-md">{root.description}</span>
                )}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 shrink-0">
              <MobileOrderButtons
                canMoveUp={index > 0}
                canMoveDown={index < total - 1}
                onMoveUp={onMoveRootUp}
                onMoveDown={onMoveRootDown}
                itemLabel={root.display_name}
              />
              <button
                type="button"
                onClick={onAddL2}
                disabled={isBusy}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3.5 text-xs font-semibold text-[var(--ps-accent-fg)] hover:opacity-95 transition-opacity cursor-pointer"
              >
                <FolderPlus className="h-4 w-4" />
                <span>Add Level-2</span>
              </button>
              <button
                type="button"
                onClick={() => onEdit(root)}
                disabled={isBusy}
                title="Edit display label, description, icon, or color"
                aria-label={`Edit ${root.display_name}`}
                className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:border-[var(--ps-accent)] hover:text-[var(--ps-accent)] transition-colors cursor-pointer"
              >
                <Edit3 className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => onToggleActive(root)}
                disabled={isBusy}
                title={root.is_active ? 'Hide root in UI' : 'Show root in UI'}
                aria-label={
                  root.is_active
                    ? `Hide ${root.display_name}`
                    : `Show ${root.display_name}`
                }
                className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:border-[var(--ps-accent)] hover:text-[var(--ps-accent)] transition-colors cursor-pointer"
              >
                {isBusy ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : root.is_active ? (
                  <Eye className="h-4 w-4" />
                ) : (
                  <EyeOff className="h-4 w-4" />
                )}
              </button>
              <button
                type="button"
                disabled
                title="System Root cannot be deleted — locked to preserve vertical forms and payment policies"
                aria-label="System Root delete disabled"
                className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--ps-border)]/50 bg-[var(--ps-surface-alt)]/50 text-[var(--ps-text-muted)]/40 cursor-not-allowed"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          </div>

          {isExpanded && (
            <div className="border-t border-[var(--ps-border)] bg-[var(--ps-bg)]/45 p-3 sm:p-4">
              {activeInnerNode && activeInnerHasChildren && (
                <div className="mb-3 flex items-center gap-2 rounded-xl border border-amber-400/45 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="h-4 w-4 shrink-0" />
                  <span>
                    <strong>{activeInnerNode.display_name}</strong> has Level-3
                    children — it can be reordered among Level-2 siblings, but
                    cannot be demoted to Level-3 until its children are moved.
                  </span>
                </div>
              )}

              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragStart={handleInnerDragStart}
                onDragEnd={handleInnerDragEnd}
                onDragCancel={() => setActiveInnerNodeId(null)}
              >
                <RootPromoteDropzone
                  rootId={root.id}
                  rootLabel={root.display_name}
                  active={Boolean(activeInnerNode && activeInnerNode.depth === 3)}
                />

                {l2Nodes.length === 0 ? (
                  <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-surface)]/70 px-4 py-6 text-center">
                    <p className="text-xs font-medium text-[var(--ps-text-muted)]">
                      No Level-2 categories under{' '}
                      <strong className="text-[var(--ps-text)]">
                        {root.display_name}
                      </strong>{' '}
                      yet.
                    </p>
                    <button
                      type="button"
                      onClick={onAddL2}
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3.5 text-xs font-semibold text-[var(--ps-text)] hover:border-[var(--ps-accent)] hover:text-[var(--ps-accent)] cursor-pointer"
                    >
                      <Plus className="h-4 w-4" />
                      <span>Create First Level-2 Category</span>
                    </button>
                  </div>
                ) : (
                  <SortableContext
                    items={l2Nodes.map((n) => `node:${n.id}`)}
                    strategy={verticalListSortingStrategy}
                  >
                    <div className="space-y-2.5">
                      {l2Nodes.map((l2, l2Idx) => (
                        <L2SortableCard
                          key={l2.id}
                          l2={l2}
                          l3Children={l3ByParentId.get(l2.id) || []}
                          index={l2Idx}
                          total={l2Nodes.length}
                          rootAccentColor={root.accent_color}
                          rootIconKey={root.icon_key}
                          isExpanded={expandedL2Ids.has(l2.id)}
                          onToggleExpand={() => onToggleExpandL2(l2.id)}
                          activeDragNode={
                            activeInnerHasChildren ? null : activeInnerNode
                          }
                          onMoveUp={() => onMoveL2(l2.id, 'up')}
                          onMoveDown={() => onMoveL2(l2.id, 'down')}
                          onMoveL3={onMoveL3}
                          onAddL3={() => onAddL3(l2)}
                          onOpenMoveModal={onOpenMoveModal}
                          onEdit={onEdit}
                          onToggleActive={onToggleActive}
                          onDelete={onDelete}
                          busyId={busyId}
                        />
                      ))}
                    </div>
                  </SortableContext>
                )}
              </DndContext>
            </div>
          )}
        </div>
      )}
    </SortablePreviewItem>
  );
}
