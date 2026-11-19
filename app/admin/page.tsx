'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import { triggerUnmountOverlaysToMap } from '@/components/navigation/Breadcrumbs';
import AdminWorkspace from '@/components/workspaces/AdminWorkspace';
import {
  getEffectiveRoleWithOverride,
  useAppStore,
  useAuth,
} from '@/lib/store';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';

export default function AdminRoutePage() {
  const router = useRouter();
  const { currentUser } = useAppStore();
  const { user: authUser, role: syncedAuthRole } = useAuth();

  const [verifiedRole, setVerifiedRole] = useState<string | null>(null);
  const [isCheckingRole, setIsCheckingRole] = useState(true);

  useEffect(() => {
    let active = true;

    async function verifySuperAdminRole() {
      let resolvedRole = 'visitor';

      if (isSupabaseConfigured()) {
        try {
          const {
            data: { session },
          } = await supabase.auth.getSession();

          if (session?.user?.id) {
            const { data: profile } = await supabase
              .from('profiles')
              .select('role')
              .eq('id', session.user.id)
              .maybeSingle();

            const rawDbRole = String(
              (profile as { role?: string | null } | null)?.role ||
                syncedAuthRole ||
                'visitor'
            )
              .trim()
              .toLowerCase();
            resolvedRole = getEffectiveRoleWithOverride(rawDbRole);
          }
        } catch {
          resolvedRole = 'visitor';
        }
      } else {
        resolvedRole = getEffectiveRoleWithOverride(
          (
            authUser
              ? syncedAuthRole
              : currentUser.adminRole || currentUser.roleType || 'visitor'
          ).toString()
        );
      }

      if (!active) return;

      if (resolvedRole !== 'super_admin' && resolvedRole !== 'admin') {
        router.replace('/');
        return;
      }

      setVerifiedRole(resolvedRole);
      setIsCheckingRole(false);
    }

    void verifySuperAdminRole();

    return () => {
      active = false;
    };
  }, [
    authUser,
    syncedAuthRole,
    currentUser.adminRole,
    currentUser.roleType,
    router,
  ]);

  const handleOpenListingOnMap = (listingId?: string) => {
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

  if (
    isCheckingRole ||
    (verifiedRole !== 'super_admin' && verifiedRole !== 'admin')
  ) {
    return (
      <div
        data-testid="admin-role-loading"
        className="w-full py-12 bg-[var(--ps-bg)] text-[var(--ps-text)] flex items-center justify-center px-4"
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--ps-accent)]" />
          <p className="text-xs font-medium text-[var(--ps-text-muted)]">
            Verifying admin access…
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="admin-route-page"
      data-user-role={verifiedRole}
      className="w-full max-w-7xl mx-auto px-4 sm:px-6 py-6 space-y-6"
    >
      <AdminWorkspace onOpenListingOnMap={handleOpenListingOnMap} />
    </div>
  );
}
