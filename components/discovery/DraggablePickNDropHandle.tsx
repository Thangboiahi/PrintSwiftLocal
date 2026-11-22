'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Package, X } from 'lucide-react';
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

export interface DraggablePickNDropHandleProps {
  mapViewportRef: React.RefObject<HTMLDivElement | null>;
  isOpen: boolean;
  hasActivePins: boolean;
  onToggle: () => void;
  isHeaderHiddenOrFullscreen?: boolean;
}

const STORAGE_KEY = 'ddoodle_pnd_handle_dock_v8';
const PREV_STORAGE_KEY = 'ddoodle_pnd_handle_dock_v7';
const LEGACY_STORAGE_KEY = 'ddoodle_pnd_handle_pos_v3';
const DRAG_THRESHOLD_PX = 8;

const DEFAULT_DOCK: FloatingDockPersistedState = {
  side: 'left',
  yRatio: 0.12,
};

function readPersistedDock(): FloatingDockPersistedState {
  if (typeof window === 'undefined') return DEFAULT_DOCK;
  try {
    const raw =
      window.localStorage.getItem(STORAGE_KEY) ||
      window.localStorage.getItem(PREV_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<FloatingDockPersistedState>;
      const side: FloatingDockSide = parsed.side === 'right' ? 'right' : 'left';
      const yRatio =
        typeof parsed.yRatio === 'number' && Number.isFinite(parsed.yRatio)
          ? Math.max(0, Math.min(1, parsed.yRatio))
          : DEFAULT_DOCK.yRatio;
      return { side, yRatio };
    }
    const legacyRaw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (legacyRaw) {
      const parsed = JSON.parse(legacyRaw) as {
        xRatio?: number;
        yRatio?: number;
      };
      const side: FloatingDockSide =
        typeof parsed.xRatio === 'number' && parsed.xRatio > 0.5
          ? 'right'
          : 'left';
      const yRatio =
        typeof parsed.yRatio === 'number' && Number.isFinite(parsed.yRatio)
          ? Math.max(0, Math.min(1, parsed.yRatio))
          : DEFAULT_DOCK.yRatio;
      return { side, yRatio };
    }
  } catch {
    // ignore storage errors
  }
  return DEFAULT_DOCK;
}

function savePersistedDock(dock: FloatingDockPersistedState) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(dock));
  } catch {
    // ignore storage errors
  }
}

function resolveStationaryMapContainer(
  refEl: HTMLElement | null
): HTMLElement | null {
  if (!refEl) return null;
  const stationary = refEl.closest<HTMLElement>(
    '[data-testid="explore-map-viewport"]'
  );
  return stationary || refEl;
}

export function DraggablePickNDropHandle({
  mapViewportRef,
  isOpen,
  hasActivePins,
  onToggle,
}: DraggablePickNDropHandleProps) {
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const [portalHost, setPortalHost] = useState<HTMLElement | null>(null);
  const dockRef = useRef<FloatingDockPersistedState>(DEFAULT_DOCK);
  const [dockSide, setDockSide] = useState<FloatingDockSide>(DEFAULT_DOCK.side);
  const [coords, setCoords] = useState<{ x: number; y: number }>({
    x: DEFAULT_EDGE_MARGIN,
    y: 196,
  });
  const coordsRef = useRef<{ x: number; y: number }>({
    x: DEFAULT_EDGE_MARGIN,
    y: 196,
  });
  const [isDragging, setIsDragging] = useState(false);
  const suppressNextClickRef = useRef(false);

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
    originX: DEFAULT_EDGE_MARGIN,
    originY: 196,
    moved: false,
  });

  const computeAndCommitDock = useCallback(
    (
      targetDock: FloatingDockPersistedState,
      explicitLocalY?: number,
      commitSlot = true
    ) => {
      const container = resolveStationaryMapContainer(mapViewportRef.current);
      const btn = buttonRef.current;
      const vh =
        typeof window !== 'undefined' && window.innerHeight > 0
          ? window.innerHeight
          : container?.clientHeight || 720;
      const containerW =
        container?.clientWidth ||
        (typeof window !== 'undefined' ? window.innerWidth : 360);
      const containerH = container?.clientHeight || vh;
      const btnW = btn?.offsetWidth || 122;
      const btnH = btn?.offsetHeight || 36;

      const resolved = resolveCollisionFreeDockPosition(
        {
          id: 'pnd-handle',
          side: targetDock.side,
          desiredLocalY: explicitLocalY,
          bandRatio: targetDock.yRatio,
          controlWidth: btnW,
          controlHeight: btnH,
          containerWidth: containerW,
          containerHeight: containerH,
          viewportHeight: vh,
          containerViewportTop: 0,
        },
        commitSlot
      );

      coordsRef.current = { x: resolved.x, y: resolved.y };
      setDockSide((prev) => (prev === targetDock.side ? prev : targetDock.side));
      setCoords((prev) =>
        prev.x === resolved.x && prev.y === resolved.y
          ? prev
          : { x: resolved.x, y: resolved.y }
      );
      return resolved;
    },
    [mapViewportRef]
  );

  useEffect(() => {
    const host = resolveStationaryMapContainer(mapViewportRef.current);
    setPortalHost(host);

    const initial = readPersistedDock();
    dockRef.current = initial;

    const syncDock = () => {
      if (dragSessionRef.current.active) return;
      computeAndCommitDock(dockRef.current, undefined, true);
    };

    const rafId = window.requestAnimationFrame(syncDock);

    const handlePeerSync = (ev: Event) => {
      const detail = (ev as CustomEvent<{ sourceId?: string }>).detail;
      if (detail?.sourceId === 'pnd-handle') return;
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
      unregisterFloatingDockSlot('pnd-handle');
    };
  }, [computeAndCommitDock, mapViewportRef]);

  // Re-sync horizontal width when open/pins badge state changes (strictly preserving middle band ratio)
  useEffect(() => {
    if (dragSessionRef.current.active) return;
    const timer = window.setTimeout(() => {
      computeAndCommitDock(dockRef.current, undefined, true);
    }, 20);
    return () => window.clearTimeout(timer);
  }, [isOpen, hasActivePins, computeAndCommitDock]);

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (e.pointerType === 'mouse' && e.button !== 0) return;

    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // ignore synthetic events
    }

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

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const session = dragSessionRef.current;
    if (!session.active || session.pointerId !== e.pointerId) return;
    e.stopPropagation();

    const dx = e.clientX - session.startClientX;
    const dy = e.clientY - session.startClientY;

    if (!session.moved) {
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) {
        return;
      }
      session.moved = true;
      setIsDragging(true);
    }

    const container = resolveStationaryMapContainer(mapViewportRef.current);
    const btn = buttonRef.current;
    const vh =
      typeof window !== 'undefined' && window.innerHeight > 0
        ? window.innerHeight
        : container?.clientHeight || 720;
    const containerW = container?.clientWidth || 360;
    const btnW = btn?.offsetWidth || 122;
    const btnH = btn?.offsetHeight || 36;
    const band = computeMiddleDockBand(vh, btnH);

    const nextX = Math.max(
      DEFAULT_EDGE_MARGIN,
      Math.min(containerW - btnW - DEFAULT_EDGE_MARGIN, session.originX + dx)
    );
    const nextY = Math.max(
      band.minY,
      Math.min(band.maxY, session.originY + dy)
    );

    const nextCoords = { x: Math.round(nextX), y: Math.round(nextY) };
    coordsRef.current = nextCoords;
    setCoords(nextCoords);
  };

  const finishPointer = (
    e: React.PointerEvent<HTMLButtonElement>,
    cancelled: boolean
  ) => {
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
      if (!cancelled) {
        suppressNextClickRef.current = true;
        window.setTimeout(() => {
          suppressNextClickRef.current = false;
        }, 160);
        onToggle();
      }
      return;
    }

    suppressNextClickRef.current = true;
    window.setTimeout(() => {
      suppressNextClickRef.current = false;
    }, 180);

    // Snap smoothly to nearest horizontal edge within the fixed middle docking band
    const container = resolveStationaryMapContainer(mapViewportRef.current);
    const btn = buttonRef.current;
    const containerW = container?.clientWidth || 360;
    const btnW = btn?.offsetWidth || 122;
    const centerX = coordsRef.current.x + btnW / 2;
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
    savePersistedDock(nextDock);
  };

  const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    if (suppressNextClickRef.current) {
      suppressNextClickRef.current = false;
      return;
    }
    onToggle();
  };

  const buttonNode = (
    <button
      ref={buttonRef}
      type="button"
      data-testid="draggable-pnd-map-handle"
      data-tour="explore-pnd-handle"
      data-pnd-open={isOpen ? 'true' : 'false'}
      data-dock-side={dockSide}
      aria-pressed={isOpen}
      aria-label={
        isOpen
          ? 'Close Pick N Drop map route planner'
          : 'Open Pick N Drop map route planner (drag to dock)'
      }
      title={
        isOpen
          ? 'Tap to close Pick N Drop (Drag to dock left or right)'
          : 'Tap to open Pick N Drop on map (Drag to dock left or right)'
      }
      onMouseDown={(e) => e.stopPropagation()}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={(e) => finishPointer(e, false)}
      onPointerCancel={(e) => finishPointer(e, true)}
      onClick={handleClick}
      style={{
        left: `${coords.x}px`,
        top: `${coords.y}px`,
        touchAction: 'none',
        transition: isDragging ? 'none' : FLOATING_DOCK_SPRING_TRANSITION,
        willChange: 'left, top',
      }}
      className={`pointer-events-auto absolute z-[28] h-9 px-2.5 rounded-full flex items-center gap-1.5 select-none backdrop-blur-md shadow-lg border ${
        isDragging
          ? 'cursor-grabbing scale-105'
          : 'cursor-pointer hover:scale-[1.03]'
      } ${
        isOpen
          ? 'bg-emerald-600/95 text-white border-emerald-300 ring-2 ring-emerald-400/50'
          : 'bg-[var(--ps-surface)]/92 text-[var(--ps-text)] border-emerald-500/60 hover:border-emerald-500'
      }`}
    >
      <span
        className={`flex h-5 w-5 items-center justify-center rounded-full shrink-0 ${
          isOpen
            ? 'bg-white/20 text-white'
            : 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400'
        }`}
      >
        <Package className="w-3 h-3 stroke-[2.25]" aria-hidden="true" />
      </span>

      <span className="text-[11px] font-bold tracking-tight whitespace-nowrap leading-none">
        Pick N Drop
      </span>

      {hasActivePins && !isOpen && (
        <span className="px-1.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-500/40 text-[9px] font-extrabold leading-none">
          A→B
        </span>
      )}

      {isOpen && (
        <span className="ml-0.5 inline-flex h-4 w-4 items-center justify-center rounded-full bg-black/20 text-white">
          <X className="w-2.5 h-2.5" aria-hidden="true" />
        </span>
      )}
    </button>
  );

  if (portalHost) {
    return createPortal(buttonNode, portalHost);
  }

  return buttonNode;
}

export default DraggablePickNDropHandle;
