import { NextRequest, NextResponse } from 'next/server';
import { getServerSessionContext } from '@/lib/auth-server';
import {
  createServerSupabaseAdminClient,
  extractSupabaseAccessToken,
} from '@/lib/pick-n-drop/fare';

async function isAuthorizedMediaSweeper(req: NextRequest): Promise<boolean> {
  const cronSecret = (process.env.CRON_SECRET || '').trim();
  const authHeader = req.headers.get('authorization') || '';
  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    return true;
  }

  try {
    const supabaseAdmin = createServerSupabaseAdminClient();
    const token = extractSupabaseAccessToken(req);

    let userId: string | null = null;
    if (token) {
      const { data } = await supabaseAdmin.auth.getUser(token);
      if (data?.user?.id) userId = data.user.id;
    }

    if (!userId) {
      const ctx = await getServerSessionContext();
      if (ctx.profile?.id) userId = String(ctx.profile.id);
    }

    if (!userId) return false;

    const { data: profile } = await supabaseAdmin
      .from('profiles')
      .select('role')
      .eq('id', userId)
      .maybeSingle();

    return String(profile?.role || '').trim().toLowerCase() === 'super_admin';
  } catch {
    return false;
  }
}

/**
 * POST /api/system/purge-media
 * Unified Zero-Orphan Media Sweeper authorized via CRON_SECRET or Super-Admin.
 * Removes expired 24h drafts, expired ephemeral TTL files, and marked_for_deletion
 * assets from Supabase Storage, plus cleans up expired print files & delivery PODs.
 */
export async function POST(req: NextRequest) {
  try {
    const authorized = await isAuthorizedMediaSweeper(req);
    if (!authorized) {
      return NextResponse.json(
        { error: 'Forbidden: CRON_SECRET or Super-Admin session required.' },
        { status: 403 }
      );
    }

    const supabaseAdmin = createServerSupabaseAdminClient();
    const nowIso = new Date().toISOString();

    const { data: candidates, error: queryErr } = await supabaseAdmin
      .from('media_assets')
      .select('id, bucket_id, storage_path, file_size_bytes, status, retention_class, expires_at')
      .or(
        `and(status.eq.pending_attach,expires_at.lt.${nowIso}),and(retention_class.eq.ephemeral_ttl,status.eq.active,expires_at.lt.${nowIso}),and(status.eq.marked_for_deletion,expires_at.is.null),and(status.eq.marked_for_deletion,expires_at.lt.${nowIso})`
      )
      .limit(250);

    if (queryErr) {
      return NextResponse.json(
        { error: queryErr.message || 'Failed to query media_assets.' },
        { status: 500 }
      );
    }

    const rows = (candidates || []) as Array<{
      id: string;
      bucket_id: string;
      storage_path: string;
      file_size_bytes: number;
    }>;

    // Group by bucket_id for batched Storage deletion
    const byBucket = new Map<string, typeof rows>();
    for (const row of rows) {
      const bucket = row.bucket_id || 'media';
      const list = byBucket.get(bucket) || [];
      list.push(row);
      byBucket.set(bucket, list);
    }

    let purgedCount = 0;
    let bytesReclaimed = 0;
    const failedPaths: string[] = [];

    for (const [bucketId, bucketRows] of byBucket.entries()) {
      const paths = bucketRows.map((r) => r.storage_path).filter(Boolean);
      if (paths.length === 0) continue;

      const { error: rmErr } = await supabaseAdmin.storage
        .from(bucketId)
        .remove(paths);

      if (rmErr) {
        // Storage file might already be missing; still mark failed only on hard transport errors
        const isNotFound = /not found|no such/i.test(rmErr.message || '');
        if (!isNotFound) {
          failedPaths.push(...paths);
          continue;
        }
      }

      const ids = bucketRows.map((r) => r.id);
      const { error: upErr } = await supabaseAdmin
        .from('media_assets')
        .update({
          status: 'purged',
          purged_at: nowIso,
          updated_at: nowIso,
        })
        .in('id', ids);

      if (!upErr) {
        purgedCount += bucketRows.length;
        for (const r of bucketRows) {
          bytesReclaimed += Number(r.file_size_bytes || 0);
        }
      } else {
        failedPaths.push(...paths);
      }
    }

    // Also sweep expired Print 48h vault files & Pick N Drop PODs cleanly
    let printFilesPurged = 0;
    let deliveryPodsPurged = 0;

    try {
      const { data: expiredPrintOrders } = await supabaseAdmin
        .from('print_orders')
        .select('id')
        .eq('purge_status', 'scheduled')
        .lt('purge_scheduled_at', nowIso)
        .limit(50);

      const pOrderIds = (expiredPrintOrders || []).map((r) => String(r.id));
      if (pOrderIds.length > 0) {
        const { data: pFiles } = await supabaseAdmin
          .from('print_order_files')
          .select('id, storage_path')
          .in('print_order_id', pOrderIds)
          .neq('purge_status', 'purged');

        const pPaths = (pFiles || [])
          .map((f) => String(f.storage_path || ''))
          .filter(Boolean);
        if (pPaths.length > 0) {
          await supabaseAdmin.storage.from('print-vault').remove(pPaths);
          await supabaseAdmin
            .from('print_order_files')
            .update({ purge_status: 'purged' })
            .in(
              'id',
              (pFiles || []).map((f) => f.id)
            );
          printFilesPurged = pPaths.length;
        }

        await supabaseAdmin
          .from('print_orders')
          .update({ purge_status: 'purged', files_purged_at: nowIso })
          .in('id', pOrderIds);
      }
    } catch {
      // Non-fatal print vault sweep
    }

    try {
      const { data: expiredPods } = await supabaseAdmin
        .from('delivery_orders')
        .select('id, pod_storage_path')
        .not('pod_storage_path', 'is', null)
        .lt('pod_purge_at', nowIso)
        .limit(50);

      const podRows = (expiredPods || []) as Array<{
        id: string;
        pod_storage_path: string;
      }>;
      if (podRows.length > 0) {
        const podPaths = podRows.map((p) => p.pod_storage_path).filter(Boolean);
        await supabaseAdmin.storage.from('delivery-pods').remove(podPaths);
        await supabaseAdmin
          .from('delivery_orders')
          .update({ pod_storage_path: null })
          .in(
            'id',
            podRows.map((p) => p.id)
          );
        deliveryPodsPurged = podRows.length;
      }
    } catch {
      // Non-fatal POD sweep
    }

    return NextResponse.json({
      ok: true,
      purgedCount: purgedCount + printFilesPurged + deliveryPodsPurged,
      mediaAssetsPurged: purgedCount,
      printFilesPurged,
      deliveryPodsPurged,
      bytesReclaimed,
      failedPaths,
      sweptAt: nowIso,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : 'Unexpected error during media sweep.',
      },
      { status: 500 }
    );
  }
}
