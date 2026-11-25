'use client';

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { RotateCcw, ChevronDown, Loader2 } from 'lucide-react';
import { ListingCardSkeleton } from '@/components/listings/ListingCardSkeleton';
import { fetchBriefListingsPage } from '@/lib/api/listings';
import { useAppStatus } from '@/lib/hooks/useAppStatus';
import type { Listing, MapViewportBounds } from '@/lib/types';
import { trackAppEvent } from '@/lib/analytics/track';

export interface ListingFeedProps {
  initialItems?: Listing[];
  bounds?: MapViewportBounds;
  isLoading?: boolean;
  onSelectListing?: (listingId: string) => void;
  renderCard?: (item: Listing, index: number) => React.ReactNode;
  onReloadFeed?: () => Promise<void> | void;
  className?: string;
  gridClassName?: string;
}

const PAGE_LIMIT = 20;

/**
 * Phase 50-B: Infinite Scroll / Load More Listing Feed
 * - Maintains `offset` starting at `0` and `limit` set to `20`.
 * - Uses `<ListingCardSkeleton />` for feed loading states instead of text.
 * - Includes both an `IntersectionObserver` sentinel and a "Load More" button that increments `offset` by `20` and appends new data.
 * - Includes a "Reload" / "Pull to Refresh" action that resets `offset` to `0` and overwrites state with fresh data.
 */
export function ListingFeed({
  initialItems,
  bounds,
  isLoading: externalLoading = false,
  onSelectListing,
  renderCard,
  onReloadFeed,
  className = '',
  gridClassName = 'space-y-3',
}: ListingFeedProps) {
  const [offset, setOffset] = useState<number>(0);
  const [limit] = useState<number>(PAGE_LIMIT);
  const [fetchedPagesItems, setFetchedPagesItems] = useState<Listing[]>([]);
  const [reloadedOverrideItems, setReloadedOverrideItems] = useState<
    Listing[] | null
  >(null);
  const [isFetchingPage, setIsFetchingPage] = useState<boolean>(false);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [exhaustedRemote, setExhaustedRemote] = useState<boolean>(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  const touchStartYRef = useRef<number | null>(null);
  const { setStatus, clearStatus } = useAppStatus();

  // Initial fetch when used standalone without initialItems
  useEffect(() => {
    if (initialItems) return;
    let active = true;
    queueMicrotask(() => {
      if (active) {
        setIsFetchingPage(true);
        setStatus('fetching_listings');
      }
    });
    fetchBriefListingsPage(0, limit, bounds)
      .then((fresh) => {
        if (!active) return;
        setFetchedPagesItems(fresh);
        setOffset(0);
        setExhaustedRemote(fresh.length < limit);
      })
      .catch(() => {
        if (!active) return;
        setExhaustedRemote(true);
      })
      .finally(() => {
        if (active) {
          setIsFetchingPage(false);
          clearStatus();
        }
      });
    return () => {
      active = false;
    };
  }, [initialItems, bounds, limit, setStatus, clearStatus]);

  const feedItems = useMemo(() => {
    const targetCount = offset + limit;
    const baseSource = initialItems ?? reloadedOverrideItems ?? [];
    const slicedBase = baseSource.slice(0, targetCount);
    const seenIds = new Set(slicedBase.map((item) => item.id));
    const appended = fetchedPagesItems.filter((item) => !seenIds.has(item.id));
    return [...slicedBase, ...appended].slice(0, targetCount);
  }, [initialItems, reloadedOverrideItems, fetchedPagesItems, offset, limit]);

  const hasMore = useMemo(() => {
    const targetCount = offset + limit;
    if (initialItems && initialItems.length > targetCount) {
      return true;
    }
    return !exhaustedRemote && feedItems.length >= limit;
  }, [initialItems, offset, limit, exhaustedRemote, feedItems.length]);

  // Load More handler: increments offset by 20 and appends new data to existing list
  const handleLoadMore = useCallback(async () => {
    if (isFetchingPage || externalLoading) return;
    const nextOffset = offset + limit;
    setIsFetchingPage(true);
    setStatus('loading_more');

    try {
      const nextBatch = await fetchBriefListingsPage(nextOffset, limit, bounds);
      setOffset(nextOffset);
      setFetchedPagesItems((prev) => {
        const existingIds = new Set(prev.map((item) => item.id));
        const deduplicatedNew = nextBatch.filter(
          (item) => !existingIds.has(item.id)
        );
        return [...prev, ...deduplicatedNew];
      });

      const moreInProps = Boolean(
        initialItems && initialItems.length > nextOffset + limit
      );
      if (nextBatch.length < limit && !moreInProps) {
        setExhaustedRemote(true);
      }
    } finally {
      setIsFetchingPage(false);
      clearStatus();
    }
  }, [
    isFetchingPage,
    externalLoading,
    offset,
    limit,
    bounds,
    initialItems,
    setStatus,
    clearStatus,
  ]);

  // Pull to Refresh / Reload handler: resets offset to 0 and overwrites state with fresh data
  const handleReload = useCallback(async () => {
    if (isRefreshing) return;
    setIsRefreshing(true);
    setStatus('fetching_listings');
    setOffset(0);
    setExhaustedRemote(false);

    try {
      if (onReloadFeed) {
        await onReloadFeed();
      }
      const freshBatch = await fetchBriefListingsPage(0, limit, bounds);
      setFetchedPagesItems([]);
      setReloadedOverrideItems(freshBatch);
      if (freshBatch.length < limit && (!initialItems || initialItems.length <= limit)) {
        setExhaustedRemote(true);
      }
    } finally {
      setIsRefreshing(false);
      clearStatus();
    }
  }, [
    isRefreshing,
    onReloadFeed,
    limit,
    bounds,
    initialItems,
    setStatus,
    clearStatus,
  ]);

  // IntersectionObserver for automatic infinite scroll when scrolling near bottom sentinel
  useEffect(() => {
    const node = sentinelRef.current;
    if (!node || !hasMore || isFetchingPage || externalLoading) return;
    if (typeof IntersectionObserver === 'undefined') return;

    const observer = new IntersectionObserver(
      (entries) => {
        const first = entries[0];
        if (first && first.isIntersecting && !isFetchingPage) {
          void handleLoadMore();
        }
      },
      { rootMargin: '150px', threshold: 0.1 }
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [hasMore, isFetchingPage, externalLoading, handleLoadMore]);

  const handleTouchStart = (e: React.TouchEvent<HTMLDivElement>) => {
    if (e.currentTarget.scrollTop <= 0) {
      touchStartYRef.current = e.touches[0]?.clientY ?? null;
    } else {
      touchStartYRef.current = null;
    }
  };

  const handleTouchEnd = (e: React.TouchEvent<HTMLDivElement>) => {
    if (touchStartYRef.current === null) return;
    const endY = e.changedTouches[0]?.clientY ?? touchStartYRef.current;
    const deltaY = endY - touchStartYRef.current;
    touchStartYRef.current = null;
    if (deltaY > 70 && !isRefreshing) {
      void handleReload();
    }
  };

  if (externalLoading || (isRefreshing && feedItems.length === 0)) {
    return (
      <div
        data-testid="listing-feed-skeleton-list"
        className={className}
      >
        {Array.from({ length: 4 }).map((_, idx) => (
          <ListingCardSkeleton key={idx} />
        ))}
      </div>
    );
  }

  return (
    <div
      data-testid="listing-feed-container"
      data-offset={offset}
      data-limit={limit}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      className={className}
    >
      {/* Top Pull-to-Refresh / Reload Action Bar */}
      <div className="flex items-center justify-between gap-2 mb-2.5 px-1">
        <span className="text-[11px] font-medium text-slate-500 dark:text-slate-400 tabular-nums">
          {feedItems.length === 0
            ? 'No places found'
            : `Showing 1–${feedItems.length} ${feedItems.length === 1 ? 'place' : 'places'}`}
        </span>
        <button
          type="button"
          onClick={() => void handleReload()}
          disabled={isRefreshing || isFetchingPage}
          data-testid="listing-feed-reload-btn"
          aria-label="Reload listings feed"
          className="h-8 px-3 inline-flex items-center justify-center gap-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold transition-colors disabled:opacity-60"
        >
          <RotateCcw
            className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`}
          />
          <span>{isRefreshing ? 'Reloading...' : 'Reload'}</span>
        </button>
      </div>

      {/* Refreshing skeleton indicator */}
      {isRefreshing && (
        <div className="mb-3">
          <ListingCardSkeleton />
        </div>
      )}

      {/* Feed Items */}
      <div className={gridClassName}>
        {feedItems.map((item, idx) =>
          renderCard ? (
            <React.Fragment key={item.id}>
              {renderCard(item, idx)}
            </React.Fragment>
          ) : (
            <div
              key={item.id}
              onClick={() => {
                trackAppEvent({
                  event_type: 'listing_click',
                  feature_area: 'listings',
                  target_id: item.id,
                  root_key: item.category,
                  locality: item.locality,
                });
                onSelectListing?.(item.id);
              }}
              className="p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 cursor-pointer hover:border-blue-500/50 transition-colors"
            >
              <h3 className="text-sm font-bold text-slate-900 dark:text-white truncate">
                {item.title}
              </h3>
              <div className="mt-1.5 pt-1.5 border-t border-slate-100 dark:border-slate-800/80 flex flex-wrap items-center justify-between gap-x-2 gap-y-1 min-w-0 text-xs text-slate-500 dark:text-slate-400">
                <span className="truncate min-w-0">
                  {item.locality} · {item.category}
                </span>
                {item.ownerName && (
                  <span className="max-w-[140px] truncate shrink-0 rounded-md border border-slate-200 dark:border-slate-700 px-1.5 py-0.5 text-[10px] font-medium">
                    {item.ownerName}
                  </span>
                )}
              </div>
            </div>
          )
        )}
      </div>

      {/* Appending Skeleton when loading more */}
      {isFetchingPage && (
        <div className="mt-3" data-testid="listing-feed-loading-more">
          <ListingCardSkeleton />
        </div>
      )}

      {/* IntersectionObserver Sentinel & Load More Button */}
      <div
        ref={sentinelRef}
        className="pt-3 pb-2 flex flex-col items-center justify-center"
      >
        {hasMore && (
          <button
            type="button"
            onClick={() => void handleLoadMore()}
            disabled={isFetchingPage}
            data-testid="listing-feed-load-more-btn"
            className="w-full sm:w-auto h-9 px-4 inline-flex items-center justify-center gap-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-100 text-xs font-semibold transition-colors disabled:opacity-60"
          >
            {isFetchingPage ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                <span>Loading more...</span>
              </>
            ) : (
              <>
                <ChevronDown className="w-4 h-4" />
                <span>Load More</span>
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}

export default ListingFeed;
