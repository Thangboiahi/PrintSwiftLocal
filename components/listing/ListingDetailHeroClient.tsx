'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { AnimatePresence, motion } from 'framer-motion';
import {
  BadgeCheck,
  Bookmark,
  ChevronLeft,
  ChevronRight,
  Compass,
  Image as ImageIcon,
  MapPin,
  Maximize2,
  Navigation,
  Phone,
  Share2,
  Star,
  Truck,
  X,
} from 'lucide-react';
import {
  Panorama360Viewer,
  type PublicPanorama360Scene,
} from '@/components/verticals/Panorama360Viewer';
import { useShare } from '@/components/ui/ShareSheetModal';
import { useHydrated } from '@/hooks/useHydrated';
import { useModalLock } from '@/hooks/useModalLock';
import { useSavedInterests } from '@/lib/hooks/useSavedInterests';

export interface ListingHeroGalleryItem {
  id: string;
  url: string;
  caption?: string | null;
  isPrimary?: boolean;
  mediaType?: string;
}

export interface ListingDetailHeroClientProps {
  listingId: string;
  title: string;
  categoryLabel?: string;
  verticalRootKey?: string;
  locality?: string | null;
  address?: string | null;
  coordinates?: { lat: number; lng: number } | null;
  contactPhone?: string | null;
  priceLabel?: string | null;
  rating?: number;
  reviewCount?: number;
  isVerified?: boolean;
  ownerName?: string | null;
  ownerAvatar?: string | null;
  galleryItems: ListingHeroGalleryItem[];
  panoramaScenes: PublicPanorama360Scene[];
  canShow360?: boolean;
  canDispatchPnd?: boolean;
}

const VERTICAL_BADGE_LABELS: Record<string, string> = {
  shop_catalogue: 'Local Shop',
  restaurant_food: 'Food & Dining',
  booking_venue: 'Venue & Turf',
  hotel_stay: 'Stay & Lodge',
  print_digital: 'Print & Digital',
  real_estate: 'Real Estate',
  public_civic: 'Public & Civic',
  general: 'Local Listing',
};

function getInitials(name: string | null | undefined): string {
  const cleaned = String(name || '').trim();
  if (!cleaned) return 'DD';
  const parts = cleaned.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return cleaned.slice(0, 2).toUpperCase();
}

export function ListingDetailHeroClient({
  listingId,
  title,
  categoryLabel,
  verticalRootKey = 'general',
  locality,
  address,
  coordinates,
  contactPhone,
  priceLabel,
  rating = 0,
  reviewCount = 0,
  isVerified = false,
  ownerName,
  ownerAvatar,
  galleryItems,
  panoramaScenes,
  canShow360 = true,
  canDispatchPnd = true,
}: ListingDetailHeroClientProps) {
  const isHydrated = useHydrated();
  const { openShareSheet } = useShare();

  const [failedPhotoIds, setFailedPhotoIds] = useState<Record<string, boolean>>({});
  const [avatarFailed, setAvatarFailed] = useState(false);

  const validGallery = useMemo(
    () =>
      (galleryItems || []).filter(
        (item) => Boolean(item?.url?.trim()) && !failedPhotoIds[item.id]
      ),
    [galleryItems, failedPhotoIds]
  );
  const validPanoramas = useMemo(
    () =>
      canShow360
        ? (panoramaScenes || []).filter((scene) => Boolean(scene?.url?.trim()))
        : [],
    [canShow360, panoramaScenes]
  );

  const [activeTab, setActiveTab] = useState<'photos' | 'panorama'>(
    validGallery.length === 0 && validPanoramas.length > 0 ? 'panorama' : 'photos'
  );
  const [activePhotoIndex, setActivePhotoIndex] = useState(0);
  const [lightboxOpen, setLightboxOpen] = useState(false);

  const closeLightbox = useCallback(() => setLightboxOpen(false), []);
  useModalLock(lightboxOpen, closeLightbox);

  // Honor #media-360 deep-link hash when panoramas exist
  useEffect(() => {
    if (typeof window === 'undefined' || validPanoramas.length === 0) return;
    if (window.location.hash === '#media-360') {
      queueMicrotask(() => setActiveTab('panorama'));
    }
  }, [validPanoramas.length]);

  const { isSaved, toggleSave } = useSavedInterests();
  const saved = isSaved('listing', listingId);

  const safePhotoIndex =
    validGallery.length > 0 ? activePhotoIndex % validGallery.length : 0;
  const currentPhoto = validGallery[safePhotoIndex] || null;

  const handlePrevPhoto = useCallback(() => {
    if (validGallery.length <= 1) return;
    setActivePhotoIndex((prev) =>
      prev <= 0 ? validGallery.length - 1 : prev - 1
    );
  }, [validGallery.length]);

  const handleNextPhoto = useCallback(() => {
    if (validGallery.length <= 1) return;
    setActivePhotoIndex((prev) => (prev + 1) % validGallery.length);
  }, [validGallery.length]);

  // Keyboard navigation in fullscreen lightbox
  useEffect(() => {
    if (!lightboxOpen) return;
    const onKeyDown = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        setLightboxOpen(false);
      } else if (ev.key === 'ArrowLeft') {
        handlePrevPhoto();
      } else if (ev.key === 'ArrowRight') {
        handleNextPhoto();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [lightboxOpen, handlePrevPhoto, handleNextPhoto]);

  const handleRichShare = useCallback(() => {
    openShareSheet({
      title,
      subtitle:
        [categoryLabel, locality].filter(Boolean).join(' · ') || undefined,
      text: locality ? `Check out ${title} in ${locality} on DD oodle` : title,
      url: `/listing/${encodeURIComponent(listingId)}`,
      imageUrl: validGallery[0]?.url || null,
      verticalBadge:
        VERTICAL_BADGE_LABELS[verticalRootKey] || 'Local Listing',
      categoryLabel: categoryLabel || null,
      locality: locality || null,
      priceLabel: priceLabel || null,
      rating: rating > 0 ? rating : null,
      isVerified,
    });
  }, [
    openShareSheet,
    title,
    categoryLabel,
    locality,
    listingId,
    validGallery,
    verticalRootKey,
    priceLabel,
    rating,
    isVerified,
  ]);

  const sanitizedTel = contactPhone
    ? contactPhone.replace(/[^+\d]/g, '')
    : '';
  const hasCoords =
    coordinates &&
    Number.isFinite(coordinates.lat) &&
    Number.isFinite(coordinates.lng) &&
    !(coordinates.lat === 0 && coordinates.lng === 0);

  const directionsUrl = hasCoords
    ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(
        `${coordinates.lat},${coordinates.lng}`
      )}`
    : null;

  const pndHref = hasCoords
    ? `/pick-n-drop?dropoffLat=${encodeURIComponent(
        String(coordinates.lat)
      )}&dropoffLng=${encodeURIComponent(
        String(coordinates.lng)
      )}&dropoffLabel=${encodeURIComponent(
        locality ? `${title}, ${locality}` : title
      )}`
    : '/pick-n-drop';

  const showOwnerAvatarImg = Boolean(ownerAvatar?.trim()) && !avatarFailed;

  return (
    <section
      id="media-360"
      data-testid="listing-detail-hero"
      className="overflow-hidden rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] shadow-xs"
    >
      {/* Media Mode Switcher (Photos vs 360 Panorama) — omitted cleanly when no media */}
      {(validGallery.length > 0 || validPanoramas.length > 0) && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ps-border)] bg-[var(--ps-surface-alt)]/50 px-3.5 py-2 sm:px-4">
          <div className="inline-flex items-center gap-1.5">
            {validGallery.length > 0 && (
              <button
                type="button"
                onClick={() => setActiveTab('photos')}
                className={`inline-flex min-h-[44px] h-11 items-center gap-1.5 rounded-xl px-3.5 text-xs font-bold transition-colors cursor-pointer ${
                  activeTab === 'photos'
                    ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-2xs'
                    : 'border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                }`}
              >
                <ImageIcon className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Photos ({validGallery.length})</span>
              </button>
            )}

            {validPanoramas.length > 0 && (
              <button
                type="button"
                onClick={() => setActiveTab('panorama')}
                data-testid="listing-hero-360-tab"
                className={`inline-flex min-h-[44px] h-11 items-center gap-1.5 rounded-xl px-3.5 text-xs font-bold transition-colors cursor-pointer ${
                  activeTab === 'panorama'
                    ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-2xs'
                    : 'border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                }`}
              >
                <Compass className="h-3.5 w-3.5" aria-hidden="true" />
                <span>360° View ({validPanoramas.length})</span>
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-1.5">
            {priceLabel && (
              <span className="inline-flex items-center rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 py-1 text-xs font-extrabold text-[var(--ps-text)] tabular-nums">
                {priceLabel}
              </span>
            )}
            {isVerified && (
              <span className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2 py-1 text-[11px] font-bold text-emerald-700 dark:text-emerald-300">
                <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Verified</span>
              </span>
            )}
            {rating > 0 && (
              <span className="inline-flex items-center gap-1 rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] font-bold text-amber-800 dark:text-amber-300 tabular-nums">
                <Star className="h-3 w-3 fill-amber-400 text-amber-400" aria-hidden="true" />
                <span>{rating.toFixed(1)}</span>
                {reviewCount > 0 && (
                  <span className="opacity-75">({reviewCount})</span>
                )}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Main Media Viewport */}
      {activeTab === 'panorama' && validPanoramas.length > 0 ? (
        <div className="w-full bg-[var(--ps-bg)]">
          <Panorama360Viewer
            scenes={validPanoramas}
            listingTitle={title}
            coordinates={coordinates || undefined}
          />
        </div>
      ) : currentPhoto ? (
        <div className="group relative aspect-[16/10] sm:aspect-[16/9] max-h-[460px] w-full overflow-hidden bg-[var(--ps-bg)]">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={currentPhoto.url}
            alt={currentPhoto.caption || title}
            referrerPolicy="no-referrer"
            onClick={() => setLightboxOpen(true)}
            onError={() =>
              setFailedPhotoIds((prev) => ({ ...prev, [currentPhoto.id]: true }))
            }
            className="h-full w-full cursor-zoom-in object-cover transition-transform duration-300 group-hover:scale-[1.01]"
          />

          <button
            type="button"
            onClick={() => setLightboxOpen(true)}
            aria-label="Open fullscreen photo gallery"
            data-testid="listing-hero-lightbox-open"
            className="absolute right-3 top-3 inline-flex min-h-[44px] h-11 items-center gap-1.5 rounded-xl border border-white/25 bg-slate-950/70 px-3 text-xs font-bold text-white backdrop-blur-sm hover:bg-slate-950/90 transition-colors cursor-pointer"
          >
            <Maximize2 className="h-4 w-4" aria-hidden="true" />
            <span className="hidden sm:inline">Fullscreen</span>
          </button>

          {validGallery.length > 1 && (
            <>
              <button
                type="button"
                onClick={handlePrevPhoto}
                aria-label="Previous photo"
                className="absolute left-3 top-1/2 -translate-y-1/2 inline-flex min-h-[44px] min-w-[44px] h-11 w-11 items-center justify-center rounded-full border border-white/25 bg-slate-950/65 text-white backdrop-blur-sm hover:bg-slate-950/85 transition-colors cursor-pointer"
              >
                <ChevronLeft className="h-5 w-5" aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={handleNextPhoto}
                aria-label="Next photo"
                className="absolute right-3 top-1/2 -translate-y-1/2 inline-flex min-h-[44px] min-w-[44px] h-11 w-11 items-center justify-center rounded-full border border-white/25 bg-slate-950/65 text-white backdrop-blur-sm hover:bg-slate-950/85 transition-colors cursor-pointer"
              >
                <ChevronRight className="h-5 w-5" aria-hidden="true" />
              </button>
              <div className="absolute bottom-3 right-3 rounded-lg bg-slate-950/75 px-2.5 py-1 text-[11px] font-bold text-white tabular-nums backdrop-blur-sm">
                {safePhotoIndex + 1} / {validGallery.length}
              </div>
            </>
          )}

          {categoryLabel && (
            <div className="pointer-events-none absolute left-3 top-3 rounded-lg border border-white/20 bg-slate-950/70 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur-sm">
              {categoryLabel}
            </div>
          )}

          {currentPhoto.caption && (
            <div className="pointer-events-none absolute bottom-3 left-3 max-w-[70%] truncate rounded-lg bg-slate-950/70 px-2.5 py-1 text-[11px] font-medium text-white backdrop-blur-sm">
              {currentPhoto.caption}
            </div>
          )}
        </div>
      ) : (
        <div className="flex h-40 sm:h-48 w-full flex-col items-center justify-center gap-2 bg-gradient-to-br from-[var(--ps-surface-alt)] to-[var(--ps-bg)] px-4 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)]">
            <ImageIcon className="h-5 w-5" aria-hidden="true" />
          </div>
          <p className="text-xs font-semibold text-[var(--ps-text-muted)]">
            {categoryLabel || 'Local Listing'} · {locality || address || 'Churachandpur'}
          </p>
        </div>
      )}

      {/* Thumbnail Strip */}
      {activeTab === 'photos' && validGallery.length > 1 && (
        <div className="flex items-center gap-2 overflow-x-auto border-t border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 py-2 no-scrollbar">
          {validGallery.map((item, idx) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setActivePhotoIndex(idx)}
              aria-label={`View photo ${idx + 1}`}
              className={`relative h-14 w-20 shrink-0 overflow-hidden rounded-xl border-2 transition-all cursor-pointer ${
                idx === safePhotoIndex
                  ? 'border-[var(--ps-accent)] ring-2 ring-[var(--ps-accent)]/25'
                  : 'border-transparent opacity-70 hover:opacity-100'
              }`}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={item.url}
                alt={item.caption || `${title} thumbnail ${idx + 1}`}
                referrerPolicy="no-referrer"
                onError={() =>
                  setFailedPhotoIds((prev) => ({ ...prev, [item.id]: true }))
                }
                className="h-full w-full object-cover"
              />
            </button>
          ))}
        </div>
      )}

      {/* Action Bar + Owner Strip (44px+ touch targets) */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--ps-border)] p-3.5 sm:p-4">
        <div className="flex flex-wrap items-center gap-2">
          {sanitizedTel && (
            <a
              href={`tel:${sanitizedTel}`}
              className="inline-flex min-h-[44px] h-11 items-center gap-1.5 rounded-xl bg-[var(--btn-primary-bg)] px-4 text-xs font-bold text-[var(--btn-primary-fg)] hover:opacity-95 transition-opacity"
            >
              <Phone className="h-4 w-4" aria-hidden="true" />
              <span>Call</span>
            </a>
          )}

          {directionsUrl && (
            <a
              href={directionsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-[44px] h-11 items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 text-xs font-bold text-[var(--ps-text)] hover:border-[var(--ps-accent)] transition-colors"
            >
              <Navigation className="h-4 w-4 text-[var(--ps-accent)]" aria-hidden="true" />
              <span>Directions</span>
            </a>
          )}

          {canDispatchPnd && (
            <Link
              href={pndHref}
              className="inline-flex min-h-[44px] h-11 items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 text-xs font-bold text-[var(--ps-text)] hover:border-[var(--ps-accent)] transition-colors"
            >
              <Truck className="h-4 w-4 text-[var(--ps-accent)]" aria-hidden="true" />
              <span>Pick N Drop</span>
            </Link>
          )}

          <button
            type="button"
            onClick={() => void toggleSave('listing', listingId)}
            aria-pressed={saved}
            className={`inline-flex min-h-[44px] h-11 items-center gap-1.5 rounded-xl border px-3.5 text-xs font-bold transition-colors cursor-pointer ${
              saved
                ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)]/12 text-[var(--ps-accent)]'
                : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text)] hover:border-[var(--ps-accent)]'
            }`}
          >
            <Bookmark
              className={`h-4 w-4 ${saved ? 'fill-current' : ''}`}
              aria-hidden="true"
            />
            <span>{saved ? 'Saved' : 'Save'}</span>
          </button>

          <button
            type="button"
            onClick={handleRichShare}
            data-testid="listing-hero-share-btn"
            className="inline-flex min-h-[44px] h-11 items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 text-xs font-bold text-[var(--ps-text)] hover:border-[var(--ps-accent)] transition-colors cursor-pointer"
          >
            <Share2 className="h-4 w-4 text-[var(--ps-accent)]" aria-hidden="true" />
            <span>Share</span>
          </button>
        </div>

        {(ownerName || locality) && (
          <div className="flex items-center gap-2 min-w-0">
            {showOwnerAvatarImg ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={ownerAvatar as string}
                alt={ownerName || 'Listing owner'}
                referrerPolicy="no-referrer"
                onError={() => setAvatarFailed(true)}
                className="h-9 w-9 rounded-full border border-[var(--ps-border)] object-cover shrink-0"
              />
            ) : ownerName ? (
              <div
                aria-hidden="true"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] text-[11px] font-extrabold text-[var(--ps-text)]"
              >
                {getInitials(ownerName)}
              </div>
            ) : null}
            <div className="min-w-0 text-right sm:text-left">
              {ownerName && (
                <p className="text-xs font-bold text-[var(--ps-text)] truncate">
                  {ownerName}
                </p>
              )}
              {locality && (
                <p className="inline-flex items-center gap-1 text-[11px] text-[var(--ps-text-muted)] truncate">
                  <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                  <span>{locality}</span>
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Fullscreen Photo Lightbox Modal (portaled + useModalLock Android Back dismissal) */}
      {isHydrated &&
        typeof document !== 'undefined' &&
        createPortal(
          <AnimatePresence>
            {lightboxOpen && currentPhoto && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.16 }}
                onClick={closeLightbox}
                role="dialog"
                aria-modal="true"
                aria-label={`${title} fullscreen photo viewer`}
                data-testid="listing-hero-lightbox"
                className="fixed inset-0 z-[95] flex flex-col bg-slate-950/95 backdrop-blur-md"
              >
                {/* Top Bar */}
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="flex items-center justify-between gap-3 px-4 py-3 text-white border-b border-white/10"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-bold truncate">{title}</p>
                    <p className="text-[11px] text-white/70 tabular-nums">
                      Photo {safePhotoIndex + 1} of {validGallery.length}
                      {currentPhoto.caption ? ` · ${currentPhoto.caption}` : ''}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={closeLightbox}
                    aria-label="Close fullscreen gallery"
                    className="inline-flex min-h-[44px] min-w-[44px] h-11 w-11 shrink-0 items-center justify-center rounded-full border border-white/20 bg-white/10 text-white hover:bg-white/20 cursor-pointer"
                  >
                    <X className="h-5 w-5" />
                  </button>
                </div>

                {/* Main Image Stage */}
                <div
                  onClick={(e) => e.stopPropagation()}
                  className="relative flex flex-1 items-center justify-center p-4 sm:p-8 min-h-0"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={currentPhoto.url}
                    alt={currentPhoto.caption || title}
                    referrerPolicy="no-referrer"
                    className="max-h-full max-w-full rounded-xl object-contain shadow-2xl"
                  />

                  {validGallery.length > 1 && (
                    <>
                      <button
                        type="button"
                        onClick={handlePrevPhoto}
                        aria-label="Previous fullscreen photo"
                        className="absolute left-3 sm:left-6 top-1/2 -translate-y-1/2 inline-flex min-h-[44px] min-w-[44px] h-11 w-11 items-center justify-center rounded-full border border-white/25 bg-slate-900/80 text-white hover:bg-slate-800 cursor-pointer"
                      >
                        <ChevronLeft className="h-5 w-5" />
                      </button>
                      <button
                        type="button"
                        onClick={handleNextPhoto}
                        aria-label="Next fullscreen photo"
                        className="absolute right-3 sm:right-6 top-1/2 -translate-y-1/2 inline-flex min-h-[44px] min-w-[44px] h-11 w-11 items-center justify-center rounded-full border border-white/25 bg-slate-900/80 text-white hover:bg-slate-800 cursor-pointer"
                      >
                        <ChevronRight className="h-5 w-5" />
                      </button>
                    </>
                  )}
                </div>

                {/* Bottom Thumbnails */}
                {validGallery.length > 1 && (
                  <div
                    onClick={(e) => e.stopPropagation()}
                    className="flex items-center justify-center gap-2 overflow-x-auto border-t border-white/10 px-4 py-3 no-scrollbar"
                  >
                    {validGallery.map((item, idx) => (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setActivePhotoIndex(idx)}
                        aria-label={`Select photo ${idx + 1}`}
                        className={`relative h-14 w-20 shrink-0 overflow-hidden rounded-lg border-2 transition-all cursor-pointer ${
                          idx === safePhotoIndex
                            ? 'border-white scale-105'
                            : 'border-transparent opacity-55 hover:opacity-100'
                        }`}
                      >
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img
                          src={item.url}
                          alt={item.caption || `${title} thumb ${idx + 1}`}
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
    </section>
  );
}

export default ListingDetailHeroClient;
