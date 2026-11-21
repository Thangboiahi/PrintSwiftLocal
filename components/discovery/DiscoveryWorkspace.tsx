'use client';

import React, {
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Map as GoogleMap,
  AdvancedMarker,
  useMap,
} from '@vis.gl/react-google-maps';
import { MarkerClusterer, type Marker } from '@googlemaps/markerclusterer';
import {
  AlertCircle,
  ArrowLeft,
  ArrowLeftRight,
  ArrowUpDown,
  Bookmark,
  Briefcase,
  Building2,
  Car,
  Check,
  ChevronDown,
  ChevronUp,
  Compass,
  Copy,
  Crosshair,
  Expand,
  Filter,
  Globe,
  GripVertical,
  HeartPulse,
  Home,
  Landmark,
  List,
  Loader2,
  Map as MapIcon,
  MapPin,
  Minus,
  Navigation,
  Package,
  PanelRightClose,
  PanelRightOpen,
  Printer,
  RotateCcw,
  Search,
  ShieldCheck,
  Sliders,
  Sparkles,
  Star,
  Trophy,
  Users,
  Wrench,
  X,
  ZoomIn,
} from 'lucide-react';
import { PromoBannerSlot } from '@/components/ui/PromoBannerSlot';
import { AppBrandLoader } from '@/components/ui/AppBrandLoader';
import {
  CATEGORY_LABELS,
  PROPERTY_TYPE_LABELS,
  ResponsiveLayoutProfileResult,
  applyDrawnGeometryToListingDraft,
  calculateCircleMetrics,
  calculateDistanceMeters,
  calculateLineSegmentsMeters,
  calculatePolygonMetrics,
  canUserCreateListingFromGeometry,
  clampSplitListingPercentage,
  computeClusterExpansionCamera,
  computeClusterSummary,
  computeDefaultViewportBounds,
  filterDiscoveryListings,
  formatArea,
  getAreaUnitSymbol,
  getListingNumericPrice,
  getListingPriceLabel,
  hasMeaningfulViewportChange,
  hasValidListingCoordinates,
  isPointInViewport,
  resolveResponsiveLayoutProfile,
  resolveSelectedListingOverlayLayout,
  shouldShowPlotAndBoundary,
} from '@/lib/rules';
import { generateCoverImageDataUri } from '@/lib/media-generator';
import {
  PRINTSWIFT_MIDNIGHT_DISCOVERY_STYLE,
  PRINTSWIFT_NEUTRAL_DISCOVERY_STYLE,
  resolveCloudMapConfiguration,
} from '@/lib/map-cloud-styles';
import { CHURACHANDPUR_LOCALITIES, CHURACHANDPUR_SAMPLE_CENTER } from '@/lib/seed-data';
import {
  useAppStore,
  useRealEstateMode,
  useSimpleMode,
  setMapStatusStore,
} from '@/lib/store';
import { clearAppStatus, setAppStatus } from '@/lib/hooks/useAppStatus';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { fetchHideSampleDataFlag } from '@/lib/supabase/platform-settings';
import { resolveRemoteMediaUrl } from '@/lib/supabase/storage';
import type { VehicleListingRecord } from '@/lib/payments/types';
import {
  isPrintProfileBusyPaused,
  isPrintingDigitalCategorySlug,
  matchesPrintCapabilityFilter,
  normalizeClientPrintProfile,
  PRINT_CAPABILITY_FILTER_OPTIONS,
  type PrintCapabilityFilterKey,
  type PrintProfileBadgeSummary,
} from '@/lib/print-orders/client-helpers';
import {
  fetchPublishedListings,
  mapRowToListing,
  type SupabaseListingRow,
} from '@/lib/supabase/listings';
import {
  AreaUnit,
  DiscoverySearchScope,
  DiscoverySortOption,
  DrawnShape,
  LatLngPoint,
  Listing,
  ListingCategory,
  MapAppearanceVariant,
  MapToolbarPosition,
  MapViewportBounds,
  MobileSheetState,
  PropertyType,
  ResponsiveLayoutProfile,
} from '@/lib/types';
import { ListingThumbnail, SelectedListingCard } from './SelectedListingCard';
import { CategoryDetailView } from '@/components/listings/CategoryDetailView';
import { ListingFeed } from '@/components/listings/ListingFeed';
import { InteractiveVectorMap } from '@/components/shared/InteractiveVectorMap';
import {
  EmptyState,
  ErrorState,
} from '@/components/shared/StateFeedback';
import { SkeletonCardList } from '@/components/shared/SkeletonCard';
import {
  isTopmostActiveModal,
  useModalFocusManagement,
} from '@/components/shared/ThemeSettingsModal';
import { FloatingMapToolbar } from './FloatingMapToolbar';
import { BrandStatusLogo } from '@/components/ui/BrandStatusLogo';
import { ActiveDrawTool, DrawMeasureToolbox } from './DrawMeasureToolbox';
import { MapActivityStatus } from '@/components/shared/GlobalStatusPill';
import {
  GeolocationPrompt,
  YouAreHereMarker,
  getSavedGeolocationPreference,
} from './GeolocationPrompt';
import { LocationPickerModal } from '@/components/map/LocationPickerModal';
import {
  MAP_SETTINGS_COOKIE_NAME,
  STORAGE_KEY_MAP_PROMPT_DISMISSED,
  parseMapSettings,
} from '@/lib/map-settings';
import { CategoryPillIcon, FilterBar } from './FilterBar';
import { MapCardRegistry } from '@/components/verticals/MapCardRegistry';
import { SummaryModalRegistry } from '@/components/verticals/SummaryModalRegistry';
import { RouteEstimateSummary, RouteRenderer } from './RouteRenderer';
import {
  FilterDrawerModal,
  PRICE_RANGE_LABELS,
  PriceRangeFilterOption,
} from './FilterDrawerModal';
import { PickNDropPanel } from '@/components/pickndrop/PickNDropPanel';
import { PickNDropRouteLayer } from '@/components/pickndrop/PickNDropRouteLayer';
import { useAppConfig } from '@/components/providers/AppConfigProvider';
import type {
  DeliveryTripType,
  PickNDropPoint,
} from '@/lib/pick-n-drop/types';

const CATEGORY_COLORS: Record<
  ListingCategory,
  { bg: string; border: string; text: string }
> = {
  business: { bg: '#0284c7', border: '#075985', text: '#ffffff' },
  service: { bg: '#7c3aed', border: '#4c1d95', text: '#ffffff' },
  real_estate: { bg: '#059669', border: '#064e3b', text: '#ffffff' },
  sports: { bg: '#ea580c', border: '#9a3412', text: '#ffffff' },
  public_place: { bg: '#dc2626', border: '#991b1b', text: '#ffffff' },
};

const DEFAULT_CATEGORY_COLOR = {
  bg: '#3b82f6',
  border: '#1d4ed8',
  text: '#ffffff',
};

const DISCOVERY_COLLAPSED_STORAGE_KEY =
  'printswift_local_discovery_collapsed_v1';
const DESKTOP_PANEL_OPEN_STORAGE_KEY =
  'printswift_local_desktop_panel_open_v1';
const SPLIT_PCT_STORAGE_KEY = 'printswift_local_split_pct_v1';
const PSL_LISTINGS_CACHE_PREFIX = 'psl_listings_cache_';
const PSL_MAP_STATE_PREFIX = 'psl_map_state_';

function getHubListingsCacheKey(hubSlug: string): string {
  return `${PSL_LISTINGS_CACHE_PREFIX}${(hubSlug || 'churachandpur').trim().toLowerCase()}`;
}

function readHubListingsCache(hubSlug: string): Listing[] | null {
  if (typeof window === 'undefined' || !hubSlug) return null;
  try {
    const key = getHubListingsCacheKey(hubSlug);
    const raw = window.localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      parsed.hubSlug === hubSlug.toLowerCase() &&
      Array.isArray(parsed.items) &&
      Date.now() - (parsed.cachedAt || 0) < 15 * 60 * 1000
    ) {
      return parsed.items as Listing[];
    }
    return null;
  } catch {
    return null;
  }
}

function writeHubListingsCache(hubSlug: string, items: Listing[]): void {
  if (typeof window === 'undefined' || !hubSlug || !Array.isArray(items)) return;
  try {
    const key = getHubListingsCacheKey(hubSlug);
    const sanitizedItems = items.slice(0, 60).map((item) => ({
      ...item,
      id: item.id,
      hub_id: item.hub_id,
      title: item.title,
      category: item.category,
      subcategory: item.subcategory,
      locality: item.locality,
      locality_id: item.locality_id,
      category_id: item.category_id,
      coordinates: item.coordinates,
      coverImage: item.coverImage,
      status: item.status,
      rating: item.rating,
      reviewCount: item.reviewCount,
      shortDescription: item.shortDescription,
    }));
    window.localStorage.setItem(
      key,
      JSON.stringify({
        hubSlug: hubSlug.toLowerCase(),
        cachedAt: Date.now(),
        items: sanitizedItems,
      })
    );
  } catch {
    // Ignore quota errors
  }
}

function getHubMapStateKey(hubSlug: string): string {
  return `${PSL_MAP_STATE_PREFIX}${(hubSlug || 'churachandpur').trim().toLowerCase()}`;
}

function readHubMapState(
  hubSlug: string
): { center: LatLngPoint; zoom: number } | null {
  if (typeof window === 'undefined' || !hubSlug) return null;
  try {
    const raw = window.localStorage.getItem(getHubMapStateKey(hubSlug));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed.lat === 'number' &&
      typeof parsed.lng === 'number' &&
      !isNaN(parsed.lat) &&
      !isNaN(parsed.lng)
    ) {
      return {
        center: { lat: parsed.lat, lng: parsed.lng },
        zoom: typeof parsed.zoom === 'number' ? parsed.zoom : 14,
      };
    }
    return null;
  } catch {
    return null;
  }
}

function writeHubMapState(
  hubSlug: string,
  center: LatLngPoint,
  zoom: number
): void {
  if (typeof window === 'undefined' || !hubSlug) return;
  try {
    window.localStorage.setItem(
      getHubMapStateKey(hubSlug),
      JSON.stringify({
        lat: Number(center.lat.toFixed(6)),
        lng: Number(center.lng.toFixed(6)),
        zoom: Math.round(zoom),
        updatedAt: Date.now(),
      })
    );
  } catch {
    // Ignore quota errors
  }
}

const SORT_OPTIONS: Array<{
  id: DiscoverySortOption;
  label: string;
  shortLabel: string;
  description: string;
}> = [
  {
    id: 'relevance',
    label: 'Relevance',
    shortLabel: 'Relevance',
    description: 'Featured sample listings & highest community relevance',
  },
  {
    id: 'distance',
    label: 'Nearest Distance',
    shortLabel: 'Distance',
    description: 'Closest to current Churachandpur map centre',
  },
  {
    id: 'rating',
    label: 'Highest Rating',
    shortLabel: 'Top Rated',
    description: 'Ordered by star rating and review count',
  },
  {
    id: 'updated',
    label: 'Recently Updated',
    shortLabel: 'Updated',
    description: 'Newest directory modifications first',
  },
  {
    id: 'price_asc',
    label: 'Price: Low to High',
    shortLabel: 'Price ↑',
    description: 'Lowest sample price or starting rate first',
  },
  {
    id: 'price_desc',
    label: 'Price: High to Low',
    shortLabel: 'Price ↓',
    description: 'Highest sample property or item price first',
  },
];

function CategoryMarkerIcon({
  category,
  className = 'w-3.5 h-3.5',
}: {
  category: ListingCategory;
  className?: string;
}) {
  switch (category) {
    case 'business':
      return <Briefcase className={className} />;
    case 'service':
      return <Wrench className={className} />;
    case 'real_estate':
      return <Home className={className} />;
    case 'sports':
      return <Trophy className={className} />;
    case 'public_place':
      return <Landmark className={className} />;
    default:
      return <Building2 className={className} />;
  }
}

function hasValidRealEstatePolygon(listing: Listing): boolean {
  if (listing.category !== 'real_estate' || !listing.realEstateDetails) {
    return false;
  }
  const re = listing.realEstateDetails;
  return (
    shouldShowPlotAndBoundary(re.propertyType, re.hasAssociatedPlot) &&
    Array.isArray(re.boundaryPolygon) &&
    re.boundaryPolygon.length >= 3
  );
}

function getPolygonCentroid(polygon: LatLngPoint[]): LatLngPoint {
  if (!polygon || polygon.length === 0) {
    return CHURACHANDPUR_SAMPLE_CENTER;
  }
  const sum = polygon.reduce(
    (acc, pt) => ({ lat: acc.lat + pt.lat, lng: acc.lng + pt.lng }),
    { lat: 0, lng: 0 }
  );
  return {
    lat: Number((sum.lat / polygon.length).toFixed(6)),
    lng: Number((sum.lng / polygon.length).toFixed(6)),
  };
}

function getRealEstatePolygonLabel(
  listing: Listing,
  areaUnit: AreaUnit
): string {
  const re = listing.realEstateDetails;
  if (!re) return listing.title;
  const parts: string[] = [];
  if (re.priceLabel) {
    parts.push(re.priceLabel);
  }
  if (typeof re.plotAreaSqm === 'number' && re.plotAreaSqm > 0) {
    parts.push(formatArea(re.plotAreaSqm, areaUnit));
  }
  return parts.length > 0 ? parts.join(' • ') : listing.title;
}

interface MapGeometryAndViewportSyncProps {
  selectedListing: Listing | null;
  isRealEstateMode: boolean;
  filteredListings: Listing[];
  onSelectListing: (listingId: string) => void;
  drawnShapes: DrawnShape[];
  inProgressPoints: LatLngPoint[];
  selectedShapeId: string | null;
  onSelectShape: (shapeId: string) => void;
  onViewportChange: (
    bounds: MapViewportBounds,
    center: LatLngPoint,
    zoom: number,
    isUserInteraction?: boolean
  ) => void;
  recenterTrigger: number;
  isDesktopPanelOpen: boolean;
  layoutResizeKey: string;
  clusterExpansionTarget: {
    center: LatLngPoint;
    zoom: number;
    bounds: MapViewportBounds;
    seq: number;
    fitBounds?: boolean;
  } | null;
  zoomCommand: { targetZoom: number; seq: number } | null;
  defaultCenter?: LatLngPoint;
  onMapActivityStatusChange?: (status: MapActivityStatus) => void;
  onMapDragPanVisibilityChange?: (visible: boolean) => void;
}

function MapGeometryAndViewportSync({
  selectedListing,
  isRealEstateMode,
  filteredListings,
  onSelectListing,
  drawnShapes,
  inProgressPoints,
  selectedShapeId,
  onSelectShape,
  onViewportChange,
  recenterTrigger,
  isDesktopPanelOpen,
  layoutResizeKey,
  clusterExpansionTarget,
  zoomCommand,
  defaultCenter,
  onMapActivityStatusChange,
  onMapDragPanVisibilityChange,
}: MapGeometryAndViewportSyncProps) {
  const map = useMap();
  const overlaysRef = useRef<
    Array<google.maps.Polygon | google.maps.Polyline | google.maps.Circle>
  >([]);

  const onViewportChangeRef = useRef(onViewportChange);
  useEffect(() => {
    onViewportChangeRef.current = onViewportChange;
  }, [onViewportChange]);

  const onMapActivityStatusChangeRef = useRef(onMapActivityStatusChange);
  useEffect(() => {
    onMapActivityStatusChangeRef.current = onMapActivityStatusChange;
  }, [onMapActivityStatusChange]);

  const onMapDragPanVisibilityChangeRef = useRef(onMapDragPanVisibilityChange);
  useEffect(() => {
    onMapDragPanVisibilityChangeRef.current = onMapDragPanVisibilityChange;
  }, [onMapDragPanVisibilityChange]);

  // Track last fetched/settled center+zoom so passive container resizes never trigger updating_map loops
  const lastBoundsRef = useRef<{ lat: number; lng: number; zoom: number } | null>(
    null
  );
  const programmaticMoveUntilRef = useRef<number>(0);

  // Recalculate usable Google Map dimensions when split-screen or orientation changes (passive resize — never triggers updating_map)
  useEffect(() => {
    if (!map || typeof google === 'undefined' || !google.maps?.event) return;
    programmaticMoveUntilRef.current = Date.now() + 650;
    const centerBefore = map.getCenter();
    google.maps.event.trigger(map, 'resize');
    if (centerBefore) {
      map.panTo(centerBefore);
    }
  }, [map, layoutResizeKey, isDesktopPanelOpen]);

  // Phase 57: Bind strictly to genuine user interaction (dragend / zoom_changed) with delta threshold (>0.0005 deg or zoom change) and 250ms debounce.
  // NEVER trigger updating_map from passive container resizes or raw bounds_changed.
  useEffect(() => {
    if (!map) return;
    let isDragging = false;
    let initialDragLat: number | null = null;
    let fetchDebounceTimer: ReturnType<typeof setTimeout> | null = null;
    let hasSeededInitial = false;

    const readCamera = () => {
      const b = map.getBounds();
      const c = map.getCenter();
      const z = map.getZoom() ?? 14;
      if (!b || !c) return null;
      const ne = b.getNorthEast();
      const sw = b.getSouthWest();
      return {
        bounds: {
          north: ne.lat(),
          south: sw.lat(),
          east: ne.lng(),
          west: sw.lng(),
        },
        center: { lat: c.lat(), lng: c.lng() },
        zoom: z,
      };
    };

    const hasExceededDeltaThreshold = (
      nextCenter: { lat: number; lng: number },
      nextZoom: number
    ): boolean => {
      const prev = lastBoundsRef.current;
      if (!prev) return false;
      const latDelta = Math.abs(nextCenter.lat - prev.lat);
      const lngDelta = Math.abs(nextCenter.lng - prev.lng);
      const zoomDelta = Math.abs(nextZoom - prev.zoom);
      return latDelta > 0.003 || lngDelta > 0.003 || zoomDelta >= 1;
    };

    const scheduleUserMapSync = () => {
      const cam = readCamera();
      if (!cam) return;
      if (!hasExceededDeltaThreshold(cam.center, cam.zoom)) {
        return;
      }

      if (fetchDebounceTimer) {
        clearTimeout(fetchDebounceTimer);
      }

      onMapActivityStatusChangeRef.current?.('moving');
      setMapStatusStore({ isPanning: true });
      setAppStatus('updating_map');

      fetchDebounceTimer = setTimeout(() => {
        try {
          const settled = readCamera() || cam;
          lastBoundsRef.current = {
            lat: settled.center.lat,
            lng: settled.center.lng,
            zoom: settled.zoom,
          };
          onViewportChangeRef.current(
            settled.bounds,
            settled.center,
            settled.zoom,
            true
          );
        } finally {
          onMapActivityStatusChangeRef.current?.('idle');
          setMapStatusStore({ isPanning: false, isLoading: false });
          clearAppStatus();
        }
      }, 600);
    };

    const handleDragStart = () => {
      isDragging = true;
      const center = map.getCenter();
      initialDragLat = center ? center.lat() : null;
      if (fetchDebounceTimer) {
        clearTimeout(fetchDebounceTimer);
        fetchDebounceTimer = null;
      }
    };

    const handleDrag = () => {
      const center = map.getCenter();
      if (!center) return;
      const currentLat = center.lat();
      if (initialDragLat === null) {
        initialDragLat = currentLat;
        return;
      }
      if (Math.abs(currentLat - initialDragLat) > 0.08) {
        if (currentLat - initialDragLat < -0.08) {
          // Map panned UP (user looking south, lat decreases) -> hide header
          onMapDragPanVisibilityChangeRef.current?.(false);
        } else if (currentLat - initialDragLat > 0.08) {
          // Map panned DOWN (user looking north, lat increases) -> reveal header
          onMapDragPanVisibilityChangeRef.current?.(true);
        }
        initialDragLat = currentLat;
      }
    };

    const handleDragEnd = () => {
      isDragging = false;
      initialDragLat = null;
      scheduleUserMapSync();
    };

    const handleZoomChanged = () => {
      if (isDragging || Date.now() < programmaticMoveUntilRef.current) {
        const cam = readCamera();
        if (cam) {
          lastBoundsRef.current = {
            lat: cam.center.lat,
            lng: cam.center.lng,
            zoom: cam.zoom,
          };
        }
        return;
      }
      scheduleUserMapSync();
    };

    const handleIdle = () => {
      isDragging = false;
      initialDragLat = null;
      const cam = readCamera();
      if (!cam) return;
      if (!hasSeededInitial) {
        hasSeededInitial = true;
        lastBoundsRef.current = {
          lat: cam.center.lat,
          lng: cam.center.lng,
          zoom: cam.zoom,
        };
        onViewportChangeRef.current(cam.bounds, cam.center, cam.zoom, false);
      } else if (Date.now() < programmaticMoveUntilRef.current) {
        lastBoundsRef.current = {
          lat: cam.center.lat,
          lng: cam.center.lng,
          zoom: cam.zoom,
        };
      }
    };

    const dragStartListener = map.addListener('dragstart', handleDragStart);
    const dragListener = map.addListener('drag', handleDrag);
    const dragEndListener = map.addListener('dragend', handleDragEnd);
    const zoomChangedListener = map.addListener(
      'zoom_changed',
      handleZoomChanged
    );
    const idleListener = map.addListener('idle', handleIdle);

    const initialCam = readCamera();
    if (initialCam) {
      hasSeededInitial = true;
      lastBoundsRef.current = {
        lat: initialCam.center.lat,
        lng: initialCam.center.lng,
        zoom: initialCam.zoom,
      };
      onViewportChangeRef.current(
        initialCam.bounds,
        initialCam.center,
        initialCam.zoom,
        false
      );
    }

    return () => {
      if (fetchDebounceTimer) {
        clearTimeout(fetchDebounceTimer);
      }
      dragStartListener.remove();
      dragListener.remove();
      dragEndListener.remove();
      zoomChangedListener.remove();
      idleListener.remove();
      clearAppStatus();
    };
  }, [map]);

  // Smoothly pan to selected listing without forcing an aggressive zoom-in that shrinks map bounds
  const prevSelectedIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!map) return;
    const nextId = selectedListing?.id || null;
    if (nextId && nextId !== prevSelectedIdRef.current && selectedListing) {
      prevSelectedIdRef.current = nextId;
      programmaticMoveUntilRef.current = Date.now() + 650;
      map.panTo(selectedListing.coordinates);
    } else if (!nextId) {
      prevSelectedIdRef.current = null;
    }
  }, [map, selectedListing, isDesktopPanelOpen]);

  // Recenter trigger
  useEffect(() => {
    if (!map || recenterTrigger === 0) return;
    programmaticMoveUntilRef.current = Date.now() + 650;
    const target = defaultCenter || CHURACHANDPUR_SAMPLE_CENTER;
    lastBoundsRef.current = { lat: target.lat, lng: target.lng, zoom: 14 };
    map.panTo(target);
    map.setZoom(14);
  }, [map, recenterTrigger, defaultCenter]);

  // Cluster expansion and quick zoom to item camera sync (fluid panTo + setZoom)
  const prevClusterSeqRef = useRef<number>(0);
  useEffect(() => {
    if (!map || !clusterExpansionTarget) return;
    if (clusterExpansionTarget.seq === prevClusterSeqRef.current) return;
    prevClusterSeqRef.current = clusterExpansionTarget.seq;
    programmaticMoveUntilRef.current = Date.now() + 650;
    lastBoundsRef.current = {
      lat: clusterExpansionTarget.center.lat,
      lng: clusterExpansionTarget.center.lng,
      zoom: clusterExpansionTarget.zoom,
    };
    map.panTo(clusterExpansionTarget.center);
    map.setZoom(clusterExpansionTarget.zoom);
  }, [map, clusterExpansionTarget]);

  // Zoom +/- button sync
  const prevZoomSeqRef = useRef<number>(0);
  useEffect(() => {
    if (!map || !zoomCommand) return;
    if (zoomCommand.seq === prevZoomSeqRef.current) return;
    prevZoomSeqRef.current = zoomCommand.seq;
    const clampedZoom = Math.max(10, Math.min(19, zoomCommand.targetZoom));
    programmaticMoveUntilRef.current = Date.now() + 650;
    map.setZoom(clampedZoom);
  }, [map, zoomCommand]);

  // Render property boundary polygon + user drawn shapes on Google Map
  useEffect(() => {
    if (!map || typeof google === 'undefined' || !google.maps) return;

    overlaysRef.current.forEach((o) => o.setMap(null));
    overlaysRef.current = [];

    // 1. Real-estate boundary polygons:
    // In Real Estate Mode, iterate over all filtered listings that possess valid boundary geometry
    // (never fabricating geometry for point-only listings). Otherwise render only the selected listing's polygon.
    if (isRealEstateMode) {
      filteredListings.forEach((listing) => {
        if (!hasValidRealEstatePolygon(listing)) return;
        const boundary = listing.realEstateDetails?.boundaryPolygon;
        if (!boundary || boundary.length < 3) return;
        const isSelected = selectedListing?.id === listing.id;
        const propPoly = new google.maps.Polygon({
          paths: boundary,
          strokeColor: isSelected ? '#d97706' : '#059669',
          strokeOpacity: isSelected ? 1 : 0.92,
          strokeWeight: isSelected ? 4 : 2.5,
          fillColor: isSelected ? '#f59e0b' : '#10b981',
          fillOpacity: isSelected ? 0.36 : 0.24,
          zIndex: isSelected ? 60 : 30,
          clickable: true,
          map,
        });
        propPoly.addListener('click', () => onSelectListing(listing.id));
        overlaysRef.current.push(propPoly);
      });
    } else if (
      selectedListing &&
      hasValidRealEstatePolygon(selectedListing) &&
      selectedListing.realEstateDetails?.boundaryPolygon
    ) {
      const propPoly = new google.maps.Polygon({
        paths: selectedListing.realEstateDetails.boundaryPolygon,
        strokeColor: '#059669',
        strokeOpacity: 0.95,
        strokeWeight: 3,
        fillColor: '#10b981',
        fillOpacity: 0.28,
        map,
      });
      overlaysRef.current.push(propPoly);
    }

    // 2. User drawn shapes (respecting visible !== false)
    drawnShapes
      .filter((s) => s.visible !== false)
      .forEach((shape) => {
        const isSelectedShape = shape.id === selectedShapeId;
        const strokeColor = isSelectedShape ? '#f59e0b' : '#0284c7';
        const fillColor = isSelectedShape ? '#fbbf24' : '#38bdf8';

        if (
          (shape.type === 'polygon' || shape.type === 'rectangle') &&
          shape.coordinates.length >= 3
        ) {
          const poly = new google.maps.Polygon({
            paths: shape.coordinates,
            strokeColor,
            strokeOpacity: 0.9,
            strokeWeight: isSelectedShape ? 3 : 2,
            fillColor,
            fillOpacity: 0.22,
            map,
            clickable: true,
          });
          poly.addListener('click', () => onSelectShape(shape.id));
          overlaysRef.current.push(poly);
        } else if (shape.type === 'line' && shape.coordinates.length >= 2) {
          const line = new google.maps.Polyline({
            path: shape.coordinates,
            strokeColor,
            strokeOpacity: 0.95,
            strokeWeight: isSelectedShape ? 4 : 3,
            map,
            clickable: true,
          });
          line.addListener('click', () => onSelectShape(shape.id));
          overlaysRef.current.push(line);
        } else if (
          shape.type === 'circle' &&
          shape.center &&
          shape.radiusMeters
        ) {
          const circle = new google.maps.Circle({
            center: shape.center,
            radius: shape.radiusMeters,
            strokeColor,
            strokeOpacity: 0.9,
            strokeWeight: isSelectedShape ? 3 : 2,
            fillColor,
            fillOpacity: 0.2,
            map,
            clickable: true,
          });
          circle.addListener('click', () => onSelectShape(shape.id));
          overlaysRef.current.push(circle);
        }
      });

    // 3. In-progress drawing vertices
    if (inProgressPoints.length >= 2) {
      const draftLine = new google.maps.Polyline({
        path: inProgressPoints,
        strokeColor: '#f59e0b',
        strokeOpacity: 0.9,
        strokeWeight: 2.5,
        map,
      });
      overlaysRef.current.push(draftLine);
    }

    return () => {
      overlaysRef.current.forEach((o) => o.setMap(null));
      overlaysRef.current = [];
    };
  }, [
    map,
    selectedListing,
    isRealEstateMode,
    filteredListings,
    onSelectListing,
    drawnShapes,
    inProgressPoints,
    selectedShapeId,
    onSelectShape,
  ]);

  return null;
}

interface ClusteredMarkerItemProps {
  listing: Listing;
  isSelected: boolean;
  isHovered: boolean;
  isRealEstateMode?: boolean;
  printProfile?: PrintProfileBadgeSummary | null;
  onSelectListing: (listingId: string) => void;
  onHoverListing: (listingId: string | null) => void;
  setMarkerRef: (marker: Marker | null, key: string) => void;
}

const ClusteredMarkerItem = React.memo(function ClusteredMarkerItem({
  listing,
  isSelected,
  isHovered,
  isRealEstateMode = false,
  printProfile = null,
  onSelectListing,
  onHoverListing,
  setMarkerRef,
}: ClusteredMarkerItemProps) {
  const handleMarkerRef = useCallback(
    (marker: Marker | null) => {
      setMarkerRef(marker, listing.id);
    },
    [setMarkerRef, listing.id]
  );

  const colors = CATEGORY_COLORS[listing.category] ?? DEFAULT_CATEGORY_COLOR;
  const bgColor = colors?.bg || '#3b82f6';
  const categoryLabel = CATEGORY_LABELS[listing.category] || 'Listing';
  const safePosition = listing.coordinates ?? { lat: 24.3335, lng: 93.6978 };
  const priceBubbleText =
    listing.realEstateDetails?.priceLabel ||
    getListingPriceLabel(listing) ||
    listing.title.slice(0, 12);

  if (isRealEstateMode) {
    return (
      <AdvancedMarker
        ref={isSelected ? undefined : handleMarkerRef}
        position={safePosition}
        onClick={() => onSelectListing(listing.id)}
        zIndex={isSelected ? 1100 : isHovered ? 950 : 400}
      >
        <div
          onClick={() => onSelectListing(listing.id)}
          onMouseEnter={() => onHoverListing(listing.id)}
          onMouseLeave={() => onHoverListing(null)}
          data-map-pin="true"
          data-zillow-price-bubble="true"
          data-listing-id={listing.id}
          data-selected={isSelected ? 'true' : 'false'}
          data-hovered={isHovered ? 'true' : 'false'}
          className={`px-2.5 py-0.5 rounded-full border-2 shadow-md transition-all duration-150 cursor-pointer flex items-center justify-center font-extrabold text-[10px] tracking-tight whitespace-nowrap ${
            isSelected
              ? 'bg-slate-950 text-amber-300 border-amber-400 scale-115 ring-2 ring-amber-400/80 shadow-xl'
              : isHovered
                ? 'bg-white text-slate-950 border-slate-950 scale-110 ring-2 ring-emerald-500/70 shadow-xl'
                : 'bg-emerald-700 text-white border-white hover:bg-white hover:text-slate-950 hover:border-slate-950 hover:scale-110'
          }`}
          title={`${listing.title} — ${priceBubbleText}`}
        >
          <span>{priceBubbleText}</span>
        </div>
      </AdvancedMarker>
    );
  }

  const isCivicPin = Boolean(
    listing.is_civic_record || listing.listing_vertical === 'public_civic'
  );
  const civicDept = listing.vertical_summary?.department_type;
  const civicHasAlert = Boolean(listing.vertical_summary?.has_active_alert);
  const isEmergencyCivic = civicDept === 'emergency_medical';

  const isOfficialPrintSwift = Boolean(!isCivicPin && printProfile?.isFirstParty);
  const isPrintEnabledPin = Boolean(
    !isCivicPin &&
      printProfile &&
      (printProfile.isFirstParty ||
        (printProfile.hasActiveEntitlement &&
          printProfile.isAcceptingOrders &&
          !printProfile.isBusyPaused))
  );

  return (
    <AdvancedMarker
      ref={isSelected ? undefined : handleMarkerRef}
      position={safePosition}
      onClick={() => onSelectListing(listing.id)}
      zIndex={
        isSelected
          ? 1000
          : isHovered
            ? 800
            : isCivicPin
              ? 360
              : isOfficialPrintSwift
                ? 350
                : 200
      }
    >
      <div
        onClick={() => onSelectListing(listing.id)}
        onMouseEnter={() => onHoverListing(listing.id)}
        onMouseLeave={() => onHoverListing(null)}
        data-map-pin="true"
        data-listing-id={listing.id}
        data-selected={isSelected ? 'true' : 'false'}
        data-hovered={isHovered ? 'true' : 'false'}
        data-civic-pin={isCivicPin ? 'true' : undefined}
        data-print-pin={isPrintEnabledPin ? 'true' : undefined}
        data-official-printswift={isOfficialPrintSwift ? 'true' : undefined}
        style={{
          backgroundColor: isSelected
            ? '#f59e0b'
            : isHovered
              ? '#0f172a'
              : isCivicPin
                ? isEmergencyCivic
                  ? '#b91c1c'
                  : '#334155'
                : isOfficialPrintSwift
                  ? 'hsl(var(--color-primary))'
                  : bgColor,
          borderColor: isSelected
            ? '#0f172a'
            : isCivicPin
              ? '#e2e8f0'
              : isOfficialPrintSwift
                ? '#fbbf24'
                : '#ffffff',
          color: isSelected ? '#0f172a' : '#ffffff',
        }}
        className={`relative flex items-center justify-center rounded-full border-2 shadow-lg transition-transform cursor-pointer ${
          isSelected
            ? 'w-11 h-11 scale-125 ring-4 ring-amber-400/60'
            : isHovered
              ? 'w-9 h-9 scale-120 ring-2 ring-white'
              : isCivicPin
                ? 'w-9 h-9 ring-2 ring-slate-400/80 hover:scale-115'
                : isOfficialPrintSwift
                  ? 'w-9 h-9 ring-2 ring-amber-400/90 hover:scale-115'
                  : 'w-8 h-8 hover:scale-110'
        }`}
        title={
          isCivicPin
            ? `${listing.title} — Official Public Info`
            : isOfficialPrintSwift
              ? `${listing.title} — Official PrintSwift`
              : isPrintEnabledPin
                ? `${listing.title} — Online Print Counter`
                : `${listing.title} (${categoryLabel})`
        }
      >
        {isCivicPin ? (
          isEmergencyCivic ? (
            <HeartPulse
              className={isSelected ? 'w-5 h-5 stroke-[2.5]' : 'w-4 h-4'}
            />
          ) : (
            <ShieldCheck
              className={isSelected ? 'w-5 h-5 stroke-[2.5]' : 'w-4 h-4'}
            />
          )
        ) : isPrintEnabledPin ? (
          <Printer className={isSelected ? 'w-5 h-5 stroke-[2.5]' : 'w-4 h-4'} />
        ) : (
          <CategoryMarkerIcon
            category={listing.category}
            className={isSelected ? 'w-5 h-5 stroke-[2.5]' : 'w-4 h-4'}
          />
        )}
        {isCivicPin && civicHasAlert && (
          <span
            aria-hidden="true"
            className="absolute -top-1 -right-1 h-3 w-3 rounded-full border border-white bg-amber-400 shadow-xs"
          />
        )}
        {isPrintEnabledPin && (
          <span
            aria-hidden="true"
            className={`absolute -top-1 -right-1 flex h-3.5 w-3.5 items-center justify-center rounded-full border border-white shadow-xs ${
              isOfficialPrintSwift
                ? 'bg-amber-400 text-slate-950'
                : 'bg-emerald-500 text-white'
            }`}
          >
            <Printer className="h-2 w-2 stroke-[2.5]" />
          </span>
        )}
      </div>
    </AdvancedMarker>
  );
});

interface ClusteredListingMarkersProps {
  listings: Listing[];
  selectedListing: Listing | null;
  selectedListingId: string | null;
  hoveredListingId: string | null;
  isRealEstateMode?: boolean;
  printProfilesByListingId?: Record<string, PrintProfileBadgeSummary>;
  onSelectListing: (listingId: string) => void;
  onHoverListing: (listingId: string | null) => void;
}

function ClusteredListingMarkers({
  listings,
  selectedListing,
  selectedListingId,
  hoveredListingId,
  isRealEstateMode = false,
  printProfilesByListingId,
  onSelectListing,
  onHoverListing,
}: ClusteredListingMarkersProps) {
  const map = useMap();
  const markersRef = useRef<Record<string, Marker>>({});
  const clustererRef = useRef<MarkerClusterer | null>(null);
  const activeSelectedId = selectedListing?.id ?? selectedListingId ?? null;
  const activeSelectedIdRef = useRef<string | null>(activeSelectedId);

  useEffect(() => {
    activeSelectedIdRef.current = activeSelectedId;
  }, [activeSelectedId]);

  useEffect(() => {
    if (!map) return;

    const clusterClickCleanups: Array<() => void> = [];

    const clusterer = new MarkerClusterer({
      map,
      onClusterClick: null as unknown as undefined,
      renderer: {
        render: ({ count, position }) => {
          const handleClusterClick = () => {
            if (position) {
              map.panTo(position);
            }
            map.setZoom((map.getZoom() || 14) + 2);
          };

          if (
            typeof google !== 'undefined' &&
            google.maps?.marker?.AdvancedMarkerElement
          ) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.setAttribute('aria-label', `Cluster of ${count} listings`);
            btn.setAttribute('data-cluster-pin', 'true');
            btn.className =
              'w-10 h-10 rounded-full bg-slate-900 text-white border-2 border-white shadow-xl flex items-center justify-center text-xs font-extrabold hover:scale-110 transition-transform cursor-pointer';
            btn.textContent = String(count);
            const clusterMarker = new google.maps.marker.AdvancedMarkerElement({
              position,
              content: btn,
              zIndex: 500 + count,
              gmpClickable: true,
            });
            clusterMarker.addEventListener('gmp-click', handleClusterClick);
            clusterClickCleanups.push(() => {
              clusterMarker.removeEventListener('gmp-click', handleClusterClick);
            });
            return clusterMarker;
          }

          const legacyMarker = new google.maps.Marker({
            position,
            label: {
              text: String(count),
              color: '#ffffff',
              fontSize: '12px',
              fontWeight: 'bold',
            },
            zIndex: 500 + count,
          });
          const legacyListener = legacyMarker.addListener(
            'click',
            handleClusterClick
          );
          clusterClickCleanups.push(() => {
            legacyListener.remove();
          });
          return legacyMarker;
        },
      },
    });

    clustererRef.current = clusterer;
    const currentMarkers = Object.entries(markersRef.current)
      .filter(([id]) => id !== activeSelectedIdRef.current)
      .map(([, marker]) => marker);
    if (currentMarkers.length > 0) {
      clusterer.addMarkers(currentMarkers);
    }

    return () => {
      clusterClickCleanups.forEach((cleanup) => cleanup());
      clusterer.clearMarkers();
      clusterer.setMap(null);
      clustererRef.current = null;
    };
  }, [map]);

  // Synchronize MarkerClusterer whenever selectedListing?.id changes so the active pin is excluded from clustering
  useEffect(() => {
    const clusterer = clustererRef.current;
    if (!clusterer) return;
    if (activeSelectedId && markersRef.current[activeSelectedId]) {
      clusterer.removeMarker(markersRef.current[activeSelectedId]);
      delete markersRef.current[activeSelectedId];
    }
    const filteredMarkers = Object.entries(markersRef.current)
      .filter(([id]) => id !== selectedListing?.id && id !== activeSelectedId)
      .map(([, marker]) => marker);
    clusterer.clearMarkers();
    if (filteredMarkers.length > 0) {
      clusterer.addMarkers(filteredMarkers);
    }
  }, [selectedListing?.id, activeSelectedId]);

  const setMarkerRef = useCallback((marker: Marker | null, key: string) => {
    if (key === activeSelectedIdRef.current) {
      const existingSelected = markersRef.current[key];
      if (existingSelected && clustererRef.current) {
        clustererRef.current.removeMarker(existingSelected);
      }
      delete markersRef.current[key];
      return;
    }

    const existing = markersRef.current[key];
    if (marker && existing === marker) return;
    if (!marker && !existing) return;

    if (marker) {
      if (existing && clustererRef.current) {
        clustererRef.current.removeMarker(existing, true);
      }
      markersRef.current[key] = marker;
      if (clustererRef.current) {
        clustererRef.current.addMarker(marker);
      }
    } else {
      delete markersRef.current[key];
      if (existing && clustererRef.current) {
        clustererRef.current.removeMarker(existing);
      }
    }
  }, []);

  const noopSetMarkerRef = useCallback(() => {
    // Selected listing marker is rendered independently and never passed to MarkerClusterer
  }, []);

  const clusterableListings = useMemo(
    () =>
      listings.filter(
        (item) =>
          item.id !== selectedListing?.id && item.id !== selectedListingId
      ),
    [listings, selectedListing?.id, selectedListingId]
  );

  return (
    <>
      {clusterableListings.map((listing) => (
        <ClusteredMarkerItem
          key={listing.id}
          listing={listing}
          isSelected={false}
          isHovered={listing.id === hoveredListingId}
          isRealEstateMode={isRealEstateMode}
          printProfile={printProfilesByListingId?.[listing.id] ?? null}
          onSelectListing={onSelectListing}
          onHoverListing={onHoverListing}
          setMarkerRef={setMarkerRef}
        />
      ))}
      {selectedListing && (
        <ClusteredMarkerItem
          key={`selected-independent-${selectedListing.id}`}
          listing={selectedListing}
          isSelected={true}
          isHovered={selectedListing.id === hoveredListingId}
          isRealEstateMode={isRealEstateMode}
          printProfile={printProfilesByListingId?.[selectedListing.id] ?? null}
          onSelectListing={onSelectListing}
          onHoverListing={onHoverListing}
          setMarkerRef={noopSetMarkerRef}
        />
      )}
    </>
  );
}

export interface DiscoveryWorkspaceProps {
  apiKeyAvailable: boolean;
  isActiveView?: boolean;
  onOpenFullDetailPage: (listingId: string) => void;
  onFullscreenMapChange?: (isFullscreen: boolean) => void;
  selectedLocalityOverride?: string;
  onSelectLocalityOverride?: (locality: string) => void;
  onInitiateListingFromGeometry?: (draftListing: Listing) => void;
  layoutProfile?: ResponsiveLayoutProfileResult;
  pendingMapFocusRequest?: { listingId: string; seq: number } | null;
  onSearchFocusChange?: (focused: boolean) => void;
  onListScrollDirectionChange?: (direction: 'up' | 'down') => void;
  headerHeight?: number;
  isHeaderHidden?: boolean;
}

export function DiscoveryWorkspace({
  apiKeyAvailable,
  isActiveView = true,
  onOpenFullDetailPage,
  onFullscreenMapChange,
  selectedLocalityOverride,
  onSelectLocalityOverride,
  onInitiateListingFromGeometry,
  layoutProfile: externalLayoutProfile,
  pendingMapFocusRequest,
  onSearchFocusChange,
  onListScrollDirectionChange,
  headerHeight = 56,
  isHeaderHidden: externalIsHeaderHidden,
}: DiscoveryWorkspaceProps) {
  const {
    currentUser,
    staffDelegations,
    listings,
    isLoading,
    error,
    retryFetchListings,
    savedListingIds,
    toggleSavedListing,
    recordListingInteraction,
    mapStyle,
    setMapStyle,
    mapAppearance,
    setMapAppearance,
    configuredMapId,
    configuredLightMapId,
    configuredDarkMapId,
    setConfiguredMapIds,
    mapCloudFallbackNotice,
    useVectorStylePreview,
    setUseVectorStylePreview,
    areaUnit,
    drawnShapes,
    setDrawnShapes,
    undoDrawnShapes,
    redoDrawnShapes,
    canUndoDrawing,
    canRedoDrawing,
    customDefaultCenter,
    customDefaultZoom,
    effectiveDefaultCenter,
    currentMapCenter,
    setCurrentMapCenter,
    setIsFetching,
    setIsMoving,
  } = useAppStore();
  const [simpleMode] = useSimpleMode();
  const [isRealEstateMode] = useRealEstateMode();

  const {
    categories: appConfigCategories,
    categoriesByEntity,
    getCategorySubtreeSlugsOrIds,
    localities: appConfigLocalities,
    hubLocalities,
    operations: appConfigOperations,
    activeHub,
    hubs,
  } = useAppConfig();

  const activeHubId = activeHub?.id || '';
  const activeHubSlug = activeHub?.slug || 'churachandpur';
  const activeHubName = activeHub?.name || 'Churachandpur';
  const activeHubCenterLat = activeHub?.center_lat ?? CHURACHANDPUR_SAMPLE_CENTER.lat;
  const activeHubCenterLng = activeHub?.center_lng ?? CHURACHANDPUR_SAMPLE_CENTER.lng;
  const activeHubDefaultZoom = activeHub?.default_zoom ?? 14;

  const [hasLoadedLivePayload, setHasLoadedLivePayload] = useState<boolean>(false);

  // Phase 5: Live Supabase published listings state synchronized with Discovery Map
  const [livePublishedPayload, setLivePublishedPayload] = useState<Listing[]>(
    []
  );
  const [isLiveFetching, setIsLiveFetching] = useState<boolean>(true);
  const [liveFetchError, setLiveFetchError] = useState<string | null>(null);

  const loadLiveDiscoveryData = useCallback(async () => {
    setIsLiveFetching(true);
    setLiveFetchError(null);
    try {
      const remoteData = await fetchPublishedListings(undefined, {
        hubId: activeHubId || null,
        hubSlug: activeHubSlug || null,
      });
      setLivePublishedPayload(remoteData);
      setHasLoadedLivePayload(true);
      if (activeHubSlug) {
        writeHubListingsCache(activeHubSlug, remoteData);
      }
    } catch (err) {
      setLiveFetchError(
        err instanceof Error
          ? err.message
          : 'Failed to fetch published listings from Supabase.'
      );
    } finally {
      setIsLiveFetching(false);
    }
  }, [activeHubId, activeHubSlug]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const cached = activeHubSlug ? readHubListingsCache(activeHubSlug) : null;
      if (cached && cached.length > 0) {
        setLivePublishedPayload(cached);
        setHasLoadedLivePayload(true);
        setIsLiveFetching(false);
      } else {
        setIsLiveFetching(true);
      }
    });

    fetchPublishedListings(undefined, {
      hubId: activeHubId || null,
      hubSlug: activeHubSlug || null,
    })
      .then((remoteData) => {
        if (!active) return;
        setLivePublishedPayload(remoteData);
        setHasLoadedLivePayload(true);
        setLiveFetchError(null);
        setIsLiveFetching(false);
        if (activeHubSlug) {
          writeHubListingsCache(activeHubSlug, remoteData);
        }
      })
      .catch((err) => {
        if (!active) return;
        setLiveFetchError(
          err instanceof Error
            ? err.message
            : 'Failed to fetch published listings from Supabase.'
        );
        setIsLiveFetching(false);
      });
    return () => {
      active = false;
    };
  }, [activeHubId, activeHubSlug]);

  // Dynamic Categories fetched directly from Supabase `categories` table
  const [dynamicCategories, setDynamicCategories] = useState<
    Array<{
      id: string;
      name: string;
      slug?: string | null;
      type?: string | null;
    }>
  >([]);
  const [isCategoriesLoading, setIsCategoriesLoading] = useState<boolean>(true);

  useEffect(() => {
    let active = true;
    async function fetchLiveCategories() {
      if (!isSupabaseConfigured()) {
        if (active) setIsCategoriesLoading(false);
        return;
      }
      setIsCategoriesLoading(true);
      try {
        const { data, error: catError } = await supabase
          .from('categories')
          .select('*');
        if (!catError && Array.isArray(data) && active) {
          setDynamicCategories(
            data as Array<{
              id: string;
              name: string;
              slug?: string | null;
              type?: string | null;
            }>
          );
        }
      } catch {
        // Fallback safely if categories table is unreachable
      } finally {
        if (active) setIsCategoriesLoading(false);
      }
    }
    void fetchLiveCategories();
    return () => {
      active = false;
    };
  }, []);

  const effectiveIsLoading = isLoading || isLiveFetching;
  const effectiveError = liveFetchError || error;
  const handleRetryDiscoveryFetch = useCallback(async () => {
    await Promise.all([retryFetchListings(), loadLiveDiscoveryData()]);
  }, [retryFetchListings, loadLiveDiscoveryData]);

  // Cloud Map Configuration
  const cloudMapConfig = useMemo(
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

  // Cloud Style Spec Modal State
  const [isCloudStyleModalOpen, setIsCloudStyleModalOpen] = useState(false);
  const [draftPrimaryMapId, setDraftPrimaryMapId] = useState(configuredMapId);
  const [draftLightMapId, setDraftLightMapId] = useState(configuredLightMapId);
  const [draftDarkMapId, setDraftDarkMapId] = useState(configuredDarkMapId);
  const [copiedStyleVariant, setCopiedStyleVariant] =
    useState<MapAppearanceVariant | null>(null);

  // Discovery Mode ('map' | 'list')
  const [discoveryMode, setDiscoveryMode] = useState<'map' | 'list'>('map');

  // Search & Suggestions & Recent Searches (Section 2 & Phase 26)
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchFocused, setIsSearchFocusedState] = useState(false);
  const setIsSearchFocused = useCallback(
    (nextFocused: boolean) => {
      setIsSearchFocusedState(nextFocused);
      onSearchFocusChange?.(nextFocused);
    },
    [onSearchFocusChange]
  );
  const [placeholderIndex, setPlaceholderIndex] = useState(0);
  const searchPlaceholders = appConfigOperations.search_placeholders;
  useEffect(() => {
    if (searchPlaceholders.length <= 1) return;
    const timer = window.setInterval(() => {
      setPlaceholderIndex((prev) => (prev + 1) % searchPlaceholders.length);
    }, 4500);
    return () => window.clearInterval(timer);
  }, [searchPlaceholders.length]);

  const [recentSearches, setRecentSearches] = useState<string[]>([
    'Tuibong',
    'Plot',
    'New Lamka',
    'Stationery',
  ]);
  const searchContainerRef = useRef<HTMLDivElement | null>(null);

  // Filters & Sorting (Sections 3 & 4 & Part H)
  const [selectedCategory, setSelectedCategory] = useState<
    ListingCategory | 'all' | 'vehicles'
  >('all');
  const [vehicleListings, setVehicleListings] = useState<VehicleListingRecord[]>(
    []
  );
  const [isVehiclesLoading, setIsVehiclesLoading] = useState<boolean>(false);

  const [selectedSubcategoryId, setSelectedSubcategoryId] = useState<
    string | null
  >(null);
  const [selectedPrintCapability, setSelectedPrintCapability] =
    useState<PrintCapabilityFilterKey>('all');
  const [printProfilesByListingId, setPrintProfilesByListingId] = useState<
    Record<string, PrintProfileBadgeSummary>
  >({});

  // Phase 71-D: Lightweight fetch of listing_print_profiles keyed by listing_id for active hub
  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    let active = true;
    const loadPrintProfiles = async () => {
      try {
        const { data, error } = await supabase
          .from('listing_print_profiles')
          .select(
            'listing_id, hub_id, is_first_party_printswift, is_accepting_orders, busy_until, turnaround_badge, capabilities, verified_capabilities, rate_card, payment_policy'
          )
          .limit(150);

        if (!active || error || !Array.isArray(data) || data.length === 0) {
          return;
        }

        const nowMs = Date.now();
        const normalizedRows = (data as Array<Record<string, unknown>>)
          .map((row) => normalizeClientPrintProfile(row))
          .filter((p): p is NonNullable<typeof p> => Boolean(p));

        const entitlementChecks = await Promise.allSettled(
          normalizedRows.map(async (profile) => {
            if (profile.is_first_party_printswift) {
              return { profile, entitled: true };
            }
            const rpcRes = await supabase.rpc('has_active_print_entitlement', {
              p_listing_id: profile.listing_id,
            });
            return {
              profile,
              entitled:
                typeof rpcRes.data === 'boolean'
                  ? rpcRes.data
                  : profile.is_accepting_orders,
            };
          })
        );

        if (!active) return;
        const nextMap: Record<string, PrintProfileBadgeSummary> = {};
        for (const check of entitlementChecks) {
          if (check.status !== 'fulfilled') continue;
          const { profile, entitled } = check.value;
          nextMap[profile.listing_id] = {
            listingId: profile.listing_id,
            isFirstParty: profile.is_first_party_printswift,
            isAcceptingOrders: profile.is_accepting_orders,
            hasActiveEntitlement: entitled,
            isBusyPaused: isPrintProfileBusyPaused(profile.busy_until, nowMs),
            turnaroundBadge: profile.turnaround_badge,
            capabilities: profile.capabilities,
            verifiedCapabilities: profile.verified_capabilities,
            rateCard: profile.rate_card,
            directPayMaxInr: profile.payment_policy.direct_pay_max_inr,
            shopUpiVerified: profile.payment_policy.shop_upi_verified,
            allowEscrow: profile.payment_policy.allow_escrow,
          };
        }
        setPrintProfilesByListingId(nextMap);
      } catch {
        // Non-blocking when table/RPC is not yet migrated
      }
    };
    void loadPrintProfiles();
    return () => {
      active = false;
    };
  }, [activeHubId]);

  // Phase 63-B & 68-B: Load active Vehicle Listings scoped to activeHub (origin or inter-hub destination)
  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    let active = true;
    const loadVehicles = async () => {
      setIsVehiclesLoading(true);
      try {
        let vehicleQuery = supabase
          .from('vehicle_listings')
          .select(
            'id, vehicle_id, owner_id, driver_id, vehicle_type_id, title, description, stand_locality, lat, lng, booking_mode, total_seats, pricing_model, rate_hourly_inr, rate_daily_inr, rate_per_km_inr, fixed_routes, advance_percent, with_driver, features, thumbnail_url, image_urls, panorama_url, is_active, is_verified, origin_hub_id, destination_hub_ids, category_id, locality_id, custom_tags, created_at, updated_at'
          )
          .eq('is_active', true);

        if (activeHubId && !activeHubId.startsWith('fallback-')) {
          vehicleQuery = vehicleQuery.or(
            `origin_hub_id.eq.${activeHubId},destination_hub_ids.cs.{${activeHubId}}`
          );
        }

        const [hideSample, res] = await Promise.all([
          fetchHideSampleDataFlag(),
          vehicleQuery
            .order('is_verified', { ascending: false })
            .order('created_at', { ascending: false })
            .limit(80),
        ]);
        if (!active || res.error) return;
        const rows = ((res.data || []) as VehicleListingRecord[]).filter(
          (v) =>
            !hideSample || !String(v.title || '').trim().toUpperCase().startsWith('[SAMPLE]')
        );
        setVehicleListings(
          rows.map((v) => ({
            ...v,
            lat: Number(v.lat || activeHubCenterLat),
            lng: Number(v.lng || activeHubCenterLng),
            total_seats: Number(v.total_seats || 4),
            advance_percent: Number(v.advance_percent || 20),
          }))
        );
      } catch {
        // Non-blocking
      } finally {
        if (active) setIsVehiclesLoading(false);
      }
    };
    void loadVehicles();
    return () => {
      active = false;
    };
  }, [activeHubId, activeHubCenterLat, activeHubCenterLng]);
  const [isDesktopCategoriesExpanded, setIsDesktopCategoriesExpanded] =
    useState(false);
  const [selectedPropertyType, setSelectedPropertyType] = useState<
    PropertyType | 'all'
  >('all');
  const [internalLocality, setInternalLocality] = useState<string>('all');
  const selectedLocality =
    selectedLocalityOverride !== undefined
      ? selectedLocalityOverride
      : internalLocality;
  const setSelectedLocality = useCallback(
    (nextLoc: string) => {
      setInternalLocality(nextLoc);
      onSelectLocalityOverride?.(nextLoc);
    },
    [onSelectLocalityOverride]
  );
  const [minRating, setMinRating] = useState<number>(0);
  const [verifiedOnly, setVerifiedOnly] = useState<boolean>(false);
  const [priceRangeFilter, setPriceRangeFilter] =
    useState<PriceRangeFilterOption>('all');
  const [availableOnly, setAvailableOnly] = useState<boolean>(false);
  const [has360Only, setHas360Only] = useState<boolean>(false);
  const [hasCatalogueOnly, setHasCatalogueOnly] = useState<boolean>(false);
  const [sortBy, setSortBy] = useState<DiscoverySortOption>('relevance');
  const [isSortPopoverOpen, setIsSortPopoverOpen] = useState<boolean>(false);
  const sortContainerRef = useRef<HTMLDivElement | null>(null);
  const [isLocalityPopoverOpen, setIsLocalityPopoverOpen] =
    useState<boolean>(false);
  const localityContainerRef = useRef<HTMLDivElement | null>(null);
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);
  const [activeSpatialFilterShapeId, setActiveSpatialFilterShapeId] = useState<
    string | null
  >(null);

  // Collapsible Discovery Controls & Desktop Contextual Panel Preferences (Hydration-Safe)
  const [isDiscoveryCollapsed, setIsDiscoveryCollapsed] =
    useState<boolean>(false);
  const [isDesktopPanelOpen, setIsDesktopPanelOpen] = useState<boolean>(true);
  const suppressNextCameraMoveRef = useRef<boolean>(false);

  useEffect(() => {
    if (!isLocalityPopoverOpen) return;
    const handleOutside = (ev: MouseEvent) => {
      if (
        localityContainerRef.current &&
        !localityContainerRef.current.contains(ev.target as Node)
      ) {
        setIsLocalityPopoverOpen(false);
      }
    };
    const handleKey = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        setIsLocalityPopoverOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [isLocalityPopoverOpen]);

  useEffect(() => {
    queueMicrotask(() => {
      try {
        const savedCollapsed = localStorage.getItem(
          DISCOVERY_COLLAPSED_STORAGE_KEY
        );
        if (savedCollapsed === 'true' || savedCollapsed === 'false') {
          setIsDiscoveryCollapsed(savedCollapsed === 'true');
        }
        const savedDesktopPanel = localStorage.getItem(
          DESKTOP_PANEL_OPEN_STORAGE_KEY
        );
        if (savedDesktopPanel === 'true' || savedDesktopPanel === 'false') {
          setIsDesktopPanelOpen(savedDesktopPanel === 'true');
        }
      } catch {
        // ignore storage errors
      }
    });
  }, []);

  const updateDiscoveryCollapsed = useCallback((nextCollapsed: boolean) => {
    setIsDiscoveryCollapsed(nextCollapsed);
    if (nextCollapsed) {
      setIsSearchFocused(false);
      setIsSortPopoverOpen(false);
    }
    try {
      localStorage.setItem(
        DISCOVERY_COLLAPSED_STORAGE_KEY,
        nextCollapsed ? 'true' : 'false'
      );
    } catch {
      // ignore
    }
  }, [setIsSearchFocused]);

  const updateDesktopPanelOpen = useCallback((nextOpen: boolean) => {
    suppressNextCameraMoveRef.current = true;
    setIsDesktopPanelOpen(nextOpen);
    try {
      localStorage.setItem(
        DESKTOP_PANEL_OPEN_STORAGE_KEY,
        nextOpen ? 'true' : 'false'
      );
    } catch {
      // ignore
    }
  }, []);

  const activeSortOption = useMemo(
    () => SORT_OPTIONS.find((o) => o.id === sortBy) || SORT_OPTIONS[0],
    [sortBy]
  );

  // Step 4B: Search Scope ('map_area' = Visible Map Area by default, 'global' = Entire Directory)
  const [searchScope, setSearchScope] =
    useState<DiscoverySearchScope>('map_area');

  // Step 4F-B: Geolocation & Configurable Default Map Centre State
  const [isLocating, setIsLocating] = useState<boolean>(false);
  const [locationStatus, setLocationStatus] = useState<{
    type: 'success' | 'error' | 'info';
    message: string;
    timestamp: number;
  } | null>(null);
  const hasUserPannedOrZoomedRef = useRef<boolean>(false);

  // Viewport & Camera State (Committed appliedViewportBounds vs live camera bounds)
  const initialDefaultBounds = useMemo(
    () => computeDefaultViewportBounds(effectiveDefaultCenter, 14),
    [effectiveDefaultCenter]
  );
  const [appliedViewportBounds, setAppliedViewportBounds] =
    useState<MapViewportBounds>(initialDefaultBounds);
  const [liveViewportBounds, setLiveViewportBounds] =
    useState<MapViewportBounds>(initialDefaultBounds);
  const [appliedMapZoom, setAppliedMapZoom] = useState<number>(14);
  const [hasCameraMoved, setHasCameraMoved] = useState<boolean>(false);
  const [recenterTrigger, setRecenterTrigger] = useState<number>(0);
  const [mapZoomLevel, setMapZoomLevel] = useState<number>(14);
  const [mapCenter, setMapCenter] = useState<LatLngPoint>(
    effectiveDefaultCenter
  );
  const [clusterExpansionTarget, setClusterExpansionTarget] = useState<{
    center: LatLngPoint;
    zoom: number;
    bounds: MapViewportBounds;
    seq: number;
    fitBounds?: boolean;
  } | null>(null);
  const [zoomCommand, setZoomCommand] = useState<{
    targetZoom: number;
    seq: number;
  } | null>(null);

  const appliedBoundsRef = useRef<MapViewportBounds>(initialDefaultBounds);
  const liveMapBoundsRef = useRef<MapViewportBounds>(initialDefaultBounds);
  const appliedZoomRef = useRef<number>(14);
  const lastFetchedCameraRef = useRef<{ lat: number; lng: number; zoom: number }>(
    {
      lat: effectiveDefaultCenter.lat,
      lng: effectiveDefaultCenter.lng,
      zoom: 14,
    }
  );
  const hasInitializedBoundsRef = useRef<boolean>(false);
  const cameraDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const searchAreaDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [universalMapStatus, setUniversalMapStatus] =
    useState<MapActivityStatus>('idle');
  const universalStatusTimeoutRef = useRef<ReturnType<
    typeof setTimeout
  > | null>(null);

  useEffect(() => {
    setIsFetching(isLiveFetching || universalMapStatus === 'loading');
    setIsMoving(universalMapStatus === 'moving');
    setMapStatusStore({
      isLoading: isLiveFetching || universalMapStatus === 'loading',
      isPanning: universalMapStatus === 'moving',
    });

    if (isLiveFetching) {
      setAppStatus('fetching_listings');
    } else if (universalMapStatus === 'idle') {
      clearAppStatus();
    }

    return () => {
      setIsFetching(false);
      setIsMoving(false);
      setMapStatusStore({ isLoading: false, isPanning: false });
    };
  }, [isLiveFetching, universalMapStatus, setIsFetching, setIsMoving]);

  useEffect(() => {
    appliedBoundsRef.current = appliedViewportBounds;
  }, [appliedViewportBounds]);

  useEffect(() => {
    appliedZoomRef.current = appliedMapZoom;
  }, [appliedMapZoom]);

  // Dismiss successful location notification automatically after 6 seconds
  useEffect(() => {
    if (!locationStatus || locationStatus.type !== 'success') return;
    const timer = setTimeout(() => {
      setLocationStatus(null);
    }, 6000);
    return () => clearTimeout(timer);
  }, [locationStatus]);

  // Sync initial center on mount or when effectiveDefaultCenter changes before user interaction
  useEffect(() => {
    if (!hasCameraMoved && !hasUserPannedOrZoomedRef.current) {
      const isCustomWithinActiveHub =
        customDefaultCenter &&
        Math.abs(customDefaultCenter.lat - activeHubCenterLat) <= 0.35 &&
        Math.abs(customDefaultCenter.lng - activeHubCenterLng) <= 0.35;

      const cachedMapState = activeHubSlug
        ? readHubMapState(activeHubSlug)
        : null;

      const targetZoom = cachedMapState
        ? cachedMapState.zoom
        : isCustomWithinActiveHub
        ? customDefaultZoom
        : activeHubDefaultZoom;

      const hubCenterPt: LatLngPoint = cachedMapState
        ? cachedMapState.center
        : isCustomWithinActiveHub
        ? effectiveDefaultCenter
        : { lat: activeHubCenterLat, lng: activeHubCenterLng };

      setMapCenter(hubCenterPt);
      setCurrentMapCenter(hubCenterPt);
      setMapZoomLevel(targetZoom);
      setAppliedMapZoom(targetZoom);
      appliedZoomRef.current = targetZoom;
      const b = computeDefaultViewportBounds(hubCenterPt, targetZoom);
      setAppliedViewportBounds(b);
      setLiveViewportBounds(b);
      appliedBoundsRef.current = b;
    }
  }, [
    effectiveDefaultCenter,
    customDefaultCenter,
    customDefaultZoom,
    activeHubCenterLat,
    activeHubCenterLng,
    activeHubDefaultZoom,
    activeHubSlug,
    hasCameraMoved,
    setCurrentMapCenter,
  ]);

  const [isLocationPickerModalOpen, setIsLocationPickerModalOpen] =
    useState(false);
  const [showFirstVisitLocationToast, setShowFirstVisitLocationToast] =
    useState(false);

  // Prompt user non-intrusively on /explore if default map center has not been configured yet
  useEffect(() => {
    if (!isActiveView || typeof window === 'undefined') return;
    if (customDefaultCenter) {
      queueMicrotask(() => setShowFirstVisitLocationToast(false));
      return;
    }
    try {
      const dismissed =
        window.localStorage.getItem(STORAGE_KEY_MAP_PROMPT_DISMISSED) === '1';
      if (dismissed) return;

      const cookieMatch = document.cookie
        .split('; ')
        .find((row) => row.startsWith(`${MAP_SETTINGS_COOKIE_NAME}=`));
      if (cookieMatch) {
        const cookieSettings = parseMapSettings(
          decodeURIComponent(cookieMatch.split('=')[1] || '')
        );
        if (cookieSettings?.configured) return;
      }
    } catch {
      // ignore storage errors
    }

    const timer = window.setTimeout(() => {
      setShowFirstVisitLocationToast(true);
    }, 650);
    return () => window.clearTimeout(timer);
  }, [isActiveView, customDefaultCenter]);

  useEffect(() => {
    return () => {
      if (cameraDebounceRef.current) {
        clearTimeout(cameraDebounceRef.current);
      }
      if (searchAreaDebounceRef.current) {
        clearTimeout(searchAreaDebounceRef.current);
      }
    };
  }, []);

  const handleViewportSync = useCallback(
    (
      bounds: MapViewportBounds,
      centerPt: LatLngPoint,
      z: number,
      isUserInteraction = false
    ) => {
      const distFromInitialCenter = calculateDistanceMeters(
        centerPt,
        effectiveDefaultCenter
      );

      // Ignore the initial mount idle callback so initial bounds stay deterministic across all viewports
      if (
        !hasInitializedBoundsRef.current &&
        distFromInitialCenter < 100 &&
        Math.abs(z - 14) < 0.25
      ) {
        hasInitializedBoundsRef.current = true;
        lastFetchedCameraRef.current = {
          lat: centerPt.lat,
          lng: centerPt.lng,
          zoom: z,
        };
        return;
      }
      hasInitializedBoundsRef.current = true;

      if (cameraDebounceRef.current) {
        clearTimeout(cameraDebounceRef.current);
      }

      cameraDebounceRef.current = setTimeout(() => {
        const hasRealBounds =
          bounds &&
          Number.isFinite(bounds.north) &&
          Number.isFinite(bounds.south) &&
          Number.isFinite(bounds.east) &&
          Number.isFinite(bounds.west) &&
          bounds.north > bounds.south &&
          bounds.east > bounds.west;
        const canonicalBounds = hasRealBounds
          ? bounds
          : computeDefaultViewportBounds(centerPt, z);
        liveMapBoundsRef.current = canonicalBounds;
        setLiveViewportBounds(canonicalBounds);
        setCurrentMapCenter(centerPt);
        setMapCenter((prev) => {
          if (
            Math.abs(prev.lat - centerPt.lat) < 0.00005 &&
            Math.abs(prev.lng - centerPt.lng) < 0.00005
          ) {
            return prev;
          }
          return centerPt;
        });
        setMapZoomLevel((prev) => (Math.abs(prev - z) < 0.05 ? prev : z));

        if (suppressNextCameraMoveRef.current) {
          suppressNextCameraMoveRef.current = false;
          return;
        }

        // Only mark the map area dirty when triggered by genuine user interaction AND exceeding meaningful center/zoom threshold
        if (isUserInteraction) {
          if (activeHubSlug) {
            writeHubMapState(activeHubSlug, centerPt, z);
          }
          const prevCam = lastFetchedCameraRef.current;
          const exceededCameraThreshold =
            Math.abs(centerPt.lat - prevCam.lat) > 0.003 ||
            Math.abs(centerPt.lng - prevCam.lng) > 0.003 ||
            Math.abs(z - prevCam.zoom) >= 1;

          if (
            exceededCameraThreshold ||
            hasMeaningfulViewportChange(
              appliedBoundsRef.current,
              canonicalBounds,
              appliedZoomRef.current,
              z
            )
          ) {
            hasUserPannedOrZoomedRef.current = true;
            setHasCameraMoved(true);
          }
        }

        if (universalStatusTimeoutRef.current) {
          clearTimeout(universalStatusTimeoutRef.current);
        }
        universalStatusTimeoutRef.current = setTimeout(() => {
          setUniversalMapStatus('idle');
        }, 220);
      }, 600);
    },
    [effectiveDefaultCenter, setCurrentMapCenter, activeHubSlug]
  );

  const [userLocation, setUserLocation] = useState<LatLngPoint | null>(null);
  const [isGeolocationPromptOpen, setIsGeolocationPromptOpen] = useState(false);
  const [activeRouteTarget, setActiveRouteTarget] = useState<Listing | null>(
    null
  );
  const [isSettingManualOrigin, setIsSettingManualOrigin] =
    useState<boolean>(false);
  const [activeRouteEstimate, setActiveRouteEstimate] =
    useState<RouteEstimateSummary | null>(null);
  const pendingRouteListingRef = useRef<Listing | null>(null);

  // Phase 60-C: Docked Pick N Drop panel mode inside Listings side panel / bottom sheet
  const [panelMode, setPanelMode] = useState<'listings' | 'pick_n_drop'>(
    'listings'
  );
  const isPickNDropOpen = panelMode === 'pick_n_drop';
  const [pndPickup, setPndPickup] = useState<PickNDropPoint | null>(null);
  const [pndDropoff, setPndDropoff] = useState<PickNDropPoint | null>(null);
  const [pndPinTarget, setPndPinTarget] = useState<
    'pickup' | 'dropoff' | null
  >(null);
  const [pndTripType, setPndTripType] = useState<DeliveryTripType>('one_way');

  const handleClosePickNDrop = useCallback(() => {
    setPanelMode('listings');
    setPndPickup(null);
    setPndDropoff(null);
    setPndPinTarget(null);
  }, []);

  const handleUserLocationResolved = useCallback(
    (userLoc: LatLngPoint) => {
      const targetZoom = 15;
      const newBounds = computeDefaultViewportBounds(userLoc, targetZoom);

      suppressNextCameraMoveRef.current = true;
      hasUserPannedOrZoomedRef.current = true;
      setUserLocation(userLoc);
      setIsSettingManualOrigin(false);
      setMapCenter(userLoc);
      setCurrentMapCenter(userLoc);
      setMapZoomLevel(targetZoom);
      setLiveViewportBounds(newBounds);
      setAppliedViewportBounds(newBounds);
      appliedBoundsRef.current = newBounds;
      setAppliedMapZoom(targetZoom);
      appliedZoomRef.current = targetZoom;
      setHasCameraMoved(true);
      setSearchScope('map_area');

      setClusterExpansionTarget({
        center: userLoc,
        zoom: targetZoom,
        bounds: newBounds,
        seq: Date.now(),
        fitBounds: false,
      });

      if (pendingRouteListingRef.current) {
        setActiveRouteTarget(pendingRouteListingRef.current);
        pendingRouteListingRef.current = null;
      }

      setLocationStatus({
        type: 'success',
        message: `Centred map on your current device location (${userLoc.lat.toFixed(4)}°, ${userLoc.lng.toFixed(4)}°).`,
        timestamp: Date.now(),
      });
    },
    [setCurrentMapCenter]
  );

  // Step 4F-B & Phase 17 & Phase 25-B: Geolocation Locate Me Handler with Manual Center-Pin Fallback
  const handleLocateMe = useCallback(() => {
    if (typeof window === 'undefined' || !navigator.geolocation) {
      if (pendingRouteListingRef.current) {
        setActiveRouteTarget(pendingRouteListingRef.current);
        setIsSettingManualOrigin(true);
        pendingRouteListingRef.current = null;
      }
      setLocationStatus({
        type: 'error',
        message: 'Geolocation is not supported by your current browser environment.',
        timestamp: Date.now(),
      });
      return;
    }

    const savedPref = getSavedGeolocationPreference();
    if (savedPref === 'denied' && pendingRouteListingRef.current) {
      setActiveRouteTarget(pendingRouteListingRef.current);
      setIsSettingManualOrigin(true);
      pendingRouteListingRef.current = null;
      return;
    }

    if (savedPref !== 'granted') {
      setIsGeolocationPromptOpen(true);
      return;
    }

    setIsLocating(true);
    setLocationStatus(null);
    setAppStatus('locating');

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setIsLocating(false);
        clearAppStatus();
        const { latitude, longitude } = pos.coords;
        const userLoc: LatLngPoint = {
          lat: Number(latitude.toFixed(6)),
          lng: Number(longitude.toFixed(6)),
        };
        handleUserLocationResolved(userLoc);
      },
      (err) => {
        setIsLocating(false);
        setAppStatus('error', 'Location error');
        if (pendingRouteListingRef.current) {
          setActiveRouteTarget(pendingRouteListingRef.current);
          setIsSettingManualOrigin(true);
          pendingRouteListingRef.current = null;
        }
        let msg = 'Unable to determine your current location.';
        if (err.code === 1) {
          // PERMISSION_DENIED
          msg = 'Location access was denied. Pan the map to set your starting point manually.';
        } else if (err.code === 2) {
          // POSITION_UNAVAILABLE
          msg = 'Your location is currently unavailable. Pan the map to set your starting point manually.';
        } else if (err.code === 3) {
          // TIMEOUT
          msg = 'Location request timed out. Pan the map to set your starting point manually.';
        }
        setLocationStatus({
          type: 'error',
          message: msg,
          timestamp: Date.now(),
        });
      },
      {
        enableHighAccuracy: true,
        timeout: 10000,
        maximumAge: 60000,
      }
    );
  }, [handleUserLocationResolved]);

  const handleGetDirectionsToListing = useCallback(
    (targetListing: Listing) => {
      setDiscoveryMode('map');
      setIsSettingManualOrigin(false);
      setActiveRouteTarget(targetListing);
    },
    []
  );

  const handleBoundsOnlySync = useCallback((bounds: MapViewportBounds) => {
    if (!hasInitializedBoundsRef.current) {
      hasInitializedBoundsRef.current = true;
      return;
    }
    setUniversalMapStatus('moving');
    if (universalStatusTimeoutRef.current) {
      clearTimeout(universalStatusTimeoutRef.current);
    }
    universalStatusTimeoutRef.current = setTimeout(() => {
      setUniversalMapStatus('idle');
    }, 260);
    setLiveViewportBounds((prev) => {
      if (
        Math.abs(prev.north - bounds.north) < 0.00005 &&
        Math.abs(prev.south - bounds.south) < 0.00005 &&
        Math.abs(prev.east - bounds.east) < 0.00005 &&
        Math.abs(prev.west - bounds.west) < 0.00005
      ) {
        return prev;
      }
      liveMapBoundsRef.current = bounds;
      return bounds;
    });
  }, []);

  // Fullscreen Map State
  const [isFullscreenMap, setIsFullscreenMap] = useState<boolean>(false);
  const toggleFullscreenMap = useCallback(() => {
    suppressNextCameraMoveRef.current = true;
    setIsFullscreenMap((prev) => {
      const next = !prev;
      onFullscreenMapChange?.(next);
      return next;
    });
  }, [onFullscreenMapChange]);

  // Selected & Hovered Listing State (Parts F & G + Phase 50-B Single-Listing Full Fetch)
  const [selectedListingId, setSelectedListingId] = useState<string | null>(
    null
  );
  const [selectedFullListingsById, setSelectedFullListingsById] = useState<
    Record<string, Listing>
  >({});
  const [isLoadingSelectedDetails, setIsLoadingSelectedDetails] =
    useState<boolean>(false);
  const [hoveredListingId, setHoveredListingId] = useState<string | null>(null);
  const [isExpandedDetailModalOpen, setIsExpandedDetailModalOpen] =
    useState<boolean>(false);
  const [summaryModalListing, setSummaryModalListing] =
    useState<Listing | null>(null);
  const [pendingCivicDeepLinkId, setPendingCivicDeepLinkId] = useState<
    string | null
  >(null);

  // Hovered or Tapped Cluster Summary State (Part G)
  const [activeClusterSummary, setActiveClusterSummary] = useState<{
    id: string;
    center: LatLngPoint;
    items: Listing[];
  } | null>(null);

  // Mobile 3-State Bottom Sheet ('collapsed' | 'partial' | 'expanded') & Scroll Preservation (Part E & Step 4D DEF-03)
  const [mobileSheetState, setMobileSheetState] =
    useState<MobileSheetState>('partial');
  const mobileSheetListRef = useRef<HTMLDivElement | null>(null);
  const mobileSheetScrollTopRef = useRef<number>(0);
  const desktopListRef = useRef<HTMLDivElement | null>(null);
  const desktopListScrollTopRef = useRef<number>(0);
  const listModeContainerRef = useRef<HTMLDivElement | null>(null);
  const listModeScrollTopRef = useRef<number>(0);
  const lastAutoScrolledListingIdRef = useRef<string | null>(null);
  const lastHandledFocusSeqRef = useRef<number | null>(null);
  const sheetDragStartYRef = useRef<number | null>(null);
  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  const hasAppliedDeepLinkRef = useRef<boolean>(false);

  // Phase 68-B & 70-B: Smoothly pan & zoom map camera, clear previous hub filters/payloads, and isolate cache whenever activeHub.id changes
  const prevActiveHubIdRef = useRef<string>(activeHubId);
  useEffect(() => {
    if (!activeHubId) return;
    if (
      prevActiveHubIdRef.current &&
      prevActiveHubIdRef.current !== activeHubId
    ) {
      prevActiveHubIdRef.current = activeHubId;

      // 1. Cancel pending map/search debouncers
      if (cameraDebounceRef.current) {
        clearTimeout(cameraDebounceRef.current);
        cameraDebounceRef.current = null;
      }
      if (searchAreaDebounceRef.current) {
        clearTimeout(searchAreaDebounceRef.current);
        searchAreaDebounceRef.current = null;
      }

      // 2. Read hub map state cache or fallback to active hub center & zoom
      const cachedMapState = activeHubSlug ? readHubMapState(activeHubSlug) : null;
      const nextCenter: LatLngPoint = cachedMapState
        ? cachedMapState.center
        : {
            lat: activeHubCenterLat,
            lng: activeHubCenterLng,
          };
      const nextZoom = cachedMapState?.zoom || activeHubDefaultZoom || 14;
      const nextBounds = computeDefaultViewportBounds(nextCenter, nextZoom);

      suppressNextCameraMoveRef.current = true;
      hasUserPannedOrZoomedRef.current = false;

      queueMicrotask(() => {
        // Hydrate cached listings for the new hub or clear immediately to avoid cross-hub leak
        const cachedListings = activeHubSlug ? readHubListingsCache(activeHubSlug) : null;
        if (cachedListings && cachedListings.length > 0) {
          setLivePublishedPayload(cachedListings);
          setHasLoadedLivePayload(true);
          setIsLiveFetching(false);
        } else {
          setLivePublishedPayload([]);
          setHasLoadedLivePayload(false);
          setIsLiveFetching(true);
        }

        // Reset vehicle listings and set loading
        setVehicleListings([]);
        setIsVehiclesLoading(true);

        setSelectedLocality('all');
        setSelectedSubcategoryId(null);
        setSelectedListingId(null);
        setSelectedPropertyType('all');
        setMinRating(0);
        setVerifiedOnly(false);
        setPriceRangeFilter('all');
        setAvailableOnly(false);
        setHas360Only(false);
        setHasCatalogueOnly(false);
        setActiveSpatialFilterShapeId(null);
        setIsExpandedDetailModalOpen(false);
        setActiveClusterSummary(null);
        setMapCenter(nextCenter);
        setCurrentMapCenter(nextCenter);
        setMapZoomLevel(nextZoom);
        setAppliedMapZoom(nextZoom);
        appliedZoomRef.current = nextZoom;
        setLiveViewportBounds(nextBounds);
        setAppliedViewportBounds(nextBounds);
        appliedBoundsRef.current = nextBounds;
        setHasCameraMoved(false);
        setClusterExpansionTarget({
          center: nextCenter,
          zoom: nextZoom,
          bounds: nextBounds,
          seq: Date.now(),
          fitBounds: false,
        });
      });
    } else {
      prevActiveHubIdRef.current = activeHubId;
    }
  }, [
    activeHubId,
    activeHubSlug,
    activeHubCenterLat,
    activeHubCenterLng,
    activeHubDefaultZoom,
    setSelectedLocality,
    setCurrentMapCenter,
  ]);

  // Phase 61-B & 65-B: Hydrate deep-link query params (?q=, ?category=, ?locality=, ?focusLat=&focusLng=, ?mode=pick_n_drop&pickupLat=...&dropoffLat=...)
  useEffect(() => {
    if (typeof window === 'undefined' || hasAppliedDeepLinkRef.current) return;
    hasAppliedDeepLinkRef.current = true;
    const params = new URLSearchParams(window.location.search);
    const civicParam = params.get('civic')?.trim();
    const qParam = params.get('q')?.trim();
    const categoryParam = params.get('category')?.trim().toLowerCase();
    const localityParam = params.get('locality')?.trim();
    const modeParam = params.get('mode')?.trim().toLowerCase();
    const focusLatRaw = params.get('focusLat');
    const focusLngRaw = params.get('focusLng');
    const pickupLatRaw = params.get('pickupLat');
    const pickupLngRaw = params.get('pickupLng');
    const pickupLabelParam = params.get('pickupLabel')?.trim();
    const dropoffLatRaw = params.get('dropoffLat');
    const dropoffLngRaw = params.get('dropoffLng');
    const dropoffLabelParam = params.get('dropoffLabel')?.trim();

    const parseCoord = (
      latStr: string | null,
      lngStr: string | null
    ): { lat: number; lng: number } | null => {
      if (!latStr || !lngStr) return null;
      const lat = Number.parseFloat(latStr);
      const lng = Number.parseFloat(lngStr);
      if (
        !Number.isFinite(lat) ||
        !Number.isFinite(lng) ||
        lat < -90 ||
        lat > 90 ||
        lng < -180 ||
        lng > 180
      ) {
        return null;
      }
      return { lat, lng };
    };

    const focusCoord = parseCoord(focusLatRaw, focusLngRaw);
    const pickupCoord = parseCoord(pickupLatRaw, pickupLngRaw);
    const dropoffCoord = parseCoord(dropoffLatRaw, dropoffLngRaw);

    if (
      !civicParam &&
      !qParam &&
      !categoryParam &&
      !localityParam &&
      modeParam !== 'pick_n_drop' &&
      !focusCoord &&
      !pickupCoord &&
      !dropoffCoord
    ) {
      return;
    }

    queueMicrotask(() => {
      if (civicParam) {
        setPendingCivicDeepLinkId(civicParam);
      }
      if (qParam) {
        setSearchQuery(qParam);
        setSearchScope('global');
      }

      if (categoryParam) {
        if (
          categoryParam === 'vehicles_rentals' ||
          categoryParam === 'vehicles'
        ) {
          setSelectedCategory('vehicles');
        } else if (
          categoryParam === 'printing_digital_services' ||
          isPrintingDigitalCategorySlug(categoryParam)
        ) {
          setSelectedCategory('service');
          setSelectedSubcategoryId(categoryParam);
        } else if (
          categoryParam === 'all' ||
          categoryParam === 'business' ||
          categoryParam === 'service' ||
          categoryParam === 'real_estate' ||
          categoryParam === 'public_place' ||
          categoryParam === 'sports'
        ) {
          setSelectedCategory(categoryParam);
        }
      }

      let cameraTarget: { lat: number; lng: number } | null = focusCoord;

      if (localityParam) {
        const lowerLoc = localityParam.toLowerCase();
        const matchedLoc = appConfigLocalities.find(
          (l) =>
            l.slug.toLowerCase() === lowerLoc ||
            l.display_name.toLowerCase() === lowerLoc
        );
        const resolvedName =
          matchedLoc?.display_name ||
          localityParam
            .replace(/[-_]+/g, ' ')
            .replace(/\b\w/g, (ch) => ch.toUpperCase());
        setSelectedLocality(resolvedName);
        if (
          !cameraTarget &&
          matchedLoc &&
          typeof matchedLoc.lat === 'number' &&
          typeof matchedLoc.lng === 'number' &&
          Number.isFinite(matchedLoc.lat) &&
          Number.isFinite(matchedLoc.lng)
        ) {
          cameraTarget = { lat: matchedLoc.lat, lng: matchedLoc.lng };
        }
      }

      if (pickupCoord) {
        setPndPickup({
          lat: pickupCoord.lat,
          lng: pickupCoord.lng,
          label: pickupLabelParam || 'Selected Pickup Location',
        });
        if (!cameraTarget) {
          cameraTarget = pickupCoord;
        }
      }

      if (dropoffCoord) {
        setPndDropoff({
          lat: dropoffCoord.lat,
          lng: dropoffCoord.lng,
          label: dropoffLabelParam || 'Selected Dropoff Location',
        });
      }

      if (modeParam === 'pick_n_drop' || pickupCoord || dropoffCoord) {
        setPanelMode('pick_n_drop');
        setIsFullscreenMap(false);
        const profile = resolveResponsiveLayoutProfile(
          window.innerWidth,
          window.innerHeight
        );
        if (profile.isSplitScreen) {
          updateDesktopPanelOpen(true);
        } else {
          setMobileSheetState('expanded');
        }
      }

      if (cameraTarget) {
        const targetZoom = 15;
        const nextBounds = computeDefaultViewportBounds(
          cameraTarget,
          targetZoom
        );
        suppressNextCameraMoveRef.current = true;
        setMapCenter(cameraTarget);
        setMapZoomLevel(targetZoom);
        setLiveViewportBounds(nextBounds);
        setClusterExpansionTarget({
          center: cameraTarget,
          zoom: targetZoom,
          bounds: nextBounds,
          seq: Date.now(),
        });
      }
    });
  }, [appConfigLocalities, setSelectedLocality, updateDesktopPanelOpen]);

  // Step 4C: Track viewport dimensions & responsive layout profile (Hydration-Safe)
  const [viewportDims, setViewportDims] = useState<{
    width: number;
    height: number;
  }>({ width: 1440, height: 900 });

  useEffect(() => {
    if (typeof window === 'undefined') return;
    let prevSplit = resolveResponsiveLayoutProfile(
      window.innerWidth,
      window.innerHeight
    ).isSplitScreen;
    const syncViewport = () => {
      const w = window.innerWidth;
      const h = window.innerHeight;
      setViewportDims((prev) =>
        prev.width === w && prev.height === h ? prev : { width: w, height: h }
      );
      const nextProfile = resolveResponsiveLayoutProfile(w, h);
      suppressNextCameraMoveRef.current = true;
      if (prevSplit && !nextProfile.isSplitScreen) {
        setMobileSheetState((prev) =>
          selectedListingId ? 'collapsed' : prev === 'expanded' ? 'partial' : prev
        );
      }
      prevSplit = nextProfile.isSplitScreen;
    };
    queueMicrotask(syncViewport);
    window.addEventListener('resize', syncViewport);
    window.addEventListener('orientationchange', syncViewport);
    return () => {
      window.removeEventListener('resize', syncViewport);
      window.removeEventListener('orientationchange', syncViewport);
    };
  }, [selectedListingId]);

  const activeLayoutProfile = useMemo(
    () =>
      externalLayoutProfile ||
      resolveResponsiveLayoutProfile(viewportDims.width, viewportDims.height),
    [externalLayoutProfile, viewportDims.width, viewportDims.height]
  );

  const isSplitScreen = activeLayoutProfile.isSplitScreen;
  const isMobileLandscape = activeLayoutProfile.isMobileLandscape;
  const isTabletPortrait = activeLayoutProfile.isTabletPortrait;
  const isDesktopViewport = activeLayoutProfile.isDesktop;

  // Step 4C Part A & C + Step 4D DEF-04: Split-Screen Proportions + LocalStorage Persistence & Demo Reset
  const [customSplitByProfile, setCustomSplitByProfile] = useState<
    Partial<Record<ResponsiveLayoutProfile, number>>
  >({});
  const [isResizingSplit, setIsResizingSplit] = useState<boolean>(false);

  useEffect(() => {
    queueMicrotask(() => {
      try {
        const savedSplitRaw = localStorage.getItem(SPLIT_PCT_STORAGE_KEY);
        if (savedSplitRaw) {
          const parsed = JSON.parse(savedSplitRaw);
          if (parsed && typeof parsed === 'object') {
            const validSplit: Partial<
              Record<ResponsiveLayoutProfile, number>
            > = {};
            (
              [
                'mobile-landscape',
                'tablet-landscape',
                'desktop',
              ] as ResponsiveLayoutProfile[]
            ).forEach((prof) => {
              const val = (parsed as Record<string, unknown>)[prof];
              if (typeof val === 'number' && Number.isFinite(val)) {
                validSplit[prof] = val;
              }
            });
            setCustomSplitByProfile(validSplit);
          }
        }
      } catch {
        // ignore storage errors
      }
    });
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleDemoReset = () => {
      setCustomSplitByProfile({});
      try {
        localStorage.removeItem(SPLIT_PCT_STORAGE_KEY);
      } catch {
        // ignore
      }
    };
    window.addEventListener('printswift:reset-demo-data', handleDemoReset);
    return () => {
      window.removeEventListener('printswift:reset-demo-data', handleDemoReset);
    };
  }, []);

  const updateCustomSplitForProfile = useCallback(
    (profile: ResponsiveLayoutProfile, nextPct: number) => {
      setCustomSplitByProfile((prev) => {
        const updated = {
          ...prev,
          [profile]: nextPct,
        };
        try {
          localStorage.setItem(SPLIT_PCT_STORAGE_KEY, JSON.stringify(updated));
        } catch {
          // ignore storage errors
        }
        return updated;
      });
    },
    []
  );

  const splitContainerWidth = useMemo(
    () =>
      activeLayoutProfile.useVerticalNavRail
        ? Math.max(480, viewportDims.width - 56)
        : viewportDims.width,
    [activeLayoutProfile.useVerticalNavRail, viewportDims.width]
  );

  const effectiveListingSplitPct = useMemo(() => {
    const rawPct =
      customSplitByProfile[activeLayoutProfile.profile] ??
      activeLayoutProfile.defaultListingSplitPct;
    return clampSplitListingPercentage(
      rawPct,
      splitContainerWidth,
      activeLayoutProfile
    );
  }, [
    customSplitByProfile,
    activeLayoutProfile,
    splitContainerWidth,
  ]);

  const splitDividerAriaMetrics = useMemo(() => {
    const minListingPct = clampSplitListingPercentage(
      0,
      splitContainerWidth,
      activeLayoutProfile
    );
    const maxListingPct = clampSplitListingPercentage(
      100,
      splitContainerWidth,
      activeLayoutProfile
    );
    const mapPct = Math.round(100 - effectiveListingSplitPct);
    const listingPct = 100 - mapPct;
    const minMapPct = Math.round(100 - maxListingPct);
    const maxMapPct = Math.round(100 - minListingPct);
    return {
      valueNow: mapPct,
      valueMin: minMapPct,
      valueMax: maxMapPct,
      listingPct,
      valueText: `${mapPct}% Map, ${listingPct}% Listings`,
    };
  }, [effectiveListingSplitPct, splitContainerWidth, activeLayoutProfile]);

  const handleResizeSplitStart = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      if (!isSplitScreen) return;
      e.preventDefault();
      e.stopPropagation();
      setIsResizingSplit(true);
      suppressNextCameraMoveRef.current = true;

      const handlePointerMove = (moveEv: PointerEvent) => {
        const container = splitContainerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        if (rect.width <= 0) return;
        const listingWidthPx = rect.right - moveEv.clientX;
        const requestedPct = (listingWidthPx / rect.width) * 100;
        const clamped = clampSplitListingPercentage(
          requestedPct,
          rect.width,
          activeLayoutProfile
        );
        suppressNextCameraMoveRef.current = true;
        updateCustomSplitForProfile(activeLayoutProfile.profile, clamped);
      };

      const handlePointerUp = () => {
        setIsResizingSplit(false);
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
      };

      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
    },
    [isSplitScreen, activeLayoutProfile, updateCustomSplitForProfile]
  );

  const handleResizeSplitKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLDivElement>) => {
      if (!isSplitScreen) return;
      const containerWidth =
        splitContainerRef.current?.clientWidth || splitContainerWidth;
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        const nextPct = clampSplitListingPercentage(
          effectiveListingSplitPct + 2,
          containerWidth,
          activeLayoutProfile
        );
        suppressNextCameraMoveRef.current = true;
        updateCustomSplitForProfile(activeLayoutProfile.profile, nextPct);
      } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        const nextPct = clampSplitListingPercentage(
          effectiveListingSplitPct - 2,
          containerWidth,
          activeLayoutProfile
        );
        suppressNextCameraMoveRef.current = true;
        updateCustomSplitForProfile(activeLayoutProfile.profile, nextPct);
      } else if (e.key === 'Home' || e.key === 'Enter') {
        e.preventDefault();
        suppressNextCameraMoveRef.current = true;
        updateCustomSplitForProfile(
          activeLayoutProfile.profile,
          activeLayoutProfile.defaultListingSplitPct
        );
      } else if (e.key === 'End') {
        e.preventDefault();
        const minListingPct = clampSplitListingPercentage(
          0,
          containerWidth,
          activeLayoutProfile
        );
        suppressNextCameraMoveRef.current = true;
        updateCustomSplitForProfile(
          activeLayoutProfile.profile,
          minListingPct
        );
      }
    },
    [
      isSplitScreen,
      splitContainerWidth,
      effectiveListingSplitPct,
      activeLayoutProfile,
      updateCustomSplitForProfile,
    ]
  );

  // Step 4D DEF-01 & DEF-03: Restore mobile/tablet bottom-sheet scroll position when reopening or returning to Explore
  useEffect(() => {
    if (!isActiveView) return;
    suppressNextCameraMoveRef.current = true;
    if (discoveryMode !== 'map') return;
    if (
      (mobileSheetState === 'partial' || mobileSheetState === 'expanded') &&
      mobileSheetListRef.current
    ) {
      const savedTop = mobileSheetScrollTopRef.current;
      mobileSheetListRef.current.scrollTop = savedTop;
      const rafId = requestAnimationFrame(() => {
        if (mobileSheetListRef.current) {
          mobileSheetListRef.current.scrollTop = savedTop;
        }
      });
      return () => cancelAnimationFrame(rafId);
    }
  }, [isActiveView, discoveryMode, mobileSheetState, isSplitScreen]);

  // Step 4D DEF-03: Restore desktop/split sidebar scroll position when re-expanding panel or returning to Explore
  useEffect(() => {
    if (!isActiveView || discoveryMode !== 'map') return;
    if (isDesktopPanelOpen && desktopListRef.current) {
      const savedTop = desktopListScrollTopRef.current;
      desktopListRef.current.scrollTop = savedTop;
      const rafId = requestAnimationFrame(() => {
        if (desktopListRef.current) {
          desktopListRef.current.scrollTop = savedTop;
        }
      });
      return () => cancelAnimationFrame(rafId);
    }
  }, [isActiveView, discoveryMode, isDesktopPanelOpen, isSplitScreen]);

  // Step 4D DEF-01 & DEF-03: Restore List mode scroll position when returning to List mode or Explore
  useEffect(() => {
    if (!isActiveView || discoveryMode !== 'list') return;
    if (listModeContainerRef.current) {
      const savedTop = listModeScrollTopRef.current;
      listModeContainerRef.current.scrollTop = savedTop;
      const rafId = requestAnimationFrame(() => {
        if (listModeContainerRef.current) {
          listModeContainerRef.current.scrollTop = savedTop;
        }
      });
      return () => cancelAnimationFrame(rafId);
    }
  }, [isActiveView, discoveryMode]);

  // Draw & Measure State (Part D)
  const [isDrawToolboxOpen, setIsDrawToolboxOpen] = useState<boolean>(false);
  const [activeDrawTool, setActiveDrawTool] = useState<ActiveDrawTool>('none');
  const [inProgressPoints, setInProgressPoints] = useState<LatLngPoint[]>([]);
  const [circleRadiusDraft, setCircleRadiusDraft] = useState<number>(350);
  const [selectedShapeId, setSelectedShapeId] = useState<string | null>(null);
  const [mapToolbarPosition, setMapToolbarPosition] =
    useState<MapToolbarPosition>('top-right');
  const [drawToolboxPosition, setDrawToolboxPosition] =
    useState<MapToolbarPosition>('top-left');

  const mapViewportRef = useRef<HTMLDivElement | null>(null);

  // Close search suggestions or sort popover on outside click or Escape
  useEffect(() => {
    if (!isSearchFocused && !isSortPopoverOpen) return;
    const handleOutside = (ev: MouseEvent) => {
      if (
        isSearchFocused &&
        searchContainerRef.current &&
        !searchContainerRef.current.contains(ev.target as Node)
      ) {
        setIsSearchFocused(false);
      }
      if (
        isSortPopoverOpen &&
        sortContainerRef.current &&
        !sortContainerRef.current.contains(ev.target as Node)
      ) {
        setIsSortPopoverOpen(false);
      }
    };
    const handleKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        if (document.querySelector('[role="dialog"][aria-modal="true"]')) return;
        setIsSearchFocused(false);
        setIsSortPopoverOpen(false);
      }
    };
    document.addEventListener('mousedown', handleOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isSearchFocused, isSortPopoverOpen, setIsSearchFocused]);

  const expandedDetailsModalRef = useRef<HTMLDivElement | null>(null);
  const cloudStyleModalRef = useRef<HTMLDivElement | null>(null);

  // Step 4D Package 2A/2B: Escape key dismissal for Cloud Style modal and Expanded Details overlay
  useEffect(() => {
    if (!isCloudStyleModalOpen && !isExpandedDetailModalOpen) return;
    const handleModalEscape = (ev: KeyboardEvent) => {
      if (ev.key !== 'Escape') return;
      // Defer if an AppShell-level modal is open on top
      if (
        document.getElementById('theme-settings-title') ||
        document.getElementById('reset-demo-modal-title')
      ) {
        return;
      }
      if (
        isCloudStyleModalOpen &&
        isTopmostActiveModal('cloud-style-modal')
      ) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        setIsCloudStyleModalOpen(false);
        return;
      }
      if (
        isExpandedDetailModalOpen &&
        isTopmostActiveModal('expanded-details-overlay')
      ) {
        ev.preventDefault();
        ev.stopImmediatePropagation();
        setIsExpandedDetailModalOpen(false);
      }
    };
    document.addEventListener('keydown', handleModalEscape);
    return () => {
      document.removeEventListener('keydown', handleModalEscape);
    };
  }, [isCloudStyleModalOpen, isExpandedDetailModalOpen]);

  // Phase 68-B: Populate localities strictly from verified hubLocalities for activeHub.id
  const configuredLocalityNames = useMemo(() => {
    const verifiedForHub = hubLocalities
      .filter(
        (loc) =>
          loc.is_active &&
          loc.status === 'verified' &&
          loc.display_name.trim() &&
          (!activeHubId ||
            activeHubId.startsWith('fallback-') ||
            !loc.hub_id ||
            loc.hub_id === activeHubId)
      )
      .map((loc) => loc.display_name.trim());
    if (verifiedForHub.length > 0) {
      return Array.from(new Set(verifiedForHub));
    }
    const dynamicNames = appConfigLocalities
      .filter((loc) => loc.is_active && loc.display_name.trim())
      .map((loc) => loc.display_name.trim());
    return dynamicNames.length > 0 ? dynamicNames : CHURACHANDPUR_LOCALITIES;
  }, [hubLocalities, activeHubId, appConfigLocalities]);

  const localities = useMemo(() => {
    return ['all', ...configuredLocalityNames];
  }, [configuredLocalityNames]);

  const activeFilterShape = useMemo(
    () =>
      drawnShapes.find((s) => s.id === activeSpatialFilterShapeId) || null,
    [drawnShapes, activeSpatialFilterShapeId]
  );

  // Phase 5 & 68-B: Synchronize live Supabase published listings with local store listings (strictly scoped to activeHub)
  const activeDirectoryListings = useMemo(() => {
    if (hasLoadedLivePayload || livePublishedPayload.length > 0) {
      return livePublishedPayload;
    }
    if (activeHubSlug !== 'churachandpur') {
      return [];
    }
    return listings;
  }, [hasLoadedLivePayload, livePublishedPayload, activeHubSlug, listings]);

  // Published listings with valid geographic coordinates (Step 4B Requirement 7 coordinate guard + Step 4F-D1 Real Estate Mode)
  const publishedListings = useMemo(
    () =>
      activeDirectoryListings.filter(
        (l) =>
          l &&
          l.status === 'published' &&
          hasValidListingCoordinates(l) &&
          (!isRealEstateMode ||
            l.category === 'real_estate' ||
            (l.category as string) === 'real-estate')
      ),
    [activeDirectoryListings, isRealEstateMode]
  );

  // Phase 25-A: Category Quantities & Descending Sort Order
  const categoryQuantities = useMemo(() => {
    const counts: Record<string, number> = {
      business: 0,
      service: 0,
      real_estate: 0,
      sports: 0,
      public_place: 0,
    };
    for (const item of publishedListings) {
      const normalized = String(item.category || 'business').replace(/-/g, '_');
      counts[normalized] = (counts[normalized] || 0) + 1;
    }
    return counts;
  }, [publishedListings]);

  const sortedDynamicCategories = useMemo(() => {
    const slugToListingCategory = (slugRaw: string): ListingCategory | null => {
      const norm = slugRaw.trim().toLowerCase().replace(/-/g, '_');
      if (norm === 'vehicles_rentals' || norm === 'vehicles') return null;
      if (
        norm === 'business' ||
        norm === 'businesses_shops' ||
        norm === 'retail_shopping'
      ) {
        return 'business';
      }
      if (norm === 'service' || norm === 'services' || norm === 'print_digital') {
        return 'service';
      }
      if (norm === 'real_estate') return 'real_estate';
      if (norm === 'sports') return 'sports';
      if (norm === 'public_place' || norm === 'public_community') {
        return 'public_place';
      }
      return norm as ListingCategory;
    };

    const configExploreCats = appConfigCategories.filter(
      (c) => c.module === 'explore' && c.is_active
    );

    if (configExploreCats.length > 0) {
      const seen = new Set<string>();
      const mapped: Array<{
        cat: { id: string; name: string; slug: string };
        catKey: ListingCategory;
        catLabel: string;
        count: number;
      }> = [];
      for (const cfg of configExploreCats) {
        const mappedKey = slugToListingCategory(cfg.slug);
        if (!mappedKey || seen.has(mappedKey)) continue;
        seen.add(mappedKey);
        mapped.push({
          cat: { id: cfg.slug, name: cfg.display_name, slug: cfg.slug },
          catKey: mappedKey,
          catLabel: cfg.display_name || CATEGORY_LABELS[mappedKey] || cfg.slug,
          count: categoryQuantities[mappedKey] ?? 0,
        });
      }
      if (mapped.length > 0) {
        return mapped;
      }
    }

    const sourceCategories =
      dynamicCategories && dynamicCategories.length > 0
        ? dynamicCategories
        : [
            { id: 'business', name: CATEGORY_LABELS.business, slug: 'business' },
            { id: 'service', name: CATEGORY_LABELS.service, slug: 'service' },
            {
              id: 'real_estate',
              name: CATEGORY_LABELS.real_estate,
              slug: 'real_estate',
            },
            { id: 'sports', name: CATEGORY_LABELS.sports, slug: 'sports' },
            {
              id: 'public_place',
              name: CATEGORY_LABELS.public_place,
              slug: 'public_place',
            },
          ];
    return [...sourceCategories]
      .map((cat) => {
        const catKey = (cat.slug || cat.type || cat.id || 'business')
          .toString()
          .replace(/-/g, '_') as ListingCategory;
        const catLabel = cat.name || CATEGORY_LABELS[catKey] || catKey;
        const count = categoryQuantities[catKey] ?? 0;
        return { cat, catKey, catLabel, count };
      })
      .sort((a, b) => b.count - a.count);
  }, [appConfigCategories, dynamicCategories, categoryQuantities]);

  const desktopSortedCategories = useMemo(
    () =>
      [...sortedDynamicCategories].sort((a, b) => {
        const aMatchesActive =
          selectedCategory !== 'all' &&
          (a.catKey === selectedCategory || a.cat.id === selectedCategory);
        const bMatchesActive =
          selectedCategory !== 'all' &&
          (b.catKey === selectedCategory || b.cat.id === selectedCategory);
        if (aMatchesActive && !bMatchesActive) return -1;
        if (!aMatchesActive && bMatchesActive) return 1;
        return b.count - a.count;
      }),
    [sortedDynamicCategories, selectedCategory]
  );

  const handleSelectDiscoveryCategory = useCallback(
    (cat: ListingCategory | 'all' | 'vehicles') => {
      setSelectedCategory(cat);
      setSelectedSubcategoryId(null);
      setSelectedPrintCapability('all');
      setSelectedListingId(null);
      setIsExpandedDetailModalOpen(false);
      setActiveClusterSummary(null);
      if (cat !== 'real_estate') {
        setSelectedPropertyType('all');
      }
    },
    []
  );

  // Phase 68-B: Resolve depth-1 and depth-2 subcategories for the active root category from categoriesByEntity.listing
  const activeRootCategorySubcategories = useMemo(() => {
    if (selectedCategory === 'all' || selectedCategory === 'vehicles') {
      return [];
    }
    const listingTree = categoriesByEntity?.listing || [];
    const matchRoot = listingTree.find((node) => {
      const s = node.slug.toLowerCase().replace(/-/g, '_');
      if (selectedCategory === 'business') {
        return (
          s === 'business' ||
          s === 'businesses_shops' ||
          s === 'retail_shopping'
        );
      }
      if (selectedCategory === 'service') {
        return (
          s === 'service' ||
          s === 'services' ||
          s === 'print_digital' ||
          s === 'services_repairs'
        );
      }
      if (selectedCategory === 'real_estate') {
        return s === 'real_estate' || s === 'real_estate_rentals';
      }
      if (selectedCategory === 'public_place') {
        return (
          s === 'public_place' ||
          s === 'public_community' ||
          s === 'public_places_institutions'
        );
      }
      if (selectedCategory === 'sports') {
        return s === 'sports' || s === 'sports_recreation';
      }
      return s === selectedCategory;
    });
    if (!matchRoot || !Array.isArray(matchRoot.children)) return [];
    const flattened: Array<{
      id: string;
      slug: string;
      display_name: string;
      depth: number;
    }> = [];
    for (const child of matchRoot.children) {
      if (!child.is_active) continue;
      flattened.push({
        id: child.id,
        slug: child.slug,
        display_name: child.display_name,
        depth: typeof child.depth === 'number' ? child.depth : 1,
      });
      if (Array.isArray(child.children)) {
        for (const grandChild of child.children) {
          if (!grandChild.is_active) continue;
          flattened.push({
            id: grandChild.id,
            slug: grandChild.slug,
            display_name: `${child.display_name} › ${grandChild.display_name}`,
            depth: typeof grandChild.depth === 'number' ? grandChild.depth : 2,
          });
        }
      }
    }
    return flattened;
  }, [selectedCategory, categoriesByEntity]);

  const activeCategorySubtreeIdsOrSlugs = useMemo(() => {
    if (selectedSubcategoryId) {
      const subtree = getCategorySubtreeSlugsOrIds(selectedSubcategoryId, 'listing');
      return [...subtree.ids, ...subtree.slugs];
    }
    if (selectedCategory !== 'all' && selectedCategory !== 'vehicles') {
      const subtree = getCategorySubtreeSlugsOrIds(selectedCategory, 'listing');
      return [...subtree.ids, ...subtree.slugs];
    }
    return [];
  }, [
    selectedSubcategoryId,
    selectedCategory,
    getCategorySubtreeSlugsOrIds,
  ]);

  // Filtered Vehicle Listings (by search query & locality)
  const filteredVehicleListings = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return vehicleListings.filter((v) => {
      if (
        selectedLocality !== 'all' &&
        !String(v.stand_locality || '')
          .toLowerCase()
          .includes(selectedLocality.toLowerCase())
      ) {
        return false;
      }
      if (!q) return true;
      return (
        String(v.title || '').toLowerCase().includes(q) ||
        String(v.stand_locality || '').toLowerCase().includes(q) ||
        String(v.description || '').toLowerCase().includes(q) ||
        (Array.isArray(v.features) &&
          v.features.some((f) => f.toLowerCase().includes(q)))
      );
    });
  }, [vehicleListings, searchQuery, selectedLocality]);

  // Search Suggestions (listings, categories, localities across published directory)
  const searchSuggestions = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return [];
    const matchedListings = publishedListings
      .filter(
        (l) =>
          l.title.toLowerCase().includes(q) ||
          l.subcategory.toLowerCase().includes(q) ||
          l.locality.toLowerCase().includes(q) ||
          (CATEGORY_LABELS[l.category] || String(l.category || ''))
            .toLowerCase()
            .includes(q)
      )
      .slice(0, 5);
    return matchedListings;
  }, [publishedListings, searchQuery]);

  const effectiveAppliedViewportBounds = useMemo<MapViewportBounds>(() => {
    if (!hasCameraMoved && livePublishedPayload.length > 0) {
      let north = appliedViewportBounds.north;
      let south = appliedViewportBounds.south;
      let east = appliedViewportBounds.east;
      let west = appliedViewportBounds.west;
      for (const item of livePublishedPayload) {
        if (hasValidListingCoordinates(item)) {
          north = Math.max(north, item.coordinates.lat + 0.002);
          south = Math.min(south, item.coordinates.lat - 0.002);
          east = Math.max(east, item.coordinates.lng + 0.002);
          west = Math.min(west, item.coordinates.lng - 0.002);
        }
      }
      return { north, south, east, west };
    }
    return appliedViewportBounds;
  }, [hasCameraMoved, livePublishedPayload, appliedViewportBounds]);

  // Phase 71-D: Detect when Printing & Digital Services (or any child subcategory) is active
  const isPrintingCategoryActive = useMemo(() => {
    if (selectedPrintCapability !== 'all') return true;
    if (selectedSubcategoryId) {
      if (isPrintingDigitalCategorySlug(selectedSubcategoryId)) return true;
      const matchedSub = activeRootCategorySubcategories.find(
        (sub) =>
          sub.id === selectedSubcategoryId || sub.slug === selectedSubcategoryId
      );
      if (
        matchedSub &&
        (isPrintingDigitalCategorySlug(matchedSub.slug) ||
          isPrintingDigitalCategorySlug(matchedSub.display_name))
      ) {
        return true;
      }
    }
    return false;
  }, [
    selectedPrintCapability,
    selectedSubcategoryId,
    activeRootCategorySubcategories,
  ]);

  // Step 4B & Phase 68-B & 71-D: Filtered & Sorted Listings (Memoized on committed effectiveAppliedViewportBounds + hubId + categorySubtree + verified print capabilities)
  const filteredListings = useMemo(() => {
    if (selectedCategory === 'vehicles') return [];
    const baseFiltered = filterDiscoveryListings(publishedListings, {
      searchQuery,
      searchScope,
      appliedViewportBounds: effectiveAppliedViewportBounds,
      selectedCategory: isRealEstateMode ? 'real_estate' : selectedCategory,
      selectedSubcategoryId,
      categorySubtreeIdsOrSlugs: activeCategorySubtreeIdsOrSlugs,
      hubId:
        activeHubId && !activeHubId.startsWith('fallback-')
          ? activeHubId
          : null,
      selectedPropertyType,
      selectedLocality,
      minRating,
      verifiedOnly,
      availableOnly,
      has360Only,
      hasCatalogueOnly,
      priceRangeFilter,
      activeFilterShape,
      sortBy,
      mapCenter,
    });
    if (selectedPrintCapability === 'all') return baseFiltered;
    return baseFiltered.filter((l) =>
      matchesPrintCapabilityFilter(
        printProfilesByListingId[l.id],
        selectedPrintCapability
      )
    );
  }, [
    publishedListings,
    isRealEstateMode,
    searchQuery,
    searchScope,
    effectiveAppliedViewportBounds,
    selectedCategory,
    selectedSubcategoryId,
    activeCategorySubtreeIdsOrSlugs,
    activeHubId,
    selectedPropertyType,
    selectedLocality,
    minRating,
    verifiedOnly,
    availableOnly,
    has360Only,
    hasCatalogueOnly,
    priceRangeFilter,
    activeFilterShape,
    sortBy,
    mapCenter,
    selectedPrintCapability,
    printProfilesByListingId,
  ]);

  // Live area match count preview for the "Search This Area" button when camera has moved
  const liveAreaMatchCount = useMemo(() => {
    if (selectedCategory === 'vehicles') return filteredVehicleListings.length;
    if (!hasCameraMoved) return filteredListings.length;
    const base = filterDiscoveryListings(publishedListings, {
      searchQuery,
      searchScope: 'map_area',
      appliedViewportBounds: liveViewportBounds,
      selectedCategory: isRealEstateMode ? 'real_estate' : selectedCategory,
      selectedSubcategoryId,
      categorySubtreeIdsOrSlugs: activeCategorySubtreeIdsOrSlugs,
      hubId:
        activeHubId && !activeHubId.startsWith('fallback-')
          ? activeHubId
          : null,
      selectedPropertyType,
      selectedLocality,
      minRating,
      verifiedOnly,
      availableOnly,
      has360Only,
      hasCatalogueOnly,
      priceRangeFilter,
      activeFilterShape,
      sortBy,
      mapCenter,
    });
    if (selectedPrintCapability === 'all') return base.length;
    return base.filter((l) =>
      matchesPrintCapabilityFilter(
        printProfilesByListingId[l.id],
        selectedPrintCapability
      )
    ).length;
  }, [
    hasCameraMoved,
    filteredListings.length,
    filteredVehicleListings.length,
    publishedListings,
    isRealEstateMode,
    searchQuery,
    liveViewportBounds,
    selectedCategory,
    selectedSubcategoryId,
    activeCategorySubtreeIdsOrSlugs,
    activeHubId,
    selectedPropertyType,
    selectedLocality,
    minRating,
    verifiedOnly,
    availableOnly,
    has360Only,
    hasCatalogueOnly,
    priceRangeFilter,
    activeFilterShape,
    sortBy,
    mapCenter,
    selectedPrintCapability,
    printProfilesByListingId,
  ]);

  const renderVehicleFeedSection = (gridClassName: string) => {
    if (isVehiclesLoading) {
      return (
        <AppBrandLoader
          mode="inline"
          message="Loading available vehicles & charters…"
          className="col-span-full min-h-[260px] py-8"
        />
      );
    }
    if (filteredVehicleListings.length === 0) {
      return (
        <div className="col-span-full rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 text-center space-y-2">
          <Car className="mx-auto h-6 w-6 text-[var(--ps-text-muted)]" />
          <p className="text-xs font-bold text-[var(--ps-text)]">
            No matching vehicles found
          </p>
          <p className="text-[11px] text-[var(--ps-text-muted)]">
            Try clearing your search or locality filter to view all Lamka stand rentals &amp; charters.
          </p>
        </div>
      );
    }
    return (
      <div className={`col-span-full ${gridClassName}`}>
        {filteredVehicleListings.map((veh) => {
          const thumb = resolveRemoteMediaUrl(veh.thumbnail_url || '');
          const cleanTitle = veh.title.replace(/^\[SAMPLE\]\s*/i, '');
          const rateLabel = veh.rate_daily_inr
            ? `₹${Number(veh.rate_daily_inr).toLocaleString('en-IN')}/day`
            : veh.rate_hourly_inr
              ? `₹${Number(veh.rate_hourly_inr).toLocaleString('en-IN')}/hr`
              : Array.isArray(veh.fixed_routes) && veh.fixed_routes.length > 0
                ? `From ₹${Number(veh.fixed_routes[0].fare_inr).toLocaleString('en-IN')}`
                : 'Custom Charter';

          return (
            <Link
              key={veh.id}
              href={`/vehicles/${encodeURIComponent(veh.id)}`}
              data-testid={`explore-vehicle-card-${veh.id}`}
              className="group overflow-hidden rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] hover:border-[var(--ps-accent)] transition-all shadow-2xs flex flex-col"
            >
              <div className="relative aspect-[16/10] w-full bg-[var(--ps-bg)] overflow-hidden">
                {thumb ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={thumb}
                    alt={cleanTitle}
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover group-hover:scale-[1.03] transition-transform duration-300"
                  />
                ) : (
                  <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-gradient-to-br from-slate-900 to-slate-800 text-slate-200">
                    <Car className="h-6 w-6 text-amber-400" />
                    <span className="text-[10px] font-semibold">
                      {veh.stand_locality}
                    </span>
                  </div>
                )}
                <div className="absolute left-2 top-2 flex flex-wrap gap-1">
                  <span className="rounded-md bg-slate-950/80 px-2 py-0.5 text-[10px] font-bold text-white">
                    {veh.with_driver ? 'With Driver' : 'Self-Drive'}
                  </span>
                  {veh.is_verified && (
                    <span className="inline-flex items-center gap-0.5 rounded-md bg-emerald-600/95 px-1.5 py-0.5 text-[10px] font-bold text-white">
                      <ShieldCheck className="h-2.5 w-2.5" />
                      Verified
                    </span>
                  )}
                </div>
                <span className="absolute right-2 bottom-2 rounded-md bg-slate-950/85 px-2 py-0.5 text-[11px] font-extrabold tabular-nums text-amber-300">
                  {rateLabel}
                </span>
              </div>

              <div className="p-3 space-y-1.5 flex-1 flex flex-col justify-between">
                <div className="space-y-1">
                  <h3 className="text-xs sm:text-sm font-bold text-[var(--ps-text)] line-clamp-1 group-hover:text-[var(--ps-accent)] transition-colors">
                    {cleanTitle}
                  </h3>
                  <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[11px] text-[var(--ps-text-muted)]">
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="h-3 w-3 text-[var(--ps-accent)]" />
                      {veh.stand_locality}
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Users className="h-3 w-3" />
                      {veh.total_seats} Seats
                    </span>
                  </div>
                  {Array.isArray(veh.destination_hub_ids) &&
                    veh.destination_hub_ids.length > 0 &&
                    (() => {
                      const originHubObj = hubs.find(
                        (h) => h.id === veh.origin_hub_id
                      );
                      const destNames = veh.destination_hub_ids
                        .map((dId) => hubs.find((h) => h.id === dId)?.name)
                        .filter(Boolean);
                      if (destNames.length === 0) return null;
                      const originName = originHubObj?.name || activeHubName;
                      return (
                        <div
                          data-testid={`explore-vehicle-interhub-badge-${veh.id}`}
                          className="inline-flex items-center gap-1 rounded-md border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700 dark:text-indigo-300"
                        >
                          <ArrowLeftRight className="h-2.5 w-2.5 shrink-0" />
                          <span className="truncate">
                            {originName} ↔ {destNames.join(', ')}
                          </span>
                        </div>
                      );
                    })()}
                </div>
                <div className="flex items-center justify-between gap-2 pt-1.5 border-t border-[var(--ps-border)] text-[11px]">
                  <span className="text-[var(--ps-text-muted)] truncate">
                    {veh.booking_mode === 'both'
                      ? 'Full / Per-Seat'
                      : veh.booking_mode === 'per_seat'
                        ? 'Per-Seat'
                        : 'Full Charter'}
                  </span>
                  <span className="font-bold text-[var(--ps-accent)] shrink-0">
                    Schedule &amp; Book →
                  </span>
                </div>
              </div>
            </Link>
          );
        })}
      </div>
    );
  };

  // Phase 50-B: Trigger targeted single-listing full fetch when a marker or list item is selected
  useEffect(() => {
    if (!selectedListingId) {
      return;
    }
    const selectedId = selectedListingId;
    if (selectedFullListingsById[selectedId]) {
      return;
    }

    let cancelled = false;

    async function loadSingleListingFullDetails() {
      setIsLoadingSelectedDetails(true);
      try {
        if (isSupabaseConfigured()) {
          const { data } = await supabase
            .from('listings')
            .select('*')
            .eq('id', selectedId)
            .single();

          if (!cancelled && data) {
            const fullMapped = mapRowToListing(
              data as unknown as SupabaseListingRow
            );
            setSelectedFullListingsById((prev) => ({
              ...prev,
              [selectedId]: fullMapped,
            }));
          }
        }
      } catch {
        // Keep brief listing data in memory if single-row fetch fails
      } finally {
        if (!cancelled) {
          setIsLoadingSelectedDetails(false);
        }
      }
    }

    void loadSingleListingFullDetails();
    return () => {
      cancelled = true;
    };
  }, [selectedListingId, selectedFullListingsById]);

  const selectedListing = useMemo(() => {
    const baseMatch =
      activeDirectoryListings.find(
        (l) =>
          l &&
          l.id === selectedListingId &&
          hasValidListingCoordinates(l) &&
          (!isRealEstateMode ||
            l.category === 'real_estate' ||
            (l.category as string) === 'real-estate')
      ) || null;
    if (!baseMatch) return null;
    const fullRecord = selectedListingId
      ? selectedFullListingsById[selectedListingId]
      : undefined;
    return fullRecord ? { ...baseMatch, ...fullRecord } : baseMatch;
  }, [
    activeDirectoryListings,
    selectedListingId,
    isRealEstateMode,
    selectedFullListingsById,
  ]);

  useModalFocusManagement({
    id: 'filter-drawer-modal',
    open: isFilterModalOpen,
    dialogSelector: '[data-testid="filter-drawer-modal"]',
  });

  useModalFocusManagement({
    id: 'expanded-details-overlay',
    open: Boolean(isExpandedDetailModalOpen && selectedListing),
    dialogRef: expandedDetailsModalRef,
  });

  useModalFocusManagement({
    id: 'cloud-style-modal',
    open: isCloudStyleModalOpen,
    dialogRef: cloudStyleModalRef,
    fallbackTriggerSelector: '[data-testid="map-toolbar-style-btn"]',
  });

  const hoveredListing = useMemo(
    () =>
      activeDirectoryListings.find(
        (l) => l && l.id === hoveredListingId && hasValidListingCoordinates(l)
      ) || null,
    [activeDirectoryListings, hoveredListingId]
  );

  // Separate array strictly for @googlemaps/markerclusterer (excludes selectedListing?.id so active pin is never swallowed by a cluster bubble)
  const clusteredMapListings = useMemo(
    () =>
      filteredListings.filter((l) => l.id !== selectedListing?.id),
    [filteredListings, selectedListing?.id]
  );

  // Clustering calculation for zoomed-out map states (with duplicate-marker prevention)
  const { clusters, unclusteredListings } = useMemo(() => {
    const shouldIncludeSelectedPin =
      selectedListing &&
      (searchScope === 'global' ||
        isPointInViewport(selectedListing.coordinates, appliedViewportBounds));

    if (mapZoomLevel >= 14) {
      if (
        shouldIncludeSelectedPin &&
        selectedListing &&
        !filteredListings.some((l) => l.id === selectedListing.id)
      ) {
        return {
          clusters: [],
          unclusteredListings: [selectedListing, ...filteredListings],
        };
      }
      return { clusters: [], unclusteredListings: filteredListings };
    }
    const gridSize = mapZoomLevel <= 11 ? 0.018 : 0.009;
    const buckets = new Map<string, Listing[]>();

    filteredListings.forEach((item) => {
      if (item.id === selectedListingId) return;
      const latKey = Math.floor(item.coordinates.lat / gridSize);
      const lngKey = Math.floor(item.coordinates.lng / gridSize);
      const key = `${latKey}:${lngKey}`;
      const existing = buckets.get(key) || [];
      existing.push(item);
      buckets.set(key, existing);
    });

    const clusterList: Array<{
      id: string;
      center: LatLngPoint;
      items: Listing[];
    }> = [];
    const singles: Listing[] = [];

    if (shouldIncludeSelectedPin && selectedListing) {
      singles.push(selectedListing);
    }

    buckets.forEach((group, key) => {
      if (group.length >= 3) {
        const avgLat =
          group.reduce((sum, l) => sum + l.coordinates.lat, 0) / group.length;
        const avgLng =
          group.reduce((sum, l) => sum + l.coordinates.lng, 0) / group.length;
        clusterList.push({
          id: `cluster-${key}`,
          center: { lat: avgLat, lng: avgLng },
          items: group,
        });
      } else {
        singles.push(...group);
      }
    });

    return { clusters: clusterList, unclusteredListings: singles };
  }, [
    filteredListings,
    mapZoomLevel,
    selectedListingId,
    selectedListing,
    searchScope,
    appliedViewportBounds,
  ]);

  // Step 4B & Phase 57: Confirm "Search This Area" to update viewport-based results with 250ms debounce and guaranteed clearAppStatus() in finally
  const handleSearchThisArea = useCallback(() => {
    if (cameraDebounceRef.current) {
      clearTimeout(cameraDebounceRef.current);
      cameraDebounceRef.current = null;
    }
    if (searchAreaDebounceRef.current) {
      clearTimeout(searchAreaDebounceRef.current);
      searchAreaDebounceRef.current = null;
    }

    const targetBounds = liveMapBoundsRef.current || liveViewportBounds;
    suppressNextCameraMoveRef.current = true;
    setAppliedViewportBounds(targetBounds);
    appliedBoundsRef.current = targetBounds;
    setAppliedMapZoom(mapZoomLevel);
    appliedZoomRef.current = mapZoomLevel;
    lastFetchedCameraRef.current = {
      lat: mapCenter.lat,
      lng: mapCenter.lng,
      zoom: mapZoomLevel,
    };
    setSearchScope('map_area');
    setHasCameraMoved(false);
    if (
      selectedListing &&
      !isPointInViewport(selectedListing.coordinates, targetBounds)
    ) {
      setSelectedListingId(null);
      setIsExpandedDetailModalOpen(false);
    }

    setIsLiveFetching(true);
    setLiveFetchError(null);
    setUniversalMapStatus('loading');
    setAppStatus('updating_map');

    searchAreaDebounceRef.current = setTimeout(() => {
      void fetchPublishedListings(targetBounds, {
        hubId: activeHub?.id || null,
        hubSlug: activeHub?.slug || null,
      })
        .then((remoteData) => {
          setLivePublishedPayload(remoteData);
          setHasLoadedLivePayload(true);
          const currentSlug = activeHub?.slug || activeHubSlug;
          if (currentSlug) {
            writeHubListingsCache(currentSlug, remoteData);
          }
        })
        .catch((err) => {
          setLiveFetchError(
            err instanceof Error
              ? err.message
              : 'Failed to fetch published listings from Supabase.'
          );
        })
        .finally(() => {
          setIsLiveFetching(false);
          setUniversalMapStatus('idle');
          clearAppStatus();
        });
    }, 600);
  }, [
    liveViewportBounds,
    mapCenter.lat,
    mapCenter.lng,
    mapZoomLevel,
    selectedListing,
    activeHub?.id,
    activeHub?.slug,
    activeHubSlug,
  ]);

  // Step 4B Requirement 5 & 7: Switch between Visible Map Area and Entire Directory without clearing query or filters
  const handleSwitchSearchScope = useCallback(
    (nextScope: DiscoverySearchScope) => {
      if (cameraDebounceRef.current) {
        clearTimeout(cameraDebounceRef.current);
        cameraDebounceRef.current = null;
      }
      setSearchScope(nextScope);
      if (nextScope === 'map_area') {
        const targetBounds = liveMapBoundsRef.current || liveViewportBounds;
        suppressNextCameraMoveRef.current = true;
        setAppliedViewportBounds(targetBounds);
        appliedBoundsRef.current = targetBounds;
        setAppliedMapZoom(mapZoomLevel);
        appliedZoomRef.current = mapZoomLevel;
        setHasCameraMoved(false);
        if (
          selectedListing &&
          !isPointInViewport(selectedListing.coordinates, targetBounds)
        ) {
          setSelectedListingId(null);
          setIsExpandedDetailModalOpen(false);
        }
      } else {
        setHasCameraMoved(false);
        void loadLiveDiscoveryData();
      }
    },
    [liveViewportBounds, loadLiveDiscoveryData, mapZoomLevel, selectedListing]
  );

  // Center map on a specific listing (Step 4A & 4B)
  const handleCenterOnListing = useCallback(
    (target: Listing) => {
      if (!hasValidListingCoordinates(target)) return;
      const nextZoom = Math.max(14, mapZoomLevel);
      const nextBounds = computeDefaultViewportBounds(
        target.coordinates,
        nextZoom
      );
      suppressNextCameraMoveRef.current = true;
      setMapCenter(target.coordinates);
      setMapZoomLevel(nextZoom);
      setLiveViewportBounds(nextBounds);
      setClusterExpansionTarget({
        center: target.coordinates,
        zoom: nextZoom,
        bounds: nextBounds,
        seq: Date.now(),
      });
    },
    [mapZoomLevel]
  );

  // Zoom to Item: For listings with area geometry, fit the map to that geometry; for point-only listings, centre the point and use an appropriate zoom (Step 4F-A)
  const handleZoomToItem = useCallback((target: Listing) => {
    if (!hasValidListingCoordinates(target)) return;
    const re =
      target.category === 'real_estate' ? target.realEstateDetails : undefined;
    const hasAreaPoly =
      re &&
      shouldShowPlotAndBoundary(re.propertyType, re.hasAssociatedPlot) &&
      re.boundaryPolygon &&
      re.boundaryPolygon.length >= 3;

    if (hasAreaPoly && re?.boundaryPolygon) {
      let minLat = 90;
      let maxLat = -90;
      let minLng = 180;
      let maxLng = -180;
      re.boundaryPolygon.forEach((pt) => {
        minLat = Math.min(minLat, pt.lat);
        maxLat = Math.max(maxLat, pt.lat);
        minLng = Math.min(minLng, pt.lng);
        maxLng = Math.max(maxLng, pt.lng);
      });
      const center: LatLngPoint = {
        lat: (minLat + maxLat) / 2,
        lng: (minLng + maxLng) / 2,
      };
      const bounds: MapViewportBounds = {
        north: maxLat + 0.0003,
        south: minLat - 0.0003,
        east: maxLng + 0.0003,
        west: minLng - 0.0003,
      };
      suppressNextCameraMoveRef.current = true;
      setMapCenter(center);
      setMapZoomLevel(17);
      setLiveViewportBounds(bounds);
      setClusterExpansionTarget({
        center,
        zoom: 17,
        bounds,
        seq: Date.now(),
        fitBounds: false,
      });
    } else {
      const targetZoom = Math.max(mapZoomLevel, 14);
      suppressNextCameraMoveRef.current = true;
      setMapCenter(target.coordinates);
      setClusterExpansionTarget({
        center: target.coordinates,
        zoom: targetZoom,
        bounds: liveViewportBounds,
        seq: Date.now(),
        fitBounds: false,
      });
    }
  }, [mapZoomLevel, liveViewportBounds]);

  // Select Listing Handler (synchronizes selection + switches to map mode if needed + centers map + collapses mobile sheet to bar)
  // Phase 72-B: public_civic listings terminate directly at CivicSummaryModal (no /listing/[id] detail route)
  const handleSelectListing = useCallback(
    (listingId: string) => {
      const target = activeDirectoryListings.find(
        (l) => l && l.id === listingId && hasValidListingCoordinates(l)
      );
      if (!target) return;
      setDiscoveryMode('map');
      setSelectedListingId(listingId);
      setActiveClusterSummary(null);
      setMobileSheetState('collapsed');
      recordListingInteraction(listingId, 'viewsCount');
      handleCenterOnListing(target);
      if (target.is_civic_record || target.listing_vertical === 'public_civic') {
        setSummaryModalListing(target);
      }
    },
    [recordListingInteraction, activeDirectoryListings, handleCenterOnListing]
  );

  // Phase 72-B: Auto-open CivicSummaryModal when arriving via /explore?civic=<id>
  useEffect(() => {
    if (!pendingCivicDeepLinkId) return;
    let active = true;

    const existing = activeDirectoryListings.find(
      (l) => l && l.id === pendingCivicDeepLinkId
    );
    if (existing) {
      queueMicrotask(() => {
        if (!active) return;
        setSelectedListingId(existing.id);
        setSummaryModalListing(existing);
        setPendingCivicDeepLinkId(null);
        if (hasValidListingCoordinates(existing)) {
          handleCenterOnListing(existing);
        }
      });
      return () => {
        active = false;
      };
    }

    if (!isSupabaseConfigured()) return;
    const fetchCivicTarget = async () => {
      try {
        const { data } = await supabase
          .from('listings')
          .select('*')
          .eq('id', pendingCivicDeepLinkId)
          .maybeSingle();
        if (!active) return;
        if (data) {
          const mapped = mapRowToListing(
            data as Parameters<typeof mapRowToListing>[0]
          );
          setSelectedListingId(mapped.id);
          setSummaryModalListing(mapped);
          if (hasValidListingCoordinates(mapped)) {
            handleCenterOnListing(mapped);
          }
        }
      } finally {
        if (active) setPendingCivicDeepLinkId(null);
      }
    };
    void fetchCivicTarget();
    return () => {
      active = false;
    };
  }, [pendingCivicDeepLinkId, activeDirectoryListings, handleCenterOnListing]);

  const handleClearSelection = useCallback(() => {
    setSelectedListingId(null);
    setIsExpandedDetailModalOpen(false);
    setSummaryModalListing(null);
  }, []);

  // Step 4D DEF-05: Handle target-aware "Locate on Map" requests from Workspaces, Saved, and Full Detail View
  useEffect(() => {
    if (!pendingMapFocusRequest) return;
    if (lastHandledFocusSeqRef.current === pendingMapFocusRequest.seq) {
      return;
    }
    lastHandledFocusSeqRef.current = pendingMapFocusRequest.seq;

    const target = activeDirectoryListings.find(
      (l) =>
        l &&
        l.id === pendingMapFocusRequest.listingId &&
        hasValidListingCoordinates(l)
    );
    if (!target) return;

    queueMicrotask(() => {
      if (isFullscreenMap) {
        setIsFullscreenMap(false);
        onFullscreenMapChange?.(false);
      }
      setDiscoveryMode('map');
      setIsExpandedDetailModalOpen(false);
      setActiveClusterSummary(null);

      if (isSplitScreen && !isDesktopPanelOpen) {
        updateDesktopPanelOpen(true);
      } else if (!isSplitScreen) {
        setMobileSheetState('collapsed');
      }

      const nextZoom = Math.max(15, mapZoomLevel);
      const nextBounds = computeDefaultViewportBounds(
        target.coordinates,
        nextZoom
      );
      suppressNextCameraMoveRef.current = true;
      setMapCenter(target.coordinates);
      setMapZoomLevel(nextZoom);
      setLiveViewportBounds(nextBounds);
      setAppliedViewportBounds(nextBounds);
      appliedBoundsRef.current = nextBounds;
      setAppliedMapZoom(nextZoom);
      appliedZoomRef.current = nextZoom;
      setHasCameraMoved(false);
      setClusterExpansionTarget({
        center: target.coordinates,
        zoom: nextZoom,
        bounds: nextBounds,
        seq: Date.now(),
      });

      lastAutoScrolledListingIdRef.current = null;
      setSelectedListingId(target.id);
      recordListingInteraction(target.id, 'viewsCount');
    });
  }, [
    pendingMapFocusRequest,
    activeDirectoryListings,
    isFullscreenMap,
    onFullscreenMapChange,
    isSplitScreen,
    isDesktopPanelOpen,
    updateDesktopPanelOpen,
    mapZoomLevel,
    recordListingInteraction,
  ]);

  // Cluster Click Handler: On desktop zooms in immediately; on mobile shows cluster summary with "Zoom into cluster" button
  const handleClusterActivate = useCallback(
    (
      cluster: { id: string; center: LatLngPoint; items: Listing[] },
      forceZoom = false
    ) => {
      const isMobileViewport =
        typeof window !== 'undefined' && window.innerWidth < 1024;
      if (isMobileViewport && !forceZoom) {
        setSelectedListingId(null);
        setActiveClusterSummary(cluster);
        return;
      }
      const expansion = computeClusterExpansionCamera(
        cluster.items,
        mapZoomLevel
      );
      setMapCenter(expansion.center);
      setMapZoomLevel(expansion.zoom);
      setLiveViewportBounds(expansion.bounds);
      setAppliedViewportBounds(expansion.bounds);
      appliedBoundsRef.current = expansion.bounds;
      setAppliedMapZoom(expansion.zoom);
      appliedZoomRef.current = expansion.zoom;
      setHasCameraMoved(false);
      setClusterExpansionTarget({
        ...expansion,
        seq: Date.now(),
      });
      setActiveClusterSummary(null);
    },
    [mapZoomLevel]
  );

  // Map Click LatLng Handler for Drawing Tools (Part D) & Pick N Drop Pin A/B (Phase 60-B)
  const handleMapClickLatLng = useCallback(
    (pt: LatLngPoint) => {
      if (isPickNDropOpen && pndPinTarget) {
        const dropped: PickNDropPoint = {
          lat: Number(pt.lat.toFixed(6)),
          lng: Number(pt.lng.toFixed(6)),
          label: `${pndPinTarget === 'pickup' ? 'Pickup' : 'Dropoff'} Pin (${pt.lat.toFixed(4)}°, ${pt.lng.toFixed(4)}°)`,
        };
        if (pndPinTarget === 'pickup') {
          setPndPickup(dropped);
          if (isSplitScreen) {
            setPndPinTarget(pndDropoff ? null : 'dropoff');
          } else {
            setPndPinTarget(null);
            setMobileSheetState('expanded');
          }
        } else {
          setPndDropoff(dropped);
          setPndPinTarget(null);
          if (!isSplitScreen) {
            setMobileSheetState('expanded');
          }
        }
        return;
      }

      if (activeDrawTool === 'none') return;

      if (activeDrawTool === 'point') {
        const shapeId = `shape-pt-${Date.now()}`;
        const newShape: DrawnShape = {
          id: shapeId,
          type: 'point',
          label: `Pin #${drawnShapes.filter((s) => s.type === 'point').length + 1}`,
          description: 'Custom field pin in Churachandpur',
          categoryNote: 'Survey Pin',
          visible: true,
          coordinates: [pt],
          center: pt,
          createdAt: new Date().toISOString(),
        };
        setDrawnShapes((prev) => [newShape, ...prev]);
        setSelectedShapeId(shapeId);
        setActiveDrawTool('none');
      } else if (activeDrawTool === 'circle') {
        const shapeId = `shape-cir-${Date.now()}`;
        const metrics = calculateCircleMetrics(circleRadiusDraft);
        const newShape: DrawnShape = {
          id: shapeId,
          type: 'circle',
          label: `Radius (${circleRadiusDraft}m)`,
          visible: true,
          coordinates: [pt],
          center: pt,
          radiusMeters: metrics.radiusMeters,
          diameterMeters: metrics.diameterMeters,
          circumferenceMeters: metrics.circumferenceMeters,
          areaSqm: metrics.areaSqm,
          perimeterMeters: metrics.perimeterMeters,
          createdAt: new Date().toISOString(),
        };
        setDrawnShapes((prev) => [newShape, ...prev]);
        setSelectedShapeId(shapeId);
        setActiveSpatialFilterShapeId(shapeId);
        setActiveDrawTool('none');
      } else if (activeDrawTool === 'rectangle') {
        if (inProgressPoints.length === 0) {
          setInProgressPoints([pt]);
        } else {
          const p1 = inProgressPoints[0];
          const p2 = pt;
          const rectCoords: LatLngPoint[] = [
            { lat: p1.lat, lng: p1.lng },
            { lat: p1.lat, lng: p2.lng },
            { lat: p2.lat, lng: p2.lng },
            { lat: p2.lat, lng: p1.lng },
          ];
          const metrics = calculatePolygonMetrics(rectCoords);
          const shapeId = `shape-rect-${Date.now()}`;
          const newShape: DrawnShape = {
            id: shapeId,
            type: 'rectangle',
            label: `Rectangle #${drawnShapes.filter((s) => s.type === 'rectangle').length + 1}`,
            visible: true,
            coordinates: rectCoords,
            areaSqm: metrics.areaSqm,
            perimeterMeters: metrics.perimeterMeters,
            createdAt: new Date().toISOString(),
          };
          setDrawnShapes((prev) => [newShape, ...prev]);
          setSelectedShapeId(shapeId);
          setActiveSpatialFilterShapeId(shapeId);
          setInProgressPoints([]);
          setActiveDrawTool('none');
        }
      } else if (activeDrawTool === 'line' || activeDrawTool === 'polygon') {
        setInProgressPoints((prev) => [...prev, pt]);
      }
    },
    [
      isPickNDropOpen,
      isSplitScreen,
      pndPinTarget,
      pndDropoff,
      activeDrawTool,
      circleRadiusDraft,
      inProgressPoints,
      drawnShapes,
      setDrawnShapes,
    ]
  );

  const finishMultiPointDrawing = () => {
    if (activeDrawTool === 'line' && inProgressPoints.length >= 2) {
      const segs = calculateLineSegmentsMeters(inProgressPoints);
      const shapeId = `shape-line-${Date.now()}`;
      const newShape: DrawnShape = {
        id: shapeId,
        type: 'line',
        label: `Line #${drawnShapes.filter((s) => s.type === 'line').length + 1}`,
        visible: true,
        coordinates: inProgressPoints,
        distanceMeters: segs.totalMeters,
        segmentDistancesMeters: segs.segments,
        createdAt: new Date().toISOString(),
      };
      setDrawnShapes((prev) => [newShape, ...prev]);
      setSelectedShapeId(shapeId);
    } else if (activeDrawTool === 'polygon' && inProgressPoints.length >= 3) {
      const metrics = calculatePolygonMetrics(inProgressPoints);
      const shapeId = `shape-poly-${Date.now()}`;
      const newShape: DrawnShape = {
        id: shapeId,
        type: 'polygon',
        label: `Polygon #${drawnShapes.filter((s) => s.type === 'polygon').length + 1}`,
        visible: true,
        coordinates: inProgressPoints,
        areaSqm: metrics.areaSqm,
        perimeterMeters: metrics.perimeterMeters,
        createdAt: new Date().toISOString(),
      };
      setDrawnShapes((prev) => [newShape, ...prev]);
      setSelectedShapeId(shapeId);
      setActiveSpatialFilterShapeId(shapeId);
    }
    setInProgressPoints([]);
    setActiveDrawTool('none');
  };

  const handleUpdateShape = useCallback(
    (updated: DrawnShape) => {
      setDrawnShapes((prev) =>
        prev.map((s) => (s.id === updated.id ? updated : s))
      );
    },
    [setDrawnShapes]
  );

  const handleDeleteShape = useCallback(
    (shapeId: string) => {
      setDrawnShapes((prev) => prev.filter((s) => s.id !== shapeId));
      if (selectedShapeId === shapeId) setSelectedShapeId(null);
      if (activeSpatialFilterShapeId === shapeId)
        setActiveSpatialFilterShapeId(null);
    },
    [selectedShapeId, activeSpatialFilterShapeId, setDrawnShapes]
  );

  // Role-aware permission check for "Create Listing Here"
  const geometryCreationPermission = useMemo(
    () => canUserCreateListingFromGeometry(currentUser, staffDelegations),
    [currentUser, staffDelegations]
  );

  const handleCreateListingFromShape = useCallback(
    (
      shape: DrawnShape,
      category: ListingCategory,
      propertyType: PropertyType,
      commercialHasPlot: boolean
    ) => {
      if (!geometryCreationPermission.allowed || !onInitiateListingFromGeometry) {
        return;
      }

      const res = applyDrawnGeometryToListingDraft({
        shape,
        category,
        propertyType,
        commercialHasPlot,
        user: currentUser,
        staffDelegations,
        defaultLocality:
          selectedLocality !== 'all'
            ? selectedLocality
            : 'New Lamka Demo Sector (Sample)',
      });

      if (!res.ok || !res.draft) return;

      const withImages: Listing = {
        ...res.draft,
        coverImage: generateCoverImageDataUri(
          res.draft.title || 'Draft Listing from Geometry',
          category,
          res.draft.locality,
          1
        ),
        galleryImages: [
          generateCoverImageDataUri(
            `${res.draft.title || 'Draft Listing'} — Exterior`,
            category,
            res.draft.locality,
            2
          ),
        ],
      };

      onInitiateListingFromGeometry(withImages);
    },
    [
      geometryCreationPermission.allowed,
      onInitiateListingFromGeometry,
      currentUser,
      staffDelegations,
      selectedLocality,
    ]
  );

  const resetAllFilters = () => {
    setSearchQuery('');
    setSelectedCategory('all');
    setSelectedSubcategoryId(null);
    setSelectedPrintCapability('all');
    setSelectedPropertyType('all');
    setSelectedLocality('all');
    setMinRating(0);
    setVerifiedOnly(false);
    setPriceRangeFilter('all');
    setAvailableOnly(false);
    setHas360Only(false);
    setHasCatalogueOnly(false);
    setActiveSpatialFilterShapeId(null);
    setSelectedListingId(null);
    setIsExpandedDetailModalOpen(false);
    setActiveClusterSummary(null);
  };

  // Count of active non-default filters
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (selectedCategory !== 'all') count++;
    if (selectedSubcategoryId) count++;
    if (selectedPrintCapability !== 'all') count++;
    if (selectedPropertyType !== 'all') count++;
    if (selectedLocality !== 'all') count++;
    if (minRating > 0) count++;
    if (verifiedOnly) count++;
    if (priceRangeFilter !== 'all') count++;
    if (availableOnly) count++;
    if (has360Only) count++;
    if (hasCatalogueOnly) count++;
    if (activeSpatialFilterShapeId) count++;
    return count;
  }, [
    selectedCategory,
    selectedSubcategoryId,
    selectedPrintCapability,
    selectedPropertyType,
    selectedLocality,
    minRating,
    verifiedOnly,
    priceRangeFilter,
    availableOnly,
    has360Only,
    hasCatalogueOnly,
    activeSpatialFilterShapeId,
  ]);

  const handleCopyCloudJson = (variant: MapAppearanceVariant) => {
    const spec =
      variant === 'dark'
        ? PRINTSWIFT_MIDNIGHT_DISCOVERY_STYLE
        : PRINTSWIFT_NEUTRAL_DISCOVERY_STYLE;
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      navigator.clipboard.writeText(JSON.stringify(spec, null, 2));
      setCopiedStyleVariant(variant);
      setTimeout(() => setCopiedStyleVariant(null), 2000);
    }
  };

  // Mobile Bottom Sheet Drag Gesture Handlers
  const handleSheetPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    sheetDragStartYRef.current = e.clientY;
  };

  const handleSheetPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (sheetDragStartYRef.current === null) return;
    const dy = e.clientY - sheetDragStartYRef.current;
    sheetDragStartYRef.current = null;
    if (Math.abs(dy) < 18) {
      // Tap on handle cycles state
      setMobileSheetState((prev) =>
        prev === 'collapsed'
          ? 'partial'
          : prev === 'partial'
            ? 'expanded'
            : 'collapsed'
      );
      return;
    }
    if (dy < -30) {
      // Swiped up
      setMobileSheetState((prev) =>
        prev === 'collapsed' ? 'partial' : 'expanded'
      );
    } else if (dy > 30) {
      // Swiped down
      setMobileSheetState((prev) =>
        prev === 'expanded' ? 'partial' : 'collapsed'
      );
    }
  };

  // Step 4A & 4C: Coordinated Selected Listing Overlay Layout
  const selectedOverlayLayout = useMemo(
    () =>
      resolveSelectedListingOverlayLayout({
        hasSelectedListing: Boolean(selectedListing),
        isFullscreenMap,
        isDesktopViewport,
        isSplitScreen,
        isMobileLandscape,
        isDesktopPanelOpen,
        mobileSheetState,
        mapToolbarPosition,
        drawToolboxPosition,
        isDrawToolboxOpen,
      }),
    [
      selectedListing,
      isFullscreenMap,
      isDesktopViewport,
      isSplitScreen,
      isMobileLandscape,
      isDesktopPanelOpen,
      mobileSheetState,
      mapToolbarPosition,
      drawToolboxPosition,
      isDrawToolboxOpen,
    ]
  );

  const mobileToolbarBottomOffsetClass =
    selectedOverlayLayout.toolbarBottomOffsetClass;

  // Step 4D DEF-03: Auto-scroll selected listing card into view ONLY when selectedListingId actually changes
  useEffect(() => {
    if (!selectedListingId) {
      lastAutoScrolledListingIdRef.current = null;
      return;
    }
    if (lastAutoScrolledListingIdRef.current === selectedListingId) {
      return;
    }
    lastAutoScrolledListingIdRef.current = selectedListingId;

    const rafId = requestAnimationFrame(() => {
      if (
        selectedOverlayLayout.shouldHighlightInSidebar &&
        desktopListRef.current
      ) {
        const cardEl = desktopListRef.current.querySelector<HTMLElement>(
          `[data-testid="listing-card-${selectedListingId}"]`
        );
        if (cardEl) {
          cardEl.scrollIntoView({ block: 'nearest' });
          desktopListScrollTopRef.current = desktopListRef.current.scrollTop;
        }
      } else if (
        selectedOverlayLayout.shouldHighlightInMobileSheet &&
        mobileSheetListRef.current
      ) {
        const cardEl = mobileSheetListRef.current.querySelector<HTMLElement>(
          `[data-testid="listing-card-${selectedListingId}"]`
        );
        if (cardEl) {
          cardEl.scrollIntoView({ block: 'nearest' });
          mobileSheetScrollTopRef.current =
            mobileSheetListRef.current.scrollTop;
        }
      }
    });
    return () => cancelAnimationFrame(rafId);
  }, [
    selectedListingId,
    selectedOverlayLayout.shouldHighlightInSidebar,
    selectedOverlayLayout.shouldHighlightInMobileSheet,
  ]);

  // Render Reusable Listing Card for Split Sidebar, Portrait Bottom Sheet, and List Mode
  const renderListingResultCard = (
    item: Listing,
    isCompactGrid = false,
    context: 'desktop-sidebar' | 'mobile-sheet' | 'list-grid' = 'list-grid'
  ) => {
    const isSaved = savedListingIds.includes(item.id);
    const isHovered = hoveredListingId === item.id;
    const isSelected = selectedListingId === item.id;
    const isInlineHighlighted =
      isSelected &&
      ((context === 'desktop-sidebar' &&
        selectedOverlayLayout.shouldHighlightInSidebar) ||
        (context === 'mobile-sheet' &&
          selectedOverlayLayout.shouldHighlightInMobileSheet));
    const showOutsideViewportBadge =
      searchScope === 'global' &&
      !isPointInViewport(item.coordinates, liveViewportBounds);

    return (
      <MapCardRegistry
        key={item.id}
        item={item}
        isSaved={isSaved}
        isHovered={isHovered}
        isSelected={isSelected}
        isInlineHighlighted={isInlineHighlighted}
        isMobileLandscape={isMobileLandscape}
        isCompactGrid={isCompactGrid}
        context={context}
        areaUnit={areaUnit}
        showOutsideViewportBadge={showOutsideViewportBadge}
        activeRouteEstimate={
          activeRouteTarget?.id === item.id ? activeRouteEstimate : null
        }
        onMouseEnter={() => setHoveredListingId(item.id)}
        onMouseLeave={() => setHoveredListingId(null)}
        onSelect={() => handleSelectListing(item.id)}
        onCenterOnMap={() => handleCenterOnListing(item)}
        onToggleSave={() => toggleSavedListing(item.id)}
        onExpandDetails={() => setSummaryModalListing(item)}
        onOpenSummary={(target) => {
          setSelectedListingId(target.id);
          setSummaryModalListing(target);
          if (hasValidListingCoordinates(target)) {
            handleCenterOnListing(target);
          }
        }}
        onZoomToItem={() => handleZoomToItem(item)}
        onGetDirections={() => {
          recordListingInteraction(item.id, 'directionClicksCount');
          handleGetDirectionsToListing(item);
        }}
        onStartPickNDrop={() => {
          setPndPickup({
            lat: item.coordinates.lat,
            lng: item.coordinates.lng,
            label: `${item.title}${item.locality ? ` (${item.locality})` : ''}`,
          });
          setPanelMode('pick_n_drop');
          setIsFullscreenMap(false);
          if (isSplitScreen) {
            updateDesktopPanelOpen(true);
          } else {
            setMobileSheetState('expanded');
          }
          handleCenterOnListing(item);
        }}
        onClearSelection={handleClearSelection}
        printProfile={printProfilesByListingId[item.id] ?? null}
      />
    );
  };

  const [unifiedHeaderSlot, setUnifiedHeaderSlot] =
    useState<HTMLElement | null>(null);
  const [internalHeaderVisible, setInternalHeaderVisible] =
    useState<boolean>(true);
  const isHeaderVisible =
    typeof externalIsHeaderHidden === 'boolean'
      ? !externalIsHeaderHidden
      : internalHeaderVisible;
  const isHidden = !isHeaderVisible;
  const mapDragStartLatRef = useRef<number | null>(null);
  const mapOverlayFrameRef = useRef<HTMLDivElement | null>(null);
  const feedScrollStateRef = useRef<
    WeakMap<HTMLElement, { lastY: number; anchorY: number; dir: 'up' | 'down' | null }>
  >(new WeakMap());

  useEffect(() => {
    if (typeof document === 'undefined') return;
    queueMicrotask(() => {
      setUnifiedHeaderSlot(
        document.getElementById('unified-header-discovery-slot')
      );
    });
  }, []);

  const handleSetHeaderVisible = useCallback(
    (visible: boolean) => {
      setInternalHeaderVisible(visible);
      onListScrollDirectionChange?.(visible ? 'up' : 'down');
    },
    [onListScrollDirectionChange]
  );

  // Phase 57: Unified desensitized scroll evaluator for #explore-scroll-container (List Mode, Portrait Sheet & Landscape Split-View)
  // Hide when scrollTop > 400 && deltaY > 80; reveal immediately on any deliberate upward scroll.
  const handleExploreFeedScroll = useCallback(
    (el: HTMLElement) => {
      if (el.clientHeight <= 0) return;
      const currentScrollY = el.scrollTop;
      const state = feedScrollStateRef.current.get(el) || {
        lastY: currentScrollY,
        anchorY: currentScrollY,
        dir: null,
      };

      if (currentScrollY <= 16) {
        state.lastY = currentScrollY;
        state.anchorY = currentScrollY;
        state.dir = 'up';
        feedScrollStateRef.current.set(el, state);
        handleSetHeaderVisible(true);
        return;
      }

      if (currentScrollY < state.lastY) {
        if (state.dir !== 'up') {
          state.dir = 'up';
          state.anchorY = state.lastY;
        }
        if (state.anchorY - currentScrollY > 12) {
          handleSetHeaderVisible(true);
          state.anchorY = currentScrollY;
        }
      } else if (currentScrollY > state.lastY) {
        if (state.dir !== 'down') {
          state.dir = 'down';
          state.anchorY = state.lastY;
        }
        const deltaY = currentScrollY - state.anchorY;
        if (currentScrollY > 400 && deltaY > 80 && !isSearchFocused) {
          handleSetHeaderVisible(false);
          state.anchorY = currentScrollY;
        }
      }

      state.lastY = currentScrollY;
      feedScrollStateRef.current.set(el, state);
    },
    [handleSetHeaderVisible, isSearchFocused]
  );

  const discoveryControlsInner = (
    <div
      data-testid="external-discovery-controls"
      data-collapsed={isDiscoveryCollapsed ? 'true' : 'false'}
      data-header-visible={isHeaderVisible ? 'true' : 'false'}
      data-mobile-hidden={!isHeaderVisible ? 'true' : 'false'}
      className={`bg-[var(--ps-surface)]/95 backdrop-blur-md ${
        isMobileLandscape
          ? 'px-2.5 py-1'
          : 'px-3 sm:px-4 py-1.5 sm:py-2'
      } shrink-0 z-30`}
    >
      <div
        ref={sortContainerRef}
        className="max-w-[1600px] mx-auto space-y-1.5 lg:space-y-0"
      >
            {/* ===============================================================
                ROW 1 (PERSISTENT AT ALL TIMES):
                Location/Cluster Selector + Main Search Bar (with inner Scope Toggle)
                + Desktop Merged Active Filters (Map/List, Filters, Relevance)
                + Desktop Inline Scrollable Categories + Expand Chevron (lg+)
                + Mobile/Tablet Row 2 Collapse Chevron (<lg)
               =============================================================== */}
            <div
              data-testid="discovery-controls-bar"
              className="relative flex flex-nowrap lg:flex-row lg:items-center items-center justify-between gap-1.5 sm:gap-2 min-w-0"
            >
              {/* Main Search Group: Location/Cluster Selection + Search Input with Embedded Scope Pill */}
              <div className="flex flex-1 lg:flex-none items-center gap-1.5 sm:gap-2 min-w-0 w-full lg:w-auto shrink-0 transition-all duration-200">
                {/* Location / Cluster Selector (Moved into Main Search Group; collapses on mobile when search is focused) */}
                <div
                  ref={localityContainerRef}
                  className={`relative shrink-0 transition-all duration-200 ${
                    isSearchFocused ? 'hidden sm:block' : 'block'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setIsLocalityPopoverOpen((prev) => !prev)}
                    aria-label={`Select ${activeHubName} locality`}
                    aria-haspopup="listbox"
                    aria-expanded={isLocalityPopoverOpen}
                    title={`Locality cluster: ${
                      selectedLocality === 'all'
                        ? `All ${activeHubName}`
                        : selectedLocality
                    }`}
                    data-testid="header-locality-selector"
                    className="h-9 py-1.5 px-3 text-sm leading-tight flex-shrink-0 flex items-center justify-center gap-1.5 rounded-xl bg-[var(--ps-bg)] border border-[var(--ps-border)] hover:border-[var(--ps-accent)]/60 hover:bg-[var(--ps-surface-alt)] font-semibold text-[var(--ps-text)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)] max-w-[120px] sm:max-w-[180px]"
                  >
                    <MapPin className="w-4 h-4 text-[var(--ps-accent)] shrink-0" />
                    <span className="truncate">
                      {selectedLocality === 'all'
                        ? `All ${activeHubName}`
                        : selectedLocality}
                    </span>
                    <ChevronDown
                      className={`w-4 h-4 text-[var(--ps-text-muted)] rounded shrink-0 transition-transform ${
                        isLocalityPopoverOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </button>

                  {isLocalityPopoverOpen && (
                    <div
                      role="listbox"
                      aria-label={`${activeHubName} Localities`}
                      data-testid="header-locality-popover"
                      className="absolute left-0 top-full mt-1.5 w-60 max-w-[calc(100vw-24px)] max-h-64 overflow-y-auto rounded-2xl bg-[var(--ps-surface)] border border-[var(--ps-border)] shadow-xl p-1.5 z-50 space-y-0.5 text-xs"
                    >
                      <button
                        type="button"
                        role="option"
                        aria-selected={selectedLocality === 'all'}
                        onClick={() => {
                          setSelectedLocality('all');
                          setIsLocalityPopoverOpen(false);
                        }}
                        className={`w-full rounded-xl px-2.5 py-1.5 text-left font-semibold flex items-center justify-between gap-2 transition-colors ${
                          selectedLocality === 'all'
                            ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                            : 'text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                        }`}
                      >
                        <span>All {activeHubName}</span>
                        {selectedLocality === 'all' && (
                          <Check className="w-4 h-4 shrink-0" />
                        )}
                      </button>
                      {configuredLocalityNames.map((loc) => {
                        const isSel = selectedLocality === loc;
                        return (
                          <button
                            key={loc}
                            type="button"
                            role="option"
                            aria-selected={isSel}
                            onClick={() => {
                              setSelectedLocality(loc);
                              setIsLocalityPopoverOpen(false);
                            }}
                            className={`w-full rounded-xl text-left font-semibold flex items-center justify-between gap-2 transition-colors ${
                              isSel
                                ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                                : 'text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                            }`}
                          >
                            <span className="truncate">{loc}</span>
                            {isSel && <Check className="w-4 h-4 shrink-0" />}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Main Search Bar DIV with Embedded "Visible Map Area / Entire Directory" Trailing Segmented Control */}
                <div
                  ref={searchContainerRef}
                  data-testid="main-search-bar-container"
                  data-search-focused={isSearchFocused ? 'true' : 'false'}
                  className={`relative flex-1 lg:flex-none lg:w-52 xl:w-64 lg:max-w-[260px] shrink-0 min-w-0 flex items-center transition-all duration-200 h-9 rounded-xl bg-[var(--ps-bg)] border ${
                    isSearchFocused
                      ? 'border-[var(--ps-accent)] ring-2 ring-[var(--ps-ring)] shadow-sm'
                      : 'border-[var(--ps-border)]'
                  } focus-within:ring-2 focus-within:ring-[var(--ps-ring)] focus-within:border-[var(--ps-accent)] pr-0`}
                >
                  <Search className="w-4 h-4 text-[var(--ps-text-muted)] ml-3 lg:ml-2.5 shrink-0 pointer-events-none" />
                  <input
                    type="text"
                    value={searchQuery}
                    onFocus={() => setIsSearchFocused(true)}
                    onBlur={() => {
                      // Delay slightly so clicks on dropdown options or scope pills process first
                      setTimeout(() => {
                        if (
                          searchContainerRef.current &&
                          !searchContainerRef.current.contains(
                            document.activeElement
                          )
                        ) {
                          setIsSearchFocused(false);
                        }
                      }, 120);
                    }}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Escape') {
                        setIsSearchFocused(false);
                        e.currentTarget.blur();
                      } else if (e.key === 'Enter') {
                        const trimmed = searchQuery.trim();
                        if (trimmed) {
                          setRecentSearches((prev) => [
                            trimmed,
                            ...prev
                              .filter(
                                (item) =>
                                  item.toLowerCase() !== trimmed.toLowerCase()
                              )
                              .slice(0, 4),
                          ]);
                        }
                        setIsSearchFocused(false);
                        e.currentTarget.blur();
                      }
                    }}
                    placeholder={
                      searchPlaceholders.length > 0
                        ? searchPlaceholders[
                            placeholderIndex % searchPlaceholders.length
                          ]
                        : searchScope === 'global'
                          ? 'Search all...'
                          : 'Search in map...'
                    }
                    aria-label="Search Churachandpur listings, keywords, categories, or localities"
                    data-testid="explore-search-input"
                    className="min-w-0 flex-1 w-full h-full bg-transparent px-3 lg:px-2 text-sm text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:outline-none transition-all duration-200"
                  />

                  {searchQuery && (
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => setSearchQuery('')}
                      aria-label="Clear search query"
                      data-testid="explore-search-clear"
                      className="h-7 w-7 flex items-center justify-center mr-1 rounded-md text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] shrink-0"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}

                  {/* Embedded Trailing Segmented Scope Toggle Inside Main Search Bar DIV
                      Phase 26: Collapses to icon-only on mobile when search is focused; compact icon-only at lg (208px) & labeled at xl (256px) */}
                  <div
                    role="group"
                    aria-label="Search scope selector"
                    data-testid="search-scope-selector"
                    data-active-scope={searchScope}
                    className="inline-flex items-center p-0.5 mr-1 rounded-lg border border-[var(--ps-border)]/80 shrink-0 transition-all duration-200"
                  >
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => handleSwitchSearchScope('map_area')}
                      aria-pressed={searchScope === 'map_area'}
                      data-testid="search-scope-map-area-btn"
                      title="Filter results to Visible Map Area"
                      className={`h-7 px-2.5 lg:px-1.5 xl:px-2 text-xs sm:text-sm leading-tight flex-shrink-0 flex items-center justify-center rounded-md gap-1 font-semibold transition-all duration-200 whitespace-nowrap ${
                        searchScope === 'map_area'
                          ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-2xs'
                          : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                      }`}
                    >
                      <MapPin className="w-3.5 h-3.5 shrink-0" />
                      <span
                        className={
                          isSearchFocused
                            ? 'hidden md:inline lg:hidden xl:inline'
                            : 'hidden sm:inline lg:hidden xl:inline'
                        }
                      >
                        Map
                      </span>
                    </button>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => handleSwitchSearchScope('global')}
                      aria-pressed={searchScope === 'global'}
                      data-testid="search-scope-global-btn"
                      title="Search across Entire Directory"
                      className={`h-7 px-2.5 lg:px-1.5 xl:px-2 text-xs sm:text-sm leading-tight flex-shrink-0 flex items-center justify-center rounded-md gap-1 font-semibold transition-all duration-200 whitespace-nowrap ${
                        searchScope === 'global'
                          ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-2xs'
                          : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                      }`}
                    >
                      <Globe className="w-3.5 h-3.5 shrink-0" />
                      <span
                        className={
                          isSearchFocused
                            ? 'hidden md:inline lg:hidden xl:inline'
                            : 'hidden sm:inline lg:hidden xl:inline'
                        }
                      >
                        All
                      </span>
                    </button>
                  </div>

                  {/* Quick & Recent Searches Dropdown Overlay (Phase 26) */}
                  {isSearchFocused && (
                    <div
                      data-testid="search-suggestions-popover"
                      onMouseDown={(e) => e.preventDefault()}
                      className="absolute left-0 right-0 top-full mt-1.5 max-h-64 overflow-y-auto rounded-2xl bg-[var(--ps-surface)] border border-[var(--ps-border)] shadow-xl p-2.5 z-50 space-y-2.5 text-xs"
                    >
                      {searchSuggestions.length > 0 ? (
                        <div className="space-y-1">
                          <div className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                            Matching Listings
                          </div>
                          {searchSuggestions.map((sug) => (
                            <button
                              key={sug.id}
                              type="button"
                              onClick={() => {
                                setSearchQuery(sug.title);
                                if (
                                  searchScope === 'map_area' &&
                                  !isPointInViewport(
                                    sug.coordinates,
                                    appliedViewportBounds
                                  )
                                ) {
                                  setSearchScope('global');
                                }
                                handleSelectListing(sug.id);
                                setIsSearchFocused(false);
                              }}
                              className="w-full rounded-xl hover:bg-[var(--ps-surface-alt)] text-left flex items-center justify-between gap-2 transition-colors"
                            >
                              <div className="min-w-0">
                                <div className="font-semibold text-[var(--ps-text)] truncate">
                                  {sug.title}
                                </div>
                                <div className="text-[10px] text-[var(--ps-text-muted)] truncate">
                                  {CATEGORY_LABELS[sug.category]} · {sug.locality}
                                </div>
                              </div>
                              <span className="text-[10px] font-bold text-amber-500 shrink-0 tabular-nums">
                                ★ {sug.rating}
                              </span>
                            </button>
                          ))}
                        </div>
                      ) : null}

                      <div className="space-y-1.5">
                        <div className="flex items-center justify-between px-2 py-0.5">
                          <span className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                            Trending &amp; Recent Searches
                          </span>
                          {recentSearches.length > 0 && (
                            <button
                              type="button"
                              onClick={() =>
                                setRecentSearches(
                                  appConfigOperations.trending_suggestions
                                    .length > 0
                                    ? appConfigOperations.trending_suggestions
                                    : [
                                        'Tuibong',
                                        'Plot',
                                        'New Lamka',
                                        'Stationery',
                                      ]
                                )
                              }
                              className="text-[10px] font-medium text-[var(--ps-text-muted)] hover:text-[var(--ps-accent)]"
                            >
                              Reset
                            </button>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-1.5 px-1">
                          {Array.from(
                            new Set([
                              ...appConfigOperations.trending_suggestions,
                              ...recentSearches,
                            ])
                          )
                            .slice(0, 8)
                            .map((term) => (
                              <button
                                key={term}
                                type="button"
                                onClick={() => {
                                  setSearchQuery(term);
                                  setIsSearchFocused(false);
                                }}
                                className="px-2 py-1 rounded-lg bg-[var(--ps-bg)] border border-[var(--ps-border)] text-[11px] font-medium text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] hover:border-[var(--ps-accent)]/50 transition-colors"
                              >
                                {term}
                              </button>
                            ))}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>

              {/* Phase 57: Desktop Merged Active Filters Controls (Map/List, Filters, Relevance) in Row 1 on lg+ (>= 1024px) */}
              <div
                data-testid="desktop-merged-active-filters"
                className="hidden lg:flex items-center gap-2 shrink-0"
              >
                {/* Map / List Segmented Toggle */}
                <div
                  className="inline-flex items-center p-0.5 rounded-lg bg-[var(--ps-bg)] border border-[var(--ps-border)]/80 shrink-0"
                  role="group"
                  aria-label="Discovery view mode"
                >
                  <button
                    type="button"
                    onClick={() => setDiscoveryMode('map')}
                    aria-pressed={discoveryMode === 'map'}
                    aria-label="Map View"
                    title="Map View"
                    data-testid="desktop-mode-map-btn"
                    className={`h-8 px-2.5 text-sm leading-tight flex-shrink-0 flex items-center justify-center gap-1 rounded-md font-semibold transition-colors whitespace-nowrap ${
                      discoveryMode === 'map'
                        ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-2xs'
                        : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                    }`}
                  >
                    <MapIcon className="w-4 h-4 shrink-0" />
                    <span>Map</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setDiscoveryMode('list')}
                    aria-pressed={discoveryMode === 'list'}
                    aria-label="List View"
                    title="List View"
                    data-testid="desktop-mode-list-btn"
                    className={`h-8 px-2.5 text-sm leading-tight flex-shrink-0 flex items-center justify-center gap-1 rounded-md font-semibold transition-colors whitespace-nowrap ${
                      discoveryMode === 'list'
                        ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-2xs'
                        : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                    }`}
                  >
                    <List className="w-4 h-4 shrink-0" />
                    <span>List</span>
                  </button>
                </div>

                {/* Filters Button */}
                <button
                  type="button"
                  onClick={() => {
                    setIsSortPopoverOpen(false);
                    setIsFilterModalOpen(true);
                  }}
                  aria-label={
                    activeFilterCount > 0
                      ? `Filters (${activeFilterCount} active)`
                      : 'Open Filters'
                  }
                  title="Open Discovery Filters"
                  data-testid="desktop-open-filter-modal-btn"
                  className={`h-9 px-3 text-sm font-medium rounded-xl leading-tight flex-shrink-0 flex items-center justify-center gap-1.5 border transition-colors whitespace-nowrap ${
                    activeFilterCount > 0
                      ? 'bg-[var(--ps-surface-alt)] border-[var(--ps-accent)] text-[var(--ps-text)]'
                      : 'bg-[var(--ps-bg)] border-[var(--ps-border)]/80 text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                  }`}
                >
                  <Filter className="w-3.5 h-3.5 text-[var(--ps-accent)] shrink-0" />
                  <span>Filters</span>
                  {activeFilterCount > 0 && (
                    <span
                      data-testid="desktop-active-filter-badge"
                      className="min-w-[16px] h-[16px] px-1 rounded-full bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-[10px] font-bold inline-flex items-center justify-center tabular-nums"
                    >
                      {activeFilterCount}
                    </span>
                  )}
                </button>

                {/* Sort / Relevance Popover Trigger */}
                <button
                  type="button"
                  onClick={() => setIsSortPopoverOpen((prev) => !prev)}
                  aria-haspopup="listbox"
                  aria-expanded={isSortPopoverOpen}
                  aria-label={`Sort discovery results (currently ${activeSortOption.label})`}
                  title={`Sort: ${activeSortOption.label}`}
                  data-testid="desktop-explore-sort-trigger"
                  className={`h-9 px-3 text-sm font-medium rounded-xl leading-tight flex-shrink-0 flex items-center justify-center gap-1.5 border transition-colors whitespace-nowrap ${
                    isSortPopoverOpen || sortBy !== 'relevance'
                      ? 'bg-[var(--ps-surface-alt)] border-[var(--ps-accent)] text-[var(--ps-text)]'
                      : 'bg-[var(--ps-bg)] border-[var(--ps-border)]/80 text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                  }`}
                >
                  <ArrowUpDown className="w-3.5 h-3.5 text-[var(--ps-accent)] shrink-0" />
                  <span>{activeSortOption.shortLabel}</span>
                </button>
              </div>

              {/* Phase 57-B: Desktop Inline Scrollable Categories Slot + Expand/Collapse Chevron in Unified Row 1 (lg+) */}
              <div
                role="tablist"
                aria-label="Discovery categories"
                data-testid="desktop-inline-categories-row"
                data-wrap-expanded={isDesktopCategoriesExpanded ? 'true' : 'false'}
                className="hidden lg:flex flex-1 min-w-0 items-center gap-1.5 overflow-x-auto no-scrollbar hide-scrollbar py-0.5"
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={selectedCategory === 'all'}
                  data-testid="desktop-category-chip-all"
                  onClick={() => handleSelectDiscoveryCategory('all')}
                  className={`h-8 px-3 text-sm font-medium flex items-center justify-center rounded-full leading-tight flex-shrink-0 gap-1.5 transition-colors whitespace-nowrap ${
                    selectedCategory === 'all'
                      ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-2xs'
                      : 'bg-[var(--ps-bg)] text-[var(--ps-text-muted)] border border-[var(--ps-border)]/80 hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                  }`}
                >
                  <span>All</span>
                  <span
                    className={`px-1.5 py-0.2 rounded text-[10px] font-bold tabular-nums ${
                      selectedCategory === 'all'
                        ? 'bg-[var(--ps-accent-fg)]/15 text-[var(--ps-accent-fg)]'
                        : 'bg-[var(--ps-surface-alt)] text-[var(--ps-text-muted)]'
                    }`}
                  >
                    ({publishedListings.length})
                  </span>
                </button>

                {isCategoriesLoading ? (
                  <div
                    data-testid="desktop-category-chips-loading"
                    className="h-8 px-3 text-sm font-medium flex items-center justify-center rounded-full leading-tight flex-shrink-0 gap-1.5 bg-[var(--ps-bg)] border border-[var(--ps-border)]/80 text-[var(--ps-text-muted)]"
                  >
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-[var(--ps-accent)]" />
                    <span>Loading...</span>
                  </div>
                ) : (
                  <>
                    <button
                      type="button"
                      role="tab"
                      aria-selected={selectedCategory === 'vehicles'}
                      data-testid="desktop-category-chip-vehicles"
                      data-category-count={filteredVehicleListings.length}
                      onClick={() => handleSelectDiscoveryCategory('vehicles')}
                      className={`h-8 px-3 text-sm font-medium flex items-center justify-center rounded-full leading-tight flex-shrink-0 gap-1.5 transition-colors whitespace-nowrap ${
                        selectedCategory === 'vehicles'
                          ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-2xs'
                          : 'bg-[var(--ps-bg)] text-[var(--ps-text-muted)] border border-[var(--ps-border)]/80 hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                      }`}
                    >
                      <Car className="w-3.5 h-3.5" />
                      <span>Vehicles &amp; Rentals</span>
                      <span
                        className={`px-1.5 py-0.2 rounded text-[10px] font-bold tabular-nums ${
                          selectedCategory === 'vehicles'
                            ? 'bg-[var(--ps-accent-fg)]/15 text-[var(--ps-accent-fg)]'
                            : 'bg-[var(--ps-surface-alt)] text-[var(--ps-text-muted)]'
                        }`}
                      >
                        ({filteredVehicleListings.length})
                      </span>
                    </button>
                    {desktopSortedCategories.map(({ cat, catKey, catLabel, count }) => {
                      const isActive =
                        selectedCategory === catKey || selectedCategory === cat.id;
                      return (
                        <button
                          key={cat.id || catKey}
                          type="button"
                          role="tab"
                          aria-selected={isActive}
                          data-testid={`desktop-category-chip-${catKey}`}
                          data-category-count={count}
                          onClick={() => handleSelectDiscoveryCategory(catKey)}
                          className={`h-8 px-3 text-sm font-medium flex items-center justify-center rounded-full leading-tight flex-shrink-0 gap-1.5 transition-colors whitespace-nowrap ${
                            isActive
                              ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-2xs'
                              : 'bg-[var(--ps-bg)] text-[var(--ps-text-muted)] border border-[var(--ps-border)]/80 hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                          }`}
                        >
                          <CategoryPillIcon category={catKey} className="w-3.5 h-3.5" />
                          <span>{catLabel}</span>
                          <span
                            className={`px-1.5 py-0.2 rounded text-[10px] font-bold tabular-nums ${
                              isActive
                                ? 'bg-[var(--ps-accent-fg)]/15 text-[var(--ps-accent-fg)]'
                                : 'bg-[var(--ps-surface-alt)] text-[var(--ps-text-muted)]'
                            }`}
                          >
                            ({count})
                          </span>
                        </button>
                      );
                    })}
                  </>
                )}
              </div>

              {/* Phase 57-B: Single Far-Right Expand/Collapse Categories Chevron on Desktop (lg+) */}
              <div className="hidden lg:flex items-center justify-end shrink-0">
                <button
                  type="button"
                  onClick={() =>
                    setIsDesktopCategoriesExpanded((prev) => !prev)
                  }
                  aria-expanded={isDesktopCategoriesExpanded}
                  aria-label={
                    isDesktopCategoriesExpanded
                      ? 'Collapse categories to single scrollable line'
                      : 'Expand categories to full wrap view'
                  }
                  title={
                    isDesktopCategoriesExpanded
                      ? 'Single-line scroll view'
                      : 'Wrap all categories'
                  }
                  data-testid="desktop-toggle-category-wrap-btn"
                  className="w-8 h-8 rounded-xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] flex items-center justify-center shrink-0 shadow-2xs transition-colors"
                >
                  {isDesktopCategoriesExpanded ? (
                    <ChevronUp className="w-4 h-4" />
                  ) : (
                    <ChevronDown className="w-4 h-4" />
                  )}
                </button>
              </div>

              {/* Right Cluster in Persistent Search Row (<lg only): Uniform Collapse Chevron */}
              <div className="flex lg:hidden items-center justify-end shrink-0">
                <button
                  type="button"
                  onClick={() =>
                    updateDiscoveryCollapsed(!isDiscoveryCollapsed)
                  }
                  aria-expanded={!isDiscoveryCollapsed}
                  aria-label={
                    isDiscoveryCollapsed
                      ? 'Show category row'
                      : 'Collapse category row'
                  }
                  title={
                    isDiscoveryCollapsed
                      ? 'Expand category row'
                      : 'Minimize category row'
                  }
                  data-testid="toggle-discovery-controls-btn"
                  className="w-8 h-8 rounded-xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] flex items-center justify-center shrink-0 shadow-2xs transition-colors"
                >
                  {isDiscoveryCollapsed ? (
                    <ChevronDown className="w-4 h-4" />
                  ) : (
                    <ChevronUp className="w-4 h-4" />
                  )}
                </button>
              </div>
            </div>

            {/* Phase 57-B: Expandable Wrapped Categories Drawer directly beneath Unified Row 1 on Desktop (lg+) */}
            <AnimatePresence initial={false}>
              {isDesktopCategoriesExpanded && (
                <motion.div
                  key="desktop-categories-wrapped-drawer"
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.16, ease: 'easeOut' }}
                  role="tablist"
                  aria-label="Expanded discovery categories"
                  data-testid="desktop-expanded-categories-drawer"
                  className="hidden lg:flex w-full flex-wrap items-center gap-1.5 pt-2 max-h-[200px] overflow-y-auto custom-scrollbar"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={selectedCategory === 'all'}
                    onClick={() => handleSelectDiscoveryCategory('all')}
                    className={`h-8 px-3 text-sm font-medium flex items-center justify-center rounded-full leading-tight flex-shrink-0 gap-1.5 transition-colors whitespace-nowrap ${
                      selectedCategory === 'all'
                        ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-2xs'
                        : 'bg-[var(--ps-bg)] text-[var(--ps-text-muted)] border border-[var(--ps-border)]/80 hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                    }`}
                  >
                    <span>All</span>
                    <span
                      className={`px-1.5 py-0.2 rounded text-[10px] font-bold tabular-nums ${
                        selectedCategory === 'all'
                          ? 'bg-[var(--ps-accent-fg)]/15 text-[var(--ps-accent-fg)]'
                          : 'bg-[var(--ps-surface-alt)] text-[var(--ps-text-muted)]'
                      }`}
                    >
                      ({publishedListings.length})
                    </span>
                  </button>
                  <button
                    type="button"
                    role="tab"
                    aria-selected={selectedCategory === 'vehicles'}
                    onClick={() => handleSelectDiscoveryCategory('vehicles')}
                    className={`h-8 px-3 text-sm font-medium flex items-center justify-center rounded-full leading-tight flex-shrink-0 gap-1.5 transition-colors whitespace-nowrap ${
                      selectedCategory === 'vehicles'
                        ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-2xs'
                        : 'bg-[var(--ps-bg)] text-[var(--ps-text-muted)] border border-[var(--ps-border)]/80 hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                    }`}
                  >
                    <Car className="w-3.5 h-3.5" />
                    <span>Vehicles &amp; Rentals</span>
                    <span
                      className={`px-1.5 py-0.2 rounded text-[10px] font-bold tabular-nums ${
                        selectedCategory === 'vehicles'
                          ? 'bg-[var(--ps-accent-fg)]/15 text-[var(--ps-accent-fg)]'
                          : 'bg-[var(--ps-surface-alt)] text-[var(--ps-text-muted)]'
                      }`}
                    >
                      ({filteredVehicleListings.length})
                    </span>
                  </button>
                  {desktopSortedCategories.map(
                    ({ cat, catKey, catLabel, count }) => {
                      const isActive =
                        selectedCategory === catKey ||
                        selectedCategory === cat.id;
                      return (
                        <button
                          key={`wrapped-${cat.id || catKey}`}
                          type="button"
                          role="tab"
                          aria-selected={isActive}
                          onClick={() => handleSelectDiscoveryCategory(catKey)}
                          className={`h-8 px-3 text-sm font-medium flex items-center justify-center rounded-full leading-tight flex-shrink-0 gap-1.5 transition-colors whitespace-nowrap ${
                            isActive
                              ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-2xs'
                              : 'bg-[var(--ps-bg)] text-[var(--ps-text-muted)] border border-[var(--ps-border)]/80 hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                          }`}
                        >
                          <CategoryPillIcon
                            category={catKey}
                            className="w-3.5 h-3.5"
                          />
                          <span>{catLabel}</span>
                          <span
                            className={`px-1.5 py-0.2 rounded text-[10px] font-bold tabular-nums ${
                              isActive
                                ? 'bg-[var(--ps-accent-fg)]/15 text-[var(--ps-accent-fg)]'
                                : 'bg-[var(--ps-surface-alt)] text-[var(--ps-text-muted)]'
                            }`}
                          >
                            ({count})
                          </span>
                        </button>
                      );
                    }
                  )}
                </motion.div>
              )}
            </AnimatePresence>

            {/* Phase 68-B: Desktop Secondary Nested Subcategory Strip (lg+) when a root category is selected */}
            {selectedCategory !== 'all' &&
              selectedCategory !== 'vehicles' &&
              activeRootCategorySubcategories.length > 0 && (
                <div
                  role="tablist"
                  aria-label="Desktop subcategory filter"
                  data-testid="desktop-nested-subcategory-strip"
                  className="hidden lg:flex w-full items-center gap-1.5 overflow-x-auto no-scrollbar hide-scrollbar pt-1.5"
                >
                  <button
                    type="button"
                    role="tab"
                    aria-selected={!selectedSubcategoryId}
                    onClick={() => setSelectedSubcategoryId(null)}
                    className={`h-7 px-2.5 text-xs font-semibold rounded-full flex items-center justify-center shrink-0 transition-colors whitespace-nowrap ${
                      !selectedSubcategoryId
                        ? 'bg-[var(--ps-text)] text-[var(--ps-bg)] shadow-2xs'
                        : 'bg-[var(--ps-surface-alt)] text-[var(--ps-text-muted)] border border-[var(--ps-border)] hover:text-[var(--ps-text)]'
                    }`}
                  >
                    All {CATEGORY_LABELS[selectedCategory] || 'Subcategories'}
                  </button>
                  {activeRootCategorySubcategories.map((sub) => {
                    const isSubActive =
                      selectedSubcategoryId === sub.id ||
                      selectedSubcategoryId === sub.slug;
                    return (
                      <button
                        key={sub.id}
                        type="button"
                        role="tab"
                        aria-selected={isSubActive}
                        data-testid={`desktop-subcategory-chip-${sub.slug}`}
                        onClick={() =>
                          setSelectedSubcategoryId(isSubActive ? null : sub.slug)
                        }
                        className={`h-7 px-2.5 text-xs font-medium rounded-full flex items-center justify-center shrink-0 transition-colors whitespace-nowrap ${
                          isSubActive
                            ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-2xs font-semibold'
                            : 'bg-[var(--ps-bg)] text-[var(--ps-text-muted)] border border-[var(--ps-border)]/80 hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                        }`}
                      >
                        {sub.display_name}
                      </button>
                    );
                  })}
                </div>
              )}

            {/* Phase 71-D: Desktop Verified Print Capability Chip Bar (lg+) when Printing & Digital Services is active */}
            {isPrintingCategoryActive && (
              <div
                data-testid="desktop-print-capability-strip"
                className="hidden lg:flex w-full items-center gap-1.5 overflow-x-auto no-scrollbar hide-scrollbar pt-1.5"
              >
                <span className="inline-flex h-7 items-center gap-1 rounded-full bg-theme-primary/10 px-2.5 text-[11px] font-bold text-theme-primary shrink-0 whitespace-nowrap">
                  <Printer className="h-3 w-3 shrink-0" aria-hidden="true" />
                  <span>Verified Print:</span>
                </span>
                {PRINT_CAPABILITY_FILTER_OPTIONS.map((opt) => {
                  const isActive = selectedPrintCapability === opt.key;
                  return (
                    <button
                      key={opt.key}
                      type="button"
                      data-testid={`desktop-print-capability-chip-${opt.key}`}
                      onClick={() =>
                        setSelectedPrintCapability(isActive ? 'all' : opt.key)
                      }
                      className={`h-7 px-2.5 text-xs font-semibold rounded-full flex items-center justify-center shrink-0 transition-colors whitespace-nowrap ${
                        isActive
                          ? 'bg-theme-primary text-[hsl(var(--color-primary-foreground))] shadow-2xs'
                          : 'bg-[var(--ps-bg)] text-[var(--ps-text-muted)] border border-[var(--ps-border)]/80 hover:border-theme-primary/50 hover:text-[var(--ps-text)]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            )}

            {/* ===============================================================
                PHASE 29 & 57-B & 68-B: MOBILE/TABLET CATEGORY + FILTER ROW (<lg),
                NESTED SUBCATEGORY STRIP, SORT MODAL PORTAL, & ACTIVE FILTER CHIPS ROW
               =============================================================== */}
            <FilterBar
              isDiscoveryCollapsed={isDiscoveryCollapsed}
              isMobileLandscape={isMobileLandscape}
              isCategoriesLoading={isCategoriesLoading}
              totalListingsCount={publishedListings.length}
              categories={sortedDynamicCategories}
              selectedCategory={selectedCategory}
              onSelectCategory={handleSelectDiscoveryCategory}
              subcategories={activeRootCategorySubcategories}
              selectedSubcategoryId={selectedSubcategoryId}
              onSelectSubcategory={setSelectedSubcategoryId}
              activeRootCategoryLabel={
                selectedCategory !== 'all' && selectedCategory !== 'vehicles'
                  ? CATEGORY_LABELS[selectedCategory]
                  : undefined
              }
              vehicleListingsCount={filteredVehicleListings.length}
              discoveryMode={discoveryMode}
              onSelectDiscoveryMode={setDiscoveryMode}
              onOpenFilterModal={() => setIsFilterModalOpen(true)}
              sortBy={sortBy}
              onSelectSortBy={setSortBy}
              isSortPopoverOpen={isSortPopoverOpen}
              onToggleSortPopover={() => setIsSortPopoverOpen((prev) => !prev)}
              onCloseSortPopover={() => setIsSortPopoverOpen(false)}
              selectedLocality={selectedLocality}
              onClearLocality={() => setSelectedLocality('all')}
              selectedPropertyType={selectedPropertyType}
              onClearPropertyType={() => setSelectedPropertyType('all')}
              minRating={minRating}
              onClearMinRating={() => setMinRating(0)}
              priceRangeFilter={priceRangeFilter}
              onClearPriceRange={() => setPriceRangeFilter('all')}
              verifiedOnly={verifiedOnly}
              onClearVerifiedOnly={() => setVerifiedOnly(false)}
              has360Only={has360Only}
              onClearHas360Only={() => setHas360Only(false)}
              hasCatalogueOnly={hasCatalogueOnly}
              onClearHasCatalogueOnly={() => setHasCatalogueOnly(false)}
              activeFilterShape={activeFilterShape}
              onClearSpatialFilterShape={() =>
                setActiveSpatialFilterShapeId(null)
              }
              activeFilterCount={activeFilterCount}
              onResetAllFilters={resetAllFilters}
              hideDesktopPrimaryControls
              showPrintCapabilityBar={isPrintingCategoryActive}
              selectedPrintCapability={selectedPrintCapability}
              onSelectPrintCapability={setSelectedPrintCapability}
            />
      </div>
    </div>
  );

  const discoveryControlsContent =
    isActiveView && !isFullscreenMap ? (
      unifiedHeaderSlot ? (
        discoveryControlsInner
      ) : (
        <motion.header
          initial={false}
          animate={{ y: isHeaderVisible || isSearchFocused ? '0%' : '-100%' }}
          transition={{ type: 'spring', stiffness: 320, damping: 32 }}
          className="fixed top-0 inset-x-0 z-[100] bg-[var(--ps-surface)]/95 border-b border-[var(--ps-border)]/80 shadow-2xs"
        >
          {discoveryControlsInner}
        </motion.header>
      )
    ) : null;

  return (
    <div
      data-layout-profile={activeLayoutProfile.profile}
      className={`${
        !isActiveView ? 'hidden' : 'flex flex-col lg:flex-row w-full h-full flex-1 min-h-0 overflow-hidden'
      } bg-[var(--ps-bg)] ${
        isFullscreenMap
          ? 'fixed inset-0 z-50 h-dvh w-screen overflow-hidden'
          : ''
      }`}
    >
      {/* =====================================================================
          UNIFIED SMART MOTION HEADER CONTROLS:
          Portaled directly into the fixed <motion.header> wrapper in Header.tsx
          so Logo/Profile Navbar, Search Input row, and Category Filter row
          animate with spring physics on list scroll and map drag.
         ===================================================================== */}
      {isActiveView
        ? unifiedHeaderSlot
          ? createPortal(discoveryControlsContent, unifiedHeaderSlot)
          : discoveryControlsContent
        : null}

      {/* =====================================================================
          SECTION 5: MAIN DISCOVERY WORKSPACE (MAP MODE OR LIST MODE)
         ===================================================================== */}
      {discoveryMode === 'list' && !isFullscreenMap ? (
        /* LIST MODE: Full listing results as main content, map completely hidden */
        <motion.div
          id="explore-scroll-container"
          data-explore-scroll="true"
          ref={listModeContainerRef}
          initial={false}
          animate={{ paddingTop: isHeaderVisible ? headerHeight + 16 : 16 }}
          transition={{ type: 'spring', stiffness: 320, damping: 32 }}
          onScroll={(e) => {
            handleExploreFeedScroll(e.currentTarget);
            listModeScrollTopRef.current = e.currentTarget.scrollTop;
          }}
          data-testid="explore-list-mode-container"
          className={`relative z-10 bg-[var(--ps-bg)] flex-1 overflow-y-auto px-3 sm:px-6 pb-4 ${
            activeLayoutProfile.useBottomNav ? 'pb-20' : 'pb-6'
          } max-w-[1600px] w-full mx-auto`}
        >
          <PromoBannerSlot placement="explore_top" compact className="mb-3" />
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-[var(--ps-text)]">
                  {selectedCategory === 'vehicles'
                    ? `Vehicles & Rentals (${filteredVehicleListings.length})`
                    : `Churachandpur Directory Results (${filteredListings.length})`}
                </h2>
                <span
                  data-testid="active-search-scope-badge"
                  data-scope={searchScope}
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-[10px] font-bold border ${
                    searchScope === 'global'
                      ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30'
                      : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                  }`}
                >
                  {searchScope === 'global' ? (
                    <Globe className="w-3 h-3" />
                  ) : (
                    <MapPin className="w-3 h-3" />
                  )}
                  <span>
                    {searchScope === 'global'
                      ? 'Entire Directory'
                      : 'Visible Map Area'}
                  </span>
                </span>
              </div>
              <p className="text-xs text-[var(--ps-text-muted)]">
                Showing{' '}
                {selectedCategory === 'all'
                  ? 'all categories'
                  : selectedCategory === 'vehicles'
                    ? 'Vehicles & Rentals'
                    : CATEGORY_LABELS[selectedCategory]}{' '}
                · Scope:{' '}
                {searchScope === 'global'
                  ? 'Entire Churachandpur Directory'
                  : 'Current Visible Map Area'}{' '}
                · Area unit: {getAreaUnitSymbol(areaUnit)}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setDiscoveryMode('map')}
              className="min-h-[44px] inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-semibold shadow-xs"
            >
              <MapIcon className="w-3.5 h-3.5" />
              <span>Switch to Map View</span>
            </button>
          </div>

          <Suspense
            fallback={
              <SkeletonCardList
                count={6}
                className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3.5 items-start"
              />
            }
          >
            {selectedCategory === 'vehicles' ? (
              renderVehicleFeedSection(
                'grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3.5 items-start'
              )
            ) : effectiveIsLoading ? (
              <SkeletonCardList
                count={6}
                className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3.5 items-start"
              />
            ) : effectiveError !== null ? (
              <ErrorState
                description={effectiveError}
                retry={handleRetryDiscoveryFetch}
                onRetry={handleRetryDiscoveryFetch}
              />
            ) : filteredListings.length === 0 ? (
              <EmptyState
                title="No listings found in this area. Try zooming out or clearing your filters."
                description={
                  searchScope === 'map_area'
                    ? 'Search across the entire Churachandpur directory or clear active filters.'
                    : 'Try clearing one or more active filters or searching a broader Churachandpur locality.'
                }
                actions={
                  <>
                    {searchScope === 'map_area' && (
                      <button
                        type="button"
                        onClick={() => handleSwitchSearchScope('global')}
                        data-testid="empty-state-search-global-btn"
                        className="min-h-[44px] inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-semibold"
                      >
                        <Globe className="w-3.5 h-3.5" />
                        <span>Search Entire Directory</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={resetAllFilters}
                      data-testid="empty-state-reset-filters-btn"
                      className="min-h-[44px] inline-flex items-center justify-center px-4 py-2.5 rounded-xl bg-[var(--ps-surface-alt)] border border-[var(--ps-border)] text-[var(--ps-text)] text-xs font-semibold"
                    >
                      Reset All Filters
                    </button>
                  </>
                }
              />
            ) : (
              <ListingFeed
                initialItems={filteredListings}
                bounds={liveViewportBounds}
                isLoading={effectiveIsLoading}
                onSelectListing={handleSelectListing}
                onReloadFeed={handleRetryDiscoveryFetch}
                gridClassName="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3.5 items-start"
                renderCard={(item) =>
                  renderListingResultCard(item, true, 'list-grid')
                }
              />
            )}
          </Suspense>
        </motion.div>
      ) : (
        /* MAP MODE: Adaptive Split-Screen (Mobile Landscape, Tablet Landscape, Desktop) or Portrait Bottom Sheet (Mobile Portrait, Tablet Portrait) */
        <div
          ref={splitContainerRef}
          data-testid="explore-split-container"
          data-split-mode={isSplitScreen ? 'split' : 'sheet'}
          className={`flex-1 flex ${
            isSplitScreen ? 'flex-row' : 'flex-col lg:flex-row'
          } relative overflow-hidden min-h-0 w-full ${
            isFullscreenMap ? 'h-dvh' : 'h-full'
          }`}
        >
          {/* MAP VIEWPORT CONTAINER */}
          <div
            ref={mapViewportRef}
            data-testid="explore-map-viewport"
            data-map-center={`${mapCenter.lat.toFixed(5)},${mapCenter.lng.toFixed(5)}`}
            data-selected-listing-id={selectedListingId || ''}
            className="relative flex-1 min-w-0 w-full h-full min-h-[50vh] lg:min-h-0 overflow-hidden"
            style={{ backgroundColor: cloudMapConfig.backgroundColor }}
          >
            {/* Active Drawing Click Capture Layer (Prevents markers/POIs from intercepting clicks while drawing) */}
            {!simpleMode && activeDrawTool !== 'none' && (
              <div
                data-testid="active-drawing-capture-layer"
                aria-label={`Click map to place ${activeDrawTool}`}
                onClick={(e) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const rx = Math.max(
                    0,
                    Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width))
                  );
                  const ry = Math.max(
                    0,
                    Math.min(1, (e.clientY - rect.top) / Math.max(1, rect.height))
                  );
                  const b = liveViewportBounds || {
                    north: mapCenter.lat + 0.025,
                    south: mapCenter.lat - 0.025,
                    east: mapCenter.lng + 0.035,
                    west: mapCenter.lng - 0.035,
                  };
                  const lat = Number(
                    (b.north - ry * (b.north - b.south)).toFixed(6)
                  );
                  const lng = Number(
                    (b.west + rx * (b.east - b.west)).toFixed(6)
                  );
                  handleMapClickLatLng({ lat, lng });
                }}
                className="absolute inset-0 z-10 cursor-crosshair"
              />
            )}

            {/* Phase 57: Header-synced Map Overlay Frame — glides in lockstep with sticky header without resizing Google Maps */}
            <motion.div
              ref={mapOverlayFrameRef}
              initial={false}
              animate={{
                top: isHeaderVisible && !isFullscreenMap ? headerHeight : 0,
              }}
              transition={{ type: 'spring', stiffness: 320, damping: 32 }}
              className="pointer-events-none absolute inset-x-0 bottom-0 z-20"
            >
            {/* Phase 57: Unified Top Overlay Row Inside Synced Map Overlay Frame
                Anchors Icon-Only Map Logo (when header is hidden) & Compact Non-Colliding Centered "Search area" Pill */}
            <div
              data-testid="map-top-overlay-row"
              className="relative w-full pointer-events-none"
            >
              {(isHidden || isFullscreenMap) && (
                <div
                  data-testid="floating-minimized-logo"
                  className="absolute left-2.5 top-2.5 z-20 pointer-events-auto h-9 flex items-center"
                >
                  <BrandStatusLogo
                    hideTextOnIdle
                    asButton
                    onClick={() => {
                      if (isFullscreenMap) {
                        setIsFullscreenMap(false);
                        onFullscreenMapChange?.(false);
                      }
                      handleSetHeaderVisible(true);
                    }}
                    className="h-9 min-w-9 p-0.5 rounded-full shadow-md bg-[var(--ps-surface)]/95 backdrop-blur-md border border-[var(--ps-border)]/80 text-[var(--ps-text)] hover:scale-105 transition-all"
                  />
                </div>
              )}

              {hasCameraMoved && (
                <button
                  type="button"
                  onClick={handleSearchThisArea}
                  data-testid="search-this-area-btn"
                  className="pointer-events-auto absolute top-2.5 left-1/2 -translate-x-1/2 z-20 max-w-[calc(100%-104px)] h-7 sm:h-8 px-2.5 sm:px-3 text-[11px] sm:text-xs font-medium rounded-full bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border border-slate-200/80 dark:border-slate-700/80 shadow-md text-slate-900 dark:text-slate-100 hover:bg-slate-50 dark:hover:bg-slate-800 transition-colors flex items-center justify-center gap-1.5 whitespace-nowrap"
                >
                  <Sparkles className="w-3 h-3 sm:w-3.5 sm:h-3.5 text-[var(--ps-accent)] shrink-0" />
                  <span className="truncate">
                    <span className="sm:hidden">Search area</span>
                    <span className="hidden sm:inline">Search this area</span>
                    {liveAreaMatchCount > 0 ? ` (${liveAreaMatchCount})` : ''}
                  </span>
                </button>
              )}
            </div>

            {/* Step 4F-B & B-26: Geolocation Status Notification Banner */}
            {locationStatus && (
              <div
                data-testid="location-status-banner"
                role="status"
                aria-live="polite"
                className={`absolute ${
                  hasCameraMoved ? 'top-14' : 'top-2.5'
                } left-1/2 -translate-x-1/2 z-20 pointer-events-auto max-w-[calc(100vw-32px)] sm:max-w-md w-max px-3.5 py-2 rounded-xl text-xs shadow-xl backdrop-blur-md flex items-center gap-2.5 ${
                  locationStatus.type === 'success'
                    ? 'bg-emerald-950/90 text-emerald-100 border border-emerald-500/50'
                    : locationStatus.type === 'error'
                      ? 'bg-rose-950/90 text-rose-100 border border-rose-500/50'
                      : 'bg-[var(--ps-surface)]/95 text-[var(--ps-text)] border border-[var(--ps-border)]'
                }`}
              >
                {locationStatus.type === 'success' ? (
                  <Check className="w-4 h-4 text-emerald-400 shrink-0" />
                ) : (
                  <AlertCircle className="w-4 h-4 text-rose-400 shrink-0" />
                )}
                <span className="text-[11px] sm:text-xs leading-snug">
                  {locationStatus.message}
                </span>
                <button
                  type="button"
                  onClick={() => setLocationStatus(null)}
                  aria-label="Dismiss location status"
                  className="p-1 -mr-1 rounded-lg hover:bg-white/10 text-white/70 hover:text-white shrink-0 w-7 h-7 flex items-center justify-center"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* PART C: Floating Map Toolbar (Positioned inside synced map overlay frame) */}
            <FloatingMapToolbar
              mapViewportRef={mapOverlayFrameRef}
              mapAppearance={cloudMapConfig.variant}
              onChangeMapAppearance={(variant) => setMapAppearance(variant)}
              baseMapType={cloudMapConfig.mapTypeId}
              onChangeBaseMapType={(style) => setMapStyle(style)}
              useVectorStylePreview={useVectorStylePreview}
              onToggleVectorStylePreview={() =>
                setUseVectorStylePreview(!useVectorStylePreview)
              }
              onOpenCloudConfigModal={() => {
                setDraftPrimaryMapId(configuredMapId);
                setDraftLightMapId(configuredLightMapId);
                setDraftDarkMapId(configuredDarkMapId);
                setIsCloudStyleModalOpen(true);
              }}
              isDrawToolboxOpen={isDrawToolboxOpen}
              onToggleDrawToolbox={() =>
                setIsDrawToolboxOpen((prev) => !prev)
              }
              drawnShapesCount={drawnShapes.length}
              isFullscreenMap={isFullscreenMap}
              onToggleFullscreenMap={toggleFullscreenMap}
              onRecenter={() => {
                const targetCenter = effectiveDefaultCenter;
                const defaultB = computeDefaultViewportBounds(
                  targetCenter,
                  14
                );
                suppressNextCameraMoveRef.current = true;
                setRecenterTrigger((c) => c + 1);
                setMapCenter(targetCenter);
                setCurrentMapCenter(targetCenter);
                setMapZoomLevel(14);
                setLiveViewportBounds(defaultB);
                setAppliedViewportBounds(defaultB);
                appliedBoundsRef.current = defaultB;
                setAppliedMapZoom(14);
                appliedZoomRef.current = 14;
                setHasCameraMoved(false);
                setSearchScope('map_area');
              }}
              onLocateMe={handleLocateMe}
              isLocating={isLocating}
              hasCustomDefaultCenter={Boolean(customDefaultCenter)}
              onZoomIn={() => {
                if (cameraDebounceRef.current) {
                  clearTimeout(cameraDebounceRef.current);
                  cameraDebounceRef.current = null;
                }
                suppressNextCameraMoveRef.current = true;
                const nextZ = Math.min(18, Number((mapZoomLevel + 1).toFixed(1)));
                const nextB = computeDefaultViewportBounds(mapCenter, nextZ);
                setMapZoomLevel(nextZ);
                setLiveViewportBounds(nextB);
                setHasCameraMoved(true);
                setZoomCommand({ targetZoom: nextZ, seq: Date.now() });
              }}
              onZoomOut={() => {
                if (cameraDebounceRef.current) {
                  clearTimeout(cameraDebounceRef.current);
                  cameraDebounceRef.current = null;
                }
                suppressNextCameraMoveRef.current = true;
                const nextZ = Math.max(10, Number((mapZoomLevel - 1).toFixed(1)));
                const nextB = computeDefaultViewportBounds(mapCenter, nextZ);
                setMapZoomLevel(nextZ);
                setLiveViewportBounds(nextB);
                setHasCameraMoved(true);
                setZoomCommand({ targetZoom: nextZ, seq: Date.now() });
              }}
              mobileBottomOffsetClass={mobileToolbarBottomOffsetClass}
              mobileSheetState={mobileSheetState}
              isMobileLandscape={isMobileLandscape}
              isSplitScreen={activeLayoutProfile.isSplitScreen}
              hasSelectedListing={Boolean(selectedListing)}
              hasActivePolygonEdits={
                activeDrawTool !== 'none' ||
                inProgressPoints.length > 0 ||
                Boolean(selectedShapeId) ||
                (isRealEstateMode &&
                  Boolean(
                    selectedListing?.realEstateDetails?.boundaryPolygon?.length
                  ))
              }
              isHidden={!isHeaderVisible}
              onPositionChange={setMapToolbarPosition}
              isPickNDropOpen={isPickNDropOpen}
              onTogglePickNDrop={() => {
                if (panelMode === 'pick_n_drop') {
                  handleClosePickNDrop();
                  return;
                }
                setPanelMode('pick_n_drop');
                setIsDrawToolboxOpen(false);
                setActiveDrawTool('none');
                if (isFullscreenMap) {
                  setIsFullscreenMap(false);
                }
                if (isSplitScreen) {
                  updateDesktopPanelOpen(true);
                } else {
                  setMobileSheetState('expanded');
                }
              }}
            />

            {/* Phase 60-B/C: Crosshair Banner when dropping Pick N Drop Point A / Point B */}
            {isPickNDropOpen && pndPinTarget && (
              <div
                data-testid="pnd-map-pin-banner"
                className="pointer-events-auto absolute top-14 left-1/2 -translate-x-1/2 z-[46] flex items-center gap-2 rounded-full border border-emerald-500/50 bg-slate-950/90 px-3 py-1.5 text-[11px] font-semibold text-white shadow-xl backdrop-blur-md"
              >
                <span
                  className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-extrabold ${
                    pndPinTarget === 'pickup' ? 'bg-emerald-500' : 'bg-indigo-500'
                  }`}
                >
                  {pndPinTarget === 'pickup' ? 'A' : 'B'}
                </span>
                <span>
                  Tap anywhere on the map to place{' '}
                  {pndPinTarget === 'pickup' ? 'Pickup' : 'Dropoff'} pin
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setPndPinTarget(null);
                    if (!isSplitScreen) {
                      setMobileSheetState('expanded');
                    }
                  }}
                  className="ml-1 rounded-full bg-white/15 px-2 py-0.5 text-[10px] hover:bg-white/25"
                >
                  Cancel
                </button>
              </div>
            )}

            {/* PART D: Contextual Draw & Measure Toolbox (Inside Map Viewport) */}
            {!simpleMode && isDrawToolboxOpen && (
              <DrawMeasureToolbox
                activeTool={activeDrawTool}
                onSelectTool={(tool) => {
                  setActiveDrawTool(tool);
                  setInProgressPoints([]);
                }}
                draftPoints={inProgressPoints}
                circleRadiusDraft={circleRadiusDraft}
                onChangeCircleRadiusDraft={setCircleRadiusDraft}
                onFinishDraft={finishMultiPointDrawing}
                onCancelDraft={() => {
                  setInProgressPoints([]);
                  setActiveDrawTool('none');
                }}
                drawnShapes={drawnShapes}
                selectedShapeId={selectedShapeId}
                onSelectShape={setSelectedShapeId}
                onUpdateShape={handleUpdateShape}
                onDeleteShape={handleDeleteShape}
                onClearAllShapes={() => {
                  setDrawnShapes([]);
                  setSelectedShapeId(null);
                  setActiveSpatialFilterShapeId(null);
                  setInProgressPoints([]);
                }}
                activeSpatialFilterShapeId={activeSpatialFilterShapeId}
                onToggleSpatialFilterShape={setActiveSpatialFilterShapeId}
                canUndo={canUndoDrawing}
                canRedo={canRedoDrawing}
                onUndo={undoDrawnShapes}
                onRedo={redoDrawnShapes}
                areaUnit={areaUnit}
                onCloseToolbox={() => {
                  setIsDrawToolboxOpen(false);
                  setActiveDrawTool('none');
                  setInProgressPoints([]);
                }}
                onCenterOnShape={(shape) => {
                  const pt = shape.center || shape.coordinates[0];
                  if (pt) {
                    setMapCenter(pt);
                    setClusterExpansionTarget({
                      center: pt,
                      zoom: Math.max(15, mapZoomLevel),
                      bounds: liveViewportBounds || {
                        north: pt.lat + 0.005,
                        south: pt.lat - 0.005,
                        east: pt.lng + 0.005,
                        west: pt.lng - 0.005,
                      },
                      seq: Date.now(),
                    });
                  }
                }}
                canCreateListing={geometryCreationPermission.allowed}
                createPermissionReason={geometryCreationPermission.reason}
                onCreateListingFromShape={handleCreateListingFromShape}
                mapViewportRef={mapOverlayFrameRef}
                mapToolbarPosition={mapToolbarPosition}
                mobileBottomOffsetClass={mobileToolbarBottomOffsetClass}
                mobileSheetState={mobileSheetState}
                hasSelectedListing={Boolean(selectedListing)}
                hasActiveClusterSummary={Boolean(activeClusterSummary)}
                hasHoveredListingPreview={Boolean(
                  hoveredListing &&
                    hoveredListing.id !== selectedListingId &&
                    !activeClusterSummary
                )}
                hasCameraMoved={hasCameraMoved}
                isFullscreenMap={isFullscreenMap}
                isSplitScreen={isSplitScreen}
                isMobileLandscape={isMobileLandscape}
                onPositionChange={setDrawToolboxPosition}
              />
            )}

            {/* PART G: Individual Marker Hover / Focus Preview Card (Inside Map Viewport) */}
            {hoveredListing &&
              !selectedListing &&
              hoveredListing.id !== selectedListingId &&
              !activeClusterSummary && (
                <div
                  data-testid="marker-hover-preview"
                  className="hidden sm:flex absolute bottom-4 left-4 z-20 max-w-xs rounded-2xl bg-[var(--ps-surface)]/95 backdrop-blur-md border border-[var(--ps-border)] shadow-2xl p-2.5 items-center gap-2.5 pointer-events-none"
                >
                  <ListingThumbnail
                    src={hoveredListing.coverImage}
                    alt={hoveredListing.title}
                    category={hoveredListing.category}
                    className="w-14 h-14"
                  />
                  <div className="min-w-0">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[9px] font-bold uppercase px-1.5 py-0.2 rounded bg-[var(--ps-surface-alt)] text-[var(--ps-accent)] truncate">
                        {CATEGORY_LABELS[hoveredListing.category]}
                      </span>
                      <span className="text-[10px] font-bold text-amber-500 tabular-nums shrink-0">
                        ★ {hoveredListing.rating}
                      </span>
                      {(() => {
                        const hp = printProfilesByListingId[hoveredListing.id];
                        if (!hp) return null;
                        if (hp.isFirstParty) {
                          return (
                            <span className="inline-flex items-center gap-0.5 rounded bg-theme-primary px-1.5 py-0.5 text-[9px] font-bold text-[hsl(var(--color-primary-foreground))] shrink-0">
                              <Printer className="h-2.5 w-2.5" />
                              <span>PrintSwift</span>
                            </span>
                          );
                        }
                        if (
                          hp.hasActiveEntitlement &&
                          hp.isAcceptingOrders &&
                          !hp.isBusyPaused
                        ) {
                          return (
                            <span className="inline-flex items-center gap-0.5 rounded bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-bold text-emerald-700 dark:text-emerald-300 shrink-0">
                              <Printer className="h-2.5 w-2.5" />
                              <span>Online Print</span>
                            </span>
                          );
                        }
                        return null;
                      })()}
                    </div>
                    <div className="text-xs font-bold text-[var(--ps-text)] truncate mt-0.5">
                      {hoveredListing.title}
                    </div>
                    <div className="text-[10px] text-[var(--ps-text-muted)] truncate">
                      {hoveredListing.locality}
                      {getListingPriceLabel(hoveredListing)
                        ? ` · ${getListingPriceLabel(hoveredListing)}`
                        : ''}
                    </div>
                  </div>
                </div>
              )}

            {/* PART G: Dynamic Cluster Hover / Tap Summary Card (Inside Map Viewport) */}
            {activeClusterSummary && (
              <div
                data-testid="cluster-hover-summary"
                className={`absolute top-2.5 lg:top-auto lg:bottom-4 left-2.5 right-16 sm:right-auto sm:w-80 max-w-[calc(100%-76px)] sm:max-w-[calc(100%-76px)] ${
                  !activeLayoutProfile.isSplitScreen && !isFullscreenMap
                    ? mobileSheetState === 'expanded'
                      ? 'max-h-[calc(20%-12px)]'
                      : mobileSheetState === 'partial'
                        ? 'max-h-[calc(57%-18px)]'
                        : 'max-h-[calc(100%-104px)]'
                    : 'max-h-[calc(100%-24px)]'
                } overflow-y-auto overscroll-contain z-30 rounded-2xl bg-[var(--ps-surface)]/98 backdrop-blur-md border border-[var(--ps-border)] shadow-2xl p-3.5 space-y-2.5 text-xs pointer-events-auto`}
              >
                {(() => {
                  const summary = computeClusterSummary(
                    activeClusterSummary.items
                  );
                  return (
                    <>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-bold text-[var(--ps-text)] flex items-center gap-1.5">
                          <span className="w-6 h-6 rounded-full bg-slate-900 text-white text-[11px] font-bold flex items-center justify-center">
                            {summary.count}
                          </span>
                          <span>Cluster Summary ({summary.count} Listings)</span>
                        </span>
                        <button
                          type="button"
                          onClick={() => setActiveClusterSummary(null)}
                          aria-label="Close cluster summary"
                          className="w-7 h-7 flex items-center justify-center p-1 rounded-lg text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      {/* Category Breakdown */}
                      <div className="flex flex-wrap gap-1">
                        {(
                          Object.entries(summary.categoryBreakdown) as Array<
                            [ListingCategory, number]
                          >
                        )
                          .filter(([, cnt]) => cnt > 0)
                          .map(([cat, cnt]) => (
                            <span
                              key={cat}
                              className="px-2 py-0.5 rounded-md bg-[var(--ps-surface-alt)] text-[var(--ps-text)] text-[10px] font-semibold border border-[var(--ps-border)]"
                            >
                              {CATEGORY_LABELS[cat]}: {cnt}
                            </span>
                          ))}
                      </div>

                      {/* 3 Representative Listing Names */}
                      <div className="space-y-1">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                          Representative Listings:
                        </div>
                        <ul className="space-y-0.5 text-[11px] font-medium text-[var(--ps-text)]">
                          {summary.representativeNames.map((name, i) => (
                            <li key={i} className="truncate">
                              • {name}
                            </li>
                          ))}
                        </ul>
                      </div>

                      {/* Relevant Price Range */}
                      {summary.priceRangeLabel && (
                        <div className="pt-1.5 border-t border-[var(--ps-border)] flex items-center justify-between text-[11px]">
                          <span className="text-[var(--ps-text-muted)]">
                            Sample Price Range:
                          </span>
                          <span className="font-bold text-[var(--ps-text)] tabular-nums">
                            {summary.priceRangeLabel}
                          </span>
                        </div>
                      )}

                      {/* Explicit Zoom Into Cluster Action */}
                      <button
                        type="button"
                        onClick={() =>
                          handleClusterActivate(activeClusterSummary, true)
                        }
                        data-testid="zoom-into-cluster-btn"
                        className="w-full h-9 py-1.5 px-3 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-bold hover:opacity-95 flex items-center justify-center gap-1.5"
                      >
                        <ZoomIn className="w-3.5 h-3.5" />
                        <span>Zoom into cluster</span>
                      </button>
                    </>
                  );
                })()}
              </div>
            )}
            </motion.div>

            {/* GOOGLE MAPS OR VECTOR CLOUD STYLE MAP RENDERER */}
            {apiKeyAvailable && !useVectorStylePreview ? (
              <GoogleMap
                defaultCenter={effectiveDefaultCenter}
                defaultZoom={14}
                mapId={cloudMapConfig.mapId}
                mapTypeId={cloudMapConfig.mapTypeId}
                colorScheme={cloudMapConfig.colorScheme}
                backgroundColor={cloudMapConfig.backgroundColor}
                gestureHandling="greedy"
                disableDefaultUI={true}
                zoomControl={false}
                mapTypeControl={false}
                streetViewControl={false}
                fullscreenControl={false}
                mapTypeControlOptions={{
                  position:
                    typeof google !== 'undefined' &&
                    google.maps?.ControlPosition
                      ? google.maps.ControlPosition.TOP_RIGHT
                      : (3 as google.maps.ControlPosition),
                }}
                clickableIcons={false}
                keyboardShortcuts={true}
                controlSize={28}
                internalUsageAttributionIds={[
                  'gmp_mcp_codeassist_v1_aistudio',
                ]}
                onDragstart={(e) => {
                  const center = e.map.getCenter();
                  mapDragStartLatRef.current = center ? center.lat() : null;
                }}
                onDrag={(e) => {
                  const center = e.map.getCenter();
                  if (!center) return;
                  const currentLat = center.lat();
                  const initialLat = mapDragStartLatRef.current;
                  if (initialLat === null) {
                    mapDragStartLatRef.current = currentLat;
                    return;
                  }
                  if (Math.abs(currentLat - initialLat) > 0.004) {
                    if (currentLat - initialLat < -0.004) {
                      handleSetHeaderVisible(false);
                    } else if (currentLat - initialLat > 0.004) {
                      handleSetHeaderVisible(true);
                    }
                    mapDragStartLatRef.current = currentLat;
                  }
                }}
                onClick={(e) => {
                  if (
                    (activeDrawTool !== 'none' ||
                      (isPickNDropOpen && pndPinTarget !== null)) &&
                    e.detail.latLng
                  ) {
                    handleMapClickLatLng({
                      lat: e.detail.latLng.lat,
                      lng: e.detail.latLng.lng,
                    });
                  }
                }}
                className="w-full h-full"
              >
                <MapGeometryAndViewportSync
                  selectedListing={selectedListing}
                  isRealEstateMode={isRealEstateMode}
                  filteredListings={filteredListings}
                  onSelectListing={handleSelectListing}
                  drawnShapes={drawnShapes}
                  inProgressPoints={inProgressPoints}
                  selectedShapeId={selectedShapeId}
                  onSelectShape={setSelectedShapeId}
                  onViewportChange={handleViewportSync}
                  recenterTrigger={recenterTrigger}
                  defaultCenter={effectiveDefaultCenter}
                  isDesktopPanelOpen={!isFullscreenMap && isDesktopPanelOpen}
                  layoutResizeKey={`${activeLayoutProfile.profile}-${effectiveListingSplitPct}-${viewportDims.width}x${viewportDims.height}`}
                  clusterExpansionTarget={clusterExpansionTarget}
                  zoomCommand={zoomCommand}
                  onMapActivityStatusChange={setUniversalMapStatus}
                  onMapDragPanVisibilityChange={handleSetHeaderVisible}
                />

                {/* Step 4F-D2 & Phase 25-B: Zillow-Emulation Real Estate Mode Price Bubbles on Property Polygons */}
                {isRealEstateMode &&
                  filteredListings
                    .filter(hasValidRealEstatePolygon)
                    .map((item) => {
                      const boundary = item.realEstateDetails!.boundaryPolygon!;
                      const centroid = getPolygonCentroid(boundary);
                      const isSelected = item.id === selectedListingId;
                      const isHovered = item.id === hoveredListingId;
                      const labelText = getRealEstatePolygonLabel(
                        item,
                        areaUnit
                      );
                      return (
                        <AdvancedMarker
                          key={`re-poly-label-${item.id}`}
                          position={centroid}
                          zIndex={isSelected ? 1150 : isHovered ? 1050 : 650}
                          onClick={() => handleSelectListing(item.id)}
                        >
                          <button
                            type="button"
                            onClick={() => handleSelectListing(item.id)}
                            onMouseEnter={() => setHoveredListingId(item.id)}
                            onMouseLeave={() => setHoveredListingId(null)}
                            data-testid={`real-estate-polygon-label-${item.id}`}
                            data-zillow-price-bubble="true"
                            data-listing-id={item.id}
                            data-selected={isSelected ? 'true' : 'false'}
                            data-hovered={isHovered ? 'true' : 'false'}
                            aria-label={`Select property ${item.title}: ${labelText}`}
                            className={`px-2.5 py-0.5 rounded-full border-2 shadow-md text-[10px] font-extrabold tracking-tight whitespace-nowrap cursor-pointer transition-all duration-150 ${
                              isSelected
                                ? 'bg-slate-950 text-amber-300 border-amber-400 scale-115 ring-2 ring-amber-400/80 shadow-xl'
                                : isHovered
                                  ? 'bg-white text-slate-950 border-slate-950 scale-110 ring-2 ring-emerald-500/70 shadow-xl'
                                  : 'bg-emerald-700 text-white border-white hover:bg-white hover:text-slate-950 hover:border-slate-950 hover:scale-110'
                            }`}
                          >
                            {labelText}
                          </button>
                        </AdvancedMarker>
                      );
                    })}

                {/* Phase 63-B: Active Vehicle Rental Stand Hub Pins */}
                {!isPickNDropOpen &&
                  (selectedCategory === 'all' ||
                    selectedCategory === 'vehicles') &&
                  filteredVehicleListings.map((veh) => {
                    const cleanTitle = veh.title.replace(/^\[SAMPLE\]\s*/i, '');
                    const shortRate = veh.rate_daily_inr
                      ? `₹${Number(veh.rate_daily_inr).toLocaleString('en-IN')}/d`
                      : veh.rate_hourly_inr
                        ? `₹${Number(veh.rate_hourly_inr).toLocaleString('en-IN')}/h`
                        : 'Hire';
                    return (
                      <AdvancedMarker
                        key={`vehicle-stand-pin-${veh.id}`}
                        position={{ lat: veh.lat, lng: veh.lng }}
                        zIndex={selectedCategory === 'vehicles' ? 920 : 620}
                      >
                        <Link
                          href={`/vehicles/${encodeURIComponent(veh.id)}`}
                          data-testid={`vehicle-map-pin-${veh.id}`}
                          title={`${cleanTitle} — ${veh.stand_locality}`}
                          className="inline-flex items-center gap-1 rounded-full border-2 border-white bg-slate-950/95 px-2.5 py-1 text-[10px] font-bold text-amber-300 shadow-lg hover:scale-105 hover:bg-[var(--ps-accent)] hover:text-[var(--ps-accent-fg)] transition-transform whitespace-nowrap"
                        >
                          <Car className="h-3 w-3 shrink-0" />
                          <span className="max-w-[110px] truncate">
                            {cleanTitle}
                          </span>
                          <span className="font-mono text-white/90">
                            · {shortRate}
                          </span>
                        </Link>
                      </AdvancedMarker>
                    );
                  })}

                {/* In-progress draft vertices for Line, Polygon, or Rectangle */}
                {inProgressPoints.map((pt, idx) => (
                  <AdvancedMarker
                    key={`draft-pt-${idx}`}
                    position={pt}
                    zIndex={960}
                  >
                    <div
                      data-testid={`draft-vertex-marker-${idx}`}
                      className="w-3.5 h-3.5 rounded-full bg-amber-400 border-2 border-slate-950 shadow-md"
                    />
                  </AdvancedMarker>
                ))}

                {/* Custom User-Drawn Point Markers (Draggable & Visually Distinct) */}
                {drawnShapes
                  .filter(
                    (s) =>
                      s.type === 'point' &&
                      s.visible !== false &&
                      s.coordinates[0]
                  )
                  .map((shape) => {
                    const isSel = shape.id === selectedShapeId;
                    return (
                      <AdvancedMarker
                        key={shape.id}
                        position={shape.coordinates[0]}
                        draggable={true}
                        zIndex={isSel ? 950 : 600}
                        onClick={() => {
                          setSelectedShapeId(shape.id);
                          setIsDrawToolboxOpen(true);
                        }}
                        onDragEnd={(ev) => {
                          if (ev.latLng) {
                            const nextPt = {
                              lat: Number(ev.latLng.lat().toFixed(6)),
                              lng: Number(ev.latLng.lng().toFixed(6)),
                            };
                            handleUpdateShape({
                              ...shape,
                              coordinates: [nextPt],
                              center: nextPt,
                            });
                          }
                        }}
                      >
                        <div
                          data-testid={`custom-point-marker-${shape.id}`}
                          className={`px-2 py-1 rounded-md border-2 shadow-lg flex items-center gap-1 text-[10px] font-bold cursor-pointer transition-transform ${
                            isSel
                              ? 'bg-amber-400 text-slate-950 border-slate-950 scale-115 ring-4 ring-amber-400/60'
                              : 'bg-teal-600 text-white border-white hover:scale-110'
                          }`}
                        >
                          <MapPin className="w-3 h-3 shrink-0" />
                          <span className="max-w-[90px] truncate">
                            {shape.label}
                          </span>
                        </div>
                      </AdvancedMarker>
                    );
                  })}

                {/* Standard Point Markers with Dynamic Geospatial Clustering (Zillow Price Bubbles in Real Estate Mode) */}
                <ClusteredListingMarkers
                  listings={clusteredMapListings}
                  selectedListing={
                    selectedListing &&
                    (searchScope === 'global' ||
                      isPointInViewport(
                        selectedListing.coordinates,
                        appliedViewportBounds
                      ))
                      ? selectedListing
                      : null
                  }
                  selectedListingId={selectedListingId}
                  hoveredListingId={hoveredListingId}
                  isRealEstateMode={isRealEstateMode}
                  printProfilesByListingId={printProfilesByListingId}
                  onSelectListing={handleSelectListing}
                  onHoverListing={setHoveredListingId}
                />

                {/* Phase 17 & 25-B: Pulsing "You Are Here" User Location Marker & Directions Route Renderer (with Center-Pin Fallback) */}
                {userLocation && <YouAreHereMarker position={userLocation} />}
                {activeRouteTarget && (
                  <RouteRenderer
                    origin={userLocation}
                    destination={activeRouteTarget.coordinates}
                    destinationTitle={activeRouteTarget.title}
                    mapCenter={mapCenter}
                    isSettingOrigin={isSettingManualOrigin || !userLocation}
                    onSetOriginHere={(originCoords) => {
                      setUserLocation(originCoords);
                      setIsSettingManualOrigin(false);
                    }}
                    onCancelSetOrigin={() => {
                      setIsSettingManualOrigin(false);
                      setActiveRouteTarget(null);
                      setActiveRouteEstimate(null);
                      pendingRouteListingRef.current = null;
                    }}
                    onClearRoute={() => {
                      setIsSettingManualOrigin(false);
                      setActiveRouteTarget(null);
                      setActiveRouteEstimate(null);
                      pendingRouteListingRef.current = null;
                    }}
                    onRouteCalculated={setActiveRouteEstimate}
                  />
                )}
                {isPickNDropOpen && (pndPickup || pndDropoff) && (
                  <PickNDropRouteLayer
                    pickup={pndPickup}
                    dropoff={pndDropoff}
                    isTwoWay={pndTripType === 'two_way'}
                  />
                )}
              </GoogleMap>
            ) : (
              <>
                <InteractiveVectorMap
                  listings={unclusteredListings}
                  clusters={clusters}
                  selectedListing={selectedListing}
                  hoveredListingId={hoveredListingId}
                  printProfilesByListingId={printProfilesByListingId}
                  onSelectListing={handleSelectListing}
                  onHoverListing={setHoveredListingId}
                  onClusterClick={(items) => {
                    const matchedCluster = clusters.find(
                      (c) => c.items === items
                    ) || {
                      id: 'cluster-tap',
                      center: items[0]?.coordinates || CHURACHANDPUR_SAMPLE_CENTER,
                      items,
                    };
                    handleClusterActivate(matchedCluster);
                  }}
                  onHoverCluster={(c) => {
                    if (
                      c &&
                      typeof window !== 'undefined' &&
                      window.innerWidth >= 1024
                    ) {
                      setActiveClusterSummary(c);
                    }
                  }}
                  mapStyle={mapStyle}
                  mapAppearance={cloudMapConfig.variant}
                  center={mapCenter}
                  zoom={mapZoomLevel}
                  onCameraChange={(c, z, b) => handleViewportSync(b, c, z)}
                  onViewportChange={handleBoundsOnlySync}
                  drawnShapes={drawnShapes}
                  inProgressPoints={inProgressPoints}
                  selectedShapeId={selectedShapeId}
                  onSelectShape={(id) => {
                    setSelectedShapeId(id);
                    setIsDrawToolboxOpen(true);
                  }}
                  onMapClickLatLng={handleMapClickLatLng}
                  recenterTrigger={recenterTrigger}
                  isRealEstateMode={isRealEstateMode}
                  realEstateListings={filteredListings}
                  areaUnit={areaUnit}
                  hasActivePolygonEdits={
                    activeDrawTool !== 'none' ||
                    inProgressPoints.length > 0 ||
                    Boolean(selectedShapeId) ||
                    (isRealEstateMode &&
                      Boolean(
                        selectedListing?.realEstateDetails?.boundaryPolygon
                          ?.length
                      ))
                  }
                  onTogglePolygonEditTools={() =>
                    setIsDrawToolboxOpen((prev) => !prev)
                  }
                  routeOrigin={
                    isPickNDropOpen && pndPickup
                      ? { lat: pndPickup.lat, lng: pndPickup.lng }
                      : userLocation
                  }
                  routeDestination={
                    isPickNDropOpen && pndDropoff
                      ? { lat: pndDropoff.lat, lng: pndDropoff.lng }
                      : activeRouteTarget?.coordinates || null
                  }
                  highlightPolygon={
                    selectedListing?.category === 'real_estate' &&
                    selectedListing.realEstateDetails &&
                    shouldShowPlotAndBoundary(
                      selectedListing.realEstateDetails.propertyType,
                      selectedListing.realEstateDetails.hasAssociatedPlot
                    )
                      ? selectedListing.realEstateDetails.boundaryPolygon
                      : undefined
                  }
                  showPolygon={true}
                  hideBuiltInControls={true}
                  defaultCenter={effectiveDefaultCenter}
                />
                {activeRouteTarget && (
                  <RouteRenderer
                    origin={userLocation}
                    destination={activeRouteTarget.coordinates}
                    destinationTitle={activeRouteTarget.title}
                    mapCenter={mapCenter}
                    isSettingOrigin={isSettingManualOrigin || !userLocation}
                    onSetOriginHere={(originCoords) => {
                      setUserLocation(originCoords);
                      setIsSettingManualOrigin(false);
                    }}
                    onCancelSetOrigin={() => {
                      setIsSettingManualOrigin(false);
                      setActiveRouteTarget(null);
                      setActiveRouteEstimate(null);
                      pendingRouteListingRef.current = null;
                    }}
                    onClearRoute={() => {
                      setIsSettingManualOrigin(false);
                      setActiveRouteTarget(null);
                      setActiveRouteEstimate(null);
                      pendingRouteListingRef.current = null;
                    }}
                    onRouteCalculated={setActiveRouteEstimate}
                  />
                )}
              </>
            )}

            {/* ===============================================================
                STEP 4A: UNIFIED FLOATING SELECTED LISTING OVERLAY
                Visible in Full-Screen Map Mode, Collapsed Split Sidebar,
                and Mobile/Tablet Portrait above the Collapsed Bottom Sheet Bar
               =============================================================== */}
            {selectedListing &&
              selectedOverlayLayout.shouldRenderFloatingOverlay && (
                <div
                  data-testid="floating-selected-listing-overlay"
                  className={`absolute ${selectedOverlayLayout.positionClasses} z-30 pointer-events-auto ps-animate-in-card`}
                >
                  <SelectedListingCard
                    listing={selectedListing}
                    variant="mobile-overlay"
                    isLoadingDetails={isLoadingSelectedDetails}
                    onClearSelection={handleClearSelection}
                    onCenterOnMap={() => handleCenterOnListing(selectedListing)}
                    onZoomToItem={() => handleZoomToItem(selectedListing)}
                    onGetDirections={handleGetDirectionsToListing}
                    routeEstimate={
                      activeRouteTarget?.id === selectedListing.id
                        ? activeRouteEstimate
                        : null
                    }
                    onExpandDetails={() => setIsExpandedDetailModalOpen(true)}
                    onOpenFullPage={onOpenFullDetailPage}
                    showReopenSidebarAction={
                      selectedOverlayLayout.showReopenSidebarAction
                    }
                    onReopenDesktopSidebar={() => updateDesktopPanelOpen(true)}
                  />
                </div>
              )}

            {/* ===============================================================
                MOBILE & TABLET PORTRAIT 3-STATE LISTING BOTTOM SHEET
                (Rendered in portrait modes; uses 2-column compact card grid on Tablet Portrait;
                 Phase 27: Strict overflow-hidden & collapsed height guard prevents card bleed)
               =============================================================== */}
            {isActiveView && !isFullscreenMap && !isSplitScreen && (
              <div
                data-testid="mobile-listing-bottom-sheet"
                data-sheet-state={mobileSheetState}
                className={`absolute left-0 right-0 bottom-0 z-[100] bg-[var(--ps-surface)]/98 backdrop-blur-md rounded-t-3xl border-t border-[var(--ps-border)] shadow-xl flex flex-col overflow-hidden transition-all duration-200 pointer-events-auto ${
                  mobileSheetState === 'collapsed'
                    ? 'h-[76px] max-h-[76px]'
                    : mobileSheetState === 'partial'
                      ? isTabletPortrait
                        ? 'h-[42%] max-h-[420px] min-h-[230px]'
                        : 'h-[40%] max-h-[320px] min-h-[200px]'
                      : 'h-[78%]'
                }`}
              >
                {/* Sheet Drag Handle & Header */}
                <div
                  onPointerDown={handleSheetPointerDown}
                  onPointerUp={handleSheetPointerUp}
                  data-testid="mobile-sheet-handle"
                  className={`relative px-4 pt-1.5 pb-1.5 ${
                    mobileSheetState === 'collapsed'
                      ? 'border-b-0 h-full'
                      : 'border-b border-[var(--ps-border)]/70'
                  } cursor-grab active:cursor-grabbing select-none shrink-0 overflow-hidden`}
                >
                  <div className="h-1.5 w-10 bg-gray-300 dark:bg-gray-600 rounded-full mx-auto mb-1.5" />
                  <div className="flex items-center justify-between gap-2 pr-16">
                    {panelMode === 'pick_n_drop' ? (
                      <div className="min-w-0 flex items-center gap-1.5">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleClosePickNDrop();
                          }}
                          onPointerDown={(e) => e.stopPropagation()}
                          data-testid="mobile-sheet-back-to-listings-btn"
                          className="inline-flex h-6 items-center gap-1 rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-1.5 text-[10px] font-bold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] shrink-0"
                        >
                          <ArrowLeft className="h-3 w-3" />
                          <span>Listings</span>
                        </button>
                        <span className="inline-flex items-center gap-1 text-xs font-extrabold text-emerald-700 dark:text-emerald-400 truncate">
                          <Package className="h-3.5 w-3.5 shrink-0" />
                          <span>Pick N Drop</span>
                        </span>
                      </div>
                    ) : (
                      <div className="min-w-0 flex items-center gap-1.5">
                        <span className="text-xs font-extrabold text-[var(--ps-text)] shrink-0">
                          {filteredListings.length} Listings
                        </span>
                        <span
                          data-testid="mobile-sheet-scope-badge"
                          data-scope={searchScope}
                          className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[9px] font-bold border shrink-0 ${
                            searchScope === 'global'
                              ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30'
                              : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30'
                          }`}
                        >
                          {searchScope === 'global' ? (
                            <Globe className="w-2.5 h-2.5" />
                          ) : (
                            <MapPin className="w-2.5 h-2.5" />
                          )}
                          <span>
                            {searchScope === 'global'
                              ? 'Entire Directory'
                              : 'Visible Map Area'}
                          </span>
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Phase 29: Subtle, compact mobile collapse/expand control icons pinned at absolute top-2 right-2 */}
                  <div
                    role="group"
                    aria-label="Results panel size"
                    data-testid="mobile-sheet-size-control"
                    onClick={(e) => e.stopPropagation()}
                    onPointerDown={(e) => e.stopPropagation()}
                    className="absolute top-2 right-2 z-20 inline-flex items-center gap-0.5 p-0.5 rounded-lg bg-[var(--ps-bg)]/90 border border-[var(--ps-border)]/70 shrink-0"
                  >
                    <button
                      type="button"
                      onClick={() => {
                        setActiveClusterSummary(null);
                        setMobileSheetState('collapsed');
                      }}
                      aria-pressed={mobileSheetState === 'collapsed'}
                      aria-label="Collapse results panel"
                      title="Collapse results panel"
                      data-testid="sheet-collapse-btn"
                      className={`w-4 h-4 text-xs p-1 rounded inline-flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ps-ring)] ${
                        mobileSheetState === 'collapsed'
                          ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                          : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                      }`}
                    >
                      <ChevronDown className="w-3 h-3 shrink-0" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveClusterSummary(null);
                        setMobileSheetState('partial');
                      }}
                      aria-pressed={mobileSheetState === 'partial'}
                      aria-label="Partial expansion results panel"
                      title="Partial expansion"
                      data-testid="sheet-partial-btn"
                      className={`w-4 h-4 text-xs p-1 rounded inline-flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ps-ring)] ${
                        mobileSheetState === 'partial'
                          ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                          : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                      }`}
                    >
                      <Minus className="w-3 h-3 shrink-0" />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setActiveClusterSummary(null);
                        setMobileSheetState('expanded');
                      }}
                      aria-pressed={mobileSheetState === 'expanded'}
                      aria-label="Full expansion results panel"
                      title="Full expansion"
                      data-testid="sheet-expand-btn"
                      className={`w-4 h-4 text-xs p-1 rounded inline-flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[var(--ps-ring)] ${
                        mobileSheetState === 'expanded'
                          ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                          : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                      }`}
                    >
                      <ChevronUp className="w-3 h-3 shrink-0" />
                    </button>
                  </div>

                  {/* Collapsed Preview Line */}
                  {mobileSheetState === 'collapsed' &&
                    (panelMode === 'pick_n_drop' ? (
                      <div className="text-[11px] text-[var(--ps-text-muted)] truncate mt-0.5">
                        {pndPinTarget
                          ? `Tap map to place Point ${pndPinTarget === 'pickup' ? 'A (Pickup)' : 'B (Dropoff)'}`
                          : 'Tap expand to finish your Pick N Drop booking'}
                      </div>
                    ) : (
                      (selectedListing || filteredListings[0]) && (
                        <div className="text-[11px] text-[var(--ps-text-muted)] truncate mt-0.5">
                          {selectedListing ? 'Selected: ' : 'Top match: '}
                          <strong className="text-[var(--ps-text)]">
                            {(selectedListing || filteredListings[0]).title}
                          </strong>{' '}
                          ({(selectedListing || filteredListings[0]).locality})
                        </div>
                      )
                    ))}
                </div>

                {/* Scrollable Body inside Partial / Expanded Sheet */}
                {mobileSheetState !== 'collapsed' && (
                  <div
                    id="explore-scroll-container"
                    data-explore-scroll="true"
                    ref={mobileSheetListRef}
                    onScroll={(e) => {
                      if (
                        isActiveView &&
                        !isExpandedDetailModalOpen &&
                        panelMode === 'listings' &&
                        e.currentTarget.clientHeight > 0
                      ) {
                        handleExploreFeedScroll(e.currentTarget);
                        mobileSheetScrollTopRef.current =
                          e.currentTarget.scrollTop;
                      }
                    }}
                    data-testid="mobile-sheet-results-list"
                    className={
                      panelMode === 'pick_n_drop'
                        ? 'flex-1 overflow-y-auto overscroll-contain p-3'
                        : 'flex-1 overflow-y-auto p-3 grid grid-cols-1 md:grid-cols-2 gap-2.5 content-start items-start'
                    }
                  >
                    {panelMode !== 'pick_n_drop' && (
                      <PromoBannerSlot
                        placement="explore_top"
                        compact
                        className="col-span-full"
                      />
                    )}
                    {panelMode === 'pick_n_drop' ? (
                      <PickNDropPanel
                        isActive={isPickNDropOpen}
                        onBackToListings={handleClosePickNDrop}
                        pickup={pndPickup}
                        dropoff={pndDropoff}
                        onChangePickup={setPndPickup}
                        onChangeDropoff={setPndDropoff}
                        activePinTarget={pndPinTarget}
                        onSelectPinTarget={(target) => {
                          setPndPinTarget(target);
                          if (target && !isSplitScreen) {
                            setMobileSheetState('collapsed');
                          }
                        }}
                        onTripTypeChange={setPndTripType}
                      />
                    ) : (
                      <>
                        {selectedListing &&
                          !filteredListings.some(
                            (l) => l.id === selectedListing.id
                          ) &&
                          renderListingResultCard(
                            selectedListing,
                            false,
                            'mobile-sheet'
                          )}
                    <Suspense
                      fallback={
                        <SkeletonCardList
                          count={4}
                          className="col-span-full grid grid-cols-1 md:grid-cols-2 gap-2.5"
                        />
                      }
                    >
                      {effectiveIsLoading ? (
                        <SkeletonCardList
                          count={4}
                          className="col-span-full grid grid-cols-1 md:grid-cols-2 gap-2.5"
                        />
                      ) : effectiveError !== null ? (
                        <ErrorState
                          compact
                          className="col-span-full"
                          description={effectiveError}
                          retry={handleRetryDiscoveryFetch}
                          onRetry={handleRetryDiscoveryFetch}
                        />
                      ) : selectedCategory === 'vehicles' ? (
                        renderVehicleFeedSection(
                          'grid grid-cols-1 md:grid-cols-2 gap-2.5 content-start items-start'
                        )
                      ) : filteredListings.length === 0 ? (
                        <EmptyState
                          compact
                          className="col-span-full"
                          title="No listings found in this area. Try zooming out or clearing your filters."
                          actions={
                            <>
                              {searchScope === 'map_area' && (
                                <button
                                  type="button"
                                  onClick={() => handleSwitchSearchScope('global')}
                                  data-testid="empty-state-search-global-btn"
                                  className="min-h-[44px] inline-flex items-center justify-center gap-1 px-3.5 py-2.5 rounded-lg bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-semibold"
                                >
                                  <Globe className="w-3 h-3" />
                                  <span>Search Entire Directory</span>
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={resetAllFilters}
                                data-testid="empty-state-reset-filters-btn"
                                className="min-h-[44px] inline-flex items-center justify-center px-3.5 py-2.5 rounded-lg bg-[var(--ps-surface-alt)] border border-[var(--ps-border)] text-[var(--ps-text)] text-xs font-semibold"
                              >
                                Reset Filters
                              </button>
                            </>
                          }
                        />
                      ) : (
                        <ListingFeed
                          initialItems={filteredListings}
                          bounds={liveViewportBounds}
                          isLoading={effectiveIsLoading}
                          onSelectListing={handleSelectListing}
                          onReloadFeed={handleRetryDiscoveryFetch}
                          className="col-span-full"
                          gridClassName="grid grid-cols-1 md:grid-cols-2 gap-2.5 content-start items-start"
                          renderCard={(item) =>
                            renderListingResultCard(item, false, 'mobile-sheet')
                          }
                        />
                        )}
                      </Suspense>
                    </>
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Split-Screen Subtle Minimal Window Edge Tab when Contextual Panel is Collapsed */}
            {!isFullscreenMap && isSplitScreen && !isDesktopPanelOpen && (
              <motion.button
                type="button"
                initial={false}
                animate={{
                  top: (isHeaderVisible ? headerHeight : 0) + 12,
                }}
                transition={{ type: 'spring', stiffness: 320, damping: 32 }}
                onClick={() => updateDesktopPanelOpen(true)}
                aria-label="Expand contextual listing panel"
                title="Expand Contextual Listing Panel"
                data-testid="desktop-sidebar-expand-edge-btn"
                className="inline-flex items-center gap-1.5 absolute right-3 z-20 px-2.5 py-1.5 rounded-lg bg-[var(--ps-surface)]/90 backdrop-blur-md border border-[var(--ps-border)]/70 shadow-sm text-[11px] font-medium text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface)] transition-colors"
              >
                <span
                  className={`w-2 h-2 rounded-full ${
                    panelMode === 'pick_n_drop'
                      ? 'bg-emerald-500'
                      : 'bg-sky-500/80'
                  }`}
                />
                <PanelRightOpen className="w-3.5 h-3.5 stroke-[1.5]" />
                <span className="tabular-nums">
                  {panelMode === 'pick_n_drop'
                    ? 'Pick N Drop'
                    : `(${filteredListings.length})`}
                </span>
              </motion.button>
            )}
          </div>

          {/* =================================================================
              STEP 4C / 4D: INTERACTIVE SPLIT-SCREEN RESIZE HANDLE
              Allows resizing between Map and Listing Panel with min/max guards
             ================================================================= */}
          {!isFullscreenMap && isSplitScreen && isDesktopPanelOpen && (
            <div
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize map and listing panel split"
              aria-valuenow={splitDividerAriaMetrics.valueNow}
              aria-valuemin={splitDividerAriaMetrics.valueMin}
              aria-valuemax={splitDividerAriaMetrics.valueMax}
              aria-valuetext={splitDividerAriaMetrics.valueText}
              data-map-split-pct={splitDividerAriaMetrics.valueNow}
              data-listing-split-pct={splitDividerAriaMetrics.listingPct}
              tabIndex={0}
              title="Drag to resize map and listing split (Double-click to reset default proportions)"
              data-testid="split-screen-resize-handle"
              onPointerDown={handleResizeSplitStart}
              onKeyDown={handleResizeSplitKeyDown}
              onDoubleClick={() => {
                suppressNextCameraMoveRef.current = true;
                updateCustomSplitForProfile(
                  activeLayoutProfile.profile,
                  activeLayoutProfile.defaultListingSplitPct
                );
              }}
              className={`w-2 shrink-0 bg-[var(--ps-surface-alt)]/60 hover:bg-[var(--ps-accent)]/20 border-l border-[var(--ps-border)] cursor-col-resize flex flex-col items-center justify-center z-20 transition-colors select-none touch-none ${
                isResizingSplit ? 'bg-[var(--ps-accent)]/30' : ''
              }`}
            >
              <GripVertical className="w-3 h-3 text-[var(--ps-text-muted)]/60" />
            </div>
          )}

          {/* =================================================================
              ADAPTIVE SPLIT-SCREEN CONTEXTUAL LISTING PANEL
              (Phase 39-C: Uses Framer Motion top padding on the UI panel so it
               fluidly pushes down when the fixed header returns without resizing map)
             ================================================================= */}
          {!isFullscreenMap && isSplitScreen && isDesktopPanelOpen && (
            <aside
              aria-label="Contextual discovery results and selected listing panel"
              data-testid="desktop-discovery-sidebar"
              data-layout-profile={activeLayoutProfile.profile}
              data-listing-split-pct={effectiveListingSplitPct}
              data-map-split-pct={Number(
                (100 - effectiveListingSplitPct).toFixed(1)
              )}
              style={{
                width: `${effectiveListingSplitPct}%`,
                minWidth: `${activeLayoutProfile.minListingWidthPx}px`,
                maxWidth: '50%',
              }}
              className="relative z-[40] w-full lg:w-[450px] shrink-0 h-full overflow-y-auto bg-[var(--ps-surface)] flex lg:border-l border-[var(--ps-border)] flex-col"
            >
              <motion.div
                initial={false}
                animate={{
                  paddingTop: isHeaderVisible && !isFullscreenMap ? headerHeight : 0,
                }}
                transition={{ type: 'spring', stiffness: 320, damping: 32 }}
                className="flex flex-col h-full min-h-0"
              >
                <div
                  className={`${
                    isMobileLandscape ? 'px-2.5 py-1.5' : 'px-3.5 py-2'
                  } border-b border-[var(--ps-border)]/70 bg-[var(--ps-surface)]/95 backdrop-blur-md flex items-center justify-between gap-2 shrink-0`}
                >
                  <div className="flex items-center gap-2 min-w-0">
                    {/* Subtle macOS/Windows Minimal Window Controls */}
                    <button
                      type="button"
                      onClick={() => updateDesktopPanelOpen(false)}
                      aria-label="Collapse contextual listing panel"
                      title="Minimize / hide side panel"
                      data-testid="desktop-sidebar-collapse-btn"
                      className="group inline-flex items-center gap-1 px-1.5 py-1 rounded-md text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors"
                    >
                      <span className="w-2 h-2 rounded-full bg-amber-400/80 group-hover:bg-rose-500 transition-colors" />
                      <PanelRightClose className="w-3.5 h-3.5 stroke-[1.5] opacity-75 group-hover:opacity-100" />
                    </button>

                    <div className="min-w-0">
                      <h2 className="flex items-center gap-1.5 text-xs font-bold tracking-tight text-[var(--ps-text)] truncate">
                        {panelMode === 'pick_n_drop' ? (
                          <>
                            <Package className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                            <span>Pick N Drop</span>
                          </>
                        ) : searchScope === 'global' ? (
                          `Entire Directory (${filteredListings.length})`
                        ) : (
                          `Visible Map Area (${filteredListings.length})`
                        )}
                      </h2>
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {panelMode === 'pick_n_drop' ? (
                      <>
                        <button
                          type="button"
                          onClick={handleClosePickNDrop}
                          data-testid="desktop-sidebar-back-to-listings-btn"
                          className="inline-flex h-7 items-center gap-1 px-2 text-[10px] rounded-md font-semibold border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors"
                        >
                          <ArrowLeft className="w-3 h-3" />
                          <span>Listings</span>
                        </button>
                        <button
                          type="button"
                          onClick={handleClosePickNDrop}
                          aria-label="Close Pick N Drop"
                          data-testid="pnd-drawer-close-btn"
                          className="flex h-7 w-7 items-center justify-center rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] transition-colors"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        onClick={() =>
                          handleSwitchSearchScope(
                            searchScope === 'map_area' ? 'global' : 'map_area'
                          )
                        }
                        data-testid="active-search-scope-badge"
                        data-scope={searchScope}
                        title="Click to switch search scope"
                        className="inline-flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-md font-medium border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] transition-colors"
                      >
                        {searchScope === 'global' ? (
                          <Globe className="w-2.5 h-2.5 text-[var(--ps-accent)]" />
                        ) : (
                          <MapPin className="w-2.5 h-2.5 text-[var(--ps-accent)]" />
                        )}
                        <span>
                          {searchScope === 'global' ? 'Directory' : 'Map Area'}
                        </span>
                      </button>
                    )}
                  </div>
                </div>

                <div
                  id="explore-scroll-container"
                  data-explore-scroll="true"
                  ref={desktopListRef}
                  data-testid="desktop-sidebar-results-list"
                  onScroll={(e) => {
                    if (
                      isActiveView &&
                      !isExpandedDetailModalOpen &&
                      panelMode === 'listings' &&
                      e.currentTarget.clientHeight > 0
                    ) {
                      handleExploreFeedScroll(e.currentTarget);
                      desktopListScrollTopRef.current =
                        e.currentTarget.scrollTop;
                    }
                  }}
                  className={`flex-1 overflow-y-auto overscroll-contain ${
                    isMobileLandscape
                      ? 'p-2 space-y-2'
                      : 'p-3.5 space-y-3'
                  }`}
                >
                  {panelMode !== 'pick_n_drop' && (
                    <PromoBannerSlot placement="explore_top" compact />
                  )}
                  {panelMode === 'pick_n_drop' ? (
                    <PickNDropPanel
                      isActive={isPickNDropOpen}
                      onBackToListings={handleClosePickNDrop}
                      pickup={pndPickup}
                      dropoff={pndDropoff}
                      onChangePickup={setPndPickup}
                      onChangeDropoff={setPndDropoff}
                      activePinTarget={pndPinTarget}
                      onSelectPinTarget={setPndPinTarget}
                      onTripTypeChange={setPndTripType}
                    />
                  ) : (
                    <>
                      {selectedListing &&
                        !filteredListings.some(
                          (l) => l.id === selectedListing.id
                        ) &&
                        renderListingResultCard(
                          selectedListing,
                          false,
                          'desktop-sidebar'
                        )}
                  <Suspense
                    fallback={
                      <SkeletonCardList
                        count={4}
                        compact={isMobileLandscape}
                        className={isMobileLandscape ? 'space-y-2' : 'space-y-3'}
                      />
                    }
                  >
                    {effectiveIsLoading ? (
                      <SkeletonCardList
                        count={4}
                        compact={isMobileLandscape}
                        className={isMobileLandscape ? 'space-y-2' : 'space-y-3'}
                      />
                    ) : effectiveError !== null ? (
                      <ErrorState
                        compact
                        description={effectiveError}
                        retry={handleRetryDiscoveryFetch}
                        onRetry={handleRetryDiscoveryFetch}
                      />
                    ) : selectedCategory === 'vehicles' ? (
                      renderVehicleFeedSection(
                        isMobileLandscape ? 'space-y-2' : 'space-y-3'
                      )
                    ) : filteredListings.length === 0 ? (
                      <EmptyState
                        compact
                        title="No listings found in this area. Try zooming out or clearing your filters."
                        actions={
                          <>
                            {searchScope === 'map_area' && (
                              <button
                                type="button"
                                onClick={() => handleSwitchSearchScope('global')}
                                data-testid="empty-state-search-global-btn"
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]"
                              >
                                <Globe className="w-3.5 h-3.5" />
                                <span>Search Entire Directory</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={resetAllFilters}
                              data-testid="empty-state-reset-filters-btn"
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[var(--ps-surface-alt)] border border-[var(--ps-border)] text-[var(--ps-text)]"
                            >
                              <RotateCcw className="w-3.5 h-3.5" />
                              <span>Reset All Filters</span>
                            </button>
                          </>
                        }
                      />
                    ) : (
                      <ListingFeed
                        initialItems={filteredListings}
                        bounds={liveViewportBounds}
                        isLoading={effectiveIsLoading}
                        onSelectListing={handleSelectListing}
                        onReloadFeed={handleRetryDiscoveryFetch}
                        gridClassName={
                          isMobileLandscape ? 'space-y-2' : 'space-y-3'
                        }
                        renderCard={(item) =>
                          renderListingResultCard(
                            item,
                            false,
                            'desktop-sidebar'
                          )
                        }
                      />
                      )}
                    </Suspense>
                    </>
                  )}
                </div>
              </motion.div>
            </aside>
          )}
        </div>
      )}

      {/* =====================================================================
          PART H: RESPONSIVE FILTER DRAWER / BOTTOM SHEET MODAL
         ===================================================================== */}
      <FilterDrawerModal
        open={isActiveView && isFilterModalOpen}
        onClose={() => setIsFilterModalOpen(false)}
        selectedCategory={
          selectedCategory === 'vehicles' ? 'all' : selectedCategory
        }
        onSelectCategory={(cat) => {
          setSelectedCategory(cat);
          setSelectedSubcategoryId(null);
          setSelectedListingId(null);
          setIsExpandedDetailModalOpen(false);
          setActiveClusterSummary(null);
          if (cat !== 'real_estate' && cat !== 'all') {
            setSelectedPropertyType('all');
          }
        }}
        selectedLocality={selectedLocality}
        onSelectLocality={setSelectedLocality}
        localities={localities}
        hubName={activeHubName}
        selectedPropertyType={selectedPropertyType}
        onSelectPropertyType={setSelectedPropertyType}
        minRating={minRating}
        onChangeMinRating={setMinRating}
        verifiedOnly={verifiedOnly}
        onChangeVerifiedOnly={setVerifiedOnly}
        priceRangeFilter={priceRangeFilter}
        onChangePriceRangeFilter={setPriceRangeFilter}
        availableOnly={availableOnly}
        onChangeAvailableOnly={setAvailableOnly}
        has360Only={has360Only}
        onChangeHas360Only={setHas360Only}
        hasCatalogueOnly={hasCatalogueOnly}
        onChangeHasCatalogueOnly={setHasCatalogueOnly}
        onClearAll={resetAllFilters}
        matchingCount={filteredListings.length}
      />

      {/* Phase 72-B: Polymorphic Summary Modal Registry (Portal z-[85], terminal for public_civic) */}
      {isActiveView && (
        <SummaryModalRegistry
          listing={summaryModalListing}
          printProfile={
            summaryModalListing
              ? (printProfilesByListingId[summaryModalListing.id] ?? null)
              : null
          }
          onClose={() => setSummaryModalListing(null)}
          onOpenFullDetailPage={(id) => {
            setSummaryModalListing(null);
            onOpenFullDetailPage(id);
          }}
          onCenterOnMap={(target) => {
            handleCenterOnListing(target);
          }}
          onGetDirections={(target) => {
            recordListingInteraction(target.id, 'directionClicksCount');
            handleGetDirectionsToListing(target);
          }}
        />
      )}

      {/* =====================================================================
          PART F: EXPANDED DETAIL OVERLAY SHEET OVER MAP VIEW
         ===================================================================== */}
      {isActiveView &&
        isExpandedDetailModalOpen &&
        selectedListing &&
        !selectedListing.is_civic_record &&
        selectedListing.listing_vertical !== 'public_civic' && (
        <div
          ref={expandedDetailsModalRef}
          tabIndex={-1}
          className="fixed inset-0 z-[9999] bg-slate-950/70 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto outline-none"
          role="dialog"
          aria-modal="true"
          aria-label={`Expanded details for ${selectedListing.title}`}
          data-testid="expanded-details-overlay"
        >
          <div className="relative z-[9999] w-full max-w-5xl max-h-[85vh] rounded-t-3xl sm:rounded-2xl bg-[var(--ps-bg)] border border-[var(--ps-border)] shadow-2xl overflow-y-auto">
            <CategoryDetailView
              listing={selectedListing}
              mode="map_expanded"
              apiKeyAvailable={apiKeyAvailable}
              onBackToMap={() => setIsExpandedDetailModalOpen(false)}
              onOpenFullPage={(id) => {
                setIsExpandedDetailModalOpen(false);
                onOpenFullDetailPage(id);
              }}
              onSelectRelatedListing={(id) => {
                setSelectedListingId(id);
              }}
            />
          </div>
        </div>
      )}

      {/* =====================================================================
          GOOGLE MAPS CLOUD STYLE & MAP ID CONFIGURATION MODAL
         ===================================================================== */}
      {isActiveView && isCloudStyleModalOpen && (
        <div
          ref={cloudStyleModalRef}
          tabIndex={-1}
          className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto outline-none"
          role="dialog"
          aria-modal="true"
          aria-label="Google Maps Cloud-Based Styling and Map ID Configuration"
          data-testid="cloud-style-modal"
        >
          <div className="w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl bg-[var(--ps-surface)] text-[var(--ps-text)] border border-[var(--ps-border)] shadow-2xl">
            <div className="px-5 py-4 border-b border-[var(--ps-border)] bg-[var(--ps-surface-alt)] flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-[var(--ps-accent)]" />
                <div>
                  <h3 tabIndex={-1} className="text-sm font-bold outline-none">
                    Google Maps Cloud-Based Styling &amp; Map IDs
                  </h3>
                  <p className="text-[11px] text-[var(--ps-text-muted)]">
                    PrintSwift Neutral Discovery (Light) &amp; PrintSwift Midnight Discovery (Dark)
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setIsCloudStyleModalOpen(false)}
                aria-label="Close Cloud Map ID settings"
                className="p-1.5 rounded-lg text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-5 space-y-4 max-h-[80vh] overflow-y-auto text-xs">
              {mapCloudFallbackNotice && (
                <div className="p-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300 text-[11px]">
                  {mapCloudFallbackNotice}
                </div>
              )}

              <div className="p-3.5 rounded-xl bg-[var(--ps-bg)] border border-[var(--ps-border)] space-y-3">
                <div className="font-bold text-[var(--ps-text)]">
                  Configurable Google Maps Map IDs
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label
                      htmlFor="cloud-primary-map-id"
                      className="block text-[11px] font-semibold text-[var(--ps-text-muted)] mb-1"
                    >
                      Primary / Shared Map ID
                    </label>
                    <input
                      id="cloud-primary-map-id"
                      type="text"
                      value={draftPrimaryMapId}
                      onChange={(e) => setDraftPrimaryMapId(e.target.value)}
                      placeholder="DEMO_MAP_ID"
                      className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--ps-surface)] border border-[var(--ps-border)] text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="cloud-light-map-id"
                      className="block text-[11px] font-semibold text-[var(--ps-text-muted)] mb-1"
                    >
                      Light Style Map ID (Optional)
                    </label>
                    <input
                      id="cloud-light-map-id"
                      type="text"
                      value={draftLightMapId}
                      onChange={(e) => setDraftLightMapId(e.target.value)}
                      placeholder="Neutral Discovery Map ID"
                      className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--ps-surface)] border border-[var(--ps-border)] text-xs font-mono"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="cloud-dark-map-id"
                      className="block text-[11px] font-semibold text-[var(--ps-text-muted)] mb-1"
                    >
                      Dark Style Map ID (Optional)
                    </label>
                    <input
                      id="cloud-dark-map-id"
                      type="text"
                      value={draftDarkMapId}
                      onChange={(e) => setDraftDarkMapId(e.target.value)}
                      placeholder="Midnight Discovery Map ID"
                      className="w-full px-2.5 py-1.5 rounded-lg bg-[var(--ps-surface)] border border-[var(--ps-border)] text-xs font-mono"
                    />
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] space-y-2">
                  <div className="font-bold">PrintSwift Neutral Discovery</div>
                  <p className="text-[11px] text-[var(--ps-text-muted)]">
                    20 cloud rules · Canvas #F7F8F6 · Muted POIs #9AA59E
                  </p>
                  <button
                    type="button"
                    onClick={() => handleCopyCloudJson('light')}
                    className="w-full py-1.5 px-2.5 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[11px] font-semibold inline-flex items-center justify-center gap-1.5"
                  >
                    {copiedStyleVariant === 'light' ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                        <span>Copied Light JSON</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy Neutral Discovery JSON</span>
                      </>
                    )}
                  </button>
                </div>

                <div className="p-3.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] space-y-2">
                  <div className="font-bold">PrintSwift Midnight Discovery</div>
                  <p className="text-[11px] text-[var(--ps-text-muted)]">
                    20 cloud rules · Canvas #171D1A · Muted POIs #77887F
                  </p>
                  <button
                    type="button"
                    onClick={() => handleCopyCloudJson('dark')}
                    className="w-full py-1.5 px-2.5 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[11px] font-semibold inline-flex items-center justify-center gap-1.5"
                  >
                    {copiedStyleVariant === 'dark' ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-500" />
                        <span>Copied Dark JSON</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy Midnight Discovery JSON</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            <div className="px-5 py-3.5 border-t border-[var(--ps-border)] bg-[var(--ps-surface-alt)] flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => {
                  setDraftPrimaryMapId('');
                  setDraftLightMapId('');
                  setDraftDarkMapId('');
                  setConfiguredMapIds({
                    mapId: '',
                    lightMapId: '',
                    darkMapId: '',
                  });
                }}
                className="px-3 py-1.5 rounded-lg border border-[var(--ps-border)] text-xs font-semibold text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]"
              >
                Reset to Fallback
              </button>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setIsCloudStyleModalOpen(false)}
                  className="px-3.5 py-1.5 rounded-lg border border-[var(--ps-border)] text-xs font-semibold text-[var(--ps-text)]"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setConfiguredMapIds({
                      mapId: draftPrimaryMapId,
                      lightMapId: draftLightMapId,
                      darkMapId: draftDarkMapId,
                    });
                    setIsCloudStyleModalOpen(false);
                  }}
                  className="px-4 py-1.5 rounded-lg bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-semibold"
                >
                  Apply Map IDs
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {/* Phase 17 & 25-B: Custom Geolocation Permission Prompt Modal with Manual Center-Pin Fallback */}
      <GeolocationPrompt
        open={isGeolocationPromptOpen}
        onClose={() => {
          setIsGeolocationPromptOpen(false);
          if (pendingRouteListingRef.current) {
            setActiveRouteTarget(pendingRouteListingRef.current);
            setIsSettingManualOrigin(true);
            pendingRouteListingRef.current = null;
          }
        }}
        onLocationResolved={handleUserLocationResolved}
        onLocationError={(msg) => {
          if (pendingRouteListingRef.current) {
            setActiveRouteTarget(pendingRouteListingRef.current);
            setIsSettingManualOrigin(true);
            pendingRouteListingRef.current = null;
          }
          setLocationStatus({
            type: 'error',
            message: msg,
            timestamp: Date.now(),
          });
        }}
      />

      {/* Phase 49-Y: First-Visit Non-Intrusive Toast to Configure Default Map Location */}
      <AnimatePresence>
        {showFirstVisitLocationToast &&
          isActiveView &&
          !isLocationPickerModalOpen && (
            <motion.div
              key="explore-set-location-toast"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 12 }}
              transition={{ duration: 0.2 }}
              data-testid="explore-set-location-toast"
              className="fixed bottom-20 lg:bottom-6 left-4 z-40 max-w-xs sm:max-w-sm rounded-2xl border border-slate-200 dark:border-slate-700 bg-[var(--ps-surface)]/95 backdrop-blur-md shadow-xl p-3.5 text-xs flex items-start gap-2.5"
            >
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-blue-600/10 text-blue-600 dark:text-blue-400">
                <Compass className="h-4 w-4" />
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                <div className="font-bold text-[var(--ps-text)] leading-snug">
                  Set your default map area
                </div>
                <p className="text-[11px] text-[var(--ps-text-muted)] leading-relaxed">
                  Choose a starting center &amp; zoom for whenever you open Explore.
                </p>
                <div className="flex items-center gap-2 pt-0.5">
                  <button
                    type="button"
                    data-testid="explore-set-location-toast-btn"
                    onClick={() => {
                      setShowFirstVisitLocationToast(false);
                      setIsLocationPickerModalOpen(true);
                    }}
                    className="rounded-lg bg-blue-600 px-2.5 py-1 text-[11px] font-bold text-white hover:bg-blue-700 transition-colors cursor-pointer"
                  >
                    Set Location
                  </button>
                  <button
                    type="button"
                    data-testid="explore-set-location-toast-later"
                    onClick={() => {
                      setShowFirstVisitLocationToast(false);
                      try {
                        window.localStorage.setItem(
                          STORAGE_KEY_MAP_PROMPT_DISMISSED,
                          '1'
                        );
                      } catch {
                        // ignore
                      }
                    }}
                    className="rounded-lg px-2 py-1 text-[11px] font-semibold text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
                  >
                    Dismiss
                  </button>
                </div>
              </div>
              <button
                type="button"
                aria-label="Dismiss location prompt"
                data-testid="explore-set-location-toast-dismiss"
                onClick={() => {
                  setShowFirstVisitLocationToast(false);
                  try {
                    window.localStorage.setItem(
                      STORAGE_KEY_MAP_PROMPT_DISMISSED,
                      '1'
                    );
                  } catch {
                    // ignore
                  }
                }}
                className="p-1 rounded-lg text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </motion.div>
          )}
      </AnimatePresence>

      {/* Phase 49-Y: Interactive Mini-Map Default Location Picker Modal */}
      <LocationPickerModal
        open={isLocationPickerModalOpen}
        onClose={() => setIsLocationPickerModalOpen(false)}
        initialCenter={mapCenter}
        initialZoom={mapZoomLevel}
        onSaved={(saved) => {
          const nextCenter = { lat: saved.lat, lng: saved.lng };
          const nextZoom = saved.zoom;
          const nextBounds = computeDefaultViewportBounds(nextCenter, nextZoom);
          suppressNextCameraMoveRef.current = true;
          hasUserPannedOrZoomedRef.current = false;
          setMapCenter(nextCenter);
          setCurrentMapCenter(nextCenter);
          setMapZoomLevel(nextZoom);
          setLiveViewportBounds(nextBounds);
          setAppliedViewportBounds(nextBounds);
          appliedBoundsRef.current = nextBounds;
          setAppliedMapZoom(nextZoom);
          appliedZoomRef.current = nextZoom;
          setClusterExpansionTarget({
            center: nextCenter,
            zoom: nextZoom,
            bounds: nextBounds,
            seq: Date.now() + Math.random(),
          });
          setShowFirstVisitLocationToast(false);
        }}
      />
    </div>
  );
}
