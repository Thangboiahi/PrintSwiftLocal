'use client';

import React, { useRef, useState } from 'react';
import { Camera, Loader2, Trash2, Upload } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { resolveRemoteMediaUrl } from '@/lib/supabase/storage';

export interface QuickImageUploadFieldProps {
  label: string;
  value: string;
  entityType:
    | 'product_image'
    | 'menu_item_image'
    | 'resource_photo'
    | 'banner_image'
    | 'listing_gallery';
  entityId?: string | null;
  hubId?: string | null;
  maxWidthPx?: number;
  aspectClass?: string;
  helperText?: string;
  onUploaded: (nextUrl: string, storagePath: string | null) => void;
}

async function compressImageToWebPBlob(
  file: File,
  maxDim = 1080
): Promise<Blob> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = new window.Image();
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('Invalid image file.'));
      img.src = objectUrl;
    });
    const scale = Math.min(
      1,
      maxDim / Math.max(1, img.naturalWidth),
      maxDim / Math.max(1, img.naturalHeight)
    );
    const outW = Math.max(1, Math.round(img.naturalWidth * scale));
    const outH = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas unavailable.');
    ctx.drawImage(img, 0, 0, outW, outH);
    return await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => {
          if (b) return resolve(b);
          canvas.toBlob(
            (pngB) =>
              pngB ? resolve(pngB) : reject(new Error('Image export failed.')),
            'image/png'
          );
        },
        'image/webp',
        0.84
      );
    });
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export async function discardUploadedTempPaths(
  paths: string[],
  accessToken?: string | null
) {
  const cleaned = paths.filter((p) => typeof p === 'string' && p.trim().length > 0);
  if (cleaned.length === 0) return;
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }
    await fetch('/api/media/discard-temp', {
      method: 'POST',
      headers,
      body: JSON.stringify({ paths: cleaned }),
    });
  } catch {
    // Non-blocking cleanup
  }
}

export function QuickImageUploadField({
  label,
  value,
  entityType,
  entityId,
  hubId,
  maxWidthPx = 1080,
  aspectClass = 'w-20 h-20',
  helperText = 'Compressed WebP; cleared automatically if cancelled.',
  onUploaded,
}: QuickImageUploadFieldProps) {
  const { session } = useAuth();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [lastTempPath, setLastTempPath] = useState<string | null>(null);

  const handleSelect = async (file: File | undefined) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setErrorText('Choose a PNG, JPEG, or WebP image.');
      return;
    }
    setIsUploading(true);
    setErrorText(null);
    try {
      const blob = await compressImageToWebPBlob(file, maxWidthPx);
      const fd = new FormData();
      fd.append('file', blob, `${entityType}-${Date.now()}.webp`);
      fd.append('entityType', entityType);
      if (entityId) fd.append('entityId', entityId);
      if (hubId) fd.append('hubId', hubId);

      const headers: Record<string, string> = {};
      if (session?.access_token) {
        headers.Authorization = `Bearer ${session.access_token}`;
      }
      const res = await fetch('/api/media/upload', {
        method: 'POST',
        headers,
        body: fd,
      });
      const json = (await res.json().catch(() => null)) as {
        success?: boolean;
        url?: string;
        path?: string;
        error?: string;
      } | null;

      if (!res.ok || !json?.success || !json.url) {
        throw new Error(json?.error || 'Failed to upload image.');
      }
      if (lastTempPath) {
        void discardUploadedTempPaths([lastTempPath], session?.access_token);
      }
      setLastTempPath(json.path || null);
      onUploaded(json.url, json.path || null);
    } catch (err) {
      setErrorText(
        err instanceof Error ? err.message : 'Unable to upload photo.'
      );
    } finally {
      setIsUploading(false);
    }
  };

  const handleRemove = () => {
    if (lastTempPath) {
      void discardUploadedTempPaths([lastTempPath], session?.access_token);
      setLastTempPath(null);
    }
    onUploaded('', null);
  };

  const displaySrc = value ? resolveRemoteMediaUrl(value) : '';

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[11px] font-semibold text-[var(--ps-text-muted)]">
          {label}
        </span>
        {displaySrc && (
          <button
            type="button"
            onClick={handleRemove}
            className="inline-flex items-center gap-1 text-[10px] font-semibold text-rose-500 hover:underline cursor-pointer"
          >
            <Trash2 className="w-3 h-3" />
            Remove
          </button>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          void handleSelect(f);
        }}
      />

      <div className="flex items-center gap-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-2.5">
        <div
          className={`${aspectClass} rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] overflow-hidden shrink-0 flex items-center justify-center`}
        >
          {displaySrc ? (
            <img
              src={displaySrc}
              alt={label}
              className="w-full h-full object-cover"
            />
          ) : (
            <Camera className="w-5 h-5 text-[var(--ps-text-muted)]" />
          )}
        </div>
        <div className="flex-1 min-w-0 space-y-1.5">
          <p className="text-[10px] text-[var(--ps-text-muted)]">{helperText}</p>
          <button
            type="button"
            disabled={isUploading}
            onClick={() => inputRef.current?.click()}
            className="h-8 px-3 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] hover:border-[var(--ps-accent)] text-xs font-semibold text-[var(--ps-text)] inline-flex items-center gap-1.5 cursor-pointer disabled:opacity-60"
          >
            {isUploading ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <Upload className="w-3.5 h-3.5" />
            )}
            <span>{isUploading ? 'Uploading…' : displaySrc ? 'Replace Photo' : 'Upload Photo'}</span>
          </button>
        </div>
      </div>

      {errorText && (
        <p className="text-[10px] text-rose-500 font-medium">{errorText}</p>
      )}
    </div>
  );
}
