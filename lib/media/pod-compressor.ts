'use client';

/**
 * Dependency-free client-side Proof-of-Delivery (POD) image compressor.
 * Resizes large mobile camera captures to max 1280px longest edge and
 * encodes to WebP (with JPEG fallback on older mobile WebViews), iterating
 * quality cleanly to target <= 250 KB for fast rural 4G uploads.
 */

const MAX_RAW_INPUT_BYTES = 15 * 1024 * 1024; // 15 MB raw camera ceiling
const MAX_LONGEST_EDGE_PX = 1280;
const TARGET_MAX_BYTES = 250 * 1024; // 250 KB target ceiling

const ALLOWED_INPUT_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
]);

export interface CompressedPodResult {
  blob: Blob;
  fileName: string;
  mimeType: 'image/webp' | 'image/jpeg';
  originalKb: number;
  compressedKb: number;
  width: number;
  height: number;
}

function toSafeBaseName(rawName: string): string {
  const withoutExt = rawName.replace(/\.[^.]+$/, '');
  const sanitized = withoutExt
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return sanitized || 'pod-capture';
}

function canvasToBlob(
  canvas: HTMLCanvasElement,
  mimeType: string,
  quality: number
): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), mimeType, quality);
  });
}

function loadFileIntoImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const objectUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      reject(
        new Error(
          'Unable to decode this photo. Please capture a JPG, PNG, or WebP image.'
        )
      );
    };
    img.src = objectUrl;
  });
}

export async function compressPodImageToWebp(
  file: File
): Promise<CompressedPodResult> {
  if (!file) {
    throw new Error('Select or capture a Proof-of-Delivery photo first.');
  }

  const normalizedType = (file.type || '').toLowerCase();
  const hasImagePrefix = normalizedType.startsWith('image/');
  if (!hasImagePrefix || (normalizedType && !ALLOWED_INPUT_MIME_TYPES.has(normalizedType))) {
    throw new Error(
      'Unsupported file format. Please upload a JPG, PNG, or WebP photo.'
    );
  }

  if (file.size <= 0) {
    throw new Error('The selected photo appears to be empty. Please try again.');
  }

  if (file.size > MAX_RAW_INPUT_BYTES) {
    throw new Error(
      'Photo exceeds the 15 MB raw input limit. Please choose a smaller image.'
    );
  }

  const img = await loadFileIntoImage(file);
  const naturalW = img.naturalWidth || img.width;
  const naturalH = img.naturalHeight || img.height;

  if (!naturalW || !naturalH) {
    throw new Error('Could not read photo dimensions. Please retake the photo.');
  }

  const longestEdge = Math.max(naturalW, naturalH);
  const scale =
    longestEdge > MAX_LONGEST_EDGE_PX ? MAX_LONGEST_EDGE_PX / longestEdge : 1;

  let targetW = Math.max(1, Math.round(naturalW * scale));
  let targetH = Math.max(1, Math.round(naturalH * scale));

  const renderCanvas = (w: number, h: number): HTMLCanvasElement => {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Browser image encoder unavailable on this device.');
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, w, h);
    return canvas;
  };

  let canvas = renderCanvas(targetW, targetH);

  // Probe WebP support cleanly; fallback to JPEG on older Safari/WebViews
  const probeWebp = await canvasToBlob(canvas, 'image/webp', 0.82);
  const supportsWebp = Boolean(probeWebp && probeWebp.type === 'image/webp');
  const preferredMime: 'image/webp' | 'image/jpeg' = supportsWebp
    ? 'image/webp'
    : 'image/jpeg';

  let bestBlob: Blob | null = supportsWebp
    ? probeWebp
    : await canvasToBlob(canvas, 'image/jpeg', 0.82);

  // Iteratively step down quality to target <= 250 KB
  const qualitySteps = [0.74, 0.64, 0.54, 0.44, 0.36];
  for (const q of qualitySteps) {
    if (bestBlob && bestBlob.size <= TARGET_MAX_BYTES) break;
    const candidate = await canvasToBlob(canvas, preferredMime, q);
    if (candidate) {
      bestBlob = candidate;
    }
  }

  // Final dimension downscale pass (960px longest edge) if photo is still very dense
  if (bestBlob && bestBlob.size > TARGET_MAX_BYTES && Math.max(targetW, targetH) > 960) {
    const downScale = 960 / Math.max(targetW, targetH);
    targetW = Math.max(1, Math.round(targetW * downScale));
    targetH = Math.max(1, Math.round(targetH * downScale));
    canvas = renderCanvas(targetW, targetH);
    const compact = await canvasToBlob(canvas, preferredMime, 0.52);
    if (compact) {
      bestBlob = compact;
    }
  }

  if (!bestBlob) {
    throw new Error('Image compression failed. Please retake the photo.');
  }

  const ext = preferredMime === 'image/webp' ? 'webp' : 'jpg';
  const uniqueStamp = `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const fileName = `${toSafeBaseName(file.name)}-${uniqueStamp}.${ext}`;

  return {
    blob: bestBlob,
    fileName,
    mimeType: preferredMime,
    originalKb: Math.max(1, Math.round(file.size / 1024)),
    compressedKb: Math.max(1, Math.round(bestBlob.size / 1024)),
    width: targetW,
    height: targetH,
  };
}

const AVATAR_MAX_DIMENSION_PX = 512;
const AVATAR_TARGET_MAX_BYTES = 150 * 1024; // 150 KB target ceiling

/**
 * Compresses a user profile avatar to a square WebP (max 512x512, <= 150 KB)
 * with center-crop framing for fast uploads to `avatars/<uid>/...`.
 */
export async function compressAvatarToWebp(
  file: File
): Promise<CompressedPodResult> {
  if (!file) {
    throw new Error('Select a profile photo first.');
  }

  const normalizedType = (file.type || '').toLowerCase();
  const hasImagePrefix = normalizedType.startsWith('image/');
  if (
    !hasImagePrefix ||
    (normalizedType && !ALLOWED_INPUT_MIME_TYPES.has(normalizedType))
  ) {
    throw new Error(
      'Unsupported image format. Please upload a JPG, PNG, or WebP photo.'
    );
  }

  if (file.size <= 0) {
    throw new Error('Selected image appears empty. Please choose another photo.');
  }

  if (file.size > MAX_RAW_INPUT_BYTES) {
    throw new Error(
      'Image exceeds the 15 MB input limit. Please choose a smaller photo.'
    );
  }

  const img = await loadFileIntoImage(file);
  const naturalW = img.naturalWidth || img.width;
  const naturalH = img.naturalHeight || img.height;
  if (!naturalW || !naturalH) {
    throw new Error('Could not read image dimensions.');
  }

  const cropSize = Math.min(naturalW, naturalH);
  const sx = Math.floor((naturalW - cropSize) / 2);
  const sy = Math.floor((naturalH - cropSize) / 2);
  let targetSize = Math.min(cropSize, AVATAR_MAX_DIMENSION_PX);

  const renderSquare = (dim: number): HTMLCanvasElement => {
    const canvas = document.createElement('canvas');
    canvas.width = dim;
    canvas.height = dim;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Browser image encoder unavailable on this device.');
    }
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, sx, sy, cropSize, cropSize, 0, 0, dim, dim);
    return canvas;
  };

  let canvas = renderSquare(targetSize);
  const probeWebp = await canvasToBlob(canvas, 'image/webp', 0.84);
  const supportsWebp = Boolean(probeWebp && probeWebp.type === 'image/webp');
  const preferredMime: 'image/webp' | 'image/jpeg' = supportsWebp
    ? 'image/webp'
    : 'image/jpeg';

  let bestBlob: Blob | null = supportsWebp
    ? probeWebp
    : await canvasToBlob(canvas, 'image/jpeg', 0.84);

  for (const q of [0.76, 0.66, 0.56, 0.46, 0.36]) {
    if (bestBlob && bestBlob.size <= AVATAR_TARGET_MAX_BYTES) break;
    const candidate = await canvasToBlob(canvas, preferredMime, q);
    if (candidate) bestBlob = candidate;
  }

  if (bestBlob && bestBlob.size > AVATAR_TARGET_MAX_BYTES && targetSize > 320) {
    targetSize = 320;
    canvas = renderSquare(targetSize);
    const compact = await canvasToBlob(canvas, preferredMime, 0.58);
    if (compact) bestBlob = compact;
  }

  if (!bestBlob) {
    throw new Error('Avatar compression failed. Please try another photo.');
  }

  const ext = preferredMime === 'image/webp' ? 'webp' : 'jpg';
  const fileName = `avatar-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.${ext}`;

  return {
    blob: bestBlob,
    fileName,
    mimeType: preferredMime,
    originalKb: Math.max(1, Math.round(file.size / 1024)),
    compressedKb: Math.max(1, Math.round(bestBlob.size / 1024)),
    width: targetSize,
    height: targetSize,
  };
}

