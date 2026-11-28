import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

export const dynamic = 'force-dynamic';

/**
 * POST /api/payments/refund
 * Mediator / Hub Manager / Admin escrow refund settlement endpoint (P2-11).
 * - Validates the caller's Bearer JWT against Supabase Auth.
 * - Optionally initiates an automated Razorpay refund if `razorpayPaymentId` is provided
 *   and `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET` are configured on the server.
 * - Executes `public.mediator_resolve_escrow_payout` under the caller's authenticated
 *   session so hub scope, state-machine guards, and immutable `audit_logs` are enforced by Postgres.
 */
export async function POST(req: NextRequest) {
  try {
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json(
        { error: 'Supabase environment is not configured.' },
        { status: 503 }
      );
    }

    const authHeader = req.headers.get('authorization') || '';
    const token = authHeader.startsWith('Bearer ')
      ? authHeader.slice('Bearer '.length).trim()
      : '';

    if (!token) {
      return NextResponse.json(
        { error: 'Authentication token required.' },
        { status: 401 }
      );
    }

    const body = (await req.json().catch(() => ({}))) as {
      bookingId?: string;
      reason?: string;
      refundUtrRef?: string;
      razorpayPaymentId?: string;
      amountInr?: number;
    };

    const bookingId = (body.bookingId || '').trim();
    const reason = (body.reason || '').trim();
    let refundUtrRef = (body.refundUtrRef || '').trim() || null;

    if (!bookingId || reason.length < 3) {
      return NextResponse.json(
        {
          error:
            'bookingId and a resolution reason (at least 3 characters) are required.',
        },
        { status: 400 }
      );
    }

    // Optional automated Razorpay refund when server keys are configured and a Razorpay payment ID is supplied
    const rzpKeyId = process.env.RAZORPAY_KEY_ID;
    const rzpKeySecret = process.env.RAZORPAY_KEY_SECRET;
    const razorpayPaymentId = (body.razorpayPaymentId || '').trim();

    if (razorpayPaymentId && rzpKeyId && rzpKeySecret) {
      const basicAuth = Buffer.from(`${rzpKeyId}:${rzpKeySecret}`).toString(
        'base64'
      );
      const refundPayload: Record<string, unknown> = {
        notes: {
          booking_id: bookingId,
          reason,
        },
      };
      if (typeof body.amountInr === 'number' && body.amountInr > 0) {
        refundPayload.amount = Math.round(body.amountInr * 100);
      }

      const rzpResponse = await fetch(
        `https://api.razorpay.com/v1/payments/${encodeURIComponent(
          razorpayPaymentId
        )}/refund`,
        {
          method: 'POST',
          headers: {
            Authorization: `Basic ${basicAuth}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(refundPayload),
        }
      );

      if (!rzpResponse.ok) {
        const errJson = (await rzpResponse.json().catch(() => ({}))) as {
          error?: { description?: string };
        };
        return NextResponse.json(
          {
            error:
              errJson.error?.description ||
              'Razorpay gateway refund request failed.',
          },
          { status: 502 }
        );
      }

      const rzpRefund = (await rzpResponse.json()) as { id?: string };
      if (rzpRefund.id && !refundUtrRef) {
        refundUtrRef = rzpRefund.id;
      }
    }

    const supabase = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
      global: {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      },
    });

    const { data, error } = await supabase.rpc(
      'mediator_resolve_escrow_payout',
      {
        p_booking_id: bookingId,
        p_action: 'refund_customer',
        p_reason: reason,
        p_refund_utr_ref: refundUtrRef,
      }
    );

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json({
      ok: true,
      result: data,
      refundUtrRef,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : 'Unexpected error processing refund.',
      },
      { status: 500 }
    );
  }
}
