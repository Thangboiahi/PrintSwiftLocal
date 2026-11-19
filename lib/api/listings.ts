import { supabase, isSupabaseConfigured } from '@/lib/supabase/client';
import {
  fetchListings,
  fetchPublishedListings,
  fetchFullListingById,
  fetchListingById,
  mapRowToListing,
  BRIEF_LISTING_SELECT_FIELDS,
  type SupabaseListingRow,
  type ListingPaginationParams,
} from '@/lib/supabase/listings';
import type { Listing, MapViewportBounds } from '@/lib/types';

export {
  fetchListings,
  fetchPublishedListings,
  fetchFullListingById,
  fetchListingById,
  mapRowToListing,
  BRIEF_LISTING_SELECT_FIELDS,
  type SupabaseListingRow,
  type ListingPaginationParams,
};

/**
 * Phase 50-B: Partial Fetching & Pagination Engine
 * Explicitly selects ONLY brief data for the Map and Listings List:
 * `.select('id, title, category, price, lat, lng, thumbnail_url, status, created_at')`
 * with `.range(offset, offset + limit - 1)` pagination.
 */
export async function fetchBriefListingsPage(
  offset = 0,
  limit = 20,
  bounds?: MapViewportBounds
): Promise<Listing[]> {
  if (!isSupabaseConfigured()) {
    return fetchPublishedListings(bounds, offset, limit);
  }

  const { data, error } = await supabase
    .from('listings')
    .select('id, title, category, price, lat, lng, thumbnail_url, status, created_at')
    .eq('status', 'published')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (error || !Array.isArray(data) || data.length === 0) {
    return fetchPublishedListings(bounds, offset, limit);
  }

  return (data as unknown as SupabaseListingRow[]).map(mapRowToListing);
}

/**
 * Phase 50-B: Single-Listing Full Fetch on Selection
 * Defers full JSON payload until a marker or list item is clicked:
 * `await supabase.from('listings').select('*').eq('id', selectedId).single()`
 */
export async function fetchSingleListingFullDetails(
  selectedId: string
): Promise<Listing | null> {
  if (!selectedId || !selectedId.trim()) return null;

  if (isSupabaseConfigured()) {
    const { data, error } = await supabase
      .from('listings')
      .select('*')
      .eq('id', selectedId.trim())
      .single();

    if (!error && data) {
      return mapRowToListing(data as unknown as SupabaseListingRow);
    }
  }

  return fetchFullListingById(selectedId);
}
