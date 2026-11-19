import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import {
  createServerSupabaseAdminClient,
  extractSupabaseAccessToken,
} from '@/lib/pick-n-drop/fare';
import { DELIVERY_PODS_BUCKET } from '@/lib/supabase/storage';

function safeSecretMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

async function isAuthorizedPurgeRequest(req: NextRequest): Promise<{
  authorized: boolean;
  actorId: string | null;
}> {
  const expectedSecret = (
    process.env.PICK_N_DROP_PURGE_SECRET ||
    process.env.CRON_SECRET ||
    ''
  ).trim();

  const headerSecret = (
    req.headers.get('x-cron-secret') ||
    req.headers.get('x-admin-purge-secret') ||
    ''
  ).trim();

  const authHeader = (req.headers.get('authorization') || '').trim();
  const bearerValue = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : '';

  // 1. Cron / Admin secret header match
  if (expectedSecret) {
    if (
      (headerSecret && safeSecretMatch(headerSecret, expectedSecret)) ||
      (bearerValue && safeSecretMatch(bearerValue, expectedSecret))
    ) {
      return { authorized: true, actorId: null };
    }
  }

  // 2. Authenticated admin / super_admin user fallback
  const token = extractSupabaseAccessToken(req);
  if (token) {
    try {
      const supabaseAdmin = createServerSupabaseAdminClient();
      const {
        data: { user },
      } = await supabaseAdmin.auth.getUser(token);
      if (user?.id) {
        const { data: profile } = await supabaseAdmin
          .from('profiles')
          .select('role')
          .eq('id', user.id)
          .maybeSingle();

        const role = String(profile?.role || '').toLowerCase();
        if (role === 'admin' || role === 'super_admin') {
          return { authorized: true, actorId: user.id };
        }
      }
    } catch {
      // fall through to unauthorized
    }
  }

  return { authorized: false, actorId: null };
}

async function runExpiredPodPurge(actorId: string | null) {
  const supabaseAdmin = createServerSupabaseAdminClient();
  const nowIso = new Date().toISOString();

  const { data: dueOrders, error: queryError } = await supabaseAdmin
    .from('delivery_orders')
    .select('id, order_code, pod_storage_path, pod_purge_at')
    .lte('pod_purge_at', nowIso)
    .not('pod_storage_path', 'is', null)
    .limit(200);

  if (queryError) {
    throw new Error(queryError.message);
  }

  const rows = (dueOrders || []).filter(
    (row) =>
      typeof row.pod_storage_path === 'string' &&
      row.pod_storage_path.trim().length > 0
  );

  if (rows.length === 0) {
    return {
      ok: true,
      purged_count: 0,
      purged_order_ids: [] as string[],
      checked_at: nowIso,
    };
  }

  const pathsToDelete = rows.map((row) =>
    String(row.pod_storage_path).trim().replace(/^\/+/, '')
  );

  const { error: removeError } = await supabaseAdmin.storage
    .from(DELIVERY_PODS_BUCKET)
    .remove(pathsToDelete);

  if (removeError) {
    throw new Error(
      `Failed to delete expired POD objects from ${DELIVERY_PODS_BUCKET}: ${removeError.message}`
    );
  }

  const purgedOrderIds = rows.map((row) => String(row.id));

  const { error: updateError } = await supabaseAdmin
    .from('delivery_orders')
    .update({
      pod_storage_path: null,
      updated_at: nowIso,
    })
    .in('id', purgedOrderIds);

  if (updateError) {
    throw new Error(
      `Deleted storage files but failed to null pod_storage_path: ${updateError.message}`
    );
  }

  const auditRows = rows.map((row) => ({
    order_id: String(row.id),
    actor_id: actorId,
    event_type: 'pod_auto_purged',
    payload: {
      order_code: row.order_code,
      purged_path: row.pod_storage_path,
      scheduled_purge_at: row.pod_purge_at,
      purged_at: nowIso,
      bucket: DELIVERY_PODS_BUCKET,
    },
  }));

  await supabaseAdmin.from('delivery_order_events').insert(auditRows);

  return {
    ok: true,
    purged_count: purgedOrderIds.length,
    purged_order_ids: purgedOrderIds,
    checked_at: nowIso,
  };
}

export async function POST(req: NextRequest) {
  try {
    const auth = await isAuthorizedPurgeRequest(req);
    if (!auth.authorized) {
      return NextResponse.json(
        { error: 'Unauthorized: Valid cron/admin purge secret or admin role required.' },
        { status: 401 }
      );
    }

    const result = await runExpiredPodPurge(auth.actorId);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : 'Failed to purge expired delivery POD photos.',
      },
      { status: 500 }
    );
  }
}

export async function GET(req: NextRequest) {
  return POST(req);
}
