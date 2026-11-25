'use client';

import React, { useMemo, useState } from 'react';
import {
  Calendar,
  Car,
  CheckCircle2,
  ExternalLink,
  KeyRound,
  MapPin,
  Navigation,
  PauseCircle,
  PlayCircle,
  Plus,
  RefreshCw,
  SquarePen,
  Trash2,
  Users,
} from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { FormModal } from '@/components/ui/FormModal';
import {
  PhoneInput,
  isValidCountryPhone,
  normalizePhoneToE164,
} from '@/components/ui/PhoneInput';
import { MapCoordinatePicker } from '@/components/workspaces/shared/MapCoordinatePicker';
import type {
  VehicleBookingMode,
  VehicleFixedRoute,
  VehicleListingRecord,
  VehiclePricingModel,
} from '@/lib/payments/types';
import type { VehicleTypeItem } from '@/lib/pick-n-drop/types';
import {
  buildSafeGoogleMapsRouteUrl,
  formatInr,
  type DriverOtpMilestone,
  type DriverProfileRow,
  type HandoverTarget,
} from '@/lib/driver/types';
import { supabase } from '@/lib/supabase/client';

export interface DriverScheduledBookingRow {
  id: string;
  booking_code: string;
  vehicle_listing_id: string;
  vehicle_title: string;
  assigned_driver_id: string | null;
  booking_mode: 'full_vehicle' | 'per_seat' | string;
  seats_booked: number;
  start_time: string;
  end_time: string;
  pickup_location: string;
  dropoff_location: string | null;
  total_fare_inr: number;
  advance_amount_inr: number;
  balance_due_inr: number;
  status: string;
  escrow_status?: string | null;
}

export interface DriverVehicleListingExtended extends VehicleListingRecord {
  contact_phone?: string | null;
}

export interface DriverVehiclesAndChartersProps {
  authUserId: string;
  hubId: string | null;
  driver: DriverProfileRow | null;
  isKycReady: boolean;
  vehicleTypes: VehicleTypeItem[];
  listings: DriverVehicleListingExtended[];
  bookings: DriverScheduledBookingRow[];
  bookingMilestones: Record<string, DriverOtpMilestone>;
  vehiclesEscrowRequired: boolean;
  loading: boolean;
  onRefresh: () => void;
  onNotice: (notice: { type: 'success' | 'error' | 'info'; text: string }) => void;
  onOpenHandover: (target: HandoverTarget) => void;
}

interface VehicleFormState {
  id: string | null;
  title: string;
  description: string;
  vehicle_type_id: string;
  stand_locality: string;
  lat: number;
  lng: number;
  contact_phone: string;
  booking_mode: VehicleBookingMode;
  total_seats: string;
  pricing_model: VehiclePricingModel;
  rate_daily_inr: string;
  rate_hourly_inr: string;
  rate_per_km_inr: string;
  advance_percent: string;
  with_driver: boolean;
  fixed_routes: VehicleFixedRoute[];
}

const DEFAULT_LAMKA_COORDS = { lat: 24.3335, lng: 93.6978 };

const QUICK_STANDS = [
  { id: 'tuibong', label: 'Tuibong Bus Stand', lat: 24.3422, lng: 93.7048 },
  { id: 'central', label: 'Central Lamka Stand', lat: 24.3335, lng: 93.6978 },
  { id: 'new-lamka', label: 'New Lamka Traffic Point', lat: 24.3248, lng: 93.6921 },
  { id: 'rengkai', label: 'Rengkai Road Stand', lat: 24.3374, lng: 93.7115 },
];

function createInitialForm(
  vehicleTypes: VehicleTypeItem[],
  driver: DriverProfileRow | null
): VehicleFormState {
  return {
    id: null,
    title: '',
    description: '',
    vehicle_type_id: vehicleTypes[0]?.id || '',
    stand_locality: 'Central Lamka Stand',
    lat: DEFAULT_LAMKA_COORDS.lat,
    lng: DEFAULT_LAMKA_COORDS.lng,
    contact_phone: normalizePhoneToE164(driver?.phone || '', '+91'),
    booking_mode: 'both',
    total_seats: '7',
    pricing_model: 'fixed_route',
    rate_daily_inr: '3500',
    rate_hourly_inr: '450',
    rate_per_km_inr: '18',
    advance_percent: '25',
    with_driver: true,
    fixed_routes: [
      {
        origin: 'Lamka',
        destination: 'Imphal',
        fare_inr: 350,
        full_vehicle_fare_inr: 2200,
        duration_label: '2h 15m',
      },
    ],
  };
}

export function DriverVehiclesAndCharters({
  authUserId,
  hubId,
  driver,
  isKycReady,
  vehicleTypes,
  listings,
  bookings,
  bookingMilestones,
  vehiclesEscrowRequired,
  loading,
  onRefresh,
  onNotice,
  onOpenHandover,
}: DriverVehiclesAndChartersProps) {
  const [subView, setSubView] = useState<'listings' | 'reservations'>('listings');
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<VehicleFormState>(() =>
    createInitialForm(vehicleTypes, driver)
  );
  const [initialSnapshot, setInitialSnapshot] = useState<string>('');
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [saving, setSaving] = useState(false);

  const [toggleConfirm, setToggleConfirm] =
    useState<DriverVehicleListingExtended | null>(null);
  const [deleteConfirm, setDeleteConfirm] =
    useState<DriverVehicleListingExtended | null>(null);
  const [claimBookingConfirm, setClaimBookingConfirm] =
    useState<DriverScheduledBookingRow | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  const openCreateModal = () => {
    const fresh = createInitialForm(vehicleTypes, driver);
    setForm(fresh);
    setInitialSnapshot(JSON.stringify(fresh));
    setTouched({});
    setSubmitAttempted(false);
    setModalOpen(true);
  };

  const openEditModal = (listing: DriverVehicleListingExtended) => {
    const next: VehicleFormState = {
      id: listing.id,
      title: listing.title || '',
      description: listing.description || '',
      vehicle_type_id: listing.vehicle_type_id || vehicleTypes[0]?.id || '',
      stand_locality: listing.stand_locality || '',
      lat: Number.isFinite(listing.lat) ? listing.lat : DEFAULT_LAMKA_COORDS.lat,
      lng: Number.isFinite(listing.lng) ? listing.lng : DEFAULT_LAMKA_COORDS.lng,
      contact_phone: normalizePhoneToE164(
        listing.contact_phone || driver?.phone || '',
        '+91'
      ),
      booking_mode: listing.booking_mode || 'both',
      total_seats: String(listing.total_seats ?? 7),
      pricing_model: listing.pricing_model || 'daily',
      rate_daily_inr:
        listing.rate_daily_inr != null ? String(listing.rate_daily_inr) : '',
      rate_hourly_inr:
        listing.rate_hourly_inr != null ? String(listing.rate_hourly_inr) : '',
      rate_per_km_inr:
        listing.rate_per_km_inr != null ? String(listing.rate_per_km_inr) : '',
      advance_percent: String(listing.advance_percent ?? 25),
      with_driver: listing.with_driver !== false,
      fixed_routes: Array.isArray(listing.fixed_routes)
        ? listing.fixed_routes
        : [],
    };
    setForm(next);
    setInitialSnapshot(JSON.stringify(next));
    setTouched({});
    setSubmitAttempted(false);
    setModalOpen(true);
  };

  const fieldErrors = useMemo(() => {
    const errs: Record<string, string> = {};
    if (!form.title.trim() || form.title.trim().length < 4) {
      errs.title = 'Enter a descriptive vehicle or route title (at least 4 characters).';
    }
    if (!form.vehicle_type_id) {
      errs.vehicle_type_id = 'Select a fleet class.';
    }
    if (!form.stand_locality.trim()) {
      errs.stand_locality = 'Enter the stand or boarding locality.';
    }
    if (form.contact_phone.trim() && !isValidCountryPhone(form.contact_phone)) {
      errs.contact_phone = 'Enter a valid 10-digit mobile number with country code (+91).';
    }
    const seats = Number(form.total_seats);
    if (!Number.isInteger(seats) || seats < 1 || seats > 60) {
      errs.total_seats = 'Total seats must be a whole number between 1 and 60.';
    }
    const adv = Number(form.advance_percent);
    if (!Number.isFinite(adv) || adv < 0 || adv > 100) {
      errs.advance_percent = 'Advance percentage must be between 0% and 100%.';
    }
    if (form.pricing_model === 'daily' && Number(form.rate_daily_inr) <= 0) {
      errs.rate = 'Enter a positive daily charter rate (₹).';
    }
    if (form.pricing_model === 'hourly' && Number(form.rate_hourly_inr) <= 0) {
      errs.rate = 'Enter a positive hourly rate (₹).';
    }
    if (form.pricing_model === 'per_km' && Number(form.rate_per_km_inr) <= 0) {
      errs.rate = 'Enter a positive per-km rate (₹).';
    }
    if (form.pricing_model === 'fixed_route') {
      const validRoutes = form.fixed_routes.filter(
        (r) => r.origin.trim() && r.destination.trim() && Number(r.fare_inr) > 0
      );
      if (validRoutes.length === 0) {
        errs.rate = 'Add at least one fixed route with origin, destination, and fare (₹).';
      }
    }
    return errs;
  }, [form]);

  const validationSummary = useMemo(
    () => Object.values(fieldErrors),
    [fieldErrors]
  );
  const isDirty = useMemo(
    () => JSON.stringify(form) !== initialSnapshot,
    [form, initialSnapshot]
  );

  const handleSaveListing = async () => {
    setSaving(true);
    try {
      const cleanedRoutes = form.fixed_routes
        .filter((r) => r.origin.trim() && r.destination.trim())
        .map((r) => ({
          origin: r.origin.trim(),
          destination: r.destination.trim(),
          fare_inr: Math.max(0, Number(r.fare_inr) || 0),
          full_vehicle_fare_inr:
            r.full_vehicle_fare_inr && Number(r.full_vehicle_fare_inr) > 0
              ? Number(r.full_vehicle_fare_inr)
              : undefined,
          duration_label: r.duration_label?.trim() || undefined,
        }));

      const payload = {
        owner_id: authUserId,
        driver_id: driver?.id || null,
        origin_hub_id: hubId || driver?.hub_id || null,
        vehicle_type_id: form.vehicle_type_id,
        title: form.title.trim(),
        description: form.description.trim() || null,
        stand_locality: form.stand_locality.trim(),
        lat: form.lat,
        lng: form.lng,
        contact_phone: form.contact_phone.trim() || null,
        booking_mode: form.booking_mode,
        total_seats: Number(form.total_seats),
        pricing_model: form.pricing_model,
        rate_daily_inr: form.rate_daily_inr ? Number(form.rate_daily_inr) : null,
        rate_hourly_inr: form.rate_hourly_inr
          ? Number(form.rate_hourly_inr)
          : null,
        rate_per_km_inr: form.rate_per_km_inr
          ? Number(form.rate_per_km_inr)
          : null,
        fixed_routes: cleanedRoutes,
        advance_percent: vehiclesEscrowRequired
          ? Math.max(10, Number(form.advance_percent) || 25)
          : Number(form.advance_percent) || 0,
        with_driver: form.with_driver,
      };

      if (form.id) {
        const { error } = await supabase
          .from('vehicle_listings')
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('id', form.id);
        if (error) throw error;
        onNotice({
          type: 'success',
          text: `Updated scheduled vehicle "${payload.title}".`,
        });
      } else {
        const { error } = await supabase
          .from('vehicle_listings')
          .insert({ ...payload, is_active: true });
        if (error) throw error;
        onNotice({
          type: 'success',
          text: `Published scheduled vehicle "${payload.title}".`,
        });
      }

      setModalOpen(false);
      onRefresh();
    } catch (err) {
      onNotice({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Could not save scheduled vehicle listing.',
      });
    } finally {
      setSaving(false);
    }
  };

  const handleConfirmToggleActive = async () => {
    if (!toggleConfirm) return;
    setActionBusy(true);
    try {
      const nextActive = !toggleConfirm.is_active;
      const { error } = await supabase
        .from('vehicle_listings')
        .update({ is_active: nextActive, updated_at: new Date().toISOString() })
        .eq('id', toggleConfirm.id);
      if (error) throw error;
      onNotice({
        type: 'success',
        text: nextActive
          ? `"${toggleConfirm.title}" is now Live for bookings.`
          : `"${toggleConfirm.title}" has been paused.`,
      });
      setToggleConfirm(null);
      onRefresh();
    } catch (err) {
      onNotice({
        type: 'error',
        text: err instanceof Error ? err.message : 'Status update failed.',
      });
    } finally {
      setActionBusy(false);
    }
  };

  const handleConfirmDeleteListing = async () => {
    if (!deleteConfirm) return;
    setActionBusy(true);
    try {
      const { error } = await supabase
        .from('vehicle_listings')
        .delete()
        .eq('id', deleteConfirm.id);
      if (error) throw error;
      onNotice({
        type: 'info',
        text: `Removed vehicle listing "${deleteConfirm.title}".`,
      });
      setDeleteConfirm(null);
      onRefresh();
    } catch (err) {
      onNotice({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Could not delete this listing (check active bookings).',
      });
    } finally {
      setActionBusy(false);
    }
  };

  const handleConfirmClaimBooking = async () => {
    if (!claimBookingConfirm) return;
    setActionBusy(true);
    try {
      const { error } = await supabase.rpc('driver_accept_job', {
        p_booking_id: claimBookingConfirm.id,
      });
      if (error) throw error;
      onNotice({
        type: 'success',
        text: `Assigned scheduled booking ${claimBookingConfirm.booking_code} to your driver account.`,
      });
      setClaimBookingConfirm(null);
      onRefresh();
    } catch (err) {
      onNotice({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Could not claim this scheduled booking.',
      });
    } finally {
      setActionBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-3">
        {[1, 2].map((idx) => (
          <div
            key={idx}
            className="h-36 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] dd-shimmer"
          />
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header & Sub-View Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4">
        <div>
          <h2 className="text-base font-bold text-[var(--ps-text)]">
            Scheduled Vehicles &amp; Inter-Hub Charters
          </h2>
          <p className="text-xs text-[var(--ps-text-muted)]">
            Publish your stand routes, per-seat / full charter fares, and verify incoming passenger reservations.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] cursor-pointer"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh
          </button>
          <button
            type="button"
            onClick={openCreateModal}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-4 text-xs font-bold text-[var(--ps-accent-fg)] shadow-xs hover:opacity-95 cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            Add Vehicle / Route
          </button>
        </div>
      </div>

      {/* Sub-Tabs */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setSubView('listings')}
          className={`inline-flex min-h-[44px] items-center gap-2 rounded-xl border px-4 text-xs font-bold transition-colors cursor-pointer ${
            subView === 'listings'
              ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
              : 'border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
          }`}
        >
          <Car className="h-4 w-4" />
          <span>My Scheduled Vehicles ({listings.length})</span>
        </button>
        <button
          type="button"
          onClick={() => setSubView('reservations')}
          className={`inline-flex min-h-[44px] items-center gap-2 rounded-xl border px-4 text-xs font-bold transition-colors cursor-pointer ${
            subView === 'reservations'
              ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
              : 'border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
          }`}
        >
          <Calendar className="h-4 w-4" />
          <span>Incoming Reservations ({bookings.length})</span>
        </button>
      </div>

      {/* My Vehicles List */}
      {subView === 'listings' ? (
        listings.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-surface)] p-8 text-center space-y-3">
            <Car className="mx-auto h-9 w-9 text-[var(--ps-text-muted)] opacity-60" />
            <div>
              <p className="text-sm font-bold text-[var(--ps-text)]">
                No scheduled vehicles listed yet
              </p>
              <p className="mt-1 text-xs text-[var(--ps-text-muted)]">
                List your Sumo, Bolero, Eeco, or local charter vehicle with stand coordinates and per-seat or full-vehicle rates.
              </p>
            </div>
            <button
              type="button"
              onClick={openCreateModal}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-5 text-xs font-bold text-[var(--ps-accent-fg)] cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              Create First Vehicle Listing
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {listings.map((item) => (
              <div
                key={item.id}
                className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="text-sm font-bold text-[var(--ps-text)] truncate">
                        {item.title}
                      </h3>
                      <span
                        className={`rounded-full border px-2 py-0.5 text-[10px] font-bold ${
                          item.is_active
                            ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                            : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)]'
                        }`}
                      >
                        {item.is_active ? 'Live' : 'Paused'}
                      </span>
                    </div>
                    <p className="mt-1 flex items-center gap-1.5 text-xs text-[var(--ps-text-muted)]">
                      <MapPin className="h-3.5 w-3.5 shrink-0 text-[var(--ps-accent)]" />
                      <span className="truncate">{item.stand_locality}</span>
                    </p>
                  </div>

                  <span className="inline-flex items-center gap-1 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 py-1 text-[11px] font-bold text-[var(--ps-text)]">
                    <Users className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
                    {item.total_seats} Seats
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-2 text-[11px] text-[var(--ps-text-muted)]">
                  <span className="rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-1 font-semibold">
                    Mode:{' '}
                    {item.booking_mode === 'both'
                      ? 'Per-Seat & Full Charter'
                      : item.booking_mode === 'per_seat'
                        ? 'Per-Seat'
                        : 'Full Charter'}
                  </span>
                  <span className="rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-1 font-semibold">
                    Advance: {item.advance_percent}%
                  </span>
                  {item.rate_daily_inr ? (
                    <span className="rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-1 font-mono font-bold text-[var(--ps-text)]">
                      {formatInr(item.rate_daily_inr)}/day
                    </span>
                  ) : null}
                  {Array.isArray(item.fixed_routes) &&
                    item.fixed_routes.length > 0 && (
                      <span className="rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-1 font-semibold text-[var(--ps-text)]">
                        {item.fixed_routes[0].origin} ↔{' '}
                        {item.fixed_routes[0].destination} (
                        {formatInr(item.fixed_routes[0].fare_inr)})
                      </span>
                    )}
                </div>

                <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--ps-border)] pt-3">
                  <button
                    type="button"
                    onClick={() => openEditModal(item)}
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] cursor-pointer"
                  >
                    <SquarePen className="h-3.5 w-3.5" />
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => setToggleConfirm(item)}
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] cursor-pointer"
                  >
                    {item.is_active ? (
                      <>
                        <PauseCircle className="h-3.5 w-3.5 text-amber-500" />
                        Pause
                      </>
                    ) : (
                      <>
                        <PlayCircle className="h-3.5 w-3.5 text-emerald-500" />
                        Resume
                      </>
                    )}
                  </button>
                  <button
                    type="button"
                    onClick={() => setDeleteConfirm(item)}
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/8 px-3 text-xs font-semibold text-rose-700 dark:text-rose-300 hover:bg-rose-500/15 cursor-pointer"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )
      ) : bookings.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-surface)] p-8 text-center space-y-2">
          <Calendar className="mx-auto h-9 w-9 text-[var(--ps-text-muted)] opacity-60" />
          <p className="text-sm font-bold text-[var(--ps-text)]">
            No scheduled vehicle reservations yet
          </p>
          <p className="text-xs text-[var(--ps-text-muted)]">
            Confirmed per-seat and charter bookings assigned to your vehicles appear here.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {bookings.map((b) => {
            const ms = bookingMilestones[b.id];
            const pickupDone =
              Boolean(ms?.pickup_verified) ||
              b.status === 'in_progress' ||
              b.status === 'completed';
            const dropoffDone =
              Boolean(ms?.dropoff_verified) || b.status === 'completed';
            const nextStage =
              b.status === 'confirmed' && !pickupDone
                ? ('pickup' as const)
                : (b.status === 'in_progress' || pickupDone) &&
                    !dropoffDone &&
                    b.status !== 'cancelled' &&
                    b.status !== 'disputed'
                  ? ('dropoff' as const)
                  : null;
            const mapsUrl = buildSafeGoogleMapsRouteUrl({
              originAddress: b.pickup_location,
              destAddress: b.dropoff_location || b.pickup_location,
            });
            const needsClaim =
              !b.assigned_driver_id &&
              b.status === 'confirmed' &&
              Boolean(driver?.id);

            return (
              <div
                key={b.id}
                className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3"
              >
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-extrabold text-[var(--ps-text)]">
                        {b.booking_code}
                      </span>
                      <span className="rounded-full border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--ps-text-muted)]">
                        {b.status.replace(/_/g, ' ')}
                      </span>
                      <span className="text-xs font-semibold text-[var(--ps-text-muted)]">
                        {b.vehicle_title}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-[var(--ps-text-muted)]">
                      {b.booking_mode === 'per_seat'
                        ? `${b.seats_booked} seat(s)`
                        : 'Full Vehicle Charter'}{' '}
                      · Total {formatInr(b.total_fare_inr)} (Advance{' '}
                      <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                        {formatInr(b.advance_amount_inr)}
                      </span>
                      )
                    </p>
                  </div>

                  <a
                    href={mapsUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs font-semibold text-[var(--ps-accent)] hover:border-[var(--ps-accent)]"
                  >
                    <Navigation className="h-3.5 w-3.5" />
                    <span>Maps</span>
                    <ExternalLink className="h-3 w-3" />
                  </a>
                </div>

                <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 text-xs space-y-1">
                  <p className="text-[var(--ps-text)]">
                    <span className="font-bold">Pickup: </span>
                    {b.pickup_location}
                  </p>
                  {b.dropoff_location && (
                    <p className="text-[var(--ps-text-muted)]">
                      <span className="font-bold text-[var(--ps-text)]">
                        Dropoff:{' '}
                      </span>
                      {b.dropoff_location}
                    </p>
                  )}
                  <p className="text-[11px] text-[var(--ps-text-muted)]">
                    Departure:{' '}
                    {new Date(b.start_time).toLocaleString('en-IN', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </p>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  <div className="flex items-center gap-2 text-[11px] font-semibold">
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 ${
                        pickupDone
                          ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                          : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)]'
                      }`}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Start OTP
                    </span>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 ${
                        dropoffDone
                          ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                          : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)]'
                      }`}
                    >
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      Dropoff OTP
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {needsClaim && (
                      <button
                        type="button"
                        disabled={!isKycReady}
                        onClick={() => setClaimBookingConfirm(b)}
                        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[var(--ps-accent)] bg-[var(--ps-accent)]/10 px-4 text-xs font-bold text-[var(--ps-accent)] disabled:opacity-45 cursor-pointer"
                      >
                        Claim Booking
                      </button>
                    )}

                    {nextStage && (
                      <button
                        type="button"
                        onClick={() =>
                          onOpenHandover({
                            bookingId: b.id,
                            domain: 'vehicle_booking',
                            code: b.booking_code,
                            stage: nextStage,
                            podRequired: false,
                            originLabel: b.pickup_location,
                            destinationLabel:
                              b.dropoff_location || b.vehicle_title,
                          })
                        }
                        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-4 text-xs font-bold text-[var(--ps-accent-fg)] shadow-xs hover:opacity-95 cursor-pointer"
                      >
                        <KeyRound className="h-4 w-4" />
                        <span>
                          {nextStage === 'pickup'
                            ? 'Verify Start OTP'
                            : 'Verify Dropoff OTP'}
                        </span>
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Create / Edit Scheduled Vehicle Modal */}
      <FormModal
        isOpen={modalOpen}
        title={form.id ? 'Edit Scheduled Vehicle' : 'Add Scheduled Vehicle / Route'}
        subtitle="Pin your boarding stand on the map and configure seat or full-vehicle charter pricing."
        hints={[
          'Use the map pin to set your exact stand or boarding pickup location.',
          vehiclesEscrowRequired
            ? 'Platform escrow policy is active: a minimum 10% advance hold applies to vehicle reservations.'
            : 'Advance % is optional when platform escrow is turned off.',
        ]}
        isDirty={isDirty}
        isValid={validationSummary.length === 0}
        validationSummary={validationSummary}
        onSubmitAttempt={() => setSubmitAttempted(true)}
        submitLabel={form.id ? 'Save Vehicle Changes' : 'Publish Vehicle'}
        confirmSubmitTitle={
          form.id ? 'Save Vehicle Updates?' : 'Publish Scheduled Vehicle?'
        }
        confirmSubmitDescription="Your vehicle listing and stand coordinates will be updated immediately."
        isSubmitting={saving}
        maxWidthClassName="max-w-2xl"
        onSubmit={handleSaveListing}
        onClose={() => setModalOpen(false)}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1 sm:col-span-2">
            <label
              htmlFor="veh-title"
              className="block text-xs font-bold text-[var(--ps-text)]"
            >
              Vehicle / Route Title *
            </label>
            <input
              id="veh-title"
              type="text"
              value={form.title}
              onChange={(e) => setForm((p) => ({ ...p, title: e.target.value }))}
              onBlur={() => setTouched((p) => ({ ...p, title: true }))}
              placeholder="e.g., Lamka ↔ Imphal Morning Sumo (7-Seater)"
              className="w-full min-h-[44px] rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 text-xs text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none"
            />
            {(touched.title || submitAttempted) && fieldErrors.title && (
              <p className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
                {fieldErrors.title}
              </p>
            )}
          </div>

          <div className="space-y-1">
            <label
              htmlFor="veh-class"
              className="block text-xs font-bold text-[var(--ps-text)]"
            >
              Fleet Class *
            </label>
            <select
              id="veh-class"
              value={form.vehicle_type_id}
              onChange={(e) =>
                setForm((p) => ({ ...p, vehicle_type_id: e.target.value }))
              }
              className="w-full min-h-[44px] rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none"
            >
              {vehicleTypes.map((vt) => (
                <option key={vt.id} value={vt.id}>
                  {vt.name}
                </option>
              ))}
            </select>
          </div>

          <div className="space-y-1">
            <label
              htmlFor="veh-seats"
              className="block text-xs font-bold text-[var(--ps-text)]"
            >
              Total Passenger Seats *
            </label>
            <input
              id="veh-seats"
              type="number"
              min={1}
              max={60}
              value={form.total_seats}
              onChange={(e) =>
                setForm((p) => ({ ...p, total_seats: e.target.value }))
              }
              onBlur={() => setTouched((p) => ({ ...p, total_seats: true }))}
              className="w-full min-h-[44px] rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 text-xs text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none"
            />
            {(touched.total_seats || submitAttempted) &&
              fieldErrors.total_seats && (
                <p className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
                  {fieldErrors.total_seats}
                </p>
              )}
          </div>

          <div className="space-y-1">
            <label
              htmlFor="veh-mode"
              className="block text-xs font-bold text-[var(--ps-text)]"
            >
              Booking Mode
            </label>
            <select
              id="veh-mode"
              value={form.booking_mode}
              onChange={(e) =>
                setForm((p) => ({
                  ...p,
                  booking_mode: e.target.value as VehicleBookingMode,
                }))
              }
              className="w-full min-h-[44px] rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none"
            >
              <option value="both">Both Per-Seat &amp; Full Charter</option>
              <option value="per_seat">Per-Seat Shared Service Only</option>
              <option value="full_vehicle">Full Vehicle Charter Only</option>
            </select>
          </div>

          <div className="space-y-1">
            <label
              htmlFor="veh-pricing-model"
              className="block text-xs font-bold text-[var(--ps-text)]"
            >
              Pricing Model
            </label>
            <select
              id="veh-pricing-model"
              value={form.pricing_model}
              onChange={(e) =>
                setForm((p) => ({
                  ...p,
                  pricing_model: e.target.value as VehiclePricingModel,
                }))
              }
              className="w-full min-h-[44px] rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none"
            >
              <option value="fixed_route">Fixed Route (Lamka ↔ Imphal)</option>
              <option value="daily">Daily Charter Rate (₹)</option>
              <option value="hourly">Hourly Local Hire (₹)</option>
              <option value="per_km">Per-Kilometre Rate (₹)</option>
            </select>
          </div>

          {/* Pricing Inputs */}
          {form.pricing_model === 'daily' && (
            <div className="space-y-1">
              <label
                htmlFor="veh-rate-daily"
                className="block text-xs font-bold text-[var(--ps-text)]"
              >
                Daily Charter Rate (₹) *
              </label>
              <input
                id="veh-rate-daily"
                type="number"
                min={0}
                value={form.rate_daily_inr}
                onChange={(e) =>
                  setForm((p) => ({ ...p, rate_daily_inr: e.target.value }))
                }
                className="w-full min-h-[44px] rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 text-xs text-[var(--ps-text)]"
              />
            </div>
          )}

          {form.pricing_model === 'hourly' && (
            <div className="space-y-1">
              <label
                htmlFor="veh-rate-hourly"
                className="block text-xs font-bold text-[var(--ps-text)]"
              >
                Hourly Rate (₹) *
              </label>
              <input
                id="veh-rate-hourly"
                type="number"
                min={0}
                value={form.rate_hourly_inr}
                onChange={(e) =>
                  setForm((p) => ({ ...p, rate_hourly_inr: e.target.value }))
                }
                className="w-full min-h-[44px] rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 text-xs text-[var(--ps-text)]"
              />
            </div>
          )}

          {form.pricing_model === 'per_km' && (
            <div className="space-y-1">
              <label
                htmlFor="veh-rate-km"
                className="block text-xs font-bold text-[var(--ps-text)]"
              >
                Per-Km Rate (₹) *
              </label>
              <input
                id="veh-rate-km"
                type="number"
                min={0}
                value={form.rate_per_km_inr}
                onChange={(e) =>
                  setForm((p) => ({ ...p, rate_per_km_inr: e.target.value }))
                }
                className="w-full min-h-[44px] rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 text-xs text-[var(--ps-text)]"
              />
            </div>
          )}

          <div className="space-y-1">
            <label
              htmlFor="veh-adv"
              className="block text-xs font-bold text-[var(--ps-text)]"
            >
              Advance Booking Hold (%) *
            </label>
            <input
              id="veh-adv"
              type="number"
              min={vehiclesEscrowRequired ? 10 : 0}
              max={100}
              value={form.advance_percent}
              onChange={(e) =>
                setForm((p) => ({ ...p, advance_percent: e.target.value }))
              }
              className="w-full min-h-[44px] rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 text-xs text-[var(--ps-text)]"
            />
          </div>

          {/* Fixed Routes Builder */}
          {form.pricing_model === 'fixed_route' && (
            <div className="sm:col-span-2 space-y-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)]/60 p-3.5">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-[var(--ps-text)]">
                  Fixed Routes (Per-Seat &amp; Full Charter Fares)
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setForm((p) => ({
                      ...p,
                      fixed_routes: [
                        ...p.fixed_routes,
                        {
                          origin: 'Lamka',
                          destination: '',
                          fare_inr: 350,
                          full_vehicle_fare_inr: 2200,
                          duration_label: '2h',
                        },
                      ],
                    }))
                  }
                  className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 text-[11px] font-bold text-[var(--ps-accent)] cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Route
                </button>
              </div>

              {form.fixed_routes.map((route, idx) => (
                <div
                  key={idx}
                  className="grid grid-cols-2 gap-2 sm:grid-cols-5 items-center"
                >
                  <input
                    type="text"
                    placeholder="Origin"
                    value={route.origin}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        fixed_routes: p.fixed_routes.map((r, i) =>
                          i === idx ? { ...r, origin: e.target.value } : r
                        ),
                      }))
                    }
                    className="min-h-[44px] rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 text-xs"
                  />
                  <input
                    type="text"
                    placeholder="Destination"
                    value={route.destination}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        fixed_routes: p.fixed_routes.map((r, i) =>
                          i === idx ? { ...r, destination: e.target.value } : r
                        ),
                      }))
                    }
                    className="min-h-[44px] rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 text-xs"
                  />
                  <input
                    type="number"
                    min={0}
                    placeholder="Seat ₹"
                    value={route.fare_inr}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        fixed_routes: p.fixed_routes.map((r, i) =>
                          i === idx
                            ? { ...r, fare_inr: Number(e.target.value) || 0 }
                            : r
                        ),
                      }))
                    }
                    className="min-h-[44px] rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 text-xs"
                  />
                  <input
                    type="number"
                    min={0}
                    placeholder="Full ₹"
                    value={route.full_vehicle_fare_inr ?? ''}
                    onChange={(e) =>
                      setForm((p) => ({
                        ...p,
                        fixed_routes: p.fixed_routes.map((r, i) =>
                          i === idx
                            ? {
                                ...r,
                                full_vehicle_fare_inr:
                                  Number(e.target.value) || 0,
                              }
                            : r
                        ),
                      }))
                    }
                    className="min-h-[44px] rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 text-xs"
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setForm((p) => ({
                        ...p,
                        fixed_routes: p.fixed_routes.filter((_, i) => i !== idx),
                      }))
                    }
                    aria-label="Remove route"
                    className="inline-flex min-h-[44px] items-center justify-center rounded-lg border border-rose-500/30 bg-rose-500/8 text-rose-600 cursor-pointer"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
              {submitAttempted && fieldErrors.rate && (
                <p className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
                  {fieldErrors.rate}
                </p>
              )}
            </div>
          )}

          {/* Stand Locality & Contact Phone (+91 PhoneInput) */}
          <div className="space-y-1">
            <label
              htmlFor="veh-stand"
              className="block text-xs font-bold text-[var(--ps-text)]"
            >
              Stand / Boarding Locality *
            </label>
            <input
              id="veh-stand"
              type="text"
              value={form.stand_locality}
              onChange={(e) =>
                setForm((p) => ({ ...p, stand_locality: e.target.value }))
              }
              onBlur={() => setTouched((p) => ({ ...p, stand_locality: true }))}
              placeholder="e.g., Tuibong Bus Stand"
              className="w-full min-h-[44px] rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 text-xs text-[var(--ps-text)]"
            />
            {(touched.stand_locality || submitAttempted) &&
              fieldErrors.stand_locality && (
                <p className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
                  {fieldErrors.stand_locality}
                </p>
              )}
          </div>

          <div>
            <PhoneInput
              label="Driver / Stand Contact Phone"
              value={form.contact_phone}
              onChange={(val) =>
                setForm((p) => ({ ...p, contact_phone: val }))
              }
              helperText="Defaults to +91 (India)."
            />
            {submitAttempted && fieldErrors.contact_phone && (
              <p className="mt-1 text-[11px] font-medium text-rose-600 dark:text-rose-400">
                {fieldErrors.contact_phone}
              </p>
            )}
          </div>

          {/* Unified MapCoordinatePicker in point mode */}
          <div className="sm:col-span-2">
            <MapCoordinatePicker
              mode="point"
              label="Stand / Pickup Coordinates"
              helperText="Drag the pin or pick a preset stand so passengers can navigate directly."
              coordinates={{ lat: form.lat, lng: form.lng }}
              onChangeCoordinates={(next) =>
                setForm((p) => ({ ...p, lat: next.lat, lng: next.lng }))
              }
              quickLocalities={QUICK_STANDS}
              submitAttempted={submitAttempted}
            />
          </div>
        </div>
      </FormModal>

      {/* ConfirmDialog: Pause / Resume */}
      <ConfirmDialog
        isOpen={Boolean(toggleConfirm)}
        title={
          toggleConfirm?.is_active
            ? 'Pause Scheduled Vehicle?'
            : 'Resume Scheduled Vehicle?'
        }
        description={
          toggleConfirm?.is_active
            ? `Passengers will not be able to create new bookings for "${toggleConfirm.title}" while paused.`
            : `Make "${toggleConfirm?.title}" live for new seat and charter reservations.`
        }
        confirmLabel={toggleConfirm?.is_active ? 'Pause Listing' : 'Go Live'}
        variant={toggleConfirm?.is_active ? 'warning' : 'info'}
        loading={actionBusy}
        onConfirm={handleConfirmToggleActive}
        onCancel={() => {
          if (!actionBusy) setToggleConfirm(null);
        }}
      />

      {/* ConfirmDialog: Delete Vehicle */}
      <ConfirmDialog
        isOpen={Boolean(deleteConfirm)}
        title="Delete Vehicle Listing?"
        description={
          deleteConfirm
            ? `Permanently remove "${deleteConfirm.title}" from your scheduled fleet?`
            : undefined
        }
        caution="Existing completed history remains in the ledger, but this listing cannot be recovered."
        confirmLabel="Delete Listing"
        variant="danger"
        loading={actionBusy}
        onConfirm={handleConfirmDeleteListing}
        onCancel={() => {
          if (!actionBusy) setDeleteConfirm(null);
        }}
      />

      {/* ConfirmDialog: Claim Scheduled Booking */}
      <ConfirmDialog
        isOpen={Boolean(claimBookingConfirm)}
        title={
          claimBookingConfirm
            ? `Claim Booking ${claimBookingConfirm.booking_code}?`
            : 'Claim Scheduled Booking'
        }
        description="Assign yourself as the executing driver for this confirmed scheduled reservation."
        confirmLabel="Confirm Assignment"
        loading={actionBusy}
        onConfirm={handleConfirmClaimBooking}
        onCancel={() => {
          if (!actionBusy) setClaimBookingConfirm(null);
        }}
      />
    </div>
  );
}

export default DriverVehiclesAndCharters;
