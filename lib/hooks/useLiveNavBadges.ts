'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import {
  CART_COUNT_STORAGE_KEY,
  LAST_SEEN_BULLETIN_KEY,
  getCartCount,
  getLastSeenBulletinAt,
  onBadgesRefresh,
} from '@/lib/badges/badge-bus';

export interface AdminBadgeBreakdown {
  listings: number;
  partnerApplications: number;
  payPerOrders: number;
  featuredRequests: number;
  categories: number;
  bulletinReports: number;
  civicReports: number;
  contactMessages: number;
  paymentIntents: number;
}

export const EMPTY_ADMIN_BREAKDOWN: AdminBadgeBreakdown = {
  listings: 0,
  partnerApplications: 0,
  payPerOrders: 0,
  featuredRequests: 0,
  categories: 0,
  bulletinReports: 0,
  civicReports: 0,
  contactMessages: 0,
  paymentIntents: 0,
};

export interface LiveNavBadges {
  pickNDropActive: number;
  commerceActive: number;
  bookingsActive: number;
  vehiclesActive: number;
  cartCount: number;
  newBulletinsCount: number;
  activityTotal: number;
  unreadNotifications: number;
  unreadMessages: number;
  workspacePending: number;
  ownerOrders: number;
  ownerBookings: number;
  ownerPrint: number;
  ownerEnquiries: number;
  workspaceHatCounts: {
    owner: number;
    staff: number;
    advertiser: number;
    driver: number;
    mediator: number;
    hubManager: number;
    masterControl: number;
  };
  adminBreakdown: AdminBadgeBreakdown;
  isLoading: boolean;
}

export interface LiveNavBadgeOptions {
  userId?: string | null;
  hasOwnerHat?: boolean;
  hasStaffHat?: boolean;
  hasAdvertiserHat?: boolean;
  hasDriverHat?: boolean;
  hasMediatorHat?: boolean;
  hasHubManagerHat?: boolean;
  hasMasterControlHat?: boolean;
}

export const EMPTY_LIVE_NAV_BADGES: LiveNavBadges = {
  pickNDropActive: 0,
  commerceActive: 0,
  bookingsActive: 0,
  vehiclesActive: 0,
  cartCount: 0,
  newBulletinsCount: 0,
  activityTotal: 0,
  unreadNotifications: 0,
  unreadMessages: 0,
  workspacePending: 0,
  ownerOrders: 0,
  ownerBookings: 0,
  ownerPrint: 0,
  ownerEnquiries: 0,
  workspaceHatCounts: {
    owner: 0,
    staff: 0,
    advertiser: 0,
    driver: 0,
    mediator: 0,
    hubManager: 0,
    masterControl: 0,
  },
  adminBreakdown: EMPTY_ADMIN_BREAKDOWN,
  isLoading: false,
};

function toNonNegInt(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? Math.floor(num) : 0;
}

async function fetchUnreadBulletinsCount(): Promise<number> {
  if (!isSupabaseConfigured()) return 0;
  try {
    const lastSeenIso =
      getLastSeenBulletinAt() ||
      new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const nowIso = new Date().toISOString();
    const { count, error } = await supabase
      .from('bulletins')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'published')
      .gt('created_at', lastSeenIso)
      .or(`paid_until.is.null,paid_until.gt.${nowIso}`);
    if (error) return 0;
    return toNonNegInt(count);
  } catch {
    return 0;
  }
}

async function fetchFallbackBasicBadges(
  userId: string
): Promise<Partial<LiveNavBadges>> {
  const safeCount = async (
    queryPromise: PromiseLike<{ count: number | null; error: unknown }>
  ): Promise<number> => {
    try {
      const res = await queryPromise;
      return res.error ? 0 : toNonNegInt(res.count);
    } catch {
      return 0;
    }
  };

  const [notifications, pnd, shop, restaurant, print, bookings, vehicles, visits] =
    await Promise.all([
      safeCount(
        supabase
          .from('notifications')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', userId)
          .eq('is_read', false)
      ),
      safeCount(
        supabase
          .from('delivery_orders')
          .select('id', { count: 'exact', head: true })
          .eq('customer_id', userId)
          .in('status', [
            'awaiting_payment',
            'payment_submitted',
            'escrow_held',
            'driver_assigned',
            'picked_up',
            'in_transit',
            'delivered_pending_confirm',
            'return_in_transit',
          ])
      ),
      safeCount(
        supabase
          .from('shop_orders')
          .select('id', { count: 'exact', head: true })
          .eq('customer_id', userId)
          .not('order_status', 'in', '(completed,cancelled)')
      ),
      safeCount(
        supabase
          .from('restaurant_orders')
          .select('id', { count: 'exact', head: true })
          .eq('customer_id', userId)
          .not('kitchen_status', 'in', '(completed,rejected,cancelled)')
      ),
      safeCount(
        supabase
          .from('print_orders')
          .select('id', { count: 'exact', head: true })
          .eq('customer_id', userId)
          .not('fulfillment_status', 'in', '(draft,collected,cancelled)')
      ),
      safeCount(
        supabase
          .from('resource_bookings')
          .select('id', { count: 'exact', head: true })
          .eq('customer_id', userId)
          .not('booking_status', 'in', '(completed,cancelled,no_show,blocked)')
      ),
      safeCount(
        supabase
          .from('vehicle_bookings')
          .select('id', { count: 'exact', head: true })
          .eq('customer_id', userId)
          .not('status', 'in', '(completed,cancelled,expired)')
      ),
      safeCount(
        supabase
          .from('property_visit_requests')
          .select('id', { count: 'exact', head: true })
          .eq('requester_id', userId)
          .in('status', ['requested', 'accepted', 'rescheduled'])
      ),
    ]);

  const commerceActive = shop + restaurant + print;
  const bookingsActive = bookings + vehicles + visits;
  return {
    unreadNotifications: notifications,
    pickNDropActive: pnd,
    commerceActive,
    bookingsActive,
    vehiclesActive: vehicles,
    activityTotal: pnd + commerceActive + bookingsActive,
  };
}

/**
 * Unified, self-clearing live navigation & workspace badge hook (`v24a`).
 * Calls server-side `get_my_actionable_badges()` RPC (strictly scoped to unresolved items),
 * merges cart + unread bulletin counts, and subscribes to both `dd:badges:refresh`
 * and Supabase Realtime changes with automatic cleanup on unmount.
 */
export function useLiveNavBadges(options: LiveNavBadgeOptions): LiveNavBadges {
  const userId = (options.userId || '').trim();
  const hasOwnerHat = Boolean(options.hasOwnerHat);
  const hasStaffHat = Boolean(options.hasStaffHat);
  const hasAdvertiserHat = Boolean(options.hasAdvertiserHat);
  const hasDriverHat = Boolean(options.hasDriverHat);
  const hasMediatorHat = Boolean(options.hasMediatorHat);
  const hasHubManagerHat = Boolean(options.hasHubManagerHat);
  const hasMasterControlHat = Boolean(options.hasMasterControlHat);

  const [badges, setBadges] = useState<LiveNavBadges>(EMPTY_LIVE_NAV_BADGES);
  const debounceTimerRef = useRef<number | null>(null);
  const mountedRef = useRef<boolean>(true);

  const fetchAllCounts = useCallback(async () => {
    const cartCount = getCartCount();
    const newBulletinsCount = await fetchUnreadBulletinsCount();

    if (!userId || !isSupabaseConfigured()) {
      if (mountedRef.current) {
        setBadges({
          ...EMPTY_LIVE_NAV_BADGES,
          cartCount,
          newBulletinsCount,
        });
      }
      return;
    }

    try {
      const { data: rpcPayload, error: rpcError } = await supabase.rpc(
        'get_my_actionable_badges'
      );

      if (rpcError || !rpcPayload || typeof rpcPayload !== 'object') {
        const fallback = await fetchFallbackBasicBadges(userId);
        if (mountedRef.current) {
          setBadges({
            ...EMPTY_LIVE_NAV_BADGES,
            ...fallback,
            cartCount,
            newBulletinsCount,
            isLoading: false,
          });
        }
        return;
      }

      const raw = rpcPayload as Record<string, unknown>;
      const rawBreakdown =
        raw.admin_breakdown && typeof raw.admin_breakdown === 'object'
          ? (raw.admin_breakdown as Record<string, unknown>)
          : {};

      const unreadNotifications = toNonNegInt(raw.notifications);
      const activityActive = toNonNegInt(raw.activity_active);
      const bookingsCustomer = toNonNegInt(raw.bookings_customer);

      const ownerOrders = toNonNegInt(raw.owner_orders);
      const ownerBookings = toNonNegInt(raw.owner_bookings);
      const ownerPrint = toNonNegInt(raw.owner_print);
      const ownerEnquiries = toNonNegInt(raw.owner_enquiries);
      const ownerTotal =
        ownerOrders + ownerBookings + ownerPrint + ownerEnquiries;

      const advertiserCount = hasAdvertiserHat
        ? toNonNegInt(raw.advertiser_actionable)
        : 0;
      const driverCount = hasDriverHat
        ? toNonNegInt(raw.driver_actionable)
        : 0;
      const mediatorCount = hasMediatorHat
        ? toNonNegInt(raw.mediator_actionable)
        : 0;
      const hubManagerCount = hasHubManagerHat
        ? toNonNegInt(raw.hub_moderation)
        : 0;
      const adminCount = hasMasterControlHat
        ? toNonNegInt(raw.admin_actionable)
        : 0;

      const ownerHatCount = hasOwnerHat ? ownerTotal : 0;
      const staffHatCount = hasStaffHat ? ownerTotal : 0;

      const adminBreakdown: AdminBadgeBreakdown = hasMasterControlHat
        ? {
            listings: toNonNegInt(rawBreakdown.listings),
            partnerApplications: toNonNegInt(rawBreakdown.partner_applications),
            payPerOrders: toNonNegInt(rawBreakdown.pay_per_orders),
            featuredRequests: toNonNegInt(rawBreakdown.featured_requests),
            categories: toNonNegInt(rawBreakdown.categories),
            bulletinReports: toNonNegInt(rawBreakdown.bulletin_reports),
            civicReports: toNonNegInt(rawBreakdown.civic_reports),
            contactMessages: toNonNegInt(rawBreakdown.contact_messages),
            paymentIntents: toNonNegInt(rawBreakdown.payment_intents),
          }
        : EMPTY_ADMIN_BREAKDOWN;

      const workspacePending =
        ownerHatCount +
        (hasStaffHat && !hasOwnerHat ? staffHatCount : 0) +
        advertiserCount +
        driverCount +
        mediatorCount +
        (hasMasterControlHat ? adminCount : hubManagerCount);

      if (mountedRef.current) {
        setBadges({
          pickNDropActive: activityActive,
          commerceActive: cartCount,
          bookingsActive: bookingsCustomer,
          vehiclesActive: bookingsCustomer,
          cartCount,
          newBulletinsCount,
          activityTotal: activityActive,
          unreadNotifications,
          unreadMessages: hasMasterControlHat ? adminBreakdown.contactMessages : 0,
          workspacePending,
          ownerOrders,
          ownerBookings,
          ownerPrint,
          ownerEnquiries,
          workspaceHatCounts: {
            owner: ownerHatCount,
            staff: staffHatCount,
            advertiser: advertiserCount,
            driver: driverCount,
            mediator: mediatorCount,
            hubManager: hubManagerCount,
            masterControl: adminCount,
          },
          adminBreakdown,
          isLoading: false,
        });
      }
    } catch {
      if (mountedRef.current) {
        setBadges((prev) => ({
          ...prev,
          cartCount,
          newBulletinsCount,
          isLoading: false,
        }));
      }
    }
  }, [
    userId,
    hasOwnerHat,
    hasStaffHat,
    hasAdvertiserHat,
    hasDriverHat,
    hasMediatorHat,
    hasHubManagerHat,
    hasMasterControlHat,
  ]);

  const scheduleRefresh = useCallback(() => {
    if (typeof window === 'undefined') return;
    if (debounceTimerRef.current !== null) {
      window.clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = window.setTimeout(() => {
      debounceTimerRef.current = null;
      void fetchAllCounts();
    }, 350);
  }, [fetchAllCounts]);

  useEffect(() => {
    mountedRef.current = true;

    queueMicrotask(() => {
      void fetchAllCounts();
    });

    const handleNotificationSync = () => scheduleRefresh();
    const unsubBus = onBadgesRefresh(() => scheduleRefresh());
    const handleStorage = (e: StorageEvent) => {
      if (
        e.key === CART_COUNT_STORAGE_KEY ||
        e.key === LAST_SEEN_BULLETIN_KEY
      ) {
        scheduleRefresh();
      }
    };

    window.addEventListener(
      'printswift:notifications-updated',
      handleNotificationSync
    );
    window.addEventListener('storage', handleStorage);

    let channel: ReturnType<typeof supabase.channel> | null = null;
    if (userId && isSupabaseConfigured()) {
      try {
        const chName = `live-nav-badges-${userId}-${Date.now()}-${Math.random()
          .toString(36)
          .slice(2, 6)}`;
        const ch = supabase
          .channel(chName)
          .on(
            'postgres_changes',
            {
              event: '*',
              schema: 'public',
              table: 'notifications',
              filter: `user_id=eq.${userId}`,
            },
            scheduleRefresh
          )
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'delivery_orders' },
            scheduleRefresh
          )
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'shop_orders' },
            scheduleRefresh
          )
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'restaurant_orders' },
            scheduleRefresh
          )
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'print_orders' },
            scheduleRefresh
          )
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'resource_bookings' },
            scheduleRefresh
          )
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'vehicle_bookings' },
            scheduleRefresh
          )
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'property_visit_requests' },
            scheduleRefresh
          )
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'bulletins' },
            scheduleRefresh
          );

        if (
          hasOwnerHat ||
          hasStaffHat ||
          hasHubManagerHat ||
          hasMasterControlHat
        ) {
          ch.on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'enquiries' },
            scheduleRefresh
          ).on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'reviews' },
            scheduleRefresh
          );
        }

        if (hasMediatorHat || hasHubManagerHat || hasMasterControlHat) {
          ch.on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'payment_intents' },
            scheduleRefresh
          );
        }

        if (hasHubManagerHat || hasMasterControlHat) {
          ch.on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'listings' },
            scheduleRefresh
          )
            .on(
              'postgres_changes',
              { event: '*', schema: 'public', table: 'partner_applications' },
              scheduleRefresh
            )
            .on(
              'postgres_changes',
              { event: '*', schema: 'public', table: 'civic_correction_reports' },
              scheduleRefresh
            )
            .on(
              'postgres_changes',
              { event: '*', schema: 'public', table: 'bulletin_reports' },
              scheduleRefresh
            );
        }

        if (hasMasterControlHat) {
          ch.on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'pay_per_orders' },
            scheduleRefresh
          ).on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'featured_requests' },
            scheduleRefresh
          );
        }

        channel = ch.subscribe();
      } catch {
        channel = null;
      }
    }

    return () => {
      mountedRef.current = false;
      unsubBus();
      window.removeEventListener(
        'printswift:notifications-updated',
        handleNotificationSync
      );
      window.removeEventListener('storage', handleStorage);
      if (debounceTimerRef.current !== null) {
        window.clearTimeout(debounceTimerRef.current);
      }
      if (channel) {
        try {
          void supabase.removeChannel(channel);
        } catch {
          // ignore cleanup errors
        }
      }
    };
  }, [
    userId,
    hasOwnerHat,
    hasStaffHat,
    hasMediatorHat,
    hasHubManagerHat,
    hasMasterControlHat,
    fetchAllCounts,
    scheduleRefresh,
  ]);

  return badges;
}
