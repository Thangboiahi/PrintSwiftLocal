'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useHydrated } from '@/hooks/useHydrated';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertTriangle,
  ArrowUpRight,
  Banknote,
  CheckCircle2,
  Clock,
  ExternalLink,
  HardDrive,
  IndianRupee,
  Loader2,
  Lock,
  Plus,
  Printer,
  RefreshCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useHub } from '@/components/providers/AppConfigProvider';
import {
  CustomSelectModal,
  type CustomSelectOption,
} from '@/components/ui/CustomSelectModal';
import { DDoodleLogo } from '@/components/ui/DDoodleLogo';
import {
  ResponsiveTableScroll,
  WorkspaceTableToolbar,
} from '@/components/ui/ResponsiveTableWrapper';
import { OfficialPrintSwiftManager } from '@/components/workspaces/print/OfficialPrintSwiftManager';
import { setAppStatus } from '@/lib/hooks/useAppStatus';
import type {
  ListingPrintProfile,
  MerchantSettlement,
  PrintCapabilities,
  PrintPaymentPolicy,
  PrintRateCard,
} from '@/lib/print-orders/types';
import { useAuth } from '@/lib/store';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import type { MasterControlTabSharedProps } from './PaymentsGatewayTab';

interface ListingLite {
  id: string;
  title: string;
  locality: string | null;
  hub_id: string | null;
  status?: string | null;
}

interface OfficialProfileRow extends ListingPrintProfile {
  listing_title: string;
  listing_locality: string | null;
}

type SettlementSource =
  | 'print_order'
  | 'resource_booking'
  | 'shop_order'
  | 'restaurant_order';

interface SettlementDisplayRow extends MerchantSettlement {
  settlement_source: SettlementSource;
  resource_booking_id: string | null;
  shop_order_id: string | null;
  restaurant_order_id: string | null;
  order_code: string;
  listing_title: string;
  hub_name: string;
}

type SettlementSourceFilter = 'all' | SettlementSource;

interface VaultPurgeStats {
  ok: boolean;
  active_files_count: number;
  scheduled_files_count: number;
  scheduled_orders_count: number;
  overdue_purge_orders_count: number;
  overdue_purge_files_count: number;
  permanently_purged_files_count: number;
  permanently_purged_orders_count: number;
  checked_at: string;
}

interface PurgeRunResult {
  ok: boolean;
  purged_orders_count: number;
  purged_files_count: number;
  checked_at: string;
  error?: string;
}

const DEFAULT_PRINTSWIFT_CAPABILITIES: PrintCapabilities = {
  bw_a4: true,
  color_a4: true,
  duplex: true,
  a3_large: false,
  spiral_binding: true,
  lamination: true,
  custom_digital_jobs: true,
  sealed_envelope: true,
};

const DEFAULT_PRINTSWIFT_RATE_CARD: PrintRateCard = {
  bw_a4_single_inr: 3,
  bw_a4_duplex_inr: 5,
  color_a4_single_inr: 12,
  color_a4_duplex_inr: 20,
  spiral_binding_inr: 40,
  lamination_per_sheet_inr: 25,
  staple_inr: 5,
  sealed_envelope_inr: 10,
  min_order_inr: 15,
  platform_fee_inr: 0,
  bulk_discounts: [],
};

const DEFAULT_PRINTSWIFT_PAYMENT_POLICY: PrintPaymentPolicy = {
  allow_direct_pay: false,
  direct_pay_max_inr: 0,
  allow_escrow: true,
  shop_upi_id: null,
  shop_upi_name: null,
  shop_upi_verified: false,
};

const SETTLEMENT_STATUS_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'locked', label: 'Locked' },
  { id: 'eligible', label: 'Eligible' },
  { id: 'settled', label: 'Settled' },
  { id: 'reversed', label: 'Reversed' },
] as const;

type SettlementStatusFilter = (typeof SETTLEMENT_STATUS_FILTERS)[number]['id'];

function formatInr(amount: number): string {
  return `₹${Math.round(Number(amount || 0)).toLocaleString('en-IN')}`;
}

function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function settlementStatusBadgeClass(status: string): string {
  switch (status) {
    case 'settled':
      return 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/60';
    case 'eligible':
      return 'bg-sky-50 text-sky-700 border-sky-200 dark:bg-sky-950/40 dark:text-sky-300 dark:border-sky-800/60';
    case 'locked':
      return 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-800/60';
    case 'reversed':
      return 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-rose-950/40 dark:text-rose-300 dark:border-rose-800/60';
    default:
      return 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700';
  }
}

export function PrintAndSettlementsTab({
  onNotify,
  refreshGlobalConfig,
}: MasterControlTabSharedProps) {
  const isHydrated = useHydrated();
  const { user } = useAuth();
  const { hubs, activeHub } = useHub();

  const [isLoading, setIsLoading] = useState(true);
  const [nowMs, setNowMs] = useState<number>(0);

  useEffect(() => {
    queueMicrotask(() => setNowMs(Date.now()));
  }, []);

  // Card 1: Official First-Party PrintSwift Control
  const [officialProfiles, setOfficialProfiles] = useState<
    OfficialProfileRow[]
  >([]);
  const [allListings, setAllListings] = useState<ListingLite[]>([]);
  const [designateHubId, setDesignateHubId] = useState<string>(
    activeHub?.id || ''
  );
  const [designateListingId, setDesignateListingId] = useState<string>('');
  const [savingProfileId, setSavingProfileId] = useState<string | null>(null);
  const [isDesignating, setIsDesignating] = useState(false);

  // Card 2: Merchant Escrow Settlements Queue
  const [settlements, setSettlements] = useState<SettlementDisplayRow[]>([]);
  const [settlementSearch, setSettlementSearch] = useState('');
  const [settlementHubFilter, setSettlementHubFilter] = useState<string>('all');
  const [settlementStatusFilter, setSettlementStatusFilter] =
    useState<SettlementStatusFilter>('all');
  const [settlementSourceFilter, setSettlementSourceFilter] =
    useState<SettlementSourceFilter>('all');
  const [settlingTarget, setSettlingTarget] =
    useState<SettlementDisplayRow | null>(null);
  const [payoutRefInput, setPayoutRefInput] = useState('');
  const [isMarkingSettled, setIsMarkingSettled] = useState(false);

  // Card 3: Document Vault Auto-Purge Console
  const [vaultStats, setVaultStats] = useState<VaultPurgeStats | null>(null);
  const [vaultError, setVaultError] = useState<string | null>(null);
  const [isLoadingVault, setIsLoadingVault] = useState(false);
  const [isRunningPurge, setIsRunningPurge] = useState(false);
  const [lastPurgeResult, setLastPurgeResult] = useState<PurgeRunResult | null>(
    null
  );

  const hubNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const h of hubs) {
      map.set(h.id, h.name);
    }
    return map;
  }, [hubs]);

  const fetchVaultStats = useCallback(async () => {
    if (!isSupabaseConfigured) return;
    setIsLoadingVault(true);
    setVaultError(null);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        setVaultError('Sign in as Super-Admin to inspect vault stats.');
        return;
      }
      const res = await fetch('/api/print-orders/purge-expired?stats=1', {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const json = (await res.json()) as VaultPurgeStats & { error?: string };
      if (!res.ok || !json.ok) {
        setVaultError(json.error || 'Failed to load vault purge statistics.');
        setVaultStats(null);
        return;
      }
      setVaultStats(json);
    } catch (err) {
      setVaultError(
        err instanceof Error ? err.message : 'Unable to reach purge endpoint.'
      );
      setVaultStats(null);
    } finally {
      setIsLoadingVault(false);
    }
  }, []);

  const loadAll = useCallback(async () => {
    if (!isSupabaseConfigured) {
      setIsLoading(false);
      return;
    }
    setIsLoading(true);
    try {
      const [profilesRes, listingsRes, settlementsRes] = await Promise.all([
        supabase
          .from('listing_print_profiles')
          .select('*')
          .eq('is_first_party_printswift', true)
          .order('updated_at', { ascending: false }),
        supabase
          .from('listings')
          .select('id, title, locality, hub_id, status')
          .order('title', { ascending: true })
          .limit(300),
        supabase
          .from('merchant_settlements')
          .select('*')
          .order('created_at', { ascending: false })
          .limit(250),
      ]);

      const listingsData = (listingsRes.data || []) as ListingLite[];
      setAllListings(listingsData);

      const listingMap = new Map<string, ListingLite>();
      for (const l of listingsData) {
        listingMap.set(l.id, l);
      }

      const rawProfiles = (profilesRes.data || []) as ListingPrintProfile[];
      const mappedProfiles: OfficialProfileRow[] = rawProfiles.map((p) => {
        const listing = listingMap.get(p.listing_id);
        return {
          ...p,
          listing_title: listing?.title || `Listing ${p.listing_id.slice(0, 8)}`,
          listing_locality: listing?.locality || null,
        };
      });
      setOfficialProfiles(mappedProfiles);

      const rawSettlements = (settlementsRes.data || []) as Array<
        MerchantSettlement & {
          settlement_source?: string | null;
          resource_booking_id?: string | null;
          shop_order_id?: string | null;
          restaurant_order_id?: string | null;
        }
      >;
      const orderIds = Array.from(
        new Set(rawSettlements.map((s) => s.print_order_id).filter(Boolean))
      );
      const bookingIds = Array.from(
        new Set(
          rawSettlements
            .map((s) => s.resource_booking_id)
            .filter((id): id is string => Boolean(id))
        )
      );
      const shopOrderIds = Array.from(
        new Set(
          rawSettlements
            .map((s) => s.shop_order_id)
            .filter((id): id is string => Boolean(id))
        )
      );
      const restaurantOrderIds = Array.from(
        new Set(
          rawSettlements
            .map((s) => s.restaurant_order_id)
            .filter((id): id is string => Boolean(id))
        )
      );

      const orderCodeMap = new Map<string, string>();
      const bookingCodeMap = new Map<string, string>();
      const shopCodeMap = new Map<string, string>();
      const foodCodeMap = new Map<string, string>();

      await Promise.all([
        orderIds.length > 0
          ? supabase
              .from('print_orders')
              .select('id, order_code')
              .in('id', orderIds)
              .then(({ data }) => {
                for (const r of data || []) {
                  orderCodeMap.set(String(r.id), String(r.order_code || ''));
                }
              })
          : Promise.resolve(),
        bookingIds.length > 0
          ? supabase
              .from('resource_bookings')
              .select('id, booking_code')
              .in('id', bookingIds)
              .then(({ data }) => {
                for (const r of data || []) {
                  bookingCodeMap.set(
                    String(r.id),
                    String(r.booking_code || '')
                  );
                }
              })
          : Promise.resolve(),
        shopOrderIds.length > 0
          ? supabase
              .from('shop_orders')
              .select('id, order_code')
              .in('id', shopOrderIds)
              .then(({ data }) => {
                for (const r of data || []) {
                  shopCodeMap.set(String(r.id), String(r.order_code || ''));
                }
              })
          : Promise.resolve(),
        restaurantOrderIds.length > 0
          ? supabase
              .from('restaurant_orders')
              .select('id, order_code')
              .in('id', restaurantOrderIds)
              .then(({ data }) => {
                for (const r of data || []) {
                  foodCodeMap.set(String(r.id), String(r.order_code || ''));
                }
              })
          : Promise.resolve(),
      ]);

      const mappedSettlements: SettlementDisplayRow[] = rawSettlements.map(
        (s) => {
          const bookingId = s.resource_booking_id
            ? String(s.resource_booking_id)
            : null;
          const shopOrderId = s.shop_order_id ? String(s.shop_order_id) : null;
          const restaurantOrderId = s.restaurant_order_id
            ? String(s.restaurant_order_id)
            : null;

          let source: SettlementSource = 'print_order';
          if (
            s.settlement_source === 'restaurant_order' ||
            Boolean(restaurantOrderId)
          ) {
            source = 'restaurant_order';
          } else if (
            s.settlement_source === 'shop_order' ||
            Boolean(shopOrderId)
          ) {
            source = 'shop_order';
          } else if (
            s.settlement_source === 'resource_booking' ||
            Boolean(bookingId)
          ) {
            source = 'resource_booking';
          }

          const resolvedCode =
            source === 'restaurant_order'
              ? (restaurantOrderId && foodCodeMap.get(restaurantOrderId)) ||
                `FD-${(restaurantOrderId || s.id).slice(0, 6).toUpperCase()}`
              : source === 'shop_order'
                ? (shopOrderId && shopCodeMap.get(shopOrderId)) ||
                  `SHP-${(shopOrderId || s.id).slice(0, 6).toUpperCase()}`
                : source === 'resource_booking'
                  ? (bookingId && bookingCodeMap.get(bookingId)) ||
                    `BK-${(bookingId || s.id).slice(0, 6).toUpperCase()}`
                  : (s.print_order_id && orderCodeMap.get(s.print_order_id)) ||
                    `PO-${(s.print_order_id || s.id).slice(0, 6).toUpperCase()}`;

          return {
            ...s,
            settlement_source: source,
            resource_booking_id: bookingId,
            shop_order_id: shopOrderId,
            restaurant_order_id: restaurantOrderId,
            order_code: resolvedCode,
            listing_title:
              listingMap.get(s.listing_id)?.title ||
              `Shop ${s.listing_id.slice(0, 8)}`,
            hub_name: hubNameMap.get(s.hub_id) || 'Hub',
          };
        }
      );
      setSettlements(mappedSettlements);
      setNowMs(Date.now());
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Failed to load Print & Settlements data.';
      onNotify?.({ type: 'error', text: msg });
    } finally {
      setIsLoading(false);
    }
  }, [hubNameMap, onNotify]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadAll();
      void fetchVaultStats();
    });
  }, [loadAll, fetchVaultStats]);

  // Keep default hub selection synced when hubs arrive
  const effectiveDesignateHubId = useMemo(() => {
    if (designateHubId && hubs.some((h) => h.id === designateHubId)) {
      return designateHubId;
    }
    return activeHub?.id || hubs[0]?.id || '';
  }, [designateHubId, hubs, activeHub?.id]);

  const hubOptions = useMemo<CustomSelectOption[]>(
    () =>
      hubs.map((h) => ({
        value: h.id,
        label: h.name,
        description: `${h.status === 'active' ? 'Active Hub' : h.status} • ${h.slug}`,
      })),
    [hubs]
  );

  const candidateListingsForHub = useMemo(() => {
    if (!effectiveDesignateHubId) return allListings;
    return allListings.filter((l) => l.hub_id === effectiveDesignateHubId);
  }, [allListings, effectiveDesignateHubId]);

  const listingOptions = useMemo<CustomSelectOption[]>(
    () =>
      candidateListingsForHub.map((l) => ({
        value: l.id,
        label: l.title,
        description: l.locality || 'No locality specified',
      })),
    [candidateListingsForHub]
  );

  // Card 1 Actions
  const handleDesignateOfficialPrintSwift = async () => {
    if (!effectiveDesignateHubId || !designateListingId) {
      onNotify?.({
        type: 'error',
        text: 'Select both a hub and a listing to designate as Official DD oodle Print.',
      });
      return;
    }

    setIsDesignating(true);
    setAppStatus('saving', 'Designating Official First-Party DD oodle Print...');
    try {
      const { data: existing } = await supabase
        .from('listing_print_profiles')
        .select('*')
        .eq('listing_id', designateListingId)
        .maybeSingle();

      const existingProfile = existing as ListingPrintProfile | null;
      const nowIso = new Date().toISOString();

      const { error } = await supabase.from('listing_print_profiles').upsert(
        {
          listing_id: designateListingId,
          hub_id: effectiveDesignateHubId,
          is_first_party_printswift: true,
          // Safely defaults to Pre-Launch Preview Only until explicitly toggled Live
          is_accepting_orders: false,
          capabilities:
            existingProfile?.capabilities || DEFAULT_PRINTSWIFT_CAPABILITIES,
          verified_capabilities:
            existingProfile?.verified_capabilities &&
            Object.keys(existingProfile.verified_capabilities).length > 0
              ? existingProfile.verified_capabilities
              : DEFAULT_PRINTSWIFT_CAPABILITIES,
          rate_card: existingProfile?.rate_card || DEFAULT_PRINTSWIFT_RATE_CARD,
          payment_policy: {
            ...DEFAULT_PRINTSWIFT_PAYMENT_POLICY,
            allow_direct_pay: false,
            direct_pay_max_inr: 0,
            allow_escrow: true,
          },
          turnaround_badge: existingProfile?.turnaround_badge || 'same_day',
          max_file_size_mb: existingProfile?.max_file_size_mb || 25,
          updated_at: nowIso,
        },
        { onConflict: 'listing_id' }
      );

      if (error) {
        setAppStatus('error', error.message);
        onNotify?.({ type: 'error', text: error.message });
        return;
      }

      setDesignateListingId('');
      await loadAll();
      await refreshGlobalConfig();
      setAppStatus(
        'success',
        'Official DD oodle Print designated (Pre-Launch Preview Only).'
      );
      onNotify?.({
        type: 'success',
        text: 'Listing designated as Official First-Party DD oodle Print in safe Pre-Launch Preview mode.',
      });
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Failed to designate Official DD oodle Print.';
      setAppStatus('error', msg);
      onNotify?.({ type: 'error', text: msg });
    } finally {
      setIsDesignating(false);
    }
  };

  const handleToggleLiveOrdering = async (profile: OfficialProfileRow) => {
    const nextAccepting = !profile.is_accepting_orders;
    setSavingProfileId(profile.listing_id);
    setAppStatus(
      'saving',
      nextAccepting
        ? 'Activating Official DD oodle Print Live Ordering...'
        : 'Switching Official DD oodle Print to Pre-Launch Preview...'
    );
    try {
      const { error } = await supabase
        .from('listing_print_profiles')
        .update({
          is_accepting_orders: nextAccepting,
          busy_until: null,
          updated_at: new Date().toISOString(),
        })
        .eq('listing_id', profile.listing_id);

      if (error) {
        setAppStatus('error', error.message);
        onNotify?.({ type: 'error', text: error.message });
        return;
      }

      setOfficialProfiles((prev) =>
        prev.map((p) =>
          p.listing_id === profile.listing_id
            ? { ...p, is_accepting_orders: nextAccepting, busy_until: null }
            : p
        )
      );
      await refreshGlobalConfig();
      const statusMsg = nextAccepting
        ? `${profile.listing_title} is now accepting Live DD oodle Print orders.`
        : `${profile.listing_title} switched to Pre-Launch Preview Only.`;
      setAppStatus('success', statusMsg);
      onNotify?.({ type: 'success', text: statusMsg });
    } finally {
      setSavingProfileId(null);
    }
  };

  const handleRemoveOfficialFlag = async (profile: OfficialProfileRow) => {
    setSavingProfileId(profile.listing_id);
    setAppStatus('saving', 'Removing Official DD oodle Print designation...');
    try {
      const { error } = await supabase
        .from('listing_print_profiles')
        .update({
          is_first_party_printswift: false,
          is_accepting_orders: false,
          updated_at: new Date().toISOString(),
        })
        .eq('listing_id', profile.listing_id);

      if (error) {
        setAppStatus('error', error.message);
        onNotify?.({ type: 'error', text: error.message });
        return;
      }

      await loadAll();
      await refreshGlobalConfig();
      setAppStatus('success', 'Official DD oodle Print flag removed.');
      onNotify?.({
        type: 'info',
        text: `${profile.listing_title} is no longer marked as Official First-Party DD oodle Print.`,
      });
    } finally {
      setSavingProfileId(null);
    }
  };

  // Card 2 KPIs & Filtering
  const settlementKpis = useMemo(() => {
    const nowDate = new Date(nowMs);
    const curYear = nowDate.getFullYear();
    const curMonth = nowDate.getMonth();

    let lockedTotal = 0;
    let eligibleTotal = 0;
    let settledThisMonth = 0;

    for (const row of settlements) {
      const net = Number(row.net_payable_inr || 0);
      if (row.status === 'locked') {
        lockedTotal += net;
      } else if (row.status === 'eligible') {
        eligibleTotal += net;
      } else if (row.status === 'settled' && row.settled_at) {
        const sd = new Date(row.settled_at);
        if (
          !Number.isNaN(sd.getTime()) &&
          sd.getFullYear() === curYear &&
          sd.getMonth() === curMonth
        ) {
          settledThisMonth += net;
        }
      }
    }

    return { lockedTotal, eligibleTotal, settledThisMonth };
  }, [settlements, nowMs]);

  const filteredSettlements = useMemo(() => {
    const q = settlementSearch.trim().toLowerCase();
    return settlements.filter((row) => {
      if (
        settlementHubFilter !== 'all' &&
        row.hub_id !== settlementHubFilter
      ) {
        return false;
      }
      if (
        settlementStatusFilter !== 'all' &&
        row.status !== settlementStatusFilter
      ) {
        return false;
      }
      if (
        settlementSourceFilter !== 'all' &&
        row.settlement_source !== settlementSourceFilter
      ) {
        return false;
      }
      if (!q) return true;
      return (
        row.order_code.toLowerCase().includes(q) ||
        row.listing_title.toLowerCase().includes(q) ||
        row.hub_name.toLowerCase().includes(q) ||
        (row.payout_reference || '').toLowerCase().includes(q)
      );
    });
  }, [
    settlements,
    settlementHubFilter,
    settlementStatusFilter,
    settlementSourceFilter,
    settlementSearch,
  ]);

  const handleConfirmMarkSettled = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!settlingTarget) return;
    const trimmedRef = payoutRefInput.trim();
    if (trimmedRef.length < 4) {
      onNotify?.({
        type: 'error',
        text: 'Enter a valid Bank UTR / UPI Payout Reference (min 4 characters).',
      });
      return;
    }

    setIsMarkingSettled(true);
    setAppStatus('saving', 'Reconciling merchant settlement...');
    try {
      const nowIso = new Date().toISOString();

      const { error: settleErr } = await supabase
        .from('merchant_settlements')
        .update({
          status: 'settled',
          payout_reference: trimmedRef,
          settled_by: user?.id || null,
          settled_at: nowIso,
          updated_at: nowIso,
        })
        .eq('id', settlingTarget.id)
        .eq('status', 'eligible');

      if (settleErr) {
        setAppStatus('error', settleErr.message);
        onNotify?.({ type: 'error', text: settleErr.message });
        return;
      }

      if (
        settlingTarget.settlement_source === 'resource_booking' &&
        settlingTarget.resource_booking_id
      ) {
        const { error: bookingErr } = await supabase
          .from('resource_bookings')
          .update({
            settlement_status: 'settled',
            updated_at: nowIso,
          })
          .eq('id', settlingTarget.resource_booking_id);

        if (bookingErr) {
          setAppStatus('error', bookingErr.message);
          onNotify?.({
            type: 'error',
            text: `Settlement saved, but booking sync failed: ${bookingErr.message}`,
          });
          return;
        }
      } else if (
        settlingTarget.settlement_source === 'shop_order' &&
        settlingTarget.shop_order_id
      ) {
        const { error: shopErr } = await supabase
          .from('shop_orders')
          .update({
            settlement_status: 'settled',
            updated_at: nowIso,
          })
          .eq('id', settlingTarget.shop_order_id);

        if (shopErr) {
          setAppStatus('error', shopErr.message);
          onNotify?.({
            type: 'error',
            text: `Settlement saved, but shop order sync failed: ${shopErr.message}`,
          });
          return;
        }
      } else if (
        settlingTarget.settlement_source === 'restaurant_order' &&
        settlingTarget.restaurant_order_id
      ) {
        const { error: foodErr } = await supabase
          .from('restaurant_orders')
          .update({
            settlement_status: 'settled',
            updated_at: nowIso,
          })
          .eq('id', settlingTarget.restaurant_order_id);

        if (foodErr) {
          setAppStatus('error', foodErr.message);
          onNotify?.({
            type: 'error',
            text: `Settlement saved, but food order sync failed: ${foodErr.message}`,
          });
          return;
        }
      } else if (settlingTarget.print_order_id) {
        const { error: orderErr } = await supabase
          .from('print_orders')
          .update({
            settlement_status: 'settled',
            updated_at: nowIso,
          })
          .eq('id', settlingTarget.print_order_id);

        if (orderErr) {
          setAppStatus('error', orderErr.message);
          onNotify?.({
            type: 'error',
            text: `Settlement saved, but print order sync failed: ${orderErr.message}`,
          });
          return;
        }

        await supabase.from('print_order_events').insert({
          print_order_id: settlingTarget.print_order_id,
          actor_id: user?.id || null,
          actor_role: 'super_admin',
          event_type: 'settlement_paid',
          metadata: {
            settlement_id: settlingTarget.id,
            payout_reference: trimmedRef,
            net_payable_inr: settlingTarget.net_payable_inr,
            settled_at: nowIso,
          },
        });
      }

      const settledCode = settlingTarget.order_code;
      setSettlingTarget(null);
      setPayoutRefInput('');
      await loadAll();
      setAppStatus('success', `Settlement ${settledCode} marked as Settled.`);
      onNotify?.({
        type: 'success',
        text: `Merchant payout for ${settledCode} recorded (Ref: ${trimmedRef}).`,
      });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to mark settlement.';
      setAppStatus('error', msg);
      onNotify?.({ type: 'error', text: msg });
    } finally {
      setIsMarkingSettled(false);
    }
  };

  // Card 3 Action: Trigger 48h & Abandoned Draft Purge
  const handleRunVaultPurgeNow = async () => {
    setIsRunningPurge(true);
    setAppStatus('saving', 'Running 48h document vault purge...');
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        setAppStatus('error', 'Missing Super-Admin session token.');
        onNotify?.({
          type: 'error',
          text: 'Re-authenticate as Super-Admin to trigger document purge.',
        });
        return;
      }

      const res = await fetch('/api/print-orders/purge-expired', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      const json = (await res.json()) as PurgeRunResult;
      if (!res.ok || !json.ok) {
        const msg = json.error || 'Vault purge failed.';
        setAppStatus('error', msg);
        onNotify?.({ type: 'error', text: msg });
        return;
      }

      setLastPurgeResult(json);
      await fetchVaultStats();
      const msg =
        json.purged_files_count > 0
          ? `Purged ${json.purged_files_count} file(s) across ${json.purged_orders_count} order(s).`
          : 'Vault clean — zero overdue files found.';
      setAppStatus('success', msg);
      onNotify?.({ type: 'success', text: msg });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Vault purge request failed.';
      setAppStatus('error', msg);
      onNotify?.({ type: 'error', text: msg });
    } finally {
      setIsRunningPurge(false);
    }
  };

  const hasActiveSettlementFilters =
    settlementSearch.trim().length > 0 ||
    settlementHubFilter !== 'all' ||
    settlementStatusFilter !== 'all' ||
    settlementSourceFilter !== 'all';

  return (
    <div className="space-y-4 min-w-0 max-w-full">
      {/* Official PrintSwift Hub Editor (Super-Admin Global Governance) */}
      <OfficialPrintSwiftManager
        scope="super_admin"
        hubs={hubs}
        onSaved={() => void loadAll()}
        onNotice={(type, text) => onNotify?.({ type, text })}
      />

      {/* ===================================================================== */}
      {/* CARD 1: OFFICIAL FIRST-PARTY PRINTSWIFT CONTROL                       */}
      {/* ===================================================================== */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-amber-200/80 bg-amber-50/70 dark:border-amber-800/60 dark:bg-amber-950/30">
              <DDoodleLogo variant="mark" size={22} />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Official First-Party DD oodle Print Control
                </h3>
                <span className="inline-flex items-center gap-1 rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide text-amber-700 dark:text-amber-300">
                  <Sparkles className="h-3 w-3" />
                  First-Party
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Designate official DD oodle Print hub profiles, keep
                pre-launch listings safely in Preview mode, and verify readiness
                before enabling live ordering.
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={isLoading}
            onClick={() => {
              void loadAll();
              void fetchVaultStats();
            }}
            className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`}
            />
            Refresh
          </button>
        </div>

        {/* Designate New Official DD oodle Print Listing per Hub */}
        <div className="mt-3 rounded-lg border border-slate-200/80 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/40">
          <div className="mb-2 flex items-center justify-between gap-2">
            <span className="text-[11px] font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">
              Designate Official DD oodle Print Listing
            </span>
            <span className="text-[10px] font-medium text-amber-700 dark:text-amber-400">
              Defaults safely to Pre-Launch Preview Only
            </span>
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-12">
            <div className="sm:col-span-4">
              <CustomSelectModal
                value={effectiveDesignateHubId}
                onChange={(val) => {
                  setDesignateHubId(val);
                  setDesignateListingId('');
                }}
                options={hubOptions}
                placeholder="Select Service Hub"
                label="Select Service Hub"
                className="h-8 text-xs"
              />
            </div>
            <div className="sm:col-span-5">
              <CustomSelectModal
                value={designateListingId}
                onChange={setDesignateListingId}
                options={listingOptions}
                placeholder={
                  listingOptions.length > 0
                    ? 'Select Hub Listing to Designate'
                    : 'No listings in selected hub'
                }
                label="Select Listing for Official DD oodle Print"
                className="h-8 text-xs"
              />
            </div>
            <div className="sm:col-span-3">
              <button
                type="button"
                disabled={isDesignating || !designateListingId}
                onClick={() => void handleDesignateOfficialPrintSwift()}
                className="inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-lg bg-theme-primary px-3 text-xs font-semibold text-theme-primary-foreground shadow-sm transition hover:opacity-95 disabled:opacity-50"
              >
                {isDesignating ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <Plus className="h-3.5 w-3.5" />
                )}
                Designate
              </button>
            </div>
          </div>
        </div>

        {/* Designated Official Profiles List */}
        <div className="mt-3 space-y-2.5">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 rounded-lg border border-dashed border-slate-200 py-6 text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading Official DD oodle Print profiles…
            </div>
          ) : officialProfiles.length === 0 ? (
            <div className="rounded-lg border border-dashed border-slate-200 p-4 text-center dark:border-slate-800">
              <Printer className="mx-auto mb-1.5 h-5 w-5 text-slate-400" />
              <p className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                No Official First-Party DD oodle Print profile designated yet
              </p>
              <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                Select a hub and listing above to provision an Official DD oodle
                Print counter in Pre-Launch Preview mode.
              </p>
            </div>
          ) : (
            officialProfiles.map((profile) => {
              const ratesConfigured =
                Number(profile.rate_card?.bw_a4_single_inr || 0) > 0;
              const otpGateActive = true;
              const escrowRailActive =
                Boolean(profile.payment_policy?.allow_escrow) &&
                !profile.payment_policy?.allow_direct_pay;
              const purgeEndpointReady = Boolean(vaultStats?.ok);
              const allReady =
                ratesConfigured &&
                otpGateActive &&
                escrowRailActive &&
                purgeEndpointReady;
              const isBusy = savingProfileId === profile.listing_id;

              const checklist = [
                {
                  label: 'Rates Configured',
                  ok: ratesConfigured,
                  detail: ratesConfigured
                    ? `v${profile.pricing_version} (₹${profile.rate_card?.bw_a4_single_inr}/pg B&W)`
                    : 'Missing B&W base rate',
                },
                {
                  label: 'OTP Gate Active',
                  ok: otpGateActive,
                  detail: 'Phone + 4-digit Collection OTP enforced',
                },
                {
                  label: 'Escrow Rail Active',
                  ok: escrowRailActive,
                  detail: escrowRailActive
                    ? 'Platform Escrow mandatory'
                    : 'Enable Escrow & disable Direct Pay',
                },
                {
                  label: '48h Purge Endpoint Ready',
                  ok: purgeEndpointReady,
                  detail: purgeEndpointReady
                    ? 'Vault health verified'
                    : 'Check purge endpoint',
                },
              ];

              return (
                <div
                  key={profile.listing_id}
                  className="rounded-xl border border-slate-200 bg-slate-50/50 p-3 dark:border-slate-800 dark:bg-slate-950/30"
                >
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="rounded bg-slate-900 px-1.5 py-0.5 text-[10px] font-bold text-white dark:bg-slate-800">
                          {hubNameMap.get(profile.hub_id) || 'Hub'}
                        </span>
                        <h4 className="truncate text-xs font-bold text-slate-900 dark:text-white">
                          {profile.listing_title}
                        </h4>
                        <span
                          className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-bold ${
                            profile.is_accepting_orders
                              ? 'border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-800/60 dark:bg-emerald-950/40 dark:text-emerald-300'
                              : 'border-amber-200 bg-amber-50 text-amber-700 dark:border-amber-800/60 dark:bg-amber-950/40 dark:text-amber-300'
                          }`}
                        >
                          {profile.is_accepting_orders
                            ? 'LIVE ORDERING'
                            : 'PRE-LAUNCH PREVIEW ONLY'}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                        {profile.listing_locality || 'Central Hub'} • Rate v
                        {profile.pricing_version} •{' '}
                        {allReady
                          ? 'All 4 launch checks green'
                          : 'Review launch checklist before going live'}
                      </p>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      <Link
                        href={`/listing/${profile.listing_id}/print`}
                        className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-700 transition hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200 dark:hover:bg-slate-700"
                      >
                        Preview Route
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleToggleLiveOrdering(profile)}
                        className={`inline-flex h-8 items-center gap-1.5 rounded-lg px-3 text-[11px] font-semibold transition disabled:opacity-60 ${
                          profile.is_accepting_orders
                            ? 'border border-amber-300 bg-amber-50 text-amber-800 hover:bg-amber-100 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-300'
                            : 'bg-emerald-600 text-white hover:bg-emerald-700'
                        }`}
                      >
                        {isBusy && (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        )}
                        {profile.is_accepting_orders
                          ? 'Switch to Pre-Launch Preview'
                          : 'Enable Live Ordering'}
                      </button>
                      <button
                        type="button"
                        disabled={isBusy}
                        onClick={() => void handleRemoveOfficialFlag(profile)}
                        title="Remove Official DD oodle Print designation"
                        className="inline-flex h-8 items-center gap-1 rounded-lg border border-rose-200 bg-white px-2 text-[11px] font-semibold text-rose-600 transition hover:bg-rose-50 disabled:opacity-50 dark:border-rose-900/60 dark:bg-slate-900 dark:text-rose-400 dark:hover:bg-rose-950/30"
                      >
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>

                  {/* 4-Item Pre-Launch Readiness Checklist */}
                  <div className="mt-2.5 grid grid-cols-1 gap-1.5 sm:grid-cols-2 lg:grid-cols-4">
                    {checklist.map((item) => (
                      <div
                        key={item.label}
                        className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 ${
                          item.ok
                            ? 'border-emerald-200/70 bg-white dark:border-emerald-900/50 dark:bg-slate-900/70'
                            : 'border-amber-200/80 bg-amber-50/50 dark:border-amber-900/50 dark:bg-amber-950/20'
                        }`}
                      >
                        {item.ok ? (
                          <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
                        ) : (
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-600 dark:text-amber-400" />
                        )}
                        <div className="min-w-0">
                          <div className="text-[11px] font-bold text-slate-800 dark:text-slate-100">
                            {item.label}
                          </div>
                          <div className="truncate text-[10px] text-slate-500 dark:text-slate-400">
                            {item.detail}
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </section>

      {/* ===================================================================== */}
      {/* CARD 2: MERCHANT ESCROW SETTLEMENTS RECONCILIATION QUEUE              */}
      {/* ===================================================================== */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 min-w-0 max-w-full">
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400">
              <Banknote className="h-4.5 w-4.5" />
            </div>
            <div>
              <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                Merchant Escrow Settlements Queue
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Reconcile OTP-verified print shop escrow payouts across hubs and
                record bank/UPI UTR settlement references.
              </p>
            </div>
          </div>
        </div>

        {/* Summary KPI Strip */}
        <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-3">
          <div className="rounded-lg border border-amber-200/70 bg-amber-50/50 px-3 py-2.5 dark:border-amber-900/50 dark:bg-amber-950/20">
            <div className="flex items-center justify-between text-[11px] font-semibold text-amber-700 dark:text-amber-300">
              <span>Total Escrow Locked</span>
              <Lock className="h-3.5 w-3.5" />
            </div>
            <div className="mt-1 text-lg font-extrabold text-slate-900 dark:text-white">
              {formatInr(settlementKpis.lockedTotal)}
            </div>
          </div>

          <div className="rounded-lg border border-sky-200/70 bg-sky-50/50 px-3 py-2.5 dark:border-sky-900/50 dark:bg-sky-950/20">
            <div className="flex items-center justify-between text-[11px] font-semibold text-sky-700 dark:text-sky-300">
              <span>Ready to Settle</span>
              <IndianRupee className="h-3.5 w-3.5" />
            </div>
            <div className="mt-1 text-lg font-extrabold text-slate-900 dark:text-white">
              {formatInr(settlementKpis.eligibleTotal)}
            </div>
          </div>

          <div className="rounded-lg border border-emerald-200/70 bg-emerald-50/50 px-3 py-2.5 dark:border-emerald-900/50 dark:bg-emerald-950/20">
            <div className="flex items-center justify-between text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
              <span>Settled This Month</span>
              <CheckCircle2 className="h-3.5 w-3.5" />
            </div>
            <div className="mt-1 text-lg font-extrabold text-slate-900 dark:text-white">
              {formatInr(settlementKpis.settledThisMonth)}
            </div>
          </div>
        </div>

        {/* Search + Hub Filter + Status Filter */}
        <div className="mt-3 space-y-2">
          <WorkspaceTableToolbar
            searchQuery={settlementSearch}
            onSearchChange={setSettlementSearch}
            searchPlaceholder="Search order code, shop name, or UTR reference…"
            filteredCount={filteredSettlements.length}
            totalCount={settlements.length}
            countLabel="settlements"
            hasActiveFilters={hasActiveSettlementFilters}
            onResetFilters={() => {
              setSettlementSearch('');
              setSettlementHubFilter('all');
              setSettlementStatusFilter('all');
              setSettlementSourceFilter('all');
            }}
          >
            <div className="flex flex-wrap items-center gap-1.5">
              {(
                [
                  { id: 'all', label: 'All Sources' },
                  { id: 'print_order', label: 'Print Orders' },
                  { id: 'resource_booking', label: 'Bookings & Stays' },
                  { id: 'shop_order', label: 'Shop Orders' },
                  { id: 'restaurant_order', label: 'Food Orders' },
                ] as const
              ).map((src) => {
                const active = settlementSourceFilter === src.id;
                return (
                  <button
                    key={src.id}
                    type="button"
                    onClick={() => setSettlementSourceFilter(src.id)}
                    className={`h-7 rounded-md px-2.5 text-[11px] font-semibold transition ${
                      active
                        ? 'bg-emerald-600 text-white'
                        : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                  >
                    {src.label}
                  </button>
                );
              })}
              {SETTLEMENT_STATUS_FILTERS.map((st) => {
                const active = settlementStatusFilter === st.id;
                return (
                  <button
                    key={st.id}
                    type="button"
                    onClick={() => setSettlementStatusFilter(st.id)}
                    className={`h-7 rounded-md px-2.5 text-[11px] font-semibold transition ${
                      active
                        ? 'bg-slate-900 text-white dark:bg-sky-600'
                        : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-300'
                    }`}
                  >
                    {st.label}
                  </button>
                );
              })}
            </div>
          </WorkspaceTableToolbar>

          {/* Hub Filter Strip */}
          <div className="no-scrollbar flex items-center gap-1.5 overflow-x-auto pb-0.5">
            <button
              type="button"
              onClick={() => setSettlementHubFilter('all')}
              className={`h-7 shrink-0 rounded-md px-2.5 text-[11px] font-semibold transition ${
                settlementHubFilter === 'all'
                  ? 'bg-theme-primary text-theme-primary-foreground'
                  : 'border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300'
              }`}
            >
              All Hubs
            </button>
            {hubs.map((hub) => {
              const active = settlementHubFilter === hub.id;
              return (
                <button
                  key={hub.id}
                  type="button"
                  onClick={() => setSettlementHubFilter(hub.id)}
                  className={`h-7 shrink-0 rounded-md px-2.5 text-[11px] font-semibold transition ${
                    active
                      ? 'bg-theme-primary text-theme-primary-foreground'
                      : 'border border-slate-200 bg-slate-50 text-slate-600 hover:bg-slate-100 dark:border-slate-700 dark:bg-slate-800/70 dark:text-slate-300'
                  }`}
                >
                  {hub.name}
                </button>
              );
            })}
          </div>
        </div>

        {/* Settlements Responsive Table */}
        <div className="mt-2.5">
          <ResponsiveTableScroll minWidthClass="min-w-[760px]">
            <table className="w-full border-collapse text-left text-xs">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50 text-[10px] font-bold uppercase tracking-wider text-slate-500 dark:border-slate-800 dark:bg-slate-950/60 dark:text-slate-400">
                  <th className="px-3 py-2">Order & Shop</th>
                  <th className="px-3 py-2">Hub</th>
                  <th className="px-3 py-2 text-right">Gross</th>
                  <th className="px-3 py-2 text-right">Fee</th>
                  <th className="px-3 py-2 text-right">Net Payable</th>
                  <th className="px-3 py-2">Status</th>
                  <th className="px-3 py-2">Payout Ref / Settled</th>
                  <th className="px-3 py-2 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {isLoading ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-3 py-8 text-center text-xs text-slate-500"
                    >
                      <Loader2 className="mx-auto mb-1.5 h-4 w-4 animate-spin" />
                      Loading merchant escrow settlements…
                    </td>
                  </tr>
                ) : filteredSettlements.length === 0 ? (
                  <tr>
                    <td
                      colSpan={8}
                      className="px-3 py-8 text-center text-xs text-slate-500 dark:text-slate-400"
                    >
                      No merchant settlements match your current filter.
                    </td>
                  </tr>
                ) : (
                  filteredSettlements.map((row) => (
                    <tr
                      key={row.id}
                      className="transition hover:bg-slate-50/80 dark:hover:bg-slate-800/40"
                    >
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-[11px] font-bold text-slate-900 dark:text-white">
                            {row.order_code}
                          </span>
                          <span
                            className={`rounded px-1.5 py-0.5 text-[9px] font-extrabold uppercase ${
                              row.settlement_source === 'resource_booking'
                                ? 'bg-indigo-500/15 text-indigo-800 dark:text-indigo-300'
                                : row.settlement_source === 'shop_order'
                                  ? 'bg-sky-500/15 text-sky-800 dark:text-sky-300'
                                  : row.settlement_source === 'restaurant_order'
                                    ? 'bg-orange-500/15 text-orange-800 dark:text-orange-300'
                                    : 'bg-teal-500/15 text-teal-800 dark:text-teal-300'
                            }`}
                          >
                            {row.settlement_source === 'resource_booking'
                              ? 'Venue/Hotel Booking'
                              : row.settlement_source === 'shop_order'
                                ? 'Shop Order'
                                : row.settlement_source === 'restaurant_order'
                                  ? 'Food Order'
                                  : 'Print Order'}
                          </span>
                        </div>
                        <div className="max-w-[200px] truncate text-[11px] text-slate-500 dark:text-slate-400">
                          {row.listing_title}
                        </div>
                      </td>
                      <td className="px-3 py-2.5">
                        <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                          {row.hub_name}
                        </span>
                      </td>
                      <td className="px-3 py-2.5 text-right font-medium text-slate-700 dark:text-slate-300">
                        {formatInr(row.gross_amount_inr)}
                      </td>
                      <td className="px-3 py-2.5 text-right text-slate-500 dark:text-slate-400">
                        {formatInr(row.platform_fee_inr)}
                      </td>
                      <td className="px-3 py-2.5 text-right font-bold text-slate-900 dark:text-white">
                        {formatInr(row.net_payable_inr)}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className={`inline-flex rounded border px-1.5 py-0.5 text-[10px] font-bold uppercase ${settlementStatusBadgeClass(row.status)}`}
                        >
                          {row.status}
                        </span>
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="font-mono text-[11px] text-slate-700 dark:text-slate-200">
                          {row.payout_reference || '—'}
                        </div>
                        <div className="text-[10px] text-slate-400">
                          {row.settled_at
                            ? formatDateTime(row.settled_at)
                            : formatDateTime(row.created_at)}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {row.status === 'eligible' ? (
                          <button
                            type="button"
                            onClick={() => {
                              setSettlingTarget(row);
                              setPayoutRefInput('');
                            }}
                            className="inline-flex h-7 items-center gap-1 rounded-md bg-emerald-600 px-2.5 text-[11px] font-semibold text-white shadow-sm transition hover:bg-emerald-700"
                          >
                            Mark Settled
                            <ArrowUpRight className="h-3 w-3" />
                          </button>
                        ) : row.status === 'settled' ? (
                          <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-600 dark:text-emerald-400">
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            Paid
                          </span>
                        ) : (
                          <span className="text-[11px] text-slate-400">
                            {row.status === 'locked'
                              ? 'Awaiting OTP'
                              : 'Reversed'}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </ResponsiveTableScroll>
        </div>
      </section>

      {/* ===================================================================== */}
      {/* CARD 3: DOCUMENT VAULT AUTO-PURGE CONSOLE                             */}
      {/* ===================================================================== */}
      <section className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-slate-900/10 text-slate-700 dark:bg-sky-500/15 dark:text-sky-400">
              <HardDrive className="h-4.5 w-4.5" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">
                  Document Vault Auto-Purge Console
                </h3>
                <span className="inline-flex items-center gap-1 rounded border border-emerald-200 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-300">
                  <ShieldCheck className="h-3 w-3" />
                  Zero-PII Aggregate Counts Only
                </span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Monitors private{' '}
                <code className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[10px] dark:bg-slate-800">
                  print-documents
                </code>{' '}
                retention: files auto-delete 48 hours after OTP handover and 24
                hours after abandoned drafts.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={isLoadingVault}
              onClick={() => void fetchVaultStats()}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 text-xs font-semibold text-slate-700 transition hover:bg-slate-100 disabled:opacity-60 dark:border-slate-700 dark:bg-slate-800 dark:text-slate-200"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isLoadingVault ? 'animate-spin' : ''}`}
              />
              Refresh Counts
            </button>
            <button
              type="button"
              disabled={isRunningPurge}
              onClick={() => void handleRunVaultPurgeNow()}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-rose-600 px-3 text-xs font-semibold text-white shadow-sm transition hover:bg-rose-700 disabled:opacity-60"
            >
              {isRunningPurge ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Trash2 className="h-3.5 w-3.5" />
              )}
              Run 48h &amp; Abandoned-Draft Purge Now
            </button>
          </div>
        </div>

        {vaultError && (
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
            <AlertTriangle className="h-4 w-4 shrink-0" />
            <span>{vaultError}</span>
          </div>
        )}

        <div className="mt-3 grid grid-cols-2 gap-2.5 lg:grid-cols-4">
          <div className="rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2.5 dark:border-slate-800 dark:bg-slate-950/40">
            <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              Active Files
            </div>
            <div className="mt-1 text-lg font-extrabold text-slate-900 dark:text-white">
              {vaultStats ? vaultStats.active_files_count : '—'}
            </div>
            <div className="text-[10px] text-slate-400">
              Encrypted in private vault
            </div>
          </div>

          <div className="rounded-lg border border-sky-200/70 bg-sky-50/40 px-3 py-2.5 dark:border-sky-900/50 dark:bg-sky-950/20">
            <div className="flex items-center justify-between text-[11px] font-semibold text-sky-700 dark:text-sky-300">
              <span>Scheduled for 48h Purge</span>
              <Clock className="h-3.5 w-3.5" />
            </div>
            <div className="mt-1 text-lg font-extrabold text-slate-900 dark:text-white">
              {vaultStats ? vaultStats.scheduled_files_count : '—'}
            </div>
            <div className="text-[10px] text-slate-500 dark:text-slate-400">
              {vaultStats
                ? `${vaultStats.scheduled_orders_count} order(s) in window`
                : 'Awaiting stats'}
            </div>
          </div>

          <div
            className={`rounded-lg border px-3 py-2.5 ${
              (vaultStats?.overdue_purge_orders_count || 0) > 0
                ? 'border-amber-300 bg-amber-50/70 dark:border-amber-800/70 dark:bg-amber-950/30'
                : 'border-slate-200 bg-slate-50/70 dark:border-slate-800 dark:bg-slate-950/40'
            }`}
          >
            <div className="flex items-center justify-between text-[11px] font-semibold text-amber-700 dark:text-amber-300">
              <span>Overdue Purge</span>
              <AlertTriangle className="h-3.5 w-3.5" />
            </div>
            <div className="mt-1 text-lg font-extrabold text-slate-900 dark:text-white">
              {vaultStats ? vaultStats.overdue_purge_files_count : '—'}
            </div>
            <div className="text-[10px] text-slate-500 dark:text-slate-400">
              {vaultStats
                ? `${vaultStats.overdue_purge_orders_count} order(s) / stale drafts`
                : 'Awaiting stats'}
            </div>
          </div>

          <div className="rounded-lg border border-emerald-200/70 bg-emerald-50/40 px-3 py-2.5 dark:border-emerald-900/50 dark:bg-emerald-950/20">
            <div className="flex items-center justify-between text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
              <span>Permanently Purged</span>
              <CheckCircle2 className="h-3.5 w-3.5" />
            </div>
            <div className="mt-1 text-lg font-extrabold text-slate-900 dark:text-white">
              {vaultStats ? vaultStats.permanently_purged_files_count : '—'}
            </div>
            <div className="text-[10px] text-slate-500 dark:text-slate-400">
              {vaultStats
                ? `${vaultStats.permanently_purged_orders_count} order(s) wiped`
                : 'Awaiting stats'}
            </div>
          </div>
        </div>

        {lastPurgeResult && (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-emerald-200 bg-emerald-50/70 px-3 py-2 text-xs text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200">
            <div className="flex items-center gap-2 font-semibold">
              <CheckCircle2 className="h-4 w-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
              <span>
                Last Manual Purge: Deleted{' '}
                <strong>{lastPurgeResult.purged_files_count}</strong> vault
                object(s) across{' '}
                <strong>{lastPurgeResult.purged_orders_count}</strong> order(s).
              </span>
            </div>
            <span className="text-[11px] opacity-80">
              {formatDateTime(lastPurgeResult.checked_at)}
            </span>
          </div>
        )}
      </section>

      {/* ===================================================================== */}
      {/* PORTALED MARK SETTLED MODAL (z-[90] — strictly above Assistant z-[60]) */}
      {/* ===================================================================== */}
      {isHydrated &&
        createPortal(
          <AnimatePresence>
            {settlingTarget && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm"
                onClick={() => {
                  if (!isMarkingSettled) setSettlingTarget(null);
                }}
              >
                <motion.div
                  initial={{ opacity: 0, scale: 0.96, y: 8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: 8 }}
                  transition={{ duration: 0.16 }}
                  onClick={(e) => e.stopPropagation()}
                  className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl dark:border-slate-800 dark:bg-slate-900"
                >
                  <div className="flex items-start justify-between gap-2 border-b border-slate-100 pb-3 dark:border-slate-800">
                    <div>
                      <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                        Mark Merchant Settlement Paid
                      </h4>
                      <p className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                        {settlingTarget.order_code} •{' '}
                        {settlingTarget.listing_title}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={isMarkingSettled}
                      onClick={() => setSettlingTarget(null)}
                      className="rounded-lg p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <form
                    onSubmit={(e) => void handleConfirmMarkSettled(e)}
                    className="mt-3 space-y-3"
                  >
                    <div className="grid grid-cols-3 gap-2 rounded-lg border border-slate-200 bg-slate-50 p-2.5 text-center dark:border-slate-800 dark:bg-slate-950/50">
                      <div>
                        <div className="text-[10px] font-semibold uppercase text-slate-400">
                          Gross
                        </div>
                        <div className="text-xs font-bold text-slate-800 dark:text-slate-200">
                          {formatInr(settlingTarget.gross_amount_inr)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] font-semibold uppercase text-slate-400">
                          Platform Fee
                        </div>
                        <div className="text-xs font-bold text-slate-600 dark:text-slate-300">
                          {formatInr(settlingTarget.platform_fee_inr)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[10px] font-semibold uppercase text-emerald-600 dark:text-emerald-400">
                          Net Payout
                        </div>
                        <div className="text-xs font-extrabold text-emerald-700 dark:text-emerald-300">
                          {formatInr(settlingTarget.net_payable_inr)}
                        </div>
                      </div>
                    </div>

                    <div>
                      <label className="mb-1 block text-xs font-semibold text-slate-700 dark:text-slate-200">
                        Bank UTR / UPI Payout Reference{' '}
                        <span className="text-rose-500">*</span>
                      </label>
                      <input
                        type="text"
                        required
                        value={payoutRefInput}
                        onChange={(e) => setPayoutRefInput(e.target.value)}
                        placeholder="e.g., IMPS432018945123 or UPI/REF/998812"
                        className="h-9 w-full rounded-lg border border-slate-200 bg-white px-3 text-xs text-slate-900 placeholder:text-slate-400 focus:border-theme-primary focus:outline-none dark:border-slate-700 dark:bg-slate-950 dark:text-white"
                      />
                      <p className="mt-1 text-[11px] text-slate-500 dark:text-slate-400">
                        Updates{' '}
                        <code className="font-mono text-[10px]">
                          merchant_settlements
                        </code>{' '}
                        and{' '}
                        <code className="font-mono text-[10px]">
                          print_orders.settlement_status
                        </code>{' '}
                        to <strong>settled</strong> and logs an immutable audit
                        event.
                      </p>
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        type="button"
                        disabled={isMarkingSettled}
                        onClick={() => setSettlingTarget(null)}
                        className="h-8 rounded-lg border border-slate-200 px-3 text-xs font-semibold text-slate-600 transition hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={isMarkingSettled}
                        className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-3.5 text-xs font-semibold text-white shadow-sm transition hover:bg-emerald-700 disabled:opacity-60"
                      >
                        {isMarkingSettled ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        )}
                        Confirm Settlement
                      </button>
                    </div>
                  </form>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </div>
  );
}
