'use client';

import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { AnimatePresence, motion, useMotionValueEvent, useScroll } from 'framer-motion';
import {
  Activity,
  ArrowRight,
  Bell,
  Bookmark,
  Briefcase,
  Building2,
  Car,
  Compass,
  Eye,
  Facebook,
  FileText,
  Globe,
  Info,
  Instagram,
  Landmark,
  Linkedin,
  LogIn,
  LogOut,
  Mail,
  Menu,
  MessageCircle,
  MessageSquare,
  Newspaper,
  Palette,
  Phone,
  RotateCcw,
  Search,
  Settings,
  Share2,
  Shield,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Store,
  Truck,
  User,
  Users,
  X,
  Youtube,
} from 'lucide-react';
import { getAreaUnitSymbol } from '@/lib/rules';
import {
  canRoleAccessAdmin,
  useAppStore,
  useAuth,
} from '@/lib/store';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import {
  fetchUserNotifications,
  markAllNotificationsAsRead,
  markNotificationAsRead,
  subscribeToMyNotifications,
  type LiveNotificationRecord,
} from '@/lib/supabase/notifications';
import { NotificationDropdown } from '@/components/shared/NotificationDropdown';
import { BrandLogoStatus } from '@/components/ui/BrandStatusLogo';
import { HubSwitcherPill } from '@/components/hub/HubSwitcherPill';
import { RoleToggleModal } from '@/components/profile/RoleToggleModal';
import { useModalLock } from '@/hooks/useModalLock';
import {
  useLiveNavBadges,
  type LiveNavBadges,
} from '@/lib/hooks/useLiveNavBadges';
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
  | 'pick_n_drop'
  | 'market'
  | 'vehicles'
  | 'bulletin'
  | 'civic'
  | 'saved'
  | 'activity'
  | 'workspace'
  | 'profile';

interface OperationalHatsSummary {
  platform_role: string;
  owned_listings_count: number;
  owned_vehicles_count: number;
  active_staff_assignments: Array<{
    listing_id?: string;
    role_label?: string;
  }>;
  driver_profile: Record<string, unknown> | null;
  managed_hubs: Array<{ hub_id?: string }>;
}

const DESKTOP_PUBLIC_NAV_ITEMS: Array<{
  id: GlobalNavDestination;
  label: string;
  href: string;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  { id: 'explore', label: 'Explore', href: '/explore', icon: Compass },
  { id: 'pick_n_drop', label: 'Pick N Drop', href: '/pick-n-drop', icon: Truck },
  { id: 'market', label: 'Shop & Food', href: '/marketplace', icon: ShoppingBag },
  { id: 'vehicles', label: 'Vehicles', href: '/vehicles', icon: Car },
  { id: 'bulletin', label: 'Bulletin', href: '/bulletin', icon: Newspaper },
];

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
  onLiveBadgesChange?: (badges: LiveNavBadges) => void;
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
  onLiveBadgesChange,
  children,
}: HeaderProps) {
  const router = useRouter();
  const pathname = usePathname() || '/';
  const { savedListingIds, notifications: storeNotifications, markNotificationRead } =
    useAppStore();
  const {
    session: activeSession,
    role: syncedAuthRole,
    realRole: syncedRealRole,
    fullName: syncedFullName,
    avatarUrl: syncedAvatarUrl,
  } = useAuth();
  const [isUnifiedMenuOpen, setIsUnifiedMenuOpen] = useState(false);
  const [isRoleToggleOpen, setIsRoleToggleOpen] = useState(false);
  const [isNotificationsOpen, setIsNotificationsOpen] = useState(false);
  const [operationalHats, setOperationalHats] =
    useState<OperationalHatsSummary | null>(null);
  const hatsCacheUserRef = useRef<string>('');
  const [liveNotifications, setLiveNotifications] = useState<
    LiveNotificationRecord[]
  >([]);
  const [realtimeToast, setRealtimeToast] =
    useState<LiveNotificationRecord | null>(null);
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
  const onLiveBadgesChangeRef = useRef(onLiveBadgesChange);

  // Lock body scroll and signal AssistantWidget when Hamburger Drawer is open
  useModalLock(isUnifiedMenuOpen);

  useEffect(() => {
    onHeaderHeightChangeRef.current = onHeaderHeightChange;
  }, [onHeaderHeightChange]);

  useEffect(() => {
    onHeaderVisibilityChangeRef.current = onHeaderVisibilityChange;
  }, [onHeaderVisibilityChange]);

  useEffect(() => {
    onLiveBadgesChangeRef.current = onLiveBadgesChange;
  }, [onLiveBadgesChange]);

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

  const resolvedRealRole = (syncedRealRole || effectiveRole)
    .toString()
    .toLowerCase();

  const canAccessAdmin =
    isAdmin ||
    effectiveRole === 'super_admin' ||
    resolvedRealRole === 'super_admin' ||
    canRoleAccessAdmin(effectiveRole) ||
    (!authUser &&
      (currentUser.roleType === 'admin' || Boolean(currentUser.adminRole)));

  // Pass R2: Fetch and cache get_user_operational_hats RPC when signed in
  useEffect(() => {
    let active = true;
    if (!activeUserId || !isSupabaseConfigured()) {
      hatsCacheUserRef.current = '';
      Promise.resolve().then(() => {
        if (active) setOperationalHats(null);
      });
      return () => {
        active = false;
      };
    }
    if (hatsCacheUserRef.current === activeUserId) {
      return;
    }
    const loadHats = async () => {
      try {
        const { data, error } = await supabase.rpc(
          'get_user_operational_hats',
          { p_user_id: activeUserId }
        );
        if (!active || error || !data || typeof data !== 'object') {
          return;
        }
        const raw = data as Record<string, unknown>;
        hatsCacheUserRef.current = activeUserId;
        setOperationalHats({
          platform_role: String(raw.platform_role || effectiveRole || 'visitor'),
          owned_listings_count: Number(raw.owned_listings_count ?? 0),
          owned_vehicles_count: Number(raw.owned_vehicles_count ?? 0),
          active_staff_assignments: Array.isArray(raw.active_staff_assignments)
            ? (raw.active_staff_assignments as OperationalHatsSummary['active_staff_assignments'])
            : [],
          driver_profile:
            raw.driver_profile && typeof raw.driver_profile === 'object'
              ? (raw.driver_profile as Record<string, unknown>)
              : null,
          managed_hubs: Array.isArray(raw.managed_hubs)
            ? (raw.managed_hubs as OperationalHatsSummary['managed_hubs'])
            : [],
        });
      } catch {
        // Non-blocking fallback to effectiveRole
      }
    };
    void loadHats();
    return () => {
      active = false;
    };
  }, [activeUserId, effectiveRole]);

  const ownerBusinessCount =
    (operationalHats?.owned_listings_count ?? 0) +
    (operationalHats?.owned_vehicles_count ?? 0);
  const staffAssignmentsCount =
    operationalHats?.active_staff_assignments?.length ?? 0;

  const hasOwnerHat = ownerBusinessCount > 0 || effectiveRole === 'owner';
  const hasStaffHat = staffAssignmentsCount > 0 || effectiveRole === 'staff';
  const hasDriverHat =
    Boolean(operationalHats?.driver_profile) || effectiveRole === 'driver';
  const hasHubManagerHat =
    (operationalHats?.managed_hubs?.length ?? 0) > 0 ||
    effectiveRole === 'hub_manager';
  const hasMasterControlHat =
    operationalHats?.platform_role === 'super_admin' || canAccessAdmin;
  const hasAnyWorkspaceHat =
    hasOwnerHat ||
    hasStaffHat ||
    hasDriverHat ||
    hasHubManagerHat ||
    hasMasterControlHat;

  const liveBadges = useLiveNavBadges({
    userId: activeUserId,
    hasOwnerHat,
    hasStaffHat,
    hasDriverHat,
    hasHubManagerHat,
    hasMasterControlHat,
  });

  useEffect(() => {
    onLiveBadgesChangeRef.current?.(liveBadges);
  }, [liveBadges]);

  // Realtime toast pop when a new notification inserts for the signed-in user
  useEffect(() => {
    if (!activeUserId || !isSupabaseConfigured()) return;
    let dismissTimer: number | null = null;
    const unsubscribe = subscribeToMyNotifications(activeUserId, (incoming) => {
      setLiveNotifications((prev) => {
        if (prev.some((item) => item.id === incoming.id)) return prev;
        return [incoming, ...prev].slice(0, 15);
      });
      setHasLoadedNotifications(true);
      setRealtimeToast(incoming);
      if (dismissTimer !== null) {
        window.clearTimeout(dismissTimer);
      }
      dismissTimer = window.setTimeout(() => {
        setRealtimeToast((cur) => (cur?.id === incoming.id ? null : cur));
      }, 5500);
    });
    return () => {
      if (dismissTimer !== null) {
        window.clearTimeout(dismissTimer);
      }
      unsubscribe();
    };
  }, [activeUserId]);

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
      ? Math.max(
          liveNotifications.filter((n) => n.is_read === false).length,
          liveBadges.unreadNotifications
        )
      : Math.max(unreadNotificationsCount, liveBadges.unreadNotifications);

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

  const handleMarkAllNotificationsRead = () => {
    setLiveNotifications((prev) =>
      prev.map((item) => ({ ...item, is_read: true, read: true }))
    );
    if (isSupabaseConfigured()) {
      void markAllNotificationsAsRead(activeUserId);
    }
  };

  const hasHamburgerIndicator =
    isAuthenticated &&
    (resolvedUnreadNotificationsCount > 0 ||
      liveBadges.workspacePending > 0 ||
      liveBadges.unreadMessages > 0);

  const drawerActivityBadge = Math.max(
    liveBadges.activityTotal,
    resolvedUnreadNotificationsCount
  );

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
        className="relative z-[50] bg-white/95 dark:bg-slate-950/95 w-full backdrop-blur-md shadow-2xs border-b border-[var(--ps-border)]/80"
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

          {/* Center: Desktop / Large Tablet Landscape 5 Public Destinations (>= 1024px) */}
          <nav
            aria-label="Primary application navigation"
            data-testid="desktop-global-nav"
            data-user-role={effectiveRole}
            className="nav-top-responsive items-center gap-1 shrink-0"
          >
            {DESKTOP_PUBLIC_NAV_ITEMS.map((item) => {
              const Icon = item.icon;
              const isActive = (() => {
                if (item.id === 'explore') return pathname.startsWith('/explore');
                if (item.id === 'pick_n_drop')
                  return pathname.startsWith('/pick-n-drop');
                if (item.id === 'market')
                  return pathname.startsWith('/marketplace');
                if (item.id === 'vehicles')
                  return pathname.startsWith('/vehicles');
                if (item.id === 'bulletin')
                  return pathname.startsWith('/bulletin');
                return false;
              })();
              const navBadgeCount = !isAuthenticated
                ? 0
                : item.id === 'pick_n_drop'
                  ? liveBadges.pickNDropActive
                  : item.id === 'market'
                    ? liveBadges.commerceActive
                    : item.id === 'vehicles'
                      ? liveBadges.vehiclesActive
                      : 0;
              const itemClasses = `relative h-8 px-2.5 inline-flex items-center justify-center gap-1.5 rounded-xl text-xs whitespace-nowrap transition-colors ${
                isActive
                  ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] font-bold shadow-2xs'
                  : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] font-medium'
              }`;

              return (
                <Link
                  key={item.id}
                  href={item.href}
                  onClick={(e) => {
                    if (item.id === 'explore' && pathname === '/explore') {
                      e.preventDefault();
                      handleNavItemClick('explore');
                    }
                  }}
                  data-testid={`desktop-nav-${item.id}`}
                  aria-current={isActive ? 'page' : undefined}
                  className={itemClasses}
                >
                  <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                  <span>{item.label}</span>
                  {navBadgeCount > 0 && (
                    <span
                      data-testid={`desktop-nav-badge-${item.id}`}
                      className={`min-w-[16px] h-[16px] px-1 rounded-full text-[10px] font-extrabold leading-none inline-flex items-center justify-center tabular-nums ${
                        isActive
                          ? 'bg-rose-500 text-white'
                          : 'bg-rose-600 text-white'
                      }`}
                    >
                      {navBadgeCount > 99 ? '99+' : navBadgeCount}
                    </span>
                  )}
                </Link>
              );
            })}
          </nav>

          {/* Right: Quick Search, Notifications, Sign-In / Avatar, and Hat-Aware Hamburger Drawer */}
          <div className="relative flex items-center gap-1.5 shrink-0">
            {/* Compact Quick-Search Jump Icon */}
            <Link
              href="/explore"
              title="Quick Search Map & Listings"
              aria-label="Quick search listings and map"
              data-testid="header-quick-search-btn"
              className="w-9 h-9 flex items-center justify-center rounded-xl bg-[var(--ps-bg)] border border-[var(--ps-border)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors shrink-0"
            >
              <Search className="w-4 h-4" aria-hidden="true" />
            </Link>

            {isAuthenticated && (
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
                  className="w-9 h-9 relative flex items-center justify-center rounded-xl bg-[var(--ps-bg)] border border-[var(--ps-border)] text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors cursor-pointer"
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
                    onMarkAllRead={handleMarkAllNotificationsRead}
                    onViewAllActivity={() =>
                      onActivateNavDestination('activity')
                    }
                    onClose={() => setIsNotificationsOpen(false)}
                  />
                )}
              </div>
            )}

            {isAuthenticated ? (
              <Link
                href="/profile"
                title={`Profile (${resolvedUserLabel})`}
                aria-label={`Open profile (${resolvedUserLabel})`}
                data-testid="header-profile-btn"
                className="h-9 px-1.5 sm:px-2 flex items-center justify-center gap-1.5 rounded-full bg-[var(--ps-bg)] border border-[var(--ps-border)] hover:border-[var(--ps-accent)]/60 hover:bg-[var(--ps-surface-alt)] transition-colors shrink-0"
              >
                {resolvedAvatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={resolvedAvatarUrl}
                    alt={resolvedUserLabel}
                    referrerPolicy="no-referrer"
                    className="w-7 h-7 rounded-full object-cover shrink-0"
                  />
                ) : (
                  <div className="flex items-center justify-center w-7 h-7 rounded-full bg-blue-100 text-blue-600 text-xs font-bold uppercase shrink-0">
                    {resolvedUserLabel?.charAt(0) || 'U'}
                  </div>
                )}
                <span className="hidden xl:inline text-xs font-semibold text-[var(--ps-text)] max-w-[96px] truncate pr-1">
                  {resolvedUserLabel}
                </span>
              </Link>
            ) : (
              <button
                type="button"
                onClick={onOpenAuthModal}
                data-testid="header-sign-in-btn"
                className="h-9 px-3.5 flex items-center justify-center gap-1.5 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-bold shadow-2xs hover:opacity-95 transition-opacity whitespace-nowrap shrink-0 cursor-pointer"
              >
                <LogIn className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>Sign In</span>
              </button>
            )}

            {/* Hamburger Drawer Trigger Button */}
            <button
              type="button"
              onClick={() => {
                setIsNotificationsOpen(false);
                setIsUnifiedMenuOpen((prev) => !prev);
              }}
              aria-label="Open navigation and workspace menu"
              aria-haspopup="dialog"
              aria-expanded={isUnifiedMenuOpen}
              data-testid={
                isAuthenticated
                  ? 'header-hamburger-btn'
                  : 'header-guest-menu-btn'
              }
              className="relative w-9 h-9 flex items-center justify-center rounded-xl bg-[var(--ps-bg)] border border-[var(--ps-border)] text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] hover:border-[var(--ps-accent)]/60 transition-colors shrink-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)]"
            >
              <Menu className="w-4 h-4 shrink-0" aria-hidden="true" />
              {hasHamburgerIndicator && (
                <span
                  data-testid="header-hamburger-indicator"
                  className="absolute -top-0.5 -right-0.5 flex h-2.5 w-2.5"
                >
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-rose-500 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-rose-600 ring-2 ring-[var(--ps-surface)]" />
                </span>
              )}
            </button>
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

      {/* Pass V2: Slide-Out Hat-Aware Hamburger Drawer (z-[80], full-screen backdrop covering page, BottomNav & Explore sheet) */}
      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {isUnifiedMenuOpen && (
              <div
                className="fixed inset-0 z-[80] flex justify-end"
                role="dialog"
                aria-modal="true"
                aria-label="Navigation and workspace drawer"
                data-testid="header-workspace-dropdown-menu"
              >
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.18 }}
                  onClick={() => setIsUnifiedMenuOpen(false)}
                  className="fixed inset-0 bg-black/55 backdrop-blur-xs"
                />
                <motion.aside
                  ref={unifiedMenuRef}
                  initial={{ x: '100%' }}
                  animate={{ x: 0 }}
                  exit={{ x: '100%' }}
                  transition={{ type: 'spring', stiffness: 360, damping: 36 }}
                  className="relative z-10 w-[86vw] max-w-[340px] h-full bg-[var(--ps-surface)] border-l border-[var(--ps-border)] shadow-2xl flex flex-col overflow-hidden text-xs"
                >
                  {/* Drawer Header */}
                  <div className="px-4 py-3 border-b border-[var(--ps-border)] flex items-center justify-between gap-2 shrink-0">
                    <span className="text-xs font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                      Menu &amp; Workspaces
                    </span>
                    <button
                      type="button"
                      onClick={() => setIsUnifiedMenuOpen(false)}
                      aria-label="Close menu drawer"
                      className="w-8 h-8 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] flex items-center justify-center text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  {/* Scrollable Drawer Body */}
                  <div className="flex-1 overflow-y-auto p-3 space-y-4">
                    {/* SECTION 1: Identity & Hub Banner */}
                    <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 space-y-2.5">
                      {isAuthenticated ? (
                        <div className="flex items-center gap-3">
                          {resolvedAvatarUrl ? (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={resolvedAvatarUrl}
                              alt={resolvedUserLabel}
                              referrerPolicy="no-referrer"
                              className="w-10 h-10 rounded-full object-cover shrink-0"
                            />
                          ) : (
                            <div className="flex items-center justify-center w-10 h-10 rounded-full bg-blue-100 text-blue-600 text-sm font-bold uppercase shrink-0">
                              {resolvedUserLabel?.charAt(0) || 'U'}
                            </div>
                          )}
                          <div className="min-w-0 flex-1">
                            <div className="font-bold text-sm text-[var(--ps-text)] truncate">
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
                      ) : (
                        <div className="flex items-center justify-between gap-2">
                          <div>
                            <div className="font-bold text-sm text-[var(--ps-text)]">
                              Welcome to DD oodle
                            </div>
                            <div className="text-[11px] text-[var(--ps-text-muted)]">
                              Sign in to track orders, save places &amp; manage listings.
                            </div>
                          </div>
                          <button
                            type="button"
                            onClick={() => {
                              setIsUnifiedMenuOpen(false);
                              onOpenAuthModal();
                            }}
                            className="h-8 px-3 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-bold shrink-0 cursor-pointer"
                          >
                            Sign In
                          </button>
                        </div>
                      )}

                      <div className="pt-2 border-t border-[var(--ps-border)]/70">
                        <HubSwitcherPill
                          variant="drawer"
                          onActionComplete={() => setIsUnifiedMenuOpen(false)}
                          className="w-full"
                        />
                      </div>

                      {isAuthenticated &&
                        (resolvedRealRole === 'super_admin' ||
                          canAccessAdmin) && (
                          <button
                            type="button"
                            data-testid="drawer-switch-view-role-btn"
                            onClick={() => {
                              setIsUnifiedMenuOpen(false);
                              setIsRoleToggleOpen(true);
                            }}
                            className="w-full h-8 px-3 rounded-xl border border-purple-500/35 bg-purple-500/10 text-purple-700 dark:text-purple-300 font-semibold inline-flex items-center justify-center gap-1.5 hover:bg-purple-500/15 transition-colors cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>Switch View Role</span>
                          </button>
                        )}
                    </section>

                    {/* SECTION 2: My Account & Activity (Signed-in only) */}
                    {isAuthenticated && (
                      <section className="space-y-1">
                        <div className="px-2 text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                          My Account &amp; Activity
                        </div>
                        <Link
                          href="/activity"
                          data-testid="header-dropdown-activities"
                          onClick={() => setIsUnifiedMenuOpen(false)}
                          className="w-full px-3 py-2 rounded-xl font-semibold flex items-center justify-between gap-2 text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors"
                        >
                          <span className="inline-flex items-center gap-2.5">
                            <Activity className="w-4 h-4 text-emerald-500 shrink-0" />
                            <span>My Activity &amp; Ledger</span>
                          </span>
                          {drawerActivityBadge > 0 && (
                            <span className="min-w-[18px] h-[18px] px-1.5 rounded-full bg-rose-600 text-white text-[10px] font-bold inline-flex items-center justify-center tabular-nums">
                              {drawerActivityBadge > 99 ? '99+' : drawerActivityBadge}
                            </span>
                          )}
                        </Link>
                        <Link
                          href="/saved"
                          data-testid="header-dropdown-bookmarks"
                          onClick={() => setIsUnifiedMenuOpen(false)}
                          className="w-full px-3 py-2 rounded-xl font-semibold flex items-center justify-between gap-2 text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors"
                        >
                          <span className="inline-flex items-center gap-2.5">
                            <Bookmark className="w-4 h-4 text-amber-500 shrink-0" />
                            <span>Saved &amp; Bookmarks</span>
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
                          href="/messages"
                          data-testid="header-dropdown-messages"
                          onClick={() => setIsUnifiedMenuOpen(false)}
                          className="w-full px-3 py-2 rounded-xl font-semibold flex items-center justify-between gap-2 text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors"
                        >
                          <span className="inline-flex items-center gap-2.5">
                            <MessageSquare className="w-4 h-4 text-[var(--ps-accent)] shrink-0" />
                            <span>Messages</span>
                          </span>
                          {liveBadges.unreadMessages > 0 && (
                            <span className="min-w-[18px] h-[18px] px-1.5 rounded-full bg-rose-600 text-white text-[10px] font-bold inline-flex items-center justify-center tabular-nums">
                              {liveBadges.unreadMessages > 99
                                ? '99+'
                                : liveBadges.unreadMessages}
                            </span>
                          )}
                        </Link>
                        <Link
                          href="/profile"
                          data-testid="header-dropdown-user-profile"
                          onClick={() => setIsUnifiedMenuOpen(false)}
                          className="w-full px-3 py-2 rounded-xl font-semibold flex items-center gap-2.5 text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors"
                        >
                          <User className="w-4 h-4 text-sky-500 shrink-0" />
                          <span>My Profile</span>
                        </Link>
                      </section>
                    )}

                    {/* SECTION 3: My Workspaces (Strictly Role/Hat-Gated) */}
                    {isAuthenticated && (
                      <section className="space-y-1 pt-2 border-t border-[var(--ps-border)]">
                        <div className="px-2 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                          <span>My Workspaces</span>
                          {liveBadges.workspacePending > 0 && (
                            <span className="rounded-full bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 px-1.5 py-0.5 text-[9px] font-extrabold tabular-nums">
                              {liveBadges.workspacePending} pending
                            </span>
                          )}
                        </div>

                        {hasAnyWorkspaceHat ? (
                          <>
                            {hasOwnerHat && (
                              <Link
                                href="/workspace?hat=owner"
                                data-testid="header-dropdown-my-workspace"
                                onClick={() => setIsUnifiedMenuOpen(false)}
                                className="w-full px-3 py-2 rounded-xl font-semibold flex items-center justify-between gap-2 text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors"
                              >
                                <span className="inline-flex items-center gap-2.5">
                                  <Store className="w-4 h-4 text-emerald-500 shrink-0" />
                                  <span>
                                    My Businesses
                                    {ownerBusinessCount > 0
                                      ? ` (${ownerBusinessCount})`
                                      : ''}
                                  </span>
                                </span>
                                <span className="inline-flex items-center gap-1.5 shrink-0">
                                  {liveBadges.workspaceHatCounts.owner > 0 && (
                                    <span className="min-w-[18px] h-[18px] px-1.5 rounded-full bg-rose-600 text-white text-[10px] font-bold inline-flex items-center justify-center tabular-nums">
                                      {liveBadges.workspaceHatCounts.owner}
                                    </span>
                                  )}
                                  <ArrowRight className="w-3.5 h-3.5 text-[var(--ps-text-muted)]" />
                                </span>
                              </Link>
                            )}

                            {hasStaffHat && (
                              <Link
                                href="/workspace?hat=staff"
                                data-testid="header-dropdown-staff-workspace"
                                onClick={() => setIsUnifiedMenuOpen(false)}
                                className="w-full px-3 py-2 rounded-xl font-semibold flex items-center justify-between gap-2 text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors"
                              >
                                <span className="inline-flex items-center gap-2.5">
                                  <Users className="w-4 h-4 text-sky-500 shrink-0" />
                                  <span>
                                    Staff Operations Desk
                                    {staffAssignmentsCount > 0
                                      ? ` (${staffAssignmentsCount})`
                                      : ''}
                                  </span>
                                </span>
                                <span className="inline-flex items-center gap-1.5 shrink-0">
                                  {liveBadges.workspaceHatCounts.staff > 0 && (
                                    <span className="min-w-[18px] h-[18px] px-1.5 rounded-full bg-rose-600 text-white text-[10px] font-bold inline-flex items-center justify-center tabular-nums">
                                      {liveBadges.workspaceHatCounts.staff}
                                    </span>
                                  )}
                                  <ArrowRight className="w-3.5 h-3.5 text-[var(--ps-text-muted)]" />
                                </span>
                              </Link>
                            )}

                            {hasDriverHat && (
                              <Link
                                href="/workspace?hat=driver"
                                data-testid="header-dropdown-driver-workspace"
                                onClick={() => setIsUnifiedMenuOpen(false)}
                                className="w-full px-3 py-2 rounded-xl font-semibold flex items-center justify-between gap-2 text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors"
                              >
                                <span className="inline-flex items-center gap-2.5">
                                  <Truck className="w-4 h-4 text-amber-500 shrink-0" />
                                  <span>Driver Dispatch Console</span>
                                </span>
                                <span className="inline-flex items-center gap-1.5 shrink-0">
                                  {liveBadges.workspaceHatCounts.driver > 0 && (
                                    <span className="min-w-[18px] h-[18px] px-1.5 rounded-full bg-rose-600 text-white text-[10px] font-bold inline-flex items-center justify-center tabular-nums">
                                      {liveBadges.workspaceHatCounts.driver}
                                    </span>
                                  )}
                                  <ArrowRight className="w-3.5 h-3.5 text-[var(--ps-text-muted)]" />
                                </span>
                              </Link>
                            )}

                            {hasHubManagerHat && (
                              <Link
                                href="/workspace?hat=hub_manager"
                                data-testid="header-dropdown-hub-manager"
                                onClick={() => setIsUnifiedMenuOpen(false)}
                                className="w-full px-3 py-2 rounded-xl font-semibold flex items-center justify-between gap-2 text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors"
                              >
                                <span className="inline-flex items-center gap-2.5">
                                  <Building2 className="w-4 h-4 text-indigo-500 shrink-0" />
                                  <span>Hub Manager Console</span>
                                </span>
                                <span className="inline-flex items-center gap-1.5 shrink-0">
                                  {liveBadges.workspaceHatCounts.hubManager > 0 && (
                                    <span className="min-w-[18px] h-[18px] px-1.5 rounded-full bg-rose-600 text-white text-[10px] font-bold inline-flex items-center justify-center tabular-nums">
                                      {liveBadges.workspaceHatCounts.hubManager}
                                    </span>
                                  )}
                                  <ArrowRight className="w-3.5 h-3.5 text-[var(--ps-text-muted)]" />
                                </span>
                              </Link>
                            )}

                            {hasMasterControlHat && (
                              <Link
                                href="/workspace?hat=master_control"
                                data-testid="header-dropdown-admin-dashboard"
                                onClick={() => setIsUnifiedMenuOpen(false)}
                                className="w-full px-3 py-2 rounded-xl font-semibold flex items-center justify-between gap-2 text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors"
                              >
                                <span className="inline-flex items-center gap-2.5">
                                  <Shield className="w-4 h-4 text-purple-500 shrink-0" />
                                  <span>Master Control Console</span>
                                </span>
                                <span className="inline-flex items-center gap-1.5 shrink-0">
                                  {liveBadges.workspaceHatCounts.masterControl >
                                    0 && (
                                    <span className="min-w-[18px] h-[18px] px-1.5 rounded-full bg-rose-600 text-white text-[10px] font-bold inline-flex items-center justify-center tabular-nums">
                                      {
                                        liveBadges.workspaceHatCounts
                                          .masterControl
                                      }
                                    </span>
                                  )}
                                  <ArrowRight className="w-3.5 h-3.5 text-[var(--ps-text-muted)]" />
                                </span>
                              </Link>
                            )}
                          </>
                        ) : (
                          <Link
                            href="/onboarding"
                            data-testid="drawer-become-partner-link"
                            onClick={() => setIsUnifiedMenuOpen(false)}
                            className="w-full px-3 py-2.5 rounded-xl border border-[var(--ps-accent)]/35 bg-[var(--ps-accent)]/10 text-[var(--ps-accent)] font-bold flex items-center justify-between gap-2 hover:bg-[var(--ps-accent)]/15 transition-colors"
                          >
                            <span className="inline-flex items-center gap-2">
                              <Sparkles className="w-4 h-4 shrink-0" />
                              <span>List Your Business / Become a Partner</span>
                            </span>
                            <ArrowRight className="w-3.5 h-3.5 shrink-0" />
                          </Link>
                        )}
                      </section>
                    )}

                    {/* SECTION 4: Quick Directories & Utilities (Everyone) */}
                    <section className="space-y-1 pt-2 border-t border-[var(--ps-border)]">
                      <div className="px-2 text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                        Quick Directories &amp; Utilities
                      </div>

                      <Link
                        href="/civic"
                        data-testid="drawer-civic-helplines-link"
                        onClick={() => setIsUnifiedMenuOpen(false)}
                        className="w-full px-3 py-2 rounded-xl font-semibold flex items-center gap-2.5 text-rose-700 dark:text-rose-300 bg-rose-500/8 hover:bg-rose-500/15 transition-colors"
                      >
                        <Phone className="w-4 h-4 shrink-0" />
                        <span>Emergency &amp; Public Helplines</span>
                      </Link>

                      <Link
                        href="/vehicles"
                        onClick={() => setIsUnifiedMenuOpen(false)}
                        className="w-full px-3 py-2 rounded-xl font-semibold flex items-center gap-2.5 text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors lg:hidden"
                      >
                        <Car className="w-4 h-4 text-indigo-500 shrink-0" />
                        <span>Vehicles &amp; Inter-Hub Rides</span>
                      </Link>

                      <Link
                        href="/bulletin"
                        onClick={() => setIsUnifiedMenuOpen(false)}
                        className="w-full px-3 py-2 rounded-xl font-semibold flex items-center gap-2.5 text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors lg:hidden"
                      >
                        <Newspaper className="w-4 h-4 text-sky-500 shrink-0" />
                        <span>Community Bulletin</span>
                      </Link>

                      <button
                        type="button"
                        data-testid="drawer-theme-display-btn"
                        onClick={() => {
                          setIsUnifiedMenuOpen(false);
                          onOpenThemeModal();
                        }}
                        className="w-full px-3 py-2 rounded-xl text-left font-semibold flex items-center gap-2.5 text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors cursor-pointer"
                      >
                        <Palette className="w-4 h-4 text-[var(--ps-accent)] shrink-0" />
                        <span>Theme &amp; Display</span>
                      </button>

                      <Link
                        href="/settings"
                        data-testid="header-dropdown-account-settings"
                        onClick={() => setIsUnifiedMenuOpen(false)}
                        className="w-full px-3 py-2 rounded-xl font-semibold flex items-center justify-between gap-2 text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors"
                      >
                        <span className="inline-flex items-center gap-2.5">
                          <Settings className="w-4 h-4 text-amber-500 shrink-0" />
                          <span>Settings &amp; Privacy</span>
                        </span>
                        <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-[var(--ps-surface-alt)] border border-[var(--ps-border)]">
                          {getAreaUnitSymbol(areaUnit)}
                        </span>
                      </Link>

                      <div className="pt-1 flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 text-[11px] font-medium text-[var(--ps-text-muted)]">
                        <Link
                          href="/about"
                          onClick={() => setIsUnifiedMenuOpen(false)}
                          className="inline-flex items-center gap-1 hover:text-[var(--ps-accent)]"
                        >
                          <Info className="w-3 h-3" />
                          <span>About</span>
                        </Link>
                        <Link
                          href="/contact"
                          onClick={() => setIsUnifiedMenuOpen(false)}
                          className="inline-flex items-center gap-1 hover:text-[var(--ps-accent)]"
                        >
                          <Mail className="w-3 h-3" />
                          <span>Contact</span>
                        </Link>
                        <Link
                          href="/legal/terms"
                          onClick={() => setIsUnifiedMenuOpen(false)}
                          className="inline-flex items-center gap-1 hover:text-[var(--ps-accent)]"
                        >
                          <FileText className="w-3 h-3" />
                          <span>Terms</span>
                        </Link>
                        <Link
                          href="/legal/privacy"
                          onClick={() => setIsUnifiedMenuOpen(false)}
                          className="inline-flex items-center gap-1 hover:text-[var(--ps-accent)]"
                        >
                          <ShieldCheck className="w-3 h-3" />
                          <span>Privacy</span>
                        </Link>
                        <Link
                          href="/legal/refund-policy"
                          onClick={() => setIsUnifiedMenuOpen(false)}
                          className="inline-flex items-center gap-1 hover:text-[var(--ps-accent)]"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>Refunds</span>
                        </Link>
                      </div>
                    </section>
                  </div>

                  {/* Drawer Footer: Sign In / Sign Out */}
                  <div className="p-3 border-t border-[var(--ps-border)] shrink-0">
                    {isAuthenticated ? (
                      <button
                        type="button"
                        data-testid="header-sign-out-btn"
                        onClick={() => {
                          setIsUnifiedMenuOpen(false);
                          onSignOut();
                        }}
                        className="w-full h-9 px-3 rounded-xl font-semibold flex items-center justify-center gap-2 text-rose-600 dark:text-rose-400 bg-rose-500/10 hover:bg-rose-500/15 transition-colors cursor-pointer"
                      >
                        <LogOut className="w-4 h-4 shrink-0" aria-hidden="true" />
                        <span>Sign Out</span>
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => {
                          setIsUnifiedMenuOpen(false);
                          onOpenAuthModal();
                        }}
                        className="w-full h-9 px-3 rounded-xl font-bold flex items-center justify-center gap-2 bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] hover:opacity-95 transition-opacity cursor-pointer"
                      >
                        <LogIn className="w-4 h-4 shrink-0" aria-hidden="true" />
                        <span>Sign In / Sign Up</span>
                      </button>
                    )}
                  </div>
                </motion.aside>
              </div>
            )}
          </AnimatePresence>,
          document.body
        )}

      {/* Pass V2: Realtime Incoming Notification Toast (z-[100]) */}
      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {realtimeToast && (
              <motion.div
                key={realtimeToast.id}
                initial={{ opacity: 0, y: -16, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -12, scale: 0.96 }}
                transition={{ duration: 0.2 }}
                role="status"
                data-testid="realtime-notification-toast"
                className="fixed top-[calc(var(--app-header-height,56px)+10px)] right-3 left-3 sm:left-auto sm:w-88 z-[100] rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)]/98 backdrop-blur-md shadow-2xl p-3 flex items-start gap-2.5"
              >
                <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-theme-primary text-theme-primary-foreground">
                  <Bell className="h-4 w-4" />
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const targetUrl = realtimeToast.action_url;
                    handleMarkDropdownNotificationRead(realtimeToast.id);
                    setRealtimeToast(null);
                    if (targetUrl && targetUrl.startsWith('/')) {
                      router.push(targetUrl);
                    }
                  }}
                  className="min-w-0 flex-1 text-left cursor-pointer"
                >
                  <p className="text-xs font-bold text-[var(--ps-text)] truncate">
                    {realtimeToast.title}
                  </p>
                  <p className="text-[11px] text-[var(--ps-text-muted)] line-clamp-2 mt-0.5">
                    {realtimeToast.message}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => setRealtimeToast(null)}
                  aria-label="Dismiss notification toast"
                  className="p-1 rounded-lg text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] shrink-0 cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}

      {/* Super-Admin Role Toggle Modal */}
      {isRoleToggleOpen && (
        <RoleToggleModal
          open={isRoleToggleOpen}
          onClose={() => setIsRoleToggleOpen(false)}
          currentViewAsRole={
            effectiveRole === resolvedRealRole ? 'actual' : effectiveRole
          }
          realRole={resolvedRealRole}
        />
      )}
    </>
  );
}

export default Header;
