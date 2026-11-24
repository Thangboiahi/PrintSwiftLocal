'use client';

import React, { useEffect, useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
  X,
} from 'lucide-react';

export interface SuperadminNavItem {
  id: string;
  label: string;
  shortLabel?: string;
  icon: LucideIcon;
  badge?: string | number;
  hidden?: boolean;
}

export interface SuperadminNavGroup {
  id: string;
  label: string;
  icon: LucideIcon;
  items: SuperadminNavItem[];
}

export interface SuperadminNavShellProps {
  groups: SuperadminNavGroup[];
  activeId: string;
  onSelect: (id: string) => void;
  headerSlot?: React.ReactNode;
  children: React.ReactNode;
}

export function SuperadminNavShell({
  groups,
  activeId,
  onSelect,
  headerSlot,
  children,
}: SuperadminNavShellProps) {
  const [isDesktopCollapsed, setIsDesktopCollapsed] = useState(false);
  const [tabletDrawerGroupId, setTabletDrawerGroupId] = useState<string | null>(
    null
  );
  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>(
    () =>
      Object.fromEntries(groups.map((g) => [g.id, true])) as Record<
        string,
        boolean
      >
  );

  const visibleGroups = useMemo(
    () =>
      groups
        .map((g) => ({
          ...g,
          items: g.items.filter((it) => !it.hidden),
        }))
        .filter((g) => g.items.length > 0),
    [groups]
  );

  const activeGroup =
    visibleGroups.find((g) => g.items.some((it) => it.id === activeId)) ??
    visibleGroups[0];
  const activeItem =
    activeGroup?.items.find((it) => it.id === activeId) ??
    activeGroup?.items[0];
  const activeContext = { group: activeGroup, item: activeItem };

  const tabletDrawerGroup =
    visibleGroups.find((g) => g.id === tabletDrawerGroupId) || null;

  useEffect(() => {
    if (!tabletDrawerGroupId) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setTabletDrawerGroupId(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [tabletDrawerGroupId]);

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) => ({
      ...prev,
      [groupId]: prev[groupId] === false,
    }));
  };

  const handleSelectItem = (itemId: string) => {
    onSelect(itemId);
    setTabletDrawerGroupId(null);
  };

  return (
    <div className="w-full min-w-0 max-w-full overflow-x-clip">
      {/* MOBILE (<md): Sticky Section Switcher + Horizontally Scrollable Sub-Tabs */}
      <div className="md:hidden sticky top-0 z-30 -mx-4 mb-4 border-b border-[var(--ps-border)] bg-[var(--ps-surface)]/95 px-4 py-2.5 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <label htmlFor="superadmin-mobile-group" className="sr-only">
            Console Section
          </label>
          <select
            id="superadmin-mobile-group"
            value={activeContext.group?.id || ''}
            onChange={(e) => {
              const target = visibleGroups.find((g) => g.id === e.target.value);
              if (target && target.items[0]) {
                handleSelectItem(target.items[0].id);
              }
            }}
            className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs font-semibold text-[var(--ps-text)]"
          >
            {visibleGroups.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}
              </option>
            ))}
          </select>
        </div>

        {activeContext.group && (
          <nav
            aria-label={`${activeContext.group.label} tabs`}
            className="mt-2 flex w-full max-w-full items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5"
          >
            {activeContext.group.items.map((item) => {
              const Icon = item.icon;
              const isActive = item.id === activeId;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelectItem(item.id)}
                  aria-current={isActive ? 'page' : undefined}
                  className={`inline-flex min-h-[44px] shrink-0 whitespace-nowrap items-center gap-1.5 rounded-xl px-3 text-xs font-semibold transition cursor-pointer ${
                    isActive
                      ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                      : 'border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)]'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5 shrink-0" />
                  <span>{item.shortLabel || item.label}</span>
                  {item.badge !== undefined &&
                    item.badge !== '' &&
                    item.badge !== 0 && (
                      <span
                        className={`rounded-md px-1.5 py-0.5 font-mono text-[10px] tabular-nums ${
                          isActive
                            ? 'bg-white/20 text-white'
                            : 'bg-[var(--ps-surface-alt)] text-[var(--ps-text)]'
                        }`}
                      >
                        {item.badge}
                      </span>
                    )}
                </button>
              );
            })}
          </nav>
        )}
      </div>

      {/* SHELL FRAME (Tablet Icon Rail + Desktop Collapsible Sidebar + Content) */}
      <div className="flex min-w-0 items-start gap-4 lg:gap-5">
        {/* TABLET (md to <lg): Compact Icon Rail */}
        <aside
          aria-label="Superadmin section rail"
          className="hidden md:flex lg:hidden sticky top-4 w-16 shrink-0 flex-col items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-2"
        >
          {visibleGroups.map((group) => {
            const GroupIcon = group.icon;
            const isGroupActive = activeContext.group?.id === group.id;
            const isDrawerOpen = tabletDrawerGroupId === group.id;
            return (
              <button
                key={group.id}
                type="button"
                title={group.label}
                aria-label={group.label}
                aria-expanded={isDrawerOpen}
                onClick={() =>
                  setTabletDrawerGroupId(isDrawerOpen ? null : group.id)
                }
                className={`flex h-11 w-11 items-center justify-center rounded-xl transition cursor-pointer ${
                  isGroupActive || isDrawerOpen
                    ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                    : 'text-[var(--ps-text-muted)] hover:bg-[var(--ps-surface-alt)] hover:text-[var(--ps-text)]'
                }`}
              >
                <GroupIcon className="h-4.5 w-4.5" />
              </button>
            );
          })}
        </aside>

        {/* TABLET SLIDE-OVER DRAWER */}
        {tabletDrawerGroup && (
          <div
            className="fixed inset-0 z-40 hidden md:flex lg:hidden bg-black/40"
            onClick={() => setTabletDrawerGroupId(null)}
          >
            <div
              className="ml-20 mt-4 mb-4 flex w-72 flex-col overflow-hidden rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] shadow-xl"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-[var(--ps-border)] px-4 py-3">
                <div className="flex items-center gap-2">
                  <tabletDrawerGroup.icon className="h-4 w-4 text-[var(--ps-accent)]" />
                  <h2 className="text-xs font-bold uppercase tracking-wider text-[var(--ps-text)]">
                    {tabletDrawerGroup.label}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setTabletDrawerGroupId(null)}
                  aria-label="Close section drawer"
                  className="flex h-10 w-10 items-center justify-center rounded-lg text-[var(--ps-text-muted)] hover:bg-[var(--ps-surface-alt)]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <nav className="flex-1 space-y-1 overflow-y-auto p-2.5">
                {tabletDrawerGroup.items.map((item) => {
                  const Icon = item.icon;
                  const isActive = item.id === activeId;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => handleSelectItem(item.id)}
                      className={`flex min-h-[44px] w-full items-center justify-between gap-2 rounded-xl px-3 text-left text-xs font-semibold transition cursor-pointer ${
                        isActive
                          ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                          : 'text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                      }`}
                    >
                      <span className="flex min-w-0 items-center gap-2.5">
                        <Icon className="h-4 w-4 shrink-0" />
                        <span className="truncate">{item.label}</span>
                      </span>
                      {item.badge !== undefined &&
                        item.badge !== '' &&
                        item.badge !== 0 && (
                          <span className="font-mono text-[10px] tabular-nums opacity-85">
                            {item.badge}
                          </span>
                        )}
                    </button>
                  );
                })}
              </nav>
            </div>
          </div>
        )}

        {/* DESKTOP (lg+): Collapsible Nested Sidebar */}
        <aside
          aria-label="Superadmin console navigation"
          className={`hidden lg:flex sticky top-4 shrink-0 flex-col rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] transition-all duration-200 ${
            isDesktopCollapsed ? 'w-16 p-2' : 'w-64 p-3'
          }`}
        >
          <div
            className={`flex items-center border-b border-[var(--ps-border)] pb-2.5 mb-2.5 ${
              isDesktopCollapsed ? 'justify-center' : 'justify-between px-1'
            }`}
          >
            {!isDesktopCollapsed && (
              <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                Console Navigation
              </span>
            )}
            <button
              type="button"
              onClick={() => setIsDesktopCollapsed((prev) => !prev)}
              aria-label={
                isDesktopCollapsed ? 'Expand sidebar' : 'Collapse sidebar'
              }
              title={isDesktopCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
            >
              {isDesktopCollapsed ? (
                <PanelLeftOpen className="h-4 w-4" />
              ) : (
                <PanelLeftClose className="h-4 w-4" />
              )}
            </button>
          </div>

          <nav className="space-y-3">
            {visibleGroups.map((group) => {
              const GroupIcon = group.icon;
              const isOpen = expandedGroups[group.id] !== false;
              const isGroupActive = activeContext.group?.id === group.id;

              if (isDesktopCollapsed) {
                return (
                  <div
                    key={group.id}
                    className="flex flex-col items-center gap-1 border-b border-[var(--ps-border)]/60 pb-2 last:border-b-0 last:pb-0"
                  >
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      const isActive = item.id === activeId;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          title={`${group.label} · ${item.label}`}
                          aria-label={item.label}
                          aria-current={isActive ? 'page' : undefined}
                          onClick={() => handleSelectItem(item.id)}
                          className={`flex h-11 w-11 items-center justify-center rounded-xl transition cursor-pointer ${
                            isActive
                              ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                              : 'text-[var(--ps-text-muted)] hover:bg-[var(--ps-surface-alt)] hover:text-[var(--ps-text)]'
                          }`}
                        >
                          <Icon className="h-4 w-4" />
                        </button>
                      );
                    })}
                  </div>
                );
              }

              return (
                <div key={group.id} className="space-y-1">
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.id)}
                    aria-expanded={isOpen}
                    className={`flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left text-[11px] font-bold uppercase tracking-wider transition cursor-pointer ${
                      isGroupActive
                        ? 'text-[var(--ps-text)]'
                        : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                    }`}
                  >
                    <span className="flex items-center gap-1.5 truncate">
                      <GroupIcon className="h-3.5 w-3.5 shrink-0 text-[var(--ps-accent)]" />
                      <span className="truncate">{group.label}</span>
                    </span>
                    {isOpen ? (
                      <ChevronDown className="h-3.5 w-3.5 shrink-0 opacity-70" />
                    ) : (
                      <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-70" />
                    )}
                  </button>

                  {isOpen && (
                    <div className="space-y-0.5 pl-1">
                      {group.items.map((item) => {
                        const Icon = item.icon;
                        const isActive = item.id === activeId;
                        return (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => handleSelectItem(item.id)}
                            aria-current={isActive ? 'page' : undefined}
                            className={`flex min-h-[44px] w-full items-center justify-between gap-2 rounded-xl px-2.5 text-left text-xs font-medium transition cursor-pointer ${
                              isActive
                                ? 'bg-[var(--ps-accent)] font-semibold text-[var(--ps-accent-fg)]'
                                : 'text-[var(--ps-text-muted)] hover:bg-[var(--ps-surface-alt)] hover:text-[var(--ps-text)]'
                            }`}
                          >
                            <span className="flex min-w-0 items-center gap-2.5">
                              <Icon className="h-4 w-4 shrink-0" />
                              <span className="truncate">{item.label}</span>
                            </span>
                            {item.badge !== undefined &&
                              item.badge !== '' &&
                              item.badge !== 0 && (
                                <span
                                  className={`shrink-0 rounded-md px-1.5 py-0.5 font-mono text-[10px] font-semibold tabular-nums ${
                                    isActive
                                      ? 'bg-white/20 text-white'
                                      : 'bg-[var(--ps-bg)] text-[var(--ps-text-muted)] border border-[var(--ps-border)]'
                                  }`}
                                >
                                  {item.badge}
                                </span>
                              )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </nav>
        </aside>

        {/* MAIN CONTENT AREA */}
        <div className="min-w-0 flex-1 space-y-5">
          {/* Breadcrumb Strip */}
          {activeContext.group && activeContext.item && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-4 py-2.5 text-xs">
              <div className="flex min-w-0 items-center gap-1.5 text-[var(--ps-text-muted)]">
                <span className="font-semibold text-[var(--ps-text)]">
                  Superadmin
                </span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-60" />
                <span className="truncate">{activeContext.group.label}</span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 opacity-60" />
                <span className="truncate font-semibold text-[var(--ps-text)]">
                  {activeContext.item.label}
                </span>
              </div>
              {headerSlot}
            </div>
          )}

          {children}
        </div>
      </div>
    </div>
  );
}

export default SuperadminNavShell;
