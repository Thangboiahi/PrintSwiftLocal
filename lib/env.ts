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

const PLACEHOLDER_VALUES = new Set([
  'YOUR_GOOGLE_MAPS_API_KEY',
  'MY_GOOGLE_MAPS_API_KEY',
  'https://your-project-id.supabase.co',
  'your-supabase-anon-key',
]);

function readEnvSnapshot(): Record<string, string | undefined> {
  return {
    NEXT_PUBLIC_GOOGLE_MAPS_API_KEY:
      process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ||
      process.env.VITE_GOOGLE_MAPS_API_KEY ||
      process.env.GOOGLE_MAPS_PLATFORM_KEY ||
      process.env.GOOGLE_MAPS_API_KEY,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  };
}

/**
 * Strictly validates that `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY`, `NEXT_PUBLIC_SUPABASE_URL`,
 * and `NEXT_PUBLIC_SUPABASE_ANON_KEY` are defined and non-empty.
 * Throws a descriptive Error if any required variable is missing.
 */
export function validateEnv(
  source: Record<string, string | undefined> = readEnvSnapshot()
): ValidatedEnvConfig {
  const missing: RequiredPublicEnvKey[] = [];

  for (const key of REQUIRED_PUBLIC_ENV_VARS) {
    const val = source[key]?.trim();
    if (!val || PLACEHOLDER_VALUES.has(val)) {
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

/**
 * Build-time environment gate invoked from next.config.ts.
 * Enforces fatal build termination on deployment/CI builds (Vercel, CI, or STRICT_ENV_CHECK=true)
 * whenever NEXT_PUBLIC_GOOGLE_MAPS_API_KEY, NEXT_PUBLIC_SUPABASE_URL, or
 * NEXT_PUBLIC_SUPABASE_ANON_KEY are missing.
 */
export function enforceBuildEnv(): ValidatedEnvConfig | null {
  const isStrictBuild =
    process.env.VERCEL === '1' ||
    Boolean(process.env.VERCEL_ENV) ||
    process.env.CI === 'true' ||
    process.env.STRICT_ENV_CHECK === 'true';

  if (isStrictBuild) {
    return validateEnv();
  }

  try {
    return validateEnv();
  } catch (err) {
    if (process.env.NODE_ENV === 'production') {
      console.warn(
        `[Build Warning] ${err instanceof Error ? err.message : String(err)}`
      );
    }
    return null;
  }
}
