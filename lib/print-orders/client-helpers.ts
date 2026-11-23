import type {
  ListingPrintProfile,
  PrintCapabilities,
  PrintPaymentPolicy,
  PrintRateCard,
  PrintTurnaroundBadge,
  PrintVerifiedCapabilities,
} from '@/lib/print-orders/types';

export type PrintCapabilityFilterKey =
  | 'all'
  | 'order_online'
  | 'color_a4'
  | 'duplex'
  | 'binding_lamination'
  | 'custom_digital';

export interface PrintProfileBadgeSummary {
  listingId: string;
  isFirstParty: boolean;
  isAcceptingOrders: boolean;
  hasActiveEntitlement: boolean;
  isBusyPaused: boolean;
  turnaroundBadge: PrintTurnaroundBadge;
  capabilities: PrintCapabilities;
  verifiedCapabilities: PrintVerifiedCapabilities;
  rateCard: PrintRateCard;
  directPayMaxInr: number;
  shopUpiVerified: boolean;
  allowEscrow: boolean;
}

export interface PrintSpotlightItem {
  listingId: string;
  title: string;
  locality: string;
  address: string | null;
  coverImage: string | null;
  hubId: string | null;
  isFirstParty: boolean;
  isAcceptingOrders: boolean;
  isBusyPaused: boolean;
  turnaroundBadge: PrintTurnaroundBadge;
  capabilities: PrintCapabilities;
  verifiedCapabilities: PrintVerifiedCapabilities;
  rateCard: PrintRateCard;
  directPayMaxInr: number;
  allowEscrow: boolean;
}

export const TURNAROUND_BADGE_LABELS: Record<
  PrintTurnaroundBadge,
  { label: string; shortLabel: string; className: string }
> = {
  express_30m: {
    label: 'Express ~30 min',
    shortLabel: '~30m',
    className:
      'border-emerald-500/35 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300',
  },
  same_day: {
    label: 'Same-Day',
    shortLabel: 'Same-Day',
    className:
      'border-sky-500/35 bg-sky-500/12 text-sky-700 dark:text-sky-300',
  },
  next_day: {
    label: 'Next-Day',
    shortLabel: 'Next-Day',
    className:
      'border-amber-500/35 bg-amber-500/12 text-amber-700 dark:text-amber-300',
  },
};

export const PRINT_CAPABILITY_FILTER_OPTIONS: Array<{
  key: PrintCapabilityFilterKey;
  label: string;
}> = [
  { key: 'order_online', label: 'Order Online' },
  { key: 'color_a4', label: 'Verified Color' },
  { key: 'duplex', label: 'Duplex' },
  { key: 'binding_lamination', label: 'Binding & Lamination' },
  { key: 'custom_digital', label: 'Custom Digital' },
];

function asPlainObject(val: unknown): Record<string, unknown> {
  return val && typeof val === 'object' && !Array.isArray(val)
    ? (val as Record<string, unknown>)
    : {};
}

export function normalizeClientPrintProfile(
  raw: Record<string, unknown> | null | undefined
): ListingPrintProfile | null {
  if (!raw || typeof raw !== 'object' || !raw.listing_id) return null;

  const capsRaw = asPlainObject(raw.capabilities);
  const verRaw = asPlainObject(raw.verified_capabilities);
  const rateRaw = {
    ...asPlainObject(raw.rate_card),
    ...asPlainObject(raw.pricing_matrix),
  };
  const payRaw = asPlainObject(raw.payment_policy);

  const capabilities: PrintCapabilities = {
    bw_a4: Boolean(capsRaw.bw_a4),
    color_a4: Boolean(capsRaw.color_a4),
    duplex: Boolean(capsRaw.duplex),
    a3_large: Boolean(capsRaw.a3_large),
    spiral_binding: Boolean(capsRaw.spiral_binding),
    lamination: Boolean(capsRaw.lamination),
    custom_digital_jobs: Boolean(capsRaw.custom_digital_jobs),
    sealed_envelope: Boolean(capsRaw.sealed_envelope),
  };

  const verifiedCapabilities: PrintVerifiedCapabilities = {};
  (Object.keys(capabilities) as Array<keyof PrintCapabilities>).forEach((k) => {
    if (typeof verRaw[k] === 'boolean') {
      verifiedCapabilities[k] = verRaw[k] as boolean;
    }
  });

  const numOrUndef = (val: unknown): number | undefined => {
    if (val === null || val === undefined || val === '') return undefined;
    const n = Number(val);
    return Number.isFinite(n) && n >= 0 ? n : undefined;
  };

  const bwSingle = numOrUndef(rateRaw.bw_a4_single_inr ?? rateRaw.bw_a4_per_page);
  const colorSingle = numOrUndef(
    rateRaw.color_a4_single_inr ?? rateRaw.color_a4_per_page
  );
  const discountPct = numOrUndef(rateRaw.duplex_discount_pct) ?? 0;

  const rateCard: PrintRateCard = {
    bw_a4_single_inr: bwSingle,
    bw_a4_duplex_inr:
      numOrUndef(rateRaw.bw_a4_duplex_inr) ??
      (bwSingle !== undefined && discountPct > 0
        ? Math.round(bwSingle * 2 * (1 - discountPct / 100) * 100) / 100
        : undefined),
    color_a4_single_inr: colorSingle,
    color_a4_duplex_inr:
      numOrUndef(rateRaw.color_a4_duplex_inr) ??
      (colorSingle !== undefined && discountPct > 0
        ? Math.round(colorSingle * 2 * (1 - discountPct / 100) * 100) / 100
        : undefined),
    a3_bw_inr: numOrUndef(rateRaw.a3_bw_inr),
    a3_bw_duplex_inr: numOrUndef(rateRaw.a3_bw_duplex_inr),
    a3_color_inr: numOrUndef(rateRaw.a3_color_inr),
    a3_color_duplex_inr: numOrUndef(rateRaw.a3_color_duplex_inr),
    legal_bw_single_inr: numOrUndef(rateRaw.legal_bw_single_inr),
    legal_bw_duplex_inr: numOrUndef(rateRaw.legal_bw_duplex_inr),
    legal_color_single_inr: numOrUndef(rateRaw.legal_color_single_inr),
    legal_color_duplex_inr: numOrUndef(rateRaw.legal_color_duplex_inr),
    spiral_binding_inr: numOrUndef(rateRaw.spiral_binding_inr),
    hard_binding_inr: numOrUndef(rateRaw.hard_binding_inr),
    lamination_per_sheet_inr: numOrUndef(
      rateRaw.lamination_per_sheet_inr ??
        rateRaw.lamination_inr ??
        rateRaw.lamination_a4_inr
    ),
    staple_inr: numOrUndef(rateRaw.staple_inr),
    sealed_envelope_inr: numOrUndef(rateRaw.sealed_envelope_inr),
    min_order_inr: numOrUndef(
      rateRaw.min_order_inr ?? rateRaw.minimum_order_inr
    ),
    platform_fee_inr: numOrUndef(rateRaw.platform_fee_inr),
    urgent_express_surcharge_type:
      rateRaw.urgent_express_surcharge_type === 'percent' ? 'percent' : 'flat',
    urgent_express_surcharge_value: numOrUndef(
      rateRaw.urgent_express_surcharge_value
    ),
    bulk_discounts: Array.isArray(rateRaw.bulk_discounts)
      ? (rateRaw.bulk_discounts as PrintRateCard['bulk_discounts'])
      : undefined,
  };

  const rawDirectMax = Number(payRaw.direct_pay_max_inr);
  const paymentPolicy: PrintPaymentPolicy = {
    allow_direct_pay: payRaw.allow_direct_pay !== false,
    direct_pay_max_inr:
      Number.isFinite(rawDirectMax) && rawDirectMax >= 0 ? rawDirectMax : 300,
    allow_escrow: payRaw.allow_escrow !== false,
    shop_upi_id:
      typeof payRaw.shop_upi_id === 'string' && payRaw.shop_upi_id.trim()
        ? payRaw.shop_upi_id.trim()
        : null,
    shop_upi_name:
      typeof payRaw.shop_upi_name === 'string' && payRaw.shop_upi_name.trim()
        ? payRaw.shop_upi_name.trim()
        : null,
    shop_upi_verified: Boolean(payRaw.shop_upi_verified),
  };

  const turnaroundRaw = String(raw.turnaround_badge || 'same_day');
  const turnaroundBadge: PrintTurnaroundBadge =
    turnaroundRaw === 'express_30m' || turnaroundRaw === 'next_day'
      ? turnaroundRaw
      : 'same_day';

  const isOfficial = Boolean(
    raw.is_official_printswift ?? raw.is_first_party_printswift
  );
  const rawEta = Number(raw.express_eta_mins);
  const expressEtaMins =
    Number.isFinite(rawEta) && rawEta >= 5
      ? Math.round(rawEta)
      : turnaroundBadge === 'express_30m'
        ? 30
        : turnaroundBadge === 'same_day'
          ? 180
          : 1440;

  return {
    listing_id: String(raw.listing_id),
    hub_id: raw.hub_id ? String(raw.hub_id) : '',
    is_official_printswift: isOfficial,
    is_first_party_printswift: isOfficial,
    is_accepting_orders: Boolean(raw.is_accepting_orders),
    express_eta_mins: expressEtaMins,
    supports_pick_n_drop: raw.supports_pick_n_drop !== false,
    busy_until: raw.busy_until ? String(raw.busy_until) : null,
    pricing_version: Number(raw.pricing_version || 1),
    turnaround_badge: turnaroundBadge,
    capabilities,
    verified_capabilities: verifiedCapabilities,
    rate_card: rateCard,
    pricing_matrix: rateCard,
    payment_policy: paymentPolicy,
    pickup_instructions: raw.pickup_instructions
      ? String(raw.pickup_instructions)
      : null,
    max_file_size_mb: Number(raw.max_file_size_mb || 25),
    created_at: raw.created_at ? String(raw.created_at) : undefined,
    updated_at: raw.updated_at ? String(raw.updated_at) : undefined,
  };
}

export function isPrintProfileBusyPaused(
  busyUntil: string | null | undefined,
  nowMs: number
): boolean {
  if (!busyUntil) return false;
  const ts = new Date(busyUntil).getTime();
  return Number.isFinite(ts) && ts > nowMs;
}

export function matchesPrintCapabilityFilter(
  summary: PrintProfileBadgeSummary | undefined,
  filterKey: PrintCapabilityFilterKey
): boolean {
  if (filterKey === 'all') return true;
  if (!summary) return false;
  const isActiveOrderable =
    summary.hasActiveEntitlement &&
    summary.isAcceptingOrders &&
    !summary.isBusyPaused;

  if (!isActiveOrderable) return false;
  if (filterKey === 'order_online') return true;

  const vc = summary.verifiedCapabilities;
  switch (filterKey) {
    case 'color_a4':
      return vc.color_a4 === true;
    case 'duplex':
      return vc.duplex === true;
    case 'binding_lamination':
      return vc.spiral_binding === true || vc.lamination === true;
    case 'custom_digital':
      return vc.custom_digital_jobs === true;
    default:
      return true;
  }
}

export function getVerifiedCapabilityChipLabels(
  profile: Pick<
    ListingPrintProfile,
    'capabilities' | 'verified_capabilities' | 'is_first_party_printswift'
  >,
  strictVerifiedOnly = false
): string[] {
  const source = strictVerifiedOnly
    ? profile.verified_capabilities
    : Object.keys(profile.verified_capabilities).length > 0
      ? profile.verified_capabilities
      : profile.capabilities;

  const chips: string[] = [];
  if (source.bw_a4) chips.push('B&W A4');
  if (source.color_a4) chips.push('Color');
  if (source.duplex) chips.push('Duplex');
  if (source.spiral_binding) chips.push('Binding');
  if (source.lamination) chips.push('Lamination');
  if (source.a3_large) chips.push('A3 Large');
  if (source.custom_digital_jobs) chips.push('Custom Digital');
  if (source.sealed_envelope) chips.push('Sealed Envelope');
  return chips;
}

const PRINT_CATEGORY_SLUGS = new Set([
  'printing_digital_services',
  'printing_photocopy',
  'print_digital_shop',
  'photocopy_xerox',
  'cyber_cafe_forms',
  'dtp_typing_design',
  'graphic_banner_design',
  'binding_lamination',
  'photo_studio_print',
  'scanning_document_prep',
  'online_form_exam_assistance',
  'typing_formatting',
  'file_conversion_dtp',
]);

const PRINT_KEYWORD_REGEX =
  /\b(print|printing|printer|printswift|xerox|photocopy|lamination|spiral\s*binding|dtp|cyber\s*cafe|online\s*form|csc\s*centre|csc\s*center|document\s*scan|digital\s*services)\b/i;

export function isPrintingDigitalCategorySlug(
  slug: string | null | undefined
): boolean {
  if (!slug) return false;
  const norm = slug.trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (PRINT_CATEGORY_SLUGS.has(norm)) return true;
  return (
    norm.includes('printing') ||
    norm.includes('photocopy') ||
    norm.includes('xerox') ||
    norm.includes('dtp_') ||
    norm.includes('cyber_cafe') ||
    norm.includes('digital_service')
  );
}

export function isListingInPrintingDigitalDomain(input: {
  categorySlug?: string | null;
  subcategory?: string | null;
  title?: string | null;
  customTags?: string[] | null;
}): boolean {
  if (isPrintingDigitalCategorySlug(input.categorySlug)) return true;
  if (isPrintingDigitalCategorySlug(input.subcategory)) return true;
  if (input.subcategory && PRINT_KEYWORD_REGEX.test(input.subcategory)) {
    return true;
  }
  if (
    Array.isArray(input.customTags) &&
    input.customTags.some(
      (tag) =>
        isPrintingDigitalCategorySlug(tag) || PRINT_KEYWORD_REGEX.test(tag)
    )
  ) {
    return true;
  }
  if (input.title && PRINT_KEYWORD_REGEX.test(input.title)) {
    return true;
  }
  return false;
}

export function formatStartingRateLabel(rateCard: PrintRateCard): string | null {
  const parts: string[] = [];
  if (
    typeof rateCard.bw_a4_single_inr === 'number' &&
    rateCard.bw_a4_single_inr > 0
  ) {
    parts.push(`B&W ₹${rateCard.bw_a4_single_inr}/pg`);
  }
  if (
    typeof rateCard.color_a4_single_inr === 'number' &&
    rateCard.color_a4_single_inr > 0
  ) {
    parts.push(`Color ₹${rateCard.color_a4_single_inr}/pg`);
  }
  return parts.length > 0 ? parts.join(' • ') : null;
}
