import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';

export type PaymentMode = 'upi' | 'manual' | 'both';
export type PaymentCheckoutMethod = 'upi' | 'manual';
export type PaymentPolicyScopeType = 'feature' | 'listing_type';

export interface PaymentFeaturePolicyRow {
  scope_key: string;
  scope_type: PaymentPolicyScopeType;
  label: string;
  upi_enabled: boolean;
  manual_enabled: boolean;
  escrow_required: boolean;
  allow_listing_override: boolean;
  updated_at?: string;
}

export interface EffectivePaymentMethodsResult {
  scope_key: string;
  listing_id: string | null;
  policy_found: boolean;
  allowed_methods: PaymentCheckoutMethod[];
  upi_allowed: boolean;
  manual_allowed: boolean;
  escrow_required: boolean;
  allow_listing_override: boolean;
  listing_payment_mode: PaymentMode | null;
  blocked_reasons: {
    upi: string | null;
    manual: string | null;
  };
  layers: {
    system: {
      upi_enabled: boolean;
      manual_enabled: boolean;
      escrow_required: boolean;
      allow_listing_override: boolean;
    };
    subscription: {
      owner_id: string | null;
      online_payment_enabled: boolean;
    };
    listing: {
      payment_mode: PaymentMode | null;
    };
  };
}

export const DEFAULT_PAYMENT_POLICIES: PaymentFeaturePolicyRow[] = [
  {
    scope_key: 'pnd',
    scope_type: 'feature',
    label: 'Pick N Drop Logistics',
    upi_enabled: true,
    manual_enabled: true,
    escrow_required: true,
    allow_listing_override: false,
  },
  {
    scope_key: 'bulletin',
    scope_type: 'feature',
    label: 'Community Bulletins & Notices',
    upi_enabled: true,
    manual_enabled: true,
    escrow_required: false,
    allow_listing_override: false,
  },
  {
    scope_key: 'vehicles',
    scope_type: 'feature',
    label: 'Vehicle Rental & Fleet Bookings',
    upi_enabled: true,
    manual_enabled: true,
    escrow_required: true,
    allow_listing_override: false,
  },
  {
    scope_key: 'print_order',
    scope_type: 'feature',
    label: 'Print & Digital Orders',
    upi_enabled: true,
    manual_enabled: true,
    escrow_required: false,
    allow_listing_override: true,
  },
  {
    scope_key: 'marketplace',
    scope_type: 'feature',
    label: 'Marketplace Classifieds & Deals',
    upi_enabled: true,
    manual_enabled: true,
    escrow_required: false,
    allow_listing_override: true,
  },
  {
    scope_key: 'general',
    scope_type: 'listing_type',
    label: 'General Business & Services',
    upi_enabled: true,
    manual_enabled: true,
    escrow_required: false,
    allow_listing_override: true,
  },
  {
    scope_key: 'print_digital',
    scope_type: 'listing_type',
    label: 'Print, Copy & Digital Services',
    upi_enabled: true,
    manual_enabled: true,
    escrow_required: false,
    allow_listing_override: true,
  },
  {
    scope_key: 'booking_venue',
    scope_type: 'listing_type',
    label: 'Sports & Venue Bookings',
    upi_enabled: true,
    manual_enabled: true,
    escrow_required: false,
    allow_listing_override: true,
  },
  {
    scope_key: 'shop_catalogue',
    scope_type: 'listing_type',
    label: 'Retail & Local Shop Catalogue',
    upi_enabled: true,
    manual_enabled: true,
    escrow_required: false,
    allow_listing_override: true,
  },
  {
    scope_key: 'real_estate',
    scope_type: 'listing_type',
    label: 'Real Estate & Land Plots',
    upi_enabled: true,
    manual_enabled: true,
    escrow_required: false,
    allow_listing_override: true,
  },
  {
    scope_key: 'restaurant_food',
    scope_type: 'listing_type',
    label: 'Restaurants, Cafés & Bakeries',
    upi_enabled: true,
    manual_enabled: true,
    escrow_required: false,
    allow_listing_override: true,
  },
  {
    scope_key: 'hotel_stay',
    scope_type: 'listing_type',
    label: 'Hotels, Homestays & Lodging',
    upi_enabled: true,
    manual_enabled: true,
    escrow_required: false,
    allow_listing_override: true,
  },
  {
    scope_key: 'public_civic',
    scope_type: 'listing_type',
    label: 'Public & Civic Institutions',
    upi_enabled: false,
    manual_enabled: true,
    escrow_required: false,
    allow_listing_override: false,
  },
];

export function normalizePaymentMode(raw: unknown): PaymentMode {
  if (raw === 'upi' || raw === 'manual' || raw === 'both') return raw;
  return 'manual';
}

/**
 * Pure 3-tier cascade calculation mirroring `public.resolve_effective_payment_methods`:
 *   Layer 1: System `payment_feature_policies`
 *   Layer 2: Owner subscription `online_payment.enabled`
 *   Layer 3: Listing `payment_mode` (honored when `allow_listing_override` is true)
 */
export function computeEffectivePaymentMethods(params: {
  policy: PaymentFeaturePolicyRow | null;
  scopeKey: string;
  onlinePaymentEnabled: boolean;
  listingId?: string | null;
  ownerId?: string | null;
  listingPaymentMode?: PaymentMode | null;
}): EffectivePaymentMethodsResult {
  const {
    policy,
    scopeKey,
    onlinePaymentEnabled,
    listingId = null,
    ownerId = null,
    listingPaymentMode = null,
  } = params;

  const sysUpi = policy ? policy.upi_enabled : false;
  const sysManual = policy ? policy.manual_enabled : true;
  const escrowRequired = policy ? policy.escrow_required : false;
  const allowOverride = policy ? policy.allow_listing_override : true;

  const hasListingContext = Boolean(listingId || listingPaymentMode);
  const resolvedListingMode = listingPaymentMode
    ? normalizePaymentMode(listingPaymentMode)
    : null;

  let upiAllowed = false;
  let upiReason: string | null = null;
  if (!sysUpi) {
    upiReason = 'disabled_by_system_policy';
  } else if (!onlinePaymentEnabled) {
    upiReason = 'blocked_by_owner_subscription';
  } else if (
    hasListingContext &&
    allowOverride &&
    resolvedListingMode &&
    resolvedListingMode !== 'upi' &&
    resolvedListingMode !== 'both'
  ) {
    upiReason = 'disabled_by_listing_mode';
  } else {
    upiAllowed = true;
  }

  let manualAllowed = false;
  let manualReason: string | null = null;
  if (!sysManual) {
    manualReason = 'disabled_by_system_policy';
  } else if (
    hasListingContext &&
    allowOverride &&
    resolvedListingMode &&
    resolvedListingMode !== 'manual' &&
    resolvedListingMode !== 'both'
  ) {
    manualReason = 'disabled_by_listing_mode';
  } else {
    manualAllowed = true;
  }

  const allowedMethods: PaymentCheckoutMethod[] = [];
  if (upiAllowed) allowedMethods.push('upi');
  if (manualAllowed) allowedMethods.push('manual');

  return {
    scope_key: scopeKey,
    listing_id: listingId,
    policy_found: Boolean(policy),
    allowed_methods: allowedMethods,
    upi_allowed: upiAllowed,
    manual_allowed: manualAllowed,
    escrow_required: escrowRequired,
    allow_listing_override: allowOverride,
    listing_payment_mode: resolvedListingMode,
    blocked_reasons: {
      upi: upiReason,
      manual: manualReason,
    },
    layers: {
      system: {
        upi_enabled: sysUpi,
        manual_enabled: sysManual,
        escrow_required: escrowRequired,
        allow_listing_override: allowOverride,
      },
      subscription: {
        owner_id: ownerId,
        online_payment_enabled: onlinePaymentEnabled,
      },
      listing: {
        payment_mode: resolvedListingMode,
      },
    },
  };
}

export async function fetchPaymentPolicyForScope(
  scopeKey: string
): Promise<PaymentFeaturePolicyRow> {
  const normalized = scopeKey.trim().toLowerCase();
  const fallback =
    DEFAULT_PAYMENT_POLICIES.find((p) => p.scope_key === normalized) ||
    DEFAULT_PAYMENT_POLICIES.find((p) => p.scope_key === 'general')!;

  if (!isSupabaseConfigured()) {
    return fallback;
  }

  try {
    const { data, error } = await supabase
      .from('payment_feature_policies')
      .select(
        'scope_key, scope_type, label, upi_enabled, manual_enabled, escrow_required, allow_listing_override, updated_at'
      )
      .eq('scope_key', normalized)
      .maybeSingle();

    if (error || !data) {
      return fallback;
    }

    return data as PaymentFeaturePolicyRow;
  } catch {
    return fallback;
  }
}

export async function resolveEffectivePaymentMethods(
  scopeKey: string,
  listingId?: string | null
): Promise<EffectivePaymentMethodsResult> {
  const normalizedScope = scopeKey.trim().toLowerCase() || 'general';
  const fallbackPolicy =
    DEFAULT_PAYMENT_POLICIES.find((p) => p.scope_key === normalizedScope) ||
    null;

  if (!isSupabaseConfigured()) {
    return computeEffectivePaymentMethods({
      policy: fallbackPolicy,
      scopeKey: normalizedScope,
      onlinePaymentEnabled: !listingId,
      listingId: listingId ?? null,
    });
  }

  try {
    const { data, error } = await supabase.rpc(
      'resolve_effective_payment_methods',
      {
        p_scope_key: normalizedScope,
        p_listing_id: listingId ?? null,
      }
    );

    if (error || !data || typeof data !== 'object') {
      return computeEffectivePaymentMethods({
        policy: fallbackPolicy,
        scopeKey: normalizedScope,
        onlinePaymentEnabled: !listingId,
        listingId: listingId ?? null,
      });
    }

    const row = data as Record<string, unknown>;
    const allowedMethods: PaymentCheckoutMethod[] = Array.isArray(
      row.allowed_methods
    )
      ? row.allowed_methods.filter(
          (m): m is PaymentCheckoutMethod => m === 'upi' || m === 'manual'
        )
      : [];

    const blocked = (row.blocked_reasons as Record<string, unknown>) || {};
    const layers = (row.layers as Record<string, Record<string, unknown>>) || {};

    return {
      scope_key: String(row.scope_key || normalizedScope),
      listing_id:
        typeof row.listing_id === 'string' ? row.listing_id : listingId ?? null,
      policy_found: Boolean(row.policy_found),
      allowed_methods: allowedMethods,
      upi_allowed: Boolean(row.upi_allowed),
      manual_allowed: Boolean(row.manual_allowed),
      escrow_required: Boolean(row.escrow_required),
      allow_listing_override: Boolean(row.allow_listing_override),
      listing_payment_mode: row.listing_payment_mode
        ? normalizePaymentMode(row.listing_payment_mode)
        : null,
      blocked_reasons: {
        upi: typeof blocked.upi === 'string' ? blocked.upi : null,
        manual: typeof blocked.manual === 'string' ? blocked.manual : null,
      },
      layers: {
        system: {
          upi_enabled: Boolean(layers.system?.upi_enabled),
          manual_enabled: Boolean(layers.system?.manual_enabled),
          escrow_required: Boolean(layers.system?.escrow_required),
          allow_listing_override: Boolean(
            layers.system?.allow_listing_override
          ),
        },
        subscription: {
          owner_id:
            typeof layers.subscription?.owner_id === 'string'
              ? layers.subscription.owner_id
              : null,
          online_payment_enabled: Boolean(
            layers.subscription?.online_payment_enabled
          ),
        },
        listing: {
          payment_mode: layers.listing?.payment_mode
            ? normalizePaymentMode(layers.listing.payment_mode)
            : null,
        },
      },
    };
  } catch {
    return computeEffectivePaymentMethods({
      policy: fallbackPolicy,
      scopeKey: normalizedScope,
      onlinePaymentEnabled: !listingId,
      listingId: listingId ?? null,
    });
  }
}
