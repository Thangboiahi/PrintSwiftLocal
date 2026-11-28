'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart3,
  CalendarClock,
  Eye,
  Globe,
  ImagePlus,
  Loader2,
  Megaphone,
  MousePointerClick,
  Plus,
  RefreshCw,
  Save,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import { useConfirmDialogState } from '@/components/ui/ConfirmDialog';
import {
  CustomSelectModal,
  type CustomSelectOption,
} from '@/components/ui/CustomSelectModal';
import {
  ResponsiveTableScroll,
  WorkspaceTableToolbar,
} from '@/components/ui/ResponsiveTableWrapper';
import { discardUploadedTempPaths } from '@/components/workspaces/shared/QuickImageUploadField';
import { useHub } from '@/components/providers/AppConfigProvider';
import { setAppStatus } from '@/lib/hooks/useAppStatus';
import type {
  AppAnnouncementRecord,
  AppAnnouncementType,
  AppBannerPlacement,
  AppBannerRecord,
  AppBannerThemeStyle,
} from '@/lib/config/types';
import { useAuth } from '@/lib/store';
import { supabase } from '@/lib/supabase/client';
import { uploadImage } from '@/lib/supabase/storage';
import type { MasterControlTabSharedProps } from './PaymentsGatewayTab';

const ANNOUNCEMENT_TYPE_OPTIONS: CustomSelectOption[] = [
  { value: 'offer', label: 'Offer', description: 'Theme-primary promotional tint' },
  { value: 'festive', label: 'Festive', description: 'Warm amber & gold shimmer' },
  { value: 'announcement', label: 'Announcement', description: 'District-wide notice' },
  { value: 'info', label: 'Info', description: 'Clean architectural slate' },
  { value: 'alert', label: 'Alert', description: 'High-visibility urgent red' },
];

const PLACEMENT_OPTIONS: CustomSelectOption[] = [
  { value: 'landing_top', label: 'Landing Top', description: 'Right below Hero on homepage' },
  { value: 'landing_mid', label: 'Landing Mid', description: 'Mid-page between Pillars & Previews' },
  { value: 'explore_top', label: 'Explore Top', description: 'Top of Explore listings feed' },
  { value: 'marketplace_top', label: 'Marketplace Top', description: 'Above Marketplace product grid' },
  { value: 'bulletin_top', label: 'Bulletin Top', description: 'Above Community Bulletin feed' },
];

const THEME_STYLE_OPTIONS: CustomSelectOption[] = [
  { value: 'clean', label: 'Clean', description: 'Crisp white / dark slate card' },
  { value: 'primary', label: 'Primary', description: '3-tier theme primary gradient' },
  { value: 'festive', label: 'Festive', description: 'Warm amber & gold celebration' },
  { value: 'dark', label: 'Dark', description: 'High-contrast deep slate card' },
];

function toDatetimeLocalValue(iso?: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(
    date.getDate()
  )}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromDatetimeLocalToIso(localValue: string): string | null {
  if (!localValue.trim()) return null;
  const date = new Date(localValue);
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function formatCtr(impressions: number, clicks: number): string {
  if (!impressions || impressions <= 0) return '0.0%';
  return `${((clicks / impressions) * 100).toFixed(1)}%`;
}

function getScheduleStatus(
  isActive: boolean,
  startsAt?: string | null,
  expiresAt?: string | null
): { label: string; tone: string } {
  if (!isActive) {
    return {
      label: 'Inactive',
      tone: 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
    };
  }
  const now = Date.now();
  if (startsAt && Date.parse(startsAt) > now) {
    return {
      label: 'Scheduled',
      tone: 'bg-sky-100 text-sky-800 dark:bg-sky-950/70 dark:text-sky-300',
    };
  }
  if (expiresAt && Date.parse(expiresAt) <= now) {
    return {
      label: 'Expired',
      tone: 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300',
    };
  }
  return {
    label: 'Live Now',
    tone: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300',
  };
}

export function BannersOffersTab({
  onNotify,
  refreshGlobalConfig,
}: MasterControlTabSharedProps) {
  const { user } = useAuth();
  const { hubs } = useHub();
  const { confirm, dialog: confirmDialog } = useConfirmDialogState();
  const [newBanTempPaths, setNewBanTempPaths] = useState<string[]>([]);
  const [announcements, setAnnouncements] = useState<AppAnnouncementRecord[]>([]);
  const [banners, setBanners] = useState<AppBannerRecord[]>([]);

  // Search & Filter State for Announcements and Banners
  const [annSearch, setAnnSearch] = useState('');
  const [annStatusFilter, setAnnStatusFilter] = useState<'all' | 'Live Now' | 'Scheduled' | 'Expired' | 'Inactive'>('all');
  const [annTypeFilter, setAnnTypeFilter] = useState<'all' | AppAnnouncementType>('all');
  const [banSearch, setBanSearch] = useState('');
  const [banStatusFilter, setBanStatusFilter] = useState<'all' | 'Live Now' | 'Scheduled' | 'Expired' | 'Inactive'>('all');
  const [banPlacementFilter, setBanPlacementFilter] = useState<'all' | AppBannerPlacement>('all');
  const [banHubFilter, setBanHubFilter] = useState<string>('all');

  const filteredAnnouncements = useMemo(() => {
    const q = annSearch.trim().toLowerCase();
    return announcements.filter((ann) => {
      if (annTypeFilter !== 'all' && ann.type !== annTypeFilter) return false;
      if (annStatusFilter !== 'all') {
        const st = getScheduleStatus(ann.is_active, ann.starts_at, ann.expires_at).label;
        if (st !== annStatusFilter) return false;
      }
      if (!q) return true;
      return (
        ann.message.toLowerCase().includes(q) ||
        (ann.cta_label || '').toLowerCase().includes(q) ||
        (ann.cta_url || '').toLowerCase().includes(q) ||
        ann.type.toLowerCase().includes(q)
      );
    });
  }, [announcements, annSearch, annStatusFilter, annTypeFilter]);

  const filteredBanners = useMemo(() => {
    const q = banSearch.trim().toLowerCase();
    return banners.filter((banner) => {
      if (banPlacementFilter !== 'all' && banner.placement !== banPlacementFilter) return false;
      if (banStatusFilter !== 'all') {
        const st = getScheduleStatus(banner.is_active, banner.starts_at, banner.expires_at).label;
        if (st !== banStatusFilter) return false;
      }
      if (banHubFilter !== 'all') {
        if (banHubFilter === 'global' && !banner.is_global) return false;
        if (
          banHubFilter !== 'global' &&
          !(banner.target_hub_ids || []).includes(banHubFilter)
        ) {
          return false;
        }
      }
      if (!q) return true;
      return (
        banner.title.toLowerCase().includes(q) ||
        (banner.subtitle || '').toLowerCase().includes(q) ||
        (banner.cta_label || '').toLowerCase().includes(q) ||
        banner.placement.toLowerCase().includes(q)
      );
    });
  }, [banners, banSearch, banStatusFilter, banPlacementFilter, banHubFilter]);

  const hasActiveAnnFilters =
    annSearch.trim() !== '' || annStatusFilter !== 'all' || annTypeFilter !== 'all';
  const hasActiveBanFilters =
    banSearch.trim() !== '' ||
    banStatusFilter !== 'all' ||
    banPlacementFilter !== 'all' ||
    banHubFilter !== 'all';
  const [isLoading, setIsLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);

  // New Announcement form state
  const [newAnnType, setNewAnnType] = useState<AppAnnouncementType>('offer');
  const [newAnnBadge, setNewAnnBadge] = useState('Festive Offer');
  const [newAnnMessage, setNewAnnMessage] = useState('');
  const [newAnnPromo, setNewAnnPromo] = useState('');
  const [newAnnCtaLabel, setNewAnnCtaLabel] = useState('');
  const [newAnnCtaUrl, setNewAnnCtaUrl] = useState('');
  const [newAnnStartsAt, setNewAnnStartsAt] = useState('');
  const [newAnnExpiresAt, setNewAnnExpiresAt] = useState('');
  const [newAnnPriority, setNewAnnPriority] = useState('10');
  const [newAnnDismissible, setNewAnnDismissible] = useState(true);
  const [newAnnIsGlobal, setNewAnnIsGlobal] = useState(true);
  const [newAnnHubIds, setNewAnnHubIds] = useState<string[]>([]);

  // New Banner form state
  const [newBanTitle, setNewBanTitle] = useState('');
  const [newBanSubtitle, setNewBanSubtitle] = useState('');
  const [newBanBadge, setNewBanBadge] = useState('Sponsored');
  const [newBanImageUrl, setNewBanImageUrl] = useState('');
  const [newBanCtaLabel, setNewBanCtaLabel] = useState('Learn More');
  const [newBanTargetUrl, setNewBanTargetUrl] = useState('/explore');
  const [newBanPromo, setNewBanPromo] = useState('');
  const [newBanPlacement, setNewBanPlacement] =
    useState<AppBannerPlacement>('landing_top');
  const [newBanTheme, setNewBanTheme] = useState<AppBannerThemeStyle>('clean');
  const [newBanSponsor, setNewBanSponsor] = useState('');
  const [newBanStartsAt, setNewBanStartsAt] = useState('');
  const [newBanExpiresAt, setNewBanExpiresAt] = useState('');
  const [newBanSortOrder, setNewBanSortOrder] = useState('10');
  const [newBanIsGlobal, setNewBanIsGlobal] = useState(true);
  const [newBanHubIds, setNewBanHubIds] = useState<string[]>([]);

  useEffect(() => {
    queueMicrotask(() => {
      const nowLocal = toDatetimeLocalValue(new Date().toISOString());
      setNewAnnStartsAt((prev) => prev || nowLocal);
      setNewBanStartsAt((prev) => prev || nowLocal);
    });
  }, []);

  const loadAll = useCallback(async () => {
    setIsLoading(true);
    try {
      const [annRes, banRes] = await Promise.all([
        supabase
          .from('app_announcements')
          .select('*')
          .order('priority', { ascending: false })
          .order('created_at', { ascending: false }),
        supabase
          .from('app_banners')
          .select('*')
          .order('sort_order', { ascending: true })
          .order('created_at', { ascending: false }),
      ]);

      if (!annRes.error && Array.isArray(annRes.data)) {
        setAnnouncements(
          annRes.data.map((row) => ({
            id: String(row.id),
            type: (row.type || 'info') as AppAnnouncementType,
            badge_label: row.badge_label ? String(row.badge_label) : null,
            message: String(row.message || ''),
            promo_code: row.promo_code ? String(row.promo_code) : null,
            cta_label: row.cta_label ? String(row.cta_label) : null,
            cta_url: row.cta_url ? String(row.cta_url) : null,
            starts_at: row.starts_at ? String(row.starts_at) : null,
            expires_at: row.expires_at ? String(row.expires_at) : null,
            priority: Number(row.priority ?? 0),
            is_dismissible: Boolean(row.is_dismissible ?? true),
            is_active: Boolean(row.is_active ?? true),
            target_hub_ids: Array.isArray(row.target_hub_ids)
              ? row.target_hub_ids.map(String)
              : [],
            is_global: Boolean(row.is_global ?? true),
            created_by: row.created_by ? String(row.created_by) : null,
            created_at: row.created_at ? String(row.created_at) : undefined,
          }))
        );
      }

      if (!banRes.error && Array.isArray(banRes.data)) {
        setBanners(
          banRes.data.map((row) => ({
            id: String(row.id),
            title: String(row.title || ''),
            subtitle: row.subtitle ? String(row.subtitle) : null,
            badge_text: row.badge_text ? String(row.badge_text) : null,
            image_url: row.image_url ? String(row.image_url) : null,
            cta_label: row.cta_label ? String(row.cta_label) : 'Learn More',
            target_url: String(row.target_url || '/explore'),
            promo_code: row.promo_code ? String(row.promo_code) : null,
            placement: (row.placement || 'landing_top') as AppBannerPlacement,
            theme_style: (row.theme_style || 'clean') as AppBannerThemeStyle,
            sponsor_name: row.sponsor_name ? String(row.sponsor_name) : null,
            starts_at: row.starts_at ? String(row.starts_at) : null,
            expires_at: row.expires_at ? String(row.expires_at) : null,
            sort_order: Number(row.sort_order ?? 0),
            impressions_count: Number(row.impressions_count ?? 0),
            clicks_count: Number(row.clicks_count ?? 0),
            is_active: Boolean(row.is_active ?? true),
            target_hub_ids: Array.isArray(row.target_hub_ids)
              ? row.target_hub_ids.map(String)
              : [],
            is_global: Boolean(row.is_global ?? true),
            created_by: row.created_by ? String(row.created_by) : null,
            created_at: row.created_at ? String(row.created_at) : undefined,
          }))
        );
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void loadAll();
    });
  }, [loadAll]);

  // Upload image helper for new or existing banner
  const handleBannerImageUpload = async (
    file: File,
    targetBannerId?: string
  ) => {
    const key = targetBannerId ? `img:${targetBannerId}` : 'img:new';
    setBusyKey(key);
    setAppStatus('saving', 'Uploading banner image...');
    try {
      const uploaded = await uploadImage(file, {
        folder: 'banners',
        entityId: targetBannerId || `banner-${Date.now()}`,
      });
      if (targetBannerId) {
        setBanners((prev) =>
          prev.map((b) =>
            b.id === targetBannerId ? { ...b, image_url: uploaded.publicUrl } : b
          )
        );
      } else {
        setNewBanImageUrl(uploaded.publicUrl);
        if (uploaded.path) {
          setNewBanTempPaths((prev) => [...prev, uploaded.path]);
        }
      }
      setAppStatus('success', 'Banner image uploaded.');
      onNotify?.({
        type: 'success',
        text: targetBannerId
          ? 'Banner image uploaded — click Save to publish.'
          : 'Banner image ready.',
      });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : 'Failed to upload banner image.';
      setAppStatus('error', msg);
      onNotify?.({ type: 'error', text: msg });
    } finally {
      setBusyKey(null);
    }
  };

  // --- ANNOUNCEMENTS CRUD ---
  const handleCreateAnnouncement = async () => {
    if (!newAnnMessage.trim()) {
      onNotify?.({
        type: 'error',
        text: 'Announcement message text is required.',
      });
      return;
    }
    const ok = await confirm({
      title: 'Publish App-Wide Announcement?',
      description: `Publish "${newAnnMessage.trim()}" (${newAnnType}) across ${
        newAnnIsGlobal ? 'all hubs' : `${newAnnHubIds.length} selected hub(s)`
      }?`,
      confirmLabel: 'Publish Announcement',
    });
    if (!ok) return;
    setBusyKey('create:ann');
    setAppStatus('saving', 'Creating announcement row...');
    try {
      const { error } = await supabase.from('app_announcements').insert({
        type: newAnnType,
        badge_label: newAnnBadge.trim() || null,
        message: newAnnMessage.trim(),
        promo_code: newAnnPromo.trim().toUpperCase() || null,
        cta_label: newAnnCtaLabel.trim() || null,
        cta_url: newAnnCtaUrl.trim() || null,
        starts_at: fromDatetimeLocalToIso(newAnnStartsAt),
        expires_at: fromDatetimeLocalToIso(newAnnExpiresAt),
        priority: Number(newAnnPriority) || 0,
        is_dismissible: newAnnDismissible,
        is_global: newAnnIsGlobal,
        target_hub_ids: newAnnIsGlobal ? [] : newAnnHubIds,
        is_active: true,
        created_by: user?.id ?? null,
      });

      if (error) {
        setAppStatus('error', error.message);
        onNotify?.({ type: 'error', text: error.message });
        return;
      }

      setNewAnnMessage('');
      setNewAnnPromo('');
      setNewAnnCtaLabel('');
      setNewAnnCtaUrl('');
      setNewAnnExpiresAt('');
      setNewAnnIsGlobal(true);
      setNewAnnHubIds([]);
      setAppStatus('success', 'Announcement published.');
      onNotify?.({
        type: 'success',
        text: 'App-wide announcement row created.',
      });
      await loadAll();
      await refreshGlobalConfig();
    } finally {
      setBusyKey(null);
    }
  };

  const handleSaveAnnouncement = async (ann: AppAnnouncementRecord) => {
    if (!ann.message.trim()) {
      onNotify?.({ type: 'error', text: 'Message cannot be empty.' });
      return;
    }
    const ok = await confirm({
      title: 'Save Announcement Changes?',
      description: `Update announcement "${ann.message.trim()}"?`,
      confirmLabel: 'Save Announcement',
    });
    if (!ok) return;
    setBusyKey(`save:ann:${ann.id}`);
    setAppStatus('saving', 'Updating announcement...');
    try {
      const { error } = await supabase
        .from('app_announcements')
        .update({
          type: ann.type,
          badge_label: ann.badge_label?.trim() || null,
          message: ann.message.trim(),
          promo_code: ann.promo_code?.trim().toUpperCase() || null,
          cta_label: ann.cta_label?.trim() || null,
          cta_url: ann.cta_url?.trim() || null,
          starts_at: ann.starts_at,
          expires_at: ann.expires_at,
          priority: Number(ann.priority) || 0,
          is_dismissible: ann.is_dismissible,
          is_global: ann.is_global ?? true,
          target_hub_ids: ann.target_hub_ids ?? [],
          is_active: ann.is_active,
        })
        .eq('id', ann.id);

      if (error) {
        setAppStatus('error', error.message);
        onNotify?.({ type: 'error', text: error.message });
        return;
      }

      setAppStatus('success', 'Announcement updated.');
      onNotify?.({ type: 'success', text: 'Announcement row saved.' });
      await refreshGlobalConfig();
    } finally {
      setBusyKey(null);
    }
  };

  const handleDeleteAnnouncement = async (id: string) => {
    const ok = await confirm({
      title: 'Delete Announcement?',
      description: 'Remove this announcement permanently from the rotating header strip?',
      confirmLabel: 'Delete Announcement',
      variant: 'danger',
    });
    if (!ok) return;
    setBusyKey(`del:ann:${id}`);
    setAppStatus('saving', 'Deleting announcement...');
    try {
      const { error } = await supabase
        .from('app_announcements')
        .delete()
        .eq('id', id);
      if (error) {
        setAppStatus('error', error.message);
        onNotify?.({ type: 'error', text: error.message });
        return;
      }
      setAnnouncements((prev) => prev.filter((item) => item.id !== id));
      setAppStatus('success', 'Announcement deleted.');
      onNotify?.({ type: 'info', text: 'Announcement row removed.' });
      await refreshGlobalConfig();
    } finally {
      setBusyKey(null);
    }
  };

  // --- BANNERS CRUD ---
  const handleCreateBanner = async () => {
    if (!newBanTitle.trim() || !newBanTargetUrl.trim()) {
      onNotify?.({
        type: 'error',
        text: 'Banner title and target URL are required.',
      });
      return;
    }
    const ok = await confirm({
      title: 'Publish Promotional Ad Banner?',
      description: `Publish "${newBanTitle.trim()}" to placement "${newBanPlacement}"?`,
      confirmLabel: 'Publish Banner',
    });
    if (!ok) return;
    setBusyKey('create:ban');
    setAppStatus('saving', 'Creating ad banner...');
    try {
      const { error } = await supabase.from('app_banners').insert({
        title: newBanTitle.trim(),
        subtitle: newBanSubtitle.trim() || null,
        badge_text: newBanBadge.trim() || null,
        image_url: newBanImageUrl.trim() || null,
        cta_label: newBanCtaLabel.trim() || 'Learn More',
        target_url: newBanTargetUrl.trim(),
        promo_code: newBanPromo.trim().toUpperCase() || null,
        placement: newBanPlacement,
        theme_style: newBanTheme,
        sponsor_name: newBanSponsor.trim() || null,
        starts_at: fromDatetimeLocalToIso(newBanStartsAt),
        expires_at: fromDatetimeLocalToIso(newBanExpiresAt),
        sort_order: Number(newBanSortOrder) || 0,
        is_global: newBanIsGlobal,
        target_hub_ids: newBanIsGlobal ? [] : newBanHubIds,
        is_active: true,
        created_by: user?.id ?? null,
      });

      if (error) {
        setAppStatus('error', error.message);
        onNotify?.({ type: 'error', text: error.message });
        return;
      }

      setNewBanTitle('');
      setNewBanSubtitle('');
      setNewBanImageUrl('');
      setNewBanTempPaths([]);
      setNewBanPromo('');
      setNewBanSponsor('');
      setNewBanExpiresAt('');
      setNewBanIsGlobal(true);
      setNewBanHubIds([]);
      setAppStatus('success', 'Ad banner published.');
      onNotify?.({ type: 'success', text: 'Promotional banner created.' });
      await loadAll();
      await refreshGlobalConfig();
    } finally {
      setBusyKey(null);
    }
  };

  const handleSaveBanner = async (banner: AppBannerRecord) => {
    if (!banner.title.trim() || !banner.target_url.trim()) {
      onNotify?.({
        type: 'error',
        text: 'Banner title and target URL cannot be empty.',
      });
      return;
    }
    const ok = await confirm({
      title: 'Save Banner Changes?',
      description: `Update banner "${banner.title.trim()}"?`,
      confirmLabel: 'Save Banner',
    });
    if (!ok) return;
    setBusyKey(`save:ban:${banner.id}`);
    setAppStatus('saving', 'Saving banner...');
    try {
      const { error } = await supabase
        .from('app_banners')
        .update({
          title: banner.title.trim(),
          subtitle: banner.subtitle?.trim() || null,
          badge_text: banner.badge_text?.trim() || null,
          image_url: banner.image_url?.trim() || null,
          cta_label: banner.cta_label?.trim() || 'Learn More',
          target_url: banner.target_url.trim(),
          promo_code: banner.promo_code?.trim().toUpperCase() || null,
          placement: banner.placement,
          theme_style: banner.theme_style,
          sponsor_name: banner.sponsor_name?.trim() || null,
          starts_at: banner.starts_at,
          expires_at: banner.expires_at,
          sort_order: Number(banner.sort_order) || 0,
          is_global: banner.is_global ?? true,
          target_hub_ids: banner.target_hub_ids ?? [],
          is_active: banner.is_active,
        })
        .eq('id', banner.id);

      if (error) {
        setAppStatus('error', error.message);
        onNotify?.({ type: 'error', text: error.message });
        return;
      }

      setAppStatus('success', 'Banner saved.');
      onNotify?.({ type: 'success', text: `Banner "${banner.title}" updated.` });
      await refreshGlobalConfig();
    } finally {
      setBusyKey(null);
    }
  };

  const handleDeleteBanner = async (id: string) => {
    const ok = await confirm({
      title: 'Delete Promotional Banner?',
      description: 'Remove this banner permanently from live placements?',
      confirmLabel: 'Delete Banner',
      variant: 'danger',
    });
    if (!ok) return;
    setBusyKey(`del:ban:${id}`);
    setAppStatus('saving', 'Deleting banner...');
    try {
      const { error } = await supabase
        .from('app_banners')
        .delete()
        .eq('id', id);
      if (error) {
        setAppStatus('error', error.message);
        onNotify?.({ type: 'error', text: error.message });
        return;
      }
      setBanners((prev) => prev.filter((item) => item.id !== id));
      setAppStatus('success', 'Banner deleted.');
      onNotify?.({ type: 'info', text: 'Banner removed.' });
      await refreshGlobalConfig();
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <div className="space-y-5">
      {/* =================================================================== */}
      {/* SECTION 1: APP-WIDE ANNOUNCEMENT / FESTIVE / OFFER ROW MANAGER      */}
      {/* =================================================================== */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-900 dark:text-white">
              <Sparkles className="h-4 w-4 text-amber-500" />
              App-Wide Announcement, Festive & Offer Row ({announcements.length})
            </h3>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              Top global strip rotating every 6 seconds when multiple active
              scheduled items exist. Renders zero space when empty.
            </p>
          </div>
          <button
            type="button"
            onClick={() => void loadAll()}
            className="inline-flex h-8 items-center gap-1 rounded-lg border border-slate-200 px-2.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`}
            />
            Reload
          </button>
        </div>

        {/* Create new announcement */}
        <div className="mb-4 rounded-lg border border-dashed border-slate-300 bg-slate-50/70 p-3 dark:border-slate-700 dark:bg-slate-950/50">
          <p className="mb-2 text-[11px] font-bold text-slate-700 dark:text-slate-200">
            Schedule New App-Wide Row Item
          </p>
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <CustomSelectModal
              label="Announcement Type"
              options={ANNOUNCEMENT_TYPE_OPTIONS}
              value={newAnnType}
              onChange={(v) => setNewAnnType(v as AppAnnouncementType)}
            />
            <input
              type="text"
              value={newAnnBadge}
              onChange={(e) => setNewAnnBadge(e.target.value)}
              placeholder="Badge (e.g. Kut Festival, 20% OFF)"
              className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
            <input
              type="text"
              value={newAnnPromo}
              onChange={(e) => setNewAnnPromo(e.target.value.toUpperCase())}
              placeholder="Promo Code (optional)"
              className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 font-mono text-xs uppercase dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
            <input
              type="number"
              value={newAnnPriority}
              onChange={(e) => setNewAnnPriority(e.target.value)}
              placeholder="Priority (higher first)"
              className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
          </div>

          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <input
              type="text"
              value={newAnnMessage}
              onChange={(e) => setNewAnnMessage(e.target.value)}
              placeholder="Main announcement / festive / offer message *"
              className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-medium sm:col-span-2 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
            <input
              type="text"
              value={newAnnCtaLabel}
              onChange={(e) => setNewAnnCtaLabel(e.target.value)}
              placeholder="CTA Label (e.g. Book Now)"
              className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
            <input
              type="text"
              value={newAnnCtaUrl}
              onChange={(e) => setNewAnnCtaUrl(e.target.value)}
              placeholder="CTA URL (/explore or https://...)"
              className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
          </div>

          <div className="mt-2 flex flex-wrap items-end justify-between gap-2">
            <div className="flex flex-wrap items-end gap-2">
              <label className="space-y-0.5">
                <span className="flex items-center gap-1 text-[10px] font-semibold text-slate-500">
                  <CalendarClock className="h-3 w-3" />
                  Starts At
                </span>
                <input
                  type="datetime-local"
                  value={newAnnStartsAt}
                  onChange={(e) => setNewAnnStartsAt(e.target.value)}
                  className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                />
              </label>
              <label className="space-y-0.5">
                <span className="text-[10px] font-semibold text-slate-500">
                  Expires At (optional)
                </span>
                <input
                  type="datetime-local"
                  value={newAnnExpiresAt}
                  onChange={(e) => setNewAnnExpiresAt(e.target.value)}
                  className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                />
              </label>
              <button
                type="button"
                onClick={() => setNewAnnDismissible((v) => !v)}
                className={`h-8 rounded-md px-2.5 text-[11px] font-semibold ${
                  newAnnDismissible
                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                    : 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                }`}
              >
                Dismissible: {newAnnDismissible ? 'Yes' : 'Locked'}
              </button>
            </div>

            {/* Hub Scope Selector */}
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="flex items-center gap-1 text-[10px] font-semibold uppercase text-slate-500">
                <Globe className="h-3 w-3" />
                Target:
              </span>
              <button
                type="button"
                onClick={() => {
                  setNewAnnIsGlobal(!newAnnIsGlobal);
                  if (!newAnnIsGlobal) setNewAnnHubIds([]);
                }}
                className={`h-7 rounded px-2 text-[10px] font-semibold transition ${
                  newAnnIsGlobal
                    ? 'bg-sky-600 text-white'
                    : 'border border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
                }`}
              >
                Global (All Hubs)
              </button>

              {!newAnnIsGlobal &&
                hubs.map((hub) => {
                  const checked = newAnnHubIds.includes(hub.id);
                  return (
                    <button
                      key={hub.id}
                      type="button"
                      onClick={() =>
                        setNewAnnHubIds((prev) =>
                          checked ? prev.filter((id) => id !== hub.id) : [...prev, hub.id]
                        )
                      }
                      className={`h-7 rounded px-2 text-[10px] font-semibold transition ${
                        checked
                          ? 'bg-emerald-600 text-white'
                          : 'border border-slate-200 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400'
                      }`}
                    >
                      {hub.name}
                    </button>
                  );
                })}
            </div>

            <button
              type="button"
              disabled={busyKey === 'create:ann'}
              onClick={() => void handleCreateAnnouncement()}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-sky-600 px-3 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
            >
              {busyKey === 'create:ann' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              Add Row Item
            </button>
          </div>
        </div>

        {/* Existing announcements */}
        {announcements.length > 0 && (
          <div className="mb-3">
            <WorkspaceTableToolbar
              searchQuery={annSearch}
              onSearchChange={setAnnSearch}
              searchPlaceholder="Search announcements, CTA…"
              filteredCount={filteredAnnouncements.length}
              totalCount={announcements.length}
              countLabel="announcements"
              hasActiveFilters={hasActiveAnnFilters}
              onResetFilters={() => {
                setAnnSearch('');
                setAnnStatusFilter('all');
                setAnnTypeFilter('all');
              }}
            >
              <div className="flex flex-wrap items-center gap-1">
                {(['all', 'Live Now', 'Scheduled', 'Inactive'] as const).map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setAnnStatusFilter(st)}
                    className={`inline-flex h-8 items-center rounded-lg px-2 text-[11px] font-semibold transition-colors ${
                      annStatusFilter === st
                        ? 'bg-slate-900 text-white dark:bg-sky-600'
                        : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'
                    }`}
                  >
                    {st === 'all' ? 'All Status' : st}
                  </button>
                ))}
                {(['all', 'offer', 'festive', 'announcement', 'alert'] as const).map((tp) => (
                  <button
                    key={tp}
                    type="button"
                    onClick={() => setAnnTypeFilter(tp)}
                    className={`inline-flex h-8 items-center rounded-lg px-2 text-[11px] font-semibold capitalize transition-colors ${
                      annTypeFilter === tp
                        ? 'bg-sky-600 text-white'
                        : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'
                    }`}
                  >
                    {tp === 'all' ? 'All Types' : tp}
                  </button>
                ))}
              </div>
            </WorkspaceTableToolbar>
          </div>
        )}

        {isLoading && announcements.length === 0 ? (
          <div className="flex items-center justify-center py-6 text-xs text-slate-400">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading announcements...
          </div>
        ) : announcements.length === 0 ? (
          <p className="py-4 text-center text-xs text-slate-400">
            No announcements scheduled. Top global bar stays completely hidden.
          </p>
        ) : filteredAnnouncements.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 dark:border-slate-800 py-6 text-center text-xs text-slate-500 space-y-2">
            <p>No announcements match your search or filters.</p>
            <button
              type="button"
              onClick={() => {
                setAnnSearch('');
                setAnnStatusFilter('all');
                setAnnTypeFilter('all');
              }}
              className="inline-flex h-7 items-center rounded-md border border-slate-300 bg-white px-2.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              Reset Filters
            </button>
          </div>
        ) : (
          <ResponsiveTableScroll
            minWidthClass="min-w-[640px]"
            wrapperClassName="border-none bg-transparent shadow-none"
            swipeHintLabel="Swipe ↔ to edit announcement fields"
          >
          <div className="space-y-2.5">
            {filteredAnnouncements.map((ann) => {
              const status = getScheduleStatus(
                ann.is_active,
                ann.starts_at,
                ann.expires_at
              );
              const saving = busyKey === `save:ann:${ann.id}`;
              const deleting = busyKey === `del:ann:${ann.id}`;
              return (
                <div
                  key={ann.id}
                  className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/50"
                >
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${status.tone}`}
                      >
                        {status.label}
                      </span>
                      <span className="rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold uppercase text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        {ann.type}
                      </span>
                      <span className="text-[10px] text-slate-500">
                        Priority: {ann.priority}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          setAnnouncements((prev) =>
                            prev.map((item) =>
                              item.id === ann.id
                                ? {
                                    ...item,
                                    is_dismissible: !item.is_dismissible,
                                  }
                                : item
                            )
                          )
                        }
                        className="h-7 rounded-md border border-slate-200 bg-white px-2 text-[10px] font-semibold text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300"
                      >
                        {ann.is_dismissible ? 'Dismissible' : 'Pinned'}
                      </button>
                      <button
                        type="button"
                        onClick={() =>
                          setAnnouncements((prev) =>
                            prev.map((item) =>
                              item.id === ann.id
                                ? { ...item, is_active: !item.is_active }
                                : item
                            )
                          )
                        }
                        className={`h-7 rounded-md px-2 text-[10px] font-semibold ${
                          ann.is_active
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                            : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                        }`}
                      >
                        {ann.is_active ? 'Active' : 'Paused'}
                      </button>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void handleSaveAnnouncement(ann)}
                        className="inline-flex h-7 items-center gap-1 rounded-md bg-slate-900 px-2.5 text-[11px] font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-sky-600"
                      >
                        {saving ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Save className="h-3 w-3" />
                        )}
                        Save
                      </button>
                      <button
                        type="button"
                        disabled={deleting}
                        onClick={() => void handleDeleteAnnouncement(ann.id)}
                        aria-label="Delete announcement"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-rose-200 bg-white text-rose-600 hover:bg-rose-50 dark:border-rose-900/60 dark:bg-slate-900 dark:text-rose-400"
                      >
                        {deleting ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Trash2 className="h-3 w-3" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    <CustomSelectModal
                      label="Type"
                      options={ANNOUNCEMENT_TYPE_OPTIONS}
                      value={ann.type}
                      onChange={(v) =>
                        setAnnouncements((prev) =>
                          prev.map((item) =>
                            item.id === ann.id
                              ? { ...item, type: v as AppAnnouncementType }
                              : item
                          )
                        )
                      }
                    />
                    <input
                      type="text"
                      value={ann.badge_label ?? ''}
                      onChange={(e) =>
                        setAnnouncements((prev) =>
                          prev.map((item) =>
                            item.id === ann.id
                              ? { ...item, badge_label: e.target.value }
                              : item
                          )
                        )
                      }
                      placeholder="Badge Label"
                      className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                    />
                    <input
                      type="text"
                      value={ann.promo_code ?? ''}
                      onChange={(e) =>
                        setAnnouncements((prev) =>
                          prev.map((item) =>
                            item.id === ann.id
                              ? {
                                  ...item,
                                  promo_code: e.target.value.toUpperCase(),
                                }
                              : item
                          )
                        )
                      }
                      placeholder="Promo Code"
                      className="h-9 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs uppercase dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                    />
                    <input
                      type="number"
                      value={ann.priority}
                      onChange={(e) =>
                        setAnnouncements((prev) =>
                          prev.map((item) =>
                            item.id === ann.id
                              ? {
                                  ...item,
                                  priority: Number(e.target.value) || 0,
                                }
                              : item
                          )
                        )
                      }
                      placeholder="Priority"
                      className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                    />
                  </div>

                  <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    <input
                      type="text"
                      value={ann.message}
                      onChange={(e) =>
                        setAnnouncements((prev) =>
                          prev.map((item) =>
                            item.id === ann.id
                              ? { ...item, message: e.target.value }
                              : item
                          )
                        )
                      }
                      className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs font-medium sm:col-span-2 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                    />
                    <input
                      type="text"
                      value={ann.cta_label ?? ''}
                      onChange={(e) =>
                        setAnnouncements((prev) =>
                          prev.map((item) =>
                            item.id === ann.id
                              ? { ...item, cta_label: e.target.value }
                              : item
                          )
                        )
                      }
                      placeholder="CTA Label"
                      className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                    />
                    <input
                      type="text"
                      value={ann.cta_url ?? ''}
                      onChange={(e) =>
                        setAnnouncements((prev) =>
                          prev.map((item) =>
                            item.id === ann.id
                              ? { ...item, cta_url: e.target.value }
                              : item
                          )
                        )
                      }
                      placeholder="CTA URL"
                      className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                    />
                  </div>

                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <label className="flex items-center gap-1.5 text-[10px] text-slate-500">
                      <span>Starts:</span>
                      <input
                        type="datetime-local"
                        value={toDatetimeLocalValue(ann.starts_at)}
                        onChange={(e) =>
                          setAnnouncements((prev) =>
                            prev.map((item) =>
                              item.id === ann.id
                                ? {
                                    ...item,
                                    starts_at: fromDatetimeLocalToIso(
                                      e.target.value
                                    ),
                                  }
                                : item
                            )
                          )
                        }
                        className="h-7 rounded border border-slate-200 bg-white px-1.5 text-[11px] text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                      />
                    </label>
                    <label className="flex items-center gap-1.5 text-[10px] text-slate-500">
                      <span>Expires:</span>
                      <input
                        type="datetime-local"
                        value={toDatetimeLocalValue(ann.expires_at)}
                        onChange={(e) =>
                          setAnnouncements((prev) =>
                            prev.map((item) =>
                              item.id === ann.id
                                ? {
                                    ...item,
                                    expires_at: fromDatetimeLocalToIso(
                                      e.target.value
                                    ),
                                  }
                                : item
                            )
                          )
                        }
                        className="h-7 rounded border border-slate-200 bg-white px-1.5 text-[11px] text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                      />
                    </label>
                  </div>
                </div>
              );
            })}
          </div>
          </ResponsiveTableScroll>
        )}
      </div>

      {/* =================================================================== */}
      {/* SECTION 2: ADVERTISEMENT & PROMO BANNERS MANAGER                    */}
      {/* =================================================================== */}
      <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
        <div className="mb-3">
          <h3 className="flex items-center gap-1.5 text-sm font-bold text-slate-900 dark:text-white">
            <Megaphone className="h-4 w-4 text-sky-600 dark:text-sky-400" />
            Advertisement & Promo Banners ({banners.length})
          </h3>
          <p className="text-[11px] text-slate-500 dark:text-slate-400">
            Placement-targeted sponsor & promotional cards with live impression
            / click telemetry and zero layout shift when inactive.
          </p>
        </div>

        {/* Create new banner */}
        <div className="mb-4 rounded-lg border border-dashed border-slate-300 bg-slate-50/70 p-3 dark:border-slate-700 dark:bg-slate-950/50">
          <p className="mb-2 text-[11px] font-bold text-slate-700 dark:text-slate-200">
            Create Scheduled Banner
          </p>

          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <input
              type="text"
              value={newBanTitle}
              onChange={(e) => setNewBanTitle(e.target.value)}
              placeholder="Banner Title *"
              className="h-9 rounded-lg border border-slate-200 bg-white px-2.5 text-xs font-semibold sm:col-span-2 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
            <CustomSelectModal
              label="Banner Placement"
              options={PLACEMENT_OPTIONS}
              value={newBanPlacement}
              onChange={(v) => setNewBanPlacement(v as AppBannerPlacement)}
            />
            <CustomSelectModal
              label="Theme Style"
              options={THEME_STYLE_OPTIONS}
              value={newBanTheme}
              onChange={(v) => setNewBanTheme(v as AppBannerThemeStyle)}
            />
          </div>

          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <input
              type="text"
              value={newBanSubtitle}
              onChange={(e) => setNewBanSubtitle(e.target.value)}
              placeholder="Subtitle / offer details"
              className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs sm:col-span-2 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
            <input
              type="text"
              value={newBanBadge}
              onChange={(e) => setNewBanBadge(e.target.value)}
              placeholder="Badge (e.g. Sponsored)"
              className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
            <input
              type="text"
              value={newBanSponsor}
              onChange={(e) => setNewBanSponsor(e.target.value)}
              placeholder="Sponsor Name (optional)"
              className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
          </div>

          <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
            <input
              type="text"
              value={newBanTargetUrl}
              onChange={(e) => setNewBanTargetUrl(e.target.value)}
              placeholder="Target URL (/marketplace or https://...) *"
              className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
            <input
              type="text"
              value={newBanCtaLabel}
              onChange={(e) => setNewBanCtaLabel(e.target.value)}
              placeholder="CTA Button Label"
              className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
            <input
              type="text"
              value={newBanPromo}
              onChange={(e) => setNewBanPromo(e.target.value.toUpperCase())}
              placeholder="Promo Code (optional)"
              className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 font-mono text-xs uppercase dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
            <input
              type="number"
              value={newBanSortOrder}
              onChange={(e) => setNewBanSortOrder(e.target.value)}
              placeholder="Sort Order"
              className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
            />
          </div>

          <div className="mt-2.5 flex flex-wrap items-end justify-between gap-2">
            <div className="flex flex-wrap items-end gap-2">
              <label className="space-y-0.5">
                <span className="text-[10px] font-semibold text-slate-500">
                  Starts At
                </span>
                <input
                  type="datetime-local"
                  value={newBanStartsAt}
                  onChange={(e) => setNewBanStartsAt(e.target.value)}
                  className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                />
              </label>
              <label className="space-y-0.5">
                <span className="text-[10px] font-semibold text-slate-500">
                  Expires At (optional)
                </span>
                <input
                  type="datetime-local"
                  value={newBanExpiresAt}
                  onChange={(e) => setNewBanExpiresAt(e.target.value)}
                  className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                />
              </label>

              <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-slate-200 bg-white px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                {busyKey === 'img:new' ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ImagePlus className="h-3.5 w-3.5 text-sky-600" />
                )}
                <span>{newBanImageUrl ? 'Replace Image' : 'Upload Image'}</span>
                <input
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void handleBannerImageUpload(file);
                    e.target.value = '';
                  }}
                />
              </label>

              {newBanImageUrl && (
                <div className="flex items-center gap-1.5 rounded-md border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={newBanImageUrl}
                    alt="Banner preview"
                    referrerPolicy="no-referrer"
                    className="h-6 w-10 rounded object-cover"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (newBanTempPaths.length > 0) {
                        void discardUploadedTempPaths(newBanTempPaths);
                        setNewBanTempPaths([]);
                      }
                      setNewBanImageUrl('');
                    }}
                    aria-label="Remove image"
                    className="text-slate-400 hover:text-rose-500"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>

            {(newBanImageUrl || newBanTitle.trim()) && (
              <div className="w-full pt-2">
                <div className="mb-1 flex items-center justify-between text-[10px] font-bold uppercase tracking-wider text-slate-500">
                  <span>Live Banner Preview (Fixed Height)</span>
                  <span>Placement: {newBanPlacement}</span>
                </div>
                <div className="relative h-32 sm:h-36 w-full overflow-hidden rounded-xl border border-slate-200 bg-slate-900 text-white shadow-sm dark:border-slate-700">
                  {newBanImageUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={newBanImageUrl}
                      alt={newBanTitle || 'Live Banner Preview'}
                      referrerPolicy="no-referrer"
                      className="h-full w-full object-cover opacity-80"
                    />
                  ) : null}
                  <div className="absolute inset-0 bg-gradient-to-r from-slate-950/85 via-slate-950/50 to-transparent p-3.5 flex flex-col justify-between">
                    <div className="flex items-center gap-1.5">
                      {newBanBadge && (
                        <span className="rounded bg-amber-500 px-2 py-0.5 text-[10px] font-extrabold uppercase text-slate-950">
                          {newBanBadge}
                        </span>
                      )}
                      {newBanPromo && (
                        <span className="rounded border border-white/30 bg-white/10 px-2 py-0.5 font-mono text-[10px] font-bold">
                          CODE: {newBanPromo}
                        </span>
                      )}
                    </div>
                    <div>
                      <p className="text-sm font-extrabold line-clamp-1">
                        {newBanTitle || 'Banner Headline Preview'}
                      </p>
                      {newBanSubtitle && (
                        <p className="text-xs text-slate-200 line-clamp-1">
                          {newBanSubtitle}
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            )}

            {/* Hub Scope Selector */}
            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="flex items-center gap-1 text-[10px] font-semibold uppercase text-slate-500">
                <Globe className="h-3 w-3" />
                Target:
              </span>
              <button
                type="button"
                onClick={() => {
                  setNewBanIsGlobal(!newBanIsGlobal);
                  if (!newBanIsGlobal) setNewBanHubIds([]);
                }}
                className={`h-7 rounded px-2 text-[10px] font-semibold transition ${
                  newBanIsGlobal
                    ? 'bg-sky-600 text-white'
                    : 'border border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
                }`}
              >
                Global (All Hubs)
              </button>

              {!newBanIsGlobal &&
                hubs.map((hub) => {
                  const checked = newBanHubIds.includes(hub.id);
                  return (
                    <button
                      key={hub.id}
                      type="button"
                      onClick={() =>
                        setNewBanHubIds((prev) =>
                          checked ? prev.filter((id) => id !== hub.id) : [...prev, hub.id]
                        )
                      }
                      className={`h-7 rounded px-2 text-[10px] font-semibold transition ${
                        checked
                          ? 'bg-emerald-600 text-white'
                          : 'border border-slate-200 bg-white text-slate-500 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-400'
                      }`}
                    >
                      {hub.name}
                    </button>
                  );
                })}
            </div>

            <button
              type="button"
              disabled={busyKey === 'create:ban'}
              onClick={() => void handleCreateBanner()}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-sky-600 px-3 text-xs font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
            >
              {busyKey === 'create:ban' ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Plus className="h-3.5 w-3.5" />
              )}
              Publish Banner
            </button>
          </div>
        </div>

        {/* Existing banners */}
        {banners.length > 0 && (
          <div className="mb-3">
            <WorkspaceTableToolbar
              searchQuery={banSearch}
              onSearchChange={setBanSearch}
              searchPlaceholder="Search banners by title, slot, CTA…"
              filteredCount={filteredBanners.length}
              totalCount={banners.length}
              countLabel="banners"
              hasActiveFilters={hasActiveBanFilters}
              onResetFilters={() => {
                setBanSearch('');
                setBanStatusFilter('all');
                setBanPlacementFilter('all');
                setBanHubFilter('all');
              }}
            >
              <div className="flex flex-wrap items-center gap-1">
                {(['all', 'Live Now', 'Scheduled', 'Inactive'] as const).map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setBanStatusFilter(st)}
                    className={`inline-flex h-8 items-center rounded-lg px-2 text-[11px] font-semibold transition-colors ${
                      banStatusFilter === st
                        ? 'bg-slate-900 text-white dark:bg-sky-600'
                        : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'
                    }`}
                  >
                    {st === 'all' ? 'All Status' : st}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => setBanHubFilter(banHubFilter === 'global' ? 'all' : 'global')}
                  className={`inline-flex h-8 items-center rounded-lg px-2 text-[11px] font-semibold transition-colors ${
                    banHubFilter === 'global'
                      ? 'bg-sky-600 text-white'
                      : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'
                  }`}
                >
                  Global Only
                </button>
                {hubs.map((h) => (
                  <button
                    key={h.id}
                    type="button"
                    onClick={() => setBanHubFilter(banHubFilter === h.id ? 'all' : h.id)}
                    className={`inline-flex h-8 items-center rounded-lg px-2 text-[11px] font-semibold transition-colors ${
                      banHubFilter === h.id
                        ? 'bg-sky-600 text-white'
                        : 'border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 dark:border-slate-800 dark:bg-slate-900 dark:text-slate-300'
                    }`}
                  >
                    {h.name}
                  </button>
                ))}
              </div>
            </WorkspaceTableToolbar>
          </div>
        )}

        {isLoading && banners.length === 0 ? (
          <div className="flex items-center justify-center py-6 text-xs text-slate-400">
            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            Loading banners...
          </div>
        ) : banners.length === 0 ? (
          <p className="py-4 text-center text-xs text-slate-400">
            No promotional banners created yet. All banner slots render nothing.
          </p>
        ) : filteredBanners.length === 0 ? (
          <div className="rounded-lg border border-dashed border-slate-200 dark:border-slate-800 py-6 text-center text-xs text-slate-500 space-y-2">
            <p>No promotional banners match your search or filters.</p>
            <button
              type="button"
              onClick={() => {
                setBanSearch('');
                setBanStatusFilter('all');
                setBanPlacementFilter('all');
                setBanHubFilter('all');
              }}
              className="inline-flex h-7 items-center rounded-md border border-slate-300 bg-white px-2.5 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
            >
              Reset Filters
            </button>
          </div>
        ) : (
          <ResponsiveTableScroll
            minWidthClass="min-w-[680px]"
            wrapperClassName="border-none bg-transparent shadow-none"
            swipeHintLabel="Swipe ↔ to edit banner slots & analytics"
          >
          <div className="space-y-3">
            {filteredBanners.map((banner) => {
              const status = getScheduleStatus(
                banner.is_active,
                banner.starts_at,
                banner.expires_at
              );
              const saving = busyKey === `save:ban:${banner.id}`;
              const deleting = busyKey === `del:ban:${banner.id}`;
              const uploading = busyKey === `img:${banner.id}`;
              return (
                <div
                  key={banner.id}
                  className="rounded-lg border border-slate-200 bg-slate-50/70 p-3 dark:border-slate-800 dark:bg-slate-950/50"
                >
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${status.tone}`}
                      >
                        {status.label}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded bg-slate-200 px-1.5 py-0.5 text-[10px] font-semibold text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                        <Eye className="h-3 w-3" />
                        {banner.impressions_count.toLocaleString()}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded bg-sky-100 px-1.5 py-0.5 text-[10px] font-semibold text-sky-800 dark:bg-sky-950/70 dark:text-sky-300">
                        <MousePointerClick className="h-3 w-3" />
                        {banner.clicks_count.toLocaleString()}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded bg-violet-100 px-1.5 py-0.5 text-[10px] font-bold text-violet-800 dark:bg-violet-950/70 dark:text-violet-300">
                        <BarChart3 className="h-3 w-3" />
                        CTR {formatCtr(banner.impressions_count, banner.clicks_count)}
                      </span>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() =>
                          setBanners((prev) =>
                            prev.map((item) =>
                              item.id === banner.id
                                ? { ...item, is_active: !item.is_active }
                                : item
                            )
                          )
                        }
                        className={`h-7 rounded-md px-2 text-[10px] font-semibold ${
                          banner.is_active
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                            : 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
                        }`}
                      >
                        {banner.is_active ? 'Active' : 'Paused'}
                      </button>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void handleSaveBanner(banner)}
                        className="inline-flex h-7 items-center gap-1 rounded-md bg-slate-900 px-2.5 text-[11px] font-semibold text-white hover:bg-slate-800 disabled:opacity-50 dark:bg-sky-600"
                      >
                        {saving ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Save className="h-3 w-3" />
                        )}
                        Save
                      </button>
                      <button
                        type="button"
                        disabled={deleting}
                        onClick={() => void handleDeleteBanner(banner.id)}
                        aria-label="Delete banner"
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-rose-200 bg-white text-rose-600 hover:bg-rose-50 dark:border-rose-900/60 dark:bg-slate-900 dark:text-rose-400"
                      >
                        {deleting ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Trash2 className="h-3 w-3" />
                        )}
                      </button>
                    </div>
                  </div>

                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    <input
                      type="text"
                      value={banner.title}
                      onChange={(e) =>
                        setBanners((prev) =>
                          prev.map((item) =>
                            item.id === banner.id
                              ? { ...item, title: e.target.value }
                              : item
                          )
                        )
                      }
                      placeholder="Banner Title"
                      className="h-9 rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold sm:col-span-2 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                    />
                    <CustomSelectModal
                      label="Placement"
                      options={PLACEMENT_OPTIONS}
                      value={banner.placement}
                      onChange={(v) =>
                        setBanners((prev) =>
                          prev.map((item) =>
                            item.id === banner.id
                              ? { ...item, placement: v as AppBannerPlacement }
                              : item
                          )
                        )
                      }
                    />
                    <CustomSelectModal
                      label="Theme"
                      options={THEME_STYLE_OPTIONS}
                      value={banner.theme_style}
                      onChange={(v) =>
                        setBanners((prev) =>
                          prev.map((item) =>
                            item.id === banner.id
                              ? {
                                  ...item,
                                  theme_style: v as AppBannerThemeStyle,
                                }
                              : item
                          )
                        )
                      }
                    />
                  </div>

                  <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    <input
                      type="text"
                      value={banner.subtitle ?? ''}
                      onChange={(e) =>
                        setBanners((prev) =>
                          prev.map((item) =>
                            item.id === banner.id
                              ? { ...item, subtitle: e.target.value }
                              : item
                          )
                        )
                      }
                      placeholder="Subtitle"
                      className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs sm:col-span-2 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                    />
                    <input
                      type="text"
                      value={banner.badge_text ?? ''}
                      onChange={(e) =>
                        setBanners((prev) =>
                          prev.map((item) =>
                            item.id === banner.id
                              ? { ...item, badge_text: e.target.value }
                              : item
                          )
                        )
                      }
                      placeholder="Badge Text"
                      className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                    />
                    <input
                      type="text"
                      value={banner.sponsor_name ?? ''}
                      onChange={(e) =>
                        setBanners((prev) =>
                          prev.map((item) =>
                            item.id === banner.id
                              ? { ...item, sponsor_name: e.target.value }
                              : item
                          )
                        )
                      }
                      placeholder="Sponsor Name"
                      className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                    />
                  </div>

                  <div className="mt-2 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    <input
                      type="text"
                      value={banner.target_url}
                      onChange={(e) =>
                        setBanners((prev) =>
                          prev.map((item) =>
                            item.id === banner.id
                              ? { ...item, target_url: e.target.value }
                              : item
                          )
                        )
                      }
                      placeholder="Target URL"
                      className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                    />
                    <input
                      type="text"
                      value={banner.cta_label ?? ''}
                      onChange={(e) =>
                        setBanners((prev) =>
                          prev.map((item) =>
                            item.id === banner.id
                              ? { ...item, cta_label: e.target.value }
                              : item
                          )
                        )
                      }
                      placeholder="CTA Label"
                      className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                    />
                    <input
                      type="text"
                      value={banner.promo_code ?? ''}
                      onChange={(e) =>
                        setBanners((prev) =>
                          prev.map((item) =>
                            item.id === banner.id
                              ? {
                                  ...item,
                                  promo_code: e.target.value.toUpperCase(),
                                }
                              : item
                          )
                        )
                      }
                      placeholder="Promo Code"
                      className="h-8 rounded-md border border-slate-200 bg-white px-2 font-mono text-xs uppercase dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                    />
                    <input
                      type="number"
                      value={banner.sort_order}
                      onChange={(e) =>
                        setBanners((prev) =>
                          prev.map((item) =>
                            item.id === banner.id
                              ? {
                                  ...item,
                                  sort_order: Number(e.target.value) || 0,
                                }
                              : item
                          )
                        )
                      }
                      placeholder="Sort Order"
                      className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                    />
                  </div>

                  <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <label className="flex items-center gap-1.5 text-[10px] text-slate-500">
                        <span>Starts:</span>
                        <input
                          type="datetime-local"
                          value={toDatetimeLocalValue(banner.starts_at)}
                          onChange={(e) =>
                            setBanners((prev) =>
                              prev.map((item) =>
                                item.id === banner.id
                                  ? {
                                      ...item,
                                      starts_at: fromDatetimeLocalToIso(
                                        e.target.value
                                      ),
                                    }
                                  : item
                              )
                            )
                          }
                          className="h-7 rounded border border-slate-200 bg-white px-1.5 text-[11px] text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                        />
                      </label>
                      <label className="flex items-center gap-1.5 text-[10px] text-slate-500">
                        <span>Expires:</span>
                        <input
                          type="datetime-local"
                          value={toDatetimeLocalValue(banner.expires_at)}
                          onChange={(e) =>
                            setBanners((prev) =>
                              prev.map((item) =>
                                item.id === banner.id
                                  ? {
                                      ...item,
                                      expires_at: fromDatetimeLocalToIso(
                                        e.target.value
                                      ),
                                    }
                                  : item
                              )
                            )
                          }
                          className="h-7 rounded border border-slate-200 bg-white px-1.5 text-[11px] text-slate-800 dark:border-slate-700 dark:bg-slate-900 dark:text-white"
                        />
                      </label>
                    </div>

                    <div className="flex items-center gap-2">
                      {banner.image_url && (
                        <div className="flex items-center gap-1 rounded border border-slate-200 bg-white p-0.5 dark:border-slate-700 dark:bg-slate-900">
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img
                            src={banner.image_url}
                            alt={banner.title}
                            referrerPolicy="no-referrer"
                            className="h-6 w-10 rounded object-cover"
                          />
                          <button
                            type="button"
                            onClick={() =>
                              setBanners((prev) =>
                                prev.map((item) =>
                                  item.id === banner.id
                                    ? { ...item, image_url: null }
                                    : item
                                )
                              )
                            }
                            aria-label="Clear banner image"
                            className="px-0.5 text-slate-400 hover:text-rose-500"
                          >
                            <X className="h-3 w-3" />
                          </button>
                        </div>
                      )}
                      <label className="inline-flex h-7 cursor-pointer items-center gap-1 rounded-md border border-slate-200 bg-white px-2 text-[11px] font-semibold text-slate-700 hover:bg-slate-50 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200">
                        {uploading ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <ImagePlus className="h-3 w-3 text-sky-600" />
                        )}
                        <span>{banner.image_url ? 'Change Img' : 'Upload Img'}</span>
                        <input
                          type="file"
                          accept="image/*"
                          className="hidden"
                          onChange={(e) => {
                            const file = e.target.files?.[0];
                            if (file) void handleBannerImageUpload(file, banner.id);
                            e.target.value = '';
                          }}
                        />
                      </label>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
          </ResponsiveTableScroll>
        )}
      </div>

      {confirmDialog}
    </div>
  );
}
