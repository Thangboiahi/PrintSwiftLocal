import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const BUCKET_NAME = 'media';

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
    const entityType = String(
      formData.get('entityType') || formData.get('type') || 'profile'
    ).trim();
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

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json(
        { error: 'No valid file provided in FormData.', success: false },
        { status: 400 }
      );
    }

    const supabaseAdmin = getSupabaseAdmin();

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

    const {
      data: { publicUrl },
    } = supabaseAdmin.storage
      .from(BUCKET_NAME)
      .getPublicUrl(uploadData.path || path);

    // Immediately insert a tracking row into public.media_assets using the service role client
    try {
      const { error: insertError } = await supabaseAdmin
        .from('media_assets')
        .insert({
          bucket_id: BUCKET_NAME,
          storage_path: path,
          public_url: publicUrl,
          entity_type: entityType,
          entity_id: entityId || null,
          is_temporary: !entityId,
        });

      if (insertError) {
        console.warn(
          'Notice: media_assets tracking insert warning:',
          insertError.message
        );
      }
    } catch (dbErr) {
      console.warn('Non-fatal media_assets insert error:', dbErr);
    }

    return NextResponse.json({
      url: publicUrl,
      success: true,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : 'Unexpected server error while uploading media.',
        success: false,
      },
      { status: 500 }
    );
  }
}
