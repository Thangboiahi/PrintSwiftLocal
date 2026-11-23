import type { Listing } from '@/lib/types';
import type { ListingVertical } from '@/lib/verticals/types';

export type ExploreVerticalFilter = 'all' | ListingVertical;

export interface VerticalQuickPillDef {
  id: ExploreVerticalFilter;
  label: string;
  shortLabel: string;
  moduleSwitchKey?: string;
}

export const EXPLORE_VERTICAL_PILLS: VerticalQuickPillDef[] = [
  { id: 'all', label: 'All', shortLabel: 'All' },
  {
    id: 'print_digital',
    label: 'Print & Digital',
    shortLabel: 'Print',
    moduleSwitchKey: 'print_orders',
  },
  {
    id: 'restaurant_food',
    label: 'Food & Cafés',
    shortLabel: 'Food',
    moduleSwitchKey: 'food_orders',
  },
  {
    id: 'shop_catalogue',
    label: 'Shops',
    shortLabel: 'Shops',
    moduleSwitchKey: 'shop_orders',
  },
  {
    id: 'booking_venue',
    label: 'Turfs & Halls',
    shortLabel: 'Venues',
    moduleSwitchKey: 'booking_venues',
  },
  {
    id: 'hotel_stay',
    label: 'Hotels',
    shortLabel: 'Hotels',
    moduleSwitchKey: 'hotel_stays',
  },
  {
    id: 'real_estate',
    label: 'Real Estate',
    shortLabel: 'Property',
    moduleSwitchKey: 'real_estate',
  },
  {
    id: 'public_civic',
    label: 'Public & Civic',
    shortLabel: 'Civic',
  },
];

export interface VerticalAttributeChipDef {
  key: string;
  label: string;
}

export const VERTICAL_ATTRIBUTE_CHIPS: Record<
  ListingVertical,
  VerticalAttributeChipDef[]
> = {
  print_digital: [
    { key: 'order_online', label: 'Order Online' },
    { key: 'verified_color', label: 'Verified Color' },
    { key: 'duplex', label: 'Duplex' },
    { key: 'binding', label: 'Binding' },
    { key: 'custom_digital', label: 'Custom Digital' },
  ],
  restaurant_food: [
    { key: 'pure_veg', label: 'Pure Veg' },
    { key: 'delivery_ready', label: 'Delivery Ready' },
    { key: 'table_booking', label: 'Table Booking' },
    { key: 'fssai_verified', label: 'FSSAI Verified' },
    { key: 'open_now', label: 'Open Now' },
  ],
  shop_catalogue: [
    { key: 'order_online', label: 'Order Online' },
    { key: 'pick_n_drop_ready', label: 'Pick N Drop Ready' },
    { key: 'verified_store', label: 'Verified Store' },
  ],
  booking_venue: [
    { key: 'hourly_turf', label: 'Hourly / Turf' },
    { key: 'hall_day', label: 'Half/Full Day Hall' },
    { key: 'instant_book', label: 'Instant Book' },
  ],
  hotel_stay: [
    { key: 'wifi', label: 'Wi-Fi' },
    { key: 'hot_water', label: 'Hot Water' },
    { key: 'power_backup', label: 'Power Backup' },
    { key: 'parking', label: 'Parking' },
  ],
  real_estate: [
    { key: 'for_rent', label: 'For Rent' },
    { key: 'for_sale', label: 'For Sale' },
    { key: 'for_lease', label: 'For Lease' },
    { key: 'patta_verified', label: 'Patta Verified' },
    { key: 'water_24x7', label: '24×7 Water' },
    { key: 'car_road', label: 'Car Road' },
    { key: 'featured', label: 'Featured' },
  ],
  public_civic: [
    { key: 'open_24x7', label: '24×7 Open' },
    { key: 'emergency_medical', label: 'Emergency / Hospital' },
    { key: 'government_office', label: 'Govt Office' },
    { key: 'utility_power_water', label: 'Utilities' },
    { key: 'active_alert', label: 'Active Alert' },
  ],
  general: [],
};

function flattenSummaryValues(value: unknown, out: string[], depth = 0): void {
  if (depth > 3 || value === null || value === undefined) return;
  if (typeof value === 'string' || typeof value === 'number') {
    const str = String(value).trim();
    if (str) out.push(str);
    return;
  }
  if (typeof value === 'boolean') {
    return;
  }
  if (Array.isArray(value)) {
    for (const item of value) {
      flattenSummaryValues(item, out, depth + 1);
    }
    return;
  }
  if (typeof value === 'object') {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (v === true) {
        out.push(k.replace(/_/g, ' '));
      } else {
        flattenSummaryValues(v, out, depth + 1);
      }
    }
  }
}

export function matchesCrossVerticalSearch(
  listing: Listing,
  rawQuery: string
): boolean {
  const q = rawQuery.trim().toLowerCase();
  if (!q) return true;

  const tokens = q.split(/\s+/).filter(Boolean);
  const parts: string[] = [
    listing.title || '',
    listing.description || '',
    listing.shortDescription || '',
    listing.locality || '',
    listing.address || '',
    listing.category || '',
    listing.subcategory || '',
    listing.listing_vertical || '',
    ...(Array.isArray(listing.custom_tags) ? listing.custom_tags : []),
  ];

  if (listing.vertical_summary) {
    flattenSummaryValues(listing.vertical_summary, parts);
  }

  const haystack = parts.join(' ').toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

export function isRealEstateBoostActive(
  summary?: Record<string, unknown> | null,
  nowMs = Date.now()
): boolean {
  if (!summary) return false;
  const exp = summary.verified_boost_expires_at;
  if (typeof exp !== 'string' || !exp.trim()) return false;
  const ts = Date.parse(exp);
  return Number.isFinite(ts) && ts > nowMs;
}

export function isOfficialPrintSwiftListing(
  listing: Listing,
  isFirstPartyFromProfile?: boolean
): boolean {
  if (isFirstPartyFromProfile) return true;
  const s = (listing.vertical_summary || {}) as Record<string, unknown>;
  return Boolean(s.is_official_printswift || s.is_first_party_printswift);
}

export function matchesVerticalAttributeFilter(
  listing: Listing,
  vertical: ExploreVerticalFilter,
  attrKey: string,
  printProfile?: {
    hasActiveEntitlement?: boolean;
    isAcceptingOrders?: boolean;
    isBusyPaused?: boolean;
    verifiedCapabilities?: Record<string, boolean>;
  } | null
): boolean {
  if (!attrKey || vertical === 'all') return true;
  const s = (listing.vertical_summary || {}) as Record<string, unknown>;
  const caps = (printProfile?.verifiedCapabilities ||
    (s.verified_capabilities as Record<string, boolean> | undefined) ||
    {}) as Record<string, boolean>;

  switch (vertical) {
    case 'print_digital': {
      if (attrKey === 'order_online') {
        return Boolean(
          printProfile
            ? printProfile.hasActiveEntitlement &&
                printProfile.isAcceptingOrders &&
                !printProfile.isBusyPaused
            : s.is_accepting_orders
        );
      }
      if (attrKey === 'verified_color') {
        return Boolean(caps.color || caps.color_printing || s.supports_color);
      }
      if (attrKey === 'duplex') {
        return Boolean(caps.duplex || caps.double_sided || s.supports_duplex);
      }
      if (attrKey === 'binding') {
        return Boolean(
          caps.binding ||
            caps.spiral_binding ||
            caps.hard_binding ||
            s.supports_binding
        );
      }
      if (attrKey === 'custom_digital') {
        return Boolean(
          caps.large_format ||
            caps.photo_print ||
            caps.custom_digital ||
            s.supports_custom_digital
        );
      }
      return true;
    }

    case 'restaurant_food': {
      if (attrKey === 'pure_veg') {
        return Boolean(s.is_pure_veg || s.pure_veg);
      }
      if (attrKey === 'delivery_ready') {
        return Boolean(
          s.supports_pick_n_drop || s.delivery_ready || s.is_accepting_orders
        );
      }
      if (attrKey === 'table_booking') {
        return Boolean(s.supports_table_booking || s.table_reservations_enabled);
      }
      if (attrKey === 'fssai_verified') {
        return Boolean(s.fssai_verified || s.fssai_license_no);
      }
      if (attrKey === 'open_now') {
        return Boolean(s.is_accepting_orders && !s.is_kitchen_paused);
      }
      return true;
    }

    case 'shop_catalogue': {
      if (attrKey === 'order_online') {
        return Boolean(s.is_accepting_orders || Number(s.in_stock_count ?? 0) > 0);
      }
      if (attrKey === 'pick_n_drop_ready') {
        return Boolean(s.supports_pick_n_drop || s.delivery_ready);
      }
      if (attrKey === 'verified_store') {
        return Boolean(
          s.is_verified || listing.verificationStatus === 'verified_demo'
        );
      }
      return true;
    }

    case 'booking_venue': {
      const unit = String(s.primary_slot_unit || s.slot_unit || '').toLowerCase();
      if (attrKey === 'hourly_turf') {
        return unit === 'hourly' || /turf|futsal|badminton|court/i.test(listing.title);
      }
      if (attrKey === 'hall_day') {
        return (
          unit === 'half_day' ||
          unit === 'full_day' ||
          /hall|auditorium|banquet|conference/i.test(listing.title)
        );
      }
      if (attrKey === 'instant_book') {
        return Boolean(s.instant_confirm || s.is_accepting_bookings);
      }
      return true;
    }

    case 'hotel_stay': {
      const amenities = Array.isArray(s.amenities)
        ? (s.amenities as string[]).map((a) => String(a).toLowerCase())
        : [];
      const hay = `${amenities.join(' ')} ${JSON.stringify(s)}`.toLowerCase();
      if (attrKey === 'wifi') return Boolean(s.has_wifi || hay.includes('wi-fi') || hay.includes('wifi'));
      if (attrKey === 'hot_water') return Boolean(s.has_hot_water || hay.includes('hot water') || hay.includes('geyser'));
      if (attrKey === 'power_backup') return Boolean(s.has_power_backup || hay.includes('power') || hay.includes('inverter') || hay.includes('generator'));
      if (attrKey === 'parking') return Boolean(s.has_parking || hay.includes('parking'));
      return true;
    }

    case 'real_estate': {
      const txn = String(s.transaction_type || '').toLowerCase();
      if (attrKey === 'for_rent') return txn === 'rent';
      if (attrKey === 'for_sale') return txn === 'sale';
      if (attrKey === 'for_lease') return txn === 'lease';
      if (attrKey === 'patta_verified') {
        return Boolean(s.patta_verified || s.land_title_type === 'patta');
      }
      if (attrKey === 'water_24x7') {
        return Boolean(s.water_24x7 || s.water_supply === '24x7_piped');
      }
      if (attrKey === 'car_road') {
        return Boolean(
          s.road_access === 'car_accessible' ||
            s.road_access === 'highway_front' ||
            s.car_road_access
        );
      }
      if (attrKey === 'featured') {
        return isRealEstateBoostActive(s);
      }
      return true;
    }

    case 'public_civic': {
      const dept = String(s.department_type || '').toLowerCase();
      if (attrKey === 'open_24x7') return Boolean(s.is_24x7);
      if (attrKey === 'emergency_medical') return dept === 'emergency_medical';
      if (attrKey === 'government_office') return dept === 'government_office';
      if (attrKey === 'utility_power_water') return dept === 'utility_power_water';
      if (attrKey === 'active_alert') {
        return (
          typeof s.live_civic_alert === 'string' &&
          s.live_civic_alert.trim().length > 0
        );
      }
      return true;
    }

    default:
      return true;
  }
}

export function getVerticalRankingBoost(
  listing: Listing,
  activeVertical: ExploreVerticalFilter,
  isFirstPartyPrint = false,
  nowMs = Date.now()
): number {
  const s = (listing.vertical_summary || {}) as Record<string, unknown>;
  let score = 0;
  if (
    (activeVertical === 'real_estate' || activeVertical === 'all') &&
    listing.listing_vertical === 'real_estate' &&
    isRealEstateBoostActive(s, nowMs)
  ) {
    score += 100;
  }
  if (
    (activeVertical === 'print_digital' || activeVertical === 'all') &&
    (listing.listing_vertical === 'print_digital' || isFirstPartyPrint) &&
    isOfficialPrintSwiftListing(listing, isFirstPartyPrint)
  ) {
    score += 100;
  }
  return score;
}
