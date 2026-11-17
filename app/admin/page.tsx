'use client';

import React, { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Loader2, Shield } from 'lucide-react';
import {
  Breadcrumbs,
  triggerUnmountOverlaysToMap,
} from '@/components/navigation/Breadcrumbs';
import AdminWorkspace from '@/components/workspaces/AdminWorkspace';
import { useAppStore, useAuth } from '@/lib/store';
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

            resolvedRole = String(
              (profile as { role?: string | null } | null)?.role ||
                syncedAuthRole ||
                'visitor'
            )
              .trim()
              .toLowerCase();
          }
        } catch {
          resolvedRole = 'visitor';
        }
      } else {
        resolvedRole = (
          authUser
            ? syncedAuthRole
            : currentUser.adminRole || currentUser.roleType || 'visitor'
        )
          .toString()
          .trim()
          .toLowerCase();
      }

      if (!active) return;

      if (resolvedRole !== 'super_admin') {
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
    router.push('/');
  };

  if (isCheckingRole || verifiedRole !== 'super_admin') {
    return (
      <main
        data-testid="admin-role-loading"
        className="min-h-screen bg-[var(--ps-bg)] text-[var(--ps-text)] flex items-center justify-center px-4"
      >
        <div className="flex flex-col items-center gap-3 text-center">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--ps-accent)]" />
          <p className="text-xs font-medium text-[var(--ps-text-muted)]">
            Verifying super_admin access…
          </p>
        </div>
      </main>
    );
  }

  return (
    <div
      data-testid="admin-route-page"
      data-user-role={verifiedRole}
      className="min-h-full bg-[var(--ps-bg)] text-[var(--ps-text)]"
    >
      <div className="border-b border-[var(--ps-border)] bg-[var(--ps-surface)] px-4 py-3 sm:px-6">
        <div className="mx-auto max-w-7xl flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <Breadcrumbs items={[{ label: 'Admin Center' }]} />
            <span className="hidden sm:inline-flex items-center gap-1 rounded-lg bg-[var(--ps-surface-alt)] px-2.5 py-1 text-[11px] font-bold text-[var(--ps-accent)]">
              <Shield className="h-3.5 w-3.5" />
              <span>Moderation &amp; Verification</span>
            </span>
          </div>

          <button
            type="button"
            onClick={() => handleOpenListingOnMap()}
            data-testid="admin-route-back-to-map-btn"
            className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3.5 py-2 text-xs font-bold text-[var(--ps-accent-fg)] shadow-2xs transition hover:opacity-95"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Return to Map</span>
          </button>
        </div>
      </div>

      <AdminWorkspace onOpenListingOnMap={handleOpenListingOnMap} />
    </div>
  );
}
