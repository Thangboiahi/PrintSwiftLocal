'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Camera,
  Check,
  Compass,
  Crop,
  Image as ImageIcon,
  Info,
  Loader2,
  Plus,
  RotateCw,
  ShieldCheck,
  Sparkles,
  Trash2,
  Upload,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';

export type CropPresetKey = 'logo_1_1' | 'cover_16_9' | 'gallery_4_3';

export interface StagedMediaItem {
  blob?: Blob;
  previewUrl: string;
  width?: number;
  height?: number;
  sizeBytes?: number;
  mimeType?: string;
  isStagedNew?: boolean;
}

export interface StagedPanorama360View {
  id: string;
  label: string;
  item: StagedMediaItem;
  aspectRatioLabel?: string;
}

export interface ListingMediaDraft {
  logo: StagedMediaItem | null;
  cover: StagedMediaItem | null;
  gallery: StagedMediaItem[];
  panorama: StagedMediaItem | null;
  panoramas360?: StagedPanorama360View[];
}

export interface ListingMediaEditorProps {
  draft: ListingMediaDraft;
  onChange: (next: ListingMediaDraft) => void;
  maxMediaLimit: number; // -1 = unlimited
  max360Limit?: number; // -1 = unlimited
  showPanoramaSection?: boolean;
  listingTitle?: string;
  className?: string;
}

interface CropModalState {
  target: 'logo' | 'cover' | { galleryIndex: number | 'new' };
  preset: CropPresetKey;
  sourceUrl: string;
  naturalWidth: number;
  naturalHeight: number;
  zoom: number;
  offsetX: number; // normalized fraction of viewport width (-1..1)
  offsetY: number;
  rotationDeg: number; // 0, 90, 180, 270
}

const PRESET_CONFIG: Record<
  CropPresetKey,
  {
    label: string;
    aspect: number;
    maxOutW: number;
    maxOutH: number;
    hint: string;
  }
> = {
  logo_1_1: {
    label: 'Square Brand Logo (1:1)',
    aspect: 1,
    maxOutW: 256,
    maxOutH: 256,
    hint: 'Cropped & compressed to <=256x256 WebP for crisp circular Explore map pins.',
  },
  cover_16_9: {
    label: 'Cover Banner (16:9)',
    aspect: 16 / 9,
    maxOutW: 1280,
    maxOutH: 720,
    hint: 'Cropped to <=1280px wide for storefront headers & homepage discovery cards.',
  },
  gallery_4_3: {
    label: 'Gallery Photo (4:3)',
    aspect: 4 / 3,
    maxOutW: 1200,
    maxOutH: 900,
    hint: 'Optimized WebP gallery image uploaded only after you confirm submission.',
  },
};

function revokeIfBlobUrl(url?: string | null) {
  if (url && url.startsWith('blob:')) {
    try {
      URL.revokeObjectURL(url);
    } catch {
      // Ignore already-revoked blob URL
    }
  }
}

export function revokeMediaDraftPreviews(draft: ListingMediaDraft) {
  if (draft.logo?.isStagedNew) revokeIfBlobUrl(draft.logo.previewUrl);
  if (draft.cover?.isStagedNew) revokeIfBlobUrl(draft.cover.previewUrl);
  if (draft.panorama?.isStagedNew) revokeIfBlobUrl(draft.panorama.previewUrl);
  draft.gallery.forEach((item) => {
    if (item.isStagedNew) revokeIfBlobUrl(item.previewUrl);
  });
  (draft.panoramas360 || []).forEach((view) => {
    if (view.item?.isStagedNew) revokeIfBlobUrl(view.item.previewUrl);
  });
}

function readImageDimensions(
  src: string
): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new window.Image();
    img.onload = () =>
      resolve({ width: img.naturalWidth || 1, height: img.naturalHeight || 1 });
    img.onerror = () => reject(new Error('Failed to load selected image.'));
    img.src = src;
  });
}

async function compressFileDirect(
  file: File,
  maxWidth: number,
  maxHeight: number,
  quality = 0.85
): Promise<StagedMediaItem> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const dims = await readImageDimensions(objectUrl);
    const scale = Math.min(1, maxWidth / dims.width, maxHeight / dims.height);
    const outW = Math.max(1, Math.round(dims.width * scale));
    const outH = Math.max(1, Math.round(dims.height * scale));

    const img = new window.Image();
    await new Promise<void>((res, rej) => {
      img.onload = () => res();
      img.onerror = () => rej(new Error('Unable to decode image file.'));
      img.src = objectUrl;
    });

    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Browser canvas context unavailable.');
    }
    ctx.drawImage(img, 0, 0, outW, outH);

    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob(
        (b) => {
          if (b) return resolve(b);
          canvas.toBlob(
            (pngB) =>
              pngB
                ? resolve(pngB)
                : reject(new Error('Failed to encode compressed image.')),
            'image/png'
          );
        },
        'image/webp',
        quality
      );
    });

    const finalPreview = URL.createObjectURL(blob);
    revokeIfBlobUrl(objectUrl);
    return {
      blob,
      previewUrl: finalPreview,
      width: outW,
      height: outH,
      sizeBytes: blob.size,
      mimeType: blob.type || 'image/webp',
      isStagedNew: true,
    };
  } catch (err) {
    revokeIfBlobUrl(objectUrl);
    throw err;
  }
}

async function renderCroppedCanvasBlob(
  state: CropModalState
): Promise<StagedMediaItem> {
  const cfg = PRESET_CONFIG[state.preset];
  const img = new window.Image();
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error('Failed to read crop source image.'));
    img.src = state.sourceUrl;
  });

  const rotated = state.rotationDeg % 180 !== 0;
  const effW = rotated ? img.naturalHeight : img.naturalWidth;
  const effH = rotated ? img.naturalWidth : img.naturalHeight;

  const targetAspect = cfg.aspect;
  const outW = cfg.maxOutW;
  const outH = cfg.maxOutH;

  const canvas = document.createElement('canvas');
  canvas.width = outW;
  canvas.height = outH;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D context is unavailable.');

  ctx.clearRect(0, 0, outW, outH);

  // Base cover-fit scale so image fills the crop box at zoom = 1
  const srcAspect = effW / Math.max(1, effH);
  const baseScale =
    srcAspect > targetAspect ? outH / Math.max(1, effH) : outW / Math.max(1, effW);
  const drawScale = baseScale * state.zoom;

  const cx = outW / 2 + state.offsetX * (outW / 2);
  const cy = outH / 2 + state.offsetY * (outH / 2);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((state.rotationDeg * Math.PI) / 180);
  ctx.scale(drawScale, drawScale);
  ctx.drawImage(
    img,
    -img.naturalWidth / 2,
    -img.naturalHeight / 2,
    img.naturalWidth,
    img.naturalHeight
  );
  ctx.restore();

  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        if (b) return resolve(b);
        canvas.toBlob(
          (pngB) =>
            pngB ? resolve(pngB) : reject(new Error('Failed to export crop.')),
          'image/png'
        );
      },
      'image/webp',
      0.86
    );
  });

  return {
    blob,
    previewUrl: URL.createObjectURL(blob),
    width: outW,
    height: outH,
    sizeBytes: blob.size,
    mimeType: blob.type || 'image/webp',
    isStagedNew: true,
  };
}

export interface UploadedPanorama360Scene {
  id: string;
  label: string;
  url: string;
  width: number;
  height: number;
}

export async function uploadStagedListingMedia(params: {
  draft: ListingMediaDraft;
  listingId: string;
  hubId?: string | null;
  accessToken?: string | null;
  retentionClass?: 'ephemeral_ttl' | 'temp_draft';
  mediaStatus?: 'pending_verification' | 'pending_attach';
  ttlDays?: number;
}): Promise<{
  logoUrl: string;
  coverImage: string;
  galleryImages: string[];
  panoramaUrl: string;
  panoramas360: UploadedPanorama360Scene[];
  uploadedPaths: string[];
  errors: string[];
}> {
  const {
    draft,
    listingId,
    hubId,
    accessToken,
    retentionClass = 'ephemeral_ttl',
    mediaStatus = 'pending_verification',
    ttlDays = 14,
  } = params;

  const uploadedPaths: string[] = [];
  const errors: string[] = [];

  const uploadSingle = async (
    item: StagedMediaItem | null,
    entityType:
      | 'listing_logo'
      | 'listing_cover'
      | 'listing_gallery'
      | 'listing_panorama'
  ): Promise<string> => {
    if (!item) return '';
    if (!item.isStagedNew || !item.blob) {
      return item.previewUrl || '';
    }
    const fd = new FormData();
    const ext = item.mimeType?.includes('png') ? 'png' : 'webp';
    fd.append('file', item.blob, `${entityType}-${Date.now()}.${ext}`);
    fd.append('entityType', entityType);
    fd.append('entityId', listingId);
    if (hubId) fd.append('hubId', hubId);
    fd.append('retentionClass', retentionClass);
    fd.append('mediaStatus', mediaStatus);
    fd.append('ttlDays', String(ttlDays));

    const headers: Record<string, string> = {};
    if (accessToken) {
      headers.Authorization = `Bearer ${accessToken}`;
    }

    const res = await fetch('/api/media/upload', {
      method: 'POST',
      headers,
      body: fd,
    });
    const json = (await res.json().catch(() => null)) as {
      url?: string;
      path?: string;
      error?: string;
      success?: boolean;
    } | null;

    if (!res.ok || !json?.success || !json.url) {
      errors.push(
        json?.error || `Failed to upload ${entityType.replace(/_/g, ' ')}.`
      );
      return '';
    }
    if (json.path) uploadedPaths.push(json.path);
    return json.url;
  };

  const logoUrl = await uploadSingle(draft.logo, 'listing_logo');
  const coverImage = await uploadSingle(draft.cover, 'listing_cover');

  const panoramas360: UploadedPanorama360Scene[] = [];
  const rawPanos = draft.panoramas360 || [];
  for (let i = 0; i < rawPanos.length; i++) {
    const view = rawPanos[i];
    const resolvedPanoUrl = await uploadSingle(view.item, 'listing_panorama');
    if (resolvedPanoUrl) {
      panoramas360.push({
        id: view.id || `pano-${i + 1}`,
        label: (view.label || '').trim() || `360° View ${i + 1}`,
        url: resolvedPanoUrl,
        width: view.item.width || 2048,
        height: view.item.height || 1024,
      });
    }
  }

  let panoramaUrl = panoramas360[0]?.url || '';
  if (!panoramaUrl && draft.panorama) {
    panoramaUrl = await uploadSingle(draft.panorama, 'listing_panorama');
    if (panoramaUrl) {
      panoramas360.push({
        id: 'pano-primary',
        label: 'Main 360° View',
        url: panoramaUrl,
        width: draft.panorama.width || 2048,
        height: draft.panorama.height || 1024,
      });
    }
  }

  const galleryImages: string[] = [];
  for (const item of draft.gallery) {
    const resolved = await uploadSingle(item, 'listing_gallery');
    if (resolved) galleryImages.push(resolved);
  }

  return {
    logoUrl,
    coverImage,
    galleryImages,
    panoramaUrl,
    panoramas360,
    uploadedPaths,
    errors,
  };
}

const PANO_VIEW_PRESETS = [
  'Main Counter',
  'Main Entrance',
  'Living Room',
  'Front Lawn',
  'Turf Pitch',
  'Dining Area',
  'Room Interior',
  'Rooftop View',
];

export function ListingMediaEditor({
  draft,
  onChange,
  maxMediaLimit,
  max360Limit = 5,
  showPanoramaSection = true,
  listingTitle = 'Business',
  className = '',
}: ListingMediaEditorProps) {
  const logoInputRef = useRef<HTMLInputElement | null>(null);
  const coverInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const panoramaInputRef = useRef<HTMLInputElement | null>(null);

  const [cropState, setCropState] = useState<CropModalState | null>(null);
  const [isApplyingCrop, setIsApplyingCrop] = useState(false);
  const [mediaNotice, setMediaNotice] = useState<{
    type: 'info' | 'err';
    text: string;
  } | null>(null);

  const dragRef = useRef<{
    startX: number;
    startY: number;
    origOffsetX: number;
    origOffsetY: number;
  } | null>(null);

  useEffect(() => {
    return () => {
      if (cropState?.sourceUrl) revokeIfBlobUrl(cropState.sourceUrl);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isUnlimited = maxMediaLimit < 0;
  const effectiveGalleryCap = isUnlimited
    ? 99
    : Math.max(1, maxMediaLimit || 8);
  const canAddMoreGallery = draft.gallery.length < effectiveGalleryCap;

  const activePanoramas: StagedPanorama360View[] = useMemo(() => {
    if (Array.isArray(draft.panoramas360) && draft.panoramas360.length > 0) {
      return draft.panoramas360;
    }
    if (draft.panorama?.previewUrl) {
      return [
        {
          id: 'pano-primary',
          label: 'Main 360° View',
          item: draft.panorama,
          aspectRatioLabel: '2:1 Equirectangular',
        },
      ];
    }
    return [];
  }, [draft.panoramas360, draft.panorama]);

  const isUnlimited360 = max360Limit < 0;
  const effective360Cap = isUnlimited360 ? 20 : Math.max(1, max360Limit || 5);
  const canAddMore360 = activePanoramas.length < effective360Cap;

  const stagedBytes = useMemo(() => {
    let total = 0;
    if (draft.logo?.isStagedNew && draft.logo.sizeBytes)
      total += draft.logo.sizeBytes;
    if (draft.cover?.isStagedNew && draft.cover.sizeBytes)
      total += draft.cover.sizeBytes;
    draft.gallery.forEach((g) => {
      if (g.isStagedNew && g.sizeBytes) total += g.sizeBytes;
    });
    activePanoramas.forEach((v) => {
      if (v.item?.isStagedNew && v.item.sizeBytes) total += v.item.sizeBytes;
    });
    return total;
  }, [draft, activePanoramas]);

  const openCropperForFile = async (
    file: File,
    target: CropModalState['target'],
    preset: CropPresetKey
  ) => {
    setMediaNotice(null);
    if (!file.type.startsWith('image/')) {
      setMediaNotice({
        type: 'err',
        text: 'Please choose an image file (PNG, JPEG, or WebP).',
      });
      return;
    }
    const sourceUrl = URL.createObjectURL(file);
    try {
      const dims = await readImageDimensions(sourceUrl);
      setCropState({
        target,
        preset,
        sourceUrl,
        naturalWidth: dims.width,
        naturalHeight: dims.height,
        zoom: 1,
        offsetX: 0,
        offsetY: 0,
        rotationDeg: 0,
      });
    } catch (err) {
      revokeIfBlobUrl(sourceUrl);
      setMediaNotice({
        type: 'err',
        text: err instanceof Error ? err.message : 'Unable to load image.',
      });
    }
  };

  const handleApplyCrop = async () => {
    if (!cropState || isApplyingCrop) return;
    setIsApplyingCrop(true);
    try {
      const staged = await renderCroppedCanvasBlob(cropState);
      if (cropState.target === 'logo') {
        if (draft.logo?.isStagedNew) revokeIfBlobUrl(draft.logo.previewUrl);
        onChange({ ...draft, logo: staged });
      } else if (cropState.target === 'cover') {
        if (draft.cover?.isStagedNew) revokeIfBlobUrl(draft.cover.previewUrl);
        onChange({ ...draft, cover: staged });
      } else if (cropState.target.galleryIndex === 'new') {
        onChange({ ...draft, gallery: [...draft.gallery, staged] });
      } else {
        const idx = cropState.target.galleryIndex;
        const nextGallery = draft.gallery.map((g, i) => {
          if (i === idx) {
            if (g.isStagedNew) revokeIfBlobUrl(g.previewUrl);
            return staged;
          }
          return g;
        });
        onChange({ ...draft, gallery: nextGallery });
      }
      revokeIfBlobUrl(cropState.sourceUrl);
      setCropState(null);
    } catch (err) {
      setMediaNotice({
        type: 'err',
        text: err instanceof Error ? err.message : 'Crop export failed.',
      });
    } finally {
      setIsApplyingCrop(false);
    }
  };

  const handleGalleryMultiSelect = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setMediaNotice(null);

    const remainingSlots = effectiveGalleryCap - draft.gallery.length;
    if (remainingSlots <= 0) {
      setMediaNotice({
        type: 'err',
        text: `Gallery limit reached (${effectiveGalleryCap} images on your current plan).`,
      });
      return;
    }

    const picked = Array.from(files).slice(0, remainingSlots);
    // Single image offers full interactive 4:3 cropper modal; multi-select compresses cleanly into memory
    if (picked.length === 1) {
      await openCropperForFile(
        picked[0],
        { galleryIndex: 'new' },
        'gallery_4_3'
      );
      return;
    }

    const newItems: StagedMediaItem[] = [];
    for (const file of picked) {
      if (!file.type.startsWith('image/')) continue;
      try {
        const compressed = await compressFileDirect(file, 1280, 960, 0.85);
        newItems.push(compressed);
      } catch {
        // Skip invalid individual file cleanly
      }
    }
    if (newItems.length > 0) {
      onChange({
        ...draft,
        gallery: [...draft.gallery, ...newItems],
      });
      setMediaNotice({
        type: 'info',
        text: `Staged ${newItems.length} compressed photo(s) in memory. They upload only when you confirm submit.`,
      });
    }
  };

  const handlePanoramaFilesSelect = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setMediaNotice(null);

    const remaining = effective360Cap - activePanoramas.length;
    if (remaining <= 0) {
      setMediaNotice({
        type: 'err',
        text: `360° view quota reached (${effective360Cap} views on your current plan).`,
      });
      return;
    }

    const picked = Array.from(files).slice(0, remaining);
    const addedViews: StagedPanorama360View[] = [];

    for (let i = 0; i < picked.length; i++) {
      const file = picked[i];
      if (!file.type.startsWith('image/')) continue;
      const objUrl = URL.createObjectURL(file);
      try {
        const dims = await readImageDimensions(objUrl);
        const ratio = dims.width / Math.max(1, dims.height);
        const is2to1 = ratio >= 1.8 && ratio <= 2.2;
        if (!is2to1) {
          setMediaNotice({
            type: 'info',
            text: `Selected 360° image is ${dims.width}x${dims.height} (${ratio.toFixed(
              2
            )}:1). Best 360° viewing results use a 2:1 equirectangular image.`,
          });
        }
        revokeIfBlobUrl(objUrl);
        const staged = await compressFileDirect(file, 2048, 1024, 0.86);
        const nextIndex = activePanoramas.length + addedViews.length;
        const defaultName =
          PANO_VIEW_PRESETS[nextIndex % PANO_VIEW_PRESETS.length] ||
          `360° View ${nextIndex + 1}`;
        addedViews.push({
          id: `pano-${Date.now()}-${i}`,
          label: defaultName,
          item: staged,
          aspectRatioLabel: is2to1
            ? '2:1 Equirectangular'
            : `${ratio.toFixed(1)}:1 Aspect`,
        });
      } catch (err) {
        revokeIfBlobUrl(objUrl);
        setMediaNotice({
          type: 'err',
          text: err instanceof Error ? err.message : 'Unable to stage 360° view.',
        });
      }
    }

    if (addedViews.length > 0) {
      const nextList = [...activePanoramas, ...addedViews];
      onChange({
        ...draft,
        panoramas360: nextList,
        panorama: nextList[0]?.item || null,
      });
    }
  };

  const updatePanoramaLabel = (idx: number, nextLabel: string) => {
    const nextList = activePanoramas.map((v, i) =>
      i === idx ? { ...v, label: nextLabel } : v
    );
    onChange({
      ...draft,
      panoramas360: nextList,
      panorama: nextList[0]?.item || null,
    });
  };

  const movePanoramaView = (idx: number, dir: -1 | 1) => {
    const nextIdx = idx + dir;
    if (nextIdx < 0 || nextIdx >= activePanoramas.length) return;
    const copy = [...activePanoramas];
    const temp = copy[idx];
    copy[idx] = copy[nextIdx];
    copy[nextIdx] = temp;
    onChange({
      ...draft,
      panoramas360: copy,
      panorama: copy[0]?.item || null,
    });
  };

  const removePanoramaView = (idx: number) => {
    const target = activePanoramas[idx];
    if (target?.item?.isStagedNew) {
      revokeIfBlobUrl(target.item.previewUrl);
    }
    const nextList = activePanoramas.filter((_, i) => i !== idx);
    onChange({
      ...draft,
      panoramas360: nextList,
      panorama: nextList[0]?.item || null,
    });
  };

  const moveGalleryItem = (idx: number, dir: -1 | 1) => {
    const nextIdx = idx + dir;
    if (nextIdx < 0 || nextIdx >= draft.gallery.length) return;
    const copy = [...draft.gallery];
    const temp = copy[idx];
    copy[idx] = copy[nextIdx];
    copy[nextIdx] = temp;
    onChange({ ...draft, gallery: copy });
  };

  const removeGalleryItem = (idx: number) => {
    const target = draft.gallery[idx];
    if (target?.isStagedNew) revokeIfBlobUrl(target.previewUrl);
    onChange({
      ...draft,
      gallery: draft.gallery.filter((_, i) => i !== idx),
    });
  };

  return (
    <div className={`space-y-4 ${className}`}>
      {/* Temporary-Until-Verified Storage Hygiene Banner */}
      <div className="rounded-xl border border-sky-500/25 bg-sky-500/10 p-3 flex items-start gap-2.5">
        <ShieldCheck className="w-4 h-4 text-sky-500 shrink-0 mt-0.5" />
        <div className="min-w-0 text-xs text-[var(--ps-text)] space-y-0.5">
          <p className="font-semibold">
            Zero-Bloat Client Staging &amp; Temporary-Until-Verified Storage
          </p>
          <p className="text-[11px] text-[var(--ps-text-muted)]">
            Selected photos stay in browser memory while cropping. Uploads only
            happen when you confirm Save / Submit (held temporarily for 14 days
            until an Admin or Hub Manager approves them into permanent storage).
            {stagedBytes > 0 && (
              <span className="ml-1.5 font-mono font-semibold text-sky-600 dark:text-sky-300">
                ({Math.round(stagedBytes / 1024)} KB staged)
              </span>
            )}
          </p>
        </div>
      </div>

      {mediaNotice && (
        <div
          className={`rounded-xl border px-3 py-2 text-xs flex items-center justify-between gap-2 ${
            mediaNotice.type === 'err'
              ? 'bg-rose-500/10 border-rose-500/30 text-rose-600 dark:text-rose-300'
              : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-700 dark:text-emerald-300'
          }`}
        >
          <span>{mediaNotice.text}</span>
          <button
            type="button"
            onClick={() => setMediaNotice(null)}
            className="shrink-0 opacity-75 hover:opacity-100 cursor-pointer"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}

      {/* Hidden File Inputs */}
      <input
        ref={logoInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void openCropperForFile(f, 'logo', 'logo_1_1');
        }}
      />
      <input
        ref={coverInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) void openCropperForFile(f, 'cover', 'cover_16_9');
        }}
      />
      <input
        ref={galleryInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        className="hidden"
        onChange={(e) => {
          void handleGalleryMultiSelect(e.target.files);
          e.target.value = '';
        }}
      />
      <input
        ref={panoramaInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        className="hidden"
        onChange={(e) => {
          void handlePanoramaFilesSelect(e.target.files);
          e.target.value = '';
        }}
      />

      {/* Row 1: Brand Logo (1:1) & Cover Banner (16:9) */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Square Logo Card */}
        <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3.5 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h4 className="text-xs font-bold text-[var(--ps-text)] flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                Square Business Logo (1:1)
              </h4>
              <p className="text-[11px] text-[var(--ps-text-muted)]">
                Powers circular Explore map markers (&le;256px WebP).
              </p>
            </div>
            {draft.logo && (
              <button
                type="button"
                onClick={() => {
                  if (draft.logo?.isStagedNew)
                    revokeIfBlobUrl(draft.logo.previewUrl);
                  onChange({ ...draft, logo: null });
                }}
                className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-500/10 cursor-pointer"
                title="Remove logo"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-3.5">
            <div className="w-20 h-20 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] overflow-hidden shrink-0 flex items-center justify-center relative">
              {draft.logo?.previewUrl ? (
                <img
                  src={draft.logo.previewUrl}
                  alt={`${listingTitle} logo`}
                  className="w-full h-full object-cover"
                />
              ) : (
                <ImageIcon className="w-6 h-6 text-[var(--ps-text-muted)]" />
              )}
            </div>

            {/* Map Marker Live Preview */}
            <div className="flex-1 min-w-0 space-y-2">
              <div className="inline-flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[var(--ps-bg)] border border-[var(--ps-border)]">
                <div className="w-8 h-8 rounded-full border-2 border-[var(--ps-accent)] bg-[var(--ps-surface)] overflow-hidden flex items-center justify-center shadow-xs">
                  {draft.logo?.previewUrl ? (
                    <img
                      src={draft.logo.previewUrl}
                      alt="Map pin preview"
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <Camera className="w-3.5 h-3.5 text-[var(--ps-text-muted)]" />
                  )}
                </div>
                <span className="text-[11px] text-[var(--ps-text-muted)] truncate">
                  Explore Map Marker Preview
                </span>
              </div>

              <button
                type="button"
                onClick={() => logoInputRef.current?.click()}
                className="w-full min-h-[38px] inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--ps-bg)] border border-[var(--ps-border)] hover:border-[var(--ps-accent)] text-xs font-semibold text-[var(--ps-text)] cursor-pointer"
              >
                <Crop className="w-3.5 h-3.5" />
                {draft.logo ? 'Change & Crop Logo' : 'Upload & Crop 1:1 Logo'}
              </button>
            </div>
          </div>
        </div>

        {/* Cover Image Card */}
        <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3.5 space-y-3">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h4 className="text-xs font-bold text-[var(--ps-text)] flex items-center gap-1.5">
                <ImageIcon className="w-3.5 h-3.5 text-sky-500" />
                Cover Photo (16:9 Wide)
              </h4>
              <p className="text-[11px] text-[var(--ps-text-muted)]">
                Main banner for detail pages &amp; discovery cards.
              </p>
            </div>
            {draft.cover && (
              <button
                type="button"
                onClick={() => {
                  if (draft.cover?.isStagedNew)
                    revokeIfBlobUrl(draft.cover.previewUrl);
                  onChange({ ...draft, cover: null });
                }}
                className="p-1.5 rounded-lg text-rose-500 hover:bg-rose-500/10 cursor-pointer"
                title="Remove cover"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="relative aspect-video w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] overflow-hidden flex items-center justify-center">
            {draft.cover?.previewUrl ? (
              <img
                src={draft.cover.previewUrl}
                alt={`${listingTitle} cover`}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className="text-center p-3">
                <Upload className="w-5 h-5 text-[var(--ps-text-muted)] mx-auto mb-1" />
                <p className="text-[11px] text-[var(--ps-text-muted)]">
                  Recommended 1280&times;720 landscape cover
                </p>
              </div>
            )}
          </div>

          <button
            type="button"
            onClick={() => coverInputRef.current?.click()}
            className="w-full min-h-[38px] inline-flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--ps-bg)] border border-[var(--ps-border)] hover:border-[var(--ps-accent)] text-xs font-semibold text-[var(--ps-text)] cursor-pointer"
          >
            <Crop className="w-3.5 h-3.5" />
            {draft.cover ? 'Replace & Crop Cover' : 'Upload & Crop 16:9 Cover'}
          </button>
        </div>
      </div>

      {/* Row 2: Gallery Multi-Upload */}
      <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3.5 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h4 className="text-xs font-bold text-[var(--ps-text)]">
              Photo Gallery ({draft.gallery.length}
              {isUnlimited ? ' / Unlimited' : ` / ${effectiveGalleryCap}`})
            </h4>
            <p className="text-[11px] text-[var(--ps-text-muted)]">
              Add interior, menu, work-sample, or property gallery photos. Use
              arrows to reorder.
            </p>
          </div>
          <button
            type="button"
            disabled={!canAddMoreGallery}
            onClick={() => galleryInputRef.current?.click()}
            className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-[var(--btn-primary-bg)] text-[var(--btn-primary-fg)] text-xs font-semibold cursor-pointer disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" />
            Add Gallery Photo(s)
          </button>
        </div>

        {draft.gallery.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-bg)] p-6 text-center text-xs text-[var(--ps-text-muted)]">
            No gallery photos added yet.
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-2.5">
            {draft.gallery.map((item, idx) => (
              <div
                key={`${item.previewUrl}-${idx}`}
                className="rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] overflow-hidden flex flex-col"
              >
                <div className="relative aspect-[4/3] w-full bg-[var(--ps-surface-alt)] overflow-hidden">
                  <img
                    src={item.previewUrl}
                    alt={`Gallery ${idx + 1}`}
                    className="w-full h-full object-cover"
                  />
                  {item.isStagedNew && (
                    <span className="absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded bg-sky-600 text-white text-[9px] font-bold">
                      Staged
                    </span>
                  )}
                </div>
                <div className="px-1.5 py-1 flex items-center justify-between gap-1 border-t border-[var(--ps-border)]">
                  <div className="flex items-center gap-0.5">
                    <button
                      type="button"
                      disabled={idx === 0}
                      onClick={() => moveGalleryItem(idx, -1)}
                      className="p-1 rounded hover:bg-[var(--ps-surface)] text-[var(--ps-text-muted)] disabled:opacity-30 cursor-pointer"
                      title="Move earlier"
                    >
                      <ArrowLeft className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      disabled={idx === draft.gallery.length - 1}
                      onClick={() => moveGalleryItem(idx, 1)}
                      className="p-1 rounded hover:bg-[var(--ps-surface)] text-[var(--ps-text-muted)] disabled:opacity-30 cursor-pointer"
                      title="Move later"
                    >
                      <ArrowRight className="w-3 h-3" />
                    </button>
                  </div>
                  <button
                    type="button"
                    onClick={() => removeGalleryItem(idx)}
                    className="p-1 rounded text-rose-500 hover:bg-rose-500/10 cursor-pointer"
                    title="Delete photo"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Row 3: Multi-View Named 360° Panorama Manager */}
      {showPanoramaSection && (
        <div
          data-testid="multi-360-panorama-section"
          className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3.5 space-y-3"
        >
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h4 className="text-xs font-bold text-[var(--ps-text)] flex items-center gap-1.5">
                <Compass className="w-3.5 h-3.5 text-emerald-500" />
                360° Virtual Tour Views (Optional) ({activePanoramas.length}
                {isUnlimited360 ? ' / Unlimited' : ` / ${effective360Cap}`})
              </h4>
              <p className="text-[11px] text-[var(--ps-text-muted)]">
                Add multiple named 2:1 equirectangular 360° scenes (e.g., &ldquo;Main Counter&rdquo;, &ldquo;Living Room&rdquo;, &ldquo;Front Lawn&rdquo;, &ldquo;Turf Pitch&rdquo;). Visitors can jump between every named view on your public page.
              </p>
            </div>
            <button
              type="button"
              disabled={!canAddMore360}
              onClick={() => panoramaInputRef.current?.click()}
              data-testid="add-360-view-btn"
              className="min-h-[38px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 text-white text-xs font-bold cursor-pointer hover:bg-emerald-500 disabled:opacity-50"
            >
              <Plus className="w-3.5 h-3.5" />
              + Add 360° View
            </button>
          </div>

          {activePanoramas.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-bg)] p-5 text-center text-xs text-[var(--ps-text-muted)]">
              No 360° views added yet. Click <span className="font-bold text-emerald-600 dark:text-emerald-400">+ Add 360° View</span> to stage named panoramic scenes in browser memory.
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {activePanoramas.map((view, idx) => (
                <div
                  key={view.id || idx}
                  data-testid={`pano-360-card-${idx}`}
                  className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-2.5 space-y-2.5 flex flex-col"
                >
                  <div className="relative aspect-[2/1] w-full rounded-lg overflow-hidden border border-[var(--ps-border)] bg-slate-950">
                    <img
                      src={view.item.previewUrl}
                      alt={view.label || `360° View ${idx + 1}`}
                      className="w-full h-full object-cover"
                    />
                    <div className="absolute top-1.5 left-1.5 flex items-center gap-1">
                      <span className="px-2 py-0.5 rounded bg-emerald-600/95 text-white text-[9px] font-bold">
                        View #{idx + 1}
                      </span>
                      <span className="px-2 py-0.5 rounded bg-black/75 text-white text-[9px] font-mono">
                        {view.aspectRatioLabel || '2:1 Equirectangular'}
                      </span>
                    </div>
                    {view.item.isStagedNew && (
                      <span className="absolute top-1.5 right-1.5 px-1.5 py-0.5 rounded bg-sky-600 text-white text-[9px] font-bold">
                        Staged in Memory
                      </span>
                    )}
                  </div>

                  {/* Required Custom View Name Input */}
                  <div className="space-y-1.5">
                    <label className="block text-[10px] font-bold text-[var(--ps-text)]">
                      Custom View Name <span className="text-rose-500">*</span>
                    </label>
                    <input
                      type="text"
                      required
                      value={view.label}
                      onChange={(e) => updatePanoramaLabel(idx, e.target.value)}
                      placeholder="e.g., Main Counter, Living Room, Front Lawn, Turf Pitch"
                      data-testid={`pano-360-label-input-${idx}`}
                      className="w-full h-8 px-2.5 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] text-xs font-semibold text-[var(--ps-text)] focus:outline-none focus:ring-2 focus:ring-emerald-500"
                    />
                    <div className="flex flex-wrap gap-1">
                      {PANO_VIEW_PRESETS.slice(0, 5).map((preset) => (
                        <button
                          key={preset}
                          type="button"
                          onClick={() => updatePanoramaLabel(idx, preset)}
                          className={`px-2 py-0.5 rounded text-[9px] font-semibold border transition-colors cursor-pointer ${
                            view.label === preset
                              ? 'border-emerald-500 bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                              : 'border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                          }`}
                        >
                          {preset}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t border-[var(--ps-border)]">
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => movePanoramaView(idx, -1)}
                        className="px-2 py-1 rounded bg-[var(--ps-surface)] border border-[var(--ps-border)] text-[10px] font-semibold text-[var(--ps-text)] disabled:opacity-30 cursor-pointer"
                        title="Move view up"
                      >
                        ← Earlier
                      </button>
                      <button
                        type="button"
                        disabled={idx === activePanoramas.length - 1}
                        onClick={() => movePanoramaView(idx, 1)}
                        className="px-2 py-1 rounded bg-[var(--ps-surface)] border border-[var(--ps-border)] text-[10px] font-semibold text-[var(--ps-text)] disabled:opacity-30 cursor-pointer"
                        title="Move view down"
                      >
                        Later →
                      </button>
                    </div>
                    <button
                      type="button"
                      onClick={() => removePanoramaView(idx)}
                      data-testid={`pano-360-remove-${idx}`}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded bg-rose-500/10 border border-rose-500/30 text-[10px] font-bold text-rose-500 hover:bg-rose-500/20 cursor-pointer"
                    >
                      <Trash2 className="w-3 h-3" /> Remove
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Built-in Canvas Crop & Pan/Zoom Modal */}
      {cropState && (
        <div
          className="fixed inset-0 z-[10050] bg-black/75 backdrop-blur-xs flex items-center justify-center p-4"
          onClick={() => {
            if (!isApplyingCrop) {
              revokeIfBlobUrl(cropState.sourceUrl);
              setCropState(null);
            }
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text)] shadow-2xl overflow-hidden flex flex-col max-h-[90dvh]"
          >
            <div className="shrink-0 px-4 py-3 border-b border-[var(--ps-border)] flex items-center justify-between gap-2">
              <div>
                <h4 className="text-sm font-bold">
                  {PRESET_CONFIG[cropState.preset].label}
                </h4>
                <p className="text-[11px] text-[var(--ps-text-muted)]">
                  Drag to frame, use slider to zoom. {PRESET_CONFIG[cropState.preset].hint}
                </p>
              </div>
              <button
                type="button"
                disabled={isApplyingCrop}
                onClick={() => {
                  revokeIfBlobUrl(cropState.sourceUrl);
                  setCropState(null);
                }}
                className="p-1.5 rounded-lg hover:bg-[var(--ps-bg)] cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 min-h-0 overflow-y-auto p-4 space-y-4">
              {/* Interactive Frame */}
              <div
                onPointerDown={(e) => {
                  (e.currentTarget as HTMLDivElement).setPointerCapture(
                    e.pointerId
                  );
                  dragRef.current = {
                    startX: e.clientX,
                    startY: e.clientY,
                    origOffsetX: cropState.offsetX,
                    origOffsetY: cropState.offsetY,
                  };
                }}
                onPointerMove={(e) => {
                  if (!dragRef.current) return;
                  const rect = (
                    e.currentTarget as HTMLDivElement
                  ).getBoundingClientRect();
                  const dx = ((e.clientX - dragRef.current.startX) / Math.max(80, rect.width)) * 2;
                  const dy = ((e.clientY - dragRef.current.startY) / Math.max(80, rect.height)) * 2;
                  setCropState((prev) =>
                    prev
                      ? {
                          ...prev,
                          offsetX: Math.max(
                            -1.5,
                            Math.min(1.5, dragRef.current!.origOffsetX + dx)
                          ),
                          offsetY: Math.max(
                            -1.5,
                            Math.min(1.5, dragRef.current!.origOffsetY + dy)
                          ),
                        }
                      : null
                  );
                }}
                onPointerUp={() => {
                  dragRef.current = null;
                }}
                onPointerCancel={() => {
                  dragRef.current = null;
                }}
                style={{
                  aspectRatio: String(PRESET_CONFIG[cropState.preset].aspect),
                }}
                className={`relative w-full max-h-[320px] mx-auto bg-black/90 overflow-hidden touch-none cursor-grab active:cursor-grabbing border-2 border-[var(--ps-accent)] ${
                  cropState.preset === 'logo_1_1'
                    ? 'rounded-full max-w-[260px]'
                    : 'rounded-xl'
                }`}
              >
                <img
                  src={cropState.sourceUrl}
                  alt="Crop preview"
                  draggable={false}
                  style={{
                    transform: `translate(${cropState.offsetX * 50}%, ${
                      cropState.offsetY * 50
                    }%) scale(${cropState.zoom}) rotate(${
                      cropState.rotationDeg
                    }deg)`,
                  }}
                  className="w-full h-full object-cover select-none pointer-events-none origin-center"
                />
              </div>

              {/* Zoom + Rotate Controls */}
              <div className="flex flex-wrap items-center gap-3 bg-[var(--ps-bg)] border border-[var(--ps-border)] rounded-xl p-3">
                <ZoomOut className="w-4 h-4 text-[var(--ps-text-muted)] shrink-0" />
                <input
                  type="range"
                  min={1}
                  max={3}
                  step={0.05}
                  value={cropState.zoom}
                  onChange={(e) =>
                    setCropState((prev) =>
                      prev ? { ...prev, zoom: parseFloat(e.target.value) } : null
                    )
                  }
                  className="flex-1 accent-[var(--ps-accent)]"
                />
                <ZoomIn className="w-4 h-4 text-[var(--ps-text-muted)] shrink-0" />
                <span className="text-xs font-mono w-10 text-right">
                  {cropState.zoom.toFixed(1)}x
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setCropState((prev) =>
                      prev
                        ? {
                            ...prev,
                            rotationDeg: (prev.rotationDeg + 90) % 360,
                          }
                        : null
                    )
                  }
                  className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] text-xs font-semibold cursor-pointer"
                >
                  <RotateCw className="w-3.5 h-3.5" />
                  90°
                </button>
              </div>
            </div>

            <div className="shrink-0 px-4 py-3 border-t border-[var(--ps-border)] bg-[var(--ps-bg)] flex items-center justify-end gap-2">
              <button
                type="button"
                disabled={isApplyingCrop}
                onClick={() => {
                  revokeIfBlobUrl(cropState.sourceUrl);
                  setCropState(null);
                }}
                className="min-h-[40px] px-4 py-2 rounded-xl border border-[var(--ps-border)] text-xs font-semibold text-[var(--ps-text)] cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isApplyingCrop}
                onClick={() => void handleApplyCrop()}
                className="min-h-[40px] inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[var(--btn-primary-bg)] text-[var(--btn-primary-fg)] text-xs font-bold cursor-pointer disabled:opacity-60"
              >
                {isApplyingCrop ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  <Check className="w-3.5 h-3.5" />
                )}
                Apply Crop to Memory
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
