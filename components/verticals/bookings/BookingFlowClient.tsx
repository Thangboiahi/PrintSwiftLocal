'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { motion } from 'motion/react';
import { PhoneInput } from '@/components/ui/PhoneInput';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BedDouble,
  CalendarDays,
  Car,
  Check,
  CheckCircle2,
  Clock,
  Compass,
  Copy,
  FileCheck2,
  Info,
  KeyRound,
  Loader2,
  MapPin,
  Minus,
  Phone,
  Plus,
  Printer,
  ShieldCheck,
  Sparkles,
  Users,
} from 'lucide-react';
import { CrossHubBanner } from '@/components/hub/CrossHubBanner';
import { PageSubNavPill } from '@/components/navigation/PageSubNavPill';
import { UniversalPaymentModal } from '@/components/payments/UniversalPaymentModal';
import {
  addDaysToYmd,
  diffYmdDays,
  formatBookingInr,
  formatIstDateTime,
  getAmenityLabel,
  getBookingUnitShortLabel,
  getHotelStayTypeLabel,
  getTodayIstYmd,
  type ApiAvailabilityResponse,
  type ApiResourceAvailability,
  type ApiSlotAvailability,
} from '@/lib/bookings/client-helpers';
import { computeBookingPrice } from '@/lib/bookings/pricing-engine';
import type {
  ListingBookingResource,
  ListingHotelProfile,
  ResourceBooking,
  ResourceVertical,
} from '@/lib/bookings/types';
import { useAppStatus } from '@/lib/hooks/useAppStatus';
import type { PaymentIntentRecord } from '@/lib/payments/types';
import { useAuth } from '@/lib/store';
import { supabase } from '@/lib/supabase/client';
import { supabaseMediaImageLoader } from '@/lib/supabase/storage';

export interface BookingListingSummary {
  id: string;
  title: string;
  locality: string;
  address: string | null;
  hub_id: string | null;
  phone: string | null;
  whatsapp: string | null;
  coverImage: string | null;
}

export interface BookingFlowClientProps {
  listing: BookingListingSummary;
  vertical: ResourceVertical;
  resources: ListingBookingResource[];
  hotelProfile: ListingHotelProfile | null;
  hasActiveEntitlement: boolean;
  isModuleEnabled: boolean;
  hubPauseMessage: string | null;
  initialCheckIn?: string;
  initialCheckOut?: string;
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

function buildIstIsoFromYmdHour(ymd: string, hour: number): string {
  const safeHour = Math.max(0, Math.min(23, Math.floor(hour)));
  return `${ymd}T${String(safeHour).padStart(2, '0')}:00:00+05:30`;
}

function parseClockTimeToHourMinute(
  raw: string | null | undefined,
  fallbackHour: number
): string {
  if (!raw) return `${String(fallbackHour).padStart(2, '0')}:00`;
  const m = raw.trim().match(/^(\d{1,2})(?::(\d{2}))?\s*(AM|PM)?$/i);
  if (!m) return `${String(fallbackHour).padStart(2, '0')}:00`;
  let h = Number(m[1]);
  const mins = Number(m[2] ?? '0');
  const mer = (m[3] || '').toUpperCase();
  if (mer === 'PM' && h < 12) h += 12;
  if (mer === 'AM' && h === 12) h = 0;
  return `${String(Math.min(23, Math.max(0, h))).padStart(2, '0')}:${String(
    Math.min(59, Math.max(0, mins))
  ).padStart(2, '0')}`;
}

export function BookingFlowClient({
  listing,
  vertical,
  resources,
  hotelProfile,
  hasActiveEntitlement,
  isModuleEnabled,
  hubPauseMessage,
  initialCheckIn,
  initialCheckOut,
}: BookingFlowClientProps) {
  const { user, fullName } = useAuth();
  const { setStatus } = useAppStatus();

  const todayYmd = useMemo(() => getTodayIstYmd(), []);
  const defaultCheckIn =
    initialCheckIn && YMD_RE.test(initialCheckIn) && initialCheckIn >= todayYmd
      ? initialCheckIn
      : todayYmd;
  const defaultCheckOut =
    initialCheckOut &&
    YMD_RE.test(initialCheckOut) &&
    initialCheckOut > defaultCheckIn
      ? initialCheckOut
      : addDaysToYmd(defaultCheckIn, 1);

  // Selected resource
  const [selectedResourceId, setSelectedResourceId] = useState<string>(
    resources[0]?.id || ''
  );
  const selectedResource = useMemo(
    () =>
      resources.find((r) => r.id === selectedResourceId) || resources[0] || null,
    [resources, selectedResourceId]
  );

  // Mode 1 (Venue) date & slot selection
  const [venueDate, setVenueDate] = useState<string>(defaultCheckIn);
  const [selectedSlotRange, setSelectedSlotRange] = useState<{
    startIdx: number;
    endIdx: number;
  } | null>(null);
  const [venueDurationUnits, setVenueDurationUnits] = useState<number>(1);
  const [halfDayBlock, setHalfDayBlock] = useState<'morning' | 'evening'>(
    'morning'
  );

  // Mode 2 (Hotel) date & party selection
  const [checkIn, setCheckIn] = useState<string>(defaultCheckIn);
  const [checkOut, setCheckOut] = useState<string>(defaultCheckOut);
  const [roomsCount, setRoomsCount] = useState<number>(1);
  const [guestsCount, setGuestsCount] = useState<number>(2);

  // Shared add-ons, payment options & guest form
  const [selectedAddonKeys, setSelectedAddonKeys] = useState<string[]>([]);
  const [payFullUpfront, setPayFullUpfront] = useState<boolean>(false);
  const [guestName, setGuestName] = useState<string>(fullName || '');
  const [guestPhone, setGuestPhone] = useState<string>('');
  const [notes, setNotes] = useState<string>('');

  // Live availability state
  const [availability, setAvailability] =
    useState<ApiAvailabilityResponse | null>(null);
  const [isLoadingAvailability, setIsLoadingAvailability] =
    useState<boolean>(false);
  const [availabilityError, setAvailabilityError] = useState<string | null>(
    null
  );

  // Checkout / Payment / Confirmed state
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [activePaymentIntent, setActivePaymentIntent] =
    useState<PaymentIntentRecord | null>(null);
  const [confirmedState, setConfirmedState] = useState<{
    booking: ResourceBooking;
    checkinOtp: string;
    paymentPendingReview: boolean;
  } | null>(null);
  const [pendingConfirmationDraft, setPendingConfirmationDraft] = useState<{
    booking: ResourceBooking;
    checkinOtp: string;
  } | null>(null);
  const [copiedOtp, setCopiedOtp] = useState(false);

  // Pre-fill guest name & phone from signed-in profile
  useEffect(() => {
    if (fullName && !guestName) {
      setGuestName(fullName);
    }
  }, [fullName, guestName]);

  useEffect(() => {
    if (!user?.id) return;
    let active = true;
    supabase
      .from('profiles')
      .select('full_name, phone')
      .eq('id', user.id)
      .maybeSingle()
      .then(({ data }) => {
        if (!active || !data) return;
        const row = data as { full_name?: string | null; phone?: string | null };
        if (row.full_name && !guestName) setGuestName(row.full_name);
        if (row.phone && !guestPhone) setGuestPhone(row.phone);
      });
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  // Reset per-resource selections when switching resource
  useEffect(() => {
    setSelectedSlotRange(null);
    setSelectedAddonKeys([]);
    setVenueDurationUnits(1);
    setSubmitError(null);
  }, [selectedResourceId]);

  // Determine honest gate state
  const isHotelPaused =
    vertical === 'hotel_stay' &&
    hotelProfile !== null &&
    !hotelProfile.is_accepting_bookings;

  const isBookingBlocked =
    !isModuleEnabled ||
    !hasActiveEntitlement ||
    isHotelPaused ||
    resources.length === 0;

  // Fetch live availability whenever dates or resource change
  useEffect(() => {
    if (isBookingBlocked || !selectedResource) return;
    let cancelled = false;
    setIsLoadingAvailability(true);
    setAvailabilityError(null);

    const params = new URLSearchParams({ listingId: listing.id });
    if (vertical === 'hotel_stay') {
      params.set('checkIn', checkIn);
      params.set('checkOut', checkOut);
    } else {
      params.set('resourceId', selectedResource.id);
      if (
        selectedResource.booking_unit === 'hourly' ||
        selectedResource.booking_unit === 'slot' ||
        selectedResource.booking_unit === 'half_day'
      ) {
        params.set('date', venueDate);
      } else if (selectedResource.booking_unit === 'full_day') {
        params.set('checkIn', venueDate);
        params.set(
          'checkOut',
          addDaysToYmd(venueDate, Math.max(1, venueDurationUnits) - 1)
        );
      } else if (selectedResource.booking_unit === 'weekly') {
        params.set('checkIn', venueDate);
        params.set(
          'checkOut',
          addDaysToYmd(venueDate, Math.max(1, venueDurationUnits) * 7)
        );
      }
    }

    fetch(`/api/bookings/availability?${params.toString()}`, {
      cache: 'no-store',
    })
      .then(async (res) => {
        const json = (await res.json().catch(() => ({}))) as ApiAvailabilityResponse;
        if (!res.ok) {
          throw new Error(json.error || 'Could not load live availability.');
        }
        return json;
      })
      .then((data) => {
        if (!cancelled) {
          setAvailability(data);
          setSelectedSlotRange(null);
        }
      })
      .catch((err) => {
        if (!cancelled) {
          setAvailabilityError(
            err instanceof Error
              ? err.message
              : 'Live availability could not be loaded.'
          );
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoadingAvailability(false);
      });

    return () => {
      cancelled = true;
    };
  }, [
    isBookingBlocked,
    listing.id,
    vertical,
    selectedResource,
    venueDate,
    venueDurationUnits,
    checkIn,
    checkOut,
  ]);

  const availabilityByResourceId = useMemo(() => {
    const map = new Map<string, ApiResourceAvailability>();
    for (const r of availability?.resources || []) {
      map.set(r.resourceId, r);
    }
    return map;
  }, [availability]);

  const activeResourceAvail = selectedResource
    ? availabilityByResourceId.get(selectedResource.id) || null
    : null;

  const liveSlots: ApiSlotAvailability[] = activeResourceAvail?.slots || [];

  const remainingUnitsForSelected = useMemo(() => {
    if (!selectedResource) return 0;
    if (
      activeResourceAvail &&
      typeof activeResourceAvail.remainingUnits === 'number'
    ) {
      return Math.max(0, activeResourceAvail.remainingUnits);
    }
    return selectedResource.total_units;
  }, [selectedResource, activeResourceAvail]);

  // Keep roomsCount & guestsCount within valid bounds for hotel_stay
  useEffect(() => {
    if (vertical !== 'hotel_stay' || !selectedResource) return;
    const maxRooms = Math.max(1, remainingUnitsForSelected);
    if (roomsCount > maxRooms) setRoomsCount(maxRooms);
    const maxGuests = Math.max(1, selectedResource.max_guests * Math.min(roomsCount, maxRooms));
    if (guestsCount > maxGuests) setGuestsCount(maxGuests);
  }, [vertical, selectedResource, remainingUnitsForSelected, roomsCount, guestsCount]);

  // Compute exact startAt & endAt ISO timestamps for current selection
  const selectedWindow = useMemo<{
    startAt: string;
    endAt: string;
    isValid: boolean;
    summaryLabel: string;
  }>(() => {
    if (!selectedResource) {
      return { startAt: '', endAt: '', isValid: false, summaryLabel: '' };
    }

    if (vertical === 'hotel_stay') {
      const ciClock = parseClockTimeToHourMinute(
        hotelProfile?.check_in_time,
        12
      );
      const coClock = parseClockTimeToHourMinute(
        hotelProfile?.check_out_time,
        11
      );
      const nights = diffYmdDays(checkIn, checkOut);
      return {
        startAt: `${checkIn}T${ciClock}:00+05:30`,
        endAt: `${checkOut}T${coClock}:00+05:30`,
        isValid:
          checkOut > checkIn &&
          remainingUnitsForSelected >= roomsCount &&
          remainingUnitsForSelected > 0,
        summaryLabel: `${checkIn} → ${checkOut} (${nights} ${
          nights === 1 ? 'night' : 'nights'
        })`,
      };
    }

    // Venue modes
    if (
      selectedResource.booking_unit === 'hourly' ||
      selectedResource.booking_unit === 'slot'
    ) {
      if (!selectedSlotRange || liveSlots.length === 0) {
        return { startAt: '', endAt: '', isValid: false, summaryLabel: '' };
      }
      const startSlot = liveSlots[selectedSlotRange.startIdx];
      const endSlot = liveSlots[selectedSlotRange.endIdx];
      if (!startSlot || !endSlot) {
        return { startAt: '', endAt: '', isValid: false, summaryLabel: '' };
      }
      const slotCount =
        selectedSlotRange.endIdx - selectedSlotRange.startIdx + 1;
      return {
        startAt: startSlot.startAt,
        endAt: endSlot.endAt,
        isValid: true,
        summaryLabel: `${venueDate} · ${startSlot.label.split('–')[0].trim()} – ${endSlot.label
          .split('–')[1]
          ?.trim()} (${slotCount} ${slotCount === 1 ? 'slot' : 'slots'})`,
      };
    }

    if (selectedResource.booking_unit === 'half_day') {
      const midHour = Math.floor(
        (selectedResource.open_hour + selectedResource.close_hour) / 2
      );
      const startHour =
        halfDayBlock === 'morning' ? selectedResource.open_hour : midHour;
      const endHour =
        halfDayBlock === 'morning' ? midHour : selectedResource.close_hour;
      return {
        startAt: buildIstIsoFromYmdHour(venueDate, startHour),
        endAt: buildIstIsoFromYmdHour(venueDate, Math.max(startHour + 1, endHour)),
        isValid: Boolean(activeResourceAvail?.isAvailable ?? true),
        summaryLabel: `${venueDate} · ${
          halfDayBlock === 'morning' ? 'Morning Session' : 'Evening Session'
        }`,
      };
    }

    if (selectedResource.booking_unit === 'weekly') {
      const endYmd = addDaysToYmd(venueDate, venueDurationUnits * 7);
      return {
        startAt: buildIstIsoFromYmdHour(venueDate, selectedResource.open_hour),
        endAt: buildIstIsoFromYmdHour(endYmd, selectedResource.close_hour),
        isValid: Boolean(activeResourceAvail?.isAvailable ?? true),
        summaryLabel: `${venueDate} → ${endYmd} (${venueDurationUnits} ${
          venueDurationUnits === 1 ? 'week' : 'weeks'
        })`,
      };
    }

    // full_day
    const endYmd = addDaysToYmd(venueDate, Math.max(1, venueDurationUnits) - 1);
    return {
      startAt: buildIstIsoFromYmdHour(venueDate, selectedResource.open_hour),
      endAt: buildIstIsoFromYmdHour(endYmd, selectedResource.close_hour),
      isValid: Boolean(activeResourceAvail?.isAvailable ?? true),
      summaryLabel:
        venueDurationUnits === 1
          ? `${venueDate} · Full Day`
          : `${venueDate} → ${endYmd} (${venueDurationUnits} days)`,
    };
  }, [
    selectedResource,
    vertical,
    hotelProfile,
    checkIn,
    checkOut,
    remainingUnitsForSelected,
    roomsCount,
    selectedSlotRange,
    liveSlots,
    venueDate,
    halfDayBlock,
    venueDurationUnits,
    activeResourceAvail,
  ]);

  const canPayFullUpfront = useMemo(() => {
    if (!selectedResource) return false;
    if (selectedResource.advance_percent >= 100) return false;
    if (
      vertical === 'hotel_stay' &&
      hotelProfile?.payment_policy?.allow_full_prepay === false
    ) {
      return false;
    }
    return true;
  }, [selectedResource, vertical, hotelProfile]);

  // Live deterministic quote preview using Phase 73-B pricing engine
  const liveQuote = useMemo(() => {
    if (!selectedResource || !selectedWindow.isValid || !selectedWindow.startAt) {
      return null;
    }
    try {
      const requiresEscrow =
        selectedResource.advance_percent > 0 || payFullUpfront;
      return computeBookingPrice({
        resource: selectedResource,
        startAt: selectedWindow.startAt,
        endAt: selectedWindow.endAt,
        unitsBooked: vertical === 'hotel_stay' ? roomsCount : 1,
        guestsCount:
          vertical === 'hotel_stay'
            ? guestsCount
            : Math.min(selectedResource.max_guests, 1),
        selectedAddonKeys,
        payFullUpfront,
        paymentRail: requiresEscrow ? 'platform_escrow' : 'direct_counter',
        bookingSource: 'online',
      });
    } catch {
      return null;
    }
  }, [
    selectedResource,
    selectedWindow,
    vertical,
    roomsCount,
    guestsCount,
    selectedAddonKeys,
    payFullUpfront,
  ]);

  // Contiguous slot range click handler
  const handleSlotClick = (idx: number) => {
    const clicked = liveSlots[idx];
    if (!clicked || !clicked.isAvailable) return;

    if (!selectedSlotRange) {
      setSelectedSlotRange({ startIdx: idx, endIdx: idx });
      return;
    }

    if (
      selectedSlotRange.startIdx === idx &&
      selectedSlotRange.endIdx === idx
    ) {
      setSelectedSlotRange(null);
      return;
    }

    const lo = Math.min(selectedSlotRange.startIdx, idx);
    const hi = Math.max(selectedSlotRange.endIdx, idx);
    // Check contiguity — every slot between lo and hi must be available
    let allOpen = true;
    for (let i = lo; i <= hi; i += 1) {
      if (!liveSlots[i]?.isAvailable) {
        allOpen = false;
        break;
      }
    }

    if (allOpen && hi - lo < 8) {
      setSelectedSlotRange({ startIdx: lo, endIdx: hi });
    } else {
      setSelectedSlotRange({ startIdx: idx, endIdx: idx });
    }
  };

  const toggleAddon = (key: string) => {
    setSelectedAddonKeys((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  };

  const handleSubmitBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitError(null);

    if (!user) {
      setSubmitError('Please sign in to confirm your booking.');
      return;
    }
    if (!selectedResource || !selectedWindow.isValid || !liveQuote) {
      setSubmitError(
        vertical === 'hotel_stay'
          ? 'Please select available dates and a room type.'
          : 'Please select an available date/time slot.'
      );
      return;
    }
    if (guestName.trim().length < 2) {
      setSubmitError('Please enter your full name (at least 2 characters).');
      return;
    }

    setIsSubmitting(true);
    setStatus('saving', 'Reserving your slot...');

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) {
        throw new Error('Your session has expired. Please sign in again.');
      }

      const res = await fetch('/api/bookings/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${accessToken}`,
        },
        body: JSON.stringify({
          listingId: listing.id,
          resourceId: selectedResource.id,
          startAt: selectedWindow.startAt,
          endAt: selectedWindow.endAt,
          unitsBooked: vertical === 'hotel_stay' ? roomsCount : 1,
          guestsCount: vertical === 'hotel_stay' ? guestsCount : 1,
          selectedAddonKeys,
          guestName: guestName.trim(),
          guestPhone: guestPhone.trim() || undefined,
          notes: notes.trim() || undefined,
          payFullUpfront,
        }),
      });

      const json = (await res.json().catch(() => ({}))) as {
        booking?: ResourceBooking;
        paymentIntent?: PaymentIntentRecord;
        checkinOtp?: string;
        error?: string;
      };

      if (!res.ok || !json.booking) {
        throw new Error(
          json.error || 'Unable to reserve this slot. Please try again.'
        );
      }

      const otp =
        json.checkinOtp ||
        json.booking.checkin_otp_display_for_customer ||
        '----';

      if (json.paymentIntent) {
        setPendingConfirmationDraft({ booking: json.booking, checkinOtp: otp });
        setActivePaymentIntent(json.paymentIntent);
        setStatus('idle');
      } else {
        setConfirmedState({
          booking: json.booking,
          checkinOtp: otp,
          paymentPendingReview: false,
        });
        setStatus('success', 'Booking confirmed!');
      }
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Booking submission failed.';
      setSubmitError(msg);
      setStatus('error', 'Booking failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopyOtp = async (otp: string) => {
    try {
      await navigator.clipboard.writeText(otp);
      setCopiedOtp(true);
      setStatus('success', 'Check-in OTP copied');
      window.setTimeout(() => setCopiedOtp(false), 1800);
    } catch {
      setStatus('error', 'Unable to copy OTP');
    }
  };

  const accentBadgeClass =
    vertical === 'hotel_stay'
      ? 'bg-indigo-500/15 text-indigo-800 dark:text-indigo-300 border-indigo-500/30'
      : 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300 border-emerald-500/30';

  const primaryBtnClass =
    vertical === 'hotel_stay'
      ? 'bg-indigo-600 hover:bg-indigo-700 text-white'
      : 'bg-emerald-600 hover:bg-emerald-700 text-white';

  const hotelAmenitiesList = useMemo(() => {
    if (!hotelProfile) return [];
    const verified = hotelProfile.verified_amenities || {};
    return Object.entries(hotelProfile.amenities || {})
      .filter(([, enabled]) => Boolean(enabled))
      .map(([key]) => ({
        key,
        label: getAmenityLabel(key),
        verified: Boolean(verified[key]),
      }));
  }, [hotelProfile]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 sm:px-6 pb-20 lg:pb-12 space-y-4">
      {/* Cross-Hub Banner */}
      <div className="pt-3">
        <CrossHubBanner
          itemHubId={listing.hub_id}
          itemTypeLabel={vertical === 'hotel_stay' ? 'stay' : 'venue'}
        />
      </div>

      {/* Compact Sticky Back-Navigation Pill */}
      <PageSubNavPill
        backHref={`/listing/${encodeURIComponent(listing.id)}`}
        backLabel="Back to Listing"
        trailing={
          <span
            className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider shrink-0 ${accentBadgeClass}`}
          >
            {vertical === 'hotel_stay' ? (
              <>
                <BedDouble className="h-3.5 w-3.5" />
                {getHotelStayTypeLabel(hotelProfile?.stay_type)}
              </>
            ) : (
              <>
                <CalendarDays className="h-3.5 w-3.5" />
                Venue &amp; Slot Booking
              </>
            )}
          </span>
        }
      >
        <div className="min-w-0 pr-1">
          <h1 className="text-xs sm:text-sm font-extrabold text-[var(--ps-text)] truncate max-w-[190px] sm:max-w-[300px]">
            {listing.title}
          </h1>
          <p className="text-[10px] text-[var(--ps-text-muted)] truncate flex items-center gap-1">
            <MapPin className="h-2.5 w-2.5 shrink-0" />
            <span>{listing.locality}</span>
          </p>
        </div>
      </PageSubNavPill>

      {/* HONEST GATE STATES (Hub Paused / No Entitlement / Property Paused / No Resources) */}
      {isBookingBlocked ? (
        <div
          data-testid="booking-gate-notice"
          className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 sm:p-8 text-center space-y-4 shadow-xs"
        >
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-amber-500/30 bg-amber-500/10 text-amber-600 dark:text-amber-300">
            <Info className="h-6 w-6" />
          </div>
          <div className="space-y-1.5 max-w-md mx-auto">
            <h2 className="text-base sm:text-lg font-extrabold text-[var(--ps-text)]">
              {!isModuleEnabled
                ? 'Online Bookings Temporarily Paused'
                : isHotelPaused
                  ? 'Property Temporarily Not Accepting Online Bookings'
                  : 'Direct Enquiry / Call-to-Book Listing'}
            </h2>
            <p className="text-xs leading-relaxed text-[var(--ps-text-muted)]">
              {!isModuleEnabled
                ? hubPauseMessage ||
                  'Online instant bookings are currently paused in this hub. You can still contact this property directly.'
                : isHotelPaused
                  ? 'This property has temporarily paused online reservations. Please call or send an enquiry directly on the listing page.'
                  : 'Instant online slot checkout is not active for this listing yet. Please call or send a direct enquiry from the listing profile.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
            {listing.phone && (
              <a
                href={`tel:${listing.phone.replace(/[^+\d]/g, '')}`}
                className={`inline-flex h-9 items-center gap-1.5 rounded-xl px-4 text-xs font-bold shadow-xs transition ${primaryBtnClass}`}
              >
                <Phone className="h-3.5 w-3.5" />
                <span>Call {listing.phone}</span>
              </a>
            )}
            <Link
              href={`/listing/${encodeURIComponent(listing.id)}`}
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-4 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Return to Listing &amp; Enquire</span>
            </Link>
          </div>
        </div>
      ) : confirmedState ? (
        /* BOOKING CONFIRMED VIEW + CROSS-VERTICAL FLYWHEEL */
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          data-testid="booking-confirmed-card"
          className="space-y-4"
        >
          <div className="rounded-2xl border border-emerald-500/35 bg-[var(--ps-surface)] p-6 shadow-xs space-y-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-start gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400">
                  <CheckCircle2 className="h-6 w-6" />
                </div>
                <div>
                  <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
                    {confirmedState.paymentPendingReview
                      ? 'Payment Proof Submitted · Verification Pending'
                      : 'Booking Confirmed'}
                  </span>
                  <h2 className="mt-1 text-lg font-extrabold text-[var(--ps-text)]">
                    {listing.title}
                  </h2>
                  <p className="text-xs text-[var(--ps-text-muted)]">
                    Code:{' '}
                    <span className="font-mono font-extrabold text-[var(--ps-text)]">
                      {confirmedState.booking.booking_code}
                    </span>{' '}
                    · {formatIstDateTime(confirmedState.booking.start_at)} →{' '}
                    {formatIstDateTime(confirmedState.booking.end_at)}
                  </p>
                </div>
              </div>
            </div>

            {/* 4-Digit Check-In OTP Box */}
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/8 p-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-emerald-600 text-white">
                  <KeyRound className="h-5 w-5" />
                </div>
                <div>
                  <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-800 dark:text-emerald-300">
                    4-Digit Check-In OTP
                  </p>
                  <p className="font-mono text-2xl font-black tracking-[0.25em] text-[var(--ps-text)]">
                    {confirmedState.checkinOtp}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void handleCopyOtp(confirmedState.checkinOtp)}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-emerald-500/40 bg-[var(--ps-surface)] px-3.5 text-xs font-bold text-emerald-800 hover:bg-emerald-500/10 dark:text-emerald-200 transition-colors"
              >
                {copiedOtp ? (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    <span>Copied</span>
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    <span>Copy OTP</span>
                  </>
                )}
              </button>
            </div>

            {/* Check-in Instructions */}
            <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3.5 text-xs text-[var(--ps-text-muted)] space-y-1.5">
              <p className="font-bold text-[var(--ps-text)]">
                Check-In Instructions
              </p>
              <p>
                Share this 4-digit OTP at the{' '}
                {vertical === 'hotel_stay' ? 'reception desk' : 'venue counter'}{' '}
                upon arrival to verify check-in.
                {Number(confirmedState.booking.balance_at_venue_inr || 0) > 0 && (
                  <>
                    {' '}
                    Remaining balance of{' '}
                    <strong className="font-mono text-[var(--ps-text)]">
                      {formatBookingInr(
                        Number(confirmedState.booking.balance_at_venue_inr)
                      )}
                    </strong>{' '}
                    is payable directly at the venue.
                  </>
                )}
              </p>
              {vertical === 'hotel_stay' && hotelProfile?.id_requirement_note && (
                <p className="text-[11px] font-medium text-indigo-700 dark:text-indigo-300">
                  ID Note: {hotelProfile.id_requirement_note}
                </p>
              )}
            </div>

            <div className="flex flex-wrap items-center gap-2.5">
              <Link
                href="/activity?tab=bookings"
                className={`inline-flex h-9 items-center gap-1.5 rounded-xl px-4 text-xs font-bold shadow-xs transition ${primaryBtnClass}`}
              >
                <span>Track in My Activity</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
              <Link
                href={`/listing/${encodeURIComponent(listing.id)}`}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-4 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]"
              >
                <span>Back to Listing</span>
              </Link>
            </div>
          </div>

          {/* Cross-Vertical Flywheel Strip */}
          <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-2.5">
            <p className="text-[10px] font-extrabold uppercase tracking-wider text-[var(--ps-text-muted)]">
              Helpful Next Steps on DD oodle
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {vertical === 'booking_venue' ? (
                <>
                  <Link
                    href="/explore?category=printing_digital_services"
                    className="flex items-center justify-between gap-2 rounded-xl border border-teal-500/25 bg-teal-500/8 px-3.5 py-2.5 text-xs font-semibold text-teal-900 hover:bg-teal-500/12 dark:text-teal-200 transition-colors"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <Printer className="h-4 w-4 shrink-0 text-teal-600 dark:text-teal-400" />
                      <span className="line-clamp-2">
                        Planning an event? Order Flex Banners &amp; Invites via
                        Print &amp; Digital
                      </span>
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0" />
                  </Link>
                  <Link
                    href="/explore?category=vehicles_rentals"
                    className="flex items-center justify-between gap-2 rounded-xl border border-amber-500/25 bg-amber-500/8 px-3.5 py-2.5 text-xs font-semibold text-amber-900 hover:bg-amber-500/12 dark:text-amber-200 transition-colors"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <Car className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                      <span className="line-clamp-2">
                        Need group transport? Browse Scheduled Vehicles
                      </span>
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0" />
                  </Link>
                </>
              ) : (
                <>
                  <Link
                    href="/explore?category=vehicles_rentals"
                    className="flex items-center justify-between gap-2 rounded-xl border border-amber-500/25 bg-amber-500/8 px-3.5 py-2.5 text-xs font-semibold text-amber-900 hover:bg-amber-500/12 dark:text-amber-200 transition-colors"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <Car className="h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                      <span className="line-clamp-2">
                        Need stand pickup or hill sightseeing? Book a Scheduled
                        Vehicle
                      </span>
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0" />
                  </Link>
                  <Link
                    href="/explore"
                    className="flex items-center justify-between gap-2 rounded-xl border border-indigo-500/25 bg-indigo-500/8 px-3.5 py-2.5 text-xs font-semibold text-indigo-900 hover:bg-indigo-500/12 dark:text-indigo-200 transition-colors"
                  >
                    <span className="flex items-center gap-2 min-w-0">
                      <Compass className="h-4 w-4 shrink-0 text-indigo-600 dark:text-indigo-400" />
                      <span className="line-clamp-2">
                        Explore local spots &amp; dining nearby
                      </span>
                    </span>
                    <ArrowRight className="h-3.5 w-3.5 shrink-0" />
                  </Link>
                </>
              )}
            </div>
          </div>
        </motion.div>
      ) : (
        /* ACTIVE BOOKING FLOW (2-Column Desktop / Stacked Mobile) */
        <form
          onSubmit={handleSubmitBooking}
          className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start"
        >
          {/* LEFT COLUMN: Selection Flow */}
          <div className="lg:col-span-7 space-y-4">
            {vertical === 'booking_venue' ? (
              /* MODE 1: VENUE & TURF BOOKING */
              <>
                {/* 1. Resource Picker */}
                <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3 shadow-2xs">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-xs font-extrabold uppercase tracking-wider text-[var(--ps-text-muted)]">
                      1. Choose Space / Resource
                    </h2>
                    <span className="text-[11px] font-semibold text-[var(--ps-text-muted)]">
                      {resources.length}{' '}
                      {resources.length === 1 ? 'option' : 'options'}
                    </span>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {resources.map((res) => {
                      const active = res.id === selectedResource?.id;
                      const unitLbl = getBookingUnitShortLabel(res.booking_unit);
                      return (
                        <button
                          key={res.id}
                          type="button"
                          onClick={() => setSelectedResourceId(res.id)}
                          className={`rounded-xl border p-3 text-left transition-all ${
                            active
                              ? 'border-emerald-600 bg-emerald-500/10 ring-1 ring-emerald-500/30'
                              : 'border-[var(--ps-border)] bg-[var(--ps-bg)] hover:border-emerald-500/40'
                          }`}
                        >
                          <div className="flex items-start justify-between gap-2">
                            <p className="text-xs font-extrabold text-[var(--ps-text)] line-clamp-1">
                              {res.name}
                            </p>
                            {active && (
                              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                            )}
                          </div>
                          {res.description && (
                            <p className="mt-1 text-[11px] text-[var(--ps-text-muted)] line-clamp-2">
                              {res.description}
                            </p>
                          )}
                          <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px]">
                            <span className="font-mono font-extrabold text-emerald-700 dark:text-emerald-300 tabular-nums">
                              {formatBookingInr(res.base_rate_inr)}/{unitLbl}
                            </span>
                            {res.peak_rate_inr !== null &&
                              res.peak_start_hour !== null && (
                                <span className="inline-flex items-center gap-0.5 rounded bg-amber-500/15 px-1.5 py-0.5 font-bold text-amber-800 dark:text-amber-300">
                                  <Sparkles className="h-2.5 w-2.5" />
                                  Peak {formatBookingInr(res.peak_rate_inr)}
                                </span>
                              )}
                            <span className="inline-flex items-center gap-0.5 text-[var(--ps-text-muted)] font-semibold">
                              <Users className="h-3 w-3" />
                              Up to {res.max_guests}
                            </span>
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </section>

                {/* 2. Date & Slot / Block Picker */}
                {selectedResource && (
                  <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3 shadow-2xs">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h2 className="text-xs font-extrabold uppercase tracking-wider text-[var(--ps-text-muted)]">
                        2. Select Date &amp;{' '}
                        {selectedResource.booking_unit === 'hourly' ||
                        selectedResource.booking_unit === 'slot'
                          ? 'Time Slot(s)'
                          : 'Duration'}
                      </h2>
                      <input
                        type="date"
                        min={todayYmd}
                        value={venueDate}
                        onChange={(e) => setVenueDate(e.target.value)}
                        className="h-8 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-xs font-bold text-[var(--ps-text)] focus:border-emerald-500 focus:outline-none"
                      />
                    </div>

                    {isLoadingAvailability ? (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {Array.from({ length: 6 }).map((_, i) => (
                          <div
                            key={i}
                            className="h-14 animate-pulse rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)]"
                          />
                        ))}
                      </div>
                    ) : availabilityError ? (
                      <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2">
                        <AlertCircle className="h-4 w-4 shrink-0" />
                        <span>{availabilityError}</span>
                      </div>
                    ) : selectedResource.booking_unit === 'hourly' ||
                      selectedResource.booking_unit === 'slot' ? (
                      <div className="space-y-2.5">
                        <div className="flex flex-wrap items-center gap-3 text-[10px] text-[var(--ps-text-muted)]">
                          <span className="inline-flex items-center gap-1">
                            <span className="h-2.5 w-2.5 rounded border border-emerald-500 bg-emerald-500/20" />
                            Available
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <span className="h-2.5 w-2.5 rounded bg-emerald-600" />
                            Selected
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <Sparkles className="h-3 w-3 text-amber-500" />
                            Peak / Floodlight
                          </span>
                          <span className="inline-flex items-center gap-1">
                            <span className="h-2.5 w-2.5 rounded bg-slate-300 dark:bg-slate-700" />
                            Booked / Past
                          </span>
                        </div>

                        {liveSlots.length === 0 ? (
                          <p className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 text-xs text-[var(--ps-text-muted)]">
                            No slots available for this date. Try selecting the next day.
                          </p>
                        ) : (
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                            {liveSlots.map((slot, idx) => {
                              const isSelectedSlot =
                                selectedSlotRange !== null &&
                                idx >= selectedSlotRange.startIdx &&
                                idx <= selectedSlotRange.endIdx;
                              return (
                                <button
                                  key={slot.startAt}
                                  type="button"
                                  disabled={!slot.isAvailable}
                                  onClick={() => handleSlotClick(idx)}
                                  className={`rounded-xl border px-2.5 py-2 text-left transition-all ${
                                    isSelectedSlot
                                      ? 'border-emerald-600 bg-emerald-600 text-white shadow-xs'
                                      : slot.isAvailable
                                        ? 'border-emerald-500/35 bg-emerald-500/8 text-[var(--ps-text)] hover:bg-emerald-500/15'
                                        : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] opacity-50 cursor-not-allowed'
                                  }`}
                                >
                                  <span className="block text-[11px] font-bold leading-tight">
                                    {slot.label}
                                  </span>
                                  <div className="mt-1 flex items-center justify-between gap-1 text-[10px]">
                                    <span className="font-mono font-extrabold tabular-nums">
                                      {formatBookingInr(slot.rateInr)}
                                    </span>
                                    {slot.isAvailable ? (
                                      slot.isPeak ? (
                                        <span
                                          className={`inline-flex items-center gap-0.5 rounded px-1 py-0.2 text-[8px] font-extrabold uppercase ${
                                            isSelectedSlot
                                              ? 'bg-white/20 text-white'
                                              : 'bg-amber-500/20 text-amber-800 dark:text-amber-300'
                                          }`}
                                        >
                                          <Sparkles className="h-2.5 w-2.5" />
                                          Peak
                                        </span>
                                      ) : (
                                        <span
                                          className={`text-[9px] font-semibold ${
                                            isSelectedSlot
                                              ? 'text-emerald-100'
                                              : 'text-emerald-700 dark:text-emerald-300'
                                          }`}
                                        >
                                          Base
                                        </span>
                                      )
                                    ) : (
                                      <span className="text-[9px]">
                                        {slot.isPast ? 'Past' : 'Booked'}
                                      </span>
                                    )}
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        )}
                        <p className="text-[11px] text-[var(--ps-text-muted)]">
                          Tip: Click one slot or click a second open slot to book a contiguous range.
                        </p>
                      </div>
                    ) : selectedResource.booking_unit === 'half_day' ? (
                      <div className="grid grid-cols-2 gap-2.5">
                        {(['morning', 'evening'] as const).map((blk) => (
                          <button
                            key={blk}
                            type="button"
                            onClick={() => setHalfDayBlock(blk)}
                            className={`h-11 rounded-xl border px-3 text-xs font-bold capitalize transition-all ${
                              halfDayBlock === blk
                                ? 'border-emerald-600 bg-emerald-600 text-white'
                                : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text)]'
                            }`}
                          >
                            {blk === 'morning'
                              ? 'Morning Half-Day'
                              : 'Evening Half-Day'}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3">
                        <div>
                          <p className="text-xs font-bold text-[var(--ps-text)]">
                            Number of{' '}
                            {selectedResource.booking_unit === 'weekly'
                              ? 'Weeks'
                              : 'Days'}
                          </p>
                          <p className="text-[11px] text-[var(--ps-text-muted)]">
                            {activeResourceAvail?.isAvailable === false
                              ? 'Already booked for these dates'
                              : 'Available for selected dates'}
                          </p>
                        </div>
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              setVenueDurationUnits((n) => Math.max(1, n - 1))
                            }
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text)]"
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <span className="w-8 text-center font-mono text-sm font-extrabold tabular-nums">
                            {venueDurationUnits}
                          </span>
                          <button
                            type="button"
                            onClick={() =>
                              setVenueDurationUnits((n) => Math.min(7, n + 1))
                            }
                            className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text)]"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    )}
                  </section>
                )}

                {/* 3. Add-Ons Checklist */}
                {selectedResource && selectedResource.addons.length > 0 && (
                  <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-2.5 shadow-2xs">
                    <h2 className="text-xs font-extrabold uppercase tracking-wider text-[var(--ps-text-muted)]">
                      3. Optional Add-Ons
                    </h2>
                    <div className="flex flex-wrap gap-2">
                      {selectedResource.addons.map((addon) => {
                        const checked = selectedAddonKeys.includes(addon.key);
                        return (
                          <button
                            key={addon.key}
                            type="button"
                            onClick={() => toggleAddon(addon.key)}
                            className={`inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition-all ${
                              checked
                                ? 'border-emerald-600 bg-emerald-500/12 text-emerald-800 dark:text-emerald-200'
                                : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text)] hover:border-emerald-500/40'
                            }`}
                          >
                            <span
                              className={`inline-flex h-4 w-4 items-center justify-center rounded border ${
                                checked
                                  ? 'border-emerald-600 bg-emerald-600 text-white'
                                  : 'border-[var(--ps-border)]'
                              }`}
                            >
                              {checked && <Check className="h-3 w-3" />}
                            </span>
                            <span>{addon.label}</span>
                            <span className="font-mono text-[11px] font-extrabold text-emerald-700 dark:text-emerald-300">
                              +{formatBookingInr(addon.price_inr)}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </section>
                )}
              </>
            ) : (
              /* MODE 2: HOTEL & HOMESTAY BOOKING */
              <>
                {/* 1. Stay Dates & Party Bar */}
                <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3 shadow-2xs">
                  <h2 className="text-xs font-extrabold uppercase tracking-wider text-[var(--ps-text-muted)]">
                    1. Stay Dates &amp; Guests
                  </h2>
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
                    <label className="space-y-1">
                      <span className="block text-[10px] font-bold uppercase text-[var(--ps-text-muted)]">
                        Check-In
                      </span>
                      <input
                        type="date"
                        min={todayYmd}
                        value={checkIn}
                        onChange={(e) => {
                          const next = e.target.value;
                          setCheckIn(next);
                          if (next >= checkOut) {
                            setCheckOut(addDaysToYmd(next, 1));
                          }
                        }}
                        className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-xs font-bold text-[var(--ps-text)] focus:border-indigo-500 focus:outline-none"
                      />
                    </label>
                    <label className="space-y-1">
                      <span className="block text-[10px] font-bold uppercase text-[var(--ps-text-muted)]">
                        Check-Out ({diffYmdDays(checkIn, checkOut)}n)
                      </span>
                      <input
                        type="date"
                        min={addDaysToYmd(checkIn, 1)}
                        value={checkOut}
                        onChange={(e) => {
                          const next = e.target.value;
                          setCheckOut(
                            next <= checkIn ? addDaysToYmd(checkIn, 1) : next
                          );
                        }}
                        className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-xs font-bold text-[var(--ps-text)] focus:border-indigo-500 focus:outline-none"
                      />
                    </label>
                    <div className="space-y-1">
                      <span className="block text-[10px] font-bold uppercase text-[var(--ps-text-muted)]">
                        Rooms
                      </span>
                      <div className="flex h-9 items-center justify-between rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2">
                        <button
                          type="button"
                          onClick={() => setRoomsCount((r) => Math.max(1, r - 1))}
                          className="p-1 text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]"
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                        <span className="font-mono text-xs font-extrabold tabular-nums">
                          {roomsCount}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setRoomsCount((r) =>
                              Math.min(
                                Math.max(1, remainingUnitsForSelected),
                                r + 1
                              )
                            )
                          }
                          className="p-1 text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="space-y-1">
                      <span className="block text-[10px] font-bold uppercase text-[var(--ps-text-muted)]">
                        Guests
                      </span>
                      <div className="flex h-9 items-center justify-between rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2">
                        <button
                          type="button"
                          onClick={() => setGuestsCount((g) => Math.max(1, g - 1))}
                          className="p-1 text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]"
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                        <span className="font-mono text-xs font-extrabold tabular-nums">
                          {guestsCount}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setGuestsCount((g) =>
                              Math.min(
                                Math.max(
                                  1,
                                  (selectedResource?.max_guests || 2) * roomsCount
                                ),
                                g + 1
                              )
                            )
                          }
                          className="p-1 text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </section>

                {/* 2. Live Room Inventory Cards */}
                <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3 shadow-2xs">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="text-xs font-extrabold uppercase tracking-wider text-[var(--ps-text-muted)]">
                      2. Choose Room Type
                    </h2>
                    {isLoadingAvailability && (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-indigo-600 dark:text-indigo-300">
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Checking live rooms...
                      </span>
                    )}
                  </div>

                  {availabilityError && (
                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3 text-xs text-amber-800 dark:text-amber-300 flex items-center gap-2">
                      <AlertCircle className="h-4 w-4 shrink-0" />
                      <span>{availabilityError}</span>
                    </div>
                  )}

                  <div className="space-y-3">
                    {resources.map((room) => {
                      const avail = availabilityByResourceId.get(room.id);
                      const rem =
                        avail && typeof avail.remainingUnits === 'number'
                          ? avail.remainingUnits
                          : room.total_units;
                      const isSoldOut = rem <= 0;
                      const isSelected = room.id === selectedResource?.id;
                      const roomPhoto = room.photos?.[0]?.trim() || '';

                      return (
                        <div
                          key={room.id}
                          onClick={() => {
                            if (!isSoldOut) setSelectedResourceId(room.id);
                          }}
                          className={`rounded-xl border p-3 transition-all ${
                            isSoldOut
                              ? 'border-[var(--ps-border)] bg-[var(--ps-bg)] opacity-60 cursor-not-allowed'
                              : isSelected
                                ? 'border-indigo-600 bg-indigo-500/8 ring-1 ring-indigo-500/30 cursor-pointer'
                                : 'border-[var(--ps-border)] bg-[var(--ps-bg)] hover:border-indigo-500/40 cursor-pointer'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            {roomPhoto && (
                              <div className="relative h-16 w-20 shrink-0 overflow-hidden rounded-lg border border-[var(--ps-border)] bg-slate-900">
                                <Image
                                  loader={supabaseMediaImageLoader}
                                  unoptimized={false}
                                  src={roomPhoto}
                                  alt={room.name}
                                  fill
                                  sizes="80px"
                                  referrerPolicy="no-referrer"
                                  className="object-cover"
                                />
                              </div>
                            )}
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="text-sm font-extrabold text-[var(--ps-text)]">
                                    {room.name}
                                  </p>
                                  <p className="mt-0.5 flex items-center gap-2 text-[11px] text-[var(--ps-text-muted)]">
                                    <span className="inline-flex items-center gap-1 font-semibold">
                                      <Users className="h-3 w-3" />
                                      Up to {room.max_guests} guests / room
                                    </span>
                                  </p>
                                </div>
                                <div className="text-right shrink-0">
                                  <span className="block font-mono text-sm font-extrabold text-indigo-700 dark:text-indigo-300 tabular-nums">
                                    {formatBookingInr(room.base_rate_inr)}
                                  </span>
                                  <span className="block text-[10px] text-[var(--ps-text-muted)]">
                                    per night
                                  </span>
                                </div>
                              </div>

                              {room.description && (
                                <p className="mt-1 text-[11px] text-[var(--ps-text-muted)] line-clamp-2">
                                  {room.description}
                                </p>
                              )}

                              <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                                <span
                                  className={`inline-flex items-center rounded-md px-2 py-0.5 text-[10px] font-bold ${
                                    isSoldOut
                                      ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300'
                                      : rem === 1
                                        ? 'bg-amber-500/15 text-amber-800 dark:text-amber-300'
                                        : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                  }`}
                                >
                                  {isSoldOut
                                    ? 'Sold Out for dates'
                                    : rem === 1
                                      ? 'Only 1 left!'
                                      : `${rem} rooms left`}
                                </span>

                                {isSelected && !isSoldOut && (
                                  <span className="inline-flex items-center gap-1 text-[11px] font-bold text-indigo-700 dark:text-indigo-300">
                                    <CheckCircle2 className="h-3.5 w-3.5" />
                                    Selected
                                  </span>
                                )}
                              </div>

                              {/* Room Add-Ons when selected */}
                              {isSelected &&
                                !isSoldOut &&
                                room.addons.length > 0 && (
                                  <div
                                    onClick={(e) => e.stopPropagation()}
                                    className="mt-3 pt-2.5 border-t border-[var(--ps-border)]/70 flex flex-wrap gap-1.5"
                                  >
                                    {room.addons.map((addon) => {
                                      const checked = selectedAddonKeys.includes(
                                        addon.key
                                      );
                                      return (
                                        <button
                                          key={addon.key}
                                          type="button"
                                          onClick={() => toggleAddon(addon.key)}
                                          className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-semibold transition-all ${
                                            checked
                                              ? 'border-indigo-600 bg-indigo-600 text-white'
                                              : 'border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text)]'
                                          }`}
                                        >
                                          <span>{addon.label}</span>
                                          <span className="font-mono font-bold">
                                            +{formatBookingInr(addon.price_inr)}
                                            {addon.per_unit ? '/night' : ''}
                                          </span>
                                        </button>
                                      );
                                    })}
                                  </div>
                                )}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </section>

                {/* 3. Hospitality Rules Strip */}
                {hotelProfile && (
                  <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3 shadow-2xs">
                    <h2 className="text-xs font-extrabold uppercase tracking-wider text-[var(--ps-text-muted)]">
                      Hospitality Rules &amp; Amenities
                    </h2>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-xs">
                      <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 space-y-1">
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase text-indigo-600 dark:text-indigo-400">
                          <Clock className="h-3 w-3" />
                          Check-In / Check-Out
                        </span>
                        <p className="font-bold text-[var(--ps-text)]">
                          In: {hotelProfile.check_in_time} · Out:{' '}
                          {hotelProfile.check_out_time}
                        </p>
                      </div>
                      <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 space-y-1">
                        <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase text-indigo-600 dark:text-indigo-400">
                          <FileCheck2 className="h-3 w-3" />
                          Photo ID &amp; Reception Note
                        </span>
                        <p className="text-[11px] font-medium text-[var(--ps-text)]">
                          {hotelProfile.id_requirement_note}
                        </p>
                      </div>
                    </div>

                    <p className="text-[11px] text-[var(--ps-text-muted)]">
                      <strong className="text-[var(--ps-text)]">
                        Cancellation Policy:
                      </strong>{' '}
                      {hotelProfile.cancellation_policy}
                    </p>

                    {hotelAmenitiesList.length > 0 && (
                      <div className="flex flex-wrap gap-1.5 pt-1">
                        {hotelAmenitiesList.map((a) => (
                          <span
                            key={a.key}
                            className="inline-flex items-center gap-1 rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-0.5 text-[10px] font-semibold text-[var(--ps-text)]"
                          >
                            <CheckCircle2 className="h-3 w-3 text-emerald-600 dark:text-emerald-400" />
                            {a.label}
                          </span>
                        ))}
                      </div>
                    )}
                  </section>
                )}
              </>
            )}
          </div>

          {/* RIGHT COLUMN: Guest Details & Itemized Quote Checkout */}
          <div className="lg:col-span-5 space-y-4 lg:sticky lg:top-[128px]">
            <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-4 shadow-xs">
              <div className="flex items-center justify-between gap-2 border-b border-[var(--ps-border)] pb-3">
                <h2 className="text-sm font-extrabold text-[var(--ps-text)]">
                  Booking Summary &amp; Checkout
                </h2>
                <span className="inline-flex items-center gap-1 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                  <ShieldCheck className="h-3.5 w-3.5" />
                  DD oodle Escrow
                </span>
              </div>

              {/* Guest Info */}
              <div className="space-y-2.5">
                <label className="block space-y-1">
                  <span className="text-[11px] font-bold text-[var(--ps-text)]">
                    Guest / Booker Full Name *
                  </span>
                  <input
                    type="text"
                    required
                    value={guestName}
                    onChange={(e) => setGuestName(e.target.value)}
                    placeholder="Your full name"
                    className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs font-medium text-[var(--ps-text)] focus:border-theme-primary focus:outline-none"
                  />
                </label>

                <div className="block space-y-1">
                  <PhoneInput
                    label="Mobile / WhatsApp Number"
                    variant="sm"
                    value={guestPhone}
                    onChange={setGuestPhone}
                    placeholder="98620 00000"
                  />
                </div>

                <label className="block space-y-1">
                  <span className="text-[11px] font-bold text-[var(--ps-text-muted)]">
                    Special Request / Arrival Note (Optional)
                  </span>
                  <input
                    type="text"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder={
                      vertical === 'hotel_stay'
                        ? 'e.g., Late arrival around 8 PM'
                        : 'e.g., Need football bibs or extra chairs'
                    }
                    className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs font-medium text-[var(--ps-text)] focus:border-theme-primary focus:outline-none"
                  />
                </label>
              </div>

              {/* Itemized Quote Breakdown */}
              {liveQuote ? (
                <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3.5 space-y-2 text-xs">
                  <div className="pb-2 border-b border-[var(--ps-border)]/70">
                    <p className="font-extrabold text-[var(--ps-text)]">
                      {liveQuote.resource_name}
                    </p>
                    <p className="text-[11px] text-[var(--ps-text-muted)]">
                      {selectedWindow.summaryLabel}
                      {vertical === 'hotel_stay'
                        ? ` · ${roomsCount} ${
                            roomsCount === 1 ? 'room' : 'rooms'
                          }, ${guestsCount} ${
                            guestsCount === 1 ? 'guest' : 'guests'
                          }`
                        : ''}
                    </p>
                  </div>

                  <div className="flex items-center justify-between">
                    <span className="text-[var(--ps-text-muted)]">
                      Base / Rate Subtotal ({liveQuote.duration_label})
                    </span>
                    <span className="font-mono font-bold text-[var(--ps-text)] tabular-nums">
                      {formatBookingInr(liveQuote.subtotal_base_inr)}
                    </span>
                  </div>

                  {liveQuote.addons_total_inr > 0 && (
                    <div className="flex items-center justify-between">
                      <span className="text-[var(--ps-text-muted)]">
                        Selected Add-Ons ({liveQuote.selected_addons.length})
                      </span>
                      <span className="font-mono font-bold text-[var(--ps-text)] tabular-nums">
                        +{formatBookingInr(liveQuote.addons_total_inr)}
                      </span>
                    </div>
                  )}

                  {canPayFullUpfront && (
                    <label className="flex items-center justify-between gap-2 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 py-2 cursor-pointer">
                      <span className="text-[11px] font-bold text-[var(--ps-text)]">
                        Pay 100% Upfront (Zero balance at venue)
                      </span>
                      <input
                        type="checkbox"
                        checked={payFullUpfront}
                        onChange={(e) => setPayFullUpfront(e.target.checked)}
                        className="h-4 w-4 accent-emerald-600"
                      />
                    </label>
                  )}

                  <div className="pt-2 border-t border-[var(--ps-border)]/70 space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-[var(--ps-text)]">
                        Advance via Escrow ({liveQuote.advance_percent}%)
                      </span>
                      <span className="font-mono font-bold text-[var(--ps-text)] tabular-nums">
                        {formatBookingInr(liveQuote.advance_amount_inr)}
                      </span>
                    </div>

                    {liveQuote.convenience_fee_inr > 0 && (
                      <div className="flex items-center justify-between text-[11px] text-[var(--ps-text-muted)]">
                        <span>Platform Escrow Fee (3%, max ₹149)</span>
                        <span className="font-mono font-semibold tabular-nums">
                          +{formatBookingInr(liveQuote.convenience_fee_inr)}
                        </span>
                      </div>
                    )}

                    <div className="flex items-center justify-between text-[11px] text-[var(--ps-text-muted)]">
                      <span>Balance Payable at Venue</span>
                      <span className="font-mono font-bold text-[var(--ps-text)] tabular-nums">
                        {formatBookingInr(liveQuote.balance_at_venue_inr)}
                      </span>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-[var(--ps-border)] text-sm font-extrabold">
                      <span>Pay Now</span>
                      <span className="font-mono text-emerald-700 dark:text-emerald-300 tabular-nums">
                        {liveQuote.pay_now_inr > 0
                          ? formatBookingInr(liveQuote.pay_now_inr)
                          : '₹0 (Pay at Counter)'}
                      </span>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-bg)] p-3.5 text-center text-xs text-[var(--ps-text-muted)]">
                  {vertical === 'hotel_stay'
                    ? 'Select an available room type and stay dates to preview your itemized quote.'
                    : 'Select a time slot or date above to preview your itemized quote.'}
                </div>
              )}

              {submitError && (
                <div className="rounded-xl border border-rose-500/35 bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-700 dark:text-rose-300 flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{submitError}</span>
                </div>
              )}

              {!user ? (
                <Link
                  href={`/login?next=${encodeURIComponent(
                    `/listing/${listing.id}/book`
                  )}`}
                  className={`inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-xl px-4 text-xs font-bold shadow-xs transition ${primaryBtnClass}`}
                >
                  <span>Sign In to Confirm Booking</span>
                  <ArrowRight className="h-4 w-4" />
                </Link>
              ) : (
                <button
                  type="submit"
                  disabled={isSubmitting || !liveQuote}
                  data-testid="booking-submit-btn"
                  className={`inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl px-4 text-xs font-bold shadow-xs transition disabled:opacity-50 ${primaryBtnClass}`}
                >
                  {isSubmitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      <span>Locking Slot...</span>
                    </>
                  ) : liveQuote && liveQuote.pay_now_inr > 0 ? (
                    <>
                      <span>
                        Lock Slot &amp; Pay{' '}
                        {formatBookingInr(liveQuote.pay_now_inr)}
                      </span>
                      <ArrowRight className="h-4 w-4" />
                    </>
                  ) : (
                    <>
                      <span>Confirm Instant Booking</span>
                      <ArrowRight className="h-4 w-4" />
                    </>
                  )}
                </button>
              )}
            </section>
          </div>
        </form>
      )}

      {/* UniversalPaymentModal (z-[90]) for Escrow Advance / Full Payment */}
      <UniversalPaymentModal
        open={Boolean(activePaymentIntent)}
        intent={activePaymentIntent}
        title={
          vertical === 'hotel_stay'
            ? `Stay Booking · ${listing.title}`
            : `Slot Booking · ${listing.title}`
        }
        subtitle={
          pendingConfirmationDraft
            ? `Ref ${pendingConfirmationDraft.booking.booking_code} · ${selectedWindow.summaryLabel}`
            : listing.locality
        }
        onSubmitted={(updatedIntent) => {
          setActivePaymentIntent(null);
          if (pendingConfirmationDraft) {
            setConfirmedState({
              booking: pendingConfirmationDraft.booking,
              checkinOtp: pendingConfirmationDraft.checkinOtp,
              paymentPendingReview: updatedIntent.status === 'pending_manual',
            });
            setPendingConfirmationDraft(null);
          }
        }}
        onClose={() => {
          setActivePaymentIntent(null);
        }}
      />
    </div>
  );
}

export default BookingFlowClient;
