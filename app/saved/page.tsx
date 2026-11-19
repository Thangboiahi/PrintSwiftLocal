'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Compass,
  ExternalLink,
  Heart,
  Loader2,
  Mail,
  MapPin,
  Megaphone,
  MessageCircle,
  Package,
  Phone,
  RefreshCw,
  ShoppingBag,
  Sparkles,
  Store,
  Trash2,
  Truck,
  User,
  UserMinus,
  X,
} from 'lucide-react';
import {
  Breadcrumbs,
  triggerUnmountOverlaysToMap,
} from '@/components/navigation/Breadcrumbs';
import {
  BulletinContentRenderer,
  YouTubeEmbedPlayer,
  sanitizeBulletinHref,
  type TiptapDoc,
} from '@/components/bulletin/BulletinContentRenderer';
import { OrderTrackerModal } from '@/components/pickndrop/OrderTrackerModal';
import { emitBookmarkChange } from '@/lib/events';
import { useSavedInterests } from '@/lib/hooks/useSavedInterests';
import {
  DELIVERY_STATUS_META,
  SERVICE_MODE_META,
  sanitizePhoneForWhatsApp,
  type DeliveryOrderRecord,
  type DeliveryServiceMode,
} from '@/lib/pick-n-drop/types';
import { CATEGORY_LABELS } from '@/lib/rules';
import { useAppStore, useAuth } from '@/lib/store';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { resolveRemoteMediaUrl } from '@/lib/supabase/storage';
import type { ListingCategory } from '@/lib/types';

type SavedHubTab =
  | 'places'
  | 'products'
  | 'bulletins'
  | 'following'
  | 'trips'
  | 'interests';

interface HydratedPlaceCard {
  id: string;
  title: string;
  category: string;
  locality: string;
  rating: number | null;
  shortDescription: string;
  coverImage: string;
  ownerId: string;
  ownerName: string;
}

interface HydratedProductCard {
  id: string;
  listingId: string;
  title: string;
  description: string;
  priceInr: number;
  unit: string;
  imageUrl: string;
  inStock: boolean;
  shopName: string;
  shopLocality: string;
  shopPhone: string;
}

interface HydratedBulletinCard {
  id: string;
  authorId: string;
  linkedListingId: string | null;
  category: string;
  title: string;
  excerpt: string;
  contentJson: TiptapDoc | null;
  imageUrls: string[];
  youtubeVideoId: string | null;
  contactChannels: {
    phone?: string;
    whatsapp?: string;
    email?: string;
    website?: string;
  };
  expiresAt: string | null;
  createdAt: string;
  authorName: string;
}

interface HydratedFollowCard {
  targetType: 'shop_listing' | 'author';
  targetId: string;
  name: string;
  subtitle: string;
  avatarOrCover: string;
  href: string;
  actionLabel: string;
}

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TRACKABLE_LOCALITIES = [
  { value: 'New Lamka', href: '/explore?q=New%20Lamka' },
  { value: 'Tuibong', href: '/explore?q=Tuibong' },
  { value: 'Rengkai', href: '/explore?q=Rengkai' },
  { value: 'Zenhang Lamka', href: '/explore?q=Zenhang%20Lamka' },
  { value: 'Central Lamka', href: '/explore?q=Central%20Lamka' },
] as const;

const TRACKABLE_CATEGORIES = [
  { value: 'Jobs', kind: 'bulletin_job' as const, href: '/bulletin?category=job' },
  { value: 'Real Estate', kind: 'listing_real_estate' as const, href: '/explore?q=Real%20Estate' },
  { value: 'Services', kind: 'listing_service' as const, href: '/explore?q=Service' },
  { value: 'Retail', kind: 'listing_retail' as const, href: '/marketplace' },
  { value: 'Events', kind: 'bulletin_event' as const, href: '/bulletin?category=event' },
] as const;

function formatCategoryLabel(raw: string): string {
  const key = raw as ListingCategory;
  if (CATEGORY_LABELS[key]) return CATEGORY_LABELS[key];
  return raw
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (m) => m.toUpperCase());
}

function formatExpiryShort(iso: string | null): string {
  if (!iso) return 'Active';
  const diffDays = Math.ceil((new Date(iso).getTime() - Date.now()) / 86400000);
  if (diffDays <= 0) return 'Expired';
  if (diffDays === 1) return 'Ends tomorrow';
  return `${diffDays}d left`;
}

export default function SavedHubPage() {
  const router = useRouter();
  const { listings, savedListingIds, toggleSavedListing } = useAppStore();
  const { user: authUser, session: activeSession } = useAuth();
  const activeUserId = authUser?.id || activeSession?.user?.id || '';

  const {
    savedItems,
    follows,
    interests,
    loading: hookLoading,
    isGuest,
    toggleSave,
    toggleFollow,
    hasInterest,
    toggleInterest,
    refresh: refreshSavedHook,
  } = useSavedInterests();

  const [activeTab, setActiveTab] = useState<SavedHubTab>('places');
  const [isHydrating, setIsHydrating] = useState(false);

  // Hydrated datasets
  const [remotePlacesMap, setRemotePlacesMap] = useState<
    Record<string, HydratedPlaceCard>
  >({});
  const [products, setProducts] = useState<HydratedProductCard[]>([]);
  const [bulletins, setBulletins] = useState<HydratedBulletinCard[]>([]);
  const [followCards, setFollowCards] = useState<HydratedFollowCard[]>([]);
  const [orders, setOrders] = useState<DeliveryOrderRecord[]>([]);
  const [interestCounts, setInterestCounts] = useState<Record<string, number>>(
    {}
  );

  // Interactive modals
  const [selectedBulletin, setSelectedBulletin] =
    useState<HydratedBulletinCard | null>(null);
  const [trackerOrderId, setTrackerOrderId] = useState<string | null>(null);
  const [isTrackerOpen, setIsTrackerOpen] = useState(false);

  // Combine unified saved listing IDs with legacy store savedListingIds
  const savedListingIdList = useMemo(() => {
    const ordered: string[] = [];
    const seen = new Set<string>();
    for (const item of savedItems) {
      if (item.item_type === 'listing' && !seen.has(item.item_id)) {
        seen.add(item.item_id);
        ordered.push(item.item_id);
      }
    }
    for (const id of savedListingIds) {
      if (id && !seen.has(id)) {
        seen.add(id);
        ordered.push(id);
      }
    }
    return ordered;
  }, [savedItems, savedListingIds]);

  const savedProductIds = useMemo(
    () =>
      savedItems
        .filter((item) => item.item_type === 'product')
        .map((item) => item.item_id),
    [savedItems]
  );

  const savedBulletinIds = useMemo(
    () =>
      savedItems
        .filter((item) => item.item_type === 'bulletin')
        .map((item) => item.item_id),
    [savedItems]
  );

  // Stable serialized keys for hydration effect
  const listingIdsKey = savedListingIdList.join(',');
  const productIdsKey = savedProductIds.join(',');
  const bulletinIdsKey = savedBulletinIds.join(',');
  const followsKey = follows
    .map((f) => `${f.target_type}:${f.target_id}`)
    .join(',');

  const hydrateHubData = useCallback(async () => {
    setIsHydrating(true);
    try {
      const storeById = new Map(listings.map((l) => [l.id, l]));

      // 1. Missing UUID places from Supabase
      const missingPlaceUuids = savedListingIdList.filter(
        (id) => !storeById.has(id) && UUID_REGEX.test(id)
      );

      // 2. Saved Products
      const productUuids = savedProductIds.filter((id) => UUID_REGEX.test(id));

      // 3. Saved Bulletins
      const bulletinUuids = savedBulletinIds.filter((id) => UUID_REGEX.test(id));

      // 4. Followed shop_listing & author UUIDs
      const followedShopIds = follows
        .filter((f) => f.target_type === 'shop_listing')
        .map((f) => f.target_id);
      const followedAuthorIds = follows
        .filter((f) => f.target_type === 'author')
        .map((f) => f.target_id);

      const missingShopUuids = followedShopIds.filter(
        (id) => !storeById.has(id) && UUID_REGEX.test(id)
      );
      const authorUuids = followedAuthorIds.filter((id) => UUID_REGEX.test(id));

      const canQueryDb = isSupabaseConfigured();

      const [
        placesRes,
        productsRes,
        bulletinsRes,
        followedShopsRes,
        followedAuthorsRes,
        ordersRes,
      ] = await Promise.all([
        canQueryDb && missingPlaceUuids.length > 0
          ? supabase
              .from('listings')
              .select(
                'id, title, category, locality, rating, short_description, description, cover_image, owner_id, owner_name'
              )
              .in('id', missingPlaceUuids)
          : Promise.resolve({ data: null }),
        canQueryDb && productUuids.length > 0
          ? supabase
              .from('marketplace_products')
              .select(
                'id, listing_id, title, description, price_inr, unit, image_url, in_stock, listings(id, title, locality, phone, contact_phone)'
              )
              .in('id', productUuids)
          : Promise.resolve({ data: null }),
        canQueryDb && bulletinUuids.length > 0
          ? supabase
              .from('bulletins')
              .select(
                'id, author_id, linked_listing_id, category, title, excerpt, content_json, image_urls, youtube_video_id, contact_channels, expires_at, created_at, profiles:author_id(id, full_name, name, role)'
              )
              .in('id', bulletinUuids)
          : Promise.resolve({ data: null }),
        canQueryDb && missingShopUuids.length > 0
          ? supabase
              .from('listings')
              .select('id, title, category, locality, cover_image')
              .in('id', missingShopUuids)
          : Promise.resolve({ data: null }),
        canQueryDb && authorUuids.length > 0
          ? supabase
              .from('profiles')
              .select('id, full_name, name, role, avatar_url')
              .in('id', authorUuids)
          : Promise.resolve({ data: null }),
        canQueryDb && activeUserId
          ? supabase
              .from('delivery_orders')
              .select('*')
              .eq('customer_id', activeUserId)
              .order('created_at', { ascending: false })
              .limit(20)
          : Promise.resolve({ data: null }),
      ]);

      // Map remote places
      const nextPlacesMap: Record<string, HydratedPlaceCard> = {};
      if (Array.isArray(placesRes.data)) {
        for (const row of placesRes.data as Array<Record<string, unknown>>) {
          const id = String(row.id || '');
          if (!id) continue;
          nextPlacesMap[id] = {
            id,
            title: String(row.title || 'Saved Place'),
            category: String(row.category || 'business'),
            locality: String(row.locality || 'Churachandpur'),
            rating:
              typeof row.rating === 'number' ? Number(row.rating) : null,
            shortDescription: String(
              row.short_description || row.description || ''
            ),
            coverImage: resolveRemoteMediaUrl(
              typeof row.cover_image === 'string' ? row.cover_image : ''
            ),
            ownerId: String(row.owner_id || ''),
            ownerName: String(row.owner_name || 'Local Owner'),
          };
        }
      }
      setRemotePlacesMap(nextPlacesMap);

      // Map products (Supabase + fallback to store shop catalogues)
      const hydratedProducts: HydratedProductCard[] = [];
      const seenProductIds = new Set<string>();
      if (Array.isArray(productsRes.data)) {
        for (const row of productsRes.data as Array<Record<string, unknown>>) {
          const id = String(row.id || '');
          if (!id || seenProductIds.has(id)) continue;
          seenProductIds.add(id);
          const shopRaw = Array.isArray(row.listings)
            ? (row.listings[0] as Record<string, unknown> | undefined)
            : (row.listings as Record<string, unknown> | undefined);
          hydratedProducts.push({
            id,
            listingId: String(row.listing_id || shopRaw?.id || ''),
            title: String(row.title || 'Saved Product'),
            description: String(row.description || ''),
            priceInr: Number(row.price_inr || 0),
            unit: String(row.unit || 'item'),
            imageUrl: resolveRemoteMediaUrl(
              typeof row.image_url === 'string' ? row.image_url : ''
            ),
            inStock: row.in_stock !== false,
            shopName: String(shopRaw?.title || 'Local Shop'),
            shopLocality: String(shopRaw?.locality || 'Churachandpur'),
            shopPhone: String(
              shopRaw?.contact_phone || shopRaw?.phone || ''
            ),
          });
        }
      }
      // Fallback for non-UUID local catalogue items
      for (const prodId of savedProductIds) {
        if (seenProductIds.has(prodId)) continue;
        for (const l of listings) {
          const match = l.businessDetails?.catalogue?.find(
            (m) => m.id === prodId
          );
          if (match) {
            seenProductIds.add(prodId);
            hydratedProducts.push({
              id: match.id,
              listingId: l.id,
              title: match.name,
              description: match.description || '',
              priceInr: Number(match.price || 0),
              unit: 'item',
              imageUrl: resolveRemoteMediaUrl(match.imageUrl || l.coverImage || ''),
              inStock: match.availability !== 'out_of_stock',
              shopName: l.title,
              shopLocality: l.locality,
              shopPhone: l.contactPhone || '',
            });
            break;
          }
        }
      }
      setProducts(hydratedProducts);

      // Map bulletins
      const hydratedBulletins: HydratedBulletinCard[] = [];
      if (Array.isArray(bulletinsRes.data)) {
        for (const row of bulletinsRes.data as Array<Record<string, unknown>>) {
          const id = String(row.id || '');
          if (!id) continue;
          const profileRaw = Array.isArray(row.profiles)
            ? (row.profiles[0] as Record<string, unknown> | undefined)
            : (row.profiles as Record<string, unknown> | undefined);
          const rawImages = Array.isArray(row.image_urls)
            ? (row.image_urls as unknown[])
                .filter((u): u is string => typeof u === 'string' && u.trim().length > 0)
                .map((u) => resolveRemoteMediaUrl(u))
            : [];
          const channels =
            row.contact_channels && typeof row.contact_channels === 'object'
              ? (row.contact_channels as HydratedBulletinCard['contactChannels'])
              : {};
          hydratedBulletins.push({
            id,
            authorId: String(row.author_id || ''),
            linkedListingId: row.linked_listing_id
              ? String(row.linked_listing_id)
              : null,
            category: String(row.category || 'announcement'),
            title: String(row.title || 'Community Bulletin'),
            excerpt: String(row.excerpt || ''),
            contentJson: (row.content_json as TiptapDoc | null) || null,
            imageUrls: rawImages,
            youtubeVideoId: row.youtube_video_id
              ? String(row.youtube_video_id)
              : null,
            contactChannels: channels,
            expiresAt: row.expires_at ? String(row.expires_at) : null,
            createdAt: String(row.created_at || new Date().toISOString()),
            authorName: String(
              profileRaw?.full_name || profileRaw?.name || 'Verified Publisher'
            ),
          });
        }
      }
      setBulletins(hydratedBulletins);

      // Map Following cards
      const remoteShopsById = new Map<string, Record<string, unknown>>();
      if (Array.isArray(followedShopsRes.data)) {
        for (const row of followedShopsRes.data as Array<Record<string, unknown>>) {
          remoteShopsById.set(String(row.id || ''), row);
        }
      }
      const remoteAuthorsById = new Map<string, Record<string, unknown>>();
      if (Array.isArray(followedAuthorsRes.data)) {
        for (const row of followedAuthorsRes.data as Array<Record<string, unknown>>) {
          remoteAuthorsById.set(String(row.id || ''), row);
        }
      }

      const nextFollows: HydratedFollowCard[] = [];
      for (const f of follows) {
        if (f.target_type === 'shop_listing') {
          const fromStore = storeById.get(f.target_id);
          const fromRemote = remoteShopsById.get(f.target_id);
          if (fromStore) {
            nextFollows.push({
              targetType: 'shop_listing',
              targetId: f.target_id,
              name: fromStore.title,
              subtitle: `${formatCategoryLabel(fromStore.category)} · ${fromStore.locality}`,
              avatarOrCover: resolveRemoteMediaUrl(fromStore.coverImage || ''),
              href: `/listing/${encodeURIComponent(fromStore.id)}`,
              actionLabel: 'Open Shop',
            });
          } else if (fromRemote) {
            nextFollows.push({
              targetType: 'shop_listing',
              targetId: f.target_id,
              name: String(fromRemote.title || 'Followed Shop'),
              subtitle: `${formatCategoryLabel(String(fromRemote.category || 'business'))} · ${String(fromRemote.locality || 'Churachandpur')}`,
              avatarOrCover: resolveRemoteMediaUrl(
                typeof fromRemote.cover_image === 'string'
                  ? fromRemote.cover_image
                  : ''
              ),
              href: `/listing/${encodeURIComponent(f.target_id)}`,
              actionLabel: 'Open Shop',
            });
          } else {
            nextFollows.push({
              targetType: 'shop_listing',
              targetId: f.target_id,
              name: 'Followed Business',
              subtitle: 'Churachandpur Shop',
              avatarOrCover: '',
              href: `/listing/${encodeURIComponent(f.target_id)}`,
              actionLabel: 'Open Shop',
            });
          }
        } else {
          const authorRow = remoteAuthorsById.get(f.target_id);
          const authorName = String(
            authorRow?.full_name || authorRow?.name || 'Community Publisher'
          );
          const authorRole = String(authorRow?.role || 'Publisher');
          nextFollows.push({
            targetType: 'author',
            targetId: f.target_id,
            name: authorName,
            subtitle: `Publisher · ${formatCategoryLabel(authorRole)}`,
            avatarOrCover: resolveRemoteMediaUrl(
              typeof authorRow?.avatar_url === 'string'
                ? authorRow.avatar_url
                : ''
            ),
            href: `/user/${encodeURIComponent(f.target_id)}`,
            actionLabel: 'View Profile',
          });
        }
      }
      setFollowCards(nextFollows);

      // Map Orders
      if (Array.isArray(ordersRes.data)) {
        setOrders(ordersRes.data as DeliveryOrderRecord[]);
      } else {
        setOrders([]);
      }
    } finally {
      setIsHydrating(false);
    }
  }, [
    listings,
    savedListingIdList,
    savedProductIds,
    savedBulletinIds,
    follows,
    activeUserId,
  ]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (active) void hydrateHubData();
    });
    return () => {
      active = false;
    };
  }, [
    listingIdsKey,
    productIdsKey,
    bulletinIdsKey,
    followsKey,
    activeUserId,
    hydrateHubData,
  ]);

  // Compute live matching counts for Interests (localities & categories)
  useEffect(() => {
    let active = true;

    async function loadInterestCounts() {
      const counts: Record<string, number> = {};

      // Local baseline from store listings
      for (const loc of TRACKABLE_LOCALITIES) {
        const needle = loc.value.toLowerCase();
        counts[`locality:${loc.value}`] = listings.filter(
          (l) =>
            l.locality?.toLowerCase().includes(needle) ||
            l.address?.toLowerCase().includes(needle)
        ).length;
      }

      counts['category:Real Estate'] = listings.filter(
        (l) => l.category === 'real_estate'
      ).length;
      counts['category:Services'] = listings.filter(
        (l) => l.category === 'service'
      ).length;
      counts['category:Retail'] = listings.filter(
        (l) => l.category === 'business'
      ).length;
      counts['category:Jobs'] = 0;
      counts['category:Events'] = 0;

      if (isSupabaseConfigured()) {
        try {
          const [jobsRes, eventsRes, realEstateRes, servicesRes, productsRes] =
            await Promise.all([
              supabase
                .from('bulletins')
                .select('id', { count: 'exact', head: true })
                .eq('category', 'job')
                .in('status', ['published', 'active']),
              supabase
                .from('bulletins')
                .select('id', { count: 'exact', head: true })
                .eq('category', 'event')
                .in('status', ['published', 'active']),
              supabase
                .from('listings')
                .select('id', { count: 'exact', head: true })
                .eq('category', 'real_estate')
                .eq('status', 'published'),
              supabase
                .from('listings')
                .select('id', { count: 'exact', head: true })
                .eq('category', 'service')
                .eq('status', 'published'),
              supabase
                .from('marketplace_products')
                .select('id', { count: 'exact', head: true })
                .eq('in_stock', true),
            ]);

          if (typeof jobsRes.count === 'number') {
            counts['category:Jobs'] = jobsRes.count;
          }
          if (typeof eventsRes.count === 'number') {
            counts['category:Events'] = eventsRes.count;
          }
          if (typeof realEstateRes.count === 'number' && realEstateRes.count > 0) {
            counts['category:Real Estate'] = realEstateRes.count;
          }
          if (typeof servicesRes.count === 'number' && servicesRes.count > 0) {
            counts['category:Services'] = servicesRes.count;
          }
          if (typeof productsRes.count === 'number' && productsRes.count > 0) {
            counts['category:Retail'] = productsRes.count;
          }
        } catch {
          // Keep store baseline
        }
      }

      if (active) {
        setInterestCounts(counts);
      }
    }

    queueMicrotask(() => {
      if (active) void loadInterestCounts();
    });

    return () => {
      active = false;
    };
  }, [listings]);

  // Resolved Places list combining store + remote hydrated cards
  const resolvedPlaces = useMemo<HydratedPlaceCard[]>(() => {
    const storeById = new Map(listings.map((l) => [l.id, l]));
    const cards: HydratedPlaceCard[] = [];
    for (const id of savedListingIdList) {
      const storeItem = storeById.get(id);
      if (storeItem) {
        cards.push({
          id: storeItem.id,
          title: storeItem.title,
          category: storeItem.category,
          locality: storeItem.locality,
          rating: storeItem.rating ?? null,
          shortDescription: storeItem.shortDescription,
          coverImage: resolveRemoteMediaUrl(storeItem.coverImage || ''),
          ownerId: storeItem.ownerId || 'owner-1',
          ownerName: storeItem.ownerName || 'Listing Owner',
        });
      } else if (remotePlacesMap[id]) {
        cards.push(remotePlacesMap[id]);
      }
    }
    return cards;
  }, [listings, savedListingIdList, remotePlacesMap]);

  const handleRemovePlace = async (listingId: string) => {
    if (savedListingIds.includes(listingId)) {
      toggleSavedListing(listingId);
    }
    await toggleSave('listing', listingId);
    emitBookmarkChange();
  };

  const handleLocateOnMap = (place: HydratedPlaceCard) => {
    triggerUnmountOverlaysToMap();
    if (typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('printswift:focus-map-listing', {
          detail: { listingId: place.id },
        })
      );
    }
    router.push(`/explore?q=${encodeURIComponent(place.title)}`);
  };

  const handleRefreshAll = async () => {
    await refreshSavedHook();
    await hydrateHubData();
  };

  const tabs: Array<{
    id: SavedHubTab;
    label: string;
    count: number;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'places', label: 'Places', count: resolvedPlaces.length, icon: MapPin },
    { id: 'products', label: 'Products', count: products.length, icon: ShoppingBag },
    { id: 'bulletins', label: 'Bulletins', count: bulletins.length, icon: Megaphone },
    { id: 'following', label: 'Following', count: followCards.length, icon: Heart },
    { id: 'trips', label: 'Tracked Trips', count: orders.length, icon: Truck },
    { id: 'interests', label: 'Interests', count: interests.length, icon: Sparkles },
  ];

  const totalSavedItems =
    resolvedPlaces.length + products.length + bulletins.length;

  return (
    <div
      data-testid="saved-hub-page"
      className="mx-auto w-full max-w-6xl space-y-5 px-4 sm:px-6 lg:px-8 pt-5 pb-20 landscape:pb-8 lg:pb-10 bg-[var(--ps-bg)] text-[var(--ps-text)]"
    >
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3 border-b border-[var(--ps-border)] pb-4">
        <div className="space-y-1 min-w-0">
          <Breadcrumbs items={[{ label: 'Saved & Interests' }]} />
          <div className="flex flex-wrap items-center gap-2">
            <Bookmark className="h-5 w-5 text-[var(--ps-accent)] shrink-0" />
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[var(--ps-text)]">
              Saved &amp; Interests Hub
            </h1>
            <span className="text-xs font-semibold tabular-nums text-[var(--ps-text-muted)]">
              {totalSavedItems} saved · {followCards.length} following · {interests.length} tracked
            </span>
          </div>
          <p className="text-xs text-[var(--ps-text-muted)]">
            {isGuest
              ? 'Saved locally on this device. Sign in to sync places, products, bulletins, and trips across devices.'
              : 'Your synchronized places, marketplace items, community bulletins, followed shops, and Pick N Drop trips.'}
          </p>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => void handleRefreshAll()}
            disabled={hookLoading || isHydrating}
            aria-label="Refresh saved items"
            className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] transition-colors disabled:opacity-50"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${
                hookLoading || isHydrating ? 'animate-spin' : ''
              }`}
            />
          </button>
          <Link
            href="/explore"
            onClick={() => triggerUnmountOverlaysToMap()}
            className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3 text-xs font-semibold text-[var(--ps-accent-fg)] shadow-2xs transition hover:opacity-95"
          >
            <ArrowLeft className="h-3.5 w-3.5" />
            <span>Explore Map</span>
          </Link>
        </div>
      </div>

      {/* Dense Horizontal Scrollable Tabs */}
      <div
        role="tablist"
        aria-label="Saved Hub sections"
        className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar"
      >
        {tabs.map((tab) => {
          const Icon = tab.icon;
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={isActive}
              data-testid={`saved-tab-${tab.id}`}
              onClick={() => setActiveTab(tab.id)}
              className={`inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold transition-colors ${
                isActive
                  ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-2xs'
                  : 'border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
              }`}
            >
              <Icon className="h-3.5 w-3.5 shrink-0" />
              <span>{tab.label}</span>
              <span
                className={`ml-0.5 text-[10px] font-bold tabular-nums ${
                  isActive ? 'opacity-90' : 'text-[var(--ps-text-muted)]'
                }`}
              >
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* TAB 1: PLACES */}
      {activeTab === 'places' && (
        <section className="space-y-4">
          {resolvedPlaces.length === 0 ? (
            <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-8 text-center space-y-2.5">
              <MapPin className="h-6 w-6 text-[var(--ps-text-muted)] mx-auto" />
              <p className="text-sm font-bold text-[var(--ps-text)]">
                No saved places yet
              </p>
              <p className="text-xs text-[var(--ps-text-muted)] max-w-sm mx-auto">
                Tap the Bookmark button on any shop, clinic, service, or landmark on the Explore map to save it here.
              </p>
              <div className="pt-1">
                <Link
                  href="/explore"
                  className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3.5 text-xs font-semibold text-[var(--ps-accent-fg)]"
                >
                  <Compass className="h-3.5 w-3.5" />
                  <span>Browse Churachandpur Map</span>
                </Link>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {resolvedPlaces.map((item) => (
                <article
                  key={item.id}
                  data-testid={`saved-place-card-${item.id}`}
                  className="flex flex-col justify-between overflow-hidden rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] transition-colors hover:border-[var(--ps-accent)]/50"
                >
                  <div>
                    {item.coverImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={item.coverImage}
                        alt={item.title}
                        referrerPolicy="no-referrer"
                        className="h-40 w-full object-cover bg-[var(--ps-surface-alt)]"
                      />
                    ) : (
                      <div className="flex h-40 w-full items-center justify-center bg-[var(--ps-surface-alt)] text-xs font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                        {formatCategoryLabel(item.category)}
                      </div>
                    )}
                    <div className="p-3.5 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-[var(--ps-text-muted)]">
                        <span className="font-bold uppercase tracking-wide text-[10px] text-[var(--ps-accent)]">
                          {formatCategoryLabel(item.category)}
                        </span>
                        <span>·</span>
                        <span className="truncate">{item.locality}</span>
                        {item.rating !== null && (
                          <>
                            <span>·</span>
                            <span className="font-bold text-amber-500 tabular-nums">
                              ★ {item.rating.toFixed(1)}
                            </span>
                          </>
                        )}
                      </div>
                      <h2 className="text-sm font-bold tracking-tight text-[var(--ps-text)] line-clamp-1">
                        {item.title}
                      </h2>
                      {item.shortDescription && (
                        <p className="line-clamp-2 text-xs leading-relaxed text-[var(--ps-text-muted)]">
                          {item.shortDescription}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center justify-between gap-2 border-t border-[var(--ps-border)]/70 bg-[var(--ps-surface-alt)]/30 px-3.5 py-2.5">
                    <button
                      type="button"
                      onClick={() => void handleRemovePlace(item.id)}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:underline"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>Remove</span>
                    </button>
                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => handleLocateOnMap(item)}
                        className="inline-flex h-8 items-center gap-1 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]"
                      >
                        <MapPin className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
                        <span>View on Map</span>
                      </button>
                      <Link
                        href={`/listing/${encodeURIComponent(item.id)}`}
                        className="inline-flex h-8 items-center rounded-xl bg-[var(--ps-accent)] px-3 text-xs font-semibold text-[var(--ps-accent-fg)] hover:opacity-95"
                      >
                        Details
                      </Link>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {/* TAB 2: PRODUCTS */}
      {activeTab === 'products' && (
        <section className="space-y-4">
          {isHydrating && products.length === 0 ? (
            <div className="py-12 flex items-center justify-center gap-2 text-xs text-[var(--ps-text-muted)]">
              <Loader2 className="h-4 w-4 animate-spin text-[var(--ps-accent)]" />
              <span>Loading saved products...</span>
            </div>
          ) : products.length === 0 ? (
            <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-8 text-center space-y-2.5">
              <ShoppingBag className="h-6 w-6 text-[var(--ps-text-muted)] mx-auto" />
              <p className="text-sm font-bold text-[var(--ps-text)]">
                No saved products yet
              </p>
              <p className="text-xs text-[var(--ps-text-muted)] max-w-sm mx-auto">
                Bookmark items across Lamka&apos;s Marketplace to compare prices and message shop owners directly.
              </p>
              <div className="pt-1">
                <Link
                  href="/marketplace"
                  className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3.5 text-xs font-semibold text-[var(--ps-accent-fg)]"
                >
                  <ShoppingBag className="h-3.5 w-3.5" />
                  <span>Explore Marketplace</span>
                </Link>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {products.map((prod) => {
                const waDigits = sanitizePhoneForWhatsApp(prod.shopPhone);
                const waHref = waDigits
                  ? `https://wa.me/${waDigits}?text=${encodeURIComponent(
                      `Hi ${prod.shopName}, I saw "${prod.title}" (₹${prod.priceInr}) saved on PrintSwift Local. Is it currently available?`
                    )}`
                  : null;
                return (
                  <article
                    key={prod.id}
                    data-testid={`saved-product-card-${prod.id}`}
                    className="flex flex-col justify-between overflow-hidden rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)]"
                  >
                    <div>
                      <div className="relative h-40 w-full bg-[var(--ps-surface-alt)] overflow-hidden">
                        {prod.imageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={prod.imageUrl}
                            alt={prod.title}
                            referrerPolicy="no-referrer"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-[var(--ps-text-muted)]">
                            <Package className="h-6 w-6" />
                          </div>
                        )}
                      </div>
                      <div className="p-3.5 space-y-1.5">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-base font-extrabold tabular-nums text-[var(--ps-text)]">
                            ₹{prod.priceInr.toLocaleString('en-IN')}
                            <span className="text-[11px] font-medium text-[var(--ps-text-muted)]">
                              {' '}
                              / {prod.unit}
                            </span>
                          </span>
                          <span
                            className={`text-[10px] font-bold uppercase ${
                              prod.inStock
                                ? 'text-emerald-600 dark:text-emerald-400'
                                : 'text-rose-600 dark:text-rose-400'
                            }`}
                          >
                            {prod.inStock ? 'In Stock' : 'Out of Stock'}
                          </span>
                        </div>
                        <h2 className="text-sm font-bold text-[var(--ps-text)] line-clamp-1">
                          {prod.title}
                        </h2>
                        <p className="text-[11px] text-[var(--ps-text-muted)] flex items-center gap-1 truncate">
                          <Store className="h-3 w-3 shrink-0 text-[var(--ps-accent)]" />
                          <span className="truncate">
                            {prod.shopName} · {prod.shopLocality}
                          </span>
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 border-t border-[var(--ps-border)]/70 bg-[var(--ps-surface-alt)]/30 px-3.5 py-2.5">
                      <button
                        type="button"
                        onClick={() => void toggleSave('product', prod.id)}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:underline"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span>Remove</span>
                      </button>
                      <div className="flex items-center gap-1.5">
                        {waHref && (
                          <a
                            href={waHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex h-8 items-center gap-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 px-2.5 text-xs font-semibold text-white transition-colors"
                          >
                            <MessageCircle className="h-3.5 w-3.5" />
                            <span>WhatsApp</span>
                          </a>
                        )}
                        {prod.listingId && (
                          <Link
                            href={`/listing/${encodeURIComponent(prod.listingId)}`}
                            className="inline-flex h-8 items-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]"
                          >
                            View Shop
                          </Link>
                        )}
                      </div>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* TAB 3: BULLETINS */}
      {activeTab === 'bulletins' && (
        <section className="space-y-4">
          {isHydrating && bulletins.length === 0 ? (
            <div className="py-12 flex items-center justify-center gap-2 text-xs text-[var(--ps-text-muted)]">
              <Loader2 className="h-4 w-4 animate-spin text-[var(--ps-accent)]" />
              <span>Loading saved bulletins...</span>
            </div>
          ) : bulletins.length === 0 ? (
            <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-8 text-center space-y-2.5">
              <Megaphone className="h-6 w-6 text-[var(--ps-text-muted)] mx-auto" />
              <p className="text-sm font-bold text-[var(--ps-text)]">
                No saved bulletins yet
              </p>
              <p className="text-xs text-[var(--ps-text-muted)] max-w-sm mx-auto">
                Save local job openings, civic notices, and upcoming Churachandpur events to read anytime.
              </p>
              <div className="pt-1">
                <Link
                  href="/bulletin"
                  className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3.5 text-xs font-semibold text-[var(--ps-accent-fg)]"
                >
                  <Megaphone className="h-3.5 w-3.5" />
                  <span>Open Bulletin Board</span>
                </Link>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {bulletins.map((b) => (
                <article
                  key={b.id}
                  data-testid={`saved-bulletin-card-${b.id}`}
                  className="flex flex-col justify-between rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3"
                >
                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--ps-text-muted)]">
                      <span className="font-bold uppercase tracking-wide text-[10px] text-[var(--ps-accent)]">
                        {formatCategoryLabel(b.category)}
                      </span>
                      <span className="tabular-nums">
                        {formatExpiryShort(b.expiresAt)}
                      </span>
                    </div>
                    <h2 className="text-sm font-bold text-[var(--ps-text)] leading-snug line-clamp-2">
                      {b.title}
                    </h2>
                    <p className="text-xs text-[var(--ps-text-muted)] line-clamp-3 leading-relaxed">
                      {b.excerpt}
                    </p>
                    <p className="text-[11px] text-[var(--ps-text-muted)] pt-1">
                      By <strong className="text-[var(--ps-text)]">{b.authorName}</strong>
                    </p>
                  </div>

                  <div className="flex items-center justify-between gap-2 border-t border-[var(--ps-border)]/70 pt-2.5">
                    <button
                      type="button"
                      onClick={() => void toggleSave('bulletin', b.id)}
                      className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:underline"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      <span>Remove</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedBulletin(b)}
                      className="inline-flex h-8 items-center gap-1 rounded-xl bg-[var(--ps-accent)] px-3 text-xs font-semibold text-[var(--ps-accent-fg)] hover:opacity-95"
                    >
                      <span>Read Bulletin</span>
                      <ArrowRight className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      )}

      {/* TAB 4: FOLLOWING */}
      {activeTab === 'following' && (
        <section className="space-y-4">
          {followCards.length === 0 ? (
            <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-8 text-center space-y-2.5">
              <Heart className="h-6 w-6 text-[var(--ps-text-muted)] mx-auto" />
              <p className="text-sm font-bold text-[var(--ps-text)]">
                Not following any shops or publishers yet
              </p>
              <p className="text-xs text-[var(--ps-text-muted)] max-w-sm mx-auto">
                Tap Follow on local shops in Marketplace or Bulletin authors to keep them in one quick directory.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {followCards.map((fc) => (
                <div
                  key={`${fc.targetType}:${fc.targetId}`}
                  className="flex items-center justify-between gap-3 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3.5"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {fc.avatarOrCover ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={fc.avatarOrCover}
                        alt={fc.name}
                        referrerPolicy="no-referrer"
                        className="h-11 w-11 rounded-xl object-cover shrink-0 border border-[var(--ps-border)]"
                      />
                    ) : (
                      <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface-alt)] text-[var(--ps-accent)]">
                        {fc.targetType === 'shop_listing' ? (
                          <Store className="h-5 w-5" />
                        ) : (
                          <User className="h-5 w-5" />
                        )}
                      </div>
                    )}
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-[var(--ps-text)] truncate">
                        {fc.name}
                      </p>
                      <p className="text-[11px] text-[var(--ps-text-muted)] truncate">
                        {fc.subtitle}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Link
                      href={fc.href}
                      className="inline-flex h-8 items-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]"
                    >
                      {fc.actionLabel}
                    </Link>
                    <button
                      type="button"
                      onClick={() =>
                        void toggleFollow(fc.targetType, fc.targetId)
                      }
                      aria-label={`Unfollow ${fc.name}`}
                      className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
                    >
                      <UserMinus className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {/* TAB 5: TRACKED TRIPS (PICK N DROP ORDERS) */}
      {activeTab === 'trips' && (
        <section className="space-y-4">
          {!activeUserId ? (
            <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-8 text-center space-y-2.5">
              <Truck className="h-6 w-6 text-[var(--ps-text-muted)] mx-auto" />
              <p className="text-sm font-bold text-[var(--ps-text)]">
                Sign in to view your Pick N Drop trips
              </p>
              <p className="text-xs text-[var(--ps-text-muted)] max-w-sm mx-auto">
                Your live parcel, ride, and LPG gas delivery orders with Sender/Recipient OTPs appear here when signed in.
              </p>
              <div className="pt-1">
                <Link
                  href="/login"
                  className="inline-flex h-8 items-center rounded-xl bg-[var(--ps-accent)] px-3.5 text-xs font-semibold text-[var(--ps-accent-fg)]"
                >
                  Sign In
                </Link>
              </div>
            </div>
          ) : orders.length === 0 ? (
            <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-8 text-center space-y-2.5">
              <Truck className="h-6 w-6 text-[var(--ps-text-muted)] mx-auto" />
              <p className="text-sm font-bold text-[var(--ps-text)]">
                No Pick N Drop orders yet
              </p>
              <p className="text-xs text-[var(--ps-text-muted)] max-w-sm mx-auto">
                Book a local parcel delivery, quick ride, or LPG cylinder pickup right from the Explore map.
              </p>
              <div className="pt-1">
                <Link
                  href="/explore"
                  className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3.5 text-xs font-semibold text-[var(--ps-accent-fg)]"
                >
                  <Truck className="h-3.5 w-3.5" />
                  <span>Book Pick N Drop</span>
                </Link>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {orders.map((order) => {
                const statusMeta =
                  DELIVERY_STATUS_META[order.status] ||
                  DELIVERY_STATUS_META.awaiting_payment;
                const modeKey: DeliveryServiceMode =
                  order.service_mode || 'parcel';
                const modeLabel =
                  SERVICE_MODE_META[modeKey]?.shortLabel || 'Parcel';

                return (
                  <div
                    key={order.id}
                    data-testid={`saved-trip-card-${order.id}`}
                    className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-2.5"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold text-[var(--ps-text)]">
                          {order.order_code}
                        </span>
                        <span className="text-[11px] font-semibold text-[var(--ps-text-muted)]">
                          · {modeLabel} ·{' '}
                          {order.trip_type === 'two_way' ? 'Two-Way' : 'One-Way'}
                        </span>
                      </div>
                      <span
                        className={`rounded-md border px-2 py-0.5 text-[10px] font-bold ${statusMeta.badgeClass}`}
                      >
                        {statusMeta.label}
                      </span>
                    </div>

                    <div className="space-y-1 text-xs text-[var(--ps-text-muted)]">
                      <p className="truncate">
                        <strong className="text-[var(--ps-text)]">From:</strong>{' '}
                        {order.pickup_address}
                      </p>
                      <p className="truncate">
                        <strong className="text-[var(--ps-text)]">To:</strong>{' '}
                        {order.dropoff_address}
                      </p>
                    </div>

                    <div className="flex items-center justify-between gap-2 border-t border-[var(--ps-border)]/70 pt-2.5">
                      <div className="text-xs font-extrabold tabular-nums text-[var(--ps-text)]">
                        ₹{Number(order.quoted_fare_inr || 0).toLocaleString('en-IN')}
                        <span className="ml-1.5 text-[11px] font-normal text-[var(--ps-text-muted)]">
                          {Number(order.distance_km || 0).toFixed(1)} km
                        </span>
                      </div>
                      <button
                        type="button"
                        onClick={() => {
                          setTrackerOrderId(order.id);
                          setIsTrackerOpen(true);
                        }}
                        className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3 text-xs font-semibold text-[var(--ps-accent-fg)] hover:opacity-95"
                      >
                        <Truck className="h-3.5 w-3.5" />
                        <span>Track &amp; OTPs</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* TAB 6: INTERESTS */}
      {activeTab === 'interests' && (
        <section className="space-y-5">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Localities */}
            <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3">
              <div>
                <h2 className="text-sm font-bold text-[var(--ps-text)]">
                  Churachandpur Localities
                </h2>
                <p className="text-xs text-[var(--ps-text-muted)]">
                  Tap neighborhoods you care about for quick one-tap map filtering.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {TRACKABLE_LOCALITIES.map((loc) => {
                  const active = hasInterest('locality', loc.value);
                  const count = interestCounts[`locality:${loc.value}`] ?? 0;
                  return (
                    <button
                      key={loc.value}
                      type="button"
                      onClick={() => void toggleInterest('locality', loc.value)}
                      data-testid={`interest-locality-${loc.value}`}
                      className={`inline-flex h-8 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition-colors ${
                        active
                          ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                          : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text)] hover:border-[var(--ps-accent)]/60'
                      }`}
                    >
                      <MapPin className="h-3.5 w-3.5 shrink-0" />
                      <span>{loc.value}</span>
                      <span className="text-[10px] font-bold tabular-nums opacity-80">
                        ({count})
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Categories */}
            <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3">
              <div>
                <h2 className="text-sm font-bold text-[var(--ps-text)]">
                  Categories &amp; Feeds
                </h2>
                <p className="text-xs text-[var(--ps-text-muted)]">
                  Track district categories across Listings, Marketplace, and Bulletin.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {TRACKABLE_CATEGORIES.map((cat) => {
                  const active = hasInterest('category', cat.value);
                  const count = interestCounts[`category:${cat.value}`] ?? 0;
                  return (
                    <button
                      key={cat.value}
                      type="button"
                      onClick={() => void toggleInterest('category', cat.value)}
                      data-testid={`interest-category-${cat.value}`}
                      className={`inline-flex h-8 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition-colors ${
                        active
                          ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                          : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text)] hover:border-[var(--ps-accent)]/60'
                      }`}
                    >
                      <Sparkles className="h-3.5 w-3.5 shrink-0" />
                      <span>{cat.value}</span>
                      <span className="text-[10px] font-bold tabular-nums opacity-80">
                        ({count})
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Active Tracked Interests Deep Links */}
          <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-bold text-[var(--ps-text)]">
                Your Active Feed Shortcuts ({interests.length})
              </h3>
            </div>
            {interests.length === 0 ? (
              <p className="text-xs text-[var(--ps-text-muted)]">
                Toggle any locality or category above to pin instant shortcuts here.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {interests.map((item) => {
                  const locMeta = TRACKABLE_LOCALITIES.find(
                    (l) =>
                      l.value.toLowerCase() ===
                      item.interest_value.trim().toLowerCase()
                  );
                  const catMeta = TRACKABLE_CATEGORIES.find(
                    (c) =>
                      c.value.toLowerCase() ===
                      item.interest_value.trim().toLowerCase()
                  );
                  const href =
                    item.interest_type === 'locality'
                      ? locMeta?.href ||
                        `/explore?q=${encodeURIComponent(item.interest_value)}`
                      : catMeta?.href ||
                        `/explore?q=${encodeURIComponent(item.interest_value)}`;
                  const count =
                    interestCounts[
                      `${item.interest_type}:${item.interest_value}`
                    ] ?? 0;

                  return (
                    <Link
                      key={`${item.interest_type}:${item.interest_value}`}
                      href={href}
                      className="flex items-center justify-between gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2.5 text-xs hover:border-[var(--ps-accent)] transition-colors"
                    >
                      <div className="min-w-0">
                        <p className="font-bold text-[var(--ps-text)] truncate">
                          {item.interest_value}
                        </p>
                        <p className="text-[11px] text-[var(--ps-text-muted)] tabular-nums">
                          {item.interest_type === 'locality'
                            ? 'Locality'
                            : 'Category'}{' '}
                          · {count} live matches
                        </p>
                      </div>
                      <ArrowRight className="h-3.5 w-3.5 text-[var(--ps-accent)] shrink-0" />
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      )}

      {/* Saved Bulletin Detail Reader Modal */}
      <AnimatePresence>
        {selectedBulletin && (
          <motion.div
            key="saved-bulletin-backdrop"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setSelectedBulletin(null)}
            className="fixed inset-0 z-[9998] flex items-center justify-center bg-black/55 backdrop-blur-xs p-3 sm:p-4"
          >
            <motion.div
              key="saved-bulletin-modal"
              initial={{ opacity: 0, scale: 0.96, y: 12 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.96, y: 12 }}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-2xl max-h-[88dvh] flex flex-col overflow-hidden rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] shadow-2xl"
            >
              <div className="flex items-start justify-between gap-3 border-b border-[var(--ps-border)] px-4 py-3">
                <div className="min-w-0">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-accent)]">
                    {formatCategoryLabel(selectedBulletin.category)} ·{' '}
                    {formatExpiryShort(selectedBulletin.expiresAt)}
                  </p>
                  <h2 className="text-base font-bold text-[var(--ps-text)] leading-snug">
                    {selectedBulletin.title}
                  </h2>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedBulletin(null)}
                  aria-label="Close bulletin reader"
                  className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4">
                {selectedBulletin.imageUrls.length > 0 && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {selectedBulletin.imageUrls.map((url, idx) => (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        key={`${url}-${idx}`}
                        src={url}
                        alt={`${selectedBulletin.title} image ${idx + 1}`}
                        referrerPolicy="no-referrer"
                        className="w-full max-h-60 rounded-xl object-cover border border-[var(--ps-border)]"
                      />
                    ))}
                  </div>
                )}

                {selectedBulletin.youtubeVideoId && (
                  <YouTubeEmbedPlayer
                    videoId={selectedBulletin.youtubeVideoId}
                    title={selectedBulletin.title}
                  />
                )}

                {selectedBulletin.contentJson ? (
                  <BulletinContentRenderer content={selectedBulletin.contentJson} />
                ) : (
                  <p className="text-sm leading-relaxed text-[var(--ps-text)]">
                    {selectedBulletin.excerpt}
                  </p>
                )}

                {/* Response Contacts */}
                <div className="flex flex-wrap items-center gap-2 border-t border-[var(--ps-border)] pt-3">
                  {selectedBulletin.contactChannels.phone && (
                    <a
                      href={`tel:${selectedBulletin.contactChannels.phone}`}
                      className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs font-semibold text-[var(--ps-text)]"
                    >
                      <Phone className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
                      <span>{selectedBulletin.contactChannels.phone}</span>
                    </a>
                  )}
                  {selectedBulletin.contactChannels.whatsapp && (
                    <a
                      href={`https://wa.me/${sanitizePhoneForWhatsApp(selectedBulletin.contactChannels.whatsapp)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-xs font-semibold text-white"
                    >
                      <MessageCircle className="h-3.5 w-3.5" />
                      <span>WhatsApp</span>
                    </a>
                  )}
                  {selectedBulletin.contactChannels.email && (
                    <a
                      href={`mailto:${selectedBulletin.contactChannels.email}`}
                      className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs font-semibold text-[var(--ps-text)]"
                    >
                      <Mail className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
                      <span>Email</span>
                    </a>
                  )}
                  {selectedBulletin.contactChannels.website &&
                    sanitizeBulletinHref(selectedBulletin.contactChannels.website) && (
                      <a
                        href={
                          sanitizeBulletinHref(
                            selectedBulletin.contactChannels.website
                          ) || '#'
                        }
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs font-semibold text-[var(--ps-text)]"
                      >
                        <ExternalLink className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
                        <span>Website</span>
                      </a>
                    )}
                </div>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Pick N Drop Live Order Tracker Modal */}
      <OrderTrackerModal
        mode="modal"
        isOpen={isTrackerOpen}
        initialOrderId={trackerOrderId}
        onClose={() => {
          setIsTrackerOpen(false);
          setTrackerOrderId(null);
        }}
        onStartNewDelivery={() => {
          setIsTrackerOpen(false);
          router.push('/explore');
        }}
      />
    </div>
  );
}
