'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  DragOverlay,
  closestCenter,
  closestCorners,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  horizontalListSortingStrategy,
  rectSortingStrategy,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable';
import {
  ArrowRight,
  Bike,
  Car,
  Check,
  ChevronDown,
  ChevronUp,
  Edit3,
  ExternalLink,
  Eye,
  EyeOff,
  FolderKanban,
  Layers,
  LayoutGrid,
  Loader2,
  MapPin,
  Pin,
  PinOff,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Sparkles,
  Star,
  Trash2,
  Truck,
  Undo2,
  X,
} from 'lucide-react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase/client';
import { getIconByKey, normalizeIconKey } from '@/lib/icons/registry';
import { useConfirmDialogState } from '@/components/ui/ConfirmDialog';
import { notifyAppConfigUpdated } from '@/components/providers/AppConfigProvider';
import {
  DragHandleButton,
  DroppableContainerZone,
  MobileOrderButtons,
  SortablePreviewItem,
  useTouchSafeSensors,
} from '@/components/ui/SortablePreview';
import type { LiveCategoryHintItem } from '@/components/ui/AttributeHintsPopover';
import {
  DEFAULT_HOMEPAGE_BANNERS,
  DEFAULT_HOMEPAGE_CONTAINERS,
  DEFAULT_HOMEPAGE_QUICK_JUMPS,
  DEFAULT_HOMEPAGE_SHORTCUTS,
  buildPopularLocalityExploreHref,
  inferDefaultContainerSlugForItem,
  normalizeContainerStyle,
  normalizeQueryParamsRecord,
  resolveHomepageItemHref,
  type HomepageContainerGroup,
  type HomepageContainerRecord,
  type HomepageItemRecord,
  type HomepageSection,
  type PopularLocalityRecord,
} from '@/lib/home/homepage-config';
import {
  ContainerFormModal,
  HomepageItemFormModal,
  LocalityFormModal,
  PinListingFormModal,
  VehicleRateFormModal,
  slugifyValue,
  type FeaturedListingRow,
  type HomepageContainerDraft,
  type HomepageItemDraft,
  type LocalityDraft,
  type VehicleRateDraft,
  type VehicleTypeRateRow,
} from '@/components/workspaces/superadmin/HomepageBuilderModals';

type BuilderTab = 'shortcuts' | 'featured' | 'localities' | 'pnd_rates';

interface HomepageBuilderProps {
  onNotice?: (notice: { type: 'success' | 'error'; text: string } | null) => void;
}

const UNASSIGNED_ZONE_ID = 'container:unassigned';
const containerZoneId = (containerId: string) => `container:${containerId}`;
const parseContainerZoneId = (id: string): string | null =>
  id.startsWith('container:') ? id.slice('container:'.length) : null;

function renderTierIcon(slug: string) {
  const s = slug.toLowerCase();
  if (s.includes('scooty') || s.includes('bike') || s.includes('cycle')) {
    return <Bike className="h-4 w-4" aria-hidden="true" />;
  }
  if (s.includes('pickup') || s.includes('bolero') || s.includes('van')) {
    return <Truck className="h-4 w-4" aria-hidden="true" />;
  }
  return <Car className="h-4 w-4" aria-hidden="true" />;
}

// =============================================================================
// PHASE 10 SKELETAL SHIMMER LOADERS
// =============================================================================
function BuilderPreviewSkeleton({ tab }: { tab: BuilderTab }) {
  if (tab === 'shortcuts') {
    return (
      <div className="space-y-4" aria-busy="true" aria-label="Loading homepage shortcuts">
        <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3">
          <div className="h-4 w-48 rounded-lg dd-shimmer" />
          <div className="flex flex-wrap gap-2">
            {[1, 2, 3, 4, 5].map((i) => (
              <div key={i} className="h-11 w-36 rounded-full dd-shimmer" />
            ))}
          </div>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {[1, 2].map((zone) => (
            <div
              key={zone}
              className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3"
            >
              <div className="h-5 w-40 rounded-lg dd-shimmer" />
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                {[1, 2, 3, 4].map((card) => (
                  <div key={card} className="h-28 rounded-2xl dd-shimmer" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (tab === 'featured') {
    return (
      <div className="space-y-4" aria-busy="true">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {[1, 2].map((i) => (
            <div key={i} className="h-24 rounded-2xl dd-shimmer" />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 rounded-2xl dd-shimmer" />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-busy="true">
      {[1, 2, 3, 4, 5, 6].map((i) => (
        <div key={i} className="h-32 rounded-2xl dd-shimmer" />
      ))}
    </div>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================
export function HomepageBuilder({ onNotice }: HomepageBuilderProps) {
  const { confirm, dialog } = useConfirmDialogState();
  const sensors = useTouchSafeSensors();

  const [activeTab, setActiveTab] = useState<BuilderTab>('shortcuts');

  // Persisted DB state
  const [dbContainers, setDbContainers] = useState<HomepageContainerRecord[]>([]);
  const [containersTableMissing, setContainersTableMissing] = useState(false);
  const [dbItems, setDbItems] = useState<HomepageItemRecord[]>([]);
  const [dbListings, setDbListings] = useState<FeaturedListingRow[]>([]);
  const [dbLocalities, setDbLocalities] = useState<PopularLocalityRecord[]>([]);
  const [vehicleRates, setVehicleRates] = useState<VehicleTypeRateRow[]>([]);
  const [vehicleSortOrderMissing, setVehicleSortOrderMissing] = useState(false);
  const [liveCategories, setLiveCategories] = useState<LiveCategoryHintItem[]>([]);

  // Local draft order state (for batched drag-and-drop reordering)
  const [draftContainers, setDraftContainers] = useState<HomepageContainerRecord[]>([]);
  const [draftItems, setDraftItems] = useState<HomepageItemRecord[]>([]);
  const [draftPinnedOrderIds, setDraftPinnedOrderIds] = useState<string[]>([]);
  const [draftLocalities, setDraftLocalities] = useState<PopularLocalityRecord[]>([]);
  const [draftVehicleRates, setDraftVehicleRates] = useState<VehicleTypeRateRow[]>([]);

  // Loading & busy flags
  const [loadingContainers, setLoadingContainers] = useState(true);
  const [loadingItems, setLoadingItems] = useState(true);
  const [loadingListings, setLoadingListings] = useState(true);
  const [loadingLocalities, setLoadingLocalities] = useState(true);
  const [loadingRates, setLoadingRates] = useState(true);
  const [savingModal, setSavingModal] = useState(false);
  const [savingBatchOrder, setSavingBatchOrder] = useState(false);
  const [revalidating, setRevalidating] = useState(false);
  const [lastRevalidatedAt, setLastRevalidatedAt] = useState<string | null>(null);
  const [localBanner, setLocalBanner] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

  // Modal states (Modal-Only editing — zero inline forms)
  const [containerModalDraft, setContainerModalDraft] =
    useState<HomepageContainerDraft | null>(null);
  const [containerModalSeq, setContainerModalSeq] = useState(0);
  const [itemModalDraft, setItemModalDraft] = useState<HomepageItemDraft | null>(null);
  const [itemModalSeq, setItemModalSeq] = useState(0);
  const [pinModalOpen, setPinModalOpen] = useState(false);
  const [localityModalDraft, setLocalityModalDraft] = useState<LocalityDraft | null>(null);
  const [localityModalSeq, setLocalityModalSeq] = useState(0);
  const [rateModalDraft, setRateModalDraft] = useState<VehicleRateDraft | null>(null);
  const [rateModalSeq, setRateModalSeq] = useState(0);

  // Responsive container UX state (mobile filter + tablet/desktop collapse)
  const [mobileContainerFilter, setMobileContainerFilter] = useState<string>('all');
  const [collapsedZones, setCollapsedZones] = useState<Record<string, boolean>>({});

  // Active dragged item for DragOverlay
  const [activeShortcutDragId, setActiveShortcutDragId] = useState<string | null>(null);

  const emitNotice = useCallback(
    (type: 'success' | 'error', text: string) => {
      setLocalBanner({ type, text });
      onNotice?.({ type, text });
    },
    [onNotice]
  );

  const triggerHomepageRevalidation = useCallback(async () => {
    setRevalidating(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const accessToken = session?.access_token;
      if (!accessToken) return;

      const res = await fetch('/api/admin/revalidate-homepage', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
      });
      if (res.ok) {
        const json = (await res.json().catch(() => ({}))) as {
          revalidatedAt?: string;
        };
        setLastRevalidatedAt(json.revalidatedAt || new Date().toISOString());
        notifyAppConfigUpdated();
      }
    } catch {
      // Non-fatal: DB write already succeeded
    } finally {
      setRevalidating(false);
    }
  }, []);

  // ===========================================================================
  // DATA LOADERS
  // ===========================================================================
  const loadContainers = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setLoadingContainers(false);
      return;
    }
    setLoadingContainers(true);
    try {
      const { data, error } = await supabase
        .from('homepage_containers')
        .select('*')
        .order('section_group', { ascending: true })
        .order('sort_order', { ascending: true });

      if (error) {
        // Graceful fallback before Pass v15d SQL migration is executed
        setContainersTableMissing(true);
        setDbContainers(DEFAULT_HOMEPAGE_CONTAINERS);
        setDraftContainers(DEFAULT_HOMEPAGE_CONTAINERS);
        return;
      }

      setContainersTableMissing(false);
      const rows: HomepageContainerRecord[] = (
        (data || []) as Array<Record<string, unknown>>
      ).map((r) => ({
        id: String(r.id),
        slug: String(r.slug || ''),
        title: String(r.title || ''),
        subtitle: r.subtitle ? String(r.subtitle) : null,
        icon_key: normalizeIconKey(String(r.icon_key || 'layout-grid')),
        accent_color: String(r.accent_color || '#2563EB'),
        section_group: (r.section_group === 'quick_jump'
          ? 'quick_jump'
          : 'shortcut_grid') as HomepageContainerGroup,
        sort_order: Number(r.sort_order ?? 0),
        is_enabled: Boolean(r.is_enabled ?? true),
        updated_at: r.updated_at ? String(r.updated_at) : null,
      }));
      setDbContainers(rows);
      setDraftContainers(rows);
    } catch {
      setContainersTableMissing(true);
      setDbContainers(DEFAULT_HOMEPAGE_CONTAINERS);
      setDraftContainers(DEFAULT_HOMEPAGE_CONTAINERS);
    } finally {
      setLoadingContainers(false);
    }
  }, []);

  const loadHomepageItems = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setLoadingItems(false);
      return;
    }
    setLoadingItems(true);
    try {
      const { data, error } = await supabase
        .from('homepage_items')
        .select('*')
        .order('section', { ascending: true })
        .order('sort_order', { ascending: true });

      if (error) throw error;
      const rows: HomepageItemRecord[] = (
        (data || []) as Array<Record<string, unknown>>
      ).map((r) => ({
        id: String(r.id),
        item_key: r.item_key ? String(r.item_key) : null,
        container_id: r.container_id ? String(r.container_id) : null,
        section: (r.section === 'quick_jump' || r.section === 'featured_banner'
          ? r.section
          : 'shortcut_grid') as HomepageSection,
        title: String(r.title || ''),
        subtitle: r.subtitle ? String(r.subtitle) : null,
        container_style: normalizeContainerStyle(
          r.container_style,
          r.section === 'quick_jump'
            ? 'pill'
            : r.section === 'featured_banner'
              ? 'banner'
              : 'card'
        ),
        icon_key: normalizeIconKey(String(r.icon_key || 'tag')),
        accent_color: String(r.accent_color || '#2563EB'),
        route_key: String(r.route_key || 'explore'),
        query_params: normalizeQueryParamsRecord(r.query_params),
        sort_order: Number(r.sort_order ?? 0),
        is_enabled: Boolean(r.is_enabled ?? true),
        updated_at: r.updated_at ? String(r.updated_at) : null,
      }));
      setDbItems(rows);
      setDraftItems(rows);
    } catch (err) {
      emitNotice(
        'error',
        err instanceof Error ? err.message : 'Failed to load homepage items.'
      );
    } finally {
      setLoadingItems(false);
    }
  }, [emitNotice]);

  const loadListings = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setLoadingListings(false);
      return;
    }
    setLoadingListings(true);
    try {
      const { data, error } = await supabase
        .from('listings')
        .select(
          'id, title, category, locality, rating, status, is_featured, featured_order'
        )
        .eq('status', 'published')
        .order('is_featured', { ascending: false })
        .order('featured_order', { ascending: true })
        .order('rating', { ascending: false })
        .limit(120);

      let mapped: FeaturedListingRow[] = [];
      if (error) {
        const fallback = await supabase
          .from('listings')
          .select('id, title, category, locality, rating, status')
          .eq('status', 'published')
          .order('rating', { ascending: false })
          .limit(80);
        if (fallback.error) throw fallback.error;
        mapped = ((fallback.data || []) as Array<Record<string, unknown>>).map(
          (r) => ({
            id: String(r.id),
            title: String(r.title || 'Untitled'),
            category: String(r.category || 'business'),
            locality: String(r.locality || 'Lamka'),
            rating: Number(r.rating ?? 4.5),
            status: String(r.status || 'published'),
            is_featured: false,
            featured_order: 0,
          })
        );
      } else {
        mapped = ((data || []) as Array<Record<string, unknown>>).map((r) => ({
          id: String(r.id),
          title: String(r.title || 'Untitled'),
          category: String(r.category || 'business'),
          locality: String(r.locality || 'Lamka'),
          rating: Number(r.rating ?? 4.5),
          status: String(r.status || 'published'),
          is_featured: Boolean(r.is_featured ?? false),
          featured_order: Number(r.featured_order ?? 0),
        }));
      }

      setDbListings(mapped);
      const pinned = mapped
        .filter((l) => l.is_featured || l.featured_order > 0)
        .sort((a, b) => {
          const ao = a.featured_order > 0 ? a.featured_order : 9999;
          const bo = b.featured_order > 0 ? b.featured_order : 9999;
          return ao - bo || b.rating - a.rating;
        });
      setDraftPinnedOrderIds(pinned.map((l) => l.id));
    } catch (err) {
      emitNotice(
        'error',
        err instanceof Error ? err.message : 'Failed to load verified listings.'
      );
    } finally {
      setLoadingListings(false);
    }
  }, [emitNotice]);

  const loadLocalities = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setLoadingLocalities(false);
      return;
    }
    setLoadingLocalities(true);
    try {
      const { data, error } = await supabase
        .from('popular_localities')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });
      if (error) throw error;
      const rows: PopularLocalityRecord[] = (
        (data || []) as Array<Record<string, unknown>>
      ).map((r) => ({
        id: String(r.id),
        name: String(r.name || ''),
        slug: String(r.slug || ''),
        icon_key: normalizeIconKey(String(r.icon_key || 'map-pin')),
        lat: Number(r.lat ?? 24.3335),
        lng: Number(r.lng ?? 93.6946),
        default_zoom: Number(r.default_zoom ?? 15),
        sort_order: Number(r.sort_order ?? 0),
        is_enabled: Boolean(r.is_enabled ?? true),
      }));
      setDbLocalities(rows);
      setDraftLocalities(rows);
    } catch (err) {
      emitNotice(
        'error',
        err instanceof Error ? err.message : 'Failed to load popular localities.'
      );
    } finally {
      setLoadingLocalities(false);
    }
  }, [emitNotice]);

  const loadVehicleRates = useCallback(async () => {
    if (!isSupabaseConfigured()) {
      setLoadingRates(false);
      return;
    }
    setLoadingRates(true);
    try {
      const withSort = await supabase
        .from('vehicle_types')
        .select(
          'id, slug, name, icon, base_fare_inr, per_km_rate_inr, two_way_multiplier, max_weight_kg, max_dimensions, supported_modes, sort_order, is_active'
        )
        .order('sort_order', { ascending: true })
        .order('base_fare_inr', { ascending: true });

      let rawData: Array<Record<string, unknown>> = [];
      if (!withSort.error && Array.isArray(withSort.data)) {
        setVehicleSortOrderMissing(false);
        rawData = withSort.data as Array<Record<string, unknown>>;
      } else {
        setVehicleSortOrderMissing(true);
        const fallback = await supabase
          .from('vehicle_types')
          .select(
            'id, slug, name, icon, base_fare_inr, per_km_rate_inr, two_way_multiplier, max_weight_kg, max_dimensions, supported_modes, is_active'
          )
          .order('base_fare_inr', { ascending: true });
        if (fallback.error) throw fallback.error;
        rawData = (fallback.data || []) as Array<Record<string, unknown>>;
      }

      const rows: VehicleTypeRateRow[] = rawData.map((r, idx) => ({
        id: String(r.id),
        slug: String(r.slug || ''),
        name: String(r.name || ''),
        icon: r.icon ? String(r.icon) : null,
        base_fare_inr: Number(r.base_fare_inr ?? 0),
        per_km_rate_inr: Number(r.per_km_rate_inr ?? 0),
        two_way_multiplier: Number(r.two_way_multiplier ?? 1.7),
        max_weight_kg: Number(r.max_weight_kg ?? 0),
        max_dimensions: r.max_dimensions ? String(r.max_dimensions) : null,
        supported_modes: Array.isArray(r.supported_modes)
          ? r.supported_modes.map(String)
          : ['parcel', 'passenger', 'gas'],
        sort_order:
          typeof r.sort_order === 'number' && r.sort_order > 0
            ? r.sort_order
            : (idx + 1) * 10,
        is_active: Boolean(r.is_active ?? true),
      }));
      setVehicleRates(rows);
      setDraftVehicleRates(rows);
    } catch (err) {
      emitNotice(
        'error',
        err instanceof Error
          ? err.message
          : 'Failed to load Pick N Drop fleet rates.'
      );
    } finally {
      setLoadingRates(false);
    }
  }, [emitNotice]);

  const loadLiveCategories = useCallback(async () => {
    if (!isSupabaseConfigured()) return;
    try {
      const { data, error } = await supabase
        .from('categories')
        .select('*')
        .eq('is_active', true)
        .order('sort_order', { ascending: true })
        .limit(250);
      if (!error && Array.isArray(data)) {
        const rows = data as Array<Record<string, unknown>>;
        const byId = new Map<string, Record<string, unknown>>();
        for (const r of rows) {
          if (r.id) byId.set(String(r.id), r);
        }
        setLiveCategories(
          rows.map((r) => {
            const id = String(r.id || '');
            const slug = String(r.slug || '');
            const name = String(r.display_name || r.name || slug);
            const parentId = r.parent_id ? String(r.parent_id) : null;
            const rootKey = r.root_key ? String(r.root_key) : null;
            const depth =
              typeof r.depth === 'number'
                ? r.depth >= 1
                  ? r.depth
                  : r.depth + 1
                : parentId
                  ? 2
                  : 1;
            const parentRow = parentId ? byId.get(parentId) : undefined;
            const parentName = parentRow
              ? String(parentRow.display_name || parentRow.name || '')
              : '';
            return {
              id,
              slug,
              name,
              parent_id: parentId,
              root_key: rootKey,
              depth,
              pathLabel: parentName ? `${parentName} › ${name}` : name,
            };
          })
        );
      }
    } catch {
      // Non-blocking
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void loadContainers();
      void loadHomepageItems();
      void loadListings();
      void loadLocalities();
      void loadVehicleRates();
      void loadLiveCategories();
    });
  }, [
    loadContainers,
    loadHomepageItems,
    loadListings,
    loadLocalities,
    loadVehicleRates,
    loadLiveCategories,
  ]);

  // ===========================================================================
  // DERIVED LISTS & DIRTY SEQUENCE CHANGE DETECTION
  // ===========================================================================
  const shortcutContainers = useMemo(
    () =>
      draftContainers
        .filter(
          (c) => c.section_group === 'shortcut_grid' && c.slug !== 'all-services'
        )
        .sort((a, b) => a.sort_order - b.sort_order),
    [draftContainers]
  );

  const containerById = useMemo(() => {
    const map = new Map<string, HomepageContainerRecord>();
    for (const c of draftContainers) map.set(c.id, c);
    return map;
  }, [draftContainers]);

  const containerIdBySlug = useMemo(() => {
    const map = new Map<string, string>();
    for (const c of draftContainers) map.set(c.slug, c.id);
    return map;
  }, [draftContainers]);

  const resolveEffectiveContainerId = useCallback(
    (item: HomepageItemRecord): string => {
      if (item.container_id) {
        const matched = containerById.get(item.container_id);
        if (matched && matched.slug !== 'all-services') {
          return matched.id;
        }
      }
      const inferredSlug = inferDefaultContainerSlugForItem(item);
      const inferredId = containerIdBySlug.get(inferredSlug);
      if (inferredId && inferredSlug !== 'all-services') return inferredId;
      return UNASSIGNED_ZONE_ID;
    },
    [containerById, containerIdBySlug]
  );

  const shortcutItems = useMemo(
    () =>
      draftItems
        .filter((i) => i.section === 'shortcut_grid')
        .sort((a, b) => a.sort_order - b.sort_order),
    [draftItems]
  );

  const quickJumpItems = useMemo(
    () =>
      draftItems
        .filter((i) => i.section === 'quick_jump')
        .sort((a, b) => a.sort_order - b.sort_order),
    [draftItems]
  );

  const bannerItems = useMemo(
    () =>
      draftItems
        .filter((i) => i.section === 'featured_banner')
        .sort((a, b) => a.sort_order - b.sort_order),
    [draftItems]
  );

  const shortcutItemsByContainer = useMemo(() => {
    const map = new Map<string, HomepageItemRecord[]>();
    for (const c of shortcutContainers) {
      map.set(c.id, []);
    }
    map.set(UNASSIGNED_ZONE_ID, []);

    for (const item of shortcutItems) {
      const targetId = resolveEffectiveContainerId(item);
      const bucket = map.get(targetId) ?? map.get(UNASSIGNED_ZONE_ID)!;
      bucket.push(item);
    }
    return map;
  }, [shortcutContainers, shortcutItems, resolveEffectiveContainerId]);

  const listingById = useMemo(() => {
    const map = new Map<string, FeaturedListingRow>();
    for (const l of dbListings) map.set(l.id, l);
    return map;
  }, [dbListings]);

  const orderedPinnedListings = useMemo(
    () =>
      draftPinnedOrderIds
        .map((id) => listingById.get(id))
        .filter((l): l is FeaturedListingRow => Boolean(l)),
    [draftPinnedOrderIds, listingById]
  );

  const unpinnedListings = useMemo(
    () => dbListings.filter((l) => !l.is_featured && l.featured_order === 0),
    [dbListings]
  );

  const sortedLocalities = useMemo(
    () => [...draftLocalities].sort((a, b) => a.sort_order - b.sort_order),
    [draftLocalities]
  );

  // Detect unsaved sequence/container diffs for Batched Save Bar
  const pendingSequenceDiff = useMemo(() => {
    const changedContainers: Array<{ id: string; sort_order: number }> = [];
    if (!containersTableMissing) {
      const dbMap = new Map(dbContainers.map((c) => [c.id, c]));
      for (const c of draftContainers) {
        const orig = dbMap.get(c.id);
        if (orig && orig.sort_order !== c.sort_order) {
          changedContainers.push({ id: c.id, sort_order: c.sort_order });
        }
      }
    }

    const changedItems: Array<{
      id: string;
      sort_order: number;
      container_id: string | null;
    }> = [];
    const dbItemMap = new Map(dbItems.map((i) => [i.id, i]));
    for (const item of draftItems) {
      const orig = dbItemMap.get(item.id);
      if (
        orig &&
        (orig.sort_order !== item.sort_order ||
          (orig.container_id || null) !== (item.container_id || null))
      ) {
        changedItems.push({
          id: item.id,
          sort_order: item.sort_order,
          container_id: item.container_id || null,
        });
      }
    }

    const changedPinned: Array<{ id: string; featured_order: number }> = [];
    const dbPinnedIds = dbListings
      .filter((l) => l.is_featured || l.featured_order > 0)
      .sort((a, b) => {
        const ao = a.featured_order > 0 ? a.featured_order : 9999;
        const bo = b.featured_order > 0 ? b.featured_order : 9999;
        return ao - bo || b.rating - a.rating;
      })
      .map((l) => l.id);

    if (
      dbPinnedIds.length === draftPinnedOrderIds.length &&
      dbPinnedIds.some((id, idx) => id !== draftPinnedOrderIds[idx])
    ) {
      draftPinnedOrderIds.forEach((id, idx) => {
        changedPinned.push({ id, featured_order: (idx + 1) * 10 });
      });
    }

    const changedLocalities: Array<{ id: string; sort_order: number }> = [];
    const dbLocMap = new Map(dbLocalities.map((l) => [l.id, l]));
    for (const loc of draftLocalities) {
      const orig = dbLocMap.get(loc.id);
      if (orig && orig.sort_order !== loc.sort_order) {
        changedLocalities.push({ id: loc.id, sort_order: loc.sort_order });
      }
    }

    const changedVehicleRates: Array<{ id: string; sort_order: number }> = [];
    const dbRatesMap = new Map(vehicleRates.map((v) => [v.id, v]));
    for (const rate of draftVehicleRates) {
      const orig = dbRatesMap.get(rate.id);
      if (orig && orig.sort_order !== rate.sort_order) {
        changedVehicleRates.push({ id: rate.id, sort_order: rate.sort_order });
      }
    }

    const totalCount =
      changedContainers.length +
      changedItems.length +
      changedPinned.length +
      changedLocalities.length +
      changedVehicleRates.length;

    return {
      changedContainers,
      changedItems,
      changedPinned,
      changedLocalities,
      changedVehicleRates,
      totalCount,
      hasChanges: totalCount > 0,
    };
  }, [
    containersTableMissing,
    dbContainers,
    draftContainers,
    dbItems,
    draftItems,
    dbListings,
    draftPinnedOrderIds,
    dbLocalities,
    draftLocalities,
    vehicleRates,
    draftVehicleRates,
  ]);

  const sortedVehicleRates = useMemo(
    () =>
      [...draftVehicleRates].sort(
        (a, b) => a.sort_order - b.sort_order || a.base_fare_inr - b.base_fare_inr
      ),
    [draftVehicleRates]
  );

  const discardSequenceChanges = useCallback(() => {
    setDraftContainers(dbContainers);
    setDraftItems(dbItems);
    const dbPinnedIds = dbListings
      .filter((l) => l.is_featured || l.featured_order > 0)
      .sort((a, b) => {
        const ao = a.featured_order > 0 ? a.featured_order : 9999;
        const bo = b.featured_order > 0 ? b.featured_order : 9999;
        return ao - bo || b.rating - a.rating;
      })
      .map((l) => l.id);
    setDraftPinnedOrderIds(dbPinnedIds);
    setDraftLocalities(dbLocalities);
    setDraftVehicleRates(vehicleRates);
  }, [dbContainers, dbItems, dbListings, dbLocalities, vehicleRates]);

  const handleSaveBatchedSequence = async () => {
    if (!pendingSequenceDiff.hasChanges) return;

    const summaryLines: string[] = [];
    if (pendingSequenceDiff.changedContainers.length > 0) {
      summaryLines.push(
        `${pendingSequenceDiff.changedContainers.length} container tab order updates`
      );
    }
    if (pendingSequenceDiff.changedItems.length > 0) {
      summaryLines.push(
        `${pendingSequenceDiff.changedItems.length} homepage item order / container moves`
      );
    }
    if (pendingSequenceDiff.changedPinned.length > 0) {
      summaryLines.push(
        `${pendingSequenceDiff.changedPinned.length} Featured Places sequence updates`
      );
    }
    if (pendingSequenceDiff.changedLocalities.length > 0) {
      summaryLines.push(
        `${pendingSequenceDiff.changedLocalities.length} Popular Locality order updates`
      );
    }
    if (pendingSequenceDiff.changedVehicleRates.length > 0) {
      summaryLines.push(
        `${pendingSequenceDiff.changedVehicleRates.length} Pick N Drop fleet tier order updates`
      );
    }

    if (
      pendingSequenceDiff.changedVehicleRates.length > 0 &&
      vehicleSortOrderMissing
    ) {
      emitNotice(
        'error',
        'Run SQL migration 20261125_pass_v15e_builder_ordering.sql in Supabase first to persist Pick N Drop fleet sort_order.'
      );
      return;
    }

    const ok = await confirm({
      title: 'Save Sequence Changes to Live Homepage?',
      description:
        'All reordered tabs, cards, banners, featured listings, localities, and fleet tiers will be saved in one batch, logged to audit_logs, and immediately revalidated.',
      impactSummary: summaryLines,
      confirmLabel: 'Save Sequence Order',
      variant: 'info',
    });
    if (!ok) return;

    setSavingBatchOrder(true);
    try {
      const promises: Array<PromiseLike<{ error: { message: string } | null }>> = [];

      for (const c of pendingSequenceDiff.changedContainers) {
        promises.push(
          supabase
            .from('homepage_containers')
            .update({ sort_order: c.sort_order })
            .eq('id', c.id)
        );
      }
      for (const item of pendingSequenceDiff.changedItems) {
        const updatePayload: Record<string, unknown> = {
          sort_order: item.sort_order,
        };
        if (!containersTableMissing) {
          updatePayload.container_id = item.container_id;
        }
        promises.push(
          supabase
            .from('homepage_items')
            .update(updatePayload)
            .eq('id', item.id)
        );
      }
      for (const pin of pendingSequenceDiff.changedPinned) {
        promises.push(
          supabase
            .from('listings')
            .update({ is_featured: true, featured_order: pin.featured_order })
            .eq('id', pin.id)
        );
      }
      for (const loc of pendingSequenceDiff.changedLocalities) {
        promises.push(
          supabase
            .from('popular_localities')
            .update({ sort_order: loc.sort_order })
            .eq('id', loc.id)
        );
      }
      for (const rate of pendingSequenceDiff.changedVehicleRates) {
        promises.push(
          supabase
            .from('vehicle_types')
            .update({ sort_order: rate.sort_order })
            .eq('id', rate.id)
        );
      }

      const results = await Promise.all(promises);
      const firstErr = results.find((r) => r.error)?.error;
      if (firstErr) throw new Error(firstErr.message);

      emitNotice(
        'success',
        `Saved ${pendingSequenceDiff.totalCount} sequence change${
          pendingSequenceDiff.totalCount === 1 ? '' : 's'
        } and refreshed live homepage.`
      );
      await Promise.all([
        loadContainers(),
        loadHomepageItems(),
        loadListings(),
        loadLocalities(),
        loadVehicleRates(),
      ]);
      await triggerHomepageRevalidation();
    } catch (err) {
      emitNotice(
        'error',
        err instanceof Error ? err.message : 'Failed to save sequence changes.'
      );
    } finally {
      setSavingBatchOrder(false);
    }
  };

  const handleSwitchBuilderTab = async (nextTab: BuilderTab) => {
    if (nextTab === activeTab) return;
    if (pendingSequenceDiff.hasChanges) {
      const discard = await confirm({
        title: 'Unsaved Sequence Changes',
        description:
          'You have reordered items that have not been saved yet. Discard those sequence changes and switch tabs?',
        caution: 'Click Cancel to stay and click "Save Order" on the bottom bar.',
        confirmLabel: 'Discard & Switch Tab',
        cancelLabel: 'Stay Here',
        variant: 'warning',
      });
      if (!discard) return;
      discardSequenceChanges();
    }
    setActiveTab(nextTab);
  };

  // ===========================================================================
  // DRAG-AND-DROP HANDLERS (LOCAL DRAFT — SAVED VIA BATCHED BAR)
  // ===========================================================================
  const handleContainerDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = shortcutContainers.findIndex((c) => c.id === active.id);
    const newIndex = shortcutContainers.findIndex((c) => c.id === over.id);
    if (oldIndex < 0 || newIndex < 0) return;

    const reordered = arrayMove(shortcutContainers, oldIndex, newIndex).map(
      (c, idx) => ({ ...c, sort_order: (idx + 1) * 10 })
    );
    setDraftContainers((prev) => {
      const others = prev.filter((c) => c.section_group !== 'shortcut_grid');
      return [...reordered, ...others];
    });
  };

  const moveContainerByStep = (id: string, delta: -1 | 1) => {
    const idx = shortcutContainers.findIndex((c) => c.id === id);
    const targetIdx = idx + delta;
    if (idx < 0 || targetIdx < 0 || targetIdx >= shortcutContainers.length) return;
    const reordered = arrayMove(shortcutContainers, idx, targetIdx).map(
      (c, i) => ({ ...c, sort_order: (i + 1) * 10 })
    );
    setDraftContainers((prev) => {
      const others = prev.filter((c) => c.section_group !== 'shortcut_grid');
      return [...reordered, ...others];
    });
  };

  const handleShortcutDragStart = (event: DragStartEvent) => {
    setActiveShortcutDragId(String(event.active.id));
  };

  const handleShortcutDragOver = (event: DragOverEvent) => {
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;

    const activeItem = shortcutItems.find((i) => i.id === activeId);
    if (!activeItem) return;

    const overZoneContainerId = parseContainerZoneId(overId);
    const overItem = shortcutItems.find((i) => i.id === overId);

    const targetContainerId = overZoneContainerId
      ? overZoneContainerId === 'unassigned'
        ? null
        : overZoneContainerId
      : overItem
        ? resolveEffectiveContainerId(overItem) === UNASSIGNED_ZONE_ID
          ? null
          : resolveEffectiveContainerId(overItem)
        : undefined;

    if (targetContainerId === undefined) return;
    const currentEffective =
      resolveEffectiveContainerId(activeItem) === UNASSIGNED_ZONE_ID
        ? null
        : resolveEffectiveContainerId(activeItem);

    if (currentEffective !== targetContainerId) {
      setDraftItems((prev) =>
        prev.map((item) =>
          item.id === activeId
            ? { ...item, container_id: targetContainerId }
            : item
        )
      );
    }
  };

  const handleShortcutDragEnd = (event: DragEndEvent) => {
    setActiveShortcutDragId(null);
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);

    const activeItem = shortcutItems.find((i) => i.id === activeId);
    if (!activeItem) return;

    const overZoneContainerId = parseContainerZoneId(overId);
    const overItem = shortcutItems.find((i) => i.id === overId);

    const targetZoneKey = overZoneContainerId
      ? overZoneContainerId === 'unassigned'
        ? UNASSIGNED_ZONE_ID
        : overZoneContainerId
      : overItem
        ? resolveEffectiveContainerId(overItem)
        : resolveEffectiveContainerId(activeItem);

    const nextContainerId =
      targetZoneKey === UNASSIGNED_ZONE_ID ? null : targetZoneKey;

    const zoneItems = shortcutItems.filter(
      (i) =>
        (i.id === activeId
          ? targetZoneKey
          : resolveEffectiveContainerId(i)) === targetZoneKey
    );

    const oldIdx = zoneItems.findIndex((i) => i.id === activeId);
    const newIdx = overItem
      ? zoneItems.findIndex((i) => i.id === overItem.id)
      : zoneItems.length - 1;

    const reorderedZone =
      oldIdx >= 0 && newIdx >= 0 && oldIdx !== newIdx
        ? arrayMove(zoneItems, oldIdx, newIdx)
        : zoneItems;

    const orderMap = new Map<string, { sort_order: number; container_id: string | null }>();
    reorderedZone.forEach((item, idx) => {
      orderMap.set(item.id, {
        sort_order: (idx + 1) * 10,
        container_id: nextContainerId,
      });
    });

    setDraftItems((prev) =>
      prev.map((item) => {
        const patch = orderMap.get(item.id);
        return patch ? { ...item, ...patch } : item;
      })
    );
  };

  const moveShortcutCardToContainer = (itemId: string, newContainerId: string | null) => {
    const targetZone = newContainerId || UNASSIGNED_ZONE_ID;
    const existingInZone = shortcutItems.filter(
      (i) => i.id !== itemId && resolveEffectiveContainerId(i) === targetZone
    );
    const nextSort =
      existingInZone.reduce((m, i) => Math.max(m, i.sort_order), 0) + 10;

    setDraftItems((prev) =>
      prev.map((item) =>
        item.id === itemId
          ? { ...item, container_id: newContainerId, sort_order: nextSort }
          : item
      )
    );
  };

  const moveShortcutCardInZone = (
    zoneKey: string,
    itemId: string,
    delta: -1 | 1
  ) => {
    const zoneItems = shortcutItemsByContainer.get(zoneKey) || [];
    const idx = zoneItems.findIndex((i) => i.id === itemId);
    const swapIdx = idx + delta;
    if (idx < 0 || swapIdx < 0 || swapIdx >= zoneItems.length) return;
    const reordered = arrayMove(zoneItems, idx, swapIdx);
    const orderMap = new Map<string, number>();
    reordered.forEach((i, index) => orderMap.set(i.id, (index + 1) * 10));
    setDraftItems((prev) =>
      prev.map((item) =>
        orderMap.has(item.id)
          ? { ...item, sort_order: orderMap.get(item.id)! }
          : item
      )
    );
  };

  const handleSimpleSectionDragEnd = (
    section: 'quick_jump' | 'featured_banner',
    event: DragEndEvent
  ) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const list = section === 'quick_jump' ? quickJumpItems : bannerItems;
    const oldIdx = list.findIndex((i) => i.id === active.id);
    const newIdx = list.findIndex((i) => i.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;

    const reordered = arrayMove(list, oldIdx, newIdx);
    const orderMap = new Map<string, number>();
    reordered.forEach((i, idx) => orderMap.set(i.id, (idx + 1) * 10));

    setDraftItems((prev) =>
      prev.map((item) =>
        orderMap.has(item.id)
          ? { ...item, sort_order: orderMap.get(item.id)! }
          : item
      )
    );
  };

  const moveSimpleSectionItem = (
    section: 'quick_jump' | 'featured_banner',
    itemId: string,
    delta: -1 | 1
  ) => {
    const list = section === 'quick_jump' ? quickJumpItems : bannerItems;
    const idx = list.findIndex((i) => i.id === itemId);
    const targetIdx = idx + delta;
    if (idx < 0 || targetIdx < 0 || targetIdx >= list.length) return;
    const reordered = arrayMove(list, idx, targetIdx);
    const orderMap = new Map<string, number>();
    reordered.forEach((i, index) => orderMap.set(i.id, (index + 1) * 10));
    setDraftItems((prev) =>
      prev.map((item) =>
        orderMap.has(item.id)
          ? { ...item, sort_order: orderMap.get(item.id)! }
          : item
      )
    );
  };

  const handlePinnedDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = draftPinnedOrderIds.indexOf(String(active.id));
    const newIdx = draftPinnedOrderIds.indexOf(String(over.id));
    if (oldIdx < 0 || newIdx < 0) return;
    setDraftPinnedOrderIds((prev) => arrayMove(prev, oldIdx, newIdx));
  };

  const movePinnedByStep = (id: string, delta: -1 | 1) => {
    const idx = draftPinnedOrderIds.indexOf(id);
    const nextIdx = idx + delta;
    if (idx < 0 || nextIdx < 0 || nextIdx >= draftPinnedOrderIds.length) return;
    setDraftPinnedOrderIds((prev) => arrayMove(prev, idx, nextIdx));
  };

  const handleLocalityDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = sortedLocalities.findIndex((l) => l.id === active.id);
    const newIdx = sortedLocalities.findIndex((l) => l.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const reordered = arrayMove(sortedLocalities, oldIdx, newIdx).map(
      (l, idx) => ({ ...l, sort_order: (idx + 1) * 10 })
    );
    setDraftLocalities(reordered);
  };

  const moveLocalityByStep = (id: string, delta: -1 | 1) => {
    const idx = sortedLocalities.findIndex((l) => l.id === id);
    const nextIdx = idx + delta;
    if (idx < 0 || nextIdx < 0 || nextIdx >= sortedLocalities.length) return;
    const reordered = arrayMove(sortedLocalities, idx, nextIdx).map(
      (l, i) => ({ ...l, sort_order: (i + 1) * 10 })
    );
    setDraftLocalities(reordered);
  };

  const handleVehicleRateDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = sortedVehicleRates.findIndex((v) => v.id === active.id);
    const newIdx = sortedVehicleRates.findIndex((v) => v.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const reordered = arrayMove(sortedVehicleRates, oldIdx, newIdx).map(
      (v, idx) => ({ ...v, sort_order: (idx + 1) * 10 })
    );
    setDraftVehicleRates(reordered);
  };

  const moveVehicleRateByStep = (id: string, delta: -1 | 1) => {
    const idx = sortedVehicleRates.findIndex((v) => v.id === id);
    const nextIdx = idx + delta;
    if (idx < 0 || nextIdx < 0 || nextIdx >= sortedVehicleRates.length) return;
    const reordered = arrayMove(sortedVehicleRates, idx, nextIdx).map(
      (v, i) => ({ ...v, sort_order: (i + 1) * 10 })
    );
    setDraftVehicleRates(reordered);
  };

  // ===========================================================================
  // CRUD HANDLERS (VIA MODALS & CONFIRM DIALOGS)
  // ===========================================================================
  const openCreateContainerModal = () => {
    const maxOrder = shortcutContainers.reduce(
      (m, c) => Math.max(m, c.sort_order),
      0
    );
    setContainerModalSeq((s) => s + 1);
    setContainerModalDraft({
      slug: '',
      title: '',
      subtitle: '',
      icon_key: 'layout-grid',
      accent_color: '#2563EB',
      section_group: 'shortcut_grid',
      sort_order: maxOrder + 10,
      is_enabled: true,
    });
  };

  const openEditContainerModal = (c: HomepageContainerRecord) => {
    setContainerModalSeq((s) => s + 1);
    setContainerModalDraft({
      id: c.id,
      slug: c.slug,
      title: c.title,
      subtitle: c.subtitle || '',
      icon_key: c.icon_key,
      accent_color: c.accent_color,
      section_group: c.section_group,
      sort_order: c.sort_order,
      is_enabled: c.is_enabled,
    });
  };

  const handleSaveContainer = async (draft: HomepageContainerDraft) => {
    if (containersTableMissing) {
      emitNotice(
        'error',
        'Run SQL migration 20261125_pass_v15d_homepage_containers.sql in Supabase first to save custom containers.'
      );
      return;
    }
    setSavingModal(true);
    try {
      const payload = {
        slug: slugifyValue(draft.slug || draft.title),
        title: draft.title.trim(),
        subtitle: draft.subtitle.trim() || null,
        icon_key: normalizeIconKey(draft.icon_key),
        accent_color: draft.accent_color || '#2563EB',
        section_group: draft.section_group,
        sort_order: Number(draft.sort_order) || 0,
        is_enabled: draft.is_enabled,
      };

      if (draft.id) {
        const { error } = await supabase
          .from('homepage_containers')
          .update(payload)
          .eq('id', draft.id);
        if (error) throw error;
        emitNotice('success', `Updated container tab "${payload.title}".`);
      } else {
        const { error } = await supabase
          .from('homepage_containers')
          .insert(payload);
        if (error) throw error;
        emitNotice('success', `Created container tab "${payload.title}".`);
      }

      setContainerModalDraft(null);
      await loadContainers();
      await triggerHomepageRevalidation();
    } catch (err) {
      emitNotice(
        'error',
        err instanceof Error ? err.message : 'Failed to save container.'
      );
    } finally {
      setSavingModal(false);
    }
  };

  const handleToggleContainer = async (c: HomepageContainerRecord) => {
    if (containersTableMissing) {
      emitNotice(
        'error',
        'Apply SQL migration 20261125_pass_v15d_homepage_containers.sql to edit containers.'
      );
      return;
    }
    try {
      const { error } = await supabase
        .from('homepage_containers')
        .update({ is_enabled: !c.is_enabled })
        .eq('id', c.id);
      if (error) throw error;
      emitNotice(
        'success',
        `${!c.is_enabled ? 'Enabled' : 'Hidden'} "${c.title}" tab on homepage.`
      );
      await loadContainers();
      await triggerHomepageRevalidation();
    } catch (err) {
      emitNotice(
        'error',
        err instanceof Error ? err.message : 'Failed to toggle container.'
      );
    }
  };

  const handleDeleteContainer = async (c: HomepageContainerRecord) => {
    if (containersTableMissing) return;
    const assignedCount = (shortcutItemsByContainer.get(c.id) || []).length;
    const ok = await confirm({
      title: `Delete Container "${c.title}"?`,
      description:
        'Removing this container tab deletes it from public.homepage_containers. Assigned shortcut cards are NOT deleted; they safely fall back to auto-grouping.',
      caution:
        assignedCount > 0
          ? `${assignedCount} shortcut card${assignedCount === 1 ? '' : 's'} currently point to this container and will become auto-assigned.`
          : undefined,
      confirmLabel: 'Delete Container',
      variant: 'danger',
    });
    if (!ok) return;

    try {
      const { error } = await supabase
        .from('homepage_containers')
        .delete()
        .eq('id', c.id);
      if (error) throw error;
      emitNotice('success', `Deleted container "${c.title}".`);
      await Promise.all([loadContainers(), loadHomepageItems()]);
      await triggerHomepageRevalidation();
    } catch (err) {
      emitNotice(
        'error',
        err instanceof Error ? err.message : 'Failed to delete container.'
      );
    }
  };

  const openCreateItemModal = (
    section: HomepageSection,
    defaultContainerId?: string | null
  ) => {
    const existing = draftItems.filter((i) => i.section === section);
    const maxOrder = existing.reduce((m, i) => Math.max(m, i.sort_order), 0);
    setItemModalSeq((s) => s + 1);
    setItemModalDraft({
      section,
      container_id: defaultContainerId ?? null,
      title: '',
      subtitle: '',
      container_style:
        section === 'quick_jump'
          ? 'pill'
          : section === 'featured_banner'
            ? 'banner'
            : 'card',
      icon_key: section === 'featured_banner' ? 'sparkles' : 'compass',
      accent_color: '#2563EB',
      route_key: 'explore',
      query_params: {},
      sort_order: maxOrder + 10,
      is_enabled: true,
    });
  };

  const openEditItemModal = (item: HomepageItemRecord) => {
    setItemModalSeq((s) => s + 1);
    setItemModalDraft({
      id: item.id,
      item_key: item.item_key,
      container_id: item.container_id ?? null,
      section: item.section,
      title: item.title,
      subtitle: item.subtitle || '',
      container_style: item.container_style,
      icon_key: item.icon_key,
      accent_color: item.accent_color,
      route_key: item.route_key,
      query_params: { ...item.query_params },
      sort_order: item.sort_order,
      is_enabled: item.is_enabled,
    });
  };

  const handleSaveItem = async (draft: HomepageItemDraft) => {
    setSavingModal(true);
    try {
      const payload: Record<string, unknown> = {
        section: draft.section,
        title: draft.title.trim(),
        subtitle: draft.subtitle.trim() || null,
        container_style: draft.container_style,
        icon_key: normalizeIconKey(draft.icon_key),
        accent_color: draft.accent_color || '#2563EB',
        route_key: draft.route_key || 'explore',
        query_params: normalizeQueryParamsRecord(draft.query_params),
        sort_order: Number(draft.sort_order) || 0,
        is_enabled: draft.is_enabled,
      };
      if (!containersTableMissing) {
        payload.container_id = draft.container_id || null;
      }

      if (draft.id) {
        const { error } = await supabase
          .from('homepage_items')
          .update(payload)
          .eq('id', draft.id);
        if (error) throw error;
        emitNotice('success', `Updated "${draft.title.trim()}" on live homepage.`);
      } else {
        const { error } = await supabase.from('homepage_items').insert(payload);
        if (error) throw error;
        emitNotice('success', `Added "${draft.title.trim()}" to homepage.`);
      }

      setItemModalDraft(null);
      await loadHomepageItems();
      await triggerHomepageRevalidation();
    } catch (err) {
      emitNotice(
        'error',
        err instanceof Error ? err.message : 'Failed to save homepage item.'
      );
    } finally {
      setSavingModal(false);
    }
  };

  const handleToggleItem = async (item: HomepageItemRecord) => {
    try {
      const { error } = await supabase
        .from('homepage_items')
        .update({ is_enabled: !item.is_enabled })
        .eq('id', item.id);
      if (error) throw error;
      emitNotice(
        'success',
        `${!item.is_enabled ? 'Enabled' : 'Hidden'} "${item.title}" on live homepage.`
      );
      await loadHomepageItems();
      await triggerHomepageRevalidation();
    } catch (err) {
      emitNotice(
        'error',
        err instanceof Error ? err.message : 'Failed to toggle item.'
      );
    }
  };

  const handleDeleteItem = async (item: HomepageItemRecord) => {
    const ok = await confirm({
      title: `Delete "${item.title}"?`,
      description:
        'This item will be permanently removed from the live homepage and recorded in the immutable audit log.',
      confirmLabel: 'Delete Item',
      variant: 'danger',
    });
    if (!ok) return;

    try {
      const { error } = await supabase
        .from('homepage_items')
        .delete()
        .eq('id', item.id);
      if (error) throw error;
      emitNotice('success', `Deleted "${item.title}".`);
      await loadHomepageItems();
      await triggerHomepageRevalidation();
    } catch (err) {
      emitNotice(
        'error',
        err instanceof Error ? err.message : 'Failed to delete item.'
      );
    }
  };

  const handleResetSectionDefaults = async (section: HomepageSection) => {
    const label =
      section === 'shortcut_grid'
        ? '15 Shortcut Grid Cards'
        : section === 'quick_jump'
          ? '7 Quick Jump Chips'
          : '2 Spotlight Banners';

    const ok = await confirm({
      title: `Reset ${label} to Defaults?`,
      description:
        'Replaces all rows in this section with canonical Churachandpur defaults and immediately revalidates the live homepage.',
      caution: 'Any custom cards or edits in this section will be overwritten.',
      confirmLabel: 'Reset to Defaults',
      variant: 'danger',
    });
    if (!ok) return;

    setSavingModal(true);
    try {
      const defaults =
        section === 'shortcut_grid'
          ? DEFAULT_HOMEPAGE_SHORTCUTS
          : section === 'quick_jump'
            ? DEFAULT_HOMEPAGE_QUICK_JUMPS
            : DEFAULT_HOMEPAGE_BANNERS;

      const { error: delErr } = await supabase
        .from('homepage_items')
        .delete()
        .eq('section', section);
      if (delErr) throw delErr;

      const rows = defaults.map((d) => {
        const inferredSlug = inferDefaultContainerSlugForItem(d);
        const containerId = !containersTableMissing
          ? containerIdBySlug.get(inferredSlug) || null
          : undefined;
        return {
          item_key: d.item_key || null,
          section: d.section,
          title: d.title,
          subtitle: d.subtitle,
          container_style: d.container_style,
          icon_key: d.icon_key,
          accent_color: d.accent_color,
          route_key: d.route_key,
          query_params: d.query_params,
          sort_order: d.sort_order,
          is_enabled: true,
          ...(containerId !== undefined ? { container_id: containerId } : {}),
        };
      });

      const { error: insErr } = await supabase
        .from('homepage_items')
        .insert(rows);
      if (insErr) throw insErr;

      emitNotice('success', `Restored ${label} and revalidated homepage.`);
      await loadHomepageItems();
      await triggerHomepageRevalidation();
    } catch (err) {
      emitNotice(
        'error',
        err instanceof Error ? err.message : 'Failed to reset section defaults.'
      );
    } finally {
      setSavingModal(false);
    }
  };

  // Featured Places handlers
  const handlePinListing = async (listing: FeaturedListingRow) => {
    setSavingModal(true);
    try {
      const maxOrder = orderedPinnedListings.reduce(
        (m, l) => Math.max(m, l.featured_order),
        0
      );
      const { error } = await supabase
        .from('listings')
        .update({ is_featured: true, featured_order: maxOrder + 10 })
        .eq('id', listing.id);
      if (error) throw error;
      emitNotice('success', `Pinned "${listing.title}" to Featured Places.`);
      setPinModalOpen(false);
      await loadListings();
      await triggerHomepageRevalidation();
    } catch (err) {
      emitNotice(
        'error',
        err instanceof Error ? err.message : 'Failed to pin listing.'
      );
    } finally {
      setSavingModal(false);
    }
  };

  const handleUnpinListing = async (listing: FeaturedListingRow) => {
    const ok = await confirm({
      title: `Unpin "${listing.title}"?`,
      description:
        'This removes the listing from pinned Featured Places slots on the homepage. The listing remains published in the directory.',
      confirmLabel: 'Unpin Listing',
      variant: 'warning',
    });
    if (!ok) return;

    try {
      const { error } = await supabase
        .from('listings')
        .update({ is_featured: false, featured_order: 0 })
        .eq('id', listing.id);
      if (error) throw error;
      emitNotice('success', `Unpinned "${listing.title}" from Featured Places.`);
      await loadListings();
      await triggerHomepageRevalidation();
    } catch (err) {
      emitNotice(
        'error',
        err instanceof Error ? err.message : 'Failed to unpin listing.'
      );
    }
  };

  // Popular Localities handlers
  const openCreateLocalityModal = () => {
    const maxOrder = sortedLocalities.reduce(
      (m, l) => Math.max(m, l.sort_order),
      0
    );
    setLocalityModalSeq((s) => s + 1);
    setLocalityModalDraft({
      name: '',
      slug: '',
      icon_key: 'map-pin',
      lat: '24.3335',
      lng: '93.6946',
      default_zoom: '15',
      sort_order: maxOrder + 10,
      is_enabled: true,
    });
  };

  const openEditLocalityModal = (loc: PopularLocalityRecord) => {
    setLocalityModalSeq((s) => s + 1);
    setLocalityModalDraft({
      id: loc.id,
      name: loc.name,
      slug: loc.slug,
      icon_key: loc.icon_key,
      lat: String(loc.lat),
      lng: String(loc.lng),
      default_zoom: String(loc.default_zoom),
      sort_order: loc.sort_order,
      is_enabled: loc.is_enabled,
    });
  };

  const handleSaveLocality = async (draft: LocalityDraft) => {
    setSavingModal(true);
    try {
      const payload = {
        name: draft.name.trim(),
        slug: slugifyValue(draft.slug || draft.name),
        icon_key: normalizeIconKey(draft.icon_key),
        lat: Number(Number.parseFloat(draft.lat).toFixed(6)),
        lng: Number(Number.parseFloat(draft.lng).toFixed(6)),
        default_zoom: Math.max(
          11,
          Math.min(19, Number.parseInt(draft.default_zoom, 10) || 15)
        ),
        sort_order: Number(draft.sort_order) || 0,
        is_enabled: draft.is_enabled,
      };

      if (draft.id) {
        const { error } = await supabase
          .from('popular_localities')
          .update(payload)
          .eq('id', draft.id);
        if (error) throw error;
        emitNotice('success', `Updated locality "${payload.name}".`);
      } else {
        const { error } = await supabase
          .from('popular_localities')
          .insert(payload);
        if (error) throw error;
        emitNotice('success', `Added popular locality "${payload.name}".`);
      }

      setLocalityModalDraft(null);
      await loadLocalities();
      await triggerHomepageRevalidation();
    } catch (err) {
      emitNotice(
        'error',
        err instanceof Error ? err.message : 'Failed to save locality.'
      );
    } finally {
      setSavingModal(false);
    }
  };

  const handleToggleLocality = async (loc: PopularLocalityRecord) => {
    try {
      const { error } = await supabase
        .from('popular_localities')
        .update({ is_enabled: !loc.is_enabled })
        .eq('id', loc.id);
      if (error) throw error;
      emitNotice(
        'success',
        `${!loc.is_enabled ? 'Enabled' : 'Hidden'} "${loc.name}" on homepage.`
      );
      await loadLocalities();
      await triggerHomepageRevalidation();
    } catch (err) {
      emitNotice(
        'error',
        err instanceof Error ? err.message : 'Failed to toggle locality.'
      );
    }
  };

  const handleDeleteLocality = async (loc: PopularLocalityRecord) => {
    const ok = await confirm({
      title: `Delete "${loc.name}"?`,
      description:
        'Removing this Popular Locality hides its quick-jump map chip from the homepage and logs an immutable audit entry.',
      confirmLabel: 'Delete Locality',
      variant: 'danger',
    });
    if (!ok) return;

    try {
      const { error } = await supabase
        .from('popular_localities')
        .delete()
        .eq('id', loc.id);
      if (error) throw error;
      emitNotice('success', `Deleted "${loc.name}".`);
      await loadLocalities();
      await triggerHomepageRevalidation();
    } catch (err) {
      emitNotice(
        'error',
        err instanceof Error ? err.message : 'Failed to delete locality.'
      );
    }
  };

  // Pick N Drop Rates handlers
  const openEditRateModal = (tier: VehicleTypeRateRow) => {
    setRateModalSeq((s) => s + 1);
    setRateModalDraft({
      id: tier.id,
      slug: tier.slug,
      name: tier.name,
      base_fare_inr: String(tier.base_fare_inr),
      per_km_rate_inr: String(tier.per_km_rate_inr),
      two_way_multiplier: String(tier.two_way_multiplier),
      max_weight_kg: String(tier.max_weight_kg),
      max_dimensions: tier.max_dimensions || '',
      supported_modes: tier.supported_modes,
    });
  };

  const handleSaveVehicleRate = async (draft: VehicleRateDraft) => {
    setSavingModal(true);
    try {
      const baseFare = Number.parseFloat(draft.base_fare_inr);
      const perKm = Number.parseFloat(draft.per_km_rate_inr);
      const twoWayMult = Number.parseFloat(draft.two_way_multiplier);
      const maxWeight = Number.parseFloat(draft.max_weight_kg);

      const { error } = await supabase
        .from('vehicle_types')
        .update({
          base_fare_inr: baseFare,
          per_km_rate_inr: perKm,
          two_way_multiplier: twoWayMult,
          max_weight_kg: maxWeight,
          max_dimensions: draft.max_dimensions.trim() || null,
        })
        .eq('id', draft.id);
      if (error) throw error;

      emitNotice(
        'success',
        `Saved ${draft.name} rates (₹${baseFare} base, ₹${perKm}/km) and refreshed live homepage.`
      );
      setRateModalDraft(null);
      await loadVehicleRates();
      await triggerHomepageRevalidation();
    } catch (err) {
      emitNotice(
        'error',
        err instanceof Error ? err.message : 'Failed to update tier rates.'
      );
    } finally {
      setSavingModal(false);
    }
  };

  const handleToggleVehicleTier = async (tier: VehicleTypeRateRow) => {
    if (tier.is_active) {
      const ok = await confirm({
        title: `Disable ${tier.name} Tier?`,
        description:
          'Disabling this Pick N Drop vehicle tier immediately removes it from live homepage transparent fares and new customer quotes.',
        caution: 'Existing in-flight orders are unaffected.',
        confirmLabel: 'Disable Tier',
        variant: 'danger',
      });
      if (!ok) return;
    }

    try {
      const { error } = await supabase
        .from('vehicle_types')
        .update({ is_active: !tier.is_active })
        .eq('id', tier.id);
      if (error) throw error;
      emitNotice(
        'success',
        `${!tier.is_active ? 'Activated' : 'Disabled'} ${tier.name} tier.`
      );
      await loadVehicleRates();
      await triggerHomepageRevalidation();
    } catch (err) {
      emitNotice(
        'error',
        err instanceof Error ? err.message : 'Failed to update tier status.'
      );
    }
  };

  // DragOverlay item lookup
  const activeDraggedShortcut = useMemo(
    () =>
      activeShortcutDragId
        ? shortcutItems.find((i) => i.id === activeShortcutDragId) || null
        : null,
    [activeShortcutDragId, shortcutItems]
  );

  // Zones visible in the multi-container shortcut grid
  const visibleShortcutZones = useMemo(() => {
    const zones: Array<{
      zoneKey: string;
      container: HomepageContainerRecord | null;
      items: HomepageItemRecord[];
    }> = shortcutContainers.map((c) => ({
      zoneKey: c.id,
      container: c,
      items: shortcutItemsByContainer.get(c.id) || [],
    }));

    const unassigned = shortcutItemsByContainer.get(UNASSIGNED_ZONE_ID) || [];
    if (unassigned.length > 0) {
      zones.push({
        zoneKey: UNASSIGNED_ZONE_ID,
        container: null,
        items: unassigned,
      });
    }

    if (mobileContainerFilter === 'all') return zones;
    return zones.filter((z) => z.zoneKey === mobileContainerFilter);
  }, [shortcutContainers, shortcutItemsByContainer, mobileContainerFilter]);

  const isLoadingTab =
    (activeTab === 'shortcuts' && (loadingContainers || loadingItems)) ||
    (activeTab === 'featured' && (loadingItems || loadingListings)) ||
    (activeTab === 'localities' && loadingLocalities) ||
    (activeTab === 'pnd_rates' && loadingRates);

  return (
    <div className="space-y-4 pb-20">
      {dialog}

      {/* Modals (Modal-Only Editing — Zero Inline Forms) */}
      {containerModalDraft && (
        <ContainerFormModal
          key={`container-modal-${containerModalSeq}`}
          isOpen
          initialDraft={containerModalDraft}
          existingContainers={draftContainers}
          isSubmitting={savingModal}
          onSave={handleSaveContainer}
          onClose={() => setContainerModalDraft(null)}
        />
      )}

      {itemModalDraft && (
        <HomepageItemFormModal
          key={`item-modal-${itemModalSeq}`}
          isOpen
          initialDraft={itemModalDraft}
          containers={draftContainers}
          liveCategories={liveCategories}
          isSubmitting={savingModal}
          onSave={handleSaveItem}
          onClose={() => setItemModalDraft(null)}
        />
      )}

      {pinModalOpen && (
        <PinListingFormModal
          key="pin-listing-modal"
          isOpen
          unpinnedListings={unpinnedListings}
          isSubmitting={savingModal}
          onPin={handlePinListing}
          onClose={() => setPinModalOpen(false)}
        />
      )}

      {localityModalDraft && (
        <LocalityFormModal
          key={`locality-modal-${localityModalSeq}`}
          isOpen
          initialDraft={localityModalDraft}
          existingLocalities={draftLocalities}
          isSubmitting={savingModal}
          onSave={handleSaveLocality}
          onClose={() => setLocalityModalDraft(null)}
        />
      )}

      {rateModalDraft && (
        <VehicleRateFormModal
          key={`rate-modal-${rateModalSeq}`}
          isOpen
          initialDraft={rateModalDraft}
          isSubmitting={savingModal}
          onSave={handleSaveVehicleRate}
          onClose={() => setRateModalDraft(null)}
        />
      )}

      {/* Top Studio Header */}
      <div className="flex flex-col gap-3 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <LayoutGrid className="h-4 w-4 text-[var(--ps-accent)]" />
            <h2 className="text-base font-bold text-[var(--ps-text)]">
              Homepage Visual Builder
            </h2>
          </div>
          <p className="mt-0.5 text-xs text-[var(--ps-text-muted)]">
            Preview-first canvas. Drag <span className="font-mono">⠿</span> handles
            to arrange sequence, click Edit for modal controls, then batch-save order
            changes to <span className="font-mono">/</span>.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {lastRevalidatedAt && (
            <span className="inline-flex items-center gap-1 rounded-xl border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
              <Check className="h-3.5 w-3.5" />
              <span>Live synced</span>
            </span>
          )}
          <button
            type="button"
            onClick={() => void triggerHomepageRevalidation()}
            disabled={revalidating}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 text-xs font-semibold text-[var(--ps-text)] transition hover:border-[var(--ps-accent)] disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${revalidating ? 'animate-spin' : ''}`}
            />
            <span>Revalidate /</span>
          </button>
        </div>
      </div>

      {/* Migration Notice if v15d SQL hasn't run yet */}
      {containersTableMissing && (
        <div className="rounded-xl border border-amber-500/35 bg-amber-500/10 px-3.5 py-2.5 text-xs text-amber-800 dark:text-amber-200">
          <strong>Previewing default container tabs:</strong> Run{' '}
          <span className="font-mono">
            supabase/migrations/20261125_pass_v15d_homepage_containers.sql
          </span>{' '}
          in Supabase SQL Editor to persist custom container tabs and cross-container
          card moves.
        </div>
      )}

      {/* Inline Status Banner */}
      {localBanner && (
        <div
          className={`flex items-center justify-between gap-2 rounded-xl border px-3.5 py-2.5 text-xs font-medium ${
            localBanner.type === 'success'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-800 dark:text-emerald-200'
              : 'border-rose-500/30 bg-rose-500/10 text-rose-800 dark:text-rose-200'
          }`}
        >
          <span>{localBanner.text}</span>
          <button
            type="button"
            onClick={() => setLocalBanner(null)}
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg opacity-70 hover:opacity-100 cursor-pointer"
            aria-label="Dismiss message"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* 4 Responsive Builder Tabs (44px+ touch targets, horizontal scroll on mobile) */}
      <div className="flex items-center gap-1.5 overflow-x-auto border-b border-[var(--ps-border)] pb-3 no-scrollbar">
        {(
          [
            {
              id: 'shortcuts' as const,
              label: 'Containers & Shortcuts',
              icon: FolderKanban,
              count: shortcutItems.length + quickJumpItems.length,
            },
            {
              id: 'featured' as const,
              label: 'Banners & Featured',
              icon: Star,
              count: bannerItems.length + orderedPinnedListings.length,
            },
            {
              id: 'localities' as const,
              label: 'Popular Localities',
              icon: MapPin,
              count: sortedLocalities.length,
            },
            {
              id: 'pnd_rates' as const,
              label: 'Pick N Drop Rates',
              icon: Truck,
              count: vehicleRates.length,
            },
          ] as const
        ).map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => void handleSwitchBuilderTab(tab.id)}
              className={`inline-flex min-h-[44px] shrink-0 items-center gap-2 rounded-xl px-3.5 text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer ${
                active
                  ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)] shadow-xs'
                  : 'border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:border-[var(--ps-accent)]/50 hover:text-[var(--ps-text)]'
              }`}
            >
              <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
              <span>{tab.label}</span>
              <span
                className={`rounded-md px-1.5 py-0.5 text-[10px] font-bold tabular-nums ${
                  active
                    ? 'bg-white/20 text-white'
                    : 'bg-[var(--ps-bg)] text-[var(--ps-text-muted)]'
                }`}
              >
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* Loading Skeleton or Active Workspace Tab */}
      {isLoadingTab ? (
        <BuilderPreviewSkeleton tab={activeTab} />
      ) : (
        <>
          {/* ================================================================= */}
          {/* TAB 1: CONTAINERS, SHORTCUT CARDS & QUICK JUMPS                   */}
          {/* ================================================================= */}
          {activeTab === 'shortcuts' && (
            <div className="space-y-5">
              {/* 1A. Container Tabs Management Strip (Live Tab Preview + DnD) */}
              <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <Layers className="h-4 w-4 text-[var(--ps-accent)]" />
                      <h3 className="text-sm font-bold text-[var(--ps-text)]">
                        Homepage Container Tabs ({shortcutContainers.length})
                      </h3>
                    </div>
                    <p className="mt-0.5 text-[11px] text-[var(--ps-text-muted)]">
                      Drag handles to reorder thematic tabs above the homepage
                      shortcut grid. An automatic &ldquo;All&rdquo; aggregate tab
                      is always shown first on the live homepage.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={openCreateContainerModal}
                    className="inline-flex min-h-[44px] shrink-0 items-center justify-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3.5 text-xs font-bold text-[var(--ps-accent-fg)] shadow-xs hover:opacity-95 cursor-pointer"
                  >
                    <Plus className="h-4 w-4" />
                    <span>Add Container Tab</span>
                  </button>
                </div>

                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={handleContainerDragEnd}
                >
                  <SortableContext
                    items={shortcutContainers.map((c) => c.id)}
                    strategy={horizontalListSortingStrategy}
                  >
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                      {shortcutContainers.map((container, idx) => {
                        const Icon = getIconByKey(container.icon_key);
                        const itemCount = (
                          shortcutItemsByContainer.get(container.id) || []
                        ).length;
                        return (
                          <SortablePreviewItem
                            key={container.id}
                            id={container.id}
                            dragLabel={`Reorder ${container.title} container`}
                          >
                            {({ dragHandleProps }) => (
                              <div
                                className={`flex flex-col justify-between gap-2.5 rounded-2xl border p-3 transition-colors ${
                                  container.is_enabled
                                    ? 'border-[var(--ps-border)] bg-[var(--ps-bg)]'
                                    : 'border-dashed border-[var(--ps-border)] bg-[var(--ps-bg)]/50 opacity-65'
                                }`}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <DragHandleButton
                                      handleProps={dragHandleProps}
                                      compact
                                    />
                                    <span
                                      className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white"
                                      style={{
                                        backgroundColor: container.accent_color,
                                      }}
                                    >
                                      <Icon className="h-4 w-4" aria-hidden="true" />
                                    </span>
                                    <div className="min-w-0">
                                      <p className="text-xs font-bold text-[var(--ps-text)] truncate">
                                        {container.title}
                                      </p>
                                      <p className="text-[10.5px] font-mono text-[var(--ps-text-muted)] truncate">
                                        {container.slug} · {itemCount} cards
                                      </p>
                                    </div>
                                  </div>
                                  {!container.is_enabled && (
                                    <span className="rounded-md border border-[var(--ps-border)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--ps-text-muted)]">
                                      Hidden
                                    </span>
                                  )}
                                </div>

                                <div className="flex items-center justify-between gap-1.5 border-t border-[var(--ps-border)]/70 pt-2">
                                  <MobileOrderButtons
                                    canMoveUp={idx > 0}
                                    canMoveDown={idx < shortcutContainers.length - 1}
                                    onMoveUp={() =>
                                      moveContainerByStep(container.id, -1)
                                    }
                                    onMoveDown={() =>
                                      moveContainerByStep(container.id, 1)
                                    }
                                    itemLabel={container.title}
                                  />
                                  <div className="flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void handleToggleContainer(container)
                                      }
                                      className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:border-[var(--ps-accent)] hover:text-[var(--ps-text)] cursor-pointer"
                                      title={
                                        container.is_enabled
                                          ? 'Hide tab'
                                          : 'Show tab'
                                      }
                                      aria-label={
                                        container.is_enabled
                                          ? `Hide ${container.title}`
                                          : `Show ${container.title}`
                                      }
                                    >
                                      {container.is_enabled ? (
                                        <Eye className="h-3.5 w-3.5" />
                                      ) : (
                                        <EyeOff className="h-3.5 w-3.5" />
                                      )}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        openEditContainerModal(container)
                                      }
                                      className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:border-[var(--ps-accent)] hover:text-[var(--ps-accent)] cursor-pointer"
                                      title="Edit container"
                                      aria-label={`Edit ${container.title}`}
                                    >
                                      <Edit3 className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() =>
                                        void handleDeleteContainer(container)
                                      }
                                      disabled={container.slug === 'all-services'}
                                      className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:border-rose-500/50 hover:text-rose-600 disabled:opacity-30 cursor-pointer"
                                      title={
                                        container.slug === 'all-services'
                                          ? 'Default overview tab cannot be deleted'
                                          : 'Delete container'
                                      }
                                      aria-label={`Delete ${container.title}`}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                </div>
                              </div>
                            )}
                          </SortablePreviewItem>
                        );
                      })}
                    </div>
                  </SortableContext>
                </DndContext>
              </div>

              {/* 1B. Shortcut Cards Grouped Live Preview Canvas (Cross-Container DnD) */}
              <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3.5">
                <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-[var(--ps-text)]">
                      Shortcut Cards Canvas ({shortcutItems.length})
                    </h3>
                    <p className="mt-0.5 text-[11px] text-[var(--ps-text-muted)]">
                      Drag cards by their <span className="font-mono">⠿</span>{' '}
                      handle within a container or drop into another container tab
                      to reorganize live.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        void handleResetSectionDefaults('shortcut_grid')
                      }
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs font-semibold text-[var(--ps-text-muted)] hover:border-rose-500/40 hover:text-rose-600 cursor-pointer"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span>Reset Defaults</span>
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        openCreateItemModal(
                          'shortcut_grid',
                          mobileContainerFilter !== 'all' &&
                            mobileContainerFilter !== UNASSIGNED_ZONE_ID
                            ? mobileContainerFilter
                            : shortcutContainers.find(
                                (c) => c.slug !== 'all-services'
                              )?.id ?? null
                        )
                      }
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3.5 text-xs font-bold text-[var(--ps-accent-fg)] shadow-xs hover:opacity-95 cursor-pointer"
                    >
                      <Plus className="h-4 w-4" />
                      <span>Add Shortcut Card</span>
                    </button>
                  </div>
                </div>

                {/* Container Filter Pills (especially helpful on Mobile & Tablet) */}
                <div className="flex items-center gap-1.5 overflow-x-auto pb-1 no-scrollbar">
                  <button
                    type="button"
                    onClick={() => setMobileContainerFilter('all')}
                    className={`inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors cursor-pointer ${
                      mobileContainerFilter === 'all'
                        ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                        : 'border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                    }`}
                  >
                    <span>All Containers</span>
                    <span className="text-[10px] opacity-80 tabular-nums">
                      ({shortcutItems.length})
                    </span>
                  </button>
                  {shortcutContainers.map((c) => {
                    const active = mobileContainerFilter === c.id;
                    const count = (
                      shortcutItemsByContainer.get(c.id) || []
                    ).length;
                    return (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => setMobileContainerFilter(c.id)}
                        className={`inline-flex min-h-[40px] shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors cursor-pointer ${
                          active
                            ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                            : 'border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                        }`}
                      >
                        <span>{c.title}</span>
                        <span className="text-[10px] opacity-80 tabular-nums">
                          ({count})
                        </span>
                      </button>
                    );
                  })}
                </div>

                {/* Multi-Container Drag-and-Drop Grid */}
                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCorners}
                  onDragStart={handleShortcutDragStart}
                  onDragOver={handleShortcutDragOver}
                  onDragEnd={handleShortcutDragEnd}
                >
                  <div className="space-y-4">
                    {visibleShortcutZones.map(({ zoneKey, container, items }) => {
                      const isCollapsed = Boolean(collapsedZones[zoneKey]);
                      const ZoneIcon = container
                        ? getIconByKey(container.icon_key)
                        : FolderKanban;
                      const zoneTitle = container
                        ? container.title
                        : 'Unassigned Cards';
                      const zoneAccent = container?.accent_color || '#64748B';
                      const droppableId =
                        zoneKey === UNASSIGNED_ZONE_ID
                          ? UNASSIGNED_ZONE_ID
                          : containerZoneId(zoneKey);

                      return (
                        <DroppableContainerZone key={zoneKey} id={droppableId}>
                          {({ isOver }) => (
                            <div
                              className={`rounded-2xl border p-3.5 transition-colors ${
                                isOver
                                  ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)]/6 ring-2 ring-[var(--ps-accent)]/25'
                                  : 'border-[var(--ps-border)] bg-[var(--ps-bg)]/60'
                              }`}
                            >
                              {/* Zone Header */}
                              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                                <button
                                  type="button"
                                  onClick={() =>
                                    setCollapsedZones((prev) => ({
                                      ...prev,
                                      [zoneKey]: !prev[zoneKey],
                                    }))
                                  }
                                  className="inline-flex min-h-[40px] items-center gap-2 text-left cursor-pointer"
                                >
                                  <span
                                    className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-white"
                                    style={{ backgroundColor: zoneAccent }}
                                  >
                                    <ZoneIcon className="h-3.5 w-3.5" />
                                  </span>
                                  <div>
                                    <span className="text-xs font-bold text-[var(--ps-text)]">
                                      {zoneTitle}
                                    </span>
                                    <span className="ml-2 rounded-md border border-[var(--ps-border)] bg-[var(--ps-surface)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--ps-text-muted)] tabular-nums">
                                      {items.length} cards
                                    </span>
                                  </div>
                                  {isCollapsed ? (
                                    <ChevronDown className="h-4 w-4 text-[var(--ps-text-muted)]" />
                                  ) : (
                                    <ChevronUp className="h-4 w-4 text-[var(--ps-text-muted)]" />
                                  )}
                                </button>

                                <button
                                  type="button"
                                  onClick={() =>
                                    openCreateItemModal(
                                      'shortcut_grid',
                                      container ? container.id : null
                                    )
                                  }
                                  className="inline-flex min-h-[38px] items-center gap-1 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 text-[11px] font-semibold text-[var(--ps-text)] hover:border-[var(--ps-accent)] cursor-pointer"
                                >
                                  <Plus className="h-3.5 w-3.5" />
                                  <span>Add Here</span>
                                </button>
                              </div>

                              {!isCollapsed && (
                                <SortableContext
                                  items={items.map((i) => i.id)}
                                  strategy={rectSortingStrategy}
                                >
                                  {items.length === 0 ? (
                                    <div className="rounded-xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-surface)]/50 p-5 text-center text-xs text-[var(--ps-text-muted)]">
                                      {container?.slug === 'all-services'
                                        ? 'Empty by default — the "All Services" tab automatically displays all enabled shortcut cards across every container. Drag cards here only if you want a custom curated subset.'
                                        : 'Drop any shortcut card here or click "Add Here".'}
                                    </div>
                                  ) : (
                                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                                      {items.map((item, idx) => {
                                        const CardIcon = getIconByKey(
                                          item.icon_key
                                        );
                                        const href = resolveHomepageItemHref(
                                          item.route_key,
                                          item.query_params,
                                          'churachandpur'
                                        );
                                        const isTinted =
                                          item.container_style === 'tinted';
                                        const isElevated =
                                          item.container_style === 'elevated';

                                        return (
                                          <SortablePreviewItem
                                            key={item.id}
                                            id={item.id}
                                            dragLabel={`Drag ${item.title} to reorder or move tab`}
                                          >
                                            {({ dragHandleProps }) => (
                                              <div
                                                className={`flex h-full flex-col justify-between gap-2.5 rounded-2xl border p-3 transition-all ${
                                                  !item.is_enabled
                                                    ? 'opacity-55 border-dashed border-[var(--ps-border)] bg-[var(--ps-surface)]'
                                                    : isElevated
                                                      ? 'border-[var(--ps-border)] bg-[var(--ps-surface)] shadow-md'
                                                      : isTinted
                                                        ? 'shadow-2xs'
                                                        : 'border-[var(--ps-border)] bg-[var(--ps-surface)] shadow-2xs'
                                                }`}
                                                style={
                                                  isTinted && item.is_enabled
                                                    ? {
                                                        backgroundColor: `${item.accent_color}12`,
                                                        borderColor: `${item.accent_color}3D`,
                                                      }
                                                    : undefined
                                                }
                                              >
                                                {/* Top Controls + Live Visual Card Body */}
                                                <div className="space-y-2">
                                                  <div className="flex items-start justify-between gap-2">
                                                    <div
                                                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl"
                                                      style={{
                                                        backgroundColor: `${item.accent_color}1A`,
                                                        color: item.accent_color,
                                                      }}
                                                    >
                                                      <CardIcon
                                                        className="h-4 w-4"
                                                        aria-hidden="true"
                                                      />
                                                    </div>
                                                    <div className="flex items-center gap-1">
                                                      <DragHandleButton
                                                        handleProps={
                                                          dragHandleProps
                                                        }
                                                        compact
                                                      />
                                                    </div>
                                                  </div>

                                                  <div className="min-w-0">
                                                    <p className="text-xs font-bold text-[var(--ps-text)] leading-tight truncate">
                                                      {item.title}
                                                    </p>
                                                    {item.subtitle && (
                                                      <p className="mt-0.5 text-[10.5px] text-[var(--ps-text-muted)] line-clamp-2">
                                                        {item.subtitle}
                                                      </p>
                                                    )}
                                                    <p className="mt-1.5 inline-flex max-w-full items-center gap-1 rounded-md bg-[var(--ps-bg)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--ps-text-muted)] truncate">
                                                      <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                                                      <span className="truncate">
                                                        {href}
                                                      </span>
                                                    </p>
                                                  </div>
                                                </div>

                                                {/* Mobile-Friendly Move-To-Tab + Action Buttons */}
                                                <div className="space-y-1.5 border-t border-[var(--ps-border)]/70 pt-2">
                                                  <select
                                                    aria-label={`Move ${item.title} to container tab`}
                                                    value={
                                                      container
                                                        ? container.id
                                                        : ''
                                                    }
                                                    onChange={(e) =>
                                                      moveShortcutCardToContainer(
                                                        item.id,
                                                        e.target.value || null
                                                      )
                                                    }
                                                    className="min-h-[36px] w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 text-[11px] font-semibold text-[var(--ps-text-muted)] focus:border-[var(--ps-accent)] focus:outline-none"
                                                  >
                                                    <option value="">
                                                      Move to tab...
                                                    </option>
                                                    {shortcutContainers.map(
                                                      (c) => (
                                                        <option
                                                          key={c.id}
                                                          value={c.id}
                                                        >
                                                          Tab: {c.title}
                                                        </option>
                                                      )
                                                    )}
                                                  </select>

                                                  <div className="flex items-center justify-between gap-1">
                                                    <MobileOrderButtons
                                                      canMoveUp={idx > 0}
                                                      canMoveDown={
                                                        idx < items.length - 1
                                                      }
                                                      onMoveUp={() =>
                                                        moveShortcutCardInZone(
                                                          zoneKey,
                                                          item.id,
                                                          -1
                                                        )
                                                      }
                                                      onMoveDown={() =>
                                                        moveShortcutCardInZone(
                                                          zoneKey,
                                                          item.id,
                                                          1
                                                        )
                                                      }
                                                      itemLabel={item.title}
                                                    />
                                                    <div className="flex items-center gap-1">
                                                      <button
                                                        type="button"
                                                        onClick={() =>
                                                          void handleToggleItem(
                                                            item
                                                          )
                                                        }
                                                        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:border-[var(--ps-accent)] hover:text-[var(--ps-text)] cursor-pointer"
                                                        title={
                                                          item.is_enabled
                                                            ? 'Hide card'
                                                            : 'Show card'
                                                        }
                                                        aria-label={
                                                          item.is_enabled
                                                            ? `Hide ${item.title}`
                                                            : `Show ${item.title}`
                                                        }
                                                      >
                                                        {item.is_enabled ? (
                                                          <Eye className="h-3.5 w-3.5" />
                                                        ) : (
                                                          <EyeOff className="h-3.5 w-3.5" />
                                                        )}
                                                      </button>
                                                      <button
                                                        type="button"
                                                        onClick={() =>
                                                          openEditItemModal(item)
                                                        }
                                                        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:border-[var(--ps-accent)] hover:text-[var(--ps-accent)] cursor-pointer"
                                                        title="Edit shortcut card"
                                                        aria-label={`Edit ${item.title}`}
                                                      >
                                                        <Edit3 className="h-3.5 w-3.5" />
                                                      </button>
                                                      <button
                                                        type="button"
                                                        onClick={() =>
                                                          void handleDeleteItem(
                                                            item
                                                          )
                                                        }
                                                        className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:border-rose-500/50 hover:text-rose-600 cursor-pointer"
                                                        title="Delete card"
                                                        aria-label={`Delete ${item.title}`}
                                                      >
                                                        <Trash2 className="h-3.5 w-3.5" />
                                                      </button>
                                                    </div>
                                                  </div>
                                                </div>
                                              </div>
                                            )}
                                          </SortablePreviewItem>
                                        );
                                      })}
                                    </div>
                                  )}
                                </SortableContext>
                              )}
                            </div>
                          )}
                        </DroppableContainerZone>
                      );
                    })}
                  </div>

                  <DragOverlay>
                    {activeDraggedShortcut ? (
                      <div className="rounded-2xl border-2 border-[var(--ps-accent)] bg-[var(--ps-surface)] p-3 shadow-xl opacity-95 w-[210px]">
                        <p className="text-xs font-bold text-[var(--ps-text)] truncate">
                          {activeDraggedShortcut.title}
                        </p>
                        {activeDraggedShortcut.subtitle && (
                          <p className="mt-0.5 text-[10.5px] text-[var(--ps-text-muted)] truncate">
                            {activeDraggedShortcut.subtitle}
                          </p>
                        )}
                      </div>
                    ) : null}
                  </DragOverlay>
                </DndContext>
              </div>

              {/* 1C. Quick Jump Chips Live Preview Strip */}
              <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <Sparkles className="h-4 w-4 text-[var(--ps-accent)]" />
                      <h3 className="text-sm font-bold text-[var(--ps-text)]">
                        Quick Jump Chips ({quickJumpItems.length})
                      </h3>
                    </div>
                    <p className="mt-0.5 text-[11px] text-[var(--ps-text-muted)]">
                      1-tap pre-filtered search pills rendered directly below the
                      shortcut grid.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        void handleResetSectionDefaults('quick_jump')
                      }
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs font-semibold text-[var(--ps-text-muted)] hover:border-rose-500/40 hover:text-rose-600 cursor-pointer"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span>Reset Defaults</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => openCreateItemModal('quick_jump', null)}
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3.5 text-xs font-bold text-[var(--ps-accent-fg)] shadow-xs hover:opacity-95 cursor-pointer"
                    >
                      <Plus className="h-4 w-4" />
                      <span>Add Quick Jump</span>
                    </button>
                  </div>
                </div>

                {/* Live Strip Simulation */}
                <div className="flex items-center gap-1.5 overflow-x-auto rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-2.5 no-scrollbar">
                  <span className="inline-flex shrink-0 items-center gap-1 text-[10px] font-extrabold uppercase tracking-wider text-[var(--ps-text-muted)] pr-1">
                    <Sparkles className="h-3 w-3 text-[var(--ps-accent)]" />
                    <span>Live Strip:</span>
                  </span>
                  {quickJumpItems
                    .filter((q) => q.is_enabled)
                    .map((chip) => {
                      const Icon = getIconByKey(chip.icon_key);
                      return (
                        <span
                          key={chip.id}
                          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 text-[11px] font-semibold text-[var(--ps-text)]"
                        >
                          <Icon
                            className="h-3 w-3 shrink-0"
                            style={{ color: chip.accent_color }}
                          />
                          <span>{chip.title}</span>
                        </span>
                      );
                    })}
                </div>

                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={(e) => handleSimpleSectionDragEnd('quick_jump', e)}
                >
                  <SortableContext
                    items={quickJumpItems.map((i) => i.id)}
                    strategy={rectSortingStrategy}
                  >
                    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                      {quickJumpItems.map((chip, idx) => {
                        const Icon = getIconByKey(chip.icon_key);
                        const href = resolveHomepageItemHref(
                          chip.route_key,
                          chip.query_params,
                          'churachandpur'
                        );
                        return (
                          <SortablePreviewItem
                            key={chip.id}
                            id={chip.id}
                            dragLabel={`Reorder ${chip.title} quick jump`}
                          >
                            {({ dragHandleProps }) => (
                              <div
                                className={`flex flex-col justify-between gap-2 rounded-2xl border p-3 ${
                                  chip.is_enabled
                                    ? 'border-[var(--ps-border)] bg-[var(--ps-bg)]'
                                    : 'border-dashed border-[var(--ps-border)] bg-[var(--ps-bg)]/50 opacity-55'
                                }`}
                              >
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex items-center gap-2 min-w-0">
                                    <DragHandleButton
                                      handleProps={dragHandleProps}
                                      compact
                                    />
                                    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 py-1 text-xs font-semibold text-[var(--ps-text)] truncate">
                                      <Icon
                                        className="h-3.5 w-3.5 shrink-0"
                                        style={{ color: chip.accent_color }}
                                      />
                                      <span className="truncate">
                                        {chip.title}
                                      </span>
                                    </span>
                                  </div>
                                </div>
                                <p className="font-mono text-[10px] text-[var(--ps-text-muted)] truncate">
                                  {href}
                                </p>
                                <div className="flex items-center justify-between gap-1 border-t border-[var(--ps-border)]/70 pt-2">
                                  <MobileOrderButtons
                                    canMoveUp={idx > 0}
                                    canMoveDown={idx < quickJumpItems.length - 1}
                                    onMoveUp={() =>
                                      moveSimpleSectionItem(
                                        'quick_jump',
                                        chip.id,
                                        -1
                                      )
                                    }
                                    onMoveDown={() =>
                                      moveSimpleSectionItem(
                                        'quick_jump',
                                        chip.id,
                                        1
                                      )
                                    }
                                    itemLabel={chip.title}
                                  />
                                  <div className="flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => void handleToggleItem(chip)}
                                      className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:border-[var(--ps-accent)] hover:text-[var(--ps-text)] cursor-pointer"
                                      aria-label={`Toggle ${chip.title}`}
                                    >
                                      {chip.is_enabled ? (
                                        <Eye className="h-3.5 w-3.5" />
                                      ) : (
                                        <EyeOff className="h-3.5 w-3.5" />
                                      )}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => openEditItemModal(chip)}
                                      className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:border-[var(--ps-accent)] hover:text-[var(--ps-accent)] cursor-pointer"
                                      aria-label={`Edit ${chip.title}`}
                                    >
                                      <Edit3 className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void handleDeleteItem(chip)}
                                      className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:border-rose-500/50 hover:text-rose-600 cursor-pointer"
                                      aria-label={`Delete ${chip.title}`}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                </div>
                              </div>
                            )}
                          </SortablePreviewItem>
                        );
                      })}
                    </div>
                  </SortableContext>
                </DndContext>
              </div>
            </div>
          )}

          {/* ================================================================= */}
          {/* TAB 2: SPOTLIGHT BANNERS & FEATURED PLACES                        */}
          {/* ================================================================= */}
          {activeTab === 'featured' && (
            <div className="space-y-5">
              {/* 2A. Spotlight Banners */}
              <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 className="text-sm font-bold text-[var(--ps-text)]">
                      Homepage Spotlight Banners ({bannerItems.length})
                    </h3>
                    <p className="mt-0.5 text-[11px] text-[var(--ps-text-muted)]">
                      Live editorial promo banners rendered beneath the launchpad.
                      Drag to set display order.
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() =>
                        void handleResetSectionDefaults('featured_banner')
                      }
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs font-semibold text-[var(--ps-text-muted)] hover:border-rose-500/40 hover:text-rose-600 cursor-pointer"
                    >
                      <RotateCcw className="h-3.5 w-3.5" />
                      <span>Reset Defaults</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => openCreateItemModal('featured_banner', null)}
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3.5 text-xs font-bold text-[var(--ps-accent-fg)] shadow-xs hover:opacity-95 cursor-pointer"
                    >
                      <Plus className="h-4 w-4" />
                      <span>Add Banner</span>
                    </button>
                  </div>
                </div>

                <DndContext
                  sensors={sensors}
                  collisionDetection={closestCenter}
                  onDragEnd={(e) =>
                    handleSimpleSectionDragEnd('featured_banner', e)
                  }
                >
                  <SortableContext
                    items={bannerItems.map((b) => b.id)}
                    strategy={rectSortingStrategy}
                  >
                    <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                      {bannerItems.map((banner, idx) => {
                        const Icon = getIconByKey(banner.icon_key);
                        const href = resolveHomepageItemHref(
                          banner.route_key,
                          banner.query_params,
                          'churachandpur'
                        );
                        return (
                          <SortablePreviewItem
                            key={banner.id}
                            id={banner.id}
                            dragLabel={`Reorder ${banner.title} banner`}
                          >
                            {({ dragHandleProps }) => (
                              <div
                                className={`flex flex-col justify-between gap-3 rounded-2xl border p-3.5 ${
                                  !banner.is_enabled ? 'opacity-55 border-dashed' : ''
                                }`}
                                style={{
                                  borderColor: `${banner.accent_color}38`,
                                  backgroundColor: `${banner.accent_color}0D`,
                                }}
                              >
                                <div className="flex items-start justify-between gap-3">
                                  <div className="flex items-start gap-3 min-w-0">
                                    <DragHandleButton
                                      handleProps={dragHandleProps}
                                      compact
                                    />
                                    <div
                                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white"
                                      style={{
                                        backgroundColor: banner.accent_color,
                                      }}
                                    >
                                      <Icon className="h-4.5 w-4.5" />
                                    </div>
                                    <div className="min-w-0">
                                      <p className="text-xs font-bold text-[var(--ps-text)]">
                                        {banner.title}
                                      </p>
                                      {banner.subtitle && (
                                        <p className="mt-0.5 text-[11px] text-[var(--ps-text-muted)] line-clamp-2">
                                          {banner.subtitle}
                                        </p>
                                      )}
                                      <p className="mt-1 font-mono text-[10px] text-[var(--ps-text-muted)] truncate">
                                        {href}
                                      </p>
                                    </div>
                                  </div>
                                  <ArrowRight className="h-4 w-4 shrink-0 text-[var(--ps-text-muted)]" />
                                </div>

                                <div className="flex items-center justify-between gap-2 border-t border-[var(--ps-border)]/60 pt-2">
                                  <MobileOrderButtons
                                    canMoveUp={idx > 0}
                                    canMoveDown={idx < bannerItems.length - 1}
                                    onMoveUp={() =>
                                      moveSimpleSectionItem(
                                        'featured_banner',
                                        banner.id,
                                        -1
                                      )
                                    }
                                    onMoveDown={() =>
                                      moveSimpleSectionItem(
                                        'featured_banner',
                                        banner.id,
                                        1
                                      )
                                    }
                                    itemLabel={banner.title}
                                  />
                                  <div className="flex items-center gap-1">
                                    <button
                                      type="button"
                                      onClick={() => void handleToggleItem(banner)}
                                      className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:border-[var(--ps-accent)] cursor-pointer"
                                      aria-label={`Toggle ${banner.title}`}
                                    >
                                      {banner.is_enabled ? (
                                        <Eye className="h-3.5 w-3.5" />
                                      ) : (
                                        <EyeOff className="h-3.5 w-3.5" />
                                      )}
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => openEditItemModal(banner)}
                                      className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:border-[var(--ps-accent)] hover:text-[var(--ps-accent)] cursor-pointer"
                                      aria-label={`Edit ${banner.title}`}
                                    >
                                      <Edit3 className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => void handleDeleteItem(banner)}
                                      className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:border-rose-500/50 hover:text-rose-600 cursor-pointer"
                                      aria-label={`Delete ${banner.title}`}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                </div>
                              </div>
                            )}
                          </SortablePreviewItem>
                        );
                      })}
                    </div>
                  </SortableContext>
                </DndContext>
              </div>

              {/* 2B. Featured Places Pinned Order */}
              <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <Star className="h-4 w-4 text-amber-500" />
                      <h3 className="text-sm font-bold text-[var(--ps-text)]">
                        Pinned Featured Places ({orderedPinnedListings.length})
                      </h3>
                    </div>
                    <p className="mt-0.5 text-[11px] text-[var(--ps-text-muted)]">
                      Drag cards to set exact <span className="font-mono">featured_order</span>{' '}
                      sequence on the live homepage.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setPinModalOpen(true)}
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3.5 text-xs font-bold text-[var(--ps-accent-fg)] shadow-xs hover:opacity-95 cursor-pointer"
                  >
                    <Pin className="h-4 w-4" />
                    <span>Pin Verified Listing</span>
                  </button>
                </div>

                {orderedPinnedListings.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-bg)] p-6 text-center text-xs text-[var(--ps-text-muted)]">
                    No listings are manually pinned yet. The homepage currently
                    falls back to top-rated listings. Click &ldquo;Pin Verified
                    Listing&rdquo; to curate Featured Places.
                  </div>
                ) : (
                  <DndContext
                    sensors={sensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handlePinnedDragEnd}
                  >
                    <SortableContext
                      items={orderedPinnedListings.map((l) => l.id)}
                      strategy={rectSortingStrategy}
                    >
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {orderedPinnedListings.map((listing, idx) => (
                          <SortablePreviewItem
                            key={listing.id}
                            id={listing.id}
                            dragLabel={`Reorder featured place ${listing.title}`}
                          >
                            {({ dragHandleProps }) => (
                              <div className="flex h-full flex-col justify-between gap-2.5 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3.5">
                                <div className="flex items-start justify-between gap-2">
                                  <div className="flex items-start gap-2 min-w-0">
                                    <DragHandleButton
                                      handleProps={dragHandleProps}
                                      compact
                                    />
                                    <div className="min-w-0">
                                      <span className="inline-flex items-center gap-1 rounded-md bg-[var(--ps-accent)]/12 px-1.5 py-0.5 text-[10px] font-bold text-[var(--ps-accent)] tabular-nums">
                                        Slot #{idx + 1}
                                      </span>
                                      <p className="mt-1 text-xs font-bold text-[var(--ps-text)] truncate">
                                        {listing.title}
                                      </p>
                                      <p className="text-[11px] text-[var(--ps-text-muted)] truncate">
                                        {listing.locality} ·{' '}
                                        {listing.category.replace(/_/g, ' ')}
                                      </p>
                                    </div>
                                  </div>
                                  <span className="inline-flex shrink-0 items-center gap-0.5 rounded-lg bg-amber-500/12 px-2 py-0.5 text-[11px] font-bold text-amber-700 dark:text-amber-300">
                                    <Star className="h-3 w-3 fill-current" />
                                    {listing.rating.toFixed(1)}
                                  </span>
                                </div>

                                <div className="flex items-center justify-between gap-2 border-t border-[var(--ps-border)]/70 pt-2">
                                  <MobileOrderButtons
                                    canMoveUp={idx > 0}
                                    canMoveDown={
                                      idx < orderedPinnedListings.length - 1
                                    }
                                    onMoveUp={() =>
                                      movePinnedByStep(listing.id, -1)
                                    }
                                    onMoveDown={() =>
                                      movePinnedByStep(listing.id, 1)
                                    }
                                    itemLabel={listing.title}
                                  />
                                  <button
                                    type="button"
                                    onClick={() =>
                                      void handleUnpinListing(listing)
                                    }
                                    className="inline-flex min-h-[40px] items-center gap-1 rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 text-[11px] font-semibold text-amber-800 dark:text-amber-200 hover:bg-amber-500/20 cursor-pointer"
                                  >
                                    <PinOff className="h-3.5 w-3.5" />
                                    <span>Unpin</span>
                                  </button>
                                </div>
                              </div>
                            )}
                          </SortablePreviewItem>
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                )}
              </div>
            </div>
          )}

          {/* ================================================================= */}
          {/* TAB 3: POPULAR LOCALITIES                                         */}
          {/* ================================================================= */}
          {activeTab === 'localities' && (
            <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-[var(--ps-accent)]" />
                    <h3 className="text-sm font-bold text-[var(--ps-text)]">
                      Popular Localities &amp; Map Hubs ({sortedLocalities.length})
                    </h3>
                  </div>
                  <p className="mt-0.5 text-[11px] text-[var(--ps-text-muted)]">
                    Drag cards to reorder the homepage Explore Hubs strip. Click
                    Edit to update map coordinates or zoom.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={openCreateLocalityModal}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3.5 text-xs font-bold text-[var(--ps-accent-fg)] shadow-xs hover:opacity-95 cursor-pointer"
                >
                  <Plus className="h-4 w-4" />
                  <span>Add Locality</span>
                </button>
              </div>

              {/* Live Strip Preview (clean text chips without icons) */}
              <div className="flex items-center gap-1.5 overflow-x-auto rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-2.5 no-scrollbar">
                <span className="inline-flex shrink-0 items-center text-[10px] font-extrabold uppercase tracking-wider text-[var(--ps-text-muted)] pr-1">
                  Live Hubs Strip:
                </span>
                {sortedLocalities
                  .filter((l) => l.is_enabled)
                  .map((loc) => (
                    <span
                      key={loc.id}
                      className="inline-flex h-8 shrink-0 items-center rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 text-[11px] font-semibold text-[var(--ps-text)]"
                    >
                      {loc.name}
                    </span>
                  ))}
              </div>

              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleLocalityDragEnd}
              >
                <SortableContext
                  items={sortedLocalities.map((l) => l.id)}
                  strategy={verticalListSortingStrategy}
                >
                  <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                    {sortedLocalities.map((loc, idx) => {
                      const exploreHref = buildPopularLocalityExploreHref(
                        loc,
                        'churachandpur'
                      );
                      return (
                        <SortablePreviewItem
                          key={loc.id}
                          id={loc.id}
                          dragLabel={`Reorder locality ${loc.name}`}
                        >
                          {({ dragHandleProps }) => (
                            <div
                              className={`flex flex-col justify-between gap-2.5 rounded-2xl border p-3.5 ${
                                loc.is_enabled
                                  ? 'border-[var(--ps-border)] bg-[var(--ps-bg)]'
                                  : 'border-dashed border-[var(--ps-border)] bg-[var(--ps-bg)]/50 opacity-55'
                              }`}
                            >
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  <DragHandleButton
                                    handleProps={dragHandleProps}
                                    compact
                                  />
                                  <div className="min-w-0">
                                    <p className="text-xs font-bold text-[var(--ps-text)] truncate">
                                      {loc.name}
                                    </p>
                                    <p className="font-mono text-[10.5px] text-[var(--ps-text-muted)]">
                                      {loc.lat.toFixed(4)}, {loc.lng.toFixed(4)}{' '}
                                      · z{loc.default_zoom}
                                    </p>
                                  </div>
                                </div>
                              </div>
                              <p className="font-mono text-[10px] text-[var(--ps-text-muted)] truncate">
                                {exploreHref}
                              </p>
                              <div className="flex items-center justify-between gap-1 border-t border-[var(--ps-border)]/70 pt-2">
                                <MobileOrderButtons
                                  canMoveUp={idx > 0}
                                  canMoveDown={idx < sortedLocalities.length - 1}
                                  onMoveUp={() =>
                                    moveLocalityByStep(loc.id, -1)
                                  }
                                  onMoveDown={() =>
                                    moveLocalityByStep(loc.id, 1)
                                  }
                                  itemLabel={loc.name}
                                />
                                <div className="flex items-center gap-1">
                                  <button
                                    type="button"
                                    onClick={() => void handleToggleLocality(loc)}
                                    className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:border-[var(--ps-accent)] cursor-pointer"
                                    aria-label={`Toggle ${loc.name}`}
                                  >
                                    {loc.is_enabled ? (
                                      <Eye className="h-3.5 w-3.5" />
                                    ) : (
                                      <EyeOff className="h-3.5 w-3.5" />
                                    )}
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => openEditLocalityModal(loc)}
                                    className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:border-[var(--ps-accent)] hover:text-[var(--ps-accent)] cursor-pointer"
                                    aria-label={`Edit ${loc.name}`}
                                  >
                                    <Edit3 className="h-3.5 w-3.5" />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleDeleteLocality(loc)}
                                    className="inline-flex h-10 w-10 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:border-rose-500/50 hover:text-rose-600 cursor-pointer"
                                    aria-label={`Delete ${loc.name}`}
                                  >
                                    <Trash2 className="h-3.5 w-3.5" />
                                  </button>
                                </div>
                              </div>
                            </div>
                          )}
                        </SortablePreviewItem>
                      );
                    })}
                  </div>
                </SortableContext>
              </DndContext>
            </div>
          )}

          {/* ================================================================= */}
          {/* TAB 4: PICK N DROP 5-TIER RATES (SORTABLE LIVE FARE PREVIEW)      */}
          {/* ================================================================= */}
          {activeTab === 'pnd_rates' && (
            <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-4">
              <div>
                <div className="flex items-center gap-2">
                  <Truck className="h-4 w-4 text-[var(--ps-accent)]" />
                  <h3 className="text-sm font-bold text-[var(--ps-text)]">
                    Pick N Drop 5-Tier Transparent Fares ({sortedVehicleRates.length})
                  </h3>
                </div>
                <p className="mt-0.5 text-[11px] text-[var(--ps-text-muted)]">
                  Drag handles to reorder how vehicle tiers display on the
                  homepage &amp; booking calculator, then click{' '}
                  <strong>Save Order</strong>. Click <strong>Edit Rates</strong>{' '}
                  to adjust pricing inside the validated modal.
                </p>
              </div>

              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleVehicleRateDragEnd}
              >
                <SortableContext
                  items={sortedVehicleRates.map((t) => t.id)}
                  strategy={rectSortingStrategy}
                >
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                    {sortedVehicleRates.map((tier, idx) => (
                      <SortablePreviewItem
                        key={tier.id}
                        id={tier.id}
                        dragLabel={`Reorder fleet tier ${tier.name}`}
                      >
                        {({ dragHandleProps }) => (
                          <div
                            className={`flex h-full flex-col justify-between gap-3 rounded-2xl border p-4 transition-colors ${
                              tier.is_active
                                ? 'border-[var(--ps-border)] bg-[var(--ps-bg)]'
                                : 'border-dashed border-rose-500/35 bg-[var(--ps-bg)]/50 opacity-65'
                            }`}
                          >
                            <div className="space-y-3">
                              <div className="flex items-start justify-between gap-2">
                                <div className="flex items-center gap-2 min-w-0">
                                  <DragHandleButton
                                    handleProps={dragHandleProps}
                                    compact
                                  />
                                  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--ps-accent)]/12 text-[var(--ps-accent)]">
                                    {renderTierIcon(tier.slug)}
                                  </span>
                                  <div className="min-w-0">
                                    <p className="text-sm font-bold text-[var(--ps-text)] truncate">
                                      {tier.name}
                                    </p>
                                    <p className="font-mono text-[10.5px] text-[var(--ps-text-muted)]">
                                      {tier.slug} · #{tier.sort_order}
                                    </p>
                                  </div>
                                </div>
                                <span
                                  className={`shrink-0 rounded-lg px-2 py-0.5 text-[10px] font-bold ${
                                    tier.is_active
                                      ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                                      : 'bg-rose-500/12 text-rose-700 dark:text-rose-300'
                                  }`}
                                >
                                  {tier.is_active ? 'Active' : 'Disabled'}
                                </span>
                              </div>

                              <div className="grid grid-cols-2 gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3">
                                <div>
                                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--ps-text-muted)]">
                                    Base Fare
                                  </p>
                                  <p className="text-base font-extrabold text-[var(--ps-text)] tabular-nums">
                                    ₹{tier.base_fare_inr}
                                  </p>
                                </div>
                                <div>
                                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--ps-text-muted)]">
                                    Per km
                                  </p>
                                  <p className="text-base font-extrabold text-[var(--ps-text)] tabular-nums">
                                    ₹{tier.per_km_rate_inr}/km
                                  </p>
                                </div>
                                <div>
                                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--ps-text-muted)]">
                                    Return Mult.
                                  </p>
                                  <p className="text-xs font-bold text-[var(--ps-text)] tabular-nums">
                                    {tier.two_way_multiplier}×
                                  </p>
                                </div>
                                <div>
                                  <p className="text-[10px] font-semibold uppercase tracking-wider text-[var(--ps-text-muted)]">
                                    Payload Cap
                                  </p>
                                  <p className="text-xs font-bold text-[var(--ps-text)] tabular-nums">
                                    Up to {tier.max_weight_kg} kg
                                  </p>
                                </div>
                              </div>

                              {tier.max_dimensions && (
                                <p className="text-[11px] text-[var(--ps-text-muted)]">
                                  Capacity: {tier.max_dimensions}
                                </p>
                              )}
                            </div>

                            <div className="space-y-2 border-t border-[var(--ps-border)]/70 pt-3">
                              <div className="flex items-center justify-between">
                                <span className="text-[10px] font-semibold uppercase tracking-wider text-[var(--ps-text-muted)]">
                                  Order Position
                                </span>
                                <MobileOrderButtons
                                  canMoveUp={idx > 0}
                                  canMoveDown={
                                    idx < sortedVehicleRates.length - 1
                                  }
                                  onMoveUp={() =>
                                    moveVehicleRateByStep(tier.id, -1)
                                  }
                                  onMoveDown={() =>
                                    moveVehicleRateByStep(tier.id, 1)
                                  }
                                  itemLabel={tier.name}
                                />
                              </div>

                              <div className="flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => openEditRateModal(tier)}
                                  className="inline-flex min-h-[44px] flex-1 items-center justify-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3 text-xs font-bold text-[var(--ps-accent-fg)] shadow-xs hover:opacity-95 cursor-pointer"
                                >
                                  <Edit3 className="h-3.5 w-3.5" />
                                  <span>Edit Rates</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() =>
                                    void handleToggleVehicleTier(tier)
                                  }
                                  className={`inline-flex min-h-[44px] items-center justify-center rounded-xl border px-3 text-xs font-semibold cursor-pointer ${
                                    tier.is_active
                                      ? 'border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300 hover:bg-rose-500/20'
                                      : 'border-emerald-500/35 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300 hover:bg-emerald-500/20'
                                  }`}
                                >
                                  {tier.is_active ? 'Disable' : 'Enable'}
                                </button>
                              </div>
                            </div>
                          </div>
                        )}
                      </SortablePreviewItem>
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            </div>
          )}
        </>
      )}

      {/* =================================================================== */}
      {/* STICKY BATCHED SEQUENCE SAVE BAR                                    */}
      {/* =================================================================== */}
      {pendingSequenceDiff.hasChanges && (
        <div
          role="region"
          aria-label="Unsaved sequence changes"
          className="fixed bottom-4 left-4 right-4 z-[80] mx-auto max-w-3xl rounded-2xl border border-[var(--ps-accent)]/45 bg-[var(--ps-surface)]/95 p-3 shadow-2xl backdrop-blur-md sm:px-4"
        >
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-bold text-[var(--ps-text)]">
                Unsaved Sequence Changes ({pendingSequenceDiff.totalCount})
              </p>
              <p className="text-[11px] text-[var(--ps-text-muted)]">
                Your drag-and-drop sequence is staged locally. Save Order to write
                to Supabase and refresh <span className="font-mono">/</span>.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={discardSequenceChanges}
                disabled={savingBatchOrder}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] disabled:opacity-50 cursor-pointer"
              >
                <Undo2 className="h-3.5 w-3.5" />
                <span>Discard</span>
              </button>
              <button
                type="button"
                onClick={() => void handleSaveBatchedSequence()}
                disabled={savingBatchOrder}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-4 text-xs font-bold text-[var(--ps-accent-fg)] shadow-xs hover:opacity-95 disabled:opacity-50 cursor-pointer"
              >
                {savingBatchOrder ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Save className="h-4 w-4" />
                )}
                <span>Save Order</span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
