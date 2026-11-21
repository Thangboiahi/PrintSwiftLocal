'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  CheckCircle2,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Sliders,
  Sparkles,
  X,
} from 'lucide-react';
import {
  CustomSelectModal,
  type CustomSelectOption,
} from '@/components/ui/CustomSelectModal';
import {
  ResponsiveTableScroll,
  WorkspaceTableToolbar,
} from '@/components/ui/ResponsiveTableWrapper';
import { setAppStatus } from '@/lib/hooks/useAppStatus';
import {
  SUBSCRIPTION_FEATURE_CATALOG,
  SUBSCRIPTION_LIMIT_CATALOG,
  formatSubscriptionLimitValue,
  type SubscriptionFeatureKey,
  type SubscriptionLimitKey,
} from '@/lib/subscriptions/feature-catalog';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';

type BillingCycleKey = '7d' | '30d' | '90d' | '365d' | 'one_time';

const BILLING_CYCLE_OPTIONS: CustomSelectOption[] = [
  { value: '7d', label: '7 Days (Weekly)' },
  { value: '30d', label: '30 Days (Monthly)' },
  { value: '90d', label: '90 Days (Quarterly)' },
  { value: '365d', label: '365 Days (Annual)' },
  { value: 'one_time', label: 'One-Time Pass' },
];

interface ComposablePlanRow {
  id: string;
  slug: string;
  name: string;
  price_inr: number;
  duration_days: number;
  billing_cycle: BillingCycleKey;
  is_addon: boolean;
  is_active: boolean;
  features: Partial<Record<SubscriptionFeatureKey, boolean>>;
  limits: Partial<Record<SubscriptionLimitKey, number>>;
}

interface BusinessSubOverrideRow {
  id: string;
  user_id: string;
  listing_id: string | null;
  plan_id: string | null;
  status: string;
  expires_at: string | null;
  entitlement_overrides: {
    features?: Partial<Record<SubscriptionFeatureKey, boolean>>;
    limits?: Partial<Record<SubscriptionLimitKey, number>>;
  };
  ownerLabel: string;
  planName: string;
}

export function ComposablePlanBuilderSection() {
  const [plans, setPlans] = useState<ComposablePlanRow[]>([]);
  const [subs, setSubs] = useState<BusinessSubOverrideRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [subSearch, setSubSearch] = useState('');
  const [subStatusFilter, setSubStatusFilter] = useState('all');

  // Plan Modal State (z-[90])
  const [editingPlan, setEditingPlan] = useState<ComposablePlanRow | null>(
    null
  );
  const [isNewPlan, setIsNewPlan] = useState(false);
  const [isSavingPlan, setIsSavingPlan] = useState(false);

  // Per-Business Override Modal State (z-[90])
  const [overrideTarget, setOverrideTarget] =
    useState<BusinessSubOverrideRow | null>(null);
  const [overrideFeatures, setOverrideFeatures] = useState<
    Partial<Record<SubscriptionFeatureKey, boolean>>
  >({});
  const [overrideLimits, setOverrideLimits] = useState<
    Partial<Record<SubscriptionLimitKey, number>>
  >({});
  const [isSavingOverride, setIsSavingOverride] = useState(false);

  const groupedFeatures = useMemo(() => {
    const map = new Map<
      string,
      Array<(typeof SUBSCRIPTION_FEATURE_CATALOG)[number]>
    >();
    for (const item of SUBSCRIPTION_FEATURE_CATALOG) {
      const list = map.get(item.verticalGroup) || [];
      list.push(item);
      map.set(item.verticalGroup, list);
    }
    return Array.from(map.entries());
  }, []);

  const loadData = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const [plansRes, subsRes] = await Promise.all([
        supabase
          .from('subscription_plans')
          .select(
            'id, slug, name, price_inr, duration_days, billing_cycle, is_addon, is_active, features, limits'
          )
          .order('price_inr', { ascending: true }),
        supabase
          .from('user_subscriptions')
          .select(
            'id, user_id, listing_id, plan_id, status, expires_at, entitlement_overrides, profiles:user_id(full_name, email), subscription_plans:plan_id(name)'
          )
          .order('created_at', { ascending: false })
          .limit(60),
      ]);

      if (!plansRes.error && Array.isArray(plansRes.data)) {
        setPlans(
          (plansRes.data as Array<Record<string, unknown>>).map((r) => ({
            id: String(r.id || ''),
            slug: String(r.slug || ''),
            name: String(r.name || 'Plan'),
            price_inr: Number(r.price_inr ?? 0),
            duration_days: Number(r.duration_days ?? 30),
            billing_cycle: (String(
              r.billing_cycle || '30d'
            ) as BillingCycleKey),
            is_addon: Boolean(r.is_addon),
            is_active: r.is_active !== false,
            features:
              r.features && typeof r.features === 'object'
                ? (r.features as Partial<Record<SubscriptionFeatureKey, boolean>>)
                : {},
            limits:
              r.limits && typeof r.limits === 'object'
                ? (r.limits as Partial<Record<SubscriptionLimitKey, number>>)
                : {},
          }))
        );
      }

      if (!subsRes.error && Array.isArray(subsRes.data)) {
        setSubs(
          (subsRes.data as Array<Record<string, unknown>>).map((r) => {
            const prof = Array.isArray(r.profiles)
              ? (r.profiles[0] as Record<string, unknown> | undefined)
              : (r.profiles as Record<string, unknown> | undefined);
            const plan = Array.isArray(r.subscription_plans)
              ? (r.subscription_plans[0] as Record<string, unknown> | undefined)
              : (r.subscription_plans as Record<string, unknown> | undefined);
            const ov =
              r.entitlement_overrides &&
              typeof r.entitlement_overrides === 'object'
                ? (r.entitlement_overrides as BusinessSubOverrideRow['entitlement_overrides'])
                : {};
            return {
              id: String(r.id || ''),
              user_id: String(r.user_id || ''),
              listing_id: r.listing_id ? String(r.listing_id) : null,
              plan_id: r.plan_id ? String(r.plan_id) : null,
              status: String(r.status || 'active'),
              expires_at: r.expires_at ? String(r.expires_at) : null,
              entitlement_overrides: ov,
              ownerLabel: String(
                prof?.full_name || prof?.email || r.user_id || 'User'
              ),
              planName: String(plan?.name || 'Custom Plan'),
            };
          })
        );
      }
    } catch {
      // Non-blocking
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const openNewPlanModal = () => {
    setIsNewPlan(true);
    setEditingPlan({
      id: '',
      slug: '',
      name: '',
      price_inr: 299,
      duration_days: 30,
      billing_cycle: '30d',
      is_addon: false,
      is_active: true,
      features: {},
      limits: {
        max_active_listings: 1,
        max_catalogue_items: 50,
        max_menu_items: 50,
        max_booking_resources: 3,
        max_staff_members: 2,
        max_monthly_bulletins: 2,
        max_media_per_listing: 10,
        active_boost_slots: 0,
      },
    });
  };

  const handleSavePlan = async () => {
    if (!editingPlan) return;
    if (!editingPlan.name.trim()) {
      setAppStatus('error', 'Plan name is required.');
      return;
    }
    const cleanSlug = (
      editingPlan.slug.trim() ||
      editingPlan.name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
    ).replace(/^_|_$/g, '');

    setIsSavingPlan(true);
    setAppStatus('saving', 'Saving composable subscription plan…');
    try {
      const payload = {
        slug: cleanSlug,
        name: editingPlan.name.trim(),
        price_inr: Number(editingPlan.price_inr) || 0,
        duration_days:
          editingPlan.billing_cycle === '7d'
            ? 7
            : editingPlan.billing_cycle === '90d'
              ? 90
              : editingPlan.billing_cycle === '365d'
                ? 365
                : editingPlan.duration_days || 30,
        billing_cycle: editingPlan.billing_cycle,
        is_addon: editingPlan.is_addon,
        is_active: editingPlan.is_active,
        features: editingPlan.features,
        limits: editingPlan.limits,
      };

      const { error } = isNewPlan
        ? await supabase.from('subscription_plans').insert(payload)
        : await supabase
            .from('subscription_plans')
            .update(payload)
            .eq('id', editingPlan.id);

      if (error) throw new Error(error.message);
      setAppStatus('success', `Saved plan "${payload.name}"`);
      setEditingPlan(null);
      void loadData();
    } catch (err) {
      setAppStatus(
        'error',
        err instanceof Error ? err.message : 'Failed to save plan.'
      );
    } finally {
      setIsSavingPlan(false);
    }
  };

  const openOverrideModal = (row: BusinessSubOverrideRow) => {
    setOverrideTarget(row);
    setOverrideFeatures({ ...(row.entitlement_overrides?.features || {}) });
    setOverrideLimits({ ...(row.entitlement_overrides?.limits || {}) });
  };

  const handleSaveOverride = async () => {
    if (!overrideTarget) return;
    setIsSavingOverride(true);
    setAppStatus('saving', 'Saving custom business entitlement overrides…');
    try {
      const { error } = await supabase
        .from('user_subscriptions')
        .update({
          entitlement_overrides: {
            features: overrideFeatures,
            limits: overrideLimits,
          },
        })
        .eq('id', overrideTarget.id);
      if (error) throw new Error(error.message);
      setAppStatus('success', 'Custom overrides saved.');
      setOverrideTarget(null);
      void loadData();
    } catch (err) {
      setAppStatus(
        'error',
        err instanceof Error ? err.message : 'Failed to save overrides.'
      );
    } finally {
      setIsSavingOverride(false);
    }
  };

  const filteredSubs = useMemo(() => {
    const q = subSearch.trim().toLowerCase();
    return subs.filter((s) => {
      if (subStatusFilter !== 'all' && s.status !== subStatusFilter) {
        return false;
      }
      if (!q) return true;
      return `${s.ownerLabel} ${s.planName} ${s.listing_id || ''}`
        .toLowerCase()
        .includes(q);
    });
  }, [subs, subSearch, subStatusFilter]);

  return (
    <div
      data-testid="composable-plan-builder-section"
      className="space-y-5 text-xs"
    >
      {/* 1. Composable Subscription Plans Header & Grid */}
      <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-[var(--ps-text)] flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-[var(--ps-accent)]" />
              <span>Composable Subscription &amp; Add-On Plan Builder</span>
            </h3>
            <p className="text-[11px] text-[var(--ps-text-muted)]">
              Combine any of the 13 boolean feature flags and 8 numeric quotas across verticals without rigid tier locks.
            </p>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => void loadData()}
              className="h-8 px-2.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] font-semibold text-[var(--ps-text)] inline-flex items-center gap-1 cursor-pointer"
            >
              <RefreshCw
                className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`}
              />
              <span>Refresh</span>
            </button>
            <button
              type="button"
              onClick={openNewPlanModal}
              data-testid="create-composable-plan-btn"
              className="h-8 px-3 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] font-bold inline-flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>New Composable Plan</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {plans.map((plan) => {
            const enabledCount = Object.values(plan.features || {}).filter(
              Boolean
            ).length;
            return (
              <div
                key={plan.id}
                className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 flex flex-col justify-between gap-2.5"
              >
                <div className="space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-bold text-sm text-[var(--ps-text)] truncate">
                      {plan.name}
                    </span>
                    <span className="font-extrabold text-[var(--ps-accent)] tabular-nums shrink-0">
                      ₹{plan.price_inr}/{plan.billing_cycle}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1 text-[10px]">
                    {plan.is_addon && (
                      <span className="px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 font-bold">
                        Stackable Add-On
                      </span>
                    )}
                    <span className="px-1.5 py-0.5 rounded bg-[var(--ps-surface)] border border-[var(--ps-border)] text-[var(--ps-text-muted)] font-semibold">
                      {enabledCount} features
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded font-bold ${
                        plan.is_active
                          ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                          : 'bg-slate-200 dark:bg-slate-800 text-slate-500'
                      }`}
                    >
                      {plan.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsNewPlan(false);
                    setEditingPlan(plan);
                  }}
                  className="h-8 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] hover:border-[var(--ps-accent)] font-semibold text-[var(--ps-text)] inline-flex items-center justify-center gap-1.5 cursor-pointer"
                >
                  <Sliders className="w-3.5 h-3.5 text-[var(--ps-accent)]" />
                  <span>Edit Features &amp; Limits</span>
                </button>
              </div>
            );
          })}
        </div>
      </section>

      {/* 2. Business Subscriptions & Custom Overrides Table */}
      <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3">
        <div>
          <h3 className="text-sm font-bold text-[var(--ps-text)]">
            Business Subscriptions &amp; Custom Overrides
          </h3>
          <p className="text-[11px] text-[var(--ps-text-muted)]">
            Grant or revoke individual features or dial custom quotas per business without altering public plans.
          </p>
        </div>

        <WorkspaceTableToolbar
          searchQuery={subSearch}
          onSearchChange={setSubSearch}
          searchPlaceholder="Search owner, plan, or listing ID…"
          hasActiveFilters={Boolean(subSearch || subStatusFilter !== 'all')}
          onResetFilters={() => {
            setSubSearch('');
            setSubStatusFilter('all');
          }}
        >
          <div className="flex items-center gap-1">
            {(['all', 'active', 'paused', 'expired'] as const).map((st) => (
              <button
                key={st}
                type="button"
                onClick={() => setSubStatusFilter(st)}
                className={`h-8 px-2.5 rounded-lg text-[11px] font-semibold capitalize cursor-pointer ${
                  subStatusFilter === st
                    ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                    : 'bg-[var(--ps-bg)] text-[var(--ps-text-muted)] border border-[var(--ps-border)]'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        </WorkspaceTableToolbar>

        <ResponsiveTableScroll>
          <table className="w-full text-left border-collapse min-w-[640px]">
            <thead>
              <tr className="border-b border-[var(--ps-border)] text-[10px] uppercase tracking-wider text-[var(--ps-text-muted)]">
                <th className="py-2 px-3">Owner / Business</th>
                <th className="py-2 px-3">Plan</th>
                <th className="py-2 px-3">Status</th>
                <th className="py-2 px-3">Overrides</th>
                <th className="py-2 px-3 text-right">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--ps-border)]/60">
              {filteredSubs.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="py-6 text-center text-[var(--ps-text-muted)]"
                  >
                    No matching subscriptions found.
                  </td>
                </tr>
              ) : (
                filteredSubs.map((row) => {
                  const ovFeatCount = Object.keys(
                    row.entitlement_overrides?.features || {}
                  ).length;
                  const ovLimCount = Object.keys(
                    row.entitlement_overrides?.limits || {}
                  ).length;
                  return (
                    <tr key={row.id} className="hover:bg-[var(--ps-bg)]/60">
                      <td className="py-2.5 px-3 font-semibold text-[var(--ps-text)]">
                        {row.ownerLabel}
                      </td>
                      <td className="py-2.5 px-3 text-[var(--ps-text-muted)]">
                        {row.planName}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-emerald-500/12 text-emerald-700 dark:text-emerald-300">
                          {row.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-[11px] text-[var(--ps-text-muted)]">
                        {ovFeatCount + ovLimCount > 0
                          ? `${ovFeatCount} flags · ${ovLimCount} limits`
                          : 'Standard plan'}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <button
                          type="button"
                          onClick={() => openOverrideModal(row)}
                          data-testid={`customize-override-${row.id}`}
                          className="h-7 px-2.5 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] hover:border-[var(--ps-accent)] text-[11px] font-semibold text-[var(--ps-text)] cursor-pointer"
                        >
                          Customize Overrides
                        </button>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </ResponsiveTableScroll>
      </section>

      {/* Composable Plan Add/Edit Modal (z-[90]) */}
      {editingPlan &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Edit composable subscription plan"
            data-testid="composable-plan-modal"
            className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 backdrop-blur-xs p-4"
          >
            <div className="w-full max-w-2xl max-h-[88dvh] rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] shadow-2xl flex flex-col overflow-hidden text-xs">
              <div className="px-4 py-3 border-b border-[var(--ps-border)] flex items-center justify-between gap-2 shrink-0">
                <span className="font-bold text-sm text-[var(--ps-text)]">
                  {isNewPlan
                    ? 'Create Composable Plan'
                    : `Edit Plan: ${editingPlan.name}`}
                </span>
                <button
                  type="button"
                  onClick={() => setEditingPlan(null)}
                  className="w-8 h-8 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] flex items-center justify-center cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-[11px] font-semibold mb-1">
                      Plan Name
                    </label>
                    <input
                      type="text"
                      value={editingPlan.name}
                      onChange={(e) =>
                        setEditingPlan({ ...editingPlan, name: e.target.value })
                      }
                      className="w-full h-9 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold mb-1">
                      Price (₹ INR)
                    </label>
                    <input
                      type="number"
                      min={0}
                      value={editingPlan.price_inr}
                      onChange={(e) =>
                        setEditingPlan({
                          ...editingPlan,
                          price_inr: Number(e.target.value),
                        })
                      }
                      className="w-full h-9 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold mb-1">
                      Billing Cycle
                    </label>
                    <CustomSelectModal
                      options={BILLING_CYCLE_OPTIONS}
                      value={editingPlan.billing_cycle}
                      onChange={(val) =>
                        setEditingPlan({
                          ...editingPlan,
                          billing_cycle: val as BillingCycleKey,
                        })
                      }
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-4">
                  <label className="inline-flex items-center gap-2 font-semibold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editingPlan.is_addon}
                      onChange={(e) =>
                        setEditingPlan({
                          ...editingPlan,
                          is_addon: e.target.checked,
                        })
                      }
                    />
                    <span>Stackable Add-On Pack</span>
                  </label>
                  <label className="inline-flex items-center gap-2 font-semibold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={editingPlan.is_active}
                      onChange={(e) =>
                        setEditingPlan({
                          ...editingPlan,
                          is_active: e.target.checked,
                        })
                      }
                    />
                    <span>Active for Purchase</span>
                  </label>
                </div>

                {/* 13 Boolean Feature Flags grouped by vertical */}
                <div className="space-y-3">
                  <div className="font-bold text-[var(--ps-text)]">
                    Feature Flags (13 Composable Capabilities)
                  </div>
                  {groupedFeatures.map(([groupName, items]) => (
                    <div
                      key={groupName}
                      className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 space-y-2"
                    >
                      <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                        {groupName}
                      </div>
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                        {items.map((feat) => {
                          const checked = Boolean(
                            editingPlan.features?.[feat.key]
                          );
                          return (
                            <label
                              key={feat.key}
                              className="flex items-center gap-2 cursor-pointer"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={(e) =>
                                  setEditingPlan({
                                    ...editingPlan,
                                    features: {
                                      ...editingPlan.features,
                                      [feat.key]: e.target.checked,
                                    },
                                  })
                                }
                              />
                              <span className="font-medium text-[var(--ps-text)]">
                                {feat.label}
                              </span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                {/* 8 Numeric Quotas (-1 = Unlimited, 0 = Disabled) */}
                <div className="space-y-2">
                  <div className="font-bold text-[var(--ps-text)]">
                    Numeric Quotas (-1 = Unlimited, 0 = Disabled)
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {SUBSCRIPTION_LIMIT_CATALOG.map((lim) => {
                      const val = editingPlan.limits?.[lim.key] ?? 0;
                      return (
                        <div
                          key={lim.key}
                          className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 flex items-center justify-between gap-2"
                        >
                          <div className="min-w-0">
                            <div className="font-semibold text-[var(--ps-text)] truncate">
                              {lim.label}
                            </div>
                            <div className="text-[10px] text-[var(--ps-text-muted)]">
                              {formatSubscriptionLimitValue(val)}
                            </div>
                          </div>
                          <input
                            type="number"
                            min={-1}
                            value={val}
                            onChange={(e) =>
                              setEditingPlan({
                                ...editingPlan,
                                limits: {
                                  ...editingPlan.limits,
                                  [lim.key]: Number(e.target.value),
                                },
                              })
                            }
                            className="w-20 h-8 px-2 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] text-right font-mono"
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="px-4 py-3 border-t border-[var(--ps-border)] flex justify-end gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setEditingPlan(null)}
                  className="h-9 px-3.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isSavingPlan}
                  onClick={() => void handleSavePlan()}
                  className="h-9 px-4 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] font-bold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  {isSavingPlan ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <Save className="w-3.5 h-3.5" />
                  )}
                  <span>Save Plan</span>
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* Per-Business Customize Overrides Modal (z-[90]) */}
      {overrideTarget &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Customize business entitlement overrides"
            data-testid="business-override-modal"
            className="fixed inset-0 z-[90] flex items-center justify-center bg-black/55 backdrop-blur-xs p-4"
          >
            <div className="w-full max-w-lg max-h-[85dvh] rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] shadow-2xl flex flex-col overflow-hidden text-xs">
              <div className="px-4 py-3 border-b border-[var(--ps-border)] flex items-center justify-between gap-2 shrink-0">
                <div>
                  <div className="font-bold text-sm text-[var(--ps-text)]">
                    Customize Overrides
                  </div>
                  <div className="text-[11px] text-[var(--ps-text-muted)]">
                    {overrideTarget.ownerLabel} · {overrideTarget.planName}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => setOverrideTarget(null)}
                  className="w-8 h-8 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] flex items-center justify-center cursor-pointer"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-4 space-y-4">
                <div className="space-y-2">
                  <div className="font-bold text-[var(--ps-text)]">
                    Override Feature Flags
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
                    {SUBSCRIPTION_FEATURE_CATALOG.map((feat) => {
                      const val = overrideFeatures[feat.key] === true;
                      return (
                        <label
                          key={feat.key}
                          className="flex items-center gap-2 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 py-1.5 cursor-pointer"
                        >
                          <input
                            type="checkbox"
                            checked={val}
                            onChange={(e) =>
                              setOverrideFeatures((prev) => ({
                                ...prev,
                                [feat.key]: e.target.checked,
                              }))
                            }
                          />
                          <span className="truncate">{feat.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="font-bold text-[var(--ps-text)]">
                    Override Numeric Quotas (-1 = Unlimited)
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {SUBSCRIPTION_LIMIT_CATALOG.map((lim) => (
                      <div
                        key={lim.key}
                        className="rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 py-1.5 flex items-center justify-between gap-2"
                      >
                        <span className="truncate">{lim.label}</span>
                        <input
                          type="number"
                          min={-1}
                          placeholder="Plan"
                          value={overrideLimits[lim.key] ?? ''}
                          onChange={(e) => {
                            const raw = e.target.value;
                            setOverrideLimits((prev) => {
                              const next = { ...prev };
                              if (raw === '') {
                                delete next[lim.key];
                              } else {
                                next[lim.key] = Number(raw);
                              }
                              return next;
                            });
                          }}
                          className="w-16 h-7 px-2 rounded border border-[var(--ps-border)] bg-[var(--ps-surface)] text-right font-mono"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              <div className="px-4 py-3 border-t border-[var(--ps-border)] flex justify-end gap-2 shrink-0">
                <button
                  type="button"
                  onClick={() => setOverrideTarget(null)}
                  className="h-9 px-3.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isSavingOverride}
                  onClick={() => void handleSaveOverride()}
                  className="h-9 px-4 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] font-bold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  {isSavingOverride ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  )}
                  <span>Save Overrides</span>
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}

export default ComposablePlanBuilderSection;
