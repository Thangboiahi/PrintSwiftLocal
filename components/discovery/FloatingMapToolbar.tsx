'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  Briefcase,
  Building2,
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
  Palette,
  PenTool,
  Plus,
  Sliders,
  Sun,
  Trophy,
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
import { useSimpleMode } from '@/lib/store';

const TOOLBAR_STORAGE_KEY = 'printswift_local_map_toolbar_pos_v1';
const TOOLBAR_COLLAPSED_STORAGE_KEY = 'printswift_local_map_toolbar_collapsed_v1';

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
  isMobileLandscape?: boolean;
  isSplitScreen?: boolean;
  hasSelectedListing?: boolean;
  onPositionChange?: (pos: MapToolbarPosition) => void;
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
  mobileBottomOffsetClass = 'bottom-24 lg:bottom-7',
  mobileSheetState = 'partial',
  isMobileLandscape = false,
  isSplitScreen = false,
  hasSelectedListing = false,
  onPositionChange,
}: FloatingMapToolbarProps) {
  const [simpleMode] = useSimpleMode();
  const [position, setPosition] = useState<MapToolbarPosition>('top-right');
  const [isCollapsed, setIsCollapsed] = useState<boolean>(false);
  const [activePopover, setActivePopover] = useState<
    'style' | 'basemap' | 'legend' | 'position' | null
  >(null);
  const [isDragging, setIsDragging] = useState(false);
  const toolbarRef = useRef<HTMLDivElement | null>(null);
  const dragSuppressClickRef = useRef<boolean>(false);

  // Hydrate persisted toolbar position & collapse state after mount so SSR and initial client render match
  useEffect(() => {
    queueMicrotask(() => {
      try {
        const savedPos = localStorage.getItem(
          TOOLBAR_STORAGE_KEY
        ) as MapToolbarPosition | null;
        if (savedPos && POSITION_LABELS[savedPos]) {
          setPosition(savedPos);
          onPositionChange?.(savedPos);
        }

        const savedCollapsed = localStorage.getItem(
          TOOLBAR_COLLAPSED_STORAGE_KEY
        );
        if (savedCollapsed === 'true' || savedCollapsed === 'false') {
          setIsCollapsed(savedCollapsed === 'true');
        } else if (typeof window !== 'undefined' && window.innerWidth < 1024) {
          // On mobile, default to collapsed to maximise usable map area
          setIsCollapsed(true);
        }
      } catch {
        // ignore storage access errors
      }
    });
  }, [onPositionChange]);

  const updateToolbarPosition = (nextPos: MapToolbarPosition) => {
    setPosition(nextPos);
    onPositionChange?.(nextPos);
    try {
      localStorage.setItem(TOOLBAR_STORAGE_KEY, nextPos);
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

  // Drag-to-reposition inside map viewport (only activates if pointer moves > 6px)
  const handleDragStart = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    let movedEnough = false;
    dragSuppressClickRef.current = false;

    const handlePointerMove = (moveEv: PointerEvent) => {
      if (
        !movedEnough &&
        Math.hypot(moveEv.clientX - startX, moveEv.clientY - startY) > 6
      ) {
        movedEnough = true;
        dragSuppressClickRef.current = true;
        setIsDragging(true);
        setActivePopover(null);
      }
      if (!movedEnough) return;

      const container = mapViewportRef.current;
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const relX = (moveEv.clientX - rect.left) / Math.max(1, rect.width);
      const relY = (moveEv.clientY - rect.top) / Math.max(1, rect.height);

      const row = relY < 0.5 ? 'top' : 'bottom';
      const col = relX < 0.34 ? 'left' : relX > 0.66 ? 'right' : 'center';
      const snapped = `${row}-${col}` as MapToolbarPosition;
      setPosition(snapped);
    };

    const handlePointerUp = (upEv: PointerEvent) => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      if (!movedEnough) return;

      setIsDragging(false);
      const container = mapViewportRef.current;
      if (container) {
        const rect = container.getBoundingClientRect();
        const relX = (upEv.clientX - rect.left) / Math.max(1, rect.width);
        const relY = (upEv.clientY - rect.top) / Math.max(1, rect.height);
        const row = relY < 0.5 ? 'top' : 'bottom';
        const col = relX < 0.34 ? 'left' : relX > 0.66 ? 'right' : 'center';
        const snapped = `${row}-${col}` as MapToolbarPosition;
        updateToolbarPosition(snapped);
      }
      setTimeout(() => {
        dragSuppressClickRef.current = false;
      }, 50);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  // Compute container positioning classes inside map viewport
  // Ensures toolbar never overlaps Google Maps attribution, mobile sheets, or selected cards
  const getPositionClasses = (): string => {
    switch (position) {
      case 'top-left':
        return 'top-2.5 left-2.5';
      case 'top-center':
        return 'top-2.5 left-1/2 -translate-x-1/2';
      case 'top-right':
        return 'top-2.5 right-2.5';
      case 'bottom-left':
        return `${mobileBottomOffsetClass} left-2.5`;
      case 'bottom-center':
        return `${mobileBottomOffsetClass} left-1/2 -translate-x-1/2`;
      case 'bottom-right':
        return `${mobileBottomOffsetClass} right-2.5`;
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
      return 'max-h-[calc(57%-18px)] lg:max-h-[calc(100%-36px)]';
    }
    return 'max-h-[calc(100%-104px)] lg:max-h-[calc(100%-36px)]';
  };

  const getPopoverAlignClasses = (): string => {
    const openUpward = position.startsWith('bottom');

    // When toolbar is rendered horizontally, open popover directly below/above the horizontal strip
    if (isHorizontalLayout) {
      const verticalPos = openUpward ? 'bottom-full mb-2' : 'top-full mt-2';
      if (position.endsWith('right')) {
        return `${verticalPos} right-0`;
      }
      if (position.endsWith('left')) {
        return `${verticalPos} left-0`;
      }
      return `${verticalPos} left-1/2 -translate-x-1/2`;
    }

    // When toolbar is rendered vertically on the left or right edge, open popover inward
    // to the side of the vertical bar so it stays inside the open map viewport
    const sidePos = position.endsWith('right')
      ? 'right-full mr-2'
      : 'left-full ml-2';
    const vertEdge = openUpward ? 'bottom-0' : 'top-0';

    if (forceCompactMobileRow) {
      const mobileVert = openUpward ? 'bottom-full mb-2' : 'top-full mt-2';
      const mobileHoriz = position.endsWith('right') ? 'right-0' : 'left-0';
      return `${mobileVert} ${mobileHoriz} lg:top-0 lg:bottom-auto lg:mt-0 lg:mb-0 ${
        position.endsWith('right')
          ? 'lg:right-full lg:left-auto lg:mr-2'
          : 'lg:left-full lg:right-auto lg:ml-2'
      }`;
    }

    return `${vertEdge} ${sidePos}`;
  };

  const btnSizeClass =
    'w-11 h-11 min-w-[44px] min-h-[44px] shrink-0 rounded-xl flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)]';
  const toolbarIconClass = 'w-4 h-4 sm:w-[18px] sm:h-[18px] shrink-0';

  return (
    <div
      ref={toolbarRef}
      data-testid="floating-map-toolbar"
      data-position={position}
      data-collapsed={isCollapsed ? 'true' : 'false'}
      className={`absolute z-30 flex flex-col pointer-events-auto transition-all duration-150 ${getPositionClasses()} ${getMaxWidthClasses()} ${getMaxHeightClasses()} ${
        isDragging ? 'ring-2 ring-[var(--ps-accent)] scale-[1.02]' : ''
      }`}
      role="toolbar"
      aria-label="Floating map utilities toolbar"
    >
      {isCollapsed && !simpleMode ? (
        /* COLLAPSED STATE: Single compact map-tools icon (clickable to expand, draggable to reposition) */
        <button
          type="button"
          onPointerDown={handleDragStart}
          onClick={() => {
            if (dragSuppressClickRef.current) return;
            updateCollapsedState(false);
          }}
          title={
            drawnShapesCount > 0
              ? `Expand Map Tools (${POSITION_LABELS[position]}, ${drawnShapesCount} ${drawnShapesCount === 1 ? 'drawing' : 'drawings'}) — Click to open or drag to move`
              : `Expand Map Tools (${POSITION_LABELS[position]}) — Click to open or drag to move`
          }
          aria-label={
            drawnShapesCount > 0
              ? `Expand floating map tools (${drawnShapesCount} ${drawnShapesCount === 1 ? 'drawing' : 'drawings'})`
              : 'Expand floating map tools'
          }
          aria-expanded={false}
          data-testid="map-toolbar-expand-btn"
          className="relative w-8 h-8 min-w-[44px] min-h-[44px] rounded-2xl bg-[var(--ps-surface)]/95 backdrop-blur-md border border-[var(--ps-border)] shadow-xl text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] hover:border-[var(--ps-accent)]/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)] flex items-center justify-center transition-all"
        >
          <Sliders className="w-4 h-4 sm:w-[18px] sm:h-[18px] text-[var(--ps-accent)] shrink-0" />
          {drawnShapesCount > 0 && (
            <span
              data-testid="map-toolbar-collapsed-draw-count-badge"
              className="absolute -top-1 -right-1 min-w-[10px] h-[10px] px-1 rounded-full bg-emerald-600 text-white text-[9px] font-bold flex items-center justify-center"
            >
              {drawnShapesCount}
            </span>
          )}
        </button>
      ) : (
        /* EXPANDED STATE: Full floating utility controls with dedicated drag handle, position menu, and collapse toggle */
        <div
          data-testid="map-toolbar-expanded-bar"
          className={`flex ${
            isHorizontalLayout
              ? 'flex-row flex-nowrap items-center min-w-0 max-w-full overflow-x-auto overscroll-x-contain no-scrollbar'
              : forceCompactMobileRow
                ? 'flex-row flex-nowrap lg:flex-col items-center min-w-0 max-w-full lg:min-h-0 lg:max-h-full overflow-x-auto lg:overflow-x-visible lg:overflow-y-auto overscroll-contain no-scrollbar'
                : 'flex-col items-center min-h-0 max-h-full overflow-y-auto overscroll-y-contain no-scrollbar'
          } gap-0.5 sm:gap-1 p-1 rounded-2xl bg-[var(--ps-surface)]/95 backdrop-blur-md border border-[var(--ps-border)] shadow-xl`}
        >
          {!simpleMode && (
            <>
              {/* Dedicated Drag Handle & Accessible Position-Selection Menu Trigger */}
              <button
                type="button"
                onPointerDown={handleDragStart}
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
                } cursor-grab active:cursor-grabbing`}
              >
                <GripVertical className={toolbarIconClass} />
              </button>

              {/* Return to Default Centre (District default or saved custom default) */}
              <button
                type="button"
                onClick={onRecenter}
                title={
                  hasCustomDefaultCenter
                    ? 'Return to saved custom default centre'
                    : 'Return to Churachandpur district default centre'
                }
                aria-label={
                  hasCustomDefaultCenter
                    ? 'Return to saved custom default centre'
                    : 'Return to Churachandpur district default centre'
                }
                data-testid="map-toolbar-recenter-btn"
                className={`${btnSizeClass} text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]`}
              >
                <Compass className={toolbarIconClass} />
              </button>
            </>
          )}

          {/* Locate Me (Browser Geolocation API) */}
          <button
            type="button"
            onClick={onLocateMe}
            disabled={isLocating}
            title={
              isLocating
                ? 'Locating your current position...'
                : 'Locate me (centre map on current device location)'
            }
            aria-label={isLocating ? 'Locating...' : 'Locate me'}
            data-testid="map-toolbar-locate-me-btn"
            className={`${btnSizeClass} text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] ${
              isLocating ? 'opacity-70 cursor-wait' : ''
            }`}
          >
            {isLocating ? (
              <Loader2 className={`${toolbarIconClass} animate-spin text-[var(--ps-accent)]`} />
            ) : (
              <LocateFixed className={toolbarIconClass} />
            )}
          </button>

          {!simpleMode && (
            <>
              {/* Map Style Popover Trigger (Neutral Light / Midnight Dark) */}
              <button
                type="button"
                onClick={() =>
                  setActivePopover((prev) => (prev === 'style' ? null : 'style'))
                }
                title={`Map Appearance: ${
                  mapAppearance === 'dark'
                    ? 'PrintSwift Midnight Discovery (Dark)'
                    : 'PrintSwift Neutral Discovery (Light)'
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
                  <Moon className="w-4 h-4 sm:w-[10px] sm:h-[10px] text-indigo-400 shrink-0" />
                ) : (
                  <Sun className="w-4 h-4 sm:w-[10px] sm:h-[10px] text-amber-500 shrink-0" />
                )}
              </button>

              {/* Base Map Type Popover Trigger */}
              <button
                type="button"
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

              {/* Draw and Measure Toggle */}
              <button
                type="button"
                onClick={() => {
                  setActivePopover(null);
                  onToggleDrawToolbox();
                }}
                title={
                  drawnShapesCount > 0
                    ? `Draw and Measure on Map (${drawnShapesCount} ${drawnShapesCount === 1 ? 'drawing' : 'drawings'})`
                    : 'Draw and Measure on Map'
                }
                aria-label={
                  drawnShapesCount > 0
                    ? `Toggle Draw and Measure toolbox (${drawnShapesCount} ${drawnShapesCount === 1 ? 'drawing' : 'drawings'})`
                    : 'Toggle Draw and Measure toolbox'
                }
                aria-pressed={isDrawToolboxOpen}
                data-testid="map-toolbar-draw-btn"
                className={`relative ${btnSizeClass} ${
                  isDrawToolboxOpen
                    ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                    : 'text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                }`}
              >
                <PenTool className={toolbarIconClass} />
                {drawnShapesCount > 0 && (
                  <span
                    data-testid="map-toolbar-draw-count-badge"
                    className="absolute top-0.5 right-0.5 min-w-[14px] h-[14px] px-1 rounded-full bg-emerald-600 text-white text-[9px] font-bold flex items-center justify-center"
                  >
                    {drawnShapesCount}
                  </span>
                )}
              </button>
            </>
          )}

          {/* Marker Legend Popover Trigger */}
          <button
            type="button"
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

          {/* Full-screen Map Toggle */}
          <button
            type="button"
            onClick={onToggleFullscreenMap}
            title={
              isFullscreenMap ? 'Exit full-screen map' : 'Enter full-screen map'
            }
            aria-label={
              isFullscreenMap ? 'Exit full-screen map' : 'Enter full-screen map'
            }
            aria-pressed={isFullscreenMap}
            data-testid="map-toolbar-fullscreen-btn"
            className={`${btnSizeClass} ${
              isFullscreenMap
                ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                : 'text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
            }`}
          >
            {isFullscreenMap ? (
              <Minimize2 className={toolbarIconClass} />
            ) : (
              <Maximize2 className={toolbarIconClass} />
            )}
          </button>

          {!simpleMode && (
            <>
              {/* Divider */}
              <div
                className={
                  isHorizontalLayout
                    ? 'w-px h-4 bg-[var(--ps-border)] mx-0.5 shrink-0'
                    : 'h-px w-4 bg-[var(--ps-border)] my-0.5 shrink-0'
                }
              />

              {/* Zoom In */}
              <button
                type="button"
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
                onClick={onZoomOut}
                title="Zoom out"
                aria-label="Zoom out"
                data-testid="map-toolbar-zoom-out-btn"
                className={`${btnSizeClass} text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]`}
              >
                <Minus className={toolbarIconClass} />
              </button>

              {/* Divider */}
              <div
                className={
                  isHorizontalLayout
                    ? 'w-px h-4 bg-[var(--ps-border)] mx-0.5 shrink-0'
                    : 'h-px w-4 bg-[var(--ps-border)] my-0.5 shrink-0'
                }
              />

              {/* Collapse Floating Toolbar Button */}
              <button
                type="button"
                onClick={() => updateCollapsedState(true)}
                title="Collapse Map Tools into compact icon"
                aria-label="Collapse floating map tools"
                aria-expanded={true}
                data-testid="map-toolbar-collapse-btn"
                className={`${btnSizeClass} text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]`}
              >
                {isHorizontalLayout ? (
                  <ChevronUp className={toolbarIconClass} />
                ) : (
                  <ChevronDown className="w-4 h-4 sm:w-[18px] sm:h-[18px] rotate-180 shrink-0" />
                )}
              </button>
            </>
          )}
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
              className={`px-2.5 py-2 rounded-xl border text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)] ${
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
              className={`px-2.5 py-2 rounded-xl border text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)] ${
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
              className="w-full px-2.5 py-1.5 rounded-xl bg-[var(--ps-bg)] border border-[var(--ps-border)] text-[11px] font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] flex items-center justify-between focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)]"
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
              className="w-full px-2.5 py-1.5 rounded-xl text-[11px] font-semibold text-[var(--ps-accent)] hover:bg-[var(--ps-surface-alt)] flex items-center justify-center gap-1.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)]"
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
                className={`w-full px-3 py-2 rounded-xl text-left font-semibold flex items-center justify-between transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)] ${
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
            {(Object.keys(CATEGORY_LABELS) as ListingCategory[]).map((cat) => (
              <div key={cat} className="flex items-center gap-2">
                <span
                  className="w-5 h-5 rounded-full flex items-center justify-center text-white shrink-0"
                  style={{ backgroundColor: CATEGORY_COLORS[cat] }}
                >
                  <CategoryIcon category={cat} className="w-3 h-3" />
                </span>
                <span className="text-[11px] font-medium text-[var(--ps-text)]">
                  {CATEGORY_LABELS[cat]}
                </span>
              </div>
            ))}
            <div className="pt-1.5 border-t border-[var(--ps-border)] flex items-center gap-2">
              <span className="w-5 h-5 rounded-md bg-teal-600 text-white flex items-center justify-center shrink-0">
                <MapPin className="w-3 h-3" />
              </span>
              <span className="text-[11px] font-medium text-[var(--ps-text)]">
                Custom User Point / Note
              </span>
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
                  className={`px-2 py-1.5 rounded-lg border text-[10px] font-semibold text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)] ${
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
              className="px-2.5 py-1 rounded-lg bg-[var(--ps-bg)] border border-[var(--ps-border)] text-[10px] font-semibold text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]"
            >
              Collapse Toolbar
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
