'use client';

import React, { useMemo, useState } from 'react';
import Link from 'next/link';
import { Compass, Images } from 'lucide-react';
import { resolveRemoteMediaUrl } from '@/lib/supabase/storage';
import type { Listing } from '@/lib/types';

export interface SummaryMediaStripProps {
  listing: Listing;
  onNavigate360?: () => void;
  className?: string;
}

type ListingMediaLike = {
  url?: string | null;
  media_type?: string | null;
  is_equirectangular?: boolean | null;
  is360?: boolean | null;
};

type ListingWithOptionalMedia = Listing & {
  listingMedia?: ListingMediaLike[] | null;
};

function isValidMediaUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  const trimmed = url.trim();
  if (!trimmed) return false;
  return (
    trimmed.startsWith('http://') ||
    trimmed.startsWith('https://') ||
    trimmed.startsWith('/') ||
    trimmed.startsWith('data:image/')
  );
}

export function listingHas360Panorama(listing: Listing): boolean {
  const withMedia = listing as ListingWithOptionalMedia;
  if (
    Array.isArray(listing.panoramas_360) &&
    listing.panoramas_360.some((p) => isValidMediaUrl(p?.url))
  ) {
    return true;
  }
  if (
    Array.isArray(withMedia.listingMedia) &&
    withMedia.listingMedia.some(
      (m) =>
        (m.media_type === 'panorama_360' ||
          m.is_equirectangular === true ||
          m.is360 === true) &&
        isValidMediaUrl(m.url)
    )
  ) {
    return true;
  }
  if (isValidMediaUrl(listing.realEstateDetails?.panoramaUrl)) {
    return true;
  }
  if (
    Array.isArray(listing.realEstateDetails?.panoramas) &&
    listing.realEstateDetails.panoramas.some((p) => isValidMediaUrl(p?.imageUrl))
  ) {
    return true;
  }
  return false;
}

export function SummaryMediaStrip({
  listing,
  onNavigate360,
  className = '',
}: SummaryMediaStripProps) {
  const [failedUrls, setFailedUrls] = useState<Record<string, boolean>>({});

  const has360 = useMemo(() => listingHas360Panorama(listing), [listing]);

  const photos = useMemo(() => {
    const withMedia = listing as ListingWithOptionalMedia;
    const raw: string[] = [];
    if (isValidMediaUrl(listing.coverImage)) raw.push(listing.coverImage.trim());
    if (Array.isArray(listing.galleryImages)) {
      for (const u of listing.galleryImages) {
        if (isValidMediaUrl(u)) raw.push(u.trim());
      }
    }
    if (Array.isArray(withMedia.listingMedia)) {
      for (const m of withMedia.listingMedia) {
        if (
          m.media_type !== 'panorama_360' &&
          m.is_equirectangular !== true &&
          m.is360 !== true &&
          isValidMediaUrl(m.url)
        ) {
          raw.push(m.url.trim());
        }
      }
    }

    const seen = new Set<string>();
    const deduped: string[] = [];
    for (const candidate of raw) {
      const resolved = resolveRemoteMediaUrl(candidate);
      if (resolved && !seen.has(resolved)) {
        seen.add(resolved);
        deduped.push(resolved);
      }
    }
    return deduped.slice(0, 6);
  }, [listing]);

  const visiblePhotos = useMemo(
    () => photos.filter((u) => !failedUrls[u]),
    [photos, failedUrls]
  );

  if (visiblePhotos.length === 0 && !has360) {
    return null;
  }

  return (
    <div className={`space-y-2 ${className}`}>
      {visiblePhotos.length > 0 && (
        <div className="relative">
          <div className="flex gap-2 overflow-x-auto pb-1 snap-x snap-mandatory scrollbar-none">
            {visiblePhotos.map((src, idx) => (
              <div
                key={src}
                className={`relative shrink-0 snap-start overflow-hidden rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] ${
                  visiblePhotos.length === 1 ? 'h-32 w-full' : 'h-24 w-36'
                }`}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={src}
                  alt={`${listing.title} photo ${idx + 1}`}
                  referrerPolicy="no-referrer"
                  loading="lazy"
                  onError={() =>
                    setFailedUrls((prev) => ({ ...prev, [src]: true }))
                  }
                  className="h-full w-full object-cover"
                />
                {idx === 0 && visiblePhotos.length > 1 && (
                  <span className="pointer-events-none absolute bottom-1.5 left-1.5 inline-flex items-center gap-1 rounded-md bg-slate-950/75 px-1.5 py-0.5 text-[10px] font-bold text-white backdrop-blur-xs">
                    <Images className="h-2.5 w-2.5" />
                    {visiblePhotos.length}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {has360 && (
        <Link
          href={`/listing/${encodeURIComponent(listing.id)}#media-360`}
          onClick={() => onNavigate360?.()}
          data-testid="summary-360-tour-link"
          className="inline-flex min-h-[44px] h-11 w-full items-center justify-between gap-2 rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-3 text-xs font-bold text-indigo-700 transition hover:bg-indigo-500/15 dark:text-indigo-300"
        >
          <span className="inline-flex items-center gap-1.5">
            <Compass className="h-4 w-4 shrink-0" />
            <span>360° Virtual Tour Available</span>
          </span>
          <span className="rounded-md bg-indigo-600 px-2 py-0.5 text-[10px] font-extrabold text-white">
            Explore 360° →
          </span>
        </Link>
      )}
    </div>
  );
}

export default SummaryMediaStrip;
