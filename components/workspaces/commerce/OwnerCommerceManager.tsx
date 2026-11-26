'use client';

import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  BadgeCheck,
  CalendarDays,
  Check,
  CheckCircle2,
  ChefHat,
  Clock,
  Crown,
  Edit3,
  Flame,
  KeyRound,
  Loader2,
  PauseCircle,
  PlayCircle,
  Plus,
  QrCode,
  RefreshCw,
  Save,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Store,
  Trash2,
  UtensilsCrossed,
  Wallet,
  X,
} from 'lucide-react';
import { UniversalPaymentModal } from '@/components/payments/UniversalPaymentModal';
import { useConfirmDialog } from '@/components/ui/ConfirmActionModal';
import { CustomSelectModal } from '@/components/ui/CustomSelectModal';
import { FormModal } from '@/components/ui/FormModal';
import {
  ResponsiveTableScroll,
  WorkspaceTableToolbar,
} from '@/components/ui/ResponsiveTableWrapper';
import { CommerceQrPosterModal } from '@/components/workspaces/commerce/CommerceQrPosterModal';
import {
  QuickImageUploadField,
  discardUploadedTempPaths,
} from '@/components/workspaces/shared/QuickImageUploadField';
import { useAuth } from '@/lib/store';
import type {
  ListingRestaurantProfile,
  ListingShopProfile,
  MenuAddonOption,
  MenuDietType,
  MenuMealSlot,
  MenuVariantOption,
  RestaurantMenuItem,
  RestaurantOrder,
  RestaurantTableReservation,
  ShopOrder,
} from '@/lib/commerce/types';
import { useAppStatus } from '@/lib/hooks/useAppStatus';
import { useRealtimeTableRefresh } from '@/lib/hooks/useRealtimeTableRefresh';
import type { PaymentIntentRecord } from '@/lib/payments/types';
import { getLimit } from '@/lib/subscriptions/feature-catalog';
import { useEffectiveEntitlements } from '@/lib/subscriptions/useEffectiveEntitlements';
import { isSupabaseConfigured, supabase } from '@/lib/supabase/client';

export interface CommerceListingOption {
  id: string;
  title: string;
  locality?: string;
  hubId?: string | null;
  hub_id?: string | null;
  listing_vertical?: string | null;
}

export interface OwnerCommerceManagerProps {
  listings: CommerceListingOption[];
  activeListingId?: string;
  isStaffMode?: boolean;
}

interface SubPlanRow {
  id: string;
  slug: string;
  name: string;
  plan_scope: string;
  price_inr: number;
  duration_days: number;
  description?: string | null;
}

interface MarketplaceStockRow {
  id: string;
  listing_id: string;
  title: string;
  description?: string | null;
  category?: string | null;
  price: number;
  unit: string | null;
  unit_label: string | null;
  shop_category_tag: string | null;
  thumbnail_url?: string | null;
  stock_count?: number | null;
  sku_variant_note?: string | null;
  supports_pick_n_drop?: boolean | null;
  in_stock: boolean;
  is_active: boolean;
}

interface ShopProductDraft {
  id?: string;
  title: string;
  description: string;
  category: string;
  shop_category_tag: string;
  price: string;
  unit: string;
  unit_label: string;
  stock_count: string;
  sku_variant_note: string;
  supports_pick_n_drop: boolean;
  in_stock: boolean;
  thumbnail_url: string;
}

const EMPTY_SHOP_PRODUCT_DRAFT: ShopProductDraft = {
  title: '',
  description: '',
  category: 'Groceries & Daily',
  shop_category_tag: 'Groceries & Daily',
  price: '99',
  unit: 'Piece',
  unit_label: '1 Piece',
  stock_count: '',
  sku_variant_note: '',
  supports_pick_n_drop: true,
  in_stock: true,
  thumbnail_url: '',
};

const DISH_CATEGORY_OPTIONS = [
  { value: 'Starters', label: 'Starters & Appetizers' },
  { value: 'Mains', label: 'Main Course' },
  { value: 'Breads & Rice', label: 'Breads, Rice & Noodles' },
  { value: 'Snacks & Momos', label: 'Snacks, Momos & Rolls' },
  { value: 'Combos & Thalis', label: 'Combos & Thalis' },
  { value: 'Desserts', label: 'Desserts & Sweets' },
  { value: 'Beverages', label: 'Tea, Coffee & Beverages' },
];

const SHOP_CATEGORY_OPTIONS = [
  { value: 'Groceries & Daily', label: 'Groceries & Daily Essentials' },
  { value: 'Pharmacy & Wellness', label: 'Pharmacy & Wellness' },
  { value: 'Bakery & Snacks', label: 'Bakery, Sweets & Snacks' },
  { value: 'Electronics & Accessories', label: 'Electronics & Accessories' },
  { value: 'Stationery & Books', label: 'Stationery, Office & Books' },
  { value: 'Fashion & Apparel', label: 'Fashion & Apparel' },
  { value: 'Home & Hardware', label: 'Home, Kitchen & Hardware' },
  { value: 'General', label: 'General Merchandise' },
];

const SHOP_UNIT_OPTIONS = [
  { value: 'Piece', label: 'Piece (1 Pc)' },
  { value: 'Pack', label: 'Pack / Pouch' },
  { value: 'Kg', label: '1 Kilogram (Kg)' },
  { value: '500g', label: '500 Grams' },
  { value: '250g', label: '250 Grams' },
  { value: 'Litre', label: '1 Litre (L)' },
  { value: '500ml', label: '500 ml' },
  { value: 'Box', label: 'Box / Carton' },
  { value: 'Dozen', label: 'Dozen (12 Pcs)' },
  { value: 'Set', label: 'Complete Set' },
];

interface SettlementRow {
  id: string;
  settlement_source: string;
  gross_amount_inr: number;
  platform_fee_inr: number;
  net_payout_inr: number;
  status: string;
  utr_reference: string | null;
  paid_at: string | null;
  created_at: string;
}

type RestaurantSubTab = 'kitchen' | 'menu' | 'tables' | 'setup';
type ShopSubTab = 'orders' | 'stock' | 'setup';

interface DishDraft {
  id?: string;
  category_name: string;
  name: string;
  description: string;
  diet_type: MenuDietType;
  base_price_inr: string;
  meal_slot: MenuMealSlot;
  spice_level: 'mild' | 'medium' | 'hot';
  prep_time_mins: string;
  portion_note: string;
  image_url: string;
  is_bestseller: boolean;
  is_spicy: boolean;
  in_stock: boolean;
  variants: MenuVariantOption[];
  addons: MenuAddonOption[];
}

const EMPTY_DISH_DRAFT: DishDraft = {
  category_name: 'Mains',
  name: '',
  description: '',
  diet_type: 'veg',
  base_price_inr: '120',
  meal_slot: 'all_day',
  spice_level: 'mild',
  prep_time_mins: '15',
  portion_note: '',
  image_url: '',
  is_bestseller: false,
  is_spicy: false,
  in_stock: true,
  variants: [],
  addons: [],
};

function formatInr(amount: number): string {
  return `₹${Math.round(Number(amount || 0)).toLocaleString('en-IN')}`;
}

export function OwnerCommerceManager({
  listings,
  activeListingId,
  isStaffMode = false,
}: OwnerCommerceManagerProps) {
  const { setStatus } = useAppStatus();
  const { user } = useAuth();
  const { confirm, dialog: confirmDialog } = useConfirmDialog();

  const [enrichedListings, setEnrichedListings] = useState<
    Array<{
      id: string;
      title: string;
      locality: string;
      hub_id: string | null;
      listing_vertical: string;
    }>
  >([]);
  const [selectedListingId, setSelectedListingId] = useState<string>(
    activeListingId || ''
  );

  const [hasEntitlement, setHasEntitlement] = useState<boolean>(true);
  const [plans, setPlans] = useState<SubPlanRow[]>([]);
  const [subscribingPlanId, setSubscribingPlanId] = useState<string | null>(
    null
  );
  const [activePaymentIntent, setActivePaymentIntent] =
    useState<PaymentIntentRecord | null>(null);
  const [paymentModalMeta, setPaymentModalMeta] = useState({
    title: 'Upgrade Plan',
    subtitle: '',
  });

  // Active sub-tabs
  const [restaurantTab, setRestaurantTab] =
    useState<RestaurantSubTab>('kitchen');
  const [shopTab, setShopTab] = useState<ShopSubTab>('orders');

  // Restaurant state
  const [restaurantProfile, setRestaurantProfile] =
    useState<ListingRestaurantProfile | null>(null);
  const [restaurantOrders, setRestaurantOrders] = useState<RestaurantOrder[]>(
    []
  );
  const [menuItems, setMenuItems] = useState<RestaurantMenuItem[]>([]);
  const [tableReservations, setTableReservations] = useState<
    RestaurantTableReservation[]
  >([]);

  // Shop state
  const [shopProfile, setShopProfile] = useState<ListingShopProfile | null>(
    null
  );
  const [shopOrders, setShopOrders] = useState<ShopOrder[]>([]);
  const [stockProducts, setStockProducts] = useState<MarketplaceStockRow[]>([]);
  const [stockDrafts, setStockDrafts] = useState<
    Record<string, { unit_label: string; shop_category_tag: string }>
  >({});

  // Settlements
  const [settlements, setSettlements] = useState<SettlementRow[]>([]);

  // Search & filter states
  const [orderSearch, setOrderSearch] = useState('');
  const [orderStatusFilter, setOrderStatusFilter] = useState('all');
  const [menuSearch, setMenuSearch] = useState('');
  const [tableSearch, setTableSearch] = useState('');
  const [tableStatusFilter, setTableStatusFilter] = useState('all');
  const [stockSearch, setStockSearch] = useState('');

  // Inline OTP verification inputs keyed by orderId
  const [otpInputs, setOtpInputs] = useState<Record<string, string>>({});
  const [directCollectedMap, setDirectCollectedMap] = useState<
    Record<string, boolean>
  >({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [cancelReasonModal, setCancelReasonModal] = useState<{
    kind: 'restaurant' | 'shop';
    orderId: string;
  } | null>(null);
  const [cancelReasonText, setCancelReasonText] = useState('');
  const [cancelReasonTouched, setCancelReasonTouched] = useState(false);
  const [cancelReasonSubmitted, setCancelReasonSubmitted] = useState(false);
  const [isSavingSetup, setIsSavingSetup] = useState(false);
  const [isInitializing, setIsInitializing] = useState(false);

  // Modals (z-[90])
  const [isQrOpen, setIsQrOpen] = useState(false);
  const [isDishModalOpen, setIsDishModalOpen] = useState(false);
  const [dishDraft, setDishDraft] = useState<DishDraft>(EMPTY_DISH_DRAFT);
  const [isSavingDish, setIsSavingDish] = useState(false);
  const [dishTempPaths, setDishTempPaths] = useState<string[]>([]);

  const [isProductModalOpen, setIsProductModalOpen] = useState(false);
  const [productDraft, setProductDraft] = useState<ShopProductDraft>(
    EMPTY_SHOP_PRODUCT_DRAFT
  );
  const [isSavingProduct, setIsSavingProduct] = useState(false);
  const [productTempPaths, setProductTempPaths] = useState<string[]>([]);

  // Setup form drafts
  const [cuisinesInput, setCuisinesInput] = useState('');
  const [shopSetupDraft, setShopSetupDraft] = useState({
    is_accepting_orders: true,
    allow_counter_pickup: true,
    allow_pick_n_drop: true,
    min_order_inr: '0',
    packaging_fee_inr: '0',
    prep_time_mins: '20',
    pickup_instructions: '',
    allow_direct_pay: true,
    direct_pay_max_inr: '500',
    shop_upi_id: '',
    shop_upi_name: '',
  });
  const [restSetupDraft, setRestSetupDraft] = useState({
    avg_cost_for_two_inr: '350',
    is_pure_veg: false,
    allow_takeaway: true,
    allow_pick_n_drop: true,
    allow_table_booking: true,
    max_table_party_size: '8',
    packaging_fee_inr: '15',
    min_order_inr: '100',
    fssai_license_no: '',
    pickup_instructions: '',
    allow_direct_pay: true,
    direct_pay_max_inr: '400',
    shop_upi_id: '',
    shop_upi_name: '',
  });

  // Fetch listing verticals for passed listings
  useEffect(() => {
    let active = true;
    async function loadListingMeta() {
      if (!listings.length) {
        if (active) {
          setEnrichedListings([]);
          setSelectedListingId('');
          setIsLoading(false);
        }
        return;
      }

      const ids = listings.map((l) => l.id).filter(Boolean);
      let verticalById = new Map<
        string,
        { listing_vertical: string; hub_id: string | null; locality: string }
      >();

      if (isSupabaseConfigured() && ids.length > 0) {
        const { data } = await supabase
          .from('listings')
          .select('id, listing_vertical, hub_id, locality')
          .in('id', ids);
        if (Array.isArray(data)) {
          for (const r of data as Array<Record<string, unknown>>) {
            verticalById.set(String(r.id), {
              listing_vertical: String(r.listing_vertical || 'standard'),
              hub_id: r.hub_id ? String(r.hub_id) : null,
              locality: String(r.locality || ''),
            });
          }
        }
      }

      const mapped = listings.map((l) => {
        const dbMeta = verticalById.get(l.id);
        return {
          id: l.id,
          title: l.title,
          locality: dbMeta?.locality || l.locality || '',
          hub_id: dbMeta?.hub_id || l.hub_id || l.hubId || null,
          listing_vertical:
            dbMeta?.listing_vertical || l.listing_vertical || 'standard',
        };
      });

      // Sort commerce listings first
      mapped.sort((a, b) => {
        const aComm =
          a.listing_vertical === 'restaurant_food' ||
          a.listing_vertical === 'shop_catalogue'
            ? 0
            : 1;
        const bComm =
          b.listing_vertical === 'restaurant_food' ||
          b.listing_vertical === 'shop_catalogue'
            ? 0
            : 1;
        return aComm - bComm;
      });

      if (!active) return;
      setEnrichedListings(mapped);
      setSelectedListingId((prev) => {
        if (prev && mapped.some((m) => m.id === prev)) return prev;
        if (activeListingId && mapped.some((m) => m.id === activeListingId)) {
          return activeListingId;
        }
        return mapped[0]?.id || '';
      });
    }
    void loadListingMeta();
    return () => {
      active = false;
    };
  }, [listings, activeListingId]);

  const selectedListing = useMemo(
    () => enrichedListings.find((l) => l.id === selectedListingId) || null,
    [enrichedListings, selectedListingId]
  );

  const { entitlements } = useEffectiveEntitlements(
    user?.id,
    selectedListing?.id || null
  );
  const maxMenuItemsLimit = getLimit(entitlements, 'max_menu_items');
  const maxCatalogueItemsLimit = getLimit(entitlements, 'max_catalogue_items');

  const isRestaurant = selectedListing?.listing_vertical === 'restaurant_food';
  const isShop = selectedListing?.listing_vertical === 'shop_catalogue';

  // Fetch all data for the selected listing
  const loadCommerceData = useCallback(async () => {
    if (!selectedListing || !isSupabaseConfigured()) {
      setIsLoading(false);
      return;
    }
    const vert = selectedListing.listing_vertical;
    if (vert !== 'restaurant_food' && vert !== 'shop_catalogue') {
      setRestaurantProfile(null);
      setShopProfile(null);
      setIsLoading(false);
      return;
    }

    setIsLoading(true);
    try {
      const [entRes, plansRes, settlementsRes] = await Promise.all([
        supabase.rpc('has_active_commerce_entitlement', {
          p_listing_id: selectedListing.id,
          p_vertical: vert,
        }),
        !isStaffMode
          ? supabase
              .from('subscription_plans')
              .select('id, slug, name, plan_scope, price_inr, duration_days, description')
              .in('plan_scope', [
                vert === 'restaurant_food' ? 'restaurant_pro' : 'catalogue_pro',
                'merchant_all_in_one',
              ])
              .eq('is_active', true)
              .order('price_inr', { ascending: true })
          : Promise.resolve({ data: null }),
        !isStaffMode
          ? supabase
              .from('merchant_settlements')
              .select(
                'id, settlement_source, gross_amount_inr, platform_fee_inr, net_payout_inr, status, utr_reference, paid_at, created_at'
              )
              .eq('listing_id', selectedListing.id)
              .eq(
                'settlement_source',
                vert === 'restaurant_food' ? 'restaurant_order' : 'shop_order'
              )
              .order('created_at', { ascending: false })
              .limit(40)
          : Promise.resolve({ data: null }),
      ]);

      setHasEntitlement(entRes.data === true);
      setPlans(
        Array.isArray(plansRes.data)
          ? (plansRes.data as SubPlanRow[]).map((p) => ({
              ...p,
              price_inr: Number(p.price_inr || 0),
              duration_days: Number(p.duration_days || 30),
            }))
          : []
      );
      setSettlements(
        Array.isArray(settlementsRes.data)
          ? (settlementsRes.data as SettlementRow[]).map((s) => ({
              ...s,
              gross_amount_inr: Number(s.gross_amount_inr || 0),
              platform_fee_inr: Number(s.platform_fee_inr || 0),
              net_payout_inr: Number(s.net_payout_inr || 0),
            }))
          : []
      );

      if (vert === 'restaurant_food') {
        const [profRes, ordRes, menuRes, tabRes] = await Promise.all([
          supabase
            .from('listing_restaurant_profiles')
            .select('*')
            .eq('listing_id', selectedListing.id)
            .maybeSingle(),
          supabase
            .from('restaurant_orders')
            .select('*')
            .eq('listing_id', selectedListing.id)
            .order('created_at', { ascending: false })
            .limit(60),
          supabase
            .from('restaurant_menu_items')
            .select('*')
            .eq('listing_id', selectedListing.id)
            .order('sort_order', { ascending: true })
            .order('name', { ascending: true }),
          supabase
            .from('restaurant_table_reservations')
            .select('*')
            .eq('listing_id', selectedListing.id)
            .order('reserved_for', { ascending: true })
            .limit(60),
        ]);

        const prof = profRes.data as ListingRestaurantProfile | null;
        setRestaurantProfile(prof);
        if (prof) {
          setCuisinesInput(
            Array.isArray(prof.cuisines) ? prof.cuisines.join(', ') : ''
          );
          const pol = prof.payment_policy || {
            allow_direct_pay: true,
            direct_pay_max_inr: 400,
            shop_upi_id: null,
            shop_upi_name: null,
            shop_upi_verified: false,
          };
          setRestSetupDraft({
            avg_cost_for_two_inr: String(prof.avg_cost_for_two_inr ?? 350),
            is_pure_veg: Boolean(prof.is_pure_veg),
            allow_takeaway: prof.allow_takeaway !== false,
            allow_pick_n_drop: prof.allow_pick_n_drop !== false,
            allow_table_booking: prof.allow_table_booking !== false,
            max_table_party_size: String(prof.max_table_party_size ?? 8),
            packaging_fee_inr: String(prof.packaging_fee_inr ?? 0),
            min_order_inr: String(prof.min_order_inr ?? 0),
            fssai_license_no: prof.fssai_license_no || '',
            pickup_instructions: prof.pickup_instructions || '',
            allow_direct_pay: pol.allow_direct_pay !== false,
            direct_pay_max_inr: String(pol.direct_pay_max_inr ?? 400),
            shop_upi_id: pol.shop_upi_id || '',
            shop_upi_name: pol.shop_upi_name || '',
          });
        }

        setRestaurantOrders(
          Array.isArray(ordRes.data)
            ? (ordRes.data as RestaurantOrder[]).map((o) => ({
                ...o,
                subtotal_inr: Number(o.subtotal_inr || 0),
                packaging_fee_inr: Number(o.packaging_fee_inr || 0),
                delivery_fee_inr: Number(o.delivery_fee_inr || 0),
                total_amount_inr: Number(o.total_amount_inr || 0),
                items_snapshot: Array.isArray(o.items_snapshot)
                  ? o.items_snapshot
                  : [],
              }))
            : []
        );
        setMenuItems(
          Array.isArray(menuRes.data)
            ? (menuRes.data as RestaurantMenuItem[]).map((m) => ({
                ...m,
                base_price_inr: Number(m.base_price_inr || 0),
                variants: Array.isArray(m.variants) ? m.variants : [],
                addons: Array.isArray(m.addons) ? m.addons : [],
              }))
            : []
        );
        setTableReservations(
          Array.isArray(tabRes.data)
            ? (tabRes.data as RestaurantTableReservation[])
            : []
        );
      } else {
        const [profRes, ordRes, prodRes] = await Promise.all([
          supabase
            .from('listing_shop_profiles')
            .select('*')
            .eq('listing_id', selectedListing.id)
            .maybeSingle(),
          supabase
            .from('shop_orders')
            .select('*')
            .eq('listing_id', selectedListing.id)
            .order('created_at', { ascending: false })
            .limit(60),
          supabase
            .from('marketplace_products')
            .select('*')
            .eq('listing_id', selectedListing.id)
            .order('sort_order', { ascending: true })
            .order('title', { ascending: true }),
        ]);

        const prof = profRes.data as ListingShopProfile | null;
        setShopProfile(prof);
        if (prof) {
          const pol = prof.payment_policy || {
            allow_direct_pay: true,
            direct_pay_max_inr: 500,
            shop_upi_id: null,
            shop_upi_name: null,
            shop_upi_verified: false,
          };
          setShopSetupDraft({
            is_accepting_orders: prof.is_accepting_orders !== false,
            allow_counter_pickup: prof.allow_counter_pickup !== false,
            allow_pick_n_drop: prof.allow_pick_n_drop !== false,
            min_order_inr: String(prof.min_order_inr ?? 0),
            packaging_fee_inr: String(prof.packaging_fee_inr ?? 0),
            prep_time_mins: String(prof.prep_time_mins ?? 20),
            pickup_instructions: prof.pickup_instructions || '',
            allow_direct_pay: pol.allow_direct_pay !== false,
            direct_pay_max_inr: String(pol.direct_pay_max_inr ?? 500),
            shop_upi_id: pol.shop_upi_id || '',
            shop_upi_name: pol.shop_upi_name || '',
          });
        }

        setShopOrders(
          Array.isArray(ordRes.data)
            ? (ordRes.data as ShopOrder[]).map((o) => ({
                ...o,
                subtotal_inr: Number(o.subtotal_inr || 0),
                packaging_fee_inr: Number(o.packaging_fee_inr || 0),
                delivery_fee_inr: Number(o.delivery_fee_inr || 0),
                total_amount_inr: Number(o.total_amount_inr || 0),
                items_snapshot: Array.isArray(o.items_snapshot)
                  ? o.items_snapshot
                  : [],
              }))
            : []
        );

        const prods = Array.isArray(prodRes.data)
          ? (prodRes.data as MarketplaceStockRow[]).map((p) => ({
              ...p,
              price: Number(p.price || 0),
              in_stock: p.in_stock !== false,
            }))
          : [];
        setStockProducts(prods);
        const draftMap: Record<
          string,
          { unit_label: string; shop_category_tag: string }
        > = {};
        for (const p of prods) {
          draftMap[p.id] = {
            unit_label: p.unit_label || p.unit || '',
            shop_category_tag: p.shop_category_tag || '',
          };
        }
        setStockDrafts(draftMap);
      }
    } finally {
      setIsLoading(false);
    }
  }, [selectedListing, isStaffMode]);

  const [nowMs, setNowMs] = useState<number>(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setNowMs(Date.now());
      void loadCommerceData();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadCommerceData]);

  // Pass R6: Lightweight Realtime auto-refresh for incoming shop & kitchen orders
  useRealtimeTableRefresh('restaurant_orders', () => void loadCommerceData(), {
    enabled: Boolean(selectedListingId),
    filter: selectedListingId ? `listing_id=eq.${selectedListingId}` : undefined,
  });
  useRealtimeTableRefresh('shop_orders', () => void loadCommerceData(), {
    enabled: Boolean(selectedListingId),
    filter: selectedListingId ? `listing_id=eq.${selectedListingId}` : undefined,
  });

  // Initialize general listing as shop or restaurant
  const handleInitializeVertical = async (
    target: 'shop_catalogue' | 'restaurant_food'
  ) => {
    if (!selectedListing || isStaffMode) return;
    setIsInitializing(true);
    setStatus('saving', 'Initializing storefront profile…');
    try {
      const { error: upErr } = await supabase
        .from('listings')
        .update({ listing_vertical: target })
        .eq('id', selectedListing.id);
      if (upErr) throw upErr;

      if (target === 'restaurant_food') {
        const { error: profErr } = await supabase
          .from('listing_restaurant_profiles')
          .upsert(
            {
              listing_id: selectedListing.id,
              hub_id: selectedListing.hub_id,
              cuisines: ['Local', 'Café'],
              avg_cost_for_two_inr: 350,
              is_kitchen_open: true,
              prep_time_mins: 25,
            },
            { onConflict: 'listing_id' }
          );
        if (profErr) throw profErr;
      } else {
        const { error: profErr } = await supabase
          .from('listing_shop_profiles')
          .upsert(
            {
              listing_id: selectedListing.id,
              hub_id: selectedListing.hub_id,
              is_accepting_orders: true,
              prep_time_mins: 20,
            },
            { onConflict: 'listing_id' }
          );
        if (profErr) throw profErr;
      }

      setEnrichedListings((prev) =>
        prev.map((l) =>
          l.id === selectedListing.id ? { ...l, listing_vertical: target } : l
        )
      );
      setStatus(
        'success',
        target === 'restaurant_food'
          ? 'Restaurant & Kitchen profile initialized!'
          : 'Shop Catalogue storefront initialized!'
      );
    } catch (err) {
      setStatus(
        'error',
        err instanceof Error ? err.message : 'Failed to initialize profile.'
      );
    } finally {
      setIsInitializing(false);
    }
  };

  // Subscribe to Catalogue Pro / Restaurant Pro
  const handleSubscribePlan = async (plan: SubPlanRow) => {
    if (!selectedListing || isStaffMode) return;
    setSubscribingPlanId(plan.id);
    setStatus('saving', 'Preparing subscription checkout…');
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const purpose = isRestaurant
        ? 'restaurant_pro_subscription'
        : 'catalogue_pro_subscription';
      const res = await fetch('/api/payments/create-intent', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          purpose,
          plan_id: plan.id,
          listing_id: selectedListing.id,
          amount_inr: plan.price_inr,
          hubId: selectedListing.hub_id || undefined,
        }),
      });
      const json = (await res.json()) as {
        intent?: PaymentIntentRecord;
        error?: string;
      };
      if (!res.ok || !json.intent) {
        setStatus('error', json.error || 'Could not start subscription.');
        return;
      }
      setPaymentModalMeta({
        title: `${plan.name} · 0% Commission`,
        subtitle: `${selectedListing.title} (${plan.duration_days} days)`,
      });
      setActivePaymentIntent(json.intent);
    } finally {
      setSubscribingPlanId(null);
    }
  };

  // Restaurant 1-tap Kitchen Pause & Prep ETA
  const handleKitchenQuickUpdate = async (
    patch: Partial<{
      is_kitchen_open: boolean;
      kitchen_paused_until: string | null;
      prep_time_mins: number;
    }>
  ) => {
    if (!selectedListing || !restaurantProfile) return;
    setBusyId('kitchen-quick');
    try {
      const { error } = await supabase
        .from('listing_restaurant_profiles')
        .update(patch)
        .eq('listing_id', selectedListing.id);
      if (error) throw error;
      setRestaurantProfile((prev) => (prev ? { ...prev, ...patch } : prev));
      setStatus('success', 'Kitchen live status updated.');
    } catch (err) {
      setStatus(
        'error',
        err instanceof Error ? err.message : 'Failed to update kitchen status.'
      );
    } finally {
      setBusyId(null);
    }
  };

  // Restaurant Order Kitchen Actions
  const handleKitchenOrderAction = async (
    orderId: string,
    action: 'accept_order' | 'mark_ready' | 'reject_order' | 'verify_otp_handover',
    rejectionReason?: string
  ) => {
    if (action === 'reject_order' && !rejectionReason) {
      setCancelReasonText('');
      setCancelReasonTouched(false);
      setCancelReasonSubmitted(false);
      setCancelReasonModal({ kind: 'restaurant', orderId });
      return;
    }
    if (action === 'accept_order' || action === 'mark_ready') {
      const ok = await confirm({
        title:
          action === 'accept_order'
            ? 'Accept Kitchen Order?'
            : 'Mark Order Ready for Pickup?',
        description:
          action === 'accept_order'
            ? 'Confirming starts preparation and notifies the customer immediately.'
            : 'This notifies the customer (or Pick N Drop rider) that the order is packed and ready.',
        confirmLabel:
          action === 'accept_order' ? 'Accept Order' : 'Mark Ready',
        cancelLabel: 'Cancel',
      });
      if (!ok) return;
    }
    setBusyId(orderId);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch(
        `/api/commerce/restaurant-orders/${encodeURIComponent(orderId)}/kitchen-action`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            action,
            reason: rejectionReason?.trim() || undefined,
            otp:
              action === 'verify_otp_handover'
                ? (otpInputs[orderId] || '').trim()
                : undefined,
            directPaymentCollected: Boolean(directCollectedMap[orderId]),
          }),
        }
      );
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setStatus('error', json.error || 'Kitchen action failed.');
        return;
      }
      setStatus('success', 'Order updated.');
      await loadCommerceData();
    } finally {
      setBusyId(null);
    }
  };

  // Shop Order Actions
  const handleShopOrderAction = async (
    orderId: string,
    payload:
      | { action: 'update_status'; nextStatus: 'packing' | 'ready_for_pickup' | 'cancelled' }
      | { action: 'verify_otp_handover' },
    cancellationReason?: string
  ) => {
    if (
      payload.action === 'update_status' &&
      payload.nextStatus === 'cancelled' &&
      !cancellationReason
    ) {
      setCancelReasonText('');
      setCancelReasonTouched(false);
      setCancelReasonSubmitted(false);
      setCancelReasonModal({ kind: 'shop', orderId });
      return;
    }
    if (
      payload.action === 'update_status' &&
      (payload.nextStatus === 'packing' || payload.nextStatus === 'ready_for_pickup')
    ) {
      const ok = await confirm({
        title:
          payload.nextStatus === 'packing'
            ? 'Start Packing Order?'
            : 'Mark Order Ready for Pickup / Rider?',
        description:
          payload.nextStatus === 'packing'
            ? 'This updates the buyer that your team is packing their items.'
            : 'This notifies the buyer (or Pick N Drop rider) that the package is ready for handover.',
        confirmLabel:
          payload.nextStatus === 'packing' ? 'Start Packing' : 'Mark Ready',
        cancelLabel: 'Cancel',
      });
      if (!ok) return;
    }
    setBusyId(orderId);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch(
        `/api/commerce/shop-orders/${encodeURIComponent(orderId)}/owner-action`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(
            payload.action === 'verify_otp_handover'
              ? {
                  action: 'verify_otp_handover',
                  otp: (otpInputs[orderId] || '').trim(),
                  directPaymentCollected: Boolean(directCollectedMap[orderId]),
                }
              : {
                  ...payload,
                  reason: cancellationReason?.trim() || undefined,
                }
          ),
        }
      );
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setStatus('error', json.error || 'Shop order action failed.');
        return;
      }
      setStatus('success', 'Shop order updated.');
      await loadCommerceData();
    } finally {
      setBusyId(null);
    }
  };

  // 1-Tap Menu Item In-Stock Toggle (works in Staff Mode too)
  const handleToggleMenuStock = async (item: RestaurantMenuItem) => {
    setBusyId(item.id);
    const nextVal = !item.in_stock;
    setMenuItems((prev) =>
      prev.map((m) => (m.id === item.id ? { ...m, in_stock: nextVal } : m))
    );
    const { error } = await supabase
      .from('restaurant_menu_items')
      .update({ in_stock: nextVal })
      .eq('id', item.id);
    if (error) {
      setMenuItems((prev) =>
        prev.map((m) => (m.id === item.id ? { ...m, in_stock: !nextVal } : m))
      );
      setStatus('error', 'Could not update item stock.');
    } else {
      setStatus(
        'success',
        nextVal ? `${item.name} marked In Stock` : `${item.name} marked Sold Out`
      );
    }
    setBusyId(null);
  };

  const handleCancelDishModal = useCallback(() => {
    if (dishTempPaths.length > 0) {
      void discardUploadedTempPaths(dishTempPaths);
      setDishTempPaths([]);
    }
    setIsDishModalOpen(false);
  }, [dishTempPaths]);

  // Save Dish Modal (Owner only)
  const handleSaveDish = async () => {
    if (!selectedListing || isStaffMode) return;
    if (!dishDraft.name.trim()) {
      setStatus('error', 'Dish name is required.');
      return;
    }
    if (
      !dishDraft.id &&
      maxMenuItemsLimit >= 0 &&
      menuItems.length >= maxMenuItemsLimit
    ) {
      setStatus(
        'error',
        `Menu quota reached (${maxMenuItemsLimit} dishes). Upgrade your plan or contact admin.`
      );
      return;
    }

    const ok = await confirm({
      title: dishDraft.id ? 'Save Menu Dish Changes?' : 'Add Dish to Menu?',
      description: `${dishDraft.name.trim()} (${formatInr(
        Math.max(1, Number(dishDraft.base_price_inr) || 0)
      )}) will be published under ${dishDraft.category_name.trim() || 'Mains'}.`,
      confirmLabel: dishDraft.id ? 'Save Dish' : 'Add Dish',
    });
    if (!ok) return;

    setIsSavingDish(true);
    try {
      const basePayload = {
        listing_id: selectedListing.id,
        hub_id: selectedListing.hub_id,
        category_name: dishDraft.category_name.trim() || 'Mains',
        name: dishDraft.name.trim(),
        description: dishDraft.description.trim() || null,
        diet_type: dishDraft.diet_type,
        base_price_inr: Math.max(1, Number(dishDraft.base_price_inr) || 0),
        meal_slot: dishDraft.meal_slot,
        image_url: dishDraft.image_url.trim() || null,
        is_bestseller: dishDraft.is_bestseller,
        is_spicy: dishDraft.is_spicy || dishDraft.spice_level !== 'mild',
        in_stock: dishDraft.in_stock,
        variants: dishDraft.variants.filter((v) => v.label.trim()),
        addons: dishDraft.addons.filter((a) => a.label.trim()),
      };
      const extendedPayload = {
        ...basePayload,
        spice_level: dishDraft.spice_level || 'mild',
        prep_time_mins: Math.max(1, Number(dishDraft.prep_time_mins) || 15),
        portion_note: dishDraft.portion_note.trim() || null,
      };

      const isMissingCol = (msg?: string) =>
        /column|schema cache|42703|PGRST204/i.test(String(msg || ''));

      if (dishDraft.id) {
        let { error } = await supabase
          .from('restaurant_menu_items')
          .update(extendedPayload)
          .eq('id', dishDraft.id);
        if (error && isMissingCol(error.message)) {
          const fallback = await supabase
            .from('restaurant_menu_items')
            .update(basePayload)
            .eq('id', dishDraft.id);
          error = fallback.error;
        }
        if (error) throw error;
      } else {
        let { error } = await supabase
          .from('restaurant_menu_items')
          .insert(extendedPayload);
        if (error && isMissingCol(error.message)) {
          const fallback = await supabase
            .from('restaurant_menu_items')
            .insert(basePayload);
          error = fallback.error;
        }
        if (error) throw error;
      }
      setDishTempPaths([]);
      setIsDishModalOpen(false);
      setStatus('success', 'Menu item saved.');
      await loadCommerceData();
    } catch (err) {
      setStatus(
        'error',
        err instanceof Error ? err.message : 'Failed to save dish.'
      );
    } finally {
      setIsSavingDish(false);
    }
  };

  const handleDeleteDish = async (item: RestaurantMenuItem) => {
    if (isStaffMode) return;
    const ok = await confirm({
      title: 'Delete Menu Dish?',
      description: `Remove "${item.name}" permanently from your restaurant menu?`,
      confirmLabel: 'Delete Dish',
      variant: 'danger',
    });
    if (!ok) return;
    setBusyId(item.id);
    try {
      const { error } = await supabase
        .from('restaurant_menu_items')
        .delete()
        .eq('id', item.id);
      if (error) throw error;
      setStatus('success', `${item.name} removed from menu.`);
      await loadCommerceData();
    } catch (err) {
      setStatus(
        'error',
        err instanceof Error ? err.message : 'Failed to delete dish.'
      );
    } finally {
      setBusyId(null);
    }
  };

  // Table Reservation status update
  const handleTableStatus = async (
    reservationId: string,
    status: 'confirmed' | 'seated' | 'completed' | 'declined'
  ) => {
    if (status === 'declined') {
      const ok = await confirm({
        title: 'Decline Table Reservation?',
        description: 'Are you sure you want to decline this table reservation?',
        confirmLabel: 'Decline Reservation',
        variant: 'danger',
      });
      if (!ok) return;
    }
    setBusyId(reservationId);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      const res = await fetch('/api/commerce/table-reservations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({
          action: 'update_status',
          reservationId,
          status,
        }),
      });
      const json = (await res.json()) as { error?: string };
      if (!res.ok) {
        setStatus('error', json.error || 'Could not update reservation.');
        return;
      }
      setStatus('success', `Reservation marked ${status}.`);
      await loadCommerceData();
    } finally {
      setBusyId(null);
    }
  };

  // 1-Tap Shop Stock Toggle & inline tag/unit save
  const handleToggleShopStock = async (prod: MarketplaceStockRow) => {
    setBusyId(prod.id);
    const nextVal = !prod.in_stock;
    setStockProducts((prev) =>
      prev.map((p) => (p.id === prod.id ? { ...p, in_stock: nextVal } : p))
    );
    const { error } = await supabase
      .from('marketplace_products')
      .update({ in_stock: nextVal })
      .eq('id', prod.id);
    if (error) {
      setStockProducts((prev) =>
        prev.map((p) => (p.id === prod.id ? { ...p, in_stock: !nextVal } : p))
      );
      setStatus('error', 'Failed to toggle stock.');
    } else {
      setStatus(
        'success',
        nextVal ? `${prod.title} In Stock` : `${prod.title} Out of Stock`
      );
    }
    setBusyId(null);
  };

  const handleSaveShopProductMeta = async (productId: string) => {
    const draft = stockDrafts[productId];
    if (!draft) return;
    setBusyId(productId);
    const { error } = await supabase
      .from('marketplace_products')
      .update({
        unit_label: draft.unit_label.trim() || null,
        shop_category_tag: draft.shop_category_tag.trim() || null,
      })
      .eq('id', productId);
    if (error) {
      setStatus('error', 'Could not save product tag/unit.');
    } else {
      setStatus('success', 'Product details updated.');
    }
    setBusyId(null);
  };

  const handleCancelProductModal = useCallback(() => {
    if (productTempPaths.length > 0) {
      void discardUploadedTempPaths(productTempPaths);
      setProductTempPaths([]);
    }
    setIsProductModalOpen(false);
  }, [productTempPaths]);

  const handleSaveShopProduct = async () => {
    if (!selectedListing || isStaffMode) return;
    if (!productDraft.title.trim()) {
      setStatus('error', 'Product name is required.');
      return;
    }
    if (
      !productDraft.id &&
      maxCatalogueItemsLimit >= 0 &&
      stockProducts.length >= maxCatalogueItemsLimit
    ) {
      setStatus(
        'error',
        `Catalogue quota reached (${maxCatalogueItemsLimit} products). Upgrade your plan or contact admin.`
      );
      return;
    }

    const priceNum = Math.max(1, Number(productDraft.price) || 0);
    const ok = await confirm({
      title: productDraft.id ? 'Save Product Changes?' : 'Add Store Product?',
      description: `${productDraft.title.trim()} (${formatInr(priceNum)} / ${
        productDraft.unit_label.trim() || productDraft.unit
      }) will be saved to your shop catalogue.`,
      confirmLabel: productDraft.id ? 'Save Product' : 'Add Product',
    });
    if (!ok) return;

    setIsSavingProduct(true);
    try {
      const basePayload = {
        listing_id: selectedListing.id,
        owner_id: user?.id || null,
        title: productDraft.title.trim(),
        description: productDraft.description.trim() || null,
        category: productDraft.category.trim() || 'General',
        shop_category_tag:
          productDraft.shop_category_tag.trim() ||
          productDraft.category.trim() ||
          'General',
        price: priceNum,
        unit: productDraft.unit.trim() || 'Piece',
        unit_label:
          productDraft.unit_label.trim() || productDraft.unit.trim() || 'Piece',
        thumbnail_url: productDraft.thumbnail_url.trim() || null,
        in_stock: productDraft.in_stock,
        is_active: true,
      };
      const extendedPayload = {
        ...basePayload,
        stock_count:
          productDraft.stock_count.trim() !== ''
            ? Math.max(0, Number(productDraft.stock_count) || 0)
            : null,
        sku_variant_note: productDraft.sku_variant_note.trim() || null,
        supports_pick_n_drop: productDraft.supports_pick_n_drop,
      };

      const isMissingCol = (msg?: string) =>
        /column|schema cache|42703|PGRST204/i.test(String(msg || ''));

      if (productDraft.id) {
        let { error } = await supabase
          .from('marketplace_products')
          .update(extendedPayload)
          .eq('id', productDraft.id);
        if (error && isMissingCol(error.message)) {
          const fallback = await supabase
            .from('marketplace_products')
            .update(basePayload)
            .eq('id', productDraft.id);
          error = fallback.error;
        }
        if (error) throw error;
      } else {
        let { error } = await supabase
          .from('marketplace_products')
          .insert(extendedPayload);
        if (error && isMissingCol(error.message)) {
          const fallback = await supabase
            .from('marketplace_products')
            .insert(basePayload);
          error = fallback.error;
        }
        if (error) throw error;
      }

      setProductTempPaths([]);
      setIsProductModalOpen(false);
      setStatus(
        'success',
        productDraft.id ? 'Store product updated.' : 'Product added to catalogue.'
      );
      await loadCommerceData();
    } catch (err) {
      setStatus(
        'error',
        err instanceof Error ? err.message : 'Failed to save product.'
      );
    } finally {
      setIsSavingProduct(false);
    }
  };

  const handleDeleteShopProduct = async (prod: MarketplaceStockRow) => {
    if (isStaffMode) return;
    const ok = await confirm({
      title: 'Delete Store Product?',
      description: `Remove "${prod.title}" permanently from your shop catalogue?`,
      confirmLabel: 'Delete Product',
      variant: 'danger',
    });
    if (!ok) return;
    setBusyId(prod.id);
    try {
      const { error } = await supabase
        .from('marketplace_products')
        .delete()
        .eq('id', prod.id);
      if (error) throw error;
      setStatus('success', `${prod.title} removed from catalogue.`);
      await loadCommerceData();
    } catch (err) {
      setStatus(
        'error',
        err instanceof Error ? err.message : 'Failed to delete product.'
      );
    } finally {
      setBusyId(null);
    }
  };

  // Save Restaurant Setup (Owner only)
  const handleSaveRestaurantSetup = async () => {
    if (!selectedListing || !restaurantProfile || isStaffMode) return;
    const ok = await confirm({
      title: 'Save Kitchen & Payment Settings?',
      description:
        'Update cuisines, ordering channels, table capacity, and direct UPI settings for this restaurant?',
      confirmLabel: 'Save Kitchen Settings',
    });
    if (!ok) return;
    setIsSavingSetup(true);
    try {
      const cuisines = cuisinesInput
        .split(',')
        .map((c) => c.trim())
        .filter(Boolean);
      const existingPol = restaurantProfile.payment_policy || {
        allow_direct_pay: true,
        direct_pay_max_inr: 400,
        shop_upi_id: null,
        shop_upi_name: null,
        shop_upi_verified: false,
      };
      const nextUpi = restSetupDraft.shop_upi_id.trim() || null;
      const upiChanged = nextUpi !== (existingPol.shop_upi_id || null);

      const { error } = await supabase
        .from('listing_restaurant_profiles')
        .update({
          cuisines,
          avg_cost_for_two_inr: Number(restSetupDraft.avg_cost_for_two_inr) || 350,
          is_pure_veg: restSetupDraft.is_pure_veg,
          allow_takeaway: restSetupDraft.allow_takeaway,
          allow_pick_n_drop: restSetupDraft.allow_pick_n_drop,
          allow_table_booking: restSetupDraft.allow_table_booking,
          max_table_party_size: Number(restSetupDraft.max_table_party_size) || 8,
          packaging_fee_inr: Number(restSetupDraft.packaging_fee_inr) || 0,
          min_order_inr: Number(restSetupDraft.min_order_inr) || 0,
          fssai_license_no: restSetupDraft.fssai_license_no.trim() || null,
          pickup_instructions: restSetupDraft.pickup_instructions.trim() || null,
          payment_policy: {
            allow_direct_pay: restSetupDraft.allow_direct_pay,
            direct_pay_max_inr: Number(restSetupDraft.direct_pay_max_inr) || 400,
            shop_upi_id: nextUpi,
            shop_upi_name: restSetupDraft.shop_upi_name.trim() || null,
            shop_upi_verified: upiChanged
              ? false
              : Boolean(existingPol.shop_upi_verified),
          },
        })
        .eq('listing_id', selectedListing.id);
      if (error) throw error;
      setStatus('success', 'Kitchen & payment settings saved.');
      await loadCommerceData();
    } catch (err) {
      setStatus(
        'error',
        err instanceof Error ? err.message : 'Failed to save kitchen setup.'
      );
    } finally {
      setIsSavingSetup(false);
    }
  };

  // Save Shop Setup (Owner only)
  const handleSaveShopSetup = async () => {
    if (!selectedListing || !shopProfile || isStaffMode) return;
    const ok = await confirm({
      title: 'Save Storefront & Payment Settings?',
      description:
        'Update storefront order preferences, packaging fees, prep time, and direct UPI rules?',
      confirmLabel: 'Save Store Settings',
    });
    if (!ok) return;
    setIsSavingSetup(true);
    try {
      const existingPol = shopProfile.payment_policy || {
        allow_direct_pay: true,
        direct_pay_max_inr: 500,
        shop_upi_id: null,
        shop_upi_name: null,
        shop_upi_verified: false,
      };
      const nextUpi = shopSetupDraft.shop_upi_id.trim() || null;
      const upiChanged = nextUpi !== (existingPol.shop_upi_id || null);

      const { error } = await supabase
        .from('listing_shop_profiles')
        .update({
          is_accepting_orders: shopSetupDraft.is_accepting_orders,
          allow_counter_pickup: shopSetupDraft.allow_counter_pickup,
          allow_pick_n_drop: shopSetupDraft.allow_pick_n_drop,
          min_order_inr: Number(shopSetupDraft.min_order_inr) || 0,
          packaging_fee_inr: Number(shopSetupDraft.packaging_fee_inr) || 0,
          prep_time_mins: Number(shopSetupDraft.prep_time_mins) || 20,
          pickup_instructions: shopSetupDraft.pickup_instructions.trim() || null,
          payment_policy: {
            allow_direct_pay: shopSetupDraft.allow_direct_pay,
            direct_pay_max_inr: Number(shopSetupDraft.direct_pay_max_inr) || 500,
            shop_upi_id: nextUpi,
            shop_upi_name: shopSetupDraft.shop_upi_name.trim() || null,
            shop_upi_verified: upiChanged
              ? false
              : Boolean(existingPol.shop_upi_verified),
          },
        })
        .eq('listing_id', selectedListing.id);
      if (error) throw error;
      setStatus('success', 'Storefront & payment settings saved.');
      await loadCommerceData();
    } catch (err) {
      setStatus(
        'error',
        err instanceof Error ? err.message : 'Failed to save store setup.'
      );
    } finally {
      setIsSavingSetup(false);
    }
  };

  const handleShopQuickPause = async (minutes: number | null) => {
    if (!selectedListing) return;
    setBusyId('shop-pause');
    const busy_until =
      minutes === null
        ? null
        : new Date(Date.now() + minutes * 60_000).toISOString();
    const { error } = await supabase
      .from('listing_shop_profiles')
      .update({ busy_until })
      .eq('listing_id', selectedListing.id);
    if (error) {
      setStatus('error', 'Could not update store pause status.');
    } else {
      setShopProfile((prev) => (prev ? { ...prev, busy_until } : prev));
      setStatus(
        'success',
        minutes === null ? 'Storefront resumed.' : `Storefront paused for ${minutes}m.`
      );
    }
    setBusyId(null);
  };

  // Filtered rows
  const filteredRestaurantOrders = useMemo(() => {
    const q = orderSearch.trim().toLowerCase();
    return restaurantOrders.filter((o) => {
      if (orderStatusFilter !== 'all') {
        if (
          orderStatusFilter === 'completed' &&
          o.kitchen_status !== 'completed' &&
          o.kitchen_status !== 'handed_to_rider'
        ) {
          return false;
        }
        if (
          orderStatusFilter !== 'completed' &&
          o.kitchen_status !== orderStatusFilter
        ) {
          return false;
        }
      }
      if (!q) return true;
      const itemsText = o.items_snapshot.map((i) => i.name).join(' ').toLowerCase();
      return (
        o.order_code.toLowerCase().includes(q) || itemsText.includes(q)
      );
    });
  }, [restaurantOrders, orderSearch, orderStatusFilter]);

  const filteredShopOrders = useMemo(() => {
    const q = orderSearch.trim().toLowerCase();
    return shopOrders.filter((o) => {
      if (orderStatusFilter !== 'all' && o.order_status !== orderStatusFilter) {
        return false;
      }
      if (!q) return true;
      const itemsText = o.items_snapshot.map((i) => i.title).join(' ').toLowerCase();
      return (
        o.order_code.toLowerCase().includes(q) || itemsText.includes(q)
      );
    });
  }, [shopOrders, orderSearch, orderStatusFilter]);

  const filteredMenuItems = useMemo(() => {
    const q = menuSearch.trim().toLowerCase();
    if (!q) return menuItems;
    return menuItems.filter(
      (m) =>
        m.name.toLowerCase().includes(q) ||
        m.category_name.toLowerCase().includes(q)
    );
  }, [menuItems, menuSearch]);

  const filteredTables = useMemo(() => {
    const q = tableSearch.trim().toLowerCase();
    return tableReservations.filter((t) => {
      if (tableStatusFilter !== 'all' && t.status !== tableStatusFilter) {
        return false;
      }
      if (!q) return true;
      return (
        t.reservation_code.toLowerCase().includes(q) ||
        t.guest_name.toLowerCase().includes(q)
      );
    });
  }, [tableReservations, tableSearch, tableStatusFilter]);

  const filteredStock = useMemo(() => {
    const q = stockSearch.trim().toLowerCase();
    if (!q) return stockProducts;
    return stockProducts.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        (p.shop_category_tag || '').toLowerCase().includes(q)
    );
  }, [stockProducts, stockSearch]);

  const listingSelectOptions = useMemo(
    () =>
      enrichedListings.map((l) => ({
        value: l.id,
        label: l.title,
        description:
          l.listing_vertical === 'restaurant_food'
            ? `Restaurant / Café · ${l.locality}`
            : l.listing_vertical === 'shop_catalogue'
              ? `Shop Storefront · ${l.locality}`
              : `General Listing · ${l.locality}`,
      })),
    [enrichedListings]
  );

  if (enrichedListings.length === 0 && !isLoading) {
    return (
      <div className="rounded-2xl border border-dashed border-[var(--ps-border)] bg-[var(--ps-surface)] p-8 text-center space-y-2">
        <Store className="mx-auto h-7 w-7 text-[var(--ps-text-muted)] opacity-60" />
        <p className="text-sm font-bold text-[var(--ps-text)]">
          No listings available for Shop &amp; Kitchen Desk
        </p>
        <p className="text-xs text-[var(--ps-text-muted)]">
          Create or claim a shop or restaurant listing first to manage live orders, stock, and digital menus.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Top Bar: Listing Switcher + Refresh + QR Poster */}
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4">
        <div className="w-full min-w-0 sm:w-auto sm:min-w-[220px] sm:flex-1 max-w-md">
          <CustomSelectModal
            label={isStaffMode ? 'Assigned Store / Kitchen' : 'Select Storefront or Kitchen'}
            value={selectedListingId}
            onChange={(val) => {
              setSelectedListingId(val);
              setOrderSearch('');
              setOrderStatusFilter('all');
            }}
            options={listingSelectOptions}
            placeholder="Choose listing"
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {!isStaffMode && selectedListing && (isRestaurant || isShop) && (
            <button
              type="button"
              onClick={() => setIsQrOpen(true)}
              className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs font-semibold text-[var(--ps-text)] hover:border-[var(--ps-accent)] cursor-pointer"
            >
              <QrCode className="h-3.5 w-3.5 text-[var(--ps-accent)]" />
              <span>{isRestaurant ? 'Table QR Menu Poster' : 'Storefront QR Poster'}</span>
            </button>
          )}
          <button
            type="button"
            onClick={() => void loadCommerceData()}
            className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs font-semibold text-[var(--ps-text)] hover:bg-[var(--ps-surface-alt)] cursor-pointer"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${isLoading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>
      </div>

      {/* Skeletal Loading State (v18b) */}
      {isLoading && (
        <div className="space-y-3" aria-busy="true" aria-label="Loading shop and kitchen desk">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="dd-shimmer h-24 rounded-2xl border border-[var(--ps-border)]" />
            <div className="dd-shimmer h-24 rounded-2xl border border-[var(--ps-border)]" />
            <div className="dd-shimmer h-24 rounded-2xl border border-[var(--ps-border)]" />
          </div>
          <div className="dd-shimmer h-40 rounded-2xl border border-[var(--ps-border)]" />
        </div>
      )}

      {/* General Listing Initialization Prompt */}
      {selectedListing && !isRestaurant && !isShop && !isLoading && (
        <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-6 text-center space-y-3">
          <Sparkles className="mx-auto h-7 w-7 text-[var(--ps-accent)]" />
          <h3 className="text-sm font-bold text-[var(--ps-text)]">
            Turn &ldquo;{selectedListing.title}&rdquo; into a Live Storefront or Digital Menu
          </h3>
          <p className="mx-auto max-w-lg text-xs text-[var(--ps-text-muted)]">
            Enable 0% commission online ordering with Pick N Drop local delivery, 1-tap stock toggles, and printable QR posters.
          </p>
          {!isStaffMode ? (
            <div className="flex flex-wrap items-center justify-center gap-2 pt-1">
              <button
                type="button"
                disabled={isInitializing}
                onClick={() => void handleInitializeVertical('shop_catalogue')}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-sky-600 px-4 text-xs font-bold text-white hover:bg-sky-700 disabled:opacity-60 cursor-pointer"
              >
                <ShoppingBag className="h-4 w-4" />
                <span>Enable Shop Catalogue Pro</span>
              </button>
              <button
                type="button"
                disabled={isInitializing}
                onClick={() => void handleInitializeVertical('restaurant_food')}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-orange-600 px-4 text-xs font-bold text-white hover:bg-orange-700 disabled:opacity-60 cursor-pointer"
              >
                <UtensilsCrossed className="h-4 w-4" />
                <span>Enable Restaurant &amp; Kitchen Pro</span>
              </button>
            </div>
          ) : (
            <p className="text-xs font-medium text-amber-600 dark:text-amber-400">
              Ask the listing owner to activate Shop Catalogue or Restaurant mode first.
            </p>
          )}
        </div>
      )}

      {/* Upgrade Banner when Unsubscribed (Owner Only) */}
      {!isStaffMode &&
        selectedListing &&
        (isRestaurant || isShop) &&
        !hasEntitlement &&
        !isLoading && (
          <div className="rounded-2xl border border-amber-500/40 bg-amber-500/8 p-4 space-y-3">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="flex items-start gap-2.5">
                <Crown className="mt-0.5 h-5 w-5 shrink-0 text-amber-600 dark:text-amber-400" />
                <div>
                  <h3 className="text-sm font-bold text-[var(--ps-text)]">
                    Upgrade to {isRestaurant ? 'Restaurant Pro' : 'Catalogue Pro'} (0% Commission)
                  </h3>
                  <p className="text-xs text-[var(--ps-text-muted)]">
                    Your storefront is currently in Free Showcase mode (Call/Enquire only). Activate a flat monthly plan to accept live customer orders and Pick N Drop deliveries. In-flight orders remain visible below.
                  </p>
                </div>
              </div>
            </div>
            {plans.length > 0 && (
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {plans.map((plan) => (
                  <div
                    key={plan.id}
                    className="flex items-center justify-between gap-3 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-3.5 py-2.5"
                  >
                    <div className="min-w-0">
                      <p className="text-xs font-bold text-[var(--ps-text)] truncate">
                        {plan.name}
                      </p>
                      <p className="text-[11px] text-[var(--ps-text-muted)]">
                        {formatInr(plan.price_inr)} / {plan.duration_days} days
                      </p>
                    </div>
                    <button
                      type="button"
                      disabled={subscribingPlanId === plan.id}
                      onClick={() => void handleSubscribePlan(plan)}
                      className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-xl bg-[var(--ps-accent)] px-3 text-xs font-bold text-[var(--ps-accent-fg)] hover:opacity-95 disabled:opacity-60 cursor-pointer"
                    >
                      {subscribingPlanId === plan.id ? (
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                      ) : (
                        <Crown className="h-3.5 w-3.5" />
                      )}
                      <span>Subscribe</span>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

      {/* =================================================================== */}
      {/* MODE A: RESTAURANT & KITCHEN DESK                                   */}
      {/* =================================================================== */}
      {selectedListing && isRestaurant && (
        <div className="space-y-4">
          {/* Sub-Tabs */}
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                {
                  id: 'kitchen',
                  label: `Live Kitchen (${restaurantOrders.length})`,
                  icon: ChefHat,
                },
                {
                  id: 'menu',
                  label: `Menu & Sold-Out (${menuItems.length})`,
                  icon: UtensilsCrossed,
                },
                {
                  id: 'tables',
                  label: `Tables (${tableReservations.length})`,
                  icon: CalendarDays,
                },
                ...(!isStaffMode
                  ? [
                      {
                        id: 'setup' as const,
                        label: 'Setup & Settlements',
                        icon: Wallet,
                      },
                    ]
                  : []),
              ] as const
            ).map((t) => {
              const Icon = t.icon;
              const active = restaurantTab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setRestaurantTab(t.id)}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold transition-colors cursor-pointer ${
                    active
                      ? 'bg-orange-600 text-white shadow-2xs'
                      : 'border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>

          {/* 1. LIVE KITCHEN QUEUE */}
          {restaurantTab === 'kitchen' && (
            <div className="space-y-3">
              {/* 1-Tap Kitchen Pause & Prep ETA Bar */}
              {restaurantProfile && (
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] px-4 py-3">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)] mr-1">
                      Kitchen:
                    </span>
                    <button
                      type="button"
                      disabled={busyId === 'kitchen-quick'}
                      onClick={() =>
                        void handleKitchenQuickUpdate({
                          is_kitchen_open: true,
                          kitchen_paused_until: null,
                        })
                      }
                      className={`inline-flex h-8 items-center gap-1 rounded-xl px-2.5 text-xs font-bold cursor-pointer ${
                        restaurantProfile.is_kitchen_open &&
                        (!restaurantProfile.kitchen_paused_until ||
                          (nowMs > 0 &&
                            Date.parse(restaurantProfile.kitchen_paused_until) <=
                              nowMs))
                          ? 'bg-emerald-600 text-white'
                          : 'border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)]'
                      }`}
                    >
                      <PlayCircle className="h-3.5 w-3.5" />
                      <span>Open</span>
                    </button>
                    <button
                      type="button"
                      disabled={busyId === 'kitchen-quick'}
                      onClick={() =>
                        void handleKitchenQuickUpdate({
                          is_kitchen_open: true,
                          kitchen_paused_until: new Date(
                            Date.now() + 30 * 60_000
                          ).toISOString(),
                        })
                      }
                      className="inline-flex h-8 items-center gap-1 rounded-xl border border-amber-500/40 bg-amber-500/10 px-2.5 text-xs font-semibold text-amber-800 dark:text-amber-300 hover:bg-amber-500/20 cursor-pointer"
                    >
                      <PauseCircle className="h-3.5 w-3.5" />
                      <span>Pause 30m</span>
                    </button>
                    <button
                      type="button"
                      disabled={busyId === 'kitchen-quick'}
                      onClick={() =>
                        void handleKitchenQuickUpdate({
                          is_kitchen_open: false,
                          kitchen_paused_until: null,
                        })
                      }
                      className={`inline-flex h-8 items-center gap-1 rounded-xl px-2.5 text-xs font-semibold cursor-pointer ${
                        !restaurantProfile.is_kitchen_open
                          ? 'bg-rose-600 text-white'
                          : 'border border-rose-500/35 bg-rose-500/10 text-rose-700 dark:text-rose-300'
                      }`}
                    >
                      <span>Pause Rest of Day</span>
                    </button>
                  </div>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="inline-flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)] mr-1">
                      <Clock className="h-3 w-3" />
                      <span>Prep ETA:</span>
                    </span>
                    {[15, 25, 40, 60].map((mins) => (
                      <button
                        key={mins}
                        type="button"
                        disabled={busyId === 'kitchen-quick'}
                        onClick={() =>
                          void handleKitchenQuickUpdate({ prep_time_mins: mins })
                        }
                        className={`h-8 rounded-xl px-2.5 font-mono text-xs font-bold cursor-pointer ${
                          restaurantProfile.prep_time_mins === mins
                            ? 'bg-orange-600 text-white'
                            : 'border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                        }`}
                      >
                        {mins}m
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3">
                <WorkspaceTableToolbar
                  searchQuery={orderSearch}
                  onSearchChange={setOrderSearch}
                  searchPlaceholder="Search order code or dish…"
                  totalCount={restaurantOrders.length}
                  filteredCount={filteredRestaurantOrders.length}
                  hasActiveFilters={
                    Boolean(orderSearch) || orderStatusFilter !== 'all'
                  }
                  onResetFilters={() => {
                    setOrderSearch('');
                    setOrderStatusFilter('all');
                  }}
                >
                  <div className="flex flex-wrap items-center gap-1">
                    {[
                      { id: 'all', label: 'All' },
                      { id: 'new_order', label: 'New' },
                      { id: 'preparing', label: 'Preparing' },
                      { id: 'ready_for_pickup', label: 'Ready' },
                      { id: 'completed', label: 'Completed' },
                    ].map((f) => (
                      <button
                        key={f.id}
                        type="button"
                        onClick={() => setOrderStatusFilter(f.id)}
                        className={`h-8 rounded-xl px-2.5 text-xs font-semibold cursor-pointer ${
                          orderStatusFilter === f.id
                            ? 'bg-orange-600 text-white'
                            : 'border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)]'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>
                </WorkspaceTableToolbar>

                <ResponsiveTableScroll>
                  <table className="w-full min-w-[760px] text-left text-xs">
                    <thead>
                      <tr className="border-b border-[var(--ps-border)] text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                        <th className="py-2 pr-3">Order</th>
                        <th className="py-2 pr-3">Items &amp; Notes</th>
                        <th className="py-2 pr-3">Mode &amp; Total</th>
                        <th className="py-2 pr-3">Status</th>
                        <th className="py-2 text-right">Kitchen Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--ps-border)]/60">
                      {filteredRestaurantOrders.length === 0 ? (
                        <tr>
                          <td
                            colSpan={5}
                            className="py-8 text-center text-xs text-[var(--ps-text-muted)]"
                          >
                            No food orders match this filter.
                          </td>
                        </tr>
                      ) : (
                        filteredRestaurantOrders.map((order) => (
                          <tr key={order.id} className="align-top">
                            <td className="py-3 pr-3">
                              <p className="font-mono font-bold text-orange-700 dark:text-orange-300">
                                {order.order_code}
                              </p>
                              <p className="text-[10px] text-[var(--ps-text-muted)]">
                                {new Date(order.created_at).toLocaleTimeString(
                                  'en-IN',
                                  { hour: '2-digit', minute: '2-digit' }
                                )}
                              </p>
                            </td>
                            <td className="py-3 pr-3 max-w-xs">
                              <div className="space-y-0.5">
                                {order.items_snapshot.map((line, i) => (
                                  <p key={i} className="font-medium text-[var(--ps-text)]">
                                    {line.qty}× {line.name}
                                    {line.variant_label
                                      ? ` (${line.variant_label})`
                                      : ''}
                                  </p>
                                ))}
                              </div>
                              {order.cooking_instructions && (
                                <p className="mt-1 rounded bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-800 dark:text-amber-300">
                                  Note: {order.cooking_instructions}
                                </p>
                              )}
                            </td>
                            <td className="py-3 pr-3">
                              <p className="font-mono font-bold text-[var(--ps-text)]">
                                {formatInr(order.total_amount_inr)}
                              </p>
                              <p className="text-[10px] text-[var(--ps-text-muted)]">
                                {order.fulfillment_mode === 'pick_n_drop'
                                  ? 'Pick N Drop Hot Food'
                                  : 'Self-Takeaway'}{' '}
                                · {order.payment_status.replace(/_/g, ' ')}
                              </p>
                            </td>
                            <td className="py-3 pr-3">
                              <span className="inline-block rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-0.5 text-[10px] font-bold capitalize text-[var(--ps-text)]">
                                {order.kitchen_status.replace(/_/g, ' ')}
                              </span>
                            </td>
                            <td className="py-3 text-right">
                              <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                                {order.kitchen_status === 'new_order' && (
                                  <>
                                    <button
                                      type="button"
                                      disabled={busyId === order.id}
                                      onClick={() =>
                                        void handleKitchenOrderAction(
                                          order.id,
                                          'accept_order'
                                        )
                                      }
                                      className="h-8 rounded-xl bg-emerald-600 px-3 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-60 cursor-pointer"
                                    >
                                      Accept &amp; Cook
                                    </button>
                                    <button
                                      type="button"
                                      disabled={busyId === order.id}
                                      onClick={() =>
                                        void handleKitchenOrderAction(
                                          order.id,
                                          'reject_order'
                                        )
                                      }
                                      className="h-8 rounded-xl border border-rose-500/40 bg-rose-500/10 px-2.5 text-xs font-semibold text-rose-700 dark:text-rose-300 hover:bg-rose-500/20 disabled:opacity-60 cursor-pointer"
                                    >
                                      Reject
                                    </button>
                                  </>
                                )}
                                {order.kitchen_status === 'preparing' && (
                                  <button
                                    type="button"
                                    disabled={busyId === order.id}
                                    onClick={() =>
                                      void handleKitchenOrderAction(
                                        order.id,
                                        'mark_ready'
                                      )
                                    }
                                    className="h-8 rounded-xl bg-orange-600 px-3 text-xs font-bold text-white hover:bg-orange-700 disabled:opacity-60 cursor-pointer"
                                  >
                                    Mark Ready
                                  </button>
                                )}
                                {order.kitchen_status === 'ready_for_pickup' && (
                                  <div className="flex flex-col items-end gap-1.5">
                                    <div className="flex items-center gap-1.5">
                                      <input
                                        type="text"
                                        inputMode="numeric"
                                        maxLength={4}
                                        placeholder="4-digit OTP"
                                        value={otpInputs[order.id] || ''}
                                        onChange={(e) =>
                                          setOtpInputs((prev) => ({
                                            ...prev,
                                            [order.id]: e.target.value.replace(
                                              /\D/g,
                                              ''
                                            ),
                                          }))
                                        }
                                        className="h-8 w-24 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 font-mono text-xs text-center font-bold text-[var(--ps-text)]"
                                      />
                                      <button
                                        type="button"
                                        disabled={
                                          busyId === order.id ||
                                          (otpInputs[order.id] || '').length < 4
                                        }
                                        onClick={() =>
                                          void handleKitchenOrderAction(
                                            order.id,
                                            'verify_otp_handover'
                                          )
                                        }
                                        className="inline-flex h-8 items-center gap-1 rounded-xl bg-emerald-600 px-3 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50 cursor-pointer"
                                      >
                                        <KeyRound className="h-3.5 w-3.5" />
                                        <span>Handover</span>
                                      </button>
                                    </div>
                                    {order.payment_rail !== 'platform_escrow' && (
                                      <label className="inline-flex items-center gap-1.5 text-[10px] font-medium text-[var(--ps-text-muted)] cursor-pointer">
                                        <input
                                          type="checkbox"
                                          checked={Boolean(
                                            directCollectedMap[order.id]
                                          )}
                                          onChange={(e) =>
                                            setDirectCollectedMap((prev) => ({
                                              ...prev,
                                              [order.id]: e.target.checked,
                                            }))
                                          }
                                        />
                                        <span>Direct Cash/UPI Collected</span>
                                      </label>
                                    )}
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </ResponsiveTableScroll>
              </div>
            </div>
          )}

          {/* 2. MENU & 1-TAP SOLD-OUT */}
          {restaurantTab === 'menu' && (
            <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3">
              <WorkspaceTableToolbar
                searchQuery={menuSearch}
                onSearchChange={setMenuSearch}
                searchPlaceholder="Search dish or category…"
                totalCount={menuItems.length}
                filteredCount={filteredMenuItems.length}
                hasActiveFilters={Boolean(menuSearch)}
                onResetFilters={() => setMenuSearch('')}
                actions={
                  !isStaffMode ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 py-1 text-[11px] font-bold text-[var(--ps-text-muted)]">
                        Quota: {menuItems.length} /{' '}
                        {maxMenuItemsLimit < 0 ? 'Unlimited' : maxMenuItemsLimit}
                      </span>
                      <button
                        type="button"
                        disabled={
                          maxMenuItemsLimit >= 0 &&
                          menuItems.length >= maxMenuItemsLimit
                        }
                        onClick={() => {
                          setDishTempPaths([]);
                          setDishDraft(EMPTY_DISH_DRAFT);
                          setIsDishModalOpen(true);
                        }}
                        className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-orange-600 px-3 text-xs font-bold text-white hover:bg-orange-700 disabled:opacity-50 cursor-pointer"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        <span>Add Dish</span>
                      </button>
                    </div>
                  ) : undefined
                }
              />

              <ResponsiveTableScroll>
                <table className="w-full min-w-[640px] text-left text-xs">
                  <thead>
                    <tr className="border-b border-[var(--ps-border)] text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                      <th className="py-2 pr-3">Dish</th>
                      <th className="py-2 pr-3">Category &amp; Slot</th>
                      <th className="py-2 pr-3">Price</th>
                      <th className="py-2 pr-3">Stock (1-Tap)</th>
                      {!isStaffMode && <th className="py-2 text-right">Edit</th>}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--ps-border)]/60">
                    {filteredMenuItems.length === 0 ? (
                      <tr>
                        <td
                          colSpan={isStaffMode ? 4 : 5}
                          className="py-8 text-center text-xs text-[var(--ps-text-muted)]"
                        >
                          No menu items found.
                        </td>
                      </tr>
                    ) : (
                      filteredMenuItems.map((item) => (
                        <tr key={item.id}>
                          <td className="py-2.5 pr-3">
                            <div className="flex items-center gap-2">
                              <span
                                className={`h-2.5 w-2.5 rounded-full shrink-0 ${
                                  item.diet_type === 'veg'
                                    ? 'bg-emerald-600'
                                    : item.diet_type === 'egg'
                                      ? 'bg-amber-500'
                                      : 'bg-rose-600'
                                }`}
                              />
                              <span className="font-bold text-[var(--ps-text)]">
                                {item.name}
                              </span>
                              {item.is_bestseller && (
                                <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-bold text-amber-700 dark:text-amber-300">
                                  Bestseller
                                </span>
                              )}
                              {item.is_spicy && (
                                <Flame className="h-3 w-3 text-rose-500" />
                              )}
                            </div>
                          </td>
                          <td className="py-2.5 pr-3 text-[var(--ps-text-muted)]">
                            {item.category_name} ·{' '}
                            <span className="capitalize">
                              {item.meal_slot.replace(/_/g, ' ')}
                            </span>
                          </td>
                          <td className="py-2.5 pr-3 font-mono font-bold text-[var(--ps-text)]">
                            {formatInr(item.base_price_inr)}
                          </td>
                          <td className="py-2.5 pr-3">
                            <button
                              type="button"
                              disabled={busyId === item.id}
                              onClick={() => void handleToggleMenuStock(item)}
                              className={`inline-flex h-7 items-center gap-1 rounded-lg px-2.5 text-[11px] font-bold cursor-pointer transition-colors ${
                                item.in_stock
                                  ? 'border border-emerald-500/35 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                                  : 'border border-rose-500/35 bg-rose-500/12 text-rose-700 dark:text-rose-300'
                              }`}
                            >
                              {item.in_stock ? 'In Stock' : 'Sold Out Today'}
                            </button>
                          </td>
                          {!isStaffMode && (
                            <td className="py-2.5 text-right">
                              <div className="inline-flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => {
                                    const itemAny = item as RestaurantMenuItem & {
                                      spice_level?: 'mild' | 'medium' | 'hot';
                                      prep_time_mins?: number | null;
                                      portion_note?: string | null;
                                    };
                                    setDishTempPaths([]);
                                    setDishDraft({
                                      id: item.id,
                                      category_name: item.category_name,
                                      name: item.name,
                                      description: item.description || '',
                                      diet_type: item.diet_type,
                                      base_price_inr: String(item.base_price_inr),
                                      meal_slot: item.meal_slot,
                                      spice_level:
                                        itemAny.spice_level ||
                                        (item.is_spicy ? 'hot' : 'mild'),
                                      prep_time_mins: String(
                                        itemAny.prep_time_mins ?? 15
                                      ),
                                      portion_note: itemAny.portion_note || '',
                                      image_url: item.image_url || '',
                                      is_bestseller: item.is_bestseller,
                                      is_spicy: item.is_spicy,
                                      in_stock: item.in_stock,
                                      variants: item.variants || [],
                                      addons: item.addons || [],
                                    });
                                    setIsDishModalOpen(true);
                                  }}
                                  className="inline-flex h-7 items-center gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 text-[11px] font-semibold text-[var(--ps-text)] hover:border-[var(--ps-accent)] cursor-pointer"
                                >
                                  <Edit3 className="h-3 w-3" />
                                  <span>Edit</span>
                                </button>
                                <button
                                  type="button"
                                  disabled={busyId === item.id}
                                  onClick={() => void handleDeleteDish(item)}
                                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 cursor-pointer"
                                  title="Delete dish"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </ResponsiveTableScroll>
            </div>
          )}

          {/* 3. TABLE RESERVATIONS */}
          {restaurantTab === 'tables' && (
            <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3">
              <WorkspaceTableToolbar
                searchQuery={tableSearch}
                onSearchChange={setTableSearch}
                searchPlaceholder="Search reservation code or guest…"
                totalCount={tableReservations.length}
                filteredCount={filteredTables.length}
                hasActiveFilters={
                  Boolean(tableSearch) || tableStatusFilter !== 'all'
                }
                onResetFilters={() => {
                  setTableSearch('');
                  setTableStatusFilter('all');
                }}
              >
                <div className="flex flex-wrap items-center gap-1">
                  {(
                    [
                      'all',
                      'requested',
                      'confirmed',
                      'seated',
                      'completed',
                    ] as const
                  ).map((s) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setTableStatusFilter(s)}
                      className={`h-8 rounded-xl px-2.5 text-xs font-semibold capitalize cursor-pointer ${
                        tableStatusFilter === s
                          ? 'bg-orange-600 text-white'
                          : 'border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)]'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </WorkspaceTableToolbar>

              <ResponsiveTableScroll>
                <table className="w-full min-w-[680px] text-left text-xs">
                  <thead>
                    <tr className="border-b border-[var(--ps-border)] text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                      <th className="py-2 pr-3">Code</th>
                      <th className="py-2 pr-3">Guest &amp; Party</th>
                      <th className="py-2 pr-3">Reserved For</th>
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--ps-border)]/60">
                    {filteredTables.length === 0 ? (
                      <tr>
                        <td
                          colSpan={5}
                          className="py-8 text-center text-xs text-[var(--ps-text-muted)]"
                        >
                          No table reservations match this filter.
                        </td>
                      </tr>
                    ) : (
                      filteredTables.map((res) => (
                        <tr key={res.id}>
                          <td className="py-2.5 pr-3 font-mono font-bold text-emerald-700 dark:text-emerald-300">
                            {res.reservation_code}
                          </td>
                          <td className="py-2.5 pr-3">
                            <p className="font-bold text-[var(--ps-text)]">
                              {res.guest_name} ({res.party_size} guests)
                            </p>
                            {res.special_request && (
                              <p className="text-[10px] text-[var(--ps-text-muted)]">
                                {res.special_request}
                              </p>
                            )}
                          </td>
                          <td className="py-2.5 pr-3 font-mono text-[11px] text-[var(--ps-text)]">
                            {new Date(res.reserved_for).toLocaleString('en-IN', {
                              day: '2-digit',
                              month: 'short',
                              hour: '2-digit',
                              minute: '2-digit',
                            })}
                          </td>
                          <td className="py-2.5 pr-3">
                            <span className="rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-0.5 text-[10px] font-bold capitalize text-[var(--ps-text)]">
                              {res.status}
                            </span>
                          </td>
                          <td className="py-2.5 text-right">
                            <div className="inline-flex flex-wrap items-center justify-end gap-1">
                              {res.status === 'requested' && (
                                <>
                                  <button
                                    type="button"
                                    disabled={busyId === res.id}
                                    onClick={() =>
                                      void handleTableStatus(res.id, 'confirmed')
                                    }
                                    className="h-7 rounded-lg bg-emerald-600 px-2.5 text-[11px] font-bold text-white cursor-pointer"
                                  >
                                    Confirm
                                  </button>
                                  <button
                                    type="button"
                                    disabled={busyId === res.id}
                                    onClick={() =>
                                      void handleTableStatus(res.id, 'declined')
                                    }
                                    className="h-7 rounded-lg border border-rose-500/35 bg-rose-500/10 px-2.5 text-[11px] font-semibold text-rose-700 dark:text-rose-300 cursor-pointer"
                                  >
                                    Decline
                                  </button>
                                </>
                              )}
                              {res.status === 'confirmed' && (
                                <button
                                  type="button"
                                  disabled={busyId === res.id}
                                  onClick={() =>
                                    void handleTableStatus(res.id, 'seated')
                                  }
                                  className="h-7 rounded-lg bg-sky-600 px-2.5 text-[11px] font-bold text-white cursor-pointer"
                                >
                                  Mark Seated
                                </button>
                              )}
                              {res.status === 'seated' && (
                                <button
                                  type="button"
                                  disabled={busyId === res.id}
                                  onClick={() =>
                                    void handleTableStatus(res.id, 'completed')
                                  }
                                  className="h-7 rounded-lg bg-emerald-600 px-2.5 text-[11px] font-bold text-white cursor-pointer"
                                >
                                  Complete
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </ResponsiveTableScroll>
            </div>
          )}

          {/* 4. KITCHEN SETUP & SETTLEMENTS (OWNER ONLY) */}
          {restaurantTab === 'setup' && !isStaffMode && restaurantProfile && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-[var(--ps-text)]">
                      Kitchen Profile, FSSAI &amp; Dual-Payment Rules
                    </h3>
                    <p className="text-xs text-[var(--ps-text-muted)]">
                      FSSAI status:{' '}
                      {restaurantProfile.fssai_verified ? (
                        <span className="font-bold text-emerald-600 dark:text-emerald-400">
                          FSSAI Verified ✓
                        </span>
                      ) : (
                        <span className="font-semibold text-amber-600 dark:text-amber-400">
                          Pending Hub Check
                        </span>
                      )}
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsQrOpen(true)}
                    className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-orange-500/35 bg-orange-500/10 px-3 text-xs font-bold text-orange-700 dark:text-orange-300 cursor-pointer"
                  >
                    <QrCode className="h-3.5 w-3.5" />
                    <span>Table QR Menu Poster</span>
                  </button>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 text-xs">
                  <label className="space-y-1">
                    <span className="font-semibold text-[var(--ps-text-muted)]">
                      Cuisines (comma-separated)
                    </span>
                    <input
                      value={cuisinesInput}
                      onChange={(e) => setCuisinesInput(e.target.value)}
                      className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)]"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="font-semibold text-[var(--ps-text-muted)]">
                      Avg Cost for Two (₹)
                    </span>
                    <input
                      type="number"
                      value={restSetupDraft.avg_cost_for_two_inr}
                      onChange={(e) =>
                        setRestSetupDraft((p) => ({
                          ...p,
                          avg_cost_for_two_inr: e.target.value,
                        }))
                      }
                      className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)]"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="font-semibold text-[var(--ps-text-muted)]">
                      FSSAI License No.
                    </span>
                    <input
                      value={restSetupDraft.fssai_license_no}
                      onChange={(e) =>
                        setRestSetupDraft((p) => ({
                          ...p,
                          fssai_license_no: e.target.value,
                        }))
                      }
                      placeholder="14-digit FSSAI"
                      className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 font-mono text-xs text-[var(--ps-text)]"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="font-semibold text-[var(--ps-text-muted)]">
                      Min Order (₹)
                    </span>
                    <input
                      type="number"
                      value={restSetupDraft.min_order_inr}
                      onChange={(e) =>
                        setRestSetupDraft((p) => ({
                          ...p,
                          min_order_inr: e.target.value,
                        }))
                      }
                      className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)]"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="font-semibold text-[var(--ps-text-muted)]">
                      Packaging Fee (₹)
                    </span>
                    <input
                      type="number"
                      value={restSetupDraft.packaging_fee_inr}
                      onChange={(e) =>
                        setRestSetupDraft((p) => ({
                          ...p,
                          packaging_fee_inr: e.target.value,
                        }))
                      }
                      className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)]"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="font-semibold text-[var(--ps-text-muted)]">
                      Max Table Party Size
                    </span>
                    <input
                      type="number"
                      value={restSetupDraft.max_table_party_size}
                      onChange={(e) =>
                        setRestSetupDraft((p) => ({
                          ...p,
                          max_table_party_size: e.target.value,
                        }))
                      }
                      className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)]"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="font-semibold text-[var(--ps-text-muted)]">
                      Direct-Pay Max Cap (₹)
                    </span>
                    <input
                      type="number"
                      value={restSetupDraft.direct_pay_max_inr}
                      onChange={(e) =>
                        setRestSetupDraft((p) => ({
                          ...p,
                          direct_pay_max_inr: e.target.value,
                        }))
                      }
                      className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)]"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="font-semibold text-[var(--ps-text-muted)]">
                      Kitchen UPI ID
                    </span>
                    <input
                      value={restSetupDraft.shop_upi_id}
                      onChange={(e) =>
                        setRestSetupDraft((p) => ({
                          ...p,
                          shop_upi_id: e.target.value,
                        }))
                      }
                      placeholder="kitchen@upi"
                      className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 font-mono text-xs text-[var(--ps-text)]"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="font-semibold text-[var(--ps-text-muted)]">
                      UPI Payee Name
                    </span>
                    <input
                      value={restSetupDraft.shop_upi_name}
                      onChange={(e) =>
                        setRestSetupDraft((p) => ({
                          ...p,
                          shop_upi_name: e.target.value,
                        }))
                      }
                      className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)]"
                    />
                  </label>
                </div>

                <div className="flex flex-wrap gap-4 text-xs">
                  {(
                    [
                      ['is_pure_veg', 'Pure Veg Kitchen'],
                      ['allow_takeaway', 'Allow Self-Takeaway'],
                      ['allow_pick_n_drop', 'Allow Pick N Drop Delivery'],
                      ['allow_table_booking', 'Allow Table Reservations'],
                      ['allow_direct_pay', 'Allow Direct Counter/UPI (Takeaway)'],
                    ] as const
                  ).map(([key, label]) => (
                    <label
                      key={key}
                      className="inline-flex items-center gap-2 font-semibold text-[var(--ps-text)] cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={restSetupDraft[key]}
                        onChange={(e) =>
                          setRestSetupDraft((p) => ({
                            ...p,
                            [key]: e.target.checked,
                          }))
                        }
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={isSavingSetup}
                    onClick={() => void handleSaveRestaurantSetup()}
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-orange-600 px-4 text-xs font-bold text-white hover:bg-orange-700 disabled:opacity-60 cursor-pointer"
                  >
                    {isSavingSetup ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                    <span>Save Kitchen Settings</span>
                  </button>
                </div>
              </div>

              {/* Read-Only Settlements Table */}
              <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3">
                <h3 className="text-sm font-bold text-[var(--ps-text)]">
                  Food Escrow Settlements ({settlements.length})
                </h3>
                <ResponsiveTableScroll>
                  <table className="w-full min-w-[560px] text-left text-xs">
                    <thead>
                      <tr className="border-b border-[var(--ps-border)] text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                        <th className="py-2 pr-3">Date</th>
                        <th className="py-2 pr-3">Gross</th>
                        <th className="py-2 pr-3">Net Payout</th>
                        <th className="py-2 pr-3">Status</th>
                        <th className="py-2">UTR Ref</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--ps-border)]/60">
                      {settlements.length === 0 ? (
                        <tr>
                          <td
                            colSpan={5}
                            className="py-6 text-center text-xs text-[var(--ps-text-muted)]"
                          >
                            No escrow settlements recorded yet.
                          </td>
                        </tr>
                      ) : (
                        settlements.map((s) => (
                          <tr key={s.id}>
                            <td className="py-2 pr-3 text-[var(--ps-text-muted)]">
                              {new Date(s.created_at).toLocaleDateString('en-IN')}
                            </td>
                            <td className="py-2 pr-3 font-mono font-semibold">
                              {formatInr(s.gross_amount_inr)}
                            </td>
                            <td className="py-2 pr-3 font-mono font-bold text-emerald-700 dark:text-emerald-300">
                              {formatInr(s.net_payout_inr)}
                            </td>
                            <td className="py-2 pr-3 capitalize">{s.status}</td>
                            <td className="py-2 font-mono text-[11px] text-[var(--ps-text-muted)]">
                              {s.utr_reference || '—'}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </ResponsiveTableScroll>
              </div>
            </div>
          )}
        </div>
      )}

      {/* =================================================================== */}
      {/* MODE B: SHOP CATALOGUE STOREFRONT DESK                              */}
      {/* =================================================================== */}
      {selectedListing && isShop && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-1.5">
            {(
              [
                {
                  id: 'orders',
                  label: `Live Orders (${shopOrders.length})`,
                  icon: ShoppingBag,
                },
                {
                  id: 'stock',
                  label: `Quick Stock (${stockProducts.length})`,
                  icon: Store,
                },
                ...(!isStaffMode
                  ? [
                      {
                        id: 'setup' as const,
                        label: 'Setup & Settlements',
                        icon: Wallet,
                      },
                    ]
                  : []),
              ] as const
            ).map((t) => {
              const Icon = t.icon;
              const active = shopTab === t.id;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setShopTab(t.id)}
                  className={`inline-flex h-8 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold transition-colors cursor-pointer ${
                    active
                      ? 'bg-sky-600 text-white shadow-2xs'
                      : 'border border-[var(--ps-border)] bg-[var(--ps-surface)] text-[var(--ps-text-muted)] hover:text-[var(--ps-text)]'
                  }`}
                >
                  <Icon className="h-3.5 w-3.5" />
                  <span>{t.label}</span>
                </button>
              );
            })}
          </div>

          {/* 1. LIVE SHOP ORDERS */}
          {shopTab === 'orders' && (
            <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3">
              <WorkspaceTableToolbar
                searchQuery={orderSearch}
                onSearchChange={setOrderSearch}
                searchPlaceholder="Search order code or product…"
                totalCount={shopOrders.length}
                filteredCount={filteredShopOrders.length}
                hasActiveFilters={
                  Boolean(orderSearch) || orderStatusFilter !== 'all'
                }
                onResetFilters={() => {
                  setOrderSearch('');
                  setOrderStatusFilter('all');
                }}
              >
                <div className="flex flex-wrap items-center gap-1">
                  {[
                    { id: 'all', label: 'All' },
                    { id: 'confirmed', label: 'New' },
                    { id: 'packing', label: 'Packing' },
                    { id: 'ready_for_pickup', label: 'Ready' },
                    { id: 'completed', label: 'Completed' },
                  ].map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setOrderStatusFilter(f.id)}
                      className={`h-8 rounded-xl px-2.5 text-xs font-semibold cursor-pointer ${
                        orderStatusFilter === f.id
                          ? 'bg-sky-600 text-white'
                          : 'border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)]'
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </WorkspaceTableToolbar>

              <ResponsiveTableScroll>
                <table className="w-full min-w-[740px] text-left text-xs">
                  <thead>
                    <tr className="border-b border-[var(--ps-border)] text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                      <th className="py-2 pr-3">Order</th>
                      <th className="py-2 pr-3">Items</th>
                      <th className="py-2 pr-3">Handover &amp; Total</th>
                      <th className="py-2 pr-3">Status</th>
                      <th className="py-2 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--ps-border)]/60">
                    {filteredShopOrders.length === 0 ? (
                      <tr>
                        <td
                          colSpan={5}
                          className="py-8 text-center text-xs text-[var(--ps-text-muted)]"
                        >
                          No shop orders match this filter.
                        </td>
                      </tr>
                    ) : (
                      filteredShopOrders.map((order) => (
                        <tr key={order.id} className="align-top">
                          <td className="py-3 pr-3">
                            <p className="font-mono font-bold text-sky-700 dark:text-sky-300">
                              {order.order_code}
                            </p>
                            <p className="text-[10px] text-[var(--ps-text-muted)]">
                              {new Date(order.created_at).toLocaleTimeString(
                                'en-IN',
                                { hour: '2-digit', minute: '2-digit' }
                              )}
                            </p>
                          </td>
                          <td className="py-3 pr-3 max-w-xs">
                            {order.items_snapshot.map((line, i) => (
                              <p key={i} className="font-medium text-[var(--ps-text)]">
                                {line.qty}× {line.title}
                              </p>
                            ))}
                          </td>
                          <td className="py-3 pr-3">
                            <p className="font-mono font-bold text-[var(--ps-text)]">
                              {formatInr(order.total_amount_inr)}
                            </p>
                            <p className="text-[10px] text-[var(--ps-text-muted)]">
                              {order.handover_mode === 'pick_n_drop'
                                ? 'Pick N Drop Delivery'
                                : 'Counter Pickup'}{' '}
                              · {order.payment_status.replace(/_/g, ' ')}
                            </p>
                          </td>
                          <td className="py-3 pr-3">
                            <span className="inline-block rounded-md border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 py-0.5 text-[10px] font-bold capitalize text-[var(--ps-text)]">
                              {order.order_status.replace(/_/g, ' ')}
                            </span>
                          </td>
                          <td className="py-3 text-right">
                            <div className="inline-flex flex-wrap items-center justify-end gap-1.5">
                              {order.order_status === 'confirmed' && (
                                <button
                                  type="button"
                                  disabled={busyId === order.id}
                                  onClick={() =>
                                    void handleShopOrderAction(order.id, {
                                      action: 'update_status',
                                      nextStatus: 'packing',
                                    })
                                  }
                                  className="h-8 rounded-xl bg-sky-600 px-3 text-xs font-bold text-white hover:bg-sky-700 cursor-pointer"
                                >
                                  Start Packing
                                </button>
                              )}
                              {order.order_status === 'packing' && (
                                <button
                                  type="button"
                                  disabled={busyId === order.id}
                                  onClick={() =>
                                    void handleShopOrderAction(order.id, {
                                      action: 'update_status',
                                      nextStatus: 'ready_for_pickup',
                                    })
                                  }
                                  className="h-8 rounded-xl bg-indigo-600 px-3 text-xs font-bold text-white hover:bg-indigo-700 cursor-pointer"
                                >
                                  Mark Ready
                                </button>
                              )}
                              {order.order_status === 'ready_for_pickup' && (
                                <div className="flex flex-col items-end gap-1.5">
                                  <div className="flex items-center gap-1.5">
                                    <input
                                      type="text"
                                      inputMode="numeric"
                                      maxLength={4}
                                      placeholder="4-digit OTP"
                                      value={otpInputs[order.id] || ''}
                                      onChange={(e) =>
                                        setOtpInputs((prev) => ({
                                          ...prev,
                                          [order.id]: e.target.value.replace(
                                            /\D/g,
                                            ''
                                          ),
                                        }))
                                      }
                                      className="h-8 w-24 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 font-mono text-xs text-center font-bold text-[var(--ps-text)]"
                                    />
                                    <button
                                      type="button"
                                      disabled={
                                        busyId === order.id ||
                                        (otpInputs[order.id] || '').length < 4
                                      }
                                      onClick={() =>
                                        void handleShopOrderAction(order.id, {
                                          action: 'verify_otp_handover',
                                        })
                                      }
                                      className="inline-flex h-8 items-center gap-1 rounded-xl bg-emerald-600 px-3 text-xs font-bold text-white hover:bg-emerald-700 disabled:opacity-50 cursor-pointer"
                                    >
                                      <KeyRound className="h-3.5 w-3.5" />
                                      <span>Verify OTP</span>
                                    </button>
                                  </div>
                                  {order.payment_rail !== 'platform_escrow' && (
                                    <label className="inline-flex items-center gap-1.5 text-[10px] font-medium text-[var(--ps-text-muted)] cursor-pointer">
                                      <input
                                        type="checkbox"
                                        checked={Boolean(
                                          directCollectedMap[order.id]
                                        )}
                                        onChange={(e) =>
                                          setDirectCollectedMap((prev) => ({
                                            ...prev,
                                            [order.id]: e.target.checked,
                                          }))
                                        }
                                      />
                                      <span>Counter Cash/UPI Collected</span>
                                    </label>
                                  )}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </ResponsiveTableScroll>
            </div>
          )}

          {/* 2. QUICK STOCK MANAGER */}
          {shopTab === 'stock' && (
            <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3">
              <WorkspaceTableToolbar
                searchQuery={stockSearch}
                onSearchChange={setStockSearch}
                searchPlaceholder="Search product or category tag…"
                totalCount={stockProducts.length}
                filteredCount={filteredStock.length}
                hasActiveFilters={Boolean(stockSearch)}
                onResetFilters={() => setStockSearch('')}
                actions={
                  !isStaffMode ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5 py-1 text-[11px] font-bold text-[var(--ps-text-muted)]">
                        Quota: {stockProducts.length} /{' '}
                        {maxCatalogueItemsLimit < 0
                          ? 'Unlimited'
                          : maxCatalogueItemsLimit}
                      </span>
                      <button
                        type="button"
                        disabled={
                          maxCatalogueItemsLimit >= 0 &&
                          stockProducts.length >= maxCatalogueItemsLimit
                        }
                        onClick={() => {
                          setProductTempPaths([]);
                          setProductDraft(EMPTY_SHOP_PRODUCT_DRAFT);
                          setIsProductModalOpen(true);
                        }}
                        className="inline-flex h-8 items-center gap-1.5 rounded-xl bg-sky-600 px-3 text-xs font-bold text-white hover:bg-sky-700 disabled:opacity-50 cursor-pointer"
                      >
                        <Plus className="h-3.5 w-3.5" />
                        <span>Add Product</span>
                      </button>
                    </div>
                  ) : undefined
                }
              />
              <ResponsiveTableScroll>
                <table className="w-full min-w-[700px] text-left text-xs">
                  <thead>
                    <tr className="border-b border-[var(--ps-border)] text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                      <th className="py-2 pr-3">Product</th>
                      <th className="py-2 pr-3">Price</th>
                      <th className="py-2 pr-3">Unit Label</th>
                      <th className="py-2 pr-3">Category Tag</th>
                      <th className="py-2 pr-3">Stock (1-Tap)</th>
                      <th className="py-2 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[var(--ps-border)]/60">
                    {filteredStock.length === 0 ? (
                      <tr>
                        <td
                          colSpan={6}
                          className="py-8 text-center text-xs text-[var(--ps-text-muted)]"
                        >
                          No products listed under this storefront yet. Click &ldquo;Add Product&rdquo; above to add catalogue items.
                        </td>
                      </tr>
                    ) : (
                      filteredStock.map((prod) => {
                        const draft = stockDrafts[prod.id] || {
                          unit_label: prod.unit_label || '',
                          shop_category_tag: prod.shop_category_tag || '',
                        };
                        return (
                          <tr key={prod.id}>
                            <td className="py-2.5 pr-3">
                              <div className="flex items-center gap-2">
                                {prod.thumbnail_url ? (
                                  <img
                                    src={prod.thumbnail_url}
                                    alt={prod.title}
                                    className="h-8 w-8 rounded-lg object-cover border border-[var(--ps-border)] shrink-0"
                                  />
                                ) : null}
                                <div>
                                  <div className="font-bold text-[var(--ps-text)]">
                                    {prod.title}
                                  </div>
                                  {(prod.sku_variant_note ||
                                    prod.stock_count != null) && (
                                    <div className="text-[10px] text-[var(--ps-text-muted)]">
                                      {prod.sku_variant_note
                                        ? `${prod.sku_variant_note} · `
                                        : ''}
                                      {prod.stock_count != null
                                        ? `Qty: ${prod.stock_count}`
                                        : ''}
                                    </div>
                                  )}
                                </div>
                              </div>
                            </td>
                            <td className="py-2.5 pr-3 font-mono font-bold">
                              {formatInr(prod.price)}
                            </td>
                            <td className="py-2.5 pr-3">
                              <input
                                value={draft.unit_label}
                                onChange={(e) =>
                                  setStockDrafts((prev) => ({
                                    ...prev,
                                    [prod.id]: {
                                      ...draft,
                                      unit_label: e.target.value,
                                    },
                                  }))
                                }
                                placeholder="e.g. 500g / Piece"
                                className="h-8 w-28 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 text-xs text-[var(--ps-text)]"
                              />
                            </td>
                            <td className="py-2.5 pr-3">
                              <input
                                value={draft.shop_category_tag}
                                onChange={(e) =>
                                  setStockDrafts((prev) => ({
                                    ...prev,
                                    [prod.id]: {
                                      ...draft,
                                      shop_category_tag: e.target.value,
                                    },
                                  }))
                                }
                                placeholder="Groceries / Pharma"
                                className="h-8 w-32 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 text-xs text-[var(--ps-text)]"
                              />
                            </td>
                            <td className="py-2.5 pr-3">
                              <button
                                type="button"
                                disabled={busyId === prod.id}
                                onClick={() => void handleToggleShopStock(prod)}
                                className={`inline-flex h-7 items-center rounded-lg px-2.5 text-[11px] font-bold cursor-pointer ${
                                  prod.in_stock
                                    ? 'border border-emerald-500/35 bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                                    : 'border border-rose-500/35 bg-rose-500/12 text-rose-700 dark:text-rose-300'
                                }`}
                              >
                                {prod.in_stock ? 'In Stock' : 'Out of Stock'}
                              </button>
                            </td>
                            <td className="py-2.5 text-right">
                              <div className="inline-flex items-center justify-end gap-1.5">
                                <button
                                  type="button"
                                  disabled={busyId === prod.id}
                                  onClick={() =>
                                    void handleSaveShopProductMeta(prod.id)
                                  }
                                  className="inline-flex h-7 items-center gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 text-[11px] font-semibold text-[var(--ps-text)] hover:border-sky-500 cursor-pointer"
                                >
                                  <Check className="h-3 w-3" />
                                  <span>Save</span>
                                </button>
                                {!isStaffMode && (
                                  <>
                                    <button
                                      type="button"
                                      onClick={() => {
                                        setProductTempPaths([]);
                                        setProductDraft({
                                          id: prod.id,
                                          title: prod.title,
                                          description: prod.description || '',
                                          category:
                                            prod.category ||
                                            prod.shop_category_tag ||
                                            'Groceries & Daily',
                                          shop_category_tag:
                                            prod.shop_category_tag ||
                                            prod.category ||
                                            'Groceries & Daily',
                                          price: String(prod.price),
                                          unit: prod.unit || 'Piece',
                                          unit_label:
                                            prod.unit_label ||
                                            prod.unit ||
                                            '1 Piece',
                                          stock_count:
                                            prod.stock_count != null
                                              ? String(prod.stock_count)
                                              : '',
                                          sku_variant_note:
                                            prod.sku_variant_note || '',
                                          supports_pick_n_drop:
                                            prod.supports_pick_n_drop !== false,
                                          in_stock: prod.in_stock !== false,
                                          thumbnail_url:
                                            prod.thumbnail_url || '',
                                        });
                                        setIsProductModalOpen(true);
                                      }}
                                      className="inline-flex h-7 items-center gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2 text-[11px] font-semibold text-[var(--ps-text)] hover:border-sky-500 cursor-pointer"
                                    >
                                      <Edit3 className="h-3 w-3" />
                                      <span>Edit</span>
                                    </button>
                                    <button
                                      type="button"
                                      disabled={busyId === prod.id}
                                      onClick={() =>
                                        void handleDeleteShopProduct(prod)
                                      }
                                      className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-rose-500/30 bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 cursor-pointer"
                                      title="Delete product"
                                    >
                                      <Trash2 className="h-3 w-3" />
                                    </button>
                                  </>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </ResponsiveTableScroll>
            </div>
          )}

          {/* 3. STORE SETUP & SETTLEMENTS (OWNER ONLY) */}
          {shopTab === 'setup' && !isStaffMode && shopProfile && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div>
                    <h3 className="text-sm font-bold text-[var(--ps-text)]">
                      Storefront Controls &amp; Dual-Payment Policy
                    </h3>
                    <p className="text-xs text-[var(--ps-text-muted)]">
                      Store status:{' '}
                      {shopProfile.store_verified ? (
                        <span className="font-bold text-emerald-600 dark:text-emerald-400">
                          Verified Store ✓
                        </span>
                      ) : (
                        <span className="font-semibold text-amber-600 dark:text-amber-400">
                          Pending Hub Verification
                        </span>
                      )}
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      disabled={busyId === 'shop-pause'}
                      onClick={() => void handleShopQuickPause(null)}
                      className="h-8 rounded-xl border border-emerald-500/35 bg-emerald-500/10 px-2.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300 cursor-pointer"
                    >
                      Resume Orders
                    </button>
                    <button
                      type="button"
                      disabled={busyId === 'shop-pause'}
                      onClick={() => void handleShopQuickPause(30)}
                      className="h-8 rounded-xl border border-amber-500/35 bg-amber-500/10 px-2.5 text-xs font-semibold text-amber-800 dark:text-amber-300 cursor-pointer"
                    >
                      Pause 30m
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsQrOpen(true)}
                      className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-sky-500/35 bg-sky-500/10 px-3 text-xs font-bold text-sky-700 dark:text-sky-300 cursor-pointer"
                    >
                      <QrCode className="h-3.5 w-3.5" />
                      <span>Storefront QR Poster</span>
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 text-xs">
                  <label className="space-y-1">
                    <span className="font-semibold text-[var(--ps-text-muted)]">
                      Prep Time (mins)
                    </span>
                    <input
                      type="number"
                      value={shopSetupDraft.prep_time_mins}
                      onChange={(e) =>
                        setShopSetupDraft((p) => ({
                          ...p,
                          prep_time_mins: e.target.value,
                        }))
                      }
                      className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)]"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="font-semibold text-[var(--ps-text-muted)]">
                      Min Order (₹)
                    </span>
                    <input
                      type="number"
                      value={shopSetupDraft.min_order_inr}
                      onChange={(e) =>
                        setShopSetupDraft((p) => ({
                          ...p,
                          min_order_inr: e.target.value,
                        }))
                      }
                      className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)]"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="font-semibold text-[var(--ps-text-muted)]">
                      Packaging Fee (₹)
                    </span>
                    <input
                      type="number"
                      value={shopSetupDraft.packaging_fee_inr}
                      onChange={(e) =>
                        setShopSetupDraft((p) => ({
                          ...p,
                          packaging_fee_inr: e.target.value,
                        }))
                      }
                      className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)]"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="font-semibold text-[var(--ps-text-muted)]">
                      Direct-Pay Max Cap (₹)
                    </span>
                    <input
                      type="number"
                      value={shopSetupDraft.direct_pay_max_inr}
                      onChange={(e) =>
                        setShopSetupDraft((p) => ({
                          ...p,
                          direct_pay_max_inr: e.target.value,
                        }))
                      }
                      className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)]"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="font-semibold text-[var(--ps-text-muted)]">
                      Shop UPI ID
                    </span>
                    <input
                      value={shopSetupDraft.shop_upi_id}
                      onChange={(e) =>
                        setShopSetupDraft((p) => ({
                          ...p,
                          shop_upi_id: e.target.value,
                        }))
                      }
                      placeholder="shop@upi"
                      className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 font-mono text-xs text-[var(--ps-text)]"
                    />
                  </label>
                  <label className="space-y-1">
                    <span className="font-semibold text-[var(--ps-text-muted)]">
                      UPI Payee Name
                    </span>
                    <input
                      value={shopSetupDraft.shop_upi_name}
                      onChange={(e) =>
                        setShopSetupDraft((p) => ({
                          ...p,
                          shop_upi_name: e.target.value,
                        }))
                      }
                      className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)]"
                    />
                  </label>
                </div>

                <label className="block space-y-1 text-xs">
                  <span className="font-semibold text-[var(--ps-text-muted)]">
                    Counter Pickup Instructions
                  </span>
                  <input
                    value={shopSetupDraft.pickup_instructions}
                    onChange={(e) =>
                      setShopSetupDraft((p) => ({
                        ...p,
                        pickup_instructions: e.target.value,
                      }))
                    }
                    placeholder="e.g. Show 4-digit OTP at front billing counter"
                    className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)]"
                  />
                </label>

                <div className="flex flex-wrap gap-4 text-xs">
                  {(
                    [
                      ['is_accepting_orders', 'Accepting Live Orders'],
                      ['allow_counter_pickup', 'Allow Counter Pickup'],
                      ['allow_pick_n_drop', 'Allow Pick N Drop Delivery'],
                      ['allow_direct_pay', 'Allow Direct Counter/UPI Payment'],
                    ] as const
                  ).map(([key, label]) => (
                    <label
                      key={key}
                      className="inline-flex items-center gap-2 font-semibold text-[var(--ps-text)] cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={shopSetupDraft[key]}
                        onChange={(e) =>
                          setShopSetupDraft((p) => ({
                            ...p,
                            [key]: e.target.checked,
                          }))
                        }
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>

                <div className="flex justify-end">
                  <button
                    type="button"
                    disabled={isSavingSetup}
                    onClick={() => void handleSaveShopSetup()}
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-sky-600 px-4 text-xs font-bold text-white hover:bg-sky-700 disabled:opacity-60 cursor-pointer"
                  >
                    {isSavingSetup ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <Save className="h-3.5 w-3.5" />
                    )}
                    <span>Save Storefront Settings</span>
                  </button>
                </div>
              </div>

              {/* Read-Only Settlements Table */}
              <div className="rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-4 space-y-3">
                <h3 className="text-sm font-bold text-[var(--ps-text)]">
                  Shop Escrow Settlements ({settlements.length})
                </h3>
                <ResponsiveTableScroll>
                  <table className="w-full min-w-[560px] text-left text-xs">
                    <thead>
                      <tr className="border-b border-[var(--ps-border)] text-[10px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                        <th className="py-2 pr-3">Date</th>
                        <th className="py-2 pr-3">Gross</th>
                        <th className="py-2 pr-3">Net Payout</th>
                        <th className="py-2 pr-3">Status</th>
                        <th className="py-2">UTR Ref</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[var(--ps-border)]/60">
                      {settlements.length === 0 ? (
                        <tr>
                          <td
                            colSpan={5}
                            className="py-6 text-center text-xs text-[var(--ps-text-muted)]"
                          >
                            No escrow settlements recorded yet.
                          </td>
                        </tr>
                      ) : (
                        settlements.map((s) => (
                          <tr key={s.id}>
                            <td className="py-2 pr-3 text-[var(--ps-text-muted)]">
                              {new Date(s.created_at).toLocaleDateString('en-IN')}
                            </td>
                            <td className="py-2 pr-3 font-mono font-semibold">
                              {formatInr(s.gross_amount_inr)}
                            </td>
                            <td className="py-2 pr-3 font-mono font-bold text-emerald-700 dark:text-emerald-300">
                              {formatInr(s.net_payout_inr)}
                            </td>
                            <td className="py-2 pr-3 capitalize">{s.status}</td>
                            <td className="py-2 font-mono text-[11px] text-[var(--ps-text-muted)]">
                              {s.utr_reference || '—'}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </ResponsiveTableScroll>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Printable QR Poster Modal (z-[90]) */}
      {selectedListing && (isRestaurant || isShop) && (
        <CommerceQrPosterModal
          open={isQrOpen}
          onClose={() => setIsQrOpen(false)}
          listingId={selectedListing.id}
          listingTitle={selectedListing.title}
          listingLocality={selectedListing.locality}
          mode={isRestaurant ? 'restaurant_food' : 'shop_catalogue'}
        />
      )}

      {/* Add / Edit Dish Modal (z-[90], Owner Only) */}
      {isDishModalOpen &&
        !isStaffMode &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            onClick={handleCancelDishModal}
          >
            <div
              className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5 shadow-2xl space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-[var(--ps-border)] pb-3">
                <h3 className="text-sm font-bold text-[var(--ps-text)]">
                  {dishDraft.id ? 'Edit Menu Dish' : 'Add Menu Dish'}
                </h3>
                <button
                  type="button"
                  onClick={handleCancelDishModal}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--ps-border)] text-[var(--ps-text-muted)] cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-xs">
                <label className="space-y-1 sm:col-span-2">
                  <span className="font-semibold text-[var(--ps-text-muted)]">
                    Dish Name *
                  </span>
                  <input
                    value={dishDraft.name}
                    onChange={(e) =>
                      setDishDraft((p) => ({ ...p, name: e.target.value }))
                    }
                    placeholder="e.g. Steamed Pork Momo (8 pcs)"
                    className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)]"
                  />
                </label>

                <CustomSelectModal
                  label="Dish Category"
                  value={dishDraft.category_name}
                  onChange={(val) =>
                    setDishDraft((p) => ({
                      ...p,
                      category_name: val,
                    }))
                  }
                  options={
                    DISH_CATEGORY_OPTIONS.some(
                      (o) => o.value === dishDraft.category_name
                    )
                      ? DISH_CATEGORY_OPTIONS
                      : [
                          ...DISH_CATEGORY_OPTIONS,
                          {
                            value: dishDraft.category_name || 'Mains',
                            label: dishDraft.category_name || 'Mains',
                          },
                        ]
                  }
                />

                <label className="space-y-1">
                  <span className="font-semibold text-[var(--ps-text-muted)]">
                    Base Price (₹) *
                  </span>
                  <input
                    type="number"
                    value={dishDraft.base_price_inr}
                    onChange={(e) =>
                      setDishDraft((p) => ({
                        ...p,
                        base_price_inr: e.target.value,
                      }))
                    }
                    className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)]"
                  />
                </label>
                <CustomSelectModal
                  label="Diet Type"
                  value={dishDraft.diet_type}
                  onChange={(val) =>
                    setDishDraft((p) => ({
                      ...p,
                      diet_type: val as MenuDietType,
                    }))
                  }
                  options={[
                    { value: 'veg', label: 'Veg' },
                    { value: 'egg', label: 'Egg' },
                    { value: 'non_veg', label: 'Non-Veg' },
                  ]}
                />
                <CustomSelectModal
                  label="Meal Slot"
                  value={dishDraft.meal_slot}
                  onChange={(val) =>
                    setDishDraft((p) => ({
                      ...p,
                      meal_slot: val as MenuMealSlot,
                    }))
                  }
                  options={[
                    { value: 'all_day', label: 'All Day' },
                    { value: 'breakfast', label: 'Breakfast' },
                    { value: 'lunch', label: 'Lunch' },
                    { value: 'dinner', label: 'Dinner' },
                  ]}
                />

                <CustomSelectModal
                  label="Spice Level"
                  value={dishDraft.spice_level}
                  onChange={(val) => {
                    const level = val as 'mild' | 'medium' | 'hot';
                    setDishDraft((p) => ({
                      ...p,
                      spice_level: level,
                      is_spicy: level !== 'mild',
                    }));
                  }}
                  options={[
                    { value: 'mild', label: 'Mild / Non-Spicy' },
                    { value: 'medium', label: 'Medium Spice' },
                    { value: 'hot', label: 'Hot & Fiery' },
                  ]}
                />

                <label className="space-y-1">
                  <span className="font-semibold text-[var(--ps-text-muted)]">
                    Est. Prep Time (Mins)
                  </span>
                  <input
                    type="number"
                    min={1}
                    max={180}
                    value={dishDraft.prep_time_mins}
                    onChange={(e) =>
                      setDishDraft((p) => ({
                        ...p,
                        prep_time_mins: e.target.value,
                      }))
                    }
                    className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)]"
                  />
                </label>

                <label className="space-y-1 sm:col-span-2">
                  <span className="font-semibold text-[var(--ps-text-muted)]">
                    Portion / Serving Note
                  </span>
                  <input
                    value={dishDraft.portion_note}
                    onChange={(e) =>
                      setDishDraft((p) => ({
                        ...p,
                        portion_note: e.target.value,
                      }))
                    }
                    placeholder="e.g. Serves 1-2 · 8 Pieces with fiery chutney"
                    className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)]"
                  />
                </label>

                <label className="space-y-1 sm:col-span-2">
                  <span className="font-semibold text-[var(--ps-text-muted)]">
                    Short Description
                  </span>
                  <input
                    value={dishDraft.description}
                    onChange={(e) =>
                      setDishDraft((p) => ({
                        ...p,
                        description: e.target.value,
                      }))
                    }
                    placeholder="Ingredients, taste notes, or allergen info"
                    className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)]"
                  />
                </label>

                <div className="sm:col-span-2">
                  <QuickImageUploadField
                    label="Dish Photo (Optional)"
                    value={dishDraft.image_url}
                    entityType="listing_gallery"
                    entityId={selectedListing?.id}
                    hubId={selectedListing?.hub_id}
                    onUploaded={(nextUrl, storagePath) => {
                      setDishDraft((p) => ({ ...p, image_url: nextUrl }));
                      if (storagePath) {
                        setDishTempPaths((prev) => [...prev, storagePath]);
                      }
                    }}
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-4 text-xs">
                <label className="inline-flex items-center gap-1.5 font-semibold cursor-pointer">
                  <input
                    type="checkbox"
                    checked={dishDraft.is_bestseller}
                    onChange={(e) =>
                      setDishDraft((p) => ({
                        ...p,
                        is_bestseller: e.target.checked,
                      }))
                    }
                  />
                  <span>Bestseller</span>
                </label>
                <label className="inline-flex items-center gap-1.5 font-semibold cursor-pointer">
                  <input
                    type="checkbox"
                    checked={dishDraft.is_spicy}
                    onChange={(e) =>
                      setDishDraft((p) => ({
                        ...p,
                        is_spicy: e.target.checked,
                        spice_level: e.target.checked
                          ? p.spice_level === 'mild'
                            ? 'hot'
                            : p.spice_level
                          : 'mild',
                      }))
                    }
                  />
                  <span>Spicy</span>
                </label>
                <label className="inline-flex items-center gap-1.5 font-semibold cursor-pointer">
                  <input
                    type="checkbox"
                    checked={dishDraft.in_stock}
                    onChange={(e) =>
                      setDishDraft((p) => ({ ...p, in_stock: e.target.checked }))
                    }
                  />
                  <span>In Stock</span>
                </label>
              </div>

              {/* Dynamic Variants */}
              <div className="space-y-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                    Portion Variants ({dishDraft.variants.length})
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setDishDraft((p) => ({
                        ...p,
                        variants: [
                          ...p.variants,
                          {
                            key: `var_${Date.now()}`,
                            label: 'Full Plate',
                            price_inr: Number(p.base_price_inr) || 120,
                          },
                        ],
                      }))
                    }
                    className="inline-flex h-7 items-center gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2 text-[11px] font-semibold cursor-pointer"
                  >
                    <Plus className="h-3 w-3" />
                    <span>Add Variant</span>
                  </button>
                </div>
                {dishDraft.variants.map((v, idx) => (
                  <div key={v.key} className="flex items-center gap-2">
                    <input
                      value={v.label}
                      onChange={(e) =>
                        setDishDraft((p) => ({
                          ...p,
                          variants: p.variants.map((row, i) =>
                            i === idx ? { ...row, label: e.target.value } : row
                          ),
                        }))
                      }
                      placeholder="Half / Full"
                      className="h-8 flex-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2 text-xs"
                    />
                    <input
                      type="number"
                      value={v.price_inr}
                      onChange={(e) =>
                        setDishDraft((p) => ({
                          ...p,
                          variants: p.variants.map((row, i) =>
                            i === idx
                              ? { ...row, price_inr: Number(e.target.value) || 0 }
                              : row
                          ),
                        }))
                      }
                      className="h-8 w-24 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2 text-xs"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setDishDraft((p) => ({
                          ...p,
                          variants: p.variants.filter((_, i) => i !== idx),
                        }))
                      }
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-rose-500 hover:bg-rose-500/10 cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              {/* Dynamic Add-ons */}
              <div className="space-y-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3">
                <div className="flex items-center justify-between">
                  <span className="text-[11px] font-bold uppercase tracking-wider text-[var(--ps-text-muted)]">
                    Add-ons ({dishDraft.addons.length})
                  </span>
                  <button
                    type="button"
                    onClick={() =>
                      setDishDraft((p) => ({
                        ...p,
                        addons: [
                          ...p.addons,
                          {
                            key: `add_${Date.now()}`,
                            label: 'Extra Dip',
                            price_inr: 20,
                          },
                        ],
                      }))
                    }
                    className="inline-flex h-7 items-center gap-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2 text-[11px] font-semibold cursor-pointer"
                  >
                    <Plus className="h-3 w-3" />
                    <span>Add Add-on</span>
                  </button>
                </div>
                {dishDraft.addons.map((a, idx) => (
                  <div key={a.key} className="flex items-center gap-2">
                    <input
                      value={a.label}
                      onChange={(e) =>
                        setDishDraft((p) => ({
                          ...p,
                          addons: p.addons.map((row, i) =>
                            i === idx ? { ...row, label: e.target.value } : row
                          ),
                        }))
                      }
                      placeholder="Extra Cheese"
                      className="h-8 flex-1 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2 text-xs"
                    />
                    <input
                      type="number"
                      value={a.price_inr}
                      onChange={(e) =>
                        setDishDraft((p) => ({
                          ...p,
                          addons: p.addons.map((row, i) =>
                            i === idx
                              ? { ...row, price_inr: Number(e.target.value) || 0 }
                              : row
                          ),
                        }))
                      }
                      className="h-8 w-24 rounded-lg border border-[var(--ps-border)] bg-[var(--ps-surface)] px-2 text-xs"
                    />
                    <button
                      type="button"
                      onClick={() =>
                        setDishDraft((p) => ({
                          ...p,
                          addons: p.addons.filter((_, i) => i !== idx),
                        }))
                      }
                      className="flex h-8 w-8 items-center justify-center rounded-lg text-rose-500 hover:bg-rose-500/10 cursor-pointer"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleCancelDishModal}
                  className="h-9 rounded-xl border border-[var(--ps-border)] px-4 text-xs font-semibold text-[var(--ps-text-muted)] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isSavingDish}
                  onClick={() => void handleSaveDish()}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-orange-600 px-4 text-xs font-bold text-white hover:bg-orange-700 disabled:opacity-60 cursor-pointer"
                >
                  {isSavingDish ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  )}
                  <span>Save Dish</span>
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {/* Add / Edit Shop Product Modal (z-[90], Owner Only) */}
      {isProductModalOpen &&
        !isStaffMode &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            className="fixed inset-0 z-[90] flex items-center justify-center bg-slate-950/75 p-4 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            onClick={handleCancelProductModal}
          >
            <div
              className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5 shadow-2xl space-y-4"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-center justify-between border-b border-[var(--ps-border)] pb-3">
                <h3 className="text-sm font-bold text-[var(--ps-text)]">
                  {productDraft.id
                    ? 'Edit Store Catalogue Product'
                    : 'Add Store Catalogue Product'}
                </h3>
                <button
                  type="button"
                  onClick={handleCancelProductModal}
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-[var(--ps-border)] text-[var(--ps-text-muted)] cursor-pointer"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 text-xs">
                <label className="space-y-1 sm:col-span-2">
                  <span className="font-semibold text-[var(--ps-text-muted)]">
                    Product Name *
                  </span>
                  <input
                    value={productDraft.title}
                    onChange={(e) =>
                      setProductDraft((p) => ({ ...p, title: e.target.value }))
                    }
                    placeholder="e.g. Organic Hill Honey (500g Glass Jar)"
                    className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)]"
                  />
                </label>

                <CustomSelectModal
                  label="Catalogue Category"
                  value={productDraft.category}
                  onChange={(val) =>
                    setProductDraft((p) => ({
                      ...p,
                      category: val,
                      shop_category_tag: val,
                    }))
                  }
                  options={
                    SHOP_CATEGORY_OPTIONS.some(
                      (o) => o.value === productDraft.category
                    )
                      ? SHOP_CATEGORY_OPTIONS
                      : [
                          ...SHOP_CATEGORY_OPTIONS,
                          {
                            value: productDraft.category || 'General',
                            label: productDraft.category || 'General',
                          },
                        ]
                  }
                />

                <label className="space-y-1">
                  <span className="font-semibold text-[var(--ps-text-muted)]">
                    Selling Price (₹) *
                  </span>
                  <input
                    type="number"
                    min={1}
                    value={productDraft.price}
                    onChange={(e) =>
                      setProductDraft((p) => ({
                        ...p,
                        price: e.target.value,
                      }))
                    }
                    className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)]"
                  />
                </label>

                <CustomSelectModal
                  label="Base Unit"
                  value={productDraft.unit}
                  onChange={(val) =>
                    setProductDraft((p) => ({
                      ...p,
                      unit: val,
                      unit_label: p.unit_label || val,
                    }))
                  }
                  options={SHOP_UNIT_OPTIONS}
                />

                <label className="space-y-1">
                  <span className="font-semibold text-[var(--ps-text-muted)]">
                    Display Unit Label
                  </span>
                  <input
                    value={productDraft.unit_label}
                    onChange={(e) =>
                      setProductDraft((p) => ({
                        ...p,
                        unit_label: e.target.value,
                      }))
                    }
                    placeholder="e.g. 500g Jar / 1 Strip"
                    className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)]"
                  />
                </label>

                <label className="space-y-1">
                  <span className="font-semibold text-[var(--ps-text-muted)]">
                    Available Stock Qty (Optional)
                  </span>
                  <input
                    type="number"
                    min={0}
                    value={productDraft.stock_count}
                    onChange={(e) =>
                      setProductDraft((p) => ({
                        ...p,
                        stock_count: e.target.value,
                      }))
                    }
                    placeholder="Leave blank if untracked"
                    className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)]"
                  />
                </label>

                <label className="space-y-1">
                  <span className="font-semibold text-[var(--ps-text-muted)]">
                    SKU / Variant / Size Note
                  </span>
                  <input
                    value={productDraft.sku_variant_note}
                    onChange={(e) =>
                      setProductDraft((p) => ({
                        ...p,
                        sku_variant_note: e.target.value,
                      }))
                    }
                    placeholder="e.g. Pack of 2 · Medium"
                    className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)]"
                  />
                </label>

                <label className="space-y-1 sm:col-span-2">
                  <span className="font-semibold text-[var(--ps-text-muted)]">
                    Product Description
                  </span>
                  <input
                    value={productDraft.description}
                    onChange={(e) =>
                      setProductDraft((p) => ({
                        ...p,
                        description: e.target.value,
                      }))
                    }
                    placeholder="Brand, specs, or usage notes"
                    className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 text-xs text-[var(--ps-text)]"
                  />
                </label>

                <div className="sm:col-span-2">
                  <QuickImageUploadField
                    label="Product Thumbnail Photo"
                    value={productDraft.thumbnail_url}
                    entityType="product_image"
                    entityId={selectedListing?.id}
                    hubId={selectedListing?.hub_id}
                    onUploaded={(nextUrl, storagePath) => {
                      setProductDraft((p) => ({
                        ...p,
                        thumbnail_url: nextUrl,
                      }));
                      if (storagePath) {
                        setProductTempPaths((prev) => [...prev, storagePath]);
                      }
                    }}
                  />
                </div>
              </div>

              <div className="flex flex-wrap gap-4 text-xs">
                <label className="inline-flex items-center gap-1.5 font-semibold cursor-pointer">
                  <input
                    type="checkbox"
                    checked={productDraft.in_stock}
                    onChange={(e) =>
                      setProductDraft((p) => ({
                        ...p,
                        in_stock: e.target.checked,
                      }))
                    }
                  />
                  <span>Currently In Stock</span>
                </label>
                <label className="inline-flex items-center gap-1.5 font-semibold cursor-pointer">
                  <input
                    type="checkbox"
                    checked={productDraft.supports_pick_n_drop}
                    onChange={(e) =>
                      setProductDraft((p) => ({
                        ...p,
                        supports_pick_n_drop: e.target.checked,
                      }))
                    }
                  />
                  <span>Supports Pick N Drop Delivery</span>
                </label>
              </div>

              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={handleCancelProductModal}
                  className="h-9 rounded-xl border border-[var(--ps-border)] px-4 text-xs font-semibold text-[var(--ps-text-muted)] cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isSavingProduct}
                  onClick={() => void handleSaveShopProduct()}
                  className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-sky-600 px-4 text-xs font-bold text-white hover:bg-sky-700 disabled:opacity-60 cursor-pointer"
                >
                  {isSavingProduct ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  ) : (
                    <CheckCircle2 className="h-3.5 w-3.5" />
                  )}
                  <span>Save Product</span>
                </button>
              </div>
            </div>
          </div>,
          document.body
        )}

      {confirmDialog}

      {/* Order Reject / Cancel Reason FormModal (v18b) */}
      <FormModal
        isOpen={Boolean(cancelReasonModal)}
        onClose={() => {
          setCancelReasonModal(null);
          setCancelReasonText('');
          setCancelReasonTouched(false);
          setCancelReasonSubmitted(false);
        }}
        title={
          cancelReasonModal?.kind === 'restaurant'
            ? 'Reject Kitchen Order'
            : 'Cancel Store Order'
        }
        subtitle="Provide a brief, clear reason so the customer knows why this order could not be fulfilled."
        isDirty={cancelReasonText.trim().length > 0}
        isValid={cancelReasonText.trim().length >= 5}
        validationSummary={
          cancelReasonSubmitted && cancelReasonText.trim().length < 5
            ? ['Please provide a cancellation reason (at least 5 characters).']
            : undefined
        }
        onSubmitAttempt={() => setCancelReasonSubmitted(true)}
        isSubmitting={Boolean(
          cancelReasonModal && busyId === cancelReasonModal.orderId
        )}
        submitLabel={
          cancelReasonModal?.kind === 'restaurant'
            ? 'Confirm Reject Order'
            : 'Confirm Cancel Order'
        }
        cancelLabel="Keep Order"
        confirmSubmitTitle={
          cancelReasonModal?.kind === 'restaurant'
            ? 'Reject Kitchen Order?'
            : 'Cancel Store Order?'
        }
        confirmSubmitDescription="Notifies the customer immediately with your reason and logs this transition."
        confirmSubmitVariant="danger"
        maxWidthClassName="max-w-md"
        cautions={[
          'This cancellation reason is shared with the buyer and recorded in the order timeline. Escrow payments (if any) are queued for refund.',
        ]}
        onSubmit={async () => {
          const trimmed = cancelReasonText.trim();
          if (!cancelReasonModal || trimmed.length < 5) return;
          const target = cancelReasonModal;
          setCancelReasonModal(null);
          setCancelReasonText('');
          setCancelReasonTouched(false);
          setCancelReasonSubmitted(false);
          if (target.kind === 'restaurant') {
            await handleKitchenOrderAction(
              target.orderId,
              'reject_order',
              trimmed
            );
          } else {
            await handleShopOrderAction(
              target.orderId,
              { action: 'update_status', nextStatus: 'cancelled' },
              trimmed
            );
          }
        }}
      >
        <div className="space-y-2">
          <label className="block text-xs font-semibold text-[var(--ps-text)]">
            Reason for {cancelReasonModal?.kind === 'restaurant' ? 'Rejection' : 'Cancellation'} *
          </label>
          <textarea
            rows={3}
            value={cancelReasonText}
            onChange={(e) => {
              setCancelReasonTouched(true);
              setCancelReasonText(e.target.value);
            }}
            onBlur={() => setCancelReasonTouched(true)}
            placeholder="e.g. Item out of stock today, kitchen closed early, or address outside service zone…"
            className="w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 text-xs text-[var(--ps-text)] focus:border-[var(--ps-accent)] focus:outline-none"
          />
          {(cancelReasonSubmitted || cancelReasonTouched) &&
            cancelReasonText.trim().length < 5 && (
              <p className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
                Please provide a cancellation reason (at least 5 characters).
              </p>
            )}
        </div>
      </FormModal>

      {/* UniversalPaymentModal (z-[90]) for Pro Subscriptions */}
      {activePaymentIntent && (
        <UniversalPaymentModal
          open={Boolean(activePaymentIntent)}
          onClose={() => setActivePaymentIntent(null)}
          intent={activePaymentIntent}
          title={paymentModalMeta.title}
          subtitle={paymentModalMeta.subtitle}
          onSubmitted={() => {
            setActivePaymentIntent(null);
            setStatus('success', 'Subscription submitted!');
            void loadCommerceData();
          }}
        />
      )}
    </div>
  );
}
