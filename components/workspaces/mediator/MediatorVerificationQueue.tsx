'use client';

import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Car,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  ExternalLink,
  Package,
  RefreshCw,
  Search,
  ShieldCheck,
  XCircle,
} from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/ConfirmDialog';
import { FormModal } from '@/components/ui/FormModal';
import {
  computeUpiSlaStatus,
  formatFleetClassLabel,
  type MediatorDomainFilter,
  type MediatorPaymentQueueItem,
} from '@/lib/mediator/types';

export interface MediatorVerificationQueueProps {
  items: MediatorPaymentQueueItem[];
  isLoading: boolean;
  nowMs: number;
  busyId: string | null;
  onRefresh: () => void;
  onVerifyPayment: (item: MediatorPaymentQueueItem) => Promise<void>;
  onRejectPayment: (
    item: MediatorPaymentQueueItem,
    reason: string
  ) => Promise<void>;
}

export function MediatorVerificationQueue({
  items,
  isLoading,
  nowMs,
  busyId,
  onRefresh,
  onVerifyPayment,
  onRejectPayment,
}: MediatorVerificationQueueProps) {
  const [domainFilter, setDomainFilter] =
    useState<MediatorDomainFilter>('all');
  const [slaFilter, setSlaFilter] = useState<'all' | 'overdue'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [copiedUtrKey, setCopiedUtrKey] = useState<string | null>(null);

  // Confirm Verify modal state
  const [verifyTarget, setVerifyTarget] =
    useState<MediatorPaymentQueueItem | null>(null);

  // Reject FormModal state (field validation on touch/input, full validation on submit)
  const [rejectTarget, setRejectTarget] =
    useState<MediatorPaymentQueueItem | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectTouched, setRejectTouched] = useState(false);
  const [rejectSubmitAttempted, setRejectSubmitAttempted] = useState(false);

  const enrichedItems = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return items
      .map((item) => ({
        item,
        sla: computeUpiSlaStatus(item.submittedAt, nowMs),
      }))
      .filter(({ item, sla }) => {
        if (domainFilter !== 'all' && item.domain !== domainFilter) return false;
        if (slaFilter === 'overdue' && !sla.isOverdue) return false;
        if (!q) return true;
        return (
          item.code.toLowerCase().includes(q) ||
          (item.utrRef || '').toLowerCase().includes(q) ||
          item.customerName.toLowerCase().includes(q) ||
          item.customerPhone.toLowerCase().includes(q) ||
          item.routeSummary.toLowerCase().includes(q)
        );
      })
      .sort((a, b) => b.sla.elapsedSeconds - a.sla.elapsedSeconds);
  }, [items, nowMs, domainFilter, slaFilter, searchQuery]);

  const overdueTotal = useMemo(
    () =>
      items.filter((it) => computeUpiSlaStatus(it.submittedAt, nowMs).isOverdue)
        .length,
    [items, nowMs]
  );

  const handleCopyUtr = (key: string, utr: string) => {
    if (typeof navigator !== 'undefined' && navigator.clipboard) {
      void navigator.clipboard.writeText(utr);
    }
    setCopiedUtrKey(key);
    window.setTimeout(() => {
      setCopiedUtrKey((prev) => (prev === key ? null : prev));
    }, 1800);
  };

  const openRejectModal = (item: MediatorPaymentQueueItem) => {
    setRejectTarget(item);
    setRejectReason('');
    setRejectTouched(false);
    setRejectSubmitAttempted(false);
  };

  const closeRejectModal = () => {
    setRejectTarget(null);
    setRejectReason('');
    setRejectTouched(false);
    setRejectSubmitAttempted(false);
  };

  const trimmedReason = rejectReason.trim();
  const rejectFieldError =
    trimmedReason.length === 0
      ? 'A rejection reason is required.'
      : trimmedReason.length < 5
        ? 'Provide at least 5 characters explaining why this UTR was rejected.'
        : null;
  const isRejectValid = rejectFieldError === null;

  return (
    <div className="space-y-4">
      {/* Header & Controls */}
      <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-bold tracking-tight text-[var(--ps-text)]">
              UPI Verification Queue
            </h2>
            <p className="mt-0.5 text-xs text-[var(--ps-text-muted)]">
              Cross-check submitted 12-digit UTR references against bank/UPI
              settlements before funding escrow. Target SLA: under 10 minutes.
            </p>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors cursor-pointer"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Refresh Queue</span>
          </button>
        </div>

        {/* Filter Bar */}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { id: 'all', label: `All (${items.length})` },
                {
                  id: 'pick_n_drop',
                  label: `Pick N Drop (${items.filter((i) => i.domain === 'pick_n_drop').length})`,
                },
                {
                  id: 'vehicle_booking',
                  label: `Vehicles (${items.filter((i) => i.domain === 'vehicle_booking').length})`,
                },
              ] as Array<{ id: MediatorDomainFilter; label: string }>
            ).map((opt) => {
              const active = domainFilter === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setDomainFilter(opt.id)}
                  className={`inline-flex min-h-[44px] items-center rounded-xl border px-3 text-xs font-semibold transition-colors cursor-pointer ${
                    active
                      ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                      : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}

            <button
              type="button"
              onClick={() =>
                setSlaFilter((prev) => (prev === 'all' ? 'overdue' : 'all'))
              }
              className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition-colors cursor-pointer ${
                slaFilter === 'overdue'
                  ? 'border-rose-500 bg-rose-600 text-white'
                  : overdueTotal > 0
                    ? 'border-rose-500/40 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                    : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)]'
              }`}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>Overdue &gt;10m ({overdueTotal})</span>
            </button>
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ps-text-muted)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search UTR, code, phone..."
              aria-label="Search pending UPI verifications"
              className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] pl-9 pr-3 text-xs text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-ring)]"
            />
          </div>
        </div>
      </div>

      {/* Loading Shimmer */}
      {isLoading ? (
        <div className="space-y-3">
          {[1, 2, 3].map((idx) => (
            <div
              key={idx}
              className="dd-shimmer h-36 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)]"
            />
          ))}
        </div>
      ) : enrichedItems.length === 0 ? (
        <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-8 text-center">
          <ShieldCheck className="mx-auto h-9 w-9 text-emerald-600 dark:text-emerald-400" />
          <h3 className="mt-3 text-sm font-bold text-[var(--ps-text)]">
            No Pending UPI Verifications
          </h3>
          <p className="mt-1 text-xs text-[var(--ps-text-muted)]">
            All Pick N Drop and Scheduled Vehicle manual UPI submissions matching
            your filters have been processed.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {enrichedItems.map(({ item, sla }) => {
            const amountMismatch =
              Math.abs(item.expectedAmountInr - item.submittedAmountInr) > 0.01;
            const isBusy = busyId === item.id;

            const slaClasses =
              sla.severity === 'urgent'
                ? 'border-rose-500/40 bg-rose-500/12 text-rose-700 dark:text-rose-300'
                : sla.severity === 'warning'
                  ? 'border-amber-500/40 bg-amber-500/12 text-amber-800 dark:text-amber-300'
                  : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300';

            return (
              <div
                key={`${item.domain}-${item.id}`}
                data-testid={`mediator-upi-card-${item.code}`}
                className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 sm:p-5 space-y-3.5"
              >
                {/* Top Row: Code + Domain + Live 10-Min SLA Timer */}
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-2 min-w-0">
                    <span className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 py-1 text-[11px] font-bold text-[var(--ps-text)]">
                      {item.domain === 'pick_n_drop' ? (
                        <Package className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
                      ) : (
                        <Car className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
                      )}
                      <span>
                        {item.domain === 'pick_n_drop'
                          ? 'Pick N Drop'
                          : 'Vehicle Booking'}
                      </span>
                    </span>
                    <span className="font-mono text-xs font-extrabold text-[var(--ps-text)]">
                      {item.code}
                    </span>
                    <span className="text-[11px] text-[var(--ps-text-muted)]">
                      · {formatFleetClassLabel(item.vehicleClassSlug)}
                    </span>
                  </div>

                  {/* Live 10-Min SLA Badge */}
                  <span
                    data-testid={`sla-badge-${sla.severity}`}
                    className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-mono text-[11px] font-bold ${slaClasses}`}
                  >
                    <Clock className="h-3.5 w-3.5 shrink-0" />
                    <span>
                      {sla.severity === 'urgent'
                        ? `SLA OVERDUE · ${sla.label}`
                        : sla.severity === 'warning'
                          ? `SLA WARNING · ${sla.label}`
                          : `SLA OK · ${sla.label}`}
                    </span>
                  </span>
                </div>

                {/* Middle Grid: UTR + Amounts + Customer/Route */}
                <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                  {/* UTR Reference */}
                  <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 space-y-1">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                      Submitted UTR Reference
                    </div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-sm font-extrabold tracking-wide text-[var(--ps-text)] break-all">
                        {item.utrRef || 'Not attached'}
                      </span>
                      {item.utrRef && (
                        <button
                          type="button"
                          onClick={() => handleCopyUtr(item.id, item.utrRef!)}
                          aria-label="Copy UTR reference"
                          className="inline-flex min-h-[36px] min-w-[36px] shrink-0 items-center justify-center rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
                        >
                          {copiedUtrKey === item.id ? (
                            <Check className="h-3.5 w-3.5 text-emerald-600" />
                          ) : (
                            <Copy className="h-3.5 w-3.5" />
                          )}
                        </button>
                      )}
                    </div>
                    {item.proofPath && (
                      <a
                        href={item.proofPath}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1 pt-1 text-[11px] font-semibold text-[var(--ps-accent)] hover:underline"
                      >
                        <span>View Receipt Screenshot</span>
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    )}
                  </div>

                  {/* Expected vs Submitted Amount */}
                  <div
                    className={`rounded-xl border p-3 space-y-1 ${
                      amountMismatch
                        ? 'border-rose-500/40 bg-rose-500/8'
                        : 'border-[var(--ps-border)] bg-[var(--ps-bg)]'
                    }`}
                  >
                    <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                      Expected vs. Submitted
                    </div>
                    <div className="flex items-baseline gap-2">
                      <span className="font-mono text-base font-extrabold text-[var(--ps-text)]">
                        ₹{item.submittedAmountInr.toLocaleString('en-IN')}
                      </span>
                      <span className="text-[11px] text-[var(--ps-text-muted)]">
                        / Expected ₹
                        {item.expectedAmountInr.toLocaleString('en-IN')}
                      </span>
                    </div>
                    {amountMismatch ? (
                      <p className="text-[11px] font-semibold text-rose-700 dark:text-rose-300">
                        Amount mismatch detected — verify bank statement before
                        approving.
                      </p>
                    ) : (
                      <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
                        Exact fare match
                      </p>
                    )}
                  </div>

                  {/* Customer & Route */}
                  <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 space-y-1">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                      Customer &amp; Route
                    </div>
                    <div className="text-xs font-bold text-[var(--ps-text)] truncate">
                      {item.customerName}
                      {item.customerPhone ? ` · ${item.customerPhone}` : ''}
                    </div>
                    <p className="text-[11px] text-[var(--ps-text-muted)] line-clamp-2">
                      {item.routeSummary}
                    </p>
                  </div>
                </div>

                {/* Action Row */}
                <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--ps-border)] pt-3">
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => openRejectModal(item)}
                    className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-rose-500/35 bg-rose-500/10 px-4 text-xs font-bold text-rose-700 hover:bg-rose-500/15 disabled:opacity-50 dark:text-rose-300 transition-colors cursor-pointer"
                  >
                    <XCircle className="h-4 w-4" />
                    <span>Reject Payment</span>
                  </button>
                  <button
                    type="button"
                    disabled={isBusy}
                    onClick={() => setVerifyTarget(item)}
                    className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-emerald-600 px-4 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50 transition-colors cursor-pointer"
                  >
                    <CheckCircle2 className="h-4 w-4" />
                    <span>Verify &amp; Fund Escrow</span>
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Verify & Fund Escrow Confirmation */}
      <ConfirmDialog
        isOpen={Boolean(verifyTarget)}
        title={`Verify UPI & Fund Escrow (${verifyTarget?.code || ''})?`}
        description="Confirm that the submitted UTR matches your settled UPI bank credit before moving this booking into funded escrow."
        caution="Funding escrow unlocks driver dispatch immediately and records an immutable entry in the Mediator audit log."
        impactSummary={
          verifyTarget
            ? [
                `Booking: ${verifyTarget.code} (${verifyTarget.domain === 'pick_n_drop' ? 'Pick N Drop' : 'Scheduled Vehicle'})`,
                `UTR Reference: ${verifyTarget.utrRef || 'Manual verification'}`,
                `Escrow Amount: ₹${verifyTarget.expectedAmountInr.toLocaleString('en-IN')}`,
              ]
            : undefined
        }
        confirmLabel="Verify & Fund Escrow"
        cancelLabel="Cancel"
        variant="info"
        loading={Boolean(verifyTarget && busyId === verifyTarget.id)}
        onConfirm={async () => {
          if (!verifyTarget) return;
          const target = verifyTarget;
          await onVerifyPayment(target);
          setVerifyTarget(null);
        }}
        onCancel={() => setVerifyTarget(null)}
      />

      {/* Reject Payment FormModal */}
      <FormModal
        isOpen={Boolean(rejectTarget)}
        title={`Reject UPI Payment (${rejectTarget?.code || ''})`}
        subtitle="Provide a clear reason so the customer knows why this UTR was declined."
        hints={[
          'Double-check the UTR digits against the UPI merchant settlement ledger before rejecting.',
          'Rejecting releases the duplicate-UTR lock on this failed entry so the customer can submit a corrected transaction ID.',
        ]}
        cautions={[
          'Rejected UPI payments are logged permanently to audit_logs and cannot be retroactively approved.',
        ]}
        isDirty={rejectReason.trim().length > 0}
        isValid={isRejectValid}
        validationSummary={
          rejectFieldError ? [rejectFieldError] : []
        }
        onSubmitAttempt={() => {
          setRejectTouched(true);
          setRejectSubmitAttempted(true);
        }}
        submitLabel="Reject Payment"
        confirmSubmitTitle="Confirm UPI Payment Rejection"
        confirmSubmitDescription={`Reject UTR "${rejectTarget?.utrRef || 'N/A'}" for ${rejectTarget?.code || ''}?`}
        confirmSubmitCaution="This marks the manual payment rejected and logs your reason to the immutable audit trail."
        confirmSubmitVariant="danger"
        isSubmitting={Boolean(rejectTarget && busyId === rejectTarget.id)}
        maxWidthClassName="max-w-lg"
        onSubmit={async () => {
          if (!rejectTarget || !isRejectValid) return;
          await onRejectPayment(rejectTarget, trimmedReason);
          closeRejectModal();
        }}
        onClose={closeRejectModal}
      >
        {rejectTarget && (
          <div className="space-y-4">
            <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 text-xs space-y-1">
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-[var(--ps-text-muted)]">
                  Booking Code
                </span>
                <span className="font-mono font-bold text-[var(--ps-text)]">
                  {rejectTarget.code}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-[var(--ps-text-muted)]">
                  Submitted UTR
                </span>
                <span className="font-mono font-bold text-[var(--ps-text)]">
                  {rejectTarget.utrRef || 'N/A'}
                </span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="font-semibold text-[var(--ps-text-muted)]">
                  Expected Fare
                </span>
                <span className="font-mono font-bold text-[var(--ps-text)]">
                  ₹{rejectTarget.expectedAmountInr.toLocaleString('en-IN')}
                </span>
              </div>
            </div>

            <div className="space-y-1.5">
              <label
                htmlFor="mediator-reject-reason"
                className="block text-xs font-bold text-[var(--ps-text)]"
              >
                Rejection Reason <span className="text-rose-600">*</span>
              </label>
              <textarea
                id="mediator-reject-reason"
                rows={3}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                onBlur={() => setRejectTouched(true)}
                placeholder="e.g., UTR not found in settlement statement, or credited amount ₹120 does not match required ₹180."
                className="w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 text-xs text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-ring)]"
              />
              {(rejectTouched || rejectSubmitAttempted) && rejectFieldError && (
                <p className="text-[11px] font-semibold text-rose-600 dark:text-rose-400">
                  {rejectFieldError}
                </p>
              )}
            </div>
          </div>
        )}
      </FormModal>
    </div>
  );
}

export default MediatorVerificationQueue;
