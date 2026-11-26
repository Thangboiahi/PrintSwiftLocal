// =============================================================================
// Phase 73-C: Client-Safe Booking & Hotel Display Helpers
// =============================================================================

import type { BookingUnit, HotelStayType } from '@/lib/bookings/types';

export const BOOKING_UNIT_SHORT_LABELS: Record<BookingUnit, string> = {
  hourly: 'hr',
  slot: 'slot',
  half_day: 'half-day',
  full_day: 'day',
  weekly: 'week',
  nightly: 'night',
};

export const BOOKING_UNIT_FULL_LABELS: Record<BookingUnit, string> = {
  hourly: 'Per Hour',
  slot: 'Per Slot',
  half_day: 'Half-Day',
  full_day: 'Full Day',
  weekly: 'Per Week',
  nightly: 'Per Night',
};

export const HOTEL_STAY_TYPE_LABELS: Record<HotelStayType, string> = {
  hotel: 'Hotel',
  homestay: 'Homestay',
  guest_house: 'Guest House',
  lodge: 'Lodge',
  resort: 'Resort',
  pg_hostel: 'PG / Hostel',
};

export const HOTEL_AMENITY_LABELS: Record<string, string> = {
  wifi: 'Wi-Fi',
  hot_water: 'Hot Water',
  parking: 'Parking',
  power_backup: 'Power Backup',
  ac: 'AC',
  heater: 'Room Heater',
  in_house_kitchen: 'In-House Kitchen',
  early_checkin: 'Early Check-In',
};

export function getBookingUnitShortLabel(unit?: string | null): string {
  if (!unit) return 'slot';
  return (
    BOOKING_UNIT_SHORT_LABELS[unit as BookingUnit] ||
    unit.replace(/_/g, ' ')
  );
}

export function getHotelStayTypeLabel(stayType?: string | null): string {
  if (!stayType) return 'Hotel';
  return (
    HOTEL_STAY_TYPE_LABELS[stayType as HotelStayType] ||
    stayType.replace(/_/g, ' ')
  );
}

export function getAmenityLabel(key: string): string {
  return HOTEL_AMENITY_LABELS[key] || key.replace(/_/g, ' ');
}

export function formatBookingInr(amount: number): string {
  const num = Number.isFinite(amount) ? amount : 0;
  return `₹${Math.round(num).toLocaleString('en-IN')}`;
}

export function getTodayIstYmd(): string {
  const istNow = new Date(Date.now() + 330 * 60 * 1000);
  const yy = istNow.getUTCFullYear();
  const mm = String(istNow.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(istNow.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export function addDaysToYmd(ymd: string, daysToAdd: number): string {
  const parts = ymd.split('-').map(Number);
  if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) {
    return getTodayIstYmd();
  }
  const dt = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2] + daysToAdd));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

export function diffYmdDays(startYmd: string, endYmd: string): number {
  const sParts = startYmd.split('-').map(Number);
  const eParts = endYmd.split('-').map(Number);
  if (sParts.length !== 3 || eParts.length !== 3) return 1;
  const sMs = Date.UTC(sParts[0], sParts[1] - 1, sParts[2]);
  const eMs = Date.UTC(eParts[0], eParts[1] - 1, eParts[2]);
  return Math.max(1, Math.round((eMs - sMs) / 86_400_000));
}

export function formatShortIstDate(isoOrYmd: string): string {
  if (!isoOrYmd) return '';
  const dt = /^\d{4}-\d{2}-\d{2}$/.test(isoOrYmd)
    ? new Date(`${isoOrYmd}T06:00:00+05:30`)
    : new Date(isoOrYmd);
  if (Number.isNaN(dt.getTime())) return isoOrYmd;
  return dt.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    weekday: 'short',
    timeZone: 'Asia/Kolkata',
  });
}

export function formatIstDateTime(iso: string): string {
  if (!iso) return '';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return iso;
  return dt.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });
}

// Availability API response shapes matching GET /api/bookings/availability
export interface ApiSlotAvailability {
  startAt: string;
  endAt: string;
  label: string;
  totalUnits: number;
  bookedUnits: number;
  remainingUnits: number;
  rateInr: number;
  isPeak: boolean;
  isPast: boolean;
  isAvailable: boolean;
}

export interface ApiResourceAvailability {
  resourceId: string;
  resourceName: string;
  resourceVertical: 'booking_venue' | 'hotel_stay';
  bookingUnit: BookingUnit;
  date?: string;
  startAt?: string;
  endAt?: string;
  totalUnits: number;
  bookedUnits?: number;
  remainingUnits?: number;
  baseRateInr: number;
  peakRateInr?: number | null;
  peakStartHour?: number | null;
  advancePercent: number;
  availableSlotsCount?: number;
  isAvailable: boolean;
  durationCount?: number;
  durationLabel?: string;
  estimatedTotalInr?: number;
  slots?: ApiSlotAvailability[];
}

export interface ApiAvailabilityResponse {
  listingId: string;
  hubId: string;
  vertical: 'booking_venue' | 'hotel_stay';
  hasBookingEntitlement: boolean;
  isAcceptingBookings: boolean;
  checkInTime?: string;
  checkOutTime?: string;
  slots?: ApiSlotAvailability[];
  resources: ApiResourceAvailability[];
  error?: string;
}
