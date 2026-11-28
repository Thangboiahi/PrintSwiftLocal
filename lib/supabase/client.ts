import { createBrowserClient } from '@supabase/ssr';
import type { SupabaseClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

export function isSupabaseConfigured(): boolean {
  return Boolean(
    supabaseUrl &&
      supabaseUrl.trim().length > 0 &&
      supabaseAnonKey &&
      supabaseAnonKey.trim().length > 0
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
    document.cookie = 'sb-access-token=; path=/; max-age=0; SameSite=Lax';
    document.cookie = 'supabase-auth-token=; path=/; max-age=0; SameSite=Lax';
  }
}

let cachedClient: SupabaseClient | null = null;

/**
 * Initializes and returns the singleton browser Supabase client backed by
 * @supabase/ssr HTTP cookies (`sb-<project-ref>-auth-token`), unifying client
 * login/signup/OAuth/refresh/sign-out with middleware.ts and Server Components.
 */
export function getSupabaseClient(): SupabaseClient {
  if (!supabaseUrl || !supabaseAnonKey) {
    const missing: string[] = [];
    if (!supabaseUrl) missing.push('NEXT_PUBLIC_SUPABASE_URL');
    if (!supabaseAnonKey) missing.push('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    const message = `[PrintSwift Supabase Client] Missing required environment variable(s): ${missing.join(
      ', '
    )}. Copy .env.local.example to .env.local and configure your Supabase project credentials.`;
    throw new Error(message);
  }

  if (!cachedClient) {
    cachedClient = createBrowserClient(supabaseUrl, supabaseAnonKey);
  }

  return cachedClient;
}

/**
 * Direct Supabase client export when environment variables are present,
 * or a lazy proxy that throws a descriptive development error when accessed
 * without NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY configured.
 */
export const supabase: SupabaseClient = isSupabaseConfigured()
  ? getSupabaseClient()
  : (new Proxy({} as SupabaseClient, {
      get(_target, prop) {
        const client = getSupabaseClient();
        return Reflect.get(client, prop);
      },
    }) as SupabaseClient);
