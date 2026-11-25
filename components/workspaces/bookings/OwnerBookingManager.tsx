'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { PhoneInput } from '@/components/ui/PhoneInput';
import {
  AlertCircle,
  BadgeCheck,
  BedDouble,
  CalendarDays,
  CheckCircle2,
  Clock,
  CreditCard,
  Edit3,
  KeyRound,
  Layers,
  Loader2,
  Lock,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  Unlock,
  Wallet,
  X,
} from 'lucide-react';
import { UniversalPaymentModal } from '@/components/payments/UniversalPaymentModal';
import { useConfirmDialog } from '@/components/ui/ConfirmActionModal';
import {
  CustomSelectModal,
  type CustomSelectOption,
} from '@/components/ui/CustomSelectModal';
import { FormModal } from '@/components/ui/FormModal';
import {
  ResponsiveTableScroll,
  WorkspaceTableToolbar,
} from '@/components/ui/ResponsiveTableWrapper';
import {
  QuickImageUploadField,
  discardUploadedTempPaths,
} from '@/components/workspaces/shared/QuickImageUploadField';
import { useAuth } from '@/lib/store';
import {
  BOOKING_UNIT_FULL_LABELS,
  formatBookingInr,
  formatIstDateTime,
  getAmenityLabel,
  getBookingUnitShortLabel,
  getTodayIstYmd,
  HOTEL_STAY_TYPE_LABELS,
} from '@/lib/bookings/client-helpers';
import type {
  BookingUnit,
  HotelAmenities,
  HotelStayType,
  ListingBookingResource,
  ListingHotelProfile,
  ResourceAddon,
  ResourceBooking,
  ResourceVertical,
} from '@/lib/bookings/types';
import { useAppStatus } from '@/lib/hooks/useAppStatus';
import type { PaymentIntentRecord } from '@/lib/payments/types';
import { getLimit } from '@/lib/subscriptions/feature-catalog';
import { useEffectiveEntitlements } from '@/lib/subscriptions/useEffectiveEntitlements';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';

export interface BookingManagerListingRef {
  id: string;
  title: string;
  locality?: string;
  hubId?: string | null;
  listingVertical?: string | null;
}

export interface OwnerBookingManagerProps {
  listings: BookingManagerListingRef[];
  activeListingId?: string;
  isStaffMode?: boolean;
  onNotice?: (notice: {
    type: 'success' | 'error' | 'info';
    text: string;
  }) => void;
}

type BookingSubTab = 'live_desk' | 'setup' | 'settlements';
type DeskStatusFilter =
  | 'all'
  | 'confirmed'
  | 'checked_in'
  | 'blocked'
  | 'pending_payment'
  | 'closed';
type SettlementStatusFilter =
  | 'all'
  | 'locked'
  | 'eligible'
  | 'settled'
  | 'reversed';

interface SubscriptionPlanRow {
  id: string;
  slug: string;
  name: string;
  price_inr: number;
  duration_days: number;
  plan_scope: string;
}

interface HydratedBookingRow extends ResourceBooking {
  resourceName: string;
}

interface BookingSettlementRow {
  id: string;
  resource_booking_id: string | null;
  gross_amount_inr: number;
  platform_fee_inr: number;
  net_payout_inr: number;
  status: string;
  payout_reference: string | null;
  settled_at: string | null;
  created_at: string;
  booking_code: string;
}

const BOOKING_UNIT_OPTIONS: CustomSelectOption[] = (
  Object.entries(BOOKING_UNIT_FULL_LABELS) as Array<[BookingUnit, string]>
).map(([value, label]) => ({ value, label }));

const STAY_TYPE_OPTIONS: CustomSelectOption[] = (
  Object.entries(HOTEL_STAY_TYPE_LABELS) as Array<[HotelStayType, string]>
).map(([value, label]) => ({ value, label }));

const AMENITY_KEYS: ReadonlyArray<string> = [
  'wifi',
  'hot_water',
  'parking',
  'power_backup',
  'ac',
  'heater',
  'in_house_kitchen',
  'early_checkin',
];

function getStatusBadge(status: string): { label: string; cls: string } {
  switch (status) {
    case 'confirmed':
      return {
        label: 'Confirmed',
        cls: 'border-emerald-500/35 bg-emerald-500/12 text-emerald-800 dark:text-emerald-300',
      };
    case 'checked_in':
      return {
        label: 'Checked In',
        cls: 'border-sky-500/35 bg-sky-500/12 text-sky-800 dark:text-sky-300',
      };
    case 'blocked':
      return {
        label: 'Walk-In Block',
        cls: 'border-indigo-500/35 bg-indigo-500/12 text-indigo-800 dark:text-indigo-300',
      };
    case 'pending_payment':
      return {
        label: 'Pending Pay',
        cls: 'border-amber-500/35 bg-amber-500/12 text-amber-800 dark:text-amber-300',
      };
    case 'completed':
      return {
        label: 'Completed',
        cls: 'border-slate-400/40 bg-slate-500/10 text-slate-700 dark:text-slate-300',
      };
    case 'cancelled':
    case 'no_show':
      return {
        label: status === 'no_show' ? 'No Show' : 'Cancelled',
        cls: 'border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300',
      };
    default:
      return {
        label: status.replace(/_/g, ' '),
        cls: 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)]',
      };
  }
}

export function OwnerBookingManager({
  listings,
  activeListingId,
  isStaffMode = false,
  onNotice,
}: OwnerBookingManagerProps) {
  const { setStatus } = useAppStatus();
  const { user } = useAuth();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const [selectedListingId, setSelectedListingId] = useState<string>(
    activeListingId || listings[0]?.id || ''
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (activeListingId && listings.some((l) => l.id === activeListingId)) {
        setSelectedListingId(activeListingId);
      } else if (
        listings.length > 0 &&
        !listings.some((l) => l.id === selectedListingId)
      ) {
        setSelectedListingId(listings[0].id);
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [activeListingId, listings, selectedListingId]);

  const selectedListing = useMemo(
    () => listings.find((l) => l.id === selectedListingId) || listings[0] || null,
    [listings, selectedListingId]
  );

  const { entitlements } = useEffectiveEntitlements(
    user?.id,
    selectedListing?.id || null
  );

  const [subTab, setSubTab] = useState<BookingSubTab>('live_desk');
  const effectiveSubTab: BookingSubTab = isStaffMode ? 'live_desk' : subTab;

  // Data state
  const [isLoading, setIsLoading] = useState(false);
  const [cancelBookingTarget, setCancelBookingTarget] =
    useState<HydratedBookingRow | null>(null);
  const [cancelBookingReason, setCancelBookingReason] = useState('');
  const [cancelBookingTouched, setCancelBookingTouched] = useState(false);
  const [cancelBookingSubmitted, setCancelBookingSubmitted] = useState(false);
  const [resources, setResources] = useState<ListingBookingResource[]>([]);
  const [hotelProfile, setHotelProfile] = useState<ListingHotelProfile | null>(
    null
  );
  const [bookings, setBookings] = useState<HydratedBookingRow[]>([]);
  const [settlements, setSettlements] = useState<BookingSettlementRow[]>([]);
  const [hasEntitlement, setHasEntitlement] = useState<boolean>(true);
  const [upgradePlans, setUpgradePlans] = useState<SubscriptionPlanRow[]>([]);

  // Listing switcher modal
  const [isListingPickerOpen, setIsListingPickerOpen] = useState(false);

  // Payment modal for Pro subscription upgrade
  const [upgradeIntent, setUpgradeIntent] =
    useState<PaymentIntentRecord | null>(null);
  const [upgradePlanLabel, setUpgradePlanLabel] = useState('');
  const [isStartingUpgrade, setIsStartingUpgrade] = useState<string | null>(
    null
  );

  // Sub-Tab 1: Live Desk filters & inline OTP state
  const [deskSearch, setDeskSearch] = useState('');
  const [deskStatusFilter, setDeskStatusFilter] =
    useState<DeskStatusFilter>('all');
  const [otpInputs, setOtpInputs] = useState<Record<string, string>>({});
  const [balanceChecked, setBalanceChecked] = useState<Record<string, boolean>>(
    {}
  );
  const [busyBookingId, setBusyBookingId] = useState<string | null>(null);

  // Walk-In Block Modal (z-[90])
  const [isWalkInOpen, setIsWalkInOpen] = useState(false);
  const [isWalkInResourcePickerOpen, setIsWalkInResourcePickerOpen] =
    useState(false);
  const [walkInResourceId, setWalkInResourceId] = useState('');
  const [walkInStart, setWalkInStart] = useState(
    () => `${getTodayIstYmd()}T16:00`
  );
  const [walkInEnd, setWalkInEnd] = useState(() => `${getTodayIstYmd()}T17:00`);
  const [walkInUnits, setWalkInUnits] = useState('1');
  const [walkInGuestName, setWalkInGuestName] = useState('');
  const [walkInGuestPhone, setWalkInGuestPhone] = useState('');
  const [walkInNotes, setWalkInNotes] = useState('');
  const [isSavingWalkIn, setIsSavingWalkIn] = useState(false);

  // Sub-Tab 2: Resource CRUD + Modal (z-[90])
  const [resourceSearch, setResourceSearch] = useState('');
  const [isResourceModalOpen, setIsResourceModalOpen] = useState(false);
  const [editingResourceId, setEditingResourceId] = useState<string | null>(
    null
  );
  const [isUnitPickerOpen, setIsUnitPickerOpen] = useState(false);
  const [resForm, setResForm] = useState<{
    name: string;
    description: string;
    booking_unit: BookingUnit;
    slot_duration_mins: string;
    open_hour: string;
    close_hour: string;
    total_units: string;
    max_guests: string;
    base_rate_inr: string;
    peak_rate_inr: string;
    peak_start_hour: string;
    advance_percent: string;
    cover_photo_url: string;
    is_active: boolean;
    addons: ResourceAddon[];
  }>({
    name: '',
    description: '',
    booking_unit: 'hourly',
    slot_duration_mins: '60',
    open_hour: '6',
    close_hour: '22',
    total_units: '1',
    max_guests: '10',
    base_rate_inr: '800',
    peak_rate_inr: '',
    peak_start_hour: '18',
    advance_percent: '30',
    cover_photo_url: '',
    is_active: true,
    addons: [],
  });
  const [isSavingResource, setIsSavingResource] = useState(false);
  const [resourceTempPaths, setResourceTempPaths] = useState<string[]>([]);

  // Sub-Tab 2: Hotel Profile Editor
  const [isStayTypePickerOpen, setIsStayTypePickerOpen] = useState(false);
  const [hotelForm, setHotelForm] = useState<{
    stay_type: HotelStayType;
    check_in_time: string;
    check_out_time: string;
    is_accepting_bookings: boolean;
    amenities: HotelAmenities;
    house_rules: string;
    cancellation_policy: string;
    id_requirement_note: string;
    advance_percent: string;
    shop_upi_id: string;
    shop_upi_name: string;
  }>({
    stay_type: 'hotel',
    check_in_time: '12:00 PM',
    check_out_time: '11:00 AM',
    is_accepting_bookings: true,
    amenities: {
      wifi: false,
      parking: false,
      hot_water: false,
      power_backup: false,
      ac: false,
      heater: false,
      in_house_kitchen: false,
      early_checkin: false,
    },
    house_rules: '',
    cancellation_policy:
      'Free cancellation up to 24 hours before check-in.',
    id_requirement_note: 'Valid Government Photo ID required at reception.',
    advance_percent: '30',
    shop_upi_id: '',
    shop_upi_name: '',
  });
  const [isSavingHotel, setIsSavingHotel] = useState(false);

  // Sub-Tab 3: Settlements filter
  const [settlementSearch, setSettlementSearch] = useState('');
  const [settlementFilter, setSettlementFilter] =
    useState<SettlementStatusFilter>('all');

  const isHotel: boolean = useMemo(() => {
    if (hotelProfile) return true;
    if (selectedListing?.listingVertical === 'hotel_stay') return true;
    return resources[0]?.resource_vertical === 'hotel_stay';
  }, [hotelProfile, selectedListing?.listingVertical, resources]);

  const activeVertical: ResourceVertical = isHotel
    ? 'hotel_stay'
    : 'booking_venue';

  const emitNotice = useCallback(
    (type: 'success' | 'error' | 'info', text: string) => {
      onNotice?.({ type, text });
      setStatus(type === 'info' ? 'idle' : type, text);
    },
    [onNotice, setStatus]
  );

  const loadWorkspaceData = useCallback(async () => {
    if (!selectedListing?.id || !isSupabaseConfigured()) return;
    setIsLoading(true);
    try {
      const verticalGuess: ResourceVertical =
        selectedListing.listingVertical === 'hotel_stay'
          ? 'hotel_stay'
          : 'booking_venue';

      const [resRows, hotelRes, bookRows, entRes, plansRes, settleRes] =
        await Promise.all([
          supabase
            .from('listing_booking_resources')
            .select('*')
            .eq('listing_id', selectedListing.id)
            .order('sort_order', { ascending: true })
            .order('created_at', { ascending: true }),
          supabase
            .from('listing_hotel_profiles')
            .select('*')
            .eq('listing_id', selectedListing.id)
            .maybeSingle(),
          supabase
            .from('resource_bookings')
            .select('*')
            .eq('listing_id', selectedListing.id)
            .order('start_at', { ascending: false })
            .limit(120),
          supabase.rpc('has_active_booking_entitlement', {
            p_listing_id: selectedListing.id,
            p_vertical: verticalGuess,
          }),
          !isStaffMode
            ? supabase
                .from('subscription_plans')
                .select('id, slug, name, price_inr, duration_days, plan_scope')
                .in('plan_scope', [
                  'booking_pro',
                  'stay_pro',
                  'merchant_all_in_one',
                ])
                .eq('is_active', true)
                .order('price_inr', { ascending: true })
            : Promise.resolve({ data: null }),
          !isStaffMode
            ? supabase
                .from('merchant_settlements')
                .select('*')
                .eq('listing_id', selectedListing.id)
                .eq('settlement_source', 'resource_booking')
                .order('created_at', { ascending: false })
                .limit(100)
            : Promise.resolve({ data: null }),
        ]);

      const normalizedResources: ListingBookingResource[] = (
        (resRows.data || []) as Array<Record<string, unknown>>
      ).map((r) => ({
        id: String(r.id),
        listing_id: String(r.listing_id),
        hub_id: String(r.hub_id || selectedListing.hubId || ''),
        resource_vertical:
          r.resource_vertical === 'hotel_stay' ? 'hotel_stay' : 'booking_venue',
        name: String(r.name || 'Space'),
        description: r.description ? String(r.description) : null,
        booking_unit: (r.booking_unit as BookingUnit) || 'hourly',
        slot_duration_mins: Number(r.slot_duration_mins || 60),
        open_hour: Number(r.open_hour ?? 6),
        close_hour: Number(r.close_hour ?? 22),
        total_units: Number(r.total_units || 1),
        max_guests: Number(r.max_guests || 10),
        base_rate_inr: Number(r.base_rate_inr || 0),
        peak_rate_inr:
          r.peak_rate_inr !== null && r.peak_rate_inr !== undefined
            ? Number(r.peak_rate_inr)
            : null,
        peak_start_hour:
          r.peak_start_hour !== null && r.peak_start_hour !== undefined
            ? Number(r.peak_start_hour)
            : null,
        advance_percent: Number(r.advance_percent ?? 30),
        addons: Array.isArray(r.addons) ? (r.addons as ResourceAddon[]) : [],
        photos: Array.isArray(r.photos) ? (r.photos as string[]) : [],
        is_active: r.is_active !== false,
        sort_order: Number(r.sort_order || 0),
      }));

      setResources(normalizedResources);
      if (
        normalizedResources.length > 0 &&
        !normalizedResources.some((r) => r.id === walkInResourceId)
      ) {
        setWalkInResourceId(normalizedResources[0].id);
      }

      const resNameMap = new Map<string, string>(
        normalizedResources.map((r) => [r.id, r.name])
      );

      if (hotelRes.data) {
        const hp = hotelRes.data as unknown as ListingHotelProfile;
        setHotelProfile(hp);
        setHotelForm({
          stay_type: hp.stay_type || 'hotel',
          check_in_time: hp.check_in_time || '12:00 PM',
          check_out_time: hp.check_out_time || '11:00 AM',
          is_accepting_bookings: hp.is_accepting_bookings !== false,
          amenities: {
            wifi: Boolean(hp.amenities?.wifi),
            parking: Boolean(hp.amenities?.parking),
            hot_water: Boolean(hp.amenities?.hot_water),
            power_backup: Boolean(hp.amenities?.power_backup),
            ac: Boolean(hp.amenities?.ac),
            heater: Boolean(hp.amenities?.heater),
            in_house_kitchen: Boolean(hp.amenities?.in_house_kitchen),
            early_checkin: Boolean(hp.amenities?.early_checkin),
          },
          house_rules: hp.house_rules || '',
          cancellation_policy:
            hp.cancellation_policy ||
            'Free cancellation up to 24 hours before check-in.',
          id_requirement_note:
            hp.id_requirement_note ||
            'Valid Government Photo ID required at reception.',
          advance_percent: String(hp.payment_policy?.advance_percent ?? 30),
          shop_upi_id: hp.payment_policy?.shop_upi_id || '',
          shop_upi_name: hp.payment_policy?.shop_upi_name || '',
        });
      } else {
        setHotelProfile(null);
      }

      const rawBookings = (bookRows.data || []) as unknown as ResourceBooking[];
      const hydratedBookings: HydratedBookingRow[] = rawBookings.map((b) => ({
        ...b,
        total_amount_inr: Number(b.total_amount_inr || 0),
        advance_amount_inr: Number(b.advance_amount_inr || 0),
        balance_at_venue_inr: Number(b.balance_at_venue_inr || 0),
        convenience_fee_inr: Number(b.convenience_fee_inr || 0),
        resourceName: resNameMap.get(b.resource_id) || 'Resource',
      }));
      setBookings(hydratedBookings);

      const bookingCodeById = new Map(
        hydratedBookings.map((b) => [b.id, b.booking_code])
      );

      setHasEntitlement(entRes.data === true);

      if (Array.isArray(plansRes.data)) {
        setUpgradePlans(plansRes.data as SubscriptionPlanRow[]);
      }

      if (Array.isArray(settleRes.data)) {
        const mappedSettle: BookingSettlementRow[] = (
          settleRes.data as Array<Record<string, unknown>>
        ).map((s) => ({
          id: String(s.id),
          resource_booking_id: s.resource_booking_id
            ? String(s.resource_booking_id)
            : null,
          gross_amount_inr: Number(s.gross_amount_inr || 0),
          platform_fee_inr: Number(s.platform_fee_inr || 0),
          net_payout_inr: Number(s.net_payout_inr || 0),
          status: String(s.status || 'locked'),
          payout_reference: s.payout_reference ? String(s.payout_reference) : null,
          settled_at: s.settled_at ? String(s.settled_at) : null,
          created_at: String(s.created_at || ''),
          booking_code: s.resource_booking_id
            ? bookingCodeById.get(String(s.resource_booking_id)) ||
              String(s.resource_booking_id).slice(0, 8)
            : '—',
        }));
        setSettlements(mappedSettle);
      }
    } catch (err) {
      emitNotice(
        'error',
        err instanceof Error
          ? err.message
          : 'Failed to load booking workspace data.'
      );
    } finally {
      setIsLoading(false);
    }
  }, [selectedListing, isStaffMode, walkInResourceId, emitNotice]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadWorkspaceData();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadWorkspaceData]);

  // Trigger Pro subscription checkout
  const handleStartUpgrade = async (plan: SubscriptionPlanRow) => {
    if (!selectedListing) return;
    setIsStartingUpgrade(plan.id);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('Please sign in again.');

      const purpose =
        plan.plan_scope === 'stay_pro' || isHotel
          ? 'stay_pro_subscription'
          : 'booking_pro_subscription';

      const res = await fetch('/api/payments/create-intent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          purpose,
          referenceId: plan.id,
          listingId: selectedListing.id,
          hubId: selectedListing.hubId || undefined,
          amountInr: plan.price_inr,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        intent?: PaymentIntentRecord;
        error?: string;
      };
      if (!res.ok || !json.intent) {
        throw new Error(json.error || 'Could not start subscription checkout.');
      }
      setUpgradePlanLabel(`${plan.name} · ${selectedListing.title}`);
      setUpgradeIntent(json.intent);
    } catch (err) {
      emitNotice(
        'error',
        err instanceof Error ? err.message : 'Subscription checkout failed.'
      );
    } finally {
      setIsStartingUpgrade(null);
    }
  };

  // Owner / Staff Booking Action (verify OTP, complete, cancel, release walk-in, no-show)
  const handleBookingAction = async (
    booking: HydratedBookingRow,
    action:
      | 'verify_checkin_otp'
      | 'mark_completed'
      | 'cancel_booking'
      | 'release_walk_in_block'
      | 'mark_no_show',
    cancellationReason?: string
  ) => {
    if (action === 'cancel_booking' && !cancellationReason) {
      setCancelBookingReason('');
      setCancelBookingTouched(false);
      setCancelBookingSubmitted(false);
      setCancelBookingTarget(booking);
      return;
    }
    if (
      action === 'mark_completed' ||
      action === 'mark_no_show' ||
      action === 'release_walk_in_block'
    ) {
      const ok = await confirm({
        title:
          action === 'mark_completed'
            ? `Complete Booking ${booking.booking_code}?`
            : action === 'mark_no_show'
              ? `Mark ${booking.booking_code} as No-Show?`
              : `Release Walk-In Block ${booking.booking_code}?`,
        description:
          action === 'mark_completed'
            ? 'Marks the guest session/stay as completed and finalizes booking records.'
            : action === 'mark_no_show'
              ? 'Records that the guest did not arrive for their reserved slot/stay.'
              : 'Immediately frees this blocked slot/room for online customer bookings.',
        confirmLabel:
          action === 'mark_completed'
            ? 'Mark Completed'
            : action === 'mark_no_show'
              ? 'Confirm No-Show'
              : 'Release Slot',
        cancelLabel: 'Cancel',
        variant: action === 'mark_no_show' ? 'danger' : 'default',
      });
      if (!ok) return;
    }

    setBusyBookingId(booking.id);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('Please sign in again.');

      const payload: Record<string, unknown> = {
        action,
        ...(cancellationReason ? { reason: cancellationReason.trim() } : {}),
      };
      if (action === 'verify_checkin_otp') {
        const otp = (otpInputs[booking.id] || '').trim();
        if (otp.length !== 4) {
          throw new Error('Enter the 4-digit Check-In OTP from the guest.');
        }
        payload.otp = otp;
        payload.balanceCollected = Boolean(balanceChecked[booking.id]);
      }

      const res = await fetch(
        `/api/bookings/${encodeURIComponent(booking.id)}/owner-action`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        }
      );
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'Action could not be completed.');
      }

      emitNotice(
        'success',
        action === 'verify_checkin_otp'
          ? `Checked in ${booking.booking_code} & unlocked escrow!`
          : action === 'mark_completed'
            ? `Marked ${booking.booking_code} completed.`
            : action === 'release_walk_in_block'
              ? 'Walk-in block released — slot is live online again.'
              : action === 'mark_no_show'
                ? `Marked ${booking.booking_code} as No-Show.`
                : `Cancelled ${booking.booking_code}.`
      );
      await loadWorkspaceData();
    } catch (err) {
      emitNotice(
        'error',
        err instanceof Error ? err.message : 'Failed to update booking.'
      );
    } finally {
      setBusyBookingId(null);
    }
  };

  // Submit Walk-In Block
  const handleSubmitWalkIn = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedListing || !walkInResourceId) return;
    const ok = await confirm({
      title: 'Lock Slot / Room for Walk-In?',
      description: `Block ${Math.max(1, Number(walkInUnits || 1))} unit(s) for ${
        walkInGuestName.trim() || 'Walk-In Guest'
      }? This immediately updates live online availability.`,
      confirmLabel: 'Lock Availability',
    });
    if (!ok) return;
    setIsSavingWalkIn(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('Please sign in again.');

      const res = await fetch('/api/bookings/walk-in-block', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          listingId: selectedListing.id,
          resourceId: walkInResourceId,
          startAt: walkInStart.includes('+')
            ? walkInStart
            : `${walkInStart}:00+05:30`,
          endAt: walkInEnd.includes('+') ? walkInEnd : `${walkInEnd}:00+05:30`,
          unitsBooked: Math.max(1, Number(walkInUnits || 1)),
          guestName: walkInGuestName.trim() || 'Walk-In Guest',
          guestPhone: walkInGuestPhone.trim() || undefined,
          notes: walkInNotes.trim() || undefined,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        error?: string;
      };
      if (!res.ok || !json.ok) {
        throw new Error(json.error || 'Could not create walk-in block.');
      }

      emitNotice(
        'success',
        'Walk-in / phone block created — synced with live availability.'
      );
      setIsWalkInOpen(false);
      setWalkInGuestName('');
      setWalkInGuestPhone('');
      setWalkInNotes('');
      await loadWorkspaceData();
    } catch (err) {
      emitNotice(
        'error',
        err instanceof Error ? err.message : 'Walk-in block failed.'
      );
    } finally {
      setIsSavingWalkIn(false);
    }
  };

  const resourceQuotaLimit = isHotel
    ? getLimit(entitlements, 'max_room_types')
    : getLimit(entitlements, 'max_booking_resources');

  const handleCancelResourceModal = useCallback(() => {
    if (resourceTempPaths.length > 0) {
      void discardUploadedTempPaths(resourceTempPaths);
      setResourceTempPaths([]);
    }
    setIsResourceModalOpen(false);
  }, [resourceTempPaths]);

  // Open Resource Add/Edit modal
  const openResourceModal = (res?: ListingBookingResource) => {
    setResourceTempPaths([]);
    if (res) {
      setEditingResourceId(res.id);
      setResForm({
        name: res.name,
        description: res.description || '',
        booking_unit: res.booking_unit,
        slot_duration_mins: String(res.slot_duration_mins || 60),
        open_hour: String(res.open_hour ?? 6),
        close_hour: String(res.close_hour ?? 22),
        total_units: String(res.total_units || 1),
        max_guests: String(res.max_guests || 10),
        base_rate_inr: String(res.base_rate_inr || 0),
        peak_rate_inr:
          res.peak_rate_inr !== null ? String(res.peak_rate_inr) : '',
        peak_start_hour:
          res.peak_start_hour !== null ? String(res.peak_start_hour) : '18',
        advance_percent: String(res.advance_percent ?? 30),
        cover_photo_url:
          Array.isArray(res.photos) && res.photos[0] ? res.photos[0] : '',
        is_active: res.is_active !== false,
        addons: Array.isArray(res.addons) ? [...res.addons] : [],
      });
    } else {
      if (resourceQuotaLimit >= 0 && resources.length >= resourceQuotaLimit) {
        emitNotice(
          'error',
          `Quota reached (${resourceQuotaLimit} ${
            isHotel ? 'room types' : 'booking resources'
          }). Upgrade your plan or contact admin.`
        );
        return;
      }
      setEditingResourceId(null);
      setResForm({
        name: '',
        description: '',
        booking_unit: isHotel ? 'nightly' : 'hourly',
        slot_duration_mins: '60',
        open_hour: '6',
        close_hour: '22',
        total_units: isHotel ? '4' : '1',
        max_guests: isHotel ? '2' : '12',
        base_rate_inr: isHotel ? '1800' : '800',
        peak_rate_inr: '',
        peak_start_hour: '18',
        advance_percent: '30',
        cover_photo_url: '',
        is_active: true,
        addons: [],
      });
    }
    setIsResourceModalOpen(true);
  };

  const handleSaveResource = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedListing) return;
    if (resForm.name.trim().length < 2) {
      emitNotice('error', 'Resource name is required.');
      return;
    }
    const ok = await confirm({
      title: editingResourceId
        ? 'Save Resource Changes?'
        : isHotel
          ? 'Add Room Type?'
          : 'Add Bookable Space?',
      description: `Save "${resForm.name.trim()}" at ${formatBookingInr(
        Math.max(0, Number(resForm.base_rate_inr || 0))
      )}/${getBookingUnitShortLabel(resForm.booking_unit)}?`,
      confirmLabel: editingResourceId ? 'Save Changes' : 'Create Resource',
    });
    if (!ok) return;
    setIsSavingResource(true);
    try {
      const payload = {
        listing_id: selectedListing.id,
        hub_id: selectedListing.hubId || resources[0]?.hub_id || undefined,
        resource_vertical: activeVertical,
        name: resForm.name.trim(),
        description: resForm.description.trim() || null,
        booking_unit: resForm.booking_unit,
        slot_duration_mins: Math.max(
          15,
          Number(resForm.slot_duration_mins || 60)
        ),
        open_hour: Math.max(0, Math.min(23, Number(resForm.open_hour || 6))),
        close_hour: Math.max(1, Math.min(24, Number(resForm.close_hour || 22))),
        total_units: Math.max(1, Number(resForm.total_units || 1)),
        max_guests: Math.max(1, Number(resForm.max_guests || 2)),
        base_rate_inr: Math.max(0, Number(resForm.base_rate_inr || 0)),
        peak_rate_inr: resForm.peak_rate_inr.trim()
          ? Math.max(0, Number(resForm.peak_rate_inr))
          : null,
        peak_start_hour: resForm.peak_rate_inr.trim()
          ? Math.max(0, Math.min(23, Number(resForm.peak_start_hour || 18)))
          : null,
        advance_percent: Math.max(
          0,
          Math.min(100, Number(resForm.advance_percent || 0))
        ),
        photos: resForm.cover_photo_url.trim()
          ? [resForm.cover_photo_url.trim()]
          : [],
        is_active: resForm.is_active,
        addons: resForm.addons
          .filter((a) => a.label.trim().length > 0)
          .map((a) => ({
            key:
              a.key.trim() ||
              a.label
                .trim()
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, '_'),
            label: a.label.trim(),
            price_inr: Math.max(0, Number(a.price_inr || 0)),
            per_unit: Boolean(a.per_unit),
          })),
      };

      if (editingResourceId) {
        const { error } = await supabase
          .from('listing_booking_resources')
          .update(payload)
          .eq('id', editingResourceId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('listing_booking_resources')
          .insert(payload);
        if (error) throw error;
      }

      emitNotice(
        'success',
        editingResourceId ? 'Resource updated.' : 'New resource added.'
      );
      setResourceTempPaths([]);
      setIsResourceModalOpen(false);
      await loadWorkspaceData();
    } catch (err) {
      emitNotice(
        'error',
        err instanceof Error ? err.message : 'Failed to save resource.'
      );
    } finally {
      setIsSavingResource(false);
    }
  };

  const handleDeleteResource = async (res: ListingBookingResource) => {
    const ok = await confirm({
      title: 'Delete Resource / Room Type?',
      description: `Remove "${res.name}" permanently from your booking inventory?`,
      confirmLabel: 'Delete Resource',
      variant: 'danger',
    });
    if (!ok) return;
    try {
      const { error } = await supabase
        .from('listing_booking_resources')
        .delete()
        .eq('id', res.id);
      if (error) throw error;
      emitNotice('success', `"${res.name}" removed.`);
      await loadWorkspaceData();
    } catch (err) {
      emitNotice(
        'error',
        err instanceof Error ? err.message : 'Failed to delete resource.'
      );
    }
  };

  // Save Hotel Profile
  const handleSaveHotelProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedListing) return;
    const ok = await confirm({
      title: 'Save Hotel Profile & Policies?',
      description:
        'Update check-in/out times, property amenities, house rules, and advance payment rules?',
      confirmLabel: 'Save Hotel Profile',
    });
    if (!ok) return;
    setIsSavingHotel(true);
    try {
      const payload = {
        listing_id: selectedListing.id,
        hub_id:
          hotelProfile?.hub_id ||
          selectedListing.hubId ||
          resources[0]?.hub_id,
        stay_type: hotelForm.stay_type,
        check_in_time: hotelForm.check_in_time.trim() || '12:00 PM',
        check_out_time: hotelForm.check_out_time.trim() || '11:00 AM',
        is_accepting_bookings: hotelForm.is_accepting_bookings,
        amenities: hotelForm.amenities,
        house_rules: hotelForm.house_rules.trim() || null,
        cancellation_policy:
          hotelForm.cancellation_policy.trim() ||
          'Free cancellation up to 24 hours before check-in.',
        id_requirement_note:
          hotelForm.id_requirement_note.trim() ||
          'Valid Government Photo ID required at reception.',
        payment_policy: {
          ...(hotelProfile?.payment_policy || {
            allow_direct_pay: false,
            allow_full_prepay: true,
            shop_upi_verified: false,
          }),
          advance_percent: Math.max(
            0,
            Math.min(100, Number(hotelForm.advance_percent || 30))
          ),
          shop_upi_id: hotelForm.shop_upi_id.trim() || null,
          shop_upi_name: hotelForm.shop_upi_name.trim() || null,
        },
      };

      const { error } = await supabase
        .from('listing_hotel_profiles')
        .upsert(payload, { onConflict: 'listing_id' });
      if (error) throw error;

      emitNotice('success', 'Hotel profile & hospitality rules saved.');
      await loadWorkspaceData();
    } catch (err) {
      emitNotice(
        'error',
        err instanceof Error ? err.message : 'Failed to save hotel profile.'
      );
    } finally {
      setIsSavingHotel(false);
    }
  };

  // Filtered bookings
  const filteredBookings = useMemo(() => {
    const q = deskSearch.trim().toLowerCase();
    return bookings.filter((b) => {
      if (deskStatusFilter === 'closed') {
        if (!['completed', 'cancelled', 'no_show'].includes(b.booking_status)) {
          return false;
        }
      } else if (
        deskStatusFilter !== 'all' &&
        b.booking_status !== deskStatusFilter
      ) {
        return false;
      }
      if (!q) return true;
      return (
        b.booking_code.toLowerCase().includes(q) ||
        b.guest_name.toLowerCase().includes(q) ||
        (b.guest_phone || '').toLowerCase().includes(q) ||
        b.resourceName.toLowerCase().includes(q)
      );
    });
  }, [bookings, deskSearch, deskStatusFilter]);

  const filteredResources = useMemo(() => {
    const q = resourceSearch.trim().toLowerCase();
    if (!q) return resources;
    return resources.filter(
      (r) =>
        r.name.toLowerCase().includes(q) ||
        (r.description || '').toLowerCase().includes(q) ||
        r.booking_unit.toLowerCase().includes(q)
    );
  }, [resources, resourceSearch]);

  const filteredSettlements = useMemo(() => {
    const q = settlementSearch.trim().toLowerCase();
    return settlements.filter((s) => {
      if (settlementFilter !== 'all' && s.status !== settlementFilter) {
        return false;
      }
      if (!q) return true;
      return (
        s.booking_code.toLowerCase().includes(q) ||
        (s.payout_reference || '').toLowerCase().includes(q) ||
        s.status.toLowerCase().includes(q)
      );
    });
  }, [settlements, settlementSearch, settlementFilter]);

  const listingOptions: CustomSelectOption[] = useMemo(
    () =>
      listings.map((l) => ({
        value: l.id,
        label: l.title,
        description: l.locality || l.listingVertical || undefined,
      })),
    [listings]
  );

  const walkInResourceOptions: CustomSelectOption[] = useMemo(
    () =>
      resources
        .filter((r) => r.is_active)
        .map((r) => ({
          value: r.id,
          label: r.name,
          description: `${formatBookingInr(r.base_rate_inr)}/${getBookingUnitShortLabel(
            r.booking_unit
          )} · ${r.total_units} unit(s)`,
        })),
    [resources]
  );

  const selectedWalkInResource = useMemo(
    () => resources.find((r) => r.id === walkInResourceId) || resources[0],
    [resources, walkInResourceId]
  );

  if (listings.length === 0) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-surface)] p-8 text-center space-y-2">
        <CalendarDays className="mx-auto h-6 w-6 text-[var(--ps-text-muted)]" />
        <p className="text-sm font-bold text-[var(--ps-text)]">
          No Bookable Venues or Stays Assigned
        </p>
        <p className="text-xs text-[var(--ps-text-muted)] max-w-md mx-auto">
          Once a turf, event hall, hotel, or homestay listing is linked to your
          account, you can manage live slots, walk-in blocks, and Check-In OTPs
          here.
        </p>
      </div>
    );
  }

  return (
    <div
      data-testid="owner-booking-manager"
      className="space-y-4 min-w-0 max-w-full overflow-x-clip"
    >
      {/* Top Bar: Listing Switcher + Sub-Tabs + Refresh */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3">
        <div className="flex flex-wrap items-center gap-2 min-w-0">
          {listings.length > 1 ? (
            <div className="w-full min-w-0 sm:w-auto sm:min-w-[200px] sm:max-w-[260px]">
              <CustomSelectModal
                options={listingOptions}
                value={selectedListing?.id || ''}
                onChange={(val) => setSelectedListingId(val)}
                placeholder="Select Venue or Property"
                label="Select Venue or Property"
              />
            </div>
          ) : (
            <div className="inline-flex items-center gap-2 px-1 text-xs font-extrabold text-[var(--ps-text)]">
              {isHotel ? (
                <BedDouble className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
              ) : (
                <CalendarDays className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
              )}
              <span className="truncate">{selectedListing?.title}</span>
            </div>
          )}

          {isStaffMode && (
            <span className="rounded-md bg-teal-500/15 px-2 py-0.5 text-[10px] font-bold uppercase text-teal-800 dark:text-teal-300">
              Reception / Operator Desk
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-1.5 min-w-0 max-w-full">
          {!isStaffMode && (
            <div className="flex max-w-full overflow-x-auto no-scrollbar rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-0.5">
              {(
                [
                  { id: 'live_desk', label: 'Live Desk & Walk-Ins' },
                  {
                    id: 'setup',
                    label: isHotel ? 'Rooms & Rules' : 'Spaces & Rates',
                  },
                  { id: 'settlements', label: 'Escrow Settlements' },
                ] as const
              ).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSubTab(t.id)}
                  className={`h-7 shrink-0 whitespace-nowrap rounded-lg px-2.5 text-[11px] font-bold transition-colors ${
                    effectiveSubTab === t.id
                      ? 'bg-theme-primary text-[hsl(var(--color-primary-foreground))]'
                      : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={() => void loadWorkspaceData()}
            disabled={isLoading}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] disabled:opacity-50"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`}
            />
            <span className="hidden sm:inline">Refresh</span>
          </button>
        </div>
      </div>

      {/* Skeletal Loading State (v18b) */}
      {isLoading && (
        <div className="space-y-3" aria-busy="true" aria-label="Loading bookings desk">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="dd-shimmer h-24 rounded-2xl border border-[var(--ps-border)]" />
            <div className="dd-shimmer h-24 rounded-2xl border border-[var(--ps-border)]" />
            <div className="dd-shimmer h-24 rounded-2xl border border-[var(--ps-border)]" />
          </div>
          <div className="dd-shimmer h-40 rounded-2xl border border-[var(--ps-border)]" />
        </div>
      )}

      {/* Entitlement Upgrade Card (Owner Only when unsubscribed) */}
      {!isStaffMode && !hasEntitlement && (
        <div
          data-testid="booking-pro-upgrade-card"
          className="rounded-2xl border border-amber-500/35 bg-amber-500/8 p-4 space-y-3"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="flex items-start gap-2.5">
              <Sparkles className="h-5 w-5 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
              <div>
                <h3 className="text-sm font-extrabold text-[var(--ps-text)]">
                  Upgrade to {isHotel ? 'Stay Pro' : 'Booking Pro'}
                </h3>
                <p className="text-xs text-[var(--ps-text-muted)]">
                  Activate instant online slot/room checkout, Check-In OTP
                  escrow, and walk-in sync. Existing bookings remain visible
                  below.
                </p>
              </div>
            </div>
          </div>

          {upgradePlans.length > 0 && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              {upgradePlans.map((plan) => (
                <div
                  key={plan.id}
                  className="flex flex-col justify-between rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3 space-y-2"
                >
                  <div>
                    <p className="text-xs font-extrabold text-[var(--ps-text)]">
                      {plan.name}
                    </p>
                    <p className="mt-0.5 font-mono text-sm font-black text-theme-primary tabular-nums">
                      {formatBookingInr(plan.price_inr)}{' '}
                      <span className="text-[10px] font-semibold text-[var(--ps-text-muted)]">
                        / {plan.duration_days}d
                      </span>
                    </p>
                  </div>
                  <button
                    type="button"
                    disabled={isStartingUpgrade === plan.id}
                    onClick={() => void handleStartUpgrade(plan)}
                    className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-theme-primary px-3 text-xs font-bold text-[hsl(var(--color-primary-foreground))] hover:opacity-95 disabled:opacity-50"
                  >
                    {isStartingUpgrade === plan.id ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <CreditCard className="h-3.5 w-3.5" />
                    )}
                    <span>Subscribe Now</span>
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ================================================================= */}
      {/* SUB-TAB 1: LIVE DESK, WALK-IN BLOCKER & CHECK-IN OTP              */}
      {/* ================================================================= */}
      {effectiveSubTab === 'live_desk' && (
        <div className="space-y-3 min-w-0">
          <WorkspaceTableToolbar
            searchQuery={deskSearch}
            onSearchChange={setDeskSearch}
            searchPlaceholder="Search code, guest name, phone, or space…"
            filteredCount={filteredBookings.length}
            totalCount={bookings.length}
            countLabel="bookings"
            hasActiveFilters={
              deskSearch.trim().length > 0 || deskStatusFilter !== 'all'
            }
            onResetFilters={() => {
              setDeskSearch('');
              setDeskStatusFilter('all');
            }}
            actions={
              <button
                type="button"
                disabled={resources.length === 0}
                onClick={() => setIsWalkInOpen(true)}
                data-testid="open-walkin-block-btn"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 px-3 text-xs font-bold text-white shadow-2xs disabled:opacity-50"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>+ Walk-In / Phone Block</span>
              </button>
            }
          >
            <div className="flex flex-wrap items-center gap-1">
              {(
                [
                  { id: 'all', label: 'All' },
                  { id: 'confirmed', label: 'Confirmed' },
                  { id: 'checked_in', label: 'Checked In' },
                  { id: 'blocked', label: 'Walk-In Blocks' },
                  { id: 'pending_payment', label: 'Pending' },
                  { id: 'closed', label: 'Completed/Cancelled' },
                ] as const
              ).map((st) => (
                <button
                  key={st.id}
                  type="button"
                  onClick={() => setDeskStatusFilter(st.id)}
                  className={`h-7 rounded-md px-2 text-[11px] font-semibold transition-colors ${
                    deskStatusFilter === st.id
                      ? 'bg-slate-900 text-white dark:bg-theme-primary dark:text-[hsl(var(--color-primary-foreground))]'
                      : 'border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                  }`}
                >
                  {st.label}
                </button>
              ))}
            </div>
          </WorkspaceTableToolbar>

          <ResponsiveTableScroll minWidthClass="min-w-[920px]">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[var(--ps-border)] bg-[var(--ps-bg)]/80 text-[10px] font-extrabold uppercase tracking-wider text-[var(--ps-text-muted)]">
                <tr>
                  <th className="px-3 py-2.5">Code / Space</th>
                  <th className="px-3 py-2.5">Guest &amp; Phone</th>
                  <th className="px-3 py-2.5">Window &amp; Units</th>
                  <th className="px-3 py-2.5">Amounts (₹)</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5 text-right">Desk Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--ps-border)]/70">
                {filteredBookings.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-8 text-center text-xs text-[var(--ps-text-muted)]"
                    >
                      No bookings match the current filter.
                    </td>
                  </tr>
                ) : (
                  filteredBookings.map((b) => {
                    const badge = getStatusBadge(b.booking_status);
                    const isWalkIn =
                      b.booking_source === 'walk_in_block' ||
                      b.booking_status === 'blocked';
                    const isBusy = busyBookingId === b.id;

                    return (
                      <tr
                        key={b.id}
                        className="hover:bg-[var(--ps-bg)]/40 transition-colors align-top"
                      >
                        <td className="px-3 py-2.5">
                          <span className="font-mono font-extrabold text-[var(--ps-text)]">
                            {isWalkIn ? 'WALK-IN' : b.booking_code}
                          </span>
                          <p className="text-[11px] font-semibold text-[var(--ps-text-muted)]">
                            {b.resourceName}
                          </p>
                        </td>
                        <td className="px-3 py-2.5">
                          <p className="font-bold text-[var(--ps-text)]">
                            {b.guest_name}
                          </p>
                          <p className="text-[11px] text-[var(--ps-text-muted)]">
                            {b.guest_phone || '—'}
                          </p>
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap">
                          <p className="font-semibold text-[var(--ps-text)]">
                            {formatIstDateTime(b.start_at)}
                          </p>
                          <p className="text-[11px] text-[var(--ps-text-muted)]">
                            → {formatIstDateTime(b.end_at)} · {b.units_booked}{' '}
                            unit(s)
                          </p>
                        </td>
                        <td className="px-3 py-2.5 whitespace-nowrap font-mono tabular-nums">
                          <p className="font-extrabold text-[var(--ps-text)]">
                            Total {formatBookingInr(b.total_amount_inr)}
                          </p>
                          <p className="text-[10px] text-[var(--ps-text-muted)]">
                            Adv {formatBookingInr(b.advance_amount_inr)} · Bal{' '}
                            {formatBookingInr(b.balance_at_venue_inr)}
                          </p>
                        </td>
                        <td className="px-3 py-2.5">
                          <span
                            className={`inline-flex rounded-md border px-2 py-0.5 text-[10px] font-bold ${badge.cls}`}
                          >
                            {badge.label}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          {b.booking_status === 'confirmed' && !isWalkIn && (
                            <div className="inline-flex flex-col items-end gap-1.5">
                              <div className="flex items-center gap-1.5">
                                <input
                                  type="text"
                                  maxLength={4}
                                  inputMode="numeric"
                                  placeholder="4-digit OTP"
                                  value={otpInputs[b.id] || ''}
                                  onChange={(e) =>
                                    setOtpInputs((prev) => ({
                                      ...prev,
                                      [b.id]: e.target.value.replace(/\D/g, ''),
                                    }))
                                  }
                                  className="h-7 w-24 rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 font-mono text-xs font-bold text-center"
                                />
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() =>
                                    void handleBookingAction(
                                      b,
                                      'verify_checkin_otp'
                                    )
                                  }
                                  className="inline-flex h-7 items-center gap-1 rounded-md bg-emerald-600 hover:bg-emerald-700 px-2.5 text-[11px] font-bold text-white disabled:opacity-50"
                                >
                                  {isBusy ? (
                                    <Loader2 className="h-3 w-3 animate-spin" />
                                  ) : (
                                    <KeyRound className="h-3 w-3" />
                                  )}
                                  <span>Check In</span>
                                </button>
                              </div>
                              <div className="flex items-center gap-2 text-[10px]">
                                <label className="inline-flex items-center gap-1 cursor-pointer text-[var(--ps-text-muted)]">
                                  <input
                                    type="checkbox"
                                    checked={Boolean(balanceChecked[b.id])}
                                    onChange={(e) =>
                                      setBalanceChecked((prev) => ({
                                        ...prev,
                                        [b.id]: e.target.checked,
                                      }))
                                    }
                                  />
                                  <span>Venue Balance Collected</span>
                                </label>
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() =>
                                    void handleBookingAction(b, 'mark_no_show')
                                  }
                                  className="font-semibold text-amber-700 hover:underline dark:text-amber-300"
                                >
                                  No-Show
                                </button>
                                <button
                                  type="button"
                                  disabled={isBusy}
                                  onClick={() =>
                                    void handleBookingAction(
                                      b,
                                      'cancel_booking'
                                    )
                                  }
                                  className="font-semibold text-rose-600 hover:underline dark:text-rose-400"
                                >
                                  Cancel
                                </button>
                              </div>
                            </div>
                          )}

                          {b.booking_status === 'checked_in' && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() =>
                                void handleBookingAction(b, 'mark_completed')
                              }
                              className="inline-flex h-7 items-center gap-1 rounded-md bg-sky-600 hover:bg-sky-700 px-2.5 text-[11px] font-bold text-white disabled:opacity-50"
                            >
                              {isBusy ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <CheckCircle2 className="h-3 w-3" />
                              )}
                              <span>Mark Completed</span>
                            </button>
                          )}

                          {b.booking_status === 'blocked' && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() =>
                                void handleBookingAction(
                                  b,
                                  'release_walk_in_block'
                                )
                              }
                              className="inline-flex h-7 items-center gap-1 rounded-md border border-indigo-500/40 bg-indigo-500/10 hover:bg-indigo-500/20 px-2.5 text-[11px] font-bold text-indigo-800 dark:text-indigo-200 disabled:opacity-50"
                            >
                              {isBusy ? (
                                <Loader2 className="h-3 w-3 animate-spin" />
                              ) : (
                                <Unlock className="h-3 w-3" />
                              )}
                              <span>Release Block</span>
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          </ResponsiveTableScroll>
        </div>
      )}

      {/* ================================================================= */}
      {/* SUB-TAB 2: RESOURCES / ROOM TYPES & HOTEL PROFILE (OWNER ONLY)    */}
      {/* ================================================================= */}
      {effectiveSubTab === 'setup' && !isStaffMode && (
        <div className="space-y-5 min-w-0">
          {/* Resource / Room Types CRUD */}
          <div className="space-y-3">
            <WorkspaceTableToolbar
              searchQuery={resourceSearch}
              onSearchChange={setResourceSearch}
              searchPlaceholder="Search spaces or room types…"
              filteredCount={filteredResources.length}
              totalCount={resources.length}
              countLabel={isHotel ? 'room types' : 'spaces'}
              hasActiveFilters={resourceSearch.trim().length > 0}
              onResetFilters={() => setResourceSearch('')}
              actions={
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 py-1 text-[11px] font-bold text-[var(--ps-text-muted)]">
                    Quota: {resources.length} /{' '}
                    {resourceQuotaLimit < 0 ? 'Unlimited' : resourceQuotaLimit}
                  </span>
                  <button
                    type="button"
                    disabled={
                      resourceQuotaLimit >= 0 &&
                      resources.length >= resourceQuotaLimit
                    }
                    onClick={() => openResourceModal()}
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-theme-primary px-3 text-xs font-bold text-[hsl(var(--color-primary-foreground))] disabled:opacity-50"
                  >
                    <Plus className="h-3.5 w-3.5" />
                    <span>{isHotel ? 'Add Room Type' : 'Add Space'}</span>
                  </button>
                </div>
              }
            />

            <ResponsiveTableScroll minWidthClass="min-w-[740px]">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-[var(--ps-border)] bg-[var(--ps-bg)]/80 text-[10px] font-extrabold uppercase tracking-wider text-[var(--ps-text-muted)]">
                  <tr>
                    <th className="px-3 py-2.5">Name &amp; Unit</th>
                    <th className="px-3 py-2.5">Rates (₹)</th>
                    <th className="px-3 py-2.5">Inventory &amp; Capacity</th>
                    <th className="px-3 py-2.5">Advance %</th>
                    <th className="px-3 py-2.5">Status</th>
                    <th className="px-3 py-2.5 text-right">Edit</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--ps-border)]/70">
                  {filteredResources.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className="px-4 py-8 text-center text-xs text-[var(--ps-text-muted)]"
                      >
                        No spaces or rooms configured yet. Click &ldquo;Add&rdquo;
                        to create one.
                      </td>
                    </tr>
                  ) : (
                    filteredResources.map((r) => (
                      <tr key={r.id} className="hover:bg-[var(--ps-bg)]/40">
                        <td className="px-3 py-2.5">
                          <p className="font-bold text-[var(--ps-text)]">
                            {r.name}
                          </p>
                          <p className="text-[10px] text-[var(--ps-text-muted)]">
                            {BOOKING_UNIT_FULL_LABELS[r.booking_unit]} ·{' '}
                            {r.addons.length} add-on(s)
                          </p>
                        </td>
                        <td className="px-3 py-2.5 font-mono tabular-nums">
                          <p className="font-extrabold text-[var(--ps-text)]">
                            {formatBookingInr(r.base_rate_inr)}/
                            {getBookingUnitShortLabel(r.booking_unit)}
                          </p>
                          {r.peak_rate_inr !== null && (
                            <p className="text-[10px] text-amber-700 dark:text-amber-300">
                              Peak {formatBookingInr(r.peak_rate_inr)} (from{' '}
                              {r.peak_start_hour}:00)
                            </p>
                          )}
                        </td>
                        <td className="px-3 py-2.5">
                          {r.total_units} unit(s) · Up to {r.max_guests} guests
                        </td>
                        <td className="px-3 py-2.5 font-mono font-bold">
                          {r.advance_percent}%
                        </td>
                        <td className="px-3 py-2.5">
                          <span
                            className={`rounded-md px-2 py-0.5 text-[10px] font-bold ${
                              r.is_active
                                ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                            }`}
                          >
                            {r.is_active ? 'Active' : 'Hidden'}
                          </span>
                        </td>
                        <td className="px-3 py-2.5 text-right">
                          <div className="inline-flex items-center justify-end gap-1.5">
                            <button
                              type="button"
                              onClick={() => openResourceModal(r)}
                              className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-[11px] font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]"
                            >
                              <Edit3 className="h-3 w-3" />
                              <span>Edit</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => void handleDeleteResource(r)}
                              className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-rose-500/30 bg-rose-500/10 text-rose-500 hover:bg-rose-500/20"
                              title="Delete resource"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </ResponsiveTableScroll>
          </div>

          {/* Hotel Profile Card (only for hotel_stay) */}
          {isHotel && (
            <form
              onSubmit={handleSaveHotelProfile}
              className="rounded-2xl border border-indigo-500/30 bg-[var(--ps-surface)] p-4 space-y-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ps-border)] pb-3">
                <div className="flex items-center gap-2">
                  <BedDouble className="h-4 w-4 text-indigo-600 dark:text-indigo-400" />
                  <h3 className="text-sm font-extrabold text-[var(--ps-text)]">
                    Hotel Profile, Amenities &amp; Hospitality Rules
                  </h3>
                </div>
                <label className="inline-flex items-center gap-2 text-xs font-bold cursor-pointer">
                  <input
                    type="checkbox"
                    checked={hotelForm.is_accepting_bookings}
                    onChange={(e) =>
                      setHotelForm((p) => ({
                        ...p,
                        is_accepting_bookings: e.target.checked,
                      }))
                    }
                    className="h-4 w-4 accent-indigo-600"
                  />
                  <span>Accepting Online Bookings</span>
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <div className="space-y-1">
                  <span className="font-bold text-[var(--ps-text-muted)]">
                    Stay Type
                  </span>
                  <CustomSelectModal
                    options={STAY_TYPE_OPTIONS}
                    value={hotelForm.stay_type}
                    onChange={(val) =>
                      setHotelForm((p) => ({
                        ...p,
                        stay_type: val as HotelStayType,
                      }))
                    }
                    label="Select Property Stay Type"
                  />
                </div>

                <label className="space-y-1">
                  <span className="font-bold text-[var(--ps-text-muted)]">
                    Check-In Time
                  </span>
                  <input
                    type="text"
                    value={hotelForm.check_in_time}
                    onChange={(e) =>
                      setHotelForm((p) => ({
                        ...p,
                        check_in_time: e.target.value,
                      }))
                    }
                    className="h-8 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-xs"
                  />
                </label>

                <label className="space-y-1">
                  <span className="font-bold text-[var(--ps-text-muted)]">
                    Check-Out Time
                  </span>
                  <input
                    type="text"
                    value={hotelForm.check_out_time}
                    onChange={(e) =>
                      setHotelForm((p) => ({
                        ...p,
                        check_out_time: e.target.value,
                      }))
                    }
                    className="h-8 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-xs"
                  />
                </label>
              </div>

              {/* Amenities Checkboxes with Hub Verification Badges */}
              <div className="space-y-1.5">
                <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                  Property Amenities (Verified by Hub Manager)
                </span>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                  {AMENITY_KEYS.map((key) => {
                    const checked = Boolean(hotelForm.amenities[key]);
                    const verified = Boolean(
                      hotelProfile?.verified_amenities?.[key]
                    );
                    return (
                      <label
                        key={key}
                        className="flex flex-col gap-1 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-2.5 text-xs cursor-pointer"
                      >
                        <span className="flex items-center gap-1.5 font-semibold text-[var(--ps-text)]">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) =>
                              setHotelForm((p) => ({
                                ...p,
                                amenities: {
                                  ...p.amenities,
                                  [key]: e.target.checked,
                                },
                              }))
                            }
                          />
                          <span>{getAmenityLabel(key)}</span>
                        </span>
                        {checked && (
                          <span
                            className={`text-[9px] font-bold ${
                              verified
                                ? 'text-emerald-700 dark:text-emerald-300'
                                : 'text-amber-700 dark:text-amber-300'
                            }`}
                          >
                            {verified ? 'Verified ✓' : 'Pending Hub Check'}
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                <label className="space-y-1">
                  <span className="font-bold text-[var(--ps-text-muted)]">
                    Cancellation Policy
                  </span>
                  <input
                    type="text"
                    value={hotelForm.cancellation_policy}
                    onChange={(e) =>
                      setHotelForm((p) => ({
                        ...p,
                        cancellation_policy: e.target.value,
                      }))
                    }
                    className="h-8 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-xs"
                  />
                </label>
                <label className="space-y-1">
                  <span className="font-bold text-[var(--ps-text-muted)]">
                    Reception ID Requirement Note
                  </span>
                  <input
                    type="text"
                    value={hotelForm.id_requirement_note}
                    onChange={(e) =>
                      setHotelForm((p) => ({
                        ...p,
                        id_requirement_note: e.target.value,
                      }))
                    }
                    className="h-8 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-xs"
                  />
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                <label className="space-y-1">
                  <span className="font-bold text-[var(--ps-text-muted)]">
                    Default Advance %
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={100}
                    value={hotelForm.advance_percent}
                    onChange={(e) =>
                      setHotelForm((p) => ({
                        ...p,
                        advance_percent: e.target.value,
                      }))
                    }
                    className="h-8 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-xs"
                  />
                </label>
                <label className="space-y-1">
                  <span className="font-bold text-[var(--ps-text-muted)]">
                    Property UPI ID
                  </span>
                  <input
                    type="text"
                    placeholder="hotel@upi"
                    value={hotelForm.shop_upi_id}
                    onChange={(e) =>
                      setHotelForm((p) => ({
                        ...p,
                        shop_upi_id: e.target.value,
                      }))
                    }
                    className="h-8 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-xs"
                  />
                </label>
                <label className="space-y-1">
                  <span className="font-bold text-[var(--ps-text-muted)]">
                    UPI Payee Name
                  </span>
                  <input
                    type="text"
                    placeholder="Property Name"
                    value={hotelForm.shop_upi_name}
                    onChange={(e) =>
                      setHotelForm((p) => ({
                        ...p,
                        shop_upi_name: e.target.value,
                      }))
                    }
                    className="h-8 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-xs"
                  />
                </label>
              </div>

              <div className="flex justify-end">
                <button
                  type="submit"
                  disabled={isSavingHotel}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-700 px-3.5 text-xs font-bold text-white disabled:opacity-50"
                >
                  {isSavingHotel ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  <span>Save Hotel Profile</span>
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {/* ================================================================= */}
      {/* SUB-TAB 3: BOOKING ESCROW SETTLEMENTS (OWNER ONLY)                */}
      {/* ================================================================= */}
      {effectiveSubTab === 'settlements' && !isStaffMode && (
        <div className="space-y-3 min-w-0">
          <WorkspaceTableToolbar
            searchQuery={settlementSearch}
            onSearchChange={setSettlementSearch}
            searchPlaceholder="Search booking code or payout UTR…"
            filteredCount={filteredSettlements.length}
            totalCount={settlements.length}
            countLabel="settlements"
            hasActiveFilters={
              settlementSearch.trim().length > 0 || settlementFilter !== 'all'
            }
            onResetFilters={() => {
              setSettlementSearch('');
              setSettlementFilter('all');
            }}
          >
            <div className="flex flex-wrap items-center gap-1">
              {(
                ['all', 'locked', 'eligible', 'settled', 'reversed'] as const
              ).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setSettlementFilter(st)}
                  className={`h-7 rounded-md px-2 text-[11px] font-semibold capitalize ${
                    settlementFilter === st
                      ? 'bg-slate-900 text-white dark:bg-theme-primary dark:text-[hsl(var(--color-primary-foreground))]'
                      : 'border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)]'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>
          </WorkspaceTableToolbar>

          <ResponsiveTableScroll minWidthClass="min-w-[680px]">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[var(--ps-border)] bg-[var(--ps-bg)]/80 text-[10px] font-extrabold uppercase tracking-wider text-[var(--ps-text-muted)]">
                <tr>
                  <th className="px-3 py-2.5">Booking Code</th>
                  <th className="px-3 py-2.5">Gross Escrow</th>
                  <th className="px-3 py-2.5">Fee</th>
                  <th className="px-3 py-2.5">Net Payout</th>
                  <th className="px-3 py-2.5">Status</th>
                  <th className="px-3 py-2.5">Payout Ref</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--ps-border)]/70">
                {filteredSettlements.length === 0 ? (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-4 py-8 text-center text-xs text-[var(--ps-text-muted)]"
                    >
                      No booking escrow settlements recorded yet.
                    </td>
                  </tr>
                ) : (
                  filteredSettlements.map((s) => (
                    <tr key={s.id} className="hover:bg-[var(--ps-bg)]/40">
                      <td className="px-3 py-2.5 font-mono font-bold">
                        {s.booking_code}
                      </td>
                      <td className="px-3 py-2.5 font-mono">
                        {formatBookingInr(s.gross_amount_inr)}
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[var(--ps-text-muted)]">
                        {formatBookingInr(s.platform_fee_inr)}
                      </td>
                      <td className="px-3 py-2.5 font-mono font-extrabold text-emerald-700 dark:text-emerald-300">
                        {formatBookingInr(s.net_payout_inr)}
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-0.5 text-[10px] font-bold uppercase">
                          {s.status}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-[11px] text-[var(--ps-text-muted)]">
                        {s.payout_reference || '—'}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </ResponsiveTableScroll>
        </div>
      )}

      {/* ================================================================= */}
      {/* WALK-IN / PHONE BLOCK MODAL (z-[90])                              */}
      {/* ================================================================= */}
      {isWalkInOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            onClick={() => !isSavingWalkIn && setIsWalkInOpen(false)}
            className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs"
          >
            <form
              onSubmit={handleSubmitWalkIn}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md max-h-[88vh] overflow-y-auto rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5 space-y-3.5 shadow-2xl"
            >
              <div className="flex items-center justify-between border-b border-[var(--ps-border)] pb-2.5">
                <h3 className="text-sm font-extrabold text-[var(--ps-text)]">
                  + Walk-In / Phone Block
                </h3>
                <button
                  type="button"
                  onClick={() => setIsWalkInOpen(false)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--ps-border)] text-[var(--ps-text-muted)]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-2.5 text-xs">
                <div className="space-y-1">
                  <span className="font-bold text-[var(--ps-text-muted)]">
                    Space / Room Type *
                  </span>
                  <CustomSelectModal
                    options={walkInResourceOptions}
                    value={walkInResourceId}
                    onChange={(val) => setWalkInResourceId(val)}
                    label="Select Space / Room to Block"
                    placeholder="Select resource"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  <label className="space-y-1">
                    <span className="font-bold text-[var(--ps-text-muted)]">
                      Start Date &amp; Time *
                    </span>
                    <input
                      type="datetime-local"
                      required
                      value={walkInStart}
                      onChange={(e) => setWalkInStart(e.target.value)}
                      className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-xs"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="font-bold text-[var(--ps-text-muted)]">
                      End Date &amp; Time *
                    </span>
                    <input
                      type="datetime-local"
                      required
                      value={walkInEnd}
                      onChange={(e) => setWalkInEnd(e.target.value)}
                      className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-xs"
                    />
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-2.5">
                  <label className="space-y-1">
                    <span className="font-bold text-[var(--ps-text-muted)]">
                      Units to Block (max {selectedWalkInResource?.total_units || 1})
                    </span>
                    <input
                      type="number"
                      min={1}
                      max={selectedWalkInResource?.total_units || 1}
                      value={walkInUnits}
                      onChange={(e) => setWalkInUnits(e.target.value)}
                      className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-xs"
                    />
                  </label>
                  <div className="space-y-1">
                    <PhoneInput
                      label="Phone (Optional)"
                      variant="sm"
                      value={walkInGuestPhone}
                      onChange={setWalkInGuestPhone}
                      placeholder="98620 00000"
                    />
                  </div>
                </div>

                <label className="block space-y-1">
                  <span className="font-bold text-[var(--ps-text-muted)]">
                    Guest / Reference Name *
                  </span>
                  <input
                    type="text"
                    required
                    value={walkInGuestName}
                    onChange={(e) => setWalkInGuestName(e.target.value)}
                    placeholder="e.g., Phone Booking — Lalram"
                    className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs"
                  />
                </label>

                <label className="block space-y-1">
                  <span className="font-bold text-[var(--ps-text-muted)]">
                    Notes (Optional)
                  </span>
                  <input
                    type="text"
                    value={walkInNotes}
                    onChange={(e) => setWalkInNotes(e.target.value)}
                    placeholder="Paid cash advance at reception"
                    className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs"
                  />
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2 border-t border-[var(--ps-border)]">
                <button
                  type="button"
                  onClick={() => setIsWalkInOpen(false)}
                  className="h-8 rounded-lg border border-[var(--ps-border)] px-3 text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingWalkIn}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 px-3.5 text-xs font-bold text-white disabled:opacity-50"
                >
                  {isSavingWalkIn ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Lock className="h-3.5 w-3.5" />
                  )}
                  <span>Lock Slot / Room</span>
                </button>
              </div>
            </form>
          </div>,
          document.body
        )}

      {/* ================================================================= */}
      {/* ADD / EDIT RESOURCE MODAL (z-[90])                                */}
      {/* ================================================================= */}
      {isResourceModalOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            onClick={() => !isSavingResource && handleCancelResourceModal()}
            className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/70 p-4 backdrop-blur-xs"
          >
            <form
              onSubmit={handleSaveResource}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-lg max-h-[88vh] overflow-y-auto rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5 space-y-3.5 shadow-2xl text-xs"
            >
              <div className="flex items-center justify-between border-b border-[var(--ps-border)] pb-2.5">
                <h3 className="text-sm font-extrabold text-[var(--ps-text)]">
                  {editingResourceId
                    ? 'Edit Space / Room Type'
                    : 'Add Space / Room Type'}
                </h3>
                <button
                  type="button"
                  onClick={handleCancelResourceModal}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--ps-border)] text-[var(--ps-text-muted)]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="space-y-1.5">
                <span className="text-[11px] font-bold text-[var(--ps-text-muted)]">
                  Quick Type Presets
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {(isHotel
                    ? [
                        'Standard Double Room',
                        'Deluxe AC Room',
                        'Family Suite',
                        'Dormitory Bed',
                      ]
                    : [
                        '5v5 Turf Arena',
                        '7v7 Football Ground',
                        'Badminton Court',
                        'Banquet / Conference Hall',
                        'Event Stage / Venue',
                      ]
                  ).map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() =>
                        setResForm((p) => ({ ...p, name: preset }))
                      }
                      className={`rounded-lg border px-2 py-1 text-[11px] font-semibold transition-colors ${
                        resForm.name === preset
                          ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)]/15 text-[var(--ps-text)]'
                          : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                      }`}
                    >
                      {preset}
                    </button>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <label className="space-y-1 sm:col-span-2">
                  <span className="font-bold text-[var(--ps-text-muted)]">
                    Name *
                  </span>
                  <input
                    type="text"
                    required
                    value={resForm.name}
                    onChange={(e) =>
                      setResForm((p) => ({ ...p, name: e.target.value }))
                    }
                    placeholder={
                      isHotel ? 'Deluxe Double Room' : '5v5 Turf Arena A'
                    }
                    className="h-8 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5"
                  />
                </label>

                <label className="space-y-1 sm:col-span-2">
                  <span className="font-bold text-[var(--ps-text-muted)]">
                    Short Description &amp; Included Features
                  </span>
                  <input
                    type="text"
                    value={resForm.description}
                    onChange={(e) =>
                      setResForm((p) => ({ ...p, description: e.target.value }))
                    }
                    placeholder={
                      isHotel
                        ? 'King bed, mountain view, Wi-Fi, geyser'
                        : 'FIFA-grade turf, changing room, drinking water'
                    }
                    className="h-8 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5"
                  />
                  <div className="flex flex-wrap gap-1 pt-1">
                    {(isHotel
                      ? [
                          'AC',
                          'Attached Bath',
                          'Free Wi-Fi',
                          'Hot Water',
                          'Breakfast Included',
                        ]
                      : [
                          'Floodlights',
                          'Parking',
                          'Changing Room',
                          'Power Backup',
                          'Sound System',
                        ]
                    ).map((tag) => {
                      const included = resForm.description
                        .toLowerCase()
                        .includes(tag.toLowerCase());
                      return (
                        <button
                          key={tag}
                          type="button"
                          onClick={() =>
                            setResForm((p) => {
                              if (included) return p;
                              const nextDesc = p.description.trim()
                                ? `${p.description.trim()} · ${tag}`
                                : tag;
                              return { ...p, description: nextDesc };
                            })
                          }
                          className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold ${
                            included
                              ? 'border-emerald-500/40 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                              : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)]'
                          }`}
                        >
                          + {tag}
                        </button>
                      );
                    })}
                  </div>
                </label>

                <div className="sm:col-span-2">
                  <QuickImageUploadField
                    label="Space / Room Cover Photo (Optional)"
                    value={resForm.cover_photo_url}
                    entityType="listing_gallery"
                    entityId={selectedListing?.id}
                    hubId={selectedListing?.hubId}
                    onUploaded={(nextUrl, storagePath) => {
                      setResForm((p) => ({ ...p, cover_photo_url: nextUrl }));
                      if (storagePath) {
                        setResourceTempPaths((prev) => [...prev, storagePath]);
                      }
                    }}
                  />
                </div>

                <div className="space-y-1">
                  <span className="font-bold text-[var(--ps-text-muted)]">
                    Booking Unit
                  </span>
                  <CustomSelectModal
                    options={BOOKING_UNIT_OPTIONS}
                    value={resForm.booking_unit}
                    onChange={(val) =>
                      setResForm((p) => ({
                        ...p,
                        booking_unit: val as BookingUnit,
                      }))
                    }
                    label="Select Booking Unit"
                  />
                </div>

                <label className="space-y-1">
                  <span className="font-bold text-[var(--ps-text-muted)]">
                    Base Rate (₹) *
                  </span>
                  <input
                    type="number"
                    min={0}
                    required
                    value={resForm.base_rate_inr}
                    onChange={(e) =>
                      setResForm((p) => ({
                        ...p,
                        base_rate_inr: e.target.value,
                      }))
                    }
                    className="h-8 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5"
                  />
                </label>

                <label className="space-y-1">
                  <span className="font-bold text-[var(--ps-text-muted)]">
                    Peak Rate (₹, Optional)
                  </span>
                  <input
                    type="number"
                    min={0}
                    value={resForm.peak_rate_inr}
                    onChange={(e) =>
                      setResForm((p) => ({
                        ...p,
                        peak_rate_inr: e.target.value,
                      }))
                    }
                    className="h-8 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5"
                  />
                </label>

                <label className="space-y-1">
                  <span className="font-bold text-[var(--ps-text-muted)]">
                    Peak Start Hour (0-23)
                  </span>
                  <input
                    type="number"
                    min={0}
                    max={23}
                    value={resForm.peak_start_hour}
                    onChange={(e) =>
                      setResForm((p) => ({
                        ...p,
                        peak_start_hour: e.target.value,
                      }))
                    }
                    className="h-8 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5"
                  />
                </label>

                <label className="space-y-1">
                  <span className="font-bold text-[var(--ps-text-muted)]">
                    Total Units (Rooms/Courts)
                  </span>
                  <input
                    type="number"
                    min={1}
                    value={resForm.total_units}
                    onChange={(e) =>
                      setResForm((p) => ({ ...p, total_units: e.target.value }))
                    }
                    className="h-8 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5"
                  />
                </label>

                <label className="space-y-1">
                  <span className="font-bold text-[var(--ps-text-muted)]">
                    Max Guests / Unit
                  </span>
                  <input
                    type="number"
                    min={1}
                    value={resForm.max_guests}
                    onChange={(e) =>
                      setResForm((p) => ({ ...p, max_guests: e.target.value }))
                    }
                    className="h-8 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5"
                  />
                </label>

                <label className="space-y-1">
                  <span className="font-bold text-[var(--ps-text-muted)]">
                    Open / Close Hours (IST)
                  </span>
                  <div className="grid grid-cols-2 gap-1.5">
                    <input
                      type="number"
                      min={0}
                      max={23}
                      value={resForm.open_hour}
                      onChange={(e) =>
                        setResForm((p) => ({ ...p, open_hour: e.target.value }))
                      }
                      className="h-8 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2"
                    />
                    <input
                      type="number"
                      min={1}
                      max={24}
                      value={resForm.close_hour}
                      onChange={(e) =>
                        setResForm((p) => ({ ...p, close_hour: e.target.value }))
                      }
                      className="h-8 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2"
                    />
                  </div>
                </label>

                <label className="space-y-1">
                  <span className="font-bold text-[var(--ps-text-muted)]">
                    Advance % &amp; Slot Mins
                  </span>
                  <div className="grid grid-cols-2 gap-1.5">
                    <input
                      type="number"
                      min={0}
                      max={100}
                      value={resForm.advance_percent}
                      onChange={(e) =>
                        setResForm((p) => ({
                          ...p,
                          advance_percent: e.target.value,
                        }))
                      }
                      placeholder="30%"
                      className="h-8 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2"
                    />
                    <input
                      type="number"
                      min={15}
                      value={resForm.slot_duration_mins}
                      onChange={(e) =>
                        setResForm((p) => ({
                          ...p,
                          slot_duration_mins: e.target.value,
                        }))
                      }
                      placeholder="60m"
                      className="h-8 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2"
                    />
                  </div>
                </label>
              </div>

              {/* Dynamic Add-Ons */}
              <div className="space-y-2 pt-1">
                <div className="flex items-center justify-between">
                  <span className="font-bold text-[var(--ps-text-muted)]">
                    Optional Add-Ons
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setResForm((p) => ({
                        ...p,
                        addons: [
                          ...p.addons,
                          { key: '', label: '', price_inr: 200, per_unit: false },
                        ],
                      }))
                    }
                    className="inline-flex h-7 items-center gap-1 rounded-md border border-[var(--ps-border)] px-2 text-[11px] font-bold"
                  >
                    <Plus className="h-3 w-3" />
                    Add
                  </button>
                </div>
                {resForm.addons.map((addon, idx) => (
                  <div key={idx} className="flex items-center gap-1.5">
                    <input
                      type="text"
                      placeholder="Label (e.g. Floodlights)"
                      value={addon.label}
                      onChange={(e) =>
                        setResForm((p) => ({
                          ...p,
                          addons: p.addons.map((a, i) =>
                            i === idx ? { ...a, label: e.target.value } : a
                          ),
                        }))
                      }
                      className="h-7 flex-1 rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2"
                    />
                    <input
                      type="number"
                      min={0}
                      placeholder="₹"
                      value={addon.price_inr}
                      onChange={(e) =>
                        setResForm((p) => ({
                          ...p,
                          addons: p.addons.map((a, i) =>
                            i === idx
                              ? { ...a, price_inr: Number(e.target.value || 0) }
                              : a
                          ),
                        }))
                      }
                      className="h-7 w-20 rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2"
                    />
                    <label className="inline-flex items-center gap-1 text-[10px]">
                      <input
                        type="checkbox"
                        checked={Boolean(addon.per_unit)}
                        onChange={(e) =>
                          setResForm((p) => ({
                            ...p,
                            addons: p.addons.map((a, i) =>
                              i === idx
                                ? { ...a, per_unit: e.target.checked }
                                : a
                            ),
                          }))
                        }
                      />
                      <span>/unit</span>
                    </label>
                    <button
                      type="button"
                      onClick={() =>
                        setResForm((p) => ({
                          ...p,
                          addons: p.addons.filter((_, i) => i !== idx),
                        }))
                      }
                      className="p-1 text-rose-500"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              <label className="inline-flex items-center gap-2 font-bold cursor-pointer">
                <input
                  type="checkbox"
                  checked={resForm.is_active}
                  onChange={(e) =>
                    setResForm((p) => ({ ...p, is_active: e.target.checked }))
                  }
                />
                <span>Active &amp; Bookable Online</span>
              </label>

              <div className="flex justify-end gap-2 pt-2 border-t border-[var(--ps-border)]">
                <button
                  type="button"
                  onClick={handleCancelResourceModal}
                  className="h-8 rounded-lg border border-[var(--ps-border)] px-3 font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingResource}
                  className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-theme-primary px-3.5 font-bold text-[hsl(var(--color-primary-foreground))] disabled:opacity-50"
                >
                  {isSavingResource ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <Save className="h-3.5 w-3.5" />
                  )}
                  <span>Save Resource</span>
                </button>
              </div>
            </form>
          </div>,
          document.body
        )}

      {confirmDialog}

      {/* Booking Cancellation Reason FormModal (v18b) */}
      <FormModal
        isOpen={Boolean(cancelBookingTarget)}
        onClose={() => {
          setCancelBookingTarget(null);
          setCancelBookingReason('');
          setCancelBookingTouched(false);
          setCancelBookingSubmitted(false);
        }}
        title={
          cancelBookingTarget
            ? `Cancel Booking ${cancelBookingTarget.booking_code}`
            : 'Cancel Booking'
        }
        subtitle="Provide a clear cancellation reason for the guest and audit log."
        isDirty={cancelBookingReason.trim().length > 0}
        isValid={cancelBookingReason.trim().length >= 5}
        validationSummary={
          cancelBookingSubmitted && cancelBookingReason.trim().length < 5
            ? ['Please provide a cancellation reason (at least 5 characters).']
            : undefined
        }
        onSubmitAttempt={() => setCancelBookingSubmitted(true)}
        isSubmitting={Boolean(
          cancelBookingTarget && busyBookingId === cancelBookingTarget.id
        )}
        submitLabel="Confirm Cancellation"
        cancelLabel="Keep Booking"
        confirmSubmitTitle="Cancel Guest Booking?"
        confirmSubmitDescription="Immediately releases the reserved slot/room and notifies the guest."
        confirmSubmitVariant="danger"
        maxWidthClassName="max-w-md"
        cautions={[
          'Cancelling immediately releases the reserved slot/room and notifies the guest. Paid escrow deposits follow platform refund rules.',
        ]}
        onSubmit={async () => {
          const trimmed = cancelBookingReason.trim();
          if (!cancelBookingTarget || trimmed.length < 5) return;
          const target = cancelBookingTarget;
          setCancelBookingTarget(null);
          setCancelBookingReason('');
          setCancelBookingTouched(false);
          setCancelBookingSubmitted(false);
          await handleBookingAction(target, 'cancel_booking', trimmed);
        }}
      >
        <div className="space-y-2">
          <label className="block text-xs font-semibold text-[var(--ps-text)]">
            Cancellation Reason *
          </label>
          <textarea
            rows={3}
            value={cancelBookingReason}
            onChange={(e) => {
              setCancelBookingTouched(true);
              setCancelBookingReason(e.target.value);
            }}
            onBlur={() => setCancelBookingTouched(true)}
            placeholder="e.g. Facility maintenance, unexpected closure, or requested by guest…"
            className="w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 text-xs text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none"
          />
          {(cancelBookingSubmitted || cancelBookingTouched) &&
            cancelBookingReason.trim().length < 5 && (
              <p className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
                Please provide a cancellation reason (at least 5 characters).
              </p>
            )}
        </div>
      </FormModal>

      {/* Pro Subscription Checkout Modal (z-[90]) */}
      <UniversalPaymentModal
        open={Boolean(upgradeIntent)}
        intent={upgradeIntent}
        title={upgradePlanLabel || 'Pro Subscription'}
        subtitle="Activate instant online bookings & escrow"
        onSubmitted={() => {
          setUpgradeIntent(null);
          emitNotice(
            'success',
            'Subscription payment submitted! Entitlement updates automatically upon verification.'
          );
          void loadWorkspaceData();
        }}
        onClose={() => setUpgradeIntent(null)}
      />
    </div>
  );
}

export default OwnerBookingManager;
