// =============================================================================
// Phase 73-B: Isolated Booking Venue & Hotel Stay Pricing Engine
// Pure deterministic calculation for hourly/slot/half-day/full-day/weekly/nightly
// =============================================================================

import type {
  BookingPaymentRail,
  BookingPriceSnapshot,
  BookingQuoteBreakdown,
  BookingSource,
  ListingBookingResource,
  ResourceAddon,
  SelectedBookingAddon,
} from '@/lib/bookings/types';

export const DEFAULT_CONVENIENCE_FEE_PERCENT = 3;
export const DEFAULT_CONVENIENCE_FEE_CAP_INR = 149;

// India Standard Time (UTC+05:30) — ensures peak-hour and slot calculations
// remain deterministic regardless of the Node.js server timezone.
export const IST_OFFSET_MINUTES = 330;
export const IST_OFFSET_MS = IST_OFFSET_MINUTES * 60 * 1000;
export const MS_PER_DAY = 86_400_000;
export const MS_PER_WEEK = 7 * MS_PER_DAY;

export class BookingPricingError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(
    message: string,
    statusCode = 400,
    code = 'BOOKING_PRICING_ERROR'
  ) {
    super(message);
    this.name = 'BookingPricingError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export interface ComputeBookingPriceInput {
  resource: ListingBookingResource;
  startAt: string | Date;
  endAt: string | Date;
  unitsBooked?: number;
  guestsCount?: number;
  selectedAddonKeys?: string[];
  convenienceFeePercent?: number;
  convenienceFeeCapInr?: number;
  payFullUpfront?: boolean;
  paymentRail?: BookingPaymentRail;
  bookingSource?: BookingSource;
  advancePercentOverride?: number | null;
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Returns the hour of day (0..23) in IST (+05:30) for an epoch timestamp.
 */
export function getIstHour(epochMs: number): number {
  const shifted = new Date(epochMs + IST_OFFSET_MS);
  return shifted.getUTCHours();
}

/**
 * Returns whether an epoch timestamp falls into the resource's peak pricing window.
 */
export function isPeakStartTimestamp(
  resource: Pick<ListingBookingResource, 'peak_rate_inr' | 'peak_start_hour'>,
  epochMs: number
): boolean {
  if (
    resource.peak_rate_inr === null ||
    resource.peak_rate_inr === undefined ||
    !Number.isFinite(Number(resource.peak_rate_inr))
  ) {
    return false;
  }
  if (
    resource.peak_start_hour === null ||
    resource.peak_start_hour === undefined ||
    !Number.isFinite(Number(resource.peak_start_hour))
  ) {
    return false;
  }
  return getIstHour(epochMs) >= Number(resource.peak_start_hour);
}

function parseTimestamp(value: string | Date, label: string): Date {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new BookingPricingError(
      `Invalid ${label} timestamp provided.`,
      400,
      'INVALID_TIMESTAMP'
    );
  }
  return date;
}

/**
 * Computes an immutable, server-authoritative booking quote breakdown for both
 * `booking_venue` (hourly/slot/half_day/full_day/weekly) and `hotel_stay` (nightly).
 */
export function computeBookingPrice(
  input: ComputeBookingPriceInput
): Readonly<BookingQuoteBreakdown> {
  const {
    resource,
    startAt,
    endAt,
    selectedAddonKeys = [],
    convenienceFeePercent = DEFAULT_CONVENIENCE_FEE_PERCENT,
    convenienceFeeCapInr = DEFAULT_CONVENIENCE_FEE_CAP_INR,
    payFullUpfront = false,
    paymentRail = 'platform_escrow',
    bookingSource = 'online',
    advancePercentOverride = null,
  } = input;

  if (!resource || !resource.id) {
    throw new BookingPricingError(
      'A valid booking resource is required to compute pricing.',
      400,
      'INVALID_RESOURCE'
    );
  }

  const startDate = parseTimestamp(startAt, 'startAt');
  const endDate = parseTimestamp(endAt, 'endAt');
  const startMs = startDate.getTime();
  const endMs = endDate.getTime();

  if (endMs <= startMs) {
    throw new BookingPricingError(
      'End time must be strictly after start time.',
      400,
      'INVALID_TIME_RANGE'
    );
  }

  const unitsBooked = Math.floor(Number(input.unitsBooked ?? 1));
  if (!Number.isFinite(unitsBooked) || unitsBooked < 1) {
    throw new BookingPricingError(
      'unitsBooked must be an integer of at least 1.',
      400,
      'INVALID_UNITS'
    );
  }

  const totalUnits = Math.max(1, Math.floor(Number(resource.total_units || 1)));
  if (unitsBooked > totalUnits) {
    throw new BookingPricingError(
      `Requested ${unitsBooked} units exceeds total available inventory (${totalUnits}) for ${resource.name}.`,
      400,
      'UNITS_EXCEED_INVENTORY'
    );
  }

  const guestsCount = Math.max(1, Math.floor(Number(input.guestsCount ?? 1)));
  const baseRate = Math.max(0, Number(resource.base_rate_inr || 0));
  const peakRate =
    resource.peak_rate_inr !== null &&
    resource.peak_rate_inr !== undefined &&
    Number.isFinite(Number(resource.peak_rate_inr))
      ? Math.max(0, Number(resource.peak_rate_inr))
      : null;

  const durationMs = endMs - startMs;
  let durationCount = 1;
  let durationLabel = '1 unit';
  let standardUnitsCount = 0;
  let peakUnitsCount = 0;
  let singleUnitBaseSubtotal = 0;

  switch (resource.booking_unit) {
    case 'hourly':
    case 'slot': {
      const slotDurationMins = Math.max(
        15,
        Math.floor(Number(resource.slot_duration_mins || 60))
      );
      const slotMs = slotDurationMins * 60 * 1000;
      const slotCount = Math.max(1, Math.ceil(durationMs / slotMs));

      for (let i = 0; i < slotCount; i += 1) {
        const slotStartMs = startMs + i * slotMs;
        if (peakRate !== null && isPeakStartTimestamp(resource, slotStartMs)) {
          peakUnitsCount += 1;
          singleUnitBaseSubtotal += peakRate;
        } else {
          standardUnitsCount += 1;
          singleUnitBaseSubtotal += baseRate;
        }
      }

      durationCount = slotCount;
      if (resource.booking_unit === 'hourly' && slotDurationMins === 60) {
        durationLabel = `${slotCount} ${slotCount === 1 ? 'hr' : 'hrs'}`;
      } else {
        durationLabel = `${slotCount} ${slotCount === 1 ? 'slot' : 'slots'} (${slotDurationMins}m)`;
      }
      break;
    }

    case 'half_day': {
      const halfDayMins = Math.max(
        60,
        Math.floor(Number(resource.slot_duration_mins || 300))
      );
      const halfDayMs = halfDayMins * 60 * 1000;
      const blocks = Math.max(1, Math.ceil(durationMs / halfDayMs));
      durationCount = blocks;
      standardUnitsCount = blocks;
      singleUnitBaseSubtotal = blocks * baseRate;
      durationLabel = `${blocks} ${blocks === 1 ? 'half-day' : 'half-days'}`;
      break;
    }

    case 'full_day': {
      const days = Math.max(1, Math.ceil(durationMs / MS_PER_DAY));
      durationCount = days;
      standardUnitsCount = days;
      singleUnitBaseSubtotal = days * baseRate;
      durationLabel = `${days} ${days === 1 ? 'day' : 'days'}`;
      break;
    }

    case 'weekly': {
      const weeks = Math.max(1, Math.ceil(durationMs / MS_PER_WEEK));
      durationCount = weeks;
      standardUnitsCount = weeks;
      singleUnitBaseSubtotal = weeks * baseRate;
      durationLabel = `${weeks} ${weeks === 1 ? 'week' : 'weeks'}`;
      break;
    }

    case 'nightly': {
      const nights = Math.max(1, Math.ceil(durationMs / MS_PER_DAY));
      durationCount = nights;
      standardUnitsCount = nights;
      singleUnitBaseSubtotal = nights * baseRate;
      durationLabel = `${nights} ${nights === 1 ? 'night' : 'nights'}`;
      break;
    }

    default: {
      throw new BookingPricingError(
        `Unsupported booking unit "${String(resource.booking_unit)}".`,
        400,
        'UNSUPPORTED_BOOKING_UNIT'
      );
    }
  }

  const subtotalBaseInr = round2(singleUnitBaseSubtotal * unitsBooked);

  // Selected add-ons (respecting `per_unit` multiplier when flagged)
  const availableAddons: ResourceAddon[] = Array.isArray(resource.addons)
    ? resource.addons
    : [];
  const addonByKey = new Map<string, ResourceAddon>();
  for (const addon of availableAddons) {
    if (addon && typeof addon.key === 'string' && addon.key.trim()) {
      addonByKey.set(addon.key.trim(), addon);
    }
  }

  const seenAddonKeys = new Set<string>();
  const selectedAddons: SelectedBookingAddon[] = [];
  let addonsTotalInr = 0;

  for (const rawKey of selectedAddonKeys) {
    const key = String(rawKey || '').trim();
    if (!key || seenAddonKeys.has(key)) continue;
    const addon = addonByKey.get(key);
    if (!addon) continue;

    seenAddonKeys.add(key);
    const unitPrice = Math.max(0, Number(addon.price_inr || 0));
    // For `per_unit` add-ons: multiply by room-nights on nightly stays, or by unitsBooked on venues
    const multiplier = addon.per_unit
      ? resource.booking_unit === 'nightly'
        ? unitsBooked * durationCount
        : unitsBooked
      : 1;
    const totalInr = round2(unitPrice * multiplier);
    addonsTotalInr = round2(addonsTotalInr + totalInr);

    selectedAddons.push(
      Object.freeze({
        key: addon.key,
        label: addon.label,
        price_inr: unitPrice,
        quantity: multiplier,
        total_inr: totalInr,
      })
    );
  }

  const serviceSubtotalInr = round2(subtotalBaseInr + addonsTotalInr);

  // Advance & balance split
  const rawAdvancePct = payFullUpfront
    ? 100
    : advancePercentOverride !== null &&
        advancePercentOverride !== undefined &&
        Number.isFinite(Number(advancePercentOverride))
      ? Number(advancePercentOverride)
      : Number(resource.advance_percent ?? 30);

  const effectiveAdvancePercent = Math.min(
    100,
    Math.max(0, Math.round(rawAdvancePct))
  );

  const isWalkInManual =
    bookingSource === 'walk_in_block' || paymentRail === 'walk_in_manual';
  const isDirectCounterOnly =
    paymentRail === 'direct_counter' || paymentRail === 'direct_shop_upi';

  const advanceAmountInr = isWalkInManual
    ? 0
    : payFullUpfront
      ? serviceSubtotalInr
      : Math.round(serviceSubtotalInr * (effectiveAdvancePercent / 100));

  const balanceAtVenueInr = round2(
    Math.max(0, serviceSubtotalInr - advanceAmountInr)
  );

  // Transparent convenience fee applies ONLY on Platform Escrow advances
  const safeFeePercent = Math.max(0, Number(convenienceFeePercent || 0));
  const safeFeeCap = Math.max(0, Number(convenienceFeeCapInr || 0));

  const isEscrowPayable =
    !isWalkInManual &&
    !isDirectCounterOnly &&
    paymentRail === 'platform_escrow' &&
    advanceAmountInr > 0;

  const convenienceFeeInr = isEscrowPayable
    ? Math.min(
        safeFeeCap,
        Math.round(advanceAmountInr * (safeFeePercent / 100))
      )
    : 0;

  const totalAmountInr = round2(serviceSubtotalInr + convenienceFeeInr);
  const payNowInr = isEscrowPayable
    ? round2(advanceAmountInr + convenienceFeeInr)
    : 0;

  const quotedAt = new Date().toISOString();
  const frozenAddons = Object.freeze([...selectedAddons]);

  const snapshot: Readonly<BookingPriceSnapshot> = Object.freeze({
    resource_id: resource.id,
    resource_name: resource.name,
    booking_unit: resource.booking_unit,
    units_booked: unitsBooked,
    duration_count: durationCount,
    duration_label: durationLabel,
    base_unit_rate_inr: baseRate,
    peak_unit_rate_inr: peakRate,
    standard_units_count: standardUnitsCount,
    peak_units_count: peakUnitsCount,
    subtotal_base_inr: subtotalBaseInr,
    addons_total_inr: addonsTotalInr,
    addons: frozenAddons as SelectedBookingAddon[],
    convenience_fee_inr: convenienceFeeInr,
    total_amount_inr: totalAmountInr,
    advance_percent: effectiveAdvancePercent,
    advance_amount_inr: advanceAmountInr,
    balance_at_venue_inr: balanceAtVenueInr,
    quoted_at: quotedAt,
  });

  const breakdown: Readonly<BookingQuoteBreakdown> = Object.freeze({
    resource_id: resource.id,
    resource_name: resource.name,
    resource_vertical: resource.resource_vertical,
    booking_unit: resource.booking_unit,
    start_at: startDate.toISOString(),
    end_at: endDate.toISOString(),
    units_booked: unitsBooked,
    guests_count: guestsCount,
    duration_count: durationCount,
    duration_label: durationLabel,
    subtotal_base_inr: subtotalBaseInr,
    addons_total_inr: addonsTotalInr,
    selected_addons: frozenAddons as SelectedBookingAddon[],
    convenience_fee_inr: convenienceFeeInr,
    total_amount_inr: totalAmountInr,
    advance_percent: effectiveAdvancePercent,
    advance_amount_inr: advanceAmountInr,
    balance_at_venue_inr: balanceAtVenueInr,
    pay_now_inr: payNowInr,
    payment_option:
      payFullUpfront || effectiveAdvancePercent >= 100 ? 'full' : 'advance',
    snapshot: snapshot as BookingPriceSnapshot,
  });

  return breakdown;
}
