'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Calculator,
  CheckCircle2,
  Clock,
  Edit3,
  FileText,
  IndianRupee,
  Landmark,
  Plus,
  RefreshCw,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Trash2,
  XCircle,
} from 'lucide-react';
import { FormModal } from '@/components/ui/FormModal';
import { useConfirmDialogState } from '@/components/ui/ConfirmDialog';
import {
  calculateClientPayPerQuote,
  DEFAULT_PAY_PER_CONFIGS,
  fetchAllPayPerPricingConfigs,
  formatAreaEquivalentHint,
  PAY_PER_AREA_UNIT_LABELS,
  PAY_PER_MODULE_LABELS,
  toDbAreaBands,
  toDbPriceBands,
  type PayPerAddon,
  type PayPerAreaBandSqft,
  type PayPerAreaUnit,
  type PayPerDurationSlab,
  type PayPerModuleKey,
  type PayPerOrderRow,
  type PayPerOrderStatus,
  type PayPerPriceBand,
  type PayPerPricingConfig,
} from '@/lib/monetization/pay-per';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';

type StudioMainTab =
  | 'marketplace_item'
  | 'bulletin_post'
  | 'real_estate'
  | 'orders_queue';

export interface PayPerMonetizationStudioProps {
  onNotice?: (notice: {
    type: 'success' | 'error' | 'info';
    text: string;
  }) => void;
}

export function PayPerMonetizationStudio({
  onNotice,
}: PayPerMonetizationStudioProps) {
  const [activeTab, setActiveTab] =
    useState<StudioMainTab>('marketplace_item');
  const [realEstateSubKey, setRealEstateSubKey] = useState<
    'real_estate_sale' | 'real_estate_rent'
  >('real_estate_sale');

  const [configs, setConfigs] = useState<
    Record<PayPerModuleKey, PayPerPricingConfig>
  >(() => ({
    marketplace_item: { ...DEFAULT_PAY_PER_CONFIGS.marketplace_item },
    bulletin_post: { ...DEFAULT_PAY_PER_CONFIGS.bulletin_post },
    real_estate_sale: { ...DEFAULT_PAY_PER_CONFIGS.real_estate_sale },
    real_estate_rent: { ...DEFAULT_PAY_PER_CONFIGS.real_estate_rent },
  }));
  const [isLoadingConfigs, setIsLoadingConfigs] = useState<boolean>(true);
  const [isSavingConfig, setIsSavingConfig] = useState<boolean>(false);

  // Orders Queue state
  const [orders, setOrders] = useState<PayPerOrderRow[]>([]);
  const [isLoadingOrders, setIsLoadingOrders] = useState<boolean>(false);
  const [orderStatusFilter, setOrderStatusFilter] = useState<
    PayPerOrderStatus | 'all'
  >('pending_verification');
  const [isReviewingOrder, setIsReviewingOrder] = useState<boolean>(false);

  // Reject Order Modal state
  const [rejectingOrder, setRejectingOrder] = useState<PayPerOrderRow | null>(
    null
  );
  const [rejectionReason, setRejectionReason] = useState<string>('');
  const [rejectionTouched, setRejectionTouched] = useState<boolean>(false);
  const [rejectionSubmitAttempted, setRejectionSubmitAttempted] =
    useState<boolean>(false);

  // Edit Config Modal state
  const [editingModuleKey, setEditingModuleKey] =
    useState<PayPerModuleKey | null>(null);
  const [draftConfig, setDraftConfig] = useState<PayPerPricingConfig | null>(
    null
  );
  const [configTouched, setConfigTouched] = useState<Record<string, boolean>>(
    {}
  );
  const [configSubmitAttempted, setConfigSubmitAttempted] =
    useState<boolean>(false);
  const [configFormError, setConfigFormError] = useState<string | null>(null);

  // Real Estate Live Quote Simulator state
  const [simMode, setSimMode] = useState<
    'real_estate_sale' | 'real_estate_rent'
  >('real_estate_sale');
  const [simDurationDays, setSimDurationDays] = useState<number>(30);
  const [simPriceInr, setSimPriceInr] = useState<string>('2500000');
  const [simAreaValue, setSimAreaValue] = useState<string>('0.5');
  const [simAreaUnit, setSimAreaUnit] = useState<PayPerAreaUnit>('sangam');
  const [simAddonIds, setSimAddonIds] = useState<string[]>([]);

  const { confirm, dialog: confirmDialogNode } = useConfirmDialogState();

  const notify = useCallback(
    (type: 'success' | 'error' | 'info', text: string) => {
      onNotice?.({ type, text });
    },
    [onNotice]
  );

  const loadConfigs = useCallback(async () => {
    setIsLoadingConfigs(true);
    try {
      const loaded = await fetchAllPayPerPricingConfigs();
      setConfigs(loaded);
    } finally {
      setIsLoadingConfigs(false);
    }
  }, []);

  const loadOrders = useCallback(async () => {
    setIsLoadingOrders(true);
    try {
      if (!isSupabaseConfigured()) {
        setOrders([]);
        return;
      }
      const { data, error } = await supabase
        .from('pay_per_orders')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (!error && Array.isArray(data)) {
        setOrders(data as PayPerOrderRow[]);
      }
    } finally {
      setIsLoadingOrders(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void loadConfigs();
      void loadOrders();
    });
  }, [loadConfigs, loadOrders]);

  const currentModuleKey: PayPerModuleKey =
    activeTab === 'marketplace_item'
      ? 'marketplace_item'
      : activeTab === 'bulletin_post'
        ? 'bulletin_post'
        : realEstateSubKey;

  const currentConfig = configs[currentModuleKey];

  // Live Simulator Calculation
  const simConfig = configs[simMode];
  const simQuote = useMemo(() => {
    return calculateClientPayPerQuote(simConfig, {
      durationDays: simDurationDays,
      propertyPriceInr: Number(simPriceInr) || 0,
      areaValue: Number(simAreaValue) || 0,
      areaUnit: simAreaUnit,
      addonIds: simAddonIds,
    });
  }, [
    simConfig,
    simDurationDays,
    simPriceInr,
    simAreaValue,
    simAreaUnit,
    simAddonIds,
  ]);

  const handleToggleModuleEnabled = async (targetKey: PayPerModuleKey) => {
    const targetCfg = configs[targetKey];
    const nextEnabled = !targetCfg.is_enabled;

    const accepted = await confirm({
      title: `${nextEnabled ? 'Enable' : 'Disable'} ${PAY_PER_MODULE_LABELS[targetKey]} Pay-Per?`,
      description: nextEnabled
        ? `Allow owners and advertisers to submit Pay-Per orders for ${PAY_PER_MODULE_LABELS[targetKey]} when outside subscription quota.`
        : `Temporarily pause new Pay-Per order submissions for ${PAY_PER_MODULE_LABELS[targetKey]}. Existing paid orders remain active until expiry.`,
      confirmLabel: nextEnabled ? 'Enable Module' : 'Disable Module',
      variant: nextEnabled ? 'info' : 'warning',
    });

    if (!accepted) return;

    setIsSavingConfig(true);
    try {
      if (isSupabaseConfigured()) {
        const { error } = await supabase
          .from('pay_per_pricing_configs')
          .upsert(
            {
              module_key: targetKey,
              label: targetCfg.label,
              is_enabled: nextEnabled,
              duration_slabs: targetCfg.duration_slabs,
              addons: targetCfg.addons,
              price_bands: toDbPriceBands(targetCfg.price_bands),
              area_bands_sqft: toDbAreaBands(targetCfg.area_bands_sqft),
              min_cap_inr: targetCfg.min_cap_inr,
              max_cap_inr: targetCfg.max_cap_inr,
            },
            { onConflict: 'module_key' }
          );
        if (error) throw new Error(error.message);
      }

      setConfigs((prev) => ({
        ...prev,
        [targetKey]: { ...prev[targetKey], is_enabled: nextEnabled },
      }));
      notify(
        'success',
        `${PAY_PER_MODULE_LABELS[targetKey]} Pay-Per ${nextEnabled ? 'enabled' : 'disabled'}.`
      );
    } catch (err) {
      notify(
        'error',
        err instanceof Error
          ? err.message
          : 'Unable to update Pay-Per module status.'
      );
    } finally {
      setIsSavingConfig(false);
    }
  };

  const openEditConfigModal = (moduleKey: PayPerModuleKey) => {
    const source = configs[moduleKey];
    setEditingModuleKey(moduleKey);
    setDraftConfig({
      ...source,
      duration_slabs: source.duration_slabs.map((s) => ({ ...s })),
      addons: source.addons.map((a) => ({ ...a })),
      price_bands: source.price_bands.map((p) => ({ ...p })),
      area_bands_sqft: source.area_bands_sqft.map((a) => ({ ...a })),
    });
    setConfigTouched({});
    setConfigSubmitAttempted(false);
    setConfigFormError(null);
  };

  const draftValidationErrors = useMemo(() => {
    const errs: Record<string, string> = {};
    if (!draftConfig) return errs;

    if (!draftConfig.label.trim()) {
      errs.label = 'Module display label is required.';
    }
    if (draftConfig.duration_slabs.length === 0) {
      errs.duration_slabs = 'At least one duration slab is required.';
    }
    for (const slab of draftConfig.duration_slabs) {
      if (!slab.label.trim() || slab.days < 1 || slab.price_inr < 0) {
        errs.duration_slabs =
          'Every duration slab must have a label, days >= 1, and price >= ₹0.';
      }
    }
    if (draftConfig.min_cap_inr < 0) {
      errs.min_cap_inr = 'Minimum cap must be ₹0 or higher.';
    }
    if (
      draftConfig.max_cap_inr !== null &&
      draftConfig.max_cap_inr < draftConfig.min_cap_inr
    ) {
      errs.max_cap_inr =
        'Maximum cap must be greater than or equal to the minimum cap.';
    }
    return errs;
  }, [draftConfig]);

  const draftValidationMessages = useMemo(
    () => Object.values(draftValidationErrors),
    [draftValidationErrors]
  );

  const executeSaveDraftConfig = async () => {
    if (!draftConfig || !editingModuleKey) return;
    setIsSavingConfig(true);
    setConfigFormError(null);

    try {
      if (isSupabaseConfigured()) {
        const { error } = await supabase
          .from('pay_per_pricing_configs')
          .upsert(
            {
              module_key: editingModuleKey,
              label: draftConfig.label.trim(),
              is_enabled: draftConfig.is_enabled,
              duration_slabs: draftConfig.duration_slabs,
              addons: draftConfig.addons,
              price_bands: toDbPriceBands(draftConfig.price_bands),
              area_bands_sqft: toDbAreaBands(draftConfig.area_bands_sqft),
              min_cap_inr: draftConfig.min_cap_inr,
              max_cap_inr: draftConfig.max_cap_inr,
            },
            { onConflict: 'module_key' }
          );
        if (error) throw new Error(error.message);
      }

      setConfigs((prev) => ({
        ...prev,
        [editingModuleKey]: { ...draftConfig },
      }));
      setEditingModuleKey(null);
      setDraftConfig(null);
      notify(
        'success',
        `Saved ${PAY_PER_MODULE_LABELS[editingModuleKey]} Pay-Per configuration.`
      );
    } catch (err) {
      setConfigFormError(
        err instanceof Error
          ? err.message
          : 'Failed to save Pay-Per configuration.'
      );
    } finally {
      setIsSavingConfig(false);
    }
  };

  // Order Approval & Rejection Handlers
  const handleApproveOrder = async (order: PayPerOrderRow) => {
    const accepted = await confirm({
      title: 'Approve & Activate Pay-Per Order?',
      description: `Verify ₹${Number(order.amount_inr).toLocaleString('en-IN')} payment (${order.payment_method.toUpperCase()}${
        order.upi_utr_ref ? ` · UTR: ${order.upi_utr_ref}` : ''
      }) and activate target ${order.target_table} record for ${order.duration_days} days?`,
      confirmLabel: 'Approve & Activate',
      variant: 'info',
    });

    if (!accepted) return;

    setIsReviewingOrder(true);
    try {
      if (isSupabaseConfigured()) {
        const { error } = await supabase.rpc('review_pay_per_order', {
          p_order_id: order.id,
          p_decision: 'approve',
          p_notes: null,
        });
        if (error) throw new Error(error.message);
      }

      await loadOrders();
      notify(
        'success',
        `Approved Pay-Per order (${order.duration_days} days active window stamped).`
      );
    } catch (err) {
      notify(
        'error',
        err instanceof Error
          ? err.message
          : 'Failed to approve Pay-Per order.'
      );
    } finally {
      setIsReviewingOrder(false);
    }
  };

  const handleOpenRejectModal = (order: PayPerOrderRow) => {
    setRejectingOrder(order);
    setRejectionReason('');
    setRejectionTouched(false);
    setRejectionSubmitAttempted(false);
  };

  const executeRejectOrder = async () => {
    if (!rejectingOrder) return;
    const trimmed = rejectionReason.trim();
    if (trimmed.length < 4) return;

    setIsReviewingOrder(true);
    try {
      if (isSupabaseConfigured()) {
        const { error } = await supabase.rpc('review_pay_per_order', {
          p_order_id: rejectingOrder.id,
          p_decision: 'reject',
          p_notes: trimmed,
        });
        if (error) throw new Error(error.message);
      }

      await loadOrders();
      setRejectingOrder(null);
      notify(
        'info',
        'Pay-Per order rejected and logged to audit trail.'
      );
    } catch (err) {
      notify(
        'error',
        err instanceof Error ? err.message : 'Failed to reject Pay-Per order.'
      );
    } finally {
      setIsReviewingOrder(false);
    }
  };

  const filteredOrders = useMemo(() => {
    if (orderStatusFilter === 'all') return orders;
    return orders.filter((o) => o.status === orderStatusFilter);
  }, [orders, orderStatusFilter]);

  const pendingOrderCount = useMemo(
    () => orders.filter((o) => o.status === 'pending_verification').length,
    [orders]
  );

  return (
    <div className="space-y-6">
      {/* Studio Header */}
      <div className="flex flex-col justify-between gap-4 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5 sm:flex-row sm:items-center">
        <div>
          <div className="flex items-center gap-2">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-[var(--ps-accent-soft)] text-[var(--ps-accent)]">
              <IndianRupee className="h-4 w-4" />
            </span>
            <h2 className="text-lg font-extrabold tracking-tight text-[var(--ps-text-primary)]">
              Pay-Per Monetization Studio
            </h2>
            <span className="rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-2 py-0.5 text-[11px] font-bold text-[var(--ps-accent)]">
              v17c Engine
            </span>
          </div>
          <p className="mt-1 text-xs text-[var(--ps-text-secondary)]">
            Configure duration slabs, Real Estate property price &amp; Sangam/sq.ft
            land area bands, boost add-ons, and verify UPI UTR orders.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              void loadConfigs();
              void loadOrders();
            }}
            className="inline-flex min-h-[44px] items-center gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-3.5 py-2 text-xs font-semibold text-[var(--ps-text-primary)] hover:border-[var(--ps-border-strong)] cursor-pointer"
          >
            <RefreshCw className="h-3.5 w-3.5" />
            Refresh Rules &amp; Orders
          </button>
        </div>
      </div>

      {/* 4 Main Studio Tabs */}
      <div className="grid grid-cols-2 gap-2.5 lg:grid-cols-4">
        <button
          type="button"
          onClick={() => setActiveTab('marketplace_item')}
          className={`flex min-h-[56px] items-center justify-between rounded-xl border p-3.5 text-left transition-all cursor-pointer ${
            activeTab === 'marketplace_item'
              ? 'border-[var(--ps-accent)] bg-[var(--ps-accent-soft)] text-[var(--ps-text-primary)]'
              : 'border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-secondary)] hover:border-[var(--ps-border-strong)]'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <ShoppingBag className="h-4 w-4 text-[var(--ps-accent)]" />
            <div>
              <div className="text-xs font-bold text-[var(--ps-text-primary)]">
                1. Marketplace Products
              </div>
              <div className="text-[11px] text-[var(--ps-text-secondary)]">
                {configs.marketplace_item.duration_slabs.length} Slabs · Min ₹
                {configs.marketplace_item.min_cap_inr}
              </div>
            </div>
          </div>
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              configs.marketplace_item.is_enabled
                ? 'bg-emerald-500'
                : 'bg-rose-500'
            }`}
          />
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('bulletin_post')}
          className={`flex min-h-[56px] items-center justify-between rounded-xl border p-3.5 text-left transition-all cursor-pointer ${
            activeTab === 'bulletin_post'
              ? 'border-[var(--ps-accent)] bg-[var(--ps-accent-soft)] text-[var(--ps-text-primary)]'
              : 'border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-secondary)] hover:border-[var(--ps-border-strong)]'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <FileText className="h-4 w-4 text-[var(--ps-accent)]" />
            <div>
              <div className="text-xs font-bold text-[var(--ps-text-primary)]">
                2. Bulletin Posts
              </div>
              <div className="text-[11px] text-[var(--ps-text-secondary)]">
                {configs.bulletin_post.duration_slabs.length} Slabs ·{' '}
                {configs.bulletin_post.addons.length} Add-ons
              </div>
            </div>
          </div>
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              configs.bulletin_post.is_enabled
                ? 'bg-emerald-500'
                : 'bg-rose-500'
            }`}
          />
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('real_estate')}
          className={`flex min-h-[56px] items-center justify-between rounded-xl border p-3.5 text-left transition-all cursor-pointer ${
            activeTab === 'real_estate'
              ? 'border-[var(--ps-accent)] bg-[var(--ps-accent-soft)] text-[var(--ps-text-primary)]'
              : 'border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-secondary)] hover:border-[var(--ps-border-strong)]'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <Landmark className="h-4 w-4 text-[var(--ps-accent)]" />
            <div>
              <div className="text-xs font-bold text-[var(--ps-text-primary)]">
                3. Real Estate (Sale &amp; Rent)
              </div>
              <div className="text-[11px] text-[var(--ps-text-secondary)]">
                Price + Sangam Area Bands + Simulator
              </div>
            </div>
          </div>
          <span
            className={`h-2.5 w-2.5 rounded-full ${
              configs.real_estate_sale.is_enabled ||
              configs.real_estate_rent.is_enabled
                ? 'bg-emerald-500'
                : 'bg-rose-500'
            }`}
          />
        </button>

        <button
          type="button"
          onClick={() => setActiveTab('orders_queue')}
          className={`flex min-h-[56px] items-center justify-between rounded-xl border p-3.5 text-left transition-all cursor-pointer ${
            activeTab === 'orders_queue'
              ? 'border-[var(--ps-accent)] bg-[var(--ps-accent-soft)] text-[var(--ps-text-primary)]'
              : 'border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-secondary)] hover:border-[var(--ps-border-strong)]'
          }`}
        >
          <div className="flex items-center gap-2.5">
            <ShieldCheck className="h-4 w-4 text-[var(--ps-accent)]" />
            <div>
              <div className="text-xs font-bold text-[var(--ps-text-primary)]">
                4. Pay-Per Orders Queue
              </div>
              <div className="text-[11px] text-[var(--ps-text-secondary)]">
                UTR Verification &amp; Activation
              </div>
            </div>
          </div>
          <span className="inline-flex min-w-[24px] items-center justify-center rounded-md bg-[var(--ps-accent)] px-1.5 py-0.5 text-[11px] font-bold text-white">
            {pendingOrderCount}
          </span>
        </button>
      </div>

      {/* Views 1, 2, 3: Module Configuration Views */}
      {activeTab !== 'orders_queue' ? (
        <div className="space-y-6">
          {activeTab === 'real_estate' ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3.5">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setRealEstateSubKey('real_estate_sale');
                    setSimMode('real_estate_sale');
                  }}
                  className={`min-h-[44px] rounded-xl px-4 py-2 text-xs font-bold transition-all cursor-pointer ${
                    realEstateSubKey === 'real_estate_sale'
                      ? 'bg-[var(--ps-accent)] text-white'
                      : 'border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] text-[var(--ps-text-secondary)]'
                  }`}
                >
                  For Sale Properties (real_estate_sale)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setRealEstateSubKey('real_estate_rent');
                    setSimMode('real_estate_rent');
                  }}
                  className={`min-h-[44px] rounded-xl px-4 py-2 text-xs font-bold transition-all cursor-pointer ${
                    realEstateSubKey === 'real_estate_rent'
                      ? 'bg-[var(--ps-accent)] text-white'
                      : 'border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] text-[var(--ps-text-secondary)]'
                  }`}
                >
                  For Rent / Lease (real_estate_rent)
                </button>
              </div>
              <span className="text-xs text-[var(--ps-text-secondary)]">
                1 Sangam = 0.625 Acre = 27,225 sq.ft · 1 Acre = 43,560 sq.ft
              </span>
            </div>
          ) : null}

          {isLoadingConfigs ? (
            <div className="space-y-3">
              <div className="dd-shimmer h-36 w-full rounded-2xl" />
              <div className="dd-shimmer h-48 w-full rounded-2xl" />
            </div>
          ) : (
            <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5">
              <div className="flex flex-col justify-between gap-4 border-b border-[var(--ps-border)] pb-4 sm:flex-row sm:items-center">
                <div>
                  <div className="flex items-center gap-2.5">
                    <h3 className="text-base font-bold text-[var(--ps-text-primary)]">
                      {currentConfig.label}
                    </h3>
                    <span
                      className={`rounded-md px-2 py-0.5 text-[11px] font-bold ${
                        currentConfig.is_enabled
                          ? 'bg-emerald-500/15 text-emerald-500'
                          : 'bg-rose-500/15 text-rose-500'
                      }`}
                    >
                      {currentConfig.is_enabled ? 'ENABLED' : 'DISABLED'}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-[var(--ps-text-secondary)]">
                    Module Key: <code className="font-mono">{currentConfig.module_key}</code>{' '}
                    · Min Cap: ₹{currentConfig.min_cap_inr.toLocaleString('en-IN')}{' '}
                    · Max Cap:{' '}
                    {currentConfig.max_cap_inr
                      ? `₹${currentConfig.max_cap_inr.toLocaleString('en-IN')}`
                      : 'Uncapped'}
                  </p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button
                    type="button"
                    onClick={() => void handleToggleModuleEnabled(currentModuleKey)}
                    className="min-h-[44px] rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-3.5 py-2 text-xs font-semibold text-[var(--ps-text-primary)] hover:border-[var(--ps-border-strong)] cursor-pointer"
                  >
                    {currentConfig.is_enabled
                      ? 'Disable Pay-Per'
                      : 'Enable Pay-Per'}
                  </button>
                  <button
                    type="button"
                    onClick={() => openEditConfigModal(currentModuleKey)}
                    className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[var(--ps-accent)] px-4 py-2 text-xs font-bold text-white hover:opacity-95 cursor-pointer"
                  >
                    <Edit3 className="h-3.5 w-3.5" />
                    Configure Slabs, Bands &amp; Add-ons
                  </button>
                </div>
              </div>

              {/* Duration Slabs Grid */}
              <div className="mt-5">
                <h4 className="mb-2.5 text-xs font-bold uppercase tracking-wider text-[var(--ps-text-secondary)]">
                  Duration Slabs ({currentConfig.duration_slabs.length})
                </h4>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {currentConfig.duration_slabs.map((slab) => (
                    <div
                      key={slab.id}
                      className="flex items-center justify-between rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] p-3.5"
                    >
                      <div>
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-[var(--ps-text-primary)]">
                            {slab.label}
                          </span>
                          {slab.is_popular ? (
                            <span className="rounded bg-[var(--ps-accent-soft)] px-1.5 py-0.5 text-[10px] font-bold text-[var(--ps-accent)]">
                              Popular
                            </span>
                          ) : null}
                        </div>
                        <div className="mt-0.5 text-[11px] text-[var(--ps-text-secondary)]">
                          {slab.days} Days Active Window
                        </div>
                      </div>
                      <div className="text-sm font-extrabold text-[var(--ps-accent)]">
                        ₹{slab.price_inr.toLocaleString('en-IN')}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Real Estate Price & Area Bands */}
              {activeTab === 'real_estate' ? (
                <div className="mt-6 grid grid-cols-1 gap-5 lg:grid-cols-2">
                  <div>
                    <h4 className="mb-2.5 text-xs font-bold uppercase tracking-wider text-[var(--ps-text-secondary)]">
                      Property Value Bands ({currentConfig.price_bands.length})
                    </h4>
                    <div className="space-y-2">
                      {currentConfig.price_bands.map((band) => (
                        <div
                          key={band.id}
                          className="flex items-center justify-between rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-3.5 py-2.5 text-xs"
                        >
                          <div>
                            <div className="font-bold text-[var(--ps-text-primary)]">
                              {band.label}
                            </div>
                            <div className="text-[11px] text-[var(--ps-text-secondary)]">
                              ₹{band.min_price_inr.toLocaleString('en-IN')} –{' '}
                              {band.max_price_inr
                                ? `₹${band.max_price_inr.toLocaleString('en-IN')}`
                                : 'No Upper Limit'}
                            </div>
                          </div>
                          <span className="font-extrabold text-[var(--ps-accent)]">
                            +₹{band.fee_inr.toLocaleString('en-IN')}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  <div>
                    <h4 className="mb-2.5 text-xs font-bold uppercase tracking-wider text-[var(--ps-text-secondary)]">
                      Land / Plot Area Bands ({currentConfig.area_bands_sqft.length})
                    </h4>
                    <div className="space-y-2">
                      {currentConfig.area_bands_sqft.map((band) => (
                        <div
                          key={band.id}
                          className="flex items-center justify-between rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-3.5 py-2.5 text-xs"
                        >
                          <div>
                            <div className="font-bold text-[var(--ps-text-primary)]">
                              {band.label}
                            </div>
                            <div className="text-[11px] text-[var(--ps-text-secondary)]">
                              {band.min_sqft.toLocaleString('en-IN')} sq.ft –{' '}
                              {band.max_sqft
                                ? `${band.max_sqft.toLocaleString('en-IN')} sq.ft`
                                : 'No Upper Limit'}
                            </div>
                          </div>
                          <span className="font-extrabold text-[var(--ps-accent)]">
                            +₹{band.fee_inr.toLocaleString('en-IN')}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}

              {/* Add-ons */}
              <div className="mt-6">
                <h4 className="mb-2.5 text-xs font-bold uppercase tracking-wider text-[var(--ps-text-secondary)]">
                  Optional Boost Add-ons ({currentConfig.addons.length})
                </h4>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {currentConfig.addons.map((addon) => (
                    <div
                      key={addon.id}
                      className="flex items-center justify-between rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] p-3.5"
                    >
                      <div>
                        <div className="flex items-center gap-1.5 text-xs font-bold text-[var(--ps-text-primary)]">
                          <Sparkles className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
                          <span>{addon.label}</span>
                        </div>
                        {addon.description ? (
                          <div className="mt-0.5 text-[11px] text-[var(--ps-text-secondary)]">
                            {addon.description}
                          </div>
                        ) : null}
                      </div>
                      <span className="text-sm font-extrabold text-[var(--ps-accent)]">
                        +₹{addon.price_inr.toLocaleString('en-IN')}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* Built-in Live Quote Simulator (Always visible on Real Estate tab) */}
          {activeTab === 'real_estate' ? (
            <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ps-border)] pb-3">
                <div className="flex items-center gap-2">
                  <Calculator className="h-4 w-4 text-[var(--ps-accent)]" />
                  <h3 className="text-sm font-extrabold text-[var(--ps-text-primary)]">
                    Real Estate Live Quote Simulator (Churachandpur Sangam / Acre / sq.ft)
                  </h3>
                </div>
                <span className="text-xs text-[var(--ps-text-secondary)]">
                  Matches <code className="font-mono">public.calculate_pay_per_quote</code> 1:1
                </span>
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
                <div className="space-y-3 lg:col-span-7">
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-[var(--ps-text-secondary)]">
                        Deal Mode
                      </label>
                      <select
                        value={simMode}
                        onChange={(e) => {
                          const mode = e.target.value as
                            | 'real_estate_sale'
                            | 'real_estate_rent';
                          setSimMode(mode);
                          setSimAddonIds([]);
                        }}
                        className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-3 py-2 text-xs font-semibold text-[var(--ps-text-primary)]"
                      >
                        <option value="real_estate_sale">
                          For Sale (real_estate_sale)
                        </option>
                        <option value="real_estate_rent">
                          For Rent / Lease (real_estate_rent)
                        </option>
                      </select>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-[var(--ps-text-secondary)]">
                        Duration Slab
                      </label>
                      <select
                        value={simDurationDays}
                        onChange={(e) =>
                          setSimDurationDays(Number(e.target.value) || 30)
                        }
                        className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-3 py-2 text-xs font-semibold text-[var(--ps-text-primary)]"
                      >
                        {simConfig.duration_slabs.map((slab) => (
                          <option key={slab.id} value={slab.days}>
                            {slab.label} ({slab.days}d — ₹{slab.price_inr})
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <div>
                      <label className="mb-1 block text-xs font-semibold text-[var(--ps-text-secondary)]">
                        {simMode === 'real_estate_rent'
                          ? 'Monthly Rent (₹)'
                          : 'Sale Price (₹)'}
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={simPriceInr}
                        onChange={(e) => setSimPriceInr(e.target.value)}
                        className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-3 py-2 text-sm font-semibold text-[var(--ps-text-primary)]"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-[var(--ps-text-secondary)]">
                        Land / Floor Area
                      </label>
                      <input
                        type="number"
                        min={0}
                        step="0.01"
                        value={simAreaValue}
                        onChange={(e) => setSimAreaValue(e.target.value)}
                        className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-3 py-2 text-sm font-semibold text-[var(--ps-text-primary)]"
                      />
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-[var(--ps-text-secondary)]">
                        Unit
                      </label>
                      <select
                        value={simAreaUnit}
                        onChange={(e) =>
                          setSimAreaUnit(e.target.value as PayPerAreaUnit)
                        }
                        className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-3 py-2 text-xs font-semibold text-[var(--ps-text-primary)]"
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

                  <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-3.5 py-2.5 text-xs text-[var(--ps-text-secondary)]">
                    Normalized Area:{' '}
                    <strong className="text-[var(--ps-text-primary)]">
                      {formatAreaEquivalentHint(simQuote.normalized_area_sqft)}
                    </strong>
                  </div>
                </div>

                {/* Live Quote Breakdown Output */}
                <div className="flex flex-col justify-between rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] p-4 lg:col-span-5">
                  <div className="space-y-2 text-xs">
                    <div className="text-xs font-bold uppercase tracking-wider text-[var(--ps-text-primary)]">
                      Simulated Quote Breakdown
                    </div>
                    <div className="flex justify-between text-[var(--ps-text-secondary)]">
                      <span>Base Slab ({simQuote.duration_slab_label})</span>
                      <span className="font-semibold text-[var(--ps-text-primary)]">
                        ₹{simQuote.base_slab_inr.toLocaleString('en-IN')}
                      </span>
                    </div>
                    <div className="flex justify-between text-[var(--ps-text-secondary)]">
                      <span>
                        Price Band ({simQuote.price_band_label || 'None'})
                      </span>
                      <span className="font-semibold text-[var(--ps-text-primary)]">
                        +₹{simQuote.price_band_inr.toLocaleString('en-IN')}
                      </span>
                    </div>
                    <div className="flex justify-between text-[var(--ps-text-secondary)]">
                      <span>
                        Area Band ({simQuote.area_band_label || 'None'})
                      </span>
                      <span className="font-semibold text-[var(--ps-text-primary)]">
                        +₹{simQuote.area_band_inr.toLocaleString('en-IN')}
                      </span>
                    </div>
                  </div>

                  <div className="mt-4 flex items-center justify-between border-t border-[var(--ps-border)] pt-3">
                    <span className="text-xs font-bold text-[var(--ps-text-primary)]">
                      Final Computed Fee
                    </span>
                    <span className="text-lg font-extrabold text-[var(--ps-accent)]">
                      ₹{simQuote.total_inr.toLocaleString('en-IN')}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      ) : (
        /* View 4: Pending Pay-Per Orders Queue */
        <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5">
          <div className="mb-4 flex flex-col justify-between gap-3 border-b border-[var(--ps-border)] pb-4 sm:flex-row sm:items-center">
            <div>
              <h3 className="text-base font-bold text-[var(--ps-text-primary)]">
                Pay-Per Orders Verification Queue
              </h3>
              <p className="text-xs text-[var(--ps-text-secondary)]">
                Verify UPI UTR references or Hub Desk payments to stamp{' '}
                <code className="font-mono">paid_until</code> and activate target
                records automatically.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: 'pending_verification', label: 'Pending Review' },
                  { id: 'paid', label: 'Approved & Active' },
                  { id: 'rejected', label: 'Rejected' },
                  { id: 'all', label: 'All Orders' },
                ] as const
              ).map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setOrderStatusFilter(tab.id)}
                  className={`min-h-[40px] rounded-xl px-3 py-1.5 text-xs font-bold transition-all cursor-pointer ${
                    orderStatusFilter === tab.id
                      ? 'bg-[var(--ps-accent)] text-white'
                      : 'border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] text-[var(--ps-text-secondary)]'
                  }`}
                >
                  {tab.label}
                </button>
              ))}
            </div>
          </div>

          {isLoadingOrders ? (
            <div className="space-y-2.5">
              <div className="dd-shimmer h-20 w-full rounded-xl" />
              <div className="dd-shimmer h-20 w-full rounded-xl" />
              <div className="dd-shimmer h-20 w-full rounded-xl" />
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-surface-alt)] p-8 text-center">
              <Clock className="mx-auto h-7 w-7 text-[var(--ps-text-muted)]" />
              <div className="mt-2 text-sm font-bold text-[var(--ps-text-primary)]">
                No Pay-Per Orders in This View
              </div>
              <p className="mt-1 text-xs text-[var(--ps-text-secondary)]">
                Submitted Marketplace, Bulletin, and Real Estate Pay-Per orders
                appear here for 1-click UTR approval.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {filteredOrders.map((order) => {
                const qb = (order.quote_breakdown || {}) as Record<
                  string,
                  unknown
                >;
                return (
                  <div
                    key={order.id}
                    className="flex flex-col justify-between gap-4 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] p-4 lg:flex-row lg:items-center"
                  >
                    <div className="space-y-1.5">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-md bg-[var(--ps-accent-soft)] px-2 py-0.5 text-[11px] font-bold text-[var(--ps-accent)]">
                          {PAY_PER_MODULE_LABELS[order.module_key] ||
                            order.module_key}
                        </span>
                        <span className="font-mono text-xs text-[var(--ps-text-secondary)]">
                          Target: {order.target_table} ·{' '}
                          {order.target_id.slice(0, 8)}
                        </span>
                        <span
                          className={`rounded-md px-2 py-0.5 text-[11px] font-bold uppercase ${
                            order.status === 'paid'
                              ? 'bg-emerald-500/15 text-emerald-500'
                              : order.status === 'rejected'
                                ? 'bg-rose-500/15 text-rose-500'
                                : 'bg-amber-500/15 text-amber-500'
                          }`}
                        >
                          {order.status.replace('_', ' ')}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--ps-text-secondary)]">
                        <span className="font-extrabold text-[var(--ps-text-primary)]">
                          ₹{Number(order.amount_inr).toLocaleString('en-IN')}
                        </span>
                        <span>· {order.duration_days} Days Pass</span>
                        <span>
                          · Method:{' '}
                          <strong className="uppercase text-[var(--ps-text-primary)]">
                            {order.payment_method}
                          </strong>
                        </span>
                        {order.upi_utr_ref ? (
                          <span className="rounded border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2 py-0.5 font-mono text-xs font-bold text-[var(--ps-text-primary)]">
                            UTR: {order.upi_utr_ref}
                          </span>
                        ) : null}
                      </div>

                      {qb.price_band_label || qb.area_band_label ? (
                        <div className="text-[11px] text-[var(--ps-text-muted)]">
                          Breakdown: Base ₹{String(qb.base_slab_inr ?? 0)}
                          {qb.price_band_label
                            ? ` + Price Band (${String(qb.price_band_label)}: ₹${String(qb.price_band_inr ?? 0)})`
                            : ''}
                          {qb.area_band_label
                            ? ` + Area Band (${String(qb.area_band_label)}: ₹${String(qb.area_band_inr ?? 0)})`
                            : ''}
                        </div>
                      ) : null}

                      {order.rejection_reason ? (
                        <div className="text-xs font-medium text-rose-500">
                          Rejection Reason: {order.rejection_reason}
                        </div>
                      ) : null}
                    </div>

                    {order.status === 'pending_verification' ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <button
                          type="button"
                          disabled={isReviewingOrder}
                          onClick={() => void handleApproveOrder(order)}
                          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-emerald-600 px-3.5 py-2 text-xs font-bold text-white hover:bg-emerald-500 disabled:opacity-50 cursor-pointer"
                        >
                          <CheckCircle2 className="h-4 w-4" />
                          Approve &amp; Activate
                        </button>
                        <button
                          type="button"
                          disabled={isReviewingOrder}
                          onClick={() => handleOpenRejectModal(order)}
                          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3.5 py-2 text-xs font-bold text-rose-500 hover:bg-rose-500/20 disabled:opacity-50 cursor-pointer"
                        >
                          <XCircle className="h-4 w-4" />
                          Reject
                        </button>
                      </div>
                    ) : (
                      <div className="text-right text-[11px] text-[var(--ps-text-muted)]">
                        {order.ends_at ? (
                          <div>
                            Paid Until:{' '}
                            {new Date(order.ends_at).toLocaleDateString(
                              'en-IN'
                            )}
                          </div>
                        ) : null}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Modal 1: Configure Module Slabs, Bands, Add-ons & Caps */}
      <FormModal
        isOpen={Boolean(editingModuleKey && draftConfig)}
        onClose={() => {
          setEditingModuleKey(null);
          setDraftConfig(null);
        }}
        title={
          editingModuleKey
            ? `Configure Pay-Per Rules — ${PAY_PER_MODULE_LABELS[editingModuleKey]}`
            : 'Configure Pay-Per Rules'
        }
        subtitle="Edit duration slabs, Real Estate value & sq.ft/Sangam area bands, add-ons, and min/max fee caps."
        isDirty={Boolean(Object.keys(configTouched).length > 0)}
        isValid={draftValidationMessages.length === 0}
        validationSummary={draftValidationMessages}
        onSubmitAttempt={() => setConfigSubmitAttempted(true)}
        confirmSubmitTitle={
          editingModuleKey
            ? `Save ${PAY_PER_MODULE_LABELS[editingModuleKey]} Pricing Rules?`
            : 'Save Pricing Rules?'
        }
        confirmSubmitDescription="All pricing changes are logged to audit_logs and take effect immediately for new Pay-Per quotes."
        maxWidthClassName="max-w-3xl"
        onSubmit={executeSaveDraftConfig}
        isSubmitting={isSavingConfig}
        submitLabel="Save Pay-Per Configuration"
      >
        {draftConfig ? (
          <div className="space-y-5">
            {configFormError ? (
              <div
                role="alert"
                className="flex items-start gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs font-medium text-rose-500"
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{configFormError}</span>
              </div>
            ) : null}

            {/* Basic Label & Min/Max Caps */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div>
                <label className="mb-1 block text-xs font-semibold text-[var(--ps-text-secondary)]">
                  Display Label *
                </label>
                <input
                  type="text"
                  value={draftConfig.label}
                  onChange={(e) => {
                    setDraftConfig({ ...draftConfig, label: e.target.value });
                    setConfigTouched((p) => ({ ...p, label: true }));
                  }}
                  className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-3 py-2 text-xs font-semibold text-[var(--ps-text-primary)]"
                />
                {(configTouched.label || configSubmitAttempted) &&
                draftValidationErrors.label ? (
                  <p className="mt-1 text-[11px] text-rose-500">
                    {draftValidationErrors.label}
                  </p>
                ) : null}
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-[var(--ps-text-secondary)]">
                  Minimum Fee Cap (₹) *
                </label>
                <input
                  type="number"
                  min={0}
                  value={draftConfig.min_cap_inr}
                  onChange={(e) => {
                    setDraftConfig({
                      ...draftConfig,
                      min_cap_inr: Math.max(0, Number(e.target.value) || 0),
                    });
                    setConfigTouched((p) => ({ ...p, min_cap_inr: true }));
                  }}
                  className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-3 py-2 text-xs font-semibold text-[var(--ps-text-primary)]"
                />
              </div>

              <div>
                <label className="mb-1 block text-xs font-semibold text-[var(--ps-text-secondary)]">
                  Maximum Fee Cap (₹)
                </label>
                <input
                  type="number"
                  min={0}
                  value={draftConfig.max_cap_inr ?? ''}
                  placeholder="Uncapped"
                  onChange={(e) => {
                    setDraftConfig({
                      ...draftConfig,
                      max_cap_inr:
                        e.target.value === ''
                          ? null
                          : Math.max(0, Number(e.target.value) || 0),
                    });
                    setConfigTouched((p) => ({ ...p, max_cap_inr: true }));
                  }}
                  className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-3 py-2 text-xs font-semibold text-[var(--ps-text-primary)]"
                />
                {draftValidationErrors.max_cap_inr ? (
                  <p className="mt-1 text-[11px] text-rose-500">
                    {draftValidationErrors.max_cap_inr}
                  </p>
                ) : null}
              </div>
            </div>

            {/* Duration Slabs Editor */}
            <div className="space-y-2.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-[var(--ps-text-primary)]">
                  Duration Slabs
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const nextSlab: PayPerDurationSlab = {
                      id: `slab_${Date.now()}`,
                      label: '45 Days Pass',
                      days: 45,
                      price_inr: 149,
                      is_popular: false,
                    };
                    setDraftConfig({
                      ...draftConfig,
                      duration_slabs: [...draftConfig.duration_slabs, nextSlab],
                    });
                    setConfigTouched((p) => ({ ...p, slabs: true }));
                  }}
                  className="inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 py-1 text-xs font-bold text-[var(--ps-text-primary)] cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Slab
                </button>
              </div>

              <div className="space-y-2">
                {draftConfig.duration_slabs.map((slab, idx) => (
                  <div
                    key={slab.id}
                    className="grid grid-cols-1 gap-2 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] p-2.5 sm:grid-cols-12 sm:items-center"
                  >
                    <div className="sm:col-span-4">
                      <input
                        type="text"
                        value={slab.label}
                        onChange={(e) => {
                          const next = [...draftConfig.duration_slabs];
                          next[idx] = { ...slab, label: e.target.value };
                          setDraftConfig({
                            ...draftConfig,
                            duration_slabs: next,
                          });
                          setConfigTouched((p) => ({ ...p, slabs: true }));
                        }}
                        placeholder="Label (e.g. 15 Days Pass)"
                        className="min-h-[40px] w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-2.5 py-1.5 text-xs font-semibold text-[var(--ps-text-primary)]"
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <input
                        type="number"
                        min={1}
                        value={slab.days}
                        onChange={(e) => {
                          const next = [...draftConfig.duration_slabs];
                          next[idx] = {
                            ...slab,
                            days: Math.max(1, Number(e.target.value) || 1),
                          };
                          setDraftConfig({
                            ...draftConfig,
                            duration_slabs: next,
                          });
                          setConfigTouched((p) => ({ ...p, slabs: true }));
                        }}
                        placeholder="Days"
                        className="min-h-[40px] w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-2.5 py-1.5 text-xs font-semibold text-[var(--ps-text-primary)]"
                      />
                    </div>
                    <div className="sm:col-span-3">
                      <input
                        type="number"
                        min={0}
                        value={slab.price_inr}
                        onChange={(e) => {
                          const next = [...draftConfig.duration_slabs];
                          next[idx] = {
                            ...slab,
                            price_inr: Math.max(0, Number(e.target.value) || 0),
                          };
                          setDraftConfig({
                            ...draftConfig,
                            duration_slabs: next,
                          });
                          setConfigTouched((p) => ({ ...p, slabs: true }));
                        }}
                        placeholder="Fee ₹"
                        className="min-h-[40px] w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-2.5 py-1.5 text-xs font-semibold text-[var(--ps-text-primary)]"
                      />
                    </div>
                    <div className="flex items-center justify-end gap-1.5 sm:col-span-2">
                      <button
                        type="button"
                        onClick={() => {
                          const next = draftConfig.duration_slabs.map(
                            (s, i) => ({
                              ...s,
                              is_popular:
                                i === idx ? !s.is_popular : s.is_popular,
                            })
                          );
                          setDraftConfig({
                            ...draftConfig,
                            duration_slabs: next,
                          });
                          setConfigTouched((p) => ({ ...p, slabs: true }));
                        }}
                        className={`min-h-[38px] rounded-lg px-2 py-1 text-[10px] font-bold cursor-pointer ${
                          slab.is_popular
                            ? 'bg-[var(--ps-accent)] text-white'
                            : 'border border-[var(--ps-border)] text-[var(--ps-text-secondary)]'
                        }`}
                      >
                        ★
                      </button>
                      {draftConfig.duration_slabs.length > 1 ? (
                        <button
                          type="button"
                          onClick={() => {
                            const next = draftConfig.duration_slabs.filter(
                              (_, i) => i !== idx
                            );
                            setDraftConfig({
                              ...draftConfig,
                              duration_slabs: next,
                            });
                            setConfigTouched((p) => ({ ...p, slabs: true }));
                          }}
                          className="inline-flex min-h-[38px] items-center justify-center rounded-lg border border-rose-500/30 px-2 text-rose-500 cursor-pointer"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Real Estate Price & Area Bands Editor */}
            {editingModuleKey === 'real_estate_sale' ||
            editingModuleKey === 'real_estate_rent' ? (
              <div className="space-y-4">
                {/* Price Bands */}
                <div className="space-y-2.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] p-4">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-bold uppercase tracking-wider text-[var(--ps-text-primary)]">
                      Property Price Bands (₹)
                    </span>
                    <button
                      type="button"
                      onClick={() => {
                        const nextBand: PayPerPriceBand = {
                          id: `pband_${Date.now()}`,
                          label: 'Custom Value Band',
                          min_price_inr: 0,
                          max_price_inr: null,
                          fee_inr: 150,
                        };
                        setDraftConfig({
                          ...draftConfig,
                          price_bands: [...draftConfig.price_bands, nextBand],
                        });
                        setConfigTouched((p) => ({ ...p, price_bands: true }));
                      }}
                      className="inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 py-1 text-xs font-bold text-[var(--ps-text-primary)] cursor-pointer"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add Price Band
                    </button>
                  </div>

                  <div className="space-y-2">
                    {draftConfig.price_bands.map((band, idx) => (
                      <div
                        key={band.id}
                        className="grid grid-cols-1 gap-2 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] p-2.5 sm:grid-cols-12 sm:items-center"
                      >
                        <div className="sm:col-span-4">
                          <input
                            type="text"
                            value={band.label}
                            onChange={(e) => {
                              const next = [...draftConfig.price_bands];
                              next[idx] = { ...band, label: e.target.value };
                              setDraftConfig({
                                ...draftConfig,
                                price_bands: next,
                              });
                              setConfigTouched((p) => ({
                                ...p,
                                price_bands: true,
                              }));
                            }}
                            placeholder="Band Label"
                            className="min-h-[40px] w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-2.5 py-1.5 text-xs font-semibold text-[var(--ps-text-primary)]"
                          />
                        </div>
                        <div className="sm:col-span-3">
                          <input
                            type="number"
                            min={0}
                            value={band.min_price_inr}
                            onChange={(e) => {
                              const next = [...draftConfig.price_bands];
                              next[idx] = {
                                ...band,
                                min_price_inr: Math.max(
                                  0,
                                  Number(e.target.value) || 0
                                ),
                              };
                              setDraftConfig({
                                ...draftConfig,
                                price_bands: next,
                              });
                              setConfigTouched((p) => ({
                                ...p,
                                price_bands: true,
                              }));
                            }}
                            placeholder="Min ₹"
                            className="min-h-[40px] w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-2.5 py-1.5 text-xs font-semibold text-[var(--ps-text-primary)]"
                          />
                        </div>
                        <div className="sm:col-span-3">
                          <input
                            type="number"
                            min={0}
                            value={band.max_price_inr ?? ''}
                            onChange={(e) => {
                              const next = [...draftConfig.price_bands];
                              next[idx] = {
                                ...band,
                                max_price_inr:
                                  e.target.value === ''
                                    ? null
                                    : Math.max(0, Number(e.target.value) || 0),
                              };
                              setDraftConfig({
                                ...draftConfig,
                                price_bands: next,
                              });
                              setConfigTouched((p) => ({
                                ...p,
                                price_bands: true,
                              }));
                            }}
                            placeholder="Max ₹ (blank = no limit)"
                            className="min-h-[40px] w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-2.5 py-1.5 text-xs font-semibold text-[var(--ps-text-primary)]"
                          />
                        </div>
                        <div className="flex items-center gap-1.5 sm:col-span-2">
                          <input
                            type="number"
                            min={0}
                            value={band.fee_inr}
                            onChange={(e) => {
                              const next = [...draftConfig.price_bands];
                              next[idx] = {
                                ...band,
                                fee_inr: Math.max(
                                  0,
                                  Number(e.target.value) || 0
                                ),
                              };
                              setDraftConfig({
                                ...draftConfig,
                                price_bands: next,
                              });
                              setConfigTouched((p) => ({
                                ...p,
                                price_bands: true,
                              }));
                            }}
                            placeholder="+Fee ₹"
                            className="min-h-[40px] w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-2 py-1.5 text-xs font-semibold text-[var(--ps-text-primary)]"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const next = draftConfig.price_bands.filter(
                                (_, i) => i !== idx
                              );
                              setDraftConfig({
                                ...draftConfig,
                                price_bands: next,
                              });
                              setConfigTouched((p) => ({
                                ...p,
                                price_bands: true,
                              }));
                            }}
                            className="inline-flex min-h-[38px] items-center justify-center rounded-lg border border-rose-500/30 px-2 text-rose-500 cursor-pointer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Area Bands (sq.ft with Sangam / Acre helper) */}
                <div className="space-y-2.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <span className="text-xs font-bold uppercase tracking-wider text-[var(--ps-text-primary)]">
                        Land / Plot Area Bands (sq.ft)
                      </span>
                      <p className="text-[11px] text-[var(--ps-text-secondary)]">
                        1 Sangam = 27,225 sq.ft · 0.5 Sangam = 13,612.5 sq.ft ·
                        1 Acre = 43,560 sq.ft
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        const nextArea: PayPerAreaBandSqft = {
                          id: `aband_${Date.now()}`,
                          label: 'Custom Area Band',
                          min_sqft: 0,
                          max_sqft: null,
                          fee_inr: 100,
                        };
                        setDraftConfig({
                          ...draftConfig,
                          area_bands_sqft: [
                            ...draftConfig.area_bands_sqft,
                            nextArea,
                          ],
                        });
                        setConfigTouched((p) => ({ ...p, area_bands: true }));
                      }}
                      className="inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 py-1 text-xs font-bold text-[var(--ps-text-primary)] cursor-pointer"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      Add Area Band
                    </button>
                  </div>

                  <div className="space-y-2">
                    {draftConfig.area_bands_sqft.map((band, idx) => (
                      <div
                        key={band.id}
                        className="grid grid-cols-1 gap-2 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] p-2.5 sm:grid-cols-12 sm:items-center"
                      >
                        <div className="sm:col-span-4">
                          <input
                            type="text"
                            value={band.label}
                            onChange={(e) => {
                              const next = [...draftConfig.area_bands_sqft];
                              next[idx] = { ...band, label: e.target.value };
                              setDraftConfig({
                                ...draftConfig,
                                area_bands_sqft: next,
                              });
                              setConfigTouched((p) => ({
                                ...p,
                                area_bands: true,
                              }));
                            }}
                            placeholder="Area Band Label"
                            className="min-h-[40px] w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-2.5 py-1.5 text-xs font-semibold text-[var(--ps-text-primary)]"
                          />
                        </div>
                        <div className="sm:col-span-3">
                          <input
                            type="number"
                            min={0}
                            value={band.min_sqft}
                            onChange={(e) => {
                              const next = [...draftConfig.area_bands_sqft];
                              next[idx] = {
                                ...band,
                                min_sqft: Math.max(
                                  0,
                                  Number(e.target.value) || 0
                                ),
                              };
                              setDraftConfig({
                                ...draftConfig,
                                area_bands_sqft: next,
                              });
                              setConfigTouched((p) => ({
                                ...p,
                                area_bands: true,
                              }));
                            }}
                            placeholder="Min sq.ft"
                            className="min-h-[40px] w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-2.5 py-1.5 text-xs font-semibold text-[var(--ps-text-primary)]"
                          />
                        </div>
                        <div className="sm:col-span-3">
                          <input
                            type="number"
                            min={0}
                            value={band.max_sqft ?? ''}
                            onChange={(e) => {
                              const next = [...draftConfig.area_bands_sqft];
                              next[idx] = {
                                ...band,
                                max_sqft:
                                  e.target.value === ''
                                    ? null
                                    : Math.max(0, Number(e.target.value) || 0),
                              };
                              setDraftConfig({
                                ...draftConfig,
                                area_bands_sqft: next,
                              });
                              setConfigTouched((p) => ({
                                ...p,
                                area_bands: true,
                              }));
                            }}
                            placeholder="Max sq.ft (blank = no limit)"
                            className="min-h-[40px] w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-2.5 py-1.5 text-xs font-semibold text-[var(--ps-text-primary)]"
                          />
                        </div>
                        <div className="flex items-center gap-1.5 sm:col-span-2">
                          <input
                            type="number"
                            min={0}
                            value={band.fee_inr}
                            onChange={(e) => {
                              const next = [...draftConfig.area_bands_sqft];
                              next[idx] = {
                                ...band,
                                fee_inr: Math.max(
                                  0,
                                  Number(e.target.value) || 0
                                ),
                              };
                              setDraftConfig({
                                ...draftConfig,
                                area_bands_sqft: next,
                              });
                              setConfigTouched((p) => ({
                                ...p,
                                area_bands: true,
                              }));
                            }}
                            placeholder="+Fee ₹"
                            className="min-h-[40px] w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-2 py-1.5 text-xs font-semibold text-[var(--ps-text-primary)]"
                          />
                          <button
                            type="button"
                            onClick={() => {
                              const next = draftConfig.area_bands_sqft.filter(
                                (_, i) => i !== idx
                              );
                              setDraftConfig({
                                ...draftConfig,
                                area_bands_sqft: next,
                              });
                              setConfigTouched((p) => ({
                                ...p,
                                area_bands: true,
                              }));
                            }}
                            className="inline-flex min-h-[38px] items-center justify-center rounded-lg border border-rose-500/30 px-2 text-rose-500 cursor-pointer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : null}

            {/* Add-ons Editor */}
            <div className="space-y-2.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] p-4">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold uppercase tracking-wider text-[var(--ps-text-primary)]">
                  Optional Visibility Add-ons
                </span>
                <button
                  type="button"
                  onClick={() => {
                    const nextAddon: PayPerAddon = {
                      id: `addon_${Date.now()}`,
                      label: 'Featured Boost',
                      price_inr: 49,
                      description: 'Priority spotlight badge',
                    };
                    setDraftConfig({
                      ...draftConfig,
                      addons: [...draftConfig.addons, nextAddon],
                    });
                    setConfigTouched((p) => ({ ...p, addons: true }));
                  }}
                  className="inline-flex min-h-[38px] items-center gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 py-1 text-xs font-bold text-[var(--ps-text-primary)] cursor-pointer"
                >
                  <Plus className="h-3.5 w-3.5" />
                  Add Add-on
                </button>
              </div>

              <div className="space-y-2">
                {draftConfig.addons.map((addon, idx) => (
                  <div
                    key={addon.id}
                    className="grid grid-cols-1 gap-2 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] p-2.5 sm:grid-cols-12 sm:items-center"
                  >
                    <div className="sm:col-span-4">
                      <input
                        type="text"
                        value={addon.label}
                        onChange={(e) => {
                          const next = [...draftConfig.addons];
                          next[idx] = { ...addon, label: e.target.value };
                          setDraftConfig({ ...draftConfig, addons: next });
                          setConfigTouched((p) => ({ ...p, addons: true }));
                        }}
                        placeholder="Add-on Label"
                        className="min-h-[40px] w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-2.5 py-1.5 text-xs font-semibold text-[var(--ps-text-primary)]"
                      />
                    </div>
                    <div className="sm:col-span-5">
                      <input
                        type="text"
                        value={addon.description || ''}
                        onChange={(e) => {
                          const next = [...draftConfig.addons];
                          next[idx] = { ...addon, description: e.target.value };
                          setDraftConfig({ ...draftConfig, addons: next });
                          setConfigTouched((p) => ({ ...p, addons: true }));
                        }}
                        placeholder="Short description"
                        className="min-h-[40px] w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-2.5 py-1.5 text-xs text-[var(--ps-text-primary)]"
                      />
                    </div>
                    <div className="flex items-center gap-1.5 sm:col-span-3">
                      <input
                        type="number"
                        min={0}
                        value={addon.price_inr}
                        onChange={(e) => {
                          const next = [...draftConfig.addons];
                          next[idx] = {
                            ...addon,
                            price_inr: Math.max(
                              0,
                              Number(e.target.value) || 0
                            ),
                          };
                          setDraftConfig({ ...draftConfig, addons: next });
                          setConfigTouched((p) => ({ ...p, addons: true }));
                        }}
                        placeholder="Fee ₹"
                        className="min-h-[40px] w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-2.5 py-1.5 text-xs font-semibold text-[var(--ps-text-primary)]"
                      />
                      <button
                        type="button"
                        onClick={() => {
                          const next = draftConfig.addons.filter(
                            (_, i) => i !== idx
                          );
                          setDraftConfig({ ...draftConfig, addons: next });
                          setConfigTouched((p) => ({ ...p, addons: true }));
                        }}
                        className="inline-flex min-h-[38px] items-center justify-center rounded-lg border border-rose-500/30 px-2 text-rose-500 cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : null}
      </FormModal>

      {/* Modal 2: Reject Pay-Per Order with Required Reason */}
      <FormModal
        isOpen={Boolean(rejectingOrder)}
        onClose={() => setRejectingOrder(null)}
        title="Reject Pay-Per Order"
        subtitle={
          rejectingOrder
            ? `Order ₹${Number(rejectingOrder.amount_inr).toLocaleString('en-IN')} (${rejectingOrder.payment_method.toUpperCase()}${
                rejectingOrder.upi_utr_ref
                  ? ` · UTR: ${rejectingOrder.upi_utr_ref}`
                  : ''
              })`
            : ''
        }
        isDirty={rejectionReason.trim().length > 0}
        isValid={rejectionReason.trim().length >= 4}
        validationSummary={
          rejectionReason.trim().length < 4
            ? ['Please provide a clear rejection reason (at least 4 characters).']
            : []
        }
        onSubmitAttempt={() => setRejectionSubmitAttempted(true)}
        confirmSubmitTitle="Reject Pay-Per Order?"
        confirmSubmitDescription={`Mark this order as rejected with reason: "${rejectionReason.trim()}"?`}
        confirmSubmitVariant="danger"
        maxWidthClassName="max-w-md"
        onSubmit={executeRejectOrder}
        isSubmitting={isReviewingOrder}
        submitLabel="Reject Order"
      >
        <div className="space-y-3">
          <label className="block text-xs font-semibold text-[var(--ps-text-secondary)]">
            Rejection Reason (Minimum 4 characters) *
          </label>
          <textarea
            rows={3}
            value={rejectionReason}
            onChange={(e) => {
              setRejectionReason(e.target.value);
              setRejectionTouched(true);
            }}
            onBlur={() => setRejectionTouched(true)}
            placeholder="e.g., UTR not found in SBI statement or amount mismatch."
            className="w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] p-3 text-xs text-[var(--ps-text-primary)] focus:border-[var(--ps-accent)] focus:outline-none"
          />
          {(rejectionTouched || rejectionSubmitAttempted) &&
          rejectionReason.trim().length < 4 ? (
            <p className="text-[11px] font-medium text-rose-500">
              Please provide a clear rejection reason (at least 4 characters).
            </p>
          ) : null}
        </div>
      </FormModal>

      {confirmDialogNode}
    </div>
  );
}
