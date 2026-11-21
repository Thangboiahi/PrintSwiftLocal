import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/payments/types';
import { resolveDualRailPaymentPolicy } from '@/lib/print-orders/quote-engine';
import {
  authenticatePrintRequest,
  createUserScopedSupabaseClient,
  loadAndValidatePrintProfile,
  PrintApiError,
  verifyIsPrintOperatorForListing,
} from '@/lib/print-orders/server-helpers';
import type {
  PrintHandoverMode,
  PrintQuoteSnapshot,
} from '@/lib/print-orders/types';

type ShopActionType =
  | 'send_custom_quote'
  | 'update_status'
  | 'verify_otp_handover'
  | 'report_no_show';

const ALLOWED_SHOP_ACTIONS: readonly ShopActionType[] = [
  'send_custom_quote',
  'update_status',
  'verify_otp_handover',
  'report_no_show',
] as const;

const NO_SHOW_THRESHOLD_MS = 48 * 60 * 60 * 1000; // 48 hours

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await authenticatePrintRequest(req);
    if (!actor) {
      return NextResponse.json(
        { error: 'Authentication required for shop print actions.' },
        { status: 401 }
      );
    }

    const { id: orderId } = await context.params;
    if (!isUuid(orderId)) {
      return NextResponse.json(
        { error: 'Valid print order id (UUID) is required.' },
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

    const action = String(body.action ?? '').trim() as ShopActionType;
    if (!(ALLOWED_SHOP_ACTIONS as readonly string[]).includes(action)) {
      return NextResponse.json(
        {
          error: `action must be one of: ${ALLOWED_SHOP_ACTIONS.join(', ')}.`,
        },
        { status: 400 }
      );
    }

    const { data: orderRow, error: orderErr } = await actor.supabaseAdmin
      .from('print_orders')
      .select('*')
      .eq('id', orderId)
      .maybeSingle();

    if (orderErr || !orderRow) {
      return NextResponse.json(
        { error: 'Print order not found.' },
        { status: 404 }
      );
    }

    const listingId = String(orderRow.listing_id);

    // Enforce hub kill-switch + Print Pro entitlement
    const profile = await loadAndValidatePrintProfile(
      actor.supabaseAdmin,
      listingId
    );

    // Strictly verify `is_print_operator_for(order.listing_id)`
    // (Rejects Hub Managers & general admins on third-party shops)
    const isOperator = await verifyIsPrintOperatorForListing({
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
            'Forbidden: Only authorized shop owners or delegated print staff may perform shop actions on this order.',
        },
        { status: 403 }
      );
    }

    const nowIso = new Date().toISOString();

    // -------------------------------------------------------------------------
    // Action 1: send_custom_quote (Mode B Custom Digital Jobs)
    // -------------------------------------------------------------------------
    if (action === 'send_custom_quote') {
      if (String(orderRow.job_mode) !== 'custom_digital') {
        return NextResponse.json(
          {
            error:
              'send_custom_quote is only valid for Custom Digital quote requests.',
          },
          { status: 400 }
        );
      }

      if (
        ['collected', 'cancelled'].includes(String(orderRow.fulfillment_status))
      ) {
        return NextResponse.json(
          { error: 'Cannot quote a cancelled or already collected order.' },
          { status: 409 }
        );
      }

      const rawAmount = Number(
        body.quotedAmountInr ?? body.quoted_amount_inr ?? NaN
      );
      if (!Number.isFinite(rawAmount) || rawAmount <= 0 || rawAmount > 500000) {
        return NextResponse.json(
          {
            error:
              'quotedAmountInr must be a positive number up to ₹5,00,000.',
          },
          { status: 400 }
        );
      }

      const quotedAmountInr = Math.round(rawAmount * 100) / 100;
      const customNote =
        String(body.note ?? body.customQuoteNote ?? '').trim() || null;
      const turnaroundNote =
        String(body.turnaroundNote ?? body.turnaround_note ?? '').trim() || null;

      const { data: customerProfile } = await actor.supabaseAdmin
        .from('profiles')
        .select('print_no_show_count')
        .eq('id', String(orderRow.customer_id))
        .maybeSingle();

      const handoverMode: PrintHandoverMode =
        orderRow.handover_mode === 'pick_n_drop'
          ? 'pick_n_drop'
          : 'walk_in_pickup';

      const dualRail = resolveDualRailPaymentPolicy({
        profile,
        handoverMode,
        totalAmountInr: quotedAmountInr,
        customerNoShowCount: Number(customerProfile?.print_no_show_count ?? 0),
      });

      const platformFeeInr = Math.max(
        0,
        Number(profile.rate_card?.platform_fee_inr ?? 0)
      );

      const quoteSnapshot: PrintQuoteSnapshot = {
        pricing_version: profile.pricing_version,
        calculated_at: nowIso,
        currency: 'INR',
        job_mode: 'custom_digital',
        handover_mode: handoverMode,
        sealed_envelope_requested: Boolean(orderRow.sealed_envelope_requested),
        files: [],
        total_selected_pages: 0,
        total_logical_sides: 0,
        total_physical_sheets: 0,
        print_subtotal_inr: quotedAmountInr,
        bulk_discount_percent: 0,
        bulk_discount_inr: 0,
        finishing_total_inr: 0,
        sealed_envelope_fee_inr: 0,
        min_order_adjustment_inr: 0,
        platform_fee_inr: platformFeeInr,
        total_amount_inr: Math.round((quotedAmountInr + platformFeeInr) * 100) / 100,
        allowed_payment_rails: dualRail.allowedPaymentRails,
        forced_escrow: dualRail.forcedEscrow,
        forced_escrow_reason: dualRail.forcedEscrowReason,
        custom_quote_note: customNote,
        custom_turnaround_note: turnaroundNote,
      };

      const { data: updatedOrder, error: updateErr } = await actor.supabaseAdmin
        .from('print_orders')
        .update({
          quoted_amount_inr: quoteSnapshot.total_amount_inr,
          platform_fee_inr: platformFeeInr,
          quote_snapshot: quoteSnapshot,
          quote_status: 'quoted',
          payment_status: 'unpaid',
          payment_rail: dualRail.forcedEscrow
            ? 'platform_escrow'
            : (orderRow.payment_rail as string) || 'platform_escrow',
          updated_at: nowIso,
        })
        .eq('id', orderId)
        .select('*')
        .single();

      if (updateErr || !updatedOrder) {
        return NextResponse.json(
          { error: updateErr?.message || 'Failed to save custom quote.' },
          { status: 500 }
        );
      }

      await actor.supabaseAdmin.from('print_order_events').insert({
        print_order_id: orderId,
        actor_id: actor.userId,
        actor_role: actor.actualRole,
        event_type: 'custom_quote_sent',
        metadata: {
          quoted_amount_inr: quoteSnapshot.total_amount_inr,
          custom_quote_note: customNote,
          custom_turnaround_note: turnaroundNote,
          allowed_payment_rails: dualRail.allowedPaymentRails,
          forced_escrow: dualRail.forcedEscrow,
        },
      });

      return NextResponse.json({
        ok: true,
        order: updatedOrder,
        quoteSnapshot,
        allowedPaymentRails: dualRail.allowedPaymentRails,
        forcedEscrowReason: dualRail.forcedEscrowReason,
      });
    }

    // -------------------------------------------------------------------------
    // Action 2: update_status (`printing` | `ready_for_pickup` | `cancelled`)
    // -------------------------------------------------------------------------
    if (action === 'update_status') {
      const nextStatus = String(
        body.status ?? body.fulfillmentStatus ?? body.fulfillment_status ?? ''
      ).trim();

      if (!['printing', 'ready_for_pickup', 'cancelled'].includes(nextStatus)) {
        return NextResponse.json(
          {
            error:
              'status must be one of: printing, ready_for_pickup, cancelled.',
          },
          { status: 400 }
        );
      }

      const currentStatus = String(orderRow.fulfillment_status);
      if (['collected', 'cancelled'].includes(currentStatus)) {
        return NextResponse.json(
          {
            error: `Order is already finalized ("${currentStatus}") and cannot transition to "${nextStatus}".`,
          },
          { status: 409 }
        );
      }

      if (
        (nextStatus === 'printing' || nextStatus === 'ready_for_pickup') &&
        currentStatus === 'draft'
      ) {
        return NextResponse.json(
          {
            error:
              'Order must be confirmed or escrow-funded before starting printing.',
          },
          { status: 409 }
        );
      }

      const reason = String(body.reason ?? '').trim() || null;
      const updatePayload: Record<string, unknown> = {
        fulfillment_status: nextStatus,
        updated_at: nowIso,
      };

      if (nextStatus === 'cancelled') {
        updatePayload.purge_status = 'scheduled';
        updatePayload.purge_scheduled_at = nowIso;
        if (String(orderRow.settlement_status) === 'locked') {
          updatePayload.settlement_status = 'reversed';
        }
      }

      const { data: updatedOrder, error: updateErr } = await actor.supabaseAdmin
        .from('print_orders')
        .update(updatePayload)
        .eq('id', orderId)
        .select('*')
        .single();

      if (updateErr || !updatedOrder) {
        return NextResponse.json(
          { error: updateErr?.message || 'Failed to update print order status.' },
          { status: 500 }
        );
      }

      if (nextStatus === 'cancelled') {
        await actor.supabaseAdmin
          .from('merchant_settlements')
          .update({ status: 'reversed', updated_at: nowIso })
          .eq('print_order_id', orderId)
          .in('status', ['locked', 'eligible']);
      }

      await actor.supabaseAdmin.from('print_order_events').insert({
        print_order_id: orderId,
        actor_id: actor.userId,
        actor_role: actor.actualRole,
        event_type: 'status_updated',
        metadata: {
          previous_status: currentStatus,
          fulfillment_status: nextStatus,
          reason,
        },
      });

      return NextResponse.json({
        ok: true,
        order: updatedOrder,
      });
    }

    // -------------------------------------------------------------------------
    // Action 3: verify_otp_handover (calls verify_print_collection_otp RPC)
    // -------------------------------------------------------------------------
    if (action === 'verify_otp_handover') {
      const otp = String(body.otp ?? body.collectionOtp ?? '').trim();
      const directPaymentConfirmed = Boolean(
        body.directPaymentConfirmed ?? body.direct_payment_confirmed ?? false
      );

      if (!otp) {
        return NextResponse.json(
          { error: 'Collection OTP is required for handover verification.' },
          { status: 400 }
        );
      }

      // Call DB RPC under caller's JWT when available, otherwise service-role after strict operator check
      const rpcClient =
        (actor.userToken && createUserScopedSupabaseClient(actor.userToken)) ||
        actor.supabaseAdmin;

      const { data: rpcResult, error: rpcErr } = await rpcClient.rpc(
        'verify_print_collection_otp',
        {
          p_order_id: orderId,
          p_otp: otp,
          p_direct_payment_confirmed: directPaymentConfirmed,
        }
      );

      if (rpcErr) {
        const status = /invalid collection otp/i.test(rpcErr.message)
          ? 400
          : /forbidden/i.test(rpcErr.message)
            ? 403
            : /already finalized/i.test(rpcErr.message)
              ? 409
              : 400;
        return NextResponse.json({ error: rpcErr.message }, { status });
      }

      return NextResponse.json({
        ok: true,
        handover: rpcResult,
      });
    }

    // -------------------------------------------------------------------------
    // Action 4: report_no_show (direct-pay uncollected orders > 48h ready)
    // -------------------------------------------------------------------------
    if (action === 'report_no_show') {
      const rail = String(orderRow.payment_rail);
      if (!['direct_counter', 'direct_shop_upi'].includes(rail)) {
        return NextResponse.json(
          {
            error:
              'No-show reporting only applies to direct-pay (Pay at Counter / Shop UPI) orders.',
          },
          { status: 400 }
        );
      }

      if (
        String(orderRow.fulfillment_status) !== 'ready_for_pickup' ||
        orderRow.collected_at !== null
      ) {
        return NextResponse.json(
          {
            error:
              'No-show can only be reported on uncollected orders currently in ready_for_pickup status.',
          },
          { status: 409 }
        );
      }

      // Check when order transitioned to ready_for_pickup
      const { data: readyEvent } = await actor.supabaseAdmin
        .from('print_order_events')
        .select('created_at')
        .eq('print_order_id', orderId)
        .eq('event_type', 'status_updated')
        .contains('metadata', { fulfillment_status: 'ready_for_pickup' })
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      const readyAtIso =
        readyEvent?.created_at ||
        (orderRow.updated_at ? String(orderRow.updated_at) : null);
      const readyMs = readyAtIso ? Date.parse(readyAtIso) : NaN;

      if (Number.isNaN(readyMs) || Date.now() - readyMs < NO_SHOW_THRESHOLD_MS) {
        const hoursRemaining = Number.isNaN(readyMs)
          ? 48
          : Math.ceil((NO_SHOW_THRESHOLD_MS - (Date.now() - readyMs)) / 3600000);
        return NextResponse.json(
          {
            error: `Orders must remain uncollected for at least 48 hours after Ready for Pickup before reporting a no-show (~${hoursRemaining}h remaining).`,
            code: 'NO_SHOW_WINDOW_NOT_ELAPSED',
          },
          { status: 409 }
        );
      }

      // Prevent duplicate no-show strike on the same order
      const { data: existingNoShowEvent } = await actor.supabaseAdmin
        .from('print_order_events')
        .select('id')
        .eq('print_order_id', orderId)
        .eq('event_type', 'no_show_reported')
        .limit(1)
        .maybeSingle();

      if (existingNoShowEvent) {
        return NextResponse.json(
          { error: 'A no-show has already been recorded for this order.' },
          { status: 409 }
        );
      }

      const customerId = String(orderRow.customer_id);
      const { data: custProfile } = await actor.supabaseAdmin
        .from('profiles')
        .select('print_no_show_count')
        .eq('id', customerId)
        .maybeSingle();

      const nextNoShowCount =
        Math.max(0, Number(custProfile?.print_no_show_count ?? 0)) + 1;

      const { error: incErr } = await actor.supabaseAdmin
        .from('profiles')
        .update({ print_no_show_count: nextNoShowCount })
        .eq('id', customerId);

      if (incErr) {
        return NextResponse.json(
          { error: `Failed to record customer no-show count: ${incErr.message}` },
          { status: 500 }
        );
      }

      const { data: cancelledOrder, error: cancelErr } =
        await actor.supabaseAdmin
          .from('print_orders')
          .update({
            fulfillment_status: 'cancelled',
            purge_status: 'scheduled',
            purge_scheduled_at: nowIso,
            updated_at: nowIso,
          })
          .eq('id', orderId)
          .select('*')
          .single();

      if (cancelErr) {
        return NextResponse.json(
          { error: `Failed to cancel no-show order: ${cancelErr.message}` },
          { status: 500 }
        );
      }

      await actor.supabaseAdmin.from('print_order_events').insert({
        print_order_id: orderId,
        actor_id: actor.userId,
        actor_role: actor.actualRole,
        event_type: 'no_show_reported',
        metadata: {
          customer_id: customerId,
          customer_no_show_count: nextNoShowCount,
          ready_at: readyAtIso,
          reported_at: nowIso,
        },
      });

      return NextResponse.json({
        ok: true,
        order: cancelledOrder,
        customerNoShowCount: nextNoShowCount,
      });
    }

    return NextResponse.json({ error: 'Unsupported action.' }, { status: 400 });
  } catch (err) {
    if (err instanceof PrintApiError) {
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
            : 'Unexpected error while processing shop print action.',
      },
      { status: 500 }
    );
  }
}
