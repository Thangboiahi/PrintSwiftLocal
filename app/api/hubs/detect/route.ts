import { NextRequest, NextResponse } from 'next/server';
import { fetchVisibleServiceHubs } from '@/lib/config/server';
import {
  computeStraightLineDistanceKm,
  createServerSupabaseReadClient,
  isValidCoordinate,
} from '@/lib/pick-n-drop/fare';

/**
 * GET /api/hubs/detect?lat=...&lng=...
 * Calls the PostGIS `detect_nearest_hub(p_lat, p_lng)` RPC to determine the nearest active
 * service hub and whether the user's coordinates fall within its service radius.
 */
export async function GET(req: NextRequest) {
  try {
    const latRaw = req.nextUrl.searchParams.get('lat');
    const lngRaw = req.nextUrl.searchParams.get('lng');

    if (latRaw === null || lngRaw === null) {
      return NextResponse.json(
        { error: 'Query parameters lat and lng are required.' },
        { status: 400 }
      );
    }

    const lat = Number(latRaw);
    const lng = Number(lngRaw);

    if (!isValidCoordinate(lat, lng)) {
      return NextResponse.json(
        { error: 'Valid WGS84 lat (-90..90) and lng (-180..180) are required.' },
        { status: 400 }
      );
    }

    const supabase = createServerSupabaseReadClient();

    if (supabase) {
      const { data, error } = await supabase.rpc('detect_nearest_hub', {
        p_lat: lat,
        p_lng: lng,
      });

      if (!error && data && typeof data === 'object') {
        const result = data as {
          matched_hub?: unknown;
          nearest_hub?: unknown;
          distance_km?: number | null;
          is_within_service_area?: boolean;
        };

        return NextResponse.json(
          {
            matched_hub: result.matched_hub ?? null,
            nearest_hub: result.nearest_hub ?? null,
            distance_km:
              typeof result.distance_km === 'number'
                ? result.distance_km
                : result.distance_km != null
                  ? Number(result.distance_km)
                  : null,
            is_within_service_area: Boolean(result.is_within_service_area),
          },
          {
            status: 200,
            headers: { 'Cache-Control': 'no-store, max-age=0' },
          }
        );
      }
    }

    // Haversine fallback if PostGIS RPC is unavailable in a pre-migration environment
    const hubs = await fetchVisibleServiceHubs(supabase);
    const activeHubs = hubs.filter((h) => h.status === 'active');

    if (activeHubs.length === 0) {
      return NextResponse.json(
        {
          matched_hub: null,
          nearest_hub: null,
          distance_km: null,
          is_within_service_area: false,
        },
        { status: 200 }
      );
    }

    let nearest = activeHubs[0];
    let minDistKm = computeStraightLineDistanceKm(
      lat,
      lng,
      nearest.center_lat,
      nearest.center_lng
    );

    for (let i = 1; i < activeHubs.length; i += 1) {
      const candidate = activeHubs[i];
      const dist = computeStraightLineDistanceKm(
        lat,
        lng,
        candidate.center_lat,
        candidate.center_lng
      );
      if (dist < minDistKm) {
        minDistKm = dist;
        nearest = candidate;
      }
    }

    const roundedDist = Number(minDistKm.toFixed(2));
    const isWithin = roundedDist <= nearest.service_radius_km;

    return NextResponse.json(
      {
        matched_hub: isWithin ? nearest : null,
        nearest_hub: nearest,
        distance_km: roundedDist,
        is_within_service_area: isWithin,
      },
      {
        status: 200,
        headers: { 'Cache-Control': 'no-store, max-age=0' },
      }
    );
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : 'Failed to detect nearest service hub.',
      },
      { status: 500 }
    );
  }
}
