'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertTriangle,
  ArrowUpRight,
  Building2,
  CheckCircle2,
  Clock,
  Crown,
  Gauge,
  Layers,
  Lock,
  Megaphone,
  RefreshCw,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Users,
} from 'lucide-react';
import { PayPerCheckoutModal } from '@/components/monetization/PayPerCheckoutModal';
import { useConfirmDialogState } from '@/components/ui/ConfirmDialog';
import {
  PAY_PER_MODULE_LABELS,
  type PayPerModuleKey,
  type PayPerTargetTable,
} from '@/lib/monetization/pay-per';
import { isUuid } from '@/lib/payments/types';
import {
  SUBSCRIPTION_FEATURE_CATALOG,
  type SubscriptionFeatureKey,
} from '@/lib/subscriptions/feature-catalog';
import { useEffectiveEntitlements } from '@/lib/subscriptions/useEffectiveEntitlements';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';

export interface WorkspacePlanCandidate {
  id: string;
  slug: string;
  title: string;
  info: string;
  trial_days: number;
  price_inr: number;
  duration_days: number;
  target_scope: string;
}

export interface ExpiringPayPerItem {
  id: string;
  title: string;
  target_table: PayPerTargetTable;
  module_key: PayPerModuleKey;
  paid_until: string;
  is_expired: boolean;
  days_left: number;
  price_inr?: number;
  listing_vertical?: string;
}

export interface OwnerWorkspaceSummaryData {
  owner_id: string;
  caller_id: string;
  is_staff_caller: boolean;
  owner_profile: {
    id: string;
    full_name: string;
    username?: string | null;
    role: string;
    trial_used_at?: string | null;
    is_trial_eligible: boolean;
  };
  active_subscription: {
    subscription_id: string | null;
    plan_id: string | null;
    plan_slug: string;
    plan_name: string;
    plan_info: string;
    status: string;
    is_trial: boolean;
    is_default_free: boolean;
    starts_at: string | null;
    ends_at: string | null;
    days_remaining: number | null;
  };
  quota_usage: {
    listings: { used: number; limit: number | null };
    marketplace_items: { used: number; limit: number | null };
    active_staff: { used: number; limit: number | null; enabled: boolean };
    bulletins_this_month: {
      used: number;
      limit: number | null;
      active_used: number;
      active_limit: number | null;
    };
  };
  targeted_vip_plans: WorkspacePlanCandidate[];
  trial_eligible_plans: WorkspacePlanCandidate[];
  expiring_pay_per_items: ExpiringPayPerItem[];
}

export interface OwnerOverviewAndPlanPanelProps {
  targetOwnerId: string | null;
  activeListingId?: string | null;
  activeBusinessTitle?: string | null;
  isStaffMode?: boolean;
  fallbackCounts?: {
    listingsUsed?: number;
    marketplaceUsed?: number;
    staffUsed?: number;
    bulletinsUsed?: number;
  };
  viewMode?: 'overview' | 'plans_and_pay_per';
  onNavigateToSection?: (sectionId: string) => void;
  onNotice?: (notice: {
    type: 'success' | 'error' | 'info';
    text: string;
  }) => void;
  children?: React.ReactNode;
}

function formatLimitLabel(limit: number | null | undefined): string {
  if (limit === null || limit === undefined || limit < 0) return 'Unlimited';
  return String(limit);
}

export function OwnerOverviewAndPlanPanel({
  targetOwnerId,
  activeListingId,
  activeBusinessTitle,
  isStaffMode = false,
  fallbackCounts,
  viewMode = 'overview',
  onNavigateToSection,
  onNotice,
  children,
}: OwnerOverviewAndPlanPanelProps) {
  const { confirm, dialog: confirmDialog } = useConfirmDialogState();
  const [summary, setSummary] = useState<OwnerWorkspaceSummaryData | null>(
    null
  );
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isStartingTrialId, setIsStartingTrialId] = useState<string | null>(
    null
  );
  const [renewTarget, setRenewTarget] = useState<ExpiringPayPerItem | null>(
    null
  );

  // Also hydrate feature capabilities from the Owner's ID (Staff inherit Owner capabilities)
  const {
    can,
    limit: fallbackLimit,
    isOverriddenBySuperAdmin,
    hasAnySuperAdminOverride,
    loading: entitlementsLoading,
  } = useEffectiveEntitlements(targetOwnerId, activeListingId || null);

  const fallbackListingsUsed = fallbackCounts?.listingsUsed ?? 0;
  const fallbackMarketplaceUsed = fallbackCounts?.marketplaceUsed ?? 0;
  const fallbackStaffUsed = fallbackCounts?.staffUsed ?? 0;
  const fallbackBulletinsUsed = fallbackCounts?.bulletinsUsed ?? 0;

  const loadSummary = useCallback(async () => {
    if (!targetOwnerId || !isUuid(targetOwnerId) || !isSupabaseConfigured()) {
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const { data, error } = await supabase.rpc(
        'get_owner_workspace_summary',
        {
          p_target_owner_id: targetOwnerId,
        }
      );

      if (!error && data && typeof data === 'object') {
        const raw = data as Record<string, unknown>;
        const activeSub = (raw.active_subscription || {}) as Record<
          string,
          unknown
        >;
        const ownerProf = (raw.owner_profile || {}) as Record<string, unknown>;
        const quotas = (raw.quota_usage || {}) as Record<
          string,
          Record<string, unknown>
        >;

        setSummary({
          owner_id: String(raw.owner_id || targetOwnerId),
          caller_id: String(raw.caller_id || targetOwnerId),
          is_staff_caller: Boolean(raw.is_staff_caller || isStaffMode),
          owner_profile: {
            id: String(ownerProf.id || targetOwnerId),
            full_name: String(ownerProf.full_name || 'Business Owner'),
            username:
              typeof ownerProf.username === 'string'
                ? ownerProf.username
                : null,
            role: String(ownerProf.role || 'owner'),
            trial_used_at:
              typeof ownerProf.trial_used_at === 'string'
                ? ownerProf.trial_used_at
                : null,
            is_trial_eligible: Boolean(ownerProf.is_trial_eligible),
          },
          active_subscription: {
            subscription_id:
              typeof activeSub.subscription_id === 'string'
                ? activeSub.subscription_id
                : null,
            plan_id:
              typeof activeSub.plan_id === 'string' ? activeSub.plan_id : null,
            plan_slug: String(activeSub.plan_slug || 'default-free-tier'),
            plan_name: String(activeSub.plan_name || 'Default Free Tier'),
            plan_info: String(
              activeSub.plan_info || 'Baseline community tier'
            ),
            status: String(activeSub.status || 'default_free'),
            is_trial: Boolean(activeSub.is_trial),
            is_default_free: Boolean(activeSub.is_default_free ?? true),
            starts_at:
              typeof activeSub.starts_at === 'string'
                ? activeSub.starts_at
                : null,
            ends_at:
              typeof activeSub.ends_at === 'string' ? activeSub.ends_at : null,
            days_remaining:
              typeof activeSub.days_remaining === 'number'
                ? activeSub.days_remaining
                : null,
          },
          quota_usage: {
            listings: {
              used: Number(quotas.listings?.used ?? fallbackListingsUsed),
              limit:
                typeof quotas.listings?.limit === 'number'
                  ? quotas.listings.limit
                  : null,
            },
            marketplace_items: {
              used: Number(
                quotas.marketplace_items?.used ?? fallbackMarketplaceUsed
              ),
              limit:
                typeof quotas.marketplace_items?.limit === 'number'
                  ? quotas.marketplace_items.limit
                  : null,
            },
            active_staff: {
              used: Number(quotas.active_staff?.used ?? fallbackStaffUsed),
              limit:
                typeof quotas.active_staff?.limit === 'number'
                  ? quotas.active_staff.limit
                  : null,
              enabled: Boolean(quotas.active_staff?.enabled ?? true),
            },
            bulletins_this_month: {
              used: Number(
                quotas.bulletins_this_month?.used ?? fallbackBulletinsUsed
              ),
              limit:
                typeof quotas.bulletins_this_month?.limit === 'number'
                  ? quotas.bulletins_this_month.limit
                  : null,
              active_used: Number(
                quotas.bulletins_this_month?.active_used ?? 0
              ),
              active_limit:
                typeof quotas.bulletins_this_month?.active_limit === 'number'
                  ? quotas.bulletins_this_month.active_limit
                  : null,
            },
          },
          targeted_vip_plans: Array.isArray(raw.targeted_vip_plans)
            ? (raw.targeted_vip_plans as WorkspacePlanCandidate[])
            : [],
          trial_eligible_plans: Array.isArray(raw.trial_eligible_plans)
            ? (raw.trial_eligible_plans as WorkspacePlanCandidate[])
            : [],
          expiring_pay_per_items: Array.isArray(raw.expiring_pay_per_items)
            ? (raw.expiring_pay_per_items as ExpiringPayPerItem[])
            : [],
        });
        setIsLoading(false);
        return;
      }

      // Direct table query fallback when v18a SQL migration has not yet been applied
      const [profileRes, plansRes, mpRes, bulRes, listRes] =
        await Promise.allSettled([
          supabase
            .from('profiles')
            .select('id, full_name, username, role, trial_used_at')
            .eq('id', targetOwnerId)
            .maybeSingle(),
          supabase
            .from('subscription_plans')
            .select('*')
            .eq('is_active', true)
            .order('sort_order', { ascending: true }),
          supabase
            .from('marketplace_products')
            .select('id, title, price, paid_until, is_active')
            .eq('owner_id', targetOwnerId),
          supabase
            .from('bulletins')
            .select('id, title, paid_until, status, created_at')
            .eq('author_id', targetOwnerId),
          supabase
            .from('listings')
            .select('id, title, listing_vertical, subcategory, paid_until, status')
            .eq('owner_id', targetOwnerId),
        ]);

      const profRow =
        profileRes.status === 'fulfilled' && profileRes.value.data
          ? (profileRes.value.data as Record<string, unknown>)
          : null;
      const planRows =
        plansRes.status === 'fulfilled' && Array.isArray(plansRes.value.data)
          ? (plansRes.value.data as Array<Record<string, unknown>>)
          : [];
      const mpRows =
        mpRes.status === 'fulfilled' && Array.isArray(mpRes.value.data)
          ? (mpRes.value.data as Array<Record<string, unknown>>)
          : [];
      const bulRows =
        bulRes.status === 'fulfilled' && Array.isArray(bulRes.value.data)
          ? (bulRes.value.data as Array<Record<string, unknown>>)
          : [];
      const listRows =
        listRes.status === 'fulfilled' && Array.isArray(listRes.value.data)
          ? (listRes.value.data as Array<Record<string, unknown>>)
          : [];

      const sevenDaysFromNow = Date.now() + 7 * 86400 * 1000;
      const expiring: ExpiringPayPerItem[] = [];

      for (const mp of mpRows) {
        if (typeof mp.paid_until === 'string') {
          const ts = new Date(mp.paid_until).getTime();
          if (Number.isFinite(ts) && ts <= sevenDaysFromNow) {
            expiring.push({
              id: String(mp.id),
              title: String(mp.title || 'Marketplace Product'),
              target_table: 'marketplace_products',
              module_key: 'marketplace_item',
              paid_until: mp.paid_until,
              is_expired: ts <= Date.now(),
              days_left: Math.ceil((ts - Date.now()) / 86400000),
              price_inr: Number(mp.price ?? 0),
              listing_vertical: 'shop_catalogue',
            });
          }
        }
      }

      for (const b of bulRows) {
        if (typeof b.paid_until === 'string') {
          const ts = new Date(b.paid_until).getTime();
          if (Number.isFinite(ts) && ts <= sevenDaysFromNow) {
            expiring.push({
              id: String(b.id),
              title: String(b.title || 'Bulletin Post'),
              target_table: 'bulletins',
              module_key: 'bulletin_post',
              paid_until: b.paid_until,
              is_expired: ts <= Date.now(),
              days_left: Math.ceil((ts - Date.now()) / 86400000),
            });
          }
        }
      }

      for (const l of listRows) {
        if (typeof l.paid_until === 'string') {
          const ts = new Date(l.paid_until).getTime();
          if (Number.isFinite(ts) && ts <= sevenDaysFromNow) {
            const sub = String(l.subcategory || '').toLowerCase();
            const isRent =
              sub.includes('rent') || sub.includes('lease') || sub.includes('pg');
            expiring.push({
              id: String(l.id),
              title: String(l.title || 'Property Listing'),
              target_table: 'listings',
              module_key: isRent ? 'real_estate_rent' : 'real_estate_sale',
              paid_until: l.paid_until,
              is_expired: ts <= Date.now(),
              days_left: Math.ceil((ts - Date.now()) / 86400000),
              listing_vertical: String(l.listing_vertical || 'real_estate'),
            });
          }
        }
      }

      const trialPlans: WorkspacePlanCandidate[] = [];
      const targetedPlans: WorkspacePlanCandidate[] = [];
      for (const p of planRows) {
        if (p.is_archived || p.is_default_free) continue;
        const candidate: WorkspacePlanCandidate = {
          id: String(p.id),
          slug: String(p.slug || ''),
          title: String(p.title || p.name || 'Business Plan'),
          info: String(p.info || p.tagline || ''),
          trial_days: Number(p.trial_days ?? 0),
          price_inr: Number(p.price_inr ?? 0),
          duration_days: Number(p.duration_days ?? 30),
          target_scope: String(p.target_scope || 'public'),
        };
        if (candidate.target_scope === 'selected_users') {
          targetedPlans.push(candidate);
        }
        if (candidate.trial_days > 0) {
          trialPlans.push(candidate);
        }
      }

      setSummary({
        owner_id: targetOwnerId,
        caller_id: targetOwnerId,
        is_staff_caller: isStaffMode,
        owner_profile: {
          id: targetOwnerId,
          full_name: String(profRow?.full_name || 'Business Owner'),
          username:
            typeof profRow?.username === 'string' ? profRow.username : null,
          role: String(profRow?.role || 'owner'),
          trial_used_at:
            typeof profRow?.trial_used_at === 'string'
              ? profRow.trial_used_at
              : null,
          is_trial_eligible: !isStaffMode && !profRow?.trial_used_at,
        },
        active_subscription: {
          subscription_id: null,
          plan_id: null,
          plan_slug: 'default-free-tier',
          plan_name: 'Default Free Tier',
          plan_info: 'Baseline community tier',
          status: 'default_free',
          is_trial: false,
          is_default_free: true,
          starts_at: null,
          ends_at: null,
          days_remaining: null,
        },
        quota_usage: {
          listings: {
            used: listRows.length || fallbackListingsUsed,
            limit: null,
          },
          marketplace_items: {
            used: mpRows.length || fallbackMarketplaceUsed,
            limit: null,
          },
          active_staff: {
            used: fallbackStaffUsed,
            limit: null,
            enabled: true,
          },
          bulletins_this_month: {
            used: bulRows.length || fallbackBulletinsUsed,
            limit: null,
            active_used: bulRows.length,
            active_limit: null,
          },
        },
        targeted_vip_plans: isStaffMode ? [] : targetedPlans,
        trial_eligible_plans: isStaffMode ? [] : trialPlans,
        expiring_pay_per_items: expiring,
      });
    } catch {
      // Safe fallback
    } finally {
      setIsLoading(false);
    }
  }, [
    targetOwnerId,
    isStaffMode,
    fallbackListingsUsed,
    fallbackMarketplaceUsed,
    fallbackStaffUsed,
    fallbackBulletinsUsed,
  ]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadSummary();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadSummary]);

  const handleStartFreeTrial = async (plan: WorkspacePlanCandidate) => {
    if (isStaffMode) return;
    const accepted = await confirm({
      title: `Start ${plan.trial_days}-Day Free Trial on "${plan.title}"?`,
      description: `Unlock all "${plan.title}" business capabilities immediately for ${plan.trial_days} days at ₹0. Each account is eligible for one free trial.`,
      caution:
        'When the trial ends, your listings and data remain safely intact and revert to the Default Free Tier unless renewed.',
      impactSummary: [
        `Plan: ${plan.title}`,
        `Trial Duration: ${plan.trial_days} days (₹0 today)`,
      ],
      confirmLabel: `Activate ${plan.trial_days}-Day Trial`,
      cancelLabel: 'Not Now',
      variant: 'info',
    });
    if (!accepted) return;

    setIsStartingTrialId(plan.id);
    try {
      const { error } = await supabase.rpc('start_plan_trial', {
        p_plan_id: plan.id,
      });
      if (error) {
        throw new Error(error.message);
      }
      onNotice?.({
        type: 'success',
        text: `Activated ${plan.trial_days}-day free trial for "${plan.title}"! Your workspace quotas have been upgraded.`,
      });
      await loadSummary();
    } catch (err) {
      onNotice?.({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Unable to activate free trial right now.',
      });
    } finally {
      setIsStartingTrialId(null);
    }
  };

  // Resolve effective quota numbers combining RPC summary + useEffectiveEntitlements
  const quotaMeters = useMemo(() => {
    const rawListingsLimit =
      summary?.quota_usage.listings.limit ??
      (fallbackLimit('max_active_listings') >= 0
        ? fallbackLimit('max_active_listings')
        : null);
    const rawMarketplaceLimit =
      summary?.quota_usage.marketplace_items.limit ??
      (fallbackLimit('max_catalogue_items') >= 0
        ? fallbackLimit('max_catalogue_items')
        : null);
    const rawStaffLimit =
      summary?.quota_usage.active_staff.limit ??
      (fallbackLimit('max_staff_members') >= 0
        ? fallbackLimit('max_staff_members')
        : null);
    const rawBulletinsLimit =
      summary?.quota_usage.bulletins_this_month.limit ??
      (fallbackLimit('max_monthly_bulletins') >= 0
        ? fallbackLimit('max_monthly_bulletins')
        : null);

    return [
      {
        id: 'listings',
        label: 'Active Listings',
        icon: Building2,
        used:
          summary?.quota_usage.listings.used ??
          fallbackCounts?.listingsUsed ??
          0,
        limit: rawListingsLimit,
        actionLabel: 'Manage Listings',
        targetSection: 'listings_portfolio',
      },
      {
        id: 'marketplace',
        label: 'Marketplace Products',
        icon: ShoppingBag,
        used:
          summary?.quota_usage.marketplace_items.used ??
          fallbackCounts?.marketplaceUsed ??
          0,
        limit: rawMarketplaceLimit,
        actionLabel: 'Open Catalogue',
        targetSection: 'marketplace_catalogue',
      },
      {
        id: 'staff',
        label: 'Active Staff Seats',
        icon: Users,
        used:
          summary?.quota_usage.active_staff.used ??
          fallbackCounts?.staffUsed ??
          0,
        limit:
          summary?.quota_usage.active_staff.enabled === false
            ? 0
            : rawStaffLimit,
        actionLabel: isStaffMode ? 'Owner Managed' : 'Manage Team',
        targetSection: isStaffMode ? undefined : 'team_staff',
      },
      {
        id: 'bulletins',
        label: 'Monthly Bulletins',
        icon: Megaphone,
        used:
          summary?.quota_usage.bulletins_this_month.used ??
          fallbackCounts?.bulletinsUsed ??
          0,
        limit: rawBulletinsLimit,
        actionLabel: 'Bulletin Desk',
        targetSection: isStaffMode ? undefined : 'plans_bulletins',
      },
    ];
  }, [
    summary,
    fallbackLimit,
    fallbackCounts,
    isStaffMode,
  ]);

  const activeFeatures = useMemo(
    () =>
      SUBSCRIPTION_FEATURE_CATALOG.filter((f) =>
        can(f.key as SubscriptionFeatureKey)
      ),
    [can]
  );
  const lockedFeatures = useMemo(
    () =>
      SUBSCRIPTION_FEATURE_CATALOG.filter(
        (f) => !can(f.key as SubscriptionFeatureKey)
      ),
    [can]
  );

  const activeSub = summary?.active_subscription;
  const isTrialEligible = Boolean(
    !isStaffMode && summary?.owner_profile.is_trial_eligible
  );
  const bestTrialPlan = summary?.trial_eligible_plans[0] || null;
  const targetedVipPlans = summary?.targeted_vip_plans || [];
  const expiringItems = summary?.expiring_pay_per_items || [];

  return (
    <div
      data-testid={`owner-overview-plan-panel-${viewMode}`}
      className="space-y-4 text-xs"
    >
      {/* 1. DELEGATED STAFF INHERITED CONTEXT PILL (When hat=staff) */}
      {isStaffMode && (
        <div
          data-testid="staff-inherited-context-pill"
          className="rounded-2xl border border-[var(--ps-accent)]/35 bg-[var(--ps-accent)]/10 p-3.5 sm:p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
        >
          <div className="flex items-start sm:items-center gap-2.5 min-w-0">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]">
              <ShieldCheck className="h-4 w-4" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="text-xs sm:text-sm font-extrabold text-[var(--ps-text)]">
                  Acting as Delegated Staff for{' '}
                  <span className="text-[var(--ps-accent)]">
                    {activeBusinessTitle ||
                      summary?.owner_profile.full_name ||
                      'Assigned Business'}
                  </span>
                </span>
                <span className="rounded-full border border-[var(--ps-accent)]/30 bg-[var(--ps-surface)] px-2 py-0.5 text-[10px] font-bold text-[var(--ps-accent)]">
                  Owner-Inherited Capabilities
                </span>
              </div>
              <p className="mt-0.5 text-[11px] text-[var(--ps-text-muted)]">
                Operational features are unlocked directly from the business
                owner&apos;s active subscription ({activeSub?.plan_name || 'Active Plan'}).
                Billing, staff management, and destructive delete actions remain owner-only.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* 2. ACTIVE PLAN / FREE TRIAL / DEFAULT FREE CARD + QUOTA METERS */}
      <div
        data-testid="owner-active-plan-and-quotas-card"
        className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 sm:p-5 space-y-4 shadow-2xs"
      >
        {isLoading && entitlementsLoading ? (
          <div className="space-y-3" data-testid="owner-plan-shimmer">
            <div className="flex items-center justify-between gap-3">
              <div className="dd-shimmer h-10 w-64 rounded-xl" />
              <div className="dd-shimmer h-10 w-36 rounded-xl" />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              {[0, 1, 2, 3].map((idx) => (
                <div key={idx} className="dd-shimmer h-20 rounded-xl" />
              ))}
            </div>
          </div>
        ) : (
          <>
            {/* Top Row: Active Plan Identity & Trial/Upgrade CTAs */}
            <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3 border-b border-[var(--ps-border)] pb-3.5">
              <div className="flex items-start gap-3 min-w-0">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-accent)]">
                  <Crown className="h-5 w-5" aria-hidden="true" />
                </div>
                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <h3 className="text-sm sm:text-base font-extrabold text-[var(--ps-text)]">
                      {activeSub?.plan_name || 'Default Free Tier'}
                    </h3>
                    <span
                      className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider ${
                        activeSub?.is_trial
                          ? 'border-amber-500/35 bg-amber-500/12 text-amber-700 dark:text-amber-300'
                          : activeSub?.is_default_free
                            ? 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)]'
                            : 'border-emerald-500/35 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                      }`}
                    >
                      {activeSub?.is_trial
                        ? 'Free Trial Active'
                        : activeSub?.is_default_free
                          ? 'Default Free Baseline'
                          : 'Active Subscription'}
                    </span>
                    {typeof activeSub?.days_remaining === 'number' && (
                      <span className="inline-flex items-center gap-1 rounded-full border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 py-0.5 text-[10px] font-bold text-[var(--ps-text)] tabular-nums">
                        <Clock className="h-3 w-3 text-[var(--ps-accent)]" />
                        <span>
                          {activeSub.days_remaining} day
                          {activeSub.days_remaining === 1 ? '' : 's'} remaining
                        </span>
                      </span>
                    )}
                    {hasAnySuperAdminOverride && (
                      <span
                        data-testid="super-admin-precedence-badge"
                        className="inline-flex items-center gap-1 rounded-full border border-purple-500/30 bg-purple-500/12 px-2.5 py-0.5 text-[10px] font-bold text-purple-700 dark:text-purple-300"
                      >
                        <ShieldCheck className="h-3 w-3" />
                        <span>Super-Admin Override Active</span>
                      </span>
                    )}
                  </div>
                  <p className="text-[11px] text-[var(--ps-text-muted)]">
                    {activeSub?.plan_info ||
                      'Live quotas and feature gates inherit from your active plan or Default Free baseline.'}
                  </p>
                </div>
              </div>

              {/* Action Buttons (Strictly Hidden for Delegated Staff) */}
              {!isStaffMode && (
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  {isTrialEligible && bestTrialPlan && (
                    <button
                      type="button"
                      disabled={isStartingTrialId === bestTrialPlan.id}
                      onClick={() => void handleStartFreeTrial(bestTrialPlan)}
                      data-testid="owner-start-free-trial-btn"
                      className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/15 px-3.5 py-2 text-xs font-extrabold text-amber-800 dark:text-amber-200 hover:bg-amber-500/25 transition-colors cursor-pointer disabled:opacity-50"
                    >
                      <Sparkles className="h-4 w-4 shrink-0" />
                      <span>
                        {isStartingTrialId === bestTrialPlan.id
                          ? 'Activating Trial…'
                          : `Start ${bestTrialPlan.trial_days}-Day Free Trial (${bestTrialPlan.title})`}
                      </span>
                    </button>
                  )}

                  <Link
                    href="/bulletin?plans=1"
                    data-testid="owner-explore-plans-link"
                    className="inline-flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3.5 py-2 text-xs font-bold text-[var(--ps-accent-fg)] shadow-2xs hover:opacity-95 transition-opacity"
                  >
                    <Crown className="h-3.5 w-3.5 shrink-0" />
                    <span>Compare &amp; Upgrade Plans</span>
                    <ArrowUpRight className="h-3.5 w-3.5 shrink-0" />
                  </Link>
                </div>
              )}
            </div>

            {/* 4 Live Quota Meters */}
            <div
              data-testid="owner-live-quota-meters-grid"
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3"
            >
              {quotaMeters.map((m) => {
                const Icon = m.icon;
                const isUnlimited = m.limit === null || m.limit < 0;
                const isBlocked = m.limit === 0;
                const isAtLimit =
                  !isUnlimited && m.limit !== null && m.used >= m.limit;
                const isNearLimit =
                  !isUnlimited &&
                  !isAtLimit &&
                  m.limit !== null &&
                  m.limit > 0 &&
                  m.used / m.limit >= 0.8;
                const pct = isUnlimited
                  ? 25
                  : m.limit === 0
                    ? 100
                    : Math.min(
                        100,
                        Math.round((m.used / Math.max(1, m.limit || 1)) * 100)
                      );

                return (
                  <div
                    key={m.id}
                    data-testid={`owner-quota-meter-${m.id}`}
                    className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3.5 flex flex-col justify-between gap-2.5"
                  >
                    <div className="space-y-2">
                      <div className="flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--ps-text-muted)] truncate">
                          <Icon className="h-3.5 w-3.5 text-[var(--ps-accent)] shrink-0" />
                          <span className="truncate">{m.label}</span>
                        </span>
                        <span
                          className={`font-mono text-xs font-extrabold tabular-nums shrink-0 ${
                            isAtLimit || isBlocked
                              ? 'text-rose-600 dark:text-rose-400'
                              : isNearLimit
                                ? 'text-amber-600 dark:text-amber-400'
                                : 'text-[var(--ps-text)]'
                          }`}
                        >
                          {m.used} / {formatLimitLabel(m.limit)}
                        </span>
                      </div>

                      <div className="h-1.5 w-full rounded-full bg-[var(--ps-surface-alt)] overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all ${
                            isAtLimit || isBlocked
                              ? 'bg-rose-500'
                              : isNearLimit
                                ? 'bg-amber-500'
                                : 'bg-[var(--ps-accent)]'
                          }`}
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 pt-0.5">
                      <span className="text-[10.5px] text-[var(--ps-text-muted)]">
                        {isBlocked
                          ? 'Plan upgrade required'
                          : isAtLimit
                            ? 'Quota reached — use Pay-Per or Upgrade'
                            : isNearLimit
                              ? 'Near plan quota'
                              : 'Within plan quota'}
                      </span>

                      {m.targetSection && onNavigateToSection && (
                        <button
                          type="button"
                          onClick={() => onNavigateToSection(m.targetSection!)}
                          className="text-[11px] font-bold text-[var(--ps-accent)] hover:underline shrink-0 cursor-pointer"
                        >
                          {m.actionLabel} →
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Targeted VIP Plans ("Special Plan for You") */}
            {!isStaffMode && targetedVipPlans.length > 0 && (
              <div
                data-testid="owner-targeted-vip-plans-banner"
                className="rounded-xl border border-[var(--ps-accent)]/40 bg-[var(--ps-accent)]/8 p-3.5 space-y-2.5"
              >
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full bg-[var(--ps-accent)] px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-[var(--ps-accent-fg)]">
                    <Sparkles className="h-3 w-3" />
                    <span>Special Plan for You</span>
                  </span>
                  <span className="text-xs font-bold text-[var(--ps-text)]">
                    Exclusive partner plan curated for your account
                  </span>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-2.5">
                  {targetedVipPlans.map((vip) => (
                    <div
                      key={vip.id}
                      className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5"
                    >
                      <div className="min-w-0">
                        <div className="font-bold text-xs text-[var(--ps-text)]">
                          {vip.title}
                        </div>
                        <div className="text-[11px] text-[var(--ps-text-muted)] line-clamp-2">
                          {vip.info ||
                            `₹${vip.price_inr.toLocaleString('en-IN')} / ${vip.duration_days} days`}
                        </div>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {isTrialEligible && vip.trial_days > 0 && (
                          <button
                            type="button"
                            disabled={isStartingTrialId === vip.id}
                            onClick={() => void handleStartFreeTrial(vip)}
                            className="inline-flex min-h-[44px] items-center justify-center rounded-xl border border-amber-500/40 bg-amber-500/15 px-3 py-1.5 text-[11px] font-bold text-amber-800 dark:text-amber-200 cursor-pointer"
                          >
                            Start {vip.trial_days}d Trial
                          </button>
                        )}
                        <Link
                          href="/bulletin?plans=1"
                          className="inline-flex min-h-[44px] items-center justify-center rounded-xl bg-[var(--ps-accent)] px-3 py-1.5 text-[11px] font-bold text-[var(--ps-accent-fg)]"
                        >
                          View Offer
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Unlocked & Locked Capability Pills */}
            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)] mr-1">
                  <Gauge className="h-3 w-3 text-[var(--ps-accent)]" />
                  <span>Unlocked ({activeFeatures.length}):</span>
                </span>
                {activeFeatures.slice(0, 8).map((feat) => {
                  const overrideState = isOverriddenBySuperAdmin(
                    feat.key as SubscriptionFeatureKey
                  );
                  return (
                    <span
                      key={feat.key}
                      className="inline-flex items-center gap-1 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300"
                    >
                      <CheckCircle2 className="h-2.5 w-2.5 shrink-0" />
                      <span>{feat.label}</span>
                      {overrideState === 'enabled' && (
                        <span className="text-[9px] font-bold text-purple-600 dark:text-purple-300">
                          (Override)
                        </span>
                      )}
                    </span>
                  );
                })}
                {activeFeatures.length > 8 && (
                  <span className="text-[10px] text-[var(--ps-text-muted)]">
                    +{activeFeatures.length - 8} more
                  </span>
                )}
              </div>

              {lockedFeatures.length > 0 && !isStaffMode && (
                <div className="flex items-center gap-1.5 text-[11px] text-[var(--ps-text-muted)]">
                  <Lock className="h-3 w-3 shrink-0" />
                  <span>{lockedFeatures.length} advanced tools locked</span>
                  {viewMode === 'overview' && onNavigateToSection && (
                    <button
                      type="button"
                      onClick={() => onNavigateToSection('plans_subscription')}
                      className="font-bold text-[var(--ps-accent)] hover:underline cursor-pointer"
                    >
                      View Plans &amp; Trials →
                    </button>
                  )}
                </div>
              )}
            </div>
          </>
        )}
      </div>

      {/* 3. PAY-PER SOFT-EXPIRY ALERTS (1-Tap Renew via PayPerCheckoutModal) */}
      {(expiringItems.length > 0 || viewMode === 'plans_and_pay_per') && (
        <div
          data-testid="owner-pay-per-soft-expiry-section"
          className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 sm:p-5 space-y-3 shadow-2xs"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400">
                <AlertTriangle className="h-4 w-4" aria-hidden="true" />
              </div>
              <div>
                <h4 className="text-xs sm:text-sm font-extrabold text-[var(--ps-text)]">
                  Pay-Per Visibility Passes &amp; Soft-Expiry Renewals (
                  {expiringItems.length})
                </h4>
                <p className="text-[11px] text-[var(--ps-text-muted)]">
                  Soft-expired items are never deleted — renew visibility in 1 tap to restore public listing placement immediately.
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => void loadSummary()}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-1.5 text-xs font-semibold text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
            >
              <RefreshCw className="h-3.5 w-3.5" />
              <span>Refresh</span>
            </button>
          </div>

          {expiringItems.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 text-center text-xs text-[var(--ps-text-muted)]">
              All Pay-Per Marketplace products, Bulletins, and Real Estate listings have active visibility windows (none expiring within 7 days).
            </div>
          ) : (
            <div className="divide-y divide-[var(--ps-border)] rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)]">
              {expiringItems.map((item) => (
                <div
                  key={`${item.target_table}-${item.id}`}
                  data-testid={`expiring-pay-per-row-${item.id}`}
                  className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5"
                >
                  <div className="min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="font-bold text-xs text-[var(--ps-text)] truncate">
                        {item.title}
                      </span>
                      <span className="rounded-md border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2 py-0.5 text-[10px] font-semibold text-[var(--ps-text-muted)]">
                        {PAY_PER_MODULE_LABELS[item.module_key] ||
                          item.module_key}
                      </span>
                      <span
                        className={`rounded-full px-2 py-0.5 text-[10px] font-extrabold ${
                          item.is_expired
                            ? 'bg-rose-500/15 text-rose-700 dark:text-rose-300 border border-rose-500/30'
                            : 'bg-amber-500/15 text-amber-700 dark:text-amber-300 border border-amber-500/30'
                        }`}
                      >
                        {item.is_expired
                          ? 'Soft-Expired (Hidden from Public)'
                          : `Expires in ${Math.max(0, item.days_left)}d`}
                      </span>
                    </div>
                    <div className="text-[11px] text-[var(--ps-text-muted)]">
                      Paid window end:{' '}
                      {new Date(item.paid_until).toLocaleDateString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}
                    </div>
                  </div>

                  {!isStaffMode && (
                    <button
                      type="button"
                      onClick={() => setRenewTarget(item)}
                      data-testid={`renew-pay-per-btn-${item.id}`}
                      className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3.5 py-2 text-xs font-bold text-[var(--ps-accent-fg)] shadow-2xs hover:opacity-95 transition-opacity cursor-pointer"
                    >
                      <Sparkles className="h-3.5 w-3.5" />
                      <span>Renew Pay-Per</span>
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 4. FULL TRIAL & PLAN CATALOGUE VIEW (When in Group 7: Plans, Trials & Pay-Per) */}
      {viewMode === 'plans_and_pay_per' && !isStaffMode && (
        <div
          data-testid="owner-plans-trials-catalogue"
          className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 sm:p-5 space-y-4 shadow-2xs"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ps-border)] pb-3">
            <div>
              <h4 className="text-sm font-extrabold text-[var(--ps-text)]">
                Available Subscription Plans &amp; Free Trials
              </h4>
              <p className="text-[11px] text-[var(--ps-text-muted)]">
                {isTrialEligible
                  ? 'Your account is eligible for a 1-time Free Trial on any trial-enabled plan below.'
                  : 'Compare active subscription plans or purchase single-item Pay-Per passes anytime.'}
              </p>
            </div>
            <Link
              href="/bulletin?plans=1"
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 py-2 text-xs font-bold text-[var(--ps-text)] hover:border-[var(--ps-accent)]"
            >
              <Layers className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
              <span>Open Full Plans Modal</span>
            </Link>
          </div>

          {summary?.trial_eligible_plans &&
          summary.trial_eligible_plans.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {summary.trial_eligible_plans.map((plan) => (
                <div
                  key={plan.id}
                  className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 flex flex-col justify-between gap-3"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-extrabold text-sm text-[var(--ps-text)]">
                        {plan.title}
                      </span>
                      {plan.target_scope === 'selected_users' && (
                        <span className="rounded-full bg-[var(--ps-accent)]/15 px-2 py-0.5 text-[10px] font-bold text-[var(--ps-accent)]">
                          VIP Plan
                        </span>
                      )}
                    </div>
                    <div className="font-mono text-base font-black text-[var(--ps-accent)]">
                      ₹{plan.price_inr.toLocaleString('en-IN')}
                      <span className="text-[11px] font-normal text-[var(--ps-text-muted)]">
                        {' '}
                        / {plan.duration_days} days
                      </span>
                    </div>
                    <p className="text-[11px] text-[var(--ps-text-muted)]">
                      {plan.info ||
                        'Unlocks multi-listing quotas, staff seats, and online checkout tools.'}
                    </p>
                  </div>

                  <div className="flex flex-col gap-2 pt-2 border-t border-[var(--ps-border)]">
                    {isTrialEligible && plan.trial_days > 0 && (
                      <button
                        type="button"
                        disabled={isStartingTrialId === plan.id}
                        onClick={() => void handleStartFreeTrial(plan)}
                        className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-xl border border-amber-500/40 bg-amber-500/15 px-3 py-2 text-xs font-extrabold text-amber-800 dark:text-amber-200 hover:bg-amber-500/25 cursor-pointer disabled:opacity-50"
                      >
                        <Sparkles className="h-3.5 w-3.5" />
                        <span>
                          {isStartingTrialId === plan.id
                            ? 'Activating…'
                            : `Start ${plan.trial_days}-Day Free Trial`}
                        </span>
                      </button>
                    )}
                    <Link
                      href="/bulletin?plans=1"
                      className="inline-flex min-h-[44px] w-full items-center justify-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3 py-2 text-xs font-bold text-[var(--ps-accent-fg)]"
                    >
                      <span>Select Plan</span>
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 text-center text-xs text-[var(--ps-text-muted)]">
              Visit the Full Plans Modal to view all public and custom subscription tiers.
            </div>
          )}
        </div>
      )}

      {/* Optional children slot (e.g., KPI cards / Activity Feed in Overview, or OwnerBulletinsPanel in Plans & Pay-Per) */}
      {children}

      {/* 1-Tap Pay-Per Renewal Modal */}
      {renewTarget && (
        <PayPerCheckoutModal
          open={Boolean(renewTarget)}
          onClose={() => setRenewTarget(null)}
          moduleKey={renewTarget.module_key}
          targetTable={renewTarget.target_table}
          targetId={renewTarget.id}
          targetTitle={renewTarget.title}
          initialPropertyPriceInr={renewTarget.price_inr || null}
          onSuccess={(payload) => {
            setRenewTarget(null);
            onNotice?.({
              type: 'success',
              text: `Submitted Pay-Per renewal (₹${payload.amountInr.toLocaleString('en-IN')} for ${payload.durationDays} days).`,
            });
            void loadSummary();
          }}
        />
      )}

      {confirmDialog}
    </div>
  );
}

export default OwnerOverviewAndPlanPanel;
