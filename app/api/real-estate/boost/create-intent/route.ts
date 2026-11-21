import { NextRequest, NextResponse } from 'next/server';
import {
  fetchServerPaymentConfig,
  resolveServiceHubByIdOrDefault,
} from '@/lib/config/server';
import {
  buildPlatformUpiDetails,
  isUuid,
  type PaymentIntentRecord,
} from '@/lib/payments/types';
import {
  assertRealEstateModuleEnabledForHub,
  authenticateRealEstateRequest,
  generateRealEstateIntentCode,
  isRealEstateOperatorForUser,
  RealEstateApiError,
} from '@/lib/real-estate/server-helpers';

const DEFAULT_BOOST_PRICE_INR = 299;

/**
 * POST /api/real-estate/boost/create-intent
 * Strictly checks `is_real_estate_operator_for(listingId)`.
 * Loads active `real_estate_boost_30d` plan pricing from `subscription_plans`
 * and creates a `payment_intents` row (`purpose = 'real_estate_boost_30d'`,
 * `real_estate_listing_id = listingId`) ready for UniversalPaymentModal.
 */
export async function POST(req: NextRequest) {
  try {
    const actor = await authenticateRealEstateRequest(req);
    if (!actor) {
      return NextResponse.json(
        { error: 'Authentication required to boost a property listing.' },
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
    const provider =
      body.provider === 'razorpay' ? 'razorpay' : ('manual_upi' as const);

    if (!isUuid(listingId)) {
      return NextResponse.json(
        { error: 'Valid listingId is required.' },
        { status: 400 }
      );
    }

    const isOperator = await isRealEstateOperatorForUser(
      actor.supabaseAdmin,
      listingId,
      actor.userId,
      actor.actualRole
    );
    if (!isOperator) {
      return NextResponse.json(
        {
          error:
            'Forbidden: Only the property owner, delegated staff, or super admin may purchase a Verified Boost Pass.',
        },
        { status: 403 }
      );
    }

    const { data: reProfile } = await actor.supabaseAdmin
      .from('listing_real_estate_profiles')
      .select('listing_id, hub_id')
      .eq('listing_id', listingId)
      .maybeSingle();

    if (!reProfile) {
      return NextResponse.json(
        { error: 'Real estate profile not found for this listing.' },
        { status: 404 }
      );
    }

    const resolvedHub = await resolveServiceHubByIdOrDefault(
      actor.supabaseAdmin,
      String(reProfile.hub_id || '') || null
    );

    await assertRealEstateModuleEnabledForHub(
      actor.supabaseAdmin,
      resolvedHub.id
    );

    // Load active `real_estate_boost_30d` plan pricing from subscription_plans
    const { data: planRow } = await actor.supabaseAdmin
      .from('subscription_plans')
      .select('id, slug, name, price_inr, duration_days')
      .eq('slug', 'real_estate_boost_30d')
      .eq('is_active', true)
      .maybeSingle();

    const amountInr =
      planRow && Number(planRow.price_inr) > 0
        ? Number(planRow.price_inr)
        : DEFAULT_BOOST_PRICE_INR;

    // Reuse an existing active awaiting_payment intent for this listing if present
    const nowIso = new Date().toISOString();
    const { data: existingIntent } = await actor.supabaseAdmin
      .from('payment_intents')
      .select('*')
      .eq('user_id', actor.userId)
      .eq('purpose', 'real_estate_boost_30d')
      .eq('real_estate_listing_id', listingId)
      .eq('status', 'awaiting_payment')
      .gt('expires_at', nowIso)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    const paymentCfg = await fetchServerPaymentConfig(actor.supabaseAdmin);
    const effectiveUpiId =
      resolvedHub.manual_upi_override?.upi_id?.trim() || paymentCfg.upi_id;
    const effectivePayeeName =
      resolvedHub.manual_upi_override?.upi_payee_name?.trim() ||
      paymentCfg.upi_payee_name;

    if (existingIntent?.id) {
      const intent = existingIntent as PaymentIntentRecord;
      const upi = buildPlatformUpiDetails({
        intentCode: intent.intent_code,
        amountInr: Number(intent.amount_inr || amountInr),
        purpose: 'real_estate_boost_30d',
        upiIdOverride: effectiveUpiId,
        upiPayeeNameOverride: effectivePayeeName,
      });
      return NextResponse.json({
        ok: true,
        reused: true,
        intent,
        upi_id: upi.upi_id,
        upi_payee_name: upi.upi_payee_name,
        upi_deep_link: upi.upi_deep_link,
      });
    }

    const intentCode = generateRealEstateIntentCode();
    const expiresAtIso = new Date(Date.now() + 30 * 60 * 1000).toISOString();

    const { data: inserted, error: insertErr } = await actor.supabaseAdmin
      .from('payment_intents')
      .insert({
        intent_code: intentCode,
        user_id: actor.userId,
        hub_id: resolvedHub.id,
        purpose: 'real_estate_boost_30d',
        reference_id: listingId,
        real_estate_listing_id: listingId,
        amount_inr: amountInr,
        base_amount_inr: amountInr,
        discount_inr: 0,
        convenience_fee_inr: 0,
        provider,
        status: 'awaiting_payment',
        expires_at: expiresAtIso,
        metadata: {
          listing_id: listingId,
          plan_slug: planRow?.slug || 'real_estate_boost_30d',
          duration_days: Number(planRow?.duration_days || 30),
        },
      })
      .select('*')
      .single();

    if (insertErr || !inserted) {
      return NextResponse.json(
        { error: insertErr?.message || 'Could not create boost payment intent.' },
        { status: 500 }
      );
    }

    const intent = inserted as PaymentIntentRecord;
    const upi = buildPlatformUpiDetails({
      intentCode: intent.intent_code,
      amountInr,
      purpose: 'real_estate_boost_30d',
      upiIdOverride: effectiveUpiId,
      upiPayeeNameOverride: effectivePayeeName,
    });

    return NextResponse.json(
      {
        ok: true,
        reused: false,
        intent,
        upi_id: upi.upi_id,
        upi_payee_name: upi.upi_payee_name,
        upi_deep_link: upi.upi_deep_link,
      },
      { status: 201 }
    );
  } catch (err) {
    if (err instanceof RealEstateApiError) {
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
            : 'Unexpected error creating boost payment intent.',
      },
      { status: 500 }
    );
  }
}
