'use client';

import React, { useMemo, useState } from 'react';
import {
  AlertTriangle,
  CheckCircle2,
  Clock,
  IndianRupee,
  RefreshCw,
  RotateCcw,
  Wallet,
} from 'lucide-react';
import {
  formatInr,
  formatServiceModeLabel,
  type DriverPayoutSummary,
  type DriverPayoutTripRow,
} from '@/lib/driver/types';

export interface DriverPayoutsLedgerProps {
  summary: DriverPayoutSummary | null;
  loading: boolean;
  onRefresh: () => void;
}

type EscrowFilter = 'all' | 'escrow_held' | 'released' | 'disputed' | 'refunded';

function renderEscrowBadge(state: DriverPayoutTripRow['escrow_state']) {
  switch (state) {
    case 'released':
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/35 bg-emerald-500/12 px-2.5 py-0.5 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
          <CheckCircle2 className="h-3 w-3" />
          Released to Driver
        </span>
      );
    case 'disputed':
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-rose-500/35 bg-rose-500/12 px-2.5 py-0.5 text-[11px] font-bold text-rose-700 dark:text-rose-300">
          <AlertTriangle className="h-3 w-3" />
          In Dispute
        </span>
      );
    case 'refunded':
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 py-0.5 text-[11px] font-bold text-[var(--ps-text-muted)]">
          <RotateCcw className="h-3 w-3" />
          Refunded / Cancelled
        </span>
      );
    default:
      return (
        <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/35 bg-amber-500/12 px-2.5 py-0.5 text-[11px] font-bold text-amber-800 dark:text-amber-200">
          <Clock className="h-3 w-3" />
          Escrow Held
        </span>
      );
  }
}

export function DriverPayoutsLedger({
  summary,
  loading,
  onRefresh,
}: DriverPayoutsLedgerProps) {
  const [filter, setFilter] = useState<EscrowFilter>('all');

  const filteredTrips = useMemo(() => {
    const list = summary?.trips || [];
    if (filter === 'all') return list;
    return list.filter((t) => t.escrow_state === filter);
  }, [summary, filter]);

  if (loading) {
    return (
      <div className="space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[1, 2, 3].map((idx) => (
            <div
              key={idx}
              className="h-24 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] dd-shimmer"
            />
          ))}
        </div>
        <div className="h-64 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] dd-shimmer" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Ledger Header */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4">
        <div>
          <h2 className="text-base font-bold text-[var(--ps-text)]">
            Payouts &amp; Trip History Ledger
          </h2>
          <p className="text-xs text-[var(--ps-text-muted)]">
            Track escrow-held balances, mediator-released driver payouts, and disputed trips.
          </p>
        </div>
        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] cursor-pointer"
        >
          <RefreshCw className="h-3.5 w-3.5" />
          Refresh Ledger
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4">
          <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
            <span>Total Released</span>
            <IndianRupee className="h-4 w-4 text-emerald-500" />
          </div>
          <p className="mt-2 font-mono text-2xl font-extrabold text-emerald-600 dark:text-emerald-400">
            {formatInr(summary?.released_total_inr ?? 0)}
          </p>
          <p className="mt-0.5 text-[11px] text-[var(--ps-text-muted)]">
            Today: {formatInr(summary?.released_today_inr ?? 0)}
          </p>
        </div>

        <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4">
          <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
            <span>Escrow Held</span>
            <Wallet className="h-4 w-4 text-amber-500" />
          </div>
          <p className="mt-2 font-mono text-2xl font-extrabold text-amber-600 dark:text-amber-400">
            {formatInr(summary?.escrow_held_inr ?? 0)}
          </p>
          <p className="mt-0.5 text-[11px] text-[var(--ps-text-muted)]">
            Released automatically after handover audit
          </p>
        </div>

        <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4">
          <div className="flex items-center justify-between text-[11px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
            <span>Completed / Disputed</span>
            <CheckCircle2 className="h-4 w-4 text-[var(--ps-accent)]" />
          </div>
          <p className="mt-2 font-mono text-2xl font-extrabold text-[var(--ps-text)]">
            {summary?.completed_trips_count ?? 0}{' '}
            <span className="text-sm font-semibold text-rose-500">
              / {summary?.disputed_count ?? 0}
            </span>
          </p>
          <p className="mt-0.5 text-[11px] text-[var(--ps-text-muted)]">
            Settled trips vs. active disputes
          </p>
        </div>
      </div>

      {/* Filter Row */}
      <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-1">
        {(
          [
            { id: 'all', label: 'All Trips' },
            { id: 'escrow_held', label: 'Escrow Held' },
            { id: 'released', label: 'Released to Driver' },
            { id: 'disputed', label: 'In Dispute' },
            { id: 'refunded', label: 'Refunded' },
          ] as const
        ).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setFilter(tab.id)}
            className={`inline-flex min-h-[44px] shrink-0 items-center rounded-xl border px-3.5 text-xs font-bold transition-colors cursor-pointer ${
              filter === tab.id
                ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                : 'border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Trip Ledger */}
      {filteredTrips.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-surface)] p-8 text-center">
          <p className="text-sm font-bold text-[var(--ps-text)]">
            No trips found in this filter
          </p>
          <p className="mt-1 text-xs text-[var(--ps-text-muted)]">
            Completed Pick N Drop deliveries and scheduled vehicle charters will appear here.
          </p>
        </div>
      ) : (
        <>
          {/* Mobile Stacked Cards */}
          <div className="space-y-3 lg:hidden">
            {filteredTrips.map((trip) => (
              <div
                key={`${trip.domain}-${trip.id}`}
                className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-2.5"
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <span className="font-mono text-sm font-extrabold text-[var(--ps-text)]">
                      {trip.code}
                    </span>
                    <p className="text-[11px] text-[var(--ps-text-muted)]">
                      {formatServiceModeLabel(trip.service_mode)} ·{' '}
                      {new Date(trip.updated_at).toLocaleDateString('en-IN', {
                        day: 'numeric',
                        month: 'short',
                      })}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-base font-extrabold text-[var(--ps-text)]">
                      {formatInr(trip.net_payout_inr)}
                    </p>
                    <p className="text-[10px] text-[var(--ps-text-muted)]">
                      Gross {formatInr(trip.gross_fare_inr)}
                    </p>
                  </div>
                </div>

                <p className="text-xs text-[var(--ps-text-muted)] line-clamp-2">
                  {trip.origin_label} → {trip.destination_label}
                </p>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                  {renderEscrowBadge(trip.escrow_state)}
                  {trip.dispute_reason && (
                    <span className="text-[11px] text-rose-600 dark:text-rose-400">
                      {trip.dispute_reason}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Desktop Table */}
          <div className="hidden lg:block overflow-hidden rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)]">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="border-b border-[var(--ps-border)] bg-[var(--ps-bg)] text-[11px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                  <tr>
                    <th className="px-4 py-3">Booking / Date</th>
                    <th className="px-4 py-3">Route</th>
                    <th className="px-4 py-3">Gross Fare</th>
                    <th className="px-4 py-3">Driver Payout</th>
                    <th className="px-4 py-3 text-right">Escrow Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--ps-border)]">
                  {filteredTrips.map((trip) => (
                    <tr
                      key={`${trip.domain}-${trip.id}`}
                      className="hover:bg-[var(--ps-bg)]/60"
                    >
                      <td className="px-4 py-3.5 align-top whitespace-nowrap">
                        <div className="font-mono font-bold text-[var(--ps-text)]">
                          {trip.code}
                        </div>
                        <div className="text-[11px] text-[var(--ps-text-muted)]">
                          {formatServiceModeLabel(trip.service_mode)} ·{' '}
                          {new Date(trip.updated_at).toLocaleDateString('en-IN', {
                            day: 'numeric',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </div>
                      </td>
                      <td className="px-4 py-3.5 align-top max-w-md">
                        <p className="text-[var(--ps-text)] truncate">
                          {trip.origin_label}
                        </p>
                        <p className="text-[11px] text-[var(--ps-text-muted)] truncate">
                          → {trip.destination_label}
                        </p>
                        {trip.dispute_reason && (
                          <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">
                            Note: {trip.dispute_reason}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3.5 align-top font-mono text-[var(--ps-text-muted)] whitespace-nowrap">
                        {formatInr(trip.gross_fare_inr)}
                      </td>
                      <td className="px-4 py-3.5 align-top font-mono font-extrabold text-[var(--ps-text)] whitespace-nowrap">
                        {formatInr(trip.net_payout_inr)}
                      </td>
                      <td className="px-4 py-3.5 align-top text-right whitespace-nowrap">
                        {renderEscrowBadge(trip.escrow_state)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

export default DriverPayoutsLedger;
