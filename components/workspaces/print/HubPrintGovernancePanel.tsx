'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  Clock,
  Loader2,
  Lock,
  Printer,
  RefreshCw,
  Save,
  ShieldCheck,
  Wallet,
} from 'lucide-react';
import {
  ResponsiveTableScroll,
  WorkspaceTableToolbar,
} from '@/components/ui/ResponsiveTableWrapper';
import { OfficialPrintSwiftManager } from '@/components/workspaces/print/OfficialPrintSwiftManager';
import { useAppStatus } from '@/lib/hooks/useAppStatus';
import type { ServiceHubRecord } from '@/lib/config/types';
import {
  isPrintProfileBusyPaused,
  normalizeClientPrintProfile,
} from '@/lib/print-orders/client-helpers';
import type {
  ListingPrintProfile,
  MerchantSettlement,
  PrintCapabilities,
  PrintOrder,
} from '@/lib/print-orders/types';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';

export interface HubPrintGovernancePanelProps {
  selectedHub: ServiceHubRecord;
  onNotice?: (type: 'success' | 'error' | 'info', text: string) => void;
  onActivePrintCountChange?: (count: number) => void;
}

interface HubShopPrintRow {
  profile: ListingPrintProfile;
  listingTitle: string;
  listingLocality: string;
  draftVerified: Partial<Record<keyof PrintCapabilities, boolean>>;
  draftUpiVerified: boolean;
}

interface HubPrintOrderMetaRow
  extends Pick<
    PrintOrder,
    | 'id'
    | 'order_code'
    | 'listing_id'
    | 'job_mode'
    | 'payment_rail'
    | 'quoted_amount_inr'
    | 'quote_status'
    | 'payment_status'
    | 'fulfillment_status'
    | 'settlement_status'
    | 'purge_status'
    | 'created_at'
    | 'updated_at'
  > {
  shopName: string;
}

interface HubSettlementRow extends MerchantSettlement {
  shopName: string;
  orderCode: string;
}

const CAPABILITY_LABELS: Array<{
  key: keyof PrintCapabilities;
  shortLabel: string;
}> = [
  { key: 'bw_a4', shortLabel: 'B&W A4' },
  { key: 'color_a4', shortLabel: 'Color A4' },
  { key: 'duplex', shortLabel: 'Duplex' },
  { key: 'a3_large', shortLabel: 'A3' },
  { key: 'spiral_binding', shortLabel: 'Binding' },
  { key: 'lamination', shortLabel: 'Lamination' },
  { key: 'custom_digital_jobs', shortLabel: 'Custom Digital' },
  { key: 'sealed_envelope', shortLabel: 'Sealed Env' },
];

const SLA_DELAY_MS = 24 * 60 * 60 * 1000;

function formatInr(amount: number | null | undefined): string {
  const n = Number(amount ?? 0);
  if (!Number.isFinite(n)) return '₹0';
  return `₹${n.toLocaleString('en-IN', {
    minimumFractionDigits: n % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function hasUnverifiedItems(row: HubShopPrintRow): boolean {
  const caps = row.profile.capabilities;
  const verified = row.profile.verified_capabilities || {};
  const hasPendingCap = CAPABILITY_LABELS.some(
    ({ key }) => Boolean(caps[key]) && !Boolean(verified[key])
  );
  const hasPendingUpi =
    Boolean(row.profile.payment_policy.shop_upi_id) &&
    !row.profile.payment_policy.shop_upi_verified;
  return hasPendingCap || hasPendingUpi;
}

/**
 * Hub Manager Print & Digital Governance Panel.
 * STRICT PRIVACY BOUNDARY: Zero queries, buttons, or API calls to `print_order_files`
 * or signed PDF URLs. Branch managers see shop capability verification, order metadata/SLA,
 * and read-only hub settlements only.
 */
export function HubPrintGovernancePanel({
  selectedHub,
  onNotice,
  onActivePrintCountChange,
}: HubPrintGovernancePanelProps) {
  const { setStatus } = useAppStatus();
  const hubId = selectedHub.id;

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());
  const [savingProfileId, setSavingProfileId] = useState<string | null>(null);

  // Section A: Shop Profiles
  const [shopRows, setShopRows] = useState<HubShopPrintRow[]>([]);
  const [shopSearch, setShopSearch] = useState('');
  const [shopFilter, setShopFilter] = useState<
    'all' | 'needs_verification' | 'accepting' | 'paused'
  >('all');

  // Section B: Metadata-only Print Orders
  const [orders, setOrders] = useState<HubPrintOrderMetaRow[]>([]);
  const [orderSearch, setOrderSearch] = useState('');
  const [orderFilter, setOrderFilter] = useState<
    'all' | 'sla_delay' | 'in_progress' | 'ready' | 'completed' | 'cancelled'
  >('all');

  // Section C: Read-Only Settlements
  const [settlements, setSettlements] = useState<HubSettlementRow[]>([]);
  const [settlementSearch, setSettlementSearch] = useState('');
  const [settlementFilter, setSettlementFilter] = useState<
    'all' | 'locked' | 'eligible' | 'settled' | 'reversed'
  >('all');

  const loadHubPrintGovernance = useCallback(
    async (silent = false) => {
      if (!hubId || !isSupabaseConfigured()) {
        setIsLoading(false);
        setIsRefreshing(false);
        return;
      }
      if (!silent) setIsLoading(true);
      else setIsRefreshing(true);

      try {
        // STRICT PRIVACY: Only query listing_print_profiles, print_orders (metadata columns),
        // listings (titles), and merchant_settlements. NEVER query print_order_files!
        const [profilesRes, ordersRes, settlementsRes, listingsRes] =
          await Promise.all([
            supabase
              .from('listing_print_profiles')
              .select('*, listings:listing_id(id, title, locality)')
              .eq('hub_id', hubId)
              .order('updated_at', { ascending: false })
              .limit(150),
            supabase
              .from('print_orders')
              .select(
                'id, order_code, listing_id, job_mode, payment_rail, quoted_amount_inr, quote_status, payment_status, fulfillment_status, settlement_status, purge_status, created_at, updated_at'
              )
              .eq('hub_id', hubId)
              .order('created_at', { ascending: false })
              .limit(200),
            supabase
              .from('merchant_settlements')
              .select('*')
              .eq('hub_id', hubId)
              .order('created_at', { ascending: false })
              .limit(200),
            supabase
              .from('listings')
              .select('id, title, locality')
              .eq('hub_id', hubId)
              .limit(300),
          ]);

        const listingMap = new Map<
          string,
          { title: string; locality: string }
        >();
        for (const row of (listingsRes.data || []) as Array<{
          id: string;
          title?: string | null;
          locality?: string | null;
        }>) {
          listingMap.set(String(row.id), {
            title: String(row.title || 'Print Shop'),
            locality: String(row.locality || ''),
          });
        }

        const mappedProfiles: HubShopPrintRow[] = [];
        for (const raw of (profilesRes.data || []) as Array<
          Record<string, unknown>
        >) {
          const normalized = normalizeClientPrintProfile(raw);
          if (!normalized) continue;
          const joinedListing = Array.isArray(raw.listings)
            ? (raw.listings[0] as
                | { id?: string; title?: string; locality?: string }
                | undefined)
            : (raw.listings as
                | { id?: string; title?: string; locality?: string }
                | null);
          const fallback = listingMap.get(normalized.listing_id);
          const title =
            joinedListing?.title || fallback?.title || 'Print Counter';
          const locality =
            joinedListing?.locality || fallback?.locality || selectedHub.name;

          listingMap.set(normalized.listing_id, { title, locality });

          mappedProfiles.push({
            profile: normalized,
            listingTitle: title,
            listingLocality: locality,
            draftVerified: { ...(normalized.verified_capabilities || {}) },
            draftUpiVerified: Boolean(
              normalized.payment_policy.shop_upi_verified
            ),
          });
        }
        setShopRows(mappedProfiles);

        const orderCodeById = new Map<string, string>();
        const mappedOrders: HubPrintOrderMetaRow[] = (
          (ordersRes.data || []) as Array<Record<string, unknown>>
        ).map((o) => {
          const id = String(o.id);
          const orderCode = String(o.order_code || '');
          const listingId = String(o.listing_id || '');
          orderCodeById.set(id, orderCode);
          return {
            id,
            order_code: orderCode,
            listing_id: listingId,
            job_mode:
              o.job_mode === 'custom_digital'
                ? 'custom_digital'
                : 'instant_print',
            payment_rail: String(
              o.payment_rail || 'direct_counter'
            ) as PrintOrder['payment_rail'],
            quoted_amount_inr:
              o.quoted_amount_inr !== null && o.quoted_amount_inr !== undefined
                ? Number(o.quoted_amount_inr)
                : null,
            quote_status: String(
              o.quote_status || 'auto_priced'
            ) as PrintOrder['quote_status'],
            payment_status: String(
              o.payment_status || 'unpaid'
            ) as PrintOrder['payment_status'],
            fulfillment_status: String(
              o.fulfillment_status || 'draft'
            ) as PrintOrder['fulfillment_status'],
            settlement_status: String(
              o.settlement_status || 'not_applicable'
            ) as PrintOrder['settlement_status'],
            purge_status: String(
              o.purge_status || 'active'
            ) as PrintOrder['purge_status'],
            created_at: String(o.created_at || ''),
            updated_at: String(o.updated_at || ''),
            shopName: listingMap.get(listingId)?.title || 'Print Shop',
          };
        });
        setOrders(mappedOrders);

        const activeCount = mappedOrders.filter((o) =>
          ['confirmed', 'printing', 'ready_for_pickup'].includes(
            o.fulfillment_status
          )
        ).length;
        onActivePrintCountChange?.(activeCount);

        const mappedSettlements: HubSettlementRow[] = (
          (settlementsRes.data || []) as MerchantSettlement[]
        ).map((s) => ({
          ...s,
          gross_amount_inr: Number(s.gross_amount_inr || 0),
          platform_fee_inr: Number(s.platform_fee_inr || 0),
          net_payable_inr: Number(s.net_payable_inr || 0),
          shopName: listingMap.get(s.listing_id)?.title || 'Print Shop',
          orderCode:
            orderCodeById.get(s.print_order_id) ||
            `PRT-${s.print_order_id.slice(0, 6).toUpperCase()}`,
        }));
        setSettlements(mappedSettlements);
        setNowMs(Date.now());
      } catch (err) {
        onNotice?.(
          'error',
          err instanceof Error
            ? err.message
            : 'Failed to load hub Print & Digital governance data.'
        );
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [hubId, selectedHub.name, onNotice, onActivePrintCountChange]
  );

  useEffect(() => {
    queueMicrotask(() => {
      void loadHubPrintGovernance(false);
    });
  }, [loadHubPrintGovernance]);

  const handleToggleCapDraft = (
    listingId: string,
    capKey: keyof PrintCapabilities
  ) => {
    setShopRows((prev) =>
      prev.map((row) => {
        if (row.profile.listing_id !== listingId) return row;
        // Only allow verifying capabilities the shop actually declared & enabled
        if (!row.profile.capabilities[capKey]) return row;
        return {
          ...row,
          draftVerified: {
            ...row.draftVerified,
            [capKey]: !Boolean(row.draftVerified[capKey]),
          },
        };
      })
    );
  };

  const handleToggleUpiDraft = (listingId: string) => {
    setShopRows((prev) =>
      prev.map((row) => {
        if (row.profile.listing_id !== listingId) return row;
        if (!row.profile.payment_policy.shop_upi_id) return row;
        return {
          ...row,
          draftUpiVerified: !row.draftUpiVerified,
        };
      })
    );
  };

  const handleSaveShopVerification = async (row: HubShopPrintRow) => {
    setSavingProfileId(row.profile.listing_id);
    setStatus('saving', `Saving verification for ${row.listingTitle}…`);
    try {
      // Strictly sanitize verified_capabilities so only declared capabilities can be true
      const sanitizedVerified: Partial<Record<keyof PrintCapabilities, boolean>> =
        {};
      for (const { key } of CAPABILITY_LABELS) {
        sanitizedVerified[key] =
          Boolean(row.profile.capabilities[key]) &&
          Boolean(row.draftVerified[key]);
      }

      const nextPaymentPolicy = {
        ...row.profile.payment_policy,
        shop_upi_verified: Boolean(
          row.profile.payment_policy.shop_upi_id && row.draftUpiVerified
        ),
      };

      const { data, error } = await supabase
        .from('listing_print_profiles')
        .update({
          verified_capabilities: sanitizedVerified,
          payment_policy: nextPaymentPolicy,
          updated_at: new Date().toISOString(),
        })
        .eq('listing_id', row.profile.listing_id)
        .eq('hub_id', hubId)
        .select('*')
        .single();

      if (error) throw new Error(error.message);

      const updated = normalizeClientPrintProfile(
        data as Record<string, unknown>
      );
      if (updated) {
        setShopRows((prev) =>
          prev.map((item) =>
            item.profile.listing_id === row.profile.listing_id
              ? {
                  ...item,
                  profile: updated,
                  draftVerified: { ...(updated.verified_capabilities || {}) },
                  draftUpiVerified: Boolean(
                    updated.payment_policy.shop_upi_verified
                  ),
                }
              : item
          )
        );
      }
      setStatus('success', `Saved verification for ${row.listingTitle}`);
      onNotice?.(
        'success',
        `Updated capability & UPI verification for "${row.listingTitle}".`
      );
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Failed to save shop verification.';
      setStatus('error', msg);
      onNotice?.('error', msg);
    } finally {
      setSavingProfileId(null);
    }
  };

  // Filtered Shop Rows
  const filteredShops = useMemo(() => {
    const q = shopSearch.trim().toLowerCase();
    return shopRows.filter((row) => {
      const paused =
        !row.profile.is_accepting_orders ||
        isPrintProfileBusyPaused(row.profile.busy_until, nowMs);
      if (shopFilter === 'needs_verification' && !hasUnverifiedItems(row)) {
        return false;
      }
      if (shopFilter === 'accepting' && paused) return false;
      if (shopFilter === 'paused' && !paused) return false;

      if (!q) return true;
      return (
        row.listingTitle.toLowerCase().includes(q) ||
        row.listingLocality.toLowerCase().includes(q) ||
        String(row.profile.payment_policy.shop_upi_id || '')
          .toLowerCase()
          .includes(q)
      );
    });
  }, [shopRows, shopSearch, shopFilter, nowMs]);

  // Filtered Metadata-Only Orders
  const isOrderSlaDelayed = useCallback(
    (o: HubPrintOrderMetaRow) => {
      if (!['confirmed', 'printing'].includes(o.fulfillment_status)) {
        return false;
      }
      const createdMs = Date.parse(o.created_at);
      return Number.isFinite(createdMs) && nowMs - createdMs > SLA_DELAY_MS;
    },
    [nowMs]
  );

  const slaDelayedCount = useMemo(
    () => orders.filter(isOrderSlaDelayed).length,
    [orders, isOrderSlaDelayed]
  );

  const filteredOrders = useMemo(() => {
    const q = orderSearch.trim().toLowerCase();
    return orders.filter((o) => {
      if (orderFilter === 'sla_delay' && !isOrderSlaDelayed(o)) return false;
      if (
        orderFilter === 'in_progress' &&
        !['confirmed', 'printing'].includes(o.fulfillment_status)
      ) {
        return false;
      }
      if (
        orderFilter === 'ready' &&
        o.fulfillment_status !== 'ready_for_pickup'
      ) {
        return false;
      }
      if (
        orderFilter === 'completed' &&
        !['collected', 'handed_to_rider'].includes(o.fulfillment_status)
      ) {
        return false;
      }
      if (
        orderFilter === 'cancelled' &&
        !['cancelled', 'rejected'].includes(o.fulfillment_status)
      ) {
        return false;
      }
      if (!q) return true;
      return (
        o.order_code.toLowerCase().includes(q) ||
        o.shopName.toLowerCase().includes(q) ||
        o.payment_rail.toLowerCase().includes(q)
      );
    });
  }, [orders, orderSearch, orderFilter, isOrderSlaDelayed]);

  // Filtered Read-Only Settlements
  const filteredSettlements = useMemo(() => {
    const q = settlementSearch.trim().toLowerCase();
    return settlements.filter((s) => {
      if (settlementFilter !== 'all' && s.status !== settlementFilter) {
        return false;
      }
      if (!q) return true;
      return (
        s.orderCode.toLowerCase().includes(q) ||
        s.shopName.toLowerCase().includes(q) ||
        String(s.payout_reference || '')
          .toLowerCase()
          .includes(q)
      );
    });
  }, [settlements, settlementSearch, settlementFilter]);

  if (isLoading) {
    return (
      <div className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-surface)] py-12 text-xs text-[var(--ps-text-muted)]">
        <Loader2 className="h-4 w-4 animate-spin text-theme-primary" />
        <span>Loading {selectedHub.name} Print &amp; Digital governance…</span>
      </div>
    );
  }

  return (
    <div
      data-testid="hub-manager-panel-print"
      className="min-w-0 space-y-5"
    >
      {/* Top Privacy Boundary & Refresh Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/8 px-3.5 py-2.5">
        <div className="flex items-center gap-2 text-xs text-emerald-900 dark:text-emerald-200 min-w-0">
          <Lock className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span className="font-semibold">
            Customer documents are privately encrypted &amp; inaccessible to Hub
            Managers.
          </span>
        </div>
        <button
          type="button"
          disabled={isRefreshing}
          onClick={() => void loadHubPrintGovernance(true)}
          className="inline-flex h-7 items-center gap-1 rounded-lg border border-emerald-500/30 bg-white/80 dark:bg-slate-900/80 px-2.5 text-[11px] font-bold text-emerald-800 dark:text-emerald-200 hover:bg-white dark:hover:bg-slate-900 cursor-pointer shrink-0"
        >
          <RefreshCw
            className={`h-3 w-3 ${isRefreshing ? 'animate-spin' : ''}`}
          />
          <span>Refresh Hub Print Data</span>
        </button>
      </div>

      {/* Official PrintSwift Hub Manager (Hub Manager Scoped) */}
      <OfficialPrintSwiftManager
        scope="hub_manager"
        scopedHub={selectedHub}
        onSaved={() => void loadHubPrintGovernance(true)}
        onNotice={onNotice}
      />

      {/* ===================================================================
          SECTION A: LOCAL SHOP CAPABILITY & UPI VERIFICATION TABLE
         =================================================================== */}
      <section className="min-w-0 rounded-2xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-surface)] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-1.5 text-sm font-bold text-[var(--ps-text)]">
              <BadgeCheck className="h-4 w-4 text-theme-primary" />
              <span>
                Local Shop Capability &amp; UPI Verification ({selectedHub.name})
              </span>
            </h2>
            <p className="text-[11px] text-[var(--ps-text-muted)]">
              Verify only capabilities each print shop has declared and proven,
              plus confirm their Direct Shop UPI ID before shoppers pay at the
              counter.
            </p>
          </div>
        </div>

        <WorkspaceTableToolbar
          searchQuery={shopSearch}
          onSearchChange={setShopSearch}
          searchPlaceholder="Search shop name, locality, or UPI ID…"
          filteredCount={filteredShops.length}
          totalCount={shopRows.length}
          countLabel="shops"
          hasActiveFilters={Boolean(shopSearch || shopFilter !== 'all')}
          onResetFilters={() => {
            setShopSearch('');
            setShopFilter('all');
          }}
        >
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5">
            {(
              [
                { id: 'all', label: 'All' },
                {
                  id: 'needs_verification',
                  label: `Needs Verification (${shopRows.filter(hasUnverifiedItems).length})`,
                },
                { id: 'accepting', label: 'Accepting Orders' },
                { id: 'paused', label: 'Paused' },
              ] as const
            ).map((pill) => (
              <button
                key={pill.id}
                type="button"
                onClick={() => setShopFilter(pill.id)}
                className={`h-7 px-2.5 rounded-lg text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
                  shopFilter === pill.id
                    ? 'bg-theme-primary text-theme-primary-foreground'
                    : 'border border-slate-200 dark:border-slate-700 bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                }`}
              >
                {pill.label}
              </button>
            ))}
          </div>
        </WorkspaceTableToolbar>

        {filteredShops.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 p-6 text-center text-xs text-[var(--ps-text-muted)]">
            {shopRows.length === 0
              ? `No print shop profiles registered in ${selectedHub.name} yet.`
              : 'No shops match your current search or filter.'}
          </div>
        ) : (
          <ResponsiveTableScroll
            minWidthClass="min-w-[820px]"
            showSwipeHint={true}
            swipeHintLabel="Swipe ↔ to verify shop capabilities and UPI IDs"
          >
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-[var(--ps-surface-alt)]/60 text-[11px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                  <th className="py-2.5 px-3">Shop &amp; Status</th>
                  <th className="py-2.5 px-3">
                    Declared Capabilities (Check to Verify)
                  </th>
                  <th className="py-2.5 px-3">Direct Shop UPI</th>
                  <th className="py-2.5 px-3 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800/70">
                {filteredShops.map((row) => {
                  const p = row.profile;
                  const isBusyPaused = isPrintProfileBusyPaused(
                    p.busy_until,
                    nowMs
                  );
                  const isLive = p.is_accepting_orders && !isBusyPaused;
                  const isSaving = savingProfileId === p.listing_id;

                  return (
                    <tr
                      key={p.listing_id}
                      data-testid={`hub-print-shop-row-${p.listing_id}`}
                      className="align-top hover:bg-[var(--ps-bg)]/60"
                    >
                      <td className="py-3 px-3 space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-bold text-[var(--ps-text)]">
                            {row.listingTitle}
                          </span>
                          {p.is_first_party_printswift && (
                            <span className="rounded bg-theme-primary px-1.5 py-0.5 text-[9px] font-extrabold uppercase text-theme-primary-foreground">
                              Official PrintSwift
                            </span>
                          )}
                        </div>
                        <p className="text-[11px] text-[var(--ps-text-muted)]">
                          {row.listingLocality} · Rate v{p.pricing_version}
                        </p>
                        <span
                          className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold ${
                            isLive
                              ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                              : 'bg-amber-500/12 text-amber-700 dark:text-amber-300'
                          }`}
                        >
                          {isLive
                            ? 'Accepting Orders'
                            : isBusyPaused
                              ? 'Temporarily Paused'
                              : 'Orders Off'}
                        </span>
                      </td>

                      <td className="py-3 px-3">
                        <div className="flex flex-wrap gap-1.5">
                          {CAPABILITY_LABELS.map(({ key, shortLabel }) => {
                            const declared = Boolean(p.capabilities[key]);
                            if (!declared) return null;
                            const verified = Boolean(row.draftVerified[key]);
                            return (
                              <label
                                key={key}
                                className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-[11px] font-semibold cursor-pointer transition-colors ${
                                  verified
                                    ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
                                    : 'border-slate-200 dark:border-slate-700 bg-[var(--ps-bg)] text-[var(--ps-text)]'
                                }`}
                              >
                                <input
                                  type="checkbox"
                                  checked={verified}
                                  onChange={() =>
                                    handleToggleCapDraft(p.listing_id, key)
                                  }
                                  className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                                />
                                <span>{shortLabel}</span>
                              </label>
                            );
                          })}
                        </div>
                      </td>

                      <td className="py-3 px-3 space-y-1.5">
                        {p.payment_policy.shop_upi_id ? (
                          <>
                            <p className="font-mono text-[11px] font-bold text-[var(--ps-text)]">
                              {p.payment_policy.shop_upi_id}
                            </p>
                            {p.payment_policy.shop_upi_name && (
                              <p className="text-[10px] text-[var(--ps-text-muted)]">
                                {p.payment_policy.shop_upi_name}
                              </p>
                            )}
                            <label className="inline-flex items-center gap-1.5 text-[11px] font-semibold cursor-pointer">
                              <input
                                type="checkbox"
                                checked={row.draftUpiVerified}
                                onChange={() =>
                                  handleToggleUpiDraft(p.listing_id)
                                }
                                className="h-3.5 w-3.5 rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
                              />
                              <span
                                className={
                                  row.draftUpiVerified
                                    ? 'text-emerald-700 dark:text-emerald-300 font-bold'
                                    : 'text-amber-700 dark:text-amber-300'
                                }
                              >
                                {row.draftUpiVerified
                                  ? 'UPI Verified ✓'
                                  : 'Verify Shop UPI'}
                              </span>
                            </label>
                          </>
                        ) : (
                          <span className="text-[11px] text-[var(--ps-text-muted)]">
                            No shop UPI configured
                          </span>
                        )}
                      </td>

                      <td className="py-3 px-3 text-right whitespace-nowrap">
                        <button
                          type="button"
                          disabled={isSaving}
                          onClick={() => void handleSaveShopVerification(row)}
                          data-testid={`hub-save-print-verify-${p.listing_id}`}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-theme-primary px-3 text-xs font-bold text-theme-primary-foreground shadow-xs hover:opacity-95 disabled:opacity-50 cursor-pointer"
                        >
                          {isSaving ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Save className="h-3.5 w-3.5" />
                          )}
                          <span>Save</span>
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ResponsiveTableScroll>
        )}
      </section>

      {/* ===================================================================
          SECTION B: HUB PRINT ORDERS SLA & DISPUTE DESK (METADATA-ONLY)
         =================================================================== */}
      <section className="min-w-0 rounded-2xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-surface)] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-1.5 text-sm font-bold text-[var(--ps-text)]">
              <Printer className="h-4 w-4 text-theme-primary" />
              <span>
                Hub Print Orders SLA &amp; Dispute Desk — Metadata Only (
                {orders.length})
              </span>
            </h2>
            <p className="text-[11px] text-[var(--ps-text-muted)]">
              Monitor fulfillment progress, payment rails, 48h purge status, and
              SLA delays (&gt;24h) without accessing customer PDFs.
            </p>
          </div>
          {slaDelayedCount > 0 && (
            <span className="inline-flex items-center gap-1 rounded-lg border border-rose-500/35 bg-rose-500/12 px-2.5 py-1 text-[11px] font-bold text-rose-700 dark:text-rose-300">
              <AlertTriangle className="h-3.5 w-3.5" />
              <span>{slaDelayedCount} SLA Delay (&gt;24h)</span>
            </span>
          )}
        </div>

        <WorkspaceTableToolbar
          searchQuery={orderSearch}
          onSearchChange={setOrderSearch}
          searchPlaceholder="Search order code, shop name, or payment rail…"
          filteredCount={filteredOrders.length}
          totalCount={orders.length}
          countLabel="orders"
          hasActiveFilters={Boolean(orderSearch || orderFilter !== 'all')}
          onResetFilters={() => {
            setOrderSearch('');
            setOrderFilter('all');
          }}
        >
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5">
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'sla_delay', label: `SLA >24h (${slaDelayedCount})` },
                { id: 'in_progress', label: 'Confirmed / Printing' },
                { id: 'ready', label: 'Ready' },
                { id: 'completed', label: 'Completed' },
                { id: 'cancelled', label: 'Cancelled' },
              ] as const
            ).map((pill) => (
              <button
                key={pill.id}
                type="button"
                onClick={() => setOrderFilter(pill.id)}
                className={`h-7 px-2.5 rounded-lg text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
                  orderFilter === pill.id
                    ? 'bg-theme-primary text-theme-primary-foreground'
                    : 'border border-slate-200 dark:border-slate-700 bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                }`}
              >
                {pill.label}
              </button>
            ))}
          </div>
        </WorkspaceTableToolbar>

        {filteredOrders.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 p-6 text-center text-xs text-[var(--ps-text-muted)]">
            No print orders match the active filters in {selectedHub.name}.
          </div>
        ) : (
          <ResponsiveTableScroll
            minWidthClass="min-w-[880px]"
            showSwipeHint={true}
            swipeHintLabel="Swipe ↔ to inspect order metadata and SLA timers"
          >
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-[var(--ps-surface-alt)]/60 text-[11px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                  <th className="py-2.5 px-3">Order &amp; Shop</th>
                  <th className="py-2.5 px-3">Mode &amp; Rail</th>
                  <th className="py-2.5 px-3">Amount</th>
                  <th className="py-2.5 px-3">Quote / Payment</th>
                  <th className="py-2.5 px-3">Fulfillment &amp; SLA</th>
                  <th className="py-2.5 px-3">Vault Purge</th>
                  <th className="py-2.5 px-3 text-right">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800/70">
                {filteredOrders.map((o) => {
                  const delayed = isOrderSlaDelayed(o);
                  return (
                    <tr
                      key={o.id}
                      className="hover:bg-[var(--ps-bg)]/60 align-top"
                    >
                      <td className="py-2.5 px-3">
                        <div className="font-mono font-extrabold text-[var(--ps-text)] tabular-nums">
                          {o.order_code}
                        </div>
                        <div className="text-[11px] text-[var(--ps-text-muted)]">
                          {o.shopName}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <div className="font-semibold text-[var(--ps-text)]">
                          {o.job_mode === 'custom_digital'
                            ? 'Custom Digital'
                            : 'Instant Print'}
                        </div>
                        <div className="text-[10px] uppercase font-bold text-[var(--ps-text-muted)]">
                          {o.payment_rail.replace(/_/g, ' ')}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 font-extrabold tabular-nums whitespace-nowrap text-[var(--ps-text)]">
                        {o.quoted_amount_inr !== null
                          ? formatInr(o.quoted_amount_inr)
                          : 'Pending Quote'}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap space-y-1">
                        <div className="text-[10px] font-bold uppercase text-[var(--ps-text-muted)]">
                          Quote: {o.quote_status.replace(/_/g, ' ')}
                        </div>
                        <span
                          className={`inline-flex items-center rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                            o.payment_status === 'escrow_held' ||
                            o.payment_status === 'paid_direct_confirmed'
                              ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                              : 'bg-amber-500/12 text-amber-700 dark:text-amber-300'
                          }`}
                        >
                          {o.payment_status.replace(/_/g, ' ')}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap space-y-1">
                        <span className="inline-flex items-center rounded border border-slate-200 dark:border-slate-700 bg-[var(--ps-bg)] px-1.5 py-0.5 text-[10px] font-bold uppercase text-[var(--ps-text)]">
                          {o.fulfillment_status.replace(/_/g, ' ')}
                        </span>
                        {delayed && (
                          <div>
                            <span className="inline-flex items-center gap-1 rounded bg-rose-500/15 px-1.5 py-0.5 text-[10px] font-extrabold text-rose-700 dark:text-rose-300">
                              <Clock className="h-3 w-3" />
                              SLA Delay &gt;24h
                            </span>
                          </div>
                        )}
                      </td>
                      <td className="py-2.5 px-3 whitespace-nowrap">
                        <span
                          className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                            o.purge_status === 'purged'
                              ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                              : o.purge_status === 'scheduled'
                                ? 'bg-amber-500/12 text-amber-700 dark:text-amber-300'
                                : 'bg-slate-200/80 dark:bg-slate-800 text-[var(--ps-text-muted)]'
                          }`}
                        >
                          {o.purge_status === 'purged' && (
                            <ShieldCheck className="h-3 w-3" />
                          )}
                          {o.purge_status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right whitespace-nowrap text-[11px] text-[var(--ps-text-muted)] tabular-nums">
                        {formatDateTime(o.created_at)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </ResponsiveTableScroll>
        )}
      </section>

      {/* ===================================================================
          SECTION C: HUB MERCHANT SETTLEMENTS (READ-ONLY)
         =================================================================== */}
      <section className="min-w-0 rounded-2xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-surface)] p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="flex items-center gap-1.5 text-sm font-bold text-[var(--ps-text)]">
              <Wallet className="h-4 w-4 text-theme-primary" />
              <span>
                Hub Merchant Escrow Settlements — Read-Only ({settlements.length}
                )
              </span>
            </h2>
            <p className="text-[11px] text-[var(--ps-text-muted)]">
              Reference ledger for local shop payout inquiries. Central payouts
              and UTR reconciliation are executed by Super-Admin.
            </p>
          </div>
          <span className="inline-flex items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-[var(--ps-bg)] px-2.5 py-1 text-[10px] font-bold text-[var(--ps-text-muted)]">
            <Lock className="h-3 w-3" />
            Read-Only Branch View
          </span>
        </div>

        <WorkspaceTableToolbar
          searchQuery={settlementSearch}
          onSearchChange={setSettlementSearch}
          searchPlaceholder="Search order code, shop, or payout UTR…"
          filteredCount={filteredSettlements.length}
          totalCount={settlements.length}
          countLabel="settlements"
          hasActiveFilters={Boolean(
            settlementSearch || settlementFilter !== 'all'
          )}
          onResetFilters={() => {
            setSettlementSearch('');
            setSettlementFilter('all');
          }}
        >
          <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5">
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'locked', label: 'Locked' },
                { id: 'eligible', label: 'Eligible' },
                { id: 'settled', label: 'Settled' },
                { id: 'reversed', label: 'Reversed' },
              ] as const
            ).map((pill) => (
              <button
                key={pill.id}
                type="button"
                onClick={() => setSettlementFilter(pill.id)}
                className={`h-7 px-2.5 rounded-lg text-xs font-semibold whitespace-nowrap transition cursor-pointer ${
                  settlementFilter === pill.id
                    ? 'bg-theme-primary text-theme-primary-foreground'
                    : 'border border-slate-200 dark:border-slate-700 bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                }`}
              >
                {pill.label}
              </button>
            ))}
          </div>
        </WorkspaceTableToolbar>

        {filteredSettlements.length === 0 ? (
          <div className="rounded-xl border border-dashed border-slate-200 dark:border-slate-800 p-6 text-center text-xs text-[var(--ps-text-muted)]">
            No escrow merchant settlements recorded for {selectedHub.name}.
          </div>
        ) : (
          <ResponsiveTableScroll
            minWidthClass="min-w-[740px]"
            showSwipeHint={true}
            swipeHintLabel="Swipe ↔ to inspect escrow payout details"
          >
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-slate-200 dark:border-slate-800 bg-[var(--ps-surface-alt)]/60 text-[11px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                  <th className="py-2.5 px-3">Order &amp; Shop</th>
                  <th className="py-2.5 px-3">Gross</th>
                  <th className="py-2.5 px-3">Platform Fee</th>
                  <th className="py-2.5 px-3">Net Payable</th>
                  <th className="py-2.5 px-3">Status</th>
                  <th className="py-2.5 px-3 text-right">Payout Ref / Date</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800/70">
                {filteredSettlements.map((s) => (
                  <tr key={s.id} className="hover:bg-[var(--ps-bg)]/60">
                    <td className="py-2.5 px-3">
                      <div className="font-mono font-bold text-[var(--ps-text)] tabular-nums">
                        {s.orderCode}
                      </div>
                      <div className="text-[11px] text-[var(--ps-text-muted)]">
                        {s.shopName}
                      </div>
                    </td>
                    <td className="py-2.5 px-3 tabular-nums">
                      {formatInr(s.gross_amount_inr)}
                    </td>
                    <td className="py-2.5 px-3 tabular-nums text-[var(--ps-text-muted)]">
                      -{formatInr(s.platform_fee_inr)}
                    </td>
                    <td className="py-2.5 px-3 font-extrabold tabular-nums text-[var(--ps-text)]">
                      {formatInr(s.net_payable_inr)}
                    </td>
                    <td className="py-2.5 px-3 whitespace-nowrap">
                      <span
                        className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
                          s.status === 'settled'
                            ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                            : s.status === 'eligible'
                              ? 'bg-sky-500/12 text-sky-700 dark:text-sky-300'
                              : s.status === 'reversed'
                                ? 'bg-rose-500/12 text-rose-700 dark:text-rose-300'
                                : 'bg-amber-500/12 text-amber-700 dark:text-amber-300'
                        }`}
                      >
                        {s.status === 'settled' && (
                          <CheckCircle2 className="h-3 w-3" />
                        )}
                        {s.status}
                      </span>
                    </td>
                    <td className="py-2.5 px-3 text-right whitespace-nowrap">
                      <div className="font-mono text-[11px] text-[var(--ps-text)]">
                        {s.payout_reference || '—'}
                      </div>
                      <div className="text-[10px] text-[var(--ps-text-muted)] tabular-nums">
                        {formatDateTime(s.settled_at || s.created_at)}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </ResponsiveTableScroll>
        )}
      </section>
    </div>
  );
}

export default HubPrintGovernancePanel;
