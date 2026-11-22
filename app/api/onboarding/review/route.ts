import { NextRequest, NextResponse } from 'next/server';
import { getServerSessionContext } from '@/lib/auth-server';
import { isUuid } from '@/lib/payments/types';
import {
  createServerSupabaseAdminClient,
  extractSupabaseAccessToken,
} from '@/lib/pick-n-drop/fare';

export const dynamic = 'force-dynamic';

type ReviewAction = 'under_review' | 'changes_requested' | 'approved' | 'rejected';

const VALID_ACTIONS = new Set<ReviewAction>([
  'under_review',
  'changes_requested',
  'approved',
  'rejected',
]);

interface KycDocumentEntry {
  doc_type?: string;
  label?: string;
  storage_path?: string;
  bucket_id?: string;
}

async function resolveCallerProfile(
  req: NextRequest,
  supabaseAdmin: ReturnType<typeof createServerSupabaseAdminClient>
): Promise<{ userId: string; role: string } | null> {
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
  if (!userId) return null;

  const { data: prof } = await supabaseAdmin
    .from('profiles')
    .select('id, role')
    .eq('id', userId)
    .maybeSingle();

  if (!prof?.id) return null;
  return {
    userId: String(prof.id),
    role: String(prof.role || 'visitor').toLowerCase(),
  };
}

export async function POST(req: NextRequest) {
  try {
    const supabaseAdmin = createServerSupabaseAdminClient();
    if (!supabaseAdmin) {
      return NextResponse.json(
        { error: 'Supabase admin client is not configured.' },
        { status: 503 }
      );
    }

    const caller = await resolveCallerProfile(req, supabaseAdmin);
    if (!caller) {
      return NextResponse.json(
        { error: 'Authentication required.' },
        { status: 401 }
      );
    }

    const body = (await req.json().catch(() => null)) as {
      applicationId?: string;
      action?: string;
      reviewerNotes?: string;
    } | null;

    const applicationId = String(body?.applicationId || '').trim();
    const action = String(body?.action || '').trim() as ReviewAction;
    const reviewerNotes =
      typeof body?.reviewerNotes === 'string'
        ? body.reviewerNotes.trim().slice(0, 1000)
        : '';

    if (!isUuid(applicationId)) {
      return NextResponse.json(
        { error: 'Valid applicationId (UUID) is required.' },
        { status: 400 }
      );
    }

    if (!VALID_ACTIONS.has(action)) {
      return NextResponse.json(
        { error: 'Invalid review action.' },
        { status: 400 }
      );
    }

    // Fetch target application
    const { data: appRow, error: appErr } = await supabaseAdmin
      .from('partner_applications')
      .select(
        'id, application_code, applicant_id, hub_id, application_type, applicant_name, business_name, kyc_documents, status'
      )
      .eq('id', applicationId)
      .maybeSingle();

    if (appErr || !appRow) {
      return NextResponse.json(
        { error: 'Partner application not found.' },
        { status: 404 }
      );
    }

    // Authorization: strictly super_admin OR authorized hub_manager for application.hub_id
    const isSuperAdmin = caller.role === 'super_admin' || caller.role === 'admin';
    let isAuthorizedHubManager = false;
    if (!isSuperAdmin && appRow.hub_id) {
      const { data: mgrRow } = await supabaseAdmin
        .from('hub_managers')
        .select('id')
        .eq('user_id', caller.userId)
        .eq('hub_id', appRow.hub_id)
        .eq('is_active', true)
        .maybeSingle();
      isAuthorizedHubManager = Boolean(mgrRow?.id);
    }

    if (!isSuperAdmin && !isAuthorizedHubManager) {
      return NextResponse.json(
        {
          error:
            'Only Super-Admins or the Hub Manager for this hub can review this application.',
        },
        { status: 403 }
      );
    }

    // -------------------------------------------------------------------------
    // ATOMIC REJECTION HARD-DELETE:
    // 1. Delete all KYC / uploaded files from Storage + media_assets rows
    // 2. Notify applicant with reviewerNotes + action_url: '/onboarding'
    // 3. Permanently DELETE rejected row from partner_applications
    // -------------------------------------------------------------------------
    if (action === 'rejected') {
      const pathsByBucket = new Map<string, Set<string>>();
      const addPath = (bucket: string, rawPath: string | undefined | null) => {
        const cleaned = (rawPath || '').trim().replace(/^\/+/, '');
        if (!cleaned || cleaned.includes('..')) return;
        const b = bucket.trim() || 'kyc-documents';
        if (!pathsByBucket.has(b)) pathsByBucket.set(b, new Set());
        pathsByBucket.get(b)!.add(cleaned);
      };

      const kycDocs = Array.isArray(appRow.kyc_documents)
        ? (appRow.kyc_documents as KycDocumentEntry[])
        : [];
      for (const doc of kycDocs) {
        if (doc?.storage_path) {
          addPath(doc.bucket_id || 'kyc-documents', doc.storage_path);
        }
      }

      const { data: linkedMedia } = await supabaseAdmin
        .from('media_assets')
        .select('id, bucket_id, storage_path')
        .eq('entity_id', applicationId);

      const mediaIdsToDelete: string[] = [];
      if (Array.isArray(linkedMedia)) {
        for (const m of linkedMedia as Array<{
          id?: string;
          bucket_id?: string | null;
          storage_path?: string | null;
        }>) {
          if (m.id) mediaIdsToDelete.push(m.id);
          if (m.storage_path) {
            addPath(m.bucket_id || 'media', m.storage_path);
          }
        }
      }

      let deletedFilesCount = 0;
      for (const [bucket, pathSet] of pathsByBucket.entries()) {
        const list = Array.from(pathSet);
        if (list.length === 0) continue;
        const { error: rmErr } = await supabaseAdmin.storage
          .from(bucket)
          .remove(list);
        if (!rmErr) {
          deletedFilesCount += list.length;
        }
      }

      if (mediaIdsToDelete.length > 0) {
        await supabaseAdmin
          .from('media_assets')
          .delete()
          .in('id', mediaIdsToDelete);
      }

      // Notify applicant clearly before deleting the rejected application row
      const trackLabel =
        appRow.application_type === 'driver'
          ? 'Driver'
          : appRow.application_type === 'advertiser'
            ? 'Advertiser'
            : 'Business Partner';
      const noteText = reviewerNotes
        ? ` Reason: ${reviewerNotes}`
        : ' Please review requirements and submit a fresh application when ready.';

      await supabaseAdmin.from('notifications').insert({
        user_id: appRow.applicant_id,
        title: `${trackLabel} Application Not Approved`,
        message: `Your application (${appRow.application_code || 'Partner'}) was not approved and its uploaded documents have been permanently deleted for privacy.${noteText}`,
        type: 'partner_application_rejected',
        action_url: '/onboarding',
        is_read: false,
      });

      const { error: delAppErr } = await supabaseAdmin
        .from('partner_applications')
        .delete()
        .eq('id', applicationId);

      if (delAppErr) {
        return NextResponse.json(
          { error: delAppErr.message || 'Failed to delete rejected application.' },
          { status: 500 }
        );
      }

      return NextResponse.json({
        ok: true,
        action: 'rejected',
        hardDeleted: true,
        deletedFilesCount,
      });
    }

    // -------------------------------------------------------------------------
    // APPROVED / UNDER_REVIEW / CHANGES_REQUESTED
    // -------------------------------------------------------------------------
    const { data: rpcResult, error: rpcError } = await supabaseAdmin.rpc(
      'review_partner_application',
      {
        p_application_id: applicationId,
        p_new_status: action,
        p_reviewer_notes: reviewerNotes || null,
      }
    );

    if (rpcError) {
      return NextResponse.json(
        { error: rpcError.message || 'Failed to review partner application.' },
        { status: 400 }
      );
    }

    // On business_owner approval: promote storefront photo to permanent_bound
    // while keeping sensitive KYC ID documents on short ephemeral_ttl
    if (action === 'approved') {
      const rpcObj =
        rpcResult && typeof rpcResult === 'object'
          ? (rpcResult as Record<string, unknown>)
          : {};
      const createdListingId =
        typeof rpcObj.listing_id === 'string' ? rpcObj.listing_id : null;

      const ephemeralExpiry = new Date(
        Date.now() + 7 * 24 * 60 * 60 * 1000
      ).toISOString();

      await supabaseAdmin
        .from('media_assets')
        .update({
          retention_policy: 'ephemeral_ttl',
          expires_at: ephemeralExpiry,
          status: 'attached',
        })
        .eq('entity_id', applicationId)
        .eq('bucket_id', 'kyc-documents');

      if (appRow.application_type === 'business_owner' && createdListingId) {
        await supabaseAdmin
          .from('media_assets')
          .update({
            entity_type: 'listing',
            entity_id: createdListingId,
            retention_policy: 'permanent_bound',
            expires_at: null,
            status: 'attached',
          })
          .eq('entity_id', applicationId)
          .neq('bucket_id', 'kyc-documents');
      }
    }

    return NextResponse.json({
      ok: true,
      action,
      result: rpcResult ?? null,
    });
  } catch (err) {
    console.error('[POST /api/onboarding/review] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Unexpected error while reviewing application.' },
      { status: 500 }
    );
  }
}
