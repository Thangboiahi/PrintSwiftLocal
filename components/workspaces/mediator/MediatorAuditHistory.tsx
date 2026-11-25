'use client';

import React, { useMemo, useState } from 'react';
import {
  CheckCircle2,
  ClipboardList,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldAlert,
  Truck,
  XCircle,
} from 'lucide-react';
import type { MediatorAuditLogRow } from '@/lib/mediator/types';

export interface MediatorAuditHistoryProps {
  logs: MediatorAuditLogRow[];
  isLoading: boolean;
  onRefresh: () => void;
}

type AuditFilter = 'all' | 'verify' | 'reject' | 'dispatch' | 'escrow';

function getActionBadgeMeta(action: string) {
  const clean = action.toLowerCase();
  if (clean.includes('verify')) {
    return {
      label: 'UPI Verified',
      icon: CheckCircle2,
      classes:
        'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
    };
  }
  if (clean.includes('reject')) {
    return {
      label: 'UPI Rejected',
      icon: XCircle,
      classes:
        'border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300',
    };
  }
  if (clean.includes('dispatch') || clean.includes('reassign')) {
    return {
      label: clean.includes('reassign') ? 'Driver Reassigned' : 'Driver Dispatched',
      icon: Truck,
      classes:
        'border-[var(--ps-accent)]/35 bg-[var(--ps-accent)]/10 text-[var(--ps-accent)]',
    };
  }
  if (clean.includes('refund')) {
    return {
      label: 'Refund Approved',
      icon: RotateCcw,
      classes:
        'border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300',
    };
  }
  if (clean.includes('freeze') || clean.includes('dispute')) {
    return {
      label: 'Dispute Frozen',
      icon: ShieldAlert,
      classes:
        'border-amber-500/35 bg-amber-500/10 text-amber-800 dark:text-amber-200',
    };
  }
  return {
    label: action.replace(/_/g, ' '),
    icon: ClipboardList,
    classes:
      'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)]',
  };
}

export function MediatorAuditHistory({
  logs,
  isLoading,
  onRefresh,
}: MediatorAuditHistoryProps) {
  const [filter, setFilter] = useState<AuditFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');

  const filteredLogs = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return logs.filter((row) => {
      const act = row.action.toLowerCase();
      if (filter === 'verify' && !act.includes('verify')) return false;
      if (filter === 'reject' && !act.includes('reject')) return false;
      if (
        filter === 'dispatch' &&
        !act.includes('dispatch') &&
        !act.includes('reassign')
      ) {
        return false;
      }
      if (
        filter === 'escrow' &&
        !act.includes('release') &&
        !act.includes('freeze') &&
        !act.includes('refund')
      ) {
        return false;
      }
      if (!q) return true;
      return (
        row.action.toLowerCase().includes(q) ||
        (row.target_name || '').toLowerCase().includes(q) ||
        (row.details || '').toLowerCase().includes(q) ||
        (row.target_id || '').toLowerCase().includes(q)
      );
    });
  }, [logs, filter, searchQuery]);

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 sm:p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-base font-bold tracking-tight text-[var(--ps-text)]">
              Mediator Audit History
            </h2>
            <p className="mt-0.5 text-xs text-[var(--ps-text-muted)]">
              Read-only immutable ledger of your UPI verifications, driver
              dispatches, dispute freezes, and escrow settlements.
            </p>
          </div>
          <button
            type="button"
            onClick={onRefresh}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors cursor-pointer"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            <span>Refresh Feed</span>
          </button>
        </div>

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { id: 'all', label: `All (${logs.length})` },
                { id: 'verify', label: 'Verified' },
                { id: 'reject', label: 'Rejected' },
                { id: 'dispatch', label: 'Dispatch' },
                { id: 'escrow', label: 'Escrow / Disputes' },
              ] as Array<{ id: AuditFilter; label: string }>
            ).map((opt) => (
              <button
                key={opt.id}
                type="button"
                onClick={() => setFilter(opt.id)}
                className={`inline-flex min-h-[44px] items-center rounded-xl border px-3 text-xs font-semibold transition-colors cursor-pointer ${
                  filter === opt.id
                    ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                    : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>

          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ps-text-muted)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter by code or notes..."
              aria-label="Search mediator audit logs"
              className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] pl-9 pr-3 text-xs text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-ring)]"
            />
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-2.5">
          {[1, 2, 3, 4].map((idx) => (
            <div
              key={idx}
              className="dd-shimmer h-20 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)]"
            />
          ))}
        </div>
      ) : filteredLogs.length === 0 ? (
        <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-8 text-center">
          <ClipboardList className="mx-auto h-9 w-9 text-[var(--ps-text-muted)]" />
          <h3 className="mt-3 text-sm font-bold text-[var(--ps-text)]">
            No Audit Entries Yet
          </h3>
          <p className="mt-1 text-xs text-[var(--ps-text-muted)]">
            Your UPI verifications, dispatches, and escrow decisions will appear
            here automatically.
          </p>
        </div>
      ) : (
        <div className="space-y-2.5">
          {filteredLogs.map((row) => {
            const meta = getActionBadgeMeta(row.action);
            const Icon = meta.icon;
            return (
              <div
                key={row.id}
                className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={`inline-flex items-center gap-1 rounded-lg border px-2 py-0.5 text-[11px] font-bold ${meta.classes}`}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      <span>{meta.label}</span>
                    </span>
                    {row.target_name && (
                      <span className="font-mono text-xs font-bold text-[var(--ps-text)]">
                        {row.target_name}
                      </span>
                    )}
                    {row.target_table && (
                      <span className="text-[10px] font-mono text-[var(--ps-text-muted)]">
                        {row.target_table}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[var(--ps-text)]">
                    {row.details || 'Action recorded in mediator audit ledger.'}
                  </p>
                </div>

                <div className="shrink-0 text-left sm:text-right text-[11px] font-mono text-[var(--ps-text-muted)]">
                  <div>
                    {new Date(row.created_at).toLocaleString('en-IN', {
                      day: '2-digit',
                      month: 'short',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </div>
                  {row.actor_role && (
                    <div className="text-[10px] uppercase">
                      {row.actor_role}
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default MediatorAuditHistory;
