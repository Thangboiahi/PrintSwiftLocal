// =============================================================================
// Phase 74-B: Isolated Shop Catalogue & Restaurant/Café Pricing Engine
// Pure deterministic calculation with live stock & dual-rail escrow enforcement
// =============================================================================

import type {
  CommerceOrderQuote,
  CommercePaymentRail,
  ListingRestaurantProfile,
  ListingShopProfile,
  MenuAddonOption,
  MenuVariantOption,
  RestaurantFulfillmentMode,
  RestaurantMenuItem,
  RestaurantOrderItemSnapshot,
  ShopHandoverMode,
  ShopOrderItemSnapshot,
} from '@/lib/commerce/types';

export const DEFAULT_COMMERCE_CONVENIENCE_FEE_PCT = 0;

export class CommercePricingError extends Error {
  readonly statusCode: number;
  readonly code: string;

  constructor(
    message: string,
    statusCode = 400,
    code = 'COMMERCE_PRICING_ERROR'
  ) {
    super(message);
    this.name = 'CommercePricingError';
    this.statusCode = statusCode;
    this.code = code;
  }
}

export function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/**
 * Lightweight Haversine local delivery fee estimator for bundled Pick N Drop checkout.
 * Applies a 1.25x road factor on straight-line distance to stay consistent with hill routes.
 */
export function estimateLocalDeliveryFee(
  pickupLat: number,
  pickupLng: number,
  dropLat: number,
  dropLng: number,
  hubBaseFare = 40,
  perKmRate = 12
): { distanceKm: number; deliveryFeeInr: number } {
  if (
    !Number.isFinite(pickupLat) ||
    !Number.isFinite(pickupLng) ||
    !Number.isFinite(dropLat) ||
    !Number.isFinite(dropLng)
  ) {
    return {
      distanceKm: 1,
      deliveryFeeInr: Math.max(0, Math.round(hubBaseFare)),
    };
  }

  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(dropLat - pickupLat);
  const dLng = toRad(dropLng - pickupLng);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(pickupLat)) *
      Math.cos(toRad(dropLat)) *
      Math.sin(dLng / 2) ** 2;
  const straightKm = 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const roadKm = Math.max(0.5, round2(straightKm * 1.25));
  const rawFee =
    Math.max(0, Number(hubBaseFare || 40)) +
    Math.max(0, roadKm - 1) * Math.max(0, Number(perKmRate || 12));

  return {
    distanceKm: roadKm,
    deliveryFeeInr: Math.round(rawFee),
  };
}

// -----------------------------------------------------------------------------
// 1. Shop Catalogue Basket Quote (`shop_catalogue`)
// -----------------------------------------------------------------------------

export interface DbShopProductRow {
  id: string;
  listing_id: string;
  title: string;
  price: number;
  unit?: string | null;
  unit_label?: string | null;
  in_stock?: boolean | null;
  is_active?: boolean | null;
}

export interface RequestedShopBasketItem {
  productId: string;
  qty: number;
}

export interface ComputeShopBasketQuoteInput {
  profile: ListingShopProfile;
  dbProducts: DbShopProductRow[];
  requestedItems: RequestedShopBasketItem[];
  handoverMode: ShopHandoverMode;
  deliveryFeeInr?: number;
  requestedPaymentRail?: CommercePaymentRail | null;
}

export interface ShopBasketQuoteResult {
  quote: CommerceOrderQuote;
  itemsSnapshot: ShopOrderItemSnapshot[];
  allowedRails: CommercePaymentRail[];
}

export function computeShopBasketQuote(
  input: ComputeShopBasketQuoteInput
): ShopBasketQuoteResult {
  const {
    profile,
    dbProducts,
    requestedItems,
    handoverMode,
    deliveryFeeInr = 0,
    requestedPaymentRail = null,
  } = input;

  if (!profile.is_accepting_orders) {
    throw new CommercePricingError(
      'This store is currently paused and not accepting new orders.',
      409,
      'SHOP_PAUSED'
    );
  }

  if (
    profile.busy_until &&
    !Number.isNaN(Date.parse(profile.busy_until)) &&
    Date.parse(profile.busy_until) > Date.now()
  ) {
    throw new CommercePricingError(
      'This store is temporarily busy. Please try again shortly.',
      409,
      'SHOP_BUSY'
    );
  }

  if (handoverMode === 'counter_pickup' && !profile.allow_counter_pickup) {
    throw new CommercePricingError(
      'Counter pickup is disabled for this store.',
      400,
      'HANDOVER_MODE_UNAVAILABLE'
    );
  }

  if (handoverMode === 'pick_n_drop' && !profile.allow_pick_n_drop) {
    throw new CommercePricingError(
      'Pick N Drop doorstep delivery is disabled for this store.',
      400,
      'HANDOVER_MODE_UNAVAILABLE'
    );
  }

  if (!Array.isArray(requestedItems) || requestedItems.length === 0) {
    throw new CommercePricingError(
      'Your basket is empty. Add at least one item to place an order.',
      400,
      'EMPTY_BASKET'
    );
  }

  const productById = new Map<string, DbShopProductRow>();
  for (const prod of dbProducts) {
    productById.set(prod.id, prod);
  }

  const itemsSnapshot: ShopOrderItemSnapshot[] = [];
  let subtotalInr = 0;
  let totalItemCount = 0;

  for (const reqItem of requestedItems) {
    const prodId = String(reqItem.productId || '').trim();
    const qty = Math.floor(Number(reqItem.qty || 0));
    if (!prodId || !Number.isFinite(qty) || qty < 1 || qty > 50) {
      throw new CommercePricingError(
        'Each basket item must have a valid productId and quantity (1–50).',
        400,
        'INVALID_ITEM_QTY'
      );
    }

    const dbProd = productById.get(prodId);
    if (!dbProd || dbProd.listing_id !== profile.listing_id) {
      throw new CommercePricingError(
        'One or more items do not belong to this store.',
        400,
        'WRONG_LISTING_PRODUCT'
      );
    }

    if (dbProd.is_active === false || dbProd.in_stock === false) {
      throw new CommercePricingError(
        `"${dbProd.title}" is currently out of stock.`,
        400,
        'ITEM_OUT_OF_STOCK'
      );
    }

    const unitPrice = round2(Math.max(0, Number(dbProd.price || 0)));
    const lineTotal = round2(unitPrice * qty);
    subtotalInr = round2(subtotalInr + lineTotal);
    totalItemCount += qty;

    itemsSnapshot.push({
      product_id: dbProd.id,
      title: dbProd.title,
      unit_label: dbProd.unit_label || dbProd.unit || null,
      qty,
      unit_price_inr: unitPrice,
      line_total_inr: lineTotal,
    });
  }

  const minOrderInr = round2(Math.max(0, Number(profile.min_order_inr || 0)));
  const meetsMinOrder = subtotalInr >= minOrderInr;
  if (!meetsMinOrder) {
    throw new CommercePricingError(
      `Minimum order amount for this store is ₹${minOrderInr}.`,
      400,
      'MIN_ORDER_NOT_MET'
    );
  }

  const packagingFeeInr = round2(
    Math.max(0, Number(profile.packaging_fee_inr || 0))
  );
  const effectiveDeliveryFeeInr =
    handoverMode === 'pick_n_drop'
      ? round2(Math.max(0, Number(deliveryFeeInr || 0)))
      : 0;
  const totalAmountInr = round2(
    subtotalInr + packagingFeeInr + effectiveDeliveryFeeInr
  );

  // Dual-Rail Payment Policy Resolution
  const policy = profile.payment_policy || {
    allow_direct_pay: true,
    direct_pay_max_inr: 500,
    allow_escrow: true,
    shop_upi_id: null,
    shop_upi_name: null,
    shop_upi_verified: false,
  };
  const directPayMax = Math.max(0, Number(policy.direct_pay_max_inr ?? 500));
  const requiresEscrow =
    handoverMode === 'pick_n_drop' ||
    !policy.allow_direct_pay ||
    totalAmountInr > directPayMax;

  const allowedRails: CommercePaymentRail[] = ['platform_escrow'];
  if (!requiresEscrow) {
    allowedRails.push('direct_counter');
    if (policy.shop_upi_id && policy.shop_upi_id.trim()) {
      allowedRails.push('direct_shop_upi');
    }
  }

  const resolvedRail: CommercePaymentRail =
    requiresEscrow || !requestedPaymentRail
      ? requiresEscrow
        ? 'platform_escrow'
        : 'direct_counter'
      : allowedRails.includes(requestedPaymentRail)
        ? requestedPaymentRail
        : 'platform_escrow';

  return {
    quote: {
      vertical: 'shop_catalogue',
      listing_id: profile.listing_id,
      items_count: totalItemCount,
      subtotal_inr: subtotalInr,
      packaging_fee_inr: packagingFeeInr,
      delivery_fee_inr: effectiveDeliveryFeeInr,
      convenience_fee_inr: 0,
      total_amount_inr: totalAmountInr,
      fulfillment_mode: handoverMode,
      payment_rail: resolvedRail,
      requires_escrow: requiresEscrow,
      estimated_prep_mins: Math.max(5, Number(profile.prep_time_mins || 15)),
      min_order_inr: minOrderInr,
      meets_min_order: meetsMinOrder,
    },
    itemsSnapshot,
    allowedRails,
  };
}

// -----------------------------------------------------------------------------
// 2. Restaurant & Café Basket Quote (`restaurant_food`)
// -----------------------------------------------------------------------------

export interface RequestedRestaurantBasketItem {
  menuItemId: string;
  qty: number;
  variantKey?: string | null;
  addonKeys?: string[];
}

export interface ComputeRestaurantBasketQuoteInput {
  profile: ListingRestaurantProfile;
  dbMenuItems: RestaurantMenuItem[];
  requestedItems: RequestedRestaurantBasketItem[];
  fulfillmentMode: RestaurantFulfillmentMode;
  deliveryFeeInr?: number;
  requestedPaymentRail?: CommercePaymentRail | null;
}

export interface RestaurantBasketQuoteResult {
  quote: CommerceOrderQuote;
  itemsSnapshot: RestaurantOrderItemSnapshot[];
  allowedRails: CommercePaymentRail[];
}

export function computeRestaurantBasketQuote(
  input: ComputeRestaurantBasketQuoteInput
): RestaurantBasketQuoteResult {
  const {
    profile,
    dbMenuItems,
    requestedItems,
    fulfillmentMode,
    deliveryFeeInr = 0,
    requestedPaymentRail = null,
  } = input;

  if (!profile.is_kitchen_open) {
    throw new CommercePricingError(
      'This kitchen is currently closed and not accepting orders.',
      409,
      'KITCHEN_CLOSED'
    );
  }

  if (
    profile.kitchen_paused_until &&
    !Number.isNaN(Date.parse(profile.kitchen_paused_until)) &&
    Date.parse(profile.kitchen_paused_until) > Date.now()
  ) {
    throw new CommercePricingError(
      'This kitchen is temporarily paused due to high rush. Please check back shortly.',
      409,
      'KITCHEN_PAUSED'
    );
  }

  if (fulfillmentMode === 'takeaway' && !profile.allow_takeaway) {
    throw new CommercePricingError(
      'Takeaway pickup is currently disabled by this restaurant.',
      400,
      'FULFILLMENT_MODE_UNAVAILABLE'
    );
  }

  if (fulfillmentMode === 'pick_n_drop' && !profile.allow_pick_n_drop) {
    throw new CommercePricingError(
      'Hot-food Pick N Drop delivery is disabled by this restaurant.',
      400,
      'FULFILLMENT_MODE_UNAVAILABLE'
    );
  }

  if (!Array.isArray(requestedItems) || requestedItems.length === 0) {
    throw new CommercePricingError(
      'Your food cart is empty. Add at least one dish to order.',
      400,
      'EMPTY_BASKET'
    );
  }

  const menuById = new Map<string, RestaurantMenuItem>();
  for (const item of dbMenuItems) {
    menuById.set(item.id, item);
  }

  const itemsSnapshot: RestaurantOrderItemSnapshot[] = [];
  let subtotalInr = 0;
  let totalItemCount = 0;

  for (const reqItem of requestedItems) {
    const itemId = String(reqItem.menuItemId || '').trim();
    const qty = Math.floor(Number(reqItem.qty || 0));
    if (!itemId || !Number.isFinite(qty) || qty < 1 || qty > 30) {
      throw new CommercePricingError(
        'Each dish must have a valid menuItemId and quantity (1–30).',
        400,
        'INVALID_ITEM_QTY'
      );
    }

    const dbItem = menuById.get(itemId);
    if (!dbItem || dbItem.listing_id !== profile.listing_id) {
      throw new CommercePricingError(
        'One or more dishes do not belong to this restaurant.',
        400,
        'WRONG_LISTING_MENU_ITEM'
      );
    }

    if (!dbItem.in_stock) {
      throw new CommercePricingError(
        `"${dbItem.name}" just sold out! Please remove it from your basket.`,
        400,
        'MENU_ITEM_SOLD_OUT'
      );
    }

    // Resolve variant price (if variants exist and variantKey supplied)
    let unitBasePrice = Math.max(0, Number(dbItem.base_price_inr || 0));
    let variantLabel: string | null = null;
    const variants: MenuVariantOption[] = Array.isArray(dbItem.variants)
      ? dbItem.variants
      : [];

    if (reqItem.variantKey && variants.length > 0) {
      const matched = variants.find((v) => v.key === reqItem.variantKey);
      if (!matched) {
        throw new CommercePricingError(
          `Invalid portion/variant selected for "${dbItem.name}".`,
          400,
          'INVALID_VARIANT'
        );
      }
      unitBasePrice = Math.max(0, Number(matched.price_inr || 0));
      variantLabel = matched.label;
    }

    // Resolve selected add-ons
    const dbAddons: MenuAddonOption[] = Array.isArray(dbItem.addons)
      ? dbItem.addons
      : [];
    const addonMap = new Map<string, MenuAddonOption>(
      dbAddons.map((a) => [a.key, a])
    );
    const chosenAddons: Array<{ label: string; price_inr: number }> = [];
    let addonsUnitSum = 0;

    if (Array.isArray(reqItem.addonKeys)) {
      const seen = new Set<string>();
      for (const k of reqItem.addonKeys) {
        const cleanK = String(k || '').trim();
        if (!cleanK || seen.has(cleanK)) continue;
        const found = addonMap.get(cleanK);
        if (found) {
          seen.add(cleanK);
          const p = Math.max(0, Number(found.price_inr || 0));
          addonsUnitSum = round2(addonsUnitSum + p);
          chosenAddons.push({ label: found.label, price_inr: p });
        }
      }
    }

    const unitPriceInr = round2(unitBasePrice + addonsUnitSum);
    const lineTotalInr = round2(unitPriceInr * qty);
    subtotalInr = round2(subtotalInr + lineTotalInr);
    totalItemCount += qty;

    itemsSnapshot.push({
      menu_item_id: dbItem.id,
      name: dbItem.name,
      diet_type: dbItem.diet_type,
      variant_label: variantLabel,
      addons: chosenAddons.length > 0 ? chosenAddons : undefined,
      qty,
      unit_price_inr: unitPriceInr,
      line_total_inr: lineTotalInr,
    });
  }

  const minOrderInr = round2(Math.max(0, Number(profile.min_order_inr || 0)));
  const meetsMinOrder = subtotalInr >= minOrderInr;
  if (!meetsMinOrder) {
    throw new CommercePricingError(
      `Minimum order amount for this kitchen is ₹${minOrderInr}.`,
      400,
      'MIN_ORDER_NOT_MET'
    );
  }

  const packagingFeeInr = round2(
    Math.max(0, Number(profile.packaging_fee_inr || 0))
  );
  const effectiveDeliveryFeeInr =
    fulfillmentMode === 'pick_n_drop'
      ? round2(Math.max(0, Number(deliveryFeeInr || 0)))
      : 0;
  const totalAmountInr = round2(
    subtotalInr + packagingFeeInr + effectiveDeliveryFeeInr
  );

  // Dual-Rail Policy: Mandatory Platform Escrow for hot-food Pick N Drop delivery
  const policy = profile.payment_policy || {
    allow_direct_pay: true,
    direct_pay_max_inr: 400,
    allow_escrow: true,
    shop_upi_id: null,
    shop_upi_name: null,
    shop_upi_verified: false,
  };
  const directPayMax = Math.max(0, Number(policy.direct_pay_max_inr ?? 400));
  const requiresEscrow =
    fulfillmentMode === 'pick_n_drop' ||
    !policy.allow_direct_pay ||
    totalAmountInr > directPayMax;

  const allowedRails: CommercePaymentRail[] = ['platform_escrow'];
  if (!requiresEscrow) {
    allowedRails.push('direct_counter');
    if (policy.shop_upi_id && policy.shop_upi_id.trim()) {
      allowedRails.push('direct_shop_upi');
    }
  }

  const resolvedRail: CommercePaymentRail =
    requiresEscrow || !requestedPaymentRail
      ? requiresEscrow
        ? 'platform_escrow'
        : 'direct_counter'
      : allowedRails.includes(requestedPaymentRail)
        ? requestedPaymentRail
        : 'platform_escrow';

  return {
    quote: {
      vertical: 'restaurant_food',
      listing_id: profile.listing_id,
      items_count: totalItemCount,
      subtotal_inr: subtotalInr,
      packaging_fee_inr: packagingFeeInr,
      delivery_fee_inr: effectiveDeliveryFeeInr,
      convenience_fee_inr: 0,
      total_amount_inr: totalAmountInr,
      fulfillment_mode: fulfillmentMode,
      payment_rail: resolvedRail,
      requires_escrow: requiresEscrow,
      estimated_prep_mins: Math.max(5, Number(profile.prep_time_mins || 25)),
      min_order_inr: minOrderInr,
      meets_min_order: meetsMinOrder,
    },
    itemsSnapshot,
    allowedRails,
  };
}
