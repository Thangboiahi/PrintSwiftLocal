'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { APIProvider } from '@vis.gl/react-google-maps';
import {
  Activity,
  AlertTriangle,
  Bell,
  Bookmark,
  Briefcase,
  Building2,
  Check,
  CheckCircle2,
  ChevronDown,
  Compass,
  MapPin,
  MessageSquare,
  Palette,
  RotateCcw,
  Shield,
  Star,
  User,
  Users,
  X,
} from 'lucide-react';
import { AppProvider, useAppStore } from '@/lib/store';
import { DiscoveryWorkspace } from '@/components/discovery/DiscoveryWorkspace';
import { CategoryDetailView } from '@/components/listings/CategoryDetailView';
import OwnerStaffWorkspace from '@/components/workspaces/OwnerStaffWorkspace';
import AdminWorkspace from '@/components/workspaces/AdminWorkspace';
import {
  ThemeSettingsModal,
  isTopmostActiveModal,
  useModalFocusManagement,
} from '@/components/shared/ThemeSettingsModal';
import { PrintSwiftAssistant } from '@/components/shared/PrintSwiftAssistant';
import {
  ADMIN_ROLE_DESCRIPTIONS,
  CATEGORY_LABELS,
  getAreaUnitSymbol,
  resolveResponsiveLayoutProfile,
} from '@/lib/rules';
import { CHURACHANDPUR_LOCALITIES } from '@/lib/seed-data';
import { Listing } from '@/lib/types';

type GlobalNavDestination =
  | 'explore'
  | 'saved'
  | 'activity'
  | 'workspace'
  | 'profile';

type WorkspaceSubMode = 'owner' | 'staff' | 'admin';

function AppShellInner({ apiKey }: { apiKey: string }) {
  const {
    currentUser,
    users,
    switchUser,
    listings,
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

  const [activeNav, setActiveNav] = useState<GlobalNavDestination>('explore');
  const [workspaceSubMode, setWorkspaceSubMode] =
    useState<WorkspaceSubMode>('owner');
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
  const [isHeaderLocalityOpen, setIsHeaderLocalityOpen] =
    useState<boolean>(false);
  const headerLocalityRef = useRef<HTMLDivElement | null>(null);
  const [isFullscreenMap, setIsFullscreenMap] = useState<boolean>(false);
  const [isThemeModalOpen, setIsThemeModalOpen] = useState(false);
  const [isResetModalOpen, setIsResetModalOpen] = useState(false);
  const [pendingGeometryDraft, setPendingGeometryDraft] =
    useState<Listing | null>(null);

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

  useEffect(() => {
    if (!isHeaderLocalityOpen) return;
    const handleOutside = (ev: MouseEvent) => {
      if (
        headerLocalityRef.current &&
        !headerLocalityRef.current.contains(ev.target as Node)
      ) {
        setIsHeaderLocalityOpen(false);
      }
    };
    const handleKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
        setIsHeaderLocalityOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [isHeaderLocalityOpen]);

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
    if (id === 'workspace') {
      if (currentUser.roleType === 'visitor') {
        switchUser('owner-1');
        setWorkspaceSubMode('owner');
      } else if (currentUser.roleType === 'owner') {
        setWorkspaceSubMode('owner');
      } else if (currentUser.roleType === 'staff') {
        setWorkspaceSubMode('staff');
      } else if (currentUser.roleType === 'admin') {
        setWorkspaceSubMode('admin');
      }
    }
    setActiveNav(id);
  };

  const navItems: Array<{
    id: GlobalNavDestination;
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: number;
  }> = [
    { id: 'explore', label: 'Explore', icon: Compass },
    {
      id: 'saved',
      label: 'Saved',
      icon: Bookmark,
      badge: savedListingIds.length > 0 ? savedListingIds.length : undefined,
    },
    {
      id: 'activity',
      label: 'Activity',
      icon: Activity,
      badge:
        unreadNotificationsCount > 0 ? unreadNotificationsCount : undefined,
    },
    { id: 'workspace', label: 'Workspace', icon: Briefcase },
    { id: 'profile', label: 'Profile', icon: User },
  ];

  const isExploreLocked = activeNav === 'explore' && !fullPageListing;

  return (
    <div
      data-testid="app-shell-root"
      data-layout-profile={layoutProfile.profile}
      className={`${
        isExploreLocked ? 'h-dvh overflow-hidden' : 'min-h-screen'
      } flex flex-col bg-[var(--ps-bg)] text-[var(--ps-text)] ${
        !isFullscreenMap && layoutProfile.useBottomNav ? 'pb-14' : ''
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


      {/* =====================================================================
          SECTION 1: COMPACT BRAND HEADER & DESKTOP 5-DESTINATION NAVIGATION
         ===================================================================== */}
      {!isFullscreenMap && (
        <header
          data-testid="app-brand-header"
          className={`sticky top-0 z-40 bg-[var(--ps-surface)]/95 backdrop-blur border-b border-[var(--ps-border)] px-2.5 sm:px-4 ${
            layoutProfile.isMobileLandscape ? 'py-1' : 'py-1.5 sm:py-2'
          } shrink-0`}
        >
          <div className="max-w-[1600px] mx-auto flex items-center justify-between gap-1.5 sm:gap-2 xl:gap-4">
            {/* Left: PrintSwift Local Identity + Churachandpur Location Selector */}
            <div className="flex items-center gap-1.5 sm:gap-2 xl:gap-3 min-w-0 shrink-0">
              <button
                type="button"
                onClick={() => {
                  setFullPageListingId(null);
                  setActiveNav('explore');
                }}
                className="flex items-center gap-1.5 sm:gap-2 text-left group shrink-0"
              >
                <div
                  className={`${
                    layoutProfile.isMobileLandscape
                      ? 'w-6 h-6 rounded-lg'
                      : 'w-6 h-6 sm:w-8 sm:h-8 rounded-lg sm:rounded-xl'
                  } bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] flex items-center justify-center font-bold shadow-xs shrink-0`}
                >
                  <Compass className="w-3.5 h-3.5 sm:w-4.5 sm:h-4.5" />
                </div>
                <div className="min-w-0">
                  <span className="text-xs sm:text-sm font-extrabold tracking-tight text-[var(--ps-text)] block whitespace-nowrap">
                    PrintSwift
                  </span>
                  {!layoutProfile.isMobileLandscape && (
                    <span className="text-[10px] text-[var(--ps-text-muted)] hidden sm:block lg:hidden xl:block truncate">
                      Listing Platform
                    </span>
                  )}
                </div>
              </button>

              {/* Churachandpur Custom Theme-Token Locality Popover Selector */}
              <div ref={headerLocalityRef} className="relative min-w-0">
                <button
                  type="button"
                  onClick={() => setIsHeaderLocalityOpen((prev) => !prev)}
                  aria-label="Select Churachandpur locality"
                  aria-haspopup="listbox"
                  aria-expanded={isHeaderLocalityOpen}
                  title={`Locality filter: ${
                    headerLocality === 'all'
                      ? 'Churachandpur (All)'
                      : headerLocality
                  }`}
                  data-testid="header-locality-selector"
                  className="inline-flex items-center gap-1 px-2 py-1 rounded-xl bg-[var(--ps-bg)] border border-[var(--ps-border)] hover:border-[var(--ps-accent)]/60 hover:bg-[var(--ps-surface-alt)] text-[10px] sm:text-[11px] font-semibold text-[var(--ps-text)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)] max-w-[125px] sm:max-w-[145px] xl:max-w-[180px]"
                >
                  <MapPin className="w-3 h-3 text-[var(--ps-accent)] shrink-0" />
                  <span className="truncate">
                    {headerLocality === 'all'
                      ? 'Churachandpur (All)'
                      : headerLocality}
                  </span>
                  <ChevronDown
                    className={`w-3 h-3 text-[var(--ps-text-muted)] shrink-0 transition-transform ${
                      isHeaderLocalityOpen ? 'rotate-180' : ''
                    }`}
                  />
                </button>

                {isHeaderLocalityOpen && (
                  <div
                    role="listbox"
                    aria-label="Churachandpur Localities"
                    data-testid="header-locality-popover"
                    className="absolute left-0 top-full mt-1.5 w-60 max-w-[calc(100vw-24px)] max-h-64 overflow-y-auto rounded-2xl bg-[var(--ps-surface)] border border-[var(--ps-border)] shadow-2xl p-1.5 z-50 space-y-0.5 text-xs"
                  >
                    <button
                      type="button"
                      role="option"
                      aria-selected={headerLocality === 'all'}
                      onClick={() => {
                        setHeaderLocality('all');
                        setIsHeaderLocalityOpen(false);
                        if (activeNav !== 'explore') {
                          setFullPageListingId(null);
                          setActiveNav('explore');
                        }
                      }}
                      className={`w-full px-3 py-2 rounded-xl text-left font-semibold flex items-center justify-between gap-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)] ${
                        headerLocality === 'all'
                          ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                          : 'text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                      }`}
                    >
                      <span>Churachandpur (All)</span>
                      {headerLocality === 'all' && (
                        <Check className="w-3.5 h-3.5 shrink-0" />
                      )}
                    </button>
                    {CHURACHANDPUR_LOCALITIES.map((loc) => {
                      const isSel = headerLocality === loc;
                      return (
                        <button
                          key={loc}
                          type="button"
                          role="option"
                          aria-selected={isSel}
                          onClick={() => {
                            setHeaderLocality(loc);
                            setIsHeaderLocalityOpen(false);
                            if (activeNav !== 'explore') {
                              setFullPageListingId(null);
                              setActiveNav('explore');
                            }
                          }}
                          className={`w-full px-3 py-2 rounded-xl text-left font-semibold flex items-center justify-between gap-2 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)] ${
                            isSel
                              ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                              : 'text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                          }`}
                        >
                          <span className="truncate">{loc}</span>
                          {isSel && <Check className="w-3.5 h-3.5 shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            {/* Center: Desktop 5-Destination Horizontal Navigation (lg+) */}
            <nav
              aria-label="Primary application navigation"
              data-testid="desktop-global-nav"
              className="hidden lg:flex items-center gap-1 shrink-0"
            >
              {navItems.map((item) => {
                const Icon = item.icon;
                const isActive =
                  activeNav === item.id && !fullPageListingId;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setFullPageListingId(null);
                      if (item.id === 'workspace') {
                        if (currentUser.roleType === 'visitor') {
                          switchUser('owner-1');
                          setWorkspaceSubMode('owner');
                        } else if (currentUser.roleType === 'owner') {
                          setWorkspaceSubMode('owner');
                        } else if (currentUser.roleType === 'staff') {
                          setWorkspaceSubMode('staff');
                        } else if (currentUser.roleType === 'admin') {
                          setWorkspaceSubMode('admin');
                        }
                      }
                      setActiveNav(item.id);
                    }}
                    data-testid={`desktop-nav-${item.id}`}
                    aria-current={isActive ? 'page' : undefined}
                    className={`inline-flex items-center gap-1.5 px-2.5 xl:px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors ${
                      isActive
                        ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-2xs'
                        : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{item.label}</span>
                    {item.badge !== undefined && (
                      <span
                        className={`px-1.5 py-0.2 rounded-full text-[10px] font-bold ${
                          isActive
                            ? 'bg-white/20 text-white'
                            : 'bg-[var(--ps-surface-alt)] text-[var(--ps-text)]'
                        }`}
                      >
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </nav>

            {/* Right: Quick Activity / Notification Access, Theme & Units, Profile / Avatar Access */}
            <div className="flex items-center gap-1 sm:gap-1.5 shrink-0">
              <button
                type="button"
                onClick={() => setIsThemeModalOpen(true)}
                title="Theme, Map Style & Area Units"
                aria-label="Open Theme, Map Style, and Area Unit Settings"
                data-testid="header-theme-units-btn"
                className="inline-flex items-center gap-1 p-1.5 sm:px-2.5 sm:py-1.5 rounded-xl text-xs font-semibold bg-[var(--ps-bg)] border border-[var(--ps-border)] text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors"
              >
                <Palette className="w-3.5 h-3.5 text-[var(--ps-accent)]" />
                <span className="hidden xl:inline">Theme</span>
                <span className="hidden sm:inline font-mono text-[10px] px-1 rounded bg-[var(--ps-surface-alt)]">
                  {getAreaUnitSymbol(areaUnit)}
                </span>
              </button>

              <button
                type="button"
                onClick={() => {
                  setFullPageListingId(null);
                  setActiveNav('activity');
                }}
                title="Activity & Notifications"
                aria-label="Open Activity and Notifications"
                data-testid="header-activity-btn"
                className="relative p-1.5 sm:p-2 rounded-xl bg-[var(--ps-bg)] border border-[var(--ps-border)] text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors"
              >
                <Bell className="w-3.5 h-3.5 sm:w-4 sm:h-4" />
                {unreadNotificationsCount > 0 && (
                  <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-0.5 rounded-full bg-rose-600 text-white text-[9px] font-bold flex items-center justify-center">
                    {unreadNotificationsCount}
                  </span>
                )}
              </button>

              <button
                type="button"
                onClick={() => {
                  setFullPageListingId(null);
                  setActiveNav('profile');
                }}
                title={`Active Demo Profile: ${currentUser.name} (${currentUser.adminRole || currentUser.roleType})`}
                aria-label={`Open Profile and Role Switcher (${currentUser.name})`}
                data-testid="header-profile-btn"
                className="inline-flex items-center gap-1.5 p-1 sm:pl-1.5 sm:pr-2.5 sm:py-1 rounded-xl bg-[var(--ps-bg)] border border-[var(--ps-border)] hover:bg-[var(--ps-surface-alt)] transition-colors"
              >
                <span className="w-6 h-6 rounded-lg bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-[10px] font-extrabold flex items-center justify-center shrink-0">
                  {currentUser.avatarLabel}
                </span>
                <span className="hidden sm:inline lg:hidden xl:inline text-xs font-semibold text-[var(--ps-text)] max-w-[110px] truncate">
                  {currentUser.name}
                </span>
              </button>
            </div>
          </div>
        </header>
      )}

      {/* =====================================================================
          MAIN CONTENT AREA + ADAPTIVE MOBILE LANDSCAPE VERTICAL NAVIGATION RAIL
         ===================================================================== */}
      <div className="flex-1 flex flex-row min-h-0 overflow-hidden">
        {!isFullscreenMap && layoutProfile.useVerticalNavRail && (
          <nav
            aria-label="Mobile landscape vertical navigation rail"
            data-testid="landscape-vertical-nav-rail"
            className="w-14 shrink-0 bg-[var(--ps-surface)]/98 backdrop-blur-md border-r border-[var(--ps-border)] py-1.5 px-1 flex flex-col items-center justify-around z-30 select-none"
          >
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeNav === item.id && !fullPageListingId;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleActivateNavDestination(item.id)}
                  title={item.label}
                  aria-label={item.label}
                  aria-current={isActive ? 'page' : undefined}
                  data-testid={`mobile-nav-${item.id}`}
                  data-rail-nav={item.id}
                  className={`relative w-full py-1 px-0.5 rounded-xl flex flex-col items-center justify-center gap-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)] ${
                    isActive
                      ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] font-bold shadow-xs'
                      : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] font-medium'
                  }`}
                >
                  <div className="relative">
                    <Icon className="w-3.5 h-3.5" />
                    {item.badge !== undefined && (
                      <span
                        className={`absolute -top-1.5 -right-2.5 min-w-[13px] h-[13px] px-0.5 rounded-full text-[8px] font-bold flex items-center justify-center ${
                          isActive
                            ? 'bg-white text-slate-900'
                            : 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                        }`}
                      >
                        {item.badge}
                      </span>
                    )}
                  </div>
                  <span className="text-[9px] leading-none truncate max-w-full">
                    {item.label}
                  </span>
                </button>
              );
            })}
          </nav>
        )}

        <main
          className={`flex-1 flex flex-col min-w-0 ${
            isExploreLocked ? 'min-h-0 overflow-hidden' : 'overflow-y-auto'
          }`}
        >
          <div
            data-testid="explore-session-container"
            aria-hidden={!isExploreLocked}
            className={
              isExploreLocked
                ? 'flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden'
                : 'hidden'
            }
          >
            <DiscoveryWorkspace
              apiKeyAvailable={apiKeyAvailable}
              isActiveView={isExploreLocked}
              onOpenFullDetailPage={handleOpenFullDetailPage}
              onFullscreenMapChange={setIsFullscreenMap}
              selectedLocalityOverride={headerLocality}
              onSelectLocalityOverride={setHeaderLocality}
              onInitiateListingFromGeometry={handleInitiateListingFromGeometry}
              layoutProfile={layoutProfile}
              pendingMapFocusRequest={pendingMapFocusRequest}
            />
          </div>

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
          ) : activeNav === 'explore' ? null : activeNav === 'saved' ? (
            <div
              data-testid="saved-destination-view"
              className="max-w-7xl mx-auto w-full px-4 py-6 space-y-5"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ps-border)] pb-4">
                <div>
                  <h1 className="text-xl sm:text-2xl font-bold text-[var(--ps-text)]">
                    Saved &amp; Followed Sample Listings ({savedListings.length})
                  </h1>
                  <p className="text-xs text-[var(--ps-text-muted)] mt-1">
                    Stored locally in your browser session. Open any listing on the map or inspect its full detail page.
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

              {savedListings.length === 0 ? (
                <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-10 text-center">
                  <p className="text-sm font-semibold text-[var(--ps-text)]">
                    No saved sample listings yet.
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
                      className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] overflow-hidden flex flex-col justify-between shadow-xs"
                    >
                      <div>
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={item.coverImage}
                          alt={item.title}
                          referrerPolicy="no-referrer"
                          className="w-full h-40 object-cover"
                        />
                        <div className="p-4">
                          <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded bg-[var(--ps-surface-alt)] text-[var(--ps-accent)]">
                            {CATEGORY_LABELS[item.category]}
                          </span>
                          <h2 className="text-base font-bold text-[var(--ps-text)] mt-1.5">
                            {item.title}
                          </h2>
                          <p className="text-xs text-[var(--ps-text-muted)] mt-0.5">
                            {item.locality}
                          </p>
                          <p className="text-xs text-[var(--ps-text-muted)] mt-2 line-clamp-2">
                            {item.shortDescription}
                          </p>
                        </div>
                      </div>
                      <div className="px-4 py-3 border-t border-[var(--ps-border)] flex items-center justify-between gap-2">
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
                            className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-xl text-xs font-semibold border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]"
                          >
                            <MapPin className="w-3.5 h-3.5 text-[var(--ps-accent)]" />
                            <span>Locate on Map</span>
                          </button>
                          <button
                            type="button"
                            data-testid={`saved-open-full-page-${item.id}`}
                            onClick={() => handleOpenFullDetailPage(item.id)}
                            className="px-3 py-1.5 rounded-xl text-xs font-semibold bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]"
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
            /* ACTIVITY DESTINATION: Notifications, Enquiries, Reviews & Saved Map Drawings */
            <div
              data-testid="activity-destination-view"
              className="max-w-6xl mx-auto w-full px-4 py-6 space-y-6"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ps-border)] pb-4">
                <div>
                  <h1 className="text-xl sm:text-2xl font-bold text-[var(--ps-text)]">
                    Activity, Notifications &amp; Recent Interactions
                  </h1>
                  <p className="text-xs text-[var(--ps-text-muted)] mt-1">
                    Review prototype notifications, visitor enquiries, community reviews, and saved map measurements.
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

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                {/* Notifications */}
                <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-bold text-[var(--ps-text)] flex items-center gap-1.5">
                      <Bell className="w-4 h-4 text-[var(--ps-accent)]" />
                      <span>Notifications ({notifications.length})</span>
                    </h2>
                    <span className="text-[11px] text-[var(--ps-text-muted)]">
                      {unreadNotificationsCount} unread
                    </span>
                  </div>
                  <div className="space-y-2 max-h-80 overflow-y-auto">
                    {notifications.map((n) => (
                      <div
                        key={n.id}
                        className={`p-3 rounded-xl border text-xs flex items-start justify-between gap-2 ${
                          n.read
                            ? 'bg-[var(--ps-bg)] border-[var(--ps-border)]'
                            : 'bg-[var(--ps-surface-alt)] border-[var(--ps-accent)]/50'
                        }`}
                      >
                        <div className="space-y-1">
                          <div className="font-bold text-[var(--ps-text)]">
                            {n.title}
                          </div>
                          <p className="text-[var(--ps-text-muted)]">
                            {n.message}
                          </p>
                        </div>
                        {!n.read && (
                          <button
                            type="button"
                            onClick={() => markNotificationRead(n.id)}
                            className="px-2 py-1 rounded-lg bg-[var(--ps-surface)] border border-[var(--ps-border)] text-[10px] font-semibold shrink-0"
                          >
                            Mark read
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Enquiries & Saved Drawings Summary */}
                <div className="space-y-5">
                  <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3">
                    <h2 className="text-sm font-bold text-[var(--ps-text)] flex items-center gap-1.5">
                      <MessageSquare className="w-4 h-4 text-[var(--ps-accent)]" />
                      <span>Demonstration Enquiries ({enquiries.length})</span>
                    </h2>
                    <div className="space-y-2 max-h-48 overflow-y-auto">
                      {enquiries.slice(0, 6).map((enq) => (
                        <div
                          key={enq.id}
                          className="p-2.5 rounded-xl bg-[var(--ps-bg)] border border-[var(--ps-border)] text-xs space-y-1"
                        >
                          <div className="flex items-center justify-between">
                            <span className="font-bold text-[var(--ps-text)]">
                              {enq.listingTitle}
                            </span>
                            <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-[var(--ps-surface-alt)] font-semibold">
                              {enq.status}
                            </span>
                          </div>
                          <p className="text-[11px] text-[var(--ps-text-muted)] line-clamp-2">
                            {enq.message}
                          </p>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-2">
                    <div className="flex items-center justify-between">
                      <h2 className="text-sm font-bold text-[var(--ps-text)] flex items-center gap-1.5">
                        <Star className="w-4 h-4 text-amber-500" />
                        <span>
                          Community Reviews ({reviews.length}) &amp; Map Drawings ({drawnShapes.length})
                        </span>
                      </h2>
                      <button
                        type="button"
                        onClick={() => setActiveNav('explore')}
                        className="text-xs font-semibold text-[var(--ps-accent)] hover:underline"
                      >
                        Open Map
                      </button>
                    </div>
                    <p className="text-xs text-[var(--ps-text-muted)]">
                      You have {savedListings.length} saved listings and {drawnShapes.length} custom map drawings stored in your browser session.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ) : activeNav === 'workspace' ? (
            /* WORKSPACE DESTINATION: Role-appropriate access to Owner, Staff/Agent, and Admin Centre */
            <div className="flex-1 flex flex-col">
              <div
                data-testid="workspace-role-switcher-bar"
                className="bg-[var(--ps-surface-alt)] border-b border-[var(--ps-border)] px-4 py-2"
              >
                <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
                    <span className="text-xs font-bold text-[var(--ps-text-muted)] mr-1">
                      Workspace Mode:
                    </span>
                    <button
                      type="button"
                      onClick={() => handleSelectWorkspaceSubMode('owner')}
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
                  </div>

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

              {workspaceSubMode === 'owner' || workspaceSubMode === 'staff' ? (
                <OwnerStaffWorkspace
                  onOpenListingOnMap={handleLocateListingOnMap}
                  initialDraftListing={pendingGeometryDraft}
                  onClearInitialDraftListing={() => setPendingGeometryDraft(null)}
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
              <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                <div className="flex items-center gap-3.5">
                  <div className="w-12 h-12 rounded-2xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-base font-extrabold flex items-center justify-center shrink-0">
                    {currentUser.avatarLabel}
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h2 className="text-base font-bold text-[var(--ps-text)]">
                        {currentUser.name}
                      </h2>
                      <span className="px-2 py-0.5 rounded-md bg-[var(--ps-surface-alt)] text-[var(--ps-accent)] text-[10px] font-bold uppercase">
                        {currentUser.adminRole || currentUser.roleType}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--ps-text-muted)]">
                      {currentUser.email} · {currentUser.description}
                    </p>
                    {currentUser.adminRole && (
                      <p className="text-[11px] text-emerald-700 dark:text-emerald-400 mt-1">
                        {ADMIN_ROLE_DESCRIPTIONS[currentUser.adminRole]}
                      </p>
                    )}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
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
        </main>
      </div>

      {/* =====================================================================
          PART A: FIXED MOBILE / TABLET PORTRAIT BOTTOM NAVIGATION BAR
          Hidden during Full-Screen Map Mode or when Mobile Landscape uses the Left Vertical Rail
         ===================================================================== */}
      {!isFullscreenMap && layoutProfile.useBottomNav && (
        <nav
          aria-label="Mobile bottom navigation"
          data-testid="mobile-bottom-nav"
          className="lg:hidden fixed bottom-0 left-0 right-0 z-40 h-14 bg-[var(--ps-surface)]/98 backdrop-blur-md border-t border-[var(--ps-border)] px-1 pb-[env(safe-area-inset-bottom)] flex items-center justify-around"
        >
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeNav === item.id && !fullPageListingId;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleActivateNavDestination(item.id)}
                title={item.label}
                aria-label={item.label}
                aria-current={isActive ? 'page' : undefined}
                data-testid={`mobile-nav-${item.id}`}
                className={`relative flex-1 h-full flex flex-col items-center justify-center gap-0.5 rounded-xl transition-colors min-w-0 ${
                  isActive
                    ? 'text-[var(--ps-accent)] font-bold'
                    : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] font-medium'
                }`}
              >
                <div className="relative">
                  <Icon className="w-4 h-4" />
                  {item.badge !== undefined && (
                    <span className="absolute -top-1.5 -right-2.5 min-w-[14px] h-[14px] px-1 rounded-full bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-[9px] font-bold flex items-center justify-center">
                      {item.badge}
                    </span>
                  )}
                </div>
                <span className="text-[10px] leading-tight truncate max-w-full">
                  {item.label}
                </span>
              </button>
            );
          })}
        </nav>
      )}

      {/* Theme, Map Style & Area Unit Modal */}
      <ThemeSettingsModal
        open={isThemeModalOpen}
        onClose={() => setIsThemeModalOpen(false)}
      />

      {/* Reset Demo Data Confirmation Modal */}
      {isResetModalOpen && (
        <div
          ref={resetModalRef}
          tabIndex={-1}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 outline-none"
          role="dialog"
          aria-modal="true"
          aria-labelledby="reset-demo-modal-title"
          data-testid="reset-demo-modal"
        >
          <div className="w-full max-w-md rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 shadow-2xl">
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

      {/* Floating Contextual Read-Only Help Assistant (shown on non-Explore pages so it never overlaps map/sidebar controls) */}
      {!isFullscreenMap && activeNav !== 'explore' && <PrintSwiftAssistant />}
    </div>
  );
}

export default function AppShell({ apiKey }: { apiKey: string }) {
  return (
    <AppProvider>
      {apiKey && apiKey.trim().length > 5 ? (
        <APIProvider
          apiKey={apiKey}
          libraries={['marker', 'geometry', 'places', 'routes']}
        >
          <AppShellInner apiKey={apiKey} />
        </APIProvider>
      ) : (
        <AppShellInner apiKey="" />
      )}
    </AppProvider>
  );
}
