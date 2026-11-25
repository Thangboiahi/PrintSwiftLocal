'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  AdvancedMarker,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import { AlertTriangle, Loader2, Move, Pin, RefreshCw, X } from 'lucide-react';
import { buildLamkaRoadRoutePath } from '@/components/discovery/RouteRenderer';
import { clearAppStatus, setAppStatus } from '@/lib/hooks/useAppStatus';
import { calculateDistanceMeters } from '@/lib/rules';
import type { PickNDropPoint } from '@/lib/pick-n-drop/types';
import type { CustomMapMarker } from '@/lib/pick-n-drop/draft-context';

export interface PickNDropRouteMetrics {
  distanceKm: number;
  durationMin: number;
  isFallback?: boolean;
}

export interface PickNDropRouteStep {
  instruction: string;
  distanceText?: string;
}

export interface PickNDropRouteLayerProps {
  pickup: PickNDropPoint | null;
  dropoff: PickNDropPoint | null;
  isTwoWay?: boolean;
  travelMode?: 'DRIVING' | 'WALKING';
  bottomPaddingPx?: number;
  activeEditingTarget?: 'pickup' | 'dropoff' | null;
  retrySeq?: number;
  onSelectMarker?: (target: 'pickup' | 'dropoff') => void;
  onMovePickup?: (coords: { lat: number; lng: number }) => void;
  onMoveDropoff?: (coords: { lat: number; lng: number }) => void;
  customMarkers?: CustomMapMarker[];
  showCustomMarkers?: boolean;
  onMoveCustomMarker?: (id: string, coords: { lat: number; lng: number }) => void;
  onRemoveCustomMarker?: (id: string) => void;
  onRouteMetrics?: (metrics: PickNDropRouteMetrics | null) => void;
  onRouteSteps?: (steps: PickNDropRouteStep[]) => void;
  onRoutingStateChange?: (state: {
    isRouting: boolean;
    error: string | null;
  }) => void;
  onRetryRoute?: () => void;
}

function computePathDistanceKm(path: google.maps.LatLngLiteral[]): number {
  if (path.length < 2) return 0;
  let meters = 0;
  for (let i = 1; i < path.length; i += 1) {
    meters += calculateDistanceMeters(path[i - 1], path[i]);
  }
  return Number((Math.max(50, meters) / 1000).toFixed(2));
}

export function PickNDropRouteLayer({
  pickup,
  dropoff,
  isTwoWay = false,
  travelMode = 'DRIVING',
  bottomPaddingPx = 120,
  activeEditingTarget = null,
  retrySeq = 0,
  onSelectMarker,
  onMovePickup,
  onMoveDropoff,
  customMarkers = [],
  showCustomMarkers = true,
  onMoveCustomMarker,
  onRemoveCustomMarker,
  onRouteMetrics,
  onRouteSteps,
  onRoutingStateChange,
  onRetryRoute,
}: PickNDropRouteLayerProps) {
  const map = useMap();
  const routesLibrary = useMapsLibrary('routes');
  const polylinesRef = useRef<google.maps.Polyline[]>([]);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [isRouting, setIsRouting] = useState(false);
  const [routeError, setRouteError] = useState<string | null>(null);
  const [liveBadgeMetrics, setLiveBadgeMetrics] =
    useState<PickNDropRouteMetrics | null>(null);

  const onRouteMetricsRef = useRef(onRouteMetrics);
  const onRouteStepsRef = useRef(onRouteSteps);
  const onRoutingStateChangeRef = useRef(onRoutingStateChange);

  useEffect(() => {
    onRouteMetricsRef.current = onRouteMetrics;
  }, [onRouteMetrics]);
  useEffect(() => {
    onRouteStepsRef.current = onRouteSteps;
  }, [onRouteSteps]);
  useEffect(() => {
    onRoutingStateChangeRef.current = onRoutingStateChange;
  }, [onRoutingStateChange]);

  const pickupLat = pickup?.lat ?? null;
  const pickupLng = pickup?.lng ?? null;
  const dropoffLat = dropoff?.lat ?? null;
  const dropoffLng = dropoff?.lng ?? null;

  useEffect(() => {
    if (!map || typeof google === 'undefined' || !google.maps) return;

    const clearLines = () => {
      polylinesRef.current.forEach((p) => p.setMap(null));
      polylinesRef.current = [];
    };

    clearLines();

    if (
      pickupLat === null ||
      pickupLng === null ||
      dropoffLat === null ||
      dropoffLng === null
    ) {
      let cleared = false;
      queueMicrotask(() => {
        if (cleared) return;
        setLiveBadgeMetrics(null);
        setIsRouting(false);
        setRouteError(null);
        onRouteMetricsRef.current?.(null);
        onRoutingStateChangeRef.current?.({ isRouting: false, error: null });
      });
      return () => {
        cleared = true;
        clearLines();
      };
    }

    let cancelled = false;
    queueMicrotask(() => {
      if (cancelled) return;
      setIsRouting(true);
      setRouteError(null);
      onRoutingStateChangeRef.current?.({ isRouting: true, error: null });
    });
    setAppStatus('routing', 'Calculating route & live fare');

    const drawPolylinePath = (
      path: google.maps.LatLngLiteral[],
      distanceKm: number,
      durationMin: number,
      isFallback = false,
      errorMessage: string | null = null
    ) => {
      if (cancelled || !map) return;
      clearLines();

      const outerLine = new google.maps.Polyline({
        path,
        strokeColor: '#0f172a',
        strokeOpacity: 0.35,
        strokeWeight: 7,
        zIndex: 88,
        map,
      });

      const primaryLine = new google.maps.Polyline({
        path,
        strokeColor: isTwoWay ? '#0891b2' : '#059669',
        strokeOpacity: 0.95,
        strokeWeight: 4,
        zIndex: 90,
        map,
      });

      polylinesRef.current = [outerLine, primaryLine];
      const nextMetrics: PickNDropRouteMetrics = {
        distanceKm,
        durationMin,
        isFallback,
      };
      setLiveBadgeMetrics(nextMetrics);
      setRouteError(errorMessage);
      setIsRouting(false);
      onRouteMetricsRef.current?.(nextMetrics);
      onRoutingStateChangeRef.current?.({
        isRouting: false,
        error: errorMessage,
      });

      // Only auto-fit bounds when not actively repositioning a single crosshair pin
      if (!activeEditingTarget) {
        try {
          const bounds = new google.maps.LatLngBounds();
          path.forEach((pt) => bounds.extend(pt));
          map.fitBounds(bounds, {
            top: 116,
            right: 56,
            bottom: Math.max(120, Math.round(bottomPaddingPx)),
            left: 56,
          });
        } catch {
          // ignore bounds fit errors
        }
      }
    };

    const runRoute = async () => {
      const originPt = { lat: pickupLat, lng: pickupLng };
      const destPt = { lat: dropoffLat, lng: dropoffLng };

      try {
        // 1. Prefer modern Routes API (Route.computeRoutes) when available on routesLibrary
        const routesLibAny = routesLibrary as unknown as {
          Route?: {
            computeRoutes?: (req: Record<string, unknown>) => Promise<{
              routes?: Array<{
                path?: Array<google.maps.LatLng | google.maps.LatLngLiteral>;
                distanceMeters?: number;
                durationMillis?: number;
                legs?: Array<{
                  steps?: Array<{
                    instructions?: string;
                    localizedValues?: { distance?: { text?: string } };
                  }>;
                }>;
              }>;
            }>;
          };
        } | null;

        if (routesLibAny?.Route?.computeRoutes) {
          try {
            const response = await routesLibAny.Route.computeRoutes({
              origin: originPt,
              destination: destPt,
              travelMode: travelMode === 'WALKING' ? 'WALKING' : 'DRIVING',
              fields: ['path', 'distanceMeters', 'durationMillis'],
            });
            const route = response?.routes?.[0];
            if (!cancelled && Array.isArray(route?.path) && route.path.length >= 2) {
              const pts = route.path.map((p) =>
                typeof (p as google.maps.LatLng).lat === 'function'
                  ? {
                      lat: (p as google.maps.LatLng).lat(),
                      lng: (p as google.maps.LatLng).lng(),
                    }
                  : {
                      lat: (p as google.maps.LatLngLiteral).lat,
                      lng: (p as google.maps.LatLngLiteral).lng,
                    }
              );
              const distKm =
                typeof route.distanceMeters === 'number' && route.distanceMeters > 0
                  ? Number((route.distanceMeters / 1000).toFixed(2))
                  : computePathDistanceKm(pts);
              const durMin =
                typeof route.durationMillis === 'number' && route.durationMillis > 0
                  ? Math.max(1, Math.round(route.durationMillis / 60000))
                  : Math.max(2, Math.round((distKm / 24) * 60));
              onRouteStepsRef.current?.([]);
              drawPolylinePath(pts, distKm, durMin, false, null);
              return;
            }
          } catch {
            // Fall through cleanly to DirectionsService / local road path
          }
        }

        // 2. Fallback to DirectionsService if available
        if (
          routesLibrary &&
          typeof google.maps.DirectionsService === 'function'
        ) {
          const service = new google.maps.DirectionsService();
          const result = await new Promise<google.maps.DirectionsResult | null>(
            (resolve) => {
              service.route(
                {
                  origin: originPt,
                  destination: destPt,
                  travelMode:
                    travelMode === 'WALKING'
                      ? google.maps.TravelMode.WALKING
                      : google.maps.TravelMode.DRIVING,
                },
                (res, status) => {
                  if (status === google.maps.DirectionsStatus.OK && res) {
                    resolve(res);
                  } else {
                    resolve(null);
                  }
                }
              );
            }
          );

          const firstRoute = result?.routes?.[0];
          const overview = firstRoute?.overview_path;
          if (!cancelled && overview && overview.length >= 2) {
            const pts = overview.map((pt) => ({
              lat: pt.lat(),
              lng: pt.lng(),
            }));
            const leg = firstRoute?.legs?.[0];
            const distKm =
              typeof leg?.distance?.value === 'number' && leg.distance.value > 0
                ? Number((leg.distance.value / 1000).toFixed(2))
                : computePathDistanceKm(pts);
            const durMin =
              typeof leg?.duration?.value === 'number' && leg.duration.value > 0
                ? Math.max(1, Math.round(leg.duration.value / 60))
                : Math.max(2, Math.round((distKm / 24) * 60));
            const rawSteps = Array.isArray(leg?.steps) ? leg.steps : [];
            const parsedSteps: PickNDropRouteStep[] = rawSteps
              .slice(0, 14)
              .map((st) => ({
                instruction: String(st.instructions || '')
                  .replace(/<[^>]+>/g, ' ')
                  .replace(/\s+/g, ' ')
                  .trim(),
                distanceText: st.distance?.text || undefined,
              }))
              .filter((s) => s.instruction.length > 0);
            onRouteStepsRef.current?.(parsedSteps);
            drawPolylinePath(pts, distKm, durMin, false, null);
            return;
          }
        }

        // 3. Graceful fallback to local Lamka road network path with retry recovery
        const fallbackPath = buildLamkaRoadRoutePath(originPt, destPt);
        const distKm = computePathDistanceKm(fallbackPath);
        const durMin = Math.max(2, Math.round((distKm / 24) * 60));
        onRouteStepsRef.current?.([]);
        drawPolylinePath(
          fallbackPath,
          distKm,
          durMin,
          true,
          'Using estimated local road route — live Google routing unavailable.'
        );
      } catch {
        const fallbackPath = buildLamkaRoadRoutePath(originPt, destPt);
        const distKm = computePathDistanceKm(fallbackPath);
        const durMin = Math.max(2, Math.round((distKm / 24) * 60));
        drawPolylinePath(
          fallbackPath,
          distKm,
          durMin,
          true,
          'Live routing timed out — showing estimated Lamka road path.'
        );
      } finally {
        if (!cancelled) {
          clearAppStatus();
        }
      }
    };

    void runRoute();

    return () => {
      cancelled = true;
      clearLines();
      clearAppStatus();
    };
  }, [
    map,
    routesLibrary,
    pickupLat,
    pickupLng,
    dropoffLat,
    dropoffLng,
    isTwoWay,
    travelMode,
    bottomPaddingPx,
    activeEditingTarget,
    retrySeq,
  ]);

  return (
    <>
      {/* Non-Blocking Routing Loading Pill (top-safe, below header) */}
      {isRouting && pickup && dropoff && (
        <div
          data-testid="pnd-routing-loading-pill"
          role="status"
          aria-live="polite"
          className="pointer-events-none fixed top-[72px] sm:top-[80px] left-1/2 -translate-x-1/2 z-[68] inline-flex items-center gap-2 rounded-full border border-[var(--ps-accent)]/40 bg-[var(--ps-surface)]/95 px-3.5 py-1.5 text-[11px] font-bold text-[var(--ps-text)] shadow-lg backdrop-blur-md whitespace-nowrap"
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--ps-accent)]" />
          <span>Calculating route &amp; live fare…</span>
        </div>
      )}

      {/* Route Reference Badge (when routing completes cleanly) */}
      {!isRouting && liveBadgeMetrics && pickup && dropoff && !draggingKey && (
        <div
          data-testid="pnd-map-route-reference-badge"
          className="pointer-events-none fixed top-[72px] sm:top-[80px] left-1/2 -translate-x-1/2 z-[27] inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-slate-950/90 px-3 py-1 text-[11px] font-extrabold text-emerald-200 shadow-lg backdrop-blur-md tabular-nums whitespace-nowrap"
        >
          <span>{liveBadgeMetrics.distanceKm.toFixed(1)} km</span>
          <span className="text-slate-400">·</span>
          <span>~{liveBadgeMetrics.durationMin} min road</span>
          {liveBadgeMetrics.isFallback && (
            <span className="inline-flex items-center gap-1 text-[9.5px] font-semibold text-amber-300">
              <AlertTriangle className="h-3 w-3" />
              Est.
            </span>
          )}
          {routeError && onRetryRoute && (
            <button
              type="button"
              onClick={onRetryRoute}
              className="pointer-events-auto ml-1 inline-flex items-center gap-1 rounded-full bg-white/15 px-2 py-0.5 text-[10px] font-bold text-white hover:bg-white/25 cursor-pointer"
            >
              <RefreshCw className="h-2.5 w-2.5" />
              Retry
            </button>
          )}
        </div>
      )}

      {draggingKey && (
        <div
          data-testid="marker-drag-hint-pill"
          className="pointer-events-none fixed bottom-24 left-1/2 -translate-x-1/2 z-[46] inline-flex items-center gap-1.5 rounded-full border border-amber-400/50 bg-slate-950/92 px-3 py-1.5 text-[11px] font-bold text-amber-200 shadow-xl backdrop-blur-md"
        >
          <Move className="w-3.5 h-3.5 text-amber-400" aria-hidden="true" />
          <span>Drag to move marker — release to update</span>
        </div>
      )}

      {/* Point A (Pickup) Persistent Marker — stays visible even while picking/editing Point B */}
      {pickup && (
        <AdvancedMarker
          position={{ lat: pickup.lat, lng: pickup.lng }}
          title={`Pickup (A): ${pickup.label} (Click to edit or drag to reposition)`}
          draggable={Boolean(onMovePickup)}
          zIndex={
            draggingKey === 'pickup'
              ? 1200
              : activeEditingTarget === 'pickup'
                ? 110
                : 140
          }
          onClick={() => onSelectMarker?.('pickup')}
          onDragStart={() => {
            setDraggingKey('pickup');
            if (typeof navigator !== 'undefined' && navigator.vibrate) {
              navigator.vibrate(14);
            }
          }}
          onDragEnd={(ev) => {
            setDraggingKey(null);
            if (ev.latLng && onMovePickup) {
              onMovePickup({
                lat: Number(ev.latLng.lat().toFixed(6)),
                lng: Number(ev.latLng.lng().toFixed(6)),
              });
            }
          }}
        >
          <div
            data-testid="pnd-pickup-marker"
            className={`flex flex-col items-center transition-all ${
              activeEditingTarget === 'pickup' ? 'opacity-60' : 'opacity-100'
            }`}
          >
            <div
              className={`flex items-center gap-1 rounded-full border-2 border-white bg-emerald-600 px-2.5 py-0.5 text-[10px] font-extrabold text-white shadow-lg transition-transform ${
                onMovePickup ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
              } ${
                draggingKey === 'pickup'
                  ? 'scale-120 -translate-y-1 ring-4 ring-emerald-400/60 shadow-2xl'
                  : 'hover:scale-105'
              }`}
            >
              <span>A</span>
              <span className="max-w-[110px] truncate font-semibold">
                {pickup.label || 'Pickup'}
              </span>
            </div>
            <div className="h-2.5 w-0.5 bg-emerald-600" />
            <span className="h-2 w-2 rounded-full bg-emerald-600 ring-2 ring-white shadow" />
          </div>
        </AdvancedMarker>
      )}

      {/* Point B (Dropoff) Persistent Marker — stays visible even while re-editing Point A */}
      {dropoff && (
        <AdvancedMarker
          position={{ lat: dropoff.lat, lng: dropoff.lng }}
          title={`Dropoff (B): ${dropoff.label} (Click to edit or drag to reposition)`}
          draggable={Boolean(onMoveDropoff)}
          zIndex={
            draggingKey === 'dropoff'
              ? 1200
              : activeEditingTarget === 'dropoff'
                ? 110
                : 140
          }
          onClick={() => onSelectMarker?.('dropoff')}
          onDragStart={() => {
            setDraggingKey('dropoff');
            if (typeof navigator !== 'undefined' && navigator.vibrate) {
              navigator.vibrate(14);
            }
          }}
          onDragEnd={(ev) => {
            setDraggingKey(null);
            if (ev.latLng && onMoveDropoff) {
              onMoveDropoff({
                lat: Number(ev.latLng.lat().toFixed(6)),
                lng: Number(ev.latLng.lng().toFixed(6)),
              });
            }
          }}
        >
          <div
            data-testid="pnd-dropoff-marker"
            className={`flex flex-col items-center transition-all ${
              activeEditingTarget === 'dropoff' ? 'opacity-60' : 'opacity-100'
            }`}
          >
            <div
              className={`flex items-center gap-1 rounded-full border-2 border-white bg-indigo-600 px-2.5 py-0.5 text-[10px] font-extrabold text-white shadow-lg transition-transform ${
                onMoveDropoff ? 'cursor-grab active:cursor-grabbing' : 'cursor-pointer'
              } ${
                draggingKey === 'dropoff'
                  ? 'scale-120 -translate-y-1 ring-4 ring-indigo-400/60 shadow-2xl'
                  : 'hover:scale-105'
              }`}
            >
              <span>B</span>
              <span className="max-w-[110px] truncate font-semibold">
                {dropoff.label || 'Dropoff'}
              </span>
            </div>
            <div className="h-2.5 w-0.5 bg-indigo-600" />
            <span className="h-2 w-2 rounded-full bg-indigo-600 ring-2 ring-white shadow" />
          </div>
        </AdvancedMarker>
      )}

      {showCustomMarkers &&
        customMarkers.map((marker) => {
          const isDragging = draggingKey === marker.id;
          return (
            <AdvancedMarker
              key={marker.id}
              position={{ lat: marker.lat, lng: marker.lng }}
              title={`${marker.label} (Drag to reposition)`}
              draggable={Boolean(onMoveCustomMarker)}
              zIndex={isDragging ? 1200 : 115}
              onDragStart={() => {
                setDraggingKey(marker.id);
                if (typeof navigator !== 'undefined' && navigator.vibrate) {
                  navigator.vibrate(14);
                }
              }}
              onDragEnd={(ev) => {
                setDraggingKey(null);
                if (ev.latLng && onMoveCustomMarker) {
                  onMoveCustomMarker(marker.id, {
                    lat: Number(ev.latLng.lat().toFixed(6)),
                    lng: Number(ev.latLng.lng().toFixed(6)),
                  });
                }
              }}
            >
              <div
                data-testid={`user-custom-marker-${marker.id}`}
                className={`group flex items-center gap-1 rounded-full border-2 border-white bg-teal-600 pl-2 pr-1.5 py-0.5 text-[10px] font-bold text-white shadow-lg transition-transform ${
                  onMoveCustomMarker ? 'cursor-grab active:cursor-grabbing' : ''
                } ${
                  isDragging
                    ? 'scale-125 -translate-y-1 ring-4 ring-teal-400/60 shadow-2xl'
                    : 'hover:scale-105'
                }`}
              >
                <Pin className="w-2.5 h-2.5 shrink-0" aria-hidden="true" />
                <span className="max-w-[100px] truncate">{marker.label}</span>
                {onRemoveCustomMarker && (
                  <button
                    type="button"
                    aria-label={`Remove marker ${marker.label}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      onRemoveCustomMarker(marker.id);
                    }}
                    className="ml-0.5 h-3.5 w-3.5 rounded-full bg-black/25 hover:bg-black/45 flex items-center justify-center cursor-pointer"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                )}
              </div>
            </AdvancedMarker>
          );
        })}
    </>
  );
}

export default PickNDropRouteLayer;
