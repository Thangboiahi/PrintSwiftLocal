'use client';

import * as turf from '@turf/turf';
import type { LatLngPoint } from '@/lib/types';

export const CHURACHANDPUR_FALLBACK_CENTER: LatLngPoint = {
  lat: 24.3335,
  lng: 93.6946,
};

export const HIGH_ACCURACY_GPS_OPTIONS: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 0,
  timeout: 10000,
};

export function roundCoord(val: number, decimals = 6): number {
  if (!Number.isFinite(val)) return 0;
  return Number(val.toFixed(decimals));
}

export function normalizeLatLng(
  point: Partial<LatLngPoint> | null | undefined,
  fallback: LatLngPoint = CHURACHANDPUR_FALLBACK_CENTER
): LatLngPoint {
  const lat =
    typeof point?.lat === 'number' &&
    Number.isFinite(point.lat) &&
    point.lat >= -90 &&
    point.lat <= 90
      ? point.lat
      : fallback.lat;
  const lng =
    typeof point?.lng === 'number' &&
    Number.isFinite(point.lng) &&
    point.lng >= -180 &&
    point.lng <= 180
      ? point.lng
      : fallback.lng;
  return {
    lat: roundCoord(lat, 6),
    lng: roundCoord(lng, 6),
  };
}

export function formatCoordinates(
  lat: number,
  lng: number,
  decimals = 6
): string {
  return `${roundCoord(lat, decimals).toFixed(decimals)}, ${roundCoord(lng, decimals).toFixed(decimals)}`;
}

export async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof window === 'undefined') return false;
  try {
    if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // Fall through to execCommand fallback for restricted iframe contexts
  }

  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    textarea.style.pointerEvents = 'none';
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

export interface CoordinateValidationResult {
  isValid: boolean;
  latError?: string;
  lngError?: string;
  zoomError?: string;
  parsed?: {
    lat: number;
    lng: number;
    zoom?: number;
  };
}

export function validateLatLngStrings(
  latStr: string,
  lngStr: string,
  zoomStr?: string
): CoordinateValidationResult {
  const latTrim = latStr.trim();
  const lngTrim = lngStr.trim();
  const latNum = Number.parseFloat(latTrim);
  const lngNum = Number.parseFloat(lngTrim);

  let latError: string | undefined;
  let lngError: string | undefined;
  let zoomError: string | undefined;

  if (!latTrim || !Number.isFinite(latNum)) {
    latError = 'Enter a valid numeric latitude.';
  } else if (latNum < -90 || latNum > 90) {
    latError = 'Latitude must be between -90 and 90.';
  }

  if (!lngTrim || !Number.isFinite(lngNum)) {
    lngError = 'Enter a valid numeric longitude.';
  } else if (lngNum < -180 || lngNum > 180) {
    lngError = 'Longitude must be between -180 and 180.';
  }

  let parsedZoom: number | undefined;
  if (zoomStr !== undefined) {
    const zNum = Number.parseInt(zoomStr.trim(), 10);
    if (!zoomStr.trim() || !Number.isFinite(zNum)) {
      zoomError = 'Enter a valid zoom level.';
    } else if (zNum < 3 || zNum > 20) {
      zoomError = 'Zoom must be between 3 and 20.';
    } else {
      parsedZoom = zNum;
    }
  }

  const isValid = !latError && !lngError && !zoomError;
  return {
    isValid,
    latError,
    lngError,
    zoomError,
    parsed: isValid
      ? {
          lat: roundCoord(latNum, 6),
          lng: roundCoord(lngNum, 6),
          ...(parsedZoom !== undefined ? { zoom: parsedZoom } : {}),
        }
      : undefined,
  };
}

export interface PolygonGeometryMetrics {
  areaSqm: number;
  areaSqft: number;
  areaAcres: number;
  areaSangam: number;
  perimeterMeters: number;
  centroid: LatLngPoint;
  isValid: boolean;
}

export function computePolygonGeometry(
  points: LatLngPoint[],
  fallbackCenter: LatLngPoint = CHURACHANDPUR_FALLBACK_CENTER
): PolygonGeometryMetrics {
  if (!Array.isArray(points) || points.length < 3) {
    const avg =
      points.length > 0
        ? {
            lat: roundCoord(
              points.reduce((acc, p) => acc + p.lat, 0) / points.length,
              6
            ),
            lng: roundCoord(
              points.reduce((acc, p) => acc + p.lng, 0) / points.length,
              6
            ),
          }
        : normalizeLatLng(fallbackCenter);
    return {
      areaSqm: 0,
      areaSqft: 0,
      areaAcres: 0,
      areaSangam: 0,
      perimeterMeters: 0,
      centroid: avg,
      isValid: false,
    };
  }

  try {
    const ring: [number, number][] = points.map((p) => [p.lng, p.lat]);
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      ring.push([first[0], first[1]]);
    }
    const poly = turf.polygon([ring]);
    const areaSqm = Number(turf.area(poly).toFixed(2));
    const areaSqft = areaSqm > 0 ? Math.round(areaSqm * 10.7639104) : 0;
    const areaAcres = Number((areaSqft / 43560).toFixed(4));
    const areaSangam = Number((areaSqft / 2722.5).toFixed(2));
    const perimeterMeters = Number(
      (turf.length(turf.lineString(ring), { units: 'kilometers' }) * 1000).toFixed(1)
    );
    const centerFeat = turf.centroid(poly);
    const [cLng, cLat] = centerFeat.geometry.coordinates;

    return {
      areaSqm,
      areaSqft,
      areaAcres,
      areaSangam,
      perimeterMeters,
      centroid: {
        lat: roundCoord(cLat, 6),
        lng: roundCoord(cLng, 6),
      },
      isValid: areaSqm > 0,
    };
  } catch {
    return {
      areaSqm: 0,
      areaSqft: 0,
      areaAcres: 0,
      areaSangam: 0,
      perimeterMeters: 0,
      centroid: normalizeLatLng(points[0] || fallbackCenter),
      isValid: false,
    };
  }
}

/**
 * Converts a screen pixel offset relative to the map viewport center into exact
 * geographic coordinates using the live Google Maps Web Mercator projection.
 * Allows crosshair overlays shifted for top headers / bottom sheets to store
 * the exact pixel-accurate coordinate under the crosshair tip.
 */
export function resolvePixelOffsetLatLng(
  map: google.maps.Map | null | undefined,
  fallbackCenter: LatLngPoint,
  offsetXpx: number,
  offsetYpx: number
): LatLngPoint {
  if (!map || (offsetXpx === 0 && offsetYpx === 0)) {
    const rawCenter = map?.getCenter();
    if (rawCenter) {
      return {
        lat: roundCoord(rawCenter.lat(), 6),
        lng: roundCoord(rawCenter.lng(), 6),
      };
    }
    return normalizeLatLng(fallbackCenter);
  }

  try {
    const projection = map.getProjection();
    const center = map.getCenter();
    const zoom = map.getZoom();
    if (projection && center && typeof zoom === 'number') {
      const scale = Math.pow(2, zoom);
      const centerWorld = projection.fromLatLngToPoint(center);
      if (centerWorld) {
        const shiftedWorld = new google.maps.Point(
          centerWorld.x + offsetXpx / scale,
          centerWorld.y + offsetYpx / scale
        );
        const shiftedLatLng = projection.fromPointToLatLng(shiftedWorld);
        if (shiftedLatLng) {
          return {
            lat: roundCoord(shiftedLatLng.lat(), 6),
            lng: roundCoord(shiftedLatLng.lng(), 6),
          };
        }
      }
    }
  } catch {
    // Fall back to map center below
  }

  const rawCenter = map.getCenter();
  if (rawCenter) {
    return {
      lat: roundCoord(rawCenter.lat(), 6),
      lng: roundCoord(rawCenter.lng(), 6),
    };
  }
  return normalizeLatLng(fallbackCenter);
}

/**
 * Converts a client pointer point inside a map viewport container into exact
 * geographic coordinates using Google Maps projection (with bounds fallback).
 */
export function resolveClientPointToLatLng(
  map: google.maps.Map | null | undefined,
  viewportRect: DOMRect,
  clientX: number,
  clientY: number,
  fallbackBounds?: { north: number; south: number; east: number; west: number } | null,
  fallbackCenter: LatLngPoint = CHURACHANDPUR_FALLBACK_CENTER
): LatLngPoint {
  const localX = clientX - viewportRect.left;
  const localY = clientY - viewportRect.top;
  const offsetXpx = localX - viewportRect.width / 2;
  const offsetYpx = localY - viewportRect.height / 2;

  if (map) {
    return resolvePixelOffsetLatLng(map, fallbackCenter, offsetXpx, offsetYpx);
  }

  const rx = Math.max(0, Math.min(1, localX / Math.max(1, viewportRect.width)));
  const ry = Math.max(0, Math.min(1, localY / Math.max(1, viewportRect.height)));
  const b = fallbackBounds || {
    north: fallbackCenter.lat + 0.025,
    south: fallbackCenter.lat - 0.025,
    east: fallbackCenter.lng + 0.035,
    west: fallbackCenter.lng - 0.035,
  };
  return {
    lat: roundCoord(b.north - ry * (b.north - b.south), 6),
    lng: roundCoord(b.west + rx * (b.east - b.west), 6),
  };
}
