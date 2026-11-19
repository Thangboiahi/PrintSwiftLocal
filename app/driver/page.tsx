'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Loader2, Lock, Truck } from 'lucide-react';
import { DriverWorkspace } from '@/components/workspaces/DriverWorkspace';
import {
  getEffectiveRoleWithOverride,
  useAppStore,
  useAuth,
} from '@/lib/store';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';

const ALLOWED_DRIVER_ROLES = new Set(['driver', 'admin', 'super_admin']);

export default function DriverRoutePage() {
  const { currentUser } = useAppStore();
  const { user: authUser, role: syncedAuthRole } = useAuth();
  const [resolvedRole, setResolvedRole] = useState<string | null>(null);
  const [isChecking, setIsChecking] = useState<boolean>(() =>
    isSupabaseConfigured()
  );

  useEffect(() => {
    let active = true;

    async function verifyDriverAccess() {
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
          setResolvedRole('visitor');
          setIsChecking(false);
          return;
        }

        const { data: profile } = await supabase
          .from('profiles')
          .select('role')
          .eq('id', session.user.id)
          .maybeSingle();

        if (!active) return;

        const dbRole = String(
          (profile as { role?: string | null } | null)?.role ||
            syncedAuthRole ||
            'visitor'
        )
          .trim()
          .toLowerCase();

        setResolvedRole(getEffectiveRoleWithOverride(dbRole));
      } catch {
        if (active) setResolvedRole('visitor');
      } finally {
        if (active) setIsChecking(false);
      }
    }

    void verifyDriverAccess();
    return () => {
      active = false;
    };
  }, [authUser?.id, syncedAuthRole]);

  const effectiveRole = (
    resolvedRole ??
    (authUser
      ? syncedAuthRole
      : currentUser.adminRole || currentUser.roleType || 'visitor')
  )
    .toString()
    .trim()
    .toLowerCase();

  if (isChecking) {
    return (
      <div className="flex w-full items-center justify-center bg-[var(--ps-bg)] px-4 py-12 text-[var(--ps-text)]">
        <div className="flex flex-col items-center gap-2.5 text-center">
          <Loader2 className="h-6 w-6 animate-spin text-[var(--ps-accent)]" />
          <p className="text-xs font-medium text-[var(--ps-text-muted)]">
            Verifying driver credentials…
          </p>
        </div>
      </div>
    );
  }

  if (!ALLOWED_DRIVER_ROLES.has(effectiveRole)) {
    return (
      <div className="flex w-full flex-col items-center justify-center bg-[var(--ps-bg)] px-4 py-10 text-[var(--ps-text)]">
        <div className="w-full max-w-md space-y-4 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl border border-rose-500/25 bg-rose-500/10 text-rose-600 dark:text-rose-400">
            <Lock className="h-6 w-6" />
          </div>
          <div className="space-y-1.5">
            <span className="inline-flex items-center gap-1 rounded-full bg-rose-500/10 px-2.5 py-0.5 text-[10px] font-bold uppercase tracking-wider text-rose-600 dark:text-rose-400">
              <Truck className="h-3 w-3" />
              Driver Access Required
            </span>
            <h1 className="text-lg font-extrabold text-[var(--ps-text)]">
              Driver Workspace Restricted
            </h1>
            <p className="text-xs leading-relaxed text-[var(--ps-text-muted)]">
              This route is reserved for registered PrintSwift Local drivers.
              Current role: <strong>{effectiveRole}</strong>.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
            <Link
              href="/profile"
              className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-4 text-xs font-bold text-[var(--ps-accent-fg)]"
            >
              <ArrowLeft className="h-3.5 w-3.5" />
              <span>Go to Profile</span>
            </Link>
            <Link
              href="/contact"
              className="inline-flex h-9 items-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-4 text-xs font-semibold text-[var(--ps-text)]"
            >
              Apply as Driver
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="driver-route-page"
      className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 pb-24 md:pb-10"
    >
      <DriverWorkspace />
    </div>
  );
}
