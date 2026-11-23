'use client';

import React, { useState } from 'react';
import {
  Building2,
  ChevronDown,
  ChevronUp,
  FlaskConical,
  KeyRound,
  Loader2,
  Shield,
  Store,
  Truck,
  User,
  Users,
} from 'lucide-react';
import {
  DEV_TEST_ROLE_ACCOUNTS,
  ENABLE_DEV_ROLE_SHORTCUTS,
  type DevTestRoleAccount,
  type DevTestRoleId,
} from '@/lib/auth/dev-test-accounts';
import { clearUnauthorizedViewRoleState } from '@/lib/auth/super-admin';
import { syncAuthenticatedProfileRole } from '@/lib/auth';
import { supabase } from '@/lib/supabase/client';

export interface TestRoleShortcutsProps {
  onPrefillCredentials?: (email: string, password: string) => void;
  onSignedIn?: (account: DevTestRoleAccount) => void;
  onNotice?: (type: 'error' | 'info', message: string) => void;
  defaultExpanded?: boolean;
}

function getRoleIcon(id: DevTestRoleId) {
  switch (id) {
    case 'visitor':
      return User;
    case 'owner':
      return Store;
    case 'staff':
      return Users;
    case 'driver':
      return Truck;
    case 'hub_manager':
      return Building2;
    case 'super_admin':
      return Shield;
  }
}

/**
 * Pass V13-A: Removable Staging Role Test Login Shortcuts
 *
 * // REMOVE BEFORE LIVE PRODUCTION LAUNCH
 * Renders only when `ENABLE_DEV_ROLE_SHORTCUTS` is true.
 * Provides 1-tap auto-fill and instant sign-in for the 5 test roles
 * (`Visitor`, `Owner`, `Staff`, `Driver`, `Hub Manager`) and email-only
 * prefill for the locked `Super Admin` account.
 */
export function TestRoleShortcuts({
  onPrefillCredentials,
  onSignedIn,
  onNotice,
  defaultExpanded = true,
}: TestRoleShortcutsProps) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [busyRoleId, setBusyRoleId] = useState<DevTestRoleId | null>(null);
  const [activeHint, setActiveHint] = useState<string | null>(null);

  if (!ENABLE_DEV_ROLE_SHORTCUTS) {
    return null;
  }

  const handleSelectRole = async (acct: DevTestRoleAccount) => {
    setActiveHint(
      `${acct.roleLabel} (@${acct.username}): ${acct.restrictionNote}`
    );

    // Super Admin: strictly prefill email only — NEVER expose personal password
    if (!acct.autoSignIn || !acct.prefillPassword) {
      onPrefillCredentials?.(acct.email, '');
      onNotice?.(
        'info',
        `Super-Admin email (${acct.email}) prefilled. Enter your password above to sign in.`
      );
      return;
    }

    onPrefillCredentials?.(acct.email, acct.prefillPassword);
    setBusyRoleId(acct.id);

    try {
      clearUnauthorizedViewRoleState();

      let { data, error } = await supabase.auth.signInWithPassword({
        email: acct.email,
        password: acct.prefillPassword,
      });

      // Auto-provision test role accounts on first click if not seeded yet
      if (error && /invalid login credentials/i.test(error.message || '')) {
        const seedRes = await fetch('/api/dev/seed-test-accounts', {
          method: 'POST',
        });
        if (seedRes.ok) {
          const retry = await supabase.auth.signInWithPassword({
            email: acct.email,
            password: acct.prefillPassword,
          });
          data = retry.data;
          error = retry.error;
        }
      }

      if (error) {
        onNotice?.(
          'error',
          `Could not sign in as ${acct.roleLabel}: ${error.message}. Run "node scripts/seed-test-role-accounts.mjs" to provision test accounts.`
        );
        return;
      }

      if (data?.user) {
        await syncAuthenticatedProfileRole(data.user, data.session, true);
      }
      onSignedIn?.(acct);
    } catch (err) {
      onNotice?.(
        'error',
        err instanceof Error
          ? err.message
          : 'Failed to sign in with test role shortcut.'
      );
    } finally {
      setBusyRoleId(null);
    }
  };

  return (
    <section
      data-testid="test-role-shortcuts"
      className="rounded-2xl border border-[var(--border-subtle,var(--ps-border))] bg-[var(--bg-surface,var(--ps-surface))] p-3.5 text-xs text-[var(--text-primary,var(--ps-text))] shadow-2xs space-y-2.5"
    >
      <button
        type="button"
        onClick={() => setExpanded((prev) => !prev)}
        data-testid="test-role-shortcuts-toggle"
        className="flex w-full items-center justify-between gap-2 text-left cursor-pointer"
      >
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600 dark:text-amber-400">
            <FlaskConical className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="font-extrabold tracking-tight text-xs">
                Quick Role Test Login (Staging)
              </span>
              <span className="rounded-md border border-amber-500/35 bg-amber-500/10 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">
                1-Tap
              </span>
            </div>
            <p className="text-[10px] text-[var(--text-secondary,var(--ps-text-muted))] truncate">
              Test Visitor, Owner, Staff, Driver &amp; Lamka Hub Manager with real RLS
            </p>
          </div>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 shrink-0 text-[var(--text-secondary,var(--ps-text-muted))]" />
        ) : (
          <ChevronDown className="h-4 w-4 shrink-0 text-[var(--text-secondary,var(--ps-text-muted))]" />
        )}
      </button>

      {expanded && (
        <div className="space-y-2.5 border-t border-[var(--border-subtle,var(--ps-border))] pt-2.5">
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
            {DEV_TEST_ROLE_ACCOUNTS.map((acct) => {
              const Icon = getRoleIcon(acct.id);
              const isBusy = busyRoleId === acct.id;
              return (
                <button
                  key={acct.id}
                  type="button"
                  disabled={busyRoleId !== null}
                  data-testid={`test-role-shortcut-${acct.id}`}
                  onClick={() => void handleSelectRole(acct)}
                  className={`flex flex-col items-start justify-between gap-1 rounded-xl border p-2 text-left transition-all cursor-pointer disabled:opacity-50 hover:opacity-95 ${acct.badgeTone}`}
                >
                  <div className="flex w-full items-center justify-between gap-1">
                    <span className="inline-flex items-center gap-1 font-extrabold text-[11px]">
                      {isBusy ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Icon className="h-3 w-3 shrink-0" />
                      )}
                      <span className="truncate">{acct.shortLabel}</span>
                    </span>
                    {!acct.autoSignIn && (
                      <span title="Email prefill only — requires real password">
                        <KeyRound className="h-2.5 w-2.5 shrink-0 opacity-75" />
                      </span>
                    )}
                  </div>
                  <span className="font-mono text-[10px] opacity-80 truncate w-full">
                    @{acct.username}
                  </span>
                </button>
              );
            })}
          </div>

          {activeHint ? (
            <div
              data-testid="test-role-shortcut-hint"
              className="rounded-xl border border-[var(--border-subtle,var(--ps-border))] bg-[var(--bg-canvas,var(--ps-bg))] px-2.5 py-2 text-[11px] leading-snug text-[var(--text-secondary,var(--ps-text-muted))]"
            >
              {activeHint}
            </div>
          ) : (
            <div className="flex flex-wrap items-center justify-between gap-1 text-[10px] text-[var(--text-secondary,var(--ps-text-muted))]">
              <span>
                Test password: <code className="font-mono font-bold">Test@1234</code>
              </span>
              <span>Super-Admin role toggle is locked to @dd_thang</span>
            </div>
          )}
        </div>
      )}
    </section>
  );
}

export default TestRoleShortcuts;
