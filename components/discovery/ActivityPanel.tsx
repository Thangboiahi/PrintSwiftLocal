'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Activity,
  ArrowRight,
  BedDouble,
  Bell,
  CalendarDays,
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
  Phone,
  Printer,
  Receipt,
  RefreshCw,
  Share2,
  ShieldCheck,
  ShoppingBag,
  Store,
  Tag,
  Truck,
  Users,
  UtensilsCrossed,
  Zap,
} from 'lucide-react';
import {
  formatBookingInr,
  formatIstDateTime,
} from '@/lib/bookings/client-helpers';
import type { ResourceBooking } from '@/lib/bookings/types';
import type {
  RestaurantOrder,
  RestaurantTableReservation,
  ShopOrder,
} from '@/lib/commerce/types';
import type { PropertyVisitRequest } from '@/lib/real-estate/types';
import { OrderTrackerModal } from '@/components/pickndrop/OrderTrackerModal';
import { UniversalPaymentModal } from '@/components/payments/UniversalPaymentModal';
import {
  ActivityPrintOrdersSection,
  type HydratedPrintOrderFileSummary,
  type HydratedPrintOrderRow,
} from '@/components/print-orders/ActivityPrintOrdersSection';
import { useAppConfig } from '@/components/providers/AppConfigProvider';
import { AppBrandLoader } from '@/components/ui/AppBrandLoader';
import { WorkspaceTableSkeleton } from '@/components/shared/Skeletons';
import { useShare } from '@/components/ui/ShareSheetModal';
import { setAppStatus } from '@/lib/hooks/useAppStatus';
import {
  type PaymentIntentRecord,
  type PaymentPurpose,
  type VehicleBookingRecord,
} from '@/lib/payments/types';
import {
  DELIVERY_STATUS_META,
  SERVICE_MODE_META,
  type DeliveryOrderRecord,
  type DeliveryOrderSecretRecord,
  type DeliveryServiceMode,
} from '@/lib/pick-n-drop/types';
import { useAppStore, useAuth } from '@/lib/store';
import {
  buildContextualWhatsAppMessage,
  buildContextualWhatsAppUrl,
} from '@/lib/utils/whatsapp';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { useRealtimeTableRefresh } from '@/lib/hooks/useRealtimeTableRefresh';
import {
  fetchMyActivityLogs,
  fetchMyNotifications,
  formatRelativeIstTime,
  mapNotificationRow,
  markAllNotificationsAsRead,
  markNotificationAsRead,
  type LiveActivityLogRecord,
  type LiveNotificationRecord,
  type SupabaseNotificationRow,
} from '@/lib/supabase/notifications';

export interface ActivityPanelProps {
  onBackToExplore?: () => void;
}

type ActivityTab =
  | 'pick_n_drop'
  | 'commerce'
  | 'print'
  | 'vehicles'
  | 'payments'
  | 'enquiries';

const VALID_ACTIVITY_TABS: readonly ActivityTab[] = [
  'pick_n_drop',
  'commerce',
  'print',
  'vehicles',
  'payments',
  'enquiries',
];

interface HydratedShopOrderRow extends ShopOrder {
  listingTitle: string;
  listingLocality: string;
}

interface HydratedRestaurantOrderRow extends RestaurantOrder {
  listingTitle: string;
  listingLocality: string;
}

interface HydratedTableReservationRow extends RestaurantTableReservation {
  listingTitle: string;
  listingLocality: string;
}

interface HydratedPropertyVisitRow extends PropertyVisitRequest {
  listingTitle: string;
  listingLocality: string;
  listingPhone: string | null;
}

const FOOD_ORDER_STEPS = [
  { key: 'pending_payment', label: 'Placed' },
  { key: 'new_order', label: 'Received' },
  { key: 'preparing', label: 'Cooking' },
  { key: 'ready_for_pickup', label: 'Ready' },
  { key: 'completed', label: 'Done' },
] as const;

function resolveFoodOrderStepIndex(status: string): number {
  switch (status) {
    case 'pending_payment':
      return 0;
    case 'new_order':
      return 1;
    case 'preparing':
      return 2;
    case 'ready_for_pickup':
    case 'handed_to_rider':
      return 3;
    case 'completed':
      return 4;
    default:
      return 0;
  }
}

const SHOP_ORDER_STEPS = [
  { key: 'pending_payment', label: 'Placed' },
  { key: 'confirmed', label: 'Confirmed' },
  { key: 'packing', label: 'Packing' },
  { key: 'ready_for_pickup', label: 'Ready' },
  { key: 'completed', label: 'Done' },
] as const;

function resolveShopOrderStepIndex(status: string): number {
  switch (status) {
    case 'pending_payment':
      return 0;
    case 'confirmed':
      return 1;
    case 'packing':
      return 2;
    case 'ready_for_pickup':
    case 'handed_to_rider':
      return 3;
    case 'completed':
      return 4;
    default:
      return 0;
  }
}

interface HydratedVehicleBookingRow extends VehicleBookingRecord {
  vehicleTitle: string;
  standLocality: string;
}

interface HydratedResourceBookingRow extends ResourceBooking {
  listingTitle: string;
  listingLocality: string;
  resourceName: string;
  resourceVertical: 'booking_venue' | 'hotel_stay';
}

function getResourceBookingStatusBadge(status: string): {
  label: string;
  cls: string;
} {
  switch (status) {
    case 'pending_payment':
      return {
        label: 'Pending Payment',
        cls: 'border-amber-500/35 bg-amber-500/12 text-amber-800 dark:text-amber-300',
      };
    case 'confirmed':
      return {
        label: 'Confirmed',
        cls: 'border-emerald-500/35 bg-emerald-500/12 text-emerald-800 dark:text-emerald-300',
      };
    case 'checked_in':
      return {
        label: 'Checked In',
        cls: 'border-sky-500/35 bg-sky-500/12 text-sky-800 dark:text-sky-300',
      };
    case 'completed':
      return {
        label: 'Completed',
        cls: 'border-slate-400/40 bg-slate-500/10 text-slate-700 dark:text-slate-300',
      };
    case 'cancelled':
    case 'no_show':
      return {
        label: status === 'no_show' ? 'No Show' : 'Cancelled',
        cls: 'border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300',
      };
    default:
      return {
        label: status.replace(/_/g, ' '),
        cls: 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)]',
      };
  }
}

function getResourcePaymentStatusBadge(status: string): {
  label: string;
  cls: string;
} {
  switch (status) {
    case 'advance_escrow_held':
      return {
        label: 'Advance Held',
        cls: 'border-indigo-500/35 bg-indigo-500/12 text-indigo-800 dark:text-indigo-300',
      };
    case 'fully_prepaid_escrow':
      return {
        label: 'Fully Prepaid',
        cls: 'border-emerald-500/35 bg-emerald-500/12 text-emerald-800 dark:text-emerald-300',
      };
    case 'pending_manual_review':
      return {
        label: 'UTR Under Review',
        cls: 'border-amber-500/35 bg-amber-500/12 text-amber-800 dark:text-amber-300',
      };
    case 'paid_direct_confirmed':
      return {
        label: 'Paid at Counter',
        cls: 'border-emerald-500/35 bg-emerald-500/12 text-emerald-800 dark:text-emerald-300',
      };
    case 'refunded':
      return {
        label: 'Refunded',
        cls: 'border-sky-500/35 bg-sky-500/12 text-sky-800 dark:text-sky-300',
      };
    default:
      return {
        label: status === 'unpaid' ? 'Unpaid' : status.replace(/_/g, ' '),
        cls: 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)]',
      };
  }
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
  print_order: {
    label: 'Print Order',
    cls: 'border-teal-500/30 bg-teal-500/10 text-teal-700 dark:text-teal-300',
  },
  print_order_with_delivery: {
    label: 'Print + Delivery',
    cls: 'border-cyan-500/30 bg-cyan-500/10 text-cyan-700 dark:text-cyan-300',
  },
  print_pro_subscription: {
    label: 'Print Pro Plan',
    cls: 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300',
  },
  resource_booking: {
    label: 'Venue / Stay Booking',
    cls: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300',
  },
  booking_pro_subscription: {
    label: 'Booking Pro Plan',
    cls: 'border-green-500/30 bg-green-500/10 text-green-700 dark:text-green-300',
  },
  stay_pro_subscription: {
    label: 'Stay Pro Plan',
    cls: 'border-indigo-500/30 bg-indigo-500/10 text-indigo-700 dark:text-indigo-300',
  },
  shop_order: {
    label: 'Shop Order',
    cls: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  },
  shop_order_with_delivery: {
    label: 'Shop + Delivery',
    cls: 'border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300',
  },
  restaurant_order: {
    label: 'Food Order',
    cls: 'border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300',
  },
  restaurant_order_with_delivery: {
    label: 'Food + Delivery',
    cls: 'border-orange-500/30 bg-orange-500/10 text-orange-700 dark:text-orange-300',
  },
  catalogue_pro_subscription: {
    label: 'Catalogue Pro Plan',
    cls: 'border-blue-500/30 bg-blue-500/10 text-blue-700 dark:text-blue-300',
  },
  restaurant_pro_subscription: {
    label: 'Restaurant Pro Plan',
    cls: 'border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-300',
  },
  real_estate_boost_30d: {
    label: 'Property Boost (30d)',
    cls: 'border-purple-500/30 bg-purple-500/10 text-purple-700 dark:text-purple-300',
  },
  agent_pro_subscription: {
    label: 'Agent Pro Plan',
    cls: 'border-violet-500/30 bg-violet-500/10 text-violet-700 dark:text-violet-300',
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
  const { share } = useShare();
  const activeHubId = activeHub?.id || '';
  const activeHubName = activeHub?.name || 'Churachandpur';
  const { listings, enquiries: storeEnquiries, markNotificationRead } =
    useAppStore();

  const activeUserId = authUser?.id || activeSession?.user?.id || '';

  const [activeTab, setActiveTab] = useState<ActivityTab>('pick_n_drop');
  const [hubFilterMode, setHubFilterMode] = useState<'all' | 'active'>('all');
  const [nowMs, setNowMs] = useState<number>(0);

  const [orders, setOrders] = useState<DeliveryOrderRecord[]>([]);
  const [printOrders, setPrintOrders] = useState<HydratedPrintOrderRow[]>([]);
  const [vehicleBookings, setVehicleBookings] = useState<
    HydratedVehicleBookingRow[]
  >([]);
  const [resourceBookings, setResourceBookings] = useState<
    HydratedResourceBookingRow[]
  >([]);
  const [shopOrders, setShopOrders] = useState<HydratedShopOrderRow[]>([]);
  const [restaurantOrders, setRestaurantOrders] = useState<
    HydratedRestaurantOrderRow[]
  >([]);
  const [tableReservations, setTableReservations] = useState<
    HydratedTableReservationRow[]
  >([]);
  const [propertyVisits, setPropertyVisits] = useState<
    HydratedPropertyVisitRow[]
  >([]);
  const [enquiriesSubFilter, setEnquiriesSubFilter] = useState<
    'all' | 'enquiries' | 'site_visits'
  >('all');
  const [cancellingVisitId, setCancellingVisitId] = useState<string | null>(
    null
  );
  const [commerceSubFilter, setCommerceSubFilter] = useState<
    'all' | 'food' | 'shop' | 'tables'
  >('all');
  const [bookingsSubFilter, setBookingsSubFilter] = useState<
    'all' | 'vehicles' | 'venues_stays'
  >('all');
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
    const rawParam = new URLSearchParams(window.location.search)
      .get('tab')
      ?.trim()
      .toLowerCase();
    const param =
      rawParam === 'trips'
        ? 'pick_n_drop'
        : rawParam === 'bookings'
          ? 'vehicles'
          : rawParam;
    if (param && (VALID_ACTIVITY_TABS as readonly string[]).includes(param)) {
      queueMicrotask(() => {
        setActiveTab(param as ActivityTab);
      });
    }
  }, []);

  // Tick every second when viewing soft-hold timers
  useEffect(() => {
    queueMicrotask(() => setNowMs(Date.now()));
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
        printOrdersRes,
        bookingsRes,
        resourceBookingsRes,
        shopOrdersRes,
        restaurantOrdersRes,
        tableReservationsRes,
        propertyVisitsRes,
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
              .from('print_orders')
              .select(
                '*, listings(id, title, locality, hub_id, lat, lng), print_order_files(id, display_label_masked, server_verified_pages, purge_status)'
              )
              .eq('customer_id', uid)
              .order('created_at', { ascending: false })
              .limit(40)
          : Promise.resolve({ data: null }),
        canQueryDb && uid
          ? supabase
              .from('vehicle_bookings')
              .select('*, vehicle_listings(id, title, stand_locality), vehicle_booking_otps(pickup_otp, dropoff_otp, return_otp)')
              .eq('customer_id', uid)
              .order('created_at', { ascending: false })
              .limit(40)
          : Promise.resolve({ data: null }),
        canQueryDb && uid
          ? supabase
              .from('resource_bookings')
              .select(
                '*, listings(id, title, locality, listing_vertical), listing_booking_resources(id, name, resource_vertical)'
              )
              .eq('customer_id', uid)
              .order('created_at', { ascending: false })
              .limit(40)
          : Promise.resolve({ data: null }),
        canQueryDb && uid
          ? supabase
              .from('shop_orders')
              .select('*, listings(id, title, locality)')
              .eq('customer_id', uid)
              .order('created_at', { ascending: false })
              .limit(40)
          : Promise.resolve({ data: null }),
        canQueryDb && uid
          ? supabase
              .from('restaurant_orders')
              .select('*, listings(id, title, locality)')
              .eq('customer_id', uid)
              .order('created_at', { ascending: false })
              .limit(40)
          : Promise.resolve({ data: null }),
        canQueryDb && uid
          ? supabase
              .from('restaurant_table_reservations')
              .select('*, listings(id, title, locality)')
              .eq('customer_id', uid)
              .order('created_at', { ascending: false })
              .limit(40)
          : Promise.resolve({ data: null }),
        canQueryDb && uid
          ? supabase
              .from('property_visit_requests')
              .select('*, listings(id, title, locality, phone, hub_id)')
              .eq('requester_id', uid)
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

      // v21a (P0-14): plaintext pickup / collection / check-in OTPs no longer live on the
      // operator-readable order rows — they are read from the customer-only RLS vault.
      if (canQueryDb && uid) {
        try {
          const { data: vaultRows } = await supabase
            .from('vertical_order_customer_otps')
            .select('order_table, order_id, otp_display')
            .eq('customer_id', uid);
          const vault = new Map<string, string>();
          for (const v of (vaultRows || []) as Array<{
            order_table: string;
            order_id: string;
            otp_display: string;
          }>) {
            vault.set(`${v.order_table}:${v.order_id}`, v.otp_display);
          }
          const hydrateOtp = (
            rows: unknown,
            table: string,
            column: string
          ) => {
            if (!Array.isArray(rows)) return;
            for (const row of rows as Array<Record<string, unknown>>) {
              const otp = vault.get(`${table}:${String(row.id || '')}`);
              if (otp && !row[column]) row[column] = otp;
            }
          };
          hydrateOtp(printOrdersRes.data, 'print_orders', 'collection_otp_display_for_customer');
          hydrateOtp(shopOrdersRes.data, 'shop_orders', 'pickup_otp_display_for_customer');
          hydrateOtp(restaurantOrdersRes.data, 'restaurant_orders', 'pickup_otp_display_for_customer');
          hydrateOtp(resourceBookingsRes.data, 'resource_bookings', 'checkin_otp_display_for_customer');
        } catch {
          // OTP chips are optional UI — never break the activity feed
        }
      }

      setLiveNotifications(notifs);
      setLiveActivityLogs(logs);

      if (Array.isArray(printOrdersRes.data)) {
        const mappedPrintOrders: HydratedPrintOrderRow[] = (
          printOrdersRes.data as Array<Record<string, unknown>>
        ).map((row) => {
          const listingRaw = Array.isArray(row.listings)
            ? (row.listings[0] as Record<string, unknown> | undefined)
            : (row.listings as Record<string, unknown> | undefined);
          const filesRaw = Array.isArray(row.print_order_files)
            ? (row.print_order_files as Array<Record<string, unknown>>)
            : [];
          const files: HydratedPrintOrderFileSummary[] = filesRaw.map((f) => ({
            id: String(f.id || ''),
            display_label_masked: String(f.display_label_masked || 'Document'),
            server_verified_pages: Number(f.server_verified_pages || 1),
            purge_status: f.purge_status === 'purged' ? 'purged' : 'active',
          }));
          return {
            ...(row as unknown as HydratedPrintOrderRow),
            quoted_amount_inr:
              row.quoted_amount_inr !== null &&
              row.quoted_amount_inr !== undefined
                ? Number(row.quoted_amount_inr)
                : null,
            platform_fee_inr: Number(row.platform_fee_inr || 0),
            listingTitle: String(listingRaw?.title || 'Print Shop').replace(
              /^\[SAMPLE\]\s*/i,
              ''
            ),
            listingLocality: String(listingRaw?.locality || ''),
            listingLat:
              listingRaw?.lat !== null &&
              listingRaw?.lat !== undefined &&
              Number.isFinite(Number(listingRaw.lat))
                ? Number(listingRaw.lat)
                : null,
            listingLng:
              listingRaw?.lng !== null &&
              listingRaw?.lng !== undefined &&
              Number.isFinite(Number(listingRaw.lng))
                ? Number(listingRaw.lng)
                : null,
            files,
          };
        });
        setPrintOrders(mappedPrintOrders);
      } else {
        setPrintOrders([]);
      }

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

      if (Array.isArray(resourceBookingsRes.data)) {
        const mappedResourceBookings: HydratedResourceBookingRow[] = (
          resourceBookingsRes.data as Array<Record<string, unknown>>
        ).map((row) => {
          const listingRaw = Array.isArray(row.listings)
            ? (row.listings[0] as Record<string, unknown> | undefined)
            : (row.listings as Record<string, unknown> | undefined);
          const resRaw = Array.isArray(row.listing_booking_resources)
            ? (row.listing_booking_resources[0] as
                | Record<string, unknown>
                | undefined)
            : (row.listing_booking_resources as
                | Record<string, unknown>
                | undefined);
          const vertical: 'booking_venue' | 'hotel_stay' =
            resRaw?.resource_vertical === 'hotel_stay' ||
            listingRaw?.listing_vertical === 'hotel_stay'
              ? 'hotel_stay'
              : 'booking_venue';
          return {
            ...(row as unknown as ResourceBooking),
            total_amount_inr: Number(row.total_amount_inr || 0),
            advance_amount_inr: Number(row.advance_amount_inr || 0),
            balance_at_venue_inr: Number(row.balance_at_venue_inr || 0),
            convenience_fee_inr: Number(row.convenience_fee_inr || 0),
            listingTitle: String(
              listingRaw?.title || 'Booked Venue / Stay'
            ).replace(/^\[SAMPLE\]\s*/i, ''),
            listingLocality: String(listingRaw?.locality || ''),
            resourceName: String(resRaw?.name || 'Reserved Space'),
            resourceVertical: vertical,
          };
        });
        setResourceBookings(mappedResourceBookings);
      } else {
        setResourceBookings([]);
      }

      if (Array.isArray(shopOrdersRes.data)) {
        const mappedShopOrders: HydratedShopOrderRow[] = (
          shopOrdersRes.data as Array<Record<string, unknown>>
        ).map((row) => {
          const listingRaw = Array.isArray(row.listings)
            ? (row.listings[0] as Record<string, unknown> | undefined)
            : (row.listings as Record<string, unknown> | undefined);
          return {
            ...(row as unknown as ShopOrder),
            subtotal_inr: Number(row.subtotal_inr || 0),
            packaging_fee_inr: Number(row.packaging_fee_inr || 0),
            delivery_fee_inr: Number(row.delivery_fee_inr || 0),
            total_amount_inr: Number(row.total_amount_inr || 0),
            items_snapshot: Array.isArray(row.items_snapshot)
              ? (row.items_snapshot as ShopOrder['items_snapshot'])
              : [],
            listingTitle: String(listingRaw?.title || 'Local Storefront').replace(
              /^\[SAMPLE\]\s*/i,
              ''
            ),
            listingLocality: String(listingRaw?.locality || ''),
          };
        });
        setShopOrders(mappedShopOrders);
      } else {
        setShopOrders([]);
      }

      if (Array.isArray(restaurantOrdersRes.data)) {
        const mappedFoodOrders: HydratedRestaurantOrderRow[] = (
          restaurantOrdersRes.data as Array<Record<string, unknown>>
        ).map((row) => {
          const listingRaw = Array.isArray(row.listings)
            ? (row.listings[0] as Record<string, unknown> | undefined)
            : (row.listings as Record<string, unknown> | undefined);
          return {
            ...(row as unknown as RestaurantOrder),
            subtotal_inr: Number(row.subtotal_inr || 0),
            packaging_fee_inr: Number(row.packaging_fee_inr || 0),
            delivery_fee_inr: Number(row.delivery_fee_inr || 0),
            total_amount_inr: Number(row.total_amount_inr || 0),
            items_snapshot: Array.isArray(row.items_snapshot)
              ? (row.items_snapshot as RestaurantOrder['items_snapshot'])
              : [],
            listingTitle: String(listingRaw?.title || 'Restaurant / Café').replace(
              /^\[SAMPLE\]\s*/i,
              ''
            ),
            listingLocality: String(listingRaw?.locality || ''),
          };
        });
        setRestaurantOrders(mappedFoodOrders);
      } else {
        setRestaurantOrders([]);
      }

      if (Array.isArray(tableReservationsRes.data)) {
        const mappedReservations: HydratedTableReservationRow[] = (
          tableReservationsRes.data as Array<Record<string, unknown>>
        ).map((row) => {
          const listingRaw = Array.isArray(row.listings)
            ? (row.listings[0] as Record<string, unknown> | undefined)
            : (row.listings as Record<string, unknown> | undefined);
          return {
            ...(row as unknown as RestaurantTableReservation),
            party_size: Number(row.party_size || 2),
            listingTitle: String(listingRaw?.title || 'Restaurant / Café').replace(
              /^\[SAMPLE\]\s*/i,
              ''
            ),
            listingLocality: String(listingRaw?.locality || ''),
          };
        });
        setTableReservations(mappedReservations);
      } else {
        setTableReservations([]);
      }

      if (Array.isArray(propertyVisitsRes.data)) {
        const mappedVisits: HydratedPropertyVisitRow[] = (
          propertyVisitsRes.data as Array<Record<string, unknown>>
        ).map((row) => {
          const listingRaw = Array.isArray(row.listings)
            ? (row.listings[0] as Record<string, unknown> | undefined)
            : (row.listings as Record<string, unknown> | undefined);
          return {
            ...(row as unknown as PropertyVisitRequest),
            listingTitle: String(
              listingRaw?.title || 'Real Estate Property'
            ).replace(/^\[SAMPLE\]\s*/i, ''),
            listingLocality: String(listingRaw?.locality || ''),
            listingPhone:
              typeof listingRaw?.phone === 'string' && listingRaw.phone.trim()
                ? listingRaw.phone.trim()
                : null,
          };
        });
        setPropertyVisits(mappedVisits);
      } else {
        setPropertyVisits([]);
      }

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
          const rawOtp = (bk as unknown as {
            vehicle_booking_otps?:
              | { pickup_otp?: string | null; dropoff_otp?: string | null }
              | Array<{ pickup_otp?: string | null; dropoff_otp?: string | null }>
              | null;
          }).vehicle_booking_otps;
          const otpRow = Array.isArray(rawOtp) ? rawOtp[0] : rawOtp;
          return {
            ...bk,
            start_otp: otpRow?.pickup_otp ?? bk.start_otp ?? null,
            end_otp: otpRow?.dropoff_otp ?? bk.end_otp ?? null,
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

  // Pass R6: Lightweight Realtime auto-refresh for customer's live orders
  useRealtimeTableRefresh('delivery_orders', () => void fetchAllActivityData(), {
    enabled: Boolean(activeUserId),
    filter: activeUserId ? `customer_id=eq.${activeUserId}` : undefined,
  });
  useRealtimeTableRefresh('print_orders', () => void fetchAllActivityData(), {
    enabled: Boolean(activeUserId),
    filter: activeUserId ? `customer_id=eq.${activeUserId}` : undefined,
  });
  useRealtimeTableRefresh('restaurant_orders', () => void fetchAllActivityData(), {
    enabled: Boolean(activeUserId),
    filter: activeUserId ? `customer_id=eq.${activeUserId}` : undefined,
  });
  useRealtimeTableRefresh('shop_orders', () => void fetchAllActivityData(), {
    enabled: Boolean(activeUserId),
    filter: activeUserId ? `customer_id=eq.${activeUserId}` : undefined,
  });
  useRealtimeTableRefresh(
    'property_visit_requests',
    () => void fetchAllActivityData(),
    {
      enabled: Boolean(activeUserId),
      filter: activeUserId ? `requester_id=eq.${activeUserId}` : undefined,
    }
  );

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
  const visiblePrintOrders = useMemo(
    () => printOrders.filter((po) => matchesHubFilter(po.hub_id)),
    [printOrders, matchesHubFilter]
  );
  const visibleVehicleBookings = useMemo(
    () => vehicleBookings.filter((bk) => matchesHubFilter(bk.hub_id)),
    [vehicleBookings, matchesHubFilter]
  );
  const visibleResourceBookings = useMemo(
    () => resourceBookings.filter((rb) => matchesHubFilter(rb.hub_id)),
    [resourceBookings, matchesHubFilter]
  );
  const visibleShopOrders = useMemo(
    () => shopOrders.filter((so) => matchesHubFilter(so.hub_id)),
    [shopOrders, matchesHubFilter]
  );
  const visibleRestaurantOrders = useMemo(
    () => restaurantOrders.filter((ro) => matchesHubFilter(ro.hub_id)),
    [restaurantOrders, matchesHubFilter]
  );
  const visibleTableReservations = useMemo(
    () => tableReservations.filter((tr) => matchesHubFilter(tr.hub_id)),
    [tableReservations, matchesHubFilter]
  );
  const visiblePaymentIntents = useMemo(
    () => paymentIntents.filter((pi) => matchesHubFilter(pi.hub_id)),
    [paymentIntents, matchesHubFilter]
  );
  const visibleEnquiries = useMemo(
    () => mergedEnquiries.filter((enq) => matchesHubFilter(enq.hubId)),
    [mergedEnquiries, matchesHubFilter]
  );
  const visiblePropertyVisits = useMemo(
    () => propertyVisits.filter((pv) => matchesHubFilter(pv.hub_id)),
    [propertyVisits, matchesHubFilter]
  );

  const handleCancelPropertyVisit = async (visitId: string) => {
    setCancellingVisitId(visitId);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch('/api/real-estate/visit-requests', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          action: 'update_status',
          requestId: visitId,
          status: 'cancelled',
        }),
      });
      if (res.ok) {
        setPropertyVisits((prev) =>
          prev.map((v) =>
            v.id === visitId ? { ...v, status: 'cancelled' } : v
          )
        );
        setAppStatus('success', 'Site visit cancelled.');
      } else {
        setAppStatus('error', 'Could not cancel site visit.');
      }
    } finally {
      setCancellingVisitId(null);
    }
  };

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

  const openPaymentForResourceBooking = async (
    booking: HydratedResourceBookingRow
  ) => {
    const existing = paymentIntents.find(
      (pi) =>
        (pi.id === booking.payment_intent_id ||
          (pi.purpose === 'resource_booking' && pi.reference_id === booking.id)) &&
        (pi.status === 'awaiting_payment' || pi.status === 'pending_manual')
    );
    if (existing) {
      setPaymentModalMeta({
        title: `${
          booking.resourceVertical === 'hotel_stay'
            ? 'Stay Booking'
            : 'Venue Booking'
        } · ${booking.booking_code}`,
        subtitle: `${booking.listingTitle} — ${booking.resourceName}`,
      });
      setActivePaymentIntent(existing);
      return;
    }

    if (booking.payment_intent_id) {
      setCreatingIntentForId(booking.id);
      try {
        const { data } = await supabase
          .from('payment_intents')
          .select('*')
          .eq('id', booking.payment_intent_id)
          .maybeSingle();
        if (data) {
          const rec = data as PaymentIntentRecord;
          setPaymentModalMeta({
            title: `${
              booking.resourceVertical === 'hotel_stay'
                ? 'Stay Booking'
                : 'Venue Booking'
            } · ${booking.booking_code}`,
            subtitle: `${booking.listingTitle} — ${booking.resourceName}`,
          });
          setActivePaymentIntent(rec);
          return;
        }
      } finally {
        setCreatingIntentForId(null);
      }
    }
    setAppStatus(
      'error',
      'Payment session expired or unavailable. Please create a fresh booking.'
    );
  };

  const openPaymentForCommerceOrder = async (args: {
    kind: 'shop' | 'food';
    orderId: string;
    orderCode: string;
    listingTitle: string;
    paymentIntentId: string | null;
    purpose: PaymentPurpose;
    amountInr: number;
    hubId: string | null;
  }) => {
    const existing = paymentIntents.find(
      (pi) =>
        (args.paymentIntentId && pi.id === args.paymentIntentId) ||
        (pi.reference_id === args.orderId &&
          (pi.status === 'awaiting_payment' || pi.status === 'pending_manual'))
    );
    if (existing) {
      setPaymentModalMeta({
        title: `${args.kind === 'food' ? 'Food Order' : 'Shop Order'} · ${args.orderCode}`,
        subtitle: args.listingTitle,
      });
      setActivePaymentIntent(existing);
      return;
    }

    setCreatingIntentForId(args.orderId);
    try {
      if (args.paymentIntentId) {
        const { data } = await supabase
          .from('payment_intents')
          .select('*')
          .eq('id', args.paymentIntentId)
          .maybeSingle();
        if (data) {
          setPaymentModalMeta({
            title: `${args.kind === 'food' ? 'Food Order' : 'Shop Order'} · ${args.orderCode}`,
            subtitle: args.listingTitle,
          });
          setActivePaymentIntent(data as PaymentIntentRecord);
          return;
        }
      }

      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch('/api/payments/create-intent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          purpose: args.purpose,
          reference_id: args.orderId,
          amount_inr: Number(args.amountInr || 0),
          hubId: args.hubId || activeHubId || undefined,
        }),
      });
      const json = (await res.json()) as {
        intent?: PaymentIntentRecord;
        error?: string;
      };
      if (!res.ok || !json.intent) {
        setAppStatus('error', json.error || 'Could not open payment checkout.');
        return;
      }
      setPaymentModalMeta({
        title: `${args.kind === 'food' ? 'Food Order' : 'Shop Order'} · ${args.orderCode}`,
        subtitle: args.listingTitle,
      });
      setActivePaymentIntent(json.intent);
    } finally {
      setCreatingIntentForId(null);
    }
  };

  const totalCommerceCount =
    visibleRestaurantOrders.length +
    visibleShopOrders.length +
    visibleTableReservations.length;

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
      id: 'commerce',
      label: 'Food & Shop Orders',
      count: totalCommerceCount,
      icon: ShoppingBag,
    },
    {
      id: 'print',
      label: 'Print & Digital',
      count: visiblePrintOrders.length,
      icon: Printer,
    },
    {
      id: 'vehicles',
      label: 'Bookings',
      count: visibleVehicleBookings.length + visibleResourceBookings.length,
      icon: CalendarDays,
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
      count: visibleEnquiries.length + visiblePropertyVisits.length,
      icon: MessageSquare,
    },
  ];

  return (
    <div
      data-testid="activity-destination-view"
      className="mx-auto w-full max-w-6xl space-y-5 px-4 sm:px-6 pt-3 pb-20 lg:pb-10"
    >
      {/* Header */}
      <div className="pb-3 border-b border-[var(--ps-border)]/70 flex flex-wrap items-start justify-between gap-3">
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
            Track Pick N Drop deliveries, Print &amp; Digital orders, Scheduled Vehicle Bookings, UPI/Razorpay receipts, and shop enquiries in one place.
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
        data-tour="activity-tabs"
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

      {/* TAB: FOOD & SHOP ORDERS */}
      {activeTab === 'commerce' && (
        <section className="space-y-4" data-testid="activity-commerce-section">
          {/* Sub-filter pills */}
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                { id: 'all', label: `All (${totalCommerceCount})` },
                {
                  id: 'food',
                  label: `Food Orders (${visibleRestaurantOrders.length})`,
                },
                {
                  id: 'shop',
                  label: `Shop Orders (${visibleShopOrders.length})`,
                },
                {
                  id: 'tables',
                  label: `Table Bookings (${visibleTableReservations.length})`,
                },
              ] as const
            ).map((pill) => (
              <button
                key={pill.id}
                type="button"
                onClick={() => setCommerceSubFilter(pill.id)}
                className={`h-8 rounded-xl px-3 text-xs font-semibold transition-colors ${
                  commerceSubFilter === pill.id
                    ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                    : 'border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                }`}
              >
                {pill.label}
              </button>
            ))}
          </div>

          {totalCommerceCount === 0 && !isLoading && (
            <div className="rounded-2xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-surface)] p-8 text-center space-y-2">
              <ShoppingBag className="mx-auto h-7 w-7 text-[var(--ps-text-muted)] opacity-60" />
              <p className="text-sm font-bold text-[var(--ps-text)]">
                No food orders, shop orders, or table bookings yet
              </p>
              <p className="text-xs text-[var(--ps-text-muted)] max-w-md mx-auto">
                Order from local Shops &amp; Storefronts or Restaurants &amp; Cafés on the Discovery Map to track live status, pickup OTPs, and receipts here.
              </p>
            </div>
          )}

          {/* Food Orders */}
          {(commerceSubFilter === 'all' || commerceSubFilter === 'food') &&
            visibleRestaurantOrders.length > 0 && (
              <div className="space-y-3">
                <h2 className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-orange-700 dark:text-orange-300">
                  <UtensilsCrossed className="h-3.5 w-3.5" />
                  <span>Food Orders ({visibleRestaurantOrders.length})</span>
                </h2>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {visibleRestaurantOrders.map((order) => {
                    const stepIdx = resolveFoodOrderStepIndex(
                      order.kitchen_status
                    );
                    const isCancelled =
                      order.kitchen_status === 'cancelled' ||
                      order.kitchen_status === 'rejected';
                    const needsPayment =
                      !isCancelled &&
                      order.payment_rail === 'platform_escrow' &&
                      (order.payment_status === 'unpaid' ||
                        order.payment_status === 'pending_manual_review');
                    const showOtp =
                      Boolean(order.pickup_otp_display_for_customer) &&
                      !isCancelled &&
                      order.kitchen_status !== 'completed';
                    const crossHub = resolveCrossHubLabel(order.hub_id);

                    return (
                      <div
                        key={order.id}
                        className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3 shadow-2xs"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-mono text-[11px] font-bold text-orange-700 dark:text-orange-300">
                                {order.order_code}
                              </span>
                              <span className="rounded-md border border-orange-500/25 bg-orange-500/10 px-1.5 py-0.5 text-[10px] font-bold text-orange-700 dark:text-orange-300">
                                {order.fulfillment_mode === 'pick_n_drop'
                                  ? 'Pick N Drop'
                                  : 'Takeaway'}
                              </span>
                              {crossHub && (
                                <span className="rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--ps-text-muted)]">
                                  {crossHub}
                                </span>
                              )}
                            </div>
                            <Link
                              href={`/listing/${encodeURIComponent(order.listing_id)}`}
                              className="mt-1 block truncate text-sm font-bold text-[var(--ps-text)] hover:text-[var(--ps-accent)]"
                            >
                              {order.listingTitle}
                            </Link>
                            <p className="text-[11px] text-[var(--ps-text-muted)]">
                              {order.listingLocality || 'Local Kitchen'} ·{' '}
                              {formatIstDateTime(order.created_at)}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="font-mono text-sm font-extrabold text-[var(--ps-text)] tabular-nums">
                              {formatBookingInr(order.total_amount_inr)}
                            </p>
                            <span className="inline-block rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-1.5 py-0.5 text-[10px] font-semibold capitalize text-[var(--ps-text-muted)]">
                              {order.kitchen_status.replace(/_/g, ' ')}
                            </span>
                          </div>
                        </div>

                        {/* Live Status Stepper */}
                        {!isCancelled && (
                          <div className="grid grid-cols-5 gap-1">
                            {FOOD_ORDER_STEPS.map((st, idx) => (
                              <div key={st.key} className="space-y-1">
                                <div
                                  className={`h-1.5 rounded-full ${
                                    idx <= stepIdx
                                      ? 'bg-orange-500'
                                      : 'bg-[var(--ps-border)]'
                                  }`}
                                />
                                <p
                                  className={`text-center text-[9px] font-semibold ${
                                    idx <= stepIdx
                                      ? 'text-[var(--ps-text)]'
                                      : 'text-[var(--ps-text-muted)]'
                                  }`}
                                >
                                  {st.label}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Itemized lines */}
                        <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 space-y-1 text-xs">
                          {order.items_snapshot.slice(0, 4).map((line, i) => (
                            <div
                              key={`${line.menu_item_id}-${i}`}
                              className="flex items-center justify-between gap-2"
                            >
                              <span className="truncate text-[var(--ps-text)]">
                                {line.qty}× {line.name}
                                {line.variant_label
                                  ? ` (${line.variant_label})`
                                  : ''}
                              </span>
                              <span className="font-mono font-semibold text-[var(--ps-text-muted)] tabular-nums">
                                ₹{line.line_total_inr}
                              </span>
                            </div>
                          ))}
                          {order.items_snapshot.length > 4 && (
                            <p className="text-[10px] text-[var(--ps-text-muted)]">
                              +{order.items_snapshot.length - 4} more item(s)
                            </p>
                          )}
                        </div>

                        {/* Pickup OTP */}
                        {showOtp && (
                          <div className="flex items-center justify-between rounded-xl border border-orange-500/30 bg-orange-500/8 px-3 py-2 text-xs">
                            <span className="inline-flex items-center gap-1.5 font-semibold text-orange-800 dark:text-orange-300">
                              <KeyRound className="h-3.5 w-3.5" />
                              <span>Pickup / Handover OTP</span>
                            </span>
                            <span className="font-mono text-base font-extrabold tracking-widest text-orange-700 dark:text-orange-200">
                              {order.pickup_otp_display_for_customer}
                            </span>
                          </div>
                        )}

                        {/* Actions */}
                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                          {needsPayment ? (
                            <button
                              type="button"
                              disabled={creatingIntentForId === order.id}
                              onClick={() =>
                                void openPaymentForCommerceOrder({
                                  kind: 'food',
                                  orderId: order.id,
                                  orderCode: order.order_code,
                                  listingTitle: order.listingTitle,
                                  paymentIntentId: order.payment_intent_id,
                                  purpose:
                                    order.fulfillment_mode === 'pick_n_drop'
                                      ? 'restaurant_order_with_delivery'
                                      : 'restaurant_order',
                                  amountInr: order.total_amount_inr,
                                  hubId: order.hub_id,
                                })
                              }
                              className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-orange-600 px-3 text-xs font-bold text-white hover:bg-orange-700 disabled:opacity-60"
                            >
                              {creatingIntentForId === order.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <CreditCard className="h-3.5 w-3.5" />
                              )}
                              <span>Complete Payment</span>
                            </button>
                          ) : (
                            <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                              {order.payment_status.replace(/_/g, ' ')}
                            </span>
                          )}

                          <Link
                            href={`/listing/${encodeURIComponent(order.listing_id)}`}
                            className="inline-flex h-8 items-center gap-1 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs font-semibold text-[var(--ps-text)] hover:border-[var(--ps-accent)]"
                          >
                            <span>Reorder</span>
                            <ArrowRight className="h-3.5 w-3.5" />
                          </Link>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

          {/* Shop Orders */}
          {(commerceSubFilter === 'all' || commerceSubFilter === 'shop') &&
            visibleShopOrders.length > 0 && (
              <div className="space-y-3">
                <h2 className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-sky-700 dark:text-sky-300">
                  <Store className="h-3.5 w-3.5" />
                  <span>Shop Orders ({visibleShopOrders.length})</span>
                </h2>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {visibleShopOrders.map((order) => {
                    const stepIdx = resolveShopOrderStepIndex(
                      order.order_status
                    );
                    const isCancelled = order.order_status === 'cancelled';
                    const needsPayment =
                      !isCancelled &&
                      order.payment_rail === 'platform_escrow' &&
                      (order.payment_status === 'unpaid' ||
                        order.payment_status === 'pending_manual_review');
                    const showOtp =
                      Boolean(order.pickup_otp_display_for_customer) &&
                      !isCancelled &&
                      order.order_status !== 'completed';
                    const crossHub = resolveCrossHubLabel(order.hub_id);

                    return (
                      <div
                        key={order.id}
                        className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3 shadow-2xs"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-mono text-[11px] font-bold text-sky-700 dark:text-sky-300">
                                {order.order_code}
                              </span>
                              <span className="rounded-md border border-sky-500/25 bg-sky-500/10 px-1.5 py-0.5 text-[10px] font-bold text-sky-700 dark:text-sky-300">
                                {order.handover_mode === 'pick_n_drop'
                                  ? 'Pick N Drop'
                                  : 'Counter Pickup'}
                              </span>
                              {crossHub && (
                                <span className="rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--ps-text-muted)]">
                                  {crossHub}
                                </span>
                              )}
                            </div>
                            <Link
                              href={`/listing/${encodeURIComponent(order.listing_id)}`}
                              className="mt-1 block truncate text-sm font-bold text-[var(--ps-text)] hover:text-[var(--ps-accent)]"
                            >
                              {order.listingTitle}
                            </Link>
                            <p className="text-[11px] text-[var(--ps-text-muted)]">
                              {order.listingLocality || 'Local Shop'} ·{' '}
                              {formatIstDateTime(order.created_at)}
                            </p>
                          </div>
                          <div className="text-right shrink-0">
                            <p className="font-mono text-sm font-extrabold text-[var(--ps-text)] tabular-nums">
                              {formatBookingInr(order.total_amount_inr)}
                            </p>
                            <span className="inline-block rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-1.5 py-0.5 text-[10px] font-semibold capitalize text-[var(--ps-text-muted)]">
                              {order.order_status.replace(/_/g, ' ')}
                            </span>
                          </div>
                        </div>

                        {!isCancelled && (
                          <div className="grid grid-cols-5 gap-1">
                            {SHOP_ORDER_STEPS.map((st, idx) => (
                              <div key={st.key} className="space-y-1">
                                <div
                                  className={`h-1.5 rounded-full ${
                                    idx <= stepIdx
                                      ? 'bg-sky-500'
                                      : 'bg-[var(--ps-border)]'
                                  }`}
                                />
                                <p
                                  className={`text-center text-[9px] font-semibold ${
                                    idx <= stepIdx
                                      ? 'text-[var(--ps-text)]'
                                      : 'text-[var(--ps-text-muted)]'
                                  }`}
                                >
                                  {st.label}
                                </p>
                              </div>
                            ))}
                          </div>
                        )}

                        <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 space-y-1 text-xs">
                          {order.items_snapshot.slice(0, 4).map((line, i) => (
                            <div
                              key={`${line.product_id}-${i}`}
                              className="flex items-center justify-between gap-2"
                            >
                              <span className="truncate text-[var(--ps-text)]">
                                {line.qty}× {line.title}
                              </span>
                              <span className="font-mono font-semibold text-[var(--ps-text-muted)] tabular-nums">
                                ₹{line.line_total_inr}
                              </span>
                            </div>
                          ))}
                          {order.items_snapshot.length > 4 && (
                            <p className="text-[10px] text-[var(--ps-text-muted)]">
                              +{order.items_snapshot.length - 4} more item(s)
                            </p>
                          )}
                        </div>

                        {showOtp && (
                          <div className="flex items-center justify-between rounded-xl border border-sky-500/30 bg-sky-500/8 px-3 py-2 text-xs">
                            <span className="inline-flex items-center gap-1.5 font-semibold text-sky-800 dark:text-sky-300">
                              <KeyRound className="h-3.5 w-3.5" />
                              <span>Pickup / Handover OTP</span>
                            </span>
                            <span className="font-mono text-base font-extrabold tracking-widest text-sky-700 dark:text-sky-200">
                              {order.pickup_otp_display_for_customer}
                            </span>
                          </div>
                        )}

                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                          {needsPayment ? (
                            <button
                              type="button"
                              disabled={creatingIntentForId === order.id}
                              onClick={() =>
                                void openPaymentForCommerceOrder({
                                  kind: 'shop',
                                  orderId: order.id,
                                  orderCode: order.order_code,
                                  listingTitle: order.listingTitle,
                                  paymentIntentId: order.payment_intent_id,
                                  purpose:
                                    order.handover_mode === 'pick_n_drop'
                                      ? 'shop_order_with_delivery'
                                      : 'shop_order',
                                  amountInr: order.total_amount_inr,
                                  hubId: order.hub_id,
                                })
                              }
                              className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-sky-600 px-3 text-xs font-bold text-white hover:bg-sky-700 disabled:opacity-60"
                            >
                              {creatingIntentForId === order.id ? (
                                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                              ) : (
                                <CreditCard className="h-3.5 w-3.5" />
                              )}
                              <span>Complete Payment</span>
                            </button>
                          ) : (
                            <span className="text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
                              {order.payment_status.replace(/_/g, ' ')}
                            </span>
                          )}

                          <Link
                            href={`/listing/${encodeURIComponent(order.listing_id)}`}
                            className="inline-flex h-8 items-center gap-1 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs font-semibold text-[var(--ps-text)] hover:border-[var(--ps-accent)]"
                          >
                            <span>Reorder</span>
                            <ArrowRight className="h-3.5 w-3.5" />
                          </Link>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

          {/* Table Reservations */}
          {(commerceSubFilter === 'all' || commerceSubFilter === 'tables') &&
            visibleTableReservations.length > 0 && (
              <div className="space-y-3">
                <h2 className="flex items-center gap-2 text-xs font-extrabold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                  <CalendarDays className="h-3.5 w-3.5" />
                  <span>
                    Table Reservations ({visibleTableReservations.length})
                  </span>
                </h2>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {visibleTableReservations.map((res) => (
                    <div
                      key={res.id}
                      className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-2.5 shadow-2xs"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <span className="font-mono text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                            {res.reservation_code}
                          </span>
                          <Link
                            href={`/listing/${encodeURIComponent(res.listing_id)}`}
                            className="mt-0.5 block truncate text-sm font-bold text-[var(--ps-text)] hover:text-[var(--ps-accent)]"
                          >
                            {res.listingTitle}
                          </Link>
                          <p className="text-[11px] text-[var(--ps-text-muted)]">
                            {res.listingLocality || 'Dine-In'}
                          </p>
                        </div>
                        <span className="rounded-md border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold capitalize text-emerald-700 dark:text-emerald-300">
                          {res.status}
                        </span>
                      </div>

                      <div className="flex flex-wrap items-center gap-3 text-xs text-[var(--ps-text)]">
                        <span className="inline-flex items-center gap-1 font-semibold">
                          <CalendarDays className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
                          <span>{formatIstDateTime(res.reserved_for)}</span>
                        </span>
                        <span className="inline-flex items-center gap-1 font-semibold">
                          <Users className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
                          <span>
                            {res.party_size} Guest{res.party_size === 1 ? '' : 's'}
                          </span>
                        </span>
                        {res.special_request && (
                          <span className="rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-0.5 text-[10px] font-medium text-[var(--ps-text-muted)]">
                            {res.special_request}
                          </span>
                        )}
                      </div>

                      <div className="flex justify-end pt-1">
                        <Link
                          href={`/listing/${encodeURIComponent(res.listing_id)}`}
                          className="inline-flex h-8 items-center gap-1 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs font-semibold text-[var(--ps-text)] hover:border-[var(--ps-accent)]"
                        >
                          <span>View Menu</span>
                          <ArrowRight className="h-3.5 w-3.5" />
                        </Link>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
        </section>
      )}

      {/* TAB: PRINT & DIGITAL */}
      {activeTab === 'print' && (
        <section className="space-y-3" data-testid="activity-print-section">
          <ActivityPrintOrdersSection
            orders={visiblePrintOrders}
            paymentIntents={paymentIntents}
            isLoading={isLoading}
            resolveCrossHubLabel={resolveCrossHubLabel}
            onOpenPaymentModal={(intent, meta) => {
              setPaymentIntents((prev) => [
                intent,
                ...prev.filter((p) => p.id !== intent.id),
              ]);
              setPaymentModalMeta(meta);
              setActivePaymentIntent(intent);
            }}
            onRefresh={fetchAllActivityData}
          />
        </section>
      )}

      {/* TAB 1: PICK N DROP */}
      {activeTab === 'pick_n_drop' && (
        <section className="space-y-3" data-testid="activity-pick-n-drop-section">
          {isLoading ? (
            <AppBrandLoader
              mode="inline"
              message="Loading Pick N Drop orders…"
              className="min-h-[260px] rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] py-8"
            />
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
                const pickupOtp = order.secrets?.pickup_otp || null;
                const dropoffOtp = order.secrets?.dropoff_otp || null;
                const returnOtp = order.secrets?.return_otp || null;
                const origin =
                  typeof window !== 'undefined' ? window.location.origin : '';
                const trackUrl = origin ? `${origin}/activity?tab=pick_n_drop` : null;
                const shareDropoffMessage = dropoffOtp
                  ? buildContextualWhatsAppMessage({
                      type: 'delivery_otp',
                      code: order.order_code,
                      otp: dropoffOtp,
                      pickup: order.pickup_address,
                      dropoff: order.dropoff_address,
                      url: trackUrl,
                    })
                  : null;
                const shareDropoffHref = dropoffOtp
                  ? buildContextualWhatsAppUrl(order.recipient_phone || '', {
                      type: 'delivery_otp',
                      code: order.order_code,
                      otp: dropoffOtp,
                      pickup: order.pickup_address,
                      dropoff: order.dropoff_address,
                      url: trackUrl,
                    })
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
                          timeZone: 'Asia/Kolkata',
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
                            data-tour="activity-share-otp"
                            className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 px-2.5 text-xs font-semibold text-white"
                          >
                            <MessageCircle className="h-3.5 w-3.5" />
                            <span>Share Dropoff OTP</span>
                          </a>
                        )}
                        {shareDropoffMessage && (
                          <button
                            type="button"
                            onClick={() => {
                              void share({
                                title: `Pick N Drop OTP · ${order.order_code}`,
                                text: shareDropoffMessage,
                                url: trackUrl || undefined,
                                whatsappMessage: shareDropoffMessage,
                              });
                            }}
                            aria-label={`Share Dropoff OTP for ${order.order_code}`}
                            title="Share via native apps, SMS, copy or QR"
                            data-testid={`activity-pnd-native-share-${order.order_code}`}
                            className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text)] hover:border-[var(--ps-accent)] hover:text-[var(--ps-accent)] transition-colors cursor-pointer"
                          >
                            <Share2 className="h-3.5 w-3.5" />
                          </button>
                        )}
                        <button
                          type="button"
                          data-tour="activity-tracker"
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

      {/* TAB 2: UNIFIED BOOKINGS (Vehicles + Venues & Stays) */}
      {activeTab === 'vehicles' && (
        <section className="space-y-3" data-testid="activity-vehicles-section">
          {/* Sub-filter Pill: All | Vehicles | Venues & Stays */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div
              data-testid="activity-bookings-subfilter"
              className="inline-flex h-8 items-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-0.5 text-xs font-semibold"
            >
              {(
                [
                  {
                    id: 'all',
                    label: `All (${visibleVehicleBookings.length + visibleResourceBookings.length})`,
                  },
                  {
                    id: 'vehicles',
                    label: `Vehicles (${visibleVehicleBookings.length})`,
                  },
                  {
                    id: 'venues_stays',
                    label: `Venues & Stays (${visibleResourceBookings.length})`,
                  },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setBookingsSubFilter(opt.id)}
                  className={`h-7 rounded-lg px-2.5 text-[11px] font-bold transition-colors ${
                    bookingsSubFilter === opt.id
                      ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                      : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          {isLoading ? (
            <WorkspaceTableSkeleton rows={4} />
          ) : (bookingsSubFilter === 'all' &&
              visibleVehicleBookings.length === 0 &&
              visibleResourceBookings.length === 0) ||
            (bookingsSubFilter === 'vehicles' &&
              visibleVehicleBookings.length === 0) ||
            (bookingsSubFilter === 'venues_stays' &&
              visibleResourceBookings.length === 0) ? (
            <div className="rounded-2xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-surface)] p-8 text-center space-y-2.5">
              <CalendarDays className="mx-auto h-6 w-6 text-[var(--ps-text-muted)] opacity-70" />
              <p className="text-sm font-bold text-[var(--ps-text)]">
                No bookings yet
              </p>
              <p className="text-xs text-[var(--ps-text-muted)] max-w-sm mx-auto">
                Reserve turf slots, event halls, hotels, homestays, or scheduled
                vehicles across {activeHubName}.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                <Link
                  href="/explore?category=venues_turfs_bookings"
                  className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-xs font-semibold text-white"
                >
                  <CalendarDays className="h-3.5 w-3.5" />
                  <span>Browse Venues</span>
                </Link>
                <Link
                  href="/explore?category=hotels_homestays"
                  className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-indigo-600 px-3 text-xs font-semibold text-white"
                >
                  <BedDouble className="h-3.5 w-3.5" />
                  <span>Browse Stays</span>
                </Link>
                <Link
                  href="/explore?category=vehicles_rentals"
                  className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3 text-xs font-semibold text-[var(--ps-accent-fg)]"
                >
                  <Car className="h-3.5 w-3.5" />
                  <span>Browse Vehicles</span>
                </Link>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {/* Venues & Stays (`resource_bookings`) */}
              {bookingsSubFilter !== 'vehicles' &&
                visibleResourceBookings.map((rb) => {
                  const crossHubLabel = resolveCrossHubLabel(rb.hub_id);
                  const bBadge = getResourceBookingStatusBadge(
                    rb.booking_status
                  );
                  const pBadge = getResourcePaymentStatusBadge(
                    rb.payment_status
                  );
                  const isHotel = rb.resourceVertical === 'hotel_stay';
                  const showOtp =
                    (rb.booking_status === 'confirmed' ||
                      rb.booking_status === 'checked_in') &&
                    Boolean(rb.checkin_otp_display_for_customer);

                  return (
                    <article
                      key={rb.id}
                      data-testid={`activity-resource-booking-card-${rb.booking_code}`}
                      className="flex flex-col justify-between rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3"
                    >
                      <div className="space-y-2.5">
                        <div className="flex flex-wrap items-center justify-between gap-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="font-mono text-xs font-extrabold text-[var(--ps-text)]">
                              {rb.booking_code}
                            </span>
                            <span
                              className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[10px] font-bold ${
                                isHotel
                                  ? 'border-indigo-500/30 bg-indigo-500/10 text-indigo-800 dark:text-indigo-300'
                                  : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-300'
                              }`}
                            >
                              {isHotel ? (
                                <BedDouble className="h-2.5 w-2.5" />
                              ) : (
                                <CalendarDays className="h-2.5 w-2.5" />
                              )}
                              {isHotel ? 'Stay' : 'Venue'}
                            </span>
                            {crossHubLabel && (
                              <span className="inline-flex items-center gap-1 rounded-md border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700 dark:text-indigo-300">
                                <MapPin className="h-2.5 w-2.5" />
                                {crossHubLabel}
                              </span>
                            )}
                          </div>
                          <div className="flex flex-wrap items-center gap-1">
                            <span
                              className={`rounded-md border px-2 py-0.5 text-[10px] font-bold ${bBadge.cls}`}
                            >
                              {bBadge.label}
                            </span>
                            <span
                              className={`rounded-md border px-2 py-0.5 text-[10px] font-bold ${pBadge.cls}`}
                            >
                              {pBadge.label}
                            </span>
                          </div>
                        </div>

                        <div>
                          <Link
                            href={`/listing/${encodeURIComponent(rb.listing_id)}`}
                            className="text-sm font-bold text-[var(--ps-text)] hover:text-[var(--ps-accent)] transition-colors"
                          >
                            {rb.listingTitle}
                          </Link>
                          <p className="text-[11px] text-[var(--ps-text-muted)]">
                            {rb.resourceName}
                            {rb.listingLocality ? ` · ${rb.listingLocality}` : ''}
                            {rb.units_booked > 1
                              ? ` · ${rb.units_booked} units`
                              : ''}
                          </p>
                        </div>

                        <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 text-xs space-y-1">
                          <div className="flex items-center gap-1.5 font-semibold text-[var(--ps-text)]">
                            <Clock className="h-3.5 w-3.5 text-[var(--ps-accent)] shrink-0" />
                            <span>
                              {formatIstDateTime(rb.start_at)} →{' '}
                              {formatIstDateTime(rb.end_at)}
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-[var(--ps-text-muted)]">
                            <span>
                              Total:{' '}
                              <strong className="font-mono text-[var(--ps-text)]">
                                {formatBookingInr(rb.total_amount_inr)}
                              </strong>
                            </span>
                            <span>
                              Advance:{' '}
                              <strong className="font-mono text-[var(--ps-text)]">
                                {formatBookingInr(rb.advance_amount_inr)}
                              </strong>
                            </span>
                            <span>
                              At Venue:{' '}
                              <strong className="font-mono text-[var(--ps-text)]">
                                {formatBookingInr(rb.balance_at_venue_inr)}
                              </strong>
                            </span>
                          </div>
                        </div>

                        {showOtp && (
                          <div className="flex items-center justify-between gap-2 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-3 py-2 text-xs">
                            <span className="inline-flex items-center gap-1.5 font-bold text-emerald-800 dark:text-emerald-200">
                              <KeyRound className="h-3.5 w-3.5 shrink-0" />
                              Check-In OTP
                            </span>
                            <span className="font-mono text-base font-black tracking-[0.2em] text-emerald-900 dark:text-emerald-100">
                              {rb.checkin_otp_display_for_customer}
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--ps-border)] pt-2.5">
                        <Link
                          href={`/listing/${encodeURIComponent(rb.listing_id)}`}
                          className="inline-flex h-8 items-center gap-1 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]"
                        >
                          <span>View Listing</span>
                          <ExternalLink className="h-3 w-3" />
                        </Link>
                        {rb.booking_status === 'pending_payment' && (
                          <button
                            type="button"
                            disabled={creatingIntentForId === rb.id}
                            onClick={() =>
                              void openPaymentForResourceBooking(rb)
                            }
                            className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 px-3 text-xs font-bold text-white disabled:opacity-50"
                          >
                            {creatingIntentForId === rb.id ? (
                              <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            ) : (
                              <CreditCard className="h-3.5 w-3.5" />
                            )}
                            <span>Complete Payment</span>
                          </button>
                        )}
                      </div>
                    </article>
                  );
                })}

              {/* Scheduled Vehicle Bookings */}
              {bookingsSubFilter !== 'venues_stays' &&
                visibleVehicleBookings.map((bk) => {
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
                            timeZone: 'Asia/Kolkata',
                          })}{' '}
                          –{' '}
                          {new Date(bk.end_time).toLocaleString('en-IN', {
                            day: '2-digit',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                            timeZone: 'Asia/Kolkata',
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
            <WorkspaceTableSkeleton rows={4} />
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
                            timeZone: 'Asia/Kolkata',
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

      {/* TAB 4: ENQUIRIES, SITE VISITS & LIVE ALERTS */}
      {activeTab === 'enquiries' && (
        <section className="space-y-5" data-testid="activity-enquiries-section">
          {/* Sub-filter pills */}
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                {
                  id: 'all',
                  label: `All (${visibleEnquiries.length + visiblePropertyVisits.length})`,
                },
                {
                  id: 'enquiries',
                  label: `Enquiries (${visibleEnquiries.length})`,
                },
                {
                  id: 'site_visits',
                  label: `Site Visits (${visiblePropertyVisits.length})`,
                },
              ] as const
            ).map((pill) => (
              <button
                key={pill.id}
                type="button"
                onClick={() => setEnquiriesSubFilter(pill.id)}
                className={`h-8 rounded-xl px-3 text-xs font-semibold transition-colors cursor-pointer ${
                  enquiriesSubFilter === pill.id
                    ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                    : 'border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                }`}
              >
                {pill.label}
              </button>
            ))}
          </div>

          {/* Real Estate Site Visit Requests */}
          {(enquiriesSubFilter === 'all' ||
            enquiriesSubFilter === 'site_visits') && (
            <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3">
              <div className="flex items-center justify-between gap-2">
                <h2 className="flex items-center gap-2 text-sm font-bold text-[var(--ps-text)]">
                  <CalendarDays className="h-4 w-4 text-violet-600" />
                  <span>Property Site Visits ({visiblePropertyVisits.length})</span>
                </h2>
              </div>

              {visiblePropertyVisits.length === 0 ? (
                <div className="rounded-xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-bg)] p-6 text-center text-xs text-[var(--ps-text-muted)]">
                  No property site visit requests yet. Request a visit on any Real Estate listing to track confirmation and unlock owner contact here.
                </div>
              ) : (
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {visiblePropertyVisits.map((visit) => {
                    const crossHubLabel = resolveCrossHubLabel(visit.hub_id);
                    return (
                      <div
                        key={visit.id}
                        className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3.5 space-y-2 text-xs"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="font-mono text-[11px] font-bold text-violet-700 dark:text-violet-300">
                                {visit.request_code}
                              </span>
                              {crossHubLabel && (
                                <span className="rounded border border-[var(--ps-border)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--ps-text-muted)]">
                                  {crossHubLabel}
                                </span>
                              )}
                            </div>
                            <Link
                              href={`/listing/${encodeURIComponent(visit.listing_id)}`}
                              className="mt-0.5 block truncate font-bold text-[var(--ps-text)] hover:text-violet-600"
                            >
                              {visit.listingTitle}
                            </Link>
                            <p className="text-[11px] text-[var(--ps-text-muted)]">
                              {visit.listingLocality} · {visit.preferred_date} (
                              <span className="capitalize">{visit.preferred_slot}</span>)
                            </p>
                          </div>
                          <span className="shrink-0 rounded-md border border-violet-500/30 bg-violet-500/10 px-2 py-0.5 text-[10px] font-bold capitalize text-violet-700 dark:text-violet-300">
                            {visit.status}
                          </span>
                        </div>

                        {visit.owner_note && (
                          <p className="rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 py-1.5 text-[11px] text-[var(--ps-text)]">
                            <strong className="text-[var(--ps-text-muted)]">Owner note:</strong>{' '}
                            {visit.owner_note}
                          </p>
                        )}

                        <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                          {visit.contact_revealed && visit.listingPhone ? (
                            <a
                              href={`tel:${visit.listingPhone}`}
                              className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-xs font-bold text-white hover:bg-emerald-700"
                            >
                              <Phone className="h-3.5 w-3.5" />
                              <span>Call Owner ({visit.listingPhone})</span>
                            </a>
                          ) : (
                            <span className="text-[11px] text-[var(--ps-text-muted)]">
                              {visit.status === 'requested'
                                ? 'Contact unlocks once accepted'
                                : visit.status === 'cancelled' || visit.status === 'declined'
                                  ? 'Closed'
                                  : 'Visit tracked'}
                            </span>
                          )}

                          {visit.status === 'requested' && (
                            <button
                              type="button"
                              disabled={cancellingVisitId === visit.id}
                              onClick={() => void handleCancelPropertyVisit(visit.id)}
                              className="inline-flex h-8 items-center gap-1 rounded-xl border border-rose-500/35 bg-rose-500/10 px-3 text-xs font-semibold text-rose-700 dark:text-rose-300 hover:bg-rose-500/20 disabled:opacity-60 cursor-pointer"
                            >
                              {cancellingVisitId === visit.id
                                ? 'Cancelling…'
                                : 'Cancel Visit'}
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Customer Enquiries */}
          {(enquiriesSubFilter === 'all' ||
            enquiriesSubFilter === 'enquiries') && (
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
          )}

          {/* Actionable Alerts (Bell Inbox Mirror) vs. Chronological Activity Timeline (get_my_activity_feed) */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <div
              data-testid="live-notifications-panel"
              className="space-y-3 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="flex items-center gap-2 text-sm font-bold text-[var(--ps-text)]">
                    <Bell className="h-4 w-4 text-[var(--ps-accent)]" />
                    <span>Actionable Alerts ({liveNotifications.length})</span>
                  </h2>
                  <p className="text-[11px] text-[var(--ps-text-muted)]">
                    Direct role handoffs &amp; status alerts (also accessible from the top Bell inbox).
                  </p>
                </div>
                <div className="flex items-center gap-1.5">
                  {unreadCount > 0 && (
                    <>
                      <span
                        data-testid="panel-unread-count-pill"
                        className="rounded-full bg-rose-600 px-2 py-0.5 text-[10px] font-bold text-white tabular-nums"
                      >
                        {unreadCount} Unread
                      </span>
                      <button
                        type="button"
                        onClick={() => {
                          setLiveNotifications((prev) =>
                            prev.map((item) => ({
                              ...item,
                              is_read: true,
                              read: true,
                            }))
                          );
                          void markAllNotificationsAsRead(activeUserId);
                        }}
                        className="min-h-[34px] rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 py-1 text-[11px] font-bold text-[var(--ps-accent)] hover:bg-[var(--ps-surface-alt)] cursor-pointer"
                      >
                        Mark all read
                      </button>
                    </>
                  )}
                </div>
              </div>

              {liveNotifications.length === 0 ? (
                <div
                  data-testid="notifications-empty-state"
                  className="rounded-xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-bg)] p-5 text-center text-xs text-[var(--ps-text-muted)]"
                >
                  No actionable notifications right now.
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
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="rounded border border-[var(--ps-border)] bg-[var(--ps-surface)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[var(--ps-text-muted)]">
                            {(notif.category || 'system').replace(/_/g, ' ')}
                          </span>
                          {notif.priority === 'urgent' && (
                            <span className="rounded bg-rose-600 px-1.5 py-0.5 text-[9px] font-extrabold uppercase text-white">
                              Urgent
                            </span>
                          )}
                          <span className="text-[10px] text-[var(--ps-text-muted)]">
                            {formatRelativeIstTime(notif.created_at)}
                          </span>
                        </div>
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
                          className="min-h-[34px] shrink-0 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 py-1 text-[10px] font-semibold text-[var(--ps-text)] cursor-pointer"
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
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h2 className="flex items-center gap-2 text-sm font-bold text-[var(--ps-text)]">
                    <Activity className="h-4 w-4 text-[var(--ps-accent)]" />
                    <span>Chronological Activity Timeline ({liveActivityLogs.length})</span>
                  </h2>
                  <p className="text-[11px] text-[var(--ps-text-muted)]">
                    Unified audit &amp; personal timeline of orders, visits, and workspace actions.
                  </p>
                </div>
              </div>

              {liveActivityLogs.length === 0 ? (
                <div
                  data-testid="activity-logs-empty-state"
                  className="rounded-xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-bg)] p-5 text-center text-xs text-[var(--ps-text-muted)]"
                >
                  No recorded activity timeline events yet.
                </div>
              ) : (
                <div className="max-h-80 space-y-2 overflow-y-auto pr-1">
                  {liveActivityLogs.map((log) => (
                    <div
                      key={`${log.source}-${log.id}`}
                      data-testid={`activity-log-item-${log.id}`}
                      className="flex items-start justify-between gap-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-2.5 text-xs"
                    >
                      <div className="min-w-0 flex-1 space-y-0.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="rounded border border-[var(--ps-border)] bg-[var(--ps-surface)] px-1.5 py-0.5 text-[9px] font-bold uppercase text-[var(--ps-text-muted)]">
                            {log.workspace || 'personal'}
                          </span>
                          <span className="font-bold text-[var(--ps-text)] truncate">
                            {log.entity_title}
                          </span>
                        </div>
                        {log.details && log.details !== log.entity_title && (
                          <p className="text-[11px] text-[var(--ps-text-muted)] line-clamp-1">
                            {log.details}
                          </p>
                        )}
                      </div>
                      <span className="shrink-0 font-mono text-[10px] text-[var(--ps-text-muted)]">
                        {formatRelativeIstTime(log.created_at)}
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
