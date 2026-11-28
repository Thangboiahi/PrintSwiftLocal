/**
 * Unified Rich Share Engine (Pass V6-A / v24c)
 *
 * Powers the themed `<ShareSheetModal />` with a rich visual Share Preview Card
 * (cover image, title, vertical/category badge, locality, price/rating, verified tag)
 * and 1-tap WhatsApp Share, Copy Link, and Native Web Share (`navigator.share`).
 */

export interface SharePayload {
  title: string;
  text?: string;
  url?: string;
  whatsappMessage?: string;
  imageUrl?: string | null;
  categoryLabel?: string | null;
  category?: string | null;
  verticalBadge?: string | null;
  locality?: string | null;
  priceLabel?: string | null;
  priceText?: string | null;
  rating?: number | null;
  isVerified?: boolean;
  verified?: boolean;
  subtitle?: string | null;
}

export interface ResolvedSharePayload {
  title: string;
  text: string;
  url: string;
  whatsappMessage: string;
  imageUrl: string | null;
  categoryLabel: string | null;
  verticalBadge: string | null;
  locality: string | null;
  priceLabel: string | null;
  rating: number | null;
  isVerified: boolean;
  subtitle: string | null;
}

export type ShareOutcome = 'native' | 'cancelled' | 'fallback' | 'unsupported';

export const SHARE_SHEET_OPEN_EVENT = 'ddoodle:open-share-sheet';

const VERTICAL_BADGE_LABELS: Record<string, string> = {
  shop_catalogue: 'Local Shop',
  restaurant_food: 'Food & Dining',
  print_digital: 'Print & Digital',
  booking_venue: 'Venue & Slots',
  hotel_stay: 'Hotel & Stay',
  real_estate: 'Real Estate',
  public_civic: 'Civic & Emergency',
  general: 'Local Service',
  service: 'Local Service',
};

export function formatVerticalBadgeLabel(vertical?: string | null, category?: string | null): string {
  const key = String(vertical || '').trim().toLowerCase();
  if (key && VERTICAL_BADGE_LABELS[key]) {
    return VERTICAL_BADGE_LABELS[key];
  }
  const cat = String(category || '').trim();
  if (!cat) return 'Local Listing';
  return cat
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Validates and resolves a share URL to a safe `http:` or `https:` string.
 * Rejects unsafe schemes such as `javascript:` or `data:`.
 */
export function resolveSafeShareUrl(rawUrl?: string): string {
  const trimmed = String(rawUrl || '').trim();
  if (trimmed) {
    if (trimmed.startsWith('https://') || trimmed.startsWith('http://')) {
      return trimmed;
    }
    if (trimmed.startsWith('/') && typeof window !== 'undefined') {
      return `${window.location.origin}${trimmed}`;
    }
    if (trimmed.startsWith('/')) {
      return trimmed;
    }
  }
  if (typeof window !== 'undefined' && window.location?.href) {
    const href = window.location.href;
    if (href.startsWith('https://') || href.startsWith('http://')) {
      return href;
    }
  }
  return '';
}

export function normalizeSharePayload(payload: SharePayload): ResolvedSharePayload {
  const title = String(payload.title || 'DD oodle').trim() || 'DD oodle';
  const text = String(payload.text || '').trim();
  const url = resolveSafeShareUrl(payload.url);
  const imageUrl = payload.imageUrl ? String(payload.imageUrl).trim() || null : null;
  const rawCategory = payload.categoryLabel ?? payload.category ?? null;
  const categoryLabel = rawCategory ? String(rawCategory).trim() || null : null;
  const verticalBadge = payload.verticalBadge ? String(payload.verticalBadge).trim() || null : null;
  const locality = payload.locality ? String(payload.locality).trim() || null : null;
  const rawPrice = payload.priceLabel ?? payload.priceText ?? null;
  const priceLabel = rawPrice ? String(rawPrice).trim() || null : null;
  const rating =
    typeof payload.rating === 'number' && Number.isFinite(payload.rating) && payload.rating > 0
      ? Number(payload.rating.toFixed(1))
      : null;
  const isVerified = Boolean(payload.isVerified ?? payload.verified);
  const subtitle = payload.subtitle ? String(payload.subtitle).trim() || null : null;

  const metaBits = [
    verticalBadge || categoryLabel,
    locality ? `📍 ${locality}` : null,
    priceLabel ? `💰 ${priceLabel}` : null,
    rating ? `⭐ ${rating.toFixed(1)}` : null,
  ].filter(Boolean);

  const defaultWa = [
    `*${title}*${isVerified ? ' ✅' : ''}`,
    metaBits.length > 0 ? metaBits.join(' • ') : null,
    text && text !== title ? text : null,
    url,
  ]
    .filter(Boolean)
    .join('\n');

  const whatsappMessage = String(payload.whatsappMessage || '').trim() || defaultWa;

  return {
    title,
    text,
    url,
    whatsappMessage,
    imageUrl,
    categoryLabel,
    verticalBadge,
    locality,
    priceLabel,
    rating,
    isVerified,
    subtitle,
  };
}

export interface ShareableListingInput {
  id: string;
  title: string;
  category?: string | null;
  subcategory?: string | null;
  listingVertical?: string | null;
  listing_vertical?: string | null;
  root_key?: string | null;
  locality?: string | null;
  address?: string | null;
  shortDescription?: string | null;
  images?: string[] | null;
  coverImage?: string | null;
  galleryImages?: string[] | null;
  listingMedia?: Array<{ url?: string | null; is_primary?: boolean | null; media_type?: string | null }> | null;
  rating?: number | null;
  isVerified?: boolean | null;
  is_verified?: boolean | null;
  verificationStatus?: string | null;
  price?: number | null;
  priceRange?: string | null;
  startingPriceLabel?: string | null;
  vertical_summary?: Record<string, unknown> | null;
  serviceDetails?: { startingPrice?: number | null } | null;
  realEstateDetails?: { askingPrice?: number | null; priceLabel?: string | null } | null;
  services?: Array<{ name?: string; price?: number }>;
  catalogueItems?: Array<{ name?: string; price?: number; inStock?: boolean }>;
  menuPreview?: Array<{ name?: string; price?: number }>;
  venueSpaces?: Array<{ name?: string; hourlyRate?: number }>;
  roomTypes?: Array<{ name?: string; pricePerNight?: number }>;
  realEstateMeta?: {
    transactionType?: string;
    priceAmount?: number | null;
    rentAmountMonthly?: number | null;
    landAreaText?: string | null;
  } | null;
}

function formatCompactInr(amount: number, suffix = ''): string {
  if (amount >= 10000000) return `₹${(amount / 10000000).toFixed(2).replace(/\.00$/, '')} Cr${suffix}`;
  if (amount >= 100000) return `₹${(amount / 100000).toFixed(2).replace(/\.00$/, '')} L${suffix}`;
  return `₹${Math.round(amount).toLocaleString('en-IN')}${suffix}`;
}

export function deriveListingPriceLabel(listing: ShareableListingInput): string | null {
  if (listing.startingPriceLabel) return listing.startingPriceLabel;
  const vs = (listing.vertical_summary || {}) as Record<string, unknown>;

  if (listing.realEstateMeta) {
    const re = listing.realEstateMeta;
    const amt =
      re.transactionType === 'rent' || re.transactionType === 'lease'
        ? re.rentAmountMonthly || re.priceAmount
        : re.priceAmount || re.rentAmountMonthly;
    if (typeof amt === 'number' && amt > 0) {
      return formatCompactInr(amt, re.transactionType === 'rent' ? '/mo' : '');
    }
  }
  if (vs.price_inr !== undefined && vs.price_inr !== null && Number(vs.price_inr) > 0) {
    const period = String(vs.price_period || (vs.deal_type === 'sale' ? 'total' : 'monthly'));
    const suffix = period === 'monthly' ? '/mo' : period === 'yearly' ? '/yr' : '';
    return formatCompactInr(Number(vs.price_inr), suffix);
  }
  if (listing.realEstateDetails?.priceLabel) {
    return listing.realEstateDetails.priceLabel;
  }
  if (typeof listing.realEstateDetails?.askingPrice === 'number' && listing.realEstateDetails.askingPrice > 0) {
    return formatCompactInr(listing.realEstateDetails.askingPrice);
  }
  if (vs.min_rate_inr !== undefined && vs.min_rate_inr !== null && Number(vs.min_rate_inr) > 0) {
    const unit = String(vs.primary_unit || '');
    const suffix = unit === 'nightly' ? '/night' : unit === 'hourly' ? '/hr' : unit ? `/${unit}` : '';
    return `From ₹${Math.round(Number(vs.min_rate_inr)).toLocaleString('en-IN')}${suffix}`;
  }
  if (vs.starting_price !== undefined && vs.starting_price !== null && Number(vs.starting_price) > 0) {
    return `From ₹${Math.round(Number(vs.starting_price)).toLocaleString('en-IN')}`;
  }
  const catPrices = (listing.catalogueItems || [])
    .filter((i) => i && i.inStock !== false && typeof i.price === 'number' && i.price > 0)
    .map((i) => i.price as number);
  if (catPrices.length > 0) {
    return `From ₹${Math.min(...catPrices).toLocaleString('en-IN')}`;
  }
  const menuPrices = (listing.menuPreview || [])
    .filter((i) => i && typeof i.price === 'number' && i.price > 0)
    .map((i) => i.price as number);
  if (menuPrices.length > 0) {
    return `Menu from ₹${Math.min(...menuPrices).toLocaleString('en-IN')}`;
  }
  const venuePrices = (listing.venueSpaces || [])
    .filter((s) => s && typeof s.hourlyRate === 'number' && s.hourlyRate > 0)
    .map((s) => s.hourlyRate as number);
  if (venuePrices.length > 0) {
    return `From ₹${Math.min(...venuePrices).toLocaleString('en-IN')}/slot`;
  }
  const roomPrices = (listing.roomTypes || [])
    .filter((r) => r && typeof r.pricePerNight === 'number' && r.pricePerNight > 0)
    .map((r) => r.pricePerNight as number);
  if (roomPrices.length > 0) {
    return `From ₹${Math.min(...roomPrices).toLocaleString('en-IN')}/night`;
  }
  const svcPrices = (listing.services || [])
    .filter((s) => s && typeof s.price === 'number' && s.price > 0)
    .map((s) => s.price as number);
  if (svcPrices.length > 0) {
    return `From ₹${Math.min(...svcPrices).toLocaleString('en-IN')}`;
  }
  if (typeof listing.serviceDetails?.startingPrice === 'number' && listing.serviceDetails.startingPrice > 0) {
    return `From ₹${Math.round(listing.serviceDetails.startingPrice).toLocaleString('en-IN')}`;
  }
  if (typeof listing.price === 'number' && listing.price > 0) {
    return `From ₹${Math.round(listing.price).toLocaleString('en-IN')}`;
  }
  return null;
}

export function buildListingSharePayload(
  listing: ShareableListingInput,
  overrides?: Partial<SharePayload>
): SharePayload {
  const effectiveVertical = listing.root_key || listing.listing_vertical || listing.listingVertical;
  const verticalBadge = formatVerticalBadgeLabel(effectiveVertical, listing.category);
  const categoryLabel = listing.subcategory
    ? String(listing.subcategory).trim()
    : listing.category
      ? String(listing.category)
          .replace(/[_-]+/g, ' ')
          .replace(/\b\w/g, (c) => c.toUpperCase())
      : verticalBadge;
  const locality = listing.locality || listing.address || 'Churachandpur';
  const priceLabel = overrides?.priceLabel ?? overrides?.priceText ?? deriveListingPriceLabel(listing);
  const mediaPrimary = Array.isArray(listing.listingMedia)
    ? listing.listingMedia.find((m) => m?.url && m.media_type !== 'panorama_360')?.url || null
    : null;
  const imageUrl =
    overrides?.imageUrl ??
    listing.coverImage?.trim() ??
    (Array.isArray(listing.images) && listing.images.length > 0 ? listing.images[0] : null) ??
    (Array.isArray(listing.galleryImages) && listing.galleryImages.length > 0 ? listing.galleryImages[0] : null) ??
    mediaPrimary;
  const url = overrides?.url || `/listing/${encodeURIComponent(listing.id)}`;
  const cleanTitle = String(listing.title || 'DD oodle Listing').replace(/^\[SAMPLE\]\s*/i, '');
  const text =
    overrides?.text ||
    `Check out ${cleanTitle} (${verticalBadge}) in ${locality} on DD oodle`;
  const isVerified = Boolean(
    overrides?.isVerified ??
      overrides?.verified ??
      listing.isVerified ??
      listing.is_verified ??
      listing.verificationStatus === 'verified_demo'
  );

  return {
    title: cleanTitle,
    subtitle: overrides?.subtitle ?? listing.shortDescription ?? null,
    text,
    url,
    imageUrl,
    categoryLabel,
    verticalBadge,
    locality,
    priceLabel,
    rating: typeof listing.rating === 'number' && listing.rating > 0 ? listing.rating : null,
    isVerified,
    ...overrides,
  };
}

export function canUseNativeShare(): boolean {
  return (
    typeof navigator !== 'undefined' &&
    typeof navigator.share === 'function'
  );
}

/**
 * Explicitly triggers the OS native Web Share dialog (`navigator.share`).
 */
export async function triggerNativeShare(
  payload: SharePayload
): Promise<{ ok: boolean; method: ShareOutcome }> {
  const resolved = normalizeSharePayload(payload);
  if (!canUseNativeShare()) {
    return { ok: false, method: 'unsupported' };
  }
  try {
    const shareData: ShareData = {
      title: resolved.title,
    };
    if (resolved.text) shareData.text = resolved.text;
    if (resolved.url) shareData.url = resolved.url;

    await navigator.share(shareData);
    return { ok: true, method: 'native' };
  } catch (err) {
    if (
      err instanceof Error &&
      (err.name === 'AbortError' || /abort|cancel/i.test(err.message || ''))
    ) {
      return { ok: true, method: 'cancelled' };
    }
    return { ok: false, method: 'unsupported' };
  }
}

/**
 * Opens the rich `<ShareSheetModal />` prefilled with the item's visual
 * Share Preview Card (or triggers `navigator.share` directly only when
 * `preferNativeImmediate: true` is passed).
 */
export async function shareContent(
  payload: SharePayload,
  options?: {
    forceFallback?: boolean;
    preferNativeImmediate?: boolean;
    onFallback?: (resolved: ResolvedSharePayload) => void;
  }
): Promise<{ ok: boolean; method: ShareOutcome }> {
  const resolved = normalizeSharePayload(payload);

  if (options?.preferNativeImmediate && !options?.forceFallback && canUseNativeShare()) {
    const nativeRes = await triggerNativeShare(resolved);
    if (nativeRes.ok) {
      return nativeRes;
    }
  }

  if (options?.onFallback) {
    options.onFallback(resolved);
    return { ok: true, method: 'fallback' };
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(
      new CustomEvent<ResolvedSharePayload>(SHARE_SHEET_OPEN_EVENT, {
        detail: resolved,
      })
    );
    return { ok: true, method: 'fallback' };
  }

  return { ok: false, method: 'unsupported' };
}

