'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarPlus,
  Loader2,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  SlidersHorizontal,
  UserCheck,
  X,
} from 'lucide-react';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { useConfirmDialog } from '@/components/ui/ConfirmActionModal';
import {
  ENTITLEMENT_FEATURE_META,
  FREE_BASELINE_ENTITLEMENTS,
  mergeEntitlements,
  normalizePlanEntitlements,
  type EntitlementFeatureKey,
  type PlanEntitlements,
  type PlanEntitlementsOverride,
} from '@/lib/subscriptions/entitlements';

type SubscriptionStatus =
  | 'active'
  | 'suspended'
  | 'expired'
  | 'pending'
  | 'cancelled'
  | 'trialing'
  | 'paused'
  | 'pending_payment';

interface SubscriberRow {
  id: string;
  user_id: string;
  user_name: string;
  user_email: string;
  user_role: string;
  plan_id: string | null;
  plan_title: string;
  plan_entitlements: PlanEntitlements;
  status: SubscriptionStatus;
  starts_at: string | null;
  ends_at: string | null;
  entitlements_snapshot: PlanEntitlements;
  custom_overrides: PlanEntitlementsOverride;
  admin_notes: string;
  updated_at: string | null;
}

interface PlanOption {
  id: string;
  title: string;
  slug: string;
  duration_days: number;
  price_inr: number;
  entitlements: PlanEntitlements;
}

interface SubscribersManagerProps {
  onNotice?: (notice: {
    type: 'success' | 'error' | 'info';
    text: string;
  }) => void;
}

const STATUS_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'active', label: 'Active' },
  { id: 'pending', label: 'Pending' },
  { id: 'suspended', label: 'Suspended' },
  { id: 'expired', label: 'Expired' },
  { id: 'cancelled', label: 'Cancelled' },
] as const;

const EDITABLE_STATUSES: Array<{ value: SubscriptionStatus; label: string }> = [
  { value: 'active', label: 'Active' },
  { value: 'pending', label: 'Pending' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'expired', label: 'Expired' },
  { value: 'cancelled', label: 'Cancelled' },
];

function statusBadgeStyle(status: string): string {
  switch (status) {
    case 'active':
    case 'trialing':
      return 'border-emerald-500/30 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300';
    case 'suspended':
      return 'border-amber-500/30 bg-amber-500/15 text-amber-700 dark:text-amber-300';
    case 'cancelled':
    case 'expired':
      return 'border-rose-500/30 bg-rose-500/15 text-rose-700 dark:text-rose-300';
    default:
      return 'border-[var(--ps-border)] bg-[var(--ps-surface-alt)] text-[var(--ps-text-muted)]';
  }
}

function formatDateShort(iso: string | null): string {
  if (!iso) return 'No expiry';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function toDateInputValue(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function computeExtendedEndsIso(currentEndsAt: string | null, days: number): string {
  const nowMs = Date.now();
  const existingMs = currentEndsAt ? new Date(currentEndsAt).getTime() : 0;
  const baseMs = existingMs > nowMs ? existingMs : nowMs;
  return new Date(baseMs + days * 24 * 60 * 60 * 1000).toISOString();
}

export function SubscribersManager({ onNotice }: SubscribersManagerProps) {
  const { confirm, dialog } = useConfirmDialog();

  const [rows, setRows] = useState<SubscriberRow[]>([]);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [mutatingId, setMutatingId] = useState<string | null>(null);

  // Per-subscriber drawer state (plan switch, renewal date, custom_overrides, admin_notes)
  const [editingSub, setEditingSub] = useState<SubscriberRow | null>(null);
  const [draftPlanId, setDraftPlanId] = useState<string>('');
  const [draftStatus, setDraftStatus] = useState<SubscriptionStatus>('active');
  const [draftEndsDate, setDraftEndsDate] = useState<string>('');
  const [draftAdminNotes, setDraftAdminNotes] = useState<string>('');
  const [draftEffective, setDraftEffective] = useState<PlanEntitlements>(
    FREE_BASELINE_ENTITLEMENTS
  );
  const [draftHasOverrides, setDraftHasOverrides] = useState<boolean>(false);
  const [isSavingDrawer, setIsSavingDrawer] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setErrorMsg(null);
    if (!isSupabaseConfigured()) {
      setIsLoading(false);
      setErrorMsg('Supabase is not configured in this environment.');
      return;
    }

    try {
      const [subsRes, plansRes, profilesRes] = await Promise.all([
        supabase
          .from('user_subscriptions')
          .select('*')
          .order('updated_at', { ascending: false })
          .order('created_at', { ascending: false })
          .limit(250),
        supabase
          .from('subscription_plans')
          .select('id, title, name, slug, duration_days, price_inr, entitlements')
          .order('sort_order', { ascending: true }),
        supabase
          .from('profiles')
          .select('id, full_name, email, role')
          .limit(500),
      ]);

      if (subsRes.error) throw new Error(subsRes.error.message);

      const planMap = new Map<string, PlanOption>();
      const planList: PlanOption[] = (
        (plansRes.data as Record<string, unknown>[]) || []
      ).map((p) => {
        const opt: PlanOption = {
          id: String(p.id || ''),
          title: String(p.title || p.name || 'Plan'),
          slug: String(p.slug || ''),
          duration_days: Number(p.duration_days || 30),
          price_inr: Number(p.price_inr || 0),
          entitlements: normalizePlanEntitlements(p.entitlements),
        };
        planMap.set(opt.id, opt);
        return opt;
      });
      setPlans(planList);

      const profileMap = new Map<
        string,
        { full_name: string; email: string; role: string }
      >();
      for (const prof of ((profilesRes.data as Record<string, unknown>[]) ||
        [])) {
        const pid = String(prof.id || '');
        if (!pid) continue;
        profileMap.set(pid, {
          full_name: String(prof.full_name || prof.email || 'Subscriber'),
          email: String(prof.email || ''),
          role: String(prof.role || 'visitor'),
        });
      }

      const normalized: SubscriberRow[] = (
        (subsRes.data as Record<string, unknown>[]) || []
      ).map((raw) => {
        const uid = String(raw.user_id || '');
        const pid = raw.plan_id ? String(raw.plan_id) : null;
        const prof = profileMap.get(uid);
        const plan = pid ? planMap.get(pid) : undefined;
        const planEnt = plan?.entitlements ?? FREE_BASELINE_ENTITLEMENTS;
        const snapshot = raw.entitlements_snapshot
          ? normalizePlanEntitlements(raw.entitlements_snapshot, planEnt)
          : planEnt;
        const overrides = (raw.custom_overrides ||
          raw.entitlement_overrides ||
          {}) as PlanEntitlementsOverride;

        return {
          id: String(raw.id || ''),
          user_id: uid,
          user_name: prof?.full_name || `User ${uid.slice(0, 8)}`,
          user_email: prof?.email || uid,
          user_role: prof?.role || 'visitor',
          plan_id: pid,
          plan_title: plan?.title || 'Unlinked Plan',
          plan_entitlements: planEnt,
          status: String(raw.status || 'pending') as SubscriptionStatus,
          starts_at:
            typeof raw.starts_at === 'string'
              ? raw.starts_at
              : typeof raw.created_at === 'string'
                ? raw.created_at
                : null,
          ends_at:
            typeof raw.ends_at === 'string'
              ? raw.ends_at
              : typeof raw.expires_at === 'string'
                ? raw.expires_at
                : null,
          entitlements_snapshot: snapshot,
          custom_overrides: overrides,
          admin_notes: String(raw.admin_notes || raw.override_reason || ''),
          updated_at:
            typeof raw.updated_at === 'string' ? raw.updated_at : null,
        };
      });

      setRows(normalized);
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Failed to load subscribers.'
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void loadData();
    });
  }, [loadData]);

  const filteredRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter !== 'all') {
        if (
          statusFilter === 'pending' &&
          r.status !== 'pending' &&
          r.status !== 'pending_payment'
        ) {
          return false;
        } else if (statusFilter !== 'pending' && r.status !== statusFilter) {
          return false;
        }
      }
      if (!q) return true;
      return (
        r.user_name.toLowerCase().includes(q) ||
        r.user_email.toLowerCase().includes(q) ||
        r.plan_title.toLowerCase().includes(q) ||
        r.status.toLowerCase().includes(q)
      );
    });
  }, [rows, searchQuery, statusFilter]);

  const openManageDrawer = (sub: SubscriberRow) => {
    setEditingSub(sub);
    setDraftPlanId(sub.plan_id || '');
    setDraftStatus(sub.status);
    setDraftEndsDate(toDateInputValue(sub.ends_at));
    setDraftAdminNotes(sub.admin_notes || '');
    setDraftEffective(
      mergeEntitlements(sub.entitlements_snapshot, sub.custom_overrides)
    );
    setDraftHasOverrides(
      Boolean(
        sub.custom_overrides && Object.keys(sub.custom_overrides).length > 0
      )
    );
  };

  const handleQuickStatusChange = async (
    sub: SubscriberRow,
    nextStatus: SubscriptionStatus
  ) => {
    if (nextStatus === 'suspended' || nextStatus === 'cancelled') {
      const ok = await confirm({
        title: `${nextStatus === 'suspended' ? 'Suspend' : 'Cancel'} ${sub.user_name}'s subscription?`,
        description:
          'Premium entitlements will immediately soft-freeze back to the safe free-tier baseline. All user listings and data remain preserved.',
        confirmLabel:
          nextStatus === 'suspended' ? 'Suspend Subscription' : 'Cancel Subscription',
        variant: 'danger',
      });
      if (!ok) return;
    }

    setMutatingId(sub.id);
    try {
      const { error } = await supabase
        .from('user_subscriptions')
        .update({ status: nextStatus })
        .eq('id', sub.id);
      if (error) throw new Error(error.message);
      onNotice?.({
        type: 'success',
        text: `Updated ${sub.user_name}'s subscription status to ${nextStatus}.`,
      });
      await loadData();
    } catch (err) {
      onNotice?.({
        type: 'error',
        text:
          err instanceof Error ? err.message : 'Failed to update status.',
      });
    } finally {
      setMutatingId(null);
    }
  };

  const handleQuickExtendDays = async (sub: SubscriberRow, days: number) => {
    const nextEndsIso = computeExtendedEndsIso(sub.ends_at, days);

    setMutatingId(sub.id);
    try {
      const { error } = await supabase
        .from('user_subscriptions')
        .update({
          status: 'active',
          ends_at: nextEndsIso,
          expires_at: nextEndsIso,
        })
        .eq('id', sub.id);
      if (error) throw new Error(error.message);
      onNotice?.({
        type: 'success',
        text: `Extended ${sub.user_name}'s subscription by +${days} days (ends ${formatDateShort(nextEndsIso)}).`,
      });
      await loadData();
    } catch (err) {
      onNotice?.({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Failed to extend subscription.',
      });
    } finally {
      setMutatingId(null);
    }
  };

  const handleSaveDrawer = async () => {
    if (!editingSub) return;

    if (
      (draftStatus === 'suspended' || draftStatus === 'cancelled') &&
      editingSub.status !== draftStatus
    ) {
      const ok = await confirm({
        title: `${draftStatus === 'suspended' ? 'Suspend' : 'Cancel'} subscription?`,
        description:
          'Changing this subscription to suspended or cancelled immediately soft-freezes premium features to the free baseline without deleting customer data.',
        confirmLabel: 'Confirm Status Change',
        variant: 'danger',
      });
      if (!ok) return;
    }

    const selectedPlan = plans.find((p) => p.id === draftPlanId);
    const nextSnapshot =
      selectedPlan && selectedPlan.id !== editingSub.plan_id
        ? selectedPlan.entitlements
        : editingSub.entitlements_snapshot;
    const nextEndsIso = draftEndsDate
      ? new Date(`${draftEndsDate}T23:59:59.000Z`).toISOString()
      : null;

    const overridesPayload = draftHasOverrides ? draftEffective : {};

    setIsSavingDrawer(true);
    try {
      const { error } = await supabase
        .from('user_subscriptions')
        .update({
          plan_id: draftPlanId || editingSub.plan_id,
          status: draftStatus,
          ends_at: nextEndsIso,
          expires_at: nextEndsIso,
          entitlements_snapshot: nextSnapshot,
          custom_overrides: overridesPayload,
          entitlement_overrides: overridesPayload,
          admin_notes: draftAdminNotes.trim() || null,
          override_reason: draftAdminNotes.trim() || null,
        })
        .eq('id', editingSub.id);

      if (error) throw new Error(error.message);

      onNotice?.({
        type: 'success',
        text: `Saved subscription & entitlement overrides for ${editingSub.user_name}.`,
      });
      setEditingSub(null);
      await loadData();
    } catch (err) {
      onNotice?.({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Failed to update subscriber record.',
      });
    } finally {
      setIsSavingDrawer(false);
    }
  };

  const updateDraftFeature = (
    key: EntitlementFeatureKey,
    patch: Partial<{ enabled: boolean; limit: number | null }>
  ) => {
    setDraftHasOverrides(true);
    setDraftEffective((prev) => ({
      ...prev,
      [key]: {
        ...prev[key],
        ...patch,
      },
    }));
  };

  return (
    <section
      data-testid="superadmin-subscribers-manager"
      className="space-y-4"
    >
      {/* Header & Controls */}
      <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <UserCheck className="h-4 w-4 text-[var(--ps-accent)] shrink-0" />
              <h2 className="text-sm font-bold text-[var(--ps-text)]">
                Subscribers, Renewals &amp; Per-Customer Entitlement Overrides
              </h2>
            </div>
            <p className="mt-1 text-xs text-[var(--ps-text-muted)]">
              Manage active, pending, suspended, or expired customer subscriptions, extend validity dates, switch plans, or apply granular <code className="font-mono">custom_overrides</code> without duplicating plans.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadData()}
            disabled={isLoading}
            className="inline-flex min-h-[44px] items-center gap-1.5 self-start rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>

        <div className="flex flex-col gap-2.5 md:flex-row md:items-center md:justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ps-text-muted)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search subscriber name, email, or plan..."
              className="w-full min-h-[44px] rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] pl-9 pr-3 text-xs text-[var(--ps-text)]"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setStatusFilter(f.id)}
                className={`inline-flex min-h-[38px] items-center rounded-xl px-3 text-[11px] font-semibold cursor-pointer ${
                  statusFilter === f.id
                    ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                    : 'border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {errorMsg && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-xs text-rose-700 dark:text-rose-300">
          {errorMsg}
        </div>
      )}

      {/* Subscribers List: Cards on mobile (<md), Table on md+ */}
      {isLoading ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-10 text-xs text-[var(--ps-text-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading user subscriptions…</span>
        </div>
      ) : filteredRows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-surface)] p-8 text-center text-xs text-[var(--ps-text-muted)]">
          No matching subscriptions found.
        </div>
      ) : (
        <>
          {/* Mobile Stacked Cards */}
          <div className="space-y-3 md:hidden">
            {filteredRows.map((sub) => {
              const hasOverrides =
                sub.custom_overrides &&
                Object.keys(sub.custom_overrides).length > 0;
              return (
                <div
                  key={sub.id}
                  className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-sm font-bold text-[var(--ps-text)] truncate">
                        {sub.user_name}
                      </div>
                      <div className="text-[11px] text-[var(--ps-text-muted)] truncate">
                        {sub.user_email} · {sub.user_role}
                      </div>
                    </div>
                    <span
                      className={`shrink-0 rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase ${statusBadgeStyle(sub.status)}`}
                    >
                      {sub.status}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div>
                      <span className="font-semibold text-[var(--ps-text)]">
                        {sub.plan_title}
                      </span>
                      {hasOverrides && (
                        <span className="ml-1.5 rounded bg-purple-500/15 px-1.5 py-0.5 text-[10px] font-bold text-purple-700 dark:text-purple-300">
                          Custom Overrides
                        </span>
                      )}
                    </div>
                    <span className="font-mono text-[11px] tabular-nums text-[var(--ps-text-muted)]">
                      Ends: {formatDateShort(sub.ends_at)}
                    </span>
                  </div>

                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <button
                      type="button"
                      disabled={mutatingId === sub.id}
                      onClick={() => void handleQuickExtendDays(sub, 30)}
                      className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-1 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs font-semibold text-[var(--ps-text)] cursor-pointer"
                    >
                      <CalendarPlus className="h-3.5 w-3.5 text-emerald-600" />
                      <span>+30d</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => openManageDrawer(sub)}
                      className="inline-flex min-h-[40px] flex-1 items-center justify-center gap-1 rounded-xl bg-[var(--ps-accent)] px-3 text-xs font-semibold text-[var(--ps-accent-fg)] cursor-pointer"
                    >
                      <SlidersHorizontal className="h-3.5 w-3.5" />
                      <span>Manage &amp; Overrides</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop Table */}
          <div className="hidden overflow-x-auto rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] md:block">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-[var(--ps-border)] bg-[var(--ps-surface-alt)] text-[11px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                <tr>
                  <th className="px-4 py-3">Subscriber</th>
                  <th className="px-4 py-3">Plan &amp; Overrides</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Validity</th>
                  <th className="px-4 py-3 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--ps-border)]">
                {filteredRows.map((sub) => {
                  const hasOverrides =
                    sub.custom_overrides &&
                    Object.keys(sub.custom_overrides).length > 0;
                  const isBusy = mutatingId === sub.id;
                  return (
                    <tr
                      key={sub.id}
                      className="hover:bg-[var(--ps-surface-alt)]/50"
                    >
                      <td className="px-4 py-3">
                        <div className="font-bold text-[var(--ps-text)]">
                          {sub.user_name}
                        </div>
                        <div className="text-[11px] text-[var(--ps-text-muted)]">
                          {sub.user_email} ·{' '}
                          <span className="font-mono">{sub.user_role}</span>
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-[var(--ps-text)]">
                          {sub.plan_title}
                        </div>
                        {hasOverrides ? (
                          <span className="mt-0.5 inline-block rounded bg-purple-500/15 px-1.5 py-0.5 text-[10px] font-bold text-purple-700 dark:text-purple-300">
                            Per-Customer Overrides Active
                          </span>
                        ) : (
                          <span className="text-[11px] text-[var(--ps-text-muted)]">
                            Standard plan snapshot
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase ${statusBadgeStyle(sub.status)}`}
                        >
                          {sub.status}
                        </span>
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] tabular-nums text-[var(--ps-text-muted)]">
                        <div>Ends: {formatDateShort(sub.ends_at)}</div>
                        <div className="text-[10px] opacity-75">
                          Start: {formatDateShort(sub.starts_at)}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center justify-end gap-1.5">
                          <button
                            type="button"
                            disabled={isBusy}
                            onClick={() => void handleQuickExtendDays(sub, 30)}
                            title="Renew +30 days & activate"
                            className="inline-flex min-h-[36px] items-center gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-[11px] font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] disabled:opacity-50 cursor-pointer"
                          >
                            <CalendarPlus className="h-3.5 w-3.5 text-emerald-600" />
                            <span>+30d</span>
                          </button>
                          {sub.status === 'active' ? (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() =>
                                void handleQuickStatusChange(sub, 'suspended')
                              }
                              className="inline-flex min-h-[36px] items-center rounded-lg border border-amber-500/30 bg-amber-500/10 px-2.5 text-[11px] font-semibold text-amber-700 hover:bg-amber-500/20 disabled:opacity-50 dark:text-amber-300 cursor-pointer"
                            >
                              Suspend
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() =>
                                void handleQuickStatusChange(sub, 'active')
                              }
                              className="inline-flex min-h-[36px] items-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 text-[11px] font-semibold text-emerald-700 hover:bg-emerald-500/20 disabled:opacity-50 dark:text-emerald-300 cursor-pointer"
                            >
                              Activate
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => openManageDrawer(sub)}
                            className="inline-flex min-h-[36px] items-center gap-1 rounded-lg bg-[var(--ps-accent)] px-3 text-[11px] font-semibold text-[var(--ps-accent-fg)] hover:opacity-95 cursor-pointer"
                          >
                            <SlidersHorizontal className="h-3.5 w-3.5" />
                            <span>Overrides</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}

      {/* Manage & Custom Overrides Modal */}
      {editingSub && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 p-3 sm:p-4">
          <div className="flex max-h-[92vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] shadow-2xl">
            <div className="flex items-center justify-between gap-2 border-b border-[var(--ps-border)] px-5 py-4">
              <div className="min-w-0">
                <h3 className="text-sm font-bold text-[var(--ps-text)] truncate">
                  Manage Subscription — {editingSub.user_name}
                </h3>
                <p className="text-[11px] text-[var(--ps-text-muted)] truncate">
                  {editingSub.user_email} · Soft-freeze safe (customer data is never deleted on expiry or suspend).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditingSub(null)}
                className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] cursor-pointer"
              >
                <X className="h-4 w-4" />
              </button>
            </div>

            <div className="flex-1 space-y-4 overflow-y-auto p-5">
              {/* Plan, Status, Validity */}
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="block text-[11px] font-bold text-[var(--ps-text)] mb-1">
                    Assigned Plan
                  </label>
                  <select
                    value={draftPlanId}
                    onChange={(e) => {
                      const nextId = e.target.value;
                      setDraftPlanId(nextId);
                      const nextPlan = plans.find((p) => p.id === nextId);
                      if (nextPlan && !draftHasOverrides) {
                        setDraftEffective(nextPlan.entitlements);
                      }
                    }}
                    className="w-full min-h-[44px] rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)]"
                  >
                    <option value="">Keep Current ({editingSub.plan_title})</option>
                    {plans.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.title} (₹{p.price_inr} / {p.duration_days}d)
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-[var(--ps-text)] mb-1">
                    Status
                  </label>
                  <select
                    value={draftStatus}
                    onChange={(e) =>
                      setDraftStatus(e.target.value as SubscriptionStatus)
                    }
                    className="w-full min-h-[44px] rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)]"
                  >
                    {EDITABLE_STATUSES.map((st) => (
                      <option key={st.value} value={st.value}>
                        {st.label}
                      </option>
                    ))}
                  </select>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-[var(--ps-text)] mb-1">
                    Valid Until (`ends_at`)
                  </label>
                  <input
                    type="date"
                    value={draftEndsDate}
                    onChange={(e) => setDraftEndsDate(e.target.value)}
                    className="w-full min-h-[44px] rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 font-mono text-xs text-[var(--ps-text)]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-[var(--ps-text)] mb-1">
                  Superadmin Governance Note (`admin_notes`)
                </label>
                <input
                  type="text"
                  value={draftAdminNotes}
                  onChange={(e) => setDraftAdminNotes(e.target.value)}
                  placeholder="e.g., Granted complimentary UPI checkout & +3 staff seats for Churachandpur partner launch"
                  className="w-full min-h-[44px] rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)]"
                />
              </div>

              {/* Per-Customer Custom Overrides Matrix */}
              <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-xs font-bold text-[var(--ps-text)]">
                      Per-Customer Entitlement Overrides (`custom_overrides`)
                    </div>
                    <p className="text-[11px] text-[var(--ps-text-muted)]">
                      {draftHasOverrides
                        ? 'Custom overrides active — these values override the plan snapshot for this customer only.'
                        : 'Inheriting exact plan defaults. Toggle any item below to apply a customer-specific override.'}
                    </p>
                  </div>
                  {draftHasOverrides && (
                    <button
                      type="button"
                      onClick={() => {
                        setDraftHasOverrides(false);
                        setDraftEffective(editingSub.entitlements_snapshot);
                      }}
                      className="inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 text-[11px] font-semibold text-[var(--ps-text)] cursor-pointer"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span>Reset to Plan Defaults</span>
                    </button>
                  )}
                </div>

                {/* Quota Overrides */}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {(
                    [
                      { key: 'max_listings', label: 'Max Listings' },
                      {
                        key: 'max_marketplace_items',
                        label: 'Max Marketplace Items',
                      },
                    ] as const
                  ).map((item) => {
                    const val = draftEffective[item.key];
                    const isUnlimited = val === null;
                    return (
                      <div
                        key={item.key}
                        className="flex items-center justify-between gap-2 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] p-2.5"
                      >
                        <span className="text-xs font-semibold text-[var(--ps-text)]">
                          {item.label}
                        </span>
                        <div className="flex items-center gap-2">
                          <label className="inline-flex items-center gap-1 text-[11px] text-[var(--ps-text-muted)] cursor-pointer">
                            <input
                              type="checkbox"
                              checked={isUnlimited}
                              onChange={(e) => {
                                setDraftHasOverrides(true);
                                setDraftEffective((prev) => ({
                                  ...prev,
                                  [item.key]: e.target.checked ? null : 5,
                                }));
                              }}
                              className="h-3.5 w-3.5 accent-[var(--ps-accent)]"
                            />
                            <span>∞</span>
                          </label>
                          {!isUnlimited && (
                            <input
                              type="number"
                              min={0}
                              value={val ?? 0}
                              onChange={(e) => {
                                setDraftHasOverrides(true);
                                setDraftEffective((prev) => ({
                                  ...prev,
                                  [item.key]: Math.max(
                                    0,
                                    parseInt(e.target.value, 10) || 0
                                  ),
                                }));
                              }}
                              className="w-16 min-h-[34px] rounded border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 font-mono text-xs tabular-nums text-[var(--ps-text)]"
                            />
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Feature Override Toggles */}
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {ENTITLEMENT_FEATURE_META.map((meta) => {
                    const feat = draftEffective[meta.key];
                    return (
                      <div
                        key={meta.key}
                        className="flex items-center justify-between gap-2 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] p-2.5"
                      >
                        <div className="min-w-0">
                          <div className="text-xs font-semibold text-[var(--ps-text)] truncate">
                            {meta.label}
                          </div>
                          {feat.enabled && meta.supportsNumericLimit && (
                            <div className="mt-1 flex items-center gap-1.5">
                              <label className="inline-flex items-center gap-1 text-[10px] text-[var(--ps-text-muted)] cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={feat.limit === null}
                                  onChange={(e) =>
                                    updateDraftFeature(meta.key, {
                                      limit: e.target.checked ? null : 5,
                                    })
                                  }
                                  className="h-3 w-3 accent-[var(--ps-accent)]"
                                />
                                <span>∞</span>
                              </label>
                              {feat.limit !== null && (
                                <input
                                  type="number"
                                  min={0}
                                  value={feat.limit}
                                  onChange={(e) =>
                                    updateDraftFeature(meta.key, {
                                      limit: Math.max(
                                        0,
                                        parseInt(e.target.value, 10) || 0
                                      ),
                                    })
                                  }
                                  className="w-16 rounded border border-[var(--ps-border)] bg-[var(--ps-bg)] px-1.5 py-0.5 font-mono text-[11px] tabular-nums text-[var(--ps-text)]"
                                />
                              )}
                            </div>
                          )}
                        </div>
                        <label className="inline-flex min-h-[34px] shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-[11px] font-semibold">
                          <input
                            type="checkbox"
                            checked={feat.enabled}
                            onChange={(e) =>
                              updateDraftFeature(meta.key, {
                                enabled: e.target.checked,
                              })
                            }
                            className="h-4 w-4 accent-[var(--ps-accent)]"
                          />
                          <span>{feat.enabled ? 'On' : 'Off'}</span>
                        </label>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-[var(--ps-border)] px-5 py-3.5">
              <button
                type="button"
                onClick={() => setEditingSub(null)}
                className="inline-flex min-h-[44px] items-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-4 text-xs font-semibold text-[var(--ps-text)] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isSavingDrawer}
                onClick={() => void handleSaveDrawer()}
                className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[var(--ps-accent)] px-5 text-xs font-semibold text-[var(--ps-accent-fg)] hover:opacity-95 disabled:opacity-50 cursor-pointer"
              >
                {isSavingDrawer ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                <span>Save Subscription</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {dialog}
    </section>
  );
}
