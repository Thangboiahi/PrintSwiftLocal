'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  Camera,
  Check,
  Loader2,
  Move,
  RefreshCw,
  RotateCcw,
  Upload,
  ZoomIn,
} from 'lucide-react';
import { mapSupabaseAuthError, safeFetchJson } from '@/lib/validators';

const ALLOWED_AVATAR_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const;

const MAX_RAW_AVATAR_SIZE_BYTES = 10 * 1024 * 1024; // 10MB raw limit
const EXPORT_DIMENSION_PX = 400;
const PREVIEW_DIMENSION_PX = 208;

export interface AvatarCropUploaderProps {
  userId?: string;
  currentAvatarUrl?: string | null;
  onUploadComplete: (url: string) => void;
  className?: string;
}

export function AvatarCropUploader({
  userId = 'user',
  currentAvatarUrl,
  onUploadComplete,
  className = '',
}: AvatarCropUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const previewCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const loadedImageRef = useRef<HTMLImageElement | null>(null);

  const [imageLoaded, setImageLoaded] = useState(false);
  const [zoom, setZoom] = useState<number>(1);
  const [offset, setOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{
    pointerX: number;
    pointerY: number;
    startOffsetX: number;
    startOffsetY: number;
  } | null>(null);

  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedPreviewUrl, setUploadedPreviewUrl] = useState<string | null>(
    null
  );
  const [lastCompressedBlob, setLastCompressedBlob] = useState<Blob | null>(
    null
  );
  const [compressedSizeKb, setCompressedSizeKb] = useState<number | null>(null);
  const [skippedPhoto, setSkippedPhoto] = useState(false);

  const displayAvatarUrl = uploadedPreviewUrl || currentAvatarUrl || null;

  // Draw the current loaded image onto a target canvas using 1:1 square center-cover + zoom + pan offset
  const renderCropToCanvas = useCallback(
    (
      canvas: HTMLCanvasElement,
      targetSize: number,
      currentZoom: number,
      currentOffset: { x: number; y: number }
    ) => {
      const img = loadedImageRef.current;
      if (!img) return;

      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      canvas.width = targetSize;
      canvas.height = targetSize;

      ctx.clearRect(0, 0, targetSize, targetSize);
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, targetSize, targetSize);

      const scaleToCover = Math.max(
        targetSize / Math.max(1, img.naturalWidth),
        targetSize / Math.max(1, img.naturalHeight)
      );
      const finalScale = scaleToCover * currentZoom;

      const drawWidth = img.naturalWidth * finalScale;
      const drawHeight = img.naturalHeight * finalScale;

      const ratio = targetSize / PREVIEW_DIMENSION_PX;
      const maxPanX = Math.max(0, (drawWidth - targetSize) / 2);
      const maxPanY = Math.max(0, (drawHeight - targetSize) / 2);

      const clampedOffsetX = Math.max(
        -maxPanX,
        Math.min(maxPanX, currentOffset.x * ratio)
      );
      const clampedOffsetY = Math.max(
        -maxPanY,
        Math.min(maxPanY, currentOffset.y * ratio)
      );

      const drawX = (targetSize - drawWidth) / 2 + clampedOffsetX;
      const drawY = (targetSize - drawHeight) / 2 + clampedOffsetY;

      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(img, drawX, drawY, drawWidth, drawHeight);
    },
    []
  );

  const exportCroppedWebpBlob = useCallback(async (): Promise<Blob> => {
    if (!loadedImageRef.current) {
      throw new Error('No image loaded to crop.');
    }

    const exportCanvas = document.createElement('canvas');
    renderCropToCanvas(exportCanvas, EXPORT_DIMENSION_PX, zoom, offset);

    const encodeAtQuality = (q: number) =>
      new Promise<Blob>((resolve, reject) => {
        exportCanvas.toBlob(
          (blob) => {
            if (!blob) {
              reject(new Error('Failed to compress cropped avatar image.'));
              return;
            }
            resolve(blob);
          },
          'image/webp',
          q
        );
      });

    let blob = await encodeAtQuality(0.8);
    if (blob.size > 50 * 1024) {
      blob = await encodeAtQuality(0.68);
    }
    return blob;
  }, [offset, renderCropToCanvas, zoom]);

  // Redraw preview canvas and estimate WebP size whenever image, zoom, or offset updates
  useEffect(() => {
    if (!imageLoaded || !previewCanvasRef.current) return;
    renderCropToCanvas(
      previewCanvasRef.current,
      PREVIEW_DIMENSION_PX,
      zoom,
      offset
    );

    let cancelled = false;
    const timer = setTimeout(() => {
      void exportCroppedWebpBlob()
        .then((blob) => {
          if (!cancelled) {
            setCompressedSizeKb(Math.max(1, Math.round(blob.size / 102.4) / 10));
          }
        })
        .catch(() => {
          // ignore live estimate errors
        });
    }, 120);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [imageLoaded, zoom, offset, renderCropToCanvas, exportCroppedWebpBlob]);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setErrorMessage(null);
    setSkippedPhoto(false);
    setLastCompressedBlob(null);
    setCompressedSizeKb(null);

    const file = e.target.files?.[0];
    if (!file) return;

    if (
      !(ALLOWED_AVATAR_MIME_TYPES as readonly string[]).includes(file.type)
    ) {
      setErrorMessage(
        'Unsupported image format. Please select a JPEG, PNG, or WebP file.'
      );
      e.target.value = '';
      return;
    }

    if (file.size > MAX_RAW_AVATAR_SIZE_BYTES) {
      const sizeMb = (file.size / (1024 * 1024)).toFixed(1);
      setErrorMessage(
        `Selected image is ${sizeMb} MB. Please choose a file smaller than 10 MB.`
      );
      e.target.value = '';
      return;
    }

    const objectUrl = URL.createObjectURL(file);
    const img = new Image();

    img.onload = () => {
      URL.revokeObjectURL(objectUrl);
      if (img.naturalWidth < 32 || img.naturalHeight < 32) {
        setErrorMessage(
          'Image dimensions are too small. Please upload an image at least 32x32 pixels.'
        );
        return;
      }
      loadedImageRef.current = img;
      setZoom(1);
      setOffset({ x: 0, y: 0 });
      setImageLoaded(true);
    };

    img.onerror = () => {
      URL.revokeObjectURL(objectUrl);
      loadedImageRef.current = null;
      setImageLoaded(false);
      setErrorMessage(
        'Failed to decode image file. The file appears corrupt or unreadable.'
      );
    };

    img.src = objectUrl;
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!imageLoaded) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
    dragStartRef.current = {
      pointerX: e.clientX,
      pointerY: e.clientY,
      startOffsetX: offset.x,
      startOffsetY: offset.y,
    };
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!isDragging || !dragStartRef.current || !loadedImageRef.current) return;
    const dx = e.clientX - dragStartRef.current.pointerX;
    const dy = e.clientY - dragStartRef.current.pointerY;

    const img = loadedImageRef.current;
    const scaleToCover = Math.max(
      PREVIEW_DIMENSION_PX / Math.max(1, img.naturalWidth),
      PREVIEW_DIMENSION_PX / Math.max(1, img.naturalHeight)
    );
    const drawWidth = img.naturalWidth * scaleToCover * zoom;
    const drawHeight = img.naturalHeight * scaleToCover * zoom;
    const maxPanX = Math.max(0, (drawWidth - PREVIEW_DIMENSION_PX) / 2);
    const maxPanY = Math.max(0, (drawHeight - PREVIEW_DIMENSION_PX) / 2);

    setOffset({
      x: Math.max(
        -maxPanX,
        Math.min(maxPanX, dragStartRef.current.startOffsetX + dx)
      ),
      y: Math.max(
        -maxPanY,
        Math.min(maxPanY, dragStartRef.current.startOffsetY + dy)
      ),
    });
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (isDragging) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore if pointer capture already released
      }
    }
    setIsDragging(false);
    dragStartRef.current = null;
  };

  const executeBlobUpload = useCallback(
    async (blobToUpload: Blob) => {
      setIsUploading(true);
      setErrorMessage(null);
      setSkippedPhoto(false);

      try {
        const safeUserId =
          (userId || 'signup').replace(/[^a-zA-Z0-9_-]/g, '-') || 'signup';

        const formData = new FormData();
        formData.append('file', blobToUpload, `${safeUserId}.webp`);
        formData.append('entityType', 'profile');
        if (userId && userId !== 'user' && userId !== 'signup') {
          formData.append('entityId', userId);
        }
        formData.append('userId', safeUserId);

        const payload = await safeFetchJson<{
          url?: string;
          success?: boolean;
          error?: string;
        }>('/api/media/upload', {
          method: 'POST',
          body: formData,
        });

        if (!payload?.url) {
          throw new Error(
            payload?.error ||
              'Could not resolve public URL for uploaded avatar.'
          );
        }

        setUploadedPreviewUrl(payload.url);
        setImageLoaded(false);
        setLastCompressedBlob(null);
        onUploadComplete(payload.url);
      } catch (err) {
        const mapped = mapSupabaseAuthError(err);
        const lower = mapped.toLowerCase();
        if (lower.includes('bucket not found')) {
          setErrorMessage(
            'Storage bucket not found ("avatars" / media bucket is not provisioned yet). You can retry or skip the photo for now.'
          );
        } else {
          setErrorMessage(mapped);
        }
      } finally {
        setIsUploading(false);
      }
    },
    [onUploadComplete, userId]
  );

  const handleConfirmCropAndUpload = async () => {
    setErrorMessage(null);
    try {
      const blob = await exportCroppedWebpBlob();
      setLastCompressedBlob(blob);
      setCompressedSizeKb(Math.max(1, Math.round(blob.size / 102.4) / 10));
      await executeBlobUpload(blob);
    } catch (err) {
      setErrorMessage(
        err instanceof Error
          ? err.message
          : 'Failed to process avatar image. Please try another photo.'
      );
    }
  };

  const handleRetryUpload = async () => {
    if (lastCompressedBlob) {
      await executeBlobUpload(lastCompressedBlob);
    } else if (imageLoaded) {
      await handleConfirmCropAndUpload();
    }
  };

  const handleSkipPhotoForNow = () => {
    loadedImageRef.current = null;
    setImageLoaded(false);
    setErrorMessage(null);
    setLastCompressedBlob(null);
    setSkippedPhoto(true);
    onUploadComplete('');
  };

  return (
    <div
      data-testid="avatar-crop-uploader"
      className={`flex flex-col gap-3 w-full rounded-2xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-surface)] p-4 shadow-xs ${className}`}
    >
      {/* 1. Top Row: Compact Header + Select / Change Photo Button */}
      <div className="flex items-center justify-between gap-3 w-full">
        <div className="flex items-center gap-3 min-w-0">
          <div className="relative h-12 w-12 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-800 bg-[var(--ps-surface-alt)] flex items-center justify-center shrink-0">
            {displayAvatarUrl?.trim() ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={displayAvatarUrl.trim()}
                alt="Current profile avatar"
                referrerPolicy="no-referrer"
                className="h-full w-full object-cover"
              />
            ) : (
              <Camera className="h-5 w-5 text-[var(--ps-text-muted)]" />
            )}
          </div>
          <div className="min-w-0">
            <p className="text-xs font-bold text-[var(--ps-text)] truncate">
              Profile Avatar (1:1 Square)
            </p>
            <p className="text-[11px] text-[var(--ps-text-muted)] truncate">
              {skippedPhoto
                ? 'Skipped for now · Optional 400×400 WebP'
                : 'JPEG, PNG, or WebP · 400×400 WebP'}
            </p>
          </div>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          onChange={handleFileChange}
          className="hidden"
          data-testid="avatar-file-input"
        />

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isUploading}
          data-testid="select-avatar-btn"
          className="min-h-[44px] px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-[var(--ps-bg)] hover:bg-[var(--ps-surface-alt)] text-xs font-semibold text-[var(--ps-text)] inline-flex items-center gap-1.5 shrink-0 transition-colors disabled:opacity-50"
        >
          <Upload className="h-4 w-4 text-[var(--ps-accent)]" />
          <span>{displayAvatarUrl ? 'Change Photo' : 'Select Photo'}</span>
        </button>
      </div>

      {/* Inline Storage Error Alert with Retry Upload AND Skip Photo for Now */}
      {errorMessage && (
        <div
          role="alert"
          data-testid="avatar-crop-error"
          className="rounded-xl border border-rose-500/40 bg-rose-500/10 p-3 flex flex-col gap-2.5 text-xs text-rose-700 dark:text-rose-300"
        >
          <div className="flex items-start gap-2">
            <AlertCircle className="h-4 w-4 shrink-0 mt-0.5 text-rose-600 dark:text-rose-400" />
            <span>{errorMessage}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {(lastCompressedBlob || imageLoaded) && (
              <button
                type="button"
                onClick={() => void handleRetryUpload()}
                disabled={isUploading}
                data-testid="retry-avatar-upload-btn"
                className="min-h-[44px] px-3.5 py-1.5 rounded-xl bg-rose-600 text-white font-semibold hover:bg-rose-700 inline-flex items-center justify-center gap-1.5 transition-colors disabled:opacity-50"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Retry Upload</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleSkipPhotoForNow}
              disabled={isUploading}
              data-testid="skip-avatar-upload-btn"
              className="min-h-[44px] px-3.5 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white/80 dark:bg-slate-900/80 text-slate-700 dark:text-slate-200 font-semibold hover:bg-slate-100 dark:hover:bg-slate-800 inline-flex items-center justify-center transition-colors disabled:opacity-50"
            >
              Skip Photo for Now
            </button>
          </div>
        </div>
      )}

      {/* 2 & 3. Vertical Stacked Interactive Crop Preview + Full-Width Controls */}
      {imageLoaded && (
        <div
          data-testid="avatar-crop-workspace"
          className="relative z-0 overflow-hidden flex flex-col gap-3 w-full pt-3 border-t border-slate-200 dark:border-slate-800"
        >
          {/* 2. Center Square Preview */}
          <div className="relative z-0 w-44 h-44 sm:w-52 sm:h-52 mx-auto rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-800 shadow-xs shrink-0 select-none touch-none">
            <canvas
              ref={previewCanvasRef}
              width={PREVIEW_DIMENSION_PX}
              height={PREVIEW_DIMENSION_PX}
              onPointerDown={handlePointerDown}
              onPointerMove={handlePointerMove}
              onPointerUp={handlePointerUp}
              onPointerCancel={handlePointerUp}
              data-testid="avatar-crop-canvas"
              className="block w-full h-full cursor-grab active:cursor-grabbing"
            />
            <div className="pointer-events-none absolute inset-0 border border-white/20 rounded-2xl" />
            <div className="pointer-events-none absolute bottom-2 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full bg-slate-950/75 text-[10px] font-medium text-white inline-flex items-center gap-1 whitespace-nowrap">
              <Move className="h-3 w-3" />
              <span>Drag to reposition</span>
            </div>
          </div>

          {/* 3. Controls Stack (Full Width below preview) */}
          <div className="flex flex-col gap-3 w-full">
            {/* Full-width Zoom slider row */}
            <div className="flex flex-col gap-1.5 w-full">
              <div className="flex items-center justify-between text-xs w-full">
                <span className="font-semibold text-[var(--ps-text)] inline-flex items-center gap-1.5">
                  <ZoomIn className="h-3.5 w-3.5 text-blue-600 dark:text-blue-400" />
                  <span>Zoom ({zoom.toFixed(2)}x)</span>
                </span>
                <button
                  type="button"
                  onClick={() => {
                    setZoom(1);
                    setOffset({ x: 0, y: 0 });
                  }}
                  className="text-[11px] font-semibold text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] inline-flex items-center gap-1 py-1 px-2 rounded-lg"
                >
                  <RotateCcw className="h-3 w-3" />
                  <span>Reset</span>
                </button>
              </div>

              <div className="flex items-center justify-between gap-3 w-full">
                <span className="text-[11px] font-mono text-[var(--ps-text-muted)] shrink-0">
                  1.00x
                </span>
                <input
                  type="range"
                  min={1}
                  max={3}
                  step={0.05}
                  value={zoom}
                  onChange={(e) => setZoom(parseFloat(e.target.value) || 1)}
                  aria-label="Avatar crop zoom level"
                  data-testid="avatar-zoom-slider"
                  className="w-full accent-blue-600 cursor-pointer"
                />
                <span className="text-[11px] font-mono text-[var(--ps-text-muted)] shrink-0">
                  3.00x
                </span>
              </div>
            </div>

            {/* Metadata & Action row */}
            <div className="flex flex-col sm:flex-row items-center justify-between gap-2 w-full pt-1">
              <div className="text-[11px] text-emerald-600 dark:text-emerald-400 font-semibold w-full sm:w-auto text-center sm:text-left">
                Optimized WebP:{' '}
                {compressedSizeKb !== null
                  ? `${compressedSizeKb.toFixed(1)} KB`
                  : '< 50.0 KB'}
              </div>

              <button
                type="button"
                onClick={() => void handleConfirmCropAndUpload()}
                disabled={isUploading}
                data-testid="confirm-avatar-crop-btn"
                className="min-h-[44px] w-full sm:w-auto px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-50"
              >
                {isUploading ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Uploading WebP...</span>
                  </>
                ) : (
                  <>
                    <Check className="h-4 w-4" />
                    <span>Confirm &amp; Upload Avatar</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default AvatarCropUploader;
