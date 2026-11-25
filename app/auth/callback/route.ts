import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import { getPublicEnv, sanitizeRelativeNextPath } from '@/lib/env';

/**
 * Server-Side OAuth PKCE Callback (`GET /auth/callback`)
 *
 * 1. Reads `code` and validates `next` as a strictly relative internal path.
 * 2. Exchanges `code` for a Supabase session via `@supabase/ssr` `createServerClient`,
 *    capturing all Set-Cookie mutations so they persist cleanly across the redirect.
 * 3. Checks `public.profiles.onboarding_completed_at`:
 *    - New / incomplete users -> `/onboarding?next=<safeNext>`
 *    - Returning users -> `<safeNext>` (default `/`)
 * 4. On missing code, OAuth error, or exchange failure -> `/login?error=oauth`.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const oauthError = url.searchParams.get('error');
  const safeNext = sanitizeRelativeNextPath(url.searchParams.get('next'), '/');

  const loginErrorUrl = new URL('/login', url.origin);
  loginErrorUrl.searchParams.set('error', 'oauth');
  if (safeNext && safeNext !== '/') {
    loginErrorUrl.searchParams.set('next', safeNext);
  }

  if (oauthError || !code) {
    return NextResponse.redirect(loginErrorUrl);
  }

  const { supabaseUrl, supabaseAnonKey } = getPublicEnv();
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.redirect(loginErrorUrl);
  }

  const pendingCookies: Array<{
    name: string;
    value: string;
    options?: Record<string, unknown>;
  }> = [];

  try {
    const supabase = createServerClient(supabaseUrl, supabaseAnonKey, {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const cookie of cookiesToSet) {
            pendingCookies.push({
              name: cookie.name,
              value: cookie.value,
              options: cookie.options as Record<string, unknown> | undefined,
            });
          }
        },
      },
    });

    const { data: sessionData, error: exchangeError } =
      await supabase.auth.exchangeCodeForSession(code);

    if (exchangeError || !sessionData?.user) {
      return NextResponse.redirect(loginErrorUrl);
    }

    let destinationPath = safeNext;

    // Check onboarding_completed_at for the authenticated user
    try {
      const { data: profileRow } = await supabase
        .from('profiles')
        .select('onboarding_completed_at')
        .eq('id', sessionData.user.id)
        .maybeSingle();

      const completedAt =
        profileRow &&
        typeof (profileRow as { onboarding_completed_at?: unknown })
          .onboarding_completed_at === 'string'
          ? (profileRow as { onboarding_completed_at: string })
              .onboarding_completed_at
          : null;

      if (!completedAt && !safeNext.startsWith('/onboarding')) {
        const onboardingUrl = new URL('/onboarding', url.origin);
        if (safeNext && safeNext !== '/') {
          onboardingUrl.searchParams.set('next', safeNext);
        }
        destinationPath = `${onboardingUrl.pathname}${onboardingUrl.search}`;
      }
    } catch {
      // Keep safeNext if profile lookup fails transiently
    }

    const redirectResponse = NextResponse.redirect(
      new URL(destinationPath, url.origin)
    );

    for (const cookie of pendingCookies) {
      redirectResponse.cookies.set(
        cookie.name,
        cookie.value,
        cookie.options as Parameters<typeof redirectResponse.cookies.set>[2]
      );
    }

    return redirectResponse;
  } catch {
    return NextResponse.redirect(loginErrorUrl);
  }
}
