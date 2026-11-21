import { NextRequest, NextResponse } from 'next/server';
import {
  assertCommerceModuleEnabledForHub,
  authenticateCommerceRequest,
  CommerceApiError,
  createUserScopedSupabaseClient,
  verifyIsCommerceOperatorForListing,
} from '@/lib/commerce/server-helpers';
import { isUuid } from '@/lib/payments/types';

type KitchenAction =
  | 'accept_order'
  | 'mark_ready'
  | 'reject_order'
  | 'verify_otp_handover';

const ALLOWED_ACTIONS: readonly KitchenAction[] = [
  'accept_order',
  'mark_ready',
  'reject_order',
  'verify_otp_handover',
];

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await authenticateCommerceRequest(req);
    if (!actor) {
      return NextResponse.json(
        { error: 'Authentication required for kitchen operator actions.' },
        { status: 401 }
      );
    }

    const { id: orderId } = await context.params;
    if (!isUuid(orderId)) {
      return NextResponse.json(
        { error: 'Valid restaurant order id (UUID) is required.' },
        { status: 400 }
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

    const action = String(body.action ?? '').trim() as KitchenAction;
    if (!(ALLOWED_ACTIONS as readonly string[]).includes(action)) {
      return NextResponse.json(
        { error: `action must be one of: ${ALLOWED_ACTIONS.join(', ')}.` },
        { status: 400 }
      );
    }

    const { data: orderRow, error: orderErr } = await actor.supabaseAdmin
      .from('restaurant_orders')
      .select('*')
      .eq('id', orderId)
      .maybeSingle();

    if (orderErr || !orderRow) {
      return NextResponse.json(
        { error: 'Restaurant order not found.' },
        { status: 404 }
      );
    }

    const listingId = String(orderRow.listing_id);
    const hubId = String(orderRow.hub_id);

    const isOperator = await verifyIsCommerceOperatorForListing({
      supabaseAdmin: actor.supabaseAdmin,
      userToken: actor.userToken,
      userId: actor.userId,
      actualRole: actor.actualRole,
      listingId,
    });
    if (!isOperator) {
      return NextResponse.json(
        {
          error:
            'Forbidden: Only authorized restaurant owners or kitchen staff may perform this action.',
          code: 'COMMERCE_OPERATOR_REQUIRED',
        },
        { status: 403 }
      );
    }

    await assertCommerceModuleEnabledForHub(
      actor.supabaseAdmin,
      hubId,
      'restaurant_food'
    );

    const nowIso = new Date().toISOString();
    const currentStatus = String(orderRow.kitchen_status || '');

    if (action === 'verify_otp_handover') {
      const otp = String(body.otp ?? body.pickupOtp ?? '').trim();
      const directPaymentConfirmed = Boolean(
        body.directPaymentConfirmed ?? body.direct_payment_confirmed ?? false
      );
      if (!otp) {
        return NextResponse.json(
          { error: '4-digit Pickup OTP is required.' },
          { status: 400 }
        );
      }

      const rpcClient =
        (actor.userToken && createUserScopedSupabaseClient(actor.userToken)) ||
        actor.supabaseAdmin;

      const { data: rpcRes, error: rpcErr } = await rpcClient.rpc(
        'verify_commerce_pickup_otp',
        {
          p_order_type: 'restaurant_order',
          p_order_id: orderId,
          p_otp: otp,
          p_direct_payment_confirmed: directPaymentConfirmed,
        }
      );

      if (rpcErr) {
        return NextResponse.json(
          { error: rpcErr.message || 'OTP verification failed.' },
          { status: /invalid pickup otp/i.test(rpcErr.message) ? 400 : 409 }
        );
      }

      const { data: refreshed } = await actor.supabaseAdmin
        .from('restaurant_orders')
        .select('*')
        .eq('id', orderId)
        .maybeSingle();

      return NextResponse.json({
        ok: true,
        handover: rpcRes,
        order: refreshed,
      });
    }

    if (action === 'accept_order') {
      if (currentStatus !== 'new_order') {
        return NextResponse.json(
          {
            error: `Only new_order orders can be accepted (current: ${currentStatus}).`,
          },
          { status: 409 }
        );
      }
      const nextPrepMins = Number(
        body.estimatedPrepMins ??
          body.estimated_prep_mins ??
          orderRow.estimated_prep_mins ??
          25
      );
      const { data: updated, error: updErr } = await actor.supabaseAdmin
        .from('restaurant_orders')
        .update({
          kitchen_status: 'preparing',
          estimated_prep_mins: Math.max(
            5,
            Math.min(180, Math.round(nextPrepMins))
          ),
          updated_at: nowIso,
        })
        .eq('id', orderId)
        .select('*')
        .single();
      if (updErr || !updated) {
        return NextResponse.json(
          { error: updErr?.message || 'Failed to accept order.' },
          { status: 500 }
        );
      }
      return NextResponse.json({ ok: true, order: updated });
    }

    if (action === 'mark_ready') {
      if (currentStatus !== 'preparing') {
        return NextResponse.json(
          {
            error: `Only preparing orders can be marked ready (current: ${currentStatus}).`,
          },
          { status: 409 }
        );
      }
      const { data: updated, error: updErr } = await actor.supabaseAdmin
        .from('restaurant_orders')
        .update({
          kitchen_status: 'ready_for_pickup',
          updated_at: nowIso,
        })
        .eq('id', orderId)
        .select('*')
        .single();
      if (updErr || !updated) {
        return NextResponse.json(
          { error: updErr?.message || 'Failed to mark order ready.' },
          { status: 500 }
        );
      }
      return NextResponse.json({ ok: true, order: updated });
    }

    // action === 'reject_order'
    if (currentStatus !== 'new_order') {
      return NextResponse.json(
        {
          error: `Only new_order orders can be rejected (current: ${currentStatus}).`,
        },
        { status: 409 }
      );
    }

    const isEscrowHeld = String(orderRow.payment_status) === 'escrow_held';
    const updatePayload: Record<string, unknown> = {
      kitchen_status: 'rejected',
      updated_at: nowIso,
    };
    if (isEscrowHeld || String(orderRow.settlement_status) === 'locked') {
      updatePayload.settlement_status = 'reversed';
    }

    const { data: updated, error: updErr } = await actor.supabaseAdmin
      .from('restaurant_orders')
      .update(updatePayload)
      .eq('id', orderId)
      .select('*')
      .single();

    if (updErr || !updated) {
      return NextResponse.json(
        { error: updErr?.message || 'Failed to reject order.' },
        { status: 500 }
      );
    }

    if (isEscrowHeld || String(orderRow.settlement_status) === 'locked') {
      await actor.supabaseAdmin
        .from('merchant_settlements')
        .update({ status: 'reversed', updated_at: nowIso })
        .eq('restaurant_order_id', orderId)
        .in('status', ['locked', 'eligible']);
    }

    return NextResponse.json({
      ok: true,
      refundRequired: isEscrowHeld,
      order: updated,
    });
  } catch (err) {
    if (err instanceof CommerceApiError) {
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
            : 'Unexpected error while updating restaurant order.',
      },
      { status: 500 }
    );
  }
}
