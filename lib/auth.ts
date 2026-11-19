'use client';

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { resolveInitialRole } from '@/lib/validators';
import {
  applyEffectiveRoleToProfile,
  isSuperUserRole,
  resolveEffectiveRoleValue,
  sanitizeViewAsRoleCookie,
} from '@/lib/role-override';
import { parseMapSettings } from '@/lib/map-settings';

export const STORAGE_KEY_AUTH_SESSION = 'printswift_local_auth_session_v1';

export type UserRole =
  | 'visitor'
  | 'driver'
  | 'staff'
  | 'owner'
  | 'admin'
  | 'super_admin';

export type SynchronizedRole =
  | 'visitor'
  | 'driver'
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
  'driver',
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

let serverViewAsRoleOverride: string | null = null;

export function setServerViewAsRoleOverride(role?: string | null): void {
  serverViewAsRoleOverride = sanitizeViewAsRoleCookie(role);
}

export function getViewAsRoleCookie(): string | null {
  if (typeof document !== 'undefined') {
    const match = document.cookie
      .split('; ')
      .find((row) => row.startsWith('view_as_role='));
    if (match) {
      return sanitizeViewAsRoleCookie(
        decodeURIComponent(match.split('=')[1] || '')
      );
    }
  }
  return serverViewAsRoleOverride;
}

export function getEffectiveRoleWithOverride(
  realRole: string
): SynchronizedRole {
  const normalizedReal = normalizeSynchronizedRole(realRole);
  const cookieOverride = getViewAsRoleCookie();
  return normalizeSynchronizedRole(
    resolveEffectiveRoleValue(normalizedReal, cookieOverride)
  );
}

export interface AuthState {
  user: User | null;
  session: Session | null;
  role: SynchronizedRole;
  realRole: SynchronizedRole;
  actual_role: SynchronizedRole;
  effective_role: SynchronizedRole;
  fullName: string | null;
  avatarUrl: string | null;
  isLoading: boolean;
}

const DEFAULT_AUTH_STATE: AuthState = {
  user: null,
  session: null,
  role: 'visitor',
  realRole: 'visitor',
  actual_role: 'visitor',
  effective_role: 'visitor',
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
  if (!user) return 'visitor';
  const initialRole = resolveInitialRole(user.email);
  if (initialRole === 'super_admin') {
    return 'super_admin';
  }
  if (!user.user_metadata) return initialRole;
  const meta = user.user_metadata;
  return normalizeSynchronizedRole(
    meta.admin_role || meta.role || meta.role_type || initialRole
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
      const hardcodedRole = resolveInitialRole(
        nextUser?.email ?? nextSession?.user?.email
      );
      const resolvedRealRole: SynchronizedRole =
        hardcodedRole === 'super_admin'
          ? 'super_admin'
          : parsed.actual_role
            ? normalizeSynchronizedRole(parsed.actual_role)
            : parsed.realRole
              ? normalizeSynchronizedRole(parsed.realRole)
              : parsed.role
                ? normalizeSynchronizedRole(parsed.role)
                : extractFallbackRoleFromUser(nextUser);

      const effectiveRole = getEffectiveRoleWithOverride(resolvedRealRole);
      const nextFullName =
        parsed.fullName ?? extractFallbackNameFromUser(nextUser);
      const nextAvatarUrl = parsed.avatarUrl ?? null;

      if (!nextUser && !nextSession && !nextLoading) {
        currentAuthState = DEFAULT_AUTH_STATE;
      } else {
        currentAuthState = {
          user: nextUser,
          session: nextSession,
          role: effectiveRole,
          realRole: resolvedRealRole,
          actual_role: resolvedRealRole,
          effective_role: effectiveRole,
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

  const activeEmail =
    resolvedRaw.user?.email ?? resolvedRaw.session?.user?.email ?? null;
  const initialEmailRole = resolveInitialRole(activeEmail);

  const computedRealRole: SynchronizedRole = resolvedRaw.user
    ? initialEmailRole === 'super_admin'
      ? 'super_admin'
      : normalizeSynchronizedRole(
          resolvedRaw.actual_role ||
            resolvedRaw.realRole ||
            resolvedRaw.role ||
            extractFallbackRoleFromUser(resolvedRaw.user)
        )
    : 'visitor';

  const effectiveRole: SynchronizedRole = resolvedRaw.user
    ? getEffectiveRoleWithOverride(computedRealRole)
    : 'visitor';

  const resolved: AuthState = {
    user: resolvedRaw.user ?? null,
    session: resolvedRaw.session ?? null,
    role: effectiveRole,
    realRole: computedRealRole,
    actual_role: computedRealRole,
    effective_role: effectiveRole,
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
    prev.realRole === resolved.realRole &&
    prev.effective_role === resolved.effective_role &&
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
          role: resolved.effective_role,
          realRole: resolved.realRole,
          actual_role: resolved.actual_role,
          effective_role: resolved.effective_role,
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
 * Fetches the authenticated user's `role`, `full_name`, and `map_settings` from `public.profiles`
 * and stores them globally in the auth state with `view_as_role` cookie override applied.
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

  const initialRoleFromEmail = resolveInitialRole(
    session?.user?.email || user.email
  );
  const fallbackRole =
    initialRoleFromEmail === 'super_admin'
      ? 'super_admin'
      : extractFallbackRoleFromUser(user);
  const fallbackName = extractFallbackNameFromUser(user);

  if (!isSupabaseConfigured()) {
    setAuthStoreState((prev) => {
      const realRole =
        initialRoleFromEmail === 'super_admin'
          ? 'super_admin'
          : prev.realRole !== 'visitor'
            ? prev.realRole
            : fallbackRole;
      const effectiveRole = getEffectiveRoleWithOverride(realRole);
      return {
        ...prev,
        user,
        session,
        role: effectiveRole,
        realRole,
        actual_role: realRole,
        effective_role: effectiveRole,
        fullName: prev.fullName || fallbackName,
        isLoading: false,
      };
    });
    return;
  }

  inflightRoleSyncUserId = user.id;
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select(
        'id, role, role_type, admin_role, full_name, name, avatar_url, map_settings'
      )
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
        map_settings?: unknown;
      };
      const actualRole: SynchronizedRole =
        initialRoleFromEmail === 'super_admin'
          ? 'super_admin'
          : normalizeSynchronizedRole(
              row.admin_role ||
                row.role ||
                row.role_type ||
                fallbackRole ||
                initialRoleFromEmail
            );

      const viewAsCookie = getViewAsRoleCookie();
      const canOverride = ['super_admin', 'admin', 'owner'].includes(actualRole);
      const effectiveRole: SynchronizedRole =
        canOverride && viewAsCookie
          ? normalizeSynchronizedRole(
              resolveEffectiveRoleValue(actualRole, viewAsCookie)
            )
          : actualRole;

      const enrichedProfile = {
        ...row,
        actual_role: actualRole,
        effective_role: effectiveRole,
        role: effectiveRole,
      };

      const resolvedName =
        (enrichedProfile.full_name || enrichedProfile.name || fallbackName || '').trim() ||
        null;
      const resolvedAvatar = (enrichedProfile.avatar_url || '').trim() || null;

      // Sync persisted profile map_settings to local state if configured
      const remoteMapSettings = parseMapSettings(enrichedProfile.map_settings);
      if (remoteMapSettings?.configured && typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(
            'printswift_local_custom_default_center_v1',
            JSON.stringify({
              lat: remoteMapSettings.lat,
              lng: remoteMapSettings.lng,
            })
          );
          window.dispatchEvent(
            new CustomEvent('printswift:map-settings-updated', {
              detail: remoteMapSettings,
            })
          );
        } catch {
          // ignore storage errors
        }
      }

      setAuthStoreState({
        user,
        session,
        role: enrichedProfile.role,
        realRole: enrichedProfile.actual_role,
        actual_role: enrichedProfile.actual_role,
        effective_role: enrichedProfile.effective_role,
        fullName: resolvedName,
        avatarUrl: resolvedAvatar,
        isLoading: false,
      });
      return;
    }
  } catch {
    // Fallback to resolveInitialRole(session.user.email) / user_metadata if profiles query fails
  } finally {
    if (inflightRoleSyncUserId === user.id) {
      inflightRoleSyncUserId = null;
    }
  }

  setAuthStoreState((prev) => {
    const realRole =
      initialRoleFromEmail === 'super_admin'
        ? 'super_admin'
        : prev.realRole !== 'visitor'
          ? prev.realRole
          : fallbackRole;
    const effectiveRole = getEffectiveRoleWithOverride(realRole);
    return {
      user,
      session,
      role: effectiveRole,
      realRole,
      actual_role: realRole,
      effective_role: effectiveRole,
      fullName: prev.fullName || fallbackName,
      avatarUrl: prev.avatarUrl,
      isLoading: false,
    };
  });
}

export async function checkUserNeedsOnboarding(
  userId: string
): Promise<boolean> {
  if (!userId || !isSupabaseConfigured()) return false;
  try {
    const { data, error } = await supabase
      .from('profiles')
      .select('id, role, role_type, full_name')
      .eq('id', userId)
      .maybeSingle();

    if (error || !data) return true;
    const record = data as {
      role?: string | null;
      role_type?: string | null;
      full_name?: string | null;
    };
    return !record.role && !record.role_type && !record.full_name;
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
}

/**
 * Persistent authentication state hook synchronized with Supabase auth.onAuthStateChange()
 * and automatic `public.profiles` effective_role & full_name resolution.
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
        const emailRole = resolveInitialRole(snap.user.email);
        const realRole =
          emailRole === 'super_admin'
            ? 'super_admin'
            : detail.role
              ? normalizeSynchronizedRole(detail.role)
              : snap.realRole;
        const effectiveRole = getEffectiveRoleWithOverride(realRole);
        setAuthStoreState({
          ...snap,
          fullName: detail.fullName || snap.fullName,
          avatarUrl: detail.avatarUrl ?? snap.avatarUrl,
          realRole,
          role: effectiveRole,
          effective_role: effectiveRole,
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
          const initialRole = resolveInitialRole(data.session.user.email);
          setAuthStoreState((prev) => {
            const realRole =
              initialRole === 'super_admin' ? 'super_admin' : prev.realRole;
            const effectiveRole = normalizeSynchronizedRole(
              resolveEffectiveRoleValue(realRole, getViewAsRoleCookie())
            );
            return {
              ...prev,
              user: data.session.user,
              session: data.session,
              realRole,
              actual_role: realRole,
              role: effectiveRole,
              effective_role: effectiveRole,
              isLoading: false,
            };
          });
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
          const initialRole = resolveInitialRole(session.user.email);
          setAuthStoreState((prev) => {
            const realRole =
              initialRole === 'super_admin' ? 'super_admin' : prev.realRole;
            const effectiveRole = normalizeSynchronizedRole(
              resolveEffectiveRoleValue(realRole, getViewAsRoleCookie())
            );
            return {
              ...prev,
              user: session.user,
              session,
              realRole,
              actual_role: realRole,
              role: effectiveRole,
              effective_role: effectiveRole,
              isLoading: false,
            };
          });
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

  return useMemo(() => {
    const activeEffectiveRole = state.user
      ? getEffectiveRoleWithOverride(state.realRole || state.role)
      : 'visitor';
    return {
      user: state.user,
      session: state.session,
      role: activeEffectiveRole,
      realRole: state.realRole,
      actual_role: state.realRole,
      effective_role: activeEffectiveRole,
      fullName: state.fullName,
      avatarUrl: state.avatarUrl,
      isLoading: state.isLoading,
      setAuthState: setAuthStoreState,
      refreshProfileRole,
      signOut,
    };
  }, [
    state.user,
    state.session,
    state.role,
    state.realRole,
    state.fullName,
    state.avatarUrl,
    state.isLoading,
    refreshProfileRole,
    signOut,
  ]);
}
