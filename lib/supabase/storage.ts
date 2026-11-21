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
  folder:
    | 'listings'
    | 'panoramas'
    | 'profiles'
    | 'avatars'
    | 'bulletins'
    | 'payments'
    | 'banners',
  entityId: string,
  fileName: string
): string {
  const safeEntityId = (entityId || 'unassigned').replace(
    /[^a-zA-Z0-9_-]/g,
    '-'
  );
  const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  return `${folder}/${safeEntityId}/${Date.now()}-${sanitizedFileName}`;
}

/**
 * Converts any legacy local static placeholder image path into a valid remote
 * Supabase Storage public URL (or clean remote URL) so `listings` and `profiles`
 * exclusively use remote media URLs.
 */
export function resolveRemoteMediaUrl(rawUrl?: string | null): string {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) return '';

  // Already a remote URL or data/blob URI
  if (
    trimmed.startsWith('https://') ||
    trimmed.startsWith('http://') ||
    trimmed.startsWith('data:image/') ||
    trimmed.startsWith('blob:')
  ) {
    return trimmed;
  }

  // Convert relative bucket paths or local static placeholder paths to remote Supabase Storage URLs
  const cleanObjectPath = trimmed
    .replace(/^\/+/, '')
    .replace(/^public\//, '')
    .replace(/^media\//, '');

  if (!cleanObjectPath) return '';

  const { data } = supabase.storage
    .from(MEDIA_BUCKET)
    .getPublicUrl(cleanObjectPath);

  return data?.publicUrl || '';
}

/**
 * Custom Next.js `<Image>` loader that routes Supabase Storage public URLs directly
 * through the Service Worker `CacheFirst` interceptor (`supabase-media-cache-v1`),
 * while preserving standard Next.js `/_next/image` optimization for external hosts.
 */
export function supabaseMediaImageLoader({
  src,
  width,
  quality,
}: {
  src: string;
  width: number;
  quality?: number;
}): string {
  const resolved = resolveRemoteMediaUrl(src);
  if (!resolved) return '';
  if (resolved.startsWith('data:') || resolved.startsWith('blob:')) {
    return resolved;
  }
  if (/\.supabase\.(co|in)\/storage\/v1\/object\/public\//i.test(resolved)) {
    return resolved;
  }
  const q = quality || 75;
  return `/_next/image?url=${encodeURIComponent(resolved)}&w=${width}&q=${q}`;
}

export interface UploadImageOptions {
  folder?:
    | 'listings'
    | 'profiles'
    | 'avatars'
    | 'panoramas'
    | 'bulletins'
    | 'payments'
    | 'banners';
  entityId?: string;
  listingId?: string;
  profileId?: string;
  persistToTable?: 'listings' | 'profiles';
}

/**
 * Universal Supabase Storage upload utility (`uploadImage`).
 * Validates the file, uploads to the Supabase `media` storage bucket,
 * resolves the remote `publicUrl`, and optionally stores the URL in the
 * `listings` (`cover_image` / `listing_media`) or `profiles` (`avatar_url`) table.
 */
export async function uploadImage(
  file: File,
  options: UploadImageOptions = {}
): Promise<MediaUploadResult> {
  validateMediaFile(file);

  const folder =
    options.folder ||
    (options.persistToTable === 'profiles' || options.profileId
      ? 'profiles'
      : 'listings');
  const targetId =
    options.entityId || options.listingId || options.profileId || 'draft';

  const objectPath = buildStorageObjectPath(folder, targetId, file.name);
  const { data, error } = await supabase.storage
    .from(MEDIA_BUCKET)
    .upload(objectPath, file, {
      contentType: file.type,
      upsert: false,
    });

  if (error) {
    throw new Error(error.message);
  }

  const uploadedPath = data?.path || objectPath;
  const { data: publicUrlData } = supabase.storage
    .from(MEDIA_BUCKET)
    .getPublicUrl(uploadedPath);

  const publicUrl = publicUrlData.publicUrl;

  if (
    (options.persistToTable === 'profiles' || options.profileId) &&
    targetId !== 'draft'
  ) {
    const cleanProfileId = (options.profileId || targetId).replace(
      /^avatar-/,
      ''
    );
    await supabase
      .from('profiles')
      .update({
        avatar_url: publicUrl,
        updated_at: new Date().toISOString(),
      })
      .eq('id', cleanProfileId);
  } else if (
    options.persistToTable === 'listings' &&
    targetId &&
    targetId !== 'draft'
  ) {
    await supabase
      .from('listings')
      .update({
        cover_image: publicUrl,
        updated_at: new Date().toISOString(),
      })
      .eq('id', targetId);
  }

  return {
    path: uploadedPath,
    publicUrl,
    mimeType: file.type,
    sizeBytes: file.size,
  };
}

/**
 * Uploads a standard listing image (`cover` or `gallery`) to the Supabase `media` bucket
 * after validating MIME type and the 5MB size limit.
 */
export async function uploadListingImage(
  file: File,
  listingId = 'draft'
): Promise<MediaUploadResult> {
  const isAvatarUpload = listingId.startsWith('avatar-');
  return uploadImage(file, {
    folder: isAvatarUpload ? 'profiles' : 'listings',
    entityId: listingId,
    profileId: isAvatarUpload ? listingId.replace(/^avatar-/, '') : undefined,
    persistToTable: isAvatarUpload ? 'profiles' : undefined,
  });
}

/**
 * Uploads a 360° equirectangular panorama image to the Supabase `media` bucket
 * after validating MIME type and the 5MB size limit.
 */
export async function uploadPanorama(
  file: File,
  listingId = 'draft'
): Promise<MediaUploadResult> {
  return uploadImage(file, {
    folder: 'panoramas',
    entityId: listingId,
    listingId,
  });
}

// =============================================================================
// Private Proof of Delivery (POD) Storage Helpers (Phase 60-A)
// =============================================================================

export const DELIVERY_PODS_BUCKET = 'delivery-pods';
export const POD_SIGNED_URL_TTL_SECONDS = 300; // 5 minutes

export interface DeliveryPodUploadResult {
  path: string;
  mimeType: string;
  sizeBytes: number;
}

/**
 * Uploads a Proof of Delivery (POD) image to the private `delivery-pods` bucket.
 * Strictly returns the private object storage path ONLY (never a public URL).
 */
export async function uploadDeliveryPod(
  orderId: string,
  file: File
): Promise<DeliveryPodUploadResult> {
  validateMediaFile(file);

  const safeOrderId = (orderId || '').trim().replace(/[^a-zA-Z0-9_-]/g, '-');
  if (!safeOrderId) {
    throw new Error('A valid orderId is required to upload a POD photo.');
  }

  const sanitizedFileName = file.name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const objectPath = `orders/${safeOrderId}/${Date.now()}-${sanitizedFileName}`;

  const { data, error } = await supabase.storage
    .from(DELIVERY_PODS_BUCKET)
    .upload(objectPath, file, {
      contentType: file.type,
      upsert: false,
    });

  if (error) {
    throw new Error(error.message);
  }

  return {
    path: data?.path || objectPath,
    mimeType: file.type,
    sizeBytes: file.size,
  };
}

/**
 * Generates a short-lived (5-minute) signed URL for an authorized viewer
 * to inspect a private Proof of Delivery image stored in `delivery-pods`.
 */
export async function getSignedPodUrl(
  storagePath: string,
  expiresInSeconds: number = POD_SIGNED_URL_TTL_SECONDS
): Promise<string> {
  const cleanPath = (storagePath || '').trim().replace(/^\/+/, '');
  if (!cleanPath) {
    throw new Error('A valid POD storage path is required.');
  }

  const ttl = Math.min(Math.max(30, Math.floor(expiresInSeconds)), 300);

  const { data, error } = await supabase.storage
    .from(DELIVERY_PODS_BUCKET)
    .createSignedUrl(cleanPath, ttl);

  if (error || !data?.signedUrl) {
    throw new Error(
      error?.message || 'Failed to generate a temporary signed URL for POD.'
    );
  }

  return data.signedUrl;
}


export type BindableMediaEntityType =
  | 'avatar'
  | 'listing_cover'
  | 'listing_gallery'
  | 'product_image'
  | 'menu_item_image'
  | 'resource_photo'
  | 'bulletin_media'
  | 'print_document'
  | 'delivery_pod'
  | 'payment_utr_proof'
  | 'civic_report_proof'
  | 'kyc_document'
  | 'banner_image';

export type MediaRetentionClass =
  | 'permanent_bound'
  | 'ephemeral_ttl'
  | 'temp_draft';

/**
 * Binds uploaded storage paths to an entity via the `bind_media_assets` RPC,
 * automatically marking any replaced assets for zero-orphan cleanup.
 */
export async function bindEntityMedia(
  paths: string[],
  entityType: BindableMediaEntityType,
  entityId: string,
  retentionClass: MediaRetentionClass = 'permanent_bound',
  ttlHours?: number
): Promise<void> {
  const cleanPaths = paths.map((p) => p.trim()).filter(Boolean);
  if (!entityId) return;
  try {
    await supabase.rpc('bind_media_assets', {
      p_storage_paths: cleanPaths,
      p_entity_type: entityType,
      p_entity_id: entityId,
      p_retention_class: retentionClass,
      p_ttl_hours: ttlHours ?? null,
    });
  } catch {
    // Non-blocking fallback if RPC not yet provisioned
  }
}
