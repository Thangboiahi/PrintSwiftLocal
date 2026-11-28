import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { getPublicOrigin } from '@/lib/env';

/**
 * Edge Middleware (`middleware.ts`)
 *
 * Refreshes @supabase/ssr auth cookies on `/admin/:path*` and `/workspace/:path*`
 * and short-circuits unauthenticated requests cleanly via `getPublicOrigin(request)`
 * (never redirecting to `0.0.0.0:3000`), while leaving all public routes untouched.
 */
export async function middleware(request: NextRequest) {
  const { pathname, search } = request.nextUrl;

  if (
    !pathname.startsWith('/workspace') &&
    !pathname.startsWith('/admin')
  ) {
    return NextResponse.next();
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();

  // Only enforce cookie short-circuit when Supabase credentials are configured
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.next();
  }

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
    return NextResponse.redirect(loginUrl);
  }

  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  });

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
          cookiesToSet.forEach(({ name, value, options }) => {
            response.cookies.set(name, value, options);
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
        response.cookies.getAll().forEach((c) => {
          redirectRes.cookies.set(c);
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

