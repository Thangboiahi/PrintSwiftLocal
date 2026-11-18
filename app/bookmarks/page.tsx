'use client';

import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, Bookmark, MapPin, Trash2, User } from 'lucide-react';
import {
  Breadcrumbs,
  triggerUnmountOverlaysToMap,
} from '@/components/navigation/Breadcrumbs';
import { emitBookmarkChange } from '@/lib/events';
import { CATEGORY_LABELS } from '@/lib/rules';
import { useAppStore, useAuth } from '@/lib/store';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';

export default function BookmarksRoutePage() {
  const router = useRouter();
  const { listings, savedListingIds, toggleSavedListing } = useAppStore();
  const { user: authUser, session: activeSession } = useAuth();
  const activeUserId = authUser?.id || activeSession?.user?.id || '';

  const [remoteSavedIds, setRemoteSavedIds] = useState<string[] | null>(null);

  useEffect(() => {
    if (!activeUserId || !isSupabaseConfigured()) return;
    let active = true;

    const loadSavedIds = async () => {
      try {
        const { data } = await supabase
          .from('profiles')
          .select('saved_listing_ids')
          .eq('id', activeUserId)
          .maybeSingle();

        if (!active || !data) return;
        const rawIds = (data as { saved_listing_ids?: unknown })
          .saved_listing_ids;
        if (Array.isArray(rawIds)) {
          setRemoteSavedIds(
            rawIds.filter(
              (id): id is string =>
                typeof id === 'string' && id.trim().length > 0
            )
          );
        }
      } catch {
        // fallback to store savedListingIds
      }
    };

    void loadSavedIds();

    const handleUpdated = () => {
      void loadSavedIds();
    };

    if (typeof window !== 'undefined') {
      window.addEventListener('bookmarks_updated', handleUpdated);
    }

    return () => {
      active = false;
      if (typeof window !== 'undefined') {
        window.removeEventListener('bookmarks_updated', handleUpdated);
      }
    };
  }, [activeUserId]);

  const effectiveSavedIds = useMemo(() => {
    if (Array.isArray(savedListingIds) && savedListingIds.length > 0) {
      return savedListingIds;
    }
    return remoteSavedIds || [];
  }, [savedListingIds, remoteSavedIds]);

  const savedListings = useMemo(
    () => listings.filter((item) => effectiveSavedIds.includes(item.id)),
    [listings, effectiveSavedIds]
  );

  const handleRemoveBookmark = async (listingId: string) => {
    toggleSavedListing(listingId);
    setRemoteSavedIds((prev) =>
      prev ? prev.filter((id) => id !== listingId) : prev
    );
    emitBookmarkChange();
  };

  const handleLocateOnMap = (listingId: string) => {
    triggerUnmountOverlaysToMap();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('printswift:focus-map-listing', {
          detail: { listingId },
        })
      );
    }
    router.push('/');
  };

  return (
    <div
      data-testid="bookmarks-route-page"
      className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 bg-[var(--ps-bg)] text-[var(--ps-text)]"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--ps-border)] pb-4">
        <div className="space-y-1">
          <Breadcrumbs items={[{ label: 'Saved Bookmarks' }]} />
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[var(--ps-text)] flex items-center gap-2">
            <Bookmark className="h-5 w-5 text-amber-500" />
            <span>Saved Bookmarks ({savedListings.length})</span>
          </h1>
          <p className="text-xs text-[var(--ps-text-muted)]">
            Bookmarked listings across Churachandpur synchronized with your account.
          </p>
        </div>

        <Link
          href="/"
          onClick={() => triggerUnmountOverlaysToMap()}
          className="inline-flex items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3.5 py-2 text-xs font-bold text-[var(--ps-accent-fg)] shadow-2xs transition hover:opacity-95"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          <span>Back to Explore</span>
        </Link>
      </div>

      {savedListings.length === 0 ? (
        <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-10 text-center space-y-2">
          <p className="text-sm font-semibold text-[var(--ps-text)]">
            No saved bookmarks yet.
          </p>
          <p className="text-xs text-[var(--ps-text-muted)]">
            Tap the Bookmark icon on any listing card or map preview to save it here.
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {savedListings.map((item) => (
            <div
              key={item.id}
              data-testid={`bookmark-card-${item.id}`}
              className="flex flex-col justify-between overflow-hidden rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] shadow-xs transition-all hover:border-[var(--ps-accent)]/60"
            >
              <div>
                {item.coverImage?.trim() ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.coverImage.trim()}
                    alt={item.title}
                    referrerPolicy="no-referrer"
                    className="h-44 w-full object-cover"
                  />
                ) : (
                  <div className="flex h-44 w-full items-center justify-center bg-[var(--ps-surface-alt)] text-xs font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                    {CATEGORY_LABELS[item.category]}
                  </div>
                )}
                <div className="p-4">
                  <div className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-[var(--ps-accent)]">
                    <span>{CATEGORY_LABELS[item.category]}</span>
                    <span className="text-[var(--ps-border)]">·</span>
                    <span className="font-semibold normal-case tracking-normal text-[var(--ps-text-muted)]">
                      {item.locality}
                    </span>
                    <span className="text-[var(--ps-border)]">·</span>
                    <span className="font-bold text-amber-500 tabular-nums">
                      ★ {item.rating}
                    </span>
                  </div>
                  <h2 className="mt-1 text-base font-bold tracking-tight text-[var(--ps-text)]">
                    {item.title}
                  </h2>
                  <p className="mt-1.5 line-clamp-2 text-xs leading-relaxed text-[var(--ps-text-muted)]">
                    {item.shortDescription}
                  </p>
                  <div className="mt-2.5 flex items-center justify-between border-t border-[var(--ps-border)]/60 pt-2 text-[11px]">
                    <Link
                      href={`/user/${encodeURIComponent(item.ownerId || 'owner-1')}`}
                      className="inline-flex items-center gap-1.5 font-semibold text-[var(--ps-text-muted)] hover:text-[var(--ps-accent)]"
                    >
                      <User className="h-3 w-3 text-[var(--ps-accent)]" />
                      <span className="max-w-[160px] truncate">
                        {item.ownerName || 'Listing Owner'}
                      </span>
                    </Link>
                  </div>
                </div>
              </div>
              <div className="flex items-center justify-between gap-2 border-t border-[var(--ps-border)]/80 bg-[var(--ps-surface-alt)]/30 px-4 py-3">
                <button
                  type="button"
                  onClick={() => void handleRemoveBookmark(item.id)}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600 hover:underline"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                  <span>Remove</span>
                </button>
                <div className="flex items-center gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleLocateOnMap(item.id)}
                    className="inline-flex items-center gap-1 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 py-1.5 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]"
                  >
                    <MapPin className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
                    <span>Locate on Map</span>
                  </button>
                  <Link
                    href={`/listing/${encodeURIComponent(item.id)}`}
                    className="rounded-xl bg-[var(--ps-accent)] px-3 py-1.5 text-xs font-semibold text-[var(--ps-accent-fg)] hover:opacity-95"
                  >
                    View Details
                  </Link>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
