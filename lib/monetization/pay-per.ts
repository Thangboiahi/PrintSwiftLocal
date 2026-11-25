'use client';

import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';
import {
  fetchEffectiveEntitlements,
  type EffectiveEntitlementsSnapshot,
} from '@/lib/subscriptions/entitlements';

export type PayPerModuleKey =
  | 'marketplace_item'
  | 'bulletin_post'
  | 'real_estate_sale'
  | 'real_estate_rent';

export type PayPerTargetTable =
  | 'marketplace_products'
  | 'marketplace_items'
  | 'bulletins'
  | 'listings';

export type PayPerAreaUnit = 'sqft' | 'sqm' | 'acre' | 'sangam';

export interface PayPerDurationSlab {
  id: string;
  label: string;
  days: number;
  price_inr: number;
  is_popular?: boolean;
}

export interface PayPerAddon {
  id: string;
  label: string;
  price_inr: number;
  description?: string;
}

export interface PayPerPriceBand {
  id: string;
  label: string;
  min_price_inr: number;
  max_price_inr: number | null;
  fee_inr: number;
}

export interface PayPerAreaBandSqft {
  id: string;
  label: string;
  min_sqft: number;
  max_sqft: number | null;
  fee_inr: number;
}

export interface PayPerPricingConfig {
  module_key: PayPerModuleKey;
  label: string;
  is_enabled: boolean;
  duration_slabs: PayPerDurationSlab[];
  addons: PayPerAddon[];
  price_bands: PayPerPriceBand[];
  area_bands_sqft: PayPerAreaBandSqft[];
  min_cap_inr: number;
  max_cap_inr: number | null;
  updated_at?: string;
}

export interface PayPerSelectedAddonSummary {
  id: string;
  label: string;
  price_inr: number;
}

export interface PayPerQuoteBreakdown {
  module_key: PayPerModuleKey;
  is_enabled: boolean;
  duration_days: number;
  duration_slab_id: string | null;
  duration_slab_label: string;
  base_slab_inr: number;
  property_price_inr: number;
  price_band_label: string | null;
  price_band_inr: number;
  input_area_value: number;
  input_area_unit: PayPerAreaUnit;
  normalized_area_sqft: number;
  area_band_label: string | null;
  area_band_inr: number;
  selected_addons: PayPerSelectedAddonSummary[];
  addons_inr: number;
  raw_subtotal_inr: number;
  min_cap_inr: number;
  max_cap_inr: number | null;
  total_inr: number;
}

export type PayPerOrderStatus =
  | 'pending_verification'
  | 'paid'
  | 'rejected'
  | 'expired';

export interface PayPerOrderRow {
  id: string;
  user_id: string;
  module_key: PayPerModuleKey;
  target_table: PayPerTargetTable;
  target_id: string;
  duration_days: number;
  quote_breakdown: PayPerQuoteBreakdown | Record<string, unknown>;
  amount_inr: number;
  payment_method: 'upi' | 'manual';
  upi_utr_ref: string | null;
  status: PayPerOrderStatus;
  rejection_reason: string | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  starts_at: string | null;
  ends_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface OwnerQuotaEvaluation {
  moduleKey: PayPerModuleKey;
  planName: string;
  isDefaultFree: boolean;
  isSuperAdminBypass: boolean;
  featureEnabled: boolean;
  usedCount: number;
  maxLimit: number | null; // null = Unlimited
  remainingCount: number | null; // null = Unlimited
  hasRemainingQuota: boolean;
  entitlements: EffectiveEntitlementsSnapshot;
}

/**
 * Manipur / Churachandpur Land Area Conversion Constants:
 * - 1 sq.m (sqm)   = 10.7639104 sq.ft
 * - 1 acre         = 43,560 sq.ft
 * - 1 sangam       = 0.625 acre = 27,225 sq.ft
 */
export const SQFT_PER_SQM = 10.7639104;
export const SQFT_PER_ACRE = 43560;
export const SQFT_PER_SANGAM = 27225;

export const PAY_PER_AREA_UNIT_LABELS: Record<PayPerAreaUnit, string> = {
  sqft: 'sq.ft (Square Feet)',
  sqm: 'sq.m (Square Metres)',
  sangam: 'Sangam (0.625 Acre · 27,225 sq.ft)',
  acre: 'Acre (43,560 sq.ft)',
};

export const PAY_PER_MODULE_LABELS: Record<PayPerModuleKey, string> = {
  marketplace_item: 'Marketplace Product',
  bulletin_post: 'Community Bulletin Notice',
  real_estate_sale: 'Real Estate (For Sale)',
  real_estate_rent: 'Real Estate (For Rent / Lease)',
};

export function convertAreaToSqft(
  value: number | null | undefined,
  unit: PayPerAreaUnit = 'sqft'
): number {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;

  switch (unit) {
    case 'sqm':
      return Math.round(numeric * SQFT_PER_SQM * 100) / 100;
    case 'acre':
      return Math.round(numeric * SQFT_PER_ACRE * 100) / 100;
    case 'sangam':
      return Math.round(numeric * SQFT_PER_SANGAM * 100) / 100;
    case 'sqft':
    default:
      return Math.round(numeric * 100) / 100;
  }
}

export function convertSqftToUnit(
  sqft: number | null | undefined,
  unit: PayPerAreaUnit
): number {
  const numeric = Number(sqft);
  if (!Number.isFinite(numeric) || numeric <= 0) return 0;

  switch (unit) {
    case 'sqm':
      return Math.round((numeric / SQFT_PER_SQM) * 100) / 100;
    case 'acre':
      return Math.round((numeric / SQFT_PER_ACRE) * 1000) / 1000;
    case 'sangam':
      return Math.round((numeric / SQFT_PER_SANGAM) * 1000) / 1000;
    case 'sqft':
    default:
      return Math.round(numeric * 100) / 100;
  }
}

export function formatAreaEquivalentHint(sqft: number): string {
  if (!Number.isFinite(sqft) || sqft <= 0) {
    return '0 sq.ft · 0 Sangam · 0 Acre';
  }
  const sangam = (sqft / SQFT_PER_SANGAM).toFixed(2);
  const acres = (sqft / SQFT_PER_ACRE).toFixed(2);
  const sqm = Math.round(sqft / SQFT_PER_SQM).toLocaleString('en-IN');
  return `${Math.round(sqft).toLocaleString('en-IN')} sq.ft (≈ ${sqm} m² · ${sangam} Sangam · ${acres} Acre)`;
}

export const DEFAULT_PAY_PER_CONFIGS: Record<
  PayPerModuleKey,
  PayPerPricingConfig
> = {
  marketplace_item: {
    module_key: 'marketplace_item',
    label: 'Marketplace Product Listing',
    is_enabled: true,
    duration_slabs: [
      { id: 'mp_7d', label: '7 Days Pass', days: 7, price_inr: 29, is_popular: false },
      { id: 'mp_15d', label: '15 Days Pass', days: 15, price_inr: 49, is_popular: true },
      { id: 'mp_30d', label: '30 Days Pass', days: 30, price_inr: 79, is_popular: false },
      { id: 'mp_60d', label: '60 Days Pass', days: 60, price_inr: 129, is_popular: false },
    ],
    addons: [
      {
        id: 'featured_boost',
        label: 'Featured Marketplace Spotlight',
        price_inr: 49,
        description: 'Priority placement in district Marketplace deals',
      },
    ],
    price_bands: [],
    area_bands_sqft: [],
    min_cap_inr: 29,
    max_cap_inr: 499,
  },
  bulletin_post: {
    module_key: 'bulletin_post',
    label: 'Community Bulletin & Notice Post',
    is_enabled: true,
    duration_slabs: [
      { id: 'bul_3d', label: '3 Days Notice', days: 3, price_inr: 39, is_popular: false },
      { id: 'bul_7d', label: '7 Days Notice', days: 7, price_inr: 69, is_popular: true },
      { id: 'bul_15d', label: '15 Days Campaign', days: 15, price_inr: 119, is_popular: false },
      { id: 'bul_30d', label: '30 Days Campaign', days: 30, price_inr: 199, is_popular: false },
    ],
    addons: [
      {
        id: 'featured_pin',
        label: 'Top Featured Pin',
        price_inr: 59,
        description: 'Pin notice at the top of the Bulletin Board',
      },
      {
        id: 'video_boost',
        label: 'Rich Video / Flyer Highlight',
        price_inr: 39,
        description: 'Enable rich media badge & highlight frame',
      },
    ],
    price_bands: [],
    area_bands_sqft: [],
    min_cap_inr: 39,
    max_cap_inr: 599,
  },
  real_estate_sale: {
    module_key: 'real_estate_sale',
    label: 'Real Estate Property — For Sale',
    is_enabled: true,
    duration_slabs: [
      { id: 'res_15d', label: '15 Days Listing', days: 15, price_inr: 149, is_popular: false },
      { id: 'res_30d', label: '30 Days Listing', days: 30, price_inr: 249, is_popular: true },
      { id: 'res_60d', label: '60 Days Showcase', days: 60, price_inr: 399, is_popular: false },
      { id: 'res_90d', label: '90 Days Season Pass', days: 90, price_inr: 549, is_popular: false },
    ],
    addons: [
      {
        id: 'featured_plot',
        label: 'Featured Property Spotlight',
        price_inr: 149,
        description: 'Top placement in Real Estate discovery & map pins',
      },
    ],
    price_bands: [
      { id: 'sale_p1', label: 'Up to ₹10 Lakh', min_price_inr: 0, max_price_inr: 1000000, fee_inr: 0 },
      { id: 'sale_p2', label: '₹10 Lakh – ₹30 Lakh', min_price_inr: 1000001, max_price_inr: 3000000, fee_inr: 100 },
      { id: 'sale_p3', label: '₹30 Lakh – ₹75 Lakh', min_price_inr: 3000001, max_price_inr: 7500000, fee_inr: 250 },
      { id: 'sale_p4', label: 'Above ₹75 Lakh', min_price_inr: 7500001, max_price_inr: null, fee_inr: 450 },
    ],
    area_bands_sqft: [
      { id: 'sale_a1', label: 'Compact Plot (Up to 2,500 sq.ft)', min_sqft: 0, max_sqft: 2500, fee_inr: 0 },
      { id: 'sale_a2', label: 'Standard Plot (2,501 – 13,612 sq.ft / ~0.5 Sangam)', min_sqft: 2501, max_sqft: 13612, fee_inr: 75 },
      { id: 'sale_a3', label: 'Full Sangam Plot (13,613 – 27,225 sq.ft / 1 Sangam)', min_sqft: 13613, max_sqft: 27225, fee_inr: 150 },
      { id: 'sale_a4', label: 'Large Estate (Above 1 Sangam / 27,225+ sq.ft)', min_sqft: 27226, max_sqft: null, fee_inr: 300 },
    ],
    min_cap_inr: 149,
    max_cap_inr: 1999,
  },
  real_estate_rent: {
    module_key: 'real_estate_rent',
    label: 'Real Estate Property — For Rent / Lease',
    is_enabled: true,
    duration_slabs: [
      { id: 'rer_15d', label: '15 Days Rental Pass', days: 15, price_inr: 79, is_popular: false },
      { id: 'rer_30d', label: '30 Days Rental Pass', days: 30, price_inr: 129, is_popular: true },
      { id: 'rer_60d', label: '60 Days Rental Pass', days: 60, price_inr: 199, is_popular: false },
    ],
    addons: [
      {
        id: 'featured_rental',
        label: 'Featured Rental Highlight',
        price_inr: 79,
        description: 'Priority badge in district rental search',
      },
    ],
    price_bands: [
      { id: 'rent_p1', label: 'Up to ₹5,000 / mo', min_price_inr: 0, max_price_inr: 5000, fee_inr: 0 },
      { id: 'rent_p2', label: '₹5,001 – ₹15,000 / mo', min_price_inr: 5001, max_price_inr: 15000, fee_inr: 50 },
      { id: 'rent_p3', label: '₹15,001 – ₹35,000 / mo', min_price_inr: 15001, max_price_inr: 35000, fee_inr: 120 },
      { id: 'rent_p4', label: 'Above ₹35,000 / mo', min_price_inr: 35001, max_price_inr: null, fee_inr: 250 },
    ],
    area_bands_sqft: [
      { id: 'rent_a1', label: 'Up to 1,200 sq.ft', min_sqft: 0, max_sqft: 1200, fee_inr: 0 },
      { id: 'rent_a2', label: '1,201 – 3,500 sq.ft', min_sqft: 1201, max_sqft: 3500, fee_inr: 40 },
      { id: 'rent_a3', label: 'Above 3,500 sq.ft', min_sqft: 3501, max_sqft: null, fee_inr: 100 },
    ],
    min_cap_inr: 79,
    max_cap_inr: 999,
  },
};

export function normalizePayPerPricingConfig(
  raw: Record<string, unknown>,
  fallbackModuleKey?: PayPerModuleKey
): PayPerPricingConfig {
  const keyRaw = String(raw.module_key || fallbackModuleKey || 'marketplace_item');
  const moduleKey: PayPerModuleKey =
    keyRaw === 'bulletin_post' ||
    keyRaw === 'real_estate_sale' ||
    keyRaw === 'real_estate_rent'
      ? keyRaw
      : 'marketplace_item';
  const fallback = DEFAULT_PAY_PER_CONFIGS[moduleKey];

  const durationSlabs: PayPerDurationSlab[] = Array.isArray(raw.duration_slabs)
    ? raw.duration_slabs
        .map((item, idx): PayPerDurationSlab | null => {
          if (!item || typeof item !== 'object') return null;
          const obj = item as Record<string, unknown>;
          const days = Math.max(1, Math.round(Number(obj.days) || 7));
          const price_inr = Math.max(0, Math.round(Number(obj.price_inr) || 0));
          return {
            id: String(obj.id || `${moduleKey}_${days}d_${idx}`),
            label: String(obj.label || `${days} Days`),
            days,
            price_inr,
            is_popular: Boolean(obj.is_popular),
          };
        })
        .filter((x): x is PayPerDurationSlab => x !== null)
    : fallback.duration_slabs;

  const addons: PayPerAddon[] = Array.isArray(raw.addons)
    ? raw.addons
        .map((item, idx): PayPerAddon | null => {
          if (!item || typeof item !== 'object') return null;
          const obj = item as Record<string, unknown>;
          return {
            id: String(obj.id || `addon_${idx}`),
            label: String(obj.label || 'Add-on'),
            price_inr: Math.max(0, Math.round(Number(obj.price_inr) || 0)),
            description: obj.description ? String(obj.description) : undefined,
          };
        })
        .filter((x): x is PayPerAddon => x !== null)
    : fallback.addons;

  const priceBands: PayPerPriceBand[] = Array.isArray(raw.price_bands)
    ? raw.price_bands
        .map((item, idx) => {
          if (!item || typeof item !== 'object') return null;
          const obj = item as Record<string, unknown>;
          const maxRaw = obj.max_price_inr;
          return {
            id: String(obj.id || `pband_${idx}`),
            label: String(obj.label || `Band ${idx + 1}`),
            min_price_inr: Math.max(0, Math.round(Number(obj.min_price_inr) || 0)),
            max_price_inr:
              maxRaw === null || maxRaw === undefined || maxRaw === ''
                ? null
                : Math.max(0, Math.round(Number(maxRaw) || 0)),
            fee_inr: Math.max(0, Math.round(Number(obj.fee_inr) || 0)),
          };
        })
        .filter((x): x is PayPerPriceBand => x !== null)
    : fallback.price_bands;

  const areaBands: PayPerAreaBandSqft[] = Array.isArray(raw.area_bands_sqft)
    ? raw.area_bands_sqft
        .map((item, idx) => {
          if (!item || typeof item !== 'object') return null;
          const obj = item as Record<string, unknown>;
          const maxRaw = obj.max_sqft;
          return {
            id: String(obj.id || `aband_${idx}`),
            label: String(obj.label || `Area Band ${idx + 1}`),
            min_sqft: Math.max(0, Math.round(Number(obj.min_sqft) || 0)),
            max_sqft:
              maxRaw === null || maxRaw === undefined || maxRaw === ''
                ? null
                : Math.max(0, Math.round(Number(maxRaw) || 0)),
            fee_inr: Math.max(0, Math.round(Number(obj.fee_inr) || 0)),
          };
        })
        .filter((x): x is PayPerAreaBandSqft => x !== null)
    : fallback.area_bands_sqft;

  const minCap = Math.max(
    0,
    Math.round(
      typeof raw.min_cap_inr === 'number'
        ? raw.min_cap_inr
        : Number(raw.min_cap_inr ?? fallback.min_cap_inr)
    )
  );
  const maxCapRaw = raw.max_cap_inr;
  const maxCap =
    maxCapRaw === null || maxCapRaw === undefined || maxCapRaw === ''
      ? null
      : Math.max(minCap, Math.round(Number(maxCapRaw) || minCap));

  return {
    module_key: moduleKey,
    label: String(raw.label || fallback.label),
    is_enabled:
      typeof raw.is_enabled === 'boolean' ? raw.is_enabled : fallback.is_enabled,
    duration_slabs:
      durationSlabs.length > 0 ? durationSlabs : fallback.duration_slabs,
    addons,
    price_bands: priceBands,
    area_bands_sqft: areaBands,
    min_cap_inr: minCap,
    max_cap_inr: maxCap,
    updated_at: typeof raw.updated_at === 'string' ? raw.updated_at : undefined,
  };
}

/**
 * Deterministic client-side quote calculator matching `public.calculate_pay_per_quote` 1:1.
 * Final order submission is ALWAYS recomputed by `public.submit_pay_per_order` on the server.
 */
export function calculateClientPayPerQuote(
  config: PayPerPricingConfig,
  params: {
    durationDays?: number | null;
    propertyPriceInr?: number | null;
    areaValue?: number | null;
    areaUnit?: PayPerAreaUnit | null;
    addonIds?: string[] | null;
  }
): PayPerQuoteBreakdown {
  const slabs =
    config.duration_slabs.length > 0
      ? config.duration_slabs
      : DEFAULT_PAY_PER_CONFIGS[config.module_key].duration_slabs;

  const requestedDays = Number(params.durationDays) || slabs[0]?.days || 7;
  const matchedSlab =
    slabs.find((s) => s.days === requestedDays) || slabs[0] || {
      id: 'default_7d',
      label: `${requestedDays} Days`,
      days: requestedDays,
      price_inr: 0,
    };

  const baseSlabInr = Math.max(0, Math.round(matchedSlab.price_inr));

  const isRealEstate =
    config.module_key === 'real_estate_sale' ||
    config.module_key === 'real_estate_rent';

  const propertyPriceInr = Math.max(
    0,
    Math.round(Number(params.propertyPriceInr) || 0)
  );
  let priceBandInr = 0;
  let priceBandLabel: string | null = null;

  if (isRealEstate && propertyPriceInr > 0 && config.price_bands.length > 0) {
    for (const band of config.price_bands) {
      const minOk = propertyPriceInr >= (band.min_price_inr || 0);
      const maxOk =
        band.max_price_inr === null || propertyPriceInr <= band.max_price_inr;
      if (minOk && maxOk) {
        priceBandInr = Math.max(0, Math.round(band.fee_inr || 0));
        priceBandLabel = band.label;
        break;
      }
    }
  }

  const areaUnit: PayPerAreaUnit =
    params.areaUnit === 'sqm' ||
    params.areaUnit === 'acre' ||
    params.areaUnit === 'sangam'
      ? params.areaUnit
      : 'sqft';
  const inputAreaValue = Math.max(0, Number(params.areaValue) || 0);
  const normalizedAreaSqft = convertAreaToSqft(inputAreaValue, areaUnit);

  let areaBandInr = 0;
  let areaBandLabel: string | null = null;

  if (
    isRealEstate &&
    normalizedAreaSqft > 0 &&
    config.area_bands_sqft.length > 0
  ) {
    for (const band of config.area_bands_sqft) {
      const minOk = normalizedAreaSqft >= (band.min_sqft || 0);
      const maxOk =
        band.max_sqft === null || normalizedAreaSqft <= band.max_sqft;
      if (minOk && maxOk) {
        areaBandInr = Math.max(0, Math.round(band.fee_inr || 0));
        areaBandLabel = band.label;
        break;
      }
    }
  }

  const requestedAddonSet = new Set(params.addonIds || []);
  const selectedAddons: PayPerSelectedAddonSummary[] = [];
  let addonsInr = 0;

  for (const addon of config.addons) {
    if (requestedAddonSet.has(addon.id)) {
      const fee = Math.max(0, Math.round(addon.price_inr || 0));
      addonsInr += fee;
      selectedAddons.push({
        id: addon.id,
        label: addon.label,
        price_inr: fee,
      });
    }
  }

  const rawSubtotalInr =
    baseSlabInr + priceBandInr + areaBandInr + addonsInr;
  let totalInr = Math.max(rawSubtotalInr, config.min_cap_inr || 0);
  if (config.max_cap_inr !== null && config.max_cap_inr >= config.min_cap_inr) {
    totalInr = Math.min(totalInr, config.max_cap_inr);
  }

  return {
    module_key: config.module_key,
    is_enabled: config.is_enabled,
    duration_days: matchedSlab.days,
    duration_slab_id: matchedSlab.id,
    duration_slab_label: matchedSlab.label,
    base_slab_inr: baseSlabInr,
    property_price_inr: propertyPriceInr,
    price_band_label: priceBandLabel,
    price_band_inr: priceBandInr,
    input_area_value: inputAreaValue,
    input_area_unit: areaUnit,
    normalized_area_sqft: normalizedAreaSqft,
    area_band_label: areaBandLabel,
    area_band_inr: areaBandInr,
    selected_addons: selectedAddons,
    addons_inr: addonsInr,
    raw_subtotal_inr: rawSubtotalInr,
    min_cap_inr: config.min_cap_inr,
    max_cap_inr: config.max_cap_inr,
    total_inr: totalInr,
  };
}

export async function fetchPayPerPricingConfig(
  moduleKey: PayPerModuleKey
): Promise<PayPerPricingConfig> {
  const fallback = DEFAULT_PAY_PER_CONFIGS[moduleKey];
  if (!isSupabaseConfigured()) {
    return fallback;
  }

  try {
    const { data, error } = await supabase
      .from('pay_per_pricing_configs')
      .select('*')
      .eq('module_key', moduleKey)
      .maybeSingle();

    if (error || !data) {
      return fallback;
    }

    return normalizePayPerPricingConfig(
      data as Record<string, unknown>,
      moduleKey
    );
  } catch {
    return fallback;
  }
}

export async function fetchAllPayPerPricingConfigs(): Promise<
  Record<PayPerModuleKey, PayPerPricingConfig>
> {
  const result: Record<PayPerModuleKey, PayPerPricingConfig> = {
    marketplace_item: { ...DEFAULT_PAY_PER_CONFIGS.marketplace_item },
    bulletin_post: { ...DEFAULT_PAY_PER_CONFIGS.bulletin_post },
    real_estate_sale: { ...DEFAULT_PAY_PER_CONFIGS.real_estate_sale },
    real_estate_rent: { ...DEFAULT_PAY_PER_CONFIGS.real_estate_rent },
  };

  if (!isSupabaseConfigured()) {
    return result;
  }

  try {
    const { data, error } = await supabase
      .from('pay_per_pricing_configs')
      .select('*');

    if (error || !Array.isArray(data)) {
      return result;
    }

    for (const row of data) {
      const normalized = normalizePayPerPricingConfig(
        row as Record<string, unknown>
      );
      result[normalized.module_key] = normalized;
    }

    return result;
  } catch {
    return result;
  }
}

/**
 * Evaluates whether an owner/advertiser has remaining subscription quota (`₹0 Included in Plan`)
 * vs. needs Pay-Per Publish or Plan Upgrade for the target module.
 */
export async function evaluateOwnerQuotaStatus(
  userId: string | null | undefined,
  moduleKey: PayPerModuleKey,
  knownUsedCount?: number
): Promise<OwnerQuotaEvaluation> {
  const entitlements = await fetchEffectiveEntitlements(userId, null);

  let planName = entitlements.is_super_admin_bypass
    ? 'Superadmin Bypass'
    : entitlements.has_active_subscription
      ? 'Active Subscription'
      : 'Default Free Baseline';

  if (
    userId &&
    isSupabaseConfigured() &&
    entitlements.active_plan_ids.length > 0
  ) {
    try {
      const { data: planRow } = await supabase
        .from('subscription_plans')
        .select('name')
        .eq('id', entitlements.active_plan_ids[0])
        .maybeSingle();
      if (planRow && typeof (planRow as { name?: string }).name === 'string') {
        planName = (planRow as { name: string }).name;
      }
    } catch {
      // ignore
    }
  } else if (userId && isSupabaseConfigured() && entitlements.is_free_baseline) {
    try {
      const { data: freePlanRow } = await supabase
        .from('subscription_plans')
        .select('name')
        .eq('is_default_free', true)
        .maybeSingle();
      if (
        freePlanRow &&
        typeof (freePlanRow as { name?: string }).name === 'string'
      ) {
        planName = (freePlanRow as { name: string }).name;
      }
    } catch {
      // ignore
    }
  }

  let usedCount = typeof knownUsedCount === 'number' ? knownUsedCount : 0;

  if (typeof knownUsedCount !== 'number' && userId && isSupabaseConfigured()) {
    try {
      if (moduleKey === 'marketplace_item') {
        const { count } = await supabase
          .from('marketplace_products')
          .select('id', { count: 'exact', head: true })
          .eq('seller_id', userId);
        usedCount = count ?? 0;
      } else if (moduleKey === 'bulletin_post') {
        const { count } = await supabase
          .from('bulletins')
          .select('id', { count: 'exact', head: true })
          .eq('author_id', userId)
          .eq('status', 'published');
        usedCount = count ?? 0;
      } else {
        const { count } = await supabase
          .from('listings')
          .select('id', { count: 'exact', head: true })
          .eq('owner_id', userId)
          .neq('status', 'archived');
        usedCount = count ?? 0;
      }
    } catch {
      usedCount = 0;
    }
  }

  if (entitlements.is_super_admin_bypass) {
    return {
      moduleKey,
      planName,
      isDefaultFree: false,
      isSuperAdminBypass: true,
      featureEnabled: true,
      usedCount,
      maxLimit: null,
      remainingCount: null,
      hasRemainingQuota: true,
      entitlements,
    };
  }

  let featureEnabled = true;
  let maxLimit: number | null = 0;

  if (moduleKey === 'marketplace_item') {
    maxLimit = entitlements.max_marketplace_items;
    featureEnabled = maxLimit === null || maxLimit > 0;
  } else if (moduleKey === 'bulletin_post') {
    featureEnabled = Boolean(entitlements.bulletins?.enabled);
    maxLimit = featureEnabled ? entitlements.bulletins.limit : 0;
  } else {
    // real_estate_sale | real_estate_rent
    const allowsRealEstate =
      entitlements.allowed_root_keys.includes('*') ||
      entitlements.allowed_listing_types.includes('real_estate') ||
      entitlements.allowed_root_keys.includes('real_estate');
    featureEnabled = allowsRealEstate;
    maxLimit = allowsRealEstate ? entitlements.max_listings : 0;
  }

  const remainingCount =
    maxLimit === null ? null : Math.max(0, maxLimit - usedCount);
  const hasRemainingQuota =
    featureEnabled && (maxLimit === null || usedCount < maxLimit);

  return {
    moduleKey,
    planName,
    isDefaultFree: entitlements.is_free_baseline,
    isSuperAdminBypass: false,
    featureEnabled,
    usedCount,
    maxLimit,
    remainingCount,
    hasRemainingQuota,
    entitlements,
  };
}
