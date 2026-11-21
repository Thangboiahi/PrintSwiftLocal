'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Crown, Gauge, Sparkles } from 'lucide-react';
import {
  SUBSCRIPTION_FEATURE_CATALOG,
  formatSubscriptionLimitValue,
  getLimit,
  hasFeature,
  type EffectiveEntitlements,
} from '@/lib/subscriptions/feature-catalog';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';

export interface OwnerEntitlementBannerProps {
  userId: string;
  listingId?: string | null;
  currentStaffCount?: number;
  currentItemCount?: number;
}

export function OwnerEntitlementBanner({
  userId,
  listingId,
  currentStaffCount = 0,
  currentItemCount = 0,
}: OwnerEntitlementBannerProps) {
  const [entitlements, setEntitlements] =
    useState<EffectiveEntitlements | null>(null);

  useEffect(() => {
    if (!userId || !isSupabaseConfigured()) return;
    let active = true;
    const load = async () => {
      try {
        const { data, error } = await supabase.rpc(
          'get_effective_entitlements',
          {
            p_user_id: userId,
            p_listing_id: listingId || null,
          }
        );
        if (!active || error || !data || typeof data !== 'object') return;
        setEntitlements(data as EffectiveEntitlements);
      } catch {
        // Non-blocking fallback
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [userId, listingId]);

  const activeFeatureLabels = SUBSCRIPTION_FEATURE_CATALOG.filter((f) =>
    hasFeature(entitlements, f.key)
  ).map((f) => f.label);

  const maxStaff = getLimit(entitlements, 'max_staff_members') || 1;
  const maxMenuItems = getLimit(entitlements, 'max_menu_items') || 25;
  const maxProducts = getLimit(entitlements, 'max_catalogue_items') || 25;
  const itemCap = Math.max(maxMenuItems, maxProducts);

  return (
    <div
      data-testid="owner-entitlement-banner"
      className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3 text-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
            <Crown className="w-4 h-4" />
          </div>
          <div>
            <div className="font-bold text-sm text-[var(--ps-text)] flex items-center gap-1.5">
              <span>Active Subscription &amp; Composable Quotas</span>
              {entitlements?.active_plan_ids &&
                entitlements.active_plan_ids.length > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-[var(--ps-accent)]/12 text-[var(--ps-accent)] text-[10px] font-bold">
                    {entitlements.active_plan_ids.length} Active Plan
                    {entitlements.active_plan_ids.length === 1 ? '' : 's'}
                  </span>
                )}
            </div>
            <p className="text-[11px] text-[var(--ps-text-muted)]">
              Live feature entitlements &amp; usage meters for your selected business.
            </p>
          </div>
        </div>

        <Link
          href="/contact"
          className="h-8 px-3 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] font-bold inline-flex items-center gap-1.5 hover:opacity-95 transition-opacity shrink-0"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>Upgrade / Add Modules</span>
        </Link>
      </div>

      {/* Quota Usage Meters */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 text-[var(--ps-text-muted)] font-medium">
            <Gauge className="w-3.5 h-3.5 text-[var(--ps-accent)]" />
            <span>Catalogue / Menu Items</span>
          </span>
          <span className="font-extrabold text-[var(--ps-text)] tabular-nums">
            {currentItemCount} / {formatSubscriptionLimitValue(itemCap)}
          </span>
        </div>
        <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 text-[var(--ps-text-muted)] font-medium">
            <Gauge className="w-3.5 h-3.5 text-sky-500" />
            <span>Staff Members</span>
          </span>
          <span className="font-extrabold text-[var(--ps-text)] tabular-nums">
            {currentStaffCount} / {formatSubscriptionLimitValue(maxStaff)}
          </span>
        </div>
        <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 text-[var(--ps-text-muted)] font-medium">
            <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" />
            <span>Active Feature Flags</span>
          </span>
          <span className="font-extrabold text-[var(--ps-text)] tabular-nums">
            {activeFeatureLabels.length} enabled
          </span>
        </div>
      </div>

      {activeFeatureLabels.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {activeFeatureLabels.slice(0, 8).map((label) => (
            <span
              key={label}
              className="px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25 text-[10px] font-semibold"
            >
              ✓ {label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default OwnerEntitlementBanner;
