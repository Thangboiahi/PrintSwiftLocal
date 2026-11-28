'use client';

import React, {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import dynamic from 'next/dynamic';
import { usePathname, useRouter } from 'next/navigation';
import { motion } from 'framer-motion';
import { APIProvider } from '@vis.gl/react-google-maps';
import {
  AlertTriangle,
  Compass,
  Home,
  Newspaper,
  Store,
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
} from '@/components/navigation/Header';
import { BottomNav } from '@/components/navigation/BottomNav';
import { GlobalAnnouncementBar } from '@/components/ui/GlobalAnnouncementBar';
import { ShareProvider } from '@/components/ui/ShareSheetModal';
import { InteractiveTutorialOverlay } from '@/components/tutorials/InteractiveTutorialOverlay';
import { OfflineBanner } from '@/components/shared/OfflineBanner';
import { capturePendingReferralCodeFromSearch } from '@/lib/referrals/pending-ref';
import { HubWelcomeModal } from '@/components/hub/HubWelcomeModal';
import { AuthModal } from '@/components/auth/AuthModal';
import { ThemeSettingsModal } from '@/components/shared/ThemeSettingsModal';
import { GlobalErrorBoundary } from '@/components/shared/GlobalErrorBoundary';
import {
  EMPTY_LIVE_NAV_BADGES,
  type LiveNavBadges,
} from '@/lib/hooks/useLiveNavBadges';
import { resolveResponsiveLayoutProfile } from '@/lib/rules';
import { Listing } from '@/lib/types';
import {
  inferFeatureAreaFromPath,
  trackAppEvent,
} from '@/lib/analytics/track';

const DiscoveryWorkspace = dynamic(
  () =>
    import('@/components/discovery/DiscoveryWorkspace').then(
      (m) => m.DiscoveryWorkspace
    ),
  {
    ssr: false,
    loading: () => (
      <div className="w-full flex-1 min-h-[60dvh] p-4">
        <div className="dd-shimmer h-full min-h-[55dvh] w-full rounded-2xl border border-[var(--ps-border)]" />
      </div>
    ),
  }
);

const CategoryDetailView = dynamic(
  () =>
    import('@/components/listings/CategoryDetailView').then(
      (m) => m.CategoryDetailView
    ),
  {
    ssr: false,
    loading: () => (
      <div className="max-w-5xl mx-auto w-full p-4 space-y-4">
        <div className="dd-shimmer h-48 w-full rounded-2xl border border-[var(--ps-border)]" />
        <div className="dd-shimmer h-64 w-full rounded-2xl border border-[var(--ps-border)]" />
      </div>
    ),
  }
);

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
    listings,
    notifications,
    areaUnit,
    mapsQuotaExceeded,
  } = useAppStore();

  const pathname = usePathname() || '/';
  const router = useRouter();
  const isRouteOverlayActive = pathname !== '/explore';

  useEffect(() => {
    if (!pathname || pathname.startsWith('/admin')) return;
    trackAppEvent({
      event_type: 'page_view',
      feature_area: inferFeatureAreaFromPath(pathname),
      target_id: pathname,
    });
  }, [pathname]);

  const [activeNav, setActiveNav] = useState<GlobalNavDestination>('explore');
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
  const [isAuthModalOpen, setIsAuthModalOpen] = useState(false);
  const [optimisticProfile, setOptimisticProfile] =
    useState<Partial<OptimisticProfilePayload> | null>(null);
  const [isMobileSearchFocused, setIsMobileSearchFocused] =
    useState<boolean>(false);
  const [mobileScrollDirection, setMobileScrollDirectionState] = useState<
    'up' | 'down' | null
  >(null);
  const lastScrollDirToggleAtRef = useRef<number>(0);
  const mobileScrollDirRef = useRef<'up' | 'down' | null>(null);

  const setMobileScrollDirection = React.useCallback(
    (nextDir: 'up' | 'down' | null, force = false) => {
      const now = Date.now();
      if (!force && nextDir === mobileScrollDirRef.current) return;
      if (!force && now - lastScrollDirToggleAtRef.current < 280) return;
      mobileScrollDirRef.current = nextDir;
      lastScrollDirToggleAtRef.current = now;
      setMobileScrollDirectionState(nextDir);
    },
    []
  );

  const [headerHeight, setHeaderHeight] = useState<number>(56);
  const [topChromeHeight, setTopChromeHeight] = useState<number>(56);
  const [liveBadges, setLiveBadges] = useState<LiveNavBadges>(
    EMPTY_LIVE_NAV_BADGES
  );
  const topChromeRef = useRef<HTMLDivElement | null>(null);

  const isHeaderHidden =
    !isFullscreenMap &&
    !isMobileSearchFocused &&
    !isThemeModalOpen &&
    !isAuthModalOpen &&
    mobileScrollDirection === 'down';

  useEffect(() => {
    if (typeof window !== 'undefined' && window.location.search) {
      capturePendingReferralCodeFromSearch(window.location.search);
    }
    queueMicrotask(() => {
      setMobileScrollDirection('up', true);
    });
  }, [pathname, setMobileScrollDirection]);

  useLayoutEffect(() => {
    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    const el = topChromeRef.current;

    const syncHeight = (deferStateUpdate: boolean) => {
      const measured = isFullscreenMap
        ? 0
        : el
          ? Math.ceil(el.getBoundingClientRect().height)
          : headerHeight;
      const safeH = Math.max(0, measured);
      const fullPx = `${safeH}px`;
      const visiblePx = isHeaderHidden || isFullscreenMap ? '0px' : fullPx;

      const root = document.documentElement;
      root.style.setProperty('--app-header-height', fullPx);
      root.style.setProperty('--header-height', fullPx);
      root.style.setProperty('--header-visible-height', visiblePx);
      root.setAttribute('data-header-hidden', isHeaderHidden ? 'true' : 'false');

      if (deferStateUpdate) {
        queueMicrotask(() => {
          setTopChromeHeight((prev) => (prev === safeH ? prev : safeH));
        });
      } else {
        setTopChromeHeight((prev) => (prev === safeH ? prev : safeH));
      }
    };

    syncHeight(true);
    if (!el || typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(() => syncHeight(false));
    observer.observe(el);
    const handleResize = () => syncHeight(false);
    window.addEventListener('resize', handleResize);
    return () => {
      observer.disconnect();
      window.removeEventListener('resize', handleResize);
    };
  }, [isFullscreenMap, isHeaderHidden, headerHeight]);

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

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleUnmountOverlays = () => {
      setFullPageListingId(null);
      setActiveNav('explore');
    };

    const handleOpenWorkspaceEnquiries = () => {
      setFullPageListingId(null);
      router.push('/workspace/owner?tab=enquiries');
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
        router.push('/workspace/owner');
      } else if (detail?.destination === 'admin') {
        router.push('/admin');
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

    const handleOpenAuthModalEvent = () => {
      setIsAuthModalOpen(true);
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
    window.addEventListener(
      'printswift:open-auth-modal',
      handleOpenAuthModalEvent
    );

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
      window.removeEventListener(
        'printswift:open-auth-modal',
        handleOpenAuthModalEvent
      );
    };
  }, [router]);

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

  const apiKeyAvailable = Boolean(apiKey && apiKey.trim().length > 5);

  const fullPageListing = useMemo(
    () => listings.find((l) => l.id === fullPageListingId) || null,
    [listings, fullPageListingId]
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

  const handleInitiateListingFromGeometry = (_draftListing: Listing) => {
    setFullPageListingId(null);
    router.push(
      currentUser.roleType === 'staff' ? '/workspace/staff' : '/workspace/owner'
    );
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
    { id: 'market', label: 'Shop & Food', href: '/marketplace', icon: Store },
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
      className={`min-h-dvh overflow-x-clip flex flex-col bg-[var(--ps-bg)] text-[var(--ps-text)] ${
        !isFullscreenMap ? 'nav-main-padding-responsive' : ''
      }`}
    >
      {!isFullscreenMap && (
        <motion.div
          ref={topChromeRef}
          data-testid="app-top-chrome"
          data-header-visible={!isHeaderHidden ? 'true' : 'false'}
          initial={false}
          animate={{ y: isHeaderHidden ? '-100%' : '0%' }}
          transition={{ type: 'spring', stiffness: 320, damping: 32 }}
          className="fixed top-0 left-0 right-0 z-[50] w-full flex flex-col will-change-transform"
        >
          {mapsQuotaExceeded && (
            <div
              role="alert"
              className="flex flex-wrap items-center justify-between gap-2 bg-amber-500 px-4 py-1.5 text-xs font-semibold text-slate-950 shadow-md"
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
              router.push('/workspace/owner');
            }}
            onOpenAdminWorkspace={() => {
              router.push('/admin');
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
            optimisticAvatarUrl={
              optimisticProfile?.avatarUrl || authAvatarUrl || undefined
            }
            isSearchFocused={isMobileSearchFocused}
            mobileScrollDirection={mobileScrollDirection}
            isHeaderVisible={!isHeaderHidden}
            onHeaderHeightChange={setHeaderHeight}
            onHeaderVisibilityChange={(visible) => {
              setMobileScrollDirection(visible ? 'up' : 'down');
            }}
            onLiveBadgesChange={setLiveBadges}
          />

          <OfflineBanner />
          <GlobalAnnouncementBar />
        </motion.div>
      )}

      {!isFullscreenMap && activeTab !== 'explore' && (
        <div
          aria-hidden="true"
          data-testid="app-header-spacer"
          className="w-full shrink-0"
          style={{ height: 'var(--app-header-height, 56px)' }}
        />
      )}

      <div className="flex-1 flex flex-row min-w-0">
        {!isFullscreenMap && (
          <div className="nav-vertical-responsive w-[68px] shrink-0 sticky top-[var(--header-visible-height,56px)] h-[calc(100dvh-var(--header-visible-height,56px))] self-start flex-col transition-[top,height] duration-300 ease-out">
            <BottomNav
              variant="rail"
              navItems={navItems}
              activeNav={activeNav}
              fullPageListingId={fullPageListingId}
              onActivateNavDestination={handleActivateNavDestination}
              onOpenAuthModal={() => setIsAuthModalOpen(true)}
              optimisticRole={optimisticProfile?.role}
              mobileScrollDirection={mobileScrollDirection}
              liveBadges={liveBadges}
            />
          </div>
        )}

        <main className="flex-1 relative w-full flex flex-col min-w-0">
          {/* Map Discovery Container — Dynamically loaded and mounted strictly when /explore is active */}
          {activeTab === 'explore' && (
            <div
              data-testid="explore-session-container"
              className="explore-viewport-height w-full flex flex-col relative min-w-0 min-h-0 overflow-hidden"
            >
              <DiscoveryWorkspace
                apiKeyAvailable={apiKeyAvailable}
                isActiveView={true}
                onOpenFullDetailPage={handleOpenFullDetailPage}
                onFullscreenMapChange={setIsFullscreenMap}
                selectedLocalityOverride={headerLocality}
                onSelectLocalityOverride={setHeaderLocality}
                onInitiateListingFromGeometry={handleInitiateListingFromGeometry}
                layoutProfile={layoutProfile}
                pendingMapFocusRequest={pendingMapFocusRequest}
                onSearchFocusChange={setIsMobileSearchFocused}
                onListScrollDirectionChange={setMobileScrollDirection}
                headerHeight={topChromeHeight}
                isHeaderHidden={isHeaderHidden}
              />
            </div>
          )}

          {/* Route Content Wrapper (/profile, /settings, /civic, /pick-n-drop, /marketplace, /listing/[id], etc.) */}
          {isRouteOverlayActive && children && (
            <motion.div
              key={`route-overlay-${pathname}`}
              data-testid="appshell-route-overlay"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.14 }}
              className="flex-1 w-full min-w-0 bg-[var(--ps-bg)]"
            >
              {children}
            </motion.div>
          )}

          {/* Full Detail View overlay when triggered inside /explore */}
          {!isRouteOverlayActive && !isExploreLocked && fullPageListing && (
            <div
              data-testid="appshell-internal-overlay"
              className="flex-1 w-full min-w-0 bg-[var(--ps-bg)] flex flex-col"
            >
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
            </div>
          )}
        </main>
      </div>

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
            liveBadges={liveBadges}
          />
        </div>
      )}

      <ThemeSettingsModal
        open={isThemeModalOpen}
        onClose={() => setIsThemeModalOpen(false)}
      />

      <AuthModal
        open={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
      />

      <HubWelcomeModal />
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

  const resolvedEffectiveOverride =
    serverProfile?.effective_role &&
    serverProfile.effective_role !==
      (serverProfile.actual_role || serverProfile.role)
      ? serverProfile.effective_role
      : serverViewAsRole;

  useEffect(() => {
    if (isAlreadyMounted) return;
    setServerViewAsRoleOverride(resolvedEffectiveOverride);
  }, [isAlreadyMounted, resolvedEffectiveOverride]);

  if (isAlreadyMounted) {
    return null;
  }

  const resolvedApiKey = apiKey || '';
  const apiKeyAvailable = Boolean(resolvedApiKey && resolvedApiKey.trim().length > 5);

  return (
    <AppShellMountedContext.Provider value={true}>
      <GlobalErrorBoundary>
        <AppProvider>
          <ShareProvider>
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
              <InteractiveTutorialOverlay />
            </MapsAvailabilityProvider>
          </ShareProvider>
        </AppProvider>
      </GlobalErrorBoundary>
    </AppShellMountedContext.Provider>
  );
}
