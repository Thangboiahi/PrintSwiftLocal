'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AdvancedMarker,
  Map as GoogleMap,
  Pin,
  useMap,
} from '@vis.gl/react-google-maps';
import {
  ChevronDown,
  ChevronUp,
  Compass,
  Crosshair,
  Eye,
  EyeOff,
  Loader2,
  MapPin,
  Navigation,
  PenTool,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import { InteractiveVectorMap } from '@/components/shared/InteractiveVectorMap';
import { resolveCloudMapConfiguration } from '@/lib/map-cloud-styles';
import { useMapsAvailability } from '@/lib/maps-context';
import {
  calculatePolygonMetrics,
  formatArea,
  formatLinearDistance,
  shouldShowPlotAndBoundary,
} from '@/lib/rules';
import { useAppStore } from '@/lib/store';
import type { DrawnShape, LatLngPoint, PropertyType } from '@/lib/types';
import type { ListingVertical } from '@/lib/verticals/types';

export interface MapCoordinatePickerProps {
  coordinates: LatLngPoint;
  onChangeCoordinates: (next: LatLngPoint) => void;
  hubCenter?: LatLngPoint | null;
  hubLabel?: string;
  localityCenter?: LatLngPoint | null;
  localityLabel?: string;
  listingVertical?: ListingVertical;
  propertyType?: PropertyType;
  hasAssociatedPlot?: boolean;
  boundaryPolygon?: LatLngPoint[];
  onChangeBoundaryPolygon?: (
    polygon: LatLngPoint[],
    computedAreaSqm: number,
    computedAreaSqft: number
  ) => void;
  showExactPin?: boolean;
  onChangeShowExactPin?: (next: boolean) => void;
  className?: string;
}

type PickMode = 'pin' | 'crosshair' | 'polygon';

function MapCameraSyncController({
  panRequest,
  polygonPoints,
  showPolygon,
}: {
  panRequest: { center: LatLngPoint; zoom: number; seq: number } | null;
  polygonPoints: LatLngPoint[];
  showPolygon: boolean;
}) {
  const map = useMap('listing-editor-coordinate-map');
  const lastSeqRef = useRef<number>(0);
  const polyRef = useRef<google.maps.Polygon | null>(null);

  useEffect(() => {
    if (!map || !panRequest || panRequest.seq === lastSeqRef.current) return;
    lastSeqRef.current = panRequest.seq;
    map.panTo(panRequest.center);
    map.setZoom(panRequest.zoom);
  }, [map, panRequest]);

  useEffect(() => {
    if (!map) return;
    if (polyRef.current) {
      polyRef.current.setMap(null);
      polyRef.current = null;
    }
    if (!showPolygon || polygonPoints.length < 2) return;

    const polygon = new google.maps.Polygon({
      paths: polygonPoints,
      strokeColor: '#059669',
      strokeOpacity: 0.95,
      strokeWeight: 2.5,
      fillColor: '#10b981',
      fillOpacity: polygonPoints.length >= 3 ? 0.25 : 0.08,
      clickable: false,
      map,
    });
    polyRef.current = polygon;

    return () => {
      polygon.setMap(null);
    };
  }, [map, polygonPoints, showPolygon]);

  return null;
}

export function MapCoordinatePicker({
  coordinates,
  onChangeCoordinates,
  hubCenter,
  hubLabel,
  localityCenter,
  localityLabel,
  listingVertical = 'general',
  propertyType = 'plot_land',
  hasAssociatedPlot = true,
  boundaryPolygon = [],
  onChangeBoundaryPolygon,
  showExactPin = true,
  onChangeShowExactPin,
  className = '',
}: MapCoordinatePickerProps) {
  const {
    mapStyle,
    mapAppearance,
    configuredMapId,
    configuredLightMapId,
    configuredDarkMapId,
    useVectorStylePreview,
  } = useAppStore();
  const { apiKeyAvailable } = useMapsAvailability();

  const isRealEstate = listingVertical === 'real_estate';
  const showPlotPolygonTools =
    isRealEstate && shouldShowPlotAndBoundary(propertyType, hasAssociatedPlot);

  const [pickMode, setPickMode] = useState<PickMode>('pin');
  const [cameraCenter, setCameraCenter] = useState<LatLngPoint>(coordinates);
  const [cameraZoom, setCameraZoom] = useState<number>(16);
  const [panRequest, setPanRequest] = useState<{
    center: LatLngPoint;
    zoom: number;
    seq: number;
  } | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [geoNotice, setGeoNotice] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);
  const [showManualInputs, setShowManualInputs] = useState(false);

  const safeCoords = useMemo<LatLngPoint>(() => {
    const lat = Number.isFinite(coordinates.lat) ? coordinates.lat : 24.3335;
    const lng = Number.isFinite(coordinates.lng) ? coordinates.lng : 93.6978;
    return {
      lat: Number(lat.toFixed(6)),
      lng: Number(lng.toFixed(6)),
    };
  }, [coordinates.lat, coordinates.lng]);

  const resolvedCloudConfig = useMemo(
    () =>
      resolveCloudMapConfiguration({
        mapStyle,
        mapAppearance,
        configuredMapId,
        configuredLightMapId,
        configuredDarkMapId,
      }),
    [
      mapStyle,
      mapAppearance,
      configuredMapId,
      configuredLightMapId,
      configuredDarkMapId,
    ]
  );

  const polygonMetrics = useMemo(() => {
    if (!showPlotPolygonTools || boundaryPolygon.length < 3) {
      return { areaSqm: 0, perimeterMeters: 0, isValid: false };
    }
    return calculatePolygonMetrics(boundaryPolygon);
  }, [showPlotPolygonTools, boundaryPolygon]);

  const emitPolygonUpdate = (nextPoly: LatLngPoint[]) => {
    if (!onChangeBoundaryPolygon) return;
    if (nextPoly.length >= 3) {
      const m = calculatePolygonMetrics(nextPoly);
      const areaSqm = m.isValid ? Number(m.areaSqm.toFixed(2)) : 0;
      const areaSqft = areaSqm > 0 ? Math.round(areaSqm * 10.7639104) : 0;
      onChangeBoundaryPolygon(nextPoly, areaSqm, areaSqft);
    } else {
      onChangeBoundaryPolygon(nextPoly, 0, 0);
    }
  };

  const panMapTo = (target: LatLngPoint, zoom = 16) => {
    const clean: LatLngPoint = {
      lat: Number(target.lat.toFixed(6)),
      lng: Number(target.lng.toFixed(6)),
    };
    setCameraCenter(clean);
    setCameraZoom(zoom);
    setPanRequest({
      center: clean,
      zoom,
      seq: Date.now() + Math.random(),
    });
  };

  const handleUseCurrentGps = () => {
    setGeoNotice(null);
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      setGeoNotice({
        type: 'err',
        text: 'GPS geolocation is not supported in this browser.',
      });
      return;
    }
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const next: LatLngPoint = {
          lat: Number(pos.coords.latitude.toFixed(6)),
          lng: Number(pos.coords.longitude.toFixed(6)),
        };
        onChangeCoordinates(next);
        panMapTo(next, 17);
        setIsLocating(false);
        setGeoNotice({
          type: 'ok',
          text: `GPS pin locked at ${next.lat.toFixed(5)}, ${next.lng.toFixed(5)}.`,
        });
      },
      (err) => {
        setIsLocating(false);
        setGeoNotice({
          type: 'err',
          text:
            err.code === 1
              ? 'Location permission denied. Tap the map or drag the pin manually.'
              : err.message || 'Unable to acquire GPS fix. Place the pin manually.',
        });
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 30000 }
    );
  };

  const handleCenterOnHubOrLocality = () => {
    const target = localityCenter || hubCenter;
    if (!target) return;
    panMapTo(target, localityCenter ? 15 : 14);
    onChangeCoordinates({
      lat: Number(target.lat.toFixed(6)),
      lng: Number(target.lng.toFixed(6)),
    });
    setGeoNotice({
      type: 'ok',
      text: `Centered on ${
        localityCenter && localityLabel
          ? localityLabel
          : hubLabel || 'selected hub'
      }. Fine-tune the pin by tapping or dragging.`,
    });
  };

  const handleMapTap = (pt: LatLngPoint) => {
    const clean: LatLngPoint = {
      lat: Number(pt.lat.toFixed(6)),
      lng: Number(pt.lng.toFixed(6)),
    };
    if (pickMode === 'polygon' && showPlotPolygonTools) {
      emitPolygonUpdate([...boundaryPolygon, clean]);
      return;
    }
    if (pickMode === 'pin') {
      onChangeCoordinates(clean);
    }
  };

  const handleCreateStarterPlotBox = () => {
    const dLat = 0.00018;
    const dLng = 0.0002;
    const starter: LatLngPoint[] = [
      {
        lat: Number((safeCoords.lat + dLat).toFixed(6)),
        lng: Number((safeCoords.lng - dLng).toFixed(6)),
      },
      {
        lat: Number((safeCoords.lat + dLat).toFixed(6)),
        lng: Number((safeCoords.lng + dLng).toFixed(6)),
      },
      {
        lat: Number((safeCoords.lat - dLat).toFixed(6)),
        lng: Number((safeCoords.lng + dLng).toFixed(6)),
      },
      {
        lat: Number((safeCoords.lat - dLat).toFixed(6)),
        lng: Number((safeCoords.lng - dLng).toFixed(6)),
      },
    ];
    emitPolygonUpdate(starter);
    panMapTo(safeCoords, 18);
  };

  const vectorShapes = useMemo<DrawnShape[]>(() => {
    const shapes: DrawnShape[] = [
      {
        id: 'editor-active-pin',
        type: 'point',
        label: 'Listing Pin',
        coordinates: [safeCoords],
        createdAt: '',
      },
    ];
    if (showPlotPolygonTools && boundaryPolygon.length >= 3) {
      shapes.push({
        id: 'editor-plot-poly',
        type: 'polygon',
        label: 'Plot Boundary',
        coordinates: boundaryPolygon,
        areaSqm: polygonMetrics.areaSqm,
        perimeterMeters: polygonMetrics.perimeterMeters,
        createdAt: '',
      });
    }
    return shapes;
  }, [
    safeCoords,
    showPlotPolygonTools,
    boundaryPolygon,
    polygonMetrics.areaSqm,
    polygonMetrics.perimeterMeters,
  ]);

  return (
    <div
      className={`rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] overflow-hidden ${className}`}
    >
      {/* Top Toolbar */}
      <div className="px-3.5 py-2.5 bg-[var(--ps-bg)] border-b border-[var(--ps-border)] flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setPickMode('pin')}
            className={`min-h-[36px] inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
              pickMode === 'pin'
                ? 'bg-[var(--btn-primary-bg)] text-[var(--btn-primary-fg)]'
                : 'bg-[var(--ps-surface)] text-[var(--ps-text-muted)] border border-[var(--ps-border)] hover:text-[var(--ps-text)]'
            }`}
          >
            <MapPin className="w-3.5 h-3.5" />
            Tap / Drag Pin
          </button>

          <button
            type="button"
            onClick={() => setPickMode('crosshair')}
            className={`min-h-[36px] inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
              pickMode === 'crosshair'
                ? 'bg-[var(--btn-primary-bg)] text-[var(--btn-primary-fg)]'
                : 'bg-[var(--ps-surface)] text-[var(--ps-text-muted)] border border-[var(--ps-border)] hover:text-[var(--ps-text)]'
            }`}
          >
            <Crosshair className="w-3.5 h-3.5" />
            Crosshair
          </button>

          {showPlotPolygonTools && onChangeBoundaryPolygon && (
            <button
              type="button"
              onClick={() => setPickMode('polygon')}
              className={`min-h-[36px] inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                pickMode === 'polygon'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-[var(--ps-surface)] text-emerald-600 dark:text-emerald-400 border border-[var(--ps-border)] hover:opacity-90'
              }`}
            >
              <PenTool className="w-3.5 h-3.5" />
              Draw Plot ({boundaryPolygon.length})
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={handleUseCurrentGps}
            disabled={isLocating}
            className="min-h-[36px] inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-[var(--ps-surface)] border border-[var(--ps-border)] text-[var(--ps-text)] hover:border-[var(--ps-accent)] transition-colors cursor-pointer disabled:opacity-60"
          >
            {isLocating ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Navigation className="w-3.5 h-3.5 text-sky-500" />
            )}
            Use GPS
          </button>

          {(localityCenter || hubCenter) && (
            <button
              type="button"
              onClick={handleCenterOnHubOrLocality}
              className="min-h-[36px] inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-[var(--ps-surface)] border border-[var(--ps-border)] text-[var(--ps-text)] hover:border-[var(--ps-accent)] transition-colors cursor-pointer"
            >
              <Compass className="w-3.5 h-3.5 text-amber-500" />
              Center on {localityCenter && localityLabel ? localityLabel : hubLabel || 'Hub'}
            </button>
          )}
        </div>
      </div>

      {/* Mode Hint Banner */}
      <div className="px-3.5 py-1.5 bg-[var(--ps-surface-alt)] border-b border-[var(--ps-border)] flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--ps-text-muted)]">
        <span>
          {pickMode === 'pin' &&
            'Tap anywhere on the map or drag the pin to place the exact entrance / spot.'}
          {pickMode === 'crosshair' &&
            'Pan & zoom the map under the crosshair, then tap "Lock Crosshair" or watch coordinates update.'}
          {pickMode === 'polygon' &&
            'Tap corners around the plot on the map to trace its boundary (minimum 3 points auto-computes m² and ft²).'}
        </span>
        {pickMode === 'crosshair' && (
          <button
            type="button"
            onClick={() => {
              onChangeCoordinates(cameraCenter);
              setGeoNotice({
                type: 'ok',
                text: `Pin snapped to crosshair (${cameraCenter.lat.toFixed(5)}, ${cameraCenter.lng.toFixed(5)}).`,
              });
            }}
            className="px-2.5 py-1 rounded-md bg-[var(--btn-primary-bg)] text-[var(--btn-primary-fg)] font-semibold text-[11px] cursor-pointer"
          >
            Lock Crosshair
          </button>
        )}
      </div>

      {/* Interactive Map Canvas */}
      <div
        className="relative h-[240px] sm:h-[280px] w-full"
        style={{ backgroundColor: resolvedCloudConfig.backgroundColor }}
      >
        {apiKeyAvailable && !useVectorStylePreview ? (
          <GoogleMap
            key={`coord-picker-gmap-${resolvedCloudConfig.mapId}-${resolvedCloudConfig.colorScheme}`}
            id="listing-editor-coordinate-map"
            mapId={resolvedCloudConfig.mapId}
            defaultCenter={safeCoords}
            defaultZoom={cameraZoom}
            mapTypeId={resolvedCloudConfig.mapTypeId}
            colorScheme={resolvedCloudConfig.colorScheme}
            backgroundColor={resolvedCloudConfig.backgroundColor}
            gestureHandling="greedy"
            disableDefaultUI={true}
            zoomControl={true}
            clickableIcons={false}
            keyboardShortcuts={true}
            controlSize={28}
            internalUsageAttributionIds={[
              'gmp_mcp_codeassist_v1_aistudio',
              'gmp_git_agentskills_v1',
            ]}
            onClick={(ev) => {
              const latLng = ev.detail?.latLng;
              if (latLng) {
                handleMapTap({ lat: latLng.lat, lng: latLng.lng });
              }
            }}
            onCameraChanged={(ev) => {
              if (ev.detail.center) {
                const nextCenter = {
                  lat: Number(ev.detail.center.lat.toFixed(6)),
                  lng: Number(ev.detail.center.lng.toFixed(6)),
                };
                setCameraCenter(nextCenter);
                if (pickMode === 'crosshair') {
                  onChangeCoordinates(nextCenter);
                }
              }
              if (typeof ev.detail.zoom === 'number') {
                setCameraZoom(
                  Math.min(20, Math.max(3, Math.round(ev.detail.zoom)))
                );
              }
            }}
            className="w-full h-full"
          >
            <MapCameraSyncController
              panRequest={panRequest}
              polygonPoints={boundaryPolygon}
              showPolygon={showPlotPolygonTools}
            />

            {/* Primary Draggable Listing Pin */}
            <AdvancedMarker
              position={safeCoords}
              draggable={pickMode === 'pin'}
              zIndex={1000}
              title="Listing Location (Drag to adjust)"
              onDragEnd={(ev) => {
                const pos = ev.latLng;
                if (pos) {
                  onChangeCoordinates({
                    lat: Number(pos.lat().toFixed(6)),
                    lng: Number(pos.lng().toFixed(6)),
                  });
                }
              }}
            >
              <Pin
                background={isRealEstate ? '#059669' : '#0284c7'}
                borderColor="#ffffff"
                glyphColor="#ffffff"
                scale={1.2}
              />
            </AdvancedMarker>

            {/* Draggable Plot Polygon Vertices */}
            {showPlotPolygonTools &&
              boundaryPolygon.map((pt, idx) => (
                <AdvancedMarker
                  key={`vertex-${idx}`}
                  position={pt}
                  draggable={pickMode === 'polygon'}
                  zIndex={900 + idx}
                  onDragEnd={(ev) => {
                    const pos = ev.latLng;
                    if (!pos) return;
                    const updated = boundaryPolygon.map((old, i) =>
                      i === idx
                        ? {
                            lat: Number(pos.lat().toFixed(6)),
                            lng: Number(pos.lng().toFixed(6)),
                          }
                        : old
                    );
                    emitPolygonUpdate(updated);
                  }}
                >
                  <div className="w-5 h-5 rounded-full bg-emerald-600 text-white border-2 border-white shadow flex items-center justify-center text-[9px] font-bold">
                    {idx + 1}
                  </div>
                </AdvancedMarker>
              ))}
          </GoogleMap>
        ) : (
          <InteractiveVectorMap
            listings={[]}
            selectedListing={null}
            onSelectListing={() => {}}
            mapStyle={mapStyle}
            mapAppearance={resolvedCloudConfig.variant}
            center={cameraCenter}
            zoom={cameraZoom}
            defaultCenter={safeCoords}
            drawnShapes={vectorShapes}
            inProgressPoints={
              pickMode === 'polygon' && showPlotPolygonTools
                ? boundaryPolygon
                : []
            }
            onMapClickLatLng={handleMapTap}
            onCameraChange={(nextCenter, nextZoom) => {
              const cleanCenter = {
                lat: Number(nextCenter.lat.toFixed(6)),
                lng: Number(nextCenter.lng.toFixed(6)),
              };
              setCameraCenter(cleanCenter);
              setCameraZoom(Math.min(20, Math.max(3, Math.round(nextZoom))));
              if (pickMode === 'crosshair') {
                onChangeCoordinates(cleanCenter);
              }
            }}
          />
        )}

        {/* Crosshair Overlay in Crosshair Mode */}
        {pickMode === 'crosshair' && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center"
          >
            <div className="relative flex items-center justify-center">
              <div className="h-11 w-11 rounded-full border-2 border-[var(--ps-accent)] bg-sky-500/10 shadow-sm flex items-center justify-center">
                <Crosshair className="w-5 h-5 text-[var(--ps-accent)]" />
              </div>
              <span className="absolute h-2 w-2 rounded-full bg-rose-500 ring-2 ring-white" />
            </div>
          </div>
        )}
      </div>

      {/* Polygon Action Bar + Real Estate Privacy Toggle */}
      {isRealEstate && (
        <div className="px-3.5 py-2.5 bg-[var(--ps-surface-alt)] border-t border-[var(--ps-border)] space-y-2.5">
          {showPlotPolygonTools && onChangeBoundaryPolygon && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-xs text-[var(--ps-text)]">
                <span className="font-semibold">Plot Boundary: </span>
                {polygonMetrics.isValid ? (
                  <span className="font-mono text-emerald-600 dark:text-emerald-400 font-semibold">
                    {formatArea(polygonMetrics.areaSqm, 'sqm')} ·{' '}
                    {formatArea(polygonMetrics.areaSqm, 'sqft')} ·{' '}
                    {formatLinearDistance(polygonMetrics.perimeterMeters, 'm')} perimeter
                  </span>
                ) : (
                  <span className="text-[var(--ps-text-muted)]">
                    {boundaryPolygon.length === 0
                      ? 'Optional — draw corners on map or create a starter box.'
                      : `${boundaryPolygon.length}/3 points placed (need ${3 - boundaryPolygon.length} more).`}
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                {boundaryPolygon.length === 0 && (
                  <button
                    type="button"
                    onClick={handleCreateStarterPlotBox}
                    className="px-2.5 py-1 rounded-lg bg-[var(--ps-surface)] border border-[var(--ps-border)] text-[11px] font-semibold text-[var(--ps-text)] hover:border-emerald-500 cursor-pointer"
                  >
                    + Starter 4-Corner Box
                  </button>
                )}
                {boundaryPolygon.length > 0 && (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        emitPolygonUpdate(boundaryPolygon.slice(0, -1))
                      }
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[var(--ps-surface)] border border-[var(--ps-border)] text-[11px] text-[var(--ps-text)] cursor-pointer"
                    >
                      <RotateCcw className="w-3 h-3" /> Undo Point
                    </button>
                    <button
                      type="button"
                      onClick={() => emitPolygonUpdate([])}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-rose-500/10 border border-rose-500/30 text-[11px] text-rose-500 cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" /> Clear
                    </button>
                  </>
                )}
              </div>
            </div>
          )}

          {onChangeShowExactPin && (
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-[var(--ps-border)]/60">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-[var(--ps-text)]">
                  Exact Property Pin Privacy
                </p>
                <p className="text-[11px] text-[var(--ps-text-muted)]">
                  {showExactPin
                    ? 'Exact coordinates & plot outline are visible on Explore map.'
                    : 'Shown as an approximate ±150m locality pin publicly until enquiry.'}
                </p>
              </div>
              <button
                type="button"
                onClick={() => onChangeShowExactPin(!showExactPin)}
                className={`min-h-[36px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors cursor-pointer ${
                  showExactPin
                    ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-600 dark:text-emerald-300'
                    : 'bg-[var(--ps-surface)] border-[var(--ps-border)] text-[var(--ps-text-muted)]'
                }`}
              >
                {showExactPin ? (
                  <>
                    <Eye className="w-3.5 h-3.5" /> Exact Pin Public
                  </>
                ) : (
                  <>
                    <EyeOff className="w-3.5 h-3.5" /> Approx Locality Only
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Status + Coordinates Readout + Collapsible Manual Inputs */}
      <div className="px-3.5 py-2.5 bg-[var(--ps-bg)] border-t border-[var(--ps-border)] space-y-2">
        {geoNotice && (
          <div
            className={`text-[11px] px-2.5 py-1.5 rounded-lg border ${
              geoNotice.type === 'ok'
                ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-600 dark:text-emerald-300'
                : 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-300'
            }`}
          >
            {geoNotice.text}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs">
            <MapPin className="w-3.5 h-3.5 text-[var(--ps-accent)] shrink-0" />
            <span className="font-mono font-semibold text-[var(--ps-text)]">
              {safeCoords.lat.toFixed(6)}, {safeCoords.lng.toFixed(6)}
            </span>
          </div>
          <button
            type="button"
            onClick={() => setShowManualInputs((p) => !p)}
            className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
          >
            <span>Manual Lat/Lng</span>
            {showManualInputs ? (
              <ChevronUp className="w-3.5 h-3.5" />
            ) : (
              <ChevronDown className="w-3.5 h-3.5" />
            )}
          </button>
        </div>

        {showManualInputs && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-1">
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--ps-text-muted)] mb-1">
                Latitude
              </label>
              <input
                type="number"
                step="0.000001"
                value={safeCoords.lat}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  if (Number.isFinite(val)) {
                    const next = { lat: val, lng: safeCoords.lng };
                    onChangeCoordinates(next);
                    panMapTo(next, cameraZoom);
                  }
                }}
                className="w-full px-3 py-2 rounded-lg bg-[var(--ps-surface)] border border-[var(--ps-border)] text-xs font-mono text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-accent)]"
              />
            </div>
            <div>
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--ps-text-muted)] mb-1">
                Longitude
              </label>
              <input
                type="number"
                step="0.000001"
                value={safeCoords.lng}
                onChange={(e) => {
                  const val = parseFloat(e.target.value);
                  if (Number.isFinite(val)) {
                    const next = { lat: safeCoords.lat, lng: val };
                    onChangeCoordinates(next);
                    panMapTo(next, cameraZoom);
                  }
                }}
                className="w-full px-3 py-2 rounded-lg bg-[var(--ps-surface)] border border-[var(--ps-border)] text-xs font-mono text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-accent)]"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
