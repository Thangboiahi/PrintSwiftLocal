'use client';

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  Map as GoogleMap,
  AdvancedMarker,
  useMap,
} from '@vis.gl/react-google-maps';
import {
  AlertCircle,
  ArrowUpDown,
  Bookmark,
  Briefcase,
  Building2,
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
  Home,
  Landmark,
  List,
  Map as MapIcon,
  MapPin,
  Minus,
  Navigation,
  Package,
  PanelRightClose,
  PanelRightOpen,
  RotateCcw,
  Search,
  Sliders,
  Sparkles,
  Star,
  Trophy,
  Wrench,
  X,
  ZoomIn,
} from 'lucide-react';
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
import { useAppStore, useRealEstateMode, useSimpleMode } from '@/lib/store';
import {
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
import { InteractiveVectorMap } from '@/components/shared/InteractiveVectorMap';
import {
  isTopmostActiveModal,
  useModalFocusManagement,
} from '@/components/shared/ThemeSettingsModal';
import { FloatingMapToolbar } from './FloatingMapToolbar';
import { ActiveDrawTool, DrawMeasureToolbox } from './DrawMeasureToolbox';
import {
  FilterDrawerModal,
  PRICE_RANGE_LABELS,
  PriceRangeFilterOption,
} from './FilterDrawerModal';

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

const DISCOVERY_COLLAPSED_STORAGE_KEY =
  'printswift_local_discovery_collapsed_v1';
const DESKTOP_PANEL_OPEN_STORAGE_KEY =
  'printswift_local_desktop_panel_open_v1';
const SPLIT_PCT_STORAGE_KEY = 'printswift_local_split_pct_v1';

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

interface MapGeometryAndViewportSyncProps {
  selectedListing: Listing | null;
  drawnShapes: DrawnShape[];
  inProgressPoints: LatLngPoint[];
  selectedShapeId: string | null;
  onSelectShape: (shapeId: string) => void;
  onViewportChange: (bounds: MapViewportBounds, center: LatLngPoint, zoom: number) => void;
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
}

function MapGeometryAndViewportSync({
  selectedListing,
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
}: MapGeometryAndViewportSyncProps) {
  const map = useMap();
  const overlaysRef = useRef<
    Array<google.maps.Polygon | google.maps.Polyline | google.maps.Circle>
  >([]);

  const onViewportChangeRef = useRef(onViewportChange);
  useEffect(() => {
    onViewportChangeRef.current = onViewportChange;
  }, [onViewportChange]);

  // Recalculate usable Google Map dimensions when split-screen or orientation changes
  useEffect(() => {
    if (!map || typeof google === 'undefined' || !google.maps?.event) return;
    const centerBefore = map.getCenter();
    google.maps.event.trigger(map, 'resize');
    if (centerBefore) {
      map.setCenter(centerBefore);
    }
  }, [map, layoutResizeKey, isDesktopPanelOpen]);

  // Sync map bounds on idle
  useEffect(() => {
    if (!map) return;
    const emitBounds = () => {
      const b = map.getBounds();
      const c = map.getCenter();
      const z = map.getZoom() || 14;
      if (!b || !c) return;
      const ne = b.getNorthEast();
      const sw = b.getSouthWest();
      onViewportChangeRef.current(
        {
          north: ne.lat(),
          south: sw.lat(),
          east: ne.lng(),
          west: sw.lng(),
        },
        { lat: c.lat(), lng: c.lng() },
        z
      );
    };

    const listener = map.addListener('idle', emitBounds);
    emitBounds();
    return () => {
      listener.remove();
    };
  }, [map]);

  // Smoothly pan to selected listing
  const prevSelectedIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!map) return;
    const nextId = selectedListing?.id || null;
    if (nextId && nextId !== prevSelectedIdRef.current && selectedListing) {
      prevSelectedIdRef.current = nextId;
      map.panTo(selectedListing.coordinates);
    } else if (!nextId) {
      prevSelectedIdRef.current = null;
    }
  }, [map, selectedListing, isDesktopPanelOpen]);

  // Recenter trigger
  useEffect(() => {
    if (!map || recenterTrigger === 0) return;
    map.panTo(defaultCenter || CHURACHANDPUR_SAMPLE_CENTER);
    map.setZoom(14);
  }, [map, recenterTrigger, defaultCenter]);

  // Cluster expansion and quick zoom to item camera sync
  const prevClusterSeqRef = useRef<number>(0);
  useEffect(() => {
    if (!map || !clusterExpansionTarget) return;
    if (clusterExpansionTarget.seq === prevClusterSeqRef.current) return;
    prevClusterSeqRef.current = clusterExpansionTarget.seq;
    if (
      clusterExpansionTarget.fitBounds &&
      clusterExpansionTarget.bounds &&
      typeof google !== 'undefined' &&
      google.maps
    ) {
      const gBounds = new google.maps.LatLngBounds(
        new google.maps.LatLng(
          clusterExpansionTarget.bounds.south,
          clusterExpansionTarget.bounds.west
        ),
        new google.maps.LatLng(
          clusterExpansionTarget.bounds.north,
          clusterExpansionTarget.bounds.east
        )
      );
      map.fitBounds(gBounds, 50);
    } else {
      map.panTo(clusterExpansionTarget.center);
      map.setZoom(clusterExpansionTarget.zoom);
    }
  }, [map, clusterExpansionTarget]);

  // Zoom +/- button sync
  const prevZoomSeqRef = useRef<number>(0);
  useEffect(() => {
    if (!map || !zoomCommand) return;
    if (zoomCommand.seq === prevZoomSeqRef.current) return;
    prevZoomSeqRef.current = zoomCommand.seq;
    map.setZoom(Math.max(10, Math.min(19, zoomCommand.targetZoom)));
  }, [map, zoomCommand]);

  // Render property boundary polygon + user drawn shapes on Google Map
  useEffect(() => {
    if (!map || typeof google === 'undefined' || !google.maps) return;

    overlaysRef.current.forEach((o) => o.setMap(null));
    overlaysRef.current = [];

    // 1. Selected real-estate listing boundary polygon (only when allowed by Rule #28)
    if (
      selectedListing &&
      selectedListing.category === 'real_estate' &&
      selectedListing.realEstateDetails
    ) {
      const re = selectedListing.realEstateDetails;
      if (
        shouldShowPlotAndBoundary(re.propertyType, re.hasAssociatedPlot) &&
        re.boundaryPolygon &&
        re.boundaryPolygon.length >= 3
      ) {
        const propPoly = new google.maps.Polygon({
          paths: re.boundaryPolygon,
          strokeColor: '#059669',
          strokeOpacity: 0.95,
          strokeWeight: 3,
          fillColor: '#10b981',
          fillOpacity: 0.28,
          map,
        });
        overlaysRef.current.push(propPoly);
      }
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
    drawnShapes,
    inProgressPoints,
    selectedShapeId,
    onSelectShape,
  ]);

  return null;
}

interface DiscoveryWorkspaceProps {
  apiKeyAvailable: boolean;
  isActiveView?: boolean;
  onOpenFullDetailPage: (listingId: string) => void;
  onFullscreenMapChange?: (isFullscreen: boolean) => void;
  selectedLocalityOverride?: string;
  onSelectLocalityOverride?: (locality: string) => void;
  onInitiateListingFromGeometry?: (draftListing: Listing) => void;
  layoutProfile?: ResponsiveLayoutProfileResult;
  pendingMapFocusRequest?: { listingId: string; seq: number } | null;
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
}: DiscoveryWorkspaceProps) {
  const {
    currentUser,
    staffDelegations,
    listings,
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
    effectiveDefaultCenter,
    currentMapCenter,
    setCurrentMapCenter,
  } = useAppStore();
  const [simpleMode] = useSimpleMode();
  const [isRealEstateMode] = useRealEstateMode();

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

  // Search & Suggestions & Recent Searches (Section 2)
  const [searchQuery, setSearchQuery] = useState('');
  const [isSearchFocused, setIsSearchFocused] = useState(false);
  const [recentSearches, setRecentSearches] = useState<string[]>([
    'Tuibong',
    'Plot',
    'New Lamka',
    'Stationery',
  ]);
  const searchContainerRef = useRef<HTMLDivElement | null>(null);

  // Filters & Sorting (Sections 3 & 4 & Part H)
  const [selectedCategory, setSelectedCategory] = useState<
    ListingCategory | 'all'
  >('all');
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
  const [isFilterModalOpen, setIsFilterModalOpen] = useState(false);

  // Collapsible Discovery Controls & Desktop Contextual Panel Preferences (Hydration-Safe)
  const [isDiscoveryCollapsed, setIsDiscoveryCollapsed] =
    useState<boolean>(false);
  const [isDesktopPanelOpen, setIsDesktopPanelOpen] = useState<boolean>(true);
  const suppressNextCameraMoveRef = useRef<boolean>(false);

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
  }, []);

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
  const appliedZoomRef = useRef<number>(14);
  const hasInitializedBoundsRef = useRef<boolean>(false);
  const cameraDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      setMapCenter(effectiveDefaultCenter);
      setCurrentMapCenter(effectiveDefaultCenter);
      const b = computeDefaultViewportBounds(effectiveDefaultCenter, 14);
      setAppliedViewportBounds(b);
      setLiveViewportBounds(b);
      appliedBoundsRef.current = b;
    }
  }, [effectiveDefaultCenter, hasCameraMoved, setCurrentMapCenter]);

  useEffect(() => {
    return () => {
      if (cameraDebounceRef.current) {
        clearTimeout(cameraDebounceRef.current);
      }
    };
  }, []);

  const handleViewportSync = useCallback(
    (bounds: MapViewportBounds, centerPt: LatLngPoint, z: number) => {
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
        return;
      }
      hasInitializedBoundsRef.current = true;

      if (cameraDebounceRef.current) {
        clearTimeout(cameraDebounceRef.current);
      }

      cameraDebounceRef.current = setTimeout(() => {
        const canonicalBounds = computeDefaultViewportBounds(centerPt, z);
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

        if (
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
      }, 120);
    },
    [effectiveDefaultCenter, setCurrentMapCenter]
  );

  // Step 4F-B: Geolocation Locate Me Handler (Explicit user action only)
  const handleLocateMe = useCallback(() => {
    if (typeof window === 'undefined' || !navigator.geolocation) {
      setLocationStatus({
        type: 'error',
        message: 'Geolocation is not supported by your current browser environment.',
        timestamp: Date.now(),
      });
      return;
    }

    setIsLocating(true);
    setLocationStatus(null);

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setIsLocating(false);
        const { latitude, longitude } = pos.coords;
        const userLoc: LatLngPoint = {
          lat: Number(latitude.toFixed(6)),
          lng: Number(longitude.toFixed(6)),
        };
        const targetZoom = 15;
        const newBounds = computeDefaultViewportBounds(userLoc, targetZoom);

        suppressNextCameraMoveRef.current = true;
        hasUserPannedOrZoomedRef.current = true;
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
        });

        setLocationStatus({
          type: 'success',
          message: `Centred map on your current device location (${userLoc.lat.toFixed(4)}°, ${userLoc.lng.toFixed(4)}°).`,
          timestamp: Date.now(),
        });
      },
      (err) => {
        setIsLocating(false);
        let msg = 'Unable to determine your current location.';
        if (err.code === 1) {
          // PERMISSION_DENIED
          msg = 'Location access was denied. Please allow location permissions in your browser to use Locate Me.';
        } else if (err.code === 2) {
          // POSITION_UNAVAILABLE
          msg = 'Your location is currently unavailable. Please check your network or GPS connection.';
        } else if (err.code === 3) {
          // TIMEOUT
          msg = 'Location request timed out. Please try again.';
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
  }, [setCurrentMapCenter]);

  const handleBoundsOnlySync = useCallback((bounds: MapViewportBounds) => {
    if (!hasInitializedBoundsRef.current) {
      hasInitializedBoundsRef.current = true;
      return;
    }
    setLiveViewportBounds((prev) => {
      if (
        Math.abs(prev.north - bounds.north) < 0.00005 &&
        Math.abs(prev.south - bounds.south) < 0.00005 &&
        Math.abs(prev.east - bounds.east) < 0.00005 &&
        Math.abs(prev.west - bounds.west) < 0.00005
      ) {
        return prev;
      }
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

  // Selected & Hovered Listing State (Parts F & G)
  const [selectedListingId, setSelectedListingId] = useState<string | null>(
    null
  );
  const [hoveredListingId, setHoveredListingId] = useState<string | null>(null);
  const [isExpandedDetailModalOpen, setIsExpandedDetailModalOpen] =
    useState<boolean>(false);

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
  const [activeSpatialFilterShapeId, setActiveSpatialFilterShapeId] = useState<
    string | null
  >(null);
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
  }, [isSearchFocused, isSortPopoverOpen]);

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

  const localities = useMemo(() => {
    const set = new Set<string>(CHURACHANDPUR_LOCALITIES);
    listings.forEach((l) => {
      if (l.locality) set.add(l.locality);
    });
    return ['all', ...Array.from(set)];
  }, [listings]);

  const activeFilterShape = useMemo(
    () =>
      drawnShapes.find((s) => s.id === activeSpatialFilterShapeId) || null,
    [drawnShapes, activeSpatialFilterShapeId]
  );

  // Published listings with valid geographic coordinates (Step 4B Requirement 7 coordinate guard + Step 4F-D1 Real Estate Mode)
  const publishedListings = useMemo(
    () =>
      listings.filter(
        (l) =>
          l &&
          l.status === 'published' &&
          hasValidListingCoordinates(l) &&
          (!isRealEstateMode ||
            l.category === 'real_estate' ||
            (l.category as string) === 'real-estate')
      ),
    [listings, isRealEstateMode]
  );

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
          CATEGORY_LABELS[l.category].toLowerCase().includes(q)
      )
      .slice(0, 5);
    return matchedListings;
  }, [publishedListings, searchQuery]);

  // Step 4B: Filtered & Sorted Listings (Memoized on committed appliedViewportBounds so continuous map movement never triggers expensive re-filtering)
  const filteredListings = useMemo(
    () =>
      filterDiscoveryListings(publishedListings, {
        searchQuery,
        searchScope,
        appliedViewportBounds,
        selectedCategory: isRealEstateMode ? 'real_estate' : selectedCategory,
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
      }),
    [
      publishedListings,
      isRealEstateMode,
      searchQuery,
      searchScope,
      appliedViewportBounds,
      selectedCategory,
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
    ]
  );

  // Live area match count preview for the "Search This Area" button when camera has moved
  const liveAreaMatchCount = useMemo(() => {
    if (!hasCameraMoved) return filteredListings.length;
    return filterDiscoveryListings(publishedListings, {
      searchQuery,
      searchScope: 'map_area',
      appliedViewportBounds: liveViewportBounds,
      selectedCategory: isRealEstateMode ? 'real_estate' : selectedCategory,
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
    }).length;
  }, [
    hasCameraMoved,
    filteredListings.length,
    publishedListings,
    isRealEstateMode,
    searchQuery,
    liveViewportBounds,
    selectedCategory,
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
  ]);

  const selectedListing = useMemo(
    () =>
      listings.find(
        (l) =>
          l &&
          l.id === selectedListingId &&
          hasValidListingCoordinates(l) &&
          (!isRealEstateMode ||
            l.category === 'real_estate' ||
            (l.category as string) === 'real-estate')
      ) || null,
    [listings, selectedListingId, isRealEstateMode]
  );

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
      listings.find(
        (l) => l && l.id === hoveredListingId && hasValidListingCoordinates(l)
      ) || null,
    [listings, hoveredListingId]
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

  // Step 4B Requirement 2: Confirm "Search This Area" to update viewport-based results and markers together
  const handleSearchThisArea = useCallback(() => {
    if (cameraDebounceRef.current) {
      clearTimeout(cameraDebounceRef.current);
      cameraDebounceRef.current = null;
    }
    suppressNextCameraMoveRef.current = true;
    setAppliedViewportBounds(liveViewportBounds);
    appliedBoundsRef.current = liveViewportBounds;
    setAppliedMapZoom(mapZoomLevel);
    appliedZoomRef.current = mapZoomLevel;
    setSearchScope('map_area');
    setHasCameraMoved(false);
    if (
      selectedListing &&
      !isPointInViewport(selectedListing.coordinates, liveViewportBounds)
    ) {
      setSelectedListingId(null);
      setIsExpandedDetailModalOpen(false);
    }
  }, [liveViewportBounds, mapZoomLevel, selectedListing]);

  // Step 4B Requirement 5 & 7: Switch between Visible Map Area and Entire Directory without clearing query or filters
  const handleSwitchSearchScope = useCallback(
    (nextScope: DiscoverySearchScope) => {
      if (cameraDebounceRef.current) {
        clearTimeout(cameraDebounceRef.current);
        cameraDebounceRef.current = null;
      }
      setSearchScope(nextScope);
      if (nextScope === 'map_area') {
        suppressNextCameraMoveRef.current = true;
        setAppliedViewportBounds(liveViewportBounds);
        appliedBoundsRef.current = liveViewportBounds;
        setAppliedMapZoom(mapZoomLevel);
        appliedZoomRef.current = mapZoomLevel;
        setHasCameraMoved(false);
        if (
          selectedListing &&
          !isPointInViewport(selectedListing.coordinates, liveViewportBounds)
        ) {
          setSelectedListingId(null);
          setIsExpandedDetailModalOpen(false);
        }
      } else {
        setHasCameraMoved(false);
      }
    },
    [liveViewportBounds, mapZoomLevel, selectedListing]
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
        fitBounds: true,
      });
    } else {
      const targetZoom = 17;
      const nextBounds = computeDefaultViewportBounds(
        target.coordinates,
        targetZoom
      );
      suppressNextCameraMoveRef.current = true;
      setMapCenter(target.coordinates);
      setMapZoomLevel(targetZoom);
      setLiveViewportBounds(nextBounds);
      setClusterExpansionTarget({
        center: target.coordinates,
        zoom: targetZoom,
        bounds: nextBounds,
        seq: Date.now(),
        fitBounds: false,
      });
    }
  }, []);

  // Select Listing Handler (synchronizes selection + switches to map mode if needed + centers map + collapses mobile sheet to bar)
  const handleSelectListing = useCallback(
    (listingId: string) => {
      const target = listings.find(
        (l) => l && l.id === listingId && hasValidListingCoordinates(l)
      );
      if (!target) return;
      setDiscoveryMode('map');
      setSelectedListingId(listingId);
      setActiveClusterSummary(null);
      setMobileSheetState('collapsed');
      recordListingInteraction(listingId, 'viewsCount');
      handleCenterOnListing(target);
    },
    [recordListingInteraction, listings, handleCenterOnListing]
  );

  const handleClearSelection = useCallback(() => {
    setSelectedListingId(null);
    setIsExpandedDetailModalOpen(false);
  }, []);

  // Step 4D DEF-05: Handle target-aware "Locate on Map" requests from Workspaces, Saved, and Full Detail View
  useEffect(() => {
    if (!pendingMapFocusRequest) return;
    if (lastHandledFocusSeqRef.current === pendingMapFocusRequest.seq) {
      return;
    }
    lastHandledFocusSeqRef.current = pendingMapFocusRequest.seq;

    const target = listings.find(
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
    listings,
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

  // Map Click LatLng Handler for Drawing Tools (Part D)
  const handleMapClickLatLng = useCallback(
    (pt: LatLngPoint) => {
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
    [activeDrawTool, circleRadiusDraft, inProgressPoints, drawnShapes, setDrawnShapes]
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
    setSelectedPropertyType('all');
    setSelectedLocality('all');
    setMinRating(0);
    setVerifiedOnly(false);
    setPriceRangeFilter('all');
    setAvailableOnly(false);
    setHas360Only(false);
    setHasCatalogueOnly(false);
    setActiveSpatialFilterShapeId(null);
  };

  // Count of active non-default filters
  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (selectedCategory !== 'all') count++;
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
    const re = item.realEstateDetails;
    const showPlot = re
      ? shouldShowPlotAndBoundary(re.propertyType, re.hasAssociatedPlot)
      : false;
    const priceLabel = getListingPriceLabel(item);
    const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${item.coordinates.lat},${item.coordinates.lng}`;

    return (
      <div
        key={item.id}
        data-testid={`listing-card-${item.id}`}
        data-listing-id={item.id}
        data-selected={isSelected ? 'true' : 'false'}
        onMouseEnter={() => setHoveredListingId(item.id)}
        onMouseLeave={() => setHoveredListingId(null)}
        onClick={() => {
          handleSelectListing(item.id);
        }}
        className={`group w-full max-w-[440px] mx-auto rounded-2xl border bg-[var(--ps-surface)] transition-all cursor-pointer ${
          isMobileLandscape ? 'p-2.5 gap-2' : 'p-3 gap-2.5'
        } flex flex-col justify-between ${
          isSelected
            ? 'border-[var(--ps-accent)] ring-2 ring-[var(--ps-accent)]/40 shadow-md bg-[var(--ps-surface-alt)]/30'
            : isHovered
              ? 'border-[var(--ps-accent)] shadow-md bg-[var(--ps-surface-alt)]/40'
              : 'border-[var(--ps-border)] hover:border-[var(--ps-accent)]/60 shadow-2xs'
        }`}
      >
        <div className="flex items-stretch gap-2.5 sm:gap-3">
          {/* Aspect-locked Thumbnail with resilient category fallback */}
          <ListingThumbnail
            src={item.coverImage}
            alt={item.title}
            category={item.category}
            show360Badge={item.category === 'real_estate'}
            imgClassName="group-hover:scale-105 transition-transform duration-300"
            className={
              isMobileLandscape
                ? 'w-20 h-20'
                : isCompactGrid
                  ? 'w-[88px] h-[88px] sm:w-[92px] sm:h-[92px]'
                  : 'w-[88px] h-[88px] sm:w-[92px] sm:h-[92px]'
            }
          />

          {/* Card Content Hierarchy */}
          <div className="flex-1 min-w-0 flex flex-col justify-between">
            <div>
              {/* Row 1: Category Badge + Quick Action Controls */}
              <div className="flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-1 min-w-0">
                  <span className="text-[10px] font-bold uppercase tracking-wider px-1.5 py-0.5 rounded-md bg-[var(--ps-surface-alt)] text-[var(--ps-accent)] truncate">
                    {CATEGORY_LABELS[item.category]}
                  </span>
                  {searchScope === 'global' &&
                    !isPointInViewport(item.coordinates, liveViewportBounds) && (
                      <span
                        data-testid={`outside-viewport-badge-${item.id}`}
                        className="text-[9px] font-semibold px-1.5 py-0.5 rounded-md bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30 whitespace-nowrap shrink-0"
                      >
                        Outside Map View
                      </span>
                    )}
                </div>

                <div className="flex items-center shrink-0 -my-3 -mr-2">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleSelectListing(item.id);
                      handleCenterOnListing(item);
                    }}
                    aria-label={
                      context === 'list-grid'
                        ? `Show ${item.title} on map`
                        : `Center map on ${item.title}`
                    }
                    title={
                      context === 'list-grid' ? 'Show on Map' : 'Center on Map'
                    }
                    data-testid={`center-on-map-${item.id}`}
                    className="w-11 h-11 min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)]"
                  >
                    <span className="w-7 h-7 rounded-lg inline-flex items-center justify-center text-[var(--ps-text-muted)] hover:text-[var(--ps-accent)] hover:bg-[var(--ps-surface-alt)] transition-colors">
                      <Crosshair className="w-3.5 h-3.5" aria-hidden="true" />
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSavedListing(item.id);
                    }}
                    aria-label={
                      isSaved ? 'Remove from saved' : 'Save sample listing'
                    }
                    title={isSaved ? 'Remove from saved' : 'Save listing'}
                    data-testid={`save-listing-${item.id}`}
                    className="w-11 h-11 min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)]"
                  >
                    <span
                      className={`w-7 h-7 rounded-lg inline-flex items-center justify-center transition-colors ${
                        isSaved
                          ? 'text-[var(--ps-accent)] bg-[var(--ps-surface-alt)]'
                          : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                      }`}
                    >
                      <Bookmark
                        className={`w-3.5 h-3.5 ${isSaved ? 'fill-current' : ''}`}
                        aria-hidden="true"
                      />
                    </span>
                  </button>
                </div>
              </div>

              {/* Row 2: Primary Listing Title */}
              <h3
                data-testid={
                  isInlineHighlighted ? 'selected-listing-title' : undefined
                }
                className="text-[13px] sm:text-sm font-bold text-[var(--ps-text)] group-hover:text-[var(--ps-accent)] transition-colors leading-snug line-clamp-1 mt-1 pr-1"
              >
                {item.title}
              </h3>

              {/* Row 3: Locality & Rating */}
              <div className="flex items-center gap-1 text-[11px] text-[var(--ps-text-muted)] mt-0.5 min-w-0 leading-tight">
                <MapPin
                  className="w-3 h-3 shrink-0 text-[var(--ps-accent)]"
                  aria-hidden="true"
                />
                <span className="truncate">{item.locality}</span>
                <span
                  aria-hidden="true"
                  className="text-[var(--ps-border)] shrink-0"
                >
                  ·
                </span>
                <span className="inline-flex items-center gap-0.5 text-[11px] font-bold text-amber-500 tabular-nums shrink-0">
                  <Star className="w-3 h-3 fill-current" aria-hidden="true" />
                  <span>{item.rating}</span>
                </span>
              </div>
            </div>

            {/* Row 4: Supporting Price / Area / Catalogue / Availability Summary */}
            <div className="mt-1.5 pt-1.5 border-t border-[var(--ps-border)]/70 flex items-center justify-between gap-2 text-[11px] leading-tight">
              {priceLabel ? (
                <span className="font-bold text-[var(--ps-text)] tabular-nums truncate">
                  {priceLabel}
                </span>
              ) : (
                <span className="font-medium text-[var(--ps-text-muted)] truncate">
                  {item.subcategory}
                </span>
              )}

              {item.category === 'real_estate' && re && (
                <span className="text-[10px] font-medium text-[var(--ps-text-muted)] tabular-nums shrink-0">
                  {showPlot && re.plotAreaSqm
                    ? `Plot: ${formatArea(re.plotAreaSqm, areaUnit)}`
                    : re.builtUpAreaSqm
                      ? `Built: ${formatArea(re.builtUpAreaSqm, areaUnit)}`
                      : re.propertyType.replace(/_/g, ' ')}
                </span>
              )}

              {item.category === 'business' && item.businessDetails && (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-[var(--ps-text-muted)] shrink-0">
                  <Package
                    className="w-3 h-3 text-[var(--ps-accent)]"
                    aria-hidden="true"
                  />
                  <span>{item.businessDetails.catalogue.length} items</span>
                </span>
              )}

              {item.category === 'service' && item.serviceDetails && (
                <span className="text-[10px] font-medium text-[var(--ps-text-muted)] shrink-0 truncate max-w-[45%]">
                  {item.serviceDetails.availabilityStatus}
                </span>
              )}

              {item.category === 'sports' && item.sportsDetails && (
                <span className="text-[10px] font-medium text-[var(--ps-text-muted)] shrink-0 truncate max-w-[45%]">
                  {item.sportsDetails.sportActivity}
                </span>
              )}

              {item.category === 'public_place' && item.publicPlaceDetails && (
                <span className="text-[10px] font-medium text-[var(--ps-text-muted)] shrink-0 truncate max-w-[45%]">
                  {item.publicPlaceDetails.openingHours}
                </span>
              )}
            </div>
          </div>
        </div>

        {/* Inline Selected Listing Controls when highlighted in Split Sidebar or Expanded Mobile Sheet */}
        {isInlineHighlighted && (
          <div
            data-testid="selected-listing-card"
            data-listing-id={item.id}
            onClick={(e) => e.stopPropagation()}
            className="pt-2 mt-0.5 border-t border-[var(--ps-accent)]/30 flex flex-wrap items-center justify-between gap-1.5"
          >
            <button
              type="button"
              onClick={() => setIsExpandedDetailModalOpen(true)}
              data-testid="expand-details-btn"
              className="w-full xl:w-auto xl:flex-1 min-h-[44px] h-11 px-3 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-semibold hover:opacity-95 inline-flex items-center justify-center gap-1.5 shadow-2xs transition-opacity whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)]"
            >
              <Expand className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span className="truncate">Expand Details</span>
            </button>

            <div className="flex items-center justify-between xl:justify-end w-full xl:w-auto gap-1 shrink-0">
              <button
                type="button"
                onClick={() => handleCenterOnListing(item)}
                data-testid="center-on-map-btn"
                aria-label="Center map on selected listing"
                title="Center on Map"
                className="w-11 h-11 min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)]"
              >
                <span className="w-8 h-8 rounded-xl bg-[var(--ps-surface-alt)] border border-[var(--ps-border)] text-[var(--ps-text)] hover:border-[var(--ps-accent)] inline-flex items-center justify-center transition-colors">
                  <Crosshair
                    className="w-3.5 h-3.5 text-[var(--ps-accent)]"
                    aria-hidden="true"
                  />
                </span>
              </button>

              <button
                type="button"
                onClick={() => handleZoomToItem(item)}
                data-testid="zoom-to-item-btn"
                aria-label={
                  item.category === 'real_estate' &&
                  item.realEstateDetails?.boundaryPolygon &&
                  item.realEstateDetails.boundaryPolygon.length >= 3
                    ? 'Zoom to fit property boundary'
                    : 'Zoom in on listing location'
                }
                title={
                  item.category === 'real_estate' &&
                  item.realEstateDetails?.boundaryPolygon &&
                  item.realEstateDetails.boundaryPolygon.length >= 3
                    ? 'Zoom to fit boundary geometry'
                    : 'Zoom to listing location'
                }
                className="w-11 h-11 min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)]"
              >
                <span className="w-8 h-8 rounded-xl bg-[var(--ps-surface-alt)] border border-[var(--ps-border)] text-[var(--ps-text)] hover:border-[var(--ps-accent)] inline-flex items-center justify-center transition-colors">
                  <ZoomIn
                    className="w-3.5 h-3.5 text-[var(--ps-accent)]"
                    aria-hidden="true"
                  />
                </span>
              </button>

              <a
                href={directionsUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() =>
                  recordListingInteraction(item.id, 'directionClicksCount')
                }
                aria-label="Get directions"
                title="Get directions"
                data-testid="selected-card-directions-btn"
                className="w-11 h-11 min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)]"
              >
                <span className="w-8 h-8 rounded-xl bg-[var(--ps-surface-alt)] border border-[var(--ps-border)] text-[var(--ps-text)] hover:border-[var(--ps-accent)] inline-flex items-center justify-center transition-colors">
                  <Navigation
                    className="w-3.5 h-3.5 text-[var(--ps-accent)]"
                    aria-hidden="true"
                  />
                </span>
              </a>

              <button
                type="button"
                onClick={handleClearSelection}
                aria-label="Close selected listing"
                title="Close selected listing"
                data-testid="close-selected-listing-btn"
                className="w-11 h-11 min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)]"
              >
                <span className="w-8 h-8 rounded-xl bg-[var(--ps-surface-alt)] border border-[var(--ps-border)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:border-[var(--ps-accent)] inline-flex items-center justify-center transition-colors">
                  <X className="w-3.5 h-3.5" aria-hidden="true" />
                </span>
              </button>
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div
      data-layout-profile={activeLayoutProfile.profile}
      className={`flex-1 flex flex-col min-h-0 bg-[var(--ps-bg)] ${
        isFullscreenMap
          ? 'fixed inset-0 z-50 h-dvh w-screen overflow-hidden'
          : discoveryMode === 'map'
            ? 'h-full overflow-hidden'
            : ''
      }`}
    >
      {/* =====================================================================
          EXTERNAL DISCOVERY CONTROLS (OUTSIDE MAP VIEWPORT — COLLAPSIBLE)
          Hidden only during Full-Screen Map Mode
         ===================================================================== */}
      {!isFullscreenMap && (
        <div
          data-testid="external-discovery-controls"
          data-collapsed={isDiscoveryCollapsed ? 'true' : 'false'}
          className={`bg-[var(--ps-surface)] border-b border-[var(--ps-border)] ${
            isMobileLandscape
              ? 'px-2.5 py-1'
              : 'px-3 sm:px-4 py-1.5 sm:py-2'
          } shrink-0 z-30`}
        >
          <div className="max-w-[1600px] mx-auto">
            {isDiscoveryCollapsed ? (
              /* COLLAPSED DISCOVERY BAR: Maximum map viewport space while preserving active state & quick access */
              <div
                data-testid="collapsed-discovery-bar"
                className={`flex flex-nowrap items-center justify-between gap-2 min-w-0 ${
                  isMobileLandscape ? 'h-7.5' : 'h-9'
                }`}
              >
                {/* Compact Show Search & Filters Control */}
                <button
                  type="button"
                  onClick={() => updateDiscoveryCollapsed(false)}
                  aria-expanded={false}
                  aria-label="Show Search and Filters"
                  title="Expand search, categories, filters, and sort controls"
                  data-testid="toggle-discovery-controls-btn"
                  className={`${
                    isMobileLandscape ? 'h-7 px-2' : 'h-8 px-2.5 sm:px-3'
                  } rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-semibold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 shadow-2xs hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)]`}
                >
                  <Search className="w-3.5 h-3.5 shrink-0" />
                  <span>Show Search &amp; Filters</span>
                  <ChevronDown className="w-3.5 h-3.5 shrink-0" />
                </button>

                {/* Current Category / Search / Filter / Sort Indicators */}
                <div
                  data-testid="collapsed-active-indicators"
                  className="flex items-center gap-1.5 overflow-x-auto no-scrollbar min-w-0 flex-1 py-0.5"
                >
                  <button
                    type="button"
                    onClick={() => updateDiscoveryCollapsed(false)}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[var(--ps-bg)] border border-[var(--ps-border)] text-[11px] font-semibold text-[var(--ps-text)] whitespace-nowrap shrink-0 hover:bg-[var(--ps-surface-alt)]"
                  >
                    {selectedCategory !== 'all' && (
                      <CategoryMarkerIcon
                        category={selectedCategory}
                        className="w-3 h-3 text-[var(--ps-accent)]"
                      />
                    )}
                    <span>
                      {selectedCategory === 'all'
                        ? 'All Categories'
                        : CATEGORY_LABELS[selectedCategory]}
                    </span>
                  </button>

                  {searchQuery.trim() && (
                    <button
                      type="button"
                      onClick={() => updateDiscoveryCollapsed(false)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[var(--ps-surface-alt)] border border-[var(--ps-accent)]/40 text-[11px] font-semibold text-[var(--ps-text)] whitespace-nowrap shrink-0"
                    >
                      <span>&ldquo;{searchQuery.trim()}&rdquo;</span>
                    </button>
                  )}

                  {activeFilterCount > 0 && (
                    <button
                      type="button"
                      onClick={() => setIsFilterModalOpen(true)}
                      data-testid="collapsed-filter-indicator"
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-[10px] font-bold whitespace-nowrap shrink-0"
                    >
                      <Filter className="w-3 h-3" />
                      <span>
                        {activeFilterCount}{' '}
                        {activeFilterCount === 1 ? 'Filter' : 'Filters'}
                      </span>
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={() =>
                      handleSwitchSearchScope(
                        searchScope === 'map_area' ? 'global' : 'map_area'
                      )
                    }
                    data-testid="collapsed-scope-indicator"
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[var(--ps-bg)] border border-[var(--ps-border)] text-[11px] font-semibold text-[var(--ps-text)] whitespace-nowrap shrink-0 hover:bg-[var(--ps-surface-alt)]"
                  >
                    {searchScope === 'global' ? (
                      <Globe className="w-3 h-3 text-[var(--ps-accent)]" />
                    ) : (
                      <MapPin className="w-3 h-3 text-[var(--ps-accent)]" />
                    )}
                    <span>
                      {searchScope === 'global'
                        ? 'Entire Directory'
                        : 'Visible Map Area'}
                    </span>
                  </button>

                  {sortBy !== 'relevance' && (
                    <button
                      type="button"
                      onClick={() => updateDiscoveryCollapsed(false)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[var(--ps-bg)] border border-[var(--ps-border)] text-[11px] font-medium text-[var(--ps-text-muted)] whitespace-nowrap shrink-0"
                    >
                      <ArrowUpDown className="w-3 h-3 text-[var(--ps-accent)]" />
                      <span>{activeSortOption.shortLabel}</span>
                    </button>
                  )}

                  <span
                    data-testid="visible-results-count"
                    className="text-[11px] font-bold text-[var(--ps-text-muted)] tabular-nums whitespace-nowrap shrink-0 ml-auto pl-1"
                  >
                    {filteredListings.length}
                    <span className="hidden sm:inline"> Listings</span>
                  </span>
                </div>

                {/* Essential Mode & Split Panel Controls Accessible Even When Collapsed */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <div
                    className="inline-flex items-center h-8 p-0.5 rounded-xl bg-[var(--ps-bg)] border border-[var(--ps-border)] shrink-0"
                    role="group"
                    aria-label="Discovery view mode"
                  >
                    <button
                      type="button"
                      onClick={() => setDiscoveryMode('map')}
                      aria-pressed={discoveryMode === 'map'}
                      aria-label="Map View"
                      title="Map View"
                      data-testid="mode-map-btn"
                      className={`h-7 px-2 rounded-lg inline-flex items-center justify-center gap-1 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                        discoveryMode === 'map'
                          ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                          : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                      }`}
                    >
                      <MapIcon className="w-3.5 h-3.5 shrink-0" />
                      <span className="hidden min-[431px]:inline">Map</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setDiscoveryMode('list')}
                      aria-pressed={discoveryMode === 'list'}
                      aria-label="List View"
                      title="List View"
                      data-testid="mode-list-btn"
                      className={`h-7 px-2 rounded-lg inline-flex items-center justify-center gap-1 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 ${
                        discoveryMode === 'list'
                          ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                          : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                      }`}
                    >
                      <List className="w-3.5 h-3.5 shrink-0" />
                      <span className="hidden min-[431px]:inline">List</span>
                    </button>
                  </div>

                  {discoveryMode === 'map' && (
                    <button
                      type="button"
                      onClick={() =>
                        updateDesktopPanelOpen(!isDesktopPanelOpen)
                      }
                      aria-expanded={isDesktopPanelOpen}
                      aria-label={
                        isDesktopPanelOpen
                          ? 'Collapse contextual listing panel'
                          : 'Expand contextual listing panel'
                      }
                      title={
                        isDesktopPanelOpen
                          ? 'Collapse Results Panel'
                          : 'Expand Results Panel'
                      }
                      data-testid="desktop-panel-toggle-btn"
                      className={`${
                        isSplitScreen ? 'inline-flex' : 'hidden lg:inline-flex'
                      } items-center gap-1.5 h-8 px-2.5 rounded-xl bg-[var(--ps-bg)] border border-[var(--ps-border)] hover:bg-[var(--ps-surface-alt)] text-xs font-semibold text-[var(--ps-text)] whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)]`}
                    >
                      {isDesktopPanelOpen ? (
                        <PanelRightClose className="w-3.5 h-3.5 text-[var(--ps-accent)] shrink-0" />
                      ) : (
                        <PanelRightOpen className="w-3.5 h-3.5 text-[var(--ps-accent)] shrink-0" />
                      )}
                      <span>
                        {isDesktopPanelOpen ? 'Hide Panel' : 'Show Panel'}
                      </span>
                    </button>
                  )}
                </div>
              </div>
            ) : (
              /* EXPANDED DISCOVERY CONTROLS: Search + Scope Toggle + Categories + Single-Row Map/List/Filter/Sort Toolbar */
              <div className={isMobileLandscape ? 'space-y-1' : 'space-y-2'}>
                {/* SECTION 2: Search Input + Inline Search Scope Selector (Step 4B Requirement 5) */}
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-1.5 sm:gap-2">
                  <div
                    ref={searchContainerRef}
                    className="relative flex-1 min-w-0"
                  >
                    <Search className="w-4 h-4 text-[var(--ps-text-muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                    <input
                      type="text"
                      value={searchQuery}
                      onFocus={() => setIsSearchFocused(true)}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Escape') {
                          setIsSearchFocused(false);
                        } else if (e.key === 'Enter' && searchQuery.trim()) {
                          const trimmed = searchQuery.trim();
                          setRecentSearches((prev) => [
                            trimmed,
                            ...prev
                              .filter(
                                (item) =>
                                  item.toLowerCase() !== trimmed.toLowerCase()
                              )
                              .slice(0, 4),
                          ]);
                          setIsSearchFocused(false);
                        }
                      }}
                      placeholder={
                        searchScope === 'global'
                          ? 'Search entire Churachandpur directory by name, keyword, category, or locality...'
                          : 'Search within visible map area by name, keyword, category, or locality...'
                      }
                      aria-label="Search Churachandpur listings, keywords, categories, or localities"
                      data-testid="explore-search-input"
                      className={`w-full ${
                        isMobileLandscape ? 'h-7.5 text-xs' : 'h-9 text-xs sm:text-sm'
                      } pl-9 pr-8 rounded-xl bg-[var(--ps-bg)] border border-[var(--ps-border)] text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-ring)]`}
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery('')}
                        aria-label="Clear search query"
                        data-testid="explore-search-clear"
                        className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}

                    {/* Search Suggestions & Recent Searches Dropdown (PrintSwift Theme Tokens) */}
                    {isSearchFocused && (
                      <div
                        data-testid="search-suggestions-popover"
                        className="absolute left-0 right-0 top-full mt-1.5 max-h-60 overflow-y-auto rounded-2xl bg-[var(--ps-surface)] border border-[var(--ps-border)] shadow-2xl p-2.5 z-40 space-y-2 text-xs"
                      >
                        {searchSuggestions.length > 0 ? (
                          <div className="space-y-1">
                            <div className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                              Matching Sample Listings
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
                                className="w-full px-2.5 py-2 rounded-xl hover:bg-[var(--ps-surface-alt)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)] text-left flex items-center justify-between gap-2 transition-colors"
                              >
                                <div className="min-w-0">
                                  <div className="font-semibold text-[var(--ps-text)] truncate">
                                    {sug.title}
                                  </div>
                                  <div className="text-[10px] text-[var(--ps-text-muted)] truncate">
                                    {CATEGORY_LABELS[sug.category]} ·{' '}
                                    {sug.locality}
                                  </div>
                                </div>
                                <span className="text-[10px] font-bold text-amber-500 shrink-0 tabular-nums">
                                  ★ {sug.rating}
                                </span>
                              </button>
                            ))}
                          </div>
                        ) : null}

                        {/* Recent Searches */}
                        <div className="space-y-1">
                          <div className="px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                            Quick &amp; Recent Searches
                          </div>
                          <div className="flex flex-wrap gap-1.5 px-1">
                            {recentSearches.map((term) => (
                              <button
                                key={term}
                                type="button"
                                onClick={() => {
                                  setSearchQuery(term);
                                  setIsSearchFocused(false);
                                }}
                                className="px-2.5 py-1 rounded-lg bg-[var(--ps-bg)] border border-[var(--ps-border)] text-[11px] font-medium text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] hover:border-[var(--ps-accent)]/60 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)]"
                              >
                                {term}
                              </button>
                            ))}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* Step 4B Requirement 5: Inline Segmented Search Scope Selector */}
                  <div
                    role="group"
                    aria-label="Search scope selector"
                    data-testid="search-scope-selector"
                    data-active-scope={searchScope}
                    className={`inline-flex items-center ${
                      isMobileLandscape ? 'h-7.5' : 'h-9'
                    } p-0.5 rounded-xl bg-[var(--ps-bg)] border border-[var(--ps-border)] shrink-0 self-start sm:self-auto`}
                  >
                    <button
                      type="button"
                      onClick={() => handleSwitchSearchScope('map_area')}
                      aria-pressed={searchScope === 'map_area'}
                      data-testid="search-scope-map-area-btn"
                      className={`${
                        isMobileLandscape ? 'h-6.5 px-2 text-[11px]' : 'h-7 px-2.5 sm:px-3 text-xs'
                      } rounded-lg inline-flex items-center justify-center gap-1.5 font-semibold transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)] ${
                        searchScope === 'map_area'
                          ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-2xs'
                          : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                      }`}
                    >
                      <MapPin className="w-3.5 h-3.5 shrink-0" />
                      <span>Visible Map Area</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleSwitchSearchScope('global')}
                      aria-pressed={searchScope === 'global'}
                      data-testid="search-scope-global-btn"
                      className={`${
                        isMobileLandscape ? 'h-6.5 px-2 text-[11px]' : 'h-7 px-2.5 sm:px-3 text-xs'
                      } rounded-lg inline-flex items-center justify-center gap-1.5 font-semibold transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)] ${
                        searchScope === 'global'
                          ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-2xs'
                          : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                      }`}
                    >
                      <Globe className="w-3.5 h-3.5 shrink-0" />
                      <span>Entire Directory</span>
                    </button>
                  </div>
                </div>

                {/* SECTION 3: Horizontally Scrollable Category Chips (Outside Map) */}
                <div
                  role="tablist"
                  aria-label="Directory categories"
                  data-testid="category-chips-row"
                  className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5 whitespace-nowrap"
                >
                  {(
                    [
                      { id: 'all', label: 'All' },
                      { id: 'business', label: 'Businesses & Shops' },
                      { id: 'service', label: 'Services' },
                      { id: 'real_estate', label: 'Real Estate' },
                      { id: 'sports', label: 'Sports & Recreation' },
                      {
                        id: 'public_place',
                        label: 'Public & Community Places',
                      },
                    ] as const
                  ).map((cat) => {
                    const isActive = selectedCategory === cat.id;
                    return (
                      <button
                        key={cat.id}
                        type="button"
                        role="tab"
                        aria-selected={isActive}
                        data-testid={`category-chip-${cat.id}`}
                        onClick={() => {
                          setSelectedCategory(cat.id);
                          if (cat.id !== 'real_estate' && cat.id !== 'all') {
                            setSelectedPropertyType('all');
                          }
                        }}
                        className={`inline-flex items-center gap-1.5 ${
                          isMobileLandscape
                            ? 'px-2.5 py-1 text-[11px]'
                            : 'px-3 py-1.5 text-xs'
                        } rounded-xl font-semibold transition-colors shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)] ${
                          isActive
                            ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-2xs'
                            : 'bg-[var(--ps-bg)] text-[var(--ps-text-muted)] border border-[var(--ps-border)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                        }`}
                      >
                        {cat.id !== 'all' && (
                          <CategoryMarkerIcon
                            category={cat.id}
                            className="w-3.5 h-3.5"
                          />
                        )}
                        <span>{cat.label}</span>
                      </button>
                    );
                  })}
                </div>

                {/* SECTION 4: Single-Row Horizontal Toolbar (Map/List Segmented, Filters, Sort Popover, Results & Collapse) */}
                <div
                  ref={sortContainerRef}
                  data-testid="discovery-controls-bar"
                  className="relative flex flex-nowrap items-center justify-between gap-1.5 pt-0.5 min-w-0"
                >
                  {/* Four Primary Discovery Controls in One Horizontal Row */}
                  <div className="flex flex-nowrap items-center gap-1.5 min-w-0 shrink-0">
                    {/* 1 & 2. Map / List Segmented Control */}
                    <div
                      className={`inline-flex items-center ${
                        isMobileLandscape ? 'h-7.5' : 'h-9'
                      } p-0.5 rounded-xl bg-[var(--ps-bg)] border border-[var(--ps-border)] shrink-0`}
                      role="group"
                      aria-label="Discovery view mode"
                    >
                      <button
                        type="button"
                        onClick={() => setDiscoveryMode('map')}
                        aria-pressed={discoveryMode === 'map'}
                        aria-label="Map View"
                        title="Map View"
                        data-testid="mode-map-btn"
                        className={`${
                          isMobileLandscape ? 'h-6.5 px-2' : 'h-7 px-2.5 min-[431px]:px-3'
                        } rounded-lg inline-flex items-center justify-center gap-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)] ${
                          discoveryMode === 'map'
                            ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-2xs'
                            : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                        }`}
                      >
                        <MapIcon className="w-3.5 h-3.5 shrink-0" />
                        <span className="hidden min-[431px]:inline">Map</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setDiscoveryMode('list')}
                        aria-pressed={discoveryMode === 'list'}
                        aria-label="List View"
                        title="List View"
                        data-testid="mode-list-btn"
                        className={`${
                          isMobileLandscape ? 'h-6.5 px-2' : 'h-7 px-2.5 min-[431px]:px-3'
                        } rounded-lg inline-flex items-center justify-center gap-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)] ${
                          discoveryMode === 'list'
                            ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-2xs'
                            : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                        }`}
                      >
                        <List className="w-3.5 h-3.5 shrink-0" />
                        <span className="hidden min-[431px]:inline">List</span>
                      </button>
                    </div>

                    {/* 3. Filters Button with Active Filter Count Badge */}
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
                      title={
                        activeFilterCount > 0
                          ? `Filters (${activeFilterCount} active)`
                          : 'Open Discovery Filters'
                      }
                      data-testid="open-filter-modal-btn"
                      className={`${
                        isMobileLandscape ? 'h-7.5 px-2.5' : 'h-9 px-2.5 min-[431px]:px-3'
                      } rounded-xl border inline-flex items-center justify-center gap-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)] ${
                        activeFilterCount > 0
                          ? 'bg-[var(--ps-surface-alt)] border-[var(--ps-accent)] text-[var(--ps-text)]'
                          : 'bg-[var(--ps-bg)] border-[var(--ps-border)] text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                      }`}
                    >
                      <Filter className="w-3.5 h-3.5 text-[var(--ps-accent)] shrink-0" />
                      <span className="hidden min-[431px]:inline">Filters</span>
                      {activeFilterCount > 0 && (
                        <span
                          data-testid="active-filter-badge"
                          className="min-w-[18px] h-[18px] px-1 rounded-full bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-[10px] font-bold inline-flex items-center justify-center tabular-nums"
                        >
                          {activeFilterCount}
                        </span>
                      )}
                    </button>

                    {/* 4. Sort Popover Trigger Button */}
                    <button
                      type="button"
                      onClick={() => setIsSortPopoverOpen((prev) => !prev)}
                      aria-haspopup="listbox"
                      aria-expanded={isSortPopoverOpen}
                      aria-label={`Sort discovery results (currently ${activeSortOption.label})`}
                      title={`Sort: ${activeSortOption.label}`}
                      data-testid="explore-sort-trigger"
                      className={`relative ${
                        isMobileLandscape ? 'h-7.5 px-2.5' : 'h-9 px-2.5 min-[431px]:px-3'
                      } rounded-xl border inline-flex items-center justify-center gap-1.5 text-xs font-semibold transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)] ${
                        isSortPopoverOpen || sortBy !== 'relevance'
                          ? 'bg-[var(--ps-surface-alt)] border-[var(--ps-accent)] text-[var(--ps-text)]'
                          : 'bg-[var(--ps-bg)] border-[var(--ps-border)] text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                      }`}
                    >
                      <ArrowUpDown className="w-3.5 h-3.5 text-[var(--ps-accent)] shrink-0" />
                      <span className="hidden min-[431px]:inline">
                        Sort: {activeSortOption.shortLabel}
                      </span>
                      <ChevronDown
                        className={`hidden min-[431px]:inline w-3.5 h-3.5 text-[var(--ps-text-muted)] transition-transform shrink-0 ${
                          isSortPopoverOpen ? 'rotate-180' : ''
                        }`}
                      />
                      {sortBy !== 'relevance' && (
                        <span className="min-[431px]:hidden w-1.5 h-1.5 rounded-full bg-[var(--ps-accent)] absolute top-1.5 right-1.5" />
                      )}
                    </button>
                  </div>

                  {/* Right Side: Results Count + Split Contextual Panel Toggle + Collapse Discovery Bar */}
                  <div className="flex flex-nowrap items-center gap-1.5 shrink-0">
                    <span
                      data-testid="visible-results-count"
                      className="text-[11px] sm:text-xs font-bold text-[var(--ps-text-muted)] tabular-nums whitespace-nowrap shrink-0"
                    >
                      {filteredListings.length}
                      <span className="hidden min-[380px]:inline">
                        {' '}
                        Listings
                      </span>
                    </span>

                    {discoveryMode === 'map' && (
                      <button
                        type="button"
                        onClick={() =>
                          updateDesktopPanelOpen(!isDesktopPanelOpen)
                        }
                        aria-expanded={isDesktopPanelOpen}
                        aria-label={
                          isDesktopPanelOpen
                            ? 'Collapse contextual listing panel'
                            : 'Expand contextual listing panel'
                        }
                        title={
                          isDesktopPanelOpen
                            ? 'Collapse contextual listing panel'
                            : 'Expand contextual listing panel'
                        }
                        data-testid="desktop-panel-toggle-btn"
                        className={`${
                          isSplitScreen ? 'inline-flex' : 'hidden lg:inline-flex'
                        } items-center gap-1.5 ${
                          isMobileLandscape ? 'h-7.5 px-2.5' : 'h-9 px-3'
                        } rounded-xl border text-xs font-semibold transition-colors whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)] ${
                          isDesktopPanelOpen
                            ? 'bg-[var(--ps-bg)] border-[var(--ps-border)] text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                            : 'bg-[var(--ps-surface-alt)] border-[var(--ps-accent)] text-[var(--ps-text)]'
                        }`}
                      >
                        {isDesktopPanelOpen ? (
                          <PanelRightClose className="w-3.5 h-3.5 text-[var(--ps-accent)] shrink-0" />
                        ) : (
                          <PanelRightOpen className="w-3.5 h-3.5 text-[var(--ps-accent)] shrink-0" />
                        )}
                        <span>
                          {isDesktopPanelOpen ? 'Hide Panel' : 'Show Panel'}
                        </span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => updateDiscoveryCollapsed(true)}
                      aria-expanded={true}
                      aria-label="Collapse search and filter controls"
                      title="Collapse search & filters to maximise map space"
                      data-testid="toggle-discovery-controls-btn"
                      className={`${
                        isMobileLandscape ? 'h-7.5 px-2' : 'h-9 px-2.5'
                      } rounded-xl bg-[var(--ps-bg)] border border-[var(--ps-border)] hover:bg-[var(--ps-surface-alt)] text-xs font-semibold text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] inline-flex items-center justify-center gap-1 whitespace-nowrap shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)]`}
                    >
                      <ChevronUp className="w-3.5 h-3.5 shrink-0" />
                      <span className="hidden md:inline">Collapse</span>
                    </button>
                  </div>

                  {/* Custom Theme-Token Sort Popover Menu (Never overflows screen) */}
                  {isSortPopoverOpen && (
                    <div
                      role="listbox"
                      aria-label="Sort discovery results"
                      data-testid="explore-sort-popover"
                      className="absolute left-0 sm:left-36 top-full mt-1.5 w-64 max-w-[calc(100vw-24px)] rounded-2xl bg-[var(--ps-surface)] border border-[var(--ps-border)] shadow-2xl p-1.5 z-40 space-y-0.5 text-xs"
                    >
                      <div className="px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                        Sort Directory Listings
                      </div>
                      {SORT_OPTIONS.map((option) => {
                        const isSelected = sortBy === option.id;
                        return (
                          <button
                            key={option.id}
                            type="button"
                            role="option"
                            aria-selected={isSelected}
                            data-testid={`sort-option-${option.id}`}
                            onClick={() => {
                              setSortBy(option.id);
                              setIsSortPopoverOpen(false);
                            }}
                            className={`w-full px-3 py-2 rounded-xl text-left transition-colors flex items-center justify-between gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)] ${
                              isSelected
                                ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                                : 'text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                            }`}
                          >
                            <div className="min-w-0">
                              <div className="font-semibold truncate">
                                {option.label}
                              </div>
                              <div
                                className={`text-[10px] truncate ${
                                  isSelected
                                    ? 'opacity-85'
                                    : 'text-[var(--ps-text-muted)]'
                                }`}
                              >
                                {option.description}
                              </div>
                            </div>
                            {isSelected && (
                              <Check className="w-3.5 h-3.5 shrink-0" />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>

                {/* Single-Line Horizontally Scrollable Active Filter Chips (Only rendered when filters are active) */}
                {(selectedLocality !== 'all' ||
                  selectedPropertyType !== 'all' ||
                  minRating > 0 ||
                  priceRangeFilter !== 'all' ||
                  verifiedOnly ||
                  has360Only ||
                  hasCatalogueOnly ||
                  activeFilterShape) && (
                  <div
                    data-testid="active-filter-chips-row"
                    className="flex flex-nowrap items-center gap-1.5 overflow-x-auto no-scrollbar pt-0.5"
                  >
                    {selectedLocality !== 'all' && (
                      <button
                        type="button"
                        onClick={() => setSelectedLocality('all')}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[var(--ps-surface-alt)] text-[11px] font-semibold text-[var(--ps-text)] border border-[var(--ps-border)] whitespace-nowrap shrink-0"
                      >
                        <span>{selectedLocality}</span>
                        <X className="w-3 h-3" />
                      </button>
                    )}
                    {selectedPropertyType !== 'all' && (
                      <button
                        type="button"
                        onClick={() => setSelectedPropertyType('all')}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[var(--ps-surface-alt)] text-[11px] font-semibold text-[var(--ps-text)] border border-[var(--ps-border)] whitespace-nowrap shrink-0"
                      >
                        <span>
                          {PROPERTY_TYPE_LABELS[selectedPropertyType]}
                        </span>
                        <X className="w-3 h-3" />
                      </button>
                    )}
                    {minRating > 0 && (
                      <button
                        type="button"
                        onClick={() => setMinRating(0)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[var(--ps-surface-alt)] text-[11px] font-semibold text-[var(--ps-text)] border border-[var(--ps-border)] whitespace-nowrap shrink-0"
                      >
                        <span>{minRating}+ ★</span>
                        <X className="w-3 h-3" />
                      </button>
                    )}
                    {priceRangeFilter !== 'all' && (
                      <button
                        type="button"
                        onClick={() => setPriceRangeFilter('all')}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[var(--ps-surface-alt)] text-[11px] font-semibold text-[var(--ps-text)] border border-[var(--ps-border)] whitespace-nowrap shrink-0"
                      >
                        <span>{PRICE_RANGE_LABELS[priceRangeFilter]}</span>
                        <X className="w-3 h-3" />
                      </button>
                    )}
                    {verifiedOnly && (
                      <button
                        type="button"
                        onClick={() => setVerifiedOnly(false)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[var(--ps-surface-alt)] text-[11px] font-semibold text-[var(--ps-text)] border border-[var(--ps-border)] whitespace-nowrap shrink-0"
                      >
                        <span>Verified Demo</span>
                        <X className="w-3 h-3" />
                      </button>
                    )}
                    {has360Only && (
                      <button
                        type="button"
                        onClick={() => setHas360Only(false)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[var(--ps-surface-alt)] text-[11px] font-semibold text-[var(--ps-text)] border border-[var(--ps-border)] whitespace-nowrap shrink-0"
                      >
                        <span>360° Tour</span>
                        <X className="w-3 h-3" />
                      </button>
                    )}
                    {hasCatalogueOnly && (
                      <button
                        type="button"
                        onClick={() => setHasCatalogueOnly(false)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-[var(--ps-surface-alt)] text-[11px] font-semibold text-[var(--ps-text)] border border-[var(--ps-border)] whitespace-nowrap shrink-0"
                      >
                        <span>Catalogue</span>
                        <X className="w-3 h-3" />
                      </button>
                    )}
                    {activeFilterShape && (
                      <button
                        type="button"
                        onClick={() => setActiveSpatialFilterShapeId(null)}
                        className="inline-flex items-center gap-1 px-2 py-1 rounded-lg bg-emerald-600 text-white text-[11px] font-semibold whitespace-nowrap shrink-0"
                      >
                        <span>Inside {activeFilterShape.label}</span>
                        <X className="w-3 h-3" />
                      </button>
                    )}
                    {activeFilterCount > 0 && (
                      <button
                        type="button"
                        onClick={resetAllFilters}
                        className="text-[11px] font-semibold text-rose-600 hover:underline px-1.5 whitespace-nowrap shrink-0"
                      >
                        Reset all
                      </button>
                    )}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* =====================================================================
          SECTION 5: MAIN DISCOVERY WORKSPACE (MAP MODE OR LIST MODE)
         ===================================================================== */}
      {discoveryMode === 'list' && !isFullscreenMap ? (
        /* LIST MODE: Full listing results as main content, map completely hidden */
        <div
          ref={listModeContainerRef}
          onScroll={(e) => {
            if (e.currentTarget.clientHeight > 0) {
              listModeScrollTopRef.current = e.currentTarget.scrollTop;
            }
          }}
          data-testid="explore-list-mode-container"
          className={`flex-1 overflow-y-auto px-3 sm:px-6 py-4 ${
            activeLayoutProfile.useBottomNav ? 'pb-20' : 'pb-6'
          } max-w-[1600px] w-full mx-auto`}
        >
          <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-[var(--ps-text)]">
                  Churachandpur Directory Results ({filteredListings.length})
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
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-semibold shadow-xs"
            >
              <MapIcon className="w-3.5 h-3.5" />
              <span>Switch to Map View</span>
            </button>
          </div>

          {filteredListings.length === 0 ? (
            <div
              data-testid="empty-results-state"
              className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-10 text-center space-y-3"
            >
              <p className="text-sm font-bold text-[var(--ps-text)]">
                {searchScope === 'map_area'
                  ? 'No sample listings match within the current visible map area.'
                  : 'No sample listings match your current search or filters.'}
              </p>
              <p className="text-xs text-[var(--ps-text-muted)]">
                {searchScope === 'map_area'
                  ? 'Search across the entire Churachandpur directory or clear active filters.'
                  : 'Try clearing one or more active filters or searching a broader Churachandpur locality.'}
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                {searchScope === 'map_area' && (
                  <button
                    type="button"
                    onClick={() => handleSwitchSearchScope('global')}
                    data-testid="empty-state-search-global-btn"
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-semibold"
                  >
                    <Globe className="w-3.5 h-3.5" />
                    <span>Search Entire Directory</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={resetAllFilters}
                  data-testid="empty-state-reset-filters-btn"
                  className="px-4 py-2 rounded-xl bg-[var(--ps-surface-alt)] border border-[var(--ps-border)] text-[var(--ps-text)] text-xs font-semibold"
                >
                  Reset All Filters
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3.5 items-start">
              {filteredListings.map((item) =>
                renderListingResultCard(item, true, 'list-grid')
              )}
            </div>
          )}
        </div>
      ) : (
        /* MAP MODE: Adaptive Split-Screen (Mobile Landscape, Tablet Landscape, Desktop) or Portrait Bottom Sheet (Mobile Portrait, Tablet Portrait) */
        <div
          ref={splitContainerRef}
          data-testid="explore-split-container"
          data-split-mode={isSplitScreen ? 'split' : 'sheet'}
          className={`flex-1 flex ${
            isSplitScreen ? 'flex-row' : 'flex-col lg:flex-row'
          } relative overflow-hidden min-h-0 ${
            isFullscreenMap ? 'h-dvh' : 'h-full'
          }`}
        >
          {/* MAP VIEWPORT CONTAINER */}
          <div
            ref={mapViewportRef}
            data-testid="explore-map-viewport"
            data-map-center={`${mapCenter.lat.toFixed(5)},${mapCenter.lng.toFixed(5)}`}
            data-selected-listing-id={selectedListingId || ''}
            className="relative flex-1 min-w-0 w-full h-full overflow-hidden"
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

            {/* Step 4B Requirement 2: "Search This Area" Floating Button when camera pans/zooms */}
            {hasCameraMoved && (
              <div className="absolute top-3 left-1/2 -translate-x-1/2 z-20 pointer-events-auto">
                <button
                  type="button"
                  onClick={handleSearchThisArea}
                  data-testid="search-this-area-btn"
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-[var(--ps-surface)]/95 backdrop-blur-md border border-[var(--ps-accent)] text-xs font-bold text-[var(--ps-text)] shadow-xl hover:bg-[var(--ps-surface-alt)] transition-colors"
                >
                  <Sparkles className="w-3.5 h-3.5 text-[var(--ps-accent)]" />
                  <span>Search This Area ({liveAreaMatchCount})</span>
                </button>
              </div>
            )}

            {/* Step 4F-B: Geolocation Status Notification Banner */}
            {locationStatus && (
              <div
                data-testid="location-status-banner"
                role="status"
                aria-live="polite"
                className={`absolute ${
                  hasCameraMoved ? 'top-14' : 'top-3'
                } left-1/2 -translate-x-1/2 z-20 pointer-events-auto max-w-[calc(100vw-32px)] sm:max-w-md w-max px-3.5 py-2 rounded-xl text-xs shadow-xl backdrop-blur-md flex items-center gap-2.5 transition-all ${
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
                  className="p-1 -mr-1 rounded-lg hover:bg-white/10 text-white/70 hover:text-white shrink-0 min-h-[32px] min-w-[32px] flex items-center justify-center"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
            )}

            {/* PART C: Floating Map Toolbar (Positioned inside map viewport) */}
            <FloatingMapToolbar
              mapViewportRef={mapViewportRef}
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
              onPositionChange={setMapToolbarPosition}
            />

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
                mapViewportRef={mapViewportRef}
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
                          className="p-1 rounded-lg text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]"
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
                        className="w-full py-2 px-3 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-bold hover:opacity-95 flex items-center justify-center gap-1.5"
                      >
                        <ZoomIn className="w-3.5 h-3.5" />
                        <span>Zoom into cluster</span>
                      </button>
                    </>
                  );
                })()}
              </div>
            )}

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
                clickableIcons={false}
                keyboardShortcuts={true}
                controlSize={28}
                internalUsageAttributionIds={[
                  'gmp_mcp_codeassist_v1_aistudio',
                  'gmp_git_agentskills_v1',
                ]}
                onClick={(e) => {
                  if (activeDrawTool !== 'none' && e.detail.latLng) {
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
                />

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

                {/* Cluster Markers */}
                {clusters.map((cluster) => (
                  <AdvancedMarker
                    key={cluster.id}
                    position={cluster.center}
                    zIndex={500}
                    onClick={() => handleClusterActivate(cluster)}
                  >
                    <button
                      type="button"
                      onMouseEnter={() => {
                        if (
                          typeof window !== 'undefined' &&
                          window.innerWidth >= 1024
                        ) {
                          setActiveClusterSummary(cluster);
                        }
                      }}
                      onFocus={() => setActiveClusterSummary(cluster)}
                      aria-label={`Cluster of ${cluster.items.length} listings`}
                      data-cluster-pin="true"
                      className="w-10 h-10 rounded-full bg-slate-900 text-white border-2 border-white shadow-xl flex items-center justify-center text-xs font-extrabold hover:scale-110 transition-transform"
                    >
                      {cluster.items.length}
                    </button>
                  </AdvancedMarker>
                ))}

                {/* Individual Listing Markers */}
                {unclusteredListings.map((item) => {
                  const isSelected = item.id === selectedListingId;
                  const isHovered = item.id === hoveredListingId;
                  const colors = CATEGORY_COLORS[item.category];
                  return (
                    <AdvancedMarker
                      key={item.id}
                      position={item.coordinates}
                      onClick={() => handleSelectListing(item.id)}
                      zIndex={isSelected ? 1000 : isHovered ? 800 : 200}
                    >
                      <div
                        onClick={() => handleSelectListing(item.id)}
                        onMouseEnter={() => setHoveredListingId(item.id)}
                        onMouseLeave={() => setHoveredListingId(null)}
                        data-map-pin="true"
                        data-listing-id={item.id}
                        data-selected={isSelected ? 'true' : 'false'}
                        data-hovered={isHovered ? 'true' : 'false'}
                        style={{
                          backgroundColor: isSelected
                            ? '#f59e0b'
                            : isHovered
                              ? '#0f172a'
                              : colors.bg,
                          borderColor: isSelected ? '#0f172a' : '#ffffff',
                          color: isSelected ? '#0f172a' : '#ffffff',
                        }}
                        className={`flex items-center justify-center rounded-full border-2 shadow-lg transition-transform cursor-pointer ${
                          isSelected
                            ? 'w-11 h-11 scale-125 ring-4 ring-amber-400/60'
                            : isHovered
                              ? 'w-9 h-9 scale-120 ring-2 ring-white'
                              : 'w-8 h-8 hover:scale-110'
                        }`}
                        title={`${item.title} (${CATEGORY_LABELS[item.category]})`}
                      >
                        <CategoryMarkerIcon
                          category={item.category}
                          className={
                            isSelected ? 'w-5 h-5 stroke-[2.5]' : 'w-4 h-4'
                          }
                        />
                      </div>
                    </AdvancedMarker>
                  );
                })}
              </GoogleMap>
            ) : (
              <InteractiveVectorMap
                listings={unclusteredListings}
                clusters={clusters}
                selectedListing={selectedListing}
                hoveredListingId={hoveredListingId}
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
                    onClearSelection={handleClearSelection}
                    onCenterOnMap={() => handleCenterOnListing(selectedListing)}
                    onZoomToItem={() => handleZoomToItem(selectedListing)}
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
                (Rendered in portrait modes; uses 2-column compact card grid on Tablet Portrait)
               =============================================================== */}
            {!isFullscreenMap && !isSplitScreen && (
              <div
                data-testid="mobile-listing-bottom-sheet"
                data-sheet-state={mobileSheetState}
                className={`absolute left-0 right-0 bottom-0 rounded-t-3xl bg-[var(--ps-surface)]/98 backdrop-blur-md border-t border-[var(--ps-border)] shadow-2xl flex flex-col transition-all duration-200 pointer-events-auto ${
                  mobileSheetState === 'collapsed'
                    ? 'h-[82px] z-20'
                    : mobileSheetState === 'partial'
                      ? isTabletPortrait
                        ? 'h-[42%] max-h-[420px] min-h-[230px] z-40'
                        : 'h-[40%] max-h-[320px] min-h-[200px] z-40'
                      : 'h-[78%] z-40'
                }`}
              >
                {/* Sheet Drag Handle & Header */}
                <div
                  onPointerDown={handleSheetPointerDown}
                  onPointerUp={handleSheetPointerUp}
                  data-testid="mobile-sheet-handle"
                  className="px-4 pt-1.5 pb-1.5 border-b border-[var(--ps-border)]/70 cursor-grab active:cursor-grabbing select-none shrink-0"
                >
                  <div className="w-10 h-1.5 rounded-full bg-[var(--ps-border)] mx-auto mb-1.5" />
                  <div className="flex items-center justify-between gap-2">
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

                    {/* Single Coherent Adaptive 3-State Panel-Size Control (Compact Icon-Only with 44x44px Touch Targets) */}
                    <div
                      role="group"
                      aria-label="Results panel size"
                      data-testid="mobile-sheet-size-control"
                      onClick={(e) => e.stopPropagation()}
                      onPointerDown={(e) => e.stopPropagation()}
                      className="inline-flex items-center -my-1.5 -mr-1 p-0.5 rounded-xl bg-[var(--ps-bg)] border border-[var(--ps-border)] shrink-0"
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
                        className="w-11 h-11 min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)]"
                      >
                        <span
                          className={`w-7 h-7 rounded-lg inline-flex items-center justify-center transition-colors ${
                            mobileSheetState === 'collapsed'
                              ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-2xs'
                              : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                          }`}
                        >
                          <ChevronDown className="w-3.5 h-3.5 shrink-0" />
                        </span>
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
                        className="w-11 h-11 min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)]"
                      >
                        <span
                          className={`w-7 h-7 rounded-lg inline-flex items-center justify-center transition-colors ${
                            mobileSheetState === 'partial'
                              ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-2xs'
                              : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                          }`}
                        >
                          <Minus className="w-3.5 h-3.5 shrink-0" />
                        </span>
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
                        className="w-11 h-11 min-w-[44px] min-h-[44px] inline-flex items-center justify-center rounded-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)]"
                      >
                        <span
                          className={`w-7 h-7 rounded-lg inline-flex items-center justify-center transition-colors ${
                            mobileSheetState === 'expanded'
                              ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-2xs'
                              : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                          }`}
                        >
                          <ChevronUp className="w-3.5 h-3.5 shrink-0" />
                        </span>
                      </button>
                    </div>
                  </div>

                  {/* Collapsed Preview Line */}
                  {mobileSheetState === 'collapsed' &&
                    (selectedListing || filteredListings[0]) && (
                      <div className="text-[11px] text-[var(--ps-text-muted)] truncate mt-0.5">
                        {selectedListing ? 'Selected: ' : 'Top match: '}
                        <strong className="text-[var(--ps-text)]">
                          {(selectedListing || filteredListings[0]).title}
                        </strong>{' '}
                        ({(selectedListing || filteredListings[0]).locality})
                      </div>
                    )}
                </div>

                {/* Scrollable Listing Cards inside Partial / Expanded Sheet (2-column compact grid on Tablet Portrait) */}
                {mobileSheetState !== 'collapsed' && (
                  <div
                    ref={mobileSheetListRef}
                    onScroll={(e) => {
                      if (
                        isActiveView &&
                        !isExpandedDetailModalOpen &&
                        e.currentTarget.clientHeight > 0
                      ) {
                        mobileSheetScrollTopRef.current =
                          e.currentTarget.scrollTop;
                      }
                    }}
                    data-testid="mobile-sheet-results-list"
                    className="flex-1 overflow-y-auto p-3 grid grid-cols-1 md:grid-cols-2 gap-2.5 content-start items-start"
                  >
                    {selectedListing &&
                      !filteredListings.some(
                        (l) => l.id === selectedListing.id
                      ) &&
                      renderListingResultCard(
                        selectedListing,
                        false,
                        'mobile-sheet'
                      )}
                    {filteredListings.length === 0 ? (
                      <div
                        data-testid="empty-results-state"
                        className="col-span-full p-6 text-center space-y-2.5"
                      >
                        <p className="text-xs font-bold text-[var(--ps-text)]">
                          {searchScope === 'map_area'
                            ? 'No listings match in the visible map area.'
                            : 'No listings match your search or filters.'}
                        </p>
                        <div className="flex flex-wrap items-center justify-center gap-2">
                          {searchScope === 'map_area' && (
                            <button
                              type="button"
                              onClick={() => handleSwitchSearchScope('global')}
                              data-testid="empty-state-search-global-btn"
                              className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-semibold"
                            >
                              <Globe className="w-3 h-3" />
                              <span>Search Entire Directory</span>
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={resetAllFilters}
                            data-testid="empty-state-reset-filters-btn"
                            className="px-3 py-1.5 rounded-lg bg-[var(--ps-surface-alt)] border border-[var(--ps-border)] text-[var(--ps-text)] text-xs font-semibold"
                          >
                            Reset Filters
                          </button>
                        </div>
                      </div>
                    ) : (
                      filteredListings.map((item) =>
                        renderListingResultCard(item, false, 'mobile-sheet')
                      )
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Split-Screen Floating Re-Expand Edge Handle when Contextual Panel is Collapsed */}
            {!isFullscreenMap && isSplitScreen && !isDesktopPanelOpen && (
              <button
                type="button"
                onClick={() => updateDesktopPanelOpen(true)}
                aria-label="Expand contextual listing panel"
                title="Expand Contextual Listing Panel"
                data-testid="desktop-sidebar-expand-edge-btn"
                className="inline-flex items-center gap-1.5 absolute bottom-6 right-3 z-20 px-3.5 py-2 rounded-2xl bg-[var(--ps-surface)]/95 backdrop-blur-md border border-[var(--ps-border)] shadow-xl text-xs font-bold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)]"
              >
                <PanelRightOpen className="w-4 h-4 text-[var(--ps-accent)]" />
                <span>Expand Panel ({filteredListings.length})</span>
              </button>
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
              className={`w-2.5 shrink-0 bg-[var(--ps-surface-alt)] hover:bg-[var(--ps-accent)]/20 border-l border-[var(--ps-border)] cursor-col-resize flex flex-col items-center justify-center z-20 transition-colors select-none touch-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)] ${
                isResizingSplit ? 'bg-[var(--ps-accent)]/30' : ''
              }`}
            >
              <GripVertical className="w-3 h-3 text-[var(--ps-text-muted)]" />
            </div>
          )}

          {/* =================================================================
              ADAPTIVE SPLIT-SCREEN CONTEXTUAL LISTING PANEL
              (Active in Mobile Landscape 60/40, Tablet Landscape 65/35, and Desktop)
              Reuses the single listing panel without duplicating listing components
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
              className="flex h-full border-l border-[var(--ps-border)] bg-[var(--ps-surface)] flex-col overflow-hidden shrink-0"
            >
              <div className="flex flex-col h-full">
                <div
                  className={`${
                    isMobileLandscape ? 'px-2.5 py-1.5' : 'px-4 py-3'
                  } border-b border-[var(--ps-border)] bg-[var(--ps-surface-alt)] flex items-center justify-between gap-2 shrink-0`}
                >
                  <div className="min-w-0">
                    <h2 className="text-[11px] sm:text-xs font-bold text-[var(--ps-text)] uppercase tracking-wider truncate">
                      {searchScope === 'global'
                        ? `Entire Directory (${filteredListings.length})`
                        : `Visible Map Area (${filteredListings.length})`}
                    </h2>
                    {!isMobileLandscape && (
                      <p className="text-[11px] text-[var(--ps-text-muted)] truncate">
                        {selectedListing
                          ? `Selected: ${selectedListing.title}`
                          : searchScope === 'global'
                            ? 'Searching across all Churachandpur listings'
                            : 'Showing listings inside current map bounds'}
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
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
                      className={`inline-flex items-center gap-1 ${
                        isMobileLandscape
                          ? 'px-2 py-0.5 text-[10px]'
                          : 'px-2.5 py-1 text-[11px]'
                      } rounded-lg font-semibold border transition-colors ${
                        searchScope === 'global'
                          ? 'bg-sky-600 text-white border-sky-600'
                          : 'bg-emerald-600 text-white border-emerald-600'
                      }`}
                    >
                      {searchScope === 'global' ? (
                        <Globe className="w-3 h-3" />
                      ) : (
                        <MapPin className="w-3 h-3" />
                      )}
                      <span>
                        {searchScope === 'global'
                          ? isMobileLandscape
                            ? 'Global'
                            : 'Entire Directory'
                          : isMobileLandscape
                            ? 'Map Area'
                            : 'Visible Map Area'}
                      </span>
                    </button>
                    <button
                      type="button"
                      onClick={() => updateDesktopPanelOpen(false)}
                      aria-label="Collapse contextual listing panel"
                      title="Collapse contextual listing panel"
                      data-testid="desktop-sidebar-collapse-btn"
                      className="p-1.5 rounded-lg bg-[var(--ps-surface)] border border-[var(--ps-border)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-bg)] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)]"
                    >
                      <PanelRightClose className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                <div
                  ref={desktopListRef}
                  data-testid="desktop-sidebar-results-list"
                  onScroll={(e) => {
                    if (
                      isActiveView &&
                      !isExpandedDetailModalOpen &&
                      e.currentTarget.clientHeight > 0
                    ) {
                      desktopListScrollTopRef.current =
                        e.currentTarget.scrollTop;
                    }
                  }}
                  className={`flex-1 overflow-y-auto ${
                    isMobileLandscape
                      ? 'p-2 space-y-2'
                      : 'p-3.5 space-y-3'
                  }`}
                >
                  {selectedListing &&
                    !filteredListings.some(
                      (l) => l.id === selectedListing.id
                    ) &&
                    renderListingResultCard(
                      selectedListing,
                      false,
                      'desktop-sidebar'
                    )}
                  {filteredListings.length === 0 ? (
                    <div
                      data-testid="empty-results-state"
                      className="p-6 text-center space-y-3"
                    >
                      <p className="text-xs sm:text-sm font-semibold text-[var(--ps-text)]">
                        {searchScope === 'map_area'
                          ? 'No sample listings match within the current visible map area.'
                          : 'No sample listings match your current search or filters.'}
                      </p>
                      <div className="flex flex-wrap items-center justify-center gap-2">
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
                      </div>
                    </div>
                  ) : (
                    filteredListings.map((item) =>
                      renderListingResultCard(item, false, 'desktop-sidebar')
                    )
                  )}
                </div>
              </div>
            </aside>
          )}
        </div>
      )}

      {/* =====================================================================
          PART H: RESPONSIVE FILTER DRAWER / BOTTOM SHEET MODAL
         ===================================================================== */}
      <FilterDrawerModal
        open={isFilterModalOpen}
        onClose={() => setIsFilterModalOpen(false)}
        selectedCategory={selectedCategory}
        onSelectCategory={(cat) => {
          setSelectedCategory(cat);
          if (cat !== 'real_estate' && cat !== 'all') {
            setSelectedPropertyType('all');
          }
        }}
        selectedLocality={selectedLocality}
        onSelectLocality={setSelectedLocality}
        localities={localities}
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

      {/* =====================================================================
          PART F: EXPANDED DETAIL OVERLAY SHEET OVER MAP VIEW
         ===================================================================== */}
      {isExpandedDetailModalOpen && selectedListing && (
        <div
          ref={expandedDetailsModalRef}
          tabIndex={-1}
          className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-end sm:items-center justify-center p-0 sm:p-4 overflow-y-auto outline-none"
          role="dialog"
          aria-modal="true"
          aria-label={`Expanded details for ${selectedListing.title}`}
          data-testid="expanded-details-overlay"
        >
          <div className="w-full max-w-5xl max-h-[92dvh] rounded-t-3xl sm:rounded-2xl bg-[var(--ps-bg)] border border-[var(--ps-border)] shadow-2xl overflow-y-auto">
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
      {isCloudStyleModalOpen && (
        <div
          ref={cloudStyleModalRef}
          tabIndex={-1}
          className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-xs flex items-center justify-center p-4 overflow-y-auto outline-none"
          role="dialog"
          aria-modal="true"
          aria-label="Google Maps Cloud-Based Styling and Map ID Configuration"
          data-testid="cloud-style-modal"
        >
          <div className="w-full max-w-2xl rounded-2xl bg-[var(--ps-surface)] text-[var(--ps-text)] border border-[var(--ps-border)] shadow-2xl overflow-hidden">
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
    </div>
  );
}
