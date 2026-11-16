import { fetchAppSettings, isSampleListing } from '@/lib/supabase/admin';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import {
  fetchProfilesByIds,
  mapRowToLiveProfile,
  type SupabaseProfileRow,
} from '@/lib/supabase/profiles';
import { resolveRemoteMediaUrl } from '@/lib/supabase/storage';
import type { Listing, ListingCategory, ListingStatus } from '@/lib/types';
import { getDeterministicMegaSeedDataset } from '@/scripts/seed';

export interface SupabaseListingRow {
  id: string;
  owner_id: string;
  owner_name?: string | null;
  owner_avatar_url?: string | null;
  profiles?: SupabaseProfileRow | SupabaseProfileRow[] | null;
  title: string;
  category: ListingCategory;
  subcategory: string;
  status: ListingStatus;
  short_description: string;
  description: string;
  locality: string;
  address: string;
  contact_phone: string;
  contact_email?: string | null;
  coordinates?: { lat: number; lng: number } | null;
  lat?: number | null;
  lng?: number | null;
  cover_image: string;
  gallery_images?: string[] | null;
  real_estate_details?: Listing['realEstateDetails'] | null;
  business_details?: Listing['businessDetails'] | null;
  service_details?: Listing['serviceDetails'] | null;
  public_place_details?: Listing['publicPlaceDetails'] | null;
  sports_details?: Listing['sportsDetails'] | null;
  rating?: number | null;
  review_count?: number | null;
  created_at?: string;
  updated_at?: string;
}

function normalizeListingCategory(rawCategory?: string | null): ListingCategory {
  const normalized = String(rawCategory || 'business')
    .trim()
    .toLowerCase()
    .replace(/-/g, '_');
  if (normalized === 'real_estate') return 'real_estate';
  if (normalized === 'service' || normalized === 'services') return 'service';
  if (normalized === 'public_interest' || normalized === 'public_place') {
    return 'public_place';
  }
  if (normalized === 'sports') return 'sports';
  return 'business';
}

function mapRowToListing(row: SupabaseListingRow): Listing {
  const joinedProfileRaw = Array.isArray(row.profiles)
    ? row.profiles[0] ?? null
    : row.profiles ?? null;
  const joinedProfile = joinedProfileRaw
    ? mapRowToLiveProfile(joinedProfileRaw)
    : null;

  const resolvedLat =
    typeof row.lat === 'number' && Number.isFinite(row.lat)
      ? row.lat
      : typeof row.coordinates?.lat === 'number' &&
          Number.isFinite(row.coordinates.lat)
        ? row.coordinates.lat
        : 24.3335;
  const resolvedLng =
    typeof row.lng === 'number' && Number.isFinite(row.lng)
      ? row.lng
      : typeof row.coordinates?.lng === 'number' &&
          Number.isFinite(row.coordinates.lng)
        ? row.coordinates.lng
        : 93.6978;

  return {
    id: row.id,
    title: row.title,
    category: normalizeListingCategory(row.category),
    subcategory: row.subcategory || 'General',
    status: row.status || 'draft',
    verificationStatus: 'unverified_sample',
    description: row.description || '',
    shortDescription: row.short_description || '',
    locality: row.locality || 'New Lamka',
    address: row.address || 'Churachandpur',
    coordinates: { lat: resolvedLat, lng: resolvedLng },
    contactPhone: row.contact_phone || '+91 98620 00000',
    contactEmail: row.contact_email || '',
    coverImage: resolveRemoteMediaUrl(row.cover_image || ''),
    galleryImages: Array.isArray(row.gallery_images)
      ? row.gallery_images
          .map((img) => resolveRemoteMediaUrl(img))
          .filter(Boolean)
      : [],
    ownerId: row.owner_id,
    ownerName: joinedProfile?.fullName || row.owner_name || 'Verified Owner',
    ownerAvatarUrl:
      joinedProfile?.avatarUrl ||
      resolveRemoteMediaUrl(row.owner_avatar_url || ''),
    assignedStaffIds: [],
    createdAt: row.created_at
      ? row.created_at.slice(0, 10)
      : new Date().toISOString().slice(0, 10),
    updatedAt: row.updated_at || new Date().toISOString(),
    isFeaturedDemo: false,
    rating:
      typeof row.rating === 'number' && Number.isFinite(row.rating)
        ? row.rating
        : 4.5,
    reviewCount:
      typeof row.review_count === 'number' && Number.isFinite(row.review_count)
        ? row.review_count
        : 0,
    viewsCount: 0,
    mapImpressionsCount: 0,
    detailVisitsCount: 0,
    directionClicksCount: 0,
    followsCount: 0,
    enquiriesCount: 0,
    versionHistory: [],
    realEstateDetails: row.real_estate_details ?? undefined,
    businessDetails: row.business_details ?? undefined,
    serviceDetails: row.service_details ?? undefined,
    publicPlaceDetails: row.public_place_details ?? undefined,
    sportsDetails: row.sports_details ?? undefined,
  };
}

async function enrichListingsWithLiveProfiles(
  items: Listing[]
): Promise<Listing[]> {
  if (items.length === 0) return items;
  const ownerIds = items.map((item) => item.ownerId).filter(Boolean);
  const profilesById = await fetchProfilesByIds(ownerIds);

  return items.map((item) => {
    const liveProfile = profilesById[item.ownerId];
    if (!liveProfile) return item;
    return {
      ...item,
      ownerName: liveProfile.fullName || item.ownerName,
      ownerAvatarUrl: liveProfile.avatarUrl || item.ownerAvatarUrl,
    };
  });
}

function mapListingToRow(
  listing: Listing,
  ownerId: string
): SupabaseListingRow {
  return {
    id: listing.id,
    owner_id: ownerId,
    owner_name: listing.ownerName,
    title: listing.title,
    category: listing.category,
    subcategory: listing.subcategory,
    status: listing.status,
    short_description: listing.shortDescription,
    description: listing.description,
    locality: listing.locality,
    address: listing.address,
    contact_phone: listing.contactPhone,
    contact_email: listing.contactEmail || null,
    coordinates: listing.coordinates,
    cover_image: resolveRemoteMediaUrl(listing.coverImage),
    gallery_images: (listing.galleryImages || [])
      .map((img) => resolveRemoteMediaUrl(img))
      .filter(Boolean),
    real_estate_details: listing.realEstateDetails ?? null,
    business_details: listing.businessDetails ?? null,
    service_details: listing.serviceDetails ?? null,
    public_place_details: listing.publicPlaceDetails ?? null,
    sports_details: listing.sportsDetails ?? null,
    updated_at: new Date().toISOString(),
  };
}

function buildHydratedMegaSeedListings(): Listing[] {
  return getDeterministicMegaSeedDataset().map((item) =>
    mapRowToListing({
      id: item.id,
      owner_id: item.owner_id,
      owner_name: item.owner_name,
      title: item.title,
      category: normalizeListingCategory(item.category),
      subcategory: item.subcategory,
      status: 'published',
      short_description: item.short_description,
      description: item.description,
      locality: item.locality,
      address: item.address,
      contact_phone: item.contact_phone,
      contact_email: item.contact_email,
      coordinates: item.coordinates,
      lat: item.lat,
      lng: item.lng,
      cover_image: item.cover_image,
      gallery_images: item.gallery_images,
      rating: item.rating,
      review_count: item.review_count,
      business_details: (item.business_details as Listing['businessDetails']) ?? null,
      service_details: (item.service_details as Listing['serviceDetails']) ?? null,
      public_place_details:
        (item.public_place_details as Listing['publicPlaceDetails']) ?? null,
      real_estate_details:
        (item.real_estate_details as Listing['realEstateDetails']) ?? null,
    })
  );
}

function mergeWithMegaSeedListings(
  dbItems: Listing[],
  ownerId?: string
): Listing[] {
  const existingTitles = new Set(
    dbItems.map((item) => item.title.trim().toLowerCase())
  );
  const existingIds = new Set(dbItems.map((item) => item.id));
  const seedListings = buildHydratedMegaSeedListings().filter((seedItem) => {
    if (ownerId && seedItem.ownerId !== ownerId) return false;
    return (
      !existingIds.has(seedItem.id) &&
      !existingTitles.has(seedItem.title.trim().toLowerCase())
    );
  });
  return [...dbItems, ...seedListings];
}

/**
 * Fetches listings from the Supabase `listings` table, joining/fetching live owner
 * profiles from `profiles`.
 */
export async function fetchListings(ownerId?: string): Promise<Listing[]> {
  if (!isSupabaseConfigured()) {
    return buildHydratedMegaSeedListings();
  }

  let query = supabase
    .from('listings')
    .select('*, profiles(id, full_name, name, avatar_url, role)')
    .order('updated_at', { ascending: false });

  if (ownerId) {
    query = query.eq('owner_id', ownerId);
  }

  let { data, error } = await query;

  if (error) {
    let fallbackQuery = supabase
      .from('listings')
      .select('*')
      .order('updated_at', { ascending: false });
    if (ownerId) {
      fallbackQuery = fallbackQuery.eq('owner_id', ownerId);
    }
    const fallbackRes = await fallbackQuery;
    if (fallbackRes.error) {
      throw new Error(fallbackRes.error.message);
    }
    data = fallbackRes.data;
  }

  const baseItems = Array.isArray(data)
    ? (data as SupabaseListingRow[]).map(mapRowToListing)
    : [];

  const appSettings = await fetchAppSettings();
  const combinedItems =
    appSettings.show_sample_data === false
      ? baseItems.filter((item) => !isSampleListing(item))
      : mergeWithMegaSeedListings(baseItems, ownerId);

  return enrichListingsWithLiveProfiles(combinedItems);
}

/**
 * Fetches published listings (`status === 'published'`) from the Supabase `listings` table,
 * enriched with live owner profile records from `profiles`.
 */
export async function fetchPublishedListings(): Promise<Listing[]> {
  if (!isSupabaseConfigured()) {
    return buildHydratedMegaSeedListings();
  }

  let { data, error } = await supabase
    .from('listings')
    .select('*, profiles(id, full_name, name, avatar_url, role)')
    .eq('status', 'published')
    .order('updated_at', { ascending: false });

  if (error) {
    const fallbackRes = await supabase
      .from('listings')
      .select('*')
      .eq('status', 'published')
      .order('updated_at', { ascending: false });
    if (fallbackRes.error) {
      throw new Error(fallbackRes.error.message);
    }
    data = fallbackRes.data;
  }

  const baseItems = Array.isArray(data)
    ? (data as SupabaseListingRow[]).map(mapRowToListing)
    : [];

  const appSettings = await fetchAppSettings();
  const visibleItems =
    appSettings.show_sample_data === false
      ? baseItems.filter((item) => !isSampleListing(item))
      : mergeWithMegaSeedListings(baseItems);

  return enrichListingsWithLiveProfiles(visibleItems);
}

/**
 * Creates a new listing in the Supabase `listings` table under the authenticated owner's ID (RLS-compliant).
 */
export async function createListing(
  listing: Listing,
  ownerId: string
): Promise<Listing> {
  if (!ownerId || !ownerId.trim()) {
    throw new Error(
      'Authenticated ownerId is required to create a listing under Row-Level Security (RLS).'
    );
  }

  const payload = mapListingToRow(
    {
      ...listing,
      ownerId,
    },
    ownerId
  );

  if (!isSupabaseConfigured()) {
    return mapRowToListing(payload);
  }

  const { data, error } = await supabase
    .from('listings')
    .insert(payload)
    .select('*')
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return mapRowToListing(data as SupabaseListingRow);
}

export function formatRlsMutationError(
  operation: 'update' | 'delete',
  rawError?: { code?: string; message?: string } | Error | null
): string {
  const code =
    rawError && typeof rawError === 'object' && 'code' in rawError
      ? String(rawError.code || '')
      : '';
  const msg =
    rawError && typeof rawError === 'object' && 'message' in rawError
      ? String(rawError.message || '')
      : '';

  const isRlsOrPermissionError =
    code === '42501' ||
    code === 'PGRST116' ||
    /row-level security|permission denied|insufficient_privilege|not authorized|0 rows/i.test(
      msg
    );

  if (operation === 'delete') {
    if (isRlsOrPermissionError || !msg) {
      return 'Permission denied by Row-Level Security (RLS): Only the listing Owner (or a Super Admin) can delete this listing. Delegated Staff have update-only access.';
    }
    return `Unable to delete listing (${msg}). Only the listing Owner or a Super Admin has destructive delete permissions.`;
  }

  if (isRlsOrPermissionError || !msg) {
    return 'Permission denied by Row-Level Security (RLS): You can only update listings that you own or have been explicitly delegated to manage in staff_delegations.';
  }
  return `Unable to update listing (${msg}). Verify that you are the listing Owner or an assigned Staff delegate.`;
}

/**
 * Updates an existing listing in the Supabase `listings` table.
 * Enforces Owner (`owner_id = auth.uid()`), Delegated Staff (`staff_delegations`), or Super Admin RLS policies
 * and returns a clear, user-friendly error message if rejected by RLS.
 */
export async function updateListing(
  listingId: string,
  updates: Partial<Listing>,
  ownerId: string
): Promise<Listing> {
  if (!ownerId || !ownerId.trim()) {
    throw new Error(
      'Permission denied: An authenticated user ID is required to update a listing under Row-Level Security (RLS).'
    );
  }

  const updatePayload: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
  };

  if (updates.title !== undefined) updatePayload.title = updates.title;
  if (updates.category !== undefined) updatePayload.category = updates.category;
  if (updates.subcategory !== undefined)
    updatePayload.subcategory = updates.subcategory;
  if (updates.status !== undefined) updatePayload.status = updates.status;
  if (updates.shortDescription !== undefined)
    updatePayload.short_description = updates.shortDescription;
  if (updates.description !== undefined)
    updatePayload.description = updates.description;
  if (updates.locality !== undefined) updatePayload.locality = updates.locality;
  if (updates.address !== undefined) updatePayload.address = updates.address;
  if (updates.contactPhone !== undefined)
    updatePayload.contact_phone = updates.contactPhone;
  if (updates.contactEmail !== undefined)
    updatePayload.contact_email = updates.contactEmail;
  if (updates.coordinates !== undefined)
    updatePayload.coordinates = updates.coordinates;
  if (updates.coverImage !== undefined)
    updatePayload.cover_image = updates.coverImage;
  if (updates.galleryImages !== undefined)
    updatePayload.gallery_images = updates.galleryImages;
  if (updates.realEstateDetails !== undefined)
    updatePayload.real_estate_details = updates.realEstateDetails;
  if (updates.businessDetails !== undefined)
    updatePayload.business_details = updates.businessDetails;
  if (updates.serviceDetails !== undefined)
    updatePayload.service_details = updates.serviceDetails;
  if (updates.publicPlaceDetails !== undefined)
    updatePayload.public_place_details = updates.publicPlaceDetails;
  if (updates.sportsDetails !== undefined)
    updatePayload.sports_details = updates.sportsDetails;
  if (updates.ownerId !== undefined) updatePayload.owner_id = updates.ownerId;
  if (updates.ownerName !== undefined)
    updatePayload.owner_name = updates.ownerName;

  if (!isSupabaseConfigured()) {
    return mapRowToListing({
      id: listingId,
      owner_id: updates.ownerId || ownerId,
      owner_name: updates.ownerName || 'Verified Owner',
      title: updates.title || 'Updated Listing',
      category: updates.category || 'business',
      subcategory: updates.subcategory || 'General',
      status: updates.status || 'draft',
      short_description: updates.shortDescription || '',
      description: updates.description || '',
      locality: updates.locality || 'New Lamka',
      address: updates.address || 'Churachandpur',
      contact_phone: updates.contactPhone || '+91 98620 00000',
      coordinates: updates.coordinates || { lat: 24.3335, lng: 93.6978 },
      cover_image: updates.coverImage || '',
    });
  }

  const { data, error } = await supabase
    .from('listings')
    .update(updatePayload)
    .eq('id', listingId)
    .select('*')
    .maybeSingle();

  if (error) {
    throw new Error(formatRlsMutationError('update', error));
  }

  if (!data) {
    throw new Error(formatRlsMutationError('update', null));
  }

  return mapRowToListing(data as SupabaseListingRow);
}

/**
 * Deletes a listing from the Supabase `listings` table.
 * Restricted by RLS to the listing Owner (`owner_id = auth.uid()`) or `super_admin`.
 * Delegated Staff cannot delete listings and receive a clear permission error.
 */
export async function deleteListing(
  listingId: string,
  ownerId: string
): Promise<{ deletedId: string }> {
  if (!ownerId || !ownerId.trim()) {
    throw new Error(
      'Permission denied: Only the authenticated listing Owner (or a Super Admin) can delete a listing under Row-Level Security (RLS).'
    );
  }

  if (!isSupabaseConfigured()) {
    return { deletedId: listingId };
  }

  const { data, error } = await supabase
    .from('listings')
    .delete()
    .eq('id', listingId)
    .select('id');

  if (error) {
    throw new Error(formatRlsMutationError('delete', error));
  }

  if (Array.isArray(data) && data.length === 0) {
    throw new Error(formatRlsMutationError('delete', null));
  }

  return { deletedId: listingId };
}

export interface SupabaseCategoryRow {
  id: string;
  name: string;
  slug?: string | null;
  description?: string | null;
  type?: string | null;
  color_bg?: string | null;
  color_border?: string | null;
  color_text?: string | null;
}

export interface SupabaseListingMediaRow {
  id: string;
  listing_id: string;
  media_type?: string | null;
  url: string;
  is_primary?: boolean | null;
  caption?: string | null;
  name?: string | null;
  is_equirectangular?: boolean | null;
  created_at?: string | null;
}

export interface SupabaseRealEstateRow {
  listing_id: string;
  property_type?: string | null;
  price?: number | null;
  asking_price?: number | null;
  price_label?: string | null;
  bedrooms?: number | null;
  bathrooms?: number | null;
  area_sqft?: number | null;
  plot_area_sqm?: number | null;
  built_up_area_sqm?: number | null;
  is_rental?: boolean | null;
  availability?: string | null;
  boundary_polygon?: Array<{ lat: number; lng: number }> | null;
  utilities?: string[] | null;
  amenities?: string[] | null;
}

export interface SupabaseBusinessRow {
  listing_id: string;
  opening_hours?: unknown;
  opening_hours_text?: string | null;
  website_url?: string | null;
  contact_phone?: string | null;
  verified?: boolean | null;
  subcategory?: string | null;
  price_range?: string | null;
  delivery_info?: string | null;
}

export interface SupabaseServiceRow {
  listing_id: string;
  service_radius_km?: number | null;
  pricing_model?: string | null;
  starting_price?: number | null;
  emergency_service?: boolean | null;
  service_type?: string | null;
  working_hours?: string | null;
  availability_status?: string | null;
}

export interface SupabasePublicInterestRow {
  listing_id: string;
  organization_type?: string | null;
  is_emergency_facility?: boolean | null;
  helpline_number?: string | null;
  place_type?: string | null;
  opening_hours?: string | null;
  public_info?: string | null;
}

export interface ListingDetailRecord extends Listing {
  category_id?: string | null;
  listing_type:
    | 'business'
    | 'service'
    | 'real_estate'
    | 'public_interest'
    | 'public_place'
    | 'sports';
  price?: number | null;
  location?: unknown;
  categoryDetails?: SupabaseCategoryRow | null;
  realEstateRow?: SupabaseRealEstateRow | null;
  businessRow?: SupabaseBusinessRow | null;
  serviceRow?: SupabaseServiceRow | null;
  publicInterestRow?: SupabasePublicInterestRow | null;
  boundaryPolygonPoints: Array<{ lat: number; lng: number }>;
  listingMedia: SupabaseListingMediaRow[];
}

function extractPolygonPoints(
  locationValue: unknown,
  fallbackPolygon?: Array<{ lat: number; lng: number }> | null
): Array<{ lat: number; lng: number }> {
  if (Array.isArray(fallbackPolygon) && fallbackPolygon.length >= 3) {
    const valid = fallbackPolygon.filter(
      (pt) =>
        pt &&
        typeof pt.lat === 'number' &&
        typeof pt.lng === 'number' &&
        Number.isFinite(pt.lat) &&
        Number.isFinite(pt.lng)
    );
    if (valid.length >= 3) return valid;
  }

  if (!locationValue) return [];

  // Handle array of { lat, lng } directly in location
  if (Array.isArray(locationValue) && locationValue.length >= 3) {
    const valid = locationValue
      .map((item) => {
        if (
          item &&
          typeof item === 'object' &&
          'lat' in item &&
          'lng' in item
        ) {
          return {
            lat: Number((item as { lat: unknown }).lat),
            lng: Number((item as { lng: unknown }).lng),
          };
        }
        if (Array.isArray(item) && item.length >= 2) {
          return { lng: Number(item[0]), lat: Number(item[1]) };
        }
        return null;
      })
      .filter(
        (pt): pt is { lat: number; lng: number } =>
          pt !== null && Number.isFinite(pt.lat) && Number.isFinite(pt.lng)
      );
    if (valid.length >= 3) return valid;
  }

  // Handle GeoJSON Polygon object { type: 'Polygon', coordinates: [[[lng, lat], ...]] }
  if (typeof locationValue === 'object' && locationValue !== null) {
    const geo = locationValue as {
      type?: string;
      coordinates?: unknown;
      boundaryPolygon?: Array<{ lat: number; lng: number }>;
    };
    if (
      Array.isArray(geo.boundaryPolygon) &&
      geo.boundaryPolygon.length >= 3
    ) {
      return geo.boundaryPolygon;
    }
    if (
      geo.type === 'Polygon' &&
      Array.isArray(geo.coordinates) &&
      Array.isArray(geo.coordinates[0])
    ) {
      const ring = geo.coordinates[0] as unknown[];
      const pts = ring
        .map((coord) =>
          Array.isArray(coord) && coord.length >= 2
            ? { lng: Number(coord[0]), lat: Number(coord[1]) }
            : null
        )
        .filter(
          (pt): pt is { lat: number; lng: number } =>
            pt !== null && Number.isFinite(pt.lat) && Number.isFinite(pt.lng)
        );
      if (pts.length >= 3) return pts;
    }
  }

  // Handle WKT POLYGON((lng lat, lng lat, ...))
  if (typeof locationValue === 'string') {
    const match = locationValue.match(/POLYGON\s*\(\(\s*([^)]+)\s*\)\)/i);
    if (match?.[1]) {
      const pts = match[1]
        .split(',')
        .map((pair) => {
          const parts = pair.trim().split(/\s+/);
          if (parts.length >= 2) {
            return { lng: Number(parts[0]), lat: Number(parts[1]) };
          }
          return null;
        })
        .filter(
          (pt): pt is { lat: number; lng: number } =>
            pt !== null && Number.isFinite(pt.lat) && Number.isFinite(pt.lng)
        );
      if (pts.length >= 3) return pts;
    }
  }

  return [];
}

/**
 * Fetches a single listing by ID from the Supabase `listings` table,
 * joining/fetching its associated `category_id` details (to determine `listing_type`),
 * category sub-table records (`business_listings`, `service_listings`, `real_estate_listings`, `public_interest_listings`),
 * and its `listing_media` records.
 */
export async function fetchListingById(
  id: string
): Promise<ListingDetailRecord | null> {
  if (!id || !id.trim() || !isSupabaseConfigured()) {
    return null;
  }

  const trimmedId = id.trim();

  // Attempt relational join query first
  const { data: joinedData, error: joinError } = await supabase
    .from('listings')
    .select(
      '*, categories(*), listing_media(*), real_estate_listings(*), business_listings(*), service_listings(*), public_interest_listings(*)'
    )
    .eq('id', trimmedId)
    .maybeSingle();

  type JoinedListingRow = SupabaseListingRow & {
    category_id?: string | null;
    listing_type?: string | null;
    price?: number | null;
    location?: unknown;
    categories?: SupabaseCategoryRow | SupabaseCategoryRow[] | null;
    listing_media?: SupabaseListingMediaRow[] | null;
    real_estate_listings?:
      | SupabaseRealEstateRow
      | SupabaseRealEstateRow[]
      | null;
    business_listings?: SupabaseBusinessRow | SupabaseBusinessRow[] | null;
    service_listings?: SupabaseServiceRow | SupabaseServiceRow[] | null;
    public_interest_listings?:
      | SupabasePublicInterestRow
      | SupabasePublicInterestRow[]
      | null;
  };

  let rawRow: JoinedListingRow;

  if (!joinError && joinedData) {
    rawRow = joinedData as unknown as JoinedListingRow;
  } else {
    // Fallback to primary query + secondary queries
    const { data: baseRow, error: baseError } = await supabase
      .from('listings')
      .select('*')
      .eq('id', trimmedId)
      .maybeSingle();

    if (baseError || !baseRow) {
      const seedMatch = getDeterministicMegaSeedDataset().find(
        (s) => s.id === trimmedId
      );
      if (!seedMatch) {
        return null;
      }
      const mapped = mapRowToListing({
        id: seedMatch.id,
        owner_id: seedMatch.owner_id,
        owner_name: seedMatch.owner_name,
        title: seedMatch.title,
        category: normalizeListingCategory(seedMatch.category),
        subcategory: seedMatch.subcategory,
        status: 'published',
        short_description: seedMatch.short_description,
        description: seedMatch.description,
        locality: seedMatch.locality,
        address: seedMatch.address,
        contact_phone: seedMatch.contact_phone,
        contact_email: seedMatch.contact_email,
        coordinates: seedMatch.coordinates,
        lat: seedMatch.lat,
        lng: seedMatch.lng,
        cover_image: seedMatch.cover_image,
        gallery_images: seedMatch.gallery_images,
        rating: seedMatch.rating,
        review_count: seedMatch.review_count,
        business_details:
          (seedMatch.business_details as Listing['businessDetails']) ?? null,
        service_details:
          (seedMatch.service_details as Listing['serviceDetails']) ?? null,
        public_place_details:
          (seedMatch.public_place_details as Listing['publicPlaceDetails']) ??
          null,
        real_estate_details:
          (seedMatch.real_estate_details as Listing['realEstateDetails']) ??
          null,
      });
      return {
        ...mapped,
        category_id: null,
        listing_type:
          mapped.category === 'public_place'
            ? 'public_interest'
            : mapped.category,
        price: seedMatch.price,
        location: seedMatch.coordinates,
        categoryDetails: null,
        realEstateRow: null,
        businessRow: null,
        serviceRow: null,
        publicInterestRow: null,
        boundaryPolygonPoints: [],
        listingMedia: [],
      };
    }

    rawRow = baseRow as unknown as JoinedListingRow;
  }

  let categoryDetails: SupabaseCategoryRow | null = null;
  if (rawRow.categories) {
    categoryDetails = Array.isArray(rawRow.categories)
      ? rawRow.categories[0] ?? null
      : rawRow.categories;
  } else if (rawRow.category_id) {
    const { data: catData } = await supabase
      .from('categories')
      .select('*')
      .eq('id', rawRow.category_id)
      .maybeSingle();
    if (catData) {
      categoryDetails = catData as SupabaseCategoryRow;
    }
  }

  let listingMedia: SupabaseListingMediaRow[] = [];
  if (Array.isArray(rawRow.listing_media)) {
    listingMedia = rawRow.listing_media;
  } else {
    const { data: mediaData } = await supabase
      .from('listing_media')
      .select('*')
      .eq('listing_id', trimmedId);
    if (Array.isArray(mediaData)) {
      listingMedia = mediaData as SupabaseListingMediaRow[];
    }
  }

  let realEstateRow: SupabaseRealEstateRow | null = null;
  if (rawRow.real_estate_listings) {
    realEstateRow = Array.isArray(rawRow.real_estate_listings)
      ? rawRow.real_estate_listings[0] ?? null
      : rawRow.real_estate_listings;
  } else {
    const { data: reData } = await supabase
      .from('real_estate_listings')
      .select('*')
      .eq('listing_id', trimmedId)
      .maybeSingle();
    if (reData) {
      realEstateRow = reData as SupabaseRealEstateRow;
    }
  }

  let businessRow: SupabaseBusinessRow | null = null;
  if (rawRow.business_listings) {
    businessRow = Array.isArray(rawRow.business_listings)
      ? rawRow.business_listings[0] ?? null
      : rawRow.business_listings;
  } else {
    const { data: bizData } = await supabase
      .from('business_listings')
      .select('*')
      .eq('listing_id', trimmedId)
      .maybeSingle();
    if (bizData) {
      businessRow = bizData as SupabaseBusinessRow;
    }
  }

  let serviceRow: SupabaseServiceRow | null = null;
  if (rawRow.service_listings) {
    serviceRow = Array.isArray(rawRow.service_listings)
      ? rawRow.service_listings[0] ?? null
      : rawRow.service_listings;
  } else {
    const { data: svcData } = await supabase
      .from('service_listings')
      .select('*')
      .eq('listing_id', trimmedId)
      .maybeSingle();
    if (svcData) {
      serviceRow = svcData as SupabaseServiceRow;
    }
  }

  let publicInterestRow: SupabasePublicInterestRow | null = null;
  if (rawRow.public_interest_listings) {
    publicInterestRow = Array.isArray(rawRow.public_interest_listings)
      ? rawRow.public_interest_listings[0] ?? null
      : rawRow.public_interest_listings;
  } else {
    const { data: pubData } = await supabase
      .from('public_interest_listings')
      .select('*')
      .eq('listing_id', trimmedId)
      .maybeSingle();
    if (pubData) {
      publicInterestRow = pubData as SupabasePublicInterestRow;
    }
  }

  const rawType = (
    rawRow.listing_type ||
    categoryDetails?.type ||
    categoryDetails?.slug ||
    rawRow.category ||
    (realEstateRow
      ? 'real_estate'
      : serviceRow
        ? 'service'
        : publicInterestRow
          ? 'public_interest'
          : 'business')
  )
    .toString()
    .toLowerCase()
    .replace(/-/g, '_');

  const resolvedListingType: ListingDetailRecord['listing_type'] =
    rawType === 'real_estate'
      ? 'real_estate'
      : rawType === 'service' || rawType === 'services'
        ? 'service'
        : rawType === 'public_interest' || rawType === 'public_place'
          ? 'public_interest'
          : rawType === 'sports'
            ? 'sports'
            : 'business';

  const normalizedCategory: ListingCategory =
    resolvedListingType === 'public_interest'
      ? 'public_place'
      : (resolvedListingType as ListingCategory);

  const baseListing = mapRowToListing({
    ...rawRow,
    category: rawRow.category || normalizedCategory,
  });

  if (!baseListing.coverImage && listingMedia.length > 0) {
    const primaryMedia =
      listingMedia.find((m) => m.is_primary) || listingMedia[0];
    if (primaryMedia?.url) {
      baseListing.coverImage = primaryMedia.url;
    }
  }

  if (baseListing.galleryImages.length === 0 && listingMedia.length > 0) {
    baseListing.galleryImages = listingMedia
      .map((m) => m.url)
      .filter((u): u is string => Boolean(u));
  }

  const boundaryPolygonPoints = extractPolygonPoints(
    rawRow.location,
    realEstateRow?.boundary_polygon ??
      baseListing.realEstateDetails?.boundaryPolygon ??
      null
  );

  return {
    ...baseListing,
    category_id: rawRow.category_id ?? categoryDetails?.id ?? null,
    listing_type: resolvedListingType,
    price:
      realEstateRow?.price ??
      realEstateRow?.asking_price ??
      rawRow.price ??
      baseListing.realEstateDetails?.askingPrice ??
      null,
    location: rawRow.location ?? null,
    categoryDetails,
    realEstateRow,
    businessRow,
    serviceRow,
    publicInterestRow,
    boundaryPolygonPoints,
    listingMedia,
  };
}



