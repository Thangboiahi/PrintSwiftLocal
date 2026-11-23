'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  CreditCard,
  KeyRound,
  Loader2,
  Power,
  QrCode,
  RefreshCw,
  Save,
  ShieldCheck,
  Zap,
} from 'lucide-react';
import { CustomSelectModal } from '@/components/ui/CustomSelectModal';
import {
  normalizePaymentConfig,
  type PaymentConfig,
  type PaymentDefaultMethod,
  type PaymentGatewayMode,
} from '@/lib/config/types';
import { supabase } from '@/lib/supabase/client';

export interface MasterControlTabSharedProps {
  onSavePlatformSetting: (
    key: string,
    value: unknown,
    successMessage: string
  ) => Promise<boolean>;
  onNotify?: (notice: {
    type: 'success' | 'error' | 'info';
    text: string;
  }) => void;
  refreshGlobalConfig: () => Promise<void>;
}

interface PaymentsGatewayTabProps extends MasterControlTabSharedProps {
  initialPaymentConfig: PaymentConfig;
}

interface EnvStatusResponse {
  hasKeySecret: boolean;
  hasWebhookSecret: boolean;
  hasEnvKeyId: boolean;
}

const MODE_CARDS: Array<{
  mode: PaymentGatewayMode;
  label: string;
  desc: string;
  icon: typeof Zap;
}> = [
  {
    mode: 'manual_only',
    label: 'Full Manual Only',
    desc: 'Hides Razorpay app-wide. Users pay via UPI + 12-digit UTR.',
    icon: QrCode,
  },
  {
    mode: 'dual',
    label: 'Dual: Razorpay + Manual',
    desc: 'Users choose Instant Razorpay OR Manual UPI at checkout.',
    icon: Zap,
  },
  {
    mode: 'razorpay_only',
    label: 'Razorpay Only',
    desc: 'Online instant gateway only. Manual UPI hidden.',
    icon: CreditCard,
  },
];

export function PaymentsGatewayTab({
  initialPaymentConfig,
  onSavePlatformSetting,
}: PaymentsGatewayTabProps) {
  const [form, setForm] = useState<PaymentConfig>(() =>
    normalizePaymentConfig(initialPaymentConfig)
  );
  const [isSaving, setIsSaving] = useState(false);
  const [isTogglingMaster, setIsTogglingMaster] = useState(false);

  const [envStatus, setEnvStatus] = useState<EnvStatusResponse | null>(null);
  const [envLoading, setEnvLoading] = useState(true);
  const [envError, setEnvError] = useState<string | null>(null);

  useEffect(() => {
    queueMicrotask(() => {
      setForm(normalizePaymentConfig(initialPaymentConfig));
    });
  }, [initialPaymentConfig]);

  const loadEnvStatus = useCallback(async () => {
    setEnvLoading(true);
    setEnvError(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        setEnvError('Sign in to inspect server secret health.');
        return;
      }
      const res = await fetch('/api/admin/payment-env-status', {
        headers: { Authorization: `Bearer ${token}` },
        cache: 'no-store',
      });
      const json = (await res.json().catch(() => ({}))) as EnvStatusResponse & {
        error?: string;
      };
      if (!res.ok) {
        setEnvError(json.error || 'Could not check server secrets.');
        return;
      }
      setEnvStatus({
        hasKeySecret: Boolean(json.hasKeySecret),
        hasWebhookSecret: Boolean(json.hasWebhookSecret),
        hasEnvKeyId: Boolean(json.hasEnvKeyId),
      });
    } catch (err) {
      setEnvError(
        err instanceof Error ? err.message : 'Unable to check server env status.'
      );
    } finally {
      setEnvLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void loadEnvStatus();
    });
  }, [loadEnvStatus]);

  const isRazorpayLive =
    form.razorpay_enabled && form.payment_mode !== 'manual_only';

  const applyModeSelection = (mode: PaymentGatewayMode): PaymentConfig => {
    if (mode === 'manual_only') {
      return {
        ...form,
        payment_mode: 'manual_only',
        razorpay_enabled: false,
        manual_upi_enabled: true,
        default_method: 'manual_upi',
      };
    }
    if (mode === 'razorpay_only') {
      return {
        ...form,
        payment_mode: 'razorpay_only',
        razorpay_enabled: true,
        manual_upi_enabled: false,
        default_method: 'razorpay',
      };
    }
    return {
      ...form,
      payment_mode: 'dual',
      razorpay_enabled: true,
      manual_upi_enabled: true,
    };
  };

  const handleQuickToggleRazorpay = async () => {
    setIsTogglingMaster(true);
    const nextConfig: PaymentConfig = isRazorpayLive
      ? {
          ...form,
          payment_mode: 'manual_only',
          razorpay_enabled: false,
          manual_upi_enabled: true,
          default_method: 'manual_upi',
        }
      : {
          ...form,
          payment_mode: 'dual',
          razorpay_enabled: true,
          manual_upi_enabled: true,
          default_method: 'razorpay',
        };
    setForm(nextConfig);
    await onSavePlatformSetting(
      'payment_config',
      nextConfig,
      isRazorpayLive
        ? 'Switched immediately to Full Manual UPI Mode (Razorpay disabled).'
        : 'Activated Razorpay Online Payments (Dual Mode: Razorpay + Manual UPI).'
    );
    setIsTogglingMaster(false);
  };

  const handleSelectModeInstant = async (mode: PaymentGatewayMode) => {
    const nextConfig = applyModeSelection(mode);
    setForm(nextConfig);
    setIsTogglingMaster(true);
    await onSavePlatformSetting(
      'payment_config',
      nextConfig,
      `Payment mode updated to "${mode.replace(/_/g, ' ')}".`
    );
    setIsTogglingMaster(false);
  };

  const handleSaveAll = async (e: React.FormEvent) => {
    e.preventDefault();
    setIsSaving(true);
    const normalized = normalizePaymentConfig(form);
    setForm(normalized);
    await onSavePlatformSetting(
      'payment_config',
      normalized,
      'Payment gateway, UPI, fees, and settlement config saved.'
    );
    setIsSaving(false);
  };

  return (
    <form onSubmit={handleSaveAll} className="space-y-4">
      {/* 1-Click Master Kill Switch Banner */}
      <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3.5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="space-y-0.5 min-w-0">
            <div className="flex items-center gap-2">
              <span
                className={`inline-flex h-2.5 w-2.5 rounded-full ${
                  isRazorpayLive ? 'bg-emerald-500' : 'bg-amber-500'
                }`}
              />
              <h3 className="text-sm font-bold text-[var(--ps-text)]">
                Payment Gateway Master Switch
              </h3>
            </div>
            <p className="text-[11px] text-[var(--ps-text-muted)]">
              {isRazorpayLive
                ? 'Razorpay online payments are LIVE alongside your selected mode.'
                : 'Currently in Full Manual Mode — Razorpay is completely hidden at checkout & blocked server-side.'}
            </p>
          </div>

          <button
            type="button"
            onClick={() => void handleQuickToggleRazorpay()}
            disabled={isTogglingMaster || isSaving}
            data-testid="master-razorpay-quick-toggle"
            className={`h-9 px-4 rounded-xl text-xs font-bold inline-flex items-center justify-center gap-2 shrink-0 transition-opacity disabled:opacity-60 shadow-xs ${
              isRazorpayLive
                ? 'bg-amber-600 text-white hover:bg-amber-700'
                : 'bg-emerald-600 text-white hover:bg-emerald-700'
            }`}
          >
            {isTogglingMaster ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Power className="w-3.5 h-3.5" />
            )}
            <span>
              {isRazorpayLive
                ? 'Switch to Full Manual Mode'
                : 'Activate Razorpay Online Payments'}
            </span>
          </button>
        </div>

        {/* 3-Mode Segmented Selector */}
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {MODE_CARDS.map((item) => {
            const Icon = item.icon;
            const active = form.payment_mode === item.mode;
            return (
              <button
                key={item.mode}
                type="button"
                disabled={isTogglingMaster || isSaving}
                onClick={() => void handleSelectModeInstant(item.mode)}
                data-testid={`payment-mode-${item.mode}`}
                className={`p-3 rounded-xl border text-left transition-all ${
                  active
                    ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)]/10 ring-1 ring-[var(--ps-accent)]/30'
                    : 'border-[var(--ps-border)] bg-[var(--ps-bg)] hover:bg-[var(--ps-surface-alt)]'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[var(--ps-text)]">
                    <Icon
                      className={`w-3.5 h-3.5 ${
                        active
                          ? 'text-[var(--ps-accent)]'
                          : 'text-[var(--ps-text-muted)]'
                      }`}
                    />
                    {item.label}
                  </span>
                  {active && (
                    <CheckCircle2 className="w-3.5 h-3.5 text-[var(--ps-accent)] shrink-0" />
                  )}
                </div>
                <p className="mt-1 text-[11px] text-[var(--ps-text-muted)] leading-snug">
                  {item.desc}
                </p>
              </button>
            );
          })}
        </div>

        {/* Server Secret Health Badge */}
        <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2.5 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-2 text-[11px]">
            <span className="inline-flex items-center gap-1 font-bold text-[var(--ps-text)]">
              <KeyRound className="w-3.5 h-3.5 text-[var(--ps-accent)]" />
              Server Secret Health:
            </span>
            {envLoading ? (
              <span className="inline-flex items-center gap-1 text-[var(--ps-text-muted)]">
                <Loader2 className="w-3 h-3 animate-spin" />
                Checking env…
              </span>
            ) : envError ? (
              <span className="text-amber-600 dark:text-amber-400">
                {envError}
              </span>
            ) : envStatus ? (
              <>
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border font-mono text-[10px] font-bold ${
                    envStatus.hasKeySecret
                      ? 'border-emerald-500/35 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                      : 'border-amber-500/35 bg-amber-500/12 text-amber-700 dark:text-amber-300'
                  }`}
                >
                  {envStatus.hasKeySecret ? (
                    <CheckCircle2 className="w-3 h-3" />
                  ) : (
                    <AlertCircle className="w-3 h-3" />
                  )}
                  RAZORPAY_KEY_SECRET:{' '}
                  {envStatus.hasKeySecret ? 'Configured' : 'Missing'}
                </span>
                <span
                  className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-md border font-mono text-[10px] font-bold ${
                    envStatus.hasWebhookSecret
                      ? 'border-emerald-500/35 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                      : 'border-amber-500/35 bg-amber-500/12 text-amber-700 dark:text-amber-300'
                  }`}
                >
                  {envStatus.hasWebhookSecret ? (
                    <CheckCircle2 className="w-3 h-3" />
                  ) : (
                    <AlertCircle className="w-3 h-3" />
                  )}
                  RAZORPAY_WEBHOOK_SECRET:{' '}
                  {envStatus.hasWebhookSecret ? 'Configured' : 'Missing'}
                </span>
              </>
            ) : null}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[var(--ps-text-muted)]">
              Secrets stay safely in server `.env` (never stored in DB).
            </span>
            <button
              type="button"
              onClick={() => void loadEnvStatus()}
              aria-label="Recheck server secrets"
              className="h-7 w-7 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] inline-flex items-center justify-center text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]"
            >
              <RefreshCw className="w-3 h-3" />
            </button>
          </div>
        </div>
      </section>

      {/* Gateway Credentials & UPI Settings */}
      <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3">
        <div className="flex items-center gap-1.5">
          <ShieldCheck className="w-4 h-4 text-[var(--ps-accent)]" />
          <h3 className="text-sm font-bold text-[var(--ps-text)]">
            Gateway Credentials, UPI &amp; Settlement Rules
          </h3>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div>
            <label className="block text-[11px] font-semibold text-[var(--ps-text-muted)] mb-1">
              Razorpay Public Key ID
            </label>
            <input
              type="text"
              value={form.razorpay_key_id}
              onChange={(e) =>
                setForm((p) => ({ ...p, razorpay_key_id: e.target.value }))
              }
              placeholder="rzp_live_... or rzp_test_..."
              className="w-full h-9 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs font-mono text-[var(--ps-text)]"
            />
          </div>

          <div>
            <CustomSelectModal
              id="master-default-checkout-tab"
              label="Default Checkout Tab"
              value={form.default_method}
              onChange={(val) =>
                setForm((p) => ({
                  ...p,
                  default_method: val as PaymentDefaultMethod,
                }))
              }
              options={[
                {
                  value: 'manual_upi',
                  label: 'Manual UPI (Default)',
                  description: 'Opens Manual UPI QR + UTR tab first',
                },
                {
                  value: 'razorpay',
                  label: 'Razorpay Instant (Default)',
                  description: 'Opens Instant Online Payment tab first',
                },
              ]}
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[var(--ps-text-muted)] mb-1">
              Manual UPI ID
            </label>
            <input
              type="text"
              value={form.upi_id}
              onChange={(e) =>
                setForm((p) => ({ ...p, upi_id: e.target.value }))
              }
              placeholder="ddoodle.escrow@upi"
              className="w-full h-9 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs font-mono text-[var(--ps-text)]"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[var(--ps-text-muted)] mb-1">
              UPI Payee Name
            </label>
            <input
              type="text"
              value={form.upi_payee_name}
              onChange={(e) =>
                setForm((p) => ({ ...p, upi_payee_name: e.target.value }))
              }
              placeholder="DD oodle"
              className="w-full h-9 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs text-[var(--ps-text)]"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[var(--ps-text-muted)] mb-1">
              Online Convenience Fee (%)
            </label>
            <input
              type="number"
              min={0}
              max={15}
              step="0.1"
              value={form.online_convenience_fee_pct}
              onChange={(e) =>
                setForm((p) => ({
                  ...p,
                  online_convenience_fee_pct: Number(e.target.value) || 0,
                }))
              }
              className="w-full h-9 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs tabular-nums text-[var(--ps-text)]"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[var(--ps-text-muted)] mb-1">
              Pick N Drop Commission (%)
            </label>
            <input
              type="number"
              min={0}
              max={50}
              step="0.5"
              value={form.pick_n_drop_commission_pct}
              onChange={(e) =>
                setForm((p) => ({
                  ...p,
                  pick_n_drop_commission_pct: Number(e.target.value) || 0,
                }))
              }
              className="w-full h-9 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs tabular-nums text-[var(--ps-text)]"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[var(--ps-text-muted)] mb-1">
              Vehicle Booking Commission (%)
            </label>
            <input
              type="number"
              min={0}
              max={50}
              step="0.5"
              value={form.vehicle_booking_commission_pct}
              onChange={(e) =>
                setForm((p) => ({
                  ...p,
                  vehicle_booking_commission_pct: Number(e.target.value) || 0,
                }))
              }
              className="w-full h-9 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs tabular-nums text-[var(--ps-text)]"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[var(--ps-text-muted)] mb-1">
              Default Booking Advance (%)
            </label>
            <input
              type="number"
              min={0}
              max={100}
              step="1"
              value={form.default_advance_pct}
              onChange={(e) =>
                setForm((p) => ({
                  ...p,
                  default_advance_pct: Number(e.target.value) || 0,
                }))
              }
              className="w-full h-9 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs tabular-nums text-[var(--ps-text)]"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[var(--ps-text-muted)] mb-1">
              Booking Soft-Hold Minutes
            </label>
            <input
              type="number"
              min={5}
              max={120}
              step="1"
              value={form.soft_hold_minutes}
              onChange={(e) =>
                setForm((p) => ({
                  ...p,
                  soft_hold_minutes: Number(e.target.value) || 20,
                }))
              }
              className="w-full h-9 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs tabular-nums text-[var(--ps-text)]"
            />
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[var(--ps-text-muted)] mb-1">
              POD Auto-Purge Hours
            </label>
            <input
              type="number"
              min={1}
              max={720}
              step="1"
              value={form.pod_purge_hours}
              onChange={(e) =>
                setForm((p) => ({
                  ...p,
                  pod_purge_hours: Number(e.target.value) || 48,
                }))
              }
              className="w-full h-9 px-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs tabular-nums text-[var(--ps-text)]"
            />
          </div>
        </div>

        <div className="flex justify-end pt-2 border-t border-[var(--ps-border)]">
          <button
            type="submit"
            disabled={isSaving || isTogglingMaster}
            data-testid="save-payment-config-btn"
            className="h-9 px-4 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-bold inline-flex items-center gap-1.5 hover:opacity-95 disabled:opacity-60"
          >
            {isSaving ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Save className="w-3.5 h-3.5" />
            )}
            <span>Save Payment Settings</span>
          </button>
        </div>
      </section>
    </form>
  );
}
