'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  BedDouble,
  Calendar,
  Car,
  Compass,
  Crosshair,
  ExternalLink,
  Home,
  Landmark,
  Layers,
  Lock,
  MapPin,
  Megaphone,
  Minus,
  Navigation,
  Plus,
  Printer,
  ShieldCheck,
  Store,
  Truck,
  UtensilsCrossed,
} from 'lucide-react';
import {
  APIProvider,
  AdvancedMarker,
  Map,
  useMap,
} from '@vis.gl/react-google-maps';
import { CHURACHANDPUR_FALLBACK_CENTER } from '@/lib/maps/coordinates';
import { formatSangamArea } from '@/lib/real-estate/helpers';
import { useAppStore } from '@/lib/store';

export interface LatLngPoint {
  lat: number;
  lng: number;
}

export interface ListingLocationMapProps {
  listingId: string;
  title: string;
  locality?: string | null;
  address?: string | null;
  coordinates?: { lat: number; lng: number } | null;
  boundaryPolygon?: LatLngPoint[] | null;
  boundaryGeoJson?: unknown;
  /** Optional secondary GeoJSON source (e.g., listings.boundary_geojson fallback) */
  secondaryBoundaryGeoJson?: unknown;
  areaSqft?: number | null;
  landAreaText?: string | null;
  pattaStatus?: string | null;
  pattaVerified?: boolean;
  showExactPin?: boolean;
  listingVertical?: string | null;
  compact?: boolean;
  /** Show 1-tap Pick N Drop shortcut in footer (defaults true for commercial/RE listings) */
  showPickNDrop?: boolean;
  /** Optional custom explore/map href (e.g., for vehicles or bulletins) */
  exploreHrefOverride?: string | null;
  /** Optional user location override for distance calculation */
  userLocation?: { lat: number; lng: number } | null;
}

interface VerticalPinVisual {
  bg: string;
  stroke: string;
  fill: string;
  label: string;
  Icon: typeof MapPin;
}

const VERTICAL_PIN_STYLES: Record<string, VerticalPinVisual> = {
  print_digital: {
    bg: 'bg-teal-600 text-white',
    stroke: '#0d9488',
    fill: '#14b8a6',
    label: 'Print & Digital',
    Icon: Printer,
  },
  booking_venue: {
    bg: 'bg-emerald-600 text-white',
    stroke: '#059669',
    fill: '#10b981',
    label: 'Bookable Venue',
    Icon: Calendar,
  },
  hotel_stay: {
    bg: 'bg-indigo-600 text-white',
    stroke: '#4f46e5',
    fill: '#6366f1',
    label: 'Hotel & Stay',
    Icon: BedDouble,
  },
  restaurant_food: {
    bg: 'bg-orange-600 text-white',
    stroke: '#ea580c',
    fill: '#f97316',
    label: 'Food & Dining',
    Icon: UtensilsCrossed,
  },
  shop_catalogue: {
    bg: 'bg-sky-600 text-white',
    stroke: '#0284c7',
    fill: '#0ea5e9',
    label: 'Local Shop',
    Icon: Store,
  },
  real_estate: {
    bg: 'bg-violet-600 text-white',
    stroke: '#7c3aed',
    fill: '#8b5cf6',
    label: 'Property Plot',
    Icon: Home,
  },
  public_civic: {
    bg: 'bg-rose-600 text-white',
    stroke: '#e11d48',
    fill: '#f43f5e',
    label: 'Public & Civic',
    Icon: Landmark,
  },
  vehicle: {
    bg: 'bg-cyan-600 text-white',
    stroke: '#0891b2',
    fill: '#06b6d4',
    label: 'Vehicle Stand',
    Icon: Car,
  },
  bulletin: {
    bg: 'bg-fuchsia-600 text-white',
    stroke: '#c026d3',
    fill: '#d946ef',
    label: 'Community Event',
    Icon: Megaphone,
  },
  general: {
    bg: 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]',
    stroke: '#0f766e',
    fill: '#14b8a6',
    label: 'Location Pin',
    Icon: MapPin,
  },
};

const PATTA_SHORT_LABELS: Record<string, string> = {
  verified_patta: 'Clear Patta',
  village_authority: 'Village Auth',
  leasehold: 'Leasehold',
};

function isFiniteCoord(lat: unknown, lng: unknown): boolean {
  const nLat = Number(lat);
  const nLng = Number(lng);
  return (
    Number.isFinite(nLat) &&
    Number.isFinite(nLng) &&
    Math.abs(nLat) <= 90 &&
    Math.abs(nLng) <= 180 &&
    !(nLat === 0 && nLng === 0)
  );
}

function haversineDistanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6371;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLng * sinLng;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function formatDistanceLabel(km: number): string {
  if (!Number.isFinite(km) || km < 0) return '';
  if (km < 1) return `${Math.max(50, Math.round(km * 1000))} m away`;
  if (km < 10) return `${km.toFixed(1)} km away`;
  return `${Math.round(km)} km away`;
}

function parseRingToLatLng(ring: unknown): LatLngPoint[] {
  if (!Array.isArray(ring)) return [];
  const pts: LatLngPoint[] = [];
  for (const coord of ring) {
    if (Array.isArray(coord) && coord.length >= 2) {
      const lng = Number(coord[0]);
      const lat = Number(coord[1]);
      if (isFiniteCoord(lat, lng)) {
        pts.push({ lat, lng });
      }
    } else if (coord && typeof coord === 'object') {
      const obj = coord as Record<string, unknown>;
      const lat = Number(obj.lat ?? obj.latitude);
      const lng = Number(obj.lng ?? obj.lon ?? obj.longitude);
      if (isFiniteCoord(lat, lng)) {
        pts.push({ lat, lng });
      }
    }
  }
  return pts.length >= 3 ? pts : [];
}

function parseWktPolygon(wkt: string): LatLngPoint[] {
  const match = wkt.match(/POLYGON\s*\(\(([^)]+)\)\)/i);
  if (!match?.[1]) return [];
  const pts: LatLngPoint[] = [];
  for (const pair of match[1].split(',')) {
    const parts = pair.trim().split(/\s+/);
    if (parts.length >= 2) {
      const lng = Number(parts[0]);
      const lat = Number(parts[1]);
      if (isFiniteCoord(lat, lng)) {
        pts.push({ lat, lng });
      }
    }
  }
  return pts.length >= 3 ? pts : [];
}

function extractPolygonRingsFromGeoJson(raw: unknown): LatLngPoint[][] {
  if (!raw) return [];
  let parsed: unknown = raw;
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    if (!trimmed) return [];
    if (/^POLYGON\s*\(/i.test(trimmed)) {
      const wktPts = parseWktPolygon(trimmed);
      return wktPts.length >= 3 ? [wktPts] : [];
    }
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      return [];
    }
  }

  if (Array.isArray(parsed)) {
    const direct = parseRingToLatLng(parsed);
    if (direct.length >= 3) return [direct];
    if (Array.isArray(parsed[0])) {
      const nested = parseRingToLatLng(parsed[0]);
      if (nested.length >= 3) return [nested];
    }
    return [];
  }

  if (parsed && typeof parsed === 'object') {
    const obj = parsed as Record<string, unknown>;
    const type = String(obj.type || '');
    if (type === 'FeatureCollection' && Array.isArray(obj.features)) {
      const rings: LatLngPoint[][] = [];
      for (const feat of obj.features) {
        rings.push(...extractPolygonRingsFromGeoJson(feat));
      }
      return rings;
    }
    if (type === 'Feature' && obj.geometry) {
      return extractPolygonRingsFromGeoJson(obj.geometry);
    }
    if (type === 'Polygon' && Array.isArray(obj.coordinates)) {
      const ring = parseRingToLatLng(obj.coordinates[0]);
      return ring.length >= 3 ? [ring] : [];
    }
    if (type === 'MultiPolygon' && Array.isArray(obj.coordinates)) {
      const rings: LatLngPoint[][] = [];
      for (const poly of obj.coordinates) {
        if (Array.isArray(poly) && Array.isArray(poly[0])) {
          const ring = parseRingToLatLng(poly[0]);
          if (ring.length >= 3) rings.push(ring);
        }
      }
      return rings;
    }
    if (Array.isArray(obj.coordinates) && Array.isArray(obj.coordinates[0])) {
      const ring = parseRingToLatLng(obj.coordinates[0]);
      if (ring.length >= 3) return [ring];
    }
    if (Array.isArray(obj.points)) {
      const ring = parseRingToLatLng(obj.points);
      if (ring.length >= 3) return [ring];
    }
  }

  return [];
}

function extractPolygonRings(
  boundaryPolygon?: LatLngPoint[] | null,
  boundaryGeoJson?: unknown,
  secondaryBoundaryGeoJson?: unknown
): LatLngPoint[][] {
  // 1. Primary canonical GeoJSON (e.g., listing_real_estate_profiles.boundary_geojson)
  const primaryRings = extractPolygonRingsFromGeoJson(boundaryGeoJson);
  if (primaryRings.length > 0) return primaryRings;

  // 2. Secondary GeoJSON (e.g., listings.boundary_geojson or vertical_summary.boundary_geojson)
  const secondaryRings = extractPolygonRingsFromGeoJson(secondaryBoundaryGeoJson);
  if (secondaryRings.length > 0) return secondaryRings;

  // 3. Fallback to LatLngPoint[] array
  if (Array.isArray(boundaryPolygon) && boundaryPolygon.length >= 3) {
    const cleaned = boundaryPolygon
      .filter((p) => isFiniteCoord(p?.lat, p?.lng))
      .map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) }));
    if (cleaned.length >= 3) return [cleaned];
  }

  return [];
}

function useDocumentDarkMode(): boolean {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    if (typeof document === 'undefined') return;
    const readDark = () =>
      document.documentElement.classList.contains('dark') ||
      document.documentElement.getAttribute('data-theme') === 'dark';

    setIsDark(readDark());

    const observer = new MutationObserver(() => {
      setIsDark(readDark());
    });
    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class', 'data-theme'],
    });
    return () => observer.disconnect();
  }, []);

  return isDark;
}

function MapPolygonAndControls({
  center,
  polygonRings,
  strokeColor,
  fillColor,
  showExactPin,
}: {
  center: LatLngPoint;
  polygonRings: LatLngPoint[][];
  strokeColor: string;
  fillColor: string;
  showExactPin: boolean;
}) {
  const map = useMap();

  const fitView = useCallback(() => {
    if (!map || typeof google === 'undefined' || !google.maps) return;
    if (polygonRings.length > 0) {
      const bounds = new google.maps.LatLngBounds();
      for (const ring of polygonRings) {
        for (const pt of ring) {
          bounds.extend(pt);
        }
      }
      map.fitBounds(bounds, { top: 32, right: 56, bottom: 48, left: 32 });
    } else {
      map.panTo(center);
      map.setZoom(showExactPin ? 16 : 14);
    }
  }, [map, polygonRings, center, showExactPin]);

  useEffect(() => {
    if (!map || typeof google === 'undefined' || !google.maps) return;
    if (polygonRings.length === 0) return;

    const polygons = polygonRings.map(
      (ring) =>
        new google.maps.Polygon({
          paths: ring,
          strokeColor,
          strokeOpacity: 0.96,
          strokeWeight: 2.5,
          fillColor,
          fillOpacity: 0.24,
          clickable: false,
          map,
        })
    );

    const applyBounds = () => {
      const bounds = new google.maps.LatLngBounds();
      for (const ring of polygonRings) {
        for (const pt of ring) {
          bounds.extend(pt);
        }
      }
      map.fitBounds(bounds, { top: 32, right: 56, bottom: 48, left: 32 });
    };

    applyBounds();
    const idleListener = google.maps.event.addListenerOnce(
      map,
      'idle',
      applyBounds
    );
    const refitTimer = window.setTimeout(applyBounds, 280);

    return () => {
      window.clearTimeout(refitTimer);
      google.maps.event.removeListener(idleListener);
      polygons.forEach((poly) => poly.setMap(null));
    };
  }, [map, polygonRings, strokeColor, fillColor]);

  const handleZoomIn = () => {
    if (!map) return;
    const z = map.getZoom() ?? 15;
    map.setZoom(Math.min(20, z + 1));
  };

  const handleZoomOut = () => {
    if (!map) return;
    const z = map.getZoom() ?? 15;
    map.setZoom(Math.max(10, z - 1));
  };

  return (
    <div className="absolute right-2.5 top-2.5 z-10 flex flex-col gap-1.5">
      <button
        type="button"
        onClick={handleZoomIn}
        aria-label="Zoom in map"
        title="Zoom in"
        className="inline-flex min-h-[44px] min-w-[44px] h-11 w-11 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)]/95 text-[var(--ps-text)] shadow-sm backdrop-blur-xs hover:border-[var(--ps-accent)] hover:text-[var(--ps-accent)] transition-colors cursor-pointer"
      >
        <Plus className="h-4 w-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={handleZoomOut}
        aria-label="Zoom out map"
        title="Zoom out"
        className="inline-flex min-h-[44px] min-w-[44px] h-11 w-11 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)]/95 text-[var(--ps-text)] shadow-sm backdrop-blur-xs hover:border-[var(--ps-accent)] hover:text-[var(--ps-accent)] transition-colors cursor-pointer"
      >
        <Minus className="h-4 w-4" aria-hidden="true" />
      </button>
      <button
        type="button"
        onClick={fitView}
        aria-label="Recenter map"
        title="Recenter"
        className="inline-flex min-h-[44px] min-w-[44px] h-11 w-11 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)]/95 text-[var(--ps-text)] shadow-sm backdrop-blur-xs hover:border-[var(--ps-accent)] hover:text-[var(--ps-accent)] transition-colors cursor-pointer"
      >
        <Crosshair className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}

export function ListingLocationMap({
  listingId,
  title,
  locality,
  address,
  coordinates,
  boundaryPolygon,
  boundaryGeoJson,
  secondaryBoundaryGeoJson,
  areaSqft,
  landAreaText,
  pattaStatus,
  pattaVerified = false,
  showExactPin = true,
  listingVertical = 'general',
  compact = false,
  showPickNDrop,
  exploreHrefOverride,
  userLocation,
}: ListingLocationMapProps) {
  const isDark = useDocumentDarkMode();
  const { customDefaultCenter: storeUserLocation } = useAppStore();

  const hasValidCoord = isFiniteCoord(coordinates?.lat, coordinates?.lng);
  const polygonRings = useMemo(
    () =>
      extractPolygonRings(
        boundaryPolygon,
        boundaryGeoJson,
        secondaryBoundaryGeoJson
      ),
    [boundaryPolygon, boundaryGeoJson, secondaryBoundaryGeoJson]
  );
  const hasPolygon = polygonRings.length > 0;
  const totalPolygonVertices = useMemo(
    () => polygonRings.reduce((sum, ring) => sum + ring.length, 0),
    [polygonRings]
  );

  const center = useMemo<LatLngPoint>(() => {
    if (hasPolygon) {
      const allPts = polygonRings.flat();
      if (allPts.length >= 3) {
        const avgLat =
          allPts.reduce((sum, pt) => sum + pt.lat, 0) / allPts.length;
        const avgLng =
          allPts.reduce((sum, pt) => sum + pt.lng, 0) / allPts.length;
        if (isFiniteCoord(avgLat, avgLng)) {
          return { lat: avgLat, lng: avgLng };
        }
      }
    }
    if (hasValidCoord && coordinates) {
      return {
        lat: Number(coordinates.lat),
        lng: Number(coordinates.lng),
      };
    }
    return CHURACHANDPUR_FALLBACK_CENTER;
  }, [hasValidCoord, coordinates, hasPolygon, polygonRings]);

  const effectiveUserLoc = useMemo(() => {
    if (userLocation && isFiniteCoord(userLocation.lat, userLocation.lng)) {
      return userLocation;
    }
    if (
      storeUserLocation &&
      isFiniteCoord(storeUserLocation.lat, storeUserLocation.lng)
    ) {
      return storeUserLocation;
    }
    return null;
  }, [userLocation, storeUserLocation]);

  const distanceText = useMemo(() => {
    if (!effectiveUserLoc || !hasValidCoord) return null;
    const km = haversineDistanceKm(effectiveUserLoc, center);
    if (km > 250) return null;
    return formatDistanceLabel(km);
  }, [effectiveUserLoc, hasValidCoord, center]);

  const verticalKey = String(listingVertical || 'general')
    .trim()
    .toLowerCase();
  const pinVisual =
    VERTICAL_PIN_STYLES[verticalKey] || VERTICAL_PIN_STYLES.general;
  const PinIcon = pinVisual.Icon;

  const formattedAreaPill = useMemo(() => {
    if (landAreaText && landAreaText.trim()) return landAreaText.trim();
    if (typeof areaSqft === 'number' && areaSqft > 0) {
      return formatSangamArea(areaSqft);
    }
    return null;
  }, [landAreaText, areaSqft]);

  const pattaShort = pattaStatus
    ? PATTA_SHORT_LABELS[pattaStatus] || pattaStatus.replace(/_/g, ' ')
    : null;

  const combinedAreaPattaBadge = useMemo(() => {
    const parts: string[] = [];
    if (formattedAreaPill) parts.push(formattedAreaPill);
    if (pattaVerified) {
      parts.push('Patta Verified');
    } else if (pattaShort && pattaStatus !== 'not_applicable') {
      parts.push(pattaShort);
    }
    return parts.join(' · ');
  }, [formattedAreaPill, pattaVerified, pattaShort, pattaStatus]);

  const mapsApiKey = (
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || ''
  ).trim();
  const hasMapsKey = mapsApiKey.length > 5;

  const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
    `${center.lat},${center.lng}`
  )}`;

  const exploreHref =
    exploreHrefOverride !== undefined
      ? exploreHrefOverride
      : `/explore?listing=${encodeURIComponent(listingId)}`;

  const shouldShowPickNDrop =
    showPickNDrop !== undefined
      ? showPickNDrop
      : verticalKey !== 'public_civic' &&
        verticalKey !== 'vehicle' &&
        verticalKey !== 'bulletin';

  const pickNDropHref = `/explore?mode=pick_n_drop&pickupListingId=${encodeURIComponent(
    listingId
  )}&pickupLat=${encodeURIComponent(
    String(center.lat)
  )}&pickupLng=${encodeURIComponent(
    String(center.lng)
  )}&pickupLabel=${encodeURIComponent(
    locality ? `${title}, ${locality}` : title
  )}`;

  return (
    <div
      data-testid="listing-location-map"
      data-has-polygon={hasPolygon ? 'true' : 'false'}
      className="overflow-hidden rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] shadow-xs"
    >
      {/* Header Row */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ps-border)] px-3.5 py-2.5 sm:px-4">
        <div className="flex items-center gap-2.5 min-w-0">
          <div
            className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-xl shadow-2xs ${pinVisual.bg}`}
          >
            <PinIcon className="h-4 w-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-xs font-bold text-[var(--ps-text)] truncate">
                {hasPolygon
                  ? 'Surveyed Plot Boundary'
                  : showExactPin
                    ? 'Location & Directions'
                    : 'Approximate Neighborhood'}
              </p>
              {distanceText && (
                <span className="shrink-0 rounded-md bg-[var(--ps-accent)]/12 px-1.5 py-0.5 text-[10px] font-bold text-[var(--ps-accent)] tabular-nums">
                  {distanceText}
                </span>
              )}
            </div>
            <p className="text-[11px] text-[var(--ps-text-muted)] truncate">
              {address && locality && address !== locality
                ? `${address} · ${locality}`
                : address || locality || 'Churachandpur, Manipur'}
            </p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {pattaVerified && (
            <span className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
              <ShieldCheck className="h-3 w-3" aria-hidden="true" />
              <span>Patta Verified</span>
            </span>
          )}
          {!pattaVerified && pattaShort && pattaStatus !== 'not_applicable' && (
            <span className="inline-flex items-center gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-0.5 text-[10px] font-semibold text-[var(--ps-text-muted)] capitalize">
              <span>{pattaShort}</span>
            </span>
          )}
          {formattedAreaPill && (
            <span className="inline-flex items-center gap-1 rounded-lg border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[10px] font-bold text-violet-800 dark:text-violet-300 tabular-nums">
              <Layers className="h-3 w-3" aria-hidden="true" />
              <span>{formattedAreaPill}</span>
            </span>
          )}
        </div>
      </div>

      {/* Map Viewport */}
      <div
        className={`relative w-full overflow-hidden bg-[var(--ps-bg)] ${
          compact ? 'h-48 sm:h-52' : 'h-64 sm:h-76'
        }`}
      >
        {hasMapsKey ? (
          <APIProvider apiKey={mapsApiKey}>
            <Map
              defaultCenter={center}
              defaultZoom={hasPolygon ? 17 : showExactPin ? 16 : 14}
              gestureHandling="cooperative"
              disableDefaultUI
              colorScheme={isDark ? 'DARK' : 'LIGHT'}
              mapId="DEMO_MAP_ID"
              internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
              className="h-full w-full"
            >
              <AdvancedMarker position={center} title={title}>
                {showExactPin || hasPolygon ? (
                  <div
                    className={`flex h-9 w-9 items-center justify-center rounded-full border-2 border-white shadow-lg ${pinVisual.bg}`}
                  >
                    <PinIcon className="h-4 w-4" aria-hidden="true" />
                  </div>
                ) : (
                  <div className="flex h-16 w-16 items-center justify-center rounded-full border-2 border-violet-500/70 bg-violet-500/20 text-violet-700 dark:text-violet-200 backdrop-blur-[1px]">
                    <Lock className="h-4 w-4" aria-hidden="true" />
                  </div>
                )}
              </AdvancedMarker>
              <MapPolygonAndControls
                center={center}
                polygonRings={polygonRings}
                strokeColor={pinVisual.stroke}
                fillColor={pinVisual.fill}
                showExactPin={showExactPin}
              />
            </Map>
          </APIProvider>
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-2 p-4 text-center bg-gradient-to-br from-[var(--ps-surface-alt)] to-[var(--ps-bg)]">
            <div
              className={`flex h-11 w-11 items-center justify-center rounded-2xl shadow-xs ${pinVisual.bg}`}
            >
              {showExactPin || hasPolygon ? (
                <PinIcon className="h-5 w-5" aria-hidden="true" />
              ) : (
                <Lock className="h-5 w-5" aria-hidden="true" />
              )}
            </div>
            <div className="space-y-0.5 max-w-xs">
              <p className="text-xs font-bold text-[var(--ps-text)] truncate">
                {title}
              </p>
              <p className="text-[11px] text-[var(--ps-text-muted)]">
                {locality || address || 'Churachandpur'}
              </p>
            </div>
            <div className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 py-1 font-mono text-[11px] font-semibold text-[var(--ps-text-muted)] tabular-nums">
              <Compass
                className="h-3.5 w-3.5 text-[var(--ps-accent)]"
                aria-hidden="true"
              />
              <span>
                {center.lat.toFixed(4)}° N, {center.lng.toFixed(4)}° E
              </span>
            </div>
          </div>
        )}

        {/* Top-Left Compact Area & Patta Badge on Map Frame */}
        {combinedAreaPattaBadge && (
          <div className="pointer-events-none absolute top-2.5 left-2.5 z-10 max-w-[75%]">
            <span
              data-testid="map-area-patta-badge"
              className="inline-flex items-center gap-1.5 rounded-xl border border-violet-500/35 bg-[var(--ps-surface)]/95 px-2.5 py-1 text-[10.5px] font-extrabold text-[var(--ps-text)] shadow-sm backdrop-blur-xs"
            >
              {pattaVerified ? (
                <ShieldCheck
                  className="h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400"
                  aria-hidden="true"
                />
              ) : (
                <Layers
                  className="h-3.5 w-3.5 shrink-0 text-violet-600 dark:text-violet-400"
                  aria-hidden="true"
                />
              )}
              <span className="truncate">{combinedAreaPattaBadge}</span>
            </span>
          </div>
        )}

        {/* Bottom-Left Overlay: Locality & Polygon Outline Pill */}
        <div className="pointer-events-none absolute bottom-2.5 left-2.5 z-10 flex flex-wrap items-center gap-1.5 max-w-[82%]">
          {locality && (
            <span className="inline-flex items-center gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)]/95 px-2 py-1 text-[10px] font-bold text-[var(--ps-text)] shadow-xs backdrop-blur-xs">
              <MapPin
                className="h-3 w-3 text-[var(--ps-accent)] shrink-0"
                aria-hidden="true"
              />
              <span className="truncate max-w-[140px]">{locality}</span>
            </span>
          )}
          {hasPolygon && (
            <span
              data-testid="map-polygon-badge"
              className="inline-flex items-center gap-1 rounded-lg border border-violet-500/35 bg-[var(--ps-surface)]/95 px-2 py-1 text-[10px] font-bold text-violet-700 dark:text-violet-300 shadow-xs backdrop-blur-xs"
            >
              <Layers className="h-3 w-3 shrink-0" aria-hidden="true" />
              <span>Plot Boundary · {totalPolygonVertices} pts</span>
            </span>
          )}
        </div>
      </div>

      {/* Footer Actions (44px+ touch targets) */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--ps-border)] bg-[var(--ps-surface)] px-3.5 py-2.5 sm:px-4">
        <span className="inline-flex items-center gap-1.5 font-mono text-[11px] text-[var(--ps-text-muted)] tabular-nums">
          <Compass
            className="h-3.5 w-3.5 text-[var(--ps-accent)] shrink-0"
            aria-hidden="true"
          />
          <span>
            {center.lat.toFixed(4)}° N, {center.lng.toFixed(4)}° E
          </span>
        </span>

        <div className="flex flex-wrap items-center gap-1.5">
          {exploreHref && !compact && (
            <Link
              href={exploreHref}
              className="inline-flex min-h-[44px] h-11 items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs font-semibold text-[var(--ps-text)] hover:border-[var(--ps-accent)] transition-colors"
            >
              <MapPin
                className="h-3.5 w-3.5 text-[var(--ps-accent)]"
                aria-hidden="true"
              />
              <span>Map</span>
            </Link>
          )}
          {shouldShowPickNDrop && (
            <Link
              href={pickNDropHref}
              data-testid="map-pick-n-drop-btn"
              className="inline-flex min-h-[44px] h-11 items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs font-bold text-[var(--ps-text)] hover:border-[var(--ps-accent)] hover:text-[var(--ps-accent)] transition-colors"
            >
              <Truck className="h-3.5 w-3.5 text-[var(--ps-accent)]" aria-hidden="true" />
              <span>Pick N Drop</span>
            </Link>
          )}
          {(showExactPin || hasPolygon) && (
            <a
              href={directionsUrl}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="map-get-directions-btn"
              className="inline-flex min-h-[44px] h-11 items-center gap-1.5 rounded-xl bg-[var(--btn-primary-bg)] px-3.5 text-xs font-bold text-[var(--btn-primary-fg)] hover:opacity-95 transition-opacity"
            >
              <Navigation className="h-3.5 w-3.5" aria-hidden="true" />
              <span>Directions</span>
              <ExternalLink className="h-3 w-3 opacity-80" aria-hidden="true" />
            </a>
          )}
        </div>
      </div>
    </div>
  );
}

export default ListingLocationMap;
