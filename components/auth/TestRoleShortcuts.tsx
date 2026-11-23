'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';
import type { User as SupabaseUser } from '@supabase/supabase-js';
import {
  User,
  Store,
  Truck,
  ShieldCheck,
  Loader2,
  Terminal,
  AlertCircle,
  CheckCircle2,
  Megaphone,
  UserCheck,
  Crown,
} from 'lucide-react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase/client';
import {
  DEV_TEST_ACCOUNTS,
  ENABLE_DEV_ROLE_SHORTCUTS,
  type DevTestAccount,
} from '@/lib/auth/dev-test-accounts';
import {
  setAuthStoreState,
  syncAuthenticatedProfileRole,
  type SynchronizedRole,
} from '@/lib/auth';

export interface TestRoleShortcutsProps {
  onSuccess?: (account: DevTestAccount) => void;
  onSignedIn?: (account: DevTestAccount) => void;
  onPrefillCredentials?: (prefillEmail: string, prefillPassword: string) => void;
  onNotice?: (type: 'error' | 'info', msg: string) => void;
  compact?: boolean;
}

const ROLE_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  customer: User,
  owner: Store,
  staff: UserCheck,
  driver: Truck,
  advertiser: Megaphone,
  hub_manager: ShieldCheck,
  admin: Crown,
};

function mapDbRoleToSynchronizedRole(
  dbRole: DevTestAccount['dbRole'],
  accountId: string
): SynchronizedRole {
  if (accountId === 'staff') return 'staff';
  return dbRole;
}

export function TestRoleShortcuts({
  onSuccess,
  onSignedIn,
  onPrefillCredentials,
  onNotice,
  compact = false,
}: TestRoleShortcutsProps) {
  const router = useRouter();
  const [loadingRoleId, setLoadingRoleId] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  if (!ENABLE_DEV_ROLE_SHORTCUTS) {
    return null;
  }

  const activatePreviewFallbackSession = (account: DevTestAccount) => {
    const syntheticId = `demo-${account.id}-0000-0000-000000000001`;
    const syncRole = mapDbRoleToSynchronizedRole(account.dbRole, account.id);
    const previewUser = {
      id: syntheticId,
      aud: 'authenticated',
      role: 'authenticated',
      email: account.email,
      phone: account.phone,
      created_at: new Date().toISOString(),
      app_metadata: { provider: 'email', providers: ['email'] },
      user_metadata: {
        full_name: account.fullName,
        name: account.fullName,
        phone: account.phone,
        role: syncRole,
      },
    } as SupabaseUser;

    setAuthStoreState({
      user: previewUser,
      session: null,
      role: syncRole,
      realRole: syncRole,
      actual_role: syncRole,
      effective_role: syncRole,
      fullName: account.fullName,
      defaultHubId: '00000000-0000-4000-8000-000000000001',
      isLoading: false,
    });

    const msg = `Signed in as ${account.label} (${account.email})`;
    setStatusMessage(msg);
    onNotice?.('info', msg);
    onSuccess?.(account);
    onSignedIn?.(account);
    router.push(account.targetRoute);
    router.refresh();
  };

  const handleQuickRoleSignIn = async (account: DevTestAccount) => {
    setErrorMessage(null);
    const loadingMsg = `Signing in as ${account.label}...`;
    setStatusMessage(loadingMsg);
    onPrefillCredentials?.(account.email, account.password);
    setLoadingRoleId(account.id);

    try {
      if (!isSupabaseConfigured()) {
        activatePreviewFallbackSession(account);
        return;
      }

      // 1. Attempt normal signInWithPassword
      let { data, error } = await supabase.auth.signInWithPassword({
        email: account.email,
        password: account.password,
      });

      // 2. If account is not yet seeded in Supabase, call the server seed endpoint (non-production) and retry once
      if (error) {
        setStatusMessage(`Preparing ${account.shortLabel} demo workspace...`);
        const seedRes = await fetch('/api/dev/seed-test-accounts', {
          method: 'POST',
        });

        if (seedRes.ok) {
          const retry = await supabase.auth.signInWithPassword({
            email: account.email,
            password: account.password,
          });
          data = retry.data;
          error = retry.error;
        } else {
          await seedRes.json().catch(() => ({}));
          throw new Error(
            `Demo account (${account.email}) is not yet provisioned in this environment. Please sign in with your registered email or contact an administrator.`
          );
        }
      }

      if (error || !data?.user) {
        throw new Error(
          error?.message || `Unable to sign in as ${account.label} right now.`
        );
      }

      // 3. Synchronize authoritative profile role directly into auth store from Supabase
      await syncAuthenticatedProfileRole(data.user, data.session ?? null, true);

      const okMsg = `Signed in as ${account.label} (${account.email})`;
      setStatusMessage(okMsg);
      onNotice?.('info', okMsg);
      onSuccess?.(account);
      onSignedIn?.(account);

      router.push(account.targetRoute);
      router.refresh();
    } catch (err) {
      const errMsg =
        err instanceof Error
          ? err.message
          : 'Quick role sign-in could not be completed. Please try again.';
      setErrorMessage(errMsg);
      onNotice?.('error', errMsg);
      setStatusMessage(null);
    } finally {
      setLoadingRoleId(null);
    }
  };

  return (
    <div
      data-testid="dev-test-role-shortcuts"
      className={`rounded-2xl border border-dashed border-amber-300/80 bg-amber-50/70 ${
        compact ? 'p-3' : 'p-4'
      }`}
    >
      <div className="flex items-center justify-between gap-2 mb-2.5">
        <div className="flex items-center gap-1.5">
          <Terminal className="w-3.5 h-3.5 text-amber-700 shrink-0" />
          <span className="text-[11px] font-black uppercase tracking-wider text-amber-900">
            1-Tap Role Switcher (Demo Auth)
          </span>
        </div>
        <span className="text-[10px] font-bold px-2 py-0.5 rounded-full bg-amber-200/80 text-amber-900">
          Churachandpur Hub
        </span>
      </div>

      <p className="text-[11px] text-amber-800/90 leading-snug mb-3">
        Sign in with pre-configured role accounts to test Customer, Business Owner, Staff,
        Driver, Advertiser, Dispatch Mediator, and Admin workflows.
      </p>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
        {DEV_TEST_ACCOUNTS.map((account) => {
          const Icon = ROLE_ICONS[account.id] || User;
          const isLoading = loadingRoleId === account.id;
          const isDisabled = loadingRoleId !== null;

          return (
            <button
              key={account.id}
              type="button"
              data-testid={`test-role-btn-${account.id}`}
              disabled={isDisabled}
              onClick={() => handleQuickRoleSignIn(account)}
              className={`group relative flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-all shadow-xs disabled:opacity-60 disabled:cursor-not-allowed ${account.accentColor}`}
            >
              <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/15">
                {isLoading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Icon className="w-3.5 h-3.5" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1">
                  <span className="text-xs font-extrabold truncate">
                    {account.shortLabel}
                  </span>
                  <span className="text-[9px] font-black uppercase tracking-wider px-1.5 py-0.5 rounded bg-black/20">
                    {account.roleBadge}
                  </span>
                </div>
                <p className="text-[10px] opacity-80 truncate">{account.email}</p>
              </div>
            </button>
          );
        })}
      </div>

      {statusMessage && !errorMessage && (
        <div className="mt-2.5 flex items-center gap-1.5 text-[11px] font-semibold text-emerald-800 bg-emerald-100/80 border border-emerald-200 rounded-lg px-2.5 py-1.5">
          <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-600" />
          <span className="truncate">{statusMessage}</span>
        </div>
      )}

      {errorMessage && (
        <div
          data-testid="test-role-error"
          className="mt-2.5 flex items-start gap-1.5 text-[11px] font-medium text-rose-800 bg-rose-100/90 border border-rose-200 rounded-lg px-2.5 py-2"
        >
          <AlertCircle className="w-3.5 h-3.5 shrink-0 text-rose-600 mt-0.5" />
          <span className="leading-snug">{errorMessage}</span>
        </div>
      )}
    </div>
  );
}

export default TestRoleShortcuts;
