import { NextRequest, NextResponse } from 'next/server';
import { fetchServerPaymentConfig } from '@/lib/config/server';
import { isUuid, type PaymentIntentRecord } from '@/lib/payments/types';
import {
  createServerSupabaseAdminClient,
  extractSupabaseAccessToken,
} from '@/lib/pick-n-drop/fare';

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

interface RazorpayOrderResponse {
  id?: string;
  amount?: number;
  currency?: string;
  status?: string;
  error?: {
    description?: string;
    code?: string;
  };
}

/**
 * POST /api/payments/razorpay/create-order
 * Authenticated server route that creates a Razorpay Order for an active
 * `payment_intents` row while strictly enforcing the Super-Admin Full-Manual kill switch.
 */
export async function POST(req: NextRequest) {
  try {
    const token = extractSupabaseAccessToken(req);
    if (!token) {
      return NextResponse.json(
        { error: 'Authentication required to create a Razorpay order.' },
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

    // 1. Server-Side Kill Switch Check against platform_settings.payment_config
    const paymentConfig = await fetchServerPaymentConfig(supabaseAdmin);
    if (
      !paymentConfig.razorpay_enabled ||
      paymentConfig.payment_mode === 'manual_only'
    ) {
      return NextResponse.json(
        {
          error:
            'Razorpay is currently disabled by administrator. Please use Manual UPI.',
        },
        { status: 403 }
      );
    }

    // 2. Verify server Razorpay credentials (secret is strictly server env only)
    const keySecret = (process.env.RAZORPAY_KEY_SECRET || '').trim();
    const keyId = (
      paymentConfig.razorpay_key_id ||
      process.env.RAZORPAY_KEY_ID ||
      ''
    ).trim();

    if (!keySecret || !keyId) {
      return NextResponse.json(
        {
          error:
            'Razorpay gateway credentials are not fully configured on the server.',
        },
        { status: 503 }
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

    const intentId = String(body.intent_id ?? body.intentId ?? '').trim();
    if (!isUuid(intentId)) {
      return NextResponse.json(
        { error: 'Valid intent_id is required.' },
        { status: 400 }
      );
    }

    // 3. Fetch user's payment_intents row and validate ownership + awaiting_payment status
    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from('payment_intents')
      .select('*')
      .eq('id', intentId)
      .maybeSingle();

    if (fetchErr || !existing) {
      return NextResponse.json(
        { error: 'Payment intent not found.' },
        { status: 404 }
      );
    }

    const intent = existing as PaymentIntentRecord;

    if (intent.user_id !== user.id) {
      return NextResponse.json(
        { error: 'Forbidden: You do not own this payment intent.' },
        { status: 403 }
      );
    }

    if (intent.status !== 'awaiting_payment') {
      return NextResponse.json(
        {
          error: `Cannot initialize Razorpay checkout because payment intent is "${intent.status}".`,
        },
        { status: 409 }
      );
    }

    if (
      intent.expires_at &&
      new Date(intent.expires_at).getTime() < Date.now()
    ) {
      await supabaseAdmin
        .from('payment_intents')
        .update({
          status: 'failed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', intent.id);

      return NextResponse.json(
        {
          error:
            'This payment session has expired. Please start a fresh checkout.',
        },
        { status: 409 }
      );
    }

    // 4. Calculate server-authoritative net amount + online convenience fee
    const baseAmount =
      typeof intent.base_amount_inr === 'number' &&
      Number.isFinite(intent.base_amount_inr)
        ? Number(intent.base_amount_inr)
        : Number(intent.amount_inr || 0);
    const discountInr = Math.max(0, Number(intent.discount_inr || 0));
    const netAmount = Math.max(0, round2(baseAmount - discountInr));

    const feePct = Math.max(
      0,
      Number(paymentConfig.online_convenience_fee_pct || 0)
    );
    const convenienceFeeInr = round2(netAmount * (feePct / 100));
    const finalAmountInr = round2(netAmount + convenienceFeeInr);
    const amountPaise = Math.round(finalAmountInr * 100);

    if (amountPaise < 100) {
      return NextResponse.json(
        {
          error:
            'Razorpay requires a minimum payable amount of ₹1.00. Please use Manual UPI or adjust your order.',
        },
        { status: 400 }
      );
    }

    // 5. Create Order via Razorpay Orders REST API
    const basicAuth = Buffer.from(`${keyId}:${keySecret}`).toString('base64');
    const rzpRes = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${basicAuth}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        amount: amountPaise,
        currency: 'INR',
        receipt: intent.intent_code.slice(0, 40),
        notes: {
          intent_id: intent.id,
          intent_code: intent.intent_code,
          purpose: intent.purpose,
        },
      }),
      cache: 'no-store',
    });

    const rzpJson = (await rzpRes.json().catch(() => ({}))) as RazorpayOrderResponse;

    if (!rzpRes.ok || !rzpJson.id) {
      return NextResponse.json(
        {
          error:
            rzpJson.error?.description ||
            `Razorpay order creation failed (HTTP ${rzpRes.status}).`,
        },
        { status: 502 }
      );
    }

    // 6. Persist Razorpay order reference and computed fee/amount on payment_intents
    const { error: updateErr } = await supabaseAdmin
      .from('payment_intents')
      .update({
        provider: 'razorpay',
        provider_order_id: rzpJson.id,
        base_amount_inr: baseAmount,
        convenience_fee_inr: convenienceFeeInr,
        amount_inr: finalAmountInr,
        updated_at: new Date().toISOString(),
      })
      .eq('id', intent.id)
      .eq('status', 'awaiting_payment');

    if (updateErr) {
      return NextResponse.json(
        {
          error:
            updateErr.message ||
            'Failed to persist Razorpay order reference on payment intent.',
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      razorpay_order_id: rzpJson.id,
      amount_paise: amountPaise,
      currency: 'INR',
      key_id: keyId,
      convenience_fee_inr: convenienceFeeInr,
      final_amount_inr: finalAmountInr,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : 'Failed to create Razorpay order.',
      },
      { status: 500 }
    );
  }
}
