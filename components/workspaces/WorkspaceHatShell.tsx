'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Building2,
  Lock,
  Shield,
  Store,
  Truck,
  UserCheck,
  Users,
} from 'lucide-react';
import { triggerUnmountOverlaysToMap } from '@/components/navigation/Breadcrumbs';
import { AppBrandLoader } from '@/components/ui/AppBrandLoader';
import AdminWorkspace from '@/components/workspaces/AdminWorkspace';
import DriverWorkspace from '@/components/workspaces/DriverWorkspace';
import HubManagerWorkspace from '@/components/workspaces/HubManagerWorkspace';
import OwnerStaffWorkspace from '@/components/workspaces/OwnerStaffWorkspace';
import StaffWorkspace from '@/components/workspaces/StaffWorkspace';
import {
  canRoleAccessAdmin,
  getEffectiveRoleWithOverride,
  useAppStore,
  useAuth,
} from '@/lib/store';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';

export type WorkspaceHatKey =
  | 'owner'
  | 'staff'
  | 'driver'
  | 'hub_manager'
  | 'master_control';

interface OperationalHatsPayload {
  platform_role: string;
  owned_listings_count: number;
  owned_vehicles_count: number;
  active_staff_assignments: Array<{
    listing_id?: string;
    role_label?: string;
  }>;
  driver_profile: Record<string, unknown> | null;
  managed_hubs: Array<{ hub_id?: string }>;
}

const VALID_HATS: WorkspaceHatKey[] = [
  'owner',
  'staff',
  'driver',
  'hub_manager',
  'master_control',
];

function isValidHat(val: string | null | undefined): val is WorkspaceHatKey {
  return Boolean(val && VALID_HATS.includes(val as WorkspaceHatKey));
}

export function WorkspaceHatShell() {
  const router = useRouter();
  const { currentUser } = useAppStore();
  const { user: authUser, role: syncedAuthRole } = useAuth();

  const [fetchedProfileRole, setFetchedProfileRole] = useState<string | null>(
    null
  );
  const [hats, setHats] = useState<OperationalHatsPayload | null>(null);
  const [isChecking, setIsChecking] = useState<boolean>(() =>
    isSupabaseConfigured()
  );
  const [activeHat, setActiveHat] = useState<WorkspaceHatKey | null>(null);
  const [requestedListingId, setRequestedListingId] = useState<string | null>(
    null
  );

  // Hydrate ?hat= and ?listing= from URL on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const hatParam = params.get('hat')?.trim().toLowerCase() || null;
    const listingParam = params.get('listing')?.trim() || null;
    if (isValidHat(hatParam)) {
      setActiveHat(hatParam);
    }
    if (listingParam) {
      setRequestedListingId(listingParam);
    }
  }, []);

  useEffect(() => {
    let active = true;

    async function loadHatsAndRole() {
      if (!isSupabaseConfigured()) {
        if (active) setIsChecking(false);
        return;
      }

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!active) return;

        if (!session?.user?.id) {
          setFetchedProfileRole('visitor');
          setHats(null);
          setIsChecking(false);
          return;
        }

        const userId = session.user.id;
        const [profileRes, hatsRes] = await Promise.allSettled([
          supabase
            .from('profiles')
            .select('role')
            .eq('id', userId)
            .maybeSingle(),
          supabase.rpc('get_user_operational_hats', { p_user_id: userId }),
        ]);

        if (!active) return;

        const rawDbRole = String(
          profileRes.status === 'fulfilled'
            ? (profileRes.value.data as { role?: string | null } | null)?.role ||
                syncedAuthRole ||
                'visitor'
            : syncedAuthRole || 'visitor'
        )
          .trim()
          .toLowerCase();

        const effective = getEffectiveRoleWithOverride(rawDbRole);
        setFetchedProfileRole(effective);

        if (
          hatsRes.status === 'fulfilled' &&
          !hatsRes.value.error &&
          hatsRes.value.data &&
          typeof hatsRes.value.data === 'object'
        ) {
          const raw = hatsRes.value.data as Record<string, unknown>;
          setHats({
            platform_role: String(raw.platform_role || effective),
            owned_listings_count: Number(raw.owned_listings_count ?? 0),
            owned_vehicles_count: Number(raw.owned_vehicles_count ?? 0),
            active_staff_assignments: Array.isArray(raw.active_staff_assignments)
              ? (raw.active_staff_assignments as OperationalHatsPayload['active_staff_assignments'])
              : [],
            driver_profile:
              raw.driver_profile && typeof raw.driver_profile === 'object'
                ? (raw.driver_profile as Record<string, unknown>)
                : null,
            managed_hubs: Array.isArray(raw.managed_hubs)
              ? (raw.managed_hubs as OperationalHatsPayload['managed_hubs'])
              : [],
          });
        }
      } catch {
        if (active) setFetchedProfileRole('visitor');
      } finally {
        if (active) setIsChecking(false);
      }
    }

    void loadHatsAndRole();
    return () => {
      active = false;
    };
  }, [authUser?.id, syncedAuthRole]);

  const effectiveRole = (
    fetchedProfileRole ??
    (authUser
      ? syncedAuthRole
      : currentUser.adminRole || currentUser.roleType || 'visitor')
  )
    .toString()
    .trim()
    .toLowerCase();

  const isRoleOverridden = Boolean(
    hats?.platform_role &&
      effectiveRole &&
      hats.platform_role.toLowerCase() !== effectiveRole
  );

  // Build ONLY the hats this user actually holds (honoring Super-Admin view_role override when active)
  const availableHats = useMemo(() => {
    const list: Array<{
      key: WorkspaceHatKey;
      label: string;
      count?: number;
      icon: typeof Store;
    }> = [];

    if (isRoleOverridden) {
      if (effectiveRole === 'owner') {
        list.push({ key: 'owner', label: 'My Businesses', icon: Store });
      } else if (effectiveRole === 'staff') {
        list.push({ key: 'staff', label: 'Staff Desk', icon: Users });
      } else if (effectiveRole === 'driver') {
        list.push({ key: 'driver', label: 'Driver Console', icon: Truck });
      } else if (effectiveRole === 'hub_manager') {
        list.push({
          key: 'hub_manager',
          label: 'Hub Manager',
          icon: Building2,
        });
      } else if (
        effectiveRole === 'admin' ||
        effectiveRole === 'super_admin' ||
        canRoleAccessAdmin(effectiveRole)
      ) {
        list.push({
          key: 'master_control',
          label: 'Master Control',
          icon: Shield,
        });
      }
      return list;
    }

    const ownerCount =
      (hats?.owned_listings_count ?? 0) + (hats?.owned_vehicles_count ?? 0);
    const staffCount = hats?.active_staff_assignments?.length ?? 0;

    if (ownerCount > 0 || effectiveRole === 'owner') {
      list.push({
        key: 'owner',
        label: 'My Businesses',
        count: ownerCount > 0 ? ownerCount : undefined,
        icon: Store,
      });
    }
    if (staffCount > 0 || effectiveRole === 'staff') {
      list.push({
        key: 'staff',
        label: 'Staff Desk',
        count: staffCount > 0 ? staffCount : undefined,
        icon: Users,
      });
    }
    if (Boolean(hats?.driver_profile) || effectiveRole === 'driver') {
      list.push({ key: 'driver', label: 'Driver Console', icon: Truck });
    }
    if (
      (hats?.managed_hubs?.length ?? 0) > 0 ||
      effectiveRole === 'hub_manager'
    ) {
      list.push({ key: 'hub_manager', label: 'Hub Manager', icon: Building2 });
    }
    if (
      hats?.platform_role === 'super_admin' ||
      effectiveRole === 'admin' ||
      effectiveRole === 'super_admin' ||
      canRoleAccessAdmin(effectiveRole)
    ) {
      list.push({
        key: 'master_control',
        label: 'Master Control',
        icon: Shield,
      });
    }

    return list;
  }, [hats, effectiveRole, isRoleOverridden]);

  const resolvedHat: WorkspaceHatKey | null = useMemo(() => {
    if (availableHats.length === 0) return null;
    if (activeHat && availableHats.some((h) => h.key === activeHat)) {
      return activeHat;
    }
    return availableHats[0].key;
  }, [availableHats, activeHat]);

  const handleSelectHat = useCallback((nextHat: WorkspaceHatKey) => {
    setActiveHat(nextHat);
    if (typeof window !== 'undefined') {
      const url = new URL(window.location.href);
      url.searchParams.set('hat', nextHat);
      window.history.replaceState({}, '', url.toString());
    }
  }, []);

  const handleReturnToMap = (listingId?: string) => {
    triggerUnmountOverlaysToMap();
    if (listingId && typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('printswift:focus-map-listing', {
          detail: { listingId },
        })
      );
    }
    router.push('/explore');
  };

  if (isChecking) {
    return (
      <AppBrandLoader
        mode="inline"
        message="Verifying workspace permissions…"
      />
    );
  }

  if (!resolvedHat) {
    return (
      <div
        data-testid="workspace-unauthorized-state"
        data-user-role={effectiveRole}
        className="w-full bg-[var(--ps-bg)] text-[var(--ps-text)] flex flex-col items-center justify-center px-4 py-8"
      >
        <div className="w-full max-w-md rounded-2xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-surface)] p-6 sm:p-8 text-center shadow-sm space-y-5">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
            <Lock className="h-7 w-7" aria-hidden="true" />
          </div>

          <div className="space-y-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-3 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-rose-600 dark:text-rose-400">
              No Active Partner Hat • Role: {effectiveRole}
            </span>
            <h1 className="text-xl font-extrabold tracking-tight text-[var(--ps-text)]">
              Workspace Access Required
            </h1>
            <p className="text-xs leading-relaxed text-[var(--ps-text-muted)]">
              Operational workspaces are available to Business Owners, Delegated Staff, Verified Drivers, Hub Managers, and Administrators.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5 pt-1">
            <Link
              href="/onboarding"
              className="w-full sm:w-auto h-9 px-4 rounded-xl bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-bold inline-flex items-center justify-center gap-1.5 hover:opacity-95 transition-opacity"
            >
              <UserCheck className="w-3.5 h-3.5" />
              <span>Become a Partner</span>
            </Link>
            <button
              type="button"
              onClick={() => handleReturnToMap()}
              className="w-full sm:w-auto h-9 px-4 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs font-semibold text-[var(--ps-text)] inline-flex items-center justify-center gap-1.5 hover:bg-[var(--ps-surface-alt)] transition-colors cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to Explore</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="workspace-hat-shell"
      data-active-hat={resolvedHat}
      className="w-full bg-[var(--ps-bg)] text-[var(--ps-text)] min-h-[calc(100dvh-56px)]"
    >
      {/* Compact Multi-Hat Switcher Bar (Always shown when user holds >= 1 hat) */}
      <div className="sticky top-[var(--header-visible-height,52px)] z-30 border-b border-[var(--ps-border)] bg-[var(--ps-surface)]/95 backdrop-blur-md">
        <div className="mx-auto max-w-7xl px-3 sm:px-5 py-2 flex items-center justify-between gap-2 overflow-x-auto no-scrollbar">
          <div
            role="tablist"
            aria-label="Operational workspace hats"
            data-testid="workspace-hat-switcher-bar"
            className="flex items-center gap-1.5"
          >
            {availableHats.map((hat) => {
              const Icon = hat.icon;
              const isSelected = resolvedHat === hat.key;
              return (
                <button
                  key={hat.key}
                  type="button"
                  role="tab"
                  aria-selected={isSelected}
                  data-testid={`workspace-hat-tab-${hat.key}`}
                  onClick={() => handleSelectHat(hat.key)}
                  className={`h-8 px-3 rounded-xl text-xs font-bold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    isSelected
                      ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-2xs'
                      : 'bg-[var(--ps-bg)] text-[var(--ps-text-muted)] border border-[var(--ps-border)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                  <span>{hat.label}</span>
                  {typeof hat.count === 'number' && hat.count > 0 && (
                    <span
                      className={`px-1.5 py-0.5 rounded-full text-[10px] font-extrabold tabular-nums ${
                        isSelected
                          ? 'bg-white/20 text-[var(--ps-accent-fg)]'
                          : 'bg-[var(--ps-surface-alt)] text-[var(--ps-text)]'
                      }`}
                    >
                      {hat.count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          <button
            type="button"
            onClick={() => handleReturnToMap(requestedListingId || undefined)}
            className="h-8 px-2.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[11px] font-semibold text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] inline-flex items-center gap-1 whitespace-nowrap shrink-0 cursor-pointer"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Explore Map</span>
          </button>
        </div>
      </div>

      {/* Active Hat Workspace Body */}
      <div className="w-full">
        {resolvedHat === 'owner' && (
          <OwnerStaffWorkspace
            forcedRole="owner"
            initialListingId={requestedListingId}
            onOpenListingOnMap={(listingId) => handleReturnToMap(listingId)}
          />
        )}
        {resolvedHat === 'staff' && (
          <StaffWorkspace
            onOpenListingOnMap={(listingId) => handleReturnToMap(listingId)}
          />
        )}
        {resolvedHat === 'driver' && <DriverWorkspace />}
        {resolvedHat === 'hub_manager' && (
          <HubManagerWorkspace
            onOpenListingOnMap={(listingId) => handleReturnToMap(listingId)}
          />
        )}
        {resolvedHat === 'master_control' && (
          <AdminWorkspace
            onOpenListingOnMap={(listingId) => handleReturnToMap(listingId)}
          />
        )}
      </div>
    </div>
  );
}

export default WorkspaceHatShell;
