import { NextRequest, NextResponse } from 'next/server';
import { getServerSessionContext } from '@/lib/auth-server';
import {
  createServerSupabaseAdminClient,
  extractSupabaseAccessToken,
} from '@/lib/pick-n-drop/fare';

export const dynamic = 'force-dynamic';

export async function POST(req: NextRequest) {
  try {
    const supabaseAdmin = createServerSupabaseAdminClient();
    if (!supabaseAdmin) {
      return NextResponse.json(
        { error: 'Supabase admin client is not configured.' },
        { status: 503 }
      );
    }

    let userId: string | null = null;
    const token = extractSupabaseAccessToken(req);
    if (token) {
      const { data, error } = await supabaseAdmin.auth.getUser(token);
      if (!error && data?.user?.id) {
        userId = data.user.id;
      }
    }
    if (!userId) {
      const sessionCtx = await getServerSessionContext();
      if (sessionCtx.profile?.id) {
        userId = String(sessionCtx.profile.id);
      }
    }

    if (!userId) {
      return NextResponse.json(
        { error: 'Authentication required.' },
        { status: 401 }
      );
    }

    const body = (await req.json().catch(() => null)) as {
      storagePaths?: unknown;
    } | null;

    const rawPaths = Array.isArray(body?.storagePaths)
      ? body!.storagePaths
          .filter((p): p is string => typeof p === 'string')
          .map((p) => p.trim().replace(/^\/+/, ''))
          .filter((p) => p.length > 0 && !p.includes('..'))
      : [];

    if (rawPaths.length === 0) {
      return NextResponse.json({ ok: true, deletedCount: 0 });
    }

    // Verify ownership (uploaded_by = userId AND status = 'pending_attach')
    const { data: ownedAssets, error: queryErr } = await supabaseAdmin
      .from('media_assets')
      .select('id, bucket_id, storage_path')
      .eq('uploaded_by', userId)
      .eq('status', 'pending_attach')
      .in('storage_path', rawPaths);

    if (queryErr) {
      return NextResponse.json(
        { error: queryErr.message || 'Failed to verify temporary media assets.' },
        { status: 400 }
      );
    }

    const rows = Array.isArray(ownedAssets)
      ? (ownedAssets as Array<{
          id: string;
          bucket_id: string | null;
          storage_path: string;
        }>)
      : [];

    if (rows.length === 0) {
      return NextResponse.json({ ok: true, deletedCount: 0 });
    }

    const byBucket = new Map<string, string[]>();
    for (const row of rows) {
      const b = (row.bucket_id || 'media').trim() || 'media';
      if (!byBucket.has(b)) byBucket.set(b, []);
      byBucket.get(b)!.push(row.storage_path);
    }

    let deletedCount = 0;
    for (const [bucket, paths] of byBucket.entries()) {
      const { error: rmErr } = await supabaseAdmin.storage
        .from(bucket)
        .remove(paths);
      if (!rmErr) {
        deletedCount += paths.length;
      }
    }

    await supabaseAdmin
      .from('media_assets')
      .delete()
      .in(
        'id',
        rows.map((r) => r.id)
      );

    return NextResponse.json({
      ok: true,
      deletedCount,
    });
  } catch (err) {
    console.error('[POST /api/media/discard-temp] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Unexpected error while discarding temporary media.' },
      { status: 500 }
    );
  }
}
