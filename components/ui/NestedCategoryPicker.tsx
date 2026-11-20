'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
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

export interface NestedCategorySelection {
  categoryId: string;
  categoryName: string;
  slug: string;
  pathLabels?: string[];
  customTag?: string;
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
  const { session } = useAuth();
  const { setStatus } = useAppStatus();

  const [isOpen, setIsOpen] = useState(false);
  const [hasOpened, setHasOpened] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [drillStack, setDrillStack] = useState<string[]>([]);
  const [showSuggestForm, setShowSuggestForm] = useState(false);
  const [suggestInput, setSuggestInput] = useState('');
  const [isSubmittingSuggestion, setIsSubmittingSuggestion] = useState(false);
  const [suggestFeedback, setSuggestFeedback] = useState<string | null>(null);
  const [suggestError, setSuggestError] = useState<string | null>(null);

  const rootNodes = useMemo<NestedCategoryNode[]>(
    () => categoriesByEntity[entityType] || [],
    [categoriesByEntity, entityType]
  );

  // Flatten active nodes for this entity type with ancestor paths precomputed
  const { nodeById, nodeBySlug, pathById, allIndexedNodes } = useMemo(() => {
    const byId = new Map<string, NestedCategoryNode>();
    const bySlug = new Map<string, NestedCategoryNode>();
    const paths = new Map<string, NestedCategoryNode[]>();
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

    // Fallback: include any flat nodes for this entityType not reached via rootNodes
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

    return {
      nodeById: byId,
      nodeBySlug: bySlug,
      pathById: paths,
      allIndexedNodes: flatList,
    };
  }, [rootNodes, categoriesFlat, entityType]);

  const selectedNode = useMemo<NestedCategoryNode | null>(() => {
    if (!value) return null;
    const clean = value.trim();
    return nodeById.get(clean) || nodeBySlug.get(clean.toLowerCase()) || null;
  }, [value, nodeById, nodeBySlug]);

  const selectedPath = useMemo<NestedCategoryNode[]>(() => {
    if (!selectedNode) return [];
    return pathById.get(selectedNode.id) || [selectedNode];
  }, [selectedNode, pathById]);

  const closeModal = useCallback(() => {
    setIsOpen(false);
    setSearchQuery('');
    setDrillStack([]);
    setShowSuggestForm(false);
    setSuggestError(null);
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

  const breadcrumbNodes = useMemo<NestedCategoryNode[]>(() => {
    return drillStack
      .map((nodeId) => nodeById.get(nodeId))
      .filter((n): n is NestedCategoryNode => Boolean(n));
  }, [drillStack, nodeById]);

  const currentLevelNodes = useMemo<NestedCategoryNode[]>(() => {
    if (!currentParentNode) return rootNodes;
    return currentParentNode.children;
  }, [currentParentNode, rootNodes]);

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

  const emitSelection = useCallback(
    (node: NestedCategoryNode, nextCustomTag?: string) => {
      const path = pathById.get(node.id) || [node];
      onChange({
        categoryId: node.id,
        categoryName: node.display_name,
        slug: node.slug,
        pathLabels: path.map((n) => n.display_name),
        customTag: nextCustomTag ?? customTag,
      });
      closeModal();
    },
    [pathById, onChange, customTag, closeModal]
  );

  const handleOpen = () => {
    if (disabled) return;
    setSearchQuery('');
    setSuggestError(null);
    setSuggestFeedback(null);
    setShowSuggestForm(false);
    // Start at selected node's parent level for effortless re-picking
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
    const clean = suggestInput.trim().replace(/\s+/g, ' ');
    if (clean.length < 2 || clean.length > 60) {
      setSuggestError('Enter 2 to 60 characters.');
      return;
    }

    const parentForSuggestion = currentParentNode || selectedNode || rootNodes[0] || null;
    const normalizedFallback = clean.toLowerCase();

    setIsSubmittingSuggestion(true);
    setSuggestError(null);
    setSuggestFeedback(null);
    setStatus('saving', 'Submitting suggestion');

    try {
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
        setSuggestError(
          payload.error || 'Sign in to submit a category suggestion.'
        );
        setStatus('error', 'Suggestion failed');
        return;
      }

      const tagValue = payload.normalizedTag || normalizedFallback;
      setStatus('success', 'Subcategory suggested');
      setSuggestFeedback(`Added tag "${tagValue}" & sent for review.`);
      setSuggestInput('');

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
        });
      }
    } catch {
      setSuggestError('Network error while submitting suggestion.');
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
          data-testid={testId ? `${testId}-backdrop` : 'nested-category-backdrop'}
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
            className="relative w-full max-w-md max-h-[82dvh] bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200 dark:border-slate-800 flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-2 px-4 py-3 border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0">
              <div className="min-w-0 flex items-center gap-2">
                <FolderTree className="w-4 h-4 text-theme-primary shrink-0" />
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100 truncate">
                  {label || placeholder}
                </h3>
              </div>
              <button
                type="button"
                onClick={closeModal}
                aria-label="Close category picker"
                className="w-8 h-8 inline-flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Live Search Bar */}
            <div className="px-3.5 pt-3 pb-2 border-b border-slate-100 dark:border-slate-800/80 shrink-0">
              <div className="relative flex items-center">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 pointer-events-none" />
                <input
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search categories & subcategories..."
                  className="w-full h-8 pl-8 pr-7 rounded-lg border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/70 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[var(--ps-accent)]"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    aria-label="Clear search"
                    className="absolute right-2 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              {/* Drill-down Breadcrumbs (visible when not searching) */}
              {!searchQuery.trim() && (
                <div className="mt-2 flex items-center gap-1 flex-wrap text-[11px]">
                  <button
                    type="button"
                    onClick={() => setDrillStack([])}
                    className={`px-1.5 py-0.5 rounded font-semibold transition-colors cursor-pointer ${
                      drillStack.length === 0
                        ? 'bg-slate-100 dark:bg-slate-800 text-slate-900 dark:text-slate-100'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
                    }`}
                  >
                    All
                  </button>
                  {breadcrumbNodes.map((crumb, idx) => {
                    const isLast = idx === breadcrumbNodes.length - 1;
                    return (
                      <React.Fragment key={crumb.id}>
                        <ChevronRight className="w-3 h-3 text-slate-400 shrink-0" />
                        <button
                          type="button"
                          onClick={() =>
                            setDrillStack(drillStack.slice(0, idx + 1))
                          }
                          className={`px-1.5 py-0.5 rounded font-semibold truncate max-w-[140px] transition-colors cursor-pointer ${
                            isLast
                              ? 'bg-slate-100 dark:bg-slate-800 text-theme-primary'
                              : 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
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
                  <div className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
                    No matching categories for &ldquo;{searchQuery.trim()}&rdquo;.
                  </div>
                ) : (
                  searchResults.map(({ node, path }) => {
                    const isSelected = selectedNode?.id === node.id;
                    const parentTrail = path
                      .slice(0, -1)
                      .map((n) => n.display_name)
                      .join(' › ');
                    return (
                      <button
                        key={node.id}
                        type="button"
                        onClick={() => emitSelection(node)}
                        className={`w-full px-3 py-2 rounded-xl border text-left flex items-center justify-between gap-2 transition-all cursor-pointer ${
                          isSelected
                            ? 'border-theme-primary bg-theme-primary/5 dark:bg-theme-primary/15'
                            : 'border-slate-200/80 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60'
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                            {node.display_name}
                          </div>
                          {parentTrail && (
                            <div className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
                              {parentTrail}
                            </div>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5 shrink-0">
                          <span className="px-1.5 py-0.5 rounded text-[9px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">
                            L{node.depth + 1}
                          </span>
                          {isSelected && (
                            <Check className="w-3.5 h-3.5 text-theme-primary" />
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
                    <div className="flex items-center gap-1.5 pb-1.5 mb-1 border-b border-slate-100 dark:border-slate-800">
                      <button
                        type="button"
                        onClick={() =>
                          setDrillStack((prev) => prev.slice(0, -1))
                        }
                        className="h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 text-[11px] font-semibold text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center gap-1 cursor-pointer shrink-0"
                      >
                        <ArrowLeft className="w-3 h-3" />
                        Back
                      </button>
                      {allowAllInParent && (
                        <button
                          type="button"
                          onClick={() => emitSelection(currentParentNode)}
                          className="flex-1 h-8 px-2.5 rounded-lg bg-theme-primary text-[var(--color-primary-foreground)] text-[11px] font-semibold inline-flex items-center justify-between gap-1.5 hover:opacity-95 transition-opacity cursor-pointer min-w-0"
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
                      className="w-full px-3 py-2 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 text-left text-xs font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800/60 flex items-center justify-between cursor-pointer"
                    >
                      <span>All Categories (Clear filter)</span>
                      <X className="w-3.5 h-3.5 text-slate-400" />
                    </button>
                  )}

                  {currentLevelNodes.length === 0 ? (
                    <div className="py-6 text-center text-xs text-slate-500 dark:text-slate-400">
                      No categories available.
                    </div>
                  ) : (
                    currentLevelNodes.map((node) => {
                      const hasChildren = node.children.length > 0;
                      const isSelected = selectedNode?.id === node.id;

                      return (
                        <div
                          key={node.id}
                          className={`w-full rounded-xl border flex items-center justify-between gap-2 px-3 py-2 transition-all ${
                            isSelected
                              ? 'border-theme-primary bg-theme-primary/5 dark:bg-theme-primary/15'
                              : 'border-slate-200/80 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800/60'
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
                            className="flex-1 min-w-0 flex items-center gap-2 text-left cursor-pointer"
                          >
                            {node.color_hex && (
                              <span
                                className="w-2.5 h-2.5 rounded-full shrink-0 border border-black/10"
                                style={{ backgroundColor: node.color_hex }}
                              />
                            )}
                            <span className="text-xs font-semibold text-slate-900 dark:text-slate-100 truncate">
                              {node.display_name}
                            </span>
                            {hasChildren && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 shrink-0">
                                {node.children.length}
                              </span>
                            )}
                          </button>

                          <div className="flex items-center gap-1 shrink-0">
                            {hasChildren && allowAllInParent && (
                              <button
                                type="button"
                                onClick={() => emitSelection(node)}
                                className="h-6 px-2 rounded-md text-[10px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 hover:bg-theme-primary hover:text-[var(--color-primary-foreground)] transition-colors cursor-pointer"
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
                                className="w-6 h-6 inline-flex items-center justify-center rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                              >
                                <ChevronRight className="w-4 h-4" />
                              </button>
                            ) : isSelected ? (
                              <Check className="w-4 h-4 text-theme-primary" />
                            ) : null}
                          </div>
                        </div>
                      );
                    })
                  )}
                </>
              )}
            </div>

            {/* Collapsible Subcategory Suggestion Footer */}
            {allowSuggestion && (
              <div className="px-3.5 py-2.5 border-t border-slate-200 dark:border-slate-800 bg-slate-50/80 dark:bg-slate-950/60 shrink-0">
                {!showSuggestForm ? (
                  <button
                    type="button"
                    onClick={() => {
                      setShowSuggestForm(true);
                      setSuggestError(null);
                      setSuggestFeedback(null);
                    }}
                    className="w-full flex items-center justify-between gap-2 text-[11px] font-semibold text-slate-600 dark:text-slate-300 hover:text-theme-primary transition-colors cursor-pointer"
                  >
                    <span className="inline-flex items-center gap-1.5">
                      <Sparkles className="w-3.5 h-3.5 text-theme-primary shrink-0" />
                      <span>
                        Can&apos;t find your exact subcategory? Suggest one
                      </span>
                    </span>
                    <Plus className="w-3.5 h-3.5 shrink-0" />
                  </button>
                ) : (
                  <form
                    onSubmit={(e) => void handleSubmitSuggestion(e)}
                    className="space-y-1.5"
                  >
                    <div className="flex items-center justify-between text-[10px] font-semibold text-slate-500 dark:text-slate-400">
                      <span>
                        Suggest under:{' '}
                        <strong className="text-slate-800 dark:text-slate-200">
                          {currentParentNode?.display_name ||
                            selectedNode?.display_name ||
                            'Top level'}
                        </strong>
                      </span>
                      <button
                        type="button"
                        onClick={() => setShowSuggestForm(false)}
                        className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 cursor-pointer"
                      >
                        Cancel
                      </button>
                    </div>
                    <div className="flex items-center gap-1.5">
                      <input
                        type="text"
                        value={suggestInput}
                        onChange={(e) => setSuggestInput(e.target.value)}
                        placeholder="e.g. Solar Inverter Repair"
                        maxLength={60}
                        disabled={isSubmittingSuggestion}
                        className="flex-1 h-8 px-2.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs text-slate-900 dark:text-slate-100 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-[var(--ps-accent)]"
                      />
                      <button
                        type="submit"
                        disabled={
                          isSubmittingSuggestion ||
                          suggestInput.trim().length < 2
                        }
                        className="h-8 px-3 rounded-lg bg-theme-primary text-[var(--color-primary-foreground)] text-xs font-semibold inline-flex items-center gap-1 hover:opacity-95 disabled:opacity-50 cursor-pointer shrink-0"
                      >
                        {isSubmittingSuggestion ? (
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        ) : (
                          'Submit'
                        )}
                      </button>
                    </div>
                    {suggestError && (
                      <p className="text-[10px] font-medium text-rose-600 dark:text-rose-400">
                        {suggestError}
                      </p>
                    )}
                    {suggestFeedback && (
                      <p className="text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
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
        className="w-full h-9 flex items-center justify-between gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs font-semibold text-[var(--ps-text)] transition-colors hover:bg-[var(--ps-surface-alt)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-accent)] disabled:opacity-60 disabled:cursor-not-allowed cursor-pointer"
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
          {customTag && (
            <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-theme-primary/10 text-theme-primary text-[10px] font-semibold shrink-0">
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
