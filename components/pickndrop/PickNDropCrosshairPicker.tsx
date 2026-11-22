'use client';

import React, { useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  ArrowLeftRight,
  ArrowRight,
  Check,
  Crosshair,
  HelpCircle,
  LocateFixed,
  MapPin,
  X,
} from 'lucide-react';
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
  routeMetrics?: PickNDropRouteMetrics | null;
  snappedListing?: Listing | null;
  onSelectStep: (step: 'pickup' | 'dropoff') => void;
  onConfirmCurrentCenter: () => void;
  onSnapListing: (listing: Listing) => void;
  onDismissSnapListing: () => void;
  onUseMyGps: () => void;
  onSwapPoints: () => void;
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
  routeMetrics = null,
  snappedListing = null,
  onSelectStep,
  onConfirmCurrentCenter,
  onSnapListing,
  onDismissSnapListing,
  onUseMyGps,
  onSwapPoints,
  onContinueToBooking,
  onExitPickerMode,
}: PickNDropCrosshairPickerProps) {
  const [tipsVisible, setTipsVisible] = useState<boolean>(
    () => !readPickerTipsPermanentlyHidden()
  );

  useEffect(() => {
    if (isOpen) {
      setTipsVisible(!readPickerTipsPermanentlyHidden());
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const isPickingPickup = activeStep === 'pickup';
  const isPickingDropoff = activeStep === 'dropoff';
  const isReady = activeStep === 'ready' && Boolean(pickup && dropoff);

  const instructionText = isPickingPickup
    ? 'Pan the map to center the green A pin on your Pickup spot — or tap any business pin on the map.'
    : isPickingDropoff
      ? 'Now pan the map to center the blue B pin on your Dropoff spot (or tap a listing).'
      : 'Route ready! Drag either marker or tap Continue to confirm your Pick N Drop booking.';

  return (
    <>
      {/* 1. Fixed Center Crosshair Target Pin (z-[26]) */}
      {!isReady && (
        <div
          data-testid="pnd-center-crosshair"
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-[26] flex items-center justify-center"
        >
          <div className="relative flex flex-col items-center -translate-y-4">
            <div
              className={`mb-1 rounded-full border px-2.5 py-0.5 text-[10px] font-bold text-white shadow-lg backdrop-blur-md whitespace-nowrap max-w-[220px] truncate ${
                isPickingPickup
                  ? 'border-emerald-400/60 bg-emerald-950/92'
                  : 'border-indigo-400/60 bg-indigo-950/92'
              }`}
            >
              {isPickingPickup ? 'A · Pickup: ' : 'B · Dropoff: '}
              {liveCenterLabel}
            </div>
            <motion.div
              animate={{
                y: isMapMoving ? -8 : 0,
                scale: isMapMoving ? 1.08 : 1,
              }}
              transition={{ type: 'spring', stiffness: 420, damping: 28 }}
              className="relative flex flex-col items-center"
            >
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
            <span
              className={`h-2 w-2 rounded-full ring-2 ring-white shadow-md ${
                isPickingPickup ? 'bg-emerald-500' : 'bg-indigo-500'
              }`}
            />
          </div>
        </div>
      )}

      {/* 2. Toggleable Guided Instructions Pill (z-[28]) */}
      <AnimatePresence>
        {tipsVisible && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.16 }}
            data-testid="pnd-picker-instructions-pill"
            className="pointer-events-auto absolute top-14 left-1/2 -translate-x-1/2 z-[28] w-[min(92%,420px)] rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)]/96 backdrop-blur-md px-3.5 py-2.5 shadow-xl text-xs"
          >
            <div className="flex items-start gap-2">
              <span
                className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-extrabold text-white ${
                  isPickingPickup
                    ? 'bg-emerald-600'
                    : isPickingDropoff
                      ? 'bg-indigo-600'
                      : 'bg-teal-600'
                }`}
              >
                {isPickingPickup ? '1' : isPickingDropoff ? '2' : '✓'}
              </span>
              <div className="min-w-0 flex-1 space-y-1.5">
                <p className="text-[11px] font-medium leading-snug text-[var(--ps-text)]">
                  {instructionText}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    data-testid="pnd-picker-tips-hide-temp-btn"
                    onClick={() => setTipsVisible(false)}
                    className="text-[10px] font-bold text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] underline"
                  >
                    Hide
                  </button>
                  <span className="text-[var(--ps-border)]">·</span>
                  <button
                    type="button"
                    data-testid="pnd-picker-tips-hide-perm-btn"
                    onClick={() => {
                      writePickerTipsPermanentlyHidden(true);
                      setTipsVisible(false);
                    }}
                    className="text-[10px] font-bold text-[var(--ps-text-muted)] hover:text-rose-600 dark:hover:text-rose-400 underline"
                  >
                    Don&apos;t show again
                  </button>
                </div>
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
        className="pointer-events-auto absolute bottom-3 left-1/2 -translate-x-1/2 z-[30] w-[min(94%,440px)] rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)]/98 backdrop-blur-md p-3 shadow-2xl space-y-2.5 text-xs"
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
              className="flex items-center gap-1.5 text-left text-[11px] font-bold text-[var(--ps-accent)] hover:underline min-w-0 flex-1"
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
              className="p-0.5 rounded text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )}

        {/* Top Row: Step Switcher Pills (A <-> B) + GPS + Swap + Guide + Close */}
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex items-center gap-1 min-w-0">
            <button
              type="button"
              data-testid="pnd-picker-step-pickup"
              onClick={() => onSelectStep('pickup')}
              className={`h-7 px-2.5 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 transition-colors ${
                isPickingPickup
                  ? 'bg-emerald-600 text-white shadow-xs'
                  : pickup
                    ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 border border-emerald-500/30'
                    : 'bg-[var(--ps-bg)] text-[var(--ps-text-muted)] border border-[var(--ps-border)]'
              }`}
            >
              <span>A: Pickup</span>
              {pickup && <Check className="w-3 h-3" />}
            </button>
            <button
              type="button"
              data-testid="pnd-picker-step-dropoff"
              onClick={() => onSelectStep('dropoff')}
              className={`h-7 px-2.5 rounded-lg text-[11px] font-bold inline-flex items-center gap-1 transition-colors ${
                isPickingDropoff
                  ? 'bg-indigo-600 text-white shadow-xs'
                  : dropoff
                    ? 'bg-indigo-500/12 text-indigo-700 dark:text-indigo-300 border border-indigo-500/30'
                    : 'bg-[var(--ps-bg)] text-[var(--ps-text-muted)] border border-[var(--ps-border)]'
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
              title="Use My GPS"
              aria-label="Center on my GPS location"
              className="h-7 w-7 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] hover:bg-[var(--ps-surface-alt)] flex items-center justify-center text-[var(--ps-text)]"
            >
              <LocateFixed className="w-3.5 h-3.5 text-sky-500" />
            </button>
            {pickup && dropoff && (
              <button
                type="button"
                onClick={onSwapPoints}
                title="Swap Pickup A and Dropoff B"
                aria-label="Swap Pickup and Dropoff"
                className="h-7 w-7 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] hover:bg-[var(--ps-surface-alt)] flex items-center justify-center text-[var(--ps-text)]"
              >
                <ArrowLeftRight className="w-3.5 h-3.5 text-[var(--ps-accent)]" />
              </button>
            )}
            <button
              type="button"
              data-testid="pnd-picker-toggle-guide-btn"
              onClick={() => setTipsVisible((prev) => !prev)}
              title="Toggle step-by-step guide"
              aria-label="Toggle step-by-step guide"
              className={`h-7 w-7 rounded-lg border flex items-center justify-center transition-colors ${
                tipsVisible
                  ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)]/12 text-[var(--ps-accent)]'
                  : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
              }`}
            >
              <HelpCircle className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={onExitPickerMode}
              title="Close map picker"
              aria-label="Close map picker"
              className="h-7 w-7 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] hover:bg-[var(--ps-surface-alt)] flex items-center justify-center text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Center Readout or Route Ready Summary */}
        {isReady ? (
          <div className="space-y-2">
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/8 px-2.5 py-1.5 flex items-center justify-between gap-2 text-[11px]">
              <span className="truncate font-semibold text-[var(--ps-text)]">
                {pickup?.label} → {dropoff?.label}
              </span>
              {routeMetrics && (
                <span className="shrink-0 font-extrabold text-emerald-700 dark:text-emerald-300 tabular-nums">
                  {routeMetrics.distanceKm.toFixed(1)} km · ~
                  {routeMetrics.durationMin}m
                </span>
              )}
            </div>
            <button
              type="button"
              data-testid="pnd-picker-continue-booking-btn"
              onClick={onContinueToBooking}
              className="w-full h-9 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-sm flex items-center justify-center gap-1.5 transition-colors"
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
                {liveCenterCoords.lat.toFixed(4)}°,{' '}
                {liveCenterCoords.lng.toFixed(4)}°
              </span>
            </div>
            <button
              type="button"
              data-testid="pnd-picker-confirm-btn"
              onClick={onConfirmCurrentCenter}
              className={`w-full h-9 rounded-xl text-white text-xs font-bold shadow-sm flex items-center justify-center gap-1.5 transition-colors ${
                isPickingPickup
                  ? 'bg-emerald-600 hover:bg-emerald-500'
                  : 'bg-indigo-600 hover:bg-indigo-500'
              }`}
            >
              <Check className="w-3.5 h-3.5" />
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
