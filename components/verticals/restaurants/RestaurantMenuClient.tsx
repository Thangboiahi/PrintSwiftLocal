'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { ShareButton } from '@/components/ui/ShareButton';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import {
  AlertCircle,
  ArrowRight,
  CalendarDays,
  Check,
  CheckCircle2,
  Clock,
  Copy,
  Flame,
  KeyRound,
  Loader2,
  Minus,
  Navigation,
  Phone,
  Plus,
  Search,
  ShieldCheck,
  Store,
  Truck,
  UtensilsCrossed,
  X,
} from 'lucide-react';
import { UniversalPaymentModal } from '@/components/payments/UniversalPaymentModal';
import { DietIndicatorSquare } from '@/components/verticals/restaurants/RestaurantSummaryModal';
import { estimateLocalDeliveryFee } from '@/lib/commerce/pricing-engine';
import type {
  CommercePaymentRail,
  ListingRestaurantProfile,
  MenuDietType,
  MenuMealSlot,
  RestaurantFulfillmentMode,
  RestaurantMenuItem,
  RestaurantOrder,
  RestaurantTableReservation,
} from '@/lib/commerce/types';
import { useAppStatus } from '@/lib/hooks/useAppStatus';
import type { PaymentIntentRecord } from '@/lib/payments/types';
import { useAuth } from '@/lib/store';
import { supabase } from '@/lib/supabase/client';

export interface RestaurantMenuClientProps {
  listingId: string;
  listingTitle: string;
  listingLocality: string;
  listingLat: number;
  listingLng: number;
  contactPhone: string | null;
  profile: ListingRestaurantProfile;
  menuItems: RestaurantMenuItem[];
  hasActiveEntitlement: boolean;
  isModuleEnabled: boolean;
}

interface CartDishLine {
  lineKey: string;
  menuItem: RestaurantMenuItem;
  variantKey: string | null;
  variantLabel: string | null;
  addonKeys: string[];
  addonLabels: string[];
  unitPriceInr: number;
  qty: number;
}

export function RestaurantMenuClient({
  listingId,
  listingTitle,
  listingLocality,
  listingLat,
  listingLng,
  contactPhone,
  profile,
  menuItems,
  hasActiveEntitlement,
  isModuleEnabled,
}: RestaurantMenuClientProps) {
  const { user, fullName } = useAuth();
  const { setStatus } = useAppStatus();

  const [searchQuery, setSearchQuery] = useState('');
  const [dietFilter, setDietFilter] = useState<'all' | MenuDietType>('all');
  const [mealFilter, setMealFilter] = useState<'all' | MenuMealSlot>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');

  const [cartLines, setCartLines] = useState<CartDishLine[]>([]);

  // Customize Dish Modal (z-[88])
  const [customizingItem, setCustomizingItem] =
    useState<RestaurantMenuItem | null>(null);
  const [selectedVariantKey, setSelectedVariantKey] = useState<string>('');
  const [selectedAddonKeys, setSelectedAddonKeys] = useState<string[]>([]);

  // Checkout Modal (z-[88])
  const [isCheckoutOpen, setIsCheckoutOpen] = useState(false);
  const [fulfillmentMode, setFulfillmentMode] =
    useState<RestaurantFulfillmentMode>(
      profile.allow_takeaway ? 'takeaway' : 'pick_n_drop'
    );
  const [paymentRail, setPaymentRail] =
    useState<CommercePaymentRail>('platform_escrow');
  const [dropoffAddress, setDropoffAddress] = useState('');
  const [dropoffCoords, setDropoffCoords] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [cookingInstructions, setCookingInstructions] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [activeIntent, setActiveIntent] = useState<PaymentIntentRecord | null>(
    null
  );
  const [pendingOrderDraft, setPendingOrderDraft] = useState<{
    order: RestaurantOrder;
    pickupOtp: string;
  } | null>(null);
  const [confirmedOrder, setConfirmedOrder] = useState<{
    order: RestaurantOrder;
    pickupOtp: string;
  } | null>(null);
  const [copiedOtp, setCopiedOtp] = useState(false);

  // Table Reservation Modal (z-[88])
  const [isTableModalOpen, setIsTableModalOpen] = useState(false);
  const [partySize, setPartySize] = useState(2);
  const [reservedFor, setReservedFor] = useState(() => {
    const dt = new Date(Date.now() + 2 * 60 * 60 * 1000);
    return dt.toISOString().slice(0, 16);
  });
  const [guestName, setGuestName] = useState(fullName || '');
  const [guestPhone, setGuestPhone] = useState('');
  const [specialRequest, setSpecialRequest] = useState('');
  const [isSubmittingTable, setIsSubmittingTable] = useState(false);
  const [tableConfirmed, setTableConfirmed] =
    useState<RestaurantTableReservation | null>(null);
  const [tableError, setTableError] = useState<string | null>(null);
  const [highlightedItemId, setHighlightedItemId] = useState<string | null>(null);

  // Pass V9-B: Deep-link ?item=<dishId> smooth scroll + 2.5s accent highlight ring
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const itemParam = new URLSearchParams(window.location.search)
      .get('item')
      ?.trim();
    if (!itemParam) return;
    setHighlightedItemId(itemParam);
    const el = document.querySelector<HTMLElement>(
      `[data-item-id="${CSS.escape(itemParam)}"]`
    );
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    const timer = window.setTimeout(() => setHighlightedItemId(null), 2500);
    return () => window.clearTimeout(timer);
  }, []);

  // Open table modal automatically on #reserve-table hash
  useEffect(() => {
    if (
      typeof window !== 'undefined' &&
      window.location.hash === '#reserve-table' &&
      profile.allow_table_booking
    ) {
      setIsTableModalOpen(true);
    }
  }, [profile.allow_table_booking]);

  useEffect(() => {
    if (fullName && !guestName) setGuestName(fullName);
  }, [fullName, guestName]);

  const isKitchenPaused = Boolean(
    profile.kitchen_paused_until &&
      !Number.isNaN(Date.parse(profile.kitchen_paused_until)) &&
      Date.parse(profile.kitchen_paused_until) > Date.now()
  );
  const canOrderOnline =
    isModuleEnabled &&
    hasActiveEntitlement &&
    profile.is_kitchen_open &&
    !isKitchenPaused;

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const item of menuItems) set.add(item.category_name || 'Mains');
    return Array.from(set);
  }, [menuItems]);

  const filteredMenu = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return menuItems.filter((m) => {
      if (dietFilter !== 'all' && m.diet_type !== dietFilter) return false;
      if (mealFilter !== 'all' && m.meal_slot !== mealFilter && m.meal_slot !== 'all_day') {
        return false;
      }
      if (categoryFilter !== 'all' && m.category_name !== categoryFilter) {
        return false;
      }
      if (!q) return true;
      return (
        m.name.toLowerCase().includes(q) ||
        (m.description || '').toLowerCase().includes(q) ||
        m.category_name.toLowerCase().includes(q)
      );
    });
  }, [menuItems, searchQuery, dietFilter, mealFilter, categoryFilter]);

  const totalItems = cartLines.reduce((s, l) => s + l.qty, 0);
  const subtotalInr = cartLines.reduce((s, l) => s + l.unitPriceInr * l.qty, 0);
  const packagingFeeInr = Math.max(0, Number(profile.packaging_fee_inr || 0));

  const deliveryEst = useMemo(() => {
    if (fulfillmentMode !== 'pick_n_drop') {
      return { distanceKm: 0, deliveryFeeInr: 0 };
    }
    const lat = dropoffCoords?.lat ?? listingLat + 0.008;
    const lng = dropoffCoords?.lng ?? listingLng + 0.008;
    return estimateLocalDeliveryFee(listingLat, listingLng, lat, lng);
  }, [fulfillmentMode, dropoffCoords, listingLat, listingLng]);

  const totalAmountInr =
    subtotalInr + packagingFeeInr + deliveryEst.deliveryFeeInr;
  const directPayMax = Number(profile.payment_policy?.direct_pay_max_inr ?? 400);
  const forcesEscrow =
    fulfillmentMode === 'pick_n_drop' ||
    !profile.payment_policy?.allow_direct_pay ||
    totalAmountInr > directPayMax;
  const effectiveRail: CommercePaymentRail = forcesEscrow
    ? 'platform_escrow'
    : paymentRail;
  const meetsMinOrder = subtotalInr >= Number(profile.min_order_inr || 0);

  const addSimpleOrCustomize = (item: RestaurantMenuItem) => {
    if (!item.in_stock) return;
    if (item.variants.length > 0 || item.addons.length > 0) {
      setCustomizingItem(item);
      setSelectedVariantKey(item.variants[0]?.key || '');
      setSelectedAddonKeys([]);
      return;
    }
    const lineKey = item.id;
    setCartLines((prev) => {
      const existing = prev.find((l) => l.lineKey === lineKey);
      if (existing) {
        return prev.map((l) =>
          l.lineKey === lineKey ? { ...l, qty: Math.min(30, l.qty + 1) } : l
        );
      }
      return [
        ...prev,
        {
          lineKey,
          menuItem: item,
          variantKey: null,
          variantLabel: null,
          addonKeys: [],
          addonLabels: [],
          unitPriceInr: item.base_price_inr,
          qty: 1,
        },
      ];
    });
  };

  const confirmCustomizedDish = () => {
    if (!customizingItem) return;
    const variant = customizingItem.variants.find(
      (v) => v.key === selectedVariantKey
    );
    const baseP = variant ? variant.price_inr : customizingItem.base_price_inr;
    const addons = customizingItem.addons.filter((a) =>
      selectedAddonKeys.includes(a.key)
    );
    const addonSum = addons.reduce((s, a) => s + a.price_inr, 0);
    const sortedAddons = [...selectedAddonKeys].sort().join(',');
    const lineKey = `${customizingItem.id}::${variant?.key || ''}::${sortedAddons}`;

    setCartLines((prev) => {
      const existing = prev.find((l) => l.lineKey === lineKey);
      if (existing) {
        return prev.map((l) =>
          l.lineKey === lineKey ? { ...l, qty: Math.min(30, l.qty + 1) } : l
        );
      }
      return [
        ...prev,
        {
          lineKey,
          menuItem: customizingItem,
          variantKey: variant?.key || null,
          variantLabel: variant?.label || null,
          addonKeys: addons.map((a) => a.key),
          addonLabels: addons.map((a) => a.label),
          unitPriceInr: baseP + addonSum,
          qty: 1,
        },
      ];
    });
    setCustomizingItem(null);
  };

  const adjustLineQty = (lineKey: string, delta: number) => {
    setCartLines((prev) =>
      prev
        .map((l) =>
          l.lineKey === lineKey ? { ...l, qty: l.qty + delta } : l
        )
        .filter((l) => l.qty > 0)
    );
  };

  const handlePlaceFoodOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (!user) {
      setErrorMsg('Please sign in to place your food order.');
      return;
    }
    if (!meetsMinOrder) {
      setErrorMsg(`Minimum order amount is ₹${profile.min_order_inr}.`);
      return;
    }
    if (fulfillmentMode === 'pick_n_drop' && !dropoffAddress.trim()) {
      setErrorMsg('Please enter your delivery address.');
      return;
    }

    setIsSubmitting(true);
    setStatus('saving', 'Sending order to kitchen...');

    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('Please sign in again.');

      const res = await fetch('/api/commerce/restaurant-orders/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          listingId,
          items: cartLines.map((l) => ({
            menuItemId: l.menuItem.id,
            qty: l.qty,
            variantKey: l.variantKey,
            addonKeys: l.addonKeys,
          })),
          fulfillmentMode,
          paymentRail: effectiveRail,
          dropoffAddress:
            fulfillmentMode === 'pick_n_drop'
              ? dropoffAddress.trim()
              : undefined,
          dropoffLat: dropoffCoords?.lat,
          dropoffLng: dropoffCoords?.lng,
          cookingInstructions: cookingInstructions.trim() || undefined,
        }),
      });

      const json = (await res.json().catch(() => ({}))) as {
        order?: RestaurantOrder;
        paymentIntent?: PaymentIntentRecord;
        pickupOtp?: string;
        error?: string;
      };

      if (!res.ok || !json.order) {
        throw new Error(json.error || 'Could not place food order.');
      }

      const otp = json.pickupOtp || json.order.pickup_otp_display_for_customer || '----';
      setIsCheckoutOpen(false);
      setCartLines([]);

      if (json.paymentIntent) {
        setPendingOrderDraft({ order: json.order, pickupOtp: otp });
        setActiveIntent(json.paymentIntent);
        setStatus('idle');
      } else {
        setConfirmedOrder({ order: json.order, pickupOtp: otp });
        setStatus('success', 'Order sent to kitchen!');
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Order failed.';
      setErrorMsg(msg);
      setStatus('error', 'Order failed');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleReserveTable = async (e: React.FormEvent) => {
    e.preventDefault();
    setTableError(null);
    if (!user) {
      setTableError('Please sign in to reserve a table.');
      return;
    }
    setIsSubmittingTable(true);
    try {
      const {
        data: { session },
      } = await supabase.auth.getSession();
      const token = session?.access_token;
      if (!token) throw new Error('Please sign in again.');

      const res = await fetch('/api/commerce/table-reservations', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          action: 'create',
          listingId,
          partySize,
          reservedFor: new Date(reservedFor).toISOString(),
          guestName: guestName.trim() || 'Guest',
          guestPhone: guestPhone.trim() || undefined,
          specialRequest: specialRequest.trim() || undefined,
        }),
      });

      const json = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        reservation?: RestaurantTableReservation;
        error?: string;
      };
      if (!res.ok || !json.reservation) {
        throw new Error(json.error || 'Could not submit table reservation.');
      }
      setTableConfirmed(json.reservation);
      setStatus('success', 'Table reservation requested!');
    } catch (err) {
      setTableError(
        err instanceof Error ? err.message : 'Table reservation failed.'
      );
    } finally {
      setIsSubmittingTable(false);
    }
  };

  return (
    <section
      id="reserve-table"
      data-testid="restaurant-menu-client"
      className="rounded-2xl border border-orange-500/30 bg-[var(--ps-surface)] p-5 shadow-xs space-y-4"
    >
      {/* Header Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--ps-border)] pb-3">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-orange-500/15 text-orange-700 dark:text-orange-300">
            <UtensilsCrossed className="h-5 w-5" />
          </div>
          <div>
            <div className="flex flex-wrap items-center gap-1.5">
              <h2 className="text-sm sm:text-base font-extrabold text-[var(--ps-text)]">
                Digital Menu &amp; Ordering
              </h2>
              <span
                className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                  canOrderOnline
                    ? 'bg-emerald-500/15 text-emerald-800 dark:text-emerald-300'
                    : 'bg-amber-500/15 text-amber-800 dark:text-amber-300'
                }`}
              >
                <Clock className="h-3 w-3" />
                {canOrderOnline
                  ? `Accepting Orders · ~${profile.prep_time_mins}m`
                  : !hasActiveEntitlement
                    ? 'Menu Preview'
                    : 'Kitchen Paused'}
              </span>
              {profile.is_pure_veg && (
                <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-bold text-emerald-800 dark:text-emerald-300">
                  Pure Veg
                </span>
              )}
              {profile.fssai_verified && (
                <span className="inline-flex items-center gap-0.5 rounded bg-orange-500/15 px-1.5 py-0.5 text-[10px] font-bold text-orange-800 dark:text-orange-300">
                  <ShieldCheck className="h-3 w-3" />
                  FSSAI Verified ✓
                </span>
              )}
            </div>
            <p className="text-xs text-[var(--ps-text-muted)]">
              {profile.cuisines.join(' · ')} · Avg ₹{profile.avg_cost_for_two_inr}{' '}
              for 2
            </p>
          </div>
        </div>

        {profile.allow_table_booking && (
          <button
            type="button"
            onClick={() => {
              setTableConfirmed(null);
              setIsTableModalOpen(true);
            }}
            data-testid="open-reserve-table-btn"
            className="inline-flex h-8 items-center gap-1.5 rounded-xl border border-orange-500/40 bg-orange-500/10 hover:bg-orange-500/15 px-3 text-xs font-bold text-orange-800 dark:text-orange-200"
          >
            <CalendarDays className="h-3.5 w-3.5" />
            <span>Reserve a Table</span>
          </button>
        )}
      </div>

      {/* Confirmed Order Banner */}
      {confirmedOrder && (
        <div
          data-testid="restaurant-order-confirmed-card"
          className="rounded-2xl border border-emerald-500/35 bg-emerald-500/8 p-4 space-y-3"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-extrabold text-[var(--ps-text)]">
                Food Order Confirmed ·{' '}
                <span className="font-mono">{confirmedOrder.order.order_code}</span>
              </p>
              <p className="text-xs text-[var(--ps-text-muted)]">
                Est. prep ~{confirmedOrder.order.estimated_prep_mins}m · Share
                4-digit Pickup OTP at takeaway counter or with rider.
              </p>
            </div>
            <div className="flex items-center gap-2 rounded-xl border border-emerald-500/35 bg-[var(--ps-surface)] px-3 py-1.5">
              <KeyRound className="h-4 w-4 text-emerald-600" />
              <span className="font-mono text-lg font-black tracking-[0.2em]">
                {confirmedOrder.pickupOtp}
              </span>
              <button
                type="button"
                onClick={() => {
                  void navigator.clipboard.writeText(confirmedOrder.pickupOtp);
                  setCopiedOtp(true);
                  window.setTimeout(() => setCopiedOtp(false), 1500);
                }}
              >
                {copiedOtp ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </div>
          </div>
          <Link
            href="/activity?tab=commerce"
            className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-emerald-600 px-3 text-xs font-bold text-white"
          >
            <span>Track in My Activity</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </div>
      )}

      {/* Search & Diet / Meal / Category Filters */}
      <div className="space-y-2">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[180px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--ps-text-muted)]" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search dishes, momos, beverages…"
              className="h-8 w-full rounded-lg border border-[var(--ps-border)] bg-[var(--ps-bg)] pl-8 pr-3 text-xs"
            />
          </div>

          <div className="flex flex-wrap items-center gap-1">
            {(
              [
                { id: 'all', label: 'All' },
                { id: 'veg', label: 'Veg Only' },
                { id: 'egg', label: 'Egg' },
                { id: 'non_veg', label: 'Non-Veg' },
              ] as const
            ).map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => setDietFilter(d.id)}
                className={`h-7 rounded-md px-2 text-[11px] font-bold ${
                  dietFilter === d.id
                    ? 'bg-orange-600 text-white'
                    : 'border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)]'
                }`}
              >
                {d.label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              { id: 'all', label: 'All Day' },
              { id: 'breakfast', label: 'Breakfast' },
              { id: 'lunch', label: 'Lunch' },
              { id: 'dinner', label: 'Dinner' },
            ] as const
          ).map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setMealFilter(m.id)}
              className={`h-6 rounded-md px-2 text-[10px] font-bold ${
                mealFilter === m.id
                  ? 'bg-slate-900 text-white dark:bg-orange-500/25 dark:text-orange-200'
                  : 'border border-[var(--ps-border)] bg-[var(--ps-bg)] text-[var(--ps-text-muted)]'
              }`}
            >
              {m.label}
            </button>
          ))}
          {categories.length > 1 && (
            <>
              <span className="text-[var(--ps-border)]">|</span>
              <button
                type="button"
                onClick={() => setCategoryFilter('all')}
                className={`h-6 rounded-md px-2 text-[10px] font-bold ${
                  categoryFilter === 'all'
                    ? 'bg-orange-500/20 text-orange-800 dark:text-orange-200'
                    : 'text-[var(--ps-text-muted)]'
                }`}
              >
                All Sections
              </button>
              {categories.map((cat) => (
                <button
                  key={cat}
                  type="button"
                  onClick={() => setCategoryFilter(cat)}
                  className={`h-6 rounded-md px-2 text-[10px] font-bold ${
                    categoryFilter === cat
                      ? 'bg-orange-500/20 text-orange-800 dark:text-orange-200'
                      : 'text-[var(--ps-text-muted)]'
                  }`}
                >
                  {cat}
                </button>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Menu Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {filteredMenu.map((item) => {
          const itemCartQty = cartLines
            .filter((l) => l.menuItem.id === item.id)
            .reduce((s, l) => s + l.qty, 0);

          return (
            <div
              key={item.id}
              data-item-id={item.id}
              className={`rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 flex items-start justify-between gap-3 transition-all duration-300 ${
                !item.in_stock ? 'opacity-60' : ''
              } ${
                highlightedItemId === item.id
                  ? 'ring-2 ring-[var(--ps-accent)] bg-[var(--ps-accent)]/8'
                  : ''
              }`}
            >
              <div className="min-w-0 flex-1 space-y-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <DietIndicatorSquare diet={item.diet_type} />
                  <p className="text-xs font-extrabold text-[var(--ps-text)]">
                    {item.name}
                  </p>
                  {item.is_bestseller && (
                    <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-extrabold uppercase text-amber-800 dark:text-amber-300">
                      Bestseller
                    </span>
                  )}
                  {item.is_spicy && (
                    <Flame className="h-3 w-3 text-rose-500" />
                  )}
                  <ShareButton
                    compact
                    title={item.name}
                    text={`${item.name} (₹${Math.round(item.base_price_inr).toLocaleString('en-IN')}) at ${listingTitle} on DD oodle`}
                    url={`/listing/${encodeURIComponent(listingId)}?item=${encodeURIComponent(item.id)}`}
                    label={`Share ${item.name}`}
                    testId={`share-menu-item-${item.id}`}
                    className="h-6 w-6 ml-auto"
                  />
                </div>
                {item.description && (
                  <p className="text-[11px] text-[var(--ps-text-muted)] line-clamp-2">
                    {item.description}
                  </p>
                )}
                <p className="font-mono text-xs font-extrabold text-orange-700 dark:text-orange-300">
                  ₹{Math.round(item.base_price_inr).toLocaleString('en-IN')}
                  {item.variants.length > 0 && (
                    <span className="ml-1 font-sans text-[10px] font-normal text-[var(--ps-text-muted)]">
                      · Customizable
                    </span>
                  )}
                </p>
              </div>

              {canOrderOnline && (
                <div className="shrink-0">
                  {!item.in_stock ? (
                    <span className="rounded-md bg-rose-500/15 px-2 py-1 text-[10px] font-bold text-rose-700 dark:text-rose-300">
                      Sold Out Today
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => addSimpleOrCustomize(item)}
                      className="inline-flex h-8 items-center gap-1 rounded-lg bg-orange-600 hover:bg-orange-700 px-3 text-xs font-bold text-white"
                    >
                      <Plus className="h-3.5 w-3.5" />
                      <span>{itemCartQty > 0 ? `Add (${itemCartQty})` : 'Add'}</span>
                    </button>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Free Basic Listing Strip */}
      {!hasActiveEntitlement && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3.5 py-2.5 text-xs">
          <span className="text-[var(--ps-text-muted)]">
            View-only menu preview — call or enquire directly to order.
          </span>
          {contactPhone && (
            <a
              href={`tel:${contactPhone.replace(/[^+\d]/g, '')}`}
              className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-orange-600 px-3 text-xs font-bold text-white"
            >
              <Phone className="h-3.5 w-3.5" />
              <span>Call Kitchen</span>
            </a>
          )}
        </div>
      )}

      {/* Sticky Bottom Food Cart Bar */}
      {canOrderOnline && totalItems > 0 && (
        <div className="sticky bottom-16 lg:bottom-4 z-30 flex items-center justify-between gap-3 rounded-2xl border border-orange-500/40 bg-slate-950 px-4 py-3 text-white shadow-xl">
          <div>
            <p className="text-xs font-extrabold">
              {totalItems} {totalItems === 1 ? 'dish' : 'dishes'} ·{' '}
              <span className="font-mono">
                ₹{Math.round(subtotalInr).toLocaleString('en-IN')}
              </span>
            </p>
            <p className="text-[10px] text-slate-300">
              {meetsMinOrder
                ? 'Takeaway or Hot-Food Pick N Drop ready'
                : `Add ₹${Math.ceil(profile.min_order_inr - subtotalInr)} more to meet min order`}
            </p>
          </div>
          <button
            type="button"
            onClick={() => setIsCheckoutOpen(true)}
            className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-orange-500 hover:bg-orange-400 px-4 text-xs font-extrabold text-slate-950"
          >
            <span>View Cart</span>
            <ArrowRight className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Customize Dish Modal (z-[88]) */}
      {customizingItem &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            onClick={() => setCustomizingItem(null)}
            className="fixed inset-0 z-[88] flex items-end sm:items-center justify-center bg-slate-950/70 p-0 sm:p-4 backdrop-blur-xs"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-t-2xl sm:rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5 space-y-4 shadow-2xl text-xs"
            >
              <div className="flex items-center justify-between border-b border-[var(--ps-border)] pb-2.5">
                <div className="flex items-center gap-2">
                  <DietIndicatorSquare diet={customizingItem.diet_type} />
                  <h3 className="text-sm font-extrabold">
                    Customize {customizingItem.name}
                  </h3>
                </div>
                <button
                  type="button"
                  onClick={() => setCustomizingItem(null)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--ps-border)]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {customizingItem.variants.length > 0 && (
                <div className="space-y-1.5">
                  <p className="font-bold text-[var(--ps-text-muted)] uppercase text-[10px]">
                    Choose Portion / Variant
                  </p>
                  {customizingItem.variants.map((v) => (
                    <label
                      key={v.key}
                      className="flex items-center justify-between rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 cursor-pointer"
                    >
                      <span className="flex items-center gap-2 font-bold">
                        <input
                          type="radio"
                          name="dish-variant"
                          checked={selectedVariantKey === v.key}
                          onChange={() => setSelectedVariantKey(v.key)}
                        />
                        {v.label}
                      </span>
                      <span className="font-mono font-extrabold text-orange-700 dark:text-orange-300">
                        ₹{v.price_inr}
                      </span>
                    </label>
                  ))}
                </div>
              )}

              {customizingItem.addons.length > 0 && (
                <div className="space-y-1.5">
                  <p className="font-bold text-[var(--ps-text-muted)] uppercase text-[10px]">
                    Optional Add-Ons
                  </p>
                  {customizingItem.addons.map((a) => {
                    const checked = selectedAddonKeys.includes(a.key);
                    return (
                      <label
                        key={a.key}
                        className="flex items-center justify-between rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2 cursor-pointer"
                      >
                        <span className="flex items-center gap-2 font-bold">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() =>
                              setSelectedAddonKeys((prev) =>
                                checked
                                  ? prev.filter((k) => k !== a.key)
                                  : [...prev, a.key]
                              )
                            }
                          />
                          {a.label}
                        </span>
                        <span className="font-mono font-bold">
                          +₹{a.price_inr}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}

              <button
                type="button"
                onClick={confirmCustomizedDish}
                className="inline-flex h-9 w-full items-center justify-center rounded-xl bg-orange-600 hover:bg-orange-700 font-bold text-white"
              >
                Add to Food Cart
              </button>
            </div>
          </div>,
          document.body
        )}

      {/* Food Cart Checkout Modal (z-[88]) */}
      {isCheckoutOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            onClick={() => !isSubmitting && setIsCheckoutOpen(false)}
            className="fixed inset-0 z-[88] flex items-end sm:items-center justify-center bg-slate-950/70 p-0 sm:p-4 backdrop-blur-xs"
          >
            <form
              onSubmit={handlePlaceFoodOrder}
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md max-h-[88vh] overflow-y-auto rounded-t-2xl sm:rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5 space-y-4 shadow-2xl text-xs"
            >
              <div className="flex items-center justify-between border-b border-[var(--ps-border)] pb-2.5">
                <h3 className="text-sm font-extrabold">
                  Food Cart · {listingTitle}
                </h3>
                <button
                  type="button"
                  onClick={() => setIsCheckoutOpen(false)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--ps-border)]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* Cart Items */}
              <div className="space-y-1.5">
                {cartLines.map((line) => (
                  <div
                    key={line.lineKey}
                    className="flex items-center justify-between gap-2 rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="font-bold truncate">
                        {line.menuItem.name}
                        {line.variantLabel ? ` (${line.variantLabel})` : ''}
                      </p>
                      {line.addonLabels.length > 0 && (
                        <p className="text-[10px] text-[var(--ps-text-muted)] truncate">
                          + {line.addonLabels.join(', ')}
                        </p>
                      )}
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        onClick={() => adjustLineQty(line.lineKey, -1)}
                        className="p-0.5 rounded border border-[var(--ps-border)]"
                      >
                        <Minus className="h-3 w-3" />
                      </button>
                      <span className="font-mono font-bold">{line.qty}</span>
                      <button
                        type="button"
                        onClick={() => adjustLineQty(line.lineKey, 1)}
                        className="p-0.5 rounded border border-[var(--ps-border)]"
                      >
                        <Plus className="h-3 w-3" />
                      </button>
                      <span className="font-mono font-extrabold w-12 text-right">
                        ₹{Math.round(line.unitPriceInr * line.qty)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>

              {/* Fulfillment Toggle */}
              <div className="grid grid-cols-2 gap-2">
                {profile.allow_takeaway && (
                  <button
                    type="button"
                    onClick={() => setFulfillmentMode('takeaway')}
                    className={`h-9 rounded-xl border px-3 font-bold inline-flex items-center justify-center gap-1.5 ${
                      fulfillmentMode === 'takeaway'
                        ? 'border-orange-600 bg-orange-600 text-white'
                        : 'border-[var(--ps-border)] bg-[var(--ps-bg)]'
                    }`}
                  >
                    <Store className="h-3.5 w-3.5" />
                    <span>Self-Takeaway</span>
                  </button>
                )}
                {profile.allow_pick_n_drop && (
                  <button
                    type="button"
                    onClick={() => setFulfillmentMode('pick_n_drop')}
                    className={`h-9 rounded-xl border px-3 font-bold inline-flex items-center justify-center gap-1.5 ${
                      fulfillmentMode === 'pick_n_drop'
                        ? 'border-emerald-600 bg-emerald-600 text-white'
                        : 'border-[var(--ps-border)] bg-[var(--ps-bg)]'
                    }`}
                  >
                    <Truck className="h-3.5 w-3.5" />
                    <span>Pick N Drop</span>
                  </button>
                )}
              </div>

              {fulfillmentMode === 'pick_n_drop' && (
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="font-bold">Delivery Address *</span>
                    <button
                      type="button"
                      onClick={() => {
                        navigator.geolocation?.getCurrentPosition((pos) => {
                          setDropoffCoords({
                            lat: pos.coords.latitude,
                            lng: pos.coords.longitude,
                          });
                          if (!dropoffAddress) {
                            setDropoffAddress(`Near ${listingLocality} (GPS)`);
                          }
                        });
                      }}
                      className="inline-flex items-center gap-1 text-[11px] font-bold text-orange-600"
                    >
                      <Navigation className="h-3 w-3" />
                      Use GPS
                    </button>
                  </div>
                  <input
                    type="text"
                    required
                    value={dropoffAddress}
                    onChange={(e) => setDropoffAddress(e.target.value)}
                    placeholder="House no., Veng, Landmark"
                    className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3"
                  />
                </div>
              )}

              <input
                type="text"
                value={cookingInstructions}
                onChange={(e) => setCookingInstructions(e.target.value)}
                placeholder="Cooking instructions (e.g., less spicy, no onions)…"
                className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3"
              />

              {!forcesEscrow && (
                <div className="grid grid-cols-2 gap-1.5">
                  <button
                    type="button"
                    onClick={() => setPaymentRail('platform_escrow')}
                    className={`h-8 rounded-lg border font-bold ${
                      effectiveRail === 'platform_escrow'
                        ? 'border-emerald-600 bg-emerald-500/12'
                        : 'border-[var(--ps-border)] bg-[var(--ps-bg)]'
                    }`}
                  >
                    DD oodle Escrow
                  </button>
                  <button
                    type="button"
                    onClick={() => setPaymentRail('direct_counter')}
                    className={`h-8 rounded-lg border font-bold ${
                      effectiveRail === 'direct_counter'
                        ? 'border-orange-600 bg-orange-500/12'
                        : 'border-[var(--ps-border)] bg-[var(--ps-bg)]'
                    }`}
                  >
                    Pay at Counter
                  </button>
                </div>
              )}

              {/* Breakdown */}
              <div className="rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] p-3 space-y-1.5">
                <div className="flex justify-between">
                  <span className="text-[var(--ps-text-muted)]">
                    Food Subtotal
                  </span>
                  <span className="font-mono font-bold">
                    ₹{Math.round(subtotalInr)}
                  </span>
                </div>
                {packagingFeeInr > 0 && (
                  <div className="flex justify-between">
                    <span className="text-[var(--ps-text-muted)]">
                      Kitchen Packaging
                    </span>
                    <span className="font-mono font-bold">
                      ₹{Math.round(packagingFeeInr)}
                    </span>
                  </div>
                )}
                {fulfillmentMode === 'pick_n_drop' && (
                  <div className="flex justify-between">
                    <span className="text-[var(--ps-text-muted)]">
                      Hot-Food Pick N Drop (~{deliveryEst.distanceKm} km)
                    </span>
                    <span className="font-mono font-bold">
                      ₹{Math.round(deliveryEst.deliveryFeeInr)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between pt-1.5 border-t border-[var(--ps-border)] text-sm font-extrabold">
                  <span>Total</span>
                  <span className="font-mono text-orange-700 dark:text-orange-300">
                    ₹{Math.round(totalAmountInr)}
                  </span>
                </div>
              </div>

              {errorMsg && (
                <div className="flex items-start gap-2 rounded-xl border border-rose-500/35 bg-rose-500/10 p-2.5 text-rose-700 dark:text-rose-300">
                  <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                  <span>{errorMsg}</span>
                </div>
              )}

              {!user ? (
                <Link
                  href={`/login?next=${encodeURIComponent(`/listing/${listingId}`)}`}
                  className="inline-flex h-10 w-full items-center justify-center rounded-xl bg-orange-600 font-bold text-white"
                >
                  Sign In to Order Food
                </Link>
              ) : (
                <button
                  type="submit"
                  disabled={isSubmitting || !meetsMinOrder || cartLines.length === 0}
                  className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-orange-600 hover:bg-orange-700 font-bold text-white disabled:opacity-50"
                >
                  {isSubmitting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <UtensilsCrossed className="h-4 w-4" />
                  )}
                  <span>
                    {effectiveRail === 'platform_escrow'
                      ? `Pay ₹${Math.round(totalAmountInr)} via Escrow`
                      : 'Place Takeaway Order'}
                  </span>
                </button>
              )}
            </form>
          </div>,
          document.body
        )}

      {/* Table Reservation Modal (z-[88]) */}
      {isTableModalOpen &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            onClick={() => !isSubmittingTable && setIsTableModalOpen(false)}
            className="fixed inset-0 z-[88] flex items-end sm:items-center justify-center bg-slate-950/70 p-0 sm:p-4 backdrop-blur-xs"
          >
            <div
              onClick={(e) => e.stopPropagation()}
              className="w-full max-w-md rounded-t-2xl sm:rounded-2xl border border-[var(--ps-border)] bg-[var(--ps-surface)] p-5 space-y-4 shadow-2xl text-xs"
            >
              <div className="flex items-center justify-between border-b border-[var(--ps-border)] pb-2.5">
                <h3 className="text-sm font-extrabold">
                  Reserve a Table · {listingTitle}
                </h3>
                <button
                  type="button"
                  onClick={() => setIsTableModalOpen(false)}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-[var(--ps-border)]"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {tableConfirmed ? (
                <div className="space-y-3 text-center py-2">
                  <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
                  <p className="text-sm font-extrabold">
                    Reservation Requested ·{' '}
                    <span className="font-mono">
                      {tableConfirmed.reservation_code}
                    </span>
                  </p>
                  <p className="text-xs text-[var(--ps-text-muted)]">
                    Party of {tableConfirmed.party_size} · Track confirmation in
                    My Activity.
                  </p>
                  <Link
                    href="/activity?tab=commerce"
                    onClick={() => setIsTableModalOpen(false)}
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-orange-600 px-4 text-xs font-bold text-white"
                  >
                    <span>View in My Activity</span>
                    <ArrowRight className="h-3.5 w-3.5" />
                  </Link>
                </div>
              ) : (
                <form onSubmit={handleReserveTable} className="space-y-3">
                  <div className="grid grid-cols-2 gap-2.5">
                    <div className="space-y-1">
                      <span className="font-bold text-[var(--ps-text-muted)]">
                        Guests (max {profile.max_table_party_size})
                      </span>
                      <div className="flex h-9 items-center justify-between rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2.5">
                        <button
                          type="button"
                          onClick={() => setPartySize((p) => Math.max(1, p - 1))}
                        >
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                        <span className="font-mono font-extrabold">
                          {partySize}
                        </span>
                        <button
                          type="button"
                          onClick={() =>
                            setPartySize((p) =>
                              Math.min(profile.max_table_party_size, p + 1)
                            )
                          }
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    <label className="space-y-1">
                      <span className="font-bold text-[var(--ps-text-muted)]">
                        Date &amp; Time *
                      </span>
                      <input
                        type="datetime-local"
                        required
                        value={reservedFor}
                        onChange={(e) => setReservedFor(e.target.value)}
                        className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-2"
                      />
                    </label>
                  </div>

                  <input
                    type="text"
                    required
                    value={guestName}
                    onChange={(e) => setGuestName(e.target.value)}
                    placeholder="Your Full Name *"
                    className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3"
                  />
                  <input
                    type="tel"
                    value={guestPhone}
                    onChange={(e) => setGuestPhone(e.target.value)}
                    placeholder="Phone / WhatsApp Number"
                    className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3"
                  />
                  <input
                    type="text"
                    value={specialRequest}
                    onChange={(e) => setSpecialRequest(e.target.value)}
                    placeholder="Special request (e.g., window table, birthday)"
                    className="h-9 w-full rounded-xl border border-[var(--ps-border)] bg-[var(--ps-bg)] px-3"
                  />

                  {tableError && (
                    <p className="text-xs font-semibold text-rose-600">
                      {tableError}
                    </p>
                  )}

                  <button
                    type="submit"
                    disabled={isSubmittingTable}
                    className="inline-flex h-9 w-full items-center justify-center gap-1.5 rounded-xl bg-orange-600 hover:bg-orange-700 font-bold text-white disabled:opacity-50"
                  >
                    {isSubmittingTable && (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    )}
                    <span>Request Table Reservation</span>
                  </button>
                </form>
              )}
            </div>
          </div>,
          document.body
        )}

      {/* UniversalPaymentModal (z-[90]) */}
      <UniversalPaymentModal
        open={Boolean(activeIntent)}
        intent={activeIntent}
        title={`Food Order · ${listingTitle}`}
        subtitle={
          pendingOrderDraft
            ? `Order ${pendingOrderDraft.order.order_code}`
            : listingLocality
        }
        onSubmitted={() => {
          setActiveIntent(null);
          if (pendingOrderDraft) {
            setConfirmedOrder({
              order: pendingOrderDraft.order,
              pickupOtp: pendingOrderDraft.pickupOtp,
            });
            setPendingOrderDraft(null);
          }
        }}
        onClose={() => setActiveIntent(null)}
      />
    </section>
  );
}

export default RestaurantMenuClient;
