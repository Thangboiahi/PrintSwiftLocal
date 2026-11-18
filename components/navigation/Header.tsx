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
  Globe,
  Instagram,
  Linkedin,
  LogIn,
  LogOut,
  Menu,
  MessageCircle,
  MessageSquare,
  Palette,
  Settings,
  Share2,
  Shield,
  SlidersHorizontal,
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
import { BrandLogoStatus } from '@/components/ui/BrandLogoStatus';
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
  | 'explore'
  | 'saved'
  | 'activity'
  | 'workspace'
  | 'profile';

export interface NavItemConfig {
  id: GlobalNavDestination;
  label: string;
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
  const unifiedMenuRef = useRef<HTMLDivElement | null>(null);
  const notificationDropdownRef = useRef<HTMLDivElement | null>(null);
  const lastScrollYRef = useRef<number>(0);

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

  // Bugfix Sprint 1: Fluid Motion Header scroll-direction tracking
  const { scrollY } = useScroll();
  const prevWindowScrollYRef = useRef<number>(0);
  useMotionValueEvent(scrollY, 'change', (latest) => {
    const previous = scrollY.getPrevious() ?? prevWindowScrollYRef.current;
    if (latest > previous && latest > 50) {
      setIsHidden(true);
    } else {
      setIsHidden(false);
    }
    prevWindowScrollYRef.current = latest;
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleCaptureScroll = (ev: Event) => {
      const target = ev.target as HTMLElement | Document | null;
      if (!target) return;

      const latest =
        target instanceof Document
          ? window.scrollY
          : typeof (target as HTMLElement).scrollTop === 'number'
            ? (target as HTMLElement).scrollTop
            : 0;

      const previous = lastScrollYRef.current;
      if (latest > previous && latest > 50) {
        if (!isUnifiedMenuOpen) {
          setIsHidden(true);
        }
      } else {
        setIsHidden(false);
      }
      lastScrollYRef.current = latest;
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
  }, [isUnifiedMenuOpen]);

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

  const isHamburgerWorkspaceRole =
    effectiveRole === 'owner' ||
    effectiveRole === 'staff' ||
    effectiveRole === 'super_admin';

  const canAccessWorkspace =
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
        data-testid="app-brand-header"
        data-unified-header="true"
        data-authenticated={isAuthenticated ? 'true' : 'false'}
        data-search-focused={isSearchFocused ? 'true' : 'false'}
        data-header-visible={isHeaderVisible ? 'true' : 'false'}
        data-mobile-hidden={shouldHideHeaderOnMobile ? 'true' : 'false'}
        initial={{ y: 0 }}
        animate={{ y: !isHeaderVisible ? '-100%' : 0 }}
        transition={{ type: 'spring', bounce: 0, duration: 0.4 }}
        className={`sticky top-0 z-[60] bg-white dark:bg-slate-950 w-full inset-x-0 backdrop-blur-md shadow-2xs shrink-0 ${
          !isHeaderVisible
            ? 'h-0 max-h-0 overflow-hidden border-b-0 pointer-events-none'
            : 'border-b border-[var(--ps-border)]/80'
        }`}
      >
      {/* Unified Header Row 1: Top Logo, Desktop Nav, and Conditional Profile/Guest Auth Bar */}
      <div
        className={`px-2.5 sm:px-4 ${
          layoutProfile.isMobileLandscape || isSearchFocused
            ? 'py-1 sm:py-2'
            : 'py-1.5 sm:py-2'
        } ${
          isExploreUnifiedControlsVisible
            ? 'border-b border-[var(--ps-border)]/60'
            : ''
        }`}
      >
        <div className="max-w-[1600px] mx-auto flex flex-row flex-nowrap items-center justify-between gap-1.5 sm:gap-2 xl:gap-4">
          {/* Left: PrintSwift Local Identity */}
          <div className="flex items-center gap-2 min-w-0 shrink-0">
            <BrandLogoStatus />
          </div>

          {/* Center: Desktop Horizontal Navigation (lg+) with RBAC conditional Workspace tab */}
          <nav
            aria-label="Primary application navigation"
            data-testid="desktop-global-nav"
            data-user-role={effectiveRole}
            className="hidden lg:flex items-center gap-1 shrink-0"
          >
            {visibleNavItems.map((item) => {
              const Icon = item.icon;
              const isActive = (() => {
                if (item.id === 'explore') return pathname === '/explore';
                if (item.id === 'saved') return pathname.startsWith('/bookmarks');
                if (item.id === 'activity') return pathname.startsWith('/activities');
                if (item.id === 'workspace') return pathname.startsWith('/workspace') || pathname.startsWith('/admin');
                if (item.id === 'profile') return pathname.startsWith('/profile');
                return !isRouteOverlayActive && activeNav === item.id && !fullPageListingId;
              })();
              const badgeCount =
                item.id === 'saved' ? savedCount : (item.badge ?? 0);
              const showBadge = badgeCount > 0;
              const itemClasses = `inline-flex items-center justify-center gap-1.5 min-h-[40px] min-w-[40px] px-2.5 xl:px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
                isActive
                  ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-blue-600 dark:text-blue-400 font-bold shadow-2xs'
                  : 'text-[var(--ps-text-muted)] text-slate-500 hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] font-medium'
              }`;

              if (item.id === 'profile') {
                return (
                  <Link
                    key={item.id}
                    href="/profile"
                    data-testid={`desktop-nav-${item.id}`}
                    aria-current={isActive ? 'page' : undefined}
                    className={itemClasses}
                  >
                    <span className="relative inline-flex items-center justify-center">
                      <Icon className="w-3.5 h-3.5" />
                    </span>
                    <span>{item.label}</span>
                  </Link>
                );
              }

              if (item.id === 'explore') {
                return (
                  <Link
                    key={item.id}
                    href="/explore"
                    data-testid={`desktop-nav-${item.id}`}
                    aria-current={isActive ? 'page' : undefined}
                    className={itemClasses}
                  >
                    <span className="relative inline-flex items-center justify-center">
                      <Icon className="w-3.5 h-3.5" />
                    </span>
                    <span>{item.label}</span>
                  </Link>
                );
              }

              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleNavItemClick(item.id)}
                  data-testid={`desktop-nav-${item.id}`}
                  data-saved-count={
                    item.id === 'saved' ? badgeCount : undefined
                  }
                  aria-current={isActive ? 'page' : undefined}
                  className={itemClasses}
                >
                  <span className="relative inline-flex items-center justify-center">
                    <Icon className="w-3.5 h-3.5" />
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
                </button>
              );
            })}
            <Link
              href="/about"
              data-testid="desktop-nav-about"
              className="inline-flex items-center justify-center min-h-[40px] min-w-[40px] px-2.5 py-1.5 rounded-xl text-xs font-semibold text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors"
            >
              About
            </Link>
            <Link
              href="/contact"
              data-testid="desktop-nav-contact"
              className="inline-flex items-center justify-center min-h-[40px] min-w-[40px] px-2.5 py-1.5 rounded-xl text-xs font-semibold text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors"
            >
              Contact
            </Link>
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
                    className="relative inline-flex items-center justify-center min-h-[40px] min-w-[40px] p-1.5 sm:p-2 rounded-xl bg-[var(--ps-bg)] border border-[var(--ps-border)] text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors"
                  >
                    <Bell className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
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
                    className="inline-flex items-center gap-1.5 min-h-[40px] px-2 py-1 rounded-full bg-[var(--ps-bg)] border border-[var(--ps-border)] hover:border-[var(--ps-accent)]/60 hover:bg-[var(--ps-surface-alt)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)]"
                  >
                    <Menu
                      data-testid="header-workspace-dropdown-btn"
                      className="w-3.5 h-3.5 text-[var(--ps-text-muted)] ml-0.5 shrink-0"
                    />
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
                      className={`w-3 h-3 text-[var(--ps-text-muted)] mr-0.5 transition-transform ${
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

                      {/* Consolidated User Actions */}
                      <div className="space-y-0.5">
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
                          href="/bookmarks"
                          role="menuitem"
                          data-testid="header-dropdown-bookmarks"
                          onClick={() => setIsUnifiedMenuOpen(false)}
                          className="w-full px-3 py-2 rounded-xl text-left font-semibold flex items-center justify-between gap-2 text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors"
                        >
                          <span className="inline-flex items-center gap-2.5">
                            <Bookmark className="w-4 h-4 text-amber-500 shrink-0" />
                            <span>Saved Bookmarks</span>
                          </span>
                          {savedCount > 0 && (
                            <span className="min-w-[18px] h-[18px] px-1.5 rounded-full bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-[10px] font-bold inline-flex items-center justify-center tabular-nums">
                              {savedCount}
                            </span>
                          )}
                        </Link>

                        <Link
                          href="/activities"
                          role="menuitem"
                          data-testid="header-dropdown-activities"
                          onClick={() => setIsUnifiedMenuOpen(false)}
                          className="w-full px-3 py-2 rounded-xl text-left font-semibold flex items-center justify-between gap-2 text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors"
                        >
                          <span className="inline-flex items-center gap-2.5">
                            <Activity className="w-4 h-4 text-emerald-500 shrink-0" />
                            <span>Recent Activities</span>
                          </span>
                          {resolvedUnreadNotificationsCount > 0 && (
                            <span className="min-w-[18px] h-[18px] px-1.5 rounded-full bg-rose-600 text-white text-[10px] font-bold inline-flex items-center justify-center tabular-nums">
                              {resolvedUnreadNotificationsCount}
                            </span>
                          )}
                        </Link>

                        <Link
                          href="/settings"
                          role="menuitem"
                          data-testid="header-dropdown-account-settings"
                          onClick={() => {
                            setIsUnifiedMenuOpen(false);
                            onOpenAccountSettings();
                          }}
                          className="w-full px-3 py-2 rounded-xl text-left font-semibold flex items-center gap-2.5 text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors"
                        >
                          <Settings className="w-4 h-4 text-amber-500 shrink-0" />
                          <span>Settings</span>
                        </Link>

                        <button
                          type="button"
                          role="menuitem"
                          data-testid="header-theme-units-btn"
                          onClick={() => {
                            setIsUnifiedMenuOpen(false);
                            onOpenThemeModal();
                          }}
                          className="w-full px-3 py-2 rounded-xl text-left font-semibold flex items-center justify-between gap-2 text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors"
                        >
                          <span className="inline-flex items-center gap-2.5">
                            <Palette className="w-4 h-4 text-[var(--ps-accent)] shrink-0" />
                            <span>Theme &amp; Area Units</span>
                          </span>
                          <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[var(--ps-surface-alt)] border border-[var(--ps-border)]">
                            {getAreaUnitSymbol(areaUnit)}
                          </span>
                        </button>
                      </div>

                      {/* Group 2: Workspaces & Navigation (RBAC Conditional) */}
                      <div className="pt-1 mt-1 border-t border-gray-200 dark:border-gray-800 space-y-0.5">
                        {isHamburgerWorkspaceRole && (
                          <Link
                            href={
                              effectiveRole === 'super_admin'
                                ? '/admin'
                                : '/workspace'
                            }
                            role="menuitem"
                            data-testid="header-dropdown-my-workspace"
                            onClick={() => setIsUnifiedMenuOpen(false)}
                            className="w-full px-3 py-2 rounded-xl text-left font-semibold flex items-center gap-2.5 text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors"
                          >
                            {effectiveRole === 'super_admin' ? (
                              <Shield className="w-4 h-4 text-purple-500 shrink-0" />
                            ) : (
                              <Briefcase className="w-4 h-4 text-emerald-500 shrink-0" />
                            )}
                            <span>My Workspace</span>
                          </Link>
                        )}

                        {canAccessAdmin && effectiveRole !== 'super_admin' && (
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
                            <span>Admin Dashboard</span>
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
                          <span>Messaging Center</span>
                        </Link>
                      </div>

                      {/* Group 3: Authentication (Sign Out) */}
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
                {/* Unauthenticated (Guest): Subtle UI Settings Icon + Clear Sign In / Sign Up Button */}
                <button
                  type="button"
                  onClick={onOpenThemeModal}
                  title={`UI Settings — Theme & Area Units (${getAreaUnitSymbol(areaUnit)})`}
                  aria-label="Open UI Settings for Theme and Area Units"
                  data-testid="header-ui-settings-btn"
                  className="inline-flex items-center justify-center min-h-[38px] min-w-[38px] p-2 rounded-xl bg-[var(--ps-bg)] border border-[var(--ps-border)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors shrink-0"
                >
                  <SlidersHorizontal
                    className="w-4 h-4 shrink-0"
                    aria-hidden="true"
                  />
                </button>

                <button
                  type="button"
                  onClick={onOpenAuthModal}
                  data-testid="header-sign-in-btn"
                  className="inline-flex items-center justify-center gap-1.5 min-h-[38px] px-3 sm:px-3.5 py-1.5 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-bold shadow-2xs hover:opacity-95 transition-opacity whitespace-nowrap shrink-0"
                >
                  <LogIn className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>Sign In / Sign Up</span>
                </button>
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
