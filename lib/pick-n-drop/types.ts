import type { CustomSelectOption } from '@/components/ui/CustomSelectModal';

export type DeliveryTripType = 'one_way' | 'two_way';

export type DeliveryServiceMode = 'parcel' | 'passenger' | 'gas';

export type DeliveryContainerType =
  | 'envelope'
  | 'small_box'
  | 'medium_parcel'
  | 'fragile_crate'
  | 'bulk_sack';

export type DeliveryOrderStatus =
  | 'awaiting_payment'
  | 'payment_submitted'
  | 'escrow_held'
  | 'driver_assigned'
  | 'picked_up'
  | 'in_transit'
  | 'delivered_pending_confirm'
  | 'return_in_transit'
  | 'completed'
  | 'cancelled'
  | 'disputed';

export interface PickNDropPoint {
  lat: number;
  lng: number;
  label: string;
}

export interface VehicleTypeItem {
  id: string;
  slug: string;
  name: string;
  icon: string | null;
  base_fare_inr: number;
  per_km_rate_inr: number;
  wait_per_10min_inr: number;
  free_wait_minutes: number;
  two_way_multiplier: number;
  max_weight_kg: number;
  max_dimensions: string | null;
  supported_modes: DeliveryServiceMode[];
  is_active: boolean;
}

export interface DriverRecord {
  id: string;
  profile_id: string | null;
  full_name: string;
  phone: string;
  license_no: string;
  kyc_verified: boolean;
  is_active: boolean;
  created_at?: string;
}

export interface VehicleRecord {
  id: string;
  driver_id: string | null;
  vehicle_type_id: string;
  plate_number: string;
  rc_number: string | null;
  model_name: string | null;
  is_available: boolean;
  updated_at?: string;
}

export interface DeliveryOrderSecretRecord {
  order_id: string;
  pickup_otp: string;
  dropoff_otp: string;
  return_otp: string | null;
  failed_attempts: number;
  locked_until: string | null;
}

export interface DeliveryTransactionRecord {
  id: string;
  order_id: string;
  tx_type:
    | 'upi_payment'
    | 'escrow_hold'
    | 'driver_payout'
    | 'platform_commission'
    | 'refund'
    | 'cancellation_fee';
  amount_inr: number;
  upi_utr_ref: string | null;
  payment_proof_path: string | null;
  recorded_by: string | null;
  notes: string | null;
  created_at: string;
}

export interface DeliveryOrderRecord {
  id: string;
  order_code: string;
  hub_id?: string | null;
  customer_id: string;
  mediator_id: string | null;
  driver_id: string | null;
  vehicle_id: string | null;
  vehicle_type_id: string;
  service_mode?: DeliveryServiceMode;
  trip_type: DeliveryTripType;
  container_type: DeliveryContainerType | null;
  instructions?: string | null;
  passenger_count?: number | null;
  cylinder_count?: number | null;
  pod_required?: boolean;
  declared_value_inr: number;
  prohibited_items_waiver: boolean;
  pickup_address: string;
  pickup_landmark: string | null;
  sender_phone: string;
  dropoff_address: string;
  dropoff_landmark: string | null;
  recipient_name: string | null;
  recipient_phone: string | null;
  distance_km: number;
  quoted_fare_inr: number;
  quote_expires_at: string;
  status: DeliveryOrderStatus;
  pod_storage_path: string | null;
  pod_uploaded_at: string | null;
  pod_purge_at: string | null;
  linked_print_order_id?: string | null;
  linked_shop_order_id?: string | null;
  linked_restaurant_order_id?: string | null;
  is_food_order?: boolean;
  sealed_package_required?: boolean;
  created_at: string;
  updated_at?: string;
  // Hydrated client relations
  vehicle_type?: VehicleTypeItem | null;
  driver?: DriverRecord | null;
  vehicle?: VehicleRecord | null;
  secrets?: DeliveryOrderSecretRecord | null;
  transactions?: DeliveryTransactionRecord[];
  linked_print_order_code?: string | null;
}

export interface QuoteBreakdownClient {
  vehicle_type_id: string;
  vehicle_type_slug: string;
  vehicle_type_name: string;
  service_mode?: DeliveryServiceMode;
  base_fare_inr: number;
  per_km_rate_inr: number;
  distance_km: number;
  distance_source: 'google_distance_matrix' | 'haversine_fallback';
  distance_fare_inr: number;
  one_way_subtotal_inr: number;
  trip_type: DeliveryTripType;
  two_way_multiplier: number;
  trip_fare_inr: number;
  container_type: DeliveryContainerType | null;
  container_surcharge_inr: number;
  cylinder_count?: number;
  cylinder_surcharge_inr?: number;
  surcharge_total_inr?: number;
  one_way_fare_inr: number;
  two_way_fare_inr: number;
  total_fare_inr: number;
  free_wait_minutes: number;
  wait_per_10min_inr: number;
}

export interface QuoteApiResponse {
  distance_km: number;
  one_way_fare_inr: number;
  two_way_fare_inr: number;
  total_fare_inr: number;
  breakdown: QuoteBreakdownClient;
  fare_breakdown?: QuoteBreakdownClient;
  expires_at: string;
}

export interface ManualUpiPaymentInstructions {
  upi_id: string;
  payee_name: string;
  amount_inr: number;
  order_code: string;
  payment_note: string;
  upi_uri: string;
  steps: string[];
}

export const SERVICE_MODE_META: Record<
  DeliveryServiceMode,
  { label: string; shortLabel: string; description: string }
> = {
  parcel: {
    label: 'Parcel',
    shortLabel: 'Parcel',
    description: 'Send documents, boxes, groceries, or cargo',
  },
  passenger: {
    label: 'Ride (Taxi)',
    shortLabel: 'Ride (Taxi)',
    description: 'Book a quick scooty, auto, or local cab ride',
  },
  gas: {
    label: 'LPG Gas',
    shortLabel: 'LPG Gas',
    description: 'Cylinder pickup & agency refill return trip',
  },
};

export const CONTAINER_TYPE_OPTIONS: CustomSelectOption[] = [
  {
    value: 'envelope',
    label: 'Envelope / Docs',
    description: 'Documents, letters, keys, or slim folders (No surcharge)',
  },
  {
    value: 'small_box',
    label: 'Small Box',
    description: 'Compact box up to 5 kg (No surcharge)',
  },
  {
    value: 'medium_parcel',
    label: 'Medium Parcel',
    description: 'Standard carton or shopping bag (No surcharge)',
  },
  {
    value: 'fragile_crate',
    label: 'Fragile Crate (+₹30)',
    description: 'Glassware, electronics, or delicate items requiring care',
  },
  {
    value: 'bulk_sack',
    label: 'Bulk Sack (+₹50)',
    description: 'Heavy sacks, hardware, or multi-piece wholesale cargo',
  },
];

export const CONTAINER_LABELS: Record<DeliveryContainerType, string> = {
  envelope: 'Envelope / Docs',
  small_box: 'Small Box',
  medium_parcel: 'Medium Parcel',
  fragile_crate: 'Fragile Crate (+₹30)',
  bulk_sack: 'Bulk Sack (+₹50)',
};

export const INSTRUCTION_QUICK_CHIPS = [
  'Call on arrival',
  'Near main gate',
  'Empty cylinder ready',
  'Fragile',
] as const;

export const FALLBACK_VEHICLE_TYPES: VehicleTypeItem[] = [
  {
    id: 'cycle_rickshaw',
    slug: 'cycle_rickshaw',
    name: 'Cycle Rickshaw',
    icon: 'bike',
    base_fare_inr: 30,
    per_km_rate_inr: 8,
    wait_per_10min_inr: 10,
    free_wait_minutes: 15,
    two_way_multiplier: 1.75,
    max_weight_kg: 80,
    max_dimensions: '90 x 70 x 70 cm',
    supported_modes: ['parcel', 'gas'],
    is_active: true,
  },
  {
    id: 'two_wheeler',
    slug: 'two_wheeler',
    name: 'Scooty / Two-Wheeler',
    icon: 'bike',
    base_fare_inr: 40,
    per_km_rate_inr: 10,
    wait_per_10min_inr: 15,
    free_wait_minutes: 15,
    two_way_multiplier: 1.75,
    max_weight_kg: 15,
    max_dimensions: '40 x 30 x 30 cm',
    supported_modes: ['parcel', 'passenger', 'gas'],
    is_active: true,
  },
  {
    id: 'e_rickshaw',
    slug: 'e_rickshaw',
    name: 'E-Rickshaw / Auto',
    icon: 'car-taxi-front',
    base_fare_inr: 70,
    per_km_rate_inr: 15,
    wait_per_10min_inr: 20,
    free_wait_minutes: 15,
    two_way_multiplier: 1.75,
    max_weight_kg: 150,
    max_dimensions: '100 x 80 x 80 cm',
    supported_modes: ['parcel', 'passenger', 'gas'],
    is_active: true,
  },
  {
    id: 'mini_van',
    slug: 'mini_van',
    name: 'Mini Van / Alto',
    icon: 'car',
    base_fare_inr: 120,
    per_km_rate_inr: 20,
    wait_per_10min_inr: 25,
    free_wait_minutes: 15,
    two_way_multiplier: 1.75,
    max_weight_kg: 300,
    max_dimensions: '130 x 100 x 90 cm',
    supported_modes: ['parcel', 'passenger'],
    is_active: true,
  },
  {
    id: 'pickup_truck',
    slug: 'pickup_truck',
    name: 'Pickup Truck / Bolero',
    icon: 'truck',
    base_fare_inr: 250,
    per_km_rate_inr: 30,
    wait_per_10min_inr: 40,
    free_wait_minutes: 20,
    two_way_multiplier: 1.75,
    max_weight_kg: 1000,
    max_dimensions: '220 x 150 x 120 cm',
    supported_modes: ['parcel', 'gas'],
    is_active: true,
  },
];

export const LAMKA_QUICK_LANDMARKS: PickNDropPoint[] = [
  { lat: 24.3335, lng: 93.6978, label: 'Lamka Main Bazaar / Police Point' },
  { lat: 24.3412, lng: 93.7024, label: 'New Lamka Central' },
  { lat: 24.3264, lng: 93.7056, label: 'Rengkai Bazar' },
  { lat: 24.3515, lng: 93.7082, label: 'Tuibong Bazar / DC Office' },
  { lat: 24.3372, lng: 93.6941, label: 'District Hospital Churachandpur' },
  { lat: 24.3298, lng: 93.6922, label: 'Hiangtam Lamka' },
  { lat: 24.3215, lng: 93.6885, label: 'Zenhang Lamka / Bungmual' },
];

export const ORDER_PROGRESS_STEPS: Array<{
  key: string;
  label: string;
  shortLabel: string;
}> = [
  { key: 'payment_submitted', label: 'Payment Submitted', shortLabel: 'Paid' },
  { key: 'escrow_held', label: 'Escrow Held', shortLabel: 'Escrow' },
  { key: 'driver_assigned', label: 'Driver Assigned', shortLabel: 'Assigned' },
  { key: 'picked_up', label: 'Picked Up', shortLabel: 'In Transit' },
  { key: 'delivered_pending_confirm', label: 'Delivered', shortLabel: 'Delivered' },
  { key: 'completed', label: 'Completed', shortLabel: 'Completed' },
];

export function getOrderProgressIndex(status: DeliveryOrderStatus): number {
  switch (status) {
    case 'awaiting_payment':
      return -1;
    case 'payment_submitted':
      return 0;
    case 'escrow_held':
      return 1;
    case 'driver_assigned':
      return 2;
    case 'picked_up':
    case 'in_transit':
    case 'return_in_transit':
      return 3;
    case 'delivered_pending_confirm':
      return 4;
    case 'completed':
      return 5;
    default:
      return -1;
  }
}

export const DELIVERY_STATUS_META: Record<
  DeliveryOrderStatus,
  { label: string; badgeClass: string }
> = {
  awaiting_payment: {
    label: 'Awaiting UPI Payment',
    badgeClass:
      'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
  },
  payment_submitted: {
    label: 'Payment Submitted',
    badgeClass:
      'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30',
  },
  escrow_held: {
    label: 'Escrow Held',
    badgeClass:
      'bg-indigo-500/15 text-indigo-700 dark:text-indigo-300 border-indigo-500/30',
  },
  driver_assigned: {
    label: 'Driver Assigned',
    badgeClass:
      'bg-violet-500/15 text-violet-700 dark:text-violet-300 border-violet-500/30',
  },
  picked_up: {
    label: 'Picked Up',
    badgeClass:
      'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30',
  },
  in_transit: {
    label: 'In Transit',
    badgeClass:
      'bg-blue-500/15 text-blue-700 dark:text-blue-300 border-blue-500/30',
  },
  return_in_transit: {
    label: 'Return In Transit',
    badgeClass:
      'bg-cyan-500/15 text-cyan-700 dark:text-cyan-300 border-cyan-500/30',
  },
  delivered_pending_confirm: {
    label: 'Delivered (Pending Confirm)',
    badgeClass:
      'bg-teal-500/15 text-teal-700 dark:text-teal-300 border-teal-500/30',
  },
  completed: {
    label: 'Completed',
    badgeClass:
      'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  },
  cancelled: {
    label: 'Cancelled',
    badgeClass:
      'bg-slate-500/15 text-slate-600 dark:text-slate-400 border-slate-500/30',
  },
  disputed: {
    label: 'Disputed',
    badgeClass:
      'bg-rose-500/15 text-rose-700 dark:text-rose-300 border-rose-500/30',
  },
};

export function sanitizePhoneForWhatsApp(rawPhone: string): string {
  const digits = (rawPhone || '').replace(/\D/g, '');
  if (digits.length === 10) return `91${digits}`;
  return digits;
}

export function buildDropoffOtpWhatsAppUrl(params: {
  recipientPhone: string;
  recipientName: string;
  orderCode: string;
  dropoffOtp: string;
}): string {
  const cleanPhone = sanitizePhoneForWhatsApp(params.recipientPhone);
  const message = `Hi ${params.recipientName || 'there'}, your PrintSwift Local Pick N Drop delivery (${params.orderCode}) is on its way! Please share this Dropoff OTP with the driver ONLY when you receive the parcel: *${params.dropoffOtp}*`;
  return `https://wa.me/${cleanPhone}?text=${encodeURIComponent(message)}`;
}
