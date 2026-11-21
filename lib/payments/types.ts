export type PaymentPurpose =
  | 'pick_n_drop'
  | 'vehicle_booking'
  | 'bulletin_subscription'
  | 'bulletin_post_pass'
  | 'print_order'
  | 'print_order_with_delivery'
  | 'print_pro_subscription'
  | 'resource_booking'
  | 'booking_pro_subscription'
  | 'stay_pro_subscription';

export type PaymentProvider = 'manual_upi' | 'razorpay';

export type PaymentIntentStatus =
  | 'awaiting_payment'
  | 'pending_manual'
  | 'succeeded'
  | 'failed'
  | 'rejected'
  | 'refunded';

export interface PaymentIntentRecord {
  id: string;
  intent_code: string;
  user_id: string;
  hub_id?: string | null;
  purpose: PaymentPurpose;
  reference_id: string;
  print_order_id?: string | null;
  resource_booking_id?: string | null;
  amount_inr: number;
  base_amount_inr?: number | null;
  discount_inr?: number;
  convenience_fee_inr?: number;
  promo_code_id?: string | null;
  provider: PaymentProvider;
  provider_order_id: string | null;
  provider_payment_id: string | null;
  upi_utr_ref: string | null;
  payment_proof_path: string | null;
  status: PaymentIntentStatus;
  refund_utr_ref: string | null;
  refund_notes: string | null;
  verified_by: string | null;
  expires_at: string | null;
  created_at: string;
  updated_at: string;
}

export type VehicleBookingMode = 'full_vehicle' | 'per_seat' | 'both';
export type VehiclePricingModel = 'hourly' | 'daily' | 'per_km' | 'fixed_route';
export type VehicleBookingStatus =
  | 'soft_hold'
  | 'pending_payment_confirm'
  | 'confirmed'
  | 'in_progress'
  | 'completed'
  | 'cancelled'
  | 'expired';

export interface VehicleFixedRoute {
  origin: string;
  destination: string;
  fare_inr: number;
  full_vehicle_fare_inr?: number;
  duration_label?: string;
}

export interface VehicleListingRecord {
  id: string;
  origin_hub_id?: string | null;
  destination_hub_ids?: string[] | null;
  category_id?: string | null;
  locality_id?: string | null;
  custom_tags?: string[] | null;
  vehicle_id: string | null;
  owner_id: string;
  driver_id: string | null;
  vehicle_type_id: string;
  title: string;
  description: string | null;
  stand_locality: string;
  lat: number;
  lng: number;
  booking_mode: VehicleBookingMode;
  total_seats: number;
  pricing_model: VehiclePricingModel;
  rate_hourly_inr: number | null;
  rate_daily_inr: number | null;
  rate_per_km_inr: number | null;
  fixed_routes: VehicleFixedRoute[];
  advance_percent: number;
  with_driver: boolean;
  features: string[];
  thumbnail_url: string | null;
  image_urls: string[];
  panorama_url: string | null;
  is_active: boolean;
  is_verified: boolean;
  created_at: string;
  updated_at: string;
}

export interface VehicleAvailabilityBlockRecord {
  id: string;
  vehicle_listing_id: string;
  start_time: string;
  end_time: string;
  reason: 'offline_booking' | 'maintenance' | 'personal';
  notes: string | null;
  created_by: string | null;
  created_at: string;
}

export interface VehicleBookingRecord {
  id: string;
  hub_id?: string | null;
  booking_code: string;
  vehicle_listing_id: string;
  customer_id: string;
  payment_intent_id: string | null;
  booking_mode: 'full_vehicle' | 'per_seat';
  seats_booked: number;
  start_time: string;
  end_time: string;
  pickup_location: string;
  dropoff_location: string | null;
  instructions: string | null;
  total_fare_inr: number;
  advance_amount_inr: number;
  balance_due_inr: number;
  status: VehicleBookingStatus;
  hold_expires_at: string | null;
  start_otp: string | null;
  end_otp: string | null;
  created_at: string;
  updated_at: string;
}

export const ALLOWED_PAYMENT_PURPOSES: readonly PaymentPurpose[] = [
  'pick_n_drop',
  'vehicle_booking',
  'bulletin_subscription',
  'bulletin_post_pass',
  'print_order',
  'print_order_with_delivery',
  'print_pro_subscription',
  'resource_booking',
  'booking_pro_subscription',
  'stay_pro_subscription',
] as const;

export function isPaymentPurpose(value: unknown): value is PaymentPurpose {
  return (
    typeof value === 'string' &&
    (ALLOWED_PAYMENT_PURPOSES as readonly string[]).includes(value)
  );
}

export const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_REGEX.test(value.trim());
}

/**
 * Builds canonical UPI deep-link and payee metadata for any central payment intent.
 */
export function buildPlatformUpiDetails(params: {
  intentCode: string;
  amountInr: number;
  purpose: PaymentPurpose;
  upiIdOverride?: string | null;
  upiPayeeNameOverride?: string | null;
}): {
  upi_id: string;
  upi_payee_name: string;
  upi_deep_link: string;
} {
  const upiId = (
    params.upiIdOverride?.trim() ||
    process.env.PLATFORM_UPI_ID ||
    process.env.PICK_N_DROP_UPI_ID ||
    'printswift.escrow@upi'
  ).trim();
  const payeeName = (
    params.upiPayeeNameOverride?.trim() ||
    process.env.PLATFORM_UPI_PAYEE_NAME ||
    process.env.PICK_N_DROP_UPI_NAME ||
    'PrintSwift Local Escrow'
  ).trim();

  const formattedAmount = Math.max(0, Number(params.amountInr) || 0).toFixed(2);
  const purposeLabel = params.purpose.replace(/_/g, ' ');
  const note = `${params.intentCode} ${purposeLabel}`.slice(0, 50);

  const upiDeepLink = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(
    payeeName
  )}&am=${encodeURIComponent(formattedAmount)}&cu=INR&tn=${encodeURIComponent(
    note
  )}`;

  return {
    upi_id: upiId,
    upi_payee_name: payeeName,
    upi_deep_link: upiDeepLink,
  };
}
