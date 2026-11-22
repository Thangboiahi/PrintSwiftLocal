'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { AdvancedMarker, useMap } from '@vis.gl/react-google-maps';
import { Home } from 'lucide-react';
import { formatIndianPropertyPrice } from '@/lib/real-estate/helpers';
import { isRealEstateBoostActive } from '@/lib/verticals/filter-catalog';
import { formatArea, getListingPriceLabel } from '@/lib/rules';
import type { AreaUnit, LatLngPoint, Listing } from '@/lib/types';

export const SHOW_POLYGON_ZOOM = 16;
export const HIDE_POLYGON_ZOOM = 15.5;

export interface RealEstateZoomPolygonsLayerProps {
  listings: Listing[];
  selectedListingId: string | null;
  hoveredListingId: string | null;
  areaUnit: AreaUnit;
  onSelectListing: (listingId: string) => void;
  onHoverListing: (listingId: string | null) => void;
}

/**
 * Extracts a valid polygon ring (at least 3 LatLngPoints) from any supported
 * real-estate boundary shape while strictly honoring `show_exact_pin !== false`.
 */
export function extractExactRealEstatePolygon(
  listing: Listing
): LatLngPoint[] | null {
  const summary = (listing.vertical_summary || {}) as Record<string, unknown>;
  if (summary.show_exact_pin === false) return null;

  const isEstate =
    listing.listing_vertical === 'real_estate' ||
    listing.category === 'real_estate';
  if (!isEstate) return null;

  // 1. Existing realEstateDetails.boundaryPolygon
  const legacyPoly = listing.realEstateDetails?.boundaryPolygon;
  if (Array.isArray(legacyPoly) && legacyPoly.length >= 3) {
    const valid = legacyPoly.filter(
      (pt) =>
        pt &&
        typeof pt.lat === 'number' &&
        typeof pt.lng === 'number' &&
        Number.isFinite(pt.lat) &&
        Number.isFinite(pt.lng)
    );
    if (valid.length >= 3) return valid;
  }

  // 2. GeoJSON Polygon in vertical_summary.boundary_geojson or listing.boundary_geojson
  const rawRec = listing as unknown as Record<string, unknown>;
  const geo = (summary.boundary_geojson ||
    rawRec.boundary_geojson ||
    rawRec.polygon_coords) as
    | { type?: string; coordinates?: unknown }
    | LatLngPoint[]
    | null
    | undefined;

  if (!geo) return null;

  if (Array.isArray(geo) && geo.length >= 3) {
    const valid = geo.filter(
      (pt): pt is LatLngPoint =>
        Boolean(pt) &&
        typeof pt.lat === 'number' &&
        typeof pt.lng === 'number' &&
        Number.isFinite(pt.lat) &&
        Number.isFinite(pt.lng)
    );
    return valid.length >= 3 ? valid : null;
  }

  if (
    typeof geo === 'object' &&
    !Array.isArray(geo) &&
    geo.type === 'Polygon' &&
    Array.isArray(geo.coordinates) &&
    Array.isArray(geo.coordinates[0])
  ) {
    const ring = geo.coordinates[0] as unknown[];
    const pts: LatLngPoint[] = [];
    for (const pair of ring) {
      if (Array.isArray(pair) && pair.length >= 2) {
        const lng = Number(pair[0]);
        const lat = Number(pair[1]);
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          pts.push({ lat, lng });
        }
      }
    }
    return pts.length >= 3 ? pts : null;
  }

  return null;
}

function computePolygonCentroid(pts: LatLngPoint[]): LatLngPoint {
  let latSum = 0;
  let lngSum = 0;
  for (const pt of pts) {
    latSum += pt.lat;
    lngSum += pt.lng;
  }
  return {
    lat: latSum / pts.length,
    lng: lngSum / pts.length,
  };
}

/**
 * Computes approximate geodesic polygon area in square meters using
 * `google.maps.geometry.spherical.computeArea` if loaded, or equirectangular Shoelace fallback.
 */
function computePolygonAreaSqMeters(pts: LatLngPoint[]): number {
  if (pts.length < 3) return 0;
  if (
    typeof google !== 'undefined' &&
    google.maps?.geometry?.spherical?.computeArea
  ) {
    try {
      const path = pts.map((p) => new google.maps.LatLng(p.lat, p.lng));
      return Math.max(0, google.maps.geometry.spherical.computeArea(path));
    } catch {
      // fall through to Shoelace
    }
  }
  const centroid = computePolygonCentroid(pts);
  const metersPerDegLat = 111320;
  const metersPerDegLng = 111320 * Math.cos((centroid.lat * Math.PI) / 180);
  let area = 0;
  for (let i = 0; i < pts.length; i += 1) {
    const j = (i + 1) % pts.length;
    const x1 = (pts[i].lng - centroid.lng) * metersPerDegLng;
    const y1 = (pts[i].lat - centroid.lat) * metersPerDegLat;
    const x2 = (pts[j].lng - centroid.lng) * metersPerDegLng;
    const y2 = (pts[j].lat - centroid.lat) * metersPerDegLat;
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}

export function RealEstateZoomPolygonsLayer({
  listings,
  selectedListingId,
  hoveredListingId,
  areaUnit,
  onSelectListing,
  onHoverListing,
}: RealEstateZoomPolygonsLayerProps) {
  const map = useMap();
  const [polygonsVisible, setPolygonsVisible] = useState(false);
  const polygonsRef = useRef<Map<string, google.maps.Polygon>>(new Map());
  const animFrameRef = useRef<number | null>(null);

  // Hysteresis zoom listener: SHOW at >= 16, HIDE at < 15.5
  useEffect(() => {
    if (!map) return;
    const syncZoom = () => {
      const z = map.getZoom() ?? 14;
      setPolygonsVisible((prev) => {
        if (!prev && z >= SHOW_POLYGON_ZOOM) return true;
        if (prev && z < HIDE_POLYGON_ZOOM) return false;
        return prev;
      });
    };
    syncZoom();
    const listener = map.addListener('zoom_changed', syncZoom);
    return () => {
      listener.remove();
    };
  }, [map]);

  const polygonEntries = useMemo(() => {
    const out: Array<{
      listing: Listing;
      ring: LatLngPoint[];
      centroid: LatLngPoint;
      priceText: string | null;
      areaText: string;
      isBoosted: boolean;
      isPattaVerified: boolean;
    }> = [];

    for (const listing of listings) {
      const ring = extractExactRealEstatePolygon(listing);
      if (!ring) continue;
      const summary = (listing.vertical_summary || {}) as Record<string, unknown>;
      const rawRec = listing as unknown as Record<string, unknown>;
      const summaryPrice = Number(
        summary.price_inr ?? rawRec.price_inr ?? rawRec.price ?? 0
      );
      const summaryPeriod =
        summary.price_period === 'monthly' || summary.price_period === 'yearly'
          ? summary.price_period
          : 'total';
      const fallbackPrice =
        listing.realEstateDetails?.priceLabel || getListingPriceLabel(listing);
      const priceText =
        Number.isFinite(summaryPrice) && summaryPrice > 0
          ? formatIndianPropertyPrice(summaryPrice, summaryPeriod)
          : fallbackPrice && /\d/.test(fallbackPrice)
            ? fallbackPrice
            : null;

      const areaSqftVal = Number(summary.area_sqft ?? 0);
      const plotAreaSqmVal = Number(listing.realEstateDetails?.plotAreaSqm ?? 0);
      const sqMeters =
        Number.isFinite(areaSqftVal) && areaSqftVal > 0
          ? areaSqftVal / 10.7639
          : Number.isFinite(plotAreaSqmVal) && plotAreaSqmVal > 0
            ? plotAreaSqmVal
            : computePolygonAreaSqMeters(ring);

      const areaText =
        sqMeters > 0 ? formatArea(sqMeters, areaUnit) : 'Plot Boundary';

      out.push({
        listing,
        ring,
        centroid: computePolygonCentroid(ring),
        priceText,
        areaText,
        isBoosted: isRealEstateBoostActive(summary),
        isPattaVerified: Boolean(
          summary.patta_verified || summary.site_verified
        ),
      });
    }
    return out;
  }, [listings, areaUnit]);

  // Render & fluidly animate Google Maps Polygons with cubic ease-out
  useEffect(() => {
    if (!map || typeof google === 'undefined' || !google.maps) return;

    const clearAll = () => {
      if (animFrameRef.current !== null) {
        cancelAnimationFrame(animFrameRef.current);
        animFrameRef.current = null;
      }
      polygonsRef.current.forEach((poly) => poly.setMap(null));
      polygonsRef.current.clear();
    };

    if (!polygonsVisible || polygonEntries.length === 0) {
      clearAll();
      return;
    }

    clearAll();

    const created: Array<{
      poly: google.maps.Polygon;
      targetFill: number;
      targetStroke: number;
    }> = [];

    for (const entry of polygonEntries) {
      const isSelected = entry.listing.id === selectedListingId;
      const isHovered = entry.listing.id === hoveredListingId;
      const strokeColor =
        isSelected || entry.isBoosted ? '#f59e0b' : '#7c3aed';
      const fillColor = isSelected ? '#f59e0b' : '#7c3aed';
      const targetFill = isSelected || isHovered ? 0.34 : 0.2;
      const targetStroke = 0.95;

      const poly = new google.maps.Polygon({
        paths: entry.ring,
        strokeColor,
        strokeOpacity: 0,
        strokeWeight: isSelected ? 3 : 2.5,
        fillColor,
        fillOpacity: 0,
        clickable: true,
        zIndex: isSelected ? 540 : 420,
        map,
      });

      poly.addListener('click', () => onSelectListing(entry.listing.id));
      poly.addListener('mouseover', () => onHoverListing(entry.listing.id));
      poly.addListener('mouseout', () => onHoverListing(null));

      polygonsRef.current.set(entry.listing.id, poly);
      created.push({ poly, targetFill, targetStroke });
    }

    // Smooth 280ms cubic ease-out entrance
    const startTs = performance.now();
    const durationMs = 280;
    const step = (now: number) => {
      const t = Math.min(1, (now - startTs) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3);
      for (const item of created) {
        item.poly.setOptions({
          fillOpacity: item.targetFill * eased,
          strokeOpacity: item.targetStroke * eased,
        });
      }
      if (t < 1) {
        animFrameRef.current = requestAnimationFrame(step);
      } else {
        animFrameRef.current = null;
      }
    };
    animFrameRef.current = requestAnimationFrame(step);

    return clearAll;
  }, [
    map,
    polygonsVisible,
    polygonEntries,
    selectedListingId,
    hoveredListingId,
    onSelectListing,
    onHoverListing,
  ]);

  if (!polygonsVisible || polygonEntries.length === 0) return null;

  return (
    <>
      {polygonEntries.map((entry) => {
        const isSelected = entry.listing.id === selectedListingId;
        const isHovered = entry.listing.id === hoveredListingId;
        return (
          <AdvancedMarker
            key={`re-zoom-plot-pill-${entry.listing.id}`}
            position={entry.centroid}
            zIndex={isSelected ? 1160 : isHovered ? 1060 : 660}
            onClick={() => onSelectListing(entry.listing.id)}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onSelectListing(entry.listing.id);
              }}
              onMouseEnter={() => onHoverListing(entry.listing.id)}
              onMouseLeave={() => onHoverListing(null)}
              data-testid={`re-zoom-plot-pill-${entry.listing.id}`}
              className={`rounded-xl border-2 px-2.5 py-1 text-left shadow-xl transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] cursor-pointer ${
                isSelected
                  ? 'bg-slate-950 text-amber-300 border-amber-400 scale-110 ring-2 ring-amber-400/70'
                  : isHovered
                    ? 'bg-white text-slate-950 border-violet-600 scale-105'
                    : entry.isBoosted
                      ? 'bg-violet-700 text-white border-amber-300 ring-2 ring-amber-400/80'
                      : 'bg-violet-700/95 text-white border-white hover:scale-105'
              }`}
            >
              <div className="flex items-center gap-1 text-[11px] font-extrabold leading-tight whitespace-nowrap">
                {entry.priceText ? (
                  <span>{entry.priceText}</span>
                ) : (
                  <>
                    <Home className="w-3 h-3 shrink-0" />
                    <span>Price on Req</span>
                  </>
                )}
                {entry.isPattaVerified && (
                  <span
                    title="Patta / Site Verified"
                    className="h-1.5 w-1.5 rounded-full bg-amber-300 shrink-0"
                  />
                )}
              </div>
              <div className="text-[9px] font-semibold opacity-90 leading-tight whitespace-nowrap">
                {entry.areaText}
              </div>
            </button>
          </AdvancedMarker>
        );
      })}
    </>
  );
}

export default RealEstateZoomPolygonsLayer;
