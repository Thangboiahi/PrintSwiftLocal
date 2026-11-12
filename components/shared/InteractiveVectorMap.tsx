'use client';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Minus, Plus, RotateCcw } from 'lucide-react';
import {
  extractCloudStylePalette,
  PRINTSWIFT_MIDNIGHT_DISCOVERY_STYLE,
  PRINTSWIFT_NEUTRAL_DISCOVERY_STYLE,
} from '@/lib/map-cloud-styles';
import {
  DrawnShape,
  LatLngPoint,
  Listing,
  ListingCategory,
  MapAppearanceVariant,
  MapStyleOption,
  MapViewportBounds,
} from '@/lib/types';
import { computeClusterExpansionCamera } from '@/lib/rules';
import { CHURACHANDPUR_SAMPLE_CENTER } from '@/lib/seed-data';

const CATEGORY_COLORS: Record<
  ListingCategory,
  { bg: string; border: string; label: string; shortCode: string }
> = {
  business: { bg: '#0284c7', border: '#075985', label: 'Business', shortCode: 'B' },
  service: { bg: '#7c3aed', border: '#4c1d95', label: 'Service', shortCode: 'S' },
  real_estate: { bg: '#059669', border: '#064e3b', label: 'Real Estate', shortCode: 'RE' },
  sports: { bg: '#ea580c', border: '#9a3412', label: 'Sports', shortCode: 'SP' },
  public_place: { bg: '#2563eb', border: '#1e3a8a', label: 'Public Place', shortCode: 'P' },
};

const LOCALITY_LABELS: Array<{
  name: string;
  lat: number;
  lng: number;
  isCity?: boolean;
}> = [
  { name: 'CHURACHANDPUR (LAMKA)', lat: 24.3335, lng: 93.6978, isCity: true },
  { name: 'NEW LAMKA', lat: 24.3265, lng: 93.6945 },
  { name: 'TUIBONG', lat: 24.3465, lng: 93.7015 },
  { name: 'RENGKAI', lat: 24.3295, lng: 93.7115 },
  { name: 'HIANGTAM LAMKA', lat: 24.3375, lng: 93.6965 },
  { name: 'BUNGMUAL', lat: 24.3315, lng: 93.6835 },
  { name: 'PEARSONMUN', lat: 24.3225, lng: 93.6865 },
  { name: 'LANVA', lat: 24.3165, lng: 93.6985 },
  { name: 'ZENHANG LAMKA', lat: 24.3355, lng: 93.7045 },
];

const BASE_MAP_SAMPLE_POIS: Array<{
  id: string;
  label: string;
  lat: number;
  lng: number;
  kind: 'poi' | 'transit' | 'emergency' | 'sports' | 'worship';
}> = [
  { id: 'poi-1', label: 'District Hospital Gate', lat: 24.3362, lng: 93.6991, kind: 'emergency' },
  { id: 'poi-2', label: 'Tedim Bus Stand', lat: 24.3318, lng: 93.6968, kind: 'transit' },
  { id: 'poi-3', label: 'Public Ground', lat: 24.3388, lng: 93.7002, kind: 'sports' },
  { id: 'poi-4', label: 'Community Chapel', lat: 24.3282, lng: 93.7024, kind: 'worship' },
  { id: 'poi-5', label: 'Town Post Office', lat: 24.3348, lng: 93.6942, kind: 'poi' },
];

export interface ClusterNode {
  id: string;
  center: LatLngPoint;
  items: Listing[];
}

interface InteractiveVectorMapProps {
  listings: Listing[];
  clusters?: ClusterNode[];
  selectedListing: Listing | null;
  hoveredListingId?: string | null;
  onSelectListing: (listingId: string) => void;
  onHoverListing?: (listingId: string | null) => void;
  onClusterClick?: (items: Listing[]) => void;
  onHoverCluster?: (cluster: ClusterNode | null) => void;
  mapStyle: MapStyleOption;
  mapAppearance?: MapAppearanceVariant;
  center?: LatLngPoint;
  zoom?: number;
  onCameraChange?: (center: LatLngPoint, zoom: number, bounds: MapViewportBounds) => void;
  onViewportChange?: (bounds: MapViewportBounds) => void;
  drawnShapes?: DrawnShape[];
  inProgressPoints?: LatLngPoint[];
  selectedShapeId?: string | null;
  onSelectShape?: (shapeId: string) => void;
  onMapClickLatLng?: (pt: LatLngPoint) => void;
  recenterTrigger?: number;
  highlightPolygon?: LatLngPoint[];
  showPolygon?: boolean;
  hideBuiltInControls?: boolean;
  defaultCenter?: LatLngPoint;
}

export function InteractiveVectorMap({
  listings,
  clusters = [],
  selectedListing,
  hoveredListingId = null,
  onSelectListing,
  onHoverListing,
  onClusterClick,
  onHoverCluster,
  mapStyle,
  mapAppearance = 'light',
  center: controlledCenter,
  zoom: controlledZoom,
  onCameraChange,
  onViewportChange,
  drawnShapes = [],
  inProgressPoints = [],
  selectedShapeId = null,
  onSelectShape,
  onMapClickLatLng,
  recenterTrigger = 0,
  highlightPolygon,
  showPolygon = true,
  hideBuiltInControls = false,
  defaultCenter,
}: InteractiveVectorMapProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [internalCenter, setInternalCenter] = useState<LatLngPoint>(
    controlledCenter || CHURACHANDPUR_SAMPLE_CENTER
  );
  const [internalZoom, setInternalZoom] = useState<number>(controlledZoom || 14);
  const [isDragging, setIsDragging] = useState(false);

  const center = controlledCenter || internalCenter;
  const zoom = controlledZoom || internalZoom;

  const dragStartRef = useRef<{
    x: number;
    y: number;
    startLat: number;
    startLng: number;
  } | null>(null);

  const effectiveVariant: MapAppearanceVariant =
    mapStyle === 'dark' || mapAppearance === 'dark' ? 'dark' : 'light';

  const activeSpec =
    effectiveVariant === 'dark'
      ? PRINTSWIFT_MIDNIGHT_DISCOVERY_STYLE
      : PRINTSWIFT_NEUTRAL_DISCOVERY_STYLE;

  const cloudPalette = useMemo(
    () => extractCloudStylePalette(activeSpec),
    [activeSpec]
  );

  // Combine cloud style palette with satellite/hybrid/terrain layer overrides
  const theme = useMemo(() => {
    if (mapStyle === 'satellite' || mapStyle === 'hybrid') {
      return {
        ...cloudPalette,
        backgroundColor: '#132219',
        landFill: '#16281E',
        forestFill: '#1B3325',
        parkFill: '#1F3B2B',
        waterFill: '#102C38',
        waterStroke: '#224757',
        buildingFill: '#26382E',
        buildingStroke: '#354C3F',
        commercialBuildingFill: '#2D4236',
        roadLocalStroke:
          mapStyle === 'hybrid' ? cloudPalette.roadLocalStroke : '#2E4035',
        roadArterialStroke:
          mapStyle === 'hybrid' ? cloudPalette.roadArterialStroke : '#4A4637',
        roadHighwayStroke:
          mapStyle === 'hybrid' ? cloudPalette.roadHighwayStroke : '#6E5A3E',
        cityLabelFill: '#F4F6F2',
        cityLabelStroke: '#132219',
        neighborhoodLabelFill: '#D5E0D9',
        neighborhoodLabelStroke: '#132219',
        terrainContourStroke: 'transparent',
      };
    }
    if (mapStyle === 'terrain') {
      return {
        ...cloudPalette,
        terrainContourStroke:
          effectiveVariant === 'dark' ? '#2B3B32' : '#D5E2CF',
      };
    }
    return {
      ...cloudPalette,
      terrainContourStroke: 'transparent',
    };
  }, [cloudPalette, mapStyle, effectiveVariant]);

  // Degrees per pixel based on zoom level (calibrated for Churachandpur district span)
  const degPerPx = useMemo(() => 0.00022 / Math.pow(2, zoom - 12), [zoom]);

  const computeBounds = useCallback(
    (c: LatLngPoint, dpp: number): MapViewportBounds => {
      const width = containerRef.current?.clientWidth || 800;
      const height = containerRef.current?.clientHeight || 600;
      const halfLat = (height / 2) * dpp;
      const halfLng = (width / 2) * dpp * 1.1;
      return {
        north: Number((c.lat + halfLat).toFixed(6)),
        south: Number((c.lat - halfLat).toFixed(6)),
        east: Number((c.lng + halfLng).toFixed(6)),
        west: Number((c.lng - halfLng).toFixed(6)),
      };
    },
    []
  );

  const updateCamera = useCallback(
    (nextCenter: LatLngPoint, nextZoom: number) => {
      setInternalCenter(nextCenter);
      setInternalZoom(nextZoom);
      const b = computeBounds(nextCenter, 0.00022 / Math.pow(2, nextZoom - 12));
      onViewportChange?.(b);
      onCameraChange?.(nextCenter, nextZoom, b);
    },
    [computeBounds, onViewportChange, onCameraChange]
  );

  // Emit initial bounds on mount
  useEffect(() => {
    const b = computeBounds(center, degPerPx);
    onViewportChange?.(b);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pan to newly selected listing only when selectedListing?.id changes
  const prevSelectedIdRef = useRef<string | null>(null);
  useEffect(() => {
    const nextId = selectedListing?.id || null;
    if (nextId && nextId !== prevSelectedIdRef.current && selectedListing) {
      prevSelectedIdRef.current = nextId;
      queueMicrotask(() => {
        updateCamera(
          {
            lat: selectedListing.coordinates.lat,
            lng: selectedListing.coordinates.lng,
          },
          zoom
        );
      });
    } else if (!nextId) {
      prevSelectedIdRef.current = null;
    }
  }, [selectedListing, zoom, updateCamera]);

  // Recenter trigger
  const prevRecenterRef = useRef<number>(recenterTrigger);
  useEffect(() => {
    if (recenterTrigger > 0 && recenterTrigger !== prevRecenterRef.current) {
      prevRecenterRef.current = recenterTrigger;
      queueMicrotask(() => {
        updateCamera(defaultCenter || CHURACHANDPUR_SAMPLE_CENTER, 14);
      });
    }
  }, [recenterTrigger, updateCamera, defaultCenter]);

  // Convert LatLng to SVG viewBox (1000 x 700) coordinates
  const latLngToSvg = useCallback(
    (pt: LatLngPoint) => {
      const spanLat = 700 * degPerPx;
      const spanLng = 1000 * degPerPx * 1.1;
      const x = Number((500 + ((pt.lng - center.lng) / spanLng) * 1000).toFixed(3));
      const y = Number((350 - ((pt.lat - center.lat) / spanLat) * 700).toFixed(3));
      return { x, y };
    },
    [center, degPerPx]
  );

  const clientToLatLng = useCallback(
    (clientX: number, clientY: number): LatLngPoint | null => {
      if (!containerRef.current) return null;
      const rect = containerRef.current.getBoundingClientRect();
      const relX = (clientX - rect.left) / rect.width - 0.5;
      const relY = (clientY - rect.top) / rect.height - 0.5;
      const spanLat = 700 * degPerPx;
      const spanLng = 1000 * degPerPx * 1.1;
      return {
        lat: Number((center.lat - relY * spanLat).toFixed(6)),
        lng: Number((center.lng + relX * spanLng).toFixed(6)),
      };
    },
    [center, degPerPx]
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if ((e.target as HTMLElement).closest('[data-map-pin="true"]')) return;
    if ((e.target as HTMLElement).closest('[data-map-control="true"]')) return;
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      startLat: center.lat,
      startLng: center.lng,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging || !dragStartRef.current || !containerRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;
    const rect = containerRef.current.getBoundingClientRect();
    const spanLat = 700 * degPerPx;
    const spanLng = 1000 * degPerPx * 1.1;
    const nextLat = dragStartRef.current.startLat + (dy / rect.height) * spanLat;
    const nextLng = dragStartRef.current.startLng - (dx / rect.width) * spanLng;
    updateCamera(
      {
        lat: Number(nextLat.toFixed(6)),
        lng: Number(nextLng.toFixed(6)),
      },
      zoom
    );
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDragging && dragStartRef.current) {
      const moved =
        Math.hypot(
          e.clientX - dragStartRef.current.x,
          e.clientY - dragStartRef.current.y
        ) > 5;
      if (!moved && onMapClickLatLng) {
        const pt = clientToLatLng(e.clientX, e.clientY);
        if (pt) onMapClickLatLng(pt);
      }
    }
    setIsDragging(false);
    dragStartRef.current = null;
  };

  // Sample road, trail, railway & river anchor paths in Churachandpur
  const nh102bPts = useMemo(
    () =>
      [
        { lat: 24.362, lng: 93.708 },
        { lat: 24.348, lng: 93.701 },
        { lat: 24.334, lng: 93.698 },
        { lat: 24.322, lng: 93.693 },
        { lat: 24.308, lng: 93.688 },
      ].map(latLngToSvg),
    [latLngToSvg]
  );

  const khugaRiverPts = useMemo(
    () =>
      [
        { lat: 24.305, lng: 93.704 },
        { lat: 24.321, lng: 93.707 },
        { lat: 24.335, lng: 93.709 },
        { lat: 24.352, lng: 93.714 },
        { lat: 24.365, lng: 93.718 },
      ].map(latLngToSvg),
    [latLngToSvg]
  );

  const tipaimukhArterialPts = useMemo(
    () =>
      [
        { lat: 24.331, lng: 93.672 },
        { lat: 24.3335, lng: 93.6978 },
        { lat: 24.33, lng: 93.719 },
      ].map(latLngToSvg),
    [latLngToSvg]
  );

  const localRoadGridPts = useMemo(
    () => [
      [
        { lat: 24.342, lng: 93.688 },
        { lat: 24.342, lng: 93.709 },
      ].map(latLngToSvg),
      [
        { lat: 24.325, lng: 93.685 },
        { lat: 24.325, lng: 93.711 },
      ].map(latLngToSvg),
      [
        { lat: 24.345, lng: 93.694 },
        { lat: 24.318, lng: 93.694 },
      ].map(latLngToSvg),
    ],
    [latLngToSvg]
  );

  const hillsideTrailPts = useMemo(
    () =>
      [
        { lat: 24.344, lng: 93.681 },
        { lat: 24.338, lng: 93.687 },
        { lat: 24.332, lng: 93.684 },
      ].map(latLngToSvg),
    [latLngToSvg]
  );

  return (
    <div
      ref={containerRef}
      data-testid="printswift-vector-map"
      data-cloud-style-name={activeSpec.metadata.name}
      data-cloud-style-variant={activeSpec.variant}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      style={{ backgroundColor: theme.backgroundColor }}
      className={`relative isolate z-0 w-full h-full overflow-hidden select-none ${
        isDragging ? 'cursor-grabbing' : 'cursor-grab'
      }`}
    >
      {/* Vector Map SVG Layer faithfully implementing PrintSwift Cloud Style JSON */}
      <svg
        viewBox="0 0 1000 700"
        preserveAspectRatio="xMidYMid slice"
        className="w-full h-full"
      >
        {/* natural.land / natural.base */}
        <rect width="1000" height="700" fill={theme.landFill} />

        {/* natural.land.landCover.forest */}
        <ellipse
          cx={latLngToSvg({ lat: 24.348, lng: 93.682 }).x}
          cy={latLngToSvg({ lat: 24.348, lng: 93.682 }).y}
          rx={190}
          ry={140}
          fill={theme.forestFill}
          opacity="0.85"
        />
        <ellipse
          cx={latLngToSvg({ lat: 24.316, lng: 93.715 }).x}
          cy={latLngToSvg({ lat: 24.316, lng: 93.715 }).y}
          rx={210}
          ry={150}
          fill={theme.forestFill}
          opacity="0.85"
        />

        {/* pointOfInterest.recreation.park */}
        <circle
          cx={latLngToSvg({ lat: 24.3385, lng: 93.7005 }).x}
          cy={latLngToSvg({ lat: 24.3385, lng: 93.7005 }).y}
          r={65}
          fill={theme.parkFill}
        />
        <circle
          cx={latLngToSvg({ lat: 24.3275, lng: 93.6915 }).x}
          cy={latLngToSvg({ lat: 24.3275, lng: 93.6915 }).y}
          r={55}
          fill={theme.parkFill}
        />

        {/* Optional Terrain Contours when mapStyle === 'terrain' */}
        {mapStyle === 'terrain' && (
          <g stroke={theme.terrainContourStroke} strokeWidth="1.2" fill="none" strokeDasharray="6,4">
            <circle
              cx={latLngToSvg({ lat: 24.348, lng: 93.682 }).x}
              cy={latLngToSvg({ lat: 24.348, lng: 93.682 }).y}
              r={110}
            />
            <circle
              cx={latLngToSvg({ lat: 24.348, lng: 93.682 }).x}
              cy={latLngToSvg({ lat: 24.348, lng: 93.682 }).y}
              r={155}
            />
            <circle
              cx={latLngToSvg({ lat: 24.316, lng: 93.715 }).x}
              cy={latLngToSvg({ lat: 24.316, lng: 93.715 }).y}
              r={125}
            />
          </g>
        )}

        {/* infrastructure.building & infrastructure.building.commercial footprints */}
        {[
          { lat: 24.3345, lng: 93.6968, w: 32, h: 22, comm: true },
          { lat: 24.3322, lng: 93.6988, w: 28, h: 18, comm: true },
          { lat: 24.336, lng: 93.6952, w: 24, h: 16, comm: false },
          { lat: 24.3285, lng: 93.6962, w: 30, h: 20, comm: true },
          { lat: 24.3305, lng: 93.7025, w: 22, h: 16, comm: false },
          { lat: 24.3415, lng: 93.6995, w: 26, h: 18, comm: false },
        ].map((b, idx) => {
          const p = latLngToSvg({ lat: b.lat, lng: b.lng });
          return (
            <rect
              key={idx}
              x={p.x - b.w / 2}
              y={p.y - b.h / 2}
              width={b.w}
              height={b.h}
              rx={2}
              fill={b.comm ? theme.commercialBuildingFill : theme.buildingFill}
              stroke={theme.buildingStroke}
              strokeWidth="1"
            />
          );
        })}

        {/* natural.water (Khuga River Waterway) */}
        <polyline
          points={khugaRiverPts.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke={theme.waterStroke}
          strokeWidth="22"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <polyline
          points={khugaRiverPts.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke={theme.waterFill}
          strokeWidth="18"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* infrastructure.roadNetwork.noTraffic.trail */}
        <polyline
          points={hillsideTrailPts.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke={theme.trailStroke}
          strokeWidth="2.5"
          strokeDasharray="5,4"
          strokeLinecap="round"
        />

        {/* infrastructure.roadNetwork.road.local */}
        {localRoadGridPts.map((pts, i) => (
          <polyline
            key={i}
            points={pts.map((p) => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke={theme.roadLocalStroke}
            strokeWidth="4.5"
            strokeLinecap="round"
          />
        ))}

        {/* infrastructure.roadNetwork.road.arterial (Tipaimukh / Rengkai Road) */}
        <polyline
          points={tipaimukhArterialPts.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke={theme.roadArterialStroke}
          strokeWidth="8"
          strokeLinecap="round"
        />

        {/* infrastructure.roadNetwork.road.highway: Tedim Road (NH-102B) */}
        <polyline
          points={nh102bPts.map((p) => `${p.x},${p.y}`).join(' ')}
          fill="none"
          stroke={theme.roadHighwayStroke}
          strokeWidth="11"
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        {/* Muted Base-Map Google Points of Interest (Subordinate to PrintSwift markers) */}
        {mapStyle !== 'satellite' &&
          BASE_MAP_SAMPLE_POIS.map((poi) => {
            const pos = latLngToSvg(poi);
            const pinFill =
              poi.kind === 'emergency'
                ? theme.emergencyPinFill
                : theme.poiPinFill;
            return (
              <g key={poi.id} opacity="0.72">
                <circle
                  cx={pos.x}
                  cy={pos.y}
                  r="4.5"
                  fill={pinFill}
                  stroke={theme.poiPinOutline}
                  strokeWidth="1.2"
                />
                <text
                  x={pos.x + 8}
                  y={pos.y + 3}
                  fill={theme.poiTextFill}
                  stroke={theme.backgroundColor}
                  strokeWidth="2"
                  paintOrder="stroke"
                  fontSize="9.5"
                  fontWeight="500"
                >
                  {poi.label}
                </text>
              </g>
            );
          })}

        {/* political.city & political.neighborhood Labels */}
        {mapStyle !== 'satellite' &&
          LOCALITY_LABELS.map((loc) => {
            const pos = latLngToSvg(loc);
            return (
              <text
                key={loc.name}
                x={pos.x}
                y={pos.y}
                fill={loc.isCity ? theme.cityLabelFill : theme.neighborhoodLabelFill}
                stroke={
                  loc.isCity ? theme.cityLabelStroke : theme.neighborhoodLabelStroke
                }
                strokeWidth="3"
                paintOrder="stroke"
                fontSize={loc.isCity ? '12.5' : '10.5'}
                fontWeight={loc.isCity ? '800' : '700'}
                letterSpacing="1.1"
                textAnchor="middle"
              >
                {loc.name}
              </text>
            );
          })}

        {/* Selected Listing or Property Boundary Polygon */}
        {showPolygon && highlightPolygon && highlightPolygon.length >= 3 && (
          <polygon
            points={highlightPolygon
              .map((pt) => {
                const p = latLngToSvg(pt);
                return `${p.x},${p.y}`;
              })
              .join(' ')}
            fill="rgba(16, 185, 129, 0.25)"
            stroke="#059669"
            strokeWidth="2.5"
            strokeDasharray="6,4"
          />
        )}

        {/* User Drawn Geospatial Shapes */}
        {drawnShapes
          .filter((s) => s.visible !== false)
          .map((shape) => {
            const isSel = shape.id === selectedShapeId;
            const stroke = isSel ? '#f59e0b' : '#0284c7';
            if (
              (shape.type === 'polygon' || shape.type === 'rectangle') &&
              shape.coordinates.length >= 3
            ) {
              return (
                <polygon
                  key={shape.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectShape?.(shape.id);
                  }}
                  points={shape.coordinates
                    .map((pt) => {
                      const p = latLngToSvg(pt);
                      return `${p.x},${p.y}`;
                    })
                    .join(' ')}
                  fill="rgba(2, 132, 199, 0.2)"
                  stroke={stroke}
                  strokeWidth={isSel ? 3 : 2}
                  className="cursor-pointer"
                />
              );
            }
            if (shape.type === 'line' && shape.coordinates.length >= 2) {
              return (
                <polyline
                  key={shape.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectShape?.(shape.id);
                  }}
                  points={shape.coordinates
                    .map((pt) => {
                      const p = latLngToSvg(pt);
                      return `${p.x},${p.y}`;
                    })
                    .join(' ')}
                  fill="none"
                  stroke={stroke}
                  strokeWidth={isSel ? 3.5 : 2.5}
                  className="cursor-pointer"
                />
              );
            }
            if (shape.type === 'circle' && shape.center && shape.radiusMeters) {
              const c = latLngToSvg(shape.center);
              const rPx = Math.max(
                14,
                shape.radiusMeters / (degPerPx * 111320)
              );
              return (
                <circle
                  key={shape.id}
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelectShape?.(shape.id);
                  }}
                  cx={c.x}
                  cy={c.y}
                  r={rPx}
                  fill="rgba(2, 132, 199, 0.18)"
                  stroke={stroke}
                  strokeWidth={isSel ? 3 : 2}
                  className="cursor-pointer"
                />
              );
            }
            return null;
          })}

        {/* In-progress drawing vertices */}
        {inProgressPoints.length > 0 && (
          <polyline
            points={inProgressPoints
              .map((pt) => {
                const p = latLngToSvg(pt);
                return `${p.x},${p.y}`;
              })
              .join(' ')}
            fill="none"
            stroke="#f59e0b"
            strokeWidth="2.5"
            strokeDasharray="4,4"
          />
        )}
      </svg>

      {/* Interactive Prominent PrintSwift Pin & Cluster Layer */}
      <div className="absolute inset-0 pointer-events-none">
        {/* Custom User Drawn Point Pins (Visually distinct diamond/square badge) */}
        {drawnShapes
          .filter((s) => s.type === 'point' && s.visible !== false && s.coordinates[0])
          .map((shape) => {
            const pos = latLngToSvg(shape.coordinates[0]);
            const leftPct = Number(((pos.x / 1000) * 100).toFixed(3));
            const topPct = Number(((pos.y / 700) * 100).toFixed(3));
            if (leftPct < -5 || leftPct > 105 || topPct < -5 || topPct > 105) {
              return null;
            }
            const isSel = shape.id === selectedShapeId;
            return (
              <button
                key={shape.id}
                type="button"
                data-map-pin="true"
                data-testid={`custom-point-marker-${shape.id}`}
                onClick={(e) => {
                  e.stopPropagation();
                  onSelectShape?.(shape.id);
                }}
                style={{
                  left: `${leftPct}%`,
                  top: `${topPct}%`,
                }}
                title={`${shape.label}${shape.description ? ` — ${shape.description}` : ''}`}
                aria-label={`Custom map point: ${shape.label}`}
                className={`pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 px-2 py-0.5 rounded-md border-2 shadow-lg flex items-center gap-1 text-[10px] font-bold transition-transform z-30 ${
                  isSel
                    ? 'bg-amber-400 text-slate-950 border-slate-950 scale-115 ring-4 ring-amber-400/60'
                    : 'bg-teal-600 text-white border-white hover:scale-110'
                }`}
              >
                <span>★</span>
                <span className="max-w-[90px] truncate">{shape.label}</span>
              </button>
            );
          })}

        {/* Cluster Badges */}
        {clusters.map((cluster) => {
          const pos = latLngToSvg(cluster.center);
          const leftPct = Number(((pos.x / 1000) * 100).toFixed(3));
          const topPct = Number(((pos.y / 700) * 100).toFixed(3));
          if (leftPct < -5 || leftPct > 105 || topPct < -5 || topPct > 105) {
            return null;
          }
          return (
            <button
              key={cluster.id}
              type="button"
              data-map-pin="true"
              data-cluster-pin="true"
              onMouseEnter={() => onHoverCluster?.(cluster)}
              onMouseLeave={() => onHoverCluster?.(null)}
              onFocus={() => onHoverCluster?.(cluster)}
              onBlur={() => onHoverCluster?.(null)}
              onClick={(e) => {
                e.stopPropagation();
                if (onClusterClick) {
                  onClusterClick(cluster.items);
                } else {
                  const exp = computeClusterExpansionCamera(cluster.items, zoom);
                  updateCamera(exp.center, exp.zoom);
                }
              }}
              style={{
                left: `${leftPct}%`,
                top: `${topPct}%`,
              }}
              title={`Cluster of ${cluster.items.length} sample listings`}
              aria-label={`Cluster of ${cluster.items.length} sample listings`}
              className="pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 w-9 h-9 rounded-full bg-slate-900 text-white border-2 border-white shadow-lg flex items-center justify-center text-xs font-bold tabular-nums z-30 hover:scale-110 transition-transform"
            >
              {cluster.items.length}
            </button>
          );
        })}

        {/* Individual Category-Specific Markers */}
        {listings.map((item) => {
          const pos = latLngToSvg(item.coordinates);
          const leftPct = Number(((pos.x / 1000) * 100).toFixed(3));
          const topPct = Number(((pos.y / 700) * 100).toFixed(3));
          if (leftPct < -5 || leftPct > 105 || topPct < -5 || topPct > 105) {
            return null;
          }
          const isSelected = selectedListing?.id === item.id;
          const isHovered = hoveredListingId === item.id;
          const colors = CATEGORY_COLORS[item.category];

          return (
            <button
              key={item.id}
              type="button"
              data-map-pin="true"
              data-listing-id={item.id}
              data-selected={isSelected ? 'true' : 'false'}
              data-hovered={isHovered ? 'true' : 'false'}
              onMouseEnter={() => onHoverListing?.(item.id)}
              onMouseLeave={() => onHoverListing?.(null)}
              onFocus={() => onHoverListing?.(item.id)}
              onBlur={() => onHoverListing?.(null)}
              onClick={(e) => {
                e.stopPropagation();
                onSelectListing(item.id);
              }}
              style={{
                left: `${leftPct}%`,
                top: `${topPct}%`,
                backgroundColor: isSelected
                  ? '#f59e0b'
                  : isHovered
                    ? '#0f172a'
                    : colors.bg,
                borderColor: isSelected ? '#0f172a' : '#ffffff',
                color: isSelected ? '#0f172a' : '#ffffff',
              }}
              title={`${item.title} (${item.locality})`}
              aria-label={`Select map marker for ${item.title}`}
              className={`pointer-events-auto absolute -translate-x-1/2 -translate-y-1/2 rounded-full border-2 shadow-lg transition-transform flex items-center justify-center font-bold ${
                isSelected
                  ? 'w-9 h-9 z-40 scale-125 ring-4 ring-amber-400/70 text-[11px]'
                  : isHovered
                    ? 'w-8 h-8 z-30 scale-125 ring-2 ring-white text-[10px]'
                    : 'w-6 h-6 z-20 hover:scale-125 text-[9px]'
              }`}
            >
              <span>{colors.shortCode}</span>
            </button>
          );
        })}
      </div>

      {/* Built-in Controls (only shown when not hosted inside DiscoveryWorkspace's FloatingMapToolbar) */}
      {!hideBuiltInControls && (
        <div
          data-map-control="true"
          className="absolute top-2.5 right-2.5 z-20 flex flex-col gap-1 bg-[var(--ps-surface)]/95 backdrop-blur border border-[var(--ps-border)] rounded-xl p-1 shadow-md"
        >
          <button
            type="button"
            onClick={() =>
              updateCamera(
                center,
                Math.min(18, Number((zoom + 0.6).toFixed(1)))
              )
            }
            aria-label="Zoom in map"
            className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-[var(--ps-surface-alt)] text-[var(--ps-text)]"
          >
            <Plus className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() =>
              updateCamera(
                center,
                Math.max(11, Number((zoom - 0.6).toFixed(1)))
              )
            }
            aria-label="Zoom out map"
            className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-[var(--ps-surface-alt)] text-[var(--ps-text)]"
          >
            <Minus className="w-4 h-4" />
          </button>
          <button
            type="button"
            onClick={() => updateCamera(CHURACHANDPUR_SAMPLE_CENTER, 14)}
            aria-label="Reset map center"
            className="w-9 h-9 rounded-lg flex items-center justify-center hover:bg-[var(--ps-surface-alt)] text-[var(--ps-text)]"
          >
            <RotateCcw className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

export default InteractiveVectorMap;
