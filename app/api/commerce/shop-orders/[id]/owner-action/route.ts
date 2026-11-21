import { NextRequest, NextResponse } from 'next/server';
import {
  assertCommerceModuleEnabledForHub,
  authenticateCommerceRequest,
  CommerceApiError,
  createUserScopedSupabaseClient,
  verifyIsCommerceOperatorForListing,
} from '@/lib/commerce/server-helpers';
import { isUuid } from '@/lib/payments/types';

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await authenticateCommerceRequest(req);
    if (!actor) {
      return NextResponse.json(
        { error: 'Authentication required for shop operator actions.' },
        { status: 401 }
      );
    }

    const { id: orderId } = await context.params;
    if (!isUuid(orderId)) {
      return NextResponse.json(
        { error: 'Valid shop order id (UUID) is required.' },
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

    const action = String(body.action ?? '').trim();
    if (action !== 'update_status' && action !== 'verify_otp_handover') {
      return NextResponse.json(
        { error: 'action must be update_status or verify_otp_handover.' },
        { status: 400 }
      );
    }

    const { data: orderRow, error: orderErr } = await actor.supabaseAdmin
      .from('shop_orders')
      .select('*')
      .eq('id', orderId)
      .maybeSingle();

    if (orderErr || !orderRow) {
      return NextResponse.json(
        { error: 'Shop order not found.' },
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
            'Forbidden: Only authorized shop owners or delegated staff may perform this action.',
          code: 'COMMERCE_OPERATOR_REQUIRED',
        },
        { status: 403 }
      );
    }

    await assertCommerceModuleEnabledForHub(
      actor.supabaseAdmin,
      hubId,
      'shop_catalogue'
    );

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
          p_order_type: 'shop_order',
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
        .from('shop_orders')
        .select('*')
        .eq('id', orderId)
        .maybeSingle();

      return NextResponse.json({
        ok: true,
        handover: rpcRes,
        order: refreshed,
      });
    }

    // action === 'update_status'
    const nextStatus = String(body.status ?? body.nextStatus ?? '').trim();
    if (!['packing', 'ready_for_pickup', 'cancelled'].includes(nextStatus)) {
      return NextResponse.json(
        { error: 'status must be packing, ready_for_pickup, or cancelled.' },
        { status: 400 }
      );
    }

    const nowIso = new Date().toISOString();
    const updatePayload: Record<string, unknown> = {
      order_status: nextStatus,
      updated_at: nowIso,
    };

    if (nextStatus === 'cancelled' && String(orderRow.settlement_status) === 'locked') {
      updatePayload.settlement_status = 'reversed';
    }

    const { data: updated, error: updateErr } = await actor.supabaseAdmin
      .from('shop_orders')
      .update(updatePayload)
      .eq('id', orderId)
      .select('*')
      .single();

    if (updateErr || !updated) {
      return NextResponse.json(
        { error: updateErr?.message || 'Failed to update shop order status.' },
        { status: 500 }
      );
    }

    if (nextStatus === 'cancelled') {
      await actor.supabaseAdmin
        .from('merchant_settlements')
        .update({ status: 'reversed', updated_at: nowIso })
        .eq('shop_order_id', orderId)
        .in('status', ['locked', 'eligible']);
    }

    return NextResponse.json({ ok: true, order: updated });
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
            : 'Unexpected error while updating shop order.',
      },
      { status: 500 }
    );
  }
}
