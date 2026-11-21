'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { motion, useMotionValueEvent, useScroll } from 'framer-motion';
import {
  Activity,
  Bell,
  Bookmark,
  Briefcase,
  ChevronDown,
  Facebook,
  FileText,
  Globe,
  Info,
  Instagram,
  Linkedin,
  LogIn,
  LogOut,
  Mail,
  Menu,
  MessageCircle,
  MessageSquare,
  RotateCcw,
  Settings,
  Share2,
  Shield,
  ShieldCheck,
  Truck,
  User,
  Youtube,
} from 'lucide-react';
import { getAreaUnitSymbol } from '@/lib/rules';
import {
  canRoleAccessAdmin,
  canRoleAccessWorkspace,
  useAppStore,
  useAuth,
} from '@/lib/store';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import {
  fetchUserNotifications,
  markNotificationAsRead,
  type LiveNotificationRecord,
} from '@/lib/supabase/notifications';
import { NotificationDropdown } from '@/components/shared/NotificationDropdown';
import { BrandStatusLogo, BrandLogoStatus } from '@/components/ui/BrandStatusLogo';
import { HubSwitcherPill } from '@/components/hub/HubSwitcherPill';
import { AdminRole, AreaUnit, UserRoleType } from '@/lib/types';

export interface OptimisticProfilePayload {
  fullName: string;
  phone: string;
  avatarUrl: string;
  socialLinks: Record<string, string>;
  role?: string;
}

export const OPTIMISTIC_PROFILE_STORAGE_KEY = 'printswift:optimistic-profile';

export function resolveSocialLinkHref(
  platform: string,
  rawValue: string
): string {
  const val = rawValue.trim();
  if (!val) return '#';
  if (val.startsWith('http://') || val.startsWith('https://')) {
    return val;
  }
  const lower = platform.toLowerCase();
  if (lower.includes('whatsapp')) {
    const digits = val.replace(/[^\d]/g, '');
    return digits
      ? `https://wa.me/${digits}`
      : `https://wa.me/${encodeURIComponent(val)}`;
  }
  if (lower.includes('instagram')) {
    const handle = val.replace(/^@/, '');
    return `https://instagram.com/${handle}`;
  }
  if (lower.includes('facebook')) {
    const handle = val.replace(/^@/, '');
    return `https://facebook.com/${handle}`;
  }
  if (lower.includes('twitter') || lower === 'x') {
    const handle = val.replace(/^@/, '');
    return `https://x.com/${handle}`;
  }
  if (lower.includes('linkedin')) {
    return `https://linkedin.com/in/${val.replace(/^@/, '')}`;
  }
  if (lower.includes('youtube')) {
    return `https://youtube.com/${val.startsWith('@') ? val : `@${val}`}`;
  }
  return `https://${val}`;
}

export function SocialPlatformIcon({
  platform,
  className = 'h-4 w-4',
}: {
  platform: string;
  className?: string;
}) {
  const lower = platform.toLowerCase();
  if (lower.includes('whatsapp')) {
    return <MessageCircle className={className} aria-hidden="true" />;
  }
  if (lower.includes('instagram')) {
    return <Instagram className={className} aria-hidden="true" />;
  }
  if (lower.includes('facebook')) {
    return <Facebook className={className} aria-hidden="true" />;
  }
  if (lower.includes('linkedin')) {
    return <Linkedin className={className} aria-hidden="true" />;
  }
  if (lower.includes('youtube')) {
    return <Youtube className={className} aria-hidden="true" />;
  }
  if (lower.includes('twitter') || lower === 'x') {
    return <Share2 className={className} aria-hidden="true" />;
  }
  return <Globe className={className} aria-hidden="true" />;
}

export type GlobalNavDestination =
  | 'home'
  | 'explore'
  | 'market'
  | 'bulletin'
  | 'saved'
  | 'activity'
  | 'workspace'
  | 'profile';

export interface NavItemConfig {
  id: GlobalNavDestination;
  label: string;
  href?: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: number;
}

export interface HeaderProps {
  layoutProfile: {
    isMobileLandscape: boolean;
  };
  headerLocality?: string;
  onSelectHeaderLocality?: (locality: string) => void;
  navItems: NavItemConfig[];
  activeNav: GlobalNavDestination;
  isRouteOverlayActive: boolean;
  fullPageListingId: string | null;
  onActivateNavDestination: (id: GlobalNavDestination) => void;
  onOpenOwnerWorkspace: () => void;
  onOpenAdminWorkspace: () => void;
  onOpenAccountSettings: () => void;
  onOpenThemeModal: () => void;
  onOpenAuthModal: () => void;
  onSignOut: () => void;
  areaUnit: AreaUnit;
  unreadNotificationsCount: number;
  currentUser: {
    id: string;
    name: string;
    email: string;
    roleType: UserRoleType;
    adminRole?: AdminRole;
    avatarLabel: string;
  };
  authUser: {
    id?: string;
    email?: string | null;
    user_metadata?: Record<string, unknown>;
  } | null;
  isAdmin: boolean;
  optimisticName?: string;
  optimisticAvatarUrl?: string;
  isSearchFocused?: boolean;
  mobileScrollDirection?: 'up' | 'down' | null;
  isHeaderVisible?: boolean;
  onHeaderHeightChange?: (height: number) => void;
  onHeaderVisibilityChange?: (visible: boolean) => void;
  children?: React.ReactNode;
}

export function Header({
  layoutProfile,
  navItems,
  activeNav,
  isRouteOverlayActive,
  fullPageListingId,
  onActivateNavDestination,
  onOpenOwnerWorkspace,
  onOpenAdminWorkspace,
  onOpenAccountSettings,
  onOpenThemeModal,
  onOpenAuthModal,
  onSignOut,
  areaUnit,
  unreadNotificationsCount,
  currentUser,
  authUser,
  isAdmin,
  optimisticName,
  optimisticAvatarUrl,
  isSearchFocused = false,
  mobileScrollDirection = null,
  isHeaderVisible: externalIsHeaderVisible,
  onHeaderHeightChange,
  onHeaderVisibilityChange,
  children,
}: HeaderProps) {
  const router = useRouter();
  const pathname = usePathname() || '/';
  const { savedListingIds, notifications: storeNotifications, markNotificationRead } =
    useAppStore();
  const {
    session: activeSession,
    role: syncedAuthRole,
    fullName: syncedFullName,
    avatarUrl: syncedAvatarUrl,
  } = useAuth();
  const [isUnifiedMenuOpen, setIsUnifiedMenuOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [liveNotifications, setLiveNotifications] = useState<
    LiveNotificationRecord[]
  >([]);
  const [hasLoadedNotifications, setHasLoadedNotifications] = useState(false);
  const [isLoadingNotifications, setIsLoadingNotifications] = useState(false);
  const [isHidden, setIsHidden] = useState(false);
  const headerRef = useRef<HTMLElement | null>(null);
  const unifiedMenuRef = useRef<HTMLDivElement | null>(null);
  const notificationDropdownRef = useRef<HTMLDivElement | null>(null);
  const scrollStateByTargetRef = useRef<
    WeakMap<EventTarget, { lastY: number; anchorY: number; dir: 'up' | 'down' | null }>
  >(new WeakMap());
  const onHeaderHeightChangeRef = useRef(onHeaderHeightChange);
  const onHeaderVisibilityChangeRef = useRef(onHeaderVisibilityChange);

  useEffect(() => {
    onHeaderHeightChangeRef.current = onHeaderHeightChange;
  }, [onHeaderHeightChange]);

  useEffect(() => {
    onHeaderVisibilityChangeRef.current = onHeaderVisibilityChange;
  }, [onHeaderVisibilityChange]);

  useEffect(() => {
    const el = headerRef.current;
    if (!el || typeof window === 'undefined') return;

    const reportHeight = () => {
      const nextHeight = Math.round(el.getBoundingClientRect().height);
      if (nextHeight > 0) {
        onHeaderHeightChangeRef.current?.(nextHeight);
      }
    };

    reportHeight();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(reportHeight);
    observer.observe(el);
    return () => {
      observer.disconnect();
    };
  }, []);

  // Phase 39: Read active user session for conditional authenticated vs guest header controls
  const isAuthenticated = Boolean(authUser || activeSession?.user);
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

  const handleNavItemClick = (id: GlobalNavDestination) => {
    if (id === 'home') {
      router.push('/');
      return;
    }
    if (id === 'explore') {
      if (pathname !== '/explore') {
        router.push('/explore');
        return;
      }
      onActivateNavDestination(id);
      return;
    }
    if (id === 'market') {
      router.push('/marketplace');
      return;
    }
    if (id === 'bulletin') {
      router.push('/bulletin');
      return;
    }
    if (id === 'profile') {
      router.push('/profile');
      return;
    }
    if (id === 'saved') {
      router.push('/saved');
      return;
    }
    if (id === 'activity') {
      router.push('/activity');
      return;
    }
    if (id === 'workspace') {
      router.push('/workspace');
      return;
    }
    onActivateNavDestination(id);
  };

  // Phase 57: Desensitized Sticky Header Scroll Physics across ALL orientations (Portrait & Landscape)
  // Listens to BOTH window and #explore-scroll-container (landscape split-view & list feed panels).
  // Hide when scrollTop > 400 && deltaY > 80; reveal immediately on deliberate upward scroll.
  const { scrollY } = useScroll();
  const windowScrollStateRef = useRef<{
    lastY: number;
    anchorY: number;
    dir: 'up' | 'down' | null;
  }>({ lastY: 0, anchorY: 0, dir: null });

  useMotionValueEvent(scrollY, 'change', (currentScrollY) => {
    const state = windowScrollStateRef.current;
    const prevY = state.lastY;
    const delta = currentScrollY - prevY;

    // Ignore micro-scrolls (< 6px) to avoid jitter
    if (Math.abs(delta) < 6) {
      return;
    }

    // Near-top reveal
    if (currentScrollY <= 40) {
      state.lastY = currentScrollY;
      state.anchorY = currentScrollY;
      state.dir = 'up';
      setIsHidden(false);
      onHeaderVisibilityChangeRef.current?.(true);
      return;
    }

    if (currentScrollY < prevY) {
      // Direction flipped to UP: reset accumulator
      if (state.dir !== 'up') {
        state.dir = 'up';
        state.anchorY = prevY;
      }
      // Reveal after >= 56px upward scroll
      if (state.anchorY - currentScrollY >= 56) {
        setIsHidden(false);
        onHeaderVisibilityChangeRef.current?.(true);
        state.anchorY = currentScrollY;
      }
    } else if (currentScrollY > prevY) {
      // Direction flipped to DOWN: reset accumulator
      if (state.dir !== 'down') {
        state.dir = 'down';
        state.anchorY = prevY;
      }
      const deltaDown = currentScrollY - state.anchorY;
      // Hide after >= 72px down and scrollY > 120
      if (currentScrollY > 120 && deltaDown >= 72 && !isUnifiedMenuOpen && !isSearchFocused) {
        setIsHidden(true);
        onHeaderVisibilityChangeRef.current?.(false);
        state.anchorY = currentScrollY;
      }
    }
    state.lastY = currentScrollY;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const evaluateScroll = (target: EventTarget, currentScrollY: number) => {
      const existing = scrollStateByTargetRef.current.get(target) || {
        lastY: currentScrollY,
        anchorY: currentScrollY,
        dir: null,
      };

      const delta = currentScrollY - existing.lastY;
      if (Math.abs(delta) < 6) {
        return;
      }

      if (currentScrollY <= 40) {
        existing.lastY = currentScrollY;
        existing.anchorY = currentScrollY;
        existing.dir = 'up';
        scrollStateByTargetRef.current.set(target, existing);
        setIsHidden(false);
        onHeaderVisibilityChangeRef.current?.(true);
        return;
      }

      if (currentScrollY < existing.lastY) {
        if (existing.dir !== 'up') {
          existing.dir = 'up';
          existing.anchorY = existing.lastY;
        }
        if (existing.anchorY - currentScrollY >= 56) {
          setIsHidden(false);
          onHeaderVisibilityChangeRef.current?.(true);
          existing.anchorY = currentScrollY;
        }
      } else if (currentScrollY > existing.lastY) {
        if (existing.dir !== 'down') {
          existing.dir = 'down';
          existing.anchorY = existing.lastY;
        }
        const deltaDown = currentScrollY - existing.anchorY;
        if (
          currentScrollY > 120 &&
          deltaDown >= 72 &&
          !isUnifiedMenuOpen &&
          !isSearchFocused
        ) {
          setIsHidden(true);
          onHeaderVisibilityChangeRef.current?.(false);
          existing.anchorY = currentScrollY;
        }
      }

      existing.lastY = currentScrollY;
      scrollStateByTargetRef.current.set(target, existing);
    };

    const handleCaptureScroll = (ev: Event) => {
      const target = ev.target as HTMLElement | Document | Window | null;
      if (!target) return;

      if (target === window || target === document) {
        evaluateScroll(window, window.scrollY);
        return;
      }

      if (target instanceof HTMLElement) {
        // Track #explore-scroll-container and primary main/overlay scroll views (ignore tiny dropdown menus)
        const isTrackedContainer =
          target.id === 'explore-scroll-container' ||
          target.dataset.exploreScroll === 'true' ||
          target.tagName === 'MAIN' ||
          target.clientHeight >= 240;
        if (!isTrackedContainer || target.scrollHeight <= target.clientHeight + 60) {
          return;
        }
        evaluateScroll(target, target.scrollTop);
      }
    };

    window.addEventListener('scroll', handleCaptureScroll, {
      capture: true,
      passive: true,
    });
    return () => {
      window.removeEventListener('scroll', handleCaptureScroll, {
        capture: true,
      });
    };
  }, [isUnifiedMenuOpen, isSearchFocused]);

  const isHeaderVisible =
    isUnifiedMenuOpen || isSearchFocused
      ? true
      : typeof externalIsHeaderVisible === 'boolean'
        ? externalIsHeaderVisible
        : mobileScrollDirection === 'down'
          ? false
          : mobileScrollDirection === 'up'
            ? true
            : !isHidden;

  const resolvedHeaderVisible = isHeaderVisible;
  const shouldHideHeaderOnMobile = !isHeaderVisible;

  const savedCount =
    syncedBookmarkCount !== null
      ? syncedBookmarkCount
      : Array.isArray(savedListingIds)
        ? savedListingIds.length
        : 0;

  const effectiveRole = (
    authUser
      ? syncedAuthRole
      : currentUser.adminRole || currentUser.roleType || 'visitor'
  )
    .toString()
    .toLowerCase();

  const isDriverRole = effectiveRole === 'driver';

  const isHamburgerWorkspaceRole =
    effectiveRole === 'owner' ||
    effectiveRole === 'staff' ||
    effectiveRole === 'hub_manager' ||
    effectiveRole === 'admin' ||
    effectiveRole === 'super_admin';

  const canAccessWorkspace =
    isDriverRole ||
    isHamburgerWorkspaceRole ||
    canRoleAccessWorkspace(effectiveRole) ||
    (!authUser &&
      (currentUser.roleType === 'owner' ||
        currentUser.roleType === 'staff' ||
        currentUser.roleType === 'admin' ||
        Boolean(currentUser.adminRole)));

  const canAccessAdmin =
    isAdmin ||
    effectiveRole === 'super_admin' ||
    canRoleAccessAdmin(effectiveRole) ||
    (!authUser &&
      (currentUser.roleType === 'admin' || Boolean(currentUser.adminRole)));

  const visibleNavItems = navItems.filter((item) => {
    if (item.id === 'workspace') {
      return canAccessWorkspace;
    }
    return true;
  });

  useEffect(() => {
    if (!isUnifiedMenuOpen && !isNotificationsOpen) return;

    const handleOutside = (ev: MouseEvent) => {
      if (
        isUnifiedMenuOpen &&
        unifiedMenuRef.current &&
        !unifiedMenuRef.current.contains(ev.target as Node)
      ) {
        setIsUnifiedMenuOpen(false);
      }
      if (
        isNotificationsOpen &&
        notificationDropdownRef.current &&
        !notificationDropdownRef.current.contains(ev.target as Node)
      ) {
        setIsNotificationsOpen(false);
      }
    };

    const handleKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
        setIsUnifiedMenuOpen(false);
        setIsNotificationsOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [isUnifiedMenuOpen, isNotificationsOpen]);

  useEffect(() => {
    let active = true;

    async function loadNotifications() {
      let targetUserId = activeUserId;
      if (!targetUserId && isSupabaseConfigured()) {
        try {
          const {
            data: { session },
          } = await supabase.auth.getSession();
          targetUserId = session?.user?.id || '';
        } catch {
          targetUserId = '';
        }
      }

      if (!targetUserId || !isSupabaseConfigured()) {
        if (active) {
          setLiveNotifications([]);
          setHasLoadedNotifications(false);
          setIsLoadingNotifications(false);
        }
        return;
      }

      setIsLoadingNotifications(true);
      const rows = await fetchUserNotifications(targetUserId);
      if (!active) return;
      setLiveNotifications(rows.slice(0, 10));
      setHasLoadedNotifications(true);
      setIsLoadingNotifications(false);
    }

    void loadNotifications();

    const handleUpdated = () => {
      void loadNotifications();
    };

    if (typeof window !== 'undefined') {
      window.addEventListener(
        'printswift:notifications-updated',
        handleUpdated
      );
    }

    return () => {
      active = false;
      if (typeof window !== 'undefined') {
        window.removeEventListener(
          'printswift:notifications-updated',
          handleUpdated
        );
      }
    };
  }, [activeUserId]);

  const dropdownNotifications: LiveNotificationRecord[] =
    hasLoadedNotifications && isSupabaseConfigured()
      ? liveNotifications
      : storeNotifications.slice(0, 10).map((item) => ({
          ...item,
          user_id: activeUserId || currentUser.id,
          is_read: Boolean(item.read),
          created_at: item.createdAt,
        }));

  const resolvedUnreadNotificationsCount =
    hasLoadedNotifications && isSupabaseConfigured()
      ? liveNotifications.filter((n) => n.is_read === false).length
      : unreadNotificationsCount;

  const handleMarkDropdownNotificationRead = (notificationId: string) => {
    setLiveNotifications((prev) =>
      prev.map((item) =>
        item.id === notificationId
          ? { ...item, is_read: true, read: true }
          : item
      )
    );
    markNotificationRead(notificationId);
    if (isSupabaseConfigured()) {
      void markNotificationAsRead(notificationId);
    }
  };

  const resolvedUserLabel =
    optimisticName ||
    syncedFullName ||
    authUser?.email ||
    currentUser.name;

  const resolvedAvatarUrl =
    optimisticAvatarUrl?.trim() || syncedAvatarUrl?.trim() || '';

  const isExploreUnifiedControlsVisible =
    !isRouteOverlayActive && activeNav === 'explore' && !fullPageListingId;

  return (
    <>
      <motion.header
        ref={headerRef}
        data-testid="app-brand-header"
        data-unified-header="true"
        data-authenticated={isAuthenticated ? 'true' : 'false'}
        data-search-focused={isSearchFocused ? 'true' : 'false'}
        data-header-visible={isHeaderVisible ? 'true' : 'false'}
        data-mobile-hidden={shouldHideHeaderOnMobile ? 'true' : 'false'}
        initial={false}
        animate={{ y: !isHeaderVisible ? '-100%' : '0%' }}
        transition={{ type: 'spring', stiffness: 320, damping: 32 }}
        className={`fixed top-0 left-0 right-0 z-[60] bg-white/95 dark:bg-slate-950/95 w-full inset-x-0 backdrop-blur-md shadow-2xs border-b border-[var(--ps-border)]/80 ${
          !isHeaderVisible ? 'pointer-events-none' : ''
        }`}
      >
      {/* Unified Header Row 1: Top Logo, Desktop Nav, and Conditional Profile/Guest Auth Bar */}
      <div
        className={`${
          isExploreUnifiedControlsVisible
            ? 'border-b border-[var(--ps-border)]/60'
            : ''
        }`}
      >
        <div className="max-w-[1600px] mx-auto flex flex-row flex-nowrap items-center justify-between gap-1.5 sm:gap-2 xl:gap-4 px-2.5 sm:px-3.5 py-1.5">
          {/* Left: PrintSwift Local Identity with Integrated Idle Hub Dropdown */}
          <div className="flex items-center gap-1.5 sm:gap-2 min-w-0 shrink-0">
            <BrandLogoStatus />
          </div>

          {/* Center: Desktop / Large Tablet Landscape Horizontal 4-Tab Navigation (>= 1024px) */}
          <nav
            aria-label="Primary application navigation"
            data-testid="desktop-global-nav"
            data-user-role={effectiveRole}
            className="nav-top-responsive items-center gap-1 shrink-0"
          >
            {visibleNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = (() => {
                if (item.id === 'home') return pathname === '/';
                if (item.id === 'explore') return pathname.startsWith('/explore');
                if (item.id === 'market') return pathname.startsWith('/marketplace');
                if (item.id === 'bulletin') return pathname.startsWith('/bulletin');
                if (item.id === 'saved')
                  return pathname.startsWith('/saved') || pathname.startsWith('/bookmarks');
                if (item.id === 'activity')
                  return pathname.startsWith('/activity') || pathname.startsWith('/activities');
                if (item.id === 'workspace')
                  return pathname.startsWith('/workspace') || pathname.startsWith('/admin');
                if (item.id === 'profile') return pathname.startsWith('/profile');
                return !isRouteOverlayActive && activeNav === item.id && !fullPageListingId;
              })();
              const targetHref =
                item.href ||
                (item.id === 'home'
                  ? '/'
                  : item.id === 'explore'
                    ? '/explore'
                    : item.id === 'market'
                      ? '/marketplace'
                      : item.id === 'bulletin'
                        ? '/bulletin'
                        : item.id === 'saved'
                          ? '/saved'
                          : item.id === 'activity'
                            ? '/activity'
                            : item.id === 'workspace'
                              ? '/workspace'
                              : '/profile');
              const badgeCount =
                item.id === 'saved' ? savedCount : (item.badge ?? 0);
              const showBadge = badgeCount > 0;
              const itemClasses = `h-8 px-2.5 inline-flex items-center justify-center gap-1.5 rounded-xl text-xs transition-colors ${
                isActive
                  ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] font-bold shadow-2xs'
                  : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] font-medium'
              }`;

              return (
                <Link
                  key={item.id}
                  href={targetHref}
                  onClick={(e) => {
                    if (item.id === 'explore' && pathname === '/explore') {
                      e.preventDefault();
                      handleNavItemClick('explore');
                    }
                  }}
                  data-testid={`desktop-nav-${item.id}`}
                  data-saved-count={item.id === 'saved' ? badgeCount : undefined}
                  aria-current={isActive ? 'page' : undefined}
                  className={itemClasses}
                >
                  <span className="relative inline-flex items-center justify-center">
                    <Icon className="w-4 h-4 shrink-0" />
                  </span>
                  <span>{item.label}</span>
                  {showBadge && (
                    <span
                      data-testid={
                        item.id === 'saved'
                          ? 'header-saved-badge'
                          : `header-badge-${item.id}`
                      }
                      className={`min-w-[18px] h-[18px] px-1.5 rounded-full text-[10px] font-bold inline-flex items-center justify-center tabular-nums ${
                        isActive
                          ? 'bg-[var(--ps-accent-fg)]/15 text-[var(--ps-accent-fg)]'
                          : 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                      }`}
                    >
                      {badgeCount}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>

          {/* Right: Phase 39 Conditional Header Auth Controls */}
          <div className="relative flex items-center gap-1.5 shrink-0">
            {isAuthenticated ? (
              <>
                <div
                  ref={notificationDropdownRef}
                  className="sm:relative flex items-center"
                >
                  <button
                    type="button"
                    onClick={() => {
                      setIsUnifiedMenuOpen(false);
                      setIsNotificationsOpen((prev) => !prev);
                    }}
                    title="Activity & Notifications"
                    aria-label="Open Activity and Notifications"
                    aria-expanded={isNotificationsOpen}
                    aria-haspopup="dialog"
                    data-testid="header-activity-btn"
                    className="w-9 h-9 relative flex items-center justify-center rounded-xl bg-[var(--ps-bg)] border border-[var(--ps-border)] text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors"
                  >
                    <Bell className="w-4 h-4" />
                    {resolvedUnreadNotificationsCount > 0 && (
                      <span
                        data-testid="header-unread-badge"
                        className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-0.5 rounded-full bg-rose-600 text-white text-[9px] font-bold flex items-center justify-center"
                      >
                        {resolvedUnreadNotificationsCount}
                      </span>
                    )}
                  </button>

                  {isNotificationsOpen && (
                    <NotificationDropdown
                      notifications={dropdownNotifications}
                      isLoading={isLoadingNotifications}
                      onMarkRead={handleMarkDropdownNotificationRead}
                      onViewAllActivity={() =>
                        onActivateNavDestination('activity')
                      }
                      onClose={() => setIsNotificationsOpen(false)}
                    />
                  )}
                </div>

                {/* Unified User Avatar + Hamburger Menu Grouping Profile, Sign Out, and Settings */}
                <div ref={unifiedMenuRef} className="relative flex items-center">
                  <button
                    type="button"
                    onClick={() => setIsUnifiedMenuOpen((prev) => !prev)}
                    aria-label={`Open Account, Profile, Settings, and Sign Out Menu (${resolvedUserLabel})`}
                    aria-haspopup="menu"
                    aria-expanded={isUnifiedMenuOpen}
                    aria-current={
                      !isRouteOverlayActive &&
                      activeNav === 'profile' &&
                      !fullPageListingId
                        ? 'page'
                        : undefined
                    }
                    title={`Account Menu: Profile, Settings, Workspaces & Sign Out (${resolvedUserLabel})`}
                    data-testid="header-profile-btn"
                    className="h-9 px-2 flex items-center justify-center gap-1.5 rounded-full bg-[var(--ps-bg)] border border-[var(--ps-border)] hover:border-[var(--ps-accent)]/60 hover:bg-[var(--ps-surface-alt)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)]"
                  >
                    {resolvedAvatarUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={resolvedAvatarUrl}
                        alt={resolvedUserLabel}
                        referrerPolicy="no-referrer"
                        className="w-8 h-8 rounded-full object-cover shrink-0"
                      />
                    ) : (
                      <div className="flex items-center justify-center w-8 h-8 rounded-full bg-blue-100 text-blue-600 text-xs font-bold uppercase shrink-0">
                        {resolvedUserLabel?.charAt(0) || 'U'}
                      </div>
                    )}
                    <span className="hidden xl:inline text-xs font-semibold text-[var(--ps-text)] max-w-[100px] truncate">
                      {resolvedUserLabel}
                    </span>
                    <ChevronDown
                      className={`w-[1.2em] h-[1.2em] text-[var(--ps-text-muted)] mr-0.5 transition-transform ${
                        isUnifiedMenuOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>

                  {isUnifiedMenuOpen && (
                    <div
                      role="menu"
                      aria-label="Unified Profile, Settings, Workspaces, and Authentication Menu"
                      data-testid="header-workspace-dropdown-menu"
                      className="absolute right-0 top-full mt-2 z-[70] origin-top-right w-68 rounded-2xl bg-[var(--ps-surface)] border border-gray-200 dark:border-gray-800 shadow-2xl p-1.5 space-y-1 text-xs"
                    >
                      {/* Active Account Summary with w-10 h-10 Avatar */}
                      <div className="flex items-center gap-3 px-3 py-2.5 border-b border-gray-200 dark:border-gray-800">
                        {resolvedAvatarUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={resolvedAvatarUrl}
                            alt="Profile"
                            referrerPolicy="no-referrer"
                            className="w-10 h-10 rounded-full object-cover shrink-0"
                          />
                        ) : (
                          <div className="flex items-center justify-center w-10 h-10 rounded-full bg-blue-100 text-blue-600 text-sm font-bold uppercase shrink-0">
                            {resolvedUserLabel?.charAt(0) || 'U'}
                          </div>
                        )}
                        <div className="min-w-0 flex-1">
                          <div className="font-bold text-[var(--ps-text)] truncate">
                            {resolvedUserLabel}
                          </div>
                          <div
                            data-testid="header-dropdown-role-badge"
                            className="text-[10px] font-semibold uppercase tracking-wider text-[var(--ps-accent)] mt-0.5"
                          >
                            Role: {effectiveRole}
                          </div>
                        </div>
                      </div>

                      {/* Phase 68-A: Service Hub Switcher inside Hamburger Drawer */}
                      <div className="px-2.5 py-2 border-b border-gray-200 dark:border-gray-800">
                        <HubSwitcherPill
                          variant="drawer"
                          onActionComplete={() => setIsUnifiedMenuOpen(false)}
                          className="w-full"
                        />
                      </div>

                      {/* User Section: Profile, Saved, Activity, Workspace (RBAC), Settings */}
                      <div className="space-y-0.5 pt-0.5">
                        <div className="px-3 pt-1 pb-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                          Account
                        </div>

                        <Link
                          href="/profile"
                          role="menuitem"
                          data-testid="header-dropdown-user-profile"
                          onClick={() => setIsUnifiedMenuOpen(false)}
                          className="w-full px-3 py-2 rounded-xl text-left font-semibold flex items-center gap-2.5 text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors"
                        >
                          <User className="w-4 h-4 text-sky-500 shrink-0" />
                          <span>Profile</span>
                        </Link>

                        <Link
                          href="/saved"
                          role="menuitem"
                          data-testid="header-dropdown-bookmarks"
                          onClick={() => setIsUnifiedMenuOpen(false)}
                          className="w-full px-3 py-2 rounded-xl text-left font-semibold flex items-center justify-between gap-2 text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors"
                        >
                          <span className="inline-flex items-center gap-2.5">
                            <Bookmark className="w-4 h-4 text-amber-500 shrink-0" />
                            <span>Saved</span>
                          </span>
                          {savedCount > 0 && (
                            <span
                              data-testid="header-saved-badge"
                              className="min-w-[18px] h-[18px] px-1.5 rounded-full bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-[10px] font-bold inline-flex items-center justify-center tabular-nums"
                            >
                              {savedCount}
                            </span>
                          )}
                        </Link>

                        <Link
                          href="/activity"
                          role="menuitem"
                          data-testid="header-dropdown-activities"
                          onClick={() => setIsUnifiedMenuOpen(false)}
                          className="w-full px-3 py-2 rounded-xl text-left font-semibold flex items-center justify-between gap-2 text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors"
                        >
                          <span className="inline-flex items-center gap-2.5">
                            <Activity className="w-4 h-4 text-emerald-500 shrink-0" />
                            <span>Activity</span>
                          </span>
                          {resolvedUnreadNotificationsCount > 0 && (
                            <span className="min-w-[18px] h-[18px] px-1.5 rounded-full bg-rose-600 text-white text-[10px] font-bold inline-flex items-center justify-center tabular-nums">
                              {resolvedUnreadNotificationsCount}
                            </span>
                          )}
                        </Link>

                        {isDriverRole && (
                          <Link
                            href="/driver"
                            role="menuitem"
                            data-testid="header-dropdown-driver-workspace"
                            onClick={() => setIsUnifiedMenuOpen(false)}
                            className="w-full px-3 py-2 rounded-xl text-left font-semibold flex items-center gap-2.5 text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors"
                          >
                            <Truck className="w-4 h-4 text-emerald-500 shrink-0" />
                            <span>Driver Workspace</span>
                          </Link>
                        )}

                        {isHamburgerWorkspaceRole && (
                          <Link
                            href="/workspace"
                            role="menuitem"
                            data-testid="header-dropdown-my-workspace"
                            onClick={() => setIsUnifiedMenuOpen(false)}
                            className="w-full px-3 py-2 rounded-xl text-left font-semibold flex items-center gap-2.5 text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors"
                          >
                            <Briefcase className="w-4 h-4 text-emerald-500 shrink-0" />
                            <span>Workspace</span>
                          </Link>
                        )}

                        {canAccessAdmin && (
                          <button
                            type="button"
                            role="menuitem"
                            data-testid="header-dropdown-admin-dashboard"
                            onClick={() => {
                              setIsUnifiedMenuOpen(false);
                              onOpenAdminWorkspace();
                            }}
                            className="w-full px-3 py-2 rounded-xl text-left font-semibold flex items-center gap-2.5 text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors"
                          >
                            <Shield className="w-4 h-4 text-purple-500 shrink-0" />
                            <span>Admin Console</span>
                          </button>
                        )}

                        <Link
                          href="/messages"
                          role="menuitem"
                          data-testid="header-dropdown-messages"
                          onClick={() => setIsUnifiedMenuOpen(false)}
                          className="w-full px-3 py-2 rounded-xl text-left font-semibold flex items-center gap-2.5 text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors"
                        >
                          <MessageSquare className="w-4 h-4 text-[var(--ps-accent)] shrink-0" />
                          <span>Messages</span>
                        </Link>

                        <Link
                          href="/settings"
                          role="menuitem"
                          data-testid="header-dropdown-account-settings"
                          onClick={() => setIsUnifiedMenuOpen(false)}
                          className="w-full px-3 py-2 rounded-xl text-left font-semibold flex items-center justify-between gap-2 text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors"
                        >
                          <span className="inline-flex items-center gap-2.5">
                            <Settings className="w-4 h-4 text-amber-500 shrink-0" />
                            <span>Settings</span>
                          </span>
                          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[var(--ps-surface-alt)] border border-[var(--ps-border)]">
                            {getAreaUnitSymbol(areaUnit)}
                          </span>
                        </Link>
                      </div>

                      {/* Public Section: Always visible */}
                      <div className="pt-1 mt-1 border-t border-gray-200 dark:border-gray-800 space-y-0.5">
                        <div className="px-3 pt-1 pb-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                          Info &amp; Policies
                        </div>
                        <Link
                          href="/about"
                          role="menuitem"
                          data-testid="header-dropdown-about-contact"
                          onClick={() => setIsUnifiedMenuOpen(false)}
                          className="w-full px-3 py-1.5 rounded-xl text-left font-semibold flex items-center gap-2.5 text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors"
                        >
                          <Info className="w-4 h-4 text-[var(--ps-text-muted)] shrink-0" />
                          <span>About Us</span>
                        </Link>
                        <Link
                          href="/contact"
                          role="menuitem"
                          data-testid="header-dropdown-contact"
                          onClick={() => setIsUnifiedMenuOpen(false)}
                          className="w-full px-3 py-1.5 rounded-xl text-left font-semibold flex items-center gap-2.5 text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors"
                        >
                          <Mail className="w-4 h-4 text-[var(--ps-text-muted)] shrink-0" />
                          <span>Contact Us</span>
                        </Link>
                        <div className="px-3 pt-1 pb-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] font-medium text-[var(--ps-text-muted)]">
                          <Link
                            href="/legal/terms"
                            role="menuitem"
                            onClick={() => setIsUnifiedMenuOpen(false)}
                            className="inline-flex items-center gap-1 hover:text-[var(--ps-accent)]"
                          >
                            <FileText className="w-3 h-3" />
                            <span>Terms</span>
                          </Link>
                          <Link
                            href="/legal/privacy"
                            role="menuitem"
                            onClick={() => setIsUnifiedMenuOpen(false)}
                            className="inline-flex items-center gap-1 hover:text-[var(--ps-accent)]"
                          >
                            <ShieldCheck className="w-3 h-3" />
                            <span>Privacy</span>
                          </Link>
                          <Link
                            href="/legal/refund-policy"
                            role="menuitem"
                            onClick={() => setIsUnifiedMenuOpen(false)}
                            className="inline-flex items-center gap-1 hover:text-[var(--ps-accent)]"
                          >
                            <RotateCcw className="w-3 h-3" />
                            <span>Refunds</span>
                          </Link>
                        </div>
                      </div>

                      {/* Authentication: Sign Out */}
                      <div className="pt-1 mt-1 border-t border-gray-200 dark:border-gray-800">
                        <button
                          type="button"
                          role="menuitem"
                          data-testid="header-sign-out-btn"
                          onClick={() => {
                            setIsUnifiedMenuOpen(false);
                            onSignOut();
                          }}
                          className="w-full px-3 py-2 rounded-xl text-left font-semibold flex items-center gap-2.5 text-rose-600 dark:text-rose-400 hover:bg-rose-500/10 transition-colors"
                        >
                          <LogOut
                            className="w-4 h-4 shrink-0"
                            aria-hidden="true"
                          />
                          <span>Sign Out</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                {/* Unauthenticated (Guest): Prominent Sign In Button + Hamburger Drawer (Settings, About & Contact) */}
                <button
                  type="button"
                  onClick={onOpenAuthModal}
                  data-testid="header-sign-in-btn"
                  className="h-9 px-3.5 flex items-center justify-center gap-1.5 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-bold shadow-2xs hover:opacity-95 transition-opacity whitespace-nowrap shrink-0"
                >
                  <LogIn className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>Sign In</span>
                </button>

                <div ref={unifiedMenuRef} className="relative flex items-center">
                  <button
                    type="button"
                    onClick={() => setIsUnifiedMenuOpen((prev) => !prev)}
                    aria-label="Open menu for Settings and About & Contact"
                    aria-haspopup="menu"
                    aria-expanded={isUnifiedMenuOpen}
                    data-testid="header-guest-menu-btn"
                    className="w-9 h-9 flex items-center justify-center rounded-xl bg-[var(--ps-bg)] border border-[var(--ps-border)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)]"
                  >
                    <Menu className="w-4 h-4 shrink-0" aria-hidden="true" />
                  </button>

                  {isUnifiedMenuOpen && (
                    <div
                      role="menu"
                      aria-label="Public utility menu"
                      data-testid="header-guest-dropdown-menu"
                      className="absolute right-0 top-full mt-2 z-[70] origin-top-right w-60 rounded-2xl bg-[var(--ps-surface)] border border-gray-200 dark:border-gray-800 shadow-2xl p-1.5 space-y-0.5 text-xs"
                    >
                      {/* Phase 68-A: Service Hub Switcher inside Guest Drawer */}
                      <div className="px-2 py-1.5 mb-1 border-b border-gray-200 dark:border-gray-800">
                        <HubSwitcherPill
                          variant="drawer"
                          onActionComplete={() => setIsUnifiedMenuOpen(false)}
                          className="w-full"
                        />
                      </div>

                      <div className="px-3 pt-1 pb-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                        Preferences &amp; Info
                      </div>

                      <Link
                        href="/settings"
                        role="menuitem"
                        data-testid="header-ui-settings-btn"
                        onClick={() => setIsUnifiedMenuOpen(false)}
                        className="w-full px-3 py-2 rounded-xl text-left font-semibold flex items-center justify-between gap-2 text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors"
                      >
                        <span className="inline-flex items-center gap-2.5">
                          <Settings className="w-4 h-4 text-amber-500 shrink-0" />
                          <span>Settings</span>
                        </span>
                        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[var(--ps-surface-alt)] border border-[var(--ps-border)]">
                          {getAreaUnitSymbol(areaUnit)}
                        </span>
                      </Link>

                      <Link
                        href="/about"
                        role="menuitem"
                        data-testid="header-dropdown-about-contact"
                        onClick={() => setIsUnifiedMenuOpen(false)}
                        className="w-full px-3 py-1.5 rounded-xl text-left font-semibold flex items-center gap-2.5 text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors"
                      >
                        <Info className="w-4 h-4 text-[var(--ps-text-muted)] shrink-0" />
                        <span>About Us</span>
                      </Link>

                      <Link
                        href="/contact"
                        role="menuitem"
                        data-testid="header-dropdown-contact"
                        onClick={() => setIsUnifiedMenuOpen(false)}
                        className="w-full px-3 py-1.5 rounded-xl text-left font-semibold flex items-center gap-2.5 text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors"
                      >
                        <Mail className="w-4 h-4 text-[var(--ps-text-muted)] shrink-0" />
                        <span>Contact Us</span>
                      </Link>

                      <div className="px-3 pt-1 pb-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[11px] font-medium text-[var(--ps-text-muted)]">
                        <Link
                          href="/legal/terms"
                          role="menuitem"
                          onClick={() => setIsUnifiedMenuOpen(false)}
                          className="inline-flex items-center gap-1 hover:text-[var(--ps-accent)]"
                        >
                          <FileText className="w-3 h-3" />
                          <span>Terms</span>
                        </Link>
                        <Link
                          href="/legal/privacy"
                          role="menuitem"
                          onClick={() => setIsUnifiedMenuOpen(false)}
                          className="inline-flex items-center gap-1 hover:text-[var(--ps-accent)]"
                        >
                          <ShieldCheck className="w-3 h-3" />
                          <span>Privacy</span>
                        </Link>
                        <Link
                          href="/legal/refund-policy"
                          role="menuitem"
                          onClick={() => setIsUnifiedMenuOpen(false)}
                          className="inline-flex items-center gap-1 hover:text-[var(--ps-accent)]"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>Refunds</span>
                        </Link>
                      </div>

                      <div className="pt-1 mt-1 border-t border-gray-200 dark:border-gray-800">
                        <button
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            setIsUnifiedMenuOpen(false);
                            onOpenAuthModal();
                          }}
                          className="w-full px-3 py-2 rounded-xl text-left font-semibold flex items-center gap-2.5 text-[var(--ps-accent)] hover:bg-[var(--ps-surface-alt)] transition-colors"
                        >
                          <LogIn className="w-4 h-4 shrink-0" />
                          <span>Sign In / Sign Up</span>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>
      </div>

      {/* Unified Header Row 2 & 3 Slot: Search Input Row + Category Filter Row portaled from DiscoveryWorkspace */}
      <div
        id="unified-header-discovery-slot"
        data-testid="unified-header-discovery-slot"
        className={isExploreUnifiedControlsVisible ? 'block w-full' : 'hidden'}
      />
      {children}
      </motion.header>
    </>
  );
}

export default Header;
