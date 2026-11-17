import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const AVATAR_BUCKET = 'media';

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
    const rawUserId = formData.get('userId');

    if (!file || !(file instanceof Blob)) {
      return NextResponse.json(
        { error: 'No valid WebP avatar file provided in FormData.' },
        { status: 400 }
      );
    }

    const safeUserId =
      String(rawUserId || 'signup')
        .trim()
        .replace(/[^a-zA-Z0-9_-]/g, '-') || 'signup';

    const supabaseAdmin = getSupabaseAdmin();

    // Ensure the `media` bucket exists and is public
    const { data: existingBucket, error: getBucketError } =
      await supabaseAdmin.storage.getBucket(AVATAR_BUCKET);

    if (getBucketError || !existingBucket) {
      await supabaseAdmin.storage.createBucket(AVATAR_BUCKET, {
        public: true,
      });
    }

    const objectPath = `avatars/${safeUserId}-${Date.now()}.webp`;
    const arrayBuffer = await file.arrayBuffer();
    const fileBuffer = Buffer.from(arrayBuffer);

    const { data: uploadData, error: uploadError } =
      await supabaseAdmin.storage
        .from(AVATAR_BUCKET)
        .upload(objectPath, fileBuffer, {
          contentType: 'image/webp',
          upsert: true,
        });

    if (uploadError) {
      return NextResponse.json(
        { error: uploadError.message || 'Failed to upload avatar to storage.' },
        { status: 500 }
      );
    }

    const finalPath = uploadData?.path || objectPath;
    const { data: publicUrlData } = supabaseAdmin.storage
      .from(AVATAR_BUCKET)
      .getPublicUrl(finalPath);

    if (!publicUrlData?.publicUrl) {
      return NextResponse.json(
        { error: 'Failed to resolve public URL for uploaded avatar.' },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      url: publicUrlData.publicUrl,
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : 'Unexpected server error while uploading avatar.',
      },
      { status: 500 }
    );
  }
}
