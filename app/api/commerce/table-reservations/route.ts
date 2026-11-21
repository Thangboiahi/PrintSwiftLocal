import { NextRequest, NextResponse } from 'next/server';
import {
  assertCommerceModuleEnabledForHub,
  authenticateCommerceRequest,
  CommerceApiError,
  generateCommerceOrderCode,
  normalizeRestaurantProfileRow,
  verifyIsCommerceOperatorForListing,
} from '@/lib/commerce/server-helpers';
import { isUuid } from '@/lib/payments/types';

export async function POST(req: NextRequest) {
  try {
    const actor = await authenticateCommerceRequest(req);
    if (!actor) {
      return NextResponse.json(
        { error: 'Authentication required for table reservations.' },
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

    const action = String(body.action ?? 'create').trim();

    if (action === 'create') {
      const listingId = String(body.listingId ?? body.listing_id ?? '').trim();
      if (!isUuid(listingId)) {
        return NextResponse.json(
          { error: 'Valid listingId (UUID) is required.' },
          { status: 400 }
        );
      }

      const { data: profileRow, error: profErr } = await actor.supabaseAdmin
        .from('listing_restaurant_profiles')
        .select('*')
        .eq('listing_id', listingId)
        .maybeSingle();

      if (profErr || !profileRow) {
        return NextResponse.json(
          { error: 'Restaurant profile not found.' },
          { status: 404 }
        );
      }

      const profile = normalizeRestaurantProfileRow(
        profileRow as Record<string, unknown>
      );

      await assertCommerceModuleEnabledForHub(
        actor.supabaseAdmin,
        profile.hub_id,
        'restaurant_food'
      );

      if (!profile.allow_table_booking) {
        return NextResponse.json(
          {
            error: 'Table reservations are not enabled for this restaurant.',
            code: 'TABLE_BOOKING_DISABLED',
          },
          { status: 400 }
        );
      }

      const partySize = Math.floor(
        Number(body.partySize ?? body.party_size ?? 2)
      );
      if (
        !Number.isFinite(partySize) ||
        partySize < 1 ||
        partySize > profile.max_table_party_size
      ) {
        return NextResponse.json(
          {
            error: `partySize must be between 1 and ${profile.max_table_party_size}.`,
          },
          { status: 400 }
        );
      }

      const reservedForRaw = String(
        body.reservedFor ?? body.reserved_for ?? ''
      ).trim();
      const reservedDate = new Date(reservedForRaw);
      if (!reservedForRaw || Number.isNaN(reservedDate.getTime())) {
        return NextResponse.json(
          { error: 'A valid reservedFor date/time is required.' },
          { status: 400 }
        );
      }

      const guestName =
        String(body.guestName ?? body.guest_name ?? '').trim() ||
        actor.profile.full_name ||
        'Guest';
      const guestPhone =
        String(body.guestPhone ?? body.guest_phone ?? '').trim() ||
        actor.profile.phone ||
        null;
      const specialRequest =
        String(body.specialRequest ?? body.special_request ?? '').trim() || null;

      const { data: created, error: createErr } = await actor.supabaseAdmin
        .from('restaurant_table_reservations')
        .insert({
          reservation_code: generateCommerceOrderCode('DDT'),
          hub_id: profile.hub_id,
          listing_id: listingId,
          customer_id: actor.userId,
          guest_name: guestName,
          guest_phone: guestPhone,
          party_size: partySize,
          reserved_for: reservedDate.toISOString(),
          special_request: specialRequest,
          status: 'requested',
        })
        .select('*')
        .single();

      if (createErr || !created) {
        return NextResponse.json(
          { error: createErr?.message || 'Failed to submit table reservation.' },
          { status: 500 }
        );
      }

      return NextResponse.json({ ok: true, reservation: created }, { status: 201 });
    }

    if (action === 'update_status') {
      const reservationId = String(
        body.reservationId ?? body.reservation_id ?? ''
      ).trim();
      const nextStatus = String(body.status ?? body.nextStatus ?? '').trim();

      if (!isUuid(reservationId)) {
        return NextResponse.json(
          { error: 'Valid reservationId (UUID) is required.' },
          { status: 400 }
        );
      }

      if (
        !['confirmed', 'seated', 'completed', 'declined', 'cancelled'].includes(
          nextStatus
        )
      ) {
        return NextResponse.json(
          {
            error:
              'status must be confirmed, seated, completed, declined, or cancelled.',
          },
          { status: 400 }
        );
      }

      const { data: resRow, error: resErr } = await actor.supabaseAdmin
        .from('restaurant_table_reservations')
        .select('*')
        .eq('id', reservationId)
        .maybeSingle();

      if (resErr || !resRow) {
        return NextResponse.json(
          { error: 'Table reservation not found.' },
          { status: 404 }
        );
      }

      const isOperator = await verifyIsCommerceOperatorForListing({
        supabaseAdmin: actor.supabaseAdmin,
        userToken: actor.userToken,
        userId: actor.userId,
        actualRole: actor.actualRole,
        listingId: String(resRow.listing_id),
      });

      const isCustomerCancel =
        nextStatus === 'cancelled' && String(resRow.customer_id) === actor.userId;

      if (!isOperator && !isCustomerCancel) {
        return NextResponse.json(
          {
            error:
              'Forbidden: Only restaurant operators may update table reservation status.',
            code: 'COMMERCE_OPERATOR_REQUIRED',
          },
          { status: 403 }
        );
      }

      const { data: updated, error: updateErr } = await actor.supabaseAdmin
        .from('restaurant_table_reservations')
        .update({
          status: nextStatus,
          updated_at: new Date().toISOString(),
        })
        .eq('id', reservationId)
        .select('*')
        .single();

      if (updateErr || !updated) {
        return NextResponse.json(
          { error: updateErr?.message || 'Failed to update table reservation.' },
          { status: 500 }
        );
      }

      return NextResponse.json({ ok: true, reservation: updated });
    }

    return NextResponse.json(
      { error: 'action must be create or update_status.' },
      { status: 400 }
    );
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
            : 'Unexpected error in table reservations.',
      },
      { status: 500 }
    );
  }
}
