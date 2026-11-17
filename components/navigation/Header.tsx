'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion, useMotionValueEvent, useScroll } from 'framer-motion';
import {
  Bell,
  Building2,
  ChevronDown,
  Compass,
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
  const { savedListingIds } = useAppStore();
  const {
    session: activeSession,
    role: syncedAuthRole,
    fullName: syncedFullName,
  } = useAuth();
  const [isUnifiedMenuOpen, setIsUnifiedMenuOpen] = useState(false);
  const [isHidden, setIsHidden] = useState(false);
  const unifiedMenuRef = useRef<HTMLDivElement | null>(null);
  const lastScrollYRef = useRef<number>(0);

  // Phase 39: Read active user session for conditional authenticated vs guest header controls
  const isAuthenticated = Boolean(authUser || activeSession?.user);

  const handleNavItemClick = (id: GlobalNavDestination) => {
    if (id === 'profile') {
      if (isAuthenticated) {
        router.push('/profile');
      } else {
        onOpenAuthModal();
      }
      return;
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

  const savedCount = Array.isArray(savedListingIds)
    ? savedListingIds.length
    : 0;

  const effectiveRole = (
    authUser
      ? syncedAuthRole
      : currentUser.adminRole || currentUser.roleType || 'visitor'
  )
    .toString()
    .toLowerCase();

  const canAccessWorkspace =
    canRoleAccessWorkspace(effectiveRole) ||
    (!authUser &&
      (currentUser.roleType === 'owner' ||
        currentUser.roleType === 'staff' ||
        currentUser.roleType === 'admin' ||
        Boolean(currentUser.adminRole)));

  const canAccessAdmin =
    isAdmin ||
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
    if (!isUnifiedMenuOpen) return;

    const handleOutside = (ev: MouseEvent) => {
      if (
        unifiedMenuRef.current &&
        !unifiedMenuRef.current.contains(ev.target as Node)
      ) {
        setIsUnifiedMenuOpen(false);
      }
    };

    const handleKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
        setIsUnifiedMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [isUnifiedMenuOpen]);

  const resolvedUserLabel =
    optimisticName ||
    syncedFullName ||
    authUser?.email ||
    currentUser.name;

  const isExploreUnifiedControlsVisible =
    !isRouteOverlayActive && activeNav === 'explore' && !fullPageListingId;

  return (
    <>
      {/* Phase 39-B: Standalone Minimized Floating PrintSwift Logo (Inverse of Header State) */}
      <motion.div
        data-testid="floating-minimized-logo"
        initial={false}
        animate={{
          opacity: isHeaderVisible ? 0 : 1,
          scale: isHeaderVisible ? 0.8 : 1,
          pointerEvents: isHeaderVisible ? 'none' : 'auto',
        }}
        transition={{ delay: 0.4, duration: 0.5, ease: "easeOut" }}
        className="fixed top-3 left-4 landscape:left-[80px] md:left-[80px] z-[99] lg:hidden"
      >
        <button
          type="button"
          onClick={() => {
            setIsHidden(false);
            onActivateNavDestination('explore');
          }}
          aria-label="PrintSwift Home & Reveal Header"
          className="flex items-center gap-2 p-1.5 sm:px-2.5 sm:py-1.5 rounded-xl bg-[var(--ps-surface)]/95 backdrop-blur-md border border-[var(--ps-border)]/80 shadow-md hover:scale-105 transition-transform"
        >
          <div className="w-6 h-6 rounded-lg bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] flex items-center justify-center font-bold shadow-xs shrink-0">
            <Compass className="w-3.5 h-3.5" />
          </div>
          <span className="hidden sm:inline-block text-xs font-extrabold tracking-tight text-[var(--ps-text)] whitespace-nowrap pr-0.5">
            PrintSwift
          </span>
        </button>
      </motion.div>

      <motion.header
        data-testid="app-brand-header"
        data-unified-header="true"
        data-authenticated={isAuthenticated ? 'true' : 'false'}
        data-search-focused={isSearchFocused ? 'true' : 'false'}
        data-header-visible={isHeaderVisible ? 'true' : 'false'}
        data-mobile-hidden={shouldHideHeaderOnMobile ? 'true' : 'false'}
        initial={{ y: 0 }}
        animate={{ y: !isHeaderVisible ? "-100%" : 0 }}
        transition={{ type: 'spring', bounce: 0, duration: 0.4 }}
        className="fixed lg:sticky top-0 lg:!transform-none w-full inset-x-0 z-[100] bg-[var(--ps-surface)]/95 backdrop-blur-md border-b border-[var(--ps-border)]/80 shadow-2xs shrink-0"
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
            <button
              type="button"
              onClick={() => onActivateNavDestination('explore')}
              className="flex items-center gap-1.5 sm:gap-2 text-left group shrink-0"
            >
              <div
                className={`${
                  layoutProfile.isMobileLandscape || isSearchFocused
                    ? 'w-6 h-6 sm:w-8 sm:h-8 rounded-lg sm:rounded-xl'
                    : 'w-7 h-7 sm:w-8 sm:h-8 rounded-lg sm:rounded-xl'
                } bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] flex items-center justify-center font-bold shadow-xs shrink-0 group-hover:scale-105 transition-all`}
              >
                <Compass className="w-3.5 h-3.5 sm:w-4.5 sm:h-4.5" />
              </div>
              <div className="min-w-0">
                <span className="text-xs sm:text-sm font-extrabold tracking-tight text-[var(--ps-text)] block whitespace-nowrap">
                  PrintSwift
                </span>
                {!layoutProfile.isMobileLandscape && (
                  <span className="text-[10px] font-medium text-[var(--ps-text-muted)] hidden sm:block lg:hidden xl:block truncate">
                    Lamka Directory
                  </span>
                )}
              </div>
            </button>
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
              const isActive =
                !isRouteOverlayActive &&
                activeNav === item.id &&
                !fullPageListingId;
              const badgeCount =
                item.id === 'saved' ? savedCount : (item.badge ?? 0);
              const showBadge = badgeCount > 0;
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
                  className={`inline-flex items-center justify-center gap-1.5 min-h-[40px] min-w-[40px] px-2.5 xl:px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
                    isActive
                      ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-2xs'
                      : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                  }`}
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
          <div className="flex items-center gap-1.5 shrink-0">
            {isAuthenticated ? (
              <>
                <button
                  type="button"
                  onClick={() => onActivateNavDestination('activity')}
                  title="Activity & Notifications"
                  aria-label="Open Activity and Notifications"
                  aria-current={
                    !isRouteOverlayActive &&
                    activeNav === 'activity' &&
                    !fullPageListingId
                      ? 'page'
                      : undefined
                  }
                  data-testid="header-activity-btn"
                  className="relative inline-flex items-center justify-center min-h-[40px] min-w-[40px] p-1.5 sm:p-2 rounded-xl bg-[var(--ps-bg)] border border-[var(--ps-border)] text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors"
                >
                  <Bell className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                  {unreadNotificationsCount > 0 && (
                    <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-0.5 rounded-full bg-rose-600 text-white text-[9px] font-bold flex items-center justify-center">
                      {unreadNotificationsCount}
                    </span>
                  )}
                </button>

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
                    {optimisticAvatarUrl?.trim() ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={optimisticAvatarUrl.trim()}
                        alt={resolvedUserLabel}
                        referrerPolicy="no-referrer"
                        className="w-6 h-6 rounded-full object-cover shrink-0"
                      />
                    ) : (
                      <span className="w-6 h-6 rounded-full bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-[10px] font-extrabold flex items-center justify-center shrink-0">
                        {authUser?.email
                          ? authUser.email.slice(0, 2).toUpperCase()
                          : currentUser.avatarLabel}
                      </span>
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
                      className="absolute right-0 top-full mt-1.5 w-68 rounded-2xl bg-[var(--ps-surface)] border border-gray-200 dark:border-gray-800 shadow-xl p-1.5 z-50 space-y-1 text-xs"
                    >
                      {/* Active Account Summary */}
                      <div className="px-3 py-2 border-b border-gray-200 dark:border-gray-800">
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

                      {/* Group 1: Profile & Settings */}
                      <div className="space-y-0.5">
                        <button
                          type="button"
                          role="menuitem"
                          data-testid="header-dropdown-profile-switch"
                          onClick={() => {
                            setIsUnifiedMenuOpen(false);
                            onActivateNavDestination('profile');
                          }}
                          className="w-full px-3 py-2 rounded-xl text-left font-semibold flex items-center justify-between gap-2 text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors"
                        >
                          <span className="inline-flex items-center gap-2.5">
                            <User className="w-4 h-4 text-[var(--ps-accent)] shrink-0" />
                            <span>Profile &amp; Role Switcher</span>
                          </span>
                        </button>

                        <Link
                          href="/profile"
                          role="menuitem"
                          data-testid="header-dropdown-user-profile"
                          onClick={() => setIsUnifiedMenuOpen(false)}
                          className="w-full px-3 py-2 rounded-xl text-left font-semibold flex items-center gap-2.5 text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors"
                        >
                          <User className="w-4 h-4 text-sky-500 shrink-0" />
                          <span>Comprehensive Profile</span>
                        </Link>

                        <button
                          type="button"
                          role="menuitem"
                          data-testid="header-dropdown-account-settings"
                          onClick={() => {
                            setIsUnifiedMenuOpen(false);
                            onOpenAccountSettings();
                          }}
                          className="w-full px-3 py-2 rounded-xl text-left font-semibold flex items-center gap-2.5 text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors"
                        >
                          <Settings className="w-4 h-4 text-amber-500 shrink-0" />
                          <span>Account Settings</span>
                        </button>

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
                        <button
                          type="button"
                          role="menuitem"
                          data-testid="header-dropdown-map-discovery"
                          onClick={() => {
                            setIsUnifiedMenuOpen(false);
                            onActivateNavDestination('explore');
                          }}
                          className="w-full px-3 py-2 rounded-xl text-left font-semibold flex items-center gap-2.5 text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors"
                        >
                          <Compass className="w-4 h-4 text-[var(--ps-accent)] shrink-0" />
                          <span>Map Discovery</span>
                        </button>

                        {canAccessWorkspace && (
                          <button
                            type="button"
                            role="menuitem"
                            data-testid="header-dropdown-my-listings"
                            onClick={() => {
                              setIsUnifiedMenuOpen(false);
                              onOpenOwnerWorkspace();
                            }}
                            className="w-full px-3 py-2 rounded-xl text-left font-semibold flex items-center gap-2.5 text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors"
                          >
                            <Building2 className="w-4 h-4 text-emerald-500 shrink-0" />
                            <span>My Listings (Owner Workspace)</span>
                          </button>
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
                          <span>
                            Sign Out (
                            {authUser?.email ||
                              activeSession?.user?.email ||
                              'Account'}
                            )
                          </span>
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
