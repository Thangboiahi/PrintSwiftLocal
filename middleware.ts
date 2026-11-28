import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import {
  getPublicOrigin,
  getPublicSupabaseConfig,
  isEmbeddedHttpsRequest,
} from '@/lib/env';

/**
 * Edge Middleware (`middleware.ts`)
 *
 * Refreshes @supabase/ssr auth cookies on `/admin/:path*` and `/workspace/:path*`
 * and short-circuits unauthenticated requests cleanly via `getPublicOrigin(request)`
 * (never redirecting to `0.0.0.0:3000`), while leaving all public routes untouched.
 *
 * Inside embedded HTTPS preview frames (e.g. AI Studio), mints partitioned cross-site
 * cookies (`SameSite=None; Secure; Partitioned`) so auth state persists without 3P cookie blocking.
 */
export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (
    !pathname.startsWith('/workspace') &&
    !pathname.startsWith('/admin')
  ) {
    return NextResponse.next();
  }

  const isEmbedded = isEmbeddedHttpsRequest(request);
  const { url: publicUrl, anonKey: publicAnonKey } = getPublicSupabaseConfig();
  const supabaseUrl = publicUrl || process.env.SUPABASE_URL || '';
  const supabaseAnonKey = publicAnonKey || process.env.SUPABASE_ANON_KEY || '';

  // Only enforce cookie short-circuit when Supabase credentials are configured
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.next();
  }

  const applyFrameHeaders = (res: NextResponse) => {
    res.headers.delete('x-frame-options');
    res.headers.set(
      'Content-Security-Policy',
      "frame-ancestors 'self' https://aistudio.google.com https://*.google.com http://localhost:*;"
    );
    return res;
  };

  const allCookies = request.cookies.getAll();
  const hasAuthCookie = allCookies.some(
    (c) =>
      Boolean(c.value && c.value.trim()) &&
      (c.name === 'sb-access-token' ||
        c.name === 'supabase-auth-token' ||
        /^sb-.*-auth-token(\.\d+)?$/.test(c.name))
  );

  if (!hasAuthCookie) {
    const publicOrigin = getPublicOrigin(request);
    const loginUrl = new URL('/login', publicOrigin);
    const nextTarget = `${pathname}${search || ''}`;
    loginUrl.searchParams.set('next', nextTarget);
    const redirectRes = NextResponse.redirect(loginUrl);
    return applyFrameHeaders(redirectRes);
  }

  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });
  applyFrameHeaders(response);

  try {
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => {
            request.cookies.set(name, value);
          });
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          });
          applyFrameHeaders(response);
          cookiesToSet.forEach(({ name, value, options }) => {
            const finalOptions = isEmbedded
              ? {
                  ...options,
                  path: options?.path || '/',
                  sameSite: 'none' as const,
                  secure: true,
                  partitioned: true,
                  httpOnly: false,
                }
              : {
                  ...options,
                  path: options?.path || '/',
                  sameSite: (options?.sameSite as 'lax' | 'none' | 'strict') || 'lax',
                  secure: options?.secure ?? false,
                  httpOnly: false,
                };
            response.cookies.set(name, value, finalOptions);
          });
        },
      },
    });

    // Race session refresh against a 3.5s safety cap so edge middleware never hangs
    const userResult = await Promise.race([
      supabase.auth.getUser(),
      new Promise<{ data: { user: null }; timedOut: true }>((resolve) =>
        setTimeout(() => resolve({ data: { user: null }, timedOut: true }), 3500)
      ),
    ]);

    if ('timedOut' in userResult) {
      return response;
    }

    if (!userResult.data?.user) {
      const hasLegacyToken = allCookies.some(
        (c) =>
          Boolean(c.value && c.value.trim()) &&
          (c.name === 'sb-access-token' || c.name === 'supabase-auth-token')
      );
      if (!hasLegacyToken) {
        const publicOrigin = getPublicOrigin(request);
        const loginUrl = new URL('/login', publicOrigin);
        const nextTarget = `${pathname}${search || ''}`;
        loginUrl.searchParams.set('next', nextTarget);
        const redirectRes = NextResponse.redirect(loginUrl);
        applyFrameHeaders(redirectRes);
        response.cookies.getAll().forEach((c) => {
          const finalOptions = isEmbedded
            ? {
                ...c,
                sameSite: 'none' as const,
                secure: true,
                partitioned: true,
                httpOnly: false,
              }
            : {
                ...c,
                sameSite: (c.sameSite as 'lax' | 'none' | 'strict') || 'lax',
                secure: c.secure ?? false,
                httpOnly: false,
              };
          redirectRes.cookies.set(finalOptions);
        });
        return redirectRes;
      }
    }
  } catch {
    // Non-fatal fallback: let Server Component workspace-guard verify auth
  }

  return response;
}

export const config = {
  matcher: ['/admin/:path*', '/workspace/:path*'],
};

