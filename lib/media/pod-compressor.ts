'use client';

import { compressImageWithPreset } from '@/lib/media/image-compressor';

/**
 * Dependency-free client-side Proof-of-Delivery (POD) & Avatar image compressor.
 * Delegates POD compression to the shared WebP pipeline (`<= 250 KB`, 1280px max edge).
 */

const MAX_RAW_INPUT_BYTES = 15 * 1024 * 1024; // 15 MB raw camera ceiling

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
  const res = await compressImageWithPreset(file, 'pod');
  return {
    blob: res.blob,
    fileName: res.fileName,
    mimeType: res.mimeType === 'image/jpeg' ? 'image/jpeg' : 'image/webp',
    originalKb: res.originalKb,
    compressedKb: res.compressedKb,
    width: res.width,
    height: res.height,
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

