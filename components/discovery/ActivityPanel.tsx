'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  ArrowRight,
  Bell,
  Car,
  CheckCircle2,
  Clock,
  CreditCard,
  ExternalLink,
  KeyRound,
  Loader2,
  MapPin,
  MessageCircle,
  MessageSquare,
  Receipt,
  RefreshCw,
  ShieldCheck,
  Tag,
  Truck,
  Zap,
} from 'lucide-react';
import { OrderTrackerModal } from '@/components/pickndrop/OrderTrackerModal';
import { UniversalPaymentModal } from '@/components/payments/UniversalPaymentModal';
import { useAppConfig } from '@/components/providers/AppConfigProvider';
import { setAppStatus } from '@/lib/hooks/useAppStatus';
import {
  type PaymentIntentRecord,
  type PaymentPurpose,
  type VehicleBookingRecord,
} from '@/lib/payments/types';
import {
  DELIVERY_STATUS_META,
  SERVICE_MODE_META,
  sanitizePhoneForWhatsApp,
  type DeliveryOrderRecord,
  type DeliveryOrderSecretRecord,
  type DeliveryServiceMode,
} from '@/lib/pick-n-drop/types';
import { useAppStore, useAuth } from '@/lib/store';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import {
  fetchMyActivityLogs,
  fetchMyNotifications,
  mapNotificationRow,
  markNotificationAsRead,
  type LiveActivityLogRecord,
  type LiveNotificationRecord,
  type SupabaseNotificationRow,
} from '@/lib/supabase/notifications';

export interface ActivityPanelProps {
  onBackToExplore?: () => void;
}

type ActivityTab = 'pick_n_drop' | 'vehicles' | 'payments' | 'enquiries';

const VALID_ACTIVITY_TABS: readonly ActivityTab[] = [
  'pick_n_drop',
  'vehicles',
  'payments',
  'enquiries',
];

interface HydratedVehicleBookingRow extends VehicleBookingRecord {
  vehicleTitle: string;
  standLocality: string;
}

interface HydratedEnquiryItem {
  id: string;
  hubId: string | null;
  listingId: string;
  listingTitle: string;
  listingLocality: string;
  senderName: string;
  senderContact: string;
  message: string;
  status: string;
  createdAt: string;
}

const DELIVERY_STEPS = [
  { key: 'awaiting_payment', label: 'Payment' },
  { key: 'payment_confirmed', label: 'Confirmed' },
  { key: 'driver_assigned', label: 'Assigned' },
  { key: 'picked_up', label: 'Picked Up' },
  { key: 'in_transit', label: 'In Transit' },
  { key: 'completed', label: 'Completed' },
] as const;

function resolveDeliveryStepIndex(status: string): number {
  switch (status) {
    case 'awaiting_payment':
    case 'payment_pending_verification':
      return 0;
    case 'payment_confirmed':
      return 1;
    case 'driver_assigned':
      return 2;
    case 'picked_up':
      return 3;
    case 'in_transit':
    case 'delivered_pending_confirm':
    case 'return_in_transit':
      return 4;
    case 'completed':
      return 5;
    default:
      return 0;
  }
}

const PURPOSE_BADGE_MAP: Record<PaymentPurpose, { label: string; cls: string }> = {
  pick_n_drop: {
    label: 'Pick N Drop',
    cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  },
  vehicle_booking: {
    label: 'Vehicle Booking',
    cls: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  },
  bulletin_subscription: {
    label: 'Bulletin Plan',
    cls: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  },
  bulletin_post_pass: {
    label: 'Single Pass',
    cls: 'border-purple-500/30 bg-purple-500/10 text-purple-700 dark:text-purple-300',
  },
};

function getPaymentStatusMeta(status: PaymentIntentRecord['status']): {
  label: string;
  cls: string;
} {
  switch (status) {
    case 'succeeded':
      return {
        label: 'Succeeded',
        cls: 'border-emerald-500/35 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
      };
    case 'pending_manual':
      return {
        label: 'Pending Review',
        cls: 'border-amber-500/35 bg-amber-500/12 text-amber-700 dark:text-amber-300',
      };
    case 'awaiting_payment':
      return {
        label: 'Awaiting Payment',
        cls: 'border-sky-500/35 bg-sky-500/12 text-sky-700 dark:text-sky-300',
      };
    case 'refunded':
      return {
        label: 'Refunded',
        cls: 'border-indigo-500/35 bg-indigo-500/12 text-indigo-700 dark:text-indigo-300',
      };
    case 'rejected':
      return {
        label: 'Rejected',
        cls: 'border-rose-500/35 bg-rose-500/12 text-rose-700 dark:text-rose-300',
      };
    case 'failed':
    default:
      return {
        label: 'Failed',
        cls: 'border-rose-500/35 bg-rose-500/12 text-rose-700 dark:text-rose-300',
      };
  }
}

function getVehicleStatusBadge(status: VehicleBookingRecord['status']): {
  label: string;
  cls: string;
} {
  switch (status) {
    case 'soft_hold':
      return {
        label: 'Soft Hold (20m)',
        cls: 'border-amber-500/35 bg-amber-500/12 text-amber-700 dark:text-amber-300',
      };
    case 'pending_payment_confirm':
      return {
        label: 'Payment Review',
        cls: 'border-sky-500/35 bg-sky-500/12 text-sky-700 dark:text-sky-300',
      };
    case 'confirmed':
      return {
        label: 'Confirmed',
        cls: 'border-emerald-500/35 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
      };
    case 'in_progress':
      return {
        label: 'Trip In Progress',
        cls: 'border-indigo-500/35 bg-indigo-500/12 text-indigo-700 dark:text-indigo-300',
      };
    case 'completed':
      return {
        label: 'Completed',
        cls: 'border-emerald-500/35 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
      };
    case 'cancelled':
    case 'expired':
    default:
      return {
        label: status === 'expired' ? 'Hold Expired' : 'Cancelled',
        cls: 'border-rose-500/35 bg-rose-500/12 text-rose-700 dark:text-rose-300',
      };
  }
}

function formatCountdown(expiresAt: string | null, nowMs: number): string | null {
  if (!expiresAt) return null;
  const diffSec = Math.floor((new Date(expiresAt).getTime() - nowMs) / 1000);
  if (diffSec <= 0) return 'Expired';
  const mins = Math.floor(diffSec / 60);
  const secs = diffSec % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')} left`;
}

export function ActivityPanel({ onBackToExplore }: ActivityPanelProps) {
  const { user: authUser, session: activeSession } = useAuth();
  const { activeHub, hubs, paymentConfig } = useAppConfig();
  const activeHubId = activeHub?.id || '';
  const activeHubName = activeHub?.name || 'Churachandpur';
  const { listings, enquiries: storeEnquiries, markNotificationRead } =
    useAppStore();

  const activeUserId = authUser?.id || activeSession?.user?.id || '';

  const [activeTab, setActiveTab] = useState<ActivityTab>('pick_n_drop');
  const [hubFilterMode, setHubFilterMode] = useState<'all' | 'active'>('all');
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  const [orders, setOrders] = useState<DeliveryOrderRecord[]>([]);
  const [vehicleBookings, setVehicleBookings] = useState<
    HydratedVehicleBookingRow[]
  >([]);
  const [paymentIntents, setPaymentIntents] = useState<PaymentIntentRecord[]>(
    []
  );
  const [remoteEnquiries, setRemoteEnquiries] = useState<HydratedEnquiryItem[]>(
    []
  );
  const [liveNotifications, setLiveNotifications] = useState<
    LiveNotificationRecord[]
  >([]);
  const [liveActivityLogs, setLiveActivityLogs] = useState<
    LiveActivityLogRecord[]
  >([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [markingId, setMarkingId] = useState<string | null>(null);

  // Payment & Tracker modals
  const [activePaymentIntent, setActivePaymentIntent] =
    useState<PaymentIntentRecord | null>(null);
  const [paymentModalMeta, setPaymentModalMeta] = useState<{
    title: string;
    subtitle: string;
  }>({ title: 'Complete Payment', subtitle: '' });
  const [creatingIntentForId, setCreatingIntentForId] = useState<string | null>(
    null
  );
  const [trackerOrderId, setTrackerOrderId] = useState<string | null>(null);
  const [isTrackerOpen, setIsTrackerOpen] = useState(false);

  // Hydrate ?tab= query param on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const param = new URLSearchParams(window.location.search)
      .get('tab')
      ?.trim()
      .toLowerCase();
    if (param && (VALID_ACTIVITY_TABS as readonly string[]).includes(param)) {
      queueMicrotask(() => {
        setActiveTab(param as ActivityTab);
      });
    }
  }, []);

  // Tick every second when viewing soft-hold timers
  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const fetchAllActivityData = useCallback(async () => {
    setIsLoading(true);
    try {
      const canQueryDb = isSupabaseConfigured();
      let uid = activeUserId;
      if (canQueryDb && !uid) {
        const { data } = await supabase.auth.getSession();
        uid = data.session?.user?.id || '';
      }

      const [
        notifs,
        logs,
        ordersRes,
        bookingsRes,
        intentsRes,
        enquiriesRes,
      ] = await Promise.all([
        fetchMyNotifications(uid || undefined),
        fetchMyActivityLogs(uid || undefined),
        canQueryDb && uid
          ? supabase
              .from('delivery_orders')
              .select('*')
              .eq('customer_id', uid)
              .order('created_at', { ascending: false })
              .limit(40)
          : Promise.resolve({ data: null }),
        canQueryDb && uid
          ? supabase
              .from('vehicle_bookings')
              .select('*, vehicle_listings(id, title, stand_locality)')
              .eq('customer_id', uid)
              .order('created_at', { ascending: false })
              .limit(40)
          : Promise.resolve({ data: null }),
        canQueryDb && uid
          ? supabase
              .from('payment_intents')
              .select('*')
              .eq('user_id', uid)
              .order('created_at', { ascending: false })
              .limit(60)
          : Promise.resolve({ data: null }),
        canQueryDb && uid
          ? supabase
              .from('enquiries')
              .select(
                'id, listing_id, sender_name, sender_contact, message, status, created_at, listings(id, title, locality)'
              )
              .order('created_at', { ascending: false })
              .limit(30)
          : Promise.resolve({ data: null }),
      ]);

      setLiveNotifications(notifs);
      setLiveActivityLogs(logs);

      const rawOrders = Array.isArray(ordersRes.data)
        ? (ordersRes.data as DeliveryOrderRecord[])
        : [];
      let secretsByOrderId = new Map<string, DeliveryOrderSecretRecord>();
      if (canQueryDb && rawOrders.length > 0) {
        const orderIds = rawOrders.map((o) => o.id);
        const { data: secretsRows } = await supabase
          .from('delivery_order_secrets')
          .select(
            'order_id, pickup_otp, dropoff_otp, return_otp, failed_attempts, locked_until'
          )
          .in('order_id', orderIds);
        if (Array.isArray(secretsRows)) {
          secretsByOrderId = new Map(
            (secretsRows as DeliveryOrderSecretRecord[]).map((s) => [
              s.order_id,
              s,
            ])
          );
        }
      }

      setOrders(
        rawOrders.map((o) => ({
          ...o,
          quoted_fare_inr: Number(o.quoted_fare_inr || 0),
          distance_km: Number(o.distance_km || 0),
          secrets: secretsByOrderId.get(o.id) ?? null,
        }))
      );

      if (Array.isArray(bookingsRes.data)) {
        const mappedBookings: HydratedVehicleBookingRow[] = (
          bookingsRes.data as Array<
            VehicleBookingRecord & {
              vehicle_listings?:
                | { id?: string; title?: string; stand_locality?: string }
                | Array<{ id?: string; title?: string; stand_locality?: string }>
                | null;
            }
          >
        ).map((bk) => {
          const vl = Array.isArray(bk.vehicle_listings)
            ? bk.vehicle_listings[0]
            : bk.vehicle_listings;
          return {
            ...bk,
            total_fare_inr: Number(bk.total_fare_inr || 0),
            advance_amount_inr: Number(bk.advance_amount_inr || 0),
            balance_due_inr: Number(bk.balance_due_inr || 0),
            vehicleTitle: String(vl?.title || 'Scheduled Vehicle').replace(
              /^\[SAMPLE\]\s*/i,
              ''
            ),
            standLocality: String(vl?.stand_locality || 'Churachandpur'),
          };
        });
        setVehicleBookings(mappedBookings);
      } else {
        setVehicleBookings([]);
      }

      setPaymentIntents(
        Array.isArray(intentsRes.data)
          ? (intentsRes.data as PaymentIntentRecord[]).map((p) => ({
              ...p,
              amount_inr: Number(p.amount_inr || 0),
              discount_inr: Number(p.discount_inr || 0),
              convenience_fee_inr: Number(p.convenience_fee_inr || 0),
            }))
          : []
      );

      if (Array.isArray(enquiriesRes.data)) {
        const mappedEnq: HydratedEnquiryItem[] = (
          enquiriesRes.data as Array<Record<string, unknown>>
        ).map((row) => {
          const listingRaw = Array.isArray(row.listings)
            ? (row.listings[0] as Record<string, unknown> | undefined)
            : (row.listings as Record<string, unknown> | undefined);
          const listingId = String(row.listing_id || listingRaw?.id || '');
          const matchedStoreListing = listings.find((l) => l.id === listingId);
          return {
            id: String(row.id || ''),
            hubId:
              typeof row.hub_id === 'string'
                ? row.hub_id
                : typeof listingRaw?.hub_id === 'string'
                  ? listingRaw.hub_id
                  : matchedStoreListing?.hub_id || null,
            listingId,
            listingTitle: String(
              listingRaw?.title || matchedStoreListing?.title || 'Local Shop'
            ),
            listingLocality: String(
              listingRaw?.locality ||
                matchedStoreListing?.locality ||
                'Churachandpur'
            ),
            senderName: String(row.sender_name || 'Visitor'),
            senderContact: String(row.sender_contact || ''),
            message: String(row.message || ''),
            status: String(row.status || 'new'),
            createdAt: String(row.created_at || new Date().toISOString()),
          };
        });
        setRemoteEnquiries(mappedEnq);
      } else {
        setRemoteEnquiries([]);
      }
    } finally {
      setIsLoading(false);
    }
  }, [activeUserId, listings]);

  useEffect(() => {
    queueMicrotask(() => {
      void fetchAllActivityData();
    });
  }, [fetchAllActivityData]);

  // Real-time notifications listener
  useEffect(() => {
    if (!isSupabaseConfigured() || !activeUserId) return;
    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      const channelName = `activity-panel-notifs-${activeUserId}-${Date.now()}`;
      channel = supabase
        .channel(channelName)
        .on(
          'postgres_changes',
          {
            event: 'INSERT',
            schema: 'public',
            table: 'notifications',
            filter: `user_id=eq.${activeUserId}`,
          },
          (payload) => {
            const raw = payload.new as SupabaseNotificationRow | undefined;
            if (raw && raw.id) {
              const incoming = mapNotificationRow(raw);
              setLiveNotifications((prev) =>
                prev.some((item) => item.id === incoming.id)
                  ? prev
                  : [incoming, ...prev]
              );
            }
          }
        )
        .subscribe();
    } catch {
      channel = null;
    }
    return () => {
      if (channel) {
        try {
          void supabase.removeChannel(channel);
        } catch {
          // ignore
        }
      }
    };
  }, [activeUserId]);

  const mergedEnquiries = useMemo<HydratedEnquiryItem[]>(() => {
    const seen = new Set<string>();
    const combined: HydratedEnquiryItem[] = [];
    for (const item of remoteEnquiries) {
      if (item.id && !seen.has(item.id)) {
        seen.add(item.id);
        combined.push(item);
      }
    }
    for (const local of storeEnquiries) {
      if (!seen.has(local.id)) {
        seen.add(local.id);
        const match = listings.find((l) => l.id === local.listingId);
        combined.push({
          id: local.id,
          hubId: match?.hub_id || null,
          listingId: local.listingId,
          listingTitle: local.listingTitle || match?.title || 'Local Shop',
          listingLocality: match?.locality || 'Churachandpur',
          senderName: local.senderName,
          senderContact: local.senderPhone || local.senderEmail || '',
          message: local.message,
          status: local.status,
          createdAt: local.createdAt,
        });
      }
    }
    return combined;
  }, [remoteEnquiries, storeEnquiries, listings]);

  const hubNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const h of hubs) {
      map.set(h.id, h.name);
    }
    return map;
  }, [hubs]);

  const resolveCrossHubLabel = useCallback(
    (itemHubId?: string | null): string | null => {
      if (!itemHubId || !activeHubId || itemHubId === activeHubId) return null;
      return hubNameById.get(itemHubId) || null;
    },
    [activeHubId, hubNameById]
  );

  const matchesHubFilter = useCallback(
    (itemHubId?: string | null) => {
      if (hubFilterMode === 'all' || !activeHubId) return true;
      return !itemHubId || itemHubId === activeHubId;
    },
    [hubFilterMode, activeHubId]
  );

  const visibleOrders = useMemo(
    () => orders.filter((o) => matchesHubFilter(o.hub_id)),
    [orders, matchesHubFilter]
  );
  const visibleVehicleBookings = useMemo(
    () => vehicleBookings.filter((bk) => matchesHubFilter(bk.hub_id)),
    [vehicleBookings, matchesHubFilter]
  );
  const visiblePaymentIntents = useMemo(
    () => paymentIntents.filter((pi) => matchesHubFilter(pi.hub_id)),
    [paymentIntents, matchesHubFilter]
  );
  const visibleEnquiries = useMemo(
    () => mergedEnquiries.filter((enq) => matchesHubFilter(enq.hubId)),
    [mergedEnquiries, matchesHubFilter]
  );

  const unreadCount = useMemo(
    () => liveNotifications.filter((n) => !n.is_read).length,
    [liveNotifications]
  );

  const handleMarkAsRead = useCallback(
    async (id: string) => {
      setMarkingId(id);
      setLiveNotifications((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, is_read: true, read: true } : item
        )
      );
      markNotificationRead(id);
      await markNotificationAsRead(id);
      setMarkingId(null);
    },
    [markNotificationRead]
  );

  const openPaymentForOrder = async (order: DeliveryOrderRecord) => {
    const existing = paymentIntents.find(
      (pi) =>
        pi.purpose === 'pick_n_drop' &&
        pi.reference_id === order.id &&
        (pi.status === 'awaiting_payment' || pi.status === 'pending_manual')
    );
    if (existing) {
      setPaymentModalMeta({
        title: `Pick N Drop Escrow · ${order.order_code}`,
        subtitle: `${order.pickup_address} → ${order.dropoff_address}`,
      });
      setActivePaymentIntent(existing);
      return;
    }

    setCreatingIntentForId(order.id);
    setAppStatus('saving', 'Preparing payment checkout…');
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch('/api/payments/create-intent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          purpose: 'pick_n_drop',
          reference_id: order.id,
          amount_inr: Number(order.quoted_fare_inr || 0),
          hubId: order.hub_id || activeHubId || undefined,
        }),
      });
      const json = (await res.json()) as {
        intent?: PaymentIntentRecord;
        error?: string;
      };
      if (!res.ok || !json.intent) {
        throw new Error(json.error || 'Could not initialize payment intent.');
      }
      setPaymentIntents((prev) => [
        json.intent!,
        ...prev.filter((p) => p.id !== json.intent!.id),
      ]);
      setPaymentModalMeta({
        title: `Pick N Drop Escrow · ${order.order_code}`,
        subtitle: `${order.pickup_address} → ${order.dropoff_address}`,
      });
      setActivePaymentIntent(json.intent);
      setAppStatus('idle');
    } catch (err) {
      setAppStatus(
        'error',
        err instanceof Error ? err.message : 'Unable to start checkout.'
      );
    } finally {
      setCreatingIntentForId(null);
    }
  };

  const openPaymentForBooking = async (booking: HydratedVehicleBookingRow) => {
    const existing = paymentIntents.find(
      (pi) =>
        (booking.payment_intent_id && pi.id === booking.payment_intent_id) ||
        (pi.purpose === 'vehicle_booking' &&
          pi.reference_id === booking.id &&
          (pi.status === 'awaiting_payment' || pi.status === 'pending_manual'))
    );
    if (existing) {
      setPaymentModalMeta({
        title: `Vehicle Advance · ${booking.booking_code}`,
        subtitle: `${booking.vehicleTitle} (${booking.booking_mode === 'full_vehicle' ? 'Full Vehicle' : `${booking.seats_booked} Seat(s)`})`,
      });
      setActivePaymentIntent(existing);
      return;
    }

    setCreatingIntentForId(booking.id);
    setAppStatus('saving', 'Preparing advance checkout…');
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch('/api/payments/create-intent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          purpose: 'vehicle_booking',
          reference_id: booking.id,
          amount_inr: Number(booking.advance_amount_inr || booking.total_fare_inr || 0),
          hubId: booking.hub_id || activeHubId || undefined,
        }),
      });
      const json = (await res.json()) as {
        intent?: PaymentIntentRecord;
        error?: string;
      };
      if (!res.ok || !json.intent) {
        throw new Error(json.error || 'Could not initialize advance payment.');
      }
      setPaymentIntents((prev) => [
        json.intent!,
        ...prev.filter((p) => p.id !== json.intent!.id),
      ]);
      setPaymentModalMeta({
        title: `Vehicle Advance · ${booking.booking_code}`,
        subtitle: booking.vehicleTitle,
      });
      setActivePaymentIntent(json.intent);
      setAppStatus('idle');
    } catch (err) {
      setAppStatus(
        'error',
        err instanceof Error ? err.message : 'Unable to start advance checkout.'
      );
    } finally {
      setCreatingIntentForId(null);
    }
  };

  const tabs: Array<{
    id: ActivityTab;
    label: string;
    count: number;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    {
      id: 'pick_n_drop',
      label: 'Pick N Drop',
      count: visibleOrders.length,
      icon: Truck,
    },
    {
      id: 'vehicles',
      label: 'Vehicle Bookings',
      count: visibleVehicleBookings.length,
      icon: Car,
    },
    {
      id: 'payments',
      label: 'Payments & Receipts',
      count: visiblePaymentIntents.length,
      icon: Receipt,
    },
    {
      id: 'enquiries',
      label: 'Enquiries',
      count: visibleEnquiries.length,
      icon: MessageSquare,
    },
  ];

  return (
    <div
      data-testid="activity-destination-view"
      className="mx-auto w-full max-w-6xl space-y-5 px-4 sm:px-6 pt-5 pb-20 lg:pb-10"
    >
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--ps-border)] pb-4">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
              Personal Ledger
            </span>
            <span
              data-testid="activity-unread-badge"
              className="text-xs font-semibold text-[var(--ps-text-muted)] tabular-nums"
            >
              {unreadCount} unread alert{unreadCount === 1 ? '' : 's'}
            </span>
          </div>
          <h1 className="text-xl font-bold tracking-tight text-[var(--ps-text)] sm:text-2xl">
            Activity, Trips &amp; Payment Receipts
          </h1>
          <p className="text-xs text-[var(--ps-text-muted)]">
            Track Pick N Drop deliveries, Scheduled Vehicle Bookings, UPI/Razorpay receipts, and shop enquiries in one place.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {/* Cross-Hub Filter Toggle Pill: All Hubs | Active Hub Only */}
          <div
            data-testid="activity-hub-filter-toggle"
            className="inline-flex h-8 items-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-0.5 text-xs font-semibold"
          >
            <button
              type="button"
              onClick={() => setHubFilterMode('all')}
              className={`h-7 rounded-lg px-2.5 transition-colors ${
                hubFilterMode === 'all'
                  ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-2xs'
                  : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
              }`}
            >
              All Hubs
            </button>
            <button
              type="button"
              onClick={() => setHubFilterMode('active')}
              className={`h-7 rounded-lg px-2.5 transition-colors ${
                hubFilterMode === 'active'
                  ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-2xs'
                  : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
              }`}
            >
              {activeHubName} Only
            </button>
          </div>

          <button
            type="button"
            data-testid="refresh-notifications-btn"
            onClick={() => void fetchAllActivityData()}
            className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 text-xs font-semibold text-[var(--ps-text)] transition hover:bg-[var(--ps-surface-alt)]"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`}
            />
            <span>Refresh</span>
          </button>
          {onBackToExplore && (
            <button
              type="button"
              onClick={onBackToExplore}
              className="inline-flex h-8 items-center rounded-xl bg-[var(--ps-accent)] px-3 text-xs font-semibold text-[var(--ps-accent-fg)]"
            >
              Back to Explore
            </button>
          )}
        </div>
      </div>

      {/* 4-Tab Bar */}
      <nav
        role="tablist"
        aria-label="Customer activity sections"
        className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar"
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              data-testid={`activity-tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold transition-colors ${
                isActive
                  ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-2xs'
                  : 'border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
              }`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span>{tab.label}</span>
              <span
                className={`ml-0.5 text-[10px] font-bold tabular-nums ${
                  isActive ? 'opacity-90' : 'text-[var(--ps-text-muted)]'
                }`}
              >
                {tab.count}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Sign-in guard notice when unauthenticated */}
      {!activeUserId && !isLoading && (
        <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 text-center space-y-2.5">
          <Activity className="mx-auto h-6 w-6 text-[var(--ps-text-muted)]" />
          <p className="text-sm font-bold text-[var(--ps-text)]">
            Sign in to view your synchronized activity ledger
          </p>
          <p className="text-xs text-[var(--ps-text-muted)] max-w-md mx-auto">
            Your Pick N Drop OTPs, Scheduled Vehicle Bookings, UPI/Razorpay payment receipts, and enquiries sync securely to your account.
          </p>
          <div className="pt-1">
            <Link
              href="/login"
              className="inline-flex h-8 items-center rounded-xl bg-[var(--ps-accent)] px-4 text-xs font-semibold text-[var(--ps-accent-fg)]"
            >
              Sign In
            </Link>
          </div>
        </div>
      )}

      {/* TAB 1: PICK N DROP */}
      {activeTab === 'pick_n_drop' && (
        <section className="space-y-3" data-testid="activity-pick-n-drop-section">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] py-12 text-xs text-[var(--ps-text-muted)]">
              <Loader2 className="h-4 w-4 animate-spin text-[var(--ps-accent)]" />
              <span>Loading Pick N Drop orders…</span>
            </div>
          ) : visibleOrders.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-surface)] p-8 text-center space-y-2.5">
              <Truck className="mx-auto h-6 w-6 text-[var(--ps-text-muted)] opacity-70" />
              <p className="text-sm font-bold text-[var(--ps-text)]">
                No Pick N Drop orders yet
              </p>
              <p className="text-xs text-[var(--ps-text-muted)] max-w-sm mx-auto">
                Dispatch local parcels, book quick passenger rides, or schedule LPG cylinder exchange right from Explore.
              </p>
              <Link
                href="/explore?mode=pick_n_drop"
                className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3.5 text-xs font-semibold text-[var(--ps-accent-fg)]"
              >
                <Truck className="h-3.5 w-3.5" />
                <span>Start Pick N Drop</span>
              </Link>
            </div>
          ) : (
            <div className="space-y-3">
              {visibleOrders.map((order) => {
                const crossHubLabel = resolveCrossHubLabel(order.hub_id);
                const statusMeta =
                  DELIVERY_STATUS_META[order.status] ||
                  DELIVERY_STATUS_META.awaiting_payment;
                const modeKey: DeliveryServiceMode =
                  order.service_mode || 'parcel';
                const modeLabel =
                  SERVICE_MODE_META[modeKey]?.shortLabel || 'Parcel';
                const stepIdx = resolveDeliveryStepIndex(order.status);
                const recipientWa = sanitizePhoneForWhatsApp(
                  order.recipient_phone || ''
                );
                const pickupOtp = order.secrets?.pickup_otp || null;
                const dropoffOtp = order.secrets?.dropoff_otp || null;
                const returnOtp = order.secrets?.return_otp || null;
                const shareDropoffHref = dropoffOtp
                  ? `https://wa.me/${recipientWa}?text=${encodeURIComponent(
                      `PrintSwift Pick N Drop (${order.order_code}): Share Dropoff OTP ${dropoffOtp} with the driver when receiving at ${order.dropoff_address}.`
                    )}`
                  : null;

                return (
                  <article
                    key={order.id}
                    data-testid={`activity-pnd-card-${order.order_code}`}
                    className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-xs font-extrabold text-[var(--ps-text)]">
                          {order.order_code}
                        </span>
                        <span className="rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-0.5 text-[10px] font-semibold text-[var(--ps-text-muted)]">
                          {modeLabel} ·{' '}
                          {order.trip_type === 'two_way' ? 'Two-Way' : 'One-Way'}
                        </span>
                        {crossHubLabel && (
                          <span className="inline-flex items-center gap-1 rounded-md border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700 dark:text-indigo-300">
                            <MapPin className="h-2.5 w-2.5" />
                            {crossHubLabel}
                          </span>
                        )}
                        <span
                          className={`rounded-md border px-2 py-0.5 text-[10px] font-bold ${statusMeta.badgeClass}`}
                        >
                          {statusMeta.label}
                        </span>
                      </div>
                      <div className="text-right">
                        <span className="font-mono text-sm font-extrabold tabular-nums text-[var(--ps-text)]">
                          ₹{order.quoted_fare_inr.toLocaleString('en-IN')}
                        </span>
                        <span className="ml-1.5 text-[11px] text-[var(--ps-text-muted)] tabular-nums">
                          {order.distance_km.toFixed(1)} km
                        </span>
                      </div>
                    </div>

                    {/* 6-Step Progress Bar */}
                    {order.status !== 'cancelled' && (
                      <div className="grid grid-cols-6 gap-1">
                        {DELIVERY_STEPS.map((st, idx) => {
                          const done = idx <= stepIdx;
                          return (
                            <div key={st.key} className="space-y-1">
                              <div
                                className={`h-1.5 rounded-full transition-colors ${
                                  done
                                    ? 'bg-[var(--ps-accent)]'
                                    : 'bg-[var(--ps-border)]'
                                }`}
                              />
                              <p
                                className={`truncate text-[9px] font-semibold ${
                                  done
                                    ? 'text-[var(--ps-text)]'
                                    : 'text-[var(--ps-text-muted)]'
                                }`}
                              >
                                {st.label}
                              </p>
                            </div>
                          );
                        })}
                      </div>
                    )}

                    {/* Route */}
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 text-xs">
                      <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2">
                        <p className="text-[10px] font-bold uppercase text-emerald-600 dark:text-emerald-400">
                          Pickup
                        </p>
                        <p className="mt-0.5 font-medium text-[var(--ps-text)] truncate">
                          {order.pickup_address}
                        </p>
                      </div>
                      <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2">
                        <p className="text-[10px] font-bold uppercase text-indigo-600 dark:text-indigo-400">
                          Dropoff
                        </p>
                        <p className="mt-0.5 font-medium text-[var(--ps-text)] truncate">
                          {order.dropoff_address}
                        </p>
                      </div>
                    </div>

                    {/* Asymmetric OTP Row */}
                    {(pickupOtp || dropoffOtp || returnOtp) && (
                      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--ps-accent)]/30 bg-[var(--ps-accent)]/5 px-3 py-2 text-xs">
                        <KeyRound className="h-3.5 w-3.5 text-[var(--ps-accent)] shrink-0" />
                        {pickupOtp && (
                          <span className="font-mono font-bold text-[var(--ps-text)]">
                            Sender OTP:{' '}
                            <span className="text-emerald-600 dark:text-emerald-400">
                              {pickupOtp}
                            </span>
                          </span>
                        )}
                        {dropoffOtp && (
                          <span className="font-mono font-bold text-[var(--ps-text)]">
                            · Recipient OTP:{' '}
                            <span className="text-indigo-600 dark:text-indigo-400">
                              {dropoffOtp}
                            </span>
                          </span>
                        )}
                        {returnOtp && (
                          <span className="font-mono font-bold text-[var(--ps-text)]">
                            · Return OTP:{' '}
                            <span className="text-amber-600 dark:text-amber-400">
                              {returnOtp}
                            </span>
                          </span>
                        )}
                      </div>
                    )}

                    {/* Actions */}
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--ps-border)] pt-2.5">
                      <span className="font-mono text-[10px] text-[var(--ps-text-muted)]">
                        {new Date(order.created_at).toLocaleString('en-IN', {
                          day: '2-digit',
                          month: 'short',
                          hour: '2-digit',
                          minute: '2-digit',
                        })}
                      </span>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {order.status === 'awaiting_payment' && (
                          <button
                            type="button"
                            disabled={creatingIntentForId === order.id}
                            onClick={() => void openPaymentForOrder(order)}
                            className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 px-3 text-xs font-bold text-white disabled:opacity-50"
                          >
                            {creatingIntentForId === order.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <CreditCard className="h-3.5 w-3.5" />
                            )}
                            <span>Complete Payment</span>
                          </button>
                        )}
                        {shareDropoffHref && (
                          <a
                            href={shareDropoffHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 px-2.5 text-xs font-semibold text-white"
                          >
                            <MessageCircle className="h-3.5 w-3.5" />
                            <span>Share Dropoff OTP</span>
                          </a>
                        )}
                        <button
                          type="button"
                          onClick={() => {
                            setTrackerOrderId(order.id);
                            setIsTrackerOpen(true);
                          }}
                          className="inline-flex h-8 items-center gap-1 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]"
                        >
                          <span>Full Tracker</span>
                          <ArrowRight className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* TAB 2: VEHICLE BOOKINGS */}
      {activeTab === 'vehicles' && (
        <section className="space-y-3" data-testid="activity-vehicles-section">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] py-12 text-xs text-[var(--ps-text-muted)]">
              <Loader2 className="h-4 w-4 animate-spin text-[var(--ps-accent)]" />
              <span>Loading scheduled vehicle bookings…</span>
            </div>
          ) : visibleVehicleBookings.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-surface)] p-8 text-center space-y-2.5">
              <Car className="mx-auto h-6 w-6 text-[var(--ps-text-muted)] opacity-70" />
              <p className="text-sm font-bold text-[var(--ps-text)]">
                No scheduled vehicle bookings yet
              </p>
              <p className="text-xs text-[var(--ps-text-muted)] max-w-sm mx-auto">
                Reserve full-vehicle charters or individual seats for {activeHubName} &amp; regional routes.
              </p>
              <Link
                href="/explore?category=vehicles_rentals"
                className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3.5 text-xs font-semibold text-[var(--ps-accent-fg)]"
              >
                <Car className="h-3.5 w-3.5" />
                <span>Browse Vehicles</span>
              </Link>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {visibleVehicleBookings.map((bk) => {
                const crossHubLabel = resolveCrossHubLabel(bk.hub_id);
                const badge = getVehicleStatusBadge(bk.status);
                const holdCountdown =
                  bk.status === 'soft_hold'
                    ? formatCountdown(bk.hold_expires_at, nowMs)
                    : null;
                const holdExpired = holdCountdown === 'Expired';

                return (
                  <article
                    key={bk.id}
                    data-testid={`activity-vehicle-card-${bk.booking_code}`}
                    className="flex flex-col justify-between rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3"
                  >
                    <div className="space-y-2.5">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-mono text-xs font-extrabold text-[var(--ps-text)]">
                            {bk.booking_code}
                          </span>
                          <span className="rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-0.5 text-[10px] font-semibold text-[var(--ps-text-muted)]">
                            {bk.booking_mode === 'full_vehicle'
                              ? 'Full Vehicle'
                              : `${bk.seats_booked} Seat(s)`}
                          </span>
                          {crossHubLabel && (
                            <span className="inline-flex items-center gap-1 rounded-md border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700 dark:text-indigo-300">
                              <MapPin className="h-2.5 w-2.5" />
                              {crossHubLabel}
                            </span>
                          )}
                        </div>
                        <span
                          className={`rounded-md border px-2 py-0.5 text-[10px] font-bold ${badge.cls}`}
                        >
                          {badge.label}
                        </span>
                      </div>

                      <div>
                        <Link
                          href={`/vehicles/${encodeURIComponent(bk.vehicle_listing_id)}`}
                          className="text-sm font-bold text-[var(--ps-text)] hover:text-[var(--ps-accent)] transition-colors"
                        >
                          {bk.vehicleTitle}
                        </Link>
                        <p className="text-[11px] text-[var(--ps-text-muted)]">
                          {bk.pickup_location}
                          {bk.dropoff_location
                            ? ` → ${bk.dropoff_location}`
                            : ` · Stand: ${bk.standLocality}`}
                        </p>
                      </div>

                      <div className="flex items-center gap-1.5 font-mono text-[11px] tabular-nums text-[var(--ps-text-muted)]">
                        <Clock className="h-3.5 w-3.5 text-[var(--ps-accent)] shrink-0" />
                        <span>
                          {new Date(bk.start_time).toLocaleString('en-IN', {
                            day: '2-digit',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}{' '}
                          –{' '}
                          {new Date(bk.end_time).toLocaleString('en-IN', {
                            day: '2-digit',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                      </div>

                      {/* Fare split */}
                      <div className="grid grid-cols-3 gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-2.5 text-center">
                        <div>
                          <p className="text-[10px] text-[var(--ps-text-muted)]">
                            Total Fare
                          </p>
                          <p className="font-mono text-xs font-extrabold tabular-nums text-[var(--ps-text)]">
                            ₹{bk.total_fare_inr.toLocaleString('en-IN')}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] text-[var(--ps-text-muted)]">
                            Advance
                          </p>
                          <p className="font-mono text-xs font-extrabold tabular-nums text-emerald-600 dark:text-emerald-400">
                            ₹{bk.advance_amount_inr.toLocaleString('en-IN')}
                          </p>
                        </div>
                        <div>
                          <p className="text-[10px] text-[var(--ps-text-muted)]">
                            Balance Due
                          </p>
                          <p className="font-mono text-xs font-extrabold tabular-nums text-amber-600 dark:text-amber-400">
                            ₹{bk.balance_due_inr.toLocaleString('en-IN')}
                          </p>
                        </div>
                      </div>

                      {/* Start / End OTP */}
                      {(bk.start_otp || bk.end_otp) && (
                        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--ps-accent)]/30 bg-[var(--ps-accent)]/5 px-3 py-2 text-xs">
                          <KeyRound className="h-3.5 w-3.5 text-[var(--ps-accent)] shrink-0" />
                          {bk.start_otp && (
                            <span className="font-mono font-bold text-emerald-700 dark:text-emerald-300">
                              Start OTP: {bk.start_otp}
                            </span>
                          )}
                          {bk.end_otp && (
                            <span className="font-mono font-bold text-amber-700 dark:text-amber-300">
                              · End OTP: {bk.end_otp}
                            </span>
                          )}
                        </div>
                      )}

                      {/* 20-min Soft Hold Countdown */}
                      {holdCountdown && (
                        <div className="flex items-center justify-between gap-2 rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                          <span className="flex items-center gap-1.5 font-semibold">
                            <Clock className="h-3.5 w-3.5 shrink-0" />
                            <span>
                              {holdExpired
                                ? 'Soft hold expired — rebook from vehicle page.'
                                : `Soft-hold active: ${holdCountdown}`}
                            </span>
                          </span>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--ps-border)] pt-2.5">
                      <Link
                        href={`/vehicles/${encodeURIComponent(bk.vehicle_listing_id)}`}
                        className="inline-flex h-8 items-center gap-1 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]"
                      >
                        <span>View Vehicle</span>
                        <ExternalLink className="h-3 w-3" />
                      </Link>
                      {bk.status === 'soft_hold' && !holdExpired && (
                        <button
                          type="button"
                          disabled={creatingIntentForId === bk.id}
                          onClick={() => void openPaymentForBooking(bk)}
                          className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3 text-xs font-bold text-[var(--ps-accent-fg)] hover:opacity-95 disabled:opacity-50"
                        >
                          {creatingIntentForId === bk.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <CreditCard className="h-3.5 w-3.5" />
                          )}
                          <span>Pay Advance Now</span>
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* TAB 3: PAYMENTS & RECEIPTS */}
      {activeTab === 'payments' && (
        <section className="space-y-3" data-testid="activity-payments-section">
          {isLoading ? (
            <div className="flex items-center justify-center gap-2 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] py-12 text-xs text-[var(--ps-text-muted)]">
              <Loader2 className="h-4 w-4 animate-spin text-[var(--ps-accent)]" />
              <span>Loading payment intents &amp; receipts…</span>
            </div>
          ) : visiblePaymentIntents.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-surface)] p-8 text-center space-y-2.5">
              <Receipt className="mx-auto h-6 w-6 text-[var(--ps-text-muted)] opacity-70" />
              <p className="text-sm font-bold text-[var(--ps-text)]">
                No payment receipts yet
              </p>
              <p className="text-xs text-[var(--ps-text-muted)] max-w-sm mx-auto">
                Every Pick N Drop escrow, Vehicle Booking advance, and Bulletin Plan payment receipt appears here with full UTR &amp; refund tracking.
              </p>
            </div>
          ) : (
            <div className="space-y-2.5">
              {visiblePaymentIntents.map((pi) => {
                const crossHubLabel = resolveCrossHubLabel(pi.hub_id);
                const purposeBadge =
                  PURPOSE_BADGE_MAP[pi.purpose] || PURPOSE_BADGE_MAP.pick_n_drop;
                const statusMeta = getPaymentStatusMeta(pi.status);
                const isRazorpay = pi.provider === 'razorpay';
                const discount = Number(pi.discount_inr || 0);
                const refCode =
                  pi.upi_utr_ref || pi.provider_payment_id || null;

                return (
                  <article
                    key={pi.id}
                    data-testid={`payment-receipt-${pi.intent_code}`}
                    className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="font-mono text-xs font-extrabold text-[var(--ps-text)]">
                          {pi.intent_code}
                        </span>
                        <span
                          className={`rounded-md border px-2 py-0.5 text-[10px] font-bold ${purposeBadge.cls}`}
                        >
                          {purposeBadge.label}
                        </span>
                        {crossHubLabel && (
                          <span className="inline-flex items-center gap-1 rounded-md border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700 dark:text-indigo-300">
                            <MapPin className="h-2.5 w-2.5" />
                            {crossHubLabel}
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1 rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-0.5 text-[10px] font-semibold text-[var(--ps-text-muted)]">
                          {isRazorpay ? (
                            <Zap className="h-3 w-3 text-indigo-500" />
                          ) : (
                            <ShieldCheck className="h-3 w-3 text-emerald-500" />
                          )}
                          <span>{isRazorpay ? 'Razorpay' : 'Manual UPI'}</span>
                        </span>
                        <span
                          className={`rounded-md border px-2 py-0.5 text-[10px] font-bold ${statusMeta.cls}`}
                        >
                          {statusMeta.label}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--ps-text-muted)]">
                        <span className="font-mono tabular-nums">
                          {new Date(pi.created_at).toLocaleString('en-IN', {
                            day: '2-digit',
                            month: 'short',
                            year: 'numeric',
                            hour: '2-digit',
                            minute: '2-digit',
                          })}
                        </span>
                        {refCode && (
                          <span className="font-mono text-[var(--ps-text)]">
                            Ref: <strong>{refCode}</strong>
                          </span>
                        )}
                        {discount > 0 && (
                          <span className="inline-flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400">
                            <Tag className="h-3 w-3" />
                            <span>
                              Promo -₹{discount.toLocaleString('en-IN')}
                            </span>
                          </span>
                        )}
                        {pi.refund_utr_ref && (
                          <span className="font-mono text-indigo-600 dark:text-indigo-400">
                            Refund UTR: {pi.refund_utr_ref}
                          </span>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
                      <div className="text-left sm:text-right">
                        <p className="font-mono text-base font-extrabold tabular-nums text-[var(--ps-text)]">
                          ₹{pi.amount_inr.toLocaleString('en-IN')}
                        </p>
                        {Number(pi.convenience_fee_inr || 0) > 0 && (
                          <p className="text-[10px] text-[var(--ps-text-muted)] tabular-nums">
                            incl. ₹{Number(pi.convenience_fee_inr).toLocaleString('en-IN')} fee
                          </p>
                        )}
                      </div>

                      {pi.status === 'awaiting_payment' && (
                        <button
                          type="button"
                          onClick={() => {
                            setPaymentModalMeta({
                              title: `Resume Payment · ${pi.intent_code}`,
                              subtitle: purposeBadge.label,
                            });
                            setActivePaymentIntent(pi);
                          }}
                          className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3 text-xs font-bold text-[var(--ps-accent-fg)] hover:opacity-95"
                        >
                          <CreditCard className="h-3.5 w-3.5" />
                          <span>Pay Now</span>
                        </button>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* TAB 4: ENQUIRIES & LIVE ALERTS */}
      {activeTab === 'enquiries' && (
        <section className="space-y-5" data-testid="activity-enquiries-section">
          {/* Customer Enquiries */}
          <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-bold text-[var(--ps-text)]">
                <MessageSquare className="h-4 w-4 text-[var(--ps-accent)]" />
                <span>Shop &amp; Listing Enquiries ({visibleEnquiries.length})</span>
              </h2>
              <Link
                href="/messages"
                className="text-xs font-semibold text-[var(--ps-accent)] hover:underline"
              >
                Open Messages →
              </Link>
            </div>

            {visibleEnquiries.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-bg)] p-6 text-center text-xs text-[var(--ps-text-muted)]">
                No enquiries submitted or received yet. Send an enquiry from any listing page to see it tracked here.
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
                {visibleEnquiries.map((enq) => {
                  const crossHubLabel = resolveCrossHubLabel(enq.hubId);
                  return (
                    <div
                      key={enq.id}
                      className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 space-y-1.5 text-xs"
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-1.5 min-w-0">
                          <Link
                            href={`/listing/${encodeURIComponent(enq.listingId)}`}
                            className="font-bold text-[var(--ps-text)] hover:text-[var(--ps-accent)] truncate"
                          >
                            {enq.listingTitle}
                          </Link>
                          {crossHubLabel && (
                            <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700 dark:text-indigo-300">
                              <MapPin className="h-2.5 w-2.5" />
                              {crossHubLabel}
                            </span>
                          )}
                        </div>
                        <span className="rounded-md border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--ps-text-muted)]">
                          {enq.status}
                        </span>
                      </div>
                      <p className="text-[var(--ps-text-muted)] line-clamp-2">
                        {enq.message}
                      </p>
                      <div className="flex items-center justify-between gap-2 pt-1 text-[10px] text-[var(--ps-text-muted)]">
                        <span>
                          {enq.senderName} · {enq.listingLocality}
                        </span>
                        <Link
                          href={`/listing/${encodeURIComponent(enq.listingId)}`}
                          className="inline-flex items-center gap-1 font-semibold text-[var(--ps-accent)] hover:underline"
                        >
                          <span>View Listing</span>
                          <ArrowRight className="h-3 w-3" />
                        </Link>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Live Notifications & Activity Logs */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div
              data-testid="live-notifications-panel"
              className="space-y-3 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4"
            >
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-bold text-[var(--ps-text)]">
                  <Bell className="h-4 w-4 text-[var(--ps-accent)]" />
                  <span>Notifications ({liveNotifications.length})</span>
                </h2>
                {unreadCount > 0 && (
                  <span
                    data-testid="panel-unread-count-pill"
                    className="rounded-full bg-[var(--ps-accent)] px-2 py-0.5 text-[10px] font-bold text-[var(--ps-accent-fg)] tabular-nums"
                  >
                    {unreadCount} Unread
                  </span>
                )}
              </div>

              {liveNotifications.length === 0 ? (
                <div
                  data-testid="notifications-empty-state"
                  className="rounded-xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-bg)] p-5 text-center text-xs text-[var(--ps-text-muted)]"
                >
                  No live notifications yet.
                </div>
              ) : (
                <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                  {liveNotifications.map((notif) => (
                    <div
                      key={notif.id}
                      data-testid={`notification-item-${notif.id}`}
                      className={`flex items-start justify-between gap-3 rounded-xl border p-3 text-xs ${
                        notif.is_read
                          ? 'border-[var(--ps-border)] bg-[var(--ps-bg)]'
                          : 'border-[var(--ps-accent)]/50 bg-[var(--ps-surface-alt)]'
                      }`}
                    >
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <p className="font-bold text-[var(--ps-text)]">
                          {notif.title}
                        </p>
                        <p className="text-[var(--ps-text-muted)]">
                          {notif.message}
                        </p>
                      </div>
                      {!notif.is_read ? (
                        <button
                          type="button"
                          data-testid={`mark-notification-read-${notif.id}`}
                          disabled={markingId === notif.id}
                          onClick={() => void handleMarkAsRead(notif.id)}
                          className="shrink-0 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2 py-1 text-[10px] font-semibold text-[var(--ps-text)]"
                        >
                          {markingId === notif.id ? 'Saving…' : 'Mark read'}
                        </button>
                      ) : (
                        <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Read
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div
              data-testid="live-activity-logs-panel"
              className="space-y-3 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4"
            >
              <div className="flex items-center justify-between">
                <h2 className="flex items-center gap-2 text-sm font-bold text-[var(--ps-text)]">
                  <Activity className="h-4 w-4 text-[var(--ps-accent)]" />
                  <span>Activity History ({liveActivityLogs.length})</span>
                </h2>
              </div>

              {liveActivityLogs.length === 0 ? (
                <div
                  data-testid="activity-logs-empty-state"
                  className="rounded-xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-bg)] p-5 text-center text-xs text-[var(--ps-text-muted)]"
                >
                  No recorded activity events yet.
                </div>
              ) : (
                <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                  {liveActivityLogs.map((log) => (
                    <div
                      key={log.id}
                      data-testid={`activity-log-item-${log.id}`}
                      className="flex items-center justify-between gap-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-2.5 text-xs"
                    >
                      <span className="font-semibold capitalize text-[var(--ps-text)]">
                        {log.action_type.replace(/_/g, ' ')}
                      </span>
                      <span className="font-mono text-[10px] text-[var(--ps-text-muted)]">
                        {log.created_at.replace('T', ' ').slice(0, 19)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Full Pick N Drop Tracker Modal */}
      {isTrackerOpen && (
        <OrderTrackerModal
          mode="modal"
          isOpen={isTrackerOpen}
          initialOrderId={trackerOrderId}
          onClose={() => {
            setIsTrackerOpen(false);
            setTrackerOrderId(null);
          }}
        />
      )}

      {/* Universal Dual-Mode Payment Modal */}
      <UniversalPaymentModal
        open={Boolean(activePaymentIntent)}
        intent={activePaymentIntent}
        upiId={paymentConfig.upi_id}
        upiPayeeName={paymentConfig.upi_payee_name}
        title={paymentModalMeta.title}
        subtitle={paymentModalMeta.subtitle}
        onSubmitted={(updated) => {
          setPaymentIntents((prev) =>
            prev.map((item) => (item.id === updated.id ? updated : item))
          );
          setActivePaymentIntent(null);
          void fetchAllActivityData();
        }}
        onClose={() => setActivePaymentIntent(null)}
      />
    </div>
  );
}

export default ActivityPanel;
