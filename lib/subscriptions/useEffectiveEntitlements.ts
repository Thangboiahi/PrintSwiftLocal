'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  SUBSCRIPTION_LIMIT_CATALOG,
  type EffectiveEntitlements,
  type SubscriptionFeatureKey,
  type SubscriptionLimitKey,
} from '@/lib/subscriptions/feature-catalog';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';

export interface EntitlementOverridesPayload {
  features?: Partial<Record<SubscriptionFeatureKey, boolean | null>>;
  limits?: Partial<Record<SubscriptionLimitKey, number | null>>;
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

/**
 * Pure precedence resolver:
 * 1. Explicit Super-Admin override (`true` => Force Enable, `false` => Force Disable)
 *    ALWAYS wins over base subscription plans.
 * 2. Otherwise falls back to active plan entitlements (or super-admin bypass).
 */
export function resolveEffectiveFeature(
  entitlements: EffectiveEntitlementsWithOverrides | null | undefined,
  key: SubscriptionFeatureKey
): boolean {
  if (!entitlements) return false;
  const overrideVal = entitlements.entitlement_overrides?.features?.[key];
  if (typeof overrideVal === 'boolean') {
    return overrideVal;
  }
  if (entitlements.is_super_admin_bypass) return true;
  return entitlements.features?.[key] === true;
}

export function resolveEffectiveLimit(
  entitlements: EffectiveEntitlementsWithOverrides | null | undefined,
  key: SubscriptionLimitKey
): number {
  const meta = SUBSCRIPTION_LIMIT_CATALOG.find((item) => item.key === key);
  const fallback = meta ? meta.defaultValue : 0;
  if (!entitlements) return fallback;
  const overrideVal = entitlements.entitlement_overrides?.limits?.[key];
  if (typeof overrideVal === 'number' && Number.isFinite(overrideVal)) {
    return overrideVal;
  }
  if (entitlements.is_super_admin_bypass) return -1;
  const val = entitlements.limits?.[key];
  return typeof val === 'number' && Number.isFinite(val) ? val : fallback;
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
      const [rpcRes, subOverrideRes] = await Promise.all([
        supabase.rpc('get_effective_entitlements', {
          p_user_id: ownerId,
          p_listing_id: listingId || null,
        }),
        supabase
          .from('user_subscriptions')
          .select('entitlement_overrides, status')
          .eq('user_id', ownerId)
          .in('status', ['active', 'trialing', 'paused'])
          .order('updated_at', { ascending: false })
          .limit(1)
          .maybeSingle(),
      ]);

      const base: EffectiveEntitlementsWithOverrides =
        !rpcRes.error && rpcRes.data && typeof rpcRes.data === 'object'
          ? (rpcRes.data as EffectiveEntitlementsWithOverrides)
          : {
              features: {},
              limits: {},
              active_plan_ids: [],
            };

      const rawOverride =
        !subOverrideRes.error &&
        subOverrideRes.data &&
        typeof (subOverrideRes.data as Record<string, unknown>)
          .entitlement_overrides === 'object'
          ? ((subOverrideRes.data as Record<string, unknown>)
              .entitlement_overrides as EntitlementOverridesPayload | null)
          : base.entitlement_overrides ?? null;

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
      if (!overrides) return null;
      const featVal =
        overrides.features?.[key as SubscriptionFeatureKey];
      if (featVal === true) return 'enabled';
      if (featVal === false) return 'disabled';
      const limVal = overrides.limits?.[key as SubscriptionLimitKey];
      if (typeof limVal === 'number' && Number.isFinite(limVal)) {
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
