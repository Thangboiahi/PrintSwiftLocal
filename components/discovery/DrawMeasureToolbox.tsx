'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Check,
  ChevronDown,
  ChevronUp,
  Circle as CircleIcon,
  Eye,
  EyeOff,
  Filter,
  GripVertical,
  Hexagon,
  Lock,
  MapPin,
  Maximize2,
  Minimize2,
  Minus,
  Move,
  Pencil,
  PlusCircle,
  Redo2,
  RotateCcw,
  Square,
  Trash2,
  Undo2,
  X,
} from 'lucide-react';
import {
  AreaUnit,
  DrawnShape,
  LatLngPoint,
  ListingCategory,
  MapToolbarPosition,
  MobileSheetState,
  PropertyType,
} from '@/lib/types';
import {
  ALL_DOCK_POSITIONS,
  CATEGORY_LABELS,
  DRAW_TOOLBOX_POSITION_LABELS,
  PROPERTY_TYPE_LABELS,
  calculateCircleMetrics,
  calculateLineSegmentsMeters,
  calculatePolygonMetrics,
  formatArea,
  resizeRectangleShape,
  resolveDrawToolboxDockLayout,
  shouldShowPlotAndBoundary,
  snapPointerToDockPosition,
  translateShapeCoordinates,
} from '@/lib/rules';

export const DRAW_TOOLBOX_STORAGE_KEY = 'printswift_local_draw_toolbox_pos_v1';
export const DRAW_TOOLBOX_COLLAPSED_STORAGE_KEY =
  'printswift_local_draw_toolbox_collapsed_v1';

export type ActiveDrawTool =
  | 'none'
  | 'point'
  | 'line'
  | 'polygon'
  | 'rectangle'
  | 'circle';

interface DrawMeasureToolboxProps {
  activeTool: ActiveDrawTool;
  onSelectTool: (tool: ActiveDrawTool) => void;
  draftPoints: LatLngPoint[];
  circleRadiusDraft: number;
  onChangeCircleRadiusDraft: (radius: number) => void;
  onFinishDraft: () => void;
  onCancelDraft: () => void;
  drawnShapes: DrawnShape[];
  selectedShapeId: string | null;
  onSelectShape: (shapeId: string | null) => void;
  onUpdateShape: (updated: DrawnShape) => void;
  onDeleteShape: (shapeId: string) => void;
  onClearAllShapes: () => void;
  activeSpatialFilterShapeId: string | null;
  onToggleSpatialFilterShape: (shapeId: string | null) => void;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  areaUnit: AreaUnit;
  onCloseToolbox: () => void;
  onCenterOnShape?: (shape: DrawnShape) => void;
  canCreateListing?: boolean;
  createPermissionReason?: string;
  onCreateListingFromShape?: (
    shape: DrawnShape,
    category: ListingCategory,
    propertyType: PropertyType,
    commercialHasPlot: boolean
  ) => void;
  mapViewportRef?: React.RefObject<HTMLDivElement | null>;
  mapToolbarPosition?: MapToolbarPosition;
  mobileBottomOffsetClass?: string;
  mobileSheetState?: MobileSheetState;
  hasSelectedListing?: boolean;
  hasActiveClusterSummary?: boolean;
  hasHoveredListingPreview?: boolean;
  hasCameraMoved?: boolean;
  isFullscreenMap?: boolean;
  isSplitScreen?: boolean;
  isMobileLandscape?: boolean;
  onPositionChange?: (pos: MapToolbarPosition) => void;
}

const TOOL_LABELS: Record<Exclude<ActiveDrawTool, 'none'>, string> = {
  point: 'Point',
  line: 'Line',
  polygon: 'Polygon',
  rectangle: 'Rectangle',
  circle: 'Circle',
};

function formatMetresAndKm(meters: number | undefined): string {
  const m = Number.isFinite(meters) ? Number(meters) : 0;
  return `${m.toFixed(1)} m (${(m / 1000).toFixed(2)} km)`;
}

export function DrawMeasureToolbox({
  activeTool,
  onSelectTool,
  draftPoints,
  circleRadiusDraft,
  onChangeCircleRadiusDraft,
  onFinishDraft,
  onCancelDraft,
  drawnShapes,
  selectedShapeId,
  onSelectShape,
  onUpdateShape,
  onDeleteShape,
  onClearAllShapes,
  activeSpatialFilterShapeId,
  onToggleSpatialFilterShape,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  areaUnit,
  onCloseToolbox,
  onCenterOnShape,
  canCreateListing = false,
  createPermissionReason,
  onCreateListingFromShape,
  mapViewportRef,
  mapToolbarPosition = 'top-right',
  mobileBottomOffsetClass = 'bottom-[92px] lg:bottom-7',
  mobileSheetState = 'partial',
  hasSelectedListing = false,
  hasActiveClusterSummary = false,
  hasHoveredListingPreview = false,
  hasCameraMoved = false,
  isFullscreenMap = false,
  isSplitScreen = false,
  isMobileLandscape = false,
  onPositionChange,
}: DrawMeasureToolboxProps) {
  const [position, setPosition] = useState<MapToolbarPosition>('top-left');
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [isPositionPopoverOpen, setIsPositionPopoverOpen] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isSavedOpen, setIsSavedOpen] = useState(true);
  const [editingVertexIdx, setEditingVertexIdx] = useState<number>(0);

  const toolboxRef = useRef<HTMLDivElement | null>(null);
  const dragSuppressClickRef = useRef<boolean>(false);

  // Hydrate persisted dock position & collapsed state after mount
  useEffect(() => {
    queueMicrotask(() => {
      try {
        const savedPos = localStorage.getItem(
          DRAW_TOOLBOX_STORAGE_KEY
        ) as MapToolbarPosition | null;
        if (savedPos && DRAW_TOOLBOX_POSITION_LABELS[savedPos]) {
          setPosition(savedPos);
          onPositionChange?.(savedPos);
        }

        const savedCollapsed = localStorage.getItem(
          DRAW_TOOLBOX_COLLAPSED_STORAGE_KEY
        );
        if (savedCollapsed === 'true' || savedCollapsed === 'false') {
          setIsCollapsed(savedCollapsed === 'true');
        }
      } catch {
        // ignore storage errors
      }
    });
  }, [onPositionChange]);

  const updateToolboxPosition = (nextPos: MapToolbarPosition) => {
    setPosition(nextPos);
    onPositionChange?.(nextPos);
    try {
      localStorage.setItem(DRAW_TOOLBOX_STORAGE_KEY, nextPos);
    } catch {
      // ignore storage errors
    }
  };

  const updateCollapsedState = (nextCollapsed: boolean) => {
    setIsCollapsed(nextCollapsed);
    if (nextCollapsed) {
      setIsPositionPopoverOpen(false);
    }
    try {
      localStorage.setItem(
        DRAW_TOOLBOX_COLLAPSED_STORAGE_KEY,
        nextCollapsed ? 'true' : 'false'
      );
    } catch {
      // ignore storage errors
    }
  };

  // Close position popover on Escape or outside click
  useEffect(() => {
    if (!isPositionPopoverOpen) return;
    const handleOutside = (ev: MouseEvent) => {
      if (
        toolboxRef.current &&
        !toolboxRef.current.contains(ev.target as Node)
      ) {
        setIsPositionPopoverOpen(false);
      }
    };
    const handleKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        setIsPositionPopoverOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isPositionPopoverOpen]);

  // Pointer drag-to-reposition inside map viewport (> 6px threshold distinguishes drag from click)
  const handleDragStart = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const startX = e.clientX;
    const startY = e.clientY;
    let movedEnough = false;
    dragSuppressClickRef.current = false;

    const resolveContainer = (): HTMLElement | null =>
      mapViewportRef?.current || toolboxRef.current?.parentElement || null;

    const handlePointerMove = (moveEv: PointerEvent) => {
      if (
        !movedEnough &&
        Math.hypot(moveEv.clientX - startX, moveEv.clientY - startY) > 6
      ) {
        movedEnough = true;
        dragSuppressClickRef.current = true;
        setIsDragging(true);
        setIsPositionPopoverOpen(false);
      }
      if (!movedEnough) return;

      const container = resolveContainer();
      if (!container) return;
      const rect = container.getBoundingClientRect();
      const relX = (moveEv.clientX - rect.left) / Math.max(1, rect.width);
      const relY = (moveEv.clientY - rect.top) / Math.max(1, rect.height);
      const snapped = snapPointerToDockPosition(relX, relY);
      setPosition(snapped);
    };

    const handlePointerUp = (upEv: PointerEvent) => {
      window.removeEventListener('pointermove', handlePointerMove);
      window.removeEventListener('pointerup', handlePointerUp);
      if (!movedEnough) return;

      setIsDragging(false);
      const container = resolveContainer();
      if (container) {
        const rect = container.getBoundingClientRect();
        const relX = (upEv.clientX - rect.left) / Math.max(1, rect.width);
        const relY = (upEv.clientY - rect.top) / Math.max(1, rect.height);
        const snapped = snapPointerToDockPosition(relX, relY);
        updateToolboxPosition(snapped);
      }
      setTimeout(() => {
        dragSuppressClickRef.current = false;
      }, 50);
    };

    window.addEventListener('pointermove', handlePointerMove);
    window.addEventListener('pointerup', handlePointerUp);
  };

  // Keyboard navigation for repositioning via the drag/dock handle button
  const handlePositionButtonKeyDown = (
    e: React.KeyboardEvent<HTMLButtonElement>
  ) => {
    const currentIdx = ALL_DOCK_POSITIONS.indexOf(position);
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
      e.preventDefault();
      const nextIdx = (currentIdx + 1) % ALL_DOCK_POSITIONS.length;
      updateToolboxPosition(ALL_DOCK_POSITIONS[nextIdx]);
    } else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
      e.preventDefault();
      const prevIdx =
        (currentIdx - 1 + ALL_DOCK_POSITIONS.length) %
        ALL_DOCK_POSITIONS.length;
      updateToolboxPosition(ALL_DOCK_POSITIONS[prevIdx]);
    } else if (e.key === 'Escape' && isPositionPopoverOpen) {
      e.preventDefault();
      setIsPositionPopoverOpen(false);
    }
  };

  const dockLayout = resolveDrawToolboxDockLayout({
    position,
    isCollapsed,
    mapToolbarPosition,
    mobileBottomOffsetClass,
    mobileSheetState,
    hasSelectedListing,
    hasActiveClusterSummary,
    hasHoveredListingPreview,
    hasCameraMoved,
    isFullscreenMap,
    isSplitScreen,
    isMobileLandscape,
  });

  // Contextual "Create Listing Here" category & property type state
  const [createCategory, setCreateCategory] =
    useState<ListingCategory>('real_estate');
  const [createPropertyType, setCreatePropertyType] =
    useState<PropertyType>('plot_land');
  const [createCommercialHasPlot, setCreateCommercialHasPlot] =
    useState<boolean>(true);

  const selectedShape =
    drawnShapes.find((s) => s.id === selectedShapeId) || null;

  const safeVertexIdx =
    selectedShape && selectedShape.coordinates.length > 0
      ? Math.min(editingVertexIdx, selectedShape.coordinates.length - 1)
      : 0;

  // Live draft measurements while drawing a line, polygon, rectangle, or circle
  const draftLineMetrics =
    activeTool === 'line' && draftPoints.length >= 2
      ? calculateLineSegmentsMeters(draftPoints)
      : null;
  const draftPolyMetrics =
    activeTool === 'polygon' && draftPoints.length >= 3
      ? calculatePolygonMetrics(draftPoints)
      : null;
  const draftCircleMetrics =
    activeTool === 'circle' ? calculateCircleMetrics(circleRadiusDraft) : null;

  const handleNudgeShape = (shape: DrawnShape, dLat: number, dLng: number) => {
    const moved = translateShapeCoordinates(shape, dLat, dLng);
    onUpdateShape(moved);
  };

  const handleResizeCircle = (shape: DrawnShape, nextRadius: number) => {
    const clamped = Math.max(10, Math.min(10000, nextRadius || 25));
    const metrics = calculateCircleMetrics(clamped);
    onUpdateShape({
      ...shape,
      radiusMeters: metrics.radiusMeters,
      diameterMeters: metrics.diameterMeters,
      circumferenceMeters: metrics.circumferenceMeters,
      areaSqm: metrics.areaSqm,
      perimeterMeters: metrics.perimeterMeters,
    });
  };

  const handleResizeRectangle = (
    shape: DrawnShape,
    scaleLatFactor: number,
    scaleLngFactor: number
  ) => {
    const resized = resizeRectangleShape(shape, scaleLatFactor, scaleLngFactor);
    onUpdateShape(resized);
  };

  const handleUpdatePointCoords = (
    shape: DrawnShape,
    nextLat: number,
    nextLng: number
  ) => {
    if (!Number.isFinite(nextLat) || !Number.isFinite(nextLng)) return;
    const pt = {
      lat: Number(nextLat.toFixed(6)),
      lng: Number(nextLng.toFixed(6)),
    };
    onUpdateShape({
      ...shape,
      coordinates: [pt],
      center: pt,
    });
  };

  const handleUpdateVertex = (
    shape: DrawnShape,
    vertexIndex: number,
    dLat: number,
    dLng: number
  ) => {
    const nextCoords = shape.coordinates.map((pt, idx) =>
      idx === vertexIndex
        ? {
            lat: Number((pt.lat + dLat).toFixed(6)),
            lng: Number((pt.lng + dLng).toFixed(6)),
          }
        : pt
    );
    if (shape.type === 'line') {
      const segs = calculateLineSegmentsMeters(nextCoords);
      onUpdateShape({
        ...shape,
        coordinates: nextCoords,
        distanceMeters: segs.totalMeters,
        segmentDistancesMeters: segs.segments,
      });
    } else if (shape.type === 'polygon' || shape.type === 'rectangle') {
      const poly = calculatePolygonMetrics(nextCoords);
      onUpdateShape({
        ...shape,
        coordinates: nextCoords,
        areaSqm: poly.areaSqm,
        perimeterMeters: poly.perimeterMeters,
      });
    } else {
      onUpdateShape({
        ...shape,
        coordinates: nextCoords,
      });
    }
  };

  // Collapsed State: Compact 40x40px floating icon button with active tool & shape count badges
  // Clickable to expand and draggable to reposition across all 6 docking zones
  if (isCollapsed) {
    return (
      <div
        ref={toolboxRef}
        data-testid="draw-measure-toolbox"
        data-collapsed="true"
        data-position={position}
        role="region"
        aria-label={`Draw and Measure map toolbox (Collapsed, ${DRAW_TOOLBOX_POSITION_LABELS[position]})`}
        className={`absolute z-30 pointer-events-auto transition-all duration-150 ${dockLayout.positionClasses} ${
          isDragging ? 'ring-2 ring-[var(--ps-accent)] scale-[1.03]' : ''
        }`}
      >
        <button
          type="button"
          onPointerDown={handleDragStart}
          onClick={() => {
            if (dragSuppressClickRef.current) return;
            updateCollapsedState(false);
          }}
          onKeyDown={handlePositionButtonKeyDown}
          aria-label="Expand Draw and Measure toolbox"
          aria-expanded={false}
          title={`Expand Draw & Measure (${DRAW_TOOLBOX_POSITION_LABELS[position]}) — Click to open or drag to reposition`}
          data-testid="draw-toolbox-expand-btn"
          className="relative w-11 h-11 min-w-[44px] min-h-[44px] rounded-2xl bg-[var(--ps-surface)]/95 backdrop-blur-md border border-[var(--ps-border)] shadow-xl text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] hover:border-[var(--ps-accent)]/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)] flex items-center justify-center transition-colors touch-none cursor-grab active:cursor-grabbing"
        >
          <Pencil className="w-4 h-4 text-[var(--ps-accent)] shrink-0" />
          {drawnShapes.length > 0 && (
            <span
              data-testid="draw-collapsed-count-badge"
              className="absolute -top-1 -right-1 min-w-[16px] h-[16px] px-1 rounded-full bg-emerald-600 text-white text-[9px] font-bold tabular-nums flex items-center justify-center shadow-xs"
            >
              {drawnShapes.length}
            </span>
          )}
          {activeTool !== 'none' && (
            <span
              data-testid="draw-active-tool-badge"
              className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 px-1 py-0.2 rounded bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-[8px] font-extrabold uppercase tracking-tight whitespace-nowrap shadow-xs"
            >
              {TOOL_LABELS[activeTool]}
            </span>
          )}
        </button>
      </div>
    );
  }

  const willReceivePlotBoundary =
    selectedShape &&
    (selectedShape.type === 'polygon' || selectedShape.type === 'rectangle') &&
    createCategory === 'real_estate' &&
    shouldShowPlotAndBoundary(
      createPropertyType,
      createPropertyType === 'commercial' ? createCommercialHasPlot : true
    );

  return (
    <div
      ref={toolboxRef}
      data-testid="draw-measure-toolbox"
      data-collapsed="false"
      data-position={position}
      role="region"
      aria-label="Draw and Measure map toolbox"
      className={`absolute z-30 ${dockLayout.positionClasses} ${
        isMobileLandscape
          ? 'w-[280px] max-w-[calc(100%-76px)]'
          : dockLayout.isCoDockedWithMapToolbar
            ? 'w-[calc(100%-20px)] max-w-[calc(100%-20px)] sm:w-[320px] sm:max-w-[calc(100%-68px)]'
            : 'w-[calc(100%-76px)] max-w-[calc(100%-76px)] sm:w-[320px] sm:max-w-[calc(100%-76px)]'
      } ${dockLayout.maxHeightClasses} rounded-2xl bg-[var(--ps-surface)]/95 backdrop-blur-md border border-[var(--ps-border)] shadow-2xl flex flex-col overflow-hidden pointer-events-auto transition-shadow duration-150 ${
        isDragging ? 'ring-2 ring-[var(--ps-accent)] scale-[1.01]' : ''
      }`}
    >
      {/* Compact Header with Dedicated Drag Handle */}
      <div className="px-1.5 py-1 bg-[var(--ps-surface-alt)] border-b border-[var(--ps-border)] flex items-center justify-between gap-0.5 shrink-0">
        <div className="flex items-center gap-0.5 min-w-0">
          {/* Dedicated Drag Handle & 6-Position Docking Trigger */}
          <button
            type="button"
            onPointerDown={handleDragStart}
            onClick={() => {
              if (dragSuppressClickRef.current) return;
              setIsPositionPopoverOpen((prev) => !prev);
            }}
            onKeyDown={handlePositionButtonKeyDown}
            title={`Move Draw & Measure Toolbox (${DRAW_TOOLBOX_POSITION_LABELS[position]}) — Drag handle or click for 6-position dock menu`}
            aria-label={`Reposition Draw and Measure toolbox (currently ${DRAW_TOOLBOX_POSITION_LABELS[position]})`}
            aria-expanded={isPositionPopoverOpen}
            data-testid="draw-toolbox-position-btn"
            className="w-11 h-11 min-w-[44px] min-h-[44px] flex items-center justify-center shrink-0 cursor-grab active:cursor-grabbing touch-none focus-visible:outline-none group"
          >
            <span
              className={`w-8 h-8 rounded-lg flex items-center justify-center transition-colors group-focus-visible:ring-2 group-focus-visible:ring-[var(--ps-ring)] ${
                isPositionPopoverOpen
                  ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                  : 'text-[var(--ps-text-muted)] group-hover:text-[var(--ps-text)] group-hover:bg-[var(--ps-surface)]'
              }`}
            >
              <GripVertical className="w-3.5 h-3.5" />
            </span>
          </button>

          <Pencil className="w-3.5 h-3.5 text-[var(--ps-accent)] shrink-0 ml-0.5" />
          <span className="text-xs font-bold text-[var(--ps-text)] truncate ml-1">
            Draw &amp; Measure ({areaUnit === 'sqm' ? 'm²' : areaUnit})
          </span>
          {activeTool !== 'none' && (
            <span
              data-testid="draw-active-tool-badge"
              className="px-1.5 py-0.5 rounded bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-[9px] font-bold uppercase shrink-0 ml-1"
            >
              {TOOL_LABELS[activeTool]}
            </span>
          )}
        </div>
        <div className="flex items-center shrink-0">
          <button
            type="button"
            onClick={onUndo}
            disabled={!canUndo}
            title="Undo drawing action"
            aria-label="Undo drawing action"
            data-testid="draw-undo-btn"
            className="w-11 h-11 min-w-[44px] min-h-[44px] flex items-center justify-center shrink-0 disabled:pointer-events-none focus-visible:outline-none group"
          >
            <span className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--ps-text)] group-hover:bg-[var(--ps-surface)] group-disabled:opacity-35 transition-opacity group-focus-visible:ring-2 group-focus-visible:ring-[var(--ps-ring)]">
              <Undo2 className="w-3.5 h-3.5" />
            </span>
          </button>
          <button
            type="button"
            onClick={onRedo}
            disabled={!canRedo}
            title="Redo drawing action"
            aria-label="Redo drawing action"
            data-testid="draw-redo-btn"
            className="w-11 h-11 min-w-[44px] min-h-[44px] flex items-center justify-center shrink-0 disabled:pointer-events-none focus-visible:outline-none group"
          >
            <span className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--ps-text)] group-hover:bg-[var(--ps-surface)] group-disabled:opacity-35 transition-opacity group-focus-visible:ring-2 group-focus-visible:ring-[var(--ps-ring)]">
              <Redo2 className="w-3.5 h-3.5" />
            </span>
          </button>
          <button
            type="button"
            onClick={() => updateCollapsedState(true)}
            title="Collapse Draw & Measure toolbox into compact icon"
            aria-label="Collapse Draw and Measure toolbox"
            aria-expanded={true}
            data-testid="draw-toolbox-collapse-btn"
            className="w-11 h-11 min-w-[44px] min-h-[44px] flex items-center justify-center shrink-0 focus-visible:outline-none group"
          >
            <span className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--ps-text-muted)] group-hover:text-[var(--ps-text)] group-hover:bg-[var(--ps-surface)] group-focus-visible:ring-2 group-focus-visible:ring-[var(--ps-ring)]">
              <Minimize2 className="w-3.5 h-3.5" />
            </span>
          </button>
          <button
            type="button"
            onClick={onCloseToolbox}
            title="Close Draw & Measure toolbox"
            aria-label="Close Draw and Measure toolbox"
            data-testid="draw-close-btn"
            className="w-11 h-11 min-w-[44px] min-h-[44px] flex items-center justify-center shrink-0 focus-visible:outline-none group"
          >
            <span className="w-8 h-8 rounded-lg flex items-center justify-center text-[var(--ps-text-muted)] group-hover:text-[var(--ps-text)] group-hover:bg-[var(--ps-surface)] group-focus-visible:ring-2 group-focus-visible:ring-[var(--ps-ring)]">
              <X className="w-3.5 h-3.5" />
            </span>
          </button>
        </div>
      </div>

      {/* Accessible 6-Position Docking Bar (Toggled via Drag/Position Handle) */}
      {isPositionPopoverOpen && (
        <div
          data-testid="draw-toolbox-position-popover"
          role="dialog"
          aria-label="Select Draw and Measure toolbox docking position"
          className="px-2.5 py-2 bg-[var(--ps-bg)] border-b border-[var(--ps-border)] space-y-1.5 text-xs shrink-0 ps-animate-in-popover"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-[var(--ps-text)] flex items-center gap-1">
              <Move className="w-3 h-3 text-[var(--ps-accent)]" />
              Docking Position
            </span>
            <span className="text-[10px] text-[var(--ps-text-muted)]">
              Drag handle or select slot
            </span>
          </div>
          <div className="grid grid-cols-3 gap-1">
            {ALL_DOCK_POSITIONS.map((pos) => (
              <button
                key={pos}
                type="button"
                onClick={() => {
                  updateToolboxPosition(pos);
                  setIsPositionPopoverOpen(false);
                }}
                aria-pressed={position === pos}
                data-testid={`draw-toolbox-pos-${pos}`}
                className={`px-2 py-1.5 rounded-lg border text-[10px] font-semibold text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)] ${
                  position === pos
                    ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] border-[var(--ps-accent)]'
                    : 'bg-[var(--ps-surface)] text-[var(--ps-text)] border-[var(--ps-border)] hover:bg-[var(--ps-surface-alt)]'
                }`}
              >
                {DRAW_TOOLBOX_POSITION_LABELS[pos]}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Internal Scrollable Body */}
      <div
        data-testid="draw-toolbox-scroll-body"
        className="flex-1 min-h-0 overflow-y-auto overscroll-contain p-2.5 space-y-2.5 text-xs"
      >
        {/* 5 Compact Tool Selector Buttons */}
        <div
          className="grid grid-cols-5 gap-1"
          role="group"
          aria-label="Drawing tools"
        >
          {(
            [
              { id: 'point', label: 'Point', icon: MapPin },
              { id: 'line', label: 'Line', icon: Minus },
              { id: 'polygon', label: 'Polygon', icon: Hexagon },
              { id: 'rectangle', label: 'Rect', icon: Square },
              { id: 'circle', label: 'Circle', icon: CircleIcon },
            ] as const
          ).map((tool) => {
            const Icon = tool.icon;
            const isActive = activeTool === tool.id;
            return (
              <button
                key={tool.id}
                type="button"
                onClick={() => onSelectTool(isActive ? 'none' : tool.id)}
                aria-label={`${tool.label} tool`}
                title={`${tool.label} tool`}
                aria-pressed={isActive}
                data-testid={`draw-tool-${tool.id}`}
                className={`min-h-[44px] flex flex-col items-center justify-center gap-0.5 py-1.5 px-1 rounded-xl border text-[10px] font-semibold transition-colors ${
                  isActive
                    ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] border-[var(--ps-accent)] shadow-xs'
                    : 'bg-[var(--ps-bg)] text-[var(--ps-text)] border-[var(--ps-border)] hover:bg-[var(--ps-surface-alt)]'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tool.label}</span>
              </button>
            );
          })}
        </div>

        {/* Active Tool Guidance & Live Draft Measurements (Shown ONLY when a tool is active) */}
        {activeTool !== 'none' && (
          <div
            data-testid="draw-active-guidance"
            className="p-2 rounded-xl bg-[var(--ps-bg)] border border-[var(--ps-accent)]/50 space-y-1.5"
          >
            {activeTool === 'point' && (
              <div className="text-[11px] text-[var(--ps-text)] leading-snug">
                <strong>Point Tool Active:</strong> Tap or click on the map to place a marker pin and open its title &amp; description editor.
              </div>
            )}

            {activeTool === 'line' && (
              <div className="space-y-1.5">
                <div className="text-[11px] text-[var(--ps-text)]">
                  <strong>Line Tool ({draftPoints.length} vertices):</strong> Click map to add vertices.
                </div>
                {draftLineMetrics && (
                  <div className="p-2 rounded-lg bg-[var(--ps-surface)] border border-[var(--ps-border)] space-y-1 text-[11px]">
                    <div className="flex justify-between font-bold text-[var(--ps-text)]">
                      <span>Total Distance:</span>
                      <span className="tabular-nums">
                        {formatMetresAndKm(draftLineMetrics.totalMeters)}
                      </span>
                    </div>
                    <div className="text-[10px] text-[var(--ps-text-muted)]">
                      Segments:{' '}
                      {draftLineMetrics.segments
                        .map(
                          (s, i) =>
                            `S${i + 1}: ${s.toFixed(1)}m (${(s / 1000).toFixed(2)}km)`
                        )
                        .join(' · ')}
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={draftPoints.length < 2}
                    onClick={onFinishDraft}
                    data-testid="draw-finish-btn"
                    className="flex-1 py-1.5 px-2.5 rounded-lg bg-emerald-600 text-white text-[11px] font-semibold disabled:opacity-40 inline-flex items-center justify-center gap-1"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Finish Line</span>
                  </button>
                  <button
                    type="button"
                    onClick={onCancelDraft}
                    data-testid="draw-cancel-btn"
                    className="py-1.5 px-2.5 rounded-lg border border-[var(--ps-border)] text-[11px] font-semibold text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {activeTool === 'polygon' && (
              <div className="space-y-1.5">
                <div className="text-[11px] text-[var(--ps-text)]">
                  <strong>Polygon Tool ({draftPoints.length} vertices):</strong> Click map to add boundary corners (min 3).
                </div>
                {draftPolyMetrics && (
                  <div className="p-2 rounded-lg bg-[var(--ps-surface)] border border-[var(--ps-border)] space-y-1 text-[11px]">
                    <div className="flex justify-between font-bold text-[var(--ps-text)]">
                      <span>Area (m²):</span>
                      <span className="tabular-nums">
                        {formatArea(draftPolyMetrics.areaSqm, 'sqm')}
                      </span>
                    </div>
                    <div className="flex justify-between text-[var(--ps-text-muted)]">
                      <span>Perimeter:</span>
                      <span className="tabular-nums">
                        {formatMetresAndKm(draftPolyMetrics.perimeterMeters)}
                      </span>
                    </div>
                  </div>
                )}
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    disabled={draftPoints.length < 3}
                    onClick={onFinishDraft}
                    data-testid="draw-finish-btn"
                    className="flex-1 py-1.5 px-2.5 rounded-lg bg-emerald-600 text-white text-[11px] font-semibold disabled:opacity-40 inline-flex items-center justify-center gap-1"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Close Polygon</span>
                  </button>
                  <button
                    type="button"
                    onClick={onCancelDraft}
                    data-testid="draw-cancel-btn"
                    className="py-1.5 px-2.5 rounded-lg border border-[var(--ps-border)] text-[11px] font-semibold text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}

            {activeTool === 'rectangle' && (
              <div className="space-y-1.5">
                <div className="text-[11px] text-[var(--ps-text)]">
                  <strong>Rectangle Tool ({draftPoints.length}/2 corners):</strong> Click first corner on map, then click opposite corner.
                </div>
                {draftPoints.length > 0 && (
                  <button
                    type="button"
                    onClick={onCancelDraft}
                    data-testid="draw-cancel-btn"
                    className="w-full py-1.5 px-2.5 rounded-lg border border-[var(--ps-border)] text-[11px] font-semibold text-[var(--ps-text-muted)]"
                  >
                    Cancel Rectangle
                  </button>
                )}
              </div>
            )}

            {activeTool === 'circle' && draftCircleMetrics && (
              <div className="space-y-1.5">
                <div className="text-[11px] text-[var(--ps-text)]">
                  <strong>Circle Tool:</strong> Set default radius below, then click map to place circle centre.
                </div>
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-[11px]">
                    <span className="text-[var(--ps-text-muted)]">Radius:</span>
                    <span className="font-bold tabular-nums">
                      {formatMetresAndKm(draftCircleMetrics.radiusMeters)}
                    </span>
                  </div>
                  <input
                    type="range"
                    min={50}
                    max={3000}
                    step={25}
                    value={circleRadiusDraft}
                    onChange={(e) =>
                      onChangeCircleRadiusDraft(Number(e.target.value))
                    }
                    aria-label="Default circle radius in metres"
                    data-testid="draft-circle-radius-slider"
                    className="w-full accent-[var(--ps-accent)]"
                  />
                  <div className="flex justify-between text-[10px] text-[var(--ps-text-muted)] tabular-nums">
                    <span>
                      Dia: {draftCircleMetrics.diameterMeters} m · Circ:{' '}
                      {draftCircleMetrics.circumferenceMeters} m
                    </span>
                    <span>
                      Area: {formatArea(draftCircleMetrics.areaSqm, 'sqm')}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Selected Shape Inspector / Editor (Shows measurement details ONLY relevant to selectedShape.type) */}
        {selectedShape && (
          <div
            data-testid="selected-shape-editor"
            className="p-2.5 rounded-xl bg-[var(--ps-bg)] border-2 border-[var(--ps-accent)] space-y-2"
          >
            <div className="flex items-center justify-between gap-1.5">
              <span className="text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded bg-[var(--ps-surface-alt)] text-[var(--ps-accent)]">
                {selectedShape.type} Inspector
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onDeleteShape(selectedShape.id)}
                  title="Delete selected drawing"
                  aria-label="Delete selected drawing"
                  data-testid="selected-shape-delete-btn"
                  className="p-1 rounded text-rose-600 hover:bg-rose-500/10"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => onSelectShape(null)}
                  aria-label="Close shape inspector"
                  data-testid="selected-shape-done-btn"
                  className="px-2 py-0.5 rounded bg-[var(--ps-surface)] border border-[var(--ps-border)] text-[10px] font-semibold text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]"
                >
                  Done
                </button>
              </div>
            </div>

            {/* Title / Rename Input */}
            <div className="space-y-0.5">
              <label className="block text-[10px] font-semibold text-[var(--ps-text-muted)]">
                Title / Label
              </label>
              <input
                type="text"
                value={selectedShape.label}
                onChange={(e) =>
                  onUpdateShape({ ...selectedShape, label: e.target.value })
                }
                aria-label="Drawing title or label"
                data-testid="shape-title-input"
                className="w-full px-2 py-1 rounded-lg bg-[var(--ps-surface)] border border-[var(--ps-border)] text-xs font-semibold text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-ring)]"
              />
            </div>

            {/* 1. POINT SPECIFIC FIELDS */}
            {selectedShape.type === 'point' && (
              <div className="space-y-1.5">
                <div className="space-y-0.5">
                  <label className="block text-[10px] font-semibold text-[var(--ps-text-muted)]">
                    Description
                  </label>
                  <textarea
                    rows={2}
                    value={selectedShape.description || ''}
                    onChange={(e) =>
                      onUpdateShape({
                        ...selectedShape,
                        description: e.target.value,
                      })
                    }
                    placeholder="Add field notes or landmark description..."
                    aria-label="Point description"
                    data-testid="point-description-input"
                    className="w-full px-2 py-1 rounded-lg bg-[var(--ps-surface)] border border-[var(--ps-border)] text-xs text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-ring)]"
                  />
                </div>
                <div className="space-y-0.5">
                  <label className="block text-[10px] font-semibold text-[var(--ps-text-muted)]">
                    Note / Tag Category
                  </label>
                  <input
                    type="text"
                    value={selectedShape.categoryNote || ''}
                    onChange={(e) =>
                      onUpdateShape({
                        ...selectedShape,
                        categoryNote: e.target.value,
                      })
                    }
                    placeholder="e.g., Site Visit, Survey Pin, Landmark"
                    aria-label="Point note or category"
                    data-testid="point-category-input"
                    className="w-full px-2 py-1 rounded-lg bg-[var(--ps-surface)] border border-[var(--ps-border)] text-xs text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-ring)]"
                  />
                </div>
                {selectedShape.coordinates[0] && (
                  <div className="grid grid-cols-2 gap-1.5 pt-0.5">
                    <div>
                      <label className="block text-[9px] font-semibold text-[var(--ps-text-muted)]">
                        Latitude
                      </label>
                      <input
                        type="number"
                        step="0.0002"
                        value={selectedShape.coordinates[0].lat}
                        onChange={(e) =>
                          handleUpdatePointCoords(
                            selectedShape,
                            parseFloat(e.target.value),
                            selectedShape.coordinates[0].lng
                          )
                        }
                        aria-label="Point latitude"
                        data-testid="point-lat-input"
                        className="w-full px-2 py-1 rounded bg-[var(--ps-surface)] border border-[var(--ps-border)] font-mono text-[11px] text-[var(--ps-text)]"
                      />
                    </div>
                    <div>
                      <label className="block text-[9px] font-semibold text-[var(--ps-text-muted)]">
                        Longitude
                      </label>
                      <input
                        type="number"
                        step="0.0002"
                        value={selectedShape.coordinates[0].lng}
                        onChange={(e) =>
                          handleUpdatePointCoords(
                            selectedShape,
                            selectedShape.coordinates[0].lat,
                            parseFloat(e.target.value)
                          )
                        }
                        aria-label="Point longitude"
                        data-testid="point-lng-input"
                        className="w-full px-2 py-1 rounded bg-[var(--ps-surface)] border border-[var(--ps-border)] font-mono text-[11px] text-[var(--ps-text)]"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 2. LINE SPECIFIC MEASUREMENTS */}
            {selectedShape.type === 'line' && (
              <div
                data-testid="line-metrics-summary"
                className="p-2 rounded-lg bg-[var(--ps-surface)] border border-[var(--ps-border)] space-y-1 text-[11px]"
              >
                <div className="flex justify-between font-bold">
                  <span>Total Distance:</span>
                  <span
                    data-testid="line-total-distance"
                    className="tabular-nums"
                  >
                    {formatMetresAndKm(selectedShape.distanceMeters)}
                  </span>
                </div>
                {selectedShape.segmentDistancesMeters &&
                  selectedShape.segmentDistancesMeters.length > 0 && (
                    <div
                      data-testid="line-segment-distances"
                      className="text-[10px] text-[var(--ps-text-muted)] leading-relaxed"
                    >
                      Segments:{' '}
                      {selectedShape.segmentDistancesMeters
                        .map(
                          (seg, idx) =>
                            `Seg ${idx + 1}: ${seg.toFixed(1)} m (${(seg / 1000).toFixed(2)} km)`
                        )
                        .join(' · ')}
                    </div>
                  )}
                <div className="text-[10px] text-[var(--ps-text-muted)]">
                  Vertices: {selectedShape.coordinates.length}
                </div>
              </div>
            )}

            {/* 3. POLYGON SPECIFIC MEASUREMENTS */}
            {selectedShape.type === 'polygon' && (
              <div className="space-y-1.5">
                <div
                  data-testid="polygon-metrics-summary"
                  className="p-2 rounded-lg bg-[var(--ps-surface)] border border-[var(--ps-border)] space-y-1 text-[11px]"
                >
                  <div className="flex justify-between font-bold">
                    <span>Area (m²):</span>
                    <span
                      data-testid="polygon-area-sqm"
                      className="tabular-nums"
                    >
                      {formatArea(selectedShape.areaSqm, 'sqm')}
                    </span>
                  </div>
                  {areaUnit !== 'sqm' && (
                    <div className="flex justify-between text-[var(--ps-text-muted)]">
                      <span>Converted Area:</span>
                      <span className="tabular-nums">
                        {formatArea(selectedShape.areaSqm, areaUnit)}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between text-[var(--ps-text-muted)]">
                    <span>Perimeter:</span>
                    <span
                      data-testid="polygon-perimeter"
                      className="tabular-nums"
                    >
                      {formatMetresAndKm(selectedShape.perimeterMeters)}
                    </span>
                  </div>
                  <div className="flex justify-between text-[10px] text-[var(--ps-text-muted)]">
                    <span>Vertices:</span>
                    <span>{selectedShape.coordinates.length} corners</span>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    onToggleSpatialFilterShape(
                      activeSpatialFilterShapeId === selectedShape.id
                        ? null
                        : selectedShape.id
                    )
                  }
                  data-testid="search-inside-shape-btn"
                  className={`w-full py-1.5 px-2.5 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                    activeSpatialFilterShapeId === selectedShape.id
                      ? 'bg-emerald-600 text-white'
                      : 'bg-[var(--ps-surface)] border border-[var(--ps-border)] text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                  }`}
                >
                  <Filter className="w-3.5 h-3.5" />
                  <span>
                    {activeSpatialFilterShapeId === selectedShape.id
                      ? 'Filtering Listings Inside Area (Active)'
                      : 'Search listings inside this area'}
                  </span>
                </button>
              </div>
            )}

            {/* 4. RECTANGLE SPECIFIC MEASUREMENTS + RESIZE & MOVE */}
            {selectedShape.type === 'rectangle' && (
              <div className="space-y-1.5">
                <div
                  data-testid="rectangle-metrics-summary"
                  className="p-2 rounded-lg bg-[var(--ps-surface)] border border-[var(--ps-border)] space-y-1 text-[11px]"
                >
                  <div className="flex justify-between font-bold">
                    <span>Area (m²):</span>
                    <span
                      data-testid="rectangle-area-sqm"
                      className="tabular-nums"
                    >
                      {formatArea(selectedShape.areaSqm, 'sqm')}
                    </span>
                  </div>
                  {areaUnit !== 'sqm' && (
                    <div className="flex justify-between text-[var(--ps-text-muted)]">
                      <span>Converted Area:</span>
                      <span className="tabular-nums">
                        {formatArea(selectedShape.areaSqm, areaUnit)}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between text-[var(--ps-text-muted)]">
                    <span>Perimeter:</span>
                    <span
                      data-testid="rectangle-perimeter"
                      className="tabular-nums"
                    >
                      {formatMetresAndKm(selectedShape.perimeterMeters)}
                    </span>
                  </div>
                </div>

                {/* Rectangle Orthogonal Resize Controls */}
                <div className="p-2 rounded-lg bg-[var(--ps-surface)] border border-[var(--ps-border)] space-y-1">
                  <div className="text-[10px] font-semibold text-[var(--ps-text-muted)]">
                    Resize Rectangle Dimensions
                  </div>
                  <div className="grid grid-cols-4 gap-1">
                    <button
                      type="button"
                      onClick={() =>
                        handleResizeRectangle(selectedShape, 1, 0.85)
                      }
                      title="Decrease rectangle width"
                      aria-label="Decrease rectangle width"
                      data-testid="rect-resize-narrower-btn"
                      className="py-1 px-1.5 rounded bg-[var(--ps-bg)] border border-[var(--ps-border)] hover:bg-[var(--ps-surface-alt)] text-[10px] font-semibold"
                    >
                      Width −
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleResizeRectangle(selectedShape, 1, 1.15)
                      }
                      title="Increase rectangle width"
                      aria-label="Increase rectangle width"
                      data-testid="rect-resize-wider-btn"
                      className="py-1 px-1.5 rounded bg-[var(--ps-bg)] border border-[var(--ps-border)] hover:bg-[var(--ps-surface-alt)] text-[10px] font-semibold"
                    >
                      Width +
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleResizeRectangle(selectedShape, 0.85, 1)
                      }
                      title="Decrease rectangle height"
                      aria-label="Decrease rectangle height"
                      data-testid="rect-resize-shorter-btn"
                      className="py-1 px-1.5 rounded bg-[var(--ps-bg)] border border-[var(--ps-border)] hover:bg-[var(--ps-surface-alt)] text-[10px] font-semibold"
                    >
                      Height −
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        handleResizeRectangle(selectedShape, 1.15, 1)
                      }
                      title="Increase rectangle height"
                      aria-label="Increase rectangle height"
                      data-testid="rect-resize-taller-btn"
                      className="py-1 px-1.5 rounded bg-[var(--ps-bg)] border border-[var(--ps-border)] hover:bg-[var(--ps-surface-alt)] text-[10px] font-semibold"
                    >
                      Height +
                    </button>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={() =>
                    onToggleSpatialFilterShape(
                      activeSpatialFilterShapeId === selectedShape.id
                        ? null
                        : selectedShape.id
                    )
                  }
                  data-testid="search-inside-shape-btn"
                  className={`w-full py-1.5 px-2.5 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                    activeSpatialFilterShapeId === selectedShape.id
                      ? 'bg-emerald-600 text-white'
                      : 'bg-[var(--ps-surface)] border border-[var(--ps-border)] text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                  }`}
                >
                  <Filter className="w-3.5 h-3.5" />
                  <span>
                    {activeSpatialFilterShapeId === selectedShape.id
                      ? 'Filtering Listings Inside Rectangle (Active)'
                      : 'Search listings within rectangle'}
                  </span>
                </button>
              </div>
            )}

            {/* 5. CIRCLE SPECIFIC MEASUREMENTS + RADIUS RESIZE */}
            {selectedShape.type === 'circle' && (
              <div className="space-y-1.5">
                <div
                  data-testid="circle-metrics-summary"
                  className="p-2 rounded-lg bg-[var(--ps-surface)] border border-[var(--ps-border)] space-y-1 text-[11px]"
                >
                  <div className="flex justify-between font-bold">
                    <span>Area (m²):</span>
                    <span
                      data-testid="circle-area-sqm"
                      className="tabular-nums"
                    >
                      {formatArea(selectedShape.areaSqm, 'sqm')}
                    </span>
                  </div>
                  {selectedShape.center && (
                    <div className="flex justify-between text-[10px] text-[var(--ps-text-muted)]">
                      <span>Centre:</span>
                      <span
                        data-testid="circle-center-coords"
                        className="font-mono tabular-nums"
                      >
                        {selectedShape.center.lat.toFixed(5)},{' '}
                        {selectedShape.center.lng.toFixed(5)}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between text-[var(--ps-text-muted)]">
                    <span>Radius:</span>
                    <span
                      data-testid="circle-radius-value"
                      className="tabular-nums"
                    >
                      {formatMetresAndKm(selectedShape.radiusMeters)}
                    </span>
                  </div>
                  <div className="flex justify-between text-[var(--ps-text-muted)]">
                    <span>Diameter:</span>
                    <span
                      data-testid="circle-diameter-value"
                      className="tabular-nums"
                    >
                      {formatMetresAndKm(
                        selectedShape.diameterMeters ||
                          (selectedShape.radiusMeters || 0) * 2
                      )}
                    </span>
                  </div>
                  <div className="flex justify-between text-[var(--ps-text-muted)]">
                    <span>Circumference (2πr):</span>
                    <span
                      data-testid="circle-circumference-value"
                      className="tabular-nums"
                    >
                      {formatMetresAndKm(
                        selectedShape.circumferenceMeters ||
                          selectedShape.perimeterMeters
                      )}
                    </span>
                  </div>
                </div>

                {/* Resize Circle Radius Control */}
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2 text-[10px] font-semibold text-[var(--ps-text-muted)]">
                    <span>Resize Radius (m)</span>
                    <input
                      type="number"
                      min={10}
                      max={10000}
                      step={25}
                      value={selectedShape.radiusMeters || 300}
                      onChange={(e) =>
                        handleResizeCircle(
                          selectedShape,
                          Number(e.target.value)
                        )
                      }
                      aria-label="Circle radius in metres"
                      data-testid="circle-radius-input"
                      className="w-20 px-1.5 py-0.5 rounded bg-[var(--ps-surface)] border border-[var(--ps-border)] font-mono text-[11px] text-right text-[var(--ps-text)]"
                    />
                  </div>
                  <input
                    type="range"
                    min={25}
                    max={3000}
                    step={25}
                    value={selectedShape.radiusMeters || 300}
                    onChange={(e) =>
                      handleResizeCircle(selectedShape, Number(e.target.value))
                    }
                    aria-label="Resize circle radius slider"
                    data-testid="circle-radius-slider"
                    className="w-full accent-[var(--ps-accent)]"
                  />
                </div>

                <button
                  type="button"
                  onClick={() =>
                    onToggleSpatialFilterShape(
                      activeSpatialFilterShapeId === selectedShape.id
                        ? null
                        : selectedShape.id
                    )
                  }
                  data-testid="search-inside-shape-btn"
                  className={`w-full py-1.5 px-2.5 rounded-lg text-[11px] font-semibold flex items-center justify-center gap-1.5 transition-colors ${
                    activeSpatialFilterShapeId === selectedShape.id
                      ? 'bg-emerald-600 text-white'
                      : 'bg-[var(--ps-surface)] border border-[var(--ps-border)] text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                  }`}
                >
                  <Filter className="w-3.5 h-3.5" />
                  <span>
                    {activeSpatialFilterShapeId === selectedShape.id
                      ? 'Filtering Listings Within Radius (Active)'
                      : 'Search listings within radius'}
                  </span>
                </button>
              </div>
            )}

            {/* Reposition / Move Shape & Vertex Inspector Controls */}
            <div className="pt-1.5 border-t border-[var(--ps-border)] space-y-1.5">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-semibold text-[var(--ps-text-muted)]">
                  Move / Reposition
                </span>
                <div className="flex items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handleNudgeShape(selectedShape, 0.0004, 0)}
                    title="Move North"
                    aria-label="Move shape North"
                    data-testid="shape-nudge-north-btn"
                    className="p-1 rounded bg-[var(--ps-surface)] border border-[var(--ps-border)] hover:bg-[var(--ps-surface-alt)]"
                  >
                    <ArrowUp className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleNudgeShape(selectedShape, -0.0004, 0)}
                    title="Move South"
                    aria-label="Move shape South"
                    data-testid="shape-nudge-south-btn"
                    className="p-1 rounded bg-[var(--ps-surface)] border border-[var(--ps-border)] hover:bg-[var(--ps-surface-alt)]"
                  >
                    <ArrowDown className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleNudgeShape(selectedShape, 0, -0.0004)}
                    title="Move West"
                    aria-label="Move shape West"
                    data-testid="shape-nudge-west-btn"
                    className="p-1 rounded bg-[var(--ps-surface)] border border-[var(--ps-border)] hover:bg-[var(--ps-surface-alt)]"
                  >
                    <ArrowLeft className="w-3 h-3" />
                  </button>
                  <button
                    type="button"
                    onClick={() => handleNudgeShape(selectedShape, 0, 0.0004)}
                    title="Move East"
                    aria-label="Move shape East"
                    data-testid="shape-nudge-east-btn"
                    className="p-1 rounded bg-[var(--ps-surface)] border border-[var(--ps-border)] hover:bg-[var(--ps-surface-alt)]"
                  >
                    <ArrowRight className="w-3 h-3" />
                  </button>
                </div>
              </div>

              {(selectedShape.type === 'line' ||
                selectedShape.type === 'polygon' ||
                selectedShape.type === 'rectangle') &&
                selectedShape.coordinates.length > 0 && (
                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-[10px] font-semibold text-[var(--ps-text-muted)]">
                        Vertex:
                      </span>
                      <select
                        aria-label="Select vertex to inspect or adjust"
                        data-testid="vertex-select"
                        value={safeVertexIdx}
                        onChange={(e) =>
                          setEditingVertexIdx(Number(e.target.value))
                        }
                        className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--ps-surface)] border border-[var(--ps-border)] font-semibold"
                      >
                        {selectedShape.coordinates.map((pt, idx) => (
                          <option key={idx} value={idx}>
                            V{idx + 1} ({pt.lat.toFixed(4)}, {pt.lng.toFixed(4)})
                          </option>
                        ))}
                      </select>
                      <div className="flex items-center gap-0.5">
                        <button
                          type="button"
                          onClick={() =>
                            handleUpdateVertex(
                              selectedShape,
                              safeVertexIdx,
                              -0.0003,
                              0
                            )
                          }
                          title="Nudge vertex South (-Lat)"
                          aria-label="Nudge vertex South"
                          data-testid="vertex-nudge-south-btn"
                          className="px-1 py-0.5 rounded bg-[var(--ps-surface)] border border-[var(--ps-border)] text-[9px] font-semibold"
                        >
                          −Lat
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleUpdateVertex(
                              selectedShape,
                              safeVertexIdx,
                              0.0003,
                              0
                            )
                          }
                          title="Nudge vertex North (+Lat)"
                          aria-label="Nudge vertex North"
                          data-testid="vertex-nudge-north-btn"
                          className="px-1 py-0.5 rounded bg-[var(--ps-surface)] border border-[var(--ps-border)] text-[9px] font-semibold"
                        >
                          +Lat
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleUpdateVertex(
                              selectedShape,
                              safeVertexIdx,
                              0,
                              -0.0003
                            )
                          }
                          title="Nudge vertex West (-Lng)"
                          aria-label="Nudge vertex West"
                          data-testid="vertex-nudge-west-btn"
                          className="px-1 py-0.5 rounded bg-[var(--ps-surface)] border border-[var(--ps-border)] text-[9px] font-semibold"
                        >
                          −Lng
                        </button>
                        <button
                          type="button"
                          onClick={() =>
                            handleUpdateVertex(
                              selectedShape,
                              safeVertexIdx,
                              0,
                              0.0003
                            )
                          }
                          title="Nudge vertex East (+Lng)"
                          aria-label="Nudge vertex East"
                          data-testid="vertex-nudge-east-btn"
                          className="px-1 py-0.5 rounded bg-[var(--ps-surface)] border border-[var(--ps-border)] text-[9px] font-semibold"
                        >
                          +Lng
                        </button>
                      </div>
                    </div>
                  </div>
                )}
            </div>

            {/* ROLE-AWARE "CREATE LISTING HERE" CONTEXTUAL ACTION */}
            <div
              data-testid="create-listing-from-shape-section"
              className="pt-2 border-t border-[var(--ps-border)] space-y-1.5"
            >
              {canCreateListing && onCreateListingFromShape ? (
                <div className="space-y-1.5">
                  <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-accent)]">
                    Create Listing from Geometry
                  </div>

                  <div className="grid grid-cols-1 gap-1.5">
                    <div>
                      <label className="block text-[10px] font-semibold text-[var(--ps-text-muted)]">
                        Listing Category
                      </label>
                      <select
                        aria-label="Select category for new listing"
                        data-testid="create-from-shape-category-select"
                        value={createCategory}
                        onChange={(e) =>
                          setCreateCategory(e.target.value as ListingCategory)
                        }
                        className="mt-0.5 w-full px-2 py-1 rounded-lg bg-[var(--ps-surface)] border border-[var(--ps-border)] text-[11px] font-semibold text-[var(--ps-text)]"
                      >
                        {(
                          Object.keys(CATEGORY_LABELS) as ListingCategory[]
                        ).map((cat) => (
                          <option key={cat} value={cat}>
                            {CATEGORY_LABELS[cat]}
                          </option>
                        ))}
                      </select>
                    </div>

                    {createCategory === 'real_estate' && (
                      <div>
                        <label className="block text-[10px] font-semibold text-[var(--ps-text-muted)]">
                          Real-Estate Property Type
                        </label>
                        <select
                          aria-label="Select property type for new real-estate listing"
                          data-testid="create-from-shape-property-type-select"
                          value={createPropertyType}
                          onChange={(e) =>
                            setCreatePropertyType(
                              e.target.value as PropertyType
                            )
                          }
                          className="mt-0.5 w-full px-2 py-1 rounded-lg bg-[var(--ps-surface)] border border-[var(--ps-border)] text-[11px] font-semibold text-[var(--ps-text)]"
                        >
                          {(
                            Object.keys(PROPERTY_TYPE_LABELS) as PropertyType[]
                          ).map((pt) => (
                            <option key={pt} value={pt}>
                              {PROPERTY_TYPE_LABELS[pt]}
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    {createCategory === 'real_estate' &&
                      createPropertyType === 'commercial' && (
                        <label className="flex items-center gap-1.5 text-[10px] font-semibold text-[var(--ps-text)]">
                          <input
                            type="checkbox"
                            data-testid="create-from-shape-commercial-plot-checkbox"
                            checked={createCommercialHasPlot}
                            onChange={(e) =>
                              setCreateCommercialHasPlot(e.target.checked)
                            }
                          />
                          <span>Commercial property includes associated plot</span>
                        </label>
                      )}
                  </div>

                  {/* Live Mapping Summary Note */}
                  <div
                    data-testid="create-from-shape-mapping-note"
                    className="p-1.5 rounded-lg bg-[var(--ps-surface)] border border-[var(--ps-border)] text-[10px] text-[var(--ps-text-muted)] leading-snug"
                  >
                    {selectedShape.type === 'point' &&
                      'Prefills listing coordinates, title, and description as a new Draft.'}
                    {(selectedShape.type === 'polygon' ||
                      selectedShape.type === 'rectangle') &&
                      (willReceivePlotBoundary
                        ? `Prefills property boundary (${selectedShape.coordinates.length} vertices) and plot area (${formatArea(selectedShape.areaSqm, 'sqm')}).`
                        : createCategory === 'real_estate'
                          ? `${PROPERTY_TYPE_LABELS[createPropertyType]} has no associated land plot: only centroid coordinates will be prefilled (plot boundary omitted).`
                          : 'Prefills centroid location coordinates for this category.')}
                    {selectedShape.type === 'circle' &&
                      `Prefills centre coordinates and ${selectedShape.radiusMeters || 300} m coverage radius.`}
                    {selectedShape.type === 'line' &&
                      `Preserves ${formatMetresAndKm(selectedShape.distanceMeters)} route/frontage reference (never interpreted as a property boundary).`}
                  </div>

                  <button
                    type="button"
                    onClick={() =>
                      onCreateListingFromShape(
                        selectedShape,
                        createCategory,
                        createPropertyType,
                        createCommercialHasPlot
                      )
                    }
                    data-testid="create-listing-here-btn"
                    className="w-full py-1.5 px-3 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-[11px] font-bold flex items-center justify-center gap-1.5 shadow-xs hover:opacity-95 transition-opacity"
                  >
                    <PlusCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>Create Listing Here</span>
                  </button>
                </div>
              ) : (
                <div
                  data-testid="create-listing-permission-notice"
                  className="p-2 rounded-lg bg-[var(--ps-surface)] border border-[var(--ps-border)] flex items-start gap-1.5 text-[10px] text-[var(--ps-text-muted)]"
                >
                  <Lock className="w-3.5 h-3.5 text-amber-500 shrink-0 mt-0.5" />
                  <span>
                    {createPermissionReason ||
                      'Listing creation from geometry requires an Owner, delegated Staff (edit_details), or authorised Admin role.'}
                  </span>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Collapsible Saved Drawings Section */}
        <div className="space-y-1.5 pt-1 border-t border-[var(--ps-border)]">
          <div className="flex items-center justify-between gap-2">
            <button
              type="button"
              onClick={() => setIsSavedOpen((prev) => !prev)}
              aria-expanded={isSavedOpen}
              aria-label={
                isSavedOpen
                  ? 'Collapse Saved Drawings list'
                  : 'Expand Saved Drawings list'
              }
              data-testid="toggle-saved-drawings-btn"
              className="inline-flex items-center gap-1 text-[11px] font-bold text-[var(--ps-text)] hover:text-[var(--ps-accent)]"
            >
              <span>Saved Drawings ({drawnShapes.length})</span>
              {isSavedOpen ? (
                <ChevronUp className="w-3.5 h-3.5 text-[var(--ps-text-muted)]" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5 text-[var(--ps-text-muted)]" />
              )}
            </button>

            {drawnShapes.length > 0 && (
              <button
                type="button"
                onClick={onClearAllShapes}
                data-testid="clear-all-drawings-btn"
                title="Clear all saved drawings"
                aria-label="Clear all saved drawings"
                className="text-[10px] font-semibold text-rose-600 hover:underline inline-flex items-center gap-1"
              >
                <RotateCcw className="w-2.5 h-2.5" />
                <span>Clear All</span>
              </button>
            )}
          </div>

          {isSavedOpen &&
            (drawnShapes.length === 0 ? (
              <div className="p-2.5 rounded-xl bg-[var(--ps-bg)] border border-[var(--ps-border)] text-[11px] text-[var(--ps-text-muted)] text-center">
                Select a tool above and click on the map to draw points, lines, polygons, rectangles, or circles.
              </div>
            ) : (
              <div
                data-testid="saved-drawings-list"
                className="space-y-1.5 max-h-40 overflow-y-auto pr-0.5"
              >
                {drawnShapes.map((shape) => {
                  const isSelected = shape.id === selectedShapeId;
                  const isVisible = shape.visible !== false;
                  const isFilterActive =
                    activeSpatialFilterShapeId === shape.id;

                  return (
                    <div
                      key={shape.id}
                      data-testid={`saved-shape-${shape.id}`}
                      className={`p-1.5 rounded-xl border transition-colors flex items-center justify-between gap-1.5 ${
                        isSelected
                          ? 'bg-[var(--ps-surface-alt)] border-[var(--ps-accent)]'
                          : 'bg-[var(--ps-bg)] border-[var(--ps-border)]'
                      }`}
                    >
                      <button
                        type="button"
                        data-testid={`select-shape-${shape.id}`}
                        onClick={() => {
                          onSelectShape(shape.id);
                          if (onCenterOnShape) onCenterOnShape(shape);
                        }}
                        className="flex-1 min-w-0 text-left"
                      >
                        <div className="flex items-center gap-1.5">
                          <span className="text-[9px] font-bold uppercase px-1.5 py-0.2 rounded bg-[var(--ps-surface)] text-[var(--ps-accent)] border border-[var(--ps-border)]">
                            {shape.type}
                          </span>
                          <span className="font-semibold text-[var(--ps-text)] truncate text-[11px]">
                            {shape.label}
                          </span>
                        </div>
                        <div className="text-[10px] text-[var(--ps-text-muted)] truncate mt-0.5">
                          {shape.type === 'point' &&
                            (shape.description ||
                              shape.categoryNote ||
                              'Custom map pin')}
                          {shape.type === 'line' &&
                            `${formatMetresAndKm(shape.distanceMeters)} (${shape.coordinates.length} pts)`}
                          {(shape.type === 'polygon' ||
                            shape.type === 'rectangle') &&
                            `${formatArea(shape.areaSqm, 'sqm')} · ${formatMetresAndKm(shape.perimeterMeters)}`}
                          {shape.type === 'circle' &&
                            `r=${shape.radiusMeters}m · ${formatArea(shape.areaSqm, 'sqm')}`}
                        </div>
                      </button>

                      <div className="flex items-center gap-0.5 shrink-0">
                        {(shape.type === 'polygon' ||
                          shape.type === 'rectangle' ||
                          shape.type === 'circle') && (
                          <button
                            type="button"
                            onClick={() =>
                              onToggleSpatialFilterShape(
                                isFilterActive ? null : shape.id
                              )
                            }
                            title="Filter listings inside this shape"
                            aria-label={`Filter listings inside ${shape.label}`}
                            className={`p-1 rounded-lg transition-colors ${
                              isFilterActive
                                ? 'bg-emerald-600 text-white'
                                : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface)]'
                            }`}
                          >
                            <Filter className="w-3.5 h-3.5" />
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() =>
                            onUpdateShape({
                              ...shape,
                              visible: !isVisible,
                            })
                          }
                          title={isVisible ? 'Hide drawing' : 'Show drawing'}
                          aria-label={
                            isVisible
                              ? `Hide ${shape.label}`
                              : `Show ${shape.label}`
                          }
                          data-testid={`toggle-visibility-${shape.id}`}
                          className="p-1 rounded-lg text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface)]"
                        >
                          {isVisible ? (
                            <Eye className="w-3.5 h-3.5" />
                          ) : (
                            <EyeOff className="w-3.5 h-3.5 opacity-50" />
                          )}
                        </button>

                        <button
                          type="button"
                          onClick={() => onDeleteShape(shape.id)}
                          title="Delete drawing"
                          aria-label={`Delete ${shape.label}`}
                          data-testid={`delete-shape-${shape.id}`}
                          className="p-1 rounded-lg text-rose-600 hover:bg-rose-500/10"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
