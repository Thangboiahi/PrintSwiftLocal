import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/payments/types';
import {
  assertBookingModuleEnabledForHub,
  assertListingHasBookingEntitlement,
  authenticateBookingRequest,
  BookingApiError,
  createUserScopedSupabaseClient,
  verifyIsBookingOperatorForListing,
} from '@/lib/bookings/server-helpers';
import type { ResourceVertical } from '@/lib/bookings/types';

type OwnerBookingAction =
  | 'verify_checkin_otp'
  | 'mark_completed'
  | 'cancel_booking'
  | 'release_walk_in_block'
  | 'mark_no_show';

const ALLOWED_ACTIONS: readonly OwnerBookingAction[] = [
  'verify_checkin_otp',
  'mark_completed',
  'cancel_booking',
  'release_walk_in_block',
  'mark_no_show',
] as const;

/**
 * POST /api/bookings/[id]/owner-action
 * Strictly enforces `is_booking_operator_for(booking.listing_id)` and hub/entitlement checks.
 * Supports:
 * - `verify_checkin_otp`: verifies 4-digit OTP via `verify_booking_checkin_otp` RPC -> `checked_in` + unlocks escrow settlement
 * - `mark_completed`: transitions `checked_in` -> `completed`
 * - `cancel_booking` / `release_walk_in_block`: transitions to `cancelled` (immediately frees slot/room & reverses locked settlements)
 * - `mark_no_show`: transitions confirmed booking -> `no_show` once `start_at` has passed
 */
export async function POST(
  req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const actor = await authenticateBookingRequest(req);
    if (!actor) {
      return NextResponse.json(
        { error: 'Authentication required for booking operator actions.' },
        { status: 401 }
      );
    }

    const { id: bookingId } = await context.params;
    if (!isUuid(bookingId)) {
      return NextResponse.json(
        { error: 'Valid booking id (UUID) is required.' },
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

    const action = String(body.action ?? '').trim() as OwnerBookingAction;
    if (!(ALLOWED_ACTIONS as readonly string[]).includes(action)) {
      return NextResponse.json(
        {
          error: `action must be one of: ${ALLOWED_ACTIONS.join(', ')}.`,
        },
        { status: 400 }
      );
    }

    const { data: bookingRow, error: bookingErr } = await actor.supabaseAdmin
      .from('resource_bookings')
      .select('*, listing_booking_resources:resource_id(resource_vertical)')
      .eq('id', bookingId)
      .maybeSingle();

    if (bookingErr || !bookingRow) {
      return NextResponse.json(
        { error: 'Booking record not found.' },
        { status: 404 }
      );
    }

    const listingId = String(bookingRow.listing_id);
    const hubId = String(bookingRow.hub_id);
    const resRel = Array.isArray(bookingRow.listing_booking_resources)
      ? (bookingRow.listing_booking_resources[0] as
          | { resource_vertical?: string }
          | undefined)
      : (bookingRow.listing_booking_resources as
          | { resource_vertical?: string }
          | null);
    const vertical: ResourceVertical =
      resRel?.resource_vertical === 'hotel_stay' ? 'hotel_stay' : 'booking_venue';

    // Strictly enforce `is_booking_operator_for(booking.listing_id)` (403 otherwise)
    const isOperator = await verifyIsBookingOperatorForListing({
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
            'Forbidden: Only authorized venue/hotel owners or delegated staff may perform operator actions on this booking.',
          code: 'BOOKING_OPERATOR_REQUIRED',
        },
        { status: 403 }
      );
    }

    // Enforce hub kill-switch and active entitlement
    await assertBookingModuleEnabledForHub(actor.supabaseAdmin, hubId, vertical);
    await assertListingHasBookingEntitlement(
      actor.supabaseAdmin,
      listingId,
      vertical
    );

    const nowIso = new Date().toISOString();
    const currentStatus = String(bookingRow.booking_status || '');

    // -------------------------------------------------------------------------
    // Action 1: verify_checkin_otp
    // -------------------------------------------------------------------------
    if (action === 'verify_checkin_otp') {
      const otp = String(body.otp ?? body.checkinOtp ?? '').trim();
      const balanceCollected = Boolean(
        body.balanceCollected ?? body.balance_collected ?? false
      );

      if (!otp) {
        return NextResponse.json(
          { error: '4-digit Check-In OTP is required.' },
          { status: 400 }
        );
      }

      const rpcClient =
        (actor.userToken && createUserScopedSupabaseClient(actor.userToken)) ||
        actor.supabaseAdmin;

      const { data: rpcResult, error: rpcErr } = await rpcClient.rpc(
        'verify_booking_checkin_otp',
        {
          p_booking_id: bookingId,
          p_otp: otp,
          p_balance_collected: balanceCollected,
        }
      );

      if (rpcErr) {
        const msg = rpcErr.message || 'Check-in OTP verification failed.';
        const status = /invalid check-in otp/i.test(msg)
          ? 400
          : /forbidden/i.test(msg)
            ? 403
            : /cannot check in/i.test(msg)
              ? 409
              : 400;
        return NextResponse.json({ error: msg }, { status });
      }

      const { data: refreshedBooking } = await actor.supabaseAdmin
        .from('resource_bookings')
        .select('*')
        .eq('id', bookingId)
        .maybeSingle();

      return NextResponse.json({
        ok: true,
        checkin: rpcResult,
        booking: refreshedBooking,
      });
    }

    // -------------------------------------------------------------------------
    // Action 2: mark_completed (`checked_in` -> `completed`)
    // -------------------------------------------------------------------------
    if (action === 'mark_completed') {
      if (currentStatus !== 'checked_in') {
        return NextResponse.json(
          {
            error: `Only checked-in bookings can be marked completed (current status: "${currentStatus}").`,
            code: 'INVALID_STATUS_TRANSITION',
          },
          { status: 409 }
        );
      }

      const balanceCollected = Boolean(
        body.balanceCollected ?? body.balance_collected ?? false
      );
      const updatePayload: Record<string, unknown> = {
        booking_status: 'completed',
        updated_at: nowIso,
      };

      if (
        balanceCollected &&
        ['unpaid', 'advance_escrow_held'].includes(
          String(bookingRow.payment_status || '')
        )
      ) {
        updatePayload.payment_status = 'paid_direct_confirmed';
      }

      const { data: updatedBooking, error: updateErr } =
        await actor.supabaseAdmin
          .from('resource_bookings')
          .update(updatePayload)
          .eq('id', bookingId)
          .select('*')
          .single();

      if (updateErr || !updatedBooking) {
        return NextResponse.json(
          {
            error:
              updateErr?.message || 'Failed to mark booking as completed.',
          },
          { status: 500 }
        );
      }

      return NextResponse.json({
        ok: true,
        booking: updatedBooking,
      });
    }

    // -------------------------------------------------------------------------
    // Action 3: cancel_booking / release_walk_in_block
    // -------------------------------------------------------------------------
    if (action === 'cancel_booking' || action === 'release_walk_in_block') {
      if (
        action === 'release_walk_in_block' &&
        String(bookingRow.booking_source) !== 'walk_in_block' &&
        currentStatus !== 'blocked'
      ) {
        return NextResponse.json(
          {
            error:
              'release_walk_in_block can only be applied to walk-in manual blocks.',
          },
          { status: 400 }
        );
      }

      if (['completed', 'cancelled'].includes(currentStatus)) {
        return NextResponse.json(
          {
            error: `Booking is already "${currentStatus}" and cannot be cancelled.`,
            code: 'INVALID_STATUS_TRANSITION',
          },
          { status: 409 }
        );
      }

      const reason = String(body.reason ?? '').trim();
      const existingNotes = bookingRow.notes ? String(bookingRow.notes) : '';
      const nextNotes = reason
        ? existingNotes
          ? `${existingNotes}\n[Cancelled: ${reason}]`
          : `[Cancelled: ${reason}]`
        : existingNotes || null;

      const updatePayload: Record<string, unknown> = {
        booking_status: 'cancelled',
        cancelled_at: nowIso,
        notes: nextNotes,
        updated_at: nowIso,
      };

      if (String(bookingRow.settlement_status) === 'locked') {
        updatePayload.settlement_status = 'reversed';
      }

      const { data: updatedBooking, error: cancelErr } =
        await actor.supabaseAdmin
          .from('resource_bookings')
          .update(updatePayload)
          .eq('id', bookingId)
          .select('*')
          .single();

      if (cancelErr || !updatedBooking) {
        return NextResponse.json(
          {
            error: cancelErr?.message || 'Failed to cancel booking.',
          },
          { status: 500 }
        );
      }

      if (
        ['locked', 'eligible'].includes(
          String(bookingRow.settlement_status || '')
        )
      ) {
        await actor.supabaseAdmin
          .from('merchant_settlements')
          .update({ status: 'reversed', updated_at: nowIso })
          .eq('resource_booking_id', bookingId)
          .in('status', ['locked', 'eligible']);
      }

      return NextResponse.json({
        ok: true,
        booking: updatedBooking,
      });
    }

    // -------------------------------------------------------------------------
    // Action 4: mark_no_show (after start_at passes)
    // -------------------------------------------------------------------------
    if (action === 'mark_no_show') {
      if (currentStatus !== 'confirmed') {
        return NextResponse.json(
          {
            error: `Only confirmed bookings can be marked as no-show (current status: "${currentStatus}").`,
            code: 'INVALID_STATUS_TRANSITION',
          },
          { status: 409 }
        );
      }

      const startMs = Date.parse(String(bookingRow.start_at || ''));
      if (Number.isNaN(startMs) || Date.now() < startMs) {
        return NextResponse.json(
          {
            error:
              'A booking can only be marked as no-show after its scheduled start time has passed.',
            code: 'NO_SHOW_BEFORE_START_TIME',
          },
          { status: 409 }
        );
      }

      const { data: updatedBooking, error: noShowErr } =
        await actor.supabaseAdmin
          .from('resource_bookings')
          .update({
            booking_status: 'no_show',
            updated_at: nowIso,
          })
          .eq('id', bookingId)
          .select('*')
          .single();

      if (noShowErr || !updatedBooking) {
        return NextResponse.json(
          {
            error:
              noShowErr?.message || 'Failed to mark booking as no-show.',
          },
          { status: 500 }
        );
      }

      return NextResponse.json({
        ok: true,
        booking: updatedBooking,
      });
    }

    return NextResponse.json({ error: 'Unsupported action.' }, { status: 400 });
  } catch (err) {
    if (err instanceof BookingApiError) {
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
            : 'Unexpected error while processing booking operator action.',
      },
      { status: 500 }
    );
  }
}
