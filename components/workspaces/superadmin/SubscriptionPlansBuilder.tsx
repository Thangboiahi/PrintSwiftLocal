'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BadgePercent,
  Check,
  Edit3,
  Layers,
  Loader2,
  Plus,
  RefreshCw,
  Save,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import { useConfirmDialog } from '@/components/ui/ConfirmActionModal';
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
  entitlements: PlanEntitlements;
  is_active: boolean;
  sort_order: number;
  updated_at?: string;
  prices: SubscriptionPlanPriceRow[];
}

interface CategoryOption {
  id: string;
  slug: string;
  display_name: string;
  parent_id: string | null;
  level: number;
}

interface PlanDraft {
  id: string | null;
  title: string;
  slug: string;
  info: string;
  is_active: boolean;
  sort_order: number;
  applicable_roles: string[];
  applicable_categories: string[];
  applicable_subcategories: string[];
  entitlements: PlanEntitlements;
  prices: SubscriptionPlanPriceRow[];
}

interface SubscriptionPlansBuilderProps {
  onNotice?: (notice: {
    type: 'success' | 'error' | 'info';
    text: string;
  }) => void;
}

function slugifyTitle(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function createEmptyDraft(nextOrder: number): PlanDraft {
  return {
    id: null,
    title: '',
    slug: '',
    info: '',
    is_active: true,
    sort_order: nextOrder,
    applicable_roles: ['owner'],
    applicable_categories: ['*'],
    applicable_subcategories: ['*'],
    entitlements: {
      ...FREE_BASELINE_ENTITLEMENTS,
      allowed_listing_types: ['general', 'shop_catalogue', 'print_digital'],
      max_listings: 3,
      max_marketplace_items: 15,
      online_payment: { enabled: true, limit: null },
      bulletins: { enabled: true, limit: 5 },
    },
    prices: [
      {
        localKey: `new-${Date.now()}-1`,
        duration_label: 'Monthly',
        duration_days: 30,
        price_inr: 299,
        compare_at_inr: 399,
        is_default: true,
        is_active: true,
        sort_order: 0,
      },
      {
        localKey: `new-${Date.now()}-2`,
        duration_label: 'Annual',
        duration_days: 365,
        price_inr: 2999,
        compare_at_inr: 3588,
        is_default: false,
        is_active: true,
        sort_order: 1,
      },
    ],
  };
}

export function SubscriptionPlansBuilder({
  onNotice,
}: SubscriptionPlansBuilderProps) {
  const { confirm, dialog } = useConfirmDialog();

  const [plans, setPlans] = useState<SubscriptionPlanRecord[]>([]);
  const [categories, setCategories] = useState<CategoryOption[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [editorDraft, setEditorDraft] = useState<PlanDraft | null>(null);
  const [removedPriceIds, setRemovedPriceIds] = useState<string[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [deletingPlanId, setDeletingPlanId] = useState<string | null>(null);

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
          .select('id, slug, display_name, parent_id, level')
          .eq('is_active', true)
          .order('level', { ascending: true })
          .order('display_name', { ascending: true }),
      ]);

      if (plansRes.error) {
        throw new Error(plansRes.error.message);
      }

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
          sort_order: 0,
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
          entitlements: normalizePlanEntitlements(row.entitlements),
          is_active: row.is_active !== false,
          sort_order: Number(row.sort_order ?? row.display_order ?? 0),
          updated_at:
            typeof row.updated_at === 'string' ? row.updated_at : undefined,
          prices: existingPrices.length > 0 ? existingPrices : [fallbackPrice],
        };
      });

      setPlans(normalizedPlans);
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
    () => categories.filter((c) => !c.parent_id || c.level === 0),
    [categories]
  );

  const subCategories = useMemo(
    () => categories.filter((c) => Boolean(c.parent_id) && c.level >= 1),
    [categories]
  );

  const openCreateEditor = () => {
    setRemovedPriceIds([]);
    setEditorDraft(createEmptyDraft((plans.length + 1) * 10));
  };

  const openEditEditor = (plan: SubscriptionPlanRecord) => {
    setRemovedPriceIds([]);
    setEditorDraft({
      id: plan.id,
      title: plan.title,
      slug: plan.slug,
      info: plan.info,
      is_active: plan.is_active,
      sort_order: plan.sort_order,
      applicable_roles: [...plan.applicable_roles],
      applicable_categories: [...plan.applicable_categories],
      applicable_subcategories: [...plan.applicable_subcategories],
      entitlements: normalizePlanEntitlements(plan.entitlements),
      prices: plan.prices.map((p, idx) => ({
        ...p,
        localKey: p.id || `price-${idx}-${Date.now()}`,
      })),
    });
  };

  const toggleArraySelection = (
    list: string[],
    value: string,
    hasWildcard: boolean
  ): string[] => {
    if (hasWildcard && value === '*') {
      return ['*'];
    }
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
    if (!editorDraft) return;
    const current = editorDraft.entitlements.allowed_listing_types;
    const exists = current.includes(vertical);
    const next = exists
      ? current.filter((v) => v !== vertical)
      : [...current, vertical];
    setEditorDraft({
      ...editorDraft,
      entitlements: {
        ...editorDraft.entitlements,
        allowed_listing_types: next.length > 0 ? next : ['general'],
      },
    });
  };

  const updateFeatureEntitlement = (
    key: EntitlementFeatureKey,
    patch: Partial<{ enabled: boolean; limit: number | null }>
  ) => {
    if (!editorDraft) return;
    setEditorDraft({
      ...editorDraft,
      entitlements: {
        ...editorDraft.entitlements,
        [key]: {
          ...editorDraft.entitlements[key],
          ...patch,
        },
      },
    });
  };

  const handleAddPriceRow = () => {
    if (!editorDraft) return;
    const nextRow: SubscriptionPlanPriceRow = {
      localKey: `new-${Date.now()}-${editorDraft.prices.length}`,
      duration_label: 'Quarterly',
      duration_days: 90,
      price_inr: 799,
      compare_at_inr: null,
      is_default: editorDraft.prices.length === 0,
      is_active: true,
      sort_order: editorDraft.prices.length,
    };
    setEditorDraft({
      ...editorDraft,
      prices: [...editorDraft.prices, nextRow],
    });
  };

  const handleUpdatePriceRow = (
    localKey: string,
    patch: Partial<SubscriptionPlanPriceRow>
  ) => {
    if (!editorDraft) return;
    setEditorDraft({
      ...editorDraft,
      prices: editorDraft.prices.map((row) => {
        if (patch.is_default === true) {
          return row.localKey === localKey
            ? { ...row, ...patch, is_default: true }
            : { ...row, is_default: false };
        }
        return row.localKey === localKey ? { ...row, ...patch } : row;
      }),
    });
  };

  const handleRemovePriceRow = (row: SubscriptionPlanPriceRow) => {
    if (!editorDraft) return;
    if (editorDraft.prices.length <= 1) {
      onNotice?.({
        type: 'info',
        text: 'Each plan must keep at least one duration price row.',
      });
      return;
    }
    if (row.id) {
      setRemovedPriceIds((prev) => [...prev, row.id!]);
    }
    const remaining = editorDraft.prices.filter(
      (r) => r.localKey !== row.localKey
    );
    if (!remaining.some((r) => r.is_default) && remaining.length > 0) {
      remaining[0] = { ...remaining[0], is_default: true };
    }
    setEditorDraft({ ...editorDraft, prices: remaining });
  };

  const handleSavePlan = async () => {
    if (!editorDraft) return;
    const cleanTitle = editorDraft.title.trim();
    if (!cleanTitle) {
      onNotice?.({ type: 'error', text: 'Plan title is required.' });
      return;
    }
    if (editorDraft.prices.length === 0) {
      onNotice?.({
        type: 'error',
        text: 'Add at least one duration price row before saving.',
      });
      return;
    }

    const cleanSlug =
      slugifyTitle(editorDraft.slug || cleanTitle) ||
      `plan-${Date.now().toString(36)}`;
    const defaultPrice =
      editorDraft.prices.find((p) => p.is_default) || editorDraft.prices[0];
    const normalizedEnt = normalizePlanEntitlements(editorDraft.entitlements);

    setIsSaving(true);
    try {
      const planPayload = {
        slug: cleanSlug,
        name: cleanTitle,
        title: cleanTitle,
        info: editorDraft.info.trim(),
        tagline: editorDraft.info.trim(),
        price_inr: Math.max(0, Number(defaultPrice.price_inr || 0)),
        original_price_inr: defaultPrice.compare_at_inr,
        duration_days: Math.max(1, Number(defaultPrice.duration_days || 30)),
        max_active_bulletins: normalizedEnt.bulletins.enabled
          ? normalizedEnt.bulletins.limit ?? 50
          : 0,
        applicable_roles:
          editorDraft.applicable_roles.length > 0
            ? editorDraft.applicable_roles
            : ['owner'],
        applicable_categories:
          editorDraft.applicable_categories.length > 0
            ? editorDraft.applicable_categories
            : ['*'],
        applicable_subcategories:
          editorDraft.applicable_subcategories.length > 0
            ? editorDraft.applicable_subcategories
            : ['*'],
        entitlements: normalizedEnt,
        is_active: editorDraft.is_active,
        sort_order: Number(editorDraft.sort_order || 0),
        display_order: Number(editorDraft.sort_order || 0),
      };

      let savedPlanId = editorDraft.id;
      if (savedPlanId) {
        const { error: updErr } = await supabase
          .from('subscription_plans')
          .update(planPayload)
          .eq('id', savedPlanId);
        if (updErr) throw new Error(updErr.message);
      } else {
        const { data: insData, error: insErr } = await supabase
          .from('subscription_plans')
          .insert(planPayload)
          .select('id')
          .single();
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

      for (let idx = 0; idx < editorDraft.prices.length; idx += 1) {
        const row = editorDraft.prices[idx];
        const pricePayload = {
          plan_id: savedPlanId,
          duration_label: row.duration_label.trim() || `${row.duration_days} Days`,
          duration_days: Math.max(1, Math.floor(Number(row.duration_days || 30))),
          price_inr: Math.max(0, Number(row.price_inr || 0)),
          compare_at_inr:
            row.compare_at_inr !== null && Number(row.compare_at_inr) > 0
              ? Number(row.compare_at_inr)
              : null,
          is_default: Boolean(row.is_default),
          is_active: row.is_active !== false,
          sort_order: idx,
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
        text: `Saved subscription plan "${cleanTitle}" (${editorDraft.prices.length} duration tier${editorDraft.prices.length === 1 ? '' : 's'}) and logged to audit trail.`,
      });
      setEditorDraft(null);
      setRemovedPriceIds([]);
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

  const handleDeletePlan = async (plan: SubscriptionPlanRecord) => {
    const ok = await confirm({
      title: `Delete "${plan.title}"?`,
      description:
        'Deleting this plan removes its duration pricing rows permanently. Existing active user subscriptions keep their entitlements_snapshot, but new checkouts will no longer see this plan.',
      confirmLabel: 'Delete Plan',
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
            : 'Could not delete plan (check active FK references).',
      });
    } finally {
      setDeletingPlanId(null);
    }
  };

  return (
    <section
      data-testid="superadmin-subscription-plans-builder"
      className="space-y-4"
    >
      {/* Header Bar */}
      <div className="flex flex-col gap-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <BadgePercent className="h-4 w-4 text-[var(--ps-accent)] shrink-0" />
            <h2 className="text-sm font-bold text-[var(--ps-text)]">
              Composable Subscription Plans &amp; Multi-Duration Pricing
            </h2>
          </div>
          <p className="mt-1 text-xs text-[var(--ps-text-muted)]">
            Configure plan scope (roles, categories, sub-categories), feature &amp; numeric limit matrices, and multiple duration price tiers. Existing Bulletin plans stay synced with <code className="font-mono">/bulletin?plans=1</code>.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => void loadData()}
            disabled={isLoading}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] disabled:opacity-50 cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
          <button
            type="button"
            data-testid="create-subscription-plan-btn"
            onClick={openCreateEditor}
            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-4 text-xs font-semibold text-[var(--ps-accent-fg)] hover:opacity-95 cursor-pointer"
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

      {/* Plan Editor Workbench */}
      {editorDraft && (
        <div
          data-testid="subscription-plan-editor-form"
          className="rounded-2xl border-2 border-[var(--ps-accent)]/40 bg-[var(--ps-surface)] p-4 sm:p-5 space-y-5"
        >
          <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ps-border)] pb-3">
            <div>
              <h3 className="text-sm font-bold text-[var(--ps-text)]">
                {editorDraft.id ? `Edit Plan: ${editorDraft.title}` : 'Create New Subscription Plan'}
              </h3>
              <p className="text-[11px] text-[var(--ps-text-muted)]">
                Writes to <code className="font-mono">subscription_plans</code> &amp; <code className="font-mono">subscription_plan_prices</code> (super_admin RLS + audit log).
              </p>
            </div>
            <button
              type="button"
              onClick={() => setEditorDraft(null)}
              className="inline-flex min-h-[40px] items-center gap-1 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs font-semibold text-[var(--ps-text-muted)] hover:text-[var(--ps-text)] cursor-pointer"
            >
              <X className="h-3.5 w-3.5" />
              <span>Close</span>
            </button>
          </div>

          {/* 1. Core Identity */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="sm:col-span-2">
              <label className="block text-[11px] font-bold text-[var(--ps-text)] mb-1">
                Plan Title *
              </label>
              <input
                type="text"
                value={editorDraft.title}
                onChange={(e) => {
                  const nextTitle = e.target.value;
                  setEditorDraft({
                    ...editorDraft,
                    title: nextTitle,
                    slug: editorDraft.id
                      ? editorDraft.slug
                      : slugifyTitle(nextTitle),
                  });
                }}
                placeholder="e.g., Business Pro Plus"
                className="w-full min-h-[44px] rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)]"
              />
            </div>
            <div>
              <label className="block text-[11px] font-bold text-[var(--ps-text)] mb-1">
                Slug
              </label>
              <input
                type="text"
                value={editorDraft.slug}
                onChange={(e) =>
                  setEditorDraft({ ...editorDraft, slug: e.target.value })
                }
                placeholder="business-pro-plus"
                className="w-full min-h-[44px] rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 font-mono text-xs text-[var(--ps-text)]"
              />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[11px] font-bold text-[var(--ps-text)] mb-1">
                  Sort Order
                </label>
                <input
                  type="number"
                  value={editorDraft.sort_order}
                  onChange={(e) =>
                    setEditorDraft({
                      ...editorDraft,
                      sort_order: parseInt(e.target.value, 10) || 0,
                    })
                  }
                  className="w-full min-h-[44px] rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 font-mono text-xs tabular-nums text-[var(--ps-text)]"
                />
              </div>
              <div className="flex flex-col justify-end">
                <label className="inline-flex min-h-[44px] cursor-pointer items-center justify-center gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-xs font-semibold text-[var(--ps-text)]">
                  <input
                    type="checkbox"
                    checked={editorDraft.is_active}
                    onChange={(e) =>
                      setEditorDraft({
                        ...editorDraft,
                        is_active: e.target.checked,
                      })
                    }
                    className="h-4 w-4 accent-[var(--ps-accent)]"
                  />
                  <span>Active</span>
                </label>
              </div>
            </div>
          </div>

          <div>
            <label className="block text-[11px] font-bold text-[var(--ps-text)] mb-1">
              Plan Info / Summary
            </label>
            <textarea
              rows={2}
              value={editorDraft.info}
              onChange={(e) =>
                setEditorDraft({ ...editorDraft, info: e.target.value })
              }
              placeholder="Concise description shown on plan selection cards and checkout."
              className="w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 text-xs text-[var(--ps-text)]"
            />
          </div>

          {/* 2. Target Scope: Roles, Categories, Sub-Categories */}
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3.5 space-y-2">
              <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                Applicable Roles
              </div>
              <div className="flex flex-wrap gap-1.5">
                {SUBSCRIPTION_ROLE_OPTIONS.map((roleOpt) => {
                  const selected = editorDraft.applicable_roles.includes(
                    roleOpt.id
                  );
                  return (
                    <button
                      key={roleOpt.id}
                      type="button"
                      onClick={() =>
                        setEditorDraft({
                          ...editorDraft,
                          applicable_roles: toggleArraySelection(
                            editorDraft.applicable_roles,
                            roleOpt.id,
                            false
                          ),
                        })
                      }
                      className={`inline-flex min-h-[36px] items-center gap-1 rounded-lg border px-2.5 text-[11px] font-semibold transition cursor-pointer ${
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

            <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3.5 space-y-2">
              <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                Applicable Categories
              </div>
              <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto">
                <button
                  type="button"
                  onClick={() =>
                    setEditorDraft({
                      ...editorDraft,
                      applicable_categories: ['*'],
                    })
                  }
                  className={`inline-flex min-h-[34px] items-center gap-1 rounded-lg border px-2.5 text-[11px] font-semibold cursor-pointer ${
                    editorDraft.applicable_categories.includes('*')
                      ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                      : 'border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)]'
                  }`}
                >
                  All (*)
                </button>
                {rootCategories.map((cat) => {
                  const selected = editorDraft.applicable_categories.includes(
                    cat.slug
                  );
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() =>
                        setEditorDraft({
                          ...editorDraft,
                          applicable_categories: toggleArraySelection(
                            editorDraft.applicable_categories,
                            cat.slug,
                            true
                          ),
                        })
                      }
                      className={`inline-flex min-h-[34px] items-center gap-1 rounded-lg border px-2.5 text-[11px] font-semibold cursor-pointer ${
                        selected
                          ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                          : 'border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)]'
                      }`}
                    >
                      {cat.display_name}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3.5 space-y-2">
              <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                Applicable Sub-Categories
              </div>
              <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto">
                <button
                  type="button"
                  onClick={() =>
                    setEditorDraft({
                      ...editorDraft,
                      applicable_subcategories: ['*'],
                    })
                  }
                  className={`inline-flex min-h-[34px] items-center gap-1 rounded-lg border px-2.5 text-[11px] font-semibold cursor-pointer ${
                    editorDraft.applicable_subcategories.includes('*')
                      ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                      : 'border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)]'
                  }`}
                >
                  All (*)
                </button>
                {subCategories.slice(0, 40).map((sub) => {
                  const selected =
                    editorDraft.applicable_subcategories.includes(sub.slug);
                  return (
                    <button
                      key={sub.id}
                      type="button"
                      onClick={() =>
                        setEditorDraft({
                          ...editorDraft,
                          applicable_subcategories: toggleArraySelection(
                            editorDraft.applicable_subcategories,
                            sub.slug,
                            true
                          ),
                        })
                      }
                      className={`inline-flex min-h-[34px] items-center gap-1 rounded-lg border px-2.5 text-[11px] font-semibold cursor-pointer ${
                        selected
                          ? 'border-[var(--ps-accent)] bg-[var(--ps-accent)] text-[var(--ps-accent-fg)]'
                          : 'border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)]'
                      }`}
                    >
                      {sub.display_name}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>

          {/* 3. Multi-Duration Pricing Rows */}
          <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="text-xs font-bold text-[var(--ps-text)]">
                  Multi-Duration Pricing Tiers (`subscription_plan_prices`)
                </h4>
                <p className="text-[11px] text-[var(--ps-text-muted)]">
                  The Default row syncs to the primary <code className="font-mono">price_inr</code> / <code className="font-mono">duration_days</code> shown in legacy views.
                </p>
              </div>
              <button
                type="button"
                onClick={handleAddPriceRow}
                className="inline-flex min-h-[40px] items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] cursor-pointer"
              >
                <Plus className="h-3.5 w-3.5" />
                <span>Add Duration</span>
              </button>
            </div>

            <div className="space-y-2.5">
              {editorDraft.prices.map((row) => (
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
                      placeholder="Monthly"
                      className="mt-1 w-full min-h-[40px] rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-xs text-[var(--ps-text)]"
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
                      className="mt-1 w-full min-h-[40px] rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 font-mono text-xs tabular-nums text-[var(--ps-text)]"
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
                          price_inr: Math.max(
                            0,
                            parseFloat(e.target.value) || 0
                          ),
                        })
                      }
                      className="mt-1 w-full min-h-[40px] rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 font-mono text-xs tabular-nums text-[var(--ps-text)]"
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
                      className="mt-1 w-full min-h-[40px] rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 font-mono text-xs tabular-nums text-[var(--ps-text)]"
                    />
                  </div>
                  <div className="flex items-center justify-between gap-2 sm:col-span-3">
                    <button
                      type="button"
                      onClick={() =>
                        handleUpdatePriceRow(row.localKey, { is_default: true })
                      }
                      className={`inline-flex min-h-[40px] flex-1 items-center justify-center gap-1 rounded-lg border px-2 text-[11px] font-semibold cursor-pointer ${
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
                      className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-700 hover:bg-rose-500/20 dark:text-rose-300 cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* 4. Entitlements & Feature Matrix */}
          <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-4 space-y-4">
            <div className="flex items-center gap-2">
              <Layers className="h-4 w-4 text-[var(--ps-accent)]" />
              <h4 className="text-xs font-bold text-[var(--ps-text)]">
                Entitlements &amp; Feature Limits Matrix
              </h4>
            </div>

            {/* Allowed Listing Types */}
            <div className="space-y-1.5">
              <div className="text-[11px] font-semibold text-[var(--ps-text-muted)]">
                Allowed Listing Verticals
              </div>
              <div className="flex flex-wrap gap-1.5">
                {LISTING_VERTICALS.map((verticalId) => {
                  const checked =
                    editorDraft.entitlements.allowed_listing_types.includes(
                      verticalId
                    );
                  return (
                    <button
                      key={verticalId}
                      type="button"
                      onClick={() => toggleListingType(verticalId)}
                      className={`inline-flex min-h-[36px] items-center gap-1 rounded-lg border px-2.5 text-[11px] font-semibold cursor-pointer ${
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

            {/* Core Quotas: max_listings & max_marketplace_items */}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {(
                [
                  {
                    key: 'max_listings',
                    label: 'Max Directory Listings',
                  },
                  {
                    key: 'max_marketplace_items',
                    label: 'Max Marketplace Items',
                  },
                ] as const
              ).map((q) => {
                const val = editorDraft.entitlements[q.key];
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
                      <label className="inline-flex items-center gap-1.5 text-[11px] text-[var(--ps-text-muted)] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={isUnlimited}
                          onChange={(e) =>
                            setEditorDraft({
                              ...editorDraft,
                              entitlements: {
                                ...editorDraft.entitlements,
                                [q.key]: e.target.checked ? null : 5,
                              },
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
                          value={val ?? 0}
                          onChange={(e) =>
                            setEditorDraft({
                              ...editorDraft,
                              entitlements: {
                                ...editorDraft.entitlements,
                                [q.key]: Math.max(
                                  0,
                                  parseInt(e.target.value, 10) || 0
                                ),
                              },
                            })
                          }
                          className="w-20 min-h-[38px] rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 font-mono text-xs tabular-nums text-[var(--ps-text)]"
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>

            {/* Granular Feature Toggles & Numeric Limits */}
            <div className="grid grid-cols-1 gap-2.5 md:grid-cols-2">
              {ENTITLEMENT_FEATURE_META.map((meta) => {
                const current = editorDraft.entitlements[meta.key];
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
                      <label className="inline-flex min-h-[36px] shrink-0 cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 text-[11px] font-semibold">
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
                              className="h-3.5 w-3.5 accent-[var(--ps-accent)]"
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
                              className="w-20 min-h-[34px] rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 font-mono text-xs tabular-nums text-[var(--ps-text)]"
                            />
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--ps-border)] pt-3">
            <button
              type="button"
              onClick={() => setEditorDraft(null)}
              className="inline-flex min-h-[44px] items-center rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-4 text-xs font-semibold text-[var(--ps-text)] cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              data-testid="save-subscription-plan-btn"
              disabled={isSaving}
              onClick={() => void handleSavePlan()}
              className="inline-flex min-h-[44px] items-center gap-2 rounded-xl bg-[var(--ps-accent)] px-5 text-xs font-semibold text-[var(--ps-accent-fg)] hover:opacity-95 disabled:opacity-50 cursor-pointer"
            >
              {isSaving ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Save className="h-4 w-4" />
              )}
              <span>{editorDraft.id ? 'Save Plan Changes' : 'Create Plan'}</span>
            </button>
          </div>
        </div>
      )}

      {/* Existing Plans Grid */}
      {isLoading ? (
        <div className="flex items-center justify-center gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-10 text-xs text-[var(--ps-text-muted)]">
          <Loader2 className="h-4 w-4 animate-spin" />
          <span>Loading subscription plans &amp; pricing tiers…</span>
        </div>
      ) : plans.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-surface)] p-8 text-center text-xs text-[var(--ps-text-muted)]">
          No subscription plans found yet. Click <strong>New Plan</strong> to create one.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {plans.map((plan) => {
            const enabledFeatures = ENTITLEMENT_FEATURE_META.filter(
              (m) => plan.entitlements[m.key]?.enabled
            );
            return (
              <div
                key={plan.id}
                data-testid={`plan-card-${plan.slug || plan.id}`}
                className="flex flex-col justify-between gap-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4"
              >
                <div className="space-y-2.5">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-1.5">
                        <h3 className="text-sm font-bold text-[var(--ps-text)]">
                          {plan.title}
                        </h3>
                        <span
                          className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${
                            plan.is_active
                              ? 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300'
                              : 'bg-slate-500/15 text-slate-600 dark:text-slate-300'
                          }`}
                        >
                          {plan.is_active ? 'Active' : 'Inactive'}
                        </span>
                      </div>
                      <div className="mt-0.5 font-mono text-[11px] text-[var(--ps-text-muted)]">
                        {plan.slug} · sort #{plan.sort_order}
                      </div>
                    </div>

                    <div className="flex items-center gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => openEditEditor(plan)}
                        className="inline-flex min-h-[40px] items-center gap-1 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] cursor-pointer"
                      >
                        <Edit3 className="h-3.5 w-3.5" />
                        <span>Edit</span>
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${plan.title}`}
                        disabled={deletingPlanId === plan.id}
                        onClick={() => void handleDeletePlan(plan)}
                        className="inline-flex min-h-[40px] min-w-[40px] items-center justify-center rounded-xl border border-rose-500/30 bg-rose-500/10 text-rose-700 hover:bg-rose-500/20 disabled:opacity-50 dark:text-rose-300 cursor-pointer"
                      >
                        {deletingPlanId === plan.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )}
                      </button>
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
                    <span className="rounded border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-0.5 font-semibold">
                      Roles: {plan.applicable_roles.join(', ') || 'all'}
                    </span>
                    <span className="rounded border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-0.5 font-semibold">
                      Listings:{' '}
                      {plan.entitlements.max_listings === null
                        ? '∞'
                        : plan.entitlements.max_listings}
                    </span>
                    <span className="rounded border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-0.5 font-semibold">
                      UPI:{' '}
                      {plan.entitlements.online_payment.enabled
                        ? 'Allowed'
                        : 'Blocked'}
                    </span>
                    <span className="rounded border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-0.5 font-semibold">
                      {enabledFeatures.length} features enabled
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {dialog}
    </section>
  );
}
