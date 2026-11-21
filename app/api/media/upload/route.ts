import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { getServerSessionContext } from '@/lib/auth-server';
import { extractSupabaseAccessToken } from '@/lib/pick-n-drop/fare';

const BUCKET_NAME = 'media';

const VALID_MEDIA_ENTITY_TYPES = new Set([
  'avatar',
  'listing_cover',
  'listing_gallery',
  'product_image',
  'menu_item_image',
  'resource_photo',
  'bulletin_media',
  'print_document',
  'delivery_pod',
  'payment_utr_proof',
  'civic_report_proof',
  'kyc_document',
  'banner_image',
]);

function normalizeEntityType(raw: string): string {
  const clean = raw.trim().toLowerCase();
  if (VALID_MEDIA_ENTITY_TYPES.has(clean)) return clean;
  if (clean === 'profile' || clean === 'avatars') return 'avatar';
  if (clean === 'listing' || clean === 'listings') return 'listing_gallery';
  if (clean === 'product' || clean === 'products') return 'product_image';
  if (clean === 'bulletin' || clean === 'bulletins') return 'bulletin_media';
  if (clean === 'banner' || clean === 'banners') return 'banner_image';
  if (clean === 'payment' || clean === 'payments') return 'payment_utr_proof';
  return 'listing_gallery';
}

function getSupabaseAdmin() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY on the server.'
    );
  }

  return createClient(supabaseUrl, serviceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
  });
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get('file');
    const rawEntityType = String(
      formData.get('entityType') || formData.get('type') || 'listing_gallery'
    ).trim();
    const entityType = normalizeEntityType(rawEntityType);
    const rawEntityId = formData.get('entityId') || formData.get('userId');
    const entityId =
      rawEntityId &&
      String(rawEntityId).trim() !== '' &&
      String(rawEntityId).trim() !== 'undefined' &&
      String(rawEntityId).trim() !== 'null' &&
      String(rawEntityId).trim() !== 'signup' &&
      String(rawEntityId).trim() !== 'user'
        ? String(rawEntityId).trim()
        : null;
    const rawHubId = formData.get('hubId');
    const hubId =
      rawHubId && /^[0-9a-f-]{36}$/i.test(String(rawHubId).trim())
        ? String(rawHubId).trim()
        : null;

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json(
        { error: 'No valid file provided in FormData.', success: false },
        { status: 400 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();

    // Resolve uploader user_id if authenticated
    let uploadedBy: string | null = null;
    try {
      const token = extractSupabaseAccessToken(req);
      if (token) {
        const { data } = await supabaseAdmin.auth.getUser(token);
        if (data?.user?.id) uploadedBy = data.user.id;
      }
      if (!uploadedBy) {
        const ctx = await getServerSessionContext();
        if (ctx.profile?.id) uploadedBy = String(ctx.profile.id);
      }
    } catch {
      // Optional uploader attribution
    }

    // Ensure the `media` bucket exists and is public
    try {
      const { data: existingBucket, error: getBucketError } =
        await supabaseAdmin.storage.getBucket(BUCKET_NAME);

      if (getBucketError || !existingBucket) {
        await supabaseAdmin.storage.createBucket(BUCKET_NAME, {
          public: true,
        });
      }
    } catch (bucketErr) {
      console.warn('Bucket verification warning:', bucketErr);
    }

    const timestamp = Date.now();
    const path = entityId
      ? `media/${entityType}/${entityId}/${timestamp}.webp`
      : `media/temp/${entityType}/${timestamp}.webp`;

    const arrayBuffer = await file.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);

    const { data: uploadData, error: uploadError } =
      await supabaseAdmin.storage.from(BUCKET_NAME).upload(path, fileBuffer, {
        contentType: file.type || 'image/webp',
        upsert: true,
      });

    if (uploadError || !uploadData) {
      return NextResponse.json(
        {
          error: uploadError?.message || 'Failed to upload media to storage.',
          success: false,
        },
        { status: 500 }
      );
    }

    const finalPath = uploadData.path || path;
    const {
      data: { publicUrl },
    } = supabaseAdmin.storage.from(BUCKET_NAME).getPublicUrl(finalPath);

    // Track upload in Zero-Orphan Media Asset Registry (24h draft TTL until bound via bind_media_assets)
    const draftExpiresIso = new Date(
      Date.now() + 24 * 60 * 60 * 1000
    ).toISOString();
    const validEntityUuid =
      entityId && /^[0-9a-f-]{36}$/i.test(entityId) ? entityId : null;

    try {
      const { error: insertError } = await supabaseAdmin
        .from('media_assets')
        .upsert(
          {
            bucket_id: BUCKET_NAME,
            storage_path: finalPath,
            public_url: publicUrl,
            uploaded_by: uploadedBy,
            hub_id: hubId,
            file_size_bytes: fileBuffer.byteLength,
            mime_type: file.type || 'image/webp',
            entity_type: entityType,
            entity_id: validEntityUuid,
            retention_class: 'temp_draft',
            status: 'pending_attach',
            expires_at: draftExpiresIso,
          },
          { onConflict: 'storage_path' }
        );

      if (insertError) {
        console.warn(
          'Notice: media_assets tracking upsert warning:',
          insertError.message
        );
      }
    } catch (dbErr) {
      console.warn('Non-fatal media_assets insert error:', dbErr);
    }

    return NextResponse.json({
      url: publicUrl,
      success: true,
      path: finalPath,
      sizeBytes: fileBuffer.byteLength,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : 'Unexpected error while uploading media.',
        success: false,
      },
      { status: 500 }
    );
  }
}
