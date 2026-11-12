import { createClient, SupabaseClient } from '@supabase/supabase-js';

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

let cachedClient: SupabaseClient | null = null;

/**
 * Initializes and returns the singleton Supabase client.
 * Throws a helpful error in development if NEXT_PUBLIC_SUPABASE_URL or
 * NEXT_PUBLIC_SUPABASE_ANON_KEY are missing or undefined.
 */
export function getSupabaseClient(): SupabaseClient {
  if (!supabaseUrl || !supabaseAnonKey) {
    const missing: string[] = [];
    if (!supabaseUrl) missing.push('NEXT_PUBLIC_SUPABASE_URL');
    if (!supabaseAnonKey) missing.push('NEXT_PUBLIC_SUPABASE_ANON_KEY');
    const message = `[PrintSwift Supabase Client] Missing required environment variable(s): ${missing.join(
      ', '
    )}. Copy .env.local.example to .env.local and configure your Supabase project credentials.`;
    if (process.env.NODE_ENV === 'development') {
      throw new Error(message);
    }
    throw new Error(message);
  }

  if (!cachedClient) {
    cachedClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    });
  }

  return cachedClient;
}

/**
 * Direct Supabase client export when environment variables are present,
 * or a lazy proxy that throws a descriptive development error when accessed
 * without NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY configured.
 */
export const supabase: SupabaseClient = isSupabaseConfigured()
  ? createClient(supabaseUrl!, supabaseAnonKey!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
    })
  : (new Proxy({} as SupabaseClient, {
      get(_target, prop) {
        const client = getSupabaseClient();
        return Reflect.get(client, prop);
      },
    }) as SupabaseClient);
