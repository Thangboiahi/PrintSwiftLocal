'use client';

import { submitPickNDropUtr } from '@/lib/payments/submit-pnd-utr';
import React, { useCallback, useEffect, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  ArrowLeftRight,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Eye,
  KeyRound,
  Loader2,
  MapPin,
  MessageCircle,
  Package,
  Phone,
  RefreshCw,
  ShieldCheck,
  Truck,
  Upload,
  WifiOff,
  X,
} from 'lucide-react';
import { useAuth } from '@/lib/store';
import { setAppStatus } from '@/lib/hooks/useAppStatus';
import {
  formatOfflineSyncTime,
  loadCustomerActiveOtpsCache,
  syncCustomerActiveOtpsCache,
  type OfflineCustomerOtpItem,
} from '@/lib/offline/pwa-store';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { getSignedPodUrl } from '@/lib/supabase/storage';
import { mapDuplicateUtrError } from '@/lib/mediator/types';
import { FormModal } from '@/components/ui/FormModal';
import {
  CONTAINER_LABELS,
  DELIVERY_STATUS_META,
  ORDER_PROGRESS_STEPS,
  SERVICE_MODE_META,
  buildDropoffOtpWhatsAppUrl,
  getOrderProgressIndex,
  type DeliveryOrderRecord,
  type DeliveryOrderSecretRecord,
  type DeliveryOrderStatus,
  type DeliveryTransactionRecord,
  type DriverRecord,
  type VehicleRecord,
  type VehicleTypeItem,
} from '@/lib/pick-n-drop/types';

export interface OrderTrackerModalProps {
  mode?: 'modal' | 'embedded';
  isOpen?: boolean;
  initialOrderId?: string | null;
  onClose?: () => void;
  onStartNewDelivery?: () => void;
}

export function OrderTrackerModal({
  mode = 'modal',
  isOpen = true,
  initialOrderId = null,
  onClose,
  onStartNewDelivery,
}: OrderTrackerModalProps) {
  const { user: authUser } = useAuth();
  const authUserId = authUser?.id || null;
  const [orders, setOrders] = useState<DeliveryOrderRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  // v21a (P0-26): customer post-UPI cancellation / refund request
  const [cancelTarget, setCancelTarget] = useState<DeliveryOrderRecord | null>(null);
  const [cancelReason, setCancelReason] = useState('');
  const [cancelTouched, setCancelTouched] = useState(false);
  const [cancelSubmitAttempted, setCancelSubmitAttempted] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [cancelNotice, setCancelNotice] = useState<string | null>(null);
  const cancelReasonError =
    cancelReason.trim().length < 5
      ? 'Tell the Dispatch Mediator why (at least 5 characters).'
      : null;
  const [expandedOrderId, setExpandedOrderId] = useState<string | null>(
    initialOrderId
  );
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  // Inline UPI UTR submission state for orders still in awaiting_payment
  const [utrDrafts, setUtrDrafts] = useState<Record<string, string>>({});
  const [proofFiles, setProofFiles] = useState<Record<string, File | null>>({});
  const [submittingUtrOrderId, setSubmittingUtrOrderId] = useState<
    string | null
  >(null);

  // Temporary 5-minute signed URL previews for private POD photos
  const [podSignedUrls, setPodSignedUrls] = useState<Record<string, string>>(
    {}
  );
  const [loadingPodOrderId, setLoadingPodOrderId] = useState<string | null>(
    null
  );
  const [offlineSyncedAt, setOfflineSyncedAt] = useState<string | null>(null);
  const [isOfflineFallback, setIsOfflineFallback] = useState<boolean>(false);

  const loadCustomerOrders = useCallback(async () => {
    if (!authUserId) {
      setOrders([]);
      setIsLoading(false);
      return;
    }

    const hydrateFromOfflineOtpCache = async (): Promise<boolean> => {
      const cached = await loadCustomerActiveOtpsCache(authUserId);
      const pndItems = (cached?.items || []).filter(
        (item) => item.kind === 'pick_n_drop'
      );
      if (pndItems.length === 0) return false;

      const offlineRecords: DeliveryOrderRecord[] = pndItems.map((item) => ({
        id: item.id,
        order_code: item.code,
        customer_id: authUserId,
        mediator_id: null,
        driver_id: null,
        vehicle_id: null,
        vehicle_type_id: '',
        service_mode: 'parcel',
        trip_type: item.returnOtp ? 'two_way' : 'one_way',
        container_type: null,
        prohibited_items_waiver: true,
        status: (item.status || 'in_transit') as DeliveryOrderStatus,
        pickup_address: item.pickupLabel || 'Pickup Point',
        pickup_landmark: null,
        dropoff_address: item.dropoffLabel || 'Dropoff Point',
        dropoff_landmark: null,
        recipient_name: null,
        recipient_phone: null,
        sender_phone: '',
        distance_km: 0,
        quoted_fare_inr: 0,
        quote_expires_at: item.updatedAt,
        declared_value_inr: 0,
        pod_storage_path: null,
        pod_uploaded_at: null,
        pod_purge_at: null,
        created_at: item.updatedAt,
        updated_at: item.updatedAt,
        secrets: {
          order_id: item.id,
          pickup_otp: item.pickupOtp || '',
          dropoff_otp: item.dropoffOtp || '',
          return_otp: item.returnOtp || null,
          failed_attempts: 0,
          locked_until: null,
        },
        transactions: [],
      }));

      setOrders(offlineRecords);
      setOfflineSyncedAt(cached?.syncedAt || null);
      setIsOfflineFallback(true);
      setExpandedOrderId((prev) => prev || offlineRecords[0]?.id || null);
      return true;
    };

    if (typeof window !== 'undefined' && window.navigator.onLine === false) {
      setIsLoading(true);
      setErrorMsg(null);
      await hydrateFromOfflineOtpCache();
      setIsLoading(false);
      return;
    }

    if (!isSupabaseConfigured()) {
      setOrders([]);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    setErrorMsg(null);
    try {
      const { data: orderRows, error: orderErr } = await supabase
        .from('delivery_orders')
        .select('*')
        .eq('customer_id', authUserId)
        .order('created_at', { ascending: false })
        .limit(25);

      if (orderErr) {
        throw new Error(orderErr.message);
      }

      const rawOrders = (orderRows || []) as DeliveryOrderRecord[];
      if (rawOrders.length === 0) {
        setOrders([]);
        setIsOfflineFallback(false);
        void syncCustomerActiveOtpsCache(authUserId, [], 'pick_n_drop');
        setIsLoading(false);
        return;
      }

      const orderIds = rawOrders.map((o) => o.id);
      const vehicleTypeIds = Array.from(
        new Set(rawOrders.map((o) => o.vehicle_type_id).filter(Boolean))
      );
      const driverIds = Array.from(
        new Set(
          rawOrders
            .map((o) => o.driver_id)
            .filter((v): v is string => Boolean(v))
        )
      );
      const vehicleIds = Array.from(
        new Set(
          rawOrders
            .map((o) => o.vehicle_id)
            .filter((v): v is string => Boolean(v))
        )
      );

      const [secretsRes, txRes, vTypesRes, driversRes, vehiclesRes] =
        await Promise.all([
          supabase
            .from('delivery_order_secrets')
            .select(
              'order_id, pickup_otp, dropoff_otp, return_otp, failed_attempts, locked_until'
            )
            .in('order_id', orderIds),
          supabase
            .from('delivery_transactions')
            .select('*')
            .in('order_id', orderIds)
            .order('created_at', { ascending: false }),
          vehicleTypeIds.length > 0
            ? supabase
                .from('vehicle_types')
                .select('*')
                .in('id', vehicleTypeIds)
            : Promise.resolve({ data: [] }),
          driverIds.length > 0
            ? supabase.from('drivers').select('*').in('id', driverIds)
            : Promise.resolve({ data: [] }),
          vehicleIds.length > 0
            ? supabase.from('vehicles').select('*').in('id', vehicleIds)
            : Promise.resolve({ data: [] }),
        ]);

      const secretsMap = new Map<string, DeliveryOrderSecretRecord>();
      for (const row of (secretsRes.data || []) as DeliveryOrderSecretRecord[]) {
        secretsMap.set(row.order_id, row);
      }

      const txMap = new Map<string, DeliveryTransactionRecord[]>();
      for (const tx of (txRes.data || []) as DeliveryTransactionRecord[]) {
        const list = txMap.get(tx.order_id) || [];
        list.push(tx);
        txMap.set(tx.order_id, list);
      }

      const vTypeMap = new Map<string, VehicleTypeItem>();
      for (const vt of (vTypesRes.data || []) as VehicleTypeItem[]) {
        vTypeMap.set(vt.id, vt);
      }

      const driverMap = new Map<string, DriverRecord>();
      for (const dr of (driversRes.data || []) as DriverRecord[]) {
        driverMap.set(dr.id, dr);
      }

      const vehicleMap = new Map<string, VehicleRecord>();
      for (const vh of (vehiclesRes.data || []) as VehicleRecord[]) {
        vehicleMap.set(vh.id, vh);
      }

      const hydrated: DeliveryOrderRecord[] = rawOrders.map((order) => ({
        ...order,
        distance_km: Number(order.distance_km),
        quoted_fare_inr: Number(order.quoted_fare_inr),
        declared_value_inr: Number(order.declared_value_inr || 0),
        vehicle_type: vTypeMap.get(order.vehicle_type_id) || null,
        driver: order.driver_id ? driverMap.get(order.driver_id) || null : null,
        vehicle: order.vehicle_id
          ? vehicleMap.get(order.vehicle_id) || null
          : null,
        secrets: secretsMap.get(order.id) || null,
        transactions: txMap.get(order.id) || [],
      }));

      setOrders(hydrated);
      setIsOfflineFallback(false);
      setExpandedOrderId((prev) =>
        prev && hydrated.some((o) => o.id === prev)
          ? prev
          : initialOrderId && hydrated.some((o) => o.id === initialOrderId)
            ? initialOrderId
            : hydrated[0]?.id || null
      );

      // Sync ONLY active customer-owned OTPs to IndexedDB (completed/cancelled orders are purged automatically)
      const otpItems: OfflineCustomerOtpItem[] = hydrated
        .filter((o) => Boolean(o.secrets))
        .map((o) => ({
          id: o.id,
          kind: 'pick_n_drop',
          code: o.order_code,
          title: `${o.pickup_address} → ${o.dropoff_address}`,
          status: o.status,
          pickupLabel: o.pickup_address,
          dropoffLabel: o.dropoff_address,
          pickupOtp: o.secrets?.pickup_otp || null,
          dropoffOtp: o.secrets?.dropoff_otp || null,
          returnOtp: o.secrets?.return_otp || null,
          startOtp: null,
          endOtp: null,
          updatedAt: o.updated_at || o.created_at,
        }));
      const syncedIso = await syncCustomerActiveOtpsCache(
        authUserId,
        otpItems,
        'pick_n_drop'
      );
      if (syncedIso) {
        setOfflineSyncedAt(syncedIso);
      }
    } catch (err) {
      const hitOffline = await hydrateFromOfflineOtpCache();
      if (!hitOffline) {
        setErrorMsg(
          err instanceof Error ? err.message : 'Unable to load your deliveries.'
        );
      }
    } finally {
      setIsLoading(false);
    }
  }, [authUserId, initialOrderId]);

  useEffect(() => {
    if (mode === 'modal' && !isOpen) return;
    let active = true;
    queueMicrotask(() => {
      if (active) {
        void loadCustomerOrders();
      }
    });
    return () => {
      active = false;
    };
  }, [mode, isOpen, loadCustomerOrders]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleRefresh = () => {
      void loadCustomerOrders();
    };
    window.addEventListener('printswift:pnd-orders-updated', handleRefresh);
    return () => {
      window.removeEventListener(
        'printswift:pnd-orders-updated',
        handleRefresh
      );
    };
  }, [loadCustomerOrders]);

  const handleCopyText = (key: string, text: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(text);
    }
    setCopiedKey(key);
    setTimeout(() => {
      setCopiedKey((prev) => (prev === key ? null : prev));
    }, 1800);
  };

  const handleSubmitUtrForOrder = async (order: DeliveryOrderRecord) => {
    const cleanUtr = (utrDrafts[order.id] || '').trim().toUpperCase();
    if (cleanUtr.length < 10) {
      setErrorMsg('Please enter a valid 12-digit UPI UTR reference number.');
      return;
    }

    setSubmittingUtrOrderId(order.id);
    setErrorMsg(null);
    setAppStatus('saving', 'Submitting UTR');

    try {
      // v21a (P0-13): canonical intent → private receipt → /api/payments/submit-utr path
      await submitPickNDropUtr({
        orderId: order.id,
        utr: cleanUtr,
        proofFile: proofFiles[order.id] || null,
      });

      setAppStatus('success', 'UTR submitted');
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('printswift:pnd-orders-updated'));
      }
      await loadCustomerOrders();
    } catch (err) {
      setErrorMsg(
        mapDuplicateUtrError(
          err instanceof Error ? err.message : 'Failed to submit UPI payment.'
        )
      );
      setAppStatus('error', 'UTR failed');
    } finally {
      setSubmittingUtrOrderId(null);
    }
  };

  const openCancelRequest = (order: DeliveryOrderRecord) => {
    setCancelTarget(order);
    setCancelReason('');
    setCancelTouched(false);
    setCancelSubmitAttempted(false);
    setCancelNotice(null);
  };

  const handleConfirmCancelRequest = async () => {
    if (!cancelTarget) return;
    setCancelSubmitAttempted(true);
    if (cancelReasonError) return;
    setIsCancelling(true);
    setErrorMsg(null);
    try {
      const { data, error } = await supabase.rpc('customer_request_cancellation', {
        p_booking_id: cancelTarget.id,
        p_reason: cancelReason.trim(),
      });
      if (error) throw new Error(error.message);
      const result = (data || {}) as { refund_requested?: boolean };
      setCancelNotice(
        result.refund_requested
          ? `Refund request for ${cancelTarget.order_code} sent to the Dispatch Mediator.`
          : `${cancelTarget.order_code} was cancelled.`
      );
      setCancelTarget(null);
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new CustomEvent('printswift:pnd-orders-updated'));
      }
      await loadCustomerOrders();
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Could not submit your cancellation request.'
      );
    } finally {
      setIsCancelling(false);
    }
  };

  const handleViewPodPhoto = async (order: DeliveryOrderRecord) => {
    if (!order.pod_storage_path) return;
    setLoadingPodOrderId(order.id);
    try {
      const signed = await getSignedPodUrl(order.pod_storage_path, 300);
      setPodSignedUrls((prev) => ({ ...prev, [order.id]: signed }));
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Could not load signed POD photo.'
      );
    } finally {
      setLoadingPodOrderId(null);
    }
  };

  const renderTrackerBody = () => (
    <div className="space-y-3">
      {errorMsg && (
        <div className="flex items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
          <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">{errorMsg}</span>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="rounded p-0.5 hover:bg-black/5"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {isOfflineFallback && (
        <div
          data-testid="pnd-offline-otp-banner"
          className="flex items-center gap-2 rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-900 dark:text-amber-200"
        >
          <WifiOff className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1">
            Offline mode — Showing your cached active handover OTPs
            {offlineSyncedAt
              ? ` (Last synced ${formatOfflineSyncTime(offlineSyncedAt)})`
              : ''}
            .
          </span>
        </div>
      )}

      {!authUser?.id ? (
        <div className="rounded-xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-bg)] p-6 text-center">
          <Package className="mx-auto h-6 w-6 text-[var(--ps-text-muted)] opacity-60" />
          <p className="mt-2 text-xs font-semibold text-[var(--ps-text)]">
            Sign in to track your Pick N Drop deliveries
          </p>
          <p className="mt-1 text-[11px] text-[var(--ps-text-muted)]">
            Your asymmetric Pickup, Dropoff, and Return OTPs are protected by account-level Row Level Security.
          </p>
        </div>
      ) : isLoading ? (
        <div className="space-y-2.5 py-2" aria-label="Loading orders">
          <div className="h-16 rounded-xl dd-shimmer border border-[var(--ps-border)]" />
          <div className="h-24 rounded-xl dd-shimmer border border-[var(--ps-border)]" />
        </div>
      ) : orders.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-bg)] p-6 text-center">
          <Truck className="mx-auto h-6 w-6 text-[var(--ps-text-muted)] opacity-60" />
          <p className="mt-2 text-xs font-semibold text-[var(--ps-text)]">
            No Pick N Drop orders yet
          </p>
          <p className="mt-1 text-[11px] text-[var(--ps-text-muted)]">
            Open the Explore Map and tap the Pick N Drop icon to book a local parcel delivery with prepaid UPI escrow.
          </p>
          {onStartNewDelivery && (
            <button
              type="button"
              onClick={onStartNewDelivery}
              className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-lg bg-[var(--ps-accent)] px-3 text-xs font-semibold text-[var(--ps-accent-fg)]"
            >
              <Package className="h-3.5 w-3.5" />
              Book a Pick N Drop
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {orders.map((order) => {
            const isExpanded = expandedOrderId === order.id;
            const statusMeta =
              DELIVERY_STATUS_META[order.status] ||
              DELIVERY_STATUS_META.awaiting_payment;
            const progressIdx = getOrderProgressIndex(order.status);
            const latestUpiTx = order.transactions?.find(
              (t) => t.tx_type === 'upi_payment'
            );
            const signedPodUrl = podSignedUrls[order.id];

            return (
              <div
                key={order.id}
                data-testid={`pnd-order-card-${order.order_code}`}
                className="overflow-hidden rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] transition"
              >
                {/* Compact Order Summary Header */}
                <button
                  type="button"
                  onClick={() =>
                    setExpandedOrderId(isExpanded ? null : order.id)
                  }
                  className="flex w-full flex-wrap items-center justify-between gap-2 px-3.5 py-2.5 text-left hover:bg-[var(--ps-surface-alt)]/60 transition-colors"
                >
                  <div className="min-w-0 flex-1 space-y-0.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-mono text-xs font-bold text-[var(--ps-text)]">
                        {order.order_code}
                      </span>
                      <span
                        className={`inline-flex items-center rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${statusMeta.badgeClass}`}
                      >
                        {statusMeta.label}
                      </span>
                      {order.service_mode && (
                        <span className="inline-flex items-center rounded-md border border-[var(--ps-border)] bg-[var(--ps-surface)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--ps-text)]">
                          {SERVICE_MODE_META[order.service_mode]?.shortLabel ||
                            order.service_mode}
                        </span>
                      )}
                      {order.trip_type === 'two_way' && (
                        <span className="inline-flex items-center gap-0.5 rounded-md border border-cyan-500/30 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-semibold text-cyan-700 dark:text-cyan-300">
                          <ArrowLeftRight className="h-2.5 w-2.5" />
                          Two-Way
                        </span>
                      )}
                    </div>
                    <div className="truncate text-[11px] text-[var(--ps-text-muted)]">
                      {order.pickup_address} → {order.dropoff_address}
                    </div>
                  </div>

                  <div className="flex items-center gap-2 shrink-0">
                    <div className="text-right">
                      <div className="text-xs font-bold tabular-nums text-[var(--ps-text)]">
                        ₹{order.quoted_fare_inr.toFixed(0)}
                      </div>
                      <div className="text-[10px] text-[var(--ps-text-muted)]">
                        {order.distance_km} km
                      </div>
                    </div>
                  </div>
                </button>

                {/* Expanded Order Details */}
                {isExpanded && (
                  <div className="space-y-3 border-t border-[var(--ps-border)] bg-[var(--ps-surface)] p-3.5">
                    {/* 6-Step Progress Bar */}
                    {order.status !== 'cancelled' &&
                      order.status !== 'disputed' && (
                        <div className="space-y-1.5">
                          <div className="grid grid-cols-6 gap-1">
                            {ORDER_PROGRESS_STEPS.map((step, idx) => {
                              const done = progressIdx >= idx;
                              const current = progressIdx === idx;
                              return (
                                <div
                                  key={step.key}
                                  className="flex flex-col items-center gap-1 text-center"
                                >
                                  <div
                                    className={`h-1.5 w-full rounded-full transition-colors ${
                                      done
                                        ? 'bg-emerald-500'
                                        : 'bg-[var(--ps-border)]'
                                    }`}
                                  />
                                  <span
                                    className={`text-[9px] leading-tight ${
                                      current
                                        ? 'font-bold text-[var(--ps-text)]'
                                        : done
                                          ? 'font-semibold text-emerald-600 dark:text-emerald-400'
                                          : 'text-[var(--ps-text-muted)]'
                                    }`}
                                  >
                                    {step.shortLabel}
                                  </span>
                                </div>
                              );
                            })}
                          </div>
                          {order.status === 'return_in_transit' && (
                            <div className="rounded-lg border border-cyan-500/30 bg-cyan-500/10 px-2.5 py-1 text-[11px] font-medium text-cyan-800 dark:text-cyan-200">
                              Dropoff verified! Driver is now returning to pickup point — keep your Return OTP ready.
                            </div>
                          )}
                        </div>
                      )}

                    {order.status === 'payment_submitted' &&
                      (order.dispute_reason || '').startsWith('Customer cancellation requested') && (
                        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-800 dark:text-amber-200">
                          Cancellation requested — the Dispatch Mediator will verify your payment and process the refund.
                        </div>
                      )}
                    {!['completed', 'cancelled', 'disputed'].includes(order.status) &&
                      !(
                        order.status === 'payment_submitted' &&
                        (order.dispute_reason || '').startsWith('Customer cancellation requested')
                      ) && (
                      <button
                        type="button"
                        onClick={() => openCancelRequest(order)}
                        className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-rose-500/35 bg-rose-500/10 px-3 text-[11px] font-semibold text-rose-700 dark:text-rose-300 cursor-pointer"
                      >
                        {order.status === 'awaiting_payment'
                          ? 'Cancel Order'
                          : 'Cancel & Request Refund'}
                      </button>
                    )}
                    {order.status === 'disputed' && (
                      <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 py-1 text-[11px] font-medium text-amber-800 dark:text-amber-200">
                        Under Dispatch Mediator review — escrow is frozen until resolved.
                      </div>
                    )}

                    {/* Inline Manual UPI UTR Submission if still awaiting_payment */}
                    {order.status === 'awaiting_payment' && (
                      <div className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/5 p-3">
                        <div className="flex items-center justify-between gap-2 text-xs font-bold text-amber-800 dark:text-amber-300">
                          <span>Complete Prepaid UPI Escrow</span>
                          <span className="font-mono">
                            ₹{order.quoted_fare_inr.toFixed(2)}
                          </span>
                        </div>
                        <p className="text-[11px] text-[var(--ps-text-muted)]">
                          Pay via UPI to DD oodle Escrow and enter your 12-digit UTR reference below so our mediator can hold escrow and assign a driver.
                        </p>
                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <input
                            type="text"
                            value={utrDrafts[order.id] || ''}
                            onChange={(e) =>
                              setUtrDrafts((prev) => ({
                                ...prev,
                                [order.id]: e.target.value,
                              }))
                            }
                            placeholder="12-digit UPI UTR Ref"
                            className="h-8 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-xs text-[var(--ps-text)]"
                          />
                          <label className="flex h-8 cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-dashed border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-[11px] font-medium text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]">
                            <Upload className="h-3.5 w-3.5 shrink-0" />
                            <span className="truncate">
                              {proofFiles[order.id]?.name ||
                                'Optional screenshot'}
                            </span>
                            <input
                              type="file"
                              accept="image/jpeg,image/png,image/webp"
                              className="hidden"
                              onChange={(e) =>
                                setProofFiles((prev) => ({
                                  ...prev,
                                  [order.id]: e.target.files?.[0] || null,
                                }))
                              }
                            />
                          </label>
                        </div>
                        <button
                          type="button"
                          disabled={submittingUtrOrderId === order.id}
                          onClick={() => void handleSubmitUtrForOrder(order)}
                          className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-[var(--ps-accent)] px-3 text-xs font-semibold text-[var(--ps-accent-fg)] disabled:opacity-60"
                        >
                          {submittingUtrOrderId === order.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <ShieldCheck className="h-3.5 w-3.5" />
                          )}
                          Submit UPI Reference
                        </button>
                      </div>
                    )}

                    {/* ASYMMETRIC OTP VAULT (Sender-Only via RLS) */}
                    {order.secrets && (
                      <div className="space-y-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3">
                        <div className="flex items-center justify-between">
                          <span className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-[var(--ps-text)]">
                            <KeyRound className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
                            Asymmetric Handover OTPs
                          </span>
                          <span className="text-[10px] text-[var(--ps-text-muted)]">
                            Drivers cannot see these codes
                          </span>
                        </div>

                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          {/* Pickup OTP */}
                          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-2.5">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                                Pickup OTP (Sender)
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  handleCopyText(
                                    `${order.id}-pickup`,
                                    order.secrets!.pickup_otp
                                  )
                                }
                                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 hover:bg-emerald-500/15 dark:text-emerald-300"
                              >
                                {copiedKey === `${order.id}-pickup` ? (
                                  <Check className="h-3 w-3" />
                                ) : (
                                  <Copy className="h-3 w-3" />
                                )}
                                Copy
                              </button>
                            </div>
                            <div
                              data-testid={`pickup-otp-${order.order_code}`}
                              className="mt-1 font-mono text-lg font-extrabold tracking-[0.2em] text-[var(--ps-text)]"
                            >
                              {order.secrets.pickup_otp}
                            </div>
                            <p className="mt-0.5 text-[10px] text-[var(--ps-text-muted)]">
                              Give to driver only when handing over parcel.
                            </p>
                          </div>

                          {/* Dropoff OTP + One-Tap WhatsApp Share */}
                          <div className="rounded-lg border border-indigo-500/30 bg-indigo-500/5 p-2.5">
                            <div className="flex items-center justify-between">
                              <span className="text-[10px] font-bold uppercase tracking-wider text-indigo-700 dark:text-indigo-300">
                                Dropoff OTP (Recipient)
                              </span>
                              <button
                                type="button"
                                onClick={() =>
                                  handleCopyText(
                                    `${order.id}-dropoff`,
                                    order.secrets!.dropoff_otp
                                  )
                                }
                                className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-semibold text-indigo-700 hover:bg-indigo-500/15 dark:text-indigo-300"
                              >
                                {copiedKey === `${order.id}-dropoff` ? (
                                  <Check className="h-3 w-3" />
                                ) : (
                                  <Copy className="h-3 w-3" />
                                )}
                                Copy
                              </button>
                            </div>
                            <div
                              data-testid={`dropoff-otp-${order.order_code}`}
                              className="mt-1 font-mono text-lg font-extrabold tracking-[0.2em] text-[var(--ps-text)]"
                            >
                              {order.secrets.dropoff_otp}
                            </div>
                            <a
                              href={buildDropoffOtpWhatsAppUrl({
                                recipientPhone:
                                  order.recipient_phone || order.sender_phone,
                                recipientName: order.recipient_name || 'Rider',
                                orderCode: order.order_code,
                                dropoffOtp: order.secrets.dropoff_otp,
                              })}
                              target="_blank"
                              rel="noopener noreferrer"
                              data-testid={`share-dropoff-whatsapp-${order.order_code}`}
                              className="mt-1.5 inline-flex h-7 w-full items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-2.5 text-[11px] font-semibold text-white hover:bg-emerald-700 transition-colors"
                            >
                              <MessageCircle className="h-3.5 w-3.5" />
                              Share Dropoff OTP via WhatsApp
                            </a>
                          </div>
                        </div>

                        {/* Return OTP (only for two_way trips) */}
                        {order.trip_type === 'two_way' &&
                          order.secrets.return_otp && (
                            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-cyan-500/30 bg-cyan-500/5 px-2.5 py-2">
                              <div>
                                <div className="text-[10px] font-bold uppercase tracking-wider text-cyan-700 dark:text-cyan-300">
                                  Return Handover OTP (Two-Way)
                                </div>
                                <p className="text-[10px] text-[var(--ps-text-muted)]">
                                  Share with driver when return item arrives back at pickup.
                                </p>
                              </div>
                              <div className="flex items-center gap-2">
                                <span className="font-mono text-base font-extrabold tracking-[0.18em] text-[var(--ps-text)]">
                                  {order.secrets.return_otp}
                                </span>
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleCopyText(
                                      `${order.id}-return`,
                                      order.secrets!.return_otp!
                                    )
                                  }
                                  className="inline-flex h-7 items-center gap-1 rounded-md border border-cyan-500/30 px-2 text-[10px] font-semibold text-cyan-700 dark:text-cyan-300"
                                >
                                  {copiedKey === `${order.id}-return` ? (
                                    <Check className="h-3 w-3" />
                                  ) : (
                                    <Copy className="h-3 w-3" />
                                  )}
                                  Copy
                                </button>
                              </div>
                            </div>
                          )}
                      </div>
                    )}

                    {/* Route, Cargo, Driver & Payment Metadata */}
                    <div className="grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-2">
                      <div className="rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] p-2.5 space-y-1">
                        <div className="flex items-start gap-1.5">
                          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600" />
                          <div className="min-w-0">
                            <span className="font-semibold text-[var(--ps-text)]">
                              Pickup:{' '}
                            </span>
                            <span className="text-[var(--ps-text-muted)]">
                              {order.pickup_address}
                              {order.pickup_landmark
                                ? ` (${order.pickup_landmark})`
                                : ''}
                            </span>
                          </div>
                        </div>
                        <div className="flex items-start gap-1.5">
                          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-600" />
                          <div className="min-w-0">
                            <span className="font-semibold text-[var(--ps-text)]">
                              Dropoff:{' '}
                            </span>
                            <span className="text-[var(--ps-text-muted)]">
                              {order.dropoff_address}
                              {order.dropoff_landmark
                                ? ` (${order.dropoff_landmark})`
                                : ''}
                            </span>
                          </div>
                        </div>
                        <div className="pt-1 text-[10px] text-[var(--ps-text-muted)]">
                          {order.service_mode === 'passenger' ? (
                            <>
                              Passengers:{' '}
                              <strong>{order.passenger_count || 1}</strong>
                              {order.recipient_name
                                ? ` • Rider: ${order.recipient_name}`
                                : ''}
                            </>
                          ) : order.service_mode === 'gas' ? (
                            <>
                              LPG Cylinders:{' '}
                              <strong>{order.cylinder_count || 1}</strong> •
                              Phone: {order.sender_phone}
                            </>
                          ) : (
                            <>
                              Recipient:{' '}
                              <strong>{order.recipient_name || 'Self'}</strong>{' '}
                              ({order.recipient_phone || order.sender_phone})
                              {order.container_type
                                ? ` • ${CONTAINER_LABELS[order.container_type]}`
                                : ''}
                            </>
                          )}
                        </div>
                        {order.instructions && (
                          <div className="text-[10px] text-[var(--ps-text-muted)]">
                            Notes: <em>{order.instructions}</em>
                          </div>
                        )}
                      </div>

                      <div className="rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] p-2.5 space-y-1">
                        <div className="font-semibold text-[var(--ps-text)]">
                          {order.vehicle_type?.name || 'Local Vehicle'} • ₹
                          {order.quoted_fare_inr.toFixed(0)}
                        </div>
                        {order.driver ? (
                          <div className="space-y-0.5 text-[var(--ps-text-muted)]">
                            <div>
                              Driver: <strong>{order.driver.full_name}</strong>{' '}
                              {order.vehicle?.plate_number
                                ? `(${order.vehicle.plate_number})`
                                : ''}
                            </div>
                            <a
                              href={`tel:${order.driver.phone}`}
                              className="inline-flex items-center gap-1 text-[var(--ps-accent)] font-semibold hover:underline"
                            >
                              <Phone className="h-3 w-3" />
                              {order.driver.phone}
                            </a>
                          </div>
                        ) : (
                          <div className="text-[var(--ps-text-muted)]">
                            Driver assignment pending escrow confirmation.
                          </div>
                        )}
                        {latestUpiTx?.upi_utr_ref && (
                          <div className="font-mono text-[10px] text-[var(--ps-text-muted)]">
                            UTR: {latestUpiTx.upi_utr_ref}
                          </div>
                        )}
                      </div>
                    </div>

                    {/* Private Proof of Delivery Viewer (5m Signed URL) */}
                    {order.pod_storage_path && (
                      <div className="rounded-lg border border-teal-500/30 bg-teal-500/5 p-2.5 space-y-2">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-teal-800 dark:text-teal-200">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            <span>Proof of Delivery Photo Recorded</span>
                          </div>
                          <button
                            type="button"
                            disabled={loadingPodOrderId === order.id}
                            onClick={() => void handleViewPodPhoto(order)}
                            className="inline-flex h-7 items-center gap-1 rounded-lg border border-teal-500/40 bg-[var(--ps-surface)] px-2.5 text-[11px] font-semibold text-teal-700 hover:bg-teal-500/10 dark:text-teal-300"
                          >
                            {loadingPodOrderId === order.id ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <Eye className="h-3 w-3" />
                            )}
                            {signedPodUrl ? 'Refresh Signed Photo' : 'View POD'}
                          </button>
                        </div>
                        {order.pod_purge_at && (
                          <div className="flex items-center gap-1 text-[10px] text-[var(--ps-text-muted)]">
                            <Clock className="h-3 w-3" />
                            <span>
                              Auto-purges for privacy on{' '}
                              {new Date(order.pod_purge_at).toLocaleString()}
                            </span>
                          </div>
                        )}
                        {signedPodUrl && (
                          <div className="overflow-hidden rounded-lg border border-[var(--ps-border)] bg-black/5">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={signedPodUrl}
                              alt={`Proof of delivery for ${order.order_code}`}
                              className="max-h-56 w-full object-contain"
                            />
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );

  const cancelLayer = (
    <>
    <FormModal
      isOpen={Boolean(cancelTarget)}
      onClose={() => setCancelTarget(null)}
      title={
        cancelTarget?.status === 'awaiting_payment'
          ? `Cancel ${cancelTarget?.order_code ?? 'order'}?`
          : `Cancel & request refund for ${cancelTarget?.order_code ?? 'order'}`
      }
      subtitle={
        cancelTarget?.status === 'awaiting_payment'
          ? 'Nothing has been paid yet, so the order is cancelled immediately.'
          : cancelTarget?.status === 'payment_submitted'
            ? 'Your UPI proof is still being verified. The Dispatch Mediator confirms the payment first, then cancels and refunds it to your original UPI account.'
            : 'Your escrow is frozen and the Dispatch Mediator reviews the refund. Refunds are issued to your original UPI account.'
      }
      isDirty={cancelReason.trim().length > 0}
      isValid={!cancelReasonError}
      validationSummary={
        cancelSubmitAttempted && cancelReasonError ? [cancelReasonError] : undefined
      }
      onSubmitAttempt={() => setCancelSubmitAttempted(true)}
      submitLabel={
        cancelTarget?.status === 'awaiting_payment' ? 'Cancel Order' : 'Send Refund Request'
      }
      confirmSubmitTitle="Submit cancellation?"
      confirmSubmitDescription="This cannot be undone from the app."
      confirmSubmitVariant="danger"
      isSubmitting={isCancelling}
      onSubmit={handleConfirmCancelRequest}
    >
      <div className="space-y-1.5">
        <label
          htmlFor="pnd-cancel-reason"
          className="block text-xs font-bold text-[var(--ps-text)]"
        >
          Reason <span className="text-rose-500">*</span>
        </label>
        <textarea
          id="pnd-cancel-reason"
          rows={3}
          maxLength={500}
          value={cancelReason}
          onChange={(e) => {
            setCancelReason(e.target.value);
            setCancelTouched(true);
          }}
          onBlur={() => setCancelTouched(true)}
          placeholder="e.g. Plans changed / driver not reachable / wrong pickup address"
          className="w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 text-xs text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-accent)]"
        />
        {(cancelTouched || cancelSubmitAttempted) && cancelReasonError && (
          <p className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
            {cancelReasonError}
          </p>
        )}
      </div>
    </FormModal>
    {cancelNotice && (
      <div
        role="status"
        className="fixed bottom-4 left-1/2 z-[97] -translate-x-1/2 rounded-xl border border-emerald-500/30 bg-[var(--ps-surface)] px-4 py-2 text-xs font-semibold text-emerald-700 shadow-lg dark:text-emerald-300"
      >
        {cancelNotice}
      </div>
    )}
    </>
  );

  if (mode === 'embedded') {
    return (
      <section
        data-testid="activity-pickndrop-tracker"
        className="space-y-3 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-2 text-sm font-bold text-[var(--ps-text)]">
              <Package className="h-4 w-4 text-[var(--ps-accent)]" />
              <span>Pick N Drop Deliveries ({orders.length})</span>
            </h2>
            <p className="text-[11px] text-[var(--ps-text-muted)]">
              Live escrow status, asymmetric Pickup/Dropoff/Return OTPs, and private POD verification.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadCustomerOrders()}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`}
            />
            Refresh
          </button>
        </div>
        {renderTrackerBody()}
        {cancelLayer}
      </section>
    );
  }

  return (
    <>
    <AnimatePresence>
      {/* v21a: the tracker overlay (z-[9990], inline) steps aside while the portaled
          cancel FormModal (z-[100]) is open so the form is never hidden behind it */}
      {isOpen && !cancelTarget && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
          onClick={onClose}
          data-testid="pnd-order-tracker-backdrop"
          className="fixed inset-0 z-[9990] flex items-center justify-center bg-black/55 backdrop-blur-sm p-3 sm:p-4"
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Pick N Drop Order Tracker"
            data-testid="pnd-order-tracker-modal"
            initial={{ opacity: 0, y: 18, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 18, scale: 0.96 }}
            transition={{ type: 'spring', damping: 28, stiffness: 340 }}
            onClick={(e) => e.stopPropagation()}
            className="flex max-h-[85dvh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] shadow-2xl"
          >
            <div className="flex items-center justify-between gap-2 border-b border-[var(--ps-border)] px-4 py-3">
              <div className="flex items-center gap-2 min-w-0">
                <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-[var(--ps-accent)]/15 text-[var(--ps-accent)]">
                  <Package className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <h2 className="truncate text-sm font-bold text-[var(--ps-text)]">
                    My Pick N Drop Orders
                  </h2>
                  <p className="truncate text-[11px] text-[var(--ps-text-muted)]">
                    Live escrow tracker &amp; asymmetric handover OTPs
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => void loadCustomerOrders()}
                  aria-label="Refresh orders"
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]"
                >
                  <RefreshCw
                    className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`}
                  />
                </button>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close order tracker"
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain p-4">
              {renderTrackerBody()}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
    {cancelLayer}
    </>
  );
}

export default OrderTrackerModal;
