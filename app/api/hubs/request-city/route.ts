import { NextRequest, NextResponse } from 'next/server';
import {
  createServerSupabaseReadClient,
  extractSupabaseAccessToken,
  isValidCoordinate,
} from '@/lib/pick-n-drop/fare';

/**
 * POST /api/hubs/request-city
 * Captures out-of-area regional expansion demand into `public.hub_requests`.
 * Works for both anonymous visitors and authenticated users (attaching `user_id` when signed in).
 */
export async function POST(req: NextRequest) {
  try {
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

    const requestedCity = String(body.requested_city ?? body.requestedCity ?? '')
      .trim()
      .slice(0, 120);

    if (requestedCity.length < 2) {
      return NextResponse.json(
        { error: 'Please provide a valid city or town name.' },
        { status: 400 }
      );
    }

    const state =
      String(body.state ?? '')
        .trim()
        .slice(0, 80) || null;
    const contactInfo =
      String(body.contact_info ?? body.contactInfo ?? '')
        .trim()
        .slice(0, 160) || null;
    const notes =
      String(body.notes ?? '')
        .trim()
        .slice(0, 500) || null;

    let lat: number | null = null;
    let lng: number | null = null;
    if (body.lat !== undefined && body.lat !== null && body.lat !== '') {
      const parsedLat = Number(body.lat);
      const parsedLng = Number(body.lng);
      if (!isValidCoordinate(parsedLat, parsedLng)) {
        return NextResponse.json(
          { error: 'Provided lat/lng coordinates are out of valid WGS84 range.' },
          { status: 400 }
        );
      }
      lat = parsedLat;
      lng = parsedLng;
    }

    const supabase = createServerSupabaseReadClient();
    if (!supabase) {
      return NextResponse.json(
        { error: 'Database client is not configured on the server.' },
        { status: 503 }
      );
    }

    let userId: string | null = null;
    const token = extractSupabaseAccessToken(req);
    if (token) {
      try {
        const { data } = await supabase.auth.getUser(token);
        if (data?.user?.id) {
          userId = data.user.id;
        }
      } catch {
        // Proceed anonymously if token verification fails
      }
    }

    const { data: inserted, error: insertError } = await supabase
      .from('hub_requests')
      .insert({
        requested_city: requestedCity,
        state,
        lat,
        lng,
        user_id: userId,
        contact_info: contactInfo,
        notes,
      })
      .select('id, requested_city, created_at')
      .single();

    if (insertError) {
      return NextResponse.json(
        {
          error:
            insertError.message || 'Unable to submit city expansion request.',
        },
        { status: 500 }
      );
    }

    return NextResponse.json(
      {
        success: true,
        request: inserted,
      },
      { status: 201 }
    );
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : 'Failed to submit city expansion request.',
      },
      { status: 500 }
    );
  }
}
