'use client';

import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  Check,
  ExternalLink,
  Pin,
  Plus,
  Search,
  Star,
  Truck,
  X,
} from 'lucide-react';
import { FormModal } from '@/components/ui/FormModal';
import { IconPicker } from '@/components/ui/IconPicker';
import {
  AttributeHintsPopover,
  type LiveCategoryHintItem,
  type RoutePresetOption,
} from '@/components/ui/AttributeHintsPopover';
import { getIconByKey, normalizeIconKey } from '@/lib/icons/registry';
import { MapCoordinatePicker } from '@/components/maps/MapCoordinatePicker';
import { CHURACHANDPUR_FALLBACK_CENTER } from '@/lib/maps/coordinates';
import {
  HOMEPAGE_CONTAINER_STYLE_OPTIONS,
  HOMEPAGE_ROUTE_OPTIONS,
  buildPopularLocalityExploreHref,
  resolveHomepageItemHref,
  validateHomepageContainerDraft,
  validateHomepageItemDraft,
  validatePopularLocalityDraft,
  type HomepageContainerGroup,
  type HomepageContainerRecord,
  type HomepageContainerStyle,
  type HomepageSection,
  type PopularLocalityRecord,
} from '@/lib/home/homepage-config';

export interface HomepageContainerDraft {
  id?: string;
  slug: string;
  title: string;
  subtitle: string;
  icon_key: string;
  accent_color: string;
  section_group: HomepageContainerGroup;
  sort_order: number;
  is_enabled: boolean;
}

export interface HomepageItemDraft {
  id?: string;
  item_key?: string | null;
  container_id?: string | null;
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

export interface LocalityDraft {
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

export interface FeaturedListingRow {
  id: string;
  title: string;
  category: string;
  locality: string;
  rating: number;
  status: string;
  is_featured: boolean;
  featured_order: number;
}

export interface VehicleTypeRateRow {
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
  sort_order: number;
  is_active: boolean;
}

export interface VehicleRateDraft {
  id: string;
  slug: string;
  name: string;
  base_fare_inr: string;
  per_km_rate_inr: string;
  two_way_multiplier: string;
  max_weight_kg: string;
  max_dimensions: string;
  supported_modes: string[];
}

export function slugifyValue(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function renderRegistryIcon(
  iconKey: string,
  className: string,
  style?: React.CSSProperties
) {
  return React.createElement(getIconByKey(iconKey), {
    className,
    style,
    'aria-hidden': true,
  });
}

// =============================================================================
// 1. CONTAINER TAB ADD / EDIT MODAL
// =============================================================================
interface ContainerFormModalProps {
  isOpen: boolean;
  initialDraft: HomepageContainerDraft | null;
  existingContainers: HomepageContainerRecord[];
  isSubmitting: boolean;
  onSave: (draft: HomepageContainerDraft) => Promise<void>;
  onClose: () => void;
}

export function ContainerFormModal({
  isOpen,
  initialDraft,
  existingContainers,
  isSubmitting,
  onSave,
  onClose,
}: ContainerFormModalProps) {
  const [draft, setDraft] = useState<HomepageContainerDraft | null>(initialDraft);
  const [slugTouched, setSlugTouched] = useState(Boolean(initialDraft?.id));
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const currentDraft = draft ?? initialDraft;
  const markTouched = (field: string) =>
    setTouched((prev) => (prev[field] ? prev : { ...prev, [field]: true }));

  const isDirty = useMemo(() => {
    if (!currentDraft || !initialDraft) return false;
    return JSON.stringify(currentDraft) !== JSON.stringify(initialDraft);
  }, [currentDraft, initialDraft]);

  const validation = useMemo(() => {
    if (!currentDraft) {
      return { isValid: false, fieldErrors: {} as Record<string, string>, paramErrors: {} as Record<string, string> };
    }
    return validateHomepageContainerDraft(currentDraft, existingContainers);
  }, [currentDraft, existingContainers]);

  const showFieldError = (field: string) =>
    Boolean((touched[field] || submitAttempted) && validation.fieldErrors[field]);

  if (!isOpen || !currentDraft) return null;

  const validationMessages = Object.values(validation.fieldErrors);

  return (
    <FormModal
      isOpen={isOpen}
      title={currentDraft.id ? 'Edit Homepage Container Tab' : 'New Homepage Container Tab'}
      subtitle="Containers group shortcut cards into interactive tabs on the live homepage."
      hints={[
        'Keep container titles short (2–3 words) so tabs stay single-line on mobile screens.',
        'An automatic "All" tab is always shown first on the live homepage — create thematic containers here.',
      ]}
      cautions={[
        'Changing a container slug may affect deep-links or default fallback mapping; keep existing slugs stable once live.',
      ]}
      isDirty={isDirty}
      isValid={validation.isValid}
      validationSummary={validationMessages}
      onSubmitAttempt={() => setSubmitAttempted(true)}
      submitLabel={currentDraft.id ? 'Save Container' : 'Create Container'}
      confirmSubmitTitle={
        currentDraft.id
          ? `Save changes to "${currentDraft.title.trim()}"?`
          : `Create "${currentDraft.title.trim()}" container tab?`
      }
      confirmSubmitDescription="This writes to public.homepage_containers, logs an immutable audit entry, and revalidates the live homepage."
      confirmSubmitImpact={[
        `Tab label: "${currentDraft.title.trim()}" (${currentDraft.slug.trim()})`,
        `Section group: ${currentDraft.section_group === 'quick_jump' ? 'Quick Jump' : 'Shortcut Grid'}`,
        `Visibility: ${currentDraft.is_enabled ? 'Enabled on live homepage' : 'Hidden draft'}`,
      ]}
      isSubmitting={isSubmitting}
      onSubmit={() => onSave(currentDraft)}
      onClose={onClose}
    >
      <div className="space-y-4">
        {/* Live Tab Preview */}
        <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)] mb-2">
            Live Homepage Tab Preview
          </p>
          <div className="flex flex-wrap items-center gap-2">
            <span
              className="inline-flex min-h-[44px] items-center gap-2 rounded-full px-4 text-xs font-bold text-white shadow-xs"
              style={{ backgroundColor: currentDraft.accent_color || '#2563EB' }}
            >
              {renderRegistryIcon(currentDraft.icon_key, 'h-3.5 w-3.5')}
              <span>{currentDraft.title || 'Tab Title'}</span>
              <span className="rounded-full bg-white/20 px-1.5 py-0.5 text-[10px] tabular-nums">
                4
              </span>
            </span>
            <span className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-[var(--ps-border)] bg-[var(--ps-surface)] px-4 text-xs font-semibold text-[var(--ps-text-muted)]">
              {renderRegistryIcon(currentDraft.icon_key, 'h-3.5 w-3.5', {
                color: currentDraft.accent_color || '#2563EB',
              })}
              <span>{currentDraft.title || 'Tab Title'}</span>
            </span>
          </div>
          {currentDraft.subtitle && (
            <p className="mt-2 text-[11px] text-[var(--ps-text-muted)]">
              {currentDraft.subtitle}
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-[11px] font-semibold text-[var(--ps-text-muted)] mb-1">
              Container Title *
            </label>
            <input
              type="text"
              value={currentDraft.title}
              onBlur={() => markTouched('title')}
              onChange={(e) => {
                markTouched('title');
                const nextTitle = e.target.value;
                setDraft({
                  ...currentDraft,
                  title: nextTitle,
                  slug: slugTouched ? currentDraft.slug : slugifyValue(nextTitle),
                });
              }}
              placeholder="e.g. Local Commerce"
              className={`min-h-[44px] w-full rounded-xl border bg-[var(--ps-bg)] px-3 text-sm text-[var(--ps-text)] focus:outline-none ${
                showFieldError('title')
                  ? 'border-rose-500'
                  : 'border-[var(--ps-border)] focus:border-[var(--ps-accent)]'
              }`}
            />
            {showFieldError('title') && (
              <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">
                {validation.fieldErrors.title}
              </p>
            )}
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[var(--ps-text-muted)] mb-1">
              URL Slug *
            </label>
            <input
              type="text"
              value={currentDraft.slug}
              onBlur={() => markTouched('slug')}
              onChange={(e) => {
                setSlugTouched(true);
                markTouched('slug');
                setDraft({
                  ...currentDraft,
                  slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''),
                });
              }}
              placeholder="local-commerce"
              className={`min-h-[44px] w-full rounded-xl border bg-[var(--ps-bg)] px-3 font-mono text-xs text-[var(--ps-text)] focus:outline-none ${
                showFieldError('slug')
                  ? 'border-rose-500'
                  : 'border-[var(--ps-border)] focus:border-[var(--ps-accent)]'
              }`}
            />
            {showFieldError('slug') && (
              <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">
                {validation.fieldErrors.slug}
              </p>
            )}
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-[var(--ps-text-muted)] mb-1">
            Short Subtitle (optional)
          </label>
          <input
            type="text"
            value={currentDraft.subtitle}
            onChange={(e) => setDraft({ ...currentDraft, subtitle: e.target.value })}
            placeholder="Brief helper text describing items inside this tab"
            className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-sm text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none"
          />
        </div>

        <IconPicker
          value={currentDraft.icon_key}
          onChange={(iconKey) => setDraft({ ...currentDraft, icon_key: iconKey })}
          accentColor={currentDraft.accent_color}
          onAccentColorChange={(hex) =>
            setDraft({ ...currentDraft, accent_color: hex })
          }
          label="Tab Icon & Accent Color"
        />

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-[11px] font-semibold text-[var(--ps-text-muted)] mb-1">
              Section Group
            </label>
            <select
              value={currentDraft.section_group}
              onChange={(e) =>
                setDraft({
                  ...currentDraft,
                  section_group: e.target.value as HomepageContainerGroup,
                })
              }
              className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs font-semibold text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none"
            >
              <option value="shortcut_grid">Shortcut Grid Tab</option>
              <option value="quick_jump">Quick Jump Strip</option>
            </select>
          </div>

          <div className="flex items-end">
            <label className="flex min-h-[44px] w-full items-center gap-2.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs font-semibold text-[var(--ps-text)] cursor-pointer">
              <input
                type="checkbox"
                checked={currentDraft.is_enabled}
                onChange={(e) =>
                  setDraft({ ...currentDraft, is_enabled: e.target.checked })
                }
                className="h-4 w-4 rounded accent-[var(--ps-accent)]"
              />
              <span>Visible on live homepage</span>
            </label>
          </div>
        </div>
      </div>
    </FormModal>
  );
}

// =============================================================================
// 2. HOMEPAGE ITEM (SHORTCUT CARD / QUICK JUMP / BANNER) ADD / EDIT MODAL
// =============================================================================
interface HomepageItemFormModalProps {
  isOpen: boolean;
  initialDraft: HomepageItemDraft | null;
  containers: HomepageContainerRecord[];
  liveCategories: LiveCategoryHintItem[];
  isSubmitting: boolean;
  onSave: (draft: HomepageItemDraft) => Promise<void>;
  onClose: () => void;
}

export function HomepageItemFormModal({
  isOpen,
  initialDraft,
  containers,
  liveCategories,
  isSubmitting,
  onSave,
  onClose,
}: HomepageItemFormModalProps) {
  const [draft, setDraft] = useState<HomepageItemDraft | null>(initialDraft);
  const [customParamKey, setCustomParamKey] = useState('');
  const [customParamVal, setCustomParamVal] = useState('');
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const currentDraft = draft ?? initialDraft;
  const markTouched = (field: string) =>
    setTouched((prev) => (prev[field] ? prev : { ...prev, [field]: true }));

  const isDirty = useMemo(() => {
    if (!currentDraft || !initialDraft) return false;
    return JSON.stringify(currentDraft) !== JSON.stringify(initialDraft);
  }, [currentDraft, initialDraft]);

  const liveCategorySlugs = useMemo(
    () => liveCategories.map((c) => c.slug),
    [liveCategories]
  );

  const validation = useMemo(() => {
    if (!currentDraft) {
      return {
        isValid: false,
        fieldErrors: {} as Record<string, string>,
        paramErrors: {} as Record<string, string>,
      };
    }
    return validateHomepageItemDraft(currentDraft, liveCategorySlugs);
  }, [currentDraft, liveCategorySlugs]);

  const selectedRouteOption = useMemo(
    () =>
      HOMEPAGE_ROUTE_OPTIONS.find((opt) => opt.key === currentDraft?.route_key) ||
      HOMEPAGE_ROUTE_OPTIONS[0],
    [currentDraft?.route_key]
  );

  const shortcutContainers = useMemo(
    () =>
      containers
        .filter(
          (c) => c.section_group === 'shortcut_grid' && c.slug !== 'all-services'
        )
        .sort((a, b) => a.sort_order - b.sort_order),
    [containers]
  );

  const showFieldError = (field: string) =>
    Boolean((touched[field] || submitAttempted) && validation.fieldErrors[field]);
  const showParamError = (key: string) =>
    Boolean((touched[`param:${key}`] || submitAttempted) && validation.paramErrors[key]);

  if (!isOpen || !currentDraft) return null;

  const resolvedHref = resolveHomepageItemHref(
    currentDraft.route_key,
    currentDraft.query_params,
    'churachandpur'
  );
  const validationMessages = [
    ...Object.values(validation.fieldErrors),
    ...Object.values(validation.paramErrors),
  ];

  const sectionLabel =
    currentDraft.section === 'quick_jump'
      ? 'Quick Jump Chip'
      : currentDraft.section === 'featured_banner'
        ? 'Spotlight Banner'
        : 'Shortcut Card';

  const handleApplyPreset = (preset: RoutePresetOption) => {
    setDraft({
      ...currentDraft,
      title: currentDraft.title.trim() ? currentDraft.title : preset.label,
      subtitle: currentDraft.subtitle.trim()
        ? currentDraft.subtitle
        : preset.description,
      route_key: preset.route_key,
      query_params: { ...preset.query_params },
      icon_key: normalizeIconKey(preset.icon_key),
      accent_color: preset.accent_color,
    });
  };

  const handleInsertParam = (key: string, value: string) => {
    setDraft({
      ...currentDraft,
      query_params: {
        ...currentDraft.query_params,
        [key]: value,
      },
    });
  };

  const handleAddCustomParam = () => {
    const k = customParamKey.trim();
    const v = customParamVal.trim();
    if (!k || !v) return;
    setDraft({
      ...currentDraft,
      query_params: {
        ...currentDraft.query_params,
        [k]: v,
      },
    });
    setCustomParamKey('');
    setCustomParamVal('');
  };

  const handleRemoveParam = (key: string) => {
    const next = { ...currentDraft.query_params };
    delete next[key];
    setDraft({ ...currentDraft, query_params: next });
  };

  return (
    <FormModal
      isOpen={isOpen}
      title={currentDraft.id ? `Edit ${sectionLabel}` : `New ${sectionLabel}`}
      subtitle="Strict internal routing from lib/routes.ts with real-time query parameter verification."
      hints={[
        'Use Attribute Hints below to copy or insert verified routes, verticals, filter attributes, and live database category slugs.',
        'Every URL is built strictly against lib/routes.ts — external or malformed paths are blocked automatically.',
      ]}
      cautions={[
        'Unregistered parameter keys or unknown vertical/attr slugs block saving until fixed so live homepage clicks never break.',
      ]}
      hintsSlot={
        <AttributeHintsPopover
          activeRouteKey={currentDraft.route_key}
          liveCategories={liveCategories}
          onApplyPreset={handleApplyPreset}
          onInsertParam={handleInsertParam}
          onSelectRoute={(rk) =>
            setDraft({ ...currentDraft, route_key: rk, query_params: {} })
          }
        />
      }
      isDirty={isDirty}
      isValid={validation.isValid}
      validationSummary={validationMessages}
      onSubmitAttempt={() => setSubmitAttempted(true)}
      submitLabel={currentDraft.id ? `Save ${sectionLabel}` : `Add ${sectionLabel}`}
      confirmSubmitTitle={
        currentDraft.id
          ? `Update "${currentDraft.title.trim()}" on live homepage?`
          : `Publish "${currentDraft.title.trim()}" to live homepage?`
      }
      confirmSubmitDescription="This writes to public.homepage_items, records an immutable audit log entry, and revalidates / immediately."
      confirmSubmitImpact={[
        `Title: ${currentDraft.title.trim()}`,
        `Target URL: ${resolvedHref}`,
        `Visibility: ${currentDraft.is_enabled ? 'Visible immediately' : 'Saved as hidden'}`,
      ]}
      isSubmitting={isSubmitting}
      maxWidthClassName="max-w-3xl"
      onSubmit={() => onSave(currentDraft)}
      onClose={onClose}
    >
      <div className="space-y-4">
        {/* Live Visual Preview */}
        <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4">
          <div className="flex items-center justify-between gap-2 mb-2.5">
            <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
              Live {sectionLabel} Preview
            </p>
            <span className="inline-flex items-center gap-1 rounded-md border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2 py-0.5 text-[10px] font-mono text-[var(--ps-text-muted)] max-w-[70%] truncate">
              <ExternalLink className="h-3 w-3 shrink-0" />
              <span className="truncate">{resolvedHref}</span>
            </span>
          </div>

          {currentDraft.section === 'quick_jump' ||
          currentDraft.container_style === 'pill' ? (
            <div className="inline-flex min-h-[36px] items-center gap-2 rounded-full border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3.5 py-1.5 text-xs font-semibold text-[var(--ps-text)] shadow-2xs">
              <span
                className="inline-flex h-5 w-5 items-center justify-center rounded-full"
                style={{
                  backgroundColor: `${currentDraft.accent_color}1A`,
                  color: currentDraft.accent_color,
                }}
              >
                {renderRegistryIcon(currentDraft.icon_key, 'h-3.5 w-3.5')}
              </span>
              <span>{currentDraft.title || 'Quick Jump Label'}</span>
            </div>
          ) : currentDraft.section === 'featured_banner' ||
            currentDraft.container_style === 'banner' ? (
            <div
              className="flex items-start gap-3 rounded-2xl border p-3.5"
              style={{
                borderColor: `${currentDraft.accent_color}38`,
                backgroundColor: `${currentDraft.accent_color}0D`,
              }}
            >
              <div
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl text-white"
                style={{ backgroundColor: currentDraft.accent_color }}
              >
                {renderRegistryIcon(currentDraft.icon_key, 'h-4.5 w-4.5')}
              </div>
              <div className="min-w-0">
                <p className="text-xs font-bold text-[var(--ps-text)]">
                  {currentDraft.title || 'Spotlight Banner Headline'}
                </p>
                <p className="mt-0.5 text-[11px] text-[var(--ps-text-muted)]">
                  {currentDraft.subtitle ||
                    'Supporting description shown on the homepage banner strip.'}
                </p>
              </div>
            </div>
          ) : (
            <div
              className={`max-w-[230px] rounded-2xl border p-3 flex flex-col items-start gap-2 ${
                currentDraft.container_style === 'elevated'
                  ? 'border-[var(--ps-border)] bg-[var(--ps-surface)] shadow-md'
                  : currentDraft.container_style === 'tinted'
                    ? 'shadow-2xs'
                    : 'border-[var(--ps-border)] bg-[var(--ps-surface)] shadow-2xs'
              }`}
              style={
                currentDraft.container_style === 'tinted'
                  ? {
                      backgroundColor: `${currentDraft.accent_color}12`,
                      borderColor: `${currentDraft.accent_color}3D`,
                    }
                  : undefined
              }
            >
              <div
                className="w-9 h-9 rounded-xl flex items-center justify-center shrink-0"
                style={{
                  backgroundColor: `${currentDraft.accent_color}1A`,
                  color: currentDraft.accent_color,
                }}
              >
                {renderRegistryIcon(currentDraft.icon_key, 'w-4 h-4')}
              </div>
              <div className="min-w-0 w-full">
                <div className="text-xs font-bold text-[var(--ps-text)] leading-tight truncate">
                  {currentDraft.title || 'Shortcut Title'}
                </div>
                <div className="text-[10.5px] text-[var(--ps-text-muted)] truncate mt-0.5">
                  {currentDraft.subtitle || 'Short subtitle'}
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Inline Attribute Hints & Presets Trigger */}
        <AttributeHintsPopover
          activeRouteKey={currentDraft.route_key}
          liveCategories={liveCategories}
          onApplyPreset={handleApplyPreset}
          onInsertParam={handleInsertParam}
          onSelectRoute={(rk) =>
            setDraft({ ...currentDraft, route_key: rk, query_params: {} })
          }
        />

        {/* Core Fields */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-[11px] font-semibold text-[var(--ps-text-muted)] mb-1">
              Title *
            </label>
            <input
              type="text"
              value={currentDraft.title}
              onBlur={() => markTouched('title')}
              onChange={(e) => {
                markTouched('title');
                setDraft({ ...currentDraft, title: e.target.value });
              }}
              placeholder="e.g. Print & Digital"
              className={`min-h-[44px] w-full rounded-xl border bg-[var(--ps-bg)] px-3 text-sm text-[var(--ps-text)] focus:outline-none ${
                showFieldError('title')
                  ? 'border-rose-500'
                  : 'border-[var(--ps-border)] focus:border-[var(--ps-accent)]'
              }`}
            />
            {showFieldError('title') && (
              <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">
                {validation.fieldErrors.title}
              </p>
            )}
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[var(--ps-text-muted)] mb-1">
              Subtitle
            </label>
            <input
              type="text"
              value={currentDraft.subtitle}
              onBlur={() => markTouched('subtitle')}
              onChange={(e) => {
                markTouched('subtitle');
                setDraft({ ...currentDraft, subtitle: e.target.value });
              }}
              placeholder="Concise 3–6 word tagline"
              className={`min-h-[44px] w-full rounded-xl border bg-[var(--ps-bg)] px-3 text-sm text-[var(--ps-text)] focus:outline-none ${
                showFieldError('subtitle')
                  ? 'border-rose-500'
                  : 'border-[var(--ps-border)] focus:border-[var(--ps-accent)]'
              }`}
            />
            {showFieldError('subtitle') && (
              <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">
                {validation.fieldErrors.subtitle}
              </p>
            )}
          </div>
        </div>

        {/* Container Assignment & Visual Style */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {currentDraft.section === 'shortcut_grid' && (
            <div>
              <label className="block text-[11px] font-semibold text-[var(--ps-text-muted)] mb-1">
                Homepage Container Tab
              </label>
              <select
                value={currentDraft.container_id || ''}
                onChange={(e) =>
                  setDraft({
                    ...currentDraft,
                    container_id: e.target.value || null,
                  })
                }
                className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs font-semibold text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none"
              >
                <option value="">Auto-assign by category</option>
                {shortcutContainers.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title} ({c.slug})
                  </option>
                ))}
              </select>
            </div>
          )}

          <div>
            <label className="block text-[11px] font-semibold text-[var(--ps-text-muted)] mb-1">
              Visual Card Style
            </label>
            <select
              value={currentDraft.container_style}
              onChange={(e) =>
                setDraft({
                  ...currentDraft,
                  container_style: e.target.value as HomepageContainerStyle,
                })
              }
              className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs font-semibold text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none"
            >
              {HOMEPAGE_CONTAINER_STYLE_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label} — {opt.description}
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Icon & Accent Picker */}
        <IconPicker
          value={currentDraft.icon_key}
          onChange={(iconKey) => setDraft({ ...currentDraft, icon_key: iconKey })}
          accentColor={currentDraft.accent_color}
          onAccentColorChange={(hex) =>
            setDraft({ ...currentDraft, accent_color: hex })
          }
          label="Curated Lucide Icon & Accent Color"
        />

        {/* Target Route & Query Parameters */}
        <div className="space-y-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3.5">
          <div>
            <label className="block text-[11px] font-semibold text-[var(--ps-text-muted)] mb-1">
              Target Internal Route (lib/routes.ts) *
            </label>
            <select
              value={currentDraft.route_key}
              onChange={(e) =>
                setDraft({
                  ...currentDraft,
                  route_key: e.target.value,
                })
              }
              className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 text-xs font-semibold text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none"
            >
              {HOMEPAGE_ROUTE_OPTIONS.map((opt) => (
                <option key={opt.key} value={opt.key}>
                  {opt.label}
                </option>
              ))}
            </select>
            {showFieldError('route_key') && (
              <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">
                {validation.fieldErrors.route_key}
              </p>
            )}
          </div>

          {/* Suggested Params for Selected Route */}
          {selectedRouteOption.suggestedParams.length > 0 && (
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              {selectedRouteOption.suggestedParams.slice(0, 6).map((param) => {
                const currentVal = currentDraft.query_params[param.key] || '';
                const paramErr = showParamError(param.key)
                  ? validation.paramErrors[param.key]
                  : undefined;
                return (
                  <div key={param.key}>
                    <label className="block text-[11px] font-semibold text-[var(--ps-text-muted)] mb-1">
                      {param.label}{' '}
                      <span className="font-mono text-[10px]">({param.key})</span>
                    </label>
                    {param.options ? (
                      <select
                        value={currentVal}
                        onBlur={() => markTouched(`param:${param.key}`)}
                        onChange={(e) => {
                          markTouched(`param:${param.key}`);
                          const v = e.target.value;
                          if (!v) {
                            handleRemoveParam(param.key);
                          } else {
                            handleInsertParam(param.key, v);
                          }
                        }}
                        className="min-h-[40px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 text-xs text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none"
                      >
                        <option value="">None</option>
                        {param.options.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    ) : (
                      <input
                        type="text"
                        value={currentVal}
                        onBlur={() => markTouched(`param:${param.key}`)}
                        onChange={(e) => {
                          markTouched(`param:${param.key}`);
                          const v = e.target.value;
                          if (!v.trim()) {
                            handleRemoveParam(param.key);
                          } else {
                            handleInsertParam(param.key, v);
                          }
                        }}
                        placeholder={param.placeholder}
                        className="min-h-[40px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 text-xs text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none"
                      />
                    )}
                    {paramErr && (
                      <p className="mt-1 text-[10.5px] text-rose-600 dark:text-rose-400">
                        {paramErr}
                      </p>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Active Query Params Chips + Custom Param Adder */}
          <div className="space-y-2 border-t border-[var(--ps-border)] pt-2.5">
            <p className="text-[11px] font-semibold text-[var(--ps-text-muted)]">
              Active Query Parameters
            </p>
            {Object.keys(currentDraft.query_params).length === 0 ? (
              <p className="text-[11px] text-[var(--ps-text-muted)]">
                No query parameters set (links directly to {selectedRouteOption.basePath}).
              </p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {Object.entries(currentDraft.query_params).map(([k, v]) => {
                  const err = validation.paramErrors[k];
                  return (
                    <span
                      key={k}
                      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-mono ${
                        err
                          ? 'border-rose-500/50 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                          : 'border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text)]'
                      }`}
                    >
                      {err && <AlertCircle className="h-3 w-3 shrink-0" />}
                      <span>
                        {k}={v}
                      </span>
                      <button
                        type="button"
                        onClick={() => handleRemoveParam(k)}
                        className="ml-0.5 text-[var(--ps-text-muted)] hover:text-rose-500 cursor-pointer"
                        aria-label={`Remove ${k}`}
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  );
                })}
              </div>
            )}

            <div className="flex flex-col gap-2 sm:flex-row">
              <input
                type="text"
                value={customParamKey}
                onChange={(e) => setCustomParamKey(e.target.value)}
                placeholder="Param key (e.g. attr)"
                className="min-h-[40px] flex-1 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 font-mono text-xs text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none"
              />
              <input
                type="text"
                value={customParamVal}
                onChange={(e) => setCustomParamVal(e.target.value)}
                placeholder="Value (e.g. pure_veg)"
                className="min-h-[40px] flex-1 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2.5 font-mono text-xs text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none"
              />
              <button
                type="button"
                onClick={handleAddCustomParam}
                disabled={!customParamKey.trim() || !customParamVal.trim()}
                className="inline-flex min-h-[40px] items-center justify-center gap-1 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 text-xs font-semibold text-[var(--ps-text)] hover:border-[var(--ps-accent)] disabled:opacity-40 cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add Param</span>
              </button>
            </div>
          </div>
        </div>

        {/* Visibility Checkbox */}
        <label className="flex min-h-[44px] items-center gap-2.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 text-xs font-semibold text-[var(--ps-text)] cursor-pointer">
          <input
            type="checkbox"
            checked={currentDraft.is_enabled}
            onChange={(e) =>
              setDraft({ ...currentDraft, is_enabled: e.target.checked })
            }
            className="h-4 w-4 rounded accent-[var(--ps-accent)]"
          />
          <span>Enabled and visible on live homepage</span>
        </label>
      </div>
    </FormModal>
  );
}

// =============================================================================
// 3. PIN FEATURED LISTING MODAL
// =============================================================================
interface PinListingFormModalProps {
  isOpen: boolean;
  unpinnedListings: FeaturedListingRow[];
  isSubmitting: boolean;
  onPin: (listing: FeaturedListingRow) => Promise<void>;
  onClose: () => void;
}

export function PinListingFormModal({
  isOpen,
  unpinnedListings,
  isSubmitting,
  onPin,
  onClose,
}: PinListingFormModalProps) {
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string>('');

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return unpinnedListings
      .filter((l) =>
        !q
          ? true
          : l.title.toLowerCase().includes(q) ||
            l.locality.toLowerCase().includes(q) ||
            l.category.toLowerCase().includes(q)
      )
      .slice(0, 24);
  }, [unpinnedListings, search]);

  const selectedListing = useMemo(
    () => unpinnedListings.find((l) => l.id === selectedId) || null,
    [unpinnedListings, selectedId]
  );

  if (!isOpen) return null;

  return (
    <FormModal
      isOpen={isOpen}
      title="Pin Verified Listing to Featured Places"
      subtitle="Select any published listing to elevate into the live homepage Featured Places carousel."
      hints={[
        'Pinned listings appear ahead of rating-sorted places in the exact order you arrange via drag-and-drop.',
      ]}
      isDirty={Boolean(selectedListing)}
      isValid={Boolean(selectedListing)}
      validationSummary={
        selectedListing ? [] : ['Select a verified listing from the list below.']
      }
      submitLabel="Pin to Featured"
      confirmSubmitTitle={
        selectedListing
          ? `Pin "${selectedListing.title}" to Featured Places?`
          : 'Pin Listing?'
      }
      confirmSubmitDescription="This sets is_featured = true on the listing and immediately refreshes the homepage."
      confirmSubmitImpact={
        selectedListing
          ? [
              `Listing: ${selectedListing.title}`,
              `Locality: ${selectedListing.locality} · Rating ${selectedListing.rating.toFixed(1)}★`,
            ]
          : undefined
      }
      isSubmitting={isSubmitting}
      onSubmit={async () => {
        if (selectedListing) await onPin(selectedListing);
      }}
      onClose={onClose}
    >
      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--ps-text-muted)]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search verified shops, cafes, turfs, stays, or localities..."
            className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] pl-9 pr-3 text-xs text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none"
          />
        </div>

        <div className="max-h-72 space-y-1.5 overflow-y-auto pr-1">
          {filtered.length === 0 ? (
            <div className="rounded-xl border border-dashed border-[var(--ps-border)] p-6 text-center text-xs text-[var(--ps-text-muted)]">
              No matching published unpinned listings found.
            </div>
          ) : (
            filtered.map((item) => {
              const chosen = item.id === selectedId;
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setSelectedId(item.id)}
                  className={`flex min-h-[48px] w-full items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left transition-colors cursor-pointer ${
                    chosen
                      ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)]/10'
                      : 'border-[var(--ps-border)] bg-[var(--ps-bg)] hover:border-[var(--ps-accent)]/50'
                  }`}
                >
                  <div className="min-w-0">
                    <p className="text-xs font-bold text-[var(--ps-text)] truncate">
                      {item.title}
                    </p>
                    <p className="text-[11px] text-[var(--ps-text-muted)] truncate">
                      {item.locality} · {item.category.replace(/_/g, ' ')}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-amber-600 dark:text-amber-400">
                      <Star className="h-3 w-3 fill-current" />
                      {item.rating.toFixed(1)}
                    </span>
                    {chosen ? (
                      <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]">
                        <Check className="h-3.5 w-3.5" />
                      </span>
                    ) : (
                      <Pin className="h-3.5 w-3.5 text-[var(--ps-text-muted)]" />
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>
    </FormModal>
  );
}

// =============================================================================
// 4. POPULAR LOCALITY ADD / EDIT MODAL
// =============================================================================
interface LocalityFormModalProps {
  isOpen: boolean;
  initialDraft: LocalityDraft | null;
  existingLocalities: PopularLocalityRecord[];
  isSubmitting: boolean;
  onSave: (draft: LocalityDraft) => Promise<void>;
  onClose: () => void;
}

export function LocalityFormModal({
  isOpen,
  initialDraft,
  existingLocalities,
  isSubmitting,
  onSave,
  onClose,
}: LocalityFormModalProps) {
  const [draft, setDraft] = useState<LocalityDraft | null>(initialDraft);
  const [slugTouched, setSlugTouched] = useState(Boolean(initialDraft?.id));
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);

  const currentDraft = draft ?? initialDraft;
  const markTouched = (field: string) =>
    setTouched((prev) => (prev[field] ? prev : { ...prev, [field]: true }));

  const isDirty = useMemo(() => {
    if (!currentDraft || !initialDraft) return false;
    return JSON.stringify(currentDraft) !== JSON.stringify(initialDraft);
  }, [currentDraft, initialDraft]);

  const validation = useMemo(() => {
    if (!currentDraft) {
      return { isValid: false, fieldErrors: {} as Record<string, string>, paramErrors: {} as Record<string, string> };
    }
    return validatePopularLocalityDraft(currentDraft, existingLocalities);
  }, [currentDraft, existingLocalities]);

  const showFieldError = (field: string) =>
    Boolean((touched[field] || submitAttempted) && validation.fieldErrors[field]);

  if (!isOpen || !currentDraft) return null;

  const previewHref = buildPopularLocalityExploreHref(
    {
      slug: currentDraft.slug || 'locality',
      lat: Number.parseFloat(currentDraft.lat) || 24.3335,
      lng: Number.parseFloat(currentDraft.lng) || 93.6946,
      default_zoom: Number.parseInt(currentDraft.default_zoom, 10) || 15,
    },
    'churachandpur'
  );

  return (
    <FormModal
      isOpen={isOpen}
      title={currentDraft.id ? 'Edit Popular Locality' : 'New Popular Locality'}
      subtitle="Clicking this chip on the homepage pans and zooms the Explore map directly to these coordinates."
      hints={[
        'Churachandpur town center is approximately 24.3335, 93.6946 (zoom 15).',
        'Zoom 15 works best for neighborhoods; Zoom 16 highlights dense bazaars.',
      ]}
      isDirty={isDirty}
      isValid={validation.isValid}
      validationSummary={Object.values(validation.fieldErrors)}
      onSubmitAttempt={() => setSubmitAttempted(true)}
      submitLabel={currentDraft.id ? 'Save Locality' : 'Add Locality'}
      confirmSubmitTitle={
        currentDraft.id
          ? `Update "${currentDraft.name.trim()}" locality chip?`
          : `Publish "${currentDraft.name.trim()}" locality chip?`
      }
      confirmSubmitDescription="Updates public.popular_localities, writes an immutable audit log entry, and refreshes the live homepage."
      confirmSubmitImpact={[
        `Chip: ${currentDraft.name.trim()} (${currentDraft.slug.trim()})`,
        `Map pan target: ${previewHref}`,
      ]}
      isSubmitting={isSubmitting}
      onSubmit={() => onSave({ ...currentDraft, icon_key: currentDraft.icon_key || 'map-pin' })}
      onClose={onClose}
    >
      <div className="space-y-4">
        {/* Live Chip Preview (clean text chip without icons) */}
        <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)] mb-2">
            Live Locality Chip Preview
          </p>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="inline-flex h-8 items-center rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 text-xs font-semibold text-[var(--ps-text)]">
              {currentDraft.name || 'Locality Name'}
            </span>
            <span className="font-mono text-[10.5px] text-[var(--ps-text-muted)] break-all">
              {previewHref}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-[11px] font-semibold text-[var(--ps-text-muted)] mb-1">
              Locality Name *
            </label>
            <input
              type="text"
              value={currentDraft.name}
              onBlur={() => markTouched('name')}
              onChange={(e) => {
                markTouched('name');
                const nextName = e.target.value;
                setDraft({
                  ...currentDraft,
                  name: nextName,
                  slug: slugTouched ? currentDraft.slug : slugifyValue(nextName),
                });
              }}
              placeholder="e.g. Tuibong"
              className={`min-h-[44px] w-full rounded-xl border bg-[var(--ps-bg)] px-3 text-sm text-[var(--ps-text)] focus:outline-none ${
                showFieldError('name')
                  ? 'border-rose-500'
                  : 'border-[var(--ps-border)] focus:border-[var(--ps-accent)]'
              }`}
            />
            {showFieldError('name') && (
              <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">
                {validation.fieldErrors.name}
              </p>
            )}
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[var(--ps-text-muted)] mb-1">
              Slug *
            </label>
            <input
              type="text"
              value={currentDraft.slug}
              onBlur={() => markTouched('slug')}
              onChange={(e) => {
                setSlugTouched(true);
                markTouched('slug');
                setDraft({
                  ...currentDraft,
                  slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''),
                });
              }}
              placeholder="tuibong"
              className={`min-h-[44px] w-full rounded-xl border bg-[var(--ps-bg)] px-3 font-mono text-xs text-[var(--ps-text)] focus:outline-none ${
                showFieldError('slug')
                  ? 'border-rose-500'
                  : 'border-[var(--ps-border)] focus:border-[var(--ps-accent)]'
              }`}
            />
            {showFieldError('slug') && (
              <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">
                {validation.fieldErrors.slug}
              </p>
            )}
          </div>
        </div>

        <MapCoordinatePicker
          mode="point"
          label="Locality Map Pin & Default Zoom *"
          helperText="Pan the map under the centered crosshair to set the exact neighborhood focal point."
          coordinates={{
            lat: Number.isFinite(Number.parseFloat(currentDraft.lat))
              ? Number.parseFloat(currentDraft.lat)
              : CHURACHANDPUR_FALLBACK_CENTER.lat,
            lng: Number.isFinite(Number.parseFloat(currentDraft.lng))
              ? Number.parseFloat(currentDraft.lng)
              : CHURACHANDPUR_FALLBACK_CENTER.lng,
          }}
          zoom={
            Number.isFinite(Number.parseInt(currentDraft.default_zoom, 10))
              ? Math.min(19, Math.max(11, Number.parseInt(currentDraft.default_zoom, 10)))
              : 15
          }
          showZoomControl={true}
          submitAttempted={submitAttempted}
          onChangeCoordinates={(next) => {
            markTouched('lat');
            markTouched('lng');
            setDraft({
              ...currentDraft,
              lat: next.lat.toFixed(6),
              lng: next.lng.toFixed(6),
            });
          }}
          onChangeZoom={(nextZoom) => {
            markTouched('default_zoom');
            setDraft({
              ...currentDraft,
              default_zoom: String(Math.min(19, Math.max(11, Math.round(nextZoom)))),
            });
          }}
        />
        {(showFieldError('lat') ||
          showFieldError('lng') ||
          showFieldError('default_zoom')) && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-[11px] text-rose-600 dark:text-rose-400">
            {[
              validation.fieldErrors.lat,
              validation.fieldErrors.lng,
              validation.fieldErrors.default_zoom,
            ]
              .filter(Boolean)
              .join(' ')}
          </div>
        )}

        <label className="flex min-h-[44px] items-center gap-2.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 text-xs font-semibold text-[var(--ps-text)] cursor-pointer">
          <input
            type="checkbox"
            checked={currentDraft.is_enabled}
            onChange={(e) =>
              setDraft({ ...currentDraft, is_enabled: e.target.checked })
            }
            className="h-4 w-4 rounded accent-[var(--ps-accent)]"
          />
          <span>Show in homepage Explore Hubs strip</span>
        </label>
      </div>
    </FormModal>
  );
}

// =============================================================================
// 5. PICK N DROP FLEET TIER RATE EDIT MODAL
// =============================================================================
interface VehicleRateFormModalProps {
  isOpen: boolean;
  initialDraft: VehicleRateDraft | null;
  isSubmitting: boolean;
  onSave: (draft: VehicleRateDraft) => Promise<void>;
  onClose: () => void;
}

export function VehicleRateFormModal({
  isOpen,
  initialDraft,
  isSubmitting,
  onSave,
  onClose,
}: VehicleRateFormModalProps) {
  const [draft, setDraft] = useState<VehicleRateDraft | null>(initialDraft);
  const [touched, setTouched] = useState<Record<string, boolean>>({});
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const currentDraft = draft ?? initialDraft;
  const markTouched = (field: string) =>
    setTouched((prev) => (prev[field] ? prev : { ...prev, [field]: true }));

  const isDirty = useMemo(() => {
    if (!currentDraft || !initialDraft) return false;
    return JSON.stringify(currentDraft) !== JSON.stringify(initialDraft);
  }, [currentDraft, initialDraft]);

  const errors = useMemo(() => {
    if (!currentDraft) return {} as Record<string, string>;
    const errs: Record<string, string> = {};
    const base = Number.parseFloat(currentDraft.base_fare_inr);
    const perKm = Number.parseFloat(currentDraft.per_km_rate_inr);
    const mult = Number.parseFloat(currentDraft.two_way_multiplier);
    const weight = Number.parseFloat(currentDraft.max_weight_kg);
    if (!Number.isFinite(base) || base < 0)
      errs.base_fare_inr = 'Base fare must be 0 or higher.';
    if (!Number.isFinite(perKm) || perKm < 0)
      errs.per_km_rate_inr = 'Per-km rate must be 0 or higher.';
    if (!Number.isFinite(mult) || mult < 1 || mult > 5)
      errs.two_way_multiplier = 'Two-way multiplier must be between 1.0 and 5.0.';
    if (!Number.isFinite(weight) || weight <= 0)
      errs.max_weight_kg = 'Max payload weight must be greater than 0 kg.';
    return errs;
  }, [currentDraft]);

  const showFieldError = (field: string) =>
    Boolean((touched[field] || submitAttempted) && errors[field]);

  if (!isOpen || !currentDraft) return null;

  const isValid = Object.keys(errors).length === 0;
  const previewBase = Number.parseFloat(currentDraft.base_fare_inr) || 0;
  const previewKm = Number.parseFloat(currentDraft.per_km_rate_inr) || 0;
  const previewWeight = Number.parseFloat(currentDraft.max_weight_kg) || 0;

  return (
    <FormModal
      isOpen={isOpen}
      title={`Edit Rates — ${currentDraft.name}`}
      subtitle={`Canonical Pick N Drop fleet tier (${currentDraft.slug})`}
      hints={[
        'Base fare + per-km rate updates both the homepage Transparent Fares grid and new customer quote estimates.',
      ]}
      cautions={[
        'Live rate changes apply immediately to new bookings. Active in-flight orders keep their locked escrow fare.',
      ]}
      isDirty={isDirty}
      isValid={isValid}
      validationSummary={Object.values(errors)}
      onSubmitAttempt={() => setSubmitAttempted(true)}
      submitLabel="Save Tier Rates"
      confirmSubmitTitle={`Update ${currentDraft.name} live fares?`}
      confirmSubmitDescription="Writes directly to public.vehicle_types, records an immutable audit log entry, and revalidates the homepage."
      confirmSubmitCaution="Customers opening Pick N Drop immediately after saving will be quoted these new rates."
      confirmSubmitImpact={[
        `Base Fare: ₹${previewBase} · Per-km: ₹${previewKm}/km`,
        `Two-Way Multiplier: ${currentDraft.two_way_multiplier}× · Max Weight: ${previewWeight} kg`,
      ]}
      confirmSubmitVariant="warning"
      isSubmitting={isSubmitting}
      onSubmit={() => onSave(currentDraft)}
      onClose={onClose}
    >
      <div className="space-y-4">
        {/* Live Fare Card Preview */}
        <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3.5">
          <p className="text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)] mb-2">
            Live Transparent Fare Card Preview
          </p>
          <div className="max-w-xs rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[var(--ps-accent)]/12 text-[var(--ps-accent)]">
                  <Truck className="h-4 w-4" />
                </span>
                <div>
                  <p className="text-xs font-bold text-[var(--ps-text)]">
                    {currentDraft.name}
                  </p>
                  <p className="text-[10px] text-[var(--ps-text-muted)]">
                    Up to {previewWeight} kg
                  </p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-sm font-extrabold text-[var(--ps-text)] tabular-nums">
                  ₹{previewBase}
                </p>
                <p className="text-[10px] text-[var(--ps-text-muted)] tabular-nums">
                  + ₹{previewKm}/km
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="block text-[11px] font-semibold text-[var(--ps-text-muted)] mb-1">
              Base Fare (₹) *
            </label>
            <input
              type="number"
              min={0}
              step="1"
              value={currentDraft.base_fare_inr}
              onBlur={() => markTouched('base_fare_inr')}
              onChange={(e) => {
                markTouched('base_fare_inr');
                setDraft({ ...currentDraft, base_fare_inr: e.target.value });
              }}
              className={`min-h-[44px] w-full rounded-xl border bg-[var(--ps-bg)] px-3 font-mono text-xs text-[var(--ps-text)] focus:outline-none ${
                showFieldError('base_fare_inr')
                  ? 'border-rose-500'
                  : 'border-[var(--ps-border)] focus:border-[var(--ps-accent)]'
              }`}
            />
            {showFieldError('base_fare_inr') && (
              <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">
                {errors.base_fare_inr}
              </p>
            )}
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[var(--ps-text-muted)] mb-1">
              Per-km Rate (₹/km) *
            </label>
            <input
              type="number"
              min={0}
              step="0.5"
              value={currentDraft.per_km_rate_inr}
              onBlur={() => markTouched('per_km_rate_inr')}
              onChange={(e) => {
                markTouched('per_km_rate_inr');
                setDraft({ ...currentDraft, per_km_rate_inr: e.target.value });
              }}
              className={`min-h-[44px] w-full rounded-xl border bg-[var(--ps-bg)] px-3 font-mono text-xs text-[var(--ps-text)] focus:outline-none ${
                showFieldError('per_km_rate_inr')
                  ? 'border-rose-500'
                  : 'border-[var(--ps-border)] focus:border-[var(--ps-accent)]'
              }`}
            />
            {showFieldError('per_km_rate_inr') && (
              <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">
                {errors.per_km_rate_inr}
              </p>
            )}
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[var(--ps-text-muted)] mb-1">
              Two-Way / Return Multiplier (1.0–5.0) *
            </label>
            <input
              type="number"
              min={1}
              max={5}
              step="0.05"
              value={currentDraft.two_way_multiplier}
              onBlur={() => markTouched('two_way_multiplier')}
              onChange={(e) => {
                markTouched('two_way_multiplier');
                setDraft({ ...currentDraft, two_way_multiplier: e.target.value });
              }}
              className={`min-h-[44px] w-full rounded-xl border bg-[var(--ps-bg)] px-3 font-mono text-xs text-[var(--ps-text)] focus:outline-none ${
                showFieldError('two_way_multiplier')
                  ? 'border-rose-500'
                  : 'border-[var(--ps-border)] focus:border-[var(--ps-accent)]'
              }`}
            />
            {showFieldError('two_way_multiplier') && (
              <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">
                {errors.two_way_multiplier}
              </p>
            )}
          </div>

          <div>
            <label className="block text-[11px] font-semibold text-[var(--ps-text-muted)] mb-1">
              Max Weight (kg) *
            </label>
            <input
              type="number"
              min={1}
              step="1"
              value={currentDraft.max_weight_kg}
              onBlur={() => markTouched('max_weight_kg')}
              onChange={(e) => {
                markTouched('max_weight_kg');
                setDraft({ ...currentDraft, max_weight_kg: e.target.value });
              }}
              className={`min-h-[44px] w-full rounded-xl border bg-[var(--ps-bg)] px-3 font-mono text-xs text-[var(--ps-text)] focus:outline-none ${
                showFieldError('max_weight_kg')
                  ? 'border-rose-500'
                  : 'border-[var(--ps-border)] focus:border-[var(--ps-accent)]'
              }`}
            />
            {showFieldError('max_weight_kg') && (
              <p className="mt-1 text-[11px] text-rose-600 dark:text-rose-400">
                {errors.max_weight_kg}
              </p>
            )}
          </div>
        </div>

        <div>
          <label className="block text-[11px] font-semibold text-[var(--ps-text-muted)] mb-1">
            Capacity / Dimensions Label
          </label>
          <input
            type="text"
            value={currentDraft.max_dimensions}
            onChange={(e) =>
              setDraft({ ...currentDraft, max_dimensions: e.target.value })
            }
            placeholder="e.g. 50x40x40 cm or 1 LPG cylinder"
            className="min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none"
          />
        </div>
      </div>
    </FormModal>
  );
}
