import { NextRequest, NextResponse } from 'next/server';
import {
  createServerSupabaseAdminClient,
  extractSupabaseAccessToken,
} from '@/lib/pick-n-drop/fare';

/**
 * GET /api/admin/payment-env-status
 * Super-Admin-only health indicator returning booleans ONLY for server-side
 * Razorpay environment variables. Never exposes actual secret values.
 */
export async function GET(req: NextRequest) {
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

    if (profileErr || String(profile?.role || '').toLowerCase() !== 'super_admin') {
      return NextResponse.json(
        { error: 'Forbidden: Super Admin access required.' },
        { status: 403 }
      );
    }

    return NextResponse.json(
      {
        hasKeySecret: Boolean((process.env.RAZORPAY_KEY_SECRET || '').trim()),
        hasWebhookSecret: Boolean(
          (process.env.RAZORPAY_WEBHOOK_SECRET || '').trim()
        ),
        hasEnvKeyId: Boolean((process.env.RAZORPAY_KEY_ID || '').trim()),
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
            : 'Failed to inspect payment environment status.',
      },
      { status: 500 }
    );
  }
}
