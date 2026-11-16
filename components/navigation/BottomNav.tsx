'use client';

import React from 'react';
import {
  canRoleAccessWorkspace,
  useAppStore,
  useAuth,
} from '@/lib/store';
import type { GlobalNavDestination, NavItemConfig } from './Header';

export interface BottomNavProps {
  navItems: NavItemConfig[];
  activeNav: GlobalNavDestination;
  fullPageListingId: string | null;
  onActivateNavDestination: (id: GlobalNavDestination) => void;
  optimisticRole?: string;
  variant?: 'bottom' | 'rail';
}

export function BottomNav({
  navItems,
  activeNav,
  fullPageListingId,
  onActivateNavDestination,
  optimisticRole,
  variant = 'bottom',
}: BottomNavProps) {
  const { currentUser, savedListingIds } = useAppStore();
  const { user: authUser, role: syncedAuthRole } = useAuth();

  const savedCount = Array.isArray(savedListingIds)
    ? savedListingIds.length
    : 0;

  const metadataRole = authUser?.user_metadata
    ? String(
        authUser.user_metadata.admin_role ||
          authUser.user_metadata.role_type ||
          authUser.user_metadata.role ||
          ''
      ).toLowerCase()
    : '';

  const resolvedRole = (
    optimisticRole ||
    (authUser ? syncedAuthRole : '') ||
    metadataRole ||
    currentUser.adminRole ||
    currentUser.roleType ||
    'visitor'
  )
    .toString()
    .toLowerCase();

  const canAccessWorkspace =
    canRoleAccessWorkspace(resolvedRole) ||
    (!authUser &&
      (currentUser.roleType === 'owner' ||
        currentUser.roleType === 'staff' ||
        currentUser.roleType === 'admin' ||
        Boolean(currentUser.adminRole)));

  const visibleItems = navItems.filter((item) => {
    if (item.id === 'workspace') {
      return canAccessWorkspace;
    }
    return true;
  });

  if (variant === 'rail') {
    return (
      <nav
        aria-label="Mobile landscape vertical navigation rail"
        data-testid="landscape-vertical-nav-rail"
        data-user-role={resolvedRole}
        className="[@media(max-height:500px)_and_(max-width:640px)]:hidden w-14 shrink-0 bg-[var(--ps-surface)]/98 backdrop-blur-md border-r border-[var(--ps-border)] py-1.5 px-1 flex flex-col items-center justify-around z-30 select-none overflow-x-hidden"
      >
        {visibleItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeNav === item.id && !fullPageListingId;
          const badgeCount =
            item.id === 'saved' ? savedCount : (item.badge ?? 0);
          const showBadge = badgeCount > 0;
          return (
            <button
              key={item.id}
              type="button"
              onClick={() => onActivateNavDestination(item.id)}
              title={item.label}
              aria-label={item.label}
              aria-current={isActive ? 'page' : undefined}
              data-testid={`mobile-nav-${item.id}`}
              data-rail-nav={item.id}
              data-saved-count={item.id === 'saved' ? badgeCount : undefined}
              className={`relative w-full min-h-[44px] min-w-[44px] py-1 px-0.5 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)] ${
                isActive
                  ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] font-bold shadow-xs'
                  : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] font-medium'
              }`}
            >
              <div className="relative">
                <Icon className="w-3.5 h-3.5" />
                {showBadge && (
                  <span
                    data-testid={
                      item.id === 'saved'
                        ? 'rail-saved-badge'
                        : `rail-badge-${item.id}`
                    }
                    className={`absolute -top-1.5 -right-2.5 min-w-[13px] h-[13px] px-0.5 rounded-full text-[8px] font-bold flex items-center justify-center tabular-nums ${
                      isActive
                        ? 'bg-white text-slate-900'
                        : 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                    }`}
                  >
                    {badgeCount}
                  </span>
                )}
              </div>
              <span className="text-[9px] leading-none truncate max-w-full whitespace-nowrap">
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>
    );
  }

  return (
    <nav
      aria-label="Mobile bottom navigation"
      data-testid="mobile-bottom-nav"
      data-user-role={resolvedRole}
      className="[@media(max-height:500px)]:hidden lg:hidden fixed bottom-0 left-0 right-0 z-40 h-14 min-h-[56px] max-h-14 w-full overflow-hidden bg-[var(--ps-surface)]/98 backdrop-blur-md border-t border-[var(--ps-border)] px-1 pb-[env(safe-area-inset-bottom)] flex flex-row flex-nowrap items-center justify-around shrink-0 select-none"
    >
      {visibleItems.map((item) => {
        const Icon = item.icon;
        const isActive = activeNav === item.id && !fullPageListingId;
        const badgeCount =
          item.id === 'saved' ? savedCount : (item.badge ?? 0);
        const showBadge = badgeCount > 0;
        return (
          <button
            key={item.id}
            type="button"
            onClick={() => onActivateNavDestination(item.id)}
            title={item.label}
            aria-label={item.label}
            aria-current={isActive ? 'page' : undefined}
            data-testid={`mobile-nav-${item.id}`}
            data-saved-count={item.id === 'saved' ? badgeCount : undefined}
            className={`relative flex-1 min-w-0 h-full min-h-[44px] px-1 flex flex-col items-center justify-center gap-0.5 rounded-xl whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)] ${
              isActive
                ? 'font-bold bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] font-medium'
            }`}
          >
            <div className="relative shrink-0">
              <Icon
                className={`${
                  isActive
                    ? 'w-5 h-5 bg-white/20'
                    : 'w-4 h-4 bg-[var(--ps-surface-alt)] text-[var(--ps-text)]'
                }`}
              />
              {showBadge && (
                <span
                  data-testid={
                    item.id === 'saved'
                      ? 'bottom-nav-saved-badge'
                      : `bottom-nav-badge-${item.id}`
                  }
                  className={`absolute -top-1.5 -right-2.5 min-w-[14px] h-[14px] px-1 rounded-full text-[9px] font-bold flex items-center justify-center tabular-nums ${
                    isActive
                      ? 'bg-white text-slate-900'
                      : 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                  }`}
                >
                  {badgeCount}
                </span>
              )}
            </div>
            <span className="text-[10px] leading-tight truncate max-w-full whitespace-nowrap">
              {item.label}
            </span>
          </button>
        );
      })}
    </nav>
  );
}

export default BottomNav;
