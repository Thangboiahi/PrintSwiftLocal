export const REQUIRED_PUBLIC_ENV_VARS = [
  'NEXT_PUBLIC_GOOGLE_MAPS_API_KEY',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
] as const;

export type RequiredPublicEnvKey = (typeof REQUIRED_PUBLIC_ENV_VARS)[number];

export interface ValidatedEnvConfig {
  NEXT_PUBLIC_GOOGLE_MAPS_API_KEY: string;
  NEXT_PUBLIC_SUPABASE_URL: string;
  NEXT_PUBLIC_SUPABASE_ANON_KEY: string;
}

/**
 * Strictly validates that `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`,
 * and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are defined and non-empty.
 * Throws a descriptive Error if any required variable is missing.
 */
export function validateEnv(
  source: Record<string, string | undefined> = {
    NEXT_PUBLIC_GOOGLE_MAPS_API_KEY:
      process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  }
): ValidatedEnvConfig {
  const missing: RequiredPublicEnvKey[] = [];

  for (const key of REQUIRED_PUBLIC_ENV_VARS) {
    const val = source[key];
    if (!val || !val.trim()) {
      missing.push(key);
    }
  }

  if (missing.length > 0) {
    throw new Error(
      `[PrintSwift Local Environment Security Error] Missing required production environment variable(s): ${missing.join(
        ', '
      )}. Please configure NEXT_PUBLIC_GOOGLE_MAPS_API_KEY, NEXT_PUBLIC_SUPABASE_URL, and NEXT_PUBLIC_SUPABASE_ANON_KEY before deploying to production.`
    );
  }

  return {
    NEXT_PUBLIC_GOOGLE_MAPS_API_KEY:
      source.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY!.trim(),
    NEXT_PUBLIC_SUPABASE_URL: source.NEXT_PUBLIC_SUPABASE_URL!.trim(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: source.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim(),
  };
}
