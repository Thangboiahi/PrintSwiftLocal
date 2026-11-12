import * as turf from '@turf/turf';
import {
  AdminRole,
  AreaUnit,
  CompletenessReport,
  DiscoverySearchScope,
  DiscoverySortOption,
  DrawnShape,
  interfaceCompletenessItem,
  LatLngPoint,
  LinearUnit,
  Listing,
  ListingCategory,
  MapToolbarPosition,
  MapViewportBounds,
  MobileSheetState,
  PanoramaScene,
  PropertyType,
  ResponsiveLayoutProfile,
  StaffDelegation,
  UserAccount,
} from './types';
import { generateCoverImageDataUri } from './media-generator';

export const CATEGORY_LABELS: Record<ListingCategory, string> = {
  business: 'Businesses & Shops',
  service: 'Services',
  real_estate: 'Real Estate',
  sports: 'Sports & Recreation',
  public_place: 'Public & Community Places',
};

export const PROPERTY_TYPE_LABELS: Record<PropertyType, string> = {
  plot_land: 'Plot / Land',
  house_with_plot: 'House with Plot',
  house_without_plot: 'House without Plot',
  villa_with_land: 'Villa / Bungalow with Land',
  apartment: 'Apartment / Flat',
  commercial: 'Commercial Space / Shop',
  room_pg: 'Room / PG / Hostel',
};

// ============================================================================
// 1. AREA & LINEAR UNIT CONVERSIONS (Canonical unit: Square Metres / m²)
// ============================================================================

export const DEFAULT_AREA_UNIT: AreaUnit = 'sqm';

const SQM_TO_SQFT = 10.763910416709722;
const SQM_TO_ACRE = 1 / 4046.8564224;
const SQM_TO_HECTARE = 1 / 10000;

export function convertFromSqm(valueSqm: number, targetUnit: AreaUnit): number {
  if (!Number.isFinite(valueSqm) || valueSqm < 0) return 0;
  switch (targetUnit) {
    case 'sqm':
      return Number(valueSqm.toFixed(2));
    case 'sqft':
      return Number((valueSqm * SQM_TO_SQFT).toFixed(2));
    case 'acre':
      return Number((valueSqm * SQM_TO_ACRE).toFixed(4));
    case 'hectare':
      return Number((valueSqm * SQM_TO_HECTARE).toFixed(4));
  }
}

export function convertToSqm(valueInUnit: number, sourceUnit: AreaUnit): number {
  if (!Number.isFinite(valueInUnit) || valueInUnit < 0) return 0;
  switch (sourceUnit) {
    case 'sqm':
      return Number(valueInUnit.toFixed(2));
    case 'sqft':
      return Number((valueInUnit / SQM_TO_SQFT).toFixed(2));
    case 'acre':
      return Number((valueInUnit / SQM_TO_ACRE).toFixed(2));
    case 'hectare':
      return Number((valueInUnit / SQM_TO_HECTARE).toFixed(2));
  }
}

export function getAreaUnitSymbol(unit: AreaUnit): string {
  switch (unit) {
    case 'sqm':
      return 'm²';
    case 'sqft':
      return 'ft²';
    case 'acre':
      return 'acres';
    case 'hectare':
      return 'ha';
  }
}

export function formatArea(valueSqm: number | undefined, unit: AreaUnit = 'sqm'): string {
  if (valueSqm === undefined || valueSqm === null || !Number.isFinite(valueSqm)) {
    return '—';
  }
  const converted = convertFromSqm(valueSqm, unit);
  const symbol = getAreaUnitSymbol(unit);
  if (unit === 'acre' || unit === 'hectare') {
    return `${converted.toLocaleString('en-IN', { maximumFractionDigits: 4 })} ${symbol}`;
  }
  return `${converted.toLocaleString('en-IN', { maximumFractionDigits: 2 })} ${symbol}`;
}

export const formatAreaValue = formatArea;

export function formatLinearDistance(meters: number | undefined, unit: LinearUnit = 'm'): string {
  if (meters === undefined || meters === null || !Number.isFinite(meters)) {
    return '—';
  }
  if (unit === 'km') {
    return `${(meters / 1000).toFixed(2)} km`;
  }
  if (unit === 'ft') {
    return `${(meters * 3.28084).toFixed(1)} ft`;
  }
  if (meters >= 1000) {
    return `${meters.toFixed(1)} m (${(meters / 1000).toFixed(2)} km)`;
  }
  return `${meters.toFixed(1)} m`;
}

// ============================================================================
// 2. CONDITIONAL REAL-ESTATE PROPERTY RULES (Mandatory Rule #28)
// ============================================================================

/**
 * Show plot area and land-boundary measurements ONLY for:
 * - A plot/land listing ('plot_land')
 * - A house, villa or bungalow when an associated plot is included
 *   ('house_with_plot', 'villa_with_land')
 * For other property types ('house_without_plot', 'apartment', 'commercial', 'room_pg'),
 * do NOT display land-area fields, polygon editing tools or perimeter calculations
 * unless commercial explicitly has hasAssociatedPlot === true.
 */
export function shouldShowPlotAndBoundary(
  propertyType: PropertyType,
  hasAssociatedPlot?: boolean
): boolean {
  if (propertyType === 'plot_land') return true;
  if (propertyType === 'house_with_plot' || propertyType === 'villa_with_land') {
    return hasAssociatedPlot !== false;
  }
  if (
    propertyType === 'house_without_plot' ||
    propertyType === 'apartment' ||
    propertyType === 'room_pg'
  ) {
    return false;
  }
  if (propertyType === 'commercial') {
    return Boolean(hasAssociatedPlot);
  }
  return false;
}

export function shouldShowBuildingParameters(propertyType: PropertyType): boolean {
  return propertyType !== 'plot_land';
}

export function sanitizeRealEstateForPropertyType<
  T extends {
    propertyType: PropertyType;
    hasAssociatedPlot: boolean;
    plotAreaSqm?: number;
    boundaryPolygon?: LatLngPoint[];
  }
>(details: T): T {
  const updated = { ...details };
  if (updated.propertyType === 'plot_land') {
    updated.hasAssociatedPlot = true;
  } else if (
    updated.propertyType === 'house_with_plot' ||
    updated.propertyType === 'villa_with_land'
  ) {
    updated.hasAssociatedPlot = true;
  } else if (
    updated.propertyType === 'house_without_plot' ||
    updated.propertyType === 'apartment' ||
    updated.propertyType === 'room_pg'
  ) {
    updated.hasAssociatedPlot = false;
  }
  if (!shouldShowPlotAndBoundary(updated.propertyType, updated.hasAssociatedPlot)) {
    updated.plotAreaSqm = undefined;
    updated.boundaryPolygon = undefined;
  }
  return updated;
}

// ============================================================================
// 3. MANDATORY 360° PANORAMA VALIDATION FOR REAL ESTATE (Rule #31)
// ============================================================================

/**
 * Validates whether an uploaded or configured panorama scene is a valid 360°
 * equirectangular image (approx 2:1 aspect ratio, minimum dimensions) and not an
 * ordinary standard photograph.
 */
export const MIN_PANORAMA_WIDTH = 1200;
export const MIN_PANORAMA_HEIGHT = 600;

export function validatePanoramaScene(scene: Partial<PanoramaScene>): {
  valid: boolean;
  reason?: string;
} {
  if (!scene.imageUrl || !scene.imageUrl.trim()) {
    return { valid: false, reason: 'Panorama image source is missing.' };
  }
  if (scene.isEquirectangular !== true) {
    return {
      valid: false,
      reason:
        'Standard photographs or non-equirectangular graphics cannot satisfy the mandatory 360° equirectangular panorama requirement.',
    };
  }
  const width = scene.width ?? 0;
  const height = scene.height ?? 0;
  if (width < MIN_PANORAMA_WIDTH || height < MIN_PANORAMA_HEIGHT) {
    return {
      valid: false,
      reason: `Panorama resolution (${width}×${height}) is below the minimum required 360° equirectangular resolution (${MIN_PANORAMA_WIDTH}×${MIN_PANORAMA_HEIGHT}px).`,
    };
  }
  const ratio = width / height;
  // Standard equirectangular is 2:1 (strict tolerance 1.85 to 2.15)
  if (ratio < 1.85 || ratio > 2.15) {
    return {
      valid: false,
      reason: `Invalid aspect ratio (${ratio.toFixed(2)}:1). A 360° equirectangular panorama requires a 2:1 aspect ratio.`,
    };
  }
  return { valid: true };
}

export function hasValidMandatoryPanorama(listing: Listing): boolean {
  if (listing.category !== 'real_estate') {
    // 360° panorama is NOT required for businesses, services, sports, or public places
    return true;
  }
  const panoramas = listing.realEstateDetails?.panoramas || [];
  if (panoramas.length === 0) return false;
  return panoramas.some((scene) => validatePanoramaScene(scene).valid);
}

// ============================================================================
// 4. LISTING COMPLETENESS & PUBLICATION ELIGIBILITY (Rule #34 & #31)
// ============================================================================

export function calculateListingCompleteness(listing: Listing): CompletenessReport {
  const missingItems: interfaceCompletenessItem[] = [];

  if (!listing.title || listing.title.trim().length < 3) {
    missingItems.push({
      key: 'title',
      label: 'Listing title (minimum 3 characters)',
      section: 'basic',
      isMandatoryBlocker: true,
    });
  }

  if (!listing.description || listing.description.trim().length < 20) {
    missingItems.push({
      key: 'description',
      label: 'Detailed description (minimum 20 characters)',
      section: 'basic',
    });
  }

  if (!listing.coverImage || !listing.coverImage.trim()) {
    missingItems.push({
      key: 'coverImage',
      label: 'Cover photograph',
      section: 'media',
    });
  }

  if (
    !listing.locality ||
    !Number.isFinite(listing.coordinates?.lat) ||
    !Number.isFinite(listing.coordinates?.lng)
  ) {
    missingItems.push({
      key: 'location',
      label: 'Map coordinates and locality',
      section: 'location',
      isMandatoryBlocker: true,
    });
  }

  if (!listing.contactPhone || listing.contactPhone.trim().length < 6) {
    missingItems.push({
      key: 'contactPhone',
      label: 'Synthetic contact phone number',
      section: 'contact',
    });
  }

  if (listing.category === 'real_estate') {
    const re = listing.realEstateDetails;
    if (!re) {
      missingItems.push({
        key: 'realEstateDetails',
        label: 'Real-estate property details',
        section: 'category',
        isMandatoryBlocker: true,
      });
    } else {
      if (!hasValidMandatoryPanorama(listing)) {
        missingItems.push({
          key: 'panorama',
          label: 'Mandatory 360° equirectangular panorama (required before publication)',
          section: 'panorama',
          isMandatoryBlocker: true,
        });
      }
      if (
        shouldShowPlotAndBoundary(re.propertyType, re.hasAssociatedPlot) &&
        (!re.plotAreaSqm || re.plotAreaSqm <= 0)
      ) {
        missingItems.push({
          key: 'plotAreaSqm',
          label: 'Plot area in square metres (m²)',
          section: 'category',
        });
      }
      if (!re.askingPrice || re.askingPrice <= 0) {
        missingItems.push({
          key: 'askingPrice',
          label: 'Asking price or rental rate',
          section: 'category',
        });
      }
    }
  } else if (listing.category === 'business') {
    if (!listing.businessDetails?.openingHours) {
      missingItems.push({
        key: 'openingHours',
        label: 'Business opening hours',
        section: 'category',
      });
    }
    if (
      !listing.businessDetails?.catalogue ||
      listing.businessDetails.catalogue.length === 0
    ) {
      missingItems.push({
        key: 'catalogue',
        label: 'Product catalogue items',
        section: 'catalogue',
      });
    }
  } else if (listing.category === 'service') {
    if (
      !listing.serviceDetails?.areasServed ||
      listing.serviceDetails.areasServed.length === 0
    ) {
      missingItems.push({
        key: 'areasServed',
        label: 'Service coverage areas',
        section: 'category',
      });
    }
  }

  const totalChecks = listing.category === 'real_estate' ? 8 : 7;
  const completedChecks = Math.max(0, totalChecks - missingItems.length);
  const score = Math.round((completedChecks / totalChecks) * 100);
  const hasBlocker = missingItems.some((item) => item.isMandatoryBlocker);

  let blockerMessage: string | undefined;
  if (listing.category === 'real_estate' && !hasValidMandatoryPanorama(listing)) {
    blockerMessage =
      'Submission blocked: Every real-estate listing must include at least one valid 360° equirectangular panorama before it can be submitted for publication. You may still save this listing as an incomplete draft.';
  } else if (hasBlocker) {
    blockerMessage =
      'Please complete all mandatory fields before submitting for publication.';
  }

  return {
    score,
    isComplete: missingItems.length === 0,
    canSubmitForPublication: !hasBlocker,
    missingItems,
    blockerMessage,
  };
}

// ============================================================================
// 5. GEOSPATIAL & VIEWPORT CALCULATIONS (Turf.js)
// ============================================================================

export function calculatePolygonMetrics(points: LatLngPoint[]): {
  areaSqm: number;
  perimeterMeters: number;
  isValid: boolean;
} {
  if (!points || points.length < 3) {
    return { areaSqm: 0, perimeterMeters: 0, isValid: false };
  }
  try {
    const ring = points.map((p) => [p.lng, p.lat]);
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      ring.push([first[0], first[1]]);
    }
    const poly = turf.polygon([ring]);
    const areaSqm = Number(turf.area(poly).toFixed(2));
    const line = turf.lineString(ring);
    const perimeterMeters = Number((turf.length(line, { units: 'kilometers' }) * 1000).toFixed(2));
    return {
      areaSqm,
      perimeterMeters,
      isValid: areaSqm > 0 && Number.isFinite(areaSqm),
    };
  } catch {
    return { areaSqm: 0, perimeterMeters: 0, isValid: false };
  }
}

export function calculateLineDistanceMeters(points: LatLngPoint[]): number {
  if (!points || points.length < 2) return 0;
  try {
    const coords = points.map((p) => [p.lng, p.lat]);
    const line = turf.lineString(coords);
    return Number((turf.length(line, { units: 'kilometers' }) * 1000).toFixed(2));
  } catch {
    return 0;
  }
}

export function calculateLineSegmentsMeters(points: LatLngPoint[]): {
  segments: number[];
  totalMeters: number;
} {
  if (!points || points.length < 2) {
    return { segments: [], totalMeters: 0 };
  }
  const segments: number[] = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i++) {
    try {
      const from = turf.point([points[i].lng, points[i].lat]);
      const to = turf.point([points[i + 1].lng, points[i + 1].lat]);
      const distMeters = Number(
        (turf.distance(from, to, { units: 'kilometers' }) * 1000).toFixed(2)
      );
      segments.push(distMeters);
      total += distMeters;
    } catch {
      segments.push(0);
    }
  }
  return {
    segments,
    totalMeters: Number(total.toFixed(2)),
  };
}

export function calculateCircleMetrics(radiusMeters: number): {
  radiusMeters: number;
  diameterMeters: number;
  circumferenceMeters: number;
  areaSqm: number;
  perimeterMeters: number;
} {
  if (!Number.isFinite(radiusMeters) || radiusMeters <= 0) {
    return {
      radiusMeters: 0,
      diameterMeters: 0,
      circumferenceMeters: 0,
      areaSqm: 0,
      perimeterMeters: 0,
    };
  }
  const cleanRadius = Number(radiusMeters.toFixed(2));
  const diameterMeters = Number((2 * cleanRadius).toFixed(2));
  const circumferenceMeters = Number((2 * Math.PI * cleanRadius).toFixed(2));
  const areaSqm = Number((Math.PI * cleanRadius * cleanRadius).toFixed(2));
  return {
    radiusMeters: cleanRadius,
    diameterMeters,
    circumferenceMeters,
    areaSqm,
    perimeterMeters: circumferenceMeters,
  };
}

export function calculateDistanceMeters(a: LatLngPoint, b: LatLngPoint): number {
  if (
    !a ||
    !b ||
    !Number.isFinite(a.lat) ||
    !Number.isFinite(a.lng) ||
    !Number.isFinite(b.lat) ||
    !Number.isFinite(b.lng)
  ) {
    return 0;
  }
  try {
    const ptA = turf.point([a.lng, a.lat]);
    const ptB = turf.point([b.lng, b.lat]);
    return Number((turf.distance(ptA, ptB, { units: 'kilometers' }) * 1000).toFixed(1));
  } catch {
    return 0;
  }
}

export function translateShapeCoordinates(
  shape: DrawnShape,
  deltaLat: number,
  deltaLng: number
): DrawnShape {
  const shiftPoint = (pt: LatLngPoint): LatLngPoint => ({
    lat: Number((pt.lat + deltaLat).toFixed(6)),
    lng: Number((pt.lng + deltaLng).toFixed(6)),
  });
  return {
    ...shape,
    coordinates: shape.coordinates.map(shiftPoint),
    center: shape.center ? shiftPoint(shape.center) : undefined,
  };
}

export function getListingNumericPrice(listing: Listing): number | null {
  if (listing.category === 'real_estate' && listing.realEstateDetails?.askingPrice) {
    return listing.realEstateDetails.askingPrice;
  }
  if (listing.category === 'service' && listing.serviceDetails?.startingPrice) {
    return listing.serviceDetails.startingPrice;
  }
  if (listing.category === 'business' && listing.businessDetails) {
    const cat = listing.businessDetails.catalogue;
    if (cat && cat.length > 0) {
      const prices = cat.map((p) => p.price).filter((p) => Number.isFinite(p) && p > 0);
      if (prices.length > 0) return Math.min(...prices);
    }
    const tier = listing.businessDetails.priceRange;
    if (tier === '₹') return 250;
    if (tier === '₹₹') return 750;
    if (tier === '₹₹₹') return 2000;
  }
  return null;
}

export function getListingPriceLabel(listing: Listing): string | null {
  if (listing.category === 'real_estate' && listing.realEstateDetails?.priceLabel) {
    return listing.realEstateDetails.priceLabel.replace(/\s*\(Sample\)/i, '');
  }
  if (listing.category === 'service' && listing.serviceDetails?.priceRangeText) {
    return listing.serviceDetails.priceRangeText.replace(/\s*\(Sample\)/i, '');
  }
  if (listing.category === 'business' && listing.businessDetails) {
    const cat = listing.businessDetails.catalogue;
    if (cat && cat.length > 0) {
      const minP = Math.min(...cat.map((c) => c.price));
      return `From ₹${minP.toLocaleString('en-IN')} (${listing.businessDetails.priceRange})`;
    }
    return `Price Tier: ${listing.businessDetails.priceRange}`;
  }
  return null;
}

export interface ClusterSummaryResult {
  count: number;
  categoryBreakdown: Record<ListingCategory, number>;
  representativeNames: string[];
  priceRangeLabel: string | null;
}

export function computeClusterSummary(items: Listing[]): ClusterSummaryResult {
  const categoryBreakdown: Record<ListingCategory, number> = {
    business: 0,
    service: 0,
    real_estate: 0,
    sports: 0,
    public_place: 0,
  };

  if (!items || items.length === 0) {
    return {
      count: 0,
      categoryBreakdown,
      representativeNames: [],
      priceRangeLabel: null,
    };
  }

  const numericPrices: number[] = [];
  for (const item of items) {
    if (categoryBreakdown[item.category] !== undefined) {
      categoryBreakdown[item.category] += 1;
    }
    const p = getListingNumericPrice(item);
    if (p !== null && Number.isFinite(p) && p > 0) {
      numericPrices.push(p);
    }
  }

  const representativeNames = items.slice(0, 3).map((item) => item.title);

  let priceRangeLabel: string | null = null;
  if (numericPrices.length > 0) {
    const minPrice = Math.min(...numericPrices);
    const maxPrice = Math.max(...numericPrices);
    const formatInr = (val: number) => {
      if (val >= 10000000) return `₹${(val / 10000000).toFixed(2)} Cr`;
      if (val >= 100000) return `₹${(val / 100000).toFixed(1)} L`;
      return `₹${val.toLocaleString('en-IN')}`;
    };
    priceRangeLabel =
      minPrice === maxPrice
        ? formatInr(minPrice)
        : `${formatInr(minPrice)} – ${formatInr(maxPrice)}`;
  }

  return {
    count: items.length,
    categoryBreakdown,
    representativeNames,
    priceRangeLabel,
  };
}

export function isValidLatLngPoint(
  point: unknown
): point is LatLngPoint {
  if (!point || typeof point !== 'object') return false;
  const candidate = point as Record<string, unknown>;
  const lat = candidate.lat;
  const lng = candidate.lng;
  return (
    typeof lat === 'number' &&
    typeof lng === 'number' &&
    Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    lat >= -90 &&
    lat <= 90 &&
    lng >= -180 &&
    lng <= 180
  );
}

export function hasValidListingCoordinates(
  listing: { coordinates?: unknown } | null | undefined
): boolean {
  if (!listing) return false;
  return isValidLatLngPoint(listing.coordinates);
}

export function isPointInViewport(
  point: LatLngPoint | null | undefined,
  bounds: MapViewportBounds | null
): boolean {
  if (!isValidLatLngPoint(point)) return false;
  if (!bounds) return true;
  if (
    !Number.isFinite(bounds.north) ||
    !Number.isFinite(bounds.south) ||
    !Number.isFinite(bounds.east) ||
    !Number.isFinite(bounds.west)
  ) {
    return false;
  }
  return (
    point.lat <= bounds.north &&
    point.lat >= bounds.south &&
    point.lng <= bounds.east &&
    point.lng >= bounds.west
  );
}

export function computeDefaultViewportBounds(
  center: LatLngPoint,
  zoom: number = 14
): MapViewportBounds {
  const safeCenter = isValidLatLngPoint(center)
    ? center
    : { lat: 24.3335, lng: 93.6978 };
  const scale = Math.pow(2, 14 - Math.max(10, Math.min(19, zoom)));
  const latHalfSpan = Number((0.0115 * scale).toFixed(6));
  const lngHalfSpan = Number((0.0145 * scale).toFixed(6));
  return {
    north: Number((safeCenter.lat + latHalfSpan).toFixed(6)),
    south: Number((safeCenter.lat - latHalfSpan).toFixed(6)),
    east: Number((safeCenter.lng + lngHalfSpan).toFixed(6)),
    west: Number((safeCenter.lng - lngHalfSpan).toFixed(6)),
  };
}

export function hasMeaningfulViewportChange(
  appliedBounds: MapViewportBounds | null,
  liveBounds: MapViewportBounds | null,
  appliedZoom: number = 14,
  liveZoom: number = 14
): boolean {
  if (!appliedBounds || !liveBounds) return false;
  if (Math.abs(appliedZoom - liveZoom) >= 0.25) return true;
  const appliedCenter: LatLngPoint = {
    lat: (appliedBounds.north + appliedBounds.south) / 2,
    lng: (appliedBounds.east + appliedBounds.west) / 2,
  };
  const liveCenter: LatLngPoint = {
    lat: (liveBounds.north + liveBounds.south) / 2,
    lng: (liveBounds.east + liveBounds.west) / 2,
  };
  const centerShiftMeters = calculateDistanceMeters(appliedCenter, liveCenter);
  if (centerShiftMeters >= 150) return true;
  const maxEdgeDiff = Math.max(
    Math.abs(appliedBounds.north - liveBounds.north),
    Math.abs(appliedBounds.south - liveBounds.south),
    Math.abs(appliedBounds.east - liveBounds.east),
    Math.abs(appliedBounds.west - liveBounds.west)
  );
  return maxEdgeDiff >= 0.0014;
}

export function isPointInsidePolygon(
  point: LatLngPoint,
  polygonPoints: LatLngPoint[]
): boolean {
  if (!polygonPoints || polygonPoints.length < 3) return false;
  try {
    const ring = polygonPoints.map((p) => [p.lng, p.lat]);
    const first = ring[0];
    const last = ring[ring.length - 1];
    if (first[0] !== last[0] || first[1] !== last[1]) {
      ring.push([first[0], first[1]]);
    }
    const pt = turf.point([point.lng, point.lat]);
    const poly = turf.polygon([ring]);
    return turf.booleanPointInPolygon(pt, poly);
  } catch {
    return false;
  }
}

export function isPointWithinRadius(
  point: LatLngPoint,
  center: LatLngPoint,
  radiusMeters: number
): boolean {
  if (radiusMeters <= 0) return false;
  try {
    const from = turf.point([center.lng, center.lat]);
    const to = turf.point([point.lng, point.lat]);
    const distanceKm = turf.distance(from, to, { units: 'kilometers' });
    return distanceKm * 1000 <= radiusMeters;
  } catch {
    return false;
  }
}

/**
 * Computes an adjusted map center so a selected marker is centered in the
 * unobstructed portion of the map (accounting for a desktop side panel or mobile bottom sheet).
 */
export function computeUnobstructedMapCenter(
  markerPos: LatLngPoint,
  zoom: number,
  panelOffsetPx: { x: number; y: number }
): LatLngPoint {
  const scale = Math.pow(2, zoom);
  const worldCoordinateX = ((markerPos.lng + 180) / 360) * 256 * scale;
  const sinLat = Math.sin((markerPos.lat * Math.PI) / 180);
  const worldCoordinateY =
    (0.5 - Math.log((1 + sinLat) / (1 - sinLat)) / (4 * Math.PI)) * 256 * scale;

  const targetWorldX = worldCoordinateX - panelOffsetPx.x;
  const targetWorldY = worldCoordinateY - panelOffsetPx.y;

  const lng = (targetWorldX / (256 * scale)) * 360 - 180;
  const n = Math.PI - (2 * Math.PI * targetWorldY) / (256 * scale);
  const lat = (180 / Math.PI) * Math.atan(0.5 * (Math.exp(n) - Math.exp(-n)));

  return {
    lat: Number(lat.toFixed(6)),
    lng: Number(lng.toFixed(6)),
  };
}

/**
 * Computes the geographic bounding box, center, and expansion zoom level
 * when a user clicks a marker cluster on the map (Task 3).
 * Clicking a cluster expands/zooms into the cluster bounds rather than
 * selecting its first listing.
 */
export function computeClusterExpansionCamera(
  items: Array<{ coordinates: LatLngPoint }>,
  currentZoom: number = 12
): {
  center: LatLngPoint;
  zoom: number;
  bounds: MapViewportBounds;
} {
  if (!items || items.length === 0) {
    return {
      center: { lat: 24.3335, lng: 93.6978 },
      zoom: Math.min(18, Math.max(14, currentZoom + 2)),
      bounds: {
        north: 24.3385,
        south: 24.3285,
        east: 93.7028,
        west: 93.6928,
      },
    };
  }

  let north = -90;
  let south = 90;
  let east = -180;
  let west = 180;

  for (const item of items) {
    const { lat, lng } = item.coordinates;
    if (lat > north) north = lat;
    if (lat < south) south = lat;
    if (lng > east) east = lng;
    if (lng < west) west = lng;
  }

  const latSpan = Math.max(0.0008, north - south);
  const lngSpan = Math.max(0.0008, east - west);
  const padLat = latSpan * 0.25;
  const padLng = lngSpan * 0.25;

  const bounds: MapViewportBounds = {
    north: Number((north + padLat).toFixed(6)),
    south: Number((south - padLat).toFixed(6)),
    east: Number((east + padLng).toFixed(6)),
    west: Number((west - padLng).toFixed(6)),
  };

  const center: LatLngPoint = {
    lat: Number(((north + south) / 2).toFixed(6)),
    lng: Number(((east + west) / 2).toFixed(6)),
  };

  const maxSpan = Math.max(bounds.north - bounds.south, bounds.east - bounds.west);
  let fittedZoom = 14;
  if (maxSpan <= 0.003) {
    fittedZoom = 16;
  } else if (maxSpan <= 0.008) {
    fittedZoom = 15;
  } else if (maxSpan <= 0.018) {
    fittedZoom = 14;
  } else {
    fittedZoom = 13;
  }

  // Ensure cluster click always zooms closer and reaches at least zoom 14 where individual pins de-cluster
  const targetZoom = Math.min(
    18,
    Math.max(14, fittedZoom, Math.floor(currentZoom) + 2)
  );

  return {
    center,
    zoom: targetZoom,
    bounds,
  };
}

// ============================================================================
// 6. LEAST-PRIVILEGE ADMINISTRATIVE PERMISSION MATRIX (Task 4)
// ============================================================================
export type AdminActionPermission =
  | 'manage_users'
  | 'manage_listings'
  | 'manage_verification'
  | 'manage_moderation'
  | 'manage_geography'
  | 'manage_schema'
  | 'manage_settings';

export const ADMIN_ROLE_PERMISSIONS: Record<AdminRole, AdminActionPermission[]> = {
  super_admin: [
    'manage_users',
    'manage_listings',
    'manage_verification',
    'manage_moderation',
    'manage_geography',
    'manage_schema',
    'manage_settings',
  ],
  listing_moderator: ['manage_listings', 'manage_geography'],
  verification_officer: ['manage_verification'],
  community_moderator: ['manage_moderation'],
  customer_support: ['manage_listings'],
  finance_admin: ['manage_settings'],
  analytics_viewer: [],
};

export const ADMIN_ROLE_DESCRIPTIONS: Record<AdminRole, string> = {
  super_admin:
    'Full administrative governance across users, listings, verification, moderation, geography, schema, and settings.',
  listing_moderator:
    'Permitted to review, publish, request changes, suspend listings, and adjust geographic pin coordinates. Read-only elsewhere.',
  verification_officer:
    'Permitted to approve, reject, or request additional evidence on verification requests. Read-only elsewhere.',
  community_moderator:
    'Permitted to action or dismiss reported reviews and community moderation cases. Read-only elsewhere.',
  customer_support:
    'Permitted to assist owners with listing status and change requests. Cannot alter user roles, verification, schema, or settings.',
  finance_admin:
    'Permitted to manage commercial placement demo tiers and platform governance settings. Read-only elsewhere.',
  analytics_viewer:
    'Strictly Read-Only Analytics & Audit Observer. All mutation controls across users, listings, verification, moderation, geography, schema, and settings are prohibited.',
};

export function getAdminRolePermissions(
  adminRole?: AdminRole
): AdminActionPermission[] {
  if (!adminRole) return [];
  return ADMIN_ROLE_PERMISSIONS[adminRole] || [];
}

export function canAdminPerformAction(
  user: Pick<UserAccount, 'roleType' | 'adminRole'> | null | undefined,
  action: AdminActionPermission
): boolean {
  if (!user || user.roleType !== 'admin' || !user.adminRole) {
    return false;
  }
  const allowed = ADMIN_ROLE_PERMISSIONS[user.adminRole];
  return Array.isArray(allowed) && allowed.includes(action);
}

// ============================================================================
// 7. RECTANGLE RESIZING, GEOMETRY CENTROID & ROLE-AWARE LISTING CREATION
// ============================================================================

export function computeShapeCentroid(shape: DrawnShape): LatLngPoint {
  if (shape.center && Number.isFinite(shape.center.lat) && Number.isFinite(shape.center.lng)) {
    return {
      lat: Number(shape.center.lat.toFixed(6)),
      lng: Number(shape.center.lng.toFixed(6)),
    };
  }
  if (!shape.coordinates || shape.coordinates.length === 0) {
    return { lat: 24.3335, lng: 93.6978 };
  }
  if (shape.type === 'point' || shape.coordinates.length === 1) {
    return {
      lat: Number(shape.coordinates[0].lat.toFixed(6)),
      lng: Number(shape.coordinates[0].lng.toFixed(6)),
    };
  }
  if (shape.type === 'line') {
    const midIdx = Math.floor(shape.coordinates.length / 2);
    return {
      lat: Number(shape.coordinates[midIdx].lat.toFixed(6)),
      lng: Number(shape.coordinates[midIdx].lng.toFixed(6)),
    };
  }
  const sum = shape.coordinates.reduce(
    (acc, pt) => ({
      lat: acc.lat + pt.lat,
      lng: acc.lng + pt.lng,
    }),
    { lat: 0, lng: 0 }
  );
  return {
    lat: Number((sum.lat / shape.coordinates.length).toFixed(6)),
    lng: Number((sum.lng / shape.coordinates.length).toFixed(6)),
  };
}

/**
 * Resizes a rectangle shape orthogonally around its geographic center while
 * recomputing canonical m² area and perimeter.
 */
export function resizeRectangleShape(
  shape: DrawnShape,
  scaleLatFactor: number,
  scaleLngFactor: number
): DrawnShape {
  if (shape.type !== 'rectangle' || shape.coordinates.length < 4) {
    return shape;
  }
  const lats = shape.coordinates.map((c) => c.lat);
  const lngs = shape.coordinates.map((c) => c.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  const centerLat = (minLat + maxLat) / 2;
  const centerLng = (minLng + maxLng) / 2;
  const halfLat = Math.max(0.00008, ((maxLat - minLat) / 2) * scaleLatFactor);
  const halfLng = Math.max(0.00008, ((maxLng - minLng) / 2) * scaleLngFactor);

  const n = Number((centerLat + halfLat).toFixed(6));
  const s = Number((centerLat - halfLat).toFixed(6));
  const e = Number((centerLng + halfLng).toFixed(6));
  const w = Number((centerLng - halfLng).toFixed(6));

  const nextCoords: LatLngPoint[] = [
    { lat: n, lng: w },
    { lat: n, lng: e },
    { lat: s, lng: e },
    { lat: s, lng: w },
  ];
  const metrics = calculatePolygonMetrics(nextCoords);
  return {
    ...shape,
    coordinates: nextCoords,
    center: {
      lat: Number(centerLat.toFixed(6)),
      lng: Number(centerLng.toFixed(6)),
    },
    areaSqm: metrics.areaSqm,
    perimeterMeters: metrics.perimeterMeters,
  };
}

/**
 * Evaluates whether the active demonstration user has permission to initiate
 * listing creation from drawn map geometry.
 *
 * - Visitors: Strictly prohibited (read-only exploration; drawing shapes does NOT grant listing creation).
 * - Owners (active): Permitted.
 * - Staff (active): Permitted ONLY if an active StaffDelegation grants 'edit_details'.
 * - Admins (active): Permitted ONLY if the admin role includes 'manage_listings'
 *   (super_admin, listing_moderator, customer_support). Read-only / other admin roles
 *   (analytics_viewer, verification_officer, community_moderator, finance_admin) are prohibited.
 */
export function canUserCreateListingFromGeometry(
  user: UserAccount | null | undefined,
  staffDelegations: StaffDelegation[] = []
): {
  allowed: boolean;
  ownerId: string;
  ownerName: string;
  reason?: string;
} {
  if (!user || user.status !== 'active') {
    return {
      allowed: false,
      ownerId: '',
      ownerName: '',
      reason: 'Account is inactive or unavailable.',
    };
  }

  if (user.roleType === 'visitor') {
    return {
      allowed: false,
      ownerId: '',
      ownerName: '',
      reason:
        'Public visitors can draw and measure shapes on the map, but listing creation requires an authorised Owner, Delegated Staff (with Edit Details), or Listing Admin role.',
    };
  }

  if (user.roleType === 'owner') {
    return {
      allowed: true,
      ownerId: user.id,
      ownerName: user.name,
    };
  }

  if (user.roleType === 'staff') {
    const activeEditDelegation = staffDelegations.find(
      (d) =>
        d.staffUserId === user.id &&
        d.status === 'active' &&
        d.permissions.includes('edit_details')
    );
    if (!activeEditDelegation) {
      return {
        allowed: false,
        ownerId: '',
        ownerName: '',
        reason: `Delegated staff account "${user.name}" does not hold the "edit_details" permission required to initiate or edit listings.`,
      };
    }
    return {
      allowed: true,
      ownerId: activeEditDelegation.ownerId,
      ownerName: 'Thangboi Demo Enterprises (Owner)',
    };
  }

  if (user.roleType === 'admin') {
    if (!canAdminPerformAction(user, 'manage_listings')) {
      return {
        allowed: false,
        ownerId: '',
        ownerName: '',
        reason: `Admin role "${user.adminRole}" does not hold "manage_listings" permission.`,
      };
    }
    return {
      allowed: true,
      ownerId: 'owner-1',
      ownerName: user.name,
    };
  }

  return {
    allowed: false,
    ownerId: '',
    ownerName: '',
    reason: 'Role is not authorised to create listings.',
  };
}

export interface CreateListingFromGeometryParams {
  shape: DrawnShape;
  category: ListingCategory;
  propertyType?: PropertyType;
  commercialHasPlot?: boolean;
  user: UserAccount | null | undefined;
  staffDelegations?: StaffDelegation[];
  defaultLocality?: string;
}

/**
 * Maps a user-drawn geospatial shape (Point, Line, Polygon, Rectangle, Circle)
 * into a prefilled Draft Listing record ready for the existing Listing Editor form,
 * enforcing role permissions and conditional real-estate plot/boundary rules.
 */
export function applyDrawnGeometryToListingDraft(
  params: CreateListingFromGeometryParams
): {
  ok: boolean;
  error?: string;
  draft?: Listing;
  geometryMappingSummary?: string;
} {
  const {
    shape,
    category,
    propertyType = 'plot_land',
    commercialHasPlot = false,
    user,
    staffDelegations = [],
    defaultLocality = 'New Lamka Demo Sector (Sample)',
  } = params;

  const perm = canUserCreateListingFromGeometry(user, staffDelegations);
  if (!perm.allowed) {
    return {
      ok: false,
      error: perm.reason || 'Permission denied.',
    };
  }

  const anchorCoords = computeShapeCentroid(shape);
  const nowIso = new Date().toISOString();
  const id = `${category.slice(0, 3)}-geo-${Date.now()}`;

  const isCustomLabel =
    shape.label &&
    !/^(Pin|Line|Polygon|Rectangle|Radius)\b/i.test(shape.label.trim());
  const initialTitle = isCustomLabel ? shape.label.trim() : '';
  const initialDesc =
    shape.type === 'point' && shape.description
      ? shape.description.trim()
      : '';

  const polyMetrics =
    shape.type === 'polygon' || shape.type === 'rectangle'
      ? calculatePolygonMetrics(shape.coordinates)
      : null;
  const lineMetrics =
    shape.type === 'line'
      ? calculateLineSegmentsMeters(shape.coordinates)
      : null;
  const circleMetrics =
    shape.type === 'circle'
      ? calculateCircleMetrics(shape.radiusMeters || 300)
      : null;

  let geometryMappingSummary = '';
  const customFields: Record<string, string | number | boolean> = {
    sourceGeometryId: shape.id,
    sourceGeometryType: shape.type,
    sourceGeometryLabel: shape.label,
  };

  if (shape.type === 'point') {
    geometryMappingSummary = `Point coordinates (${anchorCoords.lat.toFixed(5)}, ${anchorCoords.lng.toFixed(5)}) prefilled as listing location.`;
  } else if (shape.type === 'line') {
    const totalM = lineMetrics?.totalMeters || shape.distanceMeters || 0;
    const routeRef = `${shape.label}: ${totalM.toFixed(1)} m (${(totalM / 1000).toFixed(2)} km, ${shape.coordinates.length} vertices)`;
    customFields.routeReference = routeRef;
    customFields.routeDistanceMeters = totalM;
    geometryMappingSummary = `Line preserved strictly as route/frontage reference (${totalM.toFixed(1)} m). Never applied as a property boundary.`;
  } else if (shape.type === 'circle') {
    const r = circleMetrics?.radiusMeters || shape.radiusMeters || 300;
    customFields.serviceCoverageRadiusMeters = r;
    geometryMappingSummary = `Circle centre (${anchorCoords.lat.toFixed(5)}, ${anchorCoords.lng.toFixed(5)}) and ${r} m coverage radius prefilled.`;
  } else if (shape.type === 'polygon' || shape.type === 'rectangle') {
    const areaVal = polyMetrics?.areaSqm || shape.areaSqm || 0;
    const perimVal = polyMetrics?.perimeterMeters || shape.perimeterMeters || 0;
    if (shape.coordinates.length >= 3) {
      customFields.sourcePolygonCoordinatesJson = JSON.stringify(
        shape.coordinates.map((pt) => ({ lat: pt.lat, lng: pt.lng }))
      );
      customFields.sourcePolygonAreaSqm = areaVal;
      customFields.sourcePolygonPerimeterMeters = perimVal;
    }
    const hasAssociatedPlot =
      propertyType === 'commercial'
        ? Boolean(commercialHasPlot)
        : propertyType === 'plot_land' ||
          propertyType === 'house_with_plot' ||
          propertyType === 'villa_with_land';
    const eligibleForBoundary =
      category === 'real_estate' &&
      shouldShowPlotAndBoundary(propertyType, hasAssociatedPlot);

    if (eligibleForBoundary) {
      geometryMappingSummary = `${shape.type === 'rectangle' ? 'Rectangle' : 'Polygon'} boundary (${shape.coordinates.length} vertices, ${areaVal.toFixed(1)} m², perimeter ${perimVal.toFixed(1)} m) prefilled into Real Estate plot & boundary fields.`;
    } else if (category === 'real_estate') {
      geometryMappingSummary = `Centroid (${anchorCoords.lat.toFixed(5)}, ${anchorCoords.lng.toFixed(5)}) prefilled. Plot polygon omitted because "${PROPERTY_TYPE_LABELS[propertyType]}" does not include an associated land plot.`;
    } else if (category === 'service') {
      customFields.coverageAreaSqm = areaVal;
      geometryMappingSummary = `Centroid (${anchorCoords.lat.toFixed(5)}, ${anchorCoords.lng.toFixed(5)}) and ${areaVal.toFixed(1)} m² service coverage zone prefilled.`;
    } else {
      geometryMappingSummary = `Centroid (${anchorCoords.lat.toFixed(5)}, ${anchorCoords.lng.toFixed(5)}) prefilled as listing location.`;
    }
  }

  const hasAssociatedPlotForRe =
    propertyType === 'commercial'
      ? Boolean(commercialHasPlot)
      : propertyType === 'plot_land' ||
        propertyType === 'house_with_plot' ||
        propertyType === 'villa_with_land';

  const applyBoundaryToRe =
    category === 'real_estate' &&
    (shape.type === 'polygon' || shape.type === 'rectangle') &&
    shape.coordinates.length >= 3 &&
    shouldShowPlotAndBoundary(propertyType, hasAssociatedPlotForRe);

  const computedAreaSqm = polyMetrics?.areaSqm || shape.areaSqm || 0;
  const computedPerimM = polyMetrics?.perimeterMeters || shape.perimeterMeters || 0;

  const draft: Listing = {
    id,
    title: initialTitle,
    category,
    subcategory:
      category === 'real_estate'
        ? PROPERTY_TYPE_LABELS[propertyType]
        : category === 'business'
          ? 'Local Retail & Services'
          : category === 'service'
            ? 'Professional & Technical Service'
            : category === 'sports'
              ? 'Sports & Recreation Venue'
              : 'Community Landmark',
    status: 'draft',
    verificationStatus: 'unverified_sample',
    description: initialDesc,
    shortDescription: initialDesc.slice(0, 120),
    locality: defaultLocality,
    address:
      shape.type === 'line'
        ? `Along drawn route (${(lineMetrics?.totalMeters || shape.distanceMeters || 0).toFixed(1)} m), ${defaultLocality}`
        : `Near (${anchorCoords.lat.toFixed(4)}, ${anchorCoords.lng.toFixed(4)}), ${defaultLocality}`,
    coordinates: anchorCoords,
    contactPhone: '+91 98620 00000',
    contactEmail: user?.email || 'owner1@sample-printswift.local',
    coverImage: generateCoverImageDataUri(
      initialTitle || 'New Sample Listing',
      category,
      defaultLocality,
      1
    ),
    galleryImages: [
      generateCoverImageDataUri(
        `${initialTitle || 'New Sample Listing'} — Exterior`,
        category,
        defaultLocality,
        2
      ),
    ],
    ownerId: perm.ownerId,
    ownerName: perm.ownerName,
    assignedStaffIds: user?.roleType === 'staff' ? [user.id] : [],
    createdAt: nowIso.slice(0, 10),
    updatedAt: nowIso,
    isFeaturedDemo: false,
    rating: 4.5,
    reviewCount: 0,
    viewsCount: 0,
    mapImpressionsCount: 0,
    detailVisitsCount: 0,
    directionClicksCount: 0,
    followsCount: 0,
    enquiriesCount: 0,
    customFields: Object.keys(customFields).length > 0 ? customFields : undefined,
    versionHistory: [],
    businessDetails:
      category === 'business'
        ? {
            subcategory: 'Retail & Supplies',
            openingHours: 'Mon–Sat: 09:00 AM – 07:00 PM',
            priceRange: '₹₹',
            deliveryInfo:
              shape.type === 'circle'
                ? `Local delivery within ${circleMetrics?.radiusMeters || shape.radiusMeters || 300} m radius in Churachandpur`
                : shape.type === 'line'
                  ? `Corridor reference: ${(lineMetrics?.totalMeters || shape.distanceMeters || 0).toFixed(1)} m route`
                  : 'Local delivery available in Churachandpur',
            establishedYear: 2021,
            highlights: ['Sample Business', 'Draft from Map Geometry'],
            catalogue: [],
          }
        : undefined,
    realEstateDetails:
      category === 'real_estate'
        ? sanitizeRealEstateForPropertyType({
            propertyType,
            hasAssociatedPlot: hasAssociatedPlotForRe,
            availability: 'available' as const,
            askingPrice: 4500000,
            priceLabel: '₹45.0 Lakhs (Sample)',
            builtUpAreaSqm: propertyType === 'plot_land' ? undefined : 160,
            plotAreaSqm: applyBoundaryToRe ? computedAreaSqm : undefined,
            boundaryPolygon: applyBoundaryToRe ? shape.coordinates : undefined,
            dimensionsText: applyBoundaryToRe
              ? `Area: ${computedAreaSqm.toFixed(1)} m² · Perimeter: ${computedPerimM.toFixed(1)} m (${shape.coordinates.length} vertices)`
              : undefined,
            roadAccess:
              shape.type === 'line'
                ? `Route / Frontage Reference: ${(lineMetrics?.totalMeters || shape.distanceMeters || 0).toFixed(1)} m (${shape.coordinates.length} vertices)`
                : undefined,
            bedrooms: propertyType === 'plot_land' ? undefined : 3,
            bathrooms: propertyType === 'plot_land' ? undefined : 2,
            floors: propertyType === 'plot_land' ? undefined : 2,
            furnishingStatus:
              propertyType === 'plot_land'
                ? undefined
                : ('Semi-Furnished' as const),
            utilities: ['Grid Electricity', 'Water Tank'],
            amenities: ['Road Access'],
            panoramas: [],
            streetViewAvailable: false,
          })
        : undefined,
    serviceDetails:
      category === 'service'
        ? {
            serviceType: 'Professional & Technical Service',
            areasServed:
              shape.type === 'circle'
                ? [
                    `${defaultLocality} (${circleMetrics?.radiusMeters || shape.radiusMeters || 300}m radius)`,
                    'New Lamka Demo Sector (Sample)',
                    'Tuibong Sample Corridor (Sample)',
                  ]
                : shape.type === 'polygon' || shape.type === 'rectangle'
                  ? [
                      `${defaultLocality} (${computedAreaSqm.toFixed(0)} m² coverage zone)`,
                      'New Lamka Demo Sector (Sample)',
                    ]
                  : shape.type === 'line'
                    ? [
                        `${defaultLocality} (${(lineMetrics?.totalMeters || shape.distanceMeters || 0).toFixed(1)} m route corridor)`,
                      ]
                    : [defaultLocality, 'Tuibong Sample Corridor (Sample)'],
            workingHours: '09:00 AM – 06:00 PM',
            availabilityStatus: 'Available Today',
            startingPrice: 300,
            priceRangeText: '₹300 – ₹2,500 (Sample)',
            experienceYears: 5,
            workSamples: ['Sample Service Project'],
            certificationsLabel: 'Sample Trade Certificate',
          }
        : undefined,
    publicPlaceDetails:
      category === 'public_place'
        ? {
            placeType: 'Community Landmark',
            publicInfo: 'Open to community visitors',
            facilities: ['Seating', 'Drinking Water'],
            openingHours: '06:00 AM – 06:00 PM',
            verificationSourceLabel: 'District Community Board (Sample)',
            accessibilityNotes:
              shape.type === 'line'
                ? `Access trail / route length: ${(lineMetrics?.totalMeters || shape.distanceMeters || 0).toFixed(1)} m`
                : 'Ramp access available at main gate',
          }
        : undefined,
    sportsDetails:
      category === 'sports'
        ? {
            sportActivity: 'Football & Futsal',
            venueCategory: 'Turf Court',
            facilities: ['Floodlights', 'Changing Rooms'],
            capacity: 150,
            openingHours: '06:00 AM – 10:00 PM',
            surfaceType: 'FIFA-Grade Synthetic Turf',
            accessNotes:
              shape.type === 'line'
                ? `Approach route reference: ${(lineMetrics?.totalMeters || shape.distanceMeters || 0).toFixed(1)} m`
                : 'Slot enquiry available via demonstration form',
          }
        : undefined,
  };

  return {
    ok: true,
    draft,
    geometryMappingSummary,
  };
}

/**
 * Extracts a preserved polygon/rectangle snapshot (coordinates + canonical m² area + perimeter)
 * from either the active realEstateDetails.boundaryPolygon or the customFields snapshot.
 */
export function extractPreservedPolygonSnapshot(listing: Listing): {
  coordinates: LatLngPoint[];
  areaSqm: number;
  perimeterMeters: number;
} | null {
  const activeBoundary = listing.realEstateDetails?.boundaryPolygon;
  if (Array.isArray(activeBoundary) && activeBoundary.length >= 3) {
    const coords = activeBoundary.map((pt) => ({ lat: pt.lat, lng: pt.lng }));
    const metrics = calculatePolygonMetrics(coords);
    const areaSqm =
      typeof listing.realEstateDetails?.plotAreaSqm === 'number' &&
      listing.realEstateDetails.plotAreaSqm > 0
        ? listing.realEstateDetails.plotAreaSqm
        : metrics.areaSqm;
    return {
      coordinates: coords,
      areaSqm,
      perimeterMeters: metrics.perimeterMeters,
    };
  }

  const rawJson = listing.customFields?.sourcePolygonCoordinatesJson;
  if (typeof rawJson === 'string' && rawJson.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(rawJson);
      if (
        Array.isArray(parsed) &&
        parsed.length >= 3 &&
        parsed.every(
          (pt: unknown) =>
            typeof pt === 'object' &&
            pt !== null &&
            typeof (pt as LatLngPoint).lat === 'number' &&
            typeof (pt as LatLngPoint).lng === 'number'
        )
      ) {
        const coords: LatLngPoint[] = parsed.map((pt: LatLngPoint) => ({
          lat: pt.lat,
          lng: pt.lng,
        }));
        const metrics = calculatePolygonMetrics(coords);
        const savedArea = Number(listing.customFields?.sourcePolygonAreaSqm);
        const savedPerim = Number(
          listing.customFields?.sourcePolygonPerimeterMeters
        );
        return {
          coordinates: coords,
          areaSqm:
            Number.isFinite(savedArea) && savedArea > 0
              ? savedArea
              : metrics.areaSqm,
          perimeterMeters:
            Number.isFinite(savedPerim) && savedPerim > 0
              ? savedPerim
              : metrics.perimeterMeters,
        };
      }
    } catch {
      // Ignore malformed JSON
    }
  }

  return null;
}

/**
 * Transitions a listing's Real Estate propertyType inside the Listing Editor while:
 * 1. Preserving drawn polygon coordinates and canonical m² area across toggles.
 * 2. Applying polygon geometry ONLY to eligible land-bearing property types.
 * 3. Strictly stripping boundaryPolygon and plotAreaSqm from non-plot property types
 *    (apartment, house_without_plot, room_pg, or commercial without plot).
 * 4. Never fabricating a synthetic polygon for listings created from point, line, or circle geometry.
 */
export function applyEditorPropertyTypeChange(
  listing: Listing,
  nextType: PropertyType,
  commercialHasPlot?: boolean
): Listing {
  if (!listing.realEstateDetails) return listing;
  const re = listing.realEstateDetails;

  const snapshot = extractPreservedPolygonSnapshot(listing);
  const nextCustomFields: Record<string, string | number | boolean> = {
    ...(listing.customFields || {}),
  };
  if (snapshot) {
    nextCustomFields.sourcePolygonCoordinatesJson = JSON.stringify(
      snapshot.coordinates
    );
    nextCustomFields.sourcePolygonAreaSqm = snapshot.areaSqm;
    nextCustomFields.sourcePolygonPerimeterMeters = snapshot.perimeterMeters;
  }

  const hasAssociatedPlot =
    nextType === 'commercial'
      ? Boolean(commercialHasPlot)
      : nextType === 'plot_land' ||
        nextType === 'house_with_plot' ||
        nextType === 'villa_with_land';
  const showPlot = shouldShowPlotAndBoundary(nextType, hasAssociatedPlot);

  const srcGeomType = nextCustomFields.sourceGeometryType;
  const isFromNonPolygonShape =
    srcGeomType === 'point' ||
    srcGeomType === 'circle' ||
    srcGeomType === 'line';

  let nextBoundaryPolygon: LatLngPoint[] | undefined;
  let nextPlotAreaSqm: number | undefined;
  let nextDimensionsText: string | undefined = re.dimensionsText;

  if (showPlot) {
    if (snapshot) {
      nextBoundaryPolygon = snapshot.coordinates.map((pt) => ({
        lat: pt.lat,
        lng: pt.lng,
      }));
      nextPlotAreaSqm = snapshot.areaSqm;
      nextDimensionsText =
        re.dimensionsText ||
        `Area: ${snapshot.areaSqm.toFixed(1)} m² · Perimeter: ${snapshot.perimeterMeters.toFixed(1)} m (${snapshot.coordinates.length} vertices)`;
    } else if (isFromNonPolygonShape) {
      nextBoundaryPolygon = undefined;
      nextPlotAreaSqm = undefined;
      nextDimensionsText = undefined;
    } else {
      nextPlotAreaSqm = re.plotAreaSqm || 250;
      nextBoundaryPolygon = [
        {
          lat: listing.coordinates.lat + 0.0003,
          lng: listing.coordinates.lng - 0.0003,
        },
        {
          lat: listing.coordinates.lat + 0.0003,
          lng: listing.coordinates.lng + 0.0003,
        },
        {
          lat: listing.coordinates.lat - 0.0003,
          lng: listing.coordinates.lng + 0.0003,
        },
        {
          lat: listing.coordinates.lat - 0.0003,
          lng: listing.coordinates.lng - 0.0003,
        },
      ];
    }
  } else {
    nextBoundaryPolygon = undefined;
    nextPlotAreaSqm = undefined;
    nextDimensionsText = undefined;
  }

  return {
    ...listing,
    subcategory:
      listing.category === 'real_estate'
        ? PROPERTY_TYPE_LABELS[nextType]
        : listing.subcategory,
    customFields:
      Object.keys(nextCustomFields).length > 0 ? nextCustomFields : undefined,
    realEstateDetails: sanitizeRealEstateForPropertyType({
      ...re,
      propertyType: nextType,
      hasAssociatedPlot,
      plotAreaSqm: nextPlotAreaSqm,
      boundaryPolygon: nextBoundaryPolygon,
      dimensionsText: nextDimensionsText,
    }),
  };
}

/**
 * Transitions a listing's category inside the Listing Editor while preserving any drawn
 * polygon coordinates and canonical m² area in customFields, and applying them when
 * switching into an eligible land-bearing Real Estate subtype.
 */
export function applyEditorCategoryChange(
  listing: Listing,
  nextCategory: ListingCategory
): Listing {
  const snapshot = extractPreservedPolygonSnapshot(listing);
  const nextCustomFields: Record<string, string | number | boolean> = {
    ...(listing.customFields || {}),
  };
  if (snapshot) {
    nextCustomFields.sourcePolygonCoordinatesJson = JSON.stringify(
      snapshot.coordinates
    );
    nextCustomFields.sourcePolygonAreaSqm = snapshot.areaSqm;
    nextCustomFields.sourcePolygonPerimeterMeters = snapshot.perimeterMeters;
  }

  const updated: Listing = {
    ...listing,
    category: nextCategory,
    customFields:
      Object.keys(nextCustomFields).length > 0 ? nextCustomFields : undefined,
    coverImage: generateCoverImageDataUri(
      listing.title || 'Sample Listing',
      nextCategory,
      listing.locality,
      1
    ),
  };

  if (nextCategory === 'real_estate') {
    if (!updated.realEstateDetails) {
      const srcGeomType = nextCustomFields.sourceGeometryType;
      const isFromNonPolygonShape =
        srcGeomType === 'point' ||
        srcGeomType === 'circle' ||
        srcGeomType === 'line';
      const defaultPropertyType: PropertyType =
        srcGeomType === 'polygon' || srcGeomType === 'rectangle'
          ? 'plot_land'
          : 'house_with_plot';

      updated.realEstateDetails = {
        propertyType: defaultPropertyType,
        hasAssociatedPlot: true,
        availability: 'available',
        askingPrice: 4200000,
        priceLabel: '₹42.0 Lakhs (Sample)',
        builtUpAreaSqm: defaultPropertyType === 'plot_land' ? undefined : 150,
        plotAreaSqm: snapshot
          ? snapshot.areaSqm
          : isFromNonPolygonShape
            ? undefined
            : 260,
        bedrooms: defaultPropertyType === 'plot_land' ? undefined : 3,
        bathrooms: defaultPropertyType === 'plot_land' ? undefined : 2,
        floors: defaultPropertyType === 'plot_land' ? undefined : 2,
        furnishingStatus:
          defaultPropertyType === 'plot_land' ? undefined : 'Semi-Furnished',
        roadFrontageMeters: 10,
        utilities: ['Electricity', 'Water Supply'],
        amenities: ['Parking'],
        boundaryPolygon: snapshot
          ? snapshot.coordinates.map((pt) => ({ lat: pt.lat, lng: pt.lng }))
          : isFromNonPolygonShape
            ? undefined
            : [
                {
                  lat: updated.coordinates.lat + 0.0003,
                  lng: updated.coordinates.lng - 0.0003,
                },
                {
                  lat: updated.coordinates.lat + 0.0003,
                  lng: updated.coordinates.lng + 0.0003,
                },
                {
                  lat: updated.coordinates.lat - 0.0003,
                  lng: updated.coordinates.lng + 0.0003,
                },
                {
                  lat: updated.coordinates.lat - 0.0003,
                  lng: updated.coordinates.lng - 0.0003,
                },
              ],
        dimensionsText: snapshot
          ? `Area: ${snapshot.areaSqm.toFixed(1)} m² · Perimeter: ${snapshot.perimeterMeters.toFixed(1)} m (${snapshot.coordinates.length} vertices)`
          : undefined,
        panoramas: [],
        streetViewAvailable: false,
      };
    }
    return applyEditorPropertyTypeChange(
      updated,
      updated.realEstateDetails.propertyType,
      updated.realEstateDetails.hasAssociatedPlot
    );
  }

  if (nextCategory === 'business' && !updated.businessDetails) {
    updated.businessDetails = {
      subcategory: 'Retail & Services',
      openingHours: '09:00 AM – 07:00 PM',
      priceRange: '₹₹',
      deliveryInfo: 'In-store & local delivery',
      establishedYear: 2020,
      highlights: ['Sample Business'],
      catalogue: [],
    };
  }

  return updated;
}

export const DRAW_TOOLBOX_POSITION_LABELS: Record<MapToolbarPosition, string> = {
  'top-left': 'Top Left',
  'top-center': 'Top Centre',
  'top-right': 'Top Right',
  'bottom-left': 'Bottom Left',
  'bottom-center': 'Bottom Centre',
  'bottom-right': 'Bottom Right',
};

export const ALL_DOCK_POSITIONS: MapToolbarPosition[] = [
  'top-left',
  'top-center',
  'top-right',
  'bottom-left',
  'bottom-center',
  'bottom-right',
];

/**
 * Snaps normalized pointer coordinates (relX, relY in [0, 1]) inside the map viewport
 * to one of the six canonical docking positions.
 */
export function snapPointerToDockPosition(
  relX: number,
  relY: number
): MapToolbarPosition {
  const clampedX = Math.max(0, Math.min(1, Number.isFinite(relX) ? relX : 0));
  const clampedY = Math.max(0, Math.min(1, Number.isFinite(relY) ? relY : 0));
  const row = clampedY < 0.5 ? 'top' : 'bottom';
  const col = clampedX < 0.34 ? 'left' : clampedX > 0.66 ? 'right' : 'center';
  return `${row}-${col}` as MapToolbarPosition;
}

export interface ResponsiveLayoutProfileResult {
  profile: ResponsiveLayoutProfile;
  isSplitScreen: boolean;
  isMobilePortrait: boolean;
  isMobileLandscape: boolean;
  isTabletPortrait: boolean;
  isTabletLandscape: boolean;
  isDesktop: boolean;
  useVerticalNavRail: boolean;
  useTopHeaderNav: boolean;
  useBottomNav: boolean;
  defaultMapSplitPct: number;
  defaultListingSplitPct: number;
  minMapWidthPx: number;
  minListingWidthPx: number;
}

/**
 * Step 4C: Classifies any viewport (width, height) into one of five canonical
 * responsive layout profiles with deterministic split-screen and navigation rules.
 */
export function resolveResponsiveLayoutProfile(
  width: number,
  height: number
): ResponsiveLayoutProfileResult {
  const safeW = Number.isFinite(width) && width > 0 ? width : 1440;
  const safeH = Number.isFinite(height) && height > 0 ? height : 900;

  let profile: ResponsiveLayoutProfile = 'desktop';
  if (safeW > safeH && safeH <= 500) {
    profile = 'mobile-landscape';
  } else if (safeW < 768) {
    profile = 'mobile-portrait';
  } else if (safeW >= 768 && safeW < 1024 && safeH >= safeW) {
    profile = 'tablet-portrait';
  } else if (safeW < 1280) {
    profile = 'tablet-landscape';
  } else {
    profile = 'desktop';
  }

  const isMobilePortrait = profile === 'mobile-portrait';
  const isMobileLandscape = profile === 'mobile-landscape';
  const isTabletPortrait = profile === 'tablet-portrait';
  const isTabletLandscape = profile === 'tablet-landscape';
  const isDesktop = profile === 'desktop';

  // Split-screen is used for mobile-landscape (60/40), tablet-landscape (65/35), and desktop.
  // Mobile portrait and tablet portrait use the expandable 3-state bottom sheet (with 2-column compact grid on tablet portrait).
  const isSplitScreen =
    isMobileLandscape || isTabletLandscape || isDesktop;

  const useVerticalNavRail = isMobileLandscape;
  const useTopHeaderNav = safeW >= 1024 && !isMobileLandscape;
  const useBottomNav = !useVerticalNavRail && !useTopHeaderNav;

  let defaultMapSplitPct = 100;
  let defaultListingSplitPct = 0;
  if (isMobileLandscape) {
    defaultMapSplitPct = 60;
    defaultListingSplitPct = 40;
  } else if (isTabletLandscape) {
    defaultMapSplitPct = 65;
    defaultListingSplitPct = 35;
  } else if (isDesktop) {
    defaultMapSplitPct = 69;
    defaultListingSplitPct = 31;
  }

  const minMapWidthPx = isMobileLandscape ? 320 : 420;
  const minListingWidthPx = isMobileLandscape ? 240 : 280;

  return {
    profile,
    isSplitScreen,
    isMobilePortrait,
    isMobileLandscape,
    isTabletPortrait,
    isTabletLandscape,
    isDesktop,
    useVerticalNavRail,
    useTopHeaderNav,
    useBottomNav,
    defaultMapSplitPct,
    defaultListingSplitPct,
    minMapWidthPx,
    minListingWidthPx,
  };
}

/**
 * Step 4C: Clamps the listing panel width percentage in split-screen mode so neither
 * the map viewport nor the listing panel can become narrower than its minimum usable width.
 */
export function clampSplitListingPercentage(
  requestedListingPct: number,
  containerWidthPx: number,
  profileInput:
    | ResponsiveLayoutProfile
    | ResponsiveLayoutProfileResult = 'tablet-landscape'
): number {
  const profile: ResponsiveLayoutProfile =
    typeof profileInput === 'string' ? profileInput : profileInput.profile;
  const fallbackPct =
    profile === 'mobile-landscape'
      ? 40
      : profile === 'tablet-landscape'
        ? 35
        : 31;
  const rawPct = Number.isFinite(requestedListingPct)
    ? requestedListingPct
    : fallbackPct;
  const safeContainerW =
    Number.isFinite(containerWidthPx) && containerWidthPx > 0
      ? containerWidthPx
      : profile === 'mobile-landscape'
        ? 800
        : profile === 'tablet-landscape'
          ? 1024
          : 1440;

  const minMapPx = profile === 'mobile-landscape' ? 320 : 420;
  const minListingPx = profile === 'mobile-landscape' ? 240 : 280;

  const minPctFromPx = (minListingPx / safeContainerW) * 100;
  const maxPctFromMapPx =
    ((safeContainerW - minMapPx) / safeContainerW) * 100;

  const minPct = Math.max(24, Math.min(42, minPctFromPx));
  const maxPct = Math.min(50, Math.max(minPct + 4, maxPctFromMapPx));

  return Number(Math.max(minPct, Math.min(maxPct, rawPct)).toFixed(1));
}

export interface DrawToolboxDockLayoutParams {
  position: MapToolbarPosition;
  isCollapsed: boolean;
  mapToolbarPosition?: MapToolbarPosition;
  mobileBottomOffsetClass?: string;
  mobileSheetState?: MobileSheetState;
  hasSelectedListing?: boolean;
  hasActiveClusterSummary?: boolean;
  hasHoveredListingPreview?: boolean;
  hasCameraMoved?: boolean;
  isFullscreenMap?: boolean;
  isSplitScreen?: boolean;
  isMobileLandscape?: boolean;
}

/**
 * Computes responsive positioning, collision-avoidance offsets, and viewport-bounded
 * max-height classes for the Draw & Measure toolbox across all 6 docking positions.
 */
export function resolveDrawToolboxDockLayout(
  params: DrawToolboxDockLayoutParams
): {
  positionClasses: string;
  maxHeightClasses: string;
  popoverAlignClasses: string;
  isCoDockedWithMapToolbar: boolean;
} {
  const {
    position,
    isCollapsed,
    mapToolbarPosition = 'top-right',
    mobileBottomOffsetClass = 'bottom-[92px] lg:bottom-7',
    mobileSheetState = 'partial',
    hasSelectedListing = false,
    hasActiveClusterSummary = false,
    hasHoveredListingPreview = false,
    hasCameraMoved = false,
    isFullscreenMap = false,
    isSplitScreen = false,
    isMobileLandscape = false,
  } = params;

  const isCoDockedWithMapToolbar = position === mapToolbarPosition;
  const isTopShifted =
    (position === 'top-left' &&
      (isFullscreenMap ||
        hasActiveClusterSummary ||
        (!isCollapsed && isCoDockedWithMapToolbar))) ||
    (position === 'top-center' &&
      (hasCameraMoved || isCoDockedWithMapToolbar || hasActiveClusterSummary)) ||
    (position === 'top-right' && !isCollapsed && isCoDockedWithMapToolbar);

  // Compute bottom offset classes for bottom-* positions
  const desktopBottomOverride =
    position === 'bottom-left' &&
    (hasHoveredListingPreview || hasActiveClusterSummary)
      ? 'lg:bottom-28'
      : position === 'bottom-center' && isCoDockedWithMapToolbar
        ? 'lg:bottom-20'
        : '';

  const baseBottomClass = desktopBottomOverride
    ? `${mobileBottomOffsetClass.replace(/lg:bottom-\S+/g, '').trim()} ${desktopBottomOverride}`.trim()
    : mobileBottomOffsetClass;

  let positionClasses = '';
  switch (position) {
    case 'top-left': {
      if (isFullscreenMap) {
        positionClasses = 'top-14 left-2.5';
      } else if (hasActiveClusterSummary) {
        positionClasses = 'top-14 lg:top-2.5 left-2.5';
      } else if (isCoDockedWithMapToolbar) {
        positionClasses = isCollapsed
          ? 'top-2.5 left-14'
          : 'top-14 sm:top-2.5 left-2.5 sm:left-14';
      } else {
        positionClasses = 'top-2.5 left-2.5';
      }
      break;
    }
    case 'top-center': {
      const topOffset =
        hasCameraMoved || isCoDockedWithMapToolbar || hasActiveClusterSummary
          ? 'top-14'
          : 'top-2.5';
      positionClasses = `${topOffset} left-1/2 -translate-x-1/2`;
      break;
    }
    case 'top-right': {
      if (isCoDockedWithMapToolbar) {
        positionClasses = isCollapsed
          ? 'top-2.5 right-14'
          : 'top-14 sm:top-2.5 right-2.5 sm:right-14';
      } else {
        positionClasses = 'top-2.5 right-2.5';
      }
      break;
    }
    case 'bottom-left': {
      const horiz = isCoDockedWithMapToolbar
        ? isCollapsed
          ? 'left-14'
          : 'left-2.5 sm:left-14'
        : 'left-2.5';
      positionClasses = `${baseBottomClass} ${horiz}`;
      break;
    }
    case 'bottom-center': {
      positionClasses = `${baseBottomClass} left-1/2 -translate-x-1/2`;
      break;
    }
    case 'bottom-right': {
      const horiz = isCoDockedWithMapToolbar
        ? isCollapsed
          ? 'right-14'
          : 'right-2.5 sm:right-14'
        : 'right-2.5';
      positionClasses = `${baseBottomClass} ${horiz}`;
      break;
    }
  }

  // Compute viewport-contained max-height classes when expanded
  let maxHeightClasses = '';
  if (isMobileLandscape) {
    maxHeightClasses = isTopShifted
      ? 'max-h-[calc(100%-64px)]'
      : 'max-h-[calc(100%-20px)]';
  } else if (isFullscreenMap) {
    if (hasSelectedListing) {
      maxHeightClasses = isTopShifted
        ? 'max-h-[calc(100%-270px)] sm:max-h-[calc(100%-250px)]'
        : 'max-h-[calc(100%-235px)] sm:max-h-[calc(100%-244px)]';
    } else {
      maxHeightClasses = isTopShifted
        ? 'max-h-[calc(100%-4.5rem)]'
        : 'max-h-[calc(100%-2.5rem)]';
    }
  } else if (isSplitScreen) {
    if (hasSelectedListing) {
      maxHeightClasses = isTopShifted
        ? 'max-h-[calc(100%-256px)]'
        : 'max-h-[calc(100%-240px)]';
    } else {
      maxHeightClasses = isTopShifted
        ? 'max-h-[calc(100%-4.5rem)]'
        : 'max-h-[calc(100%-2.5rem)]';
    }
  } else if (hasSelectedListing) {
    maxHeightClasses = isTopShifted
      ? 'max-h-[calc(100%-345px)] sm:max-h-[calc(100%-325px)] lg:max-h-[calc(100%-256px)]'
      : 'max-h-[calc(100%-300px)] sm:max-h-[calc(100%-316px)] lg:max-h-[calc(100%-248px)]';
  } else if (mobileSheetState === 'expanded') {
    maxHeightClasses =
      'max-h-[calc(20%-10px)] min-h-[96px] lg:max-h-[calc(100%-3.5rem)]';
  } else if (mobileSheetState === 'partial') {
    maxHeightClasses = isTopShifted
      ? 'max-h-[calc(55%-64px)] lg:max-h-[calc(100%-5rem)]'
      : 'max-h-[calc(55%-18px)] lg:max-h-[calc(100%-3.5rem)]';
  } else {
    // mobileSheetState === 'collapsed'
    maxHeightClasses = isTopShifted
      ? 'max-h-[calc(100%-152px)] lg:max-h-[calc(100%-5rem)]'
      : 'max-h-[calc(100%-106px)] lg:max-h-[calc(100%-3.5rem)]';
  }

  const openUpward = position.startsWith('bottom');
  const verticalPopover = openUpward ? 'bottom-full mb-2' : 'top-full mt-2';
  const horizPopover = position.endsWith('right')
    ? 'right-0'
    : position.endsWith('left')
      ? 'left-0'
      : 'left-1/2 -translate-x-1/2';
  const popoverAlignClasses = `${verticalPopover} ${horizPopover}`;

  return {
    positionClasses,
    maxHeightClasses,
    popoverAlignClasses,
    isCoDockedWithMapToolbar,
  };
}

export interface SelectedListingOverlayLayoutParams {
  hasSelectedListing: boolean;
  isFullscreenMap: boolean;
  isDesktopViewport: boolean;
  isDesktopPanelOpen: boolean;
  mobileSheetState: MobileSheetState;
  mapToolbarPosition?: MapToolbarPosition;
  drawToolboxPosition?: MapToolbarPosition;
  isDrawToolboxOpen?: boolean;
  isSplitScreen?: boolean;
  isMobileLandscape?: boolean;
}

export interface SelectedListingOverlayLayoutResult {
  shouldRenderFloatingOverlay: boolean;
  shouldHighlightInSidebar: boolean;
  shouldHighlightInMobileSheet: boolean;
  positionClasses: string;
  showReopenSidebarAction: boolean;
  toolbarBottomOffsetClass: string;
}

/**
 * Step 4A & 4C: Coordinates selected-listing presentation across mobile portrait,
 * mobile landscape (split-screen), tablet portrait (bottom-sheet), tablet landscape (split-screen),
 * and desktop viewports, ensuring visibility in full-screen map mode, collapsed side panel,
 * and collapsed mobile bottom sheet while preventing duplicate cards and toolbar collisions.
 */
export function resolveSelectedListingOverlayLayout(
  params: SelectedListingOverlayLayoutParams
): SelectedListingOverlayLayoutResult {
  const {
    hasSelectedListing,
    isFullscreenMap,
    isDesktopViewport,
    isDesktopPanelOpen,
    mobileSheetState,
    mapToolbarPosition = 'top-right',
    drawToolboxPosition = 'top-left',
    isDrawToolboxOpen = false,
    isSplitScreen,
    isMobileLandscape = false,
  } = params;

  const effectiveSplitScreen =
    isSplitScreen !== undefined ? isSplitScreen : isDesktopViewport;

  const shouldHighlightInSidebar =
    hasSelectedListing &&
    !isFullscreenMap &&
    effectiveSplitScreen &&
    isDesktopPanelOpen;

  const shouldHighlightInMobileSheet =
    hasSelectedListing &&
    !isFullscreenMap &&
    !effectiveSplitScreen &&
    mobileSheetState !== 'collapsed';

  const shouldRenderFloatingOverlay =
    hasSelectedListing &&
    !shouldHighlightInSidebar &&
    !shouldHighlightInMobileSheet;

  const showReopenSidebarAction =
    shouldRenderFloatingOverlay &&
    !isFullscreenMap &&
    effectiveSplitScreen &&
    !isDesktopPanelOpen;

  // Determine if a toolbar is docked at bottom-left on sm+ viewports
  const hasBottomLeftToolbar =
    mapToolbarPosition === 'bottom-left' ||
    (isDrawToolboxOpen && drawToolboxPosition === 'bottom-left');

  // Position classes for the floating selected-listing card inside explore-map-viewport
  let positionClasses = '';
  if (shouldRenderFloatingOverlay) {
    if (isFullscreenMap || effectiveSplitScreen) {
      const verticalClass = isMobileLandscape
        ? 'bottom-2'
        : isFullscreenMap
          ? 'bottom-3'
          : 'bottom-3 lg:bottom-4';
      const horizontalClass = isMobileLandscape
        ? 'left-2.5 right-2.5 sm:left-3 sm:right-auto sm:w-[340px] max-w-[calc(100%-20px)]'
        : 'left-2.5 right-2.5 sm:left-3 sm:right-auto sm:w-[360px] md:w-[380px] max-w-[calc(100%-20px)]';
      positionClasses = `${verticalClass} ${horizontalClass}`;
    } else {
      const verticalClass = 'bottom-[86px] lg:bottom-4';
      const horizontalClass =
        'left-2.5 right-2.5 sm:left-3 sm:right-auto sm:w-[360px] md:w-[380px] max-w-[calc(100%-20px)]';
      positionClasses = `${verticalClass} ${horizontalClass}`;
    }
  }

  // Compute coordinated bottom offset for bottom-docked FloatingMapToolbar & DrawMeasureToolbox
  let toolbarBottomOffsetClass = effectiveSplitScreen
    ? 'bottom-3 lg:bottom-7'
    : 'bottom-[92px] lg:bottom-7';
  if (isFullscreenMap) {
    if (shouldRenderFloatingOverlay) {
      toolbarBottomOffsetClass = hasBottomLeftToolbar
        ? 'bottom-[212px] sm:bottom-[228px] lg:bottom-[228px]'
        : 'bottom-[212px] sm:bottom-7 lg:bottom-7';
    } else {
      toolbarBottomOffsetClass = 'bottom-4 lg:bottom-7';
    }
  } else if (effectiveSplitScreen) {
    if (shouldRenderFloatingOverlay) {
      toolbarBottomOffsetClass = hasBottomLeftToolbar
        ? 'bottom-[192px] lg:bottom-[232px]'
        : 'bottom-3 lg:bottom-7';
    } else {
      toolbarBottomOffsetClass = 'bottom-3 lg:bottom-7';
    }
  } else if (shouldRenderFloatingOverlay) {
    // Portrait bottom-sheet mode with floating overlay visible above collapsed sheet bar
    toolbarBottomOffsetClass = hasBottomLeftToolbar
      ? 'bottom-[284px] sm:bottom-[300px] lg:bottom-[232px]'
      : 'bottom-[284px] sm:bottom-[92px] lg:bottom-7';
  } else if (mobileSheetState === 'collapsed') {
    toolbarBottomOffsetClass = 'bottom-[92px] lg:bottom-7';
  } else if (mobileSheetState === 'partial') {
    toolbarBottomOffsetClass = 'bottom-[43%] lg:bottom-7';
  } else {
    toolbarBottomOffsetClass = 'bottom-[80%] lg:bottom-7';
  }

  return {
    shouldRenderFloatingOverlay,
    shouldHighlightInSidebar,
    shouldHighlightInMobileSheet,
    positionClasses,
    showReopenSidebarAction,
    toolbarBottomOffsetClass,
  };
}

export interface DiscoveryFilterParams {
  searchQuery?: string;
  searchScope?: DiscoverySearchScope;
  appliedViewportBounds?: MapViewportBounds | null;
  selectedCategory?: ListingCategory | 'all';
  selectedPropertyType?: PropertyType | 'all';
  selectedLocality?: string;
  minRating?: number;
  verifiedOnly?: boolean;
  availableOnly?: boolean;
  has360Only?: boolean;
  hasCatalogueOnly?: boolean;
  priceRangeFilter?: 'all' | 'under_1k' | '1k_to_50k' | '50k_to_25l' | 'above_25l';
  activeFilterShape?: DrawnShape | null;
  sortBy?: DiscoverySortOption;
  mapCenter?: LatLngPoint;
}

/**
 * Step 4B: Unified discovery filter & sort engine supporting both:
 * - 'map_area' ("Visible Map Area"): Restricts results to valid coordinates inside appliedViewportBounds.
 * - 'global' ("Entire Directory"): Searches across all published listings with valid coordinates regardless of viewport bounds.
 */
export function filterDiscoveryListings(
  listings: Listing[],
  params: DiscoveryFilterParams
): Listing[] {
  const {
    searchQuery = '',
    searchScope = 'map_area',
    appliedViewportBounds = null,
    selectedCategory = 'all',
    selectedPropertyType = 'all',
    selectedLocality = 'all',
    minRating = 0,
    verifiedOnly = false,
    availableOnly = false,
    has360Only = false,
    hasCatalogueOnly = false,
    priceRangeFilter = 'all',
    activeFilterShape = null,
    sortBy = 'relevance',
    mapCenter = { lat: 24.3335, lng: 93.6978 },
  } = params;

  const q = searchQuery.trim().toLowerCase();

  const filtered = (listings || []).filter((item) => {
    if (!item || item.status !== 'published') return false;
    if (!hasValidListingCoordinates(item)) return false;

    if (selectedCategory !== 'all' && item.category !== selectedCategory) {
      return false;
    }
    if (
      selectedPropertyType !== 'all' &&
      (item.category !== 'real_estate' ||
        item.realEstateDetails?.propertyType !== selectedPropertyType)
    ) {
      return false;
    }
    if (selectedLocality !== 'all' && item.locality !== selectedLocality) {
      return false;
    }
    if (minRating > 0 && item.rating < minRating) {
      return false;
    }
    if (verifiedOnly && item.verificationStatus !== 'verified_demo') {
      return false;
    }
    if (availableOnly) {
      if (
        item.category === 'real_estate' &&
        item.realEstateDetails?.availability !== 'available'
      ) {
        return false;
      }
    }
    if (has360Only) {
      if (
        item.category !== 'real_estate' ||
        !item.realEstateDetails?.panoramas?.length
      ) {
        return false;
      }
    }
    if (hasCatalogueOnly) {
      if (
        item.category !== 'business' ||
        !item.businessDetails?.catalogue?.length
      ) {
        return false;
      }
    }
    if (priceRangeFilter !== 'all') {
      const p = getListingNumericPrice(item);
      if (p === null) return false;
      if (priceRangeFilter === 'under_1k' && p >= 1000) return false;
      if (priceRangeFilter === '1k_to_50k' && (p < 1000 || p > 50000)) {
        return false;
      }
      if (priceRangeFilter === '50k_to_25l' && (p <= 50000 || p > 2500000)) {
        return false;
      }
      if (priceRangeFilter === 'above_25l' && p <= 2500000) return false;
    }
    if (q) {
      const hay =
        `${item.title} ${item.subcategory} ${item.shortDescription} ${item.description} ${item.locality} ${item.address} ${CATEGORY_LABELS[item.category]}`.toLowerCase();
      if (!hay.includes(q)) return false;
    }
    if (
      searchScope === 'map_area' &&
      appliedViewportBounds &&
      !isPointInViewport(item.coordinates, appliedViewportBounds)
    ) {
      return false;
    }
    if (activeFilterShape) {
      if (
        (activeFilterShape.type === 'polygon' ||
          activeFilterShape.type === 'rectangle') &&
        !isPointInsidePolygon(item.coordinates, activeFilterShape.coordinates)
      ) {
        return false;
      }
      if (
        activeFilterShape.type === 'circle' &&
        activeFilterShape.center &&
        activeFilterShape.radiusMeters &&
        !isPointWithinRadius(
          item.coordinates,
          activeFilterShape.center,
          activeFilterShape.radiusMeters
        )
      ) {
        return false;
      }
    }
    return true;
  });

  const seenIds = new Set<string>();
  const deduplicated: Listing[] = [];
  for (const item of filtered) {
    if (!seenIds.has(item.id)) {
      seenIds.add(item.id);
      deduplicated.push(item);
    }
  }

  return deduplicated.sort((a, b) => {
    if (sortBy === 'rating') {
      return b.rating - a.rating || b.reviewCount - a.reviewCount;
    }
    if (sortBy === 'updated') {
      return (
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
      );
    }
    if (sortBy === 'distance') {
      const dA = calculateDistanceMeters(mapCenter, a.coordinates);
      const dB = calculateDistanceMeters(mapCenter, b.coordinates);
      return dA - dB;
    }
    if (sortBy === 'price_asc') {
      const pA = getListingNumericPrice(a) ?? Number.MAX_SAFE_INTEGER;
      const pB = getListingNumericPrice(b) ?? Number.MAX_SAFE_INTEGER;
      return pA - pB;
    }
    if (sortBy === 'price_desc') {
      const pA = getListingNumericPrice(a) ?? -1;
      const pB = getListingNumericPrice(b) ?? -1;
      return pB - pA;
    }
    const featDiff = (b.isFeaturedDemo ? 1 : 0) - (a.isFeaturedDemo ? 1 : 0);
    if (featDiff !== 0) return featDiff;
    return b.rating - a.rating;
  });
}


