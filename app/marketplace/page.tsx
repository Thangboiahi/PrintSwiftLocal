'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowRight,
  Bookmark,
  CheckCircle2,
  ChevronDown,
  Loader2,
  MapPin,
  MessageCircle,
  Package,
  Printer,
  RefreshCw,
  Search,
  ShoppingBag,
  Store,
  Truck,
  UserCheck,
  UserPlus,
  UtensilsCrossed,
  X,
  XCircle,
} from 'lucide-react';
import { useAppStatus } from '@/lib/hooks/useAppStatus';
import { useSavedInterests } from '@/lib/hooks/useSavedInterests';
import {
  isPrintProfileBusyPaused,
  normalizeClientPrintProfile,
} from '@/lib/print-orders/client-helpers';
import { useAppStore } from '@/lib/store';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import {
  fetchHideSampleDataFlag,
  isSampleTitle,
} from '@/lib/supabase/platform-settings';
import { resolveRemoteMediaUrl } from '@/lib/supabase/storage';
import { ModulePausedGuard } from '@/components/shared/ModulePausedGuard';
import { PromoBannerSlot } from '@/components/ui/PromoBannerSlot';
import { splitSamplePrefix } from '@/lib/utils/display-title';
import { useAppConfig } from '@/components/providers/AppConfigProvider';
import type { NestedCategoryNode } from '@/lib/config/types';

interface MarketplaceListingJoin {
  id: string;
  title: string;
  locality?: string | null;
  phone?: string | null;
  contact_phone?: string | null;
  lat?: number | null;
  lng?: number | null;
  lifecycle_status?: string | null;
}

type MarketplaceTopTab = 'shops' | 'food' | 'print';
type FoodDietaryFilter = 'all' | 'veg' | 'non_veg' | 'egg';

interface MarketplaceDishItem {
  id: string;
  listingId: string;
  name: string;
  description: string;
  category: string;
  dietaryType: 'veg' | 'non_veg' | 'egg';
  priceInr: number;
  imageUrl: string;
  restaurantName: string;
  restaurantLocality: string;
  hubId: string | null;
}

interface MarketplacePrintShopItem {
  listingId: string;
  title: string;
  locality: string;
  coverImage: string;
  isFirstParty: boolean;
  isAccepting: boolean;
  isBusy: boolean;
  bwRateInr: number | null;
  colorRateInr: number | null;
  hubId: string | null;
}

interface MarketplaceProductRow {
  id: string;
  title: string;
  description?: string | null;
  price: number | string;
  unit?: string | null;
  category: string;
  category_id?: string | null;
  custom_tags?: string[] | null;
  hub_id?: string | null;
  in_stock?: boolean | null;
  thumbnail_url?: string | null;
  listing_id: string;
  listings?: MarketplaceListingJoin | MarketplaceListingJoin[] | null;
}

interface MarketplaceProduct {
  id: string;
  title: string;
  description: string;
  price: number;
  unit: string;
  category: string;
  categoryId: string | null;
  customTags: string[];
  hubId: string | null;
  inStock: boolean;
  thumbnailUrl: string;
  listingId: string;
  shopName: string;
  shopLocality: string;
  shopPhone: string;
  shopLat: number | null;
  shopLng: number | null;
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

function buildWhatsAppEnquiryHref(
  product: MarketplaceProduct,
  template?: string | null
): string | null {
  const digits = product.shopPhone.replace(/[^\d]/g, '');
  if (!digits) return null;
  const normalizedDigits = digits.length === 10 ? `91${digits}` : digits;
  const trimmedTemplate = (template || '').trim();
  const formattedPrice = `${formatInrPrice(product.price)}/${product.unit}`;
  const message = trimmedTemplate
    ? trimmedTemplate
        .replace(/\{\{\s*title\s*\}\}/gi, product.title)
        .replace(/\{\{\s*shop\s*\}\}/gi, product.shopName)
        .replace(/\{\{\s*price\s*\}\}/gi, formattedPrice)
    : `Hi ${product.shopName}, I saw "${product.title}" (${formattedPrice}) on PrintSwift Local Marketplace. Is it currently available?`;
  return `https://wa.me/${normalizedDigits}?text=${encodeURIComponent(message)}`;
}

function buildPickNDropHref(product: MarketplaceProduct, hubSlug?: string | null): string {
  const params = new URLSearchParams();
  if (hubSlug) {
    params.set('hub', hubSlug);
  }
  params.set('mode', 'pick_n_drop');
  if (
    typeof product.shopLat === 'number' &&
    typeof product.shopLng === 'number' &&
    Number.isFinite(product.shopLat) &&
    Number.isFinite(product.shopLng)
  ) {
    params.set('pickupLat', String(product.shopLat));
    params.set('pickupLng', String(product.shopLng));
  }
  params.set('pickupLabel', `${product.shopName} — ${product.title}`);
  return `/pick-n-drop?${params.toString()}`;
}

function normalizeRow(row: MarketplaceProductRow, defaultHubName = 'Churachandpur'): MarketplaceProduct {
  const joined = Array.isArray(row.listings)
    ? row.listings[0] ?? null
    : row.listings ?? null;

  const numericPrice =
    typeof row.price === 'number' ? row.price : Number.parseFloat(String(row.price ?? 0));
  const rawLat = joined?.lat !== null && joined?.lat !== undefined ? Number(joined.lat) : NaN;
  const rawLng = joined?.lng !== null && joined?.lng !== undefined ? Number(joined.lng) : NaN;

  return {
    id: row.id,
    title: row.title || 'Local Shop Product',
    description: (row.description || '').trim(),
    price: Number.isFinite(numericPrice) ? numericPrice : 0,
    unit: (row.unit || 'piece').trim(),
    category: (row.category || 'General').trim(),
    categoryId: row.category_id || null,
    customTags: Array.isArray(row.custom_tags)
      ? row.custom_tags.map((t) => String(t).trim()).filter(Boolean)
      : [],
    hubId: row.hub_id || null,
    inStock: row.in_stock !== false,
    thumbnailUrl: row.thumbnail_url ? resolveRemoteMediaUrl(row.thumbnail_url) : '',
    listingId: row.listing_id,
    shopName: joined?.title?.replace(/^\[SAMPLE\]\s*/i, '') || `Verified ${defaultHubName} Shop`,
    shopLocality: joined?.locality || defaultHubName,
    shopPhone: (joined?.phone || joined?.contact_phone || '').trim(),
    shopLat: Number.isFinite(rawLat) ? rawLat : null,
    shopLng: Number.isFinite(rawLng) ? rawLng : null,
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
  const { isSaved, toggleSave, isFollowing, toggleFollow } = useSavedInterests();
  const {
    activeHub,
    categories: appConfigCategories,
    categoriesByEntity,
    getCategorySubtreeSlugsOrIds,
    office,
  } = useAppConfig();

  const activeHubId = activeHub?.id || '';
  const activeHubName = activeHub?.name || 'Churachandpur';
  const activeHubSlug = activeHub?.slug || 'churachandpur';

  const [products, setProducts] = useState<MarketplaceProduct[]>([]);
  const [offset, setOffset] = useState<number>(0);
  const [hasMore, setHasMore] = useState<boolean>(false);
  const [isInitialLoading, setIsInitialLoading] = useState<boolean>(true);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [searchInput, setSearchInput] = useState<string>('');
  const [debouncedSearch, setDebouncedSearch] = useState<string>('');
  const [selectedCategory, setSelectedCategory] = useState<string>('All');
  const [selectedSubcategoryId, setSelectedSubcategoryId] = useState<string>('all');
  const [availableCategories, setAvailableCategories] =
    useState<string[]>(DEFAULT_CATEGORIES);
  const [activePrintShopMap, setActivePrintShopMap] = useState<
    Record<string, boolean>
  >({});

  // Pass R2: 3-Tab Cohesive Shop & Food Marketplace
  const [activeTopTab, setActiveTopTab] = useState<MarketplaceTopTab>('shops');
  const [foodDietaryFilter, setFoodDietaryFilter] =
    useState<FoodDietaryFilter>('all');
  const [foodDishes, setFoodDishes] = useState<MarketplaceDishItem[]>([]);
  const [isLoadingFood, setIsLoadingFood] = useState<boolean>(false);
  const [printShops, setPrintShops] = useState<MarketplacePrintShopItem[]>([]);
  const [isLoadingPrintShops, setIsLoadingPrintShops] =
    useState<boolean>(false);

  // Hydrate ?tab= query param on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const t = new URLSearchParams(window.location.search)
      .get('tab')
      ?.trim()
      .toLowerCase();
    if (t === 'food' || t === 'print' || t === 'shops') {
      setActiveTopTab(t);
    }
  }, []);

  // Load Food & Popular Dishes when 'food' tab is active
  useEffect(() => {
    if (activeTopTab !== 'food' || !isSupabaseConfigured()) return;
    let active = true;
    const loadFoodDishes = async () => {
      setIsLoadingFood(true);
      try {
        const { data, error } = await supabase
          .from('restaurant_menu_items')
          .select(
            'id, listing_id, name, description, category, dietary_type, base_price_inr, image_url, in_stock, listings!inner(id, hub_id, title, locality, lifecycle_status, cover_image)'
          )
          .eq('in_stock', true)
          .order('sort_order', { ascending: true })
          .limit(80);
        if (!active || error || !Array.isArray(data)) return;

        const mapped: MarketplaceDishItem[] = [];
        for (const row of data as Array<Record<string, unknown>>) {
          const listingJoin = Array.isArray(row.listings)
            ? (row.listings[0] as Record<string, unknown> | undefined)
            : (row.listings as Record<string, unknown> | undefined);
          if (!listingJoin) continue;
          if (
            listingJoin.lifecycle_status &&
            listingJoin.lifecycle_status !== 'active'
          ) {
            continue;
          }
          const hubId =
            typeof listingJoin.hub_id === 'string' ? listingJoin.hub_id : null;
          if (
            activeHubId &&
            !activeHubId.startsWith('fallback-') &&
            hubId &&
            hubId !== activeHubId
          ) {
            continue;
          }
          const rawDiet = String(row.dietary_type || 'veg').toLowerCase();
          const dietaryType: 'veg' | 'non_veg' | 'egg' =
            rawDiet === 'non_veg'
              ? 'non_veg'
              : rawDiet === 'egg'
                ? 'egg'
                : 'veg';

          mapped.push({
            id: String(row.id || ''),
            listingId: String(row.listing_id || listingJoin.id || ''),
            name: String(row.name || 'Popular Dish'),
            description: String(row.description || ''),
            category: String(row.category || 'Main Course'),
            dietaryType,
            priceInr: Number(row.base_price_inr ?? 0),
            imageUrl: resolveRemoteMediaUrl(
              typeof row.image_url === 'string' && row.image_url
                ? row.image_url
                : typeof listingJoin.cover_image === 'string'
                  ? listingJoin.cover_image
                  : ''
            ),
            restaurantName: String(listingJoin.title || 'Local Restaurant'),
            restaurantLocality: String(listingJoin.locality || activeHubName),
            hubId,
          });
        }
        setFoodDishes(mapped);
      } catch {
        // Non-blocking
      } finally {
        if (active) setIsLoadingFood(false);
      }
    };
    void loadFoodDishes();
    return () => {
      active = false;
    };
  }, [activeTopTab, activeHubId, activeHubName]);

  // Load Print & Digital Services when 'print' tab is active
  useEffect(() => {
    if (activeTopTab !== 'print' || !isSupabaseConfigured()) return;
    let active = true;
    const loadPrintShops = async () => {
      setIsLoadingPrintShops(true);
      try {
        const { data, error } = await supabase
          .from('listing_print_profiles')
          .select(
            'listing_id, is_first_party_printswift, is_accepting_orders, busy_until, pricing_config, listings!inner(id, hub_id, title, locality, lifecycle_status, cover_image)'
          )
          .eq('is_accepting_orders', true)
          .limit(50);
        if (!active || error || !Array.isArray(data)) return;

        const nowMs = Date.now();
        const mapped: MarketplacePrintShopItem[] = [];
        for (const row of data as Array<Record<string, unknown>>) {
          const listingJoin = Array.isArray(row.listings)
            ? (row.listings[0] as Record<string, unknown> | undefined)
            : (row.listings as Record<string, unknown> | undefined);
          if (!listingJoin) continue;
          if (
            listingJoin.lifecycle_status &&
            listingJoin.lifecycle_status !== 'active'
          ) {
            continue;
          }
          const hubId =
            typeof listingJoin.hub_id === 'string' ? listingJoin.hub_id : null;
          if (
            activeHubId &&
            !activeHubId.startsWith('fallback-') &&
            hubId &&
            hubId !== activeHubId
          ) {
            continue;
          }
          const pricing =
            row.pricing_config && typeof row.pricing_config === 'object'
              ? (row.pricing_config as Record<string, unknown>)
              : {};
          const bwVal = Number(pricing.bw_a4_per_page_inr ?? pricing.bw_per_page ?? 3);
          const colorVal = Number(
            pricing.color_a4_per_page_inr ?? pricing.color_per_page ?? 10
          );

          mapped.push({
            listingId: String(row.listing_id || listingJoin.id || ''),
            title: String(listingJoin.title || 'Print Counter'),
            locality: String(listingJoin.locality || activeHubName),
            coverImage: resolveRemoteMediaUrl(
              typeof listingJoin.cover_image === 'string'
                ? listingJoin.cover_image
                : ''
            ),
            isFirstParty: Boolean(row.is_first_party_printswift),
            isAccepting: row.is_accepting_orders !== false,
            isBusy: isPrintProfileBusyPaused(
              typeof row.busy_until === 'string' ? row.busy_until : null,
              nowMs
            ),
            bwRateInr: Number.isFinite(bwVal) ? bwVal : null,
            colorRateInr: Number.isFinite(colorVal) ? colorVal : null,
            hubId,
          });
        }
        setPrintShops(mapped);
      } catch {
        // Non-blocking
      } finally {
        if (active) setIsLoadingPrintShops(false);
      }
    };
    void loadPrintShops();
    return () => {
      active = false;
    };
  }, [activeTopTab, activeHubId, activeHubName]);

  const filteredFoodDishes = useMemo(() => {
    const q = debouncedSearch.toLowerCase();
    return foodDishes.filter((dish) => {
      if (foodDietaryFilter !== 'all' && dish.dietaryType !== foodDietaryFilter) {
        return false;
      }
      if (q) {
        const hay =
          `${dish.name} ${dish.description} ${dish.category} ${dish.restaurantName} ${dish.restaurantLocality}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [foodDishes, foodDietaryFilter, debouncedSearch]);

  const filteredPrintShops = useMemo(() => {
    const q = debouncedSearch.toLowerCase();
    return printShops.filter((shop) => {
      if (!q) return true;
      return `${shop.title} ${shop.locality}`.toLowerCase().includes(q);
    });
  }, [printShops, debouncedSearch]);

  const uniqueProductShopKey = useMemo(() => {
    const ids = Array.from(
      new Set(
        products
          .map((p) => p.listingId)
          .filter((id) =>
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
              id
            )
          )
      )
    );
    return ids.sort().join(',');
  }, [products]);

  // Phase 71-D: Hydrate active Print Pro / PrintSwift shop map for loaded marketplace products
  useEffect(() => {
    if (!isSupabaseConfigured() || !uniqueProductShopKey) return;
    let active = true;
    const shopIds = uniqueProductShopKey.split(',').filter(Boolean);
    const loadShopPrintProfiles = async () => {
      try {
        const { data, error } = await supabase
          .from('listing_print_profiles')
          .select(
            'listing_id, is_first_party_printswift, is_accepting_orders, busy_until'
          )
          .in('listing_id', shopIds);

        if (!active || error || !Array.isArray(data) || data.length === 0) {
          return;
        }
        const nowMs = Date.now();
        const checks = await Promise.allSettled(
          (data as Array<Record<string, unknown>>).map(async (row) => {
            const prof = normalizeClientPrintProfile(row);
            if (!prof) return null;
            const liveAccepting =
              prof.is_accepting_orders &&
              !isPrintProfileBusyPaused(prof.busy_until, nowMs);
            if (!liveAccepting) return null;
            if (prof.is_first_party_printswift) {
              return prof.listing_id;
            }
            const rpcRes = await supabase.rpc('has_active_print_entitlement', {
              p_listing_id: prof.listing_id,
            });
            const entitled =
              typeof rpcRes.data === 'boolean' ? rpcRes.data : true;
            return entitled ? prof.listing_id : null;
          })
        );
        if (!active) return;
        const nextMap: Record<string, boolean> = {};
        for (const res of checks) {
          if (res.status === 'fulfilled' && res.value) {
            nextMap[res.value] = true;
          }
        }
        setActivePrintShopMap(nextMap);
      } catch {
        // Non-blocking
      }
    };
    void loadShopPrintProfiles();
    return () => {
      active = false;
    };
  }, [uniqueProductShopKey]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setDebouncedSearch(searchInput.trim());
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  // Nested product category tree from Phase 67-B
  const productRootNodes = useMemo<NestedCategoryNode[]>(
    () => categoriesByEntity?.product || [],
    [categoriesByEntity]
  );

  const activeRootProductNode = useMemo<NestedCategoryNode | null>(() => {
    if (selectedCategory === 'All') return null;
    const target = selectedCategory.toLowerCase();
    return (
      productRootNodes.find(
        (n) =>
          n.display_name.toLowerCase() === target ||
          n.slug.toLowerCase() === target ||
          n.id === selectedCategory
      ) || null
    );
  }, [productRootNodes, selectedCategory]);

  const productSubcategoryChips = useMemo(() => {
    if (!activeRootProductNode || activeRootProductNode.children.length === 0) {
      return [];
    }
    const chips: Array<{ id: string; slug: string; label: string }> = [];
    for (const child of activeRootProductNode.children) {
      chips.push({ id: child.id, slug: child.slug, label: child.display_name });
      for (const grandChild of child.children) {
        chips.push({
          id: grandChild.id,
          slug: grandChild.slug,
          label: `${child.display_name} › ${grandChild.display_name}`,
        });
      }
    }
    return chips;
  }, [activeRootProductNode]);

  const activeCategorySubtreeSet = useMemo(() => {
    if (selectedCategory === 'All') return null;
    const targetIdentifier =
      selectedSubcategoryId !== 'all'
        ? selectedSubcategoryId
        : activeRootProductNode?.id || selectedCategory;
    const subtree = getCategorySubtreeSlugsOrIds(targetIdentifier, 'product');
    const normalized = new Set<string>(
      [...subtree.ids, ...subtree.slugs].map((val) => val.toLowerCase())
    );
    normalized.add(selectedCategory.toLowerCase());
    if (activeRootProductNode) {
      normalized.add(activeRootProductNode.display_name.toLowerCase());
      normalized.add(activeRootProductNode.slug.toLowerCase());
    }
    if (selectedSubcategoryId !== 'all') {
      const chip = productSubcategoryChips.find((c) => c.id === selectedSubcategoryId);
      if (chip) {
        normalized.add(chip.label.toLowerCase());
        normalized.add(chip.slug.toLowerCase());
      }
    }
    return normalized;
  }, [
    selectedCategory,
    selectedSubcategoryId,
    activeRootProductNode,
    productSubcategoryChips,
    getCategorySubtreeSlugsOrIds,
  ]);

  const matchesProductFilters = useCallback(
    (item: MarketplaceProduct) => {
      if (
        activeHubId &&
        !activeHubId.startsWith('fallback-') &&
        item.hubId &&
        item.hubId !== activeHubId
      ) {
        return false;
      }

      if (activeCategorySubtreeSet) {
        const catLower = item.category.toLowerCase();
        const catIdLower = (item.categoryId || '').toLowerCase();
        const tagMatch = item.customTags.some((t) =>
          activeCategorySubtreeSet.has(t.toLowerCase())
        );
        const directMatch =
          activeCategorySubtreeSet.has(catLower) ||
          (catIdLower && activeCategorySubtreeSet.has(catIdLower));
        if (!directMatch && !tagMatch) {
          return false;
        }
      }

      if (debouncedSearch) {
        const q = debouncedSearch.toLowerCase();
        const inTitle = item.title.toLowerCase().includes(q);
        const inDesc = item.description.toLowerCase().includes(q);
        const inShop = item.shopName.toLowerCase().includes(q);
        const inCat = item.category.toLowerCase().includes(q);
        const inTags = item.customTags.some((t) => t.toLowerCase().includes(q));
        if (!inTitle && !inDesc && !inShop && !inCat && !inTags) {
          return false;
        }
      }

      return true;
    },
    [activeHubId, activeCategorySubtreeSet, debouncedSearch]
  );

  // Fallback builder from existing shop catalogue items if Supabase table is not yet migrated in preview
  const deriveFallbackStoreProducts = useCallback((): MarketplaceProduct[] => {
    const derived: MarketplaceProduct[] = [];
    for (const listing of storeListings) {
      if (listing.category !== 'business' || listing.status !== 'published') continue;
      if (
        activeHubId &&
        !activeHubId.startsWith('fallback-') &&
        listing.hub_id &&
        listing.hub_id !== activeHubId
      ) {
        continue;
      }
      const catalogue = listing.businessDetails?.catalogue;
      if (Array.isArray(catalogue) && catalogue.length > 0) {
        for (const item of catalogue) {
          derived.push({
            id: `${listing.id}-${item.id}`,
            title: item.name,
            description: item.description || '',
            price: Number(item.price || 0),
            unit: 'piece',
            category: item.category || listing.subcategory || 'Local Goods',
            categoryId: listing.category_id || null,
            customTags: Array.isArray(listing.custom_tags) ? listing.custom_tags : [],
            hubId: listing.hub_id || null,
            inStock: item.availability !== 'out_of_stock',
            thumbnailUrl: item.imageUrl || listing.coverImage || '',
            listingId: listing.id,
            shopName: listing.title.replace(/^\[SAMPLE\]\s*/i, ''),
            shopLocality: listing.locality || activeHubName,
            shopPhone: listing.contactPhone || '',
            shopLat:
              typeof listing.coordinates?.lat === 'number'
                ? listing.coordinates.lat
                : null,
            shopLng:
              typeof listing.coordinates?.lng === 'number'
                ? listing.coordinates.lng
                : null,
          });
        }
      }
    }
    return derived;
  }, [storeListings, activeHubId, activeHubName]);

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
        const hideSampleData = await fetchHideSampleDataFlag();

        if (!isSupabaseConfigured()) {
          const localItems = deriveFallbackStoreProducts().filter((item) => {
            if (hideSampleData && (isSampleTitle(item.title) || isSampleTitle(item.shopName))) {
              return false;
            }
            return matchesProductFilters(item);
          });
          const pageSlice = localItems.slice(nextOffset, nextOffset + PAGE_SIZE);
          setProducts((prev) => (append ? [...prev, ...pageSlice] : pageSlice));
          setOffset(nextOffset);
          setHasMore(localItems.length > nextOffset + PAGE_SIZE);
          return;
        }

        const runQuery = async (includeExtendedColumns: boolean, includePhoneColumn: boolean) => {
          const listingSelect = includePhoneColumn
            ? 'listings(id, title, locality, phone, lat, lng, lifecycle_status)'
            : 'listings(id, title, locality, contact_phone, lat, lng, lifecycle_status)';
          const selectString = includeExtendedColumns
            ? `id, title, description, price, unit, category, category_id, custom_tags, hub_id, in_stock, thumbnail_url, listing_id, ${listingSelect}`
            : `id, title, price, unit, category, in_stock, thumbnail_url, listing_id, ${listingSelect}`;

          let query = supabase
            .from('marketplace_products')
            .select(selectString)
            .eq('is_active', true)
            .eq('in_stock', true)
            .order('created_at', { ascending: false })
            .range(nextOffset, nextOffset + PAGE_SIZE * 2 - 1);

          if (includeExtendedColumns && activeHubId && !activeHubId.startsWith('fallback-')) {
            query = query.eq('hub_id', activeHubId);
          }

          if (hideSampleData) {
            query = query.not('title', 'ilike', '[SAMPLE]%');
          }

          return query;
        };

        let { data, error } = await runQuery(true, true);

        if (error && /(description|category_id|custom_tags|hub_id)/i.test(error.message || '')) {
          const retry = await runQuery(false, true);
          data = retry.data;
          error = retry.error;
        }

        // If `listings.phone` isn't present yet on remote DB, gracefully retry with `contact_phone`
        if (error && /phone/i.test(error.message || '')) {
          const retry = await runQuery(false, false);
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
              if (hideSampleData && (isSampleTitle(item.title) || isSampleTitle(item.shopName))) {
                return false;
              }
              return matchesProductFilters(item);
            });
            const pageSlice = fallbackItems.slice(nextOffset, nextOffset + PAGE_SIZE);
            setProducts((prev) => (append ? [...prev, ...pageSlice] : pageSlice));
            setOffset(nextOffset);
            setHasMore(fallbackItems.length > nextOffset + PAGE_SIZE);
            return;
          }
          throw new Error(error.message || 'Unable to load marketplace products.');
        }

        const rawRows = (data || []) as unknown as MarketplaceProductRow[];
        const activeParentRows = rawRows.filter((row) => {
          const joined = Array.isArray(row.listings)
            ? row.listings[0] ?? null
            : row.listings ?? null;
          if (joined?.lifecycle_status && joined.lifecycle_status !== 'active') {
            return false;
          }
          return true;
        });
        const filteredRaw = hideSampleData
          ? activeParentRows.filter((row) => {
              if (isSampleTitle(row.title)) return false;
              const joined = Array.isArray(row.listings)
                ? row.listings[0] ?? null
                : row.listings ?? null;
              if (joined && isSampleTitle(joined.title)) return false;
              return true;
            })
          : activeParentRows;

        const mappedAll = filteredRaw.map((row) => normalizeRow(row, activeHubName));
        const mapped = mappedAll.filter(matchesProductFilters);

        setProducts((prev) => {
          if (!append) return mapped;
          const seen = new Set(prev.map((item) => item.id));
          return [...prev, ...mapped.filter((item) => !seen.has(item.id))];
        });
        setOffset(nextOffset);
        setHasMore(rawRows.length >= PAGE_SIZE);

        if (mappedAll.length > 0) {
          setAvailableCategories((prev) => {
            const next = new Set(prev);
            for (const item of mappedAll) {
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
      activeHubId,
      activeHubName,
      deriveFallbackStoreProducts,
      matchesProductFilters,
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
    const handleSettingsChanged = () => {
      if (active) void fetchMarketplacePage(0, false);
    };
    window.addEventListener(
      'printswift:platform-settings-updated',
      handleSettingsChanged
    );
    return () => {
      active = false;
      window.removeEventListener(
        'printswift:platform-settings-updated',
        handleSettingsChanged
      );
    };
  }, [fetchMarketplacePage]);

  const handleLoadMore = () => {
    if (isLoadingMore || isInitialLoading || !hasMore) return;
    void fetchMarketplacePage(offset + PAGE_SIZE, true);
  };

  const categoryTabs = useMemo(() => {
    if (productRootNodes.length > 0) {
      const rootNames = productRootNodes.map((n) => n.display_name);
      return ['All', ...Array.from(new Set(rootNames))];
    }
    const dynamicMarketCategories = appConfigCategories
      .filter(
        (c) => c.module === 'marketplace' && c.is_active && c.display_name.trim()
      )
      .map((c) => c.display_name.trim());
    const baseList =
      dynamicMarketCategories.length > 0
        ? ['All', ...dynamicMarketCategories]
        : ['All', ...availableCategories];
    const merged = new Set<string>(baseList);
    for (const item of products) {
      if (item.category) merged.add(item.category);
    }
    return Array.from(merged);
  }, [productRootNodes, appConfigCategories, availableCategories, products]);

  return (
    <ModulePausedGuard module="marketplace">
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
              <span>{activeHubName} Shop &amp; Food Marketplace</span>
            </h1>
            <p className="text-xs sm:text-sm text-[var(--ps-text-muted)]">
              Order local shop products, fresh dishes from {activeHubName} restaurants, or upload documents to nearby print counters.
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
              placeholder={
                activeTopTab === 'food'
                  ? 'Search dishes, momos, thali, cafés...'
                  : activeTopTab === 'print'
                    ? 'Search print shops or locality...'
                    : 'Search products, tags, or shops...'
              }
              aria-label="Search marketplace"
              data-testid="marketplace-search-input"
              className="w-full h-9 pl-9 pr-8 rounded-xl bg-[var(--ps-surface)] border border-[var(--ps-border)] text-sm text-[var(--ps-text)] placeholder:text-[var(--ps-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--ps-ring)] focus:border-[var(--ps-accent)] transition-colors"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput('')}
                aria-label="Clear search"
                className="absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded-md inline-flex items-center justify-center text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]"
              >
                <X className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            )}
          </div>
        </div>

        {/* Pass R2: 3 Top Marketplace Tabs */}
        <div
          role="tablist"
          aria-label="Marketplace sections"
          data-testid="marketplace-top-tabs"
          className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-1"
        >
          {(
            [
              { id: 'shops', label: 'Local Shop Products', icon: Store },
              {
                id: 'food',
                label: 'Food & Popular Dishes',
                icon: UtensilsCrossed,
              },
              {
                id: 'print',
                label: 'Print & Digital Services',
                icon: Printer,
              },
            ] as const
          ).map((tab) => {
            const Icon = tab.icon;
            const active = activeTopTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={active}
                data-testid={`marketplace-tab-${tab.id}`}
                onClick={() => setActiveTopTab(tab.id)}
                className={`h-9 px-3.5 rounded-xl text-xs sm:text-sm font-bold inline-flex items-center gap-1.5 whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                  active
                    ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-2xs'
                    : 'bg-[var(--ps-surface)] text-[var(--ps-text-muted)] border border-[var(--ps-border)] hover:text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Dense h-8 Horizontal Category Filter Controls (Shops tab) */}
        {activeTopTab === 'shops' && (
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
                onClick={() => {
                  setSelectedCategory(category);
                  setSelectedSubcategoryId('all');
                }}
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
        )}

        {/* Dietary Filter Strip (Food tab) */}
        {activeTopTab === 'food' && (
          <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar py-0.5">
            {(
              [
                { id: 'all', label: 'All Dishes' },
                { id: 'veg', label: 'Pure Veg' },
                { id: 'non_veg', label: 'Non-Veg' },
                { id: 'egg', label: 'Egg' },
              ] as const
            ).map((opt) => {
              const active = foodDietaryFilter === opt.id;
              return (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setFoodDietaryFilter(opt.id)}
                  className={`h-8 px-3 rounded-full text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    active
                      ? 'bg-emerald-600 text-white shadow-2xs'
                      : 'bg-[var(--ps-surface)] text-[var(--ps-text-muted)] border border-[var(--ps-border)] hover:text-[var(--ps-text)]'
                  }`}
                >
                  {opt.label}
                </button>
              );
            })}
          </div>
        )}

        {/* Secondary Nested Subcategory Chip Strip (depth 1 & 2) */}
        {activeTopTab === 'shops' && productSubcategoryChips.length > 0 && (
          <div
            data-testid="marketplace-subcategory-strip"
            className="flex items-center gap-1.5 overflow-x-auto no-scrollbar pt-1"
          >
            <button
              type="button"
              onClick={() => setSelectedSubcategoryId('all')}
              className={`h-7 px-2.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                selectedSubcategoryId === 'all'
                  ? 'bg-[var(--ps-accent)]/15 text-[var(--ps-accent)] border border-[var(--ps-accent)]/40'
                  : 'bg-[var(--ps-surface)] text-[var(--ps-text-muted)] border border-[var(--ps-border)] hover:text-[var(--ps-text)]'
              }`}
            >
              All {activeRootProductNode?.display_name || selectedCategory}
            </button>
            {productSubcategoryChips.map((sub) => {
              const isSubActive = selectedSubcategoryId === sub.id;
              return (
                <button
                  key={sub.id}
                  type="button"
                  onClick={() =>
                    setSelectedSubcategoryId(isSubActive ? 'all' : sub.id)
                  }
                  className={`h-7 px-2.5 rounded-lg text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                    isSubActive
                      ? 'bg-[var(--ps-accent)]/15 text-[var(--ps-accent)] border border-[var(--ps-accent)]/40'
                      : 'bg-[var(--ps-surface)] text-[var(--ps-text-muted)] border border-[var(--ps-border)] hover:text-[var(--ps-text)]'
                  }`}
                >
                  {sub.label}
                </button>
              );
            })}
          </div>
        )}
      </section>

      <PromoBannerSlot placement="marketplace_top" compact />

      {/* Food & Popular Dishes Tab */}
      {activeTopTab === 'food' && (
        <section data-testid="marketplace-food-tab-content" className="space-y-4">
          {isLoadingFood ? (
            <div className="py-14 flex flex-col items-center justify-center gap-2 text-sm text-[var(--ps-text-muted)]">
              <Loader2 className="w-6 h-6 animate-spin text-[var(--ps-accent)]" />
              <span>Loading fresh menus in {activeHubName}...</span>
            </div>
          ) : filteredFoodDishes.length === 0 ? (
            <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-10 text-center space-y-2">
              <UtensilsCrossed className="w-6 h-6 mx-auto text-[var(--ps-text-muted)]" />
              <h2 className="text-base font-bold text-[var(--ps-text)]">
                No matching dishes found in {activeHubName}
              </h2>
              <p className="text-xs text-[var(--ps-text-muted)]">
                Try switching the dietary filter or searching another dish or café.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
              {filteredFoodDishes.map((dish) => {
                const dietDotClass =
                  dish.dietaryType === 'veg'
                    ? 'border-emerald-600 text-emerald-600'
                    : dish.dietaryType === 'egg'
                      ? 'border-amber-600 text-amber-600'
                      : 'border-rose-600 text-rose-600';
                const dietFillClass =
                  dish.dietaryType === 'veg'
                    ? 'bg-emerald-600'
                    : dish.dietaryType === 'egg'
                      ? 'bg-amber-600'
                      : 'bg-rose-600';
                return (
                  <article
                    key={dish.id}
                    data-testid={`marketplace-dish-card-${dish.id}`}
                    className="group rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] overflow-hidden flex flex-col justify-between hover:border-[var(--ps-accent)]/60 transition-colors"
                  >
                    <div>
                      <ProductThumbnail
                        src={dish.imageUrl}
                        alt={dish.name}
                        category={dish.category}
                      />
                      <div className="p-3.5 space-y-2">
                        <div className="flex items-center justify-between gap-2 text-[11px]">
                          <span className="inline-flex items-center gap-1.5 font-semibold text-[var(--ps-text-muted)]">
                            <span
                              className={`w-3.5 h-3.5 rounded-xs border flex items-center justify-center ${dietDotClass}`}
                              aria-label={dish.dietaryType}
                            >
                              <span
                                className={`w-1.5 h-1.5 rounded-full ${dietFillClass}`}
                              />
                            </span>
                            <span className="truncate">{dish.category}</span>
                          </span>
                          <span className="font-bold text-sm text-[var(--ps-text)] tabular-nums">
                            {formatInrPrice(dish.priceInr)}
                          </span>
                        </div>
                        <h2 className="text-sm font-bold text-[var(--ps-text)] line-clamp-2">
                          {dish.name}
                        </h2>
                        {dish.description && (
                          <p className="text-xs text-[var(--ps-text-muted)] line-clamp-2">
                            {dish.description}
                          </p>
                        )}
                        <div className="pt-1.5 border-t border-[var(--ps-border)]/70 flex items-center gap-1 text-[11px] text-[var(--ps-text-muted)] truncate">
                          <UtensilsCrossed className="w-3 h-3 text-[var(--ps-accent)] shrink-0" />
                          <span className="font-semibold text-[var(--ps-text)] truncate">
                            {dish.restaurantName}
                          </span>
                          <span>·</span>
                          <span className="truncate">{dish.restaurantLocality}</span>
                        </div>
                      </div>
                    </div>
                    <div className="px-3.5 pb-3.5">
                      <Link
                        href={`/listing/${encodeURIComponent(dish.listingId)}`}
                        className="h-8 w-full rounded-lg bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-bold inline-flex items-center justify-center gap-1.5 hover:opacity-95 transition-opacity"
                      >
                        <span>Order from Kitchen</span>
                        <ArrowRight className="w-3.5 h-3.5" aria-hidden="true" />
                      </Link>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* Print & Digital Services Tab */}
      {activeTopTab === 'print' && (
        <section data-testid="marketplace-print-tab-content" className="space-y-4">
          {isLoadingPrintShops ? (
            <div className="py-14 flex flex-col items-center justify-center gap-2 text-sm text-[var(--ps-text-muted)]">
              <Loader2 className="w-6 h-6 animate-spin text-[var(--ps-accent)]" />
              <span>Loading active print counters in {activeHubName}...</span>
            </div>
          ) : filteredPrintShops.length === 0 ? (
            <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-10 text-center space-y-2">
              <Printer className="w-6 h-6 mx-auto text-[var(--ps-text-muted)]" />
              <h2 className="text-base font-bold text-[var(--ps-text)]">
                No active print counters found in {activeHubName}
              </h2>
              <p className="text-xs text-[var(--ps-text-muted)]">
                Check back shortly or browse all listings on the map.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredPrintShops.map((shop) => (
                <article
                  key={shop.listingId}
                  data-testid={`marketplace-print-card-${shop.listingId}`}
                  className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 flex flex-col justify-between gap-3 hover:border-[var(--ps-accent)]/60 transition-colors"
                >
                  <div className="space-y-2">
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          shop.isFirstParty
                            ? 'bg-indigo-500/15 text-indigo-600 dark:text-indigo-300'
                            : 'bg-[var(--ps-accent)]/12 text-[var(--ps-accent)]'
                        }`}
                      >
                        <Printer className="w-3 h-3" aria-hidden="true" />
                        <span>
                          {shop.isFirstParty
                            ? 'PrintSwift 1st-Party'
                            : 'Verified Print Pro'}
                        </span>
                      </span>
                      <span
                        className={`text-[11px] font-semibold ${
                          shop.isBusy
                            ? 'text-amber-600 dark:text-amber-400'
                            : 'text-emerald-600 dark:text-emerald-400'
                        }`}
                      >
                        {shop.isBusy ? 'Busy Pause' : 'Accepting PDFs'}
                      </span>
                    </div>
                    <h2 className="text-sm font-bold text-[var(--ps-text)]">
                      {shop.title}
                    </h2>
                    <p className="text-xs text-[var(--ps-text-muted)] flex items-center gap-1">
                      <MapPin className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                      <span>{shop.locality}</span>
                    </p>
                    <div className="flex flex-wrap items-center gap-2 pt-1 text-xs">
                      {shop.bwRateInr !== null && (
                        <span className="px-2 py-0.5 rounded-md bg-[var(--ps-surface-alt)] border border-[var(--ps-border)] font-semibold tabular-nums">
                          B&amp;W ₹{shop.bwRateInr}/pg
                        </span>
                      )}
                      {shop.colorRateInr !== null && (
                        <span className="px-2 py-0.5 rounded-md bg-[var(--ps-surface-alt)] border border-[var(--ps-border)] font-semibold tabular-nums">
                          Color ₹{shop.colorRateInr}/pg
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <Link
                      href={`/listing/${encodeURIComponent(shop.listingId)}`}
                      className="h-8 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] text-xs font-semibold text-[var(--ps-text)] inline-flex items-center justify-center hover:bg-[var(--ps-surface-alt)]"
                    >
                      Storefront
                    </Link>
                    <Link
                      href={`/listing/${encodeURIComponent(shop.listingId)}/print`}
                      className="h-8 rounded-lg bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] text-xs font-bold inline-flex items-center justify-center gap-1 hover:opacity-95"
                    >
                      <span>Upload &amp; Print</span>
                      <ArrowRight className="w-3 h-3" aria-hidden="true" />
                    </Link>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {/* Local Shop Products Tab */}
      {activeTopTab === 'shops' && (
      <>
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
              No matching products found in {activeHubName}
            </h2>
            <p className="text-xs sm:text-sm text-[var(--ps-text-muted)] max-w-md mx-auto">
              Try adjusting your search keywords or switching to another product category.
            </p>
          </div>
          {(selectedCategory !== 'All' || selectedSubcategoryId !== 'all' || searchInput) && (
            <button
              type="button"
              onClick={() => {
                setSelectedCategory('All');
                setSelectedSubcategoryId('all');
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
              {products.length === 1 ? 'product' : 'products'} in {activeHubName}
              {selectedCategory !== 'All' ? ` • ${selectedCategory}` : ''}
            </span>
          </div>

          {/* Uniform 4-Column Product Grid */}
          <div
            data-testid="marketplace-product-grid"
            className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4"
          >
            {products.map((product) => {
              const whatsappHref = buildWhatsAppEnquiryHref(
                product,
                office.whatsapp_enquiry_template
              );
              const pickNDropHref = buildPickNDropHref(product, activeHubSlug);
              const productSaved = isSaved('product', product.id);
              const shopFollowed = isFollowing('shop_listing', product.listingId);

              return (
                <article
                  key={product.id}
                  data-testid={`marketplace-product-card-${product.id}`}
                  className="group relative rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] overflow-hidden flex flex-col justify-between transition-all duration-150 hover:-translate-y-0.5 hover:border-[var(--ps-accent)]/60 hover:shadow-sm"
                >
                  <div>
                    <div className="relative">
                      <ProductThumbnail
                        src={product.thumbnailUrl}
                        alt={product.title}
                        category={product.category}
                      />
                      <button
                        type="button"
                        onClick={() => void toggleSave('product', product.id)}
                        aria-label={
                          productSaved ? 'Remove product from saved' : 'Save product'
                        }
                        title={productSaved ? 'Saved' : 'Save product'}
                        data-testid={`marketplace-save-${product.id}`}
                        className={`absolute top-2 right-2 w-8 h-8 rounded-lg border backdrop-blur-md inline-flex items-center justify-center transition-colors shadow-xs ${
                          productSaved
                            ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] border-[var(--ps-accent)]'
                            : 'bg-white/90 dark:bg-slate-900/90 text-slate-700 dark:text-slate-200 border-slate-200/80 dark:border-slate-700 hover:border-[var(--ps-accent)] hover:text-[var(--ps-accent)]'
                        }`}
                      >
                        <Bookmark
                          className={`w-3.5 h-3.5 ${productSaved ? 'fill-current' : ''}`}
                          aria-hidden="true"
                        />
                      </button>
                    </div>

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
                      {(() => {
                        const clean = splitSamplePrefix(product.title);
                        return (
                          <div className="flex items-start justify-between gap-1.5 min-h-[2.5rem]">
                            <h2 className="text-sm font-semibold tracking-tight text-[var(--ps-text)] leading-snug line-clamp-2 min-w-0">
                              {clean.title}
                            </h2>
                            {clean.isSample && (
                              <span className="shrink-0 mt-0.5 rounded border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-[var(--ps-text-muted)]">
                                Sample
                              </span>
                            )}
                          </div>
                        );
                      })()}

                      {/* Price & Unit (Tabular Numerals — leading-snug pb-0.5 prevents descender clipping) */}
                      <div className="flex items-baseline gap-1 tabular-nums leading-snug pb-0.5">
                        <span className="text-base font-bold text-[var(--ps-text)] leading-snug">
                          {formatInrPrice(product.price)}
                        </span>
                        <span className="text-xs text-[var(--ps-text-muted)] leading-snug">
                          / {product.unit}
                        </span>
                      </div>

                      {/* Shop Attribution + Compact Follow Shop Toggle */}
                      <div className="pt-1.5 border-t border-[var(--ps-border)]/70 flex items-center justify-between gap-1.5 text-[11px] text-[var(--ps-text-muted)] min-w-0">
                        <div className="flex items-center gap-1 min-w-0">
                          <Store
                            className="w-3 h-3 text-[var(--ps-accent)] shrink-0"
                            aria-hidden="true"
                          />
                          <span className="font-medium text-[var(--ps-text)] truncate">
                            {product.shopName}
                          </span>
                          <span aria-hidden="true" className="shrink-0">
                            ·
                          </span>
                          <span className="inline-flex items-center gap-0.5 truncate">
                            <MapPin className="w-3 h-3 shrink-0" aria-hidden="true" />
                            <span className="truncate">{product.shopLocality}</span>
                          </span>
                        </div>
                        <button
                          type="button"
                          onClick={() =>
                            void toggleFollow('shop_listing', product.listingId)
                          }
                          aria-label={
                            shopFollowed
                              ? `Unfollow ${product.shopName}`
                              : `Follow ${product.shopName}`
                          }
                          title={shopFollowed ? 'Following shop' : 'Follow shop'}
                          data-testid={`marketplace-follow-shop-${product.id}`}
                          className={`h-6 px-1.5 rounded-md border text-[10px] font-semibold inline-flex items-center gap-1 shrink-0 transition-colors ${
                            shopFollowed
                              ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)]/12 text-[var(--ps-accent)]'
                              : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] hover:border-[var(--ps-accent)]/60'
                          }`}
                        >
                          {shopFollowed ? (
                            <>
                              <UserCheck className="w-3 h-3 shrink-0" aria-hidden="true" />
                              <span>Following</span>
                            </>
                          ) : (
                            <>
                              <UserPlus className="w-3 h-3 shrink-0" aria-hidden="true" />
                              <span>Follow</span>
                            </>
                          )}
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Quick Actions: View Shop + Enquire + Deliver via Pick N Drop */}
                  <div className="px-3.5 pb-3.5 pt-1 space-y-1.5">
                    <div className="grid grid-cols-2 gap-1.5">
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

                    <Link
                      href={pickNDropHref}
                      data-testid={`marketplace-pnd-${product.id}`}
                      className="h-8 w-full px-2.5 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface-alt)]/60 text-[11px] font-semibold text-[var(--ps-text)] hover:border-[var(--ps-accent)] hover:text-[var(--ps-accent)] inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors"
                    >
                      <Truck className="w-3.5 h-3.5 shrink-0 text-[var(--ps-accent)]" aria-hidden="true" />
                      <span>Deliver via Pick N Drop</span>
                    </Link>

                    {activePrintShopMap[product.listingId] && (
                      <Link
                        href={`/listing/${encodeURIComponent(product.listingId)}/print`}
                        data-testid={`marketplace-print-counter-${product.id}`}
                        className="h-8 w-full px-2.5 rounded-lg border border-theme-primary/35 bg-theme-primary/10 text-[11px] font-semibold text-theme-primary hover:bg-theme-primary hover:text-[hsl(var(--color-primary-foreground))] inline-flex items-center justify-center gap-1.5 whitespace-nowrap transition-colors"
                      >
                        <Printer className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
                        <span>Print Counter</span>
                        <ArrowRight className="w-3 h-3 shrink-0" aria-hidden="true" />
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
      </>
      )}
    </div>
    </ModulePausedGuard>
  );
}
