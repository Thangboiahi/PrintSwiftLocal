'use client';

import React, { useEffect, useRef, useState } from 'react';
import { GripHorizontal, Truck } from 'lucide-react';

const STORAGE_KEY = 'ddoodle_pnd_handle_ratio_v1';
const DRAG_THRESHOLD_PX = 6;

export interface DraggablePickNDropHandleProps {
  mapViewportRef: React.RefObject<HTMLDivElement | null>;
  isOpen: boolean;
  hasActivePins?: boolean;
  onToggle: () => void;
}

interface RatioPos {
  xRatio: number;
  yRatio: number;
}

function clamp(val: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, val));
}

export function DraggablePickNDropHandle({
  mapViewportRef,
  isOpen,
  hasActivePins = false,
  onToggle,
}: DraggablePickNDropHandleProps) {
  const handleRef = useRef<HTMLButtonElement | null>(null);
  const dragStateRef = useRef<{
    pointerId: number | null;
    startClientX: number;
    startClientY: number;
    startLeft: number;
    startTop: number;
    didDrag: boolean;
  }>({
    pointerId: null,
    startClientX: 0,
    startClientY: 0,
    startLeft: 12,
    startTop: 12,
    didDrag: false,
  });

  const [ratioPos, setRatioPos] = useState<RatioPos>(() => {
    if (typeof window !== 'undefined') {
      try {
        const raw = window.sessionStorage.getItem(STORAGE_KEY);
        if (raw) {
          const parsed = JSON.parse(raw) as Partial<RatioPos>;
          if (
            typeof parsed.xRatio === 'number' &&
            typeof parsed.yRatio === 'number' &&
            Number.isFinite(parsed.xRatio) &&
            Number.isFinite(parsed.yRatio)
          ) {
            return {
              xRatio: clamp(parsed.xRatio, 0.02, 0.92),
              yRatio: clamp(parsed.yRatio, 0.08, 0.85),
            };
          }
        }
      } catch {
        // ignore storage errors
      }
    }
    return { xRatio: 0.04, yRatio: 0.78 };
  });

  const [pixelPos, setPixelPos] = useState<{ left: number; top: number } | null>(
    null
  );
  const [isDragging, setIsDragging] = useState(false);

  const computeClampedPixels = (r: RatioPos) => {
    const vp = mapViewportRef.current;
    const btn = handleRef.current;
    if (!vp) return { left: 12, top: 64 };
    const vpRect = vp.getBoundingClientRect();
    const btnW = btn?.offsetWidth || 128;
    const btnH = btn?.offsetHeight || 40;
    const pad = 10;
    const maxLeft = Math.max(pad, vpRect.width - btnW - pad);
    const maxTop = Math.max(pad, vpRect.height - btnH - pad);
    return {
      left: clamp(Math.round(r.xRatio * vpRect.width), pad, maxLeft),
      top: clamp(Math.round(r.yRatio * vpRect.height), pad, maxTop),
    };
  };

  useEffect(() => {
    const syncPosition = () => {
      setPixelPos(computeClampedPixels(ratioPos));
    };
    syncPosition();
    window.addEventListener('resize', syncPosition);
    window.addEventListener('orientationchange', syncPosition);
    return () => {
      window.removeEventListener('resize', syncPosition);
      window.removeEventListener('orientationchange', syncPosition);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ratioPos.xRatio, ratioPos.yRatio]);

  const handlePointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    e.stopPropagation();
    const current = pixelPos || computeClampedPixels(ratioPos);
    dragStateRef.current = {
      pointerId: e.pointerId,
      startClientX: e.clientX,
      startClientY: e.clientY,
      startLeft: current.left,
      startTop: current.top,
      didDrag: false,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLButtonElement>) => {
    const st = dragStateRef.current;
    if (st.pointerId !== e.pointerId) return;
    const dx = e.clientX - st.startClientX;
    const dy = e.clientY - st.startClientY;
    if (!st.didDrag && Math.hypot(dx, dy) > DRAG_THRESHOLD_PX) {
      st.didDrag = true;
      setIsDragging(true);
    }
    if (!st.didDrag) return;

    const vp = mapViewportRef.current;
    const btn = handleRef.current;
    if (!vp) return;
    const vpRect = vp.getBoundingClientRect();
    const btnW = btn?.offsetWidth || 128;
    const btnH = btn?.offsetHeight || 40;
    const pad = 10;
    const nextLeft = clamp(
      st.startLeft + dx,
      pad,
      Math.max(pad, vpRect.width - btnW - pad)
    );
    const nextTop = clamp(
      st.startTop + dy,
      pad,
      Math.max(pad, vpRect.height - btnH - pad)
    );
    setPixelPos({ left: nextLeft, top: nextTop });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLButtonElement>) => {
    const st = dragStateRef.current;
    if (st.pointerId !== e.pointerId) return;
    dragStateRef.current.pointerId = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // ignore
    }

    if (st.didDrag) {
      setIsDragging(false);
      const vp = mapViewportRef.current;
      if (vp && pixelPos) {
        const vpRect = vp.getBoundingClientRect();
        if (vpRect.width > 0 && vpRect.height > 0) {
          const nextRatio: RatioPos = {
            xRatio: clamp(pixelPos.left / vpRect.width, 0.02, 0.92),
            yRatio: clamp(pixelPos.top / vpRect.height, 0.06, 0.88),
          };
          setRatioPos(nextRatio);
          try {
            window.sessionStorage.setItem(
              STORAGE_KEY,
              JSON.stringify(nextRatio)
            );
          } catch {
            // ignore
          }
        }
      }
      return;
    }

    onToggle();
  };

  return (
    <button
      ref={handleRef}
      type="button"
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      aria-label="Toggle Pick N Drop courier mode (drag to reposition)"
      aria-pressed={isOpen}
      data-testid="map-floating-pick-n-drop-handle"
      style={
        pixelPos
          ? { left: `${pixelPos.left}px`, top: `${pixelPos.top}px` }
          : { left: '12px', bottom: '84px' }
      }
      className={`absolute z-20 touch-none select-none h-10 px-3 rounded-full border-2 shadow-xl inline-flex items-center gap-2 text-xs font-extrabold tracking-tight transition-shadow ${
        isDragging ? 'cursor-grabbing scale-105 shadow-2xl' : 'cursor-grab'
      } ${
        isOpen
          ? 'bg-slate-950 text-amber-300 border-amber-400 ring-2 ring-amber-400/50'
          : 'bg-gradient-to-r from-[var(--ps-accent)] to-amber-500 text-white border-white/90 hover:shadow-2xl'
      }`}
    >
      <GripHorizontal
        className="w-3.5 h-3.5 opacity-75 shrink-0"
        aria-hidden="true"
      />
      <span className="relative inline-flex items-center">
        <Truck className="w-4 h-4 shrink-0" aria-hidden="true" />
        {(hasActivePins || isOpen) && (
          <span
            aria-hidden="true"
            className="absolute -top-1 -right-1 w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-slate-950 animate-pulse"
          />
        )}
      </span>
      <span className="whitespace-nowrap">Pick N Drop</span>
    </button>
  );
}

export default DraggablePickNDropHandle;
