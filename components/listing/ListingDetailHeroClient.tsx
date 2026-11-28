'use client';

import React, { useCallback, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  BadgeCheck,
  Bookmark,
  MapPin,
  Navigation,
  Phone,
  Share2,
  Star,
  Truck,
} from 'lucide-react';
import { ListingMediaGallery } from '@/components/discovery/ListingMediaGallery';
import type { PublicPanorama360Scene } from '@/components/verticals/Panorama360Viewer';
import { useShare } from '@/components/ui/ShareSheetModal';
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
  const { openShareSheet } = useShare();
  const { isSaved, toggleSave } = useSavedInterests();
  const saved = isSaved('listing', listingId);

  const [failedAvatarUrl, setFailedAvatarUrl] = useState<string | null>(null);

  const validGallery = useMemo(
    () =>
      (galleryItems || [])
        .filter((item) => Boolean(item?.url?.trim()))
        .map((item) => ({
          id: item.id,
          url: item.url.trim(),
          caption: item.caption ?? null,
        })),
    [galleryItems]
  );

  const validPanoramas = useMemo(
    () =>
      canShow360
        ? (panoramaScenes || []).filter((scene) => Boolean(scene?.url?.trim()))
        : [],
    [canShow360, panoramaScenes]
  );

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
      category: categoryLabel || undefined,
      categoryLabel: categoryLabel || null,
      locality: locality || null,
      priceLabel: priceLabel || null,
      priceText: priceLabel || null,
      rating: rating > 0 ? rating : null,
      isVerified,
      verified: isVerified,
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

  const normalizedOwnerAvatar = ownerAvatar?.trim() || null;
  const showOwnerAvatarImg =
    Boolean(normalizedOwnerAvatar) && failedAvatarUrl !== normalizedOwnerAvatar;

  return (
    <section
      id="media-360"
      data-testid="listing-detail-hero"
      className="overflow-hidden rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] shadow-xs"
    >
      {/* Unified Auto-Scrolling Photo Gallery + Lightbox + Seamless 360° Slot */}
      <ListingMediaGallery
        images={validGallery}
        panoramas={validPanoramas}
        title={title}
        subtitle={
          [categoryLabel || 'Local Listing', locality || address]
            .filter(Boolean)
            .join(' · ') || 'Churachandpur'
        }
        listingVertical={verticalRootKey}
        coordinates={coordinates || undefined}
        aspectClassName="aspect-[16/10] sm:aspect-[16/9] max-h-[460px]"
        roundedClassName="rounded-none"
        autoPlayMs={4500}
        showThumbnails
        honorHashDeepLink
        topLeftSlot={
          <>
            {categoryLabel && (
              <span className="rounded-lg border border-white/20 bg-slate-950/70 px-2.5 py-1 text-[11px] font-bold text-white backdrop-blur-sm">
                {categoryLabel}
              </span>
            )}
            {isVerified && (
              <span className="inline-flex items-center gap-1 rounded-lg bg-emerald-600/95 px-2 py-1 text-[10px] font-extrabold text-white shadow-xs backdrop-blur-sm">
                <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" />
                <span>Verified</span>
              </span>
            )}
          </>
        }
        topRightSlot={
          <>
            {priceLabel && (
              <span className="hidden sm:inline-flex items-center rounded-lg border border-white/20 bg-slate-950/75 px-2.5 py-1 font-mono text-xs font-extrabold text-white tabular-nums backdrop-blur-sm">
                {priceLabel}
              </span>
            )}
            {rating > 0 && (
              <span className="inline-flex items-center gap-1 rounded-lg border border-white/20 bg-slate-950/75 px-2 py-1 text-[11px] font-bold text-amber-300 tabular-nums backdrop-blur-sm">
                <Star
                  className="h-3 w-3 fill-amber-400 text-amber-400"
                  aria-hidden="true"
                />
                <span>{rating.toFixed(1)}</span>
                {reviewCount > 0 && (
                  <span className="text-white/75">({reviewCount})</span>
                )}
              </span>
            )}
          </>
        }
      />

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
              <Navigation
                className="h-4 w-4 text-[var(--ps-accent)]"
                aria-hidden="true"
              />
              <span>Directions</span>
            </a>
          )}

          {canDispatchPnd && (
            <Link
              href={pndHref}
              className="inline-flex min-h-[44px] h-11 items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 text-xs font-bold text-[var(--ps-text)] hover:border-[var(--ps-accent)] transition-colors"
            >
              <Truck
                className="h-4 w-4 text-[var(--ps-accent)]"
                aria-hidden="true"
              />
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
            <Share2
              className="h-4 w-4 text-[var(--ps-accent)]"
              aria-hidden="true"
            />
            <span>Share</span>
          </button>
        </div>

        {(ownerName || locality) && (
          <div className="flex items-center gap-2 min-w-0">
            {showOwnerAvatarImg && normalizedOwnerAvatar ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={normalizedOwnerAvatar}
                alt={ownerName || 'Listing owner'}
                referrerPolicy="no-referrer"
                onError={() => setFailedAvatarUrl(normalizedOwnerAvatar)}
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
    </section>
  );
}

export default ListingDetailHeroClient;
