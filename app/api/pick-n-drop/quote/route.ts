import { NextRequest, NextResponse } from 'next/server';
import {
  ALLOWED_CONTAINER_TYPES,
  ALLOWED_SERVICE_MODES,
  ALLOWED_TRIP_TYPES,
  calculateServerFareQuote,
  createServerSupabaseReadClient,
  isContainerType,
  isServiceMode,
  isTripType,
  isValidCoordinate,
  type ContainerType,
  type ServiceMode,
} from '@/lib/pick-n-drop/fare';

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

    const pickupLat = Number(body.pickupLat);
    const pickupLng = Number(body.pickupLng);
    const dropoffLat = Number(body.dropoffLat);
    const dropoffLng = Number(body.dropoffLng);
    const vehicleTypeId = String(body.vehicleTypeId ?? '').trim();
    const tripType = body.tripType;

    const rawServiceMode = body.serviceMode ?? 'parcel';
    if (!isServiceMode(rawServiceMode)) {
      return NextResponse.json(
        {
          error: `serviceMode must be one of: ${ALLOWED_SERVICE_MODES.join(', ')}.`,
        },
        { status: 400 }
      );
    }
    const serviceMode: ServiceMode = rawServiceMode;

    if (!isValidCoordinate(pickupLat, pickupLng)) {
      return NextResponse.json(
        { error: 'Valid pickupLat and pickupLng coordinates are required.' },
        { status: 400 }
      );
    }

    if (!isValidCoordinate(dropoffLat, dropoffLng)) {
      return NextResponse.json(
        { error: 'Valid dropoffLat and dropoffLng coordinates are required.' },
        { status: 400 }
      );
    }

    if (!vehicleTypeId) {
      return NextResponse.json(
        { error: 'vehicleTypeId (UUID or slug) is required.' },
        { status: 400 }
      );
    }

    if (!isTripType(tripType)) {
      return NextResponse.json(
        {
          error: `tripType must be one of: ${ALLOWED_TRIP_TYPES.join(', ')}.`,
        },
        { status: 400 }
      );
    }

    let containerType: ContainerType | null = null;
    if (serviceMode === 'parcel') {
      const candidate = body.containerType ?? 'small_box';
      if (!isContainerType(candidate)) {
        return NextResponse.json(
          {
            error: `containerType must be one of: ${ALLOWED_CONTAINER_TYPES.join(', ')}.`,
          },
          { status: 400 }
        );
      }
      containerType = candidate;
    }

    const cylinderCountRaw = Number(body.cylinderCount ?? 1);
    const cylinderCount =
      Number.isFinite(cylinderCountRaw) && cylinderCountRaw >= 1
        ? Math.floor(cylinderCountRaw)
        : 1;

    const supabase = createServerSupabaseReadClient();
    const quote = await calculateServerFareQuote({
      supabase,
      pickupLat,
      pickupLng,
      dropoffLat,
      dropoffLng,
      vehicleTypeId,
      tripType,
      serviceMode,
      containerType,
      cylinderCount,
      allowFallbackVehicle: true,
    });

    return NextResponse.json({
      distance_km: quote.distance_km,
      one_way_fare_inr: quote.one_way_fare_inr,
      two_way_fare_inr: quote.two_way_fare_inr,
      total_fare_inr: quote.total_fare_inr,
      breakdown: quote.breakdown,
      fare_breakdown: quote.fare_breakdown,
      expires_at: quote.expires_at,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Failed to calculate delivery quote.';
    const status = /not found|inactive/i.test(message) ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
