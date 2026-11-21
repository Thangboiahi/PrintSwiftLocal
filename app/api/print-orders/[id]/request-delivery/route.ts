import { randomBytes, randomInt } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  fetchServerPaymentConfig,
  fetchServerQuoteConfig,
  mergePaymentConfigWithHub,
  resolveServiceHubByIdOrDefault,
} from '@/lib/config/server';
import {
  buildPlatformUpiDetails,
  isUuid,
  type PaymentIntentRecord,
} from '@/lib/payments/types';
import {
  calculateServerFareQuote,
  computeStraightLineDistanceKm,
  isValidCoordinate,
} from '@/lib/pick-n-drop/fare';
import {
  authenticatePrintRequest,
  generatePaymentIntentCode,
  loadAndValidatePrintProfile,
  PrintApiError,
} from '@/lib/print-orders/server-helpers';

function generateDeliveryOrderCode(): string {
  const now = new Date();
  const y = now.getUTCFullYear().toString().slice(-2);
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const suffix = randomBytes(3).toString('hex').toUpperCase();
  return `PND-${y}${m}${d}-${suffix}`;
}

function generateSixDigitOtp(): string {
  return String(randomInt(100000, 1000000));
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await authenticatePrintRequest(req);
    if (!actor) {
      return NextResponse.json(
        { error: 'Authentication required to request Pick N Drop delivery.' },
        { status: 401 }
      );
    }

    const { id: orderId } = await context.params;
    if (!isUuid(orderId)) {
      return NextResponse.json(
        { error: 'Valid print order id (UUID) is required.' },
        { status: 400 }
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

    const { data: orderRow, error: orderErr } = await actor.supabaseAdmin
      .from('print_orders')
      .select('*')
      .eq('id', orderId)
      .maybeSingle();

    if (orderErr || !orderRow) {
      return NextResponse.json(
        { error: 'Print order not found.' },
        { status: 404 }
      );
    }

    if (String(orderRow.customer_id) !== actor.userId) {
      return NextResponse.json(
        { error: 'Forbidden: You do not own this print order.' },
        { status: 403 }
      );
    }

    // Enforce hub kill-switch + Print Pro entitlement
    const profile = await loadAndValidatePrintProfile(
      actor.supabaseAdmin,
      String(orderRow.listing_id)
    );

    if (String(orderRow.fulfillment_status) !== 'ready_for_pickup') {
      return NextResponse.json(
        {
          error:
            'Pick N Drop delivery can only be attached after the print order is Ready for Pickup.',
        },
        { status: 409 }
      );
    }

    if (orderRow.linked_delivery_order_id) {
      return NextResponse.json(
        {
          error:
            'A Pick N Drop delivery order is already linked to this print order.',
        },
        { status: 409 }
      );
    }

    const dropoffLat = Number(body.dropoffLat ?? body.dropoff_lat);
    const dropoffLng = Number(body.dropoffLng ?? body.dropoff_lng);
    const dropoffAddress = String(
      body.dropoffAddress ?? body.dropoff_address ?? ''
    ).trim();
    const dropoffLandmark =
      String(body.dropoffLandmark ?? body.dropoff_landmark ?? '').trim() || null;
    const recipientName =
      String(
        body.recipientName ??
          body.recipient_name ??
          actor.profile.full_name ??
          'Customer'
      ).trim() || 'Customer';
    const recipientPhone = String(
      body.recipientPhone ??
        body.recipient_phone ??
        actor.profile.phone ??
        ''
    ).trim();
    const vehicleTypeId =
      String(
        body.vehicleTypeId ?? body.vehicle_type_id ?? 'two_wheeler'
      ).trim() || 'two_wheeler';
    const instructions =
      String(body.instructions ?? '').trim() ||
      `Sealed Print Package Pickup for Order ${orderRow.order_code}`;
    const provider =
      body.provider === 'razorpay' ? 'razorpay' : ('manual_upi' as const);

    if (!isValidCoordinate(dropoffLat, dropoffLng)) {
      return NextResponse.json(
        { error: 'Valid dropoffLat and dropoffLng coordinates are required.' },
        { status: 400 }
      );
    }

    if (!dropoffAddress) {
      return NextResponse.json(
        { error: 'dropoffAddress is required.' },
        { status: 400 }
      );
    }

    if (!recipientPhone) {
      return NextResponse.json(
        { error: 'recipientPhone is required for delivery dispatch.' },
        { status: 400 }
      );
    }

    // Load shop listing details for pickup point
    const { data: listingRow, error: listingErr } = await actor.supabaseAdmin
      .from('listings')
      .select('id, title, address, lat, lng, phone, whatsapp, hub_id')
      .eq('id', String(orderRow.listing_id))
      .maybeSingle();

    if (listingErr || !listingRow) {
      return NextResponse.json(
        { error: 'Associated print shop listing could not be found.' },
        { status: 404 }
      );
    }

    const [activeHub, { pricing_surcharges }, globalPaymentConfig] =
      await Promise.all([
        resolveServiceHubByIdOrDefault(actor.supabaseAdmin, profile.hub_id),
        fetchServerQuoteConfig(actor.supabaseAdmin),
        fetchServerPaymentConfig(actor.supabaseAdmin),
      ]);

    const pickupLat = isValidCoordinate(
      Number(listingRow.lat),
      Number(listingRow.lng)
    )
      ? Number(listingRow.lat)
      : activeHub.center_lat;
    const pickupLng = isValidCoordinate(
      Number(listingRow.lat),
      Number(listingRow.lng)
    )
      ? Number(listingRow.lng)
      : activeHub.center_lng;

    // Verify dropoff & pickup are within the active hub service radius
    if (
      Number.isFinite(activeHub.service_radius_km) &&
      activeHub.service_radius_km > 0 &&
      isValidCoordinate(activeHub.center_lat, activeHub.center_lng)
    ) {
      const pickupDistance = computeStraightLineDistanceKm(
        activeHub.center_lat,
        activeHub.center_lng,
        pickupLat,
        pickupLng
      );
      const dropoffDistance = computeStraightLineDistanceKm(
        activeHub.center_lat,
        activeHub.center_lng,
        dropoffLat,
        dropoffLng
      );

      if (
        pickupDistance > activeHub.service_radius_km ||
        dropoffDistance > activeHub.service_radius_km
      ) {
        return NextResponse.json(
          {
            error:
              'Delivery dropoff location is outside this service hub radius.',
            hub_id: activeHub.id,
            service_radius_km: activeHub.service_radius_km,
          },
          { status: 400 }
        );
      }
    }

    // Calculate authoritative Pick N Drop parcel fare server-side
    const deliveryQuote = await calculateServerFareQuote({
      supabase: actor.supabaseAdmin,
      hubId: profile.hub_id,
      pickupLat,
      pickupLng,
      dropoffLat,
      dropoffLng,
      vehicleTypeId,
      tripType: 'one_way',
      serviceMode: 'parcel',
      containerType: 'envelope',
      allowFallbackVehicle: true,
      surcharges: {
        fragile_crate_inr: pricing_surcharges.fragile_crate_inr,
        bulk_sack_inr: pricing_surcharges.bulk_sack_inr,
        extra_cylinder_inr: pricing_surcharges.extra_cylinder_inr,
      },
    });

    const pickupAddress = String(
      listingRow.address || listingRow.title || 'Print Shop Counter'
    ).trim();
    const senderPhone = String(
      listingRow.phone || listingRow.whatsapp || recipientPhone
    ).trim();
    const deliveryOrderCode = generateDeliveryOrderCode();
    const pickupOtp = generateSixDigitOtp();
    const dropoffOtp = generateSixDigitOtp();

    const pickupPointEwkt = `SRID=4326;POINT(${pickupLng} ${pickupLat})`;
    const dropoffPointEwkt = `SRID=4326;POINT(${dropoffLng} ${dropoffLat})`;

    const { data: createdDelivery, error: deliveryInsertErr } =
      await actor.supabaseAdmin
        .from('delivery_orders')
        .insert({
          order_code: deliveryOrderCode,
          customer_id: actor.userId,
          hub_id: profile.hub_id,
          vehicle_type_id: deliveryQuote.vehicle_type.id,
          service_mode: 'parcel',
          trip_type: 'one_way',
          container_type: 'envelope',
          instructions,
          passenger_count: 1,
          cylinder_count: 1,
          pod_required: true,
          declared_value_inr: Math.max(
            0,
            Number(orderRow.quoted_amount_inr || 0)
          ),
          prohibited_items_waiver: true,
          pickup_address: pickupAddress,
          pickup_landmark: listingRow.title ? String(listingRow.title) : null,
          pickup_point: pickupPointEwkt,
          sender_phone: senderPhone,
          dropoff_address: dropoffAddress,
          dropoff_landmark: dropoffLandmark,
          dropoff_point: dropoffPointEwkt,
          recipient_name: recipientName,
          recipient_phone: recipientPhone,
          distance_km: deliveryQuote.distance_km,
          quoted_fare_inr: deliveryQuote.total_fare_inr,
          quote_expires_at: deliveryQuote.expires_at,
          linked_print_order_id: orderId,
          sealed_package_required: true,
          status: 'awaiting_payment',
        })
        .select('*')
        .single();

    if (deliveryInsertErr || !createdDelivery) {
      return NextResponse.json(
        {
          error:
            deliveryInsertErr?.message ||
            'Failed to create linked Pick N Drop delivery order.',
        },
        { status: 500 }
      );
    }

    const { error: secretErr } = await actor.supabaseAdmin
      .from('delivery_order_secrets')
      .insert({
        order_id: createdDelivery.id,
        pickup_otp: pickupOtp,
        dropoff_otp: dropoffOtp,
        return_otp: null,
        failed_attempts: 0,
      });

    if (secretErr) {
      await actor.supabaseAdmin
        .from('delivery_orders')
        .delete()
        .eq('id', createdDelivery.id);
      return NextResponse.json(
        {
          error:
            secretErr.message ||
            'Failed to initialize delivery OTP secrets.',
        },
        { status: 500 }
      );
    }

    // Combine any unpaid print balance + Pick N Drop fare into a SINGLE escrow payment_intent
    const isPrintAlreadyPaid = ['escrow_held', 'paid_direct_confirmed'].includes(
      String(orderRow.payment_status)
    );
    const unpaidPrintBalanceInr = isPrintAlreadyPaid
      ? 0
      : Math.max(0, Number(orderRow.quoted_amount_inr || 0));
    const deliveryFareInr = Math.max(0, Number(deliveryQuote.total_fare_inr || 0));
    const totalPayableInr =
      Math.round((unpaidPrintBalanceInr + deliveryFareInr) * 100) / 100;

    const { data: intentRow, error: intentErr } = await actor.supabaseAdmin
      .from('payment_intents')
      .insert({
        intent_code: generatePaymentIntentCode(),
        user_id: actor.userId,
        hub_id: profile.hub_id,
        purpose: 'print_order_with_delivery',
        reference_id: orderId,
        print_order_id: orderId,
        amount_inr: totalPayableInr,
        base_amount_inr: totalPayableInr,
        provider,
        status: 'awaiting_payment',
        expires_at: deliveryQuote.expires_at,
      })
      .select('*')
      .single();

    if (intentErr || !intentRow) {
      await actor.supabaseAdmin
        .from('delivery_orders')
        .delete()
        .eq('id', createdDelivery.id);
      return NextResponse.json(
        {
          error:
            intentErr?.message ||
            'Failed to create combined print + delivery escrow payment intent.',
        },
        { status: 500 }
      );
    }

    const paymentIntent = intentRow as PaymentIntentRecord;
    const nowIso = new Date().toISOString();

    const { data: updatedPrintOrder, error: printUpdateErr } =
      await actor.supabaseAdmin
        .from('print_orders')
        .update({
          handover_mode: 'pick_n_drop',
          linked_delivery_order_id: createdDelivery.id,
          sealed_envelope_requested: true,
          payment_rail: 'platform_escrow',
          payment_intent_id: paymentIntent.id,
          payment_status: isPrintAlreadyPaid
            ? orderRow.payment_status
            : 'unpaid',
          settlement_status:
            !profile.is_first_party_printswift && unpaidPrintBalanceInr > 0
              ? 'locked'
              : orderRow.settlement_status,
          updated_at: nowIso,
        })
        .eq('id', orderId)
        .select('*')
        .single();

    if (printUpdateErr || !updatedPrintOrder) {
      return NextResponse.json(
        {
          error:
            printUpdateErr?.message ||
            'Failed to attach delivery order to print order.',
        },
        { status: 500 }
      );
    }

    await Promise.all([
      actor.supabaseAdmin.from('print_order_events').insert({
        print_order_id: orderId,
        actor_id: actor.userId,
        actor_role: actor.actualRole,
        event_type: 'delivery_attached',
        metadata: {
          delivery_order_id: createdDelivery.id,
          delivery_order_code: createdDelivery.order_code,
          payment_intent_id: paymentIntent.id,
          unpaid_print_balance_inr: unpaidPrintBalanceInr,
          delivery_fare_inr: deliveryFareInr,
          total_payable_inr: totalPayableInr,
          sealed_package_required: true,
        },
      }),
      actor.supabaseAdmin.from('delivery_order_events').insert({
        order_id: createdDelivery.id,
        actor_id: actor.userId,
        event_type: 'order_created',
        payload: {
          linked_print_order_id: orderId,
          print_order_code: orderRow.order_code,
          sealed_package_required: true,
          payment_intent_id: paymentIntent.id,
          quoted_fare_inr: deliveryFareInr,
        },
      }),
    ]);

    const effectivePaymentConfig = mergePaymentConfigWithHub(
      globalPaymentConfig,
      activeHub
    );
    const upiDetails = buildPlatformUpiDetails({
      intentCode: paymentIntent.intent_code,
      amountInr: totalPayableInr,
      purpose: 'print_order_with_delivery',
      upiIdOverride: effectivePaymentConfig.upi_id,
      upiPayeeNameOverride: effectivePaymentConfig.upi_payee_name,
    });

    return NextResponse.json(
      {
        order: updatedPrintOrder,
        deliveryOrder: createdDelivery,
        paymentIntent,
        fareBreakdown: deliveryQuote.breakdown,
        unpaidPrintBalanceInr,
        deliveryFareInr,
        totalPayableInr,
        upiDetails,
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof PrintApiError) {
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
            : 'Unexpected error while attaching Pick N Drop delivery.',
      },
      { status: 500 }
    );
  }
}
