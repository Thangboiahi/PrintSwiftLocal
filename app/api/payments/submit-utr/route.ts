import { NextRequest, NextResponse } from 'next/server';
import {
  createServerSupabaseAdminClient,
  extractSupabaseAccessToken,
} from '@/lib/pick-n-drop/fare';
import { isUuid, type PaymentIntentRecord } from '@/lib/payments/types';

/**
 * POST /api/payments/submit-utr
 * Authenticated route allowing a user to submit their 12-digit UPI UTR reference
 * (and optional payment proof path), moving `payment_intents.status` to `pending_manual`
 * and advancing the linked domain entity (e.g. vehicle_booking -> pending_payment_confirm,
 * delivery_order -> payment_submitted).
 */
export async function POST(req: NextRequest) {
  try {
    const token = extractSupabaseAccessToken(req);
    if (!token) {
      return NextResponse.json(
        { error: 'Authentication required to submit payment proof.' },
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

    const intentId = String(body.intentId ?? body.intent_id ?? '').trim();
    const upiUtrRef = String(
      body.upiUtrRef ?? body.upi_utr_ref ?? ''
    ).trim();
    const paymentProofPathRaw = String(
      body.paymentProofPath ?? body.payment_proof_path ?? ''
    ).trim();
    const paymentProofPath = paymentProofPathRaw || null;

    if (!isUuid(intentId)) {
      return NextResponse.json(
        { error: 'Valid intentId is required.' },
        { status: 400 }
      );
    }

    if (upiUtrRef.length < 6 || upiUtrRef.length > 64) {
      return NextResponse.json(
        {
          error:
            'Please provide a valid UPI UTR / transaction reference (6–64 characters, e.g., 12-digit UTR).',
        },
        { status: 400 }
      );
    }

    if (!/^[A-Za-z0-9/_-]+$/.test(upiUtrRef)) {
      return NextResponse.json(
        {
          error:
            'UPI UTR reference may only contain letters, numbers, hyphens, underscores, or slashes.',
        },
        { status: 400 }
      );
    }

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
          error: `Cannot submit UTR because this payment intent is already "${intent.status}".`,
        },
        { status: 409 }
      );
    }

    // Check hold/intent expiration
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

      if (intent.purpose === 'vehicle_booking') {
        await supabaseAdmin
          .from('vehicle_bookings')
          .update({
            status: 'expired',
            updated_at: new Date().toISOString(),
          })
          .eq('id', intent.reference_id)
          .eq('status', 'soft_hold');
      }

      return NextResponse.json(
        {
          error:
            'This payment hold window has expired. Please create a fresh booking or payment intent.',
        },
        { status: 409 }
      );
    }

    // Reject obvious duplicate UTR already succeeded elsewhere
    const { data: duplicateUtr } = await supabaseAdmin
      .from('payment_intents')
      .select('id')
      .eq('upi_utr_ref', upiUtrRef)
      .eq('status', 'succeeded')
      .limit(1)
      .maybeSingle();

    if (duplicateUtr?.id) {
      return NextResponse.json(
        {
          error:
            'This UPI UTR reference has already been used for another verified payment.',
        },
        { status: 409 }
      );
    }

    const nowIso = new Date().toISOString();

    const { data: updatedIntent, error: updateErr } = await supabaseAdmin
      .from('payment_intents')
      .update({
        upi_utr_ref: upiUtrRef,
        payment_proof_path: paymentProofPath ?? intent.payment_proof_path,
        status: 'pending_manual',
        updated_at: nowIso,
      })
      .eq('id', intent.id)
      .eq('status', 'awaiting_payment')
      .select('*')
      .single();

    if (updateErr || !updatedIntent) {
      return NextResponse.json(
        {
          error:
            updateErr?.message ||
            'Failed to record UPI UTR reference on payment intent.',
        },
        { status: 500 }
      );
    }

    // Advance linked domain entity cleanly
    if (intent.purpose === 'vehicle_booking') {
      await supabaseAdmin
        .from('vehicle_bookings')
        .update({
          status: 'pending_payment_confirm',
          updated_at: nowIso,
        })
        .eq('id', intent.reference_id)
        .eq('status', 'soft_hold');
    } else if (intent.purpose === 'pick_n_drop') {
      await supabaseAdmin
        .from('delivery_orders')
        .update({
          status: 'payment_submitted',
          updated_at: nowIso,
        })
        .eq('id', intent.reference_id)
        .eq('status', 'awaiting_payment');

      await supabaseAdmin.from('delivery_transactions').insert({
        order_id: intent.reference_id,
        tx_type: 'upi_payment',
        amount_inr: intent.amount_inr,
        upi_utr_ref: upiUtrRef,
        payment_proof_path: paymentProofPath,
        recorded_by: user.id,
        notes: `Submitted via payment intent ${intent.intent_code}`,
      });
    } else if (intent.purpose === 'bulletin_post_pass') {
      await supabaseAdmin
        .from('bulletin_post_passes')
        .update({
          upi_utr_ref: upiUtrRef,
          status: 'pending_verification',
        })
        .eq('id', intent.reference_id);
    } else if (intent.purpose === 'bulletin_subscription') {
      await supabaseAdmin
        .from('user_subscriptions')
        .update({
          payment_ref: upiUtrRef,
        })
        .eq('id', intent.reference_id);
    }

    return NextResponse.json({
      ok: true,
      intent: updatedIntent as PaymentIntentRecord,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : 'Failed to submit UPI UTR reference.',
      },
      { status: 500 }
    );
  }
}
