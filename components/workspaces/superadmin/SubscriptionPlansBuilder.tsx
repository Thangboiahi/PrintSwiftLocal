'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DndContext,
  closestCenter,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
} from '@dnd-kit/sortable';
import {
  AlertCircle,
  AlertTriangle,
  Archive,
  BadgePercent,
  Check,
  Clock,
  Edit3,
  Eye,
  EyeOff,
  Gift,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  ShieldCheck,
  Sparkles,
  Star,
  Trash2,
  Undo2,
  UserCheck,
} from 'lucide-react';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { useConfirmDialogState } from '@/components/ui/ConfirmDialog';
import { FormModal } from '@/components/ui/FormModal';
import {
  DragHandleButton,
  MobileOrderButtons,
  SortablePreviewItem,
  useTouchSafeSensors,
} from '@/components/ui/SortablePreview';
import { TargetUsersPicker } from '@/components/workspaces/superadmin/TargetUsersPicker';
import { LISTING_VERTICALS, type ListingVertical } from '@/lib/verticals/types';
import {
  ENTITLEMENT_FEATURE_META,
  FREE_BASELINE_ENTITLEMENTS,
  LISTING_VERTICAL_LABELS,
  SUBSCRIPTION_ROLE_OPTIONS,
  normalizePlanEntitlements,
  type EntitlementFeatureKey,
  type PlanEntitlements,
} from '@/lib/subscriptions/entitlements';

interface SubscriptionPlanPriceRow {
  id?: string;
  localKey: string;
  plan_id?: string;
  duration_label: string;
  duration_days: number;
  price_inr: number;
  compare_at_inr: number | null;
  is_default: boolean;
  is_active: boolean;
  sort_order: number;
}

interface SubscriptionPlanRecord {
  id: string;
  slug: string;
  name: string;
  title: string;
  info: string;
  price_inr: number;
  duration_days: number;
  max_active_bulletins?: number;
  applicable_roles: string[];
  applicable_categories: string[];
  applicable_subcategories: string[];
  applicable_category_ids: string[];
  applicable_root_keys: string[];
  entitlements: PlanEntitlements;
  is_active: boolean;
  is_default_free: boolean;
  is_archived: boolean;
  trial_days: number;
  auto_trial_on_approval: boolean;
  target_scope: 'public' | 'selected_users';
  target_user_ids: string[];
  sort_order: number;
  updated_at?: string;
  prices: SubscriptionPlanPriceRow[];
}

interface CategoryOption {
  id: string;
  slug: string;
  display_name: string;
  parent_id: string | null;
  root_key?: string | null;
  depth?: number | null;
  entity_type?: string | null;
  path_ids?: string[] | null;
}

interface PlanDraft {
  id: string | null;
  title: string;
  slug: string;
  info: string;
  is_active: boolean;
  is_default_free: boolean;
  is_archived: boolean;
  trial_days: number;
  auto_trial_on_approval: boolean;
  target_scope: 'public' | 'selected_users';
  target_user_ids: string[];
  sort_order: number;
  applicable_roles: string[];
  applicable_categories: string[];
  applicable_subcategories: string[];
  applicable_category_ids: string[];
  applicable_root_keys: string[];
  entitlements: PlanEntitlements;
  prices: SubscriptionPlanPriceRow[];
}

interface SubscriptionPlansBuilderProps {
  onNotice?: (notice: {
    type: 'success' | 'error' | 'info';
    text: string;
  }) => void;
}

const SLUG_REGEX = /^[a-z0-9]+(?:[-_][a-z0-9]+)*$/;
const RESERVED_PLAN_SLUGS = new Set([
  'all',
  'admin',
  'api',
  'explore',
  'civic',
  'settings',
  'workspace',
]);

function slugifyTitle(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '-')
    .replace(/[-_]{2,}/g, '-')
    .replace(/^[-_]+|[-_]+$/g, '')
    .slice(0, 60);
}

function validatePlanSlug(
  slugRaw: string,
  allPlans: SubscriptionPlanRecord[],
  editingId: string | null
): string | null {
  const slug = slugRaw.trim().toLowerCase();
  if (!slug) return 'Plan slug is required.';
  if (slug.length < 2 || slug.length > 60) {
    return 'Slug must be between 2 and 60 characters.';
  }
  if (!SLUG_REGEX.test(slug)) {
    return 'Use lowercase letters, numbers, hyphens, or underscores only.';
  }
  if (RESERVED_PLAN_SLUGS.has(slug)) {
    return `"${slug}" is a reserved system slug.`;
  }
  const dup = allPlans.find(
    (p) => p.slug.toLowerCase() === slug && p.id !== editingId
  );
  if (dup) {
    return `Slug "${slug}" is already used by "${dup.title}".`;
  }
  return null;
}

function createEmptyDraft(nextOrder: number, seed: number): PlanDraft {
  return {
    id: null,
    title: '',
    slug: '',
    info: '',
    is_active: true,
    is_default_free: false,
    is_archived: false,
    trial_days: 0,
    auto_trial_on_approval: false,
    target_scope: 'public',
    target_user_ids: [],
    sort_order: nextOrder,
    applicable_roles: ['owner'],
    applicable_categories: ['*'],
    applicable_subcategories: ['*'],
    applicable_category_ids: [],
    applicable_root_keys: ['*'],
    entitlements: {
      ...FREE_BASELINE_ENTITLEMENTS,
      allowed_listing_types: ['general', 'shop_catalogue', 'print_digital'],
      max_listings: 3,
      max_marketplace_items: 15,
      online_payment: { enabled: true, limit: null },
      staffing: { enabled: true, limit: 3, max_staff: 3 },
      bulletins: { enabled: true, limit: 5 },
      auto_verify_listings: false,
      auto_verify_bulletins: false,
    },
    prices: [
      {
        localKey: `new-${seed}-1`,
        duration_label: 'Monthly',
        duration_days: 30,
        price_inr: 299,
        compare_at_inr: 399,
        is_default: true,
        is_active: true,
        sort_order: 10,
      },
      {
        localKey: `new-${seed}-2`,
        duration_label: 'Annual',
        duration_days: 365,
        price_inr: 2999,
        compare_at_inr: 3588,
        is_default: false,
        is_active: true,
        sort_order: 20,
      },
    ],
  };
}

// =============================================================================
// PHASE 10 SKELETAL LOADER
// =============================================================================
function PlansBuilderSkeleton() {
  return (
    <div
      className="grid grid-cols-1 gap-3 lg:grid-cols-2"
      aria-busy="true"
      aria-label="Loading subscription plans"
    >
      {[1, 2, 3, 4].map((i) => (
        <div
          key={i}
          className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3"
        >
          <div className="flex items-start justify-between gap-2">
            <div className="flex items-center gap-2.5">
              <div className="h-11 w-11 rounded-xl dd-shimmer" />
              <div className="space-y-1.5">
                <div className="h-4 w-40 rounded-lg dd-shimmer" />
                <div className="h-3 w-28 rounded-lg dd-shimmer" />
              </div>
            </div>
            <div className="flex gap-1.5">
              <div className="h-11 w-11 rounded-xl dd-shimmer" />
              <div className="h-11 w-11 rounded-xl dd-shimmer" />
            </div>
          </div>
          <div className="h-3 w-3/4 rounded-lg dd-shimmer" />
          <div className="flex flex-wrap gap-2">
            <div className="h-7 w-28 rounded-lg dd-shimmer" />
            <div className="h-7 w-28 rounded-lg dd-shimmer" />
          </div>
          <div className="flex flex-wrap gap-1.5 pt-2 border-t border-[var(--ps-border)]/60">
            <div className="h-6 w-20 rounded-md dd-shimmer" />
            <div className="h-6 w-20 rounded-md dd-shimmer" />
            <div className="h-6 w-24 rounded-md dd-shimmer" />
          </div>
        </div>
      ))}
    </div>
  );
}

// =============================================================================
// MODAL-ONLY PLAN EDITOR
// =============================================================================
interface PlanEditorModalProps {
  open: boolean;
  initialDraft: PlanDraft;
  allPlans: SubscriptionPlanRecord[];
  allCategories: CategoryOption[];
  rootCategories: CategoryOption[];
  subCategories: CategoryOption[];
  saving: boolean;
  onClose: () => void;
  onSave: (draft: PlanDraft, removedPriceIds: string[]) => Promise<void>;
}

function PlanEditorModal({
  open,
  initialDraft,
  allPlans,
  allCategories,
  rootCategories,
  subCategories,
  saving,
  onClose,
  onSave,
}: PlanEditorModalProps) {
  const [draft, setDraft] = useState<PlanDraft>(initialDraft);
  const [removedPriceIds, setRemovedPriceIds] = useState<string[]>([]);
  const [priceSeq, setPriceSeq] = useState(1);
  const [priceNotice, setPriceNotice] = useState<string | null>(null);
  const [titleTouched, setTitleTouched] = useState(false);
  const [slugTouched, setSlugTouched] = useState(Boolean(initialDraft.id));
  const [submitAttempted, setSubmitAttempted] = useState(false);
  const [expandedRootIds, setExpandedRootIds] = useState<Set<string>>(
    () => new Set(rootCategories.slice(0, 3).map((r) => r.id))
  );

  const l2ByRootId = useMemo(() => {
    const map = new Map<string, CategoryOption[]>();
    for (const cat of subCategories) {
      if (!cat.parent_id) continue;
      if (rootCategories.some((r) => r.id === cat.parent_id)) {
        const list = map.get(cat.parent_id) || [];
        list.push(cat);
        map.set(cat.parent_id, list);
      }
    }
    return map;
  }, [rootCategories, subCategories]);

  const l3ByL2Id = useMemo(() => {
    const rootIdSet = new Set(rootCategories.map((r) => r.id));
    const map = new Map<string, CategoryOption[]>();
    for (const cat of subCategories) {
      if (!cat.parent_id || rootIdSet.has(cat.parent_id)) continue;
      const list = map.get(cat.parent_id) || [];
      list.push(cat);
      map.set(cat.parent_id, list);
    }
    return map;
  }, [rootCategories, subCategories]);

  const isAllCategoriesSelected =
    draft.applicable_root_keys.includes('*') ||
    (draft.applicable_category_ids.length === 0 &&
      draft.applicable_categories.includes('*'));

  const handleToggleWildcardCategories = () => {
    setDraft((prev) => ({
      ...prev,
      applicable_category_ids: [],
      applicable_root_keys: ['*'],
      applicable_categories: ['*'],
      applicable_subcategories: ['*'],
    }));
  };

  const handleToggleCategoryNode = (node: CategoryOption) => {
    setDraft((prev) => {
      const exists = prev.applicable_category_ids.includes(node.id);
      const nextIds = exists
        ? prev.applicable_category_ids.filter((id) => id !== node.id)
        : [...prev.applicable_category_ids, node.id];

      if (nextIds.length === 0) {
        return {
          ...prev,
          applicable_category_ids: [],
          applicable_root_keys: ['*'],
          applicable_categories: ['*'],
          applicable_subcategories: ['*'],
        };
      }

      const selectedNodes = allCategories.filter((c) => nextIds.includes(c.id));
      const rootSlugs = new Set<string>();
      const subSlugs = new Set<string>();
      const rootKeys = new Set<string>();

      for (const item of selectedNodes) {
        const rk = (item.root_key || (!item.parent_id ? item.slug : '') || '')
          .trim()
          .toLowerCase();
        if (rk) rootKeys.add(rk);
        if (!item.parent_id) {
          rootSlugs.add(item.slug);
        } else {
          subSlugs.add(item.slug);
          const parentRoot = rootCategories.find(
            (r) =>
              r.id === item.parent_id ||
              (item.root_key && r.root_key === item.root_key)
          );
          if (parentRoot) rootSlugs.add(parentRoot.slug);
        }
      }

      return {
        ...prev,
        applicable_category_ids: nextIds,
        applicable_root_keys:
          rootKeys.size > 0 ? Array.from(rootKeys) : ['general'],
        applicable_categories:
          rootSlugs.size > 0 ? Array.from(rootSlugs) : ['*'],
        applicable_subcategories:
          subSlugs.size > 0 ? Array.from(subSlugs) : ['*'],
      };
    });
  };

  const isDirty = useMemo(
    () =>
      JSON.stringify(draft) !== JSON.stringify(initialDraft) ||
      removedPriceIds.length > 0,
    [draft, initialDraft, removedPriceIds.length]
  );

  const slugError = useMemo(() => {
    const candidate = slugifyTitle(draft.slug || draft.title);
    return validatePlanSlug(candidate, allPlans, draft.id);
  }, [draft.slug, draft.title, draft.id, allPlans]);

  const validationErrors = useMemo(() => {
    const errs: string[] = [];
    if (draft.title.trim().length < 2) {
      errs.push('Plan title must be at least 2 characters.');
    }
    if (slugError) {
      errs.push(slugError);
    }
    if (!draft.is_default_free && draft.prices.length === 0) {
      errs.push('Add at least one duration price tier before saving.');
    }
    if (
      !draft.is_default_free &&
      draft.target_scope === 'selected_users' &&
      draft.target_user_ids.length === 0
    ) {
      errs.push(
        'Select at least one target individual when Audience is set to Selected Individuals.'
      );
    }
    if (
      !draft.is_default_free &&
      (draft.trial_days < 0 || draft.trial_days > 365)
    ) {
      errs.push('Free trial days must be between 0 and 365.');
    }
    return errs;
  }, [
    draft.title,
    draft.prices.length,
    draft.is_default_free,
    draft.target_scope,
    draft.target_user_ids.length,
    draft.trial_days,
    slugError,
  ]);

  const toggleArraySelection = (
    list: string[],
    value: string,
    hasWildcard: boolean
  ): string[] => {
    if (hasWildcard && value === '*') return ['*'];
    const withoutWildcard = hasWildcard
      ? list.filter((item) => item !== '*')
      : [...list];
    if (withoutWildcard.includes(value)) {
      const next = withoutWildcard.filter((item) => item !== value);
      if (next.length === 0) return hasWildcard ? ['*'] : [];
      return next;
    }
    return [...withoutWildcard, value];
  };

  const toggleListingType = (vertical: ListingVertical) => {
    const current = draft.entitlements.allowed_listing_types;
    const exists = current.includes(vertical);
    const next = exists
      ? current.filter((v) => v !== vertical)
      : [...current, vertical];
    setDraft((prev) => ({
      ...prev,
      entitlements: {
        ...prev.entitlements,
        allowed_listing_types: next.length > 0 ? next : ['general'],
      },
    }));
  };

  const updateFeatureEntitlement = (
    key: EntitlementFeatureKey,
    patch: Partial<{ enabled: boolean; limit: number | null; max_staff?: number | null }>
  ) => {
    setDraft((prev) => {
      const merged = {
        ...prev.entitlements[key],
        ...patch,
      };
      if (key === 'staffing') {
        const nextLimit = merged.enabled
          ? ('max_staff' in patch ? patch.max_staff : merged.limit) ?? 0
          : 0;
        merged.limit = nextLimit;
        merged.max_staff = nextLimit;
      }
      return {
        ...prev,
        entitlements: {
          ...prev.entitlements,
          [key]: merged,
        },
      };
    });
  };

  const handleAddPriceRow = () => {
    setPriceNotice(null);
    const nextSeq = priceSeq + 1;
    setPriceSeq(nextSeq);
    const nextRow: SubscriptionPlanPriceRow = {
      localKey: `added-${nextSeq}`,
      duration_label: 'Quarterly',
      duration_days: 90,
      price_inr: 799,
      compare_at_inr: null,
      is_default: draft.prices.length === 0,
      is_active: true,
      sort_order: (draft.prices.length + 1) * 10,
    };
    setDraft((prev) => ({ ...prev, prices: [...prev.prices, nextRow] }));
  };

  const handleUpdatePriceRow = (
    localKey: string,
    patch: Partial<SubscriptionPlanPriceRow>
  ) => {
    setDraft((prev) => ({
      ...prev,
      prices: prev.prices.map((row) => {
        if (patch.is_default === true) {
          return row.localKey === localKey
            ? { ...row, ...patch, is_default: true }
            : { ...row, is_default: false };
        }
        return row.localKey === localKey ? { ...row, ...patch } : row;
      }),
    }));
  };

  const handleRemovePriceRow = (row: SubscriptionPlanPriceRow) => {
    if (draft.prices.length <= 1) {
      setPriceNotice('Each plan must keep at least one duration price row.');
      return;
    }
    setPriceNotice(null);
    if (row.id) {
      setRemovedPriceIds((prev) => [...prev, row.id!]);
    }
    setDraft((prev) => {
      const remaining = prev.prices.filter((r) => r.localKey !== row.localKey);
      if (!remaining.some((r) => r.is_default) && remaining.length > 0) {
        remaining[0] = { ...remaining[0], is_default: true };
      }
      return { ...prev, prices: remaining };
    });
  };

  const cleanTitle = draft.title.trim() || 'Subscription Plan';
  const cleanSlug = slugifyTitle(draft.slug || cleanTitle);
  const defaultPrice = draft.prices.find((p) => p.is_default) || draft.prices[0];

  const handleSubmit = async () => {
    if (validationErrors.length > 0) return;
    await onSave(
      { ...draft, title: cleanTitle, slug: cleanSlug },
      removedPriceIds
    );
  };

  return (
    <FormModal
      isOpen={open}
      title={
        draft.id
          ? `Edit Plan: ${draft.title || 'Subscription Plan'}`
          : 'Create New Subscription Plan'
      }
      subtitle="Writes to subscription_plans & subscription_plan_prices (super_admin RLS + audit_logs)"
      hints={[
        'Existing subscribers retain their entitlements_snapshot until renewal or per-customer override.',
        'The price tier marked Default syncs automatically to legacy price_inr & duration_days for /bulletin?plans=1.',
      ]}
      cautions={[
        'Prefer setting Active Plan off to retire a plan cleanly without breaking checkout history.',
      ]}
      isDirty={isDirty}
      isValid={validationErrors.length === 0}
      validationSummary={validationErrors}
      onSubmitAttempt={() => setSubmitAttempted(true)}
      submitLabel={draft.id ? 'Review & Save Plan' : 'Review & Create Plan'}
      confirmSubmitTitle={
        draft.id
          ? `Save Changes to "${cleanTitle}"?`
          : `Create Subscription Plan "${cleanTitle}"?`
      }
      confirmSubmitDescription="Writes to subscription_plans and subscription_plan_prices, keeps legacy Bulletin plans synced, and records an entry in audit_logs."
      confirmSubmitImpact={[
        `Slug: ${cleanSlug} · Status: ${draft.is_active ? 'Active' : 'Inactive'}`,
        defaultPrice
          ? `Default tier: ${defaultPrice.duration_label} — ₹${defaultPrice.price_inr} / ${defaultPrice.duration_days}d (${draft.prices.length} tier${draft.prices.length === 1 ? '' : 's'} total)`
          : `${draft.prices.length} duration tiers`,
        `Target roles: ${draft.applicable_roles.join(', ') || 'owner'}`,
      ]}
      confirmSubmitVariant="info"
      isSubmitting={saving}
      maxWidthClassName="max-w-4xl"
      onSubmit={handleSubmit}
      onClose={onClose}
    >
      <div
        data-testid="subscription-plan-editor-form"
        className="space-y-5"
      >
        {priceNotice && (
          <div
            role="alert"
            className="flex items-start gap-2 rounded-xl border border-amber-500/35 bg-amber-500/10 p-3 text-xs font-medium text-amber-800 dark:text-amber-200"
          >
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{priceNotice}</span>
          </div>
        )}

        {/* 1. Core Identity */}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div className="sm:col-span-2">
            <label className="mb-1 block text-[11px] font-bold text-[var(--ps-text)]">
              Plan Title *
            </label>
            <input
              type="text"
              required
              value={draft.title}
              onBlur={() => setTitleTouched(true)}
              onChange={(e) => {
                setTitleTouched(true);
                const nextTitle = e.target.value;
                setDraft((prev) => ({
                  ...prev,
                  title: nextTitle,
                  slug: prev.id ? prev.slug : slugifyTitle(nextTitle),
                }));
              }}
              placeholder="e.g., Business Pro Plus"
              className={`min-h-[44px] w-full rounded-xl border bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)] focus:outline-none ${
                (titleTouched || submitAttempted) && draft.title.trim().length < 2
                  ? 'border-rose-500'
                  : 'border-[var(--ps-border)] focus:border-[var(--ps-accent)]'
              }`}
            />
            {(titleTouched || submitAttempted) && draft.title.trim().length < 2 && (
              <p className="mt-1 text-[10.5px] text-rose-600">
                Plan Title must be at least 2 characters.
              </p>
            )}
          </div>
          <div>
            <label className="mb-1 block text-[11px] font-bold text-[var(--ps-text)]">
              Slug *
            </label>
            <input
              type="text"
              required
              value={draft.slug}
              onBlur={() => setSlugTouched(true)}
              onChange={(e) => {
                setSlugTouched(true);
                setDraft((prev) => ({
                  ...prev,
                  slug: e.target.value.toLowerCase(),
                }));
              }}
              placeholder="business-pro-plus"
              className={`min-h-[44px] w-full rounded-xl border px-3 font-mono text-xs focus:outline-none ${
                (slugTouched || submitAttempted) && slugError
                  ? 'border-rose-500 bg-[var(--ps-bg)] text-[var(--ps-text)]'
                  : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text)] focus:border-[var(--ps-accent)]'
              }`}
            />
            {(slugTouched || submitAttempted) && slugError && (
              <p className="mt-1 text-[10.5px] text-rose-600">{slugError}</p>
            )}
          </div>
          <div className="flex flex-col justify-end">
            <label
              className={`inline-flex min-h-[44px] items-center justify-center gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs font-semibold text-[var(--ps-text)] ${
                draft.is_default_free ? 'opacity-65 cursor-not-allowed' : 'cursor-pointer'
              }`}
            >
              <input
                type="checkbox"
                checked={draft.is_default_free ? true : draft.is_active}
                disabled={draft.is_default_free}
                onChange={(e) =>
                  setDraft((prev) => ({ ...prev, is_active: e.target.checked }))
                }
                className="h-4 w-4 accent-[var(--ps-accent)]"
              />
              <span>{draft.is_default_free ? 'Always Active' : 'Active Plan'}</span>
            </label>
          </div>
        </div>

        <div>
          <label className="mb-1 block text-[11px] font-bold text-[var(--ps-text)]">
            Plan Info / Summary
          </label>
          <textarea
            rows={2}
            value={draft.info}
            onChange={(e) =>
              setDraft((prev) => ({ ...prev, info: e.target.value }))
            }
            placeholder="Concise summary shown on public plan cards and checkout."
            className="w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 text-xs text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none"
          />
        </div>

        {/* 2. Target Scope */}
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
          <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3.5 space-y-2">
            <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
              Applicable Roles
            </div>
            <div className="flex flex-wrap gap-1.5">
              {SUBSCRIPTION_ROLE_OPTIONS.map((roleOpt) => {
                const selected = draft.applicable_roles.includes(roleOpt.id);
                return (
                  <button
                    key={roleOpt.id}
                    type="button"
                    onClick={() =>
                      setDraft((prev) => ({
                        ...prev,
                        applicable_roles: toggleArraySelection(
                          prev.applicable_roles,
                          roleOpt.id,
                          false
                        ),
                      }))
                    }
                    className={`inline-flex min-h-[40px] items-center gap-1 rounded-xl border px-2.5 text-[11px] font-semibold transition cursor-pointer ${
                      selected
                        ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                        : 'border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                    }`}
                  >
                    {selected && <Check className="h-3 w-3" />}
                    <span>{roleOpt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3.5 space-y-2.5 lg:col-span-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                  3-Level Category &amp; Sub-Category Scope
                </div>
                <p className="mt-0.5 text-[11px] text-[var(--ps-text-muted)]">
                  Selecting a <strong>Level-1 System Root</strong> or{' '}
                  <strong>Level-2 Category</strong> automatically covers all
                  sub-categories underneath it.
                </p>
              </div>
              <button
                type="button"
                onClick={handleToggleWildcardCategories}
                className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-xl border px-3 text-[11px] font-bold cursor-pointer ${
                  isAllCategoriesSelected
                    ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                    : 'border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                }`}
              >
                {isAllCategoriesSelected && <Check className="h-3.5 w-3.5" />}
                <span>All Categories &amp; Roots (*)</span>
              </button>
            </div>

            <div className="max-h-56 space-y-2 overflow-y-auto pr-1">
              {rootCategories.map((root) => {
                const l2Children = l2ByRootId.get(root.id) || [];
                const rootSelected =
                  !isAllCategoriesSelected &&
                  draft.applicable_category_ids.includes(root.id);
                const isExpanded = expandedRootIds.has(root.id);
                return (
                  <div
                    key={root.id}
                    className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-2.5 space-y-2"
                  >
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <button
                        type="button"
                        onClick={() => handleToggleCategoryNode(root)}
                        className={`inline-flex min-h-[38px] items-center gap-1.5 rounded-lg border px-2.5 text-xs font-semibold cursor-pointer ${
                          rootSelected
                            ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                            : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text)]'
                        }`}
                      >
                        {rootSelected && <Check className="h-3.5 w-3.5" />}
                        <span className="rounded bg-black/10 px-1.5 py-0.5 font-mono text-[10px] uppercase">
                          L1
                        </span>
                        <span>{root.display_name}</span>
                        {root.root_key && (
                          <span className="font-mono text-[10px] opacity-75">
                            ({root.root_key})
                          </span>
                        )}
                      </button>

                      {l2Children.length > 0 && (
                        <button
                          type="button"
                          onClick={() =>
                            setExpandedRootIds((prev) => {
                              const next = new Set(prev);
                              if (next.has(root.id)) next.delete(root.id);
                              else next.add(root.id);
                              return next;
                            })
                          }
                          className="inline-flex min-h-[36px] items-center rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-[11px] font-semibold text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
                        >
                          {isExpanded
                            ? `Hide ${l2Children.length} L2`
                            : `Show ${l2Children.length} L2`}
                        </button>
                      )}
                    </div>

                    {isExpanded && l2Children.length > 0 && (
                      <div className="space-y-1.5 border-l-2 border-[var(--ps-border)] pl-3">
                        {l2Children.map((l2) => {
                          const l3Children = l3ByL2Id.get(l2.id) || [];
                          const l2Selected =
                            !isAllCategoriesSelected &&
                            draft.applicable_category_ids.includes(l2.id);
                          const inheritedFromRoot = rootSelected;
                          return (
                            <div key={l2.id} className="space-y-1">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handleToggleCategoryNode(l2)}
                                  className={`inline-flex min-h-[36px] items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-semibold cursor-pointer ${
                                    l2Selected
                                      ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                                      : inheritedFromRoot
                                        ? 'border-[var(--ps-accent)]/40 bg-[var(--ps-accent)]/10 text-[var(--ps-text)]'
                                        : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                                  }`}
                                >
                                  {(l2Selected || inheritedFromRoot) && (
                                    <Check className="h-3 w-3" />
                                  )}
                                  <span className="font-mono text-[10px]">
                                    L2
                                  </span>
                                  <span>{l2.display_name}</span>
                                  {inheritedFromRoot && !l2Selected && (
                                    <span className="text-[10px] opacity-75">
                                      (Inherited)
                                    </span>
                                  )}
                                </button>

                                {l3Children.map((l3) => {
                                  const l3Selected =
                                    !isAllCategoriesSelected &&
                                    draft.applicable_category_ids.includes(
                                      l3.id
                                    );
                                  const inherited =
                                    rootSelected || l2Selected;
                                  return (
                                    <button
                                      key={l3.id}
                                      type="button"
                                      onClick={() =>
                                        handleToggleCategoryNode(l3)
                                      }
                                      className={`inline-flex min-h-[34px] items-center gap-1 rounded-lg border px-2 text-[10.5px] font-semibold cursor-pointer ${
                                        l3Selected
                                          ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                                          : inherited
                                            ? 'border-[var(--ps-accent)]/35 bg-[var(--ps-accent)]/10 text-[var(--ps-text)]'
                                            : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                                      }`}
                                    >
                                      {(l3Selected || inherited) && (
                                        <Check className="h-2.5 w-2.5" />
                                      )}
                                      <span className="font-mono text-[9.5px]">
                                        L3
                                      </span>
                                      <span>{l3.display_name}</span>
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* 2B. Target Audience & Free Trial Settings (Paid/Trial Plans Only) */}
        {!draft.is_default_free && (
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            {/* Target Audience */}
            <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 space-y-3">
              <div className="flex items-center gap-2">
                <UserCheck className="h-4 w-4 text-[var(--ps-accent)]" />
                <h4 className="text-xs font-bold text-[var(--ps-text)]">
                  Target Audience
                </h4>
              </div>
              <p className="text-[11px] text-[var(--ps-text-muted)]">
                Choose whether everyone sees this plan publicly or restrict it to
                specific invited accounts (filtered by Applicable Roles).
              </p>
              <div className="grid grid-cols-2 gap-2">
                {(
                  [
                    {
                      id: 'public',
                      label: 'Public (All Eligible)',
                    },
                    {
                      id: 'selected_users',
                      label: 'Selected Individuals',
                    },
                  ] as const
                ).map((opt) => {
                  const active = draft.target_scope === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      onClick={() =>
                        setDraft((prev) => ({
                          ...prev,
                          target_scope: opt.id,
                          target_user_ids:
                            opt.id === 'public' ? [] : prev.target_user_ids,
                        }))
                      }
                      className={`min-h-[44px] rounded-xl border px-3 text-xs font-semibold transition cursor-pointer ${
                        active
                          ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                          : 'border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                      }`}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>

              {draft.target_scope === 'selected_users' && (
                <div className="pt-1">
                  <TargetUsersPicker
                    selectedUserIds={draft.target_user_ids}
                    applicableRoles={draft.applicable_roles}
                    onChange={(nextIds) =>
                      setDraft((prev) => ({
                        ...prev,
                        target_user_ids: nextIds,
                      }))
                    }
                    disabled={saving}
                  />
                  {submitAttempted && draft.target_user_ids.length === 0 && (
                    <p className="mt-1.5 text-[11px] font-medium text-rose-600">
                      Pick at least one user for a Selected Individuals plan.
                    </p>
                  )}
                </div>
              )}
            </div>

            {/* Free Trial Settings */}
            <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Gift className="h-4 w-4 text-[var(--ps-accent)]" />
                <h4 className="text-xs font-bold text-[var(--ps-text)]">
                  Free Trial Settings
                </h4>
              </div>
              <p className="text-[11px] text-[var(--ps-text-muted)]">
                Allow eligible users (who have not yet used their one-time trial)
                to start an instant free trial via server-enforced{' '}
                <code className="font-mono">start_plan_trial</code>.
              </p>

              <div className="space-y-3">
                <div>
                  <label className="mb-1 block text-[11px] font-bold text-[var(--ps-text)]">
                    Trial Days (0 = No Trial)
                  </label>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      min={0}
                      max={365}
                      value={draft.trial_days}
                      onChange={(e) =>
                        setDraft((prev) => ({
                          ...prev,
                          trial_days: Math.min(
                            365,
                            Math.max(0, parseInt(e.target.value, 10) || 0)
                          ),
                        }))
                      }
                      className="min-h-[44px] w-28 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 font-mono text-xs tabular-nums text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none"
                    />
                    <span className="text-[11px] text-[var(--ps-text-muted)]">
                      {draft.trial_days > 0
                        ? `Users get ${draft.trial_days} day${draft.trial_days === 1 ? '' : 's'} full trial access`
                        : 'No free trial offered on this plan'}
                    </span>
                  </div>
                </div>

                <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 py-2.5">
                  <div className="min-w-0">
                    <span className="block text-xs font-bold text-[var(--ps-text)]">
                      Auto-Start Trial on Partner Approval
                    </span>
                    <span className="block text-[11px] text-[var(--ps-text-muted)]">
                      Automatically enroll newly approved partners matching this
                      plan&apos;s roles (requires Trial Days &gt; 0).
                    </span>
                  </div>
                  <input
                    type="checkbox"
                    checked={draft.auto_trial_on_approval && draft.trial_days > 0}
                    disabled={draft.trial_days <= 0}
                    onChange={(e) =>
                      setDraft((prev) => ({
                        ...prev,
                        auto_trial_on_approval: e.target.checked,
                      }))
                    }
                    className="h-4 w-4 shrink-0 accent-[var(--ps-accent)]"
                  />
                </label>
              </div>
            </div>
          </div>
        )}

        {/* 3. Multi-Duration Pricing (hidden/locked to ₹0 for Default Free Tier) */}
        {draft.is_default_free ? (
          <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/8 p-4 flex items-center justify-between gap-3 text-xs">
            <div className="flex items-center gap-2.5">
              <Sparkles className="h-4 w-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              <div>
                <p className="font-bold text-[var(--ps-text)]">
                  Canonical ₹0 Default Free Baseline
                </p>
                <p className="text-[11px] text-[var(--ps-text-muted)]">
                  Automatically inherited by all unsubscribed, expired, or
                  suspended users. Pricing is permanently locked at ₹0.
                </p>
              </div>
            </div>
            <span className="rounded-lg bg-emerald-500/15 px-2.5 py-1 font-mono text-xs font-bold text-emerald-700 dark:text-emerald-300 shrink-0">
              ₹0 / Forever
            </span>
          </div>
        ) : (
        <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h4 className="text-xs font-bold text-[var(--ps-text)]">
                Multi-Duration Pricing Tiers
              </h4>
              <p className="text-[11px] text-[var(--ps-text-muted)]">
                Configure Monthly, Quarterly, Annual, or custom duration billing
                options.
              </p>
            </div>
            <button
              type="button"
              onClick={handleAddPriceRow}
              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3.5 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] cursor-pointer"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>Add Duration</span>
            </button>
          </div>

          <div className="space-y-2.5">
            {draft.prices.map((row) => (
              <div
                key={row.localKey}
                className="grid grid-cols-1 gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3 sm:grid-cols-12 sm:items-end"
              >
                <div className="sm:col-span-3">
                  <label className="block text-[10px] font-semibold text-[var(--ps-text-muted)]">
                    Label
                  </label>
                  <input
                    type="text"
                    value={row.duration_label}
                    onChange={(e) =>
                      handleUpdatePriceRow(row.localKey, {
                        duration_label: e.target.value,
                      })
                    }
                    className="mt-1 min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-xs text-[var(--ps-text)]"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[10px] font-semibold text-[var(--ps-text-muted)]">
                    Days
                  </label>
                  <input
                    type="number"
                    min={1}
                    value={row.duration_days}
                    onChange={(e) =>
                      handleUpdatePriceRow(row.localKey, {
                        duration_days: Math.max(
                          1,
                          parseInt(e.target.value, 10) || 1
                        ),
                      })
                    }
                    className="mt-1 min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 font-mono text-xs tabular-nums text-[var(--ps-text)]"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[10px] font-semibold text-[var(--ps-text-muted)]">
                    Price (₹)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="1"
                    value={row.price_inr}
                    onChange={(e) =>
                      handleUpdatePriceRow(row.localKey, {
                        price_inr: Math.max(0, parseFloat(e.target.value) || 0),
                      })
                    }
                    className="mt-1 min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 font-mono text-xs tabular-nums text-[var(--ps-text)]"
                  />
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-[10px] font-semibold text-[var(--ps-text-muted)]">
                    Compare-At (₹)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="1"
                    value={row.compare_at_inr ?? ''}
                    onChange={(e) =>
                      handleUpdatePriceRow(row.localKey, {
                        compare_at_inr:
                          e.target.value.trim() === ''
                            ? null
                            : Math.max(0, parseFloat(e.target.value) || 0),
                      })
                    }
                    placeholder="Optional"
                    className="mt-1 min-h-[44px] w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 font-mono text-xs tabular-nums text-[var(--ps-text)]"
                  />
                </div>
                <div className="flex items-center justify-between gap-1.5 sm:col-span-3">
                  <button
                    type="button"
                    onClick={() =>
                      handleUpdatePriceRow(row.localKey, { is_default: true })
                    }
                    className={`inline-flex min-h-[44px] flex-1 items-center justify-center gap-1 rounded-xl border px-2 text-[11px] font-semibold cursor-pointer ${
                      row.is_default
                        ? 'border-amber-500/40 bg-amber-500/15 text-amber-700 dark:text-amber-300'
                        : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)]'
                    }`}
                  >
                    <Star className="h-3 w-3" />
                    <span>{row.is_default ? 'Default' : 'Set Default'}</span>
                  </button>
                  <button
                    type="button"
                    aria-label="Remove duration price"
                    onClick={() => handleRemovePriceRow(row)}
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-700 hover:bg-rose-500/20 dark:text-rose-300 cursor-pointer"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
        )}

        {/* 4. Entitlements Matrix */}
        <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 space-y-4">
          <div className="flex items-center gap-2">
            <Layers className="h-4 w-4 text-[var(--ps-accent)]" />
            <h4 className="text-xs font-bold text-[var(--ps-text)]">
              Entitlements &amp; Feature Limits Matrix
            </h4>
          </div>

          <div className="space-y-1.5">
            <div className="text-[11px] font-semibold text-[var(--ps-text-muted)]">
              Allowed Listing Verticals
            </div>
            <div className="flex flex-wrap gap-1.5">
              {LISTING_VERTICALS.map((verticalId) => {
                const checked =
                  draft.entitlements.allowed_listing_types.includes(verticalId);
                return (
                  <button
                    key={verticalId}
                    type="button"
                    onClick={() => toggleListingType(verticalId)}
                    className={`inline-flex min-h-[40px] items-center gap-1 rounded-xl border px-3 text-[11px] font-semibold cursor-pointer ${
                      checked
                        ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)]/15 text-[var(--ps-text)]'
                        : 'border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)]'
                    }`}
                  >
                    {checked && (
                      <Check className="h-3 w-3 text-[var(--ps-accent)]" />
                    )}
                    <span>{LISTING_VERTICAL_LABELS[verticalId]}</span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {(
              [
                { key: 'max_listings', label: 'Max Directory Listings' },
                {
                  key: 'max_marketplace_items',
                  label: 'Max Marketplace Items',
                },
              ] as const
            ).map((q) => {
              const val = draft.entitlements[q.key];
              const isUnlimited = val === null;
              return (
                <div
                  key={q.key}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3"
                >
                  <span className="text-xs font-semibold text-[var(--ps-text)]">
                    {q.label}
                  </span>
                  <div className="flex items-center gap-2">
                    <label className="inline-flex min-h-[36px] items-center gap-1.5 text-[11px] text-[var(--ps-text-muted)] cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isUnlimited}
                        onChange={(e) =>
                          setDraft((prev) => ({
                            ...prev,
                            entitlements: {
                              ...prev.entitlements,
                              [q.key]: e.target.checked ? null : 5,
                            },
                          }))
                        }
                        className="h-4 w-4 accent-[var(--ps-accent)]"
                      />
                      <span>Unlimited</span>
                    </label>
                    {!isUnlimited && (
                      <input
                        type="number"
                        min={0}
                        value={val ?? 0}
                        onChange={(e) =>
                          setDraft((prev) => ({
                            ...prev,
                            entitlements: {
                              ...prev.entitlements,
                              [q.key]: Math.max(
                                0,
                                parseInt(e.target.value, 10) || 0
                              ),
                            },
                          }))
                        }
                        className="min-h-[40px] w-20 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 font-mono text-xs tabular-nums text-[var(--ps-text)]"
                      />
                    )}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
            {ENTITLEMENT_FEATURE_META.map((meta) => {
              const current = draft.entitlements[meta.key];
              const isUnlimited = current.limit === null;
              return (
                <div
                  key={meta.key}
                  className="flex flex-col justify-between gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="text-xs font-bold text-[var(--ps-text)]">
                        {meta.label}
                      </div>
                      <div className="text-[11px] text-[var(--ps-text-muted)]">
                        {meta.description}
                      </div>
                    </div>
                    <label className="inline-flex min-h-[40px] shrink-0 cursor-pointer items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-[11px] font-semibold">
                      <input
                        type="checkbox"
                        checked={current.enabled}
                        onChange={(e) =>
                          updateFeatureEntitlement(meta.key, {
                            enabled: e.target.checked,
                            limit:
                              e.target.checked && current.limit === 0
                                ? meta.supportsNumericLimit
                                  ? 5
                                  : null
                                : current.limit,
                          })
                        }
                        className="h-4 w-4 accent-[var(--ps-accent)]"
                      />
                      <span>{current.enabled ? 'On' : 'Off'}</span>
                    </label>
                  </div>

                  {current.enabled && meta.supportsNumericLimit && (
                    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--ps-border)]/60 pt-2">
                      <span className="text-[10px] font-semibold uppercase tracking-wide text-[var(--ps-text-muted)]">
                        Quota ({meta.unitLabel})
                      </span>
                      <div className="flex items-center gap-2">
                        <label className="inline-flex items-center gap-1 text-[11px] text-[var(--ps-text-muted)] cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isUnlimited}
                            onChange={(e) =>
                              updateFeatureEntitlement(meta.key, {
                                limit: e.target.checked ? null : 5,
                              })
                            }
                            className="h-4 w-4 accent-[var(--ps-accent)]"
                          />
                          <span>Unlimited</span>
                        </label>
                        {!isUnlimited && (
                          <input
                            type="number"
                            min={0}
                            value={current.limit ?? 0}
                            onChange={(e) =>
                              updateFeatureEntitlement(meta.key, {
                                limit: Math.max(
                                  0,
                                  parseInt(e.target.value, 10) || 0
                                ),
                              })
                            }
                            className="min-h-[38px] w-20 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 font-mono text-xs tabular-nums text-[var(--ps-text)]"
                          />
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          {/* 4B. Auto-Verified Publishing Controls */}
          <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-3.5 space-y-3">
            <div className="flex items-center gap-2">
              <ShieldCheck className="h-4 w-4 text-[var(--ps-accent)]" />
              <h5 className="text-xs font-bold text-[var(--ps-text)]">
                Auto-Verified Publishing Controls
              </h5>
            </div>

            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-2.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2">
                <div className="min-w-0">
                  <span className="block text-xs font-bold text-[var(--ps-text)]">
                    Auto-Verify Listings
                  </span>
                  <span className="block text-[11px] text-[var(--ps-text-muted)]">
                    New listings publish with a verified badge automatically
                    (Admins can still unpublish/unverify anytime).
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={draft.entitlements.auto_verify_listings}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      entitlements: {
                        ...prev.entitlements,
                        auto_verify_listings: e.target.checked,
                      },
                    }))
                  }
                  className="h-4 w-4 shrink-0 accent-[var(--ps-accent)]"
                />
              </label>

              <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-2.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2">
                <div className="min-w-0">
                  <span className="block text-xs font-bold text-[var(--ps-text)]">
                    Auto-Verify Bulletins
                  </span>
                  <span className="block text-[11px] text-[var(--ps-text-muted)]">
                    Bulletins published under this plan receive verified status
                    automatically.
                  </span>
                </div>
                <input
                  type="checkbox"
                  checked={draft.entitlements.auto_verify_bulletins}
                  onChange={(e) =>
                    setDraft((prev) => ({
                      ...prev,
                      entitlements: {
                        ...prev.entitlements,
                        auto_verify_bulletins: e.target.checked,
                      },
                    }))
                  }
                  className="h-4 w-4 shrink-0 accent-[var(--ps-accent)]"
                />
              </label>
            </div>

            <div className="flex items-start gap-2 rounded-xl border border-amber-500/35 bg-amber-500/10 px-3 py-2.5 text-[11px] text-amber-800 dark:text-amber-200">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
              <span>
                <strong>Moderation Caution:</strong> Reserve auto-verification
                for vetted partner tiers or <strong>Selected Individuals</strong>{' '}
                plans. Avoid enabling auto-verify on open low-cost or free public
                plans to prevent unreviewed spam.
              </span>
            </div>
          </div>
        </div>
      </div>
    </FormModal>
  );
}

// =============================================================================
// MAIN SUBSCRIPTION PLANS BUILDER
// =============================================================================
export function SubscriptionPlansBuilder({
  onNotice,
}: SubscriptionPlansBuilderProps) {
  const { confirm, dialog } = useConfirmDialogState();
  const sensors = useTouchSafeSensors();

  const [dbPlans, setDbPlans] = useState<SubscriptionPlanRecord[]>([]);
  const [draftPlans, setDraftPlans] = useState<SubscriptionPlanRecord[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [modalDraft, setModalDraft] = useState<PlanDraft | null>(null);
  const [modalSeq, setModalSeq] = useState(0);
  const [isSaving, setIsSaving] = useState(false);
  const [savingOrder, setSavingOrder] = useState(false);
  const [deletingPlanId, setDeletingPlanId] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    setErrorMsg(null);
    if (!isSupabaseConfigured()) {
      setIsLoading(false);
      setErrorMsg('Supabase is not configured in this environment.');
      return;
    }

    try {
      const [plansRes, pricesRes, catsRes] = await Promise.all([
        supabase
          .from('subscription_plans')
          .select('*')
          .order('sort_order', { ascending: true })
          .order('price_inr', { ascending: true }),
        supabase
          .from('subscription_plan_prices')
          .select('*')
          .order('sort_order', { ascending: true })
          .order('duration_days', { ascending: true }),
        supabase
          .from('categories')
          .select('*')
          .eq('is_active', true)
          .order('sort_order', { ascending: true })
          .order('display_name', { ascending: true }),
      ]);

      if (plansRes.error) throw new Error(plansRes.error.message);

      const rawPrices =
        !pricesRes.error && Array.isArray(pricesRes.data) ? pricesRes.data : [];
      const pricesByPlan = new Map<string, SubscriptionPlanPriceRow[]>();

      for (const p of rawPrices as Record<string, unknown>[]) {
        const pid = String(p.plan_id || '');
        if (!pid) continue;
        const list = pricesByPlan.get(pid) ?? [];
        list.push({
          id: String(p.id || ''),
          localKey: String(p.id || `p-${list.length}`),
          plan_id: pid,
          duration_label: String(p.duration_label || 'Monthly'),
          duration_days: Number(p.duration_days || 30),
          price_inr: Number(p.price_inr || 0),
          compare_at_inr:
            p.compare_at_inr !== null && p.compare_at_inr !== undefined
              ? Number(p.compare_at_inr)
              : null,
          is_default: Boolean(p.is_default),
          is_active: p.is_active !== false,
          sort_order: Number(p.sort_order || 0),
        });
        pricesByPlan.set(pid, list);
      }

      const normalizedPlans: SubscriptionPlanRecord[] = (
        (plansRes.data as Record<string, unknown>[]) || []
      ).map((row) => {
        const id = String(row.id || '');
        const existingPrices = pricesByPlan.get(id) ?? [];
        const fallbackPrice: SubscriptionPlanPriceRow = {
          localKey: `legacy-${id}`,
          plan_id: id,
          duration_label:
            Number(row.duration_days || 30) >= 360
              ? 'Annual'
              : Number(row.duration_days || 30) <= 35
                ? 'Monthly'
                : `${Number(row.duration_days || 30)} Days`,
          duration_days: Math.max(1, Number(row.duration_days || 30)),
          price_inr: Math.max(0, Number(row.price_inr || 0)),
          compare_at_inr:
            row.original_price_inr !== null &&
            row.original_price_inr !== undefined
              ? Number(row.original_price_inr)
              : null,
          is_default: true,
          is_active: row.is_active !== false,
          sort_order: 10,
        };

        return {
          id,
          slug: String(row.slug || ''),
          name: String(row.name || row.title || 'Plan'),
          title: String(row.title || row.name || 'Plan'),
          info: String(row.info || row.tagline || ''),
          price_inr: Number(row.price_inr || 0),
          duration_days: Number(row.duration_days || 30),
          max_active_bulletins:
            typeof row.max_active_bulletins === 'number'
              ? row.max_active_bulletins
              : undefined,
          applicable_roles: Array.isArray(row.applicable_roles)
            ? (row.applicable_roles as string[])
            : ['owner'],
          applicable_categories:
            Array.isArray(row.applicable_categories) &&
            row.applicable_categories.length > 0
              ? (row.applicable_categories as string[])
              : ['*'],
          applicable_subcategories:
            Array.isArray(row.applicable_subcategories) &&
            row.applicable_subcategories.length > 0
              ? (row.applicable_subcategories as string[])
              : ['*'],
          applicable_category_ids: Array.isArray(row.applicable_category_ids)
            ? (row.applicable_category_ids as string[]).map(String)
            : [],
          applicable_root_keys:
            Array.isArray(row.applicable_root_keys) &&
            row.applicable_root_keys.length > 0
              ? (row.applicable_root_keys as string[]).map(String)
              : ['*'],
          entitlements: normalizePlanEntitlements(row.entitlements),
          is_active: row.is_active !== false,
          is_default_free: Boolean(row.is_default_free),
          is_archived: Boolean(row.is_archived),
          trial_days: Math.max(0, Number(row.trial_days || 0)),
          auto_trial_on_approval: Boolean(row.auto_trial_on_approval),
          target_scope:
            row.target_scope === 'selected_users'
              ? 'selected_users'
              : 'public',
          target_user_ids: Array.isArray(row.target_user_ids)
            ? (row.target_user_ids as string[]).map(String).filter(Boolean)
            : [],
          sort_order: Number(row.sort_order ?? row.display_order ?? 0),
          updated_at:
            typeof row.updated_at === 'string' ? row.updated_at : undefined,
          prices: existingPrices.length > 0 ? existingPrices : [fallbackPrice],
        };
      });

      setDbPlans(normalizedPlans);
      setDraftPlans(normalizedPlans);
      if (!catsRes.error && Array.isArray(catsRes.data)) {
        setCategories(catsRes.data as CategoryOption[]);
      }
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Failed to load subscription plans.'
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    queueMicrotask(() => {
      void loadData();
    });
  }, [loadData]);

  const rootCategories = useMemo(
    () => categories.filter((c) => !c.parent_id),
    [categories]
  );

  const subCategories = useMemo(
    () => categories.filter((c) => Boolean(c.parent_id)),
    [categories]
  );

  const defaultFreePlan = useMemo(
    () => draftPlans.find((p) => p.is_default_free) ?? null,
    [draftPlans]
  );

  const archivedPlans = useMemo(
    () =>
      draftPlans
        .filter((p) => !p.is_default_free && p.is_archived)
        .sort((a, b) => a.sort_order - b.sort_order),
    [draftPlans]
  );

  const sortedDraftPlans = useMemo(
    () =>
      draftPlans
        .filter((p) => !p.is_default_free && !p.is_archived)
        .sort((a, b) => a.sort_order - b.sort_order),
    [draftPlans]
  );

  const pendingOrderDiff = useMemo(() => {
    const dbMap = new Map(dbPlans.map((p) => [p.id, p]));
    const changed: Array<{ id: string; sort_order: number }> = [];
    for (const plan of sortedDraftPlans) {
      const orig = dbMap.get(plan.id);
      if (orig && orig.sort_order !== plan.sort_order) {
        changed.push({ id: plan.id, sort_order: plan.sort_order });
      }
    }
    return {
      changed,
      count: changed.length,
      hasChanges: changed.length > 0,
    };
  }, [dbPlans, sortedDraftPlans]);

  const applyReorderedActivePlans = (reorderedActive: SubscriptionPlanRecord[]) => {
    const byId = new Map(reorderedActive.map((p) => [p.id, p]));
    setDraftPlans((prev) =>
      prev.map((p) => byId.get(p.id) ?? p)
    );
  };

  const handlePlanDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIdx = sortedDraftPlans.findIndex((p) => p.id === active.id);
    const newIdx = sortedDraftPlans.findIndex((p) => p.id === over.id);
    if (oldIdx < 0 || newIdx < 0) return;
    const reordered = arrayMove(sortedDraftPlans, oldIdx, newIdx).map(
      (p, idx) => ({ ...p, sort_order: (idx + 1) * 10 })
    );
    applyReorderedActivePlans(reordered);
  };

  const movePlanByStep = (planId: string, delta: -1 | 1) => {
    const idx = sortedDraftPlans.findIndex((p) => p.id === planId);
    const nextIdx = idx + delta;
    if (idx < 0 || nextIdx < 0 || nextIdx >= sortedDraftPlans.length) return;
    const reordered = arrayMove(sortedDraftPlans, idx, nextIdx).map((p, i) => ({
      ...p,
      sort_order: (i + 1) * 10,
    }));
    applyReorderedActivePlans(reordered);
  };

  const handleSavePlanOrder = async () => {
    if (!pendingOrderDiff.hasChanges) return;
    const ok = await confirm({
      title: 'Save Subscription Plan Sequence?',
      description:
        'Persists the new sort_order on public.subscription_plans so public pricing cards appear in this exact order.',
      impactSummary: [
        `${pendingOrderDiff.count} plan order position${pendingOrderDiff.count === 1 ? '' : 's'} updated`,
      ],
      confirmLabel: 'Save Order',
      variant: 'info',
    });
    if (!ok) return;

    setSavingOrder(true);
    try {
      const results = await Promise.all(
        pendingOrderDiff.changed.map((row) =>
          supabase
            .from('subscription_plans')
            .update({ sort_order: row.sort_order, display_order: row.sort_order })
            .eq('id', row.id)
        )
      );
      const firstErr = results.find((r) => r.error)?.error;
      if (firstErr) throw new Error(firstErr.message);

      onNotice?.({
        type: 'success',
        text: `Saved display order for ${pendingOrderDiff.count} subscription plan${pendingOrderDiff.count === 1 ? '' : 's'}.`,
      });
      await loadData();
    } catch (err) {
      onNotice?.({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Failed to save subscription plan order.',
      });
    } finally {
      setSavingOrder(false);
    }
  };

  const openCreateEditor = () => {
    const nextSeq = modalSeq + 1;
    setModalSeq(nextSeq);
    const maxSort = sortedDraftPlans.reduce(
      (m, p) => Math.max(m, p.sort_order),
      0
    );
    setModalDraft(createEmptyDraft(maxSort + 10, nextSeq));
  };

  const openEditEditor = (plan: SubscriptionPlanRecord) => {
    const nextSeq = modalSeq + 1;
    setModalSeq(nextSeq);
    setModalDraft({
      id: plan.id,
      title: plan.title,
      slug: plan.slug,
      info: plan.info,
      is_active: plan.is_active,
      is_default_free: plan.is_default_free,
      is_archived: plan.is_archived,
      trial_days: plan.trial_days,
      auto_trial_on_approval: plan.auto_trial_on_approval,
      target_scope: plan.target_scope,
      target_user_ids: [...plan.target_user_ids],
      sort_order: plan.sort_order,
      applicable_roles: [...plan.applicable_roles],
      applicable_categories: [...plan.applicable_categories],
      applicable_subcategories: [...plan.applicable_subcategories],
      applicable_category_ids: [...plan.applicable_category_ids],
      applicable_root_keys: [...plan.applicable_root_keys],
      entitlements: normalizePlanEntitlements(plan.entitlements),
      prices: plan.prices.map((p, idx) => ({
        ...p,
        localKey: p.id || `price-${nextSeq}-${idx}`,
      })),
    });
  };

  const handleSavePlan = async (draft: PlanDraft, removedPriceIds: string[]) => {
    const defaultPrice =
      draft.prices.find((p) => p.is_default) || draft.prices[0];
    const normalizedEnt = normalizePlanEntitlements(draft.entitlements);

    setIsSaving(true);
    try {
      const planPayload: Record<string, unknown> = {
        slug: draft.slug,
        name: draft.title,
        title: draft.title,
        info: draft.info.trim(),
        tagline: draft.info.trim(),
        price_inr: draft.is_default_free
          ? 0
          : Math.max(0, Number(defaultPrice?.price_inr || 0)),
        original_price_inr: draft.is_default_free
          ? null
          : defaultPrice?.compare_at_inr ?? null,
        duration_days: draft.is_default_free
          ? 3650
          : Math.max(1, Number(defaultPrice?.duration_days || 30)),
        max_active_bulletins: normalizedEnt.bulletins.enabled
          ? normalizedEnt.bulletins.limit ?? 50
          : 0,
        applicable_roles:
          draft.applicable_roles.length > 0 ? draft.applicable_roles : ['owner'],
        applicable_categories:
          draft.applicable_categories.length > 0
            ? draft.applicable_categories
            : ['*'],
        applicable_subcategories:
          draft.applicable_subcategories.length > 0
            ? draft.applicable_subcategories
            : ['*'],
        applicable_category_ids: draft.applicable_category_ids,
        applicable_root_keys:
          draft.applicable_root_keys.length > 0
            ? draft.applicable_root_keys
            : ['*'],
        entitlements: normalizedEnt,
        is_active: draft.is_default_free ? true : draft.is_active,
        is_archived: draft.is_default_free ? false : draft.is_archived,
        trial_days: draft.is_default_free
          ? 0
          : Math.min(365, Math.max(0, Math.floor(Number(draft.trial_days || 0)))),
        auto_trial_on_approval:
          !draft.is_default_free &&
          draft.trial_days > 0 &&
          Boolean(draft.auto_trial_on_approval),
        target_scope: draft.is_default_free ? 'public' : draft.target_scope,
        target_user_ids:
          !draft.is_default_free && draft.target_scope === 'selected_users'
            ? Array.from(new Set(draft.target_user_ids))
            : [],
        sort_order: draft.is_default_free ? 0 : Number(draft.sort_order || 0),
        display_order: draft.is_default_free ? 0 : Number(draft.sort_order || 0),
      };

      const stripMissingCols = (errMsg: string) => {
        if (/(applicable_category_ids|applicable_root_keys)/i.test(errMsg)) {
          delete planPayload.applicable_category_ids;
          delete planPayload.applicable_root_keys;
        }
        if (
          /(trial_days|auto_trial_on_approval|target_scope|target_user_ids|is_archived)/i.test(
            errMsg
          )
        ) {
          delete planPayload.trial_days;
          delete planPayload.auto_trial_on_approval;
          delete planPayload.target_scope;
          delete planPayload.target_user_ids;
          delete planPayload.is_archived;
        }
      };

      let savedPlanId = draft.id;
      if (savedPlanId) {
        let { error: updErr } = await supabase
          .from('subscription_plans')
          .update(planPayload)
          .eq('id', savedPlanId);
        if (
          updErr &&
          /(applicable_category_ids|applicable_root_keys|trial_days|auto_trial_on_approval|target_scope|target_user_ids|is_archived)/i.test(
            updErr.message
          )
        ) {
          stripMissingCols(updErr.message);
          const retry = await supabase
            .from('subscription_plans')
            .update(planPayload)
            .eq('id', savedPlanId);
          updErr = retry.error;
        }
        if (updErr) throw new Error(updErr.message);
      } else {
        let { data: insData, error: insErr } = await supabase
          .from('subscription_plans')
          .insert(planPayload)
          .select('id')
          .single();
        if (
          insErr &&
          /(applicable_category_ids|applicable_root_keys|trial_days|auto_trial_on_approval|target_scope|target_user_ids|is_archived)/i.test(
            insErr.message
          )
        ) {
          stripMissingCols(insErr.message);
          const retry = await supabase
            .from('subscription_plans')
            .insert(planPayload)
            .select('id')
            .single();
          insData = retry.data;
          insErr = retry.error;
        }
        if (insErr || !insData?.id) {
          throw new Error(insErr?.message || 'Failed to create plan.');
        }
        savedPlanId = String(insData.id);
      }

      if (removedPriceIds.length > 0) {
        const { error: delPriceErr } = await supabase
          .from('subscription_plan_prices')
          .delete()
          .in('id', removedPriceIds);
        if (delPriceErr) throw new Error(delPriceErr.message);
      }

      for (let idx = 0; idx < draft.prices.length; idx += 1) {
        const row = draft.prices[idx];
        const pricePayload = {
          plan_id: savedPlanId,
          duration_label:
            row.duration_label.trim() || `${row.duration_days} Days`,
          duration_days: Math.max(1, Math.floor(Number(row.duration_days || 30))),
          price_inr: Math.max(0, Number(row.price_inr || 0)),
          compare_at_inr:
            row.compare_at_inr !== null && Number(row.compare_at_inr) > 0
              ? Number(row.compare_at_inr)
              : null,
          is_default: Boolean(row.is_default),
          is_active: row.is_active !== false,
          sort_order: (idx + 1) * 10,
        };

        if (row.id) {
          const { error: pUpdErr } = await supabase
            .from('subscription_plan_prices')
            .update(pricePayload)
            .eq('id', row.id);
          if (pUpdErr) throw new Error(pUpdErr.message);
        } else {
          const { error: pInsErr } = await supabase
            .from('subscription_plan_prices')
            .insert(pricePayload);
          if (pInsErr) throw new Error(pInsErr.message);
        }
      }

      onNotice?.({
        type: 'success',
        text: `Saved subscription plan "${draft.title}" (${draft.prices.length} duration tier${draft.prices.length === 1 ? '' : 's'}).`,
      });
      setModalDraft(null);
      await loadData();
    } catch (err) {
      onNotice?.({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Failed to save subscription plan.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  const handleTogglePlanActive = async (plan: SubscriptionPlanRecord) => {
    const nextActive = !plan.is_active;
    const ok = await confirm({
      title: `${nextActive ? 'Activate' : 'Deactivate'} "${plan.title}"?`,
      description: nextActive
        ? 'This plan will be visible for new partner checkouts.'
        : 'Deactivating hides this plan from new signups while preserving all existing subscriber snapshots.',
      impactSummary: [
        `Plan slug: ${plan.slug}`,
        `Duration tiers: ${plan.prices.length}`,
      ],
      confirmLabel: nextActive ? 'Activate Plan' : 'Deactivate Plan',
      variant: nextActive ? 'info' : 'warning',
    });
    if (!ok) return;

    try {
      const { error } = await supabase
        .from('subscription_plans')
        .update({ is_active: nextActive })
        .eq('id', plan.id);
      if (error) throw new Error(error.message);
      onNotice?.({
        type: 'success',
        text: `${nextActive ? 'Activated' : 'Deactivated'} "${plan.title}".`,
      });
      await loadData();
    } catch (err) {
      onNotice?.({
        type: 'error',
        text:
          err instanceof Error ? err.message : 'Failed to toggle plan status.',
      });
    }
  };

  const handleDeletePlan = async (plan: SubscriptionPlanRecord) => {
    const ok = await confirm({
      title: `Permanently Delete "${plan.title}"?`,
      description:
        'Deleting this plan permanently removes its duration pricing rows. Existing subscribers keep their entitlements_snapshot, but new checkouts will no longer see this plan.',
      caution:
        'Prefer deactivating a plan if you want to preserve checkout analytics and billing history.',
      impactSummary: [
        `Plan slug: ${plan.slug}`,
        `Removes ${plan.prices.length} duration price tier(s)`,
      ],
      confirmLabel: 'Delete Permanently',
      variant: 'danger',
    });
    if (!ok) return;

    setDeletingPlanId(plan.id);
    try {
      const { error } = await supabase
        .from('subscription_plans')
        .delete()
        .eq('id', plan.id);
      if (error) throw new Error(error.message);
      onNotice?.({
        type: 'info',
        text: `Deleted subscription plan "${plan.title}".`,
      });
      await loadData();
    } catch (err) {
      onNotice?.({
        type: 'error',
        text:
          err instanceof Error
            ? err.message
            : 'Could not delete plan (check active subscriber FK references).',
      });
    } finally {
      setDeletingPlanId(null);
    }
  };

  return (
    <section
      data-testid="superadmin-subscription-plans-builder"
      className="space-y-4 pb-20"
    >
      {dialog}

      {modalDraft && (
        <PlanEditorModal
          key={`plan-modal-${modalSeq}`}
          open={Boolean(modalDraft)}
          initialDraft={modalDraft}
          allPlans={dbPlans}
          allCategories={categories}
          rootCategories={rootCategories}
          subCategories={subCategories}
          saving={isSaving}
          onClose={() => setModalDraft(null)}
          onSave={handleSavePlan}
        />
      )}

      {/* Header Bar */}
      <div className="flex flex-col gap-3 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <BadgePercent className="h-4 w-4 text-[var(--ps-accent)] shrink-0" />
            <h2 className="text-sm font-bold text-[var(--ps-text)]">
              Composable Subscription Plans &amp; Multi-Duration Pricing
            </h2>
          </div>
          <p className="mt-1 text-xs text-[var(--ps-text-muted)]">
            Preview-first plan studio. Drag handles to sequence plans on public
            pricing cards, or click <strong>Edit</strong> to configure roles,
            categories, multi-duration prices, and entitlements inside the modal.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {archivedPlans.length > 0 && (
            <button
              type="button"
              onClick={() => setShowArchived((v) => !v)}
              className={`inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border px-3.5 text-xs font-semibold transition cursor-pointer ${
                showArchived
                  ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)]/12 text-[var(--ps-text)]'
                  : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
              }`}
            >
              <Archive className="h-3.5 w-3.5" />
              <span>
                {showArchived
                  ? `Hide Archived (${archivedPlans.length})`
                  : `Show Archived (${archivedPlans.length})`}
              </span>
            </button>
          )}
          <button
            type="button"
            onClick={() => void loadData()}
            disabled={isLoading}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw
              className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`}
            />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            data-testid="create-subscription-plan-btn"
            onClick={openCreateEditor}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-4 text-xs font-bold text-[var(--ps-accent-fg)] hover:opacity-95 cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            <span>New Plan</span>
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3.5 text-xs text-rose-700 dark:text-rose-300">
          {errorMsg}
        </div>
      )}

      {/* Pinned Default Free Tier Card (Always Active, Cannot Delete/Archive) */}
      {!isLoading && defaultFreePlan && (
        <div
          data-testid="pinned-default-free-plan-card"
          className="rounded-2xl border-2 border-emerald-500/40 bg-[var(--ps-surface)] p-4 sm:p-5 space-y-3"
        >
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="inline-flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                  <Sparkles className="h-3 w-3" />
                  <span>Pinned Default Free Baseline</span>
                </span>
                <h3 className="text-sm font-bold text-[var(--ps-text)]">
                  {defaultFreePlan.title}
                </h3>
                <span className="rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-0.5 font-mono text-[10px] font-bold text-[var(--ps-text)]">
                  ₹0 / Forever
                </span>
              </div>
              <p className="text-xs text-[var(--ps-text-muted)]">
                {defaultFreePlan.info ||
                  'Automatically inherited by all unsubscribed, expired, or suspended users so premium features soft-freeze cleanly without deleting data.'}
              </p>
            </div>
            <button
              type="button"
              onClick={() => openEditEditor(defaultFreePlan)}
              className="inline-flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-4 text-xs font-semibold text-[var(--ps-text)] hover:border-[var(--ps-accent)] hover:text-[var(--ps-accent)] cursor-pointer"
            >
              <Edit3 className="h-3.5 w-3.5" />
              <span>Edit Baseline Limits</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-[var(--ps-text-muted)]">
            <span className="rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-0.5 font-semibold">
              Max Listings:{' '}
              {defaultFreePlan.entitlements.max_listings === null
                ? '∞'
                : defaultFreePlan.entitlements.max_listings}
            </span>
            <span className="rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-0.5 font-semibold">
              Marketplace Items:{' '}
              {defaultFreePlan.entitlements.max_marketplace_items === null
                ? '∞'
                : defaultFreePlan.entitlements.max_marketplace_items}
            </span>
            <span className="rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-0.5 font-semibold">
              Staff Quota:{' '}
              {defaultFreePlan.entitlements.staffing.enabled
                ? defaultFreePlan.entitlements.staffing.max_staff ??
                  defaultFreePlan.entitlements.staffing.limit ??
                  '∞'
                : '0 (Off)'}
            </span>
            <span className="rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-0.5 font-semibold">
              Online UPI:{' '}
              {defaultFreePlan.entitlements.online_payment.enabled
                ? 'Allowed'
                : 'Manual Only'}
            </span>
            <span className="rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-0.5 font-semibold">
              PnD Dispatch:{' '}
              {defaultFreePlan.entitlements.pnd_dispatch.enabled ? 'On' : 'Off'}
            </span>
          </div>
        </div>
      )}

      {/* Sortable Preview Cards */}
      {isLoading ? (
        <PlansBuilderSkeleton />
      ) : sortedDraftPlans.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-surface)] p-8 text-center text-xs text-[var(--ps-text-muted)] space-y-3">
          <p>
            No subscription plans found yet. Click <strong>New Plan</strong> to
            create one.
          </p>
          <button
            type="button"
            onClick={openCreateEditor}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-4 text-xs font-bold text-[var(--ps-accent-fg)] cursor-pointer"
          >
            <Plus className="h-4 w-4" />
            <span>Create First Plan</span>
          </button>
        </div>
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handlePlanDragEnd}
        >
          <SortableContext
            items={sortedDraftPlans.map((p) => p.id)}
            strategy={rectSortingStrategy}
          >
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              {sortedDraftPlans.map((plan, idx) => {
                const enabledFeatures = ENTITLEMENT_FEATURE_META.filter(
                  (m) => plan.entitlements[m.key]?.enabled
                );
                return (
                  <SortablePreviewItem
                    key={plan.id}
                    id={plan.id}
                    dragLabel={`Reorder plan ${plan.title}`}
                  >
                    {({ dragHandleProps }) => (
                      <div
                        data-testid={`plan-card-${plan.slug || plan.id}`}
                        className={`flex h-full flex-col justify-between gap-3 rounded-2xl border p-4 transition-colors ${
                          plan.is_active
                            ? 'border-[var(--ps-border)] bg-[var(--ps-surface)]'
                            : 'border-dashed border-[var(--ps-border)] bg-[var(--ps-surface)]/65 opacity-75'
                        }`}
                      >
                        <div className="space-y-3">
                          <div className="flex items-start justify-between gap-2">
                            <div className="flex items-start gap-2.5 min-w-0">
                              <DragHandleButton
                                handleProps={dragHandleProps}
                                compact
                              />
                              <div className="min-w-0">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <h3 className="text-sm font-bold text-[var(--ps-text)] truncate">
                                    {plan.title}
                                  </h3>
                                  <span
                                    className={`rounded-md px-2 py-0.5 text-[10px] font-bold uppercase ${
                                      plan.is_active
                                        ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                                        : 'bg-slate-500/15 text-slate-600 dark:text-slate-300'
                                    }`}
                                  >
                                    {plan.is_active ? 'Active' : 'Inactive'}
                                  </span>
                                </div>
                                <div className="mt-0.5 font-mono text-[11px] text-[var(--ps-text-muted)]">
                                  {plan.slug} · Order #{plan.sort_order}
                                </div>
                              </div>
                            </div>
                          </div>

                          {plan.info && (
                            <p className="text-xs text-[var(--ps-text-muted)]">
                              {plan.info}
                            </p>
                          )}

                          {/* Duration Pricing Chips */}
                          <div className="flex flex-wrap gap-1.5">
                            {plan.prices.map((pr) => (
                              <div
                                key={pr.localKey}
                                className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 text-[11px] font-mono tabular-nums ${
                                  pr.is_default
                                    ? 'border-[var(--ps-accent)]/40 bg-[var(--ps-accent)]/10 text-[var(--ps-text)] font-bold'
                                    : 'border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)]'
                                }`}
                              >
                                <span>{pr.duration_label}</span>
                                <span>·</span>
                                <span>₹{pr.price_inr}</span>
                                <span className="text-[10px] opacity-75">
                                  ({pr.duration_days}d)
                                </span>
                              </div>
                            ))}
                          </div>

                          {/* Scope & Feature Summary */}
                          <div className="flex flex-wrap items-center gap-1.5 text-[10px] text-[var(--ps-text-muted)]">
                            {plan.trial_days > 0 && (
                              <span className="inline-flex items-center gap-1 rounded-md border border-sky-500/35 bg-sky-500/10 px-2 py-0.5 font-bold text-sky-700 dark:text-sky-300">
                                <Clock className="h-3 w-3" />
                                <span>
                                  {plan.trial_days}d Free Trial
                                  {plan.auto_trial_on_approval ? ' · Auto' : ''}
                                </span>
                              </span>
                            )}
                            {plan.target_scope === 'selected_users' && (
                              <span className="inline-flex items-center gap-1 rounded-md border border-violet-500/35 bg-violet-500/10 px-2 py-0.5 font-bold text-violet-700 dark:text-violet-300">
                                <UserCheck className="h-3 w-3" />
                                <span>
                                  Targeted ({plan.target_user_ids.length} user
                                  {plan.target_user_ids.length === 1 ? '' : 's'})
                                </span>
                              </span>
                            )}
                            {(plan.entitlements.auto_verify_listings ||
                              plan.entitlements.auto_verify_bulletins) && (
                              <span className="inline-flex items-center gap-1 rounded-md border border-emerald-500/35 bg-emerald-500/10 px-2 py-0.5 font-bold text-emerald-700 dark:text-emerald-300">
                                <ShieldCheck className="h-3 w-3" />
                                <span>
                                  Auto-Verify:{' '}
                                  {[
                                    plan.entitlements.auto_verify_listings
                                      ? 'Listings'
                                      : null,
                                    plan.entitlements.auto_verify_bulletins
                                      ? 'Bulletins'
                                      : null,
                                  ]
                                    .filter(Boolean)
                                    .join(' + ')}
                                </span>
                              </span>
                            )}
                            <span className="rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-0.5 font-semibold">
                              Roles: {plan.applicable_roles.join(', ') || 'all'}
                            </span>
                            <span className="rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-0.5 font-semibold">
                              Listings:{' '}
                              {plan.entitlements.max_listings === null
                                ? '∞'
                                : plan.entitlements.max_listings}
                            </span>
                            <span className="rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-0.5 font-semibold">
                              Staff:{' '}
                              {plan.entitlements.staffing.enabled
                                ? plan.entitlements.staffing.max_staff ??
                                  plan.entitlements.staffing.limit ??
                                  '∞'
                                : 'Off'}
                            </span>
                            <span className="rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-0.5 font-semibold">
                              UPI:{' '}
                              {plan.entitlements.online_payment.enabled
                                ? 'Allowed'
                                : 'Blocked'}
                            </span>
                            <span className="rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-0.5 font-semibold">
                              {enabledFeatures.length} features enabled
                            </span>
                          </div>
                        </div>

                        {/* Card Footer Actions (44px+ touch targets) */}
                        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-[var(--ps-border)]/70 pt-3">
                          <MobileOrderButtons
                            canMoveUp={idx > 0}
                            canMoveDown={idx < sortedDraftPlans.length - 1}
                            onMoveUp={() => movePlanByStep(plan.id, -1)}
                            onMoveDown={() => movePlanByStep(plan.id, 1)}
                            itemLabel={plan.title}
                          />

                          <div className="flex items-center gap-1.5">
                            <button
                              type="button"
                              onClick={() => void handleTogglePlanActive(plan)}
                              aria-label={`${plan.is_active ? 'Deactivate' : 'Activate'} ${plan.title}`}
                              className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:border-[var(--ps-accent)] cursor-pointer"
                            >
                              {plan.is_active ? (
                                <Eye className="h-4 w-4" />
                              ) : (
                                <EyeOff className="h-4 w-4" />
                              )}
                            </button>
                            <button
                              type="button"
                              onClick={() => openEditEditor(plan)}
                              className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 text-xs font-semibold text-[var(--ps-text)] hover:border-[var(--ps-accent)] hover:text-[var(--ps-accent)] cursor-pointer"
                            >
                              <Edit3 className="h-3.5 w-3.5" />
                              <span>Edit</span>
                            </button>
                            <button
                              type="button"
                              aria-label={`Delete ${plan.title}`}
                              disabled={deletingPlanId === plan.id}
                              onClick={() => void handleDeletePlan(plan)}
                              className="inline-flex h-11 w-11 items-center justify-center rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-700 hover:bg-rose-500/20 disabled:opacity-50 dark:text-rose-300 cursor-pointer"
                            >
                              {deletingPlanId === plan.id ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <Trash2 className="h-4 w-4" />
                              )}
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
      )}

      {/* Archived Legacy Plans Drawer (Hidden by Default) */}
      {!isLoading && showArchived && archivedPlans.length > 0 && (
        <div className="rounded-2xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-surface)]/70 p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Archive className="h-4 w-4 text-[var(--ps-text-muted)]" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                Archived / Retired Plans ({archivedPlans.length})
              </h3>
            </div>
            <span className="text-[11px] text-[var(--ps-text-muted)]">
              Hidden from public signups; preserved for historical FK integrity.
            </span>
          </div>
          <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
            {archivedPlans.map((plan) => (
              <div
                key={plan.id}
                className="flex items-center justify-between gap-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-bold text-[var(--ps-text)] truncate">
                      {plan.title}
                    </span>
                    <span className="rounded bg-slate-500/15 px-1.5 py-0.5 text-[10px] font-bold uppercase text-slate-600 dark:text-slate-300">
                      Archived
                    </span>
                  </div>
                  <p className="font-mono text-[11px] text-[var(--ps-text-muted)] truncate">
                    {plan.slug} · ₹{plan.price_inr}/{plan.duration_days}d
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => openEditEditor(plan)}
                  className="inline-flex min-h-[40px] shrink-0 items-center gap-1 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 text-xs font-semibold text-[var(--ps-text)] hover:border-[var(--ps-accent)] cursor-pointer"
                >
                  <Edit3 className="h-3.5 w-3.5" />
                  <span>Inspect</span>
                </button>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sticky Unsaved Order Changes Bar */}
      {pendingOrderDiff.hasChanges && (
        <div
          role="region"
          aria-label="Unsaved subscription plan order changes"
          className="fixed bottom-4 left-4 right-4 z-[80] mx-auto max-w-3xl rounded-2xl border border-[var(--ps-accent)]/45 bg-[var(--ps-surface)]/95 p-3 shadow-2xl backdrop-blur-md sm:px-4"
        >
          <div className="flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-bold text-[var(--ps-text)]">
                Unsaved Plan Order Changes ({pendingOrderDiff.count})
              </p>
              <p className="text-[11px] text-[var(--ps-text-muted)]">
                Save Order to update public subscription card sequencing in
                Supabase.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <button
                type="button"
                onClick={() => setDraftPlans(dbPlans)}
                disabled={savingOrder}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] disabled:opacity-50 cursor-pointer"
              >
                <Undo2 className="h-3.5 w-3.5" />
                <span>Discard</span>
              </button>
              <button
                type="button"
                onClick={() => void handleSavePlanOrder()}
                disabled={savingOrder}
                className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-4 text-xs font-bold text-[var(--ps-accent-fg)] shadow-xs hover:opacity-95 disabled:opacity-50 cursor-pointer"
              >
                {savingOrder ? (
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
    </section>
  );
}
