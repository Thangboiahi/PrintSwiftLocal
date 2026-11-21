import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/payments/types';
import {
  BookingPricingError,
  computeBookingPrice,
} from '@/lib/bookings/pricing-engine';
import {
  assertBookingModuleEnabledForHub,
  assertListingHasBookingEntitlement,
  authenticateBookingRequest,
  BookingApiError,
  normalizeBookingResourceRow,
  normalizeBookingTimestampInput,
  normalizeHotelProfileRow,
  parseClockTimeToMinutes,
  verifyIsBookingOperatorForListing,
} from '@/lib/bookings/server-helpers';

/**
 * POST /api/bookings/walk-in-block
 * Strictly restricted to authorized venue owners, hotel receptionists, or delegated staff
 * (`is_booking_operator_for(listingId)`). Atomically blocks a turf slot, hall date, or N hotel
 * rooms via `create_atomic_resource_booking` so offline/phone guests sync instantly with online availability.
 */
export async function POST(req: NextRequest) {
  try {
    const actor = await authenticateBookingRequest(req);
    if (!actor) {
      return NextResponse.json(
        { error: 'Authentication required to create a walk-in block.' },
        { status: 401 }
      );
    }

    const body = (await req.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;
    if (!body || typeof body !== 'object') {
      return NextResponse.json(
        { error: 'Invalid JSON request body.' },
        { status: 400 }
      );
    }

    const requestedListingId = String(
      body.listingId ?? body.listing_id ?? ''
    ).trim();
    const resourceId = String(body.resourceId ?? body.resource_id ?? '').trim();

    if (!isUuid(resourceId)) {
      return NextResponse.json(
        { error: 'Valid resourceId (UUID) is required.' },
        { status: 400 }
      );
    }

    if (requestedListingId && !isUuid(requestedListingId)) {
      return NextResponse.json(
        { error: 'listingId must be a valid UUID when provided.' },
        { status: 400 }
      );
    }

    const { data: resourceRow, error: resourceErr } = await actor.supabaseAdmin
      .from('listing_booking_resources')
      .select('*')
      .eq('id', resourceId)
      .maybeSingle();

    if (resourceErr || !resourceRow) {
      return NextResponse.json(
        { error: 'Booking resource not found.' },
        { status: 404 }
      );
    }

    const resource = normalizeBookingResourceRow(
      resourceRow as Record<string, unknown>
    );

    if (requestedListingId && resource.listing_id !== requestedListingId) {
      return NextResponse.json(
        { error: 'resourceId does not belong to the specified listingId.' },
        { status: 400 }
      );
    }

    // Strictly enforce `is_booking_operator_for(listingId)` (403 otherwise)
    const isOperator = await verifyIsBookingOperatorForListing({
      supabaseAdmin: actor.supabaseAdmin,
      userToken: actor.userToken,
      userId: actor.userId,
      actualRole: actor.actualRole,
      listingId: resource.listing_id,
    });

    if (!isOperator) {
      return NextResponse.json(
        {
          error:
            'Forbidden: Only authorized venue/hotel owners or delegated staff may create walk-in blocks.',
          code: 'BOOKING_OPERATOR_REQUIRED',
        },
        { status: 403 }
      );
    }

    // Enforce hub kill-switch and active entitlement
    await assertBookingModuleEnabledForHub(
      actor.supabaseAdmin,
      resource.hub_id,
      resource.resource_vertical
    );
    await assertListingHasBookingEntitlement(
      actor.supabaseAdmin,
      resource.listing_id,
      resource.resource_vertical
    );

    const { data: hotelProfileRow } =
      resource.resource_vertical === 'hotel_stay'
        ? await actor.supabaseAdmin
            .from('listing_hotel_profiles')
            .select('*')
            .eq('listing_id', resource.listing_id)
            .maybeSingle()
        : { data: null };

    const hotelProfile = hotelProfileRow
      ? normalizeHotelProfileRow(hotelProfileRow as Record<string, unknown>)
      : null;

    const checkInMinutes =
      resource.booking_unit === 'nightly'
        ? parseClockTimeToMinutes(hotelProfile?.check_in_time, 12 * 60)
        : resource.open_hour * 60;
    const checkOutMinutes =
      resource.booking_unit === 'nightly'
        ? parseClockTimeToMinutes(hotelProfile?.check_out_time, 11 * 60)
        : resource.close_hour * 60;

    const startAtIso = normalizeBookingTimestampInput(
      body.startAt ?? body.start_at ?? body.checkIn ?? body.check_in,
      checkInMinutes,
      'startAt'
    );
    const endAtIso = normalizeBookingTimestampInput(
      body.endAt ?? body.end_at ?? body.checkOut ?? body.check_out,
      checkOutMinutes,
      'endAt'
    );

    const unitsBooked = Math.floor(
      Number(body.unitsBooked ?? body.units_booked ?? 1)
    );
    const guestsCount = Math.max(
      1,
      Math.floor(Number(body.guestsCount ?? body.guests_count ?? 1))
    );

    if (
      !Number.isFinite(unitsBooked) ||
      unitsBooked < 1 ||
      unitsBooked > resource.total_units
    ) {
      return NextResponse.json(
        {
          error: `unitsBooked must be between 1 and ${resource.total_units}.`,
        },
        { status: 400 }
      );
    }

    const guestName =
      String(body.guestName ?? body.guest_name ?? '').trim() || 'Walk-In Guest';
    const guestPhone =
      String(body.guestPhone ?? body.guest_phone ?? '').trim() || null;
    const notes = String(body.notes ?? '').trim() || null;

    // Zero convenience fee on manual walk-in blocks
    const quote = computeBookingPrice({
      resource,
      startAt: startAtIso,
      endAt: endAtIso,
      unitsBooked,
      guestsCount,
      paymentRail: 'walk_in_manual',
      bookingSource: 'walk_in_block',
    });

    const { data: rpcData, error: rpcErr } = await actor.supabaseAdmin.rpc(
      'create_atomic_resource_booking',
      {
        p_resource_id: resource.id,
        p_start_at: quote.start_at,
        p_end_at: quote.end_at,
        p_units_booked: quote.units_booked,
        p_guests_count: quote.guests_count,
        p_guest_name: guestName,
        p_guest_phone: guestPhone,
        p_customer_id: null,
        p_booking_source: 'walk_in_block',
        p_selected_addons: [],
        p_price_snapshot: quote.snapshot,
        p_total_amount_inr: quote.total_amount_inr,
        p_advance_amount_inr: 0,
        p_balance_at_venue_inr: quote.balance_at_venue_inr,
        p_convenience_fee_inr: 0,
        p_payment_rail: 'walk_in_manual',
        p_booking_status: 'blocked',
        p_payment_status: 'not_applicable',
        p_checkin_otp_hash: null,
        p_checkin_otp_display: null,
        p_notes: notes,
        p_booking_code: null,
      }
    );

    if (rpcErr) {
      const msg = rpcErr.message || 'Failed to block selected slot or room dates.';
      const isConflict = /no longer available|unavailable|overlap/i.test(msg);
      return NextResponse.json(
        {
          error: msg,
          code: isConflict ? 'SLOT_UNAVAILABLE' : 'WALK_IN_BLOCK_FAILED',
        },
        { status: isConflict ? 409 : 400 }
      );
    }

    const rpcPayload = (rpcData && typeof rpcData === 'object'
      ? rpcData
      : {}) as {
      ok?: boolean;
      booking?: Record<string, unknown>;
      remaining_units?: number;
    };

    return NextResponse.json(
      {
        ok: true,
        booking: rpcPayload.booking,
        remainingUnits: rpcPayload.remaining_units,
      },
      { status: 201 }
    );
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
            : 'Unexpected error while creating walk-in block.',
      },
      { status: 500 }
    );
  }
}
