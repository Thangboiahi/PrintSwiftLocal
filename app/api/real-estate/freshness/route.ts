import { NextRequest, NextResponse } from 'next/server';
import { isUuid } from '@/lib/payments/types';
import {
  assertRealEstateModuleEnabledForHub,
  authenticateRealEstateRequest,
  isRealEstateOperatorForUser,
  RealEstateApiError,
} from '@/lib/real-estate/server-helpers';
import type { RealEstateAvailabilityStatus } from '@/lib/real-estate/types';

const VALID_AVAILABILITY: readonly RealEstateAvailabilityStatus[] = [
  'available',
  'under_offer',
  'sold_rented',
  'paused',
];

/**
 * POST /api/real-estate/freshness
 * Strictly checks `is_real_estate_operator_for(listingId)` and calls
 * `confirm_property_freshness(listingId, availabilityStatus)` to renew
 * `freshness_expires_at` by +30 days or update availability status.
 */
export async function POST(req: NextRequest) {
  try {
    const actor = await authenticateRealEstateRequest(req);
    if (!actor) {
      return NextResponse.json(
        { error: 'Authentication required.' },
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

    const listingId = String(body.listingId ?? body.listing_id ?? '').trim();
    const availabilityStatus = String(
      body.availabilityStatus ?? body.availability_status ?? 'available'
    )
      .trim()
      .toLowerCase() as RealEstateAvailabilityStatus;

    if (!isUuid(listingId)) {
      return NextResponse.json(
        { error: 'Valid listingId is required.' },
        { status: 400 }
      );
    }

    if (!VALID_AVAILABILITY.includes(availabilityStatus)) {
      return NextResponse.json(
        {
          error:
            'availabilityStatus must be available, under_offer, sold_rented, or paused.',
        },
        { status: 400 }
      );
    }

    const isOperator = await isRealEstateOperatorForUser(
      actor.supabaseAdmin,
      listingId,
      actor.userId,
      actor.actualRole
    );
    if (!isOperator) {
      return NextResponse.json(
        {
          error:
            'Forbidden: Only the property owner, delegated staff, or super admin may confirm freshness.',
        },
        { status: 403 }
      );
    }

    const { data: reProfile } = await actor.supabaseAdmin
      .from('listing_real_estate_profiles')
      .select('listing_id, hub_id')
      .eq('listing_id', listingId)
      .maybeSingle();

    if (!reProfile) {
      return NextResponse.json(
        { error: 'Real estate profile not found for this listing.' },
        { status: 404 }
      );
    }

    await assertRealEstateModuleEnabledForHub(
      actor.supabaseAdmin,
      String(reProfile.hub_id)
    );

    const { data: updatedProfile, error: rpcErr } = await actor.supabaseAdmin.rpc(
      'confirm_property_freshness',
      {
        p_listing_id: listingId,
        p_availability_status: availabilityStatus,
      }
    );

    if (rpcErr) {
      return NextResponse.json(
        { error: rpcErr.message || 'Could not confirm property freshness.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      profile: updatedProfile,
    });
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
            : 'Unexpected error updating property freshness.',
      },
      { status: 500 }
    );
  }
}
