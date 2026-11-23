'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BedDouble,
  Briefcase,
  Building2,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronUp,
  Compass,
  Crosshair,
  GripVertical,
  Home,
  Info,
  Landmark,
  Layers,
  Loader2,
  LocateFixed,
  MapPin,
  Maximize2,
  Minimize2,
  Minus,
  Moon,
  Move,
  Package,
  Palette,
  PenTool,
  Plus,
  Printer,
  Ruler,
  ShoppingBag,
  Sliders,
  Sparkles,
  Sun,
  Trophy,
  Utensils,
  Wrench,
} from 'lucide-react';
import {
  BaseMapType,
  ListingCategory,
  MapAppearanceVariant,
  MapStyleOption,
  MapToolbarPosition,
  MobileSheetState,
} from '@/lib/types';
import { CATEGORY_LABELS } from '@/lib/rules';
import {
  EXPLORE_MAP_PRESETS,
  useExploreMapPreset,
  useSimpleMode,
} from '@/lib/store';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import {
  DEFAULT_EDGE_MARGIN,
  FLOATING_DOCK_SPRING_TRANSITION,
  FLOATING_DOCK_SYNC_EVENT,
  computeMiddleDockBand,
  resolveCollisionFreeDockPosition,
  unregisterFloatingDockSlot,
  type FloatingDockPersistedState,
  type FloatingDockSide,
} from '@/lib/map/floating-dock';

const TOOLBAR_STORAGE_KEY = 'printswift_local_map_toolbar_pos_v1';
const TOOLBAR_DOCK_STORAGE_KEY = 'ddoodle_map_toolbar_dock_v8';
const TOOLBAR_PREV_DOCK_STORAGE_KEY = 'ddoodle_map_toolbar_dock_v7';
const TOOLBAR_COLLAPSED_STORAGE_KEY = 'printswift_local_map_toolbar_collapsed_v1';
const TOOLBAR_DRAG_THRESHOLD_PX = 8;

function resolveStationaryMapContainer(
  refEl: HTMLElement | null
): HTMLElement | null {
  if (!refEl) return null;
  const stationary = refEl.closest<HTMLElement>(
    '[data-testid="explore-map-viewport"]'
  );
  return stationary || refEl;
}

const POSITION_LABELS: Record<MapToolbarPosition, string> = {
  'top-left': 'Top Left',
  'top-center': 'Top Centre',
  'top-right': 'Top Right',
  'bottom-left': 'Bottom Left',
  'bottom-center': 'Bottom Centre',
  'bottom-right': 'Bottom Right',
};

const CATEGORY_COLORS: Record<ListingCategory, string> = {
  business: '#0284c7',
  service: '#7c3aed',
  real_estate: '#059669',
  sports: '#ea580c',
  public_place: '#dc2626',
};

interface DynamicCategoryRow {
  id: string;
  name: string;
  slug?: string | null;
  type?: string | null;
  color_bg?: string | null;
}

function CategoryIcon({
  category,
  className = 'w-3.5 h-3.5',
}: {
  category: ListingCategory;
  className?: string;
}) {
  switch (category) {
    case 'business':
      return <Briefcase className={className} />;
    case 'service':
      return <Wrench className={className} />;
    case 'real_estate':
      return <Home className={className} />;
    case 'sports':
      return <Trophy className={className} />;
    case 'public_place':
      return <Landmark className={className} />;
    default:
      return <Building2 className={className} />;
  }
}

interface FloatingMapToolbarProps {
  mapViewportRef: React.RefObject<HTMLDivElement | null>;
  mapAppearance: MapAppearanceVariant;
  onChangeMapAppearance: (variant: MapAppearanceVariant) => void;
  baseMapType: BaseMapType;
  onChangeBaseMapType: (style: MapStyleOption) => void;
  useVectorStylePreview: boolean;
  onToggleVectorStylePreview: () => void;
  onOpenCloudConfigModal: () => void;
  isDrawToolboxOpen: boolean;
  onToggleDrawToolbox: () => void;
  drawnShapesCount: number;
  isFullscreenMap: boolean;
  onToggleFullscreenMap: () => void;
  onRecenter: () => void;
  onLocateMe: () => void;
  isLocating?: boolean;
  hasCustomDefaultCenter?: boolean;
  onZoomIn: () => void;
  onZoomOut: () => void;
  mobileBottomOffsetClass?: string;
  mobileSheetState?: MobileSheetState;
  showCivicPins?: boolean;
  onToggleCivicPins?: () => void;
  verifiedBoostedOnly?: boolean;
  onToggleVerifiedBoostedOnly?: () => void;
  selectedVertical?: string;
  showBasePoiIcons?: boolean;
  onToggleBasePoiIcons?: () => void;
  hideOtherVerticalPins?: boolean;
  onToggleHideOtherVerticalPins?: () => void;
  hideAllListingPins?: boolean;
  onToggleHideAllListingPins?: () => void;
  showCustomUserMarkers?: boolean;
  onToggleShowCustomUserMarkers?: () => void;
  onLocateNearestEmergency?: () => void;
  activeVerticalAttributes?: string[];
  onToggleVerticalAttribute?: (attrKey: string) => void;
  isMobileLandscape?: boolean;
  isSplitScreen?: boolean;
  hasSelectedListing?: boolean;
  hasActivePolygonEdits?: boolean;
  isHidden?: boolean;
  onPositionChange?: (pos: MapToolbarPosition) => void;
  isPickNDropOpen?: boolean;
  onTogglePickNDrop?: () => void;
}

export function FloatingMapToolbar({
  mapViewportRef,
  mapAppearance,
  onChangeMapAppearance,
  baseMapType,
  onChangeBaseMapType,
  useVectorStylePreview,
  onToggleVectorStylePreview,
  onOpenCloudConfigModal,
  isDrawToolboxOpen,
  onToggleDrawToolbox,
  drawnShapesCount,
  isFullscreenMap,
  onToggleFullscreenMap,
  onRecenter,
  onLocateMe,
  isLocating = false,
  hasCustomDefaultCenter = false,
  onZoomIn,
  onZoomOut,
  mobileSheetState = 'partial',
  isMobileLandscape = false,
  isSplitScreen = false,
  hasSelectedListing = false,
  hasActivePolygonEdits = false,
  isHidden = false,
  onPositionChange,
  isPickNDropOpen = false,
  onTogglePickNDrop,
  showCivicPins = true,
  onToggleCivicPins,
  verifiedBoostedOnly = false,
  onToggleVerifiedBoostedOnly,
  selectedVertical = 'all',
  showBasePoiIcons = true,
  onToggleBasePoiIcons,
  hideOtherVerticalPins = false,
  onToggleHideOtherVerticalPins,
  hideAllListingPins = false,
  onToggleHideAllListingPins,
  showCustomUserMarkers = true,
  onToggleShowCustomUserMarkers,
  onLocateNearestEmergency,
  activeVerticalAttributes = [],
  onToggleVerticalAttribute,
}: FloatingMapToolbarProps) {
  const [simpleMode] = useSimpleMode();
  const [exploreMapPreset, setExploreMapPreset] = useExploreMapPreset();
  const [position, setPosition] = useState<MapToolbarPosition>('top-right');
  const [isCollapsed, setIsCollapsed] = useState<boolean>(true);
  const [activePopover, setActivePopover] = useState<
    'preset' | 'style' | 'basemap' | 'legend' | 'position' | null
  >(null);
  const [categories, setCategories] = useState<DynamicCategoryRow[]>([]);
  const [isLoadingCategories, setIsLoadingCategories] = useState<boolean>(true);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
  const dragSuppressClickRef = useRef<boolean>(false);

  const dockRef = useRef<FloatingDockPersistedState>({
    side: 'right',
    yRatio: 0.42,
  });
  const [dockState, setDockState] = useState<FloatingDockPersistedState>({
    side: 'right',
    yRatio: 0.42,
  });
  const [coords, setCoords] = useState<{ x: number; y: number }>({
    x: 320,
    y: 280,
  });
  const coordsRef = useRef<{ x: number; y: number }>({ x: 320, y: 280 });
  const [isDragging, setIsDragging] = useState(false);

  const dragSessionRef = useRef<{
    active: boolean;
    pointerId: number | null;
    startClientX: number;
    startClientY: number;
    originX: number;
    originY: number;
    moved: boolean;
  }>({
    active: false,
    pointerId: null,
    startClientX: 0,
    startClientY: 0,
    originX: 320,
    originY: 280,
    moved: false,
  });

  // Fetch live categories from Supabase categories table
  useEffect(() => {
    let active = true;
    async function loadCategories() {
      if (!isSupabaseConfigured()) {
        if (active) setIsLoadingCategories(false);
        return;
      }
      setIsLoadingCategories(true);
      try {
        const { data, error } = await supabase.from('categories').select('*');
        if (!error && Array.isArray(data) && active) {
          setCategories(data as DynamicCategoryRow[]);
        }
      } catch {
        // Fallback safely if fetch fails
      } finally {
        if (active) setIsLoadingCategories(false);
      }
    }
    void loadCategories();
    return () => {
      active = false;
    };
  }, []);

  const computeAndCommitDock = useCallback(
    (
      targetDock: FloatingDockPersistedState,
      explicitLocalY?: number,
      commitSlot = true
    ) => {
      const container = resolveStationaryMapContainer(mapViewportRef.current);
      const el = toolbarRef.current;
      const vh =
        typeof window !== 'undefined' && window.innerHeight > 0
          ? window.innerHeight
          : container?.clientHeight || 720;
      const containerW =
        container?.clientWidth ||
        (typeof window !== 'undefined' ? window.innerWidth : 360);
      const containerH = container?.clientHeight || vh;
      const ctrlW = el?.offsetWidth || (isCollapsed ? 40 : 48);
      const ctrlH = el?.offsetHeight || (isCollapsed ? 40 : 210);

      const resolved = resolveCollisionFreeDockPosition(
        {
          id: 'map-toolbox',
          side: targetDock.side,
          desiredLocalY: explicitLocalY,
          bandRatio: targetDock.yRatio,
          controlWidth: ctrlW,
          controlHeight: ctrlH,
          containerWidth: containerW,
          containerHeight: containerH,
          viewportHeight: vh,
          containerViewportTop: 0,
        },
        commitSlot
      );

      coordsRef.current = { x: resolved.x, y: resolved.y };
      setDockState((prev) =>
        prev.side === targetDock.side && prev.yRatio === resolved.yRatio
          ? prev
          : { side: targetDock.side, yRatio: resolved.yRatio }
      );
      setCoords((prev) =>
        prev.x === resolved.x && prev.y === resolved.y
          ? prev
          : { x: resolved.x, y: resolved.y }
      );
      return resolved;
    },
    [mapViewportRef, isCollapsed]
  );

  // Hydrate persisted toolbar position & collapse state after mount so SSR and initial client render match
  useEffect(() => {
    const host = resolveStationaryMapContainer(mapViewportRef.current);
    setPortalHost(host);

    let initialCollapsed = true;
    try {
      const savedPos = localStorage.getItem(
        TOOLBAR_STORAGE_KEY
      ) as MapToolbarPosition | null;
      if (savedPos && POSITION_LABELS[savedPos]) {
        setPosition(savedPos);
        onPositionChange?.(savedPos);
      }

      const savedDockRaw =
        localStorage.getItem(TOOLBAR_DOCK_STORAGE_KEY) ||
        localStorage.getItem(TOOLBAR_PREV_DOCK_STORAGE_KEY);
      if (savedDockRaw) {
        const parsed = JSON.parse(savedDockRaw) as Partial<FloatingDockPersistedState>;
        dockRef.current = {
          side: parsed.side === 'left' ? 'left' : 'right',
          yRatio:
            typeof parsed.yRatio === 'number' && Number.isFinite(parsed.yRatio)
              ? Math.max(0, Math.min(1, parsed.yRatio))
              : 0.42,
        };
      } else if (savedPos) {
        dockRef.current = {
          side: savedPos.endsWith('left') ? 'left' : 'right',
          yRatio: savedPos.startsWith('bottom') ? 0.68 : 0.35,
        };
      }

      const savedCollapsed = localStorage.getItem(
        TOOLBAR_COLLAPSED_STORAGE_KEY
      );
      if (savedCollapsed === 'true' || savedCollapsed === 'false') {
        initialCollapsed = savedCollapsed === 'true';
      } else if (typeof window !== 'undefined' && window.innerWidth >= 1024) {
        initialCollapsed = false;
      }
      setIsCollapsed(initialCollapsed);
    } catch {
      // ignore storage access errors
    }

    const syncDock = () => {
      if (dragSessionRef.current.active) return;
      computeAndCommitDock(dockRef.current, undefined, true);
    };

    const rafId = window.requestAnimationFrame(syncDock);

    const handlePeerSync = (ev: Event) => {
      const detail = (ev as CustomEvent<{ sourceId?: string }>).detail;
      if (detail?.sourceId === 'map-toolbox') return;
      if (dragSessionRef.current.active) return;
      computeAndCommitDock(dockRef.current, undefined, false);
    };

    window.addEventListener('resize', syncDock);
    window.addEventListener('orientationchange', syncDock);
    window.addEventListener(FLOATING_DOCK_SYNC_EVENT, handlePeerSync);

    let ro: ResizeObserver | null = null;
    if (host && typeof ResizeObserver !== 'undefined') {
      let lastW = host.clientWidth;
      let lastH = host.clientHeight;
      ro = new ResizeObserver(() => {
        const nextW = host.clientWidth;
        const nextH = host.clientHeight;
        if (Math.abs(nextW - lastW) > 2 || Math.abs(nextH - lastH) > 2) {
          lastW = nextW;
          lastH = nextH;
          syncDock();
        }
      });
      ro.observe(host);
    }

    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener('resize', syncDock);
      window.removeEventListener('orientationchange', syncDock);
      window.removeEventListener(FLOATING_DOCK_SYNC_EVENT, handlePeerSync);
      ro?.disconnect();
      unregisterFloatingDockSlot('map-toolbox');
    };
  }, [onPositionChange, computeAndCommitDock, mapViewportRef]);

  useEffect(() => {
    if (dragSessionRef.current.active) return;
    const timer = window.setTimeout(() => {
      computeAndCommitDock(dockRef.current, undefined, true);
    }, 24);
    return () => window.clearTimeout(timer);
  }, [isCollapsed, computeAndCommitDock]);

  const updateToolbarPosition = (nextPos: MapToolbarPosition) => {
    setPosition(nextPos);
    onPositionChange?.(nextPos);
    const nextSide: FloatingDockSide = nextPos.endsWith('left')
      ? 'left'
      : 'right';
    const nextYRatio = nextPos.startsWith('bottom') ? 0.78 : 0.18;
    const nextDock: FloatingDockPersistedState = {
      side: nextSide,
      yRatio: nextYRatio,
    };
    dockRef.current = nextDock;
    computeAndCommitDock(nextDock);
    try {
      localStorage.setItem(TOOLBAR_STORAGE_KEY, nextPos);
      localStorage.setItem(TOOLBAR_DOCK_STORAGE_KEY, JSON.stringify(nextDock));
    } catch {
      // ignore
    }
  };

  const updateCollapsedState = (nextCollapsed: boolean) => {
    setIsCollapsed(nextCollapsed);
    if (nextCollapsed) {
      setActivePopover(null);
    }
    try {
      localStorage.setItem(
        TOOLBAR_COLLAPSED_STORAGE_KEY,
        nextCollapsed ? 'true' : 'false'
      );
    } catch {
      // ignore
    }
  };

  // Close open popover when clicking outside toolbar or pressing Escape
  useEffect(() => {
    if (!activePopover) return;
    const handleOutside = (ev: MouseEvent) => {
      if (
        toolbarRef.current &&
        !toolbarRef.current.contains(ev.target as Node)
      ) {
        setActivePopover(null);
      }
    };
    const handleKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        setActivePopover(null);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [activePopover]);

  const handleToolbarPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.stopPropagation();
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // Do not start dragging when interacting with inner popover content
    const targetEl = e.target as HTMLElement | null;
    if (targetEl?.closest('[role="dialog"]')) return;

    dragSessionRef.current = {
      active: true,
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      originX: coordsRef.current.x,
      originY: coordsRef.current.y,
      moved: false,
    };
  };

  const handleToolbarPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    const session = dragSessionRef.current;
    if (!session.active || session.pointerId !== e.pointerId) return;
    e.stopPropagation();

    const dx = e.clientX - session.startClientX;
    const dy = e.clientY - session.startClientY;

    if (!session.moved) {
      if (Math.hypot(dx, dy) < TOOLBAR_DRAG_THRESHOLD_PX) {
        return;
      }
      session.moved = true;
      dragSuppressClickRef.current = true;
      setIsDragging(true);
      setActivePopover(null);
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }

    const container = resolveStationaryMapContainer(mapViewportRef.current);
    const el = toolbarRef.current;
    const vh =
      typeof window !== 'undefined' && window.innerHeight > 0
        ? window.innerHeight
        : container?.clientHeight || 720;
    const containerW = container?.clientWidth || 360;
    const ctrlW = el?.offsetWidth || 44;
    const ctrlH = el?.offsetHeight || 44;
    const band = computeMiddleDockBand(vh, ctrlH);

    const nextX = Math.max(
      DEFAULT_EDGE_MARGIN,
      Math.min(containerW - ctrlW - DEFAULT_EDGE_MARGIN, session.originX + dx)
    );
    const nextY = Math.max(
      band.minY,
      Math.min(band.maxY, session.originY + dy)
    );

    const nextCoords = { x: Math.round(nextX), y: Math.round(nextY) };
    coordsRef.current = nextCoords;
    setCoords(nextCoords);
  };

  const finishToolbarPointer = (e: React.PointerEvent<HTMLDivElement>) => {
    const session = dragSessionRef.current;
    if (!session.active || session.pointerId !== e.pointerId) return;
    e.stopPropagation();

    try {
      if (e.currentTarget.hasPointerCapture(e.pointerId)) {
        e.currentTarget.releasePointerCapture(e.pointerId);
      }
    } catch {
      // ignore
    }

    const wasMoved = session.moved;
    session.active = false;
    session.pointerId = null;
    session.moved = false;
    setIsDragging(false);

    if (!wasMoved) {
      return;
    }

    window.setTimeout(() => {
      dragSuppressClickRef.current = false;
    }, 160);

    const container = resolveStationaryMapContainer(mapViewportRef.current);
    const el = toolbarRef.current;
    const containerW = container?.clientWidth || 360;
    const ctrlW = el?.offsetWidth || 44;
    const centerX = coordsRef.current.x + ctrlW / 2;
    const nextSide: FloatingDockSide =
      centerX < containerW / 2 ? 'left' : 'right';

    const resolved = computeAndCommitDock(
      { side: nextSide, yRatio: dockRef.current.yRatio },
      coordsRef.current.y,
      true
    );

    const nextDock: FloatingDockPersistedState = {
      side: resolved.side,
      yRatio: resolved.yRatio,
    };
    dockRef.current = nextDock;
    const mappedPosition: MapToolbarPosition =
      resolved.side === 'left'
        ? resolved.yRatio > 0.55
          ? 'bottom-left'
          : 'top-left'
        : resolved.yRatio > 0.55
          ? 'bottom-right'
          : 'top-right';
    setPosition(mappedPosition);
    onPositionChange?.(mappedPosition);

    try {
      localStorage.setItem(TOOLBAR_STORAGE_KEY, mappedPosition);
      localStorage.setItem(TOOLBAR_DOCK_STORAGE_KEY, JSON.stringify(nextDock));
    } catch {
      // ignore
    }
  };

  const isHorizontalLayout =
    position === 'top-center' ||
    position === 'bottom-center' ||
    isMobileLandscape;

  // When mobile bottom sheet is expanded (78% height), force horizontal compact flow on <lg
  // so an expanded toolbar at top-left/top-right never overlaps the sheet below
  const forceCompactMobileRow = mobileSheetState === 'expanded';

  // Compute maximum width containment relative to explore-map-viewport
  const getMaxWidthClasses = (): string => {
    if (isCollapsed) return '';
    if (isMobileLandscape) {
      if (position === 'top-center' || position === 'bottom-center') {
        return 'max-w-[calc(100%-20px)]';
      }
      return isDrawToolboxOpen
        ? 'max-w-[calc(100%-300px)]'
        : 'max-w-[calc(100%-76px)]';
    }
    return 'max-w-[calc(100%-20px)]';
  };

  // Compute maximum height containment relative to explore-map-viewport so vertical toolbars
  // never overflow into bottom sheets, floating selected-listing cards, or map attribution
  const getMaxHeightClasses = (): string => {
    if (isCollapsed) return '';
    if (isHorizontalLayout) {
      return 'max-h-[calc(100%-20px)]';
    }
    if (forceCompactMobileRow) {
      return 'max-h-[calc(20%-12px)] lg:max-h-[calc(100%-36px)]';
    }
    if (isFullscreenMap) {
      if (hasSelectedListing) {
        return position.endsWith('left')
          ? 'max-h-[calc(100%-236px)]'
          : 'max-h-[calc(100%-224px)] sm:max-h-[calc(100%-36px)]';
      }
      return 'max-h-[calc(100%-36px)]';
    }
    if (isSplitScreen) {
      if (hasSelectedListing && position.endsWith('left')) {
        return 'max-h-[calc(100%-240px)]';
      }
      return 'max-h-[calc(100%-36px)]';
    }
    // Portrait bottom-sheet layout (mobile-portrait 390x844 and tablet-portrait 768x1024)
    if (hasSelectedListing && mobileSheetState === 'collapsed') {
      return 'max-h-[calc(100%-296px)] sm:max-h-[calc(100%-312px)] lg:max-h-[calc(100%-36px)]';
    }
    if (mobileSheetState === 'partial') {
      return 'max-h-[calc(57%-76px)] lg:max-h-[calc(100%-36px)]';
    }
    return 'max-h-[calc(100%-156px)] lg:max-h-[calc(100%-36px)]';
  };

  const getPopoverAlignClasses = (): string => {
    const openUpward =
      position.startsWith('bottom') || dockState.yRatio > 0.55;
    const isRightSide = dockState.side === 'right';

    // When toolbar is rendered horizontally, open popover directly below/above the horizontal strip
    if (isHorizontalLayout) {
      const verticalPos = openUpward ? 'bottom-full mb-2' : 'top-full mt-2';
      if (isRightSide) {
        return `${verticalPos} right-0`;
      }
      return `${verticalPos} left-0`;
    }

    // When toolbar is rendered vertically on the left or right edge, open popover inward
    // to the side of the vertical bar so it stays inside the open map viewport
    const sidePos = isRightSide ? 'right-full mr-2' : 'left-full ml-2';
    const vertEdge = openUpward ? 'bottom-0' : 'top-0';

    if (forceCompactMobileRow) {
      const mobileVert = openUpward ? 'bottom-full mb-2' : 'top-full mt-2';
      const mobileHoriz = isRightSide ? 'right-0' : 'left-0';
      return `${mobileVert} ${mobileHoriz} lg:top-0 lg:bottom-auto lg:mt-0 lg:mb-0 ${
        isRightSide
          ? 'lg:right-full lg:left-auto lg:mr-2'
          : 'lg:left-full lg:right-auto lg:ml-2'
      }`;
    }

    return `${vertEdge} ${sidePos}`;
  };

  const btnSizeClass =
    'w-9 h-9 flex items-center justify-center shrink-0 rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)]';
  const toolbarIconClass = 'w-4 h-4 shrink-0';
  const showEditTools =
    !simpleMode &&
    (hasActivePolygonEdits || isDrawToolboxOpen || drawnShapesCount > 0);

  const toolbarNode = (
    <div
      ref={toolbarRef}
      data-testid="floating-map-toolbar"
      data-tour="explore-toolbox"
      data-position={position}
      data-dock-side={dockState.side}
      data-collapsed={isCollapsed ? 'true' : 'false'}
      style={{
        left: `${coords.x}px`,
        top: `${coords.y}px`,
        touchAction: 'none',
        transition: isDragging ? 'none' : FLOATING_DOCK_SPRING_TRANSITION,
        willChange: 'left, top',
      }}
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={handleToolbarPointerDown}
      onPointerMove={handleToolbarPointerMove}
      onPointerUp={finishToolbarPointer}
      onPointerCancel={finishToolbarPointer}
      className={`absolute z-[28] flex flex-col pointer-events-auto select-none ${
        isDragging ? 'cursor-grabbing scale-[1.02]' : 'cursor-grab'
      } ${getMaxWidthClasses()} ${getMaxHeightClasses()}`}
      role="toolbar"
      aria-label="Floating map utilities toolbar"
    >
      <div className="flex flex-col min-h-0 max-h-full">
      {isCollapsed && !simpleMode ? (
        /* COLLAPSED STATE: Single ultra-slim map-tools icon (clickable to expand, draggable to reposition) */
        <button
          type="button"
          onClick={() => {
            if (dragSuppressClickRef.current) return;
            updateCollapsedState(false);
          }}
          title={
            drawnShapesCount > 0
              ? `Expand Map Tools (${POSITION_LABELS[position]}, ${drawnShapesCount} ${drawnShapesCount === 1 ? 'drawing' : 'drawings'}) — Click to open or drag to dock`
              : `Expand Map Tools (${POSITION_LABELS[position]}) — Click to open or drag to dock`
          }
          aria-label={
            drawnShapesCount > 0
              ? `Expand floating map tools (${drawnShapesCount} ${drawnShapesCount === 1 ? 'drawing' : 'drawings'})`
              : 'Expand floating map tools'
          }
          aria-expanded={false}
          data-testid="map-toolbar-expand-btn"
          className="w-10 h-10 relative flex items-center justify-center shrink-0 rounded-2xl bg-[var(--ps-surface)]/92 backdrop-blur-md border border-[var(--ps-border)] shadow-lg text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] hover:border-[var(--ps-accent)]/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)] transition-all"
        >
          <Sliders className="w-4 h-4 shrink-0 text-[var(--ps-accent)]" />
          {drawnShapesCount > 0 && (
            <span
              data-testid="map-toolbar-collapsed-draw-count-badge"
              className="absolute -top-1 -right-1 min-w-[14px] h-[14px] px-1 rounded-full bg-emerald-600 text-white text-[9px] font-bold flex items-center justify-center"
            >
              {drawnShapesCount}
            </span>
          )}
        </button>
      ) : (
        /* EXPANDED STATE: Phase 57-B 3-zone layout (Pinned Drag Handle | Scrollable Tool Buttons | Pinned Collapse Chevron) */
        <div
          data-testid="map-toolbar-expanded-bar"
          className={`flex ${
            isHorizontalLayout
              ? 'flex-row flex-nowrap items-center min-w-0 max-w-full overflow-hidden'
              : forceCompactMobileRow
                ? 'flex-row flex-nowrap lg:flex-col items-center min-w-0 max-w-full lg:min-h-0 lg:max-h-[65dvh] overflow-hidden'
                : 'flex-col items-center min-h-0 max-h-[65dvh] overflow-hidden'
          } p-1 rounded-2xl bg-[var(--ps-surface)]/92 backdrop-blur-md border border-[var(--ps-border)] shadow-lg`}
        >
          {/* ZONE 1: Pinned Drag Handle (fixed outside scrollable region) */}
          {!simpleMode && (
            <div
              className={`shrink-0 flex items-center justify-center ${
                isHorizontalLayout
                  ? 'pr-1 border-r border-slate-200/80 dark:border-slate-700/80'
                  : forceCompactMobileRow
                    ? 'pr-1 border-r lg:pr-0 lg:border-r-0 lg:pb-1 lg:border-b border-slate-200/80 dark:border-slate-700/80'
                    : 'pb-1 border-b border-slate-200/80 dark:border-slate-700/80'
              }`}
            >
              <button
                type="button"
                onClick={() => {
                  if (dragSuppressClickRef.current) return;
                  setActivePopover((prev) =>
                    prev === 'position' ? null : 'position'
                  );
                }}
                title={`Move Map Toolbar (${POSITION_LABELS[position]}) — Drag handle or click for position menu`}
                aria-label={`Reposition floating map toolbar (currently ${POSITION_LABELS[position]})`}
                aria-expanded={activePopover === 'position'}
                data-testid="map-toolbar-position-btn"
                className={`${btnSizeClass} ${
                  activePopover === 'position'
                    ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                    : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                } touch-none select-none cursor-grab active:cursor-grabbing`}
              >
                <GripVertical className={toolbarIconClass} />
              </button>
            </div>
          )}

          {/* ZONE 2: Scrollable Tool Buttons Area (ONLY map action buttons scroll here) */}
          <div
            data-testid="map-toolbar-scroll-area"
            className={`flex-1 ${
              isHorizontalLayout
                ? 'min-w-0 overflow-x-auto overflow-y-hidden overscroll-x-contain no-scrollbar flex flex-row flex-nowrap items-center gap-1 px-1'
                : forceCompactMobileRow
                  ? 'min-w-0 lg:min-w-fit lg:min-h-0 overflow-x-auto overflow-y-hidden lg:overflow-x-hidden lg:overflow-y-auto overscroll-contain no-scrollbar flex flex-row flex-nowrap lg:flex-col items-center gap-1 px-1 lg:px-0 lg:py-1'
                  : 'min-h-0 overflow-y-auto overflow-x-hidden overscroll-y-contain no-scrollbar flex flex-col items-center gap-1 py-1'
            }`}
          >
            {!simpleMode && showEditTools && (
              <button
                type="button"
                onClick={() => {
                  if (dragSuppressClickRef.current) return;
                  setActivePopover(null);
                  onToggleDrawToolbox();
                }}
                title={
                  drawnShapesCount > 0
                    ? `Active Polygon Edit & Measure (${drawnShapesCount} ${drawnShapesCount === 1 ? 'drawing' : 'drawings'})`
                    : 'Active Polygon Edit & Measure'
                }
                aria-label={
                  drawnShapesCount > 0
                    ? `Toggle Draw and Measure toolbox (${drawnShapesCount} ${drawnShapesCount === 1 ? 'drawing' : 'drawings'})`
                    : 'Toggle Draw and Measure toolbox'
                }
                aria-pressed={isDrawToolboxOpen}
                data-testid="map-toolbar-draw-btn"
                className={`relative ${btnSizeClass} ${
                  isDrawToolboxOpen || hasActivePolygonEdits
                    ? 'bg-amber-500 text-slate-950 font-bold ring-1 ring-amber-400'
                    : 'text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                }`}
              >
                <PenTool className={toolbarIconClass} />
                {drawnShapesCount > 0 && (
                  <span
                    data-testid="map-toolbar-draw-count-badge"
                    className="absolute -top-0.5 -right-0.5 min-w-[13px] h-[13px] px-0.5 rounded-full bg-emerald-600 text-white text-[8px] font-bold flex items-center justify-center"
                  >
                    {drawnShapesCount}
                  </span>
                )}
              </button>
            )}

            {/* Pass V6-B: 4-Preset Explore Map Experience Quick Switcher (always accessible) */}
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() =>
                setActivePopover((prev) => (prev === 'preset' ? null : 'preset'))
              }
              title={`Map Preset: ${
                EXPLORE_MAP_PRESETS.find((p) => p.id === exploreMapPreset)?.label ||
                'Everyday Discovery'
              }`}
              aria-label="Switch explore map experience preset"
              aria-expanded={activePopover === 'preset'}
              data-testid="map-toolbar-preset-btn"
              className={`${btnSizeClass} ${
                activePopover === 'preset' || exploreMapPreset !== 'everyday'
                  ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                  : 'text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
              }`}
            >
              {exploreMapPreset === 'property_hunter' ? (
                <Home className={toolbarIconClass} />
              ) : exploreMapPreset === 'pro_survey' ? (
                <Ruler className={toolbarIconClass} />
              ) : exploreMapPreset === 'clean_focus' ? (
                <Sparkles className={toolbarIconClass} />
              ) : (
                <Compass className={toolbarIconClass} />
              )}
            </button>

            {!simpleMode && (
              <>
                {/* Map Style Popover Trigger (Neutral Light / Midnight Dark) */}
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() =>
                    setActivePopover((prev) => (prev === 'style' ? null : 'style'))
                  }
                  title={`Map Appearance: ${
                    mapAppearance === 'dark'
                      ? 'DD oodle Midnight Discovery (Dark)'
                      : 'DD oodle Neutral Discovery (Light)'
                  }`}
                  aria-label="Map style appearance"
                  aria-expanded={activePopover === 'style'}
                  data-testid="map-toolbar-style-btn"
                  className={`${btnSizeClass} ${
                    activePopover === 'style'
                      ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                      : 'text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                  }`}
                >
                  {mapAppearance === 'dark' ? (
                    <Moon className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                  ) : (
                    <Sun className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  )}
                </button>

                {/* Base Map Type Popover Trigger */}
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() =>
                    setActivePopover((prev) =>
                      prev === 'basemap' ? null : 'basemap'
                    )
                  }
                  title={`Base Map Type: ${baseMapType.toUpperCase()}`}
                  aria-label="Select base map type"
                  aria-expanded={activePopover === 'basemap'}
                  data-testid="map-toolbar-basemap-btn"
                  className={`${btnSizeClass} ${
                    activePopover === 'basemap'
                      ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                      : 'text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                  }`}
                >
                  <Layers className={toolbarIconClass} />
                </button>
              </>
            )}

            {/* Marker Legend Popover Trigger */}
            <button
              type="button"
              onPointerDown={(e) => e.stopPropagation()}
              onClick={() =>
                setActivePopover((prev) => (prev === 'legend' ? null : 'legend'))
              }
              title="Map Marker Legend"
              aria-label="Open map marker legend"
              aria-expanded={activePopover === 'legend'}
              data-testid="map-toolbar-legend-btn"
              className={`${btnSizeClass} ${
                activePopover === 'legend'
                  ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                  : 'text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
              }`}
            >
              <Info className={toolbarIconClass} />
            </button>

            {!simpleMode && (
              <>
                {/* Divider */}
                <div
                  className={
                    isHorizontalLayout
                      ? 'w-px h-4 bg-[var(--ps-border)] mx-0.5 shrink-0'
                      : forceCompactMobileRow
                        ? 'w-px h-4 mx-0.5 lg:w-4 lg:h-px lg:mx-0 lg:my-0.5 bg-[var(--ps-border)] shrink-0'
                        : 'h-px w-4 bg-[var(--ps-border)] my-0.5 shrink-0'
                  }
                />

                {/* Zoom In */}
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={onZoomIn}
                  title="Zoom in"
                  aria-label="Zoom in"
                  data-testid="map-toolbar-zoom-in-btn"
                  className={`${btnSizeClass} text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]`}
                >
                  <Plus className={toolbarIconClass} />
                </button>

                {/* Zoom Out */}
                <button
                  type="button"
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={onZoomOut}
                  title="Zoom out"
                  aria-label="Zoom out"
                  data-testid="map-toolbar-zoom-out-btn"
                  className={`${btnSizeClass} text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]`}
                >
                  <Minus className={toolbarIconClass} />
                </button>
              </>
            )}
          </div>

          {/* ZONE 3: Pinned Collapse Chevron (STRICTLY outside scrollable region so always visible) */}
          {!simpleMode && (
            <div
              className={`shrink-0 flex items-center justify-center ${
                isHorizontalLayout
                  ? 'border-l border-slate-200/80 dark:border-slate-700/80 pl-1'
                  : forceCompactMobileRow
                    ? 'border-l pl-1 lg:border-l-0 lg:pl-0 lg:border-t lg:pt-1 border-slate-200/80 dark:border-slate-700/80'
                    : 'border-t border-slate-200/80 dark:border-slate-700/80 pt-1'
              }`}
            >
              <button
                type="button"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => updateCollapsedState(true)}
                title="Collapse Map Tools into compact icon"
                aria-label="Collapse floating map tools"
                aria-expanded={true}
                data-testid="map-toolbar-collapse-btn"
                className="w-8 h-8 flex items-center justify-center shrink-0 rounded-lg text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)]"
              >
                {isHorizontalLayout ? (
                  <ChevronUp className={toolbarIconClass} />
                ) : (
                  <ChevronDown className="w-4 h-4 rotate-180 shrink-0" />
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Popover: Pass V6-B 4-Preset Explore Map Experience Switcher */}
      {!isCollapsed && activePopover === 'preset' && (
        <div
          data-testid="map-toolbar-preset-popover"
          className={`absolute ${getPopoverAlignClasses()} w-64 sm:w-72 max-w-[calc(100vw-84px)] ${
            isMobileLandscape
              ? 'max-h-[160px]'
              : 'max-h-[min(22rem,calc(100dvh-160px))]'
          } overflow-y-auto overscroll-contain rounded-2xl bg-[var(--ps-surface)] border border-[var(--ps-border)] shadow-2xl p-3 space-y-2 text-xs z-40 ps-animate-in-popover`}
          role="dialog"
          aria-label="Explore map experience presets"
        >
          <div className="flex items-center justify-between gap-2 pb-1 border-b border-[var(--ps-border)]">
            <span className="font-bold text-[var(--ps-text)]">
              Map Experience Preset
            </span>
            <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-accent)]">
              4 Modes
            </span>
          </div>
          <div className="space-y-1.5">
            {EXPLORE_MAP_PRESETS.map((preset) => {
              const isActive = exploreMapPreset === preset.id;
              const PresetIcon =
                preset.id === 'everyday'
                  ? Compass
                  : preset.id === 'clean_focus'
                    ? Sparkles
                    : preset.id === 'property_hunter'
                      ? Home
                      : Ruler;
              return (
                <button
                  key={preset.id}
                  type="button"
                  data-testid={`map-toolbar-preset-${preset.id}`}
                  aria-pressed={isActive}
                  onClick={() => {
                    setExploreMapPreset(preset.id);
                    if (preset.autoOpenDrawTools && !isDrawToolboxOpen) {
                      onToggleDrawToolbox();
                    } else if (preset.simpleMode && isDrawToolboxOpen) {
                      onToggleDrawToolbox();
                    }
                    setActivePopover(null);
                  }}
                  className={`w-full text-left rounded-xl border px-2.5 py-2 transition-all cursor-pointer ${
                    isActive
                      ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)]/10 ring-1 ring-[var(--ps-accent)]/30'
                      : 'border-[var(--ps-border)] bg-[var(--ps-bg)] hover:bg-[var(--ps-surface-alt)]'
                  }`}
                >
                  <div className="flex items-center justify-between gap-1.5">
                    <span className="inline-flex items-center gap-1.5 font-bold text-[var(--ps-text)]">
                      <PresetIcon className="w-3.5 h-3.5 text-[var(--ps-accent)] shrink-0" />
                      <span>{preset.label}</span>
                    </span>
                    {isActive && (
                      <Check className="w-3.5 h-3.5 text-[var(--ps-accent)] shrink-0" />
                    )}
                  </div>
                  <p className="mt-0.5 text-[10.5px] leading-snug text-[var(--ps-text-muted)]">
                    {preset.description}
                  </p>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Popover: Map Style (Neutral Light / Midnight Dark + Cloud Preview) */}
      {!isCollapsed && activePopover === 'style' && (
        <div
          data-testid="map-toolbar-style-popover"
          className={`absolute ${getPopoverAlignClasses()} w-60 sm:w-64 max-w-[calc(100vw-84px)] ${
            isMobileLandscape
              ? 'max-h-[132px]'
              : 'max-h-[min(19rem,calc(100dvh-160px))]'
          } overflow-y-auto overscroll-contain rounded-2xl bg-[var(--ps-surface)] border border-[var(--ps-border)] shadow-2xl p-3 space-y-2.5 text-xs z-40 ps-animate-in-popover`}
          role="dialog"
          aria-label="Map style configuration"
        >
          <div className="flex items-center justify-between">
            <span className="font-bold text-[var(--ps-text)] flex items-center gap-1.5">
              <Palette className="w-3.5 h-3.5 text-[var(--ps-accent)]" />
              Cloud Map Appearance
            </span>
            <span className="text-[10px] text-[var(--ps-text-muted)]">
              Independent of UI
            </span>
          </div>

          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={() => {
                onChangeMapAppearance('light');
                setActivePopover(null);
              }}
              data-testid="map-style-light-btn"
              className={`h-9 px-2.5 py-1 rounded-xl border text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)] ${
                mapAppearance === 'light'
                  ? 'border-[var(--ps-accent)] bg-[var(--ps-surface-alt)] font-bold text-[var(--ps-text)]'
                  : 'border-[var(--ps-border)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]/60'
              }`}
            >
              <div className="flex items-center justify-between gap-1">
                <div className="flex items-center gap-1.5">
                  <Sun className="w-3.5 h-3.5 text-amber-500 shrink-0" />
                  <span>Neutral</span>
                </div>
                {mapAppearance === 'light' && (
                  <Check className="w-3 h-3 text-[var(--ps-accent)] shrink-0" />
                )}
              </div>
              <div className="text-[10px] opacity-75 mt-0.5">#F7F8F6 Light</div>
            </button>

            <button
              type="button"
              onClick={() => {
                onChangeMapAppearance('dark');
                setActivePopover(null);
              }}
              data-testid="map-style-dark-btn"
              className={`h-9 px-2.5 py-1 rounded-xl border text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)] ${
                mapAppearance === 'dark'
                  ? 'border-[var(--ps-accent)] bg-[var(--ps-surface-alt)] font-bold text-[var(--ps-text)]'
                  : 'border-[var(--ps-border)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]/60'
              }`}
            >
              <div className="flex items-center justify-between gap-1">
                <div className="flex items-center gap-1.5">
                  <Moon className="w-3.5 h-3.5 text-indigo-400 shrink-0" />
                  <span>Midnight</span>
                </div>
                {mapAppearance === 'dark' && (
                  <Check className="w-3 h-3 text-[var(--ps-accent)] shrink-0" />
                )}
              </div>
              <div className="text-[10px] opacity-75 mt-0.5">#171D1A Dark</div>
            </button>
          </div>

          <div className="pt-2 border-t border-[var(--ps-border)] space-y-1.5">
            <button
              type="button"
              onClick={onToggleVectorStylePreview}
              className="w-full h-8 px-2.5 py-1 rounded-xl bg-[var(--ps-bg)] border border-[var(--ps-border)] text-[11px] font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] flex items-center justify-between focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)]"
            >
              <span>20-Rule Cloud Vector Preview</span>
              <span
                className={`px-1.5 py-0.5 rounded text-[10px] ${
                  useVectorStylePreview
                    ? 'bg-emerald-600 text-white'
                    : 'bg-[var(--ps-surface-alt)] text-[var(--ps-text-muted)]'
                }`}
              >
                {useVectorStylePreview ? 'ON' : 'OFF'}
              </span>
            </button>

            <button
              type="button"
              onClick={() => {
                setActivePopover(null);
                onOpenCloudConfigModal();
              }}
              className="w-full h-8 px-2.5 py-1 rounded-xl text-[11px] font-semibold text-[var(--ps-accent)] hover:bg-[var(--ps-surface-alt)] flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)]"
            >
              <Sliders className="w-3 h-3" />
              <span>Configure Cloud Map IDs &amp; Spec</span>
            </button>
          </div>
        </div>
      )}

      {/* Popover: Base Map Type */}
      {!isCollapsed && activePopover === 'basemap' && (
        <div
          data-testid="map-toolbar-basemap-popover"
          className={`absolute ${getPopoverAlignClasses()} w-48 max-w-[calc(100vw-84px)] ${
            isMobileLandscape
              ? 'max-h-[132px]'
              : 'max-h-[min(18rem,calc(100dvh-160px))]'
          } overflow-y-auto overscroll-contain rounded-2xl bg-[var(--ps-surface)] border border-[var(--ps-border)] shadow-2xl p-2 space-y-1 text-xs z-40 ps-animate-in-popover`}
          role="listbox"
          aria-label="Base map type selector"
        >
          <div className="px-2 py-1 text-[10px] font-bold text-[var(--ps-text-muted)] uppercase tracking-wider">
            Base Map Layer
          </div>
          {(
            [
              { id: 'roadmap', label: 'Roadmap' },
              { id: 'satellite', label: 'Satellite' },
              { id: 'hybrid', label: 'Hybrid' },
              { id: 'terrain', label: 'Terrain' },
            ] as const
          ).map((item) => {
            const isSelected = baseMapType === item.id;
            return (
              <button
                key={item.id}
                type="button"
                role="option"
                aria-selected={isSelected}
                onClick={() => {
                  onChangeBaseMapType(
                    item.id === 'roadmap' && mapAppearance === 'dark'
                      ? 'dark'
                      : item.id
                  );
                  setActivePopover(null);
                }}
                data-testid={`basemap-${item.id}-btn`}
                className={`w-full h-8 px-3 py-1.5 rounded-xl text-left font-semibold flex items-center justify-between transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)] ${
                  isSelected
                    ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                    : 'text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                }`}
              >
                <span>{item.label}</span>
                {isSelected && <Check className="w-3.5 h-3.5 shrink-0" />}
              </button>
            );
          })}

          {(onToggleCivicPins || onToggleVerifiedBoostedOnly) && (
            <div className="pt-2 mt-1.5 border-t border-[var(--ps-border)] space-y-1">
              <div className="px-1 text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                Pin Layers
              </div>
              {onToggleCivicPins && (
                <button
                  type="button"
                  role="switch"
                  aria-checked={showCivicPins}
                  data-testid="map-layer-civic-toggle"
                  onClick={onToggleCivicPins}
                  className={`w-full h-8 px-2.5 rounded-xl text-left font-semibold flex items-center justify-between transition-colors cursor-pointer ${
                    showCivicPins
                      ? 'bg-[var(--ps-accent)]/12 text-[var(--ps-accent)] border border-[var(--ps-accent)]/35'
                      : 'text-[var(--ps-text-muted)] hover:bg-[var(--ps-surface-alt)]'
                  }`}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Landmark className="w-3.5 h-3.5 shrink-0" />
                    <span>Show Civic Pins</span>
                  </span>
                  {showCivicPins && <Check className="w-3.5 h-3.5 shrink-0" />}
                </button>
              )}
              {onToggleVerifiedBoostedOnly && (
                <button
                  type="button"
                  role="switch"
                  aria-checked={verifiedBoostedOnly}
                  data-testid="map-layer-boosted-toggle"
                  onClick={onToggleVerifiedBoostedOnly}
                  className={`w-full h-8 px-2.5 rounded-xl text-left font-semibold flex items-center justify-between transition-colors cursor-pointer ${
                    verifiedBoostedOnly
                      ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/35'
                      : 'text-[var(--ps-text-muted)] hover:bg-[var(--ps-surface-alt)]'
                  }`}
                >
                  <span className="inline-flex items-center gap-1.5">
                    <Building2 className="w-3.5 h-3.5 shrink-0" />
                    <span>Boosted / Verified</span>
                  </span>
                  {verifiedBoostedOnly && (
                    <Check className="w-3.5 h-3.5 shrink-0" />
                  )}
                </button>
              )}

              {/* Pass V3-A: Icon & Layer Visibility Controls */}
              {onToggleBasePoiIcons && (
                <button
                  type="button"
                  role="switch"
                  aria-checked={showBasePoiIcons}
                  data-testid="map-layer-base-poi-toggle"
                  onClick={onToggleBasePoiIcons}
                  className={`w-full h-8 px-2.5 rounded-xl text-left font-semibold flex items-center justify-between transition-colors cursor-pointer ${
                    showBasePoiIcons
                      ? 'bg-[var(--ps-accent)]/12 text-[var(--ps-accent)] border border-[var(--ps-accent)]/35'
                      : 'text-[var(--ps-text-muted)] hover:bg-[var(--ps-surface-alt)]'
                  }`}
                >
                  <span className="truncate">Base Map POI Icons</span>
                  {showBasePoiIcons && <Check className="w-3.5 h-3.5 shrink-0" />}
                </button>
              )}
              {onToggleHideOtherVerticalPins && (
                <button
                  type="button"
                  role="switch"
                  aria-checked={hideOtherVerticalPins}
                  data-testid="map-layer-focus-vertical-toggle"
                  onClick={onToggleHideOtherVerticalPins}
                  className={`w-full h-8 px-2.5 rounded-xl text-left font-semibold flex items-center justify-between transition-colors cursor-pointer ${
                    hideOtherVerticalPins
                      ? 'bg-[var(--ps-accent)]/12 text-[var(--ps-accent)] border border-[var(--ps-accent)]/35'
                      : 'text-[var(--ps-text-muted)] hover:bg-[var(--ps-surface-alt)]'
                  }`}
                >
                  <span className="truncate">Active Vertical Only</span>
                  {hideOtherVerticalPins && <Check className="w-3.5 h-3.5 shrink-0" />}
                </button>
              )}
              {onToggleHideAllListingPins && (
                <button
                  type="button"
                  role="switch"
                  aria-checked={hideAllListingPins}
                  data-testid="map-layer-hide-all-pins-toggle"
                  onClick={onToggleHideAllListingPins}
                  className={`w-full h-8 px-2.5 rounded-xl text-left font-semibold flex items-center justify-between transition-colors cursor-pointer ${
                    hideAllListingPins
                      ? 'bg-rose-500/12 text-rose-700 dark:text-rose-300 border border-rose-500/35'
                      : 'text-[var(--ps-text-muted)] hover:bg-[var(--ps-surface-alt)]'
                  }`}
                >
                  <span className="truncate">Hide All Listing Pins</span>
                  {hideAllListingPins && <Check className="w-3.5 h-3.5 shrink-0" />}
                </button>
              )}
              {onToggleShowCustomUserMarkers && (
                <button
                  type="button"
                  role="switch"
                  aria-checked={showCustomUserMarkers}
                  data-testid="map-layer-custom-markers-toggle"
                  onClick={onToggleShowCustomUserMarkers}
                  className={`w-full h-8 px-2.5 rounded-xl text-left font-semibold flex items-center justify-between transition-colors cursor-pointer ${
                    showCustomUserMarkers
                      ? 'bg-[var(--ps-accent)]/12 text-[var(--ps-accent)] border border-[var(--ps-accent)]/35'
                      : 'text-[var(--ps-text-muted)] hover:bg-[var(--ps-surface-alt)]'
                  }`}
                >
                  <span className="truncate">Custom Drawn Shapes</span>
                  {showCustomUserMarkers && <Check className="w-3.5 h-3.5 shrink-0" />}
                </button>
              )}

              {/* Pass V3-A: Category-Synced Context Tools */}
              <div className="pt-1.5 mt-1 border-t border-[var(--ps-border)] space-y-1">
                <div className="px-1 text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                  Context Tools ({selectedVertical.replace(/_/g, ' ')})
                </div>

                {selectedVertical === 'real_estate' && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setActivePopover(null);
                        onToggleDrawToolbox();
                      }}
                      className="w-full h-8 px-2.5 rounded-xl text-left font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] flex items-center justify-between cursor-pointer"
                    >
                      <span>Plot / Area Measure</span>
                      <PenTool className="w-3.5 h-3.5 text-[var(--ps-accent)]" />
                    </button>
                    {onToggleVerticalAttribute && (
                      <button
                        type="button"
                        onClick={() => onToggleVerticalAttribute('patta_verified')}
                        className={`w-full h-8 px-2.5 rounded-xl text-left font-semibold flex items-center justify-between cursor-pointer ${
                          activeVerticalAttributes.includes('patta_verified')
                            ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                            : 'text-[var(--ps-text-muted)] hover:bg-[var(--ps-surface-alt)]'
                        }`}
                      >
                        <span>Patta Verified Only</span>
                        {activeVerticalAttributes.includes('patta_verified') && (
                          <Check className="w-3.5 h-3.5" />
                        )}
                      </button>
                    )}
                  </>
                )}

                {selectedVertical === 'public_civic' && (
                  <>
                    {onLocateNearestEmergency && (
                      <button
                        type="button"
                        onClick={() => {
                          setActivePopover(null);
                          onLocateNearestEmergency();
                        }}
                        className="w-full h-8 px-2.5 rounded-xl text-left font-semibold bg-rose-500/12 text-rose-700 dark:text-rose-300 hover:bg-rose-500/20 flex items-center justify-between cursor-pointer"
                      >
                        <span>Nearest 24×7 Emergency</span>
                        <LocateFixed className="w-3.5 h-3.5" />
                      </button>
                    )}
                    {onToggleVerticalAttribute && (
                      <button
                        type="button"
                        onClick={() => onToggleVerticalAttribute('active_alert')}
                        className={`w-full h-8 px-2.5 rounded-xl text-left font-semibold flex items-center justify-between cursor-pointer ${
                          activeVerticalAttributes.includes('active_alert')
                            ? 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                            : 'text-[var(--ps-text-muted)] hover:bg-[var(--ps-surface-alt)]'
                        }`}
                      >
                        <span>Active Civic Alerts Only</span>
                        {activeVerticalAttributes.includes('active_alert') && (
                          <Check className="w-3.5 h-3.5" />
                        )}
                      </button>
                    )}
                  </>
                )}

                {(selectedVertical === 'restaurant_food' ||
                  selectedVertical === 'shop_catalogue') &&
                  onToggleVerticalAttribute && (
                    <button
                      type="button"
                      onClick={() =>
                        onToggleVerticalAttribute(
                          selectedVertical === 'restaurant_food'
                            ? 'delivery_ready'
                            : 'pick_n_drop_ready'
                        )
                      }
                      className={`w-full h-8 px-2.5 rounded-xl text-left font-semibold flex items-center justify-between cursor-pointer ${
                        activeVerticalAttributes.includes('delivery_ready') ||
                        activeVerticalAttributes.includes('pick_n_drop_ready')
                          ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                          : 'text-[var(--ps-text-muted)] hover:bg-[var(--ps-surface-alt)]'
                      }`}
                    >
                      <span>Open &amp; Delivery Ready</span>
                      {(activeVerticalAttributes.includes('delivery_ready') ||
                        activeVerticalAttributes.includes('pick_n_drop_ready')) && (
                        <Check className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}

                {selectedVertical === 'print_digital' &&
                  onToggleVerticalAttribute && (
                    <button
                      type="button"
                      onClick={() => onToggleVerticalAttribute('order_online')}
                      className={`w-full h-8 px-2.5 rounded-xl text-left font-semibold flex items-center justify-between cursor-pointer ${
                        activeVerticalAttributes.includes('order_online')
                          ? 'bg-teal-500/15 text-teal-700 dark:text-teal-300'
                          : 'text-[var(--ps-text-muted)] hover:bg-[var(--ps-surface-alt)]'
                      }`}
                    >
                      <span>Express &amp; Online Print Only</span>
                      {activeVerticalAttributes.includes('order_online') && (
                        <Check className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}

                {(selectedVertical === 'all' ||
                  selectedVertical === 'general' ||
                  selectedVertical === 'booking_venue' ||
                  selectedVertical === 'hotel_stay') && (
                  <button
                    type="button"
                    onClick={() => {
                      setActivePopover(null);
                      onToggleDrawToolbox();
                    }}
                    className="w-full h-8 px-2.5 rounded-xl text-left font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] flex items-center justify-between cursor-pointer"
                  >
                    <span>Distance Ruler / Draw Area</span>
                    <PenTool className="w-3.5 h-3.5 text-[var(--ps-accent)]" />
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Popover: Marker Legend */}
      {!isCollapsed && activePopover === 'legend' && (
        <div
          data-testid="map-toolbar-legend-popover"
          className={`absolute ${getPopoverAlignClasses()} w-60 max-w-[calc(100vw-84px)] ${
            isMobileLandscape
              ? 'max-h-[132px]'
              : 'max-h-[min(19rem,calc(100dvh-160px))]'
          } overflow-y-auto overscroll-contain rounded-2xl bg-[var(--ps-surface)] border border-[var(--ps-border)] shadow-2xl p-3 space-y-2 text-xs z-40 ps-animate-in-popover`}
          role="dialog"
          aria-label="Map marker legend"
        >
          <div className="font-bold text-[var(--ps-text)]">
            Directory Marker Legend
          </div>
          <div className="space-y-1.5">
            {[
              {
                key: 'print_digital',
                label: 'Print & Digital',
                bg: '#0f766e',
                icon: <Printer className="w-3 h-3" />,
              },
              {
                key: 'booking_venue',
                label: 'Venues & Turfs',
                bg: '#059669',
                icon: <CalendarDays className="w-3 h-3" />,
              },
              {
                key: 'hotel_stay',
                label: 'Hotels & Stays',
                bg: '#4338ca',
                icon: <BedDouble className="w-3 h-3" />,
              },
              {
                key: 'restaurant_food',
                label: 'Food & Dining',
                bg: '#ea580c',
                icon: <Utensils className="w-3 h-3" />,
              },
              {
                key: 'shop_catalogue',
                label: 'Shops & Retail',
                bg: '#2563eb',
                icon: <ShoppingBag className="w-3 h-3" />,
              },
              {
                key: 'real_estate',
                label: 'Real Estate (Price Pill)',
                bg: '#6d28d9',
                icon: <Home className="w-3 h-3" />,
              },
              {
                key: 'public_civic',
                label: 'Civic & Emergency',
                bg: '#b91c1c',
                icon: <Landmark className="w-3 h-3" />,
              },
              {
                key: 'general',
                label: 'General Services',
                bg: '#0284c7',
                icon: <Briefcase className="w-3 h-3" />,
              },
            ].map((row) => (
              <div key={row.key} className="flex items-center gap-2">
                <span
                  className="w-5 h-5 rounded-full flex items-center justify-center text-white shrink-0 border border-white/80 shadow-xs"
                  style={{ backgroundColor: row.bg }}
                >
                  {row.icon}
                </span>
                <span className="text-[11px] font-medium text-[var(--ps-text)]">
                  {row.label}
                </span>
              </div>
            ))}

            {/* Pass V5: Active Feature Cues Legend Footer */}
            <div className="pt-2 mt-1.5 border-t border-[var(--ps-border)] space-y-1.5">
              <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                Active Feature Cues
              </div>
              <div className="flex items-center gap-2">
                <span className="w-4 h-4 rounded-full bg-emerald-600 ring-2 ring-emerald-400 shrink-0" />
                <span className="text-[10px] text-[var(--ps-text)]">
                  Live Online Print, Booking, or Ordering
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-4 h-4 rounded-full bg-violet-700 ring-2 ring-amber-400 shrink-0" />
                <span className="text-[10px] text-[var(--ps-text)]">
                  Official DD oodle Print / Featured Verified
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-4 h-4 rounded-full border border-[var(--ps-border)] bg-white text-[8px] font-extrabold text-slate-800 flex items-center justify-center shrink-0">
                  ★
                </span>
                <span className="text-[10px] text-[var(--ps-text)]">
                  Verified Business Logo Pin
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-4 h-4 rounded-md bg-teal-600 text-white flex items-center justify-center shrink-0">
                  <MapPin className="w-2.5 h-2.5" />
                </span>
                <span className="text-[10px] text-[var(--ps-text)]">
                  Custom User Point / Note
                </span>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Popover: Accessible Toolbar Position Selector */}
      {!isCollapsed && activePopover === 'position' && (
        <div
          data-testid="map-toolbar-position-popover"
          className={`absolute ${getPopoverAlignClasses()} w-60 max-w-[calc(100vw-84px)] ${
            isMobileLandscape
              ? 'max-h-[132px]'
              : 'max-h-[min(18rem,calc(100dvh-160px))]'
          } overflow-y-auto overscroll-contain rounded-2xl bg-[var(--ps-surface)] border border-[var(--ps-border)] shadow-2xl p-3 space-y-2.5 text-xs z-40 ps-animate-in-popover`}
          role="dialog"
          aria-label="Select floating toolbar position"
        >
          <div className="flex items-center justify-between">
            <span className="font-bold text-[var(--ps-text)] flex items-center gap-1.5">
              <Move className="w-3.5 h-3.5 text-[var(--ps-accent)]" />
              Toolbar Position
            </span>
            <span className="text-[10px] text-[var(--ps-text-muted)]">
              Drag or select
            </span>
          </div>
          <div className="grid grid-cols-3 gap-1.5">
            {(Object.keys(POSITION_LABELS) as MapToolbarPosition[]).map(
              (pos) => (
                <button
                  key={pos}
                  type="button"
                  onClick={() => {
                    updateToolbarPosition(pos);
                    setActivePopover(null);
                  }}
                  data-testid={`toolbar-pos-${pos}`}
                  className={`h-8 px-2 py-1 rounded-lg border text-[10px] font-semibold text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)] ${
                    position === pos
                      ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] border-[var(--ps-accent)]'
                      : 'bg-[var(--ps-bg)] text-[var(--ps-text)] border-[var(--ps-border)] hover:bg-[var(--ps-surface-alt)]'
                  }`}
                >
                  {POSITION_LABELS[pos]}
                </button>
              )
            )}
          </div>
          <div className="pt-2 border-t border-[var(--ps-border)] flex justify-end">
            <button
              type="button"
              onClick={() => updateCollapsedState(true)}
              className="h-7 px-2.5 py-1 rounded-lg bg-[var(--ps-bg)] border border-[var(--ps-border)] text-[10px] font-semibold text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]"
            >
              Collapse Toolbar
            </button>
          </div>
        </div>
      )}
      </div>
    </div>
  );

  if (portalHost) {
    return createPortal(toolbarNode, portalHost);
  }

  return toolbarNode;
}
