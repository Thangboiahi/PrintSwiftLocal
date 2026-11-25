'use client';

import React, { useMemo, useState } from 'react';
import type { LucideIcon } from 'lucide-react';
import {
  ChevronDown,
  ChevronRight,
  PanelLeftClose,
  PanelLeftOpen,
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

function sumGroupBadge(group: SuperadminNavGroup): number {
  return group.items.reduce((acc, item) => {
    const n = typeof item.badge === 'number' ? item.badge : 0;
    return acc + (Number.isFinite(n) && n > 0 ? n : 0);
  }, 0);
}

export function SuperadminNavShell({
  groups,
  activeId,
  onSelect,
  headerSlot,
  children,
}: SuperadminNavShellProps) {
  // Tablet (md..lg): defaults to collapsed icon-only (w-16), expandable to w-64
  const [isTabletExpanded, setIsTabletExpanded] = useState(false);
  // Desktop (lg+): defaults to expanded (w-64), collapsible to w-16
  const [isDesktopCollapsed, setIsDesktopCollapsed] = useState(false);

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

  const toggleGroup = (groupId: string) => {
    setExpandedGroups((prev) => ({
      ...prev,
      [groupId]: prev[groupId] === false,
    }));
  };

  const handleSelectItem = (itemId: string) => {
    onSelect(itemId);
  };

  const renderSidebar = ({
    collapsed,
    onToggleCollapse,
    visibilityClass,
    testId,
  }: {
    collapsed: boolean;
    onToggleCollapse: () => void;
    visibilityClass: string;
    testId: string;
  }) => (
    <aside
      data-testid={testId}
      aria-label="Superadmin console navigation"
      className={`${visibilityClass} sticky top-[4.5rem] h-[calc(100dvh-5.5rem)] max-h-[calc(100dvh-5.5rem)] flex-col shrink-0 self-start overflow-hidden rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text)] shadow-xs transition-[width] duration-200 ${
        collapsed ? 'w-16' : 'w-64'
      }`}
    >
      {/* Sticky Top Collapse / Expand Header (Never scrolls out of view) */}
      <div
        data-testid={`${testId}-sticky-header`}
        className={`sticky top-0 z-10 shrink-0 flex items-center gap-2 border-b border-[var(--ps-border)] bg-[var(--ps-surface)] ${
          collapsed ? 'justify-center px-2 py-3' : 'justify-between px-3 py-3'
        }`}
      >
        {!collapsed && (
          <div className="min-w-0">
            <div className="text-[10.5px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)] truncate">
              Console Navigation
            </div>
            {activeContext.item && (
              <div className="text-xs font-semibold text-[var(--ps-text)] truncate">
                {activeContext.item.label}
              </div>
            )}
          </div>
        )}
        <button
          type="button"
          onClick={onToggleCollapse}
          aria-label={
            collapsed
              ? 'Expand sidebar navigation'
              : 'Collapse sidebar navigation'
          }
          title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
          className="inline-flex min-h-[44px] min-w-[44px] shrink-0 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:border-[var(--ps-accent)] hover:bg-[var(--ps-surface-alt)] hover:text-[var(--ps-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)] transition-colors cursor-pointer"
        >
          {collapsed ? (
            <PanelLeftOpen className="h-4 w-4" aria-hidden="true" />
          ) : (
            <PanelLeftClose className="h-4 w-4" aria-hidden="true" />
          )}
        </button>
      </div>

      {/* Independently Scrollable Navigation Region */}
      <div
        data-testid={`${testId}-scroll-body`}
        className={`min-h-0 flex-1 overflow-y-auto overscroll-contain bg-[var(--ps-surface)] ${
          collapsed ? 'px-2 py-2.5' : 'px-3 py-2.5'
        }`}
      >
        {/* Optional Header Slot (expanded only) */}
        {!collapsed && headerSlot && (
          <div className="mb-2.5 pb-2.5 border-b border-[var(--ps-border)]">
            {headerSlot}
          </div>
        )}

        {/* Navigation Tree */}
        <nav
          className={`space-y-2 pb-4 ${
            collapsed ? 'w-full flex flex-col items-center' : ''
          }`}
        >
          {visibleGroups.map((group) => {
            const GroupIcon = group.icon;
            const isGroupActive = activeContext.group?.id === group.id;
            const isExpanded = expandedGroups[group.id] !== false;
            const totalBadge = sumGroupBadge(group);

            if (collapsed) {
              return (
                <div
                  key={group.id}
                  className="group/tip relative w-full flex flex-col items-center gap-1"
                >
                  <button
                    type="button"
                    onClick={() => {
                      if (!isGroupActive && group.items[0]) {
                        handleSelectItem(group.items[0].id);
                      }
                      if (group.items.length > 1) {
                        onToggleCollapse();
                      }
                    }}
                    title={`${group.label}${
                      group.items.length > 1
                        ? ` (${group.items.length} sections — click to expand)`
                        : ''
                    }`}
                    aria-label={group.label}
                    aria-current={isGroupActive ? 'true' : undefined}
                    className={`relative inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)] cursor-pointer ${
                      isGroupActive
                        ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-xs'
                        : 'border-transparent bg-transparent text-[var(--ps-text-muted)] hover:border-[var(--ps-border)] hover:bg-[var(--ps-surface-alt)] hover:text-[var(--ps-text)]'
                    }`}
                  >
                    <GroupIcon className="h-4 w-4" aria-hidden="true" />
                    {totalBadge > 0 && (
                      <span
                        aria-hidden="true"
                        className={`absolute right-1.5 top-1.5 h-2 w-2 rounded-full ring-2 ring-[var(--ps-surface)] ${
                          isGroupActive
                            ? 'bg-[var(--ps-accent-fg)]'
                            : 'bg-[var(--ps-accent)]'
                        }`}
                      />
                    )}
                  </button>
                </div>
              );
            }

            return (
              <div key={group.id} className="space-y-1">
                <button
                  type="button"
                  onClick={() => toggleGroup(group.id)}
                  aria-expanded={isExpanded}
                  className={`flex w-full min-h-[44px] items-center justify-between gap-2 rounded-xl px-2.5 py-2 text-left text-[11px] font-bold uppercase tracking-wider transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)] cursor-pointer ${
                    isGroupActive
                      ? 'bg-[var(--ps-surface-alt)]/70 text-[var(--ps-text)]'
                      : 'text-[var(--ps-text-muted)] hover:bg-[var(--ps-surface-alt)] hover:text-[var(--ps-text)]'
                  }`}
                >
                  <span className="inline-flex items-center gap-2 min-w-0">
                    <GroupIcon
                      className={`h-3.5 w-3.5 shrink-0 ${
                        isGroupActive
                          ? 'text-[var(--ps-accent)]'
                          : 'text-[var(--ps-text-muted)]'
                      }`}
                      aria-hidden="true"
                    />
                    <span className="truncate">{group.label}</span>
                  </span>
                  <span className="inline-flex items-center gap-1.5 shrink-0">
                    {!isExpanded && totalBadge > 0 && (
                      <span className="rounded-full border border-[var(--ps-border)] bg-[var(--ps-bg)] px-1.5 py-0.5 font-mono text-[10px] font-bold text-[var(--ps-text-muted)]">
                        {totalBadge}
                      </span>
                    )}
                    {isExpanded ? (
                      <ChevronDown
                        className="h-3.5 w-3.5 shrink-0 text-[var(--ps-text-muted)]"
                        aria-hidden="true"
                      />
                    ) : (
                      <ChevronRight
                        className="h-3.5 w-3.5 shrink-0 text-[var(--ps-text-muted)]"
                        aria-hidden="true"
                      />
                    )}
                  </span>
                </button>

                {isExpanded && (
                  <div className="space-y-0.5 border-l border-[var(--ps-border)] ml-2.5 pl-2">
                    {group.items.map((item) => {
                      const ItemIcon = item.icon;
                      const isItemActive = item.id === activeId;
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => handleSelectItem(item.id)}
                          aria-current={isItemActive ? 'page' : undefined}
                          className={`flex w-full min-h-[44px] items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)] cursor-pointer ${
                            isItemActive
                              ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-xs'
                              : 'text-[var(--ps-text-muted)] hover:bg-[var(--ps-surface-alt)] hover:text-[var(--ps-text)]'
                          }`}
                        >
                          <span className="inline-flex items-center gap-2.5 min-w-0">
                            <ItemIcon
                              className="h-4 w-4 shrink-0"
                              aria-hidden="true"
                            />
                            <span className="truncate">{item.label}</span>
                          </span>
                          {item.badge !== undefined &&
                            item.badge !== '' &&
                            item.badge !== 0 && (
                              <span
                                className={`shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[10px] font-bold ${
                                  isItemActive
                                    ? 'bg-[var(--ps-accent-fg)]/18 text-[var(--ps-accent-fg)]'
                                    : 'border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)]'
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
      </div>
    </aside>
  );

  return (
    <div className="w-full min-w-0 max-w-full overflow-x-clip">
      {/* MOBILE (< md): Dual Horizontally Scrollable Tab Strips (Row 1: Main Groups, Row 2: Nested Child Tabs) */}
      <div
        data-testid="superadmin-mobile-dual-tabs"
        className="md:hidden sticky top-0 z-30 -mx-4 mb-4 border-b border-[var(--ps-border)] bg-[var(--ps-surface)] px-4 py-2 text-[var(--ps-text)] max-w-[calc(100%+2rem)] overflow-x-clip"
      >
        {/* Row 1: Primary 5 Groups */}
        <div
          role="tablist"
          aria-label="Superadmin console sections"
          className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1.5"
        >
          {visibleGroups.map((group) => {
            const GroupIcon = group.icon;
            const isGroupActive = activeContext.group?.id === group.id;
            const totalBadge = sumGroupBadge(group);
            return (
              <button
                key={group.id}
                type="button"
                role="tab"
                aria-selected={isGroupActive}
                onClick={() => {
                  if (!isGroupActive && group.items[0]) {
                    handleSelectItem(group.items[0].id);
                  }
                }}
                className={`inline-flex shrink-0 min-h-[44px] items-center gap-1.5 whitespace-nowrap rounded-xl border px-3 py-2 text-xs font-semibold transition-colors cursor-pointer ${
                  isGroupActive
                    ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-xs'
                    : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:bg-[var(--ps-surface-alt)] hover:text-[var(--ps-text)]'
                }`}
              >
                <GroupIcon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                <span>{group.label}</span>
                {totalBadge > 0 && (
                  <span
                    className={`rounded-full px-1.5 py-0.5 font-mono text-[10px] font-bold ${
                      isGroupActive
                        ? 'bg-[var(--ps-accent-fg)]/18 text-[var(--ps-accent-fg)]'
                        : 'border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)]'
                    }`}
                  >
                    {totalBadge}
                  </span>
                )}
              </button>
            );
          })}
        </div>

        {/* Row 2: Nested Child Tabs for the Active Group */}
        {activeContext.group && activeContext.group.items.length > 0 && (
          <div
            role="tablist"
            aria-label={`${activeContext.group.label} subsections`}
            className="flex items-center gap-1.5 overflow-x-auto no-scrollbar border-t border-[var(--ps-border)] pt-1.5"
          >
            {activeContext.group.items.map((item) => {
              const ItemIcon = item.icon;
              const isItemActive = item.id === activeId;
              return (
                <button
                  key={item.id}
                  type="button"
                  role="tab"
                  aria-selected={isItemActive}
                  aria-current={isItemActive ? 'page' : undefined}
                  onClick={() => handleSelectItem(item.id)}
                  className={`inline-flex shrink-0 min-h-[44px] items-center gap-1.5 whitespace-nowrap rounded-lg border px-3 py-1.5 text-xs font-semibold transition-colors cursor-pointer ${
                    isItemActive
                      ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)]/12 text-[var(--ps-accent)]'
                      : 'border-transparent text-[var(--ps-text-muted)] hover:bg-[var(--ps-surface-alt)] hover:text-[var(--ps-text)]'
                  }`}
                >
                  <ItemIcon
                    className="h-3.5 w-3.5 shrink-0"
                    aria-hidden="true"
                  />
                  <span>{item.shortLabel || item.label}</span>
                  {item.badge !== undefined &&
                    item.badge !== '' &&
                    item.badge !== 0 && (
                      <span className="rounded-full border border-[var(--ps-border)] bg-[var(--ps-bg)] px-1.5 py-0.5 font-mono text-[10px] font-bold text-[var(--ps-text-muted)]">
                        {item.badge}
                      </span>
                    )}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* MAIN LAYOUT: Tablet/Desktop Independently Scrollable Sidebar + Content Pane */}
      <div className="flex w-full min-w-0 items-start gap-5">
        {/* TABLET (md .. <lg): Independently scrollable rail, defaults to collapsed w-16 */}
        {renderSidebar({
          collapsed: !isTabletExpanded,
          onToggleCollapse: () => setIsTabletExpanded((prev) => !prev),
          visibilityClass: 'hidden md:flex lg:hidden',
          testId: 'superadmin-tablet-sidebar',
        })}

        {/* DESKTOP (lg+): Independently scrollable rail, defaults to expanded w-64 */}
        {renderSidebar({
          collapsed: isDesktopCollapsed,
          onToggleCollapse: () => setIsDesktopCollapsed((prev) => !prev),
          visibilityClass: 'hidden lg:flex',
          testId: 'superadmin-desktop-sidebar',
        })}

        {/* Active Workspace Pane */}
        <div className="min-w-0 flex-1 max-w-full">{children}</div>
      </div>
    </div>
  );
}

export default SuperadminNavShell;
