import { supabase } from '@/lib/supabase/client';

export const MEDIA_BUCKET = 'media';
export const MAX_MEDIA_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5MB max
export const ALLOWED_MEDIA_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

export type AllowedMediaMimeType = (typeof ALLOWED_MEDIA_MIME_TYPES)[number];

export interface MediaUploadResult {
  path: string;
  publicUrl: string;
  mimeType: string;
  sizeBytes: number;
}

/**
 * Validates that a file is within the 5MB size limit and matches allowed MIME types
 * (`image/jpeg`, `image/png`, `image/webp`).
 */
export function validateMediaFile(file: File): void {
  if (!file) {
    throw new Error('No file provided for upload.');
  }

  if (
    !ALLOWED_MEDIA_MIME_TYPES.includes(file.type as AllowedMediaMimeType)
  ) {
    throw new Error(
      `Unsupported file format "${
        file.type || 'unknown'
      }". Only JPEG (image/jpeg), PNG (image/png), and WebP (image/webp) images are accepted.`
    );
  }

  if (file.size > MAX_MEDIA_FILE_SIZE_BYTES) {
    const sizeMb = (file.size / (1024 * 1024)).toFixed(2);
    throw new Error(
      `File size (${sizeMb} MB) exceeds the 5 MB maximum upload limit.`
    );
  }
}

function buildStorageObjectPath(
  folder: 'listings' | 'panoramas',
  listingId: string,
  fileName: string
): string {
  const safeListingId = (listingId || 'unassigned').replace(
    /[^a-zA-Z0-9_-]/g,
    '-'
  );
  const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${folder}/${safeListingId}/${Date.now()}-${sanitizedFileName}`;
}

/**
 * Uploads a standard listing image (`cover` or `gallery`) to the Supabase `media` bucket
 * after validating MIME type and the 5MB size limit.
 */
export async function uploadListingImage(
  file: File,
  listingId = 'draft'
): Promise<MediaUploadResult> {
  validateMediaFile(file);

  const objectPath = buildStorageObjectPath('listings', listingId, file.name);
  const { data, error } = await supabase.storage
    .from('media')
    .upload(objectPath, file, {
      contentType: file.type,
      upsert: false,
    });

  if (error) {
    throw new Error(error.message);
  }

  const uploadedPath = data?.path || objectPath;
  const { data: publicUrlData } = supabase.storage
    .from('media')
    .getPublicUrl(uploadedPath);

  return {
    path: uploadedPath,
    publicUrl: publicUrlData.publicUrl,
    mimeType: file.type,
    sizeBytes: file.size,
  };
}

/**
 * Uploads a 360° equirectangular panorama image to the Supabase `media` bucket
 * after validating MIME type and the 5MB size limit.
 */
export async function uploadPanorama(
  file: File,
  listingId = 'draft'
): Promise<MediaUploadResult> {
  validateMediaFile(file);

  const objectPath = buildStorageObjectPath('panoramas', listingId, file.name);
  const { data, error } = await supabase.storage
    .from('media')
    .upload(objectPath, file, {
      contentType: file.type,
      upsert: false,
    });

  if (error) {
    throw new Error(error.message);
  }

  const uploadedPath = data?.path || objectPath;
  const { data: publicUrlData } = supabase.storage
    .from('media')
    .getPublicUrl(uploadedPath);

  return {
    path: uploadedPath,
    publicUrl: publicUrlData.publicUrl,
    mimeType: file.type,
    sizeBytes: file.size,
  };
}
