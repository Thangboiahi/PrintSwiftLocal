'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Activity,
  ArrowRight,
  BadgeCheck,
  Bookmark,
  Briefcase,
  CalendarDays,
  ChevronDown,
  ChevronRight,
  Crown,
  Edit3,
  ExternalLink,
  LogOut,
  Mail,
  MapPin,
  Megaphone,
  Phone,
  Printer,
  Receipt,
  Settings,
  Shield,
  ShoppingBag,
  Ticket,
  Truck,
} from 'lucide-react';
import {
  OPTIMISTIC_PROFILE_STORAGE_KEY,
  OptimisticProfilePayload,
  SocialPlatformIcon,
  resolveSocialLinkHref,
} from '@/components/navigation/Header';
import { ProtectedRoute } from '@/components/shared/ProtectedRoute';
import ProfileLoading from './loading';
import {
  AppProvider,
  getEffectiveRoleWithOverride,
  getViewAsRoleCookie,
  useAppStore,
  useAuth,
} from '@/lib/store';
import { RoleToggleModal } from '@/components/profile/RoleToggleModal';
import { useHub } from '@/components/providers/AppConfigProvider';
import { useSavedInterests } from '@/lib/hooks/useSavedInterests';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { resolveInitialRole } from '@/lib/validators';

function formatRoleLabel(rawRole: string): string {
  const normalized = rawRole.trim().toLowerCase();
  switch (normalized) {
    case 'visitor':
    case 'user':
      return 'Visitor';
    case 'driver':
      return 'Driver';
    case 'owner':
    case 'business_owner':
      return 'Owner';
    case 'staff':
    case 'agent':
      return 'Staff';
    case 'hub_manager':
      return 'Hub Manager';
    case 'admin':
      return 'Admin';
    case 'super_admin':
      return 'Super Admin';
    default:
      return (
        normalized
          .split(/[_-]+/)
          .filter(Boolean)
          .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
          .join(' ') || 'Visitor'
      );
  }
}

function getRolePillStyle(rawRole: string): string {
  switch (rawRole.trim().toLowerCase()) {
    case 'super_admin':
      return 'border-purple-500/35 bg-purple-500/12 text-purple-700 dark:text-purple-300';
    case 'admin':
      return 'border-indigo-500/35 bg-indigo-500/12 text-indigo-700 dark:text-indigo-300';
    case 'hub_manager':
      return 'border-emerald-500/35 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300';
    case 'owner':
      return 'border-sky-500/35 bg-sky-500/12 text-sky-700 dark:text-sky-300';
    case 'staff':
      return 'border-teal-500/35 bg-teal-500/12 text-teal-700 dark:text-teal-300';
    case 'driver':
      return 'border-amber-500/35 bg-amber-500/12 text-amber-700 dark:text-amber-300';
    default:
      return 'border-slate-400/35 bg-slate-500/10 text-slate-700 dark:text-slate-300';
  }
}

interface ProfileLiveHubStats {
  driverKycVerified: boolean;
  hasDriverRecord: boolean;
  activeSubPlanName: string | null;
  activeSubExpiresAt: string | null;
  availablePostPasses: number;
  activeTripsCount: number;
  activeResourceBookingsCount: number;
  activeCommerceCount: number;
  activePrintOrdersCount: number;
  paymentReceiptsCount: number;
  workspacePendingCount: number;
  workspacePendingLabel: string;
}

function ProfileContent() {
  const router = useRouter();
  const { currentUser, savedListingIds } = useAppStore();
  const { savedItems } = useSavedInterests();
  const { hubs, activeHub } = useHub();
  const {
    user: authUser,
    role: syncedAuthRole,
    actual_role: authActualRole,
    defaultHubId: authDefaultHubId,
    signOut,
    avatarUrl: authAvatarUrl,
  } = useAuth();
  const [profileDefaultHubId, setProfileDefaultHubId] = useState<string | null>(
    authDefaultHubId || null
  );

  const [isLoadingProfile, setIsLoadingProfile] = useState(true);
  const initialEmailRole = authUser?.email
    ? resolveInitialRole(authUser.email)
    : 'visitor';
  const [realRole, setRealRole] = useState<string>(
    authActualRole ||
      (initialEmailRole === 'super_admin' ? 'super_admin' : 'visitor')
  );
  const [viewAsRole] = useState<string>(() => {
    return getViewAsRoleCookie() || 'actual';
  });
  const [isRoleModalOpen, setIsRoleModalOpen] = useState(false);

  const [profileState, setProfileState] = useState<{
    fullName: string;
    username: string;
    email: string;
    phone: string;
    bio: string;
    role: string;
    actual_role: string;
    avatarUrl: string;
    socialLinks: Record<string, string>;
  }>({
    fullName:
      (authUser?.user_metadata?.full_name as string | undefined) ||
      authUser?.email?.split('@')[0] ||
      currentUser.name ||
      'User',
    username:
      (authUser?.user_metadata?.username as string | undefined) ||
      authUser?.email?.split('@')[0]?.toLowerCase() ||
      'user',
    email: authUser?.email || '',
    phone: (authUser?.user_metadata?.phone as string | undefined) || '',
    bio: '',
    role:
      syncedAuthRole ||
      currentUser.adminRole ||
      currentUser.roleType ||
      'visitor',
    actual_role:
      authActualRole ||
      (initialEmailRole === 'super_admin' ? 'super_admin' : '') ||
      currentUser.adminRole ||
      currentUser.roleType ||
      'visitor',
    avatarUrl: authAvatarUrl || '',
    socialLinks: {},
  });

  const [hubStats, setHubStats] = useState<ProfileLiveHubStats>({
    driverKycVerified: false,
    hasDriverRecord: false,
    activeSubPlanName: null,
    activeSubExpiresAt: null,
    availablePostPasses: 0,
    activeTripsCount: 0,
    activeResourceBookingsCount: 0,
    activeCommerceCount: 0,
    activePrintOrdersCount: 0,
    paymentReceiptsCount: 0,
    workspacePendingCount: 0,
    workspacePendingLabel: '',
  });
  const [isLedgerExpanded, setIsLedgerExpanded] = useState(false);

  useEffect(() => {
    let active = true;

    async function loadUserProfile() {
      const defaultName =
        (authUser?.user_metadata?.full_name as string | undefined) ||
        authUser?.email?.split('@')[0] ||
        currentUser.name ||
        'User';
      const defaultUsername =
        (authUser?.user_metadata?.username as string | undefined) ||
        authUser?.email?.split('@')[0]?.toLowerCase() ||
        'user';
      const defaultRole =
        syncedAuthRole ||
        currentUser.adminRole ||
        currentUser.roleType ||
        'visitor';

      let cachedOptimistic: Partial<OptimisticProfilePayload> | null = null;
      if (typeof window !== 'undefined') {
        try {
          const rawCached = localStorage.getItem(
            OPTIMISTIC_PROFILE_STORAGE_KEY
          );
          if (rawCached) {
            cachedOptimistic = JSON.parse(
              rawCached
            ) as Partial<OptimisticProfilePayload>;
          }
        } catch {
          // ignore storage errors
        }
      }

      if (!isSupabaseConfigured()) {
        if (active) {
          const fallbackActualRole = (
            cachedOptimistic?.role ||
            authActualRole ||
            (initialEmailRole === 'super_admin' ? 'super_admin' : '') ||
            defaultRole
          )
            .trim()
            .toLowerCase();
          setRealRole(fallbackActualRole);
          setProfileState((prev) => ({
            ...prev,
            fullName: cachedOptimistic?.fullName || defaultName,
            username: defaultUsername,
            email: authUser?.email || prev.email,
            actual_role: fallbackActualRole,
            role: getEffectiveRoleWithOverride(fallbackActualRole),
            avatarUrl: cachedOptimistic?.avatarUrl || prev.avatarUrl || '',
            socialLinks:
              cachedOptimistic?.socialLinks &&
              Object.keys(cachedOptimistic.socialLinks).length > 0
                ? cachedOptimistic.socialLinks
                : prev.socialLinks,
          }));
          setIsLoadingProfile(false);
        }
        return;
      }

      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const sessionUser = sessionData?.session?.user;
        const targetId = sessionUser?.id || authUser?.id;

        if (!targetId) {
          router.replace('/login');
          return;
        }

        const { data } = await supabase
          .from('profiles')
          .select('*')
          .eq('id', targetId)
          .maybeSingle();

        let effectiveLoadedRole = getEffectiveRoleWithOverride(
          (
            (initialEmailRole === 'super_admin' ? 'super_admin' : '') ||
            authActualRole ||
            defaultRole
          )
            .trim()
            .toLowerCase()
        );

        if (active && data) {
          const row = data as Record<string, unknown>;
          const parsedSocials: Record<string, string> = {};
          if (
            row.social_links &&
            typeof row.social_links === 'object' &&
            !Array.isArray(row.social_links)
          ) {
            for (const [k, v] of Object.entries(
              row.social_links as Record<string, unknown>
            )) {
              if (typeof v === 'string' && v.trim()) {
                parsedSocials[k] = v.trim();
              }
            }
          } else if (Array.isArray(row.social_links)) {
            for (const item of row.social_links) {
              if (item && typeof item === 'object') {
                const p = String(
                  (item as { platform?: unknown }).platform || ''
                );
                const u = String((item as { url?: unknown }).url || '');
                if (p && u) parsedSocials[p] = u;
              }
            }
          }

          const sessionMeta = sessionUser?.user_metadata as
            | Record<string, unknown>
            | undefined;

          const safeCachedSocials =
            cachedOptimistic?.socialLinks &&
            typeof cachedOptimistic.socialLinks === 'object' &&
            !Array.isArray(cachedOptimistic.socialLinks) &&
            Object.keys(cachedOptimistic.socialLinks).length > 0
              ? cachedOptimistic.socialLinks
              : null;

          const resolvedUsername = String(
            row.username ||
              sessionMeta?.username ||
              (sessionUser?.email ? sessionUser.email.split('@')[0] : '') ||
              defaultUsername
          )
            .replace(/^@+/, '')
            .toLowerCase();

          const rawDbRole = String(
            (initialEmailRole === 'super_admin' ? 'super_admin' : '') ||
              row.admin_role ||
              row.role ||
              row.role_type ||
              initialEmailRole ||
              'visitor'
          ).toLowerCase();
          setRealRole(rawDbRole);
          effectiveLoadedRole = getEffectiveRoleWithOverride(rawDbRole);
          if (typeof row.default_hub_id === 'string' && row.default_hub_id) {
            setProfileDefaultHubId(row.default_hub_id);
          }

          setProfileState({
            fullName: String(
              cachedOptimistic?.fullName ||
                row.full_name ||
                row.name ||
                sessionMeta?.full_name ||
                defaultName
            ),
            username: resolvedUsername || 'user',
            email: String(row.email || sessionUser?.email || ''),
            phone: String(
              row.phone || sessionMeta?.phone || sessionUser?.phone || ''
            ),
            bio:
              typeof row.bio === 'string' && row.bio.trim()
                ? row.bio.trim()
                : '',
            actual_role: rawDbRole,
            role: effectiveLoadedRole,
            avatarUrl: String(
              row.avatar_url ||
                cachedOptimistic?.avatarUrl ||
                authAvatarUrl ||
                sessionMeta?.avatar_url ||
                ''
            ),
            socialLinks: safeCachedSocials
              ? safeCachedSocials
              : Object.keys(parsedSocials).length > 0
                ? parsedSocials
                : {},
          });
        } else if (active) {
          const sessionMeta = sessionUser?.user_metadata as
            | Record<string, unknown>
            | undefined;
          const fallbackActualRole = (
            (initialEmailRole === 'super_admin' ? 'super_admin' : '') ||
            authActualRole ||
            defaultRole
          )
            .trim()
            .toLowerCase();
          setRealRole(fallbackActualRole);
          effectiveLoadedRole = getEffectiveRoleWithOverride(fallbackActualRole);
          setProfileState((prev) => ({
            ...prev,
            fullName:
              cachedOptimistic?.fullName ||
              (sessionMeta?.full_name as string | undefined) ||
              defaultName,
            username: String(
              sessionMeta?.username ||
                (sessionUser?.email ? sessionUser.email.split('@')[0] : '') ||
                defaultUsername
            )
              .replace(/^@+/, '')
              .toLowerCase(),
            email: sessionUser?.email || prev.email,
            phone: String(sessionMeta?.phone || sessionUser?.phone || prev.phone),
            actual_role: fallbackActualRole,
            role: effectiveLoadedRole,
            avatarUrl:
              cachedOptimistic?.avatarUrl ||
              (sessionMeta?.avatar_url as string | undefined) ||
              '',
            socialLinks:
              cachedOptimistic?.socialLinks &&
              typeof cachedOptimistic.socialLinks === 'object' &&
              !Array.isArray(cachedOptimistic.socialLinks)
                ? cachedOptimistic.socialLinks
                : prev.socialLinks,
          }));
        }

        // Load Hub Stats (Subscriptions, Passes, Trips, Receipts, Role Pending Actions)
        const nowIso = new Date().toISOString();
        const roleLower = effectiveLoadedRole.toLowerCase();

        const [
          subRes,
          passesRes,
          activeOrdersRes,
          activeVBookingsRes,
          activeResourceBookingsRes,
          activePrintOrdersRes,
          activeShopOrdersRes,
          activeFoodOrdersRes,
          activeTableReservationsRes,
          receiptsRes,
          driverRes,
        ] = await Promise.all([
          supabase
            .from('user_subscriptions')
            .select('expires_at, status, subscription_plans(name, slug)')
            .eq('user_id', targetId)
            .eq('status', 'active')
            .gte('expires_at', nowIso)
            .order('expires_at', { ascending: false })
            .limit(1)
            .maybeSingle(),
          supabase
            .from('bulletin_post_passes')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', targetId)
            .eq('status', 'available'),
          supabase
            .from('delivery_orders')
            .select('id', { count: 'exact', head: true })
            .eq('customer_id', targetId)
            .not('status', 'in', '(completed,cancelled)'),
          supabase
            .from('vehicle_bookings')
            .select('id', { count: 'exact', head: true })
            .eq('customer_id', targetId)
            .in('status', [
              'soft_hold',
              'pending_payment_confirm',
              'confirmed',
              'in_progress',
            ]),
          supabase
            .from('resource_bookings')
            .select('id', { count: 'exact', head: true })
            .eq('customer_id', targetId)
            .in('booking_status', [
              'pending_payment',
              'confirmed',
              'checked_in',
            ]),
          supabase
            .from('print_orders')
            .select('id', { count: 'exact', head: true })
            .eq('customer_id', targetId)
            .not('fulfillment_status', 'in', '(collected,cancelled)'),
          supabase
            .from('shop_orders')
            .select('id', { count: 'exact', head: true })
            .eq('customer_id', targetId)
            .not('order_status', 'in', '(completed,cancelled)'),
          supabase
            .from('restaurant_orders')
            .select('id', { count: 'exact', head: true })
            .eq('customer_id', targetId)
            .not('kitchen_status', 'in', '(completed,rejected,cancelled)'),
          supabase
            .from('restaurant_table_reservations')
            .select('id', { count: 'exact', head: true })
            .eq('customer_id', targetId)
            .in('status', ['requested', 'confirmed', 'seated']),
          supabase
            .from('payment_intents')
            .select('id', { count: 'exact', head: true })
            .eq('user_id', targetId),
          roleLower === 'driver'
            ? supabase
                .from('drivers')
                .select('id, kyc_verified')
                .eq('profile_id', targetId)
                .order('created_at', { ascending: false })
                .limit(1)
                .maybeSingle()
            : Promise.resolve({ data: null }),
        ]);

        let workspacePendingCount = 0;
        let workspacePendingLabel = '';

        if (roleLower === 'super_admin') {
          const { count } = await supabase
            .from('payment_intents')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'pending_manual');
          workspacePendingCount = count ?? 0;
          workspacePendingLabel =
            workspacePendingCount > 0
              ? `${workspacePendingCount} pending payment${workspacePendingCount === 1 ? '' : 's'}`
              : 'All payments verified';
        } else if (roleLower === 'admin') {
          const { count } = await supabase
            .from('listings')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'pending');
          workspacePendingCount = count ?? 0;
          workspacePendingLabel =
            workspacePendingCount > 0
              ? `${workspacePendingCount} pending review`
              : 'Queue clear';
        } else if (roleLower === 'driver' && driverRes.data) {
          const drv = driverRes.data as { id: string; kyc_verified?: boolean };
          const [drvOrdersRes, drvVehsRes] = await Promise.all([
            supabase
              .from('delivery_orders')
              .select('id', { count: 'exact', head: true })
              .eq('driver_id', drv.id)
              .in('status', [
                'driver_assigned',
                'picked_up',
                'in_transit',
                'return_in_transit',
              ]),
            supabase
              .from('vehicle_listings')
              .select('id')
              .or(`driver_id.eq.${drv.id},owner_id.eq.${targetId}`),
          ]);
          const vIds = ((drvVehsRes.data || []) as Array<{ id: string }>).map(
            (v) => v.id
          );
          let scheduledCount = 0;
          if (vIds.length > 0) {
            const { count } = await supabase
              .from('vehicle_bookings')
              .select('id', { count: 'exact', head: true })
              .in('vehicle_listing_id', vIds)
              .in('status', ['confirmed', 'in_progress']);
            scheduledCount = count ?? 0;
          }
          workspacePendingCount = (drvOrdersRes.count ?? 0) + scheduledCount;
          workspacePendingLabel =
            workspacePendingCount > 0
              ? `${workspacePendingCount} active trip${workspacePendingCount === 1 ? '' : 's'}`
              : 'Ready for dispatch';
        } else if (roleLower === 'owner' || roleLower === 'staff') {
          const { count } = await supabase
            .from('enquiries')
            .select('id', { count: 'exact', head: true })
            .eq('status', 'new');
          workspacePendingCount = count ?? 0;
          workspacePendingLabel =
            workspacePendingCount > 0
              ? `${workspacePendingCount} new enquir${workspacePendingCount === 1 ? 'y' : 'ies'}`
              : 'Listings active';
        }

        if (active) {
          const subData = subRes.data as {
            expires_at?: string | null;
            subscription_plans?:
              | { name?: string }
              | Array<{ name?: string }>
              | null;
          } | null;
          const planObj = subData?.subscription_plans
            ? Array.isArray(subData.subscription_plans)
              ? subData.subscription_plans[0]
              : subData.subscription_plans
            : null;
          const driverRow = driverRes.data as {
            id?: string;
            kyc_verified?: boolean;
          } | null;

          setHubStats({
            driverKycVerified: Boolean(driverRow?.kyc_verified),
            hasDriverRecord: Boolean(driverRow?.id),
            activeSubPlanName: planObj?.name || null,
            activeSubExpiresAt: subData?.expires_at || null,
            availablePostPasses: passesRes.count ?? 0,
            activeTripsCount:
              (activeOrdersRes.count ?? 0) + (activeVBookingsRes.count ?? 0),
            activeResourceBookingsCount: activeResourceBookingsRes.count ?? 0,
            activeCommerceCount:
              (activeShopOrdersRes.count ?? 0) +
              (activeFoodOrdersRes.count ?? 0) +
              (activeTableReservationsRes.count ?? 0),
            activePrintOrdersCount: activePrintOrdersRes.count ?? 0,
            paymentReceiptsCount: receiptsRes.count ?? 0,
            workspacePendingCount,
            workspacePendingLabel,
          });
        }
      } catch {
        // Keep fallback values cleanly
      } finally {
        if (active) setIsLoadingProfile(false);
      }
    }

    void loadUserProfile();

    return () => {
      active = false;
    };
  }, [
    authUser,
    authActualRole,
    initialEmailRole,
    syncedAuthRole,
    authAvatarUrl,
    currentUser.name,
    currentUser.roleType,
    currentUser.adminRole,
    router,
  ]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleProfileUpdated = (ev: Event) => {
      const detail = (ev as CustomEvent<OptimisticProfilePayload>).detail;
      if (!detail) return;
      setProfileState((prev) => ({
        ...prev,
        fullName: detail.fullName || prev.fullName,
        avatarUrl: detail.avatarUrl ?? prev.avatarUrl,
        socialLinks: detail.socialLinks || prev.socialLinks,
      }));
    };
    window.addEventListener('printswift:profile-updated', handleProfileUpdated);
    return () => {
      window.removeEventListener(
        'printswift:profile-updated',
        handleProfileUpdated
      );
    };
  }, []);

  const handleSignOut = async () => {
    try {
      if (isSupabaseConfigured()) {
        await supabase.auth.signOut();
      }
      await signOut();
    } finally {
      router.push('/');
    }
  };

  const normalizedRealRole = (
    profileState.actual_role && profileState.actual_role !== 'visitor'
      ? profileState.actual_role
      : realRole && realRole !== 'visitor'
        ? realRole
        : authActualRole ||
          (initialEmailRole === 'super_admin' ? 'super_admin' : '') ||
          realRole ||
          'visitor'
  )
    .trim()
    .toLowerCase();

  const profile = {
    ...profileState,
    actual_role: normalizedRealRole,
  };

  const normalizedRole = profile.role.trim().toLowerCase();
  const isDriverRole = normalizedRole === 'driver';
  const hasWorkspaceAccess =
    isDriverRole ||
    normalizedRole === 'owner' ||
    normalizedRole === 'staff' ||
    normalizedRole === 'hub_manager' ||
    normalizedRole === 'admin' ||
    normalizedRole === 'super_admin';

  const workspaceHref = isDriverRole ? '/driver' : '/workspace';
  const workspaceTitle = isDriverRole
    ? 'Driver & Fleet Workspace'
    : normalizedRole === 'super_admin'
      ? 'Super-Admin Command & Master Control'
      : normalizedRole === 'hub_manager'
        ? `Hub Manager Operations (${activeHub.name})`
        : normalizedRole === 'admin'
          ? 'Admin Moderation & Operations Workspace'
          : normalizedRole === 'owner'
            ? 'Business Owner Workspace'
            : 'Staff Operations Workspace';

  const homeHubRecord = useMemo(() => {
    const candidateId = profileDefaultHubId || authDefaultHubId;
    if (candidateId) {
      const matched = hubs.find((h) => h.id === candidateId);
      if (matched) return matched;
    }
    return activeHub;
  }, [profileDefaultHubId, authDefaultHubId, hubs, activeHub]);

  const totalSavedCount = useMemo(() => {
    const uniqueIds = new Set<string>(
      savedItems.map((s) => `${s.item_type}:${s.item_id}`)
    );
    for (const id of savedListingIds) {
      if (id) uniqueIds.add(`listing:${id}`);
    }
    return uniqueIds.size;
  }, [savedItems, savedListingIds]);

  const socialEntries =
    profileState.socialLinks && typeof profileState.socialLinks === 'object'
      ? Object.entries(profileState.socialLinks).filter(
          ([, val]) => typeof val === 'string' && val.trim().length > 0
        )
      : [];

  return (
    <div
      data-testid="user-profile-page"
      className="w-full max-w-4xl mx-auto px-4 sm:px-6 pt-5 pb-20 lg:pb-10 bg-[var(--ps-bg)] text-[var(--ps-text)] space-y-5"
    >
      {isLoadingProfile ? (
        <ProfileLoading />
      ) : (
        <>
          {/* 1. Identity & Role Header */}
          <section
            data-testid="profile-account-summary-card"
            className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5 shadow-xs"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-4 min-w-0">
                {profileState.avatarUrl?.trim() ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={profileState.avatarUrl.trim()}
                    alt="Profile"
                    referrerPolicy="no-referrer"
                    className="h-16 w-16 sm:h-20 sm:w-20 shrink-0 rounded-full object-cover border border-[var(--ps-border)] shadow-xs"
                  />
                ) : (
                  <div className="flex h-16 w-16 sm:h-20 sm:w-20 shrink-0 items-center justify-center rounded-full bg-[var(--ps-accent)]/15 text-[var(--ps-accent)] text-2xl font-extrabold uppercase">
                    {profileState.fullName?.charAt(0) || 'U'}
                  </div>
                )}

                <div className="min-w-0 space-y-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <h1
                      data-testid="profile-display-name"
                      className="text-lg sm:text-xl font-bold tracking-tight text-[var(--ps-text)] truncate"
                    >
                      {profileState.fullName}
                    </h1>
                    <span
                      data-testid="profile-active-role-badge"
                      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${getRolePillStyle(
                        profileState.role
                      )}`}
                    >
                      {formatRoleLabel(profileState.role)}
                    </span>
                    <Link
                      href="/settings"
                      data-testid="profile-home-hub-badge"
                      title="Change Default Home Hub in Settings"
                      className="inline-flex items-center gap-1 rounded-md border border-theme-primary/35 bg-theme-primary/10 px-2 py-0.5 text-[10px] font-bold text-theme-primary hover:bg-theme-primary/15 transition-colors"
                    >
                      <MapPin className="h-2.5 w-2.5 shrink-0" />
                      <span>Home Hub: {homeHubRecord.name}</span>
                    </Link>
                    {isDriverRole && hubStats.hasDriverRecord && (
                      <span
                        data-testid="profile-driver-kyc-badge"
                        className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] font-bold ${
                          hubStats.driverKycVerified
                            ? 'border-emerald-500/35 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                            : 'border-amber-500/35 bg-amber-500/12 text-amber-700 dark:text-amber-300'
                        }`}
                      >
                        <BadgeCheck className="h-3 w-3" />
                        <span>
                          {hubStats.driverKycVerified
                            ? 'KYC Verified'
                            : 'KYC Pending'}
                        </span>
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-[var(--ps-text-muted)]">
                    <span className="font-medium">
                      @{profileState.username.replace(/^@+/, '')}
                    </span>
                    {profileState.email && (
                      <span className="inline-flex items-center gap-1 truncate">
                        <Mail className="h-3 w-3 shrink-0" />
                        <span className="truncate">{profileState.email}</span>
                      </span>
                    )}
                    {profileState.phone && (
                      <span className="inline-flex items-center gap-1 font-mono">
                        <Phone className="h-3 w-3 shrink-0" />
                        <span>{profileState.phone}</span>
                      </span>
                    )}
                  </div>

                  {profileState.bio && (
                    <p className="text-xs leading-relaxed text-[var(--ps-text-muted)] line-clamp-2 pt-0.5">
                      {profileState.bio}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 shrink-0">
                <Link
                  href="/profile/edit"
                  data-testid="profile-hub-edit-link"
                  className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors"
                >
                  <Edit3 className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
                  <span>Edit Profile</span>
                </Link>
                {['super_admin', 'admin', 'owner'].includes(
                  profile.actual_role
                ) && (
                  <button
                    type="button"
                    data-testid="open-role-toggle-modal-btn"
                    onClick={() => setIsRoleModalOpen(true)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-purple-500/35 bg-purple-500/10 px-3 text-xs font-bold text-purple-700 dark:text-purple-300 hover:bg-purple-500/20 transition-colors cursor-pointer"
                  >
                    <Shield className="h-3.5 w-3.5" />
                    <span>
                      {viewAsRole === 'actual'
                        ? 'Switch Role'
                        : `Viewing: ${formatRoleLabel(viewAsRole)}`}
                    </span>
                    <ChevronRight className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>

            {socialEntries.length > 0 && (
              <div
                data-testid="profile-social-links-bar"
                className="mt-4 flex flex-wrap items-center gap-2 border-t border-[var(--ps-border)] pt-3"
              >
                {socialEntries.map(([platform, rawVal]) => (
                  <a
                    key={platform}
                    href={resolveSocialLinkHref(platform, rawVal)}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={platform}
                    aria-label={platform}
                    className="inline-flex h-7 items-center gap-1.5 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-[11px] font-medium text-[var(--ps-text)] hover:border-[var(--ps-accent)] transition-colors"
                  >
                    <SocialPlatformIcon
                      platform={platform}
                      className="h-3 w-3 text-[var(--ps-accent)]"
                    />
                    <span>{platform}</span>
                    <ExternalLink className="h-2.5 w-2.5 opacity-60" />
                  </a>
                ))}
              </div>
            )}

            <RoleToggleModal
              open={isRoleModalOpen}
              onClose={() => setIsRoleModalOpen(false)}
              currentViewAsRole={viewAsRole}
              realRole={normalizedRealRole}
            />
          </section>

          {/* 2. Quick Workspace Launcher Card */}
          {hasWorkspaceAccess && (
            <Link
              href={workspaceHref}
              data-testid="profile-hub-workspace-link"
              className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-[var(--ps-accent)]/40 bg-[var(--ps-accent)]/8 p-4 hover:bg-[var(--ps-accent)]/12 transition-colors"
            >
              <div className="flex items-center gap-3.5 min-w-0">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-xs">
                  {isDriverRole ? (
                    <Truck className="h-5 w-5" />
                  ) : (
                    <Briefcase className="h-5 w-5" />
                  )}
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-bold text-[var(--ps-text)]">
                      {workspaceTitle}
                    </h2>
                    {hubStats.workspacePendingLabel && (
                      <span
                        className={`rounded-md px-2 py-0.5 text-[10px] font-bold tabular-nums ${
                          hubStats.workspacePendingCount > 0
                            ? 'bg-amber-500/20 text-amber-800 dark:text-amber-300'
                            : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                        }`}
                      >
                        {hubStats.workspacePendingLabel}
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-[var(--ps-text-muted)] truncate">
                    {isDriverRole
                      ? 'Manage Pick N Drop dispatches, Scheduled Vehicle Bookings, GPS shift & OTPs'
                      : `Open ${formatRoleLabel(profileState.role)} tools, queues, and live operations`}
                  </p>
                </div>
              </div>
              <span className="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3.5 text-xs font-bold text-[var(--ps-accent-fg)]">
                <span>Launch Workspace</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </span>
            </Link>
          )}

          {/* 3. Bulletin Wallet & Subscription Card */}
          <section
            data-testid="profile-bulletin-wallet-card"
            className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <Megaphone className="h-4 w-4 text-[var(--ps-accent)]" />
                <h2 className="text-sm font-bold text-[var(--ps-text)]">
                  Bulletin Wallet &amp; Subscription
                </h2>
              </div>
              <Link
                href="/bulletin"
                className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3 text-xs font-semibold text-[var(--ps-accent-fg)] hover:opacity-95"
              >
                <span>Post Bulletin / Plans</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </Link>
            </div>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 py-2.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                  Active Subscription Plan
                </p>
                <p className="mt-1 flex items-center gap-1.5 text-xs font-bold text-[var(--ps-text)]">
                  <Crown className="h-3.5 w-3.5 text-amber-500 shrink-0" />
                  <span>
                    {hubStats.activeSubPlanName || 'No Active Monthly Plan'}
                  </span>
                </p>
                <p className="mt-0.5 font-mono text-[11px] tabular-nums text-[var(--ps-text-muted)]">
                  {hubStats.activeSubExpiresAt
                    ? `Expires ${new Date(
                        hubStats.activeSubExpiresAt
                      ).toLocaleString('en-IN', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}`
                    : 'Subscribe or purchase a Single Post Pass on /bulletin'}
                </p>
              </div>

              <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 py-2.5">
                <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                  Single Bulletin Post Passes
                </p>
                <p className="mt-1 flex items-center gap-1.5 text-xs font-bold text-[var(--ps-text)] tabular-nums">
                  <Ticket className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                  <span>
                    {hubStats.availablePostPasses} pass
                    {hubStats.availablePostPasses === 1 ? '' : 'es'} available
                  </span>
                </p>
                <p className="mt-0.5 text-[11px] text-[var(--ps-text-muted)]">
                  One-time passes ready to publish announcements without a monthly plan.
                </p>
              </div>
            </div>
          </section>

          {/* 4. Collapsible "My Activity & Ledger" Card */}
          <section className="space-y-3">
            <div
              data-testid="profile-activity-ledger-card"
              className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] overflow-hidden transition-all shadow-xs"
            >
              {/* Main Row */}
              <div className="flex items-center justify-between gap-3 p-4">
                <Link
                  href="/activity"
                  data-testid="profile-hub-activities-link"
                  className="flex items-center gap-3 min-w-0 flex-1 group"
                >
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-theme-primary/10 text-theme-primary">
                    <Activity className="h-5 w-5" />
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="text-sm font-bold text-[var(--ps-text)] group-hover:text-theme-primary transition-colors">
                        My Activity &amp; Ledger
                      </p>
                      <span className="font-mono text-xs font-extrabold px-2 py-0.5 rounded-full bg-theme-primary/10 text-theme-primary tabular-nums">
                        {totalSavedCount +
                          hubStats.activeTripsCount +
                          hubStats.activeResourceBookingsCount +
                          hubStats.activeCommerceCount +
                          hubStats.activePrintOrdersCount +
                          hubStats.paymentReceiptsCount}
                      </span>
                    </div>
                    <p className="text-xs text-[var(--ps-text-muted)] truncate">
                      Personal ledger, saved bookmarks, prints, active trips &amp; receipts
                    </p>
                  </div>
                </Link>

                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      setIsLedgerExpanded((prev) => !prev);
                    }}
                    aria-expanded={isLedgerExpanded}
                    aria-label="Toggle activity shortcuts"
                    className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
                  >
                    <ChevronDown
                      className={`w-5 h-5 transition-transform duration-200 ${
                        isLedgerExpanded ? 'rotate-180' : ''
                      }`}
                    />
                  </button>
                </div>
              </div>

              {/* Nested Shortcuts Rows (Collapsible) */}
              <AnimatePresence initial={false}>
                {isLedgerExpanded && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 350, damping: 30 }}
                    className="overflow-hidden border-t border-[var(--ps-border)]/60 bg-[var(--ps-bg)]/40 divide-y divide-[var(--ps-border)]/40 text-xs"
                  >
                    <Link
                      href="/saved"
                      data-testid="profile-hub-bookmarks-link"
                      className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-[var(--ps-surface-alt)] transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Bookmark className="h-4 w-4 text-amber-500 shrink-0" />
                        <div className="min-w-0">
                          <span className="font-bold text-[var(--ps-text)] block">
                            Saved Items
                          </span>
                          <span className="text-[11px] text-[var(--ps-text-muted)] truncate block">
                            Places, products, vehicles &amp; interests
                          </span>
                        </div>
                      </div>
                      <span className="font-mono text-xs font-bold text-amber-600 dark:text-amber-400 tabular-nums">
                        {totalSavedCount}
                      </span>
                    </Link>

                    <Link
                      href="/activity?tab=trips"
                      data-testid="profile-hub-trips-link"
                      className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-[var(--ps-surface-alt)] transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Activity className="h-4 w-4 text-emerald-500 shrink-0" />
                        <div className="min-w-0">
                          <span className="font-bold text-[var(--ps-text)] block">
                            Active Trips &amp; Bookings
                          </span>
                          <span className="text-[11px] text-[var(--ps-text-muted)] truncate block">
                            Pick N Drop &amp; Scheduled Vehicles
                          </span>
                        </div>
                      </div>
                      <span className="font-mono text-xs font-bold text-emerald-600 dark:text-emerald-400 tabular-nums">
                        {hubStats.activeTripsCount}
                      </span>
                    </Link>

                    <Link
                      href="/activity?tab=bookings"
                      data-testid="profile-hub-resource-bookings-link"
                      className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-[var(--ps-surface-alt)] transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <CalendarDays className="h-4 w-4 text-indigo-500 shrink-0" />
                        <div className="min-w-0">
                          <span className="font-bold text-[var(--ps-text)] block">
                            Venues &amp; Stays Bookings
                          </span>
                          <span className="text-[11px] text-[var(--ps-text-muted)] truncate block">
                            Turf slots, halls, hotels &amp; check-in OTPs
                          </span>
                        </div>
                      </div>
                      <span className="font-mono text-xs font-bold text-indigo-600 dark:text-indigo-400 tabular-nums">
                        {hubStats.activeResourceBookingsCount}
                      </span>
                    </Link>

                    <Link
                      href="/activity?tab=commerce"
                      data-testid="profile-hub-commerce-link"
                      className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-[var(--ps-surface-alt)] transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <ShoppingBag className="h-4 w-4 text-orange-500 shrink-0" />
                        <div className="min-w-0">
                          <span className="font-bold text-[var(--ps-text)] block">
                            Food &amp; Shop Orders
                          </span>
                          <span className="text-[11px] text-[var(--ps-text-muted)] truncate block">
                            Storefronts, menus &amp; table bookings
                          </span>
                        </div>
                      </div>
                      <span className="font-mono text-xs font-bold text-orange-600 dark:text-orange-400 tabular-nums">
                        {hubStats.activeCommerceCount}
                      </span>
                    </Link>

                    <Link
                      href="/activity?tab=payments"
                      data-testid="profile-hub-payments-link"
                      className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-[var(--ps-surface-alt)] transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Receipt className="h-4 w-4 text-sky-500 shrink-0" />
                        <div className="min-w-0">
                          <span className="font-bold text-[var(--ps-text)] block">
                            Payment Receipts
                          </span>
                          <span className="text-[11px] text-[var(--ps-text-muted)] truncate block">
                            UPI UTRs, Razorpay &amp; refund history
                          </span>
                        </div>
                      </div>
                      <span className="font-mono text-xs font-bold text-sky-600 dark:text-sky-400 tabular-nums">
                        {hubStats.paymentReceiptsCount}
                      </span>
                    </Link>

                    <Link
                      href="/activity?tab=print"
                      data-testid="profile-hub-print-orders-link"
                      className="flex items-center justify-between gap-3 px-4 py-3 hover:bg-[var(--ps-surface-alt)] transition-colors"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <Printer className="h-4 w-4 text-theme-primary shrink-0" />
                        <div className="min-w-0">
                          <span className="font-bold text-[var(--ps-text)] block">
                            Print &amp; Digital Orders
                          </span>
                          <span className="text-[11px] text-[var(--ps-text-muted)] truncate block">
                            Uploads, custom quotes &amp; OTPs
                          </span>
                        </div>
                      </div>
                      <span className="font-mono text-xs font-bold text-theme-primary tabular-nums">
                        {hubStats.activePrintOrdersCount}
                      </span>
                    </Link>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>

            {/* Appearance & Preferences */}
            <Link
              href="/settings"
              data-testid="profile-hub-settings-link"
              className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 hover:border-[var(--ps-accent)]/60 transition-colors"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-500/12 text-slate-700 dark:text-slate-300">
                  <Settings className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-bold text-[var(--ps-text)]">
                    Appearance &amp; Preferences
                  </p>
                  <p className="text-xs text-[var(--ps-text-muted)] truncate">
                    Theme, scale, language &amp; locality
                  </p>
                </div>
              </div>
              <ChevronRight className="h-4 w-4 text-[var(--ps-text-muted)] shrink-0" />
            </Link>
          </section>

          {/* Footer Quick Actions */}
          <div className="flex flex-wrap items-center justify-center gap-2.5 pt-2">
            <Link
              href="/explore"
              className="inline-flex h-9 items-center gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-4 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] transition-colors"
            >
              <MapPin className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
              <span>Explore Map</span>
            </Link>
            <button
              type="button"
              onClick={() => void handleSignOut()}
              data-testid="profile-sign-out-btn"
              className="inline-flex h-9 items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 px-4 text-xs font-semibold text-rose-600 dark:text-rose-400 transition hover:bg-rose-500/20 cursor-pointer"
            >
              <LogOut className="h-3.5 w-3.5" />
              <span>Sign Out</span>
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default function ProfilePage() {
  return (
    <AppProvider>
      <ProtectedRoute>
        <ProfileContent />
      </ProtectedRoute>
    </AppProvider>
  );
}
