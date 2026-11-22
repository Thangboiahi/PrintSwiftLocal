'use client';

import React, { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import {
  Compass,
  Home,
  Newspaper,
  ShoppingBag,
  Truck,
} from 'lucide-react';
import { useAppStore, useAuth } from '@/lib/store';
import type { LiveNavBadges } from '@/lib/hooks/useLiveNavBadges';
import type { GlobalNavDestination, NavItemConfig } from './Header';

function BottomNavUrlModeSync({
  onChange,
}: {
  onChange: (mode: string) => void;
}) {
  const searchParams = useSearchParams();
  const mode = searchParams?.get('mode') || '';
  useEffect(() => {
    onChange(mode);
  }, [mode, onChange]);
  return null;
}

export interface BottomNavProps {
  navItems: NavItemConfig[];
  activeNav: GlobalNavDestination;
  fullPageListingId: string | null;
  onActivateNavDestination: (id: GlobalNavDestination) => void;
  onOpenAuthModal?: () => void;
  optimisticRole?: string;
  variant?: 'bottom' | 'rail';
  mobileScrollDirection?: 'up' | 'down' | null;
  liveBadges?: LiveNavBadges;
}

interface MobileTabItem {
  id: GlobalNavDestination;
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
  isCenterUtility?: boolean;
  badgeCount?: number;
}

function formatBadgeCount(n: number): string {
  if (n > 99) return '99+';
  return String(n);
}

export function BottomNav({
  activeNav,
  fullPageListingId,
  onActivateNavDestination,
  optimisticRole,
  variant = 'bottom',
  mobileScrollDirection = null,
  liveBadges,
}: BottomNavProps) {
  const pathname = usePathname() || '/';
  const [urlMode, setUrlMode] = useState<string>('');
  const isPickNDropExplore =
    pathname.startsWith('/explore') && urlMode === 'pick_n_drop';
  const { currentUser } = useAppStore();
  const { user: authUser, session: activeSession, role: syncedAuthRole } =
    useAuth();
  const isAuthenticated = Boolean(authUser || activeSession?.user);

  const resolvedRole = (
    optimisticRole ||
    (authUser ? syncedAuthRole : '') ||
    currentUser.adminRole ||
    currentUser.roleType ||
    'visitor'
  )
    .toString()
    .toLowerCase();

  const pickNDropCount = isAuthenticated ? (liveBadges?.pickNDropActive ?? 0) : 0;
  const commerceCount = isAuthenticated ? (liveBadges?.commerceActive ?? 0) : 0;

  // 5 consistent thumb-friendly mobile tabs for ALL users (Home, Explore, Pick N Drop, Shop & Food, Bulletin)
  const mobileTabs: MobileTabItem[] = [
    { id: 'home', label: 'Home', href: '/', icon: Home },
    { id: 'explore', label: 'Explore', href: '/explore', icon: Compass },
    {
      id: 'pick_n_drop',
      label: 'Pick N Drop',
      href: '/explore?mode=pick_n_drop',
      icon: Truck,
      isCenterUtility: true,
      badgeCount: pickNDropCount,
    },
    {
      id: 'market',
      label: 'Shop & Food',
      href: '/marketplace',
      icon: ShoppingBag,
      badgeCount: commerceCount,
    },
    { id: 'bulletin', label: 'Bulletin', href: '/bulletin', icon: Newspaper },
  ];

  const isItemActive = (id: GlobalNavDestination) => {
    if (id === 'home') return pathname === '/';
    if (id === 'explore')
      return pathname.startsWith('/explore') && !isPickNDropExplore;
    if (id === 'pick_n_drop')
      return isPickNDropExplore || pathname.startsWith('/pick-n-drop');
    if (id === 'market') return pathname.startsWith('/marketplace');
    if (id === 'vehicles') return pathname.startsWith('/vehicles');
    if (id === 'bulletin') return pathname.startsWith('/bulletin');
    if (id === 'civic') return pathname.startsWith('/civic');
    if (id === 'saved')
      return pathname.startsWith('/saved') || pathname.startsWith('/bookmarks');
    if (id === 'activity')
      return pathname.startsWith('/activity') || pathname.startsWith('/activities');
    if (id === 'workspace')
      return pathname.startsWith('/workspace') || pathname.startsWith('/admin');
    if (id === 'profile') return pathname.startsWith('/profile');
    return false;
  };

  if (variant === 'rail') {
    return (
      <>
        <Suspense fallback={null}>
          <BottomNavUrlModeSync onChange={setUrlMode} />
        </Suspense>
        <nav
        aria-label="Mobile landscape vertical navigation rail"
        data-testid="landscape-vertical-nav-rail"
        data-user-role={resolvedRole}
        className="nav-vertical-responsive w-[68px] h-full shrink-0 flex-col items-center justify-start pt-3 pb-3 gap-2 px-1.5 border-r border-[var(--ps-border)] bg-[var(--ps-surface)]/95 backdrop-blur-md z-[50] select-none overflow-y-auto overflow-x-hidden"
      >
        {mobileTabs.map((item) => {
          const Icon = item.icon;
          const isActive = isItemActive(item.id);
          const count = item.badgeCount ?? 0;
          const railItemClasses = `relative w-14 h-12 rounded-xl flex flex-col items-center justify-center gap-0.5 text-[10px] font-medium shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)] ${
            isActive
              ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] font-semibold shadow-xs'
              : item.isCenterUtility
                ? 'bg-[var(--ps-accent)]/12 text-[var(--ps-accent)] border border-[var(--ps-accent)]/30 font-semibold hover:bg-[var(--ps-accent)]/20'
                : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
          }`;

          return (
            <Link
              key={item.id}
              href={item.href}
              onClick={(e) => {
                if (
                  item.id === 'explore' &&
                  pathname === '/explore' &&
                  !isPickNDropExplore
                ) {
                  e.preventDefault();
                  onActivateNavDestination('explore');
                } else if (fullPageListingId && item.id === activeNav) {
                  onActivateNavDestination(item.id);
                }
              }}
              title={item.label}
              aria-label={item.label}
              aria-current={isActive ? 'page' : undefined}
              data-testid={`mobile-nav-${item.id}`}
              data-rail-nav={item.id}
              className={railItemClasses}
            >
              <Icon className="w-4 h-4" />
              <span className="text-[9.5px] leading-none truncate max-w-full whitespace-nowrap px-0.5">
                {item.label}
              </span>
              {count > 0 && (
                <span
                  data-testid={`mobile-nav-badge-${item.id}`}
                  className="absolute top-0.5 right-0.5 min-w-[16px] h-[16px] px-1 rounded-full bg-rose-600 text-white text-[9px] font-extrabold leading-none flex items-center justify-center shadow-xs tabular-nums ring-2 ring-[var(--ps-surface)]"
                >
                  {formatBadgeCount(count)}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
      </>
    );
  }

  return (
    <>
      <Suspense fallback={null}>
        <BottomNavUrlModeSync onChange={setUrlMode} />
      </Suspense>
      <nav
      aria-label="Mobile bottom navigation"
      data-testid="mobile-bottom-nav"
      data-user-role={resolvedRole}
      data-scroll-direction={mobileScrollDirection || 'none'}
      className="nav-bottom-responsive fixed bottom-0 left-0 right-0 z-[50] h-14 min-h-[56px] max-h-14 w-full overflow-hidden bg-[var(--ps-surface)]/98 backdrop-blur-md border-t border-[var(--ps-border)] px-1.5 py-1 pb-[env(safe-area-inset-bottom)] flex-row flex-nowrap items-center justify-around gap-1 shrink-0 select-none transition-transform duration-300"
    >
      {mobileTabs.map((item) => {
        const Icon = item.icon;
        const isActive = isItemActive(item.id);
        const count = item.badgeCount ?? 0;
        const bottomItemClasses = `relative flex-1 min-w-[44px] h-full px-1 flex flex-col items-center justify-center gap-0.5 rounded-xl whitespace-nowrap shrink-0 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)] ${
          isActive
            ? 'font-bold bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-2xs'
            : item.isCenterUtility
              ? 'font-bold bg-[var(--ps-accent)]/12 text-[var(--ps-accent)] border border-[var(--ps-accent)]/30 hover:bg-[var(--ps-accent)]/20'
              : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] font-medium'
        }`;

        return (
          <Link
            key={item.id}
            href={item.href}
            onClick={(e) => {
              if (
                item.id === 'explore' &&
                pathname === '/explore' &&
                !isPickNDropExplore
              ) {
                e.preventDefault();
                onActivateNavDestination('explore');
              } else if (fullPageListingId && item.id === activeNav) {
                onActivateNavDestination(item.id);
              }
            }}
            title={item.label}
            aria-label={item.label}
            aria-current={isActive ? 'page' : undefined}
            data-testid={`mobile-nav-${item.id}`}
            className={bottomItemClasses}
          >
            <div className="relative inline-flex items-center justify-center">
              <Icon className="w-4 h-4 shrink-0" />
              {count > 0 && (
                <span
                  data-testid={`mobile-nav-badge-${item.id}`}
                  className="absolute -top-1.5 -right-2.5 min-w-[15px] h-[15px] px-1 rounded-full bg-rose-600 text-white text-[9px] font-extrabold leading-none flex items-center justify-center shadow-xs tabular-nums ring-1 ring-[var(--ps-surface)]"
                >
                  {formatBadgeCount(count)}
                </span>
              )}
            </div>
            <span className="text-[10px] leading-tight truncate max-w-full whitespace-nowrap">
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
    </>
  );
}

export default BottomNav;
