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
  // v21a (P0-26): Vercel Cron always sends `Authorization: Bearer $CRON_SECRET`, so accept
  // CRON_SECRET even when a dedicated PICK_N_DROP_PURGE_SECRET is also configured.
  const expectedSecrets = [
    process.env.PICK_N_DROP_PURGE_SECRET,
    process.env.CRON_SECRET,
  ]
    .map((v) => (v || '').trim())
    .filter(Boolean);

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
  for (const expectedSecret of expectedSecrets) {
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

  // v21a (P0-26): never purge POD evidence while a dispute is open, and cover scheduled
  // vehicle_bookings PODs as well as Pick N Drop delivery_orders.
  const [ordersRes, bookingsRes] = await Promise.all([
    supabaseAdmin
      .from('delivery_orders')
      .select('id, order_code, pod_storage_path, pod_purge_at, status')
      .lte('pod_purge_at', nowIso)
      .not('pod_storage_path', 'is', null)
      .neq('status', 'disputed')
      .limit(200),
    supabaseAdmin
      .from('vehicle_bookings')
      .select('id, booking_code, pod_storage_path, pod_purge_at, status, escrow_status')
      .lte('pod_purge_at', nowIso)
      .not('pod_storage_path', 'is', null)
      .neq('status', 'disputed')
      .limit(200),
  ]);

  if (ordersRes.error) {
    throw new Error(ordersRes.error.message);
  }
  if (bookingsRes.error) {
    throw new Error(bookingsRes.error.message);
  }

  const orderRows = (ordersRes.data || []).filter(
    (row) =>
      typeof row.pod_storage_path === 'string' &&
      row.pod_storage_path.trim().length > 0
  );
  const bookingRows = (bookingsRes.data || []).filter(
    (row) =>
      typeof row.pod_storage_path === 'string' &&
      row.pod_storage_path.trim().length > 0 &&
      row.escrow_status !== 'frozen_dispute'
  );

  if (orderRows.length === 0 && bookingRows.length === 0) {
    return {
      ok: true,
      purged_count: 0,
      purged_order_ids: [] as string[],
      purged_booking_ids: [] as string[],
      checked_at: nowIso,
    };
  }

  const pathsToDelete = [...orderRows, ...bookingRows].map((row) =>
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

  const purgedOrderIds = orderRows.map((row) => String(row.id));
  const purgedBookingIds = bookingRows.map((row) => String(row.id));

  if (purgedOrderIds.length > 0) {
    const { error: updateError } = await supabaseAdmin
      .from('delivery_orders')
      .update({
        pod_storage_path: null,
        pod_purged_at: nowIso,
        updated_at: nowIso,
      })
      .in('id', purgedOrderIds);

    if (updateError) {
      throw new Error(
        `Deleted storage files but failed to null delivery_orders.pod_storage_path: ${updateError.message}`
      );
    }

    const auditRows = orderRows.map((row) => ({
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
  }

  if (purgedBookingIds.length > 0) {
    const { error: bookingUpdateError } = await supabaseAdmin
      .from('vehicle_bookings')
      .update({
        pod_storage_path: null,
        pod_purged_at: nowIso,
        updated_at: nowIso,
      })
      .in('id', purgedBookingIds);

    if (bookingUpdateError) {
      throw new Error(
        `Deleted storage files but failed to null vehicle_bookings.pod_storage_path: ${bookingUpdateError.message}`
      );
    }

    // Canonical immutable audit trail (exact live audit_logs columns)
    await supabaseAdmin.from('audit_logs').insert(
      bookingRows.map((row) => ({
        actor_id: actorId,
        actor_name: actorId ? null : 'POD Purge Cron',
        actor_role: actorId ? 'admin' : 'system',
        workspace: 'system',
        action: 'vehicle_booking_pod_auto_purged',
        target_id: String(row.id),
        target_name: row.booking_code,
        details: `48h POD purged for ${row.booking_code}`,
        target_table: 'vehicle_bookings',
        metadata: {
          purged_path: row.pod_storage_path,
          scheduled_purge_at: row.pod_purge_at,
          purged_at: nowIso,
          bucket: DELIVERY_PODS_BUCKET,
        },
      }))
    );
  }

  return {
    ok: true,
    purged_count: purgedOrderIds.length + purgedBookingIds.length,
    purged_order_ids: purgedOrderIds,
    purged_booking_ids: purgedBookingIds,
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
