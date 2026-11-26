/**
 * Phase 44 Production Environment Guard (`lib/env.ts`)
 *
 * Provides safe, typed access to public browser-scoped environment variables
 * and non-fatal build/runtime warnings when required production keys are unset.
 *
 * SECURITY BOUNDARY:
 * - Strictly reads ONLY `NEXT_PUBLIC_*` variables in this shared module so
 *   server secrets (SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, RAZORPAY_KEY_SECRET)
 *   are NEVER referenced or bundled into client chunks.
 * - Demo auth (`NEXT_PUBLIC_ENABLE_DEMO_AUTH`) is strict opt-in (`=== 'true'`);
 *   disabled and hidden by default in all environments unless explicitly opted in.
 */

export interface PublicEnvConfig {
  supabaseUrl: string;
  supabaseAnonKey: string;
  googleMapsApiKey: string;
  enableDemoAuth: boolean;
  isProduction: boolean;
}

export interface PublicEnvAuditResult {
  configured: {
    supabase: boolean;
    googleMaps: boolean;
    demoAuth: boolean;
  };
  missingWarnings: string[];
}

function readPublicString(value: string | undefined): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function getPublicEnv(): PublicEnvConfig {
  const supabaseUrl = readPublicString(process.env.NEXT_PUBLIC_SUPABASE_URL);
  const supabaseAnonKey = readPublicString(
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
  const googleMapsApiKey = readPublicString(
    process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY
  );
  // Phase 44 Demo Auth Lock: strict opt-in only ('true')
  const enableDemoAuth =
    readPublicString(process.env.NEXT_PUBLIC_ENABLE_DEMO_AUTH) === 'true';

  return {
    supabaseUrl,
    supabaseAnonKey,
    googleMapsApiKey,
    enableDemoAuth,
    isProduction: process.env.NODE_ENV === 'production',
  };
}

/**
 * Strict opt-in check for Demo Auth shortcuts.
 * Returns `true` ONLY when `NEXT_PUBLIC_ENABLE_DEMO_AUTH === 'true'`.
 */
export function isDemoAuthEnabled(): boolean {
  return getPublicEnv().enableDemoAuth;
}

let hasWarnedMissingEnv = false;

/**
 * Validates required public environment variables and emits a single
 * non-breaking warning if any are missing (without breaking preview builds).
 */
export function auditPublicEnv(options?: { warn?: boolean }): PublicEnvAuditResult {
  const env = getPublicEnv();
  const missingWarnings: string[] = [];

  if (!env.supabaseUrl || env.supabaseUrl.includes('your-project-id')) {
    missingWarnings.push('NEXT_PUBLIC_SUPABASE_URL');
  }
  if (!env.supabaseAnonKey || env.supabaseAnonKey.includes('your-supabase-anon-key')) {
    missingWarnings.push('NEXT_PUBLIC_SUPABASE_ANON_KEY');
  }
  if (
    !env.googleMapsApiKey ||
    env.googleMapsApiKey === 'YOUR_GOOGLE_MAPS_API_KEY'
  ) {
    missingWarnings.push('NEXT_PUBLIC_GOOGLE_MAPS_API_KEY');
  }

  if (options?.warn !== false && missingWarnings.length > 0 && !hasWarnedMissingEnv) {
    hasWarnedMissingEnv = true;
    if (typeof console !== 'undefined' && typeof console.warn === 'function') {
      console.warn(
        `[DD oodle Env Guard] Missing or placeholder public env var(s): ${missingWarnings.join(
          ', '
        )}. Preview fallbacks remain active; configure these before production deployment.`
      );
    }
  }

  return {
    configured: {
      supabase: Boolean(env.supabaseUrl && env.supabaseAnonKey),
      googleMaps: Boolean(
        env.googleMapsApiKey &&
          env.googleMapsApiKey !== 'YOUR_GOOGLE_MAPS_API_KEY'
      ),
      demoAuth: env.enableDemoAuth,
    },
    missingWarnings,
  };
}

/**
 * Invoked by `next.config.ts` at startup/build time to audit public environment
 * variables without crashing local preview or CI builds.
 */
export function enforceBuildEnv(): PublicEnvAuditResult {
  return auditPublicEnv({ warn: true });
}

/**
 * Validates that a `next` redirect parameter is a strictly relative internal path.
 * Blocks protocol-relative (`//evil.com`), backslash (`/\evil.com`), and absolute URLs.
 */
export function sanitizeRelativeNextPath(
  rawNext: string | null | undefined,
  fallback = '/'
): string {
  if (!rawNext || typeof rawNext !== 'string') return fallback;
  const trimmed = rawNext.trim();
  if (!trimmed.startsWith('/')) return fallback;
  if (trimmed.startsWith('//') || trimmed.startsWith('/\\')) return fallback;
  if (/^\/[a-zA-Z][a-zA-Z0-9+.-]*:/.test(trimmed)) return fallback;
  return trimmed;
}

