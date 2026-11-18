'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import {
  canRoleAccessWorkspace,
  useAppStore,
  useAuth,
} from '@/lib/store';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import type { GlobalNavDestination, NavItemConfig } from './Header';

export interface BottomNavProps {
  navItems: NavItemConfig[];
  activeNav: GlobalNavDestination;
  fullPageListingId: string | null;
  onActivateNavDestination: (id: GlobalNavDestination) => void;
  onOpenAuthModal?: () => void;
  optimisticRole?: string;
  variant?: 'bottom' | 'rail';
  mobileScrollDirection?: 'up' | 'down' | null;
}

export function BottomNav({
  navItems,
  activeNav,
  fullPageListingId,
  onActivateNavDestination,
  optimisticRole,
  variant = 'bottom',
  mobileScrollDirection = null,
}: BottomNavProps) {
  const router = useRouter();
  const pathname = usePathname() || '/';
  const { currentUser, savedListingIds } = useAppStore();
  const { user: authUser, session: activeSession, role: syncedAuthRole } =
    useAuth();
  const activeUserId = authUser?.id || activeSession?.user?.id || '';

  const [syncedBookmarkCount, setSyncedBookmarkCount] = useState<number | null>(
    null
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let active = true;

    const handleBookmarksUpdated = async () => {
      let localCount: number | null = null;
      try {
        const raw = window.localStorage.getItem('printswift_local_demo_state_v1');
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed?.savedListingIds)) {
            localCount = parsed.savedListingIds.length;
          }
        }
      } catch {
        // ignore storage parse error
      }
      if (active && localCount !== null) {
        setSyncedBookmarkCount(localCount);
      }

      if (activeUserId && isSupabaseConfigured()) {
        try {
          const { data } = await supabase
            .from('profiles')
            .select('saved_listing_ids')
            .eq('id', activeUserId)
            .maybeSingle();
          if (active && data) {
            const dbIds = (data as { saved_listing_ids?: unknown })
              .saved_listing_ids;
            if (Array.isArray(dbIds)) {
              setSyncedBookmarkCount(dbIds.length);
            }
          }
        } catch {
          // ignore non-fatal supabase error
        }
      }
    };

    window.addEventListener('bookmarks_updated', handleBookmarksUpdated);
    return () => {
      active = false;
      window.removeEventListener('bookmarks_updated', handleBookmarksUpdated);
    };
  }, [activeUserId]);

  const isItemActive = (id: GlobalNavDestination) => {
    if (id === 'explore') return pathname === '/explore';
    if (id === 'saved') return pathname.startsWith('/bookmarks');
    if (id === 'activity') return pathname.startsWith('/activities');
    if (id === 'workspace') return pathname.startsWith('/workspace') || pathname.startsWith('/admin');
    if (id === 'profile') return pathname.startsWith('/profile');
    return false;
  };

  const handleNavItemClick = (id: GlobalNavDestination) => {
    if (id === 'profile') {
      router.push('/profile');
      return;
    }
    if (id === 'saved') {
      router.push('/bookmarks');
      return;
    }
    if (id === 'activity') {
      router.push('/activities');
      return;
    }
    if (id === 'workspace') {
      router.push('/workspace');
      return;
    }
    if (id === 'explore') {
      if (pathname !== '/explore') {
        router.push('/explore');
        return;
      }
    }
    onActivateNavDestination(id);
  };

  const savedCount =
    syncedBookmarkCount !== null
      ? syncedBookmarkCount
      : Array.isArray(savedListingIds)
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
        className="hidden max-md:landscape:flex w-16 h-full shrink-0 flex-col items-center justify-around py-3 px-1 border-r border-slate-200 dark:border-slate-800 bg-white/95 dark:bg-slate-950/95 backdrop-blur-md z-30 select-none overflow-y-auto overflow-x-hidden"
      >
        {visibleItems.map((item) => {
          const Icon = item.icon;
          const isActive = isItemActive(item.id);
          const badgeCount =
            item.id === 'saved' ? savedCount : (item.badge ?? 0);
          const showBadge = badgeCount > 0;
          const railItemClasses = `relative w-full min-h-[44px] min-w-[44px] py-1 px-0.5 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)] ${
            isActive
              ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-blue-600 dark:text-blue-400 font-bold shadow-xs'
              : 'text-[var(--ps-text-muted)] text-slate-500 hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] font-medium'
          }`;

          if (item.id === 'profile') {
            return (
              <Link
                key={item.id}
                href="/profile"
                title={item.label}
                aria-label={item.label}
                aria-current={isActive ? 'page' : undefined}
                data-testid={`mobile-nav-${item.id}`}
                data-rail-nav={item.id}
                className={railItemClasses}
              >
                <div className="relative">
                  <Icon className="w-3.5 h-3.5" />
                </div>
                <span className="text-[9px] leading-none truncate max-w-full whitespace-nowrap">
                  {item.label}
                </span>
              </Link>
            );
          }

          if (item.id === 'explore') {
            return (
              <Link
                key={item.id}
                href="/explore"
                title={item.label}
                aria-label={item.label}
                aria-current={isActive ? 'page' : undefined}
                data-testid={`mobile-nav-${item.id}`}
                data-rail-nav={item.id}
                className={railItemClasses}
              >
                <div className="relative">
                  <Icon className="w-3.5 h-3.5" />
                </div>
                <span className="text-[9px] leading-none truncate max-w-full whitespace-nowrap">
                  {item.label}
                </span>
              </Link>
            );
          }

          return (
            <button
              key={item.id}
              type="button"
              onClick={() => handleNavItemClick(item.id)}
              title={item.label}
              aria-label={item.label}
              aria-current={isActive ? 'page' : undefined}
              data-testid={`mobile-nav-${item.id}`}
              data-rail-nav={item.id}
              data-saved-count={item.id === 'saved' ? badgeCount : undefined}
              className={railItemClasses}
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
      data-scroll-direction={mobileScrollDirection || 'none'}
      className="flex landscape:hidden md:hidden fixed bottom-0 left-0 right-0 z-40 h-14 min-h-[56px] max-h-14 w-full overflow-hidden bg-[var(--ps-surface)]/98 backdrop-blur-md border-t border-[var(--ps-border)] px-1 pb-[env(safe-area-inset-bottom)] flex-row flex-nowrap items-center justify-around shrink-0 select-none transition-transform duration-300"
    >
      {visibleItems.map((item) => {
        const Icon = item.icon;
        const isActive = isItemActive(item.id);
        const badgeCount =
          item.id === 'saved' ? savedCount : (item.badge ?? 0);
        const showBadge = badgeCount > 0;
        const bottomItemClasses = `relative flex-1 min-w-0 h-full min-h-[44px] px-1 flex flex-col items-center justify-center gap-0.5 rounded-xl whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)] ${
          isActive
            ? 'font-bold bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-blue-600 dark:text-blue-400'
            : 'text-[var(--ps-text-muted)] text-slate-500 hover:text-[var(--ps-text)] font-medium'
        }`;

        if (item.id === 'profile') {
          return (
            <Link
              key={item.id}
              href="/profile"
              title={item.label}
              aria-label={item.label}
              aria-current={isActive ? 'page' : undefined}
              data-testid={`mobile-nav-${item.id}`}
              className={bottomItemClasses}
            >
              <div className="relative shrink-0">
                <Icon
                  className={`${
                    isActive
                      ? 'w-5 h-5 bg-white/20'
                      : 'w-4 h-4 bg-[var(--ps-surface-alt)] text-[var(--ps-text)]'
                  }`}
                />
              </div>
              <span className="text-[10px] leading-tight truncate max-w-full whitespace-nowrap">
                {item.label}
              </span>
            </Link>
          );
        }

        if (item.id === 'explore') {
          return (
            <Link
              key={item.id}
              href="/explore"
              title={item.label}
              aria-label={item.label}
              aria-current={isActive ? 'page' : undefined}
              data-testid={`mobile-nav-${item.id}`}
              className={bottomItemClasses}
            >
              <div className="relative shrink-0">
                <Icon
                  className={`${
                    isActive
                      ? 'w-5 h-5 bg-white/20'
                      : 'w-4 h-4 bg-[var(--ps-surface-alt)] text-[var(--ps-text)]'
                  }`}
                />
              </div>
              <span className="text-[10px] leading-tight truncate max-w-full whitespace-nowrap">
                {item.label}
              </span>
            </Link>
          );
        }

        return (
          <button
            key={item.id}
            type="button"
            onClick={() => handleNavItemClick(item.id)}
            title={item.label}
            aria-label={item.label}
            aria-current={isActive ? 'page' : undefined}
            data-testid={`mobile-nav-${item.id}`}
            data-saved-count={item.id === 'saved' ? badgeCount : undefined}
            className={bottomItemClasses}
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
