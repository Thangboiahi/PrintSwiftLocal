import { revalidatePath, revalidateTag } from 'next/cache';
import { NextRequest, NextResponse } from 'next/server';
import {
  createServerSupabaseAdminClient,
  extractSupabaseAccessToken,
} from '@/lib/pick-n-drop/fare';

/**
 * POST /api/admin/revalidate-homepage
 * Super-Admin-only cache invalidation endpoint triggered whenever
 * `homepage_items`, `popular_localities`, `listings.featured_order`,
 * or `vehicle_types` rates are updated from the Homepage Builder.
 */
export async function POST(req: NextRequest) {
  try {
    const token = extractSupabaseAccessToken(req);
    if (!token) {
      return NextResponse.json(
        { error: 'Authentication required.' },
        { status: 401 }
      );
    }

    const supabaseAdmin = createServerSupabaseAdminClient();
    const {
      data: { user },
      error: authError,
    } = await supabaseAdmin.auth.getUser(token);

    if (authError || !user?.id) {
      return NextResponse.json(
        { error: 'Invalid or expired session.' },
        { status: 401 }
      );
    }

    const { data: profile, error: profileErr } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', user.id)
      .maybeSingle();

    if (
      profileErr ||
      String(profile?.role || '').toLowerCase() !== 'super_admin'
    ) {
      return NextResponse.json(
        { error: 'Forbidden: Super Admin access required.' },
        { status: 403 }
      );
    }

    revalidatePath('/');
    revalidateTag('homepage-config');

    return NextResponse.json(
      {
        revalidated: true,
        paths: ['/'],
        tags: ['homepage-config'],
        revalidatedAt: new Date().toISOString(),
      },
      {
        status: 200,
        headers: {
          'Cache-Control': 'no-store, max-age=0',
        },
      }
    );
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : 'Failed to revalidate homepage cache.',
      },
      { status: 500 }
    );
  }
}
