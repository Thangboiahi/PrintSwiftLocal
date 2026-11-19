'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  Loader2,
  MapPin,
  MessageCircle,
  Package,
  RefreshCw,
  Search,
  ShoppingBag,
  Store,
  X,
  XCircle,
} from 'lucide-react';
import { useAppStatus } from '@/lib/hooks/useAppStatus';
import { useAppStore } from '@/lib/store';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { resolveRemoteMediaUrl } from '@/lib/supabase/storage';

interface MarketplaceListingJoin {
  id: string;
  title: string;
  locality?: string | null;
  phone?: string | null;
  contact_phone?: string | null;
}

interface MarketplaceProductRow {
  id: string;
  title: string;
  price: number | string;
  unit?: string | null;
  category: string;
  in_stock?: boolean | null;
  thumbnail_url?: string | null;
  listing_id: string;
  listings?: MarketplaceListingJoin | MarketplaceListingJoin[] | null;
}

interface MarketplaceProduct {
  id: string;
  title: string;
  price: number;
  unit: string;
  category: string;
  inStock: boolean;
  thumbnailUrl: string;
  listingId: string;
  shopName: string;
  shopLocality: string;
  shopPhone: string;
}

const PAGE_SIZE = 20;

const DEFAULT_CATEGORIES = [
  'All',
  'Printing & Signage',
  'Bakery & Food',
  'Hardware',
  'Handloom & Apparel',
  'Electronics & Solar',
  'Furniture',
  'Books & Stationery',
  'Groceries & Pantry',
];

function formatInrPrice(price: number): string {
  if (!Number.isFinite(price)) return '₹0';
  return `₹${price.toLocaleString('en-IN', {
    minimumFractionDigits: price % 1 === 0 ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

function buildWhatsAppEnquiryHref(product: MarketplaceProduct): string | null {
  const digits = product.shopPhone.replace(/[^\d]/g, '');
  if (!digits) return null;
  const normalizedDigits = digits.length === 10 ? `91${digits}` : digits;
  const message = `Hi ${product.shopName}, I saw "${product.title}" (${formatInrPrice(
    product.price
  )}/${product.unit}) on PrintSwift Local Marketplace. Is it currently available?`;
  return `https://wa.me/${normalizedDigits}?text=${encodeURIComponent(message)}`;
}

function normalizeRow(row: MarketplaceProductRow): MarketplaceProduct {
  const joined = Array.isArray(row.listings)
    ? row.listings[0] ?? null
    : row.listings ?? null;

  const numericPrice =
    typeof row.price === 'number' ? row.price : Number.parseFloat(String(row.price ?? 0));

  return {
    id: row.id,
    title: row.title || 'Local Shop Product',
    price: Number.isFinite(numericPrice) ? numericPrice : 0,
    unit: (row.unit || 'piece').trim(),
    category: (row.category || 'General').trim(),
    inStock: row.in_stock !== false,
    thumbnailUrl: row.thumbnail_url ? resolveRemoteMediaUrl(row.thumbnail_url) : '',
    listingId: row.listing_id,
    shopName: joined?.title?.replace(/^\[SAMPLE\]\s*/i, '') || 'Verified Lamka Shop',
    shopLocality: joined?.locality || 'Churachandpur',
    shopPhone: (joined?.phone || joined?.contact_phone || '').trim(),
  };
}

function ProductThumbnail({
  src,
  alt,
  category,
}: {
  src: string;
  alt: string;
  category: string;
}) {
  const [failed, setFailed] = useState(false);

  if (!src || failed) {
    return (
      <div className="aspect-[4/3] w-full bg-[var(--ps-surface-alt)] flex flex-col items-center justify-center gap-2 px-4 text-center border-b border-[var(--ps-border)]/70">
        <div className="w-10 h-10 rounded-xl bg-[var(--ps-surface)] border border-[var(--ps-border)] flex items-center justify-center text-[var(--ps-text-muted)]">
          <Package className="w-5 h-5" aria-hidden="true" />
        </div>
        <span className="text-[11px] font-medium text-[var(--ps-text-muted)] truncate max-w-full">
          {category}
        </span>
      </div>
    );
  }

  return (
    <div className="aspect-[4/3] w-full overflow-hidden bg-[var(--ps-surface-alt)] border-b border-[var(--ps-border)]/70">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
        className="w-full h-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
      />
    </div>
  );
}

export default function MarketplacePage() {
  const { setStatus, clearStatus } = useAppStatus();
  const { listings: storeListings } = useAppStore();

  const [products, setProducts] = useState<MarketplaceProduct[]>([]);
  const [offset, setOffset] = useState<number>(0);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [isInitialLoading, setIsInitialLoading] = useState<boolean>(true);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState<string>('');
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [availableCategories, setAvailableCategories] =
    useState<string[]>(DEFAULT_CATEGORIES);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  // Fallback builder from existing shop catalogue items if Supabase table is not yet migrated in preview
  const deriveFallbackStoreProducts = useCallback((): MarketplaceProduct[] => {
    const derived: MarketplaceProduct[] = [];
    for (const listing of storeListings) {
      if (listing.category !== 'business' || listing.status !== 'published') continue;
      const catalogue = listing.businessDetails?.catalogue;
      if (Array.isArray(catalogue) && catalogue.length > 0) {
        for (const item of catalogue) {
          derived.push({
            id: `${listing.id}-${item.id}`,
            title: item.name,
            price: Number(item.price || 0),
            unit: 'piece',
            category: item.category || listing.subcategory || 'Local Goods',
            inStock: item.availability !== 'out_of_stock',
            thumbnailUrl: item.imageUrl || listing.coverImage || '',
            listingId: listing.id,
            shopName: listing.title.replace(/^\[SAMPLE\]\s*/i, ''),
            shopLocality: listing.locality || 'Churachandpur',
            shopPhone: listing.contactPhone || '',
          });
        }
      }
    }
    return derived;
  }, [storeListings]);

  const fetchMarketplacePage = useCallback(
    async (nextOffset: number, append: boolean) => {
      if (append) {
        setIsLoadingMore(true);
        setStatus('loading_more');
      } else {
        setIsInitialLoading(true);
        setErrorMessage(null);
        setStatus('fetching_listings');
      }

      try {
        if (!isSupabaseConfigured()) {
          const localItems = deriveFallbackStoreProducts().filter((item) => {
            const matchesCat =
              selectedCategory === 'All' || item.category === selectedCategory;
            const matchesSearch =
              !debouncedSearch ||
              item.title.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
              item.shopName.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
              item.category.toLowerCase().includes(debouncedSearch.toLowerCase());
            return matchesCat && matchesSearch;
          });
          const pageSlice = localItems.slice(nextOffset, nextOffset + PAGE_SIZE);
          setProducts((prev) => (append ? [...prev, ...pageSlice] : pageSlice));
          setOffset(nextOffset);
          setHasMore(localItems.length > nextOffset + PAGE_SIZE);
          return;
        }

        const runQuery = async (includePhoneColumn: boolean) => {
          const selectString = includePhoneColumn
            ? 'id, title, price, unit, category, in_stock, thumbnail_url, listing_id, listings(id, title, locality, phone)'
            : 'id, title, price, unit, category, in_stock, thumbnail_url, listing_id, listings(id, title, locality, contact_phone)';

          let query = supabase
            .from('marketplace_products')
            .select(selectString)
            .eq('is_active', true)
            .order('created_at', { ascending: false })
            .range(nextOffset, nextOffset + PAGE_SIZE - 1);

          if (selectedCategory !== 'All') {
            query = query.eq('category', selectedCategory);
          }
          if (debouncedSearch) {
            query = query.ilike('title', `%${debouncedSearch}%`);
          }

          return query;
        };

        let { data, error } = await runQuery(true);

        // If `listings.phone` isn't present yet on remote DB, gracefully retry with `contact_phone`
        if (error && /phone/i.test(error.message || '')) {
          const retry = await runQuery(false);
          data = retry.data;
          error = retry.error;
        }

        if (error) {
          // If migration hasn't been applied to the remote Supabase DB yet, fall back to live store catalogues gracefully
          if (
            /marketplace_products/i.test(error.message || '') ||
            error.code === '42P01' ||
            error.code === 'PGRST205'
          ) {
            const fallbackItems = deriveFallbackStoreProducts().filter((item) => {
              const matchesCat =
                selectedCategory === 'All' || item.category === selectedCategory;
              const matchesSearch =
                !debouncedSearch ||
                item.title.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
                item.shopName.toLowerCase().includes(debouncedSearch.toLowerCase());
              return matchesCat && matchesSearch;
            });
            const pageSlice = fallbackItems.slice(nextOffset, nextOffset + PAGE_SIZE);
            setProducts((prev) => (append ? [...prev, ...pageSlice] : pageSlice));
            setOffset(nextOffset);
            setHasMore(fallbackItems.length > nextOffset + PAGE_SIZE);
            return;
          }
          throw new Error(error.message || 'Unable to load marketplace products.');
        }

        const mapped = ((data || []) as unknown as MarketplaceProductRow[]).map(
          normalizeRow
        );

        setProducts((prev) => {
          if (!append) return mapped;
          const seen = new Set(prev.map((item) => item.id));
          return [...prev, ...mapped.filter((item) => !seen.has(item.id))];
        });
        setOffset(nextOffset);
        setHasMore(mapped.length === PAGE_SIZE);

        if (mapped.length > 0) {
          setAvailableCategories((prev) => {
            const next = new Set(prev);
            for (const item of mapped) {
              if (item.category) next.add(item.category);
            }
            return Array.from(next);
          });
        }
      } catch (err) {
        setErrorMessage(
          err instanceof Error
            ? err.message
            : 'Failed to load marketplace catalogue.'
        );
      } finally {
        setIsInitialLoading(false);
        setIsLoadingMore(false);
        clearStatus();
      }
    },
    [
      selectedCategory,
      debouncedSearch,
      deriveFallbackStoreProducts,
      setStatus,
      clearStatus,
    ]
  );

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) {
        void fetchMarketplacePage(0, false);
      }
    });
    return () => {
      active = false;
    };
  }, [fetchMarketplacePage]);

  const handleLoadMore = () => {
    if (isLoadingMore || isInitialLoading || !hasMore) return;
    void fetchMarketplacePage(offset + PAGE_SIZE, true);
  };

  const categoryTabs = useMemo(() => {
    const merged = new Set<string>(['All', ...availableCategories]);
    for (const item of products) {
      if (item.category) merged.add(item.category);
    }
    return Array.from(merged);
  }, [availableCategories, products]);

  return (
    <div
      data-testid="marketplace-route-page"
      className="mx-auto w-full max-w-7xl px-4 sm:px-6 py-5 sm:py-6 space-y-5 bg-[var(--ps-bg)] text-[var(--ps-text)]"
    >
      {/* Storefront Header, Dense Search Bar & Horizontal Category Tabs */}
      <section className="space-y-3 border-b border-[var(--ps-border)] pb-4">
        <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3">
          <div className="space-y-1 min-w-0">
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[var(--ps-text)] flex items-center gap-2">
              <ShoppingBag
                className="w-5 h-5 text-[var(--ps-accent)] shrink-0"
                aria-hidden="true"
              />
              <span>Lamka Local Marketplace</span>
            </h1>
            <p className="text-xs sm:text-sm text-[var(--ps-text-muted)]">
              Browse live shop catalogues, pricing, and availability from local Churachandpur businesses.
            </p>
          </div>

          {/* Dense h-9 Search Bar */}
          <div className="relative w-full sm:w-72 md:w-80 shrink-0">
            <Search
              className="w-4 h-4 text-[var(--ps-text-muted)] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search products or shops..."
              aria-label="Search marketplace products"
              data-testid="marketplace-search-input"
              className="w-full h-9 pl-9 pr-8 rounded-xl bg-[var(--ps-surface)] border border-[var(--ps-border)] text-sm text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-ring)] focus:border-[var(--ps-accent)] transition-colors"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput('')}
                aria-label="Clear product search"
                className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-md inline-flex items-center justify-center text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>

        {/* Dense h-8 Horizontal Category Filter Controls */}
        <div
          role="tablist"
          aria-label="Marketplace product categories"
          data-testid="marketplace-category-filters"
          className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5"
        >
          {categoryTabs.map((category) => {
            const isActive = selectedCategory === category;
            return (
              <button
                key={category}
                type="button"
                role="tab"
                aria-selected={isActive}
                onClick={() => setSelectedCategory(category)}
                className={`h-8 px-3 rounded-full text-xs sm:text-sm font-medium whitespace-nowrap shrink-0 transition-colors ${
                  isActive
                    ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-2xs'
                    : 'bg-[var(--ps-surface)] text-[var(--ps-text-muted)] border border-[var(--ps-border)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                }`}
              >
                {category}
              </button>
            );
          })}
        </div>
      </section>

      {/* Error State */}
      {errorMessage && (
        <div
          role="alert"
          className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-4 flex flex-wrap items-center justify-between gap-3"
        >
          <div className="flex items-center gap-2 text-xs sm:text-sm text-rose-700 dark:text-rose-300 font-medium">
            <AlertCircle className="w-4 h-4 shrink-0" aria-hidden="true" />
            <span>{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => void fetchMarketplacePage(0, false)}
            className="h-8 px-3 rounded-lg bg-[var(--ps-surface)] border border-[var(--ps-border)] text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] inline-flex items-center gap-1.5"
          >
            <RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Retry</span>
          </button>
        </div>
      )}

      {/* Initial Loading Skeleton Grid */}
      {isInitialLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, idx) => (
            <div
              key={idx}
              className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] overflow-hidden flex flex-col"
            >
              <div className="aspect-[4/3] w-full bg-slate-200 dark:bg-slate-800 animate-pulse" />
              <div className="p-3.5 space-y-2.5">
                <div className="h-3 w-24 rounded bg-slate-200 dark:bg-slate-800 animate-pulse" />
                <div className="h-4 w-4/5 rounded bg-slate-200 dark:bg-slate-800 animate-pulse" />
                <div className="h-5 w-24 rounded bg-slate-200 dark:bg-slate-800 animate-pulse" />
                <div className="grid grid-cols-2 gap-2 pt-2">
                  <div className="h-8 rounded-lg bg-slate-200 dark:bg-slate-800 animate-pulse" />
                  <div className="h-8 rounded-lg bg-slate-200 dark:bg-slate-800 animate-pulse" />
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : products.length === 0 ? (
        /* Empty State */
        <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-10 text-center space-y-3">
          <div className="w-11 h-11 mx-auto rounded-xl bg-[var(--ps-surface-alt)] border border-[var(--ps-border)] flex items-center justify-center text-[var(--ps-text-muted)]">
            <Store className="w-5 h-5" aria-hidden="true" />
          </div>
          <div className="space-y-1">
            <h2 className="text-base font-bold text-[var(--ps-text)]">
              No matching products found
            </h2>
            <p className="text-xs sm:text-sm text-[var(--ps-text-muted)] max-w-md mx-auto">
              Try adjusting your search keywords or switching to another product category.
            </p>
          </div>
          {(selectedCategory !== 'All' || searchInput) && (
            <button
              type="button"
              onClick={() => {
                setSelectedCategory('All');
                setSearchInput('');
              }}
              className="h-8 px-3.5 rounded-lg bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-semibold hover:opacity-95 transition-opacity"
            >
              Reset Filters
            </button>
          )}
        </div>
      ) : (
        <>
          {/* Results Summary Bar */}
          <div className="flex items-center justify-between text-xs text-[var(--ps-text-muted)]">
            <span className="tabular-nums">
              Showing <strong className="text-[var(--ps-text)]">{products.length}</strong>{' '}
              {products.length === 1 ? 'product' : 'products'}
              {selectedCategory !== 'All' ? ` in ${selectedCategory}` : ''}
            </span>
          </div>

          {/* Uniform 4-Column Product Grid */}
          <div
            data-testid="marketplace-product-grid"
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
          >
            {products.map((product) => {
              const whatsappHref = buildWhatsAppEnquiryHref(product);
              return (
                <article
                  key={product.id}
                  data-testid={`marketplace-product-card-${product.id}`}
                  className="group rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] overflow-hidden flex flex-col justify-between transition-all duration-150 hover:-translate-y-0.5 hover:border-[var(--ps-accent)]/60 hover:shadow-sm"
                >
                  <div>
                    <ProductThumbnail
                      src={product.thumbnailUrl}
                      alt={product.title}
                      category={product.category}
                    />

                    <div className="p-3.5 space-y-2">
                      {/* Clean Unboxed Category + Stock Row */}
                      <div className="flex items-center justify-between gap-2 text-[11px] leading-tight">
                        <span className="font-medium text-[var(--ps-text-muted)] truncate">
                          {product.category}
                        </span>
                        <span
                          className={`inline-flex items-center gap-1 font-semibold shrink-0 whitespace-nowrap ${
                            product.inStock
                              ? 'text-emerald-600 dark:text-emerald-400'
                              : 'text-rose-600 dark:text-rose-400'
                          }`}
                        >
                          {product.inStock ? (
                            <>
                              <CheckCircle2 className="w-3 h-3" aria-hidden="true" />
                              <span>In Stock</span>
                            </>
                          ) : (
                            <>
                              <XCircle className="w-3 h-3" aria-hidden="true" />
                              <span>Out of Stock</span>
                            </>
                          )}
                        </span>
                      </div>

                      {/* Product Title */}
                      <h2 className="text-sm font-semibold tracking-tight text-[var(--ps-text)] leading-snug line-clamp-2 min-h-[2.5rem]">
                        {product.title}
                      </h2>

                      {/* Price & Unit (Tabular Numerals) */}
                      <div className="flex items-baseline gap-1 tabular-nums">
                        <span className="text-base font-bold text-[var(--ps-text)]">
                          {formatInrPrice(product.price)}
                        </span>
                        <span className="text-xs text-[var(--ps-text-muted)]">
                          / {product.unit}
                        </span>
                      </div>

                      {/* Shop Attribution */}
                      <div className="pt-1.5 border-t border-[var(--ps-border)]/70 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[11px] text-[var(--ps-text-muted)] min-w-0">
                        <Store
                          className="w-3 h-3 text-[var(--ps-accent)] shrink-0"
                          aria-hidden="true"
                        />
                        <span className="font-medium text-[var(--ps-text)] truncate max-w-[160px]">
                          {product.shopName}
                        </span>
                        <span aria-hidden="true">·</span>
                        <span className="inline-flex items-center gap-0.5 truncate">
                          <MapPin className="w-3 h-3 shrink-0" aria-hidden="true" />
                          <span className="truncate">{product.shopLocality}</span>
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Quick Actions: View Shop + Enquire */}
                  <div className="px-3.5 pb-3.5 pt-1 grid grid-cols-2 gap-2">
                    <Link
                      href={`/listing/${encodeURIComponent(product.listingId)}`}
                      data-testid={`marketplace-view-shop-${product.id}`}
                      className="h-8 px-2.5 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] hover:border-[var(--ps-accent)]/60 inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors"
                    >
                      <Store className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      <span>View Shop</span>
                    </Link>

                    {whatsappHref ? (
                      <a
                        href={whatsappHref}
                        target="_blank"
                        rel="noopener noreferrer"
                        data-testid={`marketplace-enquire-${product.id}`}
                        className="h-8 px-2.5 rounded-lg bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-semibold hover:opacity-95 inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-opacity"
                      >
                        <MessageCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        <span>Enquire</span>
                      </a>
                    ) : (
                      <Link
                        href={`/listing/${encodeURIComponent(product.listingId)}`}
                        data-testid={`marketplace-enquire-${product.id}`}
                        className="h-8 px-2.5 rounded-lg bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-semibold hover:opacity-95 inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-opacity"
                      >
                        <MessageCircle className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        <span>Enquire</span>
                      </Link>
                    )}
                  </div>
                </article>
              );
            })}
          </div>

          {/* Pagination: Load More Button */}
          {hasMore && (
            <div className="pt-2 pb-4 flex justify-center">
              <button
                type="button"
                onClick={handleLoadMore}
                disabled={isLoadingMore}
                data-testid="marketplace-load-more-btn"
                className="h-9 px-5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-xs sm:text-sm font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] inline-flex items-center justify-center gap-2 transition-colors disabled:opacity-60"
              >
                {isLoadingMore ? (
                  <>
                    <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />
                    <span>Loading more...</span>
                  </>
                ) : (
                  <>
                    <ChevronDown className="w-4 h-4" aria-hidden="true" />
                    <span>Load More</span>
                  </>
                )}
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}
