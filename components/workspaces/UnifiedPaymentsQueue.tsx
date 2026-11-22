'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  ExternalLink,
  Image as ImageIcon,
  Loader2,
  Phone,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Wallet,
  X,
  XCircle,
} from 'lucide-react';
import { useHub } from '@/components/providers/AppConfigProvider';
import {
  ResponsiveTableScroll,
  WorkspaceTableToolbar,
} from '@/components/ui/ResponsiveTableWrapper';
import { setAppStatus } from '@/lib/hooks/useAppStatus';
import type {
  PaymentIntentRecord,
  PaymentPurpose,
} from '@/lib/payments/types';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { resolveRemoteMediaUrl } from '@/lib/supabase/storage';

type StatusFilter = 'pending_manual' | 'succeeded' | 'refunded' | 'all';
type PurposeFilter = 'all' | PaymentPurpose;

interface HydratedPaymentIntent extends PaymentIntentRecord {
  customer_name: string;
  customer_phone: string;
  customer_email: string;
}

export interface UnifiedPaymentsQueueProps {
  onNotice?: (notice: {
    type: 'success' | 'error' | 'info';
    text: string;
  }) => void;
}

const PURPOSE_META: Record<
  PaymentPurpose,
  { label: string; cls: string }
> = {
  pick_n_drop: {
    label: 'Pick N Drop',
    cls: 'text-emerald-700 dark:text-emerald-300 bg-emerald-500/12 border-emerald-500/30',
  },
  vehicle_booking: {
    label: 'Vehicle Booking',
    cls: 'text-sky-700 dark:text-sky-300 bg-sky-500/12 border-sky-500/30',
  },
  bulletin_subscription: {
    label: 'Bulletin Plan',
    cls: 'text-amber-700 dark:text-amber-300 bg-amber-500/12 border-amber-500/30',
  },
  bulletin_post_pass: {
    label: 'Bulletin Pass',
    cls: 'text-indigo-700 dark:text-indigo-300 bg-indigo-500/12 border-indigo-500/30',
  },
  print_order: {
    label: 'Print Order',
    cls: 'text-teal-700 dark:text-teal-300 bg-teal-500/12 border-teal-500/30',
  },
  print_order_with_delivery: {
    label: 'Print + Delivery',
    cls: 'text-cyan-700 dark:text-cyan-300 bg-cyan-500/12 border-cyan-500/30',
  },
  print_pro_subscription: {
    label: 'Print Pro Plan',
    cls: 'text-violet-700 dark:text-violet-300 bg-violet-500/12 border-violet-500/30',
  },
  resource_booking: {
    label: 'Venue / Stay Booking',
    cls: 'text-emerald-700 dark:text-emerald-300 bg-emerald-500/12 border-emerald-500/30',
  },
  booking_pro_subscription: {
    label: 'Booking Pro Plan',
    cls: 'text-green-700 dark:text-green-300 bg-green-500/12 border-green-500/30',
  },
  stay_pro_subscription: {
    label: 'Stay Pro Plan',
    cls: 'text-indigo-700 dark:text-indigo-300 bg-indigo-500/12 border-indigo-500/30',
  },
  shop_order: {
    label: 'Shop Order',
    cls: 'text-sky-700 dark:text-sky-300 bg-sky-500/12 border-sky-500/30',
  },
  shop_order_with_delivery: {
    label: 'Shop + Delivery',
    cls: 'text-sky-700 dark:text-sky-300 bg-sky-500/12 border-sky-500/30',
  },
  restaurant_order: {
    label: 'Food Order',
    cls: 'text-orange-700 dark:text-orange-300 bg-orange-500/12 border-orange-500/30',
  },
  restaurant_order_with_delivery: {
    label: 'Food + Delivery',
    cls: 'text-orange-700 dark:text-orange-300 bg-orange-500/12 border-orange-500/30',
  },
  catalogue_pro_subscription: {
    label: 'Catalogue Pro Plan',
    cls: 'text-blue-700 dark:text-blue-300 bg-blue-500/12 border-blue-500/30',
  },
  restaurant_pro_subscription: {
    label: 'Restaurant Pro Plan',
    cls: 'text-amber-700 dark:text-amber-300 bg-amber-500/12 border-amber-500/30',
  },
  real_estate_boost_30d: {
    label: 'Property Boost (30d)',
    cls: 'text-purple-700 dark:text-purple-300 bg-purple-500/12 border-purple-500/30',
  },
  agent_pro_subscription: {
    label: 'Agent Pro Plan',
    cls: 'text-violet-700 dark:text-violet-300 bg-violet-500/12 border-violet-500/30',
  },
};

const STATUS_META: Record<
  PaymentIntentRecord['status'],
  { label: string; cls: string }
> = {
  awaiting_payment: {
    label: 'Awaiting Payment',
    cls: 'text-slate-600 dark:text-slate-300',
  },
  pending_manual: {
    label: 'Pending Review',
    cls: 'text-amber-600 dark:text-amber-400',
  },
  succeeded: {
    label: 'Approved',
    cls: 'text-emerald-600 dark:text-emerald-400',
  },
  failed: {
    label: 'Failed / Expired',
    cls: 'text-slate-500 dark:text-slate-400',
  },
  rejected: {
    label: 'Rejected',
    cls: 'text-rose-600 dark:text-rose-400',
  },
  refunded: {
    label: 'Refunded',
    cls: 'text-indigo-600 dark:text-indigo-400',
  },
};

export function UnifiedPaymentsQueue({ onNotice }: UnifiedPaymentsQueueProps) {
  const { hubs } = useHub();
  const [intents, setIntents] = useState<HydratedPaymentIntent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [statusFilter, setStatusFilter] =
    useState<StatusFilter>('pending_manual');
  const [purposeFilter, setPurposeFilter] = useState<PurposeFilter>('all');
  const [hubFilter, setHubFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);

  const hubNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const h of hubs) {
      map.set(h.id, h.name);
    }
    return map;
  }, [hubs]);

  // Inline Reject / Refund drawers per row
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [refundingId, setRefundingId] = useState<string | null>(null);
  const [refundUtr, setRefundUtr] = useState('');
  const [refundNotes, setRefundNotes] = useState('');

  // Proof image preview modal
  const [previewProofUrl, setPreviewProofUrl] = useState<string | null>(null);
  const [banner, setBanner] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  const loadPayments = useCallback(async (silent = false) => {
    if (!isSupabaseConfigured()) {
      setIsLoading(false);
      return;
    }
    if (!silent) setIsLoading(true);
    else setIsRefreshing(true);

    try {
      const { data: rows, error } = await supabase
        .from('payment_intents')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(200);

      if (error) throw new Error(error.message);

      const rawIntents = (rows || []) as PaymentIntentRecord[];
      const userIds = Array.from(
        new Set(rawIntents.map((r) => r.user_id).filter(Boolean))
      );

      const profilesById = new Map<
        string,
        { full_name?: string | null; name?: string | null; phone?: string | null; email?: string | null }
      >();

      if (userIds.length > 0) {
        const { data: profiles } = await supabase
          .from('profiles')
          .select('id, full_name, name, phone, email')
          .in('id', userIds);

        if (Array.isArray(profiles)) {
          for (const p of profiles as Array<Record<string, unknown>>) {
            const id = String(p.id || '');
            if (id) {
              profilesById.set(id, {
                full_name: p.full_name ? String(p.full_name) : null,
                name: p.name ? String(p.name) : null,
                phone: p.phone ? String(p.phone) : null,
                email: p.email ? String(p.email) : null,
              });
            }
          }
        }
      }

      const hydrated: HydratedPaymentIntent[] = rawIntents.map((row) => {
        const p = profilesById.get(row.user_id);
        return {
          ...row,
          amount_inr: Number(row.amount_inr || 0),
          customer_name:
            p?.full_name || p?.name || p?.email || 'Registered User',
          customer_phone: p?.phone || '',
          customer_email: p?.email || '',
        };
      });

      setIntents(hydrated);
    } catch (err) {
      setBanner({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Unable to load unified payment queue.',
      });
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void loadPayments(false);
    });
  }, [loadPayments]);

  const counts = useMemo(() => {
    let pending = 0;
    let pendingSum = 0;
    let succeeded = 0;
    let succeededSum = 0;
    let refunded = 0;
    let refundedSum = 0;
    for (const item of intents) {
      if (item.status === 'pending_manual') {
        pending++;
        pendingSum += item.amount_inr;
      } else if (item.status === 'succeeded') {
        succeeded++;
        succeededSum += item.amount_inr;
      } else if (item.status === 'refunded') {
        refunded++;
        refundedSum += item.amount_inr;
      }
    }
    return {
      pending,
      pendingSum,
      succeeded,
      succeededSum,
      refunded,
      refundedSum,
    };
  }, [intents]);

  const filteredIntents = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return intents.filter((item) => {
      if (statusFilter !== 'all' && item.status !== statusFilter) return false;
      if (purposeFilter !== 'all' && item.purpose !== purposeFilter)
        return false;
      if (hubFilter !== 'all' && item.hub_id !== hubFilter) return false;
      if (!q) return true;
      return (
        item.intent_code.toLowerCase().includes(q) ||
        (item.upi_utr_ref || '').toLowerCase().includes(q) ||
        item.customer_name.toLowerCase().includes(q) ||
        item.customer_phone.toLowerCase().includes(q) ||
        item.customer_email.toLowerCase().includes(q)
      );
    });
  }, [intents, statusFilter, purposeFilter, hubFilter, searchQuery]);

  const handleApproveAndFulfill = async (intent: HydratedPaymentIntent) => {
    setBusyId(intent.id);
    setBanner(null);
    setAppStatus('saving', `Approving ${intent.intent_code}…`);

    try {
      const { error } = await supabase.rpc('fulfill_payment_intent', {
        p_intent_id: intent.id,
        p_provider_payment_id: intent.upi_utr_ref || null,
      });

      if (error) throw new Error(error.message);

      const msg = `Approved & fulfilled ${intent.intent_code} (₹${intent.amount_inr.toLocaleString('en-IN')}). Linked ${PURPOSE_META[intent.purpose]?.label || intent.purpose} activated.`;
      setBanner({ type: 'success', text: msg });
      onNotice?.({ type: 'success', text: msg });
      setAppStatus('success', 'Payment fulfilled');
      await loadPayments(true);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to fulfill payment intent.';
      setBanner({ type: 'error', text: msg });
      onNotice?.({ type: 'error', text: msg });
      setAppStatus('error', 'Approval failed');
    } finally {
      setBusyId(null);
    }
  };

  const handleRejectIntent = async (intent: HydratedPaymentIntent) => {
    const trimmedReason = rejectReason.trim() || 'UTR could not be verified.';
    setBusyId(intent.id);
    setBanner(null);
    setAppStatus('saving', `Rejecting ${intent.intent_code}…`);

    try {
      const { error } = await supabase
        .from('payment_intents')
        .update({
          status: 'rejected',
          refund_notes: trimmedReason,
          updated_at: new Date().toISOString(),
        })
        .eq('id', intent.id);

      if (error) throw new Error(error.message);

      // Keep downstream entity clean when payment proof is rejected
      if (intent.purpose === 'bulletin_post_pass') {
        await supabase
          .from('bulletin_post_passes')
          .update({ status: 'rejected' })
          .eq('id', intent.reference_id);
      } else if (intent.purpose === 'vehicle_booking') {
        await supabase
          .from('vehicle_bookings')
          .update({ status: 'cancelled' })
          .eq('id', intent.reference_id)
          .in('status', ['soft_hold', 'pending_payment_confirm']);
      }

      setRejectingId(null);
      setRejectReason('');
      const msg = `Marked ${intent.intent_code} as rejected (${trimmedReason}).`;
      setBanner({ type: 'success', text: msg });
      onNotice?.({ type: 'info', text: msg });
      setAppStatus('success', 'Intent rejected');
      await loadPayments(true);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to reject payment intent.';
      setBanner({ type: 'error', text: msg });
      setAppStatus('error', 'Rejection failed');
    } finally {
      setBusyId(null);
    }
  };

  const handleMarkRefunded = async (intent: HydratedPaymentIntent) => {
    const cleanUtr = refundUtr.trim();
    if (cleanUtr.length < 4) {
      setBanner({
        type: 'error',
        text: 'Enter the outgoing refund UTR / transaction reference.',
      });
      return;
    }

    setBusyId(intent.id);
    setBanner(null);
    setAppStatus('saving', `Recording refund for ${intent.intent_code}…`);

    try {
      const { error } = await supabase.rpc('refund_payment_intent', {
        p_intent_id: intent.id,
        p_refund_utr: cleanUtr,
        p_notes: refundNotes.trim() || null,
      });

      if (error) throw new Error(error.message);

      setRefundingId(null);
      setRefundUtr('');
      setRefundNotes('');
      const msg = `Recorded refund for ${intent.intent_code} (Refund UTR: ${cleanUtr}).`;
      setBanner({ type: 'success', text: msg });
      onNotice?.({ type: 'success', text: msg });
      setAppStatus('success', 'Refund recorded');
      await loadPayments(true);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to record refund.';
      setBanner({ type: 'error', text: msg });
      setAppStatus('error', 'Refund failed');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section
      data-testid="unified-payments-queue"
      className="space-y-4 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 min-w-0 max-w-full"
    >
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--ps-border)] pb-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-1.5 text-sm font-bold text-[var(--ps-text)]">
            <Wallet className="h-4 w-4 text-[var(--ps-accent)] shrink-0" />
            <span>Super-Admin Unified Payments Queue</span>
          </h2>
          <p className="mt-0.5 text-[11px] text-[var(--ps-text-muted)]">
            Verify every UPI deposit and fulfill Pick N Drop orders, Vehicle
            Bookings, Bulletin Plans, and Single Post Passes in one click.
          </p>
        </div>

        <button
          type="button"
          disabled={isRefreshing}
          onClick={() => void loadPayments(true)}
          aria-label="Refresh payments queue"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-xs font-semibold text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] shrink-0"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`}
          />
          <span>Refresh</span>
        </button>
      </div>

      {/* Dense 3-Column Financial Summary Strip */}
      <div className="grid grid-cols-3 gap-2">
        <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2">
          <p className="text-[10px] font-semibold text-amber-600 dark:text-amber-400">
            Pending Review ({counts.pending})
          </p>
          <p className="mt-0.5 font-mono text-sm font-extrabold tabular-nums text-[var(--ps-text)]">
            ₹{counts.pendingSum.toLocaleString('en-IN')}
          </p>
        </div>
        <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2">
          <p className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400">
            Approved ({counts.succeeded})
          </p>
          <p className="mt-0.5 font-mono text-sm font-extrabold tabular-nums text-[var(--ps-text)]">
            ₹{counts.succeededSum.toLocaleString('en-IN')}
          </p>
        </div>
        <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2">
          <p className="text-[10px] font-semibold text-indigo-600 dark:text-indigo-400">
            Refunded ({counts.refunded})
          </p>
          <p className="mt-0.5 font-mono text-sm font-extrabold tabular-nums text-[var(--ps-text)]">
            ₹{counts.refundedSum.toLocaleString('en-IN')}
          </p>
        </div>
      </div>

      {/* Filter Bars: Search Toolbar + Status + Hub + Purpose */}
      <div className="flex flex-col gap-2.5 min-w-0">
        <WorkspaceTableToolbar
          searchQuery={searchQuery}
          onSearchChange={setSearchQuery}
          searchPlaceholder="Search intent code, UTR, customer, phone…"
          filteredCount={filteredIntents.length}
          totalCount={intents.length}
          countLabel="payments"
          hasActiveFilters={
            searchQuery.trim() !== '' ||
            purposeFilter !== 'all' ||
            hubFilter !== 'all' ||
            statusFilter !== 'pending_manual'
          }
          onResetFilters={() => {
            setSearchQuery('');
            setPurposeFilter('all');
            setHubFilter('all');
            setStatusFilter('all');
          }}
        />
        <div className="flex flex-wrap items-center justify-between gap-2 min-w-0 max-w-full">
          <div
            role="tablist"
            aria-label="Payment status filter"
            className="flex max-w-full items-center gap-1 overflow-x-auto no-scrollbar pb-0.5"
          >
            {(
              [
                {
                  id: 'pending_manual',
                  label: `Pending Review (${counts.pending})`,
                },
                { id: 'succeeded', label: `Approved (${counts.succeeded})` },
                { id: 'refunded', label: `Refunded (${counts.refunded})` },
                { id: 'all', label: `All (${intents.length})` },
              ] as const
            ).map((tab) => {
              const active = statusFilter === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  data-testid={`payments-status-filter-${tab.id}`}
                  onClick={() => setStatusFilter(tab.id)}
                  className={`inline-flex h-8 shrink-0 items-center rounded-lg px-2.5 text-xs font-semibold transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                      : 'border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div
            role="tablist"
            aria-label="Payment purpose filter"
            className="flex max-w-full items-center gap-1 overflow-x-auto no-scrollbar pb-0.5"
          >
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'pick_n_drop', label: 'Pick N Drop' },
                { id: 'vehicle_booking', label: 'Vehicle Booking' },
                { id: 'bulletin_subscription', label: 'Bulletin Plan' },
                { id: 'bulletin_post_pass', label: 'Bulletin Pass' },
              ] as const
            ).map((pf) => {
              const active = purposeFilter === pf.id;
              return (
                <button
                  key={pf.id}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  data-testid={`payments-purpose-filter-${pf.id}`}
                  onClick={() => setPurposeFilter(pf.id)}
                  className={`inline-flex h-7 shrink-0 items-center rounded-md px-2 text-[11px] font-semibold transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-[var(--ps-text)] text-[var(--ps-bg)]'
                      : 'border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                  }`}
                >
                  {pf.label}
                </button>
              );
            })}
          </div>
        </div>

        {/* Hub Filter Bar */}
        {hubs.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pt-1 border-t border-[var(--ps-border)]/50">
            <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--ps-text-muted)] shrink-0">
              Hub Scope:
            </span>
            <button
              type="button"
              onClick={() => setHubFilter('all')}
              className={`inline-flex h-6.5 shrink-0 items-center rounded-md px-2 text-[10px] font-semibold transition-colors whitespace-nowrap ${
                hubFilter === 'all'
                  ? 'bg-sky-600 text-white'
                  : 'border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
              }`}
            >
              All Hubs
            </button>
            {hubs.map((hub) => {
              const active = hubFilter === hub.id;
              return (
                <button
                  key={hub.id}
                  type="button"
                  onClick={() => setHubFilter(hub.id)}
                  className={`inline-flex h-6.5 shrink-0 items-center rounded-md px-2 text-[10px] font-semibold transition-colors whitespace-nowrap ${
                    active
                      ? 'bg-sky-600 text-white'
                      : 'border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                  }`}
                >
                  {hub.name}
                </button>
              );
            })}
          </div>
        )}
      </div>

      {banner && (
        <div
          className={`flex items-start justify-between gap-2 rounded-xl border px-3 py-2 text-xs ${
            banner.type === 'success'
              ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
              : 'border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300'
          }`}
        >
          <span className="flex items-center gap-1.5">
            {banner.type === 'success' ? (
              <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
            ) : (
              <AlertCircle className="h-3.5 w-3.5 shrink-0" />
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

      {/* Queue List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-10 text-xs text-[var(--ps-text-muted)] gap-2">
          <Loader2 className="h-4 w-4 animate-spin text-[var(--ps-accent)]" />
          <span>Loading payment intents…</span>
        </div>
      ) : filteredIntents.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-bg)] p-8 text-center space-y-2">
          <ShieldCheck className="mx-auto h-6 w-6 text-[var(--ps-text-muted)] opacity-60" />
          <p className="text-xs font-bold text-[var(--ps-text)]">
            No matching payments in this view
          </p>
          <p className="text-[11px] text-[var(--ps-text-muted)]">
            Switch status, purpose, hub, or search filters above to inspect other transactions.
          </p>
          {(searchQuery.trim() !== '' ||
            purposeFilter !== 'all' ||
            hubFilter !== 'all' ||
            statusFilter !== 'all') && (
            <button
              type="button"
              onClick={() => {
                setSearchQuery('');
                setPurposeFilter('all');
                setHubFilter('all');
                setStatusFilter('all');
              }}
              className="inline-flex h-8 items-center gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]"
            >
              <RotateCcw className="h-3 w-3" />
              <span>Reset All Filters</span>
            </button>
          )}
        </div>
      ) : (
        <ResponsiveTableScroll
          minWidthClass="min-w-[660px]"
          wrapperClassName="border-none bg-transparent shadow-none"
          swipeHintLabel="Swipe ↔ to inspect UTR & payment actions"
        >
        <div className="space-y-2.5">
          {filteredIntents.map((intent) => {
            const pMeta = PURPOSE_META[intent.purpose] || {
              label: intent.purpose,
              cls: 'text-[var(--ps-text)] bg-[var(--ps-surface-alt)] border-[var(--ps-border)]',
            };
            const sMeta = STATUS_META[intent.status] || {
              label: intent.status,
              cls: 'text-[var(--ps-text-muted)]',
            };
            const isBusy = busyId === intent.id;
            const resolvedProof = intent.payment_proof_path
              ? resolveRemoteMediaUrl(intent.payment_proof_path)
              : '';

            return (
              <article
                key={intent.id}
                data-testid={`payment-intent-row-${intent.intent_code}`}
                className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 text-xs space-y-2.5"
              >
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  {/* Left: Code, Purpose, Customer, UTR & Timestamp */}
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs font-extrabold text-[var(--ps-text)]">
                        {intent.intent_code}
                      </span>
                      <span
                        className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-bold ${pMeta.cls}`}
                      >
                        {pMeta.label}
                      </span>
                      <span className={`text-[11px] font-bold ${sMeta.cls}`}>
                        {sMeta.label}
                      </span>
                      {intent.hub_id && (
                        <span className="inline-flex items-center rounded-md border border-sky-500/30 bg-sky-500/10 px-1.5 py-0.5 text-[9px] font-bold text-sky-700 dark:text-sky-300">
                          {hubNameById.get(intent.hub_id) || 'Hub'}
                        </span>
                      )}
                      <span className="inline-flex items-center gap-1 text-[10px] text-[var(--ps-text-muted)] tabular-nums">
                        <Clock className="h-3 w-3" />
                        {new Date(intent.created_at).toLocaleString('en-IN', {
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-[var(--ps-text-muted)]">
                      <span className="font-semibold text-[var(--ps-text)]">
                        {intent.customer_name}
                      </span>
                      {intent.customer_phone && (
                        <a
                          href={`tel:${intent.customer_phone}`}
                          className="inline-flex items-center gap-1 font-mono text-[var(--ps-accent)] hover:underline"
                        >
                          <Phone className="h-3 w-3" />
                          {intent.customer_phone}
                        </a>
                      )}
                      {intent.customer_email && (
                        <span className="truncate">{intent.customer_email}</span>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="text-[var(--ps-text-muted)]">
                        UTR:{' '}
                        <strong className="font-mono text-[var(--ps-text)]">
                          {intent.upi_utr_ref || 'Not submitted yet'}
                        </strong>
                      </span>

                      {resolvedProof && (
                        <button
                          type="button"
                          onClick={() => setPreviewProofUrl(resolvedProof)}
                          className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--ps-accent)] hover:underline"
                        >
                          <ImageIcon className="h-3 w-3" />
                          <span>View Receipt</span>
                        </button>
                      )}

                      {intent.refund_utr_ref && (
                        <span className="font-mono text-[11px] text-indigo-600 dark:text-indigo-400">
                          Refund UTR: {intent.refund_utr_ref}
                        </span>
                      )}
                      {intent.refund_notes && (
                        <span className="text-[11px] text-[var(--ps-text-muted)]">
                          Note: {intent.refund_notes}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Right: Amount + 1-Click Actions */}
                  <div className="flex flex-wrap items-center justify-between sm:flex-col sm:items-end gap-2 shrink-0">
                    <span className="font-mono text-base font-extrabold tabular-nums text-[var(--ps-text)]">
                      ₹{intent.amount_inr.toLocaleString('en-IN')}
                    </span>

                    <div className="flex flex-wrap items-center gap-1.5">
                      {(intent.status === 'pending_manual' ||
                        intent.status === 'awaiting_payment') && (
                        <>
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleApproveAndFulfill(intent)}
                            data-testid={`payment-approve-btn-${intent.intent_code}`}
                            className="inline-flex h-8 items-center gap-1 rounded-lg bg-emerald-600 px-3 text-[11px] font-bold text-white hover:bg-emerald-700 disabled:opacity-50 whitespace-nowrap"
                          >
                            {isBusy ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <CheckCircle2 className="h-3.5 w-3.5" />
                            )}
                            <span>Approve &amp; Fulfill</span>
                          </button>

                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => {
                              setRefundingId(null);
                              setRejectingId(
                                rejectingId === intent.id ? null : intent.id
                              );
                              setRejectReason('');
                            }}
                            data-testid={`payment-reject-toggle-${intent.intent_code}`}
                            className="inline-flex h-8 items-center gap-1 rounded-lg border border-rose-500/35 bg-rose-500/10 px-2.5 text-[11px] font-bold text-rose-700 dark:text-rose-300 hover:bg-rose-500/20 disabled:opacity-50 whitespace-nowrap"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                            <span>Reject</span>
                          </button>
                        </>
                      )}

                      {intent.status === 'succeeded' && (
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => {
                            setRejectingId(null);
                            setRefundingId(
                              refundingId === intent.id ? null : intent.id
                            );
                            setRefundUtr('');
                            setRefundNotes('');
                          }}
                          data-testid={`payment-refund-toggle-${intent.intent_code}`}
                          className="inline-flex h-8 items-center gap-1 rounded-lg border border-indigo-500/35 bg-indigo-500/10 px-2.5 text-[11px] font-bold text-indigo-700 dark:text-indigo-300 hover:bg-indigo-500/20 disabled:opacity-50 whitespace-nowrap"
                        >
                          <RotateCcw className="h-3.5 w-3.5" />
                          <span>Mark Refunded</span>
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {/* Inline Reject Form */}
                {rejectingId === intent.id && (
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 border-t border-[var(--ps-border)] pt-2.5">
                    <input
                      type="text"
                      value={rejectReason}
                      onChange={(e) => setRejectReason(e.target.value)}
                      placeholder="Rejection reason (e.g. UTR not found in bank statement)"
                      className="h-8 flex-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 text-xs text-[var(--ps-text)]"
                    />
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleRejectIntent(intent)}
                        className="inline-flex h-8 items-center gap-1 rounded-lg bg-rose-600 px-3 text-xs font-bold text-white hover:bg-rose-700 disabled:opacity-50"
                      >
                        Confirm Reject
                      </button>
                      <button
                        type="button"
                        onClick={() => setRejectingId(null)}
                        className="inline-flex h-8 items-center rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 text-xs font-semibold text-[var(--ps-text-muted)]"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}

                {/* Inline Refund Form */}
                {refundingId === intent.id && (
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 border-t border-[var(--ps-border)] pt-2.5">
                    <input
                      type="text"
                      value={refundUtr}
                      onChange={(e) => setRefundUtr(e.target.value)}
                      placeholder="Outgoing Refund UTR *"
                      className="h-8 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 font-mono text-xs text-[var(--ps-text)]"
                    />
                    <input
                      type="text"
                      value={refundNotes}
                      onChange={(e) => setRefundNotes(e.target.value)}
                      placeholder="Refund notes (optional)"
                      className="h-8 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 text-xs text-[var(--ps-text)]"
                    />
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        disabled={isBusy || refundUtr.trim().length < 4}
                        onClick={() => void handleMarkRefunded(intent)}
                        className="inline-flex h-8 flex-1 items-center justify-center gap-1 rounded-lg bg-indigo-600 px-3 text-xs font-bold text-white hover:bg-indigo-700 disabled:opacity-50"
                      >
                        {isBusy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RotateCcw className="h-3.5 w-3.5" />
                        )}
                        <span>Record Refund</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setRefundingId(null)}
                        className="inline-flex h-8 items-center rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 text-xs font-semibold text-[var(--ps-text-muted)]"
                      >
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </article>
            );
          })}
        </div>
        </ResponsiveTableScroll>
      )}

      {/* Payment Proof Lightbox */}
      {previewProofUrl && (
        <div
          onClick={() => setPreviewProofUrl(null)}
          className="fixed inset-0 z-[95] flex items-center justify-center bg-black/75 p-4"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg overflow-hidden rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-[var(--ps-border)] px-4 py-2.5">
              <span className="text-xs font-bold text-[var(--ps-text)]">
                Uploaded UPI Payment Receipt
              </span>
              <div className="flex items-center gap-2">
                <a
                  href={previewProofUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--ps-accent)] hover:underline"
                >
                  <ExternalLink className="h-3 w-3" />
                  <span>Open</span>
                </a>
                <button
                  type="button"
                  onClick={() => setPreviewProofUrl(null)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            </div>
            <div className="bg-black/40 p-3 flex items-center justify-center">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={previewProofUrl}
                alt="UPI payment receipt screenshot"
                referrerPolicy="no-referrer"
                className="max-h-[70vh] w-auto rounded-lg object-contain"
              />
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

export default UnifiedPaymentsQueue;
