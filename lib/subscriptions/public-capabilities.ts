/**
 * Pass v17b: Privacy-Safe Customer-Facing Listing Capability Resolver
 *
 * Calls `public.get_listing_public_capabilities(p_listing_id)` which evaluates
 * the listing owner's live subscription/trial entitlements + 3-tier payment
 * method policies server-side in PostgreSQL and returns ONLY public boolean
 * capability flags (zero billing, plan name, price, or owner PII).
 *
 * Safe to import from BOTH Next.js Server Components (`app/listing/[id]/page.tsx`)
 * and Client Components.
 */

export interface ListingPublicCapabilities {
  can_pay_upi: boolean;
  can_pay_manual: boolean;
  escrow_required: boolean;
  can_book_online: boolean;
  can_order_print: boolean;
  can_dispatch_pnd: boolean;
  can_show_360: boolean;
  can_show_marketplace: boolean;
  has_auto_verified: boolean;
  is_owner_plan_active: boolean;
}

export const DEFAULT_LISTING_PUBLIC_CAPABILITIES: ListingPublicCapabilities = {
  can_pay_upi: false,
  can_pay_manual: true,
  escrow_required: false,
  can_book_online: false,
  can_order_print: false,
  can_dispatch_pnd: false,
  can_show_360: false,
  can_show_marketplace: true,
  has_auto_verified: false,
  is_owner_plan_active: false,
};

export function normalizeListingPublicCapabilities(
  raw: unknown,
  fallback: ListingPublicCapabilities = DEFAULT_LISTING_PUBLIC_CAPABILITIES
): ListingPublicCapabilities {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ...fallback };
  }
  const src = raw as Record<string, unknown>;
  return {
    can_pay_upi:
      typeof src.can_pay_upi === 'boolean'
        ? src.can_pay_upi
        : fallback.can_pay_upi,
    can_pay_manual:
      typeof src.can_pay_manual === 'boolean'
        ? src.can_pay_manual
        : fallback.can_pay_manual,
    escrow_required:
      typeof src.escrow_required === 'boolean'
        ? src.escrow_required
        : fallback.escrow_required,
    can_book_online:
      typeof src.can_book_online === 'boolean'
        ? src.can_book_online
        : fallback.can_book_online,
    can_order_print:
      typeof src.can_order_print === 'boolean'
        ? src.can_order_print
        : fallback.can_order_print,
    can_dispatch_pnd:
      typeof src.can_dispatch_pnd === 'boolean'
        ? src.can_dispatch_pnd
        : fallback.can_dispatch_pnd,
    can_show_360:
      typeof src.can_show_360 === 'boolean'
        ? src.can_show_360
        : fallback.can_show_360,
    can_show_marketplace:
      typeof src.can_show_marketplace === 'boolean'
        ? src.can_show_marketplace
        : fallback.can_show_marketplace,
    has_auto_verified:
      typeof src.has_auto_verified === 'boolean'
        ? src.has_auto_verified
        : fallback.has_auto_verified,
    is_owner_plan_active:
      typeof src.is_owner_plan_active === 'boolean'
        ? src.is_owner_plan_active
        : fallback.is_owner_plan_active,
  };
}

interface RpcCapableSupabaseClient {
  rpc: (
    fn: string,
    args?: Record<string, unknown>
  ) => PromiseLike<{ data: unknown; error: unknown }>;
}

/**
 * Fetches privacy-safe public capabilities for a listing.
 * Falls back gracefully to `fallback` if the RPC is not yet provisioned.
 */
export async function fetchListingPublicCapabilities(
  client: RpcCapableSupabaseClient | null | undefined,
  listingId: string | null | undefined,
  fallback: ListingPublicCapabilities = DEFAULT_LISTING_PUBLIC_CAPABILITIES
): Promise<{ capabilities: ListingPublicCapabilities; fromRpc: boolean }> {
  if (!client || !listingId) {
    return { capabilities: { ...fallback }, fromRpc: false };
  }

  try {
    const { data, error } = await client.rpc('get_listing_public_capabilities', {
      p_listing_id: listingId,
    });

    if (error || !data) {
      return { capabilities: { ...fallback }, fromRpc: false };
    }

    return {
      capabilities: normalizeListingPublicCapabilities(data, fallback),
      fromRpc: true,
    };
  } catch {
    return { capabilities: { ...fallback }, fromRpc: false };
  }
}
