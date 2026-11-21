'use client';

import React, { useCallback, useEffect, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  ClipboardCheck,
  Landmark,
  Loader2,
  Power,
  RefreshCw,
  ShieldCheck,
  Truck,
} from 'lucide-react';
import { setAppStatus } from '@/lib/hooks/useAppStatus';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import type { OperationsConfig } from '@/lib/config/types';

type HubTabKey =
  | 'overview'
  | 'listings'
  | 'shops_food'
  | 'real_estate'
  | 'bookings_stays'
  | 'print_digital'
  | 'public_civic'
  | 'localities'
  | 'fleet'
  | 'bulletins'
  | 'payments';

const NINE_MODULE_SWITCHES: Array<{
  key: keyof OperationsConfig['module_switches'];
  label: string;
}> = [
  { key: 'print_orders', label: 'Print & Digital' },
  { key: 'booking_venues', label: 'Turfs & Halls' },
  { key: 'hotel_stays', label: 'Hotels & Stays' },
  { key: 'shop_orders', label: 'Shop Orders' },
  { key: 'food_orders', label: 'Food & Cafés' },
  { key: 'real_estate', label: 'Real Estate' },
  { key: 'pick_n_drop', label: 'Pick N Drop' },
  { key: 'vehicle_bookings', label: 'Vehicles' },
  { key: 'bulletin', label: 'Bulletin' },
];

export interface HubCommandOverviewCardProps {
  hubId: string;
  hubName: string;
  moduleSwitches?: Partial<
    Record<string, boolean | { enabled?: boolean } | undefined>
  >;
  onSelectTab: (tab: HubTabKey) => void;
  onToggleModuleSwitch?: (
    key: keyof OperationsConfig['module_switches'],
    nextEnabled: boolean
  ) => Promise<void> | void;
}

export function HubCommandOverviewCard({
  hubId,
  hubName,
  moduleSwitches,
  onSelectTab,
  onToggleModuleSwitch,
}: HubCommandOverviewCardProps) {
  const [counts, setCounts] = useState({
    pendingListings: 0,
    pendingVerifications: 0,
    pendingCivicCorrections: 0,
    activeDeliveries: 0,
    drainingArchived: 0,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [togglingKey, setTogglingKey] = useState<string | null>(null);

  const loadCounts = useCallback(async () => {
    if (!hubId || !isSupabaseConfigured()) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const [
        pendingListRes,
        civicCorrRes,
        activeDelivRes,
        drainingRes,
        pattaPendingRes,
      ] = await Promise.allSettled([
        supabase
          .from('listings')
          .select('id', { count: 'exact', head: true })
          .eq('hub_id', hubId)
          .eq('status', 'pending_review'),
        supabase
          .from('civic_correction_reports')
          .select('id', { count: 'exact', head: true })
          .eq('hub_id', hubId)
          .eq('status', 'open'),
        supabase
          .from('delivery_orders')
          .select('id', { count: 'exact', head: true })
          .eq('hub_id', hubId)
          .in('status', [
            'pending',
            'payment_submitted',
            'driver_assigned',
            'picked_up',
            'in_transit',
          ]),
        supabase
          .from('listings')
          .select('id', { count: 'exact', head: true })
          .eq('hub_id', hubId)
          .in('lifecycle_status', [
            'draining',
            'archived_by_owner',
            'custody_admin',
          ]),
        supabase
          .from('listing_real_estate_profiles')
          .select('listing_id', { count: 'exact', head: true })
          .eq('hub_id', hubId)
          .eq('patta_verified', false),
      ]);

      setCounts({
        pendingListings:
          pendingListRes.status === 'fulfilled'
            ? (pendingListRes.value.count ?? 0)
            : 0,
        pendingVerifications:
          pattaPendingRes.status === 'fulfilled'
            ? (pattaPendingRes.value.count ?? 0)
            : 0,
        pendingCivicCorrections:
          civicCorrRes.status === 'fulfilled'
            ? (civicCorrRes.value.count ?? 0)
            : 0,
        activeDeliveries:
          activeDelivRes.status === 'fulfilled'
            ? (activeDelivRes.value.count ?? 0)
            : 0,
        drainingArchived:
          drainingRes.status === 'fulfilled'
            ? (drainingRes.value.count ?? 0)
            : 0,
      });
    } catch {
      // Non-blocking
    } finally {
      setIsLoading(false);
    }
  }, [hubId]);

  useEffect(() => {
    void loadCounts();
  }, [loadCounts]);

  const kpiCards: Array<{
    id: string;
    label: string;
    value: number;
    tab: HubTabKey;
    icon: typeof ClipboardCheck;
    tone: string;
  }> = [
    {
      id: 'pending_listings',
      label: 'Pending Listing Approvals',
      value: counts.pendingListings,
      tab: 'listings',
      icon: ClipboardCheck,
      tone: 'text-sky-600 dark:text-sky-400',
    },
    {
      id: 'pending_verifications',
      label: 'Pending Verifications',
      value: counts.pendingVerifications,
      tab: 'real_estate',
      icon: ShieldCheck,
      tone: 'text-violet-600 dark:text-violet-400',
    },
    {
      id: 'pending_civic',
      label: 'Pending Civic Corrections',
      value: counts.pendingCivicCorrections,
      tab: 'public_civic',
      icon: Landmark,
      tone: 'text-rose-600 dark:text-rose-400',
    },
    {
      id: 'active_deliveries',
      label: 'Active Pick N Drop',
      value: counts.activeDeliveries,
      tab: 'fleet',
      icon: Truck,
      tone: 'text-amber-600 dark:text-amber-400',
    },
    {
      id: 'draining_archived',
      label: 'Draining / Archived',
      value: counts.drainingArchived,
      tab: 'listings',
      icon: Archive,
      tone: 'text-slate-600 dark:text-slate-300',
    },
  ];

  const isSwitchOn = (key: string): boolean => {
    if (!moduleSwitches) return true;
    const raw = moduleSwitches[key];
    if (raw === false) return false;
    if (raw && typeof raw === 'object' && raw.enabled === false) return false;
    return true;
  };

  return (
    <section
      data-testid="hub-command-overview-card"
      className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-4 text-xs"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-[var(--ps-text)]">
            {hubName} Hub Command Overview
          </h3>
          <p className="text-[11px] text-[var(--ps-text-muted)]">
            Live pending queues for this hub — click any KPI card to jump straight to that desk.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadCounts()}
          className="h-8 px-2.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] font-semibold inline-flex items-center gap-1 cursor-pointer"
        >
          <RefreshCw
            className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`}
          />
          <span>Refresh KPIs</span>
        </button>
      </div>

      {/* 5 Clickable KPI Cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2.5">
        {kpiCards.map((card) => {
          const Icon = card.icon;
          return (
            <button
              key={card.id}
              type="button"
              data-testid={`hub-kpi-${card.id}`}
              onClick={() => onSelectTab(card.tab)}
              className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] hover:border-[var(--ps-accent)] p-3 text-left transition-colors cursor-pointer space-y-1.5"
            >
              <div className="flex items-center justify-between">
                <Icon className={`w-4 h-4 ${card.tone}`} />
                {card.value > 0 && (
                  <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                )}
              </div>
              <div className="text-xl font-extrabold text-[var(--ps-text)] tabular-nums">
                {card.value}
              </div>
              <div className="text-[11px] font-semibold text-[var(--ps-text-muted)] leading-tight">
                {card.label}
              </div>
            </button>
          );
        })}
      </div>

      {/* Compact 9-Switch Hub Module Matrix */}
      <div className="pt-2 border-t border-[var(--ps-border)] space-y-2">
        <div className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)] flex items-center gap-1.5">
          <Power className="w-3 h-3 text-[var(--ps-accent)]" />
          <span>9-Switch Hub Module Matrix</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-2">
          {NINE_MODULE_SWITCHES.map((sw) => {
            const enabled = isSwitchOn(sw.key);
            const busy = togglingKey === sw.key;
            return (
              <button
                key={sw.key}
                type="button"
                disabled={!onToggleModuleSwitch || busy}
                data-testid={`hub-matrix-switch-${sw.key}`}
                onClick={async () => {
                  if (!onToggleModuleSwitch) return;
                  setTogglingKey(sw.key);
                  try {
                    await onToggleModuleSwitch(sw.key, !enabled);
                    setAppStatus(
                      'success',
                      `${sw.label} ${!enabled ? 'enabled' : 'paused'} in ${hubName}.`
                    );
                  } finally {
                    setTogglingKey(null);
                  }
                }}
                className={`h-8 px-2.5 rounded-xl border text-[11px] font-semibold flex items-center justify-between gap-1.5 transition-colors cursor-pointer ${
                  enabled
                    ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
                    : 'border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                }`}
              >
                <span className="truncate">{sw.label}</span>
                {busy ? (
                  <Loader2 className="w-3 h-3 animate-spin shrink-0" />
                ) : (
                  <CheckCircle2
                    className={`w-3.5 h-3.5 shrink-0 ${enabled ? 'opacity-100' : 'opacity-35'}`}
                  />
                )}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}

export default HubCommandOverviewCard;
