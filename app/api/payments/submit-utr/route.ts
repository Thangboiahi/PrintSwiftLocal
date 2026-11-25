import { NextRequest, NextResponse } from 'next/server';
import {
  createServerSupabaseAdminClient,
  extractSupabaseAccessToken,
} from '@/lib/pick-n-drop/fare';
import { isUuid, type PaymentIntentRecord } from '@/lib/payments/types';
import {
  DUPLICATE_UTR_FRIENDLY_MESSAGE,
  mapDuplicateUtrError,
} from '@/lib/mediator/types';

function isUniqueViolation(err: { code?: string | null; message?: string | null } | null | undefined): boolean {
  if (!err) return false;
  if (err.code === '23505') return true;
  const msg = String(err.message || '').toLowerCase();
  return (
    msg.includes('23505') ||
    msg.includes('duplicate key') ||
    msg.includes('idx_payment_intents_unique_active_utr') ||
    msg.includes('idx_delivery_transactions_unique_active_utr') ||
    msg.includes('idx_unique_succeeded_utr')
  );
}

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
    const upiUtrRef = String(body.upiUtrRef ?? body.upi_utr_ref ?? '')
      .trim()
      .toUpperCase();
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

    // Reject duplicate UTR across ALL active (pending_manual + succeeded) payment_intents
    const { data: duplicateIntent } = await supabaseAdmin
      .from('payment_intents')
      .select('id')
      .ilike('upi_utr_ref', upiUtrRef)
      .in('status', ['pending_manual', 'succeeded'])
      .neq('id', intent.id)
      .limit(1)
      .maybeSingle();

    if (duplicateIntent?.id) {
      return NextResponse.json(
        { error: DUPLICATE_UTR_FRIENDLY_MESSAGE, code: 'DUPLICATE_UTR' },
        { status: 409 }
      );
    }

    // Also guard against duplicate UTR already recorded in active/verified delivery_transactions
    if (intent.purpose === 'pick_n_drop') {
      const { data: duplicateDeliveryTx } = await supabaseAdmin
        .from('delivery_transactions')
        .select('id')
        .ilike('upi_utr_ref', upiUtrRef)
        .eq('tx_type', 'upi_payment')
        .in('status', ['active', 'verified'])
        .limit(1)
        .maybeSingle();

      if (duplicateDeliveryTx?.id) {
        return NextResponse.json(
          { error: DUPLICATE_UTR_FRIENDLY_MESSAGE, code: 'DUPLICATE_UTR' },
          { status: 409 }
        );
      }
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
      if (isUniqueViolation(updateErr)) {
        return NextResponse.json(
          { error: DUPLICATE_UTR_FRIENDLY_MESSAGE, code: 'DUPLICATE_UTR' },
          { status: 409 }
        );
      }
      return NextResponse.json(
        {
          error: mapDuplicateUtrError(
            updateErr || 'Failed to record UPI UTR reference on payment intent.'
          ),
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
      const { error: txErr } = await supabaseAdmin
        .from('delivery_transactions')
        .insert({
          order_id: intent.reference_id,
          tx_type: 'upi_payment',
          status: 'active',
          amount_inr: intent.amount_inr,
          upi_utr_ref: upiUtrRef,
          payment_proof_path: paymentProofPath,
          recorded_by: user.id,
          notes: `Submitted via payment intent ${intent.intent_code}`,
        });

      if (txErr) {
        // Roll back payment_intents so the customer can enter a corrected UTR
        await supabaseAdmin
          .from('payment_intents')
          .update({
            status: 'awaiting_payment',
            upi_utr_ref: null,
            updated_at: new Date().toISOString(),
          })
          .eq('id', intent.id);

        if (isUniqueViolation(txErr)) {
          return NextResponse.json(
            { error: DUPLICATE_UTR_FRIENDLY_MESSAGE, code: 'DUPLICATE_UTR' },
            { status: 409 }
          );
        }

        return NextResponse.json(
          { error: mapDuplicateUtrError(txErr) },
          { status: 500 }
        );
      }

      await supabaseAdmin
        .from('delivery_orders')
        .update({
          status: 'payment_submitted',
          updated_at: nowIso,
        })
        .eq('id', intent.reference_id)
        .eq('status', 'awaiting_payment');
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
        error: mapDuplicateUtrError(
          err instanceof Error
            ? err.message
            : 'Failed to submit UPI UTR reference.'
        ),
      },
      { status: 500 }
    );
  }
}
