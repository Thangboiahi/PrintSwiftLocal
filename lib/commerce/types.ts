// =============================================================================
// Phase 74-A: Shop Catalogue Pro & Restaurants/Cafés TypeScript Contracts
// =============================================================================

export type CommercePaymentRail =
  | 'direct_counter'
  | 'direct_shop_upi'
  | 'platform_escrow';

export type CommercePaymentStatus =
  | 'unpaid'
  | 'pending_manual_review'
  | 'escrow_held'
  | 'paid_direct_confirmed'
  | 'refunded';

export type CommerceSettlementStatus =
  | 'not_applicable'
  | 'locked'
  | 'eligible'
  | 'settled'
  | 'reversed';

export interface CommercePaymentPolicy {
  allow_direct_pay: boolean;
  direct_pay_max_inr: number;
  allow_escrow: boolean;
  shop_upi_id: string | null;
  shop_upi_name: string | null;
  shop_upi_verified: boolean;
}

// -----------------------------------------------------------------------------
// 1. Shop Catalogue Pro (`shop_catalogue`)
// -----------------------------------------------------------------------------

export type ShopHandoverMode = 'counter_pickup' | 'pick_n_drop';

export type ShopOrderStatus =
  | 'pending_payment'
  | 'confirmed'
  | 'packing'
  | 'ready_for_pickup'
  | 'handed_to_rider'
  | 'completed'
  | 'cancelled';

export interface ListingShopProfile {
  listing_id: string;
  hub_id: string;
  is_accepting_orders: boolean;
  busy_until: string | null;
  allow_counter_pickup: boolean;
  allow_pick_n_drop: boolean;
  min_order_inr: number;
  packaging_fee_inr: number;
  prep_time_mins: number;
  payment_policy: CommercePaymentPolicy;
  store_verified: boolean;
  pickup_instructions: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface ShopOrderItemSnapshot {
  product_id: string;
  title: string;
  unit_label: string | null;
  qty: number;
  unit_price_inr: number;
  line_total_inr: number;
}

export interface ShopOrder {
  id: string;
  order_code: string;
  hub_id: string;
  listing_id: string;
  customer_id: string;
  items_snapshot: ShopOrderItemSnapshot[];
  subtotal_inr: number;
  packaging_fee_inr: number;
  delivery_fee_inr: number;
  total_amount_inr: number;
  handover_mode: ShopHandoverMode;
  linked_delivery_order_id: string | null;
  payment_rail: CommercePaymentRail;
  payment_intent_id: string | null;
  pickup_otp_hash?: string | null;
  pickup_otp_display_for_customer?: string | null;
  customer_note: string | null;
  dropoff_address: string | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  order_status: ShopOrderStatus;
  payment_status: CommercePaymentStatus;
  settlement_status: CommerceSettlementStatus;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

// -----------------------------------------------------------------------------
// 2. Restaurants, Cafés & Bakeries (`restaurant_food`)
// -----------------------------------------------------------------------------

export type MenuDietType = 'veg' | 'non_veg' | 'egg';
export type MenuMealSlot = 'all_day' | 'breakfast' | 'lunch' | 'dinner';
export type RestaurantFulfillmentMode = 'takeaway' | 'pick_n_drop';

export type RestaurantKitchenStatus =
  | 'pending_payment'
  | 'new_order'
  | 'preparing'
  | 'ready_for_pickup'
  | 'handed_to_rider'
  | 'completed'
  | 'rejected'
  | 'cancelled';

export type TableReservationStatus =
  | 'requested'
  | 'confirmed'
  | 'seated'
  | 'completed'
  | 'declined'
  | 'cancelled';

export interface MenuVariantOption {
  key: string;
  label: string;
  price_inr: number;
}

export interface MenuAddonOption {
  key: string;
  label: string;
  price_inr: number;
}

export interface ListingRestaurantProfile {
  listing_id: string;
  hub_id: string;
  cuisines: string[];
  avg_cost_for_two_inr: number;
  is_pure_veg: boolean;
  is_kitchen_open: boolean;
  kitchen_paused_until: string | null;
  prep_time_mins: number;
  allow_takeaway: boolean;
  allow_pick_n_drop: boolean;
  allow_table_booking: boolean;
  max_table_party_size: number;
  packaging_fee_inr: number;
  min_order_inr: number;
  fssai_license_no: string | null;
  fssai_verified: boolean;
  payment_policy: CommercePaymentPolicy;
  pickup_instructions: string | null;
  created_at?: string;
  updated_at?: string;
}

export interface RestaurantMenuItem {
  id: string;
  listing_id: string;
  hub_id: string;
  category_name: string;
  name: string;
  description: string | null;
  diet_type: MenuDietType;
  base_price_inr: number;
  variants: MenuVariantOption[];
  addons: MenuAddonOption[];
  meal_slot: MenuMealSlot;
  is_bestseller: boolean;
  is_spicy: boolean;
  in_stock: boolean;
  image_url: string | null;
  sort_order: number;
  created_at?: string;
  updated_at?: string;
}

export interface RestaurantOrderItemSnapshot {
  menu_item_id: string;
  name: string;
  diet_type: MenuDietType;
  variant_label?: string | null;
  addons?: Array<{ label: string; price_inr: number }>;
  qty: number;
  unit_price_inr: number;
  line_total_inr: number;
}

export interface RestaurantOrder {
  id: string;
  order_code: string;
  hub_id: string;
  listing_id: string;
  customer_id: string;
  items_snapshot: RestaurantOrderItemSnapshot[];
  subtotal_inr: number;
  packaging_fee_inr: number;
  delivery_fee_inr: number;
  total_amount_inr: number;
  fulfillment_mode: RestaurantFulfillmentMode;
  linked_delivery_order_id: string | null;
  payment_rail: CommercePaymentRail;
  payment_intent_id: string | null;
  estimated_prep_mins: number;
  pickup_otp_hash?: string | null;
  pickup_otp_display_for_customer?: string | null;
  cooking_instructions: string | null;
  dropoff_address: string | null;
  dropoff_lat: number | null;
  dropoff_lng: number | null;
  kitchen_status: RestaurantKitchenStatus;
  payment_status: CommercePaymentStatus;
  settlement_status: CommerceSettlementStatus;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RestaurantTableReservation {
  id: string;
  reservation_code: string;
  hub_id: string;
  listing_id: string;
  customer_id: string;
  guest_name: string;
  guest_phone: string | null;
  party_size: number;
  reserved_for: string;
  special_request: string | null;
  status: TableReservationStatus;
  created_at: string;
  updated_at: string;
}

export interface CommerceOrderQuote {
  vertical: 'shop_catalogue' | 'restaurant_food';
  listing_id: string;
  items_count: number;
  subtotal_inr: number;
  packaging_fee_inr: number;
  delivery_fee_inr: number;
  convenience_fee_inr: number;
  total_amount_inr: number;
  fulfillment_mode: ShopHandoverMode | RestaurantFulfillmentMode;
  payment_rail: CommercePaymentRail;
  requires_escrow: boolean;
  estimated_prep_mins: number;
  min_order_inr: number;
  meets_min_order: boolean;
}
