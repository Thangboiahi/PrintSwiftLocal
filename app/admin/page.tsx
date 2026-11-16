'use client';

import React from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Lock, Shield, UserCheck } from 'lucide-react';
import {
  Breadcrumbs,
  triggerUnmountOverlaysToMap,
} from '@/components/navigation/Breadcrumbs';
import AdminWorkspace from '@/components/workspaces/AdminWorkspace';
import { canRoleAccessAdmin, useAppStore, useAuth } from '@/lib/store';

export default function AdminRoutePage() {
  const router = useRouter();
  const { currentUser } = useAppStore();
  const { user: authUser, role: syncedAuthRole } = useAuth();

  const effectiveRole = (
    authUser
      ? syncedAuthRole
      : currentUser.adminRole || currentUser.roleType || 'visitor'
  )
    .toString()
    .toLowerCase();

  const isAuthorizedAdmin =
    canRoleAccessAdmin(effectiveRole) ||
    currentUser.roleType === 'admin' ||
    Boolean(currentUser.adminRole);

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

  if (!isAuthorizedAdmin) {
    return (
      <main
        data-testid="admin-unauthorized-state"
        data-user-role={effectiveRole}
        className="min-h-screen bg-[var(--ps-bg)] text-[var(--ps-text)] flex flex-col items-center justify-center px-4 py-12"
      >
        <div className="w-full max-w-md rounded-2xl border border-rose-500/30 bg-[var(--ps-surface)] p-6 sm:p-8 text-center shadow-xl space-y-5">
          <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/20">
            <Lock className="h-7 w-7" aria-hidden="true" />
          </div>
          <div className="space-y-2">
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-3 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-rose-600 dark:text-rose-400">
              Unauthorized • Role: {effectiveRole}
            </span>
            <h1 className="text-xl font-extrabold tracking-tight text-[var(--ps-text)]">
              Admin Command Centre Restricted
            </h1>
            <p className="text-xs leading-relaxed text-[var(--ps-text-muted)]">
              Administrative governance and verification queues require an{' '}
              <strong>admin</strong> or <strong>super_admin</strong> role.
            </p>
          </div>
          <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5 pt-2">
            <button
              type="button"
              onClick={() => handleOpenListingOnMap()}
              data-testid="admin-unauthorized-return-map-btn"
              className="w-full sm:w-auto inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-4 py-2 text-xs font-bold text-[var(--ps-accent-fg)] shadow-xs transition hover:opacity-95"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Return to Home Map</span>
            </button>
            {!authUser && (
              <Link
                href="/login"
                className="w-full sm:w-auto inline-flex min-h-[42px] items-center justify-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-4 py-2 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]"
              >
                <UserCheck className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
                <span>Sign In</span>
              </Link>
            )}
          </div>
        </div>
      </main>
    );
  }

  return (
    <div
      data-testid="admin-route-page"
      data-user-role={effectiveRole}
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
