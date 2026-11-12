'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AdvancedMarker,
  Map as GoogleMap,
  Pin,
  useMap,
} from '@vis.gl/react-google-maps';
import {
  Eye,
  EyeOff,
  Maximize2,
  Moon,
  RotateCcw,
  Ruler,
  Sun,
} from 'lucide-react';
import { InteractiveVectorMap } from '@/components/shared/InteractiveVectorMap';
import { resolveCloudMapConfiguration } from '@/lib/map-cloud-styles';
import {
  calculatePolygonMetrics,
  formatArea,
  formatLinearDistance,
  shouldShowPlotAndBoundary,
} from '@/lib/rules';
import { useAppStore } from '@/lib/store';
import {
  AreaUnit,
  BaseMapType,
  DrawnShape,
  LatLngPoint,
  Listing,
  MapAppearanceVariant,
  PropertyType,
} from '@/lib/types';

interface PropertyBoundaryMapProps {
  listingId: string;
  propertyTitle: string;
  propertyType: PropertyType;
  hasAssociatedPlot: boolean;
  coordinates: LatLngPoint;
  boundaryPolygon?: LatLngPoint[];
  plotAreaSqm?: number;
  apiKeyAvailable: boolean;
  canEditGeometry?: boolean;
  onUpdatePolygon?: (newPolygon: LatLngPoint[], newAreaSqm: number) => void;
}

function PolygonOverlayController({
  polygonPoints,
  showBoundary,
  highlightBoundary,
  fitTrigger,
  center,
  resetTrigger,
}: {
  polygonPoints: LatLngPoint[];
  showBoundary: boolean;
  highlightBoundary: boolean;
  fitTrigger: number;
  center: LatLngPoint;
  resetTrigger: number;
}) {
  const map = useMap('property-detail-map');
  const polyRef = useRef<google.maps.Polygon | null>(null);
  const lastFitRef = useRef<number>(fitTrigger);
  const lastResetRef = useRef<number>(resetTrigger);

  useEffect(() => {
    if (!map) return;
    if (polyRef.current) {
      polyRef.current.setMap(null);
      polyRef.current = null;
    }
    if (!showBoundary || !polygonPoints || polygonPoints.length < 3) return;

    const poly = new google.maps.Polygon({
      paths: polygonPoints,
      strokeColor: highlightBoundary ? '#10b981' : '#0284c7',
      strokeOpacity: 0.95,
      strokeWeight: highlightBoundary ? 3 : 2,
      fillColor: highlightBoundary ? '#10b981' : '#38bdf8',
      fillOpacity: highlightBoundary ? 0.35 : 0.2,
      map,
    });
    polyRef.current = poly;

    return () => {
      poly.setMap(null);
    };
  }, [map, polygonPoints, showBoundary, highlightBoundary]);

  useEffect(() => {
    if (
      !map ||
      fitTrigger === 0 ||
      fitTrigger === lastFitRef.current ||
      !polygonPoints ||
      polygonPoints.length < 3
    ) {
      return;
    }
    lastFitRef.current = fitTrigger;
    const bounds = new google.maps.LatLngBounds();
    polygonPoints.forEach((pt) => bounds.extend(pt));
    map.fitBounds(bounds, 40);
  }, [map, fitTrigger, polygonPoints]);

  useEffect(() => {
    if (!map || resetTrigger === 0 || resetTrigger === lastResetRef.current) return;
    lastResetRef.current = resetTrigger;
    map.panTo(center);
    map.setZoom(17);
  }, [map, resetTrigger, center]);

  return null;
}

export function PropertyBoundaryMap({
  listingId,
  propertyTitle,
  propertyType,
  hasAssociatedPlot,
  coordinates,
  boundaryPolygon,
  plotAreaSqm,
  apiKeyAvailable,
  canEditGeometry = false,
  onUpdatePolygon,
}: PropertyBoundaryMapProps) {
  const {
    listings,
    areaUnit,
    setAreaUnit,
    mapAppearance,
    configuredMapId,
    configuredLightMapId,
    configuredDarkMapId,
    useVectorStylePreview,
  } = useAppStore();
  const showPlotTools = shouldShowPlotAndBoundary(propertyType, hasAssociatedPlot);

  const [localPoly, setLocalPoly] = useState<LatLngPoint[]>(
    boundaryPolygon || []
  );
  const [showBoundary, setShowBoundary] = useState(true);
  const [highlightBoundary, setHighlightBoundary] = useState(false);
  const [localMapType, setLocalMapType] = useState<BaseMapType>('hybrid');
  const [localAppearance, setLocalAppearance] =
    useState<MapAppearanceVariant>(mapAppearance);
  const [cameraCenter, setCameraCenter] = useState<LatLngPoint>(coordinates);
  const [cameraZoom, setCameraZoom] = useState<number>(17);
  const [inspectVertices, setInspectVertices] = useState(false);
  const [fitTrigger, setFitTrigger] = useState(0);
  const [resetTrigger, setResetTrigger] = useState(0);

  useEffect(() => {
    queueMicrotask(() => {
      setLocalPoly(boundaryPolygon || []);
    });
  }, [boundaryPolygon]);

  const resolvedCloudConfig = useMemo(
    () =>
      resolveCloudMapConfiguration({
        mapStyle: localMapType,
        mapAppearance: localAppearance,
        configuredMapId,
        configuredLightMapId,
        configuredDarkMapId,
      }),
    [
      localMapType,
      localAppearance,
      configuredMapId,
      configuredLightMapId,
      configuredDarkMapId,
    ]
  );

  const metrics = useMemo(() => {
    if (!showPlotTools || localPoly.length < 3) {
      return { areaSqm: plotAreaSqm || 0, perimeterMeters: 0, isValid: false };
    }
    return calculatePolygonMetrics(localPoly);
  }, [showPlotTools, localPoly, plotAreaSqm]);

  const effectiveAreaSqm = plotAreaSqm || metrics.areaSqm;

  const handleNudgeVertex = (idx: number, dLat: number, dLng: number) => {
    const updated = localPoly.map((pt, i) =>
      i === idx
        ? {
            lat: Number((pt.lat + dLat).toFixed(6)),
            lng: Number((pt.lng + dLng).toFixed(6)),
          }
        : pt
    );
    setLocalPoly(updated);
    const nextMetrics = calculatePolygonMetrics(updated);
    if (onUpdatePolygon && nextMetrics.isValid) {
      onUpdatePolygon(updated, nextMetrics.areaSqm);
    }
  };

  const fallbackShapes = useMemo<DrawnShape[]>(() => {
    if (!showPlotTools || !showBoundary || localPoly.length < 3) return [];
    return [
      {
        id: `prop-poly-${listingId}`,
        type: 'polygon',
        label: propertyTitle,
        coordinates: localPoly,
        areaSqm: effectiveAreaSqm,
        perimeterMeters: metrics.perimeterMeters,
        createdAt: '',
      },
    ];
  }, [
    showPlotTools,
    showBoundary,
    localPoly,
    listingId,
    propertyTitle,
    effectiveAreaSqm,
    metrics.perimeterMeters,
  ]);

  const fallbackSingleListing = useMemo<Listing[]>(() => {
    const existing = listings.find((l) => l.id === listingId);
    return existing ? [existing] : [];
  }, [listings, listingId]);

  return (
    <div className="bg-[var(--ps-surface)] border border-[var(--ps-border)] rounded-xl overflow-hidden space-y-0">
      {/* Header */}
      <div className="px-4 py-3 bg-[var(--ps-surface-alt)] border-b border-[var(--ps-border)] flex flex-wrap items-center justify-between gap-2">
        <div>
          <h4 className="text-xs font-semibold text-[var(--ps-text)]">
            {showPlotTools
              ? 'Property-Specific Interactive Plot & Boundary Map'
              : 'Property Location Orientation Map'}
          </h4>
          <p className="text-[11px] text-[var(--ps-text-muted)]">
            {showPlotTools
              ? 'Illustrative sample boundary polygon — Not legally surveyed or officially verified.'
              : 'Building/unit location pin (Plot boundary tools omitted for non-plot property type).'}
          </p>
        </div>

        {/* Map Controls */}
        <div className="flex flex-wrap items-center gap-1.5">
          {/* Independent Light / Dark Map Appearance */}
          <div className="inline-flex items-center bg-[var(--ps-bg)] p-0.5 rounded-lg border border-[var(--ps-border)]">
            <button
              type="button"
              onClick={() => setLocalAppearance('light')}
              className={`px-2 py-0.5 rounded text-[11px] font-medium inline-flex items-center gap-1 ${
                localAppearance === 'light'
                  ? 'bg-[#F4F6F2] text-[#2F3E37] border border-[#CBD3C8] font-semibold'
                  : 'text-[var(--ps-text-muted)]'
              }`}
              title="PrintSwift Neutral Discovery (Light)"
            >
              <Sun className="w-3 h-3 text-amber-500" />
              <span>Light</span>
            </button>
            <button
              type="button"
              onClick={() => setLocalAppearance('dark')}
              className={`px-2 py-0.5 rounded text-[11px] font-medium inline-flex items-center gap-1 ${
                localAppearance === 'dark'
                  ? 'bg-[#171D1A] text-[#DDE6E0] border border-[#44544C] font-semibold'
                  : 'text-[var(--ps-text-muted)]'
              }`}
              title="PrintSwift Midnight Discovery (Dark)"
            >
              <Moon className="w-3 h-3 text-teal-400" />
              <span>Dark</span>
            </button>
          </div>

          <select
            aria-label="Property map style"
            value={localMapType}
            onChange={(e) => setLocalMapType(e.target.value as BaseMapType)}
            className="text-xs px-2.5 py-1 rounded-lg bg-[var(--ps-bg)] border border-[var(--ps-border)] text-[var(--ps-text)]"
          >
            <option value="roadmap">Roadmap</option>
            <option value="hybrid">Hybrid</option>
            <option value="satellite">Satellite</option>
            <option value="terrain">Terrain</option>
          </select>

          {showPlotTools && localPoly.length >= 3 && (
            <>
              <button
                type="button"
                onClick={() => setShowBoundary((p) => !p)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]"
              >
                {showBoundary ? (
                  <EyeOff className="w-3.5 h-3.5" />
                ) : (
                  <Eye className="w-3.5 h-3.5" />
                )}
                <span>{showBoundary ? 'Hide Boundary' : 'Show Boundary'}</span>
              </button>
              <button
                type="button"
                onClick={() => setHighlightBoundary((p) => !p)}
                className={`px-2.5 py-1 rounded-lg border text-xs font-medium ${
                  highlightBoundary
                    ? 'bg-emerald-600 text-white border-emerald-600'
                    : 'bg-[var(--ps-bg)] text-[var(--ps-text)] border-[var(--ps-border)]'
                }`}
              >
                Highlight
              </button>
              <button
                type="button"
                onClick={() => setFitTrigger((c) => c + 1)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]"
              >
                <Maximize2 className="w-3.5 h-3.5" />
                <span>Fit Boundary</span>
              </button>
              <button
                type="button"
                onClick={() => setInspectVertices((p) => !p)}
                className="px-2.5 py-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]"
              >
                {inspectVertices ? 'Hide Vertices' : `Vertices (${localPoly.length})`}
              </button>
            </>
          )}

          <button
            type="button"
            onClick={() => {
              setCameraCenter(coordinates);
              setCameraZoom(17);
              setResetTrigger((c) => c + 1);
            }}
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]"
          >
            <RotateCcw className="w-3.5 h-3.5" />
            <span>Reset View</span>
          </button>
        </div>
      </div>

      {/* Measurements Strip (ONLY shown when showPlotTools is true) */}
      {showPlotTools && (
        <div className="px-4 py-2.5 bg-[var(--ps-bg)] border-b border-[var(--ps-border)] flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-4 text-xs">
            <div className="flex items-center gap-1.5">
              <Ruler className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
              <span className="text-[var(--ps-text-muted)]">Plot Area:</span>
              <span className="font-semibold text-[var(--ps-text)] tabular-nums">
                {formatArea(effectiveAreaSqm, areaUnit)}
              </span>
              {areaUnit !== 'sqm' && (
                <span className="text-[11px] text-[var(--ps-text-muted)] tabular-nums">
                  ({formatArea(effectiveAreaSqm, 'sqm')} canonical)
                </span>
              )}
            </div>

            {metrics.perimeterMeters > 0 && (
              <div className="flex items-center gap-1.5">
                <span className="text-[var(--ps-text-muted)]">
                  Calculated Perimeter:
                </span>
                <span className="font-semibold text-[var(--ps-text)] tabular-nums">
                  {formatLinearDistance(metrics.perimeterMeters, 'm')}
                </span>
              </div>
            )}
          </div>

          {/* Unit Switcher (Default m²) */}
          <div className="flex items-center gap-1">
            <span className="text-[11px] text-[var(--ps-text-muted)] mr-1">
              Area Unit:
            </span>
            {(
              [
                { id: 'sqm', label: 'm²' },
                { id: 'sqft', label: 'ft²' },
                { id: 'acre', label: 'Acres' },
                { id: 'hectare', label: 'Ha' },
              ] as Array<{ id: AreaUnit; label: string }>
            ).map((u) => (
              <button
                key={u.id}
                type="button"
                onClick={() => setAreaUnit(u.id)}
                className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                  areaUnit === u.id
                    ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                    : 'bg-[var(--ps-surface-alt)] text-[var(--ps-text-muted)]'
                }`}
              >
                {u.label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Map Viewport */}
      <div
        className="h-64 sm:h-72 w-full relative"
        style={{ backgroundColor: resolvedCloudConfig.backgroundColor }}
      >
        {apiKeyAvailable && !useVectorStylePreview ? (
          <GoogleMap
            key={`prop-gmap-${resolvedCloudConfig.mapId}-${resolvedCloudConfig.colorScheme}`}
            id="property-detail-map"
            mapId={resolvedCloudConfig.mapId}
            defaultCenter={cameraCenter}
            defaultZoom={cameraZoom}
            mapTypeId={resolvedCloudConfig.mapTypeId}
            colorScheme={resolvedCloudConfig.colorScheme}
            backgroundColor={resolvedCloudConfig.backgroundColor}
            gestureHandling="cooperative"
            disableDefaultUI={true}
            zoomControl={true}
            clickableIcons={false}
            keyboardShortcuts={true}
            controlSize={28}
            internalUsageAttributionIds={[
              'gmp_mcp_codeassist_v1_aistudio',
              'gmp_git_agentskills_v1',
            ]}
            onCameraChanged={(ev) => {
              if (ev.detail.center) {
                setCameraCenter({
                  lat: ev.detail.center.lat,
                  lng: ev.detail.center.lng,
                });
              }
              if (ev.detail.zoom) {
                setCameraZoom(ev.detail.zoom);
              }
            }}
            className="w-full h-full"
          >
            <AdvancedMarker
              position={coordinates}
              zIndex={1000}
              collisionBehavior="REQUIRED_AND_HIDES_OPTIONAL"
              title={propertyTitle}
            >
              <Pin
                background="#059669"
                borderColor="#064e3b"
                glyphColor="#ffffff"
                scale={1.25}
              />
            </AdvancedMarker>

            {showPlotTools && localPoly.length >= 3 && (
              <PolygonOverlayController
                polygonPoints={localPoly}
                showBoundary={showBoundary}
                highlightBoundary={highlightBoundary}
                fitTrigger={fitTrigger}
                center={coordinates}
                resetTrigger={resetTrigger}
              />
            )}
          </GoogleMap>
        ) : (
          <InteractiveVectorMap
            listings={fallbackSingleListing}
            selectedListing={fallbackSingleListing[0] || null}
            onSelectListing={() => {}}
            mapStyle={localMapType}
            mapAppearance={resolvedCloudConfig.variant}
            center={cameraCenter}
            zoom={cameraZoom}
            onCameraChange={(nextCenter, nextZoom) => {
              setCameraCenter(nextCenter);
              setCameraZoom(nextZoom);
            }}
            drawnShapes={fallbackShapes}
            selectedShapeId={
              highlightBoundary ? `prop-poly-${listingId}` : null
            }
            recenterTrigger={resetTrigger}
          />
        )}
      </div>

      {/* Vertex Inspector & Authorised Demo Geometry Editor */}
      {showPlotTools && inspectVertices && localPoly.length >= 3 && (
        <div className="p-3.5 bg-[var(--ps-surface-alt)] border-t border-[var(--ps-border)] space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-semibold text-[var(--ps-text)]">
              Illustrative Boundary Vertices ({localPoly.length} points)
            </span>
            <span className="text-[11px] text-[var(--ps-text-muted)]">
              Calculated Area: {formatArea(metrics.areaSqm, 'sqm')} · Perimeter:{' '}
              {formatLinearDistance(metrics.perimeterMeters, 'm')}
            </span>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            {localPoly.map((v, idx) => (
              <div
                key={idx}
                className="flex items-center justify-between px-3 py-1.5 rounded bg-[var(--ps-surface)] border border-[var(--ps-border)] text-xs font-mono tabular-nums"
              >
                <span>
                  V{idx + 1}: {v.lat.toFixed(6)}, {v.lng.toFixed(6)}
                </span>
                {canEditGeometry && (
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => handleNudgeVertex(idx, 0.00005, 0)}
                      className="px-1.5 py-0.5 rounded bg-[var(--ps-surface-alt)] hover:opacity-80 text-[10px]"
                      title="Nudge North"
                    >
                      +N
                    </button>
                    <button
                      type="button"
                      onClick={() => handleNudgeVertex(idx, 0, 0.00005)}
                      className="px-1.5 py-0.5 rounded bg-[var(--ps-surface-alt)] hover:opacity-80 text-[10px]"
                      title="Nudge East"
                    >
                      +E
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
