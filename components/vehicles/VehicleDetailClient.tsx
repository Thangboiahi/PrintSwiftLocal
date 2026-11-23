'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { motion } from 'motion/react';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  BedDouble,
  Bookmark,
  Calendar,
  Car,
  CheckCircle2,
  Clock,
  Compass,
  Info,
  Loader2,
  MapPin,
  MessageCircle,
  Minus,
  Navigation,
  Plus,
  Route,
  Share2,
  ShieldCheck,
  Sparkles,
  Star,
  UserCheck,
  UserPlus,
  Users,
} from 'lucide-react';
import { Breadcrumbs } from '@/components/navigation/Breadcrumbs';
import { CrossHubBanner } from '@/components/hub/CrossHubBanner';
import { UniversalPaymentModal } from '@/components/payments/UniversalPaymentModal';
import { useAppConfig } from '@/components/providers/AppConfigProvider';
import { ModulePausedGuard } from '@/components/shared/ModulePausedGuard';
import { PanoramaViewer360 } from '@/components/real-estate/PanoramaViewer360';
import {
  CustomSelectModal,
  type CustomSelectOption,
} from '@/components/ui/CustomSelectModal';
import { useShare } from '@/components/ui/ShareSheetModal';
import { setAppStatus } from '@/lib/hooks/useAppStatus';
import { useSavedInterests } from '@/lib/hooks/useSavedInterests';
import type {
  PaymentIntentRecord,
  VehicleAvailabilityBlockRecord,
  VehicleBookingRecord,
  VehicleFixedRoute,
  VehicleListingRecord,
} from '@/lib/payments/types';
import { useAuth } from '@/lib/store';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { resolveRemoteMediaUrl } from '@/lib/supabase/storage';
import type { PanoramaScene } from '@/lib/types';
import { buildContextualWhatsAppUrl } from '@/lib/utils/whatsapp';

export interface VehicleBookedWindow {
  id: string;
  start_time: string;
  end_time: string;
  booking_mode: 'full_vehicle' | 'per_seat';
  seats_booked: number;
  status: string;
}

export interface VehicleDetailOwnerMeta {
  ownerName: string;
  driverName: string | null;
  phone: string | null;
  vehicleTypeName: string;
  vehicleTypeSlug: string | null;
}

interface VehicleReviewItem {
  id: string;
  authorName: string;
  rating: number;
  comment: string;
  createdAt: string;
}

interface VehicleDetailClientProps {
  vehicle: VehicleListingRecord;
  meta: VehicleDetailOwnerMeta;
  initialBlocks: VehicleAvailabilityBlockRecord[];
  initialBookedWindows: VehicleBookedWindow[];
}

function toLocalDateTimeInputValue(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(
    date.getHours()
  )}:${pad(date.getMinutes())}`;
}

function formatDateRangeShort(startIso: string, endIso: string): string {
  const start = new Date(startIso);
  const end = new Date(endIso);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return `${startIso} – ${endIso}`;
  }
  const sameDay =
    start.getFullYear() === end.getFullYear() &&
    start.getMonth() === end.getMonth() &&
    start.getDate() === end.getDate();

  const dateOpts: Intl.DateTimeFormatOptions = {
    day: 'numeric',
    month: 'short',
  };
  const timeOpts: Intl.DateTimeFormatOptions = {
    hour: '2-digit',
    minute: '2-digit',
  };

  if (sameDay) {
    return `${start.toLocaleDateString('en-IN', dateOpts)} · ${start.toLocaleTimeString(
      'en-IN',
      timeOpts
    )} – ${end.toLocaleTimeString('en-IN', timeOpts)}`;
  }
  return `${start.toLocaleDateString('en-IN', dateOpts)} ${start.toLocaleTimeString(
    'en-IN',
    timeOpts
  )} → ${end.toLocaleDateString('en-IN', dateOpts)} ${end.toLocaleTimeString(
    'en-IN',
    timeOpts
  )}`;
}

export function VehicleDetailClient({
  vehicle,
  meta,
  initialBlocks,
  initialBookedWindows,
}: VehicleDetailClientProps) {
  const { user: authUser, fullName: authFullName } = useAuth();
  const { hubs, activeHub, office, supportWhatsApp } = useAppConfig();
  const { isSaved, toggleSave, isFollowing, toggleFollow } = useSavedInterests();
  const saved = isSaved('vehicle', vehicle.id);
  const followingOwner =
    Boolean(vehicle.owner_id) && isFollowing('author', vehicle.owner_id);

  const interHubRouteLabel = useMemo(() => {
    const destIds = Array.isArray(vehicle.destination_hub_ids)
      ? vehicle.destination_hub_ids.filter(Boolean)
      : [];
    if (destIds.length === 0) return null;
    const originName =
      hubs.find((h) => h.id === vehicle.origin_hub_id)?.name ||
      activeHub?.name ||
      'Churachandpur';
    const destNames = destIds
      .map((did) => hubs.find((h) => h.id === did)?.name)
      .filter((name): name is string => Boolean(name && name !== originName));
    if (destNames.length === 0) return null;
    return `${originName} ↔ ${destNames.join(' / ')}`;
  }, [vehicle.origin_hub_id, vehicle.destination_hub_ids, hubs, activeHub?.name]);

  // Media gallery state
  const galleryImages = useMemo(() => {
    const raw: string[] = [];
    if (vehicle.thumbnail_url) raw.push(vehicle.thumbnail_url);
    if (Array.isArray(vehicle.image_urls)) {
      for (const u of vehicle.image_urls) {
        if (u && !raw.includes(u)) raw.push(u);
      }
    }
    return raw
      .map((u) => resolveRemoteMediaUrl(u))
      .filter((u): u is string => Boolean(u));
  }, [vehicle.thumbnail_url, vehicle.image_urls]);

  const [activeImgIdx, setActiveImgIdx] = useState<number>(0);
  const [showPanorama, setShowPanorama] = useState<boolean>(false);

  const panoramaScenes = useMemo<PanoramaScene[]>(() => {
    const panoUrl = resolveRemoteMediaUrl(vehicle.panorama_url);
    if (!panoUrl) return [];
    return [
      {
        id: `veh-pano-${vehicle.id}`,
        name: `${vehicle.title} — 360° Interior`,
        imageUrl: panoUrl,
        width: 4096,
        height: 2048,
        order: 0,
        isPrimary: true,
        isEquirectangular: true,
        isSyntheticDemo: false,
        initialYaw: 0,
        initialPitch: 0,
      },
    ];
  }, [vehicle.id, vehicle.panorama_url, vehicle.title]);

  // Schedule & availability windows (live refreshable)
  const [blocks, setBlocks] =
    useState<VehicleAvailabilityBlockRecord[]>(initialBlocks);
  const [bookedWindows, setBookedWindows] =
    useState<VehicleBookedWindow[]>(initialBookedWindows);

  const refreshAvailability = useCallback(async () => {
    if (!isSupabaseConfigured()) return;
    try {
      const nowIso = new Date().toISOString();
      const [blocksRes, bookingsRes] = await Promise.all([
        supabase
          .from('vehicle_availability_blocks')
          .select(
            'id, vehicle_listing_id, start_time, end_time, reason, notes, created_by, created_at'
          )
          .eq('vehicle_listing_id', vehicle.id)
          .gte('end_time', nowIso)
          .order('start_time', { ascending: true }),
        supabase
          .from('vehicle_bookings')
          .select('id, start_time, end_time, booking_mode, seats_booked, status')
          .eq('vehicle_listing_id', vehicle.id)
          .in('status', [
            'soft_hold',
            'pending_payment_confirm',
            'confirmed',
            'in_progress',
          ])
          .gte('end_time', nowIso)
          .order('start_time', { ascending: true }),
      ]);

      if (blocksRes.data) {
        setBlocks(blocksRes.data as VehicleAvailabilityBlockRecord[]);
      }
      if (bookingsRes.data) {
        setBookedWindows(bookingsRes.data as VehicleBookedWindow[]);
      }
    } catch {
      // Keep initial SSR data
    }
  }, [vehicle.id]);

  // Booking form state
  const allowedFull =
    vehicle.booking_mode === 'full_vehicle' || vehicle.booking_mode === 'both';
  const allowedSeat =
    vehicle.booking_mode === 'per_seat' || vehicle.booking_mode === 'both';

  const [bookingMode, setBookingMode] = useState<'full_vehicle' | 'per_seat'>(
    vehicle.booking_mode === 'per_seat' ? 'per_seat' : 'full_vehicle'
  );
  const [seatsBooked, setSeatsBooked] = useState<number>(
    vehicle.booking_mode === 'per_seat' ? 1 : Math.max(1, vehicle.total_seats || 4)
  );

  // Build pricing / route options dynamically from vehicle's rates and fixed_routes
  const pricingOptions = useMemo<
    Array<{
      value: string;
      label: string;
      description: string;
      kind: 'fixed_route' | 'daily' | 'hourly' | 'per_km';
      route?: VehicleFixedRoute;
    }>
  >(() => {
    const list: Array<{
      value: string;
      label: string;
      description: string;
      kind: 'fixed_route' | 'daily' | 'hourly' | 'per_km';
      route?: VehicleFixedRoute;
    }> = [];

    const fixedRoutes = Array.isArray(vehicle.fixed_routes)
      ? vehicle.fixed_routes
      : [];
    fixedRoutes.forEach((route, idx) => {
      const seatFare = Number(route.fare_inr || 0);
      const fullFare = Number(
        route.full_vehicle_fare_inr || seatFare * Math.max(1, vehicle.total_seats || 4)
      );
      list.push({
        value: `route:${idx}`,
        label: `${route.origin} → ${route.destination}`,
        description: `Seat ₹${seatFare} · Full ₹${fullFare}${
          route.duration_label ? ` · ${route.duration_label}` : ''
        }`,
        kind: 'fixed_route',
        route,
      });
    });

    if (Number(vehicle.rate_daily_inr || 0) > 0) {
      list.push({
        value: 'rate:daily',
        label: `Daily Charter — ₹${Number(vehicle.rate_daily_inr)} / day`,
        description: 'Multi-hour or multi-day local & highway hire',
        kind: 'daily',
      });
    }

    if (Number(vehicle.rate_hourly_inr || 0) > 0) {
      list.push({
        value: 'rate:hourly',
        label: `Hourly Charter — ₹${Number(vehicle.rate_hourly_inr)} / hr`,
        description: 'Billed cleanly by selected booking duration',
        kind: 'hourly',
      });
    }

    if (Number(vehicle.rate_per_km_inr || 0) > 0) {
      list.push({
        value: 'rate:per_km',
        label: `Per-Km Distance Hire — ₹${Number(vehicle.rate_per_km_inr)} / km`,
        description: 'Estimated total based on expected trip distance',
        kind: 'per_km',
      });
    }

    if (list.length === 0) {
      list.push({
        value: 'rate:daily',
        label: 'Standard Local Charter — ₹2,500 / day',
        description: 'Default Churachandpur charter estimate',
        kind: 'daily',
      });
    }

    return list;
  }, [
    vehicle.fixed_routes,
    vehicle.rate_daily_inr,
    vehicle.rate_hourly_inr,
    vehicle.rate_per_km_inr,
    vehicle.total_seats,
  ]);

  const defaultOptionValue = useMemo(() => {
    if (
      vehicle.pricing_model === 'fixed_route' &&
      pricingOptions.some((o) => o.kind === 'fixed_route')
    ) {
      return pricingOptions.find((o) => o.kind === 'fixed_route')!.value;
    }
    if (
      vehicle.pricing_model === 'hourly' &&
      pricingOptions.some((o) => o.kind === 'hourly')
    ) {
      return 'rate:hourly';
    }
    if (
      vehicle.pricing_model === 'per_km' &&
      pricingOptions.some((o) => o.kind === 'per_km')
    ) {
      return 'rate:per_km';
    }
    if (
      vehicle.pricing_model === 'daily' &&
      pricingOptions.some((o) => o.kind === 'daily')
    ) {
      return 'rate:daily';
    }
    return pricingOptions[0]?.value || 'rate:daily';
  }, [vehicle.pricing_model, pricingOptions]);

  const [selectedPricingKey, setSelectedPricingKey] =
    useState<string>(defaultOptionValue);
  const [estimatedKm, setEstimatedKm] = useState<number>(65);

  const [startLocal, setStartLocal] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(9, 0, 0, 0);
    return toLocalDateTimeInputValue(d);
  });
  const [endLocal, setEndLocal] = useState<string>(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    d.setHours(17, 0, 0, 0);
    return toLocalDateTimeInputValue(d);
  });

  const [pickupLocation, setPickupLocation] = useState<string>(
    vehicle.stand_locality || 'Central Lamka'
  );
  const [dropoffLocation, setDropoffLocation] = useState<string>('');
  const [instructions, setInstructions] = useState<string>('');

  const selectedPricingOption = useMemo(
    () =>
      pricingOptions.find((o) => o.value === selectedPricingKey) ||
      pricingOptions[0],
    [pricingOptions, selectedPricingKey]
  );

  const handleSelectPricingKey = useCallback(
    (nextKey: string) => {
      setSelectedPricingKey(nextKey);
      const matched = pricingOptions.find((o) => o.value === nextKey);
      if (matched?.kind === 'fixed_route' && matched.route) {
        setPickupLocation(matched.route.origin);
        setDropoffLocation(matched.route.destination);
      }
    },
    [pricingOptions]
  );

  // Live fare computation
  const fareBreakdown = useMemo(() => {
    const startMs = new Date(startLocal).getTime();
    const endMs = new Date(endLocal).getTime();
    const validWindow = !Number.isNaN(startMs) && !Number.isNaN(endMs) && endMs > startMs;
    const durationHours = validWindow
      ? Math.max(1, Math.ceil((endMs - startMs) / 3600000))
      : 4;
    const durationDays = validWindow
      ? Math.max(1, Math.ceil((endMs - startMs) / 86400000))
      : 1;

    let totalFare = 0;
    const effectiveSeats =
      bookingMode === 'per_seat'
        ? Math.max(1, Math.min(vehicle.total_seats || 4, seatsBooked))
        : Math.max(1, vehicle.total_seats || 4);

    if (selectedPricingOption?.kind === 'fixed_route' && selectedPricingOption.route) {
      const r = selectedPricingOption.route;
      if (bookingMode === 'per_seat') {
        totalFare = Math.round(Number(r.fare_inr || 0) * effectiveSeats);
      } else {
        totalFare = Math.round(
          Number(
            r.full_vehicle_fare_inr ||
              Number(r.fare_inr || 0) * Math.max(1, vehicle.total_seats || 4)
          )
        );
      }
    } else if (selectedPricingOption?.kind === 'hourly') {
      const base = Math.round(Number(vehicle.rate_hourly_inr || 350) * durationHours);
      totalFare =
        bookingMode === 'per_seat'
          ? Math.max(100, Math.round((base / Math.max(1, vehicle.total_seats || 4)) * effectiveSeats))
          : base;
    } else if (selectedPricingOption?.kind === 'per_km') {
      const km = Math.max(5, Number(estimatedKm) || 20);
      const base = Math.round(Number(vehicle.rate_per_km_inr || 18) * km);
      totalFare =
        bookingMode === 'per_seat'
          ? Math.max(100, Math.round((base / Math.max(1, vehicle.total_seats || 4)) * effectiveSeats))
          : base;
    } else {
      const dailyRate = Number(vehicle.rate_daily_inr || 2500);
      const base = Math.round(dailyRate * durationDays);
      totalFare =
        bookingMode === 'per_seat'
          ? Math.max(150, Math.round((base / Math.max(1, vehicle.total_seats || 4)) * effectiveSeats))
          : base;
    }

    const advancePct = Math.max(5, Math.min(100, Number(vehicle.advance_percent || 20)));
    const advanceAmount = Math.max(1, Math.round((totalFare * advancePct) / 100));
    const balanceDue = Math.max(0, totalFare - advanceAmount);

    return {
      validWindow,
      durationHours,
      durationDays,
      totalFare,
      advancePct,
      advanceAmount,
      balanceDue,
    };
  }, [
    startLocal,
    endLocal,
    bookingMode,
    seatsBooked,
    selectedPricingOption,
    estimatedKm,
    vehicle.total_seats,
    vehicle.rate_hourly_inr,
    vehicle.rate_per_km_inr,
    vehicle.rate_daily_inr,
    vehicle.advance_percent,
  ]);

  // Client-side overlap check against blocks and existing bookings
  const overlapConflict = useMemo(() => {
    const s = new Date(startLocal).getTime();
    const e = new Date(endLocal).getTime();
    if (Number.isNaN(s) || Number.isNaN(e) || e <= s) return null;

    for (const blk of blocks) {
      const bs = new Date(blk.start_time).getTime();
      const be = new Date(blk.end_time).getTime();
      if (s < be && e > bs) {
        return `Selected time overlaps a driver block (${formatDateRangeShort(
          blk.start_time,
          blk.end_time
        )}).`;
      }
    }

    let overlappingSeats = 0;
    for (const win of bookedWindows) {
      const ws = new Date(win.start_time).getTime();
      const we = new Date(win.end_time).getTime();
      if (s < we && e > ws) {
        if (bookingMode === 'full_vehicle' || win.booking_mode === 'full_vehicle') {
          return `Vehicle is already reserved during ${formatDateRangeShort(
            win.start_time,
            win.end_time
          )}.`;
        }
        overlappingSeats += Number(win.seats_booked || 1);
      }
    }

    if (
      bookingMode === 'per_seat' &&
      overlappingSeats + seatsBooked > Math.max(1, vehicle.total_seats || 4)
    ) {
      const left = Math.max(
        0,
        Math.max(1, vehicle.total_seats || 4) - overlappingSeats
      );
      return `Only ${left} seat(s) left in this time window.`;
    }

    return null;
  }, [
    startLocal,
    endLocal,
    blocks,
    bookedWindows,
    bookingMode,
    seatsBooked,
    vehicle.total_seats,
  ]);

  // Payment modal & reservation state
  const [isReserving, setIsReserving] = useState<boolean>(false);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [createdBooking, setCreatedBooking] = useState<VehicleBookingRecord | null>(
    null
  );
  const [activeIntent, setActiveIntent] = useState<PaymentIntentRecord | null>(
    null
  );
  const [upiDetails, setUpiDetails] = useState<{
    upiId: string;
    upiPayeeName: string;
  }>({
    upiId: 'ddoodle.escrow@upi',
    upiPayeeName: 'DD oodle Escrow',
  });
  const [paymentModalOpen, setPaymentModalOpen] = useState<boolean>(false);

  const handleReserveAndPay = async (e: React.FormEvent) => {
    e.preventDefault();
    setBookingError(null);

    if (!authUser) {
      setBookingError('Please sign in to reserve this vehicle and lock your slot.');
      return;
    }
    if (!fareBreakdown.validWindow) {
      setBookingError('End date/time must be after start date/time.');
      return;
    }
    if (overlapConflict) {
      setBookingError(overlapConflict);
      return;
    }
    if (!pickupLocation.trim()) {
      setBookingError('Please enter a pickup location.');
      return;
    }

    setIsReserving(true);
    setAppStatus('saving', 'Locking vehicle slot…');

    try {
      const startIso = new Date(startLocal).toISOString();
      const endIso = new Date(endLocal).toISOString();

      const { data: rpcData, error: rpcErr } = await supabase.rpc(
        'create_vehicle_booking_with_intent',
        {
          p_vehicle_listing_id: vehicle.id,
          p_booking_mode: bookingMode,
          p_seats_booked:
            bookingMode === 'per_seat'
              ? seatsBooked
              : Math.max(1, vehicle.total_seats || 4),
          p_start_time: startIso,
          p_end_time: endIso,
          p_pickup_location: pickupLocation.trim(),
          p_dropoff_location: dropoffLocation.trim() || null,
          p_instructions: instructions.trim() || null,
          p_total_fare_inr: fareBreakdown.totalFare,
        }
      );

      if (rpcErr) {
        throw new Error(rpcErr.message || 'Could not reserve this time slot.');
      }

      const payload = (rpcData || {}) as {
        booking?: VehicleBookingRecord;
        payment_intent?: PaymentIntentRecord;
      };

      if (!payload.booking || !payload.payment_intent) {
        throw new Error('Booking reservation returned an incomplete response.');
      }

      setCreatedBooking(payload.booking);
      let resolvedIntent: PaymentIntentRecord = payload.payment_intent;

      // Fetch canonical platform UPI details from /api/payments/create-intent
      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();
        if (session?.access_token) {
          const bookingHubId =
            vehicle.origin_hub_id ||
            (activeHub?.id && !activeHub.id.startsWith('fallback-')
              ? activeHub.id
              : undefined);
          const res = await fetch('/api/payments/create-intent', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${session.access_token}`,
            },
            body: JSON.stringify({
              purpose: 'vehicle_booking',
              referenceId: payload.booking.id,
              hubId: bookingHubId,
            }),
          });
          if (res.ok) {
            const json = (await res.json()) as {
              intent?: PaymentIntentRecord;
              upi_id?: string;
              upi_payee_name?: string;
            };
            if (json.intent) resolvedIntent = json.intent;
            if (json.upi_id || json.upi_payee_name) {
              setUpiDetails({
                upiId: json.upi_id || 'ddoodle.escrow@upi',
                upiPayeeName: json.upi_payee_name || 'DD oodle Escrow',
              });
            }
          }
        }
      } catch {
        // Fallback to default UPI details already initialized
      }

      setActiveIntent(resolvedIntent);
      setPaymentModalOpen(true);
      setAppStatus('success', 'Slot held for 20 minutes — pay advance via UPI');
      void refreshAvailability();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Unable to lock vehicle slot.';
      setBookingError(msg);
      setAppStatus('error', 'Reservation failed');
    } finally {
      setIsReserving(false);
    }
  };

  // Customer Reviews (local persistence keyed by vehicle ID so riders can review cleanly)
  const [reviews, setReviews] = useState<VehicleReviewItem[]>([
    {
      id: 'seed-rev-1',
      authorName: 'Lianthang H.',
      rating: 5,
      comment:
        'Clean cabin, punctual pickup at Lamka stand, and smooth ride on the Imphal highway.',
      createdAt: '2 days ago',
    },
  ]);
  const [reviewRating, setReviewRating] = useState<number>(5);
  const [reviewText, setReviewText] = useState<string>('');
  const [reviewSubmitted, setReviewSubmitted] = useState<boolean>(false);

  const handleAddReview = (e: React.FormEvent) => {
    e.preventDefault();
    const clean = reviewText.trim();
    if (!clean) return;
    setReviews((prev) => [
      {
        id: `rev-${Date.now()}`,
        authorName: authFullName || authUser?.email?.split('@')[0] || 'Local Rider',
        rating: reviewRating,
        comment: clean,
        createdAt: 'Just now',
      },
      ...prev,
    ]);
    setReviewText('');
    setReviewSubmitted(true);
    setAppStatus('success', 'Review added');
  };

  const { share } = useShare();

  const whatsappHref = useMemo(() => {
    const cleanPhone = meta.phone || supportWhatsApp || office.whatsapp || '';
    const vehicleUrl =
      typeof window !== 'undefined'
        ? `${window.location.origin}/vehicles/${encodeURIComponent(vehicle.id)}`
        : null;
    return buildContextualWhatsAppUrl(cleanPhone, {
      type: 'listing_enquiry',
      listingTitle: vehicle.title,
      locality: vehicle.stand_locality,
      hub: activeHub?.name || null,
      url: vehicleUrl,
      customNote: 'I am inquiring about vehicle availability and booking.',
    });
  }, [
    meta.phone,
    supportWhatsApp,
    office.whatsapp,
    vehicle.id,
    vehicle.title,
    vehicle.stand_locality,
    activeHub?.name,
  ]);

  const selectModalOptions: CustomSelectOption[] = useMemo(
    () =>
      pricingOptions.map((o) => ({
        value: o.value,
        label: o.label,
        description: o.description,
      })),
    [pricingOptions]
  );

  const displayTitle = vehicle.title.replace(/^\[SAMPLE\]\s*/i, '');

  return (
    <div className="min-h-dvh bg-[var(--ps-bg)] text-[var(--ps-text)] pb-24 md:pb-12">
      <div className="mx-auto max-w-6xl px-3 sm:px-5 pt-2 space-y-4">
        {/* Compact Sticky Sub-Navigation Pill */}
        <div className="sticky top-[var(--header-visible-height,56px)] z-[40] pointer-events-none pt-1 pb-1 flex flex-wrap items-center justify-between gap-2 transition-[top] duration-300 ease-out">
          <div className="pointer-events-auto inline-flex w-fit max-w-full flex-wrap items-center gap-2 rounded-2xl border border-[var(--ps-border)]/85 bg-[var(--ps-surface)]/92 px-2.5 py-1.5 shadow-sm backdrop-blur-md">
            <Link
              href="/vehicles"
              className="inline-flex h-7 items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors shrink-0"
            >
              <ArrowLeft className="h-3.5 w-3.5 text-theme-primary" />
              <span>Vehicles</span>
            </Link>
            <div className="hidden sm:block min-w-0">
              <Breadcrumbs
                items={[
                  { label: 'Explore', href: '/explore' },
                  {
                    label: 'Vehicles & Rentals',
                    href: '/vehicles',
                  },
                  { label: displayTitle },
                ]}
              />
            </div>
          </div>

          <div className="pointer-events-auto inline-flex w-fit max-w-full flex-wrap items-center gap-1.5 rounded-2xl border border-[var(--ps-border)]/85 bg-[var(--ps-surface)]/92 px-2 py-1 shadow-sm backdrop-blur-md">
            <Link
              href={`/explore?category=vehicles_rentals&focusLat=${encodeURIComponent(
                String(vehicle.lat)
              )}&focusLng=${encodeURIComponent(String(vehicle.lng))}`}
              data-testid="vehicle-view-stand-map-btn"
              className="inline-flex h-7 items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-xs font-semibold text-[var(--ps-text)] hover:border-[var(--ps-accent)] hover:text-[var(--ps-accent)] transition-colors"
            >
              <MapPin className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
              <span>View Stand on Map</span>
            </Link>

            {vehicle.owner_id && authUser?.id !== vehicle.owner_id && (
              <button
                type="button"
                onClick={() => void toggleFollow('author', vehicle.owner_id)}
                data-testid="vehicle-follow-owner-btn"
                className={`inline-flex h-8 items-center gap-1.5 rounded-xl border px-2.5 text-xs font-semibold transition-colors ${
                  followingOwner
                    ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)]/12 text-[var(--ps-accent)]'
                    : 'border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                }`}
              >
                {followingOwner ? (
                  <>
                    <UserCheck className="h-3.5 w-3.5" />
                    <span>Following</span>
                  </>
                ) : (
                  <>
                    <UserPlus className="h-3.5 w-3.5" />
                    <span>Follow Driver</span>
                  </>
                )}
              </button>
            )}

            <button
              type="button"
              onClick={() => void toggleSave('vehicle', vehicle.id)}
              data-testid="vehicle-save-btn"
              className={`inline-flex h-8 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition-colors ${
                saved
                  ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)]/12 text-[var(--ps-accent)]'
                  : 'border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
              }`}
            >
              <Bookmark className={`h-3.5 w-3.5 ${saved ? 'fill-current' : ''}`} />
              <span>{saved ? 'Saved' : 'Save'}</span>
            </button>

            <button
              type="button"
              onClick={() => {
                const origin =
                  typeof window !== 'undefined' ? window.location.origin : '';
                void share({
                  title: `${displayTitle} — DD oodle Vehicles`,
                  text: `Book ${displayTitle} (${vehicle.stand_locality}) on DD oodle.`,
                  url: origin
                    ? `${origin}/vehicles/${encodeURIComponent(vehicle.id)}`
                    : `/vehicles/${encodeURIComponent(vehicle.id)}`,
                });
              }}
              data-testid="vehicle-share-btn"
              aria-label={`Share ${displayTitle}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 text-xs font-semibold text-[var(--ps-text)] hover:border-[var(--ps-accent)] hover:text-[var(--ps-accent)] transition-colors cursor-pointer"
            >
              <Share2 className="h-3.5 w-3.5" />
              <span>Share</span>
            </button>

            <a
              href={whatsappHref}
              target="_blank"
              rel="noopener noreferrer"
              data-testid="vehicle-whatsapp-btn"
              className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-xs font-bold text-white hover:bg-emerald-700 transition-colors"
            >
              <MessageCircle className="h-3.5 w-3.5" />
              <span>WhatsApp</span>
            </a>
          </div>
        </div>

        {/* Cross-Hub Deep Link Banner */}
        <CrossHubBanner
          itemHubId={vehicle.origin_hub_id}
          itemTypeLabel="vehicle"
        />

        {/* Subtle Inter-Hub Travel Tip: Overnight Stays Cross-Link */}
        <Link
          href="/explore?category=hotels_homestays"
          data-testid="vehicle-overnight-stay-tip"
          className="flex items-center justify-between gap-2 rounded-xl border border-indigo-500/25 bg-indigo-500/8 px-3.5 py-2 text-xs font-semibold text-indigo-900 hover:bg-indigo-500/12 dark:text-indigo-200 transition-colors"
        >
          <span className="flex items-center gap-2 min-w-0">
            <BedDouble className="h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-400" />
            <span className="truncate">
              Staying overnight at your destination? Browse verified Hotels &amp; Homestays
            </span>
          </span>
          <ArrowRight className="h-3.5 w-3.5 shrink-0" />
        </Link>

        {/* Main 2-Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* LEFT COLUMN: Gallery, 360° Interior, Details, Rates, Reviews */}
          <div className="lg:col-span-7 space-y-4">
            {/* Hero Media Card */}
            <motion.div
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22 }}
              className="overflow-hidden rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] shadow-xs"
            >
              {/* Toggle Bar if 360° Panorama exists */}
              {panoramaScenes.length > 0 && (
                <div className="flex items-center justify-between border-b border-[var(--ps-border)] px-3 py-2 bg-[var(--ps-bg)]">
                  <span className="text-[11px] font-semibold text-[var(--ps-text-muted)]">
                    Vehicle Media & Cabin View
                  </span>
                  <div className="inline-flex rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] p-0.5">
                    <button
                      type="button"
                      onClick={() => setShowPanorama(false)}
                      className={`h-7 rounded-md px-2.5 text-[11px] font-bold transition-colors ${
                        !showPanorama
                          ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                          : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                      }`}
                    >
                      Photos ({Math.max(1, galleryImages.length)})
                    </button>
                    <button
                      type="button"
                      onClick={() => setShowPanorama(true)}
                      className={`inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-[11px] font-bold transition-colors ${
                        showPanorama
                          ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                          : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                      }`}
                    >
                      <Compass className="h-3 w-3" />
                      <span>360° Interior</span>
                    </button>
                  </div>
                </div>
              )}

              {showPanorama && panoramaScenes.length > 0 ? (
                <div className="p-2">
                  <PanoramaViewer360
                    panoramas={panoramaScenes}
                    propertyTitle={displayTitle}
                    coordinates={{ lat: vehicle.lat, lng: vehicle.lng }}
                  />
                </div>
              ) : (
                <div className="relative aspect-[16/10] w-full bg-[var(--ps-bg)]">
                  {galleryImages[activeImgIdx] ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={galleryImages[activeImgIdx]}
                      alt={displayTitle}
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-slate-200 px-6 text-center">
                      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-white/10 border border-white/15">
                        <Car className="h-7 w-7 text-amber-400" />
                      </div>
                      <p className="text-sm font-bold">{displayTitle}</p>
                      <p className="text-xs text-slate-300">
                        {meta.vehicleTypeName} · {vehicle.stand_locality}
                      </p>
                    </div>
                  )}

                  {/* Subtle overlay badges */}
                  <div className="absolute left-3 top-3 flex flex-wrap gap-1.5">
                    <span className="inline-flex items-center gap-1 rounded-lg bg-slate-950/80 backdrop-blur-xs px-2.5 py-1 text-[11px] font-bold text-white">
                      <Car className="h-3 w-3 text-amber-400" />
                      <span>{meta.vehicleTypeName}</span>
                    </span>
                    <span className="inline-flex items-center gap-1 rounded-lg bg-slate-950/80 backdrop-blur-xs px-2.5 py-1 text-[11px] font-bold text-white">
                      <UserCheck className="h-3 w-3 text-emerald-400" />
                      <span>{vehicle.with_driver ? 'With Driver' : 'Self-Drive'}</span>
                    </span>
                    {vehicle.is_verified && (
                      <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-600/95 px-2.5 py-1 text-[11px] font-bold text-white">
                        <ShieldCheck className="h-3 w-3" />
                        <span>Verified</span>
                      </span>
                    )}
                    {interHubRouteLabel && (
                      <span
                        data-testid="vehicle-detail-interhub-badge"
                        className="inline-flex items-center gap-1 rounded-lg bg-indigo-600/95 px-2.5 py-1 text-[11px] font-bold text-white"
                      >
                        <Route className="h-3 w-3" />
                        <span>{interHubRouteLabel}</span>
                      </span>
                    )}
                  </div>
                </div>
              )}

              {/* Thumbnail Strip */}
              {!showPanorama && galleryImages.length > 1 && (
                <div className="flex gap-2 overflow-x-auto border-t border-[var(--ps-border)] p-2.5 bg-[var(--ps-bg)]">
                  {galleryImages.map((imgUrl, idx) => (
                    <button
                      key={`${imgUrl}-${idx}`}
                      type="button"
                      onClick={() => setActiveImgIdx(idx)}
                      className={`h-14 w-20 shrink-0 overflow-hidden rounded-lg border-2 transition-all ${
                        idx === activeImgIdx
                          ? 'border-[var(--ps-accent)] opacity-100'
                          : 'border-transparent opacity-65 hover:opacity-100'
                      }`}
                    >
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img
                        src={imgUrl}
                        alt={`${displayTitle} view ${idx + 1}`}
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover"
                      />
                    </button>
                  ))}
                </div>
              )}
            </motion.div>

            {/* Title, Stand Locality, Specs & Features */}
            <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3.5">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="space-y-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="text-lg sm:text-xl font-extrabold tracking-tight text-[var(--ps-text)]">
                      {displayTitle}
                    </h1>
                    {interHubRouteLabel && (
                      <span
                        data-testid="vehicle-title-interhub-pill"
                        className="inline-flex items-center gap-1 rounded-lg border border-indigo-500/35 bg-indigo-500/10 px-2 py-0.5 text-[11px] font-bold text-indigo-700 dark:text-indigo-300"
                      >
                        <Route className="h-3 w-3" />
                        <span>{interHubRouteLabel}</span>
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--ps-text-muted)]">
                    <span className="inline-flex items-center gap-1 font-semibold text-[var(--ps-text)]">
                      <MapPin className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
                      <span>{vehicle.stand_locality}</span>
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <Users className="h-3.5 w-3.5" />
                      <span>{vehicle.total_seats} Seats</span>
                    </span>
                    <span className="inline-flex items-center gap-1">
                      <ShieldCheck className="h-3.5 w-3.5 text-emerald-500" />
                      <span>
                        {vehicle.advance_percent}% UPI Advance Escrow
                      </span>
                    </span>
                  </div>
                </div>
              </div>

              {vehicle.description && (
                <p className="text-xs sm:text-sm leading-relaxed text-[var(--ps-text-muted)]">
                  {vehicle.description}
                </p>
              )}

              {/* Feature Chips */}
              {Array.isArray(vehicle.features) && vehicle.features.length > 0 && (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {vehicle.features.map((feat) => (
                    <span
                      key={feat}
                      className="inline-flex items-center gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 py-1 text-[11px] font-semibold text-[var(--ps-text)]"
                    >
                      <Sparkles className="h-3 w-3 text-[var(--ps-accent)]" />
                      <span>{feat}</span>
                    </span>
                  ))}
                </div>
              )}

              {/* Operator & Stand Footer */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 border-t border-[var(--ps-border)] pt-3 text-xs">
                <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--ps-text-muted)] block">
                    Listed By / Driver
                  </span>
                  <p className="font-bold text-[var(--ps-text)] truncate">
                    {meta.driverName || meta.ownerName}
                  </p>
                </div>
                <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--ps-text-muted)] block">
                    Booking Modes Supported
                  </span>
                  <p className="font-bold text-[var(--ps-text)]">
                    {vehicle.booking_mode === 'both'
                      ? 'Full Vehicle Charter & Per-Seat'
                      : vehicle.booking_mode === 'per_seat'
                        ? 'Per-Seat Shared Booking'
                        : 'Full Vehicle Charter Only'}
                  </p>
                </div>
              </div>
            </div>

            {/* Rate Card & Fixed Routes Summary */}
            <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3">
              <h2 className="text-sm font-bold text-[var(--ps-text)] flex items-center gap-1.5">
                <Route className="h-4 w-4 text-[var(--ps-accent)]" />
                <span>Transparent Tariffs & Fixed Routes</span>
              </h2>

              <div className="grid grid-cols-3 gap-2 text-center">
                <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-2.5">
                  <span className="text-[10px] text-[var(--ps-text-muted)] block">
                    Hourly Rate
                  </span>
                  <span className="text-sm font-extrabold tabular-nums text-[var(--ps-text)]">
                    {vehicle.rate_hourly_inr
                      ? `₹${vehicle.rate_hourly_inr}`
                      : '—'}
                  </span>
                </div>
                <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-2.5">
                  <span className="text-[10px] text-[var(--ps-text-muted)] block">
                    Daily Charter
                  </span>
                  <span className="text-sm font-extrabold tabular-nums text-[var(--ps-text)]">
                    {vehicle.rate_daily_inr
                      ? `₹${vehicle.rate_daily_inr}`
                      : '—'}
                  </span>
                </div>
                <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-2.5">
                  <span className="text-[10px] text-[var(--ps-text-muted)] block">
                    Per Km
                  </span>
                  <span className="text-sm font-extrabold tabular-nums text-[var(--ps-text)]">
                    {vehicle.rate_per_km_inr
                      ? `₹${vehicle.rate_per_km_inr}/km`
                      : '—'}
                  </span>
                </div>
              </div>

              {Array.isArray(vehicle.fixed_routes) &&
                vehicle.fixed_routes.length > 0 && (
                  <div className="space-y-1.5 pt-1">
                    <p className="text-[11px] font-semibold text-[var(--ps-text-muted)]">
                      Popular Fixed Routes (click to select):
                    </p>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {vehicle.fixed_routes.map((rt, idx) => {
                        const key = `route:${idx}`;
                        const active = selectedPricingKey === key;
                        return (
                          <button
                            key={`${rt.origin}-${rt.destination}-${idx}`}
                            type="button"
                            onClick={() => handleSelectPricingKey(key)}
                            className={`flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left transition-colors ${
                              active
                                ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)]/10'
                                : 'border-[var(--ps-border)] bg-[var(--ps-bg)] hover:border-[var(--ps-accent)]/60'
                            }`}
                          >
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-[var(--ps-text)] truncate">
                                {rt.origin} → {rt.destination}
                              </p>
                              {rt.duration_label && (
                                <p className="text-[10px] text-[var(--ps-text-muted)]">
                                  Est. {rt.duration_label}
                                </p>
                              )}
                            </div>
                            <div className="text-right shrink-0">
                              <p className="text-xs font-extrabold tabular-nums text-[var(--ps-accent)]">
                                ₹{rt.fare_inr}/seat
                              </p>
                              {rt.full_vehicle_fare_inr && (
                                <p className="text-[10px] tabular-nums text-[var(--ps-text-muted)]">
                                  Full ₹{rt.full_vehicle_fare_inr}
                                </p>
                              )}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}
            </div>

            {/* Customer Reviews Section */}
            <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-bold text-[var(--ps-text)] flex items-center gap-1.5">
                  <Star className="h-4 w-4 text-amber-500 fill-amber-500" />
                  <span>Rider Reviews ({reviews.length})</span>
                </h2>
              </div>

              <div className="space-y-2">
                {reviews.map((rev) => (
                  <div
                    key={rev.id}
                    className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 space-y-1"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-bold text-[var(--ps-text)]">
                        {rev.authorName}
                      </span>
                      <div className="flex items-center gap-1 text-[11px] text-amber-500">
                        {Array.from({ length: rev.rating }).map((_, i) => (
                          <Star key={i} className="h-3 w-3 fill-current" />
                        ))}
                        <span className="ml-1 text-[10px] text-[var(--ps-text-muted)]">
                          {rev.createdAt}
                        </span>
                      </div>
                    </div>
                    <p className="text-xs text-[var(--ps-text-muted)] leading-relaxed">
                      {rev.comment}
                    </p>
                  </div>
                ))}
              </div>

              <form onSubmit={handleAddReview} className="space-y-2 border-t border-[var(--ps-border)] pt-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold text-[var(--ps-text)]">
                    Share your ride experience
                  </span>
                  <div className="flex items-center gap-1">
                    {[1, 2, 3, 4, 5].map((starVal) => (
                      <button
                        key={starVal}
                        type="button"
                        onClick={() => setReviewRating(starVal)}
                        aria-label={`Rate ${starVal} stars`}
                        className="p-0.5 text-amber-500"
                      >
                        <Star
                          className={`h-4 w-4 ${
                            starVal <= reviewRating ? 'fill-current' : 'opacity-30'
                          }`}
                        />
                      </button>
                    ))}
                  </div>
                </div>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={reviewText}
                    onChange={(e) => setReviewText(e.target.value)}
                    placeholder="Punctuality, vehicle comfort, driver behaviour…"
                    className="h-9 flex-1 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-accent)]"
                  />
                  <button
                    type="submit"
                    disabled={!reviewText.trim()}
                    className="h-9 rounded-xl bg-[var(--ps-accent)] px-3.5 text-xs font-bold text-[var(--ps-accent-fg)] disabled:opacity-50"
                  >
                    Post
                  </button>
                </div>
                {reviewSubmitted && (
                  <p className="text-[11px] font-medium text-emerald-600 dark:text-emerald-400">
                    Thank you! Your rider feedback has been posted.
                  </p>
                )}
              </form>
            </div>
          </div>

          {/* RIGHT COLUMN: Interactive Schedule & Book Card */}
          <div className="lg:col-span-5 lg:sticky lg:top-4 space-y-4">
            <ModulePausedGuard module="vehicle_bookings" compact>
            <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 shadow-sm space-y-3.5">
              <div className="flex items-center justify-between gap-2 border-b border-[var(--ps-border)] pb-2.5">
                <div>
                  <h2 className="text-sm font-extrabold text-[var(--ps-text)] flex items-center gap-1.5">
                    <Calendar className="h-4 w-4 text-[var(--ps-accent)]" />
                    <span>Schedule & Reserve Vehicle</span>
                  </h2>
                  <p className="text-[11px] text-[var(--ps-text-muted)]">
                    Conflict-free slot lock · Pay {vehicle.advance_percent}% advance via UPI
                  </p>
                </div>
              </div>

              {/* Created Booking Receipt Banner */}
              {createdBooking && (
                <div
                  data-testid="vehicle-booking-receipt-card"
                  className="rounded-xl border border-emerald-500/40 bg-emerald-500/10 p-3 space-y-2"
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 dark:text-emerald-300">
                      <CheckCircle2 className="h-4 w-4" />
                      <span>Slot Reserved · {createdBooking.booking_code}</span>
                    </span>
                    {activeIntent && activeIntent.status === 'awaiting_payment' && (
                      <button
                        type="button"
                        onClick={() => setPaymentModalOpen(true)}
                        className="h-7 rounded-lg bg-emerald-600 px-2.5 text-[11px] font-bold text-white hover:bg-emerald-700"
                      >
                        Pay Advance
                      </button>
                    )}
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-[11px]">
                    <div className="rounded-lg bg-[var(--ps-surface)] px-2.5 py-1.5 border border-[var(--ps-border)]">
                      <span className="text-[var(--ps-text-muted)] block">Start Trip OTP</span>
                      <span className="font-mono text-sm font-extrabold tracking-widest text-[var(--ps-text)]">
                        {createdBooking.start_otp || '—'}
                      </span>
                    </div>
                    <div className="rounded-lg bg-[var(--ps-surface)] px-2.5 py-1.5 border border-[var(--ps-border)]">
                      <span className="text-[var(--ps-text-muted)] block">End Trip OTP</span>
                      <span className="font-mono text-sm font-extrabold tracking-widest text-[var(--ps-text)]">
                        {createdBooking.end_otp || '—'}
                      </span>
                    </div>
                  </div>
                  <p className="text-[11px] text-[var(--ps-text-muted)]">
                    Status:{' '}
                    <strong className="text-[var(--ps-text)]">
                      {activeIntent?.status === 'pending_manual'
                        ? 'UTR submitted — awaiting Admin approval'
                        : activeIntent?.status === 'succeeded'
                          ? 'Confirmed'
                          : '20-min Soft Hold (complete UPI advance)'}
                    </strong>
                  </p>
                </div>
              )}

              <form onSubmit={handleReserveAndPay} className="space-y-3">
                {/* 1. Full Vehicle vs Per Seat Toggle */}
                <div className="space-y-1.5">
                  <label className="text-[11px] font-bold text-[var(--ps-text-muted)] block">
                    Booking Type
                  </label>
                  <div className="grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      disabled={!allowedFull}
                      onClick={() => {
                        setBookingMode('full_vehicle');
                        setSeatsBooked(Math.max(1, vehicle.total_seats || 4));
                      }}
                      className={`h-9 rounded-xl border text-xs font-bold transition-colors ${
                        bookingMode === 'full_vehicle'
                          ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                          : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text)] disabled:opacity-40'
                      }`}
                    >
                      Full Vehicle
                    </button>
                    <button
                      type="button"
                      disabled={!allowedSeat}
                      onClick={() => {
                        setBookingMode('per_seat');
                        setSeatsBooked(1);
                      }}
                      className={`h-9 rounded-xl border text-xs font-bold transition-colors ${
                        bookingMode === 'per_seat'
                          ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                          : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text)] disabled:opacity-40'
                      }`}
                    >
                      Per Seat (Shared)
                    </button>
                  </div>

                  {/* Seat Counter when per_seat */}
                  {bookingMode === 'per_seat' && (
                    <div className="flex items-center justify-between rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2">
                      <span className="text-xs font-semibold text-[var(--ps-text)]">
                        Seats Required (max {vehicle.total_seats})
                      </span>
                      <div className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => setSeatsBooked((s) => Math.max(1, s - 1))}
                          className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]"
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                        <span className="w-6 text-center font-mono text-sm font-extrabold tabular-nums">
                          {seatsBooked}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setSeatsBooked((s) =>
                              Math.min(Math.max(1, vehicle.total_seats || 4), s + 1)
                            )
                          }
                          className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  )}
                </div>

                {/* 2. Pricing / Route Selector */}
                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-[var(--ps-text-muted)] block">
                    Route / Tariff Plan
                  </label>
                  <CustomSelectModal
                    value={selectedPricingKey}
                    onChange={handleSelectPricingKey}
                    options={selectModalOptions}
                    label="Select Route or Tariff Plan"
                    placeholder="Choose route or tariff…"
                  />
                </div>

                {/* Estimated Km input if per_km selected */}
                {selectedPricingOption?.kind === 'per_km' && (
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-[var(--ps-text-muted)] block">
                      Estimated Trip Distance (km)
                    </label>
                    <input
                      type="number"
                      min={5}
                      max={1500}
                      value={estimatedKm}
                      onChange={(e) =>
                        setEstimatedKm(Math.max(5, Number(e.target.value) || 5))
                      }
                      className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs font-semibold tabular-nums text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-accent)]"
                    />
                  </div>
                )}

                {/* 3. Start & End Date/Time Pickers */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-[var(--ps-text-muted)] block">
                      Start Date & Time *
                    </label>
                    <input
                      type="datetime-local"
                      required
                      value={startLocal}
                      onChange={(e) => setStartLocal(e.target.value)}
                      className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-xs text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-accent)]"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-[var(--ps-text-muted)] block">
                      End Date & Time *
                    </label>
                    <input
                      type="datetime-local"
                      required
                      value={endLocal}
                      onChange={(e) => setEndLocal(e.target.value)}
                      className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-xs text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-accent)]"
                    />
                  </div>
                </div>

                {/* Existing Booked & Blocked Windows Notice */}
                {(blocks.length > 0 || bookedWindows.length > 0) && (
                  <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-2.5 space-y-1.5">
                    <p className="text-[11px] font-bold text-[var(--ps-text)] flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5 text-amber-500" />
                      <span>Upcoming Blocked / Booked Windows</span>
                    </p>
                    <ul className="space-y-1 max-h-28 overflow-y-auto text-[11px] text-[var(--ps-text-muted)]">
                      {blocks.slice(0, 6).map((b) => (
                        <li key={b.id} className="flex items-center justify-between gap-2">
                          <span className="truncate">
                            {formatDateRangeShort(b.start_time, b.end_time)}
                          </span>
                          <span className="shrink-0 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-amber-600 dark:text-amber-400">
                            {b.reason.replace(/_/g, ' ')}
                          </span>
                        </li>
                      ))}
                      {bookedWindows.slice(0, 6).map((w) => (
                        <li key={w.id} className="flex items-center justify-between gap-2">
                          <span className="truncate">
                            {formatDateRangeShort(w.start_time, w.end_time)}
                          </span>
                          <span className="shrink-0 rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600 dark:text-rose-400">
                            {w.booking_mode === 'full_vehicle'
                              ? 'Booked'
                              : `${w.seats_booked} seat(s)`}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {/* Overlap Conflict Warning */}
                {overlapConflict && (
                  <div className="flex items-start gap-2 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-300">
                    <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{overlapConflict}</span>
                  </div>
                )}

                {/* 4. Pickup / Dropoff / Instructions */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-[var(--ps-text-muted)] block">
                      Pickup Location *
                    </label>
                    <input
                      type="text"
                      required
                      value={pickupLocation}
                      onChange={(e) => setPickupLocation(e.target.value)}
                      placeholder="e.g. Lamka Police Station"
                      className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-accent)]"
                    />
                  </div>
                  <div className="space-y-1">
                    <label className="text-[11px] font-bold text-[var(--ps-text-muted)] block">
                      Drop-off / Destination
                    </label>
                    <input
                      type="text"
                      value={dropoffLocation}
                      onChange={(e) => setDropoffLocation(e.target.value)}
                      placeholder="e.g. Imphal Airport"
                      className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-accent)]"
                    />
                  </div>
                </div>

                <div className="space-y-1">
                  <label className="text-[11px] font-bold text-[var(--ps-text-muted)] block">
                    Trip Notes (Optional)
                  </label>
                  <input
                    type="text"
                    value={instructions}
                    onChange={(e) => setInstructions(e.target.value)}
                    placeholder="Luggage count, landmark, child seat request…"
                    className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-accent)]"
                  />
                </div>

                {/* 5. Live Fare Breakdown */}
                <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 space-y-1.5 text-xs">
                  <div className="flex items-center justify-between">
                    <span className="text-[var(--ps-text-muted)]">
                      Estimated Total Fare
                    </span>
                    <span className="font-bold tabular-nums text-[var(--ps-text)]">
                      ₹{fareBreakdown.totalFare.toLocaleString('en-IN')}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[var(--ps-accent)]">
                    <span className="font-semibold">
                      Prepaid Advance Deposit ({fareBreakdown.advancePct}%)
                    </span>
                    <span className="text-sm font-extrabold tabular-nums">
                      ₹{fareBreakdown.advanceAmount.toLocaleString('en-IN')}
                    </span>
                  </div>
                  <div className="flex items-center justify-between border-t border-[var(--ps-border)] pt-1.5 text-[var(--ps-text-muted)]">
                    <span>Balance Due to Driver on Trip</span>
                    <span className="font-bold tabular-nums text-[var(--ps-text)]">
                      ₹{fareBreakdown.balanceDue.toLocaleString('en-IN')}
                    </span>
                  </div>
                </div>

                {bookingError && (
                  <div
                    role="alert"
                    className="flex items-start gap-2 rounded-xl border border-rose-500/35 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300"
                  >
                    <Info className="mt-0.5 h-4 w-4 shrink-0" />
                    <span>{bookingError}</span>
                  </div>
                )}

                {!authUser ? (
                  <Link
                    href="/login"
                    className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[var(--ps-accent)] px-4 text-xs font-bold text-[var(--ps-accent-fg)] shadow-xs hover:opacity-95 transition-opacity"
                  >
                    <Navigation className="h-4 w-4" />
                    <span>Sign In to Reserve Slot & Pay Advance</span>
                  </Link>
                ) : (
                  <button
                    type="submit"
                    disabled={
                      isReserving ||
                      !fareBreakdown.validWindow ||
                      Boolean(overlapConflict)
                    }
                    data-testid="vehicle-reserve-btn"
                    className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-[var(--ps-accent)] px-4 text-xs font-bold text-[var(--ps-accent-fg)] shadow-xs hover:opacity-95 transition-opacity disabled:opacity-50"
                  >
                    {isReserving ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span>Locking Slot…</span>
                      </>
                    ) : (
                      <>
                        <ShieldCheck className="h-4 w-4" />
                        <span>
                          Reserve Slot & Pay ₹
                          {fareBreakdown.advanceAmount.toLocaleString('en-IN')}{' '}
                          Advance
                        </span>
                      </>
                    )}
                  </button>
                )}
              </form>
            </div>
            </ModulePausedGuard>
          </div>
        </div>
      </div>

      {/* Universal Manual-to-Razorpay Payment Modal */}
      <UniversalPaymentModal
        open={paymentModalOpen}
        intent={activeIntent}
        upiId={upiDetails.upiId}
        upiPayeeName={upiDetails.upiPayeeName}
        title={`Advance for ${displayTitle}`}
        subtitle={
          createdBooking
            ? `Booking ${createdBooking.booking_code} · Balance ₹${Number(
                createdBooking.balance_due_inr || 0
              ).toLocaleString('en-IN')} due to driver`
            : undefined
        }
        onSubmitted={(updated) => {
          setActiveIntent(updated);
          void refreshAvailability();
        }}
        onClose={() => setPaymentModalOpen(false)}
      />
    </div>
  );
}

export default VehicleDetailClient;
