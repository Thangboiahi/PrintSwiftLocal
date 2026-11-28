import { NextRequest, NextResponse } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import {
  getPublicEnv,
  getPublicOrigin,
  sanitizeRelativeNextPath,
} from '@/lib/env';

/**
 * Server-Side OAuth PKCE Callback (`GET /auth/callback`)
 *
 * 1. Resolves true external origin via `getPublicOrigin(request)` so redirects NEVER target `0.0.0.0:3000`.
 * 2. Exchanges `code` for a Supabase session via `@supabase/ssr` `createServerClient`,
 *    capturing all Set-Cookie mutations so they persist cleanly across the redirect.
 * 3. Checks `public.profiles.onboarding_completed_at`:
 *    - Existing onboarded account (`onboarding_completed_at IS NOT NULL`): merges Google metadata seamlessly
 *      and redirects straight to `<safeNext>` (default `/`) without prompting for password.
 *    - Brand-new Google user (`onboarding_completed_at IS NULL` and `identities` only has `google` / no `email` identity):
 *      redirects to `/onboarding?oauth=google&next=<safeNext>` so Step 1 includes Set Account Password + full profile setup.
 * 4. On missing code, OAuth error, or exchange failure -> `/login?error=oauth`.
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const publicOrigin = getPublicOrigin(request);
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
      const profileErrUrl = new URL('/profile/edit', publicOrigin);
      profileErrUrl.searchParams.set('auth_error', errCode);
      return profileErrUrl;
    }
    const loginErrUrl = new URL('/login', publicOrigin);
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

    const authedUser = sessionData.user;
    let destinationPath = safeNext;

    // Ensure profile row exists and merge Google metadata without overwriting existing role or user edits
    try {
      const meta = (authedUser.user_metadata || {}) as Record<string, unknown>;
      const googleName =
        String(
          meta.full_name ||
            meta.name ||
            authedUser.email?.split('@')[0] ||
            'DD oodle Member'
        ).trim() || 'DD oodle Member';
      const googleAvatar =
        typeof meta.avatar_url === 'string' && meta.avatar_url.trim()
          ? meta.avatar_url.trim()
          : typeof meta.picture === 'string' && meta.picture.trim()
            ? meta.picture.trim()
            : null;

      const { data: profileRow } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', authedUser.id)
        .maybeSingle();

      if (!profileRow) {
        await supabase.from('profiles').insert({
          id: authedUser.id,
          email: authedUser.email ?? null,
          full_name: googleName,
          avatar_url: googleAvatar,
        });
      } else {
        const existingRow = profileRow as Record<string, unknown>;
        const patch: Record<string, unknown> = {};
        if (
          (!existingRow.full_name ||
            String(existingRow.full_name).trim() === '') &&
          googleName
        ) {
          patch.full_name = googleName;
        }
        if (
          (!existingRow.avatar_url ||
            String(existingRow.avatar_url).trim() === '') &&
          googleAvatar
        ) {
          patch.avatar_url = googleAvatar;
        }
        if (Object.keys(patch).length > 0) {
          patch.updated_at = new Date().toISOString();
          await supabase.from('profiles').update(patch).eq('id', authedUser.id);
        }
      }

      const completedAt =
        profileRow &&
        typeof (profileRow as { onboarding_completed_at?: unknown })
          .onboarding_completed_at === 'string' &&
        (profileRow as { onboarding_completed_at: string }).onboarding_completed_at.trim()
          ? (profileRow as { onboarding_completed_at: string })
              .onboarding_completed_at
          : null;

      const identities = Array.isArray(authedUser.identities)
        ? authedUser.identities
        : [];
      const hasEmailIdentity = identities.some(
        (id) => String(id?.provider || '').toLowerCase() === 'email'
      );
      const hasGoogleIdentity =
        identities.some(
          (id) => String(id?.provider || '').toLowerCase() === 'google'
        ) ||
        String(
          (authedUser.app_metadata as Record<string, unknown> | undefined)
            ?.provider || ''
        ).toLowerCase() === 'google';
      const passwordAlreadySet = Boolean(meta.password_set === true);
      const isGoogleOnlyNewAccount =
        hasGoogleIdentity && !hasEmailIdentity && !passwordAlreadySet;

      if (
        !completedAt &&
        !safeNext.startsWith('/onboarding') &&
        !safeNext.startsWith('/profile/edit')
      ) {
        const onboardingUrl = new URL('/onboarding', publicOrigin);
        if (isGoogleOnlyNewAccount) {
          onboardingUrl.searchParams.set('oauth', 'google');
        }
        if (safeNext && safeNext !== '/') {
          onboardingUrl.searchParams.set('next', safeNext);
        }
        destinationPath = `${onboardingUrl.pathname}${onboardingUrl.search}`;
      } else if (safeNext.startsWith('/profile/edit')) {
        const linkedUrl = new URL(safeNext, publicOrigin);
        linkedUrl.searchParams.set('auth_linked', 'google');
        destinationPath = `${linkedUrl.pathname}${linkedUrl.search}`;
      }
    } catch {
      // Keep safeNext if profile lookup fails transiently
    }

    const redirectResponse = NextResponse.redirect(
      new URL(destinationPath, publicOrigin)
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

