'use client';

/**
 * Shared client-side WebP compression pipeline for DD oodle (v21b P1-04).
 * Enforces bounded dimensions and target file size ceilings before uploading
 * to Supabase Storage or `/api/media/upload`.
 *
 * Presets:
 * - avatar:      <= 150 KB, maxEdge 512px
 * - pod:         <= 250 KB, maxEdge 1280px
 * - gallery:     <= 350 KB, maxEdge 1600px (listings, marketplace, banners, flyers)
 * - panorama360: <= 1500 KB, maxEdge 4096px
 * - kyc:         <= 500 KB, maxEdge 1800px (passes PDF through untouched)
 */

export type ImageCompressionPreset =
  | 'avatar'
  | 'pod'
  | 'gallery'
  | 'panorama360'
  | 'kyc';

export interface PresetConfig {
  maxLongestEdgePx: number;
  targetMaxBytes: number;
  maxRawInputBytes: number;
  minQuality: number;
  startQuality: number;
  fallbackName: string;
}

export const IMAGE_COMPRESSION_PRESETS: Record<ImageCompressionPreset, PresetConfig> = {
  avatar: {
    maxLongestEdgePx: 512,
    targetMaxBytes: 150 * 1024,
    maxRawInputBytes: 12 * 1024 * 1024,
    startQuality: 0.84,
    minQuality: 0.4,
    fallbackName: 'avatar',
  },
  pod: {
    maxLongestEdgePx: 1280,
    targetMaxBytes: 250 * 1024,
    maxRawInputBytes: 15 * 1024 * 1024,
    startQuality: 0.82,
    minQuality: 0.42,
    fallbackName: 'pod-capture',
  },
  gallery: {
    maxLongestEdgePx: 1600,
    targetMaxBytes: 350 * 1024,
    maxRawInputBytes: 15 * 1024 * 1024,
    startQuality: 0.84,
    minQuality: 0.45,
    fallbackName: 'media-image',
  },
  panorama360: {
    maxLongestEdgePx: 4096,
    targetMaxBytes: 1500 * 1024,
    maxRawInputBytes: 25 * 1024 * 1024,
    startQuality: 0.86,
    minQuality: 0.55,
    fallbackName: 'panorama-360',
  },
  kyc: {
    maxLongestEdgePx: 1800,
    targetMaxBytes: 500 * 1024,
    maxRawInputBytes: 15 * 1024 * 1024,
    startQuality: 0.84,
    minQuality: 0.48,
    fallbackName: 'kyc-document',
  },
};

export interface CompressedImageResult {
  file: File;
  blob: Blob;
  fileName: string;
  mimeType: 'image/webp' | 'image/jpeg' | 'application/pdf' | 'image/svg+xml';
  originalKb: number;
  compressedKb: number;
  width: number;
  height: number;
  skippedCompression?: boolean;
}

const RASTER_INPUT_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
  'image/gif',
]);

function toSafeBaseName(rawName: string, fallback: string): string {
  const withoutExt = rawName.replace(/\.[^.]+$/, '');
  const sanitized = withoutExt
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
  return sanitized || fallback;
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
        new Error('Unable to decode this image. Please choose a JPG, PNG, or WebP file.')
      );
    };
    img.src = objectUrl;
  });
}

export async function compressImageWithPreset(
  file: File,
  preset: ImageCompressionPreset = 'gallery'
): Promise<CompressedImageResult> {
  if (!file) {
    throw new Error('Select an image file first.');
  }

  const cfg = IMAGE_COMPRESSION_PRESETS[preset];
  const normalizedType = (file.type || '').toLowerCase();
  const originalKb = Math.max(1, Math.round(file.size / 1024));

  if (file.size <= 0) {
    throw new Error('The selected file appears to be empty.');
  }

  // Pass PDFs and SVGs straight through without rasterizing
  if (normalizedType === 'application/pdf') {
    if (file.size > 10 * 1024 * 1024) {
      throw new Error('PDF file exceeds the 10 MB limit.');
    }
    return {
      file,
      blob: file,
      fileName: file.name,
      mimeType: 'application/pdf',
      originalKb,
      compressedKb: originalKb,
      width: 0,
      height: 0,
      skippedCompression: true,
    };
  }

  if (normalizedType === 'image/svg+xml') {
    return {
      file,
      blob: file,
      fileName: file.name,
      mimeType: 'image/svg+xml',
      originalKb,
      compressedKb: originalKb,
      width: 0,
      height: 0,
      skippedCompression: true,
    };
  }

  if (
    !normalizedType.startsWith('image/') ||
    (normalizedType && !RASTER_INPUT_MIME_TYPES.has(normalizedType))
  ) {
    throw new Error('Unsupported image format. Please use JPG, PNG, or WebP.');
  }

  if (file.size > cfg.maxRawInputBytes) {
    const maxMb = Math.round(cfg.maxRawInputBytes / (1024 * 1024));
    throw new Error(`Image exceeds the ${maxMb} MB raw input limit.`);
  }

  // Fallback for non-DOM environments
  if (typeof document === 'undefined') {
    return {
      file,
      blob: file,
      fileName: file.name,
      mimeType: normalizedType === 'image/webp' ? 'image/webp' : 'image/jpeg',
      originalKb,
      compressedKb: originalKb,
      width: 0,
      height: 0,
      skippedCompression: true,
    };
  }

  const img = await loadFileIntoImage(file);
  const naturalW = img.naturalWidth || img.width;
  const naturalH = img.naturalHeight || img.height;

  if (!naturalW || !naturalH) {
    throw new Error('Could not read image dimensions.');
  }

  const longestEdge = Math.max(naturalW, naturalH);
  const initialScale =
    longestEdge > cfg.maxLongestEdgePx ? cfg.maxLongestEdgePx / longestEdge : 1;

  let targetW = Math.max(1, Math.round(naturalW * initialScale));
  let targetH = Math.max(1, Math.round(naturalH * initialScale));

  const renderCanvas = (w: number, h: number): HTMLCanvasElement => {
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Browser image encoder unavailable on this device.');
    }
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    return canvas;
  };

  let canvas = renderCanvas(targetW, targetH);
  let outputMime: 'image/webp' | 'image/jpeg' = 'image/webp';
  let bestBlob = await canvasToBlob(canvas, outputMime, cfg.startQuality);

  if (!bestBlob || bestBlob.type !== 'image/webp') {
    outputMime = 'image/jpeg';
    bestBlob = await canvasToBlob(canvas, outputMime, cfg.startQuality);
  }

  if (!bestBlob) {
    throw new Error('Failed to encode compressed image.');
  }

  // Step down quality, then downscale dimensions if still over target ceiling
  let quality = cfg.startQuality;
  while (bestBlob.size > cfg.targetMaxBytes && quality > cfg.minQuality) {
    quality = Math.max(cfg.minQuality, Number((quality - 0.1).toFixed(2)));
    const candidate = await canvasToBlob(canvas, outputMime, quality);
    if (candidate && candidate.size < bestBlob.size) {
      bestBlob = candidate;
    }
  }

  let scaleStep = 0;
  while (bestBlob.size > cfg.targetMaxBytes && scaleStep < 2 && Math.max(targetW, targetH) > 480) {
    scaleStep += 1;
    targetW = Math.max(1, Math.round(targetW * 0.78));
    targetH = Math.max(1, Math.round(targetH * 0.78));
    canvas = renderCanvas(targetW, targetH);
    const candidate = await canvasToBlob(canvas, outputMime, cfg.minQuality);
    if (candidate && candidate.size < bestBlob.size) {
      bestBlob = candidate;
    }
  }

  const ext = outputMime === 'image/webp' ? 'webp' : 'jpg';
  const baseName = toSafeBaseName(file.name, cfg.fallbackName);
  const fileName = `${baseName}-${Date.now()}.${ext}`;
  const compressedFile = new File([bestBlob], fileName, { type: outputMime });

  return {
    file: compressedFile,
    blob: bestBlob,
    fileName,
    mimeType: outputMime,
    originalKb,
    compressedKb: Math.max(1, Math.round(bestBlob.size / 1024)),
    width: targetW,
    height: targetH,
  };
}
