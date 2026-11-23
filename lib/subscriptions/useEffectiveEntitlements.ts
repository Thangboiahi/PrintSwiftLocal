'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  FEATURE_KEY_ALIASES,
  LIMIT_KEY_ALIASES,
  SUBSCRIPTION_LIMIT_CATALOG,
  type EffectiveEntitlements,
  type SubscriptionFeatureKey,
  type SubscriptionLimitKey,
} from '@/lib/subscriptions/feature-catalog';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';

export interface EntitlementOverridesPayload {
  features?: Partial<Record<SubscriptionFeatureKey, boolean | null>>;
  limits?: Partial<Record<SubscriptionLimitKey, number | null>>;
  reason?: string | null;
  expires_at?: string | null;
}

export interface EffectiveEntitlementsWithOverrides extends EffectiveEntitlements {
  entitlement_overrides?: EntitlementOverridesPayload | null;
}

export interface UseEffectiveEntitlementsResult {
  entitlements: EffectiveEntitlementsWithOverrides | null;
  loading: boolean;
  can: (featureKey: SubscriptionFeatureKey) => boolean;
  limit: (limitKey: SubscriptionLimitKey) => number;
  isOverriddenBySuperAdmin: (
    key: SubscriptionFeatureKey | SubscriptionLimitKey
  ) => 'enabled' | 'disabled' | 'limit' | null;
  hasAnySuperAdminOverride: boolean;
  refresh: () => Promise<void>;
}

function isOverrideExpired(
  overrides: EntitlementOverridesPayload | null | undefined,
  rowExpiresAt?: string | null
): boolean {
  const expStr = rowExpiresAt || overrides?.expires_at || null;
  if (!expStr) return false;
  const ts = Date.parse(expStr);
  return Number.isFinite(ts) && ts <= Date.now();
}

/**
 * Pure precedence resolver:
 * 1. Explicit non-expired Super-Admin override (`true` => Force Enable, `false` => Force Disable)
 *    ALWAYS wins over base subscription plans.
 * 2. Otherwise falls back to active plan entitlements (or super-admin bypass).
 */
export function resolveEffectiveFeature(
  entitlements: EffectiveEntitlementsWithOverrides | null | undefined,
  key: SubscriptionFeatureKey
): boolean {
  if (!entitlements) return false;
  const ov = entitlements.entitlement_overrides;
  if (ov && !isOverrideExpired(ov)) {
    const ovFeat = ov.features?.[key];
    if (typeof ovFeat === 'boolean') return ovFeat;
    const alias = FEATURE_KEY_ALIASES[key];
    if (alias && typeof ov.features?.[alias] === 'boolean') {
      return Boolean(ov.features[alias]);
    }
  }
  if (entitlements.is_super_admin_bypass) return true;
  const direct = entitlements.features?.[key];
  if (typeof direct === 'boolean') return direct;
  const alias = FEATURE_KEY_ALIASES[key];
  if (alias && typeof entitlements.features?.[alias] === 'boolean') {
    return Boolean(entitlements.features[alias]);
  }
  return false;
}

export function resolveEffectiveLimit(
  entitlements: EffectiveEntitlementsWithOverrides | null | undefined,
  key: SubscriptionLimitKey
): number {
  const meta = SUBSCRIPTION_LIMIT_CATALOG.find((item) => item.key === key);
  const alias = LIMIT_KEY_ALIASES[key];
  const aliasMeta = alias
    ? SUBSCRIPTION_LIMIT_CATALOG.find((item) => item.key === alias)
    : undefined;
  const fallback = meta?.defaultValue ?? aliasMeta?.defaultValue ?? 0;
  if (!entitlements) return fallback;

  const ov = entitlements.entitlement_overrides;
  if (ov?.limits && !isOverrideExpired(ov)) {
    if (key in ov.limits) {
      const ovVal = ov.limits[key];
      if (ovVal === null) return -1;
      if (typeof ovVal === 'number' && Number.isFinite(ovVal)) {
        return ovVal < 0 ? -1 : ovVal;
      }
    }
    if (alias && alias in ov.limits) {
      const ovAliasVal = ov.limits[alias];
      if (ovAliasVal === null) return -1;
      if (typeof ovAliasVal === 'number' && Number.isFinite(ovAliasVal)) {
        return ovAliasVal < 0 ? -1 : ovAliasVal;
      }
    }
  }

  if (entitlements.is_super_admin_bypass) return -1;

  const lims = entitlements.limits;
  if (lims && key in lims) {
    const val = lims[key];
    if (val === null) return -1;
    if (typeof val === 'number' && Number.isFinite(val)) {
      return val < 0 ? -1 : val;
    }
  }
  if (lims && alias && alias in lims) {
    const aliasVal = lims[alias];
    if (aliasVal === null) return -1;
    if (typeof aliasVal === 'number' && Number.isFinite(aliasVal)) {
      return aliasVal < 0 ? -1 : aliasVal;
    }
  }
  return fallback;
}

export function useEffectiveEntitlements(
  ownerId: string | null | undefined,
  listingId?: string | null
): UseEffectiveEntitlementsResult {
  const [entitlements, setEntitlements] =
    useState<EffectiveEntitlementsWithOverrides | null>(null);
  const [loading, setLoading] = useState<boolean>(Boolean(ownerId));

  const fetchEntitlements = useCallback(async () => {
    if (!ownerId || !isSupabaseConfigured()) {
      setEntitlements(null);
      setLoading(false);
      return;
    }

    setLoading(true);
    try {
      const [rpcRes, firstSubRes] = await Promise.all([
        supabase.rpc('get_effective_entitlements', {
          p_user_id: ownerId,
          p_listing_id: listingId || null,
        }),
        supabase
          .from('user_subscriptions')
          .select('entitlement_overrides, override_expires_at, status')
          .eq('user_id', ownerId)
          .in('status', ['active', 'trialing', 'paused'])
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      let subOverrideRes = firstSubRes;
      if (subOverrideRes.error) {
        subOverrideRes = (await supabase
          .from('user_subscriptions')
          .select('entitlement_overrides, status')
          .eq('user_id', ownerId)
          .in('status', ['active', 'trialing', 'paused'])
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle()) as typeof firstSubRes;
      }

      const base: EffectiveEntitlementsWithOverrides =
        !rpcRes.error && rpcRes.data && typeof rpcRes.data === 'object'
          ? (rpcRes.data as EffectiveEntitlementsWithOverrides)
          : {
              features: {},
              limits: {},
              active_plan_ids: [],
            };

      const subRow = !subOverrideRes.error
        ? (subOverrideRes.data as Record<string, unknown> | null)
        : null;
      const candidateOverride =
        subRow &&
        typeof subRow.entitlement_overrides === 'object' &&
        subRow.entitlement_overrides !== null
          ? (subRow.entitlement_overrides as EntitlementOverridesPayload)
          : base.entitlement_overrides ?? null;
      const rowExp = subRow?.override_expires_at
        ? String(subRow.override_expires_at)
        : null;

      const rawOverride = isOverrideExpired(candidateOverride, rowExp)
        ? null
        : candidateOverride;

      setEntitlements({
        ...base,
        entitlement_overrides: rawOverride,
      });
    } catch {
      setEntitlements({
        features: {},
        limits: {},
        active_plan_ids: [],
        entitlement_overrides: null,
      });
    } finally {
      setLoading(false);
    }
  }, [ownerId, listingId]);

  useEffect(() => {
    void fetchEntitlements();
  }, [fetchEntitlements]);

  const can = useCallback(
    (featureKey: SubscriptionFeatureKey): boolean =>
      resolveEffectiveFeature(entitlements, featureKey),
    [entitlements]
  );

  const limit = useCallback(
    (limitKey: SubscriptionLimitKey): number =>
      resolveEffectiveLimit(entitlements, limitKey),
    [entitlements]
  );

  const isOverriddenBySuperAdmin = useCallback(
    (
      key: SubscriptionFeatureKey | SubscriptionLimitKey
    ): 'enabled' | 'disabled' | 'limit' | null => {
      const overrides = entitlements?.entitlement_overrides;
      if (!overrides || isOverrideExpired(overrides)) return null;
      const fKey = key as SubscriptionFeatureKey;
      const featVal =
        overrides.features?.[fKey] ??
        (FEATURE_KEY_ALIASES[fKey]
          ? overrides.features?.[FEATURE_KEY_ALIASES[fKey]!]
          : undefined);
      if (featVal === true) return 'enabled';
      if (featVal === false) return 'disabled';
      const lKey = key as SubscriptionLimitKey;
      const lAlias = LIMIT_KEY_ALIASES[lKey];
      if (
        (overrides.limits && lKey in overrides.limits) ||
        (overrides.limits && lAlias && lAlias in overrides.limits)
      ) {
        return 'limit';
      }
      return null;
    },
    [entitlements]
  );

  const hasAnySuperAdminOverride = useMemo(() => {
    const overrides = entitlements?.entitlement_overrides;
    if (!overrides) return false;
    const hasFeat = Object.values(overrides.features || {}).some(
      (v) => typeof v === 'boolean'
    );
    const hasLim = Object.values(overrides.limits || {}).some(
      (v) => typeof v === 'number' && Number.isFinite(v)
    );
    return hasFeat || hasLim;
  }, [entitlements]);

  return {
    entitlements,
    loading,
    can,
    limit,
    isOverriddenBySuperAdmin,
    hasAnySuperAdminOverride,
    refresh: fetchEntitlements,
  };
}

export default useEffectiveEntitlements;
