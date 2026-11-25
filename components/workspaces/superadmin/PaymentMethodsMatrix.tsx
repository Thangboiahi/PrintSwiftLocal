'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  CreditCard,
  Loader2,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
} from 'lucide-react';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { useConfirmDialogState } from '@/components/ui/ConfirmDialog';
import {
  DEFAULT_PAYMENT_POLICIES,
  type PaymentFeaturePolicyRow,
} from '@/lib/payments/resolver';

interface PaymentMethodsMatrixProps {
  onNotice?: (notice: {
    type: 'success' | 'error' | 'info';
    text: string;
  }) => void;
}

type PolicyBooleanField =
  | 'upi_enabled'
  | 'manual_enabled'
  | 'escrow_required'
  | 'allow_listing_override';

const FIELD_LABELS: Record<PolicyBooleanField, string> = {
  upi_enabled: 'System UPI',
  manual_enabled: 'Manual / Cash / Direct Settlement',
  escrow_required: 'Escrow Requirement',
  allow_listing_override: 'Per-Listing Override',
};

// =============================================================================
// PHASE 10 SKELETAL LOADER
// =============================================================================
function PaymentMatrixSkeleton() {
  return (
    <div className="space-y-4" aria-busy="true" aria-label="Loading payment policies">
      {[1, 2].map((group) => (
        <div
          key={group}
          className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3"
        >
          <div className="h-4 w-48 rounded-lg dd-shimmer" />
          <div className="space-y-2.5">
            {[1, 2, 3, 4].map((row) => (
              <div
                key={row}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3"
              >
                <div className="space-y-1.5">
                  <div className="h-3.5 w-40 rounded-lg dd-shimmer" />
                  <div className="h-3 w-24 rounded-lg dd-shimmer" />
                </div>
                <div className="flex gap-2">
                  {[1, 2, 3, 4].map((col) => (
                    <div key={col} className="h-11 w-20 rounded-xl dd-shimmer" />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function PaymentMethodsMatrix({ onNotice }: PaymentMethodsMatrixProps) {
  const { confirm, dialog } = useConfirmDialogState();

  const [policies, setPolicies] = useState<PaymentFeaturePolicyRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isUsingFallback, setIsUsingFallback] = useState(false);
  const [savingKey, setSavingKey] = useState<string | null>(null);
  const [isBulkDisablingUpi, setIsBulkDisablingUpi] = useState(false);

  const loadPolicies = useCallback(async () => {
    setIsLoading(true);
    setIsUsingFallback(false);
    if (!isSupabaseConfigured()) {
      setPolicies(DEFAULT_PAYMENT_POLICIES);
      setIsUsingFallback(true);
      setIsLoading(false);
      return;
    }

    try {
      const { data, error } = await supabase
        .from('payment_feature_policies')
        .select(
          'scope_key, scope_type, label, upi_enabled, manual_enabled, escrow_required, allow_listing_override, updated_at'
        )
        .order('scope_type', { ascending: true })
        .order('label', { ascending: true });

      if (error || !Array.isArray(data) || data.length === 0) {
        setPolicies(DEFAULT_PAYMENT_POLICIES);
        setIsUsingFallback(true);
      } else {
        setPolicies(data as PaymentFeaturePolicyRow[]);
      }
    } catch {
      setPolicies(DEFAULT_PAYMENT_POLICIES);
      setIsUsingFallback(true);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void loadPolicies();
    });
  }, [loadPolicies]);

  const featurePolicies = useMemo(
    () => policies.filter((p) => p.scope_type === 'feature'),
    [policies]
  );

  const listingTypePolicies = useMemo(
    () => policies.filter((p) => p.scope_type === 'listing_type'),
    [policies]
  );

  const anyUpiEnabled = useMemo(
    () => policies.some((p) => p.upi_enabled),
    [policies]
  );

  const handleToggleField = async (
    row: PaymentFeaturePolicyRow,
    field: PolicyBooleanField
  ) => {
    const nextValue = !row[field];
    const bothDisabledAfter =
      (field === 'upi_enabled' && !nextValue && !row.manual_enabled) ||
      (field === 'manual_enabled' && !nextValue && !row.upi_enabled);

    // High-impact toggles always require ConfirmDialog with explicit caution & impact summary
    if (field === 'upi_enabled' && nextValue === false) {
      const ok = await confirm({
        title: `Disable UPI for "${row.label}"?`,
        description:
          'Turning off System UPI immediately blocks online UPI checkout across every listing or order under this scope (Layer 1 overrides both subscriptions and listing settings).',
        caution: bothDisabledAfter
          ? 'Both UPI and Manual payments will be OFF for this scope — customers will not be able to submit checkout payments.'
          : 'Checkouts under this scope will fall back to Manual payment until UPI is re-enabled.',
        impactSummary: [
          `Scope: ${row.label} (${row.scope_key})`,
          `Manual payment currently: ${row.manual_enabled ? 'ON' : 'OFF'}`,
          'Logged to public.audit_logs',
        ],
        confirmLabel: 'Disable UPI',
        variant: 'danger',
      });
      if (!ok) return;
    } else if (field === 'manual_enabled' && nextValue === false) {
      const ok = await confirm({
        title: `Disable Manual Payment for "${row.label}"?`,
        description:
          'Turning off Manual / Direct settlement forces all checkouts under this scope onto UPI only (where eligible).',
        caution: bothDisabledAfter
          ? 'CRITICAL: UPI is already OFF for this scope. Disabling Manual removes all available payment methods.'
          : 'Partners without an active online_payment subscription entitlement may lose checkout eligibility.',
        impactSummary: [
          `Scope: ${row.label} (${row.scope_key})`,
          `UPI currently: ${row.upi_enabled ? 'ON' : 'OFF'}`,
        ],
        confirmLabel: 'Disable Manual',
        variant: bothDisabledAfter ? 'danger' : 'warning',
      });
      if (!ok) return;
    } else if (field === 'escrow_required') {
      const ok = await confirm({
        title: `${nextValue ? 'Require' : 'Disable'} Escrow for "${row.label}"?`,
        description: nextValue
          ? 'New orders under this scope will hold customer funds in escrow until OTP / delivery completion.'
          : 'Disabling escrow releases settlement directly without platform escrow holdback.',
        caution: !nextValue
          ? 'Removing escrow reduces buyer dispute protection for orders in this vertical.'
          : undefined,
        impactSummary: [
          `Scope: ${row.label} (${row.scope_key})`,
          `Escrow Required: ${row.escrow_required ? 'ON' : 'OFF'} -> ${nextValue ? 'ON' : 'OFF'}`,
        ],
        confirmLabel: nextValue ? 'Require Escrow' : 'Disable Escrow',
        variant: nextValue ? 'info' : 'warning',
      });
      if (!ok) return;
    } else if (field === 'allow_listing_override' && nextValue === false) {
      const ok = await confirm({
        title: `Lock Listing Payment Override for "${row.label}"?`,
        description:
          'Individual listing owners under this vertical will no longer be able to select custom manual/UPI preferences — system policy defaults will strictly apply.',
        impactSummary: [`Scope: ${row.label} (${row.scope_key})`],
        confirmLabel: 'Lock Override',
        variant: 'warning',
      });
      if (!ok) return;
    }

    const lockKey = `${row.scope_key}:${field}`;
    setSavingKey(lockKey);

    const prevPolicies = policies;
    setPolicies((current) =>
      current.map((p) =>
        p.scope_key === row.scope_key ? { ...p, [field]: nextValue } : p
      )
    );

    if (!isSupabaseConfigured() || isUsingFallback) {
      setSavingKey(null);
      onNotice?.({
        type: 'info',
        text: `Updated ${row.label} (${FIELD_LABELS[field]}) locally — run v15b SQL migration to persist to Supabase.`,
      });
      return;
    }

    try {
      const { error } = await supabase
        .from('payment_feature_policies')
        .update({ [field]: nextValue })
        .eq('scope_key', row.scope_key);

      if (error) throw new Error(error.message);

      onNotice?.({
        type: 'success',
        text: `Updated "${row.label}" → ${FIELD_LABELS[field]} = ${nextValue ? 'ON' : 'OFF'} (audited).`,
      });
    } catch (err) {
      setPolicies(prevPolicies);
      onNotice?.({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : `Failed to update payment policy for ${row.label}.`,
      });
    } finally {
      setSavingKey(null);
    }
  };

  const handleDisableUpiGlobally = async () => {
    const enabledCount = policies.filter((p) => p.upi_enabled).length;
    const ok = await confirm({
      title: 'Disable UPI Globally Across All Features & Listing Types?',
      description:
        'This emergency kill-switch sets upi_enabled = false across every row in payment_feature_policies. All checkouts will fall back to Manual payment until UPI is re-enabled.',
      caution:
        'Use during payment gateway outages or compliance incidents. Re-enable each vertical individually once service resumes.',
      impactSummary: [
        `Affects ${enabledCount} active UPI policy scope${enabledCount === 1 ? '' : 's'} immediately`,
        'Overrides all L2 Subscription and L3 Listing payment settings',
        'Recorded in public.audit_logs',
      ],
      confirmLabel: 'Disable UPI Everywhere',
      variant: 'danger',
    });
    if (!ok) return;

    setIsBulkDisablingUpi(true);
    const prevPolicies = policies;
    setPolicies((current) =>
      current.map((p) => ({ ...p, upi_enabled: false }))
    );

    try {
      if (isSupabaseConfigured() && !isUsingFallback) {
        const { error } = await supabase
          .from('payment_feature_policies')
          .update({ upi_enabled: false })
          .eq('upi_enabled', true);
        if (error) throw new Error(error.message);
      }
      onNotice?.({
        type: 'info',
        text: 'Global UPI kill-switch applied across all payment feature policies (logged to audit trail).',
      });
    } catch (err) {
      setPolicies(prevPolicies);
      onNotice?.({
        type: 'error',
        text:
          err instanceof Error ? err.message : 'Failed to disable UPI globally.',
      });
    } finally {
      setIsBulkDisablingUpi(false);
    }
  };

  const renderPolicyGroup = (
    title: string,
    subtitle: string,
    items: PaymentFeaturePolicyRow[]
  ) => (
    <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] overflow-hidden">
      <div className="border-b border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-4 py-3">
        <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--ps-text)]">
          {title} ({items.length})
        </h3>
        <p className="mt-0.5 text-[11px] text-[var(--ps-text-muted)]">
          {subtitle}
        </p>
      </div>

      {/* Mobile Stacked Cards */}
      <div className="divide-y divide-[var(--ps-border)] md:hidden">
        {items.map((row) => (
          <div key={row.scope_key} className="p-4 space-y-3">
            <div>
              <div className="text-xs font-bold text-[var(--ps-text)]">
                {row.label}
              </div>
              <div className="font-mono text-[10px] text-[var(--ps-text-muted)]">
                scope: {row.scope_key}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2">
              {(
                [
                  { field: 'upi_enabled', label: 'UPI Enabled' },
                  { field: 'manual_enabled', label: 'Manual Enabled' },
                  { field: 'escrow_required', label: 'Escrow Required' },
                  {
                    field: 'allow_listing_override',
                    label: 'Listing Override',
                  },
                ] as const
              ).map((toggle) => {
                const active = row[toggle.field];
                const isBusy = savingKey === `${row.scope_key}:${toggle.field}`;
                return (
                  <button
                    key={toggle.field}
                    type="button"
                    role="switch"
                    aria-checked={active}
                    disabled={isBusy}
                    onClick={() => void handleToggleField(row, toggle.field)}
                    className={`inline-flex min-h-[44px] items-center justify-between gap-2 rounded-xl border px-3 text-[11px] font-semibold cursor-pointer ${
                      active
                        ? toggle.field === 'escrow_required'
                          ? 'border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300'
                          : 'border-emerald-500/40 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                        : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)]'
                    }`}
                  >
                    <span className="truncate">{toggle.label}</span>
                    {isBusy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin shrink-0" />
                    ) : (
                      <span className="font-mono text-[10px] font-bold uppercase">
                        {active ? 'ON' : 'OFF'}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Desktop Matrix Table */}
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-xs">
          <thead className="border-b border-[var(--ps-border)] text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
            <tr>
              <th className="px-4 py-3">Scope</th>
              <th className="px-3 py-3 text-center">UPI Enabled</th>
              <th className="px-3 py-3 text-center">Manual Enabled</th>
              <th className="px-3 py-3 text-center">Escrow Required</th>
              <th className="px-3 py-3 text-center">Allow Listing Override</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--ps-border)]">
            {items.map((row) => (
              <tr
                key={row.scope_key}
                data-testid={`payment-policy-row-${row.scope_key}`}
                className="hover:bg-[var(--ps-surface-alt)]/40"
              >
                <td className="px-4 py-3">
                  <div className="font-semibold text-[var(--ps-text)]">
                    {row.label}
                  </div>
                  <div className="font-mono text-[10px] text-[var(--ps-text-muted)]">
                    {row.scope_key}
                  </div>
                </td>
                {(
                  [
                    'upi_enabled',
                    'manual_enabled',
                    'escrow_required',
                    'allow_listing_override',
                  ] as const
                ).map((field) => {
                  const active = row[field];
                  const isBusy = savingKey === `${row.scope_key}:${field}`;
                  return (
                    <td key={field} className="px-3 py-2.5 text-center">
                      <button
                        type="button"
                        role="switch"
                        aria-checked={active}
                        data-testid={`policy-toggle-${row.scope_key}-${field}`}
                        disabled={isBusy}
                        onClick={() => void handleToggleField(row, field)}
                        className={`inline-flex min-h-[44px] min-w-[78px] items-center justify-center gap-1.5 rounded-xl border px-3 text-[11px] font-bold transition cursor-pointer ${
                          active
                            ? field === 'escrow_required'
                              ? 'border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300'
                              : 'border-emerald-500/40 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                            : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)]'
                        }`}
                      >
                        {isBusy ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <span>{active ? 'ON' : 'OFF'}</span>
                        )}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <section
      data-testid="superadmin-payment-methods-matrix"
      className="space-y-4"
    >
      {dialog}

      {/* Header & Cascade Summary */}
      <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <CreditCard className="h-4 w-4 text-[var(--ps-accent)] shrink-0" />
              <h2 className="text-sm font-bold text-[var(--ps-text)]">
                3-Tier Payment Method Matrix (<code className="font-mono">payment_feature_policies</code>)
              </h2>
            </div>
            <p className="mt-1 text-xs text-[var(--ps-text-muted)]">
              Enforces the strict checkout cascade:{' '}
              <strong>Layer 1 (System Policy)</strong> →{' '}
              <strong>Layer 2 (Owner Subscription)</strong> →{' '}
              <strong>Layer 3 (Listing Mode)</strong>. High-impact changes
              require confirmation.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => void loadPolicies()}
              disabled={isLoading}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`}
              />
              <span>Refresh</span>
            </button>
            <button
              type="button"
              data-testid="disable-upi-globally-btn"
              disabled={!anyUpiEnabled || isBulkDisablingUpi}
              onClick={() => void handleDisableUpiGlobally()}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3.5 text-xs font-semibold text-rose-700 hover:bg-rose-500/20 disabled:opacity-45 dark:text-rose-300 cursor-pointer"
            >
              {isBulkDisablingUpi ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <ShieldAlert className="h-4 w-4" />
              )}
              <span>Disable UPI Globally</span>
            </button>
          </div>
        </div>

        {/* Cascade Reference Strip */}
        <div className="grid grid-cols-1 gap-2 text-[11px] sm:grid-cols-3">
          <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2">
            <span className="font-mono font-bold text-[var(--ps-accent)]">
              L1 · System
            </span>{' '}
            <span className="text-[var(--ps-text-muted)]">
              Master UPI, Manual, Escrow &amp; Override permissions
            </span>
          </div>
          <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2">
            <span className="font-mono font-bold text-[var(--ps-accent)]">
              L2 · Subscription
            </span>{' '}
            <span className="text-[var(--ps-text-muted)]">
              Owner&apos;s <code className="font-mono">online_payment.enabled</code>{' '}
              gates UPI
            </span>
          </div>
          <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2">
            <span className="font-mono font-bold text-[var(--ps-accent)]">
              L3 · Listing
            </span>{' '}
            <span className="text-[var(--ps-text-muted)]">
              Owner picks <code className="font-mono">manual</code> /{' '}
              <code className="font-mono">upi</code> /{' '}
              <code className="font-mono">both</code>
            </span>
          </div>
        </div>

        {isUsingFallback && (
          <div className="flex items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-[11px] text-amber-800 dark:text-amber-200">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>
              Showing default policy matrix. Apply{' '}
              <code className="font-mono">
                20261124_pass_v15b_subscriptions_and_payments.sql
              </code>{' '}
              to persist live changes in Supabase.
            </span>
          </div>
        )}
      </div>

      {isLoading ? (
        <PaymentMatrixSkeleton />
      ) : (
        <div className="space-y-4">
          {renderPolicyGroup(
            'Platform Features',
            'Platform-level services including Pick N Drop logistics, Vehicles, Bulletins, Print Orders, and Marketplace.',
            featurePolicies
          )}
          {renderPolicyGroup(
            'Listing Types (8 Fixed Level-1 System Roots)',
            'Anchored strictly to fixed Level-1 System Roots (root_key). All Level-2 and Level-3 sub-categories automatically inherit their parent Root’s payment, escrow, and listing-override rules.',
            listingTypePolicies
          )}
        </div>
      )}

      <div className="flex items-center gap-2 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-4 py-3 text-[11px] text-[var(--ps-text-muted)]">
        <ShieldCheck className="h-4 w-4 text-emerald-600 shrink-0" />
        <span>
          Every policy toggle is restricted by{' '}
          <code className="font-mono">super_admin</code> RLS and automatically
          recorded in <code className="font-mono">public.audit_logs</code>.
        </span>
      </div>
    </section>
  );
}
