'use client';

export type FloatingDockSide = 'left' | 'right';

export type FloatingControlId =
  | 'pnd-handle'
  | 'map-toolbox'
  | 'assistant-widget';

export interface FloatingDockPersistedState {
  side: FloatingDockSide;
  /** Normalized 0..1 position within the fixed middle docking band [DOCK_MIN_Y, DOCK_MAX_Y] */
  yRatio: number;
}

export interface FloatingDockSlot {
  id: FloatingControlId;
  side: FloatingDockSide;
  /** Viewport-relative Y coordinate (top of control in window coordinates) */
  viewportY: number;
  height: number;
  width: number;
  updatedAt: number;
}

export interface ComputeDockOptions {
  id: FloatingControlId;
  side: FloatingDockSide;
  /** Explicit pixel Y inside container (used on drag release); if omitted, projected from bandRatio */
  desiredLocalY?: number;
  /** Stable 0..1 ratio inside the middle docking band [DOCK_MIN_Y, DOCK_MAX_Y] */
  bandRatio?: number;
  controlWidth: number;
  controlHeight: number;
  containerWidth: number;
  containerHeight: number;
  /** Full viewport height (defaults to window.innerHeight or containerHeight) */
  viewportHeight?: number;
  /** Top offset of the positioning container relative to the viewport (0 for stationary viewport containers) */
  containerViewportTop?: number;
  /** Kept for backwards compatibility; middle band already clears top chrome & utility stack */
  topLeftExclusionHeight?: number;
  topRightExclusionHeight?: number;
  bottomExclusionHeight?: number;
  edgeMargin?: number;
  peerGap?: number;
}

const activeDockSlots = new Map<FloatingControlId, FloatingDockSlot>();

export const FLOATING_DOCK_SYNC_EVENT = 'ddoodle:floating-dock-sync';
export const DEFAULT_EDGE_MARGIN = 12;
export const DEFAULT_PEER_GAP = 10;
export const FLOATING_DOCK_SPRING_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';
export const FLOATING_DOCK_SPRING_DURATION_MS = 320;
export const FLOATING_DOCK_SPRING_TRANSITION = `left ${FLOATING_DOCK_SPRING_DURATION_MS}ms ${FLOATING_DOCK_SPRING_EASING}, top ${FLOATING_DOCK_SPRING_DURATION_MS}ms ${FLOATING_DOCK_SPRING_EASING}`;

/** Legacy exports preserved for type compatibility */
export const TOP_RIGHT_UTILITY_STACK_EXCLUSION_PX = 156;
export const TOP_LEFT_LOGO_EXCLUSION_PX = 64;

/**
 * Pass V8: Stable Middle Vertical Docking Band anchored strictly to viewport percentages
 * rather than live `--app-header-height` so moveable controls never shift when the header
 * scrolls/collapses or announcements rotate.
 *
 * - DOCK_MIN_Y = Math.max(156, Math.round(viewportHeight * 0.24))
 * - DOCK_MAX_Y = Math.min(viewportHeight - 164, Math.round(viewportHeight * 0.72))
 */
export function computeMiddleDockBand(
  viewportHeight: number,
  controlHeight = 0
): {
  dockMinY: number;
  dockMaxY: number;
  minY: number;
  maxY: number;
} {
  const vh = Math.max(360, Math.round(viewportHeight || 720));
  const dockMinY = Math.max(156, Math.round(vh * 0.24));
  const rawMaxY = Math.min(vh - 164, Math.round(vh * 0.72));
  const dockMaxY = Math.max(dockMinY + Math.max(36, controlHeight), rawMaxY);
  const minY = dockMinY;
  const maxY = Math.max(minY, dockMaxY - Math.max(0, controlHeight));
  return {
    dockMinY,
    dockMaxY,
    minY,
    maxY,
  };
}

function notifyFloatingDockSync(sourceId: FloatingControlId) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(
    new CustomEvent(FLOATING_DOCK_SYNC_EVENT, {
      detail: { sourceId },
    })
  );
}

export function unregisterFloatingDockSlot(id: FloatingControlId): void {
  if (activeDockSlots.delete(id)) {
    notifyFloatingDockSync(id);
  }
}

export function getActiveFloatingDockSlots(): FloatingDockSlot[] {
  return Array.from(activeDockSlots.values());
}

/**
 * Preserved helper for callers inspecting bottom sheet height.
 */
export function measureExploreBottomExclusion(
  _containerEl?: HTMLElement | null
): number {
  return 164;
}

/**
 * Resolves a collision-free horizontal edge docked position `(x, y, side, yRatio)`
 * anchored strictly within the fixed middle vertical docking band `[DOCK_MIN_Y, DOCK_MAX_Y]`.
 */
export function resolveCollisionFreeDockPosition(
  opts: ComputeDockOptions,
  commitSlot = true
): {
  x: number;
  y: number;
  side: FloatingDockSide;
  yRatio: number;
  minY: number;
  maxY: number;
} {
  const edgeMargin = opts.edgeMargin ?? DEFAULT_EDGE_MARGIN;
  const peerGap = opts.peerGap ?? DEFAULT_PEER_GAP;
  const containerTop = opts.containerViewportTop ?? 0;
  const vh =
    opts.viewportHeight ??
    (typeof window !== 'undefined' && window.innerHeight > 0
      ? window.innerHeight
      : opts.containerHeight);

  const leftX = edgeMargin;
  const rightX = Math.max(
    edgeMargin,
    opts.containerWidth - opts.controlWidth - edgeMargin
  );
  const x = opts.side === 'left' ? leftX : rightX;

  const band = computeMiddleDockBand(vh, opts.controlHeight);
  // Convert viewport-relative middle band into container-local Y coordinates
  const minY = Math.max(edgeMargin, Math.round(band.minY - containerTop));
  const maxY = Math.max(
    minY,
    Math.min(
      Math.max(minY, Math.round(opts.containerHeight - opts.controlHeight - edgeMargin)),
      Math.round(band.maxY - containerTop)
    )
  );

  const clampedRatio =
    typeof opts.bandRatio === 'number' && Number.isFinite(opts.bandRatio)
      ? Math.min(1, Math.max(0, opts.bandRatio))
      : 0.5;

  const rawDesiredY =
    typeof opts.desiredLocalY === 'number' && Number.isFinite(opts.desiredLocalY)
      ? opts.desiredLocalY
      : minY + (maxY - minY) * clampedRatio;

  let candidateLocalY = Math.min(maxY, Math.max(minY, Math.round(rawDesiredY)));

  // Gather peer controls docked on the same horizontal edge
  const peers = Array.from(activeDockSlots.values())
    .filter((slot) => slot.id !== opts.id && slot.side === opts.side)
    .sort((a, b) => a.viewportY - b.viewportY);

  const overlapsAnyPeer = (localY: number): FloatingDockSlot | null => {
    const viewY = containerTop + localY;
    for (const peer of peers) {
      const peerTop = peer.viewportY - peerGap;
      const peerBottom = peer.viewportY + peer.height + peerGap;
      const myBottom = viewY + opts.controlHeight;
      if (viewY < peerBottom && myBottom > peerTop) {
        return peer;
      }
    }
    return null;
  };

  // If candidateLocalY collides with a peer on the same edge, search for the nearest free slot in [minY, maxY]
  if (peers.length > 0 && overlapsAnyPeer(candidateLocalY)) {
    const candidatePositions: number[] = [];
    for (const peer of peers) {
      const aboveLocalY = Math.round(
        peer.viewportY - containerTop - opts.controlHeight - peerGap
      );
      const belowLocalY = Math.round(
        peer.viewportY - containerTop + peer.height + peerGap
      );
      if (aboveLocalY >= minY && aboveLocalY <= maxY) {
        candidatePositions.push(aboveLocalY);
      }
      if (belowLocalY >= minY && belowLocalY <= maxY) {
        candidatePositions.push(belowLocalY);
      }
    }
    candidatePositions.push(minY, maxY);

    const validCandidates = candidatePositions.filter(
      (pos) => !overlapsAnyPeer(pos)
    );

    if (validCandidates.length > 0) {
      validCandidates.sort(
        (a, b) =>
          Math.abs(a - candidateLocalY) - Math.abs(b - candidateLocalY)
      );
      candidateLocalY = validCandidates[0];
    }
  }

  const spanY = Math.max(1, maxY - minY);
  const yRatio = Number(
    Math.min(1, Math.max(0, (candidateLocalY - minY) / spanY)).toFixed(4)
  );

  if (commitSlot) {
    const prev = activeDockSlots.get(opts.id);
    const nextViewportY = Math.round(containerTop + candidateLocalY);
    const changed =
      !prev ||
      prev.side !== opts.side ||
      Math.abs(prev.viewportY - nextViewportY) > 1 ||
      prev.height !== opts.controlHeight;

    activeDockSlots.set(opts.id, {
      id: opts.id,
      side: opts.side,
      viewportY: nextViewportY,
      height: opts.controlHeight,
      width: opts.controlWidth,
      updatedAt: Date.now(),
    });

    if (changed) {
      notifyFloatingDockSync(opts.id);
    }
  }

  return {
    x,
    y: candidateLocalY,
    side: opts.side,
    yRatio,
    minY,
    maxY,
  };
}
