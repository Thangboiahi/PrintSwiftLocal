'use client';

import React, { useEffect, useRef, useState } from 'react';
import {
  AdvancedMarker,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import { Move, Pin, X } from 'lucide-react';
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
  onMovePickup?: (coords: { lat: number; lng: number }) => void;
  onMoveDropoff?: (coords: { lat: number; lng: number }) => void;
  customMarkers?: CustomMapMarker[];
  showCustomMarkers?: boolean;
  onMoveCustomMarker?: (id: string, coords: { lat: number; lng: number }) => void;
  onRemoveCustomMarker?: (id: string) => void;
  onRouteMetrics?: (metrics: PickNDropRouteMetrics | null) => void;
  onRouteSteps?: (steps: PickNDropRouteStep[]) => void;
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
  onMovePickup,
  onMoveDropoff,
  customMarkers = [],
  showCustomMarkers = true,
  onMoveCustomMarker,
  onRemoveCustomMarker,
  onRouteMetrics,
  onRouteSteps,
}: PickNDropRouteLayerProps) {
  const map = useMap();
  const routesLibrary = useMapsLibrary('routes');
  const polylinesRef = useRef<google.maps.Polyline[]>([]);
  const [draggingKey, setDraggingKey] = useState<string | null>(null);
  const [liveBadgeMetrics, setLiveBadgeMetrics] =
    useState<PickNDropRouteMetrics | null>(null);
  const onRouteMetricsRef = useRef(onRouteMetrics);
  const onRouteStepsRef = useRef(onRouteSteps);
  useEffect(() => {
    onRouteMetricsRef.current = onRouteMetrics;
  }, [onRouteMetrics]);
  useEffect(() => {
    onRouteStepsRef.current = onRouteSteps;
  }, [onRouteSteps]);

  useEffect(() => {
    if (!map || typeof google === 'undefined' || !google.maps) return;

    const clearLines = () => {
      polylinesRef.current.forEach((p) => p.setMap(null));
      polylinesRef.current = [];
    };

    clearLines();

    if (!pickup || !dropoff) {
      setLiveBadgeMetrics(null);
      onRouteMetricsRef.current?.(null);
      return clearLines;
    }

    let cancelled = false;
    setAppStatus('routing', 'Routing Pick N Drop');

    const drawPolylinePath = (
      path: google.maps.LatLngLiteral[],
      distanceKm: number,
      durationMin: number,
      isFallback = false
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
      onRouteMetricsRef.current?.(nextMetrics);

      try {
        const bounds = new google.maps.LatLngBounds();
        path.forEach((pt) => bounds.extend(pt));
        map.fitBounds(bounds, {
          top: 72,
          right: 56,
          bottom: Math.max(96, Math.round(bottomPaddingPx)),
          left: 56,
        });
      } catch {
        // ignore bounds fit errors
      }
    };

    const runRoute = async () => {
      try {
        if (
          routesLibrary &&
          typeof google.maps.DirectionsService === 'function'
        ) {
          const service = new google.maps.DirectionsService();
          const result = await new Promise<google.maps.DirectionsResult | null>(
            (resolve) => {
              service.route(
                {
                  origin: { lat: pickup.lat, lng: pickup.lng },
                  destination: { lat: dropoff.lat, lng: dropoff.lng },
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
            drawPolylinePath(pts, distKm, durMin, false);
            return;
          }
        }

        // Graceful fallback to local Lamka road network path
        const fallbackPath = buildLamkaRoadRoutePath(
          { lat: pickup.lat, lng: pickup.lng },
          { lat: dropoff.lat, lng: dropoff.lng }
        );
        const distKm = computePathDistanceKm(fallbackPath);
        const durMin = Math.max(2, Math.round((distKm / 24) * 60));
        onRouteStepsRef.current?.([]);
        drawPolylinePath(fallbackPath, distKm, durMin, true);
      } catch {
        const fallbackPath = buildLamkaRoadRoutePath(
          { lat: pickup.lat, lng: pickup.lng },
          { lat: dropoff.lat, lng: dropoff.lng }
        );
        const distKm = computePathDistanceKm(fallbackPath);
        const durMin = Math.max(2, Math.round((distKm / 24) * 60));
        drawPolylinePath(fallbackPath, distKm, durMin, true);
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
  }, [map, routesLibrary, pickup, dropoff, isTwoWay, travelMode, bottomPaddingPx]);

  return (
    <>
      {liveBadgeMetrics && pickup && dropoff && !draggingKey && (
        <div
          data-testid="pnd-map-route-reference-badge"
          className="pointer-events-none fixed top-20 left-1/2 -translate-x-1/2 z-[27] inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-slate-950/90 px-3 py-1 text-[11px] font-extrabold text-emerald-200 shadow-lg backdrop-blur-md tabular-nums whitespace-nowrap"
        >
          <span>{liveBadgeMetrics.distanceKm.toFixed(1)} km</span>
          <span className="text-slate-400">·</span>
          <span>~{liveBadgeMetrics.durationMin} min road</span>
          {liveBadgeMetrics.isFallback && (
            <span className="text-[9px] font-semibold text-amber-300">
              (Est.)
            </span>
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

      {pickup && (
        <AdvancedMarker
          position={{ lat: pickup.lat, lng: pickup.lng }}
          title={`Pickup (A): ${pickup.label} (Hold & drag to reposition)`}
          draggable={Boolean(onMovePickup)}
          zIndex={draggingKey === 'pickup' ? 1200 : 120}
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
            className={`flex items-center gap-1 rounded-full border-2 border-white bg-emerald-600 px-2.5 py-0.5 text-[10px] font-extrabold text-white shadow-lg transition-transform ${
              onMovePickup ? 'cursor-grab active:cursor-grabbing' : ''
            } ${
              draggingKey === 'pickup'
                ? 'scale-125 -translate-y-1 ring-4 ring-emerald-400/60 shadow-2xl'
                : 'hover:scale-105'
            }`}
          >
            <span>A</span>
            <span className="max-w-[96px] truncate font-semibold">Pickup</span>
          </div>
        </AdvancedMarker>
      )}

      {dropoff && (
        <AdvancedMarker
          position={{ lat: dropoff.lat, lng: dropoff.lng }}
          title={`Dropoff (B): ${dropoff.label} (Hold & drag to reposition)`}
          draggable={Boolean(onMoveDropoff)}
          zIndex={draggingKey === 'dropoff' ? 1200 : 120}
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
            className={`flex items-center gap-1 rounded-full border-2 border-white bg-indigo-600 px-2.5 py-0.5 text-[10px] font-extrabold text-white shadow-lg transition-transform ${
              onMoveDropoff ? 'cursor-grab active:cursor-grabbing' : ''
            } ${
              draggingKey === 'dropoff'
                ? 'scale-125 -translate-y-1 ring-4 ring-indigo-400/60 shadow-2xl'
                : 'hover:scale-105'
            }`}
          >
            <span>B</span>
            <span className="max-w-[96px] truncate font-semibold">Dropoff</span>
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
                    className="ml-0.5 h-3.5 w-3.5 rounded-full bg-black/25 hover:bg-black/45 flex items-center justify-center"
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
