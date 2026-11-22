'use client';

import React from 'react';
import Link from 'next/link';
import {
  CheckCircle2,
  Crown,
  Gauge,
  Lock,
  ShieldCheck,
  Sparkles,
} from 'lucide-react';
import {
  SUBSCRIPTION_FEATURE_CATALOG,
  formatSubscriptionLimitValue,
} from '@/lib/subscriptions/feature-catalog';
import { useEffectiveEntitlements } from '@/lib/subscriptions/useEffectiveEntitlements';

export interface OwnerEntitlementBannerProps {
  userId: string;
  listingId?: string | null;
  currentListingsCount?: number;
  currentStaffCount?: number;
  currentItemCount?: number;
}

function QuotaProgressMeter({
  label,
  current,
  max,
  accentClass = 'bg-[var(--ps-accent)]',
}: {
  label: string;
  current: number;
  max: number;
  accentClass?: string;
}) {
  const isUnlimited = max < 0;
  const pct = isUnlimited
    ? 0
    : max === 0
      ? 100
      : Math.min(100, Math.round((current / Math.max(1, max)) * 100));
  const isAtCap = !isUnlimited && current >= max;

  return (
    <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-[var(--ps-text-muted)] font-medium truncate">
          <Gauge className="w-3.5 h-3.5 text-[var(--ps-accent)] shrink-0" />
          <span className="truncate">{label}</span>
        </span>
        <span
          className={`font-extrabold tabular-nums shrink-0 ${
            isAtCap
              ? 'text-rose-600 dark:text-rose-400'
              : 'text-[var(--ps-text)]'
          }`}
        >
          {current} / {formatSubscriptionLimitValue(max)}
        </span>
      </div>
      {!isUnlimited && (
        <div className="h-1.5 w-full rounded-full bg-[var(--ps-surface-alt)] overflow-hidden">
          <div
            className={`h-full rounded-full transition-all ${
              isAtCap ? 'bg-rose-500' : accentClass
            }`}
            style={{ width: `${pct}%` }}
          />
        </div>
      )}
    </div>
  );
}

export function OwnerEntitlementBanner({
  userId,
  listingId,
  currentListingsCount = 0,
  currentStaffCount = 0,
  currentItemCount = 0,
}: OwnerEntitlementBannerProps) {
  const {
    entitlements,
    can,
    limit,
    isOverriddenBySuperAdmin,
    hasAnySuperAdminOverride,
  } = useEffectiveEntitlements(userId, listingId);

  const activeFeatures = SUBSCRIPTION_FEATURE_CATALOG.filter((f) => can(f.key));
  const lockedFeatures = SUBSCRIPTION_FEATURE_CATALOG.filter(
    (f) => !can(f.key)
  );

  const maxListings = limit('max_active_listings');
  const maxStaff = limit('max_staff_members');
  const maxMenuItems = limit('max_menu_items');
  const maxProducts = limit('max_catalogue_items');
  const itemCap =
    maxMenuItems < 0 || maxProducts < 0
      ? -1
      : Math.max(maxMenuItems, maxProducts);

  return (
    <div
      data-testid="owner-entitlement-banner"
      className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3 text-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-400 flex items-center justify-center shrink-0">
            <Crown className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="font-bold text-sm text-[var(--ps-text)] flex flex-wrap items-center gap-1.5">
              <span>Active Subscription &amp; Composable Quotas</span>
              {entitlements?.active_plan_ids &&
                entitlements.active_plan_ids.length > 0 && (
                  <span className="px-2 py-0.5 rounded-full bg-[var(--ps-accent)]/12 text-[var(--ps-accent)] text-[10px] font-bold">
                    {entitlements.active_plan_ids.length} Active Plan
                    {entitlements.active_plan_ids.length === 1 ? '' : 's'}
                  </span>
                )}
              {hasAnySuperAdminOverride && (
                <span
                  data-testid="super-admin-precedence-badge"
                  className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-700 dark:text-purple-300 border border-purple-500/30 text-[10px] font-bold"
                >
                  <ShieldCheck className="w-3 h-3" />
                  Super-Admin Precedence Active
                </span>
              )}
            </div>
            <p className="text-[11px] text-[var(--ps-text-muted)]">
              Only capabilities granted by your active plan or Super-Admin
              overrides are unlocked.
            </p>
          </div>
        </div>

        <Link
          href="/contact"
          className="h-8 px-3 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] font-bold inline-flex items-center gap-1.5 hover:opacity-95 transition-opacity shrink-0"
        >
          <Sparkles className="w-3.5 h-3.5" />
          <span>Upgrade Plan / Request Access</span>
        </Link>
      </div>

      {/* Quota Usage Progress Bars */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
        <QuotaProgressMeter
          label="Active Listings"
          current={currentListingsCount}
          max={maxListings}
          accentClass="bg-emerald-500"
        />
        <QuotaProgressMeter
          label="Catalogue / Menu Items"
          current={currentItemCount}
          max={itemCap}
          accentClass="bg-[var(--ps-accent)]"
        />
        <QuotaProgressMeter
          label="Delegated Staff Seats"
          current={currentStaffCount}
          max={maxStaff}
          accentClass="bg-sky-500"
        />
      </div>

      {/* Enabled Features */}
      {activeFeatures.length > 0 && (
        <div className="flex flex-wrap items-center gap-1.5">
          {activeFeatures.map((feat) => {
            const overrideState = isOverriddenBySuperAdmin(feat.key);
            return (
              <span
                key={feat.key}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 border border-emerald-500/25 text-[10px] font-semibold"
              >
                <CheckCircle2 className="w-2.5 h-2.5 shrink-0" />
                <span>{feat.label}</span>
                {overrideState === 'enabled' && (
                  <span className="text-[9px] font-bold text-purple-600 dark:text-purple-300">
                    (Override)
                  </span>
                )}
              </span>
            );
          })}
        </div>
      )}

      {/* Locked Capabilities Summary */}
      {lockedFeatures.length > 0 && (
        <div className="rounded-xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-bg)]/60 px-3 py-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5 min-w-0">
            <span className="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)] mr-1">
              <Lock className="w-3 h-3" />
              Locked ({lockedFeatures.length}):
            </span>
            {lockedFeatures.slice(0, 5).map((feat) => (
              <span
                key={feat.key}
                className="px-2 py-0.5 rounded-full bg-[var(--ps-surface)] text-[var(--ps-text-muted)] border border-[var(--ps-border)] text-[10px] font-medium"
              >
                {feat.label}
              </span>
            ))}
            {lockedFeatures.length > 5 && (
              <span className="text-[10px] text-[var(--ps-text-muted)]">
                +{lockedFeatures.length - 5} more
              </span>
            )}
          </div>
          <Link
            href="/contact"
            className="text-[11px] font-bold text-[var(--ps-accent)] hover:underline whitespace-nowrap"
          >
            Request Unlock →
          </Link>
        </div>
      )}
    </div>
  );
}

export default OwnerEntitlementBanner;
