'use client';

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';

export const STORAGE_KEY_AUTH_SESSION = 'printswift_local_auth_session_v1';

export interface AuthState {
  user: User | null;
  session: Session | null;
  isLoading: boolean;
}

const DEFAULT_AUTH_STATE: AuthState = {
  user: null,
  session: null,
  isLoading: false,
};

let currentAuthState: AuthState = DEFAULT_AUTH_STATE;
let lastRawAuthSession: string | null = null;
let hasInitializedFromStorage = false;
let supabaseListenerInitialized = false;
const authListeners = new Set<() => void>();

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
      if (!nextUser && !nextSession && !nextLoading) {
        currentAuthState = DEFAULT_AUTH_STATE;
      } else {
        currentAuthState = {
          user: nextUser,
          session: nextSession,
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
  const resolved: AuthState =
    typeof next === 'function'
      ? next(prev)
      : {
          ...prev,
          ...next,
        };

  if (
    prev.user === resolved.user &&
    prev.session === resolved.session &&
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

export interface UseAuthResult extends AuthState {
  setAuthState: (
    next: Partial<AuthState> | ((prev: AuthState) => AuthState)
  ) => void;
  signOut: () => Promise<void>;
}

/**
 * Persistent authentication state hook synchronized with Supabase auth.onAuthStateChange().
 * Defaults to unauthenticated (user: null, session: null, isLoading: false).
 */
export function useAuth(): UseAuthResult {
  const state = useSyncExternalStore(
    subscribeAuth,
    getAuthSnapshot,
    getAuthServerSnapshot
  );

  useEffect(() => {
    if (typeof window === 'undefined' || !isSupabaseConfigured()) return;
    if (supabaseListenerInitialized) return;
    supabaseListenerInitialized = true;

    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (data?.session) {
          setAuthStoreState({
            user: data.session.user ?? null,
            session: data.session,
            isLoading: false,
          });
        }
      })
      .catch(() => {
        // Keep current local auth state on offline/invalid placeholder URL
      });

    const { data: subscription } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setAuthStoreState({
          user: session?.user ?? null,
          session: session ?? null,
          isLoading: false,
        });
      }
    );

    return () => {
      subscription.subscription.unsubscribe();
      supabaseListenerInitialized = false;
    };
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
      isLoading: state.isLoading,
      setAuthState: setAuthStoreState,
      signOut,
    }),
    [state.user, state.session, state.isLoading, signOut]
  );
}
