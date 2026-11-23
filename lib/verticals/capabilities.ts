import { isUuid } from '@/lib/payments/types';
import type { Listing } from '@/lib/types';
import type { ListingVertical } from '@/lib/verticals/types';
import type { PrintProfileBadgeSummary } from '@/lib/print-orders/client-helpers';
import {
  isOfficialPrintSwiftListing,
  isRealEstateBoostActive,
} from '@/lib/verticals/filter-catalog';

export interface ListingLiveCapabilities {
  vertical: ListingVertical;
  isOfficialPrintSwift: boolean;
  canOrderPrint: boolean;
  canBookVenueOrStay: boolean;
  canOrderShop: boolean;
  canOrderFood: boolean;
  canReserveTable: boolean;
  supportsPickNDrop: boolean;
  isBoostedRealEstate: boolean;
  hasAnyActiveSubscribedFeature: boolean;
  logoUrl: string | null;
}

export interface HubModuleSwitchFlags {
  print_orders?: { enabled?: boolean } | boolean;
  booking_venues?: { enabled?: boolean } | boolean;
  hotel_stays?: { enabled?: boolean } | boolean;
  shop_orders?: { enabled?: boolean } | boolean;
  food_orders?: { enabled?: boolean } | boolean;
  pick_n_drop?: { enabled?: boolean } | boolean;
}

function isHubSwitchOn(
  switches: HubModuleSwitchFlags | null | undefined,
  key: keyof HubModuleSwitchFlags
): boolean {
  if (!switches) return true;
  const entry = switches[key];
  if (entry === false) return false;
  if (entry && typeof entry === 'object' && entry.enabled === false) {
    return false;
  }
  return true;
}

/**
 * Extracts an explicit lightweight logo/brand avatar URL if set on the listing.
 * Intentionally avoids falling back to bulky uncropped gallery photos.
 */
export function extractListingLogoUrl(listing: Listing): string | null {
  const rec = listing as unknown as Record<string, unknown>;
  const summary = (listing.vertical_summary || {}) as Record<string, unknown>;
  const candidates = [
    rec.logo_url,
    rec.logoUrl,
    rec.brand_logo_url,
    summary.logo_url,
    summary.brand_logo_url,
  ];
  for (const val of candidates) {
    if (typeof val === 'string' && val.trim().startsWith('http')) {
      return val.trim();
    }
  }
  return null;
}

/**
 * Appends lightweight resize query params for Supabase Storage / CDN URLs
 * so 70+ circular map marker logos stay tiny (~32-40px) and never lag panning.
 */
export function toLightweightLogoSrc(rawUrl: string, sizePx = 64): string {
  try {
    const parsed = new URL(rawUrl);
    if (
      parsed.pathname.includes('/storage/v1/object/public/') &&
      !parsed.searchParams.has('width')
    ) {
      parsed.searchParams.set('width', String(sizePx));
      parsed.searchParams.set('height', String(sizePx));
      parsed.searchParams.set('resize', 'cover');
      parsed.searchParams.set('quality', '75');
      return parsed.toString();
    }
    return rawUrl;
  } catch {
    return rawUrl;
  }
}

export function resolveListingLiveCapabilities(
  listing: Listing,
  printProfile?: PrintProfileBadgeSummary | null,
  hubSwitches?: HubModuleSwitchFlags | null
): ListingLiveCapabilities {
  const summary = (listing.vertical_summary || {}) as Record<string, unknown>;
  const vertical: ListingVertical =
    listing.is_civic_record || listing.listing_vertical === 'public_civic'
      ? 'public_civic'
      : listing.listing_vertical && listing.listing_vertical !== 'general'
        ? listing.listing_vertical
        : printProfile
          ? 'print_digital'
          : listing.category === 'real_estate'
            ? 'real_estate'
            : 'general';

  const isOfficialPrintSwift =
    vertical !== 'public_civic' &&
    isOfficialPrintSwiftListing(listing, printProfile?.isFirstParty);

  const hasPrintEntitlement = Boolean(
    isOfficialPrintSwift ||
      printProfile?.hasActiveEntitlement ||
      summary.has_active_entitlement === true ||
      summary.print_online_orders === true
  );
  const isPrintAccepting = Boolean(
    printProfile
      ? printProfile.isAcceptingOrders && !printProfile.isBusyPaused
      : summary.is_accepting_orders === true && summary.is_busy_paused !== true
  );
  const canOrderPrint =
    isUuid(listing.id) &&
    vertical === 'print_digital' &&
    isHubSwitchOn(hubSwitches, 'print_orders') &&
    hasPrintEntitlement &&
    isPrintAccepting;

  const hasBookingEntitlement = Boolean(
    summary.has_active_entitlement === true ||
      summary.booking_slots === true ||
      summary.hotel_multi_room === true ||
      summary.is_booking_enabled === true
  );
  const hasActiveResources =
    Number(summary.active_resources_count ?? summary.room_count ?? 1) > 0;
  const canBookVenueOrStay =
    (vertical === 'booking_venue' || vertical === 'hotel_stay') &&
    isHubSwitchOn(
      hubSwitches,
      vertical === 'hotel_stay' ? 'hotel_stays' : 'booking_venues'
    ) &&
    hasBookingEntitlement &&
    hasActiveResources &&
    summary.is_accepting_bookings !== false;

  const canOrderShop =
    vertical === 'shop_catalogue' &&
    isHubSwitchOn(hubSwitches, 'shop_orders') &&
    summary.is_accepting_orders === true &&
    Boolean(
      summary.has_active_entitlement === true ||
        summary.shop_basket_checkout === true
    );

  const canOrderFood =
    vertical === 'restaurant_food' &&
    isHubSwitchOn(hubSwitches, 'food_orders') &&
    summary.is_accepting_orders === true &&
    summary.is_kitchen_paused !== true &&
    Boolean(
      summary.has_active_entitlement === true ||
        summary.restaurant_menu_ordering === true
    );

  const canReserveTable =
    vertical === 'restaurant_food' &&
    summary.accepts_table_reservations === true &&
    Boolean(
      summary.has_active_entitlement === true ||
        summary.restaurant_table_booking === true
    );

  const supportsPickNDrop =
    isHubSwitchOn(hubSwitches, 'pick_n_drop') &&
    Boolean(
      summary.supports_pick_n_drop === true ||
        summary.delivery_ready === true ||
        summary.pick_n_drop_dispatch === true
    );

  const isBoostedRealEstate =
    vertical === 'real_estate' && isRealEstateBoostActive(summary);

  const hasAnyActiveSubscribedFeature =
    canOrderPrint ||
    canBookVenueOrStay ||
    canOrderShop ||
    canOrderFood ||
    canReserveTable ||
    isBoostedRealEstate ||
    isOfficialPrintSwift;

  return {
    vertical,
    isOfficialPrintSwift,
    canOrderPrint,
    canBookVenueOrStay,
    canOrderShop,
    canOrderFood,
    canReserveTable,
    supportsPickNDrop,
    isBoostedRealEstate,
    hasAnyActiveSubscribedFeature,
    logoUrl: extractListingLogoUrl(listing),
  };
}
