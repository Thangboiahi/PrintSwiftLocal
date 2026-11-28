import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

interface RuntimeSupabaseConfig {
  url?: string;
  anonKey?: string;
}

declare global {
  interface Window {
    __DD_SUPABASE_CONFIG__?: RuntimeSupabaseConfig;
  }
}

const PLACEHOLDER_ENV_PATTERN =
  /project[-_]?id|supabase[-_]?anon[-_]?key|placeholder/i;

function readRealValue(value?: string): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed || PLACEHOLDER_ENV_PATTERN.test(trimmed)) return '';
  return trimmed;
}

function readRealUrl(value?: string): string {
  const cleaned = readRealValue(value);
  if (!cleaned || !/^https?:\/\//i.test(cleaned)) return '';
  return cleaned;
}

function resolveSupabaseConfig(): { url: string; anonKey: string } {
  const runtimeConfig =
    typeof window !== 'undefined' ? window.__DD_SUPABASE_CONFIG__ : undefined;

  const url =
    readRealUrl(runtimeConfig?.url) ||
    readRealUrl(process.env.NEXT_PUBLIC_SUPABASE_URL);

  const anonKey =
    readRealValue(runtimeConfig?.anonKey) ||
    readRealValue(process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);

  return { url, anonKey };
}

export function isSupabaseConfigured(): boolean {
  const { url, anonKey } = resolveSupabaseConfig();
  return Boolean(url && anonKey);
}

/**
 * Detects whether the current browser session is running inside an embedded iframe over HTTPS
 * (e.g., inside the Google AI Studio preview frame).
 */
export function isBrowserEmbeddedHttps(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.location.protocol === 'https:' &&
    window.self !== window.top
  );
}

/**
 * Purges legacy localStorage Supabase auth tokens and stale client profile caches
 * so previous accounts can never bleed across sign-ins or conflict with @supabase/ssr cookies.
 */
export function clearLegacySupabaseLocalStorage(): void {
  if (typeof window === 'undefined') return;
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (!key) continue;
      if (
        /^sb-.*-auth-token/.test(key) ||
        key === 'supabase.auth.token' ||
        key === 'printswift_local_auth_session_v1' ||
        key === 'printswift:optimistic-profile'
      ) {
        keysToRemove.push(key);
      }
    }
    for (const key of keysToRemove) {
      window.localStorage.removeItem(key);
    }
  } catch {
    // Ignore private mode / storage errors
  }

  if (typeof document !== 'undefined') {
    const isEmbedded = isBrowserEmbeddedHttps();
    if (isEmbedded) {
      document.cookie =
        'sb-access-token=; path=/; max-age=0; SameSite=None; Secure; Partitioned';
      document.cookie =
        'supabase-auth-token=; path=/; max-age=0; SameSite=None; Secure; Partitioned';
    }
    document.cookie = 'sb-access-token=; path=/; max-age=0; SameSite=Lax';
    document.cookie = 'supabase-auth-token=; path=/; max-age=0; SameSite=Lax';
  }
}

let cachedClient: SupabaseClient | null = null;
let cachedConfigKey = '';
let cachedIsBrowser = false;
let hasWarnedMissingConfig = false;

function createSafeMockBuilder(): unknown {
  const mockPromise = Promise.resolve({ data: [], error: null, count: 0 });
  const handler: ProxyHandler<object> = {
    get(_target, prop) {
      if (prop === 'then') {
        return mockPromise.then.bind(mockPromise);
      }
      if (prop === 'catch') {
        return mockPromise.catch.bind(mockPromise);
      }
      if (prop === 'finally') {
        return mockPromise.finally.bind(mockPromise);
      }
      return () => new Proxy({}, handler);
    },
  };
  return new Proxy({}, handler);
}

function getSafeMockProperty(prop: string | symbol): unknown {
  if (prop === 'from') {
    return () => createSafeMockBuilder();
  }
  if (prop === 'auth') {
    return {
      getUser: async () => ({ data: { user: null }, error: null }),
      getSession: async () => ({ data: { session: null }, error: null }),
      onAuthStateChange: () => ({
        data: { subscription: { unsubscribe: () => {} } },
      }),
      signOut: async () => ({ error: null }),
    };
  }
  if (prop === 'channel') {
    return () => ({
      on: () => ({ subscribe: () => {} }),
      subscribe: () => {},
    });
  }
  if (prop === 'removeChannel') {
    return async () => {};
  }
  if (prop === 'rpc') {
    return async () => ({ data: null, error: null });
  }
  return undefined;
}

/**
 * Lazily initializes and returns the singleton browser Supabase client backed by
 * @supabase/ssr HTTP cookies (`sb-<project-ref>-auth-token`), reading runtime-injected
 * `window.__DD_SUPABASE_CONFIG__` first so deployed containers always use live Secrets.
 */
export function getSupabaseClient(): SupabaseClient {
  const { url, anonKey } = resolveSupabaseConfig();

  if (!url || !anonKey) {
    const missing: string[] = [];
    if (!url) missing.push('NEXT_PUBLIC_SUPABASE_URL');
    if (!anonKey) missing.push('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    const message = `[DD oodle Supabase Client] Missing required Supabase config: ${missing.join(
      ', '
    )}. Configure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY in environment secrets.`;
    if (!hasWarnedMissingConfig) {
      hasWarnedMissingConfig = true;
      console.warn(message);
    }
    throw new Error(message);
  }

  const isBrowser = typeof window !== 'undefined';
  const isEmbeddedHttps = isBrowserEmbeddedHttps();
  const nextKey = `${url}|${anonKey}|${isBrowser ? 'browser' : 'server'}|${isEmbeddedHttps ? 'embedded' : 'direct'}`;
  if (
    !cachedClient ||
    cachedConfigKey !== nextKey ||
    (isBrowser && !cachedIsBrowser)
  ) {
    cachedClient = createBrowserClient(url, anonKey, {
      cookieOptions: {
        path: '/',
        sameSite: isEmbeddedHttps ? 'none' : 'lax',
        secure:
          isEmbeddedHttps ||
          (typeof window !== 'undefined' &&
            window.location.protocol === 'https:'),
        ...(isEmbeddedHttps ? { partitioned: true } : {}),
        httpOnly: false,
      } as Record<string, unknown>,
      cookies: {
        getAll() {
          if (typeof document === 'undefined') return [];
          return document.cookie
            .split(';')
            .map((c) => c.trim())
            .filter(Boolean)
            .map((pair) => {
              const eqIdx = pair.indexOf('=');
              if (eqIdx === -1) {
                return { name: pair, value: '' };
              }
              return {
                name: pair.slice(0, eqIdx).trim(),
                value: pair.slice(eqIdx + 1).trim(),
              };
            });
        },
        setAll(cookiesToSet) {
          if (typeof document === 'undefined') return;
          for (const { name, value, options } of cookiesToSet) {
            let cookieStr = `${name}=${value}; Path=${options?.path || '/'}`;
            if (options?.maxAge !== undefined) {
              cookieStr += `; Max-Age=${options.maxAge}`;
            } else if (options?.expires) {
              const expDate =
                typeof options.expires === 'number'
                  ? new Date(options.expires)
                  : options.expires;
              cookieStr += `; Expires=${expDate.toUTCString()}`;
            }
            if (options?.domain) {
              cookieStr += `; Domain=${options.domain}`;
            }
            if (isEmbeddedHttps) {
              cookieStr += '; SameSite=None; Secure; Partitioned';
            } else {
              const sameSiteVal = options?.sameSite
                ? String(options.sameSite).charAt(0).toUpperCase() +
                  String(options.sameSite).slice(1)
                : 'Lax';
              cookieStr += `; SameSite=${sameSiteVal}`;
              if (
                options?.secure ||
                (typeof window !== 'undefined' &&
                  window.location.protocol === 'https:')
              ) {
                cookieStr += '; Secure';
              }
            }
            document.cookie = cookieStr;

            if (
              isEmbeddedHttps &&
              (options?.maxAge === 0 ||
                (options?.expires &&
                  new Date(options.expires).getTime() <= Date.now()))
            ) {
              document.cookie = `${name}=; Path=${options?.path || '/'}; Max-Age=0; SameSite=Lax`;
            }
          }
        },
      },
    });
    cachedConfigKey = nextKey;
    cachedIsBrowser = isBrowser;
  }

  return cachedClient;
}

/**
 * Lazy proxy so the browser Supabase client is always initialized on first access
 * AFTER `window.__DD_SUPABASE_CONFIG__` has been injected by `app/layout.tsx`.
 * If Supabase is not configured, logs a single warning and safely returns mock no-op
 * responses instead of crashing or querying a placeholder domain.
 */
export const supabase: SupabaseClient = new Proxy({} as SupabaseClient, {
  get(_target, prop) {
    if (!isSupabaseConfigured()) {
      if (!hasWarnedMissingConfig) {
        hasWarnedMissingConfig = true;
        console.warn(
          '[DD oodle Supabase Client] Supabase is not configured or waiting for runtime config. Mock fallback active.'
        );
      }
      const mockVal = getSafeMockProperty(prop);
      if (mockVal !== undefined) return mockVal;
    }
    const client = getSupabaseClient();
    const value = Reflect.get(client, prop, client);
    return typeof value === 'function' ? value.bind(client) : value;
  },
}) as SupabaseClient;
