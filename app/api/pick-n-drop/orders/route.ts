import { randomBytes, randomInt } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  ALLOWED_CONTAINER_TYPES,
  ALLOWED_SERVICE_MODES,
  ALLOWED_TRIP_TYPES,
  calculateServerFareQuote,
  createServerSupabaseAdminClient,
  extractSupabaseAccessToken,
  isContainerType,
  isServiceMode,
  isTripType,
  isValidCoordinate,
  type ContainerType,
  type ServiceMode,
} from '@/lib/pick-n-drop/fare';

function generateCryptographicOtp(): string {
  return String(randomInt(100000, 1000000));
}

function generateOrderCode(): string {
  const now = new Date();
  const y = now.getUTCFullYear().toString().slice(-2);
  const m = String(now.getUTCMonth() + 1).padStart(2, '0');
  const d = String(now.getUTCDate()).padStart(2, '0');
  const suffix = randomBytes(3).toString('hex').toUpperCase();
  return `PND-${y}${m}${d}-${suffix}`;
}

function buildManualUpiInstructions(orderCode: string, amountInr: number) {
  const upiId = (
    process.env.PICK_N_DROP_UPI_ID || 'printswift.escrow@upi'
  ).trim();
  const payeeName = (
    process.env.PICK_N_DROP_UPI_NAME || 'PrintSwift Local Escrow'
  ).trim();
  const formattedAmount = amountInr.toFixed(2);
  const note = `PickNDrop ${orderCode}`;
  const upiUri = `upi://pay?pa=${encodeURIComponent(upiId)}&pn=${encodeURIComponent(payeeName)}&am=${encodeURIComponent(formattedAmount)}&cu=INR&tn=${encodeURIComponent(note)}`;

  return {
    upi_id: upiId,
    payee_name: payeeName,
    amount_inr: amountInr,
    order_code: orderCode,
    payment_note: note,
    upi_uri: upiUri,
    steps: [
      `Pay ₹${formattedAmount} via any UPI app (GPay, PhonePe, Paytm) to ${upiId}.`,
      `Include order code "${orderCode}" in the UPI remark/note.`,
      'Submit your 12-digit UPI UTR reference number and payment screenshot so our mediator can verify escrow and assign a driver.',
    ],
  };
}

export async function POST(req: NextRequest) {
  try {
    const token = extractSupabaseAccessToken(req);
    if (!token) {
      return NextResponse.json(
        { error: 'Authentication required to create a Pick N Drop order.' },
        { status: 401 }
      );
    }

    const supabaseAdmin = createServerSupabaseAdminClient();
    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user?.id) {
      return NextResponse.json(
        { error: 'Invalid or expired session. Please sign in again.' },
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

    const pickupLat = Number(body.pickupLat);
    const pickupLng = Number(body.pickupLng);
    const dropoffLat = Number(body.dropoffLat);
    const dropoffLng = Number(body.dropoffLng);
    const vehicleTypeId = String(body.vehicleTypeId ?? '').trim();
    const tripType = body.tripType;

    const rawServiceMode = body.serviceMode ?? 'parcel';
    if (!isServiceMode(rawServiceMode)) {
      return NextResponse.json(
        {
          error: `serviceMode must be one of: ${ALLOWED_SERVICE_MODES.join(', ')}.`,
        },
        { status: 400 }
      );
    }
    const serviceMode: ServiceMode = rawServiceMode;

    const pickupAddress = String(body.pickupAddress ?? '').trim();
    const senderPhone = String(body.senderPhone ?? '').trim();
    const dropoffAddress = String(body.dropoffAddress ?? '').trim();

    const instructions = String(body.instructions ?? '').trim() || null;
    const pickupLandmark =
      String(body.pickupLandmark ?? '').trim() || null;
    const dropoffLandmark =
      String(body.dropoffLandmark ?? '').trim() || null;

    const recipientName = String(body.recipientName ?? '').trim() || null;
    const recipientPhone = String(body.recipientPhone ?? '').trim() || null;

    const passengerCountRaw = Number(body.passengerCount ?? 1);
    const passengerCount =
      Number.isFinite(passengerCountRaw) && passengerCountRaw >= 1
        ? Math.min(12, Math.floor(passengerCountRaw))
        : 1;

    const cylinderCountRaw = Number(body.cylinderCount ?? 1);
    const cylinderCount =
      Number.isFinite(cylinderCountRaw) && cylinderCountRaw >= 1
        ? Math.min(10, Math.floor(cylinderCountRaw))
        : 1;

    const declaredValueRaw = Number(body.declaredValueInr ?? 0);
    const declaredValueInr =
      Number.isFinite(declaredValueRaw) && declaredValueRaw >= 0
        ? Math.round(declaredValueRaw * 100) / 100
        : 0;
    const prohibitedItemsWaiver = body.prohibitedItemsWaiver === true;

    if (!isValidCoordinate(pickupLat, pickupLng)) {
      return NextResponse.json(
        { error: 'Valid pickupLat and pickupLng coordinates are required.' },
        { status: 400 }
      );
    }

    if (!isValidCoordinate(dropoffLat, dropoffLng)) {
      return NextResponse.json(
        { error: 'Valid dropoffLat and dropoffLng coordinates are required.' },
        { status: 400 }
      );
    }

    if (!vehicleTypeId) {
      return NextResponse.json(
        { error: 'vehicleTypeId is required.' },
        { status: 400 }
      );
    }

    if (!isTripType(tripType)) {
      return NextResponse.json(
        {
          error: `tripType must be one of: ${ALLOWED_TRIP_TYPES.join(', ')}.`,
        },
        { status: 400 }
      );
    }

    let containerType: ContainerType | null = null;
    if (serviceMode === 'parcel') {
      const candidate = body.containerType ?? 'small_box';
      if (!isContainerType(candidate)) {
        return NextResponse.json(
          {
            error: `containerType must be one of: ${ALLOWED_CONTAINER_TYPES.join(', ')}.`,
          },
          { status: 400 }
        );
      }
      containerType = candidate;
    }

    if (!prohibitedItemsWaiver) {
      return NextResponse.json(
        {
          error:
            'You must accept the terms & safety waiver before placing an order.',
        },
        { status: 400 }
      );
    }

    if (!pickupAddress || !senderPhone || !dropoffAddress) {
      return NextResponse.json(
        {
          error: 'pickupAddress, senderPhone, and dropoffAddress are required.',
        },
        { status: 400 }
      );
    }

    if (serviceMode === 'parcel' && (!recipientName || !recipientPhone)) {
      return NextResponse.json(
        {
          error:
            'recipientName and recipientPhone are required for Parcel deliveries.',
        },
        { status: 400 }
      );
    }

    // Re-calculate fare strictly server-side (NEVER trust any client-supplied total)
    const quote = await calculateServerFareQuote({
      supabase: supabaseAdmin,
      pickupLat,
      pickupLng,
      dropoffLat,
      dropoffLng,
      vehicleTypeId,
      tripType,
      serviceMode,
      containerType,
      cylinderCount,
    });

    const podRequired = serviceMode !== 'passenger';
    const orderCode = generateOrderCode();
    const pickupOtp = generateCryptographicOtp();
    const dropoffOtp = generateCryptographicOtp();
    const returnOtp =
      tripType === 'two_way' ? generateCryptographicOtp() : null;

    // PostGIS geography(Point, 4326) uses EWKT SRID=4326;POINT(longitude latitude)
    const pickupPointEwkt = `SRID=4326;POINT(${pickupLng} ${pickupLat})`;
    const dropoffPointEwkt = `SRID=4326;POINT(${dropoffLng} ${dropoffLat})`;

    const { data: createdOrder, error: orderInsertError } = await supabaseAdmin
      .from('delivery_orders')
      .insert({
        order_code: orderCode,
        customer_id: user.id,
        vehicle_type_id: quote.vehicle_type.id,
        service_mode: serviceMode,
        trip_type: tripType,
        container_type: containerType,
        instructions,
        passenger_count: serviceMode === 'passenger' ? passengerCount : 1,
        cylinder_count: serviceMode === 'gas' ? cylinderCount : 1,
        pod_required: podRequired,
        declared_value_inr: declaredValueInr,
        prohibited_items_waiver: true,
        pickup_address: pickupAddress,
        pickup_landmark: pickupLandmark,
        pickup_point: pickupPointEwkt,
        sender_phone: senderPhone,
        dropoff_address: dropoffAddress,
        dropoff_landmark: dropoffLandmark,
        dropoff_point: dropoffPointEwkt,
        recipient_name: recipientName,
        recipient_phone: recipientPhone,
        distance_km: quote.distance_km,
        quoted_fare_inr: quote.total_fare_inr,
        quote_expires_at: quote.expires_at,
        status: 'awaiting_payment',
      })
      .select(
        'id, order_code, customer_id, vehicle_type_id, service_mode, trip_type, container_type, instructions, passenger_count, cylinder_count, pod_required, declared_value_inr, pickup_address, pickup_landmark, sender_phone, dropoff_address, dropoff_landmark, recipient_name, recipient_phone, distance_km, quoted_fare_inr, quote_expires_at, status, created_at'
      )
      .single();

    if (orderInsertError || !createdOrder) {
      return NextResponse.json(
        {
          error:
            orderInsertError?.message || 'Failed to create delivery order.',
        },
        { status: 500 }
      );
    }

    const { error: secretInsertError } = await supabaseAdmin
      .from('delivery_order_secrets')
      .insert({
        order_id: createdOrder.id,
        pickup_otp: pickupOtp,
        dropoff_otp: dropoffOtp,
        return_otp: returnOtp,
        failed_attempts: 0,
      });

    if (secretInsertError) {
      await supabaseAdmin
        .from('delivery_orders')
        .delete()
        .eq('id', createdOrder.id);

      return NextResponse.json(
        {
          error:
            secretInsertError.message ||
            'Failed to initialize asymmetric OTP secrets for delivery order.',
        },
        { status: 500 }
      );
    }

    await supabaseAdmin.from('delivery_order_events').insert({
      order_id: createdOrder.id,
      actor_id: user.id,
      event_type: 'order_created',
      payload: {
        order_code: createdOrder.order_code,
        service_mode: serviceMode,
        vehicle_type_slug: quote.vehicle_type.slug,
        trip_type: tripType,
        container_type: containerType,
        passenger_count: serviceMode === 'passenger' ? passengerCount : null,
        cylinder_count: serviceMode === 'gas' ? cylinderCount : null,
        pod_required: podRequired,
        distance_km: quote.distance_km,
        quoted_fare_inr: quote.total_fare_inr,
        distance_source: quote.breakdown.distance_source,
      },
    });

    const paymentInstructions = buildManualUpiInstructions(
      String(createdOrder.order_code),
      quote.total_fare_inr
    );

    return NextResponse.json(
      {
        order: createdOrder,
        breakdown: quote.breakdown,
        fare_breakdown: quote.fare_breakdown,
        payment_instructions: paymentInstructions,
      },
      { status: 201 }
    );
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to create delivery order.';
    const status = /not found|inactive/i.test(message) ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
