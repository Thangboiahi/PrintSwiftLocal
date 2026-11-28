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

export interface PublicSupabaseRuntimeConfig {
  url: string;
  anonKey: string;
}

const SUPABASE_PLACEHOLDER_RE =
  /project[-_]?id|supabase[-_]?anon[-_]?key|placeholder/i;

function readPublicString(value: string | undefined): string {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (SUPABASE_PLACEHOLDER_RE.test(trimmed)) {
    return '';
  }
  return trimmed;
}

/**
 * Server-safe runtime resolver for public Supabase browser credentials.
 * Reads dynamic `process.env[key]` so Next.js/webpack never bakes stale build-time
 * placeholders into server-rendered HTML injection.
 * STRICTLY NEVER reads or exposes `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEY`.
 */
export function getPublicSupabaseConfig(): PublicSupabaseRuntimeConfig {
  const envRecord =
    typeof process !== 'undefined' && process.env
      ? (process.env as Record<string, string | undefined>)
      : {};

  const urlCandidates = [
    envRecord['NEXT_PUBLIC_SUPABASE_URL'],
    envRecord['SUPABASE_URL'],
  ];
  let url = '';
  for (const candidate of urlCandidates) {
    const cleaned = readPublicString(candidate);
    if (cleaned && /^https:\/\//i.test(cleaned)) {
      url = cleaned;
      break;
    }
  }

  const keyCandidates = [
    envRecord['NEXT_PUBLIC_SUPABASE_ANON_KEY'],
    envRecord['SUPABASE_ANON_KEY'],
  ];
  let anonKey = '';
  for (const candidate of keyCandidates) {
    const cleaned = readPublicString(candidate);
    if (cleaned) {
      anonKey = cleaned;
      break;
    }
  }

  return { url, anonKey };
}

export function getPublicEnv(): PublicEnvConfig {
  const { url: supabaseUrl, anonKey: supabaseAnonKey } =
    getPublicSupabaseConfig();
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

  if (!env.supabaseUrl) {
    missingWarnings.push('NEXT_PUBLIC_SUPABASE_URL');
  }
  if (!env.supabaseAnonKey) {
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

function isZeroBindHost(host: string | null | undefined): boolean {
  if (!host) return true;
  const cleaned = host.trim().toLowerCase();
  return (
    !cleaned ||
    cleaned === '0.0.0.0' ||
    cleaned.startsWith('0.0.0.0:') ||
    cleaned === '[::]' ||
    cleaned.startsWith('[::]:')
  );
}

function isLocalLoopbackHost(host: string): boolean {
  const hostnameOnly = host.split(':')[0]?.trim().toLowerCase() || '';
  return hostnameOnly === 'localhost' || hostnameOnly === '127.0.0.1';
}

/**
 * Resolves the true external public origin for OAuth and Edge middleware redirects
 * in the exact priority order required by Sprint v24b:
 *   1. `x-forwarded-host` + `x-forwarded-proto` (defaulting proto to `https` when host is not `localhost`/`127.0.0.1`)
 *   2. `host` header (ONLY if it is NOT `0.0.0.0` / `0.0.0.0:*`)
 *   3. `process.env.NEXT_PUBLIC_SITE_URL` / `process.env.VERCEL_URL`
 *   4. Fallback to `new URL(request.url).origin` (replacing `0.0.0.0` with `localhost`)
 */
export function getPublicOrigin(request: Request): string {
  const headers = request.headers;

  // 1. x-forwarded-host + x-forwarded-proto
  const rawForwardedHost = headers.get('x-forwarded-host');
  const forwardedHost = rawForwardedHost
    ? rawForwardedHost.split(',')[0]?.trim() || ''
    : '';
  if (forwardedHost && !isZeroBindHost(forwardedHost)) {
    const rawForwardedProto = headers.get('x-forwarded-proto');
    const forwardedProto = rawForwardedProto
      ? rawForwardedProto.split(',')[0]?.trim().toLowerCase() || ''
      : '';
    const defaultProto = isLocalLoopbackHost(forwardedHost) ? 'http' : 'https';
    const proto =
      forwardedProto === 'http' || forwardedProto === 'https'
        ? forwardedProto
        : defaultProto;
    return `${proto}://${forwardedHost}`;
  }

  // 2. host header (ONLY if NOT 0.0.0.0 / 0.0.0.0:*)
  const rawHost = headers.get('host');
  const hostHeader = rawHost ? rawHost.split(',')[0]?.trim() || '' : '';
  if (hostHeader && !isZeroBindHost(hostHeader)) {
    const rawForwardedProto = headers.get('x-forwarded-proto');
    const forwardedProto = rawForwardedProto
      ? rawForwardedProto.split(',')[0]?.trim().toLowerCase() || ''
      : '';
    let requestProto = '';
    try {
      requestProto = new URL(request.url).protocol.replace(':', '').toLowerCase();
    } catch {
      requestProto = '';
    }
    const defaultProto = isLocalLoopbackHost(hostHeader)
      ? requestProto === 'https'
        ? 'https'
        : 'http'
      : 'https';
    const proto =
      forwardedProto === 'http' || forwardedProto === 'https'
        ? forwardedProto
        : defaultProto;
    return `${proto}://${hostHeader}`;
  }

  // 3. process.env.NEXT_PUBLIC_SITE_URL / process.env.VERCEL_URL
  const envSiteUrl = readPublicString(process.env.NEXT_PUBLIC_SITE_URL);
  if (envSiteUrl) {
    try {
      const normalized = /^https?:\/\//i.test(envSiteUrl)
        ? envSiteUrl
        : `https://${envSiteUrl}`;
      const parsed = new URL(normalized);
      if (!isZeroBindHost(parsed.host)) {
        return parsed.origin;
      }
    } catch {
      // fall through
    }
  }

  const envVercelUrl = readPublicString(process.env.VERCEL_URL);
  if (envVercelUrl) {
    try {
      const normalized = /^https?:\/\//i.test(envVercelUrl)
        ? envVercelUrl
        : `https://${envVercelUrl}`;
      const parsed = new URL(normalized);
      if (!isZeroBindHost(parsed.host)) {
        return parsed.origin;
      }
    } catch {
      // fall through
    }
  }

  // 4. Fallback to new URL(request.url).origin (replacing 0.0.0.0 with localhost)
  try {
    const parsedUrl = new URL(request.url);
    if (
      parsedUrl.hostname === '0.0.0.0' ||
      parsedUrl.hostname === '[::]' ||
      parsedUrl.hostname === '::'
    ) {
      parsedUrl.hostname = 'localhost';
    }
    return parsedUrl.origin;
  } catch {
    return 'http://localhost:3000';
  }
}

/**
 * Detects whether a server request is embedded in an iframe or made cross-site over HTTPS.
 * Matches AI Studio preview iframe and embedded web environments.
 */
export function isEmbeddedHttpsRequest(
  request: Request | { headers: Headers; url?: string; nextUrl?: { protocol?: string } }
): boolean {
  const headers = request.headers;
  const forwardedProto = headers.get('x-forwarded-proto') || '';
  let isHttps = forwardedProto.toLowerCase() === 'https';

  if (!isHttps && 'nextUrl' in request && request.nextUrl?.protocol) {
    isHttps = request.nextUrl.protocol === 'https:';
  } else if (!isHttps && 'url' in request && typeof request.url === 'string') {
    try {
      isHttps = new URL(request.url).protocol === 'https:';
    } catch {
      // ignore
    }
  }

  if (!isHttps) return false;

  const dest = headers.get('sec-fetch-dest');
  const site = headers.get('sec-fetch-site');
  const mode = headers.get('sec-fetch-mode');

  return dest === 'iframe' || site === 'cross-site' || mode === 'nested-navigate';
}
