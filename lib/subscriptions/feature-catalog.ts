/**
 * DD oodle — Pass V12-C: Canonical Composable Feature & Quota Subscription Catalog
 * Single source of truth for all composable feature booleans and numeric limits
 * backed by `subscription_plans.features`, `subscription_plans.limits`,
 * `user_subscriptions.entitlement_overrides`, and `get_effective_entitlements()`.
 */

export type SubscriptionFeatureGroup =
  | 'Core & Discovery'
  | 'Print & Digital'
  | 'Bookings & Stays'
  | 'Shops & Food'
  | 'Real Estate & Visibility'
  | 'Team & Growth';

export type SubscriptionFeatureKey =
  // Core & Discovery
  | 'verified_badge'
  | 'custom_logo_map_pin'
  | 'panorama_360_showcase'
  | 'whatsapp_direct_cta'
  | 'pick_n_drop_merchant_dispatch'
  | 'analytics_insights'
  // Print & Digital
  | 'print_online_orders'
  | 'print_express_badge'
  | 'print_custom_digital'
  // Bookings & Stays
  | 'booking_slots'
  | 'booking_walk_in_blocks'
  | 'hotel_multi_room'
  // Shops & Food
  | 'shop_basket_checkout'
  | 'shop_live_inventory'
  | 'restaurant_menu_ordering'
  | 'restaurant_table_booking'
  // Real Estate & Visibility
  | 'real_estate_polygon_overlay'
  | 'real_estate_boost_eligible'
  | 'real_estate_site_visit_queue'
  // Team & Growth
  | 'staff_delegation'
  | 'bulletin_posting'
  | 'featured_slot_requests'
  | 'counter_qr_posters'
  // Backwards-compatible legacy aliases
  | 'pick_n_drop_dispatch'
  | 'real_estate_verified_boost'
  | 'featured_map_pin';

export type SubscriptionLimitKey =
  | 'max_active_listings'
  | 'max_catalogue_items'
  | 'max_menu_items'
  | 'max_booking_resources'
  | 'max_room_types'
  | 'max_staff_members'
  | 'max_monthly_bulletins'
  | 'max_gallery_photos'
  | 'max_360_panoramas'
  | 'max_featured_requests_per_month'
  | 'max_vehicle_listings'
  // Backwards-compatible legacy aliases
  | 'max_media_per_listing'
  | 'active_boost_slots';

export const FEATURE_KEY_ALIASES: Partial<
  Record<SubscriptionFeatureKey, SubscriptionFeatureKey>
> = {
  pick_n_drop_merchant_dispatch: 'pick_n_drop_dispatch',
  pick_n_drop_dispatch: 'pick_n_drop_merchant_dispatch',
  real_estate_boost_eligible: 'real_estate_verified_boost',
  real_estate_verified_boost: 'real_estate_boost_eligible',
  featured_slot_requests: 'featured_map_pin',
  featured_map_pin: 'featured_slot_requests',
};

export const LIMIT_KEY_ALIASES: Partial<
  Record<SubscriptionLimitKey, SubscriptionLimitKey>
> = {
  max_gallery_photos: 'max_media_per_listing',
  max_media_per_listing: 'max_gallery_photos',
  max_featured_requests_per_month: 'active_boost_slots',
  active_boost_slots: 'max_featured_requests_per_month',
};

export interface SubscriptionFeatureMeta {
  key: SubscriptionFeatureKey;
  label: string;
  group: SubscriptionFeatureGroup;
  verticalGroup: SubscriptionFeatureGroup;
  description: string;
  defaultValue: boolean;
}

export interface SubscriptionLimitMeta {
  key: SubscriptionLimitKey;
  label: string;
  defaultValue: number; // -1 = Unlimited
  unitLabel: string;
  description: string;
}

export const SUBSCRIPTION_FEATURE_CATALOG: readonly SubscriptionFeatureMeta[] =
  [
    // Core & Discovery
    {
      key: 'verified_badge',
      label: 'Verified Business Badge',
      group: 'Core & Discovery',
      verticalGroup: 'Core & Discovery',
      description: 'Displays trust verification checkmark on Explore pins, search results & storefronts.',
      defaultValue: false,
    },
    {
      key: 'custom_logo_map_pin',
      label: 'Custom Circular Logo Map Pin',
      group: 'Core & Discovery',
      verticalGroup: 'Core & Discovery',
      description: 'Renders the merchant’s cropped 1:1 brand logo directly inside Explore map markers.',
      defaultValue: true,
    },
    {
      key: 'panorama_360_showcase',
      label: '360° Interactive Panorama Tour',
      group: 'Core & Discovery',
      verticalGroup: 'Core & Discovery',
      description: 'Enables immersive 360° equirectangular room/venue walkthroughs on public detail pages.',
      defaultValue: false,
    },
    {
      key: 'whatsapp_direct_cta',
      label: 'Direct WhatsApp & Call CTA',
      group: 'Core & Discovery',
      verticalGroup: 'Core & Discovery',
      description: 'Surfaces 1-tap prefilled WhatsApp enquiry and direct call buttons on cards.',
      defaultValue: true,
    },
    {
      key: 'pick_n_drop_merchant_dispatch',
      label: 'Pick N Drop Rider Dispatch',
      group: 'Core & Discovery',
      verticalGroup: 'Core & Discovery',
      description: 'Auto-dispatches local riders for print envelopes, shop baskets, and hot-food orders.',
      defaultValue: false,
    },
    {
      key: 'analytics_insights',
      label: 'Live Analytics & Conversion Insights',
      group: 'Core & Discovery',
      verticalGroup: 'Core & Discovery',
      description: 'Tracks map impressions, profile views, enquiry conversions & direction clicks.',
      defaultValue: false,
    },

    // Print & Digital
    {
      key: 'print_online_orders',
      label: 'Online Print Ordering Desk',
      group: 'Print & Digital',
      verticalGroup: 'Print & Digital',
      description: 'Accepts PDF/photo print jobs at /listing/[id]/print with instant rate-card quoting & OTP.',
      defaultValue: false,
    },
    {
      key: 'print_express_badge',
      label: '30-Min Express Print SLA Badge',
      group: 'Print & Digital',
      verticalGroup: 'Print & Digital',
      description: 'Highlights lightning-fast print turnaround cues on Explore markers and Print Shop header.',
      defaultValue: false,
    },
    {
      key: 'print_custom_digital',
      label: 'Custom Design & Flex Quotes',
      group: 'Print & Digital',
      verticalGroup: 'Print & Digital',
      description: 'Lets customers submit custom design/banner briefs for live manual merchant quoting.',
      defaultValue: false,
    },

    // Bookings & Stays
    {
      key: 'booking_slots',
      label: 'Venue & Turf Slot Engine',
      group: 'Bookings & Stays',
      verticalGroup: 'Bookings & Stays',
      description: 'Powers /bookings & /listing/[id]/book with hourly/daily slots and overlap protection.',
      defaultValue: false,
    },
    {
      key: 'booking_walk_in_blocks',
      label: 'Walk-In Calendar Block Sync',
      group: 'Bookings & Stays',
      verticalGroup: 'Bookings & Stays',
      description: 'Allows blocking offline/walk-in bookings immediately from the Owner Booking Desk.',
      defaultValue: false,
    },
    {
      key: 'hotel_multi_room',
      label: 'Multi-Room Hotel Inventory',
      group: 'Bookings & Stays',
      verticalGroup: 'Bookings & Stays',
      description: 'Nightly stay availability, multi-room types, amenities & Check-In OTP desk.',
      defaultValue: false,
    },

    // Shops & Food
    {
      key: 'shop_basket_checkout',
      label: '0% Commission Shop Cart Checkout',
      group: 'Shops & Food',
      verticalGroup: 'Shops & Food',
      description: 'Activates full basket checkout, UPI/escrow rail & counter/rider handover for shops.',
      defaultValue: false,
    },
    {
      key: 'shop_live_inventory',
      label: '1-Tap Live Shop Stock & Pricing',
      group: 'Shops & Food',
      verticalGroup: 'Shops & Food',
      description: 'Real-time item stock counts, SKU variants & in-stock toggles in Owner Commerce Desk.',
      defaultValue: false,
    },
    {
      key: 'restaurant_menu_ordering',
      label: 'Digital Restaurant Menu Ordering',
      group: 'Shops & Food',
      verticalGroup: 'Shops & Food',
      description: 'Veg/Non-Veg digital menu with spice levels, portions, variants & Kitchen KOT queue.',
      defaultValue: false,
    },
    {
      key: 'restaurant_table_booking',
      label: 'Dine-In Table Reservations',
      group: 'Shops & Food',
      verticalGroup: 'Shops & Food',
      description: 'Accept, confirm & track guest party table reservation requests in /bookings.',
      defaultValue: false,
    },

    // Real Estate & Visibility
    {
      key: 'real_estate_polygon_overlay',
      label: 'Interactive Plot Polygon Overlay',
      group: 'Real Estate & Visibility',
      verticalGroup: 'Real Estate & Visibility',
      description: 'Draws zoom-morphed plot boundary polygons with live m²/ft² & price labels on Explore.',
      defaultValue: true,
    },
    {
      key: 'real_estate_boost_eligible',
      label: 'Verified Property Boost Eligibility',
      group: 'Real Estate & Visibility',
      verticalGroup: 'Real Estate & Visibility',
      description: 'Permits 30-day Verified Property Priority Boost & elevated map ranking.',
      defaultValue: false,
    },
    {
      key: 'real_estate_site_visit_queue',
      label: 'Scheduled Site Visit Queue & Privacy',
      group: 'Real Estate & Visibility',
      verticalGroup: 'Real Estate & Visibility',
      description: 'Enables controlled buyer visit approvals & approximate ±150m locality pin privacy.',
      defaultValue: true,
    },

    // Team & Growth
    {
      key: 'staff_delegation',
      label: 'Granular Staff Delegation',
      group: 'Team & Growth',
      verticalGroup: 'Team & Growth',
      description: 'Assign staff accounts by email with scoped queue/stock access without billing visibility.',
      defaultValue: false,
    },
    {
      key: 'bulletin_posting',
      label: 'Community Bulletin Publishing',
      group: 'Team & Growth',
      verticalGroup: 'Team & Growth',
      description: 'Publish local offers, job posts & hub-targeted announcements on /bulletin.',
      defaultValue: false,
    },
    {
      key: 'featured_slot_requests',
      label: 'Homepage Featured Slot Requests',
      group: 'Team & Growth',
      verticalGroup: 'Team & Growth',
      description: 'Submit featured placement requests for Homepage Spotlight & gold-ring map pins.',
      defaultValue: false,
    },
    {
      key: 'counter_qr_posters',
      label: 'Printable Counter & Table QR Posters',
      group: 'Team & Growth',
      verticalGroup: 'Team & Growth',
      description: 'Generate print-ready QR storefront & restaurant table ordering posters.',
      defaultValue: false,
    },
  ] as const;

export const SUBSCRIPTION_LIMIT_CATALOG: readonly SubscriptionLimitMeta[] = [
  {
    key: 'max_active_listings',
    label: 'Max Active Listings',
    defaultValue: 2,
    unitLabel: 'listings',
    description: 'Maximum live storefronts/listings an owner can operate concurrently.',
  },
  {
    key: 'max_catalogue_items',
    label: 'Max Shop Catalogue Items',
    defaultValue: 50,
    unitLabel: 'items',
    description: 'Total SKUs allowed across Shop Catalogue & Marketplace products.',
  },
  {
    key: 'max_menu_items',
    label: 'Max Restaurant Menu Dishes',
    defaultValue: 50,
    unitLabel: 'dishes',
    description: 'Maximum menu items across starters, mains, snacks & beverages.',
  },
  {
    key: 'max_booking_resources',
    label: 'Max Bookable Courts / Venues',
    defaultValue: 5,
    unitLabel: 'resources',
    description: 'Distinct turf pitches, halls, or hourly courts managed in Booking Desk.',
  },
  {
    key: 'max_room_types',
    label: 'Max Hotel / Homestay Room Types',
    defaultValue: 5,
    unitLabel: 'room types',
    description: 'Distinct room categories (Standard, Deluxe, Suite) per hospitality property.',
  },
  {
    key: 'max_staff_members',
    label: 'Max Delegated Staff Seats',
    defaultValue: 2,
    unitLabel: 'staff',
    description: 'Number of staff members who can hold delegated operational permissions.',
  },
  {
    key: 'max_monthly_bulletins',
    label: 'Max Monthly Bulletins',
    defaultValue: 5,
    unitLabel: 'posts/mo',
    description: 'Community notices, offers & announcements publishable per 30-day cycle.',
  },
  {
    key: 'max_gallery_photos',
    label: 'Max Gallery Photos per Listing',
    defaultValue: 8,
    unitLabel: 'photos',
    description: 'Maximum cropped gallery images permitted per listing in ListingMediaEditor.',
  },
  {
    key: 'max_360_panoramas',
    label: 'Max 360° Panoramas per Listing',
    defaultValue: 1,
    unitLabel: 'panoramas',
    description: 'Optional equirectangular 2:1 360° walkthrough scenes per listing.',
  },
  {
    key: 'max_featured_requests_per_month',
    label: 'Max Featured Slot Requests / Mo',
    defaultValue: 0,
    unitLabel: 'requests/mo',
    description: 'Monthly quota for homepage Spotlight & featured map pin placement requests.',
  },
  {
    key: 'max_vehicle_listings',
    label: 'Max Inter-Hub Vehicle Listings',
    defaultValue: 2,
    unitLabel: 'vehicles',
    description: 'Scheduled buses, Boleros, Sumos & charter vehicles listed on /bookings.',
  },
] as const;

export interface EffectiveEntitlements {
  features: Partial<Record<SubscriptionFeatureKey, boolean | null>>;
  limits: Partial<Record<SubscriptionLimitKey, number | null>>;
  active_plan_ids: string[];
  is_super_admin_bypass?: boolean;
}

export function hasFeature(
  entitlements: EffectiveEntitlements | null | undefined,
  key: SubscriptionFeatureKey
): boolean {
  if (!entitlements) return false;
  if (entitlements.is_super_admin_bypass) return true;
  const direct = entitlements.features?.[key];
  if (typeof direct === 'boolean') return direct;
  const alias = FEATURE_KEY_ALIASES[key];
  if (alias && typeof entitlements.features?.[alias] === 'boolean') {
    return Boolean(entitlements.features[alias]);
  }
  return false;
}

export function getLimit(
  entitlements: EffectiveEntitlements | null | undefined,
  key: SubscriptionLimitKey
): number {
  const meta = SUBSCRIPTION_LIMIT_CATALOG.find((item) => item.key === key);
  const alias = LIMIT_KEY_ALIASES[key];
  const aliasMeta = alias
    ? SUBSCRIPTION_LIMIT_CATALOG.find((item) => item.key === alias)
    : undefined;
  const fallback = meta?.defaultValue ?? aliasMeta?.defaultValue ?? 0;

  if (!entitlements) return fallback;
  if (entitlements.is_super_admin_bypass) return -1;

  const featuresObj = entitlements.limits;
  if (featuresObj && key in featuresObj) {
    const val = featuresObj[key];
    if (val === null) return -1;
    if (typeof val === 'number' && Number.isFinite(val)) {
      return val < 0 ? -1 : val;
    }
  }
  if (featuresObj && alias && alias in featuresObj) {
    const aliasVal = featuresObj[alias];
    if (aliasVal === null) return -1;
    if (typeof aliasVal === 'number' && Number.isFinite(aliasVal)) {
      return aliasVal < 0 ? -1 : aliasVal;
    }
  }
  return fallback;
}

export function formatSubscriptionLimitValue(
  value: number | null | undefined
): string {
  if (value === null || value === undefined || value < 0) return 'Unlimited';
  return value.toLocaleString('en-IN');
}
