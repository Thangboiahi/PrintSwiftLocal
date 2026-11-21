import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAdminClient } from '@/lib/pick-n-drop/fare';
import { isUuid } from '@/lib/payments/types';
import {
  BookingPricingError,
  computeBookingPrice,
  isPeakStartTimestamp,
} from '@/lib/bookings/pricing-engine';
import {
  assertBookingModuleEnabledForHub,
  BookingApiError,
  buildIstIsoForYmdAndMinutes,
  formatSlotRangeLabel,
  isActiveOccupancyBooking,
  normalizeBookingResourceRow,
  normalizeBookingTimestampInput,
  normalizeHotelProfileRow,
  parseClockTimeToMinutes,
  YMD_DATE_REGEX,
} from '@/lib/bookings/server-helpers';
import type {
  ListingBookingResource,
  ListingHotelProfile,
  ResourceVertical,
} from '@/lib/bookings/types';

interface OccupancyRow {
  resource_id: string;
  start_at: string;
  end_at: string;
  units_booked: number;
  booking_status: string;
  created_at: string;
}

interface ComputedSlotAvailability {
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

function addDaysToYmd(ymd: string, daysToAdd: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d + daysToAdd));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(dt.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function getTodayIstYmd(): string {
  const istNow = new Date(Date.now() + 330 * 60 * 1000);
  const yy = istNow.getUTCFullYear();
  const mm = String(istNow.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(istNow.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

function resolveWindowForResource(params: {
  resource: ListingBookingResource;
  dateParam: string;
  checkInParam: string;
  checkOutParam: string;
  hotelProfile: ListingHotelProfile | null;
}): { startIso: string; endIso: string; queryDateYmd: string } {
  const { resource, dateParam, checkInParam, checkOutParam, hotelProfile } =
    params;

  if (resource.booking_unit === 'hourly' || resource.booking_unit === 'slot') {
    const rawDate =
      dateParam ||
      (YMD_DATE_REGEX.test(checkInParam)
        ? checkInParam
        : checkInParam
          ? checkInParam.slice(0, 10)
          : getTodayIstYmd());

    if (!YMD_DATE_REGEX.test(rawDate)) {
      throw new BookingApiError(
        'date query param (YYYY-MM-DD) is required for hourly/slot availability.',
        400,
        'INVALID_DATE'
      );
    }

    const startIso = buildIstIsoForYmdAndMinutes(
      rawDate,
      resource.open_hour * 60
    );
    const endIso = buildIstIsoForYmdAndMinutes(
      rawDate,
      resource.close_hour * 60
    );
    return { startIso, endIso, queryDateYmd: rawDate };
  }

  if (resource.booking_unit === 'nightly') {
    const checkInMinutes = parseClockTimeToMinutes(
      hotelProfile?.check_in_time,
      12 * 60
    );
    const checkOutMinutes = parseClockTimeToMinutes(
      hotelProfile?.check_out_time,
      11 * 60
    );

    const effectiveCheckIn = checkInParam || dateParam;
    if (!effectiveCheckIn) {
      throw new BookingApiError(
        'checkIn and checkOut query params are required for nightly room availability.',
        400,
        'MISSING_STAY_DATES'
      );
    }

    const effectiveCheckOut =
      checkOutParam ||
      (YMD_DATE_REGEX.test(effectiveCheckIn)
        ? addDaysToYmd(effectiveCheckIn, 1)
        : '');

    if (!effectiveCheckOut) {
      throw new BookingApiError(
        'checkOut query param is required for nightly room availability.',
        400,
        'MISSING_CHECKOUT_DATE'
      );
    }

    const startIso = normalizeBookingTimestampInput(
      effectiveCheckIn,
      checkInMinutes,
      'checkIn'
    );
    const endIso = normalizeBookingTimestampInput(
      effectiveCheckOut,
      checkOutMinutes,
      'checkOut'
    );

    if (Date.parse(endIso) <= Date.parse(startIso)) {
      throw new BookingApiError(
        'checkOut must be strictly after checkIn.',
        400,
        'INVALID_DATE_RANGE'
      );
    }

    const ymd = YMD_DATE_REGEX.test(effectiveCheckIn)
      ? effectiveCheckIn
      : effectiveCheckIn.slice(0, 10);
    return { startIso, endIso, queryDateYmd: ymd };
  }

  if (resource.booking_unit === 'weekly') {
    const startRaw = checkInParam || dateParam;
    if (!startRaw) {
      throw new BookingApiError(
        'checkIn (or date) query param is required for weekly availability.',
        400,
        'MISSING_DATES'
      );
    }
    const endRaw =
      checkOutParam ||
      (YMD_DATE_REGEX.test(startRaw) ? addDaysToYmd(startRaw, 7) : '');

    if (!endRaw) {
      throw new BookingApiError(
        'checkOut query param is required for weekly availability.',
        400,
        'MISSING_DATES'
      );
    }

    const startIso = normalizeBookingTimestampInput(
      startRaw,
      resource.open_hour * 60,
      'checkIn'
    );
    const endIso = normalizeBookingTimestampInput(
      endRaw,
      resource.close_hour * 60,
      'checkOut'
    );
    if (Date.parse(endIso) <= Date.parse(startIso)) {
      throw new BookingApiError(
        'checkOut must be strictly after checkIn.',
        400,
        'INVALID_DATE_RANGE'
      );
    }
    return {
      startIso,
      endIso,
      queryDateYmd: YMD_DATE_REGEX.test(startRaw)
        ? startRaw
        : startRaw.slice(0, 10),
    };
  }

  // half_day or full_day
  if (checkInParam && checkOutParam) {
    const startIso = normalizeBookingTimestampInput(
      checkInParam,
      resource.open_hour * 60,
      'checkIn'
    );
    const endIso = normalizeBookingTimestampInput(
      checkOutParam,
      resource.close_hour * 60,
      'checkOut'
    );
    if (Date.parse(endIso) <= Date.parse(startIso)) {
      throw new BookingApiError(
        'checkOut must be strictly after checkIn.',
        400,
        'INVALID_DATE_RANGE'
      );
    }
    return {
      startIso,
      endIso,
      queryDateYmd: YMD_DATE_REGEX.test(checkInParam)
        ? checkInParam
        : checkInParam.slice(0, 10),
    };
  }

  const targetDate = dateParam || checkInParam || getTodayIstYmd();
  if (!YMD_DATE_REGEX.test(targetDate)) {
    throw new BookingApiError(
      'date query param (YYYY-MM-DD) is required for half-day / full-day availability.',
      400,
      'INVALID_DATE'
    );
  }

  const startIso = buildIstIsoForYmdAndMinutes(
    targetDate,
    resource.open_hour * 60
  );
  const endIso = buildIstIsoForYmdAndMinutes(
    targetDate,
    resource.close_hour * 60
  );
  return { startIso, endIso, queryDateYmd: targetDate };
}

/**
 * GET /api/bookings/availability
 * Computes live slot-level (hourly/slot) or inventory-level (nightly/full_day/half_day/weekly)
 * availability for a booking venue or hotel listing, respecting confirmed/checked_in/blocked
 * records plus active <15-minute pending_payment soft holds.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const listingId = String(
      searchParams.get('listingId') ?? searchParams.get('listing_id') ?? ''
    ).trim();
    const resourceId = String(
      searchParams.get('resourceId') ?? searchParams.get('resource_id') ?? ''
    ).trim();
    const dateParam = String(searchParams.get('date') ?? '').trim();
    const checkInParam = String(
      searchParams.get('checkIn') ?? searchParams.get('check_in') ?? ''
    ).trim();
    const checkOutParam = String(
      searchParams.get('checkOut') ?? searchParams.get('check_out') ?? ''
    ).trim();

    if (!isUuid(listingId)) {
      return NextResponse.json(
        { error: 'Valid listingId (UUID) query parameter is required.' },
        { status: 400 }
      );
    }

    if (resourceId && !isUuid(resourceId)) {
      return NextResponse.json(
        { error: 'resourceId must be a valid UUID when provided.' },
        { status: 400 }
      );
    }

    const supabaseAdmin = createServerSupabaseAdminClient();

    let resourceQuery = supabaseAdmin
      .from('listing_booking_resources')
      .select('*')
      .eq('listing_id', listingId)
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('base_rate_inr', { ascending: true });

    if (resourceId) {
      resourceQuery = resourceQuery.eq('id', resourceId);
    }

    const [resourcesRes, hotelProfileRes] = await Promise.all([
      resourceQuery,
      supabaseAdmin
        .from('listing_hotel_profiles')
        .select('*')
        .eq('listing_id', listingId)
        .maybeSingle(),
    ]);

    if (resourcesRes.error) {
      return NextResponse.json(
        { error: `Failed to load booking resources: ${resourcesRes.error.message}` },
        { status: 500 }
      );
    }

    const resources = (resourcesRes.data || []).map((row) =>
      normalizeBookingResourceRow(row as Record<string, unknown>)
    );

    if (resources.length === 0) {
      return NextResponse.json(
        { error: 'No active bookable resources found for this listing.' },
        { status: 404 }
      );
    }

    const hotelProfile = hotelProfileRes.data
      ? normalizeHotelProfileRow(hotelProfileRes.data as Record<string, unknown>)
      : null;

    const primaryVertical: ResourceVertical = resources[0].resource_vertical;
    const hubId = resources[0].hub_id;

    // Enforce hub kill-switch for the relevant vertical
    await assertBookingModuleEnabledForHub(supabaseAdmin, hubId, primaryVertical);

    // Check active entitlement status (non-blocking metadata so UI can show upgrade/unavailable state cleanly)
    const { data: entitlementData } = await supabaseAdmin.rpc(
      'has_active_booking_entitlement',
      {
        p_listing_id: listingId,
        p_vertical: primaryVertical,
      }
    );
    const hasBookingEntitlement = entitlementData === true;

    // Compute per-resource query windows and envelope for single batched DB occupancy query
    const windowsByResourceId = new Map<
      string,
      { startIso: string; endIso: string; queryDateYmd: string }
    >();
    let minStartMs = Number.POSITIVE_INFINITY;
    let maxEndMs = Number.NEGATIVE_INFINITY;

    for (const res of resources) {
      const win = resolveWindowForResource({
        resource: res,
        dateParam,
        checkInParam,
        checkOutParam,
        hotelProfile,
      });
      windowsByResourceId.set(res.id, win);
      const sMs = Date.parse(win.startIso);
      const eMs = Date.parse(win.endIso);
      if (sMs < minStartMs) minStartMs = sMs;
      if (eMs > maxEndMs) maxEndMs = eMs;
    }

    const resourceIds = resources.map((r) => r.id);
    const { data: bookingRows, error: bookingsErr } = await supabaseAdmin
      .from('resource_bookings')
      .select(
        'resource_id, start_at, end_at, units_booked, booking_status, created_at'
      )
      .in('resource_id', resourceIds)
      .in('booking_status', [
        'confirmed',
        'checked_in',
        'blocked',
        'pending_payment',
      ])
      .lt('start_at', new Date(maxEndMs).toISOString())
      .gt('end_at', new Date(minStartMs).toISOString());

    if (bookingsErr) {
      return NextResponse.json(
        { error: `Failed to query live occupancy: ${bookingsErr.message}` },
        { status: 500 }
      );
    }

    const nowMs = Date.now();
    const activeBookingsByResource = new Map<
      string,
      Array<{ startMs: number; endMs: number; unitsBooked: number }>
    >();

    for (const raw of (bookingRows || []) as OccupancyRow[]) {
      if (!isActiveOccupancyBooking(raw, nowMs)) continue;
      const startMs = Date.parse(raw.start_at);
      const endMs = Date.parse(raw.end_at);
      if (Number.isNaN(startMs) || Number.isNaN(endMs) || endMs <= startMs) {
        continue;
      }
      const list = activeBookingsByResource.get(raw.resource_id) || [];
      list.push({
        startMs,
        endMs,
        unitsBooked: Math.max(1, Number(raw.units_booked || 1)),
      });
      activeBookingsByResource.set(raw.resource_id, list);
    }

    const isAcceptingOnline =
      hasBookingEntitlement &&
      (primaryVertical !== 'hotel_stay' ||
        hotelProfile === null ||
        hotelProfile.is_accepting_bookings);

    const resourceResults = resources.map((resource) => {
      const win = windowsByResourceId.get(resource.id)!;
      const occupancy = activeBookingsByResource.get(resource.id) || [];

      if (
        resource.booking_unit === 'hourly' ||
        resource.booking_unit === 'slot'
      ) {
        const slotMins = Math.max(15, resource.slot_duration_mins || 60);
        const openMin = resource.open_hour * 60;
        const closeMin = resource.close_hour * 60;
        const slots: ComputedSlotAvailability[] = [];

        for (
          let curMin = openMin;
          curMin + slotMins <= closeMin;
          curMin += slotMins
        ) {
          const slotStartIso = buildIstIsoForYmdAndMinutes(
            win.queryDateYmd,
            curMin
          );
          const slotEndIso = buildIstIsoForYmdAndMinutes(
            win.queryDateYmd,
            curMin + slotMins
          );
          const slotStartMs = Date.parse(slotStartIso);
          const slotEndMs = Date.parse(slotEndIso);

          let bookedUnits = 0;
          for (const occ of occupancy) {
            if (occ.startMs < slotEndMs && occ.endMs > slotStartMs) {
              bookedUnits += occ.unitsBooked;
            }
          }

          const remainingUnits = Math.max(0, resource.total_units - bookedUnits);
          const isPeak = isPeakStartTimestamp(resource, slotStartMs);
          const rateInr =
            isPeak && resource.peak_rate_inr !== null
              ? resource.peak_rate_inr
              : resource.base_rate_inr;
          const isPast = slotStartMs <= nowMs;
          const isAvailable =
            isAcceptingOnline && !isPast && remainingUnits > 0;

          slots.push({
            startAt: slotStartIso,
            endAt: slotEndIso,
            label: formatSlotRangeLabel(curMin, curMin + slotMins),
            totalUnits: resource.total_units,
            bookedUnits,
            remainingUnits,
            rateInr,
            isPeak,
            isPast,
            isAvailable,
          });
        }

        const availableSlotsCount = slots.filter((s) => s.isAvailable).length;

        return {
          resourceId: resource.id,
          resourceName: resource.name,
          resourceVertical: resource.resource_vertical,
          bookingUnit: resource.booking_unit,
          date: win.queryDateYmd,
          totalUnits: resource.total_units,
          baseRateInr: resource.base_rate_inr,
          peakRateInr: resource.peak_rate_inr,
          peakStartHour: resource.peak_start_hour,
          advancePercent: resource.advance_percent,
          availableSlotsCount,
          isAvailable: availableSlotsCount > 0,
          slots,
        };
      }

      // Multi-unit / range-based availability: nightly, full_day, half_day, weekly
      const winStartMs = Date.parse(win.startIso);
      const winEndMs = Date.parse(win.endIso);

      // Sum overlapping active reservations (mirrors create_atomic_resource_booking RPC lock)
      let bookedUnits = 0;
      for (const occ of occupancy) {
        if (occ.startMs < winEndMs && occ.endMs > winStartMs) {
          bookedUnits += occ.unitsBooked;
        }
      }

      const remainingUnits = Math.max(0, resource.total_units - bookedUnits);
      const quote = computeBookingPrice({
        resource,
        startAt: win.startIso,
        endAt: win.endIso,
        unitsBooked: 1,
        paymentRail: 'direct_counter',
      });

      const isAvailable =
        isAcceptingOnline && remainingUnits > 0 && winEndMs > nowMs;

      return {
        resourceId: resource.id,
        resourceName: resource.name,
        resourceVertical: resource.resource_vertical,
        bookingUnit: resource.booking_unit,
        startAt: win.startIso,
        endAt: win.endIso,
        totalUnits: resource.total_units,
        bookedUnits,
        remainingUnits,
        isAvailable,
        baseRateInr: resource.base_rate_inr,
        advancePercent: resource.advance_percent,
        durationCount: quote.duration_count,
        durationLabel: quote.duration_label,
        estimatedTotalInr: quote.subtotal_base_inr,
      };
    });

    const singleResource =
      resourceId && resourceResults.length === 1 ? resourceResults[0] : null;

    return NextResponse.json({
      listingId,
      hubId,
      vertical: primaryVertical,
      hasBookingEntitlement,
      isAcceptingBookings: isAcceptingOnline,
      ...(hotelProfile
        ? {
            checkInTime: hotelProfile.check_in_time,
            checkOutTime: hotelProfile.check_out_time,
          }
        : {}),
      ...(singleResource && 'slots' in singleResource
        ? { slots: singleResource.slots }
        : {}),
      resources: resourceResults,
    });
  } catch (err) {
    if (err instanceof BookingApiError || err instanceof BookingPricingError) {
      return NextResponse.json(
        { error: err.message, code: err.code },
        { status: err.statusCode }
      );
    }
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : 'Unexpected error while checking booking availability.',
      },
      { status: 500 }
    );
  }
}
