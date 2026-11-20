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
            'purpose must be one of: pick_n_drop, vehicle_booking, bulletin_subscription, bulletin_post_pass.',
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

    let referenceId = String(body.referenceId ?? body.reference_id ?? '').trim();
    const planId = String(body.planId ?? body.plan_id ?? '').trim();
    let authoritativeAmountInr = 0;
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
      const { data: inserted, error: insertErr } = await supabaseAdmin
        .from('payment_intents')
        .insert({
          intent_code: intentCode,
          user_id: user.id,
          hub_id: persistedHubId,
          purpose,
          reference_id: referenceId,
          amount_inr: roundedAmount,
          base_amount_inr: roundedAmount,
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
