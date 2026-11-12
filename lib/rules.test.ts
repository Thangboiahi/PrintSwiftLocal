import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_AREA_UNIT,
  convertFromSqm,
  convertToSqm,
  formatArea,
  shouldShowPlotAndBoundary,
  validatePanoramaScene,
  hasValidMandatoryPanorama,
  calculateListingCompleteness,
  calculatePolygonMetrics,
  calculateLineSegmentsMeters,
  calculateCircleMetrics,
  calculateDistanceMeters,
  translateShapeCoordinates,
  computeClusterSummary,
  getListingNumericPrice,
  isPointInsidePolygon,
  isPointWithinRadius,
  isPointInViewport,
  computeClusterExpansionCamera,
  canAdminPerformAction,
  ADMIN_ROLE_PERMISSIONS,
  resizeRectangleShape,
  canUserCreateListingFromGeometry,
  applyDrawnGeometryToListingDraft,
  extractPreservedPolygonSnapshot,
  applyEditorPropertyTypeChange,
  applyEditorCategoryChange,
  ALL_DOCK_POSITIONS,
  DRAW_TOOLBOX_POSITION_LABELS,
  snapPointerToDockPosition,
  resolveDrawToolboxDockLayout,
  resolveSelectedListingOverlayLayout,
  isValidLatLngPoint,
  hasValidListingCoordinates,
  computeDefaultViewportBounds,
  hasMeaningfulViewportChange,
  filterDiscoveryListings,
  resolveResponsiveLayoutProfile,
  clampSplitListingPercentage,
} from './rules';
import {
  DEFAULT_FALLBACK_MAP_ID,
  PRINTSWIFT_MIDNIGHT_DISCOVERY_STYLE,
  PRINTSWIFT_NEUTRAL_DISCOVERY_STYLE,
  extractCloudStylePalette,
  resolveCloudMapConfiguration,
} from './map-cloud-styles';
import {
  CHURACHANDPUR_SAMPLE_CENTER,
  createInitialListings,
  INITIAL_STAFF_DELEGATIONS,
  INITIAL_USERS,
} from './seed-data';
import { DrawnShape, Listing } from './types';

test('Default area unit is strictly square metres (sqm / m²)', () => {
  assert.equal(DEFAULT_AREA_UNIT, 'sqm');
  assert.equal(formatArea(250), '250 m²');
});

test('Area conversions between m², ft², acres, and hectares preserve canonical m² value', () => {
  const canonicalSqm = 4046.86; // ~1 acre
  const inSqft = convertFromSqm(canonicalSqm, 'sqft');
  assert.ok(Math.abs(inSqft - 43560.04) < 1);

  const inAcres = convertFromSqm(canonicalSqm, 'acre');
  assert.ok(Math.abs(inAcres - 1.0) < 0.001);

  const inHectares = convertFromSqm(10000, 'hectare');
  assert.equal(inHectares, 1);

  const roundTripSqm = convertToSqm(inSqft, 'sqft');
  assert.ok(Math.abs(roundTripSqm - canonicalSqm) < 0.1);
});

test('Conditional property-area rule shows plot/boundary ONLY for plot/land and houses/villas with associated plot', () => {
  assert.equal(shouldShowPlotAndBoundary('plot_land', true), true);
  assert.equal(shouldShowPlotAndBoundary('house_with_plot', true), true);
  assert.equal(shouldShowPlotAndBoundary('villa_with_land', true), true);

  // Must NOT show plot/boundary for house without plot, apartment, room/PG, or commercial without plot
  assert.equal(shouldShowPlotAndBoundary('house_without_plot', false), false);
  assert.equal(shouldShowPlotAndBoundary('house_without_plot', true), false);
  assert.equal(shouldShowPlotAndBoundary('apartment', false), false);
  assert.equal(shouldShowPlotAndBoundary('apartment', true), false);
  assert.equal(shouldShowPlotAndBoundary('room_pg', false), false);
  assert.equal(shouldShowPlotAndBoundary('commercial', false), false);
  assert.equal(shouldShowPlotAndBoundary('commercial', true), true);
});

test('Mandatory 360° panorama validation rejects standard 4:3 photos, non-equirectangular 2:1 crops, and low-resolution graphics, while accepting 2048x1024 equirectangular panoramas', () => {
  const standardPhoto = validatePanoramaScene({
    name: 'Front Photo',
    imageUrl: 'data:image/svg+xml;utf8,<svg></svg>',
    width: 1200,
    height: 900,
    isEquirectangular: false,
  });
  assert.equal(standardPhoto.valid, false);

  // A normal 2:1 cropped banner or decorative graphic without equirectangular projection must NOT qualify
  const croppedBanner = validatePanoramaScene({
    name: 'Cropped 2:1 Banner',
    imageUrl: 'data:image/svg+xml;utf8,<svg></svg>',
    width: 2000,
    height: 1000,
    isEquirectangular: false,
  });
  assert.equal(croppedBanner.valid, false);

  // A low-resolution image (< 1200x600) must NOT qualify
  const lowResPano = validatePanoramaScene({
    name: 'Tiny Thumbnail',
    imageUrl: 'data:image/svg+xml;utf8,<svg></svg>',
    width: 800,
    height: 400,
    isEquirectangular: true,
  });
  assert.equal(lowResPano.valid, false);

  const validPano = validatePanoramaScene({
    name: 'Panorama 1',
    imageUrl: 'data:image/svg+xml;utf8,<svg></svg>',
    width: 2048,
    height: 1024,
    isEquirectangular: true,
  });
  assert.equal(validPano.valid, true);
});

test('All 15 sample real-estate records in seed-data contain valid 2048x1024 2:1 equirectangular 360° panoramas with synthetic demo disclosures', () => {
  const allListings = createInitialListings();
  const realEstateListings = allListings.filter(
    (l) => l.category === 'real_estate'
  );
  assert.equal(realEstateListings.length, 15);
  for (const item of realEstateListings) {
    assert.ok(item.realEstateDetails, `Missing realEstateDetails on ${item.id}`);
    assert.ok(
      item.realEstateDetails.panoramas.length >= 2,
      `Expected at least 2 scenes on ${item.id}`
    );
    assert.equal(hasValidMandatoryPanorama(item), true);
    for (const scene of item.realEstateDetails.panoramas) {
      const check = validatePanoramaScene(scene);
      assert.equal(check.valid, true, `Invalid scene ${scene.id} on ${item.id}`);
      assert.equal(scene.width, 2048);
      assert.equal(scene.height, 1024);
      assert.equal(scene.isEquirectangular, true);
      assert.equal(scene.isSyntheticDemo, true);
    }
  }
});

test('Publication submission is blocked for real-estate without valid 360° panorama, but allowed for businesses without panorama', () => {
  const baseListing: Listing = {
    id: 'test-re-1',
    title: 'Sample Residential Plot at Tuibong',
    category: 'real_estate',
    subcategory: 'Plot / Land',
    shortDescription: 'Sample residential plot for testing.',
    description: 'This is a synthetic sample residential plot located in Tuibong for testing rules.',
    locality: 'Tuibong (Sample Area)',
    address: 'Sample Plot 14, Tuibong Demo Sector',
    coordinates: { lat: 24.342, lng: 93.698 },
    status: 'draft',
    verificationStatus: 'unverified_sample',
    ownerId: 'owner-1',
    ownerName: 'Sample Owner',
    assignedStaffIds: [],
    contactPhone: '+91 90000 00001',
    contactEmail: 'owner1@sample.local',
    coverImage: 'data:image/svg+xml;utf8,<svg></svg>',
    galleryImages: [],
    rating: 4.5,
    reviewCount: 2,
    viewsCount: 10,
    mapImpressionsCount: 25,
    detailVisitsCount: 8,
    followsCount: 2,
    enquiriesCount: 1,
    directionClicksCount: 3,
    updatedAt: '2026-11-01T10:00:00Z',
    createdAt: '2026-10-25T10:00:00Z',
    versionHistory: [],
    realEstateDetails: {
      propertyType: 'plot_land',
      hasAssociatedPlot: true,
      availability: 'available',
      askingPrice: 1850000,
      priceLabel: '₹18.50 Lakhs (Sample)',
      plotAreaSqm: 450,
      utilities: ['Water', 'Electricity'],
      amenities: ['Road Access'],
      panoramas: [],
      streetViewAvailable: false,
    },
  };

  assert.equal(hasValidMandatoryPanorama(baseListing), false);
  const incompleteReport = calculateListingCompleteness(baseListing);
  assert.equal(incompleteReport.canSubmitForPublication, false);
  assert.ok(incompleteReport.blockerMessage?.includes('360°'));

  // Add valid panorama
  baseListing.realEstateDetails!.panoramas = [
    {
      id: 'pano-1',
      name: 'Panorama 1',
      imageUrl: 'data:image/svg+xml;utf8,<svg></svg>',
      isPrimary: true,
      order: 1,
      width: 2048,
      height: 1024,
      isEquirectangular: true,
      isSyntheticDemo: true,
    },
  ];
  assert.equal(hasValidMandatoryPanorama(baseListing), true);
  const completeReport = calculateListingCompleteness(baseListing);
  assert.equal(completeReport.canSubmitForPublication, true);

  // Business listing does NOT require panorama
  const businessListing: Listing = {
    ...baseListing,
    id: 'test-biz-1',
    category: 'business',
    realEstateDetails: undefined,
    businessDetails: {
      subcategory: 'Bookstore & Stationery',
      openingHours: '09:00 AM – 07:00 PM',
      priceRange: '₹₹',
      deliveryInfo: 'In-store pickup only (Demo)',
      establishedYear: 2019,
      highlights: ['Sample Catalogue'],
      catalogue: [
        {
          id: 'prod-1',
          listingId: 'test-biz-1',
          name: 'Sample Notebook Pack',
          category: 'Stationery',
          description: 'Synthetic product item',
          price: 240,
          variants: ['A4', 'A5'],
          availability: 'in_stock',
          imageUrl: 'data:image/svg+xml;utf8,<svg></svg>',
        },
      ],
    },
  };
  assert.equal(hasValidMandatoryPanorama(businessListing), true);
  assert.equal(calculateListingCompleteness(businessListing).canSubmitForPublication, true);
});

test('Geospatial calculations compute polygon area (m²), perimeter (m), and spatial filters accurately', () => {
  // ~100m x 100m square near Churachandpur (24.333, 93.698)
  const poly = [
    { lat: 24.333, lng: 93.698 },
    { lat: 24.333, lng: 93.699 },
    { lat: 24.334, lng: 93.699 },
    { lat: 24.334, lng: 93.698 },
  ];
  const metrics = calculatePolygonMetrics(poly);
  assert.equal(metrics.isValid, true);
  assert.ok(metrics.areaSqm > 9000 && metrics.areaSqm < 13000);
  assert.ok(metrics.perimeterMeters > 380 && metrics.perimeterMeters < 460);

  const insidePoint = { lat: 24.3335, lng: 93.6985 };
  const outsidePoint = { lat: 24.35, lng: 93.72 };
  assert.equal(isPointInsidePolygon(insidePoint, poly), true);
  assert.equal(isPointInsidePolygon(outsidePoint, poly), false);

  assert.equal(isPointWithinRadius(insidePoint, poly[0], 200), true);
  assert.equal(isPointWithinRadius(outsidePoint, poly[0], 200), false);

  assert.equal(
    isPointInViewport(insidePoint, {
      north: 24.34,
      south: 24.33,
      east: 93.7,
      west: 93.69,
    }),
    true
  );
});

test('Cluster expansion camera calculation computes geographic bounds and zooms in to de-cluster markers without selecting an individual listing', () => {
  const clusterItems = [
    { coordinates: { lat: 24.332, lng: 93.696 } },
    { coordinates: { lat: 24.334, lng: 93.698 } },
    { coordinates: { lat: 24.333, lng: 93.697 } },
  ];
  const expansion = computeClusterExpansionCamera(clusterItems, 12);
  assert.ok(expansion.zoom >= 14, 'Expected cluster expansion zoom to reach >= 14');
  assert.ok(expansion.bounds.north > 24.334);
  assert.ok(expansion.bounds.south < 24.332);
  assert.ok(expansion.bounds.east > 93.698);
  assert.ok(expansion.bounds.west < 93.696);
  assert.ok(Math.abs(expansion.center.lat - 24.333) < 0.001);
  assert.ok(Math.abs(expansion.center.lng - 93.697) < 0.001);
});

test('Least-privilege administrative permission matrix enforces role-specific restrictions across all 7 demonstration admin roles', () => {
  const adminUsers = INITIAL_USERS.filter((u) => u.roleType === 'admin');
  assert.equal(adminUsers.length, 7);

  const superAdmin = adminUsers.find((u) => u.adminRole === 'super_admin')!;
  const listingMod = adminUsers.find((u) => u.adminRole === 'listing_moderator')!;
  const verifOfficer = adminUsers.find((u) => u.adminRole === 'verification_officer')!;
  const communityMod = adminUsers.find((u) => u.adminRole === 'community_moderator')!;
  const supportAdmin = adminUsers.find((u) => u.adminRole === 'customer_support')!;
  const financeAdmin = adminUsers.find((u) => u.adminRole === 'finance_admin')!;
  const analyticsViewer = adminUsers.find((u) => u.adminRole === 'analytics_viewer')!;

  // Super Admin has all 7 permissions
  assert.equal(ADMIN_ROLE_PERMISSIONS.super_admin.length, 7);
  assert.equal(canAdminPerformAction(superAdmin, 'manage_users'), true);
  assert.equal(canAdminPerformAction(superAdmin, 'manage_schema'), true);

  // Listing Moderator can manage listings & geography, but NOT users or verification
  assert.equal(canAdminPerformAction(listingMod, 'manage_listings'), true);
  assert.equal(canAdminPerformAction(listingMod, 'manage_geography'), true);
  assert.equal(canAdminPerformAction(listingMod, 'manage_users'), false);
  assert.equal(canAdminPerformAction(listingMod, 'manage_verification'), false);

  // Verification Officer can manage verification only
  assert.equal(canAdminPerformAction(verifOfficer, 'manage_verification'), true);
  assert.equal(canAdminPerformAction(verifOfficer, 'manage_listings'), false);
  assert.equal(canAdminPerformAction(verifOfficer, 'manage_moderation'), false);

  // Community Moderator can manage moderation only
  assert.equal(canAdminPerformAction(communityMod, 'manage_moderation'), true);
  assert.equal(canAdminPerformAction(communityMod, 'manage_listings'), false);
  assert.equal(canAdminPerformAction(communityMod, 'manage_users'), false);

  // Customer Support can manage listings (assist owners), but NOT users, schema, or settings
  assert.equal(canAdminPerformAction(supportAdmin, 'manage_listings'), true);
  assert.equal(canAdminPerformAction(supportAdmin, 'manage_users'), false);
  assert.equal(canAdminPerformAction(supportAdmin, 'manage_schema'), false);
  assert.equal(canAdminPerformAction(supportAdmin, 'manage_settings'), false);

  // Finance Admin can manage settings/commercial tiers only
  assert.equal(canAdminPerformAction(financeAdmin, 'manage_settings'), true);
  assert.equal(canAdminPerformAction(financeAdmin, 'manage_listings'), false);
  assert.equal(canAdminPerformAction(financeAdmin, 'manage_users'), false);

  // Analytics Viewer is strictly read-only (0 mutation permissions)
  assert.equal(ADMIN_ROLE_PERMISSIONS.analytics_viewer.length, 0);
  for (const perm of ADMIN_ROLE_PERMISSIONS.super_admin) {
    assert.equal(
      canAdminPerformAction(analyticsViewer, perm),
      false,
      `analytics_viewer must not have ${perm}`
    );
  }
});

test('Cloud-based map styling resolves PrintSwift Neutral Discovery (light) and PrintSwift Midnight Discovery (dark) independently with configurable Map IDs and map types', () => {
  // 1. Light appearance with default fallback Map ID
  const lightRoadmap = resolveCloudMapConfiguration({
    mapStyle: 'roadmap',
    mapAppearance: 'light',
    configuredMapId: '',
  });
  assert.equal(lightRoadmap.variant, 'light');
  assert.equal(lightRoadmap.colorScheme, 'LIGHT');
  assert.equal(lightRoadmap.mapTypeId, 'roadmap');
  assert.equal(lightRoadmap.mapId, DEFAULT_FALLBACK_MAP_ID);
  assert.equal(lightRoadmap.isFallbackDemoMapId, true);
  assert.equal(lightRoadmap.backgroundColor, '#F7F8F6');
  assert.equal(lightRoadmap.styleSpec.metadata.name, 'PrintSwift Neutral Discovery');
  assert.equal(lightRoadmap.styleSpec.styles.length, 20);

  // 2. Dark appearance with custom dark Map ID
  const darkRoadmap = resolveCloudMapConfiguration({
    mapStyle: 'dark',
    mapAppearance: 'dark',
    configuredMapId: 'PRIMARY_MAP_ID_123',
    configuredLightMapId: 'LIGHT_MAP_ID_456',
    configuredDarkMapId: 'DARK_MAP_ID_789',
  });
  assert.equal(darkRoadmap.variant, 'dark');
  assert.equal(darkRoadmap.colorScheme, 'DARK');
  assert.equal(darkRoadmap.mapTypeId, 'roadmap');
  assert.equal(darkRoadmap.mapId, 'DARK_MAP_ID_789');
  assert.equal(darkRoadmap.isFallbackDemoMapId, false);
  assert.equal(darkRoadmap.backgroundColor, '#171D1A');
  assert.equal(darkRoadmap.styleSpec.metadata.name, 'PrintSwift Midnight Discovery');
  assert.equal(darkRoadmap.styleSpec.styles.length, 20);

  // 3. Satellite, Hybrid, and Terrain preserve independent light/dark colorScheme and custom Map ID
  for (const mapType of ['satellite', 'hybrid', 'terrain'] as const) {
    const resolved = resolveCloudMapConfiguration({
      mapStyle: mapType,
      mapAppearance: 'dark',
      configuredMapId: 'CUSTOM_SHARED_MAP_ID',
    });
    assert.equal(resolved.mapTypeId, mapType);
    assert.equal(resolved.colorScheme, 'DARK');
    assert.equal(resolved.variant, 'dark');
    assert.equal(resolved.mapId, 'CUSTOM_SHARED_MAP_ID');
    assert.equal(resolved.backgroundColor, '#171D1A');
  }

  // 4. Extracted 20-rule palettes match supplied JSON specifications
  const lightPalette = extractCloudStylePalette(PRINTSWIFT_NEUTRAL_DISCOVERY_STYLE);
  assert.equal(lightPalette.backgroundColor, '#F7F8F6');
  assert.equal(lightPalette.landFill, '#F4F6F2');
  assert.equal(lightPalette.waterFill, '#DCEAF0');
  assert.equal(lightPalette.roadHighwayStroke, '#E7C39A');
  assert.equal(lightPalette.poiPinFill, '#9AA59E');

  const darkPalette = extractCloudStylePalette(PRINTSWIFT_MIDNIGHT_DISCOVERY_STYLE);
  assert.equal(darkPalette.backgroundColor, '#171D1A');
  assert.equal(darkPalette.landFill, '#1D2521');
  assert.equal(darkPalette.waterFill, '#172F39');
  assert.equal(darkPalette.roadHighwayStroke, '#806447');
  assert.equal(darkPalette.poiPinFill, '#77887F');
});

test('Round 02 Draw & Measure: Line segment lengths, circle diameter/circumference/area (m²), and shape coordinate translation work accurately', () => {
  const linePts = [
    { lat: 24.333, lng: 93.698 },
    { lat: 24.334, lng: 93.698 },
    { lat: 24.334, lng: 93.699 },
  ];
  const segResult = calculateLineSegmentsMeters(linePts);
  assert.equal(segResult.segments.length, 2);
  assert.ok(segResult.segments[0] > 100 && segResult.segments[0] < 120);
  assert.ok(segResult.segments[1] > 95 && segResult.segments[1] < 115);
  assert.equal(
    segResult.totalMeters,
    Number((segResult.segments[0] + segResult.segments[1]).toFixed(2))
  );

  const circle = calculateCircleMetrics(100);
  assert.equal(circle.radiusMeters, 100);
  assert.equal(circle.diameterMeters, 200);
  assert.ok(Math.abs(circle.circumferenceMeters - 628.32) < 0.05);
  assert.ok(Math.abs(circle.areaSqm - 31415.93) < 0.05);

  const shifted = translateShapeCoordinates(
    {
      id: 'pt-1',
      type: 'point',
      label: 'Custom Marker',
      coordinates: [{ lat: 24.333, lng: 93.698 }],
      center: { lat: 24.333, lng: 93.698 },
      createdAt: '2026-11-07T00:00:00Z',
    },
    0.001,
    -0.001
  );
  assert.equal(shifted.coordinates[0].lat, 24.334);
  assert.equal(shifted.coordinates[0].lng, 93.697);
  assert.equal(shifted.center?.lat, 24.334);
});

test('Round 02 Cluster Hover Summary dynamically computes count, category breakdown, 3 representative names, and price range from actual cluster items', () => {
  const allListings = createInitialListings();
  const sampleSlice = allListings.slice(0, 6);
  const summary = computeClusterSummary(sampleSlice);

  assert.equal(summary.count, 6);
  assert.equal(summary.representativeNames.length, 3);
  assert.equal(summary.representativeNames[0], sampleSlice[0].title);
  assert.equal(summary.representativeNames[1], sampleSlice[1].title);
  assert.equal(summary.representativeNames[2], sampleSlice[2].title);

  const totalBreakdown = Object.values(summary.categoryBreakdown).reduce(
    (acc, n) => acc + n,
    0
  );
  assert.equal(totalBreakdown, 6);
  assert.ok(summary.priceRangeLabel && summary.priceRangeLabel.includes('₹'));

  const dist = calculateDistanceMeters(
    sampleSlice[0].coordinates,
    sampleSlice[1].coordinates
  );
  assert.ok(Number.isFinite(dist) && dist >= 0);
  assert.ok(getListingNumericPrice(sampleSlice[0]) !== undefined);
});

test('Refinement Part 3: Rectangle orthogonal resize recomputes area (m²) and perimeter accurately', () => {
  const rectCoords = [
    { lat: 24.334, lng: 93.697 },
    { lat: 24.334, lng: 93.699 },
    { lat: 24.332, lng: 93.699 },
    { lat: 24.332, lng: 93.697 },
  ];
  const initialMetrics = calculatePolygonMetrics(rectCoords);
  const rectShape: DrawnShape = {
    id: 'rect-1',
    type: 'rectangle',
    label: 'Rectangle #1',
    coordinates: rectCoords,
    areaSqm: initialMetrics.areaSqm,
    perimeterMeters: initialMetrics.perimeterMeters,
    createdAt: '2026-11-07T00:00:00Z',
  };

  const expanded = resizeRectangleShape(rectShape, 1.25, 1.25);
  assert.equal(expanded.coordinates.length, 4);
  assert.ok((expanded.areaSqm || 0) > (rectShape.areaSqm || 0) * 1.4);
  assert.ok((expanded.perimeterMeters || 0) > (rectShape.perimeterMeters || 0) * 1.2);
});

test('Refinement Part 3: Role-aware listing creation permission enforces Visitor, Owner, Staff Delegation, and Admin role boundaries', () => {
  const visitor = INITIAL_USERS.find((u) => u.id === 'visitor-demo')!;
  const owner1 = INITIAL_USERS.find((u) => u.id === 'owner-1')!;
  const owner2 = INITIAL_USERS.find((u) => u.id === 'owner-2')!;
  const staff1 = INITIAL_USERS.find((u) => u.id === 'staff-1')!; // Has 'edit_details'
  const staff2 = INITIAL_USERS.find((u) => u.id === 'staff-2')!; // No 'edit_details'
  const superAdmin = INITIAL_USERS.find((u) => u.adminRole === 'super_admin')!;
  const listingMod = INITIAL_USERS.find((u) => u.adminRole === 'listing_moderator')!;
  const supportAdmin = INITIAL_USERS.find((u) => u.adminRole === 'customer_support')!;
  const verifOfficer = INITIAL_USERS.find((u) => u.adminRole === 'verification_officer')!;
  const communityMod = INITIAL_USERS.find((u) => u.adminRole === 'community_moderator')!;
  const financeAdmin = INITIAL_USERS.find((u) => u.adminRole === 'finance_admin')!;
  const analyticsViewer = INITIAL_USERS.find((u) => u.adminRole === 'analytics_viewer')!;

  // Visitor cannot create listings even when drawing shapes
  assert.equal(
    canUserCreateListingFromGeometry(visitor, INITIAL_STAFF_DELEGATIONS).allowed,
    false
  );

  // Active Owners can create listings
  assert.equal(
    canUserCreateListingFromGeometry(owner1, INITIAL_STAFF_DELEGATIONS).allowed,
    true
  );
  assert.equal(
    canUserCreateListingFromGeometry(owner2, INITIAL_STAFF_DELEGATIONS).allowed,
    true
  );

  // Staff-1 has 'edit_details' delegation -> allowed
  const s1Perm = canUserCreateListingFromGeometry(staff1, INITIAL_STAFF_DELEGATIONS);
  assert.equal(s1Perm.allowed, true);
  assert.equal(s1Perm.ownerId, 'owner-1');

  // Staff-2 only has catalogue/enquiries/analytics -> NOT allowed
  assert.equal(
    canUserCreateListingFromGeometry(staff2, INITIAL_STAFF_DELEGATIONS).allowed,
    false
  );

  // Admins with 'manage_listings' are allowed; read-only / other admins are blocked
  assert.equal(
    canUserCreateListingFromGeometry(superAdmin, INITIAL_STAFF_DELEGATIONS).allowed,
    true
  );
  assert.equal(
    canUserCreateListingFromGeometry(listingMod, INITIAL_STAFF_DELEGATIONS).allowed,
    true
  );
  assert.equal(
    canUserCreateListingFromGeometry(supportAdmin, INITIAL_STAFF_DELEGATIONS).allowed,
    true
  );
  assert.equal(
    canUserCreateListingFromGeometry(verifOfficer, INITIAL_STAFF_DELEGATIONS).allowed,
    false
  );
  assert.equal(
    canUserCreateListingFromGeometry(communityMod, INITIAL_STAFF_DELEGATIONS).allowed,
    false
  );
  assert.equal(
    canUserCreateListingFromGeometry(financeAdmin, INITIAL_STAFF_DELEGATIONS).allowed,
    false
  );
  assert.equal(
    canUserCreateListingFromGeometry(analyticsViewer, INITIAL_STAFF_DELEGATIONS).allowed,
    false
  );
});

test('Refinement Part 3: applyDrawnGeometryToListingDraft maps Point, Polygon, Rectangle, Circle, and Line accurately while enforcing conditional real-estate plot rules and draft status', () => {
  const owner = INITIAL_USERS.find((u) => u.id === 'owner-1')!;
  const visitor = INITIAL_USERS.find((u) => u.id === 'visitor-demo')!;

  // 1. Visitor is blocked
  const pointShape: DrawnShape = {
    id: 'pt-10',
    type: 'point',
    label: 'Lamka Craft Studio',
    description: 'Handwoven textiles and bamboo crafts near Tedim Road.',
    coordinates: [{ lat: 24.3351, lng: 93.6982 }],
    center: { lat: 24.3351, lng: 93.6982 },
    createdAt: '2026-11-07T00:00:00Z',
  };
  assert.equal(
    applyDrawnGeometryToListingDraft({
      shape: pointShape,
      category: 'business',
      user: visitor,
      staffDelegations: INITIAL_STAFF_DELEGATIONS,
    }).ok,
    false
  );

  // 2. Point -> prefills coordinates, title, description; status is 'draft'
  const ptRes = applyDrawnGeometryToListingDraft({
    shape: pointShape,
    category: 'business',
    user: owner,
    staffDelegations: INITIAL_STAFF_DELEGATIONS,
  });
  assert.equal(ptRes.ok, true);
  assert.equal(ptRes.draft?.status, 'draft');
  assert.equal(ptRes.draft?.verificationStatus, 'unverified_sample');
  assert.equal(ptRes.draft?.title, 'Lamka Craft Studio');
  assert.equal(ptRes.draft?.coordinates.lat, 24.3351);
  assert.equal(ptRes.draft?.coordinates.lng, 93.6982);
  assert.equal(ptRes.draft?.realEstateDetails, undefined);

  // 3. Polygon -> Real Estate with eligible propertyType ('plot_land' or 'house_with_plot') receives boundaryPolygon & plotAreaSqm
  const polyCoords = [
    { lat: 24.333, lng: 93.698 },
    { lat: 24.333, lng: 93.699 },
    { lat: 24.334, lng: 93.699 },
    { lat: 24.334, lng: 93.698 },
  ];
  const polyMetrics = calculatePolygonMetrics(polyCoords);
  const polyShape: DrawnShape = {
    id: 'poly-10',
    type: 'polygon',
    label: 'Tuibong Corner Plot',
    coordinates: polyCoords,
    areaSqm: polyMetrics.areaSqm,
    perimeterMeters: polyMetrics.perimeterMeters,
    createdAt: '2026-11-07T00:00:00Z',
  };

  const reWithPlot = applyDrawnGeometryToListingDraft({
    shape: polyShape,
    category: 'real_estate',
    propertyType: 'plot_land',
    user: owner,
    staffDelegations: INITIAL_STAFF_DELEGATIONS,
  });
  assert.equal(reWithPlot.ok, true);
  assert.equal(reWithPlot.draft?.status, 'draft');
  assert.equal(
    reWithPlot.draft?.realEstateDetails?.boundaryPolygon?.length,
    4
  );
  assert.equal(
    reWithPlot.draft?.realEstateDetails?.plotAreaSqm,
    polyMetrics.areaSqm
  );
  // Real estate draft without 360° panorama cannot be submitted for publication yet
  assert.equal(
    calculateListingCompleteness(reWithPlot.draft!).canSubmitForPublication,
    false
  );

  // 4. Polygon -> Real Estate with 'apartment' or 'house_without_plot' MUST NOT receive plot polygon or plotAreaSqm
  for (const nonPlotType of ['apartment', 'house_without_plot', 'room_pg'] as const) {
    const reNoPlot = applyDrawnGeometryToListingDraft({
      shape: polyShape,
      category: 'real_estate',
      propertyType: nonPlotType,
      user: owner,
      staffDelegations: INITIAL_STAFF_DELEGATIONS,
    });
    assert.equal(reNoPlot.ok, true);
    assert.equal(
      reNoPlot.draft?.realEstateDetails?.boundaryPolygon,
      undefined,
      `${nonPlotType} must not receive boundaryPolygon`
    );
    assert.equal(
      reNoPlot.draft?.realEstateDetails?.plotAreaSqm,
      undefined,
      `${nonPlotType} must not receive plotAreaSqm`
    );
  }

  // 5. Circle -> Service category prefills coverage radius & centre
  const cirMetrics = calculateCircleMetrics(450);
  const circleShape: DrawnShape = {
    id: 'cir-10',
    type: 'circle',
    label: 'Mobile Solar Repair Zone',
    coordinates: [{ lat: 24.336, lng: 93.701 }],
    center: { lat: 24.336, lng: 93.701 },
    ...cirMetrics,
    createdAt: '2026-11-07T00:00:00Z',
  };
  const srvCircle = applyDrawnGeometryToListingDraft({
    shape: circleShape,
    category: 'service',
    user: owner,
    staffDelegations: INITIAL_STAFF_DELEGATIONS,
  });
  assert.equal(srvCircle.ok, true);
  assert.equal(srvCircle.draft?.coordinates.lat, 24.336);
  assert.ok(
    srvCircle.draft?.serviceDetails?.areasServed.some((a) =>
      a.includes('450m radius')
    )
  );
  assert.equal(srvCircle.draft?.customFields?.serviceCoverageRadiusMeters, 450);

  // 6. Line -> Preserved as route reference, NEVER interpreted as a property boundary
  const linePts = [
    { lat: 24.333, lng: 93.698 },
    { lat: 24.334, lng: 93.698 },
    { lat: 24.335, lng: 93.699 },
  ];
  const lineSegs = calculateLineSegmentsMeters(linePts);
  const lineShape: DrawnShape = {
    id: 'line-10',
    type: 'line',
    label: 'Tedim Approach Corridor',
    coordinates: linePts,
    distanceMeters: lineSegs.totalMeters,
    segmentDistancesMeters: lineSegs.segments,
    createdAt: '2026-11-07T00:00:00Z',
  };
  const reFromLine = applyDrawnGeometryToListingDraft({
    shape: lineShape,
    category: 'real_estate',
    propertyType: 'plot_land',
    user: owner,
    staffDelegations: INITIAL_STAFF_DELEGATIONS,
  });
  assert.equal(reFromLine.ok, true);
  assert.equal(
    reFromLine.draft?.realEstateDetails?.boundaryPolygon,
    undefined,
    'Line must never be interpreted as a property boundary'
  );
  assert.equal(
    reFromLine.draft?.realEstateDetails?.plotAreaSqm,
    undefined,
    'Line must never populate plotAreaSqm'
  );
  assert.ok(
    reFromLine.draft?.realEstateDetails?.roadAccess?.includes(
      String(lineSegs.totalMeters.toFixed(1))
    )
  );
});

test('Preserves drawn polygon coordinates and canonical m² area across property-type toggles while stripping non-plot types', () => {
  const owner = INITIAL_USERS.find((u) => u.id === 'owner-1')!;
  const drawnVertices = [
    { lat: 24.3325, lng: 93.6975 },
    { lat: 24.3325, lng: 93.6989 },
    { lat: 24.3338, lng: 93.6992 },
    { lat: 24.3341, lng: 93.6979 },
    { lat: 24.3332, lng: 93.6972 },
  ];
  const expectedMetrics = calculatePolygonMetrics(drawnVertices);
  const polyShape: DrawnShape = {
    id: 'poly-toggle-1',
    type: 'polygon',
    label: 'Zoveng 5-Vertex Homestead',
    coordinates: drawnVertices,
    areaSqm: expectedMetrics.areaSqm,
    perimeterMeters: expectedMetrics.perimeterMeters,
    createdAt: '2026-11-08T00:00:00Z',
  };

  // Start as plot_land -> receives exact 5 vertices & canonical m² area
  const initialRes = applyDrawnGeometryToListingDraft({
    shape: polyShape,
    category: 'real_estate',
    propertyType: 'plot_land',
    user: owner,
    staffDelegations: INITIAL_STAFF_DELEGATIONS,
  });
  assert.equal(initialRes.ok, true);
  let draft = initialRes.draft!;
  assert.deepEqual(draft.realEstateDetails?.boundaryPolygon, drawnVertices);
  assert.equal(draft.realEstateDetails?.plotAreaSqm, expectedMetrics.areaSqm);

  // Toggle to apartment -> must strip boundaryPolygon and plotAreaSqm
  draft = applyEditorPropertyTypeChange(draft, 'apartment');
  assert.equal(draft.realEstateDetails?.propertyType, 'apartment');
  assert.equal(draft.realEstateDetails?.boundaryPolygon, undefined);
  assert.equal(draft.realEstateDetails?.plotAreaSqm, undefined);

  // Toggle to house_with_plot -> must restore exact 5 drawn vertices & canonical m² area (never synthetic 4-vertex 250 m² box)
  draft = applyEditorPropertyTypeChange(draft, 'house_with_plot');
  assert.equal(draft.realEstateDetails?.propertyType, 'house_with_plot');
  assert.deepEqual(draft.realEstateDetails?.boundaryPolygon, drawnVertices);
  assert.equal(draft.realEstateDetails?.plotAreaSqm, expectedMetrics.areaSqm);

  // Toggle to house_without_plot -> must strip boundaryPolygon and plotAreaSqm
  draft = applyEditorPropertyTypeChange(draft, 'house_without_plot');
  assert.equal(draft.realEstateDetails?.propertyType, 'house_without_plot');
  assert.equal(draft.realEstateDetails?.boundaryPolygon, undefined);
  assert.equal(draft.realEstateDetails?.plotAreaSqm, undefined);

  // Toggle to villa_with_land -> must restore exact 5 drawn vertices & canonical m² area
  draft = applyEditorPropertyTypeChange(draft, 'villa_with_land');
  assert.equal(draft.realEstateDetails?.propertyType, 'villa_with_land');
  assert.deepEqual(draft.realEstateDetails?.boundaryPolygon, drawnVertices);
  assert.equal(draft.realEstateDetails?.plotAreaSqm, expectedMetrics.areaSqm);

  // Toggle to room_pg -> must strip boundaryPolygon and plotAreaSqm
  draft = applyEditorPropertyTypeChange(draft, 'room_pg');
  assert.equal(draft.realEstateDetails?.propertyType, 'room_pg');
  assert.equal(draft.realEstateDetails?.boundaryPolygon, undefined);
  assert.equal(draft.realEstateDetails?.plotAreaSqm, undefined);

  // Toggle to commercial WITHOUT plot -> must remain stripped
  draft = applyEditorPropertyTypeChange(draft, 'commercial', false);
  assert.equal(draft.realEstateDetails?.propertyType, 'commercial');
  assert.equal(draft.realEstateDetails?.hasAssociatedPlot, false);
  assert.equal(draft.realEstateDetails?.boundaryPolygon, undefined);
  assert.equal(draft.realEstateDetails?.plotAreaSqm, undefined);

  // Toggle to commercial WITH plot -> must restore exact 5 drawn vertices & canonical m² area
  draft = applyEditorPropertyTypeChange(draft, 'commercial', true);
  assert.equal(draft.realEstateDetails?.propertyType, 'commercial');
  assert.equal(draft.realEstateDetails?.hasAssociatedPlot, true);
  assert.deepEqual(draft.realEstateDetails?.boundaryPolygon, drawnVertices);
  assert.equal(draft.realEstateDetails?.plotAreaSqm, expectedMetrics.areaSqm);
});

test('Preserves drawn polygon coordinates and canonical m² area across category switches and when initially created under non-plot types', () => {
  const staff = INITIAL_USERS.find((u) => u.id === 'staff-1')!;
  const rectVertices = [
    { lat: 24.331, lng: 93.696 },
    { lat: 24.331, lng: 93.6972 },
    { lat: 24.332, lng: 93.6972 },
    { lat: 24.332, lng: 93.696 },
  ];
  const rectMetrics = calculatePolygonMetrics(rectVertices);
  const rectShape: DrawnShape = {
    id: 'rect-cat-1',
    type: 'rectangle',
    label: 'New Lamka Commercial Block',
    coordinates: rectVertices,
    areaSqm: rectMetrics.areaSqm,
    perimeterMeters: rectMetrics.perimeterMeters,
    createdAt: '2026-11-08T00:00:00Z',
  };

  // Case A: Created initially as 'business' -> no realEstateDetails yet, but snapshot preserved
  const bizRes = applyDrawnGeometryToListingDraft({
    shape: rectShape,
    category: 'business',
    user: staff,
    staffDelegations: INITIAL_STAFF_DELEGATIONS,
  });
  assert.equal(bizRes.ok, true);
  let draft = bizRes.draft!;
  assert.equal(draft.realEstateDetails, undefined);
  assert.ok(extractPreservedPolygonSnapshot(draft) !== null);

  // Switch category from 'business' -> 'real_estate' -> restores exact rectangle vertices & canonical m² area
  draft = applyEditorCategoryChange(draft, 'real_estate');
  assert.equal(draft.category, 'real_estate');
  assert.deepEqual(draft.realEstateDetails?.boundaryPolygon, rectVertices);
  assert.equal(draft.realEstateDetails?.plotAreaSqm, rectMetrics.areaSqm);

  // Switch category to 'service' and back to 'real_estate' -> still preserves exact vertices & m² area
  draft = applyEditorCategoryChange(draft, 'service');
  assert.equal(draft.category, 'service');
  draft = applyEditorCategoryChange(draft, 'real_estate');
  assert.equal(draft.category, 'real_estate');
  assert.deepEqual(draft.realEstateDetails?.boundaryPolygon, rectVertices);
  assert.equal(draft.realEstateDetails?.plotAreaSqm, rectMetrics.areaSqm);

  // Case B: Created initially as 'real_estate' with 'apartment' -> apartment has no boundary, but switching to 'plot_land' restores it
  const aptRes = applyDrawnGeometryToListingDraft({
    shape: rectShape,
    category: 'real_estate',
    propertyType: 'apartment',
    user: staff,
    staffDelegations: INITIAL_STAFF_DELEGATIONS,
  });
  assert.equal(aptRes.ok, true);
  let aptDraft = aptRes.draft!;
  assert.equal(aptDraft.realEstateDetails?.boundaryPolygon, undefined);
  assert.equal(aptDraft.realEstateDetails?.plotAreaSqm, undefined);

  aptDraft = applyEditorPropertyTypeChange(aptDraft, 'plot_land');
  assert.deepEqual(aptDraft.realEstateDetails?.boundaryPolygon, rectVertices);
  assert.equal(aptDraft.realEstateDetails?.plotAreaSqm, rectMetrics.areaSqm);
});

test('Non-polygon geometries (point, line, circle) never fabricate a boundary polygon across category or property-type changes', () => {
  const owner = INITIAL_USERS.find((u) => u.id === 'owner-1')!;
  const pointShape: DrawnShape = {
    id: 'pt-no-poly',
    type: 'point',
    label: 'Lamka Retail Pin',
    coordinates: [{ lat: 24.335, lng: 93.698 }],
    createdAt: '2026-11-08T00:00:00Z',
  };

  const ptDraftRes = applyDrawnGeometryToListingDraft({
    shape: pointShape,
    category: 'business',
    user: owner,
    staffDelegations: INITIAL_STAFF_DELEGATIONS,
  });
  let draft = ptDraftRes.draft!;

  // Switch category to real_estate -> must not fabricate boundaryPolygon or plotAreaSqm
  draft = applyEditorCategoryChange(draft, 'real_estate');
  assert.equal(draft.realEstateDetails?.boundaryPolygon, undefined);
  assert.equal(draft.realEstateDetails?.plotAreaSqm, undefined);

  // Switch propertyType to plot_land or villa_with_land -> still must not fabricate boundaryPolygon
  draft = applyEditorPropertyTypeChange(draft, 'plot_land');
  assert.equal(draft.realEstateDetails?.boundaryPolygon, undefined);
  assert.equal(draft.realEstateDetails?.plotAreaSqm, undefined);

  draft = applyEditorPropertyTypeChange(draft, 'villa_with_land');
  assert.equal(draft.realEstateDetails?.boundaryPolygon, undefined);
  assert.equal(draft.realEstateDetails?.plotAreaSqm, undefined);
});

test('Step 3A: snapPointerToDockPosition maps viewport quadrants to all 6 docking zones and resolveDrawToolboxDockLayout prevents collisions', () => {
  assert.equal(ALL_DOCK_POSITIONS.length, 6);
  assert.equal(DRAW_TOOLBOX_POSITION_LABELS['top-center'], 'Top Centre');
  assert.equal(DRAW_TOOLBOX_POSITION_LABELS['bottom-center'], 'Bottom Centre');

  // Verify all 6 docking quadrants
  assert.equal(snapPointerToDockPosition(0.1, 0.2), 'top-left');
  assert.equal(snapPointerToDockPosition(0.5, 0.2), 'top-center');
  assert.equal(snapPointerToDockPosition(0.9, 0.2), 'top-right');
  assert.equal(snapPointerToDockPosition(0.1, 0.8), 'bottom-left');
  assert.equal(snapPointerToDockPosition(0.5, 0.8), 'bottom-center');
  assert.equal(snapPointerToDockPosition(0.9, 0.8), 'bottom-right');

  // Verify default top-left layout when FloatingMapToolbar is at top-right
  const defaultLayout = resolveDrawToolboxDockLayout({
    position: 'top-left',
    isCollapsed: false,
    mapToolbarPosition: 'top-right',
  });
  assert.equal(defaultLayout.isCoDockedWithMapToolbar, false);
  assert.equal(defaultLayout.positionClasses, 'top-2.5 left-2.5');

  // Verify auto-offset when DrawMeasureToolbox shares top-right with FloatingMapToolbar
  const coDockedTopRightCollapsed = resolveDrawToolboxDockLayout({
    position: 'top-right',
    isCollapsed: true,
    mapToolbarPosition: 'top-right',
  });
  assert.equal(coDockedTopRightCollapsed.isCoDockedWithMapToolbar, true);
  assert.ok(coDockedTopRightCollapsed.positionClasses.includes('right-14'));

  // Verify top-center shifts below "Search this area" pill when camera moved
  const topCenterCameraMoved = resolveDrawToolboxDockLayout({
    position: 'top-center',
    isCollapsed: false,
    mapToolbarPosition: 'top-right',
    hasCameraMoved: true,
  });
  assert.ok(topCenterCameraMoved.positionClasses.includes('top-14'));

  // Verify bottom-left clears mobile SelectedListingCard and desktop hover preview
  const bottomLeftWithOverlay = resolveDrawToolboxDockLayout({
    position: 'bottom-left',
    isCollapsed: false,
    mapToolbarPosition: 'top-right',
    mobileBottomOffsetClass: 'bottom-[215px] lg:bottom-7',
    hasSelectedListing: true,
    hasHoveredListingPreview: true,
  });
  assert.ok(bottomLeftWithOverlay.positionClasses.includes('bottom-[215px]'));
  assert.ok(bottomLeftWithOverlay.positionClasses.includes('lg:bottom-28'));
});

test('Step 4A: resolveSelectedListingOverlayLayout coordinates selected listing visibility across mobile, tablet, desktop sidebar, and full-screen map states without duplicate cards', () => {
  // 1. No selected listing -> neither floating overlay nor inline highlight
  const noneSelected = resolveSelectedListingOverlayLayout({
    hasSelectedListing: false,
    isFullscreenMap: false,
    isDesktopViewport: true,
    isDesktopPanelOpen: true,
    mobileSheetState: 'partial',
  });
  assert.equal(noneSelected.shouldRenderFloatingOverlay, false);
  assert.equal(noneSelected.shouldHighlightInSidebar, false);
  assert.equal(noneSelected.shouldHighlightInMobileSheet, false);

  // 2. Desktop with expanded sidebar -> highlights in sidebar, does NOT render duplicate floating overlay
  const desktopExpanded = resolveSelectedListingOverlayLayout({
    hasSelectedListing: true,
    isFullscreenMap: false,
    isDesktopViewport: true,
    isDesktopPanelOpen: true,
    mobileSheetState: 'collapsed',
  });
  assert.equal(desktopExpanded.shouldHighlightInSidebar, true);
  assert.equal(desktopExpanded.shouldRenderFloatingOverlay, false);
  assert.equal(desktopExpanded.showReopenSidebarAction, false);

  // 3. Desktop with collapsed sidebar -> renders floating overlay with reopen-sidebar action
  const desktopCollapsed = resolveSelectedListingOverlayLayout({
    hasSelectedListing: true,
    isFullscreenMap: false,
    isDesktopViewport: true,
    isDesktopPanelOpen: false,
    mobileSheetState: 'collapsed',
    mapToolbarPosition: 'bottom-left',
  });
  assert.equal(desktopCollapsed.shouldHighlightInSidebar, false);
  assert.equal(desktopCollapsed.shouldRenderFloatingOverlay, true);
  assert.equal(desktopCollapsed.showReopenSidebarAction, true);
  assert.ok(desktopCollapsed.positionClasses.includes('lg:bottom-4'));
  assert.ok(desktopCollapsed.toolbarBottomOffsetClass.includes('lg:bottom-[232px]'));

  // 4. Full-screen map mode on desktop -> renders floating overlay at bottom-3 even if sidebar state was open
  const fullscreenDesktop = resolveSelectedListingOverlayLayout({
    hasSelectedListing: true,
    isFullscreenMap: true,
    isDesktopViewport: true,
    isDesktopPanelOpen: true,
    mobileSheetState: 'collapsed',
  });
  assert.equal(fullscreenDesktop.shouldHighlightInSidebar, false);
  assert.equal(fullscreenDesktop.shouldRenderFloatingOverlay, true);
  assert.equal(fullscreenDesktop.showReopenSidebarAction, false);
  assert.ok(fullscreenDesktop.positionClasses.includes('bottom-3'));

  // 5. Mobile/tablet with collapsed bottom sheet -> floats compact card at bottom-[86px] above collapsed sheet bar
  const mobileCollapsedSheet = resolveSelectedListingOverlayLayout({
    hasSelectedListing: true,
    isFullscreenMap: false,
    isDesktopViewport: false,
    isDesktopPanelOpen: true,
    mobileSheetState: 'collapsed',
  });
  assert.equal(mobileCollapsedSheet.shouldRenderFloatingOverlay, true);
  assert.equal(mobileCollapsedSheet.shouldHighlightInMobileSheet, false);
  assert.ok(mobileCollapsedSheet.positionClasses.includes('bottom-[86px]'));
  assert.ok(mobileCollapsedSheet.toolbarBottomOffsetClass.includes('bottom-[284px]'));

  // 6. Mobile/tablet with partial/expanded bottom sheet -> highlights inside sheet, hides floating overlay to avoid overlap
  const mobilePartialSheet = resolveSelectedListingOverlayLayout({
    hasSelectedListing: true,
    isFullscreenMap: false,
    isDesktopViewport: false,
    isDesktopPanelOpen: true,
    mobileSheetState: 'partial',
  });
  assert.equal(mobilePartialSheet.shouldHighlightInMobileSheet, true);
  assert.equal(mobilePartialSheet.shouldRenderFloatingOverlay, false);
});

test('Step 4B: Coordinate validation guards reject null, undefined, NaN, Infinity, and out-of-range lat/lng values without throwing', () => {
  assert.equal(isValidLatLngPoint({ lat: 24.328, lng: 93.688 }), true);
  assert.equal(isValidLatLngPoint(null), false);
  assert.equal(isValidLatLngPoint(undefined), false);
  assert.equal(isValidLatLngPoint({ lat: NaN, lng: 93.688 }), false);
  assert.equal(isValidLatLngPoint({ lat: 24.328, lng: Infinity }), false);
  assert.equal(isValidLatLngPoint({ lat: 95, lng: 93.688 }), false);
  assert.equal(isValidLatLngPoint({ lat: 24.328, lng: -185 }), false);

  const sample = createInitialListings()[0];
  assert.equal(hasValidListingCoordinates(sample), true);
  assert.equal(
    hasValidListingCoordinates({
      ...sample,
      coordinates: { lat: NaN, lng: 93.688 },
    }),
    false
  );
  assert.equal(hasValidListingCoordinates(null), false);
});

test('Step 4B: Default map-viewport search excludes outer-ring listings while global directory search finds all published listings', () => {
  const allListings = createInitialListings();
  const published = allListings.filter((l) => l.status === 'published');
  assert.equal(published.length, 76);

  const initialBounds = computeDefaultViewportBounds(
    CHURACHANDPUR_SAMPLE_CENTER,
    14
  );

  // 1. Default map_area scope returns only listings inside initial zoom-14 viewport (61 inner-ring listings)
  const viewportResults = filterDiscoveryListings(published, {
    searchQuery: '',
    searchScope: 'map_area',
    appliedViewportBounds: initialBounds,
    selectedCategory: 'all',
    selectedPropertyType: 'all',
    selectedLocality: 'all',
    minRating: 0,
    verifiedOnly: false,
    availableOnly: false,
    has360Only: false,
    hasCatalogueOnly: false,
    priceRangeFilter: 'all',
    activeFilterShape: null,
    sortBy: 'relevance',
    mapCenter: CHURACHANDPUR_SAMPLE_CENTER,
  });
  assert.ok(
    viewportResults.length > 0 && viewportResults.length < published.length,
    `Expected viewportResults (${viewportResults.length}) to be a strict subset of published (${published.length})`
  );
  // Outer-ring listing biz-5 ("Singngat Aroma Coffee Roasters (Sample)") must be excluded in initial map_area
  assert.equal(
    viewportResults.some((l) => l.id === 'biz-5'),
    false,
    'Outer-ring listing biz-5 must be excluded from default initial zoom-14 viewport'
  );

  // 2. Global scope ('global') returns all 76 published listings including outer-ring biz-5
  const globalResults = filterDiscoveryListings(published, {
    searchQuery: '',
    searchScope: 'global',
    appliedViewportBounds: initialBounds,
    selectedCategory: 'all',
    selectedPropertyType: 'all',
    selectedLocality: 'all',
    minRating: 0,
    verifiedOnly: false,
    availableOnly: false,
    has360Only: false,
    hasCatalogueOnly: false,
    priceRangeFilter: 'all',
    activeFilterShape: null,
    sortBy: 'relevance',
    mapCenter: CHURACHANDPUR_SAMPLE_CENTER,
  });
  assert.equal(globalResults.length, 76);
  assert.equal(
    globalResults.some((l) => l.id === 'biz-5'),
    true,
    'Global search must include outer-ring listing biz-5'
  );

  // 3. Searching "Singngat Aroma Coffee" in map_area returns 0, while in global returns biz-5
  const mapAreaQuery = filterDiscoveryListings(published, {
    searchQuery: 'Singngat Aroma Coffee',
    searchScope: 'map_area',
    appliedViewportBounds: initialBounds,
    selectedCategory: 'all',
    selectedPropertyType: 'all',
    selectedLocality: 'all',
    minRating: 0,
    verifiedOnly: false,
    availableOnly: false,
    has360Only: false,
    hasCatalogueOnly: false,
    priceRangeFilter: 'all',
    activeFilterShape: null,
    sortBy: 'relevance',
    mapCenter: CHURACHANDPUR_SAMPLE_CENTER,
  });
  assert.equal(mapAreaQuery.length, 0);

  const globalQuery = filterDiscoveryListings(published, {
    searchQuery: 'Singngat Aroma Coffee',
    searchScope: 'global',
    appliedViewportBounds: initialBounds,
    selectedCategory: 'all',
    selectedPropertyType: 'all',
    selectedLocality: 'all',
    minRating: 0,
    verifiedOnly: false,
    availableOnly: false,
    has360Only: false,
    hasCatalogueOnly: false,
    priceRangeFilter: 'all',
    activeFilterShape: null,
    sortBy: 'relevance',
    mapCenter: CHURACHANDPUR_SAMPLE_CENTER,
  });
  assert.equal(globalQuery.length, 1);
  assert.equal(globalQuery[0].id, 'biz-5');

  // 4. Zooming out to zoom 12 and confirming Search This Area includes all 76 published listings in map_area
  const zoomedOutBounds = computeDefaultViewportBounds(
    CHURACHANDPUR_SAMPLE_CENTER,
    12
  );
  assert.equal(
    hasMeaningfulViewportChange(initialBounds, zoomedOutBounds, 14, 12),
    true
  );
  const zoomedOutResults = filterDiscoveryListings(published, {
    searchQuery: '',
    searchScope: 'map_area',
    appliedViewportBounds: zoomedOutBounds,
    selectedCategory: 'all',
    selectedPropertyType: 'all',
    selectedLocality: 'all',
    minRating: 0,
    verifiedOnly: false,
    availableOnly: false,
    has360Only: false,
    hasCatalogueOnly: false,
    priceRangeFilter: 'all',
    activeFilterShape: null,
    sortBy: 'relevance',
    mapCenter: CHURACHANDPUR_SAMPLE_CENTER,
  });
  assert.equal(zoomedOutResults.length, 76);

  // 5. Invalid/malformed listing objects in array never throw or appear in results
  const withCorrupted: Listing[] = [
    ...published,
    { ...published[0], id: 'corrupt-nan', coordinates: { lat: NaN, lng: 93.68 } },
    { ...published[0], id: 'corrupt-range', coordinates: { lat: 140, lng: 999 } },
  ];
  const safeResults = filterDiscoveryListings(withCorrupted, {
    searchQuery: '',
    searchScope: 'global',
    appliedViewportBounds: initialBounds,
    selectedCategory: 'all',
    selectedPropertyType: 'all',
    selectedLocality: 'all',
    minRating: 0,
    verifiedOnly: false,
    availableOnly: false,
    has360Only: false,
    hasCatalogueOnly: false,
    priceRangeFilter: 'all',
    activeFilterShape: null,
    sortBy: 'rating',
    mapCenter: CHURACHANDPUR_SAMPLE_CENTER,
  });
  assert.equal(safeResults.length, 76);
  assert.equal(
    safeResults.some((l) => l.id.startsWith('corrupt-')),
    false
  );
});

test('Step 4C: resolveResponsiveLayoutProfile classifies all 9 required viewports accurately with expected split-screen ratios and navigation modes', () => {
  // 1. Mobile Portrait viewports (360x800, 390x844, 430x932)
  for (const [w, h] of [
    [360, 800],
    [390, 844],
    [430, 932],
  ] as const) {
    const profile = resolveResponsiveLayoutProfile(w, h);
    assert.equal(profile.profile, 'mobile-portrait', `Failed for ${w}x${h}`);
    assert.equal(profile.isSplitScreen, false);
    assert.equal(profile.isMobileLandscape, false);
    assert.equal(profile.isTabletPortrait, false);
    assert.equal(profile.useBottomNav, true);
    assert.equal(profile.useVerticalNavRail, false);
    assert.equal(profile.useTopHeaderNav, false);
  }

  // 2. Mobile Landscape viewports (800x360, 844x390, 932x430) -> 60% Map / 40% Listings + vertical nav rail
  for (const [w, h] of [
    [800, 360],
    [844, 390],
    [932, 430],
  ] as const) {
    const profile = resolveResponsiveLayoutProfile(w, h);
    assert.equal(profile.profile, 'mobile-landscape', `Failed for ${w}x${h}`);
    assert.equal(profile.isSplitScreen, true);
    assert.equal(profile.isMobileLandscape, true);
    assert.equal(profile.isTabletPortrait, false);
    assert.equal(profile.defaultMapSplitPct, 60);
    assert.equal(profile.defaultListingSplitPct, 40);
    assert.equal(profile.minMapWidthPx, 320);
    assert.equal(profile.minListingWidthPx, 240);
    assert.equal(profile.useVerticalNavRail, true);
    assert.equal(profile.useBottomNav, false);
    assert.equal(profile.useTopHeaderNav, false);
  }

  // 3. Tablet Portrait viewport (768x1024) -> bottom sheet mode with 2-col card grid
  const tabletPortrait = resolveResponsiveLayoutProfile(768, 1024);
  assert.equal(tabletPortrait.profile, 'tablet-portrait');
  assert.equal(tabletPortrait.isSplitScreen, false);
  assert.equal(tabletPortrait.isTabletPortrait, true);
  assert.equal(tabletPortrait.useBottomNav, true);
  assert.equal(tabletPortrait.useVerticalNavRail, false);
  assert.equal(tabletPortrait.useTopHeaderNav, false);

  // 4. Tablet Landscape viewport (1024x768) -> 65% Map / 35% Listings split-screen + top header nav
  const tabletLandscape = resolveResponsiveLayoutProfile(1024, 768);
  assert.equal(tabletLandscape.profile, 'tablet-landscape');
  assert.equal(tabletLandscape.isSplitScreen, true);
  assert.equal(tabletLandscape.isTabletLandscape, true);
  assert.equal(tabletLandscape.defaultMapSplitPct, 65);
  assert.equal(tabletLandscape.defaultListingSplitPct, 35);
  assert.equal(tabletLandscape.minMapWidthPx, 420);
  assert.equal(tabletLandscape.minListingWidthPx, 280);
  assert.equal(tabletLandscape.useTopHeaderNav, true);
  assert.equal(tabletLandscape.useBottomNav, false);
  assert.equal(tabletLandscape.useVerticalNavRail, false);

  // 5. Desktop viewport (1440x900) -> 69% Map / 31% Listings split-screen + top header nav
  const desktop = resolveResponsiveLayoutProfile(1440, 900);
  assert.equal(desktop.profile, 'desktop');
  assert.equal(desktop.isSplitScreen, true);
  assert.equal(desktop.isDesktop, true);
  assert.equal(desktop.defaultMapSplitPct, 69);
  assert.equal(desktop.defaultListingSplitPct, 31);
  assert.equal(desktop.useTopHeaderNav, true);
  assert.equal(desktop.useBottomNav, false);
});

test('Step 4C: clampSplitListingPercentage enforces minimum map and listing widths and coordinates floating overlay / toolbox layout in mobile landscape', () => {
  // On 844x390 (with 56px vertical nav rail -> ~788px container width):
  // minMapPx = 320, minListingPx = 240 -> minPct = (240/788)*100 = 30.5%, maxPct = 50%
  const clampedLowMobile = clampSplitListingPercentage(
    15,
    788,
    'mobile-landscape'
  );
  assert.equal(clampedLowMobile, 30.5);

  const clampedHighMobile = clampSplitListingPercentage(
    80,
    788,
    'mobile-landscape'
  );
  assert.equal(clampedHighMobile, 50);

  // Default 40% on mobile landscape stays 40%
  assert.equal(clampSplitListingPercentage(40, 788, 'mobile-landscape'), 40);

  // On 1024x768 tablet landscape:
  // minMapPx = 420, minListingPx = 280 -> minPct = (280/1024)*100 = 27.3%, maxPct = 50%
  assert.equal(clampSplitListingPercentage(35, 1024, 'tablet-landscape'), 35);
  assert.equal(clampSplitListingPercentage(10, 1024, 'tablet-landscape'), 27.3);
  assert.equal(clampSplitListingPercentage(75, 1024, 'tablet-landscape'), 50);

  // Mobile landscape with expanded split-screen sidebar highlights listing in sidebar without duplicate floating card
  const mobileLandscapeExpanded = resolveSelectedListingOverlayLayout({
    hasSelectedListing: true,
    isFullscreenMap: false,
    isDesktopViewport: false,
    isSplitScreen: true,
    isMobileLandscape: true,
    isDesktopPanelOpen: true,
    mobileSheetState: 'collapsed',
  });
  assert.equal(mobileLandscapeExpanded.shouldHighlightInSidebar, true);
  assert.equal(mobileLandscapeExpanded.shouldRenderFloatingOverlay, false);

  // Mobile landscape with collapsed sidebar renders compact floating overlay with reopen-sidebar button
  const mobileLandscapeCollapsed = resolveSelectedListingOverlayLayout({
    hasSelectedListing: true,
    isFullscreenMap: false,
    isDesktopViewport: false,
    isSplitScreen: true,
    isMobileLandscape: true,
    isDesktopPanelOpen: false,
    mobileSheetState: 'collapsed',
  });
  assert.equal(mobileLandscapeCollapsed.shouldHighlightInSidebar, false);
  assert.equal(mobileLandscapeCollapsed.shouldRenderFloatingOverlay, true);
  assert.equal(mobileLandscapeCollapsed.showReopenSidebarAction, true);

  // DrawMeasureToolbox in mobile landscape uses compact max-height in split-screen mode
  const drawMobileLandscape = resolveDrawToolboxDockLayout({
    position: 'bottom-left',
    isCollapsed: false,
    mapToolbarPosition: 'top-right',
    mobileBottomOffsetClass: 'bottom-2.5',
    isSplitScreen: true,
    isMobileLandscape: true,
    hasSelectedListing: false,
  });
  assert.ok(drawMobileLandscape.positionClasses.includes('bottom-2.5'));
  assert.equal(drawMobileLandscape.maxHeightClasses, 'max-h-[calc(100%-20px)]');
});


