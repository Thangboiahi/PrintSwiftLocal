'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Archive,
  Check,
  CheckCircle2,
  Copy,
  Crown,
  Infinity as InfinityIcon,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Sliders,
  Sparkles,
  X,
} from 'lucide-react';
import { useConfirmDialogState } from '@/components/ui/ConfirmDialog';
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
  FEATURE_KEY_ALIASES,
  LIMIT_KEY_ALIASES,
  SUBSCRIPTION_FEATURE_CATALOG,
  SUBSCRIPTION_LIMIT_CATALOG,
  formatSubscriptionLimitValue,
  type SubscriptionFeatureGroup,
  type SubscriptionFeatureKey,
  type SubscriptionLimitKey,
} from '@/lib/subscriptions/feature-catalog';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { LISTING_VERTICALS, type ListingVertical } from '@/lib/verticals/types';

type BillingCycleKey =
  | 'monthly'
  | 'quarterly'
  | 'yearly'
  | 'one_time'
  | '7d'
  | '30d'
  | '90d'
  | '365d';

const BILLING_CYCLE_OPTIONS: CustomSelectOption[] = [
  { value: 'monthly', label: 'Monthly (30 Days)', description: 'Standard monthly billing' },
  { value: 'quarterly', label: 'Quarterly (90 Days)', description: '3-month discounted pack' },
  { value: 'yearly', label: 'Yearly (365 Days)', description: 'Annual billing cycle' },
  { value: 'one_time', label: 'One-Time Pass (30 Days)', description: 'Single pass without auto-renew' },
  { value: '7d', label: '7-Day Weekly Pass', description: 'Short campaign or trial pass' },
];

const FEATURE_GROUPS: readonly SubscriptionFeatureGroup[] = [
  'Core & Discovery',
  'Print & Digital',
  'Bookings & Stays',
  'Shops & Food',
  'Real Estate & Visibility',
  'Team & Growth',
];

const VERTICAL_TARGET_LABELS: Record<ListingVertical, string> = {
  general: 'General & Services',
  print_digital: 'Print & Digital',
  booking_venue: 'Booking & Turf',
  hotel_stay: 'Hotels & Stays',
  shop_catalogue: 'Shop Catalogue',
  restaurant_food: 'Restaurants & Café',
  real_estate: 'Real Estate',
  public_civic: 'Public & Civic',
};

interface ComposablePlanRow {
  id: string;
  slug: string;
  name: string;
  price_inr: number;
  original_price_inr: number | null;
  duration_days: number;
  billing_cycle: BillingCycleKey;
  target_verticals: string[];
  trial_days: number;
  grace_period_days: number;
  display_order: number;
  is_popular: boolean;
  is_addon: boolean;
  is_active: boolean;
  tagline: string;
  highlights: string[];
  features: Partial<Record<SubscriptionFeatureKey, boolean>>;
  limits: Partial<Record<SubscriptionLimitKey, number | null>>;
}

interface BusinessSubOverrideRow {
  id: string;
  user_id: string;
  listing_id: string | null;
  plan_id: string | null;
  status: string;
  expires_at: string | null;
  override_reason: string | null;
  override_expires_at: string | null;
  entitlement_overrides: {
    features?: Partial<Record<SubscriptionFeatureKey, boolean | null>>;
    limits?: Partial<Record<SubscriptionLimitKey, number | null>>;
    reason?: string | null;
    expires_at?: string | null;
  };
  ownerLabel: string;
  planName: string;
}

type PlanSectionTab = 'identity' | 'features' | 'limits' | 'preview';

function normalizeBillingCycle(raw: string): BillingCycleKey {
  const s = (raw || 'monthly').toLowerCase();
  if (s === '30d' || s === 'monthly') return 'monthly';
  if (s === '90d' || s === 'quarterly') return 'quarterly';
  if (s === '365d' || s === 'yearly') return 'yearly';
  if (s === '7d') return '7d';
  if (s === 'one_time') return 'one_time';
  return 'monthly';
}

function cycleDurationDays(cycle: BillingCycleKey): number {
  if (cycle === '7d') return 7;
  if (cycle === 'quarterly' || cycle === '90d') return 90;
  if (cycle === 'yearly' || cycle === '365d') return 365;
  return 30;
}

function toDatetimeLocalValue(iso?: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function buildDefaultLimits(): Partial<Record<SubscriptionLimitKey, number | null>> {
  const out: Partial<Record<SubscriptionLimitKey, number | null>> = {};
  for (const item of SUBSCRIPTION_LIMIT_CATALOG) {
    out[item.key] = item.defaultValue;
  }
  return out;
}

function buildDefaultFeatures(): Partial<Record<SubscriptionFeatureKey, boolean>> {
  const out: Partial<Record<SubscriptionFeatureKey, boolean>> = {};
  for (const item of SUBSCRIPTION_FEATURE_CATALOG) {
    out[item.key] = item.defaultValue;
  }
  return out;
}

export function ComposablePlanBuilderSection() {
  const { confirm, dialog: confirmDialog } = useConfirmDialogState();

  const [plans, setPlans] = useState<ComposablePlanRow[]>([]);
  const [subs, setSubs] = useState<BusinessSubOverrideRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [subSearch, setSubSearch] = useState('');
  const [subStatusFilter, setSubStatusFilter] = useState('all');

  // Plan Create / Edit / Duplicate Modal
  const [editingPlan, setEditingPlan] = useState<ComposablePlanRow | null>(null);
  const [planSection, setPlanSection] = useState<PlanSectionTab>('identity');
  const [highlightsDraft, setHighlightsDraft] = useState('');
  const [slugTouched, setSlugTouched] = useState(false);
  const [isNewPlan, setIsNewPlan] = useState(false);
  const [isSavingPlan, setIsSavingPlan] = useState(false);

  // Per-Business Override Modal
  const [overrideTarget, setOverrideTarget] =
    useState<BusinessSubOverrideRow | null>(null);
  const [overrideFeatures, setOverrideFeatures] = useState<
    Partial<Record<SubscriptionFeatureKey, boolean | null>>
  >({});
  const [overrideLimits, setOverrideLimits] = useState<
    Partial<Record<SubscriptionLimitKey, number | null>>
  >({});
  // Track which limits explicitly have a limit override active ('inherit' | 'custom' | 'unlimited')
  const [overrideLimitModes, setOverrideLimitModes] = useState<
    Partial<Record<SubscriptionLimitKey, 'inherit' | 'custom' | 'unlimited'>>
  >({});
  const [overrideReason, setOverrideReason] = useState('');
  const [overrideExpiresLocal, setOverrideExpiresLocal] = useState('');
  const [isSavingOverride, setIsSavingOverride] = useState(false);

  const groupedFeatures = useMemo(() => {
    return FEATURE_GROUPS.map((groupName) => ({
      groupName,
      items: SUBSCRIPTION_FEATURE_CATALOG.filter((f) => f.group === groupName),
    })).filter((g) => g.items.length > 0);
  }, []);

  const subscriberCountByPlanId = useMemo(() => {
    const counts = new Map<string, number>();
    for (const s of subs) {
      if (s.plan_id && (s.status === 'active' || s.status === 'trialing')) {
        counts.set(s.plan_id, (counts.get(s.plan_id) || 0) + 1);
      }
    }
    return counts;
  }, [subs]);

  const loadData = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const [plansRes, subsRes] = await Promise.all([
        supabase
          .rpc('superadmin_list_subscription_plans')
          .order('display_order', { ascending: true })
          .order('price_inr', { ascending: true }),
        supabase
          .from('user_subscriptions')
          .select(
            '*, profiles:user_id(full_name, email), subscription_plans:plan_id(name)'
          )
          .order('created_at', { ascending: false })
          .limit(120),
      ]);

      let resolvedPlans = plansRes;
      if (resolvedPlans.error) {
        resolvedPlans = await supabase
          .from('subscription_plans')
          .select(
            'id, slug, name, price_inr, duration_days, billing_cycle, is_addon, is_active, features, limits, entitlements'
          )
          .order('price_inr', { ascending: true });
      }

      if (!resolvedPlans.error && Array.isArray(resolvedPlans.data)) {
        setPlans(
          (resolvedPlans.data as Array<Record<string, unknown>>).map((r) => {
            const legacyEnt =
              r.entitlements && typeof r.entitlements === 'object'
                ? (r.entitlements as Record<string, unknown>)
                : {};
            const meta =
              legacyEnt.plan_meta && typeof legacyEnt.plan_meta === 'object'
                ? (legacyEnt.plan_meta as Record<string, unknown>)
                : {};

            const rawFeatures =
              r.features && typeof r.features === 'object'
                ? (r.features as Partial<Record<SubscriptionFeatureKey, boolean>>)
                : {};
            const rawLimits =
              r.limits && typeof r.limits === 'object'
                ? (r.limits as Partial<Record<SubscriptionLimitKey, number | null>>)
                : {};

            const rawTargets = Array.isArray(r.target_verticals)
              ? r.target_verticals
              : Array.isArray(meta.target_verticals)
              ? meta.target_verticals
              : [];

            const rawHighlights = Array.isArray(r.highlights)
              ? r.highlights
              : Array.isArray(meta.highlights)
              ? meta.highlights
              : [];

            return {
              id: String(r.id || ''),
              slug: String(r.slug || ''),
              name: String(r.name || 'Plan'),
              price_inr: Number(r.price_inr ?? 0),
              original_price_inr:
                typeof r.original_price_inr === 'number'
                  ? r.original_price_inr
                  : typeof meta.original_price_inr === 'number'
                  ? meta.original_price_inr
                  : null,
              duration_days: Number(r.duration_days ?? 30),
              billing_cycle: normalizeBillingCycle(String(r.billing_cycle || 'monthly')),
              target_verticals: rawTargets.map(String),
              trial_days: Number(r.trial_days ?? meta.trial_days ?? 0),
              grace_period_days: Number(
                r.grace_period_days ?? meta.grace_period_days ?? 3
              ),
              display_order: Number(
                r.display_order ?? meta.display_order ?? 100
              ),
              is_popular: Boolean(r.is_popular ?? meta.is_popular ?? false),
              is_addon: Boolean(r.is_addon),
              is_active: r.is_active !== false,
              tagline: String(r.tagline ?? meta.tagline ?? ''),
              highlights: rawHighlights.map(String),
              features: rawFeatures,
              limits: rawLimits,
            };
          })
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
              override_reason: r.override_reason
                ? String(r.override_reason)
                : ov.reason || null,
              override_expires_at: r.override_expires_at
                ? String(r.override_expires_at)
                : ov.expires_at || null,
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
    let active = true;
    queueMicrotask(() => {
      if (active) {
        void loadData();
      }
    });
    return () => {
      active = false;
    };
  }, [loadData]);

  const openPlanEditor = (
    mode: 'new' | 'edit' | 'duplicate',
    source?: ComposablePlanRow
  ) => {
    setPlanSection('identity');
    if (mode === 'new' || !source) {
      setIsNewPlan(true);
      setSlugTouched(false);
      setHighlightsDraft(
        'Verified trust presence\nZero commission direct payments\nPriority hub placement'
      );
      setEditingPlan({
        id: '',
        slug: '',
        name: '',
        price_inr: 299,
        original_price_inr: null,
        duration_days: 30,
        billing_cycle: 'monthly',
        target_verticals: [],
        trial_days: 0,
        grace_period_days: 3,
        display_order: (plans.length + 1) * 10,
        is_popular: false,
        is_addon: false,
        is_active: true,
        tagline: '',
        highlights: [
          'Verified trust presence',
          'Zero commission direct payments',
          'Priority hub placement',
        ],
        features: buildDefaultFeatures(),
        limits: buildDefaultLimits(),
      });
      return;
    }

    if (mode === 'duplicate') {
      setIsNewPlan(true);
      setSlugTouched(false);
      const copyName = `${source.name} (Copy)`;
      setHighlightsDraft(source.highlights.join('\n'));
      setEditingPlan({
        ...structuredClone(source),
        id: '',
        name: copyName,
        slug: `${source.slug}_copy_${Date.now().toString().slice(-4)}`,
        is_popular: false,
      });
      return;
    }

    setIsNewPlan(false);
    setSlugTouched(true);
    setHighlightsDraft(source.highlights.join('\n'));
    setEditingPlan({
      ...structuredClone(source),
      features: { ...buildDefaultFeatures(), ...source.features },
      limits: { ...buildDefaultLimits(), ...source.limits },
    });
  };

  const toggleFeatureGroup = (
    groupItems: ReadonlyArray<(typeof SUBSCRIPTION_FEATURE_CATALOG)[number]>,
    value: boolean
  ) => {
    if (!editingPlan) return;
    const nextFeatures = { ...editingPlan.features };
    for (const item of groupItems) {
      nextFeatures[item.key] = value;
      const alias = FEATURE_KEY_ALIASES[item.key];
      if (alias) nextFeatures[alias] = value;
    }
    setEditingPlan({ ...editingPlan, features: nextFeatures });
  };

  const handleSavePlan = async () => {
    if (!editingPlan) return;
    if (!editingPlan.name.trim()) {
      setAppStatus('error', 'Plan name is required.');
      setPlanSection('identity');
      return;
    }

    const activeSubscribers = !isNewPlan
      ? subscriberCountByPlanId.get(editingPlan.id) || 0
      : 0;

    const ok = await confirm({
      title: isNewPlan
        ? `Create Subscription Plan "${editingPlan.name.trim()}"?`
        : `Save Changes to "${editingPlan.name.trim()}"?`,
      description: isNewPlan
        ? 'Adds this composable plan to subscription_plans immediately with all configured feature flags and quotas.'
        : `${activeSubscribers} active subscriber(s) currently inherit this plan. Updating features or quotas takes effect immediately via get_effective_entitlements().`,
      confirmLabel: isNewPlan ? 'Create Plan' : 'Save & Apply Plan',
    });
    if (!ok) return;

    const cleanSlug = (
      editingPlan.slug.trim() ||
      editingPlan.name
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
    ).replace(/^_|_$/g, '');

    const cleanHighlights = highlightsDraft
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);

    // Sync feature aliases + limit aliases cleanly (null => -1 Unlimited inside DB limits jsonb too, or preserve null)
    const syncedFeatures: Partial<Record<SubscriptionFeatureKey, boolean>> = {
      ...editingPlan.features,
    };
    for (const [k, alias] of Object.entries(FEATURE_KEY_ALIASES)) {
      const fKey = k as SubscriptionFeatureKey;
      const aKey = alias as SubscriptionFeatureKey;
      if (typeof syncedFeatures[fKey] === 'boolean' && !(aKey in syncedFeatures)) {
        syncedFeatures[aKey] = syncedFeatures[fKey];
      }
    }

    const syncedLimits: Partial<Record<SubscriptionLimitKey, number | null>> = {
      ...editingPlan.limits,
    };
    for (const [k, alias] of Object.entries(LIMIT_KEY_ALIASES)) {
      const lKey = k as SubscriptionLimitKey;
      const aKey = alias as SubscriptionLimitKey;
      if (lKey in syncedLimits && !(aKey in syncedLimits)) {
        syncedLimits[aKey] = syncedLimits[lKey];
      }
    }

    const planMeta = {
      target_verticals: editingPlan.target_verticals,
      original_price_inr: editingPlan.original_price_inr,
      trial_days: editingPlan.trial_days,
      grace_period_days: editingPlan.grace_period_days,
      display_order: editingPlan.display_order,
      is_popular: editingPlan.is_popular,
      tagline: editingPlan.tagline.trim() || null,
      highlights: cleanHighlights,
    };

    const fullPayload = {
      slug: cleanSlug,
      name: editingPlan.name.trim(),
      price_inr: Math.max(0, Number(editingPlan.price_inr) || 0),
      original_price_inr:
        editingPlan.original_price_inr !== null &&
        Number.isFinite(editingPlan.original_price_inr)
          ? Math.max(0, editingPlan.original_price_inr)
          : null,
      duration_days: cycleDurationDays(editingPlan.billing_cycle),
      billing_cycle: editingPlan.billing_cycle,
      target_verticals: editingPlan.target_verticals,
      trial_days: Math.max(0, Number(editingPlan.trial_days) || 0),
      grace_period_days: Math.max(0, Number(editingPlan.grace_period_days) || 0),
      display_order: Number(editingPlan.display_order) || 100,
      is_popular: editingPlan.is_popular,
      is_addon: editingPlan.is_addon,
      is_active: editingPlan.is_active,
      tagline: editingPlan.tagline.trim() || null,
      highlights: cleanHighlights,
      features: syncedFeatures,
      limits: syncedLimits,
      entitlements: { plan_meta: planMeta },
    };

    const fallbackPayload = {
      slug: fullPayload.slug,
      name: fullPayload.name,
      price_inr: fullPayload.price_inr,
      duration_days: fullPayload.duration_days,
      billing_cycle: fullPayload.billing_cycle,
      is_addon: fullPayload.is_addon,
      is_active: fullPayload.is_active,
      features: fullPayload.features,
      limits: fullPayload.limits,
      entitlements: fullPayload.entitlements,
    };

    setIsSavingPlan(true);
    setAppStatus('saving', 'Saving composable subscription plan…');
    try {
      let { error } = isNewPlan
        ? await supabase.from('subscription_plans').insert(fullPayload)
        : await supabase
            .from('subscription_plans')
            .update(fullPayload)
            .eq('id', editingPlan.id);

      if (error && /column|schema cache|does not exist/i.test(error.message)) {
        const retry = isNewPlan
          ? await supabase.from('subscription_plans').insert(fallbackPayload)
          : await supabase
              .from('subscription_plans')
              .update(fallbackPayload)
              .eq('id', editingPlan.id);
        error = retry.error;
      }

      if (error) throw new Error(error.message);
      setAppStatus('success', `Saved subscription plan "${fullPayload.name}".`);
      setEditingPlan(null);
      await loadData();
    } catch (err) {
      setAppStatus(
        'error',
        err instanceof Error ? err.message : 'Failed to save plan.'
      );
    } finally {
      setIsSavingPlan(false);
    }
  };

  const handleTogglePlanArchive = async (plan: ComposablePlanRow) => {
    const nextActive = !plan.is_active;
    const count = subscriberCountByPlanId.get(plan.id) || 0;
    const ok = await confirm({
      title: nextActive
        ? `Activate "${plan.name}" for Purchase?`
        : `Archive "${plan.name}" from Storefront?`,
      description: nextActive
        ? 'Plan will be selectable by business owners and staff.'
        : `Hides this plan from new signups (${count} existing active subscriber(s) keep access until expiry).`,
      confirmLabel: nextActive ? 'Activate Plan' : 'Archive Plan',
      variant: nextActive ? 'info' : 'danger',
    });
    if (!ok) return;

    setAppStatus('saving', 'Updating plan status…');
    const { error } = await supabase
      .from('subscription_plans')
      .update({ is_active: nextActive })
      .eq('id', plan.id);
    if (error) {
      setAppStatus('error', error.message);
      return;
    }
    setAppStatus(
      'success',
      nextActive ? `Activated "${plan.name}".` : `Archived "${plan.name}".`
    );
    await loadData();
  };

  const openOverrideModal = (row: BusinessSubOverrideRow) => {
    setOverrideTarget(row);
    const rawFeats = row.entitlement_overrides?.features || {};
    const nextFeats: Partial<Record<SubscriptionFeatureKey, boolean | null>> = {};
    for (const f of SUBSCRIPTION_FEATURE_CATALOG) {
      const val = rawFeats[f.key];
      if (typeof val === 'boolean') nextFeats[f.key] = val;
    }
    setOverrideFeatures(nextFeats);

    const rawLims = row.entitlement_overrides?.limits || {};
    const nextLims: Partial<Record<SubscriptionLimitKey, number | null>> = {};
    const nextModes: Partial<
      Record<SubscriptionLimitKey, 'inherit' | 'custom' | 'unlimited'>
    > = {};

    for (const l of SUBSCRIPTION_LIMIT_CATALOG) {
      if (l.key in rawLims) {
        const v = rawLims[l.key];
        if (v === null || (typeof v === 'number' && v < 0)) {
          nextModes[l.key] = 'unlimited';
          nextLims[l.key] = null;
        } else if (typeof v === 'number') {
          nextModes[l.key] = 'custom';
          nextLims[l.key] = v;
        } else {
          nextModes[l.key] = 'inherit';
        }
      } else {
        nextModes[l.key] = 'inherit';
      }
    }

    setOverrideLimits(nextLims);
    setOverrideLimitModes(nextModes);
    setOverrideReason(
      row.override_reason || row.entitlement_overrides?.reason || ''
    );
    setOverrideExpiresLocal(
      toDatetimeLocalValue(
        row.override_expires_at || row.entitlement_overrides?.expires_at
      )
    );
  };

  const handleSaveOverride = async () => {
    if (!overrideTarget) return;

    const ok = await confirm({
      title: `Save Super-Admin Overrides for "${overrideTarget.ownerLabel}"?`,
      description:
        'Manual Force-Enable / Force-Disable flags and custom numeric quotas immediately override all base subscription plan defaults.',
      confirmLabel: 'Apply Overrides',
    });
    if (!ok) return;

    const cleanFeatures: Partial<Record<SubscriptionFeatureKey, boolean>> = {};
    for (const [k, val] of Object.entries(overrideFeatures)) {
      if (typeof val === 'boolean') {
        const fKey = k as SubscriptionFeatureKey;
        cleanFeatures[fKey] = val;
        const alias = FEATURE_KEY_ALIASES[fKey];
        if (alias) cleanFeatures[alias] = val;
      }
    }

    const cleanLimits: Partial<Record<SubscriptionLimitKey, number | null>> = {};
    for (const lim of SUBSCRIPTION_LIMIT_CATALOG) {
      const mode = overrideLimitModes[lim.key] || 'inherit';
      if (mode === 'unlimited') {
        cleanLimits[lim.key] = null;
        const alias = LIMIT_KEY_ALIASES[lim.key];
        if (alias) cleanLimits[alias] = null;
      } else if (mode === 'custom') {
        const num = Math.max(0, Number(overrideLimits[lim.key] ?? 0));
        cleanLimits[lim.key] = num;
        const alias = LIMIT_KEY_ALIASES[lim.key];
        if (alias) cleanLimits[alias] = num;
      }
    }

    const expIso = overrideExpiresLocal.trim()
      ? new Date(overrideExpiresLocal).toISOString()
      : null;

    const overrideJson = {
      features: cleanFeatures,
      limits: cleanLimits,
      reason: overrideReason.trim() || null,
      expires_at: expIso,
    };

    setIsSavingOverride(true);
    setAppStatus('saving', 'Saving Super-Admin manual entitlement overrides…');
    try {
      let { error } = await supabase
        .from('user_subscriptions')
        .update({
          entitlement_overrides: overrideJson,
          override_reason: overrideReason.trim() || null,
          override_expires_at: expIso,
        })
        .eq('id', overrideTarget.id);

      if (error && /column|schema cache|does not exist/i.test(error.message)) {
        const retry = await supabase
          .from('user_subscriptions')
          .update({
            entitlement_overrides: overrideJson,
          })
          .eq('id', overrideTarget.id);
        error = retry.error;
      }

      if (error) throw new Error(error.message);
      setAppStatus('success', 'Custom overrides saved & prioritized.');
      setOverrideTarget(null);
      await loadData();
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
      {/* 1. Full Composable Subscription Plans Header & Grid */}
      <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold text-[var(--ps-text)] flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-[var(--ps-accent)]" />
              <span>Full-Power Composable Subscription &amp; Add-On Plan Builder</span>
            </h3>
            <p className="text-[11px] text-[var(--ps-text-muted)]">
              Configure all {SUBSCRIPTION_FEATURE_CATALOG.length} composable features and{' '}
              {SUBSCRIPTION_LIMIT_CATALOG.length} numeric quotas (including Unlimited toggles,
              target verticals, trials, grace periods &amp; live preview).
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
              onClick={() => openPlanEditor('new')}
              data-testid="create-composable-plan-btn"
              className="h-8 px-3 rounded-xl bg-[var(--btn-primary-bg)] text-[var(--btn-primary-fg)] font-bold inline-flex items-center gap-1.5 cursor-pointer shadow-xs"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Create Subscription Plan</span>
            </button>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
          {plans.map((plan) => {
            const enabledCount = SUBSCRIPTION_FEATURE_CATALOG.filter(
              (f) => plan.features?.[f.key] === true
            ).length;
            const activeSubCount = subscriberCountByPlanId.get(plan.id) || 0;
            return (
              <div
                key={plan.id}
                className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3.5 flex flex-col justify-between gap-3"
              >
                <div className="space-y-1.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap">
                        <span className="font-bold text-sm text-[var(--ps-text)] truncate">
                          {plan.name}
                        </span>
                        {plan.is_popular && (
                          <span className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded bg-amber-500/15 text-amber-600 dark:text-amber-300 text-[9px] font-bold">
                            <Crown className="w-2.5 h-2.5" /> Popular
                          </span>
                        )}
                      </div>
                      {plan.tagline && (
                        <p className="text-[11px] text-[var(--ps-text-muted)] line-clamp-1">
                          {plan.tagline}
                        </p>
                      )}
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-extrabold text-[var(--ps-accent)] tabular-nums">
                        ₹{plan.price_inr}
                        <span className="text-[10px] font-normal text-[var(--ps-text-muted)]">
                          /{plan.billing_cycle}
                        </span>
                      </div>
                      {plan.original_price_inr !== null &&
                        plan.original_price_inr > plan.price_inr && (
                          <div className="text-[10px] line-through text-[var(--ps-text-muted)]">
                            ₹{plan.original_price_inr}
                          </div>
                        )}
                    </div>
                  </div>

                  <div className="flex flex-wrap items-center gap-1 text-[10px]">
                    {plan.is_addon && (
                      <span className="px-1.5 py-0.5 rounded bg-indigo-500/15 text-indigo-600 dark:text-indigo-300 font-bold">
                        Add-On
                      </span>
                    )}
                    <span className="px-1.5 py-0.5 rounded bg-[var(--ps-surface)] border border-[var(--ps-border)] text-[var(--ps-text-muted)] font-semibold">
                      {enabledCount} features
                    </span>
                    <span className="px-1.5 py-0.5 rounded bg-[var(--ps-surface)] border border-[var(--ps-border)] text-[var(--ps-text-muted)] font-semibold">
                      {activeSubCount} active subs
                    </span>
                    <span
                      className={`px-1.5 py-0.5 rounded font-bold ${
                        plan.is_active
                          ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                          : 'bg-slate-200 dark:bg-slate-800 text-slate-500'
                      }`}
                    >
                      {plan.is_active ? 'Active' : 'Archived'}
                    </span>
                  </div>
                </div>

                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => openPlanEditor('edit', plan)}
                    className="flex-1 h-8 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] hover:border-[var(--ps-accent)] font-semibold text-[var(--ps-text)] inline-flex items-center justify-center gap-1.5 cursor-pointer"
                  >
                    <Sliders className="w-3.5 h-3.5 text-[var(--ps-accent)]" />
                    <span>Edit</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => openPlanEditor('duplicate', plan)}
                    title="Duplicate plan"
                    className="h-8 px-2.5 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] hover:border-[var(--ps-accent)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
                  >
                    <Copy className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleTogglePlanArchive(plan)}
                    title={plan.is_active ? 'Archive plan' : 'Activate plan'}
                    className="h-8 px-2.5 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:text-amber-500 cursor-pointer"
                  >
                    <Archive className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* 2. Business Subscriptions & Super-Admin Override Matrix */}
      <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3">
        <div>
          <h3 className="text-sm font-bold text-[var(--ps-text)] flex items-center gap-1.5">
            <ShieldCheck className="w-4 h-4 text-[var(--ps-accent)]" />
            <span>Business Subscriptions &amp; Manual Super-Admin Overrides</span>
          </h3>
          <p className="text-[11px] text-[var(--ps-text-muted)]">
            Super-Admin overrides ALWAYS take precedence over base plans (tri-state
            Inherit / Force Enable / Force Disable + custom or Unlimited quotas +
            reason &amp; expiry).
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
                    ? 'bg-[var(--btn-primary-bg)] text-[var(--btn-primary-fg)]'
                    : 'bg-[var(--ps-bg)] text-[var(--ps-text-muted)] border border-[var(--ps-border)]'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        </WorkspaceTableToolbar>

        <ResponsiveTableScroll>
          <table className="w-full text-left border-collapse min-w-[660px]">
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
                        {ovFeatCount + ovLimCount > 0 ? (
                          <div>
                            <span className="font-semibold text-[var(--ps-accent)]">
                              {ovFeatCount} flags · {ovLimCount} limits
                            </span>
                            {row.override_reason && (
                              <p className="text-[10px] truncate max-w-[180px]">
                                {row.override_reason}
                              </p>
                            )}
                          </div>
                        ) : (
                          'Inherits plan defaults'
                        )}
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

      {/* FULL COMPOSABLE PLAN CREATE / EDIT / DUPLICATE MODAL */}
      {editingPlan &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Subscription plan builder"
            data-testid="composable-plan-modal"
            className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 backdrop-blur-xs p-3"
          >
            <div className="w-[calc(100vw-24px)] max-w-4xl max-h-[90dvh] rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] shadow-2xl flex flex-col overflow-hidden text-xs">
              {/* Fixed Header + Section Pills */}
              <div className="shrink-0 px-4 py-3 border-b border-[var(--ps-border)] space-y-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div>
                    <h4 className="font-bold text-sm text-[var(--ps-text)]">
                      {isNewPlan
                        ? 'Create Composable Subscription Plan'
                        : `Edit Plan: ${editingPlan.name}`}
                    </h4>
                    <p className="text-[11px] text-[var(--ps-text-muted)]">
                      Full entitlement &amp; numeric cap designer synced to{' '}
                      <code className="font-mono">get_effective_entitlements()</code>.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setEditingPlan(null)}
                    className="w-8 h-8 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] flex items-center justify-center cursor-pointer"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>

                <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pb-0.5">
                  {(
                    [
                      ['identity', '1. Identity & Pricing'],
                      ['features', `2. Feature Matrix (${SUBSCRIPTION_FEATURE_CATALOG.length})`],
                      ['limits', `3. Numeric Quotas (${SUBSCRIPTION_LIMIT_CATALOG.length})`],
                      ['preview', '4. Live Merchant Preview'],
                    ] as Array<[PlanSectionTab, string]>
                  ).map(([id, label]) => (
                    <button
                      key={id}
                      type="button"
                      onClick={() => setPlanSection(id)}
                      className={`shrink-0 h-8 px-3 rounded-xl font-bold whitespace-nowrap cursor-pointer transition-colors ${
                        planSection === id
                          ? 'bg-[var(--btn-primary-bg)] text-[var(--btn-primary-fg)]'
                          : 'bg-[var(--ps-bg)] border border-[var(--ps-border)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                      }`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Scrollable Body */}
              <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
                {planSection === 'identity' && (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                      <div>
                        <label className="block text-[11px] font-semibold mb-1">
                          Plan Name *
                        </label>
                        <input
                          type="text"
                          value={editingPlan.name}
                          onChange={(e) => {
                            const nextName = e.target.value;
                            setEditingPlan({
                              ...editingPlan,
                              name: nextName,
                              ...(isNewPlan && !slugTouched
                                ? {
                                    slug: nextName
                                      .trim()
                                      .toLowerCase()
                                      .replace(/[^a-z0-9]+/g, '_')
                                      .replace(/^_|_$/g, ''),
                                  }
                                : {}),
                            });
                          }}
                          placeholder="e.g., Merchant Growth Pro"
                          className="w-full h-9 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text)]"
                        />
                      </div>

                      <div>
                        <label className="block text-[11px] font-semibold mb-1">
                          Plan Slug (Auto / Editable)
                        </label>
                        <input
                          type="text"
                          value={editingPlan.slug}
                          onChange={(e) => {
                            setSlugTouched(true);
                            setEditingPlan({
                              ...editingPlan,
                              slug: e.target.value,
                            });
                          }}
                          placeholder="merchant_growth_pro"
                          className="w-full h-9 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] font-mono text-[var(--ps-text)]"
                        />
                      </div>

                      <div>
                        <CustomSelectModal
                          label="Billing Interval"
                          options={BILLING_CYCLE_OPTIONS}
                          value={editingPlan.billing_cycle}
                          onChange={(val) =>
                            setEditingPlan({
                              ...editingPlan,
                              billing_cycle: val as BillingCycleKey,
                              duration_days: cycleDurationDays(val as BillingCycleKey),
                            })
                          }
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
                      <div>
                        <label className="block text-[11px] font-semibold mb-1">
                          Price (₹)
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={editingPlan.price_inr}
                          onChange={(e) =>
                            setEditingPlan({
                              ...editingPlan,
                              price_inr: Number(e.target.value) || 0,
                            })
                          }
                          className="w-full h-9 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text)]"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold mb-1">
                          Strike-Through Price (₹)
                        </label>
                        <input
                          type="number"
                          min={0}
                          placeholder="Optional"
                          value={editingPlan.original_price_inr ?? ''}
                          onChange={(e) =>
                            setEditingPlan({
                              ...editingPlan,
                              original_price_inr: e.target.value
                                ? Number(e.target.value)
                                : null,
                            })
                          }
                          className="w-full h-9 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text)]"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold mb-1">
                          Trial Days
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={editingPlan.trial_days}
                          onChange={(e) =>
                            setEditingPlan({
                              ...editingPlan,
                              trial_days: Number(e.target.value) || 0,
                            })
                          }
                          className="w-full h-9 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text)]"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold mb-1">
                          Grace Period Days
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={editingPlan.grace_period_days}
                          onChange={(e) =>
                            setEditingPlan({
                              ...editingPlan,
                              grace_period_days: Number(e.target.value) || 0,
                            })
                          }
                          className="w-full h-9 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text)]"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold mb-1">
                          Display Order
                        </label>
                        <input
                          type="number"
                          value={editingPlan.display_order}
                          onChange={(e) =>
                            setEditingPlan({
                              ...editingPlan,
                              display_order: Number(e.target.value) || 100,
                            })
                          }
                          className="w-full h-9 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text)]"
                        />
                      </div>
                    </div>

                    {/* Target Verticals Multi-Select Pills */}
                    <div className="space-y-1.5">
                      <label className="block text-[11px] font-semibold">
                        Target Verticals (Leave empty for All Verticals)
                      </label>
                      <div className="flex flex-wrap gap-1.5">
                        <button
                          type="button"
                          onClick={() =>
                            setEditingPlan({
                              ...editingPlan,
                              target_verticals: [],
                            })
                          }
                          className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold cursor-pointer ${
                            editingPlan.target_verticals.length === 0
                              ? 'bg-[var(--btn-primary-bg)] text-[var(--btn-primary-fg)] border-transparent'
                              : 'bg-[var(--ps-bg)] border-[var(--ps-border)] text-[var(--ps-text-muted)]'
                          }`}
                        >
                          All Verticals
                        </button>
                        {LISTING_VERTICALS.map((v) => {
                          const selected =
                            editingPlan.target_verticals.includes(v);
                          return (
                            <button
                              key={v}
                              type="button"
                              onClick={() => {
                                const next = selected
                                  ? editingPlan.target_verticals.filter(
                                      (x) => x !== v
                                    )
                                  : [...editingPlan.target_verticals, v];
                                setEditingPlan({
                                  ...editingPlan,
                                  target_verticals: next,
                                });
                              }}
                              className={`px-2.5 py-1 rounded-lg border text-[11px] font-semibold cursor-pointer ${
                                selected
                                  ? 'bg-[var(--ps-accent)]/15 border-[var(--ps-accent)] text-[var(--ps-accent)]'
                                  : 'bg-[var(--ps-bg)] border-[var(--ps-border)] text-[var(--ps-text-muted)]'
                              }`}
                            >
                              {VERTICAL_TARGET_LABELS[v]}
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-4 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3">
                      <label className="inline-flex items-center gap-2 font-semibold cursor-pointer">
                        <input
                          type="checkbox"
                          checked={editingPlan.is_popular}
                          onChange={(e) =>
                            setEditingPlan({
                              ...editingPlan,
                              is_popular: e.target.checked,
                            })
                          }
                          className="accent-amber-500"
                        />
                        <span>Popular / Highlighted Badge</span>
                      </label>
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
                          className="accent-[var(--ps-accent)]"
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
                          className="accent-emerald-500"
                        />
                        <span>Active &amp; Publicly Subscribable</span>
                      </label>
                    </div>

                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                      <div>
                        <label className="block text-[11px] font-semibold mb-1">
                          Short Tagline
                        </label>
                        <input
                          type="text"
                          value={editingPlan.tagline}
                          onChange={(e) =>
                            setEditingPlan({
                              ...editingPlan,
                              tagline: e.target.value,
                            })
                          }
                          placeholder="Best for growing storefronts & kitchens"
                          className="w-full h-9 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text)]"
                        />
                      </div>
                      <div>
                        <label className="block text-[11px] font-semibold mb-1">
                          Bullet Highlights (One Per Line)
                        </label>
                        <textarea
                          rows={3}
                          value={highlightsDraft}
                          onChange={(e) => setHighlightsDraft(e.target.value)}
                          placeholder="0% commission direct UPI&#10;Verified green tick on map"
                          className="w-full p-2.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text)]"
                        />
                      </div>
                    </div>
                  </div>
                )}

                {planSection === 'features' && (
                  <div className="space-y-3">
                    {groupedFeatures.map(({ groupName, items }) => (
                      <div
                        key={groupName}
                        className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3.5 space-y-2.5"
                      >
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <span className="text-xs font-extrabold uppercase tracking-wider text-[var(--ps-text)] flex items-center gap-1.5">
                            <Layers className="w-3.5 h-3.5 text-[var(--ps-accent)]" />
                            {groupName}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => toggleFeatureGroup(items, true)}
                              className="px-2 py-0.5 rounded-md bg-emerald-500/15 text-emerald-600 dark:text-emerald-300 text-[10px] font-bold cursor-pointer"
                            >
                              Enable All
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleFeatureGroup(items, false)}
                              className="px-2 py-0.5 rounded-md bg-rose-500/10 text-rose-600 dark:text-rose-300 text-[10px] font-bold cursor-pointer"
                            >
                              Clear Group
                            </button>
                          </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                          {items.map((feat) => {
                            const checked = Boolean(
                              editingPlan.features?.[feat.key]
                            );
                            return (
                              <label
                                key={feat.key}
                                className={`flex items-start gap-2.5 rounded-xl border p-2.5 cursor-pointer transition-colors ${
                                  checked
                                    ? 'border-[var(--ps-accent)]/50 bg-[var(--ps-surface)]'
                                    : 'border-[var(--ps-border)] bg-[var(--ps-surface)]/50'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={(e) => {
                                    const nextVal = e.target.checked;
                                    const nextMap = {
                                      ...editingPlan.features,
                                      [feat.key]: nextVal,
                                    };
                                    const alias = FEATURE_KEY_ALIASES[feat.key];
                                    if (alias) nextMap[alias] = nextVal;
                                    setEditingPlan({
                                      ...editingPlan,
                                      features: nextMap,
                                    });
                                  }}
                                  className="mt-0.5 accent-[var(--ps-accent)] shrink-0"
                                />
                                <div className="min-w-0">
                                  <div className="font-bold text-[var(--ps-text)]">
                                    {feat.label}
                                  </div>
                                  <p className="text-[10px] text-[var(--ps-text-muted)] leading-snug mt-0.5">
                                    {feat.description}
                                  </p>
                                </div>
                              </label>
                            );
                          })}
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {planSection === 'limits' && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                    {SUBSCRIPTION_LIMIT_CATALOG.map((lim) => {
                      const rawVal = editingPlan.limits?.[lim.key];
                      const isUnlimited =
                        rawVal === null || (typeof rawVal === 'number' && rawVal < 0);
                      const numericVal =
                        typeof rawVal === 'number' && rawVal >= 0
                          ? rawVal
                          : lim.defaultValue;

                      const setLimitVal = (nextVal: number | null) => {
                        const nextMap = {
                          ...editingPlan.limits,
                          [lim.key]: nextVal,
                        };
                        const alias = LIMIT_KEY_ALIASES[lim.key];
                        if (alias) nextMap[alias] = nextVal;
                        setEditingPlan({ ...editingPlan, limits: nextMap });
                      };

                      return (
                        <div
                          key={lim.key}
                          className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 flex flex-col justify-between gap-2"
                        >
                          <div>
                            <div className="font-bold text-[var(--ps-text)]">
                              {lim.label}
                            </div>
                            <p className="text-[10px] text-[var(--ps-text-muted)]">
                              {lim.description}
                            </p>
                          </div>
                          <div className="flex items-center justify-between gap-2 pt-1">
                            <input
                              type="number"
                              min={0}
                              max={9999}
                              disabled={isUnlimited}
                              value={isUnlimited ? '' : numericVal}
                              placeholder={isUnlimited ? '∞' : '0'}
                              onChange={(e) =>
                                setLimitVal(
                                  Math.max(
                                    0,
                                    Math.min(9999, Number(e.target.value) || 0)
                                  )
                                )
                              }
                              className="w-24 h-8 px-2.5 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] text-right font-mono disabled:opacity-45"
                            />
                            <button
                              type="button"
                              onClick={() =>
                                setLimitVal(
                                  isUnlimited ? Math.max(0, lim.defaultValue) : null
                                )
                              }
                              className={`h-8 px-2.5 rounded-lg border text-[11px] font-bold inline-flex items-center gap-1 cursor-pointer ${
                                isUnlimited
                                  ? 'bg-emerald-500/15 border-emerald-500/40 text-emerald-700 dark:text-emerald-300'
                                  : 'bg-[var(--ps-surface)] border-[var(--ps-border)] text-[var(--ps-text-muted)]'
                              }`}
                            >
                              <InfinityIcon className="w-3.5 h-3.5" />
                              Unlimited
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}

                {planSection === 'preview' && (
                  <div className="max-w-md mx-auto rounded-2xl border-2 border-[var(--ps-accent)] bg-[var(--ps-bg)] p-5 space-y-4 shadow-lg">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <h5 className="text-base font-extrabold text-[var(--ps-text)]">
                            {editingPlan.name || 'Untitled Plan'}
                          </h5>
                          {editingPlan.is_popular && (
                            <span className="px-2 py-0.5 rounded-full bg-amber-500 text-white text-[10px] font-bold">
                              POPULAR
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-[var(--ps-text-muted)] mt-0.5">
                          {editingPlan.tagline || 'Merchant subscription plan'}
                        </p>
                      </div>
                      <div className="text-right">
                        <div className="text-xl font-black text-[var(--ps-accent)] tabular-nums">
                          ₹{editingPlan.price_inr}
                        </div>
                        <div className="text-[10px] text-[var(--ps-text-muted)] uppercase">
                          /{editingPlan.billing_cycle}
                        </div>
                        {editingPlan.original_price_inr !== null &&
                          editingPlan.original_price_inr >
                            editingPlan.price_inr && (
                            <div className="text-[10px] line-through text-[var(--ps-text-muted)]">
                              ₹{editingPlan.original_price_inr}
                            </div>
                          )}
                      </div>
                    </div>

                    {editingPlan.trial_days > 0 && (
                      <div className="px-2.5 py-1 rounded-lg bg-emerald-500/15 text-emerald-700 dark:text-emerald-300 text-[11px] font-bold inline-block">
                        Includes {editingPlan.trial_days}-Day Free Trial ·{' '}
                        {editingPlan.grace_period_days}d grace drain window
                      </div>
                    )}

                    <ul className="space-y-1.5">
                      {highlightsDraft
                        .split('\n')
                        .map((h) => h.trim())
                        .filter(Boolean)
                        .map((line, i) => (
                          <li
                            key={i}
                            className="flex items-center gap-2 text-xs text-[var(--ps-text)]"
                          >
                            <Check className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
                            <span>{line}</span>
                          </li>
                        ))}
                    </ul>

                    <div className="pt-2 border-t border-[var(--ps-border)] space-y-1.5">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                        Unlocked Capabilities
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {SUBSCRIPTION_FEATURE_CATALOG.filter(
                          (f) => editingPlan.features?.[f.key] === true
                        ).map((f) => (
                          <span
                            key={f.key}
                            className="px-2 py-0.5 rounded bg-[var(--ps-surface)] border border-[var(--ps-border)] text-[10px] font-semibold"
                          >
                            {f.label}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="pt-2 border-t border-[var(--ps-border)] space-y-1.5">
                      <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                        Quotas Included
                      </div>
                      <div className="grid grid-cols-2 gap-1.5 text-[10px]">
                        {SUBSCRIPTION_LIMIT_CATALOG.map((lim) => {
                          const v = editingPlan.limits?.[lim.key];
                          return (
                            <div
                              key={lim.key}
                              className="flex items-center justify-between px-2 py-1 rounded bg-[var(--ps-surface)]"
                            >
                              <span className="truncate text-[var(--ps-text-muted)]">
                                {lim.label.replace(/^Max /, '')}
                              </span>
                              <span className="font-mono font-bold text-[var(--ps-text)]">
                                {formatSubscriptionLimitValue(
                                  v === undefined ? lim.defaultValue : v
                                )}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="shrink-0 px-4 py-3 border-t border-[var(--ps-border)] flex flex-wrap justify-between items-center gap-2 bg-[var(--ps-bg)]">
                <div className="text-[11px] text-[var(--ps-text-muted)]">
                  {SUBSCRIPTION_FEATURE_CATALOG.filter(
                    (f) => editingPlan.features?.[f.key] === true
                  ).length}{' '}
                  features enabled
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setEditingPlan(null)}
                    className="h-9 px-3.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] font-semibold cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={isSavingPlan}
                    onClick={() => void handleSavePlan()}
                    className="h-9 px-4 rounded-xl bg-[var(--btn-primary-bg)] text-[var(--btn-primary-fg)] font-bold inline-flex items-center gap-1.5 cursor-pointer"
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
            </div>
          </div>,
          document.body
        )}

      {/* FULL SUPER-ADMIN OVERRIDE MATRIX MODAL */}
      {overrideTarget &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Customize business entitlement overrides"
            data-testid="business-override-modal"
            className="fixed inset-0 z-[90] flex items-center justify-center bg-black/60 backdrop-blur-xs p-3"
          >
            <div className="w-[calc(100vw-24px)] max-w-3xl max-h-[90dvh] rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] shadow-2xl flex flex-col overflow-hidden text-xs">
              <div className="px-4 py-3 border-b border-[var(--ps-border)] flex items-center justify-between gap-2 shrink-0">
                <div>
                  <div className="font-bold text-sm text-[var(--ps-text)]">
                    Super-Admin Entitlement Overrides
                  </div>
                  <div className="text-[11px] text-[var(--ps-text-muted)]">
                    {overrideTarget.ownerLabel} · Plan: {overrideTarget.planName}
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

              <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3">
                  <div>
                    <label className="block text-[11px] font-semibold mb-1">
                      Override Reason / Audit Note
                    </label>
                    <input
                      type="text"
                      value={overrideReason}
                      onChange={(e) => setOverrideReason(e.target.value)}
                      placeholder="e.g., Partner beta grant / VIP exception"
                      className="w-full h-9 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text)]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold mb-1">
                      Override Expiry Date (Optional)
                    </label>
                    <input
                      type="datetime-local"
                      value={overrideExpiresLocal}
                      onChange={(e) => setOverrideExpiresLocal(e.target.value)}
                      className="w-full h-9 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text)]"
                    />
                  </div>
                </div>

                {/* Tri-state Feature Groups */}
                <div className="space-y-3">
                  <div className="font-bold text-[var(--ps-text)]">
                    Feature Overrides (Inherit | Force Enable | Force Disable)
                  </div>
                  {groupedFeatures.map(({ groupName, items }) => (
                    <div
                      key={groupName}
                      className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 space-y-2"
                    >
                      <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                        {groupName}
                      </div>
                      <div className="space-y-1.5">
                        {items.map((feat) => {
                          const stateVal =
                            typeof overrideFeatures[feat.key] === 'boolean'
                              ? overrideFeatures[feat.key]
                              : null;
                          const setTriState = (next: boolean | null) => {
                            setOverrideFeatures((prev) => {
                              const copy = { ...prev };
                              if (next === null) {
                                delete copy[feat.key];
                              } else {
                                copy[feat.key] = next;
                              }
                              return copy;
                            });
                          };
                          return (
                            <div
                              key={feat.key}
                              className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 py-1.5"
                            >
                              <div className="min-w-0 flex-1">
                                <div className="font-semibold text-[var(--ps-text)]">
                                  {feat.label}
                                </div>
                              </div>
                              <div className="inline-flex rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] p-0.5 text-[10px] font-bold">
                                <button
                                  type="button"
                                  onClick={() => setTriState(null)}
                                  className={`px-2 py-1 rounded-md cursor-pointer ${
                                    stateVal === null
                                      ? 'bg-[var(--ps-surface)] text-[var(--ps-text)] shadow-xs'
                                      : 'text-[var(--ps-text-muted)]'
                                  }`}
                                >
                                  Inherit
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setTriState(true)}
                                  className={`px-2 py-1 rounded-md cursor-pointer ${
                                    stateVal === true
                                      ? 'bg-emerald-600 text-white'
                                      : 'text-[var(--ps-text-muted)]'
                                  }`}
                                >
                                  Force Enable
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setTriState(false)}
                                  className={`px-2 py-1 rounded-md cursor-pointer ${
                                    stateVal === false
                                      ? 'bg-rose-600 text-white'
                                      : 'text-[var(--ps-text-muted)]'
                                  }`}
                                >
                                  Force Disable
                                </button>
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>

                {/* Tri-state Numeric Quotas */}
                <div className="space-y-2">
                  <div className="font-bold text-[var(--ps-text)]">
                    Numeric Quota Overrides (Inherit | Custom | Unlimited)
                  </div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {SUBSCRIPTION_LIMIT_CATALOG.map((lim) => {
                      const mode = overrideLimitModes[lim.key] || 'inherit';
                      const numVal = overrideLimits[lim.key] ?? lim.defaultValue;
                      return (
                        <div
                          key={lim.key}
                          className="rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] p-2.5 space-y-2"
                        >
                          <div className="font-semibold text-[var(--ps-text)]">
                            {lim.label}
                          </div>
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="inline-flex rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] p-0.5 text-[10px] font-bold">
                              {(['inherit', 'custom', 'unlimited'] as const).map(
                                (m) => (
                                  <button
                                    key={m}
                                    type="button"
                                    onClick={() => {
                                      setOverrideLimitModes((prev) => ({
                                        ...prev,
                                        [lim.key]: m,
                                      }));
                                      if (m === 'custom' && overrideLimits[lim.key] == null) {
                                        setOverrideLimits((prev) => ({
                                          ...prev,
                                          [lim.key]: lim.defaultValue,
                                        }));
                                      }
                                    }}
                                    className={`px-2 py-1 rounded-md capitalize cursor-pointer ${
                                      mode === m
                                        ? m === 'unlimited'
                                          ? 'bg-emerald-600 text-white'
                                          : 'bg-[var(--btn-primary-bg)] text-[var(--btn-primary-fg)]'
                                        : 'text-[var(--ps-text-muted)]'
                                    }`}
                                  >
                                    {m}
                                  </button>
                                )
                              )}
                            </div>
                            {mode === 'custom' && (
                              <input
                                type="number"
                                min={0}
                                max={9999}
                                value={numVal ?? 0}
                                onChange={(e) =>
                                  setOverrideLimits((prev) => ({
                                    ...prev,
                                    [lim.key]: Math.max(
                                      0,
                                      Number(e.target.value) || 0
                                    ),
                                  }))
                                }
                                className="w-20 h-7 px-2 rounded border border-[var(--ps-border)] bg-[var(--ps-surface)] text-right font-mono"
                              />
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              <div className="px-4 py-3 border-t border-[var(--ps-border)] flex justify-end gap-2 shrink-0 bg-[var(--ps-bg)]">
                <button
                  type="button"
                  onClick={() => setOverrideTarget(null)}
                  className="h-9 px-3.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isSavingOverride}
                  onClick={() => void handleSaveOverride()}
                  className="h-9 px-4 rounded-xl bg-[var(--btn-primary-bg)] text-[var(--btn-primary-fg)] font-bold inline-flex items-center gap-1.5 cursor-pointer"
                >
                  {isSavingOverride ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5" />
                  )}
                  <span>Apply Overrides</span>
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {confirmDialog}
    </div>
  );
}

export default ComposablePlanBuilderSection;
