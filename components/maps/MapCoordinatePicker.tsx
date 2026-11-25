'use client';

import React, {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { createPortal } from 'react-dom';
import {
  Map as GoogleMap,
  useMap,
} from '@vis.gl/react-google-maps';
import {
  TerraDraw,
  TerraDrawPolygonMode,
  TerraDrawSelectMode,
} from 'terra-draw';
import { TerraDrawGoogleMapsAdapter } from 'terra-draw-google-maps-adapter';
import {
  Check,
  ChevronDown,
  ChevronUp,
  Compass,
  Copy,
  Crosshair,
  Eye,
  EyeOff,
  Loader2,
  MapPin,
  Maximize2,
  Minimize2,
  MousePointerClick,
  Navigation,
  PenTool,
  RotateCcw,
  Trash2,
  X,
} from 'lucide-react';
import { InteractiveVectorMap } from '@/components/shared/InteractiveVectorMap';
import { useAppConfig } from '@/components/providers/AppConfigProvider';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import {
  CHURACHANDPUR_FALLBACK_CENTER,
  HIGH_ACCURACY_GPS_OPTIONS,
  computePolygonGeometry,
  copyTextToClipboard,
  formatCoordinates,
  normalizeLatLng,
  roundCoord,
  validateLatLngStrings,
} from '@/lib/maps/coordinates';
import { resolveCloudMapConfiguration } from '@/lib/map-cloud-styles';
import { useMapsAvailability } from '@/lib/maps-context';
import {
  formatArea,
  formatLinearDistance,
  shouldShowPlotAndBoundary,
} from '@/lib/rules';
import { useAppStore } from '@/lib/store';
import type { DrawnShape, LatLngPoint, PropertyType } from '@/lib/types';
import type { ListingVertical } from '@/lib/verticals/types';

export type MapCoordinatePickerMode = 'point' | 'polygon';

export interface QuickLocalityOption {
  id: string;
  label: string;
  lat: number;
  lng: number;
  zoom?: number;
}

export interface MapCoordinatePickerProps {
  mode?: MapCoordinatePickerMode;
  coordinates: LatLngPoint;
  onChangeCoordinates: (next: LatLngPoint) => void;
  zoom?: number;
  onChangeZoom?: (nextZoom: number) => void;
  showZoomControl?: boolean;
  quickLocalities?: QuickLocalityOption[];
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
  submitAttempted?: boolean;
  allowExpand?: boolean;
  label?: string;
  helperText?: string;
  className?: string;
}

const emptySubscribe = () => () => {};

function arePolygonsEqual(a: LatLngPoint[], b: LatLngPoint[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (
      Math.abs(a[i].lat - b[i].lat) > 1e-6 ||
      Math.abs(a[i].lng - b[i].lng) > 1e-6
    ) {
      return false;
    }
  }
  return true;
}

interface TerraDrawControllerProps {
  mapInstanceId: string;
  panRequest: { center: LatLngPoint; zoom?: number; seq: number } | null;
  polygonEnabled: boolean;
  polygonTool: 'draw' | 'select';
  boundaryPolygon: LatLngPoint[];
  onPolygonChangeFromDraw: (nextPolygon: LatLngPoint[]) => void;
  onMapIdleCenter: (center: LatLngPoint, zoom: number) => void;
  onMapReady?: (map: google.maps.Map | null) => void;
}

function MapInstanceController({
  mapInstanceId,
  panRequest,
  polygonEnabled,
  polygonTool,
  boundaryPolygon,
  onPolygonChangeFromDraw,
  onMapIdleCenter,
  onMapReady,
}: TerraDrawControllerProps) {
  const map = useMap(mapInstanceId);
  const lastSeqRef = useRef<number>(0);
  const drawRef = useRef<TerraDraw | null>(null);
  const isReadyRef = useRef<boolean>(false);
  const internalSyncRef = useRef<boolean>(false);
  const onPolygonChangeRef = useRef(onPolygonChangeFromDraw);
  const onMapIdleRef = useRef(onMapIdleCenter);
  const boundaryRef = useRef<LatLngPoint[]>(boundaryPolygon);

  useEffect(() => {
    onPolygonChangeRef.current = onPolygonChangeFromDraw;
  }, [onPolygonChangeFromDraw]);

  useEffect(() => {
    onMapIdleRef.current = onMapIdleCenter;
  }, [onMapIdleCenter]);

  useEffect(() => {
    boundaryRef.current = boundaryPolygon;
  }, [boundaryPolygon]);

  useEffect(() => {
    onMapReady?.(map ?? null);
    return () => {
      onMapReady?.(null);
    };
  }, [map, onMapReady]);

  // Programmatic pan/zoom sync
  useEffect(() => {
    if (!map || !panRequest || panRequest.seq === lastSeqRef.current) return;
    lastSeqRef.current = panRequest.seq;
    map.panTo(panRequest.center);
    if (typeof panRequest.zoom === 'number' && Number.isFinite(panRequest.zoom)) {
      map.setZoom(Math.min(20, Math.max(3, Math.round(panRequest.zoom))));
    }
  }, [map, panRequest]);

  // Commit exact center coordinates strictly on idle
  useEffect(() => {
    if (!map) return;
    const listener = map.addListener('idle', () => {
      const center = map.getCenter();
      const zoom = map.getZoom();
      if (!center) return;
      onMapIdleRef.current(
        {
          lat: roundCoord(center.lat(), 6),
          lng: roundCoord(center.lng(), 6),
        },
        typeof zoom === 'number' ? Math.min(20, Math.max(3, Math.round(zoom))) : 16
      );
    });
    return () => {
      listener.remove();
    };
  }, [map]);

  // Sync TerraDraw polygon instance when polygon mode is active
  const hydrateDrawFromPolygon = useCallback(
    (draw: TerraDraw, points: LatLngPoint[]) => {
      internalSyncRef.current = true;
      try {
        draw.clear();
        if (points.length >= 3) {
          const ring: [number, number][] = points.map((p) => [
            roundCoord(p.lng, 6),
            roundCoord(p.lat, 6),
          ]);
          const first = ring[0];
          const last = ring[ring.length - 1];
          if (first[0] !== last[0] || first[1] !== last[1]) {
            ring.push([first[0], first[1]]);
          }
          draw.addFeatures([
            {
              type: 'Feature',
              properties: { mode: 'polygon' },
              geometry: {
                type: 'Polygon',
                coordinates: [ring],
              },
            },
          ]);
        }
      } catch {
        // Ignore transient geometry errors during external clear/re-seed
      } finally {
        window.setTimeout(() => {
          internalSyncRef.current = false;
        }, 40);
      }
    },
    []
  );

  useEffect(() => {
    if (!map || !polygonEnabled) return;
    if (typeof google === 'undefined' || !google.maps) return;

    let disposed = false;
    isReadyRef.current = false;

    const adapter = new TerraDrawGoogleMapsAdapter({
      lib: google.maps,
      map,
      coordinatePrecision: 6,
    });

    const draw = new TerraDraw({
      adapter,
      modes: [
        new TerraDrawPolygonMode({
          styles: {
            fillColor: '#10b981',
            fillOpacity: 0.24,
            outlineColor: '#059669',
            outlineWidth: 2.5,
            closingPointColor: '#059669',
            closingPointWidth: 5,
            closingPointOutlineColor: '#ffffff',
            closingPointOutlineWidth: 2,
          },
        }),
        new TerraDrawSelectMode({
          flags: {
            polygon: {
              feature: {
                draggable: true,
                coordinates: {
                  midpoints: true,
                  draggable: true,
                  deletable: true,
                },
              },
            },
          },
          styles: {
            selectedPolygonColor: '#10b981',
            selectedPolygonFillOpacity: 0.28,
            selectedPolygonOutlineColor: '#047857',
            selectedPolygonOutlineWidth: 3,
            selectionPointColor: '#059669',
            selectionPointWidth: 6,
            selectionPointOutlineColor: '#ffffff',
            selectionPointOutlineWidth: 2,
            midPointColor: '#34d399',
            midPointOutlineColor: '#ffffff',
            midPointWidth: 4,
            midPointOutlineWidth: 1.5,
          },
        }),
      ],
    });

    drawRef.current = draw;

    const extractLatestPolygon = (): LatLngPoint[] | null => {
      const snapshot = draw.getSnapshot();
      const polys = snapshot.filter(
        (f) => f.geometry.type === 'Polygon' && !f.properties?.currentlyDrawing
      );
      if (polys.length === 0) return [];
      const latest = polys[polys.length - 1];
      if (latest.geometry.type !== 'Polygon') return null;
      const ring = latest.geometry.coordinates?.[0];
      if (!Array.isArray(ring) || ring.length < 4) return null;
      const vertices: LatLngPoint[] = [];
      for (let i = 0; i < ring.length - 1; i += 1) {
        const [lng, lat] = ring[i];
        if (Number.isFinite(lat) && Number.isFinite(lng)) {
          vertices.push({ lat: roundCoord(lat, 6), lng: roundCoord(lng, 6) });
        }
      }
      return vertices.length >= 3 ? vertices : null;
    };

    const syncDrawToParent = () => {
      if (disposed || internalSyncRef.current) return;
      const next = extractLatestPolygon();
      if (next === null) return;
      if (!arePolygonsEqual(next, boundaryRef.current)) {
        onPolygonChangeRef.current(next);
      }
    };

    draw.on('ready', () => {
      if (disposed) return;
      isReadyRef.current = true;
      const initialPts = boundaryRef.current;
      if (initialPts.length >= 3) {
        hydrateDrawFromPolygon(draw, initialPts);
        draw.setMode(polygonTool === 'select' ? 'select' : 'polygon');
      } else {
        draw.setMode('polygon');
      }
    });

    draw.on('finish', (finishedId) => {
      if (disposed || internalSyncRef.current) return;
      // Keep only the most recent drawn land boundary so plot area stays unambiguous
      try {
        const snap = draw.getSnapshot();
        const extraIds = snap
          .filter(
            (f) =>
              f.geometry.type === 'Polygon' &&
              String(f.id) !== String(finishedId)
          )
          .map((f) => f.id)
          .filter((id): id is string | number => id !== undefined);
        if (extraIds.length > 0) {
          internalSyncRef.current = true;
          draw.removeFeatures(extraIds);
          internalSyncRef.current = false;
        }
      } catch {
        // Ignore cleanup errors
      }
      syncDrawToParent();
    });

    draw.on('change', (_ids, type) => {
      if (disposed || internalSyncRef.current) return;
      if (type === 'update' || type === 'delete') {
        syncDrawToParent();
      }
    });

    draw.start();

    return () => {
      disposed = true;
      isReadyRef.current = false;
      try {
        draw.stop();
      } catch {
        // Safe unmount cleanup
      }
      if (drawRef.current === draw) {
        drawRef.current = null;
      }
    };
  }, [map, polygonEnabled, hydrateDrawFromPolygon]);

  // Switch active TerraDraw mode when toolbar changes
  useEffect(() => {
    const draw = drawRef.current;
    if (!draw || !isReadyRef.current || !polygonEnabled) return;
    try {
      draw.setMode(polygonTool === 'select' ? 'select' : 'polygon');
    } catch {
      // Ignore if TerraDraw is reinitializing
    }
  }, [polygonTool, polygonEnabled]);

  // Re-hydrate TerraDraw when parent polygon changes externally (Undo / Clear / Starter Box)
  useEffect(() => {
    const draw = drawRef.current;
    if (!draw || !isReadyRef.current || !polygonEnabled) return;
    try {
      const snap = draw.getSnapshot().filter(
        (f) => f.geometry.type === 'Polygon' && !f.properties?.currentlyDrawing
      );
      const currentPts: LatLngPoint[] = [];
      const latestFeature = snap[snap.length - 1];
      if (latestFeature && latestFeature.geometry.type === 'Polygon') {
        const ring = latestFeature.geometry.coordinates[0] || [];
        for (let i = 0; i < ring.length - 1; i += 1) {
          currentPts.push({
            lat: roundCoord(ring[i][1], 6),
            lng: roundCoord(ring[i][0], 6),
          });
        }
      }
      if (!arePolygonsEqual(currentPts, boundaryPolygon)) {
        hydrateDrawFromPolygon(draw, boundaryPolygon);
      }
    } catch {
      // Ignore transient snapshot state
    }
  }, [boundaryPolygon, polygonEnabled, hydrateDrawFromPolygon]);

  // Render static non-editable polygon preview when in point mode with an existing plot boundary
  useEffect(() => {
    if (!map || polygonEnabled || boundaryPolygon.length < 3) return;
    if (typeof google === 'undefined' || !google.maps) return;

    const preview = new google.maps.Polygon({
      paths: boundaryPolygon,
      strokeColor: '#059669',
      strokeOpacity: 0.9,
      strokeWeight: 2,
      fillColor: '#10b981',
      fillOpacity: 0.16,
      clickable: false,
      map,
    });

    return () => {
      preview.setMap(null);
    };
  }, [map, polygonEnabled, boundaryPolygon]);

  return null;
}

export function MapCoordinatePicker({
  mode = 'point',
  coordinates,
  onChangeCoordinates,
  zoom,
  onChangeZoom,
  showZoomControl = false,
  quickLocalities,
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
  submitAttempted = false,
  allowExpand = true,
  label,
  helperText,
  className = '',
}: MapCoordinatePickerProps) {
  const reactId = useId().replace(/:/g, '');
  const compactMapId = `dd-coord-picker-compact-${reactId}`;
  const expandedMapId = `dd-coord-picker-expanded-${reactId}`;

  const mounted = useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false
  );

  const {
    mapStyle,
    mapAppearance,
    configuredMapId,
    configuredLightMapId,
    configuredDarkMapId,
    useVectorStylePreview,
  } = useAppStore();
  const { apiKeyAvailable } = useMapsAvailability();
  const { activeHub, hubLocalities } = useAppConfig();

  const isRealEstate = listingVertical === 'real_estate';
  const supportsPolygon =
    Boolean(onChangeBoundaryPolygon) &&
    (mode === 'polygon' ||
      (isRealEstate && shouldShowPlotAndBoundary(propertyType, hasAssociatedPlot)));

  const safeCoords = useMemo<LatLngPoint>(
    () => normalizeLatLng(coordinates, CHURACHANDPUR_FALLBACK_CENTER),
    [coordinates.lat, coordinates.lng]
  );

  const [activeMode, setActiveMode] = useState<MapCoordinatePickerMode>(
    mode === 'polygon' && supportsPolygon ? 'polygon' : 'point'
  );
  const [polygonTool, setPolygonTool] = useState<'draw' | 'select'>(
    boundaryPolygon.length >= 3 ? 'select' : 'draw'
  );
  const [liveCenter, setLiveCenter] = useState<LatLngPoint>(safeCoords);
  const [isPanning, setIsPanning] = useState(false);
  const [cameraZoom, setCameraZoom] = useState<number>(
    typeof zoom === 'number' && Number.isFinite(zoom)
      ? Math.min(20, Math.max(3, Math.round(zoom)))
      : 16
  );
  const [panRequest, setPanRequest] = useState<{
    center: LatLngPoint;
    zoom?: number;
    seq: number;
  } | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [geoNotice, setGeoNotice] = useState<{
    type: 'ok' | 'err';
    text: string;
  } | null>(null);
  const [copiedCoords, setCopiedCoords] = useState(false);
  const [showManualInputs, setShowManualInputs] = useState(false);
  const [isExpanded, setIsExpanded] = useState(false);
  const [confirmClearOpen, setConfirmClearOpen] = useState(false);

  // Polygon undo history
  const [polygonHistory, setPolygonHistory] = useState<LatLngPoint[][]>([]);

  // Controlled text inputs for manual editing (validated strictly on touch/blur/submit)
  const [latDraft, setLatDraft] = useState<string>(safeCoords.lat.toFixed(6));
  const [lngDraft, setLngDraft] = useState<string>(safeCoords.lng.toFixed(6));
  const [zoomDraft, setZoomDraft] = useState<string>(String(cameraZoom));
  const [touchedFields, setTouchedFields] = useState<{
    lat: boolean;
    lng: boolean;
    zoom: boolean;
  }>({ lat: false, lng: false, zoom: false });

  // Sync external coordinates changes when user is not actively typing invalid drafts
  const lastCommittedCoordsRef = useRef<LatLngPoint>(safeCoords);
  useEffect(() => {
    const prev = lastCommittedCoordsRef.current;
    if (
      Math.abs(prev.lat - safeCoords.lat) > 1e-6 ||
      Math.abs(prev.lng - safeCoords.lng) > 1e-6
    ) {
      lastCommittedCoordsRef.current = safeCoords;
      let cancelled = false;
      queueMicrotask(() => {
        if (cancelled) return;
        setLiveCenter(safeCoords);
        setLatDraft(safeCoords.lat.toFixed(6));
        setLngDraft(safeCoords.lng.toFixed(6));
      });
      return () => {
        cancelled = true;
      };
    }
  }, [safeCoords]);

  useEffect(() => {
    if (typeof zoom === 'number' && Number.isFinite(zoom)) {
      const clamped = Math.min(20, Math.max(3, Math.round(zoom)));
      let cancelled = false;
      queueMicrotask(() => {
        if (cancelled) return;
        setCameraZoom(clamped);
        setZoomDraft(String(clamped));
      });
      return () => {
        cancelled = true;
      };
    }
  }, [zoom]);

  useEffect(() => {
    if (!isExpanded) return;
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsExpanded(false);
      }
    };
    window.addEventListener('keydown', handleEsc);
    return () => window.removeEventListener('keydown', handleEsc);
  }, [isExpanded]);

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

  // Merge quick-jump localities from explicit prop + hub/locality + AppConfig
  const localityOptions = useMemo<QuickLocalityOption[]>(() => {
    const list: QuickLocalityOption[] = [];
    const seen = new Set<string>();
    const addOpt = (opt: QuickLocalityOption) => {
      if (!Number.isFinite(opt.lat) || !Number.isFinite(opt.lng)) return;
      const key = `${opt.label.toLowerCase()}:${opt.lat.toFixed(4)},${opt.lng.toFixed(4)}`;
      if (seen.has(key)) return;
      seen.add(key);
      list.push(opt);
    };

    if (localityCenter) {
      addOpt({
        id: 'selected-locality',
        label: localityLabel || 'Selected Locality',
        lat: localityCenter.lat,
        lng: localityCenter.lng,
        zoom: 16,
      });
    }
    if (hubCenter) {
      addOpt({
        id: 'selected-hub',
        label: hubLabel || activeHub?.name || 'Service Hub',
        lat: hubCenter.lat,
        lng: hubCenter.lng,
        zoom: 14,
      });
    }
    if (Array.isArray(quickLocalities)) {
      for (const item of quickLocalities) {
        addOpt(item);
      }
    }
    if (Array.isArray(hubLocalities)) {
      for (const loc of hubLocalities) {
        if (
          loc.is_active !== false &&
          typeof loc.lat === 'number' &&
          typeof loc.lng === 'number'
        ) {
          addOpt({
            id: loc.id,
            label: loc.display_name,
            lat: loc.lat,
            lng: loc.lng,
            zoom: 16,
          });
        }
      }
    }
    // Always ensure Churachandpur town center is available as a reliable quick-jump
    addOpt({
      id: 'fallback-lamka',
      label: 'Churachandpur (Lamka Center)',
      lat: CHURACHANDPUR_FALLBACK_CENTER.lat,
      lng: CHURACHANDPUR_FALLBACK_CENTER.lng,
      zoom: 15,
    });
    return list;
  }, [
    localityCenter,
    localityLabel,
    hubCenter,
    hubLabel,
    activeHub?.name,
    quickLocalities,
    hubLocalities,
  ]);

  const polygonMetrics = useMemo(
    () => computePolygonGeometry(boundaryPolygon, safeCoords),
    [boundaryPolygon, safeCoords]
  );

  const validation = useMemo(
    () =>
      validateLatLngStrings(
        latDraft,
        lngDraft,
        showZoomControl ? zoomDraft : undefined
      ),
    [latDraft, lngDraft, zoomDraft, showZoomControl]
  );

  const showLatError =
    (touchedFields.lat || submitAttempted) && Boolean(validation.latError);
  const showLngError =
    (touchedFields.lng || submitAttempted) && Boolean(validation.lngError);
  const showZoomError =
    showZoomControl &&
    (touchedFields.zoom || submitAttempted) &&
    Boolean(validation.zoomError);

  const panMapTo = useCallback(
    (target: LatLngPoint, nextZoom?: number) => {
      const clean = normalizeLatLng(target, CHURACHANDPUR_FALLBACK_CENTER);
      setLiveCenter(clean);
      if (typeof nextZoom === 'number' && Number.isFinite(nextZoom)) {
        const clamped = Math.min(20, Math.max(3, Math.round(nextZoom)));
        setCameraZoom(clamped);
        setZoomDraft(String(clamped));
        onChangeZoom?.(clamped);
      }
      setPanRequest({
        center: clean,
        zoom: nextZoom,
        seq: Date.now() + Math.random(),
      });
    },
    [onChangeZoom]
  );

  const commitCoordinates = useCallback(
    (next: LatLngPoint) => {
      const clean = normalizeLatLng(next, CHURACHANDPUR_FALLBACK_CENTER);
      lastCommittedCoordsRef.current = clean;
      setLiveCenter(clean);
      setLatDraft(clean.lat.toFixed(6));
      setLngDraft(clean.lng.toFixed(6));
      onChangeCoordinates(clean);
    },
    [onChangeCoordinates]
  );

  const emitPolygonUpdate = useCallback(
    (nextPoly: LatLngPoint[], pushUndo = true) => {
      if (!onChangeBoundaryPolygon) return;
      if (pushUndo && !arePolygonsEqual(boundaryPolygon, nextPoly)) {
        setPolygonHistory((prev) => [...prev.slice(-19), boundaryPolygon]);
      }
      if (nextPoly.length >= 3) {
        const metrics = computePolygonGeometry(nextPoly, safeCoords);
        commitCoordinates(metrics.centroid);
        onChangeBoundaryPolygon(nextPoly, metrics.areaSqm, metrics.areaSqft);
      } else {
        onChangeBoundaryPolygon(nextPoly, 0, 0);
      }
    },
    [boundaryPolygon, commitCoordinates, onChangeBoundaryPolygon, safeCoords]
  );

  const handleMapIdleCenter = useCallback(
    (idleCenter: LatLngPoint, idleZoom: number) => {
      setIsPanning(false);
      setCameraZoom(idleZoom);
      setZoomDraft(String(idleZoom));
      onChangeZoom?.(idleZoom);

      if (activeMode === 'point') {
        setLiveCenter(idleCenter);
        if (
          Math.abs(idleCenter.lat - lastCommittedCoordsRef.current.lat) > 1e-6 ||
          Math.abs(idleCenter.lng - lastCommittedCoordsRef.current.lng) > 1e-6
        ) {
          commitCoordinates(idleCenter);
        }
      }
    },
    [activeMode, commitCoordinates, onChangeZoom]
  );

  const handleUseCurrentGps = () => {
    setGeoNotice(null);
    if (typeof navigator === 'undefined' || !('geolocation' in navigator)) {
      commitCoordinates(CHURACHANDPUR_FALLBACK_CENTER);
      panMapTo(CHURACHANDPUR_FALLBACK_CENTER, 15);
      setGeoNotice({
        type: 'err',
        text: 'GPS is unavailable in this browser. Centered on Churachandpur so you can pan to the exact spot.',
      });
      return;
    }

    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const next: LatLngPoint = {
          lat: roundCoord(pos.coords.latitude, 6),
          lng: roundCoord(pos.coords.longitude, 6),
        };
        commitCoordinates(next);
        panMapTo(next, 17);
        setIsLocating(false);
        setGeoNotice({
          type: 'ok',
          text: `High-accuracy GPS locked at ${formatCoordinates(next.lat, next.lng, 6)} (±${Math.round(pos.coords.accuracy || 0)}m).`,
        });
      },
      (err) => {
        setIsLocating(false);
        const fallback = localityCenter || hubCenter || CHURACHANDPUR_FALLBACK_CENTER;
        panMapTo(fallback, 15);
        setGeoNotice({
          type: 'err',
          text:
            err.code === 1
              ? 'Location permission denied. Centered on Churachandpur — pan under the crosshair to place your pin.'
              : 'GPS timed out. Centered on Churachandpur — pan under the crosshair or enter coordinates manually.',
        });
      },
      HIGH_ACCURACY_GPS_OPTIONS
    );
  };

  const handleQuickLocalityJump = (selectedId: string) => {
    const match = localityOptions.find((o) => o.id === selectedId);
    if (!match) return;
    const next = { lat: roundCoord(match.lat, 6), lng: roundCoord(match.lng, 6) };
    commitCoordinates(next);
    panMapTo(next, match.zoom ?? 16);
    setGeoNotice({
      type: 'ok',
      text: `Jumped to ${match.label}. Pan map under the crosshair to fine-tune.`,
    });
  };

  const handleCopyCoordinates = async () => {
    const formatted = formatCoordinates(liveCenter.lat, liveCenter.lng, 6);
    const ok = await copyTextToClipboard(formatted);
    if (ok) {
      setCopiedCoords(true);
      window.setTimeout(() => setCopiedCoords(false), 2000);
    }
  };

  const handleCreateStarterPlotBox = () => {
    const dLat = 0.00018;
    const dLng = 0.0002;
    const center = liveCenter;
    const starter: LatLngPoint[] = [
      { lat: roundCoord(center.lat + dLat, 6), lng: roundCoord(center.lng - dLng, 6) },
      { lat: roundCoord(center.lat + dLat, 6), lng: roundCoord(center.lng + dLng, 6) },
      { lat: roundCoord(center.lat - dLat, 6), lng: roundCoord(center.lng + dLng, 6) },
      { lat: roundCoord(center.lat - dLat, 6), lng: roundCoord(center.lng - dLng, 6) },
    ];
    setActiveMode('polygon');
    setPolygonTool('select');
    emitPolygonUpdate(starter, true);
    panMapTo(center, 18);
  };

  const handleUndoPolygon = () => {
    if (polygonHistory.length > 0) {
      const previous = polygonHistory[polygonHistory.length - 1];
      setPolygonHistory((prev) => prev.slice(0, -1));
      emitPolygonUpdate(previous, false);
    } else if (boundaryPolygon.length > 0) {
      emitPolygonUpdate(boundaryPolygon.slice(0, -1), false);
    }
  };

  const handleManualDraftCommit = (
    nextLatStr: string,
    nextLngStr: string,
    nextZoomStr?: string
  ) => {
    const res = validateLatLngStrings(
      nextLatStr,
      nextLngStr,
      showZoomControl ? nextZoomStr : undefined
    );
    if (res.isValid && res.parsed) {
      const pt = { lat: res.parsed.lat, lng: res.parsed.lng };
      commitCoordinates(pt);
      panMapTo(pt, res.parsed.zoom ?? cameraZoom);
    }
  };

  const vectorShapes = useMemo<DrawnShape[]>(() => {
    const shapes: DrawnShape[] = [];
    if (supportsPolygon && boundaryPolygon.length >= 3) {
      shapes.push({
        id: 'editor-plot-poly',
        type: 'polygon',
        label: 'Land Boundary',
        coordinates: boundaryPolygon,
        areaSqm: polygonMetrics.areaSqm,
        perimeterMeters: polygonMetrics.perimeterMeters,
        createdAt: '',
      });
    }
    return shapes;
  }, [
    supportsPolygon,
    boundaryPolygon,
    polygonMetrics.areaSqm,
    polygonMetrics.perimeterMeters,
  ]);

  const renderMapCanvas = (mapInstanceId: string, canvasHeightClass: string) => (
    <div
      className={`relative w-full touch-none select-none overflow-hidden ${canvasHeightClass}`}
      style={{ backgroundColor: resolvedCloudConfig.backgroundColor }}
    >
      {apiKeyAvailable && !useVectorStylePreview ? (
        <GoogleMap
          key={`${mapInstanceId}-${resolvedCloudConfig.mapId}-${resolvedCloudConfig.colorScheme}`}
          id={mapInstanceId}
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
          controlSize={32}
          internalUsageAttributionIds={['gmp_mcp_codeassist_v1_aistudio']}
          onClick={(ev) => {
            if (activeMode !== 'point') return;
            const latLng = ev.detail?.latLng;
            if (latLng) {
              const tapped = {
                lat: roundCoord(latLng.lat, 6),
                lng: roundCoord(latLng.lng, 6),
              };
              commitCoordinates(tapped);
              panMapTo(tapped);
            }
          }}
          onCameraChanged={(ev) => {
            if (ev.detail.center) {
              setIsPanning(true);
              setLiveCenter({
                lat: roundCoord(ev.detail.center.lat, 6),
                lng: roundCoord(ev.detail.center.lng, 6),
              });
            }
            if (typeof ev.detail.zoom === 'number') {
              const clamped = Math.min(20, Math.max(3, Math.round(ev.detail.zoom)));
              setCameraZoom(clamped);
            }
          }}
          className="w-full h-full"
        >
          <MapInstanceController
            mapInstanceId={mapInstanceId}
            panRequest={panRequest}
            polygonEnabled={activeMode === 'polygon' && supportsPolygon}
            polygonTool={polygonTool}
            boundaryPolygon={boundaryPolygon}
            onPolygonChangeFromDraw={(nextPoly) => emitPolygonUpdate(nextPoly, true)}
            onMapIdleCenter={handleMapIdleCenter}
          />
        </GoogleMap>
      ) : (
        <InteractiveVectorMap
          listings={[]}
          selectedListing={null}
          onSelectListing={() => {}}
          mapStyle={mapStyle}
          mapAppearance={resolvedCloudConfig.variant}
          center={liveCenter}
          zoom={cameraZoom}
          defaultCenter={safeCoords}
          drawnShapes={vectorShapes}
          inProgressPoints={
            activeMode === 'polygon' && supportsPolygon ? boundaryPolygon : []
          }
          onMapClickLatLng={(pt) => {
            const clean = { lat: roundCoord(pt.lat, 6), lng: roundCoord(pt.lng, 6) };
            if (activeMode === 'polygon' && supportsPolygon) {
              emitPolygonUpdate([...boundaryPolygon, clean], true);
            } else {
              commitCoordinates(clean);
              panMapTo(clean);
            }
          }}
          onCameraChange={(nextCenter, nextZoom) => {
            const clean = {
              lat: roundCoord(nextCenter.lat, 6),
              lng: roundCoord(nextCenter.lng, 6),
            };
            const clamped = Math.min(20, Math.max(3, Math.round(nextZoom)));
            setLiveCenter(clean);
            setCameraZoom(clamped);
            setZoomDraft(String(clamped));
            onChangeZoom?.(clamped);
            if (activeMode === 'point') {
              commitCoordinates(clean);
            }
          }}
        />
      )}

      {/* Fixed Exact-Center Crosshair Pin (tip dot is pixel-for-pixel at 50%/50%) */}
      {activeMode === 'point' && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 z-20"
        >
          {/* Exact ground contact dot centered at (50%, 50%) */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
            <span className="block h-3 w-3 rounded-full bg-rose-500 ring-2 ring-white shadow-md" />
            <span
              className={`pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 h-8 w-8 rounded-full border border-rose-500/45 transition-transform duration-150 ${
                isPanning ? 'scale-115 opacity-90' : 'scale-100 opacity-50'
              }`}
            />
            {/* Floating Pin Head & Stem anchored strictly ABOVE the exact center dot */}
            <div
              className={`absolute bottom-1/2 left-1/2 -translate-x-1/2 flex flex-col items-center transition-transform duration-150 ${
                isPanning ? '-translate-y-2' : 'translate-y-0'
              }`}
            >
              <div className="mb-1 rounded-full border border-[var(--ps-border)] bg-[var(--ps-surface)]/95 px-2.5 py-0.5 text-[10px] font-mono font-bold text-[var(--ps-text)] shadow-sm backdrop-blur-sm whitespace-nowrap">
                {formatCoordinates(liveCenter.lat, liveCenter.lng, 6)}
              </div>
              <div className="flex h-9 w-9 items-center justify-center rounded-full border-2 border-white bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-lg">
                <Crosshair className="h-4 w-4" />
              </div>
              <div className="h-2.5 w-0.5 bg-[var(--ps-accent)]" />
            </div>
          </div>
        </div>
      )}

      {/* Top-Right Compact Zoom/Expand Badge */}
      <div className="pointer-events-none absolute right-2.5 top-2.5 z-20 flex items-center gap-1.5">
        <span className="rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)]/90 px-2 py-1 text-[10px] font-mono font-semibold text-[var(--ps-text)] backdrop-blur-xs">
          Z{cameraZoom}
        </span>
        {allowExpand && (
          <button
            type="button"
            onClick={() => setIsExpanded((prev) => !prev)}
            aria-label={isExpanded ? 'Exit expanded map' : 'Expand map canvas'}
            title={isExpanded ? 'Exit expanded map' : 'Expand map canvas'}
            className="pointer-events-auto inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)]/95 text-[var(--ps-text)] shadow-sm backdrop-blur-xs transition-colors hover:border-[var(--ps-accent)] cursor-pointer"
          >
            {isExpanded ? (
              <Minimize2 className="h-4 w-4" />
            ) : (
              <Maximize2 className="h-4 w-4" />
            )}
          </button>
        )}
      </div>
    </div>
  );

  const renderToolbar = () => (
    <div className="border-b border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 py-2.5 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={() => setActiveMode('point')}
            className={`min-h-[44px] inline-flex items-center gap-1.5 rounded-xl px-3 text-xs font-semibold transition-colors cursor-pointer ${
              activeMode === 'point'
                ? 'bg-[var(--btn-primary-bg)] text-[var(--btn-primary-fg)]'
                : 'border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
            }`}
          >
            <Crosshair className="h-3.5 w-3.5" />
            <span>Center Pin</span>
          </button>

          {supportsPolygon && (
            <button
              type="button"
              onClick={() => setActiveMode('polygon')}
              className={`min-h-[44px] inline-flex items-center gap-1.5 rounded-xl px-3 text-xs font-semibold transition-colors cursor-pointer ${
                activeMode === 'polygon'
                  ? 'bg-emerald-600 text-white'
                  : 'border border-[var(--ps-border)] bg-[var(--ps-surface)] text-emerald-700 dark:text-emerald-400 hover:border-emerald-500/50'
              }`}
            >
              <PenTool className="h-3.5 w-3.5" />
              <span>
                Land Boundary{boundaryPolygon.length > 0 ? ` (${boundaryPolygon.length})` : ''}
              </span>
            </button>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={handleUseCurrentGps}
            disabled={isLocating}
            data-testid="map-picker-gps-btn"
            className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 text-xs font-semibold text-[var(--ps-text)] transition-colors hover:border-[var(--ps-accent)] disabled:opacity-60 cursor-pointer"
          >
            {isLocating ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin text-[var(--ps-accent)]" />
            ) : (
              <Navigation className="h-3.5 w-3.5 text-sky-500" />
            )}
            <span>{isLocating ? 'Locating…' : 'Use GPS'}</span>
          </button>

          {localityOptions.length > 0 && (
            <div className="relative flex items-center">
              <Compass
                aria-hidden="true"
                className="pointer-events-none absolute left-2.5 h-3.5 w-3.5 text-amber-500"
              />
              <select
                aria-label="Quick jump to locality"
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) {
                    handleQuickLocalityJump(e.target.value);
                    e.target.value = '';
                  }
                }}
                className="min-h-[44px] max-w-[185px] appearance-none rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] pl-8 pr-7 text-xs font-semibold text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-accent)] cursor-pointer"
              >
                <option value="">Jump to locality…</option>
                {localityOptions.map((opt) => (
                  <option key={opt.id} value={opt.id}>
                    {opt.label}
                  </option>
                ))}
              </select>
              <ChevronDown
                aria-hidden="true"
                className="pointer-events-none absolute right-2 h-3.5 w-3.5 text-[var(--ps-text-muted)]"
              />
            </div>
          )}
        </div>
      </div>

      {/* Mode Hint & Polygon Sub-Tools */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--ps-text-muted)]">
        <span>
          {activeMode === 'point'
            ? helperText ||
              'Pan or tap the map to align the center crosshair tip. Exact coordinates lock automatically on idle.'
            : polygonTool === 'draw'
              ? 'Click corners around the plot boundary, then click the first corner to close the Patta parcel.'
              : 'Drag any corner vertex, midpoint, or the parcel body to refine the boundary.'}
        </span>

        {activeMode === 'polygon' && supportsPolygon && (
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPolygonTool('draw')}
              className={`min-h-[36px] inline-flex items-center gap-1 rounded-lg px-2.5 text-[11px] font-semibold cursor-pointer ${
                polygonTool === 'draw'
                  ? 'bg-emerald-600 text-white'
                  : 'border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text)]'
              }`}
            >
              <PenTool className="h-3 w-3" />
              Draw
            </button>
            <button
              type="button"
              onClick={() => setPolygonTool('select')}
              disabled={boundaryPolygon.length < 3}
              className={`min-h-[36px] inline-flex items-center gap-1 rounded-lg px-2.5 text-[11px] font-semibold disabled:opacity-45 cursor-pointer ${
                polygonTool === 'select'
                  ? 'bg-emerald-600 text-white'
                  : 'border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text)]'
              }`}
            >
              <MousePointerClick className="h-3 w-3" />
              Edit Vertices
            </button>
          </div>
        )}
      </div>
    </div>
  );

  const renderFooterControls = () => (
    <div className="divide-y divide-[var(--ps-border)] bg-[var(--ps-bg)]">
      {/* Polygon Metrics & Actions */}
      {supportsPolygon && (
        <div className="space-y-2.5 bg-[var(--ps-surface-alt)] px-3.5 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0 text-xs text-[var(--ps-text)]">
              <span className="font-semibold">Plot Area: </span>
              {polygonMetrics.isValid ? (
                <span className="font-mono font-semibold text-emerald-700 dark:text-emerald-400">
                  {polygonMetrics.areaSqft.toLocaleString('en-IN')} sq.ft ·{' '}
                  {formatArea(polygonMetrics.areaSqm, 'sqm')} ·{' '}
                  {polygonMetrics.areaSangam.toFixed(2)} Sangam ·{' '}
                  {polygonMetrics.areaAcres.toFixed(3)} Acres ·{' '}
                  {formatLinearDistance(polygonMetrics.perimeterMeters, 'm')} perimeter
                </span>
              ) : (
                <span className="text-[var(--ps-text-muted)]">
                  {boundaryPolygon.length === 0
                    ? 'No land boundary traced yet. Switch to Land Boundary or insert a starter box.'
                    : `${boundaryPolygon.length}/3 corners placed (need ${3 - boundaryPolygon.length} more).`}
                </span>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {boundaryPolygon.length === 0 && (
                <button
                  type="button"
                  onClick={handleCreateStarterPlotBox}
                  className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 text-xs font-semibold text-[var(--ps-text)] hover:border-emerald-500 cursor-pointer"
                >
                  + Starter 4-Corner Box
                </button>
              )}
              {(boundaryPolygon.length > 0 || polygonHistory.length > 0) && (
                <button
                  type="button"
                  onClick={handleUndoPolygon}
                  className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 text-xs font-semibold text-[var(--ps-text)] hover:border-[var(--ps-accent)] cursor-pointer"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  Undo
                </button>
              )}
              {boundaryPolygon.length > 0 && (
                <button
                  type="button"
                  onClick={() => setConfirmClearOpen(true)}
                  className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl border border-rose-500/35 bg-rose-500/10 px-3 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-500/15 cursor-pointer"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  Clear Boundary
                </button>
              )}
            </div>
          </div>

          {polygonMetrics.isValid && (
            <div
              data-testid="plot-centroid-sync-pill"
              className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/40 bg-emerald-500/15 px-3 py-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-300"
            >
              <MapPin className="h-3.5 w-3.5 shrink-0" />
              <span>
                Centroid {formatCoordinates(polygonMetrics.centroid.lat, polygonMetrics.centroid.lng, 6)} ·{' '}
                {polygonMetrics.areaSqft.toLocaleString('en-IN')} sq.ft
              </span>
            </div>
          )}

          {isRealEstate && onChangeShowExactPin && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--ps-border)]/70 pt-2.5">
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
                className={`min-h-[44px] inline-flex items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition-colors cursor-pointer ${
                  showExactPin
                    ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                    : 'border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)]'
                }`}
              >
                {showExactPin ? (
                  <>
                    <Eye className="h-3.5 w-3.5" /> Exact Pin Public
                  </>
                ) : (
                  <>
                    <EyeOff className="h-3.5 w-3.5" /> Approx Locality Only
                  </>
                )}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Exact Coordinates Readout + 1-Click Copy + Collapsible Manual Edit */}
      <div className="space-y-2.5 px-3.5 py-3">
        {geoNotice && (
          <div
            role="status"
            className={`rounded-xl border px-3 py-2 text-xs ${
              geoNotice.type === 'ok'
                ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                : 'border-amber-500/35 bg-amber-500/10 text-amber-800 dark:text-amber-300'
            }`}
          >
            {geoNotice.text}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <MapPin className="h-4 w-4 shrink-0 text-[var(--ps-accent)]" />
            <span
              data-testid="map-picker-coords-readout"
              className="truncate font-mono text-xs font-semibold text-[var(--ps-text)]"
            >
              {formatCoordinates(liveCenter.lat, liveCenter.lng, 6)}
            </span>
            <button
              type="button"
              onClick={handleCopyCoordinates}
              data-testid="map-picker-copy-btn"
              className="min-h-[44px] inline-flex items-center gap-1 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 text-[11px] font-semibold text-[var(--ps-text)] transition-colors hover:border-[var(--ps-accent)] cursor-pointer"
            >
              {copiedCoords ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-500" />
                  <span className="text-emerald-600 dark:text-emerald-400">Copied</span>
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5 text-[var(--ps-text-muted)]" />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>

          <button
            type="button"
            onClick={() => setShowManualInputs((prev) => !prev)}
            className="min-h-[44px] inline-flex items-center gap-1 rounded-xl px-2.5 text-xs font-semibold text-[var(--ps-text-muted)] hover:bg-[var(--ps-surface)] hover:text-[var(--ps-text)] cursor-pointer"
          >
            <span>Manual Lat/Lng{showZoomControl ? ' & Zoom' : ''}</span>
            {showManualInputs ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
        </div>

        {(showManualInputs || showLatError || showLngError || showZoomError) && (
          <div
            className={`grid grid-cols-1 gap-2.5 pt-1 ${
              showZoomControl ? 'sm:grid-cols-3' : 'sm:grid-cols-2'
            }`}
          >
            <div>
              <label
                htmlFor={`${reactId}-lat`}
                className="mb-1 block text-[11px] font-semibold text-[var(--ps-text-muted)]"
              >
                Latitude (-90 to 90)
              </label>
              <input
                id={`${reactId}-lat`}
                type="text"
                inputMode="decimal"
                value={latDraft}
                onChange={(e) => {
                  const next = e.target.value;
                  setLatDraft(next);
                  const res = validateLatLngStrings(
                    next,
                    lngDraft,
                    showZoomControl ? zoomDraft : undefined
                  );
                  if (res.isValid && res.parsed) {
                    const pt = { lat: res.parsed.lat, lng: res.parsed.lng };
                    commitCoordinates(pt);
                    panMapTo(pt, res.parsed.zoom ?? cameraZoom);
                  }
                }}
                onBlur={() => {
                  setTouchedFields((prev) => ({ ...prev, lat: true }));
                  handleManualDraftCommit(latDraft, lngDraft, zoomDraft);
                }}
                aria-invalid={showLatError}
                className={`min-h-[44px] w-full rounded-xl border bg-[var(--ps-surface)] px-3 text-xs font-mono text-[var(--ps-text)] focus:outline-none focus:ring-2 ${
                  showLatError
                    ? 'border-rose-500 focus:ring-rose-500/40'
                    : 'border-[var(--ps-border)] focus:ring-[var(--ps-accent)]'
                }`}
              />
              {showLatError && (
                <p className="mt-1 text-[11px] font-medium text-rose-500">
                  {validation.latError}
                </p>
              )}
            </div>

            <div>
              <label
                htmlFor={`${reactId}-lng`}
                className="mb-1 block text-[11px] font-semibold text-[var(--ps-text-muted)]"
              >
                Longitude (-180 to 180)
              </label>
              <input
                id={`${reactId}-lng`}
                type="text"
                inputMode="decimal"
                value={lngDraft}
                onChange={(e) => {
                  const next = e.target.value;
                  setLngDraft(next);
                  const res = validateLatLngStrings(
                    latDraft,
                    next,
                    showZoomControl ? zoomDraft : undefined
                  );
                  if (res.isValid && res.parsed) {
                    const pt = { lat: res.parsed.lat, lng: res.parsed.lng };
                    commitCoordinates(pt);
                    panMapTo(pt, res.parsed.zoom ?? cameraZoom);
                  }
                }}
                onBlur={() => {
                  setTouchedFields((prev) => ({ ...prev, lng: true }));
                  handleManualDraftCommit(latDraft, lngDraft, zoomDraft);
                }}
                aria-invalid={showLngError}
                className={`min-h-[44px] w-full rounded-xl border bg-[var(--ps-surface)] px-3 text-xs font-mono text-[var(--ps-text)] focus:outline-none focus:ring-2 ${
                  showLngError
                    ? 'border-rose-500 focus:ring-rose-500/40'
                    : 'border-[var(--ps-border)] focus:ring-[var(--ps-accent)]'
                }`}
              />
              {showLngError && (
                <p className="mt-1 text-[11px] font-medium text-rose-500">
                  {validation.lngError}
                </p>
              )}
            </div>

            {showZoomControl && (
              <div>
                <label
                  htmlFor={`${reactId}-zoom`}
                  className="mb-1 block text-[11px] font-semibold text-[var(--ps-text-muted)]"
                >
                  Default Zoom (3–20)
                </label>
                <input
                  id={`${reactId}-zoom`}
                  type="number"
                  min={3}
                  max={20}
                  step={1}
                  value={zoomDraft}
                  onChange={(e) => {
                    const next = e.target.value;
                    setZoomDraft(next);
                    const zNum = Number.parseInt(next, 10);
                    if (Number.isFinite(zNum) && zNum >= 3 && zNum <= 20) {
                      setCameraZoom(zNum);
                      onChangeZoom?.(zNum);
                      panMapTo(liveCenter, zNum);
                    }
                  }}
                  onBlur={() => {
                    setTouchedFields((prev) => ({ ...prev, zoom: true }));
                    handleManualDraftCommit(latDraft, lngDraft, zoomDraft);
                  }}
                  aria-invalid={showZoomError}
                  className={`min-h-[44px] w-full rounded-xl border bg-[var(--ps-surface)] px-3 text-xs font-mono text-[var(--ps-text)] focus:outline-none focus:ring-2 ${
                    showZoomError
                      ? 'border-rose-500 focus:ring-rose-500/40'
                      : 'border-[var(--ps-border)] focus:ring-[var(--ps-accent)]'
                  }`}
                />
                {showZoomError && (
                  <p className="mt-1 text-[11px] font-medium text-rose-500">
                    {validation.zoomError}
                  </p>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div
      data-testid="unified-map-coordinate-picker"
      className={`overflow-hidden rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] ${className}`}
    >
      {label && (
        <div className="border-b border-[var(--ps-border)] bg-[var(--ps-surface)] px-3.5 py-2.5">
          <p className="text-xs font-bold text-[var(--ps-text)]">{label}</p>
        </div>
      )}

      {!isExpanded && (
        <>
          {renderToolbar()}
          {renderMapCanvas(compactMapId, 'h-[240px] sm:h-[290px]')}
          {renderFooterControls()}
        </>
      )}

      {isExpanded && (
        <div className="flex items-center justify-between gap-2 bg-[var(--ps-bg)] px-4 py-4 text-xs text-[var(--ps-text-muted)]">
          <span>
            Map picker is open in expanded view ({formatCoordinates(liveCenter.lat, liveCenter.lng, 6)}).
          </span>
          <button
            type="button"
            onClick={() => setIsExpanded(false)}
            className="min-h-[44px] rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 font-semibold text-[var(--ps-text)] cursor-pointer"
          >
            Return Inline
          </button>
        </div>
      )}

      {/* Expanded Responsive Modal Canvas (Tablet/Desktop split, Mobile full-screen) */}
      {mounted &&
        isExpanded &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label={label || 'Expanded Map Coordinate Picker'}
            className="fixed inset-0 z-[110] flex items-center justify-center bg-slate-950/70 p-2 sm:p-4 backdrop-blur-xs"
          >
            <div className="flex h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] shadow-2xl">
              <div className="flex items-center justify-between gap-3 border-b border-[var(--ps-border)] px-4 py-3">
                <div className="min-w-0">
                  <h3 className="truncate text-sm font-bold text-[var(--ps-text)]">
                    {label || 'Precision Map Coordinate Picker'}
                  </h3>
                  <p className="text-[11px] text-[var(--ps-text-muted)]">
                    {activeMode === 'polygon'
                      ? 'Draw or refine land parcel corners with live area calculation.'
                      : 'Pan the map until the crosshair tip rests directly on your target spot.'}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setIsExpanded(false)}
                  className="min-h-[44px] inline-flex items-center gap-1.5 rounded-xl bg-[var(--btn-primary-bg)] px-4 text-xs font-bold text-[var(--btn-primary-fg)] cursor-pointer"
                >
                  <X className="h-4 w-4" />
                  <span>Done</span>
                </button>
              </div>

              <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
                <div className="flex min-h-0 flex-1 flex-col">
                  {renderToolbar()}
                  <div className="min-h-[280px] flex-1">
                    {renderMapCanvas(expandedMapId, 'h-full min-h-[280px]')}
                  </div>
                </div>
                <div className="w-full shrink-0 overflow-y-auto border-t border-[var(--ps-border)] lg:w-[360px] lg:border-l lg:border-t-0">
                  {renderFooterControls()}
                </div>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* Confirm Clear Land Boundary (ZERO native window.confirm) */}
      <ConfirmDialog
        isOpen={confirmClearOpen}
        variant="warning"
        title="Clear traced land boundary?"
        description="This removes all vertices from the current parcel outline. You can still use Undo immediately after."
        confirmLabel="Clear Boundary"
        cancelLabel="Keep Boundary"
        onCancel={() => setConfirmClearOpen(false)}
        onConfirm={() => {
          setConfirmClearOpen(false);
          emitPolygonUpdate([], true);
          setPolygonTool('draw');
        }}
      />
    </div>
  );
}

export default MapCoordinatePicker;
