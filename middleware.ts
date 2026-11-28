import { NextRequest, NextResponse } from 'next/server';

/**
 * Edge Middleware (`middleware.ts`)
 *
 * Short-circuits unauthenticated requests to `/admin/:path*` and `/workspace/:path*`
 * at the edge before route rendering or workspace chunk evaluation, while leaving all
 * public routes (`/`, `/explore`, `/marketplace`, `/bulletin`, `/vehicles`, `/civic`,
 * `/bookings`, `/guides`, `/listing/*`, `/about`, `/contact`, `/login`, `/signup`,
 * `/auth/callback`) fast and untouched.
 */
export function middleware(request: NextRequest) {
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
    const loginUrl = new URL('/login', request.url);
    const nextTarget = `${pathname}${search || ''}`;
    loginUrl.searchParams.set('next', nextTarget);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*', '/workspace/:path*'],
};
