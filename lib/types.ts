export type ListingCategory =
  | 'business'
  | 'service'
  | 'real_estate'
  | 'sports'
  | 'public_place';

export type PropertyType =
  | 'plot_land'
  | 'house_with_plot'
  | 'house_without_plot'
  | 'villa_with_land'
  | 'apartment'
  | 'commercial'
  | 'room_pg';

export type AreaUnit = 'sqm' | 'sqft' | 'acre' | 'hectare';

export type LinearUnit = 'm' | 'km' | 'ft';

export type ListingStatus =
  | 'draft'
  | 'submitted'
  | 'pending_verification'
  | 'published'
  | 'changes_requested'
  | 'rejected'
  | 'suspended'
  | 'archived'
  | 'expired';

export type PropertyAvailability =
  | 'available'
  | 'under_negotiation'
  | 'sold'
  | 'rented'
  | 'withdrawn';

export type UserRoleType = 'visitor' | 'owner' | 'staff' | 'admin';

export type AdminRole =
  | 'super_admin'
  | 'listing_moderator'
  | 'verification_officer'
  | 'community_moderator'
  | 'customer_support'
  | 'finance_admin'
  | 'analytics_viewer';

export type StaffPermission =
  | 'edit_details'
  | 'manage_media'
  | 'manage_catalogue'
  | 'reply_enquiries'
  | 'reply_reviews'
  | 'view_analytics';

export type AppearanceMode = 'system' | 'light' | 'dark';

export type ThemePreset = 'neutral' | 'ocean' | 'forest' | 'slate' | 'clay';

export type MapAppearanceVariant = 'light' | 'dark';

export type BaseMapType = 'roadmap' | 'satellite' | 'hybrid' | 'terrain';

export type MapStyleOption =
  | 'roadmap'
  | 'dark'
  | 'satellite'
  | 'hybrid'
  | 'terrain';

export interface LatLngPoint {
  lat: number;
  lng: number;
}

export interface MapViewportBounds {
  north: number;
  south: number;
  east: number;
  west: number;
}

export interface PanoramaScene {
  id: string;
  name: string;
  imageUrl: string;
  isPrimary: boolean;
  order: number;
  width: number;
  height: number;
  isEquirectangular: boolean;
  isSyntheticDemo: boolean;
  sceneType?: 'interior' | 'courtyard' | 'plot_survey' | 'commercial_hall' | 'street_view';
  initialYaw?: number;
  initialPitch?: number;
}

export interface CatalogueProduct {
  id: string;
  listingId: string;
  name: string;
  category: string;
  description: string;
  price: number;
  variants: string[];
  availability: 'in_stock' | 'low_stock' | 'out_of_stock' | 'made_to_order';
  imageUrl: string;
  promotionLabel?: string;
}

export interface RealEstateDetails {
  propertyType: PropertyType;
  hasAssociatedPlot: boolean;
  availability: PropertyAvailability;
  askingPrice: number;
  priceLabel: string;
  // Plot / Land specific (canonical in m²)
  plotAreaSqm?: number;
  landType?: 'Residential' | 'Agricultural' | 'Commercial' | 'Mixed-Use';
  boundaryPolygon?: LatLngPoint[];
  dimensionsText?: string;
  roadAccess?: string;
  roadFrontageMeters?: number;
  terrainSlope?: 'Flat / Level' | 'Gentle Slope' | 'Terraced Hillside';
  ownershipLabel?: string;
  // Building / House / Villa / Apartment specific
  builtUpAreaSqm?: number;
  bedrooms?: number;
  bathrooms?: number;
  floors?: number;
  floorNumber?: number;
  totalFloors?: number;
  constructionStatus?: 'Ready to Move' | 'Under Construction' | 'Newly Renovated';
  furnishingStatus?: 'Fully Furnished' | 'Semi-Furnished' | 'Unfurnished';
  parking?: string;
  balcony?: boolean;
  liftAvailable?: boolean;
  propertyAgeYears?: number;
  maintenanceMonthly?: number;
  // Commercial specific
  commercialUse?: string;
  unitType?: string;
  frontageMeters?: number;
  powerWaterAvailability?: string;
  leaseTerms?: string;
  // Room / PG specific
  roomType?: 'Single Room' | 'Twin Sharing' | 'Studio PG' | 'Hostel Bed';
  occupancyCapacity?: number;
  attachedBathroom?: boolean;
  paymentFrequency?: 'Monthly' | 'Quarterly' | 'Per Semester';
  houseRules?: string[];
  // Shared property arrays
  utilities: string[];
  amenities: string[];
  panoramas: PanoramaScene[];
  streetViewAvailable: boolean;
}

export interface BusinessDetails {
  subcategory: string;
  openingHours: string;
  priceRange: '₹' | '₹₹' | '₹₹₹';
  deliveryInfo: string;
  establishedYear: number;
  highlights: string[];
  catalogue: CatalogueProduct[];
}

export interface ServiceDetails {
  serviceType: string;
  areasServed: string[];
  workingHours: string;
  availabilityStatus: 'Available Today' | 'By Appointment' | 'Weekdays Only';
  startingPrice: number;
  priceRangeText: string;
  experienceYears: number;
  workSamples: string[];
  certificationsLabel: string;
}

export interface SportsVenueDetails {
  sportActivity: string;
  venueCategory: 'Outdoor Ground' | 'Indoor Arena' | 'Turf Court' | 'Fitness Complex';
  facilities: string[];
  capacity: number;
  openingHours: string;
  surfaceType: string;
  accessNotes: string;
}

export interface PublicPlaceDetails {
  placeType: string;
  publicInfo: string;
  facilities: string[];
  openingHours: string;
  verificationSourceLabel: string;
  accessibilityNotes: string;
  emergencyOrHelplineNote?: string;
}

export interface ListingVersionSnapshot {
  versionId: string;
  timestamp: string;
  editorName: string;
  editorRole: string;
  summary: string;
  title: string;
  description: string;
  status: ListingStatus;
  coordinates: LatLngPoint;
}

export interface Listing {
  id: string;
  title: string;
  category: ListingCategory;
  subcategory: string;
  shortDescription: string;
  description: string;
  locality: string;
  address: string;
  coordinates: LatLngPoint;
  status: ListingStatus;
  verificationStatus: 'unverified_sample' | 'pending_review' | 'verified_demo' | 'info_requested';
  ownerId: string;
  ownerName: string;
  assignedStaffIds: string[];
  contactPhone: string;
  contactEmail: string;
  coverImage: string;
  galleryImages: string[];
  rating: number;
  reviewCount: number;
  viewsCount: number;
  mapImpressionsCount: number;
  detailVisitsCount: number;
  followsCount: number;
  enquiriesCount: number;
  directionClicksCount: number;
  updatedAt: string;
  createdAt: string;
  changeRequestNote?: string;
  isFeaturedDemo?: boolean;
  customFields?: Record<string, string | number | boolean>;
  businessDetails?: BusinessDetails;
  serviceDetails?: ServiceDetails;
  realEstateDetails?: RealEstateDetails;
  sportsDetails?: SportsVenueDetails;
  publicPlaceDetails?: PublicPlaceDetails;
  versionHistory: ListingVersionSnapshot[];
}

export interface ReviewRecord {
  id: string;
  listingId: string;
  listingTitle: string;
  authorName: string;
  rating: number;
  comment: string;
  createdAt: string;
  ownerReply?: string;
  ownerReplyUpdatedAt?: string;
  reported: boolean;
  reportReason?: string;
  moderationStatus: 'approved' | 'flagged' | 'hidden';
}

export interface EnquiryActivityItem {
  id: string;
  timestamp: string;
  actor: string;
  action: string;
}

export interface EnquiryRecord {
  id: string;
  listingId: string;
  listingTitle: string;
  ownerId: string;
  senderName: string;
  senderPhone: string;
  senderEmail: string;
  message: string;
  source: 'Map Preview' | 'Detail Page' | 'Catalogue Item' | '360° Property Tour';
  createdAt: string;
  status: 'open' | 'in_progress' | 'resolved';
  ownerReply?: string;
  repliedAt?: string;
  activityLog: EnquiryActivityItem[];
}

export interface StaffDelegation {
  id: string;
  staffUserId: string;
  staffName: string;
  staffEmail: string;
  ownerId: string;
  assignedListingIds: string[];
  permissions: StaffPermission[];
  assignedAt: string;
  status: 'active' | 'revoked';
}

export interface UserAccount {
  id: string;
  name: string;
  email: string;
  roleType: UserRoleType;
  adminRole?: AdminRole;
  status: 'active' | 'suspended';
  joinedAt: string;
  avatarLabel: string;
  description: string;
}

export interface VerificationRequest {
  id: string;
  listingId: string;
  listingTitle: string;
  category: ListingCategory;
  ownerId: string;
  ownerName: string;
  submittedAt: string;
  evidenceSummary: string;
  status: 'pending' | 'approved' | 'rejected' | 'more_info_requested';
  decisionReason?: string;
  decidedBy?: string;
  decidedAt?: string;
}

export interface ModerationCase {
  id: string;
  targetType: 'review' | 'listing' | 'media' | 'polygon';
  targetId: string;
  targetTitle: string;
  reason: string;
  reportedBy: string;
  createdAt: string;
  status: 'open' | 'resolved_kept' | 'resolved_actioned' | 'appealed';
  decisionNote?: string;
  decidedBy?: string;
  decidedAt?: string;
}

export interface AuditLogEntry {
  id: string;
  timestamp: string;
  actorId: string;
  actorName: string;
  actorRole: string;
  workspace: 'visitor' | 'owner' | 'staff' | 'admin';
  action: string;
  targetId?: string;
  targetName?: string;
  details: string;
}

export interface NotificationItem {
  id: string;
  recipientRole: 'owner' | 'staff' | 'admin';
  title: string;
  message: string;
  type: 'enquiry' | 'review' | 'verification' | 'status_change' | 'reminder';
  createdAt: string;
  read: boolean;
  linkListingId?: string;
}

export type DynamicFieldType =
  | 'text'
  | 'long_text'
  | 'number'
  | 'date'
  | 'image'
  | 'location'
  | 'dropdown'
  | 'multi_select'
  | 'boolean'
  | 'price'
  | 'measurement';

export interface DynamicFieldDefinition {
  id: string;
  category: ListingCategory;
  name: string;
  label: string;
  fieldType: DynamicFieldType;
  required: boolean;
  publicVisible: boolean;
  ownerEditable: boolean;
  adminOnly: boolean;
  filterable: boolean;
  options?: string[];
}

export type MapToolbarPosition =
  | 'top-left'
  | 'top-center'
  | 'top-right'
  | 'bottom-left'
  | 'bottom-center'
  | 'bottom-right';

export type MobileSheetState = 'collapsed' | 'partial' | 'expanded';

export type DiscoverySearchScope = 'map_area' | 'global';

export type ResponsiveLayoutProfile =
  | 'mobile-portrait'
  | 'mobile-landscape'
  | 'tablet-portrait'
  | 'tablet-landscape'
  | 'desktop';

export type DiscoverySortOption =
  | 'relevance'
  | 'distance'
  | 'rating'
  | 'updated'
  | 'price_asc'
  | 'price_desc';

export interface DrawnShape {
  id: string;
  type: 'point' | 'line' | 'polygon' | 'rectangle' | 'circle';
  label: string;
  description?: string;
  categoryNote?: string;
  visible?: boolean;
  coordinates: LatLngPoint[];
  center?: LatLngPoint;
  radiusMeters?: number;
  diameterMeters?: number;
  circumferenceMeters?: number;
  areaSqm?: number;
  perimeterMeters?: number;
  distanceMeters?: number;
  segmentDistancesMeters?: number[];
  createdAt: string;
}

export interface CompletenessItem {
  key: string;
  label: string;
  section: 'basic' | 'location' | 'contact' | 'media' | 'category' | 'panorama' | 'catalogue';
  isMandatoryBlocker?: boolean;
}

export type interfaceCompletenessItem = CompletenessItem;

export interface CompletenessReport {
  score: number;
  isComplete: boolean;
  canSubmitForPublication: boolean;
  missingItems: CompletenessItem[];
  blockerMessage?: string;
}


