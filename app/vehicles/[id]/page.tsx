import Link from 'next/link';
import { createClient } from '@supabase/supabase-js';
import { ArrowLeft, Car } from 'lucide-react';
import {
  VehicleDetailClient,
  type VehicleBookedWindow,
  type VehicleDetailOwnerMeta,
} from '@/components/vehicles/VehicleDetailClient';
import {
  isUuid,
  type VehicleAvailabilityBlockRecord,
  type VehicleFixedRoute,
  type VehicleListingRecord,
} from '@/lib/payments/types';

export const dynamic = 'force-dynamic';

interface VehiclePageProps {
  params: Promise<{ id: string }>;
}

function getServerSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key =
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export default async function VehicleDetailPage({ params }: VehiclePageProps) {
  const { id } = await params;

  if (!isUuid(id)) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center bg-[var(--ps-bg)] text-[var(--ps-text)] px-4 text-center space-y-3">
        <Car className="h-10 w-10 text-[var(--ps-text-muted)]" />
        <h1 className="text-lg font-bold">Vehicle Listing Not Found</h1>
        <p className="text-xs text-[var(--ps-text-muted)] max-w-sm">
          This vehicle listing ID is invalid or no longer available.
        </p>
        <Link
          href="/explore"
          className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-4 text-xs font-bold text-[var(--ps-accent-fg)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to Explore</span>
        </Link>
      </div>
    );
  }

  const db = getServerSupabase();
  if (!db) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center bg-[var(--ps-bg)] text-[var(--ps-text)] px-4 text-center space-y-3">
        <Car className="h-10 w-10 text-[var(--ps-text-muted)]" />
        <h1 className="text-lg font-bold">Service Unavailable</h1>
        <p className="text-xs text-[var(--ps-text-muted)]">
          Unable to connect to vehicle inventory right now.
        </p>
      </div>
    );
  }

  const nowIso = new Date().toISOString();

  let { data: rawVehicle, error: rawVehErr } = await db
    .from('vehicle_listings')
    .select(
      'id, vehicle_id, owner_id, driver_id, vehicle_type_id, origin_hub_id, destination_hub_ids, category_id, locality_id, custom_tags, title, description, stand_locality, lat, lng, booking_mode, total_seats, pricing_model, rate_hourly_inr, rate_daily_inr, rate_per_km_inr, fixed_routes, advance_percent, with_driver, features, thumbnail_url, image_urls, panorama_url, is_active, is_verified, created_at, updated_at'
    )
    .eq('id', id)
    .maybeSingle();

  if (
    rawVehErr &&
    /(origin_hub_id|destination_hub_ids|category_id|locality_id|custom_tags)/i.test(
      rawVehErr.message || ''
    )
  ) {
    const retry = await db
      .from('vehicle_listings')
      .select(
        'id, vehicle_id, owner_id, driver_id, vehicle_type_id, title, description, stand_locality, lat, lng, booking_mode, total_seats, pricing_model, rate_hourly_inr, rate_daily_inr, rate_per_km_inr, fixed_routes, advance_percent, with_driver, features, thumbnail_url, image_urls, panorama_url, is_active, is_verified, created_at, updated_at'
      )
      .eq('id', id)
      .maybeSingle();
    rawVehicle = retry.data as typeof rawVehicle;
  }

  if (!rawVehicle) {
    return (
      <div className="min-h-dvh flex flex-col items-center justify-center bg-[var(--ps-bg)] text-[var(--ps-text)] px-4 text-center space-y-3">
        <Car className="h-10 w-10 text-[var(--ps-text-muted)]" />
        <h1 className="text-lg font-bold">Vehicle Listing Unavailable</h1>
        <p className="text-xs text-[var(--ps-text-muted)] max-w-sm">
          This vehicle may have been paused by its owner or removed from the stand.
        </p>
        <Link
          href="/explore"
          className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-4 text-xs font-bold text-[var(--ps-accent-fg)]"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Browse All Listings</span>
        </Link>
      </div>
    );
  }

  const [vTypeRes, ownerRes, driverRes, blocksRes, bookingsRes] =
    await Promise.all([
      rawVehicle.vehicle_type_id
        ? db
            .from('vehicle_types')
            .select('name, slug')
            .eq('id', rawVehicle.vehicle_type_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      rawVehicle.owner_id
        ? db
            .from('profiles')
            .select('full_name, name, phone')
            .eq('id', rawVehicle.owner_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      rawVehicle.driver_id
        ? db
            .from('drivers')
            .select('full_name, phone')
            .eq('id', rawVehicle.driver_id)
            .maybeSingle()
        : Promise.resolve({ data: null }),
      db
        .from('vehicle_availability_blocks')
        .select(
          'id, vehicle_listing_id, start_time, end_time, reason, notes, created_by, created_at'
        )
        .eq('vehicle_listing_id', rawVehicle.id)
        .gte('end_time', nowIso)
        .order('start_time', { ascending: true }),
      db
        .from('vehicle_bookings')
        .select('id, start_time, end_time, booking_mode, seats_booked, status')
        .eq('vehicle_listing_id', rawVehicle.id)
        .in('status', [
          'soft_hold',
          'pending_payment_confirm',
          'confirmed',
          'in_progress',
        ])
        .gte('end_time', nowIso)
        .order('start_time', { ascending: true }),
    ]);

  const vehicle: VehicleListingRecord = {
    ...(rawVehicle as unknown as VehicleListingRecord),
    lat: Number(rawVehicle.lat || 24.333),
    lng: Number(rawVehicle.lng || 93.699),
    total_seats: Number(rawVehicle.total_seats || 4),
    advance_percent: Number(rawVehicle.advance_percent || 20),
    rate_hourly_inr:
      rawVehicle.rate_hourly_inr != null
        ? Number(rawVehicle.rate_hourly_inr)
        : null,
    rate_daily_inr:
      rawVehicle.rate_daily_inr != null
        ? Number(rawVehicle.rate_daily_inr)
        : null,
    rate_per_km_inr:
      rawVehicle.rate_per_km_inr != null
        ? Number(rawVehicle.rate_per_km_inr)
        : null,
    fixed_routes: Array.isArray(rawVehicle.fixed_routes)
      ? (rawVehicle.fixed_routes as VehicleFixedRoute[])
      : [],
    features: Array.isArray(rawVehicle.features)
      ? (rawVehicle.features as string[])
      : [],
    image_urls: Array.isArray(rawVehicle.image_urls)
      ? (rawVehicle.image_urls as string[])
      : [],
  };

  const ownerRow = ownerRes.data as {
    full_name?: string | null;
    name?: string | null;
    phone?: string | null;
  } | null;
  const driverRow = driverRes.data as {
    full_name?: string | null;
    phone?: string | null;
  } | null;
  const vTypeRow = vTypeRes.data as {
    name?: string | null;
    slug?: string | null;
  } | null;

  const meta: VehicleDetailOwnerMeta = {
    ownerName:
      ownerRow?.full_name || ownerRow?.name || 'Verified Lamka Operator',
    driverName: driverRow?.full_name || null,
    phone: driverRow?.phone || ownerRow?.phone || null,
    vehicleTypeName: vTypeRow?.name || 'Charter Vehicle',
    vehicleTypeSlug: vTypeRow?.slug || null,
  };

  return (
    <VehicleDetailClient
      vehicle={vehicle}
      meta={meta}
      initialBlocks={
        (blocksRes.data || []) as VehicleAvailabilityBlockRecord[]
      }
      initialBookedWindows={
        (bookingsRes.data || []) as VehicleBookedWindow[]
      }
    />
  );
}
