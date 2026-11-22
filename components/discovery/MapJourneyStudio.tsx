'use client';

import React, { useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  AlertTriangle,
  ArrowLeftRight,
  ArrowRight,
  Bike,
  Car,
  CarTaxiFront,
  ChevronDown,
  ChevronUp,
  Clock,
  Crosshair,
  ExternalLink,
  Footprints,
  Navigation,
  Route as RouteIcon,
  Truck,
  X,
} from 'lucide-react';
import type { PickNDropPoint } from '@/lib/pick-n-drop/types';
import type { PickNDropRouteMetrics } from '@/components/pickndrop/PickNDropRouteLayer';
import { calculateDistanceMeters } from '@/lib/rules';
import { splitSamplePrefix } from '@/lib/utils/display-title';

export type JourneyTabMode = 'directions' | 'pick_n_drop';
export type JourneyTravelMode = 'DRIVING' | 'WALKING';

export interface JourneyTurnStep {
  instruction: string;
  distanceText?: string;
}

export interface MapJourneyStudioProps {
  open: boolean;
  journeyTab: JourneyTabMode;
  onChangeJourneyTab: (tab: JourneyTabMode) => void;
  travelMode: JourneyTravelMode;
  onChangeTravelMode: (mode: JourneyTravelMode) => void;
  origin: PickNDropPoint | null;
  destination: PickNDropPoint | null;
  routeMetrics: PickNDropRouteMetrics | null;
  steps?: JourneyTurnStep[];
  onStartCrosshairPick: (target: 'pickup' | 'dropoff') => void;
  onSwapPoints: () => void;
  onContinueToPickNDropBooking: () => void;
  onClose: () => void;
}

export function MapJourneyStudio({
  open,
  journeyTab,
  onChangeJourneyTab,
  travelMode,
  onChangeTravelMode,
  origin,
  destination,
  routeMetrics,
  steps = [],
  onStartCrosshairPick,
  onSwapPoints,
  onContinueToPickNDropBooking,
  onClose,
}: MapJourneyStudioProps) {
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [showSteps, setShowSteps] = useState(false);

  const cleanOriginLabel = origin
    ? splitSamplePrefix(origin.label).title
    : 'Set Point A (Start / Pickup)';
  const cleanDestLabel = destination
    ? splitSamplePrefix(destination.label).title
    : 'Set Point B (Dest / Dropoff)';

  const straightMeters = useMemo(() => {
    if (!origin || !destination) return null;
    return calculateDistanceMeters(origin, destination);
  }, [origin, destination]);

  const isTooCloseWarning =
    straightMeters !== null && straightMeters < 50;

  const displayDistanceKm =
    routeMetrics?.distanceKm ??
    (straightMeters !== null
      ? Number((Math.max(50, straightMeters * 1.25) / 1000).toFixed(2))
      : null);

  const displayDurationMin = useMemo(() => {
    if (displayDistanceKm === null) return null;
    if (travelMode === 'WALKING') {
      return Math.max(1, Math.round((displayDistanceKm / 4.8) * 60));
    }
    return (
      routeMetrics?.durationMin ??
      Math.max(2, Math.round((displayDistanceKm / 24) * 60))
    );
  }, [displayDistanceKm, routeMetrics?.durationMin, travelMode]);

  const googleMapsDirUrl = useMemo(() => {
    if (!origin || !destination) return null;
    const modeParam = travelMode === 'WALKING' ? 'walking' : 'driving';
    return `https://www.google.com/maps/dir/?api=1&origin=${origin.lat},${origin.lng}&destination=${destination.lat},${destination.lng}&travelmode=${modeParam}`;
  }, [origin, destination, travelMode]);

  const quickFareEstimates = useMemo(() => {
    const km = Math.max(0.5, displayDistanceKm ?? 1.5);
    return [
      {
        id: 'two_wheeler',
        label: 'Scooty',
        icon: Bike,
        fare: Math.round(40 + km * 10),
      },
      {
        id: 'e_rickshaw',
        label: 'Auto',
        icon: CarTaxiFront,
        fare: Math.round(70 + km * 15),
      },
      {
        id: 'mini_van',
        label: 'Mini-Van',
        icon: Car,
        fare: Math.round(120 + km * 20),
      },
    ];
  }, [displayDistanceKm]);

  if (!open) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 10 }}
        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
        onClick={(e) => e.stopPropagation()}
        onPointerDown={(e) => e.stopPropagation()}
        data-testid="map-journey-studio"
        role="region"
        aria-label="Map Journey Studio — Directions and Pick N Drop"
        className="pointer-events-auto absolute bottom-3 left-1/2 -translate-x-1/2 z-[31] w-[min(94%,440px)] md:bottom-auto md:top-3 md:left-3 md:translate-x-0 md:w-[340px] lg:w-[360px] max-h-[calc(100%-24px)] overflow-y-auto overscroll-contain rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)]/96 backdrop-blur-md text-[var(--ps-text)] shadow-2xl text-xs"
      >
        {/* Compact Header Row */}
        <div className="px-3.5 py-2.5 border-b border-[var(--ps-border)]/80 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-xl bg-theme-primary/12 text-theme-primary">
              {journeyTab === 'pick_n_drop' ? (
                <Truck className="w-3.5 h-3.5" />
              ) : (
                <RouteIcon className="w-3.5 h-3.5" />
              )}
            </span>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="font-extrabold text-xs text-[var(--ps-text)]">
                  Journey Studio
                </span>
                {displayDistanceKm !== null && displayDurationMin !== null && (
                  <span
                    data-testid="journey-studio-metrics-chip"
                    className="inline-flex items-center gap-1 rounded-full bg-emerald-500/12 border border-emerald-500/30 px-2 py-0.5 text-[10px] font-extrabold text-emerald-700 dark:text-emerald-300 tabular-nums"
                  >
                    <span>{displayDistanceKm.toFixed(1)} km</span>
                    <span>·</span>
                    <span>~{displayDurationMin}m</span>
                  </span>
                )}
              </div>
              {isCollapsed && (
                <p className="text-[10px] text-[var(--ps-text-muted)] truncate">
                  {cleanOriginLabel} → {cleanDestLabel}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <button
              type="button"
              onClick={() => setIsCollapsed((prev) => !prev)}
              aria-label={
                isCollapsed ? 'Expand Journey Studio' : 'Collapse Journey Studio'
              }
              title={isCollapsed ? 'Expand' : 'Collapse to pill'}
              className="h-7 w-7 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] flex items-center justify-center text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]"
            >
              {isCollapsed ? (
                <ChevronUp className="w-3.5 h-3.5" />
              ) : (
                <ChevronDown className="w-3.5 h-3.5" />
              )}
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close Journey Studio"
              title="Close"
              data-testid="journey-studio-close-btn"
              className="h-7 w-7 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] flex items-center justify-center text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

        {/* Collapsible Body */}
        {!isCollapsed && (
          <div className="p-3.5 space-y-3">
            {/* Segmented Mode Switcher: Directions | Pick N Drop */}
            <div
              role="tablist"
              aria-label="Journey mode"
              className="grid grid-cols-2 gap-1 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-1"
            >
              <button
                type="button"
                role="tab"
                aria-selected={journeyTab === 'directions'}
                data-testid="journey-tab-directions"
                onClick={() => onChangeJourneyTab('directions')}
                className={`h-8 rounded-lg text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-colors ${
                  journeyTab === 'directions'
                    ? 'bg-theme-primary text-theme-primary-foreground shadow-xs'
                    : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                }`}
              >
                <Navigation className="w-3.5 h-3.5" />
                <span>Directions</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={journeyTab === 'pick_n_drop'}
                data-testid="journey-tab-pick-n-drop"
                onClick={() => onChangeJourneyTab('pick_n_drop')}
                className={`h-8 rounded-lg text-xs font-bold inline-flex items-center justify-center gap-1.5 transition-colors ${
                  journeyTab === 'pick_n_drop'
                    ? 'bg-emerald-600 text-white shadow-xs'
                    : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                }`}
              >
                <Truck className="w-3.5 h-3.5" />
                <span>Pick N Drop</span>
              </button>
            </div>

            {/* Unified Point A -> Point B Rows + Swap + Crosshair Triggers */}
            <div className="space-y-1.5">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => onStartCrosshairPick('pickup')}
                  className="flex-1 min-w-0 h-8 px-2.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] hover:border-emerald-500/60 flex items-center gap-2 text-left transition-colors"
                >
                  <span className="h-4.5 w-4.5 rounded-full bg-emerald-600 text-white text-[9px] font-extrabold flex items-center justify-center shrink-0">
                    A
                  </span>
                  <span className="truncate text-[11px] font-semibold text-[var(--ps-text)]">
                    {cleanOriginLabel}
                  </span>
                  <Crosshair className="w-3 h-3 text-[var(--ps-text-muted)] ml-auto shrink-0" />
                </button>
                {origin && destination && (
                  <button
                    type="button"
                    onClick={onSwapPoints}
                    title="Swap Point A and Point B"
                    aria-label="Swap A and B"
                    className="h-8 w-8 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] hover:border-[var(--ps-accent)] flex items-center justify-center text-[var(--ps-text-muted)] hover:text-[var(--ps-accent)] shrink-0"
                  >
                    <ArrowLeftRight className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>

              <button
                type="button"
                onClick={() => onStartCrosshairPick('dropoff')}
                className="w-full h-8 px-2.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] hover:border-indigo-500/60 flex items-center gap-2 text-left transition-colors"
              >
                <span className="h-4.5 w-4.5 rounded-full bg-indigo-600 text-white text-[9px] font-extrabold flex items-center justify-center shrink-0">
                  B
                </span>
                <span className="truncate text-[11px] font-semibold text-[var(--ps-text)]">
                  {cleanDestLabel}
                </span>
                <Crosshair className="w-3 h-3 text-[var(--ps-text-muted)] ml-auto shrink-0" />
              </button>
            </div>

            {/* Too-Close Warning (< 50m) */}
            {isTooCloseWarning && (
              <div
                role="alert"
                className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-2.5 py-2 flex items-start gap-2 text-[11px] text-amber-800 dark:text-amber-300"
              >
                <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                <span>
                  Points A &amp; B are within 50m — reposition one pin for an
                  accurate road route.
                </span>
              </div>
            )}

            {/* TAB 1: DIRECTIONS */}
            {journeyTab === 'directions' ? (
              <div className="space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="inline-flex rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] p-0.5">
                    <button
                      type="button"
                      onClick={() => onChangeTravelMode('DRIVING')}
                      className={`h-7 px-2.5 rounded-md text-[11px] font-bold inline-flex items-center gap-1 transition-colors ${
                        travelMode === 'DRIVING'
                          ? 'bg-theme-primary text-theme-primary-foreground'
                          : 'text-[var(--ps-text-muted)]'
                      }`}
                    >
                      <Car className="w-3 h-3" />
                      <span>Drive / Bike</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => onChangeTravelMode('WALKING')}
                      className={`h-7 px-2.5 rounded-md text-[11px] font-bold inline-flex items-center gap-1 transition-colors ${
                        travelMode === 'WALKING'
                          ? 'bg-theme-primary text-theme-primary-foreground'
                          : 'text-[var(--ps-text-muted)]'
                      }`}
                    >
                      <Footprints className="w-3 h-3" />
                      <span>Walk</span>
                    </button>
                  </div>

                  {displayDurationMin !== null && (
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold text-[var(--ps-text-muted)] tabular-nums">
                      <Clock className="w-3 h-3 text-emerald-500" />
                      <span>~{displayDurationMin} min</span>
                    </span>
                  )}
                </div>

                {steps.length > 0 && (
                  <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 py-2 space-y-1.5">
                    <button
                      type="button"
                      onClick={() => setShowSteps((prev) => !prev)}
                      className="w-full flex items-center justify-between text-[11px] font-bold text-[var(--ps-text)]"
                    >
                      <span>Turn-by-Turn Steps ({steps.length})</span>
                      {showSteps ? (
                        <ChevronUp className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronDown className="w-3.5 h-3.5" />
                      )}
                    </button>
                    {showSteps && (
                      <ol className="space-y-1 max-h-36 overflow-y-auto pr-1 text-[11px] text-[var(--ps-text-muted)] list-decimal list-inside">
                        {steps.map((s, idx) => (
                          <li key={idx} className="leading-snug">
                            <span className="text-[var(--ps-text)]">
                              {s.instruction}
                            </span>
                            {s.distanceText && (
                              <span className="ml-1 font-mono text-[10px]">
                                ({s.distanceText})
                              </span>
                            )}
                          </li>
                        ))}
                      </ol>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap items-center gap-2">
                  {googleMapsDirUrl && (
                    <a
                      href={googleMapsDirUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="flex-1 h-8 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] hover:border-theme-primary text-[11px] font-bold text-[var(--ps-text)] inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
                    >
                      <ExternalLink className="w-3.5 h-3.5 text-sky-500" />
                      <span>Google Maps</span>
                    </a>
                  )}
                  <button
                    type="button"
                    data-testid="journey-switch-to-pnd-btn"
                    onClick={() => onChangeJourneyTab('pick_n_drop')}
                    className="flex-1 h-8 px-3 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-[11px] font-bold inline-flex items-center justify-center gap-1.5 transition-colors whitespace-nowrap"
                  >
                    <Truck className="w-3.5 h-3.5" />
                    <span>Book Pick N Drop →</span>
                  </button>
                </div>
              </div>
            ) : (
              /* TAB 2: PICK N DROP QUICK FARE PREVIEW + CONTINUE */
              <div className="space-y-2.5">
                <div className="grid grid-cols-3 gap-1.5">
                  {quickFareEstimates.map((veh) => {
                    const VIcon = veh.icon;
                    return (
                      <div
                        key={veh.id}
                        className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-1.5 text-center space-y-0.5"
                      >
                        <VIcon className="w-3.5 h-3.5 mx-auto text-[var(--ps-accent)]" />
                        <div className="text-[10px] font-semibold text-[var(--ps-text-muted)]">
                          {veh.label}
                        </div>
                        <div className="text-xs font-extrabold text-[var(--ps-text)] tabular-nums">
                          ~₹{veh.fare}
                        </div>
                      </div>
                    );
                  })}
                </div>

                <button
                  type="button"
                  data-testid="journey-continue-pnd-booking-btn"
                  onClick={onContinueToPickNDropBooking}
                  disabled={!origin || !destination}
                  className="w-full h-9 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold shadow-sm inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
                >
                  <span>Continue to Pick N Drop Booking</span>
                  <ArrowRight className="w-3.5 h-3.5" />
                </button>
              </div>
            )}
          </div>
        )}
      </motion.div>
    </AnimatePresence>
  );
}

export default MapJourneyStudio;
