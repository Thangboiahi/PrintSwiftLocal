import React from 'react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ArrowLeft, CalendarDays } from 'lucide-react';
import {
  BookingFlowClient,
  type BookingListingSummary,
} from '@/components/verticals/bookings/BookingFlowClient';
import {
  normalizeBookingResourceRow,
  normalizeHotelProfileRow,
} from '@/lib/bookings/server-helpers';
import type {
  ListingBookingResource,
  ListingHotelProfile,
  ResourceVertical,
} from '@/lib/bookings/types';
import { createServerSupabaseReadClient } from '@/lib/pick-n-drop/fare';

interface ListingBookPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

async function fetchBookingPageServerData(listingId: string): Promise<{
  listing: BookingListingSummary | null;
  vertical: ResourceVertical;
  resources: ListingBookingResource[];
  hotelProfile: ListingHotelProfile | null;
  hasActiveEntitlement: boolean;
  isModuleEnabled: boolean;
  hubPauseMessage: string | null;
}> {
  const supabase = createServerSupabaseReadClient();
  if (!supabase) {
    return {
      listing: null,
      vertical: 'booking_venue',
      resources: [],
      hotelProfile: null,
      hasActiveEntitlement: false,
      isModuleEnabled: true,
      hubPauseMessage: null,
    };
  }

  const decodedId = decodeURIComponent(listingId).trim();

  const [listingRes, resourcesRes, hotelProfileRes] = await Promise.all([
    supabase
      .from('listings')
      .select(
        'id, title, locality, address, hub_id, phone, whatsapp, lat, lng, listing_vertical, owner_id, media'
      )
      .eq('id', decodedId)
      .maybeSingle(),
    supabase
      .from('listing_booking_resources')
      .select('*')
      .eq('listing_id', decodedId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('base_rate_inr', { ascending: true }),
    supabase
      .from('listing_hotel_profiles')
      .select('*')
      .eq('listing_id', decodedId)
      .maybeSingle(),
  ]);

  if (listingRes.error || !listingRes.data) {
    return {
      listing: null,
      vertical: 'booking_venue',
      resources: [],
      hotelProfile: null,
      hasActiveEntitlement: false,
      isModuleEnabled: true,
      hubPauseMessage: null,
    };
  }

  const rawListing = listingRes.data as Record<string, unknown>;
  const resources: ListingBookingResource[] = Array.isArray(resourcesRes.data)
    ? resourcesRes.data.map((r) =>
        normalizeBookingResourceRow(r as Record<string, unknown>)
      )
    : [];

  const hotelProfile: ListingHotelProfile | null =
    !hotelProfileRes.error && hotelProfileRes.data
      ? normalizeHotelProfileRow(hotelProfileRes.data as Record<string, unknown>)
      : null;

  const vertical: ResourceVertical =
    rawListing.listing_vertical === 'hotel_stay' ||
    Boolean(hotelProfile) ||
    resources[0]?.resource_vertical === 'hotel_stay'
      ? 'hotel_stay'
      : 'booking_venue';

  const rawMedia = Array.isArray(rawListing.media)
    ? (rawListing.media as Array<{ url?: string }>)
    : [];
  const extractedCover =
    rawMedia.find((m) => typeof m?.url === 'string' && m.url.trim().length > 0)
      ?.url || null;

  const listing: BookingListingSummary = {
    id: String(rawListing.id),
    title: String(rawListing.title || 'Bookable Listing').replace(
      /^\[SAMPLE\]\s*/i,
      ''
    ),
    locality: String(rawListing.locality || ''),
    address: rawListing.address ? String(rawListing.address) : null,
    hub_id: rawListing.hub_id ? String(rawListing.hub_id) : null,
    phone: rawListing.phone ? String(rawListing.phone) : null,
    whatsapp: rawListing.whatsapp ? String(rawListing.whatsapp) : null,
    coverImage: extractedCover,
  };

  const targetHubId =
    hotelProfile?.hub_id || resources[0]?.hub_id || listing.hub_id;

  const [entitlementRes, hubRes] = await Promise.all([
    supabase.rpc('has_active_booking_entitlement', {
      p_listing_id: decodedId,
      p_vertical: vertical,
    }),
    targetHubId
      ? supabase
          .from('service_hubs')
          .select('name, status, module_switches')
          .eq('id', targetHubId)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  let hasActiveEntitlement = entitlementRes.data === true;
  if (!hasActiveEntitlement && rawListing.owner_id) {
    try {
      const { data: eff } = await supabase.rpc('get_effective_entitlements', {
        p_user_id: String(rawListing.owner_id),
        p_listing_id: decodedId,
      });
      if (eff && typeof eff === 'object') {
        const effObj = eff as {
          is_super_admin_bypass?: boolean;
          features?: Record<string, boolean>;
        };
        if (
          effObj.is_super_admin_bypass ||
          (vertical === 'hotel_stay'
            ? effObj.features?.hotel_multi_room === true
            : effObj.features?.booking_slots === true)
        ) {
          hasActiveEntitlement = true;
        }
      }
    } catch {
      // keep existing entitlement value
    }
  }

  let isModuleEnabled = true;
  let hubPauseMessage: string | null = null;
  const switchKey = vertical === 'hotel_stay' ? 'hotel_stays' : 'booking_venues';

  if (hubRes.data) {
    const hubRow = hubRes.data as {
      name?: string | null;
      status?: string | null;
      module_switches?: unknown;
    };
    const hubName = hubRow.name || 'this hub';
    if (String(hubRow.status || 'active') === 'paused') {
      isModuleEnabled = false;
      hubPauseMessage = `Online bookings are currently paused in ${hubName}.`;
    } else if (
      hubRow.module_switches &&
      typeof hubRow.module_switches === 'object' &&
      !Array.isArray(hubRow.module_switches)
    ) {
      const sw = (hubRow.module_switches as Record<string, unknown>)[switchKey];
      if (sw === false) {
        isModuleEnabled = false;
        hubPauseMessage =
          vertical === 'hotel_stay'
            ? `Hotel & Homestay bookings are currently paused in ${hubName}.`
            : `Venue & Turf slot bookings are currently paused in ${hubName}.`;
      } else if (
        sw &&
        typeof sw === 'object' &&
        !Array.isArray(sw) &&
        (sw as Record<string, unknown>).enabled === false
      ) {
        isModuleEnabled = false;
        const customMsg = String(
          (sw as Record<string, unknown>).pause_message || ''
        ).trim();
        hubPauseMessage =
          customMsg ||
          (vertical === 'hotel_stay'
            ? `Hotel & Homestay bookings are currently paused in ${hubName}.`
            : `Venue & Turf slot bookings are currently paused in ${hubName}.`);
      }
    }
  }

  return {
    listing,
    vertical,
    resources,
    hotelProfile,
    hasActiveEntitlement,
    isModuleEnabled,
    hubPauseMessage,
  };
}

export async function generateMetadata({
  params,
}: ListingBookPageProps): Promise<Metadata> {
  const { id } = await params;
  const { listing, vertical } = await fetchBookingPageServerData(id);

  if (!listing) {
    return {
      title: 'Booking Not Found | DD oodle',
      description: 'The requested venue or property could not be found.',
    };
  }

  return {
    title:
      vertical === 'hotel_stay'
        ? `Book Room · ${listing.title} | DD oodle`
        : `Book Slot · ${listing.title} | DD oodle`,
    description:
      vertical === 'hotel_stay'
        ? `Check live room availability and reserve your stay at ${listing.title}${listing.locality ? ` in ${listing.locality}` : ''}.`
        : `Check live slots and reserve ${listing.title}${listing.locality ? ` in ${listing.locality}` : ''} online.`,
  };
}

export default async function ListingBookPage({
  params,
  searchParams,
}: ListingBookPageProps) {
  const { id } = await params;
  const resolvedSearch = (searchParams ? await searchParams : {}) ?? {};
  const initialCheckIn =
    typeof resolvedSearch.checkIn === 'string' ? resolvedSearch.checkIn : undefined;
  const initialCheckOut =
    typeof resolvedSearch.checkOut === 'string'
      ? resolvedSearch.checkOut
      : undefined;

  const {
    listing,
    vertical,
    resources,
    hotelProfile,
    hasActiveEntitlement,
    isModuleEnabled,
    hubPauseMessage,
  } = await fetchBookingPageServerData(id);

  if (!listing) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 sm:px-6 py-12">
        <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-8 text-center space-y-3">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-[var(--ps-bg)] border border-[var(--ps-border)] text-[var(--ps-text-muted)]">
            <CalendarDays className="h-5 w-5" />
          </div>
          <h1 className="text-lg font-bold text-[var(--ps-text)]">
            Listing Not Found
          </h1>
          <p className="text-xs text-[var(--ps-text-muted)] max-w-md mx-auto">
            This venue or stay could not be found or is no longer accepting bookings.
          </p>
          <div className="pt-2">
            <Link
              href="/explore"
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-slate-900 dark:bg-sky-600 px-4 text-xs font-bold text-white shadow-sm hover:opacity-95 transition-opacity"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Back to Explore</span>
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <BookingFlowClient
      listing={listing}
      vertical={vertical}
      resources={resources}
      hotelProfile={hotelProfile}
      hasActiveEntitlement={hasActiveEntitlement}
      isModuleEnabled={isModuleEnabled}
      hubPauseMessage={hubPauseMessage}
      initialCheckIn={initialCheckIn}
      initialCheckOut={initialCheckOut}
    />
  );
}
