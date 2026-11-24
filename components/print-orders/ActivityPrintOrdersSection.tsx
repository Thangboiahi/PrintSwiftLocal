'use client';

import React, { useCallback, useState } from 'react';
import Link from 'next/link';
import { PhoneInput } from '@/components/ui/PhoneInput';
import {
  AlertCircle,
  ArrowRight,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  CreditCard,
  FileText,
  KeyRound,
  Loader2,
  MapPin,
  Navigation,
  Printer,
  ShieldCheck,
  Sparkles,
  Store,
  Truck,
} from 'lucide-react';
import { useAppConfig } from '@/components/providers/AppConfigProvider';
import { AppBrandLoader } from '@/components/ui/AppBrandLoader';
import { setAppStatus } from '@/lib/hooks/useAppStatus';
import type { PaymentIntentRecord } from '@/lib/payments/types';
import type {
  PrintFulfillmentStatus,
  PrintOrder,
  PrintPaymentStatus,
  PrintQuoteSnapshot,
  PrintQuoteStatus,
} from '@/lib/print-orders/types';
import { supabase } from '@/lib/supabase/client';

export interface HydratedPrintOrderFileSummary {
  id: string;
  display_label_masked: string;
  server_verified_pages: number;
  purge_status: 'active' | 'purged';
}

export interface HydratedPrintOrderRow extends PrintOrder {
  listingTitle: string;
  listingLocality: string;
  listingLat: number | null;
  listingLng: number | null;
  files: HydratedPrintOrderFileSummary[];
}

export interface ActivityPrintOrdersSectionProps {
  orders: HydratedPrintOrderRow[];
  paymentIntents: PaymentIntentRecord[];
  isLoading: boolean;
  resolveCrossHubLabel: (itemHubId?: string | null) => string | null;
  onOpenPaymentModal: (
    intent: PaymentIntentRecord,
    meta: { title: string; subtitle: string }
  ) => void;
  onRefresh: () => Promise<void> | void;
}

function formatInr(amount: number): string {
  const num = Number.isFinite(amount) ? amount : 0;
  return `₹${num.toLocaleString('en-IN', {
    minimumFractionDigits: num % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDateTime(iso: string | null): string {
  if (!iso) return '';
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return '';
  return dt.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

function getQuoteBadge(status: PrintQuoteStatus): { label: string; cls: string } {
  switch (status) {
    case 'awaiting_shop_quote':
      return {
        label: 'Awaiting Quote',
        cls: 'border-amber-500/35 bg-amber-500/12 text-amber-700 dark:text-amber-300',
      };
    case 'quoted':
      return {
        label: 'Quote Ready',
        cls: 'border-sky-500/35 bg-sky-500/12 text-sky-700 dark:text-sky-300',
      };
    case 'accepted':
      return {
        label: 'Quote Accepted',
        cls: 'border-emerald-500/35 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
      };
    case 'expired':
      return {
        label: 'Quote Expired',
        cls: 'border-rose-500/35 bg-rose-500/12 text-rose-700 dark:text-rose-300',
      };
    default:
      return {
        label: 'Draft',
        cls: 'border-slate-400/35 bg-slate-500/10 text-slate-600 dark:text-slate-300',
      };
  }
}

function getPaymentBadge(status: PrintPaymentStatus): {
  label: string;
  cls: string;
} {
  switch (status) {
    case 'escrow_held':
      return {
        label: 'Escrow Paid',
        cls: 'border-emerald-500/35 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
      };
    case 'paid_direct_confirmed':
      return {
        label: 'Paid Direct',
        cls: 'border-emerald-500/35 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
      };
    case 'pending_manual_review':
      return {
        label: 'Payment Review',
        cls: 'border-amber-500/35 bg-amber-500/12 text-amber-700 dark:text-amber-300',
      };
    case 'unpaid':
      return {
        label: 'Payment Due',
        cls: 'border-sky-500/35 bg-sky-500/12 text-sky-700 dark:text-sky-300',
      };
    case 'refunded':
      return {
        label: 'Refunded',
        cls: 'border-indigo-500/35 bg-indigo-500/12 text-indigo-700 dark:text-indigo-300',
      };
    default:
      return {
        label: 'No Charge Yet',
        cls: 'border-slate-400/35 bg-slate-500/10 text-slate-600 dark:text-slate-300',
      };
  }
}

function getFulfillmentBadge(status: PrintFulfillmentStatus): {
  label: string;
  cls: string;
} {
  switch (status) {
    case 'confirmed':
      return {
        label: 'Confirmed',
        cls: 'border-sky-500/35 bg-sky-500/12 text-sky-700 dark:text-sky-300',
      };
    case 'printing':
      return {
        label: 'Printing Now',
        cls: 'border-indigo-500/35 bg-indigo-500/12 text-indigo-700 dark:text-indigo-300',
      };
    case 'ready_for_pickup':
      return {
        label: 'Ready for Pickup',
        cls: 'border-emerald-500/35 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
      };
    case 'handed_to_rider':
      return {
        label: 'With Pick N Drop Rider',
        cls: 'border-cyan-500/35 bg-cyan-500/12 text-cyan-700 dark:text-cyan-300',
      };
    case 'collected':
      return {
        label: 'Collected',
        cls: 'border-emerald-500/35 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
      };
    case 'cancelled':
      return {
        label: 'Cancelled',
        cls: 'border-rose-500/35 bg-rose-500/12 text-rose-700 dark:text-rose-300',
      };
    default:
      return {
        label: 'Pending',
        cls: 'border-slate-400/35 bg-slate-500/10 text-slate-600 dark:text-slate-300',
      };
  }
}

export function ActivityPrintOrdersSection({
  orders,
  paymentIntents,
  isLoading,
  resolveCrossHubLabel,
  onOpenPaymentModal,
  onRefresh,
}: ActivityPrintOrdersSectionProps) {
  const { activeHub, hubs } = useAppConfig();

  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [actionErrorByOrder, setActionErrorByOrder] = useState<
    Record<string, string>
  >({});
  const [copiedOtpId, setCopiedOtpId] = useState<string | null>(null);

  // Inline 1-Tap Pick N Drop Delivery Bridge state
  const [deliveryFormOrderId, setDeliveryFormOrderId] = useState<string | null>(
    null
  );
  const [dropoffAddress, setDropoffAddress] = useState('');
  const [dropoffLandmark, setDropoffLandmark] = useState('');
  const [recipientPhone, setRecipientPhone] = useState('');
  const [dropoffLat, setDropoffLat] = useState<number | null>(null);
  const [dropoffLng, setDropoffLng] = useState<number | null>(null);
  const [isLocating, setIsLocating] = useState(false);

  const getToken = useCallback(async (): Promise<string | null> => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }, []);

  const copyOtp = useCallback(async (orderId: string, otp: string) => {
    try {
      await navigator.clipboard.writeText(otp);
      setCopiedOtpId(orderId);
      window.setTimeout(() => {
        setCopiedOtpId((prev) => (prev === orderId ? null : prev));
      }, 2000);
    } catch {
      // ignore
    }
  }, []);

  // Accept Mode B custom shop quote
  const handleAcceptCustomQuote = async (order: HydratedPrintOrderRow) => {
    setBusyOrderId(order.id);
    setActionErrorByOrder((prev) => ({ ...prev, [order.id]: '' }));
    setAppStatus('saving', 'Accepting custom quote…');

    try {
      const token = await getToken();
      if (!token) throw new Error('Please sign in again to continue.');

      const res = await fetch('/api/print-orders/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          orderId: order.id,
          listingId: order.listing_id,
          jobMode: 'custom_digital',
          acceptCustomQuote: true,
        }),
      });

      const payload = (await res.json().catch(() => null)) as {
        paymentIntent?: PaymentIntentRecord;
        error?: string;
      } | null;

      if (!res.ok) {
        throw new Error(payload?.error || 'Could not accept this quote.');
      }

      if (payload?.paymentIntent) {
        onOpenPaymentModal(payload.paymentIntent, {
          title: `Custom Digital Quote · ${order.order_code}`,
          subtitle: `${order.listingTitle} · DD oodle Escrow`,
        });
      }

      setAppStatus('idle');
      await onRefresh();
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Unable to accept custom quote.';
      setActionErrorByOrder((prev) => ({ ...prev, [order.id]: msg }));
      setAppStatus('error', msg);
    } finally {
      setBusyOrderId(null);
    }
  };

  // Resume Escrow Payment for an unpaid print order
  const handleResumeEscrowPayment = async (order: HydratedPrintOrderRow) => {
    setActionErrorByOrder((prev) => ({ ...prev, [order.id]: '' }));

    const existing = paymentIntents.find(
      (pi) =>
        (order.payment_intent_id && pi.id === order.payment_intent_id) ||
        ((pi.purpose === 'print_order' ||
          pi.purpose === 'print_order_with_delivery') &&
          pi.reference_id === order.id &&
          (pi.status === 'awaiting_payment' || pi.status === 'pending_manual'))
    );

    if (existing) {
      onOpenPaymentModal(existing, {
        title: `Print Order Escrow · ${order.order_code}`,
        subtitle: `${order.listingTitle} · ${order.handover_mode === 'pick_n_drop' ? 'Print + Pick N Drop' : 'Walk-In Pickup'}`,
      });
      return;
    }

    setBusyOrderId(order.id);
    setAppStatus('saving', 'Preparing print payment checkout…');
    try {
      const token = await getToken();
      if (!token) throw new Error('Please sign in again to continue.');

      const purpose =
        order.handover_mode === 'pick_n_drop'
          ? 'print_order_with_delivery'
          : 'print_order';

      const res = await fetch('/api/payments/create-intent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          purpose,
          reference_id: order.id,
          amount_inr: Number(order.quoted_amount_inr || 0),
          hubId: order.hub_id || activeHub?.id || undefined,
        }),
      });

      const payload = (await res.json().catch(() => null)) as {
        intent?: PaymentIntentRecord;
        error?: string;
      } | null;

      if (!res.ok || !payload?.intent) {
        throw new Error(
          payload?.error || 'Could not initialize escrow payment.'
        );
      }

      onOpenPaymentModal(payload.intent, {
        title: `Print Order Escrow · ${order.order_code}`,
        subtitle: order.listingTitle,
      });
      setAppStatus('idle');
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Unable to start payment.';
      setActionErrorByOrder((prev) => ({ ...prev, [order.id]: msg }));
      setAppStatus('error', msg);
    } finally {
      setBusyOrderId(null);
    }
  };

  // Open inline Pick N Drop delivery bridge form pre-populated with hub center fallback
  const openDeliveryBridgeForm = (order: HydratedPrintOrderRow) => {
    if (deliveryFormOrderId === order.id) {
      setDeliveryFormOrderId(null);
      return;
    }
    const orderHub =
      hubs.find((h) => h.id === order.hub_id) || activeHub || null;
    setDeliveryFormOrderId(order.id);
    setDropoffAddress('');
    setDropoffLandmark('');
    setDropoffLat(order.listingLat ?? orderHub?.center_lat ?? 24.3333);
    setDropoffLng(order.listingLng ?? orderHub?.center_lng ?? 93.6833);
    setActionErrorByOrder((prev) => ({ ...prev, [order.id]: '' }));
  };

  // Use browser GPS for delivery dropoff coordinates
  const handleDetectGps = () => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) return;
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setDropoffLat(pos.coords.latitude);
        setDropoffLng(pos.coords.longitude);
        setIsLocating(false);
      },
      () => {
        setIsLocating(false);
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  // Submit 1-Tap Pick N Drop Delivery Bridge
  const handleRequestDeliveryBridge = async (
    e: React.FormEvent,
    order: HydratedPrintOrderRow
  ) => {
    e.preventDefault();
    setActionErrorByOrder((prev) => ({ ...prev, [order.id]: '' }));

    if (!dropoffAddress.trim()) {
      setActionErrorByOrder((prev) => ({
        ...prev,
        [order.id]: 'Please enter your delivery address or locality.',
      }));
      return;
    }

    if (!recipientPhone.trim()) {
      setActionErrorByOrder((prev) => ({
        ...prev,
        [order.id]: 'Please enter your mobile number for rider handover.',
      }));
      return;
    }

    const orderHub =
      hubs.find((h) => h.id === order.hub_id) || activeHub || null;
    const lat = dropoffLat ?? order.listingLat ?? orderHub?.center_lat ?? 24.3333;
    const lng = dropoffLng ?? order.listingLng ?? orderHub?.center_lng ?? 93.6833;

    setBusyOrderId(order.id);
    setAppStatus('saving', 'Scheduling sealed Pick N Drop delivery…');

    try {
      const token = await getToken();
      if (!token) throw new Error('Please sign in again to request delivery.');

      const res = await fetch(`/api/print-orders/${order.id}/request-delivery`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          dropoffLat: lat,
          dropoffLng: lng,
          dropoffAddress: dropoffAddress.trim(),
          dropoffLandmark: dropoffLandmark.trim() || undefined,
          recipientPhone: recipientPhone.trim(),
        }),
      });

      const payload = (await res.json().catch(() => null)) as {
        paymentIntent?: PaymentIntentRecord;
        totalPayableInr?: number;
        deliveryFareInr?: number;
        error?: string;
      } | null;

      if (!res.ok || !payload?.paymentIntent) {
        throw new Error(
          payload?.error || 'Could not attach Pick N Drop delivery.'
        );
      }

      setDeliveryFormOrderId(null);
      onOpenPaymentModal(payload.paymentIntent, {
        title: `Print + Pick N Drop · ${order.order_code}`,
        subtitle: `Sealed delivery from ${order.listingTitle} (Delivery ₹${payload.deliveryFareInr ?? 0})`,
      });
      setAppStatus('idle');
      await onRefresh();
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Unable to schedule Pick N Drop delivery.';
      setActionErrorByOrder((prev) => ({ ...prev, [order.id]: msg }));
      setAppStatus('error', msg);
    } finally {
      setBusyOrderId(null);
    }
  };

  if (isLoading) {
    return (
      <AppBrandLoader
        mode="inline"
        message="Loading Print & Digital orders…"
        className="min-h-[260px] rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] py-8"
      />
    );
  }

  if (orders.length === 0) {
    return (
      <div
        data-testid="activity-print-empty"
        className="rounded-2xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-surface)] p-8 text-center space-y-2.5"
      >
        <Printer className="mx-auto h-6 w-6 text-[var(--ps-text-muted)] opacity-70" />
        <p className="text-sm font-bold text-[var(--ps-text)]">
          No Print &amp; Digital orders yet
        </p>
        <p className="text-xs text-[var(--ps-text-muted)] max-w-sm mx-auto">
          Upload PDFs or snap document photos at any Print Pro shop on DD oodle, track live status, and collect with a 4-digit OTP.
        </p>
        <Link
          href="/explore"
          className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3.5 text-xs font-semibold text-[var(--ps-accent-fg)]"
        >
          <Printer className="h-3.5 w-3.5" />
          <span>Explore Print Shops</span>
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-3" data-testid="activity-print-list">
      {orders.map((order) => {
        const crossHubLabel = resolveCrossHubLabel(order.hub_id);
        const quoteBadge = getQuoteBadge(order.quote_status);
        const paymentBadge = getPaymentBadge(order.payment_status);
        const fulfillmentBadge = getFulfillmentBadge(order.fulfillment_status);
        const snapshot = (order.quote_snapshot || {}) as Partial<PrintQuoteSnapshot>;

        const isModeBQuoted =
          order.job_mode === 'custom_digital' &&
          order.quote_status === 'quoted' &&
          order.fulfillment_status === 'draft';

        const canResumeEscrow =
          !isModeBQuoted &&
          order.payment_rail === 'platform_escrow' &&
          order.payment_status === 'unpaid' &&
          order.fulfillment_status !== 'cancelled' &&
          order.quote_status !== 'awaiting_shop_quote' &&
          Number(order.quoted_amount_inr || 0) > 0;

        const showCollectionOtp =
          Boolean(order.collection_otp_display_for_customer) &&
          ['confirmed', 'printing', 'ready_for_pickup'].includes(
            order.fulfillment_status
          );

        const canRequestDelivery =
          order.handover_mode === 'walk_in_pickup' &&
          order.fulfillment_status === 'ready_for_pickup' &&
          !order.linked_delivery_order_id;

        const isDeliveryFormOpen = deliveryFormOrderId === order.id;
        const isBusy = busyOrderId === order.id;
        const orderError = actionErrorByOrder[order.id];

        return (
          <article
            key={order.id}
            data-testid={`activity-print-card-${order.order_code}`}
            className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3"
          >
            {/* Card Header: Order Code, Shop Link, Job Mode, Cross-Hub */}
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0 space-y-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-xs font-extrabold text-[var(--ps-text)]">
                    {order.order_code}
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-0.5 text-[10px] font-bold text-[var(--ps-text)]">
                    {order.job_mode === 'custom_digital' ? (
                      <>
                        <Sparkles className="h-3 w-3 text-theme-primary" />
                        <span>Custom Digital</span>
                      </>
                    ) : (
                      <>
                        <Printer className="h-3 w-3 text-theme-primary" />
                        <span>Instant Print</span>
                      </>
                    )}
                  </span>
                  {crossHubLabel && (
                    <span className="inline-flex items-center gap-1 rounded-md border border-amber-500/35 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                      <MapPin className="h-3 w-3" />
                      <span>{crossHubLabel}</span>
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Link
                    href={`/listing/${order.listing_id}`}
                    className="inline-flex items-center gap-1 font-bold text-theme-primary hover:underline"
                  >
                    <Store className="h-3.5 w-3.5 shrink-0" />
                    <span>{order.listingTitle}</span>
                  </Link>
                  {order.listingLocality && (
                    <span className="text-[11px] text-[var(--ps-text-muted)]">
                      · {order.listingLocality}
                    </span>
                  )}
                </div>
              </div>

              <div className="text-right shrink-0">
                <p className="font-mono text-sm font-extrabold text-[var(--ps-text)] tabular-nums">
                  {order.quoted_amount_inr !== null &&
                  Number(order.quoted_amount_inr) > 0
                    ? formatInr(Number(order.quoted_amount_inr))
                    : 'Awaiting Quote'}
                </p>
                <p className="text-[10px] text-[var(--ps-text-muted)]">
                  {formatDateTime(order.created_at)}
                </p>
              </div>
            </div>

            {/* Separate Independent Lifecycle Statuses: Quote · Payment · Fulfillment */}
            <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-bold">
              <span
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 ${quoteBadge.cls}`}
              >
                <span className="opacity-70 uppercase">Quote:</span>
                <span>{quoteBadge.label}</span>
              </span>
              <span
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 ${paymentBadge.cls}`}
              >
                <span className="opacity-70 uppercase">Payment:</span>
                <span>{paymentBadge.label}</span>
              </span>
              <span
                className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 ${fulfillmentBadge.cls}`}
              >
                <span className="opacity-70 uppercase">Status:</span>
                <span>{fulfillmentBadge.label}</span>
              </span>
            </div>

            {/* Masked File Summary or Custom Instructions */}
            {(order.files.length > 0 || order.customer_instructions) && (
              <div className="rounded-xl border border-[var(--ps-border)]/70 bg-[var(--ps-bg)] px-3 py-2 space-y-1.5 text-xs">
                {order.files.length > 0 && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {order.files.map((f) => (
                      <span
                        key={f.id}
                        className="inline-flex items-center gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2 py-0.5 text-[11px] font-medium text-[var(--ps-text)]"
                      >
                        <FileText className="h-3 w-3 text-theme-primary shrink-0" />
                        <span>{f.display_label_masked}</span>
                      </span>
                    ))}
                  </div>
                )}
                {order.customer_instructions && (
                  <p className="text-[11px] text-[var(--ps-text-muted)] line-clamp-2">
                    {order.customer_instructions}
                  </p>
                )}
              </div>
            )}

            {/* Mode B Shop Quote Acceptance Box */}
            {isModeBQuoted && (
              <div
                data-testid={`print-quote-accept-box-${order.order_code}`}
                className="rounded-xl border border-sky-500/35 bg-sky-500/10 p-3 flex flex-wrap items-center justify-between gap-3 text-xs"
              >
                <div className="space-y-0.5 min-w-0">
                  <p className="font-bold text-sky-900 dark:text-sky-200">
                    Shop Quote Received:{' '}
                    <span className="font-mono tabular-nums">
                      {formatInr(Number(order.quoted_amount_inr || 0))}
                    </span>
                  </p>
                  {(snapshot.custom_turnaround_note ||
                    snapshot.custom_quote_note) && (
                    <p className="text-[11px] text-sky-800/90 dark:text-sky-300/90">
                      {[snapshot.custom_turnaround_note, snapshot.custom_quote_note]
                        .filter(Boolean)
                        .join(' · ')}
                    </p>
                  )}
                </div>

                <button
                  type="button"
                  disabled={isBusy}
                  data-testid={`print-accept-quote-btn-${order.order_code}`}
                  onClick={() => void handleAcceptCustomQuote(order)}
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl bg-theme-primary px-3.5 text-xs font-bold text-theme-primary-foreground hover:opacity-95 disabled:opacity-50 cursor-pointer"
                >
                  {isBusy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CreditCard className="h-3.5 w-3.5" />
                  )}
                  <span>Accept Quote &amp; Pay</span>
                </button>
              </div>
            )}

            {/* Resume Escrow Payment Action */}
            {canResumeEscrow && (
              <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 p-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                <p className="font-semibold text-amber-900 dark:text-amber-200">
                  Escrow payment of{' '}
                  <strong className="font-mono tabular-nums">
                    {formatInr(Number(order.quoted_amount_inr || 0))}
                  </strong>{' '}
                  is pending to confirm this print job.
                </p>
                <button
                  type="button"
                  disabled={isBusy}
                  data-testid={`print-resume-payment-btn-${order.order_code}`}
                  onClick={() => void handleResumeEscrowPayment(order)}
                  className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl bg-theme-primary px-3.5 text-xs font-bold text-theme-primary-foreground hover:opacity-95 disabled:opacity-50 cursor-pointer"
                >
                  {isBusy ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CreditCard className="h-3.5 w-3.5" />
                  )}
                  <span>Complete Payment</span>
                </button>
              </div>
            )}

            {/* 4-Digit Collection OTP Box */}
            {showCollectionOtp && order.collection_otp_display_for_customer && (
              <div
                data-testid={`print-otp-box-${order.order_code}`}
                className="rounded-xl border border-theme-primary/30 bg-theme-primary/8 px-3.5 py-2.5 flex flex-wrap items-center justify-between gap-2"
              >
                <div className="flex items-center gap-2 text-xs">
                  <KeyRound className="h-4 w-4 text-theme-primary shrink-0" />
                  <div>
                    <span className="font-bold text-[var(--ps-text)] block">
                      4-Digit Collection OTP
                    </span>
                    <span className="text-[11px] text-[var(--ps-text-muted)]">
                      Show at counter to collect your print package
                    </span>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-lg font-extrabold tracking-[0.22em] text-[var(--ps-text)] tabular-nums">
                    {order.collection_otp_display_for_customer}
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      void copyOtp(
                        order.id,
                        order.collection_otp_display_for_customer!
                      )
                    }
                    className="inline-flex h-7 items-center gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2 text-[11px] font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] cursor-pointer"
                  >
                    {copiedOtpId === order.id ? (
                      <Check className="h-3 w-3 text-emerald-500" />
                    ) : (
                      <Copy className="h-3 w-3" />
                    )}
                    <span>{copiedOtpId === order.id ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              </div>
            )}

            {/* 1-Tap Pick N Drop Delivery Bridge (when Walk-In order is Ready for Pickup) */}
            {canRequestDelivery && (
              <div className="space-y-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-emerald-500/30 bg-emerald-500/8 px-3.5 py-2.5 text-xs">
                  <div className="flex items-center gap-2 text-emerald-800 dark:text-emerald-300 font-semibold">
                    <Truck className="h-4 w-4 shrink-0" />
                    <span>
                      Prints ready at counter! Want a sealed Pick N Drop rider to bring them to you?
                    </span>
                  </div>
                  <button
                    type="button"
                    data-testid={`print-deliver-bridge-btn-${order.order_code}`}
                    onClick={() => openDeliveryBridgeForm(order)}
                    className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-xs font-bold text-white hover:bg-emerald-700 transition-colors cursor-pointer"
                  >
                    <Truck className="h-3.5 w-3.5" />
                    <span>
                      {isDeliveryFormOpen
                        ? 'Close Delivery Form'
                        : 'Deliver to Me via Pick N Drop'}
                    </span>
                  </button>
                </div>

                {isDeliveryFormOpen && (
                  <form
                    onSubmit={(e) => void handleRequestDeliveryBridge(e, order)}
                    data-testid={`print-deliver-bridge-form-${order.order_code}`}
                    className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3.5 space-y-2.5 text-xs"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <p className="font-bold text-[var(--ps-text)]">
                        Sealed Pick N Drop Dropoff Details
                      </p>
                      <button
                        type="button"
                        onClick={handleDetectGps}
                        disabled={isLocating}
                        className="inline-flex h-7 items-center gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 text-[11px] font-semibold text-theme-primary hover:bg-[var(--ps-surface-alt)] cursor-pointer"
                      >
                        {isLocating ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Navigation className="h-3 w-3" />
                        )}
                        <span>
                          {isLocating ? 'Locating…' : 'Use Current GPS'}
                        </span>
                      </button>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      <input
                        type="text"
                        required
                        value={dropoffAddress}
                        onChange={(e) => setDropoffAddress(e.target.value)}
                        placeholder="Dropoff address / locality *"
                        className="h-9 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 text-xs text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:outline-none focus:ring-1 focus:ring-theme-primary"
                      />
                      <PhoneInput
                        variant="sm"
                        required
                        value={recipientPhone}
                        onChange={setRecipientPhone}
                        placeholder="Your phone for rider handover *"
                      />
                    </div>

                    <input
                      type="text"
                      value={dropoffLandmark}
                      onChange={(e) => setDropoffLandmark(e.target.value)}
                      placeholder="Nearby landmark (optional)"
                      className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 text-xs text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:outline-none focus:ring-1 focus:ring-theme-primary"
                    />

                    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                      <span className="text-[11px] text-[var(--ps-text-muted)]">
                        Single escrow checkout covers delivery fare + any unpaid print balance.
                      </span>
                      <button
                        type="submit"
                        disabled={isBusy}
                        className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-theme-primary px-3.5 text-xs font-bold text-theme-primary-foreground hover:opacity-95 disabled:opacity-50 cursor-pointer"
                      >
                        {isBusy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Truck className="h-3.5 w-3.5" />
                        )}
                        <span>Confirm &amp; Pay Delivery</span>
                      </button>
                    </div>
                  </form>
                )}
              </div>
            )}

            {orderError && (
              <div
                role="alert"
                className="rounded-xl border border-rose-500/35 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2"
              >
                <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                <span>{orderError}</span>
              </div>
            )}

            {/* Footer: 48-Hour Auto-Purge Status & Fresh Re-order */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--ps-border)]/60 pt-2.5 text-[11px]">
              {order.purge_status === 'purged' ? (
                <span
                  data-testid={`print-purge-status-${order.order_code}`}
                  className="inline-flex items-center gap-1.5 font-semibold text-emerald-600 dark:text-emerald-400"
                >
                  <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
                  <span>Documents Permanently Purged ✓</span>
                </span>
              ) : order.purge_status === 'scheduled' &&
                order.purge_scheduled_at ? (
                <span
                  data-testid={`print-purge-status-${order.order_code}`}
                  className="inline-flex items-center gap-1.5 text-[var(--ps-text-muted)]"
                >
                  <Clock className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                  <span>
                    Auto-erases on {formatDateTime(order.purge_scheduled_at)}
                  </span>
                </span>
              ) : (
                <span
                  data-testid={`print-purge-status-${order.order_code}`}
                  className="inline-flex items-center gap-1.5 text-[var(--ps-text-muted)]"
                >
                  <ShieldCheck className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                  <span>Auto-erases 48h after pickup</span>
                </span>
              )}

              {order.purge_status === 'purged' && (
                <Link
                  href={`/listing/${order.listing_id}/print`}
                  data-testid={`print-fresh-reorder-${order.order_code}`}
                  className="inline-flex items-center gap-1 font-bold text-theme-primary hover:underline"
                >
                  <span>Start Fresh Print Order</span>
                  <ArrowRight className="h-3 w-3" />
                </Link>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}

export default ActivityPrintOrdersSection;
