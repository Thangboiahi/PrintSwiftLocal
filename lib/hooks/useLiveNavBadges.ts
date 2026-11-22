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
            .in('status', [
              'pending',
              'searching',
              'assigned',
              'accepted',
              'picked_up',
              'in_transit',
              'en_route_pickup',
              'en_route_dropoff',
            ])
        ),
        safeCount(
          supabase
            .from('shop_orders')
            .select('id', { count: 'exact', head: true })
            .eq('customer_id', userId)
            .not('status', 'in', '(completed,delivered,collected,cancelled,rejected,refunded)')
        ),
        safeCount(
          supabase
            .from('restaurant_orders')
            .select('id', { count: 'exact', head: true })
            .eq('customer_id', userId)
            .not('status', 'in', '(completed,delivered,collected,cancelled,rejected,refunded)')
        ),
        safeCount(
          supabase
            .from('print_orders')
            .select('id', { count: 'exact', head: true })
            .eq('customer_id', userId)
            .not('status', 'in', '(completed,delivered,collected,cancelled,rejected,refunded)')
        ),
        safeCount(
          supabase
            .from('resource_bookings')
            .select('id', { count: 'exact', head: true })
            .eq('customer_id', userId)
            .not('status', 'in', '(completed,cancelled,rejected,no_show,expired)')
        ),
        safeCount(
          supabase
            .from('vehicle_bookings')
            .select('id', { count: 'exact', head: true })
            .eq('customer_id', userId)
            .not('status', 'in', '(completed,cancelled,rejected,expired)')
        ),
        safeCount(
          supabase
            .from('property_visit_requests')
            .select('id', { count: 'exact', head: true })
            .eq('requester_id', userId)
            .in('status', ['requested', 'confirmed'])
        ),
        safeCount(
          supabase
            .from('notifications')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', userId)
            .eq('is_read', false)
        ),
        safeCount(
          supabase
            .from('messages')
            .select('id', { count: 'exact', head: true })
            .eq('receiver_id', userId)
            .eq('is_read', false)
        ),
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
            const { data } = await supabase
              .from('listing_staff_assignments')
              .select('listing_id')
              .eq('staff_user_id', userId)
              .eq('is_active', true)
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
                .in('status', ['placed', 'pending', 'confirmed', 'packing', 'ready'])
            ),
            safeCount(
              supabase
                .from('restaurant_orders')
                .select('id', { count: 'exact', head: true })
                .in('listing_id', ids)
                .in('status', ['placed', 'pending', 'accepted', 'preparing', 'ready'])
            ),
            safeCount(
              supabase
                .from('print_orders')
                .select('id', { count: 'exact', head: true })
                .in('listing_id', ids)
                .in('status', ['pending', 'awaiting_quote', 'quoted', 'printing', 'ready'])
            ),
            safeCount(
              supabase
                .from('resource_bookings')
                .select('id', { count: 'exact', head: true })
                .in('listing_id', ids)
                .in('status', ['pending', 'pending_confirmation', 'confirmed'])
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
                  const { data: drv } = await supabase
                    .from('drivers')
                    .select('id')
                    .eq('user_id', userId)
                    .maybeSingle();
                  const drvId = (drv as { id?: string } | null)?.id;
                  if (!drvId) return 0;
                  return safeCount(
                    supabase
                      .from('delivery_orders')
                      .select('id', { count: 'exact', head: true })
                      .eq('driver_id', drvId)
                      .in('status', ['assigned', 'accepted', 'picked_up', 'in_transit'])
                  );
                } catch {
                  return 0;
                }
              })()
            : Promise.resolve(0),
          hasHubManagerHat || hasMasterControlHat
            ? Promise.all([
                safeCount(
                  supabase
                    .from('listings')
                    .select('id', { count: 'exact', head: true })
                    .eq('status', 'pending')
                ),
                safeCount(
                  supabase
                    .from('civic_correction_reports')
                    .select('id', { count: 'exact', head: true })
                    .eq('status', 'open')
                ),
              ]).then(([lCount, cCount]) => lCount + cCount)
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
