'use client';

import React, { useEffect, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { useMap, useMapsLibrary } from '@vis.gl/react-google-maps';
import {
  Clock,
  Crosshair,
  MapPin,
  Navigation,
  Route as RouteIcon,
  X,
} from 'lucide-react';
import { calculateDistanceMeters } from '@/lib/rules';
import { CHURACHANDPUR_SAMPLE_CENTER } from '@/lib/seed-data';
import type { LatLngPoint } from '@/lib/types';

export interface RouteEstimateSummary {
  distanceText: string;
  durationText: string;
  destinationTitle: string;
}

export interface RouteRendererProps {
  origin: LatLngPoint | null;
  destination: LatLngPoint | null;
  destinationTitle?: string;
  mapCenter?: LatLngPoint;
  isSettingOrigin?: boolean;
  onSetOriginHere?: (originCoords: LatLngPoint) => void;
  onCancelSetOrigin?: () => void;
  onClearRoute?: () => void;
  onRouteCalculated?: (summary: RouteEstimateSummary | null) => void;
}

/**
 * Churachandpur (Lamka) arterial road network nodes along Tedim Road (NH-2),
 * Tipaimukh Road, IB Road, Rengkai Road, and Tuibong corridors.
 * Used to synthesize realistic road-following multi-segment polylines whenever
 * the cloud Routes API is unavailable or restricted.
 */
const LAMKA_ARTERIAL_SPINE: LatLngPoint[] = [
  { lat: 24.3535, lng: 93.7042 }, // Mata / North Tedim Road
  { lat: 24.3472, lng: 93.7018 }, // Tuibong Secretariat Junction
  { lat: 24.3422, lng: 93.6998 }, // Tuibong Market Spine
  { lat: 24.3378, lng: 93.6987 }, // Police Station / Tipaimukh Junction
  { lat: 24.3335, lng: 93.6978 }, // New Bazar / Central Lamka Junction
  { lat: 24.3292, lng: 93.6966 }, // Zenhang Lamka / IB Road Junction
  { lat: 24.3248, lng: 93.6952 }, // Rengkai / Pearsonmun Junction
  { lat: 24.3195, lng: 93.6938 }, // Lanva / South Tedim Road
];

/**
 * Builds a multi-segment road-following path between origin and destination
 * aligned with Lamka's arterial grid and connector streets so routes follow
 * realistic road geometry instead of straight point-to-point lines.
 */
export function buildLamkaRoadRoutePath(
  origin: LatLngPoint,
  destination: LatLngPoint
): LatLngPoint[] {
  const dLat = destination.lat - origin.lat;
  const dLng = destination.lng - origin.lng;
  const straightDist = calculateDistanceMeters(origin, destination);

  if (straightDist < 45) {
    return [origin, destination];
  }

  // Project origin and destination onto the nearest arterial spine nodes
  let nearestOriginIdx = 0;
  let nearestOriginDist = Infinity;
  let nearestDestIdx = 0;
  let nearestDestDist = Infinity;

  LAMKA_ARTERIAL_SPINE.forEach((node, idx) => {
    const oDist = calculateDistanceMeters(origin, node);
    if (oDist < nearestOriginDist) {
      nearestOriginDist = oDist;
      nearestOriginIdx = idx;
    }
    const dDist = calculateDistanceMeters(destination, node);
    if (dDist < nearestDestDist) {
      nearestDestDist = dDist;
      nearestDestIdx = idx;
    }
  });

  const path: LatLngPoint[] = [origin];

  // Feeder connector from origin toward arterial corridor (street-grid dogleg)
  const originSpineNode = LAMKA_ARTERIAL_SPINE[nearestOriginIdx];
  const destSpineNode = LAMKA_ARTERIAL_SPINE[nearestDestIdx];

  if (nearestOriginIdx !== nearestDestIdx && straightDist > 220) {
    const entryConnector: LatLngPoint = {
      lat: Number((origin.lat * 0.35 + originSpineNode.lat * 0.65).toFixed(6)),
      lng: Number((origin.lng * 0.2 + originSpineNode.lng * 0.8).toFixed(6)),
    };
    path.push(entryConnector);

    const step = nearestOriginIdx < nearestDestIdx ? 1 : -1;
    for (
      let i = nearestOriginIdx;
      step > 0 ? i <= nearestDestIdx : i >= nearestDestIdx;
      i += step
    ) {
      path.push(LAMKA_ARTERIAL_SPINE[i]);
    }

    const exitConnector: LatLngPoint = {
      lat: Number(
        (destSpineNode.lat * 0.65 + destination.lat * 0.35).toFixed(6)
      ),
      lng: Number(
        (destSpineNode.lng * 0.8 + destination.lng * 0.2).toFixed(6)
      ),
    };
    path.push(exitConnector);
  } else {
    // Local collector road multi-turn path for shorter cross-neighborhood hops
    const turn1: LatLngPoint = {
      lat: Number((origin.lat + dLat * 0.28).toFixed(6)),
      lng: Number((origin.lng + dLng * 0.08).toFixed(6)),
    };
    const turn2: LatLngPoint = {
      lat: Number((origin.lat + dLat * 0.56).toFixed(6)),
      lng: Number((origin.lng + dLng * 0.52).toFixed(6)),
    };
    const turn3: LatLngPoint = {
      lat: Number((origin.lat + dLat * 0.84).toFixed(6)),
      lng: Number((origin.lng + dLng * 0.92).toFixed(6)),
    };
    path.push(turn1, turn2, turn3);
  }

  path.push(destination);
  return path;
}

function calculatePathDistanceMeters(path: LatLngPoint[]): number {
  if (path.length < 2) return 0;
  let total = 0;
  for (let i = 1; i < path.length; i += 1) {
    total += calculateDistanceMeters(path[i - 1], path[i]);
  }
  return Math.max(50, Math.round(total));
}

function formatRouteSummaryFromMetrics(
  distanceMeters: number,
  durationSeconds: number,
  destinationTitle: string
): RouteEstimateSummary {
  const safeDistance = Math.max(50, Math.round(distanceMeters));
  const distanceText =
    safeDistance >= 1000
      ? `${(safeDistance / 1000).toFixed(1)} km`
      : `${safeDistance} m`;
  const minutes = Math.max(1, Math.round(durationSeconds / 60));
  const durationText =
    minutes >= 60
      ? `${Math.floor(minutes / 60)} hr ${minutes % 60} min`
      : `${minutes} min`;

  return {
    distanceText,
    durationText,
    destinationTitle,
  };
}

function computeRoadPathEstimate(
  path: LatLngPoint[],
  destinationTitle: string
): RouteEstimateSummary {
  const roadMeters = calculatePathDistanceMeters(path);
  // Average urban speed in Lamka ~25 km/h (~6.94 m/s)
  const durationSeconds = Math.max(60, Math.round(roadMeters / 6.94));
  return formatRouteSummaryFromMetrics(
    roadMeters,
    durationSeconds,
    destinationTitle
  );
}

interface ModernRoutesComputeResult {
  routes?: Array<{
    path?: Array<google.maps.LatLng | google.maps.LatLngLiteral>;
    distanceMeters?: number;
    durationMillis?: number;
    viewport?: google.maps.LatLngBounds;
    createPolylines?: () => google.maps.Polyline[];
  }>;
}

interface ModernRoutesLibrary {
  Route?: {
    computeRoutes?: (request: {
      origin: google.maps.LatLngLiteral;
      destination: google.maps.LatLngLiteral;
      travelMode: string;
      fields: string[];
    }) => Promise<ModernRoutesComputeResult>;
  };
}

interface OriginPlaceSuggestion {
  id: string;
  label: string;
  sublabel: string;
  coords?: LatLngPoint;
  placeId?: string;
}

const LAMKA_ORIGIN_LANDMARKS: OriginPlaceSuggestion[] = [
  {
    id: 'lamka-new-bazar',
    label: 'New Bazar Bus Parking',
    sublabel: 'Central Lamka, Tedim Road',
    coords: { lat: 24.3335, lng: 93.6978 },
  },
  {
    id: 'lamka-tuibong',
    label: 'Tuibong Mini Secretariat',
    sublabel: 'Tuibong, NH-2 North Corridor',
    coords: { lat: 24.3472, lng: 93.7018 },
  },
  {
    id: 'lamka-rengkai',
    label: 'Rengkai Bridge Junction',
    sublabel: 'Rengkai Road, East Lamka',
    coords: { lat: 24.3248, lng: 93.6952 },
  },
  {
    id: 'lamka-zenhang',
    label: 'Zenhang Lamka Market',
    sublabel: 'IB Road / Tipaimukh Junction',
    coords: { lat: 24.3292, lng: 93.6966 },
  },
  {
    id: 'lamka-hospital',
    label: 'District Hospital Churachandpur',
    sublabel: 'IB Road, Hiangtam Lamka',
    coords: { lat: 24.3318, lng: 93.6934 },
  },
  {
    id: 'lamka-pearsonmun',
    label: 'Pearsonmun Village Gate',
    sublabel: 'West Lamka Foothills',
    coords: { lat: 24.3215, lng: 93.6885 },
  },
];

export function RouteRenderer({
  origin,
  destination,
  destinationTitle = 'Selected Listing',
  mapCenter,
  isSettingOrigin = false,
  onSetOriginHere,
  onCancelSetOrigin,
  onClearRoute,
  onRouteCalculated,
}: RouteRendererProps) {
  const map = useMap();
  const routesLibrary = useMapsLibrary('routes');
  const placesLibrary = useMapsLibrary('places');
  const activePolylinesRef = useRef<google.maps.Polyline[]>([]);
  const [routeSummary, setRouteSummary] =
    useState<RouteEstimateSummary | null>(null);
  const [internalManualOrigin, setInternalManualOrigin] =
    useState<LatLngPoint | null>(null);
  const [internalManualDestination, setInternalManualDestination] =
    useState<LatLngPoint | null>(null);
  const [originLabel, setOriginLabel] = useState<string>('');
  const [customDestinationLabel, setCustomDestinationLabel] =
    useState<string>('');
  const [liveMapCenter, setLiveMapCenter] = useState<LatLngPoint | null>(null);
  const [isEditingOrigin, setIsEditingOrigin] = useState(true);
  const [isDropPinMode, setIsDropPinMode] = useState(false);
  const [originQuery, setOriginQuery] = useState('');
  const [destinationQuery, setDestinationQuery] = useState('');
  const [activeInputField, setActiveInputField] = useState<
    'origin' | 'destination'
  >('origin');
  const [placeSuggestions, setPlaceSuggestions] = useState<
    OriginPlaceSuggestion[]
  >(LAMKA_ORIGIN_LANDMARKS.slice(0, 4));

  // Phase 40: Never force navigator.geolocation — fall back cleanly to Central Lamka or custom typed origin
  const effectiveOrigin =
    isSettingOrigin || isDropPinMode
      ? null
      : internalManualOrigin || origin || CHURACHANDPUR_SAMPLE_CENTER;

  const effectiveDestination = internalManualDestination || destination;
  const effectiveDestinationTitle =
    customDestinationLabel || destinationTitle || 'Selected Listing';

  const showManualOriginPicker =
    Boolean(effectiveDestination) && (isSettingOrigin || isDropPinMode);

  const onRouteCalculatedRef = useRef(onRouteCalculated);
  useEffect(() => {
    onRouteCalculatedRef.current = onRouteCalculated;
  }, [onRouteCalculated]);

  useEffect(() => {
    if (!map || !showManualOriginPicker) return;
    const syncCenter = () => {
      const c = map.getCenter();
      if (c) {
        setLiveMapCenter({
          lat: Number(c.lat().toFixed(6)),
          lng: Number(c.lng().toFixed(6)),
        });
      }
    };
    const centerListener = map.addListener('center_changed', syncCenter);
    const idleListener = map.addListener('idle', syncCenter);
    return () => {
      centerListener.remove();
      idleListener.remove();
    };
  }, [map, showManualOriginPicker]);

  // Allow clicking directly on the map to drop a new origin pin when in drop-pin mode
  useEffect(() => {
    if (!map || !effectiveDestination || !showManualOriginPicker) {
      return;
    }
    const clickListener = map.addListener(
      'click',
      (ev: google.maps.MapMouseEvent) => {
        if (!ev.latLng) return;
        const droppedCoords: LatLngPoint = {
          lat: Number(ev.latLng.lat().toFixed(6)),
          lng: Number(ev.latLng.lng().toFixed(6)),
        };
        setInternalManualOrigin(droppedCoords);
        setOriginLabel(
          `Dropped Pin (${droppedCoords.lat.toFixed(4)}°, ${droppedCoords.lng.toFixed(4)}°)`
        );
        setIsDropPinMode(false);
        onSetOriginHere?.(droppedCoords);
      }
    );
    return () => {
      clickListener.remove();
    };
  }, [map, effectiveDestination, showManualOriginPicker, onSetOriginHere]);

  // Query Google Maps Places Autocomplete + local Lamka landmarks when user types an origin or destination
  const activeSearchText =
    activeInputField === 'destination' ? destinationQuery : originQuery;

  useEffect(() => {
    const trimmed = activeSearchText.trim();
    const localMatches = trimmed
      ? LAMKA_ORIGIN_LANDMARKS.filter(
          (item) =>
            item.label.toLowerCase().includes(trimmed.toLowerCase()) ||
            item.sublabel.toLowerCase().includes(trimmed.toLowerCase())
        )
      : LAMKA_ORIGIN_LANDMARKS.slice(0, 4);

    if (!trimmed || !placesLibrary || typeof google === 'undefined') {
      queueMicrotask(() => {
        setPlaceSuggestions(localMatches);
      });
      return;
    }

    let cancelled = false;

    const runAutocomplete = async () => {
      try {
        if (
          typeof google.maps?.places?.AutocompleteService === 'function'
        ) {
          const service = new google.maps.places.AutocompleteService();
          service.getPlacePredictions(
            {
              input: trimmed,
              locationBias: new google.maps.Circle({
                center: CHURACHANDPUR_SAMPLE_CENTER,
                radius: 15000,
              }),
            },
            (predictions, status) => {
              if (cancelled) return;
              if (
                status === google.maps.places.PlacesServiceStatus.OK &&
                Array.isArray(predictions) &&
                predictions.length > 0
              ) {
                const remoteItems: OriginPlaceSuggestion[] = predictions
                  .slice(0, 4)
                  .map((p) => ({
                    id: p.place_id,
                    placeId: p.place_id,
                    label:
                      p.structured_formatting?.main_text || p.description,
                    sublabel:
                      p.structured_formatting?.secondary_text ||
                      'Google Places',
                  }));
                setPlaceSuggestions(
                  [...localMatches, ...remoteItems].slice(0, 5)
                );
              } else {
                setPlaceSuggestions(localMatches);
              }
            }
          );
          return;
        }
      } catch {
        // Fallback to local landmark matches
      }

      if (!cancelled) {
        setPlaceSuggestions(localMatches);
      }
    };

    void runAutocomplete();

    return () => {
      cancelled = true;
    };
  }, [activeSearchText, placesLibrary]);

  useEffect(() => {
    const clearPolylines = () => {
      activePolylinesRef.current.forEach((poly) => poly.setMap(null));
      activePolylinesRef.current = [];
    };

    if (!effectiveOrigin || !effectiveDestination) {
      clearPolylines();
      return;
    }

    const roadNetworkPath = buildLamkaRoadRoutePath(
      effectiveOrigin,
      effectiveDestination
    );

    if (!map || typeof google === 'undefined' || !google.maps) {
      const est = computeRoadPathEstimate(
        roadNetworkPath,
        effectiveDestinationTitle
      );
      queueMicrotask(() => {
        setRouteSummary(est);
        onRouteCalculatedRef.current?.(est);
      });
      return;
    }

    let cancelled = false;

    const renderPathOnMap = (
      pathPoints: Array<google.maps.LatLng | google.maps.LatLngLiteral>,
      viewport?: google.maps.LatLngBounds
    ) => {
      if (cancelled || !map || typeof google === 'undefined' || !google.maps) {
        return;
      }
      clearPolylines();

      // Outer casing for crisp road visibility across all map styles
      const casingPolyline = new google.maps.Polyline({
        path: pathPoints,
        geodesic: false,
        strokeColor: '#0c4a6e',
        strokeOpacity: 0.85,
        strokeWeight: 8,
        zIndex: 910,
        map,
      });

      // Inner primary route polyline
      const primaryPolyline = new google.maps.Polyline({
        path: pathPoints,
        geodesic: false,
        strokeColor: '#0284c7',
        strokeOpacity: 0.98,
        strokeWeight: 5,
        zIndex: 920,
        map,
      });

      activePolylinesRef.current = [casingPolyline, primaryPolyline];

      if (viewport) {
        map.fitBounds(viewport, 56);
      } else {
        const bounds = new google.maps.LatLngBounds();
        pathPoints.forEach((pt) => bounds.extend(pt));
        map.fitBounds(bounds, 56);
      }
    };

    const drawRoadNetworkFallback = () => {
      if (cancelled) return;
      renderPathOnMap(roadNetworkPath);
      const est = computeRoadPathEstimate(
        roadNetworkPath,
        effectiveDestinationTitle
      );
      setRouteSummary(est);
      onRouteCalculatedRef.current?.(est);
    };

    const computeModernRoute = async () => {
      const modernRoutesLib = routesLibrary as unknown as
        | ModernRoutesLibrary
        | null;
      const routeClass = modernRoutesLib?.Route;

      if (routeClass && typeof routeClass.computeRoutes === 'function') {
        try {
          const response = await routeClass.computeRoutes({
            origin: {
              lat: effectiveOrigin.lat,
              lng: effectiveOrigin.lng,
            },
            destination: {
              lat: effectiveDestination.lat,
              lng: effectiveDestination.lng,
            },
            travelMode: 'DRIVING',
            fields: ['path', 'distanceMeters', 'durationMillis', 'viewport'],
          });

          if (cancelled) return;

          const primaryRoute = response?.routes?.[0];
          if (primaryRoute?.path && primaryRoute.path.length >= 2) {
            renderPathOnMap(primaryRoute.path, primaryRoute.viewport);
            const distanceMeters =
              typeof primaryRoute.distanceMeters === 'number' &&
              primaryRoute.distanceMeters > 0
                ? primaryRoute.distanceMeters
                : calculatePathDistanceMeters(roadNetworkPath);
            const durationSeconds =
              typeof primaryRoute.durationMillis === 'number' &&
              primaryRoute.durationMillis > 0
                ? Math.round(primaryRoute.durationMillis / 1000)
                : Math.round(distanceMeters / 6.94);

            const summary = formatRouteSummaryFromMetrics(
              distanceMeters,
              durationSeconds,
              effectiveDestinationTitle
            );
            setRouteSummary(summary);
            onRouteCalculatedRef.current?.(summary);
            return;
          }
        } catch {
          // Gracefully fall back to multi-segment road network path without legacy DirectionsService errors
        }
      }

      drawRoadNetworkFallback();
    };

    void computeModernRoute();

    return () => {
      cancelled = true;
      clearPolylines();
    };
  }, [
    map,
    routesLibrary,
    effectiveOrigin,
    effectiveDestination,
    effectiveDestinationTitle,
  ]);

  const applyNewOrigin = (coords: LatLngPoint, labelText: string) => {
    setInternalManualOrigin(coords);
    setOriginLabel(labelText);
    setOriginQuery(labelText);
    setIsDropPinMode(false);
    onSetOriginHere?.(coords);
  };

  const applyNewDestination = (coords: LatLngPoint, labelText: string) => {
    setInternalManualDestination(coords);
    setCustomDestinationLabel(labelText);
    setDestinationQuery(labelText);
  };

  const resolveTextToLocation = (
    rawQuery: string,
    targetField: 'origin' | 'destination'
  ) => {
    const trimmed = rawQuery.trim();
    if (!trimmed) return;

    const applyFn =
      targetField === 'destination' ? applyNewDestination : applyNewOrigin;

    // 1. Parse direct "lat, lng" coordinate input if entered
    const coordMatch = trimmed.match(
      /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/
    );
    if (coordMatch) {
      const lat = Number(coordMatch[1]);
      const lng = Number(coordMatch[2]);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        applyFn(
          { lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) },
          `${lat.toFixed(4)}°, ${lng.toFixed(4)}°`
        );
        return;
      }
    }

    // 2. Check local Lamka landmarks
    const matchedLandmark = LAMKA_ORIGIN_LANDMARKS.find(
      (item) =>
        item.label.toLowerCase().includes(trimmed.toLowerCase()) ||
        item.sublabel.toLowerCase().includes(trimmed.toLowerCase())
    );
    if (matchedLandmark?.coords) {
      applyFn(matchedLandmark.coords, matchedLandmark.label);
      return;
    }

    // 3. Geocode with Google Maps Geocoder if available
    if (typeof google !== 'undefined' && google.maps?.Geocoder) {
      const geocoder = new google.maps.Geocoder();
      geocoder.geocode(
        { address: `${trimmed}, Churachandpur, Manipur` },
        (results, status) => {
          const loc = results?.[0]?.geometry?.location;
          if (status === 'OK' && loc) {
            applyFn(
              {
                lat: Number(loc.lat().toFixed(6)),
                lng: Number(loc.lng().toFixed(6)),
              },
              trimmed
            );
          } else {
            applyFn(CHURACHANDPUR_SAMPLE_CENTER, trimmed);
          }
        }
      );
      return;
    }

    applyFn(CHURACHANDPUR_SAMPLE_CENTER, trimmed);
  };

  const handleSelectPlaceSuggestion = (suggestion: OriginPlaceSuggestion) => {
    const applyFn =
      activeInputField === 'destination' ? applyNewDestination : applyNewOrigin;

    if (suggestion.coords) {
      applyFn(suggestion.coords, suggestion.label);
      return;
    }

    if (
      suggestion.placeId &&
      typeof google !== 'undefined' &&
      google.maps?.Geocoder
    ) {
      const geocoder = new google.maps.Geocoder();
      geocoder.geocode({ placeId: suggestion.placeId }, (results, status) => {
        const loc = results?.[0]?.geometry?.location;
        if (status === 'OK' && loc) {
          applyFn(
            {
              lat: Number(loc.lat().toFixed(6)),
              lng: Number(loc.lng().toFixed(6)),
            },
            suggestion.label
          );
        } else {
          applyFn(CHURACHANDPUR_SAMPLE_CENTER, suggestion.label);
        }
      });
      return;
    }

    applyFn(CHURACHANDPUR_SAMPLE_CENTER, suggestion.label);
  };

  const handleRouteFormSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (originQuery.trim()) {
      resolveTextToLocation(originQuery, 'origin');
    }
    if (destinationQuery.trim()) {
      resolveTextToLocation(destinationQuery, 'destination');
    }
  };

  const handleConfirmCentralOrigin = () => {
    let resolvedCenter =
      mapCenter || liveMapCenter || CHURACHANDPUR_SAMPLE_CENTER;
    if (map) {
      const c = map.getCenter();
      if (c) {
        resolvedCenter = {
          lat: Number(c.lat().toFixed(6)),
          lng: Number(c.lng().toFixed(6)),
        };
      }
    }
    applyNewOrigin(
      resolvedCenter,
      `Map Pin (${resolvedCenter.lat.toFixed(4)}°, ${resolvedCenter.lng.toFixed(4)}°)`
    );
  };

  const formattedOriginDisplay =
    originLabel ||
    (origin
      ? `${origin.lat.toFixed(4)}°, ${origin.lng.toFixed(4)}°`
      : 'New Bazar, Central Lamka');

  // Drop-Pin Mode UI: Fixed center crosshair/pin + "Set Origin Here"
  if (showManualOriginPicker && effectiveDestination) {
    const activeCoords =
      mapCenter || liveMapCenter || CHURACHANDPUR_SAMPLE_CENTER;
    return (
      <>
        <div
          data-testid="manual-origin-center-pin"
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-30 flex items-center justify-center"
        >
          <div className="relative flex flex-col items-center">
            <div className="mb-1.5 rounded-full border border-sky-400/50 bg-slate-950/95 px-2.5 py-0.5 text-[10px] font-bold text-white shadow-lg backdrop-blur-md whitespace-nowrap">
              Starting Point ({activeCoords.lat.toFixed(4)}°,{' '}
              {activeCoords.lng.toFixed(4)}°)
            </div>
            <div className="relative flex items-center justify-center">
              <span className="absolute h-10 w-10 rounded-full border border-sky-400/50 bg-sky-500/10 animate-pulse" />
              <Crosshair className="h-7 w-7 text-sky-400 drop-shadow-[0_2px_6px_rgba(2,132,199,0.85)]" />
              <div className="absolute -top-5 flex h-6 w-6 items-center justify-center rounded-full border-2 border-white bg-sky-600 text-white shadow-lg">
                <MapPin className="h-3.5 w-3.5" />
              </div>
              <span className="h-2 w-2 rounded-full bg-amber-400 ring-2 ring-slate-950" />
            </div>
          </div>
        </div>

        <motion.div
          drag
          dragMomentum={false}
          whileDrag={{ scale: 1.02 }}
          onPointerDown={(e) => e.stopPropagation()}
          onTouchMove={(e) => e.stopPropagation()}
          data-testid="set-starting-point-banner"
          role="region"
          aria-label="Set Starting Point for Directions"
          className="pointer-events-auto absolute top-[120px] left-1/2 z-20 flex -translate-x-1/2 flex-col gap-2.5 rounded-2xl border border-sky-500/50 bg-slate-950/95 px-4 py-3 text-xs text-white shadow-2xl backdrop-blur-md w-[min(92vw,440px)] cursor-grab active:cursor-grabbing"
        >
          <div className="w-10 h-1.5 bg-slate-300 dark:bg-slate-700 rounded-full mx-auto mb-2" />
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-sky-500/20 text-sky-400">
              <Crosshair className="h-4 w-4" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="font-bold text-white leading-tight">
                Set Starting Point
              </div>
              <div className="text-[10px] text-slate-300 truncate">
                Pan map, click to drop pin, or type custom route to{' '}
                {effectiveDestinationTitle}
              </div>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              <button
                type="button"
                onClick={handleConfirmCentralOrigin}
                data-testid="set-origin-here-btn"
                className="inline-flex min-h-[34px] items-center gap-1.5 rounded-xl bg-sky-600 px-3 py-1.5 text-[11px] font-bold text-white shadow-sm transition hover:bg-sky-500 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 whitespace-nowrap"
              >
                <Navigation className="h-3 w-3" />
                <span>Set Origin Here</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setIsDropPinMode(false);
                  if (onCancelSetOrigin) {
                    onCancelSetOrigin();
                  } else {
                    onClearRoute?.();
                  }
                }}
                aria-label="Cancel setting starting point"
                title="Cancel"
                data-testid="cancel-starting-point-btn"
                className="inline-flex h-8 w-8 items-center justify-center rounded-xl text-slate-300 hover:bg-white/10 hover:text-white"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </motion.div>
      </>
    );
  }

  if (!effectiveOrigin || !effectiveDestination || !routeSummary) {
    return null;
  }

  return (
    <motion.div
      drag
      dragMomentum={false}
      whileDrag={{ scale: 1.02 }}
      onPointerDown={(e) => e.stopPropagation()}
      onTouchMove={(e) => e.stopPropagation()}
      data-testid="active-route-summary-banner"
      className="pointer-events-auto absolute top-[120px] left-1/2 z-20 flex -translate-x-1/2 flex-col gap-3 rounded-2xl border border-slate-800 bg-slate-950/95 p-4 text-xs text-white shadow-2xl backdrop-blur-md w-[min(92vw,440px)] cursor-grab active:cursor-grabbing"
    >
      <div className="w-10 h-1.5 bg-slate-300 dark:bg-slate-700 rounded-full mx-auto mb-2" />
      {/* Top Row: Modern Distance & Time Estimates + Controls */}
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-sky-500/20 border border-sky-500/30 text-sky-400 shadow-inner">
            <RouteIcon className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-sky-500/15 border border-sky-500/30 px-2.5 py-1 text-xs font-extrabold tracking-tight text-sky-300 tabular-nums">
                <Navigation className="h-3.5 w-3.5 text-sky-400" />
                {routeSummary.distanceText}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-500/15 border border-emerald-500/30 px-2.5 py-1 text-xs font-extrabold tracking-tight text-emerald-300 tabular-nums">
                <Clock className="h-3.5 w-3.5 text-emerald-400" />
                {routeSummary.durationText}
              </span>
            </div>
            <div className="mt-1 truncate text-[11px] font-medium text-slate-300">
              {formattedOriginDisplay} → {routeSummary.destinationTitle}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={() => setIsEditingOrigin((prev) => !prev)}
            data-testid="edit-route-origin-btn"
            title="Toggle custom origin and destination inputs"
            className="inline-flex items-center gap-1 rounded-xl border border-sky-400/35 bg-sky-500/15 px-2.5 py-1.5 text-[10px] font-bold text-sky-200 hover:bg-sky-500/25 transition-colors"
          >
            <MapPin className="h-3 w-3 shrink-0 text-sky-400" />
            <span>{isEditingOrigin ? 'Hide Inputs' : 'Customize'}</span>
          </button>

          {onClearRoute && (
            <button
              type="button"
              onClick={() => {
                setIsEditingOrigin(false);
                setIsDropPinMode(false);
                setInternalManualOrigin(null);
                setInternalManualDestination(null);
                setOriginLabel('');
                setCustomDestinationLabel('');
                setRouteSummary(null);
                onRouteCalculatedRef.current?.(null);
                onClearRoute();
              }}
              aria-label="Clear active route"
              title="Clear route"
              data-testid="clear-route-btn"
              className="rounded-xl p-1.5 text-slate-400 hover:bg-slate-800 hover:text-white transition-colors"
            >
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      {/* Phase 40: Customizable Origin & Destination Inputs (No Forced Geolocation) */}
      {isEditingOrigin && (
        <div
          data-testid="route-origin-editor"
          className="space-y-2.5 border-t border-slate-800/90 pt-2.5"
        >
          <form onSubmit={handleRouteFormSubmit} className="space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div className="relative flex items-center">
                <MapPin className="w-3.5 h-3.5 text-sky-400 absolute left-2.5 pointer-events-none" />
                <input
                  type="text"
                  value={originQuery}
                  onFocus={() => setActiveInputField('origin')}
                  onChange={(e) => {
                    setActiveInputField('origin');
                    setOriginQuery(e.target.value);
                  }}
                  placeholder={`Origin: ${formattedOriginDisplay}`}
                  aria-label="Custom origin address or landmark"
                  data-testid="route-origin-autocomplete-input"
                  className="w-full min-h-[34px] rounded-xl border border-slate-700 bg-slate-900 pl-8 pr-2.5 py-1 text-[11px] text-white placeholder:text-slate-400 focus:border-sky-400 focus:outline-none"
                />
              </div>
              <div className="relative flex items-center">
                <Navigation className="w-3.5 h-3.5 text-emerald-400 absolute left-2.5 pointer-events-none" />
                <input
                  type="text"
                  value={destinationQuery}
                  onFocus={() => setActiveInputField('destination')}
                  onChange={(e) => {
                    setActiveInputField('destination');
                    setDestinationQuery(e.target.value);
                  }}
                  placeholder={`Dest: ${effectiveDestinationTitle}`}
                  aria-label="Custom destination address or landmark"
                  data-testid="route-destination-autocomplete-input"
                  className="w-full min-h-[34px] rounded-xl border border-slate-700 bg-slate-900 pl-8 pr-2.5 py-1 text-[11px] text-white placeholder:text-slate-400 focus:border-emerald-400 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => {
                    setIsEditingOrigin(false);
                    setIsDropPinMode(true);
                  }}
                  data-testid="route-origin-drop-pin-btn"
                  className="inline-flex items-center gap-1 rounded-xl border border-slate-700 bg-slate-900 hover:bg-slate-800 px-2.5 py-1.5 text-[10px] font-semibold text-sky-300 whitespace-nowrap transition-colors"
                >
                  <Crosshair className="h-3 w-3" />
                  <span>Drop Pin on Map</span>
                </button>
              </div>
              <button
                type="submit"
                data-testid="apply-origin-query-btn"
                className="rounded-xl bg-sky-600 hover:bg-sky-500 px-3 py-1.5 text-[11px] font-bold text-white whitespace-nowrap shadow-xs transition-colors"
              >
                Update Route
              </button>
            </div>
          </form>

          {placeSuggestions.length > 0 && (
            <div
              data-testid="route-origin-suggestions"
              className="flex flex-wrap gap-1.5 pt-0.5"
            >
              {placeSuggestions.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => handleSelectPlaceSuggestion(item)}
                  className="inline-flex items-center gap-1 rounded-lg border border-slate-800 bg-slate-900/90 hover:bg-slate-800 px-2 py-1 text-left text-[10px] font-semibold text-slate-200 transition-colors"
                >
                  <MapPin className="h-2.5 w-2.5 text-sky-400 shrink-0" />
                  <span className="truncate max-w-[140px]">{item.label}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </motion.div>
  );
}

export default RouteRenderer;
