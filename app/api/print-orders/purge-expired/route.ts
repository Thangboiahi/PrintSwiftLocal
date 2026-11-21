import { timingSafeEqual } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';
import { createServerSupabaseAdminClient } from '@/lib/pick-n-drop/fare';
import { authenticatePrintRequest } from '@/lib/print-orders/server-helpers';
import { PRINT_DOCUMENTS_BUCKET } from '@/lib/print-orders/types';

function safeSecretMatch(provided: string, expected: string): boolean {
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length || a.length === 0) return false;
  return timingSafeEqual(a, b);
}

async function authorizePurgeCaller(req: NextRequest): Promise<{
  authorized: boolean;
  actorId: string | null;
  actorRole: string;
}> {
  const expectedSecret = (
    process.env.CRON_SECRET ||
    process.env.PRINT_PURGE_SECRET ||
    ''
  ).trim();

  const headerSecret = (
    req.headers.get('x-cron-secret') ||
    req.headers.get('x-print-purge-secret') ||
    ''
  ).trim();

  const authHeader = (req.headers.get('authorization') || '').trim();
  const bearerValue = authHeader.toLowerCase().startsWith('bearer ')
    ? authHeader.slice(7).trim()
    : '';

  // 1. CRON_SECRET header or Bearer match
  if (expectedSecret) {
    if (
      (headerSecret && safeSecretMatch(headerSecret, expectedSecret)) ||
      (bearerValue && safeSecretMatch(bearerValue, expectedSecret))
    ) {
      return { authorized: true, actorId: null, actorRole: 'cron_purge' };
    }
  }

  // 2. Super-Admin session fallback
  const actor = await authenticatePrintRequest(req);
  if (actor && actor.actualRole === 'super_admin') {
    return {
      authorized: true,
      actorId: actor.userId,
      actorRole: 'super_admin',
    };
  }

  return { authorized: false, actorId: null, actorRole: 'unauthorized' };
}

async function executeExpiredPrintPurge(
  actorId: string | null,
  actorRole: string
) {
  const supabaseAdmin = createServerSupabaseAdminClient();
  const nowIso = new Date().toISOString();
  const staleDraftCutoffIso = new Date(
    Date.now() - 24 * 60 * 60 * 1000
  ).toISOString();

  // Query 1: Post-collection / cancelled orders scheduled for purge (48h window elapsed)
  // Query 2: Abandoned draft orders older than 24 hours
  const [scheduledRes, staleDraftsRes] = await Promise.all([
    supabaseAdmin
      .from('print_orders')
      .select('id, order_code, fulfillment_status, purge_status, purge_scheduled_at')
      .eq('purge_status', 'scheduled')
      .lte('purge_scheduled_at', nowIso)
      .limit(200),
    supabaseAdmin
      .from('print_orders')
      .select('id, order_code, fulfillment_status, purge_status, created_at')
      .eq('fulfillment_status', 'draft')
      .neq('purge_status', 'purged')
      .lte('created_at', staleDraftCutoffIso)
      .limit(200),
  ]);

  if (scheduledRes.error) {
    throw new Error(
      `Failed to query scheduled print purges: ${scheduledRes.error.message}`
    );
  }
  if (staleDraftsRes.error) {
    throw new Error(
      `Failed to query stale draft print orders: ${staleDraftsRes.error.message}`
    );
  }

  const orderMap = new Map<
    string,
    {
      id: string;
      order_code: string;
      reason: 'scheduled_48h_purge' | 'stale_24h_draft';
      wasDraft: boolean;
    }
  >();

  for (const row of scheduledRes.data || []) {
    const id = String(row.id);
    orderMap.set(id, {
      id,
      order_code: String(row.order_code || ''),
      reason: 'scheduled_48h_purge',
      wasDraft: String(row.fulfillment_status) === 'draft',
    });
  }

  for (const row of staleDraftsRes.data || []) {
    const id = String(row.id);
    if (!orderMap.has(id)) {
      orderMap.set(id, {
        id,
        order_code: String(row.order_code || ''),
        reason: 'stale_24h_draft',
        wasDraft: true,
      });
    }
  }

  const targetOrderIds = Array.from(orderMap.keys());
  if (targetOrderIds.length === 0) {
    return {
      ok: true,
      purged_orders_count: 0,
      purged_files_count: 0,
      purged_order_ids: [] as string[],
      checked_at: nowIso,
    };
  }

  const { data: activeFiles, error: filesErr } = await supabaseAdmin
    .from('print_order_files')
    .select('id, print_order_id, storage_object_key')
    .in('print_order_id', targetOrderIds)
    .eq('purge_status', 'active');

  if (filesErr) {
    throw new Error(
      `Failed to query print_order_files for purge: ${filesErr.message}`
    );
  }

  const fileRows = activeFiles || [];
  const storageKeys = fileRows
    .map((f) => String(f.storage_object_key || '').trim().replace(/^\/+/, ''))
    .filter(Boolean);

  // Delete binary objects from private `print-documents` bucket in batches of 100
  const REMOVE_BATCH_SIZE = 100;
  for (let i = 0; i < storageKeys.length; i += REMOVE_BATCH_SIZE) {
    const chunk = storageKeys.slice(i, i + REMOVE_BATCH_SIZE);
    const { error: removeErr } = await supabaseAdmin.storage
      .from(PRINT_DOCUMENTS_BUCKET)
      .remove(chunk);

    if (removeErr) {
      throw new Error(
        `Failed to delete objects from ${PRINT_DOCUMENTS_BUCKET}: ${removeErr.message}`
      );
    }
  }

  const purgedFileIds = fileRows.map((f) => String(f.id));
  if (purgedFileIds.length > 0) {
    const { error: fileUpdateErr } = await supabaseAdmin
      .from('print_order_files')
      .update({
        purge_status: 'purged',
        purged_at: nowIso,
      })
      .in('id', purgedFileIds);

    if (fileUpdateErr) {
      throw new Error(
        `Deleted vault binaries but failed to update print_order_files: ${fileUpdateErr.message}`
      );
    }
  }

  // Update print_orders purge flags
  const { error: ordersUpdateErr } = await supabaseAdmin
    .from('print_orders')
    .update({
      purge_status: 'purged',
      files_purged_at: nowIso,
      updated_at: nowIso,
    })
    .in('id', targetOrderIds);

  if (ordersUpdateErr) {
    throw new Error(
      `Failed to mark print_orders as purged: ${ordersUpdateErr.message}`
    );
  }

  // Cancel stale abandoned 24h drafts so they do not linger in active draft state
  const staleDraftIds = Array.from(orderMap.values())
    .filter((o) => o.reason === 'stale_24h_draft' && o.wasDraft)
    .map((o) => o.id);

  if (staleDraftIds.length > 0) {
    await supabaseAdmin
      .from('print_orders')
      .update({
        fulfillment_status: 'cancelled',
        updated_at: nowIso,
      })
      .in('id', staleDraftIds)
      .eq('fulfillment_status', 'draft');
  }

  // Group purged file count per order for immutable audit events
  const fileCountByOrder = new Map<string, number>();
  for (const f of fileRows) {
    const oid = String(f.print_order_id);
    fileCountByOrder.set(oid, (fileCountByOrder.get(oid) || 0) + 1);
  }

  const eventRows = Array.from(orderMap.values()).map((entry) => ({
    print_order_id: entry.id,
    actor_id: actorId,
    actor_role: actorRole,
    event_type: 'files_purged',
    metadata: {
      order_code: entry.order_code,
      reason: entry.reason,
      purged_files_count: fileCountByOrder.get(entry.id) || 0,
      bucket: PRINT_DOCUMENTS_BUCKET,
      purged_at: nowIso,
    },
  }));

  await supabaseAdmin.from('print_order_events').insert(eventRows);

  return {
    ok: true,
    purged_orders_count: targetOrderIds.length,
    purged_files_count: purgedFileIds.length,
    purged_order_ids: targetOrderIds,
    checked_at: nowIso,
  };
}

export async function POST(req: NextRequest) {
  try {
    const auth = await authorizePurgeCaller(req);
    if (!auth.authorized) {
      return NextResponse.json(
        {
          error:
            'Unauthorized: Valid CRON_SECRET header or super_admin session required.',
        },
        { status: 401 }
      );
    }

    const result = await executeExpiredPrintPurge(auth.actorId, auth.actorRole);
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error:
          err instanceof Error
            ? err.message
            : 'Failed to purge expired print documents.',
      },
      { status: 500 }
    );
  }
}

async function fetchVaultPurgeStats() {
  const supabaseAdmin = createServerSupabaseAdminClient();
  const nowIso = new Date().toISOString();
  const staleDraftCutoffIso = new Date(
    Date.now() - 24 * 60 * 60 * 1000
  ).toISOString();

  const [
    activeFilesRes,
    purgedFilesRes,
    scheduledOrdersRes,
    overdueScheduledOrdersRes,
    staleDraftOrdersRes,
    purgedOrdersRes,
  ] = await Promise.all([
    supabaseAdmin
      .from('print_order_files')
      .select('id', { count: 'exact', head: true })
      .eq('purge_status', 'active'),
    supabaseAdmin
      .from('print_order_files')
      .select('id', { count: 'exact', head: true })
      .eq('purge_status', 'purged'),
    supabaseAdmin
      .from('print_orders')
      .select('id')
      .eq('purge_status', 'scheduled')
      .gt('purge_scheduled_at', nowIso)
      .limit(500),
    supabaseAdmin
      .from('print_orders')
      .select('id')
      .eq('purge_status', 'scheduled')
      .lte('purge_scheduled_at', nowIso)
      .limit(500),
    supabaseAdmin
      .from('print_orders')
      .select('id')
      .eq('fulfillment_status', 'draft')
      .neq('purge_status', 'purged')
      .lte('created_at', staleDraftCutoffIso)
      .limit(500),
    supabaseAdmin
      .from('print_orders')
      .select('id', { count: 'exact', head: true })
      .eq('purge_status', 'purged'),
  ]);

  const scheduledOrderIds = (scheduledOrdersRes.data || []).map((r) =>
    String(r.id)
  );
  const overdueOrderIds = Array.from(
    new Set([
      ...(overdueScheduledOrdersRes.data || []).map((r) => String(r.id)),
      ...(staleDraftOrdersRes.data || []).map((r) => String(r.id)),
    ])
  );

  let scheduledFilesCount = 0;
  let overdueFilesCount = 0;

  if (scheduledOrderIds.length > 0) {
    const { count } = await supabaseAdmin
      .from('print_order_files')
      .select('id', { count: 'exact', head: true })
      .in('print_order_id', scheduledOrderIds)
      .eq('purge_status', 'active');
    scheduledFilesCount = Number(count || 0);
  }

  if (overdueOrderIds.length > 0) {
    const { count } = await supabaseAdmin
      .from('print_order_files')
      .select('id', { count: 'exact', head: true })
      .in('print_order_id', overdueOrderIds)
      .eq('purge_status', 'active');
    overdueFilesCount = Number(count || 0);
  }

  return {
    ok: true,
    active_files_count: Number(activeFilesRes.count || 0),
    scheduled_files_count: scheduledFilesCount,
    scheduled_orders_count: scheduledOrderIds.length,
    overdue_purge_orders_count: overdueOrderIds.length,
    overdue_purge_files_count: overdueFilesCount,
    permanently_purged_files_count: Number(purgedFilesRes.count || 0),
    permanently_purged_orders_count: Number(purgedOrdersRes.count || 0),
    checked_at: nowIso,
  };
}

export async function GET(req: NextRequest) {
  if (req.nextUrl.searchParams.get('stats') === '1') {
    try {
      const auth = await authorizePurgeCaller(req);
      if (!auth.authorized) {
        return NextResponse.json(
          {
            error:
              'Unauthorized: Valid CRON_SECRET header or super_admin session required.',
          },
          { status: 401 }
        );
      }
      const stats = await fetchVaultPurgeStats();
      return NextResponse.json(stats);
    } catch (err) {
      return NextResponse.json(
        {
          ok: false,
          error:
            err instanceof Error
              ? err.message
              : 'Failed to load vault purge stats.',
        },
        { status: 500 }
      );
    }
  }
  return POST(req);
}
