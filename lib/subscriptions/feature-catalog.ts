/**
 * DD oodle — Pass R2: Composable Feature & Quota Subscription Catalog
 * Single source of truth for all 13 composable feature flags and 8 numeric quotas
 * backed by `subscription_plans.features`, `subscription_plans.limits`, and
 * `get_effective_entitlements(p_user_id, p_listing_id)`.
 */

export type SubscriptionFeatureKey =
  | 'print_online_orders'
  | 'print_custom_digital'
  | 'booking_slots'
  | 'hotel_multi_room'
  | 'shop_basket_checkout'
  | 'restaurant_menu_ordering'
  | 'restaurant_table_booking'
  | 'pick_n_drop_dispatch'
  | 'real_estate_verified_boost'
  | 'bulletin_posting'
  | 'counter_qr_posters'
  | 'staff_delegation'
  | 'featured_map_pin';

export type SubscriptionLimitKey =
  | 'max_active_listings'
  | 'max_catalogue_items'
  | 'max_menu_items'
  | 'max_booking_resources'
  | 'max_staff_members'
  | 'max_monthly_bulletins'
  | 'max_media_per_listing'
  | 'active_boost_slots';

export interface SubscriptionFeatureMeta {
  key: SubscriptionFeatureKey;
  label: string;
  verticalGroup:
    | 'Print & Digital'
    | 'Bookings & Stays'
    | 'Shop & Food'
    | 'Real Estate'
    | 'Growth & Ops';
  description: string;
}

export interface SubscriptionLimitMeta {
  key: SubscriptionLimitKey;
  label: string;
  defaultValue: number; // -1 = Unlimited
  unitLabel: string;
}

export const SUBSCRIPTION_FEATURE_CATALOG: readonly SubscriptionFeatureMeta[] =
  [
    {
      key: 'print_online_orders',
      label: 'Online Print Ordering',
      verticalGroup: 'Print & Digital',
      description: 'Accept PDF/photo print jobs with automated pricing & OTP pickup.',
    },
    {
      key: 'print_custom_digital',
      label: 'Custom Digital Quotes',
      verticalGroup: 'Print & Digital',
      description: 'Receive custom design/flex/card briefs and send instant quotes.',
    },
    {
      key: 'booking_slots',
      label: 'Venue & Turf Slot Booking',
      verticalGroup: 'Bookings & Stays',
      description: 'Live hourly/half-day/full-day slot grids with atomic overlap locks.',
    },
    {
      key: 'hotel_multi_room',
      label: 'Multi-Room Hotel Inventory',
      verticalGroup: 'Bookings & Stays',
      description: 'Nightly room inventory, check-in OTPs, and hospitality amenities.',
    },
    {
      key: 'shop_basket_checkout',
      label: 'Shop Basket Checkout',
      verticalGroup: 'Shop & Food',
      description: '0% commission storefront basket checkout with 1-tap stock toggles.',
    },
    {
      key: 'restaurant_menu_ordering',
      label: 'Digital Menu Ordering',
      verticalGroup: 'Shop & Food',
      description: '0% commission Veg/Non-Veg digital menu with variants & add-ons.',
    },
    {
      key: 'restaurant_table_booking',
      label: 'Table Reservations',
      verticalGroup: 'Shop & Food',
      description: 'Accept and confirm dine-in table reservations with guest tracking.',
    },
    {
      key: 'pick_n_drop_dispatch',
      label: 'Pick N Drop Dispatch',
      verticalGroup: 'Shop & Food',
      description: 'Auto-dispatch local riders for sealed print, shop, and hot-food orders.',
    },
    {
      key: 'real_estate_verified_boost',
      label: 'Real Estate Verified Boost',
      verticalGroup: 'Real Estate',
      description: '30-day verified priority boost for property listings.',
    },
    {
      key: 'bulletin_posting',
      label: 'Community Bulletin Posting',
      verticalGroup: 'Growth & Ops',
      description: 'Publish local announcements, offers, jobs, and hub-targeted notices.',
    },
    {
      key: 'counter_qr_posters',
      label: 'Printable Counter & Table QR Posters',
      verticalGroup: 'Growth & Ops',
      description: 'Generate print-ready A5/A4 QR posters for counters and restaurant tables.',
    },
    {
      key: 'staff_delegation',
      label: 'Staff Delegation Desk',
      verticalGroup: 'Growth & Ops',
      description: 'Delegate live queue & stock operations to staff without billing access.',
    },
    {
      key: 'featured_map_pin',
      label: 'Featured Map Pin Highlight',
      verticalGroup: 'Growth & Ops',
      description: 'High-visibility gold-ring map pin and priority card placement.',
    },
  ] as const;

export const SUBSCRIPTION_LIMIT_CATALOG: readonly SubscriptionLimitMeta[] = [
  {
    key: 'max_active_listings',
    label: 'Max Active Listings',
    defaultValue: 2,
    unitLabel: 'listings',
  },
  {
    key: 'max_catalogue_items',
    label: 'Max Shop Catalogue Items',
    defaultValue: 50,
    unitLabel: 'items',
  },
  {
    key: 'max_menu_items',
    label: 'Max Restaurant Menu Items',
    defaultValue: 50,
    unitLabel: 'dishes',
  },
  {
    key: 'max_booking_resources',
    label: 'Max Bookable Spaces / Rooms',
    defaultValue: 5,
    unitLabel: 'resources',
  },
  {
    key: 'max_staff_members',
    label: 'Max Delegated Staff Seats',
    defaultValue: 2,
    unitLabel: 'staff',
  },
  {
    key: 'max_monthly_bulletins',
    label: 'Max Monthly Bulletins',
    defaultValue: 5,
    unitLabel: 'posts/mo',
  },
  {
    key: 'max_media_per_listing',
    label: 'Max Photos per Listing',
    defaultValue: 8,
    unitLabel: 'photos',
  },
  {
    key: 'active_boost_slots',
    label: 'Active Featured Boost Slots',
    defaultValue: 0,
    unitLabel: 'slots',
  },
] as const;

export interface EffectiveEntitlements {
  features: Partial<Record<SubscriptionFeatureKey, boolean>>;
  limits: Partial<Record<SubscriptionLimitKey, number>>;
  active_plan_ids: string[];
  is_super_admin_bypass?: boolean;
}

export function hasFeature(
  entitlements: EffectiveEntitlements | null | undefined,
  key: SubscriptionFeatureKey
): boolean {
  if (!entitlements) return false;
  if (entitlements.is_super_admin_bypass) return true;
  return entitlements.features?.[key] === true;
}

export function getLimit(
  entitlements: EffectiveEntitlements | null | undefined,
  key: SubscriptionLimitKey
): number {
  const meta = SUBSCRIPTION_LIMIT_CATALOG.find((item) => item.key === key);
  const fallback = meta ? meta.defaultValue : 0;
  if (!entitlements) return fallback;
  if (entitlements.is_super_admin_bypass) return -1;
  const val = entitlements.limits?.[key];
  return typeof val === 'number' && Number.isFinite(val) ? val : fallback;
}

export function formatSubscriptionLimitValue(value: number): string {
  if (value < 0) return 'Unlimited';
  return value.toLocaleString('en-IN');
}
