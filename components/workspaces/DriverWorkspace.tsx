'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bike,
  Car,
  CheckCircle2,
  ClipboardList,
  Compass,
  IndianRupee,
  KeyRound,
  LayoutDashboard,
  MapPin,
  Power,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  X,
} from 'lucide-react';
import {
  WorkspaceNavShell,
  type WorkspaceNavGroup,
} from '@/components/workspaces/shared/WorkspaceNavShell';
import {
  DriverAvailableJobBoard,
  DriverOverviewAndActive,
} from '@/components/workspaces/driver/DriverJobBoardAndActive';
import { DriverOtpPodModal } from '@/components/workspaces/driver/DriverOtpPodModal';
import {
  DriverVehiclesAndCharters,
  type DriverScheduledBookingRow,
  type DriverVehicleListingExtended,
} from '@/components/workspaces/driver/DriverVehiclesAndCharters';
import { DriverPayoutsLedger } from '@/components/workspaces/driver/DriverPayoutsLedger';
import { useHub } from '@/components/providers/AppConfigProvider';
import { setAppStatus } from '@/lib/hooks/useAppStatus';
import { emitBadgesRefresh } from '@/lib/badges/badge-bus';
import type { VehicleTypeItem } from '@/lib/pick-n-drop/types';
import {
  formatDriverFleetLabel,
  formatInr,
  formatServiceModeLabel,
  getNextHandoverStage,
  type DriverActiveOrderRow,
  type DriverAvailableJobRow,
  type DriverNavSectionId,
  type DriverOtpMilestone,
  type DriverPayoutSummary,
  type DriverProfileRow,
  type HandoverTarget,
} from '@/lib/driver/types';
import { useAuth } from '@/lib/store';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';

const ACTIVE_ORDER_STATUSES: string[] = [
  'driver_assigned',
  'picked_up',
  'in_transit',
  'return_in_transit',
  'delivered_pending_confirm',
];

export function DriverWorkspace() {
  const { user: authUser } = useAuth();
  const { activeHub } = useHub();
  const authUserId = authUser?.id || null;
  const activeHubId = activeHub?.id || null;

  const [activeSection, setActiveSection] =
    useState<DriverNavSectionId>('overview');
  const [loading, setLoading] = useState(true);
  const [togglingOnline, setTogglingOnline] = useState(false);
  const [pingingGps, setPingingGps] = useState(false);
  const [gpsStatusLabel, setGpsStatusLabel] = useState<string | null>(null);

  const [driver, setDriver] = useState<DriverProfileRow | null>(null);
  const [vehicleTypes, setVehicleTypes] = useState<VehicleTypeItem[]>([]);
  const [activeOrders, setActiveOrders] = useState<DriverActiveOrderRow[]>([]);
  const [availableJobs, setAvailableJobs] = useState<DriverAvailableJobRow[]>(
    []
  );
  const [orderMilestones, setOrderMilestones] = useState<
    Record<string, DriverOtpMilestone>
  >({});
  const [bookingMilestones, setBookingMilestones] = useState<
    Record<string, DriverOtpMilestone>
  >({});
  const [vehicleListings, setVehicleListings] = useState<
    DriverVehicleListingExtended[]
  >([]);
  const [scheduledBookings, setScheduledBookings] = useState<
    DriverScheduledBookingRow[]
  >([]);
  const [payoutSummary, setPayoutSummary] =
    useState<DriverPayoutSummary | null>(null);
  const [vehiclesEscrowRequired, setVehiclesEscrowRequired] = useState(true);

  const [handoverTarget, setHandoverTarget] = useState<HandoverTarget | null>(
    null
  );
  const [notice, setNotice] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  const isKycReady = Boolean(
    driver &&
      driver.is_active &&
      (driver.kyc_verified || driver.kyc_status === 'verified')
  );

  const loadWorkspaceData = useCallback(async () => {
    if (!isSupabaseConfigured || !authUserId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [driverRes, typesRes, policyRes, payoutRes, availableRes] =
        await Promise.all([
          supabase
            .from('drivers')
            .select(
              'id, profile_id, hub_id, full_name, phone, license_no, vehicle_type, vehicle_reg_no, kyc_status, kyc_verified, is_online, is_active'
            )
            .eq('profile_id', authUserId)
            .maybeSingle(),
          supabase
            .from('vehicle_types')
            .select('*')
            .eq('is_active', true)
            .order('base_fare_inr', { ascending: true }),
          supabase
            .from('payment_feature_policies')
            .select('scope_key, escrow_required')
            .in('scope_key', ['pnd', 'vehicles']),
          supabase.rpc('get_driver_payout_summary'),
          supabase.rpc('get_driver_available_jobs'),
        ]);

      const driverRow = (driverRes.data || null) as DriverProfileRow | null;
      setDriver(driverRow);
      setVehicleTypes((typesRes.data || []) as VehicleTypeItem[]);

      const policies = (policyRes.data || []) as Array<{
        scope_key: string;
        escrow_required: boolean;
      }>;
      const vehPolicy = policies.find((p) => p.scope_key === 'vehicles');
      setVehiclesEscrowRequired(vehPolicy ? Boolean(vehPolicy.escrow_required) : true);

      if (!payoutRes.error && payoutRes.data) {
        setPayoutSummary(payoutRes.data as DriverPayoutSummary);
      }

      if (availableRes.error) {
        // v21a (P0-01): surface feed failures instead of silently showing an empty board
        setAvailableJobs([]);
        setNotice({
          type: 'error',
          text: `Could not load the funded job board: ${availableRes.error.message}`,
        });
      } else {
        setAvailableJobs(
          Array.isArray(availableRes.data)
            ? (availableRes.data as DriverAvailableJobRow[])
            : []
        );
      }

      // v21a (P0-01): active trips come from a SECURITY DEFINER RPC that projects PostGIS
      // pickup_point/dropoff_point to lat/lng and `instructions` (ZERO OTP / secret columns).
      let nextActiveOrders: DriverActiveOrderRow[] = [];
      if (driverRow?.id) {
        const ordersRes = await supabase.rpc('get_driver_active_orders');
        if (ordersRes.error) {
          setNotice({
            type: 'error',
            text: `Could not load your active trips: ${ordersRes.error.message}`,
          });
        } else if (Array.isArray(ordersRes.data)) {
          nextActiveOrders = (ordersRes.data as DriverActiveOrderRow[]).filter(
            (o) => ACTIVE_ORDER_STATUSES.includes(o.status)
          );
        }
      }
      setActiveOrders(nextActiveOrders);

      // Driver's own scheduled vehicle_listings
      const listingsQuery = driverRow?.id
        ? supabase
            .from('vehicle_listings')
            .select('*')
            .or(`owner_id.eq.${authUserId},driver_id.eq.${driverRow.id}`)
            .order('created_at', { ascending: false })
        : supabase
            .from('vehicle_listings')
            .select('*')
            .eq('owner_id', authUserId)
            .order('created_at', { ascending: false });

      const listingsRes = await listingsQuery;
      const myListings = (listingsRes.data ||
        []) as DriverVehicleListingExtended[];
      setVehicleListings(myListings);

      // Incoming scheduled vehicle bookings (explicit non-OTP column projection)
      const listingIds = myListings.map((l) => l.id);
      const titleByListingId = new Map(myListings.map((l) => [l.id, l.title]));

      const bookingFilters: string[] = [];
      if (listingIds.length > 0) {
        bookingFilters.push(`vehicle_listing_id.in.(${listingIds.join(',')})`);
      }
      if (driverRow?.id) {
        bookingFilters.push(`assigned_driver_id.eq.${driverRow.id}`);
      }

      let nextBookings: DriverScheduledBookingRow[] = [];
      if (bookingFilters.length > 0) {
        const bookingsRes = await supabase
          .from('vehicle_bookings')
          .select(
            'id, booking_code, vehicle_listing_id, assigned_driver_id, booking_mode, seats_booked, start_time, end_time, pickup_location, dropoff_location, total_fare_inr, advance_amount_inr, balance_due_inr, status, escrow_status'
          )
          .or(bookingFilters.join(','))
          .order('start_time', { ascending: true })
          .limit(50);

        nextBookings = (
          (bookingsRes.data || []) as Array<
            Omit<DriverScheduledBookingRow, 'vehicle_title'>
          >
        ).map((row) => ({
          ...row,
          vehicle_title:
            titleByListingId.get(row.vehicle_listing_id) || 'Scheduled Vehicle',
        }));
      }
      setScheduledBookings(nextBookings);

      // Fetch Zero-Secret boolean OTP milestones via SECURITY DEFINER RPC
      const orderIds = nextActiveOrders.map((o) => o.id);
      const bookingIds = nextBookings.map((b) => b.id);
      if (orderIds.length > 0 || bookingIds.length > 0) {
        const msRes = await supabase.rpc('get_driver_trip_otp_milestones', {
          p_order_ids: orderIds,
          p_booking_ids: bookingIds,
        });
        if (!msRes.error && msRes.data) {
          const payload = msRes.data as {
            delivery?: Record<string, DriverOtpMilestone>;
            vehicle?: Record<string, DriverOtpMilestone>;
          };
          setOrderMilestones(payload.delivery || {});
          setBookingMilestones(payload.vehicle || {});
        }
      } else {
        setOrderMilestones({});
        setBookingMilestones({});
      }
    } catch (err) {
      setNotice({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Unable to load driver workspace data.',
      });
    } finally {
      setLoading(false);
    }
  }, [authUserId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadWorkspaceData();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadWorkspaceData]);

  const handleToggleOnline = async () => {
    if (!driver || togglingOnline) return;
    setTogglingOnline(true);
    const nextOnline = !driver.is_online;
    try {
      const { error: driverErr } = await supabase
        .from('drivers')
        .update({ is_online: nextOnline })
        .eq('id', driver.id);
      if (driverErr) throw driverErr;

      // Sync vehicle availability if driver has a registered vehicle row
      await supabase.rpc('driver_update_vehicle_status', {
        p_is_available: nextOnline,
      });

      setDriver((prev) => (prev ? { ...prev, is_online: nextOnline } : prev));
      setAppStatus(
        'success',
        nextOnline
          ? 'Driver Online for dispatch'
          : 'Driver Offline (standby)'
      );
      setNotice({
        type: 'success',
        text: nextOnline
          ? 'Availability switched to Online.'
          : 'Availability switched to Offline.',
      });
    } catch (err) {
      setNotice({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Could not update availability status.',
      });
    } finally {
      setTogglingOnline(false);
    }
  };

  const handlePingGps = () => {
    if (!driver || pingingGps) return;
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setNotice({
        type: 'error',
        text: 'GPS geolocation is not supported on this browser.',
      });
      return;
    }
    setPingingGps(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const lat = Number(pos.coords.latitude.toFixed(6));
          const lng = Number(pos.coords.longitude.toFixed(6));
          await supabase.rpc('driver_update_vehicle_status', {
            p_is_available: driver.is_online,
            p_lat: lat,
            p_lng: lng,
          });
          setGpsStatusLabel(`${lat.toFixed(4)}, ${lng.toFixed(4)}`);
          setNotice({
            type: 'success',
            text: `Live GPS coordinates synced (${lat.toFixed(4)}, ${lng.toFixed(4)}).`,
          });
        } catch (err) {
          setNotice({
            type: 'error',
            text:
              err instanceof Error ? err.message : 'Failed to sync GPS ping.',
          });
        } finally {
          setPingingGps(false);
        }
      },
      () => {
        setNotice({
          type: 'error',
          text: 'Location permission denied. Enable GPS to share live dispatch coordinates.',
        });
        setPingingGps(false);
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  const handleAcceptJob = async (job: DriverAvailableJobRow) => {
    try {
      const { data, error } = await supabase.rpc('driver_accept_job', {
        p_booking_id: job.id,
      });
      if (error) {
        throw new Error(error.message || 'Could not accept job.');
      }
      const res = (data || {}) as { code?: string; ok?: boolean };
      setNotice({
        type: 'success',
        text: `Accepted job ${res.code || job.order_code}. Head to the pickup location and verify Pickup OTP.`,
      });
      setActiveSection('overview');
      await loadWorkspaceData();
      emitBadgesRefresh('driver_accept_job');
    } catch (err) {
      setNotice({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'This job may have already been accepted by another driver.',
      });
      await loadWorkspaceData();
    }
  };

  const handleUpdateTripStatus = async (
    bookingId: string,
    status: 'arrived_pickup' | 'en_route_dropoff' | 'driver_cancelled',
    reason?: string
  ) => {
    try {
      const { error } = await supabase.rpc('driver_update_trip_status', {
        p_booking_id: bookingId,
        p_status: status,
        p_reason: reason ?? null,
      });
      if (error) throw error;
      setNotice({
        type: status === 'driver_cancelled' ? 'info' : 'success',
        text:
          status === 'arrived_pickup'
            ? 'Marked Arrived at Pickup.'
            : status === 'en_route_dropoff'
              ? 'Marked En Route to Dropoff.'
              : 'Trip released back to the funded dispatch pool.',
      });
      await loadWorkspaceData();
      emitBadgesRefresh('driver_trip_status');
    } catch (err) {
      setNotice({
        type: 'error',
        text:
          err instanceof Error ? err.message : 'Could not update trip status.',
      });
    }
  };

  // Build unified pending handover queue (active Pick N Drop + confirmed/in-progress Vehicle Bookings)
  const pendingHandovers = useMemo<HandoverTarget[]>(() => {
    const items: HandoverTarget[] = [];

    for (const order of activeOrders) {
      const stage = getNextHandoverStage(order, orderMilestones[order.id]);
      if (stage) {
        const podRequired =
          order.pod_required !== null
            ? order.pod_required
            : order.service_mode !== 'passenger';
        items.push({
          bookingId: order.id,
          domain: 'pick_n_drop',
          code: order.order_code,
          stage,
          podRequired,
          originLabel: order.pickup_address,
          destinationLabel: order.dropoff_address,
        });
      }
    }

    for (const b of scheduledBookings) {
      if (b.status === 'cancelled' || b.status === 'completed' || b.status === 'disputed') {
        continue;
      }
      const ms = bookingMilestones[b.id];
      const pickupDone = Boolean(ms?.pickup_verified) || b.status === 'in_progress';
      const dropoffDone = Boolean(ms?.dropoff_verified);
      if (b.status === 'confirmed' && !pickupDone) {
        items.push({
          bookingId: b.id,
          domain: 'vehicle_booking',
          code: b.booking_code,
          stage: 'pickup',
          podRequired: false,
          originLabel: b.pickup_location,
          destinationLabel: b.dropoff_location || b.vehicle_title,
        });
      } else if (pickupDone && !dropoffDone) {
        items.push({
          bookingId: b.id,
          domain: 'vehicle_booking',
          code: b.booking_code,
          stage: 'dropoff',
          podRequired: false,
          originLabel: b.pickup_location,
          destinationLabel: b.dropoff_location || b.vehicle_title,
        });
      }
    }

    return items;
  }, [activeOrders, orderMilestones, scheduledBookings, bookingMilestones]);

  const navGroups = useMemo<WorkspaceNavGroup[]>(
    () => [
      {
        id: 'group-overview',
        label: 'Overview & Active Trip',
        shortLabel: 'Overview',
        icon: LayoutDashboard,
        items: [
          {
            id: 'overview',
            label: 'Overview & Active Trip',
            shortLabel: 'Active Trip',
            icon: LayoutDashboard,
            badge: activeOrders.length > 0 ? activeOrders.length : undefined,
          },
        ],
      },
      {
        id: 'group-jobs',
        label: 'Available Job Board',
        shortLabel: 'Job Board',
        icon: ClipboardList,
        items: [
          {
            id: 'job_board',
            label: 'Pick N Drop Pool',
            shortLabel: 'Job Pool',
            icon: Bike,
            badge: availableJobs.length > 0 ? availableJobs.length : undefined,
          },
        ],
      },
      {
        id: 'group-handovers',
        label: 'OTP & POD Handovers',
        shortLabel: 'Handovers',
        icon: KeyRound,
        items: [
          {
            id: 'handovers',
            label: 'OTP & POD Queue',
            shortLabel: 'OTP / POD',
            icon: KeyRound,
            badge:
              pendingHandovers.length > 0 ? pendingHandovers.length : undefined,
          },
        ],
      },
      {
        id: 'group-vehicles',
        label: 'Scheduled Vehicles',
        shortLabel: 'Vehicles',
        icon: Car,
        items: [
          {
            id: 'vehicles',
            label: 'Fleet & Reservations',
            shortLabel: 'Vehicles',
            icon: Car,
            badge:
              scheduledBookings.length > 0
                ? scheduledBookings.length
                : undefined,
          },
        ],
      },
      {
        id: 'group-payouts',
        label: 'Payouts & History',
        shortLabel: 'Payouts',
        icon: IndianRupee,
        items: [
          {
            id: 'payouts',
            label: 'Payouts & Trip History',
            shortLabel: 'Payouts',
            icon: IndianRupee,
          },
        ],
      },
    ],
    [
      activeOrders.length,
      availableJobs.length,
      pendingHandovers.length,
      scheduledBookings.length,
    ]
  );

  // Online / Offline Availability Toggle + GPS Ping inside WorkspaceNavShell contextSwitcherSlot
  const availabilitySlot = (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
            Driver Dispatch Status
          </p>
          <p className="text-xs font-bold text-[var(--ps-text)] truncate">
            {driver?.full_name ||
              (typeof authUser?.user_metadata?.full_name === 'string'
                ? authUser.user_metadata.full_name
                : null) ||
              authUser?.email ||
              'Local Driver'}
          </p>
        </div>
        {driver && (
          <span className="shrink-0 rounded-full border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-0.5 text-[10px] font-bold text-[var(--ps-text-muted)]">
            {formatDriverFleetLabel(driver.vehicle_type)}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          disabled={!driver || togglingOnline}
          onClick={() => void handleToggleOnline()}
          className={`flex flex-1 min-h-[44px] items-center justify-center gap-1.5 rounded-xl border px-3 text-xs font-bold transition-colors disabled:opacity-50 cursor-pointer ${
            driver?.is_online
              ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
              : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
          }`}
        >
          <Power className="h-3.5 w-3.5 shrink-0" />
          <span>
            {togglingOnline
              ? 'Updating...'
              : driver?.is_online
                ? 'Online'
                : 'Go Online'}
          </span>
        </button>

        <button
          type="button"
          disabled={!driver || pingingGps}
          onClick={handlePingGps}
          title="Ping live GPS coordinates for dispatch"
          aria-label="Ping live GPS location"
          className="inline-flex min-h-[44px] min-w-[44px] items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:border-[var(--ps-accent)] hover:text-[var(--ps-accent)] disabled:opacity-50 cursor-pointer"
        >
          <Compass
            className={`h-4 w-4 ${pingingGps ? 'animate-pulse text-[var(--ps-accent)]' : ''}`}
          />
        </button>
      </div>

      {gpsStatusLabel && (
        <p className="flex items-center gap-1 font-mono text-[10px] text-[var(--ps-text-muted)]">
          <MapPin className="h-3 w-3 text-emerald-500" />
          GPS synced: {gpsStatusLabel}
        </p>
      )}
    </div>
  );

  return (
    <div className="w-full min-w-0">
      <WorkspaceNavShell
        groups={navGroups}
        activeId={activeSection}
        onSelect={(id) => setActiveSection(id as DriverNavSectionId)}
        navTitle="Driver & Fleet Console"
        contextSwitcherSlot={availabilitySlot}
        testIdPrefix="driver-nav"
      >
        <div className="space-y-4">
          {/* Non-Blocking KYC Readiness Banner */}
          {!loading && (!driver || !isKycReady) && (
            <div
              role="status"
              className="flex flex-wrap items-start justify-between gap-3 rounded-2xl border border-amber-500/35 bg-amber-500/10 p-4 text-xs text-amber-900 dark:text-amber-200"
            >
              <div className="flex items-start gap-2.5 min-w-0">
                <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="min-w-0 space-y-0.5">
                  <p className="font-bold text-sm">
                    {!driver
                      ? 'Driver Profile Onboarding Pending'
                      : driver.kyc_status === 'suspended'
                        ? 'Driver Account Suspended'
                        : 'KYC Verification Pending Approval'}
                  </p>
                  <p className="opacity-90 leading-relaxed">
                    {!driver
                      ? 'Your account is not yet linked to a registered driver record. Contact your Hub Manager to complete driver onboarding and unlock live Pick N Drop dispatch.'
                      : 'You can inspect routes, manage scheduled vehicle drafts, and review payouts, while accepting new Pick N Drop jobs stays disabled until Hub KYC approval is complete.'}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => void loadWorkspaceData()}
                className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-xl border border-amber-600/35 bg-[var(--ps-surface)] px-3.5 text-xs font-bold text-[var(--ps-text)] cursor-pointer"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                Check Status
              </button>
            </div>
          )}

          {/* Inline Action Notice */}
          {notice && (
            <div
              role="status"
              className={`flex items-start justify-between gap-3 rounded-2xl border px-4 py-3 text-xs font-medium ${
                notice.type === 'error'
                  ? 'border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                  : notice.type === 'success'
                    ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
                    : 'border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text)]'
              }`}
            >
              <div className="flex items-start gap-2 min-w-0">
                {notice.type === 'error' ? (
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                ) : (
                  <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                )}
                <span className="leading-relaxed">{notice.text}</span>
              </div>
              <button
                type="button"
                onClick={() => setNotice(null)}
                aria-label="Dismiss notification"
                className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg hover:bg-black/5 cursor-pointer"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          )}

          {/* Active Workspace Section */}
          {activeSection === 'overview' && (
            <DriverOverviewAndActive
              driver={driver}
              activeOrders={activeOrders}
              milestones={orderMilestones}
              payoutSummary={payoutSummary}
              availableCount={availableJobs.length}
              loading={loading}
              onRefresh={() => void loadWorkspaceData()}
              onOpenHandover={(target) => setHandoverTarget(target)}
              onUpdateTripStatus={handleUpdateTripStatus}
              onJumpToBoard={() => setActiveSection('job_board')}
            />
          )}

          {activeSection === 'job_board' && (
            <DriverAvailableJobBoard
              driver={driver}
              isKycReady={isKycReady}
              jobs={availableJobs}
              loading={loading}
              onRefresh={() => void loadWorkspaceData()}
              onAcceptJob={handleAcceptJob}
            />
          )}

          {activeSection === 'handovers' && (
            <div className="space-y-4">
              <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4">
                <div>
                  <h2 className="text-base font-bold text-[var(--ps-text)]">
                    OTP &amp; POD Handover Queue
                  </h2>
                  <p className="text-xs text-[var(--ps-text-muted)]">
                    Verify live customer OTPs and upload compressed WebP Proof-of-Delivery photos privately.
                  </p>
                </div>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-1 text-[11px] font-bold text-[var(--ps-text-muted)]">
                  <ShieldCheck className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
                  Zero-Trust Server Verification
                </span>
              </div>

              {loading ? (
                <div className="space-y-3">
                  {[1, 2].map((i) => (
                    <div
                      key={i}
                      className="h-28 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] dd-shimmer"
                    />
                  ))}
                </div>
              ) : pendingHandovers.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-surface)] p-8 text-center space-y-2">
                  <KeyRound className="mx-auto h-9 w-9 text-[var(--ps-text-muted)] opacity-60" />
                  <p className="text-sm font-bold text-[var(--ps-text)]">
                    No pending OTP handovers
                  </p>
                  <p className="text-xs text-[var(--ps-text-muted)]">
                    Accept a funded job from the Job Board or check Scheduled Vehicles to start a handover.
                  </p>
                </div>
              ) : (
                <div className="space-y-3">
                  {pendingHandovers.map((item) => {
                    const matchedOrder =
                      item.domain === 'pick_n_drop'
                        ? activeOrders.find((o) => o.id === item.bookingId)
                        : null;
                    return (
                      <div
                        key={`${item.domain}-${item.bookingId}-${item.stage}`}
                        className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4"
                      >
                        <div className="min-w-0 space-y-1">
                          <div className="flex flex-wrap items-center gap-2">
                            <span className="font-mono text-sm font-extrabold text-[var(--ps-text)]">
                              {item.code}
                            </span>
                            <span className="rounded-full border border-[var(--ps-accent)]/35 bg-[var(--ps-accent)]/10 px-2.5 py-0.5 text-[10px] font-bold uppercase text-[var(--ps-accent)]">
                              Next: {item.stage} OTP
                              {item.stage === 'dropoff' && item.podRequired
                                ? ' + POD Photo'
                                : ''}
                            </span>
                            {matchedOrder && (
                              <span className="text-[11px] font-semibold text-[var(--ps-text-muted)]">
                                {formatServiceModeLabel(
                                  matchedOrder.service_mode
                                )}{' '}
                                · Est.{' '}
                                {formatInr(matchedOrder.quoted_fare_inr * 0.85)}
                              </span>
                            )}
                          </div>
                          <p className="text-xs text-[var(--ps-text-muted)] line-clamp-2">
                            {item.originLabel} → {item.destinationLabel}
                          </p>
                        </div>

                        <button
                          type="button"
                          onClick={() => setHandoverTarget(item)}
                          className="inline-flex min-h-[48px] w-full sm:w-auto items-center justify-center gap-2 rounded-xl bg-[var(--ps-accent)] px-5 text-xs font-bold text-[var(--ps-accent-fg)] shadow-xs hover:opacity-95 cursor-pointer"
                        >
                          <KeyRound className="h-4 w-4" />
                          <span>
                            Verify{' '}
                            {item.stage.charAt(0).toUpperCase() +
                              item.stage.slice(1)}{' '}
                            OTP
                            {item.stage === 'dropoff' && item.podRequired
                              ? ' & POD'
                              : ''}
                          </span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {activeSection === 'vehicles' && authUserId && (
            <DriverVehiclesAndCharters
              authUserId={authUserId}
              hubId={activeHubId}
              driver={driver}
              isKycReady={isKycReady}
              vehicleTypes={vehicleTypes}
              listings={vehicleListings}
              bookings={scheduledBookings}
              bookingMilestones={bookingMilestones}
              vehiclesEscrowRequired={vehiclesEscrowRequired}
              loading={loading}
              onRefresh={() => void loadWorkspaceData()}
              onNotice={(n) => setNotice(n)}
              onOpenHandover={(target) => setHandoverTarget(target)}
            />
          )}

          {activeSection === 'payouts' && (
            <DriverPayoutsLedger
              summary={payoutSummary}
              loading={loading}
              onRefresh={() => void loadWorkspaceData()}
            />
          )}
        </div>
      </WorkspaceNavShell>

      {/* Zero-Trust OTP & WebP POD Handover Modal */}
      <DriverOtpPodModal
        target={handoverTarget}
        onClose={() => setHandoverTarget(null)}
        onVerified={async ({ code, stage, nextStatus }) => {
          setNotice({
            type: 'success',
            text: `Verified ${stage.toUpperCase()} OTP for ${code} (status: ${nextStatus.replace(/_/g, ' ')}).`,
          });
          setAppStatus('success', `Handover verified for ${code}`);
          await loadWorkspaceData();
        }}
      />
    </div>
  );
}

export default DriverWorkspace;
