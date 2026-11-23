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

function normalizeEntityType(raw: string): {
  storageBucketFolder: string;
  dbEntityType: string;
} {
  const clean = raw.trim().toLowerCase();
  if (clean === 'listing_logo' || clean === 'logo') {
    return { storageBucketFolder: 'listing_logo', dbEntityType: 'listing_cover' };
  }
  if (clean === 'listing_panorama' || clean === 'panorama') {
    return {
      storageBucketFolder: 'listing_panorama',
      dbEntityType: 'listing_gallery',
    };
  }
  if (VALID_MEDIA_ENTITY_TYPES.has(clean)) {
    return { storageBucketFolder: clean, dbEntityType: clean };
  }
  if (clean === 'profile' || clean === 'avatars') {
    return { storageBucketFolder: 'avatar', dbEntityType: 'avatar' };
  }
  if (clean === 'listing' || clean === 'listings') {
    return { storageBucketFolder: 'listing_gallery', dbEntityType: 'listing_gallery' };
  }
  if (clean === 'product' || clean === 'products') {
    return { storageBucketFolder: 'product_image', dbEntityType: 'product_image' };
  }
  if (clean === 'bulletin' || clean === 'bulletins') {
    return { storageBucketFolder: 'bulletin_media', dbEntityType: 'bulletin_media' };
  }
  if (clean === 'banner' || clean === 'banners') {
    return { storageBucketFolder: 'banner_image', dbEntityType: 'banner_image' };
  }
  if (clean === 'payment' || clean === 'payments') {
    return {
      storageBucketFolder: 'payment_utr_proof',
      dbEntityType: 'payment_utr_proof',
    };
  }
  return { storageBucketFolder: 'listing_gallery', dbEntityType: 'listing_gallery' };
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
    const { storageBucketFolder, dbEntityType } = normalizeEntityType(rawEntityType);
    const entityType = dbEntityType;
    const rawRetentionClass = String(
      formData.get('retentionClass') || ''
    ).trim();
    const rawMediaStatus = String(
      formData.get('mediaStatus') || formData.get('status') || ''
    ).trim();
    const parsedTtlDays = Number(formData.get('ttlDays') || '');
    const ttlDays =
      Number.isFinite(parsedTtlDays) && parsedTtlDays > 0 && parsedTtlDays <= 90
        ? parsedTtlDays
        : rawRetentionClass === 'ephemeral_ttl'
        ? 14
        : 1;
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

    // STRICT PRIVACY BARRIER: KYC documents MUST NEVER be stored in a public bucket
    if (entityType === 'kyc_document') {
      if (!uploadedBy) {
        return NextResponse.json(
          {
            error: 'Authentication required to upload private KYC documents.',
            success: false,
          },
          { status: 401 }
        );
      }

      const allowedKycMimes = new Set([
        'application/pdf',
        'image/jpeg',
        'image/png',
        'image/webp',
      ]);
      const rawMime = (file.type || '').trim().toLowerCase();
      if (!allowedKycMimes.has(rawMime)) {
        return NextResponse.json(
          {
            error:
              'KYC documents must be a PDF, JPEG, PNG, or WebP image file.',
            success: false,
          },
          { status: 400 }
        );
      }

      const kycArrayBuffer = await file.arrayBuffer();
      const kycBuffer = Buffer.from(kycArrayBuffer);
      if (kycBuffer.byteLength > 10 * 1024 * 1024) {
        return NextResponse.json(
          {
            error: 'KYC document exceeds the 10 MB maximum file size.',
            success: false,
          },
          { status: 400 }
        );
      }

      const PRIVATE_KYC_BUCKET = 'kyc-documents';
      try {
        const { data: existingKycBucket, error: getKycBucketErr } =
          await supabaseAdmin.storage.getBucket(PRIVATE_KYC_BUCKET);
        if (getKycBucketErr || !existingKycBucket) {
          await supabaseAdmin.storage.createBucket(PRIVATE_KYC_BUCKET, {
            public: false,
            fileSizeLimit: 10 * 1024 * 1024,
            allowedMimeTypes: Array.from(allowedKycMimes),
          });
        }
      } catch (bucketErr) {
        console.warn('Private KYC bucket check warning:', bucketErr);
      }

      const ext =
        rawMime === 'application/pdf'
          ? 'pdf'
          : rawMime === 'image/png'
            ? 'png'
            : rawMime === 'image/jpeg'
              ? 'jpg'
              : 'webp';
      const randomToken = crypto.randomUUID().slice(0, 8);
      const kycPath = `kyc/${uploadedBy}/${Date.now()}-${randomToken}.${ext}`;

      const { data: kycUploadData, error: kycUploadError } =
        await supabaseAdmin.storage
          .from(PRIVATE_KYC_BUCKET)
          .upload(kycPath, kycBuffer, {
            contentType: rawMime,
            upsert: false,
          });

      if (kycUploadError || !kycUploadData) {
        return NextResponse.json(
          {
            error:
              kycUploadError?.message ||
              'Failed to upload private KYC document.',
            success: false,
          },
          { status: 500 }
        );
      }

      const finalKycPath = kycUploadData.path || kycPath;
      const validEntityUuid =
        entityId && /^[0-9a-f-]{36}$/i.test(entityId) ? entityId : null;
      // Ephemeral TTL: 48h draft expiry until bound/reviewed (which sets 30d post-review TTL)
      const kycDraftExpiresIso = new Date(
        Date.now() + 48 * 60 * 60 * 1000
      ).toISOString();

      try {
        const { error: kycTrackErr } = await supabaseAdmin
          .from('media_assets')
          .upsert(
            {
              bucket_id: PRIVATE_KYC_BUCKET,
              storage_path: finalKycPath,
              public_url: null,
              uploaded_by: uploadedBy,
              hub_id: hubId,
              file_size_bytes: kycBuffer.byteLength,
              mime_type: rawMime,
              entity_type: 'kyc_document',
              entity_id: validEntityUuid,
              retention_class: 'ephemeral_ttl',
              status: 'pending_attach',
              expires_at: kycDraftExpiresIso,
            },
            { onConflict: 'storage_path' }
          );

        if (kycTrackErr) {
          console.warn(
            'Notice: private KYC media_assets tracking warning:',
            kycTrackErr.message
          );
        }
      } catch (dbErr) {
        console.warn('Non-fatal private KYC media_assets error:', dbErr);
      }

      return NextResponse.json({
        success: true,
        isPrivate: true,
        bucketId: PRIVATE_KYC_BUCKET,
        path: finalKycPath,
        url: null,
        sizeBytes: kycBuffer.byteLength,
      });
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
    const randomSuffix = Math.random().toString(36).slice(2, 7);
    const path = entityId
      ? `media/${storageBucketFolder}/${entityId}/${timestamp}-${randomSuffix}.webp`
      : `media/temp/${storageBucketFolder}/${timestamp}-${randomSuffix}.webp`;

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

    // Track upload in Zero-Orphan Media Asset Registry (ephemeral 14d pending verification or 24h draft TTL)
    const effectiveRetentionClass =
      rawRetentionClass === 'ephemeral_ttl' || rawRetentionClass === 'temp_draft'
        ? rawRetentionClass
        : 'temp_draft';
    const desiredMediaStatus =
      rawMediaStatus === 'pending_verification'
        ? 'pending_verification'
        : 'pending_attach';
    const draftExpiresIso = new Date(
      Date.now() + ttlDays * 24 * 60 * 60 * 1000
    ).toISOString();
    const validEntityUuid =
      entityId && /^[0-9a-f-]{36}$/i.test(entityId) ? entityId : null;

    try {
      const baseRecord = {
        bucket_id: BUCKET_NAME,
        storage_path: finalPath,
        public_url: publicUrl,
        uploaded_by: uploadedBy,
        hub_id: hubId,
        file_size_bytes: fileBuffer.byteLength,
        mime_type: file.type || 'image/webp',
        entity_type: dbEntityType,
        entity_id: validEntityUuid,
        retention_class: effectiveRetentionClass,
        status: desiredMediaStatus,
        expires_at: draftExpiresIso,
      };

      const { error: insertError } = await supabaseAdmin
        .from('media_assets')
        .upsert(baseRecord, { onConflict: 'storage_path' });

      if (insertError) {
        if (desiredMediaStatus === 'pending_verification') {
          const { error: fallbackErr } = await supabaseAdmin
            .from('media_assets')
            .upsert(
              {
                ...baseRecord,
                status: 'pending_attach',
              },
              { onConflict: 'storage_path' }
            );
          if (fallbackErr) {
            console.warn(
              'Notice: media_assets fallback upsert warning:',
              fallbackErr.message
            );
          }
        } else {
          console.warn(
            'Notice: media_assets tracking upsert warning:',
            insertError.message
          );
        }
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
