'use client';

import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useHydrated } from '@/hooks/useHydrated';
import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  HelpCircle,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  X,
} from 'lucide-react';
import { useModalLock } from '@/hooks/useModalLock';
import {
  getRoleGuideById,
  readRoleChecklistProgress,
  resetRoleChecklistProgress,
  resolveRoleGuideId,
  toggleRoleChecklistItem,
  type RoleGuideId,
} from '@/lib/guides/role-guides';

export interface WorkspaceHelpDrawerProps {
  roleId: RoleGuideId | string;
  isOpen: boolean;
  onClose: () => void;
}

export function WorkspaceHelpDrawer({
  roleId,
  isOpen,
  onClose,
}: WorkspaceHelpDrawerProps) {
  const isHydrated = useHydrated();
  useModalLock(isOpen, onClose);

  const normalizedRoleId = resolveRoleGuideId(roleId);
  const guide = getRoleGuideById(normalizedRoleId);

  const [checkedMap, setCheckedMap] = useState<Record<string, boolean>>({});
  const [expandedWorkflowId, setExpandedWorkflowId] = useState<string | null>(
    () => guide.workflows[0]?.id || null
  );
  const [expandedFaqId, setExpandedFaqId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) return;
    setCheckedMap(readRoleChecklistProgress(normalizedRoleId));
    setExpandedWorkflowId(guide.workflows[0]?.id || null);
  }, [isOpen, normalizedRoleId, guide.workflows]);

  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  if (!isHydrated || !isOpen || typeof document === 'undefined') {
    return null;
  }

  const completedCount = guide.quickChecklist.filter(
    (item) => checkedMap[item.id]
  ).length;
  const totalChecklist = guide.quickChecklist.length;
  const topWorkflows = guide.workflows.slice(0, 3);
  const topFaqs = guide.faqs.slice(0, 3);

  const handleToggleCheck = (itemId: string) => {
    const next = toggleRoleChecklistItem(normalizedRoleId, itemId);
    setCheckedMap(next);
  };

  const handleResetChecklist = () => {
    resetRoleChecklistProgress(normalizedRoleId);
    setCheckedMap({});
  };

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${guide.title} Contextual Help`}
      data-testid="workspace-help-drawer"
      className="fixed inset-0 z-[96] flex justify-end"
    >
      {/* Backdrop */}
      <div
        onClick={onClose}
        aria-hidden="true"
        className="fixed inset-0 bg-black/55 backdrop-blur-xs transition-opacity"
      />

      {/* Drawer Content */}
      <aside className="relative z-10 flex h-full w-full max-w-lg flex-col border-l border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text)] shadow-2xl">
        {/* Sticky Drawer Header */}
        <div className="flex items-start justify-between gap-3 border-b border-[var(--ps-border)] bg-[var(--ps-surface)] px-4 py-3.5 sm:px-5">
          <div className="min-w-0 space-y-1">
            <div className="inline-flex items-center gap-1.5 rounded-full bg-[var(--ps-accent)]/12 px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-[var(--ps-accent)]">
              <HelpCircle className="h-3 w-3 shrink-0" />
              <span>Workspace Quick Guide • {guide.shortTitle}</span>
            </div>
            <h2 className="text-base font-extrabold tracking-tight text-[var(--ps-text)] truncate">
              {guide.title}
            </h2>
            <p className="text-xs text-[var(--ps-text-muted)] line-clamp-2">
              {guide.tagline}
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close workspace help drawer"
            data-testid="workspace-help-drawer-close"
            className="inline-flex h-11 w-11 min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:border-[var(--ps-accent)] hover:text-[var(--ps-text)] transition-colors cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5 space-y-5">
          {/* 1. Interactive Quick-Start Checklist */}
          <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3.5 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <h3 className="text-xs font-extrabold uppercase tracking-wider text-[var(--ps-text)]">
                  Quick-Start Checklist
                </h3>
                <p className="text-[11px] text-[var(--ps-text-muted)]">
                  {completedCount} of {totalChecklist} completed
                </p>
              </div>
              {completedCount > 0 && (
                <button
                  type="button"
                  onClick={handleResetChecklist}
                  className="inline-flex min-h-[44px] items-center gap-1 rounded-xl px-2.5 text-[11px] font-semibold text-[var(--ps-text-muted)] hover:bg-[var(--ps-surface-alt)] hover:text-[var(--ps-text)] transition-colors cursor-pointer"
                >
                  <RotateCcw className="h-3 w-3" />
                  <span>Reset</span>
                </button>
              )}
            </div>

            {/* Progress Bar */}
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--ps-surface-alt)]">
              <div
                className="h-full rounded-full bg-[var(--ps-accent)] transition-all duration-300"
                style={{
                  width: `${
                    totalChecklist > 0
                      ? Math.round((completedCount / totalChecklist) * 100)
                      : 0
                  }%`,
                }}
              />
            </div>

            <div className="space-y-2">
              {guide.quickChecklist.map((item) => {
                const isDone = Boolean(checkedMap[item.id]);
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => handleToggleCheck(item.id)}
                    data-testid={`drawer-checklist-item-${item.id}`}
                    className={`w-full min-h-[44px] rounded-xl border p-2.5 text-left transition-colors flex items-start gap-2.5 cursor-pointer ${
                      isDone
                        ? 'border-emerald-500/35 bg-emerald-500/8 text-[var(--ps-text)]'
                        : 'border-[var(--ps-border)] bg-[var(--ps-surface)] hover:border-[var(--ps-accent)]/50'
                    }`}
                  >
                    {isDone ? (
                      <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5" />
                    ) : (
                      <Circle className="h-4 w-4 shrink-0 text-[var(--ps-text-muted)] mt-0.5" />
                    )}
                    <div className="min-w-0 flex-1">
                      <p
                        className={`text-xs font-bold ${
                          isDone ? 'line-through opacity-80' : ''
                        }`}
                      >
                        {item.label}
                      </p>
                      <p className="mt-0.5 text-[11px] leading-relaxed text-[var(--ps-text-muted)]">
                        {item.detail}
                      </p>
                    </div>
                  </button>
                );
              })}
            </div>
          </section>

          {/* 2. Top Operational Workflows */}
          <section className="space-y-2.5">
            <div className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-[var(--ps-text)]">
              <Sparkles className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
              <span>Core {guide.shortTitle} Workflows</span>
            </div>

            <div className="space-y-2">
              {topWorkflows.map((wf) => {
                const isExpanded = expandedWorkflowId === wf.id;
                return (
                  <div
                    key={wf.id}
                    className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-bg)] overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedWorkflowId(isExpanded ? null : wf.id)
                      }
                      aria-expanded={isExpanded}
                      className="flex w-full min-h-[48px] items-center justify-between gap-2 px-3.5 py-2.5 text-left hover:bg-[var(--ps-surface-alt)]/60 transition-colors cursor-pointer"
                    >
                      <div className="min-w-0">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-accent)] block">
                          {wf.category}
                        </span>
                        <span className="text-xs font-extrabold text-[var(--ps-text)] block">
                          {wf.title}
                        </span>
                      </div>
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4 shrink-0 text-[var(--ps-text-muted)]" />
                      ) : (
                        <ChevronDown className="h-4 w-4 shrink-0 text-[var(--ps-text-muted)]" />
                      )}
                    </button>

                    {isExpanded && (
                      <div className="border-t border-[var(--ps-border)] bg-[var(--ps-surface)] px-3.5 py-3 space-y-2.5 text-xs">
                        <div className="flex flex-wrap gap-1">
                          {wf.flowBadges.map((badge, idx) => (
                            <span
                              key={`${wf.id}-badge-${idx}`}
                              className="rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-0.5 text-[10px] font-bold text-[var(--ps-text-muted)]"
                            >
                              {idx + 1}. {badge}
                            </span>
                          ))}
                        </div>

                        <ol className="space-y-1.5 pl-4 list-decimal text-[11px] leading-relaxed text-[var(--ps-text)]">
                          {wf.steps.map((step, sIdx) => (
                            <li key={`${wf.id}-step-${sIdx}`}>{step}</li>
                          ))}
                        </ol>

                        {wf.proTip && (
                          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/8 px-3 py-2 text-[11px] text-emerald-800 dark:text-emerald-200">
                            <strong>Pro Tip:</strong> {wf.proTip}
                          </div>
                        )}
                        {wf.caution && (
                          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-200">
                            <strong>Caution:</strong> {wf.caution}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>

          {/* 3. Guardrails, Escrow & Permission Boundaries */}
          <section className="space-y-2">
            <div className="flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider text-[var(--ps-text)]">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-600 dark:text-emerald-400" />
              <span>Security, Escrow &amp; Role Boundaries</span>
            </div>
            <div className="space-y-2">
              {guide.rulesAndSafety.map((rule) => (
                <div
                  key={rule.id}
                  className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 space-y-1"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-[var(--ps-text)]">
                      {rule.title}
                    </span>
                    <span className="rounded-md bg-[var(--ps-accent)]/12 px-2 py-0.5 text-[10px] font-extrabold text-[var(--ps-accent)] shrink-0">
                      {rule.badge}
                    </span>
                  </div>
                  <p className="text-[11px] leading-relaxed text-[var(--ps-text-muted)]">
                    {rule.description}
                  </p>
                </div>
              ))}
            </div>
          </section>

          {/* 4. Top Role FAQs */}
          <section className="space-y-2">
            <h3 className="text-xs font-extrabold uppercase tracking-wider text-[var(--ps-text)]">
              Common Questions
            </h3>
            <div className="space-y-1.5">
              {topFaqs.map((faq) => {
                const isOpenFaq = expandedFaqId === faq.id;
                return (
                  <div
                    key={faq.id}
                    className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] overflow-hidden"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        setExpandedFaqId(isOpenFaq ? null : faq.id)
                      }
                      className="flex w-full min-h-[44px] items-center justify-between gap-2 px-3 py-2 text-left text-xs font-bold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]/60 transition-colors cursor-pointer"
                    >
                      <span>{faq.question}</span>
                      {isOpenFaq ? (
                        <ChevronUp className="h-3.5 w-3.5 shrink-0 text-[var(--ps-text-muted)]" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5 shrink-0 text-[var(--ps-text-muted)]" />
                      )}
                    </button>
                    {isOpenFaq && (
                      <div className="border-t border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 py-2.5 text-[11px] leading-relaxed text-[var(--ps-text-muted)]">
                        {faq.answer}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        {/* Sticky Footer Link to Full /guides Hub */}
        <div className="border-t border-[var(--ps-border)] bg-[var(--ps-surface)] p-3.5 sm:px-5 flex items-center justify-between gap-2">
          <Link
            href={`/guides?role=${encodeURIComponent(normalizedRoleId)}`}
            onClick={onClose}
            data-testid="workspace-help-open-full-guides"
            className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-2 rounded-xl bg-[var(--ps-accent)] px-4 text-xs font-bold text-[var(--ps-accent-fg)] shadow-xs hover:opacity-95 transition-opacity"
          >
            <BookOpen className="h-4 w-4 shrink-0" />
            <span>Read Full {guide.shortTitle} Guide &amp; All 8 Roles</span>
            <ArrowRight className="h-3.5 w-3.5 shrink-0" />
          </Link>
        </div>
      </aside>
    </div>,
    document.body
  );
}

/**
 * Self-contained 44px+ `?` Workspace Help Trigger Button + Drawer.
 */
export function WorkspaceHelpButton({
  roleId,
  label = 'Role Guide',
  compact = false,
  testId = 'workspace-help-trigger-btn',
}: {
  roleId: RoleGuideId | string;
  label?: string;
  compact?: boolean;
  testId?: string;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const resolved = resolveRoleGuideId(roleId);
  const guide = getRoleGuideById(resolved);

  return (
    <>
      <button
        type="button"
        onClick={() => setIsOpen(true)}
        data-testid={testId}
        aria-label={`Open ${guide.shortTitle} Role Guide & Help`}
        title={`${guide.shortTitle} Guide & Checklist`}
        className={`inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs font-bold text-[var(--ps-text)] hover:border-[var(--ps-accent)] hover:bg-[var(--ps-surface-alt)] hover:text-[var(--ps-accent)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)] transition-colors cursor-pointer ${
          compact ? 'min-w-[44px] px-2.5' : 'px-3'
        }`}
      >
        <HelpCircle className="h-4 w-4 text-[var(--ps-accent)] shrink-0" />
        {!compact && <span className="truncate">{label}</span>}
      </button>

      <WorkspaceHelpDrawer
        roleId={resolved}
        isOpen={isOpen}
        onClose={() => setIsOpen(false)}
      />
    </>
  );
}

export default WorkspaceHelpDrawer;
