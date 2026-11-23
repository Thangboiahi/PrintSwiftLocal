'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import {
  AlertCircle,
  AlertTriangle,
  BadgeCheck,
  CheckCircle2,
  Clock,
  CreditCard,
  ExternalLink,
  FileText,
  KeyRound,
  Loader2,
  PauseCircle,
  PlayCircle,
  Plus,
  Printer,
  QrCode,
  RefreshCw,
  Save,
  Send,
  ShieldCheck,
  Sparkles,
  Trash2,
  Truck,
  Wallet,
  X,
} from 'lucide-react';
import {
  CustomSelectModal,
  type CustomSelectOption,
} from '@/components/ui/CustomSelectModal';
import {
  ResponsiveTableScroll,
  WorkspaceTableToolbar,
} from '@/components/ui/ResponsiveTableWrapper';
import { UniversalPaymentModal } from '@/components/payments/UniversalPaymentModal';
import { CounterQrPosterModal } from '@/components/workspaces/print/CounterQrPosterModal';
import { useConfirmDialog } from '@/components/ui/ConfirmActionModal';
import { useAppStatus } from '@/lib/hooks/useAppStatus';
import {
  isPrintProfileBusyPaused,
  normalizeClientPrintProfile,
  TURNAROUND_BADGE_LABELS,
} from '@/lib/print-orders/client-helpers';
import type {
  ListingPrintProfile,
  MerchantSettlement,
  PrintBulkDiscountTier,
  PrintCapabilities,
  PrintOrder,
  PrintOrderFile,
  PrintPaymentPolicy,
  PrintRateCard,
  PrintTurnaroundBadge,
} from '@/lib/print-orders/types';
import type { PaymentIntentRecord } from '@/lib/payments/types';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { useRealtimeTableRefresh } from '@/lib/hooks/useRealtimeTableRefresh';

export interface PrintManagerListingRef {
  id: string;
  title: string;
  locality?: string;
  hubId?: string | null;
  status?: string;
  category?: string;
}

export interface OwnerPrintManagerProps {
  listings: PrintManagerListingRef[];
  activeListingId?: string;
  isStaffMode?: boolean;
  mode?: 'owner' | 'staff';
  onNotice?: (notice: {
    type: 'success' | 'error' | 'info';
    text: string;
  }) => void;
}

type OwnerPrintSubTab = 'setup' | 'queue' | 'settlements';
type QueueFilterKey =
  | 'all'
  | 'awaiting_quote'
  | 'confirmed'
  | 'printing'
  | 'ready'
  | 'completed';
type SettlementFilterKey = 'all' | 'locked' | 'eligible' | 'settled' | 'reversed';

interface SubscriptionPlanRow {
  id: string;
  slug: string;
  name: string;
  price_inr: number;
  duration_days: number;
  plan_scope: string;
  entitlements: Record<string, unknown>;
}

interface PrintSubscriptionSummary {
  status: string;
  expires_at: string | null;
  plan_name: string | null;
}

interface HydratedPrintOrder extends PrintOrder {
  files: PrintOrderFile[];
  ready_at_iso: string | null;
}

interface HydratedSettlement extends MerchantSettlement {
  order_code: string;
}

const CAPABILITY_ITEMS: Array<{
  key: keyof PrintCapabilities;
  label: string;
  hint: string;
}> = [
  { key: 'bw_a4', label: 'B&W A4 Printing', hint: 'Standard monochrome A4 sheets' },
  { key: 'color_a4', label: 'Color A4 Printing', hint: 'Full-color A4 documents & photos' },
  { key: 'duplex', label: 'Duplex (Double-Sided)', hint: 'Front & back automatic/manual printing' },
  { key: 'a3_large', label: 'A3 Large Format', hint: 'A3 posters, charts & spreadsheets' },
  { key: 'spiral_binding', label: 'Spiral Binding', hint: 'Comb or spiral document binding' },
  { key: 'lamination', label: 'Lamination', hint: 'ID card & A4 sheet lamination' },
  {
    key: 'custom_digital_jobs',
    label: 'Custom Digital Jobs (Mode B)',
    hint: 'Typing, forms, DTP, banner design quotes',
  },
  {
    key: 'sealed_envelope',
    label: 'Sealed Privacy Envelope',
    hint: 'Tamper-evident sealing for confidential prints',
  },
];

const TURNAROUND_OPTIONS: CustomSelectOption[] = [
  {
    value: 'express_30m',
    label: 'Express (~30 min)',
    description: 'Walk-in fast counter ready within ~30 minutes',
  },
  {
    value: 'same_day',
    label: 'Same-Day',
    description: 'Ready for pickup or dispatch on the same business day',
  },
  {
    value: 'next_day',
    label: 'Next-Day',
    description: 'Bulk, custom design, or bound jobs ready next working day',
  },
];

const DEFAULT_CAPABILITIES: PrintCapabilities = {
  bw_a4: true,
  color_a4: false,
  duplex: false,
  a3_large: false,
  spiral_binding: false,
  lamination: false,
  custom_digital_jobs: false,
  sealed_envelope: true,
};

const DEFAULT_RATE_CARD: PrintRateCard = {
  bw_a4_single_inr: 3,
  bw_a4_duplex_inr: 5,
  color_a4_single_inr: 15,
  color_a4_duplex_inr: 25,
  a3_bw_inr: 10,
  a3_color_inr: 35,
  spiral_binding_inr: 40,
  lamination_per_sheet_inr: 20,
  staple_inr: 5,
  sealed_envelope_inr: 10,
  min_order_inr: 10,
  bulk_discounts: [],
};

const DEFAULT_PAYMENT_POLICY: PrintPaymentPolicy = {
  allow_direct_pay: true,
  direct_pay_max_inr: 300,
  allow_escrow: true,
  shop_upi_id: null,
  shop_upi_name: null,
  shop_upi_verified: false,
};

const NO_SHOW_THRESHOLD_MS = 48 * 60 * 60 * 1000;

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

function parseOptionalRate(val: string): number | undefined {
  const trimmed = val.trim();
  if (!trimmed) return undefined;
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return undefined;
  return Math.round(n * 100) / 100;
}

function openExternalUrlSafely(url: string): void {
  if (typeof document === 'undefined') return;
  const a = document.createElement('a');
  a.href = url;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

function describeFileOptions(file: PrintOrderFile): string {
  const opts = file.print_options || {};
  const parts: string[] = [];
  parts.push(`${file.server_verified_pages}p`);
  const copies = Number(opts.copies ?? 1);
  if (copies > 1) parts.push(`×${copies}`);
  const isColor = opts.color_mode === 'color' || opts.color === true;
  parts.push(isColor ? 'Color' : 'B&W');
  if (opts.duplex) parts.push('Duplex');
  if (opts.paper_size === 'A3' || opts.a3) parts.push('A3');
  if (opts.pages_per_sheet && opts.pages_per_sheet > 1) {
    parts.push(`${opts.pages_per_sheet}-up`);
  }
  if (opts.page_range && opts.page_range !== 'all') {
    parts.push(`pp.${opts.page_range}`);
  }
  if (opts.binding) parts.push('Bind');
  if (opts.lamination) parts.push('Lam');
  if (opts.staple) parts.push('Staple');
  return parts.join(' · ');
}

export function OwnerPrintManager({
  listings,
  activeListingId,
  isStaffMode,
  mode,
  onNotice,
}: OwnerPrintManagerProps) {
  const isStaff = Boolean(isStaffMode) || mode === 'staff';
  const { setStatus } = useAppStatus();
  const { confirm: confirmPrintAction, dialog: confirmPrintDialog } =
    useConfirmDialog();

  const [selectedListingId, setSelectedListingId] = useState<string>(
    () => activeListingId || listings[0]?.id || ''
  );
  const [activeSubTab, setActiveSubTab] = useState<OwnerPrintSubTab>(
    isStaff ? 'queue' : 'queue'
  );

  // Loaded data for selected listing
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [profile, setProfile] = useState<ListingPrintProfile | null>(null);
  const [hasEntitlement, setHasEntitlement] = useState<boolean>(false);
  const [recentSub, setRecentSub] = useState<PrintSubscriptionSummary | null>(
    null
  );
  const [availablePlans, setAvailablePlans] = useState<SubscriptionPlanRow[]>(
    []
  );
  const [orders, setOrders] = useState<HydratedPrintOrder[]>([]);
  const [settlements, setSettlements] = useState<HydratedSettlement[]>([]);
  const [resolvedHubId, setResolvedHubId] = useState<string | null>(null);

  // Feedback banner
  const [localBanner, setLocalBanner] = useState<{
    type: 'success' | 'error' | 'info';
    text: string;
  } | null>(null);

  // Counter setup editable form state
  const [isAcceptingOrders, setIsAcceptingOrders] = useState<boolean>(false);
  const [busyUntil, setBusyUntil] = useState<string | null>(null);
  const [capabilities, setCapabilities] =
    useState<PrintCapabilities>(DEFAULT_CAPABILITIES);
  const [rateInputs, setRateInputs] = useState<Record<string, string>>({});
  const [bulkDiscounts, setBulkDiscounts] = useState<PrintBulkDiscountTier[]>(
    []
  );
  const [turnaroundBadge, setTurnaroundBadge] =
    useState<PrintTurnaroundBadge>('same_day');
  const [expressEtaMins, setExpressEtaMins] = useState<string>('45');
  const [supportsPickNDrop, setSupportsPickNDrop] = useState<boolean>(true);
  const [pickupInstructions, setPickupInstructions] = useState<string>('');
  const [maxFileSizeMb, setMaxFileSizeMb] = useState<string>('25');
  const [allowDirectPay, setAllowDirectPay] = useState<boolean>(true);
  const [directPayMaxInr, setDirectPayMaxInr] = useState<string>('300');
  const [allowEscrow, setAllowEscrow] = useState<boolean>(true);
  const [shopUpiId, setShopUpiId] = useState<string>('');
  const [shopUpiName, setShopUpiName] = useState<string>('');
  const [isSavingProfile, setIsSavingProfile] = useState<boolean>(false);
  const [isPauseBusy, setIsPauseBusy] = useState<boolean>(false);

  // Queue filters & per-order interactive states
  const [queueSearch, setQueueSearch] = useState('');
  const [queueFilter, setQueueFilter] = useState<QueueFilterKey>('all');
  const [otpInputs, setOtpInputs] = useState<Record<string, string>>({});
  const [directPaidChecked, setDirectPaidChecked] = useState<
    Record<string, boolean>
  >({});
  const [busyOrderId, setBusyOrderId] = useState<string | null>(null);
  const [downloadingFileId, setDownloadingFileId] = useState<string | null>(
    null
  );

  // Mode B Quote Modal state (portaled at z-[85])
  const [quoteModalOrder, setQuoteModalOrder] =
    useState<HydratedPrintOrder | null>(null);
  const [quotePriceInput, setQuotePriceInput] = useState('');
  const [quoteTurnaroundInput, setQuoteTurnaroundInput] = useState('');
  const [quoteNoteInput, setQuoteNoteInput] = useState('');
  const [isSendingQuote, setIsSendingQuote] = useState(false);

  // Settlements filters
  const [settlementSearch, setSettlementSearch] = useState('');
  const [settlementFilter, setSettlementFilter] =
    useState<SettlementFilterKey>('all');

  // Counter QR Poster Modal (z-[90])
  const [isQrPosterOpen, setIsQrPosterOpen] = useState(false);

  // Print Pro subscription checkout modal state
  const [subscribingPlanId, setSubscribingPlanId] = useState<string | null>(
    null
  );
  const [paymentModalIntent, setPaymentModalIntent] =
    useState<PaymentIntentRecord | null>(null);
  const [paymentModalUpi, setPaymentModalUpi] = useState<{
    upiId?: string;
    upiPayeeName?: string;
    planName?: string;
  }>({});

  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  // Derive valid listing id cleanly without synchronous setState inside useEffect
  const effectiveListingId = useMemo(() => {
    if (listings.length === 0) return '';
    if (selectedListingId && listings.some((l) => l.id === selectedListingId)) {
      return selectedListingId;
    }
    if (activeListingId && listings.some((l) => l.id === activeListingId)) {
      return activeListingId;
    }
    return listings[0].id;
  }, [listings, selectedListingId, activeListingId]);

  const selectedListing = useMemo(
    () => listings.find((l) => l.id === effectiveListingId) ?? null,
    [listings, effectiveListingId]
  );
  const selectedListingHubId = selectedListing?.hubId ?? null;

  const listingOptions: CustomSelectOption[] = useMemo(
    () =>
      listings.map((l) => ({
        value: l.id,
        label: l.title,
        description: l.locality || l.category || undefined,
      })),
    [listings]
  );

  const pushBanner = useCallback(
    (type: 'success' | 'error' | 'info', text: string) => {
      setLocalBanner({ type, text });
      onNotice?.({ type, text });
    },
    [onNotice]
  );

  const hydrateFormFromProfile = useCallback(
    (nextProfile: ListingPrintProfile | null) => {
      const p = nextProfile;
      setIsAcceptingOrders(p ? p.is_accepting_orders : false);
      setBusyUntil(p ? p.busy_until : null);
      setCapabilities(p ? p.capabilities : { ...DEFAULT_CAPABILITIES });
      const rc = p ? p.rate_card : DEFAULT_RATE_CARD;
      setRateInputs({
        bw_a4_single_inr:
          rc.bw_a4_single_inr !== undefined ? String(rc.bw_a4_single_inr) : '',
        bw_a4_duplex_inr:
          rc.bw_a4_duplex_inr !== undefined ? String(rc.bw_a4_duplex_inr) : '',
        color_a4_single_inr:
          rc.color_a4_single_inr !== undefined
            ? String(rc.color_a4_single_inr)
            : '',
        color_a4_duplex_inr:
          rc.color_a4_duplex_inr !== undefined
            ? String(rc.color_a4_duplex_inr)
            : '',
        a3_bw_inr: rc.a3_bw_inr !== undefined ? String(rc.a3_bw_inr) : '',
        a3_color_inr:
          rc.a3_color_inr !== undefined ? String(rc.a3_color_inr) : '',
        spiral_binding_inr:
          rc.spiral_binding_inr !== undefined
            ? String(rc.spiral_binding_inr)
            : '',
        lamination_per_sheet_inr:
          rc.lamination_per_sheet_inr !== undefined
            ? String(rc.lamination_per_sheet_inr)
            : '',
        staple_inr: rc.staple_inr !== undefined ? String(rc.staple_inr) : '',
        sealed_envelope_inr:
          rc.sealed_envelope_inr !== undefined
            ? String(rc.sealed_envelope_inr)
            : '',
        min_order_inr:
          rc.min_order_inr !== undefined ? String(rc.min_order_inr) : '',
      });
      setBulkDiscounts(
        Array.isArray(rc.bulk_discounts) ? rc.bulk_discounts : []
      );
      setTurnaroundBadge(p ? p.turnaround_badge : 'same_day');
      const rawProf = (p || {}) as unknown as Record<string, unknown>;
      setExpressEtaMins(
        rawProf.express_eta_mins != null
          ? String(rawProf.express_eta_mins)
          : '45'
      );
      setSupportsPickNDrop(rawProf.supports_pick_n_drop !== false);
      setPickupInstructions(p?.pickup_instructions || '');
      setMaxFileSizeMb(String(p?.max_file_size_mb ?? 25));

      const pp = p ? p.payment_policy : DEFAULT_PAYMENT_POLICY;
      setAllowDirectPay(pp.allow_direct_pay);
      setDirectPayMaxInr(String(pp.direct_pay_max_inr ?? 300));
      setAllowEscrow(pp.allow_escrow);
      setShopUpiId(pp.shop_upi_id || '');
      setShopUpiName(pp.shop_upi_name || '');
    },
    []
  );

  const loadShopPrintData = useCallback(
    async (silent = false) => {
      if (!effectiveListingId || !isSupabaseConfigured()) {
        setIsLoading(false);
        setIsRefreshing(false);
        return;
      }

      if (!silent) {
        setIsLoading(true);
      } else {
        setIsRefreshing(true);
      }

      try {
        const [
          profileRes,
          entitlementRes,
          listingMetaRes,
          ordersRes,
          plansRes,
          subsRes,
          settlementsRes,
        ] = await Promise.all([
          supabase
            .from('listing_print_profiles')
            .select('*')
            .eq('listing_id', effectiveListingId)
            .maybeSingle(),
          supabase.rpc('has_active_print_entitlement', {
            p_listing_id: effectiveListingId,
          }),
          supabase
            .from('listings')
            .select('id, hub_id')
            .eq('id', effectiveListingId)
            .maybeSingle(),
          supabase
            .from('print_orders')
            .select('*')
            .eq('listing_id', effectiveListingId)
            .order('created_at', { ascending: false })
            .limit(120),
          isStaff
            ? Promise.resolve({ data: [], error: null })
            : supabase
                .from('subscription_plans')
                .select(
                  'id, slug, name, price_inr, duration_days, plan_scope, entitlements'
                )
                .in('plan_scope', ['print_pro', 'merchant_bundle'])
                .eq('is_active', true)
                .order('price_inr', { ascending: true }),
          isStaff
            ? Promise.resolve({ data: [], error: null })
            : supabase
                .from('user_subscriptions')
                .select(
                  'id, status, expires_at, listing_id, subscription_plans:plan_id(name, plan_scope)'
                )
                .order('expires_at', { ascending: false })
                .limit(20),
          isStaff
            ? Promise.resolve({ data: [], error: null })
            : supabase
                .from('merchant_settlements')
                .select('*')
                .eq('listing_id', effectiveListingId)
                .order('created_at', { ascending: false })
                .limit(150),
        ]);

        const normalizedProfile = normalizeClientPrintProfile(
          (profileRes.data as Record<string, unknown> | null) ?? null
        );
        setProfile(normalizedProfile);
        hydrateFormFromProfile(normalizedProfile);

        const hubIdFromRow =
          normalizedProfile?.hub_id ||
          (listingMetaRes.data as { hub_id?: string | null } | null)?.hub_id ||
          selectedListingHubId ||
          null;
        setResolvedHubId(hubIdFromRow);

        const entitled =
          Boolean(entitlementRes.data) ||
          Boolean(normalizedProfile?.is_first_party_printswift);
        setHasEntitlement(entitled);

        if (!isStaff && Array.isArray(plansRes.data)) {
          setAvailablePlans(
            (plansRes.data as Array<Record<string, unknown>>).map((row) => ({
              id: String(row.id),
              slug: String(row.slug || ''),
              name: String(row.name || 'Print & Digital Pro'),
              price_inr: Number(row.price_inr || 0),
              duration_days: Number(row.duration_days || 30),
              plan_scope: String(row.plan_scope || 'print_pro'),
              entitlements:
                row.entitlements && typeof row.entitlements === 'object'
                  ? (row.entitlements as Record<string, unknown>)
                  : {},
            }))
          );
        }

        if (!isStaff && Array.isArray(subsRes.data)) {
          const printSubs = (subsRes.data as Array<Record<string, unknown>>)
            .filter((row) => {
              const planObj = Array.isArray(row.subscription_plans)
                ? (row.subscription_plans[0] as
                    | { name?: string; plan_scope?: string }
                    | undefined)
                : (row.subscription_plans as
                    | { name?: string; plan_scope?: string }
                    | null);
              const scope = planObj?.plan_scope || '';
              if (!['print_pro', 'merchant_bundle'].includes(scope)) {
                return false;
              }
              return (
                !row.listing_id || String(row.listing_id) === effectiveListingId
              );
            })
            .map((row) => {
              const planObj = Array.isArray(row.subscription_plans)
                ? (row.subscription_plans[0] as { name?: string } | undefined)
                : (row.subscription_plans as { name?: string } | null);
              return {
                status: String(row.status || ''),
                expires_at: row.expires_at ? String(row.expires_at) : null,
                plan_name: planObj?.name ? String(planObj.name) : null,
              };
            });
          setRecentSub(printSubs[0] ?? null);
        } else {
          setRecentSub(null);
        }

        // Hydrate print orders with files & ready_for_pickup event timestamps
        const rawOrders = (ordersRes.data || []) as PrintOrder[];
        const orderIds = rawOrders.map((o) => o.id);
        const filesByOrder = new Map<string, PrintOrderFile[]>();
        const readyAtByOrder = new Map<string, string>();

        if (orderIds.length > 0) {
          const [filesRes, readyEventsRes] = await Promise.all([
            supabase
              .from('print_order_files')
              .select('*')
              .in('print_order_id', orderIds)
              .order('created_at', { ascending: true }),
            supabase
              .from('print_order_events')
              .select('print_order_id, created_at, metadata')
              .in('print_order_id', orderIds)
              .eq('event_type', 'status_updated')
              .order('created_at', { ascending: false }),
          ]);

          for (const f of (filesRes.data || []) as PrintOrderFile[]) {
            const list = filesByOrder.get(f.print_order_id) || [];
            list.push(f);
            filesByOrder.set(f.print_order_id, list);
          }

          for (const ev of (readyEventsRes.data || []) as Array<{
            print_order_id: string;
            created_at: string;
            metadata: Record<string, unknown> | null;
          }>) {
            if (
              ev.metadata?.fulfillment_status === 'ready_for_pickup' &&
              !readyAtByOrder.has(ev.print_order_id)
            ) {
              readyAtByOrder.set(ev.print_order_id, ev.created_at);
            }
          }
        }

        const hydratedOrders: HydratedPrintOrder[] = rawOrders.map((o) => ({
          ...o,
          quoted_amount_inr:
            o.quoted_amount_inr !== null && o.quoted_amount_inr !== undefined
              ? Number(o.quoted_amount_inr)
              : null,
          platform_fee_inr: Number(o.platform_fee_inr || 0),
          files: filesByOrder.get(o.id) || [],
          ready_at_iso: readyAtByOrder.get(o.id) || o.updated_at || null,
        }));
        setOrders(hydratedOrders);
        setNowMs(Date.now());

        // Hydrate settlements with order_code
        if (!isStaff && Array.isArray(settlementsRes.data)) {
          const orderCodeById = new Map(
            hydratedOrders.map((o) => [o.id, o.order_code])
          );
          const rawSettlements = settlementsRes.data as MerchantSettlement[];
          setSettlements(
            rawSettlements.map((s) => ({
              ...s,
              gross_amount_inr: Number(s.gross_amount_inr || 0),
              platform_fee_inr: Number(s.platform_fee_inr || 0),
              net_payable_inr: Number(s.net_payable_inr || 0),
              order_code:
                orderCodeById.get(s.print_order_id) ||
                `PRT-${s.print_order_id.slice(0, 6).toUpperCase()}`,
            }))
          );
        } else {
          setSettlements([]);
        }
      } catch (err) {
        pushBanner(
          'error',
          err instanceof Error
            ? err.message
            : 'Failed to load Print & Digital counter data.'
        );
      } finally {
        setIsLoading(false);
        setIsRefreshing(false);
      }
    },
    [
      effectiveListingId,
      selectedListingHubId,
      isStaff,
      hydrateFormFromProfile,
      pushBanner,
    ]
  );

  useEffect(() => {
    queueMicrotask(() => {
      void loadShopPrintData(false);
    });
  }, [loadShopPrintData]);

  // Pass R6: Lightweight Realtime auto-refresh for incoming print orders
  useRealtimeTableRefresh('print_orders', () => void loadShopPrintData(true), {
    enabled: Boolean(selectedListingId),
    filter: selectedListingId ? `listing_id=eq.${selectedListingId}` : undefined,
  });

  // Derived operational metrics
  const inFlightOrdersCount = useMemo(
    () =>
      orders.filter(
        (o) =>
          ['confirmed', 'printing', 'ready_for_pickup'].includes(
            o.fulfillment_status
          ) || ['awaiting_shop_quote', 'quoted'].includes(o.quote_status)
      ).length,
    [orders]
  );

  const isExpiredWithInFlight = useMemo(() => {
    if (isStaff || hasEntitlement || profile?.is_first_party_printswift) {
      return false;
    }
    const hadPreviousSub = Boolean(
      recentSub &&
        (recentSub.status === 'expired' ||
          (recentSub.expires_at &&
            Date.parse(recentSub.expires_at) <= nowMs))
    );
    return (hadPreviousSub || Boolean(profile)) && inFlightOrdersCount > 0;
  }, [
    isStaff,
    hasEntitlement,
    profile,
    recentSub,
    inFlightOrdersCount,
    nowMs,
  ]);

  const isCurrentlyBusyPaused = useMemo(
    () => isPrintProfileBusyPaused(busyUntil, nowMs),
    [busyUntil, nowMs]
  );

  // Filtered Print Queue
  const filteredOrders = useMemo(() => {
    const q = queueSearch.trim().toLowerCase();
    return orders.filter((o) => {
      if (queueFilter === 'awaiting_quote') {
        if (o.quote_status !== 'awaiting_shop_quote') return false;
      } else if (queueFilter === 'confirmed') {
        if (o.fulfillment_status !== 'confirmed') return false;
      } else if (queueFilter === 'printing') {
        if (o.fulfillment_status !== 'printing') return false;
      } else if (queueFilter === 'ready') {
        if (o.fulfillment_status !== 'ready_for_pickup') return false;
      } else if (queueFilter === 'completed') {
        if (!['collected', 'handed_to_rider'].includes(o.fulfillment_status)) {
          return false;
        }
      }

      if (!q) return true;
      return (
        o.order_code.toLowerCase().includes(q) ||
        String(o.service_category_slug || '')
          .toLowerCase()
          .includes(q) ||
        String(o.customer_instructions || '')
          .toLowerCase()
          .includes(q) ||
        o.files.some((f) => f.display_label_masked.toLowerCase().includes(q))
      );
    });
  }, [orders, queueSearch, queueFilter]);

  // Filtered Settlements
  const filteredSettlements = useMemo(() => {
    const q = settlementSearch.trim().toLowerCase();
    return settlements.filter((s) => {
      if (settlementFilter !== 'all' && s.status !== settlementFilter) {
        return false;
      }
      if (!q) return true;
      return (
        s.order_code.toLowerCase().includes(q) ||
        String(s.payout_reference || '')
          .toLowerCase()
          .includes(q) ||
        s.status.toLowerCase().includes(q)
      );
    });
  }, [settlements, settlementSearch, settlementFilter]);

  const settlementTotals = useMemo(() => {
    return settlements.reduce(
      (acc, s) => {
        if (s.status === 'locked') acc.locked += s.net_payable_inr;
        if (s.status === 'eligible') acc.eligible += s.net_payable_inr;
        if (s.status === 'settled') acc.settled += s.net_payable_inr;
        return acc;
      },
      { locked: 0, eligible: 0, settled: 0 }
    );
  }, [settlements]);

  // =========================================================================
  // Owner Actions: Subscribe to Print Pro
  // =========================================================================
  const handleStartPrintProCheckout = async (plan: SubscriptionPlanRow) => {
    if (!effectiveListingId) return;
    setSubscribingPlanId(plan.id);
    setStatus('saving', `Initializing ${plan.name}…`);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session?.access_token) {
        throw new Error('Please sign in again to subscribe to Print & Digital Pro.');
      }

      const res = await fetch('/api/payments/create-intent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session.access_token}`,
        },
        body: JSON.stringify({
          purpose: 'print_pro_subscription',
          planId: plan.id,
          listingId: effectiveListingId,
          hubId: resolvedHubId || undefined,
        }),
      });
      const json = (await res.json().catch(() => ({}))) as {
        intent?: PaymentIntentRecord;
        upi_id?: string;
        upi_payee_name?: string;
        error?: string;
      };
      if (!res.ok || !json.intent) {
        throw new Error(
          json.error || 'Could not start Print & Digital Pro subscription checkout.'
        );
      }

      setPaymentModalUpi({
        upiId: json.upi_id,
        upiPayeeName: json.upi_payee_name,
        planName: plan.name,
      });
      setPaymentModalIntent(json.intent);
      setStatus('idle');
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Subscription checkout failed.';
      setStatus('error', msg);
      pushBanner('error', msg);
    } finally {
      setSubscribingPlanId(null);
    }
  };

  // =========================================================================
  // Owner Actions: Quick Pause / Resume & Save Counter Profile
  // =========================================================================
  const buildProfileUpsertPayload = useCallback(
    (overrides?: {
      is_accepting_orders?: boolean;
      busy_until?: string | null;
    }) => {
      const cleanRateCard: PrintRateCard = {
        bw_a4_single_inr: parseOptionalRate(rateInputs.bw_a4_single_inr || ''),
        bw_a4_duplex_inr: parseOptionalRate(rateInputs.bw_a4_duplex_inr || ''),
        color_a4_single_inr: parseOptionalRate(
          rateInputs.color_a4_single_inr || ''
        ),
        color_a4_duplex_inr: parseOptionalRate(
          rateInputs.color_a4_duplex_inr || ''
        ),
        a3_bw_inr: parseOptionalRate(rateInputs.a3_bw_inr || ''),
        a3_color_inr: parseOptionalRate(rateInputs.a3_color_inr || ''),
        spiral_binding_inr: parseOptionalRate(
          rateInputs.spiral_binding_inr || ''
        ),
        lamination_per_sheet_inr: parseOptionalRate(
          rateInputs.lamination_per_sheet_inr || ''
        ),
        staple_inr: parseOptionalRate(rateInputs.staple_inr || ''),
        sealed_envelope_inr: parseOptionalRate(
          rateInputs.sealed_envelope_inr || ''
        ),
        min_order_inr: parseOptionalRate(rateInputs.min_order_inr || ''),
        platform_fee_inr: profile?.rate_card?.platform_fee_inr,
        bulk_discounts: bulkDiscounts
          .filter((b) => b.min_pages > 0 && b.discount_percent > 0)
          .sort((a, b) => a.min_pages - b.min_pages),
      };

      const normalizedUpiId = shopUpiId.trim() || null;
      const upiIdUnchanged =
        normalizedUpiId !== null &&
        normalizedUpiId === (profile?.payment_policy?.shop_upi_id || null);

      const cleanPaymentPolicy: PrintPaymentPolicy = {
        allow_direct_pay: allowDirectPay,
        direct_pay_max_inr: Math.max(
          0,
          Math.min(50000, Number(directPayMaxInr) || 0)
        ),
        allow_escrow: allowEscrow,
        shop_upi_id: normalizedUpiId,
        shop_upi_name: shopUpiName.trim() || null,
        shop_upi_verified: upiIdUnchanged
          ? Boolean(profile?.payment_policy?.shop_upi_verified)
          : false,
      };

      const parsedMaxMb = Math.max(
        5,
        Math.min(25, Math.round(Number(maxFileSizeMb) || 25))
      );

      // Note: Do NOT pass is_first_party_printswift or verified_capabilities so
      // the DB guard trigger preserves Hub-verified badges cleanly.
      const parsedEtaMins = Math.max(
        10,
        Math.min(1440, Math.round(Number(expressEtaMins) || 45))
      );
      return {
        listing_id: effectiveListingId,
        ...(resolvedHubId ? { hub_id: resolvedHubId } : {}),
        is_accepting_orders:
          overrides?.is_accepting_orders ?? isAcceptingOrders,
        busy_until:
          overrides && 'busy_until' in overrides
            ? overrides.busy_until
            : busyUntil,
        capabilities,
        rate_card: cleanRateCard,
        pricing_matrix: cleanRateCard,
        payment_policy: cleanPaymentPolicy,
        turnaround_badge: turnaroundBadge,
        express_eta_mins: parsedEtaMins,
        supports_pick_n_drop: supportsPickNDrop,
        pickup_instructions: pickupInstructions.trim() || null,
        max_file_size_mb: parsedMaxMb,
      };
    },
    [
      effectiveListingId,
      resolvedHubId,
      isAcceptingOrders,
      busyUntil,
      capabilities,
      rateInputs,
      bulkDiscounts,
      profile,
      allowDirectPay,
      directPayMaxInr,
      allowEscrow,
      shopUpiId,
      shopUpiName,
      turnaroundBadge,
      expressEtaMins,
      supportsPickNDrop,
      pickupInstructions,
      maxFileSizeMb,
    ]
  );

  const handleQuickPauseAction = async (
    action: 'pause_1h' | 'pause_eod' | 'resume' | 'toggle_accepting'
  ) => {
    if (!effectiveListingId || isStaff) return;
    const isDisruptivePause =
      action === 'pause_1h' ||
      action === 'pause_eod' ||
      (action === 'toggle_accepting' && isAcceptingOrders);
    if (isDisruptivePause) {
      const ok = await confirmPrintAction({
        title:
          action === 'toggle_accepting'
            ? 'Turn off online print orders?'
            : action === 'pause_1h'
              ? 'Pause print counter for 1 hour?'
              : 'Pause print counter for rest of day?',
        description:
          'New customers will not be able to submit print orders while paused. Existing paid orders stay visible for fulfillment.',
        confirmLabel: 'Confirm Pause',
        cancelLabel: 'Keep Open',
        variant: 'danger',
      });
      if (!ok) return;
    }
    setIsPauseBusy(true);

    let nextAccepting = isAcceptingOrders;
    let nextBusyUntil: string | null = busyUntil;
    let label = 'Updating counter status…';

    if (action === 'pause_1h') {
      nextAccepting = true;
      nextBusyUntil = new Date(Date.now() + 60 * 60 * 1000).toISOString();
      label = 'Pausing counter for 1 hour…';
    } else if (action === 'pause_eod') {
      const eod = new Date();
      eod.setHours(23, 59, 59, 0);
      nextAccepting = true;
      nextBusyUntil = eod.toISOString();
      label = 'Pausing counter for rest of day…';
    } else if (action === 'resume') {
      nextAccepting = true;
      nextBusyUntil = null;
      label = 'Resuming print counter…';
    } else if (action === 'toggle_accepting') {
      nextAccepting = !isAcceptingOrders;
      if (nextAccepting) nextBusyUntil = null;
      label = nextAccepting
        ? 'Enabling online print orders…'
        : 'Turning off online print orders…';
    }

    setStatus('saving', label);
    try {
      const payload = buildProfileUpsertPayload({
        is_accepting_orders: nextAccepting,
        busy_until: nextBusyUntil,
      });

      const { data, error } = await supabase
        .from('listing_print_profiles')
        .upsert(payload, { onConflict: 'listing_id' })
        .select('*')
        .single();

      if (error) throw new Error(error.message);
      const updated = normalizeClientPrintProfile(
        data as Record<string, unknown>
      );
      if (updated) {
        setProfile(updated);
        hydrateFormFromProfile(updated);
        setNowMs(Date.now());
      }

      const successText =
        action === 'pause_1h'
          ? 'Print counter paused for 1 hour.'
          : action === 'pause_eod'
            ? 'Print counter paused for the rest of the day.'
            : action === 'resume'
              ? 'Print counter resumed and accepting orders.'
              : nextAccepting
                ? 'Print counter is now live and accepting orders.'
                : 'Print counter is now paused.';
      setStatus('success', successText);
      pushBanner('success', successText);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to update counter status.';
      setStatus('error', msg);
      pushBanner('error', msg);
    } finally {
      setIsPauseBusy(false);
    }
  };

  const handleSaveCounterSetup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!effectiveListingId || isStaff) return;
    const ok = await confirmPrintAction({
      title: 'Save Print Counter & Rate Card?',
      description:
        'Saving updates your capabilities, pricing matrix, turnaround ETA, and UPI policy while locking existing quoted orders.',
      confirmLabel: 'Save Rate Card',
      cancelLabel: 'Cancel',
    });
    if (!ok) return;
    setIsSavingProfile(true);
    setStatus('saving', 'Saving Print Counter & Rate Card…');
    try {
      const payload = buildProfileUpsertPayload();
      let { data, error } = await supabase
        .from('listing_print_profiles')
        .upsert(payload, { onConflict: 'listing_id' })
        .select('*')
        .single();

      if (
        error &&
        /column|schema cache|42703|PGRST204/i.test(String(error.message || ''))
      ) {
        const {
          pricing_matrix: _pm,
          express_eta_mins: _eta,
          supports_pick_n_drop: _pnd,
          ...basePayload
        } = payload as Record<string, unknown>;
        const retry = await supabase
          .from('listing_print_profiles')
          .upsert(basePayload, { onConflict: 'listing_id' })
          .select('*')
          .single();
        data = retry.data;
        error = retry.error;
      }

      if (error) throw new Error(error.message);
      const updated = normalizeClientPrintProfile(
        data as Record<string, unknown>
      );
      if (updated) {
        setProfile(updated);
        hydrateFormFromProfile(updated);
      }
      const msg = `Saved Counter Setup & Dual-Payment Policy (Rate v${updated?.pricing_version ?? 1}).`;
      setStatus('success', msg);
      pushBanner('success', msg);
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Failed to save print counter settings.';
      setStatus('error', msg);
      pushBanner('error', msg);
    } finally {
      setIsSavingProfile(false);
    }
  };

  // =========================================================================
  // Operator Actions (Owner + Delegated Staff): Queue Fulfillment & Signed PDF
  // =========================================================================
  const getAuthToken = async (): Promise<string> => {
    const {
      data: { session },
    } = await supabase.auth.getSession();
    if (!session?.access_token) {
      throw new Error('Authentication expired. Please sign in again.');
    }
    return session.access_token;
  };

  const callShopAction = async (
    orderId: string,
    payload: Record<string, unknown>,
    loadingMsg: string,
    successMsg: string
  ) => {
    setBusyOrderId(orderId);
    setStatus('saving', loadingMsg);
    try {
      const token = await getAuthToken();
      const res = await fetch(
        `/api/print-orders/${encodeURIComponent(orderId)}/shop-action`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify(payload),
        }
      );
      const json = (await res.json().catch(() => ({}))) as {
        error?: string;
        ok?: boolean;
      };
      if (!res.ok) {
        throw new Error(json.error || 'Shop action failed.');
      }
      setStatus('success', successMsg);
      pushBanner('success', successMsg);
      await loadShopPrintData(true);
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to update print order.';
      setStatus('error', msg);
      pushBanner('error', msg);
    } finally {
      setBusyOrderId(null);
    }
  };

  const handleOpenSignedPdf = async (orderId: string, file: PrintOrderFile) => {
    setDownloadingFileId(file.id);
    setStatus('syncing', `Generating 5-min secure link for ${file.display_label_masked}…`);
    try {
      const token = await getAuthToken();
      const res = await fetch(
        `/api/print-orders/${encodeURIComponent(orderId)}/files/${encodeURIComponent(file.id)}/signed-url`,
        {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }
      );
      const json = (await res.json().catch(() => ({}))) as {
        signedUrl?: string;
        error?: string;
      };
      if (!res.ok || !json.signedUrl) {
        throw new Error(
          json.error || 'Could not issue 5-minute signed print document link.'
        );
      }
      openExternalUrlSafely(json.signedUrl);
      setStatus('success', 'Opened secure 5-minute document link');
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to open document.';
      setStatus('error', msg);
      pushBanner('error', msg);
    } finally {
      setDownloadingFileId(null);
    }
  };

  const handleOpenQuoteModal = (order: HydratedPrintOrder) => {
    setQuoteModalOrder(order);
    setQuotePriceInput(
      order.quoted_amount_inr ? String(order.quoted_amount_inr) : ''
    );
    setQuoteTurnaroundInput('Ready today by 5:00 PM');
    setQuoteNoteInput('');
  };

  const handleSubmitCustomQuote = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!quoteModalOrder) return;
    const priceNum = Number(quotePriceInput);
    if (!Number.isFinite(priceNum) || priceNum <= 0) {
      pushBanner('error', 'Enter a valid quoted amount greater than ₹0.');
      return;
    }
    setIsSendingQuote(true);
    try {
      await callShopAction(
        quoteModalOrder.id,
        {
          action: 'send_custom_quote',
          quotedAmountInr: priceNum,
          turnaroundNote: quoteTurnaroundInput.trim() || undefined,
          note: quoteNoteInput.trim() || undefined,
        },
        `Sending quote for ${quoteModalOrder.order_code}…`,
        `Sent quote of ${formatInr(priceNum)} for ${quoteModalOrder.order_code}.`
      );
      setQuoteModalOrder(null);
    } finally {
      setIsSendingQuote(false);
    }
  };

  const handleVerifyOtpHandover = async (order: HydratedPrintOrder) => {
    const otp = (otpInputs[order.id] || '').trim();
    if (!/^\d{4}$/.test(otp)) {
      pushBanner('error', 'Enter the customer’s 4-digit Collection OTP.');
      return;
    }
    const isDirectRail =
      order.payment_rail === 'direct_counter' ||
      order.payment_rail === 'direct_shop_upi';
    const directConfirmed = isDirectRail
      ? Boolean(directPaidChecked[order.id])
      : false;

    await callShopAction(
      order.id,
      {
        action: 'verify_otp_handover',
        otp,
        directPaymentConfirmed: directConfirmed,
      },
      `Verifying handover OTP for ${order.order_code}…`,
      order.handover_mode === 'pick_n_drop'
        ? `Handed ${order.order_code} to rider — 48h auto-purge timer started.`
        : `Handover complete for ${order.order_code} — 48h auto-purge timer started.`
    );
    setOtpInputs((prev) => ({ ...prev, [order.id]: '' }));
  };

  // =========================================================================
  // Empty Listings Guard
  // =========================================================================
  if (listings.length === 0) {
    return (
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-surface)] p-6 text-center space-y-2">
        <Printer className="mx-auto h-7 w-7 text-[var(--ps-text-muted)] opacity-60" />
        <h3 className="text-sm font-bold text-[var(--ps-text)]">
          {isStaff
            ? 'No Assigned Print Shops Found'
            : 'Create a Shop Listing First'}
        </h3>
        <p className="text-xs text-[var(--ps-text-muted)] max-w-md mx-auto">
          {isStaff
            ? 'Ask your shop owner to delegate an active print-enabled listing to your staff account.'
            : 'Publish or draft a shop listing first to configure your DD oodle Print & Digital counter, rates, and live queue.'}
        </p>
      </section>
    );
  }

  return (
    <div
      data-testid={isStaff ? 'staff-print-manager' : 'owner-print-manager'}
      className="min-w-0 space-y-4"
    >
      {/* Top Header & Multi-Listing Selector */}
      <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-surface)] p-4 sm:p-5 space-y-3">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-extrabold tracking-tight text-[var(--ps-text)]">
                {isStaff
                  ? 'Staff Print & Digital Fulfillment Queue'
                  : 'Print & Digital Counter Suite'}
              </h2>
              {profile?.is_first_party_printswift && (
                <span className="inline-flex items-center gap-1 rounded-md bg-theme-primary px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-theme-primary-foreground">
                  <BadgeCheck className="h-3 w-3" />
                  Official PrintSwift
                </span>
              )}
              {!isStaff && hasEntitlement && !profile?.is_first_party_printswift && (
                <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/35 bg-emerald-500/12 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300">
                  <ShieldCheck className="h-3 w-3" />
                  Print Pro Active
                </span>
              )}
            </div>
            <p className="mt-0.5 text-xs text-[var(--ps-text-muted)]">
              {isStaff
                ? 'Process active print jobs, open 5-minute secure PDFs, send custom quotes, and verify 4-digit handover OTPs.'
                : 'Manage counter availability, verified capabilities, rate cards, dual-rail payment policy, live queue, and escrow settlements.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 shrink-0">
            {listings.length > 1 && (
              <div className="w-full sm:w-64">
                <CustomSelectModal
                  options={listingOptions}
                  value={effectiveListingId}
                  onChange={setSelectedListingId}
                  placeholder="Select shop listing"
                  testId="print-manager-shop-select"
                />
              </div>
            )}

            {!isStaff && selectedListing && (
              <button
                type="button"
                onClick={() => setIsQrPosterOpen(true)}
                data-testid="open-counter-qr-poster-btn"
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-[var(--ps-bg)] px-3 text-xs font-bold text-[var(--ps-text)] hover:border-theme-primary/50 hover:text-theme-primary transition-colors whitespace-nowrap shrink-0 cursor-pointer"
              >
                <QrCode className="h-3.5 w-3.5 text-theme-primary" />
                <span>Counter QR Poster</span>
              </button>
            )}

            <button
              type="button"
              disabled={isRefreshing}
              onClick={() => void loadShopPrintData(true)}
              aria-label="Refresh print counter data"
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 dark:border-slate-700 bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] transition-colors cursor-pointer"
            >
              <RefreshCw
                className={`h-3.5 w-3.5 ${isRefreshing ? 'animate-spin' : ''}`}
              />
            </button>
          </div>
        </div>

        {/* Selected Shop Quick Metadata Line */}
        {selectedListing && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1 border-t border-slate-200/80 dark:border-slate-800 pt-2.5 text-xs text-[var(--ps-text-muted)]">
            <span className="font-semibold text-[var(--ps-text)]">
              {selectedListing.title}
            </span>
            {selectedListing.locality && (
              <>
                <span aria-hidden="true">·</span>
                <span>{selectedListing.locality}</span>
              </>
            )}
            <span aria-hidden="true">·</span>
            <span className="tabular-nums">
              {inFlightOrdersCount} active job
              {inFlightOrdersCount === 1 ? '' : 's'}
            </span>
            {profile && (
              <>
                <span aria-hidden="true">·</span>
                <span className="font-mono tabular-nums">
                  Rate v{profile.pricing_version}
                </span>
              </>
            )}
            {!isStaff && recentSub?.expires_at && hasEntitlement && (
              <>
                <span aria-hidden="true">·</span>
                <span>
                  Plan renews {formatDateTime(recentSub.expires_at)}
                </span>
              </>
            )}
          </div>
        )}
      </section>

      {/* Local Status Feedback */}
      {localBanner && (
        <div
          role="status"
          className={`flex items-start justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-xs font-medium ${
            localBanner.type === 'error'
              ? 'border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300'
              : localBanner.type === 'success'
                ? 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                : 'border-sky-500/35 bg-sky-500/10 text-sky-700 dark:text-sky-300'
          }`}
        >
          <span className="flex items-center gap-2">
            {localBanner.type === 'error' ? (
              <AlertCircle className="h-4 w-4 shrink-0" />
            ) : (
              <CheckCircle2 className="h-4 w-4 shrink-0" />
            )}
            <span>{localBanner.text}</span>
          </span>
          <button
            type="button"
            onClick={() => setLocalBanner(null)}
            className="text-[11px] font-bold opacity-75 hover:opacity-100 cursor-pointer"
          >
            Dismiss
          </button>
        </div>
      )}

      {isLoading ? (
        <div className="flex items-center justify-center gap-2 rounded-2xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-surface)] py-12 text-xs text-[var(--ps-text-muted)]">
          <Loader2 className="h-4 w-4 animate-spin text-theme-primary" />
          <span>Loading Print &amp; Digital counter workspace…</span>
        </div>
      ) : (
        <>
          {/* Graceful Expiry Warning (Owner mode when expired + in-flight jobs exist) */}
          {!isStaff && isExpiredWithInFlight && (
            <div
              data-testid="print-pro-graceful-expiry-banner"
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-amber-500/40 bg-amber-500/10 p-4 text-xs text-amber-900 dark:text-amber-200"
            >
              <div className="flex items-start gap-2.5">
                <AlertTriangle className="h-4 w-4 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                <div>
                  <p className="font-bold">
                    New public orders are paused — complete your in-flight print
                    jobs below or renew Print Pro
                  </p>
                  <p className="mt-0.5 opacity-90">
                    Your {inFlightOrdersCount} active order
                    {inFlightOrdersCount === 1 ? '' : 's'} remain fully
                    accessible for printing, OTP handover, and settlement.
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setActiveSubTab('queue')}
                className="inline-flex h-8 shrink-0 items-center justify-center rounded-lg bg-amber-600 px-3 text-xs font-bold text-white hover:bg-amber-700 cursor-pointer"
              >
                Open In-Flight Queue ({inFlightOrdersCount})
              </button>
            </div>
          )}

          {/* Owner Mode: Upgrade to Print & Digital Pro Card when NOT entitled */}
          {!isStaff && !hasEntitlement && !profile?.is_first_party_printswift && (
            <section
              data-testid="upgrade-print-pro-card"
              className="rounded-2xl border border-theme-primary/30 bg-[var(--ps-surface)] p-5 space-y-4"
            >
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <div className="space-y-1">
                  <div className="inline-flex items-center gap-1.5 text-xs font-bold text-theme-primary">
                    <Sparkles className="h-4 w-4" />
                    <span>Unlock Online Print &amp; Digital Ordering</span>
                  </div>
                  <h3 className="text-base font-extrabold text-[var(--ps-text)]">
                    Upgrade to Print &amp; Digital Pro
                  </h3>
                  <p className="text-xs text-[var(--ps-text-muted)] max-w-2xl leading-relaxed">
                    Accept PDF &amp; multi-photo orders directly from DD oodle,
                    publish verified capability badges &amp; rate cards, receive
                    Direct Counter/UPI or DD oodle Escrow payouts, and auto-purge
                    customer documents after 48 hours.
                  </p>
                </div>
              </div>

              {availablePlans.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-300 dark:border-slate-700 p-4 text-xs text-[var(--ps-text-muted)]">
                  Print &amp; Digital Pro subscription plans are currently being
                  configured by your Hub administrator. Check back shortly.
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  {availablePlans.map((plan) => {
                    const maxMonthly = Number(
                      plan.entitlements?.max_monthly_orders ?? 500
                    );
                    const isBusy = subscribingPlanId === plan.id;
                    return (
                      <div
                        key={plan.id}
                        className="flex flex-col justify-between rounded-xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-bg)] p-4 space-y-3"
                      >
                        <div>
                          <div className="flex items-baseline justify-between gap-2">
                            <h4 className="text-sm font-bold text-[var(--ps-text)]">
                              {plan.name}
                            </h4>
                            <span className="font-mono text-base font-extrabold tabular-nums text-theme-primary">
                              {formatInr(plan.price_inr)}
                            </span>
                          </div>
                          <p className="mt-1 text-[11px] text-[var(--ps-text-muted)] tabular-nums">
                            {plan.duration_days} days · Up to{' '}
                            {maxMonthly.toLocaleString('en-IN')} orders/mo ·
                            Instant Print + Custom Digital + Escrow
                          </p>
                        </div>

                        <button
                          type="button"
                          disabled={isBusy}
                          onClick={() => void handleStartPrintProCheckout(plan)}
                          data-testid={`subscribe-print-pro-${plan.slug}`}
                          className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-xl bg-theme-primary px-3.5 text-xs font-bold text-theme-primary-foreground shadow-xs hover:opacity-95 disabled:opacity-60 cursor-pointer"
                        >
                          {isBusy ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <CreditCard className="h-3.5 w-3.5" />
                          )}
                          <span>Subscribe &amp; Activate</span>
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </section>
          )}

          {/* Staff Mode Guard: No Active Print Profile & No Orders */}
          {isStaff && !profile && orders.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 bg-[var(--ps-surface)] p-6 text-center space-y-2">
              <Printer className="mx-auto h-6 w-6 text-[var(--ps-text-muted)] opacity-60" />
              <p className="text-sm font-bold text-[var(--ps-text)]">
                Print &amp; Digital Counter Not Active for {selectedListing?.title}
              </p>
              <p className="text-xs text-[var(--ps-text-muted)] max-w-md mx-auto">
                The listing owner needs to activate Print &amp; Digital Pro and
                configure the counter setup before incoming print orders appear
                in your staff fulfillment queue.
              </p>
            </div>
          )}

          {/* Owner Mode Sub-Tabs (Strictly Hidden in Staff Mode) */}
          {!isStaff && (
            <nav
              aria-label="Print and digital manager sections"
              className="flex items-center gap-1.5 overflow-x-auto pb-1"
            >
              {[
                {
                  id: 'queue' as const,
                  label: `Live Print Queue (${orders.length})`,
                  icon: Printer,
                },
                {
                  id: 'setup' as const,
                  label: 'Counter Setup & Policy',
                  icon: ShieldCheck,
                },
                {
                  id: 'settlements' as const,
                  label: `Escrow Settlements (${settlements.length})`,
                  icon: Wallet,
                },
              ].map((tab) => {
                const Icon = tab.icon;
                const active = activeSubTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveSubTab(tab.id)}
                    data-testid={`print-subtab-${tab.id}`}
                    className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg px-3 text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                      active
                        ? 'bg-theme-primary text-theme-primary-foreground shadow-xs'
                        : 'border border-slate-200 dark:border-slate-800 bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                    }`}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </nav>
          )}

          {/* =============================================================== */}
          {/* SUB-TAB 1: COUNTER SETUP & DUAL-PAYMENT POLICY (OWNER ONLY)     */}
          {/* =============================================================== */}
          {!isStaff && activeSubTab === 'setup' && (
            <form onSubmit={handleSaveCounterSetup} className="space-y-4">
              {/* Live Status & 1-Tap Quick Pause Controls */}
              <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-surface)] p-4 sm:p-5 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <h3 className="text-sm font-bold text-[var(--ps-text)]">
                      Live Counter Status &amp; Quick Pause
                    </h3>
                    <p className="text-xs text-[var(--ps-text-muted)]">
                      Pause instantly during power cuts, toner swaps, or peak
                      counter queues without affecting existing orders.
                    </p>
                  </div>

                  <button
                    type="button"
                    role="switch"
                    aria-checked={isAcceptingOrders && !isCurrentlyBusyPaused}
                    disabled={isPauseBusy}
                    onClick={() => void handleQuickPauseAction('toggle_accepting')}
                    data-testid="print-accepting-toggle"
                    className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-xl px-3.5 text-xs font-bold transition-colors cursor-pointer disabled:opacity-60 ${
                      isAcceptingOrders && !isCurrentlyBusyPaused
                        ? 'bg-emerald-600 text-white hover:bg-emerald-700'
                        : 'border border-slate-300 dark:border-slate-700 bg-[var(--ps-bg)] text-[var(--ps-text)] hover:border-theme-primary/50'
                    }`}
                  >
                    {isPauseBusy ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : isAcceptingOrders && !isCurrentlyBusyPaused ? (
                      <PlayCircle className="h-3.5 w-3.5" />
                    ) : (
                      <PauseCircle className="h-3.5 w-3.5" />
                    )}
                    <span>
                      {isAcceptingOrders && !isCurrentlyBusyPaused
                        ? 'Accepting Orders'
                        : isCurrentlyBusyPaused
                          ? 'Temporarily Paused'
                          : 'Orders Paused'}
                    </span>
                  </button>
                </div>

                {/* 1-Tap Pause & Resume Controls */}
                <div className="flex flex-wrap items-center gap-2 pt-1">
                  <button
                    type="button"
                    disabled={isPauseBusy}
                    onClick={() => void handleQuickPauseAction('pause_1h')}
                    data-testid="print-pause-1h-btn"
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 text-xs font-semibold text-amber-800 dark:text-amber-200 hover:bg-amber-500/20 disabled:opacity-50 cursor-pointer"
                  >
                    <Clock className="h-3.5 w-3.5" />
                    <span>Pause 1 Hr</span>
                  </button>
                  <button
                    type="button"
                    disabled={isPauseBusy}
                    onClick={() => void handleQuickPauseAction('pause_eod')}
                    data-testid="print-pause-eod-btn"
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 text-xs font-semibold text-amber-800 dark:text-amber-200 hover:bg-amber-500/20 disabled:opacity-50 cursor-pointer"
                  >
                    <PauseCircle className="h-3.5 w-3.5" />
                    <span>Pause Rest of Day</span>
                  </button>
                  <button
                    type="button"
                    disabled={isPauseBusy}
                    onClick={() => void handleQuickPauseAction('resume')}
                    data-testid="print-resume-now-btn"
                    className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-3 text-xs font-semibold text-emerald-800 dark:text-emerald-200 hover:bg-emerald-500/20 disabled:opacity-50 cursor-pointer"
                  >
                    <PlayCircle className="h-3.5 w-3.5" />
                    <span>Resume Now</span>
                  </button>

                  {isCurrentlyBusyPaused && busyUntil && (
                    <span className="text-[11px] font-semibold text-amber-700 dark:text-amber-300">
                      Auto-resumes {formatDateTime(busyUntil)}
                    </span>
                  )}
                </div>
              </section>

              {/* Capabilities & Verification Status */}
              <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-surface)] p-4 sm:p-5 space-y-3">
                <div>
                  <h3 className="text-sm font-bold text-[var(--ps-text)]">
                    Hardware &amp; Digital Capabilities
                  </h3>
                  <p className="text-xs text-[var(--ps-text-muted)]">
                    Declare the services available at your counter. Hub
                    verification unlocks Explore capability filters.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {CAPABILITY_ITEMS.map((item) => {
                    const checked = Boolean(capabilities[item.key]);
                    const isVerified =
                      profile?.verified_capabilities?.[item.key] === true;
                    return (
                      <label
                        key={item.key}
                        className={`flex items-start justify-between gap-3 rounded-xl border p-3 transition-colors cursor-pointer ${
                          checked
                            ? 'border-theme-primary/40 bg-theme-primary/5'
                            : 'border-slate-200 dark:border-slate-800 bg-[var(--ps-bg)]'
                        }`}
                      >
                        <div className="flex items-start gap-2.5 min-w-0">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={(e) =>
                              setCapabilities((prev) => ({
                                ...prev,
                                [item.key]: e.target.checked,
                              }))
                            }
                            className="mt-0.5 h-4 w-4 rounded border-slate-300 accent-[var(--color-primary)]"
                          />
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-[var(--ps-text)]">
                              {item.label}
                            </p>
                            <p className="text-[11px] text-[var(--ps-text-muted)]">
                              {item.hint}
                            </p>
                          </div>
                        </div>

                        {checked && (
                          <span
                            className={`shrink-0 text-[10px] font-bold whitespace-nowrap ${
                              isVerified
                                ? 'text-emerald-700 dark:text-emerald-400'
                                : 'text-amber-700 dark:text-amber-400'
                            }`}
                          >
                            {isVerified
                              ? 'Verified ✓'
                              : 'Pending Hub Verification'}
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </section>

              {/* Rate Card, Bulk Discounts & Turnaround */}
              <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-surface)] p-4 sm:p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-[var(--ps-text)]">
                      Rate Card &amp; Counter Preferences
                    </h3>
                    <p className="text-xs text-[var(--ps-text-muted)]">
                      Saving rate changes automatically bumps your pricing
                      version so existing quoted orders stay locked.
                    </p>
                  </div>
                  <span className="font-mono text-xs font-semibold text-[var(--ps-text-muted)] tabular-nums">
                    Current: v{profile?.pricing_version ?? 1}
                  </span>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                  {[
                    { key: 'bw_a4_single_inr', label: 'B&W A4 Single (₹/pg)' },
                    { key: 'bw_a4_duplex_inr', label: 'B&W A4 Duplex (₹/sh)' },
                    {
                      key: 'color_a4_single_inr',
                      label: 'Color A4 Single (₹/pg)',
                    },
                    {
                      key: 'color_a4_duplex_inr',
                      label: 'Color A4 Duplex (₹/sh)',
                    },
                    { key: 'a3_bw_inr', label: 'A3 B&W (₹/pg)' },
                    { key: 'a3_color_inr', label: 'A3 Color (₹/pg)' },
                    {
                      key: 'spiral_binding_inr',
                      label: 'Spiral Binding (₹/doc)',
                    },
                    {
                      key: 'lamination_per_sheet_inr',
                      label: 'Lamination (₹/sh)',
                    },
                    { key: 'staple_inr', label: 'Staple (₹/doc)' },
                    {
                      key: 'sealed_envelope_inr',
                      label: 'Sealed Envelope (₹)',
                    },
                    { key: 'min_order_inr', label: 'Minimum Order (₹)' },
                  ].map((field) => (
                    <div key={field.key} className="space-y-1">
                      <label className="block text-[11px] font-semibold text-[var(--ps-text-muted)]">
                        {field.label}
                      </label>
                      <input
                        type="number"
                        step="0.5"
                        min="0"
                        value={rateInputs[field.key] ?? ''}
                        onChange={(e) =>
                          setRateInputs((prev) => ({
                            ...prev,
                            [field.key]: e.target.value,
                          }))
                        }
                        placeholder="0"
                        className="h-9 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-[var(--ps-bg)] px-2.5 font-mono text-xs tabular-nums text-[var(--ps-text)] focus:border-theme-primary focus:outline-none"
                      />
                    </div>
                  ))}
                </div>

                {/* Bulk Discount Tiers */}
                <div className="space-y-2 border-t border-slate-200/80 dark:border-slate-800 pt-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-bold text-[var(--ps-text)]">
                      Bulk Page Discount Tiers (Optional)
                    </span>
                    <button
                      type="button"
                      onClick={() =>
                        setBulkDiscounts((prev) => [
                          ...prev,
                          { min_pages: 50, discount_percent: 10 },
                        ])
                      }
                      className="inline-flex h-7 items-center gap-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-[var(--ps-bg)] px-2.5 text-[11px] font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] cursor-pointer"
                    >
                      <Plus className="h-3 w-3" />
                      <span>Add Tier</span>
                    </button>
                  </div>

                  {bulkDiscounts.length > 0 && (
                    <div className="space-y-2">
                      {bulkDiscounts.map((tier, idx) => (
                        <div
                          key={idx}
                          className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-bg)] p-2"
                        >
                          <label className="flex items-center gap-1.5 text-xs text-[var(--ps-text-muted)]">
                            <span>Min pages:</span>
                            <input
                              type="number"
                              min="1"
                              value={tier.min_pages}
                              onChange={(e) => {
                                const val = Math.max(
                                  1,
                                  Math.round(Number(e.target.value) || 0)
                                );
                                setBulkDiscounts((prev) =>
                                  prev.map((row, i) =>
                                    i === idx ? { ...row, min_pages: val } : row
                                  )
                                );
                              }}
                              className="h-8 w-20 rounded-lg border border-slate-200 dark:border-slate-700 bg-[var(--ps-surface)] px-2 font-mono text-xs tabular-nums text-[var(--ps-text)]"
                            />
                          </label>
                          <label className="flex items-center gap-1.5 text-xs text-[var(--ps-text-muted)]">
                            <span>Discount %:</span>
                            <input
                              type="number"
                              min="1"
                              max="60"
                              value={tier.discount_percent}
                              onChange={(e) => {
                                const val = Math.max(
                                  1,
                                  Math.min(60, Number(e.target.value) || 0)
                                );
                                setBulkDiscounts((prev) =>
                                  prev.map((row, i) =>
                                    i === idx
                                      ? { ...row, discount_percent: val }
                                      : row
                                  )
                                );
                              }}
                              className="h-8 w-20 rounded-lg border border-slate-200 dark:border-slate-700 bg-[var(--ps-surface)] px-2 font-mono text-xs tabular-nums text-[var(--ps-text)]"
                            />
                          </label>
                          <button
                            type="button"
                            onClick={() =>
                              setBulkDiscounts((prev) =>
                                prev.filter((_, i) => i !== idx)
                              )
                            }
                            aria-label="Remove bulk discount tier"
                            className="ml-auto inline-flex h-8 w-8 items-center justify-center rounded-lg text-rose-600 hover:bg-rose-500/10 cursor-pointer"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                {/* Turnaround, Max File Size & Pickup Instructions */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-slate-200/80 dark:border-slate-800 pt-3">
                  <CustomSelectModal
                    label="Turnaround Badge"
                    options={TURNAROUND_OPTIONS}
                    value={turnaroundBadge}
                    onChange={(v) =>
                      setTurnaroundBadge(v as PrintTurnaroundBadge)
                    }
                    testId="print-turnaround-select"
                  />

                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-[var(--ps-text)]">
                      Max File Size (MB, up to 25 MB)
                    </label>
                    <input
                      type="number"
                      min="5"
                      max="25"
                      value={maxFileSizeMb}
                      onChange={(e) => setMaxFileSizeMb(e.target.value)}
                      className="h-11 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-[var(--ps-bg)] px-3 font-mono text-xs tabular-nums text-[var(--ps-text)] focus:border-theme-primary focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="block text-xs font-semibold text-[var(--ps-text)]">
                      Express Turnaround ETA (Mins)
                    </label>
                    <input
                      type="number"
                      min="10"
                      max="1440"
                      value={expressEtaMins}
                      onChange={(e) => setExpressEtaMins(e.target.value)}
                      className="h-11 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-[var(--ps-bg)] px-3 font-mono text-xs tabular-nums text-[var(--ps-text)] focus:border-theme-primary focus:outline-none"
                    />
                  </div>

                  <label className="flex items-center gap-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-[var(--ps-bg)] px-3 py-2.5 text-xs font-semibold text-[var(--ps-text)] cursor-pointer self-end h-11">
                    <input
                      type="checkbox"
                      checked={supportsPickNDrop}
                      onChange={(e) => setSupportsPickNDrop(e.target.checked)}
                      className="h-4 w-4 rounded accent-blue-600"
                    />
                    <span>Supports Pick N Drop Rider Delivery</span>
                  </label>
                </div>

                <div className="space-y-1.5">
                  <label className="block text-xs font-semibold text-[var(--ps-text)]">
                    Pickup Counter Instructions (Shown to Customers)
                  </label>
                  <textarea
                    rows={2}
                    value={pickupInstructions}
                    onChange={(e) => setPickupInstructions(e.target.value)}
                    placeholder="e.g., Ground floor counter beside SBI ATM. Show your 4-digit OTP at Window 2."
                    className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-[var(--ps-bg)] px-3 py-2 text-xs text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:border-theme-primary focus:outline-none"
                  />
                </div>
              </section>

              {/* Dual-Payment Policy Card */}
              <section className="rounded-2xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-surface)] p-4 sm:p-5 space-y-4">
                <div>
                  <h3 className="text-sm font-bold text-[var(--ps-text)]">
                    Dual-Rail Payment Policy
                  </h3>
                  <p className="text-xs text-[var(--ps-text-muted)]">
                    Allow fast direct counter/UPI payment for walk-ins up to
                    your cap while using DD oodle Escrow for larger orders and
                    Pick N Drop deliveries.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="flex items-start gap-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-bg)] p-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allowDirectPay}
                      onChange={(e) => setAllowDirectPay(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded accent-[var(--color-primary)]"
                    />
                    <div>
                      <p className="text-xs font-bold text-[var(--ps-text)]">
                        Allow Direct-to-Shop Payment
                      </p>
                      <p className="text-[11px] text-[var(--ps-text-muted)]">
                        Walk-in customers can pay Cash at Counter or via your
                        Shop UPI below your cap.
                      </p>
                    </div>
                  </label>

                  <label className="flex items-start gap-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-bg)] p-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={allowEscrow}
                      onChange={(e) => setAllowEscrow(e.target.checked)}
                      className="mt-0.5 h-4 w-4 rounded accent-[var(--color-primary)]"
                    />
                    <div>
                      <p className="text-xs font-bold text-[var(--ps-text)]">
                        Allow DD oodle Platform Escrow
                      </p>
                      <p className="text-[11px] text-[var(--ps-text-muted)]">
                        Required for Pick N Drop deliveries, orders above your
                        direct-pay cap, and high no-show accounts.
                      </p>
                    </div>
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="space-y-1">
                    <label className="block text-[11px] font-semibold text-[var(--ps-text-muted)]">
                      Direct-Pay Max Cap (₹)
                    </label>
                    <input
                      type="number"
                      min="0"
                      max="50000"
                      step="10"
                      value={directPayMaxInr}
                      onChange={(e) => setDirectPayMaxInr(e.target.value)}
                      className="h-9 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-[var(--ps-bg)] px-2.5 font-mono text-xs tabular-nums text-[var(--ps-text)] focus:border-theme-primary focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1">
                    <div className="flex items-center justify-between gap-1">
                      <label className="block text-[11px] font-semibold text-[var(--ps-text-muted)]">
                        Shop UPI ID
                      </label>
                      {shopUpiId.trim() && (
                        <span
                          className={`text-[10px] font-bold ${
                            profile?.payment_policy?.shop_upi_verified &&
                            shopUpiId.trim() ===
                              profile?.payment_policy?.shop_upi_id
                              ? 'text-emerald-700 dark:text-emerald-400'
                              : 'text-amber-700 dark:text-amber-400'
                          }`}
                        >
                          {profile?.payment_policy?.shop_upi_verified &&
                          shopUpiId.trim() ===
                            profile?.payment_policy?.shop_upi_id
                            ? 'UPI Verified ✓'
                            : 'Pending Hub Verification'}
                        </span>
                      )}
                    </div>
                    <input
                      type="text"
                      value={shopUpiId}
                      onChange={(e) => setShopUpiId(e.target.value)}
                      placeholder="yourshop@upi"
                      className="h-9 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-[var(--ps-bg)] px-2.5 font-mono text-xs text-[var(--ps-text)] focus:border-theme-primary focus:outline-none"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="block text-[11px] font-semibold text-[var(--ps-text-muted)]">
                      Shop UPI Payee Name
                    </label>
                    <input
                      type="text"
                      value={shopUpiName}
                      onChange={(e) => setShopUpiName(e.target.value)}
                      placeholder="e.g., New Lamka Digital Print"
                      className="h-9 w-full rounded-lg border border-slate-200 dark:border-slate-700 bg-[var(--ps-bg)] px-2.5 text-xs text-[var(--ps-text)] focus:border-theme-primary focus:outline-none"
                    />
                  </div>
                </div>

                {/* Form Save Footer */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-200/80 dark:border-slate-800 pt-3">
                  <button
                    type="button"
                    onClick={() => setIsQrPosterOpen(true)}
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-[var(--ps-bg)] px-3.5 text-xs font-semibold text-[var(--ps-text)] hover:border-theme-primary/50 cursor-pointer"
                  >
                    <QrCode className="h-3.5 w-3.5 text-theme-primary" />
                    <span>Open Counter QR Poster</span>
                  </button>

                  <button
                    type="submit"
                    disabled={isSavingProfile}
                    data-testid="save-print-counter-setup-btn"
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-theme-primary px-4 text-xs font-bold text-theme-primary-foreground shadow-xs hover:opacity-95 disabled:opacity-60 cursor-pointer"
                  >
                    {isSavingProfile ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                    <span>Save Counter Setup &amp; Rates</span>
                  </button>
                </div>
              </section>
            </form>
          )}

          {/* =============================================================== */}
          {/* SUB-TAB 2: LIVE PRINT & DIGITAL QUEUE (OWNER + STAFF)           */}
          {/* =============================================================== */}
          {(isStaff || activeSubTab === 'queue') && (
            <section className="space-y-3 min-w-0">
              <WorkspaceTableToolbar
                searchQuery={queueSearch}
                onSearchChange={setQueueSearch}
                searchPlaceholder="Search by order code, service, instructions…"
                filteredCount={filteredOrders.length}
                totalCount={orders.length}
                countLabel="orders"
                hasActiveFilters={Boolean(
                  queueSearch || queueFilter !== 'all'
                )}
                onResetFilters={() => {
                  setQueueSearch('');
                  setQueueFilter('all');
                }}
              >
                <div className="flex items-center gap-1 overflow-x-auto no-scrollbar py-0.5">
                  {(
                    [
                      { id: 'all', label: 'All' },
                      { id: 'awaiting_quote', label: 'Awaiting Quote' },
                      { id: 'confirmed', label: 'Confirmed' },
                      { id: 'printing', label: 'Printing' },
                      { id: 'ready', label: 'Ready' },
                      { id: 'completed', label: 'Collected/Handed Over' },
                    ] as const
                  ).map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setQueueFilter(f.id)}
                      className={`h-7 px-2.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                        queueFilter === f.id
                          ? 'bg-theme-primary text-theme-primary-foreground'
                          : 'border border-slate-200 dark:border-slate-800 bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </WorkspaceTableToolbar>

              {filteredOrders.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 bg-[var(--ps-surface)] p-8 text-center space-y-1.5">
                  <Printer className="mx-auto h-6 w-6 text-[var(--ps-text-muted)] opacity-60" />
                  <p className="text-sm font-bold text-[var(--ps-text)]">
                    {orders.length === 0
                      ? 'No Print & Digital orders yet'
                      : 'No orders match your search or status filter'}
                  </p>
                  <p className="text-xs text-[var(--ps-text-muted)]">
                    {orders.length === 0
                      ? 'Share your Printable Counter QR Poster at the desk to start receiving direct PDF and photo jobs.'
                      : 'Try clearing your search term or switching back to All orders.'}
                  </p>
                </div>
              ) : (
                <ResponsiveTableScroll
                  minWidthClass="min-w-[880px]"
                  showSwipeHint={true}
                  swipeHintLabel="Swipe ↔ to view files, status & OTP handover actions"
                >
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-950/60 text-[11px] font-bold text-slate-500 dark:text-slate-400">
                        <th className="py-2.5 px-3">Order &amp; Mode</th>
                        <th className="py-2.5 px-3">Documents &amp; Specs</th>
                        <th className="py-2.5 px-3">Payment &amp; Amount</th>
                        <th className="py-2.5 px-3">Lifecycle Status</th>
                        <th className="py-2.5 px-3 text-right">
                          Counter Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800/70">
                      {filteredOrders.map((order) => {
                        const isBusy = busyOrderId === order.id;
                        const isActiveFileWindow = [
                          'confirmed',
                          'printing',
                          'ready_for_pickup',
                        ].includes(order.fulfillment_status);
                        const isPurged =
                          order.files_purged_at !== null ||
                          order.purge_status === 'purged';
                        const isDirectRail =
                          order.payment_rail === 'direct_counter' ||
                          order.payment_rail === 'direct_shop_upi';

                        const readyMs = order.ready_at_iso
                          ? Date.parse(order.ready_at_iso)
                          : NaN;
                        const canReportNoShow =
                          isDirectRail &&
                          order.fulfillment_status === 'ready_for_pickup' &&
                          order.collected_at === null &&
                          Number.isFinite(readyMs) &&
                          nowMs - readyMs > NO_SHOW_THRESHOLD_MS;

                        return (
                          <tr
                            key={order.id}
                            className="align-top hover:bg-slate-50/60 dark:hover:bg-slate-900/40"
                          >
                            {/* Col 1: Order & Mode */}
                            <td className="py-3 px-3 space-y-1">
                              <div className="font-mono text-xs font-extrabold text-[var(--ps-text)] tabular-nums">
                                {order.order_code}
                              </div>
                              <div className="text-[11px] text-[var(--ps-text-muted)]">
                                {order.job_mode === 'custom_digital'
                                  ? 'Custom Digital'
                                  : 'Instant Print'}{' '}
                                ·{' '}
                                {order.handover_mode === 'pick_n_drop'
                                  ? 'Pick N Drop'
                                  : 'Walk-In'}
                              </div>
                              {order.service_category_slug && (
                                <div className="text-[11px] font-medium text-theme-primary">
                                  {order.service_category_slug.replace(
                                    /_/g,
                                    ' '
                                  )}
                                </div>
                              )}
                              {order.sealed_envelope_requested && (
                                <div className="inline-flex items-center gap-1 text-[10px] font-bold text-amber-700 dark:text-amber-300">
                                  <ShieldCheck className="h-3 w-3" />
                                  <span>Sealed Envelope Required</span>
                                </div>
                              )}
                              <div className="text-[10px] text-[var(--ps-text-muted)] tabular-nums">
                                {formatDateTime(order.created_at)}
                              </div>
                            </td>

                            {/* Col 2: Files & Print Specs */}
                            <td className="py-3 px-3 max-w-[260px] space-y-1.5">
                              {isPurged ? (
                                <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                                  <ShieldCheck className="h-3.5 w-3.5" />
                                  <span>Files Purged ✓</span>
                                </span>
                              ) : order.files.length === 0 ? (
                                <span className="text-[11px] text-[var(--ps-text-muted)]">
                                  No files attached
                                </span>
                              ) : (
                                <div className="space-y-1.5">
                                  {order.files.map((file) => {
                                    const filePurged =
                                      file.purge_status === 'purged' ||
                                      file.purged_at !== null;
                                    const canOpenSigned =
                                      isActiveFileWindow && !filePurged;
                                    return (
                                      <div
                                        key={file.id}
                                        className="rounded-lg border border-slate-200/80 dark:border-slate-800 bg-[var(--ps-bg)] px-2 py-1.5 space-y-1"
                                      >
                                        <div className="flex items-center justify-between gap-1.5">
                                          <span className="truncate font-medium text-[11px] text-[var(--ps-text)]">
                                            {file.display_label_masked}
                                          </span>
                                          {filePurged ? (
                                            <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 whitespace-nowrap">
                                              Purged ✓
                                            </span>
                                          ) : canOpenSigned ? (
                                            <button
                                              type="button"
                                              disabled={
                                                downloadingFileId === file.id
                                              }
                                              onClick={() =>
                                                void handleOpenSignedPdf(
                                                  order.id,
                                                  file
                                                )
                                              }
                                              className="inline-flex h-6 shrink-0 items-center gap-1 rounded-md bg-theme-primary px-2 text-[10px] font-bold text-theme-primary-foreground hover:opacity-95 disabled:opacity-50 cursor-pointer"
                                            >
                                              {downloadingFileId === file.id ? (
                                                <Loader2 className="h-2.5 w-2.5 animate-spin" />
                                              ) : (
                                                <FileText className="h-2.5 w-2.5" />
                                              )}
                                              <span>5-Min PDF</span>
                                              <ExternalLink className="h-2.5 w-2.5" />
                                            </button>
                                          ) : (
                                            <span className="text-[10px] text-[var(--ps-text-muted)] whitespace-nowrap">
                                              Locked
                                            </span>
                                          )}
                                        </div>
                                        <p className="text-[10px] text-[var(--ps-text-muted)] tabular-nums">
                                          {describeFileOptions(file)}
                                        </p>
                                      </div>
                                    );
                                  })}
                                </div>
                              )}
                              {order.customer_instructions && (
                                <p className="text-[11px] text-[var(--ps-text-muted)] line-clamp-2">
                                  Note: {order.customer_instructions}
                                </p>
                              )}
                            </td>

                            {/* Col 3: Payment & Amount */}
                            <td className="py-3 px-3 whitespace-nowrap space-y-1">
                              <div className="font-mono text-xs font-extrabold tabular-nums text-[var(--ps-text)]">
                                {order.quoted_amount_inr !== null
                                  ? formatInr(order.quoted_amount_inr)
                                  : 'Awaiting Quote'}
                              </div>
                              <div className="text-[11px] text-[var(--ps-text-muted)]">
                                {order.payment_rail === 'platform_escrow'
                                  ? 'DD oodle Escrow'
                                  : order.payment_rail === 'direct_shop_upi'
                                    ? 'Direct Shop UPI'
                                    : 'Pay at Counter'}
                              </div>
                              <div className="text-[10px] font-semibold capitalize text-[var(--ps-text-muted)]">
                                {order.payment_status.replace(/_/g, ' ')}
                              </div>
                            </td>

                            {/* Col 4: Lifecycle Status */}
                            <td className="py-3 px-3 whitespace-nowrap space-y-1">
                              <div
                                className={`text-xs font-bold capitalize ${
                                  order.fulfillment_status === 'collected' ||
                                  order.fulfillment_status === 'handed_to_rider'
                                    ? 'text-emerald-700 dark:text-emerald-400'
                                    : order.fulfillment_status ===
                                        'ready_for_pickup'
                                      ? 'text-theme-primary'
                                      : order.fulfillment_status === 'cancelled'
                                        ? 'text-rose-600 dark:text-rose-400'
                                        : 'text-[var(--ps-text)]'
                                }`}
                              >
                                {order.fulfillment_status.replace(/_/g, ' ')}
                              </div>
                              <div className="text-[10px] text-[var(--ps-text-muted)] capitalize">
                                Quote: {order.quote_status.replace(/_/g, ' ')}
                              </div>
                              {order.purge_scheduled_at && !isPurged && (
                                <div className="text-[10px] text-amber-700 dark:text-amber-300 tabular-nums">
                                  Purge: {formatDateTime(order.purge_scheduled_at)}
                                </div>
                              )}
                            </td>

                            {/* Col 5: Counter Actions */}
                            <td className="py-3 px-3 text-right">
                              <div className="flex flex-col items-end gap-2">
                                {/* Mode B Quote Sender */}
                                {order.quote_status ===
                                  'awaiting_shop_quote' && (
                                  <button
                                    type="button"
                                    disabled={isBusy}
                                    onClick={() => handleOpenQuoteModal(order)}
                                    data-testid={`send-quote-btn-${order.id}`}
                                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-theme-primary px-3 text-xs font-bold text-theme-primary-foreground hover:opacity-95 disabled:opacity-50 cursor-pointer"
                                  >
                                    <Send className="h-3 w-3" />
                                    <span>Send Quote</span>
                                  </button>
                                )}

                                {/* Status Stepper: Confirmed -> Printing */}
                                {order.fulfillment_status === 'confirmed' && (
                                  <button
                                    type="button"
                                    disabled={isBusy}
                                    onClick={() =>
                                      void callShopAction(
                                        order.id,
                                        {
                                          action: 'update_status',
                                          status: 'printing',
                                        },
                                        `Starting print job ${order.order_code}…`,
                                        `Moved ${order.order_code} to Printing.`
                                      )
                                    }
                                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-theme-primary px-3 text-xs font-bold text-theme-primary-foreground hover:opacity-95 disabled:opacity-50 cursor-pointer"
                                  >
                                    {isBusy ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                      <Printer className="h-3 w-3" />
                                    )}
                                    <span>Start Printing</span>
                                  </button>
                                )}

                                {/* Status Stepper: Printing -> Mark Ready */}
                                {order.fulfillment_status === 'printing' && (
                                  <button
                                    type="button"
                                    disabled={isBusy}
                                    onClick={() =>
                                      void callShopAction(
                                        order.id,
                                        {
                                          action: 'update_status',
                                          status: 'ready_for_pickup',
                                        },
                                        `Marking ${order.order_code} ready…`,
                                        `${order.order_code} is now Ready for Pickup.`
                                      )
                                    }
                                    className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50 cursor-pointer"
                                  >
                                    {isBusy ? (
                                      <Loader2 className="h-3 w-3 animate-spin" />
                                    ) : (
                                      <CheckCircle2 className="h-3 w-3" />
                                    )}
                                    <span>Mark Ready</span>
                                  </button>
                                )}

                                {/* Collection / Rider Handover OTP Verifier */}
                                {order.fulfillment_status ===
                                  'ready_for_pickup' && (
                                  <div className="flex flex-col items-end gap-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-[var(--ps-bg)] p-2 text-left">
                                    <div className="flex items-center gap-1.5">
                                      <KeyRound className="h-3 w-3 text-theme-primary shrink-0" />
                                      <input
                                        type="text"
                                        inputMode="numeric"
                                        maxLength={4}
                                        value={otpInputs[order.id] || ''}
                                        onChange={(e) =>
                                          setOtpInputs((prev) => ({
                                            ...prev,
                                            [order.id]: e.target.value.replace(
                                              /\D/g,
                                              ''
                                            ),
                                          }))
                                        }
                                        placeholder="4-digit OTP"
                                        aria-label={`Collection OTP for ${order.order_code}`}
                                        className="h-7 w-24 rounded-md border border-slate-300 dark:border-slate-700 bg-[var(--ps-surface)] px-2 font-mono text-xs font-bold tracking-widest text-[var(--ps-text)] focus:border-theme-primary focus:outline-none"
                                      />
                                      <button
                                        type="button"
                                        disabled={isBusy}
                                        onClick={() =>
                                          void handleVerifyOtpHandover(order)
                                        }
                                        className="inline-flex h-7 items-center gap-1 rounded-md bg-theme-primary px-2.5 text-[11px] font-bold text-theme-primary-foreground hover:opacity-95 disabled:opacity-50 cursor-pointer"
                                      >
                                        {isBusy ? (
                                          <Loader2 className="h-3 w-3 animate-spin" />
                                        ) : order.handover_mode ===
                                          'pick_n_drop' ? (
                                          <Truck className="h-3 w-3" />
                                        ) : (
                                          <CheckCircle2 className="h-3 w-3" />
                                        )}
                                        <span>
                                          {order.handover_mode === 'pick_n_drop'
                                            ? 'Hand to Rider'
                                            : 'Verify OTP'}
                                        </span>
                                      </button>
                                    </div>

                                    {isDirectRail && (
                                      <label className="inline-flex items-center gap-1.5 text-[10px] font-semibold text-[var(--ps-text-muted)] cursor-pointer">
                                        <input
                                          type="checkbox"
                                          checked={Boolean(
                                            directPaidChecked[order.id]
                                          )}
                                          onChange={(e) =>
                                            setDirectPaidChecked((prev) => ({
                                              ...prev,
                                              [order.id]: e.target.checked,
                                            }))
                                          }
                                          className="h-3.5 w-3.5 rounded accent-[var(--color-primary)]"
                                        />
                                        <span>Direct Cash/UPI Collected</span>
                                      </label>
                                    )}

                                    {canReportNoShow && (
                                      <button
                                        type="button"
                                        disabled={isBusy}
                                        onClick={() =>
                                          void callShopAction(
                                            order.id,
                                            { action: 'report_no_show' },
                                            `Reporting no-show for ${order.order_code}…`,
                                            `Recorded no-show for ${order.order_code} and scheduled file purge.`
                                          )
                                        }
                                        className="inline-flex h-7 items-center gap-1 rounded-md border border-rose-500/35 bg-rose-500/10 px-2 text-[10px] font-bold text-rose-700 dark:text-rose-300 hover:bg-rose-500/20 disabled:opacity-50 cursor-pointer"
                                      >
                                        <AlertTriangle className="h-3 w-3" />
                                        <span>Report No-Show (&gt;48h)</span>
                                      </button>
                                    )}
                                  </div>
                                )}

                                {['collected', 'handed_to_rider'].includes(
                                  order.fulfillment_status
                                ) && (
                                  <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-400">
                                    {order.fulfillment_status ===
                                    'handed_to_rider'
                                      ? 'Handed to Rider ✓'
                                      : 'Collected ✓'}
                                  </span>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </ResponsiveTableScroll>
              )}
            </section>
          )}

          {/* =============================================================== */}
          {/* SUB-TAB 3: ESCROW SETTLEMENTS LEDGER (OWNER ONLY)               */}
          {/* =============================================================== */}
          {!isStaff && activeSubTab === 'settlements' && (
            <section className="space-y-4 min-w-0">
              {/* Compact Settlement Summary Strip */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-surface)] p-3.5">
                  <p className="text-[11px] font-semibold text-[var(--ps-text-muted)]">
                    Locked in Escrow
                  </p>
                  <p className="mt-1 font-mono text-lg font-extrabold tabular-nums text-amber-600 dark:text-amber-400">
                    {formatInr(settlementTotals.locked)}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-surface)] p-3.5">
                  <p className="text-[11px] font-semibold text-[var(--ps-text-muted)]">
                    Eligible for Payout
                  </p>
                  <p className="mt-1 font-mono text-lg font-extrabold tabular-nums text-theme-primary">
                    {formatInr(settlementTotals.eligible)}
                  </p>
                </div>
                <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-surface)] p-3.5">
                  <p className="text-[11px] font-semibold text-[var(--ps-text-muted)]">
                    Total Settled
                  </p>
                  <p className="mt-1 font-mono text-lg font-extrabold tabular-nums text-emerald-600 dark:text-emerald-400">
                    {formatInr(settlementTotals.settled)}
                  </p>
                </div>
              </div>

              <WorkspaceTableToolbar
                searchQuery={settlementSearch}
                onSearchChange={setSettlementSearch}
                searchPlaceholder="Search by order code or payout reference…"
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
                  ).map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setSettlementFilter(f.id)}
                      className={`h-7 px-2.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-colors cursor-pointer ${
                        settlementFilter === f.id
                          ? 'bg-theme-primary text-theme-primary-foreground'
                          : 'border border-slate-200 dark:border-slate-800 bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </WorkspaceTableToolbar>

              {filteredSettlements.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 dark:border-slate-700 bg-[var(--ps-surface)] p-8 text-center space-y-1.5">
                  <Wallet className="mx-auto h-6 w-6 text-[var(--ps-text-muted)] opacity-60" />
                  <p className="text-sm font-bold text-[var(--ps-text)]">
                    {settlements.length === 0
                      ? 'No Escrow Settlements Yet'
                      : 'No settlements match your filters'}
                  </p>
                  <p className="text-xs text-[var(--ps-text-muted)]">
                    Escrow-funded print orders appear here automatically, unlock
                    after Collection OTP handover, and display payout references
                    once settled.
                  </p>
                </div>
              ) : (
                <ResponsiveTableScroll
                  minWidthClass="min-w-[700px]"
                  showSwipeHint={true}
                  swipeHintLabel="Swipe ↔ to view payout amounts and references"
                >
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-200 dark:border-slate-800 bg-slate-50/90 dark:bg-slate-950/60 text-[11px] font-bold text-slate-500 dark:text-slate-400">
                        <th className="py-2.5 px-3">Order Code</th>
                        <th className="py-2.5 px-3 text-right">Gross</th>
                        <th className="py-2.5 px-3 text-right">Platform Fee</th>
                        <th className="py-2.5 px-3 text-right">Net Payable</th>
                        <th className="py-2.5 px-3">Status</th>
                        <th className="py-2.5 px-3">Payout Ref</th>
                        <th className="py-2.5 px-3 text-right">Settled At</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200/70 dark:divide-slate-800/70">
                      {filteredSettlements.map((row) => (
                        <tr
                          key={row.id}
                          className="hover:bg-slate-50/60 dark:hover:bg-slate-900/40"
                        >
                          <td className="py-3 px-3 font-mono font-bold text-[var(--ps-text)] tabular-nums">
                            {row.order_code}
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums text-[var(--ps-text)]">
                            {formatInr(row.gross_amount_inr)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono tabular-nums text-[var(--ps-text-muted)]">
                            {formatInr(row.platform_fee_inr)}
                          </td>
                          <td className="py-3 px-3 text-right font-mono font-extrabold tabular-nums text-[var(--ps-text)]">
                            {formatInr(row.net_payable_inr)}
                          </td>
                          <td className="py-3 px-3 whitespace-nowrap">
                            <span
                              className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-bold capitalize ${
                                row.status === 'settled'
                                  ? 'border-emerald-500/35 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                                  : row.status === 'eligible'
                                    ? 'border-sky-500/35 bg-sky-500/12 text-sky-700 dark:text-sky-300'
                                    : row.status === 'reversed'
                                      ? 'border-rose-500/35 bg-rose-500/12 text-rose-700 dark:text-rose-300'
                                      : 'border-amber-500/35 bg-amber-500/12 text-amber-700 dark:text-amber-300'
                              }`}
                            >
                              {row.status}
                            </span>
                          </td>
                          <td className="py-3 px-3 font-mono text-[11px] text-[var(--ps-text-muted)]">
                            {row.payout_reference || '—'}
                          </td>
                          <td className="py-3 px-3 text-right text-[11px] text-[var(--ps-text-muted)] tabular-nums whitespace-nowrap">
                            {formatDateTime(row.settled_at)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </ResponsiveTableScroll>
              )}
            </section>
          )}
        </>
      )}

      {/* ================================================================= */}
      {/* PORTALED MODE B QUOTE SENDER MODAL (z-[85])                       */}
      {/* ================================================================= */}
      {typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {quoteModalOrder && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.16 }}
                onClick={() => setQuoteModalOrder(null)}
                className="fixed inset-0 z-[85] flex items-center justify-center bg-black/55 backdrop-blur-sm p-4"
              >
                <motion.div
                  role="dialog"
                  aria-modal="true"
                  aria-label={`Send custom quote for ${quoteModalOrder.order_code}`}
                  initial={{ opacity: 0, scale: 0.96, y: 8 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.96, y: 8 }}
                  transition={{ duration: 0.16 }}
                  onClick={(e) => e.stopPropagation()}
                  className="w-full max-w-md rounded-2xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-surface)] p-5 shadow-2xl space-y-4"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <h3 className="text-sm font-extrabold text-[var(--ps-text)]">
                        Send Custom Digital Quote
                      </h3>
                      <p className="text-xs text-[var(--ps-text-muted)] font-mono mt-0.5">
                        {quoteModalOrder.order_code}
                        {quoteModalOrder.service_category_slug
                          ? ` · ${quoteModalOrder.service_category_slug.replace(/_/g, ' ')}`
                          : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setQuoteModalOrder(null)}
                      aria-label="Close quote modal"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 dark:border-slate-700 text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  {quoteModalOrder.customer_instructions && (
                    <div className="rounded-xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-bg)] p-3 text-xs text-[var(--ps-text)]">
                      <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--ps-text-muted)] mb-1">
                        Customer Request
                      </p>
                      <p className="leading-relaxed">
                        {quoteModalOrder.customer_instructions}
                      </p>
                    </div>
                  )}

                  <form
                    onSubmit={handleSubmitCustomQuote}
                    className="space-y-3"
                  >
                    <div className="space-y-1">
                      <label className="block text-xs font-semibold text-[var(--ps-text)]">
                        Quoted Price (₹) *
                      </label>
                      <input
                        type="number"
                        required
                        min="1"
                        max="500000"
                        step="1"
                        value={quotePriceInput}
                        onChange={(e) => setQuotePriceInput(e.target.value)}
                        placeholder="e.g., 150"
                        className="h-9 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-[var(--ps-bg)] px-3 font-mono text-xs tabular-nums text-[var(--ps-text)] focus:border-theme-primary focus:outline-none"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="block text-xs font-semibold text-[var(--ps-text)]">
                        Estimated Turnaround Note *
                      </label>
                      <input
                        type="text"
                        required
                        value={quoteTurnaroundInput}
                        onChange={(e) =>
                          setQuoteTurnaroundInput(e.target.value)
                        }
                        placeholder="e.g., Ready in 2 hours / Today by 5 PM"
                        className="h-9 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)] focus:border-theme-primary focus:outline-none"
                      />
                    </div>

                    <div className="space-y-1">
                      <label className="block text-xs font-semibold text-[var(--ps-text)]">
                        Scope Note (Optional)
                      </label>
                      <textarea
                        rows={2}
                        value={quoteNoteInput}
                        onChange={(e) => setQuoteNoteInput(e.target.value)}
                        placeholder="Include design revisions, print copies, or paper stock details…"
                        className="w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-[var(--ps-bg)] px-3 py-2 text-xs text-[var(--ps-text)] focus:border-theme-primary focus:outline-none"
                      />
                    </div>

                    <div className="flex items-center justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setQuoteModalOrder(null)}
                        className="inline-flex h-9 items-center rounded-xl border border-slate-200 dark:border-slate-700 bg-[var(--ps-bg)] px-3.5 text-xs font-semibold text-[var(--ps-text)] cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="submit"
                        disabled={isSendingQuote}
                        className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-theme-primary px-4 text-xs font-bold text-theme-primary-foreground shadow-xs hover:opacity-95 disabled:opacity-60 cursor-pointer"
                      >
                        {isSendingQuote ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Send className="h-3.5 w-3.5" />
                        )}
                        <span>Send Quote to Customer</span>
                      </button>
                    </div>
                  </form>
                </motion.div>
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}

      {/* Printable Counter QR Poster Modal (z-[90]) */}
      {!isStaff && selectedListing && (
        <CounterQrPosterModal
          open={isQrPosterOpen}
          onClose={() => setIsQrPosterOpen(false)}
          listingId={selectedListing.id}
          shopName={selectedListing.title}
          locality={selectedListing.locality}
          isFirstPartyPrintSwift={Boolean(profile?.is_first_party_printswift)}
          turnaroundLabel={
            TURNAROUND_BADGE_LABELS[turnaroundBadge]?.label || 'Same-Day'
          }
        />
      )}

      {/* Print & Digital Pro Subscription Payment Modal */}
      {!isStaff && (
        <UniversalPaymentModal
          open={Boolean(paymentModalIntent)}
          intent={paymentModalIntent}
          upiId={paymentModalUpi.upiId}
          upiPayeeName={paymentModalUpi.upiPayeeName}
          title={
            paymentModalUpi.planName
              ? `Activate ${paymentModalUpi.planName}`
              : 'Activate Print & Digital Pro'
          }
          subtitle={
            selectedListing
              ? `Shop: ${selectedListing.title}`
              : 'Unlock online print & digital ordering'
          }
          onSubmitted={() => {
            setPaymentModalIntent(null);
            pushBanner(
              'success',
              'Subscription payment submitted! Your Print & Digital Pro plan activates as soon as confirmation completes.'
            );
            void loadShopPrintData(true);
          }}
          onClose={() => setPaymentModalIntent(null)}
        />
      )}
      {confirmPrintDialog}
    </div>
  );
}

export default OwnerPrintManager;
