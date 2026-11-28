'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { useHydrated } from '@/hooks/useHydrated';
import {
  Archive,
  CheckCircle2,
  Database,
  Ghost,
  HardDrive,
  Loader2,
  RefreshCw,
  RotateCcw,
  ShieldAlert,
  Trash2,
  UserCheck,
  Users,
  X,
} from 'lucide-react';
import {
  ResponsiveTableScroll,
  WorkspaceTableToolbar,
} from '@/components/ui/ResponsiveTableWrapper';
import { setAppStatus } from '@/lib/hooks/useAppStatus';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';

type LooseEndsSubView = 'custody' | 'staff' | 'orphans' | 'media';

interface CustodyListingRow {
  id: string;
  title: string;
  locality: string;
  listing_vertical: string;
  lifecycle_status: string;
  owner_id: string | null;
}

interface SuspendedStaffRow {
  id: string;
  listing_id: string;
  staff_user_id: string;
  status: string;
  listingTitle: string;
  parentLifecycle: string;
}

interface MediaStatsBucket {
  status: string;
  count: number;
  bytes: number;
}

export function LooseEndsAndMediaTab({
  onJumpToSettlements,
}: {
  onJumpToSettlements?: () => void;
}) {
  const isHydrated = useHydrated();
  const [subView, setSubView] = useState<LooseEndsSubView>('custody');
  const [isLoading, setIsLoading] = useState(true);
  const [search, setSearch] = useState('');

  const [custodyListings, setCustodyListings] = useState<CustodyListingRow[]>(
    []
  );
  const [suspendedStaff, setSuspendedStaff] = useState<SuspendedStaffRow[]>([]);
  const [ghostProductCount, setGhostProductCount] = useState(0);
  const [stuckEscrowCount, setStuckEscrowCount] = useState(0);
  const [mediaBuckets, setMediaBuckets] = useState<MediaStatsBucket[]>([]);
  const [isPurgingMedia, setIsPurgingMedia] = useState(false);
  const [lastPurgeSummary, setLastPurgeSummary] = useState<string | null>(null);

  // Transfer Ownership Modal (z-[90])
  const [transferTarget, setTransferTarget] =
    useState<CustodyListingRow | null>(null);
  const [newOwnerId, setNewOwnerId] = useState('');
  const [reanchorStaff, setReanchorStaff] = useState(true);
  const [transferSubs, setTransferSubs] = useState(true);
  const [isTransferring, setIsTransferring] = useState(false);

  const loadAll = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const [custodyRes, staffRes, mediaRes, escrowRes] =
        await Promise.allSettled([
          supabase
            .from('listings')
            .select(
              'id, title, locality, listing_vertical, lifecycle_status, owner_id'
            )
            .or(
              'lifecycle_status.in.(draining,archived_by_owner,custody_admin),owner_id.is.null'
            )
            .order('updated_at', { ascending: false })
            .limit(80),
          supabase
            .from('listing_staff_assignments')
            .select(
              'id, listing_id, staff_user_id, status, listings(title, lifecycle_status)'
            )
            .neq('status', 'active')
            .limit(60),
          supabase
            .from('media_assets')
            .select('status, file_size_bytes')
            .limit(1000),
          supabase
            .from('merchant_settlements')
            .select('id, status, listings!inner(lifecycle_status)')
            .in('status', ['locked', 'eligible'])
            .neq('listings.lifecycle_status', 'active')
            .limit(50),
        ]);

      if (
        custodyRes.status === 'fulfilled' &&
        !custodyRes.value.error &&
        Array.isArray(custodyRes.value.data)
      ) {
        const list = (
          custodyRes.value.data as Array<Record<string, unknown>>
        ).map((r) => ({
          id: String(r.id || ''),
          title: String(r.title || 'Listing'),
          locality: String(r.locality || ''),
          listing_vertical: String(r.listing_vertical || 'general'),
          lifecycle_status: String(r.lifecycle_status || 'active'),
          owner_id: r.owner_id ? String(r.owner_id) : null,
        }));
        setCustodyListings(list);

        const archivedIds = list
          .filter((l) => l.lifecycle_status === 'archived_by_owner')
          .map((l) => l.id);
        if (archivedIds.length > 0) {
          const { count } = await supabase
            .from('marketplace_products')
            .select('id', { count: 'exact', head: true })
            .eq('is_active', true)
            .in('listing_id', archivedIds);
          setGhostProductCount(count || 0);
        } else {
          setGhostProductCount(0);
        }
      }

      if (
        staffRes.status === 'fulfilled' &&
        !staffRes.value.error &&
        Array.isArray(staffRes.value.data)
      ) {
        setSuspendedStaff(
          (staffRes.value.data as Array<Record<string, unknown>>).map((r) => {
            const joined = Array.isArray(r.listings)
              ? (r.listings[0] as Record<string, unknown> | undefined)
              : (r.listings as Record<string, unknown> | undefined);
            return {
              id: String(r.id || ''),
              listing_id: String(r.listing_id || ''),
              staff_user_id: String(r.staff_user_id || ''),
              status: String(r.status || 'suspended_parent_closed'),
              listingTitle: String(joined?.title || 'Closed Business'),
              parentLifecycle: String(joined?.lifecycle_status || 'archived'),
            };
          })
        );
      }

      if (
        mediaRes.status === 'fulfilled' &&
        !mediaRes.value.error &&
        Array.isArray(mediaRes.value.data)
      ) {
        const map = new Map<string, MediaStatsBucket>();
        for (const r of mediaRes.value.data as Array<Record<string, unknown>>) {
          const st = String(r.status || 'unknown');
          const cur = map.get(st) || { status: st, count: 0, bytes: 0 };
          cur.count += 1;
          cur.bytes += Number(r.file_size_bytes ?? 0);
          map.set(st, cur);
        }
        setMediaBuckets(Array.from(map.values()));
      }

      if (
        escrowRes.status === 'fulfilled' &&
        !escrowRes.value.error &&
        Array.isArray(escrowRes.value.data)
      ) {
        setStuckEscrowCount(escrowRes.value.data.length);
      }
    } catch {
      // Non-blocking
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const handleRestoreActive = async (listingId: string) => {
    setAppStatus('saving', 'Restoring listing to active…');
    const { error } = await supabase
      .from('listings')
      .update({ lifecycle_status: 'active', status: 'published' })
      .eq('id', listingId);
    if (error) {
      setAppStatus('error', error.message);
      return;
    }
    setAppStatus('success', 'Listing restored to active discovery.');
    void loadAll();
  };

  const handleForceArchive = async (listingId: string) => {
    setAppStatus('saving', 'Inspecting blockers & archiving…');
    const { data, error } = await supabase.rpc('archive_business_listing', {
      p_listing_id: listingId,
      p_reason: 'Super-Admin custody archive sweep',
    });
    if (error) {
      setAppStatus('error', error.message);
      return;
    }
    const nextSt =
      (data as { lifecycle_status?: string } | null)?.lifecycle_status ||
      'archived';
    setAppStatus('success', `Lifecycle updated: ${nextSt}`);
    void loadAll();
  };

  const handleConfirmTransfer = async () => {
    if (!transferTarget || !newOwnerId.trim()) return;
    setIsTransferring(true);
    setAppStatus('saving', 'Transferring business ownership…');
    try {
      const { error } = await supabase.rpc('transfer_business_ownership', {
        p_listing_id: transferTarget.id,
        p_new_owner_id: newOwnerId.trim(),
        p_reanchor_staff: reanchorStaff,
        p_transfer_subscriptions: transferSubs,
      });
      if (error) throw new Error(error.message);
      setAppStatus('success', 'Ownership transferred cleanly.');
      setTransferTarget(null);
      setNewOwnerId('');
      void loadAll();
    } catch (err) {
      setAppStatus(
        'error',
        err instanceof Error ? err.message : 'Transfer failed.'
      );
    } finally {
      setIsTransferring(false);
    }
  };

  const handleRevokeStaff = async (rowId: string) => {
    setAppStatus('saving', 'Revoking detached staff assignment…');
    const { error } = await supabase
      .from('listing_staff_assignments')
      .update({ status: 'revoked' })
      .eq('id', rowId);
    if (error) {
      setAppStatus('error', error.message);
      return;
    }
    setAppStatus('success', 'Staff assignment permanently revoked.');
    void loadAll();
  };

  const handleBulkDeactivateGhosts = async () => {
    const archivedIds = custodyListings
      .filter((l) => l.lifecycle_status === 'archived_by_owner')
      .map((l) => l.id);
    if (archivedIds.length === 0) return;
    setAppStatus('saving', 'Deactivating orphaned ghost products…');
    await Promise.allSettled([
      supabase
        .from('marketplace_products')
        .update({ is_active: false, in_stock: false })
        .in('listing_id', archivedIds),
      supabase
        .from('restaurant_menu_items')
        .update({ in_stock: false })
        .in('listing_id', archivedIds),
      supabase
        .from('listing_booking_resources')
        .update({ is_active: false })
        .in('listing_id', archivedIds),
    ]);
    setAppStatus('success', 'Orphaned ghost items deactivated.');
    void loadAll();
  };

  const handleRunMediaPurge = async () => {
    setIsPurgingMedia(true);
    setAppStatus('saving', 'Running zero-orphan media & TTL sweep…');
    try {
      const res = await fetch('/api/system/purge-media', { method: 'POST' });
      const body = await res.json();
      if (!res.ok) {
        throw new Error(body?.error || 'Purge failed');
      }
      const mb = ((Number(body.bytesReclaimed) || 0) / (1024 * 1024)).toFixed(
        2
      );
      const summary = `Purged ${body.purgedCount ?? 0} objects (${mb} MB reclaimed).`;
      setLastPurgeSummary(summary);
      setAppStatus('success', summary);
      void loadAll();
    } catch (err) {
      setAppStatus(
        'error',
        err instanceof Error ? err.message : 'Media purge failed.'
      );
    } finally {
      setIsPurgingMedia(false);
    }
  };

  const filteredCustody = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return custodyListings;
    return custodyListings.filter((l) =>
      `${l.title} ${l.locality} ${l.lifecycle_status}`.toLowerCase().includes(q)
    );
  }, [custodyListings, search]);

  return (
    <div
      data-testid="loose-ends-and-media-tab"
      className="space-y-4 text-xs"
    >
      {/* Top Sub-View Switcher */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              {
                id: 'custody',
                label: `Custody & Draining (${custodyListings.length})`,
                icon: Archive,
              },
              {
                id: 'staff',
                label: `Detached Staff (${suspendedStaff.length})`,
                icon: Users,
              },
              {
                id: 'orphans',
                label: `Ghosts & Escrows (${ghostProductCount + stuckEscrowCount})`,
                icon: Ghost,
              },
              { id: 'media', label: 'Zero-Orphan Media Sweeper', icon: HardDrive },
            ] as const
          ).map((t) => {
            const Icon = t.icon;
            const active = subView === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setSubView(t.id)}
                className={`h-8 px-3 rounded-xl font-bold inline-flex items-center gap-1.5 cursor-pointer ${
                  active
                    ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                    : 'bg-[var(--ps-surface)] text-[var(--ps-text-muted)] border border-[var(--ps-border)]'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{t.label}</span>
              </button>
            );
          })}
        </div>

        <button
          type="button"
          onClick={() => void loadAll()}
          className="h-8 px-2.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] font-semibold inline-flex items-center gap-1 cursor-pointer"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* 1. Custody, Draining & Archived Businesses */}
      {subView === 'custody' && (
        <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3">
          <WorkspaceTableToolbar
            searchQuery={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search draining, archived, or unowned listings…"
            hasActiveFilters={Boolean(search)}
            onResetFilters={() => setSearch('')}
          />

          <ResponsiveTableScroll>
            <table className="w-full text-left border-collapse min-w-[680px]">
              <thead>
                <tr className="border-b border-[var(--ps-border)] text-[10px] uppercase tracking-wider text-[var(--ps-text-muted)]">
                  <th className="py-2 px-3">Business</th>
                  <th className="py-2 px-3">Vertical</th>
                  <th className="py-2 px-3">Lifecycle</th>
                  <th className="py-2 px-3 text-right">Custody Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--ps-border)]/60">
                {filteredCustody.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="py-8 text-center text-[var(--ps-text-muted)]"
                    >
                      All clear — zero draining, archived, or unowned listings.
                    </td>
                  </tr>
                ) : (
                  filteredCustody.map((item) => (
                    <tr key={item.id}>
                      <td className="py-2.5 px-3">
                        <div className="font-bold text-[var(--ps-text)]">
                          {item.title}
                        </div>
                        <div className="text-[11px] text-[var(--ps-text-muted)]">
                          {item.locality}
                          {!item.owner_id ? ' · NO OWNER' : ''}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 capitalize text-[var(--ps-text-muted)]">
                        {item.listing_vertical.replace(/_/g, ' ')}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-amber-500/15 text-amber-700 dark:text-amber-300">
                          {item.lifecycle_status.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="inline-flex items-center gap-1.5">
                          <button
                            type="button"
                            onClick={() => setTransferTarget(item)}
                            className="h-7 px-2.5 rounded-lg bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] font-bold inline-flex items-center gap-1 cursor-pointer"
                          >
                            <UserCheck className="w-3 h-3" />
                            <span>Transfer</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleRestoreActive(item.id)}
                            className="h-7 px-2.5 rounded-lg border border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 font-semibold inline-flex items-center gap-1 cursor-pointer"
                          >
                            <RotateCcw className="w-3 h-3" />
                            <span>Restore</span>
                          </button>
                          <button
                            type="button"
                            onClick={() => void handleForceArchive(item.id)}
                            className="h-7 px-2.5 rounded-lg border border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300 font-semibold cursor-pointer"
                          >
                            Inspect / Archive
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </ResponsiveTableScroll>
        </section>
      )}

      {/* 2. Detached / Suspended Staff Queue */}
      {subView === 'staff' && (
        <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3">
          <ResponsiveTableScroll>
            <table className="w-full text-left border-collapse min-w-[600px]">
              <thead>
                <tr className="border-b border-[var(--ps-border)] text-[10px] uppercase tracking-wider text-[var(--ps-text-muted)]">
                  <th className="py-2 px-3">Staff User</th>
                  <th className="py-2 px-3">Parent Business</th>
                  <th className="py-2 px-3">Status</th>
                  <th className="py-2 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--ps-border)]/60">
                {suspendedStaff.length === 0 ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="py-8 text-center text-[var(--ps-text-muted)]"
                    >
                      No detached or suspended staff assignments.
                    </td>
                  </tr>
                ) : (
                  suspendedStaff.map((row) => (
                    <tr key={row.id}>
                      <td className="py-2.5 px-3 font-mono text-[11px]">
                        {row.staff_user_id}
                      </td>
                      <td className="py-2.5 px-3 font-semibold">
                        {row.listingTitle} ({row.parentLifecycle})
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-rose-500/12 text-rose-700 dark:text-rose-300">
                          {row.status.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => void handleRevokeStaff(row.id)}
                          className="h-7 px-2.5 rounded-lg border border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300 font-semibold cursor-pointer"
                        >
                          Permanently Revoke
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </ResponsiveTableScroll>
        </section>
      )}

      {/* 3. Orphaned Products & Stuck Escrows */}
      {subView === 'orphans' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3">
            <div className="flex items-center gap-2 font-bold text-sm text-[var(--ps-text)]">
              <Ghost className="w-4 h-4 text-amber-500" />
              <span>Orphaned Ghost Catalogue &amp; Menu Items</span>
            </div>
            <p className="text-[11px] text-[var(--ps-text-muted)]">
              Active products, dishes, or booking resources still attached to archived parent listings:{' '}
              <strong className="text-[var(--ps-text)]">{ghostProductCount}</strong>
            </p>
            <button
              type="button"
              disabled={ghostProductCount === 0}
              onClick={() => void handleBulkDeactivateGhosts()}
              className="h-9 px-4 rounded-xl bg-amber-600 text-white font-bold disabled:opacity-50 cursor-pointer"
            >
              Bulk Deactivate Ghosts
            </button>
          </div>

          <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3">
            <div className="flex items-center gap-2 font-bold text-sm text-[var(--ps-text)]">
              <ShieldAlert className="w-4 h-4 text-rose-500" />
              <span>Stuck Escrows on Draining / Archived Businesses</span>
            </div>
            <p className="text-[11px] text-[var(--ps-text-muted)]">
              Locked or eligible merchant settlements awaiting manual release/reversal:{' '}
              <strong className="text-[var(--ps-text)]">{stuckEscrowCount}</strong>
            </p>
            {onJumpToSettlements && (
              <button
                type="button"
                onClick={onJumpToSettlements}
                className="h-9 px-4 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] font-bold cursor-pointer"
              >
                Open Unified Settlements Queue →
              </button>
            )}
          </div>
        </div>
      )}

      {/* 4. Zero-Orphan Media Assets & Unified Sweeper */}
      {subView === 'media' && (
        <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-[var(--ps-text)] flex items-center gap-1.5">
                <Database className="w-4 h-4 text-[var(--ps-accent)]" />
                <span>Zero-Orphan Media Registry &amp; Unified TTL Sweeper</span>
              </h3>
              <p className="text-[11px] text-[var(--ps-text-muted)]">
                Sweeps abandoned 24h drafts, expired 48h print PDFs, 7d delivery PODs, and 14d archived media cleanly from Supabase Storage.
              </p>
            </div>
            <button
              type="button"
              disabled={isPurgingMedia}
              onClick={() => void handleRunMediaPurge()}
              data-testid="run-unified-media-purge-btn"
              className="h-9 px-4 rounded-xl bg-rose-600 hover:bg-rose-700 text-white font-bold inline-flex items-center gap-1.5 disabled:opacity-60 cursor-pointer"
            >
              {isPurgingMedia ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <Trash2 className="w-4 h-4" />
              )}
              <span>Run Media &amp; TTL Purge Now</span>
            </button>
          </div>

          {lastPurgeSummary && (
            <div className="rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-3.5 py-2.5 text-emerald-800 dark:text-emerald-200 font-semibold flex items-center gap-2">
              <CheckCircle2 className="w-4 h-4 shrink-0" />
              <span>{lastPurgeSummary}</span>
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
            {mediaBuckets.length === 0 ? (
              <div className="col-span-full py-6 text-center text-[var(--ps-text-muted)]">
                No tracked rows in <code className="font-mono">media_assets</code> yet.
              </div>
            ) : (
              mediaBuckets.map((b) => (
                <div
                  key={b.status}
                  className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 space-y-1"
                >
                  <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)] truncate">
                    {b.status.replace(/_/g, ' ')}
                  </div>
                  <div className="text-lg font-extrabold text-[var(--ps-text)] tabular-nums">
                    {b.count}
                  </div>
                  <div className="text-[10.5px] text-[var(--ps-text-muted)] tabular-nums">
                    {(b.bytes / (1024 * 1024)).toFixed(2)} MB
                  </div>
                </div>
              ))
            )}
          </div>
        </section>
      )}

      {/* Transfer Ownership Modal (z-[90]) */}
      {isHydrated &&
        transferTarget &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Transfer business ownership"
            data-testid="custody-transfer-modal"
            className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 backdrop-blur-xs p-4"
          >
            <div className="w-full max-w-md rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] shadow-2xl p-4 space-y-3 text-xs">
              <div className="flex items-center justify-between gap-2 border-b border-[var(--ps-border)] pb-2.5">
                <span className="font-bold text-sm text-[var(--ps-text)]">
                  Transfer Ownership: {transferTarget.title}
                </span>
                <button
                  type="button"
                  onClick={() => setTransferTarget(null)}
                  className="w-7 h-7 rounded-lg border border-[var(--ps-border)] flex items-center justify-center cursor-pointer"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="space-y-2.5">
                <div>
                  <label className="block text-[11px] font-semibold mb-1">
                    Target Owner User UUID
                  </label>
                  <input
                    type="text"
                    value={newOwnerId}
                    onChange={(e) => setNewOwnerId(e.target.value)}
                    placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                    className="w-full h-9 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] font-mono"
                  />
                </div>
                <label className="flex items-center gap-2 font-semibold cursor-pointer">
                  <input
                    type="checkbox"
                    checked={reanchorStaff}
                    onChange={(e) => setReanchorStaff(e.target.checked)}
                  />
                  <span>Re-anchor suspended staff to new owner</span>
                </label>
                <label className="flex items-center gap-2 font-semibold cursor-pointer">
                  <input
                    type="checkbox"
                    checked={transferSubs}
                    onChange={(e) => setTransferSubs(e.target.checked)}
                  />
                  <span>Transfer active listing subscriptions</span>
                </label>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setTransferTarget(null)}
                  className="h-9 px-3.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isTransferring || !newOwnerId.trim()}
                  onClick={() => void handleConfirmTransfer()}
                  className="h-9 px-4 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] font-bold inline-flex items-center gap-1.5 disabled:opacity-50 cursor-pointer"
                >
                  {isTransferring ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <UserCheck className="w-3.5 h-3.5" />
                  )}
                  <span>Confirm Transfer</span>
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

export default LooseEndsAndMediaTab;
