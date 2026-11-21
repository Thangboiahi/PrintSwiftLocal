import { NextRequest, NextResponse } from 'next/server';
import {
  CommercePricingError,
  computeShopBasketQuote,
  estimateLocalDeliveryFee,
  type DbShopProductRow,
  type RequestedShopBasketItem,
} from '@/lib/commerce/pricing-engine';
import {
  assertCommerceModuleEnabledForHub,
  assertListingHasCommerceEntitlement,
  authenticateCommerceRequest,
  COMMERCE_HOLD_WINDOW_MS,
  CommerceApiError,
  createLinkedPickNDropDeliveryOrder,
  generateCommerceOrderCode,
  generateCommercePaymentIntentCode,
  generatePickupOtp,
  normalizeShopProfileRow,
} from '@/lib/commerce/server-helpers';
import type {
  CommercePaymentRail,
  ShopHandoverMode,
} from '@/lib/commerce/types';
import { fetchServerPaymentConfig } from '@/lib/config/server';
import {
  buildPlatformUpiDetails,
  isUuid,
  type PaymentIntentRecord,
} from '@/lib/payments/types';

export async function POST(req: NextRequest) {
  try {
    const actor = await authenticateCommerceRequest(req);
    if (!actor) {
      return NextResponse.json(
        { error: 'Authentication required to place a shop order.' },
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
    if (!isUuid(listingId)) {
      return NextResponse.json(
        { error: 'Valid listingId (UUID) is required.' },
        { status: 400 }
      );
    }

    const rawItems = Array.isArray(body.items) ? body.items : [];
    const requestedItems: RequestedShopBasketItem[] = rawItems.map((it) => {
      const obj = (it && typeof it === 'object' ? it : {}) as Record<
        string,
        unknown
      >;
      return {
        productId: String(obj.productId ?? obj.product_id ?? '').trim(),
        qty: Number(obj.qty ?? obj.quantity ?? 0),
      };
    });

    const handoverMode: ShopHandoverMode =
      body.handoverMode === 'pick_n_drop' || body.handover_mode === 'pick_n_drop'
        ? 'pick_n_drop'
        : 'counter_pickup';

    const requestedRailRaw = String(
      body.paymentRail ?? body.payment_rail ?? ''
    ).trim();
    const requestedPaymentRail: CommercePaymentRail | null =
      requestedRailRaw === 'platform_escrow' ||
      requestedRailRaw === 'direct_counter' ||
      requestedRailRaw === 'direct_shop_upi'
        ? requestedRailRaw
        : null;

    const [profileRes, listingRes, productsRes] = await Promise.all([
      actor.supabaseAdmin
        .from('listing_shop_profiles')
        .select('*')
        .eq('listing_id', listingId)
        .maybeSingle(),
      actor.supabaseAdmin
        .from('listings')
        .select('id, title, address, locality, lat, lng, phone, whatsapp, hub_id')
        .eq('id', listingId)
        .maybeSingle(),
      actor.supabaseAdmin
        .from('marketplace_products')
        .select('id, listing_id, title, price, unit, unit_label, in_stock, is_active')
        .eq('listing_id', listingId),
    ]);

    if (profileRes.error || !profileRes.data || !listingRes.data) {
      return NextResponse.json(
        { error: 'Shop storefront profile not found for this listing.' },
        { status: 404 }
      );
    }

    const profile = normalizeShopProfileRow(
      profileRes.data as Record<string, unknown>
    );
    const listing = listingRes.data as Record<string, unknown>;

    await assertCommerceModuleEnabledForHub(
      actor.supabaseAdmin,
      profile.hub_id,
      'shop_catalogue'
    );
    await assertListingHasCommerceEntitlement(
      actor.supabaseAdmin,
      listingId,
      'shop_catalogue'
    );

    const dropoffAddress = String(
      body.dropoffAddress ?? body.dropoff_address ?? ''
    ).trim();
    const dropoffLat = Number(body.dropoffLat ?? body.dropoff_lat);
    const dropoffLng = Number(body.dropoffLng ?? body.dropoff_lng);
    const customerNote = String(body.customerNote ?? body.customer_note ?? '').trim() || null;

    let deliveryFeeInr = 0;
    let distanceKm = 1;

    if (handoverMode === 'pick_n_drop') {
      if (!dropoffAddress) {
        return NextResponse.json(
          { error: 'dropoffAddress is required for Pick N Drop delivery.' },
          { status: 400 }
        );
      }
      const shopLat = Number(listing.lat);
      const shopLng = Number(listing.lng);
      const est = estimateLocalDeliveryFee(
        shopLat,
        shopLng,
        Number.isFinite(dropoffLat) ? dropoffLat : shopLat,
        Number.isFinite(dropoffLng) ? dropoffLng : shopLng
      );
      deliveryFeeInr = est.deliveryFeeInr;
      distanceKm = est.distanceKm;
    }

    const dbProducts = ((productsRes.data || []) as Array<Record<string, unknown>>).map(
      (p): DbShopProductRow => ({
        id: String(p.id),
        listing_id: String(p.listing_id),
        title: String(p.title || 'Item'),
        price: Number(p.price || 0),
        unit: p.unit ? String(p.unit) : null,
        unit_label: p.unit_label ? String(p.unit_label) : null,
        in_stock: p.in_stock !== false,
        is_active: p.is_active !== false,
      })
    );

    const { quote, itemsSnapshot } = computeShopBasketQuote({
      profile,
      dbProducts,
      requestedItems,
      handoverMode,
      deliveryFeeInr,
      requestedPaymentRail,
    });

    const { otp: pickupOtp, hash: pickupOtpHash } = generatePickupOtp();
    const orderCode = generateCommerceOrderCode('DDS');
    const isEscrow = quote.payment_rail === 'platform_escrow';

    const { data: createdOrder, error: orderErr } = await actor.supabaseAdmin
      .from('shop_orders')
      .insert({
        order_code: orderCode,
        hub_id: profile.hub_id,
        listing_id: listingId,
        customer_id: actor.userId,
        items_snapshot: itemsSnapshot,
        subtotal_inr: quote.subtotal_inr,
        packaging_fee_inr: quote.packaging_fee_inr,
        delivery_fee_inr: quote.delivery_fee_inr,
        total_amount_inr: quote.total_amount_inr,
        handover_mode: handoverMode,
        payment_rail: quote.payment_rail,
        pickup_otp_hash: pickupOtpHash,
        pickup_otp_display_for_customer: pickupOtp,
        customer_note: customerNote,
        dropoff_address: handoverMode === 'pick_n_drop' ? dropoffAddress : null,
        dropoff_lat:
          handoverMode === 'pick_n_drop' && Number.isFinite(dropoffLat)
            ? dropoffLat
            : null,
        dropoff_lng:
          handoverMode === 'pick_n_drop' && Number.isFinite(dropoffLng)
            ? dropoffLng
            : null,
        order_status: isEscrow ? 'pending_payment' : 'confirmed',
        payment_status: 'unpaid',
        settlement_status: isEscrow ? 'locked' : 'not_applicable',
      })
      .select('*')
      .single();

    if (orderErr || !createdOrder) {
      return NextResponse.json(
        { error: orderErr?.message || 'Failed to create shop order.' },
        { status: 500 }
      );
    }

    let linkedDeliveryOrderId: string | null = null;
    if (handoverMode === 'pick_n_drop') {
      const shopLat = Number(listing.lat || 24.3333);
      const shopLng = Number(listing.lng || 93.6833);
      linkedDeliveryOrderId = await createLinkedPickNDropDeliveryOrder({
        supabaseAdmin: actor.supabaseAdmin,
        customerId: actor.userId,
        hubId: profile.hub_id,
        listingTitle: String(listing.title || 'Shop').replace(/^\[SAMPLE\]\s*/i, ''),
        pickupAddress: String(listing.address || listing.locality || 'Shop Counter'),
        pickupLat: shopLat,
        pickupLng: shopLng,
        senderPhone: String(listing.phone || listing.whatsapp || actor.profile.phone || '+910000000000'),
        dropoffAddress,
        dropoffLat: Number.isFinite(dropoffLat) ? dropoffLat : shopLat,
        dropoffLng: Number.isFinite(dropoffLng) ? dropoffLng : shopLng,
        recipientName:
          String(body.recipientName ?? actor.profile.full_name ?? 'Customer').trim(),
        recipientPhone:
          String(body.recipientPhone ?? actor.profile.phone ?? '+910000000000').trim(),
        distanceKm,
        deliveryFeeInr: quote.delivery_fee_inr,
        declaredValueInr: quote.subtotal_inr,
        isFoodOrder: false,
        linkedShopOrderId: String(createdOrder.id),
        instructions: customerNote,
      });

      await actor.supabaseAdmin
        .from('shop_orders')
        .update({ linked_delivery_order_id: linkedDeliveryOrderId })
        .eq('id', createdOrder.id);
    }

    if (!isEscrow) {
      return NextResponse.json(
        {
          order: {
            ...createdOrder,
            linked_delivery_order_id: linkedDeliveryOrderId,
          },
          pickupOtp,
          quote,
          shopUpi: profile.payment_policy.shop_upi_id
            ? {
                upiId: profile.payment_policy.shop_upi_id,
                payeeName:
                  profile.payment_policy.shop_upi_name ||
                  String(listing.title || 'Shop'),
                verified: profile.payment_policy.shop_upi_verified,
              }
            : null,
        },
        { status: 201 }
      );
    }

    const purpose =
      handoverMode === 'pick_n_drop'
        ? ('shop_order_with_delivery' as const)
        : ('shop_order' as const);
    const provider =
      body.provider === 'razorpay' ? 'razorpay' : ('manual_upi' as const);
    const expiresAtIso = new Date(
      Date.now() + COMMERCE_HOLD_WINDOW_MS
    ).toISOString();

    const { data: intentRow, error: intentErr } = await actor.supabaseAdmin
      .from('payment_intents')
      .insert({
        intent_code: generateCommercePaymentIntentCode(),
        user_id: actor.userId,
        hub_id: profile.hub_id,
        purpose,
        reference_id: createdOrder.id,
        shop_order_id: createdOrder.id,
        amount_inr: quote.total_amount_inr,
        base_amount_inr: quote.total_amount_inr,
        convenience_fee_inr: quote.convenience_fee_inr,
        provider,
        status: 'awaiting_payment',
        expires_at: expiresAtIso,
      })
      .select('*')
      .single();

    if (intentErr || !intentRow) {
      return NextResponse.json(
        {
          error:
            intentErr?.message ||
            'Failed to initialize escrow payment intent for shop order.',
        },
        { status: 500 }
      );
    }

    const paymentIntent = intentRow as PaymentIntentRecord;

    const { data: linkedOrder } = await actor.supabaseAdmin
      .from('shop_orders')
      .update({
        payment_intent_id: paymentIntent.id,
        linked_delivery_order_id: linkedDeliveryOrderId,
      })
      .eq('id', createdOrder.id)
      .select('*')
      .single();

    const paymentConfig = await fetchServerPaymentConfig(
      actor.supabaseAdmin,
      profile.hub_id
    );
    const upiDetails = buildPlatformUpiDetails({
      intentCode: paymentIntent.intent_code,
      amountInr: Number(paymentIntent.amount_inr || quote.total_amount_inr),
      purpose,
      upiIdOverride: paymentConfig.upi_id,
      upiPayeeNameOverride: paymentConfig.upi_payee_name,
    });

    return NextResponse.json(
      {
        order: linkedOrder || createdOrder,
        paymentIntent,
        upiDetails,
        pickupOtp,
        quote,
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof CommerceApiError || err instanceof CommercePricingError) {
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
            : 'Unexpected error while creating shop order.',
      },
      { status: 500 }
    );
  }
}
