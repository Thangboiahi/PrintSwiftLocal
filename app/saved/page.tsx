'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { AnimatePresence, motion } from 'framer-motion';
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  Car,
  Compass,
  ExternalLink,
  Heart,
  Mail,
  MapPin,
  Megaphone,
  MessageCircle,
  Package,
  Phone,
  Printer,
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
import { useAppConfig } from '@/components/providers/AppConfigProvider';
import { AppBrandLoader } from '@/components/ui/AppBrandLoader';
import { emitBookmarkChange } from '@/lib/events';
import { useSavedInterests } from '@/lib/hooks/useSavedInterests';
import type { VehicleBookingRecord } from '@/lib/payments/types';
import {
  DELIVERY_STATUS_META,
  SERVICE_MODE_META,
  type DeliveryOrderRecord,
  type DeliveryServiceMode,
} from '@/lib/pick-n-drop/types';
import {
  isPrintProfileBusyPaused,
  normalizeClientPrintProfile,
} from '@/lib/print-orders/client-helpers';
import { CATEGORY_LABELS } from '@/lib/rules';
import { useAppStore, useAuth } from '@/lib/store';
import {
  buildContextualWhatsAppMessage,
  buildContextualWhatsAppUrl,
  buildWhatsAppUrl,
  normalizeWhatsAppPhone,
} from '@/lib/utils/whatsapp';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { resolveRemoteMediaUrl } from '@/lib/supabase/storage';
import type { ListingCategory } from '@/lib/types';

type SavedHubTab =
  | 'places'
  | 'products'
  | 'bulletins'
  | 'vehicles'
  | 'following'
  | 'trips'
  | 'interests';

const VALID_SAVED_TABS: readonly SavedHubTab[] = [
  'places',
  'products',
  'bulletins',
  'vehicles',
  'following',
  'trips',
  'interests',
];

interface HydratedVehicleCard {
  id: string;
  hubId: string | null;
  title: string;
  standLocality: string;
  totalSeats: number;
  withDriver: boolean;
  bookingMode: string;
  rateDailyInr: number | null;
  rateHourlyInr: number | null;
  ratePerKmInr: number | null;
  firstFixedRouteFare: number | null;
  thumbnailUrl: string;
  features: string[];
}

interface HydratedVehicleBooking extends VehicleBookingRecord {
  vehicleTitle: string;
  standLocality: string;
}

interface HydratedPlaceCard {
  id: string;
  hubId: string | null;
  title: string;
  category: string;
  locality: string;
  lat: number | null;
  lng: number | null;
  rating: number | null;
  shortDescription: string;
  coverImage: string;
  ownerId: string;
  ownerName: string;
}

interface HydratedProductCard {
  id: string;
  hubId: string | null;
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
  shopLat: number | null;
  shopLng: number | null;
}

interface HydratedBulletinCard {
  id: string;
  hubId: string | null;
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
  hubId: string | null;
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

function formatExpiryShort(iso: string | null, nowMs: number): string {
  if (!iso) return 'Active';
  const diffDays = Math.ceil((new Date(iso).getTime() - nowMs) / 86400000);
  if (diffDays <= 0) return 'Expired';
  if (diffDays === 1) return 'Ends tomorrow';
  return `${diffDays}d left`;
}

function buildPickNDropHref(params: {
  label: string;
  lat?: number | null;
  lng?: number | null;
  hubSlug?: string | null;
}): string {
  const qs = new URLSearchParams();
  if (params.hubSlug) qs.set('hub', params.hubSlug);
  qs.set('mode', 'pick_n_drop');
  if (params.label.trim()) qs.set('pickupLabel', params.label.trim());
  if (
    typeof params.lat === 'number' &&
    Number.isFinite(params.lat) &&
    typeof params.lng === 'number' &&
    Number.isFinite(params.lng)
  ) {
    qs.set('pickupLat', String(params.lat));
    qs.set('pickupLng', String(params.lng));
  }
  return `/explore?${qs.toString()}`;
}

export default function SavedHubPage() {
  const router = useRouter();
  const {
    activeHub,
    hubs,
    office,
    hubLocalities,
    categoriesByEntity,
    localities: configLocalities,
    categories: configCategories,
  } = useAppConfig();
  const activeHubId = activeHub?.id || '';
  const activeHubName = activeHub?.name || 'Churachandpur';
  const activeHubSlug = activeHub?.slug || 'churachandpur';

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
  const [hubFilterMode, setHubFilterMode] = useState<'all' | 'active'>('all');
  const [isHydrating, setIsHydrating] = useState(false);
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  // Hydrated datasets
  const [remotePlacesMap, setRemotePlacesMap] = useState<
    Record<string, HydratedPlaceCard>
  >({});
  const [products, setProducts] = useState<HydratedProductCard[]>([]);
  const [bulletins, setBulletins] = useState<HydratedBulletinCard[]>([]);
  const [vehicles, setVehicles] = useState<HydratedVehicleCard[]>([]);
  const [followCards, setFollowCards] = useState<HydratedFollowCard[]>([]);
  const [orders, setOrders] = useState<DeliveryOrderRecord[]>([]);
  const [vehicleBookings, setVehicleBookings] = useState<
    HydratedVehicleBooking[]
  >([]);
  const [interestCounts, setInterestCounts] = useState<Record<string, number>>(
    {}
  );

  // Interactive modals
  const [selectedBulletin, setSelectedBulletin] =
    useState<HydratedBulletinCard | null>(null);
  const [trackerOrderId, setTrackerOrderId] = useState<string | null>(null);
  const [isTrackerOpen, setIsTrackerOpen] = useState(false);

  // Hydrate ?tab= query param on mount
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const param = new URLSearchParams(window.location.search)
      .get('tab')
      ?.trim()
      .toLowerCase();
    if (param && (VALID_SAVED_TABS as readonly string[]).includes(param)) {
      queueMicrotask(() => {
        setActiveTab(param as SavedHubTab);
      });
    }
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setNowMs(Date.now()), 60000);
    return () => window.clearInterval(id);
  }, []);

  const hubNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const h of hubs) {
      map.set(h.id, h.name);
    }
    return map;
  }, [hubs]);

  const resolveCrossHubLabel = useCallback(
    (itemHubId?: string | null): string | null => {
      if (!itemHubId || !activeHubId || itemHubId === activeHubId) return null;
      return hubNameById.get(itemHubId) || null;
    },
    [activeHubId, hubNameById]
  );

  const dynamicLocalities = useMemo(() => {
    const verifiedPool = (hubLocalities || []).filter(
      (l) => l.is_active !== false && l.status === 'verified'
    );
    if (verifiedPool.length > 0) {
      return verifiedPool.map((loc) => ({
        id: loc.id || null,
        value: loc.display_name,
        slug: loc.slug,
        href: `/explore?hub=${encodeURIComponent(activeHubSlug)}&locality=${encodeURIComponent(loc.slug)}`,
      }));
    }
    const active = configLocalities.filter((l) => l.is_active);
    if (active.length > 0) {
      return active.map((loc) => ({
        id: loc.id || null,
        value: loc.display_name,
        slug: loc.slug,
        href: `/explore?hub=${encodeURIComponent(activeHubSlug)}&locality=${encodeURIComponent(loc.slug)}`,
      }));
    }
    return TRACKABLE_LOCALITIES.map((l) => ({
      id: null as string | null,
      value: l.value,
      slug: l.value.toLowerCase().replace(/\s+/g, '_'),
      href: l.href,
    }));
  }, [hubLocalities, configLocalities, activeHubSlug]);

  const dynamicCategories = useMemo(() => {
    const listingTree = categoriesByEntity?.listing || [];
    if (listingTree.length > 0) {
      const flattened: Array<{
        id: string | null;
        value: string;
        slug: string;
        module: 'explore' | 'marketplace' | 'bulletin';
        href: string;
      }> = [];
      for (const root of listingTree) {
        if (!root.is_active) continue;
        flattened.push({
          id: root.id,
          value: root.display_name,
          slug: root.slug,
          module: 'explore',
          href: `/explore?hub=${encodeURIComponent(activeHubSlug)}&category=${encodeURIComponent(root.slug)}`,
        });
        for (const child of root.children || []) {
          if (!child.is_active) continue;
          flattened.push({
            id: child.id,
            value: child.display_name,
            slug: child.slug,
            module: 'explore',
            href: `/explore?hub=${encodeURIComponent(activeHubSlug)}&category=${encodeURIComponent(child.slug)}`,
          });
        }
      }
      if (flattened.length > 0) {
        return flattened;
      }
    }

    const active = configCategories.filter((c) => c.is_active);
    if (active.length > 0) {
      return active.map((cat) => ({
        id: cat.id || null,
        value: cat.display_name,
        slug: cat.slug,
        module: cat.module,
        href:
          cat.module === 'bulletin'
            ? `/bulletin?category=${encodeURIComponent(cat.slug)}`
            : cat.module === 'marketplace'
              ? `/marketplace?category=${encodeURIComponent(cat.display_name)}`
              : `/explore?hub=${encodeURIComponent(activeHubSlug)}&category=${encodeURIComponent(cat.slug)}`,
      }));
    }
    return TRACKABLE_CATEGORIES.map((c) => ({
      id: null as string | null,
      value: c.value,
      slug: c.value.toLowerCase().replace(/\s+/g, '_'),
      module: c.kind.startsWith('bulletin') ? ('bulletin' as const) : ('explore' as const),
      href: c.href,
    }));
  }, [categoriesByEntity, configCategories, activeHubSlug]);

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

  const savedVehicleIds = useMemo(
    () =>
      savedItems
        .filter((item) => item.item_type === 'vehicle')
        .map((item) => item.item_id),
    [savedItems]
  );

  // Stable serialized keys for hydration effect
  const listingIdsKey = savedListingIdList.join(',');
  const productIdsKey = savedProductIds.join(',');
  const bulletinIdsKey = savedBulletinIds.join(',');
  const vehicleIdsKey = savedVehicleIds.join(',');
  const followsKey = follows
    .map((f) => `${f.target_type}:${f.target_id}`)
    .join(',');

  const [activePrintPlaceMap, setActivePrintPlaceMap] = useState<
    Record<string, boolean>
  >({});

  // Phase 71-D: Hydrate active Print Pro / PrintSwift status for saved Places
  useEffect(() => {
    if (!isSupabaseConfigured() || !listingIdsKey) return;
    const placeUuids = listingIdsKey
      .split(',')
      .filter((id) => UUID_REGEX.test(id));
    if (placeUuids.length === 0) return;

    let active = true;
    const loadSavedPrintProfiles = async () => {
      try {
        const { data, error } = await supabase
          .from('listing_print_profiles')
          .select(
            'listing_id, is_first_party_printswift, is_accepting_orders, busy_until'
          )
          .in('listing_id', placeUuids);

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
        setActivePrintPlaceMap(nextMap);
      } catch {
        // Non-blocking
      }
    };
    void loadSavedPrintProfiles();
    return () => {
      active = false;
    };
  }, [listingIdsKey]);

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

      // 3. Saved Bulletins & Vehicles
      const bulletinUuids = savedBulletinIds.filter((id) => UUID_REGEX.test(id));
      const vehicleUuids = savedVehicleIds.filter((id) => UUID_REGEX.test(id));

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
        vehiclesRes,
        followedShopsRes,
        followedAuthorsRes,
        ordersRes,
        vehicleBookingsRes,
      ] = await Promise.all([
        canQueryDb && missingPlaceUuids.length > 0
          ? supabase
              .from('listings')
              .select('*')
              .in('id', missingPlaceUuids)
          : Promise.resolve({ data: null }),
        canQueryDb && productUuids.length > 0
          ? supabase
              .from('marketplace_products')
              .select(
                '*, listings(id, title, locality, phone, contact_phone, lat, lng)'
              )
              .in('id', productUuids)
          : Promise.resolve({ data: null }),
        canQueryDb && bulletinUuids.length > 0
          ? supabase
              .from('bulletins')
              .select(
                '*, profiles:author_id(id, full_name, name, role)'
              )
              .in('id', bulletinUuids)
          : Promise.resolve({ data: null }),
        canQueryDb && vehicleUuids.length > 0
          ? supabase
              .from('vehicle_listings')
              .select('*')
              .in('id', vehicleUuids)
          : Promise.resolve({ data: null }),
        canQueryDb && missingShopUuids.length > 0
          ? supabase
              .from('listings')
              .select('*')
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
        canQueryDb && activeUserId
          ? supabase
              .from('vehicle_bookings')
              .select('*, vehicle_listings(id, title, stand_locality)')
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
            hubId: typeof row.hub_id === 'string' ? row.hub_id : null,
            title: String(row.title || 'Saved Place'),
            category: String(row.category || 'business'),
            locality: String(row.locality || 'Churachandpur'),
            lat: typeof row.lat === 'number' ? row.lat : null,
            lng: typeof row.lng === 'number' ? row.lng : null,
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
            hubId:
              typeof row.hub_id === 'string'
                ? row.hub_id
                : typeof shopRaw?.hub_id === 'string'
                  ? shopRaw.hub_id
                  : null,
            listingId: String(row.listing_id || shopRaw?.id || ''),
            title: String(row.title || 'Saved Product'),
            description: String(row.description || ''),
            priceInr: Number(row.price ?? row.price_inr ?? 0),
            unit: String(row.unit || 'item'),
            imageUrl: resolveRemoteMediaUrl(
              typeof row.thumbnail_url === 'string'
                ? row.thumbnail_url
                : typeof row.image_url === 'string'
                  ? row.image_url
                  : ''
            ),
            inStock: row.in_stock !== false,
            shopName: String(shopRaw?.title || 'Local Shop'),
            shopLocality: String(shopRaw?.locality || 'Churachandpur'),
            shopPhone: String(
              shopRaw?.contact_phone || shopRaw?.phone || ''
            ),
            shopLat: typeof shopRaw?.lat === 'number' ? shopRaw.lat : null,
            shopLng: typeof shopRaw?.lng === 'number' ? shopRaw.lng : null,
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
              hubId: l.hub_id || null,
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
              shopLat: l.coordinates?.lat ?? null,
              shopLng: l.coordinates?.lng ?? null,
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
            hubId: typeof row.hub_id === 'string' ? row.hub_id : null,
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
              hubId: fromStore.hub_id || null,
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
              hubId: typeof fromRemote.hub_id === 'string' ? fromRemote.hub_id : null,
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
              hubId: null,
              name: 'Followed Business',
              subtitle: 'Local Shop',
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
            hubId: null,
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

      // Map Vehicles
      const hydratedVehicles: HydratedVehicleCard[] = [];
      if (Array.isArray(vehiclesRes.data)) {
        for (const row of vehiclesRes.data as Array<Record<string, unknown>>) {
          const id = String(row.id || '');
          if (!id) continue;
          const routes = Array.isArray(row.fixed_routes)
            ? (row.fixed_routes as Array<{ fare_inr?: number }>)
            : [];
          const firstFare =
            routes.length > 0 && Number(routes[0]?.fare_inr) > 0
              ? Number(routes[0].fare_inr)
              : null;
          hydratedVehicles.push({
            id,
            hubId:
              typeof row.origin_hub_id === 'string'
                ? row.origin_hub_id
                : typeof row.hub_id === 'string'
                  ? row.hub_id
                  : null,
            title: String(row.title || 'Saved Vehicle').replace(/^\[SAMPLE\]\s*/i, ''),
            standLocality: String(row.stand_locality || 'Central Lamka'),
            totalSeats: Number(row.total_seats || 4),
            withDriver: row.with_driver !== false,
            bookingMode: String(row.booking_mode || 'full_vehicle'),
            rateDailyInr:
              row.rate_daily_inr != null ? Number(row.rate_daily_inr) : null,
            rateHourlyInr:
              row.rate_hourly_inr != null ? Number(row.rate_hourly_inr) : null,
            ratePerKmInr:
              row.rate_per_km_inr != null ? Number(row.rate_per_km_inr) : null,
            firstFixedRouteFare: firstFare,
            thumbnailUrl: resolveRemoteMediaUrl(
              typeof row.thumbnail_url === 'string' ? row.thumbnail_url : ''
            ),
            features: Array.isArray(row.features)
              ? (row.features as unknown[]).filter(
                  (f): f is string => typeof f === 'string'
                )
              : [],
          });
        }
      }
      setVehicles(hydratedVehicles);

      // Map Orders
      if (Array.isArray(ordersRes.data)) {
        setOrders(ordersRes.data as DeliveryOrderRecord[]);
      } else {
        setOrders([]);
      }

      // Map Scheduled Vehicle Bookings
      if (Array.isArray(vehicleBookingsRes.data)) {
        const mappedBookings: HydratedVehicleBooking[] = (
          vehicleBookingsRes.data as Array<
            VehicleBookingRecord & {
              vehicle_listings?:
                | { id?: string; title?: string; stand_locality?: string }
                | Array<{ id?: string; title?: string; stand_locality?: string }>
                | null;
            }
          >
        ).map((bk) => {
          const vl = Array.isArray(bk.vehicle_listings)
            ? bk.vehicle_listings[0]
            : bk.vehicle_listings;
          return {
            ...bk,
            total_fare_inr: Number(bk.total_fare_inr || 0),
            advance_amount_inr: Number(bk.advance_amount_inr || 0),
            balance_due_inr: Number(bk.balance_due_inr || 0),
            vehicleTitle: String(vl?.title || 'Scheduled Vehicle').replace(
              /^\[SAMPLE\]\s*/i,
              ''
            ),
            standLocality: String(vl?.stand_locality || 'Churachandpur'),
          };
        });
        setVehicleBookings(mappedBookings);
      } else {
        setVehicleBookings([]);
      }
    } finally {
      setIsHydrating(false);
    }
  }, [
    listings,
    savedListingIdList,
    savedProductIds,
    savedBulletinIds,
    savedVehicleIds,
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
    vehicleIdsKey,
    followsKey,
    activeUserId,
    hydrateHubData,
  ]);

  // Compute live matching counts for Interests (localities & categories)
  useEffect(() => {
    let active = true;

    async function loadInterestCounts() {
      const counts: Record<string, number> = {};

      // Local baseline from store listings across dynamic localities & categories
      for (const loc of dynamicLocalities) {
        const needle = loc.value.toLowerCase();
        counts[`locality:${loc.value}`] = listings.filter(
          (l) =>
            l.locality?.toLowerCase().includes(needle) ||
            l.address?.toLowerCase().includes(needle)
        ).length;
      }

      for (const cat of dynamicCategories) {
        const needle = cat.slug.toLowerCase();
        counts[`category:${cat.value}`] = listings.filter(
          (l) =>
            l.category?.toLowerCase() === needle ||
            l.category?.toLowerCase().includes(needle) ||
            formatCategoryLabel(l.category).toLowerCase() ===
              cat.value.toLowerCase()
        ).length;
      }

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
            counts['category:Jobs & Careers'] = jobsRes.count;
          }
          if (typeof eventsRes.count === 'number') {
            counts['category:Events'] = eventsRes.count;
            counts['category:Events & Gatherings'] = eventsRes.count;
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
  }, [listings, dynamicLocalities, dynamicCategories]);

  // Resolved Places list combining store + remote hydrated cards
  const resolvedPlaces = useMemo<HydratedPlaceCard[]>(() => {
    const storeById = new Map(listings.map((l) => [l.id, l]));
    const cards: HydratedPlaceCard[] = [];
    for (const id of savedListingIdList) {
      const storeItem = storeById.get(id);
      if (storeItem) {
        cards.push({
          id: storeItem.id,
          hubId: storeItem.hub_id || null,
          title: storeItem.title,
          category: storeItem.category,
          locality: storeItem.locality,
          lat: storeItem.coordinates?.lat ?? null,
          lng: storeItem.coordinates?.lng ?? null,
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

  // Filtered views based on All Hubs vs Active Hub Only
  const matchesHubFilter = useCallback(
    (itemHubId?: string | null) => {
      if (hubFilterMode === 'all' || !activeHubId) return true;
      return !itemHubId || itemHubId === activeHubId;
    },
    [hubFilterMode, activeHubId]
  );

  const visiblePlaces = useMemo(
    () => resolvedPlaces.filter((p) => matchesHubFilter(p.hubId)),
    [resolvedPlaces, matchesHubFilter]
  );
  const visibleProducts = useMemo(
    () => products.filter((p) => matchesHubFilter(p.hubId)),
    [products, matchesHubFilter]
  );
  const visibleBulletins = useMemo(
    () => bulletins.filter((b) => matchesHubFilter(b.hubId)),
    [bulletins, matchesHubFilter]
  );
  const visibleVehicles = useMemo(
    () => vehicles.filter((v) => matchesHubFilter(v.hubId)),
    [vehicles, matchesHubFilter]
  );
  const visibleFollowCards = useMemo(
    () => followCards.filter((f) => matchesHubFilter(f.hubId)),
    [followCards, matchesHubFilter]
  );
  const visibleOrders = useMemo(
    () => orders.filter((o) => matchesHubFilter(o.hub_id)),
    [orders, matchesHubFilter]
  );
  const visibleVehicleBookings = useMemo(
    () => vehicleBookings.filter((bk) => matchesHubFilter(bk.hub_id)),
    [vehicleBookings, matchesHubFilter]
  );

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

  const totalTripsCount = visibleOrders.length + visibleVehicleBookings.length;

  const tabs: Array<{
    id: SavedHubTab;
    label: string;
    count: number;
    icon: React.ComponentType<{ className?: string }>;
  }> = [
    { id: 'places', label: 'Places', count: visiblePlaces.length, icon: MapPin },
    { id: 'products', label: 'Products', count: visibleProducts.length, icon: ShoppingBag },
    { id: 'vehicles', label: 'Vehicles', count: visibleVehicles.length, icon: Car },
    { id: 'bulletins', label: 'Bulletins', count: visibleBulletins.length, icon: Megaphone },
    { id: 'following', label: 'Following', count: visibleFollowCards.length, icon: Heart },
    { id: 'trips', label: 'Tracked Trips', count: totalTripsCount, icon: Truck },
    { id: 'interests', label: 'Interests', count: interests.length, icon: Sparkles },
  ];

  const totalSavedItems =
    visiblePlaces.length + visibleProducts.length + visibleBulletins.length + visibleVehicles.length;

  return (
    <div
      data-testid="saved-hub-page"
      className="mx-auto w-full max-w-6xl space-y-5 px-4 sm:px-6 lg:px-8 pt-3 pb-20 landscape:pb-8 lg:pb-10 bg-[var(--ps-bg)] text-[var(--ps-text)]"
    >
      {/* Header */}
      <div className="pb-3 border-b border-[var(--ps-border)]/70 flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1 min-w-0">
          <Breadcrumbs items={[{ label: 'Saved & Interests' }]} />
          <div className="flex flex-wrap items-center gap-2">
            <Bookmark className="h-5 w-5 text-[var(--ps-accent)] shrink-0" />
            <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[var(--ps-text)]">
              Saved &amp; Interests Hub
            </h1>
            <span className="text-xs font-semibold tabular-nums text-[var(--ps-text-muted)]">
              {totalSavedItems} saved · {visibleFollowCards.length} following · {interests.length} tracked
            </span>
          </div>
          <p className="text-xs text-[var(--ps-text-muted)]">
            {isGuest
              ? 'Saved locally on this device. Sign in to sync places, products, bulletins, and trips across devices.'
              : 'Your synchronized places, marketplace items, community bulletins, followed shops, and Pick N Drop trips.'}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {/* Cross-Hub Filter Toggle Pill: All Hubs | Active Hub Only */}
          <div
            data-testid="saved-hub-filter-toggle"
            className="inline-flex h-8 items-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-0.5 text-xs font-semibold"
          >
            <button
              type="button"
              onClick={() => setHubFilterMode('all')}
              className={`h-7 rounded-lg px-2.5 transition-colors ${
                hubFilterMode === 'all'
                  ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-2xs'
                  : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
              }`}
            >
              All Hubs
            </button>
            <button
              type="button"
              onClick={() => setHubFilterMode('active')}
              className={`h-7 rounded-lg px-2.5 transition-colors ${
                hubFilterMode === 'active'
                  ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-2xs'
                  : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
              }`}
            >
              {activeHubName} Only
            </button>
          </div>

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
          {visiblePlaces.length === 0 ? (
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
                  <span>Browse {activeHubName} Map</span>
                </Link>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
              {visiblePlaces.map((item) => {
                const crossHubLabel = resolveCrossHubLabel(item.hubId);
                return (
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
                          {crossHubLabel && (
                            <span className="inline-flex items-center gap-1 rounded-md border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700 dark:text-indigo-300">
                              <MapPin className="h-2.5 w-2.5" />
                              {crossHubLabel}
                            </span>
                          )}
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
                        {activePrintPlaceMap[item.id] && (
                          <div
                            data-testid={`saved-place-print-dot-${item.id}`}
                            className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold text-emerald-700 dark:text-emerald-300"
                          >
                            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                            <span>Accepting Print Orders</span>
                          </div>
                        )}
                        {item.shortDescription && (
                          <p className="line-clamp-2 text-xs leading-relaxed text-[var(--ps-text-muted)]">
                            {item.shortDescription}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--ps-border)]/70 bg-[var(--ps-surface-alt)]/30 px-3.5 py-2.5">
                      <button
                        type="button"
                        onClick={() => void handleRemovePlace(item.id)}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:underline"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span>Remove</span>
                      </button>
                      <div className="flex flex-wrap items-center gap-1.5">
                        {activePrintPlaceMap[item.id] && (
                          <Link
                            href={`/listing/${encodeURIComponent(item.id)}/print`}
                            data-testid={`saved-place-order-print-${item.id}`}
                            className="inline-flex h-8 items-center gap-1 rounded-xl bg-theme-primary px-2.5 text-[11px] font-bold text-[hsl(var(--color-primary-foreground))] shadow-2xs transition-opacity hover:opacity-90"
                          >
                            <Printer className="h-3 w-3" />
                            <span>Order Print</span>
                          </Link>
                        )}
                        <Link
                          href={buildPickNDropHref({
                            label: `${item.title} (${item.locality})`,
                            lat: item.lat,
                            lng: item.lng,
                            hubSlug: activeHubSlug,
                          })}
                          className="inline-flex h-8 items-center gap-1 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-2.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20"
                        >
                          <Truck className="h-3 w-3" />
                          <span>Pick N Drop</span>
                        </Link>
                        <button
                          type="button"
                          onClick={() => handleLocateOnMap(item)}
                          className="inline-flex h-8 items-center gap-1 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)]"
                        >
                          <MapPin className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
                          <span>Open on Map</span>
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
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* TAB 2: PRODUCTS */}
      {activeTab === 'products' && (
        <section className="space-y-4">
          {isHydrating && visibleProducts.length === 0 ? (
            <AppBrandLoader
              mode="inline"
              message="Loading saved products…"
              className="min-h-[260px] py-8"
            />
          ) : visibleProducts.length === 0 ? (
            <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-8 text-center space-y-2.5">
              <ShoppingBag className="h-6 w-6 text-[var(--ps-text-muted)] mx-auto" />
              <p className="text-sm font-bold text-[var(--ps-text)]">
                No saved products yet
              </p>
              <p className="text-xs text-[var(--ps-text-muted)] max-w-sm mx-auto">
                Bookmark items across {activeHubName}&apos;s Marketplace to compare prices and message shop owners directly.
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
              {visibleProducts.map((prod) => {
                const crossHubLabel = resolveCrossHubLabel(prod.hubId);
                const waDigits = normalizeWhatsAppPhone(
                  prod.shopPhone || office.whatsapp
                );
                const templateBase = (office.whatsapp_enquiry_template || '').trim();
                const enquiryMsg = templateBase
                  ? `${templateBase} — "${prod.title}" (₹${prod.priceInr}) at ${prod.shopName}`
                  : buildContextualWhatsAppMessage({
                      type: 'listing_enquiry',
                      listingTitle: prod.shopName,
                      locality: prod.shopLocality,
                      customNote: `Saw "${prod.title}" (₹${prod.priceInr}) saved on DD oodle. Is it currently available?`,
                    });
                const waHref = waDigits
                  ? buildWhatsAppUrl(waDigits, enquiryMsg)
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
                          <div className="flex items-center gap-1.5">
                            {crossHubLabel && (
                              <span className="inline-flex items-center gap-1 rounded-md border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700 dark:text-indigo-300">
                                <MapPin className="h-2.5 w-2.5" />
                                {crossHubLabel}
                              </span>
                            )}
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

                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--ps-border)]/70 bg-[var(--ps-surface-alt)]/30 px-3.5 py-2.5">
                      <button
                        type="button"
                        onClick={() => void toggleSave('product', prod.id)}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-rose-600 dark:text-rose-400 hover:underline"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                        <span>Remove</span>
                      </button>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <Link
                          href={buildPickNDropHref({
                            label: `${prod.shopName} — ${prod.title}`,
                            lat: prod.shopLat,
                            lng: prod.shopLng,
                            hubSlug: activeHubSlug,
                          })}
                          className="inline-flex h-8 items-center gap-1 rounded-xl border border-amber-500/30 bg-amber-500/10 px-2.5 text-[11px] font-semibold text-amber-700 dark:text-amber-300 hover:bg-amber-500/20"
                        >
                          <Truck className="h-3 w-3" />
                          <span>Deliver</span>
                        </Link>
                        {waHref && (
                          <a
                            href={waHref}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex h-8 items-center gap-1 rounded-xl bg-emerald-600 hover:bg-emerald-700 px-2.5 text-xs font-semibold text-white transition-colors"
                          >
                            <MessageCircle className="h-3.5 w-3.5" />
                            <span>Enquire</span>
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
          {isHydrating && visibleBulletins.length === 0 ? (
            <AppBrandLoader
              mode="inline"
              message="Loading saved bulletins…"
              className="min-h-[260px] py-8"
            />
          ) : visibleBulletins.length === 0 ? (
            <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-8 text-center space-y-2.5">
              <Megaphone className="h-6 w-6 text-[var(--ps-text-muted)] mx-auto" />
              <p className="text-sm font-bold text-[var(--ps-text)]">
                No saved bulletins yet
              </p>
              <p className="text-xs text-[var(--ps-text-muted)] max-w-sm mx-auto">
                Save local job openings, civic notices, and upcoming {activeHubName} events to read anytime.
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
              {visibleBulletins.map((b) => {
                const crossHubLabel = resolveCrossHubLabel(b.hubId);
                return (
                  <article
                    key={b.id}
                    data-testid={`saved-bulletin-card-${b.id}`}
                    className="flex flex-col justify-between rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3"
                  >
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between gap-2 text-[11px] text-[var(--ps-text-muted)]">
                        <div className="flex items-center gap-1.5">
                          <span className="font-bold uppercase tracking-wide text-[10px] text-[var(--ps-accent)]">
                            {formatCategoryLabel(b.category)}
                          </span>
                          {crossHubLabel && (
                            <span className="inline-flex items-center gap-1 rounded-md border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700 dark:text-indigo-300">
                              <MapPin className="h-2.5 w-2.5" />
                              {crossHubLabel}
                            </span>
                          )}
                        </div>
                        <span className="tabular-nums">
                          {formatExpiryShort(b.expiresAt, nowMs)}
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
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* TAB: SAVED VEHICLES */}
      {activeTab === 'vehicles' && (
        <section className="space-y-4">
          {visibleVehicles.length === 0 ? (
            <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-8 text-center space-y-2.5">
              <Car className="h-6 w-6 text-[var(--ps-text-muted)] mx-auto" />
              <p className="text-sm font-bold text-[var(--ps-text)]">
                No saved vehicles yet
              </p>
              <p className="text-xs text-[var(--ps-text-muted)] max-w-sm mx-auto">
                Bookmark SUVs, Boleros, taxis, or shared vans from Explore to schedule and book them anytime.
              </p>
              <div className="pt-1">
                <Link
                  href="/explore?category=vehicles_rentals"
                  className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3.5 text-xs font-semibold text-[var(--ps-accent-fg)]"
                >
                  <Car className="h-3.5 w-3.5" />
                  <span>Browse Vehicles &amp; Rentals</span>
                </Link>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {visibleVehicles.map((veh) => {
                const crossHubLabel = resolveCrossHubLabel(veh.hubId);
                return (
                  <div
                    key={veh.id}
                    data-testid={`saved-vehicle-card-${veh.id}`}
                    className="overflow-hidden rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] flex flex-col justify-between"
                  >
                    <div>
                      <div className="relative aspect-[16/10] w-full bg-[var(--ps-bg)]">
                        {veh.thumbnailUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img
                            src={veh.thumbnailUrl}
                            alt={veh.title}
                            referrerPolicy="no-referrer"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-gradient-to-br from-slate-900 to-slate-800 text-slate-200">
                            <Car className="h-7 w-7 text-amber-400" />
                            <span className="text-[11px] font-semibold">
                              {veh.standLocality}
                            </span>
                          </div>
                        )}
                        <span className="absolute left-2.5 top-2.5 rounded-md bg-slate-950/80 px-2 py-0.5 text-[10px] font-bold text-white">
                          {veh.withDriver ? 'With Driver' : 'Self-Drive'}
                        </span>
                      </div>

                      <div className="p-3.5 space-y-1.5">
                        <div className="flex items-center justify-between gap-2">
                          <h3 className="text-sm font-bold text-[var(--ps-text)] line-clamp-1">
                            {veh.title}
                          </h3>
                          {crossHubLabel && (
                            <span className="inline-flex shrink-0 items-center gap-1 rounded-md border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700 dark:text-indigo-300">
                              <MapPin className="h-2.5 w-2.5" />
                              {crossHubLabel}
                            </span>
                          )}
                        </div>
                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-[var(--ps-text-muted)]">
                          <span className="inline-flex items-center gap-1">
                            <MapPin className="h-3 w-3 text-[var(--ps-accent)]" />
                            {veh.standLocality}
                          </span>
                          <span>{veh.totalSeats} Seats</span>
                        </div>
                        <p className="text-xs font-extrabold tabular-nums text-[var(--ps-accent)]">
                          {veh.rateDailyInr
                            ? `₹${veh.rateDailyInr.toLocaleString('en-IN')} / day`
                            : veh.rateHourlyInr
                              ? `₹${veh.rateHourlyInr.toLocaleString('en-IN')} / hr`
                              : veh.ratePerKmInr
                                ? `₹${veh.ratePerKmInr.toLocaleString('en-IN')} / km`
                                : veh.firstFixedRouteFare
                                  ? `From ₹${veh.firstFixedRouteFare.toLocaleString('en-IN')} / route`
                                  : 'Fixed Routes Available'}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 border-t border-[var(--ps-border)] px-3.5 py-2.5">
                      <Link
                        href={`/vehicles/${encodeURIComponent(veh.id)}`}
                        className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3 text-xs font-bold text-[var(--ps-accent-fg)] hover:opacity-95"
                      >
                        <span>Schedule &amp; Book</span>
                        <ArrowRight className="h-3.5 w-3.5" />
                      </Link>
                      <button
                        type="button"
                        onClick={() => void toggleSave('vehicle', veh.id)}
                        aria-label={`Remove ${veh.title}`}
                        className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-rose-600 dark:text-rose-400 hover:bg-rose-500/10"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* TAB 4: FOLLOWING */}
      {activeTab === 'following' && (
        <section className="space-y-4">
          {visibleFollowCards.length === 0 ? (
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
              {visibleFollowCards.map((fc) => {
                const crossHubLabel = resolveCrossHubLabel(fc.hubId);
                return (
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
                        <div className="flex items-center gap-1.5">
                          <p className="text-xs font-bold text-[var(--ps-text)] truncate">
                            {fc.name}
                          </p>
                          {crossHubLabel && (
                            <span className="inline-flex shrink-0 items-center gap-0.5 rounded-md border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-0.5 text-[9px] font-bold text-indigo-700 dark:text-indigo-300">
                              <MapPin className="h-2.5 w-2.5" />
                              {crossHubLabel}
                            </span>
                          )}
                        </div>
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
                );
              })}
            </div>
          )}
        </section>
      )}

      {/* TAB 6: TRACKED TRIPS (PICK N DROP ORDERS + SCHEDULED VEHICLE BOOKINGS) */}
      {activeTab === 'trips' && (
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-4 py-3">
            <div>
              <h2 className="text-xs font-bold text-[var(--ps-text)] sm:text-sm">
                Active Trips &amp; Scheduled Bookings ({totalTripsCount})
              </h2>
              <p className="text-[11px] text-[var(--ps-text-muted)]">
                Live Pick N Drop orders and Scheduled Vehicle Bookings with Start/End OTPs.
              </p>
            </div>
            <Link
              href="/activity"
              data-testid="saved-trips-view-full-activity-link"
              className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3 text-xs font-semibold text-[var(--ps-accent-fg)] hover:opacity-95"
            >
              <span>View Full Activity</span>
              <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          </div>

          {!activeUserId ? (
            <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-8 text-center space-y-2.5">
              <Truck className="h-6 w-6 text-[var(--ps-text-muted)] mx-auto" />
              <p className="text-sm font-bold text-[var(--ps-text)]">
                Sign in to view your trips &amp; vehicle bookings
              </p>
              <p className="text-xs text-[var(--ps-text-muted)] max-w-sm mx-auto">
                Your live Pick N Drop orders and Scheduled Vehicle Bookings with OTPs appear here when signed in.
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
          ) : visibleOrders.length === 0 && visibleVehicleBookings.length === 0 ? (
            <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-8 text-center space-y-2.5">
              <Truck className="h-6 w-6 text-[var(--ps-text-muted)] mx-auto" />
              <p className="text-sm font-bold text-[var(--ps-text)]">
                No tracked trips or vehicle bookings yet
              </p>
              <p className="text-xs text-[var(--ps-text-muted)] max-w-sm mx-auto">
                Book a Pick N Drop courier/ride or reserve a local SUV/Bolero from Explore.
              </p>
              <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
                <Link
                  href="/explore?mode=pick_n_drop"
                  className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3.5 text-xs font-semibold text-[var(--ps-accent-fg)]"
                >
                  <Truck className="h-3.5 w-3.5" />
                  <span>Book Pick N Drop</span>
                </Link>
                <Link
                  href="/explore?category=vehicles_rentals"
                  className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 text-xs font-semibold text-[var(--ps-text)]"
                >
                  <Car className="h-3.5 w-3.5" />
                  <span>Browse Vehicles</span>
                </Link>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {/* Scheduled Vehicle Bookings */}
              {visibleVehicleBookings.length > 0 && (
                <div className="space-y-2.5">
                  <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                    <Car className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
                    <span>Scheduled Vehicle Bookings ({visibleVehicleBookings.length})</span>
                  </h3>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {visibleVehicleBookings.map((bk) => {
                      const crossHubLabel = resolveCrossHubLabel(bk.hub_id);
                      return (
                        <div
                          key={bk.id}
                          data-testid={`saved-vehicle-booking-card-${bk.id}`}
                          className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-2.5"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex flex-wrap items-center gap-2 min-w-0">
                              <span className="font-mono text-xs font-bold text-[var(--ps-text)]">
                                {bk.booking_code}
                              </span>
                              <span className="text-[11px] font-semibold text-[var(--ps-text-muted)] truncate">
                                · {bk.booking_mode === 'full_vehicle' ? 'Full Vehicle' : `${bk.seats_booked} Seat(s)`}
                              </span>
                              {crossHubLabel && (
                                <span className="inline-flex items-center gap-1 rounded-md border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700 dark:text-indigo-300">
                                  <MapPin className="h-2.5 w-2.5" />
                                  {crossHubLabel}
                                </span>
                              )}
                            </div>
                            <span className="rounded-md border border-[var(--ps-accent)]/30 bg-[var(--ps-accent)]/10 px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--ps-accent)]">
                              {bk.status.replace(/_/g, ' ')}
                            </span>
                          </div>

                          <div className="space-y-0.5 text-xs">
                            <p className="font-bold text-[var(--ps-text)] truncate">
                              {bk.vehicleTitle}
                            </p>
                            <p className="text-[11px] text-[var(--ps-text-muted)] truncate">
                              {bk.pickup_location}
                              {bk.dropoff_location ? ` → ${bk.dropoff_location}` : ''}
                            </p>
                            <p className="font-mono text-[11px] tabular-nums text-[var(--ps-text-muted)]">
                              {new Date(bk.start_time).toLocaleString('en-IN', {
                                day: '2-digit',
                                month: 'short',
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </p>
                          </div>

                          {(bk.start_otp || bk.end_otp) && (
                            <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 py-1.5 text-[11px]">
                              {bk.start_otp && (
                                <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                                  Start OTP: {bk.start_otp}
                                </span>
                              )}
                              {bk.end_otp && (
                                <span className="font-mono font-bold text-amber-600 dark:text-amber-400">
                                  End OTP: {bk.end_otp}
                                </span>
                              )}
                            </div>
                          )}

                          <div className="flex items-center justify-between gap-2 border-t border-[var(--ps-border)]/70 pt-2.5">
                            <div className="text-xs font-extrabold tabular-nums text-[var(--ps-text)]">
                              ₹{bk.total_fare_inr.toLocaleString('en-IN')}
                              <span className="ml-1.5 text-[11px] font-normal text-[var(--ps-text-muted)]">
                                Adv ₹{bk.advance_amount_inr.toLocaleString('en-IN')}
                              </span>
                            </div>
                            <div className="flex items-center gap-1.5">
                              <Link
                                href={`/vehicles/${encodeURIComponent(bk.vehicle_listing_id)}`}
                                className="inline-flex h-8 items-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-xs font-semibold text-[var(--ps-text)]"
                              >
                                Vehicle
                              </Link>
                              <Link
                                href="/activity?tab=vehicles"
                                className="inline-flex h-8 items-center gap-1 rounded-xl bg-[var(--ps-accent)] px-3 text-xs font-semibold text-[var(--ps-accent-fg)]"
                              >
                                <span>Manage</span>
                                <ArrowRight className="h-3 w-3" />
                              </Link>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Pick N Drop Orders */}
              {visibleOrders.length > 0 && (
                <div className="space-y-2.5">
                  <h3 className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                    <Truck className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
                    <span>Pick N Drop Orders ({visibleOrders.length})</span>
                  </h3>
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                    {visibleOrders.map((order) => {
                      const crossHubLabel = resolveCrossHubLabel(order.hub_id);
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
                            <div className="flex flex-wrap items-center gap-2">
                              <span className="font-mono text-xs font-bold text-[var(--ps-text)]">
                                {order.order_code}
                              </span>
                              <span className="text-[11px] font-semibold text-[var(--ps-text-muted)]">
                                · {modeLabel} ·{' '}
                                {order.trip_type === 'two_way'
                                  ? 'Two-Way'
                                  : 'One-Way'}
                              </span>
                              {crossHubLabel && (
                                <span className="inline-flex items-center gap-1 rounded-md border border-indigo-500/30 bg-indigo-500/10 px-1.5 py-0.5 text-[10px] font-bold text-indigo-700 dark:text-indigo-300">
                                  <MapPin className="h-2.5 w-2.5" />
                                  {crossHubLabel}
                                </span>
                              )}
                            </div>
                            <span
                              className={`rounded-md border px-2 py-0.5 text-[10px] font-bold ${statusMeta.badgeClass}`}
                            >
                              {statusMeta.label}
                            </span>
                          </div>

                          <div className="space-y-1 text-xs text-[var(--ps-text-muted)]">
                            <p className="truncate">
                              <strong className="text-[var(--ps-text)]">
                                From:
                              </strong>{' '}
                              {order.pickup_address}
                            </p>
                            <p className="truncate">
                              <strong className="text-[var(--ps-text)]">
                                To:
                              </strong>{' '}
                              {order.dropoff_address}
                            </p>
                          </div>

                          <div className="flex items-center justify-between gap-2 border-t border-[var(--ps-border)]/70 pt-2.5">
                            <div className="text-xs font-extrabold tabular-nums text-[var(--ps-text)]">
                              ₹
                              {Number(order.quoted_fare_inr || 0).toLocaleString(
                                'en-IN'
                              )}
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
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* TAB 7: INTERESTS */}
      {activeTab === 'interests' && (
        <section className="space-y-5">
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {/* Localities */}
            <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3">
              <div>
                <h2 className="text-sm font-bold text-[var(--ps-text)]">
                  {activeHubName} Localities
                </h2>
                <p className="text-xs text-[var(--ps-text-muted)]">
                  Tap neighborhoods you care about for quick one-tap map filtering.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {dynamicLocalities.map((loc) => {
                  const active = hasInterest('locality', loc.value);
                  const count = interestCounts[`locality:${loc.value}`] ?? 0;
                  return (
                    <button
                      key={loc.slug}
                      type="button"
                      onClick={() =>
                        void toggleInterest('locality', loc.value, {
                          hubId: activeHubId,
                          localityId: loc.id,
                        })
                      }
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
                  Track categories across Listings, Marketplace, and Bulletin in {activeHubName}.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                {dynamicCategories.map((cat) => {
                  const active = hasInterest('category', cat.value);
                  const count = interestCounts[`category:${cat.value}`] ?? 0;
                  return (
                    <button
                      key={`${cat.module}:${cat.slug}`}
                      type="button"
                      onClick={() =>
                        void toggleInterest('category', cat.value, {
                          hubId: activeHubId,
                          categoryId: cat.id,
                        })
                      }
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
                  const locMeta = dynamicLocalities.find(
                    (l) =>
                      l.value.toLowerCase() ===
                      item.interest_value.trim().toLowerCase()
                  );
                  const catMeta = dynamicCategories.find(
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
                    {formatExpiryShort(selectedBulletin.expiresAt, nowMs)}
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
                      href={buildContextualWhatsAppUrl(
                        selectedBulletin.contactChannels.whatsapp,
                        {
                          type: 'listing_enquiry',
                          listingTitle: selectedBulletin.title,
                          customNote:
                            'Reaching out regarding your community bulletin on DD oodle.',
                        }
                      )}
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
