import { createHmac, timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { isUuid, type PaymentIntentRecord } from '@/lib/payments/types';
import {
  createServerSupabaseAdminClient,
  extractSupabaseAccessToken,
} from '@/lib/pick-n-drop/fare';

function verifyCheckoutSignature(
  dbOrderId: string,
  razorpayPaymentId: string,
  receivedSignature: string,
  keySecret: string
): boolean {
  const expected = createHmac('sha256', keySecret)
    .update(`${dbOrderId}|${razorpayPaymentId}`, 'utf8')
    .digest('hex');

  const expectedBuf = Buffer.from(expected, 'utf8');
  const receivedBuf = Buffer.from(receivedSignature.trim(), 'utf8');

  if (
    expectedBuf.length === 0 ||
    expectedBuf.length !== receivedBuf.length
  ) {
    return false;
  }

  return timingSafeEqual(expectedBuf, receivedBuf);
}

/**
 * POST /api/payments/razorpay/verify
 * Authenticated browser callback verification for Razorpay Checkout.
 * - Strictly fetches `provider_order_id` from our database (never trusts order ID from client).
 * - Verifies HMAC-SHA256 signature using `timingSafeEqual`.
 * - Atomically calls idempotent `fulfill_payment_intent(intent_id, razorpay_payment_id, 'razorpay')`.
 */
export async function POST(req: NextRequest) {
  try {
    const token = extractSupabaseAccessToken(req);
    if (!token) {
      return NextResponse.json(
        { error: 'Authentication required to verify payment.' },
        { status: 401 }
      );
    }

    const keySecret = (process.env.RAZORPAY_KEY_SECRET || '').trim();
    if (!keySecret) {
      return NextResponse.json(
        {
          error:
            'Razorpay verification is unavailable (RAZORPAY_KEY_SECRET not configured).',
        },
        { status: 503 }
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

    const intentId = String(body.intent_id ?? body.intentId ?? '').trim();
    const razorpayPaymentId = String(
      body.razorpay_payment_id ?? body.razorpayPaymentId ?? ''
    ).trim();
    const razorpaySignature = String(
      body.razorpay_signature ?? body.razorpaySignature ?? ''
    ).trim();

    if (!isUuid(intentId)) {
      return NextResponse.json(
        { error: 'Valid intent_id is required.' },
        { status: 400 }
      );
    }

    if (!razorpayPaymentId || !razorpaySignature) {
      return NextResponse.json(
        {
          error:
            'razorpay_payment_id and razorpay_signature are required.',
        },
        { status: 400 }
      );
    }

    // Fetch authoritative provider_order_id strictly from our database
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

    const dbOrderId = (intent.provider_order_id || '').trim();
    if (!dbOrderId) {
      return NextResponse.json(
        {
          error:
            'No Razorpay order has been initialized for this payment intent.',
        },
        { status: 400 }
      );
    }

    const isValidSignature = verifyCheckoutSignature(
      dbOrderId,
      razorpayPaymentId,
      razorpaySignature,
      keySecret
    );

    if (!isValidSignature) {
      return NextResponse.json(
        { error: 'Invalid payment signature.' },
        { status: 400 }
      );
    }

    // Idempotent atomic fulfillment via Supabase Service Role client
    const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc(
      'fulfill_payment_intent',
      {
        p_intent_id: intent.id,
        p_provider_payment_id: razorpayPaymentId,
        p_provider: 'razorpay',
      }
    );

    if (rpcError) {
      return NextResponse.json(
        {
          error:
            rpcError.message ||
            'Payment verified, but fulfillment failed. Please contact support.',
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      intent_id: intent.id,
      result: rpcResult,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : 'Failed to verify Razorpay payment.',
      },
      { status: 500 }
    );
  }
}
