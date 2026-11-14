import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import type { Listing, ListingCategory, ListingStatus } from '@/lib/types';

export interface SupabaseListingRow {
  id: string;
  owner_id: string;
  owner_name?: string | null;
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
  coordinates: { lat: number; lng: number };
  cover_image: string;
  gallery_images?: string[] | null;
  real_estate_details?: Listing['realEstateDetails'] | null;
  business_details?: Listing['businessDetails'] | null;
  service_details?: Listing['serviceDetails'] | null;
  public_place_details?: Listing['publicPlaceDetails'] | null;
  sports_details?: Listing['sportsDetails'] | null;
  created_at?: string;
  updated_at?: string;
}

function mapRowToListing(row: SupabaseListingRow): Listing {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    subcategory: row.subcategory || 'General',
    status: row.status || 'draft',
    verificationStatus: 'unverified_sample',
    description: row.description || '',
    shortDescription: row.short_description || '',
    locality: row.locality || 'New Lamka',
    address: row.address || 'Churachandpur',
    coordinates: row.coordinates || { lat: 24.3335, lng: 93.6978 },
    contactPhone: row.contact_phone || '+91 98620 00000',
    contactEmail: row.contact_email || '',
    coverImage: row.cover_image || '',
    galleryImages: Array.isArray(row.gallery_images) ? row.gallery_images : [],
    ownerId: row.owner_id,
    ownerName: row.owner_name || 'Listing Owner',
    assignedStaffIds: [],
    createdAt: row.created_at
      ? row.created_at.slice(0, 10)
      : new Date().toISOString().slice(0, 10),
    updatedAt: row.updated_at || new Date().toISOString(),
    isFeaturedDemo: false,
    rating: 4.5,
    reviewCount: 0,
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
    cover_image: listing.coverImage,
    gallery_images: listing.galleryImages,
    real_estate_details: listing.realEstateDetails ?? null,
    business_details: listing.businessDetails ?? null,
    service_details: listing.serviceDetails ?? null,
    public_place_details: listing.publicPlaceDetails ?? null,
    sports_details: listing.sportsDetails ?? null,
    updated_at: new Date().toISOString(),
  };
}

/**
 * Fetches listings from the Supabase `listings` table.
 * When `ownerId` is provided, filters rows by `owner_id` in alignment with Row-Level Security (RLS).
 */
export async function fetchListings(ownerId?: string): Promise<Listing[]> {
  if (!isSupabaseConfigured()) {
    return [];
  }

  let query = supabase
    .from('listings')
    .select('*')
    .order('updated_at', { ascending: false });

  if (ownerId) {
    query = query.eq('owner_id', ownerId);
  }

  const { data, error } = await query;
  if (error) {
    throw new Error(error.message);
  }

  return Array.isArray(data)
    ? (data as SupabaseListingRow[]).map(mapRowToListing)
    : [];
}

/**
 * Fetches published listings (`status === 'published'`) from the Supabase `listings` table.
 */
export async function fetchPublishedListings(): Promise<Listing[]> {
  if (!isSupabaseConfigured()) {
    return [];
  }

  const { data, error } = await supabase
    .from('listings')
    .select('*')
    .eq('status', 'published')
    .order('updated_at', { ascending: false });

  if (error) {
    throw new Error(error.message);
  }

  return Array.isArray(data)
    ? (data as SupabaseListingRow[]).map(mapRowToListing)
    : [];
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

/**
 * Updates an existing listing in the Supabase `listings` table, enforcing `owner_id` matching for RLS.
 */
export async function updateListing(
  listingId: string,
  updates: Partial<Listing>,
  ownerId: string
): Promise<Listing> {
  if (!ownerId || !ownerId.trim()) {
    throw new Error(
      'Authenticated ownerId is required to update a listing under Row-Level Security (RLS).'
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

  const { data, error } = await supabase
    .from('listings')
    .update(updatePayload)
    .eq('id', listingId)
    .eq('owner_id', ownerId)
    .select('*')
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return mapRowToListing(data as SupabaseListingRow);
}

/**
 * Deletes a listing from the Supabase `listings` table, enforcing `owner_id` matching for RLS.
 */
export async function deleteListing(
  listingId: string,
  ownerId: string
): Promise<{ deletedId: string }> {
  if (!ownerId || !ownerId.trim()) {
    throw new Error(
      'Authenticated ownerId is required to delete a listing under Row-Level Security (RLS).'
    );
  }

  if (!isSupabaseConfigured()) {
    return { deletedId: listingId };
  }

  const { error } = await supabase
    .from('listings')
    .delete()
    .eq('id', listingId)
    .eq('owner_id', ownerId);

  if (error) {
    throw new Error(error.message);
  }

  return { deletedId: listingId };
}
