'use client';

import React, { useEffect, useRef } from 'react';
import {
  AdvancedMarker,
  useMap,
  useMapsLibrary,
} from '@vis.gl/react-google-maps';
import { buildLamkaRoadRoutePath } from '@/components/discovery/RouteRenderer';
import { clearAppStatus, setAppStatus } from '@/lib/hooks/useAppStatus';
import type { PickNDropPoint } from '@/lib/pick-n-drop/types';

export interface PickNDropRouteLayerProps {
  pickup: PickNDropPoint | null;
  dropoff: PickNDropPoint | null;
  isTwoWay?: boolean;
}

export function PickNDropRouteLayer({
  pickup,
  dropoff,
  isTwoWay = false,
}: PickNDropRouteLayerProps) {
  const map = useMap();
  const routesLibrary = useMapsLibrary('routes');
  const polylinesRef = useRef<google.maps.Polyline[]>([]);

  useEffect(() => {
    if (!map || typeof google === 'undefined' || !google.maps) return;

    const clearLines = () => {
      polylinesRef.current.forEach((p) => p.setMap(null));
      polylinesRef.current = [];
    };

    clearLines();

    if (!pickup || !dropoff) {
      return clearLines;
    }

    let cancelled = false;
    setAppStatus('routing', 'Routing Pick N Drop');

    const drawPolylinePath = (path: google.maps.LatLngLiteral[]) => {
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

      try {
        const bounds = new google.maps.LatLngBounds();
        path.forEach((pt) => bounds.extend(pt));
        map.fitBounds(bounds, { top: 72, right: 56, bottom: 120, left: 56 });
      } catch {
        // ignore bounds fit errors
      }
    };

    const runRoute = async () => {
      try {
        if (routesLibrary && typeof google.maps.DirectionsService === 'function') {
          const service = new google.maps.DirectionsService();
          const result = await new Promise<google.maps.DirectionsResult | null>(
            (resolve) => {
              service.route(
                {
                  origin: { lat: pickup.lat, lng: pickup.lng },
                  destination: { lat: dropoff.lat, lng: dropoff.lng },
                  travelMode: google.maps.TravelMode.DRIVING,
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

          const overview = result?.routes?.[0]?.overview_path;
          if (!cancelled && overview && overview.length >= 2) {
            drawPolylinePath(
              overview.map((pt) => ({ lat: pt.lat(), lng: pt.lng() }))
            );
            return;
          }
        }

        // Graceful fallback to local Lamka road network path
        const fallbackPath = buildLamkaRoadRoutePath(
          { lat: pickup.lat, lng: pickup.lng },
          { lat: dropoff.lat, lng: dropoff.lng }
        );
        drawPolylinePath(fallbackPath);
      } catch {
        const fallbackPath = buildLamkaRoadRoutePath(
          { lat: pickup.lat, lng: pickup.lng },
          { lat: dropoff.lat, lng: dropoff.lng }
        );
        drawPolylinePath(fallbackPath);
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
  }, [map, routesLibrary, pickup, dropoff, isTwoWay]);

  return (
    <>
      {pickup && (
        <AdvancedMarker
          position={{ lat: pickup.lat, lng: pickup.lng }}
          title={`Pickup (A): ${pickup.label}`}
          zIndex={120}
        >
          <div className="flex items-center gap-1 rounded-full border-2 border-white bg-emerald-600 px-2 py-0.5 text-[10px] font-extrabold text-white shadow-lg">
            <span>A</span>
            <span className="max-w-[90px] truncate font-semibold">Pickup</span>
          </div>
        </AdvancedMarker>
      )}
      {dropoff && (
        <AdvancedMarker
          position={{ lat: dropoff.lat, lng: dropoff.lng }}
          title={`Dropoff (B): ${dropoff.label}`}
          zIndex={120}
        >
          <div className="flex items-center gap-1 rounded-full border-2 border-white bg-indigo-600 px-2 py-0.5 text-[10px] font-extrabold text-white shadow-lg">
            <span>B</span>
            <span className="max-w-[90px] truncate font-semibold">Dropoff</span>
          </div>
        </AdvancedMarker>
      )}
    </>
  );
}

export default PickNDropRouteLayer;
