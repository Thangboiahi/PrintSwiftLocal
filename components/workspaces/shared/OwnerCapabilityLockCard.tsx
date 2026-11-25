'use client';

import React from 'react';
import { Lock, ShieldAlert, Sparkles } from 'lucide-react';

export interface OwnerCapabilityLockCardProps {
  title: string;
  entitlementLabel: string;
  description: string;
  isStaffMode: boolean;
  onUpgradePlan?: () => void;
  testId?: string;
}

/**
 * Clean, non-broken locked state displayed inside Owner/Staff operational tabs
 * when an operational capability (Bookings, Print Orders, Pick N Drop Dispatch,
 * or Online Payments) is disabled on the Business Owner's effective subscription.
 */
export function OwnerCapabilityLockCard({
  title,
  entitlementLabel,
  description,
  isStaffMode,
  onUpgradePlan,
  testId = 'owner-capability-lock-card',
}: OwnerCapabilityLockCardProps) {
  return (
    <section
      data-testid={testId}
      className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 sm:p-8 text-center max-w-2xl mx-auto my-4 shadow-xs"
    >
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-amber-500/35 bg-amber-500/10 text-amber-600 dark:text-amber-400">
        <Lock className="h-5 w-5" aria-hidden="true" />
      </div>

      <h3 className="mt-4 text-base font-bold text-[var(--ps-text)]">
        {title}
      </h3>
      <p className="mt-1.5 text-xs text-[var(--ps-text-muted)] max-w-lg mx-auto leading-relaxed">
        {description}
      </p>

      <div className="mt-4 inline-flex items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-1.5 text-[11px] font-semibold text-[var(--ps-text)]">
        <ShieldAlert className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
        <span>Required Capability: {entitlementLabel}</span>
      </div>

      <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
        {isStaffMode ? (
          <div className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-4 py-2 text-xs font-semibold text-[var(--ps-text-muted)]">
            <Lock className="h-3.5 w-3.5" />
            <span>Managed by Business Owner — Contact owner to upgrade plan</span>
          </div>
        ) : (
          onUpgradePlan && (
            <button
              type="button"
              onClick={onUpgradePlan}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-5 py-2 text-xs font-bold text-[var(--ps-accent-fg)] shadow-xs hover:opacity-95 cursor-pointer"
            >
              <Sparkles className="h-4 w-4" />
              <span>Upgrade Plan or Start Free Trial</span>
            </button>
          )
        )}
      </div>
    </section>
  );
}

export default OwnerCapabilityLockCard;
