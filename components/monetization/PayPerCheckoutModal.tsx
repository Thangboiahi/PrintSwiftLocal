'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  IndianRupee,
  Landmark,
  Layers,
  ShieldCheck,
  Sparkles,
  Wallet,
} from 'lucide-react';
import { FormModal } from '@/components/ui/FormModal';
import { useAppConfig } from '@/components/providers/AppConfigProvider';
import {
  calculateClientPayPerQuote,
  convertAreaToSqft,
  DEFAULT_PAY_PER_CONFIGS,
  fetchPayPerPricingConfig,
  formatAreaEquivalentHint,
  PAY_PER_AREA_UNIT_LABELS,
  PAY_PER_MODULE_LABELS,
  type PayPerAreaUnit,
  type PayPerModuleKey,
  type PayPerPricingConfig,
  type PayPerQuoteBreakdown,
  type PayPerTargetTable,
} from '@/lib/monetization/pay-per';
import {
  fetchPaymentPolicyForScope,
  type PaymentFeaturePolicyRow,
} from '@/lib/payments/resolver';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';

// v21a (P0-09): the platform VPA comes from Superadmin `payment_config` (no hardcoded handle).
const FALLBACK_PLATFORM_UPI_VPA = 'ddoodle.escrow@upi';
const PLATFORM_PAYEE_NAME = 'Churachandpur District Portal';

export interface PayPerCheckoutSuccessPayload {
  orderId: string;
  moduleKey: PayPerModuleKey;
  targetTable: PayPerTargetTable;
  targetId: string;
  durationDays: number;
  amountInr: number;
  paymentMethod: 'upi' | 'manual';
  upiUtrRef: string | null;
  status: string;
  quoteBreakdown: PayPerQuoteBreakdown;
}

export interface PayPerCheckoutModalProps {
  open: boolean;
  onClose: () => void;
  moduleKey: PayPerModuleKey;
  targetTable: PayPerTargetTable;
  targetId: string;
  targetTitle?: string;
  initialDurationDays?: number;
  initialPropertyPriceInr?: number | null;
  initialAreaValue?: number | null;
  initialAreaUnit?: PayPerAreaUnit;
  initialAddonIds?: string[];
  onSuccess?: (payload: PayPerCheckoutSuccessPayload) => void;
}

function getPolicyScopeForModule(moduleKey: PayPerModuleKey): string {
  if (moduleKey === 'marketplace_item') return 'marketplace';
  if (moduleKey === 'bulletin_post') return 'bulletin';
  return 'real_estate';
}

export function PayPerCheckoutModal({
  open,
  onClose,
  moduleKey,
  targetTable,
  targetId,
  targetTitle,
  initialDurationDays,
  initialPropertyPriceInr,
  initialAreaValue,
  initialAreaUnit = 'sqft',
  initialAddonIds = [],
  onSuccess,
}: PayPerCheckoutModalProps) {
  const { paymentConfig } = useAppConfig();
  const platformUpiVpa =
    paymentConfig?.upi_id?.trim() || FALLBACK_PLATFORM_UPI_VPA;
  const initialAddonIdsKey = initialAddonIds.join('|');
  const [config, setConfig] = useState<PayPerPricingConfig>(
    () => DEFAULT_PAY_PER_CONFIGS[moduleKey]
  );
  const [policy, setPolicy] = useState<PaymentFeaturePolicyRow | null>(null);
  const [isLoadingConfig, setIsLoadingConfig] = useState<boolean>(true);

  const [durationDays, setDurationDays] = useState<number>(
    initialDurationDays ||
      DEFAULT_PAY_PER_CONFIGS[moduleKey].duration_slabs[0]?.days ||
      15
  );
  const [selectedAddonIds, setSelectedAddonIds] =
    useState<string[]>(initialAddonIds);

  // Real Estate dynamic pricing inputs
  const [propertyPriceInput, setPropertyPriceInput] = useState<string>(
    initialPropertyPriceInr && initialPropertyPriceInr > 0
      ? String(Math.round(initialPropertyPriceInr))
      : ''
  );
  const [areaValueInput, setAreaValueInput] = useState<string>(
    initialAreaValue && initialAreaValue > 0 ? String(initialAreaValue) : ''
  );
  const [areaUnit, setAreaUnit] = useState<PayPerAreaUnit>(initialAreaUnit);

  const [paymentMethod, setPaymentMethod] = useState<'upi' | 'manual'>('upi');
  const [upiUtrRef, setUpiUtrRef] = useState<string>('');
  const [copiedUpi, setCopiedUpi] = useState<boolean>(false);

  // Field-on-input / Form-on-submit validation state
  const [touchedFields, setTouchedFields] = useState<Record<string, boolean>>(
    {}
  );
  const [submitAttempted, setSubmitAttempted] = useState<boolean>(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  const isRealEstate =
    moduleKey === 'real_estate_sale' || moduleKey === 'real_estate_rent';

  useEffect(() => {
    if (!open) return;

    let cancelled = false;

    async function load() {
      setIsLoadingConfig(true);
      setSubmitError(null);
      setSubmitAttempted(false);
      setTouchedFields({});
      // v21a (P0-09): never carry a previous checkout's UTR / add-ons into a new one
      setUpiUtrRef('');
      setCopiedUpi(false);
      setSelectedAddonIds(initialAddonIdsKey ? initialAddonIdsKey.split('|') : []);

      const [loadedConfig, loadedPolicy] = await Promise.all([
        fetchPayPerPricingConfig(moduleKey),
        fetchPaymentPolicyForScope(getPolicyScopeForModule(moduleKey)),
      ]);
      if (cancelled) return;

      setConfig(loadedConfig);
      setPolicy(loadedPolicy);

      const popularSlab =
        loadedConfig.duration_slabs.find((s) => s.is_popular) ||
        loadedConfig.duration_slabs[0];
      setDurationDays(initialDurationDays || popularSlab?.days || 15);

      if (loadedPolicy.upi_enabled) {
        setPaymentMethod('upi');
      } else if (loadedPolicy.manual_enabled) {
        setPaymentMethod('manual');
      }
      setIsLoadingConfig(false);
    }

    queueMicrotask(() => {
      if (!cancelled) void load();
    });
    return () => {
      cancelled = true;
    };
  }, [open, moduleKey, initialDurationDays, initialAddonIdsKey]);

  useEffect(() => {
    if (!open) return;
    queueMicrotask(() => {
      if (initialPropertyPriceInr && initialPropertyPriceInr > 0) {
        setPropertyPriceInput(String(Math.round(initialPropertyPriceInr)));
      }
      if (initialAreaValue && initialAreaValue > 0) {
        setAreaValueInput(String(initialAreaValue));
      }
      if (initialAreaUnit) {
        setAreaUnit(initialAreaUnit);
      }
    });
  }, [open, initialPropertyPriceInr, initialAreaValue, initialAreaUnit]);

  const numericPropertyPrice = useMemo(() => {
    const parsed = Number(propertyPriceInput);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }, [propertyPriceInput]);

  const numericAreaValue = useMemo(() => {
    const parsed = Number(areaValueInput);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }, [areaValueInput]);

  const normalizedSqft = useMemo(
    () => convertAreaToSqft(numericAreaValue, areaUnit),
    [numericAreaValue, areaUnit]
  );

  const quote = useMemo(() => {
    return calculateClientPayPerQuote(config, {
      durationDays,
      propertyPriceInr: numericPropertyPrice,
      areaValue: numericAreaValue,
      areaUnit,
      addonIds: selectedAddonIds,
    });
  }, [
    config,
    durationDays,
    numericPropertyPrice,
    numericAreaValue,
    areaUnit,
    selectedAddonIds,
  ]);

  const upiAllowed = policy ? policy.upi_enabled : true;
  const manualAllowed = policy ? policy.manual_enabled : true;

  // Field level validation rules
  const fieldErrors = useMemo(() => {
    const errors: Record<string, string> = {};
    if (!config.is_enabled) {
      errors.module =
        'Pay-Per publishing is currently disabled by Superadmin for this module.';
    }
    if (!upiAllowed && !manualAllowed) {
      errors.policy =
        'Both UPI and manual payment methods are currently disabled by system policy.';
    }
    if (isRealEstate) {
      if (numericPropertyPrice <= 0) {
        errors.propertyPrice =
          moduleKey === 'real_estate_rent'
            ? 'Enter the monthly rental price in ₹ to compute the Real Estate band fee.'
            : 'Enter the expected sale price in ₹ to compute the Real Estate band fee.';
      }
      if (numericAreaValue <= 0) {
        errors.areaValue =
          'Enter the plot or floor area (sq.ft, m², Sangam, or Acre) to compute the area band fee.';
      }
    }

    if (paymentMethod === 'upi') {
      const normalizedUtr = upiUtrRef.trim().toUpperCase();
      if (!normalizedUtr) {
        errors.upiUtrRef =
          'UPI UTR / Reference number is required for verification.';
      } else if (!/^[A-Z0-9]{8,32}$/.test(normalizedUtr)) {
        errors.upiUtrRef =
          'UTR must be 8–32 alphanumeric characters (no spaces or special symbols).';
      }
    }
    return errors;
  }, [
    config.is_enabled,
    upiAllowed,
    manualAllowed,
    isRealEstate,
    moduleKey,
    numericPropertyPrice,
    numericAreaValue,
    paymentMethod,
    upiUtrRef,
  ]);

  const validationMessages = useMemo(
    () => Object.values(fieldErrors),
    [fieldErrors]
  );
  const isValid = validationMessages.length === 0;
  const isDirty = Boolean(
    upiUtrRef.trim().length > 0 || selectedAddonIds.length > 0
  );

  const showFieldError = useCallback(
    (field: string) =>
      Boolean((touchedFields[field] || submitAttempted) && fieldErrors[field]),
    [touchedFields, submitAttempted, fieldErrors]
  );

  const toggleAddon = (addonId: string) => {
    setSelectedAddonIds((prev) =>
      prev.includes(addonId)
        ? prev.filter((id) => id !== addonId)
        : [...prev, addonId]
    );
  };

  const handleCopyUpi = async () => {
    try {
      await navigator.clipboard.writeText(platformUpiVpa);
      setCopiedUpi(true);
      setTimeout(() => setCopiedUpi(false), 2000);
    } catch {
      // clipboard fallback
    }
  };

  const executeOrderSubmit = async () => {
    setIsSubmitting(true);
    setSubmitError(null);

    try {
      const normalizedUtr =
        paymentMethod === 'upi' ? upiUtrRef.trim().toUpperCase() : null;

      if (isSupabaseConfigured()) {
        const { data, error } = await supabase.rpc('submit_pay_per_order', {
          p_module_key: moduleKey,
          p_target_table: targetTable,
          p_target_id: targetId,
          p_duration_days: quote.duration_days,
          p_payment_method: paymentMethod,
          p_upi_utr_ref: normalizedUtr,
          p_property_price_inr: isRealEstate ? numericPropertyPrice : null,
          p_area_value: isRealEstate ? numericAreaValue : null,
          p_area_unit: isRealEstate ? areaUnit : 'sqft',
          p_addon_ids: selectedAddonIds,
        });

        if (error) {
          const msg = error.message || '';
          const isMissingRpc =
            msg.includes('submit_pay_per_order') ||
            msg.includes('Could not find the function');

          if (!isMissingRpc) {
            throw new Error(msg);
          }

          const { data: authData } = await supabase.auth.getUser();
          const uid = authData.user?.id;
          if (!uid) {
            throw new Error('Authentication required to submit Pay-Per order.');
          }

          const { data: insertedRow, error: insertError } = await supabase
            .from('pay_per_orders')
            .insert({
              user_id: uid,
              module_key: moduleKey,
              target_table: targetTable,
              target_id: targetId,
              duration_days: quote.duration_days,
              quote_breakdown: quote,
              amount_inr: quote.total_inr,
              payment_method: paymentMethod,
              upi_utr_ref: normalizedUtr,
              status: 'pending_verification',
            })
            .select('id')
            .single();

          if (insertError) {
            throw new Error(insertError.message);
          }

          const payload: PayPerCheckoutSuccessPayload = {
            orderId: String(
              (insertedRow as { id?: string })?.id || crypto.randomUUID()
            ),
            moduleKey,
            targetTable,
            targetId,
            durationDays: quote.duration_days,
            amountInr: quote.total_inr,
            paymentMethod,
            upiUtrRef: normalizedUtr,
            status: 'pending_verification',
            quoteBreakdown: quote,
          };

          onSuccess?.(payload);
          onClose();
          return;
        }

        const resObj = (data || {}) as Record<string, unknown>;
        const payload: PayPerCheckoutSuccessPayload = {
          orderId: String(resObj.order_id || crypto.randomUUID()),
          moduleKey,
          targetTable,
          targetId,
          durationDays: Number(resObj.duration_days) || quote.duration_days,
          amountInr: Number(resObj.amount_inr) || quote.total_inr,
          paymentMethod,
          upiUtrRef: normalizedUtr,
          status: String(resObj.status || 'pending_verification'),
          quoteBreakdown: quote,
        };

        onSuccess?.(payload);
        onClose();
      } else {
        const payload: PayPerCheckoutSuccessPayload = {
          orderId: crypto.randomUUID(),
          moduleKey,
          targetTable,
          targetId,
          durationDays: quote.duration_days,
          amountInr: quote.total_inr,
          paymentMethod,
          upiUtrRef: normalizedUtr,
          status: 'pending_verification',
          quoteBreakdown: quote,
        };
        onSuccess?.(payload);
        onClose();
      }
    } catch (err) {
      setSubmitError(
        err instanceof Error
          ? err.message
          : 'Unable to submit Pay-Per order. Please check your UTR reference and try again.'
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <FormModal
      isOpen={open}
      onClose={onClose}
      title={`Pay-Per Publish — ${PAY_PER_MODULE_LABELS[moduleKey]}`}
      subtitle={
        targetTitle
          ? `Item: "${targetTitle}" · Instant transparent quote with Superadmin activation`
          : 'Choose duration slab, optional add-ons, and submit payment proof for verification.'
      }
      isDirty={isDirty}
      isValid={isValid}
      validationSummary={validationMessages}
      onSubmitAttempt={() => setSubmitAttempted(true)}
      confirmSubmitTitle="Confirm Pay-Per Order Submission"
      confirmSubmitDescription={`Submit ₹${quote.total_inr.toLocaleString('en-IN')} Pay-Per order (${quote.duration_days} days) via ${
        paymentMethod === 'upi'
          ? `UPI (UTR: ${upiUtrRef.trim().toUpperCase()})`
          : 'Manual / Counter Verification'
      }? Your item will activate automatically once verified by Superadmin.`}
      confirmSubmitVariant="info"
      maxWidthClassName="max-w-2xl"
      onSubmit={executeOrderSubmit}
      isSubmitting={isSubmitting}
      submitLabel={`Pay & Submit (₹${quote.total_inr.toLocaleString('en-IN')})`}
    >
      {isLoadingConfig ? (
        <div className="space-y-3 py-4">
          <div className="dd-shimmer h-20 w-full rounded-xl" />
          <div className="dd-shimmer h-32 w-full rounded-xl" />
          <div className="dd-shimmer h-28 w-full rounded-xl" />
        </div>
      ) : (
        <div className="space-y-5">
          {submitError ? (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-xs font-medium text-rose-500"
            >
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
              <span>{submitError}</span>
            </div>
          ) : null}

          {/* 1. Duration Slabs */}
          <div className="space-y-2">
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--ps-text-secondary)]">
              1. Select Publishing Duration
            </label>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
              {config.duration_slabs.map((slab) => {
                const isSelected = quote.duration_days === slab.days;
                return (
                  <button
                    key={slab.id}
                    type="button"
                    onClick={() => setDurationDays(slab.days)}
                    className={`relative flex min-h-[68px] flex-col justify-between rounded-xl border p-3 text-left transition-all cursor-pointer ${
                      isSelected
                        ? 'border-[var(--ps-accent)] bg-[var(--ps-accent-soft)] text-[var(--ps-text-primary)] shadow-xs'
                        : 'border-[var(--ps-border)] bg-[var(--ps-surface-alt)] text-[var(--ps-text-secondary)] hover:border-[var(--ps-border-strong)]'
                    }`}
                  >
                    {slab.is_popular ? (
                      <span className="inline-flex w-fit items-center gap-1 rounded-md bg-[var(--ps-accent)] px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-white">
                        Popular
                      </span>
                    ) : (
                      <span className="text-[11px] font-semibold text-[var(--ps-text-muted)]">
                        {slab.days} Days
                      </span>
                    )}
                    <div className="mt-1">
                      <div className="text-xs font-bold text-[var(--ps-text-primary)]">
                        {slab.label}
                      </div>
                      <div className="text-sm font-extrabold text-[var(--ps-accent)]">
                        ₹{slab.price_inr.toLocaleString('en-IN')}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Real Estate Price & Area Inputs (Only for real_estate_sale / real_estate_rent) */}
          {isRealEstate ? (
            <div className="space-y-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] p-4">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-[var(--ps-text-primary)]">
                  <Landmark className="h-4 w-4 text-[var(--ps-accent)]" />
                  <span>
                    2. Property Value &amp; Land Area Band Calculation
                  </span>
                </div>
                <span className="rounded-md border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2 py-0.5 text-[11px] font-semibold text-[var(--ps-text-secondary)]">
                  {moduleKey === 'real_estate_rent'
                    ? 'For Rent / Lease'
                    : 'For Sale'}
                </span>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <div>
                  <label className="mb-1 block text-xs font-semibold text-[var(--ps-text-secondary)]">
                    {moduleKey === 'real_estate_rent'
                      ? 'Monthly Rent (₹) *'
                      : 'Property Sale Price (₹) *'}
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="1"
                    value={propertyPriceInput}
                    onChange={(e) => {
                      setPropertyPriceInput(e.target.value);
                      setTouchedFields((prev) => ({
                        ...prev,
                        propertyPrice: true,
                      }));
                    }}
                    onBlur={() =>
                      setTouchedFields((prev) => ({
                        ...prev,
                        propertyPrice: true,
                      }))
                    }
                    placeholder={
                      moduleKey === 'real_estate_rent' ? '12000' : '2500000'
                    }
                    className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 py-2 text-sm font-semibold text-[var(--ps-text-primary)] focus:border-[var(--ps-accent)] focus:outline-none"
                  />
                  {showFieldError('propertyPrice') ? (
                    <p className="mt-1 text-[11px] font-medium text-rose-500">
                      {fieldErrors.propertyPrice}
                    </p>
                  ) : null}
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-[var(--ps-text-secondary)]">
                    Plot / Floor Area *
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={areaValueInput}
                    onChange={(e) => {
                      setAreaValueInput(e.target.value);
                      setTouchedFields((prev) => ({
                        ...prev,
                        areaValue: true,
                      }));
                    }}
                    onBlur={() =>
                      setTouchedFields((prev) => ({
                        ...prev,
                        areaValue: true,
                      }))
                    }
                    placeholder="2500"
                    className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 py-2 text-sm font-semibold text-[var(--ps-text-primary)] focus:border-[var(--ps-accent)] focus:outline-none"
                  />
                  {showFieldError('areaValue') ? (
                    <p className="mt-1 text-[11px] font-medium text-rose-500">
                      {fieldErrors.areaValue}
                    </p>
                  ) : null}
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-[var(--ps-text-secondary)]">
                    Area Unit
                  </label>
                  <select
                    value={areaUnit}
                    onChange={(e) =>
                      setAreaUnit(e.target.value as PayPerAreaUnit)
                    }
                    className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 py-2 text-xs font-semibold text-[var(--ps-text-primary)] focus:border-[var(--ps-accent)] focus:outline-none"
                  >
                    {(
                      Object.keys(
                        PAY_PER_AREA_UNIT_LABELS
                      ) as PayPerAreaUnit[]
                    ).map((u) => (
                      <option key={u} value={u}>
                        {PAY_PER_AREA_UNIT_LABELS[u]}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 py-2 text-[11px] text-[var(--ps-text-secondary)]">
                <span>
                  Normalized Area:{' '}
                  <strong className="text-[var(--ps-text-primary)]">
                    {formatAreaEquivalentHint(normalizedSqft)}
                  </strong>
                </span>
                <span className="text-[var(--ps-text-muted)]">
                  1 Sangam = 0.625 Acre = 27,225 sq.ft
                </span>
              </div>
            </div>
          ) : null}

          {/* 3. Optional Boost Add-ons */}
          {config.addons.length > 0 ? (
            <div className="space-y-2">
              <label className="block text-xs font-bold uppercase tracking-wider text-[var(--ps-text-secondary)]">
                {isRealEstate
                  ? '3. Optional Visibility Add-ons'
                  : '2. Optional Visibility Add-ons'}
              </label>
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {config.addons.map((addon) => {
                  const checked = selectedAddonIds.includes(addon.id);
                  return (
                    <button
                      key={addon.id}
                      type="button"
                      onClick={() => toggleAddon(addon.id)}
                      className={`flex min-h-[54px] items-center justify-between gap-3 rounded-xl border p-3 text-left transition-all cursor-pointer ${
                        checked
                          ? 'border-[var(--ps-accent)] bg-[var(--ps-accent-soft)]'
                          : 'border-[var(--ps-border)] bg-[var(--ps-surface-alt)] hover:border-[var(--ps-border-strong)]'
                      }`}
                    >
                      <div className="min-w-0">
                        <div className="flex items-center gap-1.5 text-xs font-bold text-[var(--ps-text-primary)]">
                          <Sparkles className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
                          <span>{addon.label}</span>
                        </div>
                        {addon.description ? (
                          <p className="mt-0.5 truncate text-[11px] text-[var(--ps-text-secondary)]">
                            {addon.description}
                          </p>
                        ) : null}
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        <span className="text-xs font-extrabold text-[var(--ps-accent)]">
                          +₹{addon.price_inr.toLocaleString('en-IN')}
                        </span>
                        <span
                          className={`flex h-5 w-5 items-center justify-center rounded-md border ${
                            checked
                              ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)] text-white'
                              : 'border-[var(--ps-border-strong)] bg-[var(--ps-surface)]'
                          }`}
                        >
                          {checked ? <Check className="h-3.5 w-3.5" /> : null}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </div>
          ) : null}

          {/* 4. Itemized Quote Breakdown Card */}
          <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] p-4">
            <div className="mb-2.5 flex items-center justify-between">
              <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[var(--ps-text-primary)]">
                <Layers className="h-4 w-4 text-[var(--ps-accent)]" />
                Itemized Pay-Per Quote Breakdown
              </span>
              <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-[var(--ps-text-secondary)]">
                <Clock className="h-3.5 w-3.5" />
                Valid for {quote.duration_days} Days once approved
              </span>
            </div>

            <div className="space-y-1.5 border-t border-[var(--ps-border)] pt-2.5 text-xs">
              <div className="flex items-center justify-between text-[var(--ps-text-secondary)]">
                <span>Base Duration ({quote.duration_slab_label})</span>
                <span className="font-semibold text-[var(--ps-text-primary)]">
                  ₹{quote.base_slab_inr.toLocaleString('en-IN')}
                </span>
              </div>

              {isRealEstate ? (
                <>
                  <div className="flex items-center justify-between text-[var(--ps-text-secondary)]">
                    <span>
                      Price Band Fee{' '}
                      {quote.price_band_label
                        ? `(${quote.price_band_label})`
                        : '(Enter price)'}
                    </span>
                    <span className="font-semibold text-[var(--ps-text-primary)]">
                      +₹{quote.price_band_inr.toLocaleString('en-IN')}
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-[var(--ps-text-secondary)]">
                    <span>
                      Land Area Band Fee{' '}
                      {quote.area_band_label
                        ? `(${quote.area_band_label})`
                        : '(Enter area)'}
                    </span>
                    <span className="font-semibold text-[var(--ps-text-primary)]">
                      +₹{quote.area_band_inr.toLocaleString('en-IN')}
                    </span>
                  </div>
                </>
              ) : null}

              {quote.selected_addons.map((addon) => (
                <div
                  key={addon.id}
                  className="flex items-center justify-between text-[var(--ps-text-secondary)]"
                >
                  <span>Add-on: {addon.label}</span>
                  <span className="font-semibold text-[var(--ps-text-primary)]">
                    +₹{addon.price_inr.toLocaleString('en-IN')}
                  </span>
                </div>
              ))}

              {quote.total_inr !== quote.raw_subtotal_inr ? (
                <div className="flex items-center justify-between text-[11px] text-[var(--ps-text-muted)]">
                  <span>
                    Subtotal ₹{quote.raw_subtotal_inr.toLocaleString('en-IN')}{' '}
                    (Cap applied: Min ₹{quote.min_cap_inr}
                    {quote.max_cap_inr ? ` / Max ₹${quote.max_cap_inr}` : ''})
                  </span>
                  <span>Adjusted</span>
                </div>
              ) : null}

              <div className="mt-2 flex items-center justify-between border-t border-[var(--ps-border)] pt-2.5 text-sm font-extrabold text-[var(--ps-text-primary)]">
                <span>Total Payable Fee</span>
                <span className="inline-flex items-center text-base text-[var(--ps-accent)]">
                  <IndianRupee className="h-4 w-4" />
                  {quote.total_inr.toLocaleString('en-IN')}
                </span>
              </div>
            </div>
          </div>

          {/* 5. Payment Method & UPI UTR Input */}
          <div className="space-y-3">
            <label className="block text-xs font-bold uppercase tracking-wider text-[var(--ps-text-secondary)]">
              Select Payment Method
            </label>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {upiAllowed ? (
                <button
                  type="button"
                  onClick={() => setPaymentMethod('upi')}
                  className={`flex min-h-[48px] items-center justify-between rounded-xl border px-3.5 py-2.5 text-left transition-all cursor-pointer ${
                    paymentMethod === 'upi'
                      ? 'border-[var(--ps-accent)] bg-[var(--ps-accent-soft)] text-[var(--ps-text-primary)]'
                      : 'border-[var(--ps-border)] bg-[var(--ps-surface-alt)] text-[var(--ps-text-secondary)]'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <Wallet className="h-4 w-4 text-[var(--ps-accent)]" />
                    <div>
                      <div className="text-xs font-bold">
                        Direct UPI Transfer
                      </div>
                      <div className="text-[11px] text-[var(--ps-text-secondary)]">
                        GPay, PhonePe, Paytm · Submit UTR
                      </div>
                    </div>
                  </div>
                  {paymentMethod === 'upi' ? (
                    <CheckCircle2 className="h-4 w-4 text-[var(--ps-accent)]" />
                  ) : null}
                </button>
              ) : null}

              {manualAllowed ? (
                <button
                  type="button"
                  onClick={() => setPaymentMethod('manual')}
                  className={`flex min-h-[48px] items-center justify-between rounded-xl border px-3.5 py-2.5 text-left transition-all cursor-pointer ${
                    paymentMethod === 'manual'
                      ? 'border-[var(--ps-accent)] bg-[var(--ps-accent-soft)] text-[var(--ps-text-primary)]'
                      : 'border-[var(--ps-border)] bg-[var(--ps-surface-alt)] text-[var(--ps-text-secondary)]'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <ShieldCheck className="h-4 w-4 text-[var(--ps-accent)]" />
                    <div>
                      <div className="text-xs font-bold">
                        Office / Counter Desk Payment
                      </div>
                      <div className="text-[11px] text-[var(--ps-text-secondary)]">
                        Pay cash or POS at District Hub Desk
                      </div>
                    </div>
                  </div>
                  {paymentMethod === 'manual' ? (
                    <CheckCircle2 className="h-4 w-4 text-[var(--ps-accent)]" />
                  ) : null}
                </button>
              ) : null}
            </div>

            {paymentMethod === 'upi' && upiAllowed ? (
              <div className="space-y-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] p-3.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <div className="text-[11px] font-semibold uppercase tracking-wider text-[var(--ps-text-muted)]">
                      Official UPI ID ({PLATFORM_PAYEE_NAME})
                    </div>
                    <div className="font-mono text-sm font-bold text-[var(--ps-text-primary)]">
                      {platformUpiVpa}
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={handleCopyUpi}
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 py-1.5 text-xs font-semibold text-[var(--ps-text-primary)] hover:border-[var(--ps-accent)] cursor-pointer"
                  >
                    {copiedUpi ? (
                      <>
                        <Check className="h-3.5 w-3.5 text-emerald-500" />
                        Copied UPI ID
                      </>
                    ) : (
                      <>
                        <Copy className="h-3.5 w-3.5" />
                        Copy UPI ID
                      </>
                    )}
                  </button>
                </div>

                <div>
                  <label className="mb-1 block text-xs font-semibold text-[var(--ps-text-secondary)]">
                    12-Digit UPI UTR / Reference Number *
                  </label>
                  <input
                    type="text"
                    value={upiUtrRef}
                    onChange={(e) => {
                      setUpiUtrRef(e.target.value.toUpperCase());
                      setTouchedFields((prev) => ({
                        ...prev,
                        upiUtrRef: true,
                      }));
                    }}
                    onBlur={() =>
                      setTouchedFields((prev) => ({
                        ...prev,
                        upiUtrRef: true,
                      }))
                    }
                    placeholder="e.g., 432918472910"
                    maxLength={32}
                    className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3.5 py-2 font-mono text-sm font-semibold uppercase text-[var(--ps-text-primary)] focus:border-[var(--ps-accent)] focus:outline-none"
                  />
                  {showFieldError('upiUtrRef') ? (
                    <p className="mt-1 text-[11px] font-medium text-rose-500">
                      {fieldErrors.upiUtrRef}
                    </p>
                  ) : (
                    <p className="mt-1 text-[11px] text-[var(--ps-text-muted)]">
                      Duplicate active UTRs are blocked automatically by the
                      ledger index.
                    </p>
                  )}
                </div>
              </div>
            ) : null}

            {paymentMethod === 'manual' && manualAllowed ? (
              <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] p-3.5 text-xs text-[var(--ps-text-secondary)]">
                Submit this order to reserve your Pay-Per reference ID, then
                settle{' '}
                <strong className="text-[var(--ps-text-primary)]">
                  ₹{quote.total_inr.toLocaleString('en-IN')}
                </strong>{' '}
                at the Churachandpur Hub Verification Desk. Superadmin will
                activate your item for{' '}
                <strong className="text-[var(--ps-text-primary)]">
                  {quote.duration_days} days
                </strong>{' '}
                immediately upon receipt.
              </div>
            ) : null}
          </div>
        </div>
      )}
    </FormModal>
  );
}
