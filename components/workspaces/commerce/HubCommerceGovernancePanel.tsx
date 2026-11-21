'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BadgeCheck,
  CheckCircle2,
  Loader2,
  RefreshCw,
  ShieldCheck,
  ShoppingBag,
  Store,
  UtensilsCrossed,
} from 'lucide-react';
import {
  ResponsiveTableScroll,
  WorkspaceTableToolbar,
} from '@/components/ui/ResponsiveTableWrapper';
import type { CommercePaymentPolicy } from '@/lib/commerce/types';
import { useAppStatus } from '@/lib/hooks/useAppStatus';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';

export interface HubCommerceGovernancePanelProps {
  hubId: string;
  hubName: string;
}

interface VerifiedMerchantRow {
  listing_id: string;
  listingTitle: string;
  listingLocality: string;
  vertical: 'shop_catalogue' | 'restaurant_food';
  primaryVerified: boolean; // store_verified or fssai_verified
  fssaiLicenseNo: string | null;
  paymentPolicy: CommercePaymentPolicy;
}

interface HubOrderMonitorRow {
  id: string;
  order_code: string;
  kind: 'shop' | 'food';
  listingTitle: string;
  mode: string;
  total_amount_inr: number;
  status: string;
  payment_status: string;
  created_at: string;
}

function normalizePolicy(raw: unknown): CommercePaymentPolicy {
  const obj =
    raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  return {
    allow_escrow: obj.allow_escrow !== false,
    allow_direct_pay: obj.allow_direct_pay !== false,
    direct_pay_max_inr: Number(obj.direct_pay_max_inr ?? 500),
    shop_upi_id: typeof obj.shop_upi_id === 'string' ? obj.shop_upi_id : null,
    shop_upi_name:
      typeof obj.shop_upi_name === 'string' ? obj.shop_upi_name : null,
    shop_upi_verified: Boolean(obj.shop_upi_verified),
  };
}

export function HubCommerceGovernancePanel({
  hubId,
  hubName,
}: HubCommerceGovernancePanelProps) {
  const { setStatus } = useAppStatus();

  const [merchants, setMerchants] = useState<VerifiedMerchantRow[]>([]);
  const [orders, setOrders] = useState<HubOrderMonitorRow[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  const [merchantSearch, setMerchantSearch] = useState('');
  const [merchantVerticalFilter, setMerchantVerticalFilter] = useState<
    'all' | 'shop_catalogue' | 'restaurant_food'
  >('all');

  const [orderSearch, setOrderSearch] = useState('');
  const [orderKindFilter, setOrderKindFilter] = useState<
    'all' | 'food' | 'shop'
  >('all');

  const loadData = useCallback(async () => {
    if (!hubId || !isSupabaseConfigured()) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const [shopsRes, restsRes, shopOrdersRes, restOrdersRes] =
        await Promise.all([
          supabase
            .from('listing_shop_profiles')
            .select(
              'listing_id, store_verified, payment_policy, listings(title, locality)'
            )
            .eq('hub_id', hubId)
            .order('updated_at', { ascending: false }),
          supabase
            .from('listing_restaurant_profiles')
            .select(
              'listing_id, fssai_license_no, fssai_verified, payment_policy, listings(title, locality)'
            )
            .eq('hub_id', hubId)
            .order('updated_at', { ascending: false }),
          supabase
            .from('shop_orders')
            .select(
              'id, order_code, handover_mode, total_amount_inr, order_status, payment_status, created_at, listings(title)'
            )
            .eq('hub_id', hubId)
            .order('created_at', { ascending: false })
            .limit(40),
          supabase
            .from('restaurant_orders')
            .select(
              'id, order_code, fulfillment_mode, total_amount_inr, kitchen_status, payment_status, created_at, listings(title)'
            )
            .eq('hub_id', hubId)
            .order('created_at', { ascending: false })
            .limit(40),
        ]);

      const combinedMerchants: VerifiedMerchantRow[] = [];

      if (Array.isArray(shopsRes.data)) {
        for (const r of shopsRes.data as Array<Record<string, unknown>>) {
          const l = Array.isArray(r.listings)
            ? (r.listings[0] as Record<string, unknown> | undefined)
            : (r.listings as Record<string, unknown> | undefined);
          combinedMerchants.push({
            listing_id: String(r.listing_id),
            listingTitle: String(l?.title || 'Local Store').replace(
              /^\[SAMPLE\]\s*/i,
              ''
            ),
            listingLocality: String(l?.locality || ''),
            vertical: 'shop_catalogue',
            primaryVerified: Boolean(r.store_verified),
            fssaiLicenseNo: null,
            paymentPolicy: normalizePolicy(r.payment_policy),
          });
        }
      }

      if (Array.isArray(restsRes.data)) {
        for (const r of restsRes.data as Array<Record<string, unknown>>) {
          const l = Array.isArray(r.listings)
            ? (r.listings[0] as Record<string, unknown> | undefined)
            : (r.listings as Record<string, unknown> | undefined);
          combinedMerchants.push({
            listing_id: String(r.listing_id),
            listingTitle: String(l?.title || 'Restaurant / Café').replace(
              /^\[SAMPLE\]\s*/i,
              ''
            ),
            listingLocality: String(l?.locality || ''),
            vertical: 'restaurant_food',
            primaryVerified: Boolean(r.fssai_verified),
            fssaiLicenseNo:
              typeof r.fssai_license_no === 'string'
                ? r.fssai_license_no
                : null,
            paymentPolicy: normalizePolicy(r.payment_policy),
          });
        }
      }

      setMerchants(combinedMerchants);

      const combinedOrders: HubOrderMonitorRow[] = [];
      if (Array.isArray(shopOrdersRes.data)) {
        for (const o of shopOrdersRes.data as Array<Record<string, unknown>>) {
          const l = Array.isArray(o.listings)
            ? (o.listings[0] as Record<string, unknown> | undefined)
            : (o.listings as Record<string, unknown> | undefined);
          combinedOrders.push({
            id: String(o.id),
            order_code: String(o.order_code),
            kind: 'shop',
            listingTitle: String(l?.title || 'Local Store').replace(
              /^\[SAMPLE\]\s*/i,
              ''
            ),
            mode:
              o.handover_mode === 'pick_n_drop'
                ? 'Pick N Drop'
                : 'Counter Pickup',
            total_amount_inr: Number(o.total_amount_inr || 0),
            status: String(o.order_status || 'confirmed'),
            payment_status: String(o.payment_status || 'unpaid'),
            created_at: String(o.created_at),
          });
        }
      }
      if (Array.isArray(restOrdersRes.data)) {
        for (const o of restOrdersRes.data as Array<Record<string, unknown>>) {
          const l = Array.isArray(o.listings)
            ? (o.listings[0] as Record<string, unknown> | undefined)
            : (o.listings as Record<string, unknown> | undefined);
          combinedOrders.push({
            id: String(o.id),
            order_code: String(o.order_code),
            kind: 'food',
            listingTitle: String(l?.title || 'Restaurant / Café').replace(
              /^\[SAMPLE\]\s*/i,
              ''
            ),
            mode:
              o.fulfillment_mode === 'pick_n_drop'
                ? 'Pick N Drop Food'
                : 'Self-Takeaway',
            total_amount_inr: Number(o.total_amount_inr || 0),
            status: String(o.kitchen_status || 'new_order'),
            payment_status: String(o.payment_status || 'unpaid'),
            created_at: String(o.created_at),
          });
        }
      }

      combinedOrders.sort(
        (a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)
      );
      setOrders(combinedOrders);
    } finally {
      setIsLoading(false);
    }
  }, [hubId]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleTogglePrimaryVerification = async (row: VerifiedMerchantRow) => {
    const key = `${row.listing_id}:primary`;
    setBusyKey(key);
    const nextVal = !row.primaryVerified;
    try {
      const table =
        row.vertical === 'restaurant_food'
          ? 'listing_restaurant_profiles'
          : 'listing_shop_profiles';
      const field =
        row.vertical === 'restaurant_food' ? 'fssai_verified' : 'store_verified';
      const { error } = await supabase
        .from(table)
        .update({ [field]: nextVal })
        .eq('listing_id', row.listing_id);
      if (error) throw error;
      setMerchants((prev) =>
        prev.map((m) =>
          m.listing_id === row.listing_id
            ? { ...m, primaryVerified: nextVal }
            : m
        )
      );
      setStatus(
        'success',
        `${row.listingTitle} ${
          row.vertical === 'restaurant_food' ? 'FSSAI' : 'Store'
        } verification ${nextVal ? 'approved' : 'revoked'}.`
      );
    } catch (err) {
      setStatus(
        'error',
        err instanceof Error ? err.message : 'Verification update failed.'
      );
    } finally {
      setBusyKey(null);
    }
  };

  const handleToggleUpiVerification = async (row: VerifiedMerchantRow) => {
    const key = `${row.listing_id}:upi`;
    setBusyKey(key);
    const nextPolicy: CommercePaymentPolicy = {
      ...row.paymentPolicy,
      shop_upi_verified: !row.paymentPolicy.shop_upi_verified,
    };
    try {
      const table =
        row.vertical === 'restaurant_food'
          ? 'listing_restaurant_profiles'
          : 'listing_shop_profiles';
      const { error } = await supabase
        .from(table)
        .update({ payment_policy: nextPolicy })
        .eq('listing_id', row.listing_id);
      if (error) throw error;
      setMerchants((prev) =>
        prev.map((m) =>
          m.listing_id === row.listing_id
            ? { ...m, paymentPolicy: nextPolicy }
            : m
        )
      );
      setStatus(
        'success',
        `${row.listingTitle} UPI ${
          nextPolicy.shop_upi_verified ? 'verified' : 'unverified'
        }.`
      );
    } catch (err) {
      setStatus(
        'error',
        err instanceof Error ? err.message : 'UPI verification update failed.'
      );
    } finally {
      setBusyKey(null);
    }
  };

  const filteredMerchants = useMemo(() => {
    const q = merchantSearch.trim().toLowerCase();
    return merchants.filter((m) => {
      if (
        merchantVerticalFilter !== 'all' &&
        m.vertical !== merchantVerticalFilter
      ) {
        return false;
      }
      if (!q) return true;
      return (
        m.listingTitle.toLowerCase().includes(q) ||
        m.listingLocality.toLowerCase().includes(q) ||
        (m.fssaiLicenseNo || '').toLowerCase().includes(q) ||
        (m.paymentPolicy.shop_upi_id || '').toLowerCase().includes(q)
      );
    });
  }, [merchants, merchantSearch, merchantVerticalFilter]);

  const filteredOrders = useMemo(() => {
    const q = orderSearch.trim().toLowerCase();
    return orders.filter((o) => {
      if (orderKindFilter !== 'all' && o.kind !== orderKindFilter) return false;
      if (!q) return true;
      return (
        o.order_code.toLowerCase().includes(q) ||
        o.listingTitle.toLowerCase().includes(q) ||
        o.status.toLowerCase().includes(q)
      );
    });
  }, [orders, orderSearch, orderKindFilter]);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-base font-bold text-[var(--ps-text)]">
            Shops &amp; Food Governance — {hubName}
          </h2>
          <p className="text-xs text-[var(--ps-text-muted)]">
            Verify local storefronts, FSSAI licenses, and merchant UPI handles, and monitor live hub commerce orders.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadData()}
          className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 text-xs font-semibold text-[var(--ps-text)] cursor-pointer"
        >
          <RefreshCw
            className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`}
          />
          <span>Refresh</span>
        </button>
      </div>

      {/* 1. Local Store & FSSAI Verification Table */}
      <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3">
        <div className="flex items-center gap-2">
          <ShieldCheck className="h-4 w-4 text-emerald-600" />
          <h3 className="text-sm font-bold text-[var(--ps-text)]">
            Local Store, FSSAI &amp; UPI Verification ({merchants.length})
          </h3>
        </div>

        <WorkspaceTableToolbar
          searchQuery={merchantSearch}
          onSearchChange={setMerchantSearch}
          searchPlaceholder="Search shop, kitchen, FSSAI or UPI…"
          totalCount={merchants.length}
          filteredCount={filteredMerchants.length}
          hasActiveFilters={
            Boolean(merchantSearch) || merchantVerticalFilter !== 'all'
          }
          onResetFilters={() => {
            setMerchantSearch('');
            setMerchantVerticalFilter('all');
          }}
        >
          <div className="flex items-center gap-1">
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'shop_catalogue', label: 'Shops' },
                { id: 'restaurant_food', label: 'Food & Cafés' },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setMerchantVerticalFilter(f.id)}
                className={`h-8 rounded-xl px-2.5 text-xs font-semibold cursor-pointer ${
                  merchantVerticalFilter === f.id
                    ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                    : 'border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)]'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </WorkspaceTableToolbar>

        <ResponsiveTableScroll>
          <table className="w-full min-w-[720px] text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--ps-border)] text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                <th className="py-2 pr-3">Merchant</th>
                <th className="py-2 pr-3">Type</th>
                <th className="py-2 pr-3">FSSAI / Store Check</th>
                <th className="py-2 pr-3">Merchant UPI</th>
                <th className="py-2 text-right">UPI Verification</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--ps-border)]/60">
              {filteredMerchants.length === 0 ? (
                <tr>
                  <td
                    colSpan={5}
                    className="py-8 text-center text-xs text-[var(--ps-text-muted)]"
                  >
                    No shops or restaurants found in {hubName}.
                  </td>
                </tr>
              ) : (
                filteredMerchants.map((row) => {
                  const isRest = row.vertical === 'restaurant_food';
                  return (
                    <tr key={row.listing_id}>
                      <td className="py-2.5 pr-3">
                        <p className="font-bold text-[var(--ps-text)]">
                          {row.listingTitle}
                        </p>
                        <p className="text-[10px] text-[var(--ps-text-muted)]">
                          {row.listingLocality}
                        </p>
                      </td>
                      <td className="py-2.5 pr-3">
                        <span
                          className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-[10px] font-bold ${
                            isRest
                              ? 'bg-orange-500/12 text-orange-700 dark:text-orange-300'
                              : 'bg-sky-500/12 text-sky-700 dark:text-sky-300'
                          }`}
                        >
                          {isRest ? (
                            <UtensilsCrossed className="h-3 w-3" />
                          ) : (
                            <Store className="h-3 w-3" />
                          )}
                          <span>{isRest ? 'Restaurant' : 'Shop'}</span>
                        </span>
                      </td>
                      <td className="py-2.5 pr-3">
                        <div className="flex flex-col gap-1">
                          {isRest && (
                            <span className="font-mono text-[10px] text-[var(--ps-text-muted)]">
                              FSSAI: {row.fssaiLicenseNo || 'Not provided'}
                            </span>
                          )}
                          <button
                            type="button"
                            disabled={busyKey === `${row.listing_id}:primary`}
                            onClick={() =>
                              void handleTogglePrimaryVerification(row)
                            }
                            className={`inline-flex h-7 w-fit items-center gap-1 rounded-lg px-2.5 text-[11px] font-bold cursor-pointer ${
                              row.primaryVerified
                                ? 'border border-emerald-500/35 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                                : 'border border-amber-500/35 bg-amber-500/10 text-amber-800 dark:text-amber-300'
                            }`}
                          >
                            {busyKey === `${row.listing_id}:primary` ? (
                              <Loader2 className="h-3 w-3 animate-spin" />
                            ) : (
                              <BadgeCheck className="h-3 w-3" />
                            )}
                            <span>
                              {row.primaryVerified
                                ? isRest
                                  ? 'FSSAI Verified ✓'
                                  : 'Store Verified ✓'
                                : isRest
                                  ? 'Verify FSSAI'
                                  : 'Verify Store'}
                            </span>
                          </button>
                        </div>
                      </td>
                      <td className="py-2.5 pr-3">
                        <p className="font-mono text-[11px] text-[var(--ps-text)]">
                          {row.paymentPolicy.shop_upi_id || '—'}
                        </p>
                        {row.paymentPolicy.shop_upi_name && (
                          <p className="text-[10px] text-[var(--ps-text-muted)]">
                            {row.paymentPolicy.shop_upi_name}
                          </p>
                        )}
                      </td>
                      <td className="py-2.5 text-right">
                        <button
                          type="button"
                          disabled={
                            !row.paymentPolicy.shop_upi_id ||
                            busyKey === `${row.listing_id}:upi`
                          }
                          onClick={() => void handleToggleUpiVerification(row)}
                          className={`inline-flex h-7 items-center gap-1 rounded-lg px-2.5 text-[11px] font-bold cursor-pointer disabled:opacity-40 ${
                            row.paymentPolicy.shop_upi_verified
                              ? 'border border-emerald-500/35 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                              : 'border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)]'
                          }`}
                        >
                          <CheckCircle2 className="h-3 w-3" />
                          <span>
                            {row.paymentPolicy.shop_upi_verified
                              ? 'UPI Verified ✓'
                              : 'Verify UPI'}
                          </span>
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

      {/* 2. Hub Commerce Orders Monitor (Read-Only) */}
      <section className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3">
        <div className="flex items-center gap-2">
          <ShoppingBag className="h-4 w-4 text-[var(--ps-accent)]" />
          <h3 className="text-sm font-bold text-[var(--ps-text)]">
            Hub Commerce Orders Monitor — Read-Only ({orders.length})
          </h3>
        </div>

        <WorkspaceTableToolbar
          searchQuery={orderSearch}
          onSearchChange={setOrderSearch}
          searchPlaceholder="Search order code, merchant or status…"
          totalCount={orders.length}
          filteredCount={filteredOrders.length}
          hasActiveFilters={Boolean(orderSearch) || orderKindFilter !== 'all'}
          onResetFilters={() => {
            setOrderSearch('');
            setOrderKindFilter('all');
          }}
        >
          <div className="flex items-center gap-1">
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'food', label: 'Food Orders' },
                { id: 'shop', label: 'Shop Orders' },
              ] as const
            ).map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => setOrderKindFilter(f.id)}
                className={`h-8 rounded-xl px-2.5 text-xs font-semibold cursor-pointer ${
                  orderKindFilter === f.id
                    ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                    : 'border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)]'
                }`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </WorkspaceTableToolbar>

        <ResponsiveTableScroll>
          <table className="w-full min-w-[680px] text-left text-xs">
            <thead>
              <tr className="border-b border-[var(--ps-border)] text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                <th className="py-2 pr-3">Order Code</th>
                <th className="py-2 pr-3">Merchant</th>
                <th className="py-2 pr-3">Mode</th>
                <th className="py-2 pr-3">Amount</th>
                <th className="py-2 pr-3">Order Status</th>
                <th className="py-2">Payment</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--ps-border)]/60">
              {filteredOrders.length === 0 ? (
                <tr>
                  <td
                    colSpan={6}
                    className="py-8 text-center text-xs text-[var(--ps-text-muted)]"
                  >
                    No commerce orders recorded in {hubName} yet.
                  </td>
                </tr>
              ) : (
                filteredOrders.map((o) => (
                  <tr key={`${o.kind}-${o.id}`}>
                    <td className="py-2.5 pr-3 font-mono font-bold text-[var(--ps-text)]">
                      {o.order_code}
                    </td>
                    <td className="py-2.5 pr-3">
                      <span
                        className={`mr-1.5 inline-block rounded px-1.5 py-0.5 text-[9px] font-bold uppercase ${
                          o.kind === 'food'
                            ? 'bg-orange-500/15 text-orange-700 dark:text-orange-300'
                            : 'bg-sky-500/15 text-sky-700 dark:text-sky-300'
                        }`}
                      >
                        {o.kind}
                      </span>
                      <span className="font-semibold text-[var(--ps-text)]">
                        {o.listingTitle}
                      </span>
                    </td>
                    <td className="py-2.5 pr-3 text-[var(--ps-text-muted)]">
                      {o.mode}
                    </td>
                    <td className="py-2.5 pr-3 font-mono font-bold">
                      ₹{Math.round(o.total_amount_inr).toLocaleString('en-IN')}
                    </td>
                    <td className="py-2.5 pr-3 capitalize">
                      {o.status.replace(/_/g, ' ')}
                    </td>
                    <td className="py-2.5 capitalize text-[var(--ps-text-muted)]">
                      {o.payment_status.replace(/_/g, ' ')}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </ResponsiveTableScroll>
      </section>
    </div>
  );
}
