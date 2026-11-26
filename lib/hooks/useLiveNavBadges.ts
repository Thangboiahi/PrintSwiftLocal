'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';

export interface LiveNavBadges {
  pickNDropActive: number;
  commerceActive: number;
  bookingsActive: number;
  vehiclesActive: number;
  activityTotal: number;
  unreadNotifications: number;
  unreadMessages: number;
  workspacePending: number;
  workspaceHatCounts: {
    owner: number;
    staff: number;
    driver: number;
    hubManager: number;
    masterControl: number;
  };
  isLoading: boolean;
}

export interface LiveNavBadgeOptions {
  userId?: string | null;
  hasOwnerHat?: boolean;
  hasStaffHat?: boolean;
  hasDriverHat?: boolean;
  hasHubManagerHat?: boolean;
  hasMasterControlHat?: boolean;
}

export const EMPTY_LIVE_NAV_BADGES: LiveNavBadges = {
  pickNDropActive: 0,
  commerceActive: 0,
  bookingsActive: 0,
  vehiclesActive: 0,
  activityTotal: 0,
  unreadNotifications: 0,
  unreadMessages: 0,
  workspacePending: 0,
  workspaceHatCounts: {
    owner: 0,
    staff: 0,
    driver: 0,
    hubManager: 0,
    masterControl: 0,
  },
  isLoading: false,
};

async function safeCount(
  queryPromise: PromiseLike<{ count: number | null; error: unknown }>
): Promise<number> {
  try {
    const res = await queryPromise;
    if (res.error) return 0;
    return typeof res.count === 'number' && Number.isFinite(res.count)
      ? Math.max(0, res.count)
      : 0;
  } catch {
    return 0;
  }
}

/**
 * Pass V2: Single batched, debounced live navigation badge hook with Supabase Realtime updates.
 * Computes active customer orders/bookings/notifications and (only if operational hats exist)
 * pending workspace action counts. Never throws on RLS or unmigrated tables.
 */
export function useLiveNavBadges(options: LiveNavBadgeOptions): LiveNavBadges {
  const userId = (options.userId || '').trim();
  const hasOwnerHat = Boolean(options.hasOwnerHat);
  const hasStaffHat = Boolean(options.hasStaffHat);
  const hasDriverHat = Boolean(options.hasDriverHat);
  const hasHubManagerHat = Boolean(options.hasHubManagerHat);
  const hasMasterControlHat = Boolean(options.hasMasterControlHat);
  const hasAnyWorkspaceHat =
    hasOwnerHat ||
    hasStaffHat ||
    hasDriverHat ||
    hasHubManagerHat ||
    hasMasterControlHat;

  const [badges, setBadges] = useState<LiveNavBadges>(EMPTY_LIVE_NAV_BADGES);
  const debounceTimerRef = useRef<number | null>(null);
  const mountedRef = useRef<boolean>(true);

  const fetchAllCounts = useCallback(async () => {
    if (!userId || !isSupabaseConfigured()) {
      if (mountedRef.current) {
        setBadges(EMPTY_LIVE_NAV_BADGES);
      }
      return;
    }

    try {
      const [
        pickNDropActive,
        shopActive,
        restaurantActive,
        printActive,
        resourceBookingsActive,
        vehiclesActive,
        visitsActive,
        unreadNotifications,
        unreadMessages,
      ] = await Promise.all([
        safeCount(
          supabase
            .from('delivery_orders')
            .select('id', { count: 'exact', head: true })
            .eq('customer_id', userId)
            // v21a (P0-22): canonical delivery_orders.status lifecycle
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
        safeCount(
          supabase
            .from('notifications')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId)
            .eq('is_read', false)
        ),
        // v21a (P0-22): there is no `messages` table — direct messaging is not live yet
        Promise.resolve(0),
      ]);

      let ownerPending = 0;
      let staffPending = 0;
      let driverPending = 0;
      let hubManagerPending = 0;
      let masterControlPending = 0;

      if (hasAnyWorkspaceHat) {
        // Owner / Staff pending queues scoped via owned or assigned listing IDs
        let ownedIds: string[] = [];
        let staffIds: string[] = [];

        if (hasOwnerHat) {
          try {
            const { data } = await supabase
              .from('listings')
              .select('id')
              .eq('owner_id', userId)
              .limit(40);
            ownedIds = Array.isArray(data)
              ? data.map((r) => String((r as { id: string }).id))
              : [];
          } catch {
            ownedIds = [];
          }
        }

        if (hasStaffHat) {
          try {
            // v21a (P0-22): canonical delegation table is staff_delegations
            const { data } = await supabase
              .from('staff_delegations')
              .select('listing_id')
              .eq('staff_id', userId)
              .eq('status', 'active')
              .limit(40);
            staffIds = Array.isArray(data)
              ? data.map((r) => String((r as { listing_id: string }).listing_id))
              : [];
          } catch {
            staffIds = [];
          }
        }

        const countPendingForListings = async (ids: string[]) => {
          if (ids.length === 0) return 0;
          const [s, r, p, b, v] = await Promise.all([
            safeCount(
              supabase
                .from('shop_orders')
                .select('id', { count: 'exact', head: true })
                .in('listing_id', ids)
                .in('order_status', ['confirmed', 'packing', 'ready_for_pickup'])
            ),
            safeCount(
              supabase
                .from('restaurant_orders')
                .select('id', { count: 'exact', head: true })
                .in('listing_id', ids)
                .in('kitchen_status', ['new_order', 'preparing', 'ready_for_pickup'])
            ),
            safeCount(
              supabase
                .from('print_orders')
                .select('id', { count: 'exact', head: true })
                .in('listing_id', ids)
                .in('fulfillment_status', ['confirmed', 'printing', 'ready_for_pickup'])
            ),
            safeCount(
              supabase
                .from('resource_bookings')
                .select('id', { count: 'exact', head: true })
                .in('listing_id', ids)
                .in('booking_status', ['pending_payment', 'confirmed'])
            ),
            safeCount(
              supabase
                .from('property_visit_requests')
                .select('id', { count: 'exact', head: true })
                .in('listing_id', ids)
                .eq('status', 'requested')
            ),
          ]);
          return s + r + p + b + v;
        };

        const [ownerQ, staffQ, driverQ, moderationQ] = await Promise.all([
          hasOwnerHat ? countPendingForListings(ownedIds) : Promise.resolve(0),
          hasStaffHat ? countPendingForListings(staffIds) : Promise.resolve(0),
          hasDriverHat
            ? (async () => {
                try {
                  // v21a (P0-22): drivers is keyed by profile_id
                  const { data: drv } = await supabase
                    .from('drivers')
                    .select('id')
                    .eq('profile_id', userId)
                    .maybeSingle();
                  const drvId = (drv as { id?: string } | null)?.id;
                  if (!drvId) return 0;
                  return safeCount(
                    supabase
                      .from('delivery_orders')
                      .select('id', { count: 'exact', head: true })
                      .eq('driver_id', drvId)
                      .in('status', [
                        'driver_assigned',
                        'picked_up',
                        'in_transit',
                        'delivered_pending_confirm',
                        'return_in_transit',
                      ])
                  );
                } catch {
                  return 0;
                }
              })()
            : Promise.resolve(0),
          hasHubManagerHat || hasMasterControlHat
            ? (async () => {
                // v21a (P0-22): hub managers only count their own hubs' queues;
                // Master Control (super_admin) keeps the platform-wide view.
                let managedHubIds: string[] | null = null;
                if (!hasMasterControlHat) {
                  try {
                    const { data: hubRows } = await supabase
                      .from('hub_managers')
                      .select('hub_id')
                      .eq('profile_id', userId)
                      .eq('is_active', true);
                    managedHubIds = Array.isArray(hubRows)
                      ? hubRows
                          .map((r) => String((r as { hub_id?: string }).hub_id || ''))
                          .filter(Boolean)
                      : [];
                  } catch {
                    managedHubIds = [];
                  }
                  if (managedHubIds.length === 0) return 0;
                }
                let listingsQ = supabase
                  .from('listings')
                  .select('id', { count: 'exact', head: true })
                  .in('status', ['pending', 'pending_verification']);
                let civicQ = supabase
                  .from('civic_correction_reports')
                  .select('id', { count: 'exact', head: true })
                  .eq('status', 'pending');
                if (managedHubIds) {
                  listingsQ = listingsQ.in('hub_id', managedHubIds);
                  civicQ = civicQ.in('hub_id', managedHubIds);
                }
                const [lCount, cCount] = await Promise.all([
                  safeCount(listingsQ),
                  safeCount(civicQ),
                ]);
                return lCount + cCount;
              })()
            : Promise.resolve(0),
        ]);

        ownerPending = ownerQ;
        staffPending = staffQ;
        driverPending = driverQ;
        hubManagerPending = hasHubManagerHat ? moderationQ : 0;
        masterControlPending = hasMasterControlHat ? moderationQ : 0;
      }

      const commerceActive = shopActive + restaurantActive + printActive;
      const bookingsActive = resourceBookingsActive + vehiclesActive + visitsActive;
      const activityTotal = pickNDropActive + commerceActive + bookingsActive;
      const workspacePending =
        ownerPending +
        staffPending +
        driverPending +
        (hasMasterControlHat ? masterControlPending : hubManagerPending);

      if (mountedRef.current) {
        setBadges({
          pickNDropActive,
          commerceActive,
          bookingsActive,
          vehiclesActive,
          activityTotal,
          unreadNotifications,
          unreadMessages,
          workspacePending,
          workspaceHatCounts: {
            owner: ownerPending,
            staff: staffPending,
            driver: driverPending,
            hubManager: hubManagerPending,
            masterControl: masterControlPending,
          },
          isLoading: false,
        });
      }
    } catch {
      // Never break navigation chrome on transient errors
    }
  }, [
    userId,
    hasAnyWorkspaceHat,
    hasOwnerHat,
    hasStaffHat,
    hasDriverHat,
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
    }, 600);
  }, [fetchAllCounts]);

  useEffect(() => {
    mountedRef.current = true;
    if (!userId || !isSupabaseConfigured()) {
      queueMicrotask(() => {
        if (mountedRef.current) setBadges(EMPTY_LIVE_NAV_BADGES);
      });
      return () => {
        mountedRef.current = false;
      };
    }

    queueMicrotask(() => {
      void fetchAllCounts();
    });

    const handleNotificationSync = () => scheduleRefresh();
    window.addEventListener('printswift:notifications-updated', handleNotificationSync);

    let channel: ReturnType<typeof supabase.channel> | null = null;
    try {
      const chName = `live-nav-badges-${userId}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 6)}`;
      channel = supabase
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
          {
            event: '*',
            schema: 'public',
            table: 'delivery_orders',
            filter: `customer_id=eq.${userId}`,
          },
          scheduleRefresh
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'shop_orders',
            filter: `customer_id=eq.${userId}`,
          },
          scheduleRefresh
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'restaurant_orders',
            filter: `customer_id=eq.${userId}`,
          },
          scheduleRefresh
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'print_orders',
            filter: `customer_id=eq.${userId}`,
          },
          scheduleRefresh
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'resource_bookings',
            filter: `customer_id=eq.${userId}`,
          },
          scheduleRefresh
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'vehicle_bookings',
            filter: `customer_id=eq.${userId}`,
          },
          scheduleRefresh
        )
        .subscribe();
    } catch {
      channel = null;
    }

    return () => {
      mountedRef.current = false;
      window.removeEventListener('printswift:notifications-updated', handleNotificationSync);
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
  }, [userId, fetchAllCounts, scheduleRefresh]);

  return badges;
}
