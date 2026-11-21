'use client';

import React, {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import { APIProvider } from '@vis.gl/react-google-maps';
import {
  Activity,
  AlertTriangle,
  Bell,
  Bookmark,
  Briefcase,
  Building2,
  CheckCircle2,
  Compass,
  Edit3,
  ExternalLink,
  Home,
  MapPin,
  MessageSquare,
  Newspaper,
  Palette,
  RotateCcw,
  Shield,
  Star,
  Store,
  User,
  Users,
  X,
} from 'lucide-react';
import {
  AppProvider,
  setServerViewAsRoleOverride,
  useAppStore,
  useAuth,
} from '@/lib/store';
import { MapsAvailabilityProvider } from '@/lib/maps-context';
import type { MapSettings } from '@/lib/map-settings';
import type { ProfileWithEffectiveRole } from '@/lib/role-override';
import {
  GlobalNavDestination,
  Header,
  OPTIMISTIC_PROFILE_STORAGE_KEY,
  OptimisticProfilePayload,
  SocialPlatformIcon,
  resolveSocialLinkHref,
} from '@/components/navigation/Header';
import { BottomNav } from '@/components/navigation/BottomNav';
import { GlobalAnnouncementBar } from '@/components/ui/GlobalAnnouncementBar';
import { HubWelcomeModal } from '@/components/hub/HubWelcomeModal';
import { DiscoveryWorkspace } from '@/components/discovery/DiscoveryWorkspace';
import { ActivityPanel } from '@/components/discovery/ActivityPanel';
import { CategoryDetailView } from '@/components/listings/CategoryDetailView';
import OwnerStaffWorkspace from '@/components/workspaces/OwnerStaffWorkspace';
import AdminWorkspace from '@/components/workspaces/AdminWorkspace';
import DriverWorkspace from '@/components/workspaces/DriverWorkspace';
import { AuthModal } from '@/components/auth/AuthModal';
import {
  ThemeSettingsModal,
  isTopmostActiveModal,
  useModalFocusManagement,
} from '@/components/shared/ThemeSettingsModal';
import { GlobalErrorBoundary } from '@/components/shared/GlobalErrorBoundary';
import {
  ADMIN_ROLE_DESCRIPTIONS,
  CATEGORY_LABELS,
  getAreaUnitSymbol,
  resolveResponsiveLayoutProfile,
} from '@/lib/rules';
import { Listing } from '@/lib/types';

type WorkspaceSubMode = 'owner' | 'staff' | 'driver' | 'admin';

const AppShellMountedContext = createContext<boolean>(false);

function AppShellInner({
  apiKey,
  children,
}: {
  apiKey: string;
  children?: React.ReactNode;
}) {
  const {
    currentUser,
    users,
    switchUser,
    listings,
    isLoading,
    savedListingIds,
    toggleSavedListing,
    enquiries,
    reviews,
    notifications,
    markNotificationRead,
    drawnShapes,
    areaUnit,
    resetDemoData,
    mapsQuotaExceeded,
  } = useAppStore();

  const pathname = usePathname() || '/';
  const router = useRouter();
  const isRouteOverlayActive = pathname !== '/explore';

  const [activeNav, setActiveNav] = useState<GlobalNavDestination>('explore');
  const [workspaceSubMode, setWorkspaceSubMode] =
    useState<WorkspaceSubMode>('owner');
  const [ownerInitialTab, setOwnerInitialTab] = useState<
    | 'overview'
    | 'listings'
    | 'catalogues'
    | 'enquiries'
    | 'reviews'
    | 'analytics'
    | 'staff'
    | undefined
  >(undefined);
  const [fullPageListingId, setFullPageListingId] = useState<string | null>(
    null
  );
  const [fullPageOriginNav, setFullPageOriginNav] =
    useState<GlobalNavDestination>('explore');
  const [pendingMapFocusRequest, setPendingMapFocusRequest] = useState<{
    listingId: string;
    seq: number;
  } | null>(null);
  const [headerLocality, setHeaderLocality] = useState<string>('all');
  const [isFullscreenMap, setIsFullscreenMap] = useState<boolean>(false);
  const {
    user: authUser,
    session: authSession,
    signOut: handleSignOut,
    avatarUrl: authAvatarUrl,
  } = useAuth();
  const [isThemeModalOpen, setIsThemeModalOpen] = useState(false);
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [optimisticProfile, setOptimisticProfile] =
    useState<Partial<OptimisticProfilePayload> | null>(null);
  const [pendingGeometryDraft, setPendingGeometryDraft] =
    useState<Listing | null>(null);
  const [isMobileSearchFocused, setIsMobileSearchFocused] =
    useState<boolean>(false);
  const [mobileScrollDirection, setMobileScrollDirection] = useState<
    'up' | 'down' | null
  >(null);
  const [headerHeight, setHeaderHeight] = useState<number>(56);
  const isHeaderHidden =
    !isFullscreenMap &&
    mobileScrollDirection === 'down' &&
    !isMobileSearchFocused;

  useEffect(() => {
    if (typeof window === 'undefined') return;
    queueMicrotask(() => {
      try {
        const raw = localStorage.getItem(OPTIMISTIC_PROFILE_STORAGE_KEY);
        if (raw) {
          setOptimisticProfile(
            JSON.parse(raw) as Partial<OptimisticProfilePayload>
          );
        }
      } catch {
        // ignore storage errors
      }
    });
  }, []);

  // Phase 20 & 24: Listen to global deep-link, workspace navigation, and optimistic profile events
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleUnmountOverlays = () => {
      setFullPageListingId(null);
      setActiveNav('explore');
    };

    const handleOpenWorkspaceEnquiries = () => {
      setFullPageListingId(null);
      setOwnerInitialTab('enquiries');
      setWorkspaceSubMode('owner');
      setActiveNav('workspace');
    };

    const handleFocusMapListing = (ev: Event) => {
      const detail = (ev as CustomEvent<{ listingId?: string }>).detail;
      setFullPageListingId(null);
      setActiveNav('explore');
      if (detail?.listingId) {
        setPendingMapFocusRequest({
          listingId: detail.listingId,
          seq: Date.now() + Math.random(),
        });
      }
    };

    const handleNavigateDestination = (ev: Event) => {
      const detail = (
        ev as CustomEvent<{ destination?: 'explore' | 'owner' | 'admin' }>
      ).detail;
      setFullPageListingId(null);
      if (detail?.destination === 'owner') {
        if (currentUser.roleType === 'visitor') {
          switchUser('owner-1');
        }
        setWorkspaceSubMode('owner');
        setActiveNav('workspace');
      } else if (detail?.destination === 'admin') {
        if (currentUser.roleType !== 'admin') {
          switchUser('admin-super');
        }
        setWorkspaceSubMode('admin');
        setActiveNav('workspace');
      } else {
        setActiveNav('explore');
      }
    };

    const handleProfileUpdated = (ev: Event) => {
      const detail = (ev as CustomEvent<OptimisticProfilePayload>).detail;
      if (detail) {
        setOptimisticProfile(detail);
      }
    };

    window.addEventListener('printswift:unmount-overlays', handleUnmountOverlays);
    window.addEventListener(
      'printswift:open-workspace-enquiries',
      handleOpenWorkspaceEnquiries
    );
    window.addEventListener('printswift:focus-map-listing', handleFocusMapListing);
    window.addEventListener(
      'printswift:navigate-destination',
      handleNavigateDestination
    );
    window.addEventListener('printswift:profile-updated', handleProfileUpdated);

    return () => {
      window.removeEventListener(
        'printswift:unmount-overlays',
        handleUnmountOverlays
      );
      window.removeEventListener(
        'printswift:open-workspace-enquiries',
        handleOpenWorkspaceEnquiries
      );
      window.removeEventListener(
        'printswift:focus-map-listing',
        handleFocusMapListing
      );
      window.removeEventListener(
        'printswift:navigate-destination',
        handleNavigateDestination
      );
      window.removeEventListener(
        'printswift:profile-updated',
        handleProfileUpdated
      );
    };
  }, [currentUser.roleType, switchUser]);

  // Step 4C: Track viewport dimensions to resolve responsive layout & navigation posture (Hydration-Safe)
  const [viewportSize, setViewportSize] = useState<{
    width: number;
    height: number;
  }>({
    width: 1440,
    height: 900,
  });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const syncViewport = () => {
      setViewportSize({
        width: window.innerWidth,
        height: window.innerHeight,
      });
    };
    queueMicrotask(syncViewport);
    window.addEventListener('resize', syncViewport);
    window.addEventListener('orientationchange', syncViewport);
    return () => {
      window.removeEventListener('resize', syncViewport);
      window.removeEventListener('orientationchange', syncViewport);
    };
  }, []);

  const layoutProfile = useMemo(
    () =>
      resolveResponsiveLayoutProfile(viewportSize.width, viewportSize.height),
    [viewportSize.width, viewportSize.height]
  );

  const resetModalRef = useRef<HTMLDivElement | null>(null);

  useModalFocusManagement({
    id: 'reset-demo-modal',
    open: isResetModalOpen,
    dialogRef: resetModalRef,
  });

  useEffect(() => {
    if (!isResetModalOpen) return;
    const handleResetModalEscape = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      if (!isTopmostActiveModal('reset-demo-modal')) return;
      ev.preventDefault();
      ev.stopImmediatePropagation();
      setIsResetModalOpen(false);
    };
    document.addEventListener('keydown', handleResetModalEscape);
    return () => {
      document.removeEventListener('keydown', handleResetModalEscape);
    };
  }, [isResetModalOpen]);

  const apiKeyAvailable = Boolean(apiKey && apiKey.trim().length > 5);

  const fullPageListing = useMemo(
    () => listings.find((l) => l.id === fullPageListingId) || null,
    [listings, fullPageListingId]
  );

  const savedListings = useMemo(
    () => listings.filter((l) => savedListingIds.includes(l.id)),
    [listings, savedListingIds]
  );

  const unreadNotificationsCount = useMemo(
    () => notifications.filter((n) => !n.read).length,
    [notifications]
  );

  const handleOpenFullDetailPage = (listingId: string) => {
    if (!fullPageListingId) {
      setFullPageOriginNav(activeNav);
    }
    setFullPageListingId(listingId);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleBackFromFullDetailPage = () => {
    const returnNav = fullPageOriginNav;
    setFullPageListingId(null);
    setActiveNav(returnNav);
  };

  const fullPageBackLabel =
    fullPageOriginNav === 'saved'
      ? 'Back to Saved Listings'
      : fullPageOriginNav === 'workspace'
        ? 'Back to Workspace'
        : fullPageOriginNav === 'activity'
          ? 'Back to Activity'
          : fullPageOriginNav === 'profile'
            ? 'Back to Profile'
            : 'Back to Map Discovery';

  const handleLocateListingOnMap = (listingId?: string) => {
    setFullPageListingId(null);
    setActiveNav('explore');
    if (listingId) {
      setPendingMapFocusRequest({
        listingId,
        seq: Date.now() + Math.random(),
      });
    }
  };

  const handleInitiateListingFromGeometry = (draftListing: Listing) => {
    setFullPageListingId(null);
    setPendingGeometryDraft(draftListing);
    setWorkspaceSubMode(currentUser.roleType === 'staff' ? 'staff' : 'owner');
    setActiveNav('workspace');
  };

  const handleRoleSwitch = (userId: string, openWorkspaceAfter = false) => {
    switchUser(userId);
    const target = users.find((u) => u.id === userId);
    if (!target) return;
    setFullPageListingId(null);
    if (target.roleType === 'owner') {
      setWorkspaceSubMode('owner');
      if (openWorkspaceAfter) setActiveNav('workspace');
    } else if (target.roleType === 'staff') {
      setWorkspaceSubMode('staff');
      if (openWorkspaceAfter) setActiveNav('workspace');
    } else if (target.roleType === 'admin') {
      setWorkspaceSubMode('admin');
      if (openWorkspaceAfter) setActiveNav('workspace');
    } else if (openWorkspaceAfter) {
      setActiveNav('explore');
    }
  };

  const handleSelectWorkspaceSubMode = (mode: WorkspaceSubMode) => {
    setFullPageListingId(null);
    setWorkspaceSubMode(mode);
    setActiveNav('workspace');
    if (mode === 'owner' && currentUser.roleType !== 'owner') {
      switchUser('owner-1');
    } else if (mode === 'staff' && currentUser.roleType !== 'staff') {
      switchUser('staff-1');
    } else if (mode === 'admin' && currentUser.roleType !== 'admin') {
      switchUser('admin-super');
    }
  };

  const handleActivateNavDestination = (id: GlobalNavDestination) => {
    setFullPageListingId(null);
    if (id === 'home') {
      router.push('/');
      return;
    }
    if (id === 'explore') {
      if (pathname !== '/explore') {
        router.push('/explore');
      }
      setActiveNav('explore');
      setMobileScrollDirection('up');
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
    setActiveNav(id);
    setMobileScrollDirection('up');
  };

  const navItems: Array<{
    id: GlobalNavDestination;
    label: string;
    href: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: number;
  }> = [
    { id: 'home', label: 'Home', href: '/', icon: Home },
    { id: 'explore', label: 'Explore', href: '/explore', icon: Compass },
    { id: 'market', label: 'Market', href: '/marketplace', icon: Store },
    { id: 'bulletin', label: 'Bulletin', href: '/bulletin', icon: Newspaper },
  ];

  const isExploreLocked =
    activeNav === 'explore' && !fullPageListing && !isRouteOverlayActive;
  const activeTab =
    fullPageListing || isRouteOverlayActive ? 'overlay' : activeNav;

  return (
    <div
      data-testid="app-shell-root"
      data-layout-profile={layoutProfile.profile}
      style={
        {
          '--header-height': `${isFullscreenMap ? 0 : headerHeight}px`,
          '--header-visible-height': `${isFullscreenMap || isHeaderHidden ? 0 : headerHeight}px`,
        } as React.CSSProperties
      }
      className={`h-dvh overflow-hidden flex flex-col bg-[var(--ps-bg)] text-[var(--ps-text)] ${
        !isFullscreenMap ? 'nav-main-padding-responsive' : ''
      }`}
    >
      {/* Mandatory Google Maps Demo Key Quota Exceeded Banner */}
      {mapsQuotaExceeded && (
        <div
          role="alert"
          className="sticky top-0 z-50 flex flex-wrap items-center justify-between gap-2 bg-amber-500 px-4 py-1.5 text-xs font-semibold text-slate-950 shadow-md"
        >
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              This app uses a shared demo Google Maps API key that has reached its daily quota. To continue using maps, please ask the app creator to switch to their own Google Cloud project key in AI Studio.
            </span>
          </div>
          <a
            href="https://developers.google.com/maps/ai/ai-studio?utm_campaign=gmp_mcp_codeassist_v1_aistudio#quota_exceeded_errors"
            target="_blank"
            rel="noopener noreferrer"
            className="underline font-bold hover:opacity-80 shrink-0"
          >
            Learn more
          </a>
        </div>
      )}


      {/* Phase 64-B: Super-Admin Configurable Global Announcement Strip */}
      {!isFullscreenMap && <GlobalAnnouncementBar />}

      {/* =====================================================================
          SECTION 1: COMPACT BRAND HEADER & DESKTOP 5-DESTINATION NAVIGATION
         ===================================================================== */}
      {!isFullscreenMap && (
        <Header
          layoutProfile={layoutProfile}
          headerLocality={headerLocality}
          onSelectHeaderLocality={(loc) => {
            setHeaderLocality(loc);
            if (pathname !== '/explore') {
              router.push('/explore');
            }
            if (activeNav !== 'explore') {
              setFullPageListingId(null);
              setActiveNav('explore');
            }
          }}
          navItems={navItems}
          activeNav={activeNav}
          isRouteOverlayActive={isRouteOverlayActive}
          fullPageListingId={fullPageListingId}
          onActivateNavDestination={handleActivateNavDestination}
          onOpenOwnerWorkspace={() => {
            router.push('/workspace');
          }}
          onOpenAdminWorkspace={() => {
            router.push('/workspace?hat=master_control');
          }}
          onOpenAccountSettings={() => {
            router.push('/settings');
          }}
          onOpenThemeModal={() => setIsThemeModalOpen(true)}
          onOpenAuthModal={() => setIsAuthModalOpen(true)}
          onSignOut={() => {
            void handleSignOut();
          }}
          areaUnit={areaUnit}
          unreadNotificationsCount={unreadNotificationsCount}
          currentUser={currentUser}
          authUser={authUser || authSession?.user || null}
          isAdmin={
            currentUser.roleType === 'admin' || Boolean(currentUser.adminRole)
          }
          optimisticName={optimisticProfile?.fullName}
          optimisticAvatarUrl={optimisticProfile?.avatarUrl || authAvatarUrl || undefined}
          isSearchFocused={isMobileSearchFocused}
          mobileScrollDirection={mobileScrollDirection}
          isHeaderVisible={!isHeaderHidden}
          onHeaderHeightChange={setHeaderHeight}
          onHeaderVisibilityChange={(visible) => {
            setMobileScrollDirection(visible ? 'up' : 'down');
          }}
        />
      )}

      {/* =====================================================================
          MAIN CONTENT AREA + ADAPTIVE MOBILE LANDSCAPE VERTICAL NAVIGATION RAIL
         ===================================================================== */}
      <div className="flex-1 flex flex-row min-h-0 overflow-hidden">
        {!isFullscreenMap && (
          <motion.div
            initial={false}
            animate={{ paddingTop: isHeaderHidden ? 0 : Math.max(headerHeight, 56) }}
            transition={{ type: 'spring', stiffness: 320, damping: 32 }}
            className="nav-vertical-responsive w-[68px] shrink-0 h-full flex-col"
          >
            <BottomNav
              variant="rail"
              navItems={navItems}
              activeNav={activeNav}
              fullPageListingId={fullPageListingId}
              onActivateNavDestination={handleActivateNavDestination}
              onOpenAuthModal={() => setIsAuthModalOpen(true)}
              optimisticRole={optimisticProfile?.role}
              mobileScrollDirection={mobileScrollDirection}
            />
          </motion.div>
        )}

        <main className="flex-1 relative w-full flex flex-col min-w-0 min-h-0 overflow-hidden">
          {/* Phase 20 & B-18: Persistent Map Container — Remains mounted to preserve map state, strictly hidden via CSS when inactive */}
          <div
            data-testid="explore-session-container"
            aria-hidden={activeTab !== 'explore'}
            className={
              activeTab === 'explore'
                ? 'flex-1 flex flex-col h-full relative min-w-0 min-h-0 overflow-hidden'
                : 'hidden'
            }
          >
            <DiscoveryWorkspace
              apiKeyAvailable={apiKeyAvailable}
              isActiveView={activeTab === 'explore'}
              onOpenFullDetailPage={handleOpenFullDetailPage}
              onFullscreenMapChange={setIsFullscreenMap}
              selectedLocalityOverride={headerLocality}
              onSelectLocalityOverride={setHeaderLocality}
              onInitiateListingFromGeometry={handleInitiateListingFromGeometry}
              layoutProfile={layoutProfile}
              pendingMapFocusRequest={pendingMapFocusRequest}
              onSearchFocusChange={setIsMobileSearchFocused}
              onListScrollDirectionChange={setMobileScrollDirection}
              headerHeight={headerHeight}
              isHeaderHidden={isHeaderHidden}
            />
          </div>

          {/* Phase 20: Route Overlay Wrapper (/profile, /admin, /messages, /user/[id], /listing/[id], etc.) */}
          <AnimatePresence>
            {isRouteOverlayActive && children && (
              <motion.div
                key={`route-overlay-${pathname}`}
                data-testid="appshell-route-overlay"
                initial={{ opacity: 0 }}
                animate={{
                  opacity: 1,
                  paddingTop:
                    isFullscreenMap || isHeaderHidden
                      ? 0
                      : Math.max(headerHeight, 56),
                }}
                exit={{ opacity: 0 }}
                transition={{ type: 'spring', stiffness: 320, damping: 32 }}
                className="absolute inset-0 z-30 flex justify-end bg-[var(--ps-bg)]"
              >
                <div className="h-full w-full overflow-y-auto overflow-x-hidden bg-[var(--ps-bg)]">
                  {children}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Internal AppShell Overlay Views (Full Detail Page, Saved, Activity, Workspace, Profile) */}
          {!isRouteOverlayActive && !isExploreLocked && (
            <motion.div
              data-testid="appshell-internal-overlay"
              initial={false}
              animate={{
                paddingTop: isFullscreenMap || isHeaderHidden ? 0 : headerHeight,
              }}
              transition={{ type: 'spring', stiffness: 320, damping: 32 }}
              className="flex-1 h-full w-full z-30 overflow-y-auto bg-[var(--ps-bg)] flex flex-col"
            >
              {fullPageListing ? (
                <CategoryDetailView
                  listing={fullPageListing}
                  mode="full_page"
                  apiKeyAvailable={apiKeyAvailable}
                  backLabel={fullPageBackLabel}
                  onBackToMap={handleBackFromFullDetailPage}
                  onLocateOnMap={(l) => handleLocateListingOnMap(l.id)}
                  onOpenFullPage={(id) => setFullPageListingId(id)}
                  onSelectRelatedListing={(id) => setFullPageListingId(id)}
                />
              ) : activeNav === 'saved' ? (
                <div
                  data-testid="saved-destination-view"
                  className="max-w-7xl mx-auto w-full px-4 py-6 space-y-5"
                >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ps-border)] pb-4">
                <div>
                  <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[var(--ps-text)]">
                    Saved &amp; Followed Listings ({savedListings.length})
                  </h1>
                  <p className="text-xs text-[var(--ps-text-muted)] mt-1">
                    Bookmarked places across Churachandpur. Locate any listing on the interactive map or open its full detail page.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveNav('explore')}
                  className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-2xs hover:opacity-95 transition-opacity"
                >
                  Back to Explore
                </button>
              </div>

              {savedListings.length === 0 ? (
                <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-10 text-center">
                  <p className="text-sm font-semibold text-[var(--ps-text)]">
                    No saved listings yet.
                  </p>
                  <p className="text-xs text-[var(--ps-text-muted)] mt-1">
                    Tap the Save / Bookmark icon on any listing card or map preview to save it here.
                  </p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                  {savedListings.map((item) => (
                    <div
                      key={item.id}
                      data-testid={`saved-card-${item.id}`}
                      className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] overflow-hidden flex flex-col justify-between shadow-xs hover:scale-[1.02] hover:border-[var(--ps-accent)]/60 transition-all duration-200"
                    >
                      <div>
                        {item.coverImage?.trim() ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={item.coverImage.trim()}
                            alt={item.title}
                            referrerPolicy="no-referrer"
                            className="w-full h-44 object-cover"
                          />
                        ) : (
                          <div className="w-full h-44 bg-[var(--ps-surface-alt)] flex items-center justify-center text-xs font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                            {CATEGORY_LABELS[item.category]}
                          </div>
                        )}
                        <div className="p-4">
                          <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--ps-accent)]">
                            <span>{CATEGORY_LABELS[item.category]}</span>
                            <span className="text-[var(--ps-border)]">·</span>
                            <span className="text-[var(--ps-text-muted)] font-semibold normal-case tracking-normal">
                              {item.locality}
                            </span>
                            <span className="text-[var(--ps-border)]">·</span>
                            <span className="text-amber-500 font-bold tabular-nums">
                              ★ {item.rating}
                            </span>
                          </div>
                          <h2 className="text-base font-bold tracking-tight text-[var(--ps-text)] mt-1">
                            {item.title}
                          </h2>
                          <p className="text-xs text-[var(--ps-text-muted)] mt-1.5 line-clamp-2 leading-relaxed">
                            {item.shortDescription}
                          </p>
                          <div className="mt-2.5 pt-2 border-t border-[var(--ps-border)]/60 flex items-center justify-between text-[11px]">
                            <Link
                              href={`/user/${encodeURIComponent(item.ownerId || 'owner-1')}`}
                              data-testid={`saved-card-owner-link-${item.id}`}
                              className="inline-flex items-center gap-1.5 font-semibold text-[var(--ps-text-muted)] hover:text-[var(--ps-accent)] transition-colors"
                            >
                              <User className="w-3 h-3 text-[var(--ps-accent)]" />
                              <span className="truncate max-w-[160px]">
                                {item.ownerName || 'Listing Owner'}
                              </span>
                            </Link>
                          </div>
                        </div>
                      </div>
                      <div className="px-4 py-3 border-t border-[var(--ps-border)]/80 flex items-center justify-between gap-2 bg-[var(--ps-surface-alt)]/30">
                        <button
                          type="button"
                          onClick={() => toggleSavedListing(item.id)}
                          className="text-xs text-rose-600 font-semibold hover:underline"
                        >
                          Remove
                        </button>
                        <div className="flex items-center gap-1.5">
                          <button
                            type="button"
                            data-testid={`saved-locate-on-map-${item.id}`}
                            onClick={() => handleLocateListingOnMap(item.id)}
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors"
                          >
                            <MapPin className="w-3.5 h-3.5 text-[var(--ps-accent)]" />
                            <span>Locate on Map</span>
                          </button>
                          <button
                            type="button"
                            data-testid={`saved-open-full-page-${item.id}`}
                            onClick={() => handleOpenFullDetailPage(item.id)}
                            className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] hover:opacity-95 transition-opacity"
                          >
                            Open Full Page
                          </button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : activeNav === 'activity' ? (
            /* ACTIVITY DESTINATION: Live Notifications & Activity Logs from Supabase */
            <ActivityPanel onBackToExplore={() => setActiveNav('explore')} />
          ) : activeNav === 'workspace' ? (
            /* WORKSPACE DESTINATION: Role-appropriate access to Owner, Staff/Agent, and Admin Centre */
            <div className="flex-1 flex flex-col w-full max-w-full overflow-x-hidden">
              <div
                data-testid="workspace-role-switcher-bar"
                className="bg-[var(--ps-surface-alt)] border-b border-[var(--ps-border)] px-3 sm:px-4 py-2 w-full overflow-x-hidden"
              >
                <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-2 min-w-0">
                  <nav
                    aria-label="Workspace mode navigation"
                    className="flex items-center gap-1.5 overflow-x-auto no-scrollbar min-w-0"
                  >
                    <span className="text-xs font-bold text-[var(--ps-text-muted)] mr-1">
                      Workspace Mode:
                    </span>
                    <button
                      type="button"
                      onClick={() => handleSelectWorkspaceSubMode('owner')}
                      aria-current={
                        workspaceSubMode === 'owner' ? 'page' : undefined
                      }
                      data-testid="workspace-mode-owner-btn"
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
                        workspaceSubMode === 'owner'
                          ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                          : 'bg-[var(--ps-surface)] text-[var(--ps-text)] border border-[var(--ps-border)]'
                      }`}
                    >
                      <Building2 className="w-3.5 h-3.5" />
                      <span>Owner Workspace</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSelectWorkspaceSubMode('staff')}
                      aria-current={
                        workspaceSubMode === 'staff' ? 'page' : undefined
                      }
                      data-testid="workspace-mode-staff-btn"
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
                        workspaceSubMode === 'staff'
                          ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                          : 'bg-[var(--ps-surface)] text-[var(--ps-text)] border border-[var(--ps-border)]'
                      }`}
                    >
                      <Users className="w-3.5 h-3.5" />
                      <span>Staff / Agent Workspace</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSelectWorkspaceSubMode('admin')}
                      aria-current={
                        workspaceSubMode === 'admin' ? 'page' : undefined
                      }
                      data-testid="workspace-mode-admin-btn"
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
                        workspaceSubMode === 'admin'
                          ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                          : 'bg-[var(--ps-surface)] text-[var(--ps-text)] border border-[var(--ps-border)]'
                      }`}
                    >
                      <Shield className="w-3.5 h-3.5" />
                      <span>Admin Centre</span>
                    </button>
                  </nav>

                  <div className="flex items-center gap-2 text-xs">
                    <span className="text-[var(--ps-text-muted)] hidden sm:inline">
                      Active Account:
                    </span>
                    <select
                      aria-label="Switch active demonstration user account"
                      data-testid="workspace-account-select"
                      value={currentUser.id}
                      onChange={(e) => handleRoleSwitch(e.target.value, false)}
                      className="px-2.5 py-1 rounded-xl bg-[var(--ps-surface)] border border-[var(--ps-border)] font-semibold text-xs text-[var(--ps-text)]"
                    >
                      {users.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.name} ({u.adminRole || u.roleType})
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {workspaceSubMode === 'driver' ? (
                <DriverWorkspace />
              ) : workspaceSubMode === 'owner' || workspaceSubMode === 'staff' ? (
                <OwnerStaffWorkspace
                  forcedRole={workspaceSubMode}
                  onOpenListingOnMap={handleLocateListingOnMap}
                  initialDraftListing={pendingGeometryDraft}
                  onClearInitialDraftListing={() => setPendingGeometryDraft(null)}
                  initialTab={ownerInitialTab}
                />
              ) : (
                <AdminWorkspace onOpenListingOnMap={handleLocateListingOnMap} />
              )}
            </div>
          ) : (
            /* PROFILE DESTINATION: Active User Account, Demonstration Role Switcher, Theme & Units, Reset */
            <div
              data-testid="profile-destination-view"
              className="max-w-5xl mx-auto w-full px-4 py-6 space-y-6"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ps-border)] pb-4">
                <div>
                  <h1 className="text-xl sm:text-2xl font-bold text-[var(--ps-text)]">
                    Profile, Demonstration Role Switcher &amp; Preferences
                  </h1>
                  <p className="text-xs text-[var(--ps-text-muted)] mt-1">
                    Switch between simulated Visitor, Owner, Staff, and 7 Least-Privilege Admin accounts to test role-specific workflows.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setActiveNav('explore')}
                  className="px-3.5 py-2 rounded-xl text-xs font-semibold bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]"
                >
                  Back to Explore
                </button>
              </div>

              {/* Active User Card */}
              <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5 space-y-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-3.5">
                    {optimisticProfile?.avatarUrl?.trim() ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={optimisticProfile.avatarUrl.trim()}
                        alt={optimisticProfile.fullName || currentUser.name}
                        referrerPolicy="no-referrer"
                        className="w-12 h-12 rounded-2xl object-cover border border-[var(--ps-border)] shrink-0"
                      />
                    ) : (
                      <div className="w-12 h-12 rounded-2xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-base font-extrabold flex items-center justify-center shrink-0">
                        {currentUser.avatarLabel}
                      </div>
                    )}
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <h2 className="text-base font-bold text-[var(--ps-text)]">
                          {optimisticProfile?.fullName || currentUser.name}
                        </h2>
                        <span className="px-2 py-0.5 rounded-md bg-[var(--ps-surface-alt)] text-[var(--ps-accent)] text-[10px] font-bold uppercase">
                          {currentUser.adminRole || currentUser.roleType}
                        </span>
                      </div>
                      <p className="text-xs text-[var(--ps-text-muted)]">
                        {currentUser.email}
                        {optimisticProfile?.phone
                          ? ` · ${optimisticProfile.phone}`
                          : ''}{' '}
                        · {currentUser.description}
                      </p>
                      {currentUser.adminRole && (
                        <p className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-1">
                          {ADMIN_ROLE_DESCRIPTIONS[currentUser.adminRole]}
                        </p>
                      )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href="/profile/edit"
                      data-testid="appshell-open-edit-profile-slideover-btn"
                      className="px-3.5 py-2 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-bold hover:opacity-95 inline-flex items-center gap-1.5 shadow-2xs"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>Edit Profile</span>
                    </Link>
                    <Link
                      href="/profile"
                      className="px-3.5 py-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] inline-flex items-center gap-1.5"
                    >
                      <User className="w-3.5 h-3.5 text-[var(--ps-accent)]" />
                      <span>Full Profile Page</span>
                    </Link>
                    <Link
                      href="/messages"
                      className="px-3.5 py-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] inline-flex items-center gap-1.5"
                    >
                      <MessageSquare className="w-3.5 h-3.5 text-[var(--ps-accent)]" />
                      <span>Messages</span>
                    </Link>
                    <button
                      type="button"
                      onClick={() => setIsThemeModalOpen(true)}
                      className="px-3.5 py-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] inline-flex items-center gap-1.5"
                    >
                      <Palette className="w-3.5 h-3.5 text-[var(--ps-accent)]" />
                      <span>Theme, Map &amp; Units ({getAreaUnitSymbol(areaUnit)})</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsResetModalOpen(true)}
                      className="px-3.5 py-2 rounded-xl border border-rose-500/30 bg-rose-500/10 text-xs font-semibold text-rose-600 hover:bg-rose-500/20 inline-flex items-center gap-1.5"
                    >
                      <RotateCcw className="w-3.5 h-3.5" />
                      <span>Reset Demo Data</span>
                    </button>
                  </div>
                </div>

                {/* Clickable Social Links Icons */}
                <div className="pt-3 border-t border-[var(--ps-border)] flex flex-wrap items-center gap-2">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)] mr-1">
                    Social Channels:
                  </span>
                  {Object.entries(
                    optimisticProfile?.socialLinks &&
                      Object.keys(optimisticProfile.socialLinks).length > 0
                      ? optimisticProfile.socialLinks
                      : {
                          WhatsApp: '+91 98620 00000',
                          Instagram: '@printswift_lamka',
                          Facebook: 'PrintSwiftLamka',
                        }
                  ).map(([platform, rawVal]) => (
                    <a
                      key={platform}
                      href={resolveSocialLinkHref(platform, rawVal)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 py-1 text-xs font-semibold text-[var(--ps-text)] hover:border-[var(--ps-accent)] hover:text-[var(--ps-accent)] transition-colors"
                    >
                      <SocialPlatformIcon
                        platform={platform}
                        className="w-3.5 h-3.5 text-[var(--ps-accent)]"
                      />
                      <span>{platform}</span>
                      <ExternalLink className="w-3 h-3 opacity-60" />
                    </a>
                  ))}
                </div>
              </div>

              {/* Demonstration Role Switcher Grid */}
              <div className="space-y-3">
                <h3 className="text-sm font-bold text-[var(--ps-text)]">
                  Switch Simulated Demonstration Account (12 Roles)
                </h3>
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                  {users.map((u) => {
                    const isCurrent = u.id === currentUser.id;
                    return (
                      <button
                        key={u.id}
                        type="button"
                        onClick={() => handleRoleSwitch(u.id, true)}
                        data-testid={`switch-role-${u.id}`}
                        className={`p-3.5 rounded-2xl border text-left transition-all flex flex-col justify-between gap-2 ${
                          isCurrent
                            ? 'bg-[var(--ps-surface-alt)] border-[var(--ps-accent)] ring-2 ring-[var(--ps-accent)]/25'
                            : 'bg-[var(--ps-surface)] border-[var(--ps-border)] hover:border-[var(--ps-accent)]/60'
                        }`}
                      >
                        <div className="space-y-1">
                          <div className="flex items-center justify-between gap-2">
                            <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-[var(--ps-bg)] text-[var(--ps-accent)] border border-[var(--ps-border)]">
                              {u.adminRole || u.roleType}
                            </span>
                            {isCurrent && (
                              <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-600">
                                <CheckCircle2 className="w-3.5 h-3.5" />
                                Active
                              </span>
                            )}
                          </div>
                          <div className="text-sm font-bold text-[var(--ps-text)]">
                            {u.name}
                          </div>
                          <p className="text-[11px] text-[var(--ps-text-muted)] line-clamp-2">
                            {u.description}
                          </p>
                        </div>
                        <div className="text-[11px] font-semibold text-[var(--ps-accent)]">
                          {u.roleType === 'visitor'
                            ? 'Switch & Open Explore →'
                            : 'Switch & Open Workspace →'}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            </div>
              )}
            </motion.div>
          )}
        </main>
      </div>

      {/* =====================================================================
          PART A: FIXED MOBILE / TABLET PORTRAIT BOTTOM NAVIGATION BAR
          Hidden during Full-Screen Map Mode or when Mobile Landscape uses the Left Vertical Rail
         ===================================================================== */}
      {!isFullscreenMap && (
        <div className="nav-bottom-responsive">
          <BottomNav
            variant="bottom"
            navItems={navItems}
            activeNav={activeNav}
            fullPageListingId={fullPageListingId}
            onActivateNavDestination={handleActivateNavDestination}
            onOpenAuthModal={() => setIsAuthModalOpen(true)}
            optimisticRole={optimisticProfile?.role}
            mobileScrollDirection={mobileScrollDirection}
          />
        </div>
      )}

      {/* Theme, Map Style & Area Unit Modal */}
      <ThemeSettingsModal
        open={isThemeModalOpen}
        onClose={() => setIsThemeModalOpen(false)}
      />

      {/* Supabase Authentication Modal (Phase 3-B) */}
      <AuthModal
        open={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
      />

      {/* Phase 68-A: First-Visit GPS & Hub Welcome Modal */}
      <HubWelcomeModal />

      {/* Reset Demo Data Confirmation Modal */}
      {isResetModalOpen && (
        <div
          ref={resetModalRef}
          tabIndex={-1}
          className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 p-4 outline-none"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reset-demo-modal-title"
          data-testid="reset-demo-modal"
        >
          <div className="w-full max-w-md max-h-[85vh] overflow-y-auto rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 shadow-2xl">
            <div className="flex items-center justify-between mb-3">
              <h3
                id="reset-demo-modal-title"
                tabIndex={-1}
                className="text-base font-bold text-[var(--ps-text)] outline-none"
              >
                Reset All Demo Data to Initial Churachandpur Seed?
              </h3>
              <button
                type="button"
                onClick={() => setIsResetModalOpen(false)}
                aria-label="Close Reset Demo Data dialog"
                data-testid="close-reset-demo-modal-btn"
                className="p-1 text-[var(--ps-text-muted)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-[var(--ps-text-muted)] leading-relaxed">
              This will restore all 80 synthetic Churachandpur listings, 360° panoramas, product catalogues, enquiries, reviews, staff delegations, audit logs, and default square metre (m²) area units to their clean initial state.
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsResetModalOpen(false)}
                className="px-4 py-2 rounded-lg text-xs font-semibold border border-[var(--ps-border)] text-[var(--ps-text-muted)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  resetDemoData();
                  setFullPageListingId(null);
                  setActiveNav('explore');
                  setIsResetModalOpen(false);
                }}
                className="px-4 py-2 rounded-lg text-xs font-semibold bg-rose-600 text-white hover:bg-rose-700"
              >
                Confirm Reset Demo Data
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}

export default function AppShell({
  apiKey,
  serverViewAsRole,
  serverProfile,
  serverMapSettings,
  children,
}: {
  apiKey?: string;
  serverViewAsRole?: string | null;
  serverProfile?: (ProfileWithEffectiveRole & { effective_role: string }) | null;
  serverMapSettings?: MapSettings | null;
  children?: React.ReactNode;
}) {
  const isAlreadyMounted = useContext(AppShellMountedContext);

  useEffect(() => {
    if (isAlreadyMounted) return;
    if (serverMapSettings?.configured && typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('printswift:map-settings-updated', {
          detail: serverMapSettings,
        })
      );
    }
  }, [isAlreadyMounted, serverMapSettings]);

  if (isAlreadyMounted) {
    return null;
  }

  const resolvedEffectiveOverride =
    serverProfile?.effective_role &&
    serverProfile.effective_role !==
      (serverProfile.actual_role || serverProfile.role)
      ? serverProfile.effective_role
      : serverViewAsRole;
  setServerViewAsRoleOverride(resolvedEffectiveOverride);

  const resolvedApiKey = apiKey || '';
  const apiKeyAvailable = Boolean(resolvedApiKey && resolvedApiKey.trim().length > 5);

  return (
    <AppShellMountedContext.Provider value={true}>
      <GlobalErrorBoundary>
        <AppProvider>
          <MapsAvailabilityProvider apiKeyAvailable={apiKeyAvailable}>
            {apiKeyAvailable ? (
              <APIProvider
                apiKey={resolvedApiKey}
                libraries={['marker', 'geometry', 'places', 'routes']}
              >
                <AppShellInner apiKey={resolvedApiKey}>{children}</AppShellInner>
              </APIProvider>
            ) : (
              <AppShellInner apiKey="">{children}</AppShellInner>
            )}
          </MapsAvailabilityProvider>
        </AppProvider>
      </GlobalErrorBoundary>
    </AppShellMountedContext.Provider>
  );
}
