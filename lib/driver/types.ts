export type DriverNavSectionId =
  | 'overview'
  | 'job_board'
  | 'handovers'
  | 'vehicles'
  | 'payouts';

export type CanonicalFleetSlug =
  | 'cycle_rickshaw'
  | 'two_wheeler'
  | 'e_rickshaw'
  | 'mini_van'
  | 'pickup_truck';

export const DRIVER_FLEET_LABELS: Record<CanonicalFleetSlug, string> = {
  cycle_rickshaw: 'Cycle Rickshaw',
  two_wheeler: '2-Wheeler',
  e_rickshaw: 'Auto / E-Rickshaw',
  mini_van: 'Mini Van / Car',
  pickup_truck: 'Pickup Truck',
};

export function normalizeDriverFleetSlug(
  raw?: string | null
): CanonicalFleetSlug {
  const key = (raw || '').trim().toLowerCase();
  if (key === 'auto' || key === 'auto_rickshaw' || key === 'e_rickshaw') {
    return 'e_rickshaw';
  }
  if (key === 'car' || key === 'sedan' || key === 'suv' || key === 'mini_van') {
    return 'mini_van';
  }
  if (key === 'cycle_rickshaw') return 'cycle_rickshaw';
  if (key === 'pickup_truck' || key === 'pickup' || key === 'truck') {
    return 'pickup_truck';
  }
  return 'two_wheeler';
}

export function formatDriverFleetLabel(raw?: string | null): string {
  return DRIVER_FLEET_LABELS[normalizeDriverFleetSlug(raw)];
}

export interface DriverProfileRow {
  id: string;
  profile_id: string;
  hub_id: string | null;
  full_name: string;
  phone: string;
  license_no: string | null;
  vehicle_type: string;
  vehicle_reg_no: string | null;
  kyc_status: 'pending' | 'verified' | 'suspended' | string;
  kyc_verified: boolean;
  is_online: boolean;
  is_active: boolean;
}

export interface DriverActiveOrderRow {
  id: string;
  order_code: string;
  service_mode: 'parcel' | 'passenger' | 'gas' | string;
  trip_type: 'one_way' | 'two_way' | string;
  pickup_address: string;
  dropoff_address: string;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  distance_km: number;
  quoted_fare_inr: number;
  status: string;
  driver_substatus: 'arrived_pickup' | 'en_route_dropoff' | 'en_route_return' | null;
  pod_storage_path: string | null;
  pod_uploaded_at: string | null;
  pod_purge_at: string | null;
  pod_required: boolean | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface DriverAvailableJobRow {
  id: string;
  order_code: string;
  service_mode: 'parcel' | 'passenger' | 'gas' | string;
  trip_type: 'one_way' | 'two_way' | string;
  pickup_address: string;
  dropoff_address: string;
  pickup_lat: number | null;
  pickup_lng: number | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  distance_km: number;
  quoted_fare_inr: number;
  estimated_driver_payout_inr: number;
  status: string;
  escrow_funded: boolean;
  vehicle_type_slug: string;
  vehicle_type_name: string;
  pod_required: boolean;
  notes: string | null;
  created_at: string;
}

export interface DriverOtpMilestone {
  pickup_verified: boolean;
  pickup_verified_at: string | null;
  dropoff_verified: boolean;
  dropoff_verified_at: string | null;
  return_required: boolean;
  return_verified: boolean;
  return_verified_at: string | null;
  failed_attempts: number;
  is_locked: boolean;
  locked_until: string | null;
}

export interface DriverPayoutTripRow {
  id: string;
  domain: 'pick_n_drop' | 'vehicle_booking';
  code: string;
  service_mode: string;
  trip_type: string;
  origin_label: string;
  destination_label: string;
  distance_km: number | null;
  gross_fare_inr: number;
  net_payout_inr: number;
  trip_status: string;
  escrow_state: 'escrow_held' | 'released' | 'disputed' | 'refunded';
  payout_released_at: string | null;
  dispute_reason: string | null;
  created_at: string;
  updated_at: string;
}

export interface DriverPayoutSummary {
  driver_found: boolean;
  driver_id?: string | null;
  released_today_inr: number;
  released_total_inr: number;
  escrow_held_inr: number;
  completed_trips_count: number;
  disputed_count: number;
  trips: DriverPayoutTripRow[];
}

export type HandoverStage = 'pickup' | 'dropoff' | 'return';

export interface HandoverTarget {
  bookingId: string;
  domain: 'pick_n_drop' | 'vehicle_booking';
  code: string;
  stage: HandoverStage;
  podRequired: boolean;
  originLabel: string;
  destinationLabel: string;
}

export function formatInr(amount: number | null | undefined): string {
  const num = Number(amount ?? 0);
  if (!Number.isFinite(num)) return '₹0';
  return `₹${Math.round(num).toLocaleString('en-IN')}`;
}

export function formatServiceModeLabel(mode?: string | null): string {
  switch ((mode || '').toLowerCase()) {
    case 'gas':
      return 'LPG Two-Way';
    case 'passenger':
      return 'Passenger Ride';
    case 'full_vehicle':
      return 'Full Charter';
    case 'per_seat':
      return 'Per-Seat';
    default:
      return 'Parcel Delivery';
  }
}

export function buildSafeGoogleMapsRouteUrl(opts: {
  originLat?: number | null;
  originLng?: number | null;
  originAddress?: string | null;
  destLat?: number | null;
  destLng?: number | null;
  destAddress?: string | null;
}): string {
  const hasOriginCoords =
    typeof opts.originLat === 'number' &&
    typeof opts.originLng === 'number' &&
    Number.isFinite(opts.originLat) &&
    Number.isFinite(opts.originLng);

  const hasDestCoords =
    typeof opts.destLat === 'number' &&
    typeof opts.destLng === 'number' &&
    Number.isFinite(opts.destLat) &&
    Number.isFinite(opts.destLng);

  const dest = hasDestCoords
    ? `${opts.destLat},${opts.destLng}`
    : (opts.destAddress || '').trim();

  if (hasOriginCoords && dest) {
    return `https://www.google.com/maps/dir/?api=1&origin=${encodeURIComponent(
      `${opts.originLat},${opts.originLng}`
    )}&destination=${encodeURIComponent(dest)}&travelmode=driving`;
  }

  if (dest) {
    return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
      dest
    )}&travelmode=driving`;
  }

  const originText = (opts.originAddress || 'Churachandpur, Manipur').trim();
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
    originText
  )}`;
}

export function getNextHandoverStage(
  order: DriverActiveOrderRow,
  milestone?: DriverOtpMilestone | null
): HandoverStage | null {
  if (
    order.status === 'completed' ||
    order.status === 'cancelled' ||
    order.status === 'disputed' ||
    order.status === 'delivered_pending_confirm'
  ) {
    return null;
  }

  const pickupDone =
    Boolean(milestone?.pickup_verified) ||
    ['picked_up', 'in_transit', 'return_in_transit', 'delivered_pending_confirm'].includes(
      order.status
    );

  if (!pickupDone) return 'pickup';

  const dropoffDone =
    Boolean(milestone?.dropoff_verified) ||
    order.status === 'return_in_transit';

  if (!dropoffDone) return 'dropoff';

  const returnNeeded =
    Boolean(milestone?.return_required) || order.trip_type === 'two_way';

  if (returnNeeded && !milestone?.return_verified) {
    return 'return';
  }

  return null;
}
