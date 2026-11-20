import { NextRequest, NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import {
  ACTIVE_HUB_SLUG_COOKIE_NAME,
  PREVIEW_HUB_SLUG_COOKIE_NAME,
  sanitizeViewAsRoleCookie,
} from '@/lib/role-override';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const role = sanitizeViewAsRoleCookie(body?.role);
    const rawHubSlug =
      typeof body?.hubSlug === 'string'
        ? body.hubSlug.trim().toLowerCase()
        : '';
    const validHubSlug = /^[a-z0-9_-]{2,64}$/.test(rawHubSlug)
      ? rawHubSlug
      : null;
    const cookieStore = await cookies();

    if (validHubSlug) {
      cookieStore.set(ACTIVE_HUB_SLUG_COOKIE_NAME, validHubSlug, {
        path: '/',
        maxAge: 60 * 60 * 24 * 7, // 7 days
        sameSite: 'lax',
      });
      cookieStore.set(PREVIEW_HUB_SLUG_COOKIE_NAME, validHubSlug, {
        path: '/',
        maxAge: 60 * 60 * 24 * 7, // 7 days
        sameSite: 'lax',
      });
    }

    if (role) {
      cookieStore.set('view_as_role', role, {
        path: '/',
        maxAge: 60 * 60 * 24 * 7, // 7 days
        sameSite: 'lax',
      });
      return NextResponse.json({
        success: true,
        role,
        hubSlug: validHubSlug,
      });
    } else {
      cookieStore.delete('view_as_role');
      return NextResponse.json({
        success: true,
        role: null,
        hubSlug: validHubSlug,
      });
    }
  } catch (err) {
    return NextResponse.json(
      {
        success: false,
        error:
          err instanceof Error
            ? err.message
            : 'Failed to update view-as role cookie',
      },
      { status: 500 }
    );
  }
}
