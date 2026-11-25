'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CalendarPlus,
  Clock,
  RefreshCw,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sparkles,
  UserCheck,
} from 'lucide-react';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { useConfirmDialogState } from '@/components/ui/ConfirmDialog';
import { FormModal } from '@/components/ui/FormModal';
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
  user_trial_used_at: string | null;
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
  { id: 'trialing', label: 'Trialing' },
  { id: 'active', label: 'Active' },
  { id: 'pending', label: 'Pending' },
  { id: 'suspended', label: 'Suspended' },
  { id: 'expired', label: 'Expired' },
  { id: 'cancelled', label: 'Cancelled' },
] as const;

const EDITABLE_STATUSES: Array<{ value: SubscriptionStatus; label: string }> = [
  { value: 'trialing', label: 'Trialing' },
  { value: 'active', label: 'Active' },
  { value: 'pending', label: 'Pending' },
  { value: 'suspended', label: 'Suspended' },
  { value: 'expired', label: 'Expired' },
  { value: 'cancelled', label: 'Cancelled' },
];

function statusBadgeStyle(status: string): string {
  switch (status) {
    case 'trialing':
      return 'border-sky-500/35 bg-sky-500/15 text-sky-700 dark:text-sky-300';
    case 'active':
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

function formatRemainingDays(iso: string | null, status: string): string | null {
  if (!iso) return null;
  if (status !== 'trialing' && status !== 'active') return null;
  const targetMs = new Date(iso).getTime();
  if (Number.isNaN(targetMs)) return null;
  const diffDays = Math.ceil((targetMs - Date.now()) / (24 * 60 * 60 * 1000));
  if (diffDays <= 0) return 'Expired';
  if (diffDays === 1) return '1d left';
  return `${diffDays}d left`;
}

function toDateInputValue(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function computeExtendedEndsIso(
  currentEndsAt: string | null,
  days: number
): string {
  const nowMs = Date.now();
  const existingMs = currentEndsAt ? new Date(currentEndsAt).getTime() : 0;
  const baseMs = existingMs > nowMs ? existingMs : nowMs;
  return new Date(baseMs + days * 24 * 60 * 60 * 1000).toISOString();
}

// =============================================================================
// PHASE 10 SKELETAL LOADER
// =============================================================================
function SubscribersSkeleton() {
  return (
    <div className="space-y-3" aria-busy="true" aria-label="Loading subscribers">
      {[1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
        >
          <div className="space-y-2 flex-1">
            <div className="h-4 w-48 rounded-lg dd-shimmer" />
            <div className="h-3 w-64 rounded-lg dd-shimmer" />
          </div>
          <div className="flex gap-2">
            <div className="h-11 w-20 rounded-xl dd-shimmer" />
            <div className="h-11 w-24 rounded-xl dd-shimmer" />
            <div className="h-11 w-28 rounded-xl dd-shimmer" />
          </div>
        </div>
      ))}
    </div>
  );
}

// =============================================================================
// MODAL-ONLY SUBSCRIBER OVERRIDES EDITOR
// =============================================================================
interface SubscriberEditModalProps {
  open: boolean;
  subscriber: SubscriberRow;
  plans: PlanOption[];
  saving: boolean;
  onClose: () => void;
  onSave: (payload: {
    plan_id: string | null;
    status: SubscriptionStatus;
    ends_at: string | null;
    entitlements_snapshot: PlanEntitlements;
    custom_overrides: PlanEntitlementsOverride;
    admin_notes: string | null;
  }) => Promise<void>;
}

function SubscriberEditModal({
  open,
  subscriber,
  plans,
  saving,
  onClose,
  onSave,
}: SubscriberEditModalProps) {
  const initialEnds = toDateInputValue(subscriber.ends_at);
  const initialHasOverrides = Boolean(
    subscriber.custom_overrides &&
      Object.keys(subscriber.custom_overrides).length > 0
  );
  const initialEffective = useMemo(
    () =>
      mergeEntitlements(
        subscriber.entitlements_snapshot,
        subscriber.custom_overrides
      ),
    [subscriber.entitlements_snapshot, subscriber.custom_overrides]
  );

  const [draftPlanId, setDraftPlanId] = useState<string>(
    subscriber.plan_id || ''
  );
  const [draftStatus, setDraftStatus] = useState<SubscriptionStatus>(
    subscriber.status
  );
  const [draftEndsDate, setDraftEndsDate] = useState<string>(initialEnds);
  const [draftAdminNotes, setDraftAdminNotes] = useState<string>(
    subscriber.admin_notes || ''
  );
  const [draftEffective, setDraftEffective] =
    useState<PlanEntitlements>(initialEffective);
  const [draftHasOverrides, setDraftHasOverrides] =
    useState<boolean>(initialHasOverrides);

  const isDirty = useMemo(() => {
    return (
      draftPlanId !== (subscriber.plan_id || '') ||
      draftStatus !== subscriber.status ||
      draftEndsDate !== initialEnds ||
      draftAdminNotes.trim() !== (subscriber.admin_notes || '').trim() ||
      draftHasOverrides !== initialHasOverrides ||
      JSON.stringify(draftEffective) !== JSON.stringify(initialEffective)
    );
  }, [
    draftPlanId,
    draftStatus,
    draftEndsDate,
    draftAdminNotes,
    draftHasOverrides,
    draftEffective,
    subscriber.plan_id,
    subscriber.status,
    subscriber.admin_notes,
    initialEnds,
    initialHasOverrides,
    initialEffective,
  ]);

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

  const isFreezing =
    (draftStatus === 'suspended' || draftStatus === 'cancelled') &&
    subscriber.status !== draftStatus;
  const selectedPlan = plans.find((p) => p.id === draftPlanId);

  const handleSubmit = async () => {
    const nextSnapshot =
      selectedPlan && selectedPlan.id !== subscriber.plan_id
        ? selectedPlan.entitlements
        : subscriber.entitlements_snapshot;
    const nextEndsIso = draftEndsDate
      ? new Date(`${draftEndsDate}T23:59:59.000Z`).toISOString()
      : null;

    await onSave({
      plan_id: draftPlanId || subscriber.plan_id,
      status: draftStatus,
      ends_at: nextEndsIso,
      entitlements_snapshot: nextSnapshot,
      custom_overrides: draftHasOverrides ? draftEffective : {},
      admin_notes: draftAdminNotes.trim() || null,
    });
  };

  return (
    <FormModal
      isOpen={open}
      title={`Manage Subscription — ${subscriber.user_name}`}
      subtitle={`${subscriber.user_email} · Soft-freeze safe governance`}
      hints={[
        'Per-customer custom_overrides apply strictly to this account without mutating the shared plan template.',
        'Use Reset to Defaults anytime to revert back to the plan snapshot.',
      ]}
      cautions={[
        'Suspending, expiring, or cancelling a subscription soft-freezes premium features back to the free baseline — customer listings and photos are never deleted.',
      ]}
      isDirty={isDirty}
      isValid={true}
      submitLabel={isFreezing ? 'Confirm & Freeze' : 'Review & Save'}
      confirmSubmitTitle={
        isFreezing
          ? `${draftStatus === 'suspended' ? 'Suspend' : 'Cancel'} ${subscriber.user_name}'s Subscription?`
          : `Save Subscription Changes for ${subscriber.user_name}?`
      }
      confirmSubmitDescription={
        isFreezing
          ? 'Suspending or cancelling immediately soft-freezes premium features back to the safe free baseline without deleting any customer listings or data.'
          : 'Updates user_subscriptions and logs an immutable entry in audit_logs.'
      }
      confirmSubmitImpact={[
        `Subscriber: ${subscriber.user_name} (${subscriber.user_email})`,
        `Plan: ${selectedPlan ? selectedPlan.title : subscriber.plan_title} · Status: ${draftStatus.toUpperCase()}`,
        `Valid until: ${draftEndsDate || 'No expiry'}`,
        `Custom overrides: ${draftHasOverrides ? 'Active (custom per-customer matrix)' : 'Reset to plan defaults'}`,
      ]}
      confirmSubmitVariant={isFreezing ? 'danger' : 'info'}
      isSubmitting={saving}
      maxWidthClassName="max-w-3xl"
      onSubmit={handleSubmit}
      onClose={onClose}
    >
      <div className="space-y-4">

        {/* Plan, Status, Validity */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-[11px] font-bold text-[var(--ps-text)]">
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
              className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)]"
            >
              <option value="">Keep Current ({subscriber.plan_title})</option>
              {plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.title} (₹{p.price_inr} / {p.duration_days}d)
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-bold text-[var(--ps-text)]">
              Status
            </label>
            <select
              value={draftStatus}
              onChange={(e) =>
                setDraftStatus(e.target.value as SubscriptionStatus)
              }
              className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)]"
            >
              {EDITABLE_STATUSES.map((st) => (
                <option key={st.value} value={st.value}>
                  {st.label}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-[11px] font-bold text-[var(--ps-text)]">
              Valid Until (<code className="font-mono">ends_at</code>)
            </label>
            <input
              type="date"
              value={draftEndsDate}
              onChange={(e) => setDraftEndsDate(e.target.value)}
              className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 font-mono text-xs text-[var(--ps-text)]"
            />
          </div>
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-bold text-[var(--ps-text)]">
            Superadmin Governance Note (<code className="font-mono">admin_notes</code>)
          </label>
          <input
            type="text"
            value={draftAdminNotes}
            onChange={(e) => setDraftAdminNotes(e.target.value)}
            placeholder="e.g., Granted complimentary UPI checkout & +3 staff seats for partner launch"
            className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)]"
          />
        </div>

        {/* Per-Customer Custom Overrides Matrix */}
        <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="text-xs font-bold text-[var(--ps-text)]">
                Per-Customer Entitlement Overrides
              </div>
              <p className="text-[11px] text-[var(--ps-text-muted)]">
                {draftHasOverrides
                  ? 'Custom overrides active — these values override the plan snapshot for this customer only.'
                  : 'Inheriting exact plan defaults. Adjust any item below to apply a customer-specific override.'}
              </p>
            </div>
            {draftHasOverrides && (
              <button
                type="button"
                onClick={() => {
                  setDraftHasOverrides(false);
                  setDraftEffective(subscriber.entitlements_snapshot);
                }}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Reset to Defaults</span>
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
                  className="flex items-center justify-between gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3"
                >
                  <span className="text-xs font-semibold text-[var(--ps-text)]">
                    {item.label}
                  </span>
                  <div className="flex items-center gap-2">
                    <label className="inline-flex min-h-[36px] items-center gap-1 text-[11px] text-[var(--ps-text-muted)] cursor-pointer">
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
                        className="h-4 w-4 accent-[var(--ps-accent)]"
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
                        className="min-h-[38px] w-16 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 font-mono text-xs tabular-nums text-[var(--ps-text)]"
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
                  className="flex items-center justify-between gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3"
                >
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-[var(--ps-text)] truncate">
                      {meta.label}
                    </div>
                    {feat.enabled && meta.supportsNumericLimit && (
                      <div className="mt-1.5 flex items-center gap-1.5">
                        <label className="inline-flex items-center gap-1 text-[10.5px] text-[var(--ps-text-muted)] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={feat.limit === null}
                            onChange={(e) =>
                              updateDraftFeature(meta.key, {
                                limit: e.target.checked ? null : 5,
                              })
                            }
                            className="h-3.5 w-3.5 accent-[var(--ps-accent)]"
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
                            className="min-h-[34px] w-16 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-1.5 font-mono text-[11px] tabular-nums text-[var(--ps-text)]"
                          />
                        )}
                      </div>
                    )}
                  </div>
                  <label className="inline-flex min-h-[40px] shrink-0 cursor-pointer items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-[11px] font-semibold">
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
    </FormModal>
  );
}

// =============================================================================
// MAIN SUBSCRIBERS MANAGER
// =============================================================================
export function SubscribersManager({ onNotice }: SubscribersManagerProps) {
  const { confirm, dialog } = useConfirmDialogState();

  const [rows, setRows] = useState<SubscriberRow[]>([]);
  const [plans, setPlans] = useState<PlanOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [mutatingId, setMutatingId] = useState<string | null>(null);

  const [editingSub, setEditingSub] = useState<SubscriberRow | null>(null);
  const [modalSeq, setModalSeq] = useState(0);
  const [isSavingModal, setIsSavingModal] = useState(false);

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
          .select('id, full_name, email, role, trial_used_at')
          .limit(500),
      ]);

      if (subsRes.error) throw new Error(subsRes.error.message);

      let profileRows: Record<string, unknown>[] = Array.isArray(profilesRes.data)
        ? (profilesRes.data as Record<string, unknown>[])
        : [];
      if (profilesRes.error && /trial_used_at/i.test(profilesRes.error.message)) {
        const fallbackProf = await supabase
          .from('profiles')
          .select('id, full_name, email, role')
          .limit(500);
        if (Array.isArray(fallbackProf.data)) {
          profileRows = fallbackProf.data as Record<string, unknown>[];
        }
      }

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
        {
          full_name: string;
          email: string;
          role: string;
          trial_used_at: string | null;
        }
      >();
      for (const prof of profileRows) {
        const pid = String(prof.id || '');
        if (!pid) continue;
        profileMap.set(pid, {
          full_name: String(prof.full_name || prof.email || 'Subscriber'),
          email: String(prof.email || ''),
          role: String(prof.role || 'visitor'),
          trial_used_at:
            typeof prof.trial_used_at === 'string' ? prof.trial_used_at : null,
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
          user_trial_used_at: prof?.trial_used_at ?? null,
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

  const openManageModal = (sub: SubscriberRow) => {
    setModalSeq((s) => s + 1);
    setEditingSub(sub);
  };

  const handleQuickStatusChange = async (
    sub: SubscriberRow,
    nextStatus: SubscriptionStatus
  ) => {
    const isDestructive =
      nextStatus === 'suspended' || nextStatus === 'cancelled';

    const ok = await confirm({
      title: isDestructive
        ? `${nextStatus === 'suspended' ? 'Suspend' : 'Cancel'} ${sub.user_name}'s Subscription?`
        : `Activate ${sub.user_name}'s Subscription?`,
      description: isDestructive
        ? 'Premium entitlements immediately soft-freeze back to the safe free-tier baseline. All customer listings and data remain preserved.'
        : 'Restores full entitlements from this subscriber’s plan snapshot and custom overrides immediately.',
      impactSummary: [
        `Account: ${sub.user_email}`,
        `Plan: ${sub.plan_title}`,
        `Status: ${sub.status.toUpperCase()} -> ${nextStatus.toUpperCase()}`,
      ],
      confirmLabel: isDestructive
        ? nextStatus === 'suspended'
          ? 'Suspend Subscription'
          : 'Cancel Subscription'
        : 'Activate Subscription',
      variant: isDestructive ? 'danger' : 'info',
    });
    if (!ok) return;

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
        text: err instanceof Error ? err.message : 'Failed to update status.',
      });
    } finally {
      setMutatingId(null);
    }
  };

  const handleQuickExtendDays = async (
    sub: SubscriberRow,
    days: number,
    keepTrialing = false
  ) => {
    const nextEndsIso = computeExtendedEndsIso(sub.ends_at, days);
    const nextStatus: SubscriptionStatus = keepTrialing ? 'trialing' : 'active';
    const ok = await confirm({
      title: keepTrialing
        ? `Extend ${sub.user_name}'s Trial by +${days} Days?`
        : `Extend ${sub.user_name} by +${days} Days?`,
      description: keepTrialing
        ? 'Extends the active free trial expiry date without charging and records an audit entry.'
        : 'Extends subscription validity and sets status to Active, writing an audit entry to public.audit_logs.',
      impactSummary: [
        `Plan: ${sub.plan_title}`,
        `Current expiry: ${formatDateShort(sub.ends_at)}`,
        `New expiry: ${formatDateShort(nextEndsIso)}`,
        `Status: ${nextStatus.toUpperCase()}`,
      ],
      confirmLabel: keepTrialing ? `Extend Trial +${days}d` : `Extend +${days} Days`,
      variant: 'info',
    });
    if (!ok) return;

    setMutatingId(sub.id);
    try {
      const { error } = await supabase
        .from('user_subscriptions')
        .update({
          status: nextStatus,
          ends_at: nextEndsIso,
          expires_at: nextEndsIso,
        })
        .eq('id', sub.id);
      if (error) throw new Error(error.message);
      onNotice?.({
        type: 'success',
        text: `Extended ${sub.user_name}'s ${keepTrialing ? 'trial' : 'subscription'} by +${days} days (ends ${formatDateShort(nextEndsIso)}).`,
      });
      await loadData();
    } catch (err) {
      onNotice?.({
        type: 'error',
        text:
          err instanceof Error ? err.message : 'Failed to extend subscription.',
      });
    } finally {
      setMutatingId(null);
    }
  };

  const handleResetTrialEligibility = async (sub: SubscriberRow) => {
    const ok = await confirm({
      title: `Reset Free Trial Eligibility for ${sub.user_name}?`,
      description:
        'Clears profiles.trial_used_at so this user can claim one eligible free trial again. Logged to public.audit_logs.',
      impactSummary: [
        `Account: ${sub.user_email}`,
        `Previous trial claimed: ${formatDateShort(sub.user_trial_used_at)}`,
      ],
      confirmLabel: 'Reset Trial Eligibility',
      variant: 'warning',
    });
    if (!ok) return;

    setMutatingId(sub.id);
    try {
      const { error } = await supabase.rpc('reset_user_trial_eligibility', {
        p_user_id: sub.user_id,
      });
      if (error) throw new Error(error.message);
      onNotice?.({
        type: 'success',
        text: `Reset one-time free trial eligibility for ${sub.user_name}.`,
      });
      await loadData();
    } catch (err) {
      onNotice?.({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Failed to reset trial eligibility.',
      });
    } finally {
      setMutatingId(null);
    }
  };

  const handleSaveModal = async (payload: {
    plan_id: string | null;
    status: SubscriptionStatus;
    ends_at: string | null;
    entitlements_snapshot: PlanEntitlements;
    custom_overrides: PlanEntitlementsOverride;
    admin_notes: string | null;
  }) => {
    if (!editingSub) return;
    setIsSavingModal(true);
    try {
      const { error } = await supabase
        .from('user_subscriptions')
        .update({
          plan_id: payload.plan_id,
          status: payload.status,
          ends_at: payload.ends_at,
          expires_at: payload.ends_at,
          entitlements_snapshot: payload.entitlements_snapshot,
          custom_overrides: payload.custom_overrides,
          entitlement_overrides: payload.custom_overrides,
          admin_notes: payload.admin_notes,
          override_reason: payload.admin_notes,
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
      setIsSavingModal(false);
    }
  };

  return (
    <section
      data-testid="superadmin-subscribers-manager"
      className="space-y-4"
    >
      {dialog}

      {editingSub && (
        <SubscriberEditModal
          key={`sub-modal-${editingSub.id}-${modalSeq}`}
          open={Boolean(editingSub)}
          subscriber={editingSub}
          plans={plans}
          saving={isSavingModal}
          onClose={() => setEditingSub(null)}
          onSave={handleSaveModal}
        />
      )}

      {/* Header & Controls */}
      <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <UserCheck className="h-4 w-4 text-[var(--ps-accent)] shrink-0" />
              <h2 className="text-sm font-bold text-[var(--ps-text)]">
                Subscribers, Renewals &amp; Per-Customer Entitlement Overrides
              </h2>
            </div>
            <p className="mt-1 text-xs text-[var(--ps-text-muted)]">
              Manage active, pending, suspended, or expired customer
              subscriptions, extend validity dates, switch plans, or apply
              granular <code className="font-mono">custom_overrides</code>{' '}
              inside the validated modal.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadData()}
            disabled={isLoading}
            className="inline-flex min-h-[44px] items-center gap-1.5 self-start rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`}
            />
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
              className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] pl-9 pr-3 text-xs text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none"
            />
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
            {STATUS_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setStatusFilter(f.id)}
                className={`inline-flex min-h-[44px] shrink-0 items-center rounded-xl px-3.5 text-xs font-semibold cursor-pointer ${
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

      {/* Subscribers List */}
      {isLoading ? (
        <SubscribersSkeleton />
      ) : filteredRows.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-surface)] p-8 text-center text-xs text-[var(--ps-text-muted)]">
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
              const isBusy = mutatingId === sub.id;
              const remainingLabel = formatRemainingDays(sub.ends_at, sub.status);
              const isActiveOrTrialing =
                sub.status === 'active' || sub.status === 'trialing';
              return (
                <div
                  key={sub.id}
                  className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3"
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
                    <div className="flex items-center gap-1.5 shrink-0">
                      {remainingLabel && (
                        <span className="inline-flex items-center gap-1 rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-0.5 font-mono text-[10px] font-bold text-[var(--ps-text)]">
                          <Clock className="h-3 w-3 text-sky-600 dark:text-sky-400" />
                          <span>{remainingLabel}</span>
                        </span>
                      )}
                      <span
                        className={`rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase ${statusBadgeStyle(sub.status)}`}
                      >
                        {sub.status}
                      </span>
                    </div>
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
                    {sub.status === 'trialing' ? (
                      <>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void handleQuickExtendDays(sub, 7, true)}
                          className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1 rounded-xl border border-sky-500/35 bg-sky-500/10 px-3 text-xs font-semibold text-sky-700 dark:text-sky-300 disabled:opacity-50 cursor-pointer"
                        >
                          <CalendarPlus className="h-3.5 w-3.5" />
                          <span>+7d Trial</span>
                        </button>
                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void handleQuickStatusChange(sub, 'active')}
                          className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-3 text-xs font-semibold text-emerald-700 dark:text-emerald-300 disabled:opacity-50 cursor-pointer"
                        >
                          <Sparkles className="h-3.5 w-3.5" />
                          <span>Convert Active</span>
                        </button>
                      </>
                    ) : (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleQuickExtendDays(sub, 30, false)}
                        className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs font-semibold text-[var(--ps-text)] disabled:opacity-50 cursor-pointer"
                      >
                        <CalendarPlus className="h-3.5 w-3.5 text-emerald-600" />
                        <span>+30d</span>
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={isBusy}
                      onClick={() =>
                        void handleQuickStatusChange(
                          sub,
                          isActiveOrTrialing ? 'suspended' : 'active'
                        )
                      }
                      className={`inline-flex min-h-[44px] items-center justify-center rounded-xl border px-3 text-xs font-semibold disabled:opacity-50 cursor-pointer ${
                        isActiveOrTrialing
                          ? 'border-amber-500/35 bg-amber-500/10 text-amber-700 dark:text-amber-300'
                          : 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                      }`}
                    >
                      {isActiveOrTrialing ? 'Suspend' : 'Activate'}
                    </button>

                    {sub.user_trial_used_at && (
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleResetTrialEligibility(sub)}
                        className="inline-flex min-h-[44px] items-center justify-center gap-1 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs font-semibold text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] disabled:opacity-50 cursor-pointer"
                      >
                        <RotateCcw className="h-3.5 w-3.5" />
                        <span>Reset Trial</span>
                      </button>
                    )}

                    <button
                      type="button"
                      onClick={() => openManageModal(sub)}
                      className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1 rounded-xl bg-[var(--ps-accent)] px-3 text-xs font-bold text-[var(--ps-accent-fg)] cursor-pointer"
                    >
                      <SlidersHorizontal className="h-3.5 w-3.5" />
                      <span>Overrides</span>
                    </button>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Desktop Table */}
          <div className="hidden overflow-x-auto rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] md:block">
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
                  const remainingLabel = formatRemainingDays(sub.ends_at, sub.status);
                  const isActiveOrTrialing =
                    sub.status === 'active' || sub.status === 'trialing';
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
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className={`inline-flex rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase ${statusBadgeStyle(sub.status)}`}
                          >
                            {sub.status}
                          </span>
                          {remainingLabel && (
                            <span className="inline-flex items-center gap-1 rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[var(--ps-text)]">
                              <Clock className="h-3 w-3 text-sky-600 dark:text-sky-400" />
                              <span>{remainingLabel}</span>
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-[11px] tabular-nums text-[var(--ps-text-muted)]">
                        <div>Ends: {formatDateShort(sub.ends_at)}</div>
                        <div className="text-[10px] opacity-75">
                          Start: {formatDateShort(sub.starts_at)}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center justify-end gap-1.5">
                          {sub.status === 'trialing' ? (
                            <>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() =>
                                  void handleQuickExtendDays(sub, 7, true)
                                }
                                title="Extend trial by +7 days"
                                className="inline-flex min-h-[44px] items-center gap-1 rounded-xl border border-sky-500/35 bg-sky-500/10 px-2.5 text-xs font-semibold text-sky-700 hover:bg-sky-500/20 disabled:opacity-50 dark:text-sky-300 cursor-pointer"
                              >
                                <CalendarPlus className="h-3.5 w-3.5" />
                                <span>+7d Trial</span>
                              </button>
                              <button
                                type="button"
                                disabled={isBusy}
                                onClick={() =>
                                  void handleQuickStatusChange(sub, 'active')
                                }
                                title="Convert trial to paid active subscription"
                                className="inline-flex min-h-[44px] items-center gap-1 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-2.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-500/20 disabled:opacity-50 dark:text-emerald-300 cursor-pointer"
                              >
                                <Sparkles className="h-3.5 w-3.5" />
                                <span>Convert</span>
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() =>
                                void handleQuickExtendDays(sub, 30, false)
                              }
                              title="Renew +30 days & activate"
                              className="inline-flex min-h-[44px] items-center gap-1 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] disabled:opacity-50 cursor-pointer"
                            >
                              <CalendarPlus className="h-3.5 w-3.5 text-emerald-600" />
                              <span>+30d</span>
                            </button>
                          )}

                          {isActiveOrTrialing ? (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() =>
                                void handleQuickStatusChange(sub, 'suspended')
                              }
                              title="Soft-freeze back to Default Free Tier"
                              className="inline-flex min-h-[44px] items-center rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 text-xs font-semibold text-amber-700 hover:bg-amber-500/20 disabled:opacity-50 dark:text-amber-300 cursor-pointer"
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
                              className="inline-flex min-h-[44px] items-center rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 text-xs font-semibold text-emerald-700 hover:bg-emerald-500/20 disabled:opacity-50 dark:text-emerald-300 cursor-pointer"
                            >
                              Activate
                            </button>
                          )}

                          {sub.user_trial_used_at && (
                            <button
                              type="button"
                              disabled={isBusy}
                              onClick={() =>
                                void handleResetTrialEligibility(sub)
                              }
                              title="Reset one-time free trial eligibility (clears profiles.trial_used_at)"
                              className="inline-flex min-h-[44px] items-center gap-1 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-xs font-semibold text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] disabled:opacity-50 cursor-pointer"
                            >
                              <RotateCcw className="h-3.5 w-3.5" />
                              <span>Reset Trial</span>
                            </button>
                          )}

                          <button
                            type="button"
                            onClick={() => openManageModal(sub)}
                            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3.5 text-xs font-bold text-[var(--ps-accent-fg)] hover:opacity-95 cursor-pointer"
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
    </section>
  );
}
