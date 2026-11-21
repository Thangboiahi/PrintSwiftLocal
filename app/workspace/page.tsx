'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  Loader2,
  Lock,
  UserCheck,
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

const ALLOWED_WORKSPACE_ROLES = new Set([
  'driver',
  'staff',
  'owner',
  'hub_manager',
  'admin',
  'super_admin',
]);

export default function WorkspaceRoutePage() {
  const router = useRouter();
  const { currentUser } = useAppStore();
  const { user: authUser, role: syncedAuthRole } = useAuth();

  const [fetchedProfileRole, setFetchedProfileRole] = useState<string | null>(
    null
  );
  const [isCheckingRole, setIsCheckingRole] = useState<boolean>(() =>
    isSupabaseConfigured()
  );

  useEffect(() => {
    let active = true;

    async function loadProfileRole() {
      if (!isSupabaseConfigured()) {
        if (active) setIsCheckingRole(false);
        return;
      }

      try {
        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!active) return;

        if (!session?.user?.id) {
          setFetchedProfileRole('visitor');
          setIsCheckingRole(false);
          return;
        }

        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', session.user.id)
          .maybeSingle();

        if (!active) return;

        const rawDbRole = String(
          (profile as { role?: string | null } | null)?.role ||
            syncedAuthRole ||
            'visitor'
        )
          .trim()
          .toLowerCase();

        setFetchedProfileRole(getEffectiveRoleWithOverride(rawDbRole));
      } catch {
        if (active) {
          setFetchedProfileRole('visitor');
        }
      } finally {
        if (active) {
          setIsCheckingRole(false);
        }
      }
    }

    void loadProfileRole();

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

  const isAuthorized = ALLOWED_WORKSPACE_ROLES.has(effectiveRole);
  const isDriverRole = effectiveRole === 'driver';
  const isStaffRole = effectiveRole === 'staff';
  const isHubManagerRole = effectiveRole === 'hub_manager';
  const isAdminRole =
    effectiveRole === 'admin' ||
    effectiveRole === 'super_admin' ||
    canRoleAccessAdmin(effectiveRole);

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

  if (isCheckingRole) {
    return <AppBrandLoader mode="inline" message="Verifying workspace permissions…" />;
  }

  if (!isAuthorized) {
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
              Unauthorized Access • Role: {effectiveRole}
            </span>
            <h1 className="text-xl font-extrabold tracking-tight text-[var(--ps-text)]">
              Unauthorized Access
            </h1>
            <p className="text-xs leading-relaxed text-[var(--ps-text-muted)]">
              Operational workspaces are strictly protected by Role-Based Access
              Control (RBAC). Accounts with <strong>driver</strong>,{' '}
              <strong>staff</strong>, <strong>owner</strong>,{' '}
              <strong>hub_manager</strong>, <strong>admin</strong>, or{' '}
              <strong>super_admin</strong> roles can access this route.
            </p>
          </div>

          <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5 pt-2">
            <Link
              href="/profile"
              data-testid="unauthorized-return-profile-btn"
              className="w-full sm:w-auto inline-flex h-9 items-center justify-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-4 text-xs font-bold text-[var(--ps-accent-fg)] shadow-xs transition hover:opacity-95"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Go to Profile</span>
            </Link>
            <button
              type="button"
              onClick={() => handleReturnToMap()}
              data-testid="unauthorized-return-map-btn"
              className="w-full sm:w-auto inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-bg)] px-4 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]"
            >
              <span>Return to Explore Map</span>
            </button>
            {!authUser && (
              <Link
                href="/login"
                data-testid="unauthorized-sign-in-link"
                className="w-full sm:w-auto inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-gray-200 dark:border-gray-800 bg-[var(--ps-bg)] px-4 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]"
              >
                <UserCheck className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
                <span>Sign In</span>
              </Link>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="workspace-route-page"
      data-user-role={effectiveRole}
      className="w-full max-w-7xl mx-auto px-4 sm:px-6 py-6 pb-24 md:pb-10 space-y-6"
    >
      {isDriverRole ? (
        <DriverWorkspace />
      ) : isHubManagerRole ? (
        <HubManagerWorkspace onOpenListingOnMap={handleReturnToMap} />
      ) : isAdminRole ? (
        <AdminWorkspace onOpenListingOnMap={handleReturnToMap} />
      ) : isStaffRole ? (
        <StaffWorkspace onOpenListingOnMap={handleReturnToMap} />
      ) : (
        <OwnerStaffWorkspace
          forcedRole="owner"
          onOpenListingOnMap={handleReturnToMap}
        />
      )}
    </div>
  );
}
