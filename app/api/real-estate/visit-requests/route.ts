import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/payments/types';
import {
  assertRealEstateModuleEnabledForHub,
  authenticateRealEstateRequest,
  generateVisitRequestCode,
  isRealEstateOperatorForUser,
  RealEstateApiError,
} from '@/lib/real-estate/server-helpers';
import type {
  PropertyVisitSlot,
  PropertyVisitStatus,
} from '@/lib/real-estate/types';

const VALID_SLOTS: readonly PropertyVisitSlot[] = [
  'morning',
  'afternoon',
  'evening',
];

const OPERATOR_STATUSES: readonly PropertyVisitStatus[] = [
  'accepted',
  'rescheduled',
  'completed',
  'declined',
];

/**
 * POST /api/real-estate/visit-requests
 * Supports:
 * 1. `action: 'create'` (Authenticated Customer)
 * 2. `action: 'update_status'` (Owner/Agent/Delegated Staff or Customer cancel)
 */
export async function POST(req: NextRequest) {
  try {
    const actor = await authenticateRealEstateRequest(req);
    if (!actor) {
      return NextResponse.json(
        { error: 'Please sign in to manage property site visits.' },
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

    const action = String(body.action || 'create').trim().toLowerCase();

    if (action === 'create') {
      const listingId = String(body.listingId ?? body.listing_id ?? '').trim();
      const requesterName = String(
        body.requesterName ?? body.requester_name ?? actor.profile.full_name ?? ''
      ).trim();
      const requesterPhone = String(
        body.requesterPhone ?? body.requester_phone ?? actor.profile.phone ?? ''
      ).trim();
      const preferredDate = String(
        body.preferredDate ?? body.preferred_date ?? ''
      ).trim();
      const rawSlot = String(
        body.preferredSlot ?? body.preferred_slot ?? 'morning'
      )
        .trim()
        .toLowerCase() as PropertyVisitSlot;
      const message =
        typeof body.message === 'string' && body.message.trim()
          ? body.message.trim().slice(0, 600)
          : null;

      if (!isUuid(listingId)) {
        return NextResponse.json(
          { error: 'Valid listingId is required.' },
          { status: 400 }
        );
      }
      if (!requesterName) {
        return NextResponse.json(
          { error: 'Your name is required to request a site visit.' },
          { status: 400 }
        );
      }
      if (requesterPhone.replace(/\D/g, '').length < 7) {
        return NextResponse.json(
          { error: 'A valid contact phone number is required.' },
          { status: 400 }
        );
      }
      if (!/^\d{4}-\d{2}-\d{2}$/.test(preferredDate)) {
        return NextResponse.json(
          { error: 'preferredDate must be in YYYY-MM-DD format.' },
          { status: 400 }
        );
      }
      if (!VALID_SLOTS.includes(rawSlot)) {
        return NextResponse.json(
          { error: 'preferredSlot must be morning, afternoon, or evening.' },
          { status: 400 }
        );
      }

      const { data: reProfile, error: profErr } = await actor.supabaseAdmin
        .from('listing_real_estate_profiles')
        .select('listing_id, hub_id, availability_status')
        .eq('listing_id', listingId)
        .maybeSingle();

      if (profErr || !reProfile) {
        return NextResponse.json(
          { error: 'Real estate property profile not found.' },
          { status: 404 }
        );
      }

      await assertRealEstateModuleEnabledForHub(
        actor.supabaseAdmin,
        String(reProfile.hub_id)
      );

      if (
        reProfile.availability_status !== 'available' &&
        reProfile.availability_status !== 'under_offer'
      ) {
        return NextResponse.json(
          {
            error:
              'This property is currently not accepting new site visit requests.',
          },
          { status: 409 }
        );
      }

      // Prevent duplicate active 'requested' spam for same (listing_id, requester_id)
      const { data: existingReq } = await actor.supabaseAdmin
        .from('property_visit_requests')
        .select('id, request_code')
        .eq('listing_id', listingId)
        .eq('requester_id', actor.userId)
        .eq('status', 'requested')
        .maybeSingle();

      if (existingReq?.id) {
        return NextResponse.json(
          {
            error: `You already have a pending site visit request (${existingReq.request_code}) for this property.`,
          },
          { status: 409 }
        );
      }

      const requestCode = generateVisitRequestCode();

      const { data: created, error: insertErr } = await actor.supabaseAdmin
        .from('property_visit_requests')
        .insert({
          request_code: requestCode,
          hub_id: reProfile.hub_id,
          listing_id: listingId,
          requester_id: actor.userId,
          requester_name: requesterName,
          requester_phone: requesterPhone,
          preferred_date: preferredDate,
          preferred_slot: rawSlot,
          message,
          status: 'requested',
          contact_revealed: false,
        })
        .select('*')
        .single();

      if (insertErr || !created) {
        return NextResponse.json(
          {
            error:
              insertErr?.message || 'Could not create site visit request.',
          },
          { status: 500 }
        );
      }

      return NextResponse.json(
        { ok: true, visitRequest: created },
        { status: 201 }
      );
    }

    if (action === 'update_status') {
      const requestId = String(body.requestId ?? body.request_id ?? '').trim();
      const nextStatus = String(body.status ?? '')
        .trim()
        .toLowerCase() as PropertyVisitStatus;
      const ownerNote =
        typeof body.ownerNote === 'string'
          ? body.ownerNote.trim().slice(0, 500)
          : typeof body.owner_note === 'string'
            ? body.owner_note.trim().slice(0, 500)
            : undefined;

      if (!isUuid(requestId)) {
        return NextResponse.json(
          { error: 'Valid requestId is required.' },
          { status: 400 }
        );
      }

      const { data: visitRow, error: fetchErr } = await actor.supabaseAdmin
        .from('property_visit_requests')
        .select('*')
        .eq('id', requestId)
        .maybeSingle();

      if (fetchErr || !visitRow) {
        return NextResponse.json(
          { error: 'Site visit request not found.' },
          { status: 404 }
        );
      }

      await assertRealEstateModuleEnabledForHub(
        actor.supabaseAdmin,
        String(visitRow.hub_id)
      );

      const isRequester = visitRow.requester_id === actor.userId;
      const isOperator = await isRealEstateOperatorForUser(
        actor.supabaseAdmin,
        String(visitRow.listing_id),
        actor.userId,
        actor.actualRole
      );

      if (nextStatus === 'cancelled') {
        if (!isRequester && !isOperator) {
          return NextResponse.json(
            { error: 'Forbidden: Only the requester or property operator may cancel.' },
            { status: 403 }
          );
        }
      } else if (OPERATOR_STATUSES.includes(nextStatus)) {
        if (!isOperator) {
          return NextResponse.json(
            { error: 'Forbidden: Only the property owner/agent or delegated staff may update visit status.' },
            { status: 403 }
          );
        }
      } else {
        return NextResponse.json(
          { error: 'Invalid target status.' },
          { status: 400 }
        );
      }

      const updatePayload: Record<string, unknown> = {
        status: nextStatus,
        updated_at: new Date().toISOString(),
      };
      if (ownerNote !== undefined && isOperator) {
        updatePayload.owner_note = ownerNote || null;
      }
      if (nextStatus === 'accepted') {
        updatePayload.contact_revealed = true;
      }

      const { data: updated, error: updateErr } = await actor.supabaseAdmin
        .from('property_visit_requests')
        .update(updatePayload)
        .eq('id', requestId)
        .select('*')
        .single();

      if (updateErr || !updated) {
        return NextResponse.json(
          { error: updateErr?.message || 'Could not update visit request.' },
          { status: 500 }
        );
      }

      return NextResponse.json({ ok: true, visitRequest: updated });
    }

    return NextResponse.json(
      { error: 'Unsupported action. Use create or update_status.' },
      { status: 400 }
    );
  } catch (err) {
    if (err instanceof RealEstateApiError) {
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
            : 'Unexpected error processing visit request.',
      },
      { status: 500 }
    );
  }
}
