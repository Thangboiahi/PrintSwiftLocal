'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  ClipboardList,
  Clock,
  CreditCard,
  IndianRupee,
  RefreshCw,
  Scale,
  ShieldAlert,
  ShieldCheck,
  Truck,
} from 'lucide-react';
import {
  WorkspaceNavShell,
  type WorkspaceNavGroup,
} from '@/components/workspaces/shared/WorkspaceNavShell';
import { MediatorVerificationQueue } from '@/components/workspaces/mediator/MediatorVerificationQueue';
import {
  MediatorEscrowPayoutsPanel,
  MediatorLiveDispatchPanel,
} from '@/components/workspaces/mediator/MediatorDispatchAndEscrow';
import { MediatorAuditHistory } from '@/components/workspaces/mediator/MediatorAuditHistory';
import { setAppStatus } from '@/lib/hooks/useAppStatus';
import { useAuth } from '@/lib/store';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import {
  computeUpiSlaStatus,
  formatFleetClassLabel,
  type MediatorAuditLogRow,
  type MediatorDispatchItem,
  type MediatorDriverOption,
  type MediatorEscrowItem,
  type MediatorKpiMetrics,
  type MediatorOtpMilestone,
  type MediatorPaymentQueueItem,
  type MediatorSectionId,
  type MediatorVehicleType,
} from '@/lib/mediator/types';

export interface MediatorWorkspaceProps {
  onOpenListingOnMap?: (listingId?: string) => void;
}

const DEFAULT_OTP_MILESTONE: MediatorOtpMilestone = {
  pickup_verified: false,
  pickup_verified_at: null,
  dropoff_verified: false,
  dropoff_verified_at: null,
  return_required: false,
  return_verified: false,
  return_verified_at: null,
  failed_attempts: 0,
  is_locked: false,
};

interface RawDeliveryOrder {
  id: string;
  order_code: string;
  customer_id: string;
  driver_id: string | null;
  vehicle_type_id: string;
  trip_type: 'one_way' | 'two_way';
  service_mode?: string | null;
  pickup_address: string;
  dropoff_address: string;
  sender_phone: string;
  recipient_name: string;
  quoted_fare_inr: number | string;
  status: string;
  dispute_reason?: string | null;
  pod_storage_path?: string | null;
  pod_uploaded_at?: string | null;
  pod_purge_at?: string | null;
  payment_verified_at?: string | null;
  payout_released_at?: string | null;
  created_at: string;
  updated_at: string;
}

interface RawDeliveryTx {
  id: string;
  order_id: string;
  tx_type: string;
  status?: string | null;
  amount_inr: number | string;
  upi_utr_ref: string | null;
  payment_proof_path: string | null;
  created_at: string;
}

interface RawVehicleBooking {
  id: string;
  booking_code: string;
  vehicle_listing_id: string;
  customer_id: string;
  payment_intent_id: string | null;
  assigned_driver_id?: string | null;
  pickup_location: string;
  dropoff_location: string | null;
  total_fare_inr: number | string;
  advance_amount_inr: number | string;
  status: string;
  escrow_status?: string | null;
  dispute_reason?: string | null;
  pod_storage_path?: string | null;
  pod_uploaded_at?: string | null;
  pod_purge_at?: string | null;
  payment_verified_at?: string | null;
  payout_released_at?: string | null;
  created_at: string;
  updated_at: string;
}

interface RawVehicleListing {
  id: string;
  title: string;
  vehicle_type_id: string;
  driver_id: string | null;
}

interface RawPaymentIntent {
  id: string;
  intent_code: string;
  user_id: string;
  purpose: string;
  reference_id: string;
  amount_inr: number | string;
  upi_utr_ref: string | null;
  payment_proof_path: string | null;
  status: string;
  created_at: string;
  updated_at: string;
}

interface RawProfileSnippet {
  id: string;
  full_name: string | null;
  phone: string | null;
  email: string | null;
}

export function MediatorWorkspace({
  onOpenListingOnMap: _onOpenListingOnMap,
}: MediatorWorkspaceProps) {
  void _onOpenListingOnMap;
  const { user: authUser } = useAuth();
  const authUserId = authUser?.id || null;

  const [activeSection, setActiveSection] =
    useState<MediatorSectionId>('overview');
  const [nowMs, setNowMs] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [notice, setNotice] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  const [paymentQueue, setPaymentQueue] = useState<MediatorPaymentQueueItem[]>(
    []
  );
  const [dispatchQueue, setDispatchQueue] = useState<MediatorDispatchItem[]>(
    []
  );
  const [escrowQueue, setEscrowQueue] = useState<MediatorEscrowItem[]>([]);
  // v21a (P0-26): funded Pick N Drop jobs still unclaimed after 15 minutes
  const [slaBreaches, setSlaBreaches] = useState<
    Array<{ id: string; order_code: string; minutes_waiting: number }>
  >([]);
  const [drivers, setDrivers] = useState<MediatorDriverOption[]>([]);
  const [auditLogs, setAuditLogs] = useState<MediatorAuditLogRow[]>([]);

  // Live 1-second clock tick for 10-minute UPI SLA timers (SSR-safe)
  useEffect(() => {
    const initTimer = window.setTimeout(() => {
      setNowMs(Date.now());
    }, 0);
    const interval = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);
    return () => {
      window.clearTimeout(initTimer);
      window.clearInterval(interval);
    };
  }, []);

  const loadMediatorData = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const [
        ordersRes,
        txRes,
        vBookingsRes,
        vListingsRes,
        intentsRes,
        vTypesRes,
        driversRes,
        auditRes,
      ] = await Promise.all([
        Promise.resolve(
          supabase
            .from('delivery_orders')
            .select(
              'id, order_code, customer_id, driver_id, vehicle_type_id, trip_type, service_mode, pickup_address, dropoff_address, sender_phone, recipient_name, quoted_fare_inr, status, dispute_reason, pod_storage_path, pod_uploaded_at, pod_purge_at, payment_verified_at, payout_released_at, created_at, updated_at'
            )
            .order('created_at', { ascending: false })
            .limit(120)
        ).catch(() => ({ data: [], error: null })),
        Promise.resolve(
          supabase
            .from('delivery_transactions')
            .select(
              'id, order_id, tx_type, status, amount_inr, upi_utr_ref, payment_proof_path, created_at'
            )
            .in('tx_type', ['upi_payment', 'driver_payout'])
            .order('created_at', { ascending: false })
            .limit(250)
        ).catch(() => ({ data: [], error: null })),
        Promise.resolve(
          supabase
            .from('vehicle_bookings')
            .select(
              'id, booking_code, vehicle_listing_id, customer_id, payment_intent_id, assigned_driver_id, pickup_location, dropoff_location, total_fare_inr, advance_amount_inr, status, escrow_status, dispute_reason, pod_storage_path, pod_uploaded_at, pod_purge_at, payment_verified_at, payout_released_at, created_at, updated_at'
            )
            .order('created_at', { ascending: false })
            .limit(120)
        ).catch(() => ({ data: [], error: null })),
        Promise.resolve(
          supabase
            .from('vehicle_listings')
            .select('id, title, vehicle_type_id, driver_id')
            .limit(200)
        ).catch(() => ({ data: [], error: null })),
        Promise.resolve(
          supabase
            .from('payment_intents')
            .select(
              'id, intent_code, user_id, purpose, reference_id, amount_inr, upi_utr_ref, payment_proof_path, status, created_at, updated_at'
            )
            .in('purpose', ['pick_n_drop', 'vehicle_booking'])
            .order('created_at', { ascending: false })
            .limit(200)
        ).catch(() => ({ data: [], error: null })),
        Promise.resolve(
          supabase.from('vehicle_types').select('id, slug, name')
        ).catch(() => ({ data: [], error: null })),
        Promise.resolve(
          supabase
            .from('drivers')
            .select(
              'id, profile_id, full_name, phone, vehicle_type, vehicle_reg_no, kyc_verified, kyc_status, is_online, is_active, hub_id'
            )
            .order('is_online', { ascending: false })
            .order('full_name', { ascending: true })
        ).catch(() => ({ data: [], error: null })),
        Promise.resolve(
          supabase
            .from('audit_logs')
            .select(
              'id, actor_id, actor_name, actor_role, workspace, action, target_table, target_id, target_name, details, metadata, created_at'
            )
            .eq('workspace', 'mediator')
            .order('created_at', { ascending: false })
            .limit(100)
        ).catch(() => ({ data: [], error: null })),
      ]);

      const rawOrders = (ordersRes.data || []) as RawDeliveryOrder[];
      const rawTxs = (txRes.data || []) as RawDeliveryTx[];
      const rawVBookings = (vBookingsRes.data || []) as RawVehicleBooking[];
      const rawVListings = (vListingsRes.data || []) as RawVehicleListing[];
      const rawIntents = (intentsRes.data || []) as RawPaymentIntent[];
      const rawVTypes = (vTypesRes.data || []) as MediatorVehicleType[];
      const rawDrivers = (driversRes.data || []) as MediatorDriverOption[];
      const rawAudit = (auditRes.data || []) as MediatorAuditLogRow[];

      // Resolve customer profiles in one query
      const customerIds = Array.from(
        new Set([
          ...rawOrders.map((o) => o.customer_id),
          ...rawVBookings.map((b) => b.customer_id),
        ])
      ).filter(Boolean);

      const profileMap = new Map<string, RawProfileSnippet>();
      if (customerIds.length > 0) {
        const profilesRes = await Promise.resolve(
          supabase
            .from('profiles')
            .select('id, full_name, phone, email')
            .in('id', customerIds)
        ).catch(() => ({ data: [] }));

        for (const p of (profilesRes.data || []) as RawProfileSnippet[]) {
          profileMap.set(p.id, p);
        }
      }

      // Fetch zero-secret OTP milestones via SECURITY DEFINER RPC (never raw OTPs)
      const deliveryMilestoneMap = new Map<string, MediatorOtpMilestone>();
      const vehicleMilestoneMap = new Map<string, MediatorOtpMilestone>();
      const orderIds = rawOrders.map((o) => o.id);
      const bookingIds = rawVBookings.map((b) => b.id);

      if (orderIds.length > 0 || bookingIds.length > 0) {
        const msRes = await Promise.resolve(
          supabase.rpc('get_mediator_otp_milestones', {
            p_order_ids: orderIds,
            p_booking_ids: bookingIds,
          })
        ).catch(() => ({ data: null, error: null }));

        const payload = msRes.data as {
          delivery?: Record<string, MediatorOtpMilestone>;
          vehicle?: Record<string, MediatorOtpMilestone>;
        } | null;

        if (payload?.delivery) {
          for (const [k, v] of Object.entries(payload.delivery)) {
            deliveryMilestoneMap.set(k, v);
          }
        }
        if (payload?.vehicle) {
          for (const [k, v] of Object.entries(payload.vehicle)) {
            vehicleMilestoneMap.set(k, v);
          }
        }
      }

      const vTypeMap = new Map(rawVTypes.map((vt) => [vt.id, vt]));
      const driverMap = new Map(rawDrivers.map((d) => [d.id, d]));
      const vListingMap = new Map(rawVListings.map((vl) => [vl.id, vl]));

      const activeUpiTxByOrder = new Map<string, RawDeliveryTx>();
      for (const tx of rawTxs) {
        if (
          tx.tx_type === 'upi_payment' &&
          tx.status !== 'rejected' &&
          !activeUpiTxByOrder.has(tx.order_id)
        ) {
          activeUpiTxByOrder.set(tx.order_id, tx);
        }
      }

      const intentById = new Map(rawIntents.map((i) => [i.id, i]));
      const intentByRef = new Map<string, RawPaymentIntent>();
      for (const intent of rawIntents) {
        const key = `${intent.purpose}:${intent.reference_id}`;
        if (!intentByRef.has(key)) {
          intentByRef.set(key, intent);
        }
      }

      // 1. Build UPI Verification Queue (Pick N Drop + Scheduled Vehicles)
      const nextPaymentQueue: MediatorPaymentQueueItem[] = [];

      for (const order of rawOrders) {
        const intent = intentByRef.get(`pick_n_drop:${order.id}`);
        const tx = activeUpiTxByOrder.get(order.id);
        const isPending =
          order.status === 'payment_submitted' ||
          (order.status === 'awaiting_payment' &&
            intent?.status === 'pending_manual');

        if (!isPending) continue;

        const prof = profileMap.get(order.customer_id);
        const vt = vTypeMap.get(order.vehicle_type_id);
        const expected = Number(order.quoted_fare_inr || 0);
        const submitted = Number(
          tx?.amount_inr ?? intent?.amount_inr ?? expected
        );

        nextPaymentQueue.push({
          id: order.id,
          domain: 'pick_n_drop',
          code: order.order_code,
          status: order.status,
          paymentIntentId: intent?.id || null,
          utrRef: tx?.upi_utr_ref || intent?.upi_utr_ref || null,
          proofPath: tx?.payment_proof_path || intent?.payment_proof_path || null,
          expectedAmountInr: expected,
          submittedAmountInr: submitted,
          customerName:
            prof?.full_name || prof?.email || order.recipient_name || 'Customer',
          customerPhone: prof?.phone || order.sender_phone || '',
          routeSummary: `${order.pickup_address} → ${order.dropoff_address}`,
          vehicleClassSlug: vt?.slug || 'two_wheeler',
          vehicleClassName: vt?.name || formatFleetClassLabel(vt?.slug),
          submittedAt:
            tx?.created_at ||
            intent?.updated_at ||
            order.updated_at ||
            order.created_at,
          createdAt: order.created_at,
          cancellationRequest: order.status === 'payment_submitted' &&
            (order.dispute_reason || '').startsWith(
            'Customer cancellation requested'
          )
            ? order.dispute_reason
            : null,
        });
      }

      for (const vb of rawVBookings) {
        const intent =
          (vb.payment_intent_id ? intentById.get(vb.payment_intent_id) : null) ||
          intentByRef.get(`vehicle_booking:${vb.id}`) ||
          null;
        const isPending =
          vb.status === 'pending_payment_confirm' ||
          (vb.status === 'soft_hold' && intent?.status === 'pending_manual');

        if (!isPending) continue;

        const prof = profileMap.get(vb.customer_id);
        const vl = vListingMap.get(vb.vehicle_listing_id);
        const vt = vl ? vTypeMap.get(vl.vehicle_type_id) : null;
        const expected = Number(vb.advance_amount_inr || 0);
        const submitted = Number(intent?.amount_inr ?? expected);

        nextPaymentQueue.push({
          id: vb.id,
          domain: 'vehicle_booking',
          code: vb.booking_code,
          status: vb.status,
          paymentIntentId: intent?.id || null,
          utrRef: intent?.upi_utr_ref || null,
          proofPath: intent?.payment_proof_path || null,
          expectedAmountInr: expected,
          submittedAmountInr: submitted,
          customerName: prof?.full_name || prof?.email || 'Customer',
          customerPhone: prof?.phone || '',
          routeSummary: `${vb.pickup_location}${vb.dropoff_location ? ` → ${vb.dropoff_location}` : ''}`,
          vehicleClassSlug: vt?.slug || 'mini_van',
          vehicleClassName: vt?.name || vl?.title || 'Scheduled Vehicle',
          submittedAt:
            intent?.updated_at || vb.updated_at || vb.created_at,
          createdAt: vb.created_at,
          cancellationRequest: vb.status === 'pending_payment_confirm' &&
            (vb.dispute_reason || '').startsWith(
            'Customer cancellation requested'
          )
            ? vb.dispute_reason
            : null,
        });
      }

      // 2. Build Live Dispatch Queue (Funded orders awaiting pickup or needing reassignment)
      const nextDispatchQueue: MediatorDispatchItem[] = [];

      for (const order of rawOrders) {
        if (!['escrow_held', 'driver_assigned'].includes(order.status)) continue;
        const prof = profileMap.get(order.customer_id);
        const vt = vTypeMap.get(order.vehicle_type_id);
        const drv = order.driver_id ? driverMap.get(order.driver_id) : null;

        nextDispatchQueue.push({
          id: order.id,
          domain: 'pick_n_drop',
          code: order.order_code,
          status: order.status,
          serviceLabel: `Pick N Drop · ${(order.service_mode || 'parcel').toUpperCase()}`,
          customerName: prof?.full_name || order.recipient_name || 'Customer',
          customerPhone: prof?.phone || order.sender_phone || '',
          pickupAddress: order.pickup_address,
          dropoffAddress: order.dropoff_address,
          fareInr: Number(order.quoted_fare_inr || 0),
          vehicleTypeId: order.vehicle_type_id,
          vehicleClassSlug: vt?.slug || 'two_wheeler',
          vehicleClassName: vt?.name || formatFleetClassLabel(vt?.slug),
          driverId: order.driver_id,
          driverName: drv?.full_name || null,
          driverPhone: drv?.phone || null,
          createdAt: order.created_at,
          paymentVerifiedAt: order.payment_verified_at || null,
        });
      }

      for (const vb of rawVBookings) {
        if (!['confirmed', 'in_progress'].includes(vb.status)) continue;
        const prof = profileMap.get(vb.customer_id);
        const vl = vListingMap.get(vb.vehicle_listing_id);
        const vt = vl ? vTypeMap.get(vl.vehicle_type_id) : null;
        const resolvedDriverId = vb.assigned_driver_id || vl?.driver_id || null;
        const drv = resolvedDriverId ? driverMap.get(resolvedDriverId) : null;

        nextDispatchQueue.push({
          id: vb.id,
          domain: 'vehicle_booking',
          code: vb.booking_code,
          status: vb.status,
          serviceLabel: vl?.title || 'Scheduled Vehicle',
          customerName: prof?.full_name || 'Customer',
          customerPhone: prof?.phone || '',
          pickupAddress: vb.pickup_location,
          dropoffAddress: vb.dropoff_location || 'Charter Schedule',
          fareInr: Number(vb.advance_amount_inr || 0),
          vehicleTypeId: vl?.vehicle_type_id || null,
          vehicleClassSlug: vt?.slug || 'mini_van',
          vehicleClassName: vt?.name || formatFleetClassLabel(vt?.slug),
          driverId: resolvedDriverId,
          driverName: drv?.full_name || null,
          driverPhone: drv?.phone || null,
          createdAt: vb.created_at,
          paymentVerifiedAt: vb.payment_verified_at || null,
        });
      }

      // 3. Build Escrow Payouts, POD Audit & Disputes Queue
      const nextEscrowQueue: MediatorEscrowItem[] = [];

      for (const order of rawOrders) {
        // v21a (P0-03): funded orders awaiting pickup (escrow_held / driver_assigned) are
        // refundable/freezable here too. Unverified UPI (`payment_submitted`) stays in the
        // Verification queue (verify or reject) — never refund/release unconfirmed money.
        if (
          ![
            'escrow_held',
            'driver_assigned',
            'picked_up',
            'in_transit',
            'return_in_transit',
            'delivered_pending_confirm',
            'disputed',
            'completed',
          ].includes(order.status)
        ) {
          continue;
        }
        const prof = profileMap.get(order.customer_id);
        const drv = order.driver_id ? driverMap.get(order.driver_id) : null;
        const fare = Number(order.quoted_fare_inr || 0);
        const payout = Math.round(fare * 0.85 * 100) / 100;
        const ms =
          deliveryMilestoneMap.get(order.id) || {
            ...DEFAULT_OTP_MILESTONE,
            return_required: order.trip_type === 'two_way',
          };

        nextEscrowQueue.push({
          id: order.id,
          domain: 'pick_n_drop',
          code: order.order_code,
          status: order.status,
          escrowStateLabel:
            order.status === 'delivered_pending_confirm'
              ? 'Ready to Release'
              : order.status === 'disputed'
                ? 'Frozen · Disputed'
                : order.status === 'completed'
                  ? 'Payout Settled'
                  : order.status === 'escrow_held' || order.status === 'driver_assigned'
                    ? 'Funded · Awaiting Pickup'
                    : order.status.replace(/_/g, ' '),
          tripType: order.trip_type,
          fareInr: fare,
          payoutAmountInr: payout,
          customerName: prof?.full_name || order.recipient_name || 'Customer',
          customerPhone: prof?.phone || order.sender_phone || '',
          driverName: drv?.full_name || null,
          driverPhone: drv?.phone || null,
          routeSummary: `${order.pickup_address} → ${order.dropoff_address}`,
          disputeReason: order.dispute_reason || null,
          podStoragePath: order.pod_storage_path || null,
          podUploadedAt: order.pod_uploaded_at || null,
          podPurgeAt: order.pod_purge_at || null,
          payoutReleasedAt: order.payout_released_at || null,
          updatedAt: order.updated_at,
          otpMilestones: ms,
        });
      }

      for (const vb of rawVBookings) {
        // v21a (P0-03): confirmed charters are refundable/freezable; completed charters stay
        // in the queue until their escrow is actually released or refunded.
        if (
          !['confirmed', 'in_progress', 'disputed', 'completed'].includes(vb.status)
        ) {
          continue;
        }
        const prof = profileMap.get(vb.customer_id);
        const vl = vListingMap.get(vb.vehicle_listing_id);
        const resolvedDriverId = vb.assigned_driver_id || vl?.driver_id || null;
        const drv = resolvedDriverId ? driverMap.get(resolvedDriverId) : null;
        const adv = Number(vb.advance_amount_inr || 0);
        const ms = vehicleMilestoneMap.get(vb.id) || DEFAULT_OTP_MILESTONE;

        nextEscrowQueue.push({
          id: vb.id,
          domain: 'vehicle_booking',
          code: vb.booking_code,
          status: vb.status,
          escrowStateLabel:
            vb.status === 'disputed'
              ? 'Frozen · Disputed'
              : vb.escrow_status === 'released'
                ? 'Payout Settled'
                : vb.escrow_status === 'refunded'
                  ? 'Refunded'
                  : vb.status === 'completed'
                    ? 'Ready to Release'
                    : vb.status === 'confirmed'
                      ? 'Funded · Awaiting Trip'
                      : 'In Progress',
          tripType: 'scheduled',
          fareInr: adv,
          payoutAmountInr: adv,
          customerName: prof?.full_name || 'Customer',
          customerPhone: prof?.phone || '',
          driverName: drv?.full_name || null,
          driverPhone: drv?.phone || null,
          routeSummary: `${vb.pickup_location}${vb.dropoff_location ? ` → ${vb.dropoff_location}` : ''}`,
          disputeReason: vb.dispute_reason || null,
          podStoragePath: vb.pod_storage_path || null,
          podUploadedAt: vb.pod_uploaded_at || null,
          podPurgeAt: vb.pod_purge_at || null,
          payoutReleasedAt: vb.payout_released_at || null,
          updatedAt: vb.updated_at,
          otpMilestones: ms,
          escrowStatus: vb.escrow_status || null,
        });
      }

      setPaymentQueue(nextPaymentQueue);
      setDispatchQueue(nextDispatchQueue);
      setEscrowQueue(nextEscrowQueue);

      // v21a (P0-26): >15m unaccepted funded-job SLA (hub-scoped server-side)
      try {
        const { data: slaData, error: slaErr } = await supabase.rpc(
          'get_pnd_dispatch_sla_breaches',
          { p_threshold_minutes: 15 }
        );
        const breaches =
          !slaErr && slaData && Array.isArray((slaData as { breaches?: unknown }).breaches)
            ? ((slaData as { breaches: Array<Record<string, unknown>> }).breaches || []).map(
                (b) => ({
                  id: String(b.id || ''),
                  order_code: String(b.order_code || ''),
                  minutes_waiting: Number(b.minutes_waiting || 0),
                })
              )
            : [];
        setSlaBreaches(breaches);
      } catch {
        setSlaBreaches([]);
      }
      setDrivers(rawDrivers);
      setAuditLogs(
        authUserId
          ? rawAudit.filter((r) => !r.actor_id || r.actor_id === authUserId)
          : rawAudit
      );
    } catch (err) {
      setNotice({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Unable to load Dispatch Mediator console data.',
      });
    } finally {
      setIsLoading(false);
    }
  }, [authUserId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadMediatorData();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadMediatorData]);

  // Live KPI computation
  const kpis = useMemo<MediatorKpiMetrics>(() => {
    const effectiveNow = nowMs || 0;
    const overdueSlaCount =
      effectiveNow > 0
        ? paymentQueue.filter(
            (item) => computeUpiSlaStatus(item.submittedAt, effectiveNow).isOverdue
          ).length
        : 0;

    // v21a (P0-03): count each funded trip ONCE even when it appears in both the
    // dispatch queue and the escrow queue (previously in-transit trips were double counted).
    const fundedByKey = new Map<string, number>();
    for (const item of dispatchQueue) {
      fundedByKey.set(`${item.domain}-${item.id}`, item.fareInr);
    }
    for (const e of escrowQueue) {
      if (
        [
          'escrow_held',
          'driver_assigned',
          'confirmed',
          'picked_up',
          'in_transit',
          'in_progress',
          'return_in_transit',
          'delivered_pending_confirm',
        ].includes(e.status)
      ) {
        fundedByKey.set(`${e.domain}-${e.id}`, e.fareInr);
      }
    }
    const activeFundedEscrowsCount = fundedByKey.size;
    const activeFundedEscrowsValueInr = Array.from(fundedByKey.values()).reduce(
      (sum, v) => sum + v,
      0
    );

    const openDisputesCount = escrowQueue.filter(
      (e) => e.status === 'disputed'
    ).length;

    const startOfTodayMs =
      effectiveNow > 0
        ? new Date(
            new Date(effectiveNow).getFullYear(),
            new Date(effectiveNow).getMonth(),
            new Date(effectiveNow).getDate()
          ).getTime()
        : 0;

    let releasedTodayInr = 0;
    let releasedTodayCount = 0;
    for (const item of escrowQueue) {
      if (item.status !== 'completed' || !item.payoutReleasedAt) continue;
      const releasedTs = Date.parse(item.payoutReleasedAt);
      if (
        startOfTodayMs > 0 &&
        Number.isFinite(releasedTs) &&
        releasedTs >= startOfTodayMs
      ) {
        releasedTodayInr += item.payoutAmountInr;
        releasedTodayCount += 1;
      }
    }

    return {
      pendingUpiCount: paymentQueue.length,
      overdueSlaCount,
      activeFundedEscrowsCount,
      activeFundedEscrowsValueInr,
      openDisputesCount,
      releasedTodayInr,
      releasedTodayCount,
    };
  }, [paymentQueue, dispatchQueue, escrowQueue, nowMs]);

  // RPC Actions
  const handleVerifyPayment = async (item: MediatorPaymentQueueItem) => {
    setBusyId(item.id);
    setAppStatus('saving', `Verifying ${item.code}...`);
    try {
      const { error } = await supabase.rpc('mediator_verify_upi_payment', {
        p_booking_id: item.id,
        p_decision: 'verify',
        p_notes: `Verified UTR ${item.utrRef || 'manual'} from Mediator Workspace`,
      });
      if (error) throw new Error(error.message);

      setNotice({
        type: 'success',
        text: `UPI verified and escrow funded for ${item.code}. Ready for driver dispatch.`,
      });
      setAppStatus('success', 'Escrow funded');
      await loadMediatorData();
    } catch (err) {
      setNotice({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : `Failed to verify UPI payment for ${item.code}.`,
      });
      setAppStatus('error', 'Verification failed');
    } finally {
      setBusyId(null);
    }
  };

  const handleRejectPayment = async (
    item: MediatorPaymentQueueItem,
    reason: string
  ) => {
    setBusyId(item.id);
    setAppStatus('saving', `Rejecting ${item.code}...`);
    try {
      const { error } = await supabase.rpc('mediator_verify_upi_payment', {
        p_booking_id: item.id,
        p_decision: 'reject',
        p_notes: reason,
      });
      if (error) throw new Error(error.message);

      setNotice({
        type: 'info',
        text: `Rejected manual UPI payment for ${item.code} and logged reason to audit history.`,
      });
      setAppStatus('success', 'Payment rejected');
      await loadMediatorData();
    } catch (err) {
      setNotice({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : `Failed to reject payment for ${item.code}.`,
      });
      setAppStatus('error', 'Rejection failed');
    } finally {
      setBusyId(null);
    }
  };

  const handleDispatchDriver = async (
    item: MediatorDispatchItem,
    driverId: string,
    reason?: string
  ) => {
    setBusyId(item.id);
    setAppStatus('saving', `Dispatching driver for ${item.code}...`);
    try {
      const { error } = await supabase.rpc('mediator_dispatch_driver', {
        p_booking_id: item.id,
        p_driver_id: driverId,
        p_reason: reason || null,
      });
      if (error) throw new Error(error.message);

      setNotice({
        type: 'success',
        text: `Driver assigned cleanly to ${item.code} and recorded in audit history.`,
      });
      setAppStatus('success', 'Driver dispatched');
      await loadMediatorData();
    } catch (err) {
      setNotice({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : `Failed to dispatch driver for ${item.code}.`,
      });
      setAppStatus('error', 'Dispatch failed');
    } finally {
      setBusyId(null);
    }
  };

  const handleResolveEscrow = async (
    item: MediatorEscrowItem,
    action: 'release_to_driver' | 'freeze_dispute' | 'refund_customer',
    reason: string
  ) => {
    setBusyId(item.id);
    setAppStatus('saving', `Updating escrow for ${item.code}...`);
    try {
      const { error } = await supabase.rpc('mediator_resolve_escrow_payout', {
        p_booking_id: item.id,
        p_action: action,
        p_reason: reason,
      });
      if (error) throw new Error(error.message);

      const actionMsg =
        action === 'release_to_driver'
          ? `Escrow payout released for ${item.code}. POD photo scheduled for 48h auto-purge.`
          : action === 'freeze_dispute'
            ? `Escrow frozen under dispute for ${item.code}.`
            : `Customer escrow refund approved for ${item.code}.`;

      setNotice({ type: 'success', text: actionMsg });
      setAppStatus('success', 'Escrow updated');
      await loadMediatorData();
    } catch (err) {
      setNotice({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : `Failed to resolve escrow for ${item.code}.`,
      });
      setAppStatus('error', 'Escrow update failed');
    } finally {
      setBusyId(null);
    }
  };

  // 5 Nested Navigation Groups for WorkspaceNavShell
  const navGroups = useMemo<WorkspaceNavGroup[]>(
    () => [
      {
        id: 'pulse',
        label: 'Overview & SLA Pulse',
        shortLabel: 'Overview',
        icon: Activity,
        items: [
          {
            id: 'overview',
            label: 'Overview & SLA Pulse',
            shortLabel: 'Overview',
            icon: Activity,
            badge: kpis.overdueSlaCount > 0 ? kpis.overdueSlaCount : undefined,
          },
        ],
      },
      {
        id: 'verification',
        label: 'UPI Verification Queue',
        shortLabel: 'UPI Queue',
        icon: CreditCard,
        items: [
          {
            id: 'upi_queue',
            label: 'UPI Verification Queue',
            shortLabel: 'UPI Queue',
            icon: CreditCard,
            badge: kpis.pendingUpiCount || undefined,
          },
        ],
      },
      {
        id: 'dispatch',
        label: 'Live Dispatch & Fleet',
        shortLabel: 'Dispatch',
        icon: Truck,
        items: [
          {
            id: 'live_dispatch',
            label: 'Live Dispatch & Fleet Assignment',
            shortLabel: 'Dispatch',
            icon: Truck,
            badge: dispatchQueue.filter((d) => !d.driverId).length || undefined,
          },
        ],
      },
      {
        id: 'escrow',
        label: 'Escrow, POD & Disputes',
        shortLabel: 'Escrow',
        icon: Scale,
        items: [
          {
            id: 'escrow_payouts',
            label: 'Escrow Payouts, POD Audit & Disputes',
            shortLabel: 'Escrow & POD',
            icon: Scale,
            badge:
              escrowQueue.filter(
                (e) =>
                  e.status === 'delivered_pending_confirm' ||
                  e.status === 'disputed'
              ).length || undefined,
          },
        ],
      },
      {
        id: 'audit',
        label: 'Audit History',
        shortLabel: 'Audit',
        icon: ClipboardList,
        items: [
          {
            id: 'audit_history',
            label: 'Audit History',
            shortLabel: 'Audit',
            icon: ClipboardList,
          },
        ],
      },
    ],
    [kpis, dispatchQueue, escrowQueue]
  );

  const headerSlot = (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-[var(--ps-text-muted)]">10m SLA Overdue</span>
        <span
          className={`font-mono font-bold ${
            kpis.overdueSlaCount > 0
              ? 'text-rose-600 dark:text-rose-400'
              : 'text-emerald-600 dark:text-emerald-400'
          }`}
        >
          {kpis.overdueSlaCount}
        </span>
      </div>
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-[var(--ps-text-muted)]">Open Disputes</span>
        <span className="font-mono font-bold text-[var(--ps-text)]">
          {kpis.openDisputesCount}
        </span>
      </div>
    </div>
  );

  return (
    <div
      data-testid="mediator-workspace"
      className="mx-auto w-full max-w-7xl px-4 py-4 sm:px-6 sm:py-5"
    >
      <WorkspaceNavShell
        groups={navGroups}
        activeId={activeSection}
        onSelect={(id) => setActiveSection(id as MediatorSectionId)}
        navTitle="Dispatch Mediator"
        headerSlot={headerSlot}
        testIdPrefix="mediator-nav"
      >
        <div className="space-y-4">
          {/* Status Notice Banner */}
          {notice && (
            <div
              role="status"
              className={`flex items-center justify-between gap-3 rounded-2xl border px-4 py-3 text-xs font-semibold ${
                notice.type === 'error'
                  ? 'border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                  : notice.type === 'success'
                    ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                    : 'border-[var(--ps-accent)]/35 bg-[var(--ps-accent)]/10 text-[var(--ps-text)]'
              }`}
            >
              <span>{notice.text}</span>
              <button
                type="button"
                onClick={() => setNotice(null)}
                className="min-h-[36px] rounded-lg px-2.5 text-[11px] font-bold hover:bg-black/5 dark:hover:bg-white/10 cursor-pointer"
              >
                Dismiss
              </button>
            </div>
          )}

          {/* SECTION 1: OVERVIEW & SLA PULSE */}
          {activeSection === 'overview' && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5 flex flex-wrap items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[var(--ps-accent)]">
                    <ShieldCheck className="h-3.5 w-3.5" />
                    <span>Dispatch Mediator &amp; UPI Escrow Desk</span>
                  </div>
                  <h1 className="mt-1 text-lg font-extrabold tracking-tight text-[var(--ps-text)]">
                    Overview &amp; SLA Pulse
                  </h1>
                  <p className="mt-1 text-xs text-[var(--ps-text-muted)]">
                    Verify Pick N Drop &amp; Scheduled Vehicle UPI payments
                    within the 10-minute SLA, dispatch KYC-verified drivers, and
                    settle escrow payouts cleanly.
                  </p>
                </div>

                <button
                  type="button"
                  onClick={() => void loadMediatorData()}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-4 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors cursor-pointer"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  <span>Refresh Desk</span>
                </button>
              </div>

              {slaBreaches.length > 0 && (
                <div
                  role="alert"
                  className="rounded-2xl border border-rose-500/40 bg-rose-500/10 p-3.5 text-xs text-rose-800 dark:text-rose-200 space-y-1"
                >
                  <p className="font-extrabold">
                    {slaBreaches.length} funded Pick N Drop job
                    {slaBreaches.length === 1 ? ' has' : 's have'} waited over 15 minutes without a driver.
                  </p>
                  <p>
                    {slaBreaches
                      .slice(0, 6)
                      .map((b) => `${b.order_code} (${b.minutes_waiting}m)`)
                      .join(' · ')}
                    {slaBreaches.length > 6 ? ' …' : ''} — dispatch a driver or refund from the
                    Dispatch &amp; Escrow tabs.
                  </p>
                </div>
              )}

              {/* 5 Live KPI Cards */}
              {isLoading ? (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  {[1, 2, 3, 4, 5].map((i) => (
                    <div
                      key={i}
                      className="dd-shimmer h-28 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)]"
                    />
                  ))}
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  <button
                    type="button"
                    onClick={() => setActiveSection('upi_queue')}
                    className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 text-left hover:border-[var(--ps-accent)] transition-colors cursor-pointer"
                  >
                    <div className="flex items-center justify-between text-[11px] font-bold text-[var(--ps-text-muted)]">
                      <span>Pending UPI</span>
                      <CreditCard className="h-4 w-4 text-[var(--ps-accent)]" />
                    </div>
                    <div className="mt-2 font-mono text-2xl font-extrabold text-[var(--ps-text)]">
                      {kpis.pendingUpiCount}
                    </div>
                    <div className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--ps-accent)]">
                      <span>Open queue</span>
                      <ArrowRight className="h-3 w-3" />
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveSection('upi_queue')}
                    className={`rounded-2xl border p-4 text-left transition-colors cursor-pointer ${
                      kpis.overdueSlaCount > 0
                        ? 'border-rose-500/45 bg-rose-500/8'
                        : 'border-[var(--ps-border)] bg-[var(--ps-surface)] hover:border-[var(--ps-accent)]'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[11px] font-bold text-[var(--ps-text-muted)]">
                      <span>Overdue &gt;10m SLA</span>
                      <Clock
                        className={`h-4 w-4 ${
                          kpis.overdueSlaCount > 0
                            ? 'text-rose-600 dark:text-rose-400'
                            : 'text-emerald-600'
                        }`}
                      />
                    </div>
                    <div
                      className={`mt-2 font-mono text-2xl font-extrabold ${
                        kpis.overdueSlaCount > 0
                          ? 'text-rose-600 dark:text-rose-400'
                          : 'text-[var(--ps-text)]'
                      }`}
                    >
                      {kpis.overdueSlaCount}
                    </div>
                    <div className="mt-1 text-[11px] text-[var(--ps-text-muted)]">
                      {kpis.overdueSlaCount > 0
                        ? 'Immediate attention needed'
                        : 'Within 10-min SLA'}
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveSection('live_dispatch')}
                    className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 text-left hover:border-[var(--ps-accent)] transition-colors cursor-pointer"
                  >
                    <div className="flex items-center justify-between text-[11px] font-bold text-[var(--ps-text-muted)]">
                      <span>Active Escrows</span>
                      <ShieldCheck className="h-4 w-4 text-emerald-600" />
                    </div>
                    <div className="mt-2 font-mono text-2xl font-extrabold text-[var(--ps-text)]">
                      {kpis.activeFundedEscrowsCount}
                    </div>
                    <div className="mt-1 font-mono text-[11px] text-[var(--ps-text-muted)]">
                      ₹
                      {kpis.activeFundedEscrowsValueInr.toLocaleString('en-IN')}{' '}
                      held
                    </div>
                  </button>

                  <button
                    type="button"
                    onClick={() => setActiveSection('escrow_payouts')}
                    className={`rounded-2xl border p-4 text-left transition-colors cursor-pointer ${
                      kpis.openDisputesCount > 0
                        ? 'border-amber-500/45 bg-amber-500/8'
                        : 'border-[var(--ps-border)] bg-[var(--ps-surface)] hover:border-[var(--ps-accent)]'
                    }`}
                  >
                    <div className="flex items-center justify-between text-[11px] font-bold text-[var(--ps-text-muted)]">
                      <span>Open Disputes</span>
                      <ShieldAlert className="h-4 w-4 text-amber-600" />
                    </div>
                    <div className="mt-2 font-mono text-2xl font-extrabold text-[var(--ps-text)]">
                      {kpis.openDisputesCount}
                    </div>
                    <div className="mt-1 inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--ps-text-muted)]">
                      <span>Inspect POD &amp; resolve</span>
                      <ArrowRight className="h-3 w-3" />
                    </div>
                  </button>

                  <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4">
                    <div className="flex items-center justify-between text-[11px] font-bold text-[var(--ps-text-muted)]">
                      <span>Released Today</span>
                      <IndianRupee className="h-4 w-4 text-emerald-600" />
                    </div>
                    <div className="mt-2 font-mono text-2xl font-extrabold text-emerald-700 dark:text-emerald-400">
                      ₹{kpis.releasedTodayInr.toLocaleString('en-IN')}
                    </div>
                    <div className="mt-1 text-[11px] text-[var(--ps-text-muted)]">
                      {kpis.releasedTodayCount} settlement
                      {kpis.releasedTodayCount === 1 ? '' : 's'}
                    </div>
                  </div>
                </div>
              )}

              {/* Quick-Jump Operational Action Cards */}
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 flex flex-col justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-xs font-bold text-[var(--ps-text)]">
                      <AlertTriangle className="h-4 w-4 text-amber-600" />
                      <span>Priority UPI Queue</span>
                    </div>
                    <p className="mt-1 text-xs text-[var(--ps-text-muted)]">
                      {kpis.pendingUpiCount} manual UPI proof
                      {kpis.pendingUpiCount === 1 ? '' : 's'} waiting for
                      verification ({kpis.overdueSlaCount} past 10-minute SLA).
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveSection('upi_queue')}
                    className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-4 text-xs font-bold text-[var(--ps-accent-fg)] hover:opacity-95 cursor-pointer"
                  >
                    <span>Review UPI Queue</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 flex flex-col justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-xs font-bold text-[var(--ps-text)]">
                      <Truck className="h-4 w-4 text-[var(--ps-accent)]" />
                      <span>Unassigned Funded Jobs</span>
                    </div>
                    <p className="mt-1 text-xs text-[var(--ps-text-muted)]">
                      {dispatchQueue.filter((d) => !d.driverId).length} funded
                      booking
                      {dispatchQueue.filter((d) => !d.driverId).length === 1
                        ? ''
                        : 's'}{' '}
                      ready for KYC-verified driver assignment.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveSection('live_dispatch')}
                    className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-4 text-xs font-bold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] cursor-pointer"
                  >
                    <span>Open Live Dispatch</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>

                <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 flex flex-col justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2 text-xs font-bold text-[var(--ps-text)]">
                      <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                      <span>Escrow Settlements &amp; PODs</span>
                    </div>
                    <p className="mt-1 text-xs text-[var(--ps-text-muted)]">
                      {
                        escrowQueue.filter(
                          (e) => e.status === 'delivered_pending_confirm'
                        ).length
                      }{' '}
                      verified handover
                      {escrowQueue.filter(
                        (e) => e.status === 'delivered_pending_confirm'
                      ).length === 1
                        ? ''
                        : 's'}{' '}
                      ready for driver payout release.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setActiveSection('escrow_payouts')}
                    className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-4 text-xs font-bold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] cursor-pointer"
                  >
                    <span>Settle Escrows</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* SECTION 2: UPI VERIFICATION QUEUE */}
          {activeSection === 'upi_queue' && (
            <MediatorVerificationQueue
              items={paymentQueue}
              isLoading={isLoading}
              nowMs={nowMs}
              busyId={busyId}
              onRefresh={() => void loadMediatorData()}
              onVerifyPayment={handleVerifyPayment}
              onRejectPayment={handleRejectPayment}
            />
          )}

          {/* SECTION 3: LIVE DISPATCH & FLEET ASSIGNMENT */}
          {activeSection === 'live_dispatch' && (
            <MediatorLiveDispatchPanel
              items={dispatchQueue}
              drivers={drivers}
              isLoading={isLoading}
              busyId={busyId}
              onRefresh={() => void loadMediatorData()}
              onDispatchDriver={handleDispatchDriver}
            />
          )}

          {/* SECTION 4: ESCROW PAYOUTS, POD AUDIT & DISPUTES */}
          {activeSection === 'escrow_payouts' && (
            <MediatorEscrowPayoutsPanel
              items={escrowQueue}
              isLoading={isLoading}
              nowMs={nowMs}
              busyId={busyId}
              onRefresh={() => void loadMediatorData()}
              onResolveEscrow={handleResolveEscrow}
            />
          )}

          {/* SECTION 5: AUDIT HISTORY */}
          {activeSection === 'audit_history' && (
            <MediatorAuditHistory
              logs={auditLogs}
              isLoading={isLoading}
              onRefresh={() => void loadMediatorData()}
            />
          )}
        </div>
      </WorkspaceNavShell>
    </div>
  );
}

export default MediatorWorkspace;
