'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Clock,
  FolderTree,
  Loader2,
  Plus,
  Search,
  Sparkles,
  Tag,
  X,
} from 'lucide-react';
import { useAppConfig } from '@/components/providers/AppConfigProvider';
import type {
  CategoryEntityType,
  NestedCategoryNode,
} from '@/lib/config/types';
import { useAuth } from '@/lib/auth';
import { useAppStatus } from '@/lib/hooks/useAppStatus';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';

export interface NestedCategorySelection {
  categoryId: string;
  categoryName: string;
  slug: string;
  pathLabels?: string[];
  customTag?: string;
  reviewStatus?: 'official' | 'pending_review' | 'merged' | 'rejected';
  rootKey?: string | null;
}

export interface NestedCategoryPickerProps {
  entityType: CategoryEntityType;
  value?: string | null;
  customTag?: string;
  onChange: (selection: NestedCategorySelection) => void;
  onClear?: () => void;
  allowSuggestion?: boolean;
  allowAllInParent?: boolean;
  placeholder?: string;
  label?: string;
  disabled?: boolean;
  hubId?: string | null;
  linkedEntityId?: string | null;
  className?: string;
  id?: string;
  testId?: string;
}

interface PendingLeafNode extends NestedCategoryNode {
  review_status: 'pending_review';
}

export function NestedCategoryPicker({
  entityType,
  value,
  customTag,
  onChange,
  onClear,
  allowSuggestion = false,
  allowAllInParent = true,
  placeholder = 'Select category',
  label,
  disabled = false,
  hubId,
  linkedEntityId = null,
  className = '',
  id,
  testId,
}: NestedCategoryPickerProps) {
  const { categoriesByEntity, categoriesFlat, activeHub } = useAppConfig();
  const { session, user } = useAuth();
  const { setStatus } = useAppStatus();

  const [isOpen, setIsOpen] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [drillStack, setDrillStack] = useState<string[]>([]);
  const [showSuggestForm, setShowSuggestForm] = useState(false);
  const [suggestInput, setSuggestInput] = useState('');
  const [suggestTouched, setSuggestTouched] = useState(false);
  const [suggestSubmitted, setSuggestSubmitted] = useState(false);
  const [isSubmittingSuggestion, setIsSubmittingSuggestion] = useState(false);
  const [suggestFeedback, setSuggestFeedback] = useState<string | null>(null);
  const [suggestServerError, setSuggestServerError] = useState<string | null>(
    null
  );
  const [userPendingNodes, setUserPendingNodes] = useState<PendingLeafNode[]>(
    []
  );

  // Load current user's own pending_review suggestions so they remain selectable
  useEffect(() => {
    if (!allowSuggestion || !user?.id || !isSupabaseConfigured()) return;
    let active = true;
    queueMicrotask(() => {
      void supabase
        .from('categories')
        .select(
          'id, entity_type, root_key, parent_id, depth, path_ids, is_system_root, slug, display_name, description, icon_key, accent_color, sort_order, is_active, review_status'
        )
        .eq('entity_type', entityType)
        .eq('review_status', 'pending_review')
        .eq('suggested_by', user.id)
        .then(({ data }) => {
          if (!active || !Array.isArray(data)) return;
          const mapped: PendingLeafNode[] = data.map((row) => ({
            id: String(row.id),
            entity_type: entityType,
            root_key:
              typeof row.root_key === 'string' ? row.root_key : null,
            parent_id: row.parent_id ? String(row.parent_id) : null,
            depth: Number(row.depth ?? 2),
            path_ids: Array.isArray(row.path_ids)
              ? row.path_ids.map((x) => String(x))
              : [],
            is_system_root: false,
            slug: String(row.slug || ''),
            display_name: String(row.display_name || row.slug || ''),
            description:
              typeof row.description === 'string' ? row.description : null,
            icon: String(row.icon_key || 'tag'),
            color_hex: String(row.accent_color || '#D97706'),
            icon_key: String(row.icon_key || 'tag'),
            accent_color: String(row.accent_color || '#D97706'),
            sort_order: Number(row.sort_order ?? 999),
            is_active: true,
            children: [],
            review_status: 'pending_review',
          }));
          setUserPendingNodes(mapped);
        });
    });
    return () => {
      active = false;
    };
  }, [allowSuggestion, entityType, user?.id]);

  const rootNodes = useMemo<NestedCategoryNode[]>(
    () => categoriesByEntity[entityType] || [],
    [categoriesByEntity, entityType]
  );

  // Flatten active official nodes + user's own pending_review nodes with ancestor paths
  const { nodeById, nodeBySlug, pathById, allIndexedNodes, pendingIds } =
    useMemo(() => {
      const byId = new Map<string, NestedCategoryNode>();
      const bySlug = new Map<string, NestedCategoryNode>();
      const paths = new Map<string, NestedCategoryNode[]>();
      const pendingSet = new Set<string>();
      const flatList: Array<{
        node: NestedCategoryNode;
        path: NestedCategoryNode[];
        pathText: string;
      }> = [];

      const walk = (
        nodes: NestedCategoryNode[],
        ancestors: NestedCategoryNode[]
      ) => {
        for (const node of nodes) {
          const nextPath = [...ancestors, node];
          byId.set(node.id, node);
          bySlug.set(node.slug.toLowerCase(), node);
          paths.set(node.id, nextPath);
          flatList.push({
            node,
            path: nextPath,
            pathText: nextPath.map((n) => n.display_name).join(' > '),
          });
          if (node.children.length > 0) {
            walk(node.children, nextPath);
          }
        }
      };

      walk(rootNodes, []);

      if (flatList.length === 0) {
        for (const node of categoriesFlat) {
          if (node.entity_type !== entityType || !node.is_active) continue;
          byId.set(node.id, node);
          bySlug.set(node.slug.toLowerCase(), node);
          const path = [node];
          paths.set(node.id, path);
          flatList.push({
            node,
            path,
            pathText: node.display_name,
          });
        }
      }

      for (const pNode of userPendingNodes) {
        if (byId.has(pNode.id)) continue;
        pendingSet.add(pNode.id);
        byId.set(pNode.id, pNode);
        bySlug.set(pNode.slug.toLowerCase(), pNode);
        const parentTrail = pNode.parent_id
          ? paths.get(pNode.parent_id) || []
          : [];
        const fullPath = [...parentTrail, pNode];
        paths.set(pNode.id, fullPath);
        flatList.push({
          node: pNode,
          path: fullPath,
          pathText: fullPath.map((n) => n.display_name).join(' > '),
        });
      }

      return {
        nodeById: byId,
        nodeBySlug: bySlug,
        pathById: paths,
        allIndexedNodes: flatList,
        pendingIds: pendingSet,
      };
    }, [rootNodes, categoriesFlat, entityType, userPendingNodes]);

  const selectedNode = useMemo<NestedCategoryNode | null>(() => {
    if (!value) return null;
    const clean = value.trim();
    return nodeById.get(clean) || nodeBySlug.get(clean.toLowerCase()) || null;
  }, [value, nodeById, nodeBySlug]);

  const selectedPath = useMemo<NestedCategoryNode[]>(() => {
    if (!selectedNode) return [];
    return pathById.get(selectedNode.id) || [selectedNode];
  }, [selectedNode, pathById]);

  const isSelectedPending = Boolean(
    selectedNode && pendingIds.has(selectedNode.id)
  );

  const closeModal = useCallback(() => {
    setIsOpen(false);
    setSearchQuery('');
    setDrillStack([]);
    setShowSuggestForm(false);
    setSuggestTouched(false);
    setSuggestSubmitted(false);
    setSuggestServerError(null);
    setSuggestFeedback(null);
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        closeModal();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, closeModal]);

  const currentParentNode = useMemo<NestedCategoryNode | null>(() => {
    if (drillStack.length === 0) return null;
    return nodeById.get(drillStack[drillStack.length - 1]) || null;
  }, [drillStack, nodeById]);

  // Determine the valid L1/L2 parent for suggesting a new leaf (max depth 3)
  const suggestTargetParent = useMemo<NestedCategoryNode | null>(() => {
    const candidate = currentParentNode || selectedNode || rootNodes[0] || null;
    if (!candidate) return null;
    const path = pathById.get(candidate.id) || [candidate];
    if (path.length >= 3 && path[1]) {
      return path[1];
    }
    return candidate;
  }, [currentParentNode, pathById, rootNodes, selectedNode]);

  const breadcrumbNodes = useMemo<NestedCategoryNode[]>(() => {
    return drillStack
      .map((nodeId) => nodeById.get(nodeId))
      .filter((n): n is NestedCategoryNode => Boolean(n));
  }, [drillStack, nodeById]);

  const currentLevelNodes = useMemo<NestedCategoryNode[]>(() => {
    if (!currentParentNode) return rootNodes;
    const pendingChildren = userPendingNodes.filter(
      (n) => n.parent_id === currentParentNode.id
    );
    const existingIds = new Set(currentParentNode.children.map((c) => c.id));
    return [
      ...currentParentNode.children,
      ...pendingChildren.filter((p) => !existingIds.has(p.id)),
    ];
  }, [currentParentNode, rootNodes, userPendingNodes]);

  const searchResults = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    return allIndexedNodes
      .filter(
        ({ node, pathText }) =>
          node.display_name.toLowerCase().includes(q) ||
          node.slug.toLowerCase().includes(q) ||
          pathText.toLowerCase().includes(q)
      )
      .slice(0, 30);
  }, [searchQuery, allIndexedNodes]);

  const suggestFieldError = useMemo(() => {
    const clean = suggestInput.trim().replace(/\s+/g, ' ');
    if (clean.length < 2) {
      return 'Category name must be at least 2 characters.';
    }
    if (clean.length > 60) {
      return 'Category name must be 60 characters or fewer.';
    }
    return null;
  }, [suggestInput]);

  const emitSelection = useCallback(
    (
      node: NestedCategoryNode,
      nextCustomTag?: string,
      explicitReviewStatus?: 'official' | 'pending_review'
    ) => {
      const path = pathById.get(node.id) || [node];
      const reviewStatus =
        explicitReviewStatus ??
        (pendingIds.has(node.id) ? 'pending_review' : 'official');
      onChange({
        categoryId: node.id,
        categoryName: node.display_name,
        slug: node.slug,
        pathLabels: path.map((n) => n.display_name),
        customTag: nextCustomTag ?? customTag,
        reviewStatus,
        rootKey: node.root_key ?? null,
      });
      closeModal();
    },
    [pathById, pendingIds, onChange, customTag, closeModal]
  );

  const handleOpen = () => {
    if (disabled) return;
    setSearchQuery('');
    setSuggestServerError(null);
    setSuggestFeedback(null);
    setSuggestTouched(false);
    setSuggestSubmitted(false);
    setShowSuggestForm(false);
    if (selectedPath.length > 1) {
      setDrillStack(selectedPath.slice(0, -1).map((n) => n.id));
    } else {
      setDrillStack([]);
    }
    setHasOpened(true);
    setIsOpen(true);
  };

  const handleSubmitSuggestion = async (e: React.FormEvent) => {
    e.preventDefault();
    setSuggestSubmitted(true);
    if (suggestFieldError) {
      return;
    }

    const clean = suggestInput.trim().replace(/\s+/g, ' ');
    const parentForSuggestion = suggestTargetParent;

    setIsSubmittingSuggestion(true);
    setSuggestServerError(null);
    setSuggestFeedback(null);
    setStatus('saving', 'Submitting category suggestion');

    try {
      // Primary path (Pass v17a): suggest_leaf_category RPC
      if (isSupabaseConfigured() && parentForSuggestion) {
        const { data: rpcData, error: rpcError } = await supabase.rpc(
          'suggest_leaf_category',
          {
            p_parent_id: parentForSuggestion.id,
            p_name: clean,
          }
        );

        if (!rpcError && rpcData && typeof rpcData === 'object') {
          const payload = rpcData as {
            category?: Record<string, unknown>;
            already_existed?: boolean;
          };
          const cat = payload.category;
          if (cat && cat.id) {
            const reviewStatus =
              String(cat.review_status || 'pending_review') === 'official'
                ? 'official'
                : 'pending_review';
            const parentTrail = pathById.get(parentForSuggestion.id) || [
              parentForSuggestion,
            ];
            const createdNode: PendingLeafNode = {
              id: String(cat.id),
              entity_type: entityType,
              root_key:
                typeof cat.root_key === 'string'
                  ? cat.root_key
                  : parentForSuggestion.root_key ?? null,
              parent_id: parentForSuggestion.id,
              depth: Number(cat.depth ?? parentTrail.length + 1),
              path_ids: Array.isArray(cat.path_ids)
                ? cat.path_ids.map((x) => String(x))
                : [...parentTrail.map((p) => p.id), String(cat.id)],
              is_system_root: false,
              slug: String(cat.slug || ''),
              display_name: String(cat.display_name || clean),
              description: null,
              icon: String(cat.icon_key || 'tag'),
              color_hex: String(cat.accent_color || '#D97706'),
              icon_key: String(cat.icon_key || 'tag'),
              accent_color: String(cat.accent_color || '#D97706'),
              sort_order: Number(cat.sort_order ?? 999),
              is_active: true,
              children: [],
              review_status: 'pending_review',
            };

            if (reviewStatus === 'pending_review') {
              setUserPendingNodes((prev) =>
                prev.some((p) => p.id === createdNode.id)
                  ? prev
                  : [...prev, createdNode]
              );
            }

            setStatus('success', 'Category suggested and selected');
            setSuggestInput('');
            setSuggestTouched(false);
            setSuggestSubmitted(false);

            onChange({
              categoryId: createdNode.id,
              categoryName: createdNode.display_name,
              slug: createdNode.slug,
              pathLabels: [
                ...parentTrail.map((n) => n.display_name),
                createdNode.display_name,
              ],
              customTag: undefined,
              reviewStatus,
              rootKey: createdNode.root_key,
            });
            closeModal();
            return;
          }
        } else if (
          rpcError &&
          !rpcError.message.toLowerCase().includes('function') &&
          !rpcError.message.toLowerCase().includes('does not exist')
        ) {
          setSuggestServerError(rpcError.message);
          setStatus('error', 'Suggestion failed');
          return;
        }
      }

      // Fallback path when v17a RPC is not yet deployed in Supabase
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };
      if (session?.access_token) {
        headers.Authorization = `Bearer ${session.access_token}`;
      }

      const res = await fetch('/api/categories/suggest', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          entityType,
          parentCategoryId: parentForSuggestion?.id || null,
          suggestedName: clean,
          hubId: hubId || activeHub?.id || null,
          linkedEntityId,
        }),
      });

      const payload = (await res.json().catch(() => ({}))) as {
        normalizedTag?: string;
        error?: string;
      };

      if (!res.ok) {
        setSuggestServerError(
          payload.error || 'Sign in to submit a category suggestion.'
        );
        setStatus('error', 'Suggestion failed');
        return;
      }

      const tagValue = payload.normalizedTag || clean.toLowerCase();
      setStatus('success', 'Subcategory suggested');
      setSuggestFeedback(`Added "${tagValue}" & sent for Superadmin review.`);
      setSuggestInput('');
      setSuggestTouched(false);
      setSuggestSubmitted(false);

      if (parentForSuggestion) {
        const path = pathById.get(parentForSuggestion.id) || [
          parentForSuggestion,
        ];
        onChange({
          categoryId: parentForSuggestion.id,
          categoryName: parentForSuggestion.display_name,
          slug: parentForSuggestion.slug,
          pathLabels: path.map((n) => n.display_name),
          customTag: tagValue,
          reviewStatus: 'pending_review',
          rootKey: parentForSuggestion.root_key ?? null,
        });
      }
    } catch {
      setSuggestServerError('Network error while submitting suggestion.');
      setStatus('error', 'Network error');
    } finally {
      setIsSubmittingSuggestion(false);
    }
  };

  const triggerLabel =
    selectedPath.length > 0
      ? selectedPath.map((n) => n.display_name).join(' › ')
      : placeholder;

  const modalContent = (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onClick={closeModal}
          data-testid={
            testId ? `${testId}-backdrop` : 'nested-category-backdrop'
          }
          className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={label || placeholder}
            data-testid={testId ? `${testId}-modal` : 'nested-category-modal'}
            initial={{ opacity: 0, y: 14, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 14, scale: 0.96 }}
            transition={{ type: 'spring', damping: 28, stiffness: 340 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-md max-h-[82dvh] bg-[var(--ps-surface)] rounded-2xl shadow-2xl border border-[var(--ps-border)] flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-[var(--ps-border)] bg-[var(--ps-surface)] shrink-0">
              <div className="min-w-0 flex items-center gap-2">
                <FolderTree className="w-4 h-4 text-[var(--ps-accent)] shrink-0" />
                <h3 className="text-sm font-bold text-[var(--ps-text)] truncate">
                  {label || placeholder}
                </h3>
              </div>
              <button
                type="button"
                onClick={closeModal}
                aria-label="Close category picker"
                className="min-w-[44px] min-h-[44px] -mr-2 inline-flex items-center justify-center rounded-xl text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Live Search Bar */}
            <div className="px-3.5 pt-3 pb-2.5 border-b border-[var(--ps-border)] shrink-0">
              <div className="relative flex items-center">
                <Search className="w-4 h-4 text-[var(--ps-text-muted)] absolute left-3 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search categories & subcategories..."
                  className="w-full min-h-[44px] pl-9 pr-9 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:outline-none focus:border-[var(--ps-accent)]"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    aria-label="Clear search"
                    className="absolute right-2.5 p-1 text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Drill-down Breadcrumbs */}
              {!searchQuery.trim() && (
                <div className="mt-2 flex items-center gap-1 flex-wrap text-[11px]">
                  <button
                    type="button"
                    onClick={() => setDrillStack([])}
                    className={`px-2 py-1 rounded-lg font-semibold transition-colors cursor-pointer ${
                      drillStack.length === 0
                        ? 'bg-[var(--ps-surface-alt)] text-[var(--ps-text)]'
                        : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                    }`}
                  >
                    All
                  </button>
                  {breadcrumbNodes.map((crumb, idx) => {
                    const isLast = idx === breadcrumbNodes.length - 1;
                    return (
                      <React.Fragment key={crumb.id}>
                        <ChevronRight className="w-3 h-3 text-[var(--ps-text-muted)] shrink-0" />
                        <button
                          type="button"
                          onClick={() =>
                            setDrillStack(drillStack.slice(0, idx + 1))
                          }
                          className={`px-2 py-1 rounded-lg font-semibold truncate max-w-[140px] transition-colors cursor-pointer ${
                            isLast
                              ? 'bg-[var(--ps-surface-alt)] text-[var(--ps-accent)]'
                              : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                          }`}
                        >
                          {crumb.display_name}
                        </button>
                      </React.Fragment>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Category List Body */}
            <div className="flex-1 overflow-y-auto p-3 space-y-1.5">
              {searchQuery.trim() ? (
                searchResults.length === 0 ? (
                  <div className="py-6 text-center text-xs text-[var(--ps-text-muted)]">
                    No matching categories for &ldquo;{searchQuery.trim()}
                    &rdquo;.
                  </div>
                ) : (
                  searchResults.map(({ node, path }) => {
                    const isSelected = selectedNode?.id === node.id;
                    const isPending = pendingIds.has(node.id);
                    const parentTrail = path
                      .slice(0, -1)
                      .map((n) => n.display_name)
                      .join(' › ');
                    return (
                      <button
                        key={node.id}
                        type="button"
                        onClick={() => emitSelection(node)}
                        className={`w-full min-h-[44px] px-3 py-2 rounded-xl border text-left flex items-center justify-between gap-2 transition-all cursor-pointer ${
                          isSelected
                            ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)]/10'
                            : 'border-[var(--ps-border)] bg-[var(--ps-bg)] hover:bg-[var(--ps-surface-alt)]'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5">
                            <span className="text-xs font-semibold text-[var(--ps-text)] truncate">
                              {node.display_name}
                            </span>
                            {isPending && (
                              <span className="inline-flex items-center gap-0.5 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold text-amber-700 dark:text-amber-300 shrink-0">
                                Pending Review
                              </span>
                            )}
                          </div>
                          {parentTrail && (
                            <div className="text-[10px] text-[var(--ps-text-muted)] truncate">
                              {parentTrail}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-[var(--ps-surface-alt)] text-[var(--ps-text-muted)]">
                            L{path.length}
                          </span>
                          {isSelected && (
                            <Check className="w-3.5 h-3.5 text-[var(--ps-accent)]" />
                          )}
                        </div>
                      </button>
                    );
                  })
                )
              ) : (
                <>
                  {/* Back + Select All in Current Parent */}
                  {currentParentNode && (
                    <div className="flex items-center gap-1.5 pb-1.5 mb-1 border-b border-[var(--ps-border)]">
                      <button
                        type="button"
                        onClick={() =>
                          setDrillStack((prev) => prev.slice(0, -1))
                        }
                        className="min-h-[44px] px-3 rounded-xl border border-[var(--ps-border)] text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] inline-flex items-center gap-1 cursor-pointer shrink-0"
                      >
                        <ArrowLeft className="w-3.5 h-3.5" />
                        Back
                      </button>
                      {allowAllInParent && (
                        <button
                          type="button"
                          onClick={() => emitSelection(currentParentNode)}
                          className="flex-1 min-h-[44px] px-3 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-semibold inline-flex items-center justify-between gap-1.5 hover:opacity-95 transition-opacity cursor-pointer min-w-0"
                        >
                          <span className="truncate">
                            All in {currentParentNode.display_name}
                          </span>
                          <Check className="w-3.5 h-3.5 shrink-0" />
                        </button>
                      )}
                    </div>
                  )}

                  {/* Root-level Reset / Clear Option */}
                  {!currentParentNode && onClear && selectedNode && (
                    <button
                      type="button"
                      onClick={() => {
                        onClear();
                        closeModal();
                      }}
                      className="w-full min-h-[44px] px-3 py-2 rounded-xl border border-dashed border-[var(--ps-border)] text-left text-xs font-semibold text-[var(--ps-text-muted)] hover:bg-[var(--ps-surface-alt)] flex items-center justify-between cursor-pointer"
                    >
                      <span>All Categories (Clear filter)</span>
                      <X className="w-3.5 h-3.5" />
                    </button>
                  )}

                  {currentLevelNodes.length === 0 ? (
                    <div className="py-6 text-center text-xs text-[var(--ps-text-muted)]">
                      No categories available.
                    </div>
                  ) : (
                    currentLevelNodes.map((node) => {
                      const hasChildren = node.children.length > 0;
                      const isSelected = selectedNode?.id === node.id;
                      const isPending = pendingIds.has(node.id);

                      return (
                        <div
                          key={node.id}
                          className={`w-full min-h-[44px] rounded-xl border flex items-center justify-between gap-2 px-3 py-1.5 transition-all ${
                            isSelected
                              ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)]/10'
                              : 'border-[var(--ps-border)] bg-[var(--ps-bg)] hover:bg-[var(--ps-surface-alt)]'
                          }`}
                        >
                          <button
                            type="button"
                            onClick={() => {
                              if (hasChildren) {
                                setDrillStack((prev) => [...prev, node.id]);
                              } else {
                                emitSelection(node);
                              }
                            }}
                            className="flex-1 min-w-0 min-h-[36px] flex items-center gap-2 text-left cursor-pointer"
                          >
                            {node.color_hex && (
                              <span
                                className="w-2.5 h-2.5 rounded-full shrink-0 border border-black/10"
                                style={{ backgroundColor: node.color_hex }}
                              />
                            )}
                            <span className="text-xs font-semibold text-[var(--ps-text)] truncate">
                              {node.display_name}
                            </span>
                            {isPending && (
                              <span className="inline-flex items-center gap-0.5 rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold text-amber-700 dark:text-amber-300 shrink-0">
                                Pending Review
                              </span>
                            )}
                            {hasChildren && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-[var(--ps-surface-alt)] text-[var(--ps-text-muted)] shrink-0">
                                {node.children.length}
                              </span>
                            )}
                          </button>

                          <div className="flex items-center gap-1 shrink-0">
                            {hasChildren && allowAllInParent && (
                              <button
                                type="button"
                                onClick={() => emitSelection(node)}
                                className="min-h-[32px] px-2.5 rounded-lg text-[10px] font-semibold bg-[var(--ps-surface-alt)] text-[var(--ps-text)] hover:bg-[var(--ps-accent)] hover:text-[var(--ps-accent-fg)] transition-colors cursor-pointer"
                              >
                                Pick
                              </button>
                            )}
                            {hasChildren ? (
                              <button
                                type="button"
                                aria-label={`Browse ${node.display_name} subcategories`}
                                onClick={() =>
                                  setDrillStack((prev) => [...prev, node.id])
                                }
                                className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
                              >
                                <ChevronRight className="w-4 h-4" />
                              </button>
                            ) : isSelected ? (
                              <Check className="w-4 h-4 text-[var(--ps-accent)]" />
                            ) : null}
                          </div>
                        </div>
                      );
                    })
                  )}
                </>
              )}
            </div>

            {/* Collapsible Leaf Category Suggestion Footer */}
            {allowSuggestion && suggestTargetParent && (
              <div className="px-3.5 py-3 border-t border-[var(--ps-border)] bg-[var(--ps-surface-alt)]/60 shrink-0">
                {!showSuggestForm ? (
                  <button
                    type="button"
                    onClick={() => {
                      setShowSuggestForm(true);
                      setSuggestTouched(false);
                      setSuggestSubmitted(false);
                      setSuggestServerError(null);
                      setSuggestFeedback(null);
                    }}
                    className="w-full min-h-[44px] px-3 rounded-xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-surface)] flex items-center justify-between gap-2 text-xs font-semibold text-[var(--ps-text)] hover:border-[var(--ps-accent)] transition-colors cursor-pointer"
                  >
                    <span className="inline-flex items-center gap-1.5 truncate">
                      <Sparkles className="w-3.5 h-3.5 text-[var(--ps-accent)] shrink-0" />
                      <span className="truncate">
                        + Suggest a new category under{' '}
                        {suggestTargetParent.display_name}
                      </span>
                    </span>
                    <Plus className="w-3.5 h-3.5 shrink-0" />
                  </button>
                ) : (
                  <form
                    onSubmit={(e) => void handleSubmitSuggestion(e)}
                    noValidate
                    className="space-y-2"
                  >
                    <div className="flex items-center justify-between text-[11px] font-semibold text-[var(--ps-text-muted)]">
                      <span>
                        New category under:{' '}
                        <strong className="text-[var(--ps-text)]">
                          {suggestTargetParent.display_name}
                        </strong>
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowSuggestForm(false)}
                        className="text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                    <div className="flex items-center gap-2">
                      <input
                        type="text"
                        value={suggestInput}
                        onChange={(e) => {
                          setSuggestInput(e.target.value);
                          setSuggestTouched(true);
                          setSuggestServerError(null);
                        }}
                        onBlur={() => setSuggestTouched(true)}
                        placeholder="e.g. Solar Inverter Repair"
                        maxLength={60}
                        disabled={isSubmittingSuggestion}
                        className="flex-1 min-h-[44px] px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-xs text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:outline-none focus:border-[var(--ps-accent)]"
                      />
                      <button
                        type="submit"
                        disabled={isSubmittingSuggestion}
                        className="min-h-[44px] px-3.5 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-semibold inline-flex items-center gap-1 hover:opacity-95 disabled:opacity-50 cursor-pointer shrink-0"
                      >
                        {isSubmittingSuggestion ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          'Suggest'
                        )}
                      </button>
                    </div>
                    {(suggestTouched || suggestSubmitted) &&
                      suggestFieldError && (
                        <p className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
                          {suggestFieldError}
                        </p>
                      )}
                    {suggestServerError && (
                      <p className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
                        {suggestServerError}
                      </p>
                    )}
                    {suggestFeedback && (
                      <p className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                        {suggestFeedback}
                      </p>
                    )}
                  </form>
                )}
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );

  return (
    <div className={`w-full ${className}`.trim()}>
      {label && (
        <label
          htmlFor={id}
          className="block text-[11px] font-semibold text-[var(--ps-text)] mb-1"
        >
          {label}
        </label>
      )}

      <button
        id={id}
        type="button"
        disabled={disabled}
        data-testid={testId || 'nested-category-trigger'}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        aria-label={label || placeholder}
        onClick={handleOpen}
        className="w-full min-h-[44px] flex items-center justify-between gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs font-semibold text-[var(--ps-text)] transition-colors hover:bg-[var(--ps-surface-alt)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-accent)] disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
      >
        <span className="min-w-0 flex items-center gap-1.5 truncate">
          <span
            className={`truncate ${
              selectedNode
                ? 'text-[var(--ps-text)]'
                : 'text-[var(--ps-text-muted)]'
            }`}
          >
            {triggerLabel}
          </span>
          {isSelectedPending && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-300 text-[10px] font-bold shrink-0">
              <Clock className="w-2.5 h-2.5" />
              Pending Superadmin Review
            </span>
          )}
          {!isSelectedPending && customTag && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-md bg-[var(--ps-accent)]/10 text-[var(--ps-accent)] text-[10px] font-semibold shrink-0">
              <Tag className="w-2.5 h-2.5" />
              {customTag}
            </span>
          )}
        </span>
        <ChevronDown
          className={`h-3.5 w-3.5 shrink-0 text-[var(--ps-text-muted)] transition-transform duration-200 ${
            isOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {hasOpened && typeof document !== 'undefined'
        ? createPortal(modalContent, document.body)
        : null}
    </div>
  );
}

export default NestedCategoryPicker;
