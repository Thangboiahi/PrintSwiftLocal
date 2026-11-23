import { NextRequest, NextResponse } from 'next/server';
import { getServerSessionContext } from '@/lib/auth-server';
import { isUuid } from '@/lib/payments/types';
import {
  createServerSupabaseAdminClient,
  extractSupabaseAccessToken,
} from '@/lib/pick-n-drop/fare';

export const dynamic = 'force-dynamic';

type ListingReviewAction = 'approve' | 'reject' | 'request_changes';

const VALID_ACTIONS = new Set<ListingReviewAction>([
  'approve',
  'reject',
  'request_changes',
]);

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

function extractStoragePathFromPublicUrl(rawUrl: unknown): string | null {
  if (typeof rawUrl !== 'string') return null;
  const trimmed = rawUrl.trim();
  if (!trimmed) return null;
  const marker = '/storage/v1/object/public/media/';
  const idx = trimmed.indexOf(marker);
  if (idx >= 0) {
    return decodeURIComponent(
      trimmed.slice(idx + marker.length).split('?')[0]
    ).replace(/^\/+/, '');
  }
  if (trimmed.startsWith('media/')) {
    return trimmed.split('?')[0];
  }
  return null;
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
      listingId?: string;
      action?: string;
      reviewerNotes?: string;
      deleteIfNewDraft?: boolean;
    } | null;

    const listingId = String(body?.listingId || '').trim();
    const action = String(body?.action || '').trim() as ListingReviewAction;
    const reviewerNotes =
      typeof body?.reviewerNotes === 'string'
        ? body.reviewerNotes.trim().slice(0, 1000)
        : '';
    const deleteIfNewDraft = Boolean(body?.deleteIfNewDraft);

    if (!isUuid(listingId)) {
      return NextResponse.json(
        {
          error:
            'Valid listingId (UUID) is required. Legacy synthetic IDs are not permitted.',
        },
        { status: 400 }
      );
    }

    if (!VALID_ACTIONS.has(action)) {
      return NextResponse.json(
        { error: 'Invalid review action. Use approve, reject, or request_changes.' },
        { status: 400 }
      );
    }

    const { data: listingRow, error: listingErr } = await supabaseAdmin
      .from('listings')
      .select(
        'id, title, owner_id, hub_id, status, lifecycle_status, is_verified, logo_url, thumbnail_url, cover_image, gallery_images, real_estate_details, vertical_summary'
      )
      .eq('id', listingId)
      .maybeSingle();

    if (listingErr || !listingRow) {
      return NextResponse.json(
        { error: 'Listing not found.' },
        { status: 404 }
      );
    }

    // Strict RBAC check: super_admin OR active hub_manager (profile_id) for listing.hub_id
    const isSuperAdmin =
      caller.role === 'super_admin' || caller.role === 'admin';
    let isAuthorizedHubManager = false;
    if (!isSuperAdmin && listingRow.hub_id) {
      const { data: mgrRow } = await supabaseAdmin
        .from('hub_managers')
        .select('id')
        .eq('profile_id', caller.userId)
        .eq('hub_id', listingRow.hub_id)
        .eq('is_active', true)
        .maybeSingle();
      isAuthorizedHubManager = Boolean(mgrRow?.id);
    }

    if (!isSuperAdmin && !isAuthorizedHubManager) {
      return NextResponse.json(
        {
          error:
            'Only Super-Admins or an authorized Hub Manager for this hub can approve or reject listings.',
        },
        { status: 403 }
      );
    }

    const nowIso = new Date().toISOString();
    const existingSummary =
      listingRow.vertical_summary &&
      typeof listingRow.vertical_summary === 'object' &&
      !Array.isArray(listingRow.vertical_summary)
        ? (listingRow.vertical_summary as Record<string, unknown>)
        : {};

    // =========================================================================
    // APPROVE: Publish listing & promote attached media to permanent_bound
    // =========================================================================
    if (action === 'approve') {
      const nextSummary = {
        ...existingSummary,
        is_verified: true,
        ...(typeof listingRow.logo_url === 'string' && listingRow.logo_url
          ? { logo_url: listingRow.logo_url }
          : {}),
      };

      const { error: updateErr } = await supabaseAdmin
        .from('listings')
        .update({
          status: 'published',
          lifecycle_status: 'active',
          is_verified: true,
          verification_status: 'verified_demo',
          change_request_note: null,
          vertical_summary: nextSummary,
          updated_at: nowIso,
        })
        .eq('id', listingId);

      if (updateErr) {
        return NextResponse.json(
          { error: updateErr.message || 'Failed to approve listing.' },
          { status: 500 }
        );
      }

      // Promote media_assets linked to this listing ID
      await supabaseAdmin
        .from('media_assets')
        .update({
          retention_class: 'permanent_bound',
          status: 'active',
          expires_at: null,
          updated_at: nowIso,
        })
        .eq('entity_id', listingId);

      // Also match any uploaded public URLs/paths referenced by this listing in case entity_id was NULL during draft staging
      const urlCandidates = [
        listingRow.logo_url,
        listingRow.cover_image,
        listingRow.thumbnail_url,
        ...(Array.isArray(listingRow.gallery_images)
          ? listingRow.gallery_images
          : []),
      ]
        .map((u) => extractStoragePathFromPublicUrl(u))
        .filter((p): p is string => Boolean(p));

      if (urlCandidates.length > 0) {
        await supabaseAdmin
          .from('media_assets')
          .update({
            entity_id: listingId,
            retention_class: 'permanent_bound',
            status: 'active',
            expires_at: null,
            updated_at: nowIso,
          })
          .in('storage_path', urlCandidates);
      }

      if (listingRow.owner_id) {
        await supabaseAdmin.from('notifications').insert({
          user_id: listingRow.owner_id,
          title: 'Listing Approved & Live',
          message: `Your listing "${listingRow.title || 'Business Listing'}" has been verified and published to Explore.${
            reviewerNotes ? ` Note: ${reviewerNotes}` : ''
          }`,
          type: 'listing_approved',
          action_url: `/explore?listing=${listingId}`,
          is_read: false,
        });
      }

      return NextResponse.json({
        ok: true,
        action: 'approve',
        listingId,
        promotedPathsCount: urlCandidates.length,
      });
    }

    // =========================================================================
    // REQUEST CHANGES: Mark changes_requested without wiping staged media
    // =========================================================================
    if (action === 'request_changes') {
      const note =
        reviewerNotes ||
        'Please complete missing details or media and resubmit for approval.';

      const { error: chgErr } = await supabaseAdmin
        .from('listings')
        .update({
          status: 'changes_requested',
          verification_status: 'info_requested',
          change_request_note: note,
          updated_at: nowIso,
        })
        .eq('id', listingId);

      if (chgErr) {
        // Fallback if DB status constraint differs
        await supabaseAdmin
          .from('listings')
          .update({
            status: 'draft',
            verification_status: 'info_requested',
            change_request_note: note,
            updated_at: nowIso,
          })
          .eq('id', listingId);
      }

      if (listingRow.owner_id) {
        await supabaseAdmin.from('notifications').insert({
          user_id: listingRow.owner_id,
          title: 'Changes Requested for Listing',
          message: `Reviewer requested updates for "${listingRow.title || 'Listing'}": ${note}`,
          type: 'listing_changes_requested',
          action_url: '/workspace',
          is_read: false,
        });
      }

      return NextResponse.json({
        ok: true,
        action: 'request_changes',
        listingId,
      });
    }

    // =========================================================================
    // REJECT: Hard-delete unapproved Storage blobs & media_assets, scrub URLs, notify owner
    // =========================================================================
    const wasAlreadyVerified = Boolean(listingRow.is_verified);

    // 1. Gather unapproved media_assets for this listing
    let mediaQuery = supabaseAdmin
      .from('media_assets')
      .select('id, bucket_id, storage_path, public_url, status, retention_class')
      .eq('entity_id', listingId);

    const { data: linkedMedia } = await mediaQuery;
    const pathsByBucket = new Map<string, Set<string>>();
    const mediaIdsToDelete: string[] = [];
    const deletedUrls = new Set<string>();
    const deletedPaths = new Set<string>();

    const addTarget = (
      bucket: string,
      storagePath: string | null | undefined,
      publicUrl?: string | null
    ) => {
      const cleaned = (storagePath || '').trim().replace(/^\/+/, '');
      if (!cleaned || cleaned.includes('..')) return;
      const b = bucket.trim() || 'media';
      if (!pathsByBucket.has(b)) pathsByBucket.set(b, new Set());
      pathsByBucket.get(b)!.add(cleaned);
      deletedPaths.add(cleaned);
      if (publicUrl) deletedUrls.add(publicUrl);
    };

    if (Array.isArray(linkedMedia)) {
      for (const row of linkedMedia as Array<{
        id?: string;
        bucket_id?: string | null;
        storage_path?: string | null;
        public_url?: string | null;
        status?: string | null;
        retention_class?: string | null;
      }>) {
        const isPendingOrUnverified =
          !wasAlreadyVerified ||
          row.status === 'pending_attach' ||
          row.status === 'pending_verification' ||
          row.retention_class !== 'permanent_bound';
        if (isPendingOrUnverified) {
          if (row.id) mediaIdsToDelete.push(row.id);
          if (row.storage_path) {
            addTarget(row.bucket_id || 'media', row.storage_path, row.public_url);
          }
        }
      }
    }

    // If unverified listing has media URLs not yet tracked in media_assets, collect their paths too
    if (!wasAlreadyVerified) {
      const directUrls = [
        listingRow.logo_url,
        listingRow.cover_image,
        listingRow.thumbnail_url,
        ...(Array.isArray(listingRow.gallery_images)
          ? listingRow.gallery_images
          : []),
      ];
      for (const url of directUrls) {
        if (typeof url === 'string' && url.trim()) {
          const path = extractStoragePathFromPublicUrl(url);
          if (path) {
            addTarget('media', path, url);
          }
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

    // Also clean matching storage_path entries for deleted unverified URLs
    if (deletedPaths.size > 0) {
      await supabaseAdmin
        .from('media_assets')
        .delete()
        .in('storage_path', Array.from(deletedPaths));
    }

    // Notify owner before deleting/resetting listing
    if (listingRow.owner_id) {
      const reasonText = reviewerNotes
        ? ` Reason: ${reviewerNotes}`
        : ' Unapproved uploaded media has been removed to preserve storage hygiene.';
      await supabaseAdmin.from('notifications').insert({
        user_id: listingRow.owner_id,
        title: 'Listing Submission Rejected',
        message: `Your listing "${listingRow.title || 'Listing'}" was not approved.${reasonText}`,
        type: 'listing_rejected',
        action_url: '/workspace',
        is_read: false,
      });
    }

    if (deleteIfNewDraft && !wasAlreadyVerified) {
      await supabaseAdmin.from('listings').delete().eq('id', listingId);
      return NextResponse.json({
        ok: true,
        action: 'reject',
        listingId,
        deletedListing: true,
        deletedFilesCount,
      });
    }

    // Scrub deleted URLs from the listing row
    const shouldScrubUrl = (url: unknown): boolean => {
      if (typeof url !== 'string' || !url.trim()) return false;
      if (!wasAlreadyVerified) return true;
      if (deletedUrls.has(url)) return true;
      const p = extractStoragePathFromPublicUrl(url);
      return Boolean(p && deletedPaths.has(p));
    };

    const nextGallery = Array.isArray(listingRow.gallery_images)
      ? listingRow.gallery_images.filter((u) => !shouldScrubUrl(u))
      : [];

    const existingReDetails =
      listingRow.real_estate_details &&
      typeof listingRow.real_estate_details === 'object' &&
      !Array.isArray(listingRow.real_estate_details)
        ? (listingRow.real_estate_details as Record<string, unknown>)
        : null;

    const nextReDetails = existingReDetails
      ? {
          ...existingReDetails,
          panoramaUrl: shouldScrubUrl(existingReDetails.panoramaUrl)
            ? ''
            : existingReDetails.panoramaUrl,
          panoramas: Array.isArray(existingReDetails.panoramas)
            ? existingReDetails.panoramas.filter(
                (p: unknown) =>
                  !(
                    p &&
                    typeof p === 'object' &&
                    shouldScrubUrl((p as { imageUrl?: unknown }).imageUrl)
                  )
              )
            : [],
        }
      : listingRow.real_estate_details;

    const nextSummary = {
      ...existingSummary,
      is_verified: wasAlreadyVerified,
      ...(shouldScrubUrl(listingRow.logo_url) ? { logo_url: null } : {}),
    };

    const { error: resetErr } = await supabaseAdmin
      .from('listings')
      .update({
        status: 'draft',
        is_verified: wasAlreadyVerified,
        verification_status: wasAlreadyVerified
          ? 'verified_demo'
          : 'unverified_sample',
        change_request_note:
          reviewerNotes || 'Rejected by moderator. Update details and resubmit.',
        logo_url: shouldScrubUrl(listingRow.logo_url) ? null : listingRow.logo_url,
        cover_image: shouldScrubUrl(listingRow.cover_image)
          ? ''
          : listingRow.cover_image,
        thumbnail_url: shouldScrubUrl(listingRow.thumbnail_url)
          ? null
          : listingRow.thumbnail_url,
        gallery_images: nextGallery,
        real_estate_details: nextReDetails,
        vertical_summary: nextSummary,
        updated_at: nowIso,
      })
      .eq('id', listingId);

    if (resetErr) {
      return NextResponse.json(
        { error: resetErr.message || 'Failed to update rejected listing.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      ok: true,
      action: 'reject',
      listingId,
      deletedListing: false,
      deletedFilesCount,
    });
  } catch (err) {
    console.error('[POST /api/listings/review] Unexpected error:', err);
    return NextResponse.json(
      { error: 'Unexpected server error while reviewing listing.' },
      { status: 500 }
    );
  }
}
