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
  const oauthErrorDesc = url.searchParams.get('error_description') || '';
  const safeNext = sanitizeRelativeNextPath(url.searchParams.get('next'), '/');

  const mapOAuthErrorCode = (rawErr?: string | null, desc = ''): string => {
    const combined = `${rawErr || ''} ${desc}`.toLowerCase();
    if (combined.includes('access_denied')) return 'access_denied';
    if (
      combined.includes('identity_already_exists') ||
      combined.includes('already linked') ||
      combined.includes('already exists')
    ) {
      return 'identity_conflict';
    }
    return 'oauth';
  };

  const buildErrorRedirect = (errCode: string) => {
    if (safeNext.startsWith('/profile/edit')) {
      const profileErrUrl = new URL('/profile/edit', url.origin);
      profileErrUrl.searchParams.set('auth_error', errCode);
      return profileErrUrl;
    }
    const loginErrUrl = new URL('/login', url.origin);
    loginErrUrl.searchParams.set('error', errCode);
    if (safeNext && safeNext !== '/') {
      loginErrUrl.searchParams.set('next', safeNext);
    }
    return loginErrUrl;
  };

  if (oauthError || !code) {
    return NextResponse.redirect(
      buildErrorRedirect(mapOAuthErrorCode(oauthError, oauthErrorDesc))
    );
  }

  const { supabaseUrl, supabaseAnonKey } = getPublicEnv();
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.redirect(buildErrorRedirect('oauth'));
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
      return NextResponse.redirect(
        buildErrorRedirect(
          mapOAuthErrorCode(exchangeError?.code, exchangeError?.message || '')
        )
      );
    }

    let destinationPath = safeNext;

    // Ensure profile row exists without overwriting existing role or user edits
    try {
      const { data: profileRow } = await supabase
        .from('profiles')
        .select('id, onboarding_completed_at')
        .eq('id', sessionData.user.id)
        .maybeSingle();

      if (!profileRow) {
        const meta = (sessionData.user.user_metadata || {}) as Record<
          string,
          unknown
        >;
        const fallbackName =
          String(
            meta.full_name ||
              meta.name ||
              sessionData.user.email?.split('@')[0] ||
              'DD oodle Member'
          ).trim() || 'DD oodle Member';
        const fallbackAvatar =
          typeof meta.avatar_url === 'string'
            ? meta.avatar_url
            : typeof meta.picture === 'string'
              ? meta.picture
              : null;

        await supabase.from('profiles').insert({
          id: sessionData.user.id,
          email: sessionData.user.email ?? null,
          full_name: fallbackName,
          avatar_url: fallbackAvatar,
        });
      }

      const completedAt =
        profileRow &&
        typeof (profileRow as { onboarding_completed_at?: unknown })
          .onboarding_completed_at === 'string'
          ? (profileRow as { onboarding_completed_at: string })
              .onboarding_completed_at
          : null;

      if (
        !completedAt &&
        !safeNext.startsWith('/onboarding') &&
        !safeNext.startsWith('/profile/edit')
      ) {
        const onboardingUrl = new URL('/onboarding', url.origin);
        if (safeNext && safeNext !== '/') {
          onboardingUrl.searchParams.set('next', safeNext);
        }
        destinationPath = `${onboardingUrl.pathname}${onboardingUrl.search}`;
      } else if (safeNext.startsWith('/profile/edit')) {
        const linkedUrl = new URL(safeNext, url.origin);
        linkedUrl.searchParams.set('auth_linked', 'google');
        destinationPath = `${linkedUrl.pathname}${linkedUrl.search}`;
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
    return NextResponse.redirect(buildErrorRedirect('oauth'));
  }
}
