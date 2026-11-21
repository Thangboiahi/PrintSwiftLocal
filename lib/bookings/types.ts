// =============================================================================
// Phase 73-A: Universal Booking Engine & Hotels/Homestays TypeScript Contracts
// =============================================================================

export const BOOKING_UNITS = [
  'hourly',
  'slot',
  'half_day',
  'full_day',
  'weekly',
  'nightly',
] as const;

export type BookingUnit = (typeof BOOKING_UNITS)[number];

export const RESOURCE_VERTICALS = ['booking_venue', 'hotel_stay'] as const;
export type ResourceVertical = (typeof RESOURCE_VERTICALS)[number];

export const HOTEL_STAY_TYPES = [
  'hotel',
  'homestay',
  'guest_house',
  'lodge',
  'resort',
  'pg_hostel',
] as const;

export type HotelStayType = (typeof HOTEL_STAY_TYPES)[number];

export interface HotelAmenities {
  wifi: boolean;
  parking: boolean;
  hot_water: boolean;
  power_backup: boolean;
  ac: boolean;
  heater: boolean;
  in_house_kitchen: boolean;
  early_checkin: boolean;
  [key: string]: boolean;
}

export interface HotelPaymentPolicy {
  allow_direct_pay: boolean;
  advance_percent: number;
  allow_full_prepay: boolean;
  shop_upi_id: string | null;
  shop_upi_name: string | null;
  shop_upi_verified: boolean;
}

export interface ListingHotelProfile {
  listing_id: string;
  hub_id: string;
  stay_type: HotelStayType;
  check_in_time: string;
  check_out_time: string;
  amenities: HotelAmenities;
  verified_amenities: Record<string, boolean>;
  house_rules: string | null;
  cancellation_policy: string;
  id_requirement_note: string;
  is_accepting_bookings: boolean;
  payment_policy: HotelPaymentPolicy;
  created_at?: string;
  updated_at?: string;
}

export interface ResourceAddon {
  key: string;
  label: string;
  price_inr: number;
  per_unit?: boolean;
}

export interface ListingBookingResource {
  id: string;
  listing_id: string;
  hub_id: string;
  resource_vertical: ResourceVertical;
  name: string;
  description: string | null;
  booking_unit: BookingUnit;
  slot_duration_mins: number;
  open_hour: number;
  close_hour: number;
  total_units: number;
  max_guests: number;
  base_rate_inr: number;
  peak_rate_inr: number | null;
  peak_start_hour: number | null;
  advance_percent: number;
  addons: ResourceAddon[];
  photos: string[];
  is_active: boolean;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
}

export type BookingSource = 'online' | 'walk_in_block';

export type BookingPaymentRail =
  | 'direct_counter'
  | 'direct_shop_upi'
  | 'platform_escrow'
  | 'walk_in_manual';

export type BookingStatus =
  | 'pending_payment'
  | 'confirmed'
  | 'checked_in'
  | 'completed'
  | 'cancelled'
  | 'no_show'
  | 'blocked';

export type BookingPaymentStatus =
  | 'unpaid'
  | 'pending_manual_review'
  | 'advance_escrow_held'
  | 'fully_prepaid_escrow'
  | 'paid_direct_confirmed'
  | 'refunded'
  | 'not_applicable';

export type BookingSettlementStatus =
  | 'not_applicable'
  | 'locked'
  | 'eligible'
  | 'settled'
  | 'reversed';

export interface SelectedBookingAddon {
  key: string;
  label: string;
  price_inr: number;
  quantity?: number;
  total_inr: number;
}

export interface BookingPriceSnapshot {
  resource_id: string;
  resource_name: string;
  booking_unit: BookingUnit;
  units_booked: number;
  duration_count: number; // hours, slots, days, weeks, or nights
  duration_label: string;
  base_unit_rate_inr: number;
  peak_unit_rate_inr: number | null;
  standard_units_count: number;
  peak_units_count: number;
  subtotal_base_inr: number;
  addons_total_inr: number;
  addons: SelectedBookingAddon[];
  convenience_fee_inr: number;
  total_amount_inr: number;
  advance_percent: number;
  advance_amount_inr: number;
  balance_at_venue_inr: number;
  quoted_at: string;
}

export interface ResourceBooking {
  id: string;
  booking_code: string;
  hub_id: string;
  listing_id: string;
  resource_id: string;
  customer_id: string | null;
  booking_source: BookingSource;
  guest_name: string;
  guest_phone: string | null;
  start_at: string;
  end_at: string;
  units_booked: number;
  guests_count: number;
  selected_addons: SelectedBookingAddon[];
  price_snapshot: BookingPriceSnapshot | Record<string, unknown>;
  total_amount_inr: number;
  advance_amount_inr: number;
  balance_at_venue_inr: number;
  convenience_fee_inr: number;
  payment_rail: BookingPaymentRail;
  payment_intent_id: string | null;
  checkin_otp_hash?: string | null;
  checkin_otp_display_for_customer?: string | null;
  booking_status: BookingStatus;
  payment_status: BookingPaymentStatus;
  settlement_status: BookingSettlementStatus;
  checked_in_at: string | null;
  cancelled_at: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface AvailabilitySlot {
  start_at: string;
  end_at: string;
  label: string; // e.g., "05:00 PM – 06:00 PM"
  is_peak: boolean;
  rate_inr: number;
  total_units: number;
  booked_units: number;
  available_units: number;
  is_available: boolean;
}

export interface RoomAvailabilityResult {
  resource_id: string;
  resource_name: string;
  check_in: string; // YYYY-MM-DD or ISO
  check_out: string; // YYYY-MM-DD or ISO
  nights: number;
  total_units: number;
  max_booked_units_in_range: number;
  available_units: number;
  is_available: boolean;
  nightly_rate_inr: number;
  estimated_room_total_inr: number;
}

export interface BookingQuoteBreakdown {
  resource_id: string;
  resource_name: string;
  resource_vertical: ResourceVertical;
  booking_unit: BookingUnit;
  start_at: string;
  end_at: string;
  units_booked: number;
  guests_count: number;
  duration_count: number;
  duration_label: string;
  subtotal_base_inr: number;
  addons_total_inr: number;
  selected_addons: SelectedBookingAddon[];
  convenience_fee_inr: number;
  total_amount_inr: number;
  advance_percent: number;
  advance_amount_inr: number;
  balance_at_venue_inr: number;
  pay_now_inr: number;
  payment_option: 'advance' | 'full';
  snapshot: BookingPriceSnapshot;
}

export function isValidBookingUnit(val: unknown): val is BookingUnit {
  return (
    typeof val === 'string' &&
    (BOOKING_UNITS as readonly string[]).includes(val)
  );
}

export function isValidHotelStayType(val: unknown): val is HotelStayType {
  return (
    typeof val === 'string' &&
    (HOTEL_STAY_TYPES as readonly string[]).includes(val)
  );
}
