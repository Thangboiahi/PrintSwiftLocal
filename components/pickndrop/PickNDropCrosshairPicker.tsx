'use client';

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle,
  ArrowLeftRight,
  ArrowRight,
  Check,
  Crosshair,
  HelpCircle,
  Loader2,
  LocateFixed,
  MapPin,
  RefreshCw,
  X,
} from 'lucide-react';
import { formatCoordinates } from '@/lib/maps/coordinates';
import type { PickNDropPoint } from '@/lib/pick-n-drop/types';
import type { PickNDropRouteMetrics } from '@/components/pickndrop/PickNDropRouteLayer';
import type { Listing } from '@/lib/types';

export const PND_PICKER_TIPS_HIDDEN_KEY = 'dd_pnd_picker_tips_hidden';

export interface PickNDropCrosshairPickerProps {
  isOpen: boolean;
  activeStep: 'pickup' | 'dropoff' | 'ready';
  pickup: PickNDropPoint | null;
  dropoff: PickNDropPoint | null;
  liveCenterCoords: { lat: number; lng: number };
  liveCenterLabel: string;
  isMapMoving?: boolean;
  isRouting?: boolean;
  routeError?: string | null;
  verticalOffsetPx?: number;
  routeMetrics?: PickNDropRouteMetrics | null;
  snappedListing?: Listing | null;
  onSelectStep: (step: 'pickup' | 'dropoff') => void;
  onConfirmCurrentCenter: () => void;
  onSnapListing: (listing: Listing) => void;
  onDismissSnapListing: () => void;
  onUseMyGps: () => void;
  onSwapPoints: () => void;
  onRetryRoute?: () => void;
  onContinueToBooking: () => void;
  onExitPickerMode: () => void;
}

export function readPickerTipsPermanentlyHidden(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    return window.localStorage.getItem(PND_PICKER_TIPS_HIDDEN_KEY) === 'true';
  } catch {
    return false;
  }
}

export function writePickerTipsPermanentlyHidden(hidden: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (hidden) {
      window.localStorage.setItem(PND_PICKER_TIPS_HIDDEN_KEY, 'true');
    } else {
      window.localStorage.removeItem(PND_PICKER_TIPS_HIDDEN_KEY);
    }
  } catch {
    // Ignore storage errors
  }
}

export function PickNDropCrosshairPicker({
  isOpen,
  activeStep,
  pickup,
  dropoff,
  liveCenterCoords,
  liveCenterLabel,
  isMapMoving = false,
  isRouting = false,
  routeError = null,
  verticalOffsetPx = 0,
  routeMetrics = null,
  snappedListing = null,
  onSelectStep,
  onConfirmCurrentCenter,
  onSnapListing,
  onDismissSnapListing,
  onUseMyGps,
  onSwapPoints,
  onRetryRoute,
  onContinueToBooking,
  onExitPickerMode,
}: PickNDropCrosshairPickerProps) {
  const [tipsVisible, setTipsVisible] = useState<boolean>(
    () => !readPickerTipsPermanentlyHidden()
  );

  useEffect(() => {
    if (!isOpen) return;
    let cancelled = false;
    queueMicrotask(() => {
      if (!cancelled) {
        setTipsVisible(!readPickerTipsPermanentlyHidden());
      }
    });
    return () => {
      cancelled = true;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const isPickingPickup = activeStep === 'pickup';
  const isPickingDropoff = activeStep === 'dropoff';
  const isReady = activeStep === 'ready' && Boolean(pickup && dropoff);

  const instructionText = isPickingPickup
    ? dropoff
      ? 'Pan to reposition Point A (Pickup) — Point B stays pinned on the map.'
      : 'Pan the map so the green A crosshair tip sits on your Pickup spot, or tap any business pin.'
    : isPickingDropoff
      ? pickup
        ? 'Pan to place Point B (Dropoff) — Point A stays visible on the map.'
        : 'Pan the map so the blue B crosshair tip sits on your Dropoff spot.'
      : 'Route ready! Tap A or B anytime to adjust either pin, or continue to booking.';

  return (
    <>
      {/* 1. Pixel-Accurate Crosshair Pin (exact ground contact dot anchored at calc(50% + verticalOffsetPx)) */}
      {!isReady && (
        <div
          data-testid="pnd-center-crosshair"
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-[26]"
        >
          <div
            style={{
              left: '50%',
              top: `calc(50% + ${verticalOffsetPx}px)`,
            }}
            className="absolute -translate-x-1/2 -translate-y-1/2"
          >
            {/* Exact ground contact tip dot — sits pixel-for-pixel on stored { lat, lng } */}
            <span
              className={`block h-2.5 w-2.5 rounded-full ring-2 ring-white shadow-md ${
                isPickingPickup ? 'bg-emerald-500' : 'bg-indigo-500'
              }`}
            />
            <span
              className={`pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-7 w-7 rounded-full border transition-transform duration-150 ${
                isPickingPickup
                  ? 'border-emerald-500/45'
                  : 'border-indigo-500/45'
              } ${isMapMoving ? 'scale-115 opacity-90' : 'scale-100 opacity-50'}`}
            />

            {/* Floating Pin Head, Stem & Label strictly ABOVE exact ground tip */}
            <motion.div
              animate={{
                y: isMapMoving ? -8 : 0,
                scale: isMapMoving ? 1.06 : 1,
              }}
              transition={{ type: 'spring', stiffness: 420, damping: 28 }}
              className="absolute bottom-1/2 left-1/2 -translate-x-1/2 flex flex-col items-center"
            >
              <div
                className={`mb-1 rounded-full border px-2.5 py-0.5 text-[10px] font-bold text-white shadow-lg backdrop-blur-md whitespace-nowrap max-w-[230px] truncate ${
                  isPickingPickup
                    ? 'border-emerald-400/60 bg-emerald-950/92'
                    : 'border-indigo-400/60 bg-indigo-950/92'
                }`}
              >
                {isPickingPickup ? 'A · Pickup: ' : 'B · Dropoff: '}
                {liveCenterLabel}
              </div>
              <div
                className={`flex h-9 w-9 items-center justify-center rounded-full border-2 border-white text-xs font-extrabold text-white shadow-2xl ${
                  isPickingPickup ? 'bg-emerald-600' : 'bg-indigo-600'
                }`}
              >
                {isPickingPickup ? 'A' : 'B'}
              </div>
              <div
                className={`h-3 w-0.5 ${
                  isPickingPickup ? 'bg-emerald-600' : 'bg-indigo-600'
                }`}
              />
            </motion.div>
          </div>
        </div>
      )}

      {/* 2. Top-Layer Non-Blocking Guidance Hint (z-[70], pointer-events-none wrapper, pointer-events-auto ONLY on dismiss buttons) */}
      <AnimatePresence>
        {tipsVisible && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.16 }}
            data-testid="pnd-picker-instructions-pill"
            className="pointer-events-none fixed top-[72px] sm:top-[80px] left-1/2 -translate-x-1/2 z-[70] w-[min(92vw,440px)] px-1"
          >
            <div className="pointer-events-none rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)]/95 backdrop-blur-md px-3.5 py-2.5 shadow-xl text-xs">
              <div className="flex items-start gap-2.5">
                <span
                  className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold text-white ${
                    isPickingPickup
                      ? 'bg-emerald-600'
                      : isPickingDropoff
                        ? 'bg-indigo-600'
                        : 'bg-teal-600'
                  }`}
                >
                  {isPickingPickup ? 'A' : isPickingDropoff ? 'B' : '✓'}
                </span>
                <div className="min-w-0 flex-1 space-y-1">
                  <p className="text-[11px] font-medium leading-snug text-[var(--ps-text)]">
                    {instructionText}
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      data-testid="pnd-picker-tips-hide-perm-btn"
                      onClick={() => {
                        writePickerTipsPermanentlyHidden(true);
                        setTipsVisible(false);
                      }}
                      className="pointer-events-auto text-[10px] font-bold text-[var(--ps-text-muted)] hover:text-rose-600 dark:hover:text-rose-400 underline cursor-pointer"
                    >
                      Don&apos;t show again
                    </button>
                  </div>
                </div>
                <button
                  type="button"
                  data-testid="pnd-picker-tips-hide-temp-btn"
                  onClick={() => setTipsVisible(false)}
                  aria-label="Dismiss hint"
                  className="pointer-events-auto -mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[var(--ps-text-muted)] hover:bg-[var(--ps-bg)] hover:text-[var(--ps-text)] cursor-pointer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* 3. Bottom-of-Map Picker Action Dock (z-[30]) */}
      <div
        data-testid="pnd-picker-action-dock"
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        className="pointer-events-auto absolute bottom-3 left-1/2 -translate-x-1/2 z-[30] w-[min(94%,450px)] rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)]/98 backdrop-blur-md p-3 shadow-2xl space-y-2.5 text-xs"
      >
        {/* Optional Listing-Pin Snap Chip */}
        {snappedListing && !isReady && (
          <div
            data-testid="pnd-picker-snap-chip"
            className="flex items-center justify-between gap-2 rounded-xl border border-[var(--ps-accent)]/40 bg-[var(--ps-accent)]/10 px-2.5 py-1.5"
          >
            <button
              type="button"
              onClick={() => onSnapListing(snappedListing)}
              className="flex items-center gap-1.5 text-left text-[11px] font-bold text-[var(--ps-accent)] hover:underline min-w-0 flex-1 cursor-pointer"
            >
              <MapPin className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">
                Snap to {snappedListing.title.replace(/^\[SAMPLE\]\s*/i, '')} as{' '}
                {isPickingPickup ? 'Pickup A' : 'Dropoff B'}
              </span>
            </button>
            <button
              type="button"
              onClick={onDismissSnapListing}
              aria-label="Dismiss listing snap"
              className="p-1 rounded text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Top Row: 1-Tap Step Switcher Pills (A <-> B without clearing other pin) + GPS + Swap + Guide + Close */}
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex items-center gap-1.5 min-w-0">
            <button
              type="button"
              data-testid="pnd-picker-step-pickup"
              onClick={() => onSelectStep('pickup')}
              className={`min-h-[38px] px-2.5 rounded-xl text-[11px] font-bold inline-flex items-center gap-1 transition-colors cursor-pointer ${
                isPickingPickup
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : pickup
                    ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 border border-emerald-500/35 hover:bg-emerald-500/20'
                    : 'bg-[var(--ps-bg)] text-[var(--ps-text-muted)] border border-[var(--ps-border)] hover:text-[var(--ps-text)]'
              }`}
            >
              <span>A: Pickup</span>
              {pickup && <Check className="w-3 h-3" />}
            </button>
            <button
              type="button"
              data-testid="pnd-picker-step-dropoff"
              onClick={() => onSelectStep('dropoff')}
              className={`min-h-[38px] px-2.5 rounded-xl text-[11px] font-bold inline-flex items-center gap-1 transition-colors cursor-pointer ${
                isPickingDropoff
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : dropoff
                    ? 'bg-indigo-500/12 text-indigo-700 dark:text-indigo-300 border border-indigo-500/35 hover:bg-indigo-500/20'
                    : 'bg-[var(--ps-bg)] text-[var(--ps-text-muted)] border border-[var(--ps-border)] hover:text-[var(--ps-text)]'
              }`}
            >
              <span>B: Dropoff</span>
              {dropoff && <Check className="w-3 h-3" />}
            </button>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={onUseMyGps}
              title="Use High-Accuracy GPS"
              aria-label="Center on my GPS location"
              className="h-9 w-9 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] hover:bg-[var(--ps-surface-alt)] flex items-center justify-center text-[var(--ps-text)] cursor-pointer"
            >
              <LocateFixed className="w-4 h-4 text-sky-500" />
            </button>
            {pickup && dropoff && (
              <button
                type="button"
                onClick={onSwapPoints}
                title="Swap Pickup A and Dropoff B"
                aria-label="Swap Pickup and Dropoff"
                className="h-9 w-9 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] hover:bg-[var(--ps-surface-alt)] flex items-center justify-center text-[var(--ps-text)] cursor-pointer"
              >
                <ArrowLeftRight className="w-4 h-4 text-[var(--ps-accent)]" />
              </button>
            )}
            <button
              type="button"
              data-testid="pnd-picker-toggle-guide-btn"
              onClick={() => setTipsVisible((prev) => !prev)}
              title="Toggle step-by-step guide"
              aria-label="Toggle step-by-step guide"
              className={`h-9 w-9 rounded-xl border flex items-center justify-center transition-colors cursor-pointer ${
                tipsVisible
                  ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)]/12 text-[var(--ps-accent)]'
                  : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
              }`}
            >
              <HelpCircle className="w-4 h-4" />
            </button>
            <button
              type="button"
              onClick={onExitPickerMode}
              title="Close map picker"
              aria-label="Close map picker"
              className="h-9 w-9 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] hover:bg-[var(--ps-surface-alt)] flex items-center justify-center text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Center Readout or Route Ready Summary */}
        {isReady ? (
          <div className="space-y-2">
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/8 px-3 py-2 flex items-center justify-between gap-2 text-[11px]">
              <span className="truncate font-semibold text-[var(--ps-text)]">
                {pickup?.label} → {dropoff?.label}
              </span>
              {isRouting ? (
                <span className="inline-flex items-center gap-1.5 shrink-0 text-[10px] font-bold text-[var(--ps-accent)]">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  <span>Calculating route…</span>
                </span>
              ) : routeMetrics ? (
                <span className="shrink-0 font-extrabold text-emerald-700 dark:text-emerald-300 tabular-nums">
                  {routeMetrics.distanceKm.toFixed(1)} km · ~
                  {routeMetrics.durationMin}m
                </span>
              ) : (
                <span className="h-3.5 w-20 rounded dd-shimmer shrink-0" />
              )}
            </div>

            {routeError && (
              <div className="flex items-center justify-between gap-2 rounded-xl border border-amber-500/35 bg-amber-500/10 px-2.5 py-1.5 text-[11px] text-amber-800 dark:text-amber-200">
                <span className="inline-flex items-center gap-1.5 truncate">
                  <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                  <span className="truncate">{routeError}</span>
                </span>
                {onRetryRoute && (
                  <button
                    type="button"
                    onClick={onRetryRoute}
                    className="inline-flex items-center gap-1 rounded-lg border border-amber-500/40 bg-[var(--ps-surface)] px-2 py-1 text-[10px] font-bold text-[var(--ps-text)] shrink-0 cursor-pointer"
                  >
                    <RefreshCw className="h-3 w-3" />
                    Retry
                  </button>
                )}
              </div>
            )}

            <button
              type="button"
              data-testid="pnd-picker-continue-booking-btn"
              onClick={onContinueToBooking}
              className="w-full min-h-[44px] rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-sm flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
            >
              <span>Continue to Pick N Drop Booking</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--ps-text-muted)] px-0.5">
              <span className="inline-flex items-center gap-1.5 truncate font-medium text-[var(--ps-text)]">
                <Crosshair
                  className={`w-3.5 h-3.5 shrink-0 ${
                    isPickingPickup ? 'text-emerald-500' : 'text-indigo-500'
                  }`}
                />
                <span className="truncate">{liveCenterLabel}</span>
              </span>
              <span className="font-mono text-[10px] shrink-0">
                {formatCoordinates(liveCenterCoords.lat, liveCenterCoords.lng, 6)}
              </span>
            </div>
            <button
              type="button"
              data-testid="pnd-picker-confirm-btn"
              onClick={onConfirmCurrentCenter}
              className={`w-full min-h-[44px] rounded-xl text-white text-xs font-bold shadow-sm flex items-center justify-center gap-1.5 transition-colors cursor-pointer ${
                isPickingPickup
                  ? 'bg-emerald-600 hover:bg-emerald-500'
                  : 'bg-indigo-600 hover:bg-indigo-500'
              }`}
            >
              <Check className="w-4 h-4" />
              <span>
                {isPickingPickup
                  ? 'Confirm Pickup (A)'
                  : 'Confirm Dropoff (B)'}
              </span>
            </button>
          </div>
        )}
      </div>
    </>
  );
}

export default PickNDropCrosshairPicker;
