'use client';

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';

export const STORAGE_KEY_AUTH_SESSION = 'printswift_local_auth_session_v1';

export type SynchronizedRole =
  | 'visitor'
  | 'owner'
  | 'staff'
  | 'admin'
  | 'super_admin'
  | 'listing_moderator'
  | 'verification_officer'
  | 'community_moderator'
  | 'customer_support'
  | 'finance_admin'
  | 'analytics_viewer';

export const WORKSPACE_AUTHORIZED_ROLES = new Set<string>([
  'owner',
  'staff',
  'admin',
  'super_admin',
  'listing_moderator',
  'verification_officer',
  'community_moderator',
  'customer_support',
  'finance_admin',
  'analytics_viewer',
]);

export const ADMIN_AUTHORIZED_ROLES = new Set<string>([
  'admin',
  'super_admin',
  'listing_moderator',
  'verification_officer',
  'community_moderator',
  'customer_support',
  'finance_admin',
  'analytics_viewer',
]);

export function canRoleAccessWorkspace(role?: string | null): boolean {
  if (!role) return false;
  return WORKSPACE_AUTHORIZED_ROLES.has(String(role).trim().toLowerCase());
}

export function canRoleAccessAdmin(role?: string | null): boolean {
  if (!role) return false;
  return ADMIN_AUTHORIZED_ROLES.has(String(role).trim().toLowerCase());
}

export interface AuthState {
  user: User | null;
  session: Session | null;
  role: SynchronizedRole;
  fullName: string | null;
  avatarUrl: string | null;
  isLoading: boolean;
}

const DEFAULT_AUTH_STATE: AuthState = {
  user: null,
  session: null,
  role: 'visitor',
  fullName: null,
  avatarUrl: null,
  isLoading: false,
};

let currentAuthState: AuthState = DEFAULT_AUTH_STATE;
let lastRawAuthSession: string | null = null;
let hasInitializedFromStorage = false;
let supabaseListenerInitialized = false;
let inflightRoleSyncUserId: string | null = null;
const authListeners = new Set<() => void>();

function normalizeSynchronizedRole(raw?: unknown): SynchronizedRole {
  const val = String(raw || '')
    .trim()
    .toLowerCase();
  if (WORKSPACE_AUTHORIZED_ROLES.has(val)) {
    return val as SynchronizedRole;
  }
  return 'visitor';
}

function extractFallbackRoleFromUser(user: User | null): SynchronizedRole {
  if (!user?.user_metadata) return 'visitor';
  const meta = user.user_metadata;
  return normalizeSynchronizedRole(
    meta.admin_role || meta.role || meta.role_type || 'visitor'
  );
}

function extractFallbackNameFromUser(user: User | null): string | null {
  if (!user) return null;
  const metaName =
    (user.user_metadata?.full_name as string | undefined) ||
    (user.user_metadata?.name as string | undefined);
  if (metaName && metaName.trim()) return metaName.trim();
  if (user.email) return user.email.split('@')[0];
  return null;
}

function syncAuthSnapshotFromStorage(): void {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_AUTH_SESSION);
    if (raw === lastRawAuthSession) {
      return;
    }
    lastRawAuthSession = raw;
    if (!raw) {
      currentAuthState = DEFAULT_AUTH_STATE;
      return;
    }
    const parsed = JSON.parse(raw) as Partial<AuthState>;
    if (
      parsed &&
      typeof parsed === 'object' &&
      ('user' in parsed || 'session' in parsed)
    ) {
      const nextUser = parsed.user ?? null;
      const nextSession = parsed.session ?? null;
      const nextLoading = Boolean(parsed.isLoading ?? false);
      const nextRole = parsed.role
        ? normalizeSynchronizedRole(parsed.role)
        : extractFallbackRoleFromUser(nextUser);
      const nextFullName =
        parsed.fullName ?? extractFallbackNameFromUser(nextUser);
      const nextAvatarUrl = parsed.avatarUrl ?? null;

      if (!nextUser && !nextSession && !nextLoading) {
        currentAuthState = DEFAULT_AUTH_STATE;
      } else {
        currentAuthState = {
          user: nextUser,
          session: nextSession,
          role: nextRole,
          fullName: nextFullName,
          avatarUrl: nextAvatarUrl,
          isLoading: nextLoading,
        };
      }
    } else {
      currentAuthState = DEFAULT_AUTH_STATE;
    }
  } catch {
    currentAuthState = DEFAULT_AUTH_STATE;
  }
}

function getAuthSnapshot(): AuthState {
  if (typeof window === 'undefined') return DEFAULT_AUTH_STATE;
  if (!hasInitializedFromStorage) {
    hasInitializedFromStorage = true;
    syncAuthSnapshotFromStorage();
  }
  return currentAuthState;
}

function getAuthServerSnapshot(): AuthState {
  return DEFAULT_AUTH_STATE;
}

function subscribeAuth(callback: () => void): () => void {
  if (typeof window !== 'undefined' && !hasInitializedFromStorage) {
    hasInitializedFromStorage = true;
    syncAuthSnapshotFromStorage();
  }
  authListeners.add(callback);
  const handleStorage = (ev: StorageEvent) => {
    if (ev.key === STORAGE_KEY_AUTH_SESSION || ev.key === null) {
      syncAuthSnapshotFromStorage();
      callback();
    }
  };
  if (typeof window !== 'undefined') {
    window.addEventListener('storage', handleStorage);
  }
  return () => {
    authListeners.delete(callback);
    if (typeof window !== 'undefined') {
      window.removeEventListener('storage', handleStorage);
    }
  };
}

export function setAuthStoreState(
  next: Partial<AuthState> | ((prev: AuthState) => AuthState)
): void {
  const prev = getAuthSnapshot();
  const resolvedRaw: AuthState =
    typeof next === 'function'
      ? next(prev)
      : {
          ...prev,
          ...next,
        };

  const resolved: AuthState = {
    user: resolvedRaw.user ?? null,
    session: resolvedRaw.session ?? null,
    role: resolvedRaw.user
      ? normalizeSynchronizedRole(
          resolvedRaw.role || extractFallbackRoleFromUser(resolvedRaw.user)
        )
      : 'visitor',
    fullName: resolvedRaw.user
      ? (resolvedRaw.fullName ?? extractFallbackNameFromUser(resolvedRaw.user))
      : null,
    avatarUrl: resolvedRaw.user ? (resolvedRaw.avatarUrl ?? null) : null,
    isLoading: Boolean(resolvedRaw.isLoading),
  };

  if (
    prev.user === resolved.user &&
    prev.session === resolved.session &&
    prev.role === resolved.role &&
    prev.fullName === resolved.fullName &&
    prev.avatarUrl === resolved.avatarUrl &&
    prev.isLoading === resolved.isLoading
  ) {
    return;
  }

  currentAuthState =
    !resolved.user && !resolved.session && !resolved.isLoading
      ? DEFAULT_AUTH_STATE
      : resolved;

  if (typeof window !== 'undefined') {
    try {
      if (!resolved.user && !resolved.session) {
        window.localStorage.removeItem(STORAGE_KEY_AUTH_SESSION);
        lastRawAuthSession = null;
      } else {
        const serialized = JSON.stringify({
          user: resolved.user,
          session: resolved.session,
          role: resolved.role,
          fullName: resolved.fullName,
          avatarUrl: resolved.avatarUrl,
          isLoading: false,
        });
        window.localStorage.setItem(STORAGE_KEY_AUTH_SESSION, serialized);
        lastRawAuthSession = serialized;
      }
      hasInitializedFromStorage = true;
    } catch {
      // ignore quota errors
    }
  }
  authListeners.forEach((listener) => listener());
}

/**
 * Fetches the authenticated user's `role` and `full_name` from `public.profiles`
 * and stores them globally in the auth state so RBAC is enforced without redundant fetches.
 */
export async function syncAuthenticatedProfileRole(
  user: User | null,
  session: Session | null,
  forceRefresh = false
): Promise<void> {
  if (!user?.id) {
    setAuthStoreState(DEFAULT_AUTH_STATE);
    return;
  }

  if (!forceRefresh && inflightRoleSyncUserId === user.id) {
    return;
  }

  const fallbackRole = extractFallbackRoleFromUser(user);
  const fallbackName = extractFallbackNameFromUser(user);

  if (!isSupabaseConfigured()) {
    setAuthStoreState((prev) => ({
      ...prev,
      user,
      session,
      role: prev.role !== 'visitor' ? prev.role : fallbackRole,
      fullName: prev.fullName || fallbackName,
      isLoading: false,
    }));
    return;
  }

  inflightRoleSyncUserId = user.id;
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, role, role_type, admin_role, full_name, name, avatar_url')
      .eq('id', user.id)
      .maybeSingle();

    if (!error && data) {
      const row = data as {
        role?: string | null;
        role_type?: string | null;
        admin_role?: string | null;
        full_name?: string | null;
        name?: string | null;
        avatar_url?: string | null;
      };
      const resolvedRole = normalizeSynchronizedRole(
        row.admin_role || row.role || row.role_type || fallbackRole
      );
      const resolvedName =
        (row.full_name || row.name || fallbackName || '').trim() || null;
      const resolvedAvatar = (row.avatar_url || '').trim() || null;

      setAuthStoreState({
        user,
        session,
        role: resolvedRole,
        fullName: resolvedName,
        avatarUrl: resolvedAvatar,
        isLoading: false,
      });
      return;
    }
  } catch {
    // Fallback to user_metadata if profiles query fails
  } finally {
    if (inflightRoleSyncUserId === user.id) {
      inflightRoleSyncUserId = null;
    }
  }

  setAuthStoreState((prev) => ({
    user,
    session,
    role: prev.role !== 'visitor' ? prev.role : fallbackRole,
    fullName: prev.fullName || fallbackName,
    avatarUrl: prev.avatarUrl,
    isLoading: false,
  }));
}

export async function signInWithGoogleOAuth(redirectTo?: string) {
  const redirectUrl =
    redirectTo ||
    (typeof window !== 'undefined'
      ? `${window.location.origin}/onboarding`
      : undefined);

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: redirectUrl ? { redirectTo: redirectUrl } : undefined,
  });

  if (error) {
    throw error;
  }
  return data;
}

export async function signInWithPhoneOtp(phone: string) {
  const cleanedPhone = phone.trim();
  if (!cleanedPhone) {
    throw new Error('Phone number is required.');
  }

  const { data, error } = await supabase.auth.signInWithOtp({
    phone: cleanedPhone,
  });

  if (error) {
    throw error;
  }
  return data;
}

export async function verifyPhoneOtp(phone: string, token: string) {
  const { data, error } = await supabase.auth.verifyOtp({
    phone: phone.trim(),
    token: token.trim(),
    type: 'sms',
  });

  if (error) {
    throw error;
  }

  if (data.session || data.user) {
    setAuthStoreState({
      user: data.user ?? null,
      session: data.session ?? null,
      role: extractFallbackRoleFromUser(data.user ?? null),
      fullName: extractFallbackNameFromUser(data.user ?? null),
      isLoading: false,
    });
    if (data.user) {
      void syncAuthenticatedProfileRole(
        data.user,
        data.session ?? null,
        true
      );
    }
  }
  return data;
}

export async function checkUserNeedsOnboarding(
  userId: string
): Promise<boolean> {
  if (!userId || !isSupabaseConfigured()) return false;
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, role, role_type')
      .eq('id', userId)
      .maybeSingle();

    if (error || !data) return true;
    const record = data as { role?: string | null; role_type?: string | null };
    return !record.role && !record.role_type;
  } catch {
    return false;
  }
}

export interface UseAuthResult extends AuthState {
  setAuthState: (
    next: Partial<AuthState> | ((prev: AuthState) => AuthState)
  ) => void;
  refreshProfileRole: () => Promise<void>;
  signOut: () => Promise<void>;
  signInWithGoogle: (redirectTo?: string) => Promise<unknown>;
  sendPhoneOtp: (phone: string) => Promise<unknown>;
  confirmPhoneOtp: (phone: string, token: string) => Promise<unknown>;
}

/**
 * Persistent authentication state hook synchronized with Supabase auth.onAuthStateChange()
 * and automatic `public.profiles` role & full_name resolution.
 */
export function useAuth(): UseAuthResult {
  const state = useSyncExternalStore(
    subscribeAuth,
    getAuthSnapshot,
    getAuthServerSnapshot
  );

  useEffect(() => {
    if (typeof window === 'undefined') return;

    const handleProfileUpdated = (ev: Event) => {
      const detail = (
        ev as CustomEvent<{
          fullName?: string;
          avatarUrl?: string;
          role?: string;
        }>
      ).detail;
      if (!detail) return;
      const snap = getAuthSnapshot();
      if (snap.user) {
        setAuthStoreState({
          ...snap,
          fullName: detail.fullName || snap.fullName,
          avatarUrl: detail.avatarUrl ?? snap.avatarUrl,
          role: detail.role
            ? normalizeSynchronizedRole(detail.role)
            : snap.role,
        });
      }
    };

    window.addEventListener('printswift:profile-updated', handleProfileUpdated);

    if (!isSupabaseConfigured() || supabaseListenerInitialized) {
      return () => {
        window.removeEventListener(
          'printswift:profile-updated',
          handleProfileUpdated
        );
      };
    }

    supabaseListenerInitialized = true;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (data?.session?.user) {
          setAuthStoreState((prev) => ({
            ...prev,
            user: data.session.user,
            session: data.session,
            isLoading: false,
          }));
          void syncAuthenticatedProfileRole(
            data.session.user,
            data.session,
            true
          );
        }
      })
      .catch(() => {
        // Keep current local auth state on offline/invalid placeholder URL
      });

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (session?.user) {
          setAuthStoreState((prev) => ({
            ...prev,
            user: session.user,
            session,
            isLoading: false,
          }));
          void syncAuthenticatedProfileRole(session.user, session, true);
        } else {
          setAuthStoreState(DEFAULT_AUTH_STATE);
        }
      }
    );

    return () => {
      window.removeEventListener(
        'printswift:profile-updated',
        handleProfileUpdated
      );
      subscription.subscription.unsubscribe();
      supabaseListenerInitialized = false;
    };
  }, []);

  const refreshProfileRole = useCallback(async () => {
    const snap = getAuthSnapshot();
    if (snap.user) {
      await syncAuthenticatedProfileRole(snap.user, snap.session, true);
    }
  }, []);

  const signOut = useCallback(async () => {
    if (isSupabaseConfigured()) {
      try {
        await supabase.auth.signOut();
      } catch {
        // Ignore network error on placeholder credentials and clear local session
      }
    }
    setAuthStoreState(DEFAULT_AUTH_STATE);
  }, []);

  return useMemo(
    () => ({
      user: state.user,
      session: state.session,
      role: state.role,
      fullName: state.fullName,
      avatarUrl: state.avatarUrl,
      isLoading: state.isLoading,
      setAuthState: setAuthStoreState,
      refreshProfileRole,
      signOut,
      signInWithGoogle: signInWithGoogleOAuth,
      sendPhoneOtp: signInWithPhoneOtp,
      confirmPhoneOtp: verifyPhoneOtp,
    }),
    [
      state.user,
      state.session,
      state.role,
      state.fullName,
      state.avatarUrl,
      state.isLoading,
      refreshProfileRole,
      signOut,
    ]
  );
}
