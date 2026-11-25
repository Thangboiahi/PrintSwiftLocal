'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Activity,
  AlertCircle,
  ChevronDown,
  ChevronRight,
  Lock,
  RefreshCw,
  Search,
  Shield,
  X,
} from 'lucide-react';
import { ResponsiveTableScroll } from '@/components/ui/ResponsiveTableWrapper';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';

export interface AuditLogRow {
  id: string;
  actor_id: string | null;
  actor_role: string | null;
  action: string;
  target_table: string | null;
  target_id: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
}

export interface AuditLogsViewerProps {
  className?: string;
}

function formatAuditTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString('en-IN', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    });
  } catch {
    return iso;
  }
}

export function AuditLogsViewer({ className = '' }: AuditLogsViewerProps) {
  const [logs, setLogs] = useState<AuditLogRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [tableFilter, setTableFilter] = useState<string>('all');
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const loadLogs = useCallback(async (silent = false) => {
    if (!isSupabaseConfigured()) {
      setIsLoading(false);
      setErrorMsg('Supabase is not configured in this environment.');
      return;
    }

    if (!silent) setIsLoading(true);
    else setIsRefreshing(true);
    setErrorMsg(null);

    try {
      const { data, error } = await supabase
        .from('audit_logs')
        .select(
          'id, actor_id, actor_role, action, target_table, target_id, metadata, created_at'
        )
        .order('created_at', { ascending: false })
        .limit(150);

      if (error) {
        throw new Error(error.message);
      }

      setLogs((data || []) as AuditLogRow[]);
    } catch (err) {
      setErrorMsg(
        err instanceof Error
          ? err.message
          : 'Failed to load immutable audit logs.'
      );
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void loadLogs(false);
    });
  }, [loadLogs]);

  const availableTables = useMemo(() => {
    const set = new Set<string>();
    for (const row of logs) {
      if (row.target_table) set.add(row.target_table);
    }
    return Array.from(set).sort();
  }, [logs]);

  const filteredLogs = useMemo(() => {
    const q = search.trim().toLowerCase();
    return logs.filter((row) => {
      if (tableFilter !== 'all' && row.target_table !== tableFilter) {
        return false;
      }
      if (!q) return true;
      const metaStr = row.metadata ? JSON.stringify(row.metadata).toLowerCase() : '';
      return (
        row.action.toLowerCase().includes(q) ||
        (row.target_table || '').toLowerCase().includes(q) ||
        (row.target_id || '').toLowerCase().includes(q) ||
        (row.actor_role || '').toLowerCase().includes(q) ||
        (row.actor_id || '').toLowerCase().includes(q) ||
        metaStr.includes(q)
      );
    });
  }, [logs, search, tableFilter]);

  return (
    <section
      data-testid="superadmin-audit-logs-viewer"
      className={`space-y-4 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 sm:p-5 ${className}`}
    >
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--ps-border)] pb-3.5">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <Activity className="h-4 w-4 text-[var(--ps-accent)] shrink-0" />
            <h2 className="text-sm font-bold text-[var(--ps-text)]">
              Immutable Platform Audit Log
            </h2>
            <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">
              <Lock className="h-2.5 w-2.5" />
              Append-Only · RLS Enforced
            </span>
          </div>
          <p className="text-xs text-[var(--ps-text-muted)]">
            Live feed from <code className="font-mono">public.audit_logs</code>. Readable only by{' '}
            <code className="font-mono">admin</code> and <code className="font-mono">super_admin</code>; writes occur strictly via database triggers and{' '}
            <code className="font-mono">SECURITY DEFINER</code> RPCs with zero update/delete policies.
          </p>
        </div>

        <button
          type="button"
          onClick={() => void loadLogs(true)}
          disabled={isLoading || isRefreshing}
          className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] disabled:opacity-55 cursor-pointer"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`}
          />
          <span>Refresh</span>
        </button>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative flex-1 max-w-md">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ps-text-muted)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search action, table, actor, target ID, or metadata…"
            className="h-11 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] pl-9 pr-9 text-xs text-[var(--ps-text)] outline-none focus:border-[var(--ps-accent)]"
          />
          {search && (
            <button
              type="button"
              onClick={() => setSearch('')}
              aria-label="Clear audit search"
              className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-[var(--ps-text-muted)] hover:bg-[var(--ps-surface-alt)]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
          <button
            type="button"
            onClick={() => setTableFilter('all')}
            className={`inline-flex min-h-[44px] shrink-0 items-center rounded-xl px-3 text-xs font-semibold transition cursor-pointer ${
              tableFilter === 'all'
                ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                : 'border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
            }`}
          >
            All Tables ({logs.length})
          </button>
          {availableTables.map((tbl) => (
            <button
              key={tbl}
              type="button"
              onClick={() => setTableFilter(tbl)}
              className={`inline-flex min-h-[44px] shrink-0 items-center rounded-xl px-3 font-mono text-[11px] font-semibold transition cursor-pointer ${
                tableFilter === tbl
                  ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                  : 'border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
              }`}
            >
              {tbl}
            </button>
          ))}
        </div>
      </div>

      {/* Error State */}
      {errorMsg && (
        <div className="flex items-start gap-2.5 rounded-xl border border-rose-500/35 bg-rose-500/10 p-3.5 text-xs text-rose-700 dark:text-rose-300">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div className="min-w-0">
            <p className="font-semibold">Unable to load audit logs</p>
            <p className="mt-0.5 opacity-90">{errorMsg}</p>
          </div>
        </div>
      )}

      {/* Loading Skeleton */}
      {isLoading ? (
        <div className="space-y-2.5" aria-busy="true" aria-label="Loading audit logs">
          {[1, 2, 3, 4, 5].map((n) => (
            <div
              key={n}
              className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 space-y-2"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="dd-shimmer h-3.5 w-36 rounded-md" />
                <div className="dd-shimmer h-3 w-28 rounded-md" />
              </div>
              <div className="dd-shimmer h-3 w-52 rounded-md" />
            </div>
          ))}
        </div>
      ) : filteredLogs.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-bg)] p-8 text-center">
          <Shield className="mx-auto h-6 w-6 text-[var(--ps-text-muted)] opacity-60" />
          <p className="mt-2 text-xs font-semibold text-[var(--ps-text)]">
            {logs.length === 0
              ? 'No audit events recorded yet'
              : 'No audit events match your current filters'}
          </p>
          <p className="mt-1 text-[11px] text-[var(--ps-text-muted)]">
            {logs.length === 0
              ? 'Role updates, category edits, partner approvals, and homepage config changes will appear here automatically once migration v15a is applied.'
              : 'Try clearing the search input or switching the table filter back to All Tables.'}
          </p>
        </div>
      ) : (
        <>
          {/* Mobile stacked audit cards */}
          <div className="space-y-2.5 md:hidden">
            {filteredLogs.map((row) => {
              const isExpanded = expandedId === row.id;
              const hasMeta =
                row.metadata && Object.keys(row.metadata).length > 0;
              return (
                <div
                  key={row.id}
                  className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3.5 space-y-2 text-xs"
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className="inline-flex items-center rounded-md border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2 py-0.5 font-mono text-[11px] font-semibold text-[var(--ps-text)]">
                      {row.action}
                    </span>
                    <span className="font-mono text-[10px] tabular-nums text-[var(--ps-text-muted)]">
                      {formatAuditTimestamp(row.created_at)}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2 text-[11px]">
                    <span className="rounded bg-[var(--ps-surface-alt)] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--ps-text)]">
                      {row.actor_role || 'system'}
                    </span>
                    <span className="font-mono text-[var(--ps-text)]">
                      {row.target_table || '—'}
                    </span>
                    {row.target_id && (
                      <span className="font-mono text-[10px] text-[var(--ps-text-muted)]">
                        #{row.target_id.slice(0, 12)}
                      </span>
                    )}
                  </div>
                  {hasMeta && (
                    <button
                      type="button"
                      onClick={() => setExpandedId(isExpanded ? null : row.id)}
                      className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 text-xs font-semibold text-[var(--ps-text)] cursor-pointer"
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                      <span>{isExpanded ? 'Hide JSON Metadata' : 'Inspect JSON Metadata'}</span>
                    </button>
                  )}
                  {isExpanded && hasMeta && (
                    <pre className="max-h-56 overflow-auto rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3 font-mono text-[11px] text-[var(--ps-text)]">
                      {JSON.stringify(row.metadata, null, 2)}
                    </pre>
                  )}
                </div>
              );
            })}
          </div>

          <div className="hidden md:block">
            <ResponsiveTableScroll
              minWidthClass="min-w-[740px]"
              swipeHintLabel="Swipe ↔ to inspect audit metadata"
            >
          <table className="w-full border-collapse text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--ps-border)] bg-[var(--ps-bg)] text-[11px] font-semibold uppercase tracking-wide text-[var(--ps-text-muted)]">
                <th className="py-2.5 px-3 whitespace-nowrap">Timestamp</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Action</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Actor</th>
                <th className="py-2.5 px-3 whitespace-nowrap">Target</th>
                <th className="py-2.5 px-3 whitespace-nowrap text-right">
                  Metadata
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--ps-border)]">
              {filteredLogs.map((row) => {
                const isExpanded = expandedId === row.id;
                const hasMeta =
                  row.metadata && Object.keys(row.metadata).length > 0;
                return (
                  <React.Fragment key={row.id}>
                    <tr className="hover:bg-[var(--ps-surface-alt)]/40 transition-colors">
                      <td className="py-2.5 px-3 font-mono text-[11px] tabular-nums text-[var(--ps-text-muted)] whitespace-nowrap">
                        {formatAuditTimestamp(row.created_at)}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span className="inline-flex items-center rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-0.5 font-mono text-[11px] font-semibold text-[var(--ps-text)]">
                          {row.action}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <div className="flex items-center gap-1.5">
                          <span className="rounded bg-[var(--ps-surface-alt)] px-1.5 py-0.5 text-[10px] font-semibold uppercase text-[var(--ps-text)]">
                            {row.actor_role || 'system'}
                          </span>
                          {row.actor_id && (
                            <span className="font-mono text-[10px] text-[var(--ps-text-muted)]">
                              {row.actor_id.slice(0, 8)}…
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span className="font-mono text-[11px] font-semibold text-[var(--ps-text)]">
                          {row.target_table || '—'}
                        </span>
                        {row.target_id && (
                          <span className="ml-1.5 font-mono text-[10px] text-[var(--ps-text-muted)]">
                            #{row.target_id.slice(0, 12)}
                            {row.target_id.length > 12 ? '…' : ''}
                          </span>
                        )}
                      </td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap">
                        {hasMeta ? (
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedId(isExpanded ? null : row.id)
                            }
                            className="inline-flex min-h-[44px] items-center gap-1 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] cursor-pointer"
                          >
                            {isExpanded ? (
                              <ChevronDown className="h-3.5 w-3.5" />
                            ) : (
                              <ChevronRight className="h-3.5 w-3.5" />
                            )}
                            <span>JSON</span>
                          </button>
                        ) : (
                          <span className="text-[11px] text-[var(--ps-text-muted)]">
                            —
                          </span>
                        )}
                      </td>
                    </tr>
                    {isExpanded && hasMeta && (
                      <tr className="bg-[var(--ps-bg)]/70">
                        <td colSpan={5} className="px-4 py-3">
                          <pre className="max-h-56 overflow-auto rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3 font-mono text-[11px] text-[var(--ps-text)]">
                            {JSON.stringify(row.metadata, null, 2)}
                          </pre>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
            </ResponsiveTableScroll>
          </div>
        </>
      )}
    </section>
  );
}

export default AuditLogsViewer;
