import { NextRequest, NextResponse } from 'next/server';
import { fetchServerPaymentConfig } from '@/lib/config/server';
import {
  buildPlatformUpiDetails,
  isUuid,
  type PaymentIntentRecord,
} from '@/lib/payments/types';
import {
  BookingPricingError,
  computeBookingPrice,
} from '@/lib/bookings/pricing-engine';
import {
  assertBookingModuleEnabledForHub,
  assertListingHasBookingEntitlement,
  authenticateBookingRequest,
  BOOKING_HOLD_WINDOW_MS,
  BookingApiError,
  generateBookingPaymentIntentCode,
  generateCheckinOtp,
  normalizeBookingResourceRow,
  normalizeBookingTimestampInput,
  normalizeHotelProfileRow,
  parseClockTimeToMinutes,
} from '@/lib/bookings/server-helpers';
import type {
  BookingPaymentRail,
  ListingHotelProfile,
} from '@/lib/bookings/types';

function isAllowedOnlineRail(val: unknown): val is BookingPaymentRail {
  return (
    val === 'platform_escrow' ||
    val === 'direct_counter' ||
    val === 'direct_shop_upi'
  );
}

/**
 * POST /api/bookings/create
 * Creates an atomic, race-condition-free booking for a `booking_venue` or `hotel_stay`
 * resource via `create_atomic_resource_booking` (PostgreSQL `FOR UPDATE` row lock),
 * computes server-authoritative pricing + convenience fee, hashes a 4-digit Check-In OTP,
 * and initializes a linked `payment_intents` row when escrow advance/full payment applies.
 */
export async function POST(req: NextRequest) {
  try {
    const actor = await authenticateBookingRequest(req);
    if (!actor) {
      return NextResponse.json(
        { error: 'Authentication required to create a booking.' },
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

    const listingId = String(body.listingId ?? body.listing_id ?? '').trim();
    const resourceId = String(body.resourceId ?? body.resource_id ?? '').trim();

    if (!isUuid(listingId) || !isUuid(resourceId)) {
      return NextResponse.json(
        { error: 'Valid listingId and resourceId (UUIDs) are required.' },
        { status: 400 }
      );
    }

    const [resourceRes, hotelProfileRes] = await Promise.all([
      actor.supabaseAdmin
        .from('listing_booking_resources')
        .select('*')
        .eq('id', resourceId)
        .eq('listing_id', listingId)
        .maybeSingle(),
      actor.supabaseAdmin
        .from('listing_hotel_profiles')
        .select('*')
        .eq('listing_id', listingId)
        .maybeSingle(),
    ]);

    if (resourceRes.error || !resourceRes.data) {
      return NextResponse.json(
        { error: 'Booking resource not found for the specified listing.' },
        { status: 404 }
      );
    }

    const resource = normalizeBookingResourceRow(
      resourceRes.data as Record<string, unknown>
    );

    if (!resource.is_active) {
      return NextResponse.json(
        { error: 'This resource is currently unavailable for online bookings.' },
        { status: 409 }
      );
    }

    const hotelProfile: ListingHotelProfile | null = hotelProfileRes.data
      ? normalizeHotelProfileRow(hotelProfileRes.data as Record<string, unknown>)
      : null;

    if (
      resource.resource_vertical === 'hotel_stay' &&
      hotelProfile &&
      !hotelProfile.is_accepting_bookings
    ) {
      return NextResponse.json(
        {
          error:
            'This property is temporarily paused and not accepting new online bookings.',
          code: 'HOTEL_NOT_ACCEPTING_BOOKINGS',
        },
        { status: 409 }
      );
    }

    // Enforce hub kill-switch and active Booking Pro / Stay Pro entitlement
    await assertBookingModuleEnabledForHub(
      actor.supabaseAdmin,
      resource.hub_id,
      resource.resource_vertical
    );
    await assertListingHasBookingEntitlement(
      actor.supabaseAdmin,
      listingId,
      resource.resource_vertical
    );

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
    const guestsCount = Math.floor(
      Number(body.guestsCount ?? body.guests_count ?? 1)
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

    const maxAllowedGuests = resource.max_guests * unitsBooked;
    if (
      !Number.isFinite(guestsCount) ||
      guestsCount < 1 ||
      guestsCount > maxAllowedGuests
    ) {
      return NextResponse.json(
        {
          error: `guestsCount must be between 1 and ${maxAllowedGuests} for ${unitsBooked} unit(s) of ${resource.name}.`,
        },
        { status: 400 }
      );
    }

    const selectedAddonKeys = Array.isArray(
      body.selectedAddonKeys ?? body.selected_addon_keys
    )
      ? ((body.selectedAddonKeys ?? body.selected_addon_keys) as unknown[]).map(
          (k) => String(k || '').trim()
        )
      : [];

    const guestName =
      String(body.guestName ?? body.guest_name ?? '').trim() ||
      actor.profile.full_name ||
      'Guest';
    const guestPhone =
      String(body.guestPhone ?? body.guest_phone ?? '').trim() ||
      actor.profile.phone ||
      null;
    const notes = String(body.notes ?? '').trim() || null;

    if (guestName.length < 2) {
      return NextResponse.json(
        { error: 'Please provide a valid guestName (at least 2 characters).' },
        { status: 400 }
      );
    }

    const payFullUpfront = Boolean(
      body.payFullUpfront ?? body.pay_full_upfront ?? false
    );
    const requestedRailRaw = body.paymentRail ?? body.payment_rail;
    const requestedRail: BookingPaymentRail | null = isAllowedOnlineRail(
      requestedRailRaw
    )
      ? requestedRailRaw
      : null;

    if (
      payFullUpfront &&
      hotelProfile &&
      hotelProfile.payment_policy.allow_full_prepay === false
    ) {
      return NextResponse.json(
        {
          error:
            'Full upfront prepayment is disabled by this property; please book using the advance option.',
        },
        { status: 400 }
      );
    }

    const allowDirectCounter =
      resource.resource_vertical === 'hotel_stay'
        ? Boolean(hotelProfile?.payment_policy?.allow_direct_pay)
        : resource.advance_percent === 0;

    // Preview base calculation to inspect whether advance_amount_inr > 0
    const previewQuote = computeBookingPrice({
      resource,
      startAt: startAtIso,
      endAt: endAtIso,
      unitsBooked,
      guestsCount,
      selectedAddonKeys,
      payFullUpfront,
      paymentRail: 'platform_escrow',
      bookingSource: 'online',
    });

    const requiresEscrow =
      previewQuote.advance_amount_inr > 0 ||
      payFullUpfront ||
      requestedRail === 'platform_escrow';

    if (!requiresEscrow && !allowDirectCounter) {
      return NextResponse.json(
        {
          error:
            'Direct pay-at-counter booking is not enabled for this property. Please pay via Platform Escrow.',
          code: 'DIRECT_COUNTER_NOT_ALLOWED',
        },
        { status: 400 }
      );
    }

    // If caller explicitly selected platform_escrow on a 0%-advance resource, collect full subtotal via escrow
    const effectivePayFull =
      payFullUpfront || (requiresEscrow && previewQuote.advance_amount_inr === 0);

    const resolvedRail: BookingPaymentRail = requiresEscrow
      ? 'platform_escrow'
      : requestedRail === 'direct_shop_upi'
        ? 'direct_shop_upi'
        : 'direct_counter';

    const quote = computeBookingPrice({
      resource,
      startAt: startAtIso,
      endAt: endAtIso,
      unitsBooked,
      guestsCount,
      selectedAddonKeys,
      payFullUpfront: effectivePayFull,
      paymentRail: resolvedRail,
      bookingSource: 'online',
    });

    const { otp: checkinOtp, hash: checkinOtpHash } = generateCheckinOtp();
    const initialBookingStatus = requiresEscrow ? 'pending_payment' : 'confirmed';
    const initialPaymentStatus = 'unpaid';

    // Atomically lock the resource row FOR UPDATE and insert booking via DB RPC
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
        p_customer_id: actor.userId,
        p_booking_source: 'online',
        p_selected_addons: quote.selected_addons,
        p_price_snapshot: quote.snapshot,
        p_total_amount_inr: quote.total_amount_inr,
        p_advance_amount_inr: quote.advance_amount_inr,
        p_balance_at_venue_inr: quote.balance_at_venue_inr,
        p_convenience_fee_inr: quote.convenience_fee_inr,
        p_payment_rail: resolvedRail,
        p_booking_status: initialBookingStatus,
        p_payment_status: initialPaymentStatus,
        p_checkin_otp_hash: checkinOtpHash,
        p_checkin_otp_display: checkinOtp,
        p_notes: notes,
        p_booking_code: null,
      }
    );

    if (rpcErr) {
      const msg = rpcErr.message || 'Failed to reserve booking slot.';
      const isConflict =
        /no longer available|unavailable|overlap/i.test(msg);
      return NextResponse.json(
        {
          error: msg,
          code: isConflict ? 'SLOT_UNAVAILABLE' : 'BOOKING_CREATE_FAILED',
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

    const createdBooking = rpcPayload.booking;
    if (!createdBooking || !createdBooking.id) {
      return NextResponse.json(
        { error: 'Booking RPC completed without returning a booking record.' },
        { status: 500 }
      );
    }

    const bookingId = String(createdBooking.id);

    // Direct counter confirmed immediately when advance_amount_inr === 0
    if (!requiresEscrow) {
      return NextResponse.json(
        {
          booking: createdBooking,
          checkinOtp,
          quote,
          remainingUnits: rpcPayload.remaining_units,
        },
        { status: 201 }
      );
    }

    // Platform Escrow path -> create linked payment_intents row
    const provider =
      body.provider === 'razorpay' ? 'razorpay' : ('manual_upi' as const);
    const expiresAtIso = new Date(
      Date.now() + BOOKING_HOLD_WINDOW_MS
    ).toISOString();

    const { data: intentRow, error: intentErr } = await actor.supabaseAdmin
      .from('payment_intents')
      .insert({
        intent_code: generateBookingPaymentIntentCode(),
        user_id: actor.userId,
        hub_id: resource.hub_id,
        purpose: 'resource_booking',
        reference_id: bookingId,
        resource_booking_id: bookingId,
        amount_inr: quote.pay_now_inr,
        base_amount_inr: quote.advance_amount_inr,
        convenience_fee_inr: quote.convenience_fee_inr,
        provider,
        status: 'awaiting_payment',
        expires_at: expiresAtIso,
      })
      .select('*')
      .single();

    if (intentErr || !intentRow) {
      // Roll back soft hold cleanly so inventory isn't held without a payment intent
      await actor.supabaseAdmin
        .from('resource_bookings')
        .update({
          booking_status: 'cancelled',
          cancelled_at: new Date().toISOString(),
        })
        .eq('id', bookingId);

      return NextResponse.json(
        {
          error:
            intentErr?.message ||
            'Failed to initialize escrow payment intent for this booking.',
        },
        { status: 500 }
      );
    }

    const paymentIntent = intentRow as PaymentIntentRecord;

    const { data: linkedBooking } = await actor.supabaseAdmin
      .from('resource_bookings')
      .update({ payment_intent_id: paymentIntent.id })
      .eq('id', bookingId)
      .select('*')
      .single();

    const paymentConfig = await fetchServerPaymentConfig(
      actor.supabaseAdmin,
      resource.hub_id
    );
    const upiDetails = buildPlatformUpiDetails({
      intentCode: paymentIntent.intent_code,
      amountInr: Number(paymentIntent.amount_inr || quote.pay_now_inr),
      purpose: 'resource_booking',
      upiIdOverride: paymentConfig.upi_id,
      upiPayeeNameOverride: paymentConfig.upi_payee_name,
    });

    return NextResponse.json(
      {
        booking: linkedBooking || {
          ...createdBooking,
          payment_intent_id: paymentIntent.id,
        },
        paymentIntent,
        upiDetails,
        checkinOtp,
        quote,
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
            : 'Unexpected error while creating booking.',
      },
      { status: 500 }
    );
  }
}
