import { randomBytes } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  fetchServerPaymentConfig,
  fetchServerQuoteConfig,
  resolveServiceHubByIdOrDefault,
} from '@/lib/config/server';
import {
  createServerSupabaseAdminClient,
  extractSupabaseAccessToken,
} from '@/lib/pick-n-drop/fare';
import {
  buildPlatformUpiDetails,
  isPaymentPurpose,
  isUuid,
  type PaymentIntentRecord,
  type PaymentPurpose,
} from '@/lib/payments/types';
import {
  assertListingHasPrintEntitlement,
  assertPrintModuleEnabledForHub,
  PrintApiError,
} from '@/lib/print-orders/server-helpers';
import {
  assertBookingModuleEnabledForHub,
  assertListingHasBookingEntitlement,
  BOOKING_HOLD_WINDOW_MS,
  BookingApiError,
} from '@/lib/bookings/server-helpers';
import type { ResourceVertical } from '@/lib/bookings/types';

function generateIntentCode(): string {
  const suffix = randomBytes(3).toString('hex').toUpperCase();
  return `PSL-${suffix}`;
}

/**
 * POST /api/payments/create-intent
 * Authenticated route to create (or reuse an active awaiting_payment) central
 * `payment_intents` record stamped with `hub_id` for `pick_n_drop`,
 * `bulletin_subscription`, `bulletin_post_pass`, or `vehicle_booking`.
 *
 * Returns: { intent, upi_id, upi_payee_name, upi_deep_link }
 */
export async function POST(req: NextRequest) {
  try {
    const token = extractSupabaseAccessToken(req);
    if (!token) {
      return NextResponse.json(
        { error: 'Authentication required to create a payment intent.' },
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

    const rawPurpose = body.purpose;
    if (!isPaymentPurpose(rawPurpose)) {
      return NextResponse.json(
        {
          error:
            'purpose must be one of: pick_n_drop, vehicle_booking, bulletin_subscription, bulletin_post_pass, print_order, print_order_with_delivery, print_pro_subscription, resource_booking, booking_pro_subscription, stay_pro_subscription, shop_order, shop_order_with_delivery, restaurant_order, restaurant_order_with_delivery, catalogue_pro_subscription, restaurant_pro_subscription.',
        },
        { status: 400 }
      );
    }
    const purpose: PaymentPurpose = rawPurpose;

    const provider =
      body.provider === 'razorpay' ? 'razorpay' : ('manual_upi' as const);

    const requestedHubId = String(body.hubId ?? body.hub_id ?? '').trim();
    const requestedBulletinId = String(
      body.bulletinId ?? body.bulletin_id ?? ''
    ).trim();
    const requestedPrintOrderId = String(
      body.printOrderId ?? body.print_order_id ?? ''
    ).trim();
    const requestedResourceBookingId = String(
      body.resourceBookingId ?? body.resource_booking_id ?? ''
    ).trim();
    const requestedListingId = String(
      body.listingId ?? body.listing_id ?? ''
    ).trim();

    let referenceId = String(body.referenceId ?? body.reference_id ?? '').trim();
    const planId = String(body.planId ?? body.plan_id ?? '').trim();
    let linkedPrintOrderId: string | null = null;
    let linkedResourceBookingId: string | null = null;
    let authoritativeAmountInr = 0;
    let authoritativeBaseAmountInr: number | null = null;
    let authoritativeConvenienceFeeInr = 0;
    let derivedHubId: string | null = isUuid(requestedHubId)
      ? requestedHubId
      : null;
    let expiresAtIso = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    // -------------------------------------------------------------------------
    // Server-authoritative ownership, hub_id & amount resolution per purpose
    // -------------------------------------------------------------------------
    if (purpose === 'pick_n_drop') {
      if (!isUuid(referenceId)) {
        return NextResponse.json(
          { error: 'Valid referenceId (delivery_orders.id) is required.' },
          { status: 400 }
        );
      }

      const { data: order, error: orderErr } = await supabaseAdmin
        .from('delivery_orders')
        .select(
          'id, customer_id, hub_id, quoted_fare_inr, status, quote_expires_at'
        )
        .eq('id', referenceId)
        .maybeSingle();

      if (orderErr || !order) {
        return NextResponse.json(
          { error: 'Delivery order not found.' },
          { status: 404 }
        );
      }

      if (order.customer_id !== user.id) {
        return NextResponse.json(
          { error: 'Forbidden: You do not own this delivery order.' },
          { status: 403 }
        );
      }

      if (
        !['awaiting_payment', 'payment_submitted'].includes(
          String(order.status || '')
        )
      ) {
        return NextResponse.json(
          {
            error: `Delivery order is already in "${order.status}" state and does not require payment.`,
          },
          { status: 409 }
        );
      }

      if (order.hub_id && isUuid(String(order.hub_id))) {
        derivedHubId = String(order.hub_id);
      }
      authoritativeAmountInr = Number(order.quoted_fare_inr || 0);
      if (order.quote_expires_at) {
        const quoteExpiry = new Date(String(order.quote_expires_at));
        if (quoteExpiry.getTime() > Date.now()) {
          expiresAtIso = quoteExpiry.toISOString();
        }
      }
    } else if (purpose === 'bulletin_subscription') {
      if (isUuid(referenceId)) {
        const { data: sub, error: subErr } = await supabaseAdmin
          .from('user_subscriptions')
          .select(
            'id, user_id, status, subscription_plans:plan_id(price_inr, duration_days)'
          )
          .eq('id', referenceId)
          .maybeSingle();

        if (subErr || !sub) {
          return NextResponse.json(
            { error: 'Subscription record not found.' },
            { status: 404 }
          );
        }

        if (sub.user_id !== user.id) {
          return NextResponse.json(
            { error: 'Forbidden: You do not own this subscription.' },
            { status: 403 }
          );
        }

        const planObj = Array.isArray(sub.subscription_plans)
          ? (sub.subscription_plans[0] as { price_inr?: number } | undefined)
          : (sub.subscription_plans as { price_inr?: number } | null);
        authoritativeAmountInr = Number(planObj?.price_inr || 0);
      } else if (isUuid(planId)) {
        const { data: plan, error: planErr } = await supabaseAdmin
          .from('subscription_plans')
          .select('id, price_inr, duration_days, is_active')
          .eq('id', planId)
          .eq('is_active', true)
          .maybeSingle();

        if (planErr || !plan) {
          return NextResponse.json(
            { error: 'Selected subscription plan is not available.' },
            { status: 404 }
          );
        }

        const startsAt = new Date();
        const expiresAt = new Date(
          startsAt.getTime() + Number(plan.duration_days || 30) * 86400000
        );

        const { data: createdSub, error: createSubErr } = await supabaseAdmin
          .from('user_subscriptions')
          .insert({
            user_id: user.id,
            plan_id: plan.id,
            status: 'pending_payment',
            starts_at: startsAt.toISOString(),
            expires_at: expiresAt.toISOString(),
          })
          .select('id')
          .single();

        if (createSubErr || !createdSub?.id) {
          return NextResponse.json(
            {
              error:
                createSubErr?.message ||
                'Failed to initialize pending bulletin subscription.',
            },
            { status: 500 }
          );
        }

        referenceId = String(createdSub.id);
        authoritativeAmountInr = Number(plan.price_inr || 0);
      } else {
        return NextResponse.json(
          {
            error:
              'Either referenceId (user_subscriptions.id) or planId (subscription_plans.id) is required.',
          },
          { status: 400 }
        );
      }

      if (!derivedHubId && isUuid(requestedBulletinId)) {
        const { data: bRow } = await supabaseAdmin
          .from('bulletins')
          .select('hub_id')
          .eq('id', requestedBulletinId)
          .maybeSingle();
        if (bRow?.hub_id && isUuid(String(bRow.hub_id))) {
          derivedHubId = String(bRow.hub_id);
        }
      }
    } else if (purpose === 'bulletin_post_pass') {
      if (isUuid(referenceId)) {
        const { data: passRow, error: passErr } = await supabaseAdmin
          .from('bulletin_post_passes')
          .select('id, user_id, price_inr, status, used_bulletin_id')
          .eq('id', referenceId)
          .maybeSingle();

        if (passErr || !passRow) {
          return NextResponse.json(
            { error: 'Bulletin post pass not found.' },
            { status: 404 }
          );
        }

        if (passRow.user_id !== user.id) {
          return NextResponse.json(
            { error: 'Forbidden: You do not own this bulletin post pass.' },
            { status: 403 }
          );
        }

        if (!derivedHubId && passRow.used_bulletin_id) {
          const { data: bRow } = await supabaseAdmin
            .from('bulletins')
            .select('hub_id')
            .eq('id', passRow.used_bulletin_id)
            .maybeSingle();
          if (bRow?.hub_id && isUuid(String(bRow.hub_id))) {
            derivedHubId = String(bRow.hub_id);
          }
        }

        authoritativeAmountInr = Number(passRow.price_inr || 79);
      } else {
        const { pricing_surcharges } =
          await fetchServerQuoteConfig(supabaseAdmin);
        const priceInr = pricing_surcharges.bulletin_single_post_inr;
        const durationDays = pricing_surcharges.bulletin_single_post_days;

        const { data: createdPass, error: createPassErr } = await supabaseAdmin
          .from('bulletin_post_passes')
          .insert({
            user_id: user.id,
            price_inr: priceInr,
            duration_days: durationDays,
            status: 'pending_verification',
          })
          .select('id, price_inr')
          .single();

        if (createPassErr || !createdPass?.id) {
          return NextResponse.json(
            {
              error:
                createPassErr?.message ||
                'Failed to initialize bulletin post pass.',
            },
            { status: 500 }
          );
        }

        referenceId = String(createdPass.id);
        authoritativeAmountInr = Number(createdPass.price_inr || priceInr);
      }

      if (!derivedHubId && isUuid(requestedBulletinId)) {
        const { data: bRow } = await supabaseAdmin
          .from('bulletins')
          .select('hub_id')
          .eq('id', requestedBulletinId)
          .maybeSingle();
        if (bRow?.hub_id && isUuid(String(bRow.hub_id))) {
          derivedHubId = String(bRow.hub_id);
        }
      }
    } else if (purpose === 'vehicle_booking') {
      if (!isUuid(referenceId)) {
        return NextResponse.json(
          {
            error:
              'Vehicle bookings must be created via create_vehicle_booking_with_intent RPC; pass booking id as referenceId to retrieve UPI instructions.',
          },
          { status: 400 }
        );
      }

      const { data: booking, error: bookingErr } = await supabaseAdmin
        .from('vehicle_bookings')
        .select(
          'id, customer_id, hub_id, advance_amount_inr, payment_intent_id, hold_expires_at, status, vehicle_listings:vehicle_listing_id(origin_hub_id)'
        )
        .eq('id', referenceId)
        .maybeSingle();

      if (bookingErr || !booking) {
        return NextResponse.json(
          { error: 'Vehicle booking not found.' },
          { status: 404 }
        );
      }

      if (booking.customer_id !== user.id) {
        return NextResponse.json(
          { error: 'Forbidden: You do not own this vehicle booking.' },
          { status: 403 }
        );
      }

      const vl = Array.isArray(booking.vehicle_listings)
        ? (booking.vehicle_listings[0] as { origin_hub_id?: string | null } | undefined)
        : (booking.vehicle_listings as { origin_hub_id?: string | null } | null);
      const bookingHubCandidate = booking.hub_id || vl?.origin_hub_id || null;
      if (bookingHubCandidate && isUuid(String(bookingHubCandidate))) {
        derivedHubId = String(bookingHubCandidate);
      }

      authoritativeAmountInr = Number(booking.advance_amount_inr || 0);
      if (booking.hold_expires_at) {
        expiresAtIso = String(booking.hold_expires_at);
      }
    } else if (
      purpose === 'print_order' ||
      purpose === 'print_order_with_delivery'
    ) {
      const targetPrintOrderId = isUuid(requestedPrintOrderId)
        ? requestedPrintOrderId
        : referenceId;

      if (!isUuid(targetPrintOrderId)) {
        return NextResponse.json(
          {
            error:
              'Valid printOrderId or referenceId (print_orders.id) is required.',
          },
          { status: 400 }
        );
      }

      const { data: printOrder, error: printOrderErr } = await supabaseAdmin
        .from('print_orders')
        .select(
          'id, customer_id, hub_id, listing_id, quoted_amount_inr, linked_delivery_order_id, payment_status, fulfillment_status'
        )
        .eq('id', targetPrintOrderId)
        .maybeSingle();

      if (printOrderErr || !printOrder) {
        return NextResponse.json(
          { error: 'Print order not found.' },
          { status: 404 }
        );
      }

      if (String(printOrder.customer_id) !== user.id) {
        return NextResponse.json(
          { error: 'Forbidden: You do not own this print order.' },
          { status: 403 }
        );
      }

      if (String(printOrder.fulfillment_status) === 'cancelled') {
        return NextResponse.json(
          { error: 'Cannot create a payment intent for a cancelled print order.' },
          { status: 409 }
        );
      }

      if (printOrder.hub_id && isUuid(String(printOrder.hub_id))) {
        derivedHubId = String(printOrder.hub_id);
        await assertPrintModuleEnabledForHub(supabaseAdmin, derivedHubId);
      }
      if (printOrder.listing_id && isUuid(String(printOrder.listing_id))) {
        await assertListingHasPrintEntitlement(
          supabaseAdmin,
          String(printOrder.listing_id)
        );
      }

      const isPrintAlreadyPaid = [
        'escrow_held',
        'paid_direct_confirmed',
      ].includes(String(printOrder.payment_status));
      const unpaidPrintAmount = isPrintAlreadyPaid
        ? 0
        : Math.max(0, Number(printOrder.quoted_amount_inr || 0));

      let linkedDeliveryFare = 0;
      if (
        purpose === 'print_order_with_delivery' &&
        printOrder.linked_delivery_order_id &&
        isUuid(String(printOrder.linked_delivery_order_id))
      ) {
        const { data: linkedDelivery } = await supabaseAdmin
          .from('delivery_orders')
          .select('quoted_fare_inr, status')
          .eq('id', String(printOrder.linked_delivery_order_id))
          .maybeSingle();
        if (
          linkedDelivery &&
          ['awaiting_payment', 'payment_submitted'].includes(
            String(linkedDelivery.status || '')
          )
        ) {
          linkedDeliveryFare = Math.max(
            0,
            Number(linkedDelivery.quoted_fare_inr || 0)
          );
        }
      }

      authoritativeAmountInr =
        Math.round((unpaidPrintAmount + linkedDeliveryFare) * 100) / 100;

      if (authoritativeAmountInr <= 0) {
        return NextResponse.json(
          {
            error:
              'Print order has no unpaid quoted balance requiring an escrow payment intent.',
          },
          { status: 409 }
        );
      }

      referenceId = String(printOrder.id);
      linkedPrintOrderId = String(printOrder.id);
    } else if (purpose === 'print_pro_subscription') {
      if (isUuid(referenceId)) {
        const { data: sub, error: subErr } = await supabaseAdmin
          .from('user_subscriptions')
          .select(
            'id, user_id, listing_id, status, subscription_plans:plan_id(price_inr, duration_days, plan_scope)'
          )
          .eq('id', referenceId)
          .maybeSingle();

        if (subErr || !sub) {
          return NextResponse.json(
            { error: 'Print Pro subscription record not found.' },
            { status: 404 }
          );
        }

        if (String(sub.user_id) !== user.id) {
          return NextResponse.json(
            { error: 'Forbidden: You do not own this subscription.' },
            { status: 403 }
          );
        }

        const planObj = Array.isArray(sub.subscription_plans)
          ? (sub.subscription_plans[0] as { price_inr?: number } | undefined)
          : (sub.subscription_plans as { price_inr?: number } | null);
        authoritativeAmountInr = Number(planObj?.price_inr || 0);

        const targetListing =
          (sub.listing_id ? String(sub.listing_id) : '') || requestedListingId;
        if (!derivedHubId && isUuid(targetListing)) {
          const { data: lRow } = await supabaseAdmin
            .from('listings')
            .select('hub_id')
            .eq('id', targetListing)
            .maybeSingle();
          if (lRow?.hub_id && isUuid(String(lRow.hub_id))) {
            derivedHubId = String(lRow.hub_id);
          }
        }
      } else if (isUuid(planId)) {
        const { data: plan, error: planErr } = await supabaseAdmin
          .from('subscription_plans')
          .select('id, price_inr, duration_days, is_active, plan_scope')
          .eq('id', planId)
          .eq('is_active', true)
          .in('plan_scope', ['print_pro', 'merchant_bundle'])
          .maybeSingle();

        if (planErr || !plan) {
          return NextResponse.json(
            { error: 'Selected Print & Digital Pro plan is not available.' },
            { status: 404 }
          );
        }

        let verifiedListingId: string | null = null;
        if (isUuid(requestedListingId)) {
          const { data: listingRow, error: listingErr } = await supabaseAdmin
            .from('listings')
            .select('id, owner_id, hub_id')
            .eq('id', requestedListingId)
            .maybeSingle();

          if (listingErr || !listingRow) {
            return NextResponse.json(
              { error: 'Target shop listing not found.' },
              { status: 404 }
            );
          }

          if (String(listingRow.owner_id) !== user.id) {
            return NextResponse.json(
              {
                error:
                  'Forbidden: Only the listing owner can subscribe a shop to Print & Digital Pro.',
              },
              { status: 403 }
            );
          }

          verifiedListingId = String(listingRow.id);
          if (listingRow.hub_id && isUuid(String(listingRow.hub_id))) {
            derivedHubId = String(listingRow.hub_id);
          }
        }

        const startsAt = new Date();
        const expiresAt = new Date(
          startsAt.getTime() + Number(plan.duration_days || 30) * 86400000
        );

        const { data: createdSub, error: createSubErr } = await supabaseAdmin
          .from('user_subscriptions')
          .insert({
            user_id: user.id,
            plan_id: plan.id,
            listing_id: verifiedListingId,
            status: 'pending_payment',
            starts_at: startsAt.toISOString(),
            expires_at: expiresAt.toISOString(),
          })
          .select('id')
          .single();

        if (createSubErr || !createdSub?.id) {
          return NextResponse.json(
            {
              error:
                createSubErr?.message ||
                'Failed to initialize pending Print Pro subscription.',
            },
            { status: 500 }
          );
        }

        referenceId = String(createdSub.id);
        authoritativeAmountInr = Number(plan.price_inr || 0);
      } else {
        return NextResponse.json(
          {
            error:
              'Either referenceId (user_subscriptions.id) or planId (Print Pro subscription_plans.id) is required.',
          },
          { status: 400 }
        );
      }
    } else if (purpose === 'resource_booking') {
      const targetBookingId = isUuid(requestedResourceBookingId)
        ? requestedResourceBookingId
        : referenceId;

      if (!isUuid(targetBookingId)) {
        return NextResponse.json(
          {
            error:
              'Valid resourceBookingId or referenceId (resource_bookings.id) is required.',
          },
          { status: 400 }
        );
      }

      const { data: bookingRow, error: bookingErr } = await supabaseAdmin
        .from('resource_bookings')
        .select(
          'id, customer_id, hub_id, listing_id, advance_amount_inr, convenience_fee_inr, booking_status, payment_status, listing_booking_resources:resource_id(resource_vertical)'
        )
        .eq('id', targetBookingId)
        .maybeSingle();

      if (bookingErr || !bookingRow) {
        return NextResponse.json(
          { error: 'Resource booking not found.' },
          { status: 404 }
        );
      }

      if (String(bookingRow.customer_id) !== user.id) {
        return NextResponse.json(
          { error: 'Forbidden: You do not own this booking.' },
          { status: 403 }
        );
      }

      if (
        ['cancelled', 'completed', 'no_show', 'blocked'].includes(
          String(bookingRow.booking_status || '')
        )
      ) {
        return NextResponse.json(
          {
            error: `Booking is already in "${bookingRow.booking_status}" state and cannot be paid.`,
          },
          { status: 409 }
        );
      }

      if (
        ['advance_escrow_held', 'fully_prepaid_escrow', 'paid_direct_confirmed'].includes(
          String(bookingRow.payment_status || '')
        )
      ) {
        return NextResponse.json(
          { error: 'This booking has already been paid.' },
          { status: 409 }
        );
      }

      const resRel = Array.isArray(bookingRow.listing_booking_resources)
        ? (bookingRow.listing_booking_resources[0] as
            | { resource_vertical?: string }
            | undefined)
        : (bookingRow.listing_booking_resources as
            | { resource_vertical?: string }
            | null);
      const vertical: ResourceVertical =
        resRel?.resource_vertical === 'hotel_stay'
          ? 'hotel_stay'
          : 'booking_venue';

      if (bookingRow.hub_id && isUuid(String(bookingRow.hub_id))) {
        derivedHubId = String(bookingRow.hub_id);
        await assertBookingModuleEnabledForHub(
          supabaseAdmin,
          derivedHubId,
          vertical
        );
      }
      if (bookingRow.listing_id && isUuid(String(bookingRow.listing_id))) {
        await assertListingHasBookingEntitlement(
          supabaseAdmin,
          String(bookingRow.listing_id),
          vertical
        );
      }

      const advanceInr = Math.max(
        0,
        Number(bookingRow.advance_amount_inr || 0)
      );
      const convFeeInr = Math.max(
        0,
        Number(bookingRow.convenience_fee_inr || 0)
      );
      authoritativeBaseAmountInr = Math.round(advanceInr * 100) / 100;
      authoritativeConvenienceFeeInr = Math.round(convFeeInr * 100) / 100;
      authoritativeAmountInr =
        Math.round((advanceInr + convFeeInr) * 100) / 100;

      if (authoritativeAmountInr <= 0) {
        return NextResponse.json(
          {
            error:
              'This booking has no payable escrow advance requiring a payment intent.',
          },
          { status: 409 }
        );
      }

      referenceId = String(bookingRow.id);
      linkedResourceBookingId = String(bookingRow.id);
      expiresAtIso = new Date(Date.now() + BOOKING_HOLD_WINDOW_MS).toISOString();
    } else if (
      purpose === 'shop_order' ||
      purpose === 'shop_order_with_delivery'
    ) {
      if (!isUuid(referenceId)) {
        return NextResponse.json(
          { error: 'Valid shop order referenceId (UUID) is required.' },
          { status: 400 }
        );
      }
      const { data: sOrder, error: sErr } = await supabaseAdmin
        .from('shop_orders')
        .select('id, customer_id, hub_id, total_amount_inr, order_status')
        .eq('id', referenceId)
        .maybeSingle();
      if (sErr || !sOrder) {
        return NextResponse.json(
          { error: 'Shop order not found.' },
          { status: 404 }
        );
      }
      if (String(sOrder.customer_id) !== user.id) {
        return NextResponse.json(
          { error: 'Forbidden: You do not own this shop order.' },
          { status: 403 }
        );
      }
      authoritativeAmountInr = Number(sOrder.total_amount_inr || 0);
      if (sOrder.hub_id && isUuid(String(sOrder.hub_id))) {
        derivedHubId = String(sOrder.hub_id);
      }
    } else if (
      purpose === 'restaurant_order' ||
      purpose === 'restaurant_order_with_delivery'
    ) {
      if (!isUuid(referenceId)) {
        return NextResponse.json(
          { error: 'Valid restaurant order referenceId (UUID) is required.' },
          { status: 400 }
        );
      }
      const { data: rOrder, error: rErr } = await supabaseAdmin
        .from('restaurant_orders')
        .select('id, customer_id, hub_id, total_amount_inr, kitchen_status')
        .eq('id', referenceId)
        .maybeSingle();
      if (rErr || !rOrder) {
        return NextResponse.json(
          { error: 'Restaurant order not found.' },
          { status: 404 }
        );
      }
      if (String(rOrder.customer_id) !== user.id) {
        return NextResponse.json(
          { error: 'Forbidden: You do not own this food order.' },
          { status: 403 }
        );
      }
      authoritativeAmountInr = Number(rOrder.total_amount_inr || 0);
      if (rOrder.hub_id && isUuid(String(rOrder.hub_id))) {
        derivedHubId = String(rOrder.hub_id);
      }
    } else if (
      purpose === 'booking_pro_subscription' ||
      purpose === 'stay_pro_subscription' ||
      purpose === 'catalogue_pro_subscription' ||
      purpose === 'restaurant_pro_subscription'
    ) {
      const isStayPlan = purpose === 'stay_pro_subscription';
      const isCataloguePlan = purpose === 'catalogue_pro_subscription';
      const isRestaurantPlan = purpose === 'restaurant_pro_subscription';
      const allowedScopes = isStayPlan
        ? ['stay_pro', 'merchant_all_in_one', 'merchant_bundle']
        : isCataloguePlan
          ? ['catalogue_pro', 'merchant_all_in_one', 'merchant_bundle']
          : isRestaurantPlan
            ? ['restaurant_pro', 'merchant_all_in_one', 'merchant_bundle']
            : ['booking_pro', 'merchant_all_in_one', 'merchant_bundle'];
      const planLabel = isStayPlan
        ? 'Hotel & Homestay Pro'
        : isCataloguePlan
          ? 'Shop Catalogue Pro'
          : isRestaurantPlan
            ? 'Restaurant & Café Pro'
            : 'Booking Venue Pro';

      if (isUuid(referenceId)) {
        const { data: sub, error: subErr } = await supabaseAdmin
          .from('user_subscriptions')
          .select(
            'id, user_id, listing_id, status, subscription_plans:plan_id(price_inr, duration_days, plan_scope)'
          )
          .eq('id', referenceId)
          .maybeSingle();

        if (subErr || !sub) {
          return NextResponse.json(
            { error: `${planLabel} subscription record not found.` },
            { status: 404 }
          );
        }

        if (String(sub.user_id) !== user.id) {
          return NextResponse.json(
            { error: 'Forbidden: You do not own this subscription.' },
            { status: 403 }
          );
        }

        const planObj = Array.isArray(sub.subscription_plans)
          ? (sub.subscription_plans[0] as { price_inr?: number } | undefined)
          : (sub.subscription_plans as { price_inr?: number } | null);
        authoritativeAmountInr = Number(planObj?.price_inr || 0);

        const targetListing =
          (sub.listing_id ? String(sub.listing_id) : '') || requestedListingId;
        if (!derivedHubId && isUuid(targetListing)) {
          const { data: lRow } = await supabaseAdmin
            .from('listings')
            .select('hub_id')
            .eq('id', targetListing)
            .maybeSingle();
          if (lRow?.hub_id && isUuid(String(lRow.hub_id))) {
            derivedHubId = String(lRow.hub_id);
          }
        }
      } else if (isUuid(planId)) {
        const { data: plan, error: planErr } = await supabaseAdmin
          .from('subscription_plans')
          .select('id, price_inr, duration_days, is_active, plan_scope')
          .eq('id', planId)
          .eq('is_active', true)
          .in('plan_scope', allowedScopes)
          .maybeSingle();

        if (planErr || !plan) {
          return NextResponse.json(
            { error: `Selected ${planLabel} plan is not available.` },
            { status: 404 }
          );
        }

        let verifiedListingId: string | null = null;
        if (isUuid(requestedListingId)) {
          const { data: listingRow, error: listingErr } = await supabaseAdmin
            .from('listings')
            .select('id, owner_id, hub_id')
            .eq('id', requestedListingId)
            .maybeSingle();

          if (listingErr || !listingRow) {
            return NextResponse.json(
              { error: 'Target venue/property listing not found.' },
              { status: 404 }
            );
          }

          if (String(listingRow.owner_id) !== user.id) {
            return NextResponse.json(
              {
                error: `Forbidden: Only the listing owner can subscribe a listing to ${planLabel}.`,
              },
              { status: 403 }
            );
          }

          verifiedListingId = String(listingRow.id);
          if (listingRow.hub_id && isUuid(String(listingRow.hub_id))) {
            derivedHubId = String(listingRow.hub_id);
          }
        }

        const startsAt = new Date();
        const expiresAt = new Date(
          startsAt.getTime() + Number(plan.duration_days || 30) * 86400000
        );

        const { data: createdSub, error: createSubErr } = await supabaseAdmin
          .from('user_subscriptions')
          .insert({
            user_id: user.id,
            plan_id: plan.id,
            listing_id: verifiedListingId,
            status: 'pending_payment',
            starts_at: startsAt.toISOString(),
            expires_at: expiresAt.toISOString(),
          })
          .select('id')
          .single();

        if (createSubErr || !createdSub?.id) {
          return NextResponse.json(
            {
              error:
                createSubErr?.message ||
                `Failed to initialize pending ${planLabel} subscription.`,
            },
            { status: 500 }
          );
        }

        referenceId = String(createdSub.id);
        authoritativeAmountInr = Number(plan.price_inr || 0);
      } else {
        return NextResponse.json(
          {
            error: `Either referenceId (user_subscriptions.id) or planId (${planLabel} subscription_plans.id) is required.`,
          },
          { status: 400 }
        );
      }
    }

    // Resolve authoritative service hub (fallback to default hub if none derived)
    const resolvedHub = await resolveServiceHubByIdOrDefault(
      supabaseAdmin,
      derivedHubId || requestedHubId || null
    );
    const persistedHubId = isUuid(resolvedHub.id) ? resolvedHub.id : null;

    // Reuse an existing active awaiting_payment intent for the same (user, purpose, reference)
    const { data: existingIntent } = await supabaseAdmin
      .from('payment_intents')
      .select('*')
      .eq('user_id', user.id)
      .eq('purpose', purpose)
      .eq('reference_id', referenceId)
      .eq('status', 'awaiting_payment')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    let intentRecord: PaymentIntentRecord;

    if (
      existingIntent &&
      (!existingIntent.expires_at ||
        new Date(String(existingIntent.expires_at)).getTime() > Date.now())
    ) {
      // Backfill hub_id onto reused intent if previously null
      if (!existingIntent.hub_id && persistedHubId) {
        const { data: patched } = await supabaseAdmin
          .from('payment_intents')
          .update({ hub_id: persistedHubId })
          .eq('id', existingIntent.id)
          .select('*')
          .maybeSingle();
        intentRecord = (patched || existingIntent) as PaymentIntentRecord;
      } else {
        intentRecord = existingIntent as PaymentIntentRecord;
      }
    } else {
      const intentCode = generateIntentCode();
      const roundedAmount = Math.round(authoritativeAmountInr * 100) / 100;
      const baseAmount =
        authoritativeBaseAmountInr !== null
          ? authoritativeBaseAmountInr
          : roundedAmount;
      const { data: inserted, error: insertErr } = await supabaseAdmin
        .from('payment_intents')
        .insert({
          intent_code: intentCode,
          user_id: user.id,
          hub_id: persistedHubId,
          purpose,
          reference_id: referenceId,
          print_order_id: linkedPrintOrderId,
          resource_booking_id: linkedResourceBookingId,
          amount_inr: roundedAmount,
          base_amount_inr: baseAmount,
          convenience_fee_inr: authoritativeConvenienceFeeInr,
          provider,
          status: 'awaiting_payment',
          expires_at: expiresAtIso,
        })
        .select('*')
        .single();

      if (insertErr || !inserted) {
        return NextResponse.json(
          {
            error:
              insertErr?.message || 'Failed to create central payment intent.',
          },
          { status: 500 }
        );
      }

      intentRecord = inserted as PaymentIntentRecord;
    }

    if (linkedPrintOrderId && intentRecord?.id) {
      await supabaseAdmin
        .from('print_orders')
        .update({ payment_intent_id: intentRecord.id })
        .eq('id', linkedPrintOrderId);
    }

    if (linkedResourceBookingId && intentRecord?.id) {
      await supabaseAdmin
        .from('resource_bookings')
        .update({ payment_intent_id: intentRecord.id })
        .eq('id', linkedResourceBookingId);
    }

    const paymentConfig = await fetchServerPaymentConfig(
      supabaseAdmin,
      persistedHubId
    );
    const upiDetails = buildPlatformUpiDetails({
      intentCode: intentRecord.intent_code,
      amountInr: Number(intentRecord.amount_inr || 0),
      purpose: intentRecord.purpose,
      upiIdOverride: paymentConfig.upi_id,
      upiPayeeNameOverride: paymentConfig.upi_payee_name,
    });

    return NextResponse.json(
      {
        intent: intentRecord,
        hub_id: persistedHubId,
        upi_id: upiDetails.upi_id,
        upi_payee_name: upiDetails.upi_payee_name,
        upi_deep_link: upiDetails.upi_deep_link,
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof PrintApiError || err instanceof BookingApiError) {
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
            : 'Failed to create payment intent.',
      },
      { status: 500 }
    );
  }
}
