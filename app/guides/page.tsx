'use client';

import React, { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import {
  ArrowRight,
  BookOpen,
  Building2,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Circle,
  Compass,
  Crown,
  HelpCircle,
  Megaphone,
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  Store,
  Truck,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import {
  ALL_ROLE_GUIDES,
  getRoleGuideById,
  readRoleChecklistProgress,
  resetRoleChecklistProgress,
  resolveRoleGuideId,
  toggleRoleChecklistItem,
  type RoleGuideDefinition,
  type RoleGuideId,
} from '@/lib/guides/role-guides';

const ROLE_ICON_MAP: Record<RoleGuideId, typeof Compass> = {
  visitor: Compass,
  owner: Store,
  staff: Users,
  driver: Truck,
  mediator: ShieldCheck,
  hub_manager: Building2,
  advertiser: Megaphone,
  super_admin: Crown,
};

function RoleGuidesHubInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { role: authRole, realRole } = useAuth();

  const roleParam = searchParams.get('role');
  const queryParam = searchParams.get('q') || '';

  const defaultUserRole = useMemo<RoleGuideId>(
    () => resolveRoleGuideId(authRole || realRole || 'visitor'),
    [authRole, realRole]
  );

  const [selectedRole, setSelectedRole] = useState<RoleGuideId>(() =>
    roleParam ? resolveRoleGuideId(roleParam) : defaultUserRole
  );
  const [searchQuery, setSearchQuery] = useState<string>(queryParam);
  const [searchScope, setSearchScope] = useState<'active' | 'all'>(() =>
    queryParam.trim().length > 0 ? 'all' : 'active'
  );
  const [checkedByRole, setCheckedByRole] = useState<
    Record<RoleGuideId, Record<string, boolean>>
  >({
    visitor: {},
    owner: {},
    staff: {},
    driver: {},
    mediator: {},
    hub_manager: {},
    advertiser: {},
    super_admin: {},
  });
  const [openWorkflowIds, setOpenWorkflowIds] = useState<Record<string, boolean>>(
    {}
  );
  const [openFaqIds, setOpenFaqIds] = useState<Record<string, boolean>>({});

  // Sync URL ?role= when user auth loads or query changes
  useEffect(() => {
    if (roleParam) {
      setSelectedRole(resolveRoleGuideId(roleParam));
    } else {
      setSelectedRole(defaultUserRole);
    }
  }, [roleParam, defaultUserRole]);

  useEffect(() => {
    if (queryParam) {
      setSearchQuery(queryParam);
    }
  }, [queryParam]);

  // Hydrate persisted checklist progress for all 8 roles
  useEffect(() => {
    const nextMap: Record<RoleGuideId, Record<string, boolean>> = {
      visitor: readRoleChecklistProgress('visitor'),
      owner: readRoleChecklistProgress('owner'),
      staff: readRoleChecklistProgress('staff'),
      driver: readRoleChecklistProgress('driver'),
      mediator: readRoleChecklistProgress('mediator'),
      hub_manager: readRoleChecklistProgress('hub_manager'),
      advertiser: readRoleChecklistProgress('advertiser'),
      super_admin: readRoleChecklistProgress('super_admin'),
    };
    setCheckedByRole(nextMap);
  }, []);

  const activeGuide = useMemo(
    () => getRoleGuideById(selectedRole),
    [selectedRole]
  );

  // Auto-open the first 2 workflows of the active role
  useEffect(() => {
    const initialOpen: Record<string, boolean> = {};
    activeGuide.workflows.slice(0, 2).forEach((wf) => {
      initialOpen[wf.id] = true;
    });
    setOpenWorkflowIds(initialOpen);
  }, [activeGuide]);

  const handleSelectRole = (nextRole: RoleGuideId) => {
    setSelectedRole(nextRole);
    const params = new URLSearchParams(searchParams.toString());
    params.set('role', nextRole);
    if (searchQuery.trim()) {
      params.set('q', searchQuery.trim());
    } else {
      params.delete('q');
    }
    router.replace(`/guides?${params.toString()}`, { scroll: false });
  };

  const handleToggleChecklist = (roleId: RoleGuideId, itemId: string) => {
    const updatedRoleProgress = toggleRoleChecklistItem(roleId, itemId);
    setCheckedByRole((prev) => ({
      ...prev,
      [roleId]: updatedRoleProgress,
    }));
  };

  const handleResetChecklist = (roleId: RoleGuideId) => {
    resetRoleChecklistProgress(roleId);
    setCheckedByRole((prev) => ({
      ...prev,
      [roleId]: {},
    }));
  };

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const guidesToRender = useMemo<RoleGuideDefinition[]>(() => {
    const baseList =
      normalizedQuery && searchScope === 'all'
        ? [...ALL_ROLE_GUIDES]
        : [activeGuide];

    if (!normalizedQuery) return baseList;

    return baseList
      .map((g) => {
        const matchesRoleMeta =
          g.title.toLowerCase().includes(normalizedQuery) ||
          g.tagline.toLowerCase().includes(normalizedQuery);

        const quickChecklist = matchesRoleMeta
          ? g.quickChecklist
          : g.quickChecklist.filter(
              (c) =>
                c.label.toLowerCase().includes(normalizedQuery) ||
                c.detail.toLowerCase().includes(normalizedQuery)
            );

        const workflows = g.workflows.filter(
          (w) =>
            w.title.toLowerCase().includes(normalizedQuery) ||
            w.category.toLowerCase().includes(normalizedQuery) ||
            w.summary.toLowerCase().includes(normalizedQuery) ||
            w.flowBadges.some((b) =>
              b.toLowerCase().includes(normalizedQuery)
            ) ||
            w.steps.some((s) => s.toLowerCase().includes(normalizedQuery)) ||
            (w.proTip && w.proTip.toLowerCase().includes(normalizedQuery)) ||
            (w.caution && w.caution.toLowerCase().includes(normalizedQuery))
        );

        const rulesAndSafety = g.rulesAndSafety.filter(
          (r) =>
            r.title.toLowerCase().includes(normalizedQuery) ||
            r.badge.toLowerCase().includes(normalizedQuery) ||
            r.description.toLowerCase().includes(normalizedQuery)
        );

        const faqs = g.faqs.filter(
          (f) =>
            f.question.toLowerCase().includes(normalizedQuery) ||
            f.answer.toLowerCase().includes(normalizedQuery) ||
            f.keywords.some((k) => k.toLowerCase().includes(normalizedQuery))
        );

        return {
          ...g,
          quickChecklist,
          workflows,
          rulesAndSafety,
          faqs,
        };
      })
      .filter(
        (g) =>
          g.quickChecklist.length > 0 ||
          g.workflows.length > 0 ||
          g.rulesAndSafety.length > 0 ||
          g.faqs.length > 0
      );
  }, [activeGuide, normalizedQuery, searchScope]);

  const activeChecklistMap = checkedByRole[selectedRole] || {};
  const activeCompletedCount = activeGuide.quickChecklist.filter(
    (item) => activeChecklistMap[item.id]
  ).length;
  const activeTotalCount = activeGuide.quickChecklist.length;

  return (
    <main className="min-h-screen bg-[var(--ps-bg)] text-[var(--ps-text)] pb-24">
      {/* Top Hero & Search Header */}
      <section className="border-b border-[var(--ps-border)] bg-[var(--ps-surface)]">
        <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8 space-y-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="space-y-1.5 max-w-2xl">
              <div className="inline-flex items-center gap-1.5 rounded-full bg-[var(--ps-accent)]/12 px-3 py-1 text-[11px] font-extrabold uppercase tracking-wider text-[var(--ps-accent)]">
                <BookOpen className="h-3.5 w-3.5" />
                <span>DD oodle Operational Playbook • All 8 Roles</span>
              </div>
              <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-[var(--ps-text)]">
                Interactive Role Guides &amp; Workflows
              </h1>
              <p className="text-xs sm:text-sm text-[var(--ps-text-muted)] leading-relaxed">
                Step-by-step checklists, escrow &amp; asymmetric OTP safety rules,
                and live workspace links tailored for every role on DD oodle.
              </p>
            </div>

            {/* Instant Search Bar + Scope Toggle */}
            <div className="w-full lg:max-w-md space-y-2">
              <div className="relative flex items-center">
                <Search className="pointer-events-none absolute left-3.5 h-4 w-4 text-[var(--ps-text-muted)]" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search OTPs, Sangam plots, UPI escrow, KYC, staff..."
                  aria-label="Search role guides, checklists, and FAQs"
                  data-testid="guides-search-input"
                  className="h-11 min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] pl-10 pr-10 text-xs font-medium text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:border-[var(--ps-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-ring)]"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery('')}
                    aria-label="Clear guide search"
                    className="absolute right-1.5 inline-flex h-8 w-8 items-center justify-center rounded-lg text-[var(--ps-text-muted)] hover:bg-[var(--ps-surface-alt)] hover:text-[var(--ps-text)] cursor-pointer"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {normalizedQuery && (
                <div className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="text-[var(--ps-text-muted)]">
                    Search scope:
                  </span>
                  <div className="inline-flex rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-0.5">
                    <button
                      type="button"
                      onClick={() => setSearchScope('active')}
                      className={`min-h-[32px] rounded-lg px-2.5 text-[11px] font-bold transition-colors cursor-pointer ${
                        searchScope === 'active'
                          ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                          : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                      }`}
                    >
                      {activeGuide.shortTitle} Only
                    </button>
                    <button
                      type="button"
                      onClick={() => setSearchScope('all')}
                      className={`min-h-[32px] rounded-lg px-2.5 text-[11px] font-bold transition-colors cursor-pointer ${
                        searchScope === 'all'
                          ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                          : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                      }`}
                    >
                      All 8 Roles
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* 8-Role Switcher Strip (44px+ Horizontal Scrollable Pills) */}
          <div
            role="tablist"
            aria-label="Select Role Guide"
            data-testid="guides-role-switcher"
            className="flex items-center gap-2 overflow-x-auto no-scrollbar pt-1 pb-1"
          >
            {ALL_ROLE_GUIDES.map((role) => {
              const Icon = ROLE_ICON_MAP[role.id];
              const isSelected = selectedRole === role.id;
              const isCurrentUserRole = defaultUserRole === role.id;
              const roleProgress = checkedByRole[role.id] || {};
              const roleDone = role.quickChecklist.filter(
                (i) => roleProgress[i.id]
              ).length;

              return (
                <button
                  key={role.id}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  data-testid={`guide-role-pill-${role.id}`}
                  onClick={() => handleSelectRole(role.id)}
                  className={`inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-xl border px-3.5 py-2 text-xs font-bold transition-colors cursor-pointer ${
                    isSelected
                      ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-xs'
                      : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text)] hover:border-[var(--ps-accent)]/50 hover:bg-[var(--ps-surface-alt)]'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span>{role.shortTitle}</span>
                  {isCurrentUserRole && (
                    <span
                      className={`rounded-full px-1.5 py-0.5 text-[9px] font-extrabold uppercase ${
                        isSelected
                          ? 'bg-white/20 text-[var(--ps-accent-fg)]'
                          : 'bg-[var(--ps-accent)]/15 text-[var(--ps-accent)]'
                      }`}
                    >
                      Your Role
                    </span>
                  )}
                  {roleDone > 0 && (
                    <span
                      className={`rounded-full px-1.5 py-0.5 font-mono text-[10px] font-bold ${
                        isSelected
                          ? 'bg-black/20 text-[var(--ps-accent-fg)]'
                          : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                      }`}
                    >
                      {roleDone}/{role.quickChecklist.length}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* Main Content Area */}
      <div className="mx-auto max-w-7xl px-4 pt-6 sm:px-6 lg:px-8 space-y-8">
        {guidesToRender.length === 0 ? (
          <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-8 text-center space-y-3">
            <HelpCircle className="mx-auto h-8 w-8 text-[var(--ps-text-muted)]" />
            <h2 className="text-base font-extrabold text-[var(--ps-text)]">
              No guide topics matched &ldquo;{searchQuery}&rdquo;
            </h2>
            <p className="text-xs text-[var(--ps-text-muted)] max-w-md mx-auto">
              Try searching across all 8 roles or clear your search query to
              browse the full step-by-step workflows.
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
              {searchScope !== 'all' && (
                <button
                  type="button"
                  onClick={() => setSearchScope('all')}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-4 text-xs font-bold text-[var(--ps-accent-fg)] cursor-pointer"
                >
                  <span>Search All 8 Roles</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-4 text-xs font-bold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] cursor-pointer"
              >
                <span>Clear Search</span>
              </button>
            </div>
          </div>
        ) : (
          guidesToRender.map((guide) => {
            const RoleIcon = ROLE_ICON_MAP[guide.id];
            const roleChecklist = checkedByRole[guide.id] || {};
            const doneCount = ROLE_ICON_MAP[guide.id]
              ? guide.quickChecklist.filter((i) => roleChecklist[i.id]).length
              : 0;
            const totalCount = guide.quickChecklist.length;

            return (
              <div
                key={guide.id}
                data-testid={`role-guide-section-${guide.id}`}
                className="space-y-6"
              >
                {/* Role Overview Banner Card */}
                <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5 sm:p-6 shadow-xs">
                  <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="flex items-start gap-3.5 min-w-0">
                      <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-[var(--ps-accent)]/12 text-[var(--ps-accent)] border border-[var(--ps-accent)]/25">
                        <RoleIcon className="h-6 w-6" />
                      </div>
                      <div className="space-y-1 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="rounded-full bg-[var(--ps-surface-alt)] border border-[var(--ps-border)] px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-[var(--ps-text-muted)]">
                            {guide.audienceBadge}
                          </span>
                          {guide.id === defaultUserRole && (
                            <span className="rounded-full bg-emerald-500/15 px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                              Active Account Role
                            </span>
                          )}
                        </div>
                        <h2 className="text-xl font-extrabold tracking-tight text-[var(--ps-text)]">
                          {guide.title}
                        </h2>
                        <p className="text-xs sm:text-sm text-[var(--ps-text-muted)] leading-relaxed max-w-3xl">
                          {guide.tagline}
                        </p>
                      </div>
                    </div>

                    <div className="flex shrink-0 items-center gap-2">
                      <Link
                        href={guide.entryHref}
                        data-testid={`guide-primary-cta-${guide.id}`}
                        className="inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl bg-[var(--ps-accent)] px-4 text-xs font-bold text-[var(--ps-accent-fg)] shadow-xs hover:opacity-95 transition-opacity"
                      >
                        <span>{guide.entryLabel}</span>
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                    </div>
                  </div>
                </section>

                {/* Grid: Left Column (Interactive Quick-Start Checklist + Safety Rules), Right Column (Step-by-Step Workflows & FAQs) */}
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-12 items-start">
                  {/* Left Rail (lg:col-span-5): Checklist & Safety Rules */}
                  <div className="lg:col-span-5 space-y-6">
                    {/* Interactive Quick-Start Checklist */}
                    {guide.quickChecklist.length > 0 && (
                      <section
                        data-testid={`guide-checklist-${guide.id}`}
                        className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5 space-y-4 shadow-xs"
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <h3 className="text-sm font-extrabold text-[var(--ps-text)]">
                              Interactive Quick-Start Checklist
                            </h3>
                            <p className="text-xs text-[var(--ps-text-muted)]">
                              {doneCount} of {totalCount} steps completed (saved
                              on this device)
                            </p>
                          </div>
                          {doneCount > 0 && (
                            <button
                              type="button"
                              onClick={() => handleResetChecklist(guide.id)}
                              className="inline-flex min-h-[44px] items-center gap-1 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs font-semibold text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                              <span>Reset</span>
                            </button>
                          )}
                        </div>

                        {/* Progress Bar */}
                        <div className="h-2 w-full overflow-hidden rounded-full bg-[var(--ps-surface-alt)]">
                          <div
                            className="h-full rounded-full bg-[var(--ps-accent)] transition-all duration-300"
                            style={{
                              width: `${
                                totalCount > 0
                                  ? Math.round((doneCount / totalCount) * 100)
                                  : 0
                              }%`,
                            }}
                          />
                        </div>

                        <div className="space-y-2.5">
                          {guide.quickChecklist.map((item, idx) => {
                            const isChecked = Boolean(roleChecklist[item.id]);
                            return (
                              <div
                                key={item.id}
                                className={`rounded-xl border p-3.5 transition-colors ${
                                  isChecked
                                    ? 'border-emerald-500/35 bg-emerald-500/8'
                                    : 'border-[var(--ps-border)] bg-[var(--ps-bg)]'
                                }`}
                              >
                                <div className="flex items-start gap-3">
                                  <button
                                    type="button"
                                    onClick={() =>
                                      handleToggleChecklist(guide.id, item.id)
                                    }
                                    aria-pressed={isChecked}
                                    data-testid={`guide-check-btn-${item.id}`}
                                    className="inline-flex h-11 w-11 min-h-[44px] min-w-[44px] -m-2 shrink-0 items-center justify-center rounded-xl text-[var(--ps-text-muted)] hover:text-[var(--ps-accent)] cursor-pointer"
                                  >
                                    {isChecked ? (
                                      <CheckCircle2 className="h-5 w-5 text-emerald-600 dark:text-emerald-400" />
                                    ) : (
                                      <Circle className="h-5 w-5" />
                                    )}
                                  </button>

                                  <div className="min-w-0 flex-1 space-y-1">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        handleToggleChecklist(guide.id, item.id)
                                      }
                                      className="text-left w-full cursor-pointer"
                                    >
                                      <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-accent)] block">
                                        Step {idx + 1}
                                      </span>
                                      <span
                                        className={`text-xs font-extrabold text-[var(--ps-text)] block ${
                                          isChecked
                                            ? 'line-through opacity-80'
                                            : ''
                                        }`}
                                      >
                                        {item.label}
                                      </span>
                                    </button>
                                    <p className="text-xs leading-relaxed text-[var(--ps-text-muted)]">
                                      {item.detail}
                                    </p>
                                    {item.ctaHref && item.ctaLabel && (
                                      <div className="pt-1">
                                        <Link
                                          href={item.ctaHref}
                                          className="inline-flex min-h-[36px] items-center gap-1 text-xs font-bold text-[var(--ps-accent)] hover:underline"
                                        >
                                          <span>{item.ctaLabel}</span>
                                          <ArrowRight className="h-3 w-3" />
                                        </Link>
                                      </div>
                                    )}
                                  </div>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </section>
                    )}

                    {/* Rules, Escrow & Privacy Guardrails */}
                    {guide.rulesAndSafety.length > 0 && (
                      <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5 space-y-3.5 shadow-xs">
                        <div className="flex items-center gap-2">
                          <ShieldCheck className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                          <h3 className="text-sm font-extrabold text-[var(--ps-text)]">
                            Escrow, OTP &amp; Permission Guardrails
                          </h3>
                        </div>

                        <div className="space-y-2.5">
                          {guide.rulesAndSafety.map((rule) => (
                            <div
                              key={rule.id}
                              className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3.5 space-y-1.5"
                            >
                              <div className="flex flex-wrap items-center justify-between gap-2">
                                <span className="text-xs font-extrabold text-[var(--ps-text)]">
                                  {rule.title}
                                </span>
                                <span className="rounded-md bg-[var(--ps-accent)]/12 px-2 py-0.5 text-[10px] font-extrabold text-[var(--ps-accent)]">
                                  {rule.badge}
                                </span>
                              </div>
                              <p className="text-xs leading-relaxed text-[var(--ps-text-muted)]">
                                {rule.description}
                              </p>
                            </div>
                          ))}
                        </div>
                      </section>
                    )}
                  </div>

                  {/* Right Column (lg:col-span-7): Expandable Workflows & FAQ Accordions */}
                  <div className="lg:col-span-7 space-y-6">
                    {/* Expandable Step-by-Step Workflows */}
                    {guide.workflows.length > 0 && (
                      <section className="space-y-3">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <Sparkles className="h-4 w-4 text-[var(--ps-accent)]" />
                            <h3 className="text-sm font-extrabold text-[var(--ps-text)]">
                              Step-by-Step Operational Workflows
                            </h3>
                          </div>
                          <span className="text-xs text-[var(--ps-text-muted)]">
                            {guide.workflows.length} workflows
                          </span>
                        </div>

                        <div className="space-y-3">
                          {guide.workflows.map((wf) => {
                            const isExpanded =
                              Boolean(openWorkflowIds[wf.id]) ||
                              Boolean(normalizedQuery);

                            return (
                              <article
                                key={wf.id}
                                data-testid={`guide-workflow-card-${wf.id}`}
                                className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] overflow-hidden shadow-xs"
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    setOpenWorkflowIds((prev) => ({
                                      ...prev,
                                      [wf.id]: !isExpanded,
                                    }))
                                  }
                                  aria-expanded={isExpanded}
                                  className="flex w-full min-h-[56px] items-center justify-between gap-3 px-4 py-3.5 sm:px-5 text-left hover:bg-[var(--ps-surface-alt)]/50 transition-colors cursor-pointer"
                                >
                                  <div className="space-y-1 min-w-0">
                                    <span className="text-[10px] font-extrabold uppercase tracking-wider text-[var(--ps-accent)] block">
                                      {wf.category}
                                    </span>
                                    <h4 className="text-sm font-extrabold text-[var(--ps-text)]">
                                      {wf.title}
                                    </h4>
                                    <p className="text-xs text-[var(--ps-text-muted)] line-clamp-2">
                                      {wf.summary}
                                    </p>
                                  </div>
                                  <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)]">
                                    {isExpanded ? (
                                      <ChevronUp className="h-4 w-4" />
                                    ) : (
                                      <ChevronDown className="h-4 w-4" />
                                    )}
                                  </span>
                                </button>

                                {isExpanded && (
                                  <div className="border-t border-[var(--ps-border)] bg-[var(--ps-bg)] px-4 py-4 sm:px-5 space-y-4">
                                    {/* Visual Status / Flow Badges */}
                                    <div className="flex flex-wrap items-center gap-1.5">
                                      {wf.flowBadges.map((badge, bIdx) => (
                                        <React.Fragment
                                          key={`${wf.id}-flow-${bIdx}`}
                                        >
                                          <span className="inline-flex items-center gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 py-1 text-[11px] font-bold text-[var(--ps-text)]">
                                            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-[var(--ps-accent)]/15 text-[10px] font-extrabold text-[var(--ps-accent)]">
                                              {bIdx + 1}
                                            </span>
                                            <span>{badge}</span>
                                          </span>
                                          {bIdx < wf.flowBadges.length - 1 && (
                                            <ArrowRight className="h-3 w-3 text-[var(--ps-text-muted)] shrink-0" />
                                          )}
                                        </React.Fragment>
                                      ))}
                                    </div>

                                    {/* Numbered Steps */}
                                    <ol className="space-y-2.5">
                                      {wf.steps.map((stepText, sIdx) => (
                                        <li
                                          key={`${wf.id}-step-${sIdx}`}
                                          className="flex items-start gap-2.5 text-xs leading-relaxed text-[var(--ps-text)]"
                                        >
                                          <span className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--ps-accent)] text-[10px] font-extrabold text-[var(--ps-accent-fg)]">
                                            {sIdx + 1}
                                          </span>
                                          <span>{stepText}</span>
                                        </li>
                                      ))}
                                    </ol>

                                    {wf.proTip && (
                                      <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/8 p-3 text-xs text-emerald-800 dark:text-emerald-200">
                                        <strong>Pro Tip:</strong> {wf.proTip}
                                      </div>
                                    )}

                                    {wf.caution && (
                                      <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-200">
                                        <strong>Important Guardrail:</strong>{' '}
                                        {wf.caution}
                                      </div>
                                    )}

                                    <div className="pt-1 flex items-center justify-end">
                                      <Link
                                        href={wf.ctaHref}
                                        className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-4 text-xs font-bold text-[var(--ps-accent-fg)] shadow-xs hover:opacity-95 transition-opacity"
                                      >
                                        <span>{wf.ctaLabel}</span>
                                        <ArrowRight className="h-3.5 w-3.5" />
                                      </Link>
                                    </div>
                                  </div>
                                )}
                              </article>
                            );
                          })}
                        </div>
                      </section>
                    )}

                    {/* Troubleshooting FAQ Accordions */}
                    {guide.faqs.length > 0 && (
                      <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5 space-y-3.5 shadow-xs">
                        <div className="flex items-center gap-2">
                          <HelpCircle className="h-4 w-4 text-[var(--ps-accent)]" />
                          <h3 className="text-sm font-extrabold text-[var(--ps-text)]">
                            {guide.shortTitle} Troubleshooting &amp; FAQs
                          </h3>
                        </div>

                        <div className="space-y-2">
                          {guide.faqs.map((faq) => {
                            const isFaqOpen =
                              Boolean(openFaqIds[faq.id]) ||
                              Boolean(normalizedQuery);
                            return (
                              <div
                                key={faq.id}
                                data-testid={`guide-faq-${faq.id}`}
                                className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] overflow-hidden"
                              >
                                <button
                                  type="button"
                                  onClick={() =>
                                    setOpenFaqIds((prev) => ({
                                      ...prev,
                                      [faq.id]: !isFaqOpen,
                                    }))
                                  }
                                  aria-expanded={isFaqOpen}
                                  className="flex w-full min-h-[48px] items-center justify-between gap-2 px-4 py-3 text-left text-xs font-extrabold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]/50 transition-colors cursor-pointer"
                                >
                                  <span>{faq.question}</span>
                                  {isFaqOpen ? (
                                    <ChevronUp className="h-4 w-4 shrink-0 text-[var(--ps-text-muted)]" />
                                  ) : (
                                    <ChevronDown className="h-4 w-4 shrink-0 text-[var(--ps-text-muted)]" />
                                  )}
                                </button>
                                {isFaqOpen && (
                                  <div className="border-t border-[var(--ps-border)] bg-[var(--ps-surface)] px-4 py-3 space-y-2.5 text-xs leading-relaxed text-[var(--ps-text-muted)]">
                                    <p>{faq.answer}</p>
                                    {faq.deepLinkUrl && (
                                      <div>
                                        <Link
                                          href={faq.deepLinkUrl}
                                          className="inline-flex min-h-[38px] items-center gap-1 text-xs font-bold text-[var(--ps-accent)] hover:underline"
                                        >
                                          <span>
                                            {faq.deepLinkLabel || 'Open Section'}
                                          </span>
                                          <ArrowRight className="h-3 w-3" />
                                        </Link>
                                      </div>
                                    )}
                                  </div>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      </section>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </main>
  );
}

export default function GuidesPage() {
  return (
    <Suspense
      fallback={
        <main className="min-h-screen bg-[var(--ps-bg)] px-4 py-8 text-[var(--ps-text)]">
          <div className="mx-auto max-w-7xl space-y-5">
            <div className="dd-shimmer h-28 w-full rounded-2xl" />
            <div className="dd-shimmer h-12 w-full rounded-xl" />
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
              <div className="dd-shimmer h-96 lg:col-span-5 rounded-2xl" />
              <div className="dd-shimmer h-96 lg:col-span-7 rounded-2xl" />
            </div>
          </div>
        </main>
      }
    >
      <RoleGuidesHubInner />
    </Suspense>
  );
}
