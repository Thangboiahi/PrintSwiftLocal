import { createHmac, timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAdminClient } from '@/lib/pick-n-drop/fare';
import { isUuid } from '@/lib/payments/types';

function verifyRazorpaySignature(
  rawBody: string,
  receivedSignature: string,
  webhookSecret: string
): boolean {
  const expectedHex = createHmac('sha256', webhookSecret)
    .update(rawBody, 'utf8')
    .digest('hex');

  const expectedBuf = Buffer.from(expectedHex, 'utf8');
  const receivedBuf = Buffer.from(receivedSignature.trim(), 'utf8');

  if (
    expectedBuf.length === 0 ||
    expectedBuf.length !== receivedBuf.length
  ) {
    return false;
  }

  return timingSafeEqual(expectedBuf, receivedBuf);
}

interface RazorpayPaymentEntity {
  id?: string;
  order_id?: string;
  amount?: number; // paise
  currency?: string;
  status?: string;
  notes?: Record<string, string | undefined>;
}

interface RazorpayWebhookPayload {
  event?: string;
  payload?: {
    payment?: {
      entity?: RazorpayPaymentEntity;
    };
  };
}

/**
 * POST /api/payments/razorpay/webhook
 * Plug-and-play Razorpay webhook handoff endpoint.
 * - Verifies `x-razorpay-signature` via HMAC-SHA256 using `RAZORPAY_WEBHOOK_SECRET`.
 * - On `payment.captured`, resolves the matching `payment_intents` record and
 *   atomically invokes the `fulfill_payment_intent` SECURITY DEFINER RPC.
 * - On `payment.failed`, marks pending intents as `failed`.
 */
export async function POST(req: NextRequest) {
  try {
    const webhookSecret = (process.env.RAZORPAY_WEBHOOK_SECRET || '').trim();
    if (!webhookSecret) {
      return NextResponse.json(
        {
          error:
            'Razorpay webhook is not yet enabled (RAZORPAY_WEBHOOK_SECRET not configured).',
        },
        { status: 503 }
      );
    }

    const signature = (req.headers.get('x-razorpay-signature') || '').trim();
    if (!signature) {
      return NextResponse.json(
        { error: 'Missing x-razorpay-signature header.' },
        { status: 400 }
      );
    }

    // Must read raw request text verbatim before JSON parsing for HMAC integrity
    const rawBody = await req.text();
    if (!verifyRazorpaySignature(rawBody, signature, webhookSecret)) {
      return NextResponse.json(
        { error: 'Invalid Razorpay webhook signature.' },
        { status: 401 }
      );
    }

    const parsed = JSON.parse(rawBody) as RazorpayWebhookPayload;
    const event = String(parsed.event || '').trim();
    const paymentEntity = parsed.payload?.payment?.entity;

    if (!paymentEntity) {
      return NextResponse.json({
        ok: true,
        received: true,
        event,
        ignored: true,
      });
    }

    const providerPaymentId = String(paymentEntity.id || '').trim() || null;
    const providerOrderId = String(paymentEntity.order_id || '').trim() || null;
    const notesIntentId = String(paymentEntity.notes?.intent_id || '').trim();
    const notesIntentCode = String(
      paymentEntity.notes?.intent_code || ''
    ).trim();

    const supabaseAdmin = createServerSupabaseAdminClient();

    // Locate matching payment_intent by provider_order_id, notes.intent_id, or notes.intent_code
    let matchedIntent: {
      id: string;
      amount_inr: number;
      status: string;
    } | null = null;

    if (providerOrderId) {
      const { data } = await supabaseAdmin
        .from('payment_intents')
        .select('id, amount_inr, status')
        .eq('provider_order_id', providerOrderId)
        .maybeSingle();
      if (data) {
        matchedIntent = {
          id: String(data.id),
          amount_inr: Number(data.amount_inr || 0),
          status: String(data.status || ''),
        };
      }
    }

    if (!matchedIntent && isUuid(notesIntentId)) {
      const { data } = await supabaseAdmin
        .from('payment_intents')
        .select('id, amount_inr, status')
        .eq('id', notesIntentId)
        .maybeSingle();
      if (data) {
        matchedIntent = {
          id: String(data.id),
          amount_inr: Number(data.amount_inr || 0),
          status: String(data.status || ''),
        };
      }
    }

    if (!matchedIntent && notesIntentCode) {
      const { data } = await supabaseAdmin
        .from('payment_intents')
        .select('id, amount_inr, status')
        .eq('intent_code', notesIntentCode)
        .maybeSingle();
      if (data) {
        matchedIntent = {
          id: String(data.id),
          amount_inr: Number(data.amount_inr || 0),
          status: String(data.status || ''),
        };
      }
    }

    if (!matchedIntent) {
      return NextResponse.json({
        ok: true,
        received: true,
        event,
        matched: false,
      });
    }

    if (event === 'payment.captured') {
      // Guard: Verify captured amount in paise matches expected intent amount
      const capturedPaise = Number(paymentEntity.amount ?? 0);
      const expectedPaise = Math.round(matchedIntent.amount_inr * 100);
      if (
        expectedPaise > 0 &&
        capturedPaise > 0 &&
        capturedPaise < expectedPaise
      ) {
        return NextResponse.json(
          {
            error: `Captured amount mismatch (${capturedPaise} paise < expected ${expectedPaise} paise).`,
          },
          { status: 400 }
        );
      }

      if (matchedIntent.status !== 'succeeded') {
        // Stamp provider metadata before fulfilling
        await supabaseAdmin
          .from('payment_intents')
          .update({
            provider: 'razorpay',
            provider_order_id: providerOrderId,
            provider_payment_id: providerPaymentId,
            updated_at: new Date().toISOString(),
          })
          .eq('id', matchedIntent.id)
          .neq('status', 'succeeded');
      }

      const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc(
        'fulfill_payment_intent',
        {
          p_intent_id: matchedIntent.id,
          p_provider_payment_id: providerPaymentId,
          p_provider: 'razorpay',
        }
      );

      if (rpcError) {
        return NextResponse.json(
          {
            error:
              rpcError.message ||
              'Failed to fulfill payment intent from Razorpay webhook.',
          },
          { status: 500 }
        );
      }

      return NextResponse.json({
        ok: true,
        received: true,
        event,
        fulfilled: true,
        result: rpcResult,
      });
    }

    if (event === 'payment.failed') {
      await supabaseAdmin
        .from('payment_intents')
        .update({
          provider: 'razorpay',
          provider_order_id: providerOrderId,
          provider_payment_id: providerPaymentId,
          status: 'failed',
          updated_at: new Date().toISOString(),
        })
        .eq('id', matchedIntent.id)
        .in('status', ['awaiting_payment', 'pending_manual']);

      return NextResponse.json({
        ok: true,
        received: true,
        event,
        marked_failed: true,
      });
    }

    return NextResponse.json({
      ok: true,
      received: true,
      event,
      ignored: true,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : 'Failed to process Razorpay webhook.',
      },
      { status: 500 }
    );
  }
}
