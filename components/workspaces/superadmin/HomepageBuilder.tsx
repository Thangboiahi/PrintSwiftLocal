'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Check,
  Edit3,
  ExternalLink,
  Eye,
  EyeOff,
  LayoutGrid,
  Loader2,
  MapPin,
  Pin,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Sparkles,
  Star,
  Trash2,
  Truck,
  X,
} from 'lucide-react';
import { supabase, isSupabaseConfigured } from '@/lib/supabase/client';
import { IconPicker } from '@/components/ui/IconPicker';
import { getIconByKey, normalizeIconKey } from '@/lib/icons/registry';
import { useConfirmDialog } from '@/components/ui/ConfirmActionModal';
import { notifyAppConfigUpdated } from '@/components/providers/AppConfigProvider';
import {
  DEFAULT_HOMEPAGE_BANNERS,
  DEFAULT_HOMEPAGE_QUICK_JUMPS,
  DEFAULT_HOMEPAGE_SHORTCUTS,
  HOMEPAGE_CONTAINER_STYLE_OPTIONS,
  HOMEPAGE_ROUTE_OPTIONS,
  buildPopularLocalityExploreHref,
  normalizeContainerStyle,
  normalizeQueryParamsRecord,
  resolveHomepageItemHref,
  type HomepageContainerStyle,
  type HomepageItemRecord,
  type HomepageSection,
  type PopularLocalityRecord,
} from '@/lib/home/homepage-config';

type BuilderTab = 'shortcuts' | 'featured' | 'localities' | 'pnd_rates';

interface FeaturedListingRow {
  id: string;
  title: string;
  category: string;
  locality: string;
  rating: number;
  status: string;
  is_featured: boolean;
  featured_order: number;
}

interface VehicleTypeRateRow {
  id: string;
  slug: string;
  name: string;
  icon: string | null;
  base_fare_inr: number;
  per_km_rate_inr: number;
  two_way_multiplier: number;
  max_weight_kg: number;
  max_dimensions: string | null;
  supported_modes: string[];
  is_active: boolean;
}

interface HomepageItemDraft {
  id?: string;
  item_key?: string | null;
  section: HomepageSection;
  title: string;
  subtitle: string;
  container_style: HomepageContainerStyle;
  icon_key: string;
  accent_color: string;
  route_key: string;
  query_params: Record<string, string>;
  sort_order: number;
  is_enabled: boolean;
}

interface LocalityDraft {
  id?: string;
  name: string;
  slug: string;
  icon_key: string;
  lat: string;
  lng: string;
  default_zoom: string;
  sort_order: number;
  is_enabled: boolean;
}

interface HomepageBuilderProps {
  onNotice?: (notice: { type: 'success' | 'error'; text: string } | null) => void;
}

function slugifyLocality(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function HomepageBuilder({ onNotice }: HomepageBuilderProps) {
  const { confirm, dialog } = useConfirmDialog();
  const [activeTab, setActiveTab] = useState<BuilderTab>('shortcuts');
  const [sectionFilter, setSectionFilter] = useState<'shortcut_grid' | 'quick_jump'>('shortcut_grid');

  // State: homepage_items
  const [homepageItems, setHomepageItems] = useState<HomepageItemRecord[]>([]);
  const [loadingItems, setLoadingItems] = useState<boolean>(true);
  const [savingItem, setSavingItem] = useState<boolean>(false);
  const [editingItem, setEditingItem] = useState<HomepageItemDraft | null>(null);
  const [customParamKey, setCustomParamKey] = useState('');
  const [customParamVal, setCustomParamVal] = useState('');

  // State: Featured Places (published listings)
  const [listings, setListings] = useState<FeaturedListingRow[]>([]);
  const [loadingListings, setLoadingListings] = useState<boolean>(false);
  const [listingSearch, setListingSearch] = useState<string>('');
  const [savingListingId, setSavingListingId] = useState<string | null>(null);

  // State: Popular Localities
  const [localities, setLocalities] = useState<PopularLocalityRecord[]>([]);
  const [loadingLocalities, setLoadingLocalities] = useState<boolean>(false);
  const [editingLocality, setEditingLocality] = useState<LocalityDraft | null>(null);
  const [savingLocality, setSavingLocality] = useState<boolean>(false);

  // State: Pick N Drop 5-Tier Rates (`vehicle_types`)
  const [vehicleRates, setVehicleRates] = useState<VehicleTypeRateRow[]>([]);
  const [rateEdits, setRateEdits] = useState<
    Record<
      string,
      {
        base_fare_inr: string;
        per_km_rate_inr: string;
        two_way_multiplier: string;
        max_weight_kg: string;
        max_dimensions: string;
      }
    >
  >({});
  const [loadingRates, setLoadingRates] = useState<boolean>(false);
  const [savingRateId, setSavingRateId] = useState<string | null>(null);

  // Revalidation status
  const [revalidating, setRevalidating] = useState<boolean>(false);
  const [lastRevalidatedAt, setLastRevalidatedAt] = useState<string | null>(null);
  const [localBanner, setLocalBanner] = useState<{
    type: 'success' | 'error';
    text: string;
  } | null>(null);

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

  // ---------------------------------------------------------------------------
  // LOADERS
  // ---------------------------------------------------------------------------
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
      const rows = ((data || []) as Array<Record<string, unknown>>).map((r) => ({
        id: String(r.id),
        item_key: r.item_key ? String(r.item_key) : null,
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
      setHomepageItems(rows);
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
    if (!isSupabaseConfigured()) return;
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

      if (error) {
        // Graceful fallback if featured_order column is not migrated yet
        const fallback = await supabase
          .from('listings')
          .select('id, title, category, locality, rating, status')
          .eq('status', 'published')
          .order('rating', { ascending: false })
          .limit(80);
        if (fallback.error) throw fallback.error;
        setListings(
          ((fallback.data || []) as Array<Record<string, unknown>>).map((r) => ({
            id: String(r.id),
            title: String(r.title || 'Untitled'),
            category: String(r.category || 'business'),
            locality: String(r.locality || 'Lamka'),
            rating: Number(r.rating ?? 4.5),
            status: String(r.status || 'published'),
            is_featured: false,
            featured_order: 0,
          }))
        );
        return;
      }

      setListings(
        ((data || []) as Array<Record<string, unknown>>).map((r) => ({
          id: String(r.id),
          title: String(r.title || 'Untitled'),
          category: String(r.category || 'business'),
          locality: String(r.locality || 'Lamka'),
          rating: Number(r.rating ?? 4.5),
          status: String(r.status || 'published'),
          is_featured: Boolean(r.is_featured ?? false),
          featured_order: Number(r.featured_order ?? 0),
        }))
      );
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
    if (!isSupabaseConfigured()) return;
    setLoadingLocalities(true);
    try {
      const { data, error } = await supabase
        .from('popular_localities')
        .select('*')
        .order('sort_order', { ascending: true })
        .order('name', { ascending: true });
      if (error) throw error;
      setLocalities(
        ((data || []) as Array<Record<string, unknown>>).map((r) => ({
          id: String(r.id),
          name: String(r.name || ''),
          slug: String(r.slug || ''),
          icon_key: normalizeIconKey(String(r.icon_key || 'map-pin')),
          lat: Number(r.lat ?? 24.3335),
          lng: Number(r.lng ?? 93.6946),
          default_zoom: Number(r.default_zoom ?? 15),
          sort_order: Number(r.sort_order ?? 0),
          is_enabled: Boolean(r.is_enabled ?? true),
        }))
      );
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
    if (!isSupabaseConfigured()) return;
    setLoadingRates(true);
    try {
      const { data, error } = await supabase
        .from('vehicle_types')
        .select(
          'id, slug, name, icon, base_fare_inr, per_km_rate_inr, two_way_multiplier, max_weight_kg, max_dimensions, supported_modes, is_active'
        )
        .order('base_fare_inr', { ascending: true });
      if (error) throw error;
      const rows = ((data || []) as Array<Record<string, unknown>>).map((r) => ({
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
        is_active: Boolean(r.is_active ?? true),
      }));
      setVehicleRates(rows);
      const nextEdits: typeof rateEdits = {};
      for (const row of rows) {
        nextEdits[row.id] = {
          base_fare_inr: String(row.base_fare_inr),
          per_km_rate_inr: String(row.per_km_rate_inr),
          two_way_multiplier: String(row.two_way_multiplier),
          max_weight_kg: String(row.max_weight_kg),
          max_dimensions: row.max_dimensions || '',
        };
      }
      setRateEdits(nextEdits);
    } catch (err) {
      emitNotice(
        'error',
        err instanceof Error ? err.message : 'Failed to load Pick N Drop fleet rates.'
      );
    } finally {
      setLoadingRates(false);
    }
  }, [emitNotice]);

  useEffect(() => {
    queueMicrotask(() => {
      void loadHomepageItems();
      void loadListings();
      void loadLocalities();
      void loadVehicleRates();
    });
  }, [loadHomepageItems, loadListings, loadLocalities, loadVehicleRates]);

  // ---------------------------------------------------------------------------
  // HANDLERS: HOMEPAGE ITEMS (SHORTCUTS, QUICK JUMPS, FEATURED BANNERS)
  // ---------------------------------------------------------------------------
  const visibleSectionItems = useMemo(() => {
    const targetSection: HomepageSection =
      activeTab === 'featured' ? 'featured_banner' : sectionFilter;
    return homepageItems
      .filter((item) => item.section === targetSection)
      .sort((a, b) => a.sort_order - b.sort_order);
  }, [homepageItems, activeTab, sectionFilter]);

  const startCreateItem = (section: HomepageSection) => {
    const existing = homepageItems.filter((i) => i.section === section);
    const maxOrder = existing.reduce((m, i) => Math.max(m, i.sort_order), 0);
    setEditingItem({
      section,
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
    setCustomParamKey('');
    setCustomParamVal('');
  };

  const startEditItem = (item: HomepageItemRecord) => {
    setEditingItem({
      id: item.id,
      item_key: item.item_key,
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
    setCustomParamKey('');
    setCustomParamVal('');
  };

  const handleSaveItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem) return;
    if (!editingItem.title.trim()) {
      emitNotice('error', 'Title is required.');
      return;
    }

    setSavingItem(true);
    try {
      const payload = {
        section: editingItem.section,
        title: editingItem.title.trim(),
        subtitle: editingItem.subtitle.trim() || null,
        container_style: editingItem.container_style,
        icon_key: normalizeIconKey(editingItem.icon_key),
        accent_color: editingItem.accent_color || '#2563EB',
        route_key: editingItem.route_key || 'explore',
        query_params: normalizeQueryParamsRecord(editingItem.query_params),
        sort_order: Number(editingItem.sort_order) || 0,
        is_enabled: editingItem.is_enabled,
      };

      if (editingItem.id) {
        const { error } = await supabase
          .from('homepage_items')
          .update(payload)
          .eq('id', editingItem.id);
        if (error) throw error;
        emitNotice('success', `Updated "${payload.title}" and refreshed live homepage.`);
      } else {
        const { error } = await supabase.from('homepage_items').insert(payload);
        if (error) throw error;
        emitNotice('success', `Added "${payload.title}" to homepage.`);
      }

      setEditingItem(null);
      await loadHomepageItems();
      await triggerHomepageRevalidation();
    } catch (err) {
      emitNotice(
        'error',
        err instanceof Error ? err.message : 'Failed to save homepage item.'
      );
    } finally {
      setSavingItem(false);
    }
  };

  const handleToggleItemEnabled = async (item: HomepageItemRecord) => {
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
        err instanceof Error ? err.message : 'Failed to toggle visibility.'
      );
    }
  };

  const handleReorderItem = async (
    item: HomepageItemRecord,
    direction: 'up' | 'down',
    sectionItems: HomepageItemRecord[]
  ) => {
    const idx = sectionItems.findIndex((i) => i.id === item.id);
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (idx < 0 || swapIdx < 0 || swapIdx >= sectionItems.length) return;
    const neighbor = sectionItems[swapIdx];

    const newItemOrder =
      neighbor.sort_order === item.sort_order
        ? direction === 'up'
          ? item.sort_order - 5
          : item.sort_order + 5
        : neighbor.sort_order;
    const newNeighborOrder = item.sort_order;

    try {
      const [r1, r2] = await Promise.all([
        supabase
          .from('homepage_items')
          .update({ sort_order: newItemOrder })
          .eq('id', item.id),
        supabase
          .from('homepage_items')
          .update({ sort_order: newNeighborOrder })
          .eq('id', neighbor.id),
      ]);
      if (r1.error) throw r1.error;
      if (r2.error) throw r2.error;
      await loadHomepageItems();
      await triggerHomepageRevalidation();
    } catch (err) {
      emitNotice(
        'error',
        err instanceof Error ? err.message : 'Failed to reorder items.'
      );
    }
  };

  const handleDeleteItem = async (item: HomepageItemRecord) => {
    const ok = await confirm({
      title: `Delete "${item.title}"?`,
      description:
        'This item will be permanently removed from the homepage layout and recorded in the immutable audit log.',
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
          : '2 Featured Banners';

    const ok = await confirm({
      title: `Reset ${label} to Defaults?`,
      description:
        'This replaces current rows in this section with the canonical DD oodle Churachandpur defaults and immediately revalidates the live homepage.',
      confirmLabel: 'Reset to Defaults',
      variant: 'danger',
    });
    if (!ok) return;

    setSavingItem(true);
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

      const rows = defaults.map((d) => ({
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
      }));

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
      setSavingItem(false);
    }
  };

  // ---------------------------------------------------------------------------
  // HANDLERS: FEATURED PLACES (`listings.is_featured`, `featured_order`)
  // ---------------------------------------------------------------------------
  const pinnedListings = useMemo(
    () =>
      listings
        .filter((l) => l.is_featured || l.featured_order > 0)
        .sort((a, b) => {
          const ao = a.featured_order > 0 ? a.featured_order : 9999;
          const bo = b.featured_order > 0 ? b.featured_order : 9999;
          return ao - bo || b.rating - a.rating;
        }),
    [listings]
  );

  const searchableUnpinnedListings = useMemo(() => {
    const q = listingSearch.trim().toLowerCase();
    return listings
      .filter((l) => !l.is_featured && l.featured_order === 0)
      .filter((l) =>
        !q
          ? true
          : l.title.toLowerCase().includes(q) ||
            l.locality.toLowerCase().includes(q) ||
            l.category.toLowerCase().includes(q)
      )
      .slice(0, 20);
  }, [listings, listingSearch]);

  const handlePinListing = async (listing: FeaturedListingRow, pin: boolean) => {
    setSavingListingId(listing.id);
    try {
      const nextOrder = pin
        ? pinnedListings.reduce((m, l) => Math.max(m, l.featured_order), 0) + 10
        : 0;
      const { error } = await supabase
        .from('listings')
        .update({
          is_featured: pin,
          featured_order: nextOrder,
        })
        .eq('id', listing.id);
      if (error) throw error;
      emitNotice(
        'success',
        pin
          ? `Pinned "${listing.title}" to Featured Places (slot #${nextOrder}).`
          : `Unpinned "${listing.title}" from Featured Places.`
      );
      await loadListings();
      await triggerHomepageRevalidation();
    } catch (err) {
      emitNotice(
        'error',
        err instanceof Error
          ? err.message
          : 'Failed to update Featured status. Ensure Pass v15c SQL migration has been applied.'
      );
    } finally {
      setSavingListingId(null);
    }
  };

  const handleReorderPinnedListing = async (
    listing: FeaturedListingRow,
    direction: 'up' | 'down'
  ) => {
    const idx = pinnedListings.findIndex((l) => l.id === listing.id);
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (idx < 0 || swapIdx < 0 || swapIdx >= pinnedListings.length) return;
    const neighbor = pinnedListings[swapIdx];

    setSavingListingId(listing.id);
    try {
      const targetOrder =
        neighbor.featured_order === listing.featured_order
          ? direction === 'up'
            ? Math.max(1, listing.featured_order - 5)
            : listing.featured_order + 5
          : neighbor.featured_order || (swapIdx + 1) * 10;
      const neighborOrder = listing.featured_order || (idx + 1) * 10;

      const [r1, r2] = await Promise.all([
        supabase
          .from('listings')
          .update({ is_featured: true, featured_order: targetOrder })
          .eq('id', listing.id),
        supabase
          .from('listings')
          .update({ is_featured: true, featured_order: neighborOrder })
          .eq('id', neighbor.id),
      ]);
      if (r1.error) throw r1.error;
      if (r2.error) throw r2.error;
      await loadListings();
      await triggerHomepageRevalidation();
    } catch (err) {
      emitNotice(
        'error',
        err instanceof Error ? err.message : 'Failed to reorder featured listing.'
      );
    } finally {
      setSavingListingId(null);
    }
  };

  // ---------------------------------------------------------------------------
  // HANDLERS: POPULAR LOCALITIES
  // ---------------------------------------------------------------------------
  const startCreateLocality = () => {
    const maxOrder = localities.reduce((m, l) => Math.max(m, l.sort_order), 0);
    setEditingLocality({
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

  const startEditLocality = (loc: PopularLocalityRecord) => {
    setEditingLocality({
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

  const handleSaveLocality = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingLocality) return;
    const name = editingLocality.name.trim();
    const slug = slugifyLocality(editingLocality.slug || name);
    const lat = Number.parseFloat(editingLocality.lat);
    const lng = Number.parseFloat(editingLocality.lng);
    const defaultZoom = Number.parseInt(editingLocality.default_zoom, 10);

    if (!name || !slug) {
      emitNotice('error', 'Locality name and slug are required.');
      return;
    }
    if (!Number.isFinite(lat) || lat < -90 || lat > 90 || !Number.isFinite(lng) || lng < -180 || lng > 180) {
      emitNotice('error', 'Enter valid latitude (-90..90) and longitude (-180..180).');
      return;
    }

    setSavingLocality(true);
    try {
      const payload = {
        name,
        slug,
        icon_key: normalizeIconKey(editingLocality.icon_key),
        lat: Number(lat.toFixed(6)),
        lng: Number(lng.toFixed(6)),
        default_zoom: Number.isFinite(defaultZoom)
          ? Math.max(11, Math.min(19, defaultZoom))
          : 15,
        sort_order: Number(editingLocality.sort_order) || 0,
        is_enabled: editingLocality.is_enabled,
      };

      if (editingLocality.id) {
        const { error } = await supabase
          .from('popular_localities')
          .update(payload)
          .eq('id', editingLocality.id);
        if (error) throw error;
        emitNotice('success', `Updated locality "${payload.name}".`);
      } else {
        const { error } = await supabase.from('popular_localities').insert(payload);
        if (error) throw error;
        emitNotice('success', `Added popular locality "${payload.name}".`);
      }

      setEditingLocality(null);
      await loadLocalities();
      await triggerHomepageRevalidation();
    } catch (err) {
      emitNotice(
        'error',
        err instanceof Error ? err.message : 'Failed to save locality.'
      );
    } finally {
      setSavingLocality(false);
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
        `${!loc.is_enabled ? 'Enabled' : 'Disabled'} "${loc.name}".`
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

  const handleReorderLocality = async (
    loc: PopularLocalityRecord,
    direction: 'up' | 'down'
  ) => {
    const idx = localities.findIndex((l) => l.id === loc.id);
    const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
    if (idx < 0 || swapIdx < 0 || swapIdx >= localities.length) return;
    const neighbor = localities[swapIdx];
    try {
      const [r1, r2] = await Promise.all([
        supabase
          .from('popular_localities')
          .update({
            sort_order:
              neighbor.sort_order === loc.sort_order
                ? direction === 'up'
                  ? loc.sort_order - 5
                  : loc.sort_order + 5
                : neighbor.sort_order,
          })
          .eq('id', loc.id),
        supabase
          .from('popular_localities')
          .update({ sort_order: loc.sort_order })
          .eq('id', neighbor.id),
      ]);
      if (r1.error) throw r1.error;
      if (r2.error) throw r2.error;
      await loadLocalities();
      await triggerHomepageRevalidation();
    } catch (err) {
      emitNotice(
        'error',
        err instanceof Error ? err.message : 'Failed to reorder locality.'
      );
    }
  };

  const handleDeleteLocality = async (loc: PopularLocalityRecord) => {
    const ok = await confirm({
      title: `Delete "${loc.name}"?`,
      description:
        'Removing this Popular Locality hides its quick-jump map chip from the homepage.',
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

  // ---------------------------------------------------------------------------
  // HANDLERS: PICK N DROP 5-TIER RATES (`vehicle_types`)
  // ---------------------------------------------------------------------------
  const handleSaveVehicleRate = async (tier: VehicleTypeRateRow) => {
    const draft = rateEdits[tier.id];
    if (!draft) return;

    const baseFare = Number.parseFloat(draft.base_fare_inr);
    const perKm = Number.parseFloat(draft.per_km_rate_inr);
    const twoWayMult = Number.parseFloat(draft.two_way_multiplier);
    const maxWeight = Number.parseFloat(draft.max_weight_kg);

    if (
      !Number.isFinite(baseFare) ||
      baseFare < 0 ||
      !Number.isFinite(perKm) ||
      perKm < 0 ||
      !Number.isFinite(twoWayMult) ||
      twoWayMult < 1 ||
      twoWayMult > 5 ||
      !Number.isFinite(maxWeight) ||
      maxWeight <= 0
    ) {
      emitNotice(
        'error',
        'Please enter valid positive numbers (two-way multiplier between 1.0 and 5.0).'
      );
      return;
    }

    setSavingRateId(tier.id);
    try {
      const { error } = await supabase
        .from('vehicle_types')
        .update({
          base_fare_inr: baseFare,
          per_km_rate_inr: perKm,
          two_way_multiplier: twoWayMult,
          max_weight_kg: maxWeight,
          max_dimensions: draft.max_dimensions.trim() || null,
        })
        .eq('id', tier.id);
      if (error) throw error;
      emitNotice(
        'success',
        `Saved ${tier.name} rates (₹${baseFare} base, ₹${perKm}/km) and refreshed live homepage.`
      );
      await loadVehicleRates();
      await triggerHomepageRevalidation();
    } catch (err) {
      emitNotice(
        'error',
        err instanceof Error ? err.message : 'Failed to update vehicle tier rate.'
      );
    } finally {
      setSavingRateId(null);
    }
  };

  const handleToggleVehicleTierActive = async (tier: VehicleTypeRateRow) => {
    if (tier.is_active) {
      const ok = await confirm({
        title: `Disable ${tier.name} Tier?`,
        description:
          'Disabling this Pick N Drop vehicle tier immediately removes it from live homepage transparent fares and new customer quotes. Existing orders are unaffected.',
        confirmLabel: 'Disable Tier',
        variant: 'danger',
      });
      if (!ok) return;
    }

    setSavingRateId(tier.id);
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
    } finally {
      setSavingRateId(null);
    }
  };

  // Selected route metadata for structured query param picker
  const selectedRouteOption = useMemo(
    () =>
      HOMEPAGE_ROUTE_OPTIONS.find(
        (opt) => opt.key === editingItem?.route_key
      ) || HOMEPAGE_ROUTE_OPTIONS[0],
    [editingItem?.route_key]
  );

  // ---------------------------------------------------------------------------
  // RENDER HELPERS
  // ---------------------------------------------------------------------------
  const renderLivePreviewCard = (draft: HomepageItemDraft) => {
    const Icon = getIconByKey(draft.icon_key);
    const resolvedHref = resolveHomepageItemHref(
      draft.route_key,
      draft.query_params,
      'churachandpur'
    );

    if (draft.section === 'quick_jump' || draft.container_style === 'pill') {
      return (
        <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)] mb-2.5">
            Live Quick-Jump Preview
          </p>
          <div className="inline-flex items-center gap-2 rounded-full border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3.5 py-2 text-xs font-semibold text-[var(--ps-text)] shadow-xs">
            <span
              className="inline-flex h-5 w-5 items-center justify-center rounded-full"
              style={{
                backgroundColor: `${draft.accent_color}1A`,
                color: draft.accent_color,
              }}
            >
              <Icon className="h-3.5 w-3.5" />
            </span>
            <span>{draft.title || 'Quick Jump Label'}</span>
          </div>
          <p className="mt-3 text-[11px] font-mono text-[var(--ps-text-muted)] break-all">
            Target: {resolvedHref}
          </p>
        </div>
      );
    }

    if (draft.section === 'featured_banner' || draft.container_style === 'banner') {
      return (
        <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)] mb-2.5">
            Live Featured Banner Preview
          </p>
          <div
            className="flex items-start gap-3 rounded-xl border p-4"
            style={{
              borderColor: `${draft.accent_color}45`,
              backgroundColor: `${draft.accent_color}12`,
            }}
          >
            <div
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-white"
              style={{ backgroundColor: draft.accent_color }}
            >
              <Icon className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-bold text-[var(--ps-text)]">
                {draft.title || 'Featured Banner Headline'}
              </p>
              <p className="mt-0.5 text-xs text-[var(--ps-text-muted)]">
                {draft.subtitle || 'Short supporting highlight copy for Churachandpur residents.'}
              </p>
            </div>
          </div>
          <p className="mt-3 text-[11px] font-mono text-[var(--ps-text-muted)] break-all">
            Target: {resolvedHref}
          </p>
        </div>
      );
    }

    const cardSurfaceClass =
      draft.container_style === 'elevated'
        ? 'bg-[var(--ps-surface)] border-[var(--ps-border)] shadow-md'
        : draft.container_style === 'tinted'
          ? 'border-transparent'
          : 'bg-[var(--ps-surface)] border-[var(--ps-border)]';

    return (
      <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4">
        <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)] mb-2.5">
          Live Shortcut Card Preview
        </p>
        <div
          className={`flex flex-col justify-between rounded-xl border p-3.5 max-w-[230px] ${cardSurfaceClass}`}
          style={
            draft.container_style === 'tinted'
              ? {
                  backgroundColor: `${draft.accent_color}14`,
                  borderColor: `${draft.accent_color}40`,
                }
              : undefined
          }
        >
          <div
            className="flex h-9 w-9 items-center justify-center rounded-lg"
            style={{
              backgroundColor: `${draft.accent_color}18`,
              color: draft.accent_color,
            }}
          >
            <Icon className="h-4.5 w-4.5" />
          </div>
          <div className="mt-2.5">
            <p className="text-xs font-bold text-[var(--ps-text)]">
              {draft.title || 'Shortcut Title'}
            </p>
            <p className="mt-0.5 text-[11px] text-[var(--ps-text-muted)] line-clamp-2">
              {draft.subtitle || 'Short subtitle'}
            </p>
          </div>
        </div>
        <p className="mt-3 text-[11px] font-mono text-[var(--ps-text-muted)] break-all">
          Target: {resolvedHref}
        </p>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {dialog}

      {/* Top Header Strip */}
      <div className="flex flex-col gap-3 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <LayoutGrid className="h-4 w-4 text-[var(--ps-accent)]" />
            <h2 className="text-base font-bold text-[var(--ps-text)]">
              Homepage Builder &amp; Live Content Control
            </h2>
          </div>
          <p className="mt-0.5 text-xs text-[var(--ps-text-muted)]">
            Every save updates Supabase, logs an immutable audit entry, and triggers instant Next.js cache revalidation on{' '}
            <span className="font-mono">/</span>.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {lastRevalidatedAt && (
            <span className="inline-flex items-center gap-1 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-2.5 py-1.5 text-[11px] font-semibold text-emerald-700 dark:text-emerald-300">
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
            <RefreshCw className={`h-3.5 w-3.5 ${revalidating ? 'animate-spin' : ''}`} />
            <span>Revalidate /</span>
          </button>
        </div>
      </div>

      {/* Inline status notice */}
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
            className="p-1 opacity-70 hover:opacity-100 cursor-pointer"
            aria-label="Dismiss message"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* 4 Internal Builder Tabs */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-[var(--ps-border)] pb-3">
        {(
          [
            {
              id: 'shortcuts' as const,
              label: 'Shortcut Cards & Quick Jumps',
              icon: LayoutGrid,
              count: homepageItems.filter(
                (i) => i.section === 'shortcut_grid' || i.section === 'quick_jump'
              ).length,
            },
            {
              id: 'featured' as const,
              label: 'Featured Places & Banners',
              icon: Star,
              count: pinnedListings.length,
            },
            {
              id: 'localities' as const,
              label: 'Popular Localities',
              icon: MapPin,
              count: localities.length,
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
              onClick={() => {
                setActiveTab(tab.id);
                setEditingItem(null);
                setEditingLocality(null);
              }}
              className={`inline-flex min-h-[44px] items-center gap-2 rounded-xl px-3.5 text-xs font-semibold transition cursor-pointer ${
                active
                  ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                  : 'border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
              }`}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{tab.label}</span>
              <span
                className={`rounded-md px-1.5 py-0.5 text-[10px] font-mono tabular-nums ${
                  active
                    ? 'bg-white/20 text-[var(--ps-accent-fg)]'
                    : 'bg-[var(--ps-bg)] text-[var(--ps-text-muted)]'
                }`}
              >
                {tab.count}
              </span>
            </button>
          );
        })}
      </div>

      {/* ===================================================================== */}
      {/* TAB 1: SHORTCUT CARDS & QUICK JUMPS                                   */}
      {/* ===================================================================== */}
      {activeTab === 'shortcuts' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="inline-flex rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-1">
              <button
                type="button"
                onClick={() => {
                  setSectionFilter('shortcut_grid');
                  setEditingItem(null);
                }}
                className={`min-h-[38px] rounded-lg px-3 text-xs font-semibold transition cursor-pointer ${
                  sectionFilter === 'shortcut_grid'
                    ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                    : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                }`}
              >
                Shortcut Grid (
                {homepageItems.filter((i) => i.section === 'shortcut_grid').length})
              </button>
              <button
                type="button"
                onClick={() => {
                  setSectionFilter('quick_jump');
                  setEditingItem(null);
                }}
                className={`min-h-[38px] rounded-lg px-3 text-xs font-semibold transition cursor-pointer ${
                  sectionFilter === 'quick_jump'
                    ? 'bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                    : 'text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                }`}
              >
                Quick Jump Chips (
                {homepageItems.filter((i) => i.section === 'quick_jump').length})
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => void handleResetSectionDefaults(sectionFilter)}
                disabled={savingItem}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 text-xs font-semibold text-[var(--ps-text-muted)] hover:border-rose-500/40 hover:text-rose-600 cursor-pointer"
              >
                <RotateCcw className="h-3.5 w-3.5" />
                <span>Reset Defaults</span>
              </button>
              <button
                type="button"
                onClick={() => startCreateItem(sectionFilter)}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3.5 text-xs font-semibold text-[var(--ps-accent-fg)] cursor-pointer"
              >
                <Plus className="h-4 w-4" />
                <span>
                  Add {sectionFilter === 'shortcut_grid' ? 'Shortcut Card' : 'Quick Jump'}
                </span>
              </button>
            </div>
          </div>

          {/* Item Editor Panel (Live Preview on Desktop, Stacked on Mobile) */}
          {editingItem && editingItem.section === sectionFilter && (
            <form
              onSubmit={handleSaveItem}
              className="grid grid-cols-1 gap-4 rounded-2xl border border-[var(--ps-accent)]/40 bg-[var(--ps-surface)] p-4 lg:grid-cols-12"
            >
              <div className="space-y-3.5 lg:col-span-8">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-bold text-[var(--ps-text)]">
                    {editingItem.id ? 'Edit Homepage Item' : 'Create Homepage Item'}
                  </h3>
                  <button
                    type="button"
                    onClick={() => setEditingItem(null)}
                    className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--ps-border)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <div>
                    <label className="block text-[11px] font-semibold text-[var(--ps-text-muted)] mb-1">
                      Title *
                    </label>
                    <input
                      type="text"
                      required
                      maxLength={48}
                      value={editingItem.title}
                      onChange={(e) =>
                        setEditingItem({ ...editingItem, title: e.target.value })
                      }
                      placeholder="e.g., Print & Digital"
                      className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)] outline-none focus:border-[var(--ps-accent)]"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-semibold text-[var(--ps-text-muted)] mb-1">
                      Subtitle
                    </label>
                    <input
                      type="text"
                      maxLength={96}
                      value={editingItem.subtitle}
                      onChange={(e) =>
                        setEditingItem({ ...editingItem, subtitle: e.target.value })
                      }
                      placeholder="Short helper text"
                      className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)] outline-none focus:border-[var(--ps-accent)]"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-[var(--ps-text-muted)] mb-1">
                      Container Style
                    </label>
                    <select
                      value={editingItem.container_style}
                      onChange={(e) =>
                        setEditingItem({
                          ...editingItem,
                          container_style: normalizeContainerStyle(e.target.value),
                        })
                      }
                      className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)] outline-none focus:border-[var(--ps-accent)]"
                    >
                      {HOMEPAGE_CONTAINER_STYLE_OPTIONS.map((opt) => (
                        <option key={opt.value} value={opt.value}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-[var(--ps-text-muted)] mb-1">
                      Sort Order
                    </label>
                    <input
                      type="number"
                      value={editingItem.sort_order}
                      onChange={(e) =>
                        setEditingItem({
                          ...editingItem,
                          sort_order: Number(e.target.value) || 0,
                        })
                      }
                      className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 font-mono text-xs tabular-nums text-[var(--ps-text)] outline-none focus:border-[var(--ps-accent)]"
                    />
                  </div>

                  <div className="flex items-end">
                    <label className="flex min-h-[44px] w-full items-center gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs font-semibold text-[var(--ps-text)] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={editingItem.is_enabled}
                        onChange={(e) =>
                          setEditingItem({
                            ...editingItem,
                            is_enabled: e.target.checked,
                          })
                        }
                        className="h-4 w-4 accent-[var(--ps-accent)]"
                      />
                      <span>Visible on Live Home</span>
                    </label>
                  </div>
                </div>

                {/* Structured Route + Query Param Picker (Strict lib/routes.ts Allowlist) */}
                <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 space-y-3">
                  <div>
                    <label className="block text-[11px] font-semibold text-[var(--ps-text-muted)] mb-1">
                      Destination Route (Verified App Router Routes Only)
                    </label>
                    <select
                      value={editingItem.route_key}
                      onChange={(e) =>
                        setEditingItem({
                          ...editingItem,
                          route_key: e.target.value,
                          query_params: {},
                        })
                      }
                      className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 text-xs font-medium text-[var(--ps-text)] outline-none focus:border-[var(--ps-accent)]"
                    >
                      {HOMEPAGE_ROUTE_OPTIONS.map((opt) => (
                        <option key={opt.key} value={opt.key}>
                          {opt.label}
                        </option>
                      ))}
                    </select>
                  </div>

                  {selectedRouteOption.suggestedParams.length > 0 && (
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {selectedRouteOption.suggestedParams.map((param) => (
                        <div key={param.key}>
                          <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--ps-text-muted)] mb-1">
                            ?{param.key} ({param.label})
                          </label>
                          {param.options ? (
                            <select
                              value={editingItem.query_params[param.key] || ''}
                              onChange={(e) => {
                                const next = { ...editingItem.query_params };
                                if (e.target.value) {
                                  next[param.key] = e.target.value;
                                } else {
                                  delete next[param.key];
                                }
                                setEditingItem({ ...editingItem, query_params: next });
                              }}
                              className="min-h-[40px] w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 text-xs text-[var(--ps-text)] outline-none focus:border-[var(--ps-accent)]"
                            >
                              <option value="">(None)</option>
                              {param.options.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <input
                              type="text"
                              value={editingItem.query_params[param.key] || ''}
                              onChange={(e) => {
                                const next = { ...editingItem.query_params };
                                if (e.target.value.trim()) {
                                  next[param.key] = e.target.value;
                                } else {
                                  delete next[param.key];
                                }
                                setEditingItem({ ...editingItem, query_params: next });
                              }}
                              placeholder={param.placeholder}
                              className="min-h-[40px] w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 text-xs text-[var(--ps-text)] outline-none focus:border-[var(--ps-accent)]"
                            />
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Optional extra safe query key/val */}
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <input
                      type="text"
                      value={customParamKey}
                      onChange={(e) => setCustomParamKey(e.target.value)}
                      placeholder="Extra param key"
                      className="min-h-[38px] w-36 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 font-mono text-xs text-[var(--ps-text)]"
                    />
                    <input
                      type="text"
                      value={customParamVal}
                      onChange={(e) => setCustomParamVal(e.target.value)}
                      placeholder="Value"
                      className="min-h-[38px] flex-1 min-w-[120px] rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 text-xs text-[var(--ps-text)]"
                    />
                    <button
                      type="button"
                      onClick={() => {
                        const k = customParamKey.trim();
                        const v = customParamVal.trim();
                        if (!k || !v || !/^[a-zA-Z0-9_-]{1,40}$/.test(k)) return;
                        setEditingItem({
                          ...editingItem,
                          query_params: { ...editingItem.query_params, [k]: v },
                        });
                        setCustomParamKey('');
                        setCustomParamVal('');
                      }}
                      className="min-h-[38px] rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 text-xs font-semibold text-[var(--ps-text)] hover:border-[var(--ps-accent)] cursor-pointer"
                    >
                      Add Param
                    </button>
                  </div>

                  {Object.keys(editingItem.query_params).length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {Object.entries(editingItem.query_params).map(([k, v]) => (
                        <span
                          key={k}
                          className="inline-flex items-center gap-1 rounded-md border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2 py-0.5 font-mono text-[11px] text-[var(--ps-text)]"
                        >
                          {k}={v}
                          <button
                            type="button"
                            onClick={() => {
                              const next = { ...editingItem.query_params };
                              delete next[k];
                              setEditingItem({ ...editingItem, query_params: next });
                            }}
                            className="ml-0.5 text-[var(--ps-text-muted)] hover:text-rose-500 cursor-pointer"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {/* Shared Icon & Accent Picker */}
                <IconPicker
                  value={editingItem.icon_key}
                  accentColor={editingItem.accent_color}
                  onChange={(iconKey) =>
                    setEditingItem({ ...editingItem, icon_key: iconKey })
                  }
                  onAccentColorChange={(accentColor) =>
                    setEditingItem({ ...editingItem, accent_color: accentColor })
                  }
                  label="Icon & Accent Swatch"
                />

                <div className="flex flex-wrap items-center gap-2 pt-2">
                  <button
                    type="submit"
                    disabled={savingItem}
                    className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-4 text-xs font-bold text-[var(--ps-accent-fg)] disabled:opacity-50 cursor-pointer"
                  >
                    {savingItem ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Save className="h-4 w-4" />
                    )}
                    <span>{editingItem.id ? 'Save Changes' : 'Create Item'}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingItem(null)}
                    className="inline-flex min-h-[44px] items-center rounded-xl border border-[var(--ps-border)] px-4 text-xs font-semibold text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </div>

              {/* Right Column: Live Card Preview */}
              <div className="lg:col-span-4 space-y-3">
                {renderLivePreviewCard(editingItem)}
              </div>
            </form>
          )}

          {/* Items List */}
          {loadingItems ? (
            <div className="flex items-center justify-center py-10 text-xs text-[var(--ps-text-muted)]">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading homepage layout...
            </div>
          ) : visibleSectionItems.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-surface)] p-8 text-center">
              <p className="text-sm font-semibold text-[var(--ps-text)]">
                No items found in this section.
              </p>
              <p className="mt-1 text-xs text-[var(--ps-text-muted)]">
                Click &ldquo;Reset Defaults&rdquo; to seed canonical Churachandpur items or add a new card manually.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {visibleSectionItems.map((item, index) => {
                const Icon = getIconByKey(item.icon_key);
                const href = resolveHomepageItemHref(item.route_key, item.query_params);
                return (
                  <div
                    key={item.id}
                    className={`flex flex-col gap-3 rounded-xl border p-3.5 sm:flex-row sm:items-center sm:justify-between ${
                      item.is_enabled
                        ? 'border-[var(--ps-border)] bg-[var(--ps-surface)]'
                        : 'border-[var(--ps-border)]/60 bg-[var(--ps-bg)] opacity-65'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl"
                        style={{
                          backgroundColor: `${item.accent_color}1A`,
                          color: item.accent_color,
                        }}
                      >
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-bold text-[var(--ps-text)]">
                            {item.title}
                          </span>
                          <span className="rounded border border-[var(--ps-border)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--ps-text-muted)]">
                            #{item.sort_order}
                          </span>
                          <span className="rounded bg-[var(--ps-bg)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--ps-text-muted)]">
                            {item.container_style}
                          </span>
                        </div>
                        {item.subtitle && (
                          <p className="mt-0.5 text-[11px] text-[var(--ps-text-muted)] line-clamp-1">
                            {item.subtitle}
                          </p>
                        )}
                        <p className="mt-0.5 font-mono text-[10px] text-[var(--ps-text-muted)] truncate">
                          {href}
                        </p>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        disabled={index === 0}
                        onClick={() =>
                          void handleReorderItem(item, 'up', visibleSectionItems)
                        }
                        className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--ps-border)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] disabled:opacity-30 cursor-pointer"
                        aria-label="Move up"
                      >
                        <ArrowUp className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        disabled={index === visibleSectionItems.length - 1}
                        onClick={() =>
                          void handleReorderItem(item, 'down', visibleSectionItems)
                        }
                        className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--ps-border)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] disabled:opacity-30 cursor-pointer"
                        aria-label="Move down"
                      >
                        <ArrowDown className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleToggleItemEnabled(item)}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--ps-border)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
                        aria-label={item.is_enabled ? 'Hide item' : 'Show item'}
                      >
                        {item.is_enabled ? (
                          <Eye className="h-4 w-4 text-emerald-600" />
                        ) : (
                          <EyeOff className="h-4 w-4" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => startEditItem(item)}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--ps-border)] text-[var(--ps-text-muted)] hover:border-[var(--ps-accent)] hover:text-[var(--ps-accent)] cursor-pointer"
                        aria-label="Edit item"
                      >
                        <Edit3 className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteItem(item)}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--ps-border)] text-[var(--ps-text-muted)] hover:border-rose-500/40 hover:text-rose-600 cursor-pointer"
                        aria-label="Delete item"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 2: FEATURED PLACES & BANNERS                                      */}
      {/* ===================================================================== */}
      {activeTab === 'featured' && (
        <div className="space-y-6">
          {/* 2A. Pinned Featured Places */}
          <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-[var(--ps-text)] flex items-center gap-1.5">
                  <Pin className="h-4 w-4 text-[var(--ps-accent)]" />
                  <span>Pinned Featured Places ({pinnedListings.length})</span>
                </h3>
                <p className="text-xs text-[var(--ps-text-muted)]">
                  Pinned listings appear first in the Homepage Featured Places rail, ordered by{' '}
                  <span className="font-mono">featured_order</span>.
                </p>
              </div>
              <button
                type="button"
                onClick={() => void loadListings()}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-[var(--ps-border)] px-3 text-xs font-semibold text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
              >
                <RefreshCw className={`h-3.5 w-3.5 ${loadingListings ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
            </div>

            {pinnedListings.length === 0 ? (
              <div className="rounded-xl border border-dashed border-[var(--ps-border)] p-4 text-xs text-[var(--ps-text-muted)]">
                No listings are pinned yet. Search verified published listings below to pin them into Featured Places.
              </div>
            ) : (
              <div className="space-y-2">
                {pinnedListings.map((listing, idx) => (
                  <div
                    key={listing.id}
                    className="flex flex-col gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded bg-[var(--ps-accent)]/15 px-1.5 py-0.5 font-mono text-[10px] font-bold text-[var(--ps-accent)] tabular-nums">
                          Slot #{idx + 1} (order {listing.featured_order})
                        </span>
                        <span className="text-xs font-bold text-[var(--ps-text)] truncate">
                          {listing.title}
                        </span>
                      </div>
                      <p className="mt-0.5 text-[11px] text-[var(--ps-text-muted)]">
                        {listing.locality} • {listing.category} • ★ {listing.rating.toFixed(1)}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        disabled={idx === 0 || savingListingId === listing.id}
                        onClick={() => void handleReorderPinnedListing(listing, 'up')}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--ps-border)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] disabled:opacity-30 cursor-pointer"
                        aria-label="Move featured up"
                      >
                        <ArrowUp className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        disabled={
                          idx === pinnedListings.length - 1 ||
                          savingListingId === listing.id
                        }
                        onClick={() => void handleReorderPinnedListing(listing, 'down')}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--ps-border)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] disabled:opacity-30 cursor-pointer"
                        aria-label="Move featured down"
                      >
                        <ArrowDown className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        disabled={savingListingId === listing.id}
                        onClick={() => void handlePinListing(listing, false)}
                        className="inline-flex min-h-[44px] items-center gap-1 rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 text-xs font-semibold text-rose-700 dark:text-rose-300 cursor-pointer"
                      >
                        <X className="h-3.5 w-3.5" />
                        <span>Unpin</span>
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Search & Pin Published Listings */}
            <div className="space-y-2 border-t border-[var(--ps-border)] pt-3">
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ps-text-muted)]" />
                <input
                  type="text"
                  value={listingSearch}
                  onChange={(e) => setListingSearch(e.target.value)}
                  placeholder="Search verified published listings by name, locality, or category..."
                  className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] pl-9 pr-3 text-xs text-[var(--ps-text)] outline-none focus:border-[var(--ps-accent)]"
                />
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {searchableUnpinnedListings.map((listing) => (
                  <div
                    key={listing.id}
                    className="flex items-center justify-between gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-2.5"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-[var(--ps-text)] truncate">
                        {listing.title}
                      </p>
                      <p className="text-[10px] text-[var(--ps-text-muted)] truncate">
                        {listing.locality} • ★ {listing.rating.toFixed(1)}
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={savingListingId === listing.id}
                      onClick={() => void handlePinListing(listing, true)}
                      className="inline-flex min-h-[40px] shrink-0 items-center gap-1 rounded-lg bg-[var(--ps-accent)] px-3 text-xs font-semibold text-[var(--ps-accent-fg)] disabled:opacity-50 cursor-pointer"
                    >
                      <Pin className="h-3.5 w-3.5" />
                      <span>Pin</span>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* 2B. Featured Banners (`section = 'featured_banner'`) */}
          <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="text-sm font-bold text-[var(--ps-text)] flex items-center gap-1.5">
                  <Sparkles className="h-4 w-4 text-[var(--ps-accent)]" />
                  <span>Homepage Spotlight Banners ({visibleSectionItems.length})</span>
                </h3>
                <p className="text-xs text-[var(--ps-text-muted)]">
                  Editorial highlight banners rendered above the live district feed.
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => void handleResetSectionDefaults('featured_banner')}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[var(--ps-border)] px-3 text-xs font-semibold text-[var(--ps-text-muted)] hover:text-rose-600 cursor-pointer"
                >
                  <RotateCcw className="h-3.5 w-3.5" />
                  <span>Reset Banners</span>
                </button>
                <button
                  type="button"
                  onClick={() => startCreateItem('featured_banner')}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3.5 text-xs font-semibold text-[var(--ps-accent-fg)] cursor-pointer"
                >
                  <Plus className="h-4 w-4" />
                  <span>Add Banner</span>
                </button>
              </div>
            </div>

            {editingItem && editingItem.section === 'featured_banner' && (
              <form
                onSubmit={handleSaveItem}
                className="grid grid-cols-1 gap-4 rounded-xl border border-[var(--ps-accent)]/40 bg-[var(--ps-bg)] p-4 lg:grid-cols-12"
              >
                <div className="space-y-3 lg:col-span-7">
                  <input
                    type="text"
                    required
                    value={editingItem.title}
                    onChange={(e) =>
                      setEditingItem({ ...editingItem, title: e.target.value })
                    }
                    placeholder="Banner headline"
                    className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 text-xs text-[var(--ps-text)]"
                  />
                  <textarea
                    rows={2}
                    value={editingItem.subtitle}
                    onChange={(e) =>
                      setEditingItem({ ...editingItem, subtitle: e.target.value })
                    }
                    placeholder="Supporting description"
                    className="w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3 text-xs text-[var(--ps-text)]"
                  />
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <select
                      value={editingItem.route_key}
                      onChange={(e) =>
                        setEditingItem({
                          ...editingItem,
                          route_key: e.target.value,
                          query_params: {},
                        })
                      }
                      className="min-h-[44px] rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 text-xs text-[var(--ps-text)]"
                    >
                      {HOMEPAGE_ROUTE_OPTIONS.map((o) => (
                        <option key={o.key} value={o.key}>
                          {o.label}
                        </option>
                      ))}
                    </select>
                    <input
                      type="number"
                      value={editingItem.sort_order}
                      onChange={(e) =>
                        setEditingItem({
                          ...editingItem,
                          sort_order: Number(e.target.value) || 0,
                        })
                      }
                      placeholder="Sort order"
                      className="min-h-[44px] rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 font-mono text-xs text-[var(--ps-text)]"
                    />
                  </div>
                  <IconPicker
                    value={editingItem.icon_key}
                    accentColor={editingItem.accent_color}
                    onChange={(k) => setEditingItem({ ...editingItem, icon_key: k })}
                    onAccentColorChange={(c) =>
                      setEditingItem({ ...editingItem, accent_color: c })
                    }
                    label="Banner Icon & Accent"
                  />
                  <div className="flex gap-2">
                    <button
                      type="submit"
                      disabled={savingItem}
                      className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-4 text-xs font-bold text-[var(--ps-accent-fg)] cursor-pointer"
                    >
                      <Save className="h-4 w-4" />
                      <span>Save Banner</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setEditingItem(null)}
                      className="inline-flex min-h-[44px] items-center rounded-xl border border-[var(--ps-border)] px-4 text-xs font-semibold text-[var(--ps-text-muted)] cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
                <div className="lg:col-span-5">{renderLivePreviewCard(editingItem)}</div>
              </form>
            )}

            <div className="space-y-2">
              {visibleSectionItems.map((banner, idx) => {
                const Icon = getIconByKey(banner.icon_key);
                return (
                  <div
                    key={banner.id}
                    className="flex flex-col gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 sm:flex-row sm:items-center sm:justify-between"
                  >
                    <div className="flex items-start gap-3 min-w-0">
                      <div
                        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-white"
                        style={{ backgroundColor: banner.accent_color }}
                      >
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-bold text-[var(--ps-text)]">
                          {banner.title}
                        </p>
                        {banner.subtitle && (
                          <p className="text-[11px] text-[var(--ps-text-muted)] line-clamp-1">
                            {banner.subtitle}
                          </p>
                        )}
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() =>
                          void handleReorderItem(banner, 'up', visibleSectionItems)
                        }
                        className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--ps-border)] disabled:opacity-30 cursor-pointer"
                      >
                        <ArrowUp className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === visibleSectionItems.length - 1}
                        onClick={() =>
                          void handleReorderItem(banner, 'down', visibleSectionItems)
                        }
                        className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--ps-border)] disabled:opacity-30 cursor-pointer"
                      >
                        <ArrowDown className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleToggleItemEnabled(banner)}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--ps-border)] cursor-pointer"
                      >
                        {banner.is_enabled ? (
                          <Eye className="h-3.5 w-3.5 text-emerald-600" />
                        ) : (
                          <EyeOff className="h-3.5 w-3.5" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => startEditItem(banner)}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--ps-border)] cursor-pointer"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteItem(banner)}
                        className="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-[var(--ps-border)] text-rose-600 cursor-pointer"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 3: POPULAR LOCALITIES                                             */}
      {/* ===================================================================== */}
      {activeTab === 'localities' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-[var(--ps-text)]">
                Popular Churachandpur Localities ({localities.length})
              </h3>
              <p className="text-xs text-[var(--ps-text-muted)]">
                Tapping any locality chip on the homepage opens{' '}
                <span className="font-mono">/explore?lat=...&amp;lng=...&amp;zoom=...&amp;locality=...</span>{' '}
                and pans directly to that hub.
              </p>
            </div>
            <button
              type="button"
              onClick={startCreateLocality}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3.5 text-xs font-semibold text-[var(--ps-accent-fg)] cursor-pointer"
            >
              <Plus className="h-4 w-4" />
              <span>Add Locality</span>
            </button>
          </div>

          {editingLocality && (
            <form
              onSubmit={handleSaveLocality}
              className="rounded-2xl border border-[var(--ps-accent)]/40 bg-[var(--ps-surface)] p-4 space-y-3.5"
            >
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-bold text-[var(--ps-text)]">
                  {editingLocality.id ? 'Edit Popular Locality' : 'Add Popular Locality'}
                </h4>
                <button
                  type="button"
                  onClick={() => setEditingLocality(null)}
                  className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--ps-border)] cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="block text-[11px] font-semibold text-[var(--ps-text-muted)] mb-1">
                    Locality Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={editingLocality.name}
                    onChange={(e) =>
                      setEditingLocality({
                        ...editingLocality,
                        name: e.target.value,
                        slug: editingLocality.id
                          ? editingLocality.slug
                          : slugifyLocality(e.target.value),
                      })
                    }
                    placeholder="e.g., Churachandpur Bazar"
                    className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-[var(--ps-text-muted)] mb-1">
                    URL Slug *
                  </label>
                  <input
                    type="text"
                    required
                    value={editingLocality.slug}
                    onChange={(e) =>
                      setEditingLocality({
                        ...editingLocality,
                        slug: slugifyLocality(e.target.value),
                      })
                    }
                    placeholder="churachandpur-bazar"
                    className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 font-mono text-xs text-[var(--ps-text)]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <label className="block text-[11px] font-semibold text-[var(--ps-text-muted)] mb-1">
                    Latitude *
                  </label>
                  <input
                    type="number"
                    step="0.0001"
                    required
                    value={editingLocality.lat}
                    onChange={(e) =>
                      setEditingLocality({ ...editingLocality, lat: e.target.value })
                    }
                    className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 font-mono text-xs tabular-nums text-[var(--ps-text)]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-[var(--ps-text-muted)] mb-1">
                    Longitude *
                  </label>
                  <input
                    type="number"
                    step="0.0001"
                    required
                    value={editingLocality.lng}
                    onChange={(e) =>
                      setEditingLocality({ ...editingLocality, lng: e.target.value })
                    }
                    className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 font-mono text-xs tabular-nums text-[var(--ps-text)]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-[var(--ps-text-muted)] mb-1">
                    Default Zoom (11–19)
                  </label>
                  <input
                    type="number"
                    min={11}
                    max={19}
                    value={editingLocality.default_zoom}
                    onChange={(e) =>
                      setEditingLocality({
                        ...editingLocality,
                        default_zoom: e.target.value,
                      })
                    }
                    className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 font-mono text-xs tabular-nums text-[var(--ps-text)]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-[var(--ps-text-muted)] mb-1">
                    Sort Order
                  </label>
                  <input
                    type="number"
                    value={editingLocality.sort_order}
                    onChange={(e) =>
                      setEditingLocality({
                        ...editingLocality,
                        sort_order: Number(e.target.value) || 0,
                      })
                    }
                    className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 font-mono text-xs tabular-nums text-[var(--ps-text)]"
                  />
                </div>
              </div>

              <IconPicker
                value={editingLocality.icon_key}
                onChange={(iconKey) =>
                  setEditingLocality({ ...editingLocality, icon_key: iconKey })
                }
                label="Locality Chip Icon"
              />

              <div className="flex flex-wrap items-center gap-2 pt-1">
                <button
                  type="submit"
                  disabled={savingLocality}
                  className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-4 text-xs font-bold text-[var(--ps-accent-fg)] disabled:opacity-50 cursor-pointer"
                >
                  {savingLocality ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Save className="h-4 w-4" />
                  )}
                  <span>Save Locality</span>
                </button>
                <button
                  type="button"
                  onClick={() => setEditingLocality(null)}
                  className="inline-flex min-h-[44px] items-center rounded-xl border border-[var(--ps-border)] px-4 text-xs font-semibold text-[var(--ps-text-muted)] cursor-pointer"
                >
                  Cancel
                </button>
              </div>
            </form>
          )}

          {loadingLocalities ? (
            <div className="flex items-center justify-center py-8 text-xs text-[var(--ps-text-muted)]">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading localities...
            </div>
          ) : (
            <div className="space-y-2">
              {localities.map((loc, idx) => {
                const Icon = getIconByKey(loc.icon_key);
                const deepLink = buildPopularLocalityExploreHref(loc);
                return (
                  <div
                    key={loc.id}
                    className={`flex flex-col gap-3 rounded-xl border p-3.5 sm:flex-row sm:items-center sm:justify-between ${
                      loc.is_enabled
                        ? 'border-[var(--ps-border)] bg-[var(--ps-surface)]'
                        : 'border-[var(--ps-border)]/60 bg-[var(--ps-bg)] opacity-65'
                    }`}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-[var(--ps-accent)]/10 text-[var(--ps-accent)]">
                        <Icon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-bold text-[var(--ps-text)]">
                            {loc.name}
                          </span>
                          <span className="rounded border border-[var(--ps-border)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--ps-text-muted)] tabular-nums">
                            {loc.lat.toFixed(4)}, {loc.lng.toFixed(4)} • z{loc.default_zoom}
                          </span>
                        </div>
                        <a
                          href={deepLink}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-0.5 inline-flex items-center gap-1 font-mono text-[10px] text-[var(--ps-accent)] hover:underline truncate max-w-full"
                        >
                          <span className="truncate">{deepLink}</span>
                          <ExternalLink className="h-2.5 w-2.5 shrink-0" />
                        </a>
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        disabled={idx === 0}
                        onClick={() => void handleReorderLocality(loc, 'up')}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--ps-border)] disabled:opacity-30 cursor-pointer"
                      >
                        <ArrowUp className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        disabled={idx === localities.length - 1}
                        onClick={() => void handleReorderLocality(loc, 'down')}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--ps-border)] disabled:opacity-30 cursor-pointer"
                      >
                        <ArrowDown className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleToggleLocality(loc)}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--ps-border)] cursor-pointer"
                      >
                        {loc.is_enabled ? (
                          <Eye className="h-4 w-4 text-emerald-600" />
                        ) : (
                          <EyeOff className="h-4 w-4" />
                        )}
                      </button>
                      <button
                        type="button"
                        onClick={() => startEditLocality(loc)}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--ps-border)] cursor-pointer"
                      >
                        <Edit3 className="h-4 w-4" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteLocality(loc)}
                        className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--ps-border)] text-rose-600 cursor-pointer"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* ===================================================================== */}
      {/* TAB 4: PICK N DROP 5-TIER RATES (SINGLE SOURCE OF TRUTH)              */}
      {/* ===================================================================== */}
      {activeTab === 'pnd_rates' && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-bold text-[var(--ps-text)]">
                Pick N Drop 5-Tier Fleet Rates (Single Source of Truth)
              </h3>
              <p className="text-xs text-[var(--ps-text-muted)]">
                Direct editor for <span className="font-mono">public.vehicle_types</span>. Saving immediately updates live homepage fares and dispatch fare estimates.
              </p>
            </div>
            <button
              type="button"
              onClick={() => void loadVehicleRates()}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3.5 text-xs font-semibold text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
            >
              <RefreshCw className={`h-3.5 w-3.5 ${loadingRates ? 'animate-spin' : ''}`} />
              <span>Reload Rates</span>
            </button>
          </div>

          {loadingRates ? (
            <div className="flex items-center justify-center py-8 text-xs text-[var(--ps-text-muted)]">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading Pick N Drop fleet tiers...
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {vehicleRates.map((tier) => {
                const draft = rateEdits[tier.id] || {
                  base_fare_inr: String(tier.base_fare_inr),
                  per_km_rate_inr: String(tier.per_km_rate_inr),
                  two_way_multiplier: String(tier.two_way_multiplier),
                  max_weight_kg: String(tier.max_weight_kg),
                  max_dimensions: tier.max_dimensions || '',
                };
                const baseNum = Number.parseFloat(draft.base_fare_inr) || 0;
                const multNum = Number.parseFloat(draft.two_way_multiplier) || 1.7;
                const previewTwoWay = Math.round(baseNum * multNum);
                const isSaving = savingRateId === tier.id;

                return (
                  <div
                    key={tier.id}
                    className={`rounded-2xl border p-4 space-y-3.5 ${
                      tier.is_active
                        ? 'border-[var(--ps-border)] bg-[var(--ps-surface)]'
                        : 'border-rose-500/30 bg-[var(--ps-bg)] opacity-75'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <h4 className="text-sm font-bold text-[var(--ps-text)]">
                            {tier.name}
                          </h4>
                          <span className="rounded border border-[var(--ps-border)] px-1.5 py-0.5 font-mono text-[10px] text-[var(--ps-text-muted)]">
                            {tier.slug}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[11px] text-[var(--ps-text-muted)]">
                          Modes: {tier.supported_modes.join(', ')}
                        </p>
                      </div>

                      <button
                        type="button"
                        disabled={isSaving}
                        onClick={() => void handleToggleVehicleTierActive(tier)}
                        className={`inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold cursor-pointer ${
                          tier.is_active
                            ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300'
                            : 'border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                        }`}
                      >
                        {tier.is_active ? 'Active' : 'Disabled'}
                      </button>
                    </div>

                    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
                      <div>
                        <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--ps-text-muted)] mb-1">
                          One-Way Base (₹)
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={draft.base_fare_inr}
                          onChange={(e) =>
                            setRateEdits({
                              ...rateEdits,
                              [tier.id]: { ...draft, base_fare_inr: e.target.value },
                            })
                          }
                          className="min-h-[42px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 font-mono text-xs tabular-nums text-[var(--ps-text)]"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--ps-text-muted)] mb-1">
                          Per km Rate (₹)
                        </label>
                        <input
                          type="number"
                          min={0}
                          value={draft.per_km_rate_inr}
                          onChange={(e) =>
                            setRateEdits({
                              ...rateEdits,
                              [tier.id]: { ...draft, per_km_rate_inr: e.target.value },
                            })
                          }
                          className="min-h-[42px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 font-mono text-xs tabular-nums text-[var(--ps-text)]"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--ps-text-muted)] mb-1">
                          2-Way Multiplier
                        </label>
                        <input
                          type="number"
                          step="0.05"
                          min={1}
                          max={5}
                          value={draft.two_way_multiplier}
                          onChange={(e) =>
                            setRateEdits({
                              ...rateEdits,
                              [tier.id]: {
                                ...draft,
                                two_way_multiplier: e.target.value,
                              },
                            })
                          }
                          className="min-h-[42px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 font-mono text-xs tabular-nums text-[var(--ps-text)]"
                        />
                      </div>
                      <div>
                        <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--ps-text-muted)] mb-1">
                          Weight Cap (kg)
                        </label>
                        <input
                          type="number"
                          min={1}
                          value={draft.max_weight_kg}
                          onChange={(e) =>
                            setRateEdits({
                              ...rateEdits,
                              [tier.id]: { ...draft, max_weight_kg: e.target.value },
                            })
                          }
                          className="min-h-[42px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 font-mono text-xs tabular-nums text-[var(--ps-text)]"
                        />
                      </div>
                      <div className="col-span-2">
                        <label className="block text-[10px] font-semibold uppercase tracking-wider text-[var(--ps-text-muted)] mb-1">
                          Max Dimensions Label
                        </label>
                        <input
                          type="text"
                          value={draft.max_dimensions}
                          onChange={(e) =>
                            setRateEdits({
                              ...rateEdits,
                              [tier.id]: { ...draft, max_dimensions: e.target.value },
                            })
                          }
                          placeholder="e.g., 45×35×35 cm"
                          className="min-h-[42px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)]"
                        />
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--ps-border)] pt-3">
                      <div className="text-xs text-[var(--ps-text-muted)]">
                        Two-Way Base Preview:{' '}
                        <span className="font-mono font-bold tabular-nums text-[var(--ps-accent)]">
                          ₹{previewTwoWay}
                        </span>
                      </div>
                      <button
                        type="button"
                        disabled={isSaving}
                        onClick={() => void handleSaveVehicleRate(tier)}
                        className="inline-flex min-h-[42px] items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-4 text-xs font-bold text-[var(--ps-accent-fg)] disabled:opacity-50 cursor-pointer"
                      >
                        {isSaving ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Save className="h-3.5 w-3.5" />
                        )}
                        <span>Save Tier Rates</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
