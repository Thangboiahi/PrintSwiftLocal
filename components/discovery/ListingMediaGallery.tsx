'use client';

import React, {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';
import dynamic from 'next/dynamic';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import {
  BedDouble,
  Briefcase,
  ChevronLeft,
  ChevronRight,
  Compass,
  Home,
  Image as ImageIcon,
  Landmark,
  Maximize2,
  Printer,
  ShoppingBag,
  Trophy,
  UtensilsCrossed,
  Wrench,
  X,
} from 'lucide-react';
import { useHydrated } from '@/hooks/useHydrated';
import { useModalLock } from '@/hooks/useModalLock';
import type { PublicPanorama360Scene } from '@/components/verticals/Panorama360Viewer';
import { resolveRemoteMediaUrl } from '@/lib/supabase/storage';
import type { LatLngPoint, Listing, ListingCategory } from '@/lib/types';

const DynamicPanorama360Viewer = dynamic(
  () =>
    import('@/components/verticals/Panorama360Viewer').then((mod) => ({
      default: mod.Panorama360Viewer,
    })),
  {
    ssr: false,
    loading: () => (
      <div className="flex h-64 sm:h-80 w-full flex-col items-center justify-center gap-2 bg-slate-950 text-white">
        <div className="dd-shimmer h-10 w-10 rounded-full bg-white/10" />
        <span className="text-xs font-semibold text-white/75">
          Loading 360° Virtual Tour…
        </span>
      </div>
    ),
  }
);

export interface ListingGalleryImage {
  id: string;
  url: string;
  caption?: string | null;
}

export interface ListingMediaGalleryProps {
  images: Array<string | { id?: string; url: string; caption?: string | null }>;
  panoramas?: PublicPanorama360Scene[];
  title: string;
  subtitle?: string | null;
  category?: ListingCategory | string;
  listingVertical?: string;
  coordinates?: LatLngPoint | null;
  /** Compact ratio for summary sheets vs wider ratio for detail hero */
  aspectClassName?: string;
  roundedClassName?: string;
  /** Auto-advance interval in ms when > 1 photo (set 0 to disable) */
  autoPlayMs?: number;
  /** Render compact bottom thumbnail rail below the viewport */
  showThumbnails?: boolean;
  /** Initial active tab */
  initialMode?: 'photos' | 'panorama';
  /** Optional floating slot at top-left (e.g. vertical badge) */
  topLeftSlot?: React.ReactNode;
  /** Optional floating slot at top-right (e.g. Save/Share/Close buttons) */
  topRightSlot?: React.ReactNode;
  /** Allow switching to panorama automatically on #media-360 hash */
  honorHashDeepLink?: boolean;
  className?: string;
  testId?: string;
}

function getVerticalFallbackMeta(verticalOrCategory?: string) {
  switch (verticalOrCategory) {
    case 'real_estate':
      return {
        icon: Home,
        gradient: 'from-violet-600/20 via-indigo-500/10 to-[var(--ps-surface-alt)]',
        accent: 'text-violet-600 dark:text-violet-400',
        label: 'Real Estate',
      };
    case 'restaurant_food':
      return {
        icon: UtensilsCrossed,
        gradient: 'from-orange-500/20 via-amber-500/10 to-[var(--ps-surface-alt)]',
        accent: 'text-orange-600 dark:text-orange-400',
        label: 'Food & Dining',
      };
    case 'shop_catalogue':
    case 'business':
      return {
        icon: ShoppingBag,
        gradient: 'from-sky-500/20 via-blue-500/10 to-[var(--ps-surface-alt)]',
        accent: 'text-sky-600 dark:text-sky-400',
        label: 'Local Storefront',
      };
    case 'hotel_stay':
      return {
        icon: BedDouble,
        gradient: 'from-indigo-500/20 via-violet-500/10 to-[var(--ps-surface-alt)]',
        accent: 'text-indigo-600 dark:text-indigo-400',
        label: 'Stay & Lodge',
      };
    case 'booking_venue':
    case 'sports':
      return {
        icon: Trophy,
        gradient: 'from-emerald-500/20 via-teal-500/10 to-[var(--ps-surface-alt)]',
        accent: 'text-emerald-600 dark:text-emerald-400',
        label: 'Venue & Turf',
      };
    case 'print_digital':
      return {
        icon: Printer,
        gradient: 'from-teal-500/20 via-cyan-500/10 to-[var(--ps-surface-alt)]',
        accent: 'text-teal-600 dark:text-teal-400',
        label: 'Print & Digital',
      };
    case 'public_civic':
    case 'public_place':
      return {
        icon: Landmark,
        gradient: 'from-rose-500/20 via-amber-500/10 to-[var(--ps-surface-alt)]',
        accent: 'text-rose-600 dark:text-rose-400',
        label: 'Public & Civic',
      };
    case 'service':
      return {
        icon: Wrench,
        gradient: 'from-amber-500/20 via-orange-500/10 to-[var(--ps-surface-alt)]',
        accent: 'text-amber-600 dark:text-amber-400',
        label: 'Local Service',
      };
    default:
      return {
        icon: Briefcase,
        gradient: 'from-[var(--ps-accent)]/15 via-[var(--ps-surface-alt)] to-[var(--ps-bg)]',
        accent: 'text-[var(--ps-accent)]',
        label: 'Local Listing',
      };
  }
}

/**
 * Extracts normalized, deduplicated photo items & 360° panorama scenes from any Listing object.
 */
export function extractListingGalleryMedia(listing: Listing): {
  images: ListingGalleryImage[];
  panoramas: PublicPanorama360Scene[];
} {
  const seenUrls = new Set<string>();
  const images: ListingGalleryImage[] = [];

  const pushImage = (
    rawUrl: string | null | undefined,
    caption?: string | null,
    id?: string
  ) => {
    const resolved = rawUrl ? resolveRemoteMediaUrl(String(rawUrl).trim()) : '';
    if (!resolved || seenUrls.has(resolved)) return;
    seenUrls.add(resolved);
    images.push({
      id: id || `img-${images.length}`,
      url: resolved,
      caption: caption || null,
    });
  };

  // Optional extended listingMedia array
  const optionalMedia = (
    listing as Listing & {
      listingMedia?: Array<{
        id?: string;
        url?: string | null;
        caption?: string | null;
        name?: string | null;
        media_type?: string | null;
        is_equirectangular?: boolean | null;
        is_primary?: boolean | null;
      }> | null;
    }
  ).listingMedia;

  if (Array.isArray(optionalMedia)) {
    const sorted = [...optionalMedia].sort(
      (a, b) => (b.is_primary ? 1 : 0) - (a.is_primary ? 1 : 0)
    );
    for (const m of sorted) {
      if (m.media_type === 'panorama_360' || m.is_equirectangular === true) {
        continue;
      }
      pushImage(m.url, m.caption || m.name, m.id);
    }
  }

  pushImage(listing.coverImage, null, 'cover');
  if (Array.isArray(listing.galleryImages)) {
    listing.galleryImages.forEach((u, idx) =>
      pushImage(u, null, `gallery-${idx}`)
    );
  }

  // Panoramas
  const seenPanoUrls = new Set<string>();
  const panoramas: PublicPanorama360Scene[] = [];
  const pushPano = (
    rawUrl: string | null | undefined,
    label?: string | null,
    id?: string,
    width?: number,
    height?: number
  ) => {
    const resolved = rawUrl ? resolveRemoteMediaUrl(String(rawUrl).trim()) : '';
    if (!resolved || seenPanoUrls.has(resolved)) return;
    seenPanoUrls.add(resolved);
    panoramas.push({
      id: id || `pano-${panoramas.length + 1}`,
      label: label || `360° View ${panoramas.length + 1}`,
      url: resolved,
      width,
      height,
    });
  };

  if (Array.isArray(listing.panoramas_360)) {
    listing.panoramas_360.forEach((p, idx) =>
      pushPano(p?.url, p?.label, p?.id || `p360-${idx}`, p?.width, p?.height)
    );
  }
  if (Array.isArray(optionalMedia)) {
    optionalMedia.forEach((m, idx) => {
      if (m.media_type === 'panorama_360' || m.is_equirectangular === true) {
        pushPano(m.url, m.caption || m.name, m.id || `mpano-${idx}`);
      }
    });
  }
  if (Array.isArray(listing.realEstateDetails?.panoramas)) {
    listing.realEstateDetails.panoramas.forEach((p, idx) =>
      pushPano(p?.imageUrl, p?.name, p?.id || `repano-${idx}`, p?.width, p?.height)
    );
  }
  if (listing.realEstateDetails?.panoramaUrl) {
    pushPano(listing.realEstateDetails.panoramaUrl, 'Main 360° View', 're-primary');
  }

  return { images, panoramas };
}

export function ListingMediaGallery({
  images,
  panoramas = [],
  title,
  subtitle,
  category,
  listingVertical,
  coordinates = null,
  aspectClassName = 'aspect-[16/10] sm:aspect-[16/9]',
  roundedClassName = 'rounded-2xl',
  autoPlayMs = 4000,
  showThumbnails = false,
  initialMode = 'photos',
  topLeftSlot,
  topRightSlot,
  honorHashDeepLink = false,
  className = '',
  testId = 'listing-media-gallery',
}: ListingMediaGalleryProps) {
  const isHydrated = useHydrated();
  const prefersReducedMotion = useReducedMotion();

  const [failedUrls, setFailedUrls] = useState<Record<string, boolean>>({});
  const [activeIndex, setActiveIndex] = useState(0);
  const [isPaused, setIsPaused] = useState(false);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const resumeTimerRef = useRef<number | null>(null);
  const touchStartXRef = useRef<number | null>(null);
  const touchStartYRef = useRef<number | null>(null);

  const normalizedImages = useMemo<ListingGalleryImage[]>(() => {
    const seen = new Set<string>();
    const list: ListingGalleryImage[] = [];
    (images || []).forEach((item, idx) => {
      const rawUrl = typeof item === 'string' ? item : item?.url;
      const resolved = rawUrl ? resolveRemoteMediaUrl(rawUrl.trim()) : '';
      if (!resolved || seen.has(resolved) || failedUrls[resolved]) return;
      seen.add(resolved);
      list.push({
        id: (typeof item === 'object' && item?.id) || `slide-${idx}`,
        url: resolved,
        caption: typeof item === 'object' ? item?.caption ?? null : null,
      });
    });
    return list;
  }, [images, failedUrls]);

  const validPanoramas = useMemo(
    () => (panoramas || []).filter((p) => Boolean(p?.url?.trim())),
    [panoramas]
  );

  const [activeMode, setActiveMode] = useState<'photos' | 'panorama'>(() => {
    if (initialMode === 'panorama' && validPanoramas.length > 0) {
      return 'panorama';
    }
    if (normalizedImages.length === 0 && validPanoramas.length > 0) {
      return 'panorama';
    }
    return 'photos';
  });

  useEffect(() => {
    if (!honorHashDeepLink || typeof window === 'undefined') return;
    if (validPanoramas.length > 0 && window.location.hash === '#media-360') {
      queueMicrotask(() => setActiveMode('panorama'));
    }
  }, [honorHashDeepLink, validPanoramas.length]);

  const closeLightbox = useCallback(() => setLightboxOpen(false), []);
  useModalLock(lightboxOpen, closeLightbox);

  const pauseTemporarily = useCallback((durationMs = 8000) => {
    setIsPaused(true);
    if (resumeTimerRef.current) {
      window.clearTimeout(resumeTimerRef.current);
    }
    resumeTimerRef.current = window.setTimeout(() => {
      setIsPaused(false);
    }, durationMs);
  }, []);

  useEffect(() => {
    return () => {
      if (resumeTimerRef.current) {
        window.clearTimeout(resumeTimerRef.current);
      }
    };
  }, []);

  const totalImages = normalizedImages.length;
  const safeIndex = totalImages > 0 ? activeIndex % totalImages : 0;
  const currentImage = normalizedImages[safeIndex] || null;

  const goPrev = useCallback(
    (manual = true) => {
      if (totalImages <= 1) return;
      if (manual) pauseTemporarily();
      setActiveIndex((prev) => (prev <= 0 ? totalImages - 1 : prev - 1));
    },
    [totalImages, pauseTemporarily]
  );

  const goNext = useCallback(
    (manual = true) => {
      if (totalImages <= 1) return;
      if (manual) pauseTemporarily();
      setActiveIndex((prev) => (prev + 1) % totalImages);
    },
    [totalImages, pauseTemporarily]
  );

  // Auto-advance every ~4s when multiple photos exist
  useEffect(() => {
    if (
      autoPlayMs <= 0 ||
      prefersReducedMotion ||
      totalImages <= 1 ||
      activeMode !== 'photos' ||
      isPaused ||
      lightboxOpen
    ) {
      return;
    }
    const timer = window.setInterval(() => {
      setActiveIndex((prev) => (prev + 1) % totalImages);
    }, autoPlayMs);
    return () => window.clearInterval(timer);
  }, [
    autoPlayMs,
    prefersReducedMotion,
    totalImages,
    activeMode,
    isPaused,
    lightboxOpen,
  ]);

  // Keyboard navigation when fullscreen lightbox is open
  useEffect(() => {
    if (!lightboxOpen) return;
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'ArrowLeft') {
        goPrev(true);
      } else if (ev.key === 'ArrowRight') {
        goNext(true);
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [lightboxOpen, goPrev, goNext]);

  const handleTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length !== 1) return;
    touchStartXRef.current = e.touches[0].clientX;
    touchStartYRef.current = e.touches[0].clientY;
    setIsPaused(true);
  };

  const handleTouchEnd = (e: React.TouchEvent) => {
    if (touchStartXRef.current === null || touchStartYRef.current === null) {
      return;
    }
    const touch = e.changedTouches[0];
    const dx = touch.clientX - touchStartXRef.current;
    const dy = touch.clientY - touchStartYRef.current;
    touchStartXRef.current = null;
    touchStartYRef.current = null;

    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
      if (dx < 0) {
        goNext(true);
      } else {
        goPrev(true);
      }
    } else {
      pauseTemporarily(5000);
    }
  };

  const fallbackMeta = getVerticalFallbackMeta(listingVertical || category);
  const FallbackIcon = fallbackMeta.icon;
  const has360 = validPanoramas.length > 0;

  return (
    <div
      data-testid={testId}
      className={`relative w-full overflow-hidden bg-[var(--ps-surface-alt)] ${roundedClassName} ${className}`}
    >
      {/* Main Viewport: 360° Panorama OR Auto-Scrolling Photos */}
      {activeMode === 'panorama' && has360 ? (
        <div className="relative w-full bg-slate-950">
          <DynamicPanorama360Viewer
            scenes={validPanoramas}
            listingTitle={title}
            coordinates={coordinates || undefined}
            className="rounded-none border-0 shadow-none"
          />

          {/* Compact floating toggle to return to Photos */}
          {totalImages > 0 && (
            <div className="absolute left-3 bottom-14 z-20 flex items-center gap-1 rounded-full border border-white/20 bg-slate-950/80 p-1 backdrop-blur-md">
              <button
                type="button"
                onClick={() => setActiveMode('photos')}
                className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full px-3 py-1 text-[11px] font-bold text-white/90 hover:bg-white/15 transition-colors cursor-pointer"
              >
                <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Photos ({totalImages})</span>
              </button>
              <span className="inline-flex min-h-[36px] items-center gap-1 rounded-full bg-emerald-600 px-3 py-1 text-[11px] font-bold text-white">
                <Compass className="h-3.5 w-3.5" aria-hidden="true" />
                <span>360°</span>
              </span>
            </div>
          )}

          {topRightSlot && (
            <div className="absolute right-3 top-3 z-20 flex items-center gap-1.5">
              {topRightSlot}
            </div>
          )}
        </div>
      ) : (
        <div
          onMouseEnter={() => setIsPaused(true)}
          onMouseLeave={() => setIsPaused(false)}
          onTouchStart={handleTouchStart}
          onTouchEnd={handleTouchEnd}
          className={`group relative w-full overflow-hidden select-none bg-slate-900 ${aspectClassName}`}
        >
          {currentImage ? (
            <>
              <AnimatePresence mode="wait" initial={false}>
                <motion.img
                  key={currentImage.url}
                  src={currentImage.url}
                  alt={currentImage.caption || title}
                  referrerPolicy="no-referrer"
                  initial={prefersReducedMotion ? false : { opacity: 0.35 }}
                  animate={{ opacity: 1 }}
                  exit={prefersReducedMotion ? undefined : { opacity: 0.35 }}
                  transition={{ duration: 0.28, ease: 'easeOut' }}
                  onClick={() => setLightboxOpen(true)}
                  onError={() =>
                    setFailedUrls((prev) => ({
                      ...prev,
                      [currentImage.url]: true,
                    }))
                  }
                  className="h-full w-full cursor-zoom-in object-cover"
                />
              </AnimatePresence>

              {/* Subtle top & bottom gradient scrims for legible overlays */}
              <div className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-slate-950/55 via-slate-950/20 to-transparent" />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-slate-950/65 via-slate-950/20 to-transparent" />
            </>
          ) : (
            <div
              className={`flex h-full w-full flex-col items-center justify-center gap-2.5 bg-gradient-to-br ${fallbackMeta.gradient} px-6 text-center`}
            >
              <div
                className={`flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)]/90 shadow-xs ${fallbackMeta.accent}`}
              >
                <FallbackIcon className="h-6 w-6" aria-hidden="true" />
              </div>
              <div className="space-y-0.5 max-w-[260px]">
                <p className="text-xs font-bold text-[var(--ps-text)] truncate">
                  {title}
                </p>
                <p className="text-[11px] font-medium text-[var(--ps-text-muted)] truncate">
                  {subtitle || fallbackMeta.label}
                </p>
              </div>
            </div>
          )}

          {/* Floating Top-Left Slot */}
          {topLeftSlot && (
            <div className="absolute left-3 top-3 z-20 flex flex-wrap items-center gap-1.5 max-w-[62%]">
              {topLeftSlot}
            </div>
          )}

          {/* Floating Top-Right Slot */}
          {topRightSlot && (
            <div className="absolute right-3 top-3 z-20 flex items-center gap-1.5">
              {topRightSlot}
            </div>
          )}

          {/* Prev / Next Navigation Buttons (44px+ touch targets) */}
          {totalImages > 1 && (
            <>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  goPrev(true);
                }}
                aria-label="Previous photo"
                data-testid="gallery-prev-btn"
                className="absolute left-2.5 top-1/2 -translate-y-1/2 z-20 inline-flex min-h-[44px] min-w-[44px] h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-slate-950/60 text-white backdrop-blur-sm opacity-90 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 hover:bg-slate-950/85 transition-all cursor-pointer"
              >
                <ChevronLeft className="h-5 w-5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  goNext(true);
                }}
                aria-label="Next photo"
                data-testid="gallery-next-btn"
                className="absolute right-2.5 top-1/2 -translate-y-1/2 z-20 inline-flex min-h-[44px] min-w-[44px] h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-slate-950/60 text-white backdrop-blur-sm opacity-90 sm:opacity-0 sm:group-hover:opacity-100 focus:opacity-100 hover:bg-slate-950/85 transition-all cursor-pointer"
              >
                <ChevronRight className="h-5 w-5" aria-hidden="true" />
              </button>
            </>
          )}

          {/* Bottom Controls Bar: 360° Toggle Pill (if available), Dot Indicators, Counter & Lightbox */}
          <div className="absolute inset-x-3 bottom-2.5 z-20 flex items-center justify-between gap-2">
            {/* Left: 360° View toggle (only when 360° media exists) OR caption */}
            <div className="flex items-center gap-1.5 min-w-0">
              {has360 ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setActiveMode('panorama');
                  }}
                  data-testid="gallery-360-toggle-btn"
                  className="inline-flex min-h-[36px] items-center gap-1.5 rounded-full border border-white/25 bg-slate-950/80 px-3 py-1 text-[11px] font-bold text-white backdrop-blur-md hover:bg-emerald-600 hover:border-emerald-400 transition-colors cursor-pointer shrink-0"
                >
                  <Compass className="h-3.5 w-3.5 text-emerald-400" aria-hidden="true" />
                  <span>360° View</span>
                </button>
              ) : currentImage?.caption ? (
                <span className="max-w-[180px] sm:max-w-[260px] truncate rounded-lg bg-slate-950/70 px-2 py-1 text-[10px] font-medium text-white backdrop-blur-xs">
                  {currentImage.caption}
                </span>
              ) : (
                <span />
              )}
            </div>

            {/* Center: Dot Indicators */}
            {totalImages > 1 && (
              <div
                className="flex items-center gap-1 rounded-full bg-slate-950/60 px-2 py-1 backdrop-blur-xs"
                role="tablist"
                aria-label="Gallery slides"
              >
                {normalizedImages.slice(0, 7).map((img, idx) => {
                  const active = idx === safeIndex;
                  return (
                    <button
                      key={img.id}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      aria-label={`Go to photo ${idx + 1}`}
                      onClick={(e) => {
                        e.stopPropagation();
                        pauseTemporarily();
                        setActiveIndex(idx);
                      }}
                      className={`h-1.5 rounded-full transition-all cursor-pointer ${
                        active ? 'w-4 bg-white' : 'w-1.5 bg-white/45 hover:bg-white/75'
                      }`}
                    />
                  );
                })}
              </div>
            )}

            {/* Right: Counter + Lightbox Expand */}
            {currentImage && (
              <div className="flex items-center gap-1.5 shrink-0">
                {totalImages > 1 && (
                  <span
                    data-testid="gallery-counter"
                    className="rounded-lg bg-slate-950/75 px-2 py-1 text-[10px] font-bold text-white tabular-nums backdrop-blur-xs"
                  >
                    {safeIndex + 1} / {totalImages}
                  </span>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setLightboxOpen(true);
                  }}
                  aria-label="Open fullscreen photo lightbox"
                  data-testid="gallery-lightbox-open-btn"
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/20 bg-slate-950/70 text-white backdrop-blur-xs hover:bg-slate-950/90 transition-colors cursor-pointer"
                >
                  <Maximize2 className="h-3.5 w-3.5" aria-hidden="true" />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Optional Thumbnail Rail (used on Full Detail Hero) */}
      {showThumbnails && activeMode === 'photos' && totalImages > 1 && (
        <div className="flex items-center gap-2 overflow-x-auto border-t border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 py-2 no-scrollbar">
          {normalizedImages.map((img, idx) => (
            <button
              key={img.id}
              type="button"
              onClick={() => {
                pauseTemporarily();
                setActiveIndex(idx);
              }}
              aria-label={`View photo ${idx + 1}`}
              className={`relative h-12 w-16 sm:h-14 sm:w-20 shrink-0 overflow-hidden rounded-xl border-2 transition-all cursor-pointer ${
                idx === safeIndex
                  ? 'border-[var(--ps-accent)] ring-2 ring-[var(--ps-accent)]/25'
                  : 'border-transparent opacity-70 hover:opacity-100'
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.url}
                alt={img.caption || `${title} thumbnail ${idx + 1}`}
                referrerPolicy="no-referrer"
                onError={() =>
                  setFailedUrls((prev) => ({ ...prev, [img.url]: true }))
                }
                className="h-full w-full object-cover"
              />
            </button>
          ))}
        </div>
      )}

      {/* Fullscreen Photo Lightbox (Portaled + useModalLock Android Back dismissal) */}
      {isHydrated &&
        typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {lightboxOpen && currentImage && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.16 }}
                onClick={closeLightbox}
                role="dialog"
                aria-modal="true"
                aria-label={`${title} photo gallery`}
                data-testid="listing-gallery-lightbox"
                className="fixed inset-0 z-[96] flex flex-col bg-slate-950/95 backdrop-blur-md"
              >
                {/* Header */}
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3 text-white"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-bold truncate">{title}</p>
                    <p className="text-[11px] text-white/70 tabular-nums truncate">
                      {safeIndex + 1} / {totalImages}
                      {currentImage.caption ? ` · ${currentImage.caption}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    {has360 && (
                      <button
                        type="button"
                        onClick={() => {
                          setLightboxOpen(false);
                          setActiveMode('panorama');
                        }}
                        className="inline-flex min-h-[44px] h-11 items-center gap-1.5 rounded-xl border border-emerald-400/40 bg-emerald-500/20 px-3 text-xs font-bold text-emerald-200 hover:bg-emerald-500/30 transition-colors cursor-pointer"
                      >
                        <Compass className="h-4 w-4" />
                        <span>360°</span>
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={closeLightbox}
                      aria-label="Close fullscreen gallery"
                      className="inline-flex min-h-[44px] min-w-[44px] h-11 w-11 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white hover:bg-white/20 transition-colors cursor-pointer"
                    >
                      <X className="h-5 w-5" />
                    </button>
                  </div>
                </div>

                {/* Swipeable Lightbox Stage */}
                <div
                  onClick={(e) => e.stopPropagation()}
                  onTouchStart={handleTouchStart}
                  onTouchEnd={handleTouchEnd}
                  className="relative flex flex-1 items-center justify-center p-4 sm:p-8 min-h-0 select-none"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={currentImage.url}
                    alt={currentImage.caption || title}
                    referrerPolicy="no-referrer"
                    className="max-h-full max-w-full rounded-xl object-contain shadow-2xl"
                  />

                  {totalImages > 1 && (
                    <>
                      <button
                        type="button"
                        onClick={() => goPrev(true)}
                        aria-label="Previous photo"
                        className="absolute left-3 sm:left-6 top-1/2 -translate-y-1/2 inline-flex min-h-[44px] min-w-[44px] h-11 w-11 items-center justify-center rounded-full border border-white/25 bg-slate-900/80 text-white hover:bg-slate-800 cursor-pointer"
                      >
                        <ChevronLeft className="h-5 w-5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => goNext(true)}
                        aria-label="Next photo"
                        className="absolute right-3 sm:right-6 top-1/2 -translate-y-1/2 inline-flex min-h-[44px] min-w-[44px] h-11 w-11 items-center justify-center rounded-full border border-white/25 bg-slate-900/80 text-white hover:bg-slate-800 cursor-pointer"
                      >
                        <ChevronRight className="h-5 w-5" />
                      </button>
                    </>
                  )}
                </div>

                {/* Bottom Thumbnail Strip */}
                {totalImages > 1 && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="flex items-center justify-center gap-2 overflow-x-auto border-t border-white/10 px-4 py-3 no-scrollbar"
                  >
                    {normalizedImages.map((img, idx) => (
                      <button
                        key={img.id}
                        type="button"
                        onClick={() => setActiveIndex(idx)}
                        aria-label={`Select photo ${idx + 1}`}
                        className={`relative h-14 w-20 shrink-0 overflow-hidden rounded-lg border-2 transition-all cursor-pointer ${
                          idx === safeIndex
                            ? 'border-white scale-105'
                            : 'border-transparent opacity-55 hover:opacity-100'
                        }`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={img.url}
                          alt={img.caption || `${title} thumb ${idx + 1}`}
                          referrerPolicy="no-referrer"
                          className="h-full w-full object-cover"
                        />
                      </button>
                    ))}
                  </div>
                )}
              </motion.div>
            )}
          </AnimatePresence>,
          document.body
        )}
    </div>
  );
}

export default ListingMediaGallery;
