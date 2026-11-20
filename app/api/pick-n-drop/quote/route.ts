import { NextRequest, NextResponse } from 'next/server';
import {
  fetchServerQuoteConfig,
  resolveServiceHubByIdOrDefault,
} from '@/lib/config/server';
import {
  ALLOWED_CONTAINER_TYPES,
  ALLOWED_SERVICE_MODES,
  ALLOWED_TRIP_TYPES,
  calculateServerFareQuote,
  computeStraightLineDistanceKm,
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
    const requestedHub = String(
      body.hubId ?? body.hub_id ?? body.hubSlug ?? body.hub ?? ''
    ).trim();

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
    const [{ pricing_surcharges }, activeHub] = await Promise.all([
      fetchServerQuoteConfig(supabase),
      resolveServiceHubByIdOrDefault(supabase, requestedHub || null),
    ]);

    // Enforce active hub's geofence service radius around (hub.center_lat, hub.center_lng)
    const { center_lat, center_lng, service_radius_km } = activeHub;
    if (
      Number.isFinite(service_radius_km) &&
      service_radius_km > 0 &&
      isValidCoordinate(center_lat, center_lng)
    ) {
      const pickupDistanceFromCenter = computeStraightLineDistanceKm(
        center_lat,
        center_lng,
        pickupLat,
        pickupLng
      );
      const dropoffDistanceFromCenter = computeStraightLineDistanceKm(
        center_lat,
        center_lng,
        dropoffLat,
        dropoffLng
      );

      if (
        pickupDistanceFromCenter > service_radius_km ||
        dropoffDistanceFromCenter > service_radius_km
      ) {
        return NextResponse.json(
          {
            error: 'Selected points are outside the active hub service area.',
            hub_id: activeHub.id,
            hub_name: activeHub.name,
            service_radius_km,
            pickup_distance_km: Number(pickupDistanceFromCenter.toFixed(1)),
            dropoff_distance_km: Number(dropoffDistanceFromCenter.toFixed(1)),
          },
          { status: 400 }
        );
      }
    }

    const quote = await calculateServerFareQuote({
      supabase,
      hubId: activeHub.id,
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
      surcharges: {
        fragile_crate_inr: pricing_surcharges.fragile_crate_inr,
        bulk_sack_inr: pricing_surcharges.bulk_sack_inr,
        extra_cylinder_inr: pricing_surcharges.extra_cylinder_inr,
      },
    });

    return NextResponse.json({
      hub_id: activeHub.id,
      hub_slug: activeHub.slug,
      hub_name: activeHub.name,
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
    const status = /not enabled/i.test(message)
      ? 400
      : /not found|inactive/i.test(message)
        ? 404
        : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
