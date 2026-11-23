'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  BadgeCheck,
  Calendar,
  Camera,
  Car,
  CheckCircle2,
  Clock,
  ExternalLink,
  Flame,
  KeyRound,
  Loader2,
  Lock,
  MapPin,
  MessageCircle,
  Navigation,
  Package,
  Phone,
  Power,
  Printer,
  RefreshCw,
  ShieldCheck,
  ShoppingBag,
  Truck,
  UserCheck,
  Wallet,
} from 'lucide-react';
import { useConfirmDialog } from '@/components/ui/ConfirmActionModal';
import { VehicleFleetCalendarManager } from '@/components/workspaces/VehicleFleetCalendarManager';
import {
  ResponsiveTableScroll,
  WorkspaceTableToolbar,
} from '@/components/ui/ResponsiveTableWrapper';
import {
  WorkspaceHeaderSkeleton,
  WorkspaceKpiGridSkeleton,
} from '@/components/shared/Skeletons';
import { setAppStatus } from '@/lib/hooks/useAppStatus';
import { useRealtimeTableRefresh } from '@/lib/hooks/useRealtimeTableRefresh';
import { useAuth } from '@/lib/store';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { bindEntityMedia, uploadDeliveryPod } from '@/lib/supabase/storage';
import { buildContextualWhatsAppUrl } from '@/lib/utils/whatsapp';
import {
  DELIVERY_STATUS_META,
  SERVICE_MODE_META,
  type DeliveryOrderRecord,
  type DeliveryServiceMode,
  type DeliveryTransactionRecord,
  type DriverRecord,
  type VehicleRecord,
  type VehicleTypeItem,
} from '@/lib/pick-n-drop/types';

type DriverTab =
  | 'active'
  | 'vehicle_listing'
  | 'schedule'
  | 'payouts'
  | 'profile';

const ACTIVE_TRIP_STATUSES = new Set([
  'driver_assigned',
  'picked_up',
  'in_transit',
  'return_in_transit',
]);

function buildGoogleMapsUrl(address: string, landmark?: string | null): string {
  const query = [address, landmark, 'Churachandpur, Manipur']
    .filter(Boolean)
    .join(', ');
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function getServiceModeBadge(mode?: DeliveryServiceMode) {
  const resolved: DeliveryServiceMode = mode || 'parcel';
  const meta = SERVICE_MODE_META[resolved] || SERVICE_MODE_META.parcel;
  if (resolved === 'passenger') {
    return {
      label: meta.label,
      icon: Car,
      cls: 'bg-sky-500/15 text-sky-700 dark:text-sky-300 border-sky-500/30',
    };
  }
  if (resolved === 'gas') {
    return {
      label: meta.label,
      icon: Flame,
      cls: 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border-amber-500/30',
    };
  }
  return {
    label: meta.label,
    icon: Package,
    cls: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 border-emerald-500/30',
  };
}

export function DriverWorkspace() {
  const { user: authUser, fullName } = useAuth();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();
  const [activeTab, setActiveTab] = useState<DriverTab>('active');
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);

  const [driverProfile, setDriverProfile] = useState<DriverRecord | null>(null);
  const [driverVehicles, setDriverVehicles] = useState<VehicleRecord[]>([]);
  const [vehicleTypes, setVehicleTypes] = useState<VehicleTypeItem[]>([]);
  const [orders, setOrders] = useState<DeliveryOrderRecord[]>([]);
  const [payouts, setPayouts] = useState<DeliveryTransactionRecord[]>([]);
  const [upcomingScheduledCount, setUpcomingScheduledCount] = useState<number>(0);

  const [isTogglingShift, setIsTogglingShift] = useState(false);
  const [isPingingGps, setIsPingingGps] = useState(false);
  const [lastGpsPing, setLastGpsPing] = useState<string | null>(null);

  const [otpMap, setOtpMap] = useState<Record<string, string>>({});
  const [podFileMap, setPodFileMap] = useState<Record<string, File | null>>({});
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [banner, setBanner] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  const primaryVehicle = driverVehicles[0] ?? null;
  const isOnline = Boolean(primaryVehicle?.is_available);

  const primaryVehicleType = useMemo(() => {
    if (!primaryVehicle) return null;
    return (
      vehicleTypes.find((vt) => vt.id === primaryVehicle.vehicle_type_id) ??
      null
    );
  }, [primaryVehicle, vehicleTypes]);

  const authUserId = authUser?.id || '';

  const loadDriverWorkspace = useCallback(
    async (silent = false) => {
      if (!isSupabaseConfigured()) {
        setIsLoading(false);
        return;
      }

      if (!silent) {
        setIsLoading(true);
      } else {
        setIsRefreshing(true);
      }

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        const uid = session?.user?.id || authUserId;
        if (!uid) {
          setIsLoading(false);
          setIsRefreshing(false);
          return;
        }

        const [driverRes, vtRes] = await Promise.all([
          supabase
            .from('drivers')
            .select('*')
            .eq('profile_id', uid)
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from('vehicle_types')
            .select('*')
            .order('base_fare_inr', { ascending: true }),
        ]);

        const vtList = ((vtRes.data || []) as VehicleTypeItem[]).map((vt) => ({
          ...vt,
          base_fare_inr: Number(vt.base_fare_inr),
          per_km_rate_inr: Number(vt.per_km_rate_inr),
          wait_per_10min_inr: Number(vt.wait_per_10min_inr),
          two_way_multiplier: Number(vt.two_way_multiplier),
        }));
        setVehicleTypes(vtList);

        const foundDriver = (driverRes.data as DriverRecord | null) ?? null;
        setDriverProfile(foundDriver);

        if (!foundDriver) {
          setDriverVehicles([]);
          setOrders([]);
          setPayouts([]);
          return;
        }

        const [vehiclesRes, ordersRes, payoutsRes, vehListingsRes] = await Promise.all([
          supabase
            .from('vehicles')
            .select('*')
            .eq('driver_id', foundDriver.id)
            .order('updated_at', { ascending: false }),
          supabase
            .from('delivery_orders')
            .select('*')
            .eq('driver_id', foundDriver.id)
            .order('created_at', { ascending: false })
            .limit(80),
          supabase
            .from('delivery_transactions')
            .select('*')
            .eq('tx_type', 'driver_payout')
            .order('created_at', { ascending: false })
            .limit(100),
          supabase
            .from('vehicle_listings')
            .select('id')
            .or(`driver_id.eq.${foundDriver.id},owner_id.eq.${uid}`),
        ]);

        const listedVehicleIds = (
          (vehListingsRes.data || []) as Array<{ id: string }>
        ).map((v) => v.id);

        if (listedVehicleIds.length > 0) {
          const { count: scheduledCnt } = await supabase
            .from('vehicle_bookings')
            .select('id', { count: 'exact', head: true })
            .in('vehicle_listing_id', listedVehicleIds)
            .in('status', ['confirmed', 'in_progress', 'pending_payment_confirm']);
          setUpcomingScheduledCount(scheduledCnt ?? 0);
        } else {
          setUpcomingScheduledCount(0);
        }

        setDriverVehicles((vehiclesRes.data || []) as VehicleRecord[]);
        const rawOrders = (ordersRes.data || []) as DeliveryOrderRecord[];
        const linkedPrintIds = Array.from(
          new Set(
            rawOrders
              .map((o) => o.linked_print_order_id)
              .filter((id): id is string => Boolean(id))
          )
        );

        const printCodeById = new Map<string, string>();
        if (linkedPrintIds.length > 0) {
          try {
            const { data: printRows } = await supabase
              .from('print_orders')
              .select('id, order_code')
              .in('id', linkedPrintIds);
            for (const row of (printRows || []) as Array<{
              id: string;
              order_code: string;
            }>) {
              if (row.id && row.order_code) {
                printCodeById.set(row.id, row.order_code);
              }
            }
          } catch {
            // Driver RLS may not expose print_orders directly; fall back to instruction parser below
          }
        }

        const hydratedOrders = rawOrders.map((o) => {
          let linkedCode: string | null = null;
          if (o.linked_print_order_id) {
            const fromDb = printCodeById.get(o.linked_print_order_id);
            const fromInstructions = o.instructions?.match(
              /\b(PRT-[A-Z0-9-]+)\b/i
            )?.[1];
            linkedCode =
              fromDb ||
              (fromInstructions ? fromInstructions.toUpperCase() : null) ||
              `PRT-${o.linked_print_order_id.slice(0, 6).toUpperCase()}`;
          }
          return {
            ...o,
            quoted_fare_inr: Number(o.quoted_fare_inr),
            distance_km: Number(o.distance_km),
            declared_value_inr: Number(o.declared_value_inr || 0),
            linked_print_order_code: linkedCode,
            vehicle_type:
              vtList.find((vt) => vt.id === o.vehicle_type_id) ?? null,
          };
        });
        setOrders(hydratedOrders);

        const orderIdSet = new Set(hydratedOrders.map((o) => o.id));
        const driverPayouts = (
          (payoutsRes.data || []) as DeliveryTransactionRecord[]
        )
          .filter((tx) => orderIdSet.has(tx.order_id))
          .map((tx) => ({
            ...tx,
            amount_inr: Number(tx.amount_inr),
          }));
        setPayouts(driverPayouts);
      } catch (err) {
        setBanner({
          type: 'error',
          text:
            err instanceof Error
              ? err.message
              : 'Failed to load driver workspace data.',
        });
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [authUserId]
  );

  useEffect(() => {
    queueMicrotask(() => {
      void loadDriverWorkspace(false);
    });
  }, [loadDriverWorkspace]);

  // Pass R6: Lightweight Realtime auto-refresh for assigned/hub delivery orders
  useRealtimeTableRefresh(
    'delivery_orders',
    () => void loadDriverWorkspace(true),
    { enabled: Boolean(authUser?.id) }
  );

  const activeTrips = useMemo(
    () => orders.filter((o) => ACTIVE_TRIP_STATUSES.has(o.status)),
    [orders]
  );

  const completedTrips = useMemo(
    () =>
      orders.filter(
        (o) => o.status === 'completed' || o.status === 'delivered_pending_confirm'
      ),
    [orders]
  );

  const totalEarningsInr = useMemo(
    () => payouts.reduce((sum, tx) => sum + Number(tx.amount_inr || 0), 0),
    [payouts]
  );

  const handleToggleShift = async () => {
    if (!driverProfile) return;
    const nextOnline = !isOnline;
    const ok = await confirm({
      title: nextOnline
        ? 'Go Online for Pick N Drop Dispatch?'
        : 'Go Offline from Dispatch?',
      description: nextOnline
        ? 'Your vehicle will become visible to mediators and customers for live delivery/ride assignments.'
        : 'You will stop receiving new Pick N Drop dispatches while offline.',
      confirmLabel: nextOnline ? 'Go Online' : 'Go Offline',
      variant: nextOnline ? 'default' : 'danger',
    });
    if (!ok) return;
    setIsTogglingShift(true);
    setAppStatus('saving', nextOnline ? 'Going Online…' : 'Going Offline…');
    try {
      const { error } = await supabase.rpc('driver_update_vehicle_status', {
        p_is_available: nextOnline,
      });
      if (error) throw new Error(error.message);

      setDriverVehicles((prev) =>
        prev.map((v) => ({ ...v, is_available: nextOnline }))
      );
      setBanner({
        type: 'success',
        text: nextOnline
          ? 'You are now Online and visible to Pick N Drop dispatch.'
          : 'You are now Offline for new Pick N Drop assignments.',
      });
      setAppStatus('success', nextOnline ? 'Shift Online' : 'Shift Offline');
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Unable to update shift status.';
      setBanner({ type: 'error', text: msg });
      setAppStatus('error', 'Shift update failed');
    } finally {
      setIsTogglingShift(false);
    }
  };

  const handlePingGps = () => {
    if (!driverProfile) return;
    if (typeof window === 'undefined' || !navigator.geolocation) {
      setBanner({
        type: 'error',
        text: 'Browser geolocation is unavailable on this device.',
      });
      return;
    }

    setIsPingingGps(true);
    setAppStatus('locating', 'Pinging GPS…');

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        try {
          const lat = pos.coords.latitude;
          const lng = pos.coords.longitude;
          const { error } = await supabase.rpc('driver_update_vehicle_status', {
            p_is_available: isOnline,
            p_lat: lat,
            p_lng: lng,
          });
          if (error) throw new Error(error.message);

          const nowLabel = new Intl.DateTimeFormat('en-IN', {
            hour: '2-digit',
            minute: '2-digit',
          }).format(new Date());
          setLastGpsPing(`${lat.toFixed(4)}°, ${lng.toFixed(4)}° (${nowLabel})`);
          setBanner({
            type: 'success',
            text: `Live vehicle location updated (${lat.toFixed(4)}°, ${lng.toFixed(4)}°).`,
          });
          setAppStatus('success', 'GPS location synced');
        } catch (err) {
          const msg =
            err instanceof Error ? err.message : 'Failed to sync GPS ping.';
          setBanner({ type: 'error', text: msg });
          setAppStatus('error', 'GPS sync failed');
        } finally {
          setIsPingingGps(false);
        }
      },
      (geoErr) => {
        setIsPingingGps(false);
        setBanner({
          type: 'error',
          text:
            geoErr.message ||
            'Location permission denied. Enable GPS to ping dispatch.',
        });
        setAppStatus('error', 'GPS permission denied');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 15000 }
    );
  };

  const handleVerifyHandoverOtp = async (
    order: DeliveryOrderRecord,
    stage: 'pickup' | 'dropoff' | 'return'
  ) => {
    const rawOtp = (otpMap[order.id] || '').replace(/\D/g, '').trim();
    if (rawOtp.length !== 6) {
      setBanner({
        type: 'error',
        text: `Enter the 6-digit ${stage} OTP for order ${order.order_code}.`,
      });
      return;
    }

    const requiresPod =
      stage === 'dropoff' &&
      order.pod_required !== false &&
      order.service_mode !== 'passenger';

    const podFile = podFileMap[order.id] ?? null;
    if (requiresPod && !podFile) {
      setBanner({
        type: 'error',
        text: 'Proof-of-Delivery photo is required before completing dropoff.',
      });
      return;
    }

    const ok = await confirm({
      title: `Confirm ${stage.toUpperCase()} OTP Handover?`,
      description: `Verify 6-digit ${stage} OTP for order ${order.order_code}${
        requiresPod ? ' and upload Proof-of-Delivery photo' : ''
      }?`,
      confirmLabel: `Verify ${stage.toUpperCase()} OTP`,
    });
    if (!ok) return;

    setBusyOrderId(order.id);
    setAppStatus('saving', `Verifying ${stage} OTP…`);

    try {
      let podPath: string | null = null;
      if (requiresPod && podFile) {
        const uploaded = await uploadDeliveryPod(order.id, podFile);
        podPath = uploaded.path;
        // Pass R5: Bind POD photo into zero-orphan media registry with 7-day (168h) auto-expiry TTL
        void bindEntityMedia(
          [uploaded.path],
          'delivery_pod',
          order.id,
          'ephemeral_ttl',
          168
        );
      }

      const { error } = await supabase.rpc('verify_delivery_otp', {
        p_order_id: order.id,
        p_stage: stage,
        p_otp: rawOtp,
        p_pod_path: podPath,
      });

      if (error) {
        throw new Error(error.message);
      }

      setOtpMap((prev) => ({ ...prev, [order.id]: '' }));
      setPodFileMap((prev) => ({ ...prev, [order.id]: null }));
      setBanner({
        type: 'success',
        text:
          stage === 'pickup'
            ? `Pickup OTP verified for ${order.order_code}. Trip is now In Transit.`
            : stage === 'dropoff'
              ? `Dropoff verified for ${order.order_code}. Awaiting mediator confirmation.`
              : `Return OTP verified for ${order.order_code}. Two-way trip handover complete.`,
      });
      setAppStatus('success', `${stage.toUpperCase()} verified`);
      await loadDriverWorkspace(true);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'OTP verification failed.';
      setBanner({ type: 'error', text: msg });
      setAppStatus('error', 'OTP verification failed');
    } finally {
      setBusyOrderId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <WorkspaceHeaderSkeleton />
        <WorkspaceKpiGridSkeleton count={4} />
      </div>
    );
  }

  return (
    <div
      data-testid="driver-workspace"
      className="space-y-4 min-w-0 max-w-full overflow-x-clip text-[var(--ps-text)]"
    >
      {/* 1. SHIFT & VEHICLE STATUS BAR */}
      <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3 sm:p-5 shadow-xs">
        <div className="flex flex-col gap-2.5 sm:gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
              <span className="inline-flex items-center gap-1 rounded-md bg-[var(--ps-accent)]/12 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-[var(--ps-accent)]">
                <Truck className="h-3 w-3" />
                Driver Workspace
              </span>
              {driverProfile && (
                <span
                  className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold ${
                    driverProfile.kyc_verified
                      ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                      : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                  }`}
                >
                  <BadgeCheck className="h-3 w-3" />
                  {driverProfile.kyc_verified ? 'KYC Verified' : 'KYC Pending'}
                </span>
              )}
              {primaryVehicle && (
                <span className="inline-flex items-center gap-1 rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-0.5 font-mono text-[10px] font-bold text-[var(--ps-text)]">
                  {primaryVehicle.plate_number}
                  {primaryVehicleType ? ` • ${primaryVehicleType.name}` : ''}
                </span>
              )}
            </div>
            <h1 className="mt-1.5 text-base sm:text-xl font-bold leading-snug tracking-tight text-[var(--ps-text)] break-words">
              {driverProfile?.full_name || fullName || 'Fleet Driver'}
            </h1>
            {lastGpsPing && (
              <p className="mt-0.5 text-[11px] text-[var(--ps-text-muted)] tabular-nums line-clamp-2 sm:line-clamp-none">
                Last GPS ping: {lastGpsPing}
              </p>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={!driverProfile || isTogglingShift}
              onClick={() => void handleToggleShift()}
              data-testid="driver-shift-toggle-btn"
              className={`inline-flex h-9 items-center gap-1.5 rounded-xl px-3.5 text-xs font-bold shadow-xs transition-all disabled:opacity-50 ${
                isOnline
                  ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                  : 'border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text)] hover:border-emerald-500/50'
              }`}
            >
              {isTogglingShift ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Power className="h-3.5 w-3.5" />
              )}
              <span>{isOnline ? 'Online • Ready' : 'Offline • Go Online'}</span>
            </button>

            <button
              type="button"
              disabled={!driverProfile || isPingingGps}
              onClick={handlePingGps}
              data-testid="driver-ping-gps-btn"
              className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs font-semibold text-[var(--ps-text)] transition-colors hover:border-[var(--ps-accent)]/50 hover:text-[var(--ps-accent)] disabled:opacity-50"
            >
              {isPingingGps ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Navigation className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
              )}
              <span>Ping GPS Location</span>
            </button>

            <button
              type="button"
              disabled={isRefreshing}
              onClick={() => void loadDriverWorkspace(true)}
              aria-label="Refresh driver trips"
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`}
              />
            </button>
          </div>
        </div>

        {/* Driver KPI Quick Strip (Unified Pick N Drop + Scheduled Vehicle Bookings) */}
        <div className="mt-3 grid grid-cols-2 lg:grid-cols-4 gap-2 sm:gap-3 border-t border-[var(--ps-border)] pt-3">
          <div className="rounded-xl bg-[var(--ps-bg)] px-3 py-2 min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--ps-text-muted)] truncate">
              Active Workload
            </p>
            <p className="mt-0.5 text-lg sm:text-xl font-extrabold tabular-nums truncate">
              {activeTrips.length + upcomingScheduledCount}
            </p>
            <p className="text-[10px] text-[var(--ps-text-muted)] tabular-nums truncate">
              {activeTrips.length} Pick N Drop · {upcomingScheduledCount} Scheduled
            </p>
          </div>
          <div className="rounded-xl bg-[var(--ps-bg)] px-3 py-2 min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--ps-text-muted)] truncate">
              Upcoming Bookings
            </p>
            <p className="mt-0.5 text-lg sm:text-xl font-extrabold tabular-nums text-[var(--ps-accent)] truncate">
              {upcomingScheduledCount}
            </p>
            <button
              type="button"
              onClick={() => setActiveTab('schedule')}
              className="text-[10px] font-semibold text-[var(--ps-accent)] hover:underline"
            >
              Open Schedule →
            </button>
          </div>
          <div className="rounded-xl bg-[var(--ps-bg)] px-3 py-2 min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--ps-text-muted)] truncate">
              Completed
            </p>
            <p className="mt-0.5 text-lg sm:text-xl font-extrabold tabular-nums truncate">
              {completedTrips.length}
            </p>
          </div>
          <div className="rounded-xl bg-[var(--ps-bg)] px-3 py-2 min-w-0">
            <p className="text-[10px] font-medium uppercase tracking-wide text-[var(--ps-text-muted)] truncate">
              Payouts Earned
            </p>
            <p className="mt-0.5 text-lg sm:text-xl font-extrabold tabular-nums text-emerald-600 dark:text-emerald-400 truncate">
              ₹{totalEarningsInr.toLocaleString('en-IN')}
            </p>
          </div>
        </div>
      </section>

      {banner && (
        <div
          className={`flex items-start justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-xs ${
            banner.type === 'success'
              ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
              : banner.type === 'error'
                ? 'border-rose-500/35 bg-rose-500/10 text-rose-800 dark:text-rose-200'
                : 'border-sky-500/35 bg-sky-500/10 text-sky-800 dark:text-sky-200'
          }`}
        >
          <span className="flex items-center gap-2">
            {banner.type === 'error' ? (
              <AlertCircle className="h-4 w-4 shrink-0" />
            ) : (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            )}
            <span>{banner.text}</span>
          </span>
          <button
            type="button"
            onClick={() => setBanner(null)}
            className="text-[11px] font-bold opacity-75 hover:opacity-100"
          >
            Dismiss
          </button>
        </div>
      )}

      {!driverProfile && (
        <div className="rounded-2xl border border-amber-500/35 bg-amber-500/10 p-4 text-xs text-amber-900 dark:text-amber-200">
          <p className="font-bold">Driver Fleet Record Not Linked Yet</p>
          <p className="mt-1 leading-relaxed opacity-90">
            Your account has the Driver workspace enabled, but a dispatch
            mediator hasn&apos;t linked your profile ID to a registered vehicle
            in the Pick N Drop Fleet Pool yet. Contact DD oodle Dispatch to
            complete KYC and vehicle onboarding.
          </p>
          <div className="mt-3">
            <Link
              href="/contact"
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--ps-accent)] px-3 text-xs font-semibold text-[var(--ps-accent-fg)]"
            >
              <span>Contact Dispatch Mediator</span>
              <ExternalLink className="h-3 w-3" />
            </Link>
          </div>
        </div>
      )}

      {/* SUB-TAB NAVIGATION */}
      <nav
        aria-label="Driver workspace sections"
        className="flex w-full max-w-full flex-nowrap gap-1.5 overflow-x-auto no-scrollbar pb-1"
      >
        {[
          {
            id: 'active' as const,
            label: `Active Trips (${activeTrips.length})`,
            icon: Truck,
          },
          {
            id: 'vehicle_listing' as const,
            label: 'My Vehicle Listing',
            icon: Car,
          },
          {
            id: 'schedule' as const,
            label: `Schedule & Calendar (${upcomingScheduledCount})`,
            icon: Calendar,
          },
          {
            id: 'payouts' as const,
            label: `Completed & Payouts (${payouts.length})`,
            icon: Wallet,
          },
          {
            id: 'profile' as const,
            label: 'Driver Profile & KYC',
            icon: ShieldCheck,
          },
        ].map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold transition-colors ${
                isActive
                  ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-xs'
                  : 'border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {/* 2. ACTIVE ASSIGNED TRIPS */}
      {activeTab === 'active' && (
        <div className="space-y-3">
          {activeTrips.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-surface)] p-8 text-center">
              <Truck className="mx-auto h-7 w-7 text-[var(--ps-text-muted)] opacity-60" />
              <p className="mt-2 text-sm font-bold text-[var(--ps-text)]">
                No active assigned trips
              </p>
              <p className="mt-1 text-xs text-[var(--ps-text-muted)]">
                Stay Online and ping your GPS location so local mediators can
                dispatch nearby Parcel, Ride, or LPG Gas orders to you.
              </p>
            </div>
          ) : (
            activeTrips.map((order) => {
              const modeBadge = getServiceModeBadge(order.service_mode);
              const ModeIcon = modeBadge.icon;
              const statusMeta =
                DELIVERY_STATUS_META[order.status] ||
                DELIVERY_STATUS_META.driver_assigned;

              const stage: 'pickup' | 'dropoff' | 'return' =
                order.status === 'driver_assigned'
                  ? 'pickup'
                  : order.status === 'return_in_transit'
                    ? 'return'
                    : 'dropoff';

              const requiresPod =
                stage === 'dropoff' &&
                order.pod_required !== false &&
                order.service_mode !== 'passenger';

              const isBusy = busyOrderId === order.id;

              return (
                <article
                  key={order.id}
                  className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 shadow-xs space-y-3"
                >
                  {/* Header badges */}
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ps-border)] pb-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-xs font-extrabold text-[var(--ps-text)]">
                        {order.order_code}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold ${modeBadge.cls}`}
                      >
                        <ModeIcon className="h-3 w-3" />
                        {modeBadge.label}
                      </span>
                      {(order.is_food_order ||
                        order.linked_restaurant_order_id) && (
                        <span
                          data-testid={`driver-hot-food-badge-${order.id}`}
                          className="inline-flex items-center gap-1 rounded-md bg-orange-600 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-white shadow-2xs"
                        >
                          <Flame className="h-3 w-3" />
                          HOT FOOD — KEEP UPRIGHT
                        </span>
                      )}
                      {order.linked_shop_order_id &&
                        !order.is_food_order &&
                        !order.linked_restaurant_order_id && (
                          <span
                            data-testid={`driver-shop-pickup-badge-${order.id}`}
                            className="inline-flex items-center gap-1 rounded-md bg-sky-600 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-white shadow-2xs"
                          >
                            <ShoppingBag className="h-3 w-3" />
                            SHOP PICKUP
                          </span>
                        )}
                      {order.linked_print_order_id && (
                        <>
                          <span
                            data-testid={`driver-print-pickup-badge-${order.id}`}
                            className="inline-flex items-center gap-1 rounded-md bg-theme-primary px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wide text-theme-primary-foreground"
                          >
                            <Printer className="h-3 w-3" />
                            PRINT PICKUP • SEALED
                            {order.linked_print_order_code
                              ? ` · ${order.linked_print_order_code}`
                              : ''}
                          </span>
                          {order.sealed_package_required && (
                            <span
                              data-testid={`driver-sealed-envelope-badge-${order.id}`}
                              className="inline-flex items-center gap-1 rounded-md border border-amber-500/40 bg-amber-500/15 px-2 py-0.5 text-[10px] font-bold text-amber-800 dark:text-amber-200"
                            >
                              <Lock className="h-3 w-3" />
                              Sealed Envelope Required
                            </span>
                          )}
                        </>
                      )}
                      <span className="rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-0.5 text-[10px] font-semibold text-[var(--ps-text-muted)]">
                        {order.trip_type === 'two_way' ? 'Two-Way' : 'One-Way'}
                      </span>
                      <span className="rounded-md bg-[var(--ps-accent)]/12 px-2 py-0.5 text-[10px] font-bold text-[var(--ps-accent)]">
                        {statusMeta.label}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold ${
                          order.status === 'awaiting_payment' ||
                          order.status === 'payment_submitted'
                            ? 'border-amber-500/35 bg-amber-500/12 text-amber-700 dark:text-amber-300'
                            : 'border-emerald-500/35 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                        }`}
                      >
                        <ShieldCheck className="h-3 w-3" />
                        {order.status === 'awaiting_payment' ||
                        order.status === 'payment_submitted'
                          ? 'Payment Pending'
                          : 'Escrow Held'}
                      </span>
                    </div>
                    <div className="text-right">
                      <span className="text-sm font-extrabold tabular-nums text-[var(--ps-text)]">
                        ₹{order.quoted_fare_inr.toLocaleString('en-IN')}
                      </span>
                      <span className="ml-1.5 text-[10px] text-[var(--ps-text-muted)] tabular-nums">
                        {order.distance_km.toFixed(1)} km
                      </span>
                    </div>
                  </div>

                  {/* Route A & B with Google Maps Deep Links */}
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-2.5 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-wide text-emerald-600 dark:text-emerald-400">
                          Point A • Pickup
                        </span>
                        <a
                          href={buildGoogleMapsUrl(
                            order.pickup_address,
                            order.pickup_landmark
                          )}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--ps-accent)] hover:underline"
                        >
                          <MapPin className="h-3 w-3" />
                          Open in Google Maps
                        </a>
                      </div>
                      <p className="mt-1 font-semibold text-[var(--ps-text)]">
                        {order.pickup_address}
                      </p>
                      {order.sender_phone && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          <a
                            href={`tel:${order.sender_phone}`}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--ps-accent)] hover:underline"
                          >
                            <Phone className="h-3 w-3" />
                            Sender: {order.sender_phone}
                          </a>
                          <a
                            href={buildContextualWhatsAppUrl(
                              order.sender_phone,
                              {
                                type: 'order_support',
                                vertical: 'Pick N Drop Pickup',
                                code: order.order_code,
                                listingTitle: order.pickup_address,
                                status: order.status,
                                note: `Hi, I am your assigned DD oodle rider for order ${order.order_code} heading to pickup.`,
                              }
                            )}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-md border border-emerald-500/35 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300"
                          >
                            <MessageCircle className="h-3 w-3" />
                            <span>WhatsApp</span>
                          </a>
                        </div>
                      )}
                    </div>

                    <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-2.5 text-xs">
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-[10px] font-bold uppercase tracking-wide text-indigo-600 dark:text-indigo-400">
                          Point B • Dropoff
                        </span>
                        <a
                          href={buildGoogleMapsUrl(
                            order.dropoff_address,
                            order.dropoff_landmark
                          )}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-1 text-[10px] font-semibold text-[var(--ps-accent)] hover:underline"
                        >
                          <MapPin className="h-3 w-3" />
                          Open in Google Maps
                        </a>
                      </div>
                      <p className="mt-1 font-semibold text-[var(--ps-text)]">
                        {order.dropoff_address}
                      </p>
                      {order.recipient_phone && (
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          <a
                            href={`tel:${order.recipient_phone}`}
                            className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--ps-accent)] hover:underline"
                          >
                            <Phone className="h-3 w-3" />
                            {order.recipient_name || 'Recipient'}:{' '}
                            {order.recipient_phone}
                          </a>
                          <a
                            href={buildContextualWhatsAppUrl(
                              order.recipient_phone,
                              {
                                type: 'order_support',
                                vertical: 'Pick N Drop Dropoff',
                                code: order.order_code,
                                listingTitle: order.dropoff_address,
                                status: order.status,
                                note: `Hi ${order.recipient_name || ''}, I am your assigned DD oodle rider for order ${order.order_code} heading to dropoff.`,
                              }
                            )}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex items-center gap-1 rounded-md border border-emerald-500/35 bg-emerald-500/10 px-1.5 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300"
                          >
                            <MessageCircle className="h-3 w-3" />
                            <span>WhatsApp</span>
                          </a>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Unified Instructions & Landmarks */}
                  {(order.instructions ||
                    order.pickup_landmark ||
                    order.dropoff_landmark) && (
                    <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)]/70 px-3 py-2 text-xs">
                      <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--ps-text-muted)]">
                        Instructions &amp; Landmarks:{' '}
                      </span>
                      <span className="text-[var(--ps-text)]">
                        {order.instructions ||
                          [order.pickup_landmark, order.dropoff_landmark]
                            .filter(Boolean)
                            .join(' • ')}
                      </span>
                    </div>
                  )}

                  {/* Hot Food & Shop Counter Pickup Guidance */}
                  {(order.is_food_order || order.linked_restaurant_order_id) && (
                    <div
                      data-testid={`driver-hot-food-guidance-${order.id}`}
                      className="rounded-xl border border-orange-500/40 bg-orange-500/10 px-3 py-2 text-xs text-orange-900 dark:text-orange-200 space-y-0.5"
                    >
                      <p className="font-bold flex items-center gap-1.5">
                        <Flame className="h-3.5 w-3.5 shrink-0 text-orange-600" />
                        <span>HOT FOOD — KEEP UPRIGHT</span>
                      </p>
                      <p className="text-[11px] leading-relaxed">
                        Confirm the 4-digit counter pickup OTP at the kitchen before collecting sealed hot food containers. Keep flat &amp; upright in transit.
                      </p>
                    </div>
                  )}
                  {order.linked_shop_order_id &&
                    !order.is_food_order &&
                    !order.linked_restaurant_order_id && (
                      <div
                        data-testid={`driver-shop-guidance-${order.id}`}
                        className="rounded-xl border border-sky-500/35 bg-sky-500/10 px-3 py-2 text-xs text-sky-900 dark:text-sky-200 space-y-0.5"
                      >
                        <p className="font-bold flex items-center gap-1.5">
                          <ShoppingBag className="h-3.5 w-3.5 shrink-0 text-sky-600" />
                          <span>SHOP PICKUP — Counter Handover OTP</span>
                        </p>
                        <p className="text-[11px] leading-relaxed">
                          Verify the 4-digit handover OTP with the shop counter before collecting the packed order.
                        </p>
                      </div>
                    )}

                  {/* Print Pickup Handover & Privacy Guidance */}
                  {order.linked_print_order_id && (
                    <div
                      data-testid={`driver-print-guidance-${order.id}`}
                      className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2.5 text-xs text-amber-900 dark:text-amber-200 space-y-1"
                    >
                      <p className="font-bold flex items-center gap-1.5">
                        <Printer className="h-3.5 w-3.5 shrink-0" />
                        <span>
                          Print Counter Handover
                          {order.linked_print_order_code
                            ? ` (${order.linked_print_order_code})`
                            : ''}
                        </span>
                      </p>
                      <p className="text-[11px] leading-relaxed">
                        Show/confirm pickup OTP at the print counter before
                        collecting sealed envelope.
                      </p>
                      <p className="text-[11px] font-semibold leading-relaxed flex items-start gap-1.5">
                        <ShieldCheck className="h-3.5 w-3.5 shrink-0 mt-0.5 text-emerald-700 dark:text-emerald-400" />
                        <span>
                          Privacy-Safe POD: Capture photo of the sealed envelope
                          exterior only — never photograph open document pages.
                        </span>
                      </p>
                    </div>
                  )}

                  {/* Asymmetric OTP Handover Box */}
                  <div className="rounded-xl border border-[var(--ps-accent)]/35 bg-[var(--ps-accent)]/5 p-3 space-y-2.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 text-xs font-bold text-[var(--ps-text)]">
                        <KeyRound className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
                        <span>
                          {stage === 'pickup'
                            ? 'Stage 1: Verify Pickup OTP from Sender'
                            : stage === 'dropoff'
                              ? 'Stage 2: Verify Dropoff OTP from Recipient'
                              : 'Stage 3: Verify Return OTP from Sender'}
                        </span>
                      </div>
                      <span className="text-[10px] font-medium text-[var(--ps-text-muted)]">
                        6-digit code
                      </span>
                    </div>

                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                      <input
                        type="text"
                        inputMode="numeric"
                        maxLength={6}
                        value={otpMap[order.id] || ''}
                        onChange={(e) =>
                          setOtpMap((prev) => ({
                            ...prev,
                            [order.id]: e.target.value.replace(/\D/g, ''),
                          }))
                        }
                        placeholder="Enter 6-digit OTP"
                        className="h-9 flex-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 font-mono text-xs font-bold tracking-widest text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none"
                      />

                      {requiresPod && (
                        <label className="inline-flex h-9 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 text-xs font-semibold text-[var(--ps-text)] hover:border-[var(--ps-accent)]/50">
                          <Camera className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
                          <span className="max-w-[140px] truncate">
                            {podFileMap[order.id]?.name || 'Upload POD Photo *'}
                          </span>
                          <input
                            type="file"
                            accept="image/*"
                            capture="environment"
                            className="hidden"
                            onChange={(e) =>
                              setPodFileMap((prev) => ({
                                ...prev,
                                [order.id]: e.target.files?.[0] ?? null,
                              }))
                            }
                          />
                        </label>
                      )}

                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() =>
                          void handleVerifyHandoverOtp(order, stage)
                        }
                        className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg bg-[var(--ps-accent)] px-4 text-xs font-bold text-[var(--ps-accent-fg)] shadow-xs transition-opacity hover:opacity-90 disabled:opacity-60"
                      >
                        {isBusy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        )}
                        <span>
                          {stage === 'pickup'
                            ? 'Verify Pickup'
                            : stage === 'dropoff'
                              ? 'Complete Dropoff'
                              : 'Verify Return'}
                        </span>
                      </button>
                    </div>
                    {requiresPod && order.linked_print_order_id && (
                      <p className="text-[11px] font-medium text-amber-800 dark:text-amber-300">
                        POD Reminder: Capture photo of the sealed envelope
                        exterior only — never photograph open document pages.
                      </p>
                    )}
                  </div>
                </article>
              );
            })
          )}
        </div>
      )}

      {/* 3. COMPLETED TRIPS & PAYOUTS LEDGER */}
      {activeTab === 'payouts' && (
        <div className="space-y-4">
          <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-[var(--ps-border)]">
              <div>
                <h2 className="text-sm font-bold text-[var(--ps-text)]">
                  Driver Payouts Ledger
                </h2>
                <p className="text-[11px] text-[var(--ps-text-muted)]">
                  Verified 85% escrow releases recorded after mediator
                  confirmation.
                </p>
              </div>
              <div className="rounded-xl bg-emerald-500/12 px-3 py-1.5 text-right">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
                  Total Settled
                </p>
                <p className="text-sm font-extrabold tabular-nums text-emerald-700 dark:text-emerald-300">
                  ₹{totalEarningsInr.toLocaleString('en-IN')}
                </p>
              </div>
            </div>

            {payouts.length === 0 ? (
              <p className="py-6 text-center text-xs text-[var(--ps-text-muted)]">
                No driver payouts settled yet. Completed deliveries appear here
                immediately once confirmed by dispatch.
              </p>
            ) : (
              <div className="mt-3">
                <ResponsiveTableScroll
                  minWidthClass="min-w-[500px]"
                  showSwipeHint={true}
                  swipeHintLabel="Swipe ↔ to view payout breakdown"
                >
                  <div className="divide-y divide-[var(--ps-border)]">
                    {payouts.map((tx) => {
                      const matchedOrder = orders.find((o) => o.id === tx.order_id);
                      return (
                        <div
                          key={tx.id}
                          className="flex items-center justify-between gap-3 p-3 text-xs"
                        >
                          <div className="min-w-0">
                            <p className="font-bold text-[var(--ps-text)]">
                              {matchedOrder?.order_code || 'Completed Trip'}
                            </p>
                            <p className="truncate text-[11px] text-[var(--ps-text-muted)]">
                              {tx.notes || 'Driver escrow payout'} •{' '}
                              {new Date(tx.created_at).toLocaleDateString('en-IN', {
                                day: 'numeric',
                                month: 'short',
                              })}
                            </p>
                          </div>
                          <span className="shrink-0 font-mono text-sm font-extrabold tabular-nums text-emerald-600 dark:text-emerald-400">
                            +₹{tx.amount_inr.toLocaleString('en-IN')}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </ResponsiveTableScroll>
              </div>
            )}
          </section>

          <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4">
            <h2 className="text-sm font-bold text-[var(--ps-text)]">
              Completed &amp; Pending-Confirm Trips ({completedTrips.length})
            </h2>
            {completedTrips.length === 0 ? (
              <p className="py-5 text-center text-xs text-[var(--ps-text-muted)]">
                No completed trips recorded yet.
              </p>
            ) : (
              <div className="mt-3">
                <ResponsiveTableScroll
                  minWidthClass="min-w-[540px]"
                  showSwipeHint={true}
                  swipeHintLabel="Swipe ↔ to view all trip details"
                >
                  <div className="space-y-2 p-1">
                    {completedTrips.map((trip) => (
                      <div
                        key={trip.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2.5 text-xs"
                      >
                        <div className="min-w-0">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-mono font-bold">
                              {trip.order_code}
                            </span>
                            {trip.linked_print_order_id && (
                              <span className="inline-flex items-center gap-1 rounded bg-theme-primary/15 px-1.5 py-0.5 text-[10px] font-bold text-theme-primary">
                                <Printer className="h-2.5 w-2.5" />
                                PRINT PICKUP • SEALED
                                {trip.linked_print_order_code
                                  ? ` · ${trip.linked_print_order_code}`
                                  : ''}
                              </span>
                            )}
                            <span className="rounded bg-[var(--ps-surface)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--ps-text-muted)]">
                              {DELIVERY_STATUS_META[trip.status]?.label ||
                                trip.status}
                            </span>
                          </div>
                          <p className="mt-0.5 truncate text-[11px] text-[var(--ps-text-muted)]">
                            {trip.pickup_address} → {trip.dropoff_address}
                          </p>
                        </div>
                        <div className="text-right whitespace-nowrap">
                          <p className="font-bold tabular-nums">
                            ₹{trip.quoted_fare_inr.toLocaleString('en-IN')}
                          </p>
                          <p className="inline-flex items-center gap-1 text-[10px] text-[var(--ps-text-muted)]">
                            <Clock className="h-2.5 w-2.5" />
                            {new Date(trip.created_at).toLocaleDateString('en-IN')}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                </ResponsiveTableScroll>
              </div>
            )}
          </section>
        </div>
      )}

      {/* 4. DRIVER PROFILE & KYC CARD */}
      {activeTab === 'profile' && (
        <section className="grid grid-cols-1 gap-4 md:grid-cols-2">
          <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-[var(--ps-text)]">
                Driver Credentials &amp; KYC
              </h2>
              <span
                className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold ${
                  driverProfile?.kyc_verified
                    ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                    : 'bg-amber-500/15 text-amber-700 dark:text-amber-300'
                }`}
              >
                <UserCheck className="h-3 w-3" />
                {driverProfile?.kyc_verified ? 'Verified' : 'Pending Review'}
              </span>
            </div>

            <dl className="grid grid-cols-1 gap-2 text-xs">
              <div className="flex items-center justify-between rounded-xl bg-[var(--ps-bg)] px-3 py-2">
                <dt className="text-[var(--ps-text-muted)]">Registered Name</dt>
                <dd className="font-semibold">
                  {driverProfile?.full_name || fullName || '—'}
                </dd>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-[var(--ps-bg)] px-3 py-2">
                <dt className="text-[var(--ps-text-muted)]">Phone</dt>
                <dd className="font-mono font-semibold">
                  {driverProfile?.phone || '—'}
                </dd>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-[var(--ps-bg)] px-3 py-2">
                <dt className="text-[var(--ps-text-muted)]">Driving License</dt>
                <dd className="font-mono font-semibold">
                  {driverProfile?.license_no || '—'}
                </dd>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-[var(--ps-bg)] px-3 py-2">
                <dt className="text-[var(--ps-text-muted)]">Vehicle Plate</dt>
                <dd className="font-mono font-semibold">
                  {primaryVehicle?.plate_number || 'Unassigned'}
                </dd>
              </div>
              <div className="flex items-center justify-between rounded-xl bg-[var(--ps-bg)] px-3 py-2">
                <dt className="text-[var(--ps-text-muted)]">RC Number</dt>
                <dd className="font-mono font-semibold">
                  {primaryVehicle?.rc_number || '—'}
                </dd>
              </div>
            </dl>
          </div>

          <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 flex flex-col justify-between space-y-3">
            <div>
              <h2 className="text-sm font-bold text-[var(--ps-text)]">
                Mediator Dispatch Support
              </h2>
              <p className="mt-1 text-xs leading-relaxed text-[var(--ps-text-muted)]">
                Need assistance with an unreachable recipient, UPI escrow
                dispute, or vehicle plate update? Reach out to Churachandpur
                Dispatch Mediators directly.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 pt-2">
              <Link
                href="/contact"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--ps-accent)] px-3 text-xs font-semibold text-[var(--ps-accent-fg)]"
              >
                <Phone className="h-3.5 w-3.5" />
                <span>Dispatch Support</span>
              </Link>
              <Link
                href="/explore"
                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs font-semibold text-[var(--ps-text)]"
              >
                <MapPin className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
                <span>Open Explore Map</span>
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* TAB: MY VEHICLE LISTING (RENTALS / CHARTER) */}
      {activeTab === 'vehicle_listing' && (
        <VehicleFleetCalendarManager
          viewMode="listing"
          driverRecordId={driverProfile?.id ?? null}
          onNotice={setBanner}
        />
      )}

      {/* TAB: SCHEDULE, BUSY DATE BLOCKS & BOOKINGS */}
      {activeTab === 'schedule' && (
        <VehicleFleetCalendarManager
          viewMode="calendar"
          driverRecordId={driverProfile?.id ?? null}
          onNotice={setBanner}
        />
      )}

      {confirmDialog}
    </div>
  );
}

export default DriverWorkspace;
