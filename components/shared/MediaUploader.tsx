'use client';

import React, { useRef, useState } from 'react';
import { AlertCircle, CheckCircle2, ImagePlus, Loader2, Upload } from 'lucide-react';
import {
  ALLOWED_MEDIA_MIME_TYPES,
  uploadListingImage,
  uploadPanorama,
} from '@/lib/supabase/storage';

export interface MediaUploaderProps {
  mode?: 'image' | 'panorama';
  listingId?: string;
  label?: string;
  helperText?: string;
  onUploadSuccess: (publicUrl: string) => void;
  onUploadError?: (errorMessage: string) => void;
  className?: string;
  dataTestId?: string;
}

export function MediaUploader({
  mode = 'image',
  listingId = 'draft',
  label,
  helperText = 'JPEG, PNG, or WebP up to 5 MB',
  onUploadSuccess,
  onUploadError,
  className = '',
  dataTestId = 'media-uploader',
}: MediaUploaderProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [uploadedUrl, setUploadedUrl] = useState<string | null>(null);

  const effectiveLabel =
    label ||
    (mode === 'panorama'
      ? 'Upload 360° Equirectangular Panorama'
      : 'Upload Listing Image');

  const processFile = async (file: File) => {
    setIsUploading(true);
    setErrorMessage(null);
    setUploadedUrl(null);

    try {
      const result =
        mode === 'panorama'
          ? await uploadPanorama(file, listingId)
          : await uploadListingImage(file, listingId);

      setUploadedUrl(result.publicUrl);
      onUploadSuccess(result.publicUrl);
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Failed to upload media file. Please try again.';
      setErrorMessage(msg);
      onUploadError?.(msg);
    } finally {
      setIsUploading(false);
      if (inputRef.current) {
        inputRef.current.value = '';
      }
    }
  };

  const handleFileChange = (ev: React.ChangeEvent<HTMLInputElement>) => {
    const file = ev.target.files?.[0];
    if (!file) return;
    void processFile(file);
  };

  const handleDragOver = (ev: React.DragEvent<HTMLDivElement>) => {
    ev.preventDefault();
    ev.stopPropagation();
    if (!isUploading) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (ev: React.DragEvent<HTMLDivElement>) => {
    ev.preventDefault();
    ev.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (ev: React.DragEvent<HTMLDivElement>) => {
    ev.preventDefault();
    ev.stopPropagation();
    setIsDragging(false);
    if (isUploading) return;
    const file = ev.dataTransfer.files?.[0];
    if (!file) return;
    void processFile(file);
  };

  return (
    <div data-testid={dataTestId} className={`space-y-2 ${className}`}>
      <div
        role="button"
        tabIndex={0}
        aria-label={effectiveLabel}
        aria-busy={isUploading}
        onClick={() => {
          if (!isUploading) {
            inputRef.current?.click();
          }
        }}
        onKeyDown={(ev) => {
          if ((ev.key === 'Enter' || ev.key === ' ') && !isUploading) {
            ev.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={`rounded-2xl border-2 border-dashed p-5 text-center transition-colors cursor-pointer flex flex-col items-center justify-center gap-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ps-ring)] ${
          isDragging
            ? 'border-[var(--ps-accent)] bg-[var(--ps-surface-alt)]/70'
            : 'border-[var(--ps-border)] bg-[var(--ps-surface)] hover:border-[var(--ps-accent)]/60 hover:bg-[var(--ps-surface-alt)]/40'
        } ${isUploading ? 'opacity-75 pointer-events-none' : ''}`}
      >
        <input
          ref={inputRef}
          type="file"
          accept={ALLOWED_MEDIA_MIME_TYPES.join(',')}
          onChange={handleFileChange}
          disabled={isUploading}
          data-testid={`${dataTestId}-input`}
          className="sr-only"
        />

        <div className="w-10 h-10 rounded-xl bg-[var(--ps-surface-alt)] border border-[var(--ps-border)] flex items-center justify-center text-[var(--ps-accent)]">
          {isUploading ? (
            <Loader2 className="w-5 h-5 animate-spin" aria-hidden="true" />
          ) : mode === 'panorama' ? (
            <ImagePlus className="w-5 h-5" aria-hidden="true" />
          ) : (
            <Upload className="w-5 h-5" aria-hidden="true" />
          )}
        </div>

        <div className="space-y-0.5">
          <p className="text-xs font-bold text-[var(--ps-text)]">
            {isUploading ? 'Uploading media to storage…' : effectiveLabel}
          </p>
          <p className="text-[11px] text-[var(--ps-text-muted)]">
            {isUploading
              ? 'Validating format and transferring file…'
              : `Drag & drop or click to browse (${helperText})`}
          </p>
        </div>
      </div>

      {errorMessage && (
        <div
          role="status"
          aria-live="polite"
          data-testid={`${dataTestId}-error`}
          className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2"
        >
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span>{errorMessage}</span>
        </div>
      )}

      {uploadedUrl && !errorMessage && (
        <div
          role="status"
          aria-live="polite"
          data-testid={`${dataTestId}-success`}
          className="rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300 flex items-center justify-between gap-2"
        >
          <span className="inline-flex items-center gap-1.5 font-semibold truncate">
            <CheckCircle2 className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span className="truncate">Upload complete</span>
          </span>
          <span className="font-mono text-[10px] truncate max-w-[180px]">
            {uploadedUrl}
          </span>
        </div>
      )}
    </div>
  );
}

export default MediaUploader;
