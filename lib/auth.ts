'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import type { Session, User } from '@supabase/supabase-js';

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
const authListeners = new Set<() => void>();

function getAuthSnapshot(): AuthState {
  if (typeof window === 'undefined') return DEFAULT_AUTH_STATE;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY_AUTH_SESSION);
    if (!raw) return currentAuthState;
    const parsed = JSON.parse(raw) as Partial<AuthState>;
    if (
      parsed &&
      typeof parsed === 'object' &&
      ('user' in parsed || 'session' in parsed)
    ) {
      if (
        currentAuthState.user !== (parsed.user ?? null) ||
        currentAuthState.session !== (parsed.session ?? null)
      ) {
        currentAuthState = {
          user: parsed.user ?? null,
          session: parsed.session ?? null,
          isLoading: Boolean(parsed.isLoading ?? false),
        };
      }
    }
  } catch {
    // ignore storage read errors and fall back to default unauthenticated state
  }
  return currentAuthState;
}

function getAuthServerSnapshot(): AuthState {
  return DEFAULT_AUTH_STATE;
}

function subscribeAuth(callback: () => void): () => void {
  authListeners.add(callback);
  const handleStorage = (ev: StorageEvent) => {
    if (ev.key === STORAGE_KEY_AUTH_SESSION || ev.key === null) {
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
  currentAuthState = resolved;
  if (typeof window !== 'undefined') {
    try {
      if (!resolved.user && !resolved.session) {
        window.localStorage.removeItem(STORAGE_KEY_AUTH_SESSION);
      } else {
        window.localStorage.setItem(
          STORAGE_KEY_AUTH_SESSION,
          JSON.stringify({
            user: resolved.user,
            session: resolved.session,
            isLoading: false,
          })
        );
      }
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
  signOut: () => void;
}

/**
 * Persistent authentication state hook (defaults to unauthenticated: user: null, session: null, isLoading: false).
 */
export function useAuth(): UseAuthResult {
  const state = useSyncExternalStore(
    subscribeAuth,
    getAuthSnapshot,
    getAuthServerSnapshot
  );

  const signOut = useCallback(() => {
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
